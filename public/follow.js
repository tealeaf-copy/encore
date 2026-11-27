// Follow, in place, on every card and host page. One tap follows (POST /api/me/following/:handle, server/fanclub.js):
// the button turns into "Following" with a check, follower counts on the page move, and a toast says
// "You'll hear when <Host> posts something new · Undo". Tapping "Following" opens a tiny menu: notifications on or off
// (the bell the server keeps per follow) and Unfollow. Nothing navigates.
// Signed out, one tap goes to the light sign-up with ?next= back to the same page and ?pl_follow=<handle>; back here,
// signed in, the follow goes through once and the same toast shows (the param is taken off the address).
// Preview pages (a host who isn't on Pottery Lab yet, data-showcase): "Notify me when they join". The same endpoint
// keeps it (server/interest.js) and, when they claim the page, emails once and makes you a follower.
//
// Markup: PLFollow.button({ handle, name, showcase }, { cls }) or any <button data-pl-follow="handle" data-name="..">.
// Counts: an element with data-pl-followers="handle" shows "12 followers" (data-pl-fmt="count" for the number only).
// Pages hear window "pl:follow" ({ handle, following, notify, followers, waiting }) to redraw anything else.
(function () {
  if (window.PLFollow) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const signed = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  const HANDLE = /^[a-z0-9][a-z0-9-]{1,39}$/;
  const CSS = `.plf-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;min-width:44px;padding:0 16px;border:1.5px solid var(--pl-accent,#29489A);border-radius:6px;background:var(--pl-accent,#29489A);color:#fff;font:600 15px/1.2 var(--pl-font-text,"IBM Plex Sans"),system-ui,sans-serif;cursor:pointer;white-space:nowrap;text-decoration:none;box-sizing:border-box}
.plf-btn:hover{filter:brightness(1.08)}[data-pl-follow][aria-pressed=true],[data-fb-follow][aria-pressed=true],[data-fb-friend][aria-pressed=true]{background:var(--pl-surface,#FAF8F3)!important;color:var(--pl-ink,#1B1D1C)!important;border-color:var(--pl-ink,#1B1D1C)!important;filter:none}
.plf-ck{width:16px;height:16px;flex:none}[data-fb-follow] .plf-ck,[data-fb-friend] .plf-ck{margin-right:6px;vertical-align:-2px}.plf-sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
[data-pl-follow]:focus-visible,[data-fb-follow]:focus-visible,.plf-menu button:focus-visible{outline:3px solid var(--pl-focus,rgba(41,72,154,.3));outline-offset:2px}
[data-pl-follow].plf-hi{box-shadow:0 0 0 4px var(--pl-sand,#F3E7A8),0 0 0 5.5px var(--pl-ink,#1B1D1C)}
.plf-line{margin:8px 0 0;font:500 14px/1.4 var(--pl-font-text,"IBM Plex Sans"),system-ui,sans-serif;color:var(--pl-ink,#1B1D1C)}
.plf-menu{position:fixed;z-index:9250;width:248px;padding:6px;background:var(--pl-surface,#FAF8F3);border:1.5px solid var(--pl-ink,#1B1D1C);border-radius:6px;box-shadow:0 10px 28px -16px rgba(27,29,28,.45);display:grid;gap:2px;font:500 15px/1.3 var(--pl-font-text,"IBM Plex Sans"),system-ui,sans-serif;box-sizing:border-box}
.plf-menu button{display:flex;align-items:center;gap:10px;width:100%;min-height:44px;padding:0 10px;border:0;border-radius:6px;background:none;color:var(--pl-ink,#1B1D1C);font:inherit;text-align:left;cursor:pointer}.plf-menu button:hover{background:var(--pl-raised,#E6E1D5)}
.plf-menu button svg{width:20px;height:20px;flex:none}.plf-menu .plf-st{margin-left:auto;color:var(--pl-soft,#444845);font-size:14px}.plf-menu [data-a=off]{color:var(--pl-danger,#A2361A)}`;
  const css = () => { if (document.getElementById("plfCss")) return; const s = document.createElement("style"); s.id = "plfCss"; s.textContent = CSS; document.head.appendChild(s); };
  const CHECK = `<svg class="plf-ck" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const BELL = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>`;
  const LEAVE = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

  // ---- the toast (shared with public/savelist.js: whichever loads first makes it) ----
  const T = () => window.PLActionToast || (window.PLActionToast = (() => {
    const CSS2 = `.plt{position:fixed;left:50%;bottom:calc(88px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:9300;width:min(calc(100vw - 32px),440px);display:flex;align-items:center;gap:4px;padding:6px 6px 6px 14px;background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);border:1.5px solid var(--pl-ink,#1B1D1C);border-radius:6px;box-shadow:0 10px 28px -16px rgba(27,29,28,.45);font:500 15px/1.4 var(--pl-font-text,"IBM Plex Sans"),system-ui,sans-serif;box-sizing:border-box}
.plt-m{flex:1;min-width:0;padding:6px 0}.plt-m b{font-weight:600}.plt-a{flex:none;display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;padding:0 12px;border:0;border-radius:6px;background:none;color:var(--pl-accent,#29489A);font:600 15px var(--pl-font-text,"IBM Plex Sans"),system-ui;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.plt-a:focus-visible{outline:3px solid var(--pl-focus,rgba(41,72,154,.3));outline-offset:1px}.plt-live{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (min-width:861px){.plt{bottom:28px}}.psl-bg~.plt{bottom:auto;top:calc(12px + env(safe-area-inset-top))}@media (prefers-reduced-motion:no-preference){.plt{animation:pltIn .2s ease-out}@keyframes pltIn{from{opacity:0;transform:translate(-50%,8px)}}}`;
    let live = null, el = null, timer = 0;
    const mount = () => { if (live || !document.body) return; const st = document.createElement("style"); st.textContent = CSS2; document.head.appendChild(st);
      live = document.createElement("div"); live.className = "plt-live"; live.setAttribute("role", "status"); live.setAttribute("aria-live", "polite"); live.setAttribute("aria-atomic", "true"); document.body.appendChild(live); };
    document.body ? mount() : document.addEventListener("DOMContentLoaded", mount);
    const hide = () => { clearTimeout(timer); el?.remove(); el = null; };
    function show(html, { action, ms = 5000 } = {}) { mount(); hide(); el = document.createElement("div"); el.className = "plt";
      el.innerHTML = `<span class="plt-m">${html}</span>${action ? (action.href ? `<a class="plt-a" href="${esc(action.href)}">${esc(action.label)}</a>` : `<button type="button" class="plt-a">${esc(action.label)}</button>`) : ""}`;
      if (action?.fn) el.querySelector("button.plt-a").onclick = () => { hide(); action.fn(); };
      document.body.appendChild(el); const text = el.querySelector(".plt-m").textContent.replace(/[.\s]+$/, "") + "." + (action ? ` ${action.label} is in the message.` : "");
      if (live) { live.textContent = ""; setTimeout(() => { if (live) live.textContent = text; }, 60); }
      const arm = () => { clearTimeout(timer); timer = setTimeout(hide, ms); }; el.addEventListener("mouseenter", () => clearTimeout(timer)); el.addEventListener("mouseleave", arm); el.addEventListener("focusin", () => clearTimeout(timer)); el.addEventListener("focusout", arm); arm(); return el; }
    return { show, hide };
  })());
  T();

  // ---- what you follow (signed in): handle -> { notify }, and preview pages you asked about ----
  let follows = null, waiting = new Set(), loading = null;
  function load(force) { if (!signed()) return Promise.resolve(null); if (loading && !force) return loading;
    loading = fetch("/api/me/following", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (!j) return null;
      follows = new Map((j.hosts || []).map((h) => [h.handle, { notify: h.notify !== false, name: h.name }])); waiting = new Set(j.waiting || []); paintAll(); return follows; }).catch(() => null); return loading; }
  const handleOf = (b) => String(b.dataset.plFollow || b.dataset.fbFollow || "").toLowerCase();
  const isPreview = (b) => b.dataset.showcase === "1";
  const nameOf = (b) => b.dataset.name || (b.querySelector(".plf-sr,.fb-sr,.sr")?.textContent || "").trim() || "this host";
  const isOn = (h, preview) => (preview ? waiting.has(h) : !!follows?.has(h));
  const all = (h) => [...document.querySelectorAll("[data-pl-follow],[data-fb-follow]")].filter((b) => handleOf(b) === h);
  /** The button's words and state: Follow / Following with a check; on a preview page, Notify me when they join / We'll tell you. */
  function paint(b) { const h = handleOf(b); if (!h) return; if (!follows && signed() && b.dataset.plfOn) return; const pv = isPreview(b), on = isOn(h, pv), nm = nameOf(b);
    if (b.dataset.plfOn === String(on) && b.dataset.plfDone) return; b.dataset.plfOn = String(on); b.dataset.plfDone = "1";
    if (!b.dataset.name && nm !== "this host") b.dataset.name = nm;
    b.setAttribute("aria-pressed", String(on)); b.disabled = false; b.classList.toggle("on", on);
    const word = pv ? (on ? "We'll tell you" : "Notify me when they join") : on ? "Following" : "Follow";
    b.innerHTML = `${on ? CHECK : ""}<span class="plf-t">${word}</span><span class="plf-sr"> ${esc(nm)}${on ? (pv ? ". Opens options" : ". Opens follow options") : ""}</span>`; }
  function paintAll() { css(); document.querySelectorAll("[data-pl-follow],[data-fb-follow]").forEach(paint); }
  const fmt = (n) => `${n} ${n === 1 ? "follower" : "followers"}`;
  function counts(h, n) { if (!Number.isFinite(+n)) return; document.querySelectorAll("[data-pl-followers]").forEach((el) => { if (el.dataset.plFollowers !== h) return; el.textContent = el.dataset.plFmt === "count" ? String(n) : fmt(+n); if (el.hasAttribute("data-pl-hide-zero")) el.hidden = !+n; }); }
  const tell = (d) => { try { window.dispatchEvent(new CustomEvent("pl:follow", { detail: d })); } catch {} };

  // ---- talking to the server ----
  async function send(h, body) { const r = await fetch(`/api/me/following/${encodeURIComponent(h)}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {}; if (r?.status === 401) { signIn(h); return null; } if (!r?.ok) throw new Error(j.message || "That didn't go through. Try again."); return j; }
  function apply(h, j, name) { if (j.preview) { j.waiting ? waiting.add(h) : waiting.delete(h); } else { if (!follows) follows = new Map(); j.following ? follows.set(h, { notify: j.notify !== false, name: j.name || name }) : follows.delete(h); }
    all(h).forEach((b) => { delete b.dataset.plfDone; paint(b); }); if (j.followers != null) counts(h, j.followers);
    tell({ handle: h, following: !!j.following, notify: !!j.notify, followers: j.followers, waiting: !!j.waiting, preview: !!j.preview });
    try { const L = JSON.parse(localStorage.getItem("encore.following") || "[]").filter((x) => x !== h); if (j.following) L.push(h); localStorage.setItem("encore.following", JSON.stringify(L)); } catch {} }
  const said = (h, j, name) => (j.preview ? `We'll email you when <b>${esc(name)}</b> joins Pottery Lab.` : `You'll hear when <b>${esc(name)}</b> posts something new.`);
  /** Follow (or ask to hear when a preview host joins), then the toast with Undo. */
  async function follow(h, { name = "", btn = null } = {}) { h = String(h || "").toLowerCase(); if (!HANDLE.test(h)) return null;
    all(h).forEach((b) => (b.disabled = true));
    let j; try { j = await send(h, { on: true }); } catch (e) { all(h).forEach((b) => { b.disabled = false; }); T().show(esc(e.message)); return null; } finally { all(h).forEach((b) => { b.disabled = false; }); }
    if (!j) return null; const nm = j.name || name || (btn && nameOf(btn)) || "them"; apply(h, j, nm);
    T().show(said(h, j, nm), { action: { label: "Undo", fn: () => unfollow(h, { name: nm, quiet: true, focus: btn }) } }); return j; }
  async function unfollow(h, { name = "", quiet = false, focus = null } = {}) { let j; try { j = await send(h, { on: false }); } catch (e) { T().show(esc(e.message)); return null; } if (!j) return null;
    const nm = j.name || name || "them"; apply(h, j, nm); try { focus?.focus?.({ preventScroll: true }); } catch {}
    T().show(j.preview ? `Okay. We won't email you about <b>${esc(nm)}</b>.` : quiet ? `Okay, you're not following <b>${esc(nm)}</b>.` : `You unfollowed <b>${esc(nm)}</b>.`, quiet ? {} : { action: { label: "Undo", fn: () => follow(h, { name: nm, btn: focus }) } }); return j; }
  async function bell(h, on, name) { let j; try { j = await send(h, { on: true, notify: on }); } catch (e) { T().show(esc(e.message)); return null; } if (!j) return null; apply(h, j, name);
    T().show(on ? `Notifications on. You'll hear when <b>${esc(name)}</b> posts something new.` : `Notifications off. You still follow <b>${esc(name)}</b>.`); return j; }

  // ---- signed out: the light sign-up, then back here to finish ----
  function backUrl(h) { const u = new URL(location.href); u.searchParams.set("pl_follow", h); return u.pathname + u.search + u.hash; }
  function signIn(h) { location.href = `/signup?mode=friends&from=follow&regularOf=${encodeURIComponent(h)}&next=${encodeURIComponent(backUrl(h))}`; }

  // ---- the tiny menu on "Following": notifications and Unfollow ----
  function menu(b) { closeMenu(); css(); const h = handleOf(b), pv = isPreview(b), nm = nameOf(b), f = follows?.get(h), r = b.getBoundingClientRect();
    const m = document.createElement("div"); m.className = "plf-menu"; m.setAttribute("role", "menu"); m.setAttribute("aria-label", `Follow options for ${nm}`);
    m.innerHTML = pv ? `<button type="button" role="menuitem" data-a="off">${LEAVE}<span>Don't email me</span></button>`
      : `<button type="button" role="menuitemcheckbox" aria-checked="${f?.notify !== false}" data-a="bell">${BELL}<span>Notifications</span><span class="plf-st">${f?.notify !== false ? "On" : "Off"}</span></button><button type="button" role="menuitem" data-a="off">${LEAVE}<span>Unfollow</span></button>`;
    document.body.appendChild(m); const w = m.offsetWidth, hgt = m.offsetHeight; m.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + "px"; m.style.top = (r.bottom + 6 + hgt > innerHeight ? Math.max(8, r.top - hgt - 6) : r.bottom + 6) + "px";
    b.setAttribute("aria-expanded", "true"); const items = [...m.querySelectorAll("button")];
    const done = (focus = true) => { m.remove(); b.removeAttribute("aria-expanded"); document.removeEventListener("pointerdown", out, true); document.removeEventListener("keydown", key, true); open = null; if (focus) try { b.focus({ preventScroll: true }); } catch {} };
    const out = (e) => { if (!m.contains(e.target) && e.target !== b && !b.contains(e.target)) done(false); };
    const key = (e) => { if (e.key === "Escape") { e.preventDefault(); done(); } else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const i = items.indexOf(document.activeElement); items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus(); } else if (e.key === "Tab") done(false); };
    setTimeout(() => document.addEventListener("pointerdown", out, true), 0); document.addEventListener("keydown", key, true);
    m.querySelector("[data-a=bell]")?.addEventListener("click", async () => { done(); await bell(h, !(follows?.get(h)?.notify !== false), nm); });
    m.querySelector("[data-a=off]").addEventListener("click", async () => { done(); await unfollow(h, { name: nm, focus: b }); });
    items[0].focus({ preventScroll: true }); open = { b, done }; }
  let open = null; const closeMenu = () => open?.done(false);

  /** A tap on any follow button: follow, open the menu, or go sign in. */
  function tap(b, e) { if (e) { e.preventDefault(); e.stopPropagation(); } const h = handleOf(b); if (!HANDLE.test(h) || b.disabled) return;
    if (!signed()) return signIn(h);
    if (open?.b === b) return closeMenu();
    if (isOn(h, isPreview(b))) return menu(b);
    follow(h, { name: nameOf(b), btn: b }); }
  // ---- people (POST /api/me/friends, DELETE /api/me/friends/:key, server/social.js): Follow, then Following with Unfollow ----
  const people = new Set();
  function paintPerson(b, on) { const nm = nameOf(b); if (!b.dataset.name && nm !== "this host") b.dataset.name = nm; b.setAttribute("aria-pressed", String(on)); b.classList.toggle("on", on); b.disabled = false;
    b.innerHTML = `${on ? CHECK : ""}<span class="plf-t">${on ? "Following" : "Follow"}</span><span class="plf-sr"> ${esc(nm)}${on ? ". Opens follow options" : ""}</span>`; }
  const personBtns = (k) => [...document.querySelectorAll("[data-fb-friend]")].filter((x) => x.dataset.fbFriend === k);
  async function person(k, on, b) { const nm = nameOf(b); personBtns(k).forEach((x) => (x.disabled = true));
    const r = await fetch(on ? "/api/me/friends" : `/api/me/friends/${encodeURIComponent(k)}`, { method: on ? "POST" : "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: on ? JSON.stringify({ key: k }) : undefined }).catch(() => null);
    personBtns(k).forEach((x) => (x.disabled = false)); if (r?.status === 401) { location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`; return; }
    if (!r?.ok) { T().show(on ? "Couldn't follow just now. Try again." : "Couldn't unfollow just now. Try again."); return; }
    on ? people.add(k) : people.delete(k); personBtns(k).forEach((x) => paintPerson(x, on)); try { b.focus({ preventScroll: true }); } catch {}
    T().show(on ? `You're following <b>${esc(nm)}</b>. You'll see their plans in your feed.` : `You unfollowed <b>${esc(nm)}</b>.`, { action: { label: "Undo", fn: () => person(k, !on, b) } }); }
  function tapPerson(b, e) { if (e) { e.preventDefault(); e.stopPropagation(); } const k = b.dataset.fbFriend; if (!k || b.disabled) return;
    if (!signed()) { location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`; return; }
    if (!people.has(k)) return person(k, true, b);
    closeMenu(); css(); const r = b.getBoundingClientRect(), m = document.createElement("div"); m.className = "plf-menu"; m.setAttribute("role", "menu"); m.setAttribute("aria-label", `Follow options for ${nameOf(b)}`);
    m.innerHTML = `<button type="button" role="menuitem" data-a="off">${LEAVE}<span>Unfollow</span></button>`; document.body.appendChild(m);
    const w = m.offsetWidth, hgt = m.offsetHeight; m.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + "px"; m.style.top = (r.bottom + 6 + hgt > innerHeight ? Math.max(8, r.top - hgt - 6) : r.bottom + 6) + "px";
    const done = (focus = true) => { m.remove(); document.removeEventListener("pointerdown", out, true); document.removeEventListener("keydown", key, true); open = null; if (focus) try { b.focus({ preventScroll: true }); } catch {} };
    const out = (ev) => { if (!m.contains(ev.target) && !b.contains(ev.target)) done(false); }, key = (ev) => { if (ev.key === "Escape") { ev.preventDefault(); done(); } else if (ev.key === "Tab") done(false); };
    setTimeout(() => document.addEventListener("pointerdown", out, true), 0); document.addEventListener("keydown", key, true);
    m.querySelector("[data-a=off]").onclick = () => { done(); person(k, false, b); }; m.querySelector("button").focus({ preventScroll: true }); open = { b, done }; }
  /** The button's markup. host: { handle, name, showcase }. opts: { cls, id } */
  function button(host, opts = {}) { css(); const h = String(host?.handle || "").toLowerCase(); if (!HANDLE.test(h)) return "";
    const pv = !!(host.showcase || host.preview), on = follows ? isOn(h, pv) : opts.on != null ? !!opts.on : isOn(h, pv), nm = String(host.name || "@" + h);
    return `<button type="button" class="plf-btn${opts.cls ? " " + esc(opts.cls) : ""}"${opts.id ? ` id="${esc(opts.id)}"` : ""} data-pl-follow="${esc(h)}" data-name="${esc(nm)}"${pv ? ' data-showcase="1"' : ""} aria-pressed="${on}" data-plf-on="${on}" data-plf-done="1">${on ? CHECK : ""}<span class="plf-t">${pv ? (on ? "We'll tell you" : "Notify me when they join") : on ? "Following" : "Follow"}</span><span class="plf-sr"> ${esc(nm)}</span></button>`; }
  // clicks before a parent link or card can take them
  document.addEventListener("click", (e) => { const b = e.target.closest?.("[data-pl-follow]"); if (b) tap(b, e); }, true);

  // ---- back from signing in: finish the follow once, and say so ----
  let returned = "";
  (function back() { const u = new URL(location.href), h = String(u.searchParams.get("pl_follow") || "").toLowerCase(); if (!h) return; u.searchParams.delete("pl_follow"); history.replaceState(history.state, "", u.pathname + u.search + u.hash);
    if (!HANDLE.test(h) || !signed()) return; returned = h;
    const go = async () => { await load(); const b = all(h)[0], pv = b ? isPreview(b) : false;
      if (isOn(h, pv)) { const nm = (b && nameOf(b)) || follows?.get(h)?.name || "them"; T().show(pv ? `We'll email you when <b>${esc(nm)}</b> joins Pottery Lab.` : `You're following <b>${esc(nm)}</b>. You'll hear when they post something new.`); return; }
      follow(h, { name: b ? nameOf(b) : "", btn: b }); };
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", go) : go(); })();

  // buttons drawn later get painted too
  const watch = () => { css(); load(); paintAll(); let t = 0; new MutationObserver(() => { clearTimeout(t); t = setTimeout(paintAll, 120); }).observe(document.body, { childList: true, subtree: true }); };
  document.body ? watch() : document.addEventListener("DOMContentLoaded", watch);
  window.PLFollow = { button, tap, tapPerson, follow, unfollow, bell, load, paint: paintAll, isOn: (h, pv) => isOn(String(h).toLowerCase(), !!pv), returnedFrom: () => returned, toast: (h, o) => T().show(h, o) };
})();
