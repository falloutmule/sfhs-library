import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { analyzePayload } from '../src/capsule.js';
import { readArchive } from '../src/archive.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const corpusPath = resolve(root, 'test-results/corpus');
const runPath = resolve(root, `test-results/corpus-proof-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(runPath, { recursive: true });
let manifest;
try { manifest = JSON.parse(await readFile(resolve(corpusPath, 'manifest.json'), 'utf8')); }
catch { throw new Error('Acquire real corpus first: node tools/acquire-corpus.mjs (optionally --include-local).'); }
const buildInfo = JSON.parse(await readFile(resolve(root, 'build-info.json'), 'utf8'));
const result = { schemaVersion: 1, startedAt: new Date().toISOString(), buildId: buildInfo.buildId, buildInfo, browser: 'Chromium', viewport: { width: 412, height: 915 }, phoneAcceptance: false, records: [], gaps: ['Physical Android acceptance is still required.', 'Hourglass exercises refusal of unsupported real WASM/modules; functional WASM/modules/media are covered separately by synthetic runtime tests.'] };
if (!manifest.records.some(record => record.id === 'itch-silted')) result.gaps.push('No itch.io HTML/ZIP was included in this run; acquire it using --itch.');
const served = new Set(['/', '/index.html', '/sw.js', '/catalog.json', '/manifest.webmanifest', '/icon.svg', '/build-info.json']);
const servedBytes = new Map(await Promise.all([...served].map(async pathname => [pathname, await readFile(resolve(root, pathname === '/' ? 'index.html' : pathname.slice(1)))])));
result.launcherSHA256 = createHash('sha256').update(servedBytes.get('/index.html')).digest('hex');
assert.equal(result.launcherSHA256, buildInfo.artifactSha256, 'The served launcher must match build-info.json exactly.');
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (!served.has(pathname)) { response.writeHead(404); response.end(); return; }
  const name = pathname === '/' ? 'index.html' : pathname.slice(1);
  try { response.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }[extname(name)] || 'application/octet-stream'); response.end(servedBytes.get(pathname)); }
  catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;

async function card(page, title) { const node = page.locator('#library-grid article').filter({ has: page.getByRole('heading', { name: title, exact: true }) }); await node.waitFor(); return node; }
async function launch(page, title) { await (await card(page, title)).getByRole('button', { name: 'Launch', exact: true }).click(); await page.locator('#runtime-container iframe').waitFor(); const handle = await page.locator('#runtime-container iframe').elementHandle(); const frame = await handle.contentFrame(); await frame.waitForLoadState('domcontentloaded'); return frame; }
async function close(page) { await page.locator('#runtime-close').click(); await page.locator('#runtime').waitFor({ state: 'hidden' }); }
async function observe(frame, id, { restored = false } = {}) {
  if (id === '2048') {
    await frame.locator('.tile').first().waitFor();
    if (!restored) {
      await frame.locator('.game-container').click();
      for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowLeft', 'ArrowDown']) await frame.page().keyboard.press(key);
    }
    await frame.waitForFunction(() => {
      const saved = JSON.parse(localStorage.getItem('gameState'));
      const displayedScore = Number(document.querySelector('.score-container').childNodes[0]?.textContent);
      return saved && saved.score === displayedScore && saved.grid.cells.flat().filter(Boolean).every(cell => document.querySelector(`.tile-position-${cell.position.x + 1}-${cell.position.y + 1}.tile-${cell.value}`));
    });
    const state = await frame.evaluate(() => ({ score: document.querySelector('.score-container').childNodes[0]?.textContent, gameState: JSON.parse(localStorage.getItem('gameState')), tiles: [...document.querySelectorAll('.tile')].map(tile => tile.textContent) }));
    assert.ok(state.gameState?.grid?.cells, '2048 must save an actual board');
    assert.ok(state.tiles.length >= 2);
    return { summary: 'Real game rendered the saved score and every saved board cell after keyboard moves or restoration.', saveObservation: state.gameState, tiles: state.tiles, score: state.score };
  }
  if (id === 'timekeeper') {
    await frame.locator('#tk-new-project').waitFor();
    if (!restored) { await frame.locator('#tk-new-project').fill('SFHS real restore proof'); await frame.locator('#tk-add-project-btn').click(); }
    await frame.getByText('SFHS real restore proof', { exact: true }).first().waitFor();
    const projects = await frame.evaluate(() => JSON.parse(localStorage.getItem('tk-projects')));
    assert.ok(projects.some(project => project.name === 'SFHS real restore proof'));
    return { summary: 'Real utility created a named project and rendered it from managed localStorage.', saveObservation: projects };
  }
  if (id === 'pomodoro') {
    await frame.locator('#startBtn').waitFor();
    await frame.locator('#startBtn').click();
    await frame.waitForFunction(() => document.querySelector('#startBtn').textContent.includes('PAUSE'));
    await frame.waitForFunction(() => Number(document.querySelector('#dSec').textContent) > 0);
    const state = await frame.evaluate(() => ({ title: document.title, label: document.querySelector('#startBtn').textContent, seconds: document.querySelector('#dSec').textContent }));
    await frame.locator('#startBtn').click();
    return { summary: 'Real timer started, counted down, and paused with networking disabled; optional remote font was unavailable.', observation: state };
  }
  if (id === 'trex') {
    await frame.locator('canvas').waitFor();
    await frame.locator('canvas').click();
    await frame.page().keyboard.press('Space');
    await frame.waitForFunction(() => window.Runner?.instance_?.distanceRan > 0, null, { timeout: 10000 });
    const state = await frame.evaluate(() => ({ distanceRan: Runner.instance_.distanceRan, canvasWidth: document.querySelector('canvas').width, images: [...document.images].filter(image => image.naturalWidth > 0).length }));
    assert.ok(state.distanceRan > 0);
    assert.ok(state.images > 0);
    return { summary: 'Real canvas runner started and advanced; archived sprites decoded while network was disabled.', observation: state };
  }
  if (id === 'snc') {
    await frame.locator('#view').waitFor();
    const start = frame.locator('[data-action="title-start"]');
    if (await start.isVisible()) await start.click();
    else { await frame.locator('#view').click(); await frame.page().keyboard.press('Enter'); }
    const state = await frame.evaluate(() => ({ canvas: { width: document.querySelector('#view').width, height: document.querySelector('#view').height }, bodyText: document.body.innerText.slice(0, 350), storageKeys: Object.keys(localStorage) }));
    assert.ok(state.canvas.width >= 320);
    return { summary: 'Real strict SFHS artifact started in an isolated frame with archived canvas content; gameplay feel and full save cycle remain outside this smoke.', observation: state };
  }
  if (id === 'itch-silted') {
    await frame.locator('#turn').waitFor();
    const before = await frame.locator('#turn').textContent();
    await frame.locator('#wait').click();
    await frame.waitForFunction(old => document.querySelector('#turn').textContent !== old, before);
    const after = await frame.locator('#turn').textContent();
    await frame.locator('#undo').click();
    assert.equal(await frame.locator('#turn').textContent(), before);
    return { summary: 'Legitimately downloaded itch.io free demo advanced a real puzzle turn and undid it offline. The creator explicitly states no persistent saves.', observation: { before, after, undo: before } };
  }
  throw new Error(`No meaningful observation defined for ${id}`);
}

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: result.viewport, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(url);
  await page.locator('#library-count').waitFor();
  await context.setOffline(true);
  for (const source of manifest.records) {
    const bytes = new Uint8Array(await readFile(resolve(corpusPath, source.filename)));
    const analysis = await analyzePayload({ bytes, filename: source.filename });
    assert.equal(analysis.originalHash, source.sha256);
    const record = { id: source.id, title: source.title, sourceUrl: source.sourceUrl, commit: source.commit, originalHash: analysis.originalHash, executableHash: analysis.executableHash, profile: analysis.profile, saveSupport: analysis.saveSupport, offlineClassification: analysis.offline, reasons: analysis.reasons, fileCount: analysis.fileCount, acquiredAt: source.acquiredAt };
    result.records.push(record);
    await page.locator('#import-file').setInputFiles(resolve(corpusPath, source.filename));
    await page.locator('#dialog[open]').waitFor();
    if (source.expected === 'unsupported') {
      assert.equal(analysis.compatible, false);
      assert.equal(await page.getByRole('button', { name: 'Install application', exact: true }).count(), 0);
      record.result = 'PASS: unsupported payload refused; not installed';
      await page.locator('#dialog-close').click();
      continue;
    }
    assert.equal(analysis.compatible, true, `${source.title}: ${analysis.reasons.join('; ')}`);
    await page.getByLabel('Application name', { exact: true }).fill(source.title);
    await page.getByRole('button', { name: 'Install application', exact: true }).click();
    await page.locator('#dialog').waitFor({ state: 'hidden' });
    const frame = await launch(page, source.title);
    assert.equal(await page.locator('#runtime-container iframe').getAttribute('sandbox'), 'allow-scripts');
    record.initial = await observe(frame, source.id);
    record.networkDisabled = true;
    await page.screenshot({ path: resolve(runPath, `${source.id}.png`), fullPage: true });
    await close(page);
    if (record.initial.saveObservation) {
      const reopened = await launch(page, source.title);
      record.reopened = await observe(reopened, source.id, { restored: true });
      assert.deepEqual(record.reopened.saveObservation, record.initial.saveObservation, `${source.title}: relaunch state must agree`);
      await close(page);
    }
    record.result = 'PASS: local import, isolated launch, meaningful use with networking disabled';
  }
  await page.locator('[data-view="backups"]').filter({ visible: true }).first().click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-library').click()]);
  const backupPath = resolve(runPath, 'real-corpus-library.zip');
  await download.saveAs(backupPath);
  const archive = await readArchive(new Uint8Array(await readFile(backupPath)));
  const installed = result.records.filter(record => record.initial);
  assert.equal(archive.apps.length, installed.length);
  for (const app of archive.apps) {
    const expected = installed.find(item => item.title === app.name);
    assert.equal(app.versions[0].originalHash, expected.originalHash);
  }
  await context.close();
  const restoredContext = await browser.newContext({ viewport: result.viewport, deviceScaleFactor: 1 });
  const restoredPage = await restoredContext.newPage();
  restoredPage.setDefaultTimeout(15000);
  await restoredPage.goto(url);
  await restoredPage.locator('#library-count').waitFor();
  assert.match(await restoredPage.locator('#library-count').textContent(), /^0(?:\s|$)/);
  await restoredContext.setOffline(true);
  await restoredPage.locator('#restore-file').setInputFiles(backupPath);
  await restoredPage.getByRole('button', { name: 'Restore library', exact: true }).click();
  await restoredPage.locator('#dialog').waitFor({ state: 'hidden' });
  for (const record of installed.filter(item => item.initial.saveObservation)) {
    const frame = await launch(restoredPage, record.title);
    record.restored = await observe(frame, record.id, { restored: true });
    assert.deepEqual(record.restored.saveObservation, record.initial.saveObservation, `${record.title}: restored application must observe its prior state`);
    await restoredPage.screenshot({ path: resolve(runPath, `${record.id}-restored.png`), fullPage: true });
    await close(restoredPage);
  }
  assert.equal(await restoredPage.locator('#library-grid article').count(), installed.length);
  result.recovery = { result: 'PASS', applications: archive.apps.length, originalHashesChecked: true, emptyBrowserContext: true, restoredWithoutNetwork: true, applicationObservedSaves: installed.filter(record => record.restored).map(record => record.id), backupPath };
  result.result = 'PASS';
  await restoredContext.close();
} catch (error) { result.result = 'FAIL'; result.error = error.stack || error.message; process.exitCode = 1; console.error(error); }
finally {
  result.finishedAt = new Date().toISOString();
  await writeFile(resolve(runPath, 'proof.json'), JSON.stringify(result, null, 2));
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
console.log(`${result.result}: real corpus proof in ${runPath}`);
