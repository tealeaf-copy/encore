// A drop's order page: what every guest gets from any link to a drop (/e/<id>, /i/<id>, /g#rsvp-<id>, a feed or
// Discover card, the host page's offers), signed in or out, the host included. A drop is ordered, never joined, so this
// page never uses the event reply form (no yes or no answer, guest list, bring list or the event's questions).
//
// Photo first: the cover across the top, then each item as a big photo card (tap to see its photos full screen and
// swipe through), what's left of the batch, a quantity stepper. Then the pickup window (radio cards with the day, the
// date and the time; a full window can't be picked), a name and one way to reach you (filled in from your account or
// this phone), an optional note to the maker, the total and one button: Place order. After ordering: "Order placed.
// Pick up Sun, Dec 6, 9 to 10am in Greenpoint. We'll send the exact spot the day before." with Add to calendar
// (public/addcal.js) and the maker's pay link when they use one. Wide screens: photos on the left, the order on the right.
//
// The words for pickup come from public/pickup.js, the same reader the server, the feed and the emails use. The page
// reads GET /api/public/drop/:id (never the exact address) and orders through the same reply write as before
// (POST /api/db/collection?path=rsvps with orderQty; the server prices the order from the drop itself).
// Loaded by public/invite.html for any event with drop: true. window.DropPage(o).
(function () {
  if (window.DropPage) return;
  const ICON = (d, s = 20) => `<svg viewBox="0 0 20 20" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I = { cal: ICON('<rect x="3" y="4.5" width="14" height="12" rx="1.5"/><path d="M3 8.5h14M7 2.8v3.4M13 2.8v3.4"/>'), pin: ICON('<path d="M10 17.5s5.5-5.2 5.5-9.3a5.5 5.5 0 0 0-11 0c0 4.1 5.5 9.3 5.5 9.3zM10 10.2a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/>'),
    tag: ICON('<path d="M3.2 10.4V3.6a.6.6 0 0 1 .6-.6h6.8l6.2 6.2a1 1 0 0 1 0 1.4l-5.8 5.8a1 1 0 0 1-1.4 0zM7 7.4h.01"/>'), clock: ICON('<circle cx="10" cy="10" r="7"/><path d="M10 6v4l2.5 2"/>'),
    info: ICON('<circle cx="10" cy="10" r="7"/><path d="M10 9v4.5M10 6.5h.01"/>'), x: ICON('<path d="M5 5l10 10M15 5 5 15"/>'), l: ICON('<path d="M12.5 4.5 7 10l5.5 5.5"/>'), r: ICON('<path d="m7.5 4.5 5.5 5.5-5.5 5.5"/>'),
    bag: ICON('<path d="M4.5 7h11l-1 9.5h-9zM7.5 7V5.5a2.5 2.5 0 0 1 5 0V7"/>', 28) };
  const CSS = `
.dpg{display:block}.dpg *{box-sizing:border-box}
.dpg .dg-cov{position:relative;aspect-ratio:16/10;border-radius:var(--pl-r-md,6px);overflow:hidden;border:1.5px solid var(--pl-ink);background:var(--pl-sand,#F3ECE2);margin:0 0 14px}
.dpg .dg-cov img{width:100%;height:100%;object-fit:cover;display:block}.dpg .dg-cov .ea-cover{position:absolute!important;inset:0!important;width:100%!important;height:100%!important}
.dg-tags{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px}.dg-tag{display:inline-flex;align-items:center;min-height:26px;padding:2px 10px;border-radius:999px;border:1.5px solid var(--pl-ink);font:600 12px/1.2 var(--pl-font-mono,monospace);text-transform:uppercase;letter-spacing:.05em;background:var(--pl-surface)}
.dg-tag.open{background:var(--pl-success-soft,#E3EFE6);border-color:var(--pl-success,#2F6B45);color:var(--pl-success,#2F6B45)}.dg-tag.off{background:var(--pl-warning-soft,#F6EBD6);border-color:var(--pl-warning,#8A5A12);color:var(--pl-warning,#8A5A12)}
.dpg h1{margin:0 0 6px}.dg-by{display:flex;align-items:center;gap:8px;margin:0 0 12px;color:var(--pl-soft)}.dg-by a{color:inherit;font-weight:600}.dg-by .av{width:28px;height:28px;border-radius:50%;background:var(--pl-sand);display:grid;place-items:center;font-weight:600;overflow:hidden;flex:none}.dg-by .av img{width:100%;height:100%;object-fit:cover}
.dg-facts{display:grid;gap:6px;margin:0 0 12px}.dg-facts div{display:flex;gap:8px;align-items:flex-start}.dg-facts svg{flex:none;margin-top:2px;color:var(--pl-accent-text,var(--pl-accent))}.dg-facts b{font-weight:600}
.dg-note{margin:0 0 12px;padding:10px 12px;border-left:3px solid var(--pl-line-strong);background:var(--pl-surface)}.dg-note small{display:block;color:var(--pl-soft);margin-top:4px}
.dg-alg{display:flex;gap:8px;margin:0 0 14px;padding:10px 12px;border:1.5px solid var(--pl-line-strong);border-radius:var(--pl-r-md,6px);background:var(--pl-sand-soft,#FBF6EE);font-size:15px}.dg-alg svg{flex:none;margin-top:2px}
.dg-own{display:grid;gap:8px;margin:0 0 14px;padding:12px;border:1.5px dashed var(--pl-ink);border-radius:var(--pl-r-md,6px);background:var(--pl-surface)}.dg-own p{margin:0}.dg-own .row{display:flex;flex-wrap:wrap;gap:8px}
.dg-h{font:600 20px/1.25 var(--pl-font-text);margin:22px 0 10px}
.dg-items{display:grid;gap:14px;grid-template-columns:1fr}@media (min-width:560px) and (max-width:899px){.dg-items{grid-template-columns:1fr 1fr}}
.dg-it{border:1.5px solid var(--pl-line-strong);border-radius:var(--pl-r-md,6px);background:var(--pl-surface);overflow:hidden;display:flex;flex-direction:column}
.dg-it .ph{position:relative;display:block;width:100%;aspect-ratio:4/3;border:0;padding:0;margin:0;background:var(--pl-sand);cursor:zoom-in;overflow:hidden}.dg-it .ph img{width:100%;height:100%;object-fit:cover;display:block}
.dg-it .ph .n{position:absolute;right:8px;bottom:8px;background:rgba(27,29,28,.72);color:#fff;border-radius:999px;padding:2px 9px;font:500 12px var(--pl-font-text)}.dg-it .ph.none{cursor:default;display:grid;place-items:center;color:var(--pl-soft)}
.dg-it .bd{padding:12px;display:grid;gap:4px;flex:1}.dg-it .top{display:flex;justify-content:space-between;gap:10px;align-items:baseline}.dg-it .top b{font-size:17px}.dg-it .pr{font-weight:600;white-space:nowrap}
.dg-it .d{margin:0;color:var(--pl-soft);font-size:15px}.dg-it .lf{font-size:14px;color:var(--pl-soft)}.dg-it .lf.low{color:var(--pl-tomato,#B5462B);font-weight:600}
.dg-it.out .ph img{filter:grayscale(.8);opacity:.6}.dg-it .so{position:absolute;left:8px;top:8px;background:var(--pl-ink);color:var(--pl-page);border-radius:4px;padding:3px 8px;font:600 12px var(--pl-font-mono);text-transform:uppercase}
.dg-st{display:flex;align-items:center;gap:8px;margin-top:8px}.dg-st button{width:44px;height:44px;border-radius:var(--pl-r-btn,6px);border:1.5px solid var(--pl-ink);background:var(--pl-page);font:600 22px/1 var(--pl-font-text);color:var(--pl-ink);cursor:pointer}.dg-st button:disabled{opacity:.35;cursor:not-allowed}.dg-st output{min-width:28px;text-align:center;font-weight:600;font-size:18px}
.dg-wins{display:grid;gap:8px;grid-template-columns:1fr;border:0;padding:0;margin:0}.dg-wins legend{padding:0}@media (min-width:420px){.dg-wins{grid-template-columns:1fr 1fr}}
.dg-win{position:relative;display:flex;gap:12px;align-items:center;min-height:64px;padding:10px 12px;border:1.5px solid var(--pl-line-strong);border-radius:var(--pl-r-md,6px);background:var(--pl-surface);cursor:pointer}
.dg-win input{position:absolute;opacity:0;width:1px;height:1px}.dg-win .dy{display:grid;place-items:center;min-width:48px;padding:4px 6px;border-radius:4px;background:var(--pl-sand);font:600 12px/1.15 var(--pl-font-mono);text-transform:uppercase;text-align:center}.dg-win .dy b{font:600 18px/1.1 var(--pl-font-text);text-transform:none}
.dg-win .tm{display:grid}.dg-win .tm b{font-size:16px}.dg-win .tm small{color:var(--pl-soft)}
.dg-win:has(input:checked){border-color:var(--pl-ink);box-shadow:inset 0 0 0 1.5px var(--pl-ink);background:var(--pl-accent-soft,#E7ECF7)}.dg-win:has(input:focus-visible){outline:2px solid var(--pl-focus,var(--pl-accent));outline-offset:2px}
.dg-win.full{opacity:.55;cursor:not-allowed;background:var(--pl-page)}
.dpg .f{display:grid;gap:4px;margin:0 0 12px;font-weight:600}.dpg .f small{font-weight:400;color:var(--pl-soft)}.dpg .f input,.dpg .f textarea{font:400 16px var(--pl-font-text);min-height:48px;padding:10px 12px;border:1.5px solid var(--pl-line-strong);border-radius:var(--pl-r-sm,6px);background:var(--pl-page);color:var(--pl-ink);width:100%}.dpg .f textarea{min-height:72px;resize:vertical}
.dg-sum{display:grid;gap:6px;margin:16px 0 0;padding:14px;border:1.5px solid var(--pl-ink);border-radius:var(--pl-r-md,6px);background:var(--pl-surface)}.dg-sum .tot{display:flex;justify-content:space-between;font-weight:600;font-size:18px}.dg-sum p{margin:0;color:var(--pl-soft);font-size:15px}
.dpg .go{width:100%;min-height:52px;margin-top:10px;border:0;border-radius:var(--pl-r-btn,6px);background:var(--kit-btn,var(--pl-accent));color:var(--kit-on-btn,var(--pl-on-accent,#fff));font:600 17px var(--pl-font-text);cursor:pointer}.dpg .go:disabled{opacity:.5;cursor:not-allowed}
.dpg .err{color:var(--pl-danger,#A8341A);margin:8px 0 0;min-height:1em}
.dg-tk{padding:16px;border:1.5px solid var(--pl-ink);border-radius:var(--pl-r-md,6px);background:var(--pl-surface);display:grid;gap:8px}.dg-tk h2{margin:0;font:600 24px/1.2 var(--pl-font-display,var(--pl-font-text))}.dg-tk p{margin:0}.dg-tk ul{margin:0;padding:0;list-style:none;display:grid;gap:4px}.dg-tk li{display:flex;justify-content:space-between;gap:8px}
.dg-tk .code{font:600 15px var(--pl-font-mono)}.dg-btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}.dg-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:0 16px;border-radius:var(--pl-r-btn,6px);border:1.5px solid var(--pl-ink);background:var(--pl-page);color:var(--pl-ink);font:600 15px var(--pl-font-text);text-decoration:none;cursor:pointer}.dg-btn.pri{background:var(--kit-btn,var(--pl-accent));border-color:var(--kit-btn,var(--pl-accent));color:var(--kit-on-btn,var(--pl-on-accent,#fff))}
.dg-ex{margin:0 0 12px;padding:10px 12px;border:1.5px dashed var(--pl-line-strong);border-radius:var(--pl-r-md,6px);background:var(--pl-sand-soft)}
.dg-view{position:fixed;inset:0;z-index:9000;background:rgba(15,16,16,.94);display:flex;flex-direction:column}.dg-view .bar{display:flex;align-items:center;gap:8px;padding:10px 12px;color:#fff}.dg-view .bar b{flex:1;font:600 16px var(--pl-font-text)}
.dg-view .bar button,.dg-view .nav{width:44px;height:44px;border-radius:50%;border:0;background:rgba(255,255,255,.16);color:#fff;display:grid;place-items:center;cursor:pointer}
.dg-view .rail{flex:1;display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none}.dg-view .rail::-webkit-scrollbar{display:none}.dg-view figure{flex:0 0 100%;margin:0;display:grid;place-items:center;scroll-snap-align:center;padding:8px}.dg-view img{max-width:100%;max-height:100%;object-fit:contain}
.dg-view .nav{position:absolute;top:50%}.dg-view .nav.p{left:10px}.dg-view .nav.n{right:10px}@media (max-width:640px){.dg-view .nav{display:none}}
#dgF{min-width:0}@media (min-width:900px){html body.dg-on #m#m#m{max-width:1080px}.dpg.wide .dg-items{grid-template-columns:1fr 1fr}.dpg .dg-side .dg-wins{grid-template-columns:1fr}.dpg.wide{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:32px;align-items:start}.dpg.wide .dg-side{position:sticky;top:16px}}
@media (prefers-reduced-motion:reduce){.dg-view .rail{scroll-behavior:auto}}`;
  const ISO = /^\d{4}-\d{2}-\d{2}$/;

  window.DropPage = async function (o) {
    const P = window.PLPickup, esc = o.esc, ls = o.ls, id = o.id, m = document.getElementById("m"); if (!m || !P) return;
    const top = m.querySelector(".top")?.outerHTML || "";
    const j = await fetch("/api/public/drop/" + encodeURIComponent(id)).then((r) => (r.ok ? r.json() : null)).catch(() => null), d = j?.drop;
    if (!d) { m.innerHTML = top + `<h1>This drop isn't here</h1><p class="muted">The maker may have taken it down. <a href="/discover">See what's on</a></p>`; return; }
    const e = o.e || {}, ws = o.ws || d.ws, H = o.H || {}, h = { ...(d.host || {}), ...(H.host || {}) }, first = String(h.name || e.hostName || "the maker").trim().split(/\s+/)[0].replace(/['’]s$/i, "") || "the maker";
    if (!document.getElementById("dg-css")) { const s = document.createElement("style"); s.id = "dg-css"; s.textContent = CSS; document.head.appendChild(s); }
    document.title = `${d.title} · Order ahead · Pottery Lab`; document.body.classList.add("dg-on");
    try { window.EncoreBrandKit?.use?.(h.kit || H.host?.kit); } catch {} // a host's own colours on their own page
    const signedIn = /(?:^|;\s*)encore_in=1/.test(document.cookie);
    const [W, meRsvp] = signedIn ? await Promise.all([fetch("/api/workspace", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).catch(() => null), fetch("/api/me/rsvp/" + encodeURIComponent(id), { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)]) : [null, null];
    const owner = !!(W?.handle && d.host?.handle && W.handle === d.host.handle);
    // their own order: from this phone, else from their account
    let mine = o.mine?.rid && o.mine?.code ? o.mine : meRsvp?.rsvp?.response === "going" && meRsvp.rsvp.code ? { rid: meRsvp.rsvp.rid, code: meRsvp.rsvp.code, name: meRsvp.rsvp.name } : null;
    const money = (c) => "$" + (c / 100).toFixed(c % 100 ? 2 : 0), today = new Date().toISOString().slice(0, 10);
    const closed = ISO.test(d.orderByDate || "") && today > d.orderByDate, items = d.items || [], wins = (d.windows || []).filter((w) => w.label);
    const soldOut = items.length && items.every((x) => x.left === 0), canOrder = !d.paused && !closed && !soldOut && !d.example && !owner;
    const status = d.paused ? ["off", "Orders paused"] : closed ? ["off", "Orders closed"] : soldOut ? ["off", "Sold out"] : ["open", `Open for orders${d.left ? " · " + d.left : ""}`];
    const cover = d.coverPhoto ? `<img src="${esc(d.coverPhoto)}" alt="${esc(d.title)}" width="1600" height="1000" fetchpriority="high" decoding="async">` : (() => { try { const EA = window.EventArt; if (EA && (d.coverArt || !d.cover)) { EA.ensureCss?.(); return EA.cover({ ...e, title: d.title, coverArt: d.coverArt || e.coverArt, activity: "bake" }, { title: "", label: "" }); } } catch {} return d.cover ? `<img src="${esc(d.cover)}" alt="${esc(d.title)}" width="1600" height="1000" decoding="async">` : ""; })();
    const pay = d.payOnline ? `Pay with ${esc(first)}'s pay link after you order` : "Pay at pickup";
    const head = `<div class="dg-cov">${cover}</div>
      <p class="dg-tags"><span class="dg-tag">Order ahead</span><span class="dg-tag ${status[0]}" id="dgStatus">${esc(status[1])}</span></p>
      <h1 class="lk-title">${esc(d.title)}</h1>
      ${h.name ? `<p class="dg-by"><span class="av">${h.avatarUrl ? `<img src="${esc(h.avatarUrl)}" alt="" width="28" height="28">` : esc(first[0] || "")}</span><span>By ${h.handle ? `<a href="/@${encodeURIComponent(h.handle)}">${esc(h.name)}</a>` : esc(h.name)}</span></p>` : ""}
      <div class="dg-facts facts"><div>${I.cal}<span><b id="dgWhen">${esc(d.pickup)}</b></span></div>${d.area ? `<div>${I.pin}<span>Pick up in ${esc(d.area)}${d.hasAddress ? `. The exact spot comes the day before.` : ""}</span></div>` : ""}${d.orderBy ? `<div>${I.clock}<span>Order by ${esc(d.orderBy)}</span></div>` : ""}<div>${I.tag}<span>${pay}</span></div></div>
      ${d.note ? `<div class="dg-note"><p style="margin:0">${esc(d.note)}</p><small>${esc(first)}, the maker</small></div>` : ""}
      ${d.allergens ? `<p class="dg-alg" id="dgAlg">${I.info}<span><b>Allergens:</b> ${esc(d.allergens)}</span></p>` : ""}`;
    const ownBar = owner ? `<div class="dg-own" id="dgOwn"><p><b>This is your drop.</b> Guests order on this page. Their orders land in Orders, by pickup time.</p><div class="row"><button type="button" class="dg-btn pri" data-own="orders">See orders</button><button type="button" class="dg-btn" data-own="edit">Edit drop</button><button type="button" class="dg-btn" data-own="share">Copy link</button></div></div>` : "";
    const photosOf = (x) => (x.photos || []).length ? x.photos : x.photo ? [x.photo] : [];
    const card = (x) => { const ph = photosOf(x), out = x.left === 0, low = x.left != null && x.left > 0 && x.left <= 5;
      return `<article class="dg-it${out ? " out" : ""}" data-i="${x.i}">${ph.length ? `<button type="button" class="ph" data-view="${x.i}" aria-label="See ${esc(x.name)} photos">${out ? `<span class="so">Sold out</span>` : ""}<img src="${esc(ph[0])}" alt="${esc(x.name)}" width="800" height="600" loading="lazy" decoding="async">${ph.length > 1 ? `<span class="n">1 of ${ph.length}</span>` : ""}</button>` : (out ? `<span class="so" style="position:static;align-self:flex-start;margin:12px 12px 0">Sold out</span>` : "")}
        <div class="bd"><div class="top"><b>${esc(x.name)}</b><span class="pr">${esc(x.priceText)}</span></div>${x.desc ? `<p class="d">${esc(x.desc)}</p>` : ""}
        ${x.left != null ? `<span class="lf${low ? " low" : ""}">${out ? "None left this batch" : `${x.left} of ${x.stock} left`}</span>` : ""}
        <div class="dg-st"><button type="button" data-d="-1" aria-label="One less ${esc(x.name)}" disabled>−</button><output aria-live="polite" aria-label="${esc(x.name)}, how many">0</output><button type="button" data-d="1" aria-label="One more ${esc(x.name)}"${out || !canOrder ? " disabled" : ""}>+</button></div></div></article>`; };
    const winCard = (w, i, pick) => { const dt = w.date || (w.day ? P.dateFor(w, today) : ""), dd = dt ? new Date(dt + "T12:00:00Z") : null;
      const dayBox = dd ? `<span class="dy">${dd.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}<b>${dd.getUTCDate()}</b>${dd.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}</span>` : `<span class="dy">${I.clock}</span>`;
      const sub = w.full ? "Full" : w.left != null ? `${w.left} spot${w.left === 1 ? "" : "s"} left` : w.date ? "" : `Every ${P.day(dt).split(",")[0]}`;
      return `<label class="dg-win${w.full ? " full" : ""}"><input type="radio" name="slot" value="${esc(w.label)}"${w.full ? " disabled" : ""}${pick ? " checked" : ""}>${dayBox}<span class="tm"><b>${esc(P.span(w) || w.label)}</b><small>${esc([dt ? P.day(dt) : "", sub].filter(Boolean).join(" · "))}</small></span></label>`; };
    const firstOpen = wins.findIndex((w) => !w.full);
    const form = `<form id="dgF" novalidate>${d.example ? `<p class="dg-ex" role="note"><b>Example drop.</b> This shows what an order page looks like. It isn't real, so it can't take orders. <a href="/start" style="color:inherit;font-weight:600">Start your own</a></p>` : ""}
      ${wins.length ? `<h2 class="dg-h">Pick up</h2><fieldset class="dg-wins"><legend class="fb-sr" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Pickup time</legend>${wins.map((w, i) => winCard(w, i, i === firstOpen)).join("")}</fieldset>${d.area ? `<p class="muted" style="margin:8px 0 0;font-size:15px">In ${esc(d.area)}. ${d.hasAddress ? "We'll send the exact spot the day before." : ""}</p>` : ""}` : ""}
      <h2 class="dg-h">Your details</h2>
      <label class="f">Your name<input type="text" id="oNm" autocomplete="name" maxlength="80" required></label>
      <label class="f">Email or phone <small>So ${esc(first)} can tell you it's ready.</small><input type="text" id="oCt" autocomplete="email" inputmode="email" maxlength="120" required></label>
      <label class="f">A note for ${esc(first)} <small>Optional</small><textarea id="oNote" maxlength="300" rows="2"></textarea></label>
      <div class="dg-sum"><div class="tot"><span id="dgCount">Nothing picked yet</span><span id="dgTotal"></span></div><p id="dgPay">${d.payOnline ? `You pay with ${esc(first)}'s pay link once your order is in.` : "You pay at pickup."}</p></div>
      <p class="err" id="oEr" role="alert"></p><button class="go" id="oGo"${canOrder ? "" : " disabled"}>${d.example ? "Example only" : owner ? "Guests order here" : d.paused ? "Orders paused" : closed ? "Orders closed" : soldOut ? "Sold out" : "Place order"}</button></form>`;
    m.innerHTML = top + `<div class="dpg wide"><div class="dg-main">${head}${ownBar}<h2 class="dg-h" id="dgMenu">What's for sale</h2><div class="dg-items">${items.map(card).join("") || `<p class="muted">Nothing listed yet.</p>`}</div></div><div class="dg-side" id="dgSide">${form}</div></div>`;
    const $ = (s) => m.querySelector(s), qty = {};
    const linesNow = () => items.filter((x) => qty[x.i] > 0).map((x) => ({ x, n: qty[x.i] })), cents = (x) => Math.round(x.price * 100);
    const paint = () => { const L = linesNow(), n = L.reduce((a, l) => a + l.n, 0), t = L.reduce((a, l) => a + l.n * cents(l.x), 0);
      $("#dgCount").textContent = n ? `${n} item${n === 1 ? "" : "s"}` : "Nothing picked yet"; $("#dgTotal").textContent = n ? money(t) : "";
      $("#dgPay").textContent = d.payOnline ? `You pay${t ? " " + money(t) : ""} with ${first}'s pay link once your order is in.` : `You pay${t ? " " + money(t) : ""} at pickup.`;
      for (const x of items) { const el = m.querySelector(`.dg-it[data-i="${x.i}"]`); if (!el) continue; const q = qty[x.i] || 0, cap = Math.min(x.max || 20, x.left == null ? 99 : x.left);
        el.querySelector("output").textContent = q; el.querySelector('[data-d="-1"]').disabled = !q; el.querySelector('[data-d="1"]').disabled = !canOrder || q >= cap; } };
    m.addEventListener("click", (ev) => { const b = ev.target.closest(".dg-st [data-d]"); if (b && !$("#dgF")) return; /* the order is in: the ticket replaced the form */ if (b) { const x = items.find((i) => String(i.i) === b.closest(".dg-it").dataset.i); if (!x) return;
        const cap = Math.min(x.max || 20, x.left == null ? 99 : x.left); qty[x.i] = Math.max(0, Math.min(cap, (qty[x.i] || 0) + +b.dataset.d)); $("#oEr").textContent = ""; paint(); return; }
      const v = ev.target.closest("[data-view]"); if (v) { const x = items.find((i) => String(i.i) === v.dataset.view); if (x) viewer(x); } });
    paint();
    // ---- tap a photo: full screen, swipe through ----
    function viewer(x) { const ph = photosOf(x); if (!ph.length) return; const back = document.activeElement;
      const el = document.createElement("div"); el.className = "dg-view"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", x.name + " photos");
      el.innerHTML = `<div class="bar"><b>${esc(x.name)} · <span>1</span> of ${ph.length}</b><button type="button" data-x aria-label="Close">${I.x}</button></div><div class="rail" tabindex="0">${ph.map((u, k) => `<figure><img src="${esc(u)}" alt="${esc(x.name)}, photo ${k + 1} of ${ph.length}" decoding="async"${k ? ' loading="lazy"' : ""}></figure>`).join("")}</div>${ph.length > 1 ? `<button type="button" class="nav p" aria-label="Previous photo">${I.l}</button><button type="button" class="nav n" aria-label="Next photo">${I.r}</button>` : ""}`;
      document.body.appendChild(el); document.documentElement.style.overflow = "hidden"; const rail = el.querySelector(".rail"), num = el.querySelector(".bar span");
      const close = () => { el.remove(); document.documentElement.style.overflow = ""; removeEventListener("keydown", key); back?.focus?.(); };
      const go = (k) => rail.scrollTo({ left: rail.clientWidth * Math.max(0, Math.min(ph.length - 1, k)), behavior: "smooth" }), at = () => Math.round(rail.scrollLeft / Math.max(1, rail.clientWidth));
      const key = (ev) => { if (ev.key === "Escape") close(); if (ev.key === "ArrowRight") go(at() + 1); if (ev.key === "ArrowLeft") go(at() - 1); };
      addEventListener("keydown", key); rail.addEventListener("scroll", () => { num.textContent = at() + 1; }, { passive: true });
      el.querySelector("[data-x]").onclick = close; el.querySelector(".nav.p")?.addEventListener("click", () => go(at() - 1)); el.querySelector(".nav.n")?.addEventListener("click", () => go(at() + 1));
      el.querySelector("[data-x]").focus(); }
    // ---- the host's own view: orders, edit, share ----
    const withDrop = (cb) => { if (window.EncoreDrop) return cb(window.EncoreDrop); const s = document.createElement("script"); s.src = "/drop.js"; s.onload = () => cb(window.EncoreDrop); document.head.appendChild(s); };
    m.querySelectorAll("[data-own]").forEach((b) => (b.onclick = async () => { const k = b.dataset.own;
      if (k === "share") { try { await navigator.clipboard.writeText(location.origin + "/e/" + id); b.textContent = "Link copied"; } catch { prompt("Copy this link:", location.origin + "/e/" + id); } return; }
      if (k === "orders") return withDrop((D) => D?.inbox?.({ only: id }));
      if (k === "edit") { const L = await fetch("/api/host/drops", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).catch(() => null), dr = L?.drops?.find((x) => x.id === id); if (dr) withDrop((D) => D?.setup?.({ drop: dr, onDone: () => location.reload() })); } }));
    // ---- their details: from their account, else what this phone remembers ----
    (async () => { let p = null; try { p = JSON.parse(ls.get("encore.rsvpProfile") || "null"); } catch {}
      if (signedIn) { try { const r = await fetch("/api/me/rsvp-profile", { credentials: "same-origin" }); if (r.ok) { const S = (await r.json()).profile; if (S) p = { ...(p || {}), ...S }; } } catch {}
        if (!p?.name || !(p.email || p.phone)) { try { const me = await (await fetch("/api/me", { credentials: "same-origin" })).json(); p = { name: p?.name || me.name || "", email: p?.email || me.email || "", phone: p?.phone || me.phone || "" }; } catch {} } }
      if (!p || owner) return; const nm = $("#oNm"), ct = $("#oCt"); if (nm && !nm.value && p.name) nm.value = p.name; if (ct && !ct.value && (p.email || p.phone)) ct.value = p.email || p.phone; })();
    // ---- place the order ----
    const form$ = $("#dgF");
    form$.onsubmit = async (ev) => { ev.preventDefault(); const er = $("#oEr"); er.textContent = ""; if (!canOrder) return;
      const L = linesNow(), name = $("#oNm").value.trim().replace(/[<>]/g, "").slice(0, 80), c = $("#oCt").value.trim(), email = /@/.test(c) ? c : "", phone = !email && c.replace(/\D/g, "").length >= 7 ? c.replace(/[^\d+]/g, "") : "";
      const slot = form$.querySelector('input[name="slot"]:checked')?.value || (wins.length === 1 ? wins[0].label : ""), note = $("#oNote").value.trim().slice(0, 300);
      if (!L.length) { er.textContent = "Pick something first. Tap + on what you'd like."; $("#dgMenu").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
      if (wins.length && !slot) { er.textContent = "Pick a pickup time."; form$.querySelector('input[name="slot"]:not(:disabled)')?.focus(); return; }
      if (!name) { er.textContent = `Add your name so ${first} knows whose order it is.`; $("#oNm").focus(); return; }
      if (!email && !phone) { er.textContent = `Add an email or phone so ${first} can tell you it's ready.`; $("#oCt").focus(); return; }
      const total = L.reduce((a, l) => a + l.n * cents(l.x), 0), code = (window.__dgCode ||= Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join(""));
      const data = { eventId: id, response: "going", name, email, ...(phone ? { phone, contactVia: "sms" } : { contactVia: "email" }), slot, orderQty: L.map((l) => ({ i: l.x.i, qty: l.n })), ...(note ? { orderNote: note } : {}), code, createdAt: Date.now(), via: "drop-order" };
      const go = $("#oGo"); go.disabled = true; go.textContent = "Placing your order…";
      try { const b = JSON.stringify(data), r = await fetch("/api/db/collection?path=rsvps", { method: "POST", headers: { "Content-Type": "application/json", "x-encore-guest": "1", "x-encore-key": o.gkey(), "x-encore-workspace": ws, "Idempotency-Key": "order-" + code + "-" + [...b].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7).toString(36) }, body: b });
        const jj = await r.json().catch(() => ({})); if (!r.ok) throw new Error(jj.message || "That didn't go through. Try again.");
        const rid = String(jj.id || jj.doc?.id || "").split("/").pop(), lines = L.map((l) => ({ name: l.x.name, qty: l.n, price: l.x.price }));
        const M = { rid, code, name, ct: c, gi: -1, response: "going", order: lines.map((l) => `${l.qty} × ${l.name}`).join(", "), lines, total, slot, wall: false, eventId: id, data: {} };
        ls.set("encore-rsvp-" + id, JSON.stringify(M));
        try { const p0 = JSON.parse(ls.get("encore.rsvpProfile") || "null") || {}; ls.set("encore.rsvpProfile", JSON.stringify({ ...p0, name, ...(email ? { email } : {}), ...(phone ? { phone } : {}), updatedAt: Date.now() })); } catch {}
        ticket(M, true); }
      catch (err) { er.textContent = /fetch|load failed|network/i.test(err.message) ? "That didn't go through. Check your connection and try again." : err.message; go.disabled = false; go.textContent = "Place order"; } };
    // ---- after ordering, and coming back later: the order, pickup, pay, calendar ----
    async function ticket(M, fresh) { const side = $("#dgSide"); if (!side) return; m.querySelectorAll(".dg-st [data-d]").forEach((x) => (x.disabled = true));
      const w = P.windowOfSlot(d, M.slot) || (wins.length === 1 ? wins[0] : null), dt = w ? P.dateFor(w, today) : P.firstDate(d, today), wl = w ? P.label(dt ? { ...w, date: dt, day: "" } : w).replace(" · ", ", ") : "";
      let addr = ""; if (M.rid && M.code && d.hasAddress) { try { const a = await (await fetch(`/api/public/address/${encodeURIComponent(id)}?rid=${encodeURIComponent(M.rid)}&code=${encodeURIComponent(M.code)}`)).json(); if (a?.ok) addr = a.venueAddr || ""; } catch {} }
      const lines = M.lines || [], total = +M.total || lines.reduce((a, l) => a + Math.round(l.price * 100) * l.qty, 0), payUrl = d.payOnline && total && e.ticketUrl ? o.payLinkOf(e.ticketUrl, money(total), [M.name, d.title].filter(Boolean).join(" · ")) : "";
      const where = addr ? ` at ${addr}${d.area ? `, ${d.area}` : ""}` : d.area ? ` in ${d.area}` : "";
      const st = M.paid ? "Paid. See you at pickup." : M.paidClaim ? `You said you paid. ${first} will check.` : payUrl ? `Pay ${money(total)} with ${first}'s link to finish.` : total ? `Pay ${money(total)} at pickup.` : "";
      side.innerHTML = `<div class="dg-tk" id="tk" role="status"><h2>${fresh ? "Order placed" : "Your order"}</h2>
        <p>${wl ? `Pick up ${esc(wl)}${esc(where)}.` : `Pick up${esc(where)}.`}${!addr && d.hasAddress ? " We'll send the exact spot the day before." : ""}</p>
        ${lines.length ? `<ul>${lines.map((l) => `<li><span>${l.qty} × ${esc(l.name)}</span><span>${l.price ? money(Math.round(l.price * 100) * l.qty) : ""}</span></li>`).join("")}${total ? `<li style="font-weight:600;border-top:1px solid var(--pl-line);padding-top:4px"><span>Total</span><span>${money(total)}</span></li>` : ""}</ul>` : M.order ? `<p>${esc(M.order)}</p>` : ""}
        ${M.code ? `<p class="muted">Order <span class="code">#${esc(String(M.code).slice(0, 6))}</span>. Show this at pickup.</p>` : ""}${st ? `<p class="muted" id="tkPay">${esc(st)}</p>` : ""}
        <div class="dg-btns">${payUrl && !M.paid && !M.paidClaim ? `<a class="dg-btn pri" id="oPay" href="${esc(payUrl)}" target="_blank" rel="noopener">Pay ${money(total)}</a><button type="button" class="dg-btn" id="oPaid" hidden>I paid</button>` : ""}${dt ? `<button type="button" class="dg-btn${payUrl ? "" : " pri"}" id="cal" data-addcal aria-haspopup="dialog">${I.cal}Add to calendar</button>` : ""}</div>
        <p style="margin-top:6px;font-size:15px"><button type="button" class="dg-btn" id="oCancel" style="min-height:40px;border-color:var(--pl-line-strong)">Can't make it? Cancel order</button></p></div>`;
      side.querySelector("#tk").scrollIntoView({ behavior: fresh ? "smooth" : "auto", block: "nearest" });
      const cal = side.querySelector("#cal"); if (cal) cal.onclick = () => { const it = { eventId: id, title: `Pickup: ${d.title}`, date: dt, place: [addr, d.area, d.city].filter(Boolean).join(", "), ...(w?.start ? { startMs: new Date(`${dt}T${w.start}:00`).getTime(), endMs: new Date(`${dt}T${w.end || w.start}:00`).getTime() + (w.end ? 0 : 3600e3) } : { allDay: true }) };
        const open = () => window.PLAddCal?.open(cal, it); if (window.PLAddCal) open(); else { const s = document.createElement("script"); s.src = "/addcal.js"; s.onload = open; document.head.appendChild(s); } };
      const oPay = side.querySelector("#oPay"), oPaid = side.querySelector("#oPaid");
      if (oPay && oPaid) { oPay.addEventListener("click", () => { oPaid.hidden = false; });
        oPaid.onclick = async () => { oPaid.disabled = true; try { const r = await fetch("/api/db/doc?path=" + encodeURIComponent("rsvps/" + M.rid), { method: "PATCH", headers: { "Content-Type": "application/json", "x-encore-guest": "1", "x-encore-key": o.gkey(), "x-encore-workspace": ws }, body: JSON.stringify({ paidClaim: true, changedAt: Date.now() }) }); if (!r.ok) throw 0;
          ls.set("encore-rsvp-" + id, JSON.stringify({ ...M, paidClaim: true })); side.querySelector("#tkPay").textContent = `You said you paid. ${first} will check.`; oPay.remove(); oPaid.remove(); } catch { oPaid.disabled = false; oPaid.textContent = "Didn't go through. Try again"; } }; }
      side.querySelector("#oCancel").onclick = async (ev) => { const b = ev.currentTarget; if (!confirm(`Cancel your order? ${first} will see it's cancelled.`)) return; b.disabled = true;
        // with the order's own code (public/invite.html does the same): an order placed on another phone has no key here
        try { const r = await fetch("/api/public/reply/" + encodeURIComponent(id), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ response: "no", rid: M.rid, code: M.code }) }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "");
          ls.set("encore-rsvp-" + id, JSON.stringify({ ...M, response: "no" })); location.reload(); } catch (x) { b.disabled = false; b.textContent = (x.message ? x.message + " " : "") + "Didn't go through. Try again"; } }; }
    // coming back: their order, not a blank form (asked again with the order's own code)
    if (mine && !owner) { const q = `${encodeURIComponent(id)}?rid=${encodeURIComponent(mine.rid)}&code=${encodeURIComponent(mine.code)}`;
      const R = o.st?.orderLines ? o.st : await fetch("/api/public/reply/" + q).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (R && R.response === "going" && (R.orderLines || []).length) ticket({ ...mine, name: R.name || mine.name, lines: R.orderLines, total: Math.round((+R.orderTotal || 0) * 100), slot: R.slot || mine.slot, order: R.order, paid: !!R.paid, paidClaim: !!R.paidClaim }, false);
      else if (R && R.response === "going" && mine.order) ticket(mine, false); }
  };
})();
