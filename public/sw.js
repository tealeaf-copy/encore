// Pottery Lab service worker: fast repeat visits and an offline shell, not an offline app.
// - Pages: network first, always. A page waits up to PAGE_TIMEOUT for the network; a slow or dropped answer falls back
//   to the last good copy of that page (or /offline.html), and the fresh answer is still kept for next time. Only a
//   plain 200 HTML answer is ever kept: never an error page, a redirect, a JSON answer or anything marked no-store.
//   (Shell pages used to be stale-while-revalidate: a phone could keep drawing an old or broken copy of a page with
//   another day's scripts, and the fix only showed on the visit after. REV below drops every copy kept that way.)
// - Versioned files (/x.js?v=<hash>, served immutable), hashed app bundles (/_app/*) and fonts: cache first.
//   Other scripts and styles: network first (the kept copy only when slow or offline); icons: stale-while-revalidate, 200s only.
// - A few read-only APIs the shell pages open with (your plans, the feed, Discover, your chats): network first with a
//   timeout. A slow or dropped answer falls back to the last copy (marked x-pl-cache: stale) instead of a spinner.
//   Every other API call and upload goes straight to the network. Signing out or in drops the cached pages and data.
// - Cache busting: the server stamps VERSION (a hash of this file, offline.html, the manifest and native.js) at /sw.js;
//   a new version installs, takes over, and deletes every cache from older versions (the data cache too).
const VERSION = "__SW_VERSION__";
const REV = 20; // bump to drop every cached page, file and answer on every phone
const SHELL = "pl-shell-" + VERSION, STATIC = "pl-static-" + VERSION, PAGES = "pl-pages-" + VERSION + "-r" + REV, DATA = "pl-data-r" + REV;
const SHELL_FILES = ["/offline.html", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/apple-touch-icon.png", "/mascot.js", "/system.css"];
const MAX_PAGES = 25, MAX_STATIC = 300, API_TIMEOUT = 4000, PAGE_TIMEOUT = 3500;
// pages a finger may warm ahead of a tap (public/shell.js): the same shell for everyone, their content comes from the API
const WARM_PAGES = /^\/(feed|discover|plans|chats|people|settings|saved|ideas|events|hosts|about|start)$/;
const warmPage = (url) => WARM_PAGES.test(url.pathname) || (url.pathname === "/" && url.searchParams.get("app") === "1");
// read-only APIs worth a last copy
const DATA_APIS = /^\/api\/(me\/plans|me\/feed|public\/feed|public\/discover|chats)$/;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("pl-") && ![SHELL, STATIC, PAGES, DATA].includes(k)) await caches.delete(k);
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
    await self.clients.claim();
  })());
});
const forget = () => Promise.all([caches.delete(DATA), caches.delete(PAGES)]).catch(() => {});
// the saved feed answers (signed in and out), after you gave kudos or commented (server/feedcomments.js "Freshness")
const dropFeed = async () => { try { const c = await caches.open(DATA); for (const k of await c.keys()) if (/\/api\/(me\/feed|public\/feed)(\?|$)/.test(new URL(k.url).pathname + "?")) await c.delete(k); } catch {} };
self.addEventListener("message", (e) => {
  if (e.data === "signed-out") e.waitUntil?.(forget());
  // public/shell.js asks for a page a finger just landed on, so a slow network still has a fresh copy to fall back on
  else if (e.data && e.data.warm) { try { const u = new URL(e.data.warm, self.location.origin); if (u.origin === self.location.origin && warmPage(u)) e.waitUntil?.(refresh(new Request(u.href, { credentials: "same-origin", headers: { accept: "text/html" } })).catch(() => {})); } catch {} }
});

async function trim(name, max) { const c = await caches.open(name), keys = await c.keys(); for (const k of keys.slice(0, Math.max(0, keys.length - max))) await c.delete(k); }
// an answer worth keeping: a plain 200 from us, not a redirect, not marked no-store
const cacheable = (res) => !!res && res.status === 200 && res.type === "basic" && !res.redirected && !/no-store/.test(res.headers.get("Cache-Control") || "");
// a page worth keeping: all of that, and HTML (never an error page, never a JSON answer)
const pageOk = (res) => cacheable(res) && /^text\/html/i.test(res.headers.get("Content-Type") || "");
// one copy per page, whatever the #hash
const pageKey = (u) => String(u).split("#")[0];
// fetch a page (the navigation preload when there is one) and keep a good answer for next time
async function refresh(req, preload) {
  const res = (preload && (await preload.catch(() => null))) || (await fetch(req));
  if (pageOk(res)) { const c = await caches.open(PAGES); await c.put(pageKey(req.url), res.clone()).catch(() => {}); trim(PAGES, MAX_PAGES).catch(() => {}); }
  return res;
}
const lastCopy = async (req) => { const hit = await caches.match(pageKey(req.url), { cacheName: PAGES }); return hit && pageOk(hit) ? hit : null; };
const offline = async (req) => (await lastCopy(req)) || (await caches.match("/offline.html")) || new Response("You're offline.", { status: 503, headers: { "Content-Type": "text/plain" } });
// network first with a timeout: the network's answer when it comes in time (any status: a 404 page is the truth); a
// slow one gets the last good copy, and only a page with no copy keeps waiting for the network
async function page(e) {
  const net = refresh(e.request, e.preloadResponse); e.waitUntil(net.catch(() => {}));
  const first = await Promise.race([net.catch(() => "down"), new Promise((r) => setTimeout(() => r("late"), PAGE_TIMEOUT))]);
  if (first !== "late" && first !== "down") return first;
  const hit = await lastCopy(e.request); if (hit) return hit;
  if (first === "late") { try { return await net; } catch {} }
  return offline(e.request);
}

self.addEventListener("fetch", (e) => {
  const req = e.request; if (req.method !== "GET") {
    // signing out (or in as someone else) drops the cached pages and data
    if (req.method === "POST" && /^\/api\/(logout|login|signup|auth\/(code|email)\/verify|me\/delete)$/.test(new URL(req.url).pathname)) e.waitUntil(forget());
    // a kudos or a comment that went through: the saved feed copies have old counts, so they go (the next read is fresh)
    else if ((/^\/api\/feed\/(kudos|comments)(\/|$)/.test(new URL(req.url).pathname) || /^\/api\/story(\/(?!media$|seen$)[A-Za-z0-9_-]+)?$/.test(new URL(req.url).pathname) /* a story made or deleted: a saved feed without it must not answer on a slow connection */) && new URL(req.url).origin === self.location.origin)
      e.respondWith(fetch(req).then((res) => { if (res.ok) e.waitUntil(dropFeed()); return res; }));
    return;
  }
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  if (req.mode === "navigate") { if (same) e.respondWith(page(e)); return; }
  if (same && DATA_APIS.test(url.pathname) && !url.search.includes("v=")) {
    e.respondWith((async () => {
      const net = fetch(req).then(async (res) => { if (cacheable(res) && /json/i.test(res.headers.get("Content-Type") || "")) await (await caches.open(DATA)).put(req, res.clone()).catch(() => {}); return res; });
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
      if (cacheable(res) && (url.pathname.startsWith("/_app/") || /immutable|max-age=[1-9]\d{5,}/.test(res.headers.get("Cache-Control") || ""))) { const copy = res.clone(); e.waitUntil(caches.open(STATIC).then((c) => c.put(req, copy)).then(() => trim(STATIC, MAX_STATIC)).catch(() => {})); }
      return res; })));
    return;
  }
  // a script or stylesheet loaded by name, without ?v= (a sheet's module fetched on the first tap): network first, the
  // kept copy only when the network is down or slow. Stale-while-revalidate ran yesterday's module against today's page
  // for one visit after every deploy.
  if (same && /\.(js|css)$/.test(url.pathname)) {
    e.respondWith((async () => {
      const c = await caches.open(STATIC);
      const net = fetch(req).then((res) => { if (cacheable(res)) c.put(req, res.clone()).catch(() => {}); return res; });
      e.waitUntil(net.catch(() => {}));
      const first = await Promise.race([net.catch(() => "down"), new Promise((r) => setTimeout(() => r("late"), API_TIMEOUT))]);
      if (first !== "late" && first !== "down") return first;
      const hit = await c.match(req); if (hit) return hit;
      return net.catch(() => Response.error());
    })());
    return;
  }
  if ((same && /\.(svg|png|webp|jpg|woff2?|webmanifest|json)$/.test(url.pathname)) || fonts) {
    e.respondWith((async () => {
      const c = await caches.open(STATIC), hit = await c.match(req);
      const net = fetch(req).then((res) => { if (cacheable(res) || (fonts && res.type === "opaque")) c.put(req, res.clone()).catch(() => {}); return res; }).catch(() => hit || Response.error());
      if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
      return net;
    })());
  }
});

// Web push is not sent yet (the iOS and Android apps get pushes through APNs and FCM, server/push.js). When it is, a
// push carries { title, body, link, tag }: one note per chat (the tag), and a tap opens the chat in a tab that's
// already open when there is one. Unread counts are never cached here (/api/me/unread is no-store and not in DATA_APIS).
self.addEventListener("push", (e) => { let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data?.text?.() || "" }; }
  const link = typeof d.link === "string" && /^\/[^/]/.test(d.link) ? d.link : "/feed";
  e.waitUntil(self.registration.showNotification(String(d.title || "Pottery Lab").slice(0, 120), { body: String(d.body || "").slice(0, 300), tag: d.tag || undefined, renotify: !!d.tag, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { link } })); });
self.addEventListener("notificationclick", (e) => { e.notification.close(); const link = e.notification.data?.link || "/feed";
  e.waitUntil((async () => { const L = await self.clients.matchAll({ type: "window", includeUncontrolled: true }); const hit = L.find((c) => new URL(c.url).pathname === link) || L[0];
    if (hit && "focus" in hit) { try { if (new URL(hit.url).pathname !== link && hit.navigate) await hit.navigate(link); } catch {} return hit.focus(); } return self.clients.openWindow(link); })()); });
