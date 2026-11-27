// Seats by audience on the light invite (public/invite.html): one plain line about this guest's own access, from
// GET /api/public/seats/<id> (server/seats.js). "Members get first dibs. 2 member seats left." or "Opens to everyone
// Wed 9am" with Remind me in place of the reply button. Nobody sees anyone else's block. Does nothing when the host
// hasn't split their seats.
(function () {
  const id = (location.pathname.match(/^\/[ei]\/([A-Za-z0-9_-]{2,80})/) || [])[1]; if (!id || window.__plSeats) return; window.__plSeats = 1;
  let info = null, done = false;
  fetch("/api/public/seats/" + encodeURIComponent(id), { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then((j) => { info = j; place(); }).catch(() => {});
  const mo = new MutationObserver(place); mo.observe(document.documentElement, { childList: true, subtree: true }); setTimeout(() => mo.disconnect(), 30000);
  function place() {
    const send = document.getElementById("send"); if (!info || !info.on || !info.line || !send || document.getElementById("seatLine")) return;
    const p = document.createElement("p"); p.id = "seatLine"; p.className = "muted"; p.setAttribute("role", "status"); p.style.cssText = "margin:4px 0 0;font-weight:600;color:var(--pl-ink)"; p.textContent = info.line;
    send.before(p);
    if (info.can === false && info.remind) {
      send.hidden = true; const b = document.createElement("button"); b.type = "button"; b.className = "go"; b.id = "seatRemind"; b.textContent = "Remind me"; send.after(b);
      b.onclick = async () => { const ct = document.getElementById("ct"), email = (ct && /@/.test(ct.value) ? ct.value : "").trim();
        b.disabled = true; try { const r = await fetch("/api/public/seats/" + encodeURIComponent(id) + "/remind", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) }); const j = await r.json().catch(() => ({}));
          if (!r.ok) { b.disabled = false; p.textContent = j.message || "Add your email above, then tap Remind me."; ct?.focus(); return; } b.textContent = "We'll tell you when it opens"; } catch { b.disabled = false; } };
      // a paid members window (server/memberships.js): everyone else can wait in line, and moves up when it opens
      if (info.wait) { const w = document.createElement("button"); w.type = "button"; w.className = "go"; w.id = "seatWait"; w.textContent = "Join the waitlist"; w.style.cssText = "margin-top:8px;background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);border:1.5px solid var(--pl-line-strong,#1B1D1C)"; /* one blue button per screen */ b.after(w);
        w.onclick = () => { window.__plJoinWait = true; const f = send.form || document.getElementById("f"); if (f?.requestSubmit) f.requestSubmit(send); else send.click(); }; }
    }
    done = true;
  }
})();
