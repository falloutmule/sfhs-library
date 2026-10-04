import bundledCatalog from '../public/catalog.json' with { type: 'json' };
import { zipSync } from 'fflate';

const API = 'https://api.github.com';
const MAX_FILES = 500;
const MAX_BYTES = 40 * 1024 * 1024;
const OPEN_LICENSES = new Set(['0BSD', 'MIT', 'MIT-0', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'BSD-3-Clause-Clear', 'ISC', 'Zlib', 'Unlicense', 'CC0-1.0', 'MPL-2.0', 'BSL-1.0', 'Artistic-2.0', 'EPL-1.0', 'EPL-2.0', 'EUPL-1.1', 'EUPL-1.2', 'GPL-2.0', 'GPL-2.0-only', 'GPL-2.0-or-later', 'GPL-3.0', 'GPL-3.0-only', 'GPL-3.0-or-later', 'LGPL-2.1', 'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-3.0', 'LGPL-3.0-only', 'LGPL-3.0-or-later', 'AGPL-3.0', 'AGPL-3.0-only', 'AGPL-3.0-or-later']);
const SOURCE_LICENSES = new Set(['BUSL-1.1', 'SSPL-1.0', 'PolyForm-Noncommercial-1.0.0', 'PolyForm-Small-Business-1.0.0']);
const cache = new Map();
const inspectedRepositories = new Map();
let catalog = bundledCatalog;
let catalogChecked = false;
let rateLimit;

export class DiscoveryError extends Error {
  constructor(message, code = 'network', rate = undefined) {
    super(message); this.name = 'DiscoveryError'; this.code = code; this.rateLimit = rate;
  }
}

// Public source and an unrecognized SPDX expression are deliberately not proof of openness.
export function classifyLicense(value, sourceUrl = null) {
  const id = typeof value === 'string' ? value : value?.spdx_id;
  const spdx = id && id !== 'NOASSERTION' && id !== 'NONE' ? id : null;
  return { spdx, kind: OPEN_LICENSES.has(spdx) ? 'open' : SOURCE_LICENSES.has(spdx) ? 'source-available' : 'unknown', sourceUrl };
}

export function parseGithubRepository(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(?:https:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  if (!match || match[1] === '.' || match[1] === '..' || match[2] === '.' || match[2] === '..') return null;
  return `${match[1]}/${match[2]}`;
}

function repositoryOf(item) {
  const result = parseGithubRepository(typeof item === 'string' ? item : item.repository || item.sourceUrl);
  if (!result) throw new DiscoveryError('Use a public github.com/owner/repository URL.', 'invalid-repository');
  return result;
}

function apiPath(repository) { return repository.split('/').map(encodeURIComponent).join('/'); }
function rawURL(repository, sha, path) { return `https://raw.githubusercontent.com/${apiPath(repository)}/${sha}/${path.split('/').map(encodeURIComponent).join('/')}`; }
function validPath(path) { return typeof path === 'string' && path.length < 1000 && !path.startsWith('/') && !path.includes('\\') && !path.split('/').some(p => p === '..' || p === '.' || !p) && !/[\x00-\x1f]/.test(path); }
function signal() { return AbortSignal.timeout(25000); }

async function boundedBytes(response, maximum) {
  const announced = Number(response.headers.get('content-length'));
  if (announced > maximum) throw new DiscoveryError(`The download exceeds its ${Math.round(maximum / 1024)} KiB limit.`, 'size-limit');
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > maximum) throw new DiscoveryError('The download exceeds its size limit.', 'size-limit');
    return bytes;
  }
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) { await reader.cancel(); throw new DiscoveryError('The download exceeds its size limit.', 'size-limit'); }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}

async function github(path, { optional = false, ttl = 120000 } = {}) {
  const stored = cache.get(path);
  if (stored && stored.expires > Date.now()) return stored.value;
  let response;
  try { response = await fetch(`${API}${path}`, { headers: { Accept: 'application/vnd.github+json' }, signal: signal(), credentials: 'omit', referrerPolicy: 'no-referrer' }); }
  catch { throw new DiscoveryError('GitHub is unavailable. Check your connection; your installed library still works locally.'); }
  const remainingHeader = response.headers.get('x-ratelimit-remaining');
  if (remainingHeader !== null) rateLimit = { remaining: Number(remainingHeader), limit: Number(response.headers.get('x-ratelimit-limit')), resetAt: Number(response.headers.get('x-ratelimit-reset')) * 1000, resource: response.headers.get('x-ratelimit-resource') || 'core' };
  if ((response.status === 403 && (rateLimit?.remaining === 0 || response.headers.has('retry-after'))) || response.status === 429) {
    const reset = rateLimit?.resetAt ? ` Try again after ${new Date(rateLimit.resetAt).toLocaleTimeString()}.` : ' Please wait before trying again.';
    throw new DiscoveryError(`GitHub API rate limit reached.${reset} No token or proxy is used.`, 'rate-limit', rateLimit);
  }
  if (optional && response.status === 404) return null;
  if (!response.ok) throw new DiscoveryError(response.status === 404 ? 'This public GitHub repository or file was not found.' : `GitHub returned HTTP ${response.status}. Please try later.`, 'http', rateLimit);
  let value;
  try { value = JSON.parse(new TextDecoder().decode(await boundedBytes(response, 8 * 1024 * 1024))); }
  catch (error) { if (error instanceof DiscoveryError) throw error; throw new DiscoveryError('GitHub returned an unreadable response.', 'response'); }
  cache.set(path, { value, expires: Date.now() + ttl });
  return value;
}

function repositoryItem(repo) {
  const repository = repo.full_name;
  return { id: `github:${repository}`, title: repo.name, description: repo.description || 'Public GitHub repository. Inspect its payload before installing.', source: 'github', sourceUrl: `https://github.com/${repository}`, repository, license: classifyLicense(repo.license, `https://github.com/${repository}`), installability: 'inspect', tags: repo.topics || [], updatedAt: repo.pushed_at || repo.updated_at, stars: repo.stargazers_count || 0, archived: !!repo.archived, homepage: /^https?:\/\//i.test(repo.homepage || '') ? repo.homepage : null, ...inspectedRepositories.get(repository) };
}

export function rankItems(items, query = '') {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const score = item => {
    const title = (item.title || '').toLowerCase();
    const text = `${title} ${item.description || ''} ${(item.tags || []).join(' ')}`.toLowerCase();
    const relevant = words.reduce((n, word) => n + (title.includes(word) ? 35 : text.includes(word) ? 20 : -20), 0);
    const compatibility = item.installable === false ? -70 : item.installable === true ? 30 : 0;
    const licensing = { open: 12, 'source-available': 7, proprietary: 3, unknown: 0 }[item.license?.kind] || 0;
    const mobile = /mobile|touch/.test(text) ? 4 : 0;
    const offline = /offline/.test(text) ? 3 : 0;
    const simplicity = /single[- ]file|standalone/.test(text) ? 2 : 0;
    const freshness = item.updatedAt && Date.now() - new Date(item.updatedAt).getTime() < 365 * 86400000 ? 2 : 0;
    return relevant + compatibility + licensing + mobile + offline + simplicity + freshness + (item.archived ? -3 : 0);
  };
  return [...items].sort((a, b) => score(b) - score(a) || (b.stars || 0) - (a.stars || 0) || a.title.localeCompare(b.title));
}

async function refreshCatalog() {
  if (catalogChecked || typeof location === 'undefined' || location.protocol !== 'https:') return;
  catalogChecked = true;
  try {
    const response = await fetch(new URL('./catalog.json', location.href), { signal: AbortSignal.timeout(6000), credentials: 'omit' });
    if (!response.ok) return;
    const newer = JSON.parse(new TextDecoder().decode(await boundedBytes(response, 2 * 1024 * 1024)));
    if (newer.schemaVersion === 1 && Array.isArray(newer.items) && newer.items.length <= 1000 && Date.parse(newer.updatedAt) > Date.parse(catalog.updatedAt)) {
      catalog = { ...newer, items: newer.items.filter(item => item.source === 'itch' && /^https:\/\/[a-z0-9-]+\.itch\.io\/[\w-]+\/?$/i.test(item.sourceUrl || '')).map(item => ({ ...item, license: { spdx: null, kind: 'unknown', sourceUrl: item.sourceUrl }, installability: 'import' })) };
    }
  } catch { /* The bundled index remains usable offline. */ }
}

export async function searchDiscovery({ query = '', source = 'all', openOnly = false } = {}) {
  query = String(query).trim().slice(0, 200);
  const items = [];
  const messages = [];
  if (source !== 'github') {
    await refreshCatalog();
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    items.push(...catalog.items.filter(item => words.every(word => `${item.title} ${item.description} ${(item.tags || []).join(' ')}`.toLowerCase().includes(word))));
    messages.push(`Indexed itch.io catalog · ${catalog.items.length} projects · refreshed ${catalog.updatedAt ? new Date(catalog.updatedAt).toLocaleString() : 'not yet'}. This is not a live search of all itch.io.`);
  }
  if (source !== 'itch') {
    try {
      const direct = parseGithubRepository(query);
      if (direct) { items.push(repositoryItem(await github(`/repos/${apiPath(direct)}`))); messages.push('GitHub public repository found. Inspect its current payload before installation.'); }
      else {
        const q = query ? `${query} in:name,description archived:false` : 'topic:html5-game archived:false';
        const results = await github(`/search/repositories?q=${encodeURIComponent(q)}&per_page=30&sort=stars&order=desc`);
        items.push(...(results.items || []).map(repositoryItem));
        messages.push(`GitHub: ${Math.min(results.total_count || 0, 30)} of ${Number(results.total_count || 0).toLocaleString()} matching repositories; inspect compatibility before installation.`);
      }
    } catch (error) { messages.push(error.message || 'GitHub search failed.'); }
  }
  const filtered = openOnly ? items.filter(item => item.license?.kind === 'open') : items;
  if (openOnly) messages.push('Open only includes recognized explicit open licenses; unknown licenses are excluded.');
  return { items: rankItems(filtered, query), status: messages.join(' '), updatedAt: catalog.updatedAt, rateLimit };
}

function packageFiles(tree, root) {
  return tree.filter(file => file.type === 'blob' && (file.mode === '100644' || file.mode === '100755') && validPath(file.path) && (!root || file.path.startsWith(`${root}/`)) && !file.path.split('/').some(p => p.startsWith('.') || p === 'node_modules'));
}

export function entryCandidates(tree) {
  const htmlFiles = tree.filter(file => file.type === 'blob' && /\.html?$/i.test(file.path) && validPath(file.path) && !/(?:^|\/)(?:node_modules|test|tests|examples|coverage|\.git)(?:\/|$)/.test(file.path));
  const conventional = htmlFiles.filter(file => /(?:^|\/)(?:index|game|app)\.html?$/i.test(file.path));
  const candidates = conventional.length ? conventional : htmlFiles.length === 1 ? htmlFiles : [];
  return candidates.map(file => {
    const root = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
    const files = packageFiles(tree, root);
    const totalBytes = files.reduce((sum, entry) => sum + (entry.size || 0), 0);
    const reason = files.length > MAX_FILES ? `This directory has ${files.length} files; the limit is ${MAX_FILES}. Download a built HTML/ZIP and import it.` : totalBytes > MAX_BYTES ? 'This directory exceeds 40 MiB. Download a smaller built package and import it.' : null;
    return { path: file.path, root, fileCount: files.length, totalBytes, reason };
  }).sort((a, b) => {
    const priority = entry => (/^(?:dist|build|docs|public)\/index\.html?$/.test(entry.path) ? 0 : /^index\.html?$/.test(entry.path) ? 1 : 2) + (entry.reason ? 20 : 0);
    return priority(a) - priority(b) || a.path.length - b.path.length;
  });
}

async function rawText(repository, commit, path, maximum = 512000) {
  let response;
  try { response = await fetch(rawURL(repository, commit, path), { signal: signal(), credentials: 'omit', referrerPolicy: 'no-referrer' }); }
  catch { throw new DiscoveryError('GitHub raw download is unavailable or blocked by this network. Download normally, then import the file.'); }
  if (!response.ok) throw new DiscoveryError(`GitHub file download returned HTTP ${response.status}.`, 'download');
  return new TextDecoder().decode(await boundedBytes(response, maximum));
}

export async function inspectGithub(item) {
  const repository = repositoryOf(item);
  const base = `/repos/${apiPath(repository)}`;
  const metadata = await github(base);
  const commitInfo = await github(`${base}/commits/${encodeURIComponent(metadata.default_branch)}`);
  const commit = commitInfo.sha;
  if (!/^[a-f0-9]{40}$/i.test(commit)) throw new DiscoveryError('GitHub did not supply an immutable commit identifier.', 'response');
  const [treeResult, releaseResult, licenseResult] = await Promise.allSettled([
    github(`${base}/git/trees/${commit}?recursive=1`),
    github(`${base}/releases?per_page=5`, { optional: true }),
    github(`${base}/license?ref=${commit}`, { optional: true })
  ]);
  if (treeResult.status !== 'fulfilled') throw treeResult.reason;
  const tree = treeResult.value.tree || [];
  const notes = [];
  if (releaseResult.status === 'rejected') notes.push(`Release metadata: ${releaseResult.reason.message}`);
  if (licenseResult.status === 'rejected') notes.push(`License file metadata: ${licenseResult.reason.message}`);
  const licenseData = licenseResult.status === 'fulfilled' ? licenseResult.value : null;
  const license = classifyLicense(licenseData?.license || metadata.license, licenseData?.html_url || null);
  const entries = entryCandidates(tree);
  const recommended = entries.find(entry => !entry.reason);
  let installReason = recommended ? 'Static entry HTML found. The full package still needs compatibility analysis before it can be installed.' : entries[0]?.reason || 'No ready-to-run entry HTML found. This repository may need a build or server; download a browser release and import its HTML/ZIP.';
  let installable = !!recommended && !treeResult.value.truncated;
  if (treeResult.value.truncated) installReason = 'GitHub truncated this repository tree. A complete payload cannot be acquired reliably; download a browser release and import it.';
  let entryPreview = '';
  let readme = '';
  const readmeEntry = tree.find(file => file.type === 'blob' && /^readme(?:\.md|\.txt|\.rst)?$/i.test(file.path));
  const textResults = await Promise.allSettled([
    recommended ? rawText(repository, commit, recommended.path, MAX_BYTES) : Promise.resolve(''),
    readmeEntry && readmeEntry.size <= 512000 ? rawText(repository, commit, readmeEntry.path) : Promise.resolve('')
  ]);
  if (textResults[0].status === 'fulfilled') entryPreview = textResults[0].value;
  else { installable = false; installReason = textResults[0].reason.message; }
  if (textResults[1].status === 'fulfilled') readme = textResults[1].value.slice(0, 16000);
  if (/<script\b[^>]*\bsrc\s*=\s*["'][^"']*\.(?:tsx?|jsx|vue)(?:[?"'])|<%|\{\%/.test(entryPreview)) {
    installable = false; installReason = 'The entry HTML references source that needs a build or server-side templates. Obtain a built browser release and import it.';
  }
  const releases = releaseResult.status === 'fulfilled' ? (releaseResult.value || []).map(release => ({ tag: release.tag_name, name: release.name, url: release.html_url, publishedAt: release.published_at, assets: (release.assets || []).map(asset => ({ name: asset.name, url: asset.browser_download_url, size: asset.size })) })) : [];
  inspectedRepositories.set(repository, { installable, installReason });
  return { ...repositoryItem(metadata), repository, license, commit, branch: metadata.default_branch, entryCandidates: entries, recommendedEntry: recommended?.path || null, installable, installReason, tree, releases, readme, notes, hasPages: !!metadata.has_pages, entryPreview: entryPreview.slice(0, 4000), licenseCaveat: 'Repository license detection does not verify the licenses of every bundled dependency.' };
}

export async function acquireGithub(item, detail = undefined) {
  const repository = repositoryOf(item);
  const inspected = detail || await inspectGithub(item);
  if (inspected.repository !== repository || !/^[a-f0-9]{40}$/i.test(inspected.commit)) throw new DiscoveryError('Repository inspection does not match this download. Inspect it again.', 'inspection');
  if (!inspected.installable) throw new DiscoveryError(inspected.installReason || 'No complete static browser package is available.', 'external-only');
  const entry = inspected.entryCandidates.find(candidate => candidate.path === (inspected.selectedEntry || inspected.recommendedEntry));
  if (!entry || entry.reason) throw new DiscoveryError(entry?.reason || 'No supported HTML entry was selected.', 'external-only');
  const files = packageFiles(inspected.tree, entry.root);
  if (!files.length || files.length > MAX_FILES || files.reduce((n, file) => n + (file.size || 0), 0) > MAX_BYTES) throw new DiscoveryError('This package exceeds the 500 file / 40 MiB download limit.', 'size-limit');
  const archive = Object.create(null);
  let next = 0;
  let received = 0;
  async function worker() {
    while (next < files.length) {
      const file = files[next++];
      let response;
      try { response = await fetch(rawURL(repository, inspected.commit, file.path), { signal: signal(), credentials: 'omit', referrerPolicy: 'no-referrer' }); }
      catch { throw new DiscoveryError(`Cannot retrieve ${file.path}. The server or browser blocked the download. Download normally, then import.`, 'download'); }
      if (!response.ok) throw new DiscoveryError(`Cannot retrieve ${file.path} (HTTP ${response.status}). No partial installation was created.`, 'download');
      const bytes = await boundedBytes(response, MAX_BYTES);
      received += bytes.length;
      if (received > MAX_BYTES) throw new DiscoveryError('The complete package exceeds 40 MiB.', 'size-limit');
      if (typeof file.size === 'number' && bytes.length !== file.size) throw new DiscoveryError(`The acquired file size does not match GitHub metadata: ${file.path}.`, 'integrity');
      archive[entry.root ? file.path.slice(entry.root.length + 1) : file.path] = [bytes, { mtime: new Date(2020, 0, 1) }];
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker));
  return { bytes: zipSync(archive, { level: 0 }), filename: `${repository.replace('/', '-')}-${inspected.commit.slice(0, 8)}.zip`, source: { kind: 'github', url: `https://github.com/${repository}/tree/${inspected.commit}`, repository, version: inspected.commit, license: inspected.license, entry: entry.root ? entry.path.slice(entry.root.length + 1) : entry.path, acquisition: 'Immutable repository files assembled into a ZIP; not an upstream release archive.' } };
}

export function resetDiscoveryCache() { cache.clear(); inspectedRepositories.clear(); rateLimit = undefined; catalog = bundledCatalog; catalogChecked = false; }
