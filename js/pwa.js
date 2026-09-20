// pwa.js — register the service worker, and notice a new version.
//
// A classic script, not a module, so it can be dropped into any page in this
// repo with one line and without touching an import map.
//
// It asks the worker to check for a new build on load, when the window comes
// back to the front, and every five minutes. When one turns up it fires a
// `wdc-update` event on window; a page that is showing a menu can reload on
// it, and a page that is mid-lap can put a line on screen instead. Reloading
// somebody out of a corner at 250 km/h would be a strange way to deliver good
// news.
(function () {
  if (!('serviceWorker' in navigator)) return;
  const CHECK_MS = 5 * 60 * 1000;

  window.addEventListener('load', async () => {
    let reg;
    try {
      reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    } catch { return; }                       // file:// or a locked-down browser

    const check = () => {
      reg.update().catch(() => {});
      navigator.serviceWorker.controller?.postMessage('wdc-check');
    };
    setTimeout(check, 2500);
    setInterval(check, CHECK_MS);
    addEventListener('visibilitychange', () => { if (!document.hidden) check(); });

    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type !== 'wdc-update') return;
      window.__wdcUpdate = e.data;
      dispatchEvent(new CustomEvent('wdc-update', { detail: e.data }));
    });
  });

  // Chromium fires this instead of showing its own install button when a page
  // is installable; catching it is what lets the launcher have a real one.
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.__wdcInstall = e;
    dispatchEvent(new CustomEvent('wdc-installable'));
  });
})();
