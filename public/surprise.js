// Small surprises for guests (server/surprise.js): one file for the light invite (/e/<id>), the full invite (/g) and a
// host's page (/@handle).
// - A warm, true line at the top: "Maya saved you a seat", "Priya is going. You both loved Pottery night.", "3 friends
//   are going". The server writes it (GET /api/public/surprise/<id>); the light invite loads this file
//   through public/friendsgoing.js, so its own page stays inside the 40,000-character budget.
// - Regulars (2 or more of this host's events) see a small "Regular" badge on the invite and the host's page.
// - After "I'm in", one small line from Potto about the event ("Bring an appetite, there are 40 dumplings").
// Each piece is put in place in the same moment the page draws (a MutationObserver), so nothing jumps.
(function () {
  if (window.PLSurprise) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (s, r = document) => r.querySelector(s);
  const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} } };
  const G = (d) => `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const GLYPH = { personal: G('<path d="M6 3v8h8M6 11v6M14 11v6M5 11h10"/><path d="M6 3h7v8"/>'), loved: G('<path d="M10 16s-6-3.6-6-8a3.2 3.2 0 0 1 6-1.6A3.2 3.2 0 0 1 16 8c0 4.4-6 8-6 8z"/>'),
    friends: G('<circle cx="7.2" cy="6.6" r="2.6"/><path d="M2.6 16.2c.4-3 2.2-4.7 4.6-4.7s4.2 1.7 4.6 4.7"/><circle cx="13.6" cy="7.4" r="2.2"/><path d="M12.6 11.6c.3-.1.7-.1 1-.1 2.1 0 3.6 1.5 3.9 4.2"/>') };
  const CSS = `.plsu-line{display:flex;align-items:flex-start;gap:10px;margin:10px 0 12px;padding:10px 12px;border-left:3px solid var(--pl-accent,#29489A);background:var(--pl-surface,#FAF8F3);border-radius:0 6px 6px 0;color:var(--pl-ink,#1B1D1C);font:500 15px/1.4 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);max-width:620px;box-sizing:border-box}
.plsu-line svg{flex:none;margin-top:1px;color:var(--pl-accent,#29489A)}.plsu-line p{margin:0;flex:1;min-width:0;overflow-wrap:anywhere}.plsu-line small{display:block;color:var(--pl-soft,#444845);font-size:13.5px;margin-top:2px}
.plsu-reg{display:inline-flex;align-items:center;flex:none;height:24px;padding:0 8px;border:1px solid var(--pl-accent,#29489A);border-radius:6px;background:var(--pl-accent-soft,#E3E8F4);color:var(--pl-accent-text,#29489A);font:600 13px/1 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);letter-spacing:.01em;white-space:nowrap}
.plsu-hostreg{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0 0;color:var(--pl-soft,#444845);font:500 14px/1.35 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif)}
.plsu-send{margin:8px auto 4px;max-width:440px;color:var(--pl-ink,#1B1D1C);font:500 15px/1.45 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif)}.plsu-send b{font-weight:600;color:var(--pl-accent-text,#29489A)}
#view-guest .plsu-send{text-align:left;margin:10px 0}`;
  const css = () => { if ($("#plsuCss")) return; const s = document.createElement("style"); s.id = "plsuCss"; s.textContent = CSS; document.head.appendChild(s); };
  const idOf = () => { const m = location.pathname.match(/^\/[ei]\/([A-Za-z0-9_-]{2,80})$/); if (m) return m[1]; const h = location.pathname === "/g" && location.hash.match(/^#rsvp-([A-Za-z0-9_-]{2,80})/); return h ? h[1] : ""; };
  const signedIn = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  // the personal invite the host made (#rsvp-<id>.g<i>.i-<key>~<token>), sent the way public/shim.js sends it
  const inviteHeader = () => { const inv = /\.i-([A-Za-z0-9_-]+)~([a-f0-9]+)$/.exec(location.hash || ""); if (!inv) return {}; try { return { "x-encore-invite": encodeURIComponent(decodeURIComponent(escape(atob(inv[1].replace(/-/g, "+").replace(/_/g, "/"))))) + "~" + inv[2] }; } catch { return {}; } };
  const regBadge = (n, host) => `<span class="plsu-reg" title="${esc(`You've been to ${n} of ${host}'s events`)}">Regular</span>`;

  let id = "", D = null, lineEl = null, sentOff = false;
  function build() { if (!D || (!D.l && !D.r)) return null; css(); const el = document.createElement("div"); el.className = "plsu-line"; el.setAttribute("role", "note"); el.dataset.k = D.k || "regular";
    el.innerHTML = D.l ? `${GLYPH[D.k] || GLYPH.friends}<p>${esc(D.l)}${D.r ? `<small>You've been to ${esc(D.r)} of ${esc(D.h)}'s events.</small>` : ""}</p>${D.r ? regBadge(D.r, D.h) : ""}`
      : `<p>Good to see you again. You've been to ${esc(D.r)} of ${esc(D.h)}'s events.</p>${regBadge(D.r, D.h)}`;
    // "3 friends are going" says what the Friends going pill would say: the pill steps aside (public/friendsgoing.js)
    if (D.k === "friends" || D.k === "loved") { document.documentElement.dataset.plsFriends = "1"; document.querySelectorAll(".plf .plf-pill").forEach((p) => p.remove()); }
    return el; }
  function placeLine() { if (!lineEl || document.body.contains(lineEl)) return;
    if (location.pathname === "/g") { const g = $("#view-guest"); if (!g || g.hidden || !g.firstElementChild) return; const hello = $(".cwm-hello", g); hello ? hello.after(lineEl) : g.prepend(lineEl); return; }
    const m = $("#m"), top = m && $(".top", m); if (!m || !$("h1", m)) return; const hello = $(".cwm-hello", m); (hello || top) ? (hello || top).after(lineEl) : m.prepend(lineEl); }
  function placeSendOff() { if (!D?.s || !id) return; let at = null;
    const tk = $("#tk"), h = tk && $("h2", tk); if (h && /You're in/.test(h.textContent || "")) at = h.nextElementSibling?.matches?.("p") ? h.nextElementSibling : h;
    const gt = $("#view-guest .ticket"); if (!at && gt && /You're in/.test($(".eyebrow", gt)?.textContent || "")) at = $("h3", gt)?.nextElementSibling?.matches?.("p") ? $("h3", gt).nextElementSibling : $("h3", gt) || $(".eyebrow", gt);
    if (!at || document.querySelector(".plsu-send")) return; css();
    const p = document.createElement("p"); p.className = "plsu-send"; p.innerHTML = `<b>Potto:</b> ${esc(D.s)}`; at.after(p);
    if (!sentOff && !ss.get("pls-s-" + id)) { sentOff = true; ss.set("pls-s-" + id, "1"); try { navigator.sendBeacon?.(`/api/public/surprise/${encodeURIComponent(id)}/seen?what=sendoff`); } catch {} } }
  const tick = () => { try { placeLine(); placeSendOff(); } catch {} };

  async function onInvite() { id = idOf(); if (!id || id === "_preview") return;
    { const h = inviteHeader(); try { const r = await fetch(`/api/public/surprise/${encodeURIComponent(id)}`, { credentials: "same-origin", headers: h }); const j = r.ok ? await r.json() : {}; D = { l: j.line || "", k: j.kind || "", r: j.regular || 0, h: j.host || "", s: j.sendoff || "" }; } catch { D = null; } }
    if (!D) return; lineEl = build(); tick();
    new MutationObserver(tick).observe(document.body, { childList: true, subtree: true }); }

  // a host's page: the badge next to their name, for a regular who is signed in
  async function onHostPage() { const m = location.pathname.match(/^\/@([a-z0-9][a-z0-9-]{1,29})\/?$/i); if (!m || !signedIn()) return;
    let j = null; try { j = await (await fetch("/api/me/regular?handle=" + encodeURIComponent(m[1]), { credentials: "same-origin" })).json(); } catch {} if (!j?.regular) return; css();
    const el = document.createElement("p"); el.className = "plsu-hostreg"; el.innerHTML = `${regBadge(j.times, j.host)}<span>You've been to ${esc(j.times)} of ${esc(j.host)}'s events.</span>`;
    const put = () => { if (document.body.contains(el)) return true; const h = document.querySelector("main h1, h1"); if (!h) return false; (h.closest(".name-row") || h).after(el); return true; };
    if (!put()) { const mo = new MutationObserver(() => { if (put()) mo.disconnect(); }); mo.observe(document.body, { childList: true, subtree: true }); setTimeout(() => mo.disconnect(), 15000); } }

  function boot() { if (idOf()) onInvite(); else onHostPage(); }
  window.addEventListener("hashchange", () => { if (location.pathname === "/g" && idOf() !== id) { lineEl?.remove(); document.querySelector(".plsu-send")?.remove(); D = null; lineEl = null; onInvite(); } });
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", boot) : boot();
  window.PLSurprise = { build: () => lineEl };
})();
