import {readFile,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {classifyLicense} from '../src/discovery.js';
// Deliberately bounded seed list of end-user browser applications, not a popularity search of packages.
export const PROJECTS=[
 ['excalidraw/excalidraw',['creative','tools']],['jgraph/drawio',['creative','tools']],['viliusle/miniPaint',['creative','tools']],['SVG-Edit/svgedit',['creative','tools']],['gchq/CyberChef',['tools']],['jscad/OpenJSCAD.org',['maker','tools']],['GridSpace/grid-apps',['maker','tools']],['johnnesky/beepbox',['music','creative']],['jummbus/jummbox',['music','creative']],['maxbittker/sandspiel',['games','creative']],['ncase/trust',['games']],['doublespeakgames/adarkroom',['games']],['gabrielecirulli/2048',['games']],['wayou/t-rex-runner',['games']],['williamjussiau/timekeeper',['productivity','tools']]
];
const dest=fileURLToPath(new URL('../public/github-apps.json',import.meta.url));
export async function updateGithub({fetcher=fetch,output=dest,now=new Date()}={}){
 let old={items:[]};try{old=JSON.parse(await readFile(output,'utf8'));}catch{}
 const items=[],errors=[];let successful=0;
 for(const [repository,categories] of PROJECTS){try{
  const url=`https://api.github.com/repos/${repository}`,r=await fetcher(url,{headers:{Accept:'application/vnd.github+json','User-Agent':'SFHS-Library-Catalog'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`HTTP ${r.status}`);const v=await r.json();if(v.full_name?.toLowerCase()!==repository.toLowerCase())throw Error('Unexpected repository');
  successful++;items.push({id:`github:${v.full_name}`,repository:v.full_name,title:v.name,description:v.description||'',source:'github',sourceUrl:v.html_url,homepage:v.homepage||null,hasPages:!!v.has_pages,tags:v.topics||[],categories,applicationKind:'application',classificationEvidence:'Selected browser application; repository metadata linked below. Runtime compatibility remains unchecked.',license:classifyLicense(v.license,v.html_url),stars:v.stargazers_count||0,archived:!!v.archived,createdAt:v.created_at,updatedAt:v.pushed_at||v.updated_at,indexedAt:now.toISOString(),indexedFrom:url});
 }catch(e){errors.push({repository,error:e.message});const previous=old.items.find(i=>i.repository.toLowerCase()===repository.toLowerCase());if(previous)items.push(previous);}}
 if(!successful){if(!old.items.length)throw Error('No GitHub metadata available; previous catalog preserved.');console.warn('GitHub refresh unavailable; retaining last good index.');return {...old,retained:true,errors};}
 let next=0;
 await Promise.all(Array.from({length:3},async()=>{while(next<items.length){const item=items[next++];let url;try{url=new URL(item.homepage);if(url.protocol!=='https:'||url.username||url.password)continue;}catch{continue;}
 try{const r=await fetcher(url.href,{signal:AbortSignal.timeout(15000),headers:{'User-Agent':'SFHS-Library-Catalog (website availability check)'}});let text='';const reader=r.body?.getReader();if(reader){while(text.length<65536){const part=await reader.read();if(part.done)break;text+=new TextDecoder().decode(part.value);}await reader.cancel();}const title=text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]*>/g,'').slice(0,200)||'';item.websiteCheck={url:url.href,status:r.ok&&!/^(?:404|site not found|page not found|access denied)/i.test(title)?'responding':'unavailable',httpStatus:r.status,title,checkedAt:now.toISOString()};}
 catch(e){const previous=old.items.find(i=>i.id===item.id);if(previous?.websiteCheck)item.websiteCheck=previous.websiteCheck;errors.push({repository:item.repository,error:'Website check: '+e.message});}
 }}));
 if(!items.length)throw Error('No GitHub metadata available; previous catalog preserved.');
 const value={schemaVersion:1,updatedAt:now.toISOString(),description:'Selected end-user browser projects; public GitHub metadata, not app ratings or compatibility verification.',errors,items};const tmp=output+'.tmp';await writeFile(tmp,JSON.stringify(value,null,2)+'\n');await rename(tmp,output);return value;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))updateGithub().then(v=>console.log(`GitHub: ${v.items.length} selected applications; ${v.errors.length} metadata errors.`)).catch(e=>{console.error(e.message);process.exitCode=1;});
