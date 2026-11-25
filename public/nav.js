// One header for every public page. Signed in: Home, Discover, Feed, Plans, My page.
// Signed out: Discover, Hosts, Sign in, Start your page. On phones the links scroll instead of getting cut off.
(function () {
  if (window.__encoreNav) return; window.__encoreNav = 1;
  const st = document.createElement("style");
  st.textContent = `header nav{min-width:0}@media (max-width:700px){header nav{overflow-x:auto;flex-wrap:nowrap!important;scrollbar-width:none;-webkit-mask-image:linear-gradient(90deg,#000 88%,transparent)}header nav::-webkit-scrollbar{display:none}header nav a{white-space:nowrap;flex:none}}`;
  document.head.appendChild(st);
  const here = location.pathname;
  const draw = (links) => { const nav = document.querySelector("header nav"); if (!nav) return;
    nav.querySelectorAll(":scope > a").forEach((a) => a.remove());
    for (const [href, label, cta] of links) { const a = document.createElement("a"); a.href = href; a.textContent = label; if (cta) a.className = "cta"; const p = href.split(/[?#]/)[0]; if (p === here && p !== "/") a.setAttribute("aria-current", "page"); nav.appendChild(a); } };
  const run = async () => { try {
    const me = await (await fetch("/api/me", { credentials: "same-origin" })).json().catch(() => ({}));
    if (!me?.verified) return draw(document.body?.dataset?.audience === "brand" ? [["/discover", "Discover"], ["/hosts", "Hosts"], ["/login", "Sign in"], ["/hosts/book", "Find a host", 1]] : [["/discover", "Discover"], ["/hosts", "Hosts"], ["/login", "Sign in"], ["/signup?mode=friends", "Start your page", 1]]);
    const W = await (await fetch("/api/workspace", { credentials: "same-origin" })).json().catch(() => ({}));
    if (W?.regularOnly) return draw([["/discover", "Discover"], ["/feed", "Feed"], ["/plans", "Plans"], ["/?app=1", "Host something", 1]]);
    draw([["/?app=1", "Home"], ["/discover", "Discover"], ["/feed", "Feed"], ["/plans", "Plans"], ...(W?.handle ? [["/@" + W.handle, "My page"]] : []), ["/?app=1#studio", "New event", 1]]);
  } catch {} };
  run(); window.addEventListener("encore:signedin", run);
})();
