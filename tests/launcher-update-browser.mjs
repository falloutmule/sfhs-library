import {selectDiscoverSource,setDiscoverOpen} from './discover-helpers.mjs';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve,extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { responseFor,CAT } from './fixtures/discover-projects.mjs';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const output=resolve(root,`test-results/launcher-update/run-${new Date().toISOString().replace(/[:.]/g,'-')}`);
await mkdir(output,{recursive:true});
const html=await readFile(resolve(root,'index.html'),'utf8');
const info=JSON.parse(await readFile(resolve(root,'build-info.json'),'utf8'));
const proof={...info,physicalPhoneAcceptance:false,checks:[],screenshots:[],pageErrors:[]};
const prefix='/sfhs-library/';
let mode='current',releaseNumber=0,releaseUnavailable=false;
const releaseBuild=()=>[info.buildId,'fixture-next-release','fixture-third-release','fixture-fourth-release'][releaseNumber];
const oldCache='sfhs-0123456789abcdef';
// The original deployed worker's cache-first + ignoreSearch behavior. Keep the
// regression independent of Git history and shallow CI checkout depth.
const oldWorker=`const CACHE='${oldCache}';const FILES=['./','./index.html','./manifest.webmanifest','./icon.svg','./catalog.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin)return;const url=new URL(e.request.url);if(!FILES.some(p=>new URL(p,self.registration.scope).pathname===url.pathname))return;e.respondWith(caches.open(CACHE).then(async c=>(await c.match(e.request,{ignoreSearch:true}))||fetch(e.request)))});`;
const server=createServer(async(req,res)=>{
  try {
    const path=new URL(req.url,'http://local').pathname;
    if(!path.startsWith(prefix))throw 0;
    const name=path.slice(prefix.length)||'index.html';
    if(!['index.html','start.html','sw.js','release.json','catalog.json','icon.svg','manifest.webmanifest'].includes(name))throw 0;
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[extname(name)]);
    if(name==='release.json') {
      if(releaseUnavailable){res.writeHead(503);res.end();return;}
      res.end(JSON.stringify({...info,buildId:releaseBuild(),commit:'a'.repeat(40)}));return;
    }
    if(mode==='legacy' && name==='sw.js'){res.end(oldWorker);return;}
    if(mode==='legacy' && name==='index.html'){res.end('<!doctype html><title>Old cached Library</title><h1>Inspect payload · External only</h1>');return;}
    if(name==='index.html'||name==='start.html'){res.end(html.replaceAll(info.buildId,releaseBuild()));return;}
    res.end(await readFile(resolve(root,name)));
  } catch {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,base=origin+prefix;
const browser=await chromium.launch({headless:true,...(process.env.SFHS_BROWSER_EXECUTABLE?{executablePath:process.env.SFHS_BROWSER_EXECUTABLE}:{})});
const context=await browser.newContext({viewport:{width:412,height:915},isMobile:true,hasTouch:true,reducedMotion:'reduce',acceptDownloads:true});
for(const host of ['api.github.com','raw.githubusercontent.com'])await context.route(`https://${host}/**`,async route=>{
  const response=responseFor(route.request().url());
  await route.fulfill({status:response?.status||200,headers:{'access-control-allow-origin':'*',...response?.headers},contentType:response?.text!==undefined?'text/plain':'application/json',body:response?.text??JSON.stringify(response?.body||{})});
});
await context.route(CAT.homepage,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Upstream game</title><p>External game</p>'}));
const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>proof.pageErrors.push(error.message));
const check=name=>{proof.checks.push({name,result:'PASS'});console.log('PASS '+name);};
async function shot(name){await page.screenshot({path:resolve(output,name)});proof.screenshots.push(name);}
async function snapshot(){return page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('sfhs-library-v1',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,get=db.transaction('apps').objectStore('apps').getAll();get.onsuccess=()=>{db.close();resolve(get.result.map(app=>({...app,versions:app.versions.map(v=>({...v,original:Array.from(v.original)}))})));};};}));}
async function launch(){await page.locator('.mobile-nav [data-view="library"]').click();await page.locator('#library-grid').getByRole('button',{name:'Launch',exact:true}).click();return page.frameLocator('#runtime-container iframe');}
try {
  await page.goto(base);
  await page.getByRole('heading',{name:'Your collection starts here.'}).waitFor();
  await page.getByRole('button',{name:'Find an app',exact:true}).click();await selectDiscoverSource(page,'checked');
  await page.locator('[data-project="github:gabrielecirulli/2048"]').getByRole('button',{name:'Install',exact:true}).waitFor();
  check('empty Library leads to checked install choices instead of requiring a file import');
  const counter='<!doctype html><title>Kept Counter</title><button id="add">Add</button><output id="count"></output><script>let n=Number(localStorage.getItem("n")||0);const out=document.getElementById("count");out.textContent=n;document.getElementById("add").addEventListener("click",()=>{out.textContent=++n;localStorage.setItem("n",n)})</script>';
  await page.locator('#import-file').setInputFiles({name:'kept-counter.html',mimeType:'text/html',buffer:Buffer.from(counter)});
  await page.getByRole('button',{name:'Install application',exact:true}).click();
  await page.waitForFunction(()=>!document.getElementById('dialog').open);
  const frame=await launch();await frame.locator('#add').click();await frame.locator('#add').click();
  await page.locator('#runtime-close').click();await page.locator('#runtime').waitFor({state:'hidden'});
  const before=await snapshot();
  await page.waitForFunction(()=>navigator.serviceWorker.controller);
  mode='legacy';
  await page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration();await reg.update();});
  await page.waitForFunction(async()=>{const reg=await navigator.serviceWorker.getRegistration();return !reg.installing && !reg.waiting && (await caches.keys()).includes('sfhs-0123456789abcdef');});
  await page.reload();await page.getByRole('heading',{name:'Inspect payload · External only'}).waitFor();
  await page.evaluate(async()=>{
    await (await caches.open('unrelated-site-cache')).put('/other-app/index.html',new Response('unrelated'));
    await (await caches.open('sfhs-fedcba9876543210')).put('/other-app/index.html',new Response('legacy sibling'));
    await (await caches.open('sfhs-launcher:/other-app/:test')).put('/other-app/index.html',new Response('scoped sibling'));
  });
  mode='current';
  await page.goto(base+'?new-build=1');await page.getByRole('heading',{name:'Inspect payload · External only'}).waitFor();
  check('regression reproduces old shell remaining stale even after deployment and query changes');
  await page.goto(base+'start.html#discover');await selectDiscoverSource(page,'checked');
  const cat=page.locator(`[data-project="github:${CAT.full_name}"]`);
  const play=cat.getByRole('link',{name:'Play online (opens in a new tab)'});
  await play.waitFor();assert.equal(await play.getAttribute('href'),CAT.homepage);
  assert.deepEqual(await snapshot(),before);
  check('distinct start path reaches the new launcher under the old worker with exact app records, original bytes, and saves intact');
  await page.locator('[data-project="github:gabrielecirulli/2048"]').scrollIntoViewIfNeeded();const box=await page.locator('[data-project="github:gabrielecirulli/2048"]').getByRole('button',{name:'Install',exact:true}).boundingBox(),nav=await page.locator('.mobile-nav').boundingBox();
  assert.ok(box.height>=44 && box.y+box.height<nav.y);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await shot('updated-first-step-phone.png');
  check('phone first step has a visible touch-sized Install button and explains online versus kept copies');
  const popupEvent=page.waitForEvent('popup');await play.click();const popup=await popupEvent;await popup.waitForLoadState();assert.equal(await popup.evaluate(()=>window.opener),null);await popup.close();
  assert.deepEqual(await snapshot(),before);check('starter Play uses a separate browser context and does not install or alter a local app');
  await cat.getByRole('button',{name:'Details',exact:true}).click();
  await page.getByRole('heading',{name:'Source needs a build',exact:true}).waitFor();
  assert.match(await page.locator('#dialog-body').textContent(),/License unknown/);
  await page.locator('#dialog-close').click();
  check('starter Details retains Cat Paw source-build refusal and unknown license');
  await setDiscoverOpen(page,true);await cat.waitFor({state:'hidden'});await setDiscoverOpen(page,false);
  await selectDiscoverSource(page,'itch');await cat.waitFor({state:'hidden'});
  check('starter respects Open licenses only and source selection');
  await page.waitForFunction(async()=> !(await caches.keys()).includes('sfhs-0123456789abcdef'));
  const keys=await page.evaluate(()=>caches.keys());
  assert.ok(keys.includes('unrelated-site-cache') && keys.includes('sfhs-fedcba9876543210') && keys.includes('sfhs-launcher:/other-app/:test'));
  check('worker migrates only its own old shell cache and preserves sibling Pages caches');
  await context.setOffline(true);await page.goto(base);
  const offlineFrame=await launch();assert.equal(await offlineFrame.locator('#count').textContent(),'2');
  await page.locator('#runtime-close').click();
  check('updated worker retains offline launcher and a real installed app still restores its managed save');
  await page.locator('.mobile-nav [data-view="settings"]').click();await page.locator('#check-launcher-update').click();
  await page.getByText('You’re offline. Reconnect to check for a Library update.',{exact:true}).waitFor();
  check('update failure is understandable offline without removing the current library');
  await context.setOffline(false);releaseUnavailable=true;
  await page.locator('#check-launcher-update').click();
  await page.locator('#launcher-update-status').filter({hasText:'Couldn’t check'}).waitFor();
  releaseUnavailable=false;releaseNumber=1;
  await page.locator('#check-launcher-update').click();await page.locator('#launcher-update').waitFor();
  assert.equal(await page.locator('#launcher-update a').getAttribute('href'),'./start.html#discover');
  check('a new deployment produces an explicit update action instead of silent cached-build small print');
  await shot('update-ready-phone.png');
  await page.locator('#launcher-update a').click();
  await play.waitFor();await page.waitForFunction(()=>document.getElementById('build-id').textContent.startsWith('fixture-next-release'));
  assert.equal(new URL(page.url()).pathname,prefix+'start.html');
  assert.equal(await page.locator('#launcher-update').isVisible(),false);
  check('network-first worker serves a later shell on user navigation without forcing a running tab to reload');
  releaseNumber=2;
  await page.locator('.mobile-nav [data-view="settings"]').click();assert.equal(new URL(page.url()).hash,'#settings');
  await page.locator('#check-launcher-update').click();await page.locator('#launcher-update').waitFor();
  await page.locator('#launcher-update a').click();
  await page.waitForFunction(()=>document.getElementById('build-id').textContent.startsWith('fixture-third-release'));
  assert.equal(page.url(),base+'start.html#discover');
  check('update from Settings reloads the document even when only the URL fragment changes');
  releaseNumber=3;
  await page.locator('.mobile-nav [data-view="settings"]').click();
  await page.locator('#check-launcher-update').click();await page.locator('#launcher-update').waitFor();
  await page.locator('.mobile-nav [data-view="discover"]').click();assert.equal(page.url(),base+'start.html#discover');
  await page.locator('#launcher-update a').click();
  await page.waitForFunction(()=>document.getElementById('build-id').textContent.startsWith('fixture-fourth-release'));
  check('update also reloads the document when its link equals the exact current URL');
  assert.equal(proof.pageErrors.length,0);check('no launcher exceptions');proof.result='PASS';
} catch(error){proof.result='FAIL';proof.error=error.stack;await shot('failure.png').catch(()=>{});throw error;}
finally{await writeFile(resolve(output,'proof.json'),JSON.stringify(proof,null,2));await browser.close();await new Promise(resolve=>server.close(resolve));}
