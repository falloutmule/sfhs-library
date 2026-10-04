import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { classifyLicense, parseGithubRepository, rankItems, entryCandidates, searchDiscovery, inspectGithub, acquireGithub, resetDiscoveryCache } from '../src/discovery.js';
import { parseFeed, updateCatalog } from '../tools/update-catalog.mjs';

await mkdir(fileURLToPath(new URL('../test-results/', import.meta.url)), { recursive: true });

test('only recognized explicit SPDX licenses are classified open', () => {
  assert.equal(classifyLicense('MIT').kind, 'open');
  assert.equal(classifyLicense({ spdx_id: 'GPL-3.0-only' }).kind, 'open');
  assert.equal(classifyLicense('BUSL-1.1').kind, 'source-available');
  for (const license of [null, 'NOASSERTION', 'NONE', 'Public source', 'MIT OR Custom-Restriction']) assert.equal(classifyLicense(license).kind, 'unknown');
  assert.equal(classifyLicense('MIT', 'https://example.org/LICENSE').sourceUrl, 'https://example.org/LICENSE');
});

test('repository parser accepts exact public repositories and rejects arbitrary endpoints', () => {
  assert.equal(parseGithubRepository('https://github.com/gabrielecirulli/2048'), 'gabrielecirulli/2048');
  assert.equal(parseGithubRepository('owner/repo.git'), 'owner/repo');
  for (const input of ['https://evil.example/x/y', 'https://github.com/x/y/blob/main/index.html', '../../x', 'x/..', 'https://github.com/x/y?token=a']) assert.equal(parseGithubRepository(input), null);
});

test('ranking gives open licensing meaningful preference without rewarding known broken software', () => {
  const item = (title, kind, installable) => ({ title, description: 'puzzle', license: { kind }, installable });
  const ranked = rankItems([item('Broken puzzle', 'open', false), item('Puzzle unknown', 'unknown', true), item('Puzzle open', 'open', true), item('Puzzle source', 'source-available', true)], 'puzzle');
  assert.deepEqual(ranked.map(x => x.title), ['Puzzle open', 'Puzzle source', 'Puzzle unknown', 'Broken puzzle']);
});

test('static entry analysis prefers built output, bounds packages, and excludes traversal', () => {
  const tree = [{ path: 'index.html', type: 'blob', mode: '100644', size: 40 }, { path: 'dist/index.html', type: 'blob', mode: '100644', size: 45 }, { path: '../index.html', type: 'blob', mode: '100644', size: 1 }, { path: 'dist/big.wasm', type: 'blob', mode: '100644', size: 42 * 1024 * 1024 }];
  const entries = entryCandidates(tree);
  assert.equal(entries.length, 2);
  assert.ok(entries.every(entry => entry.reason.includes('40 MiB')));
  assert.equal(entryCandidates(tree.slice(0, 2))[0].path, 'dist/index.html');
  assert.equal(entryCandidates([{ path: 'timekeeper.html', type: 'blob', mode: '100644', size: 22 }])[0].path, 'timekeeper.html');
});

test('itch RSS index removes markup, allows creator URLs only, and never trusts open-source tags as a license', () => {
  const xml = '<rss><channel><item><title>A &amp; B</title><link>http://creator.itch.io/my-game?x=1</link><description><![CDATA[<p>A game <b>with</b> moves.</p><script>bad()</script>]]></description><pubDate>Mon, 20 Jul 2026 12:00:00 GMT</pubDate></item><item><title>Evil</title><link>https://itch.io.evil.example/a</link></item></channel></rss>';
  const items = parseFeed(xml, 'https://itch.io/games/html5/tag-open-source.xml');
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'A & B');
  assert.equal(items[0].description, 'A game with moves.');
  assert.equal(items[0].sourceUrl, 'https://creator.itch.io/my-game');
  assert.equal(items[0].license.kind, 'unknown');
  assert.equal(items[0].installability, 'import');
  assert.throws(() => parseFeed('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss></rss>', 'url'));
});

test('catalog generator preserves previous bytes when all feeds fail', async () => {
  const directory = await mkdtemp(fileURLToPath(new URL('../test-results/catalog-', import.meta.url)));
  const output = join(directory, 'catalog.json');
  const before = JSON.stringify({ schemaVersion: 1, updatedAt: '2026-01-01T00:00:00Z', sources: [], items: [] });
  await writeFile(output, before);
  await assert.rejects(updateCatalog({ output, feeds: ['https://itch.io/games/html5.xml'], fetcher: async () => new Response('No', { status: 503 }) }), /existing catalog preserved/);
  assert.equal(await readFile(output, 'utf8'), before);
});

test('catalog generator keeps failed-feed entries during a successful partial refresh', async () => {
  const directory = await mkdtemp(fileURLToPath(new URL('../test-results/catalog-', import.meta.url)));
  const output = join(directory, 'catalog.json');
  const feeds = ['https://itch.io/games/html5.xml', 'https://itch.io/games/newest/html5.xml'];
  await writeFile(output, JSON.stringify({ schemaVersion: 1, sources: [{ url: feeds[1], refreshedAt: '2026-01-01T00:00:00Z' }], items: [{ id: 'old', indexedFrom: feeds[1] }] }));
  const result = await updateCatalog({ output, feeds, fetcher: async url => url === feeds[0] ? new Response('<rss><item><title>Fresh</title><link>https://maker.itch.io/fresh</link></item></rss>') : new Response('blocked', { status: 503 }), now: new Date('2026-02-01T00:00:00Z') });
  assert.equal(result.items.length, 2);
  assert.equal(result.sources[1].refreshedAt, '2026-01-01T00:00:00Z');
  assert.equal(result.sources[1].error, 'HTTP 503');
});

test('GitHub rate limits are explicit and do not silently fall back to proxies', async () => {
  const savedFetch = globalThis.fetch;
  const requests = [];
  resetDiscoveryCache();
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-limit': '10', 'x-ratelimit-reset': '1900000000' } });
  };
  try {
    const result = await searchDiscovery({ query: 'puzzle', source: 'github' });
    assert.match(result.status, /rate limit reached/);
    assert.equal(result.rateLimit.remaining, 0);
    assert.equal(result.items.length, 0);
    assert.equal(requests.length, 1);
    assert.ok(requests[0].url.startsWith('https://api.github.com/'));
    assert.equal(requests[0].options.headers.Authorization, undefined);
  } finally { globalThis.fetch = savedFetch; resetDiscoveryCache(); }
});

test('GitHub search caches responses and filters unknown licenses under Open only', async () => {
  const savedFetch = globalThis.fetch;
  let count = 0;
  resetDiscoveryCache();
  globalThis.fetch = async () => {
    count++;
    return Response.json({ total_count: 2, items: [{ name: 'Open', full_name: 'owner/open', default_branch: 'main', license: { spdx_id: 'MIT' } }, { name: 'Unknown', full_name: 'owner/unknown', default_branch: 'main', license: null }] });
  };
  try {
    assert.equal((await searchDiscovery({ query: 'puzzle', source: 'github' })).items.length, 2);
    const result = await searchDiscovery({ query: 'puzzle', source: 'github', openOnly: true });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].title, 'Open');
    assert.equal(count, 1);
  } finally { globalThis.fetch = savedFetch; resetDiscoveryCache(); }
});

test('GitHub inspect and acquisition preserve immutable static file bytes and provenance', async () => {
  const savedFetch = globalThis.fetch;
  const commit = 'a'.repeat(40);
  const html = '<!doctype html><title>Game</title><script src="game.js"></script>';
  const js = 'console.log("original bytes");';
  const tree = [{ path: 'index.html', type: 'blob', mode: '100644', size: Buffer.byteLength(html) }, { path: 'game.js', type: 'blob', mode: '100644', size: Buffer.byteLength(js) }];
  const requests = [];
  resetDiscoveryCache();
  globalThis.fetch = async (url) => {
    requests.push(url);
    if (url === 'https://api.github.com/repos/owner/game') return Response.json({ name: 'game', full_name: 'owner/game', default_branch: 'main', license: { spdx_id: 'MIT' }, has_pages: true });
    if (url.endsWith('/commits/main')) return Response.json({ sha: commit });
    if (url.includes('/git/trees/')) return Response.json({ tree, truncated: false });
    if (url.includes('/releases?')) return Response.json([{ tag_name: 'v1', assets: [{ name: 'game.zip', browser_download_url: 'https://github.com/owner/game/releases/game.zip', size: 100 }] }]);
    if (url.includes('/license?')) return Response.json({ license: { spdx_id: 'MIT' }, html_url: `https://github.com/owner/game/blob/${commit}/LICENSE` });
    if (url.endsWith('/index.html')) return new Response(html);
    if (url.endsWith('/game.js')) return new Response(js);
    throw new Error(`Unexpected URL ${url}`);
  };
  try {
    const detail = await inspectGithub({ repository: 'owner/game' });
    assert.equal(detail.installable, true);
    assert.equal(detail.releases[0].assets[0].name, 'game.zip');
    const acquired = await acquireGithub({ repository: 'owner/game' }, detail);
    const files = unzipSync(acquired.bytes);
    assert.equal(strFromU8(files['index.html']), html);
    assert.equal(strFromU8(files['game.js']), js);
    assert.equal(acquired.source.version, commit);
    assert.equal(acquired.source.license.kind, 'open');
    assert.ok(requests.filter(url => url.includes('raw.githubusercontent')).every(url => url.includes(commit)));
  } finally { globalThis.fetch = savedFetch; resetDiscoveryCache(); }
});

test('source-only template is refused, never reported as an installed browser package', async () => {
  const savedFetch = globalThis.fetch;
  const commit = 'b'.repeat(40);
  const html = '<script type="module" src="/src/main.tsx"></script>';
  resetDiscoveryCache();
  globalThis.fetch = async url => {
    if (url === 'https://api.github.com/repos/owner/source') return Response.json({ name: 'source', full_name: 'owner/source', default_branch: 'main' });
    if (url.includes('/commits/')) return Response.json({ sha: commit });
    if (url.includes('/git/trees/')) return Response.json({ tree: [{ path: 'index.html', type: 'blob', mode: '100644', size: html.length }], truncated: false });
    if (url.includes('/releases?')) return Response.json([]);
    if (url.includes('/license?')) return new Response('{}', { status: 404 });
    return new Response(html);
  };
  try {
    const detail = await inspectGithub({ repository: 'owner/source' });
    assert.equal(detail.installable, false);
    assert.match(detail.installReason, /needs a build/);
    await assert.rejects(acquireGithub({ repository: 'owner/source' }, detail), /needs a build/);
  } finally { globalThis.fetch = savedFetch; resetDiscoveryCache(); }
});
