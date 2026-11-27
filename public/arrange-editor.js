// "Arrange your page": the host rearranges their own page by touch and drag (public/arrange.js loads this when they
// open it from Edit page). The page stays live; each section gets a soft outline, a grip and a small toolbar.
//   Drag: pointer events, not HTML5 drag (iOS has none). Mouse: press and move. Touch: long-press (250ms) anywhere on a
//   section, or the grip at once. Sections fold to cards while one is lifted, the others make room (FLIP), the page
//   scrolls near the edges, a short buzz where the phone has one, and the card settles where it lands.
//   No drag needed: Move up / Move down on every section (arrow keys on the grip too), and every move is said out loud
//   ("About moved to position 2 of 7").
//   Each section: a style (List, Cards, Carousel...), hide (to the Hidden tray), and the host's own blocks can be edited.
//   Undo and redo (Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z, Ctrl+Y), starters, Potto's suggestion, reset.
//   The draft saves as you go (server/pagelayout.js); Done puts it live for everyone.
// Reduced motion: no lift scale, no springs, moves are instant.
(function () {
  "use strict";
  const PLL = window.PLLayout, PA = window.PLArrange; if (!PLL || !PA) return;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)], esc = PLL.esc, de = document.documentElement;
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const buzz = (ms) => { try { navigator.vibrate?.(ms); } catch {} };
  const ic = (d, w = 20) => `<svg viewBox="0 0 20 20" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I = {
    grip: ic('<circle cx="7" cy="5" r="1.2" fill="currentColor"/><circle cx="13" cy="5" r="1.2" fill="currentColor"/><circle cx="7" cy="10" r="1.2" fill="currentColor"/><circle cx="13" cy="10" r="1.2" fill="currentColor"/><circle cx="7" cy="15" r="1.2" fill="currentColor"/><circle cx="13" cy="15" r="1.2" fill="currentColor"/>'),
    up: ic('<path d="M10 16V4M5 9l5-5 5 5"/>'), down: ic('<path d="M10 4v12M5 11l5 5 5-5"/>'),
    hide: ic('<path d="M3 10s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><path d="M3.5 3.5l13 13"/>'),
    undo: ic('<path d="M7.5 5 4 8.5 7.5 12"/><path d="M4 8.5h8a4 4 0 0 1 0 8H9"/>'), redo: ic('<path d="M12.5 5 16 8.5 12.5 12"/><path d="M16 8.5H8a4 4 0 0 0 0 8h3"/>'),
    plus: ic('<path d="M10 4v12M4 10h12"/>'), wand: ic('<path d="M4 16 14 6M12 4l1 1M15 3v2M17 5h-2M16 9l1 1M9 2l.6 1.4"/>'), grid: ic('<path d="M3.5 3.5h5v5h-5zM11.5 3.5h5v5h-5zM3.5 11.5h5v5h-5zM11.5 11.5h5v5h-5z"/>'),
    eye: ic('<path d="M3 10s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="10" cy="10" r="2.2"/>'), tray: ic('<path d="M3 11h4l1 2h4l1-2h4M3 11l2-7h10l2 7v5H3z"/>'),
    reset: ic('<path d="M4 10a6 6 0 1 0 2-4.5M4 3.5V7h3.5"/>'), photo: ic('<path d="M3 5h14v10H3z"/><path d="m3 13 4-4 3 3 2-2 5 4"/>'), check: ic('<path d="m4.5 10.5 3.5 3.5 7.5-8"/>'),
    edit: ic('<path d="M4 16h3l8.5-8.5-3-3L4 13z"/>'), style: ic('<path d="M3.5 4h13M3.5 10h8M3.5 16h11"/>'), cover: ic('<path d="M3 4h14v6H3zM5 14h10M7 17h6"/>'),
    text: ic('<path d="M4 5h12M10 5v11M7 16h6"/>'), quote: ic('<path d="M5 9h3v4H4v-2a5 5 0 0 1 2-4M12 9h3v4h-4v-2a5 5 0 0 1 2-4"/>'), link: ic('<path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.8.8M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.8-.8"/>'),
    video: ic('<path d="M3 5h10v10H3zM13 9l4-2.5v7L13 11"/>'), divider: ic('<path d="M3 10h14"/>'), x: ic('<path d="M5 5l10 10M15 5 5 15"/>'),
  };
  const BI = { text: I.text, photo: I.photo, quote: I.quote, links: I.link, video: I.video, divider: I.divider };
  const CSS = `
html.pl-arranging body{padding-top:calc(80px + env(safe-area-inset-top))!important;padding-bottom:calc(96px + env(safe-area-inset-bottom))!important}html.pl-arranging.pla-tipping body{padding-bottom:calc(190px + env(safe-area-inset-bottom))!important}
@media (max-width:640px){html.pl-arranging body{padding-bottom:calc(150px + env(safe-area-inset-bottom))!important}html.pl-arranging.pla-tipping body{padding-bottom:calc(240px + env(safe-area-inset-bottom))!important}}
html.pl-arranging,html.pl-arranging body{overflow-anchor:none}
html.pl-arranging :is(.store-fab,.es-tabs,.plt-live){display:none!important}
html.pl-arranging.pl-lay #m{--pl-gap:84px;padding-top:24px}
html.pl-arranging [data-pl-sec]{position:relative;overflow:visible!important;outline:1.5px dashed rgba(41,72,154,.45);outline-offset:8px;border-radius:6px;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;transition:outline-color .2s}
html.pl-arranging [data-pl-sub]{outline:1.5px dashed rgba(41,72,154,.25);outline-offset:8px;border-radius:6px}
html.pl-arranging [data-pl-sec]>:not(.pla-chrome),html.pl-arranging [data-pl-sub]>*{pointer-events:none}
@media (hover:hover){html.pl-arranging [data-pl-sec]:hover{outline-color:#29489A;outline-style:solid}.pla-chrome button:hover,}html.pl-arranging [data-pl-sec]:focus-within{outline-color:#29489A;outline-style:solid}
.pla-chrome{position:absolute;left:-9px;right:-9px;bottom:calc(100% + 10px);min-height:44px;display:flex;align-items:center;gap:6px;z-index:6;font:500 15px/1.2 "IBM Plex Sans",system-ui,sans-serif;color:#1B1D1C;letter-spacing:0;text-transform:none;pointer-events:auto}
.pla-chrome button{min-width:44px;min-height:44px;display:inline-grid;place-items:center;grid-auto-flow:column;gap:6px;padding:0 10px;border:1.5px solid #CFC8B9;border-radius:6px;background:#FAF8F3;color:#1B1D1C;font:600 15px "IBM Plex Sans",system-ui,sans-serif;cursor:pointer}
.pla-chrome button:focus-visible,.pla-bar button:focus-visible,.pla-dock button:focus-visible,.pla-sheet :is(button,input,textarea):focus-visible{outline:3px solid rgba(41,72,154,.3);outline-offset:2px}
.pla-chrome button[disabled]{opacity:.4;cursor:default}
.pla-grip{cursor:grab!important;touch-action:none;background:#29489A!important;color:#fff!important;border-color:#29489A!important}
.pla-name{flex:1 1 auto;min-width:0;overflow-wrap:anywhere;line-height:1.25;font-weight:600;padding-left:4px}
.pla-tools{display:flex;gap:6px;flex:none}
@media (max-width:520px){.pla-chrome .pla-lbl,.pla-bar .pla-lbl{display:none}.pla-chrome button{padding:0 8px}.pla-tools{gap:4px}}
html.pla-dragging [data-pl-sec]{max-height:150px;overflow:hidden!important;-webkit-mask-image:linear-gradient(#000 60%,transparent);mask-image:linear-gradient(#000 60%,transparent)}
html.pla-dragging [data-pl-sub]{display:none!important}
html.pla-dragging.pl-lay #m{--pl-gap:16px}html.pla-dragging .pla-chrome{display:none}
html.pla-dragging [data-pl-sec]::after{content:attr(data-pl-name);position:absolute;right:10px;top:10px;z-index:7;padding:4px 10px;border-radius:6px;background:#1B1D1C;color:#fff;font:600 14px "IBM Plex Sans",system-ui,sans-serif}
[data-pl-sec].pla-lifted{z-index:20;-webkit-mask-image:none!important;mask-image:none!important;box-shadow:0 18px 40px -12px rgba(27,29,28,.45),0 0 0 2px #29489A;background:var(--bg,#EFEBE2);cursor:grabbing;outline:0!important}
[data-pl-sec].pla-press{transition:transform .25s;transform:scale(.99)}
.pla-bar{position:fixed;left:0;right:0;top:0;z-index:70;padding:calc(10px + env(safe-area-inset-top)) 12px 10px;display:flex;align-items:center;gap:8px;background:#FAF8F3;border-bottom:1.5px solid #1B1D1C;font-family:"IBM Plex Sans",system-ui,sans-serif;color:#1B1D1C}
.pla-bar .pla-t{flex:1;min-width:0;display:flex;flex-direction:column}.pla-bar .pla-t b{font-size:17px}.pla-bar .pla-t small{font-size:13px;line-height:1.3;color:#444845}
.pla-bar button,.pla-dock button{min-height:44px;min-width:44px;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:0 12px;border:1.5px solid #CFC8B9;border-radius:6px;background:#fff;color:#1B1D1C;font:600 15px "IBM Plex Sans",system-ui,sans-serif;cursor:pointer;white-space:nowrap;flex:none}
.pla-bar button[disabled]{opacity:.4;cursor:default}.pla-bar .pla-done{background:#29489A;border-color:#29489A;color:#fff;padding:0 18px}
.pla-bar button[aria-pressed=true]{background:#E3E8F4;border-color:#29489A}
.pla-saved{display:inline-flex;align-items:center;gap:4px}.pla-saved svg{width:14px;height:14px}
.pla-dock{position:fixed;left:0;right:0;bottom:0;z-index:70;padding:10px 12px calc(10px + env(safe-area-inset-bottom));display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;background:#FAF8F3;border-top:1.5px solid #1B1D1C}
.pla-dock::-webkit-scrollbar{display:none}.pla-dock .pla-short{display:none}
@media (max-width:640px){.pla-dock{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));overflow:visible;gap:6px}.pla-dock button{padding:0 6px;font-size:15px;gap:4px}.pla-dock .pla-long{display:none}.pla-dock .pla-short{display:inline}}
@media (min-width:900px){.pla-dock{justify-content:center}}
html.pla-preview .pla-chrome,html.pla-preview .pla-dock,html.pla-preview .pla-tip,html.pla-preview :is(.of-own,.bk-sug,#srChangelog,#owHire,.h-next,.av-chg,.sup-own,.pla-empty){display:none!important}
html.pla-preview [data-pl-sec],html.pla-preview [data-pl-sub]{outline:0!important}html.pla-preview [data-pl-sec]>*,html.pla-preview [data-pl-sub]>*{pointer-events:auto}html.pla-preview.pl-lay #m{--pl-gap:24px}
html.pla-preview body{padding-bottom:0!important}
.pla-sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.pla-tip{position:fixed;left:12px;right:12px;bottom:calc(78px + env(safe-area-inset-bottom));z-index:69;}@media (max-width:640px){.pla-tip{bottom:calc(132px + env(safe-area-inset-bottom))}}.pla-tip{max-width:440px;margin:0 auto;display:flex;gap:10px;align-items:center;padding:10px 12px;border:1.5px solid #1B1D1C;border-radius:6px;background:#F7EFCB;color:#1B1D1C;font:500 15px/1.4 "IBM Plex Sans",system-ui,sans-serif;box-shadow:0 10px 30px -18px rgba(27,29,28,.5)}
.pla-tip .pla-potto{flex:none;width:40px;height:40px;display:grid;place-items:center}.pla-tip p{margin:0;flex:1}.pla-tip button{min-width:44px;min-height:44px;border:0;background:none;color:inherit;cursor:pointer;display:grid;place-items:center}
@media (prefers-reduced-motion:no-preference){.pla-tip{animation:plaIn .28s cubic-bezier(.2,.9,.3,1.2)}@keyframes plaIn{from{transform:translateY(12px);opacity:0}}}
.pla-scrim{position:fixed;inset:0;z-index:80;background:rgba(27,29,28,.35);display:flex;align-items:flex-end;justify-content:center}
.pla-sheet{width:min(560px,100%);max-height:min(84vh,720px);overflow:auto;background:#FAF8F3;color:#1B1D1C;border:1.5px solid #1B1D1C;border-bottom:0;border-radius:6px 6px 0 0;padding:16px 16px calc(20px + env(safe-area-inset-bottom));font:400 16px/1.5 "IBM Plex Sans",system-ui,sans-serif}
@media (min-width:700px){.pla-scrim{align-items:center}.pla-sheet{border-bottom:1.5px solid #1B1D1C;border-radius:6px}}
.pla-sheet h2{font:600 24px/1.2 "IBM Plex Sans",system-ui,sans-serif!important;letter-spacing:-.01em!important;margin:0}.pla-sh{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.pla-sheet h3{font:600 13px "IBM Plex Sans",system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:#444845;margin:18px 0 8px}
.pla-sheet p.pla-lead{margin:0 0 4px;color:#444845}
.pla-sheet button{font:600 16px "IBM Plex Sans",system-ui,sans-serif;color:#1B1D1C;cursor:pointer}
.pla-x{min-width:44px;min-height:44px;border:1.5px solid #CFC8B9;border-radius:6px;background:#fff;display:grid;place-items:center}
.pla-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.pla-tile{display:grid;grid-template-columns:24px minmax(0,1fr);gap:4px 10px;align-items:start;text-align:left;min-height:64px;padding:12px;border:1.5px solid #CFC8B9;border-radius:6px;background:#fff}
.pla-tile:hover{border-color:#1B1D1C}.pla-tile small{grid-column:2;font:400 14px/1.35 "IBM Plex Sans",system-ui,sans-serif;color:#444845}
.pla-starters{display:grid;gap:8px}.pla-st{display:grid;grid-template-columns:56px minmax(0,1fr);gap:12px;align-items:center;text-align:left;padding:12px;border:1.5px solid #CFC8B9;border-radius:6px;background:#fff}
.pla-st.fit{border-color:#29489A;box-shadow:inset 0 0 0 1px #29489A}.pla-st small{display:block;font:400 14px "IBM Plex Sans",system-ui,sans-serif;color:#444845}.pla-fit{display:inline-block;margin-left:6px;padding:1px 8px;border-radius:6px;background:#E3E8F4;color:#29489A;font-size:13px}
.pla-mini{display:grid;gap:3px;padding:6px;border:1.5px solid #CFC8B9;border-radius:6px;background:#EFEBE2}.pla-mini i{display:block;height:7px;border-radius:2px;background:#1B1D1C;opacity:.75}.pla-mini i.c{height:12px;background:#29489A}
.pla-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid #CFC8B9}.pla-row:first-of-type{border-top:0}
.pla-btn{min-height:44px;padding:0 16px;border:1.5px solid #CFC8B9;border-radius:6px;background:#fff}.pla-btn.pri{background:#29489A;border-color:#29489A;color:#fff!important}.pla-btn.warn{color:#A2361A!important}
.pla-f{display:grid;gap:4px;margin-top:12px;font-weight:600;font-size:15px}.pla-f input,.pla-f textarea{font:400 16px/1.45 "IBM Plex Sans",system-ui,sans-serif;padding:10px 12px;border:1.5px solid #CFC8B9;border-radius:6px;background:#fff;color:#1B1D1C;min-height:44px;box-sizing:border-box;width:100%}
.pla-foot{display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap;margin-top:16px}.pla-err{color:#A2361A;font-size:15px;margin:8px 0 0;min-height:1em}
.pla-pics{display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:6px;margin-top:8px}.pla-pic{position:relative;padding:0;border:2px solid transparent;border-radius:6px;background:none;aspect-ratio:1;overflow:hidden}.pla-pic img{width:100%;height:100%;object-fit:cover;display:block}.pla-pic[aria-pressed=true]{border-color:#29489A}.pla-pic[aria-pressed=true]::after{content:"";position:absolute;right:4px;top:4px;width:18px;height:18px;border-radius:50%;background:#29489A}
.pla-up{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 14px;border:1.5px dashed #1B1D1C;border-radius:6px;background:#fff;font-weight:600;cursor:pointer;margin-top:8px}.pla-up input{position:absolute;opacity:0;width:1px;height:1px}
.pla-empty{color:#444845;font-style:normal;border:1.5px dashed #CFC8B9;border-radius:6px;padding:14px}
html.pl-arranging .plb-divider{min-height:24px}
@media (prefers-reduced-motion:reduce){html.pl-arranging *{transition:none!important;animation:none!important}}
`;

  const E = { A: null, L: null, hist: [], fut: [], handle: "", open: false, timer: 0, saveP: null, dirty: false, err: "", kind: "", facts: {} };
  const items = () => E.L.items;
  const meta = (it) => (PLL.BY[it.id] ? PLL.BY[it.id] : PLL.BLOCKS[it.type] || { label: "Section", variants: [] });
  const nameOf = (it) => { if (!it) return "Section"; if (PLL.BY[it.id]) return PLL.BY[it.id].label; const B = PLL.BLOCKS[it.type], d = it.data || {}, t = String(d.title || d.text || d.caption || "").trim(); void t; return B.label; };
  // where a section is on the page: every element it has, the first one carries the toolbar
  const elsOf = (it) => { const m = $("#m"); if (!m) return []; if (!PLL.BY[it.id]) return $$(`.plb[data-pl="${it.id}"]`, m); return PLL.BY[it.id].sel.flatMap((s) => $$(s, m)).filter((el, i, A2) => A2.indexOf(el) === i && !el.closest(".pla-chrome")); };
  const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== "none";
  const primary = (it) => elsOf(it).find(shown) || null;
  /** the sections a person can see right now, in page order */
  const present = () => items().filter((it) => !it.off && primary(it));
  const say = (t) => { const r = $(".pla-sr"); if (!r) return; r.textContent = ""; setTimeout(() => { r.textContent = t; }, 30); };
  const clone = (x) => JSON.parse(JSON.stringify(x));

  // ---- the toolbar on each section ----
  function chromeFor(it) { const M = meta(it), name = nameOf(it), v = it.v || (M.variants[0] || [])[0], vl = (M.variants.find((x) => x[0] === v) || [])[1];
    return `<button type="button" class="pla-grip" data-act="grip" aria-label="Drag ${esc(name)}. Or use the arrow keys, or Move up and Move down." aria-roledescription="drag handle">${I.grip}</button><span class="pla-name">${esc(name)}</span><span class="pla-tools">${
      M.variants.length ? `<button type="button" data-act="style" aria-label="Style: ${esc(vl)}. Tap for the next style.">${I.style}<span class="pla-lbl">${esc(vl)}</span></button>` : ""}${
      it.type && it.type !== "divider" ? `<button type="button" data-act="edit" aria-label="Edit ${esc(name)}">${I.edit}<span class="pla-lbl">Edit</span></button>` : ""}<button type="button" data-act="up" aria-label="Move ${esc(name)} up">${I.up}</button><button type="button" data-act="down" aria-label="Move ${esc(name)} down">${I.down}</button><button type="button" data-act="hide" aria-label="Hide ${esc(name)}">${I.hide}</button></span>`; }
  let decorating = false;
  function decorate() { if (!E.open || decorating) return; decorating = true;
    try { const P = present();
      for (const el of $$("[data-pl-sec],[data-pl-sub]")) { const keep = P.some((it) => elsOf(it).includes(el)); if (!keep) { el.removeAttribute("data-pl-sec"); el.removeAttribute("data-pl-sub"); el.removeAttribute("data-pl-name"); el.querySelector(":scope > .pla-chrome")?.remove(); } }
      P.forEach((it, i) => { const els = elsOf(it).filter(shown), p = els[0]; const html = chromeFor(it);
        for (const el of els.slice(1)) { if (el.dataset.plSec) { el.removeAttribute("data-pl-sec"); el.querySelector(":scope > .pla-chrome")?.remove(); } el.dataset.plSub = it.id; }
        if (p.dataset.plSec !== it.id) p.querySelector(":scope > .pla-chrome")?.remove(); p.dataset.plSec = it.id; p.removeAttribute("data-pl-sub"); p.dataset.plName = nameOf(it);
        let c = p.querySelector(":scope > .pla-chrome"); if (!c) { c = document.createElement("div"); c.className = "pla-chrome"; c.setAttribute("role", "group"); p.prepend(c); }
        c.setAttribute("aria-label", `${nameOf(it)}, section ${i + 1} of ${P.length}`);
        if (c.__h !== html) { const f = document.activeElement && c.contains(document.activeElement) ? document.activeElement.dataset.act : ""; c.innerHTML = html; c.__h = html; if (f) c.querySelector(`[data-act="${f}"]`)?.focus(); }
        c.querySelector('[data-act="up"]').disabled = i === 0; c.querySelector('[data-act="down"]').disabled = i === P.length - 1; });
      const h = $(".pla-hidden-n"); if (h) h.textContent = hiddenList().length ? ` (${hiddenList().length})` : "";
    } finally { decorating = false; } }
  let dq = 0; const decorateSoon = () => { clearTimeout(dq); dq = setTimeout(decorate, 60); };

  // ---- history and saving ----
  function commit(next, said) { E.hist.push(JSON.stringify(E.L)); if (E.hist.length > 60) E.hist.shift(); E.fut = []; E.L = PLL.full(next); redraw(); if (said) say(said); save(); }
  function redraw(anim = true) { const go = () => { PA.apply(E.L); decorate(); }; if (anim) flip(go); else go(); bar(); }
  function undo() { if (!E.hist.length) return; E.fut.push(JSON.stringify(E.L)); E.L = JSON.parse(E.hist.pop()); redraw(); say("Undone."); save(); }
  function redo() { if (!E.fut.length) return; E.hist.push(JSON.stringify(E.L)); E.L = JSON.parse(E.fut.pop()); redraw(); say("Redone."); save(); }
  const api = (m, p, b) => fetch(p, { method: m, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.message || "That didn't save. Try again."), { status: r.status }); return j; });
  function save() { E.dirty = true; status("Saving"); clearTimeout(E.timer); E.timer = setTimeout(flush, 650); }
  function flush() { clearTimeout(E.timer); if (!E.dirty) return E.saveP || Promise.resolve(); E.dirty = false; const body = { layout: E.L };
    E.saveP = api("PUT", "/api/host/layout/" + encodeURIComponent(E.handle), body).then(() => { E.err = ""; if (!E.dirty) status("Saved"); }).catch((e) => { E.err = e.message; status("Not saved. " + e.message); if (e.status !== 400) { E.dirty = true; E.timer = setTimeout(flush, 3000); } });
    return E.saveP; }
  function status(t) { const s = $(".pla-status"); if (!s) return; s.innerHTML = t === "Saved" ? `<span class="pla-saved">${I.check}Saved. Done puts it live.</span>` : t === "Saving" ? "Saving draft" : esc(t); }
  function bar() { const u = $(".pla-undo"), r = $(".pla-redo"); if (u) u.disabled = !E.hist.length; if (r) r.disabled = !E.fut.length; }

  // ---- FLIP: everyone glides from where they were ----
  function flip(fn) { if (reduce()) return fn(); const els = $$("[data-pl-sec],[data-pl-sub],.plb,#plAbout").filter(shown), before = new Map(els.map((e) => [e, e.getBoundingClientRect().top]));
    fn(); for (const e of els) { if (e === D?.el || !before.has(e) || !shown(e)) continue; const d = before.get(e) - e.getBoundingClientRect().top; if (Math.abs(d) < 1) continue;
      e.animate([{ transform: `translateY(${d}px)` }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" }); } }

  // ---- moving ----
  function place(id, beforeId) { const L = clone(E.L), i = L.items.findIndex((x) => x.id === id); const [x] = L.items.splice(i, 1); const j = beforeId ? L.items.findIndex((y) => y.id === beforeId) : -1; if (j < 0) L.items.push(x); else L.items.splice(j, 0, x); return L; }
  function moveBy(id, delta, how = "button") { const P = present(), i = P.findIndex((x) => x.id === id), j = i + delta; if (i < 0 || j < 0 || j >= P.length) return;
    const ref = delta < 0 ? P[j].id : P[j + 1]?.id || null; let L = place(id, ref); if (delta > 0 && !ref) L = place(id, null);
    const it = P[i]; commit(L, `${nameOf(it)} moved to position ${j + 1} of ${P.length}.`); buzz(6);
    const el = primary(it); if (el) el.scrollIntoView({ block: "nearest", behavior: reduce() ? "auto" : "smooth" });
    if (how === "key") primary(it)?.querySelector(".pla-grip")?.focus(); }

  // ---- drag: pointer events, long-press on touch ----
  let D = null;
  const docTop = (el) => { let y = 0; for (let e = el; e; e = e.offsetParent) y += e.offsetTop; return y; };
  function down(ev) { if (!E.open || de.classList.contains("pla-preview") || D || ev.button > 0) return; const sec = ev.target.closest?.("[data-pl-sec]"); if (!sec) return;
    const onGrip = !!ev.target.closest(".pla-grip"); if (!onGrip && ev.target.closest(".pla-chrome button")) return;
    const it = items().find((x) => x.id === sec.dataset.plSec); if (!it) return;
    D = { it, el: sec, id: ev.pointerId, x: ev.clientX, y: ev.clientY, lastY: ev.clientY, lifted: false, type: ev.pointerType, start: JSON.stringify(E.L), grab: 0, timer: 0 };
    if (ev.pointerType === "mouse") { ev.preventDefault(); } // a mouse lifts after a few pixels of movement
    else if (onGrip) { ev.preventDefault(); lift(ev); }
    else { sec.classList.add("pla-press"); D.timer = setTimeout(() => { if (D && !D.lifted) lift({ clientX: D.x, clientY: D.lastY }); }, 250); }
    addEventListener("pointermove", move, { passive: false }); addEventListener("pointerup", up); addEventListener("pointercancel", up); }
  function lift(ev) { if (!D) return; clearTimeout(D.timer); D.el.classList.remove("pla-press"); D.lifted = true; buzz(10);
    try { D.el.setPointerCapture?.(D.id); } catch {}
    const r0 = D.el.getBoundingClientRect(); D.grab = Math.min(Math.max(ev.clientY - r0.top, 20), 70);
    de.classList.add("pla-dragging"); D.el.classList.add("pla-lifted");
    // the page folds into cards: keep the lifted one under the finger
    const r1 = D.el.getBoundingClientRect(); scrollBy(0, r1.top + D.grab - ev.clientY);
    untip(); D.lastY = ev.clientY; follow(); say(`${nameOf(D.it)} lifted. Move to place it, let go to drop.`); tick(); }
  function move(ev) { if (!D || ev.pointerId !== D.id) return; D.lastY = ev.clientY;
    if (!D.lifted) { const dx = Math.abs(ev.clientX - D.x), dy = Math.abs(ev.clientY - D.y);
      if (D.type === "mouse") { if (dx + dy > 4) lift(ev); return; }
      if (dx + dy > 8) cancelPress(); return; } // a finger that moves before the long-press is scrolling
    ev.preventDefault(); follow(); }
  function cancelPress() { if (!D) return; clearTimeout(D.timer); D.el.classList.remove("pla-press"); end(); D = null; }
  /** keep the lifted card under the pointer and give it the slot it is over */
  function follow() { if (!D?.lifted) return; const y = D.lastY + scrollY, P = present().filter((x) => x.id !== D.it.id);
    let to = P.length; for (let i = 0; i < P.length; i++) { const el = primary(P[i]); const mid = docTop(el) + el.offsetHeight / 2; if (y < mid) { to = i; break; } }
    const cur = present().findIndex((x) => x.id === D.it.id); if (to !== cur) { E.L = place(D.it.id, P[to]?.id || null); flip(() => { PA.apply(E.L); }); buzz(4); D.moved = true; }
    const nat = docTop(D.el) - scrollY, dy = D.lastY - D.grab - nat; D.el.style.transform = `translate3d(0,${dy}px,0)${reduce() ? "" : " scale(1.03)"}`; }
  function tick() { if (!D?.lifted) return; const y = D.lastY, edge = 90, H = innerHeight - (D.type === "mouse" ? 0 : 70); let v = 0;
    if (y < edge + 60) v = -Math.ceil(((edge + 60 - y) / edge) * 16); else if (y > H - edge) v = Math.ceil(((y - (H - edge)) / edge) * 16);
    if (v) { scrollBy(0, v); follow(); } D.raf = requestAnimationFrame(tick); }
  function up(ev) { if (!D || (ev.pointerId != null && ev.pointerId !== D.id)) return;
    // a press that stopped a fling: the browser keeps the gesture as a scroll and cancels the pointer. The card stays
    // lifted and follows the finger's touch events until it lets go.
    if (ev.type === "pointercancel" && D.lifted && D.type === "touch") { D.viaTouch = true; return; }
    const d = D; clearTimeout(d.timer); d.el.classList.remove("pla-press");
    if (!d.lifted) { end(); D = null; return; }
    cancelAnimationFrame(d.raf); const changed = JSON.stringify(E.L) !== d.start; const prev = d.el.getBoundingClientRect().top;
    d.el.style.transform = ""; d.el.classList.remove("pla-lifted"); de.classList.remove("pla-dragging"); D = null; end();
    decorate(); d.el.scrollIntoView({ block: "center", behavior: "auto" });
    if (!reduce()) { const now = d.el.getBoundingClientRect().top; d.el.animate([{ transform: `translateY(${Math.max(-120, Math.min(120, prev - now))}px) scale(1.03)`, boxShadow: "0 18px 40px -12px rgba(27,29,28,.45)" }, { transform: "scale(.995)", offset: 0.75 }, { transform: "none", boxShadow: "none" }], { duration: 320, easing: "cubic-bezier(.2,.9,.3,1.25)" }); }
    buzz(6); const P = present(), pos = P.findIndex((x) => x.id === d.it.id) + 1;
    if (changed) { E.hist.push(d.start); E.fut = []; bar(); save(); say(`${nameOf(d.it)} moved to position ${pos} of ${P.length}.`); } else say(`${nameOf(d.it)} dropped. Still position ${pos} of ${P.length}.`);
    d.el.querySelector(".pla-grip")?.focus({ preventScroll: true }); }
  function end() { removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up); }
  // while a card is lifted the page doesn't scroll under the finger (this is what makes touch drag work on iOS)
  const noScroll = (e) => { if (!D?.lifted) return; if (e.cancelable) e.preventDefault(); if (D.viaTouch && e.touches?.[0]) { D.lastY = e.touches[0].clientY; follow(); } };
  const touchEnd = (e) => { if (D?.viaTouch && !e.touches?.length) up({ type: "touchend" }); };
  const noMenu = (e) => { if (E.open && !de.classList.contains("pla-preview") && e.target.closest?.("[data-pl-sec]")) e.preventDefault(); };

  // ---- toolbar actions ----
  function act(ev) { const b = ev.target.closest?.(".pla-chrome [data-act]"); if (!b || b.dataset.act === "grip") return; const sec = b.closest("[data-pl-sec]"), it = items().find((x) => x.id === sec?.dataset.plSec); if (!it) return;
    ev.preventDefault(); ev.stopPropagation(); const a = b.dataset.act;
    if (a === "up") moveBy(it.id, -1); else if (a === "down") moveBy(it.id, 1);
    else if (a === "hide") { const L = clone(E.L); L.items.find((x) => x.id === it.id).off = true; commit(L, `${nameOf(it)} hidden. Bring it back from Hidden.`); $(".pla-hid")?.focus(); }
    else if (a === "style") { const M = meta(it), V = M.variants, i = V.findIndex((x) => x[0] === (it.v || V[0][0])), n = V[(i + 1) % V.length]; const L = clone(E.L); L.items.find((x) => x.id === it.id).v = n[0]; commit(L, `${nameOf(it)} style: ${n[1]}.`); }
    else if (a === "edit") editBlock(it.id); }
  function key(ev) { const g = ev.target.closest?.(".pla-grip"); if (g && (ev.key === "ArrowUp" || ev.key === "ArrowDown")) { ev.preventDefault(); moveBy(g.closest("[data-pl-sec]").dataset.plSec, ev.key === "ArrowUp" ? -1 : 1, "key"); return; }
    if (ev.target.closest?.("input,textarea,[contenteditable]")) return; const mod = ev.metaKey || ev.ctrlKey, k = ev.key.toLowerCase();
    if (mod && k === "z") { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); } else if (mod && k === "y") { ev.preventDefault(); redo(); }
    else if (ev.key === "Escape" && $(".pla-scrim")) closeSheet(); }

  // ---- sheets ----
  let lastFocus = null;
  function sheet(title, inner, { id = "plaSheet" } = {}) { closeSheet(); lastFocus = document.activeElement; const s = document.createElement("div"); s.className = "pla-scrim";
    s.innerHTML = `<div class="pla-sheet" role="dialog" aria-modal="true" aria-labelledby="${id}H" id="${id}"><div class="pla-sh"><h2 id="${id}H">${esc(title)}</h2><button type="button" class="pla-x" aria-label="Close">${I.x}</button></div>${inner}</div>`;
    document.body.appendChild(s); s.addEventListener("click", (e) => { if (e.target === s || e.target.closest(".pla-x")) closeSheet(); });
    s.addEventListener("keydown", (e) => { if (e.key !== "Tab") return; const f = $$("button,input,textarea,[href]", s).filter((x) => !x.disabled && x.offsetParent); if (!f.length) return; if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); } });
    setTimeout(() => ($("input,textarea", s) || $(".pla-sheet button:not(.pla-x)", s) || $(".pla-x", s))?.focus(), 30); return s; }
  function closeSheet() { const s = $(".pla-scrim"); if (!s) return; s.remove(); try { lastFocus?.focus?.({ preventScroll: true }); } catch {} }
  // where a new section goes: after the one in the middle of the screen
  function hereId() { const P = present(); let best = null, bd = Infinity; for (const it of P) { const r = primary(it).getBoundingClientRect(), d = Math.abs(r.top + r.height / 2 - innerHeight / 2); if (d < bd) { bd = d; best = it; } }
    const i = best ? items().findIndex((x) => x.id === best.id) : -1; return items()[i + 1]?.id || null; }
  function hasData(id) { if (id === "drops") return $$("#offer .of-k, #plDrops .of-k").some((k) => /^Order ahead$/i.test(k.textContent.trim()));
    if (id === "book") return $$("#offer .of-k, #plBook .of-k").some((k) => /^For teams and groups$/i.test(k.textContent.trim()));
    if (id === "about") return !!String(E.A.host?.bio || "").trim(); return PLL.BY[id].sel.some((s) => $(`#m ${s}`)); }
  const hiddenList = () => items().filter((it) => it.off && (it.type || hasData(it.id)));
  function addSheet() { const off = items().filter((it) => !it.type && it.off && hasData(it.id));
    const s = sheet("Add a section", `<p class="pla-lead">It goes where you are on the page. Drag it anywhere after.</p><h3>Your own</h3><div class="pla-tiles">${Object.entries(PLL.BLOCKS).map(([k, B]) => `<button type="button" class="pla-tile" data-new="${k}">${BI[k]}<b>${esc(B.label)}</b><small>${esc(B.hint)}</small></button>`).join("")}</div>${
      off.length ? `<h3>From your page</h3><div class="pla-tiles">${off.map((it) => `<button type="button" class="pla-tile" data-back="${it.id}">${I.plus}<b>${esc(PLL.BY[it.id].label)}</b><small>${esc(PLL.BY[it.id].hint)}</small></button>`).join("")}</div>` : ""}`);
    $$("[data-new]", s).forEach((b) => (b.onclick = () => { const type = b.dataset.new, id = "b-" + Math.random().toString(36).slice(2, 9).replace(/[^a-z0-9]/g, "x").padEnd(6, "x"), B = PLL.BLOCKS[type];
      const L = clone(E.L), at = hereId(), it = { id, type, ...(B.variants[0] ? { v: B.variants[0][0] } : {}), data: type === "links" ? { title: "", items: [] } : type === "photo" ? { urls: [], caption: "" } : {} };
      const j = at ? L.items.findIndex((x) => x.id === at) : -1; if (j < 0) L.items.push(it); else L.items.splice(j, 0, it);
      closeSheet(); commit(L, `${B.label} added.`); setTimeout(() => { primary(it)?.scrollIntoView({ block: "center", behavior: reduce() ? "auto" : "smooth" }); if (type !== "divider") editBlock(id); }, 80); }));
    $$("[data-back]", s).forEach((b) => (b.onclick = () => bringBack(b.dataset.back, true))); }
  function bringBack(id, here) { let L = clone(E.L); const it = L.items.find((x) => x.id === id); delete it.off; if (here) { E.L = L; L = place(id, hereId()); }
    closeSheet(); commit(L, `${nameOf(it)} is back.`); setTimeout(() => primary(items().find((x) => x.id === id))?.scrollIntoView({ block: "center", behavior: reduce() ? "auto" : "smooth" }), 80); }
  function hiddenSheet() { const H = hiddenList();
    const s = sheet("Hidden", H.length ? `<p class="pla-lead">Guests don't see these. Bring one back any time.</p>${H.map((it) => `<div class="pla-row"><span><b>${esc(nameOf(it))}</b>${PLL.SPLIT.has(it.id) ? `<small style="display:block;color:#444845;font-size:14px">Shown inside Coming up for now. Bring it back for its own section.</small>` : ""}</span><button type="button" class="pla-btn" data-back="${it.id}">Bring back</button></div>`).join("")}` : `<p class="pla-lead">Nothing hidden. Hide a section from its toolbar and it waits here.</p>`);
    // one event, drop, experience or past event at a time: Pin to top and Hide from my page (public/hostitems.js)
    if (window.PLHostItems) { s.querySelector(".pla-sheet").insertAdjacentHTML("beforeend", `<div class="pla-row"><span><b>One thing at a time</b><small style="display:block;color:#444845;font-size:14px">Pin up to 2 events to the top, or hide one from your page. It stays live by its link.</small></span><button type="button" class="pla-btn" data-items>Events and items</button></div>`);
      s.querySelector("[data-items]").onclick = () => { closeSheet(); window.PLHostItems.manager(); }; }
    $$("[data-back]", s).forEach((b) => (b.onclick = () => bringBack(b.dataset.back, false))); }
  function startersSheet() { const fit = E.kind;
    const mini = (S) => `<span class="pla-mini" aria-hidden="true">${S.order.slice(0, 5).map(([id], i) => `<i class="${i === 0 ? "c" : ""}" style="width:${[100, 80, 92, 70, 86][i]}%"></i>`).join("")}</span>`;
    const L2 = [...PLL.STARTERS].sort((a, b) => (b.id === fit) - (a.id === fit));
    const s = sheet("Starters", `<p class="pla-lead">One tap for a whole layout. Undo takes it back.</p><div class="pla-starters">${L2.map((S) => `<button type="button" class="pla-st${S.id === fit ? " fit" : ""}" data-st="${S.id}">${mini(S)}<span><b>${esc(S.label)}</b>${S.id === fit ? `<span class="pla-fit">Fits you</span>` : ""}<small>${esc(S.line)}</small></span></button>`).join("")}</div>`);
    $$("[data-st]", s).forEach((b) => (b.onclick = () => { const S = PLL.STARTERS.find((x) => x.id === b.dataset.st); closeSheet(); commit(PLL.starter(S.id, E.L), `${S.label} layout on. Undo to go back.`); scrollTo({ top: 0, behavior: reduce() ? "auto" : "smooth" }); })); }
  async function suggest() { const b = $(".pla-sug"); if (b) b.disabled = true;
    try { const j = await api("POST", "/api/host/layout/" + encodeURIComponent(E.handle) + "/suggest", { layout: E.L }); commit(j.layout, "Potto arranged your page. " + (j.tips || []).join(" ")); tip((j.tips || [])[0] || "Here's an order that fits what you have."); scrollTo({ top: 0, behavior: reduce() ? "auto" : "smooth" }); }
    catch (e) { tip(e.message); } finally { if (b) b.disabled = false; } }
  function coverCycle() { const C = PLL.COVER, i = C.findIndex((x) => x[0] === (E.L.cover || "tall")), n = C[(i + 1) % C.length]; const L = clone(E.L); L.cover = n[0]; commit(L, `${n[1]}.`); const b = $(".pla-cov span"); if (b) b.textContent = n[1]; scrollTo({ top: 0, behavior: reduce() ? "auto" : "smooth" }); }
  function tip(t) { untip(); const el = document.createElement("div"); el.className = "pla-tip"; el.setAttribute("role", "status");
    el.innerHTML = `<span class="pla-potto" aria-hidden="true">${window.Potto?.svg ? window.Potto.svg("happy", 40) : I.wand}</span><p>${esc(t)}</p><button type="button" aria-label="Dismiss tip">${I.x}</button>`;
    el.querySelector("button").onclick = untip; document.body.appendChild(el); de.classList.add("pla-tipping"); clearTimeout(tip.t); tip.t = setTimeout(untip, 9000); }
  function untip() { $(".pla-tip")?.remove(); de.classList.remove("pla-tipping"); }

  // ---- the host's own blocks: edit sheet ----
  async function upload(file) { const r = await fetch("/api/assets", { method: "POST", credentials: "same-origin", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || "That upload didn't work. Try a smaller file."); return j.url; }
  function editBlock(id) { const it = items().find((x) => x.id === id); if (!it?.type) return; const d = clone(it.data || {}), t = it.type, B = PLL.BLOCKS[t];
    let inner = "";
    if (t === "text") inner = `<label class="pla-f">Heading <small>(optional)</small><input name="title" maxlength="80" value="${esc(d.title || "")}"></label><label class="pla-f">What you want to say<textarea name="body" rows="6" maxlength="1200">${esc(d.body || "")}</textarea></label>`;
    else if (t === "quote") inner = `<label class="pla-f">The quote<textarea name="text" rows="4" maxlength="280">${esc(d.text || "")}</textarea></label><label class="pla-f">Who said it<input name="by" maxlength="60" value="${esc(d.by || "")}"></label>`;
    else if (t === "links") { const L = (d.items || []).concat([{}, {}]).slice(0, Math.max(2, (d.items || []).length + 1)); inner = `<label class="pla-f">Heading <small>(optional)</small><input name="title" maxlength="60" value="${esc(d.title || "")}"></label><div class="pla-links">${L.map((x, i) => `<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr);gap:8px"><label class="pla-f">Label<input name="l${i}" maxlength="60" value="${esc(x.label || "")}"></label><label class="pla-f">Link<input name="u${i}" inputmode="url" placeholder="https://" value="${esc(x.url || "")}"></label></div>`).join("")}</div>`; }
    else if (t === "photo") { const G = [...new Set([...(E.A.host?.gallery || []), ...(d.urls || [])])].filter((u) => /^\/_blob\//.test(u));
      inner = `<p class="pla-lead">Pick one, or two for a pair. Try your best photo first. People decide in a second.</p><div class="pla-pics">${G.map((u) => `<button type="button" class="pla-pic" data-u="${esc(u)}" aria-pressed="${(d.urls || []).includes(u)}" aria-label="Use this photo"><img src="${esc(u)}" alt=""></button>`).join("")}</div><label class="pla-up">${I.photo}<span>Upload a photo</span><input type="file" accept="image/*" data-up="image"></label><label class="pla-f">Caption <small>(optional)</small><input name="caption" maxlength="140" value="${esc(d.caption || "")}"></label>`; }
    else if (t === "video") inner = `<p class="pla-lead">A short clip you made. It plays on your page, muted until someone taps.</p>${d.url ? `<video src="${esc(d.url)}" controls playsinline preload="metadata" style="width:100%;border-radius:6px;margin-top:8px"></video>` : ""}<label class="pla-up">${I.video}<span>${d.url ? "Pick another clip" : "Upload a clip"}</span><input type="file" accept="video/mp4,video/webm,video/quicktime" data-up="video"></label><label class="pla-f">Caption <small>(optional)</small><input name="caption" maxlength="140" value="${esc(d.caption || "")}"></label>`;
    const s = sheet(`Edit ${B.label.toLowerCase()}`, `${inner}<p class="pla-err" role="alert"></p><div class="pla-foot"><button type="button" class="pla-btn warn" data-rm>Remove block</button><button type="button" class="pla-btn pri" data-ok>Save</button></div>`);
    const er = $(".pla-err", s), val = (n) => $(`[name="${n}"]`, s)?.value || "";
    const pics = () => $$(".pla-pic[aria-pressed=true]", s).map((b) => b.dataset.u);
    $$(".pla-pic", s).forEach((b) => (b.onclick = () => { const on = b.getAttribute("aria-pressed") === "true"; if (!on && pics().length >= 2) { er.textContent = "Two at most. Tap one to let it go."; return; } er.textContent = ""; b.setAttribute("aria-pressed", String(!on)); }));
    $$("[data-up]", s).forEach((inp) => (inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; er.textContent = "Uploading"; try { const u = await upload(f); er.textContent = "";
      if (inp.dataset.up === "video") { d.url = u; const v = $("video", s); if (v) v.src = u; else inp.closest("label").insertAdjacentHTML("beforebegin", `<video src="${esc(u)}" controls playsinline preload="metadata" style="width:100%;border-radius:6px;margin-top:8px"></video>`); }
      else { const g = $(".pla-pics", s); g.insertAdjacentHTML("afterbegin", `<button type="button" class="pla-pic" data-u="${esc(u)}" aria-pressed="false" aria-label="Use this photo"><img src="${esc(u)}" alt=""></button>`); const nb = g.firstElementChild; nb.onclick = () => { const on = nb.getAttribute("aria-pressed") === "true"; if (!on && pics().length >= 2) { er.textContent = "Two at most. Tap one to let it go."; return; } nb.setAttribute("aria-pressed", String(!on)); }; if (pics().length < 2) nb.setAttribute("aria-pressed", "true"); } }
      catch (e) { er.textContent = e.message; } }));
    $("[data-rm]", s).onclick = () => { const L = clone(E.L); L.items = L.items.filter((x) => x.id !== id); closeSheet(); commit(L, `${B.label} removed. Undo brings it back.`); };
    $("[data-ok]", s).onclick = () => { let data;
      if (t === "text") data = { title: val("title"), body: val("body") };
      else if (t === "quote") data = { text: val("text"), by: val("by") };
      else if (t === "links") { const li = []; for (let i = 0; $(`[name="u${i}"]`, s); i++) { const url = val("u" + i).trim(), label = val("l" + i).trim(); if (!url && !label) continue; if (!/^https:\/\/\S{3,}$/i.test(url)) { er.textContent = "Links start with https://"; $(`[name="u${i}"]`, s).focus(); return; } li.push({ label, url }); } if (li.length > 8) { er.textContent = "Up to 8 links."; return; } data = { title: val("title"), items: li }; }
      else if (t === "photo") data = { urls: pics(), caption: val("caption") };
      else if (t === "video") data = { url: d.url || "", caption: val("caption") };
      const L = clone(E.L); L.items.find((x) => x.id === id).data = data; closeSheet(); commit(L, `${B.label} saved.`); }; }

  // ---- open and close ----
  async function open(A) { if (E.open) return; E.A = A; E.handle = A.host?.handle || ""; if (!E.handle) return;
    let j = null; try { j = await api("GET", "/api/host/layout/" + encodeURIComponent(E.handle)); } catch (e) { alert(e.message); return; }
    E.kind = j.kind || ""; E.facts = j.facts || {}; E.L = PLL.full(j.draft || j.live || j.suggested || PLL.defaults()); E.hist = []; E.fut = []; E.open = true; A.editing = true;
    if (!$("#plaCss")) { const s = document.createElement("style"); s.id = "plaCss"; s.textContent = CSS; document.head.appendChild(s); }
    de.classList.add("pl-arranging");
    const top = document.createElement("div"); top.className = "pla-bar"; top.setAttribute("role", "toolbar"); top.setAttribute("aria-label", "Arrange your page");
    top.innerHTML = `<button type="button" class="pla-undo" aria-label="Undo" title="Undo">${I.undo}</button><button type="button" class="pla-redo" aria-label="Redo" title="Redo">${I.redo}</button><span class="pla-t"><b>Arrange</b><small class="pla-status">Your draft saves as you go.</small></span><button type="button" class="pla-prev" aria-pressed="false">${I.eye}<span class="pla-lbl">Preview</span></button><button type="button" class="pla-done">Done</button>`;
    const dock = document.createElement("div"); dock.className = "pla-dock"; dock.setAttribute("role", "toolbar"); dock.setAttribute("aria-label", "Page tools");
    const two = (s, l) => `<span class="pla-short">${s}</span><span class="pla-long">${l}</span>`;
    dock.innerHTML = `<button type="button" class="pla-add" aria-label="Add a section">${I.plus}${two("Add", "Add a section")}</button><button type="button" class="pla-sug" aria-label="Suggest a layout">${I.wand}${two("Suggest", "Suggest a layout")}</button><button type="button" class="pla-sta">${I.grid}Starters</button><button type="button" class="pla-hid">${I.tray}Hidden<span class="pla-hidden-n"></span></button><button type="button" class="pla-cov">${I.cover}<span>${esc((PLL.COVER.find((x) => x[0] === (E.L.cover || "tall")) || [])[1])}</span></button><button type="button" class="pla-rst" aria-label="Reset to the suggested layout">${I.reset}${two("Reset", "Reset to the suggested layout")}</button>`;
    const sr = document.createElement("div"); sr.className = "pla-sr"; sr.setAttribute("aria-live", "polite"); sr.setAttribute("role", "status");
    document.body.append(top, dock, sr);
    $(".pla-undo").onclick = undo; $(".pla-redo").onclick = redo; $(".pla-done").onclick = done; $(".pla-prev").onclick = preview;
    $(".pla-add").onclick = addSheet; $(".pla-sug").onclick = suggest; $(".pla-sta").onclick = startersSheet; $(".pla-hid").onclick = hiddenSheet; $(".pla-cov").onclick = coverCycle;
    $(".pla-rst").onclick = () => { commit(PLL.defaults(), "Back to the suggested layout. Undo to go back."); scrollTo({ top: 0 }); };
    document.addEventListener("pointerdown", down, { passive: false }); document.addEventListener("click", act, true); document.addEventListener("keydown", key);
    document.addEventListener("touchmove", noScroll, { passive: false }); document.addEventListener("touchend", touchEnd); document.addEventListener("touchcancel", touchEnd); document.addEventListener("contextmenu", noMenu);
    E.obs = new MutationObserver((recs) => { if (recs.every((r) => r.target.closest?.(".pla-chrome") || [...r.addedNodes].every((n) => n.nodeType !== 1 || n.classList?.contains("pla-chrome")))) return; decorateSoon(); });
    E.obs.observe($("#m"), { childList: true, subtree: true });
    redraw(false); bar(); status(j.draft && JSON.stringify(j.draft) !== JSON.stringify(j.live) ? "Draft not live yet. Done puts it live." : "Your draft saves as you go.");
    tip(matchMedia("(pointer: coarse)").matches ? "Press and hold a section to lift it. Or use the arrows." : "Drag a section by its handle. Or use the arrows.");
    setTimeout(() => $(".pla-chrome .pla-grip")?.focus({ preventScroll: true }), 50); }
  function preview() { const on = !de.classList.contains("pla-preview"); de.classList.toggle("pla-preview", on); const b = $(".pla-prev"); b.setAttribute("aria-pressed", String(on)); b.innerHTML = on ? `${I.edit}<span class="pla-lbl">Back to arranging</span>` : `${I.eye}<span class="pla-lbl">Preview</span>`; say(on ? "Previewing as a guest." : "Back to arranging."); }
  async function done() { const b = $(".pla-done"); b.disabled = true; b.textContent = "Publishing"; clearTimeout(E.timer); E.dirty = false;
    try { await E.saveP?.catch(() => {}); await api("POST", "/api/host/layout/" + encodeURIComponent(E.handle) + "/publish", { layout: E.L }); close(); tip("Your page is live. Nice work."); say("Published. Your page is live."); }
    catch (e) { b.disabled = false; b.textContent = "Done"; status("Not live yet. " + e.message); } }
  function close() { E.open = false; E.A.editing = false; E.obs?.disconnect(); closeSheet();
    document.removeEventListener("pointerdown", down); document.removeEventListener("click", act, true); document.removeEventListener("keydown", key); document.removeEventListener("touchmove", noScroll); document.removeEventListener("touchend", touchEnd); document.removeEventListener("touchcancel", touchEnd); document.removeEventListener("contextmenu", noMenu);
    $$(".pla-bar,.pla-dock,.pla-sr,.pla-tip").forEach((x) => x.remove()); $$(".pla-chrome").forEach((x) => x.remove());
    $$("[data-pl-sec],[data-pl-sub]").forEach((el) => { el.removeAttribute("data-pl-sec"); el.removeAttribute("data-pl-sub"); el.removeAttribute("data-pl-name"); });
    de.classList.remove("pl-arranging", "pla-preview", "pla-dragging"); PA.apply(E.L); }
  window.PLArrangeEditor = { open, close, undo, redo, flush, state: E, moveBy };
})();
