import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { acquireGithub, entryCandidates } from '../src/discovery.js';

export const CORPUS = [
  { id: '2048', title: '2048', kind: 'github-package', repository: 'gabrielecirulli/2048', commit: '478b6ec346e3787f589e4af751378d06ded4cbbc', entry: 'index.html', spdx: 'MIT', licenseFile: 'LICENSE.txt', covers: ['real non-SFHS game', 'localStorage', 'multi-file package', 'images'] },
  { id: 'trex', title: 'T-Rex Runner', kind: 'github-package', repository: 'wayou/t-rex-runner', commit: '5455bfa408ec6b707c7300ff194b7390733a766d', entry: 'index.html', spdx: 'BSD-3-Clause', licenseFile: 'LICENSE', covers: ['real canvas game', 'images', 'audio', 'optional remote font'] },
  { id: 'timekeeper', title: 'Timekeeper', kind: 'github-file', repository: 'williamjussiau/timekeeper', commit: 'd1fbdfb93169fa195b46d6b43eee26aa55af1016', entry: 'timekeeper.html', spdx: 'MIT', licenseFile: 'LICENSE', covers: ['real non-SFHS single HTML utility', 'localStorage', 'DOM application'] },
  { id: 'pomodoro', title: 'TOMatoTimer', kind: 'github-file', repository: 'jonruark/TOMatoTimer', commit: '875d8d02588a21e843969d5336c4241cbd71eb50', entry: 'index.html', spdx: 'MIT', licenseFile: 'LICENSE', covers: ['real non-SFHS single HTML timer', 'network-dependent font', 'no managed save declaration'] },
  { id: 'hourglass', title: 'Hourglass Fable5', kind: 'github-package', repository: 'khanmjk/Hourglass_Fable5', commit: '91ee818bd2bf4e4e77648f5a8adbebeea360af6b', entry: 'index.html', spdx: 'MIT', licenseFile: 'LICENSE', covers: ['real Three.js / Rapier WASM application', 'ES modules', 'unsupported import map and bare modules'], expected: 'unsupported' },
];
const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(root, 'test-results/corpus');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}; respect GitHub rate limits and retry later.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 40 * 1024 * 1024) throw new Error('Corpus source exceeds 40 MiB.');
  return bytes;
}

export async function acquireCorpus({ includeLocal = false, includeItch = false, refresh = false } = {}) {
  await mkdir(output, { recursive: true });
  const records = [];
  for (const spec of CORPUS) {
    const filename = `${spec.id}.${spec.kind === 'github-file' ? 'html' : 'zip'}`;
    const target = resolve(output, filename);
    let bytes;
    let acquiredAt = new Date().toISOString();
    try {
      if (refresh) throw new Error('Refresh requested');
      const previous = JSON.parse(await readFile(resolve(output, `${spec.id}.provenance.json`), 'utf8'));
      bytes = new Uint8Array(await readFile(target));
      if (hash(bytes) !== previous.sha256 || previous.commit !== spec.commit) throw new Error('Cache differs');
      acquiredAt = previous.acquiredAt;
    } catch {
      if (spec.kind === 'github-file') bytes = await download(`https://raw.githubusercontent.com/${spec.repository}/${spec.commit}/${spec.entry}`);
      else {
        const tree = JSON.parse(new TextDecoder().decode(await download(`https://api.github.com/repos/${spec.repository}/git/trees/${spec.commit}?recursive=1`)));
        if (tree.truncated) throw new Error(`Refusing incomplete tree: ${spec.repository}`);
        const detail = { repository: spec.repository, commit: spec.commit, tree: tree.tree, entryCandidates: entryCandidates(tree.tree), recommendedEntry: spec.entry, installable: true, license: { spdx: spec.spdx, kind: spec.spdx ? 'open' : 'unknown', sourceUrl: spec.licenseFile ? `https://github.com/${spec.repository}/blob/${spec.commit}/${spec.licenseFile}` : `https://github.com/${spec.repository}` } };
        bytes = (await acquireGithub({ repository: spec.repository }, detail)).bytes;
      }
      await writeFile(target, bytes);
    }
    const record = { ...spec, filename, bytes: bytes.length, sha256: hash(bytes), acquiredAt, sourceUrl: `https://github.com/${spec.repository}/tree/${spec.commit}`, acquisition: spec.kind === 'github-file' ? 'Exact HTML bytes from immutable raw.githubusercontent.com URL.' : 'Original immutable repository file bytes assembled into ZIP; not an upstream release archive.', licenseScope: 'Repository-level observation only; not a dependency license audit.' };
    await writeFile(resolve(output, `${spec.id}.provenance.json`), JSON.stringify(record, null, 2));
    records.push(record);
  }
  if (includeLocal) {
    const local = resolve(root, '../solidarity-not-charity-can-run/index.html');
    const bytes = await readFile(local);
    const localRepository = resolve(root, '../solidarity-not-charity-can-run');
    const commit = execFileSync('git', ['-c', `safe.directory=${localRepository.replaceAll('\\', '/')}`, 'rev-parse', 'HEAD'], { cwd: localRepository, encoding: 'utf8' }).trim();
    const record = { id: 'snc', title: 'Solidarity Not Charity Can Run', kind: 'local-original', filename: 'snc.html', bytes: bytes.length, sha256: hash(bytes), acquiredAt: new Date().toISOString(), localSource: local, commit, sourceUrl: 'https://github.com/falloutmule/solidarity-not-charity-can-run', spdx: null, covers: ['real SFHS artifact', 'self-contained canvas game', 'localStorage'], acquisition: 'Read-only copy of the existing workspace artifact; commit recorded, source bytes independently hashed.' };
    await writeFile(resolve(output, record.filename), bytes);
    await writeFile(resolve(output, 'snc.provenance.json'), JSON.stringify(record, null, 2));
    records.push(record);
  }
  if (includeItch) {
    let record;
    try {
      if (refresh) throw new Error('Refresh requested');
      record = JSON.parse(await readFile(resolve(output, 'itch-silted.provenance.json'), 'utf8'));
      if (hash(await readFile(resolve(output, record.filename))) !== record.sha256) throw new Error('Cache differs');
    } catch {
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({ acceptDownloads: true });
        const sourceUrl = 'https://mikaelha.itch.io/silted-stacks';
        await page.goto(sourceUrl, { waitUntil: 'domcontentloaded' });
        // Only the publicly presented free demo download. Never click Buy Now,
        // request a hidden upload endpoint, or extract a hosted iframe payload.
        await page.getByRole('heading', { name: 'Download demo', exact: true }).waitFor();
        const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('link', { name: 'Download', exact: true }).click()]);
        const filename = 'itch-silted-stacks.zip';
        await download.saveAs(resolve(output, filename));
        const bytes = await readFile(resolve(output, filename));
        if (bytes.length > 1024 * 1024) throw new Error('The free demo changed size unexpectedly. Review the creator page before accepting it.');
        record = { id: 'itch-silted', title: 'Silted Stacks — Free Demo', kind: 'itch-normal-download', filename, originalFilename: download.suggestedFilename(), sha256: hash(bytes), bytes: bytes.length, sourceUrl, acquiredAt: new Date().toISOString(), license: { spdx: null, kind: 'proprietary', sourceUrl }, licenseObservation: 'Creator page states personal play only, no source-code or commercial asset-reuse license.', acquisition: 'Clicked the public Download link in the Download demo section. No purchase, iframe extraction, download-control bypass, or proxy.', covers: ['real itch.io game acquired through normal visible free demo download', 'single HTML package', 'explicit no persistent saves'] };
        await writeFile(resolve(output, 'itch-silted.provenance.json'), JSON.stringify(record, null, 2));
      } finally { await browser.close(); }
    }
    records.push(record);
  }
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), records }, null, 2));
  return records;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) acquireCorpus({ includeLocal: process.argv.includes('--include-local'), includeItch: process.argv.includes('--itch'), refresh: process.argv.includes('--refresh') }).then(records => console.log(`Acquired ${records.length} genuine applications into ignored test-results/corpus; provenance and SHA-256 recorded.`)).catch(error => { console.error(error); process.exitCode = 1; });
