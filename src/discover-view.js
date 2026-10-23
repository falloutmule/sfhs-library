import { searchDiscovery, inspectGithub, acquireGithub } from './discovery.js';
import { BROWSE_CATEGORIES, discoveryModel, httpsURL } from './discover-model.js';

export function createDiscoverUI({ el, button, field, modal, dialogCurrent, prepareInstall, importFile, getInstalled, launch }) {
  const $ = id => document.getElementById(id);
  let category = 'all', generation = 0, items = [], checked = null, started = false, returnFocus = null, searchFailed = false;
  const details = new Map();
  const rejected = new Map();
  const analysisKey = data => `${data.repository}@${data.commit}:${data.selectedEntry||data.recommendedEntry}`;
  const model = item => {
    const data={...item,...details.get(item.id)};
    const matches=checked?.id===item.id && checked.detail.commit===data.commit && checked.selection===(data.selectedEntry||data.recommendedEntry);
    return discoveryModel(data,{analysis:matches?checked.analysis:rejected.get(analysisKey(data)),installed:getInstalled(item)});
  };
  const external = (url, text, style = 'button button-quiet') => {
    const link = el('a',{href:httpsURL(url),target:'_blank',rel:'noopener noreferrer',referrerpolicy:'no-referrer',class:style},text,el('span',{'aria-hidden':'true'},' ↗'));
    link.setAttribute('aria-label',`${text} (opens in a new tab)`);
    return link;
  };
  function action(item, current, style = 'button button-primary', supplied, updateId) {
    const primary = current.primary;
    if (primary.url) return external(primary.url, primary.label, style);
    if (primary.type === 'launch') return button(primary.label,()=>launch(getInstalled(item).id),style);
    if (primary.type === 'details') return button('Details',()=>showDetails(item,supplied,updateId),style);
    return button(primary.label,()=>checkInstall(item,supplied,updateId),style);
  }
  function renderCards() {
    $('discover-grid').replaceChildren(...items.map(item => {
      const current = model(item);
      const name = el('h3',{class:'discover-title'},current.title);
      const title = el('div',{class:'discover-card-heading'},el('span',{class:'discover-glyph','aria-hidden':'true'},current.signals.glyph),el('div',{},name,el('span',{class:'discover-source'},item.source==='itch'?'itch.io · indexed':`GitHub · ${item.repository?.split('/')[0] || 'public project'}`)));
      const signals = el('ul',{class:'discover-signals','aria-label':'Project information'},...(current.signals.tags.length?current.signals.tags:['Category unknown']).map(tag=>el('li',{},tag)));
      const localLabel = current.install.state === 'needs-check' ? 'Local install needs checking' : current.install.title;
      const capabilities = el('ul',{class:'discover-capabilities'},el('li',{},el('span',{'aria-hidden':'true'},current.online?'↗':'○'),current.online?'Online version available':item.source==='itch'?'Visit creator for play / downloads':'Online version unknown'),el('li',{},el('span',{'aria-hidden':'true'},'↓'),localLabel),el('li',{},el('span',{'aria-hidden':'true'},'§'),current.licenseLabel));
      const actions = el('div',{class:'discover-actions'},action(item,current));
      if(current.primary.type!=='details') actions.append(button('Details',()=>showDetails(item),'button button-quiet'));
      else if(item.source==='github') actions.append(external(item.sourceUrl,'Source code'));
      return el('article',{class:'app-card discover-card','data-project':item.id},title,el('p',{class:'discover-description'},current.description),signals,capabilities,actions);
    }));
    if(!items.length) $('discover-grid').append(el('div',{class:'discover-empty'},el('h2',{},searchFailed?'Search is unavailable for this source.':'No software matches these filters.'),el('p',{class:'muted'},searchFailed?'See the source error above. Try another source, or retry once the connection or rate limit allows it.':'Try another search or category. Open licenses only excludes projects whose license is unknown.'),button('Clear filters',()=>{category='all';$('discover-query').value='';$('discover-open').checked=false;renderBrowse();return run();},'button button-quiet')));
  }
  function renderBrowse() {
    $('discover-browse').replaceChildren(...BROWSE_CATEGORIES.map(item=>{
      const node=button(item.label,()=>{category=item.id;renderBrowse();return run();},'browse-chip');
      node.setAttribute('aria-pressed',String(category===item.id));
      return node;
    }));
  }
  async function run() {
    started=true;
    const request=++generation;
    $('discover-status').textContent='Finding software…';$('discover-grid').setAttribute('aria-busy','true');$('discover-errors').replaceChildren();
    try {
      const result=await searchDiscovery({query:$('discover-query').value,source:$('discover-source').value,openOnly:$('discover-open').checked,category});
      if(request!==generation)return;
      items=result.items;
      $('discover-status').replaceChildren(...(result.summary||[`${items.length} results`]).map(text=>el('span',{},text)));
      $('discover-source-info').textContent=result.status;
      const errors=result.errors||[];
      searchFailed=errors.length>0;
      if(!navigator.onLine)errors.unshift({source:'Connection',message:'You’re offline. The indexed catalog is available; reconnect for live GitHub search and online apps.'});
      $('discover-errors').replaceChildren(...errors.map(error=>el('p',{},el('strong',{},`${error.source}: `),error.message)));
      renderCards();
    } catch(error) {
      if(request===generation) { $('discover-status').textContent='Search unavailable';$('discover-errors').replaceChildren(el('p',{},error.message)); }
    } finally { if(request===generation)$('discover-grid').setAttribute('aria-busy','false'); }
  }
  function importFor(item) {
    importFile({kind:item.source==='itch'?'itch':'github',url:item.sourceUrl,repository:item.repository,license:item.license||{kind:'unknown'},acquisition:'User-selected download associated with this project; origin and release correspondence not independently verified.'});
  }
  function renderDetails(item, detail, updateId, error = '') {
    const data={...item,...detail}, current=model(data), installed=getInstalled(item);
    let selected=null;
    const secondary=[];
    if(data.source==='github' && (!detail || detail.installable) && current.primary.type!=='check' && current.primary.type!=='install')secondary.push(button(current.install.state==='ready'?'Install':'Check install',()=>checkInstall(item,detail&&{...detail,selectedEntry:selected?.value||detail.recommendedEntry},updateId),'button button-quiet'));
    const primary=action(item,current,'button button-primary',detail,updateId);
    const body=el('div',{class:'stack discover-detail'},el('p',{class:'discover-detail-description'},current.description),
      el('ul',{class:'discover-signals','aria-label':'Project information'},...current.signals.tags.map(tag=>el('li',{},tag))),
      el('section',{class:'discover-options'},el('h3',{},'What you can do'),el('div',{class:'discover-actions'},current.primary.type==='details'?null:primary,...secondary,external(item.sourceUrl,item.source==='itch'?'Creator page':'Source code')),
        current.online?el('p',{class:'muted'},'Online use opens the project’s website in a separate tab. A local copy and save backup are separate checks.'):null),
      error?el('p',{class:'discover-error',role:'alert'},error):null,
      el('section',{class:'discover-verdict'},el('h3',{},current.install.title),el('p',{},current.install.summary),
        detail?.sourceNeedsBuild?el('p',{class:'muted'},'A live web version can still be used online when listed above.'):null,
        item.source==='itch'||current.downloads.length?button('Import a downloaded file',()=>importFor(data),'button button-quiet'):null),
      el('section',{},el('h3',{},'Local preservation'),el('dl',{class:'discover-facts'},
        el('dt',{},'Local copy'),el('dd',{},installed?'Installed on this device':'Not installed'),
        el('dt',{},'Save backup'),el('dd',{},installed?`${installed.versions.find(v=>v.id===installed.activeVersionId)?.saveSupport||'Unknown'} support · see Library details`:'Not applicable yet'),
        el('dt',{},'Phone'),el('dd',{},`${current.phone.label}${current.phone.state==='indicated'?' · based on project metadata':''}. No physical test recorded here.`),
        el('dt',{},'Offline'),el('dd',{},current.offline.label,current.offline.hint?' · project mentions offline use; no offline test recorded.':''))),
      el('section',{},el('h3',{},'License'),el('p',{},current.licenseLabel)));
    if(current.downloads.length)body.append(el('section',{class:'stack'},el('h3',{},'Downloads from the project'),el('p',{class:'muted'},'HTML / ZIP downloads are listed below. Their format and compatibility still need checking after import.'),...current.downloads.map(download=>external(download.url,download.name,'button button-secondary'))));
    const technical=el('details',{class:'discover-technical'},el('summary',{},'Technical details'));
    if(detail){
      const entries=detail.entryCandidates||[];
      selected=el('select',{'aria-label':'Browser package entry'},...entries.map(entry=>el('option',{value:entry.path,disabled:entry.status!=='candidate'},`${entry.path} · ${entry.fileCount} files · ${entry.status}`)));
      if(detail.selectedEntry||detail.recommendedEntry)selected.value=detail.selectedEntry||detail.recommendedEntry;
      selected.addEventListener('change',()=>{detail.selectedEntry=selected.value;renderDetails(item,detail,updateId);$('dialog-body').querySelector('.discover-technical').open=true;$('dialog-body').querySelector('select[aria-label="Browser package entry"]')?.focus();});
      technical.append(...(current.analysisReasons.length?[el('section',{},el('h3',{},'Package analysis'),el('ul',{},...current.analysisReasons.map(reason=>el('li',{},reason))))]:[]),
        el('p',{},detail.installReason),el('dl',{class:'discover-facts'},el('dt',{},'Commit'),el('dd',{},el('code',{class:'hash'},detail.commit)),el('dt',{},'Branch'),el('dd',{},detail.branch),el('dt',{},'Releases'),el('dd',{},String(detail.releases?.length||0))),
        entries.length?field('Browser package entry',selected):el('p',{},'No static HTML entry found.'),
        el('ul',{},...entries.filter(entry=>entry.reason).map(entry=>el('li',{},`${entry.path}: ${entry.reason}`))),
        el('p',{class:'muted'},'Acquired repository files are pinned to the inspected commit. Original bytes and the executable copy receive separate hashes. A homepage does not establish build correspondence.'),
        el('p',{class:'muted'},detail.licenseCaveat),el('ul',{},...(detail.notes||[]).map(note=>el('li',{},note))),
        el('details',{},el('summary',{},'README / use instructions'),el('pre',{class:'readme'},detail.readme||'README unavailable.')),
        el('details',{},el('summary',{},'Release metadata'),...(detail.releases||[]).map(release=>el('p',{},`${release.tag || release.name || 'Release'} · ${release.assets?.length||0} assets`))));
    }else technical.append(el('p',{class:'muted'},item.source==='itch'?'Indexed creator metadata. Downloads are obtained through the creator’s normal page; installed compatibility is checked on the file you import.':'Checking the repository’s browser packages, releases, and use instructions…'));
    body.append(technical);
    return modal(current.title,body,[button('Close',()=>document.getElementById('dialog-close').click(),'button button-quiet')]);
  }
  async function showDetails(item, supplied, updateId) {
    if(!item.id)item={...item,id:`github:${item.repository}`};
    if(!$('dialog').open)returnFocus={id:item.id,text:'Details'};
    if(supplied)details.set(item.id,supplied);
    const cached=supplied||details.get(item.id);
    const revision=renderDetails(item,cached,updateId);
    if(item.source==='itch'||cached)return;
    try {
      const detail=await inspectGithub(item);details.set(item.id,detail);renderCards();
      if(dialogCurrent(revision))renderDetails(item,detail,updateId);
    }catch(error){if(dialogCurrent(revision))renderDetails(item,null,updateId,`Source details unavailable: ${error.message}`);}
  }
  async function checkInstall(item, supplied, updateId) {
    if(!$('dialog').open)returnFocus={id:item.id,text:model(item).primary.label};
    const revision=modal('Checking local install',el('div',{class:'stack'},el('p',{},'Checking for a complete browser app and whether SFHS Library can keep it safely.'),el('p',{class:'muted'},'The app is installed only after you review and confirm the result.')),[button('Cancel',()=>document.getElementById('dialog-close').click(),'button button-quiet')]);
    let detail=supplied||details.get(item.id);
    try {
      detail=detail||await inspectGithub(item);details.set(item.id,detail);renderCards();
      if(!dialogCurrent(revision))return;
      if(!detail.installable){renderDetails(item,detail,updateId);return;}
      const selection=detail.selectedEntry||detail.recommendedEntry;
      const payload=checked?.id===item.id && checked.detail.commit===detail.commit && checked.selection===selection?checked.payload:await acquireGithub(item,detail);
      if(!dialogCurrent(revision))return;
      await prepareInstall(payload.bytes,payload.filename,payload.source,updateId,false,{discovery:true,name:model(item).title,description:model(item).description,isCurrent:()=>dialogCurrent(revision),onAnalysis:analysis=>{checked={id:item.id,detail,selection,payload,analysis};const key=analysisKey({...detail,selectedEntry:selection});if(analysis.compatible)rejected.delete(key);else rejected.set(key,{compatible:false,offline:analysis.offline,reasons:analysis.reasons});renderCards();}});
    }catch(error){if(dialogCurrent(revision))renderDetails(item,detail,updateId,`Local installation could not be checked: ${error.message}`);}
  }
  function init(){
    renderBrowse();
    $('dialog').addEventListener('close',()=>{
      if($('view-discover').hidden){returnFocus=null;return;}
      renderCards();
      if(returnFocus){const card=[...$('discover-grid').children].find(node=>node.dataset.project===returnFocus.id);const target=card&&([...card.querySelectorAll('button,a')].find(node=>node.textContent.trim()===returnFocus.text)||card.querySelector('button,a'));target?.focus();returnFocus=null;}
    });
  }
  return { run, showDetails, init, start:()=>{if(!started)return run();renderCards();} };
}
