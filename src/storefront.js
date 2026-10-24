import itch from '../public/catalog.json' with {type:'json'};
import github from '../public/github-apps.json' with {type:'json'};
import {CHECKED_APPS,checkedRecord} from './checked-catalog.js';
import {projectSignals,onlineVersion} from './discover-model.js';
export const TYPES=[['games','Games'],['tools','Tools'],['creative','Creative'],['maker','Maker / CAD'],['music','Music'],['productivity','Productivity']];
export const DEFAULT_FILTERS=()=>({types:[],phone:false,offline:false,open:false,source:'all'});
export const ITCH_UPDATED=itch.updatedAt;
export const SOURCE_INFO='itch.io is a bounded index of public HTML5 browse feeds, not live search of all itch.io. Top rated, Popular and New & popular retain itch’s own ordering; the feeds supply no numeric ratings. Mobile tags indicate support, not physical phone testing. GitHub stars measure interest, not reviews. Selected GitHub apps use indexed metadata; text search also searches GitHub live. Checked by SFHS means pinned package analysis or website checks, not blanket safety, phone, save or offline verification. Online use opens separately and does not preserve an app. Offline filters include analyzed candidates; only blocked-network testing establishes verified operation.';
export function classifyProject(item){
 if(item.applicationKind==='application')return 'application';
 const text=`${item.title||''} ${item.description||''}`,tags=(item.tags||[]).join(' ');
 // A library management app is different from a library for developers.
 const strong=/\b(framework|sdk|component[- ]library|api[- ]client|charting[- ]library|javascript[- ]library|ui[- ]kit)\b/i.test(tags)||/\b(?:a|the|an|javascript|typescript|charting|mobile|html|ui)\s+(?:(?:full[- ]featured|lightweight|mobile|html|ui|javascript|typescript|charting)\s+)*(?:framework|library|sdk|toolkit)\b/i.test(text)||/\b(?:framework|library)\s+(?:for|to|with)\b/i.test(text);
 if(strong&&!/library management (?:app|application|tool)/i.test(text))return 'developer';
 if(/\b(template|boilerplate|documentation|awesome[- ]list)\b/i.test(tags+' '+text))return 'developer';
 if(item.source==='itch'||projectSignals(item).categories.includes('games'))return 'game';
 if(/\b(app|application|editor|drawing|calculator|timer|slicer|synthesizer|sequencer|whiteboard)\b/i.test(text))return 'application';
 return 'unknown';
}
export function mergeItems(...lists){const byId=new Map();for(const item of lists.flat()){const key=item.repository?`github:${item.repository.toLowerCase()}`:item.id;byId.set(key,{...byId.get(key),...item});}return [...byId.values()];}
export function storeItems(){return mergeItems(github.items,itch.items,CHECKED_APPS);}
export function isChecked(item){return !!checkedRecord(item)||CHECKED_APPS.some(i=>i.id===item.id);}
export function offlineState(item){const a=checkedRecord(item)?.analysis||item.analysis;return item.offline==='verified'&&item.offlineEvidence?.blockedNetwork===true?'verified':a?.offline==='candidate'&&a.compatible?'candidate':'unknown';}
export function filterItems(items,filters=DEFAULT_FILTERS(),query=''){
 const words=query.toLowerCase().split(/\s+/).filter(Boolean);
 return items.filter(i=>{
  const s=projectSignals(i),text=`${i.title} ${i.description} ${i.repository||''} ${(i.tags||[]).join(' ')}`.toLowerCase();
  return (!filters.types?.length||filters.types.some(t=>s.categories.includes(t)))&&(!filters.phone||s.phone)&&(!filters.offline||offlineState(i)!=='unknown')&&(!filters.open||i.license?.kind==='open')&&(filters.source==='all'||(filters.source==='checked'?isChecked(i):i.source===filters.source))&&words.every(w=>text.includes(w));
 });
}
export function filterLabels(f){return [...TYPES.filter(([id])=>f.types.includes(id)).map(([,v])=>v),...(f.phone?['Phone / Touch']:[]),...(f.offline?['Offline candidates']:[]),...(f.open?['Open source']:[]),...(f.source==='all'?[]:[{itch:'itch.io',github:'GitHub',checked:'Checked by SFHS'}[f.source]])];}
export function feedRank(item,order,{phone=false,feed}={}){const list=(item.feeds||[]).filter(f=>(!feed||f.id===feed)&&(!order||f.order===order)&&(!phone||f.phone));return list.length?Math.min(...list.map(f=>f.rank)):Infinity;}
export function popularityLabel(i,order=''){
 if(i.source==='github'&&Number.isFinite(i.stars))return `${new Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:1}).format(i.stars)} ★ on GitHub`;
 if(i.source==='itch'){
  // Only explicit source review data may supply a numeric rating. RSS currently supplies none.
  if(i.rating?.source==='itch'&&Number.isFinite(i.rating.value)&&i.rating.scale===5)return `★ ${i.rating.value.toFixed(1)}${Number.isInteger(i.rating.count)?` · ${i.rating.count.toLocaleString()} ratings`:''} · itch.io`;
  const f=(i.feeds||[]).find(f=>f.order===order)||(i.feeds||[])[0];return f?`itch.io · ${f.label}`:'itch.io';
 }
 return '';
}
export function availableSorts(items){const sorts=[['recommended','Recommended']];if(items.some(i=>Number.isFinite(feedRank(i,'top-rated'))))sorts.push(['top-rated','Top rated · itch.io']);if(items.some(i=>Number.isFinite(i.stars)||Number.isFinite(feedRank(i,'popular'))))sorts.push(['popular','Popular']);if(items.some(i=>Number.isFinite(feedRank(i,'new-popular'))))sorts.push(['new-popular','New & popular · itch.io']);if(items.some(i=>i.createdAt))sorts.push(['newest','Newest']);if(items.some(i=>i.updatedAt))sorts.push(['updated','Recently updated']);return sorts;}
export function sortItems(items,sort='recommended',{query='',phone=false,feed}={}){
 const words=query.toLowerCase().split(/\s+/).filter(Boolean);
 const recommended=i=>{
  const text=`${i.title} ${i.description} ${(i.tags||[]).join(' ')}`.toLowerCase();const kind=classifyProject(i);
  const relevance=words.reduce((n,w)=>n+(text.includes(w)?80:-80),0);
  const native=i.source==='itch'?Math.max(0,30-feedRank(i,null)/2):Math.min(30,Math.log10(1+(i.stars||0))*6);
  return relevance+(kind==='developer'?-150:kind==='unknown'?-30:50)+(isChecked(i)?28:0)+(i.license?.kind==='open'?12:0)+(phone&&projectSignals(i).phone?12:0)+(onlineVersion(i)?.state==='checked'?8:0)+(checkedRecord(i)?.analysis?.compatible?12:0)+(i.archived?-25:0)+(Date.now()-Date.parse(i.updatedAt)<365*86400000?3:0)+(Number.isFinite(native)?native:0);
 };
 const date=(i,key)=>Date.parse(i[key])||0;
 return [...items].sort((a,b)=>{
  if(['top-rated','new-popular'].includes(sort)){const delta=feedRank(a,sort,{phone,feed})-feedRank(b,sort,{phone,feed});if(!Number.isNaN(delta)&&delta!==0)return delta;}
  if(sort==='popular'){
   // Preserve native order within each source; cross-source grouping is explicit, not a fake shared rating.
   if(a.source!==b.source)return a.source==='itch'?-1:1;
   const d=a.source==='itch'?feedRank(a,'popular',{phone,feed})-feedRank(b,'popular',{phone,feed}):(b.stars||0)-(a.stars||0);if(!Number.isNaN(d)&&d!==0)return d;
  }
  if(sort==='newest'&&date(a,'createdAt')!==date(b,'createdAt'))return date(b,'createdAt')-date(a,'createdAt');
  if(sort==='updated'&&date(a,'updatedAt')!==date(b,'updatedAt'))return date(b,'updatedAt')-date(a,'updatedAt');
  return recommended(b)-recommended(a)||a.title.localeCompare(b.title);
 });
}
export const SHELVES=[
 {id:'phone',title:'Top phone games',note:'Top rated on itch.io · phone support indicated',filters:{types:['games'],phone:true,source:'itch'},sort:'top-rated',feed:'phone-rated'},
 {id:'rated',title:'Top rated games',note:'itch.io’s Top Rated HTML5 games',filters:{types:['games'],source:'itch'},sort:'top-rated',feed:'top-rated'},
 {id:'open',title:'Popular open-source apps',note:'Selected browser apps · ordered by GitHub stars',filters:{open:true,source:'github'},sort:'popular'},
 {id:'popular',title:'Popular browser games',note:'itch.io’s Popular HTML5 order',filters:{types:['games'],source:'itch'},sort:'popular',feed:'popular'},
 {id:'checked',title:'Checked by SFHS',note:'Pinned package or website checks · see each app’s capabilities',filters:{source:'checked'},sort:'recommended'},
 {id:'tools',title:'Useful tools',note:'End-user browser tools',filters:{types:['tools']},sort:'recommended'},
 {id:'creative',title:'Create something',note:'Drawing, design and music in the browser',filters:{types:['creative']},sort:'recommended'},
 {id:'maker',title:'Maker / CAD',note:'Modeling and fabrication software',filters:{types:['maker']},sort:'recommended'},
 {id:'new',title:'New & popular',note:'itch.io’s New & Popular HTML5 order',filters:{types:['games'],source:'itch'},sort:'new-popular',feed:'new-popular'}
];
export function shelves(items=storeItems()){return SHELVES.map(s=>{let results=filterItems(items,{...DEFAULT_FILTERS(),...s.filters});results=results.filter(i=>!['developer','unknown'].includes(classifyProject(i))&&(!s.feed||Number.isFinite(feedRank(i,null,{feed:s.feed}))));return {...s,items:sortItems(results,s.sort,{phone:s.filters.phone,feed:s.feed})};}).filter(s=>s.items.length>=2);}
