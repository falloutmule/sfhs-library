import {searchDiscovery,inspectGithub,acquireGithub,parseGithubRepository} from './discovery.js';
import {discoveryModel,httpsURL} from './discover-model.js';
import {checkedPackageDetail} from './checked-catalog.js';
import {DEFAULT_FILTERS,TYPES,storeItems,filterItems,filterLabels,sortItems,shelves,popularityLabel,availableSorts,isChecked,ITCH_UPDATED,SOURCE_INFO,feedRank} from './storefront.js';

export function createDiscoverUI({el,button,field,modal,dialogCurrent,prepareInstall,importFile,getInstalled,launch}){
 const $=id=>document.getElementById(id);
 let filters=DEFAULT_FILTERS(),sort='recommended',shelf=null,generation=0,items=[],checked=null,started=false,returnFocus=null,searchFailed=false,home=true,visibleLimit=36,lastQuery='';
 const details=new Map(),rejected=new Map();
 const analysisKey=data=>`${data.repository}@${data.commit}:${data.selectedEntry||data.recommendedEntry}`;
 const model=item=>{const data={...item,...details.get(item.id)};const matches=checked?.id===item.id&&checked.detail.commit===data.commit&&checked.selection===(data.selectedEntry||data.recommendedEntry);return discoveryModel(data,{analysis:matches?checked.analysis:rejected.get(analysisKey(data)),installed:getInstalled(item)});};
 const external=(url,text,style='button button-quiet')=>{const link=el('a',{href:httpsURL(url),target:'_blank',rel:'noopener noreferrer',referrerpolicy:'no-referrer',class:style},text,el('span',{'aria-hidden':'true'},' ↗'));link.setAttribute('aria-label',`${text} (opens in a new tab)`);return link;};
 function action(item,current,style='button button-primary',supplied,updateId){const p=current.primary;if(p.url)return external(p.url,p.label,style);if(p.type==='launch')return button(p.label,()=>launch(getInstalled(item).id),style);if(p.type==='details')return button('Details',()=>showDetails(item,supplied,updateId),style);return button(p.label,()=>checkInstall(item,supplied,updateId),style);}
 function card(item,order=sort){
  const current=model(item),name=el('h3',{class:'discover-title'},current.title);
  const title=el('div',{class:'discover-card-heading'},el('span',{class:'discover-glyph','aria-hidden':'true'},current.signals.glyph),el('div',{},name));
  const signals=el('ul',{class:'discover-signals','aria-label':'Project information'},...current.signals.tags.map(t=>el('li',{},t)),isChecked(item)?el('li',{class:'checked-label'},'Checked by SFHS'):null);
  const local=current.install.state==='needs-check'?'Install not checked':current.install.title;
  const capability=current.online?.state==='unavailable'?`Website unavailable · HTTP ${current.online.check.httpStatus}`:current.primary.type==='online'?(['incompatible','source-build','unavailable'].includes(current.install.state)?'Play online · This source can’t install':'Website link checked'):local;
  const actions=el('div',{class:'discover-actions'},action(item,current));if(current.primary.type!=='details')actions.append(button('Details',()=>showDetails(item),'button button-quiet'));else if(item.source==='github')actions.append(external(item.sourceUrl,'Source code'));
  return el('article',{class:'app-card discover-card','data-project':item.id},title,el('p',{class:'discover-description'},current.description),signals,el('p',{class:'discover-popularity'},popularityLabel(item,order)),el('div',{class:'discover-card-facts'},el('span',{},capability),el('span',{},current.licenseLabel)),actions);
 }
 function renderCards(){
  const positions=[...$('discover-grid').querySelectorAll('[data-shelf-scroll]')].map(n=>[n.dataset.shelfScroll,n.scrollLeft]);
  if(home){$('discover-grid').classList.add('storefront-home');$('discover-grid').replaceChildren(...shelves().map(s=>el('section',{class:'storefront-shelf','aria-labelledby':`shelf-${s.id}`,'data-shelf':s.id},el('div',{class:'shelf-heading'},el('div',{},el('h2',{id:`shelf-${s.id}`},s.title),el('p',{},s.note)),button('See all',()=>openShelf(s),'button button-quiet',)),el('div',{class:'shelf-track','data-shelf-scroll':s.id},...s.items.slice(0,4).map(i=>card(i,s.sort))))));for(const[id,x]of positions){const node=$('discover-grid').querySelector(`[data-shelf-scroll="${id}"]`);if(node)node.scrollLeft=x;}return;}
  $('discover-grid').classList.remove('storefront-home');$('discover-grid').replaceChildren(...items.slice(0,visibleLimit).map(i=>card(i)));
  if(items.length>visibleLimit)$('discover-grid').append(button(`Show more (${items.length-visibleLimit} remaining)`,()=>{visibleLimit+=36;renderCards();},'button button-secondary discover-more'));
  if(!items.length){const label=filterLabels(filters).join(' · ');$('discover-grid').append(el('div',{class:'discover-empty'},el('h2',{},searchFailed?'No results from the available sources.':`No ${label?label.toLowerCase()+' ':''}apps found${lastQuery?' for “'+lastQuery+'”':''}.`),el('p',{class:'muted'},'This index is limited. Try removing a filter or searching another source.'),el('div',{class:'discover-actions'},filters.open?button('Remove Open source',()=>{filters.open=false;syncControls();return run();},'button button-secondary'):null,filters.phone?button('Remove Phone',()=>{filters.phone=false;syncControls();return run();},'button button-secondary'):null,button('Clear all',clearAll,'button button-quiet'))));}
 }
 function syncControls(){ $('discover-source').value=filters.source;$('discover-open').checked=filters.open;$('discover-phone').checked=filters.phone;$('discover-offline').checked=filters.offline;for(const n of $('discover-browse').querySelectorAll('button'))n.setAttribute('aria-pressed',String(n.dataset.type==='all'?!filters.types.length:filters.types.includes(n.dataset.type))); }
 function renderBrowse(){ $('discover-browse').replaceChildren(...[['all','All software'],...TYPES].map(([id,label])=>{const b=button(label,()=>{shelf=null;filters.types=id==='all'?[]:filters.types.includes(id)?filters.types.filter(t=>t!==id):[...filters.types,id];syncControls();return run();},'browse-chip');b.dataset.type=id;return b;}));syncControls(); }
 function clearAll(){filters=DEFAULT_FILTERS();sort='recommended';shelf=null;$('discover-query').value='';$('discover-options').open=false;syncControls();return run();}
 function openShelf(s){filters={...DEFAULT_FILTERS(),...s.filters};sort=s.sort;shelf=s;$('discover-query').value='';syncControls();return run().then(()=>{$('discover-results-title').focus({preventScroll:true});$('discover-results-title').scrollIntoView({block:'start'});});}
 function browseChecked(){returnFocus=null;$('dialog-close').click();filters={...DEFAULT_FILTERS(),source:'checked'};sort='recommended';shelf=null;$('discover-query').value='';syncControls();return run().then(()=>{$('discover-grid').querySelector('.discover-actions .button-primary')?.focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});});}
 async function run(){
  started=true;const request=++generation;visibleLimit=36;
  filters.source=$('discover-source').value;filters.open=$('discover-open').checked;filters.phone=$('discover-phone').checked;filters.offline=$('discover-offline').checked;
  if(shelf&&(filters.source!==shelf.filters.source||(shelf.filters.phone&&!filters.phone)))shelf=null;
  const query=$('discover-query').value.trim();if(query!==lastQuery)shelf=null;lastQuery=query;
  home=!query&&!filterLabels(filters).length&&!shelf;
  $('discover-results-title').hidden=home;$('discover-results-title').textContent=home?'Browse software':query?'Search results':shelf?.title||'Browse results';
  $('discover-home').hidden=home;$('discover-sort-field').hidden=home;
  $('discover-active').textContent=filterLabels(filters).join(' · ')||'All software';$('discover-clear').hidden=home;
  $('discover-status').textContent=home?`itch.io index updated ${new Date(ITCH_UPDATED).toLocaleDateString(undefined,{month:'short',day:'numeric'})}`:'Finding software…';$('discover-grid').setAttribute('aria-busy','true');$('discover-errors').replaceChildren();
  let candidates=filterItems(storeItems(),DEFAULT_FILTERS(),query),errors=[];
  if(query&&filters.source!=='checked'&&filters.source!=='itch'){
   try{const result=await searchDiscovery({query,source:filters.source==='github'?'github':'all'});const combined=new Map();for(const i of [...result.items,...candidates]){const key=i.repository?'github:'+i.repository.toLowerCase():i.id;if(!combined.has(key))combined.set(key,i);else combined.set(key,{...i,...combined.get(key)});}candidates=[...combined.values()];errors=result.errors||[];}catch(e){errors=[{source:'GitHub',message:e.message}];}
  }
  if(request!==generation)return;
  const direct=parseGithubRepository(query);items=filterItems(candidates,filters,'');if(direct)items=items.filter(i=>i.repository?.toLowerCase()===direct.toLowerCase());
  if(shelf?.feed)items=items.filter(i=>Number.isFinite(feedRank(i,null,{feed:shelf.feed})));
  const sorts=availableSorts(items);if(!sorts.some(([id])=>id===sort))sort='recommended';$('discover-sort').replaceChildren(...sorts.map(([id,label])=>el('option',{value:id},label)));$('discover-sort').value=sort;
  items=sortItems(items,sort,{query,phone:filters.phone,feed:shelf?.feed});searchFailed=errors.length>0;
  if(!home)$('discover-status').textContent=`${items.length} ${items.length===1?'result':'results'}${query&&filters.source!=='itch'&&filters.source!=='checked'?' · includes live GitHub search':''}${filters.source==='itch'?' · itch.io indexed':''}`;
  if(!navigator.onLine)errors.unshift({source:'Offline',message:'Showing indexed software. Reconnect to search GitHub or use online apps.'});
  $('discover-errors').replaceChildren(...errors.map(e=>el('p',{},el('strong',{},`${e.source}: `),e.code==='rate-limit'?'GitHub search temporarily limited (rate limit reached). Showing indexed results.':e.message)));
  $('discover-source-info').textContent=SOURCE_INFO+(errors.length?' Source details: '+errors.map(e=>e.message).join(' '):'');
  renderCards();$('discover-grid').setAttribute('aria-busy','false');
 }
  function importFor(item) {
    importFile({kind:item.source==='itch'?'itch':'github',url:item.sourceUrl,repository:item.repository,license:item.license||{kind:'unknown'},acquisition:'User-selected download associated with this project; origin and release correspondence not independently verified.'});
  }
  function renderDetails(item, detail, updateId, error = '') {
    const data={...item,...detail}, current=model(data), installed=getInstalled(item);
    let selected=null;
    const secondary=[];
    if(data.source==='github' && (!detail || detail.installable) && !['incompatible','source-build','unavailable'].includes(current.install.state) && current.primary.type!=='check' && current.primary.type!=='install')secondary.push(button(current.install.state==='ready'?'Install':'Check install',()=>checkInstall(item,detail&&{...detail,selectedEntry:selected?.value||detail.recommendedEntry},updateId),'button button-quiet'));
    const primary=action(item,current,'button button-primary',detail,updateId);
    const body=el('div',{class:'stack discover-detail'},el('p',{class:'discover-detail-description'},current.description),
      el('ul',{class:'discover-signals','aria-label':'Project information'},...current.signals.tags.map(tag=>el('li',{},tag))),
      el('section',{class:'discover-options'},el('h3',{},'What you can do'),el('div',{class:'discover-actions'},current.primary.type==='details'?button('Browse checked apps',browseChecked,'button button-primary'):primary,...secondary,current.online?.state==='checked'&&current.primary.type!=='online'?external(current.online.url,current.signals.categories.includes('games')?'Play online':'Use online'):null,current.online?.state==='unverified'&&current.primary.type!=='website'?external(current.online.url,'Visit website (not checked)'):null,external(item.sourceUrl,item.source==='itch'?'Creator page':'Source code')),
        current.online?.state==='unavailable'?el('p',{class:'discover-error'},`The listed website returned HTTP ${current.online.check.httpStatus} when checked. It is not offered as playable.`):current.online?el('p',{class:'muted'},`${current.online.state==='checked'?'Website responded when checked '+new Date(current.online.check.checkedAt).toLocaleDateString()+'.':'The creator’s website has not been checked.'} Online use opens a separate tab; it does not keep a local copy.`):el('p',{class:'muted'},'No checked online version is listed.')),
      error?el('p',{class:'discover-error',role:'alert'},error):null,
      el('section',{class:'discover-verdict'},el('h3',{},current.install.title),el('p',{},current.install.summary),
        detail?.sourceNeedsBuild?el('p',{class:'muted'},'A live web version can still be used online when listed above.'):null,
        item.source==='itch'||current.downloads.length?button('Import a downloaded file',()=>importFor(data),'button button-quiet'):null,
        ['incompatible','source-build','unavailable'].includes(current.install.state)&&current.primary.type!=='details'?button('Browse apps you can install',browseChecked,'button button-quiet'):null),
      el('section',{},el('h3',{},'Local preservation'),el('dl',{class:'discover-facts'},
        el('dt',{},'Local copy'),el('dd',{},installed?'Installed on this device':'Not installed'),
        el('dt',{},'Save backup'),el('dd',{},installed?`${installed.versions.find(v=>v.id===installed.activeVersionId)?.saveSupport||'Unknown'} support · see Library details`:'Not applicable yet'),
        el('dt',{},'Phone'),el('dd',{},`${current.phone.label}${current.phone.state==='indicated'?' · based on project metadata':''}. No physical test recorded here.`),
        el('dt',{},'Offline'),el('dd',{},current.offline.label,current.offline.hint?' · project mentions offline use; no offline test recorded.':''))),
      el('section',{},el('h3',{},'License'),el('p',{},current.licenseLabel)));
    if(current.downloads.length)body.append(el('section',{class:'stack'},el('h3',{},'Downloads from the project'),el('p',{class:'muted'},'HTML / ZIP downloads are listed below. Their format and compatibility still need checking after import.'),...current.downloads.map(download=>external(download.url,download.name,'button button-secondary'))));
    const technical=el('details',{class:'discover-technical'},el('summary',{},'Technical details'));
    if(Number.isFinite(item.stars))technical.append(el('p',{},item.stars.toLocaleString()+' stars on GitHub (interest, not app reviews).'));
    if(item.indexedAt)technical.append(el('p',{},'GitHub metadata indexed '+new Date(item.indexedAt).toLocaleString()));
    if(item.classificationEvidence)technical.append(el('p',{},item.classificationEvidence));
    for(const feed of item.feeds||[])technical.append(el('p',{},'Source position '+feed.rank+' · '+feed.label+' · ',external(feed.url,'Browse source','button button-quiet')));

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
    const cached=supplied||details.get(item.id)||checkedPackageDetail(item);
    if(cached)details.set(item.id,cached);
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
    let detail=supplied||details.get(item.id)||checkedPackageDetail(item);
    try {
      detail=detail||await inspectGithub(item);details.set(item.id,detail);renderCards();
      if(!dialogCurrent(revision))return;
      if(!detail.installable){renderDetails(item,detail,updateId);return;}
      const selection=detail.selectedEntry||detail.recommendedEntry;
      const payload=checked?.id===item.id && checked.detail.commit===detail.commit && checked.selection===selection?checked.payload:await acquireGithub(item,detail);
      if(!dialogCurrent(revision))return;
      await prepareInstall(payload.bytes,payload.filename,payload.source,updateId,false,{discovery:true,name:model(item).title,description:model(item).description,category:model(item).signals.categories.includes('games')?'Games':'Utilities',isCurrent:()=>dialogCurrent(revision),onIncompatible:()=>renderDetails(item,detail,updateId),onAnalysis:analysis=>{checked={id:item.id,detail,selection,payload,analysis};const key=analysisKey({...detail,selectedEntry:selection});if(analysis.compatible)rejected.delete(key);else rejected.set(key,{compatible:false,offline:analysis.offline,reasons:analysis.reasons});renderCards();}});
    }catch(error){if(dialogCurrent(revision))renderDetails(item,detail,updateId,`Local installation could not be checked: ${error.message}`);}
  }

 function init(){
  renderBrowse();$('discover-source-info').textContent=SOURCE_INFO;
  $('discover-home').addEventListener('click',clearAll);$('discover-clear').addEventListener('click',clearAll);
  $('discover-phone').addEventListener('change',run);$('discover-offline').addEventListener('change',run);
  $('discover-sort').addEventListener('change',()=>{sort=$('discover-sort').value;return run();});
  $('dialog').addEventListener('close',()=>{if($('view-discover').hidden){returnFocus=null;return;}if(!returnFocus)return;const y=scrollY;renderCards();const c=[...$('discover-grid').querySelectorAll('[data-project]')].find(n=>n.dataset.project===returnFocus.id);const target=c&&([...c.querySelectorAll('button,a')].find(n=>n.textContent.trim()===returnFocus.text)||c.querySelector('button,a'));target?.focus({preventScroll:true});window.scrollTo({top:y,behavior:'instant'});returnFocus=null;});
 }
 return {run,showDetails,init,start:()=>{if(!started)return run();renderCards();}};
}
