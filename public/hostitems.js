// The host page's offer, organised for a busy host (public/drop.js offer() hands its data here):
//   Coming up: the next 3 as cards, then a compact list of up to 8, then "See all N" (a month calendar and type filters).
//   A repeating event is one card: "Sunday run · every Sunday 8am · next Nov 29 · See dates".
//   Order ahead: drops, 3 and See all. Book me: experiences, 3 and See all.
// Each card has one action. Guests get the event's own (I'm in, Ask to join, Order, Request a date); the page's owner gets
// Manage, and the server says who that is (d.viewer.own, and e.you from server/pageitems.js hostRole for a co-host).
// On their own page the owner also gets, per card, More options: Pin to top (2 at most) and Hide from my page. Hidden
// items stay live by their link; they wait in "Hidden from your page (N)" (server/pageitems.js). Arrange's Hidden sheet
// opens the same list (PLHostItems.manager).
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const CARDS = 3, COMPACT = 8, SIDE = 3, MAX_PIN = 2;
  const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], MO = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const dt = (iso) => new Date(String(iso) + "T12:00:00");
  const dayTxt = (iso) => (iso ? dt(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "Date to come");
  const md = (iso) => (iso ? dt(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
  const clock = (t) => { if (!/^\d{1,2}:\d{2}$/.test(t || "")) return ""; const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""}${h < 12 ? "am" : "pm"}`; };
  const I = {
    more: '<svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="4.5" cy="10" r="1.7"/><circle cx="10" cy="10" r="1.7"/><circle cx="15.5" cy="10" r="1.7"/></svg>',
    x: '<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15"/></svg>',
    cal: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    pin: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3h6l-1 5 3 3H5l3-3zM10 11v6"/></svg>',
    left: '<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5"/></svg>',
    right: '<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 4.5 13 10l-5.5 5.5"/></svg>',
  };
  const CSS = `.hi-g{margin:0 0 28px}.hi-g>h2.sec{margin:0 0 12px}.hi-g:last-child{margin-bottom:8px}
.of-row{position:relative}.of-row.hi-pin{border-color:var(--pl-ink,#1B1D1C)}
.of-row .of-b>b,.hi-row b{overflow-wrap:anywhere}
.of-row .of-b p{margin:2px 0 0;font-size:15px;color:var(--soft,var(--pl-soft,#444845))}
.hi-flag{display:inline-flex;align-items:center;gap:4px;margin:0 0 2px;font:600 13px "IBM Plex Sans",system-ui,sans-serif;color:var(--pl-ink,#1B1D1C)}
.hi-acts{grid-column:1/-1;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.hi-acts .of-go{grid-column:auto;justify-self:auto}
@media (min-width:700px){.of-list>.of-row .hi-acts{grid-column:auto;justify-self:end;flex-wrap:nowrap}}
.hi-more{width:44px;height:44px;flex:none;display:inline-grid;place-items:center;border:1.5px solid #CFC8B9;border-radius:6px;background:#fff;color:#1B1D1C;cursor:pointer}
.hi-note{font-size:14px;color:var(--soft,var(--pl-soft,#444845))}
.hi-dates{grid-column:1/-1;margin:0;padding:0;list-style:none;display:grid;gap:6px}.hi-dates a{display:flex;align-items:center;min-height:44px;padding:0 12px;border:1px solid var(--line,var(--pl-line,#CFC8B9));border-radius:6px;color:inherit;text-decoration:none;font-size:15px}
.hi-list{display:grid;margin:12px 0 0;border-top:1px solid var(--line,var(--pl-line,#CFC8B9))}
.hi-row{display:grid;grid-template-columns:52px minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line,var(--pl-line,#CFC8B9))}
.hi-d{display:grid;justify-items:center;line-height:1.1;font:600 13px "IBM Plex Sans",system-ui,sans-serif;color:var(--soft,var(--pl-soft,#444845));text-transform:uppercase}.hi-d b{font-size:20px;color:var(--pl-ink,#1B1D1C)}
.hi-row small{display:block;font-size:14px;color:var(--soft,var(--pl-soft,#444845))}.hi-row>span:nth-child(2){min-width:0}
.hi-row .hi-acts{grid-column:auto;flex-wrap:nowrap}
.hi-ln{min-height:44px;display:inline-flex;align-items:center;padding:0 14px;border:1.5px solid var(--accent,var(--pl-accent,#29489A));border-radius:6px;background:#fff;color:var(--accent,var(--pl-accent,#29489A));font:600 15px "IBM Plex Sans",system-ui,sans-serif;text-decoration:none;cursor:pointer;white-space:nowrap}
.hi-all{margin:12px 0 0;min-height:44px;padding:0 16px;border:1.5px solid var(--pl-ink,#1B1D1C);border-radius:6px;background:#fff;color:var(--pl-ink,#1B1D1C);font:600 15px "IBM Plex Sans",system-ui,sans-serif;cursor:pointer}
.hi-bg{position:fixed;inset:0;z-index:9300;background:rgba(27,29,28,.42);display:flex;align-items:flex-end;justify-content:center}
.hi-sh{width:min(560px,100%);max-height:88dvh;display:flex;flex-direction:column;background:#FAF8F3;color:#1B1D1C;border:1.5px solid #1B1D1C;border-bottom:0;border-radius:6px 6px 0 0;font:16px/1.45 "IBM Plex Sans",system-ui,sans-serif}
@media (min-width:700px){.hi-bg{align-items:center}.hi-sh{border-bottom:1.5px solid #1B1D1C;border-radius:6px}}
.hi-sh header{display:grid;grid-template-columns:minmax(0,1fr) 44px;gap:8px;align-items:start;padding:16px 16px 10px;border-bottom:1px solid #E2DCD1}
.hi-sh h2{margin:0;font:600 20px/1.25 "IBM Plex Sans",system-ui,sans-serif;overflow-wrap:anywhere}.hi-sh header p{margin:4px 0 0;color:#444845;font-size:15px}
.hi-x{width:44px;height:44px;display:grid;place-items:center;border:1.5px solid #CFC8B9;border-radius:6px;background:none;color:inherit;cursor:pointer}
.hi-bd{overflow:auto;padding:12px 16px calc(16px + env(safe-area-inset-bottom));min-height:0}
.hi-bd .hi-row{grid-template-columns:52px minmax(0,1fr) auto}
.hi-opt{display:grid;gap:8px}.hi-opt button,.hi-opt a{min-height:48px;display:flex;align-items:center;justify-content:center;padding:0 16px;border:1.5px solid #1B1D1C;border-radius:6px;background:#fff;color:#1B1D1C;font:600 16px "IBM Plex Sans",system-ui,sans-serif;text-decoration:none;cursor:pointer}
.hi-opt .pri{background:#29489A;border-color:#29489A;color:#fff}.hi-opt button:disabled{opacity:.55;cursor:default}
.hi-msg{margin:10px 0 0;font-size:14px;color:#444845}.hi-err{color:#A2361A;font-weight:600}
.hi-tray{display:grid;gap:8px}.hi-tr{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 12px;border:1px solid #CFC8B9;border-radius:6px;background:#fff}.hi-tr small{display:block;color:#444845;font-size:14px}
.hi-tr button{min-height:44px;padding:0 14px;border:1.5px solid #1B1D1C;border-radius:6px;background:#fff;color:#1B1D1C;font:600 15px "IBM Plex Sans",system-ui,sans-serif;cursor:pointer}
.hi-tr .hi-two{display:flex;gap:6px}
.hi-cap{margin:16px 0 6px;font:600 13px "IBM Plex Sans",system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#444845}
.hi-cal{margin:0 0 12px}.hi-mh{display:grid;grid-template-columns:44px minmax(0,1fr) 44px;align-items:center;gap:8px;margin:0 0 6px}.hi-mh b{text-align:center;font-size:16px}
.hi-mh button{width:44px;height:44px;display:grid;place-items:center;border:1.5px solid #CFC8B9;border-radius:6px;background:#fff;color:#1B1D1C;cursor:pointer}.hi-mh button:disabled{opacity:.4;cursor:default}
.hi-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:2px;text-align:center}.hi-grid i{font:600 12px "IBM Plex Sans",system-ui,sans-serif;font-style:normal;color:#444845;padding:4px 0}
.hi-grid span,.hi-grid button{height:44px;display:grid;place-items:center;font-size:15px;border-radius:6px}
.hi-grid button{border:1.5px solid #29489A;background:#fff;color:#29489A;font:600 15px "IBM Plex Sans",system-ui,sans-serif;cursor:pointer}.hi-grid button[aria-pressed=true]{background:#29489A;color:#fff}
.hi-grid span{color:#8A8F8B}
.hi-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px}.hi-chips button{min-height:44px}
.hi-chip{padding:0 14px;border:1.5px solid #CFC8B9;border-radius:6px;background:#fff;color:#1B1D1C;font:600 15px "IBM Plex Sans",system-ui,sans-serif;cursor:pointer}.hi-chip[aria-pressed=true]{border-color:#1B1D1C;background:#1B1D1C;color:#fff}
.hi-empty{color:#444845;margin:8px 0}
:is(.hi-more,.hi-ln,.hi-all,.hi-x,.hi-opt button,.hi-opt a,.hi-tr button,.hi-mh button,.hi-grid button,.hi-chip,.hi-dates a):focus-visible{outline:3px solid rgba(41,72,154,.35);outline-offset:2px}
@media (hover:hover){.hi-more:hover,.hi-tr button:hover,.hi-opt button:hover{border-color:#1B1D1C;background:#F2EEE5}}`;
  const css = () => { if ($("#hiCss")) return; const s = document.createElement("style"); s.id = "hiCss"; s.textContent = CSS; document.head.appendChild(s); };

  // ---- a small sheet (Field Notes chrome whatever the host's brand kit is) ----
  function sheet(title, sub, body, { onClose } = {}) { css(); $(".hi-bg")?.__close?.(); const bg = document.createElement("div"); bg.className = "hi-bg";
    bg.innerHTML = `<div class="hi-sh" role="dialog" aria-modal="true" aria-labelledby="hiShH"><header><div><h2 id="hiShH">${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}</div><button type="button" class="hi-x" aria-label="Close">${I.x}</button></header><div class="hi-bd">${body}</div></div>`;
    const back = document.activeElement; document.body.appendChild(bg); document.documentElement.style.overflow = "hidden";
    const close = () => { if (!bg.isConnected) return; bg.remove(); document.documentElement.style.overflow = ""; try { back?.focus?.({ preventScroll: true }); } catch {} onClose?.(); };
    bg.__close = close; bg.addEventListener("click", (e) => { if (e.target === bg || e.target.closest(".hi-x")) close(); });
    bg.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    setTimeout(() => $(".hi-x", bg)?.focus({ preventScroll: true }), 30); return { bg, body: $(".hi-bd", bg), close }; }

  // ---- the items ----
  const keyOf = (it) => (it.kind === "experience" ? "x:" : it.kind === "scrap" ? "s:" : "e:") + it.id;
  /** The one action on an item: for its owner Manage, for a guest the item's own. { label, href } or { label, act } or { note } */
  function actionOf(it, R) { const e = it.raw;
    if (it.kind === "event") { if (R.owner || e.you === "host") return { label: "Manage", href: `/?app=1&open=${encodeURIComponent(e.id)}#studio` };
      if (e.you === "cohost") return { label: "View", href: `/e/${encodeURIComponent(e.id)}`, note: "You're co-hosting" };
      if (e.private) return { note: "Link only" }; if (e.cancelled) return { note: "Cancelled" };
      return { label: e.preorder ? "Order" : e.approvalRequired ? "Ask to join" : e.stage === "interest" ? "I'd go" : "I'm in", href: `/e/${encodeURIComponent(e.id)}` }; }
    if (it.kind === "drop") { if (R.owner) return { label: "Manage", act: "drop" }; const out = (e.items || []).every((i) => i.left === 0);
      return e.paused ? { note: "Orders are paused. Follow to hear when they open." } : out ? { note: "Sold out this batch." } : { label: "Order", href: e.url }; }
    return R.owner ? { label: "Manage", act: "exp" } : { label: "Request a date", act: "req" }; }
  const actHtml = (it, R, cls = "of-go") => { const a = actionOf(it, R), k = esc(keyOf(it));
    const btn = a.href ? `<a class="${cls}" href="${esc(a.href)}">${esc(a.label)}</a>` : a.act ? `<button type="button" class="${cls}" data-hi-act="${a.act}" data-k="${k}">${esc(a.label)}</button>` : "";
    return `${a.note ? `<span class="hi-note">${esc(a.note)}</span>` : ""}${btn}${R.owner ? `<button type="button" class="hi-more" data-hi-more="${k}" aria-label="More options for ${esc(it.title)}">${I.more}</button>` : ""}`; };
  const flag = (it) => (it.pinned ? `<span class="hi-flag">${I.pin}Pinned</span>` : "");
  const typeTag = (e) => { const T = window.EventTypes; if (!T) return ""; const k = T.typeOf(e); return k && k !== "event" ? T.tag(e, { cls: "pl-type--b" }) : ""; };

  /** Events as cards: a repeating one (weekly, or the same title on more than one date) folds into one. */
  function seriesOf(list) { const out = [], by = new Map();
    for (const it of list) { const k = it.title.trim().toLowerCase(); const s = k && by.get(k); if (s) { s.dates.push(it); continue; } const n = { ...it, dates: [it] }; if (k) by.set(k, n); out.push(n); }
    for (const s of out) { if (s.dates.length < 2 && !/weekly|biweekly/.test(s.raw.repeat || "")) continue; s.series = true; const f = s.dates[0].raw;
      const gaps = s.dates.slice(1).map((x, i) => Math.round((dt(x.raw.date) - dt(s.dates[i].raw.date)) / 864e5)), wd = f.date ? WD[dt(f.date).getDay()] : "";
      const every = s.raw.repeat === "biweekly" || (gaps.length && gaps.every((g) => g === 14)) ? `every other ${wd}` : s.raw.repeat === "weekly" || (gaps.length && gaps.every((g) => g === 7)) ? `every ${wd}` : `${s.dates.length} dates`;
      s.line = [`${every}${f.startTime ? " " + clock(f.startTime) : ""}`, f.date ? `next ${md(f.date)}` : "", f.hood || f.city].filter(Boolean).join(" · "); }
    return out; }
  const evLine = (e) => [dayTxt(e.date) + (e.startTime ? " · " + clock(e.startTime) : ""), e.hood || e.city, e.priceLine].filter(Boolean).join(" · ");
  const art = (it) => it.art || I.cal;
  function card(it, R) { const k = esc(keyOf(it)), e = it.raw;
    return `<div class="of-row${it.pinned ? " hi-pin" : ""}" data-k="${k}"${it.kind === "event" ? ` data-ev="${esc(e.id)}"` : ""}><span class="of-art" aria-hidden="true">${art(it)}</span><div class="of-b">${flag(it)}${it.kind === "event" ? typeTag(e) : ""}<b>${esc(it.title)}</b>${it.line ? `<p>${esc(it.line)}</p>` : ""}</div><div class="hi-acts">${actHtml(it, R)}${it.series ? `<button type="button" class="hi-ln" data-hi-dates aria-expanded="false">See dates</button>` : ""}</div>${it.series ? `<ul class="hi-dates" hidden>${it.dates.map((x) => `<li><a href="${esc(R.owner ? `/?app=1&open=${encodeURIComponent(x.raw.id)}#studio` : `/e/${encodeURIComponent(x.raw.id)}`)}">${esc(dayTxt(x.raw.date) + (x.raw.startTime ? " · " + clock(x.raw.startTime) : ""))}</a></li>`).join("")}</ul>` : ""}</div>`; }
  function row(it, R) { const e = it.raw, d = e.date ? dt(e.date) : null;
    return `<div class="hi-row" data-k="${esc(keyOf(it))}"><span class="hi-d" aria-hidden="true">${d ? `${d.toLocaleDateString("en-US", { month: "short" })}<b>${d.getDate()}</b>` : ""}</span><span>${flag(it)}<b>${esc(it.title)}</b><small>${esc(it.series ? it.line : [d ? WD[d.getDay()].slice(0, 3) : "", e.startTime ? clock(e.startTime) : "", e.hood || e.city].filter(Boolean).join(" · "))}</small></span><span class="hi-acts">${actHtml(it, R, "hi-ln")}</span></div>`; }

  // ---- the page's state (one per page) ----
  const R = { owner: false, h: null, d: null, items: [], cb: {}, sec: null, pins: [] };
  const sortPinned = (L) => L.slice().sort((a, b) => (a.pinned || 99) - (b.pinned || 99) || String(a.raw.date || "9").localeCompare(String(b.raw.date || "9")));
  /** Draw the offer into sec. o: { h, d, owner, events, drops, exps, art: { drop(x), exp(x) }, onReq(id), onDrop(id), onExp(id), ownBar } */
  function render(sec, o) { css(); Object.assign(R, { owner: !!o.owner, h: o.h, d: o.d, cb: o, sec });
    const evs = (o.events || []).map((e) => ({ kind: "event", id: e.id, title: e.title || e.name || "Untitled", raw: e, pinned: e.pinned || 0, hidden: !!e.pageHidden, art: e.coverPhoto ? `<img src="${esc(e.coverPhoto)}" alt="" loading="lazy">` : "", line: evLine(e) }));
    const drops = (o.drops || []).map((x) => ({ kind: "drop", id: x.id, title: x.title, raw: x, pinned: x.pinned || 0, hidden: !!x.pageHidden, art: o.art?.drop?.(x) || "", line: o.line?.drop?.(x) || "" }));
    const exps = (o.exps || []).map((x) => ({ kind: "experience", id: x.id, title: x.name, raw: x, pinned: x.pinned || 0, hidden: !!x.pageHidden, art: o.art?.exp?.(x) || "", line: o.line?.exp?.(x) || "" }));
    R.items = [...evs, ...drops, ...exps]; draw(); }
  function draw() { const sec = R.sec; if (!sec) return; const vis = (L) => sortPinned(L.filter((x) => !x.hidden));
    const evs = seriesOf(vis(R.items.filter((x) => x.kind === "event"))), drops = vis(R.items.filter((x) => x.kind === "drop")), exps = vis(R.items.filter((x) => x.kind === "experience"));
    const nEv = R.items.filter((x) => x.kind === "event" && !x.hidden).length, nHid = R.items.filter((x) => x.hidden).length + (R.hiddenElse || 0);
    const grp = (g, h, body) => `<div class="hi-g" data-g="${g}"><h2 class="sec" id="hiH-${g}">${h}</h2>${body}</div>`;
    const side = (g, h, L) => (L.length ? grp(g, h, `<div class="of-list">${L.slice(0, SIDE).map((x) => card(x, R)).join("")}</div>${L.length > SIDE ? `<button type="button" class="hi-all" data-hi-all="${g}">See all ${L.length}</button>` : ""}`) : "");
    const evBody = evs.length ? `<div class="of-list">${evs.slice(0, CARDS).map((x) => card(x, R)).join("")}</div>${evs.length > CARDS ? `<div class="hi-list">${evs.slice(CARDS, CARDS + COMPACT).map((x) => row(x, R)).join("")}</div>` : ""}${evs.length > CARDS + COMPACT || nEv > evs.length ? `<button type="button" class="hi-all" data-hi-all="events">See all ${nEv}</button>` : ""}`
      : `<div class="of-empty">${R.owner ? "Nothing coming up on your page. Add an event and it shows here." : "Nothing coming up yet. Follow to hear about the next one."}</div>`;
    const tray = R.owner && nHid ? `<button type="button" data-hi-tray>Hidden from your page (${nHid})</button>` : "";
    sec.querySelectorAll(".hi-g").forEach((x) => x.remove()); $("#plDrops .hi-g")?.remove(); $("#plBook .hi-g")?.remove();
    const own = $(".of-own", sec); if (own) { $("[data-hi-tray]", own)?.remove(); if (tray) own.insertAdjacentHTML("beforeend", tray); }
    sec.insertAdjacentHTML("beforeend", grp("events", "Coming up", evBody) + side("drops", "Order ahead", drops) + side("book", "Book me", exps));
    sec.setAttribute("aria-labelledby", "hiH-events"); window.PLArrange?.sync?.(); }
  // one listener for the page and the sheets: Order ahead and Book me may sit in their own sections (public/arrange.js)
  document.addEventListener("click", (ev) => { const b = ev.target.closest?.("[data-hi-more],[data-hi-act],[data-hi-dates],[data-hi-all],[data-hi-tray]"); if (!b || !R.sec || ev.target.closest(".pla-chrome")) return; const it = R.items.find((x) => keyOf(x) === (b.dataset.k || b.dataset.hiMore));
      if (b.hasAttribute("data-hi-more")) return menu(it, b);
      if (b.dataset.hiAct === "drop") return R.cb.onDrop?.(it.id); if (b.dataset.hiAct === "exp") return R.cb.onExp?.(it.id); if (b.dataset.hiAct === "req") return R.cb.onReq?.(it.id);
      if (b.hasAttribute("data-hi-dates")) { const ul = b.closest(".of-row")?.querySelector(".hi-dates"); if (ul) { ul.hidden = !ul.hidden; b.setAttribute("aria-expanded", String(!ul.hidden)); b.textContent = ul.hidden ? "See dates" : "Fewer dates"; } return; }
      if (b.dataset.hiAll) return all(b.dataset.hiAll); if (b.hasAttribute("data-hi-tray")) return manager({ hiddenOnly: true }); });

  // ---- See all: every date, a month calendar and type filters (events); the whole list (drops, experiences) ----
  function all(g) { const R2 = R, L = sortPinned(R.items.filter((x) => !x.hidden && x.kind === (g === "events" ? "event" : g === "drops" ? "drop" : "experience")));
    if (g !== "events") { const S = sheet(g === "drops" ? "Order ahead" : "Book me", `${L.length} on ${R.owner ? "your" : "this"} page`, `<div class="of-list">${L.map((x) => card(x, R2)).join("")}</div>`); return S; }
    const T = window.EventTypes, types = T ? T.present(L.map((x) => x.raw)) : [], months = [...new Set(L.map((x) => (x.raw.date || "").slice(0, 7)).filter(Boolean))].sort();
    const st = { m: months[0] || new Date().toISOString().slice(0, 7), day: "", type: "" };
    const S = sheet("Coming up", `${L.length} ${L.length === 1 ? "date" : "dates"}. Pick a day or a kind.`, `<div class="hi-cal"></div>${types.length > 1 ? `<div class="hi-chips" role="group" aria-label="Kinds"><button type="button" class="hi-chip" data-ty="" aria-pressed="true">All</button>${types.map((k) => `<button type="button" class="hi-chip" data-ty="${esc(k)}" aria-pressed="false">${esc(T.PLURAL?.[k] || T.labelOf(k))}</button>`).join("")}</div>` : ""}<div class="hi-res" aria-live="polite"></div>`);
    const show = () => { const pool = L.filter((x) => !st.type || T?.typeOf(x.raw) === st.type), have = new Set(pool.map((x) => x.raw.date)), [y, mo] = st.m.split("-").map(Number), first = new Date(y, mo - 1, 1), n = new Date(y, mo, 0).getDate();
      const cells = []; for (let i = 0; i < first.getDay(); i++) cells.push("<span></span>");
      for (let dd = 1; dd <= n; dd++) { const iso = `${st.m}-${String(dd).padStart(2, "0")}`; cells.push(have.has(iso) ? `<button type="button" data-day="${iso}" aria-pressed="${st.day === iso}" aria-label="${esc(dayTxt(iso))}, ${pool.filter((x) => x.raw.date === iso).length} on">${dd}</button>` : `<span aria-hidden="true">${dd}</span>`); }
      const i = months.indexOf(st.m);
      $(".hi-cal", S.body).innerHTML = `<div class="hi-mh"><button type="button" data-mv="-1" aria-label="Earlier month"${i <= 0 ? " disabled" : ""}>${I.left}</button><b>${MO[mo - 1]} ${y}</b><button type="button" data-mv="1" aria-label="Later month"${i < 0 || i >= months.length - 1 ? " disabled" : ""}>${I.right}</button></div><div class="hi-grid">${["S", "M", "T", "W", "T", "F", "S"].map((x) => `<i aria-hidden="true">${x}</i>`).join("")}${cells.join("")}</div>`;
      const res = pool.filter((x) => (st.day ? x.raw.date === st.day : true));
      $(".hi-res", S.body).innerHTML = res.length ? `<p class="hi-cap">${st.day ? esc(dayTxt(st.day)) : "Every date"}</p><div class="hi-list">${res.map((x) => row(x, R2)).join("")}</div>` : `<p class="hi-empty">Nothing on that day.</p>`; };
    S.body.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.mv) { const i = months.indexOf(st.m) + +b.dataset.mv; if (months[i]) { st.m = months[i]; st.day = ""; show(); } return; }
      if (b.dataset.day) { st.day = st.day === b.dataset.day ? "" : b.dataset.day; show(); $(`[data-day="${b.dataset.day}"]`, S.body)?.focus(); return; }
      if (b.dataset.ty != null) { st.type = b.dataset.ty; st.day = ""; $$("[data-ty]", S.body).forEach((c) => c.setAttribute("aria-pressed", String(c === b))); show(); } });
    show(); return S; }

  // ---- the owner's per-item menu and the server call ----
  async function setItem(key, patch) { const r = await fetch("/api/host/page-items", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, ...patch }) }), j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || "That didn't save. Try again."); applyState(j); return j; }
  function applyState(j) { const hid = new Set((j.hidden || []).map((x) => x.key)), pins = j.pinned || []; R.pins = pins;
    for (const it of R.items) { const k = keyOf(it); it.hidden = hid.has(k); it.pinned = pins.indexOf(k) + 1; }
    R.hiddenElse = (j.hidden || []).filter((x) => !R.items.some((it) => keyOf(it) === x.key)).length; }
  function menu(it, from) { if (!it) return; const pinned = !!it.pinned, full = R.items.filter((x) => x.pinned).length >= MAX_PIN, a = actionOf(it, R);
    const S = sheet(it.title, "Only you see these options.", `<div class="hi-opt">${a.href ? `<a class="pri" href="${esc(a.href)}">${esc(a.label)}</a>` : a.act ? `<button type="button" class="pri" data-o="act">${esc(a.label)}</button>` : ""}
      <button type="button" data-o="pin"${!pinned && full ? " disabled" : ""}>${pinned ? "Unpin" : "Pin to top"}</button><button type="button" data-o="hide">Hide from my page</button></div>
      <p class="hi-msg">${!pinned && full ? `You've pinned ${MAX_PIN}. Unpin one to pin this.` : "Hidden things stay live. Anyone with the link, and guests you invited, can still open it."}</p><p class="hi-msg hi-err" role="alert"></p>`);
    S.body.addEventListener("click", async (e) => { const b = e.target.closest("[data-o]"); if (!b) return; if (b.dataset.o === "act") { S.close(); return from?.closest(".hi-acts")?.querySelector("[data-hi-act]")?.click(); }
      b.disabled = true; try { await setItem(keyOf(it), b.dataset.o === "pin" ? { pinned: !pinned } : { hidden: true }); S.close(); draw(); say(b.dataset.o === "pin" ? (pinned ? "Unpinned." : "Pinned to the top.") : `Hidden from your page. It's in Hidden from your page.`); }
      catch (er) { b.disabled = false; $(".hi-err", S.body).textContent = er.message; } }); }
  const say = (t) => { let n = $("#hiSay"); if (!n) { n = document.createElement("div"); n.id = "hiSay"; n.setAttribute("role", "status"); n.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)"; document.body.appendChild(n); } n.textContent = ""; setTimeout(() => (n.textContent = t), 30); };

  /** Every item on the page with Pin and Hide (Arrange's list), or only the hidden ones (the tray). */
  async function manager({ hiddenOnly = false } = {}) { let j = { hidden: [], pinned: [] }, sb = [];
    try { j = await (await fetch("/api/host/page-items", { credentials: "same-origin" })).json(); applyState(j); } catch {}
    if (!hiddenOnly && R.h?.handle) try { sb = ((await (await fetch("/api/public/host/" + encodeURIComponent(R.h.handle) + "/scrapbook", { credentials: "same-origin" })).json()).items || []); } catch {}
    const past = [...(R.d?.past || []).filter((e) => !String(e.id).startsWith("p-")).map((e) => ({ kind: "past", key: "e:" + e.id, title: e.title || "A past event", date: e.date })), ...sb.map((x) => ({ kind: "past", key: "s:" + x.id, title: x.title, date: x.date }))];
    const hid = new Set((j.hidden || []).map((x) => x.key)); let reload = false;
    const groups = [["Coming up", R.items.filter((x) => x.kind === "event")], ["Order ahead", R.items.filter((x) => x.kind === "drop")], ["Book me", R.items.filter((x) => x.kind === "experience")]]
      .map(([t, L]) => [t, L.map((x) => ({ key: keyOf(x), title: x.title, date: x.raw.date || "", kind: x.kind }))]);
    groups.push(["Past", past]);
    const tr = (x) => { const h = hid.has(x.key), p = (j.pinned || []).includes(x.key); return `<div class="hi-tr" data-key="${esc(x.key)}"><span><b>${esc(x.title)}</b><small>${esc([x.date ? dayTxt(x.date) : "", h ? "Hidden" : p ? "Pinned" : ""].filter(Boolean).join(" · ") || " ")}</small></span><span class="hi-two">${h ? `<button type="button" data-o="show">Show on my page</button>` : `${x.kind !== "past" ? `<button type="button" data-o="${p ? "unpin" : "pin"}">${p ? "Unpin" : "Pin"}</button>` : ""}<button type="button" data-o="hide">Hide</button>`}</span></div>`; };
    const body = () => { const H = (j.hidden || []); if (hiddenOnly) return H.length ? `<div class="hi-tray">${H.map((x) => tr({ ...x, kind: x.kind === "past" ? "past" : x.kind })).join("")}</div>` : `<p class="hi-empty">Nothing hidden. Hide something from its More options and it waits here.</p>`;
      return groups.filter(([, L]) => L.length).map(([t, L]) => `<p class="hi-cap">${t}</p><div class="hi-tray">${L.map(tr).join("")}</div>`).join("") + `<p class="hi-msg">Pin up to ${MAX_PIN} to the top. Hidden things stay live by their link.</p><p class="hi-msg hi-err" role="alert"></p>`; };
    const S = sheet(hiddenOnly ? `Hidden from your page (${(j.hidden || []).length})` : "What's on your page", hiddenOnly ? "Still live by their link. Bring any back." : "Pin, hide or bring back one thing at a time.", body(), { onClose: () => { if (reload) location.reload(); } });
    S.body.addEventListener("click", async (e) => { const b = e.target.closest("[data-o]"); if (!b) return; const key = b.closest("[data-key]").dataset.key, o = b.dataset.o; b.disabled = true;
      try { j = await setItem(key, o === "show" ? { hidden: false } : o === "hide" ? { hidden: true } : { pinned: o === "pin" }); hid.clear(); (j.hidden || []).forEach((x) => hid.add(x.key));
        if (!R.items.some((it) => keyOf(it) === key)) reload = true; S.body.innerHTML = body(); draw(); $("h2", S.bg).textContent = hiddenOnly ? `Hidden from your page (${(j.hidden || []).length})` : "What's on your page";
        say(o === "show" ? "Back on your page." : o === "hide" ? "Hidden from your page." : o === "pin" ? "Pinned to the top." : "Unpinned."); }
      catch (er) { b.disabled = false; const m = $(".hi-err", S.body); if (m) m.textContent = er.message; else alert(er.message); } }); }

  window.PLHostItems = { render, manager, actionOf, state: R, keyOf, seriesOf };
})();
