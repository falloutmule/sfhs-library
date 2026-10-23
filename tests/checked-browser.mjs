import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import assert from 'node:assert/strict';
import {CHECKED_APPS,websiteCheck} from '../src/checked-catalog.js';
import {analyzePayload} from '../src/capsule.js';
import {readArchive} from '../src/archive.js';
import {selectDiscoverSource} from './discover-helpers.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const output=resolve(root,`test-results/discover-quality/run-${new Date().toISOString().replace(/[:.]/g,'-')}`);
await mkdir(output,{recursive:true});await mkdir(resolve(root,'test-results/checked-sources'),{recursive:true});
const info=JSON.parse(await readFile(resolve(root,'build-info.json'),'utf8'));
const proof={...info,checks:[],screenshots:[],pageErrors:[],physicalPhoneAcceptance:false};
const hash=b=>createHash('sha256').update(b).digest('hex');
const sources=new Map();
async function source(url,expected){
  const cache=resolve(root,'test-results/checked-sources',expected);
  let bytes;try{bytes=await readFile(cache);if(hash(bytes)!==expected)throw 0;}catch{const response=await fetch(url,{signal:AbortSignal.timeout(25000)});assert.equal(response.status,200,url);bytes=Buffer.from(await response.arrayBuffer());assert.equal(hash(bytes),expected,url);await writeFile(cache,bytes);}
  sources.set(url,bytes);return bytes;
}
const tasks=CHECKED_APPS.filter(item=>item.package).flatMap(item=>item.package.tree.map(file=>()=>source(`https://raw.githubusercontent.com/${item.repository}/${item.commit}/${file.path}`,file.sha256)));
let next=0;await Promise.all(Array.from({length:4},async()=>{while(next<tasks.length)await tasks[next++]();}));
const pete=CHECKED_APPS.find(item=>item.payloadSha256);
const peteBytes=await source(`https://raw.githubusercontent.com/${pete.repository}/${pete.commit}/index.html`,pete.payloadSha256);
const rejected=await analyzePayload({bytes:new Uint8Array(peteBytes),filename:'index.html'});
assert.equal(rejected.compatible,false);assert.ok(rejected.reasons.some(reason=>reason.includes('Dynamic code evaluation')));
const server=createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://local').pathname;const name=pathname==='/'?'index.html':pathname.slice(1);if(!['index.html','start.html','sw.js','catalog.json','icon.svg','manifest.webmanifest'].includes(name))throw 0;res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[extname(name)]);res.end(await readFile(resolve(root,name)));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.SFHS_BROWSER_EXECUTABLE?{executablePath:process.env.SFHS_BROWSER_EXECUTABLE}:{})});
async function newContext(tamper=false,webFixture=false){
  const context=await browser.newContext({viewport:{width:412,height:915},isMobile:true,hasTouch:true,reducedMotion:'reduce',acceptDownloads:true});
  // Playwright aborts all intercepted URLs ending /favicon.ico, even fetches
  // (coreBundle FrameManager.requestStarted). Only the tamper fixture adds a
  // query to bypass that harness behavior. Positive installs use real network
  // downloads, original URLs, actual CORS, and no request interception.
  if(tamper)await context.addInitScript(()=>{const native=window.fetch;window.fetch=(input,options)=>native(typeof input==='string'&&input.startsWith('https://raw.githubusercontent.com/')&&input.endsWith('/favicon.ico')?input+'?sfhs-test-icon=1':input,options);});
  if(tamper)await context.route('https://raw.githubusercontent.com/**',async route=>{
    const url=new URL(route.request().url());url.search='';let bytes=sources.get(url.href);if(!bytes){await route.abort();return;}
    if(tamper&&route.request().url().endsWith('/js/tile.js')){bytes=Buffer.from(bytes);bytes[0]^=1;}
    await route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/octet-stream',body:bytes});
  });
  if(webFixture)await context.route('https://api.github.com/**',async route=>{
    if(new URL(route.request().url()).pathname==='/search/repositories')await route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify({total_count:1,items:[{name:'mykonos-island-voxels',full_name:'boona13/mykonos-island-voxels',description:'A browser-based isometric island builder game.',homepage:'https://mykonos-island-voxels.netlify.app',license:{spdx_id:'MIT'},topics:['html5-game','mobile']}]})});
    else await route.fulfill({status:503,headers:{'access-control-allow-origin':'*'},body:'{}'});
  });
  return context;
}
const context=await newContext(),page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>proof.pageErrors.push(e.message));
const card=(p,repo)=>p.locator(`[data-project="github:${repo}"]`);
function check(name){proof.checks.push({name,result:'PASS'});console.log('PASS '+name);}
async function shot(name){await page.screenshot({path:resolve(output,name)});proof.screenshots.push(name);}
async function open(p,name){await p.locator('.mobile-nav [data-view="library"]').click();await p.locator('#library-grid article').filter({has:p.getByRole('heading',{name,exact:true})}).getByRole('button',{name:'Launch',exact:true}).click();const frame=await(await p.locator('#runtime-container iframe').elementHandle()).contentFrame();await frame.waitForLoadState('domcontentloaded');return frame;}
async function install(item){await page.locator('.mobile-nav [data-view="discover"]').click();await card(page,item.repository).getByRole('button',{name:'Install',exact:true}).click();await page.locator('#dialog').getByRole('heading',{name:'Ready to install',exact:true}).waitFor();assert.equal(await page.locator('#dialog-body input').first().isVisible(),false);await page.getByRole('button',{name:'Install application',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('dialog').open);}
async function appCount(p){return p.evaluate(()=>new Promise(resolve=>{const req=indexedDB.open('sfhs-library-v1',1);req.onsuccess=()=>{const db=req.result,r=db.transaction('apps').objectStore('apps').count();r.onsuccess=()=>{db.close();resolve(r.result);};};}));}
try{
  await page.goto(base+'/#discover');
  const installButton=card(page,'gabrielecirulli/2048').getByRole('button',{name:'Install',exact:true});await installButton.waitFor();
  assert.equal(await page.locator('#discover-modes [data-mode="checked"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#discover-grid article').count(),4);assert.equal(await page.locator('#discover-find').getAttribute('open'),null);
  const buttonBox=await installButton.boundingBox(),nav=await page.locator('.mobile-nav').boundingBox();assert.ok(buttonBox.height>=44&&buttonBox.y+buttonBox.height<nav.y);
  const second=await card(page,'williamjussiau/timekeeper').boundingBox();assert.ok(second.y<nav.y);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  proof.cardHeights=await page.locator('#discover-grid article').evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.project,height:node.getBoundingClientRect().height})));
  await shot('checked-first-screen.png');check('phone opens to two real installable choices, compact cards and collapsed filters without GitHub API dependence');
  await install(CHECKED_APPS[0]);let frame=await open(page,'2048');await frame.locator('.tile').first().waitFor();await frame.locator('.game-container').click();for(const key of ['ArrowLeft','ArrowUp','ArrowRight','ArrowDown','ArrowLeft'])await page.keyboard.press(key);
  const board=await frame.evaluate(()=>JSON.parse(localStorage.getItem('gameState')));assert.ok(board.grid.cells.flat().filter(Boolean).length>=2);assert.equal(await page.locator('#runtime-container iframe').getAttribute('sandbox'),'allow-scripts');await page.locator('#runtime-close').click();
  check('real 2048 downloads checked immutable files, passes fresh analysis, installs, plays and saves in opaque isolation');
  await install(CHECKED_APPS[1]);frame=await open(page,'Timekeeper');await frame.locator('#tk-new-project').fill('My first kept app');await frame.locator('#tk-add-project-btn').click();await frame.getByText('My first kept app',{exact:true}).first().waitFor();await page.locator('#runtime-close').click();
  check('real Timekeeper installs from the checked shelf and creates a saved project');
  await page.locator('.mobile-nav [data-view="backups"]').click();const downloadEvent=page.waitForEvent('download');await page.locator('#export-library').click();const download=await downloadEvent;const backupPath=resolve(output,'checked-apps-backup.zip');await download.saveAs(backupPath);
  const archive=await readArchive(new Uint8Array(await readFile(backupPath)));assert.equal(archive.apps.length,2);
  for(const app of archive.apps){const item=CHECKED_APPS.find(item=>item.repository===app.versions[0].source.repository);const files=unzipSync(app.versions[0].original);for(const file of item.package.tree)assert.equal(hash(files[file.path]),file.sha256);assert.equal(hash(app.versions[0].original),app.versions[0].originalHash);}
  check('portable backup preserves every checked source file and original payload fingerprints');
  await page.locator('.mobile-nav [data-view="discover"]').click();await card(page,pete.repository).getByRole('button',{name:'Details',exact:true}).click();await page.getByRole('heading',{name:'Not compatible',exact:true}).waitFor();assert.match(await page.locator('.discover-verdict').textContent(),/creates JavaScript/);assert.equal(await page.locator('#dialog').getByRole('link',{name:'Play online (opens in a new tab)'}).getAttribute('href'),pete.homepage);assert.equal(await page.getByRole('button',{name:'Cancel',exact:true}).count(),0);await shot('pete-usable-alternative.png');
  const closed=page.locator('#dialog').evaluate(dialog=>new Promise(resolve=>dialog.addEventListener('close',resolve,{once:true})));
  await page.getByRole('button',{name:'Browse apps you can install',exact:true}).click();await closed;await page.waitForFunction(()=>!document.getElementById('dialog').open&&scrollY===0&&document.activeElement.closest('[data-project]')?.dataset.project==='github:gabrielecirulli/2048');
  check('actual Pete source still fails dynamic-code policy while its detail screen offers the checked online alternative and a specific reason');
  const webContext=await newContext(false,true),webPage=await webContext.newPage();await webPage.goto(base+'/#discover');await selectDiscoverSource(webPage,'github');await webPage.locator('#discover-query').fill('Mykonos');await webPage.locator('#discover-form button[type="submit"]').click();const dead=card(webPage,'boona13/mykonos-island-voxels');await dead.waitFor();
  const site=websiteCheck('https://mykonos-island-voxels.netlify.app/'),fresh=Date.now()-Date.parse(site.checkedAt)<7*86400000;
  if(site.status==='unavailable'&&fresh)assert.match(await dead.textContent(),new RegExp(`Website unavailable.*${site.httpStatus}`));
  assert.equal(await dead.getByRole('link',{name:/Play online/}).count(),site.status==='responding'&&fresh?1:0);
  await webPage.screenshot({path:resolve(output,'reported-dead-website.png')});proof.screenshots.push('reported-dead-website.png');await webContext.close();
  check('reported Mykonos 404 is visible and never promoted with a Play button');
  await page.waitForFunction(()=>navigator.serviceWorker.controller);await context.setOffline(true);await page.reload();frame=await open(page,'2048');await frame.locator('.tile').first().waitFor();assert.deepEqual(await frame.evaluate(()=>JSON.parse(localStorage.getItem('gameState'))),board);await page.locator('#runtime-close').click();frame=await open(page,'Timekeeper');await frame.getByText('My first kept app',{exact:true}).first().waitFor();await page.locator('#runtime-close').click();
  check('both newly installed real apps reopen with their saved state when all browser networking is disabled');
  const recovery=await newContext(),restored=await recovery.newPage();await restored.goto(base);await restored.waitForFunction(()=>navigator.serviceWorker.controller);await recovery.setOffline(true);await restored.locator('#restore-file').setInputFiles(backupPath);await restored.getByRole('button',{name:'Restore library',exact:true}).click();await restored.waitForFunction(()=>!document.getElementById('dialog').open);frame=await open(restored,'Timekeeper');await frame.getByText('My first kept app',{exact:true}).first().waitFor();await restored.locator('#runtime-close').click();frame=await open(restored,'2048');await frame.locator('.tile').first().waitFor();assert.deepEqual(await frame.evaluate(()=>JSON.parse(localStorage.getItem('gameState'))),board);await recovery.close();
  check('the checked-app backup restores into an empty library and both real apps recover their state offline');
  const corrupt=await newContext(true),bad=await corrupt.newPage();await bad.goto(base+'/#discover');await card(bad,'gabrielecirulli/2048').getByRole('button',{name:'Install',exact:true}).click();await bad.locator('#dialog-body').getByRole('alert').filter({hasText:'checked file changed'}).waitFor();assert.equal(await appCount(bad),0);await corrupt.close();check('a same-size modified source file is rejected before any local installation');
  assert.deepEqual(proof.pageErrors,[]);proof.result='PASS';
}catch(error){proof.result='FAIL';proof.error=error.stack;await shot('failure.png').catch(()=>{});throw error;}
finally{await writeFile(resolve(output,'proof.json'),JSON.stringify(proof,null,2));await browser.close();await new Promise(resolve=>server.close(resolve));}
