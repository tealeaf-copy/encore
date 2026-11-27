// The light invite (public/invite.html) as its own host or a co-host sees it: server/app.js hides the reply form and the
// sticky reply bar for them and loads this file, which puts one bar where the form was: "You're hosting this" and
// Manage (the event's manage view in the app). Kept out of invite.html so the invite stays under 40,000 characters.
(function () {
  const me = document.currentScript, role = me?.dataset.r === "cohost" ? "cohost" : "host", id = String(me?.dataset.i || "");
  const css = `.pl-own{margin:18px 0 0;padding:14px;border:1.5px solid #1B1D1C;border-radius:6px;background:#FAF8F3;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;font:16px/1.4 "IBM Plex Sans",system-ui,sans-serif;color:#1B1D1C}
.pl-own a{min-height:44px;display:inline-flex;align-items:center;padding:0 18px;border-radius:6px;background:#29489A;color:#fff;font-weight:600;text-decoration:none}.pl-own a:focus-visible{outline:3px solid rgba(41,72,154,.35);outline-offset:2px}`;
  let n = 0;
  function go() { const f = document.getElementById("f"); if (!f) { if (++n < 150) setTimeout(go, 40); return; } if (document.querySelector(".pl-own")) return;
    const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s);
    const d = document.createElement("div"); d.className = "pl-own"; d.dataset.own = role;
    const t = document.createElement("span"); t.textContent = role === "host" ? "You're hosting this. Guests reply here." : "You're co-hosting this. Guests reply here.";
    const a = document.createElement("a"); a.href = role === "host" && /^[A-Za-z0-9_-]{1,80}$/.test(id) ? `/?app=1&open=${encodeURIComponent(id)}#studio` : "/?app=1#studio"; a.textContent = role === "host" ? "Manage" : "Open your events";
    d.append(t, a); f.parentNode.insertBefore(d, f); }
  go();
})();
