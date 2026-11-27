// The host page in the host's own order (public/arrange-core.js has the sections, the styles and the CSS). This file
// is small and runs for everyone: it draws the About section and the host's own blocks into the page, splits Order
// ahead and Book me out of the offer list when the host gave them their own spots, and, on your own page, puts an
// "Arrange your page" door in Edit page. The editor itself (public/arrange-editor.js) loads only when you open it.
// Hook: public/host.html calls PLArrange.mount(h, d, isOwner) right after it draws the page, in the same frame, so
// nothing moves after the first paint. The server already put the live layout's CSS in <head> (server/pagelayout.js).
(function () {
  "use strict";
  const PLL = window.PLLayout; if (!PLL) return;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)], esc = PLL.esc;
  const read = () => { try { return JSON.parse($("#plLayout")?.textContent || "null"); } catch { return null; } };
  const A = { layout: read(), host: null, data: null, owner: false, editing: false };
  const styleEl = () => { let s = $("#plLayoutCss"); if (!s) { s = document.createElement("style"); s.id = "plLayoutCss"; document.head.appendChild(s); } return s; };
  // until a layout is on, the About section and the blocks stay out of sight (the bio is in the header as always)
  const BASE = "html:not(.pl-lay) :is(#plAbout,.plb,#plDrops,#plBook){display:none!important}";
  const baseCss = () => { if ($("#plBaseCss")) return; const s = document.createElement("style"); s.id = "plBaseCss"; s.textContent = BASE; document.head.appendChild(s); };
  const main = () => $("#m");

  // ---- About: the bio in its own section (the header keeps it when no layout is on) ----
  function about() { const h = A.host; if (!h || !main()) return; const bio = String(h.bio || "").trim(); let s = $("#plAbout");
    if (!bio && !A.editing) { s?.remove(); return; }
    const img = [h.theme?.coverUrl, (h.gallery || [])[0], h.theme?.avatarUrl].find((u) => /^\/_blob\/[A-Za-z0-9]{20}$/.test(u || "")) || "";
    const html = `<h2 class="sec">About</h2><div class="pla-ab">${bio ? `<p>${esc(bio)}</p>` : `<p class="pla-empty">Add a short bio in Edit page. Two lines is plenty.</p>`}${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ""}</div>`;
    if (!s) { s = document.createElement("section"); s.id = "plAbout"; s.className = "pla-about"; main().appendChild(s); }
    if (s.__h !== html) { s.innerHTML = html; s.__h = html; } }
  // ---- the host's own blocks ----
  function blocks() { const m = main(); if (!m) return; const L = A.layout, want = (L?.items || []).filter((x) => x.type), ids = new Set(want.map((x) => x.id));
    for (const el of $$(".plb", m)) if (!ids.has(el.dataset.pl)) el.remove();
    for (const b of want) { const html = PLL.blockHtml(b, { edit: A.editing }), cur = $(`.plb[data-pl="${b.id}"]`, m);
      if (!html) { cur?.remove(); continue; }
      if (cur && cur.__h === html) continue; const t = document.createElement("template"); t.innerHTML = html; const el = t.content.firstElementChild; el.__h = html;
      if (cur) cur.replaceWith(el); else m.appendChild(el); } }
  // ---- Order ahead and Book me: groups of the offer (public/hostitems.js), moved into their own section when the host turned it on ----
  const SPLIT = { drops: { id: "plDrops" }, book: { id: "plBook" } };
  function split() { const m = main(), off = $("#offer"); if (!m) return; const on = (id) => { const it = (A.layout?.items || []).find((x) => x.id === id); return !!(A.layout && it && !it.off); };
    for (const [key, S] of Object.entries(SPLIT)) { let sec = document.getElementById(S.id);
      if (sec && off && sec.__from !== off) { $$(".hi-g", sec).forEach((r) => r.remove()); sec.__from = off; } // the offer was drawn again: its new groups replace the old ones
      const g = (off && $(`.hi-g[data-g="${key}"]`, off)) || (sec && $(".hi-g", sec));
      if (!on(key) || !off || !g) { if (g && off && g.parentElement !== off) { const after = key === "drops" ? $('.hi-g[data-g="book"]', off) : null; off.insertBefore(g, after); } sec?.remove(); continue; }
      if (!sec) { sec = document.createElement("section"); sec.id = S.id; sec.className = "offer pla-split"; m.appendChild(sec); sec.__from = off; }
      if (g.parentElement !== sec) sec.appendChild(g); const hid = $("h2", g)?.id; if (hid) sec.setAttribute("aria-labelledby", hid); }
    // an offer left with nothing in it says so plainly, and comes back when its groups do
    if (off) { const left = $$(".hi-g .of-row, .hi-g .hi-row", off).length; off.classList.toggle("pla-emptied", !left && !!$("#plDrops, #plBook")); } }
  function sync() { if (!A.host) return; about(); blocks(); split(); }
  let q = 0; const soon = () => { if (q) return; q = 1; queueMicrotask(() => { q = 0; sync(); }); };

  /** Put a layout on the page (the editor calls this on every change): classes on <html>, the CSS, the blocks. */
  function apply(L) { A.layout = L || null; const de = document.documentElement;
    for (const c of [...de.classList]) if (c === "pl-lay" || /^pl[cv]-/.test(c)) de.classList.remove(c);
    if (L) { for (const c of PLL.classes(L)) de.classList.add(c); styleEl().textContent = PLL.css(L); } else $("#plLayoutCss")?.remove();
    sync(); }

  function mount(h, d, isOwner) { A.host = h; A.data = d; A.owner = !!isOwner; baseCss(); sync();
    const m = main(); if (m && !m.__plObs) { m.__plObs = new MutationObserver((recs) => { if (recs.some((r) => [...r.addedNodes].some((n) => n.nodeType === 1 && !n.closest?.(".pla-chrome") && (n.id === "offer" || n.matches?.(".of-row,.of-list") || n.querySelector?.(".of-row"))))) soon(); }); m.__plObs.observe(m, { childList: true, subtree: true }); }
    if (isOwner) door(); }

  // ---- the door, in Edit page, and ?arrange=1 ----
  function door() { const add = (pane) => { if (!pane || pane.querySelector(".pla-door")) return; const head = pane.querySelector(".sp-head"); if (!head) return;
      const el = document.createElement("div"); el.className = "pla-door"; el.innerHTML = `<span><b>Arrange your page</b><small>Drag sections around, pick a style, add your own.</small></span><button type="button" data-arrange>Arrange</button>`;
      head.after(el); el.querySelector("button").onclick = () => { pane.querySelector(".sp-x")?.click(); open(); }; };
    if (!$("#plaDoorCss")) { const s = document.createElement("style"); s.id = "plaDoorCss"; s.textContent = `.pla-door{display:flex;gap:12px;align-items:center;justify-content:space-between;margin:12px 0 4px;padding:12px;border:1.5px solid #1B1D1C;border-radius:6px;background:#F7EFCB;font-family:"IBM Plex Sans",system-ui,sans-serif}.pla-door b{display:block;font-size:16px}.pla-door small{display:block;font-size:14px;color:#444845}.pla-door button{min-height:44px;padding:0 18px;border:0;border-radius:6px;background:#29489A;color:#fff;font:600 16px "IBM Plex Sans",system-ui,sans-serif;cursor:pointer;flex:none}`; document.head.appendChild(s); }
    const watch = () => $$(".store-pane").forEach((p) => { add(p); if (!p.__plaObs) { p.__plaObs = new MutationObserver(() => add(p)); p.__plaObs.observe(p, { childList: true }); } });
    watch(); new MutationObserver(watch).observe(document.body, { childList: true });
    try { if (new URLSearchParams(location.search).get("arrange") === "1") setTimeout(open, 300); } catch {} }
  let loading = null;
  /** Open the editor (loads it the first time). */
  function open() { if (window.PLArrangeEditor) return window.PLArrangeEditor.open(A);
    if (!loading) loading = new Promise((ok, no) => { const s = document.createElement("script"); s.src = "/arrange-editor.js"; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
    return loading.then(() => window.PLArrangeEditor?.open(A)).catch(() => { loading = null; }); }

  window.PLArrange = { mount, apply, sync, open, state: A, read };
})();
