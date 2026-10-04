import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { validateSave } from './runtime.js';

export const MAX_ARCHIVE = 150 * 1024 * 1024;
export async function hashBytes(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function text(value, max = 2000) {
  if (value === undefined || value === null) return '';
  assert(typeof value === 'string' && value.length <= max, 'Backup contains an invalid or oversized text field.');
  return value;
}
function safeStrings(values, max = 10000) {
  if(values===undefined || values===null)return [];
  assert(Array.isArray(values) && values.length<=max,'Backup contains too many collection or metadata entries.');
  return values.map(x => text(x, 2000));
}
export function validSave(save) {
  const result = validateSave(save);
  result.localStorage = Object.assign(Object.create(null),result.localStorage);
  return result;
}
export function unzipBounded(bytes) {
  assert(bytes.byteLength <= MAX_ARCHIVE, 'Archive exceeds the 150 MiB import limit.');
  let size = 0, count = 0;
  const seen = new Set();
  const files = unzipSync(bytes, { filter: entry => {
    count++;
    size += entry.originalSize;
    assert(count <= 3000 && size <= MAX_ARCHIVE && entry.originalSize >= 0, 'Archive expands beyond the safe import limit.');
    assert(!/[\\\x00-\x1f:]/.test(entry.name) && !entry.name.split('/').some(x => x === '..' || x === '.') && !entry.name.startsWith('/'), 'Unsafe archive path.');
    const normalized=entry.name.replace(/\/$/,'');
    assert(normalized && !seen.has(normalized) && !['__proto__','constructor','prototype'].includes(normalized),'Duplicate or unsafe archive path.');
    seen.add(normalized);
    return true;
  } });
  let actual = 0;
  for (const data of Object.values(files)) { actual += data.length; assert(actual <= MAX_ARCHIVE, 'Archive expands beyond the safe import limit.'); }
  return files;
}
export async function exportArchive(snapshot) {
  const files = Object.create(null);
  const apps = [];
  let expandedSize = 0, fileCount = 2;
  assert(snapshot.apps.length <= 500, 'Backup exceeds the 500-app import limit.');
  for (const app of snapshot.apps) {
    const versions = [];
    for (const version of app.versions) {
      const base = `apps/${app.id}/${version.id}`;
      const original = new Uint8Array(version.original);
      const executable = strToU8(version.capsule);
      expandedSize += original.byteLength + executable.byteLength;
      fileCount += 2;
      assert(expandedSize <= MAX_ARCHIVE && fileCount <= 3000, 'Backup exceeds the 150 MiB expanded import limit. Export individual apps instead.');
      assert(await hashBytes(original) === version.originalHash, `Original checksum mismatch: ${app.name}`);
      assert(await hashBytes(executable) === version.executableHash, `Executable checksum mismatch: ${app.name}`);
      files[`${base}/original.bin`] = original;
      files[`${base}/capsule.html`] = executable;
      const { original: ignoredOriginal, capsule: ignoredCapsule, ...metadata } = version;
      versions.push({ ...metadata, originalPath: `${base}/original.bin`, executablePath: `${base}/capsule.html`, save: validSave(version.save) });
    }
    apps.push({ ...app, versions });
  }
  const manifest = { format: 'sfhs-library', schema: 1, exportedAt: new Date().toISOString(), apps, settings: snapshot.settings };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  assert(files['manifest.json'].length < 12 * 1024 * 1024, 'Backup metadata exceeds the 12 MiB manifest limit. Export individual apps instead.');
  files['README.txt'] = strToU8('SFHS Library portable archive, schema 1. Original acquired payloads and runnable capsules are stored separately. Import this ZIP in SFHS Library to recover the library. Unsupported/unknown saves remain unsupported/unknown. SHA-256 checksums are in manifest.json. Keep a copy outside browser storage.');
  assert(expandedSize + files['manifest.json'].length + files['README.txt'].length <= MAX_ARCHIVE, 'Backup exceeds the 150 MiB expanded import limit. Export individual apps instead.');
  const zip = zipSync(files, { level: 6 });
  assert(zip.byteLength <= MAX_ARCHIVE, 'Backup exceeds the current 150 MiB limit. Export individual apps instead.');
  return zip;
}
const PROFILES = new Set(['native-sfhs','isolated-single-file','isolated-packaged','network-dependent']);
export async function readArchive(bytes) {
  const files = unzipBounded(bytes);
  assert(files['manifest.json'] && files['manifest.json'].length < 12 * 1024 * 1024, 'No valid backup manifest was found.');
  const manifest = JSON.parse(strFromU8(files['manifest.json']));
  assert(manifest.format === 'sfhs-library' && manifest.schema === 1, 'Unsupported backup format or version.');
  assert(Array.isArray(manifest.apps) && manifest.apps.length <= 500, 'Invalid application list.');
  const seen = new Set();
  const apps = [];
  for (const raw of manifest.apps) {
    assert(typeof raw.id==='string' && /^[a-zA-Z0-9-]{1,80}$/.test(raw.id) && !seen.has(raw.id), 'Invalid or duplicate application identity.');
    seen.add(raw.id);
    assert(Array.isArray(raw.versions) && raw.versions.length > 0 && raw.versions.length <= 100, 'Invalid retained versions.');
    const versions = [], versionIds = new Set();
    for (const v of raw.versions) {
      assert(typeof v.id==='string' && /^[a-zA-Z0-9-]{1,80}$/.test(v.id) && !versionIds.has(v.id), 'Invalid version identity.');
      versionIds.add(v.id);
      assert(v.originalPath===`apps/${raw.id}/${v.id}/original.bin` && v.executablePath===`apps/${raw.id}/${v.id}/capsule.html`,'Version payload paths do not match their identities.');
      const original = files[v.originalPath], executable = files[v.executablePath];
      assert(original && executable, 'Backup is missing executable payload bytes.');
      assert(await hashBytes(original) === v.originalHash, `Original checksum failed for ${text(raw.name)}.`);
      assert(await hashBytes(executable) === v.executableHash, `Executable checksum failed for ${text(raw.name)}.`);
      assert(PROFILES.has(v.profile), 'Unsupported runtime profile.');
      const source = v.source || {};
      versions.push({ id: v.id, label: text(v.label, 120), filename: text(v.filename, 1024), acquiredAt: text(v.acquiredAt, 60),
        original, capsule: strFromU8(executable), originalHash: v.originalHash, executableHash: v.executableHash,
        profile: v.profile, offline: v.offline === 'network' ? 'network' : 'candidate',
        saveSupport: ['supported','partial','unsupported','unknown'].includes(v.saveSupport) ? v.saveSupport : 'unknown',
        save: validSave(v.save), reasons: safeStrings(v.reasons), warnings: safeStrings(v.warnings), fileCount: Number(v.fileCount) || 1,
        networkAllowed: false, networkOrigins: safeStrings(v.networkOrigins),
        capabilities: {},
        source: { kind: text(source.kind, 30), url: text(source.url,8192), repository: text(source.repository), version: text(source.version, 120), entry:text(source.entry,1024), acquisition:text(source.acquisition),
          license: { spdx: text(source.license?.spdx, 80), kind: text(source.license?.kind, 40), sourceUrl: text(source.license?.sourceUrl) } }
      });
    }
    assert(versionIds.has(raw.activeVersionId), 'The backup active version is missing.');
    apps.push({ id: raw.id, name: text(raw.name, 160) || 'Untitled app', description: text(raw.description), category: text(raw.category, 80) || 'Uncategorized',
      collections: safeStrings(raw.collections), favorite: raw.favorite === true, createdAt: text(raw.createdAt, 60), updatedAt: text(raw.updatedAt, 60),
      lastLaunchedAt: text(raw.lastLaunchedAt, 60) || null, launchCount: Math.max(0, Math.min(1e9, Number(raw.launchCount) || 0)),
      activeVersionId: raw.activeVersionId, versions, lastBackupAt: text(raw.lastBackupAt, 60) || null });
  }
  return { apps, settings: { collections: safeStrings(manifest.settings?.collections), lastExportAt: null }, exportedAt: text(manifest.exportedAt, 60) };
}
