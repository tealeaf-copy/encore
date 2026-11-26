// "Confirm your email" (server/verify.js): one slim line at the top for a new account that hasn't tapped the link yet,
// with Resend. Loaded by public/chatnav.js for signed-in people, so it shows in the app and on the public pages.
(function () {
  if (window.__plVerify || !/(?:^|;\s*)encore_in=1/.test(document.cookie)) return; window.__plVerify = 1;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  fetch("/api/me", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then((me) => {
    if (!me || me.emailVerified !== false) return;
    const b = document.createElement("div"); b.id = "plVerify"; b.setAttribute("role", "status");
    b.innerHTML = `<span>Confirm your email to share invites. We sent a link to ${esc(me.email)}.</span><button type="button">Resend</button>`;
    const css = document.createElement("style"); css.textContent = `#plVerify{position:relative;z-index:50;display:flex;align-items:center;justify-content:center;gap:8px 12px;flex-wrap:wrap;padding:8px 16px;padding-top:max(8px,env(safe-area-inset-top));background:#F2D48F;color:#1F1A17;font:500 14px/1.35 "Instrument Sans",system-ui,sans-serif;text-align:center}#plVerify button{min-height:36px;padding:0 14px;border-radius:999px;border:1.5px solid #1F1A17;background:transparent;color:#1F1A17;font:600 14px "Instrument Sans",system-ui,sans-serif;cursor:pointer}#plVerify button:focus-visible{outline:3px solid #1F1A17;outline-offset:2px}`;
    document.head.appendChild(css); document.body.prepend(b);
    b.querySelector("button").onclick = async (e) => { e.target.disabled = true; try { const r = await fetch("/api/me/verify", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" }); const j = await r.json().catch(() => ({})); b.querySelector("span").textContent = j.verified ? "Your email is confirmed." : j.message || "Sent."; } catch { e.target.disabled = false; } };
  }).catch(() => {});
})();
