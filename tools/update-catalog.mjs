import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
export const FEEDS=[
 {id:'popular',label:'Popular HTML5',order:'popular',url:'https://itch.io/games/html5.xml'},
 {id:'top-rated',label:'Top rated HTML5',order:'top-rated',url:'https://itch.io/games/top-rated/html5.xml'},
 {id:'new-popular',label:'New & popular HTML5',order:'new-popular',url:'https://itch.io/games/new-and-popular/html5.xml'},
 {id:'newest',label:'Newest HTML5',order:'newest',url:'https://itch.io/games/newest/html5.xml'},
 {id:'phone-rated',label:'Top rated mobile HTML5',order:'top-rated',phone:true,url:'https://itch.io/games/top-rated/html5/tag-mobile.xml'},
 {id:'phone-popular',label:'Popular mobile HTML5',order:'popular',phone:true,url:'https://itch.io/games/html5/tag-mobile.xml'},
 {id:'touch',label:'Popular touchscreen HTML5',order:'popular',phone:true,url:'https://itch.io/games/html5/tag-touchscreen.xml'},
 {id:'open-tag',label:'HTML5 tagged open source',order:'popular',url:'https://itch.io/games/html5/tag-open-source.xml'}
];
export const CATALOG_CAP=288,PER_FEED=36;
const DESTINATION=fileURLToPath(new URL('../public/catalog.json',import.meta.url));
export function decodeXML(value){return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const p=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):parseInt(n,10);return p>0&&p<=0x10ffff?String.fromCodePoint(p):'';}).replace(/&(amp|lt|gt|quot|apos|nbsp);/g,(_,n)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[n]);}
function field(xml,name){return decodeXML(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'))?.[1]||'').trim();}
function plain(v){return v.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();}
function feedInfo(f){if(typeof f==='object')return f;return FEEDS.find(x=>x.url===f)||{id:f,label:'HTML5 feed',url:f,order:'popular'};}
const iso=v=>Number.isNaN(Date.parse(v))?null:new Date(v).toISOString();
export function parseFeed(xml,source){
 const f=feedInfo(source);if(!/<rss\b/i.test(xml)||/<!ENTITY/i.test(xml))throw Error('Expected a public RSS feed without entity declarations.');
 const items=[];let rank=0;
 for(const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)){
  rank++;const rawTitle=plain(field(match[1],'title')),title=plain(field(match[1],'plainTitle'))||rawTitle;let url;
  try{url=new URL(field(match[1],'link'));}catch{continue;}
  if(!['https:','http:'].includes(url.protocol)||!/^[a-z0-9-]+\.itch\.io$/i.test(url.hostname)||!/^\/[\w-]+\/?$/.test(url.pathname)||!title)continue;
  url.protocol='https:';url.search='';url.hash='';
  const description=plain(field(match[1],'description')).slice(0,280);
  // Preserve original source rank even when an explicitly adult listing is omitted.
  if(/\b(?:18\+|nsfw|adult only|erotic|porn)\b/i.test(rawTitle+' '+description)||/18\+/.test(rawTitle+' '+description))continue;
  const tags=['HTML5',...Array.from(rawTitle.matchAll(/\[([^\]]+)\]/g),m=>m[1]).filter(t=>!/^\$|^free$|^windows$|^macos$|^linux$/i.test(t)),...(f.phone?['mobile; source browse tag']:[]),...(f.id==='open-tag'?['creator-tagged open source; license unverified']:[])];
  items.push({id:`itch:${url.hostname}${url.pathname.replace(/\/$/,'')}`,title:title.slice(0,180),description,source:'itch',sourceUrl:url.href.replace(/\/$/,''),license:{spdx:null,kind:'unknown',sourceUrl:url.href},installability:'import',tags,platforms:['html5'],createdAt:iso(field(match[1],'createDate')||field(match[1],'pubDate')),updatedAt:iso(field(match[1],'updateDate')||field(match[1],'pubDate')),indexedFrom:f.url,feeds:[{id:f.id,label:f.label,url:f.url,order:f.order,rank,phone:!!f.phone}]});
  if(items.length>=PER_FEED)break;
 }
 if(!items.length)throw Error('The feed did not contain any recognized itch project items.');return items;
}
export async function updateCatalog({fetcher=fetch,output=DESTINATION,feeds=FEEDS,now=new Date()}={}){
 let previous={schemaVersion:1,sources:[],items:[]};try{previous=JSON.parse(await readFile(output,'utf8'));}catch{}
 const items=new Map(),sources=[];let successful=0;
 // Sequential requests respect the public source; failures retain that slice's last good data.
 for(const source of feeds){const f=feedInfo(source);let entries;
  try{const response=await fetcher(f.url,{signal:AbortSignal.timeout(25000),headers:{'User-Agent':'SFHS-Library-Catalog/1.0 (bounded public RSS index)',Accept:'application/rss+xml, application/xml, text/xml'}});if(!response.ok)throw Error(`HTTP ${response.status}`);const xml=await response.text();if(xml.length>3*1024*1024)throw Error('Feed exceeds the 3 MiB limit.');entries=parseFeed(xml,f);successful++;sources.push({...f,refreshedAt:now.toISOString(),count:entries.length});}
  catch(e){sources.push({...previous.sources.find(s=>s.url===f.url),...f,error:String(e.message||e),attemptedAt:now.toISOString()});entries=previous.items.filter(i=>i.feeds?.some(s=>s.url===f.url)||i.indexedFrom===f.url).map(i=>({...i,feeds:i.feeds?.filter(s=>s.url===f.url)||[]}));}
  for(const i of entries){const old=items.get(i.id);items.set(i.id,old?{...old,tags:[...new Set([...(old.tags||[]),...(i.tags||[])])],feeds:[...(old.feeds||[]),...(i.feeds||[])].filter((v,n,a)=>a.findIndex(x=>x.url===v.url)===n)}:i);}
 }
 if(!successful)throw Error(`No feeds refreshed; existing catalog preserved. ${sources.map(s=>`${s.url}: ${s.error}`).join(' ')}`);
 const catalog={schemaVersion:1,updatedAt:now.toISOString(),description:'Bounded public itch.io HTML5 RSS storefront index. Source order is retained. No numeric ratings supplied by these feeds. Creator tags are not licenses or physical phone tests.',cap:CATALOG_CAP,sources,items:[...items.values()].slice(0,CATALOG_CAP)};
 await mkdir(dirname(output),{recursive:true});const tmp=`${output}.${process.pid}.tmp`;await writeFile(tmp,JSON.stringify(catalog,null,2)+'\n');await rename(tmp,output);return catalog;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))updateCatalog().then(c=>console.log(`Indexed ${c.items.length} projects; ${c.sources.filter(s=>s.error).length} feed errors.`)).catch(e=>{console.error(e.message);process.exitCode=1;});
