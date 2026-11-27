// The year in nights: a tap-through story of share cards (public/sharecards.js draws each one from the spec the server
// also turns into a PNG, server/places.js). /year/<year> is yours (live all year as "so far", the full story in
// December); /y/<token> is a link you chose to share. Also the calm card on Home in December and at a milestone night.
//
// Moving through it: tap the right of a card (or swipe left, or the right arrow key, or Space) for the next, the left
// for the one before; Escape closes an open panel, then goes back. Cards move on by themselves, slowly, and stop on
// the last one; Pause holds them. People who ask their device for less motion get no motion at all: nothing moves on
// by itself and nothing fades.
//
//   PLYear.player(el, data, { pngOf, edition, onType, onEdition, share })   the story in an element
//   PLYear.prompt()                                                           the Home card, when there is one
(function () {
  if (window.PLYear) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const REDUCE = window.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  const STEP_MS = 8000;
  const SC = () => window.PLShareCards;
  const getJ = async (u) => { const r = await fetch(u, { credentials: "same-origin" }); if (!r.ok) throw Object.assign(new Error("http " + r.status), { status: r.status }); return r.json(); };
  const ICON = { x: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    pause: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M7 5v10M13 5v10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    play: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M7 4.5v11l8.5-5.5z" fill="currentColor"/></svg>',
    prev: '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M12.5 4.5L7 10l5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    next: '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M7.5 4.5L13 10l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' };

  /** The story player. data: what GET /api/me/year/:year (or /api/public/year/:token) returns. */
  function player(el, data, o = {}) { css(); const cards = data.cards || [], N = cards.length, back = o.back || "/me";
    let i = Math.max(0, Math.min(N - 1, o.start || 0)), paused = REDUCE.matches || N < 2, swiped = 0;
    const ed = (data.editions || []).length > 1 && o.onEdition ? `<div class="ply-ed" role="group" aria-label="Which story">${data.editions.map((e) => `<button type="button" data-ed="${e}" aria-pressed="${data.edition === e}">${e === "host" ? "Host edition" : "Every night"}</button>`).join("")}</div>` : "";
    el.innerHTML = `<section class="ply" aria-roledescription="story" aria-label="${esc(o.label || `Your ${data.year} in nights`)}">
      <div class="ply-bars" aria-hidden="true">${cards.map(() => "<i><b></b></i>").join("")}</div>
      <div class="ply-head"><span class="ply-count" id="plyCount" aria-live="polite"></span><span class="ply-sp"></span>${N > 1 && !REDUCE.matches ? `<button type="button" class="ply-ib" id="plyPause" aria-label="Pause">${ICON.pause}</button>` : ""}<a class="ply-ib" href="${esc(back)}" aria-label="Close">${ICON.x}</a></div>
      ${ed}
      <div class="ply-stage" id="plyStage" tabindex="0" aria-label="Card. Use the arrow keys to move through the story."><div class="ply-card" id="plyCard"></div>
        <button type="button" class="ply-zone ply-prev" id="plyPrev" aria-label="Previous card">${ICON.prev}</button><button type="button" class="ply-zone ply-next" id="plyNext" aria-label="Next card">${ICON.next}</button></div>
      <div class="ply-tools" id="plyTools"></div>
      <div class="ply-custom" id="plyCustom" hidden></div>
      ${o.extra || ""}</section>`;
    const $ = (s) => el.querySelector(s), bars = [...el.querySelectorAll(".ply-bars i")];
    function draw() { const c = cards[i]; if (!c) return; const card = $("#plyCard");
      card.classList.remove("in"); card.innerHTML = SC().html(c.spec, { photo: c.photo || "", photoNote: c.photoNote || "" }); void card.offsetWidth; card.classList.add("in");
      $("#plyCount").textContent = `${i + 1} of ${N}: ${[c.spec.kicker, c.spec.title].filter(Boolean).join(". ")}`;
      bars.forEach((b, k) => { b.className = k < i ? "done" : k === i ? (paused || i === N - 1 ? "now still" : "now run") : ""; const f = b.firstChild; f.style.animation = "none"; void f.offsetWidth; f.style.animation = ""; });
      $("#plyPrev").disabled = i === 0; $("#plyNext").disabled = i === N - 1;
      const png = o.pngOf ? o.pngOf(c.id) : "", name = `pottery-lab-${data.year}-${c.id}.png`;
      $("#plyTools").innerHTML = (png ? SC().actions({ png, name, link: o.share?.url || "", title: `${data.year} in nights` }) : "") + (c.summary && o.onType ? `<button type="button" class="plsc-btn" id="plyCust" aria-expanded="false" aria-controls="plyCustom">Customize</button>` : "") + (c.summary && png ? `<a class="ply-wide" href="${esc(png + (png.includes("?") ? "&" : "?") + "size=link")}" download="pottery-lab-${data.year}-wide.png">Wide card for a link</a>` : "");
      SC().wire($("#plyTools")); const cu = $("#plyCust"); if (cu) cu.onclick = () => openCustom(cu);
      if (!c.summary) $("#plyCustom").hidden = true; }
    function openCustom(btn) { const box = $("#plyCustom"), on = box.hidden; box.hidden = !on; btn.setAttribute("aria-expanded", String(on)); if (!on) return;
      const T = [{ id: "all", label: "All nights" }, ...(data.types || []).map((t) => ({ id: t.id, label: `${t.label} (${t.n})` }))];
      box.innerHTML = `<p class="ply-q">Show on the summary</p><div class="ply-chips" role="radiogroup" aria-label="Which nights">${T.map((t) => `<button type="button" role="radio" aria-checked="${(data.type || "all") === t.id}" data-type="${esc(t.id)}">${esc(t.label)}</button>`).join("")}</div>`;
      box.querySelectorAll("[data-type]").forEach((b) => (b.onclick = () => o.onType(b.dataset.type))); box.querySelector("[aria-checked=true]")?.focus(); }
    const go = (k) => { if (k < 0 || k >= N || k === i) return; i = k; if (i === N - 1) paused = true; draw(); };
    const next = () => go(i + 1), prev = () => go(i - 1);
    $("#plyNext").onclick = () => { if (Date.now() - swiped > 400) next(); }; $("#plyPrev").onclick = () => { if (Date.now() - swiped > 400) prev(); };
    el.querySelector(".ply-bars").addEventListener("animationend", (e) => { if (e.target.parentElement?.classList.contains("now") && !paused) next(); });
    const pb = $("#plyPause"); const setPause = (p) => { paused = p; if (pb) { pb.innerHTML = p ? ICON.play : ICON.pause; pb.setAttribute("aria-label", p ? "Play" : "Pause"); } bars.forEach((b, k) => { if (k === i) b.className = p ? "now still" : "now run"; }); };
    if (pb) pb.onclick = () => setPause(!paused);
    if (el.__plyVis) document.removeEventListener("visibilitychange", el.__plyVis); el.__plyVis = () => { if (document.hidden && !paused) setPause(true); }; document.addEventListener("visibilitychange", el.__plyVis);
    // swipe: a sideways drag of 40px or more
    const st = $("#plyStage"); let sx = null, sy = null;
    st.addEventListener("pointerdown", (e) => { sx = e.clientX; sy = e.clientY; }); st.addEventListener("pointerup", (e) => { if (sx == null) return; const dx = e.clientX - sx, dy = e.clientY - sy; sx = null; if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { swiped = Date.now(); dx < 0 ? next() : prev(); } });
    st.addEventListener("touchstart", () => { if (!paused && !REDUCE.matches) setPause(true); }, { passive: true });
    const key = (e) => { if (!document.body.contains(el)) return document.removeEventListener("keydown", key); if (e.target.closest && e.target.closest("input,textarea,select")) return;
      if (e.key === "ArrowRight" || (e.key === " " && e.target === st)) { e.preventDefault(); next(); } else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
      else if (e.key === "Escape") { const box = $("#plyCustom"); if (box && !box.hidden) { box.hidden = true; $("#plyCust")?.focus(); } else location.href = back; } };
    if (el.__plyKey) document.removeEventListener("keydown", el.__plyKey); el.__plyKey = key; document.addEventListener("keydown", key);
    el.querySelectorAll("[data-ed]").forEach((b) => (b.onclick = () => o.onEdition(b.dataset.ed)));
    draw(); if (o.focus) st.focus({ preventScroll: true });
    return { go, next, prev, get index() { return i; } }; }

  // ---- the page: /year/<year> (yours) and /y/<token> (a shared link) ----
  async function page() { const m = document.getElementById("m"); if (!m) return; const mine = location.pathname.match(/^\/year\/(20\d\d)\/?$/), tok = location.pathname.match(/^\/y\/([A-Za-z0-9_-]{16,40})\/?$/);
    const potto = (p) => `<img src="/og/kit/potto-${p}.png" alt="" width="96" height="96" class="ply-potto">`;
    if (tok) { let d; try { d = await getJ("/api/public/year/" + tok[1]); } catch { m.innerHTML = `<div class="ply-out">${potto("think")}<h1>This link was turned off</h1><p>Whoever shared it can make a new one. Or make your own year in nights.</p><a class="plsc-btn is-go" href="/year/${new Date().getFullYear()}">Make your own</a></div>`; return; }
      document.title = `${d.first ? d.first + "'s" : "A"} ${d.year} in nights · Pottery Lab`;
      player(m, d, { label: document.title, back: "/", pngOf: (id) => `/y/${tok[1]}/${id}.png`, extra: `<div class="ply-own"><p><b>Make your own.</b> Your year in nights, free, on web and phone.</p><a class="plsc-btn is-go" href="/year/${d.year}">Make your own</a></div>` }); return; }
    if (!mine) return; const Y = mine[1]; let type = "all", edition = "guest", at = 0;
    const load = async () => { let d; try { if (!/(?:^|;\s*)encore_in=1/.test(document.cookie)) throw Object.assign(new Error("signed out"), { status: 401 }); d = await getJ(`/api/me/year/${Y}?type=${encodeURIComponent(type)}&edition=${edition}`); }
      catch (e) { m.innerHTML = e.status === 401 ? `<div class="ply-out">${potto("wave")}<h1>Your ${Y} in nights</h1><p>Where you went, who you went back to, and a card to share. Free, on web and phone.</p><a class="plsc-btn is-go" href="/login?next=${encodeURIComponent("/year/" + Y)}">Sign in to see yours</a></div>` : `<div class="ply-out"><p>Couldn't load your year. Check your connection, then try again.</p></div>`; return; }
      const q = `type=${encodeURIComponent(type)}&edition=${edition}`, start = at === "summary" ? d.cards.findIndex((c) => c.summary) : 0;
      const link = `<div class="ply-link" id="plyLink"><label class="ply-sw"><input type="checkbox" id="plyShare"${d.share?.on ? " checked" : ""}><span><b>A public link</b><small>Anyone with it sees these cards and nothing else. Off until you turn it on.</small></span></label><p class="ply-url" id="plyUrl">${d.share?.on ? `<a href="${esc(d.share.url)}">${esc(location.origin + d.share.url)}</a>` : ""}</p></div>`;
      const live = d.live ? `<p class="ply-live">Your year so far. It keeps filling in until December 31.</p>` : "";
      player(m, d, { start: Math.max(0, start), pngOf: (id) => `/api/me/year/${Y}/card/${id}.png?${q}`, share: d.share, focus: at !== 0, extra: link + live,
        onType: (t) => { type = t; at = "summary"; load(); }, onEdition: (e) => { edition = e; type = "all"; at = 0; load(); } });
      const sw = document.getElementById("plyShare"); if (sw) sw.onchange = async () => { try { const r = await fetch(`/api/me/year/${Y}/share`, { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on: sw.checked, type, edition }) }); const j = await r.json();
        document.getElementById("plyUrl").innerHTML = j.on ? `<a href="${esc(j.url)}">${esc(location.origin + j.url)}</a>` : ""; } catch { sw.checked = !sw.checked; } }; };
    await load(); }

  // ---- the calm card on Home: in December, and at a milestone night ----
  async function prompt() { if (!/(?:^|;\s*)encore_in=1/.test(document.cookie)) return; const spot = document.querySelector("main#m"); if (!spot || document.getElementById("plyPrompt")) return;
    let p; try { p = await getJ("/api/me/places/prompt"); } catch { return; } if (!p?.show) return; let seen = false; try { seen = !!localStorage.getItem("pl.yearPrompt." + p.key); } catch {} if (seen) return; css();
    const d = document.createElement("aside"); d.id = "plyPrompt"; d.className = "ply-prompt"; d.setAttribute("aria-label", p.title);
    d.innerHTML = `<img src="/og/kit/potto-cheer.png" alt="" width="64" height="64"><div><b>${esc(p.title)}</b><p>${esc(p.line)}</p><div class="ply-pa"><a class="plsc-btn is-go" href="${esc(p.link)}">${esc(p.cta)}</a><button type="button" class="ply-later">Later</button></div></div>`;
    spot.parentElement.insertBefore(d, spot); d.querySelector(".ply-later").onclick = () => { try { localStorage.setItem("pl.yearPrompt." + p.key, "1"); } catch {} d.remove(); }; }

  const CSS = `
.ply{display:grid;grid-template-columns:minmax(0,1fr);gap:12px}
.ply-bars{display:flex;gap:4px}.ply-bars i{flex:1;height:4px;border-radius:2px;background:var(--pl-line,#CFC8B9);overflow:hidden}.ply-bars i b{display:block;height:100%;width:0;background:var(--pl-ink,#1B1D1C)}
.ply-bars i.done b,.ply-bars i.now.still b{width:100%}.ply-bars i.now.run b{animation:plyFill ${STEP_MS}ms linear forwards}
@keyframes plyFill{from{width:0}to{width:100%}}
.ply-head{display:flex;align-items:center;gap:8px;min-height:44px}.ply-count{font:500 13px/1.3 var(--pl-font-mono,ui-monospace,monospace);letter-spacing:.04em;color:var(--pl-soft,#444845);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1 1 0}.ply-sp{flex:none}
.ply-ib{display:inline-grid;place-items:center;width:44px;height:44px;border-radius:50%;border:1.5px solid var(--pl-line-strong,#1B1D1C);background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);cursor:pointer;flex:none}
.ply-ed{display:flex;gap:8px;flex-wrap:wrap}.ply-ed button,.ply-chips button{min-height:44px;padding:0 14px;border-radius:999px;border:1.5px solid var(--pl-line-strong,#1B1D1C);background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);font:600 15px var(--pl-font-text,system-ui,sans-serif);cursor:pointer}
.ply-ed button[aria-pressed=true],.ply-chips button[aria-checked=true]{background:var(--pl-ink,#1B1D1C);color:var(--pl-surface,#FAF8F3)}
.ply-stage{position:relative;min-width:0;outline:none;touch-action:pan-y;user-select:none;-webkit-user-select:none}.ply-stage:focus-visible{outline:3px solid var(--pl-accent,#29489A);outline-offset:4px;border-radius:8px}
.ply-card{opacity:1}.ply-card.in{animation:plyIn .24s ease-out}@keyframes plyIn{from{opacity:.25}to{opacity:1}}
.ply-card{min-width:0}.ply-card .plsc{width:min(100%, calc((100svh - 230px) * 9 / 16));min-width:0;margin:0 auto}
.ply-zone{position:absolute;top:0;bottom:0;border:0;background:transparent;color:var(--pl-ink,#1B1D1C);cursor:pointer;display:flex;align-items:center;padding:0 4px;opacity:0}
.ply-prev{left:0;width:32%;justify-content:flex-start}.ply-next{right:0;width:68%;justify-content:flex-end}.ply-zone:disabled{cursor:default}
.ply-zone:focus-visible{opacity:1;outline:3px solid var(--pl-accent,#29489A);outline-offset:-3px}
@media (hover:hover){.ply-stage:hover .ply-zone:not(:disabled){opacity:.85}.ply-zone svg{background:var(--pl-surface,#FAF8F3);border:1.5px solid var(--pl-line-strong,#1B1D1C);border-radius:50%;width:36px;height:36px;padding:7px}}
.ply-tools{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.ply-wide{font-size:15px;color:var(--pl-accent-text,#29489A);min-height:44px;display:inline-flex;align-items:center}
.ply-custom{background:var(--pl-surface,#FAF8F3);border:1.5px solid var(--pl-line-strong,#1B1D1C);border-radius:var(--pl-r-md,6px);padding:12px}.ply-q{margin:0 0 8px;font-weight:600}.ply-chips{display:flex;flex-wrap:wrap;gap:8px}
.ply-link{border-top:1.5px dashed var(--pl-line,#CFC8B9);padding-top:12px}.ply-sw{display:flex;gap:12px;align-items:flex-start;cursor:pointer}.ply-sw input{width:22px;height:22px;margin:3px 0 0;accent-color:var(--pl-accent,#29489A);flex:none}
.ply-sw small{display:block;color:var(--pl-soft,#444845);font-size:15px}.ply-url{margin:6px 0 0;font-size:15px;overflow-wrap:anywhere}.ply-url a{color:var(--pl-accent-text,#29489A)}
.ply-live{margin:0;font-size:15px;color:var(--pl-soft,#444845)}
.ply-own{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between;background:var(--pl-surface,#FAF8F3);border:1.5px solid var(--pl-line-strong,#1B1D1C);border-radius:var(--pl-r-md,6px);padding:14px 16px}.ply-own p{margin:0}
.ply-out{display:grid;justify-items:start;gap:8px;background:var(--pl-surface,#FAF8F3);border:1.5px solid var(--pl-line-strong,#1B1D1C);border-radius:var(--pl-r-md,6px);padding:20px 16px;margin-top:16px}
.ply-out h1{margin:0;font:600 28px/1.15 var(--pl-font-display,system-ui,sans-serif);letter-spacing:-.02em}.ply-out p{margin:0;color:var(--pl-soft,#444845)}.ply-potto{width:96px;height:96px}
.ply-prompt{display:grid;grid-template-columns:64px minmax(0,1fr);gap:12px;align-items:start;margin:12px 0;padding:14px 16px;background:var(--pl-surface,#FAF8F3);border:1.5px solid var(--pl-line-strong,#1B1D1C);border-radius:var(--pl-r-md,6px)}
.ply-prompt img{width:64px;height:64px}.ply-prompt b{font:600 20px/1.25 var(--pl-font-serif,Georgia,serif)}.ply-prompt p{margin:4px 0 10px;color:var(--pl-soft,#444845);font-size:16px}.ply-pa{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.ply-later{min-height:44px;border:0;background:none;color:var(--pl-soft,#444845);font:500 15px var(--pl-font-text,system-ui,sans-serif);cursor:pointer;padding:0 8px}
@media (prefers-reduced-motion: reduce){.ply-card.in{animation:none}.ply-bars i.now.run b{animation:none;width:100%}}`;
  function css() { if (document.getElementById("plyCss")) return; const s = document.createElement("style"); s.id = "plyCss"; s.textContent = CSS; document.head.appendChild(s); }
  window.PLYear = { player, prompt, css };
  if (/^\/(year\/20\d\d|y\/[A-Za-z0-9_-]+)\/?$/.test(location.pathname)) page(); else if (/^\/(feed)?$/.test(location.pathname)) prompt();
})();
