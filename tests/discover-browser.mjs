import {selectDiscoverSource,setDiscoverOpen,discoverOptions} from './discover-helpers.mjs';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve,extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { unzipSync,strFromU8 } from 'fflate';
import assert from 'node:assert/strict';
import { CAT,READY_HTML,responseFor } from './fixtures/discover-projects.mjs';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const output=resolve(root,'test-results',`discover-ux/run-${new Date().toISOString().replace(/[:.]/g,'-')}`);
await mkdir(output,{recursive:true});
const artifact=await readFile(resolve(root,'index.html'));
const proof={...JSON.parse(await readFile(resolve(root,'build-info.json'),'utf8')),physicalPhoneAcceptance:false,checks:[],screenshots:[],pageErrors:[]};
assert.equal(createHash('sha256').update(artifact).digest('hex'),proof.artifactSha256);
const baselinePath=resolve(root,'test-results/discover-ux/baseline/index.html');
const server=createServer(async(req,res)=>{
  try{const path=new URL(req.url,'http://local').pathname;
    if(path==='/baseline/'){res.setHeader('Content-Type','text/html');res.end(await readFile(baselinePath));return;}
    if(path==='/baseline/sw.js'){res.setHeader('Content-Type','text/javascript');res.end('self.addEventListener("install",()=>self.skipWaiting());');return;}
    const name=path==='/'?'index.html':path.slice(1);
    if(!['index.html','manifest.webmanifest','icon.svg','catalog.json','sw.js'].includes(name))throw 0;
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[extname(name)]);
    res.end(name==='index.html'?artifact:await readFile(resolve(root,name)));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.SFHS_BROWSER_EXECUTABLE?{executablePath:process.env.SFHS_BROWSER_EXECUTABLE}:{})});
async function newContext(){
  const context=await browser.newContext({viewport:{width:412,height:915},isMobile:true,hasTouch:true,deviceScaleFactor:1,reducedMotion:'reduce'});
  for(const host of ['api.github.com','raw.githubusercontent.com'])await context.route(`https://${host}/**`,async route=>{
    const response=responseFor(route.request().url());
    await route.fulfill({status:response?.status||200,headers:{'access-control-allow-origin':'*','access-control-expose-headers':'x-ratelimit-remaining,x-ratelimit-reset,x-ratelimit-limit,retry-after',...response?.headers},contentType:response?.text!==undefined?'text/plain':'application/json',body:response?.text??JSON.stringify(response?.body||{})});
  });
  await context.route(CAT.homepage,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>External website boundary test</title><p>Upstream site</p>'}));
  return context;
}
const context=await newContext(),page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>proof.pageErrors.push(error.message));
function check(name,condition=true){assert.ok(condition,name);proof.checks.push({name,result:'PASS'});console.log(`PASS ${name}`);}
async function shot(name){await page.screenshot({path:resolve(output,name),fullPage:true});proof.screenshots.push(name);}
const card=repo=>page.locator(`[data-project="github:${repo}"]`);
async function search(query){await page.locator('#discover-query').fill(query);await page.locator('#discover-form').getByRole('button',{name:'Search',exact:true}).click();await page.waitForFunction(()=>document.getElementById('discover-grid').getAttribute('aria-busy')==='false');}
async function database(){return page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('sfhs-library-v1',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,get=db.transaction('apps').objectStore('apps').getAll();get.onsuccess=()=>{db.close();resolve(get.result.map(app=>({...app,versions:app.versions.map(v=>({...v,original:Array.from(v.original)}))})));};};}));}
try{
  if(existsSync(baselinePath)){
    const oldContext=await newContext(),old=await oldContext.newPage();
    await old.goto(base+'/baseline/');await old.locator('.mobile-nav-item[data-view="discover"]').click();await selectDiscoverSource(old,'github');await old.locator('#discover-query').fill(CAT.full_name);await old.locator('#discover-form button[type="submit"]').click();
    await old.waitForFunction(()=>document.querySelectorAll('#discover-grid .app-card').length===1);
    proof.baselineCardHeight=(await old.locator('#discover-grid .app-card').boundingBox()).height;
    await old.screenshot({path:resolve(output,'before-phone.png'),fullPage:true});proof.screenshots.push('before-phone.png');await oldContext.close();
  }
  await page.goto(base);await page.locator('.mobile-nav-item[data-view="discover"]').click();await selectDiscoverSource(page,'github');await search(CAT.full_name);
  await card(CAT.full_name).getByRole('heading',{name:'Cat Paw Air Hockey',exact:true}).waitFor();
  assert.match(await card(CAT.full_name).textContent(),/Local two-player cat-paw air hockey for one shared phone/);
  assert.match(await card(CAT.full_name).textContent(),/Phone \/ touch indicated/);assert.match(await card(CAT.full_name).textContent(),/2 players/);
  const online=card(CAT.full_name).getByRole('link',{name:'Play online (opens in a new tab)',exact:true});assert.equal(await online.getAttribute('href'),CAT.homepage);assert.match(await online.getAttribute('rel'),/noopener/);
  assert.equal(await page.locator('#discover-grid .app-art').count(),0);
  proof.newCardHeight=(await card(CAT.full_name).boundingBox()).height;
  check('phone result explains Cat Paw with a small glyph, readable description, and evidence-based tags',proof.newCardHeight<360);
  if(proof.baselineCardHeight)check('normal result uses materially less phone space',proof.newCardHeight<proof.baselineCardHeight*.8);
  const onlineBox=await online.boundingBox(),navBox=await page.locator('.mobile-nav').boundingBox();assert.ok(onlineBox.y+onlineBox.height<=navBox.y);assert.ok(onlineBox.height>=44);assert.equal(await card(CAT.full_name).locator('.discover-description').evaluate(node=>getComputedStyle(node).fontSize),'14px');
  await shot('cat-paw-result-phone.png');
  const popupEvent=page.waitForEvent('popup');await online.click();const popup=await popupEvent;await popup.waitForLoadState();assert.equal(await popup.evaluate(()=>window.opener),null);await popup.close();
  assert.equal((await database()).length,0);assert.equal(await page.locator('#runtime-container iframe').count(),0);check('Play opens an external tab with no opener and creates no local installation');
  await card(CAT.full_name).getByRole('button',{name:'Details',exact:true}).click();await page.locator('#dialog').getByRole('heading',{name:'Source needs a build',exact:true}).waitFor();
  assert.equal(await page.locator('.discover-technical').getAttribute('open'),null);assert.equal(await page.getByText('External only',{exact:true}).count(),0);
  assert.match(await page.locator('#dialog-body').textContent(),/Not installed/);assert.match(await page.locator('#dialog-body').textContent(),/License unknown/);
  assert.equal(await page.locator('#dialog').getByRole('link',{name:'Play online (opens in a new tab)',exact:true}).count(),1);
  await shot('cat-paw-details-phone.png');
  await page.locator('#dialog').getByText('Technical details',{exact:true}).click();assert.match(await page.locator('.discover-technical').textContent(),/src\/index.html/);await shot('cat-paw-technical-phone.png');
  await page.locator('#dialog-close').click();await page.waitForFunction(()=>document.activeElement.textContent==='Details');check('Cat Paw keeps online use and source-build refusal separate; technical facts remain accessible and focus returns');
  await search('test-corpus');await shot('browse-phone.png');
  await discoverOptions(page);await page.locator('#discover-phone').check();await page.waitForFunction(()=>document.getElementById('discover-grid').getAttribute('aria-busy')==='false');
  const phoneCards=await page.locator('#discover-grid article').allTextContents();assert.ok(phoneCards.length>=2&&phoneCards.every(text=>text.includes('Phone / touch indicated')));check('browse chips filter metadata without claiming phone verification');
  await page.locator('#discover-phone').uncheck();await setDiscoverOpen(page,true);await page.waitForFunction(()=>document.querySelectorAll('#discover-grid article').length===1);assert.ok(await card('owner/ready-game').count());await setDiscoverOpen(page,false);
  await search('test-corpus');check('Open licenses only excludes unknown licenses');
  await card('owner/ready-game').getByRole('button',{name:'Check install',exact:true}).click();await page.locator('#dialog').getByRole('heading',{name:'Ready to install',exact:true}).waitFor();
  assert.equal(await page.locator('.discover-technical').getAttribute('open'),null);await shot('ready-install-phone.png');await page.getByRole('button',{name:'Install application',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('dialog').open);
  const installed=(await database())[0],version=installed.versions[0];assert.equal(strFromU8(unzipSync(new Uint8Array(version.original))['index.html']),READY_HTML);assert.equal(createHash('sha256').update(Buffer.from(version.original)).digest('hex'),version.originalHash);assert.equal(createHash('sha256').update(version.capsule).digest('hex'),version.executableHash);
  await page.locator('#library-grid').getByRole('button',{name:'Launch',exact:true}).click();const frame=page.frameLocator('#runtime-container iframe');await frame.locator('#add').click();assert.equal(await frame.locator('#score').textContent(),'1');assert.equal(await page.locator('#runtime-container iframe').getAttribute('sandbox'),'allow-scripts');await page.locator('#runtime-close').click();
  check('ready app reaches actual acquisition/analysis/install, preserves exact bytes and hashes, and launches isolated');
  await page.locator('.mobile-nav-item[data-view="discover"]').click();await card('owner/ready-game').getByRole('button',{name:'Launch local app',exact:true}).waitFor();check('returning to Discover refreshes the retained local-version action');await search('test-corpus');await card('owner/unsafe').getByRole('button',{name:'Check install',exact:true}).click();await page.locator('#dialog').getByRole('heading',{name:'Not compatible',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Install application',exact:true}).count(),0);assert.match(await page.locator('#dialog-body').textContent(),/Offline not verified/);assert.doesNotMatch(await page.locator('#dialog-body').textContent(),/Offline candidate/);
  await shot('not-compatible-phone.png');await page.locator('#dialog-close').click();assert.equal((await database()).length,1);check('unsupported app remains incompatible and uninstalled');
  await card('owner/multiple-builds').getByRole('button',{name:'Check install',exact:true}).click();await page.locator('#dialog').getByRole('heading',{name:'Ready to install',exact:true}).waitFor();await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await card('owner/multiple-builds').getByRole('button',{name:'Details',exact:true}).click();await page.locator('#dialog').getByText('Technical details',{exact:true}).click();await page.getByLabel('Browser package entry',{exact:true}).selectOption('index.html');
  await page.locator('#dialog').getByRole('heading',{name:'Install not checked',exact:true}).waitFor();await page.locator('#dialog').getByRole('button',{name:'Check install',exact:true}).click();await page.locator('#dialog').getByRole('heading',{name:'Ready to install',exact:true}).waitFor();await page.getByRole('button',{name:'Install application',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('dialog').open);
  const alternate=(await database()).find(app=>app.name==='Multiple Builds');assert.match(alternate.versions[0].capsule,/<title>Root Version A<\/title>/);check('changing the package entry invalidates previous analysis and acquires the newly selected bytes');
  await page.locator('.mobile-nav-item[data-view="discover"]').click();await search('test-corpus');
  assert.match(await card('owner/unsafe').textContent(),/Not compatible/);await card('owner/unsafe').getByRole('button',{name:'Details',exact:true}).click();await page.locator('#dialog').getByRole('heading',{name:'Not compatible',exact:true}).waitFor();await page.locator('#dialog').getByText('Technical details',{exact:true}).click();assert.match(await page.locator('.discover-technical').textContent(),/IndexedDB/i);await page.locator('#dialog-close').click();check('a rejected package stays negative with its exact reason after checking other apps');
  await card('owner/release-tool').getByRole('button',{name:'Details',exact:true}).click();await page.locator('#dialog').getByRole('heading',{name:'Source needs a build',exact:true}).waitFor();await page.getByRole('link',{name:'browser-app.zip (opens in a new tab)',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Install application',exact:true}).count(),0);await shot('download-import-phone.png');await page.locator('#dialog-close').click();check('release download has a normal download/import route and no false ready-install claim');
  assert.equal(await card('owner/no-link').getByRole('link',{name:/Play online|Use online/}).count(),0);await shot('mixed-results-phone.png');check('no homepage produces no invented online action');
  for(const width of [320,390,412,1440]){await page.setViewportSize({width,height:915});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const long=card('owner/a-very-long-project-name-that-needs-to-wrap-without-hiding-useful-actions-on-a-phone');const box=await long.boundingBox();assert.ok(box.height<440);await long.getByRole('button',{name:'Details',exact:true}).scrollIntoViewIfNeeded();await shot(`long-result-${width}.png`);}
  check('long names/descriptions, touch actions, and bottom navigation fit 320/390/412px plus desktop');
  await page.setViewportSize({width:412,height:915});await search('nothing');await page.getByRole('heading',{name:/No .*apps found/}).waitFor();await shot('no-results-phone.png');
  await search('rate');await page.locator('#discover-errors').getByText(/rate limit reached/).waitFor();await shot('rate-limit-phone.png');check('no-results and rate-limit states stay readable, with real errors prominent');
  await page.locator('#discover-query').fill('');await selectDiscoverSource(page,'itch');await page.locator('#discover-grid article').first().waitFor();
  assert.match(await page.locator('#discover-status').textContent(),/itch.io.*indexed/);assert.equal(await page.locator('.discover-source-details').getAttribute('open'),null);
  await shot('itch-results-phone.png');await page.locator('#discover-grid article').first().getByRole('button',{name:'Details',exact:true}).click();await page.locator('#dialog').getByRole('heading',{name:'Download then import',exact:true}).waitFor();assert.ok(await page.getByRole('button',{name:'Import a downloaded file',exact:true}).count());await shot('itch-details-phone.png');await page.locator('#dialog-close').click();check('itch results emphasize project information and creator route while retaining indexed-catalog truth');
  await page.waitForFunction(()=>document.activeElement.textContent==='Details');await page.keyboard.press('/');assert.equal(await page.locator('#discover-query').evaluate(node=>node===document.activeElement),true);check('keyboard search shortcut follows Discover');
  await context.setOffline(true);await setDiscoverOpen(page,true);await page.locator('#discover-errors').getByText(/Showing indexed/).waitFor();await shot('offline-phone.png');await context.setOffline(false);check('offline state is explicit while the indexed catalog stays usable');
  const unavailableContext=await newContext();await unavailableContext.route('https://api.github.com/repos/falloutmule/cat-paw-air-hockey',route=>route.fulfill({status:503,headers:{'access-control-allow-origin':'*'},body:'{}'}));
  const unavailable=await unavailableContext.newPage();await unavailable.goto(base);await unavailable.locator('.mobile-nav-item[data-view="discover"]').click();await selectDiscoverSource(unavailable,'github');await unavailable.locator(`[data-project="github:${CAT.full_name}"]`).getByRole('button',{name:'Details',exact:true}).click();await unavailable.locator('#dialog-body').getByRole('alert').waitFor();assert.equal(await unavailable.locator('#dialog').getByRole('link',{name:'Play online (opens in a new tab)',exact:true}).count(),1);await unavailable.screenshot({path:resolve(output,'source-unavailable-phone.png'),fullPage:true});proof.screenshots.push('source-unavailable-phone.png');await unavailableContext.close();check('unavailable source inspection stays prominent without removing a separately listed online version');
  check('no unexpected browser exceptions',proof.pageErrors.length===0);proof.result='PASS';
}catch(error){proof.result='FAIL';proof.error=error.stack;await shot('failure.png').catch(()=>{});throw error;}
finally{await writeFile(resolve(output,'proof.json'),JSON.stringify(proof,null,2));console.log(`Proof ${output}`);await browser.close();await new Promise(resolve=>server.close(resolve));}
