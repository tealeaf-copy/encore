// Lists people follow, in the browser (server/curation.js, docs/lists-pm-spec.md). One file every page that shows
// public lists loads; it draws what fits the page it is on:
//   /discover   "Lists people love", a sideways shelf before "Hosts worth following"
//   /@<handle>  a host's "On 14 public lists" with the top 3, "I'd go again" for the host, and a link to the
//               person's own lists when they have public ones
//   /e/<id>     "5 would go again, including Maya" under the event's facts, with I'd go again when you went
//               (and /g#rsvp-<id>, the full invite a past event opens, signed in: index.html loads this there)
// And for other pages: PLLists.card(list), PLLists.again(info, kind, ref), PLLists.strip(stats), PLLists.toast().
// Follow, Follow list and Save are one tap, in place, with a toast and Undo: any element with data-pll-act
// ("curator" | "list" | "save") and data-key (a handle or a list's token) does it, aria-pressed holds the state.
(function () {
  if (window.PLLists) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const signed = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  const safeImg = (u) => (/^\/_blob\/[A-Za-z0-9]{6,40}$/.test(u || "") || /^\/presets\/[A-Za-z0-9_.-]{1,80}$/.test(u || "") ? u : "");
  const safeUrl = (u) => (/^\/[A-Za-z0-9@_\-./#?=&%]*$/.test(u || "") && !/^\/\//.test(u) ? u : "");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const STYLE = `.pll-card{display:flex;flex-direction:column;min-width:0;border:1.5px solid var(--pl-ink,#1B1D1C);border-radius:6px;background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);overflow:hidden}
.pll-card>a{display:block;text-decoration:none;color:inherit}.pll-cv{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:1.5px;aspect-ratio:3/2;background:var(--pl-ink,#1B1D1C);border-bottom:1.5px solid var(--pl-ink,#1B1D1C)}
.pll-cv>span{position:relative;overflow:hidden;background:var(--pl-raised,#E6E1D5)}.pll-cv>span:only-child{grid-column:1/-1;grid-row:1/-1}.pll-cv>span:nth-child(1):nth-last-child(2),.pll-cv>span:nth-child(2):nth-last-child(1),.pll-cv>span:nth-child(1):nth-last-child(3){grid-row:1/-1}
.pll-cv img,.pll-cv svg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.pll-cv .ea-cover .ea-txt{display:none}
.pll-bd{padding:10px 12px 12px;display:flex;flex-direction:column;gap:2px;flex:1}.pll-bd b{font:600 16px/1.3 var(--pl-font-text,"IBM Plex Sans"),system-ui;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pll-bd small{color:var(--pl-soft,#444845);font-size:14px;line-height:1.35}.pll-ft{padding:0 12px 12px;display:flex;gap:8px;flex-wrap:wrap}
.pll-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:0 14px;border:1.5px solid var(--pl-ink,#1B1D1C);border-radius:6px;background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);font:600 14px var(--pl-font-text,"IBM Plex Sans"),system-ui;cursor:pointer;text-decoration:none;white-space:nowrap}
.pll-btn.primary{background:var(--pl-accent,#29489A);border-color:var(--pl-accent,#29489A);color:var(--pl-on-accent,#fff)}.pll-btn[aria-pressed=true]{background:var(--pl-ink,#1B1D1C);border-color:var(--pl-ink,#1B1D1C);color:var(--pl-page,#EFEBE2)}
.pll-btn:disabled{opacity:.6;cursor:default}.pll-btn:focus-visible,.pll-card a:focus-visible{outline:3px solid var(--pl-focus,rgba(41,72,154,.3));outline-offset:2px}
.pll-row{display:flex;gap:12px;overflow-x:auto;scrollbar-width:none;margin:8px -16px 0;padding:2px 16px 6px;scroll-snap-type:x proximity}.pll-row::-webkit-scrollbar{display:none}.pll-row>.pll-card{flex:none;width:236px;scroll-snap-align:start}
.pll-k{display:block;font:500 12px/1.4 var(--pl-font-mono,"IBM Plex Mono"),ui-monospace,monospace;letter-spacing:.04em;text-transform:uppercase;color:var(--pl-soft,#444845)}
.pll-again{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0 12px;font:500 15px/1.4 var(--pl-font-text,"IBM Plex Sans"),system-ui;color:var(--pl-ink,#1B1D1C)}
.pll-again .pll-mark{flex:none;width:28px;height:28px;border:1.5px solid var(--pl-ink,#1B1D1C);border-radius:6px;display:grid;place-items:center;background:var(--pl-sand,#F3E7A8)}.pll-again .pll-mark svg{width:16px;height:16px}
.pll-again .pll-btn svg{width:16px;height:16px}.pll-undo{min-height:44px;padding:0 4px;border:0;background:none;color:var(--pl-accent-text,#29489A);font:600 14px var(--pl-font-text,"IBM Plex Sans"),system-ui;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.pll-host{margin:28px 0 0}.pll-host h2{margin:0 0 2px}.pll-host p{margin:0;color:var(--pl-soft,#444845);font-size:15px}
.pll-strip{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1.5px solid var(--pl-ink,#1B1D1C);border-radius:6px;background:var(--pl-surface,#FAF8F3);margin:12px 0}
.pll-strip>div{padding:12px;min-width:0}.pll-strip>div+div{border-left:1px solid var(--pl-line,#CFC8B9)}.pll-strip b{display:block;font:600 24px/1.1 var(--pl-font-serif,"IBM Plex Serif"),Georgia,serif}.pll-strip small{display:block;color:var(--pl-soft,#444845);font-size:13px;line-height:1.3}
.pll-nudge{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:12px 0;padding:14px 16px;border:1.5px solid var(--pl-ink,#1B1D1C);border-radius:6px;background:var(--pl-sand-soft,#F7EFCB)}.pll-nudge p{margin:0;flex:1;min-width:200px;font-weight:500}
.pll-toast{position:fixed;left:50%;bottom:calc(92px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:9200;width:min(92vw,420px);display:flex;align-items:center;gap:12px;padding:10px 10px 10px 16px;border:1.5px solid var(--pl-ink,#1B1D1C);border-radius:6px;background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);font:500 15px/1.35 var(--pl-font-text,"IBM Plex Sans"),system-ui}
.pll-toast span{flex:1;min-width:0}.pll-toast button{flex:none;min-height:44px;padding:0 14px;border:0;border-radius:6px;background:none;color:var(--pl-accent-text,#29489A);font:600 15px var(--pl-font-text,"IBM Plex Sans"),system-ui;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
@media (min-width:861px){.pll-toast{bottom:28px}}`;
  const css = () => { if (document.getElementById("pllCss")) return; const s = document.createElement("style"); s.id = "pllCss"; s.textContent = STYLE; document.head.appendChild(s); };
  const api = async (url, body) => { const r = await fetch(url, { method: body ? "POST" : "GET", credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }).catch(() => null); const j = r ? await r.json().catch(() => ({})) : {}; return { ok: !!r?.ok, status: r?.status || 0, j }; };
  const CHECK = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>`;

  // ---------- a toast with Undo ----------
  let toastT = 0;
  function toast(text, undo) { css(); document.querySelector(".pll-toast")?.remove(); clearTimeout(toastT);
    const t = document.createElement("div"); t.className = "pll-toast"; t.setAttribute("role", "status"); t.innerHTML = `<span>${esc(text)}</span>${undo ? `<button type="button">Undo</button>` : ""}`;
    if (undo) t.querySelector("button").onclick = () => { t.remove(); undo(); };
    document.body.appendChild(t); toastT = setTimeout(() => t.remove(), 5000); }

  // ---------- pictures ----------
  function pic(i) { const im = safeImg(i?.img); if (im) return `<img src="${esc(im)}" alt="" loading="lazy" decoding="async">`;
    if (window.PLSaveList?.pic) return window.PLSaveList.pic(i);
    const A = window.EventArt; if (A?.cover && i?.kind === "event") { try { A.ensureCss?.(); return A.cover({ id: i.ref, title: i.title || "", activity: i.art?.activity || "" }); } catch {} }
    return `<svg viewBox="0 0 44 44" aria-hidden="true"><path d="M15 12h14v20H15z" fill="none" stroke="#1B1D1C" stroke-width="1.5"/></svg>`; }
  const collage = (covers) => `<span class="pll-cv" aria-hidden="true">${(covers || []).slice(0, 4).map((c) => `<span>${pic(c)}</span>`).join("") || "<span></span>"}</span>`;

  // ---------- follow, follow list, save: one tap, in place, Undo ----------
  const WORDS = { curator: ["Follow", "Following"], list: ["Follow list", "Following"], save: ["Save", "Saved"] };
  const btn = (act, key, on, { name = "", cls = "" } = {}) => `<button type="button" class="pll-btn ${cls}" data-pll-act="${act}" data-key="${esc(key)}" data-name="${esc(name)}" aria-pressed="${!!on}">${esc(WORDS[act][on ? 1 : 0])}</button>`;
  const urlOf = (act, key) => (act === "curator" ? `/api/me/curators/${encodeURIComponent(key)}/follow` : `/api/me/lists/${encodeURIComponent(key)}/${act === "save" ? "save" : "follow"}`);
  function show(act, key, on) { document.querySelectorAll(`[data-pll-act="${act}"][data-key="${CSS.escape(key)}"]`).forEach((b) => { b.setAttribute("aria-pressed", String(on)); b.textContent = WORDS[act][on ? 1 : 0]; }); }
  async function act(a, key, on, name = "", quiet = false) {
    if (!signed()) { location.href = "/login?next=" + encodeURIComponent(location.pathname); return; }
    show(a, key, on); const r = await api(urlOf(a, key), { on });
    if (!r.ok) { show(a, key, !on); toast(r.j.message || "That didn't go through. Try again."); return; }
    document.dispatchEvent(new CustomEvent("pl:listfollow", { detail: { act: a, key, on, followers: r.j.followers } }));
    if (quiet) return;
    const said = a === "curator" ? (on ? `Following ${name || "their"} lists` : `Stopped following ${name || "their"} lists`) : a === "list" ? (on ? `Following ${name || "this list"}` : `Stopped following ${name || "this list"}`) : on ? `Saved ${name || "the list"} to your library` : "Taken out of your library";
    toast(said, () => act(a, key, !on, name, true)); }
  document.addEventListener("click", (e) => { const b = e.target.closest?.("[data-pll-act]"); if (!b || b.disabled) return; e.preventDefault(); act(b.dataset.pllAct, b.dataset.key, b.getAttribute("aria-pressed") !== "true", b.dataset.name || ""); });

  // ---------- a list as a card ----------
  function card(l, { follow = true } = {}) { css(); const u = safeUrl(l.url) || "#";
    const sub = [l.by ? `By ${l.by}` : "", plural(l.count || 0, "thing"), l.followers ? plural(l.followers, "follower") : ""].filter(Boolean).join(" · ");
    return `<article class="pll-card"><a href="${esc(u)}">${collage(l.covers)}<span class="pll-bd"><b>${esc(l.name)}</b><small>${esc(sub)}</small></span></a>${follow && !l.mine ? `<div class="pll-ft">${btn("list", l.token, l.following, { name: l.name })}</div>` : ""}</article>`; }

  // ---------- I'd go again ----------
  /** The line and, when the viewer went, the button. info: { count, line, mine, can } from the server. */
  function again(info, kind, ref) { css(); if (!info || (!info.count && !info.can && !info.mine)) return "";
    return `<span class="pll-again" data-pll-again-box="${esc(kind)}:${esc(ref)}">${info.count ? `<span class="pll-mark" aria-hidden="true">${CHECK}</span><span>${esc(info.line)}</span>` : ""}${info.mine ? `<button type="button" class="pll-undo" data-pll-again="${esc(kind)}:${esc(ref)}" aria-pressed="true">Take it back</button>` : info.can ? `<button type="button" class="pll-btn" data-pll-again="${esc(kind)}:${esc(ref)}" aria-pressed="false">${CHECK}I'd go again</button>` : ""}</span>`; }
  document.addEventListener("click", async (e) => { const b = e.target.closest?.("[data-pll-again]"); if (!b || b.disabled) return; e.preventDefault(); if (!signed()) { location.href = "/login?next=" + encodeURIComponent(location.pathname); return; }
    const [kind, ...rest] = b.dataset.pllAgain.split(":"), ref = rest.join(":"), on = b.getAttribute("aria-pressed") !== "true"; b.disabled = true;
    const r = await api("/api/me/again", { kind, ref, on }); b.disabled = false; if (!r.ok) { toast(r.j.message || "That didn't go through. Try again."); return; }
    document.querySelectorAll(`[data-pll-again-box="${CSS.escape(kind + ":" + ref)}"]`).forEach((box) => { box.outerHTML = again({ ...r.j, can: !r.j.mine }, kind, ref); });
    if (on) toast("Thanks. That helps people pick.", async () => { const u = await api("/api/me/again", { kind, ref, on: false }); if (u.ok) document.querySelectorAll(`[data-pll-again-box="${CSS.escape(kind + ":" + ref)}"]`).forEach((box) => { box.outerHTML = again({ ...u.j, can: true }, kind, ref); }); }); });

  // ---------- the curator's strip ----------
  const strip = (s) => (s && css() === undefined ? `<div class="pll-strip" role="group" aria-label="Your lists"><div><b>${s.followers || 0}</b><small>${s.followers === 1 ? "follower" : "followers"}</small></div><div><b>${s.saves || 0}</b><small>saves of your lists</small></div><div><b>${s.went || 0}</b><small>went to something from them</small></div></div>` : "");

  // ---------- Discover: Lists people love ----------
  async function shelf() { if (document.getElementById("pllShelf")) return; const anchor = document.getElementById("hostsSec"); if (!anchor) return;
    const r = await api("/api/public/lists-popular"); const L = r.ok ? r.j.lists || [] : []; if (!L.length || document.getElementById("pllShelf")) return; css();
    const sec = document.createElement("section"); sec.id = "pllShelf"; sec.setAttribute("aria-labelledby", "pllShelfH");
    sec.innerHTML = `<div class="sec-h"><h2 id="pllShelfH">Lists people love</h2></div><p class="lede">Picked by guests who went. Follow a list to see what they add.</p><div class="pll-row" tabindex="0" aria-label="Lists people love">${L.map((l) => card(l)).join("")}</div>`;
    anchor.before(sec); }

  // ---------- a host's page: On N public lists, I'd go again, the person's own lists ----------
  async function hostPage(handle) { if (document.getElementById("pllHost")) return;
    const H = await api("/api/public/host-lists/" + encodeURIComponent(handle)); if (!H.ok) return;
    const h = H.j, a = h.again && (h.again.count || h.again.can || h.again.mine) ? h.again : null, p = h.curator; if (!h.count && !a && !p) return;
    const place = () => { if (document.getElementById("pllHost")) return true; const ex = document.getElementById("extras"); if (!ex) return false; css();
      const sec = document.createElement("section"); sec.id = "pllHost"; sec.className = "pll-host"; sec.setAttribute("aria-labelledby", "pllHostH");
      sec.innerHTML = `${h.count ? `<h2 class="sec" id="pllHostH">On ${plural(h.count, "public list")}</h2><p>Guests keep this host in lists they share.</p><div class="pll-row">${h.top.map((l) => card(l)).join("")}</div>` : `<h2 class="sec" id="pllHostH">${p ? `${esc(p.name)}'s lists` : "Would go again"}</h2>`}
        ${a ? again(a, "host", handle) : ""}
        ${p ? `<p style="margin-top:12px"><a class="pll-btn" href="/@${esc(p.handle)}/lists">${esc(p.name)}'s lists · ${plural(p.lists, "list")}</a></p>` : ""}`;
      ex.after(sec); return true; };
    if (!place()) { const mo = new MutationObserver(() => { if (place()) mo.disconnect(); }); mo.observe(document.body, { childList: true, subtree: true }); setTimeout(() => mo.disconnect(), 15000); } }

  // ---------- an event page: would go again ----------
  async function eventPage(id) { const r = await api("/api/public/again?kind=event&ref=" + encodeURIComponent(id)); if (!r.ok) return; const html = again(r.j, "event", id); if (!html) return;
    const place = () => { if (document.querySelector(`[data-pll-again-box="event:${CSS.escape(id)}"]`)) return true; const anchor = document.querySelector(`.plf[data-e="${CSS.escape(id)}"]`) || document.querySelector("main .facts") || document.querySelector("#view-guest .lk-title"); if (!anchor) return false;
      const box = document.createElement("div"); box.innerHTML = html; anchor.after(box.firstElementChild); return true; };
    if (!place()) { const mo = new MutationObserver(() => { if (place()) mo.disconnect(); }); mo.observe(document.body, { childList: true, subtree: true }); setTimeout(() => mo.disconnect(), 15000); } }

  function boot() { const p = location.pathname;
    if (p === "/discover") shelf();
    const h = /^\/@([a-z0-9][a-z0-9-]{1,29})$/.exec(p); if (h) hostPage(h[1]);
    const e = /^\/e\/([A-Za-z0-9_-]{2,80})$/.exec(p) || (p === "/g" && /^#rsvp-([A-Za-z0-9_-]{2,80})/.exec(location.hash)); if (e) eventPage(e[1]); } // /g#rsvp-<id>: the full invite, where a past event lands
  window.addEventListener("hashchange", () => { if (location.pathname === "/g") boot(); });
  window.PLLists = { css, toast, card, collage, pic, btn, act, again, strip, shelf, hostPage, eventPage, api, esc, safeUrl, plural };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", boot) : boot();
})();
