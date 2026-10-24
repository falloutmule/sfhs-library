import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DEFAULT_FILTERS,filterItems,filterLabels,sortItems,shelves,storeItems,classifyProject,popularityLabel,feedRank,offlineState,availableSorts} from '../src/storefront.js';
import {discoveryModel} from '../src/discover-model.js';
import {parseFeed,FEEDS,CATALOG_CAP} from '../tools/update-catalog.mjs';
const app=(id,categories,tags=[],kind='open',source='github')=>({id,title:id,description:'A browser application',source,categories,tags,license:{kind}});
const fixtures=[app('phone-game',['games'],['touch']),app('unknown-game',['games'],['touch'],'unknown'),app('desktop-game',['games']),app('phone-tool',['tools'],['phone']),app('cad',['maker']),app('itch-phone',['games'],['mobile'],'unknown','itch')];fixtures[0].analysis={compatible:true,offline:'candidate'};fixtures[2].analysis={compatible:true,offline:'candidate'};
const ids=f=>filterItems(fixtures,{...DEFAULT_FILTERS(),...f}).map(i=>i.id);
for(const [name,f,expected]of [
 ['Games',{types:['games']},['phone-game','unknown-game','desktop-game','itch-phone']],
 ['Phone',{phone:true},['phone-game','unknown-game','phone-tool','itch-phone']],
 ['Games + Phone',{types:['games'],phone:true},['phone-game','unknown-game','itch-phone']],
 ['Games + Phone + Open',{types:['games'],phone:true,open:true},['phone-game']],
 ['Games + Offline',{types:['games'],offline:true},['phone-game','desktop-game']],
 ['Games + Phone + Offline',{types:['games'],phone:true,offline:true},['phone-game']],
 ['Tools + Phone',{types:['tools'],phone:true},['phone-tool']],
 ['Maker + Open',{types:['maker'],open:true},['cad']],
 ['itch + Games + Phone',{source:'itch',types:['games'],phone:true},['itch-phone']],
 ['GitHub + Tools + Open',{source:'github',types:['tools'],open:true},['phone-tool']],
 ['Clear all',{},fixtures.map(i=>i.id)]])test(`intersection: ${name}`,()=>assert.deepEqual(ids(f),expected));
test('filter summary retains independent dimensions',()=>assert.deepEqual(filterLabels({...DEFAULT_FILTERS(),types:['games'],phone:true,open:true}),['Games','Phone / Touch','Open source']));
test('offline words alone never qualify; metadata never verifies phone or offline',()=>{const i=app('offline game',['games'],['mobile','offline']);assert.equal(offlineState(i),'unknown');assert.equal(filterItems([i],{...DEFAULT_FILTERS(),offline:true}).length,0);assert.equal(discoveryModel(i).phone.state,'indicated');assert.notEqual(discoveryModel(i).offline.state,'verified');});
const native=(id,rank,order)=>({...app(id,['games'],[],'unknown','itch'),feeds:[{id:order,rank,order,label:order,url:'https://itch.io/games/html5.xml'}]});
test('itch Top Rated and Popular preserve native rank despite licensing or titles',()=>{for(const sort of ['top-rated','popular','new-popular']){const a=native('Z',1,sort),b={...native('A',2,sort),license:{kind:'open'},stars:999999};assert.deepEqual(sortItems([b,a],sort).map(i=>i.title),['Z','A']);}});
test('GitHub Popular uses actual stars and never calls them a rating',()=>{const a={...fixtures[0],stars:12500},b={...fixtures[3],stars:42};assert.equal(sortItems([b,a],'popular')[0],a);assert.match(popularityLabel(a),/12.5K ★ on GitHub/i);assert.doesNotMatch(popularityLabel(a),/rating/i);});
test('rating and count require actual itch source review data',()=>{const i=native('Game',1,'top-rated');assert.doesNotMatch(popularityLabel(i),/★|ratings/);assert.equal(popularityLabel({...i,rating:{source:'itch',value:4.8,scale:5}}),'★ 4.8 · itch.io');assert.equal(popularityLabel({...i,rating:{source:'itch',value:4.8,count:1200,scale:5}}),'★ 4.8 · 1,200 ratings · itch.io');assert.doesNotMatch(popularityLabel({...i,rating:{source:'github',value:5,scale:5}}),/★/);});
test('app classification ranks applications above Framework7 and F2; explicit searches retain them',()=>{
 const framework={...app('Framework7',[],['framework','mobile']),description:'Full featured HTML framework for building iOS & Android apps',stars:18000},chart={...app('F2',[],['charting-library']),description:'An elegant, interactive and flexible charting library for mobile',stars:8000};
 const game={...app('Game',['games']),description:'A browser puzzle game',stars:1},tool={...app('Paint',['tools','creative']),description:'An image editor application',stars:2};
 assert.equal(classifyProject(framework),'developer');assert.equal(classifyProject(chart),'developer');assert.equal(classifyProject(game),'game');assert.equal(classifyProject(tool),'application');assert.deepEqual(sortItems([framework,chart,game,tool]).slice(0,2).map(i=>i.id).sort(),['Game','Paint']);assert.equal(filterItems([framework,tool],DEFAULT_FILTERS(),'Framework7')[0],framework);
 assert.notEqual(classifyProject({...app('Book Library',['tools']),description:'A library management application for readers'}),'developer');
});
test('real catalogs populate phone, native rating, open apps, tools and maker shelves without frameworks',async()=>{
 const actual=shelves();for(const id of ['phone','rated','open','tools','maker'])assert.ok(actual.find(s=>s.id===id)?.items.length>=2,id);
 const phone=actual.find(s=>s.id==='phone');assert.ok(phone.items.every(i=>Number.isFinite(feedRank(i,'top-rated',{phone:true}))));assert.ok(phone.items.every(i=>i.license.kind==='unknown'));
 assert.ok(actual.find(s=>s.id==='open').items.some(i=>i.repository==='excalidraw/excalidraw'));
 const cat=storeItems().find(i=>i.repository==='falloutmule/cat-paw-air-hockey'),m=discoveryModel({...cat,inspected:true,sourceNeedsBuild:true,installable:false});assert.equal(m.primary.type,'online');assert.equal(m.install.state,'source-build');assert.equal(m.licenseLabel,'License unknown');assert.equal(m.phone.state,'indicated');
 const catalog=JSON.parse(await readFile(new URL('../public/catalog.json',import.meta.url)));assert.ok(catalog.items.length<=CATALOG_CAP);assert.ok(catalog.items.length>=100);for(const i of catalog.items){assert.equal(i.rating,undefined);assert.ok(i.feeds?.length);for(const f of i.feeds)assert.ok(f.rank>0&&f.url.startsWith('https://itch.io/'));}
});
test('shelves fail gracefully with insufficient source data; unavailable sort is absent',()=>{assert.deepEqual(shelves([]),[]);assert.equal(shelves([fixtures[0]]).length,0);assert.deepEqual(availableSorts([fixtures[0]]),[['recommended','Recommended']]);});
test('feed parsing retains source rank, phone provenance and real dates without inventing license or rating',()=>{const i=parseFeed('<rss><item><title>Game [Free] [Puzzle]</title><plainTitle>Game</plainTitle><link>https://creator.itch.io/game</link><description>A puzzle.</description><createDate>2025-01-01</createDate><updateDate>2026-10-20</updateDate></item></rss>',FEEDS.find(f=>f.id==='phone-rated'))[0];assert.equal(i.feeds[0].rank,1);assert.equal(i.feeds[0].phone,true);assert.equal(i.createdAt,'2025-01-01T00:00:00.000Z');assert.equal(i.updatedAt,'2026-10-20T00:00:00.000Z');assert.equal(i.license.kind,'unknown');assert.equal(i.rating,undefined);});

test('real Framework7/F2 observations remain developer results while actual browser apps lead recommendations',async()=>{const real=JSON.parse(await readFile(new URL('./fixtures/storefront-repositories.json',import.meta.url)));for(const i of real)assert.equal(classifyProject(i),'developer',i.repository);const apps=storeItems().filter(i=>['excalidraw/excalidraw','gabrielecirulli/2048'].includes(i.repository));const ranked=sortItems([...real,...apps]);assert.ok(ranked.slice(0,2).every(i=>apps.includes(i)));assert.equal(filterItems(real,DEFAULT_FILTERS(),'framework7')[0].repository,'framework7io/framework7');});

test('GitHub metadata refresh preserves exact last-good bytes on total failure',async()=>{
 const {updateGithub}=await import('../tools/update-github-catalog.mjs');const {mkdtemp,writeFile}=await import('node:fs/promises');const {join}=await import('node:path');const dir=await mkdtemp(new URL('../test-results/github-index-',import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/,'')),output=join(dir,'github.json');const before=JSON.stringify({items:[{id:'github:excalidraw/excalidraw',repository:'excalidraw/excalidraw'}],updatedAt:'2025-01-01'});await writeFile(output,before);const result=await updateGithub({output,fetcher:async()=>new Response('',{status:429})});assert.equal(result.retained,true);assert.equal(await readFile(output,'utf8'),before);
});
test('website observations cannot grant installability and expire honestly',()=>{const i={...app('Drawing',['creative']),hasPages:true,homepage:'https://drawing.example.test/',websiteCheck:{url:'https://drawing.example.test/',status:'responding',httpStatus:200,checkedAt:new Date().toISOString()}};const m=discoveryModel(i);assert.equal(m.primary.type,'online');assert.equal(m.install.state,'needs-check');assert.equal(m.localCopy,'not-installed');assert.equal(discoveryModel({...i,websiteCheck:{...i.websiteCheck,checkedAt:'2020-01-01'}}).capabilities.online,'unknown');assert.equal(discoveryModel({...i,websiteCheck:{...i.websiteCheck,status:'unavailable',httpStatus:404}}).capabilities.online,'no');});
