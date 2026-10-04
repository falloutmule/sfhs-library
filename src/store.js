export const DB_NAME = 'sfhs-library-v1';
let database;
const req = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const done = tx => new Promise((resolve, reject) => {
  tx.oncomplete = resolve;
  tx.onerror = tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted.'));
});
export async function openStore() {
  if (database) return database;
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore('apps', { keyPath: 'id' });
    request.result.createObjectStore('settings');
  };
  database = await req(request);
  database.onversionchange = () => { database.close(); database = null; };
  return database;
}
export async function listApps() {
  return req((await openStore()).transaction('apps').objectStore('apps').getAll());
}
export async function getApp(id) {
  return req((await openStore()).transaction('apps').objectStore('apps').get(id));
}
export async function putApp(app) {
  const tx = (await openStore()).transaction('apps', 'readwrite');
  tx.objectStore('apps').put(app);
  await done(tx);
}
export async function mutateApp(id, transform) {
  const tx = (await openStore()).transaction('apps', 'readwrite');
  const completed = done(tx);
  const store = tx.objectStore('apps');
  const request = store.get(id);
  let result;
  request.onsuccess = () => {
    if (!request.result) { tx.abort(); return; }
    try { result = transform(request.result); store.put(result); }
    catch { tx.abort(); }
  };
  await completed;
  return result;
}
export async function deleteApp(id) {
  const tx = (await openStore()).transaction('apps', 'readwrite');
  tx.objectStore('apps').delete(id);
  await done(tx);
}
export async function getSettings() {
  return (await req((await openStore()).transaction('settings').objectStore('settings').get('library'))) || { collections: [], lastExportAt: null };
}
export async function saveSettings(value) {
  const tx = (await openStore()).transaction('settings', 'readwrite');
  tx.objectStore('settings').put(value, 'library');
  await done(tx);
}
export async function librarySnapshot() {
  const tx = (await openStore()).transaction(['apps', 'settings']);
  const [apps, settings] = await Promise.all([
    req(tx.objectStore('apps').getAll()), req(tx.objectStore('settings').get('library'))
  ]);
  return { apps, settings: settings || { collections: [], lastExportAt: null } };
}
// A fully validated archive is restored in one transaction. Existing items are
// never overwritten by a merge; ID collisions are given new local identities.
export async function restoreSnapshot(snapshot) {
  const db = await openStore();
  const tx = db.transaction(['apps', 'settings'], 'readwrite');
  const completed = done(tx);
  const appStore = tx.objectStore('apps');
  const settingsStore = tx.objectStore('settings');
  const current = settingsStore.get('library');
  current.onsuccess = () => {
    const old = current.result || { collections: [] };
    settingsStore.put({ ...old, collections: [...new Set([...old.collections, ...snapshot.settings.collections])] }, 'library');
  };
  for (const item of snapshot.apps) {
    const lookup = appStore.get(item.id);
    lookup.onsuccess = () => appStore.put(lookup.result ? { ...item, id: crypto.randomUUID() } : item);
  }
  await completed;
}
