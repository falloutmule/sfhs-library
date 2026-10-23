import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryModel, matchesBrowse, readmeSummary, onlineVersion } from '../src/discover-model.js';
import { inspectGithub, acquireGithub, searchDiscovery, resetDiscoveryCache } from '../src/discovery.js';
import { CAT, PROJECTS, responseFor } from './fixtures/discover-projects.mjs';
const item=metadata=>({title:metadata.name,repository:metadata.full_name,source:'github',sourceUrl:`https://github.com/${metadata.full_name}`,description:metadata.description,tags:metadata.topics,hasPages:metadata.has_pages,homepage:metadata.homepage,license:{kind:'unknown'}});
async function withAPI(fn){const saved=globalThis.fetch;resetDiscoveryCache();globalThis.fetch=async url=>{const r=responseFor(url);if(!r)throw new Error(`Unexpected URL ${url}`);return r.text!==undefined?new Response(r.text,{status:r.status||200}):Response.json(r.body,{status:r.status||200,headers:r.headers});};try{await fn();}finally{globalThis.fetch=saved;resetDiscoveryCache();}}

test('Cat Paw describes the real phone game and keeps Pages separate from source needing a build',async()=>withAPI(async()=>{
  const detail=await inspectGithub(item(CAT)),model=discoveryModel(detail);
  assert.equal(model.title,'Cat Paw Air Hockey');assert.equal(model.description,CAT.description);
  assert.equal(model.primary.label,'Play online');assert.equal(model.online.url,CAT.homepage);
  assert.equal(model.install.state,'source-build');assert.equal(model.capabilities.install,'no');
  assert.equal(model.capabilities.online,'yes');assert.equal(model.capabilities.openLicense,'unknown');
  assert.equal(model.phone.state,'indicated');assert.equal(model.offline.state,'unknown');
  assert.ok(model.signals.tags.includes('2 players'));assert.equal(detail.entryCandidates[0].status,'needs-build');
  await assert.rejects(acquireGithub(item(CAT),detail),/needs a build/);
}));
test('no homepage or Pages flag without an actual URL creates no fake play action',()=>{
  for(const homepage of [null,'http://example.com','javascript:alert(1)','https://user:secret@example.com','https://github.com/owner/source','https://example.com/docs/']){
    const model=discoveryModel({...item(CAT),homepage});assert.equal(model.online,null);assert.notEqual(model.primary.type,'online');
  }
  assert.equal(onlineVersion({...item(CAT),homepage:null,hasPages:true}),null);
});
test('metadata phone/offline claims never become verified',()=>{
  const base={...item(CAT),description:'Offline mobile phone game',phoneVerified:true,offline:'verified'};
  const model=discoveryModel(base);assert.equal(model.phone.state,'indicated');assert.equal(model.offline.state,'unknown');
  assert.equal(discoveryModel(base,{analysis:{compatible:true,offline:'candidate'}}).offline.state,'candidate');
  assert.equal(discoveryModel(base,{analysis:{compatible:true,offline:'network'}}).offline.state,'network');
  assert.equal(discoveryModel(base,{analysis:{compatible:true,offline:'verified'}}).offline.state,'unknown');
});
test('an installed version remains separate from current upstream compatibility and keeps its own offline class',()=>{
  const installed={activeVersionId:'v1',versions:[{id:'v1',offline:'candidate',source:{version:'older-commit'}}]};
  const data={...item(CAT),inspected:true,installable:false,sourceNeedsBuild:true};
  const model=discoveryModel(data,{installed});assert.equal(model.install.state,'source-build');assert.equal(model.capabilities.install,'no');assert.equal(model.localCopy,'installed');assert.equal(model.primary.type,'launch');assert.equal(model.offline.state,'candidate');
  assert.equal(discoveryModel(data,{installed,analysis:{compatible:false,reasons:['Required unsupported API']}}).install.state,'incompatible');
});
test('static entry is only a candidate until actual analysis, and a negative result stays negative',async()=>withAPI(async()=>{
  const detail=await inspectGithub({repository:'owner/ready-game'});
  assert.equal(detail.installable,true);assert.equal(discoveryModel(detail).install.state,'needs-check');
  assert.equal(discoveryModel(detail,{analysis:{compatible:true,offline:'candidate'}}).install.state,'ready');
  const negative=discoveryModel(detail,{analysis:{compatible:false,offline:'unknown'}});
  assert.equal(negative.install.state,'incompatible');assert.equal(negative.capabilities.install,'no');
  assert.equal(negative.primary.type,'details');
}));
test('release HTML/ZIP download is distinct from locally installable bytes',async()=>withAPI(async()=>{
  const detail=await inspectGithub({repository:'owner/release-tool'}),model=discoveryModel(detail);
  assert.equal(model.downloads.length,1);assert.equal(model.primary.type,'download');assert.equal(model.install.state,'source-build');
  assert.equal(model.capabilities.install,'no');assert.equal(model.capabilities.downloadImport,'yes');
  detail.releases[0].assets[0].url='https://evil.test/browser-app.zip';assert.equal(discoveryModel(detail).downloads.length,0);
}));
test('browse classifications use supplied metadata; unknown stays unknown',()=>{
  assert.equal(matchesBrowse(item(CAT),'games'),true);assert.equal(matchesBrowse(item(CAT),'phone'),true);assert.equal(matchesBrowse(item(CAT),'maker'),false);
  assert.equal(matchesBrowse({title:'Mystery',description:'',tags:[],source:'github'},'tools'),false);
  assert.equal(matchesBrowse({title:'CAD modeler',description:'A parametric CAD editor',tags:[]},'maker'),true);
  assert.equal(matchesBrowse({title:'Timer',description:'Offline focus timer'},'offline'),true);
});
test('README summaries are source-grounded fallbacks rather than invented descriptions',async()=>withAPI(async()=>{
  const detail=await inspectGithub({repository:'owner/readme-tool'}),model=discoveryModel(detail);
  assert.equal(model.description,'A small browser timer that helps people plan focused work sessions.');
  assert.match(discoveryModel({title:'mystery',source:'github'}).description,/No description provided/);
  assert.equal(readmeSummary('# Name\n\n```js\nmalicious()\n```\n\nA useful browser app with an explicit description.'),'A useful browser app with an explicit description.');
}));
test('browse search keeps unknown-license projects excluded under the open filter and exposes compact errors',async()=>withAPI(async()=>{
  const games=await searchDiscovery({source:'github',category:'games'});assert.ok(games.items.some(item=>item.repository===CAT.full_name));
  const open=await searchDiscovery({source:'github',category:'games',openOnly:true});assert.deepEqual(open.items.map(item=>item.repository),['owner/ready-game']);
  const rate=await searchDiscovery({source:'github',query:'rate'});assert.equal(rate.errors[0].code,'rate-limit');assert.match(rate.status,/rate limit/);assert.ok(rate.summary.length<=2);
}));
test('inspection checks built directories independently of a development entry',async()=>{
  const saved=globalThis.fetch,project=PROJECTS.find(x=>x.metadata.name==='source-only');
  const originalFiles=project.files;project.files={'index.html':originalFiles['index.html'],'dist/index.html':'<!doctype html><title>Built drawing app</title><p>Ready build</p>'};
  try{await withAPI(async()=>{const detail=await inspectGithub({repository:'owner/source-only'});assert.equal(detail.installable,true);assert.equal(detail.recommendedEntry,'dist/index.html');assert.equal(detail.entryCandidates.find(x=>x.path==='index.html').status,'needs-build');});}finally{project.files=originalFiles;globalThis.fetch=saved;}
});
