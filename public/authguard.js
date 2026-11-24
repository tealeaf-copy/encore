// the tab icon: a little terracotta vase
(function () { try { if (!document.querySelector('link[rel~="icon"]')) { const l = document.createElement("link"); l.rel = "icon"; l.type = "image/svg+xml"; l.href = "/favicon.svg"; (document.head || document.documentElement).appendChild(l); } } catch {} })();
// Side navigation, before the first paint: reserve its space and apply the collapsed setting now, so nothing
// jumps sideways when the nav itself is drawn a moment later (by shell.js on public pages, by the app on /).
(function () {
  try {
    const P = location.pathname, root = document.documentElement;
    let folded = false; try { folded = localStorage.getItem("encore-nav-collapsed") === "1"; } catch {}
    if (folded) root.classList.add("nav-folded");
    const rail = P === "/g" || /^\/(discover|feed|plans|requests|hosts|quiz|teams|gifts|vendor|results|team)$/.test(P) || /^\/(team|hosts|h)\//.test(P) || /^\/@/.test(P);
    if (rail) root.classList.add("es-pre");
    const st = document.createElement("style"); st.id = "navFoldCss";
    st.textContent = `@media (max-width:860px){input:not([type=checkbox]):not([type=radio]):not([type=range]),textarea,select{font-size:16px!important}}@media (min-width:861px){html.es-pre body{padding-left:224px}html.es-pre.nav-folded body{padding-left:72px}html.es-pre body::before{content:"";position:fixed;left:0;top:0;bottom:0;width:224px;background:#FFFDFA;border-right:1px solid #E9E1D6;z-index:1}html.es-pre.nav-folded body::before{width:72px}html.es-pre body header.top{display:none}}
.nav-fold{position:absolute;top:22px;right:-13px;width:26px;height:26px;border-radius:50%;border:1px solid #E4D9C8;background:#fff;color:#6B5F56;display:grid;place-items:center;cursor:pointer;z-index:60;padding:0;box-shadow:0 2px 6px rgba(31,26,23,.08);transition:transform .2s}
.nav-fold:hover{color:#1F1A17;transform:scale(1.08)}.nav-fold:focus-visible{outline:3px solid #C94A30;outline-offset:2px}.nav-fold svg{width:14px;height:14px;transition:transform .25s}
html.nav-folded .nav-fold svg{transform:rotate(180deg)}
@media (max-width:860px){.nav-fold{display:none}}
@media (min-width:861px){
  html.nav-folded .es-rail{width:72px!important;padding:20px 12px!important;align-items:center!important}
  html.nav-folded .es-rail a{justify-content:center;padding:10px!important;width:46px!important}
  html.nav-folded .es-rail a > span,html.nav-folded .es-rail .es-out,html.nav-folded .es-logo > span{display:none!important}
  html.nav-folded body.es-has-rail,html.nav-folded body.guestmode.es-has-rail{padding-left:72px!important}
  html.nav-folded .es-rail a:hover::after{content:attr(aria-label);position:absolute;left:58px;top:50%;transform:translateY(-50%);white-space:nowrap;background:#1F1A17;color:#fff;font:600 12.5px system-ui;padding:5px 9px;border-radius:8px;pointer-events:none;z-index:70}
}
@media (min-width:1000px){
  html.nav-folded header.top{width:72px!important}
  html.nav-folded header.top .wrap{padding:22px 10px!important;align-items:center!important}
  html.nav-folded header.top .logo{padding:0!important}html.nav-folded header.top .logo span,html.nav-folded #signOut{display:none!important}
  html.nav-folded nav.tabs a{font-size:0!important;justify-content:center;padding:10px!important;width:46px;position:relative}
  html.nav-folded nav.tabs a svg{width:22px;height:22px}
  html.nav-folded nav.tabs a:hover::after{content:attr(data-label);position:absolute;left:58px;top:50%;transform:translateY(-50%);white-space:nowrap;background:#1F1A17;color:#fff;font:600 12.5px system-ui;padding:5px 9px;border-radius:8px;pointer-events:none;z-index:70}
  html.nav-folded header.top .rail,html.nav-folded header.top .status{display:none!important}
  html.nav-folded body{padding-left:72px!important}
}`;
    (document.head || root).appendChild(st);
  } catch {}
})();
// Loaded first on every page. Calls that need a session are answered locally with a 401 when the browser has no
// "signed in" hint, so signed-out visitors (most guests) don't make a dozen round-trips that can only fail.
// Guest calls (they carry x-encore-guest or x-encore-key) and everything else always go to the server.
(function () {
  if (window.__encoreAuthGuard) return; window.__encoreAuthGuard = 1;
  const signedIn = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  const NEEDS_SESSION = /^\/api\/(me(?:\/|$|\?)|workspace(?:\/|$|\?)|brand(?:\/|$|\?)|host\/(?:profile|bookings|orders)(?:$|\?)|db\/)/;
  const headerOf = (init, name) => { const h = init && init.headers; if (!h) return null; if (typeof h.get === "function") return h.get(name); const k = Object.keys(h).find((x) => x.toLowerCase() === name); return k ? h[k] : null; };
  const real = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      const url = new URL(typeof input === "string" ? input : input.url, location.href), method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
      // guests may only list the guest wall (and conference nominations with a signed token); every other list needs a session
      const guestList = url.pathname === "/api/db/collection" && !signedIn() && url.searchParams.get("path") !== "wall" && !headerOf(init, "x-encore-token");
      if (url.origin === location.origin && method === "GET" && (guestList || (NEEDS_SESSION.test(url.pathname) && !signedIn() && !headerOf(init, "x-encore-guest") && !headerOf(init, "x-encore-key"))))
        return Promise.resolve(new Response(JSON.stringify({ code: "unauthenticated", message: "Sign in first." }), { status: 401, headers: { "content-type": "application/json" } }));
    } catch {}
    return real(input, init);
  };
})();
