// Shared pieces for Paid Insights (server/paidinsights.js): Market Insights (/teams/market), Host Insights
// (/host/insights) and the admin list. One bar chart and its table view, stat tiles, and the "Not enough yet" state.
//
// Chart rules (the dataviz skill): one series, one colour (#3D5DB3, checked with its validator against the light
// surface), one axis that starts at zero, thin bars with 4px rounded ends, a 2px gap between bars, a direct value label
// on each bar in text ink (never the bar colour), a per-bar tooltip, and a table view of the same rows. Rising and
// falling use #3D5DB3 and #C0642F (validated as a pair) and always carry the words "Rising" and "Falling" as well.
// Field Notes kit: --pl-* tokens, IBM Plex, 6px corners, 44px targets, light only. No emoji.
//
//   PLIns.css()                          add the styles once
//   PLIns.fmt(metric, v)                 "82%", "$35", "12"
//   PLIns.chart(rows, metric, { id })    bars plus a Chart | Table switch; rows: [{ label, enough, basis, ...metrics }]
//   PLIns.tiles(cell, metrics)           stat tiles for one cell, each with what it's based on
//   PLIns.wire(root)                     the Chart | Table switches inside root
(function () {
  if (window.PLIns) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const NAMES = { fillPct: "Fill rate", waitlistPct: "Events with a waitlist", againPct: "Would go again", repeatPct: "Repeat guests", priceCents: "Typical price", hosts: "Hosts", events: "Events", guests: "Guests", fillDays: "Days to fill", pct: "Share" };
  const money = (c) => (c == null ? "" : c === 0 ? "Free" : "$" + (c % 100 ? (c / 100).toFixed(2) : c / 100));
  function fmt(m, v) { if (v == null || v === "") return "Not enough yet"; if (m === "priceCents") return money(v); if (m === "fillDays") return `${v} ${v === 1 ? "day" : "days"}`; return /Pct$|^pct$/.test(m) ? `${v}%` : String(v); }
  function css() { if (document.getElementById("plInsCss")) return; const s = document.createElement("style"); s.id = "plInsCss"; s.textContent = `
.pli{--pli-bar:#3D5DB3;--pli-down:#C0642F;color:var(--pl-ink,#1B1D1C);font-family:var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif)}
.pli-sw{display:inline-flex;border:1px solid var(--pl-line-strong,#1B1D1C);border-radius:6px;overflow:hidden;margin:0 0 8px}
.pli-sw button{min-height:44px;min-width:72px;padding:0 14px;border:0;background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);font:600 14px var(--pl-font-text,"IBM Plex Sans",sans-serif);cursor:pointer}
.pli-sw button[aria-pressed=true]{background:var(--pl-accent,#29489A);color:var(--pl-on-accent,#fff)}
.pli-sw button:focus-visible,.pli a:focus-visible,.pli button:focus-visible,.pli select:focus-visible{outline:2px solid var(--pl-accent,#29489A);outline-offset:2px}
.pli-bars{list-style:none;margin:0;padding:0;display:grid;gap:2px}
.pli-bars li,.pli-axis{display:grid;grid-template-columns:minmax(0,40%) minmax(0,1fr) 8ch;gap:4px 10px;align-items:center}.pli-bars li{min-height:44px;padding:4px 0}
.pli-bars .l{font-size:14px;line-height:1.3;overflow-wrap:anywhere}.pli-bars .l small{display:block;color:var(--pl-soft,#444845);font:400 12px/1.4 var(--pl-font-mono,"IBM Plex Mono",monospace)}
.pli-bars .tr{min-width:0;border-left:1px solid var(--pl-line,#CFC8B9)}
.pli-bars .b{display:block;height:12px;background:var(--pli-bar);border-radius:0 4px 4px 0;min-width:2px}
.pli-bars .v{font:600 14px var(--pl-font-text,"IBM Plex Sans",sans-serif);white-space:nowrap}
.pli-bars li.na .v{grid-column:2 / 4;font-weight:400;color:var(--pl-soft,#444845)}
.pli-axis{margin:4px 0 0;font:400 12px var(--pl-font-mono,"IBM Plex Mono",monospace);color:var(--pl-soft,#444845)}.pli-axis .ax{display:flex;justify-content:space-between;border-top:1px solid var(--pl-line,#CFC8B9);padding-top:2px}
.pli-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%}
.pli-table{border-collapse:collapse;width:100%;font-size:14px;min-width:560px}
.pli-table th,.pli-table td{text-align:right;padding:8px 6px;border-bottom:1px solid var(--pl-line,#CFC8B9);vertical-align:top}
.pli-table th:first-child,.pli-table td:first-child{text-align:left}
.pli-table th{font:600 12px/1.3 var(--pl-font-text,"IBM Plex Sans",sans-serif);color:var(--pl-soft,#444845)}
.pli-table td.na{color:var(--pl-soft,#444845)}
.pli-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0 0 12px}
@media (min-width:760px){.pli-tiles{grid-template-columns:repeat(4,minmax(0,1fr))}}
.pli-tile{border:1px solid var(--pl-line,#CFC8B9);border-radius:6px;background:var(--pl-surface,#FAF8F3);padding:10px 12px;min-width:0}
.pli-tile span{display:block;font-size:13px;color:var(--pl-soft,#444845)}.pli-tile b{display:block;font:600 22px/1.2 var(--pl-font-text,"IBM Plex Sans",sans-serif);margin:2px 0}
.pli-tile b.na{font:500 15px/1.3 var(--pl-font-text,"IBM Plex Sans",sans-serif);color:var(--pl-soft,#444845);margin:6px 0}
.pli-tile small{display:block;font:400 12px/1.35 var(--pl-font-mono,"IBM Plex Mono",monospace);color:var(--pl-soft,#444845)}
.pli-basis{margin:6px 0 0;font:400 12px/1.4 var(--pl-font-mono,"IBM Plex Mono",monospace);color:var(--pl-soft,#444845)}
.pli-na{margin:0;padding:12px;border:1px dashed var(--pl-line,#CFC8B9);border-radius:6px;color:var(--pl-soft,#444845);font-size:14px}
.pli-move{--pli-bar:#3D5DB3;--pli-down:#C0642F;list-style:none;margin:0;padding:0}.pli-move li{display:flex;gap:10px;align-items:baseline;padding:8px 0;border-top:1px dashed var(--pl-line,#CFC8B9)}.pli-move li:first-child{border-top:0}
.pli-move .tag{flex:none;font:600 12px var(--pl-font-mono,"IBM Plex Mono",monospace);padding:2px 6px;border-radius:6px;border:1px solid currentColor}
.pli-move .up{color:#2E4A92}.pli-move .down{color:#9A4A1E}
.pli-move .mk{flex:none;width:10px;height:10px;border-radius:2px;display:inline-block}.pli-move .mk.up{background:var(--pli-bar)}.pli-move .mk.down{background:var(--pli-down)}
.pli-ex{display:inline-block;font:600 12px var(--pl-font-mono,"IBM Plex Mono",monospace);letter-spacing:.06em;text-transform:uppercase;border:1px solid var(--pl-line-strong,#1B1D1C);border-radius:6px;padding:2px 8px;background:var(--pl-sand-soft,#F7EFCB)}
`; document.head.appendChild(s); }
  /** A breakdown as bars (one axis from zero) and the same rows as a table. */
  function chart(rows, metric, { id = "pli" + Math.random().toString(36).slice(2, 7), cols = ["events", "hosts", "guests", "fillPct", "waitlistPct", "againPct", "repeatPct", "priceCents"], view = "chart", caption = "" } = {}) {
    const vals = rows.filter((r) => r.enough !== false && r[metric] != null).map((r) => +r[metric]), pctM = /Pct$|^pct$/.test(metric), max = pctM ? 100 : Math.max(1, ...vals);
    const bars = `<ol class="pli-bars" aria-label="${esc(caption || NAMES[metric] || metric)}">${rows.map((r) => { const ok = r.enough !== false && r[metric] != null, v = ok ? +r[metric] : 0, w = ok ? Math.max(1, Math.round((v / max) * 100)) : 0;
      const tip = `${r.label}: ${ok ? fmt(metric, v) : "Not enough yet"}. ${r.basis || ""}`;
      return `<li class="${ok ? "" : "na"}" title="${esc(tip)}"><span class="l">${esc(r.label)}${r.basis ? `<small>${esc(r.basis)}</small>` : ""}</span>${ok ? `<span class="tr"><i class="b" style="width:${w}%" aria-hidden="true"></i></span>` : ""}<span class="v">${esc(ok ? fmt(metric, v) : "Not enough yet")}</span></li>`; }).join("")}</ol>
      <div class="pli-axis" aria-hidden="true"><span></span><span class="ax"><span>0</span><span>${esc(fmt(metric, pctM ? 100 : Math.round(max)))}</span></span><span></span></div>`;
    const table = `<div class="pli-scroll"><table class="pli-table"><caption class="pli-basis" style="text-align:left;caption-side:bottom">${esc(caption)}</caption><thead><tr><th scope="col">${esc(rows.byLabel || "")}</th>${cols.map((c) => `<th scope="col">${esc(NAMES[c] || c)}</th>`).join("")}<th scope="col">Based on</th></tr></thead><tbody>${rows.map((r) => (r.enough === false ? `<tr><th scope="row" style="text-align:left;font-weight:500">${esc(r.label)}</th>${cols.map(() => `<td class="na">-</td>`).join("")}<td class="na">Not enough yet</td></tr>` : `<tr><th scope="row" style="text-align:left;font-weight:500">${esc(r.label)}</th>${cols.map((c) => `<td>${r[c] == null ? "-" : esc(fmt(c, r[c]))}</td>`).join("")}<td>${esc(r.basis || "")}</td></tr>`)).join("")}</tbody></table></div>`;
    return `<div class="pli" data-pli="${esc(id)}"><div class="pli-sw" role="group" aria-label="Show as"><button type="button" data-pli-v="chart" aria-pressed="${view === "chart"}">Chart</button><button type="button" data-pli-v="table" aria-pressed="${view === "table"}">Table</button></div>
      <div data-pli-p="chart"${view === "chart" ? "" : " hidden"}>${bars}</div><div data-pli-p="table"${view === "table" ? "" : " hidden"}>${table}</div></div>`;
  }
  function wire(root) { (root || document).querySelectorAll(".pli[data-pli]").forEach((el) => el.querySelectorAll("[data-pli-v]").forEach((b) => (b.onclick = () => {
    el.querySelectorAll("[data-pli-v]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); el.querySelectorAll("[data-pli-p]").forEach((p) => (p.hidden = p.dataset.pliP !== b.dataset.pliV)); try { localStorage.setItem("pli.view", b.dataset.pliV); } catch {} }))); }
  const savedView = () => { try { return localStorage.getItem("pli.view") === "table" ? "table" : "chart"; } catch { return "chart"; } };
  function tiles(c, metrics = ["fillPct", "waitlistPct", "againPct", "repeatPct", "priceCents", "fillDays", "hosts", "events"]) {
    if (!c || c.enough === false) return `<p class="pli-na">Not enough yet. ${esc(c?.basis || "")}</p>`;
    return `<div class="pli-tiles">${metrics.map((m) => `<div class="pli-tile"><span>${esc(NAMES[m])}</span><b${c[m] == null ? ' class="na"' : ""}>${esc(fmt(m, c[m]))}</b><small>${esc(c.basis || "")}</small></div>`).join("")}</div>`; }
  window.PLIns = { esc, css, fmt, chart, wire, tiles, money, NAMES, savedView };
})();
