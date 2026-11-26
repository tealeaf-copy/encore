// Pottery Lab service worker: fast repeat visits and an offline shell, not an offline app.
// - Shell pages (the feed, Discover, Plans, Chats, People, Settings, Saved, Ideas, the app): stale-while-revalidate.
//   A page you opened before draws at once from the cache while a fresh copy is fetched for next time; the data in it
//   always comes from the API. Every other page is network first. Offline: the cached copy, else /offline.html.
// - Versioned files (/x.js?v=<hash>, served immutable), hashed app bundles (/_app/*) and fonts: cache first.
//   Other scripts, styles and icons: stale-while-revalidate.
// - A few read-only APIs the shell pages open with (your plans, the feed, Discover, your chats): network first with a
//   timeout. A slow or dropped answer falls back to the last copy (marked x-pl-cache: stale) instead of a spinner.
//   Every other API call and upload goes straight to the network. Signing out or in drops the cached pages and data.
// - Cache busting: the server stamps VERSION (a hash of this file, offline.html, the manifest and native.js) at /sw.js;
//   a new version installs, takes over, and deletes every cache from older versions.
const VERSION = "__SW_VERSION__";
const SHELL = "pl-shell-" + VERSION, STATIC = "pl-static-" + VERSION, PAGES = "pl-pages-" + VERSION, DATA = "pl-data";
const SHELL_FILES = ["/offline.html", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/apple-touch-icon.png", "/mascot.js", "/system.css"];
const MAX_PAGES = 25, MAX_STATIC = 300, API_TIMEOUT = 4000;
// pages that are the same shell for everyone (their content comes from the API), so a cached copy is always safe to show
const SWR_PAGES = /^\/(feed|discover|plans|chats|people|settings|saved|ideas|events|hosts|about)$/;
const swrPage = (url) => SWR_PAGES.test(url.pathname) || (url.pathname === "/" && url.searchParams.get("app") === "1");
// read-only APIs worth a last copy
const DATA_APIS = /^\/api\/(me\/plans|me\/feed|public\/feed|public\/discover|chats)$/;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("pl-") && k !== DATA && ![SHELL, STATIC, PAGES].includes(k)) await caches.delete(k);
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
    await self.clients.claim();
  })());
});
const forget = () => Promise.all([caches.delete(DATA), caches.delete(PAGES)]).catch(() => {});
self.addEventListener("message", (e) => {
  if (e.data === "signed-out") e.waitUntil?.(forget());
  // public/shell.js asks for a page a finger just landed on, so the tap opens it from the cache
  else if (e.data && e.data.warm) { try { const u = new URL(e.data.warm, self.location.origin); if (u.origin === self.location.origin && swrPage(u)) e.waitUntil?.(refresh(new Request(u.href, { credentials: "same-origin" }))); } catch {} }
});

async function trim(name, max) { const c = await caches.open(name), keys = await c.keys(); for (const k of keys.slice(0, Math.max(0, keys.length - max))) await c.delete(k); }
const cacheable = (res) => res && res.ok && res.type === "basic" && !res.redirected && !/no-store/.test(res.headers.get("Cache-Control") || "");
// fetch a page and keep it for next time
async function refresh(req, preload) {
  const res = (preload && (await preload.catch(() => null))) || (await fetch(req));
  if (cacheable(res)) { const c = await caches.open(PAGES); await c.put(req.url, res.clone()).catch(() => {}); trim(PAGES, MAX_PAGES).catch(() => {}); }
  return res;
}
const offline = async (req) => (await caches.match(req.url, { cacheName: PAGES })) || (await caches.match("/offline.html")) || new Response("You're offline.", { status: 503, headers: { "Content-Type": "text/plain" } });

self.addEventListener("fetch", (e) => {
  const req = e.request; if (req.method !== "GET") {
    // signing out (or in as someone else) drops the cached pages and data
    if (req.method === "POST" && /^\/api\/(logout|login|signup)$/.test(new URL(req.url).pathname)) e.waitUntil(forget());
    return;
  }
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  if (req.mode === "navigate") {
    if (same && swrPage(url)) {
      // stale-while-revalidate: the cached shell now, a fresh one for next time
      e.respondWith((async () => {
        const hit = await caches.match(req.url, { cacheName: PAGES });
        const fresh = refresh(req, e.preloadResponse);
        // the page changed meaning since it was cached (a sign-in ran out and it now redirects): reload it fresh
        if (hit) { e.waitUntil(fresh.then(async (r) => { if (r.redirected || r.status !== hit.status) (await self.clients.get(e.resultingClientId))?.postMessage({ plReload: req.url }); }).catch(() => {})); return hit; }
        try { return await fresh; } catch { return offline(req); }
      })());
      return;
    }
    // other pages: network first; a copy of each page you open for offline
    e.respondWith((async () => { try { return await refresh(req, e.preloadResponse); } catch { return offline(req); } })());
    return;
  }
  if (same && DATA_APIS.test(url.pathname) && !url.search.includes("v=")) {
    e.respondWith((async () => {
      const net = fetch(req).then(async (res) => { if (res.ok) await (await caches.open(DATA)).put(req, res.clone()).catch(() => {}); return res; });
      const late = new Promise((r) => setTimeout(r, API_TIMEOUT));
      const first = await Promise.race([net.catch(() => null), late.then(() => "late")]);
      if (first && first !== "late") return first;
      const hit = await caches.match(req, { cacheName: DATA });
      if (hit) { const h = new Headers(hit.headers); h.set("x-pl-cache", "stale"); return new Response(hit.body, { status: hit.status, headers: h }); }
      if (first === "late") { try { return await net; } catch {} }
      return url.pathname === "/api/me/plans" ? Response.json({ plans: [], offline: true }) : Response.json({ code: "offline", message: "You're offline. This shows again when you're back online.", offline: true }, { status: 503 });
    })());
    return;
  }
  if (same && /^\/(api|_blob|sw\.js|\.well-known)\b/.test(url.pathname)) return;
  const fonts = /^https:\/\/fonts\.(googleapis|gstatic)\.com$/.test(url.origin);
  // never changes: cache first
  if (same && (url.pathname.startsWith("/_app/") || url.pathname.startsWith("/fonts/") || url.searchParams.has("v"))) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && (url.pathname.startsWith("/_app/") || /immutable|max-age=[1-9]\d{5,}/.test(res.headers.get("Cache-Control") || ""))) { const copy = res.clone(); e.waitUntil(caches.open(STATIC).then((c) => c.put(req, copy)).then(() => trim(STATIC, MAX_STATIC)).catch(() => {})); }
      return res; })));
    return;
  }
  if ((same && /\.(js|css|svg|png|webp|jpg|woff2?|webmanifest|json)$/.test(url.pathname)) || fonts) {
    e.respondWith((async () => {
      const c = await caches.open(STATIC), hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res.ok || res.type === "opaque") c.put(req, res.clone()).catch(() => {}); return res; }).catch(() => hit);
      if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
      return net;
    })());
  }
});

// Web push is not used yet (the iOS and Android apps get pushes through APNs and FCM); this opens a link if one arrives.
self.addEventListener("notificationclick", (e) => { e.notification.close(); const link = e.notification.data?.link || "/feed"; e.waitUntil(self.clients.openWindow(link)); });
