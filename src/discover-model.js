// Project identity and usable representations are independent. None of these
// metadata hints can grant runtime permissions or establish an installation.
import {checkedRecord,websiteCheck} from './checked-catalog.js';
export const BROWSE_CATEGORIES = [
  { id: 'all', label: 'All software', query: 'topic:html5-game' },
  { id: 'games', label: 'Games', query: 'topic:html5-game' },
  { id: 'tools', label: 'Tools', query: 'browser tool in:description language:JavaScript' },
  { id: 'creative', label: 'Creative', query: 'drawing in:name,description language:JavaScript' },
  { id: 'maker', label: 'Maker / CAD', query: 'cad in:name,description language:JavaScript' },
  { id: 'music', label: 'Music', query: 'music browser in:description language:JavaScript' },
  { id: 'productivity', label: 'Productivity', query: 'productivity in:name,description language:JavaScript' },
  { id: 'phone', label: 'Phone / Touch', query: 'topic:mobile language:JavaScript' },
  { id: 'offline', label: 'Offline', query: 'offline in:name,description language:JavaScript' }
];
const RULES = [
  ['games', 'Game', '♟', /\b(game|games|gaming|puzzle|air[- ]hockey|platformer|roguelike|html5-game|visual novel)\b/i],
  ['maker', 'Maker / CAD', '▧', /\b(cad|3d[- ]print|3d[- ]model|parametric|fabrication|maker|laser[- ]cut|openscad)\b/i],
  ['music', 'Music', '♫', /\b(music|synthesizer|synth|sequencer|daw|midi|audio editor)\b/i],
  ['creative', 'Creative', '◇', /\b(drawing|painting|paint|illustration|pixel[- ]art|image editor|creative|design tool)\b/i],
  ['productivity', 'Productivity', '✓', /\b(productivity|todo|to-do|task manager|notes|note-taking|timer|time[- ]track|pomodoro|calendar)\b/i],
  ['tools', 'Tool', '⌘', /\b(tool|tools|utility|utilities|editor|calculator|converter|developer|development)\b/i]
];
export function httpsURL(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
export function readableName(title = '') {
  return String(title).replace(/[-_]+/g, ' ').replace(/(^|\s)[a-z]/g, c => c.toUpperCase())
    .replace(/\b(Html5?|Sfhs|Cad|Wasm|Api|Ui)\b/g, word => word.toUpperCase());
}
export function readmeSummary(readme = '') {
  const plain = String(readme).replace(/```[\s\S]*?```/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<[^>]*>/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_]/g, '');
  return plain.split(/\n\s*\n/).map(p => p.trim()).find(p => p.length >= 30 && !/^(?:#|\||\[|[-=]{3}|https?:|license\b|installation\b|npm\b)/i.test(p))?.replace(/\s+/g, ' ').slice(0, 600) || '';
}
export function projectSignals(item) {
  const text = `${item.title || ''} ${item.description || ''} ${(item.tags || []).join(' ')}`;
  const categories = RULES.filter(([id, , , rule]) => item.source==='itch'?id==='games':item.categories?.includes(id) || rule.test(text));
  if (item.source === 'itch' && !categories.some(([id]) => id === 'games')) categories.unshift(RULES[0]); // Catalog comes from itch's HTML5 games feeds.
  const phone = /\b(mobile|android|ios|iphone|ipad|phone|touch|touchscreen)\b/i.test(text) && !/\b(?:not|no) (?:for |on |compatible with )?(?:mobile|phones?|touch)\b/i.test(text);
  const offlineHint = /\boffline\b/i.test(text) && !/\b(?:not|no) offline\b/i.test(text);
  const tags = categories.slice(0, 2).map(([, label]) => label);
  if (phone) tags.push('Phone / touch indicated');
  if (/\b(two[- ]player|2[- ]player)\b/i.test(text)) tags.push('2 players');
  else if (/\blocal multiplayer\b/i.test(text)) tags.push('Local multiplayer');
  return { categories: categories.map(([id]) => id), glyph: categories[0]?.[2] || '▤', tags: tags.slice(0, 4), phone, offlineHint };
}
export function matchesBrowse(item, category) {
  const signals = projectSignals(item);
  return !category || category === 'all' || (category === 'phone' ? signals.phone : category === 'offline' ? signals.offlineHint : signals.categories.includes(category));
}
export function onlineVersion(item) {
  if (item.source === 'itch') return null; // A creator page alone does not prove a playable browser version.
  const url = httpsURL(item.pagesURL || item.homepage);
  if (!url) return null;
  const parsed = new URL(url);
  if (/^(?:www\.)?(?:github\.com|npmjs\.com|pypi\.org)$/i.test(parsed.hostname) || /(?:^|\.)(?:readthedocs\.(?:io|org))$/i.test(parsed.hostname) || /\.(?:zip|exe|dmg|apk|pdf)$/i.test(parsed.pathname)) return null;
  const signals = projectSignals(item);
  const looksLikeApp = signals.categories.length || /\b(browser|web app|application)\b/i.test(`${item.description || ''} ${(item.tags || []).join(' ')}`);
  if (!(item.hasPages || item.has_pages || item.pagesURL || looksLikeApp) || /\/(?:docs|documentation|reference)(?:\/|$)/i.test(parsed.pathname)) return null;
  const check=websiteCheck(url) || (httpsURL(item.websiteCheck?.url)===url?item.websiteCheck:null);
  const fresh=check && Date.now()-Date.parse(check.checkedAt)<7*86400000 && Date.now()>=Date.parse(check.checkedAt)-86400000;
  const state=fresh?(check.status==='responding'?'checked':check.status==='unavailable'?'unavailable':'unverified'):'unverified';
  return {url,state,check:fresh?check:null,evidence:item.hasPages||item.has_pages||item.pagesURL?'GitHub Pages / repository homepage':'Repository-declared app homepage'};
}
export function explainInstallFailure(reasons=[]){
  const text=reasons.join(' ');
  if(/Dynamic code evaluation/.test(text))return 'This app creates JavaScript while it runs. Library blocks that feature in its isolated player.';
  if(/IndexedDB/.test(text))return 'This app uses a browser database that Library cannot yet preserve and restore safely.';
  if(/workers? are not supported/i.test(text))return 'This app needs background browser workers that Library’s player does not support.';
  if(/not found|missing|unresolved/i.test(text))return 'This version is missing files needed to run. A complete browser release is required.';
  return reasons[0] || 'This version needs browser features Library cannot currently preserve or run safely.';
}
export function browserDownloads(item) {
  const repository = item.repository;
  if (!repository) return [];
  const prefix = `https://github.com/${repository}/releases/download/`;
  return (item.releases || []).flatMap(release => (release.assets || []).filter(asset =>
    /\.(?:html?|zip)$/i.test(asset.name || '') && httpsURL(asset.url)?.startsWith(prefix)
  ).map(asset => ({ ...asset, tag: release.tag, releaseURL: httpsURL(release.url) }))).slice(0, 12);
}
export function discoveryModel(item, { analysis = null, installed = null } = {}) {
  analysis=analysis || checkedRecord(item)?.analysis || null;
  const signals = projectSignals(item), online = onlineVersion(item), downloads = browserDownloads(item);
  const description = item.description?.trim() || readmeSummary(item.readme) || 'No description provided by the project. Open Details for source information.';
  let install = { state: 'needs-check', title: 'Install not checked', summary: 'Check whether a complete browser app can be kept on this device.' };
  if (item.source === 'itch') install = { state: 'needs-download', title: 'Download then import', summary: 'Visit the creator’s page. If an HTML or ZIP download is offered, get it normally and import it here.' };
  if (item.inspected && !item.installable) install = item.sourceNeedsBuild
    ? { state: 'source-build', title: 'Source needs a build', summary: 'The repository contains development source. It needs a browser build before it can be installed.' }
    : { state: 'unavailable', title: 'Can’t install from this source', summary: 'No complete browser package could be acquired from the inspected source.' };
  if (item.inspected && item.installable) install.summary = 'A browser package was found. Check compatibility before installing it.';
  if (analysis) install = analysis.compatible
    ? { state: 'ready', title: 'Ready to install', summary: 'This version passed the local package checks. Install to retain its original file and a runnable copy.' }
    : { state: 'incompatible', title: 'Not compatible', summary: explainInstallFailure(analysis.reasons) };
  // A retained local version does not establish that the current upstream
  // source representation can be installed. Keep both facts independently.
  const installedVersion=installed?.versions?.find(version=>version.id===installed.activeVersionId);
  const phone = { state: signals.phone ? 'indicated' : 'unknown', label: signals.phone ? 'Phone / touch indicated' : 'Phone support unknown' };
  const offlineRecord=installedVersion||analysis;
  const offlineState = offlineRecord?.offline === 'network' ? 'network' : offlineRecord?.offline === 'candidate' && (installedVersion||analysis?.compatible) ? 'candidate' : 'unknown';
  const offline = { state: offlineState, label: {network:'Uses network',candidate:'Offline candidate',unknown:'Offline not verified'}[offlineState], hint: signals.offlineHint };
  const license = item.license || { kind: 'unknown', spdx: null };
  const licenseLabel = license.spdx ? `${license.spdx}${license.kind === 'open' ? ' · open license' : ''}` : license.kind === 'proprietary' ? 'Proprietary / freeware' : license.kind === 'source-available' ? 'Source available license' : 'License unknown';
  let primary = install.state==='ready' ? {type:'install',label:'Install'} : online?.state==='checked' ? { type: 'online', label: signals.categories.includes('games') ? 'Play online' : 'Use online', url: online.url }
    : item.source === 'itch' ? { type: 'creator', label: 'View on itch.io', url: httpsURL(item.sourceUrl) }
    : ['source-build','unavailable','incompatible'].includes(install.state) ? downloads.length
      ? { type: 'download', label: 'Download & import', url: downloads[0].url } : { type: 'details', label: 'Details' }
      : { type: install.state === 'ready' ? 'install' : 'check', label: install.state === 'ready' ? 'Install' : 'Check install' };
  if(online?.state==='unverified' && primary.type==='details')primary={type:'website',label:'Visit website',url:online.url};
  if (installed) primary = { type: 'launch', label: 'Launch local app' };
  return { title: readableName(item.title), description, signals, online, downloads, install, phone, offline, licenseLabel, primary, localCopy:installed?'installed':'not-installed', analysisReasons:analysis?.reasons||[],
    capabilities: { online: online?.state==='checked' ? 'yes' : online?.state==='unavailable'?'no':'unknown', install: install.state === 'ready' ? 'yes' : ['source-build','unavailable','incompatible'].includes(install.state) ? 'no' : 'needs-check',
      downloadImport: downloads.length ? 'yes' : 'unknown', source: item.source === 'github' ? 'yes' : 'unknown', openLicense: license.kind === 'open' ? 'yes' : license.kind === 'unknown' ? 'unknown' : 'no', phone: phone.state, offline: offline.state } };
}
