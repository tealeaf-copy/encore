// The calm loader: one quiet line ("Setting the table…") and a small pot turning on a wheel, for the moment a page is
// waiting on its data. Shared by every main surface (feed, host page, event page and invite, chats, Discover, settings,
// collections, guides, your stats).
//
//   Rules it keeps:
//   - Nothing shows for the first 300ms (DELAY), so a fast load never flashes. A load that lasts longer gets the line
//     and the wheel; when the content lands the loader fades out softly (FADE) over it instead of blinking away.
//   - People who ask their device for less motion get a still frame: the same pot and line, nothing turning.
//   - It never blocks: no overlay over the whole page, no spinner, no progress bar. After 12 seconds the line changes
//     to "Still working on it…", nothing more.
//
//   Two ways in, both small enough to merge cleanly:
//   1. Markup. Put data-calm="feed" (or events, invite, chats, discover, settings, host, people, collection, guide,
//      stats) on the container the page fills in. While it is empty, or still holds an element marked data-calm-wait
//      (the old "Loading…" line), it counts as waiting. The old line is hidden as soon as this file runs.
//   2. Script. const h = PLCalm.show(el, "events"); … h.done();  or  PLCalm.around(promise, el, "events").
//
// It also turns on soft page-to-page fades with the View Transitions API where the browser has it (public/craft.css
// holds the @view-transition rule; this adds the same-document fallback for pages that swap views in place).
(function () {
  if (typeof window === "undefined" || window.PLCalm) return;
  const DELAY = 300, FADE = 320, SLOW = 12000;
  // short, warm, one per surface. Plain words, no exclamation marks (docs/brand-kit.md)
  const LINES = {
    events: "Setting the table…", event: "Setting the table…", invite: "Opening the invite…", feed: "Warming up the feed…",
    people: "Finding your people…", discover: "Finding your people…", host: "Opening their page…", chats: "Catching up on the chat…",
    settings: "Getting your settings…", collection: "Filling the shelf…", guide: "Laying out the steps…", stats: "Counting your nights out…",
    plans: "Checking your plans…", saved: "Finding what you saved…", default: "One moment…",
  };
  const lineOf = (kind) => LINES[String(kind || "").toLowerCase()] || LINES.default;
  const still = () => { try { return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // the drawing: a small clay pot (the wordmark's line pot) on a wheel. The glaze band slides under a clip so the pot reads
  // as turning, the wheel's dashes run round, and three clay dots rise and settle in turn. Ink lines at 1.75, clay fill.
  const ART = `<svg class="plc-art" viewBox="0 0 96 72" width="96" height="72" aria-hidden="true" focusable="false">
<defs><clipPath id="plcPot"><path d="M38 14h20v4c0 3-2 4-2 7 0 3 14 7 14 21 0 11-10 16-22 16s-22-5-22-16c0-14 14-18 14-21 0-3-2-4-2-7z"/></clipPath></defs>
<ellipse class="plc-wheel" cx="48" cy="64" rx="34" ry="5.5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-dasharray="7 5" stroke-linecap="round"/>
<path d="M38 14h20v4c0 3-2 4-2 7 0 3 14 7 14 21 0 11-10 16-22 16s-22-5-22-16c0-14 14-18 14-21 0-3-2-4-2-7z" fill="var(--pl-sand-soft,#F0E9DA)"/>
<g clip-path="url(#plcPot)"><g class="plc-glaze"><rect x="0" y="38" width="140" height="9" fill="var(--pl-accent-soft,#F1E1D8)"/>${Array.from({ length: 14 }, (_, i) => `<path d="M${i * 10 - 4} 47l6-9" stroke="var(--pl-accent,#9A4128)" stroke-width="2" stroke-linecap="round" opacity=".55"/>`).join("")}</g></g>
<path d="M38 14h20v4c0 3-2 4-2 7 0 3 14 7 14 21 0 11-10 16-22 16s-22-5-22-16c0-14 14-18 14-21 0-3-2-4-2-7z" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/>
<path d="M36 14h24" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
<circle cx="44" cy="53" r="1.3" fill="currentColor"/><circle cx="52" cy="53" r="1.3" fill="currentColor"/><path d="M46.4 56.2c1 .7 2.2 .7 3.2 0" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
<circle class="plc-d plc-d1" cx="80" cy="30" r="2.4" fill="var(--pl-accent,#9A4128)"/><circle class="plc-d plc-d2" cx="86" cy="30" r="2.4" fill="var(--pl-accent,#9A4128)"/><circle class="plc-d plc-d3" cx="92" cy="30" r="2.4" fill="var(--pl-accent,#9A4128)"/>
</svg>`;
  /** The loader's markup for one kind of wait (a still frame until the CSS animates it). */
  const html = (kind) => `<div class="plc" role="status" aria-live="polite" data-calm-loader="${esc(String(kind || "default"))}">${ART}<p class="plc-line">${esc(lineOf(kind))}</p></div>`;

  const CSS = `
.plc{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;min-height:min(46vh,360px);padding:32px 16px;box-sizing:border-box;color:var(--pl-ink,#1D1B18);text-align:center;opacity:0;transition:opacity ${FADE}ms ease}
.plc.on{opacity:1}
.plc-art{display:block;color:var(--pl-ink,#1D1B18);overflow:visible}
.plc-line{margin:0;font:400 20px/1.3 var(--sys-title,var(--pl-font-text,Georgia,serif));letter-spacing:-.015em;color:var(--pl-soft,#5D564E);max-width:28ch}
.plc .plc-glaze{animation:plc-turn 2.8s linear infinite}
.plc .plc-wheel{animation:plc-wheel 2.8s linear infinite}
.plc .plc-d{transform-box:fill-box;transform-origin:center;animation:plc-rise 2.1s ease-in-out infinite}
.plc .plc-d2{animation-delay:.25s}.plc .plc-d3{animation-delay:.5s}
.plc-fade{position:absolute;z-index:5;pointer-events:none;background:var(--pl-page,#F4F0E8);opacity:1;transition:opacity ${FADE}ms ease}
[data-calm] [data-calm-wait]{display:none!important}
@keyframes plc-turn{from{transform:translateX(0)}to{transform:translateX(-40px)}}
@keyframes plc-wheel{to{stroke-dashoffset:-48}}
@keyframes plc-rise{0%,100%{transform:translateY(0);opacity:.35}35%{transform:translateY(-5px);opacity:1}70%{transform:translateY(0);opacity:.7}}
@media (prefers-reduced-motion:reduce){.plc,.plc-fade{transition:none}.plc *{animation:none!important}.plc .plc-d{opacity:.7}}
/* same-document view changes (pages that swap views in place) fade, softly and briefly */
::view-transition-old(root),::view-transition-new(root){animation-duration:.15s;animation-timing-function:ease}
@media (prefers-reduced-motion:reduce){::view-transition-old(root),::view-transition-new(root){animation:none}}`;
  function css() { if (document.getElementById("plCalmCss")) return; const s = document.createElement("style"); s.id = "plCalmCss"; s.textContent = CSS; (document.head || document.documentElement).appendChild(s); }

  /** Show the loader in `el` if the wait lasts longer than DELAY. since: when the wait started (performance.now() time). */
  function show(el, kind = "default", { delay = DELAY, since = null } = {}) {
    if (!el) return { done() {}, shown: () => false };
    css(); let node = null, timer = 0, slow = 0, ended = false;
    const start = since == null ? performance.now() : since, wait = Math.max(0, delay - (performance.now() - start));
    const put = () => { if (ended || !el.isConnected) return; node = document.createElement("div"); node.innerHTML = html(kind); node = node.firstElementChild; el.appendChild(node);
      // one frame later, so the fade-in runs (a still frame shows at once)
      if (still()) node.classList.add("on"); else requestAnimationFrame(() => requestAnimationFrame(() => node && node.classList.add("on")));
      slow = setTimeout(() => { const p = node?.querySelector(".plc-line"); if (p) p.textContent = "Still working on it…"; }, SLOW); };
    timer = setTimeout(put, wait);
    return {
      shown: () => !!node,
      done() { if (ended) return; ended = true; clearTimeout(timer); clearTimeout(slow); if (!node) return;
        const n = node; node = null; const r = n.isConnected ? n.getBoundingClientRect() : n.__rect; n.remove();
        // the content is in: the loader lifts off where it was and fades over it (the page may already have wiped it)
        if (!still()) fadeOver(r, n); },
      _node: () => node,
    };
  }
  // a soft reveal: the loader on a page-coloured sheet where it was, fading out over the new content
  function fadeOver(r, n) { if (!r || r.width < 2 || r.height < 2) return; const f = document.createElement("div"); f.className = "plc-fade";
    Object.assign(f.style, { left: r.left + scrollX + "px", top: r.top + scrollY + "px", width: r.width + "px", height: Math.min(r.height, innerHeight) + "px" });
    if (n) { n.style.minHeight = "100%"; f.appendChild(n); } document.body.appendChild(f);
    requestAnimationFrame(() => requestAnimationFrame(() => { f.style.opacity = "0"; })); setTimeout(() => f.remove(), FADE + 60); }
  /** Wait on a promise with the loader in `el`; resolves with the promise's value. */
  async function around(p, el, kind) { const h = show(el, kind); try { return await p; } finally { h.done(); } }

  // ---- markup: [data-calm] containers ----
  const OURS = (n) => n.nodeType === 1 && (n.classList?.contains("plc") || n.classList?.contains("plc-fade"));
  const hasContent = (el) => [...el.childNodes].some((n) => (n.nodeType === 1 && !OURS(n) && !n.hasAttribute("data-calm-wait") && !/^(SCRIPT|STYLE|TEMPLATE)$/.test(n.tagName)) || (n.nodeType === 3 && n.textContent.trim()));
  // waiting: still holds a wait marker; or, for a container that started with no marker, empty and never filled yet
  const waiting = (el) => !!el.querySelector("[data-calm-wait]") || (!el.__calmMarked && !el.__calmHad && !hasContent(el));
  function watch(el) {
    if (el.__calm) return; css(); const S = { h: null }; el.__calm = S; el.__calmMarked = !!el.querySelector("[data-calm-wait]");
    const check = (first) => { const w = waiting(el); if (!w) el.__calmHad = true;
      if (w && !S.h) S.h = show(el, el.dataset.calm, { since: first ? 0 : null });
      else if (!w && S.h) { const n = S.h._node(); if (n && !n.__rect) n.__rect = el.getBoundingClientRect(); S.h.done(); S.h = null; } };
    // the loader's own node coming and going is not the page's content changing
    const mo = new MutationObserver((M) => { if (M.every((m) => [...m.addedNodes, ...m.removedNodes].every(OURS) && m.type === "childList")) return; const n = S.h?._node?.(); if (n && !n.isConnected) n.__rect = n.__rect || el.getBoundingClientRect(); check(false); });
    // remember where the loader sits, so a page that wipes it with innerHTML still gets the soft reveal
    const keep = () => { const n = S.h?._node?.(); if (n && n.isConnected) n.__rect = n.getBoundingClientRect(); if (S.h) requestAnimationFrame(keep); };
    mo.observe(el, { childList: true, subtree: true, characterData: false });
    check(true); if (S.h) requestAnimationFrame(keep);
  }
  function scan(root = document) { try { root.querySelectorAll?.("[data-calm]").forEach(watch); } catch {} }
  css();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => scan()); else scan();
  // containers a page adds later
  try { new MutationObserver((M) => { for (const m of M) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.hasAttribute?.("data-calm")) watch(n); else if (n.querySelector?.("[data-calm]")) scan(n); } }).observe(document.documentElement, { childList: true, subtree: true }); } catch {}

  /** Change a view in place with a soft fade where the browser supports it; otherwise just change it. Never waits. */
  // a transition the browser skips (a hidden tab, another one already running, a page mid-navigation) rejects its
  // promises: those are caught here, so a skipped fade is never an error (the change itself still happens)
  function swap(fn) { try { if (document.startViewTransition && !still() && !document.hidden) { const t = document.startViewTransition(fn); for (const k of ["ready", "finished", "updateCallbackDone"]) t?.[k]?.catch?.(() => {}); return t; } } catch {} fn(); return null; }

  window.PLCalm = { DELAY, FADE, LINES, lineOf, html, show, around, watch, scan, swap, still };
})();
