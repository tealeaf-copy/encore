// The frame around public pages: an icon rail on the left (hosts: Home, Discover, Feed, My page, Plans, New event, the app's order; brands: Home, Discover, For brands, Requests, Gifts)
// and, on pages without their own header, a top bar with Discover and Host something. Phones keep the page's own header.
// Collapsible side navigation: one setting for both the public rail and the app's own sidebar, kept per device.
(function () {
  if (window.__encoreNavFold) return; window.__encoreNavFold = 1;
  const KEY = "encore-nav-collapsed", root = document.documentElement;
  let on = false; try { on = localStorage.getItem(KEY) === "1"; } catch {}
  root.classList.toggle("nav-folded", on);
  // the nav CSS (space, collapsed state) is set by /authguard.js in <head>, before the first paint
  const ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3L5 8l5 5"/></svg>';
  const set = (v) => { on = v; root.classList.toggle("nav-folded", v); try { localStorage.setItem(KEY, v ? "1" : "0"); } catch {} document.querySelectorAll(".nav-fold").forEach((b) => { b.setAttribute("aria-expanded", String(!v)); b.setAttribute("aria-label", v ? "Expand the menu" : "Collapse the menu"); b.title = v ? "Expand the menu" : "Collapse the menu"; }); };
  const add = () => { for (const bar of document.querySelectorAll(".es-rail, header.top")) { if (bar.querySelector(".nav-fold")) continue; if (bar.matches("header.top") && getComputedStyle(bar).position !== "fixed") continue;
      document.querySelectorAll("nav.tabs a").forEach((a) => { if (!a.dataset.label) a.dataset.label = a.textContent.trim(); });
      const b = document.createElement("button"); b.type = "button"; b.className = "nav-fold"; b.innerHTML = ICON; b.onclick = () => set(!on); if (getComputedStyle(bar).position === "static") bar.style.position = "relative"; bar.appendChild(b); set(on); } };
  const warmed = new Set(); const warm = (e) => { const a = e.target.closest?.(".es-rail a[href], header.top nav.tabs a[href]"); if (!a) return; const u = new URL(a.href, location.href); if (u.origin !== location.origin || warmed.has(u.pathname) || u.pathname === location.pathname) return; warmed.add(u.pathname); const l = document.createElement("link"); l.rel = "prefetch"; l.href = u.pathname; document.head.appendChild(l); };
  document.addEventListener("pointerover", warm, { passive: true }); document.addEventListener("touchstart", warm, { passive: true });
  const mo = new MutationObserver(() => { clearTimeout(window.__navFoldT); window.__navFoldT = setTimeout(add, 80); }); 
  const start = () => { add(); mo.observe(document.body, { childList: true, subtree: true }); }; if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
  window.addEventListener("resize", () => { clearTimeout(window.__navFoldR); window.__navFoldR = setTimeout(add, 150); });
})();
(function () {
  if (window.__encoreShell) return; window.__encoreShell = 1;
  const P = location.pathname, isG = P === "/g"; const BRAND = document.body?.dataset?.audience === "brand", TABS_ONLY = P === "/" && document.body?.dataset?.shell === "tabs"; // the signed-out home keeps its own desktop header and takes only the phone tab bar
  if (!(isG || TABS_ONLY || /^\/(discover|feed|plans|requests|hosts|quiz|teams|gifts|vendor|results|team)$/.test(P) || /^\/team\//.test(P) || /^\/hosts\//.test(P) || /^\/@/.test(P) || /^\/h\//.test(P) || /^\/gifts\/plan/.test(P))) return;
  if (/^\/(teams|gifts|vendor|results|team)$/.test(P) || /^\/team\//.test(P) || /^\/gifts\/plan/.test(P)) document.documentElement.classList.add("es-biz");
  const I = (d) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    home: I('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>'),
    search: I('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    globe: I('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
    plus: I('<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/>'),
    cal: I('<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
    bell: I('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
    me: I('<circle cx="12" cy="8.5" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
    people: I('<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20c1.2-3.5 3.6-5.2 6.5-5.2s5.3 1.7 6.5 5.2"/><circle cx="17" cy="9.5" r="2.8"/><path d="M16 14.6c2.6 0 4.5 1.5 5.5 4.4"/>'),
    gift: I('<rect x="3.5" y="9" width="17" height="11.5" rx="1.5"/><path d="M12 9v11.5M3.5 13.5h17M12 9C10.5 6 7 5 7 7.5S10.5 9 12 9zm0 0c1.5-3 5-4 5-1.5S13.5 9 12 9z"/>'),
    brief: I('<rect x="3.5" y="7.5" width="17" height="12.5" rx="2.5"/><path d="M9 7.5V5.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5.5v2M3.5 13h17"/>'),
    inbox: I('<path d="M3.5 13.5 6 5h12l2.5 8.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19z"/><path d="M3.5 13.5H9a3 3 0 0 0 6 0h5.5"/>'),
    login: I('<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5M15 12H4"/>'),
  };
  const css = document.createElement("style");
  css.textContent = `
.es-rail{position:fixed;left:0;top:0;bottom:0;width:72px;z-index:50;display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 0;background:rgba(255,255,255,.72);backdrop-filter:blur(8px);border-right:1.5px solid #E9DFD2}
.es-rail a{position:relative;display:grid;place-items:center;width:46px;height:46px;border-radius:14px;color:#5E534B;text-decoration:none}
.es-rail a:hover,.es-rail a[aria-current]{background:#FFF1C9;color:#1F1A17}
.es-rail .es-logo{margin-bottom:18px}.es-rail .es-sp{flex:1}.es-rail .es-div{width:40px;height:1.5px;background:#E9DFD2;margin:6px 0}
.es-tabs .es-av,.es-rail .es-av{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;font:700 13px "Instrument Sans",system-ui;color:#fff;background:linear-gradient(135deg,#E26D8E,#5B7FD6)}
.es-rail .es-n{position:absolute;top:2px;right:0;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#E2463A;color:#fff;font:700 13px/18px "Instrument Sans",system-ui;text-align:center}
.es-rail a[data-tip]:hover::after{content:attr(data-tip);position:absolute;left:54px;top:50%;transform:translateY(-50%);white-space:nowrap;background:#1F1A17;color:#fff;font:600 13px "Instrument Sans",system-ui;padding:5px 9px;border-radius:8px;pointer-events:none}
.es-top{display:flex;justify-content:space-between;align-items:center;max-width:1120px;margin:0 auto;padding:16px 20px 0}
.es-top .es-brand{display:flex;gap:8px;align-items:center;font:700 20px Fredoka,"Instrument Sans",system-ui;color:#1F1A17;text-decoration:none}
.es-top nav{display:flex;gap:16px;align-items:center;font:500 16px "Instrument Sans",system-ui}.es-top nav a{color:#5E534B;text-decoration:none}
.es-top nav a.cta{background:#fff;color:#1F1A17;padding:8px 14px;border-radius:999px;border:1px solid #E4D9C8;font-weight:600}
@media (min-width:861px){body.es-has-rail .es-top .es-brand{visibility:hidden}body.es-has-rail header.top{display:none}body.es-has-rail .es-top nav{display:none}}
@media (min-width:861px){body.es-has-rail,body.guestmode.es-has-rail{padding-left:224px!important}}
.es-rail{width:224px!important;align-items:stretch!important;padding:20px 14px!important;gap:2px!important;background:#FFFDFA!important;border-right:1px solid #E9E1D6!important;backdrop-filter:none!important}
.es-rail a{width:auto!important;height:44px!important;display:flex!important;align-items:center;gap:12px;padding:10px 12px;border-radius:10px!important;color:#6B5F56!important;font:600 16px "Instrument Sans",system-ui,sans-serif;text-decoration:none}
.es-rail a svg{flex:none;width:22px;height:22px}
.es-rail a:hover{background:#F6EFE8!important;color:#2B211C!important}.es-rail a[aria-current]{background:#F6E7DF!important;color:#8E3A25!important}
.es-rail .es-logo{height:auto!important;padding:0 8px!important;margin-bottom:18px!important;font:600 28px Fredoka,"Instrument Sans",system-ui,sans-serif!important;color:#2B211C!important;gap:8px}.es-rail .es-logo:hover{background:none!important}
.es-rail a[data-tip]:hover::after{display:none!important}.es-rail .es-n{position:static!important;margin-left:auto}
.es-rail .es-out{height:auto!important;justify-content:center;font:400 14px "Instrument Sans",system-ui!important;text-decoration:underline!important;margin-top:12px;padding:6px!important}
@media (max-width:860px){.es-rail{display:none}}
.es-tabs{display:none}
@media (max-width:860px){.es-tabs{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:60;justify-content:space-around;align-items:flex-end;padding:6px 6px calc(8px + env(safe-area-inset-bottom));background:rgba(255,251,245,.96);backdrop-filter:blur(8px);border-top:1.5px solid #E9DFD2}
.es-tabs a{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;color:#6B5F56;text-decoration:none;font:600 13px "Instrument Sans",system-ui;padding:4px 0}
.es-tabs a[aria-current]{color:#1F1A17}.es-tabs a[aria-current] svg{stroke-width:2.4}
.es-biz .es-tabs a.es-plus{display:none}.es-tabs a.es-plus{flex:none;margin:-22px 6px 0}.es-tabs a.es-plus span{display:grid;place-items:center;width:54px;height:54px;border-radius:18px;background:#C94A30;color:#fff;border:2px solid #1F1A17;box-shadow:0 2px 8px rgba(31,26,23,.08)}
body.es-has-tabs{padding-bottom:84px}body.es-has-tabs header nav > a,body.es-has-tabs header .hd-cta{display:none!important}}`;
  document.head.appendChild(css);
  const logo = `<svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><path d="M10.2 3.2h7.6v1.9c0 1.3-1.1 1.9-1.1 3.3 0 1.5 5.6 3.4 5.6 9.4 0 4.6-3.7 7.4-8.3 7.4s-8.3-2.8-8.3-7.4c0-6 5.6-7.9 5.6-9.4 0-1.4-1.1-2-1.1-3.3z" fill="#C4532F" stroke="#1F1A17" stroke-width="1.6" stroke-linejoin="round"/><path d="M7.4 16.7c2 1.3 4.3-.9 6.8.2 2.4 1 4.5-.8 6.6.1" fill="none" stroke="#F2D48F" stroke-width="2.2" stroke-linecap="round"/><path d="M9.6 3.2h8.8" stroke="#1F1A17" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  const link = (href, icon, tip, extra = "") => { const p = href.split(/[?#]/)[0]; const cur = p !== "/" && p === P ? ' aria-current="page"' : ""; return `<a href="${href}" data-tip="${tip}" aria-label="${tip}"${cur}>${icon}${extra}</a>`; };
  function draw(me, W, alerts) {
    const rail = document.createElement("nav"); rail.className = "es-rail"; rail.setAttribute("aria-label", "Pottery Lab");
    const signed = !!me?.verified, brand = signed && W?.personal === false && W?.plan !== "self-hosted" && !W?.handle, host = signed && !W?.regularOnly && !brand, ini = String(me?.name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "🙂";
    const item = (href, icon, label, extra = "") => { const p = href.split(/[?#]/)[0]; const cur = (p !== "/" && p === P) ? ' aria-current="page"' : ""; return `<a href="${href}" aria-label="${label}"${cur}>${icon}<span>${label}</span>${extra}</a>`; };
    rail.innerHTML = `<a class="es-logo" href="${signed ? "/?app=1" : "/"}" aria-label="Pottery Lab home">${logo}<span>pottery lab</span></a>` +
      (brand ? item("/?app=1", ICON.home, "Home") + item("/discover", ICON.search, "Discover") + item("/hosts/book", ICON.brief, "For brands") + item("/requests", ICON.inbox, "Requests") + item("/gifts", ICON.gift, "Gifts")
        : host ? item("/?app=1", ICON.home, "Home") + item("/discover", ICON.search, "Discover") + item("/feed", ICON.globe, "Feed", alerts ? `<span class="es-n">${alerts > 99 ? "99+" : alerts}</span>` : "") + item(W?.handle ? "/@" + W.handle : "/?app=1", ICON.me, "My page") + item("/plans", ICON.cal, "Plans") + item("/?app=1#studio", ICON.plus, "New event")
        : signed ? item("/discover", ICON.search, "Discover") + item("/feed", ICON.globe, "Feed", alerts ? `<span class="es-n">${alerts > 99 ? "99+" : alerts}</span>` : "") + item("/plans", ICON.cal, "Plans")
        : item("/discover", ICON.search, "Discover") + item("/hosts", ICON.people, "Hosts") + (BRAND ? item("/gifts", ICON.gift, "Gifts") : "") + item("/hosts/book", ICON.brief, "For brands") + item("/login", ICON.login, "Sign in") + (BRAND ? "" : item("/signup?mode=friends", ICON.plus, "Start your page"))) +
      (signed ? `<a href="#" class="es-out">Sign out</a>` : "");
    setTimeout(() => { const o = rail.querySelector(".es-out"); if (o) o.onclick = async (ev) => { ev.preventDefault(); try { await fetch("/api/logout", { method: "POST", credentials: "same-origin" }); } catch {} location.href = "/"; }; }, 0);
    if (!TABS_ONLY) { document.body.prepend(rail); document.body.classList.add("es-has-rail"); }
    // phones: a bottom tab bar with a big + in the middle (event pages keep their own sticky RSVP bar instead)
    if (!isG) { const tabs = document.createElement("nav"); tabs.className = "es-tabs"; tabs.setAttribute("aria-label", "Pottery Lab");
      const tab = (href, icon, label, aria) => { const p = href.split(/[?#]/)[0]; return `<a href="${href}"${aria ? ` aria-label="${aria}"` : ""}${p !== "/" && p === P ? ' aria-current="page"' : ""}>${icon}<b>${label}</b></a>`; };
      tabs.innerHTML = brand ? tab("/?app=1", ICON.home, "Home") + tab("/discover", ICON.search, "Discover") + tab("/hosts/book", ICON.brief, "For brands") + tab("/requests", ICON.inbox, "Requests") + tab("/gifts", ICON.gift, "Gifts") : host ? tab("/?app=1", ICON.home, "Home") + tab("/discover", ICON.search, "Discover") + tab("/feed", ICON.globe, "Feed") + tab(W?.handle ? "/@" + W.handle : "/?app=1", ICON.me, "My page") + tab("/plans", ICON.cal, "Plans") + tab("/?app=1#studio", ICON.plus, "New", "New event") : ((signed ? "" : tab("/", ICON.home, "Home")) + tab("/discover", ICON.search, "Discover") + (signed ? tab("/feed", ICON.globe, "Feed") : "") +
        (signed ? `<a class="es-plus" href="/signup?mode=friends" aria-label="Start your page"><span><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></span></a>` : tab("/hosts", ICON.people, "Hosts")) +
        (signed ? tab("/plans", ICON.cal, "Plans") + tab(W?.handle ? "/@" + W.handle : "/?app=1", `<span class="es-av" style="width:24px;height:24px;font-size:13px">${ini}</span>`, "Me") : tab("/login", ICON.login, "Sign in") + (BRAND ? tab("/hosts/book", ICON.brief, "For brands") : tab("/signup?mode=friends", ICON.plus, "Sign up"))));
      document.body.appendChild(tabs); document.body.classList.add("es-has-tabs"); }
    if (isG && !document.querySelector(".es-top")) { const top = document.createElement("header"); top.className = "es-top";
      top.innerHTML = `<a class="es-brand" href="${signed ? "/?app=1" : "/"}">${logo}pottery lab</a><nav><a href="/discover">Discover</a>${signed ? `<a href="/plans">Plans</a>` : `<a href="/login">Sign in</a>`}${host ? `<a class="cta" href="/?app=1#studio">New event</a>` : ""}</nav>`;
      const main = document.querySelector("main") || document.body.firstElementChild; (main?.parentElement || document.body).insertBefore(top, main); }
  }
  // Draw the nav at once: signed-out visitors need no request; signed-in people get last time's nav straight away,
  // and it's redrawn only if the fresh answer is different (a new alert, a new handle).
  const KEYS = "encore.navState", paint = (me, W) => { document.querySelector(".es-rail")?.remove(); document.querySelector(".es-tabs")?.remove(); document.querySelector(".es-top")?.remove(); draw(me, W, 0); };
  const go = async () => { const hint = /(?:^|;\s*)encore_in=1/.test(document.cookie); let cached = null; try { cached = JSON.parse(localStorage.getItem(KEYS) || "null"); } catch {}
    if (!hint) { try { localStorage.removeItem(KEYS); } catch {} paint({}, {}); return; }
    if (cached) paint(cached.me, cached.W);
    let me = {}, W = {}; const [a, b] = await Promise.all([fetch("/api/me", { credentials: "same-origin" }).then((r) => r.json()).catch(() => ({})), fetch("/api/workspace", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}))]); me = a || {}; W = me.verified ? b || {} : {};
    const keep = { me: { verified: me.verified, name: me.name, ws: me.ws, alerts: me.alerts, handle: me.handle }, W: { handle: W.handle, personal: W.personal, company: W.company, regularOnly: W.regularOnly, plan: W.plan } };
    const fresh = JSON.stringify(keep); if (cached && JSON.stringify(cached) === fresh) return; try { localStorage.setItem(KEYS, fresh); } catch {} paint(me, W); };
  window.addEventListener("encore:signedin", () => setTimeout(go, 300));
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", go) : go();
})();
