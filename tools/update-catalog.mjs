import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FEEDS = ['https://itch.io/games/html5.xml', 'https://itch.io/games/newest/html5.xml', 'https://itch.io/games/html5/tag-open-source.xml'];
const DESTINATION = fileURLToPath(new URL('../public/catalog.json', import.meta.url));

export function decodeXML(value) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&#(x[0-9a-f]+|\d+);/gi, (_, number) => {
    const point = number[0].toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : parseInt(number, 10);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
  }).replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[entity]);
}

function field(xml, name) { return decodeXML(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] || '').trim(); }
function plain(value) { return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }

export function parseFeed(xml, sourceUrl) {
  if (!/<rss\b/i.test(xml) || /<!ENTITY/i.test(xml)) throw new Error('Expected a public RSS feed without entity declarations.');
  const items = [];
  for (const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const title = plain(field(match[1], 'title')).slice(0, 180);
    const link = field(match[1], 'link');
    let url;
    try { url = new URL(link); } catch { continue; }
    if (!['https:', 'http:'].includes(url.protocol) || !/^[a-z0-9-]+\.itch\.io$/i.test(url.hostname) || !/^\/[\w-]+\/?$/.test(url.pathname)) continue;
    url.protocol = 'https:'; url.search = ''; url.hash = '';
    if (!title) continue;
    const date = field(match[1], 'pubDate');
    const updatedAt = Number.isNaN(Date.parse(date)) ? null : new Date(date).toISOString();
    items.push({ id: `itch:${url.hostname}${url.pathname.replace(/\/$/, '')}`, title, description: plain(field(match[1], 'description')).slice(0, 280), source: 'itch', sourceUrl: url.href.replace(/\/$/, ''), license: { spdx: null, kind: 'unknown', sourceUrl: url.href }, installability: 'import', tags: ['HTML5', ...(sourceUrl.includes('tag-open-source') ? ['creator-tagged open source; license unverified'] : [])], updatedAt, indexedFrom: sourceUrl });
  }
  if (!items.length) throw new Error('The feed did not contain any recognized itch project items.');
  return items;
}

export async function updateCatalog({ fetcher = fetch, output = DESTINATION, feeds = FEEDS, now = new Date() } = {}) {
  let previous = { schemaVersion: 1, updatedAt: null, sources: [], items: [] };
  try { previous = JSON.parse(await readFile(output, 'utf8')); } catch { /* First generation. */ }
  const results = await Promise.allSettled(feeds.map(async url => {
    const response = await fetcher(url, { signal: AbortSignal.timeout(25000), headers: { 'User-Agent': 'SFHS-Library-Catalog/1.0 (public RSS index; no application downloads)', Accept: 'application/rss+xml, application/xml, text/xml' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    if (xml.length > 3 * 1024 * 1024) throw new Error('Feed exceeds the 3 MiB limit.');
    return parseFeed(xml, url);
  }));
  const items = new Map();
  const sources = [];
  let successful = 0;
  for (let index = 0; index < feeds.length; index++) {
    const result = results[index];
    const url = feeds[index];
    if (result.status === 'fulfilled') {
      successful++;
      sources.push({ url, refreshedAt: now.toISOString(), count: result.value.length });
      for (const item of result.value) items.set(item.id, item);
    } else {
      const old = previous.sources.find(source => source.url === url);
      sources.push({ ...old, url, error: String(result.reason?.message || result.reason), attemptedAt: now.toISOString() });
      for (const item of previous.items.filter(item => item.indexedFrom === url)) items.set(item.id, item);
    }
  }
  if (!successful) throw new Error(`No feeds refreshed; existing catalog preserved. ${sources.map(source => `${source.url}: ${source.error}`).join(' ')}`);
  const catalog = { schemaVersion: 1, updatedAt: now.toISOString(), description: 'Indexed public itch.io HTML5 RSS catalog. Not live search. Project tags do not establish a license. Download from the creator normally, then import compatible HTML/ZIP.', sources, items: [...items.values()].slice(0, 1000) };
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  await rename(temporary, output);
  return catalog;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  updateCatalog().then(catalog => console.log(`Indexed ${catalog.items.length} real itch.io projects at ${catalog.updatedAt}; ${catalog.sources.filter(source => source.error).length} feed errors.`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
