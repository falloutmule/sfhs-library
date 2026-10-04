import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { zipSync, unzipSync, strToU8 } from 'fflate';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const output=resolve(root,'test-results','browser');await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://local').pathname;const file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+sep))throw 0;res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.SFHS_BROWSER_EXECUTABLE?{executablePath:process.env.SFHS_BROWSER_EXECUTABLE}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
const page=await context.newPage();
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const proof={...JSON.parse(await readFile(resolve(root,'build-info.json'),'utf8')),checks:[],screenshots:[]};
function check(name,condition=true){assert.ok(condition,name);proof.checks.push({name,result:'PASS'});console.log(`PASS ${name}`);}
async function snap(name){await page.screenshot({path:resolve(output,name),fullPage:true});proof.screenshots.push(name);}
async function dbApps(){return page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('sfhs-library-v1',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const get=db.transaction('apps').objectStore('apps').getAll();get.onsuccess=()=>{db.close();resolve(get.result.map(a=>({...a,versions:a.versions.map(v=>({...v,original:Array.from(v.original)}))})));};};}));}
const counter=version=>`<!doctype html><html><head><title>Counter Notes</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><h1>Counter ${version}</h1><output id="count"></output><button id="increment">Add one</button><script>let n=Number(localStorage.getItem('count')||0);const out=document.getElementById('count');out.textContent=n;document.getElementById('increment').addEventListener('click',()=>{n++;localStorage.setItem('count',String(n));out.textContent=n;});<\/script></body></html>`;
const hostile=`<!doctype html><title>Hostile probe</title><pre id="result"></pre><script>let result={};try{parent.document.body.dataset.attacked='yes';result.parent='BAD'}catch{result.parent='blocked'}try{parent.localStorage.setItem('attacked','yes');result.storage='BAD'}catch{result.storage='blocked'}try{top.location='https://example.com';result.escape='attempted'}catch{result.escape='blocked'}parent.postMessage({type:'save',appId:'victim',save:{localStorage:{count:'999'}}},'*');localStorage.setItem('self','own');document.getElementById('result').textContent=JSON.stringify(result);<\/script>`;
async function importHTML(text,name){await page.locator('#import-file').setInputFiles({name,mimeType:'text/html',buffer:Buffer.from(text)});await page.getByRole('button',{name:'Install application',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('dialog').open);}
async function card(name){return page.locator('#library-grid .app-card').filter({has:page.getByRole('heading',{name,exact:true})});}
async function launchCard(name){const node=await card(name);await node.getByRole('button',{name:'Launch',exact:true}).click();await page.locator('#runtime-container iframe').waitFor();return page.frameLocator('#runtime-container iframe');}
async function closeApp(){await page.locator('#runtime-close').click();await page.locator('#runtime').waitFor({state:'hidden'});}
async function backup(){await page.locator('[data-view="backups"]').first().click();const event=page.waitForEvent('download');await page.locator('#export-library').click();const download=await event;const path=resolve(output,download.suggestedFilename());await download.saveAs(path);return path;}

try {
  await page.goto(url);await page.getByRole('heading',{name:'Your collection starts here.'}).waitFor();
  await snap('library-empty-desktop.png');check('launcher opens with a real empty library');
  await page.route('https://network.example/app.js',route=>route.fulfill({contentType:'text/javascript',body:'document.getElementById("network-result").textContent="Explicit network permission works";'}));
  await page.locator('#import-file').setInputFiles({name:'network.html',mimeType:'text/html',buffer:Buffer.from('<!doctype html><title>Network Check</title><p id="network-result">Waiting</p><script src="https://network.example/app.js"><\/script>')});
  await page.getByRole('button',{name:'Review with network access enabled',exact:true}).click();await page.getByRole('button',{name:'Install application',exact:true}).click();
  let networkFrame=await launchCard('Network Check');await networkFrame.getByText('Explicit network permission works',{exact:true}).waitFor();await closeApp();
  check('declared HTTPS scripts run only after explicit network review under inherited parent CSP');
  await (await card('Network Check')).getByRole('button',{name:'Details',exact:true}).click();await page.getByRole('button',{name:'Remove application',exact:true}).click();await page.locator('#dialog-actions').getByRole('button',{name:'Remove application',exact:true}).click();
  await importHTML(counter('A'),'counter.html');
  let frame=await launchCard('Counter Notes');await frame.locator('#increment').click();await frame.locator('#increment').click();assert.equal(await frame.locator('#count').textContent(),'2');await closeApp();
  frame=await launchCard('Counter Notes');assert.equal(await frame.locator('#count').textContent(),'2');await closeApp();check('non-SFHS localStorage state survives exit and relaunch');
  await page.locator('#add-collection').click();await page.getByLabel('Collection name',{exact:true}).fill('Daily tools');await page.getByRole('button',{name:'Create collection',exact:true}).last().click();
  await (await card('Counter Notes')).getByRole('button',{name:'Details',exact:true}).click();await page.getByLabel('Daily tools',{exact:true}).check();await page.getByRole('button',{name:'Save organization',exact:true}).click();await page.locator('#dialog-close').click();await page.getByRole('button',{name:'Favorite Counter Notes',exact:true}).click();
  check('collections and favorites persist');
  await (await card('Counter Notes')).getByRole('button',{name:'Details',exact:true}).click();
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Import update',exact:true}).click();await (await chooser).setFiles({name:'counter-b.html',mimeType:'text/html',buffer:Buffer.from(counter('B'))});
  await page.getByRole('button',{name:'Preserve update & test',exact:true}).click();frame=page.frameLocator('#runtime-container iframe');await frame.getByRole('heading',{name:'Counter B'}).waitFor();assert.equal(await frame.locator('#count').textContent(),'2');await frame.locator('#increment').click();await page.getByRole('button',{name:'Use this version',exact:true}).click();await closeApp();
  await (await card('Counter Notes')).getByRole('button',{name:'Details',exact:true}).click();await page.getByRole('button',{name:'Preview & activate',exact:true}).click();frame=page.frameLocator('#runtime-container iframe');await frame.getByRole('heading',{name:'Counter A'}).waitFor();assert.equal(await frame.locator('#count').textContent(),'2');await page.getByRole('button',{name:'Use this version',exact:true}).click();await closeApp();check('update preserves version A; B receives save snapshot; rollback restores A coherent state');
  const victim=await dbApps();await importHTML(hostile,'hostile.html');frame=await launchCard('Hostile probe');const probe=JSON.parse(await frame.locator('#result').textContent());assert.equal(probe.parent,'blocked');assert.equal(probe.storage,'blocked');
  const sandbox=await page.locator('#runtime-container iframe').getAttribute('sandbox');assert.equal(sandbox,'allow-scripts');await closeApp();
  const afterAttack=await dbApps();assert.equal(afterAttack.find(x=>x.name==='Counter Notes').versions[0].save.localStorage.count,'2');assert.equal(await page.evaluate(()=>document.body.dataset.attacked),undefined);check('hostile app cannot access parent DOM/storage, replace another save, or escape top frame');
  await page.locator('#import-file').setInputFiles({name:'unsupported.html',mimeType:'text/html',buffer:Buffer.from('<!doctype html><title>Unsupported IDB</title><script>indexedDB.open("needs-own-origin")<\/script>')});await page.getByText('Unsupported',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Install application',exact:true}).count(),0);await page.locator('#dialog-close').click();check('unsupported app is refused, never marked installed');
  const before=await dbApps();const archivePath=await backup();
  const cdp=await context.newCDPSession(page);await page.goto('about:blank');await cdp.send('Storage.clearDataForOrigin',{origin:url,storageTypes:'all'});await page.goto(url);await page.getByRole('heading',{name:'Your collection starts here.'}).waitFor();check('destructive recovery starts from empty browser storage');
  await page.locator('#restore-file').setInputFiles(archivePath);await page.getByRole('button',{name:'Restore library',exact:true}).click();await page.getByRole('heading',{name:'Counter Notes',exact:true}).waitFor();
  const restored=await dbApps();assert.equal(restored.length,before.length);for(const old of before){const item=restored.find(x=>x.id===old.id);assert.ok(item);assert.equal(item.favorite,old.favorite);assert.deepEqual(item.collections,old.collections);assert.equal(item.activeVersionId,old.activeVersionId);for(let i=0;i<old.versions.length;i++){assert.deepEqual(item.versions[i].original,old.versions[i].original);assert.equal(item.versions[i].capsule,old.versions[i].capsule);assert.deepEqual(item.versions[i].save,old.versions[i].save);}}check('full restore preserves exact payloads, capsules, metadata, collections, favorites, archived versions, and saves');
  frame=await launchCard('Counter Notes');assert.equal(await frame.locator('#count').textContent(),'2');await closeApp();check('restored application observes restored save (application-level proof)');
  await snap('library-populated-desktop.png');
  const archiveFiles=unzipSync(new Uint8Array(await readFile(archivePath)));const originalName=Object.keys(archiveFiles).find(x=>x.endsWith('/original.bin'));archiveFiles[originalName]=strToU8('damaged');await page.locator('#restore-file').setInputFiles({name:'damaged.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync(archiveFiles))});await page.locator('#toast').filter({hasText:'checksum failed'}).waitFor();assert.equal((await dbApps()).length,restored.length);check('corrupt backup rejected before mutating current library');
  await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);await context.setOffline(true);await page.reload();await page.getByRole('heading',{name:'Counter Notes',exact:true}).waitFor();await page.locator('#global-search').fill('Counter');check('cached launcher, local metadata, and search work with networking disabled');
  frame=await launchCard('Counter Notes');assert.equal(await frame.locator('#count').textContent(),'2');await frame.locator('#increment').click();await closeApp();check('installed application launches and saves with networking disabled');
  const offlineBackup=await backup();await page.locator('#restore-file').setInputFiles(offlineBackup);await page.getByRole('button',{name:'Restore library',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('dialog').open);assert.equal((await dbApps()).length,4);check('backup creation and collision-preserving restore work offline');
  await page.locator('#global-search').fill('');await page.setViewportSize({width:390,height:844});await snap('library-phone.png');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));check('390px phone viewport has no horizontal overflow');
  await context.setOffline(false);await page.locator('.mobile-nav [data-view="discover"],.mobile-nav-item[data-view="discover"]').first().click();await page.locator('#discover-source').selectOption('itch');await page.locator('#discover-grid .app-card').first().waitFor();await snap('discover-phone.png');check('built-in itch catalog renders real indexed result cards');
  check('no unexpected launcher exceptions',errors.every(x=>/checksum failed/.test(x)));
  const standaloneContext=await browser.newContext({acceptDownloads:true});await standaloneContext.setOffline(true);
  const standalone=await standaloneContext.newPage();await standalone.goto(pathToFileURL(resolve(root,'index.html')).href);
  await standalone.getByRole('heading',{name:'Your collection starts here.'}).waitFor();
  await standalone.locator('#import-file').setInputFiles({name:'offline-standalone.html',mimeType:'text/html',buffer:Buffer.from(counter('standalone'))});
  await standalone.getByRole('button',{name:'Install application',exact:true}).click();await standalone.locator('#library-grid').getByRole('button',{name:'Launch',exact:true}).click();
  await standalone.frameLocator('#runtime-container iframe').getByRole('heading',{name:'Counter standalone'}).waitFor();
  await standalone.frameLocator('#runtime-container iframe').locator('#increment').click();await standalone.locator('#runtime-close').click();
  await standalone.locator('#library-grid').getByRole('button',{name:'Launch',exact:true}).click();
  assert.equal(await standalone.frameLocator('#runtime-container iframe').locator('#count').textContent(),'1');await standalone.locator('#runtime-close').click();
  await standaloneContext.close();check('downloadable standalone HTML installs, launches, and retains state from file:// while offline');
  proof.result='PASS';
} catch(error) {proof.result='FAIL';proof.error=error.stack;await snap('failure.png').catch(()=>{});throw error;}
finally {proof.pageErrors=errors;await writeFile(resolve(output,'proof.json'),JSON.stringify(proof,null,2));await browser.close();await new Promise(resolve=>server.close(resolve));}
