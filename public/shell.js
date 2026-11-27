// The frame around public pages: an icon rail on the left (hosts: Feed, Home, Discover, Chats, Ideas, New event, Plans, Saved, My page; brands: Home, Discover hosts, Campaigns, Insights, Bookings)
// and, on phones, five bottom tabs: Feed, Discover, New, Chats, Me (Me opens Home, Plans, My page and Saved; public/chatnav.js).
// Signed out, Feed comes first (it's the app's default view): Feed, Discover, Ideas, Sign in, Start your page.
// and, on pages without their own header, a top bar with Discover and Host something. Phones keep the page's own header.
// A friend's invite (/g) never shows the brands link: a guest opening a dinner invite isn't shopping for hosts.
// "Need a hand?" (public/help.js): the Help link in the rail (signed in or not) and the Me sheet; public/report.js loads
// help.js on the first tap, so it costs nothing on page load. Plans, invites and chats included.
// A fresh page starts at the top. Some browsers carry the last page's scroll offset across a page-to-page fade
// (cross-document view transition), so a profile opened from far down the feed landed mid-page. Back/forward, reloads
// and #links keep their own position, and a reader who has already touched the page is never moved.
(() => { try { if (window.__plTop) return; window.__plTop = 1; const nav = performance.getEntriesByType("navigation")[0];
  if (!nav || nav.type !== "navigate" || location.hash) return; let touched = false;
  ["touchstart", "wheel", "keydown", "pointerdown"].forEach((t) => addEventListener(t, () => (touched = true), { once: true, passive: true, capture: true }));
  const top = () => { if (!touched && (window.scrollY || document.documentElement.scrollTop) > 0) window.scrollTo(0, 0); };
  top(); addEventListener("pagereveal", top, { once: true }); document.addEventListener("DOMContentLoaded", top, { once: true });
  addEventListener("pageshow", (e) => { if (!e.persisted) { top(); setTimeout(top, 60); } }, { once: true }); } catch {} })();
// Chats in the nav: the unread badge and the Me sheet (public/chatnav.js)
(function () { try { if (window.__plChatNavLoad) return; window.__plChatNavLoad = 1; const s = document.createElement("script"); s.src = "/chatnav.js"; s.defer = true; (document.head || document.documentElement).appendChild(s); } catch {} })();
// The Inbox and Ask Potto (public/potto.js): the bell opens /inbox, the badge, the Potto sheet; signed in only
(function () { try { if (window.__plPottoLoad || window.PLPotto || !/(?:^|;\s*)encore_in=1/.test(document.cookie) || location.pathname === "/g") return; window.__plPottoLoad = 1; const s = document.createElement("script"); s.src = "/potto.js"; s.defer = true; (document.head || document.documentElement).appendChild(s); } catch {} })();
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
  // a finger landing on (or a pointer resting over) a link to one of our pages warms it: the service worker fetches the
  // page into its cache (public/sw.js), so the tap opens it at once; without one, a prefetch hint. Browsers with
  // speculation rules (server/perf.js) prefetch on their own as well.
  const warmed = new Set(); const warm = (e) => { const a = e.target.closest?.("a[href]"); if (!a || a.target === "_blank" || a.hasAttribute("download") || a.hasAttribute("data-no-prefetch")) return; let u; try { u = new URL(a.href, location.href); } catch { return; } if (u.origin !== location.origin || /^\/(api|_blob|logout|verify|unsubscribe|sso)\b/.test(u.pathname)) return; const k = u.pathname + u.search; if (warmed.has(k) || (u.pathname === location.pathname && u.search === location.search)) return; warmed.add(k);
    const sw = navigator.serviceWorker?.controller; if (sw) { try { sw.postMessage({ warm: k }); } catch {} return; } const l = document.createElement("link"); l.rel = "prefetch"; l.href = k; document.head.appendChild(l); };
  document.addEventListener("pointerover", warm, { passive: true }); document.addEventListener("touchstart", warm, { passive: true });
  const mo = new MutationObserver(() => { clearTimeout(window.__navFoldT); window.__navFoldT = setTimeout(add, 80); }); 
  const start = () => { add(); mo.observe(document.body, { childList: true, subtree: true }); }; if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
  window.addEventListener("resize", () => { clearTimeout(window.__navFoldR); window.__navFoldR = setTimeout(add, 150); });
})();
(function () {
  if (window.__encoreShell) return; window.__encoreShell = 1;
  const P0 = location.pathname, P = /^\/chats(\/|$)/.test(P0) ? "/chats" : /^\/contacts(\/|$)/.test(P0) ? "/contacts" : P0, isG = P === "/g"; const BRAND = document.body?.dataset?.audience === "brand", TABS_ONLY = P === "/" && document.body?.dataset?.shell === "tabs"; // the signed-out home keeps its own desktop header and takes only the phone tab bar
  if (!(isG || TABS_ONLY || /^\/(discover|events|leaderboard|feed|ideas|saved|library|plans|requests|hosts|quiz|teams|gifts|vendor|results|team|chats|inbox|contacts|start)$/.test(P) || /^\/(library\/host|l\/[A-Za-z0-9_-]{24})$/.test(P) || /^\/team\//.test(P) || /^\/hosts\//.test(P) || /^\/@/.test(P) || /^\/h\//.test(P) || /^\/gifts\/plan/.test(P))) return;
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
    spark: I('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>'),
    heart: I('<path d="M12 20s-7-4.4-8.6-8.9C2.2 7.8 4.3 4.5 7.5 4.5c2 0 3.4 1.1 4.5 2.7 1.1-1.6 2.5-2.7 4.5-2.7 3.2 0 5.3 3.3 4.1 6.6C19 15.6 12 20 12 20z"/>'),
    about: I('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.1"/>'),
    login: I('<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5M15 12H4"/>'),
    chat: I('<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17h0A1.5 1.5 0 0 1 4 15.5z"/><path d="M8.5 9.5h7M8.5 12.5h4.5"/>'),
  };
  const css = document.createElement("style");
  css.textContent = `
.es-rail{position:fixed;left:0;top:0;bottom:0;width:72px;z-index:50;display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 0;background:rgba(255,255,255,.72);backdrop-filter:blur(8px);border-right:1.5px solid var(--pl-line)}
.es-rail a{position:relative;display:grid;place-items:center;width:46px;height:46px;border-radius:14px;color:var(--pl-soft);text-decoration:none}
.es-rail a:hover,.es-rail a[aria-current]{background:var(--pl-sand-soft);color:var(--pl-ink)}
.es-rail .es-logo{margin-bottom:18px}.es-rail .es-sp{flex:1}.es-rail .es-div{width:40px;height:1.5px;background:var(--pl-line);margin:6px 0}
.es-tabs .es-av,.es-rail .es-av{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;font:700 13px "IBM Plex Sans",system-ui;color:#fff;background:linear-gradient(135deg,#E26D8E,#5B7FD6)}
.es-rail .es-n{position:absolute;top:2px;right:0;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:var(--pl-accent,#29489A);color:#fff;font:500 12px/20px "IBM Plex Mono",ui-monospace,monospace;text-align:center;box-sizing:border-box;flex:none}
.es-rail a[data-tip]:hover::after{content:attr(data-tip);position:absolute;left:54px;top:50%;transform:translateY(-50%);white-space:nowrap;background:var(--pl-ink);color:#fff;font:600 13px "IBM Plex Sans",system-ui;padding:5px 9px;border-radius:8px;pointer-events:none}
.es-top{display:flex;justify-content:space-between;align-items:center;max-width:1120px;margin:0 auto;padding:16px 20px 0}
.es-top .es-brand{display:flex;gap:8px;align-items:center;font:700 20px var(--sys-display);color:var(--pl-ink);text-decoration:none}
.es-top nav{display:flex;gap:16px;align-items:center;font:500 16px "IBM Plex Sans",system-ui}.es-top nav a{color:var(--pl-soft);text-decoration:none}
.es-top nav a.cta{background:#fff;color:var(--pl-ink);padding:8px 14px;border-radius:999px;border:1px solid var(--pl-line);font-weight:600}
@media (min-width:861px){body.es-has-rail .es-top{display:none}body.es-has-rail .es-top .es-brand{visibility:hidden}body.es-has-rail header.top{display:none}body.es-has-rail .es-top nav{display:none}}
@media (min-width:861px){body.es-has-rail,body.guestmode.es-has-rail{padding-left:224px!important}}
.es-rail{width:224px!important;align-items:stretch!important;padding:20px 14px!important;gap:2px!important;background:var(--pl-surface)!important;border-right:1px solid var(--pl-line)!important;backdrop-filter:none!important}
.es-rail a{width:auto!important;height:44px!important;display:flex!important;align-items:center;gap:12px;padding:10px 12px;border-radius:var(--pl-r-md,6px)!important;color:var(--pl-soft)!important;font:600 16px "IBM Plex Sans",system-ui,sans-serif;text-decoration:none}
.es-rail a svg{flex:none;width:22px;height:22px}
.es-rail a:hover{background:var(--pl-raised)!important;color:var(--pl-ink)!important}.es-rail a[aria-current]{background:var(--pl-accent-soft)!important;color:var(--pl-accent-text)!important}
.es-rail .es-logo{height:auto!important;padding:0 8px!important;margin-bottom:18px!important;font:600 28px var(--sys-display)!important;color:var(--pl-ink)!important;gap:8px}.es-rail .es-logo:hover{background:none!important}
.es-rail a[data-tip]:hover::after{display:none!important}.es-rail .es-n{position:static!important;margin-left:auto}
.es-rail .es-out{height:auto!important;justify-content:center;font:400 14px "IBM Plex Sans",system-ui!important;text-decoration:underline!important;margin-top:12px;padding:6px!important}
@media (max-width:860px){.es-rail{display:none}}
.es-tabs{display:none}
@media (max-width:860px){.es-tabs{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:60;justify-content:space-around;align-items:flex-end;padding:6px 6px calc(8px + env(safe-area-inset-bottom));background:rgba(255,251,245,.96);backdrop-filter:blur(8px);border-top:1.5px solid var(--pl-line)}
.es-tabs a{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;color:var(--pl-soft);text-decoration:none;font:600 12px "IBM Plex Sans",system-ui;padding:4px 0}.es-tabs a b{white-space:nowrap}.es-tabs a{min-width:0}
.es-tabs a[aria-current]{color:var(--pl-ink)}.es-tabs a[aria-current] svg{stroke-width:2.4}
.es-biz .es-tabs a.es-plus{display:none}.es-tabs a.es-plus{flex:none;margin:-22px 6px 0}.es-tabs a.es-plus span{display:grid;place-items:center;width:54px;height:54px;border-radius:18px;background:var(--pl-accent);color:#fff;border:2px solid var(--pl-ink);box-shadow:0 2px 8px rgba(31,26,23,.08)}
body.es-has-tabs{padding-bottom:84px}body.es-has-tabs header nav > a,body.es-has-tabs header .hd-cta{display:none!important}}`;
  document.head.appendChild(css);
  const logo = `<svg viewBox="0 0 48 48" width="28" height="28" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="1.5" width="45" height="45" rx="6"/><path d="M17 11h14M19 11v4l-6 6v9a7 7 0 0 0 7 7h8a7 7 0 0 0 7-7v-9l-6-6v-4"/><circle cx="20.5" cy="26" r="1.9" stroke="none" style="fill:var(--pl-accent,#29489A)"/><circle cx="27.5" cy="26" r="1.9" stroke="none" style="fill:var(--pl-accent,#29489A)"/></svg>`;
  const link = (href, icon, tip, extra = "") => { const p = href.split(/[?#]/)[0]; const cur = p !== "/" && p === P ? ' aria-current="page"' : ""; return `<a href="${href}" data-tip="${tip}" aria-label="${tip}"${cur}>${icon}${extra}</a>`; };
  function draw(me, W, alerts) {
    const rail = document.createElement("nav"); rail.className = "es-rail"; rail.setAttribute("aria-label", "Pottery Lab");
    const signed = !!me?.verified, brand = signed && W?.personal === false && W?.plan !== "self-hosted" && !W?.handle, host = signed && !W?.regularOnly && !brand, ini = String(me?.name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "🙂";
    const item = (href, icon, label, extra = "") => { const p = href.split(/[?#]/)[0]; const cur = (p !== "/" && p === P) ? ' aria-current="page"' : ""; return `<a href="${href}" aria-label="${label}"${cur}>${icon}<span>${label}</span>${extra}</a>`; };
    const guestChats = !signed && (() => { try { for (let i = 0; i < localStorage.length; i++) if (/^encore-rsvp-/.test(localStorage.key(i) || "")) return true; } catch {} return false; })();
    const chatsItem = item("/chats", ICON.chat, "Chats", `<span class="es-n" data-chats-badge aria-hidden="true" hidden></span>`); // the count: public/chatnav.js (GET /api/me/unread), which also sets "Chats, 3 unread" on the link
    rail.innerHTML = `<a class="es-logo kit-off" href="${signed ? "/?app=1" : "/"}" aria-label="Pottery Lab home">${logo}<span>pottery lab</span></a>` +
      (brand ? item("/teams/home", ICON.home, "Home") + item("/teams/discover", ICON.search, "Discover hosts") + item("/teams/campaigns", ICON.cal, "Campaigns") + item("/contacts", ICON.people, "Contacts") + item("/teams/insights", ICON.spark, "Insights") + item("/teams/bookings", ICON.inbox, "Bookings")
        : host ? item("/feed", ICON.globe, "Feed", alerts ? `<span class="es-n">${alerts > 99 ? "99+" : alerts}</span>` : "") + item("/?app=1", ICON.home, "Home") + item("/contacts", ICON.people, "Guests") + item("/discover", ICON.search, "Discover") + chatsItem + item("/ideas", ICON.spark, "Ideas") + item("/?app=1&new=1#studio", ICON.plus, "New event") + item("/plans", ICON.cal, "Plans") + item("/library", ICON.heart, "Library") + item(W?.handle ? "/@" + W.handle : "/?app=1", ICON.me, "My page")
        : signed ? item("/feed", ICON.globe, "Feed", alerts ? `<span class="es-n">${alerts > 99 ? "99+" : alerts}</span>` : "") + item("/discover", ICON.search, "Discover") + chatsItem + item("/ideas", ICON.spark, "Ideas") + item("/plans", ICON.cal, "Plans") + item("/library", ICON.heart, "Library")
        : (BRAND ? "" : item("/feed", ICON.globe, "Feed")) + item("/discover", ICON.search, "Discover") + (BRAND ? "" : item("/ideas", ICON.spark, "Ideas") + (guestChats ? chatsItem : "")) + item("/hosts", ICON.people, "Hosts") + (BRAND ? "" : item("/about", ICON.about, "About")) + (BRAND ? item("/gifts", ICON.gift, "Gifts") : "") + (isG ? "" : item("/hosts/book", ICON.brief, "For brands")) + item("/login", ICON.login, "Sign in") + (BRAND ? "" : item("/signup?mode=friends", ICON.plus, "Start your page"))) +
      (signed ? `<a href="#" class="es-out">Sign out</a><a href="/settings" class="es-out es-set" style="margin-top:0">Settings</a><a href="#" class="es-out es-set" style="margin-top:0" data-help-open>Help</a>` : `<a href="/help" class="es-out es-set" data-help>Help</a>`); // app store: Settings (notifications, blocked, delete account)
    setTimeout(() => { const o = rail.querySelector(".es-out:not(.es-set)"); if (o) o.onclick = async (ev) => { ev.preventDefault(); try { await fetch("/api/logout", { method: "POST", credentials: "same-origin" }); } catch {} location.href = "/"; }; }, 0);
    if (!TABS_ONLY) { document.body.prepend(rail); document.body.classList.add("es-has-rail"); }
    // phones: a bottom tab bar with a big + in the middle (event pages keep their own sticky RSVP bar instead)
    if (!isG) { const tabs = document.createElement("nav"); tabs.className = "es-tabs"; tabs.setAttribute("aria-label", "Pottery Lab");
      // six tabs at 390px: "New event" reads "New" under 400px (its aria-label keeps the full name), and the labels get a little room
      if (!document.getElementById("es-nl")) { const st = document.createElement("style"); st.id = "es-nl"; st.textContent = ".es-tabs .nl-short{display:none}@media (max-width:399px){.es-tabs .nl-full{display:none}.es-tabs .nl-short{display:inline}.es-tabs b{font-size:13px;letter-spacing:-.01em}}"; document.head.appendChild(st); }
      const chatTab = `<a href="/chats" aria-label="Chats"${P === "/chats" ? ' aria-current="page"' : ""}>${ICON.chat}<b>Chats</b><span class="es-tn" data-chats-badge aria-hidden="true" hidden></span></a>`;
      const meCur = /^\/(plans|saved|library|library\/host|ideas)$/.test(P) || (W?.handle && P === "/@" + W.handle), meTab = `<a href="/plans" data-me aria-label="Me: Home, Plans, My page"${meCur ? ' aria-current="page"' : ""}>${ICON.me}<b>Me</b></a>`;
      const tab = (href, icon, label, aria) => { const p = href.split(/[?#]/)[0]; return `<a href="${href}"${aria ? ` aria-label="${aria}"` : ""}${p !== "/" && p === P ? ' aria-current="page"' : ""}>${icon}<b>${label}</b></a>`; };
      tabs.innerHTML = brand ? tab("/teams/home", ICON.home, "Home") + tab("/teams/discover", ICON.search, "Discover") + tab("/teams/campaigns", ICON.cal, "Campaigns") + tab("/teams/insights", ICON.spark, "Insights") + tab("/teams/bookings", ICON.inbox, "Bookings") : host ? tab("/feed", ICON.globe, "Feed") + tab("/discover", ICON.search, "Discover") + tab("/?app=1&new=1#studio", ICON.plus, "New", "New event") + chatTab + meTab : ((signed || !BRAND ? "" : tab("/", ICON.home, "Home")) + (signed ? tab("/feed", ICON.globe, "Feed") + tab("/discover", ICON.search, "Discover") : (!BRAND ? tab("/feed", ICON.globe, "Feed") : "") + tab("/discover", ICON.search, "Discover") + (BRAND || guestChats ? "" : tab("/ideas", ICON.spark, "Ideas"))) +
        (signed ? "" : BRAND ? tab("/hosts", ICON.people, "Hosts") : "") +
        (signed ? tab("/?app=1", ICON.plus, "Host", "Start your page") + chatTab + meTab : (guestChats ? chatTab : "") + tab("/login", ICON.login, "Sign in") + (BRAND ? tab("/hosts/book", ICON.brief, "For brands") : tab("/start", ICON.plus, '<span class="nl-full">Plan your first event</span><span class="nl-short">Start</span>', "Plan your first event, no account needed"))));
      document.body.appendChild(tabs); document.body.classList.add("es-has-tabs");
      tabs.querySelectorAll("[data-me]").forEach((a) => (a.onclick = (e) => { if (!window.PLChatNav) return; e.preventDefault(); window.PLChatNav.me({ host, handle: W?.handle || "", name: me?.name || "" }); })); }
    try { window.PLChatNav?.poll(); } catch {}
    if (isG && !document.querySelector(".es-top")) { const top = document.createElement("header"); top.className = "es-top";
      top.innerHTML = `<a class="es-brand kit-off" href="${signed ? "/?app=1" : "/"}">${logo}pottery lab</a><nav><a href="/discover">Discover</a>${signed ? `<a href="/plans">Plans</a>` : `<a href="/login">Sign in</a>`}${host ? `<a class="cta" href="/?app=1&new=1#studio">New event</a>` : ""}</nav>`;
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

// ---- hooks for new people (server/hooks.js): "What are you into?" on a first visit to /feed, /events or /discover,
// signed out and dismissible; Save buttons work on these pages too ----
(function () { try { if (window.__plHooksLoad) return; window.__plHooksLoad = 1; const P = location.pathname; if (!/^\/(feed|events|discover)$/.test(P)) return;
  const add = (src, cb) => { if (document.querySelector(`script[src="${src}"],script[src^="${src}?"]`)) return cb && cb(); const s = document.createElement("script"); s.src = src; s.defer = true; if (cb) s.onload = cb; document.head.appendChild(s); };
  add("/save.js"); if (/(?:^|;\s*)encore_in=1/.test(document.cookie)) return; let seen = false; try { seen = !!(localStorage.getItem("pl.interestsSeen") || localStorage.getItem("pl.interests")); } catch {} if (seen) return;
  add("/interests.js", () => window.PLInterests?.maybeAuto()); } catch {} })();

// ---- Home to-dos from the server (public/nudges.js): signed-in hosts on the app's Home, e.g. "Show it on Discover" ----
(function () { try { if (window.__plNudgesLoad || location.pathname !== "/" || !/(?:^|;\s*)encore_in=1/.test(document.cookie)) return; window.__plNudgesLoad = 1;
  const s = document.createElement("script"); s.src = "/nudges.js"; s.defer = true; (document.head || document.documentElement).appendChild(s); } catch {} })();

// ---- "New here?" on the feed: one quiet, dismissible line for first-time signed-out visitors, pointing at /about ----
(function () { try { if (window.__plAboutNote || !/^\/(feed)?$/.test(location.pathname) || /(?:^|;\s*)encore_in=1/.test(document.cookie)) return; window.__plAboutNote = 1;
  let seen = false; try { seen = !!localStorage.getItem("pl.aboutNote"); } catch {} if (seen) return;
  const put = () => { const m = document.querySelector("main"); if (!m || document.getElementById("plAbout")) return;
    const n = document.createElement("p"); n.id = "plAbout"; n.className = "pl-about";
    n.innerHTML = `<span>New here? <a href="/about">Why we exist</a> · <a href="/start">Plan your first event</a></span><button type="button" aria-label="Dismiss">×</button>`;
    const st = document.createElement("style"); st.textContent = `.pl-about{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:12px 0 0;padding:4px 4px 4px 14px;border:1px solid var(--pl-line);border-radius:var(--pl-r-sm,8px);background:var(--pl-surface);color:var(--pl-soft);font:400 14px/1.4 var(--pl-font-text,system-ui);box-sizing:border-box}.pl-about a{color:var(--pl-accent-text);font-weight:600}.pl-about button{flex:none;min-width:44px;min-height:44px;border:0;background:none;color:var(--pl-soft);font-size:20px;cursor:pointer;border-radius:8px}`;
    document.head.appendChild(st); document.getElementById("plAboutRoom")?.remove(); /* the room the feed held for this line */ (document.getElementById("rail") || m).before(n);
    const done = () => { try { localStorage.setItem("pl.aboutNote", "1"); } catch {} };
    n.querySelector("a").addEventListener("click", done); n.querySelector("button").onclick = () => { done(); n.remove(); }; };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", put) : put(); } catch {} })();

// ---- delight after (public/delightafter.js): Plans (today's card, the morning after, keep in touch), the host's manage view (the hour-before checklist, the summary, the polaroid, the next one) and its switches in Settings; signed in only ----
(function () { try { if (window.__plDelightLoad || !/^\/(plans|settings)?$/.test(location.pathname) || !/(?:^|;\s*)encore_in=1/.test(document.cookie)) return; window.__plDelightLoad = 1;
  const s = document.createElement("script"); s.src = "/delightafter.js"; s.defer = true; (document.head || document.documentElement).appendChild(s); } catch {} })();
