// Small surprises for hosts, in the app (server/surprise.js):
// - Milestones on Home: a stamped card for the 1st, 5th, 10th, 25th, 50th and 100th event hosted, the first sold-out one,
//   the first repeat guest and the first year, with a short thank-you from Potto and a share image. A card in the page,
//   never a popup; Close puts it away for good. Under it, "Your regulars": who came 2 or more times (only the host sees it).
// - A cover drawn for this event: in the cover picker and the "Change photo" sheet, the first tile is a line drawing
//   Potto made from the title ("Dumpling night with Jun" gets dumplings at night, not generic art). Choosing it saves the
//   shared cover recipe, coverArt { kind: "custom", svg, prompt, tone }, so every surface shows the same picture.
// - The host loop's once-only celebration (public/hostloop.js) shows as a card here instead of a sheet over the page.
(function () {
  if (window.PLTitleCover) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (s, r = document) => r.querySelector(s);
  const post = (u, b) => fetch(u, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) });
  const potto = (pose, size) => { try { return window.Potto ? window.Potto.svg(pose, size, "") : ""; } catch { return ""; } };
  const X = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
  const CSS = `.plms{margin:16px 0;display:grid;gap:12px}.plms-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.plms-card{position:relative;display:grid;grid-template-columns:auto 1fr;gap:14px;align-items:start;background:var(--pl-surface);border:var(--pl-bw,1.5px) solid var(--pl-line-strong);border-radius:6px;padding:16px 52px 16px 16px;color:var(--pl-ink)}
.plms-stamp{width:88px;height:88px;border-radius:50%;border:2.5px solid var(--pl-accent);box-shadow:inset 0 0 0 3px var(--pl-surface),inset 0 0 0 4.5px var(--pl-accent);display:grid;place-content:center;text-align:center;color:var(--pl-accent-text);transform:rotate(-8deg);background:var(--pl-accent-soft)}
.plms-stamp b{display:block;font:600 26px/1 var(--pl-font-serif);letter-spacing:-.02em}.plms-stamp small{display:block;font:600 11px/1.2 var(--pl-font-text);letter-spacing:.02em;margin-top:4px;white-space:nowrap}
.plms-card h3{margin:2px 0 4px;font:600 18px/1.25 var(--pl-font-text);letter-spacing:-.01em;overflow-wrap:anywhere}.plms-card p{margin:0;color:var(--pl-soft);font:400 15px/1.45 var(--pl-font-text)}
.plms-from{display:flex;gap:8px;align-items:flex-start;margin-top:6px}.plms-from svg{flex:none;width:28px;height:28px}
.plms-card~.plms-card .plsc-btn.is-go{background:var(--pl-surface);color:var(--pl-ink);border-color:var(--pl-line-strong)}.plms-acts{grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap}.plms-acts .plsc-acts{margin:0}
.plms-x{all:unset;position:absolute;top:6px;right:6px;width:44px;height:44px;display:grid;place-items:center;border-radius:6px;color:var(--pl-soft);cursor:pointer}.plms-x:focus-visible{outline:3px solid var(--pl-focus);outline-offset:1px}
.plms-reg{background:var(--pl-surface);border:var(--pl-bw,1.5px) solid var(--pl-line);border-radius:6px;padding:14px 16px}.plms-reg h3{margin:0 0 2px;font:600 16px/1.3 var(--pl-font-text)}.plms-reg>p{margin:0 0 10px;color:var(--pl-soft);font-size:14px}
.plms-reg ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:8px}.plms-reg li{display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:0 10px;border:1px solid var(--pl-line);border-radius:6px;background:var(--pl-page);font:500 14px/1.2 var(--pl-font-text)}.plms-reg li span{color:var(--pl-soft)}
.cvp-t[data-cvtitle] .cvp-sug{position:absolute;left:6px;top:6px;z-index:1;background:var(--pl-surface);border:1px solid var(--pl-line-strong);border-radius:6px;padding:1px 6px;font:600 12px/1.4 var(--pl-font-text);color:var(--pl-ink)}.cvp-t[data-cvtitle]{position:relative}
.cvp-t[data-cvtitle] .cvp-wait{position:absolute;inset:0;display:grid;place-items:center;background:var(--pl-raised);color:var(--pl-soft);font-size:13px;border-radius:6px}
@media (max-width:420px){.plms-card{grid-template-columns:1fr;padding-right:16px}.plms-stamp{width:84px;height:84px}}`;
  const css = () => { if ($("#plmsCss")) return; const s = document.createElement("style"); s.id = "plmsCss"; s.textContent = CSS; document.head.appendChild(s); };
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const onDay = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || "") ? `${MON[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}` : "");

  // ---------------- a cover drawn for this event ----------------
  const cache = new Map(); // title key -> { svg, title } | Promise
  const keyOf = (d) => `${d?.id || ""}|${String(d?.pubTitle || d?.name || "").trim().toLowerCase()}`;
  const titleOf = (d) => String(d?.pubTitle || d?.name || "").trim();
  function fetchFor(d) { const t = titleOf(d), k = keyOf(d); if (t.length < 3 || d.example) return Promise.resolve(null); const c = cache.get(k); if (c) return Promise.resolve(c);
    const A = window.EventArt, ev = { ...d, coverArt: null, title: t }, tone = d.coverArt?.drawnFor ? d.coverArt.tone : A ? A.toneOf(ev, A.kindOf(ev)) : "sky", spot = A?.SPOT?.[tone] || "#29489A";
    const p = post("/api/art/for-event", { eventId: d.id || "", title: t, activity: d.activity || "", spot }).then((r) => (r.ok ? r.json() : null)).then((j) => { const v = j?.svg ? { svg: j.svg, title: j.title, prompt: j.prompt, tone } : null; if (v) cache.set(k, v); else cache.delete(k); return v; }).catch(() => { cache.delete(k); return null; });
    cache.set(k, p); return p; }
  const ready = (d) => { const c = cache.get(keyOf(d)); return c && !(c instanceof Promise) ? c : null; };
  /** The shared cover recipe for this drawing (null until it's drawn). */
  const art = (d) => { const c = ready(d); return c ? { kind: "custom", svg: c.svg, prompt: c.prompt, tone: c.tone, drawnFor: "title" } : null; };
  const tileArt = (d, c) => window.EventArt.cover({ ...d, coverArt: null, title: titleOf(d) }, { svg: c.svg, tone: c.tone, title: "", label: "" }); // the drawing only, no words over it (the tile's label names it)
  const isMine = (d) => !d.coverPhoto && d.coverArt?.drawnFor === "title" && !!d.coverArt?.svg;
  /** For the "Change photo" sheet: the drawn tile first (the suggestion when there's no photo), then the usual ones. */
  function tiles(d, list) { const c = ready(d); if (!c || !window.EventArt || !Array.isArray(list)) return list; return [{ id: "drawn-for-event", label: "A cover Potto drew for this event", on: isMine(d), html: tileArt(d, c) }, ...list]; }
  const used = (d) => setTimeout(() => { try { post("/api/art/for-event/used", { eventId: d.id || "" }); } catch {} }, 2000); // after the save lands
  // the inline picker under the cover field: the same tile, first in the grid
  function paintPicker() { if (typeof draft === "undefined" || !draft || draft.example || !window.EventArt) return; const d = draft;
    document.querySelectorAll("#covField .cvp-grid").forEach((grid) => { if (grid.querySelector("[data-cvtitle]")) return; if (titleOf(d).length < 3) return;
      const b = document.createElement("button"); b.type = "button"; b.className = "cvp-t"; b.dataset.cvtitle = "1"; b.setAttribute("aria-label", "A cover Potto drew for this event");
      const on = isMine(d); if (on) { b.classList.add("on"); b.setAttribute("aria-pressed", "true"); } else b.setAttribute("aria-pressed", "false");
      const fill = (c) => { b.innerHTML = `${!d.coverPhoto && !on ? `<span class="cvp-sug">Suggested</span>` : ""}<span class="cvp-art">${tileArt(d, c)}</span>`; };
      const c = ready(d); if (c) fill(c); else { b.innerHTML = `<span class="cvp-art"><span class="cvp-wait">Potto is drawing</span></span>`; b.disabled = true; fetchFor(d).then((v) => { if (!v) { b.remove(); return; } b.disabled = false; fill(v); }); }
      grid.prepend(b);
      if (on) document.querySelectorAll("#covField [data-cvown]").forEach((x) => x.remove()); // the same drawing once, not twice
      b.onclick = async () => { const a = art(d); if (!a) return; d.coverArt = a; d.coverPhoto = ""; d.coverSource = ""; d.coverFocus = null;
        document.querySelectorAll("#covField").forEach((f) => { const box = f.parentElement; f.outerHTML = coverFieldHTML(d); try { wireCoverField(box.closest(".fedit") || box, d); } catch {} });
        try { await saveEvent(true); used(d); toast((d.published || d.discoverable) ? "Potto's drawing is the cover now. Guests see it everywhere." : "Potto's drawing is the cover now."); } catch {} }; }); }
  // the sheet waits a moment for the drawing, so the tile is there when it opens
  function wrapSheet() { const orig = window.openCoverSheet; if (typeof orig !== "function" || orig.__plt) return;
    const w = async function (d, after) { d = d || (typeof draft !== "undefined" ? draft : null); if (d && !d.example) await Promise.race([fetchFor(d), new Promise((r) => setTimeout(r, 2500))]); return orig.call(this, d, after); };
    w.__plt = 1; window.openCoverSheet = w; }
  let tT = 0; document.addEventListener("input", (e) => { if (!e.target.closest?.("#fe-name") || typeof draft === "undefined" || !draft) return; clearTimeout(tT);
    tT = setTimeout(() => { document.querySelectorAll("#covField [data-cvtitle]").forEach((x) => x.remove()); paintPicker(); }, 1200); });

  // ---------------- milestones and regulars on Home ----------------
  let M = null, loop = null;
  const card = (c) => `<article class="plms-card" data-ms="${esc(c.id)}"><div class="plms-stamp" aria-hidden="true"><b>${esc(c.stamp)}</b><small>${esc(onDay(c.on))}</small></div>
    <div><h3>${esc(c.title)}</h3><div class="plms-from">${potto("cheer", 28)}<p><span class="plms-sr">Potto says: </span>${esc(c.line)}</p></div></div>
    ${c.png ? `<div class="plms-acts" data-plms-acts></div>` : ""}<button type="button" class="plms-x" data-plms-x aria-label="Close this card">${X}</button></article>`;
  function html() { const C = [...(loop ? [loop] : []), ...((M && M.cards) || [])], R = (M && M.regulars) || [];
    if (!C.length && !R.length) return "";
    return `<section class="plms" id="plmsBox" aria-label="Milestones and regulars">${C.map(card).join("")}${R.length ? `<div class="plms-reg"><h3>Your regulars</h3><p>People who came to ${M.regularMin || 2} or more of your events. Only you see this.</p><ul>${R.map((r) => `<li>${esc(r.name)} <span>${esc(r.times)} times</span></li>`).join("")}</ul></div>` : ""}</section>`; }
  function wire(box) {
    box.querySelectorAll("[data-plms-x]").forEach((b) => (b.onclick = () => { const a = b.closest("[data-ms]"), id = a.dataset.ms; a.remove(); if (loop && loop.id === id) loop = null; else { if (M) M.cards = M.cards.filter((c) => c.id !== id); post(`/api/me/milestones/${encodeURIComponent(id)}/close`); } if (!box.querySelector(".plms-card,.plms-reg")) box.remove(); }));
    const acts = box.querySelectorAll("[data-plms-acts]"); if (!acts.length) return;
    const fill = () => { acts.forEach((el) => { const id = el.closest("[data-ms]").dataset.ms, c = (M?.cards || []).find((x) => x.id === id); if (!c || el.childElementCount) return;
      el.innerHTML = window.PLShareCards.actions({ png: c.png, name: `pottery-lab-${id}.png`, title: c.title }); window.PLShareCards.wire(el);
      el.addEventListener("click", (e) => { const t = e.target.closest("[data-plsc-save],[data-plsc-share]"); if (t) post(`/api/me/milestones/${encodeURIComponent(id)}/shared?via=${t.matches("[data-plsc-save]") ? "save" : "share"}`); }); }); };
    // the share buttons come from public/sharecards.js, loaded once; a box drawn again while it loads still gets them
    shareLib().then((ok) => { if (ok && box.isConnected) { window.PLShareCards.css(); fill(); } }); }
  let libP = null;
  const shareLib = () => (window.PLShareCards ? Promise.resolve(true) : (libP = libP || new Promise((res) => { const s = document.createElement("script"); s.src = "/sharecards.js"; s.onload = () => res(!!window.PLShareCards); s.onerror = () => { libP = null; res(false); }; document.head.appendChild(s); })));
  function place() { const view = document.getElementById("view-programs"); if (!view || view.hidden) return; css(); view.querySelector("#plmsBox")?.remove(); const h = html(); if (!h) return;
    const hl = view.querySelector("#hlCard"), anchor = hl || view.querySelector("#qsPanel")?.closest("section") || null;
    if (anchor && anchor.parentElement) anchor.insertAdjacentHTML("afterend", h); else view.insertAdjacentHTML("beforeend", h);
    wire(view.querySelector("#plmsBox")); }
  let at = 0;
  let busy = null; // one request at a time; callers that arrive meanwhile wait for it
  async function home(force) { const view = document.getElementById("view-programs"); if (!view || view.hidden) return;
    if (busy || force || !M || Date.now() - at > 60e3) { busy = busy || fetch("/api/me/milestones", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) { M = j; at = Date.now(); } }).catch(() => {}).finally(() => { busy = null; }); await busy; if (!M) return; }
    place(); }
  // Home can draw, or redraw its contents, before this file loads or without a hashchange: whenever it is showing
  // without the cards, they go back in (placing is a no-op once they're in, and the data is fetched once a minute at most)
  let watchT = 0;
  function watchHome() { const v = document.getElementById("view-programs"); if (!v || v.__plms) return; v.__plms = 1;
    new MutationObserver(() => { if (v.hidden || watchT || v.querySelector("#plmsBox")) return; watchT = setTimeout(() => { watchT = 0; if (!v.hidden && !v.querySelector("#plmsBox")) home(false); }, 150); }).observe(v, { attributes: true, attributeFilter: ["hidden"], childList: true });
    if (!v.hidden) home(false); }
  /** The host loop's once-only celebration, as a card here (public/hostloop.js calls this instead of its sheet). */
  function loopCard(c) { if (!c) return; if (["tenth", "soldout"].includes(c.id)) return; // the milestone cards above say these
    loop = { id: "loop-" + c.id, stamp: c.id === "firstyes" ? "Yes" : c.id === "regular" ? "3x" : "1st", title: c.title, line: c.line, on: new Date().toISOString().slice(0, 10) }; place(); }
  function mount() {
    if (typeof window.renderPrograms === "function" && !window.renderPrograms.__plms) { const orig = window.renderPrograms, w = function () { const r = orig.apply(this, arguments); setTimeout(() => home(false), 0); return r; }; w.__plms = 1; window.renderPrograms = w; }
    window.addEventListener("hashchange", () => setTimeout(() => home(false), 60)); setTimeout(() => home(true), 450); watchHome();
    wrapSheet(); new MutationObserver(() => { wrapSheet(); if (document.querySelector("#covField .cvp-grid:not(:has([data-cvtitle]))")) paintPicker(); }).observe(document.documentElement, { childList: true, subtree: true }); }
  if (location.pathname === "/" || location.pathname === "/index.html") document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", mount) : mount();
  window.PLTitleCover = { tiles, art, fetchFor, used };
  window.PLMilestones = { home, loopCard };
})();
