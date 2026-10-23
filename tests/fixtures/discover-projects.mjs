// Cat Paw's identity, homepage and topics are recorded from the real repository
// on 2026-10-23. Small source fixtures below exercise the same build boundary.
export const CAT = { name:'cat-paw-air-hockey',full_name:'falloutmule/cat-paw-air-hockey',default_branch:'main',description:'Local two-player cat-paw air hockey for one shared phone.',topics:['air-hockey','android','html5-game','pixi','pixijs','sfhs','two-player','webgl'],homepage:'https://falloutmule.github.io/cat-paw-air-hockey/',has_pages:true,license:null };
export const READY_HTML='<!doctype html><title>Ready Puzzle</title><p>A touch puzzle</p><button id="add">Add one</button><output id="score"></output><script>let score=Number(localStorage.getItem("score")||0);const render=()=>document.getElementById("score").textContent=score;document.getElementById("add").addEventListener("click",()=>{score++;localStorage.setItem("score",String(score));render()});render();</script>';
const dev='<html><head><title>Development entry</title></head><body><script type="module" src="/src/main.ts"></script></body></html>';
const record=(name,description,files,extra={})=>({metadata:{name,full_name:`owner/${name}`,default_branch:'main',description,topics:[],homepage:null,has_pages:false,license:null,...extra},files,releases:[]});
export const PROJECTS = [
  {metadata:CAT,files:{'src/index.html':dev},releases:[]},
  record('ready-game','A single-file sliding puzzle game for touch screens.',{'index.html':READY_HTML},{license:{spdx_id:'MIT'},topics:['puzzle','touch','offline']}),
  record('source-only','A drawing tool for creative work.',{'index.html':dev}),
  record('unsafe','A personal notes tool that requires its own browser database.',{'index.html':'<!doctype html><title>Origin Notes</title><script>indexedDB.open("required")</script>'}),
  record('no-link','A calculator tool with no declared online version.',{'index.html':'<!doctype html><title>Calculator</title><p>Calculator</p>'}),
  record('a-very-long-project-name-that-needs-to-wrap-without-hiding-useful-actions-on-a-phone','A creative drawing and painting tool. '+ 'Detailed project description supplied by its author. '.repeat(15),{'index.html':READY_HTML}),
  {...record('release-tool','A browser-based music sequencer.',{'src/index.html':dev}),releases:[{tag_name:'v1',html_url:'https://github.com/owner/release-tool/releases/tag/v1',assets:[{name:'browser-app.zip',browser_download_url:'https://github.com/owner/release-tool/releases/download/v1/browser-app.zip',size:200}]}]},
  record('web-notes','A browser notes application for everyday writing.',{'index.html':dev},{homepage:'https://notes.example.test/',topics:['productivity','mobile']}),
  record('readme-tool','',{'index.html':READY_HTML,'README.md':'# Useful Tool\n\nA small browser timer that helps people plan focused work sessions.\n\n## Installation\nDownload a build.'}),
  record('multiple-builds','A browser tool with two static browser versions.',{'index.html':'<!doctype html><title>Root Version A</title><p>Root A</p>','dist/index.html':'<!doctype html><title>Dist Version B</title><p>Dist B</p>'})
];
export const SHA='c'.repeat(40);
export function responseFor(url) {
  const parsed=new URL(url);
  if(parsed.hostname==='api.github.com'){
    if(parsed.pathname==='/search/repositories'){
      const query=parsed.searchParams.get('q')||'';
      if(query.startsWith('rate'))return {status:403,headers:{'x-ratelimit-remaining':'0','x-ratelimit-limit':'10','x-ratelimit-reset':'1900000000'},body:{message:'API rate limit reached'}};
      const items=query.startsWith('nothing')?[]:PROJECTS.map(project=>project.metadata);
      return {body:{total_count:items.length,items}};
    }
    const match=parsed.pathname.match(/^\/repos\/([^/]+\/[^/]+)(.*)$/);
    if(!match)return {status:404,body:{}};
    const project=PROJECTS.find(project=>project.metadata.full_name===decodeURIComponent(match[1]));
    if(!project)return {status:404,body:{}};
    const tail=match[2];
    if(!tail)return {body:project.metadata};
    if(tail.startsWith('/commits/'))return {body:{sha:SHA}};
    if(tail.startsWith('/git/trees/'))return {body:{truncated:false,tree:Object.entries(project.files).map(([path,text])=>({path,type:'blob',mode:'100644',size:Buffer.byteLength(text)}))}};
    if(tail==='/releases')return {body:project.releases};
    if(tail==='/license')return project.metadata.license?{body:{license:project.metadata.license,html_url:`https://github.com/${project.metadata.full_name}/blob/${SHA}/LICENSE`}}:{status:404,body:{}};
    return {status:404,body:{}};
  }
  if(parsed.hostname==='raw.githubusercontent.com'){
    const parts=parsed.pathname.slice(1).split('/'),repo=parts.slice(0,2).join('/'),path=parts.slice(3).join('/');
    const project=PROJECTS.find(project=>project.metadata.full_name===repo);
    return project&&Object.hasOwn(project.files,path)?{text:project.files[path]}:{status:404,text:'Not found'};
  }
  return null;
}
