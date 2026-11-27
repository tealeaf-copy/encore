// The peek: tap a row on Plans (the timeline, or a day in the calendar) and a sheet opens with the event and your reply,
// instead of leaving the page. A bottom sheet on phones, a panel on the right on wide screens. window.PLPeek.
//
// - Rows stay real links (/e/<id> or /plans/<id>): long-press, open in a new tab and modifier clicks work as before.
//   A plain tap is caught and opens the sheet. Esc, a swipe down, the close button or the back button close it.
//   Focus moves in, stays in, and goes back to the row.
// - The data comes from GET /api/plans/peek/:id (server/plans.js): only what this viewer may see. It is asked for on
//   touchstart or hover, so the sheet usually opens full.
// - Your reply is a segmented control (I'm in · Maybe · Can't go). A tap changes it right there through
//   POST /api/plans/peek/:id/reply, with the reply proof this browser holds or your account. The control moves first
//   and goes back if the server says no. A paid spot, an ask to join or an order says so in a line, with the event page.
//   The waitlist says your place and offers Leave waitlist.
// - attach(root, { onChange(id, items, peek) }): onChange gets the fresh timeline rows for that event after a change.
// Styles: public/peek.css. Brand tokens only.
(function () {
  if (window.PLPeek) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ic = (d) => `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
  const I = { x: ic("M5 5l10 10M15 5L5 15"), cal: ic("M4 5.5h12v10.5H4zM4 8.5h12M7 3.5v3M13 3.5v3"), pin: ic("M10 17c-3.4-4-5-6.9-5-9.2a5 5 0 0 1 10 0C15 10.1 13.4 13 10 17zM10 9.6a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z"),
    clock: ic("M10 3.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM10 6.5V10l2.5 1.5"), open: ic("M8 4.5H4.5v11h11V12M11 4.5h4.5V9M15.5 4.5 9 11"), pair: ic("M7.2 9.2a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2zM2.6 16.2c.4-3 2.2-4.7 4.6-4.7s4.2 1.7 4.6 4.7M13.6 9.6a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4zM12.6 11.6c2.4-.4 4.5 1.1 4.9 4.1"),
    chat: ic("M4 5h12v8H9l-3.5 3v-3H4z"), share: ic("M10 12.5V3.5M6.5 7 10 3.5 13.5 7M4.5 10.5v6h11v-6"), edit: ic("M4 16l1-4 8-8 3 3-8 8zM11.5 5.5l3 3"), check: ic("M4.5 10.5l3.5 3.5 7.5-8"), people: ic("M10 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4.5 16.5c.5-3.2 2.7-5 5.5-5s5 1.8 5.5 5") };
  const signedIn = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  const proofOf = (id) => { try { const v = JSON.parse(localStorage.getItem("encore-rsvp-" + id) || "null"); return v?.rid && v?.code ? v : null; } catch { return null; } };
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } })();

  // ---- the data: asked for once, kept for half a minute, refreshed after a change ----
  const cache = new Map(), TTL = 30e3;
  function load(id, { fresh = false } = {}) {
    const hit = cache.get(id); if (!fresh && hit && Date.now() - hit.at < TTL) return hit.p;
    const P = proofOf(id), q = P ? `?rid=${encodeURIComponent(P.rid)}&code=${encodeURIComponent(P.code)}` : "";
    const p = fetch(`/api/plans/peek/${encodeURIComponent(id)}${q}`, { credentials: "same-origin", ...(fresh ? { cache: "reload" } : {}) }).then((r) => (r.ok ? r.json() : null)).then((j) => j?.peek || null).catch(() => null);
    cache.set(id, { at: Date.now(), p }); p.then((x) => { if (!x) cache.delete(id); }); return p;
  }
  const prime = (id, peek) => cache.set(id, { at: Date.now(), p: Promise.resolve(peek) });

  // ---- the look ----
  const STATE_LINE = { going: "You're in.", maybe: "You said maybe.", no: "You can't go." };
  function avatarHtml(h, size = 36) {
    if (h.avatarUrl) return `<img src="${esc(h.avatarUrl)}" alt="" width="${size}" height="${size}">`;
    const A = window.EncoreAvatars; if (h.avatarArt && A?.valid?.(h.avatarArt)) { try { return A.svg(h.avatarArt, h.color || undefined, size); } catch {} }
    return `<span class="pk-ini">${esc((h.first || h.name || "?").slice(0, 1).toUpperCase())}</span>`;
  }
  function coverHtml(p) {
    if (p.cover) return `<img src="${esc(p.cover)}" alt="" loading="lazy">`;
    try { const E = window.EventArt; if (E?.cover) { E.ensureCss?.(); const a = E.cover({ title: p.title, coverArt: p.coverArt, date: p.date }, { title: "", label: "" }); if (typeof a === "string" && a) return a; } } catch {}
    return `<span class="pk-art-blank" aria-hidden="true"></span>`;
  }
  function whoHtml(w) { if (!w || !w.count) return w ? `<p class="pk-who"><span class="pk-whotxt">No one's in yet.</span></p>` : "";
    const A = window.EncoreAvatars, names = w.names || [], faces = w.faces || [];
    const dots = names.length ? names.map((n) => `<span class="pk-face" aria-hidden="true">${esc(n.name.slice(0, 1).toUpperCase())}</span>`).join("")
      : faces.map((f) => `<span class="pk-face pk-face-art" aria-hidden="true">${A?.valid?.(f.art) ? A.svg(f.art, f.color || undefined, 30) : ""}</span>`).join("");
    const list = names.length ? names.map((n) => (n.you ? "you" : n.name)) : [], more = w.count - list.length;
    const line = list.length ? `${esc(list.join(", "))}${more > 0 ? ` and ${more} more` : ""}` : "";
    return `<div class="pk-who"><span class="pk-faces">${dots}</span><span class="pk-whotxt"><b>${w.count} going</b>${line ? `<small>${line}</small>` : ""}</span></div>`; }
  function replyHtml(p) { const R = p.reply; if (!R) return "";
    if (R.closed) return `<section class="pk-reply" aria-label="Your reply"><h3>Your reply</h3><p class="pk-line">${esc(R.closed)}${R.status ? ` You said: ${esc(R.status)}.` : ""}</p></section>`;
    if (!R.state) return `<section class="pk-reply" aria-label="Your reply"><h3>Your reply</h3><p class="pk-line">You haven't replied yet.</p><a class="pk-btn" href="${esc(p.invite)}">Reply on the event page</a></section>`;
    if (R.state === "waitlist") return `<section class="pk-reply" aria-label="Your reply"><h3>Your reply</h3><p class="pk-wait">${R.pos ? `You're #${R.pos} on the waitlist` : "You're on the waitlist"}</p><p class="pk-line">If a spot opens, you're in and we'll tell you.</p><button type="button" class="pk-btn" data-pk-set="no" data-pk-leave>Leave waitlist</button><p class="pk-msg" role="status" aria-live="polite"></p></section>`;
    if (R.state === "requested") return `<section class="pk-reply" aria-label="Your reply"><h3>Your reply</h3><p class="pk-wait">You asked to join</p><p class="pk-line">${esc(R.hostFirst || "The host")} lets each guest in. We'll tell you.</p><button type="button" class="pk-btn" data-pk-set="no" data-pk-leave>Take back my ask</button><p class="pk-msg" role="status" aria-live="polite"></p></section>`;
    return `<section class="pk-reply" aria-label="Your reply"><h3 id="pkRh">Your reply</h3><div class="pk-seg" role="group" aria-labelledby="pkRh">${R.answers.map((a) => `<button type="button" data-pk-set="${esc(a.value)}" aria-pressed="${a.value === R.state}">${esc(a.label)}</button>`).join("")}</div>`
      + `<p class="pk-msg" role="status" aria-live="polite">${R.status && R.status !== "Going" && R.status !== "Maybe" ? esc(R.status) : ""}</p></section>`; }
  function hostHtml(p) { const M = p.manage; if (!M) return "";
    const stats = [`<span><b>${M.going}</b> in</span>`, M.asking ? `<span><b>${M.asking}</b> to approve</span>` : "", M.waiting ? `<span><b>${M.waiting}</b> waiting</span>` : ""].filter(Boolean).join("");
    return `<section class="pk-reply pk-mine" aria-label="Your event"><h3>Your event${M.draft ? " · Draft" : ""}</h3><p class="pk-stats">${stats}</p>${M.approve ? `<a class="pk-btn pk-approve" href="${esc(M.approve)}">${I.check}Review ${M.asking} ${M.asking === 1 ? "reply" : "replies"} to approve</a>` : ""}</section>`; }
  function actsHtml(p) { const A = p.actions || {}, host = p.role === "host", L = [];
    if (host) { L.push(`<a class="pk-btn pk-pri" href="${esc(p.manage.href)}">${I.edit}Manage event</a>`); if (p.manage.share) L.push(`<button type="button" class="pk-btn" data-pk-share>${I.share}Share invite</button>`); L.push(`<a class="pk-btn" href="${esc(p.href)}">${I.open}Open event page</a>`); }
    else L.push(`<a class="pk-btn pk-pri" href="${esc(p.href)}">${I.open}Open event page</a>`);
    if (A.calendar) L.push(`<button type="button" class="pk-btn" data-pk-cal aria-haspopup="menu" aria-expanded="false">${I.cal}Add to calendar</button>`);
    if (A.invite) L.push(`<button type="button" class="pk-btn" data-pk-invite>${I.pair}Invite friends</button>`);
    if (A.chat) L.push(`<a class="pk-btn" href="${esc(A.chat)}">${I.chat}Open group chat</a>`);
    return `<div class="pk-acts">${L.join("")}</div><div class="pk-note" aria-live="polite"></div>`; }
  /** The sheet's inside for one peek. Pure apart from the avatar and art helpers. */
  function html(p) {
    const lock = p.locked && p.place && p.role !== "host" ? ` · <span class="pk-lock">address when you're in</span>` : "";
    return `<figure class="pk-cover">${coverHtml(p)}${p.chip ? `<figcaption class="pk-chip">${esc(p.chip)}</figcaption>` : ""}</figure>`
      + `${p.host?.name || p.host?.first ? `<a class="pk-host"${p.host.href ? ` href="${esc(p.host.href)}"` : ""}><span class="pk-av">${avatarHtml(p.host)}</span><span>Hosted by <b>${p.role === "host" ? "you" : esc(p.host.name || p.host.first)}</b></span></a>` : ""}`
      + `<h2 class="pk-title" id="pkTitle">${esc(p.title)}</h2>`
      + `<p class="pk-fact">${I.clock}<span>${esc(p.when)}</span></p>`
      + (p.place || p.online ? `<p class="pk-fact">${I.pin}<span>${esc(p.place || "Online")}${lock}${p.address ? `<small class="pk-addr">${esc(p.address)}</small>` : ""}</span></p>` : "")
      + (p.desc ? `<div class="pk-desc"><p class="pk-clamp" id="pkDesc">${esc(p.desc)}</p><button type="button" class="pk-more" aria-expanded="false" aria-controls="pkDesc" hidden>More</button></div>` : "")
      + whoHtml(p.who) + (p.role === "host" ? hostHtml(p) : replyHtml(p)) + actsHtml(p);
  }
  const skeleton = (title = "") => `<figure class="pk-cover pk-ghost"></figure><h2 class="pk-title" id="pkTitle">${esc(title || "Getting the details")}</h2><p class="pk-fact pk-ghostline"></p><p class="pk-fact pk-ghostline"></p>`;

  // ---- the sheet ----
  let el = null, body = null, cur = null, from = null, pushed = false, opts = {}, busy = false;
  function build() { if (el) return; el = document.createElement("div"); el.className = "pk-root"; el.hidden = true;
    el.innerHTML = `<div class="pk-scrim" data-pk-close></div><section class="pk" role="dialog" aria-modal="true" aria-labelledby="pkTitle"><div class="pk-grab" aria-hidden="true"><span></span></div><button type="button" class="pk-x" data-pk-close aria-label="Close">${I.x}</button><div class="pk-body"></div></section>`;
    document.body.appendChild(el); body = el.querySelector(".pk-body");
    el.addEventListener("click", onClick); swipe(el.querySelector(".pk")); }
  const focusables = () => [...el.querySelectorAll('.pk a[href], .pk button:not([disabled]):not([hidden]), .pk [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null || x === document.activeElement);
  function draw(p) { cur.p = p; body.innerHTML = html(p);
    const d = body.querySelector(".pk-clamp"), more = body.querySelector(".pk-more"); if (d && more) { requestAnimationFrame(() => { if (d.scrollHeight > d.clientHeight + 2) more.hidden = false; }); } }
  async function open(id, { title = "", trigger = null } = {}) { build(); const first = !cur; cur = { id, p: null }; from = trigger || document.activeElement;
    body.innerHTML = skeleton(title); el.hidden = false; document.documentElement.classList.add("pk-open");
    requestAnimationFrame(() => el.classList.add("is-on"));
    if (first && !pushed) { try { history.pushState({ ...(history.state || {}), plPeek: id }, ""); pushed = true; } catch {} }
    el.querySelector(".pk-x").focus({ preventScroll: true });
    const p = await load(id); if (!cur || cur.id !== id) return;
    if (!p) { body.innerHTML = `<h2 class="pk-title" id="pkTitle">${esc(title || "This event")}</h2><p class="pk-line">We couldn't load the details. The event page has everything.</p><div class="pk-acts"><a class="pk-btn pk-pri" href="${esc(trigger?.getAttribute("href") || "/plans")}">${I.open}Open event page</a></div>`; return; }
    draw(p); }
  function close({ fromPop = false } = {}) { if (!el || el.hidden) return; window.PLAddCal?.close?.();
    el.classList.remove("is-on"); document.documentElement.classList.remove("pk-open"); const was = cur; cur = null;
    setTimeout(() => { if (!cur) { el.hidden = true; body.innerHTML = ""; el.querySelector(".pk").style.transform = ""; } }, 220);
    if (pushed && !fromPop) { pushed = false; try { history.back(); } catch {} } else if (fromPop) pushed = false;
    // back to the row (drawn again after a change), or the first row when that one is gone (Can't go)
    const back = (was && document.querySelector(`[data-peek="${CSS.escape(was.id)}"]`)) || (from && document.body.contains(from) ? from : document.querySelector("main a[data-peek], main a"));
    back?.focus?.({ preventScroll: true }); }
  addEventListener("popstate", () => { if (cur) close({ fromPop: true }); });
  document.addEventListener("keydown", (e) => { if (!cur) return;
    if (document.querySelector(".plsh-bg")) return; // the share sheet is on top: its own keys
    if (e.key === "Escape") { if (document.querySelector(".ac-menu")) return; e.preventDefault(); close(); return; }
    if (e.key === "Tab") { const F = focusables(); if (!F.length) return; const a = F[0], z = F[F.length - 1], inside = el.querySelector(".pk").contains(document.activeElement);
      if (!inside) { e.preventDefault(); a.focus(); } else if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } } });
  // swipe down from the top of the sheet (or anywhere while it's scrolled to the top) to close
  function swipe(sh) { let y0 = null, dy = 0, t0 = 0;
    sh.addEventListener("touchstart", (e) => { if (matchMedia("(min-width:900px)").matches) return; const onGrab = e.target.closest(".pk-grab, .pk-cover"); if (!onGrab && sh.querySelector(".pk-body").scrollTop > 0) return; y0 = e.touches[0].clientY; dy = 0; t0 = Date.now(); sh.style.transition = "none"; }, { passive: true });
    sh.addEventListener("touchmove", (e) => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); if (dy > 0) sh.style.transform = `translateY(${dy}px)`; }, { passive: true });
    sh.addEventListener("touchend", () => { if (y0 == null) return; sh.style.transition = ""; const fast = dy > 40 && Date.now() - t0 < 250; y0 = null; if (dy > 110 || fast) close(); else sh.style.transform = ""; }); }

  // ---- what the buttons do ----
  function onClick(e) {
    if (e.target.closest("[data-pk-close]")) { e.preventDefault(); close(); return; }
    if (!cur?.p) return; const p = cur.p;
    const more = e.target.closest(".pk-more"); if (more) { const d = body.querySelector(".pk-clamp"), on = more.getAttribute("aria-expanded") !== "true"; d.classList.toggle("is-open", on); more.setAttribute("aria-expanded", String(on)); more.textContent = on ? "Less" : "More"; return; }
    const set = e.target.closest("[data-pk-set]"); if (set) { reply(set.dataset.pkSet, set); return; }
    const cal = e.target.closest("[data-pk-cal]"); if (cal) { window.PLAddCal?.open(cal, p); return; }
    if (e.target.closest("[data-pk-share]")) { share(p); return; }
    const inv = e.target.closest("[data-pk-invite]"); if (inv) { invite(p, inv); return; }
  }
  const script = (src) => new Promise((ok, no) => { if (document.querySelector(`script[src="${src}"]`)) return ok(); const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
  async function share(p) { try { if (!window.ShareKit) await script("/sharekit.js"); await window.ShareKit.open({ eventId: p.id, title: p.title }); } catch { note("The share sheet didn't open. Try the event page."); } }
  async function invite(p, btn) { const box = body.querySelector(".pk-note"); btn.disabled = true;
    try { if (!window.ShareKit) await script("/sharekit.js"); if (!window.PLComeWith) await script("/comewith.js"); } catch {}
    const P = proofOf(p.id), make = () => fetch(P ? "/api/public/come-with" : "/api/me/come-with", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(P ? { eventId: p.id, rid: P.rid, code: P.code } : { eventId: p.id }) });
    try { if (window.PLComeWith?.send) await window.PLComeWith.send(make, { title: p.title, box }); else await window.ShareKit.open({ kind: "guest", eventId: p.id, title: p.title }); } catch { note("That didn't work. Try the event page."); }
    btn.disabled = false; }
  const note = (t) => { const n = body.querySelector(".pk-note"); if (n) n.textContent = t; };
  const msg = (html, bad = false) => { const m = body.querySelector(".pk-reply .pk-msg"); if (m) { m.innerHTML = html; m.classList.toggle("is-bad", bad); } };
  const pressed = (v) => body.querySelectorAll(".pk-seg [data-pk-set]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.pkSet === v)));
  /** The button under a "finish on the event page" line says what you do there. */
  const finish = (x) => (x?.pay ? "Pay to hold your spot" : x?.ask ? "Ask to join" : "Finish on the event page");
  const DONE = { going: "Saved. You're in.", maybe: "Saved. You said maybe.", no: "Saved. Your host knows you can't make it.", waitlist: "The event is full, so you're on the waitlist.", requested: "Sent. The host lets each guest in." };
  /** Change the reply: the control moves at once, the server confirms, and it moves back if the server says no. */
  async function reply(want, btn) { const p = cur.p, R = p.reply; if (!R || busy) return; const was = R.state, id = p.id;
    const a = (R.answers || []).find((x) => x.value === want);
    if (a?.page || a?.error) { msg(`${esc(a.page || a.error)}${a.page ? ` <a class="pk-btn pk-inline" href="${esc(p.invite)}">${finish(a)}</a>` : ""}`, !!a.error); return; }
    if (want === was) { msg(STATE_LINE[want] || ""); return; }
    busy = true; pressed(want); el.querySelector(".pk").setAttribute("aria-busy", "true"); body.querySelectorAll("[data-pk-set]").forEach((b) => b.setAttribute("aria-disabled", "true")); btn.classList.add("is-saving");
    msg(btn.hasAttribute("data-pk-leave") ? "Taking you off" : "Saving");
    const P = proofOf(id); let r = null, j = null;
    try { r = await fetch(`/api/plans/peek/${encodeURIComponent(id)}/reply`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ response: want, tz, ...(P ? { rid: P.rid, code: P.code } : {}) }) }); j = await r.json().catch(() => ({})); } catch {}
    busy = false; if (!cur || cur.id !== id) return; el.querySelector(".pk").removeAttribute("aria-busy");
    if (!r || !r.ok) { pressed(was); body.querySelectorAll("[data-pk-set]").forEach((b) => b.removeAttribute("aria-disabled")); btn.classList.remove("is-saving");
      const m = j?.message || (r ? "That didn't save. Try again." : "That didn't save. Check your connection.");
      msg(`${esc(m)}${j?.code === "needs_page" ? ` <a class="pk-btn pk-inline" href="${esc(j.href || p.invite)}">${finish(j)}</a>` : ""}`, true); return; }
    // the browser's own copy of the reply follows, so the invite and the timeline agree
    if (P) { try { const v = JSON.parse(localStorage.getItem("encore-rsvp-" + id) || "null"); if (v) localStorage.setItem("encore-rsvp-" + id, JSON.stringify({ ...v, response: j.response || want })); } catch {} }
    const got = j.peek?.reply?.state || j.response || want;
    if (j.peek) { const st = body.scrollTop; prime(id, j.peek); draw(j.peek); body.scrollTop = st; (body.querySelector('.pk-seg [aria-pressed="true"]') || body.querySelector(".pk-seg button") || el.querySelector(".pk-x"))?.focus({ preventScroll: true }); }
    msg(was === "waitlist" && got === "no" ? "You left the waitlist." : was === "requested" && got === "no" ? "Your ask is taken back." : DONE[got] || "Saved.");
    try { opts.onChange?.(id, j.items || [], j.peek); } catch {} }

  // ---- the rows: a plain tap opens the sheet, everything else is a link ----
  function attach(root, o = {}) { if (!root || root.__pk) return; root.__pk = true; opts = o;
    root.addEventListener("click", (e) => { const a = e.target.closest("a[data-peek]"); if (!a || !root.contains(a)) return;
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault(); open(a.dataset.peek, { title: a.querySelector(".tl-title")?.textContent || "", trigger: a }); });
    const warm = (e) => { const a = e.target.closest?.("a[data-peek]"); if (a) load(a.dataset.peek); };
    root.addEventListener("touchstart", warm, { passive: true }); root.addEventListener("pointerover", (e) => { if (e.pointerType === "mouse") warm(e); });
    root.addEventListener("focusin", warm); }

  window.PLPeek = { attach, open, close, load, prime, html, isOpen: () => !!cur };
})();
