import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { zipSync, strToU8 } from 'fflate';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { analyzePayload, sha256, insertCapsulePrelude } from '../src/capsule.js';
import { validateSave, capsulePolicy } from '../src/runtime.js';

const html = text => strToU8(`<!doctype html><html><head><title>Kept App</title></head><body>${text}</body></html>`);
const analyze = (text, args = {}) => analyzePayload({ bytes: html(text), filename: 'app.html', ...args });

test('original and deterministic executable hashes retain distinct meanings', async () => {
  const bytes = html('<script>localStorage.setItem("score","17")</script>');
  const first = await analyzePayload({ bytes, filename: 'keep.html' });
  const second = await analyzePayload({ bytes, filename: 'keep.html' });
  assert.equal(first.compatible, true);
  assert.equal(first.originalHash, await sha256(bytes));
  assert.equal(first.executableHash, await sha256(strToU8(first.capsule)));
  assert.notEqual(first.originalHash, first.executableHash);
  assert.equal(first.capsule, second.capsule);
  assert.equal(first.offline, 'candidate');
  assert.equal(first.saveSupport, 'supported');
  assert.equal(first.profile, 'isolated-single-file');
});

test('required unsupported APIs are refused without same-origin fallback', async () => {
  for (const source of ['indexedDB.open("db")', 'navigator.serviceWorker.register("sw.js")', 'new Worker("worker.js")', 'navigator.storage.getDirectory()', 'import("./later.js")', 'eval("1")', 'new XMLHttpRequest()']) {
    const result = await analyze(`<script>${source}</script>`);
    assert.equal(result.compatible, false, source);
    assert.equal(result.profile, 'external-only', source);
    assert.ok(result.reasons.length, source);
  }
});

test('documentation, code comments, string content, and data scripts do not trigger API refusals', async () => {
  const result = await analyze(`<p>No eval(). Never use indexedDB.open('x').</p><script type="application/json">{"note":"new Worker()"}</script><script>
    // Forbidden examples: eval('x'); new Worker('x');
    /* indexedDB.open('x'); new XMLHttpRequest(); */
    const message = 'eval() is not used'; localStorage.setItem('message', message);
  </script>`);
  assert.equal(result.compatible, true, result.reasons.join('\n'));
  assert.equal(result.saveSupport, 'supported');
});

test('ZIP packages retain CSS, images, scripts, static module graphs, and fetch assets', async () => {
  const bytes = zipSync({
    'release/index.html': html('<link rel="stylesheet" href="style.css"><img src="pixel.svg"><script type="module" src="js/main.js"></script>'),
    'release/style.css': strToU8('body { background-image: url("pixel.svg") }'),
    'release/pixel.svg': strToU8('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    'release/js/main.js': strToU8('import { value } from "./value.js"; window.answer=value; fetch("number.json");'),
    'release/js/value.js': strToU8('export const value=42;'),
    'release/number.json': strToU8('{"number":17}'),
  });
  const result = await analyzePayload({ bytes, filename: 'app.zip' });
  assert.equal(result.compatible, true, result.reasons.join('\n'));
  assert.equal(result.profile, 'isolated-packaged');
  assert.equal(result.fileCount, 6);
  assert.ok(result.capsule.includes('sfhs:/js/value.js'));
  assert.ok(result.capsule.includes('data:image/svg+xml;base64,'));
});

test('ZIP traversal and unresolved required files are refused', async () => {
  const bad = await analyzePayload({ bytes: zipSync({ '../index.html': html('hello') }), filename: 'unsafe.zip' });
  assert.equal(bad.compatible, false);
  assert.match(bad.reasons[0], /traversal/);
  const missing = await analyze('<script src="absent.js"></script>');
  assert.equal(missing.compatible, false);
  assert.match(missing.reasons.join(' '), /absent.js/);
});

test('an explicit package entry selects that exact HTML and missing or ambiguous entries refuse', async () => {
  const bytes = zipSync({
    'index.html': strToU8('<!doctype html><title>Landing Page</title><output id="selected">landing</output>'),
    'game.html': strToU8('<!doctype html><title>Selected Game</title><output id="selected">selected game</output>'),
  });
  const chosen = await analyzePayload({ bytes, filename: 'app.zip', entryPath: 'game.html' });
  assert.equal(chosen.compatible, true, chosen.reasons.join('\n'));
  assert.equal(chosen.entry, 'game.html');
  assert.equal(chosen.title, 'Selected Game');
  assert.ok(chosen.capsule.includes('selected game'));
  assert.ok(!chosen.capsule.includes('Landing Page'));
  const missing = await analyzePayload({ bytes, filename: 'app.zip', entryPath: 'missing.html' });
  assert.equal(missing.compatible, false);
  assert.match(missing.reasons.join(' '), /selected HTML entry is not in this package/);
  const traversal = await analyzePayload({ bytes, filename: 'app.zip', entryPath: '../game.html' });
  assert.equal(traversal.compatible, false);
  const ambiguous = await analyzePayload({ bytes: zipSync({ 'Index.html': html('one'), 'index.htm': html('two') }), filename: 'ambiguous.zip' });
  assert.equal(ambiguous.compatible, false);
  assert.match(ambiguous.reasons.join(' '), /ambiguous/);
});

test('network classification remains explicit and is not called offline verified', async () => {
  const result = await analyze('<script>fetch("https://api.example.test/data")</script>');
  assert.equal(result.compatible, true);
  assert.equal(result.profile, 'network-dependent');
  assert.equal(result.offline, 'network');
  assert.deepEqual(result.networkOrigins, ['https://api.example.test']);
  assert.equal(result.networkEnabled, false);
  assert.ok(!capsulePolicy({ networkAllowed: false, networkOrigins: result.networkOrigins }).includes('api.example.test'));
  assert.ok(capsulePolicy({ networkAllowed: true, networkOrigins: result.networkOrigins }).includes('https://api.example.test'));
  assert.ok(!capsulePolicy({ networkAllowed: true, networkOrigins: ["https://example.test; script-src *"] }).includes('script-src *'));
});

test('save validation is bounded and handles prototype-like keys as data', () => {
  const state = validateSave(JSON.parse('{"localStorage":{"__proto__":"kept","constructor":"also kept"},"bridge":null}'));
  assert.equal(Object.getPrototypeOf(state.localStorage), Object.prototype);
  assert.equal(Object.hasOwn(state.localStorage, '__proto__'), true);
  assert.equal(state.localStorage.__proto__, 'kept');
  assert.throws(() => validateSave({ localStorage: { a: 5 } }), /invalid/);
  assert.throws(() => validateSave({ bridge: { schema: 'x' } }), /state/);
  assert.throws(() => validateSave({ localStorage: { a: 'x'.repeat(4 * 1024 * 1024) } }), /limit/);
});

test('runtime policy precedes imported scripts and removes imported navigation controls', () => {
  const result = insertCapsulePrelude('<script>bad()</script><meta http-equiv="refresh" content="0;url=https://bad.test"><base href="https://bad.test">', { policy: "default-src 'none'", script: 'bootstrap()' });
  assert.ok(result.indexOf('Content-Security-Policy') < result.indexOf('bootstrap()'));
  assert.ok(result.indexOf('bootstrap()') < result.indexOf('bad()'));
  assert.ok(!result.includes('refresh'));
  assert.ok(!result.includes('<base'));
});

test('Chromium: opaque isolation, save drain/restore, modules, offline launch, and native bridge', { timeout: 60000 }, async () => {
  const bundled = await build({ stdin: { contents: "export {launchCapsule} from './src/runtime.js'; export {analyzePayload} from './src/capsule.js';", resolveDir: process.cwd() }, bundle: true, format: 'iife', globalName: 'RuntimeTest', write: false, target: 'es2022' });
  let unexpectedRequests = 0;
  const server = createServer((request, response) => {
    if (request.url === '/runtime.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundled.outputFiles[0].text); }
    else if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end(`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' data: blob:; style-src 'unsafe-inline' data:; img-src data: blob:; media-src data: blob:; font-src data: blob:; connect-src https: data: blob:; frame-src data: blob:; worker-src 'self'; object-src 'none'; base-uri 'none'"><main id="app"></main><script src="/runtime.js"></script>`); }
    else { unexpectedRequests++; response.statusCode = 404; response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(() => { localStorage.setItem('launcher-secret', 'private'); window.saves = []; window.statuses = []; });
    const counter = await analyze(`<button id="inc">0</button><output id="attack"></output><script>
      let score=Number(localStorage.getItem('score')||0); document.querySelector('#inc').textContent=score;
      document.querySelector('#inc').addEventListener('click',()=>{localStorage.setItem('score',String(++score));document.querySelector('#inc').textContent=score});
      try { parent.localStorage.setItem('launcher-secret','stolen'); document.querySelector('#attack').textContent='ESCAPED'; } catch { document.querySelector('#attack').textContent='blocked'; }
      parent.postMessage({type:'save',appId:'other-app',save:{localStorage:{stolen:'true'}}},'*');
    </script>`);
    await page.evaluate(async capsule => { window.runtime = await RuntimeTest.launchCapsule({ container: document.querySelector('#app'), capsule, save: null, onSave: async save => { await new Promise(resolve => setTimeout(resolve, 20)); window.saves.push(save); window.saved = save; }, onStatus: status => window.statuses.push(status) }); }, counter.capsule);
    let frame = page.frames().find(frame => frame.parentFrame());
    assert.equal(await frame.locator('#attack').textContent(), 'blocked');
    assert.equal(await page.evaluate(() => localStorage.getItem('launcher-secret')), 'private');
    assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
    await frame.locator('#inc').click();
    await frame.locator('#inc').click();
    const save = await page.evaluate(async () => { const result = await runtime.flush(); await runtime.close(); return result; });
    assert.equal(save.localStorage.score, '2');
    assert.equal(await page.evaluate(() => saved.localStorage.score), '2');
    assert.equal(await page.evaluate(() => saves.some(save => save.localStorage.stolen)), false);
    // Erase the runtime and launch only from the captured payload/save while the
    // browser network is disabled. Application-level observation proves restore.
    await context.setOffline(true);
    await page.evaluate(async ({ capsule, save }) => { window.saved = null; window.runtime = await RuntimeTest.launchCapsule({ container: document.querySelector('#app'), capsule, save, onSave: async next => { window.saved = next; } }); }, { capsule: counter.capsule, save });
    frame = page.frames().find(frame => frame.parentFrame());
    assert.equal(await frame.locator('#inc').textContent(), '2');
    await page.evaluate(() => runtime.close());
    const selectedEntry = await analyzePayload({
      bytes: zipSync({
        'index.html': strToU8('<!doctype html><title>Landing Page</title><output id="selected">landing</output>'),
        'game.html': strToU8('<!doctype html><title>Selected Game</title><output id="selected">selected game</output>'),
      }),
      filename: 'entries.zip', entryPath: 'game.html',
    });
    await page.evaluate(async capsule => { window.runtime = await RuntimeTest.launchCapsule({ container: document.querySelector('#app'), capsule }); }, selectedEntry.capsule);
    frame = page.frames().find(frame => frame.parentFrame());
    assert.equal(await frame.title(), 'Selected Game');
    assert.equal(await frame.locator('#selected').textContent(), 'selected game');
    await page.evaluate(() => runtime.close());
    const moduleZip = zipSync({
      'index.html': html('<output id="module">waiting</output><script type="module" src="main.js"></script>'),
      'main.js': strToU8('import { n } from "./value.js"; const data=await (await fetch("answer.json")).json(); document.querySelector("#module").textContent=String(n+data.n);'),
      'value.js': strToU8('export const n=40;'),
      'answer.json': strToU8('{"n":2}'),
    });
    const moduleCapsule = await analyzePayload({ bytes: moduleZip, filename: 'module.zip' });
    assert.equal(moduleCapsule.compatible, true, moduleCapsule.reasons.join('\n'));
    await page.evaluate(async capsule => { window.runtime = await RuntimeTest.launchCapsule({ container: document.querySelector('#app'), capsule }); }, moduleCapsule.capsule);
    frame = page.frames().find(frame => frame.parentFrame());
    await frame.locator('#module').filter({ hasText: '42' }).waitFor();
    await page.evaluate(() => runtime.close());
    const native = await analyze(`<output id="state">starting</output><script>
      let state={note:'fresh'}; SFHSLibrary.registerSaveBridge({schema:'notes/1', exportState(){return state}, importState(next){state=next}, validate(next){return state.note===next.note}}).then(()=>document.querySelector('#state').textContent=state.note);
    </script>`);
    assert.equal(native.profile, 'native-sfhs');
    await page.evaluate(async capsule => { window.runtime = await RuntimeTest.launchCapsule({ container: document.querySelector('#app'), capsule, save: { localStorage: {}, bridge: { schema: 'notes/1', state: { note: 'restored bridge note' } } } }); }, native.capsule);
    frame = page.frames().find(frame => frame.parentFrame());
    await frame.locator('#state').filter({ hasText: 'restored bridge note' }).waitFor();
    const nativeState = await page.evaluate(() => runtime.flush());
    assert.equal(nativeState.bridge.state.note, 'restored bridge note');
    await page.evaluate(() => runtime.close());
    const wav = new Uint8Array(44 + 1600), wavView = new DataView(wav.buffer);
    const wavText = (offset, value) => value.split('').forEach((char, index) => { wav[offset + index] = char.charCodeAt(0); });
    wavText(0, 'RIFF'); wavView.setUint32(4, wav.length - 8, true); wavText(8, 'WAVE'); wavText(12, 'fmt ');
    wavView.setUint32(16, 16, true); wavView.setUint16(20, 1, true); wavView.setUint16(22, 1, true);
    wavView.setUint32(24, 8000, true); wavView.setUint32(28, 16000, true); wavView.setUint16(32, 2, true); wavView.setUint16(34, 16, true);
    wavText(36, 'data'); wavView.setUint32(40, 1600, true);
    const wasmZip = zipSync({
      'index.html': html('<output id="wasm">waiting</output><img id="image" src="pixel.svg"><output id="media">waiting</output><script>WebAssembly.instantiateStreaming(fetch("answer.wasm")).then(({instance})=>document.querySelector("#wasm").textContent=String(instance.exports.answer())); const audio = new Audio("tone.wav"); audio.preload="auto"; Promise.all([document.querySelector("#image").decode(),new Promise((resolve,reject)=>{audio.addEventListener("loadedmetadata",resolve);audio.addEventListener("error",reject);audio.load()})]).then(()=>document.querySelector("#media").textContent="image and audio decoded");</script>'),
      'answer.wasm': new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,7,10,1,6,97,110,115,119,101,114,0,0,10,6,1,4,0,65,42,11]),
      'pixel.svg': strToU8('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="red"/></svg>'),
      'tone.wav': wav,
    });
    const wasm = await analyzePayload({ bytes: wasmZip, filename: 'wasm.zip' });
    assert.equal(wasm.compatible, true, wasm.reasons.join('\n'));
    await page.evaluate(async capsule => { window.runtime = await RuntimeTest.launchCapsule({ container: document.querySelector('#app'), capsule }); }, wasm.capsule);
    frame = page.frames().find(frame => frame.parentFrame());
    await frame.locator('#wasm').filter({ hasText: '42' }).waitFor();
    await frame.locator('#media').filter({ hasText: 'image and audio decoded' }).waitFor();
    await page.evaluate(() => runtime.close());
    await context.setOffline(false);
    // A hostile capsule can neither read another live guest nor mutate launcher
    // records with forged global messages. The broker binds each private port.
    await page.evaluate(async capsule => {
      const second = document.createElement('main'); second.id = 'second'; document.body.append(second);
      window.runtime = await RuntimeTest.launchCapsule({ container: document.querySelector('#app'), capsule, save: { localStorage: { score: '11' }, bridge: null } });
      window.otherRuntime = await RuntimeTest.launchCapsule({ container: second, capsule, save: { localStorage: { score: '77' }, bridge: null } });
    }, counter.capsule);
    const twoFrames = page.frames().filter(frame => frame.parentFrame());
    assert.deepEqual(await Promise.all(twoFrames.map(frame => frame.locator('#inc').textContent())), ['11', '77']);
    assert.equal(await twoFrames[0].evaluate(() => { try { return parent.frames[1].localStorage.getItem('score'); } catch { return 'blocked'; } }), 'blocked');
    await twoFrames[0].locator('#inc').click();
    assert.equal((await page.evaluate(() => otherRuntime.flush())).localStorage.score, '77');
    await page.evaluate(async () => { await runtime.close(); await otherRuntime.close(); });
    const restriction = await analyze(`<output id="blocked">waiting</output><script>
      const address='http://' + '127.0.0.1:${server.address().port}/leak';
      fetch(address).then(()=>document.querySelector('#blocked').textContent='escaped').catch(()=>document.querySelector('#blocked').textContent='blocked');
    </script>`);
    await page.evaluate(async capsule => { window.runtime = await RuntimeTest.launchCapsule({ container: document.querySelector('#app'), capsule }); }, restriction.capsule);
    frame = page.frames().find(frame => frame.parentFrame());
    await frame.locator('#blocked').filter({ hasText: 'blocked' }).waitFor();
    await page.evaluate(() => runtime.close());
    assert.equal(unexpectedRequests, 0);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
