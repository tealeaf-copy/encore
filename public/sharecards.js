// PLShareCards: post-ready cards in the page, drawn from the same card spec the server turns into a PNG
// (server/sharecards.js), so what you see is what you save. The year in nights uses it (public/yearreview.js), and so
// can anything else with a card to share (the January hosting wishlist): pass a spec, get the card.
//
//   PLShareCards.html(spec, { size: "story" | "link", photo, photoNote })   the card's HTML (escaped)
//   PLShareCards.mapSvg(map, { w, h, pick })                                the hand-drawn map, as SVG
//   PLShareCards.actions({ png, name, link, title })                        Save and Share buttons' HTML
//   PLShareCards.wire(root)                                                 makes those buttons work
//   PLShareCards.css()                                                      adds the styles once
// A spec: { tone, kicker, title, sub, body, quote: { text, by }, stats: [{ n, label }], list: [{ k, v }], art, potto,
//           map: { areas: [{ key, x, y, r, n, label }], lines: [[x, y, ...]], river }, foot, big }
(function () {
  if (window.PLShareCards) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const TONES = { linen: "#EFEBE2", butter: "#ECE3C2", blush: "#EBDDD2", sky: "#DCE1EC", mint: "#DFE3D3", lilac: "#E2E0E8", peach: "#EDE2D0", sand: "#D9D2C2" };
  const ART_OK = /^[a-z]{2,20}$/, POTTO_OK = /^(wave|cheer|think|carry)$/;
  const MARK = `<svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="1.5" width="45" height="45" rx="6"/><path d="M17 11h14M19 11v4l-6 6v9a7 7 0 0 0 7 7h8a7 7 0 0 0 7-7v-9l-6-6v-4"/><circle cx="20.5" cy="26" r="1.9" fill="#29489A" stroke="none"/><circle cx="27.5" cy="26" r="1.9" fill="#29489A" stroke="none"/></svg>`;

  /** The hand-drawn map: streets and a river as soft pencil lines, each neighbourhood a dashed area with a count. */
  function mapSvg(map, o = {}) { const W = o.w || 100, H = o.h || 100, pad = o.pad ?? 5, X = (v) => (pad + v * (W - pad * 2)).toFixed(2), Y = (v) => (pad + v * (H - pad * 2)).toFixed(2), M = map || {};
    const lines = (M.lines || []).map((l, i) => { const d = l.reduce((s, v, j) => s + (j % 2 ? Y(v) + " " : (j ? "L" : "M") + X(v) + " "), ""); return `<path d="${d}" fill="none" stroke="${i === 0 && M.river ? "#CDD6D6" : "#CFC8B9"}" stroke-width="${i === 0 && M.river ? 2.4 : i < 3 ? 0.7 : 0.5}" stroke-linecap="round" stroke-linejoin="round"/>`; }).join("");
    const areas = (M.areas || []).map((a) => { const r = Math.max(o.minR || 3.2, a.r * W), cx = X(a.x), cy = Y(a.y), tag = o.pick ? ` data-area="${esc(a.key)}" tabindex="0" role="button" aria-label="${esc(`${a.label || "An area"}: ${a.n} ${a.n === 1 ? "night" : "nights"}`)}"` : "";
      return `<g class="plsc-area"${tag}><circle cx="${cx}" cy="${cy}" r="${r.toFixed(2)}" fill="#E3E8F4" stroke="#1B1D1C" stroke-width=".45" stroke-dasharray="1.2 1"/><circle cx="${cx}" cy="${cy}" r="${Math.max(1.8, r * 0.42).toFixed(2)}" fill="var(--plsc-accent,#29489A)" stroke="#1B1D1C" stroke-width=".45"/>${a.n > 1 ? `<text x="${cx}" y="${(+cy + 1).toFixed(2)}" text-anchor="middle" font-size="${Math.max(2.4, r * 0.5).toFixed(2)}" font-weight="600" fill="#FAF8F3" font-family="var(--pl-font-text, sans-serif)">${a.n}</text>` : ""}</g>`; }).join("");
    const labels = o.labels === false ? "" : (M.areas || []).filter((a) => a.label).slice(0, o.maxLabels || 5).map((a) => { const r = Math.max(o.minR || 3.2, a.r * W), fs = o.labelSize || 3.4, w = String(a.label).length * fs * 0.56 + 2.6, x = Math.min(Math.max(1, +X(a.x) - w / 2), W - 1 - w), y = Math.min(+Y(a.y) + r + 1.2, H - fs - 2.4);
      return `<g aria-hidden="true"><rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${(fs + 2).toFixed(2)}" rx="1" fill="#FAF8F3" stroke="#1B1D1C" stroke-width=".35"/><text x="${(x + 1.3).toFixed(2)}" y="${(y + fs + 0.4).toFixed(2)}" font-size="${fs}" font-weight="600" fill="#1B1D1C" font-family="var(--pl-font-text, sans-serif)">${esc(a.label)}</text></g>`; }).join("");
    return `<svg class="plsc-map" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(o.label || "A hand-drawn map of your places")}">${lines}${areas}${labels}</svg>`; }

  const img = (src, alt = "") => `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async">`;
  /** One card, in the page. Text comes only from the spec, escaped. */
  function html(spec = {}, o = {}) { const s = spec || {}, size = o.size === "link" ? "link" : "story", tone = TONES[s.tone] ? s.tone : "linen";
    const vis = o.photo ? `<figure class="plsc-photo">${img(o.photo, "")}${o.photoNote ? `<figcaption>${esc(o.photoNote)}</figcaption>` : ""}</figure>`
      : s.map ? `<div class="plsc-mapbox">${mapSvg(s.map, { w: 100, h: size === "link" ? 92 : 88 })}</div>` : s.art && ART_OK.test(s.art) ? `<div class="plsc-art">${img(`/og/kit/art-${s.art}.png`, "")}</div>` : "";
    const stats = (s.stats || []).length ? `<ul class="plsc-stats">${s.stats.slice(0, 6).map((x) => `<li><b>${esc(x.n)}</b><span>${esc(x.label)}</span></li>`).join("")}</ul>` : "";
    const quote = s.quote?.text ? `<blockquote class="plsc-quote"><p>“${esc(s.quote.text)}”</p>${s.quote.by ? `<cite>${esc(s.quote.by)}</cite>` : ""}</blockquote>` : "";
    const list = (s.list || []).length ? `<dl class="plsc-list">${s.list.slice(0, 5).map((x) => `<div><dt>${esc(x.k)}</dt><dd>${esc(x.v)}</dd></div>`).join("")}</dl>` : "";
    const potto = s.potto && POTTO_OK.test(s.potto) ? `<span class="plsc-potto">${img(`/og/kit/potto-${s.potto}.png`, "")}</span>` : "";
    return `<article class="plsc plsc--${size}${s.big ? " is-big" : ""}" style="--plsc-bg:${TONES[tone]}">
      <header class="plsc-top"><span class="plsc-mark">${MARK}</span><span class="plsc-word">pottery lab</span></header>
      <div class="plsc-body">${s.kicker ? `<p class="plsc-kick">${esc(s.kicker)}</p>` : ""}${s.title ? `<h2 class="plsc-title">${esc(s.title)}</h2>` : ""}${s.sub ? `<p class="plsc-sub">${esc(s.sub)}</p>` : ""}
        ${stats}${vis}${quote}${s.body ? `<p class="plsc-text">${esc(s.body)}</p>` : ""}${list}</div>
      ${potto}<footer class="plsc-foot"><span>${esc(s.foot || "pottery lab")}</span>${size === "story" ? "<span>Free on web and phone</span>" : ""}</footer></article>`; }

  const ICON = { save: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5v9M6 9l4 4 4-4M4 16.5h12"/></svg>',
    share: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 12.5V3.5M6.5 7 10 3.5 13.5 7M5 10.5v5.5h10v-5.5"/></svg>' };
  /** Save (the PNG) and Share (the PNG as a file where the phone allows it, else the link). */
  function actions({ png = "", name = "pottery-lab-card.png", link = "", title = "" } = {}) {
    return `<div class="plsc-acts"><a class="plsc-btn" href="${esc(png)}" download="${esc(name)}" data-plsc-save>${ICON.save}<span>Save</span></a><button type="button" class="plsc-btn is-go" data-plsc-share data-png="${esc(png)}" data-name="${esc(name)}" data-link="${esc(link)}" data-title="${esc(title)}">${ICON.share}<span>Share</span></button><span class="plsc-said" role="status" aria-live="polite"></span></div>`; }
  function wire(root = document) { root.querySelectorAll("[data-plsc-share]").forEach((b) => { if (b.dataset.wired) return; b.dataset.wired = "1";
    b.addEventListener("click", async () => { const said = b.parentElement.querySelector(".plsc-said"), say = (t) => { if (said) said.textContent = t; };
      try { const r = await fetch(b.dataset.png, { credentials: "same-origin" }); if (!r.ok) throw new Error(); const f = new File([await r.blob()], b.dataset.name || "card.png", { type: "image/png" });
        if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: b.dataset.title || "Pottery Lab" }); return; }
        if (b.dataset.link && navigator.share) { await navigator.share({ title: b.dataset.title || "Pottery Lab", url: new URL(b.dataset.link, location.origin).href }); return; }
        if (b.dataset.link && navigator.clipboard) { await navigator.clipboard.writeText(new URL(b.dataset.link, location.origin).href); say("Link copied"); return; }
        const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); say("Saved. Post it anywhere.");
      } catch (e) { if (e && e.name === "AbortError") return; say("Couldn't share that one. Try Save."); } }); }); }

  const CSS = `
.plsc{--plsc-ink:var(--pl-ink,#1B1D1C);--plsc-soft:var(--pl-soft,#444845);position:relative;container-type:inline-size;display:flex;flex-direction:column;background:var(--plsc-bg);color:var(--plsc-ink);border:1.5px solid var(--plsc-ink);border-radius:var(--pl-r-md,6px);overflow:hidden;font-family:var(--pl-font-text,system-ui,sans-serif);box-sizing:border-box}
.plsc *{box-sizing:border-box}
.plsc--story{aspect-ratio:9/16;padding:7.8cqw 7.8cqw 0}
.plsc--link{aspect-ratio:1200/630;padding:4.6cqw}
.plsc-top{display:flex;align-items:center;gap:2cqw;flex:none}.plsc-mark{display:block;width:6cqw;height:6cqw;min-width:22px;min-height:22px}.plsc-mark svg{width:100%;height:100%}
.plsc-word{font-weight:600;font-size:max(16px,4.3cqw);letter-spacing:-.03em}
.plsc-body{flex:1;min-height:0;min-width:0;display:flex;flex-direction:column;gap:2.4cqw;padding-top:6cqw;overflow:hidden}
.plsc-kick{margin:0;font:500 max(13px,3.1cqw)/1.3 var(--pl-font-mono,ui-monospace,monospace);letter-spacing:.06em;text-transform:uppercase;color:var(--plsc-accent,var(--pl-accent-text,#29489A))}
.plsc-title{margin:0;font:600 clamp(24px,11.4cqw,124px)/1.04 var(--pl-font-display,system-ui,sans-serif);letter-spacing:-.02em;overflow-wrap:anywhere}
.plsc.is-big .plsc-title{font-size:clamp(24px,16cqw,180px)}
.plsc-sub{margin:0;font:600 max(17px,5.3cqw)/1.22 var(--pl-font-serif,Georgia,serif)}
.plsc-text{margin:0;font-size:max(16px,4.1cqw);line-height:1.35;padding-right:16cqw}
.plsc-mapbox,.plsc-art,.plsc-photo{flex:1 1 auto;min-height:24cqw;display:flex;align-items:center;justify-content:center;margin:0}
.plsc-mapbox{background:var(--pl-surface,#FAF8F3);border:1.5px solid var(--plsc-ink);border-radius:var(--pl-r-md,6px);overflow:hidden}
.plsc-mapbox svg{width:100%;height:100%;display:block}
.plsc-art img{max-width:80%;max-height:100%;object-fit:contain}
.plsc-photo{position:relative;border:1.5px solid var(--plsc-ink);border-radius:var(--pl-r-md,6px);overflow:hidden;background:var(--pl-raised,#E6E1D5)}
.plsc-photo img{width:100%;height:100%;object-fit:cover;display:block}.plsc-photo figcaption{position:absolute;left:2cqw;right:2cqw;bottom:2cqw;background:var(--pl-surface,#FAF8F3);border:1px solid var(--plsc-ink);border-radius:4px;padding:4px 8px;font-size:13px;line-height:1.3}
.plsc-stats{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:1.8cqw}
.plsc-stats{min-width:0}.plsc-stats li{background:var(--pl-surface,#FAF8F3);border:1.5px solid var(--plsc-ink);border-radius:var(--pl-r-md,6px);padding:2.4cqw;display:grid;gap:2px;min-width:0}
.plsc-stats b{font-weight:600;font-size:max(20px,7.4cqw);line-height:1;letter-spacing:-.015em;overflow-wrap:anywhere}.plsc-stats span{font-size:max(13px,3.2cqw);color:var(--plsc-soft);line-height:1.2}
.plsc-quote{margin:0;border-left:4px solid var(--plsc-accent,var(--pl-accent,#29489A));padding:0 0 0 3.6cqw}
.plsc-quote p{margin:0;font:600 max(17px,4.8cqw)/1.3 var(--pl-font-serif,Georgia,serif)}.plsc-quote cite{display:block;margin-top:1.4cqw;font-style:normal;font-size:max(14px,3.3cqw);color:var(--plsc-soft)}
.plsc-list{margin:0;display:grid}.plsc-list div{border-top:1.5px dashed var(--pl-line,#CFC8B9);padding:1.6cqw 0}
.plsc-list dt{font:500 max(12px,2.6cqw)/1.3 var(--pl-font-mono,ui-monospace,monospace);letter-spacing:.06em;text-transform:uppercase;color:var(--plsc-accent,var(--pl-accent-text,#29489A))}
.plsc-list dd{margin:0;font:600 max(16px,3.7cqw)/1.3 var(--pl-font-serif,Georgia,serif);overflow-wrap:anywhere}
.plsc-potto{position:absolute;right:6cqw;bottom:13cqw;width:19cqw;pointer-events:none}.plsc-potto img{width:100%;display:block}
.plsc-foot{flex:none;display:flex;justify-content:space-between;gap:8px;margin-top:3cqw;border-top:1.5px solid var(--plsc-ink);padding:3cqw 0 4.4cqw;font:500 max(11px,2.6cqw)/1.2 var(--pl-font-mono,ui-monospace,monospace);letter-spacing:.06em;text-transform:uppercase;color:var(--plsc-soft)}
.plsc--link .plsc-body{padding-top:3cqw}.plsc--link .plsc-title{font-size:clamp(24px,7.6cqw,92px)}
.plsc-acts{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.plsc-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:0 16px;border-radius:var(--pl-r-btn,6px);border:1.5px solid var(--pl-line-strong,#1B1D1C);background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);font:600 15px var(--pl-font-text,system-ui,sans-serif);text-decoration:none;cursor:pointer}
.plsc-btn.is-go{background:var(--pl-accent,#29489A);border-color:var(--pl-accent,#29489A);color:#fff}.plsc-btn:focus-visible{outline:3px solid var(--pl-accent,#29489A);outline-offset:2px}
.plsc-said{font-size:14px;color:var(--pl-soft,#444845)}
.plsc-area[role=button]{cursor:pointer}.plsc-area[role=button]:focus-visible circle:first-child{stroke:var(--pl-accent,#29489A);stroke-width:1}
@media (prefers-reduced-motion: reduce){.plsc,.plsc *{transition:none!important;animation:none!important}}`;
  function css() { if (document.getElementById("plscCss")) return; const s = document.createElement("style"); s.id = "plscCss"; s.textContent = CSS; document.head.appendChild(s); }
  if (typeof document !== "undefined" && document && document.head) css();
  window.PLShareCards = { html, mapSvg, actions, wire, css, TONES };
})();
