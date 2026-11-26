// Guides for hosts (server/guides.js): the "Your next step" card on the host's Home, and the guide pages (/guides,
// /guides/<id>, public/guides.html). Steps tick themselves off from what the host has actually done; a step with
// nothing to read can be marked done by hand. Calm on purpose: one card, one step, one button.
//
//   PLGuides.nextCard(el)        draw the Home card into el (nothing when every guide is done or it was put away)
//   PLGuides.list(el)            every guide with its progress
//   PLGuides.page(el, id)        one guide: intro, the steps, progress
// index.html loads this file; it finds Home (#view-programs) itself and keeps the card in place when Home redraws.
(function () {
  if (window.PLGuides) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const signed = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  const SAFE = (u) => /^\/[A-Za-z0-9_\-./?=&%#@]*$/.test(u || "");
  const api = async (u, body) => { const r = await fetch(u, body === undefined ? { credentials: "same-origin" } : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.message || "Something went wrong."), { status: r.status }); return j; };
  const CHECK = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`;
  const ARROW = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>`;
  const bar = (done, total) => `<span class="plg-bar" aria-hidden="true">${Array.from({ length: total }, (_, i) => `<i${i < done ? ' class="on"' : ""}></i>`).join("")}</span>`;
  const CSS = `
.plg-card{position:relative;display:grid;gap:8px;margin:16px 0;padding:18px 18px 16px;background:var(--pl-surface);border:1px solid var(--pl-line);border-radius:var(--pl-r-lg);color:var(--pl-ink);font-family:var(--sys-sans);box-sizing:border-box;max-width:720px}
.plg-eye{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;margin:0;font:500 13px/1.4 var(--sys-mono);color:var(--pl-soft)}
.plg-eye b{font:600 13px var(--sys-sans);color:var(--pl-accent-text);letter-spacing:0}.plg-eye .plg-gt{font:500 13px var(--sys-sans);color:var(--pl-soft)}
.plg-bar{display:flex;gap:4px;width:100%;max-width:220px}.plg-bar i{flex:1;height:4px;border-radius:2px;background:var(--pl-raised)}.plg-bar i.on{background:var(--pl-sage)}
.plg-card h3{margin:2px 0 0;font:400 22px/1.2 var(--sys-title);letter-spacing:-.015em}
.plg-card p.plg-body{margin:0;color:var(--pl-soft);font-size:15px;line-height:1.5;max-width:58ch}
.plg-acts{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;margin-top:6px}
.plg-go{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;border-radius:var(--pl-r-btn);background:var(--pl-accent);color:var(--pl-on-accent)!important;font:600 15px var(--sys-sans);text-decoration:none;border:1px solid var(--pl-accent)}
.plg-go:hover{background:var(--pl-accent-press)}
.plg-q{display:inline-flex;align-items:center;min-height:44px;border:0;background:none;padding:0;color:var(--pl-accent-text);font:600 14px var(--sys-sans);text-decoration:none;cursor:pointer}
.plg-q.soft{color:var(--pl-soft);font-weight:500}
.plg-q:hover{text-decoration:underline;text-underline-offset:3px}
.plg-go:focus-visible,.plg-q:focus-visible,.plg-step button:focus-visible{outline:3px solid var(--pl-focus);outline-offset:2px}
@media (max-width:520px){.plg-go{flex:1 1 100%}}
/* the guide pages */
.plg-wrap{max-width:720px}
.plg-wrap h1{font:400 var(--fs-28-40,28px)/1.08 var(--sys-display);letter-spacing:-.015em;margin:0}
.plg-intro{margin:10px 0 0;color:var(--pl-soft);font-size:16px;line-height:1.55;max-width:60ch}
.plg-prog{display:grid;gap:8px;margin:18px 0 8px}.plg-prog span.plg-n{font:500 13px var(--sys-mono);color:var(--pl-soft)}
.plg-steps{list-style:none;margin:16px 0 0;padding:0;display:grid;gap:10px}
.plg-step{display:grid;grid-template-columns:28px minmax(0,1fr);gap:12px;padding:16px;background:var(--pl-surface);border:1px solid var(--pl-line);border-radius:var(--pl-r-md)}
.plg-step.next{border-color:var(--pl-line-strong)}
.plg-dot{width:26px;height:26px;border-radius:50%;border:1.5px solid var(--pl-line-strong);display:grid;place-items:center;font:500 12px var(--sys-mono);color:var(--pl-soft);box-sizing:border-box;margin-top:1px}
.plg-step.done .plg-dot{background:var(--pl-success-soft);border-color:var(--pl-success);color:var(--pl-success)}
.plg-step h3{margin:0;font:600 16px/1.35 var(--sys-title)}.plg-step.done h3{color:var(--pl-soft)}
.plg-step p{margin:4px 0 0;color:var(--pl-soft);font-size:14px;line-height:1.5}
.plg-step .plg-acts{margin-top:8px}.plg-step .plg-go{min-height:40px;font-size:14px;padding:0 14px}
.plg-step.done .plg-go{background:var(--pl-surface);color:var(--pl-ink)!important;border-color:var(--pl-line-strong)}
.plg-list{display:grid;gap:12px;margin:20px 0 0}
.plg-gc{position:relative;display:grid;gap:6px;padding:18px;background:var(--pl-surface);border:1px solid var(--pl-line);border-radius:var(--pl-r-md);text-decoration:none;color:inherit}
.plg-gc:hover{border-color:var(--pl-line-strong)}.plg-gc h2{margin:0;font:400 22px/1.2 var(--sys-title);letter-spacing:-.015em}.plg-gc p{margin:0;color:var(--pl-soft);font-size:14px}
.plg-gc .plg-n{font:500 13px var(--sys-mono);color:var(--pl-soft)}
.plg-note{margin:16px 0 0;padding:14px 16px;border:1px dashed var(--pl-line-strong);border-radius:var(--pl-r-md);color:var(--pl-soft);font-size:14px}
.plg-note a{color:var(--pl-accent-text);font-weight:600}
.plg-done{display:flex;gap:14px;align-items:center;margin:18px 0 0;padding:16px;background:var(--pl-success-soft);border-radius:var(--pl-r-md)}.plg-done b{display:block;font:400 20px/1.2 var(--sys-title)}.plg-done p{margin:2px 0 0;font-size:14px;color:var(--pl-soft)}`;
  function css() { if (document.getElementById("plgCss")) return; const s = document.createElement("style"); s.id = "plgCss"; s.textContent = CSS; document.head.appendChild(s); }

  // ---- the Home card ----
  const HIDE = "pl.guideCardHidden";
  const hidden = () => { try { return +(localStorage.getItem(HIDE) || 0) > Date.now(); } catch { return false; } };
  let cache = null;
  async function load(force) { if (!signed()) return null; if (cache && !force && Date.now() - cache.at < 20000) return cache.v; try { const v = await api("/api/host/guides"); cache = { at: Date.now(), v }; return v; } catch { return null; } }
  function cardHTML(n) { const g = n.guide, s = n.step;
    return `<section class="plg-card" id="plgNext" aria-labelledby="plgNextH"><p class="plg-eye"><b>Your next step</b><span class="plg-gt">${esc(g.title)}</span><span>Step ${g.done + 1} of ${g.total}</span></p>${bar(g.done, g.total)}
      <h3 id="plgNextH">${esc(s.title)}</h3><p class="plg-body">${esc(s.body)}</p>
      <div class="plg-acts"><a class="plg-go" href="${esc(SAFE(s.href) ? s.href : "/?app=1")}">${esc(s.label)}</a><a class="plg-q" href="/guides/${encodeURIComponent(g.id)}">See the guide</a><button type="button" class="plg-q soft" data-plg-hide>Not now</button></div></section>`; }
  async function nextCard(el) { if (!el) return null; css(); const v = await load(); const n = v?.next; if (!n || !n.step || hidden()) { el.innerHTML = ""; el.hidden = true; return null; }
    el.hidden = false; el.innerHTML = cardHTML(n);
    el.querySelector("[data-plg-hide]").onclick = () => { try { localStorage.setItem(HIDE, String(Date.now() + 7 * 864e5)); } catch {} el.innerHTML = ""; el.hidden = true; };
    return n; }

  // ---- the guide pages ----
  async function list(el) { css(); let pub = null, mine = null; try { pub = await api("/api/public/guides"); } catch {} if (signed()) mine = await load(true);
    const P = new Map((mine?.guides || []).map((g) => [g.id, g]));
    el.innerHTML = `<div class="plg-wrap"><h1>Guides for hosts</h1><p class="plg-intro">Short programs that walk you through a first night, a monthly habit or a drop. Each step opens the part of Pottery Lab that does it.</p>
      <div class="plg-list">${(pub?.guides || []).map((g) => { const m = P.get(g.id); return `<a class="plg-gc" href="/guides/${encodeURIComponent(g.id)}"><h2>${esc(g.title)}</h2><p>${esc(g.short)}</p>${m ? `<span class="plg-n">${m.complete ? "Done" : `${m.done} of ${m.total} done`}</span>${bar(m.done, m.total)}` : `<span class="plg-n">${g.steps.length} steps</span>`}</a>`; }).join("")}</div></div>`; }
  async function page(el, id) { css(); let g = null; const mineV = signed() ? await load(true) : null;
    g = mineV?.guides?.find((x) => x.id === id) || null;
    if (!g) { const pub = await api("/api/public/guides").catch(() => null); const p = pub?.guides?.find((x) => x.id === id); if (p) g = { ...p, steps: p.steps.map((s) => ({ ...s, done: false, href: "" })), done: 0, total: p.steps.length, anon: true }; }
    if (!g) { el.innerHTML = `<div class="plg-wrap"><h1>That guide isn't here</h1><p class="plg-intro"><a href="/guides">See every guide</a></p></div>`; return; }
    document.title = `${g.title} · Pottery Lab`;
    if (!g.anon && !g.started) api(`/api/host/guides/${encodeURIComponent(id)}/start`, {}).catch(() => {}); // opening a guide starts it, so Home's card follows this one
    const nextId = g.steps.find((s) => !s.done)?.id;
    const draw = () => { el.innerHTML = `<div class="plg-wrap"><h1>${esc(g.title)}</h1><p class="plg-intro">${esc(g.intro)}</p>
      <div class="plg-prog"><span class="plg-n">${g.done} of ${g.total} done</span>${bar(g.done, g.total)}</div>
      ${g.complete ? `<div class="plg-done">${window.Potto ? window.Potto.svg("cheer", 64, "Potto") : ""}<div><b>All done</b><p>That's the whole guide. Nice hosting.</p></div></div>` : ""}
      <ol class="plg-steps">${g.steps.map((s, i) => `<li class="plg-step${s.done ? " done" : ""}${s.id === nextId ? " next" : ""}"><span class="plg-dot" aria-hidden="true">${s.done ? CHECK : i + 1}</span><div><h3>${esc(s.title)}<span class="vh" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">${s.done ? " (done)" : ""}</span></h3><p>${esc(s.body)}</p>
        ${g.anon ? "" : `<div class="plg-acts"><a class="${s.id === nextId ? "plg-go" : "plg-q"}" href="${esc(SAFE(s.href) ? s.href : "/?app=1")}">${esc(s.label)}</a>${s.by === "auto" ? "" : `<button type="button" class="plg-q soft" data-plg-mark="${esc(s.id)}" data-on="${s.done ? "0" : "1"}">${s.done ? "Not done yet" : "Mark done"}</button>`}</div>`}</div></li>`).join("")}</ol>
      ${g.anon ? `<p class="plg-note">Make a free page and each step opens the part of Pottery Lab that does it, and ticks itself off. <a href="/signup?mode=friends">Start your page</a></p>` : ""}
      <p style="margin:24px 0 0"><a class="plg-q" href="/guides">All guides</a></p></div>`;
      el.querySelectorAll("[data-plg-mark]").forEach((b) => (b.onclick = async () => { b.disabled = true; try { const v = await api(`/api/host/guides/${encodeURIComponent(id)}/steps/${encodeURIComponent(b.dataset.plgMark)}`, { done: b.dataset.on === "1" }); cache = { at: Date.now(), v }; g = v.guides.find((x) => x.id === id) || g; draw(); } catch { b.disabled = false; } })); };
    draw(); }

  window.PLGuides = { nextCard, list, page, load, css };

  // ---- Home in the app (index.html): the card under the greeting and Potto's list, kept in place when Home redraws ----
  if (location.pathname === "/" && signed()) {
    let busy = false;
    const place = async () => { const v = document.getElementById("view-programs"); if (!v || v.hidden || v.offsetParent === null || busy) return; if (document.getElementById("plgHome")?.isConnected && v.contains(document.getElementById("plgHome"))) return;
      if (window.__wsPersonal === undefined) return; // wait for the app to know whose Home this is
      busy = true; const w = document.createElement("div"); w.id = "plgHome"; w.hidden = true;
      const anchor = v.querySelector("#pipHome") || v.querySelector("#qsPanel:not([hidden])") || v.querySelector(".hw-tabs") || null;
      if (anchor) anchor.after(w); else v.prepend(w);
      try { await nextCard(w); } finally { busy = false; } };
    let t = 0; const soon = () => { clearTimeout(t); t = setTimeout(place, 250); };
    const start = () => { soon(); try { new MutationObserver(soon).observe(document.body, { childList: true, subtree: true }); } catch {} window.addEventListener("hashchange", soon); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  }
})();
