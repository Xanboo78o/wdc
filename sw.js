// sw.js — the app half of "an app I can download that updates automatically".
//
// An installed page is still a page, so a push to master IS the update. What
// this file adds is (a) it still runs with the network off, and (b) it NOTICES
// a new version instead of waiting for someone to think about reloading.
//
// Two rules, and they are opposites on purpose:
//
//   CODE IS NETWORK-FIRST. HTML and JS are fetched fresh whenever there is a
//   network, with the cache as the fallback. The alternative — cache-first
//   code — is exactly the failure this laptop has been bitten by before: new
//   HTML running old modules, which presents as "you didn't add the thing you
//   said you added" and sends you hunting a bug that does not exist. A few
//   hundred KB of conditional requests is a cheap price for never doing that
//   again.
//
//   DATA IS CACHE-FIRST. Photographs of asphalt do not change. They are served
//   from the cache instantly and refreshed quietly behind you.
//
// The version is data, not code: version.json carries the build id and the
// file list, so this file never has to change for the app to know it is stale.
// A service worker only reinstalls when its own BYTES change, which would mean
// stamping it on every release and remembering to — and the release you forget
// is the one that matters.
const VKEY = '__wdc_version';
const MANIFEST = './version.json';

const isCode = (url) => /\.(html|js|css|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/');

async function currentVersion(cache) {
  const r = await cache.match(VKEY);
  return r ? r.text() : null;
}

async function install(cache, manifest) {
  // One at a time rather than addAll: a single 404 fails an addAll entirely,
  // and an app that will not install because one texture moved is worse than
  // an app missing one texture.
  let ok = 0;
  await Promise.all(manifest.files.map(async (f) => {
    try {
      const res = await fetch(new Request(f, { cache: 'reload' }));
      if (res.ok) { await cache.put(f, res); ok++; }
    } catch { /* offline mid-install: whatever landed is still useful */ }
  }));
  await cache.put(VKEY, new Response(manifest.version));
  return ok;
}

async function checkForUpdate({ announce = true } = {}) {
  const cache = await caches.open('wdc');
  let manifest;
  try {
    manifest = await (await fetch(MANIFEST, { cache: 'no-store' })).json();
  } catch { return null; }                 // offline: nothing to say
  const have = await currentVersion(cache);
  if (have === manifest.version) return null;
  const files = await install(cache, manifest);
  if (announce && have !== null) {
    for (const c of await self.clients.matchAll()) {
      c.postMessage({ type: 'wdc-update', version: manifest.version, files });
    }
  }
  return manifest.version;
}

self.addEventListener('install', (e) => {
  // Take over at once. The usual "wait until every tab closes" dance is right
  // for an app with unsaved state; this one has none, and the whole point is
  // that it updates without being asked twice.
  e.waitUntil(checkForUpdate({ announce: false }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== 'wdc') await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'wdc-check') e.waitUntil(checkForUpdate());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.endsWith('version.json')) return;         // always live

  e.respondWith((async () => {
    const cache = await caches.open('wdc');
    if (isCode(url)) {
      try {
        const res = await fetch(e.request);
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      } catch {
        return (await cache.match(e.request)) || (await cache.match('./app.html')) ||
          new Response('offline', { status: 503 });
      }
    }
    const hit = await cache.match(e.request);
    if (hit) {
      // Refresh it behind the reader's back; they get this copy now.
      e.waitUntil(fetch(e.request).then(r => r.ok && cache.put(e.request, r)).catch(() => {}));
      return hit;
    }
    try {
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch {
      return new Response('offline', { status: 503 });
    }
  })());
});
