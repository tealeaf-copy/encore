// Brandbook: shared pieces for booking experience hosts for teams (docs/components.md). Pages build from these so the
// brand side and the host side look and behave the same. window.BB = { esc, money, api, icon, top, cover, card, chips,
// gallery, viewer, trustRow, verifyRow, badges, priceBox, terms, reviews, calendar, map, sheet, toast, go, saveTo }.
(function () {
  if (window.BB) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const money = (c, cents) => { const v = Math.round(+c || 0); return "$" + (cents && v % 100 ? (v / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(v / 100).toLocaleString("en-US")); };
  const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
  async function api(url, body, method) { const r = await fetch(url, { method: method || (body ? "POST" : "GET"), credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.message || "Something went wrong. Try again."); e.status = r.status; e.code = j.code; throw e; } return j; }
  const native = () => /PotteryLabApp\//.test(navigator.userAgent);

  // ---- drawn line icons (24 x 24, 1.5 stroke) ----
  const P = {
    bonding: '<circle cx="8" cy="8" r="2.6"/><circle cx="16" cy="8" r="2.6"/><path d="M3.5 19c.5-3.4 2.3-5.4 4.5-5.4s3.4 1.4 4 3M12 16.6c.6-1.6 1.8-3 4-3s4 2 4.5 5.4"/><path d="M9.5 19.5h5"/>',
    client: '<path d="M7 3.5h5c0 4-1 6-2.5 6S7 7.5 7 3.5z"/><path d="M9.5 9.5v6M7.5 15.5h4"/><ellipse cx="16.5" cy="17" rx="4.5" ry="1.6"/><path d="M14 15.4c.4-1.6 1.3-2.4 2.5-2.4s2.1.8 2.5 2.4"/><path d="M3 20.5h18"/>',
    handson: '<path d="M10 4h4v1.2c0 1 3 2.4 3 6 0 3.2-2.1 5-5 5s-5-1.8-5-5c0-3.6 3-5 3-6z"/><path d="M5 20.5c1.5-2 3-2.6 4.5-2.4l3 .4c1 .2 1.4 1.4.5 1.9"/><path d="M13 19.8l4.5-1.6c1-.3 1.9.4 1.6 1.2"/>',
    calm: '<path d="M5 11h12v2.5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5z"/><path d="M17 12.2h1.5a2 2 0 0 1 0 4H16.5"/><path d="M8.5 8c-.8-1 .8-1.6 0-3M12 8c-.8-1 .8-1.6 0-3"/><path d="M4 21h14"/>',
    celebrate: '<path d="M4 20.5l4.5-11 6.5 6.5z"/><path d="M8 14.5l2 2M10 11l3.5 3.5"/><path d="M14.5 4.5l.5 2M19.5 9.5l-2 .5M17.5 5.5l-1.5 1.5"/><circle cx="20" cy="4" r=".6"/><circle cx="12" cy="3.5" r=".6"/><circle cx="20.5" cy="14" r=".6"/>',
    remote: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2.5 19h19"/><path d="M12 13.4c-2.4-1.5-3.5-2.6-3.5-3.8a1.6 1.6 0 0 1 3.5-.6 1.6 1.6 0 0 1 3.5.6c0 1.2-1.1 2.3-3.5 3.8z"/>',
    under50: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-7.1 7.1a1 1 0 0 1-1.4 0z"/><circle cx="8" cy="8" r="1.3"/><path d="M14.5 10.5c-.6-.6-2.4-.7-2.6.4-.3 1.5 3 .9 2.8 2.6-.2 1.1-2 1-2.8.3M13.2 9.4l.2-.9M13.8 15l.2-.9"/>',
    all: '<rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"/>',
    save: '<path d="M7 3.5h10a1 1 0 0 1 1 1v16l-6-4-6 4v-16a1 1 0 0 1 1-1z"/>',
    share: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/>',
    map: '<path d="M3.5 6.5l5.5-2 6 2 5.5-2v13l-5.5 2-6-2-5.5 2z"/><path d="M9 4.5v13M15 6.5v13"/>',
    list: '<path d="M8 6.5h12M8 12h12M8 17.5h12"/><circle cx="4.5" cy="6.5" r=".8"/><circle cx="4.5" cy="12" r=".8"/><circle cx="4.5" cy="17.5" r=".8"/>',
    star: '<path d="M12 3.8l2.4 5 5.4.6-4 3.7 1.1 5.4L12 15.8l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    shield: '<path d="M12 3.5l7 2.6v5.4c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6.1z"/><path d="M8.8 12.2l2.2 2.2 4.2-4.4"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
    mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/><path d="M4 6.5l8 6.5 8-6.5"/>',
    doc: '<path d="M6.5 3.5h7.5l4 4v13h-11.5z"/><path d="M13.5 3.5v4.5H18M9 12.5h6M9 15.5h6"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="1.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
    people: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19.5c.5-3.6 2.7-5.6 5.5-5.6s5 2 5.5 5.6"/><path d="M15.5 5.2a3 3 0 0 1 0 5.6M17 14.2c2 .6 3.2 2.4 3.5 5.3"/>',
    pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    left: '<path d="M14.5 5.5L8 12l6.5 6.5"/>', right: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
    bolt: '<path d="M13 3L5.5 13.5H12L11 21l7.5-10.5H12z"/>',
    repeat: '<path d="M4.5 11V9a3 3 0 0 1 3-3h11l-3-3M19.5 13v2a3 3 0 0 1-3 3h-11l3 3"/>',
    chat: '<path d="M4.5 5.5h15a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-4.5 3.5v-3.5h-1a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/>',
    flag: '<path d="M5.5 21V4M5.5 4.5h11l-2 4 2 4h-11"/>',
    sun: '<circle cx="12" cy="12" r="3.5"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
    table: '<path d="M3 9.5h18M5 9.5l-1 10M19 9.5l1 10"/><circle cx="8" cy="6.5" r="1.5"/><circle cx="12" cy="6" r="1.5"/><circle cx="16" cy="6.5" r="1.5"/>',
    camera: '<rect x="3.5" y="7" width="17" height="12" rx="1.5"/><path d="M8.5 7l1.5-2.5h4L15.5 7"/><circle cx="12" cy="13" r="3.2"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="1.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    card: '<rect x="3" y="5.5" width="18" height="13" rx="1.5"/><path d="M3 9.5h18M6.5 15h4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
    inbox: '<path d="M3.5 13.5l2.5-8h12l2.5 8v5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/><path d="M3.5 13.5H9l1 2h4l1-2h5.5"/>',
    home: '<path d="M4 11l8-6.5 8 6.5v9H4z"/><path d="M10 20v-5h4v5"/>',
    spark: '<path d="M4 19.5h16"/><path d="M6.5 16v-4M11 16V8M15.5 16v-6M20 16V5"/>',
    upload: '<path d="M12 16V4M8 8l4-4 4 4"/><path d="M4.5 15.5v3a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-3"/>',
    download: '<path d="M12 4v12M8 12l4 4 4-4"/><path d="M4.5 15.5v3a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-3"/>',
  };
  const icon = (n, cls = "") => `<svg class="bb-ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || ""}</svg>`;
  const LOGO = '<svg viewBox="0 0 28 28" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4.2h8M11.1 4.2v1.7c0 1.2-.9 1.8-.9 2.9 0 1.3-5.5 3.2-5.5 8.9 0 4.5 4.1 7.3 9.3 7.3s9.3-2.8 9.3-7.3c0-5.7-5.5-7.6-5.5-8.9 0-1.1-.9-1.7-.9-2.9V4.2M12.7 19.2c.8.55 1.8.55 2.6 0"/></svg>';

  // ---- header: one quiet bar for the brand side, one for the host side ----
  function top(active, side = "brand") {
    const L = side === "host" ? [["/host/teams", "inbox", "Teams", "teams"], ["/teams/discover", "all", "See it as a brand", "discover"]]
      : [["/teams/home", "home", "Home", "home"], ["/teams/discover", "all", "Discover hosts", "discover"], ["/teams/campaigns", "flag", "Campaigns", "campaigns"], ["/teams/insights", "spark", "Insights", "insights"], ["/teams/bookings", "cal", "Bookings", "bookings"]];
    const el = document.createElement("header"); el.className = "bb-top";
    el.innerHTML = `<div class="in"><a class="bb-logo" href="${side === "host" ? "/host/teams" : "/teams/home"}">${LOGO}<span>Pottery Lab</span></a><nav class="bb-nav" aria-label="Teams">${L.map(([h, i, t, k]) => `<a href="${h}"${k === active ? ' aria-current="page"' : ""} aria-label="${t}">${icon(i)}<span class="lbl">${t}</span></a>`).join("")}</nav></div>`;
    document.body.prepend(el); return el;
  }

  // ---- covers: the photo, or our drawn cover when photos are weak or missing ----
  const ARTS = { client: "dinner", bonding: "games", handson: "craft", calm: "tea", celebrate: "party", remote: "laptop" };
  function artFor(x) { const k = x.art || ARTS[(x.moods || [])[0]] || "dinner"; return k; }
  function drawn(x, title) { try { if (window.EventArt) return `<span class="bb-art" role="img" aria-label="${esc(title || x.name || "")}">${window.EventArt.cover({ title: title || x.name }, { kind: artFor(x), title: title || x.name || "", label: "", exact: true })}</span>`; } catch {}
    return `<span class="bb-art" role="img" aria-label="${esc(title || "")}"></span>`; }
  function cover(x, opts = {}) { const ph = (x.photos && x.photos[0]) || x.photo; if (x.lead !== "drawn" && ph?.url) return `<img src="${esc(ph.url)}" alt="${esc(ph.caption || x.name || "")}" loading="${opts.eager ? "eager" : "lazy"}" decoding="async"${opts.vt ? ` style="view-transition-name:${opts.vt}"` : ""}>`; return drawn(x); }

  const stars = (r) => { const n = Math.round(r || 0); return `<span class="bb-stars" aria-label="${(+r || 0).toFixed(1)} out of 5">${[1, 2, 3, 4, 5].map((i) => icon("star", i <= n ? "f" : "")).join("")}</span>`; };
  const trustedBadge = () => `<span class="bb-badge trusted" title="Earned: see how at /teams/trusted">${icon("check")}Trusted host</span>`;

  // ---- a card that expands into the experience page ----
  function card(c, { saved = false, people = 0 } = {}) {
    const href = `/teams/x/${encodeURIComponent(c.handle)}/${encodeURIComponent(c.pkg)}${people ? "?people=" + people : ""}`, key = c.handle + "/" + c.pkg;
    return `<article class="bb-card" data-key="${esc(key)}"><a href="${href}" class="bb-go" data-key="${esc(key)}"><div class="ph">${cover(c)}${c.host.trusted ? `<span class="flag">${trustedBadge()}</span>` : ""}</div>
      <div class="bd"><h3>${esc(c.name)}</h3><p class="who"><span>${esc(c.host.name)}</span><span>· ${esc(c.remote ? "Remote" : c.area.area || c.area.city)}</span>${c.reviews ? `<span>· ${icon("star")} <span class="bb-mono">${c.rating.toFixed(1)}</span> (${c.reviews})</span>` : ""}</p>
      <p class="tot"><b>${esc(c.price.summary)}</b></p><p class="sub">${money(c.perPersonCents)} a person · ${c.minGuests} to ${c.maxGuests} people${c.instant ? " · Instant book" : ""}</p></div></a>
      <button class="save" type="button" data-save="${esc(key)}" aria-pressed="${saved}" aria-label="${saved ? "Saved to your shortlist" : "Save to a shortlist"}">${icon("save")}</button></article>`;
  }
  // cards grow into the page: the clicked photo carries the hero's transition name across the navigation
  function expandOnClick(root) { root.addEventListener("click", (e) => { const a = e.target.closest("a.bb-go"); if (!a) return; $$("[style*=view-transition-name]", root).forEach((x) => (x.style.viewTransitionName = "")); const img = a.querySelector(".ph img, .ph .bb-art"); if (img) img.style.viewTransitionName = "bb-hero"; }); }

  // ---- mood chips ----
  function chips(moods, current, onPick) {
    const el = document.createElement("div"); el.className = "bb-chips"; el.setAttribute("role", "toolbar"); el.setAttribute("aria-label", "Browse by mood");
    el.innerHTML = [{ id: "", label: "All" }, ...moods].map((m) => `<button type="button" class="bb-chip bb-mood" data-m="${m.id}" aria-pressed="${m.id === current}">${icon(m.id || "all", "wig")}<span>${esc(m.label)}</span></button>`).join("");
    el.addEventListener("click", (e) => { const b = e.target.closest("[data-m]"); if (!b) return; $$("[data-m]", el).forEach((x) => x.setAttribute("aria-pressed", x === b)); onPick(b.dataset.m); });
    return el;
  }

  // ---- gallery: an edge-to-edge strip on phones, a grid on laptops, a full-screen viewer on tap ----
  function gallery(x, title) {
    const photos = x.lead === "drawn" ? [] : x.photos || [], n = Math.max(1, Math.min(5, photos.length));
    const items = photos.length ? photos : [{ drawn: true }];
    const el = document.createElement("div"); el.className = "bb-gallery";
    el.innerHTML = `<div class="strip n${n}">${items.map((p, i) => `<button type="button" data-i="${i}" aria-label="Open photo ${i + 1} of ${items.length}">${p.drawn ? drawn(x, title).replace('class="bb-art"', `class="bb-art" style="view-transition-name:bb-hero"`) : `<img src="${esc(p.url)}" alt="${esc(p.caption || title || "")}" ${i === 0 ? 'style="view-transition-name:bb-hero" fetchpriority="high"' : 'loading="lazy"'}>`}</button>`).join("")}</div>
      ${photos.length > 1 ? `<button type="button" class="count" data-i="0">${icon("camera")} <span>1 / ${photos.length}</span></button>` : photos.length ? "" : '<span class="hint">Photos coming soon</span>'}`;
    const strip = $(".strip", el), count = $(".count span", el);
    strip.addEventListener("scroll", () => { if (count) count.textContent = `${Math.round(strip.scrollLeft / strip.clientWidth) + 1} / ${photos.length}`; }, { passive: true });
    el.addEventListener("click", (e) => { const b = e.target.closest("[data-i]"); if (b && photos.length) viewer(photos, +b.dataset.i, title); });
    return el;
  }
  function viewer(photos, i = 0, title = "") {
    const v = document.createElement("div"); v.className = "bb-viewer"; v.setAttribute("role", "dialog"); v.setAttribute("aria-modal", "true"); v.setAttribute("aria-label", title + " photos");
    const draw = () => { const p = photos[i]; v.innerHTML = `<div class="vt"><button type="button" data-x aria-label="Close">${icon("x")}</button><span>${i + 1} / ${photos.length}</span><span style="width:44px"></span></div>
      <div class="vm">${photos.length > 1 ? `<button class="nav p" type="button" data-p aria-label="Previous">${icon("left")}</button>` : ""}<img src="${esc(p.url)}" alt="${esc(p.caption || title)}">${photos.length > 1 ? `<button class="nav n" type="button" data-n aria-label="Next">${icon("right")}</button>` : ""}</div><p class="cap">${esc(p.caption || "")}</p>`; $("[data-x]", v).focus(); };
    const go = (d) => { i = (i + d + photos.length) % photos.length; draw(); };
    const close = () => { v.remove(); document.removeEventListener("keydown", key); document.body.style.overflow = ""; };
    const key = (e) => { if (e.key === "Escape") close(); if (e.key === "ArrowRight") go(1); if (e.key === "ArrowLeft") go(-1); };
    v.addEventListener("click", (e) => { if (e.target.closest("[data-x]")) close(); else if (e.target.closest("[data-p]")) go(-1); else if (e.target.closest("[data-n]")) go(1); });
    let sx = null; v.addEventListener("touchstart", (e) => (sx = e.touches[0].clientX), { passive: true }); v.addEventListener("touchend", (e) => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); sx = null; });
    document.addEventListener("keydown", key); document.body.style.overflow = "hidden"; document.body.append(v); draw();
  }

  // ---- trust ----
  const hours = (h) => (h == null ? "" : h < 1 ? "under an hour" : h < 24 ? `${Math.round(h)} ${Math.round(h) === 1 ? "hour" : "hours"}` : `${Math.round(h / 24)} ${Math.round(h / 24) === 1 ? "day" : "days"}`);
  function trustRow(s) {
    const cells = [];
    if (s.reviews) cells.push([s.rating.toFixed(1), `from ${s.reviews} team ${s.reviews === 1 ? "review" : "reviews"}`]); else cells.push(["New", "to team bookings"]);
    cells.push([String(s.events || 0), (s.events === 1 ? "event" : "events") + " hosted"]);
    if (s.years) cells.push([String(s.years), `${s.years === 1 ? "year" : "years"} hosting`]);
    if (s.again?.pct != null) cells.push([s.again.pct + "%", "of guests would go again"]);
    if (s.responseHours != null) cells.push([hours(s.responseHours).replace(/^under /, "<"), "usual reply time"]);
    if (s.responseRate != null) cells.push([Math.round(s.responseRate * 100) + "%", "of requests answered in a day"]);
    if (s.brands) cells.push([Math.round((s.repeatRate || 0) * 100) + "%", "of teams booked again"]);
    while (cells.length % 2) cells.pop();
    const C = cells.slice(0, 8); return `<div class="bb-trust n${C.length}"><div class="in">${C.map(([b, t]) => `<div><b>${esc(b)}</b><span>${esc(t)}</span></div>`).join("")}</div></div>`;
  }
  function verifyRow(s) {
    const V = [["mail", "Email verified", s.emailVerified], ["phone", "Phone verified", s.phoneVerified], ["shield", "ID checked", s.idChecked], ["doc", s.coi?.onFile ? `Insured${s.coi.expires ? " until " + new Date(s.coi.expires + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric" }) : ""}` : "Insurance on request", !!s.coi?.onFile]];
    return `<div class="bb-verify">${V.map(([i, t, ok]) => `<span class="${ok ? "" : "no"}">${icon(ok ? i : "minus")}${esc(ok ? t : t.replace(/ verified| checked/, " not checked yet").replace("Insurance on request", "Insurance on request"))}</span>`).join("")}</div>`;
  }

  // ---- price box: the total for the group, every line, the deposit and the terms ----
  function priceLines(p) { return `<table class="bb-lines"><tbody>${p.lines.map((l) => `<tr><td>${esc(l.label)}${l.note ? `<small>${esc(l.note)}</small>` : ""}</td><td class="n">${money(l.cents, true)}</td></tr>`).join("")}</tbody><tfoot><tr><th>Total for ${p.headcount}</th><th class="n">${money(p.totalCents, true)}</th></tr></tfoot></table>`; }
  function priceBox(p, terms, { stepper = true, min = 1, max = 99, cta = "" } = {}) {
    return `<div class="bb-price"><p class="big">${money(p.totalCents)} <small>total for ${p.headcount}</small></p><p class="incl">${p.includes ? esc(p.includes[0].toUpperCase() + p.includes.slice(1)) : ""}${p.includes ? " · " : ""}${money(p.effectivePerPersonCents)} a person, all in</p>
      ${stepper ? `<div class="bb-hc"><span><b>Group size</b><br><small class="bb-meta">${min} to ${max} people</small></span><div class="bb-step"><button type="button" data-hc="-1" aria-label="Fewer people">${icon("minus")}</button><output aria-live="polite">${p.headcount}</output><button type="button" data-hc="1" aria-label="More people">${icon("plus")}</button></div></div>` : ""}
      <details${stepper ? "" : " open"}><summary class="bb-link">See the breakdown</summary>${priceLines(p)}</details>
      <p class="dep">${icon("lock")} <b>${money(p.depositCents)} deposit</b> holds the date. The rest, ${money(p.balanceCents)}, is due 7 days before.</p>
      ${terms ? `<p class="bb-meta">${icon("cal")} ${esc(terms.short)}. <a href="#terms">Read the terms</a></p>` : ""}${cta}</div>`;
  }
  const termsList = (t) => `<ul class="bb-terms">${t.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul><p class="bb-meta">${esc(t.deposit)}</p>`;

  // ---- reviews, teams and guests apart ----
  function reviews(R) {
    const el = document.createElement("div");
    const teams = R.brands || [], guests = R.guests || [];
    const T = (x) => `<div class="bb-review">${stars(x.rating)}<p>${esc(x.text)}</p><p class="by">${esc([x.role, x.company].filter(Boolean).join(", ") || "A team that booked")} · ${esc(x.pkg || "")}${x.headcount ? ` for ${x.headcount}` : ""}${x.month ? " · " + new Date(x.month + "-15").toLocaleDateString("en-US", { month: "long", year: "numeric" }) : ""}</p></div>`;
    const G = (x) => `<div class="bb-review"><p>“${esc(x.text)}”</p><p class="by">${esc(x.name)}${x.event ? ", at " + esc(x.event) : ""}</p></div>`;
    el.innerHTML = `<div class="bb-tabs" role="tablist"><button role="tab" aria-selected="true" data-t="t">From teams who booked (${teams.length})</button><button role="tab" aria-selected="false" data-t="g">From guests (${guests.length})</button></div>
      <div data-p="t" class="bb-reviews">${teams.length ? teams.map(T).join("") : '<p class="bb-meta">No team reviews yet. Every review here comes from a booking on Pottery Lab.</p>'}</div><div data-p="g" class="bb-reviews bb-hide">${guests.length ? guests.map(G).join("") : '<p class="bb-meta">No guest kudos yet.</p>'}</div>`;
    el.addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (!b) return; $$("[data-t]", el).forEach((x) => x.setAttribute("aria-selected", x === b)); $$("[data-p]", el).forEach((p) => p.classList.toggle("bb-hide", p.dataset.p !== b.dataset.t)); });
    return el;
  }

  // ---- availability calendar ----
  const WD = ["M", "T", "W", "T", "F", "S", "S"];
  function calendar(A, { picked = "", pickable = false, flex = null } = {}) {
    const [y, m] = A.month.split("-").map(Number), name = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    const lead = (A.days[0].w + 6) % 7;
    const inFlex = (d) => flex && d.state === "open" && d.date.startsWith(flex.month) && (flex.days === "any" || (flex.days === "weekend" ? d.w === 0 || d.w === 6 : d.w >= 1 && d.w <= 5));
    return `<div class="bb-cal"><h3>${name}</h3><div class="g">${WD.map((d) => `<span class="wd">${d}</span>`).join("")}${"<span></span>".repeat(lead)}${A.days.map((d) => `<${pickable && d.state === "open" ? "button type=\"button\"" : "span"} class="d ${d.state}${inFlex(d) ? " inflex" : ""}" data-date="${d.date}"${pickable && d.state === "open" ? ` aria-pressed="${d.date === picked}"` : ""} aria-label="${d.date} ${d.state === "open" ? "open" : d.state === "booked" ? "booked" : "not available"}">${+d.date.slice(8)}</${pickable && d.state === "open" ? "button" : "span"}>`).join("")}</div></div>`;
  }
  const legend = () => `<div class="bb-legend"><span><i></i>Open</span><span><i class="b"></i>Booked</span><span><i class="c"></i>Not available</span></div>`;

  // ---- the map: drawn, with approximate areas only ----
  function map(places, { on = "" } = {}) {
    const P2 = places.filter((p) => p.lat != null); if (!P2.length) return `<div class="bb-empty">No areas to show yet.</div>`;
    let la0 = Math.min(...P2.map((p) => p.lat)), la1 = Math.max(...P2.map((p) => p.lat)), lo0 = Math.min(...P2.map((p) => p.lng)), lo1 = Math.max(...P2.map((p) => p.lng));
    const pad = 0.03; la0 -= pad; la1 += pad; lo0 -= pad; lo1 += pad; const W = 640, H = 400, sx = W / Math.max(0.02, lo1 - lo0), sy = H / Math.max(0.02, la1 - la0), s = Math.min(sx, sy);
    const X = (lng) => (lng - lo0) * s + (W - (lo1 - lo0) * s) / 2, Y = (lat) => H - ((lat - la0) * s + (H - (la1 - la0) * s) / 2);
    const groups = new Map(); for (const p of P2) { const k = p.area; if (!groups.has(k)) groups.set(k, { ...p, items: [] }); groups.get(k).items.push(p); }
    const r = (m) => Math.max(14, (m / 111000) * s);
    const grid = [...Array(9).keys()].map((i) => `<line x1="${(i * W) / 8}" y1="0" x2="${(i * W) / 8}" y2="${H}"/>`).join("") + [...Array(6).keys()].map((i) => `<line x1="0" y1="${(i * H) / 5}" x2="${W}" y2="${(i * H) / 5}"/>`).join("");
    return `<div class="bb-map"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Approximate areas of experiences"><g class="grid">${grid}</g>${[...groups.values()].map((g) => `<g data-area="${esc(g.area)}"><circle class="area${g.area === on ? " on" : ""}" cx="${X(g.lng).toFixed(1)}" cy="${Y(g.lat).toFixed(1)}" r="${r(g.radiusM).toFixed(1)}"/><text x="${X(g.lng).toFixed(1)}" y="${(Y(g.lat) + r(g.radiusM) + 14).toFixed(1)}" text-anchor="middle">${esc(g.area)} · ${g.items.length}</text></g>`).join("")}</svg></div>`;
  }

  // ---- sheet and toast ----
  function sheet(title, html, { onOpen } = {}) {
    const bg = document.createElement("div"); bg.className = "bb-sheet-bg"; bg.innerHTML = `<div class="bb-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="hd"><h2>${esc(title)}</h2><button class="bb-x" type="button" data-close aria-label="Close">${icon("x")}</button></div><div class="bd">${html}</div></div>`;
    const prev = document.activeElement, close = () => { bg.remove(); document.removeEventListener("keydown", k); try { prev?.focus(); } catch {} }, k = (e) => { if (e.key === "Escape") close(); };
    bg.addEventListener("click", (e) => { if (e.target === bg || e.target.closest("[data-close]")) close(); }); document.addEventListener("keydown", k);
    document.body.append(bg); (bg.querySelector("input,select,textarea,button:not([data-close])") || bg.querySelector("[data-close]")).focus(); onOpen?.(bg, close); return { el: bg, close };
  }
  function toast(t) { const el = document.createElement("div"); el.className = "bb-toast"; el.setAttribute("role", "status"); el.textContent = t; document.body.append(el); setTimeout(() => el.remove(), 2600); }

  // ---- saving to a shortlist without committing ----
  let lists = null;
  async function myLists() { if (lists) return lists; if (!/(?:^|;\s*)encore_in=1/.test(document.cookie)) { const e = new Error("Sign in first."); e.status = 401; throw e; } try { lists = (await api("/api/bb/shortlists")).shortlists; } catch (e) { lists = e.status === 401 ? null : []; if (e.status === 401) throw e; } return lists; }
  async function saveTo(handle, pkg, people) {
    let L; try { L = await myLists(); } catch (e) { sheet("Save it for your team", `<p>Sign in with your work email to keep a shortlist your team can vote on. Nothing is booked or charged.</p><div class="ft"><span></span><a class="bb-btn primary" href="/login?next=${encodeURIComponent(location.pathname + location.search)}">Sign in</a></div>`); return null; }
    const key = handle + "/" + pkg;
    if (!L.length) { const r = await api("/api/bb/shortlists", { title: "Team event ideas", people, handle, pkg }); lists = null; toast("Saved to a new shortlist"); return { id: r.id, saved: true }; }
    const cur = L[0], has = cur.keys.includes(key);
    await api(`/api/bb/shortlists/${cur.id}/items`, { handle, pkg, remove: has, ...(people && !cur.people ? { people } : {}) }); lists = null;
    toast(has ? `Removed from ${cur.title}` : `Saved to ${cur.title}`); return { id: cur.id, saved: !has };
  }
  async function savedKeys() { try { const L = await myLists(); return new Set((L[0]?.keys) || []); } catch { return new Set(); } }


  // one signed-out panel for every brand page: what the page is for, sign in, or start a team
  function teamGate(main, { title = "Sign in to your team", lede = "Book trusted local hosts, run each event end to end, and see what came of it." } = {}) {
    const next = encodeURIComponent(location.pathname + location.search);
    main.removeAttribute?.("aria-busy");
    main.innerHTML = `<section class="bb-xhead tg"><p class="bb-kicker">For B2B marketing teams</p><h1>${esc(title)}</h1><p class="bb-lede">${esc(lede)}</p>
      <div class="tg-acts"><a class="bb-btn primary lg" href="/login?next=${next}">Sign in</a><a class="bb-btn lg" href="/signup?mode=work&amp;next=${next}">Start a team, free</a></div>
      <p class="tg-alt">Just looking? <a href="/teams/discover">Browse hosts</a> without an account.</p>
      <ul class="tg-why" aria-label="What teams get"><li><b>Hosts with real followings</b><span>Supper clubs, studios and run clubs people already come back to.</span></li><li><b>Outcomes beyond attendance</b><span>Target accounts in the room, connections, meetings and pipeline.</span></li><li><b>Benchmarks that keep guests private</b><span>Pooled numbers only show with 10 or more people across 3 or more events.</span></li></ul></section>`;
  }
  window.BB = { esc, money, api, icon, top, cover, drawn, card, expandOnClick, chips, gallery, viewer, trustRow, verifyRow, trustedBadge, stars, priceBox, priceLines, termsList, reviews, calendar, legend, map, sheet, toast, saveTo, savedKeys, myLists, hours, native, teamGate, $, $$ };
})();
