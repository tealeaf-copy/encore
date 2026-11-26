// "Friends going" on an invite: "Ana and 2 friends are in", with their faces. Only people you follow (friends, and
// hosts you follow) who replied I'm in to a public, listed event that shows its guests, by first name: the same names
// "Who's coming" shows. Signed out, nothing is drawn. Also puts a Save heart next to the event.
//
// For other pages (the feed's cards): PLFriends.get(ids) → { [eventId]: { line, count, people } }, and
// PLFriends.html(info) for the pill.
(function () {
  if (window.PLFriends) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const signedIn = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  const CSS = `.plf{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0 12px}
.plf-pill{display:inline-flex;align-items:center;gap:8px;background:#fff;border:2px solid #1F1A17;border-radius:999px;padding:4px 14px 4px 4px;box-shadow:2px 2px 0 #1F1A17;font:600 15px "Instrument Sans",system-ui,sans-serif;color:#1F1A17;transform:rotate(-1deg)}
.plf-faces{display:inline-flex}.plf-faces span{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;border:2px solid #1F1A17;background:var(--c,#F2D48F);font-size:15px;margin-left:-8px;color:#1F1A17;font-weight:700}.plf-faces span:first-child{margin-left:0}
.plf-pill b{font-weight:700}`;
  const css = () => { if (document.getElementById("plfCss")) return; const s = document.createElement("style"); s.id = "plfCss"; s.textContent = CSS; document.head.appendChild(s); };
  const TINTS = ["#F2D48F", "#FBD3CB", "#CDEBD5", "#E2D6F7", "#A9D5F8", "#FCCBA6"], tint = (p, i) => TINTS[([...String(p.name || "")].reduce((a, c) => a + c.charCodeAt(0), 0) + i) % TINTS.length];
  const face = (p) => (p.emoji && !["🙂", "🎉"].includes(p.emoji) ? p.emoji : (p.name || "?")[0].toUpperCase());
  function html(info) { css(); if (!info?.count) return ""; const P = info.people || [];
    return `<span class="plf-pill" role="note"><span class="plf-faces" aria-hidden="true">${P.slice(0, 3).map((p, i) => `<span style="--c:${tint(p, i)}">${esc(face(p))}</span>`).join("")}</span><span><b>${esc(info.line.split(" ")[0])}</b>${esc(info.line.slice(info.line.indexOf(" ")))}</span></span>`; }
  async function get(ids) { if (!signedIn() || !ids.length) return {}; try { const r = await fetch("/api/me/friends-going?ids=" + encodeURIComponent(ids.slice(0, 40).join(",")), { credentials: "same-origin" }); return r.ok ? (await r.json()).events || {} : {}; } catch { return {}; } }
  // ---- on the invite pages ----
  const idOf = () => { const m = location.pathname.match(/^\/[ei]\/([A-Za-z0-9_-]{2,80})$/); if (m) return m[1]; const h = location.pathname === "/g" && location.hash.match(/^#rsvp-([A-Za-z0-9_-]{2,80})/); return h ? h[1] : ""; };
  let info = null, title = "";
  function place() { const id = idOf(); if (!id) return; if (document.querySelector(`.plf[data-e="${id}"]`)) return;
    const anchor = location.pathname === "/g" ? document.querySelector("#view-guest h1") : document.querySelector("main .facts"); if (!anchor) return;
    title = (document.querySelector("#view-guest h1, main h1")?.textContent || "").trim().slice(0, 140);
    const row = document.createElement("div"); row.className = "plf"; row.dataset.e = id;
    row.innerHTML = (info?.[id] ? html(info[id]) : "") + (window.PLSave ? window.PLSave.button({ kind: "event", ref: id, title }, info?.[id] ? { icon: true } : { label: "Save" }) : "");
    if (!row.innerHTML) return; anchor.after(row); }
  async function boot() { const id = idOf(); if (!id) return; css();
    if (!window.PLSave && !document.querySelector('script[src="/save.js"]')) { const s = document.createElement("script"); s.src = "/save.js"; s.onload = () => { document.querySelectorAll(".plf").forEach((x) => x.remove()); place(); }; document.head.appendChild(s); }
    info = await get([id]); document.querySelectorAll(".plf").forEach((x) => x.remove()); place();
    new MutationObserver(() => { clearTimeout(window.__plfT); window.__plfT = setTimeout(place, 120); }).observe(document.body, { childList: true, subtree: true }); }
  window.addEventListener("hashchange", () => { info = null; boot(); });
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", boot) : boot();
  window.PLFriends = { get, html, css };
})();
