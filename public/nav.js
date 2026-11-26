// One header for every public page. Hosts: Home, Discover, New event, Plans, My page, Feed (the app's order, so tabs never move). Brands: Home, Discover, Hosts, Requests, Gifts.
// Signed out: Feed (the app's default view) first, then Discover, Ideas, Hosts, For brands, Sign in, Start your page. On phones the links scroll instead of getting cut off.
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
    if (!me?.verified) return draw(document.body?.dataset?.audience === "brand" ? [["/discover", "Discover"], ["/hosts", "Hosts"], ["/gifts", "Gifts"], ["/login", "Sign in"], ["/hosts/book", "Request a date", 1]] : [["/feed", "Feed"], ["/discover", "Discover"], ["/ideas", "Ideas"], ["/hosts", "Hosts"], ...(/^\/(g$|e\/)/.test(here) ? [] : [["/hosts/book", "For brands"]]), ["/login", "Sign in"], ["/signup?mode=friends", "Start your page", 1]]);
    const W = await (await fetch("/api/workspace", { credentials: "same-origin" })).json().catch(() => ({}));
    if (W?.regularOnly) return draw([["/discover", "Discover"], ["/feed", "Feed"], ["/plans", "Plans"], ["/?app=1", "Start your page", 1]]);
    if (W?.personal === false && W?.plan !== "self-hosted" && !W?.handle) return draw([["/?app=1", "Home"], ["/discover", "Discover"], ["/hosts/book", "Book a host"], ["/requests", "Requests"], ["/gifts", "Gifts"]]);
    draw([["/?app=1", "Home"], ["/discover", "Discover"], ["/?app=1&new=1#studio", "New event", 1], ["/plans", "Plans"], ...(W?.handle ? [["/@" + W.handle, "My page"]] : []), ["/feed", "Feed"]]);
  } catch {} };
  run(); window.addEventListener("encore:signedin", run);
})();
