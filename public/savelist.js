// Save to list: a quick bottom sheet with Saved (the heart), your lists, lists friends shared with you and + New list.
// The last list you used is ticked for something new. Server: GET/POST /api/me/library/sheet (server/library.js).
//
// PLSaveList.open({ kind, ref, title, img }) opens it. Any element with data-pl-savelist='{"kind":..,"ref":..}' opens it
// on click, so a page can add a "Save to list" button without code. PLSaveList.sheet({ title, body, foot }) is the plain
// bottom sheet the library page uses for its own small forms.
(function () {
  if (window.PLSaveList) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const signed = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  const safeImg = (u) => (/^\/_blob\/[A-Za-z0-9]{6,40}$/.test(u || "") || /^\/presets\/[A-Za-z0-9_.-]{1,80}$/.test(u || "") ? u : "");
  const CSS = `.psl-bg{position:fixed;inset:0;z-index:9100;background:rgba(27,29,28,.32);display:flex;align-items:flex-end;justify-content:center}
.psl{width:min(480px,100%);max-height:min(86vh,720px);display:flex;flex-direction:column;background:var(--pl-surface,#FAF8F3);border:1.5px solid var(--pl-ink,#1B1D1C);border-bottom:0;border-radius:6px 6px 0 0;color:var(--pl-ink,#1B1D1C);font:16px/1.45 var(--pl-font-text,"IBM Plex Sans"),system-ui,sans-serif;box-sizing:border-box}
.psl *{box-sizing:border-box}.psl-g{width:36px;height:3px;border-radius:2px;background:var(--pl-line,#CFC8B9);margin:8px auto 0;flex:none}
.psl-hd{display:flex;align-items:center;gap:12px;padding:10px 16px 12px;border-bottom:1px solid var(--pl-line,#CFC8B9);flex:none}.psl-hd h2{flex:1;margin:0;font:600 18px/1.3 var(--pl-font-text,"IBM Plex Sans"),system-ui}
.psl-x{flex:none;min-width:44px;min-height:44px;margin:-8px -10px -8px 0;border:0;background:none;font:400 26px/1 var(--pl-font-text,"IBM Plex Sans"),system-ui;color:var(--pl-soft,#444845);cursor:pointer}
.psl-body{overflow:auto;overscroll-behavior:contain;padding:4px 16px 8px;flex:1}.psl-ft{flex:none;padding:12px 16px calc(14px + env(safe-area-inset-bottom));border-top:1px solid var(--pl-line,#CFC8B9);display:flex;gap:10px}
.psl-it{display:flex;gap:12px;align-items:center;padding:12px 0;border-bottom:1px dashed var(--pl-line,#CFC8B9)}.psl-it b{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.psl-it small{color:var(--pl-soft,#444845);font-size:14px}
.psl-k{display:block;margin:16px 0 2px;font:500 12px/1.4 var(--pl-font-mono,"IBM Plex Mono"),ui-monospace,monospace;letter-spacing:.04em;text-transform:uppercase;color:var(--pl-soft,#444845)}
.psl-row{display:flex;align-items:center;gap:12px;width:100%;min-height:60px;padding:8px 0;border:0;border-bottom:1px solid var(--pl-line,#CFC8B9);background:none;font:inherit;color:inherit;text-align:left;cursor:pointer}
.psl-row:last-child{border-bottom:0}.psl-row .nm{flex:1;min-width:0}.psl-row .nm b{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.psl-row .nm small{display:block;color:var(--pl-soft,#444845);font-size:14px}
.psl-tile{flex:none;width:44px;height:44px;border:1.5px solid var(--pl-ink,#1B1D1C);border-radius:6px;overflow:hidden;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:1px;background:var(--pl-line,#CFC8B9);position:relative}
.psl-tile>span{position:relative;overflow:hidden;background:var(--pl-raised,#E6E1D5)}.psl-tile>span:only-child{grid-column:1/-1;grid-row:1/-1}.psl-tile img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.psl-tile.one{display:block;background:var(--pl-raised,#E6E1D5)}.psl-tile svg{position:absolute;inset:0;width:100%;height:100%}.psl-tile .ea-cover .ea-txt{display:none}
.psl-ck{flex:none;width:26px;height:26px;border:1.5px solid var(--pl-ink,#1B1D1C);border-radius:6px;display:grid;place-items:center;background:var(--pl-surface,#FAF8F3)}
.psl-row[aria-checked=true] .psl-ck{background:var(--pl-accent,#29489A);border-color:var(--pl-accent,#29489A)}.psl-row[aria-checked=true] .psl-ck::after{content:"";width:12px;height:7px;border:2px solid #fff;border-top:0;border-right:0;transform:translateY(-2px) rotate(-45deg)}
.psl-last{display:inline-block;margin-left:6px;padding:0 6px;border-radius:3px;background:var(--pl-sand,#F3E7A8);font-size:12px;font-weight:500;color:var(--pl-ink,#1B1D1C);vertical-align:1px}
.psl-new{display:flex;gap:8px;padding:12px 0 4px}.psl-new input,.psl input[type=text],.psl textarea{width:100%;min-height:46px;padding:10px 12px;border:1.5px solid var(--pl-ink,#1B1D1C);border-radius:6px;background:#fff;font:16px var(--pl-font-text,"IBM Plex Sans"),system-ui;color:var(--pl-ink,#1B1D1C)}
.psl textarea{min-height:76px;resize:vertical}.psl input:focus,.psl textarea:focus{outline:3px solid var(--pl-focus,rgba(41,72,154,.3));outline-offset:1px}
.psl-btn{flex:1;min-height:48px;padding:0 18px;border:1.5px solid var(--pl-ink,#1B1D1C);border-radius:6px;background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);font:600 16px var(--pl-font-text,"IBM Plex Sans"),system-ui;cursor:pointer}
.psl-btn.primary{background:var(--pl-ink,#1B1D1C);color:var(--pl-page,#EFEBE2)}.psl-btn:disabled{opacity:.5;cursor:default}.psl-btn.sm{flex:none;min-height:46px}
.psl-note{margin:12px 0 4px;color:var(--pl-soft,#444845);font-size:14px}.psl-err{color:var(--pl-danger,#A2361A);font-size:14px;margin:8px 0 0}
.psl-row:focus-visible,.psl-btn:focus-visible,.psl-x:focus-visible{outline:3px solid var(--pl-focus,rgba(41,72,154,.3));outline-offset:2px}
@media (min-width:700px){.psl-bg{align-items:center}.psl{border-bottom:1.5px solid var(--pl-ink,#1B1D1C);border-radius:6px}.psl-ft{padding-bottom:14px}}`;
  const css = () => { if (document.getElementById("pslCss")) return; const s = document.createElement("style"); s.id = "pslCss"; s.textContent = CSS; document.head.appendChild(s); };
  const HEART = `<svg viewBox="0 0 44 44" aria-hidden="true"><path d="M22 31s-8-4.8-9.6-9.8C11.2 17.4 13.5 14 17 14c2.2 0 3.7 1.3 5 3.1 1.3-1.8 2.8-3.1 5-3.1 3.5 0 5.8 3.4 4.6 7.2C30 26.2 22 31 22 31z" fill="none" stroke="#1B1D1C" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  /** One small picture of a thing: its photo, or our drawing. */
  function pic(i) { const im = safeImg(i?.img); if (im) return `<img src="${esc(im)}" alt="" loading="lazy">`;
    if (i?.kind === "host" || i?.kind === "club") return `<svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="17" r="6" fill="none" stroke="#1B1D1C" stroke-width="1.5"/><path d="M10 36c2-6 6.5-9 12-9s10 3 12 9" fill="none" stroke="#1B1D1C" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    if (i?.kind === "place") return `<svg viewBox="0 0 44 44" aria-hidden="true"><path d="M22 35s-8-8.5-8-14a8 8 0 0 1 16 0c0 5.5-8 14-8 14z" fill="none" stroke="#1B1D1C" stroke-width="1.5"/><circle cx="22" cy="21" r="2.6" fill="none" stroke="#1B1D1C" stroke-width="1.5"/></svg>`;
    const A = window.EventArt; if (A?.cover) { try { A.ensureCss?.(); return A.cover({ id: i.ref, title: i.title || "", activity: i.art?.activity || "", coverArt: i.art?.kind ? { kind: i.art.kind, ...(i.art.tone ? { tone: i.art.tone } : {}) } : null }); } catch {} }
    return ""; }
  /** A 2x2 collage of a list's first four covers. */
  function collage(covers, cls = "psl-tile") { const C = (covers || []).slice(0, 4); if (!C.length) return `<span class="${cls} one" aria-hidden="true"><svg viewBox="0 0 44 44"><path d="M15 12h14v20H15z M19 22h6M22 19v6" fill="none" stroke="#1B1D1C" stroke-width="1.5" stroke-linecap="round"/></svg></span>`;
    return `<span class="${cls}" aria-hidden="true">${C.map((c) => `<span>${pic(c)}</span>`).join("")}</span>`; }
  // ---- a plain bottom sheet ----
  function sheet({ title, body, foot = "", label }) { css(); document.querySelector(".psl-bg")?.remove(); const bg = document.createElement("div"); bg.className = "psl-bg";
    bg.innerHTML = `<div class="psl" role="dialog" aria-modal="true" aria-label="${esc(label || title)}"><div class="psl-g" aria-hidden="true"></div><div class="psl-hd"><h2>${esc(title)}</h2><button type="button" class="psl-x" aria-label="Close">×</button></div><div class="psl-body">${body}</div>${foot ? `<div class="psl-ft">${foot}</div>` : ""}</div>`;
    const prev = document.activeElement, close = () => { bg.remove(); document.removeEventListener("keydown", key); try { prev?.focus?.({ preventScroll: true }); } catch {} }, key = (e) => { if (e.key === "Escape") close(); };
    bg.addEventListener("click", (e) => { if (e.target === bg) close(); }); bg.querySelector(".psl-x").onclick = close; document.addEventListener("keydown", key);
    document.body.appendChild(bg); setTimeout(() => (bg.querySelector("input,textarea,[aria-checked],.psl-btn") || bg.querySelector(".psl-x")).focus({ preventScroll: true }), 30);
    return { el: bg, close, $: (s) => bg.querySelector(s), $$: (s) => [...bg.querySelectorAll(s)] }; }
  const toast = (html, go) => { if (window.PLSave?.toast) return window.PLSave.toast(html, go ? { go, goLabel: "Open", ms: 4000 } : { ms: 3500 }); };

  // ---- Save to list ----
  async function open(item) { if (!item?.kind || !item?.ref) return;
    if (!signed()) { const S = sheet({ title: "Save to list", body: `<p class="psl-note">Lists live on your account. Make a free one to keep lists, share them and plan with friends.</p>`, foot: `<a class="psl-btn primary" style="display:grid;place-items:center;text-decoration:none" href="/signup?mode=friends&amp;from=lists">Make a free account</a>` }); return S; }
    const r = await fetch(`/api/me/library/sheet?kind=${encodeURIComponent(item.kind)}&ref=${encodeURIComponent(item.ref)}`, { credentials: "same-origin" }).catch(() => null), D = r?.ok ? await r.json() : null;
    if (!D) { toast("Couldn't open your lists. Try again."); return; }
    const fresh = !D.saved && !D.lists.some((l) => l.has) && !D.shared.some((l) => l.has), on = new Set([...D.lists, ...D.shared].filter((l) => l.has).map((l) => l.id));
    if (fresh && D.last) on.add(D.last); let saved = D.saved || (fresh && D.canSave && !D.last);
    const row = (l, extra = "") => `<button type="button" class="psl-row" role="checkbox" data-l="${esc(l.id)}" aria-checked="${on.has(l.id)}">${collage(l.covers)}<span class="nm"><b>${esc(l.name)}${l.id === D.last ? `<span class="psl-last">Last used</span>` : ""}</b><small>${esc(extra || (l.share === "private" ? "Private" : l.share === "link" ? "Share link" : "With friends"))} · ${l.count} ${l.count === 1 ? "thing" : "things"}</small></span><span class="psl-ck" aria-hidden="true"></span></button>`;
    const body = `<div class="psl-it"><span class="psl-tile one">${pic(item)}</span><span style="min-width:0"><b>${esc(item.title || "This one")}</b><small>${esc({ event: "Event", host: "Host", club: "Fan club", idea: "Idea", place: "Place" }[item.kind] || "")}</small></span></div>
      ${D.canSave ? `<button type="button" class="psl-row" role="checkbox" data-saved aria-checked="${saved}"><span class="psl-tile one">${HEART}</span><span class="nm"><b>Saved</b><small>Everything you save</small></span><span class="psl-ck" aria-hidden="true"></span></button>` : ""}
      ${D.lists.length ? `<span class="psl-k">Your lists</span>${D.lists.map((l) => row(l)).join("")}` : ""}
      ${D.shared.length ? `<span class="psl-k">Shared with you</span>${D.shared.map((l) => row(l, "Friends")).join("")}` : ""}
      <form class="psl-new"><input type="text" maxlength="60" placeholder="+ New list" aria-label="New list name" enterkeyhint="done"><button class="psl-btn sm" type="submit">Add</button></form><p class="psl-err" hidden></p>`;
    const S = sheet({ title: "Save to list", body, foot: `<button type="button" class="psl-btn primary" data-done>Done</button>` });
    const tick = (b, v) => b.setAttribute("aria-checked", String(v));
    S.$$("[data-l]").forEach((b) => (b.onclick = () => { const v = b.getAttribute("aria-checked") !== "true"; tick(b, v); v ? on.add(b.dataset.l) : on.delete(b.dataset.l); }));
    const sv = S.$("[data-saved]"); if (sv) sv.onclick = () => { saved = sv.getAttribute("aria-checked") !== "true"; tick(sv, saved); };
    let newName = ""; const inp = S.$(".psl-new input");
    S.$(".psl-new").onsubmit = (e) => { e.preventDefault(); const v = inp.value.trim(); if (!v) return; newName = v; done(); };
    const done = async () => { const btn = S.$("[data-done]"); btn.disabled = true; newName = newName || inp.value.trim();
      const res = await fetch("/api/me/library/sheet", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item: { kind: item.kind, ref: item.ref, title: item.title || "", img: safeImg(item.img) }, lists: [...on], ...(D.canSave ? { saved } : {}), ...(newName ? { newName } : {}) }) }).catch(() => null);
      const j = res ? await res.json().catch(() => null) : null; if (!res?.ok) { btn.disabled = false; const p = S.$(".psl-err"); p.hidden = false; p.textContent = j?.message || "Couldn't save that. Try again."; return; }
      S.close(); try { await window.PLSave?.load?.(true); } catch {}
      const names = [...(j.lists || []), ...(j.shared || [])].filter((l) => l.has).map((l) => l.name);
      toast(names.length ? `In <b>${esc(names[0])}</b>${names.length > 1 ? ` and ${names.length - 1} more` : ""}.` : j.saved ? "Saved." : "Taken off your lists.", "/library");
      window.dispatchEvent(new CustomEvent("pl:lists", { detail: j })); };
    S.$("[data-done]").onclick = done; return S; }
  document.addEventListener("click", (e) => { const b = e.target.closest?.("[data-pl-savelist]"); if (!b) return; e.preventDefault(); try { open(JSON.parse(b.dataset.plSavelist)); } catch {} });
  window.PLSaveList = { open, sheet, collage, pic, css };
})();
