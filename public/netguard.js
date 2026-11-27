// Network manners for every full page (added to <head> by server/appstore.js, before the page's own scripts):
// - identical API reads that start within a moment of each other share one request. The app's Home asked for the
//   same host profile 20 times and each event's sign-offs 5 times while it drew; now each goes out once. Only reads
//   that start within 250ms of one still in flight are shared, nothing is cached after it answers, and any write
//   (POST, PUT, PATCH, DELETE) ends the sharing at once, so a read after a change always sees the change.
// - a write can carry an Idempotency-Key (server/perf.js runs it once); PLNet.key() makes one.
// - unhandled promise rejections from a failed fetch (a dropped connection) are noted once instead of surfacing as
//   errors, and a sign-in that runs out while a page is open (a 401 for a page that was signed in) shows one calm bar
//   with a way to sign in again and come back here.
(function () {
  if (window.PLNet || typeof window.fetch !== "function") return;
  const raw = window.fetch.bind(window), live = new Map(), SHARE_MS = 250;
  const same = (u) => { try { const x = new URL(u, location.href); return x.origin === location.origin ? x : null; } catch { return null; } };
  function shared(input, init) {
    const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const url = same(typeof input === "string" ? input : input instanceof URL ? input.href : input?.url || "");
    if (!url || !url.pathname.startsWith("/api/")) return raw(input, init);
    const was = signedIn(); if (method !== "GET" && method !== "HEAD") { live.clear(); return watch(raw(input, init), was, url); }
    if (input instanceof Request || init?.signal || init?.body || (init?.cache && init.cache !== "default")) return watch(raw(input, init), was, url);
    const key = method + " " + url.href + " " + JSON.stringify(init?.headers || {}), hit = live.get(key), now = performance.now();
    // each one who shares gets the answer in a task of its own, so twenty redraws don't pile into one long task
    if (hit && now - hit.at < SHARE_MS) return hit.p.then((r) => new Promise((ok) => setTimeout(() => ok(r.clone()), 0)));
    const p = watch(raw(input, init), was, url); const E = { at: now, p }; live.set(key, E);
    p.then(() => { if (live.get(key) === E) live.delete(key); }, () => { if (live.get(key) === E) live.delete(key); });
    return p.then((r) => r.clone());
  }
  window.fetch = function (input, init) { return shared(input, init); };
  // the sign-in ran out while this page was open (a 401, and the server cleared the signed-in hint with it): one calm
  // bar with a way back in (never on the sign-in pages themselves)
  const signedIn = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  function watch(p, was, url) { if (was) p.then((r) => { if (r.status === 401 && !signedIn() && !/^\/api\/(login|logout|signup|password)/.test(url.pathname)) expired(); }, () => {}); return p; }
  function expired() {
    if (document.getElementById("plExpired") || /^\/(login|signup|reset|forgot|join)\b/.test(location.pathname) || !document.body) return;
    const b = document.createElement("div"); b.id = "plExpired"; b.setAttribute("role", "status");
    b.style.cssText = "position:fixed;left:12px;right:12px;bottom:calc(76px + env(safe-area-inset-bottom,0px));z-index:2147483001;max-width:520px;margin:0 auto;display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 14px;border-radius:14px;background:var(--pl-ink,#1D1B18);color:#fff;font:500 15px/1.35 'IBM Plex Sans',system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.18)";
    const a = document.createElement("a"); a.href = "/login?next=" + encodeURIComponent(location.pathname + location.search + location.hash); a.textContent = "Sign in"; a.style.cssText = "color:#fff;font-weight:600;text-decoration:underline;white-space:nowrap";
    const t = document.createElement("span"); t.textContent = "You've been signed out. Sign in again to keep going."; b.append(t, a); document.body.appendChild(b);
  }
  // a cover photo that fails to load (a deleted upload, a dead link) becomes the drawn cover for its card; any other
  // broken image just steps aside instead of showing the browser's broken-image box, keeping its space (no jump)
  addEventListener("error", (e) => { const img = e.target; if (!img || img.tagName !== "IMG" || img.dataset.plBroken || img.hasAttribute("data-no-fallback")) return; img.dataset.plBroken = "1";
    try { const box = img.closest(".ls-media,.fv-media,.gxcover,.cover,[data-cover]"); if (box && window.EventArt?.cover) { const t = document.createElement("div"); t.innerHTML = window.EventArt.cover({ title: img.alt || box.closest("article,a,section")?.querySelector("h2,h3,.ls-title,.fv-title")?.textContent || "" }, { title: "", label: "" }); const art = t.firstElementChild; if (art) { art.setAttribute("aria-hidden", "true"); img.replaceWith(art); return; } } } catch {}
    img.style.visibility = "hidden"; }, true);
  // the service worker drew this page from its cache and the fresh copy turned out different in kind: load that one
  try { navigator.serviceWorker?.addEventListener("message", (e) => { if (e.data?.plReload && e.data.plReload === location.href) location.reload(); }); } catch {}
  const key = () => { try { return crypto.randomUUID(); } catch { return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12); } };
  window.PLNet = { key, raw };
  // the soft page-to-page fade (public/craft.css): when the browser skips it (the next page's styles weren't in yet, a
  // hidden tab), its promises reject; that's not an error, the page still opens
  const quiet = (t) => { for (const k of ["ready", "finished", "updateCallbackDone"]) t?.[k]?.catch?.(() => {}); };
  // and a fade that hangs (WebKit's cross-document fades are new; while one runs the page takes no taps) is cut short,
  // so a page can never sit frozen under an old snapshot
  const cap = (t) => { if (!t?.skipTransition) return; let over = false; t.finished?.then?.(() => (over = true), () => (over = true)); setTimeout(() => { if (!over) try { t.skipTransition(); } catch {} }, 1200); };
  addEventListener("pagereveal", (e) => { quiet(e.viewTransition); cap(e.viewTransition); }); addEventListener("pageswap", (e) => quiet(e.viewTransition));
  // a dropped connection rejects fetch with a TypeError; pages catch most of them, the rest shouldn't read as crashes
  addEventListener("unhandledrejection", (e) => { const r = e.reason; if (r && r.name === "TypeError" && /fetch|network|load failed/i.test(String(r.message))) { e.preventDefault(); if (!window.__plNetNoted) { window.__plNetNoted = 1; console.warn("[net] a request failed:", r.message); } } });
})();

// "Read more" on a clamped intro (.pl-intro in public/system.css): a [data-pl-more] button opens the intro it names
// (aria-controls) or the one just before it, and closes it again. Here because every full page loads this file first.
(() => { if (window.__plMore || typeof document === "undefined" || typeof document.addEventListener !== "function") return; window.__plMore = 1;
  document.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest("[data-pl-more]"); if (!b) return;
    const t = document.getElementById(b.getAttribute("aria-controls") || "") || b.previousElementSibling; if (!t) return;
    const open = t.classList.toggle("is-open"); b.setAttribute("aria-expanded", String(open)); b.textContent = open ? "Show less" : "Read more"; });
})();
