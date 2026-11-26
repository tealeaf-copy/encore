// Pottery Lab service worker: an offline shell, not an offline app.
// - Pages always come from the network. Offline, a page you opened before comes from the cache, else /offline.html
//   (Potto, "you're offline", and your next plans from the last time they loaded).
// - Hashed app bundles (/_app/*) never change, so they're cache-first. Scripts, styles, icons and fonts are
//   stale-while-revalidate. The API and uploads are never cached, except the last copy of your plans for the offline page.
// - Cache busting: the server stamps VERSION (a hash of this file, offline.html and the manifest) at /sw.js; a new
//   version installs, takes over, and deletes every cache from older versions.
const VERSION = "__SW_VERSION__";
const SHELL = "pl-shell-" + VERSION, STATIC = "pl-static-" + VERSION, PAGES = "pl-pages-" + VERSION, DATA = "pl-data";
const SHELL_FILES = ["/offline.html", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/apple-touch-icon.png", "/mascot.js", "/system.css"];
const MAX_PAGES = 25;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("pl-") && k !== DATA && ![SHELL, STATIC, PAGES].includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener("message", (e) => { if (e.data === "signed-out") caches.delete(DATA).catch(() => {}); });

async function trim(name, max) { const c = await caches.open(name), keys = await c.keys(); for (const k of keys.slice(0, Math.max(0, keys.length - max))) await c.delete(k); }

self.addEventListener("fetch", (e) => {
  const req = e.request; if (req.method !== "GET") {
    // signing out drops the cached plans
    if (req.method === "POST" && new URL(req.url).pathname === "/api/logout") e.waitUntil(caches.delete(DATA));
    return;
  }
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  // pages: network first; a copy of each page you open (never the API data in it) for offline
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (same && res.ok && res.type === "basic" && !/no-store/.test(res.headers.get("Cache-Control") || "")) { const c = await caches.open(PAGES); c.put(req, res.clone()).then(() => trim(PAGES, MAX_PAGES)).catch(() => {}); }
        return res;
      } catch {
        return (await caches.match(req, { cacheName: PAGES })) || (await caches.match("/offline.html")) || new Response("You're offline.", { status: 503, headers: { "Content-Type": "text/plain" } });
      }
    })());
    return;
  }
  if (same && url.pathname === "/api/me/plans") {
    e.respondWith((async () => { try { const res = await fetch(req); if (res.ok) (await caches.open(DATA)).put(req, res.clone()); return res; } catch { return (await caches.match(req, { cacheName: DATA })) || Response.json({ plans: [], offline: true }); } })());
    return;
  }
  if (same && /^\/(api|_blob|sw\.js|\.well-known)\b/.test(url.pathname)) return;
  if (same && url.pathname.startsWith("/_app/")) { e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) caches.open(STATIC).then((c) => c.put(req, res.clone())); return res; }))); return; }
  const fonts = /^https:\/\/fonts\.(googleapis|gstatic)\.com$/.test(url.origin);
  if ((same && /\.(js|css|svg|png|webp|jpg|woff2?|webmanifest|json)$/.test(url.pathname)) || fonts) {
    e.respondWith((async () => {
      const c = await caches.open(STATIC), hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })());
  }
});

// Web push is not used yet (the iOS and Android apps get pushes through APNs and FCM); this opens a link if one arrives.
self.addEventListener("notificationclick", (e) => { e.notification.close(); const link = e.notification.data?.link || "/feed"; e.waitUntil(self.clients.openWindow(link)); });
