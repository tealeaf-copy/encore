// "Come with me?" (server/comewith.js). One file for the light invite (/e/<id>, /i/<id>), the full invite (/g) and the
// feed's cards:
// 1. After you reply I'm in, "Come with me?" makes a link for one friend (the phone's share sheet, else it's copied).
//    On an ordinary event their spot is held for 48 hours; on pairs and groups they join yours.
// 2. The friend's invite opens with "Mia wants you to come to Salsa Sunday" and Mia's face. Reading the link sets a
//    cookie for that event, so the reply they send is matched to the held spot on the server.
// 3. Once both are in, Who's coming says "Mia and Jo are in" with both faces (the pill from public/friendsgoing.js).
(function () {
  if (window.PLComeWith) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (s, r = document) => r.querySelector(s);
  const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} } };
  const TOK = /^[A-Za-z0-9_-]{20,40}$/;
  // a drawn line glyph (two people), not an emoji, like the app's other button icons (docs/brand-kit.md, UI tokens)
  const GLYPH_PAIR = `<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.2" cy="6.6" r="2.6"/><path d="M2.6 16.2c.4-3 2.2-4.7 4.6-4.7s4.2 1.7 4.6 4.7"/><circle cx="13.6" cy="7.4" r="2.2"/><path d="M12.6 11.6c.3-.1.7-.1 1-.1 2.1 0 3.6 1.5 3.9 4.2"/></svg>`;
  const TINTS = ["#F2D48F", "#FBD3CB", "#CDEBD5", "#E2D6F7", "#A9D5F8", "#FCCBA6"];
  const tint = (n) => TINTS[[...String(n || "")].reduce((a, c) => a + c.charCodeAt(0), 0) % TINTS.length];
  const face = (p, size = 40) => `<span class="cwm-face" style="--c:${esc(p.color && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : tint(p.name))};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.46)}px" aria-hidden="true">${esc(p.emoji || String(p.name || "?").slice(0, 1).toUpperCase())}</span>`;
  const until = (t) => { const d = new Date(t); if (isNaN(d)) return ""; const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }), h = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/:00(?=\s)/, "").replace(/\s([AP]M)$/, (_, x) => x.toLowerCase()); return `${day} · ${h}`; };
  const CSS = `.cwm-hello{max-width:620px;display:flex;gap:12px;align-items:center;background:#FFF8EE;border:1.5px solid #E4D9C8;border-radius:18px;padding:12px 14px;margin:10px 0 14px;color:#1F1A17;font:500 15px/1.35 "Instrument Sans",system-ui,sans-serif;position:relative}
.cwm-hello p{margin:0}.cwm-hello b{font:600 17px/1.25 var(--sys-title)}.cwm-hello small{display:block;color:#665A51;font-size:13.5px;margin-top:2px}
.cwm-face{display:inline-grid;place-items:center;flex:0 0 auto;border-radius:50%;border:2px solid #1F1A17;background:var(--c,#F2D48F);color:#1F1A17;font-weight:700;font-family:var(--sys-display)}
.cwm-faces{display:inline-flex}.cwm-faces .cwm-face+.cwm-face{margin-left:-12px}
.cwm-box{display:grid;gap:6px;margin:12px 0 4px;justify-items:start}
.cwm-btn{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 18px;border:1.5px solid #1F1A17;border-radius:999px;background:#F2D48F;color:#1F1A17;font:600 16px "Instrument Sans",system-ui,sans-serif;cursor:pointer}
.cwm-btn svg{flex:none;width:20px;height:20px}
.cwm-btn:hover{background:#EFCB7C}.cwm-btn[disabled]{opacity:.6;cursor:default}
.cwm-btn.pulse{animation:cwmP 1.4s ease-in-out 3}@keyframes cwmP{50%{box-shadow:0 0 0 6px rgba(201,74,48,.25)}}
.cwm-note{margin:0;color:#665A51;font:500 13.5px/1.35 "Instrument Sans",system-ui,sans-serif}.cwm-note.err{color:#A8341A}
.cwm-copy{width:100%;max-width:340px;min-height:40px;border:2px solid #E4D9C8;border-radius:12px;padding:0 10px;font:500 14px "Instrument Sans",system-ui;color:#1F1A17;background:#fff}
.cwm-tg{margin:10px 0}#tk .cwm-box{justify-items:center}
.fv-cwm{min-height:40px;padding:0 14px;font-size:15px;box-shadow:none}
@media (prefers-reduced-motion:reduce){.cwm-btn,.cwm-btn.pulse{animation:none}}`;
  const css = () => { if ($("#cwmCss")) return; const s = document.createElement("style"); s.id = "cwmCss"; s.textContent = CSS; document.head.appendChild(s); };
  const idOf = () => { const m = location.pathname.match(/^\/[ei]\/([A-Za-z0-9_-]{2,80})$/); if (m) return m[1]; const h = location.pathname === "/g" && location.hash.match(/^#rsvp-([A-Za-z0-9_-]{2,80})/); return h ? h[1] : ""; };
  const mine = (id) => { try { const M = JSON.parse(localStorage.getItem("encore-rsvp-" + id) || "null"); return M?.rid && M.code ? M : null; } catch { return null; } };

  // ---- making the link and sending it ----
  async function send(make, { title = "", box }) {
    const note = (t, err) => { let n = $(".cwm-note", box); if (!n) { n = document.createElement("p"); n.className = "cwm-note"; n.setAttribute("role", "status"); box.appendChild(n); } n.classList.toggle("err", !!err); n.textContent = t; return n; };
    let j; try { const r = await make(); j = await r.json().catch(() => ({})); if (!r.ok) { if (j.code === "reply_first") return { replyFirst: true }; note(j.message || "Didn't work. Try again.", true); return {}; } } catch { note("Didn't work. Check your connection.", true); return {}; }
    const url = location.origin + j.url, name = j.title || title, held = j.held ? " Their spot is held for 48 hours." : j.pair ? " They join your pair." : "";
    const text = `Come with me to ${name}?`;
    if (navigator.share && matchMedia("(pointer:coarse)").matches) { try { await navigator.share({ title: name, text, url }); note("Sent." + held); return { ok: true }; } catch (e) { if (e?.name === "AbortError") { note("Not sent. Tap again when you're ready.", false); return {}; } } }
    try { await navigator.clipboard.writeText(`${text} ${url}`); note("Link copied. Send it to your friend." + held); }
    catch { note("Copy this link and send it to your friend." + held); const i = document.createElement("input"); i.className = "cwm-copy"; i.readOnly = true; i.value = url; i.setAttribute("aria-label", "Link for your friend"); box.appendChild(i); i.select(); }
    return { ok: true, url };
  }
  function button(cls = "") { css(); const b = document.createElement("button"); b.type = "button"; b.className = "cwm-btn " + cls; b.innerHTML = `${GLYPH_PAIR}<span>Come with me?</span>`; return b; }
  /** From a feed card, signed in: a link from your own reply. Not replied yet: opens the invite, with the button waiting there. */
  async function fromFeed(eventId, title, url, btn) { const box = btn.closest(".fv-acts")?.parentElement || btn.parentElement; btn.disabled = true;
    const r = await send(() => fetch("/api/me/come-with", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId }) }), { title, box });
    btn.disabled = false; if (r.replyFirst) { ss.set("cwm-want-" + eventId, "1"); location.href = url; } }

  // ---- on an invite ----
  let id = "", hello = null, tg = null, busy = false, tgAsked = "";
  function placeHello() { if (!hello) return; if (document.body.contains(hello.el)) return;
    const g = location.pathname === "/g" ? $("#view-guest") : null; if (g) { if (g.hidden || !g.firstElementChild) return; g.prepend(hello.el); return; }
    const m = $("#m"), top = m && $(".top", m); if (!m || $(".muted", m)?.textContent.startsWith("Opening")) return; top ? top.after(hello.el) : m.prepend(hello.el); }
  async function readLink() { const q = new URLSearchParams(location.search).get("with"); let tok = TOK.test(q || "") ? q : ""; if (tok) ss.set("plw-" + id, tok); else tok = ss.get("plw-" + id) || ""; if (!TOK.test(tok)) return;
    let j = null; try { j = await (await fetch(`/api/public/come-with/${encodeURIComponent(id)}/${encodeURIComponent(tok)}`, { credentials: "same-origin" })).json(); } catch {} if (!j?.ok) return;
    const F = j.from || { name: "A friend" }, el = document.createElement("div"); el.className = "cwm-hello"; el.setAttribute("role", "note");
    const sub = j.used ? "" : j.held ? `Your spot is held until ${until(j.held.until)}.` : j.pair ? `You'd join ${F.name}'s pair. No new spot needed.` : j.ask ? `Ask to join below. The host lets each guest in.` : "";
    el.innerHTML = `${face(F, 44)}<p><b>${esc(F.name)} wants you to come to ${esc(j.title)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</p>`; hello = { el }; css(); placeHello(); }
  function placeButton() { if (busy || !id) return; const M = mine(id); if (!M) return; let at = null, gview = false;
    const tk = $("#tk"); if (tk && /You're in|Ordered/.test($("h2", tk)?.textContent || "")) at = tk;
    const gt = $("#view-guest .ticket"); if (!at && gt && /You're in/.test($(".eyebrow", gt)?.textContent || "")) { at = gt; gview = true; }
    if (!at || (gview ? at.nextElementSibling?.classList.contains("cwm-box") : $(".cwm-box", at))) return;
    if (ss.get("plw-" + id) && !tg) { tgAsked = ""; setTimeout(together, 400); } // came through a link: show "Mia and Jo are in" straight away
    const box = document.createElement("div"); box.className = "cwm-box"; const b = button(ss.get("cwm-want-" + id) ? "pulse" : ""); box.appendChild(b);
    if (gview) at.after(box); else { const bt = $(".btns", at), h = $("h2", at); if (bt) bt.before(box); else (h?.nextElementSibling?.matches?.("p") ? h.nextElementSibling : h)?.after(box); } // review round 12: the door code stays right under "Show this at the door"
    b.onclick = async () => { busy = true; b.disabled = true; const M2 = mine(id) || M; await send(() => fetch("/api/public/come-with", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: id, rid: M2.rid, code: M2.code }) }), { title: (document.querySelector("#view-guest h1, main h1")?.textContent || "").trim(), box }); b.disabled = false; busy = false; };
    together(); }
  // "Mia and Jo are in": above the names on the light invite, under the title on the full one
  async function together() { if (!id || tgAsked === id) return; tgAsked = id; let A = null; try { A = await (await fetch("/api/public/attendees/" + encodeURIComponent(id), { credentials: "same-origin" })).json(); } catch {} const T = A?.together || []; if (!T.length) return;
    const withPill = () => { const P = window.PLFriends; if (!P) return false; tg = document.createElement("div"); tg.className = "cwm-tg"; tg.innerHTML = T.slice(0, 3).map((t) => P.html({ count: t.count, line: t.line, people: t.people })).join(" "); placeTg(); return true; };
    if (!withPill()) { const s = document.createElement("script"); s.src = "/friendsgoing.js"; s.onload = withPill; document.head.appendChild(s); } }
  function placeTg() { if (!tg || document.body.contains(tg)) return; const n = $(".going") || $(".going-n") || $("#view-guest .who-going") || $("#view-guest h1, #view-guest .lk-title"); if (n) n.after(tg); }
  function boot() { const nid = idOf(); if (!nid || nid === id) return; id = nid; hello = null; tg = null; readLink(); together();
    new MutationObserver(() => { clearTimeout(window.__cwmT); window.__cwmT = setTimeout(() => { placeHello(); placeButton(); placeTg(); }, 150); }).observe(document.body, { childList: true, subtree: true }); placeButton(); }
  window.addEventListener("hashchange", boot);
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", boot) : boot();
  window.PLComeWith = { fromFeed, button, css, send };
})();
