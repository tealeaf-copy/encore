// Save to list: a quick bottom sheet with Saved (the heart, the default), your lists, lists friends shared with you and
// + New list. Each tap saves right away ("Saved to Weekend ideas · View"); Done only closes. Server: GET/POST
// /api/me/library/sheet (server/library.js). Buttons show filled for things already saved (GET /api/me/library/marks).
// Signed out, the sheet sends you to sign in with ?next= back to the same page and ?pl_save=kind:ref, which reopens it.
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
    const prev = document.activeElement, close = () => { bg.remove(); document.removeEventListener("keydown", key); /* the button that opened it may have been drawn again while the sheet was open (the card now says Saved): focus its twin */ const lab = prev?.getAttribute?.("aria-label"), to = prev?.isConnected ? prev : lab && document.querySelector(`[data-pl-savelist][aria-label="${CSS.escape(lab)}"]`); try { to?.focus?.({ preventScroll: true }); } catch {} }, key = (e) => { if (e.key === "Escape") close(); else if (e.key === "Tab" && !window.__plTrap) { /* the light invite has no netguard: keep Tab in the sheet here */ const F = [...bg.querySelectorAll("a[href],button,input,select,textarea")].filter((x) => !x.disabled && x.getClientRects().length), i = F.indexOf(document.activeElement); if (F.length && (i < 0 || (e.shiftKey ? i === 0 : i === F.length - 1))) { e.preventDefault(); (e.shiftKey ? F[F.length - 1] : F[0]).focus(); } } };
    bg.addEventListener("click", (e) => { if (e.target === bg) close(); }); bg.querySelector(".psl-x").onclick = close; document.addEventListener("keydown", key);
    document.body.appendChild(bg); setTimeout(() => (bg.querySelector("input,textarea,[aria-checked],.psl-btn") || bg.querySelector(".psl-x")).focus({ preventScroll: true }), 30);
    return { el: bg, close, $: (s) => bg.querySelector(s), $$: (s) => [...bg.querySelectorAll(s)] }; }
  // ---- list visibility (server/curation.js): who can see each list, in the words the library uses ----
  const SHARE_LABEL = { private: "Private", friends: "Friends", link: "Link", public: "Public" };
  // ---- end list visibility ----
  // ---- a small toast with one action (Undo, View), shared with public/follow.js. Its words also go to a live region. ----
  const T = window.PLActionToast || (window.PLActionToast = (() => {
    const CSS2 = `.plt{position:fixed;left:50%;bottom:calc(88px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:9300;width:min(calc(100vw - 32px),440px);display:flex;align-items:center;gap:4px;padding:6px 6px 6px 14px;background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);border:1.5px solid var(--pl-ink,#1B1D1C);border-radius:6px;box-shadow:0 10px 28px -16px rgba(27,29,28,.45);font:500 15px/1.4 var(--pl-font-text,"IBM Plex Sans"),system-ui,sans-serif;box-sizing:border-box}
.plt-m{flex:1;min-width:0;padding:6px 0}.plt-m b{font-weight:600}.plt-a{flex:none;display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;padding:0 12px;border:0;border-radius:6px;background:none;color:var(--pl-accent,#29489A);font:600 15px var(--pl-font-text,"IBM Plex Sans"),system-ui;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.plt-a:focus-visible{outline:3px solid var(--pl-focus,rgba(41,72,154,.3));outline-offset:1px}.plt-live{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (min-width:861px){.plt{bottom:28px}}.psl-bg~.plt{bottom:auto;top:calc(12px + env(safe-area-inset-top))}@media (prefers-reduced-motion:no-preference){.plt{animation:pltIn .2s ease-out}@keyframes pltIn{from{opacity:0;transform:translate(-50%,8px)}}}`;
    let live = null, el = null, timer = 0;
    const mount = () => { if (live || !document.body) return; const st = document.createElement("style"); st.textContent = CSS2; document.head.appendChild(st);
      live = document.createElement("div"); live.className = "plt-live"; live.setAttribute("role", "status"); live.setAttribute("aria-live", "polite"); live.setAttribute("aria-atomic", "true"); document.body.appendChild(live); };
    document.body ? mount() : document.addEventListener("DOMContentLoaded", mount);
    const hide = () => { clearTimeout(timer); el?.remove(); el = null; };
    /** show("Saved to <b>Weekend ideas</b>", { action: { label: "View", href } | { label: "Undo", fn } }) */
    function show(html, { action, ms = 5000 } = {}) { mount(); hide(); el = document.createElement("div"); el.className = "plt";
      el.innerHTML = `<span class="plt-m">${html}</span>${action ? (action.href ? `<a class="plt-a" href="${esc(action.href)}">${esc(action.label)}</a>` : `<button type="button" class="plt-a">${esc(action.label)}</button>`) : ""}`;
      if (action?.fn) el.querySelector("button.plt-a").onclick = () => { hide(); action.fn(); };
      document.body.appendChild(el); const text = el.querySelector(".plt-m").textContent.replace(/[.\s]+$/, "") + "." + (action ? ` ${action.label} is in the message.` : "");
      if (live) { live.textContent = ""; setTimeout(() => { if (live) live.textContent = text; }, 60); }
      const arm = () => { clearTimeout(timer); timer = setTimeout(hide, ms); }; el.addEventListener("mouseenter", () => clearTimeout(timer)); el.addEventListener("mouseleave", arm); el.addEventListener("focusin", () => clearTimeout(timer)); el.addEventListener("focusout", arm); arm(); return el; }
    return { show, hide };
  })());
  const listUrl = (id) => (id === "saved" ? "/library#list-saved" : /^t:/.test(id) ? "/l/" + id.slice(2) : "/library#list-" + id);

  // ---- which things are on your lists already: a Save to list button shows filled for those ----
  let marks = null, marksP = null;
  const keyOf = (i) => i.kind + ":" + i.ref;
  function loadMarks(force) { if (!signed()) return Promise.resolve(null); if (marksP && !force) return marksP;
    marksP = fetch("/api/me/library/marks", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then((j) => { marks = j ? new Set(j.keys || []) : null; paint(); return marks; }).catch(() => null); return marksP; }
  const itemOf = (b) => { try { const i = JSON.parse(b.dataset.plSavelist); return i?.kind && i?.ref ? i : null; } catch { return null; } };
  /** Filled when the thing is saved or on any list: data-in on the button, its words and its label say so. */
  function paint(root = document) { if (!marks) return;
    root.querySelectorAll?.("[data-pl-savelist]").forEach((b) => { const i = itemOf(b); if (!i) return; const on = marks.has(keyOf(i)); if ((b.dataset.in === "1") === on && b.dataset.plsl) return; b.dataset.plsl = "1";
      if (on) b.dataset.in = "1"; else delete b.dataset.in;
      const t = b.querySelector(".pls-t") || (b.children.length ? null : b); if (t) t.textContent = on ? "Saved to list" : (b.dataset.plWord || "Save to list");
      b.setAttribute("aria-label", `${on ? "Saved to a list" : "Save to list"}${i.title ? ": " + i.title : ""}`); }); }
  const setMark = (i, on) => { if (!marks) marks = new Set(); on ? marks.add(keyOf(i)) : marks.delete(keyOf(i)); paint(); };
  const FILLED = `[data-pl-savelist][data-in]{background:var(--pl-accent,#29489A)!important;border-color:var(--pl-accent,#29489A)!important;color:#fff!important}[data-pl-savelist][data-in] svg path{stroke:#fff!important}`;
  const fillCss = () => { if (document.getElementById("pslFill")) return; const s = document.createElement("style"); s.id = "pslFill"; s.textContent = FILLED; document.head.appendChild(s); };

  // ---- signed out: sign in, then come back to this thing with the sheet open (?pl_save=kind:ref) ----
  const backTo = (item) => { const u = new URL(location.href); u.searchParams.set("pl_save", keyOf(item)); return u.pathname + u.search + u.hash; };
  function signedOutSheet(item) { const n = encodeURIComponent(backTo(item));
    return sheet({ title: "Save to list", body: `<p class="psl-note">Lists live on your account. Make a free one, or sign in, and you come right back here with your lists open.</p>`,
      foot: `<a class="psl-btn primary" style="display:grid;place-items:center;text-decoration:none" href="/signup?mode=friends&amp;from=lists&amp;next=${n}">Make a free account</a><a class="psl-btn" style="display:grid;place-items:center;text-decoration:none" href="/login?next=${n}">Sign in</a>` }); }

  // ---- Save to list: tap a row and it's saved (or taken off) right away; + New list makes one and adds to it ----
  const KIND_WORD = { event: "Event", host: "Host", club: "Fan club", idea: "Idea", place: "Place", collection: "Collection", drop: "Drop" };
  async function open(item, { trigger } = {}) { if (!item?.kind || !item?.ref) return; const back = trigger || document.activeElement;
    if (!signed()) return signedOutSheet(item);
    const r = await fetch(`/api/me/library/sheet?kind=${encodeURIComponent(item.kind)}&ref=${encodeURIComponent(item.ref)}`, { credentials: "same-origin" }).catch(() => null), D = r?.ok ? await r.json() : null;
    if (!D) { if (r?.status === 401) return signedOutSheet(item); T.show("Couldn't open your lists. Try again."); return; }
    const on = new Set([...D.lists, ...D.shared].filter((l) => l.has).map((l) => l.id)); let saved = !!D.saved;
    // Saved is the default: one tap on Save to list puts a new thing there, and the sheet shows where else it could go
    const fresh = D.canSave && !saved && !on.size;
    const row = (l, extra = "") => `<button type="button" class="psl-row" role="checkbox" data-l="${esc(l.id)}" data-name="${esc(l.name)}" aria-checked="${on.has(l.id)}">${collage(l.covers)}<span class="nm"><b>${esc(l.name)}${l.id === D.last ? `<span class="psl-last">Last used</span>` : ""}</b><small>${esc(extra || (l.share === "private" ? "Private" : l.share === "link" ? "Share link" : "With friends"))} · <span data-n>${l.count} ${l.count === 1 ? "thing" : "things"}</span></small></span><span class="psl-ck" aria-hidden="true"></span></button>`;
    const body = `<div class="psl-it"><span class="psl-tile one">${pic(item)}</span><span style="min-width:0"><b>${esc(item.title || "This one")}</b><small>${esc(KIND_WORD[item.kind] || "")}</small></span></div>
      ${D.canSave ? `<button type="button" class="psl-row" role="checkbox" data-saved data-name="Saved" aria-checked="${saved || fresh}"><span class="psl-tile one">${HEART}</span><span class="nm"><b>Saved</b><small>Everything you save</small></span><span class="psl-ck" aria-hidden="true"></span></button>` : ""}
      <div data-own>${D.lists.length ? `<span class="psl-k">Your lists</span>${D.lists.map((l) => row(l)).join("")}` : ""}</div>
      ${D.shared.length ? `<span class="psl-k">Shared with you</span>${D.shared.map((l) => row(l, "Friends")).join("")}` : ""}
      <form class="psl-new"><input type="text" maxlength="60" placeholder="New list, like Weekend ideas" aria-label="New list name" enterkeyhint="done"><button class="psl-btn sm" type="submit">Add</button></form><p class="psl-err" role="alert" hidden></p>`;
    const S = sheet({ title: "Save to list", body, foot: `<button type="button" class="psl-btn primary" data-done>Done</button>` });
    // focus comes back to the button that opened the sheet
    const close0 = S.close; S.close = () => { close0(); try { back?.focus?.({ preventScroll: true }); } catch {} };
    S.$(".psl-x").onclick = S.close; S.el.onclick = (e) => { if (e.target === S.el) S.close(); }; S.$("[data-done]").onclick = S.close;
    const err = (m) => { const p = S.$(".psl-err"); p.hidden = !m; p.textContent = m || ""; };
    let q = Promise.resolve();
    // one change at a time, in the order tapped; the server answers with where the thing lives now
    const push = (what) => (q = q.then(async () => { err("");
      const res = await fetch("/api/me/library/sheet", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item: { kind: item.kind, ref: item.ref, title: String(item.title || "").slice(0, 140), img: safeImg(item.img) }, lists: [...on], ...(D.canSave ? { saved } : {}), ...(what.newName ? { newName: what.newName } : {}) }) }).catch(() => null);
      const j = res ? await res.json().catch(() => null) : null;
      if (!res?.ok || !j) { err(j?.message || "Couldn't save that. Try again."); what.undo?.(); return null; }
      on.clear(); [...j.lists, ...j.shared].filter((l) => l.has).forEach((l) => on.add(l.id)); saved = !!j.saved;
      S.$$("[data-l]").forEach((b) => b.setAttribute("aria-checked", String(on.has(b.dataset.l)))); const sv = S.$("[data-saved]"); if (sv) sv.setAttribute("aria-checked", String(saved));
      for (const l of [...j.lists, ...j.shared]) { const n = S.$(`[data-l="${window.CSS.escape(l.id)}"] [data-n]`); if (n) n.textContent = `${l.count} ${l.count === 1 ? "thing" : "things"}`; }
      setMark(item, saved || on.size > 0); try { await window.PLSave?.load?.(true); } catch {}
      window.dispatchEvent(new CustomEvent("pl:lists", { detail: j })); return j; }));
    const said = (id, name, added) => T.show(added ? `Saved to <b>${esc(name)}</b>` : `Taken off <b>${esc(name)}</b>`, added ? { action: { label: "View", href: listUrl(id) } } : { action: { label: "Undo", fn: () => flip(id, name, true) } });
    const flip = async (id, name, v) => { if (id === "saved") saved = v; else v ? on.add(id) : on.delete(id); const j = await push({ undo: () => { if (id === "saved") saved = !v; else !v ? on.add(id) : on.delete(id); } }); if (j) said(id, name, v); };
    S.$$("[data-l]").forEach((b) => (b.onclick = () => flip(b.dataset.l, b.dataset.name, b.getAttribute("aria-checked") !== "true")));
    const sv = S.$("[data-saved]"); if (sv) sv.onclick = () => flip("saved", "Saved", sv.getAttribute("aria-checked") !== "true");
    const inp = S.$(".psl-new input");
    S.$(".psl-new").onsubmit = async (e) => { e.preventDefault(); const v = inp.value.trim(); if (!v) { inp.focus(); return; } const btn = S.$(".psl-new button"); btn.disabled = true;
      const j = await push({ newName: v }); btn.disabled = false; if (!j) return; inp.value = "";
      const c = j.created, L = c && j.lists.find((l) => l.id === c.id);
      if (L && !S.$(`[data-l="${window.CSS.escape(L.id)}"]`)) { const box = S.$("[data-own]"); if (!box.querySelector(".psl-k")) box.insertAdjacentHTML("afterbegin", `<span class="psl-k">Your lists</span>`);
        box.querySelector(".psl-k").insertAdjacentHTML("afterend", row({ ...L, has: true })); const nb = S.$(`[data-l="${window.CSS.escape(L.id)}"]`); nb.onclick = () => flip(nb.dataset.l, nb.dataset.name, nb.getAttribute("aria-checked") !== "true"); }
      if (c) said(c.id, c.name, true); };
    if (fresh) { saved = true; const j = await push({ undo: () => { saved = false; } }); if (j) T.show(`<b>Saved.</b> Pick a list too, or tap Done.`, { action: { label: "View", href: listUrl("saved") } }); }
    return S; }
  css(); fillCss();
  // clicks on any [data-pl-savelist], before a parent link or card can take them
  document.addEventListener("click", (e) => { const b = e.target.closest?.("[data-pl-savelist]"); if (!b) return; e.preventDefault(); e.stopPropagation(); const i = itemOf(b); if (i) open(i, { trigger: b }); }, true);
  // buttons drawn later get their filled state too
  const watch = () => { loadMarks(); let t = 0; new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => paint(), 150); }).observe(document.body, { childList: true, subtree: true }); };
  document.body ? watch() : document.addEventListener("DOMContentLoaded", watch);
  // back from signing in: open the sheet for the thing they tapped, once
  (function back() { const u = new URL(location.href), k = u.searchParams.get("pl_save"); if (!k) return; u.searchParams.delete("pl_save"); history.replaceState(history.state, "", u.pathname + u.search + u.hash);
    const m = /^([a-z]+):([A-Za-z0-9_.:@-]{1,120})$/.exec(k); if (!m || !signed()) return; const want = { kind: m[1], ref: m[2] }; let n = 0;
    const go = () => { const b = [...document.querySelectorAll("[data-pl-savelist]")].find((x) => { const i = itemOf(x); return i && keyOf(i) === k; });
      if (b || n++ > 24) { const i = b ? itemOf(b) : want; b?.scrollIntoView?.({ block: "center" }); open(i, { trigger: b }); return; } setTimeout(go, 250); };
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", go) : go(); })();
  window.PLSaveList = { open, sheet, collage, pic, css, paint, marks: loadMarks, toast: T };
})();
