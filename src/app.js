import * as store from './store.js';
import { exportArchive, readArchive, validSave, hashBytes, MAX_ARCHIVE } from './archive.js';
import { analyzePayload } from './capsule.js';
import { launchCapsule } from './runtime.js';
import { searchDiscovery, inspectGithub, acquireGithub } from './discovery.js';

const $ = id => document.getElementById(id);
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
let apps = [], settings = { collections: [] }, view = 'library', filter = 'all', collection = null;
let runtime = null, runningApp = null, runningVersion = null, installPrompt = null;
let modalResolver = null, toastTimer, searchGeneration = 0, pendingImportSource = null;
const formatSize = bytes => bytes < 1024 * 1024 ? `${(bytes/1024).toFixed(1)} KB` : `${(bytes/1024/1024).toFixed(1)} MB`;
const date = value => value ? new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : 'Never';
const active = app => app.versions.find(v => v.id === app.activeVersionId);
const label = text => String(text || '').replaceAll('-', ' ');
const licenseText = license => license?.spdx && license.spdx !== 'NOASSERTION' ? license.spdx : 'License unknown';
const totals = app => app.versions.reduce((n,v) => n + v.original.byteLength + new TextEncoder().encode(v.capsule).length, 0);
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key,value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'checked') node.checked = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) if (child != null) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
function button(text, fn, style = 'button') {
  const node = el('button',{type:'button',class:style},text);
  node.addEventListener('click', async () => {
    if (node.disabled) return;
    node.disabled = true;
    try { await fn(); } catch (error) { report(error); } finally { node.disabled = false; }
  });
  return node;
}
function toast(message) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; },7000);
}
function report(error) { console.error(error); toast(error?.message || String(error)); }
function closeDialog(value = false) {
  $('dialog').close(); const resolve = modalResolver; modalResolver = null; resolve?.(value);
}
function modal(title, body, actions = []) {
  if (modalResolver) { modalResolver(false); modalResolver = null; }
  $('dialog-title').textContent = title;
  $('dialog-body').replaceChildren(body);
  $('dialog-actions').replaceChildren(...actions);
  if (!$('dialog').open) $('dialog').showModal();
}
function confirm(title, message, confirmLabel = 'Continue', danger = false) {
  return new Promise(resolve => {
    modal(title, el('p',{},message), [button('Cancel',()=>closeDialog(false),'button button-quiet'), button(confirmLabel,()=>closeDialog(true),danger?'button danger':'button button-primary')]);
    modalResolver = resolve;
  });
}
function field(title, node, hint) { return el('label',{class:'field'},el('span',{},title),node,hint?el('small',{class:'muted'},hint):null); }
function badge(text, kind = '') { return el('span',{class:`badge ${kind}`},text); }
function safeURL(value) { try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) ? url.href : null; } catch { return null; } }
function sourceLink(url, title = 'View source ↗') { const safe = safeURL(url); return safe ? el('a',{href:safe,target:'_blank',rel:'noopener noreferrer',class:'button button-quiet'},title) : el('span',{class:'muted'},'Imported from this device'); }
function download(bytes, filename, type = 'application/zip') {
  const url = URL.createObjectURL(new Blob([bytes],{type}));
  const anchor = el('a',{href:url,download:filename});
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function filename(name) { return name.replace(/[^a-zA-Z0-9-_ ]/g,'').trim().slice(0,70) || 'sfhs-library'; }
function art(title,index) {
  return el('div',{class:'app-art','data-tone':['lime','amber','blue','rose','violet'][index%5],'aria-hidden':'true'},
    el('span',{class:'art-monogram'},title.split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase()),el('span',{class:'art-grid'}));
}
async function refresh() {
  [apps,settings] = await Promise.all([store.listApps(),store.getSettings()]);
  renderLibrary(); renderCollections(); await renderStorage();
}
function switchView(next) {
  view = next;
  for (const section of document.querySelectorAll('[id^="view-"]')) section.hidden = section.id !== `view-${next}`;
  for (const node of document.querySelectorAll('[data-view]')) { const selected = node.dataset.view === next; node.classList.toggle('is-active',selected); node.setAttribute('aria-current',selected?'page':'false'); }
  if (next === 'discover' && !$('discover-grid').children.length) runDiscovery();
  if (next === 'settings' || next === 'backups') renderStorage();
  window.scrollTo({top:0});
}
function renderCollections() {
  $('collection-list').replaceChildren(...settings.collections.map(name => {
    const node = button(name,()=>{ collection = collection===name?null:name; filter='all';switchView('library');renderLibrary();renderCollections(); },'collection-button');
    node.classList.toggle('is-active',collection===name); return node;
  }));
}
function renderLibrary() {
  const query = $('global-search').value.trim().toLowerCase();
  const category = $('library-category').value;
  const sourceFilter = $('library-source')?.value || 'all';
  const licenseFilter = $('library-license')?.value || 'all';
  const profileFilter = $('library-profile')?.value || 'all';
  const offlineFilter = $('library-offline')?.value || 'all';
  const sort = $('library-sort').value;
  let visible = apps.filter(app => {
    const v = active(app);
    return (!query || `${app.name} ${app.description} ${app.category} ${app.collections.join(' ')} ${v.source?.repository || ''}`.toLowerCase().includes(query)) &&
      (!collection || app.collections.includes(collection)) && (!category || category==='all' || app.category===category) &&
      (filter!=='favorites' || app.favorite) && (filter!=='recent' || app.lastLaunchedAt) &&
      (sourceFilter==='all' || v.source?.kind===sourceFilter) && (licenseFilter==='all' || (v.source?.license?.kind||'unknown')===licenseFilter) &&
      (profileFilter==='all' || v.profile===profileFilter) && (offlineFilter==='all' || v.offline===offlineFilter);
  });
  const sorts = { name:(a,b)=>a.name.localeCompare(b.name), recent:(a,b)=>(b.lastLaunchedAt||'').localeCompare(a.lastLaunchedAt||''), 'most-used':(a,b)=>b.launchCount-a.launchCount, newest:(a,b)=>b.createdAt.localeCompare(a.createdAt), new:(a,b)=>b.createdAt.localeCompare(a.createdAt) };
  visible.sort(sorts[['recent','most-used','new'].includes(filter)?filter:sort] || sorts.newest);
  $('library-count').textContent = String(apps.length);
  $('library-count').setAttribute('aria-label',`${apps.length} applications`);
  for(const node of document.querySelectorAll('[data-filter]')) { node.classList.toggle('is-active',node.dataset.filter===filter && !collection); node.setAttribute('aria-pressed',String(node.dataset.filter===filter && !collection)); }
  const categories = [...new Set(apps.map(x=>x.category))].sort();
  $('library-category').replaceChildren(el('option',{value:'all'},'All categories'),...categories.map(x=>el('option',{value:x},x)));
  $('library-category').value = categories.includes(category)?category:'all';
  const grid = $('library-grid');
  grid.replaceChildren();
  if (!visible.length) {
    grid.append(el('div',{class:'empty-state'},el('div',{class:'empty-library-art','aria-hidden':'true'},el('i'),el('i'),el('i'),el('i')),
      el('span',{class:'eyebrow'},apps.length?'Refine your collection':'A home for software worth keeping'),
      el('h2',{},apps.length?'No matches in this shelf.':'Your collection starts here.'),
      el('p',{class:'muted'},apps.length?'Try another search, category, or collection.':'Bring an HTML app or ZIP from your device. Keep the exact version, launch it locally, and take your library with you.'),
      el('div',{class:'card-actions'},button(apps.length?'Import application':'Import your first app',()=>{pendingImportSource=null;$('import-file').click();},'button button-primary'),button('Explore software',()=>switchView('discover'),'button button-quiet')),
      el('p',{class:'empty-footnote'},'No account. No subscription. Your files stay on this device.')));
  } else visible.forEach((app,index) => {
    const version = active(app);
    const card = el('article',{class:'app-card'},art(app.name,index));
    const favorite = button(app.favorite?'★':'☆',async()=>{ await store.mutateApp(app.id,a=>({...a,favorite:!a.favorite})); await refresh(); },'favorite-button');
    favorite.setAttribute('aria-label',`${app.favorite?'Unfavorite':'Favorite'} ${app.name}`);
    card.append(favorite,el('div',{class:'card-body'},el('div',{class:'card-meta'},app.category,el('span',{},formatSize(totals(app)))),
      el('h3',{class:'card-title'},app.name),el('div',{class:'badge-row'},badge(version.offline==='network'?'Uses network':'Offline candidate'),badge(licenseText(version.source?.license))),
      el('p',{class:'muted card-description'},app.description || `${label(version.profile)} · ${app.versions.length} retained ${app.versions.length===1?'version':'versions'}`),
      el('div',{class:'card-actions'},button('Launch',()=>launch(app.id),'button button-primary'),button('Details',()=>showApp(app.id),'button button-quiet'))));
    grid.append(card);
  });
}
async function renderStorage() {
  const estimate = await navigator.storage?.estimate?.().catch(()=>({})) || {};
  const persistent = await navigator.storage?.persisted?.().catch(()=>false) || false;
  const usage = estimate.usage || apps.reduce((n,a)=>n+totals(a),0), quota = estimate.quota;
  $('storage-status').textContent = `${formatSize(usage)} used${quota?` of approximately ${formatSize(quota)}`:''}. Persistent storage ${persistent?'granted':'not granted'}.`;
  $('storage-meter').value = quota ? usage/quota*100 : 0;
  $('backup-status').textContent = settings.lastExportAt ? `Last backup download prepared ${date(settings.lastExportAt)}. Keep the downloaded ZIP outside browser storage. Test a restore to confirm your copy.` : 'No library backup exported yet. Browser storage is not a backup.';
}

async function prepareInstall(bytes, name, source = {kind:'device',license:{kind:'unknown'}}, updateId = null, networkAllowed = false) {
  toast('Inspecting payload and resolving local resources…');
  if (bytes.length > 40*1024*1024) throw new Error('This candidate supports app imports up to 40 MiB.');
  const result = await analyzePayload({bytes,filename:name,networkAllowed,entryPath:source.entry});
  const old = updateId ? await store.getApp(updateId) : null;
  const nameInput = el('input',{value:old?.name || result.title || name.replace(/\.(html?|zip)$/i,''),maxlength:160,required:true});
  const versionInput = el('input',{value:source.version?.slice(0,40) || `Version ${(old?.versions.length||0)+1}`,maxlength:100});
  const categoryInput = el('select',{},...['Utilities','Games','Creative','Learning','Development','Uncategorized'].map(x=>el('option',{value:x},x)));
  categoryInput.value = old?.category || 'Uncategorized';
  const body = el('div',{class:'stack'},el('p',{class:'muted'},'The original file and a separate executable capsule will be retained on this device.'),
    el('div',{class:'badge-row'},badge(result.compatible?'Ready to install':'Unsupported',result.compatible?'good':'bad'),badge(label(result.profile)),badge(licenseText(source.license))),
    field('Application name',nameInput),field('Version label',versionInput),field('Category',categoryInput),
    el('dl',{class:'detail-grid'},el('dt',{},'Payload'),el('dd',{},`${formatSize(bytes.length)} · ${result.fileCount||1} files`),el('dt',{},'Saves'),el('dd',{},label(result.saveSupport)),el('dt',{},'Offline'),el('dd',{},result.offline==='network'?'Uses network':'Candidate; a network-disabled launch has not been verified')),
    el('ul',{class:'inspection-notes'},...[...(result.reasons||[]),...(result.warnings||[])].map(x=>el('li',{},x))),
    el('details',{},el('summary',{},'Payload fingerprint'),el('code',{class:'hash'},result.originalHash)));
  if (!networkAllowed && result.networkOrigins?.length) {
    body.append(el('p',{class:'muted'},`Detected network origins: ${result.networkOrigins.join(', ')}`),button('Review with network access enabled',()=>prepareInstall(bytes,name,source,updateId,true),'button button-quiet'));
  }
  const actions = [button('Cancel',()=>closeDialog(),'button button-quiet')];
  if (result.compatible) actions.push(button(old?'Preserve update & test':'Install application',async()=>{
    if(!nameInput.value.trim()) {nameInput.focus();return;}
    if(old && runningApp===old.id && runtime)await runtime.flush();
    const version = { id:uid(),label:versionInput.value || 'Imported version',acquiredAt:now(),filename:name,original:bytes,capsule:result.capsule,
      originalHash:result.originalHash,executableHash:result.executableHash,profile:result.profile,offline:result.offline==='network'?'network':'candidate',
      saveSupport:result.saveSupport,reasons:result.reasons||[],warnings:result.warnings||[],fileCount:result.fileCount||1,networkOrigins:result.networkOrigins||[],networkAllowed,
      source,save:{localStorage:{},bridge:null} };
    const app = old ? await store.mutateApp(old.id,current=>({...current,versions:[...current.versions,{...version,save:structuredClone(active(current).save)}],updatedAt:now()})) : {id:uid(),name:nameInput.value.trim(),description:'',category:categoryInput.value,collections:[],favorite:false,createdAt:now(),updatedAt:now(),lastLaunchedAt:null,launchCount:0,activeVersionId:version.id,versions:[version],lastBackupAt:null};
    if(!old)await store.putApp(app); closeDialog(); await refresh(); switchView('library');
    if(old) await launch(app.id,version.id,true); else toast(`${app.name} installed. Original payload retained.`);
  },'button button-primary'));
  modal(old?`Update ${old.name}`:'Inspect before installing',body,actions);
}

async function importURL(updateId = null) {
  const input = el('input',{type:'url',placeholder:'https://example.com/application.html',autocomplete:'off'});
  const body = el('div',{class:'stack'},field('Direct HTML or ZIP URL',input),el('p',{class:'muted'},'The server must allow browser downloads through CORS. If it does not, download the file normally and import it from your device. No proxy is used.'));
  modal('Install from URL',body,[button('Cancel',()=>closeDialog(),'button button-quiet'),button('Download & inspect',async()=>{
    const url = new URL(input.value);
    if(url.protocol!=='https:' || url.username || url.password) throw new Error('Use a public HTTPS URL without embedded credentials.');
    const response = await fetch(url.href,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(30000)}).catch(()=>{throw new Error('The download was blocked or unavailable. Download normally, then import the local file.');});
    if(!response.ok) throw new Error(`Download failed (${response.status}).`);
    const bytes = await boundedDownload(response);
    await prepareInstall(bytes,decodeURIComponent(url.pathname.split('/').pop()) || 'download.html',{kind:'url',url:url.href,license:{kind:'unknown'}},updateId);
  },'button button-primary')]);
}
async function boundedDownload(response) {
  if(Number(response.headers.get('content-length')) > 40*1024*1024) throw new Error('Payload exceeds 40 MiB.');
  const reader = response.body.getReader(), chunks=[]; let size=0;
  while(true) { const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>40*1024*1024){await reader.cancel();throw new Error('Payload exceeds 40 MiB.');}chunks.push(value); }
  const bytes = new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}

async function launch(appId, versionId, preview = false) {
  if(runtime) await exitRuntime();
  const app = await store.getApp(appId); if(!app)throw new Error('This application is no longer in the library.');
  const version = app.versions.find(v=>v.id===(versionId||app.activeVersionId));
  if(await hashBytes(new TextEncoder().encode(version.capsule))!==version.executableHash)throw new Error('Executable checksum mismatch. Restore the app from a verified backup.');
  closeDialog();
  $('runtime').hidden = false; document.body.classList.add('runtime-open');
  $('runtime-title').textContent = `${app.name} · ${version.label}${preview?' · Preview':''}`;
  $('runtime-status').textContent = 'Opening isolated capsule…';
  $('runtime-activate')?.remove();
  runningApp=app.id;runningVersion=version.id;
  try {
    runtime = await launchCapsule({container:$('runtime-container'),capsule:version.capsule,save:version.save,networkAllowed:version.networkAllowed,networkOrigins:version.networkOrigins,capabilities:version.capabilities||{},
      onSave: async save => {
        const clean=validSave(save);
        await store.mutateApp(app.id,current=>({...current,versions:current.versions.map(v=>v.id===version.id?{...v,save:clean}:v)}));
        $('runtime-status').textContent='Managed state saved locally';
      },
      onStatus: status => { $('runtime-status').textContent=typeof status==='string'?status:status.message || status.type || 'Capsule running'; }
    });
    await store.mutateApp(app.id,a=>({...a,lastLaunchedAt:now(),launchCount:a.launchCount+1}));
    if(preview) {
      const activate=button('Use this version',async()=>{
        await runtime.flush();
        await store.mutateApp(app.id,a=>({...a,activeVersionId:version.id,updatedAt:now()}));
        activate.remove();$('runtime-title').textContent=`${app.name} · ${version.label}`;toast('New version activated. The previous version and its save remain available.');
      },'button button-primary');activate.id='runtime-activate';$('runtime-close').before(activate);
    }
  } catch(error) { $('runtime').hidden=true;document.body.classList.remove('runtime-open');runtime=null;throw error; }
}
async function exitRuntime() {
  try { if(runtime) await runtime.close(); }
  finally { runtime=null;$('runtime-container').replaceChildren();$('runtime').hidden=true;document.body.classList.remove('runtime-open');runningApp=null;runningVersion=null;await refresh(); }
}

async function showApp(id) {
  const app=await store.getApp(id), version=active(app);
  const nameInput=el('input',{value:app.name,maxlength:160});
  const description=el('textarea',{rows:2,maxlength:2000},app.description);
  const category=el('input',{value:app.category,maxlength:80,list:'known-categories'});
  const collectionChecks=settings.collections.map(name=>{const input=el('input',{type:'checkbox',checked:app.collections.includes(name),value:name});return {name,input};});
  const permissions = [['network','Declared network origins',version.networkAllowed],['pointerLock','Pointer lock',version.capabilities?.pointerLock],['gamepad','Gamepad',version.capabilities?.gamepad],['downloads','Downloads',version.capabilities?.downloads],['fullscreen','Application-requested fullscreen',version.capabilities?.fullscreen]].map(([key,title,enabled])=>({key,title,input:el('input',{type:'checkbox',checked:!!enabled})}));
  const body=el('div',{class:'stack'},el('div',{class:'badge-row'},badge('Installed locally','good'),badge(label(version.profile)),badge(licenseText(version.source?.license))),
    field('Name',nameInput),field('Description',description),field('Category',category),
    el('div',{class:'collection-checks'},...collectionChecks.map(x=>field(x.name,x.input))),
    button('Save organization',async()=>{await store.mutateApp(id,a=>({...a,name:nameInput.value.trim()||a.name,description:description.value,category:category.value.trim()||'Uncategorized',collections:collectionChecks.filter(x=>x.input.checked).map(x=>x.name)}));await refresh();toast('Library details saved.');},'button button-quiet'),
    el('dl',{class:'detail-grid'},el('dt',{},'Software protection'),el('dd',{},app.lastBackupAt?`Backup download prepared ${date(app.lastBackupAt)}`:'Local payload retained · no exported app backup recorded'),
      el('dt',{},'Save protection'),el('dd',{},`${label(version.saveSupport)} · ${Object.keys(version.save.localStorage||{}).length} managed keys. App-level restore has not been verified for this app.`),
      el('dt',{},'Source'),el('dd',{},sourceLink(version.source?.url)),el('dt',{},'Acquired'),el('dd',{},date(version.acquiredAt)),
      el('dt',{},'License'),el('dd',{},`${licenseText(version.source?.license)}. Repository license is not a dependency-license audit.`)),
    el('div',{class:'card-actions'},button('Back up app',()=>backup(app.id),'button'),button('Export original',()=>download(version.original,version.filename,'application/octet-stream'),'button button-quiet'),button('Import update',()=>chooseUpdate(id),'button button-quiet')),
    el('h3',{},'Retained versions'),el('p',{class:'muted'},'Each version keeps its exact payload and its own save snapshot. Preview an older version to roll back; activate it after checking the app.'),
    ...app.versions.slice().reverse().map(v=>el('div',{class:'version-row'},el('div',{},el('strong',{},v.label),el('small',{class:'muted'},`${date(v.acquiredAt)} · ${formatSize(v.original.byteLength)}${v.id===app.activeVersionId?' · Active':''}`)),
      button(v.id===app.activeVersionId?'Launch':'Preview & activate',()=>launch(id,v.id,v.id!==app.activeVersionId),'button button-quiet'))),
    el('details',{},el('summary',{},'Provenance & compatibility'),el('p',{class:'muted'},`${version.filename} · ${version.source?.repository||version.source?.kind||'Device import'}`),el('p',{},'Original SHA-256'),el('code',{class:'hash'},version.originalHash),el('p',{},'Executable SHA-256'),el('code',{class:'hash'},version.executableHash),el('ul',{},...version.warnings.map(x=>el('li',{},x)))),
    el('details',{},el('summary',{},'App permissions'),el('div',{class:'stack'},el('p',{class:'muted'},'These allowances apply on the next launch. Browser permission checks still apply. Camera, microphone, location, and clipboard access remain restricted.'),el('p',{class:'muted'},`Declared network origins: ${version.networkOrigins?.join(', ') || 'None detected'}. Capsule policies restrict resource requests; they are not a browser-wide firewall.`),...permissions.map(x=>field(x.title,x.input)),button('Save app permissions',async()=>{const chosen=Object.fromEntries(permissions.map(x=>[x.key,x.input.checked]));await store.mutateApp(id,a=>({...a,versions:a.versions.map(v=>v.id===version.id?{...v,networkAllowed:chosen.network,capabilities:{pointerLock:chosen.pointerLock,gamepad:chosen.gamepad,downloads:chosen.downloads,fullscreen:chosen.fullscreen}}:v)}));toast('Permissions saved for the next launch.');},'button button-quiet'))),
    button('Remove application',async()=>{if(await confirm(`Remove ${app.name}?`,'This removes all locally retained versions and their managed saves. Export a backup first if you want to keep them.','Remove application',true)){await store.deleteApp(id);await refresh();toast('Application removed from this library.');}},'button danger'));
  if(version.source?.kind==='github')body.insertBefore(button('Check GitHub for update',()=>checkUpdate(app),'button'),body.children[body.children.length-1]);
  modal(app.name,body,[button('Close',()=>closeDialog(),'button button-quiet'),button('Launch',()=>launch(id),'button button-primary')]);
}
function chooseUpdate(id) {
  const input=el('input',{type:'file',accept:'.html,.htm,.zip'});
  input.addEventListener('change',()=>{const file=input.files[0];if(file)file.arrayBuffer().then(buffer=>prepareInstall(new Uint8Array(buffer),file.name,{kind:'device',license:{kind:'unknown'}},id)).catch(report);});input.click();
}
async function checkUpdate(app) {
  const source=active(app).source;
  toast('Inspecting upstream without replacing the installed version…');
  const item={repository:source.repository,source:'github',sourceUrl:source.url,title:app.name};
  const detail=await inspectGithub(item);
  if(detail.commit===source.version){toast('The installed source commit is current.');return;}
  await showDiscoveryDetail(item,detail,app.id);
}

async function backup(appId = null) {
  if(runtime)await runtime.flush();
  const snapshot=await store.librarySnapshot();
  if(appId)snapshot.apps=snapshot.apps.filter(a=>a.id===appId);
  if(!snapshot.apps.length && appId)throw new Error('Application not found.');
  toast('Packaging originals, capsules, retained versions, and managed saves…');
  const bytes=await exportArchive(snapshot);
  // Validate the actual portable bytes before initiating the download.
  await readArchive(bytes);
  download(bytes,`${appId?filename(snapshot.apps[0].name):'sfhs-library'}-${now().slice(0,10)}.zip`);
  const exportedAt=now();
  for(const app of snapshot.apps)await store.mutateApp(app.id,a=>({...a,lastBackupAt:exportedAt}));
  if(!appId){settings={...settings,lastExportAt:exportedAt};await store.saveSettings(settings);}
  await refresh();toast('Backup prepared and download started. Keep the ZIP outside browser storage.');
}
async function restore(file) {
  if(file.size>MAX_ARCHIVE)throw new Error('Backup exceeds the 150 MiB import limit.');
  toast('Checking every payload checksum before restoring…');
  const snapshot=await readArchive(new Uint8Array(await file.arrayBuffer()));
  const count=snapshot.apps.length, versions=snapshot.apps.reduce((n,a)=>n+a.versions.length,0);
  if(await confirm('Restore portable backup',`${count} applications and ${versions} retained versions passed SHA-256 validation. Existing apps will be preserved; identity collisions become separate copies. Unsupported saves remain unsupported. Network and optional app permissions reset: review App permissions in Details before using those capabilities.`, 'Restore library')){
    await store.restoreSnapshot(snapshot);await refresh();switchView('library');toast(`Restored ${count} applications with exact payload checksums.`);
  }
}

async function runDiscovery() {
  const generation=++searchGeneration;
  $('discover-status').textContent='Searching public sources…';
  try {
    const result=await searchDiscovery({query:$('discover-query').value,source:$('discover-source').value,openOnly:$('discover-open').checked});
    if(generation!==searchGeneration)return;
    $('discover-status').textContent=result.status || `Found ${result.items.length} results.`;
    $('discover-grid').replaceChildren(...result.items.map((item,index)=>el('article',{class:'app-card'},art(item.title,index),el('div',{class:'card-body'},
      el('div',{class:'card-meta'},item.source==='itch'?'Indexed itch.io catalog':'GitHub'),el('h3',{class:'card-title'},item.title),
      el('p',{class:'muted card-description'},item.description || 'Inspect the source and compatibility before installing.'),
      el('div',{class:'badge-row'},badge(licenseText(item.license)),badge(item.source==='itch'?'Local import':'Inspect payload')),
      el('div',{class:'card-actions'},button('Inspect',()=>showDiscoveryDetail(item),'button button-primary'),sourceLink(item.sourceUrl))))));
    if(!result.items.length)$('discover-grid').append(el('div',{class:'empty-state'},el('h2',{},'No results for this search.'),el('p',{class:'muted'},'Try a broader term or turn off Open only. Indexed itch.io results cover the fetched feeds, not all of itch.io.')));
  } catch(error) {if(generation===searchGeneration)$('discover-status').textContent=navigator.onLine?error.message:'You’re offline. Your installed library still works. Connect to search GitHub or refresh discovery.';}
}
async function showDiscoveryDetail(item, supplied, updateId) {
  if(item.source==='itch') {
    modal(item.title,el('div',{class:'stack'},el('p',{},item.description||''),badge('Indexed itch.io catalog'),el('p',{class:'muted'},'This listing is discovery metadata, not an installed app. Get an HTML or ZIP through the creator’s normal download flow, then import it here. Purchase requirements and download controls are respected.'),sourceLink(item.sourceUrl),button('Import downloaded file',()=>{pendingImportSource={kind:'itch',url:item.sourceUrl,license:item.license||{kind:'unknown'},acquisition:'User-selected file associated with this creator listing; origin not independently verified.'};closeDialog();$('import-file').click();},'button button-primary')),[button('Close',()=>closeDialog(),'button button-quiet')]);return;
  }
  toast('Inspecting repository, license, releases, and static entry points…');
  const detail=supplied||await inspectGithub(item);
  const selected=el('select',{},...detail.entryCandidates.map(entry=>el('option',{value:entry.path},`${entry.path} · ${entry.fileCount} files`)));
  if(detail.recommendedEntry)selected.value=detail.recommendedEntry;
  const body=el('div',{class:'stack'},el('p',{},detail.description||item.description||''),
    el('div',{class:'badge-row'},badge(licenseText(detail.license)),badge(detail.installable?'Payload candidate':'External only')),
    el('p',{class:'muted'},detail.installReason || 'Compatibility analysis will run on the downloaded bytes.'),
    field('Static entry point',selected),el('p',{class:'muted'},'Downloads are pinned to the inspected commit. An entry point is preliminary evidence; the package must still pass capsule analysis.'),
    sourceLink(detail.sourceUrl),el('details',{},el('summary',{},'README & source metadata'),el('pre',{class:'readme'},detail.readme||'README unavailable.'),el('code',{class:'hash'},detail.commit||'')),
    el('p',{class:'muted'},`${detail.releases?.length||0} recent releases inspected. Repository license does not establish licenses for every dependency.`));
  const actions=[button('Close',()=>closeDialog(),'button button-quiet')];
  if(detail.installable)actions.push(button('Download & analyze',async()=>{
    toast('Acquiring the selected static package…');
    const payload=await acquireGithub(item,{...detail,selectedEntry:selected.value});
    await prepareInstall(payload.bytes,payload.filename,payload.source,updateId);
  },'button button-primary'));
  modal(item.title,body,actions);
}

function bind(id, event, handler) { $(id)?.addEventListener(event,e=>Promise.resolve(handler(e)).catch(report)); }
async function boot() {
  $('build-id').textContent=__BUILD_ID__;
  document.querySelectorAll('[data-view]').forEach(node=>node.addEventListener('click',()=>switchView(node.dataset.view)));
  document.querySelectorAll('[data-filter]').forEach(node=>node.addEventListener('click',()=>{filter=node.dataset.filter;collection=null;renderLibrary();renderCollections();}));
  bind('global-search','input',()=>{switchView('library');renderLibrary();});
  bind('library-sort','change',renderLibrary);bind('library-category','change',renderLibrary);
  for(const id of ['library-source','library-license','library-profile','library-offline'])bind(id,'change',renderLibrary);
  bind('mobile-collections','click',()=>modal('Your collections',el('div',{class:'stack'},button('All applications',()=>{collection=null;closeDialog();renderLibrary();}),...settings.collections.map(name=>button(name,()=>{collection=name;closeDialog();renderLibrary();})),button('Create collection',()=>{closeDialog();$('add-collection').click();},'button button-primary')),[button('Close',()=>closeDialog(),'button button-quiet')]));
  bind('import-app','click',()=>{pendingImportSource=null;$('import-file').click();});bind('import-url','click',()=>importURL());
  $('import-file').removeAttribute('multiple');
  bind('import-file','change',async()=>{const file=$('import-file').files[0],source=pendingImportSource;pendingImportSource=null;$('import-file').value='';if(file){if(file.size>32*1024*1024)throw new Error('Payload exceeds the 32 MiB import limit.');await prepareInstall(new Uint8Array(await file.arrayBuffer()),file.name,source||undefined);}});
  bind('dialog-close','click',()=>closeDialog());bind('dialog','cancel',event=>{event.preventDefault();closeDialog();});
  bind('runtime-close','click',exitRuntime);
  bind('runtime-fullscreen','click',async()=>{if(document.fullscreenElement)await document.exitFullscreen();else await $('runtime').requestFullscreen();});
  bind('export-library','click',()=>backup());bind('restore-library','click',()=>$('restore-file').click());
  bind('restore-file','change',async()=>{const file=$('restore-file').files[0];$('restore-file').value='';if(file)await restore(file);});
  bind('persist-storage','click',async()=>{const granted=await navigator.storage?.persist?.();await renderStorage();toast(granted?'Persistent storage granted. Keep portable backups too.':'Persistence was not granted by this browser. Export portable backups regularly.');});
  bind('add-collection','click',()=>{const input=el('input',{maxlength:80,placeholder:'e.g. Creative tools'});modal('Create a collection',field('Collection name',input),[button('Cancel',()=>closeDialog(),'button button-quiet'),button('Create collection',async()=>{const name=input.value.trim();if(!name)return;settings={...settings,collections:[...new Set([...settings.collections,name])]};await store.saveSettings(settings);closeDialog();await refresh();toast('Collection created. Add apps from their Details view.');},'button button-primary')]);});
  bind('discover-form','submit',event=>{event.preventDefault();return runDiscovery();});
  bind('discover-source','change',runDiscovery);bind('discover-open','change',runDiscovery);
  bind('download-launcher','click',async()=>{if(location.protocol==='file:'){const a=el('a',{href:location.href,download:'SFHS-Library.html'});a.click();return;}const response=await fetch('./index.html');if(!response.ok)throw new Error('Launcher download unavailable.');download(await response.arrayBuffer(),'SFHS-Library.html','text/html');});
  bind('install-launcher','click',async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;}else toast('In Chrome, open the browser menu and choose Add to Home screen or Install app.');});
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('install-launcher').hidden=false;});
  document.addEventListener('keydown',event=>{if(event.key==='/' && !$('dialog').open && !runtime && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){event.preventDefault();$('global-search').focus();}});
  const connection=()=>{$('connection-status').textContent=navigator.onLine?'Online':'Offline';};connection();window.addEventListener('online',connection);window.addEventListener('offline',connection);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)runtime?.flush().catch(()=>{});});
  await refresh();switchView('library');
  if('serviceWorker' in navigator && ['https:','http:'].includes(location.protocol))navigator.serviceWorker.register('./sw.js').catch(()=>toast('Offline launcher caching is unavailable in this browser. Keep the standalone download.'));
  if(location.protocol==='file:')toast('Standalone mode: storage availability depends on this browser. HTTPS installation is recommended for a dependable phone library.');
  if(['https:','http:'].includes(location.protocol))fetch('./release.json',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(release=>{if(release?.commit && /^[a-f0-9]{40}$/i.test(release.commit))$('build-id').textContent+=release.buildId===__BUILD_ID__?` · Commit ${release.commit.slice(0,12)}`:` · New server release available (${release.commit.slice(0,12)}); this tab is running the cached build.`;}).catch(()=>{});
}
boot().catch(error=>{report(error);$('library-grid').replaceChildren(el('div',{class:'empty-state'},el('h2',{},'Local storage is unavailable.'),el('p',{},'Open the HTTPS launcher in a normal browser tab with storage enabled. Existing backup files remain yours.'),el('p',{class:'muted'},error.message)));});
