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
