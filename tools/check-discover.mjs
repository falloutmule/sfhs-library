// Explicit, bounded checks for the starting shelf and the reported dead link.
// No site crawling, build service, acquisition proxy, or runtime credentials.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {acquireGithub,entryCandidates} from '../src/discovery.js';
import {analyzePayload,CAPSULE_VERSION} from '../src/capsule.js';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const at=new Date().toISOString();
const out='test-results/discover-quality';await mkdir(out,{recursive:true});
async function get(url){const r=await fetch(url,{signal:AbortSignal.timeout(25000)});if(!r.ok)throw new Error(`${url}: HTTP ${r.status}`);return new Uint8Array(await r.arrayBuffer());}
const specs=[
  {repository:'gabrielecirulli/2048',commit:'478b6ec346e3787f589e4af751378d06ded4cbbc',entry:'index.html',title:'2048',description:'Slide matching numbered tiles together to reach 2048.',tags:['game','puzzle','touch'],spdx:'MIT',cache:'2048.zip'},
  {repository:'williamjussiau/timekeeper',commit:'d1fbdfb93169fa195b46d6b43eee26aa55af1016',entry:'timekeeper.html',title:'Timekeeper',description:'Track the time you spend on activities and projects.',tags:['tool','productivity','timer'],spdx:'MIT',cache:'timekeeper.html'}
];
const sitesOnly=process.argv.includes('--websites-only');
const items=sitesOnly?JSON.parse(await readFile('public/checked-apps.json','utf8')).items:[];
for(const spec of sitesOnly?[]:specs){
  let bytes;
  try{const provenance=JSON.parse(await readFile(`test-results/corpus/${spec.cache.split('.')[0]}.provenance.json`,'utf8'));bytes=new Uint8Array(await readFile(`test-results/corpus/${spec.cache}`));if(provenance.commit!==spec.commit||sha(bytes)!==provenance.sha256)throw 0;}
  catch{
    if(spec.cache.endsWith('.html'))bytes=await get(`https://raw.githubusercontent.com/${spec.repository}/${spec.commit}/${spec.entry}`);
    else{const tree=JSON.parse(new TextDecoder().decode(await get(`https://api.github.com/repos/${spec.repository}/git/trees/${spec.commit}?recursive=1`)));if(tree.truncated)throw new Error('Incomplete checked source');bytes=(await acquireGithub({repository:spec.repository},{repository:spec.repository,commit:spec.commit,tree:tree.tree,entryCandidates:entryCandidates(tree.tree),recommendedEntry:spec.entry,installable:true})).bytes;}
  }
  const analysis=await analyzePayload({bytes,filename:spec.cache,...(spec.cache.endsWith('.zip')?{entryPath:spec.entry}:{})});
  if(!analysis.compatible)throw new Error(`${spec.title} no longer passes package analysis: ${analysis.reasons}`);
  const files=spec.cache.endsWith('.zip')?unzipSync(bytes):{[spec.entry]:bytes};
  const tree=Object.keys(files).sort().map(path=>({path,type:'blob',mode:'100644',size:files[path].length,sha256:sha(files[path])}));
  const entries=entryCandidates(tree).map(entry=>({...entry,status:'candidate'}));
  const item={id:`github:${spec.repository}`,source:'github',repository:spec.repository,title:spec.title,description:spec.description,tags:spec.tags,sourceUrl:`https://github.com/${spec.repository}`,license:{kind:'open',spdx:spec.spdx,sourceUrl:`https://github.com/${spec.repository}/tree/${spec.commit}`},commit:spec.commit,checkedAt:at,analysis:{compatible:true,offline:analysis.offline,profile:analysis.profile,reasons:[]},package:{tree,entryCandidates:entries,recommendedEntry:spec.entry,engine:CAPSULE_VERSION}};
  items.push(item);
  await writeFile(`${out}/${spec.cache}`,bytes);
}
if(!sitesOnly){
const peteCommit='038c1dd24c0c6045676229172fbb8d15105df471';
const pete=await get(`https://raw.githubusercontent.com/falloutmule/pete-hegseths-drunken-space-force/${peteCommit}/index.html`);
const peteAnalysis=await analyzePayload({bytes:pete,filename:'index.html'});
items.push({id:'github:falloutmule/pete-hegseths-drunken-space-force',source:'github',repository:'falloutmule/pete-hegseths-drunken-space-force',title:'Pete Hegseth’s Drunken Space Force',description:'A satirical space shooter. Drag to fly; your ship fires automatically.',tags:['game','phone','arcade'],sourceUrl:'https://github.com/falloutmule/pete-hegseths-drunken-space-force',homepage:'https://falloutmule.github.io/pete-hegseths-drunken-space-force/',hasPages:true,license:{kind:'unknown'},commit:peteCommit,checkedAt:at,analysis:{compatible:peteAnalysis.compatible,offline:peteAnalysis.offline,reasons:peteAnalysis.reasons},payloadSha256:sha(pete)});
items.push({id:'github:falloutmule/cat-paw-air-hockey',source:'github',repository:'falloutmule/cat-paw-air-hockey',title:'Cat Paw Air Hockey',description:'Two-player cat-paw air hockey for one shared phone.',tags:['game','android','two-player'],sourceUrl:'https://github.com/falloutmule/cat-paw-air-hockey',homepage:'https://falloutmule.github.io/cat-paw-air-hockey/',hasPages:true,license:{kind:'unknown'}});
}
const websites=[];
for(const url of [items[2].homepage,items[3].homepage,'https://mykonos-island-voxels.netlify.app/']){
  try{const response=await fetch(url,{signal:AbortSignal.timeout(15000)});const html=(await response.text()).slice(0,100000);websites.push({url,checkedAt:at,status:response.ok?'responding':'unavailable',httpStatus:response.status,finalURL:response.url,title:html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim()||''});}
  catch{websites.push({url,checkedAt:at,status:'unverified',reason:'Website check could not finish.'});}
}
const data={schemaVersion:1,checkedAt:at,scope:'Package analysis and website HTTP checks. No physical phone acceptance or blanket safety/offline guarantee.',items,websites};
await writeFile('public/checked-apps.json',JSON.stringify(data,null,2)+'\n');
await writeFile(`${out}/catalog-check.json`,JSON.stringify(data,null,2));
console.log(`Checked ${items.length} starting projects and ${websites.length} explicit websites.`);
