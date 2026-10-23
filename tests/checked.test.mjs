import test from 'node:test';
import assert from 'node:assert/strict';
import {CHECKED_APPS,checkedPackageDetail,websiteCheck} from '../src/checked-catalog.js';
import {discoveryModel} from '../src/discover-model.js';
import {acquireGithub,searchDiscovery,resetDiscoveryCache} from '../src/discovery.js';

test('checked install choices pin every source file and keep compatibility separate from installation',()=>{
  const ready=CHECKED_APPS.filter(item=>item.package);
  assert.equal(ready.length,2);
  for(const item of ready){
    assert.match(item.commit,/^[a-f0-9]{40}$/);assert.equal(item.license.kind,'open');
    for(const file of item.package.tree){assert.match(file.sha256,/^[a-f0-9]{64}$/);assert.ok(file.size>0);}
    const model=discoveryModel(item);assert.equal(model.primary.label,'Install');assert.equal(model.install.state,'ready');assert.equal(model.localCopy,'not-installed');assert.notEqual(model.offline.state,'verified');assert.notEqual(model.phone.state,'verified');
    assert.equal(discoveryModel({...item,commit:'0'.repeat(40)}).install.state,'needs-check');
    assert.equal(discoveryModel({...item,selectedEntry:'another.html'}).install.state,'needs-check');
    assert.equal(discoveryModel(item,{analysis:{compatible:false,reasons:['Direct IndexedDB is not virtualized']}}).install.state,'incompatible');
  }
});
test('reported dead Mykonos site is unavailable, never an advertised Play action',()=>{
  const check=websiteCheck('https://mykonos-island-voxels.netlify.app/'),previous={...check};
  Object.assign(check,{status:'unavailable',httpStatus:404,checkedAt:new Date().toISOString()});
  try{
  const model=discoveryModel({title:'Mykonos Island Voxels',source:'github',repository:'boona13/mykonos-island-voxels',description:'A browser-based island builder game.',homepage:'https://mykonos-island-voxels.netlify.app'});
  assert.equal(model.online.state,'unavailable');assert.equal(model.online.check.httpStatus,404);assert.equal(model.capabilities.online,'no');assert.notEqual(model.primary.type,'online');assert.notEqual(model.primary.url,model.online.url);
  }finally{Object.assign(check,previous);}
});
test('old website checks expire rather than promising continued availability',()=>{
  const item=CHECKED_APPS.find(item=>item.repository==='falloutmule/cat-paw-air-hockey');
  const check=websiteCheck(item.homepage),now=Date.now;
  Date.now=()=>Date.parse(check.checkedAt)+8*86400000;
  try{const model=discoveryModel(item);assert.equal(model.online.state,'unverified');assert.notEqual(model.primary.type,'online');assert.equal(model.capabilities.online,'unknown');}finally{Date.now=now;}
});
test('arbitrary homepage metadata is not proof of a working online application',()=>{
  const model=discoveryModel({title:'Unknown game',source:'github',homepage:'https://unverified.example/game',description:'A mobile game',hasPages:true});
  assert.equal(model.online.state,'unverified');assert.equal(model.capabilities.online,'unknown');assert.notEqual(model.primary.type,'online');
});
test('Pete retains runtime-code refusal with a specific reason and its independently checked Pages option',()=>{
  const item=CHECKED_APPS.find(item=>item.repository==='falloutmule/pete-hegseths-drunken-space-force');
  const model=discoveryModel(item);
  assert.equal(model.install.state,'incompatible');assert.match(model.install.summary,/creates JavaScript/);assert.equal(model.primary.type,'online');assert.equal(model.primary.url,item.homepage);assert.equal(model.licenseLabel,'License unknown');
});
test('checked file tampering is refused even when the downloaded size is unchanged',async()=>{
  const item=CHECKED_APPS.find(item=>item.repository==='williamjussiau/timekeeper');
  const original=globalThis.fetch;
  globalThis.fetch=async()=>new Response(new Uint8Array(item.package.tree[0].size));
  try{await assert.rejects(acquireGithub(item,checkedPackageDetail(item)),/checked file changed/);}finally{globalThis.fetch=original;}
});
test('verified Pete Pages metadata is available in public search without an authenticated Pages request',async()=>{
  const original=globalThis.fetch;resetDiscoveryCache();
  globalThis.fetch=async()=>new Response(JSON.stringify({full_name:'falloutmule/pete-hegseths-drunken-space-force',name:'pete-hegseths-drunken-space-force',description:'Portrait arcade game',has_pages:true,homepage:null}));
  try{const result=await searchDiscovery({query:'falloutmule/pete-hegseths-drunken-space-force',source:'github'});assert.equal(discoveryModel(result.items[0]).primary.url,'https://falloutmule.github.io/pete-hegseths-drunken-space-force/');}finally{globalThis.fetch=original;resetDiscoveryCache();}
});
