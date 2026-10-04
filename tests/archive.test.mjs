import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { exportArchive, readArchive, hashBytes, validSave } from '../src/archive.js';

async function specimen() {
  const original=strToU8('<!doctype html><title>Preserved bytes</title><p>Original</p>');
  const capsule='<!doctype html><title>Capsule</title><p>Executable</p>';
  const version={id:'version-a',label:'1.0',filename:'keep.html',acquiredAt:'2026-10-03T12:00:00.000Z',original,capsule,originalHash:await hashBytes(original),executableHash:await hashBytes(strToU8(capsule)),profile:'isolated-single-file',offline:'candidate',saveSupport:'supported',save:{localStorage:{score:'42'},bridge:null},source:{kind:'device',license:{kind:'unknown'}},warnings:[],reasons:[]};
  return {apps:[{id:'app-a',name:'Keep',description:'A real payload record',category:'Games',collections:['Favorites'],favorite:true,createdAt:version.acquiredAt,updatedAt:version.acquiredAt,lastLaunchedAt:null,launchCount:2,activeVersionId:version.id,versions:[version,{...version,id:'version-b',label:'2.0',save:{localStorage:{score:'64'},bridge:null}}]}],settings:{collections:['Favorites'],lastExportAt:null}};
}
test('portable backup reconstructs all exact version bytes, saves, and organization',async()=>{
  const source=await specimen(), bytes=await exportArchive(source), restored=await readArchive(bytes);
  assert.equal(restored.apps.length,1);
  const app=restored.apps[0];assert.equal(app.favorite,true);assert.deepEqual(app.collections,['Favorites']);assert.equal(app.versions.length,2);
  for(let i=0;i<2;i++){assert.deepEqual(app.versions[i].original,source.apps[0].versions[i].original);assert.equal(app.versions[i].capsule,source.apps[0].versions[i].capsule);assert.deepEqual(app.versions[i].save.localStorage, Object.assign(Object.create(null),source.apps[0].versions[i].save.localStorage));}
  assert.deepEqual(restored.settings.collections,['Favorites']);
});
test('tampered or missing payloads and unsupported manifests are rejected before restoration',async()=>{
  const bytes=await exportArchive(await specimen());
  const files=unzipSync(bytes);files['apps/app-a/version-a/original.bin']=strToU8('tampered');
  await assert.rejects(readArchive(zipSync(files)),/checksum/);
  delete files['apps/app-a/version-a/original.bin'];await assert.rejects(readArchive(zipSync(files)),/missing/);
  await assert.rejects(readArchive(zipSync({'manifest.json':strToU8('{"schema":100,"format":"sfhs-library","apps":[]}')})),/Unsupported/);
});
test('save data is bounded and prototype-like keys remain plain data',()=>{
  const save=validSave(JSON.parse('{"localStorage":{"__proto__":"42","constructor":"safe"},"bridge":null}'));
  assert.equal(Object.getPrototypeOf(save.localStorage),null);assert.equal(save.localStorage.__proto__,'42');
  assert.throws(()=>validSave({localStorage:{huge:'x'.repeat(6*1024*1024)}}),/limit/);
});
test('large collection lists and exact acquisition provenance survive restoration without truncation',async()=>{
  const source=await specimen();source.settings.collections=Array.from({length:150},(_,i)=>`Collection ${i}`);source.apps[0].collections=source.settings.collections;
  source.apps[0].versions[0].source.entry='game.html';source.apps[0].versions[0].source.acquisition='Exact repository file acquisition';
  const restored=await readArchive(await exportArchive(source));assert.deepEqual(restored.settings.collections,source.settings.collections);assert.deepEqual(restored.apps[0].collections,source.apps[0].collections);assert.equal(restored.apps[0].versions[0].source.entry,'game.html');assert.equal(restored.apps[0].versions[0].source.acquisition,'Exact repository file acquisition');
});
