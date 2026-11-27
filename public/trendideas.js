// Potto's ideas, everywhere it proposes something to host (server/trends.js). Each idea carries a quiet source line,
// so nobody mistakes one kind for another:
//   "Loved here: 18 guests, 94% would go again"   measured from public events on Pottery Lab
//   "Trending on social"                          the team's hand-written trend notes, never measured
//   "An idea from Potto"                          a general idea from the ideas library or the model
//
//   PLTrendIdeas.fetch({ n, offset })       { ideas, more } from GET /api/public/ideas/suggest, signed in or not
//   PLTrendIdeas.mount(el, { onPick, n })   3 to 5 ideas with Use this and More ideas. Cached, so a redraw (the create
//                                           canvas redraws often) paints at once from what it already has.
//   PLTrendIdeas.suggestFor(text)           ideas whose title or plan contains the text
//   PLTrendIdeas.bank()                     a live list for the autocomplete bank (PLSuggest.attach({ extra }))
//   PLTrendIdeas.home()                     the host's "What's working near you" card on Home (also runs by itself)
// Field Notes kit: --pl-* tokens, IBM Plex, 6px corners, 44px targets, ink-blue primary.
(function () {
  if (window.PLTrendIdeas) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ls = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
  const city = () => { let c = ""; try { c = (window.EncorePlace?.get?.() || {}).city || ""; } catch {} if (!c) { try { c = localStorage.getItem("encore.city") || ""; } catch {} } if (!c) c = ls("pl.interests")?.city || ""; return String(c || "").slice(0, 60); };
  const interests = () => { const p = ls("pl.interests"); return (Array.isArray(p) ? p : p?.interests || []).join(","); };
  const pages = new Map(), ready = new Map(); // "n|offset" -> Promise<{ ideas, more }>, and the ones that have arrived
  function fetchIdeas({ n = 4, offset = 0 } = {}) { const k = `${n}|${offset}`; if (pages.has(k)) return pages.get(k);
    const q = new URLSearchParams({ n: String(n), offset: String(offset) }); const c = city(), i = interests(); if (c) q.set("city", c); if (i) q.set("interests", i);
    const p = fetch("/api/public/ideas/suggest?" + q, { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : { ideas: [] })).then((j) => ({ ideas: j.ideas || [], more: !!j.more })).catch(() => ({ ideas: [], more: false }));
    p.then((r) => ready.set(k, r)); pages.set(k, p); return p; }
  function css() { if (document.getElementById("ptiCss")) return; const s = document.createElement("style"); s.id = "ptiCss"; s.textContent = `
.pti{border:1px solid var(--pl-line-strong,#1B1D1C);border-radius:6px;background:var(--pl-surface,#FAF8F3);padding:12px 14px;margin:12px 0;color:var(--pl-ink,#1B1D1C);font-family:var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif)}
.pti-k{margin:0;font:500 12px/1.4 var(--pl-font-mono,"IBM Plex Mono",monospace);letter-spacing:.08em;text-transform:uppercase;color:var(--pl-soft,#444845)}
.pti-h3{margin:2px 0 0;font:600 16px/1.3 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif)}
.pti-l{list-style:none;margin:6px 0 0;padding:0}.pti-l li{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px dashed var(--pl-line,#CFC8B9)}.pti-l li:first-child{border-top:0}
.pti-t{flex:1;min-width:0}.pti-t b{display:block;font:600 15px/1.3 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif)}.pti-t span{display:block;font-size:14px;line-height:1.4;color:var(--pl-soft,#444845)}
.pti-s{display:block;margin-top:2px;font:400 12px/1.4 var(--pl-font-mono,"IBM Plex Mono",monospace);color:var(--pl-soft,#444845)}
.pti-use,.pti-more{flex:none;min-height:44px;min-width:44px;padding:0 14px;border-radius:6px;border:1px solid var(--pl-line-strong,#1B1D1C);background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);font:600 14px var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);cursor:pointer}
.pti-use{background:var(--pl-accent,#29489A);border-color:var(--pl-accent,#29489A);color:var(--pl-on-accent,#fff)}
.pti-more{display:block;margin:6px 0 0;background:transparent;border-color:transparent;color:var(--pl-accent,#29489A);padding:0 2px}
#cv .pti .pti-use,body .pti .pti-use{color:var(--pl-on-accent,#fff)}#cv .pti .pti-more,body .pti .pti-more{color:var(--pl-accent,#29489A)}
.pti-use:focus-visible,.pti-more:focus-visible{outline:2px solid var(--pl-focus,#29489A);outline-offset:2px}
.pti-cmp{margin:10px 0 0;padding-top:10px;border-top:1px dashed var(--pl-line,#CFC8B9);font-size:14px;line-height:1.4}
`; document.head.appendChild(s); }
  const row = (x, i, pick) => `<li><div class="pti-t"><b>${esc(x.title)}</b>${x.line ? `<span>${esc(x.line)}</span>` : ""}<small class="pti-s" data-source="${esc(x.source)}">${esc(x.sourceLine || "An idea from Potto")}</small></div><button type="button" class="pti-use" data-pti="${i}" aria-label="${esc(pick)}: ${esc(x.title)}">${esc(pick)}</button></li>`;
  const states = new WeakMap();
  /** Paint ideas into el. onPick(idea) runs on Use this. Repaints from cache when called again on a fresh element.
   *  ready: true paints only ideas that have already arrived (the canvas: it never pops a box in above the page; the
   *  ideas show on its next redraw instead). */
  async function mount(el, { onPick = null, n = 3, lead = "Ideas from Potto", sub = "", pick = "Use this", key = "", ready: onlyReady = false } = {}) {
    if (!el) return []; css(); const k = key || el.id || "pti"; const st = mount.mem[k] || (mount.mem[k] = { offset: 0 }); states.set(el, st);
    const paint = (r) => { if (!r.ideas.length) { el.hidden = true; return; } el.hidden = false; st.r = r;
      el.innerHTML = `<section class="pti" aria-label="${esc(lead)}"><p class="pti-k">${esc(lead)}</p>${sub ? `<p class="pti-h3">${esc(sub)}</p>` : ""}<ul class="pti-l">${r.ideas.map((x, i) => row(x, i, pick)).join("")}</ul>${r.more || st.offset ? `<button type="button" class="pti-more" data-pti-more>${r.more ? "More ideas" : "Back to the first ideas"}</button>` : ""}</section>`;
      el.querySelectorAll("[data-pti]").forEach((b) => (b.onclick = () => { const x = r.ideas[+b.dataset.pti]; if (x) (onPick || start)(x); }));
      const m = el.querySelector("[data-pti-more]"); if (m) m.onclick = async () => { st.offset = r.more ? st.offset + n : 0; m.disabled = true; paint(await fetchIdeas({ n, offset: st.offset })); el.querySelector(".pti-use")?.focus(); }; };
    if (st.r && st.n === n) { paint(st.r); return st.r.ideas; }
    st.n = n; const k2 = `${n}|${st.offset}`; if (onlyReady && !ready.has(k2)) { el.hidden = true; fetchIdeas({ n, offset: st.offset }); return []; }
    const r = ready.get(k2) || (await fetchIdeas({ n, offset: st.offset })); paint(r); return r.ideas; }
  mount.mem = {};
  /** Start a new event from an idea: the create canvas with its kind, and the title filled in. */
  function start(x) { const C = window.EventCanvas; if (!C?.open) { location.href = "/start"; return; }
    Promise.resolve(C.open({ mode: "new", ...(x.kind ? { kind: x.kind } : {}) })).then(() => setTimeout(() => { const t = document.getElementById("cvTitle"); if (t && !t.value.trim()) { t.value = x.title; t.dispatchEvent(new Event("input", { bubbles: true })); } }, 80)); }
  /** Candidates for the autocomplete bank (public/autocomplete.js PLSuggest.attach({ extra })): a live list, filled
   *  once the ideas arrive, each with its source as the row's hint ("Loved here: ...", "Trending on social"). */
  function bank() { if (bank.L) return bank.L; const L = (bank.L = []);
    Promise.all([fetchIdeas({ n: 5, offset: 0 }), fetchIdeas({ n: 5, offset: 5 })]).then((R) => { for (const x of R.flatMap((r) => r.ideas)) L.push({ t: x.title, k: x.kind || "", title: x.title, hint: x.sourceLine || "An idea from Potto", src: "trends" }); }); return L; }
  /** For autocomplete (public/autocomplete.js, window.PLSuggest): up to 5 ideas that match what someone is typing. */
  async function suggestFor(text = "", n = 5) { const t = String(text || "").trim().toLowerCase(); const r = await fetchIdeas({ n: 5, offset: 0 }), r2 = r.more ? await fetchIdeas({ n: 5, offset: 5 }) : { ideas: [] };
    const L = [...r.ideas, ...r2.ideas]; return (t ? L.filter((x) => x.title.toLowerCase().includes(t) || (x.say || "").toLowerCase().includes(t)) : L).slice(0, n).map((x) => ({ text: x.say || x.title, title: x.title, source: x.source, sourceLine: x.sourceLine })); }

  // ---------- Home: "What's working near you" ----------
  const signedIn = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  function homeData() { if (home.p && Date.now() - home.at < 5 * 60e3) return home.p; home.at = Date.now();
    return (home.p = fetch("/api/me/trends/home", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((j) => (home.j = j || false))); }
  function home() { const v = document.getElementById("view-programs"); if (!v || v.hidden || document.getElementById("ptiHome") || !window.__wsPersonal) return;
    const j = home.j; if (j === undefined) { if (signedIn() && !home.wait) { home.wait = 1; homeData().then(() => { home.wait = 0; if (home.j) home(); }); } return; } if (!j) return;
    if (!(j.top || []).length && !(j.compare || []).length) return; css();
    const box = document.createElement("div"); box.id = "ptiHome";
    box.innerHTML = `<section class="pti" aria-labelledby="ptiHomeH"><p class="pti-k">${esc(j.city ? "Near you, " + j.city : "Near you")}</p><h3 class="pti-h3" id="ptiHomeH">What's working near you</h3>
      ${(j.top || []).length ? `<ul class="pti-l">${j.top.map((x, i) => `<li><div class="pti-t"><b>${esc(x.title)}</b><span>${esc(x.reason)}</span></div><button type="button" class="pti-use" data-pth="${i}" aria-label="Plan one: ${esc(x.title)}">Plan one</button></li>`).join("")}</ul>` : ""}
      ${(j.compare || []).map((l) => `<p class="pti-cmp">${esc(l)}</p>`).join("")}</section>`;
    box.querySelectorAll("[data-pth]").forEach((b) => (b.onclick = () => start(j.top[+b.dataset.pth])));
    // under the composer when that spot is off screen (nothing on screen moves), else at the end of Home
    const after = v.querySelector("#whatsNew") || v.querySelector("#qsPanel:not([hidden])") || v.querySelector("#pipHome");
    if (after && after.getBoundingClientRect().bottom >= innerHeight) after.after(box); else v.append(box); }
  // Home's "Ideas to try" shelf (index.html ideaLibraryHTML): the same quiet source line under each card
  function shelf() { const C = [...document.querySelectorAll("#ideaLib [data-casualidea]:not([data-src])")]; if (!C.length || shelf.busy) return; shelf.busy = 1; C.forEach((c) => c.setAttribute("data-src", ""));
    const q = new URLSearchParams({ titles: C.map((c) => c.dataset.casualidea).join("|") }); if (city()) q.set("city", city());
    fetch("/api/public/ideas/labels?" + q, { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : { labels: [] })).catch(() => ({ labels: [] })).then((j) => { shelf.busy = 0; css();
      C.forEach((c, i) => { const L = j.labels?.[i]; if (!L?.sourceLine || c.querySelector(".pti-s")) return; const sm = document.createElement("small"); sm.className = "pti-s"; sm.dataset.source = L.source; sm.textContent = L.sourceLine; c.appendChild(sm); }); }); }
  const tick = () => { if (!document.getElementById("ptiHome") && document.getElementById("view-programs")) home(); if (document.getElementById("ideaLib")) shelf(); };
  if (typeof MutationObserver === "function" && document.documentElement) new MutationObserver(tick).observe(document.documentElement, { childList: true, subtree: true });
  // in the app, signed in: fetch early, so the canvas and Home draw the ideas with the page instead of after it
  try { if (signedIn() && (/[?&]app=1/.test(location.search) || location.pathname === "/")) { homeData(); fetchIdeas({ n: 3, offset: 0 }); } } catch {}
  window.PLTrendIdeas = { fetch: fetchIdeas, mount, start, suggestFor, bank, home };
})();
