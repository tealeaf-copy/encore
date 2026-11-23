// The frame around public pages: an icon rail on the left (Home, Discover, Feed, New event, Your plans, Alerts, you)
// and, on pages without their own header, a top bar with Discover and Host something. Phones keep the page's own header.
(function () {
  if (window.__encoreShell) return; window.__encoreShell = 1;
  const P = location.pathname, isG = P === "/g";
  if (!(isG || /^\/(discover|feed|plans|requests|hosts|quiz)$/.test(P) || /^\/@/.test(P) || /^\/h\//.test(P))) return;
  const I = (d) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    home: I('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>'),
    search: I('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    globe: I('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
    plus: I('<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/>'),
    cal: I('<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
    bell: I('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
    login: I('<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5M15 12H4"/>'),
  };
  const css = document.createElement("style");
  css.textContent = `
.es-rail{position:fixed;left:0;top:0;bottom:0;width:72px;z-index:50;display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 0;background:rgba(255,255,255,.72);backdrop-filter:blur(8px);border-right:1.5px solid #E9DFD2}
.es-rail a{position:relative;display:grid;place-items:center;width:46px;height:46px;border-radius:14px;color:#5E534B;text-decoration:none}
.es-rail a:hover,.es-rail a[aria-current]{background:#FFF1C9;color:#1F1A17}
.es-rail .es-logo{margin-bottom:18px}.es-rail .es-sp{flex:1}.es-rail .es-div{width:40px;height:1.5px;background:#E9DFD2;margin:6px 0}
.es-tabs .es-av,.es-rail .es-av{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;font:700 13px "Instrument Sans",system-ui;color:#fff;background:linear-gradient(135deg,#E26D8E,#5B7FD6)}
.es-rail .es-n{position:absolute;top:2px;right:0;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#E2463A;color:#fff;font:700 11px/18px "Instrument Sans",system-ui;text-align:center}
.es-rail a[data-tip]:hover::after{content:attr(data-tip);position:absolute;left:54px;top:50%;transform:translateY(-50%);white-space:nowrap;background:#1F1A17;color:#fff;font:600 12.5px "Instrument Sans",system-ui;padding:5px 9px;border-radius:8px;pointer-events:none}
.es-top{display:flex;justify-content:space-between;align-items:center;max-width:1120px;margin:0 auto;padding:16px 20px 0}
.es-top .es-brand{display:flex;gap:8px;align-items:center;font:700 22px Fredoka,"Instrument Sans",system-ui;color:#1F1A17;text-decoration:none}
.es-top nav{display:flex;gap:16px;align-items:center;font:500 15px "Instrument Sans",system-ui}.es-top nav a{color:#5E534B;text-decoration:none}
.es-top nav a.cta{background:#C94A30;color:#fff;padding:9px 16px;border-radius:999px;border:2px solid #1F1A17;box-shadow:3px 3px 0 #1F1A17;font-weight:600}
@media (min-width:861px){body.es-has-rail{padding-left:72px}}
@media (max-width:860px){.es-rail{display:none}}
.es-tabs{display:none}
@media (max-width:860px){.es-tabs{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:60;justify-content:space-around;align-items:flex-end;padding:6px 6px calc(8px + env(safe-area-inset-bottom));background:rgba(255,251,245,.96);backdrop-filter:blur(8px);border-top:1.5px solid #E9DFD2}
.es-tabs a{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;color:#6B5F56;text-decoration:none;font:600 11px "Instrument Sans",system-ui;padding:4px 0}
.es-tabs a[aria-current]{color:#1F1A17}.es-tabs a[aria-current] svg{stroke-width:2.4}
.es-tabs a.es-plus{flex:none;margin:-22px 6px 0}.es-tabs a.es-plus span{display:grid;place-items:center;width:54px;height:54px;border-radius:18px;background:#C94A30;color:#fff;border:2px solid #1F1A17;box-shadow:3px 3px 0 #1F1A17}
body.es-has-tabs{padding-bottom:84px}body.es-has-tabs header nav > a{display:none!important}}`;
  document.head.appendChild(css);
  const logo = `<svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><circle cx="14" cy="14" r="13" fill="#C4532F"/><circle cx="19" cy="9" r="3.2" fill="#F2D48F"/></svg>`;
  const link = (href, icon, tip, extra = "") => { const p = href.split(/[?#]/)[0]; const cur = p !== "/" && p === P ? ' aria-current="page"' : ""; return `<a href="${href}" data-tip="${tip}" aria-label="${tip}"${cur}>${icon}${extra}</a>`; };
  function draw(me, W, alerts) {
    const rail = document.createElement("nav"); rail.className = "es-rail"; rail.setAttribute("aria-label", "Encore");
    const signed = !!me?.verified, host = signed && !W?.regularOnly, ini = String(me?.name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "🙂";
    rail.innerHTML = `<a class="es-logo" href="${signed ? "/?app=1" : "/"}" aria-label="Encore home">${logo}</a>` +
      (signed ? link("/?app=1", ICON.home, "Home") : "") + link("/discover", ICON.search, "Discover") + (signed ? link("/feed", ICON.globe, "Feed") : "") +
      link(host ? "/?app=1#studio" : "/signup?mode=friends", ICON.plus, host ? "New event" : "Host something") + link("/plans", ICON.cal, "Your plans") +
      (signed ? link("/feed#alerts", ICON.bell, "Alerts", alerts ? `<span class="es-n">${alerts > 99 ? "99+" : alerts}</span>` : "") : "") +
      `<span class="es-sp"></span><span class="es-div"></span>` +
      (signed ? `<a href="${W?.handle ? "/@" + W.handle : "/?app=1"}" data-tip="${W?.handle ? "My page" : "Account"}" aria-label="My page"><span class="es-av">${ini}</span></a>` : link("/login", ICON.login, "Sign in"));
    document.body.prepend(rail); document.body.classList.add("es-has-rail");
    // phones: a bottom tab bar with a big + in the middle (event pages keep their own sticky RSVP bar instead)
    if (!isG) { const tabs = document.createElement("nav"); tabs.className = "es-tabs"; tabs.setAttribute("aria-label", "Encore");
      const tab = (href, icon, label) => { const p = href.split(/[?#]/)[0]; return `<a href="${href}"${p !== "/" && p === P ? ' aria-current="page"' : ""}>${icon}<b>${label}</b></a>`; };
      tabs.innerHTML = (signed ? tab("/feed", ICON.globe, "Feed") : tab("/", ICON.home, "Home")) + tab("/discover", ICON.search, "Discover") +
        `<a class="es-plus" href="${host ? "/?app=1#studio" : "/signup?mode=friends"}" aria-label="${host ? "New event" : "Host something"}"><span><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></span></a>` +
        tab("/plans", ICON.cal, "Plans") + (signed ? tab(W?.handle ? "/@" + W.handle : "/?app=1", `<span class="es-av" style="width:24px;height:24px;font-size:10px">${ini}</span>`, "Me") : tab("/login", ICON.login, "Sign in"));
      document.body.appendChild(tabs); document.body.classList.add("es-has-tabs"); }
    if (isG && !document.querySelector(".es-top")) { const top = document.createElement("header"); top.className = "es-top";
      top.innerHTML = `<a class="es-brand" href="${signed ? "/?app=1" : "/"}">${logo}encore</a><nav><a href="/discover">Discover</a>${signed ? `<a href="/plans">Your plans</a>` : `<a href="/login">Sign in</a>`}<a class="cta" href="${host ? "/?app=1#studio" : "/signup?mode=friends"}">Host something</a></nav>`;
      const main = document.querySelector("main") || document.body.firstElementChild; (main?.parentElement || document.body).insertBefore(top, main); }
  }
  const go = async () => { let me = {}, W = {}, alerts = 0; try { me = await (await fetch("/api/me", { credentials: "same-origin" })).json(); } catch {}
    if (me?.verified) { try { W = await (await fetch("/api/workspace", { credentials: "same-origin" })).json(); } catch {} }
    document.querySelector(".es-rail")?.remove(); document.querySelector(".es-tabs")?.remove(); document.querySelector(".es-top")?.remove(); draw(me, W, alerts); };
  window.addEventListener("encore:signedin", () => setTimeout(go, 300));
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", go) : go();
})();
