// Updates touch only this launcher's shell cache. Apps and saves stay in IndexedDB.
const HASH = 'b25ef5cfdffa0b54fdabca6b6ae32f580c4579b8f9c97bfeaaba7f3c34bd5cfc';
const PREFIX = 'sfhs-launcher:' + new URL(self.registration.scope).pathname + ':';
const CACHE = PREFIX + HASH.slice(0,16);
const SHELL = new URL('./index.html',self.registration.scope).href;
const SHELL_PATHS = new Set(['./','./index.html','./start.html'].map(p=>new URL(p,self.registration.scope).pathname));
const FILES = ['./manifest.webmanifest','./icon.svg','./catalog.json'];
const FILE_PATHS = new Set(FILES.map(p=>new URL(p,self.registration.scope).pathname));
async function isThisBuild(response) {
  const digest = await crypto.subtle.digest('SHA-256',await response.clone().arrayBuffer());
  return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('') === HASH;
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const response=await fetch(new Request(SHELL,{cache:'reload'}));
  if(!response.ok || !await isThisBuild(response))throw new Error('Launcher build changed during update. Retry the update.');
  const cache=await caches.open(CACHE);
  await cache.put(SHELL,response);
  await cache.addAll(FILES.map(p=>new Request(new URL(p,self.registration.scope),{cache:'reload'})));
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const name of await caches.keys()) {
    if(name===CACHE)continue;
    // Legacy caches had no scope prefix. Match an actual shell URL before
    // migrating one; this origin can host other independent Pages apps.
    const legacy=/^sfhs-[a-f0-9]{16}$/.test(name) && !!await (await caches.open(name)).match(SHELL);
    if(name.startsWith(PREFIX) || legacy)await caches.delete(name);
  }
  await self.clients.claim();
})()));
async function shell(request) {
  const cache=await caches.open(CACHE);
  const abort=new AbortController();
  const timeout=setTimeout(()=>abort.abort(),3500);
  try {
    // Navigations reach the deployment; a running tab is never auto-reloaded.
    const response=await fetch(request,{cache:'no-store',signal:abort.signal});
    if(!response.ok)throw new Error('Launcher unavailable');
    // Serve newer bytes immediately, without relabeling them as this build.
    if(await isThisBuild(response))await cache.put(SHELL,response.clone());
    return response;
  } catch(error) {
    const cached=await cache.match(SHELL);
    if(cached)return cached;
    throw error;
  } finally { clearTimeout(timeout); }
}
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET' || url.origin!==location.origin)return;
  if(SHELL_PATHS.has(url.pathname))event.respondWith(shell(event.request));
  else if(FILE_PATHS.has(url.pathname))event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(event.request,{ignoreSearch:true})) || fetch(event.request)));
});
