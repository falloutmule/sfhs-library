export function initLauncherUpdates(buildId) {
  if(!['https:','http:'].includes(location.protocol))return;
  const $=id=>document.getElementById(id);
  let checking=false,lastCheck=0;
  async function check(manual=false) {
    if(checking || (!manual && Date.now()-lastCheck<60000))return;
    checking=true;lastCheck=Date.now();
    if(manual)$('launcher-update-status').textContent='Checking for an update…';
    try {
      const response=await fetch('./release.json',{cache:'no-store',signal:AbortSignal.timeout(8000)});
      if(!response.ok)throw new Error('Release information unavailable');
      const release=await response.json();
      if(!/^[a-f0-9]{40}$/i.test(release.commit) || typeof release.buildId!=='string')throw new Error('Invalid release information');
      const changed=release.buildId!==buildId;
      $('launcher-update').hidden=!changed;
      $('launcher-update-status').textContent=changed?'A newer Library is ready. Use Open updated Library above. Your installed apps and saves stay here.':'You have the latest Library.';
      $('build-id').textContent=`${buildId} · ${changed?'Server release':'Commit'} ${release.commit.slice(0,12)}`;
    } catch {
      if(manual)$('launcher-update-status').textContent=navigator.onLine?'Couldn’t check for an update. Your current library is still available. Try again when connected.':'You’re offline. Reconnect to check for a Library update.';
    } finally { checking=false; }
  }
  $('check-launcher-update').addEventListener('click',()=>check(true));
  $('launcher-update').querySelector('a').addEventListener('click',event=>{
    // Both identical URLs and a change from #settings to #discover can be
    // in-page jumps. An explicit update must always request a document.
    const target=new URL(event.currentTarget.href);
    if(target.origin===location.origin && target.pathname===location.pathname && target.search===location.search && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey){event.preventDefault();history.replaceState(null,'',target.href);location.reload();}
  });
  if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(registration=>registration.update()).catch(()=>{});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});
  window.addEventListener('online',()=>check(true));
  check();
}
