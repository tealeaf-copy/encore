// Your stats (server/stats.js): a calm card of real numbers with small drawn icons, for guests and hosts. Zeros are left
// out; with nothing yet, an encouraging line instead. Private by default: the card on /me shows "Only you see these",
// and you pick, one at a time, which stats your page (/@handle) shows. On a page, this file draws only what its owner
// picked (GET /api/public/host/:handle/stats), in the side column.
//
//   PLStats.card(list, { title, edit, show, onToggle })   the card's HTML
//   PLStats.icon(name)                                    one drawn icon
(function () {
  if (window.PLStats) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // line glyphs at 1.75, in our style: a table set for two, a heart, a folded map, a loop back, a little calendar of
  // ticks, a vase, two overlapping circles, a pot, an open door, two cups
  const P = {
    table: '<path d="M3.5 10.5h17"/><path d="M6 10.5v8M18 10.5v8"/><ellipse cx="9" cy="8" rx="2.6" ry="1.1"/><ellipse cx="15" cy="8" rx="2.6" ry="1.1"/>',
    follow: '<path d="M12 19.5s-7-4.3-7-9.2A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 2.3c0 4.9-7 9.2-7 9.2z"/>',
    map: '<path d="M4 6.5 9 4.5l6 2 5-2v13l-5 2-6-2-5 2z"/><path d="M9 4.5v13M15 6.5v13"/>',
    again: '<path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M19.5 4.5v3.8h-3.8"/><path d="M12 15s-2.6-1.6-2.6-3.3a1.3 1.3 0 0 1 2.6-.3 1.3 1.3 0 0 1 2.6.3c0 1.7-2.6 3.3-2.6 3.3z"/>',
    streak: '<rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M4 9.5h16M8.5 3.5v3.5M15.5 3.5v3.5"/><path d="m7.5 14 1.3 1.3 2-2.3M13.2 14l1.3 1.3 2-2.3"/>',
    kinds: '<path d="M9.5 4.5h5v2c0 1-.8 1.5-.8 2.4 0 1.1 4.3 2.4 4.3 6.6 0 3-2.7 4.5-6 4.5s-6-1.5-6-4.5c0-4.2 4.3-5.5 4.3-6.6 0-.9-.8-1.4-.8-2.4z"/><path d="M7 14h10"/>',
    club: '<circle cx="9" cy="12" r="5"/><circle cx="15" cy="12" r="5"/>',
    pot: '<path d="M8.5 5h7v1.8c0 1-.9 1.5-.9 2.4 0 1 5.4 2.6 5.4 7.3 0 3.1-3.6 4.5-8 4.5s-8-1.4-8-4.5c0-4.7 5.4-6.3 5.4-7.3 0-.9-.9-1.4-.9-2.4z"/><circle cx="10" cy="15" r=".6" fill="currentColor"/><circle cx="14" cy="15" r=".6" fill="currentColor"/>',
    door: '<path d="M6 20V4.5h9V20"/><path d="M15 6.5l3 1v12l-3 .5"/><circle cx="12.5" cy="12.5" r=".7" fill="currentColor"/><path d="M4 20h16"/>',
    regulars: '<path d="M4.5 9h7v5a3.5 3.5 0 0 1-7 0z"/><path d="M11.5 10.5h1a1.6 1.6 0 0 1 0 3.2h-1"/><path d="M13 13h6.5v3.5a3.2 3.2 0 0 1-6.4 0"/><path d="M7 6.5c0-1 1-1 1-2M17 10.5c0-1 1-1 1-2"/>',
    lock: '<rect x="5.5" y="10.5" width="13" height="9" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  };
  const icon = (n, size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || P.pot}</svg>`;
  const WIDE = new Set(["kinds", "streak", "hostStreak"]);
  const tile = (s, o) => { const wide = WIDE.has(s.key) || (s.detail && String(s.detail).length > 26);
    const num = s.value != null ? `<b class="pls-v">${esc(s.value)}</b>` : `<b class="pls-n">${esc(String(s.n))}${s.pct ? "%" : ""}</b>`;
    const on = (o.show || []).includes(s.key);
    return `<li class="pls-t${wide ? " wide" : ""}" data-k="${esc(s.key)}"><span class="pls-i">${icon(s.icon)}</span><span class="pls-b">${s.key === "streak" || s.key === "hostStreak" ? `<b class="pls-v">${esc(s.line)}</b>` : `${num}<span class="pls-l">${esc(s.label)}</span>`}${s.detail ? `<small>${esc(s.detail)}</small>` : ""}</span>
      ${o.edit ? `<label class="pls-sw"><input type="checkbox" data-show="${esc(s.key)}"${on ? " checked" : ""}><span>On my page</span></label>` : ""}</li>`; };
  function card(list = [], o = {}) { if (!list.length) return o.empty || "";
    return `<section class="pls-card${o.compact ? " compact" : ""}" aria-label="${esc(o.title || "Stats")}">${o.title ? `<h2 class="pls-h">${esc(o.title)}</h2>` : ""}<ul class="pls-grid">${list.map((s) => tile(s, o)).join("")}</ul></section>`; }
  const CSS = `
.pls-card{background:var(--pl-surface);border:1px solid var(--pl-line);border-radius:var(--pl-r-lg);padding:18px 16px 16px;color:var(--pl-ink);font-family:var(--sys-sans)}
.pls-h{margin:0 0 12px;font:400 20px/1.2 var(--sys-display);letter-spacing:-.015em}
.pls-grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.pls-t{display:grid;grid-template-columns:36px minmax(0,1fr);gap:10px;align-items:start;padding:12px;border-radius:var(--pl-r-md);background:var(--pl-page);min-width:0}
.pls-t.wide{grid-column:1/-1}
.pls-i{width:36px;height:36px;border-radius:50%;background:var(--pl-raised);display:grid;place-items:center;color:var(--pl-frame)}
.pls-b{display:grid;gap:1px;min-width:0}
.pls-n{font:400 28px/1 var(--sys-display);letter-spacing:-.015em;margin-top:2px}
.pls-v{font:400 19px/1.25 var(--sys-display);letter-spacing:-.01em;overflow-wrap:anywhere;margin-top:4px}
.pls-l{font-size:13px;line-height:1.3;color:var(--pl-soft)}
.pls-b small{font-size:13px;color:var(--pl-muted);line-height:1.35;overflow-wrap:anywhere}
.pls-sw{grid-column:1/-1;display:flex;align-items:center;gap:8px;min-height:36px;margin-top:2px;font-size:13px;color:var(--pl-soft);cursor:pointer}
.pls-sw input{width:18px;height:18px;margin:0;accent-color:var(--pl-ink)}
.pls-card.compact{padding:16px 14px 14px}.pls-card.compact .pls-n{font-size:24px}
@media (min-width:700px){.pls-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.pls-card.compact .pls-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}`;
  function css() { if (document.getElementById("plsCss")) return; const s = document.createElement("style"); s.id = "plsCss"; s.textContent = CSS; document.head.appendChild(s); }
  css();
  window.PLStats = { card, icon, css, ICONS: Object.keys(P) };

  // ---- on a page (/@handle): only what the owner picked to show ----
  const m = location.pathname.match(/^\/@([a-z0-9][a-z0-9-]{1,29})\/?$/i);
  if (m) { (async () => { let L = []; try { L = (await (await fetch(`/api/public/host/${encodeURIComponent(m[1].toLowerCase())}/stats`)).json()).stats || []; } catch {} if (!L.length) return;
    let n = 0; const put = () => { const side = document.getElementById("sideExtras"); if (!side) { if (++n < 40) setTimeout(put, 250); return; } if (document.getElementById("plsPub")) return;
      const w = document.createElement("div"); w.id = "plsPub"; w.style.marginBottom = "12px"; w.innerHTML = card(L, { title: "So far", compact: true }); side.prepend(w); };
    put(); })(); }
})();
