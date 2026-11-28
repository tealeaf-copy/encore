// The guided setups a new host meets, one idea a screen (styles: public/dropsetup.css): the "What are you making?"
// chooser, the first-time tutorial on drops, the drop setup in four steps, and "Something to book". Every screen has
// the same bones: back and progress dashes on top, a big headline, one grey line, one visual that teaches by doing (a
// small copy of what guests see, filled in as the host types, with an example before they do), a few large fields, and
// one full-width button at the bottom that says what comes next. Editing a drop is the compact form: steps as tabs,
// Save at the bottom. Fetched by public/drop.js the first time one of these opens.
(function () {
  if (window.EncoreDropSetup) return;
  const K = window.EncoreDrop && window.EncoreDrop._; if (!K) return;
  const { esc, $, $$, api, money, priceIn, I, toast, copy, loadJs, upPhoto, plush } = K;
  const still = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
  const coarse = () => { try { return matchMedia("(pointer:coarse)").matches; } catch { return false; } };
  const P0 = () => window.PLPickup;
  const MAXPH = 4;
  const TIMES = (() => { const T = []; for (let m = 6 * 60; m <= 22 * 60; m += 30) T.push(m); return T; })();
  const tLabel = (m) => { const h = Math.floor(m / 60), mm = m % 60; return `${h % 12 || 12}${mm ? ":" + String(mm).padStart(2, "0") : ""}${h < 12 ? "am" : "pm"}`; };
  const hh = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`, mm = (t) => (/^\d{2}:\d{2}$/.test(t || "") ? +t.slice(0, 2) * 60 + +t.slice(3) : 540);
  const iso = (t) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  const isoToday = () => iso(new Date()), nextSat = () => { const t = new Date(); t.setDate(t.getDate() + ((6 - t.getDay() + 7) % 7 || 7)); return iso(t); };
  const DAYS7 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayLabel = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "");
  const fmtP = (v) => { const n = priceIn(v); return n ? (Math.round(n * 100) % 100 ? n.toFixed(2) : String(Math.round(n))) : String(v || "").replace(/^\s*\$\s*/, "").trim(); };

  // ---- our own small drawings for the examples ----
  const A = (d) => `<svg viewBox="0 0 48 48" aria-hidden="true">${d}</svg>`;
  const ART = {
    cake: A(`<path d="M10 30h28v8H10z" fill="#F4D36F"/><path d="M10 24c0-3 3-5 6-5h16c3 0 6 2 6 5v6H10z" fill="#9DB274"/><path d="M10 27c3 3 6-2 9 1s6-2 9 1 6-3 10 0" fill="none" stroke="#FFFDF8" stroke-width="2" stroke-linecap="round"/><circle cx="24" cy="14" r="3" fill="#EE7F6B"/>`),
    toast: A(`<path d="M12 20c-3-1-4-8 3-9h18c7 1 6 8 3 9v16a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2z" fill="#E9B97A"/><path d="M17 22c2-3 12-3 14 0v10H17z" fill="#F6E3B4"/>`),
    bun: A(`<ellipse cx="24" cy="29" rx="15" ry="9" fill="#DCA382"/><path d="M10 27c1-9 8-13 14-13s13 4 14 13z" fill="#E9B97A"/><path d="M18 20l2 2M24 18l1 3M30 20l-1 2" stroke="#FFFDF8" stroke-width="2" stroke-linecap="round"/>`),
    mug: A(`<path d="M12 16h20v16a6 6 0 0 1-6 6h-8a6 6 0 0 1-6-6z" fill="#8FC3EA"/><path d="M32 20h3a4 4 0 0 1 0 9h-3" fill="none" stroke="#8FC3EA" stroke-width="3"/><path d="M12 22h20" stroke="#FFFDF8" stroke-width="2"/>`),
    vase: A(`<path d="M19 10h10v5c5 4 7 9 7 13 0 6-5 10-12 10s-12-4-12-10c0-4 2-9 7-13z" fill="#A77BAE"/><path d="M14 26c6 3 14 3 20 0" fill="none" stroke="#FFFDF8" stroke-width="2"/>`),
    bowl: A(`<path d="M8 22h32c0 9-7 15-16 15S8 31 8 22z" fill="#F2907C"/><path d="M8 22h32" stroke="#FFFDF8" stroke-width="2"/><path d="M19 37h10v2H19z" fill="#DCA382"/>`),
    flower: A(`<path d="M24 26v14" stroke="#7F9A5A" stroke-width="3" stroke-linecap="round"/><path d="M24 34c-5 0-8-3-8-6 5 0 8 2 8 6z" fill="#9DB274"/><g fill="#F2907C"><circle cx="24" cy="12" r="5"/><circle cx="17" cy="17" r="5"/><circle cx="31" cy="17" r="5"/><circle cx="20" cy="24" r="5"/><circle cx="28" cy="24" r="5"/></g><circle cx="24" cy="18" r="4" fill="#F4D36F"/>`),
    plant: A(`<path d="M16 28h16l-2 11H18z" fill="#DCA382"/><path d="M24 28c0-8-3-13-9-15 0 8 3 13 9 15zM24 28c0-9 3-15 10-17 0 9-3 15-10 17z" fill="#9DB274"/><path d="M24 28V16" stroke="#7F9A5A" stroke-width="2" stroke-linecap="round"/>`),
    wreath: A(`<circle cx="24" cy="24" r="12" fill="none" stroke="#9DB274" stroke-width="7"/><circle cx="24" cy="24" r="12" fill="none" stroke="#7F9A5A" stroke-width="2" stroke-dasharray="3 5"/><path d="M19 33l5 4 5-4-5 9z" fill="#EE7F6B"/>`),
    bag: A(`<path d="M12 18h24l-2 20H14z" fill="#D9D3C7"/><path d="M18 18v-3a6 6 0 0 1 12 0v3" fill="none" stroke="#B9B2A5" stroke-width="2.5"/>`),
  };
  const EX = [
    { who: "a baker", title: "Pandan this Saturday", items: [["cake", "Pandan cake", "18", "#EEF2E0"], ["toast", "Kaya toast box", "9.50", "#FAF0D2"], ["bun", "Coconut buns", "6", "#F8E6DA"]] },
    { who: "a potter", title: "Winter mugs", items: [["mug", "Speckled mug", "32", "#E6F0F8"], ["vase", "Bud vase", "45", "#F1E8F3"], ["bowl", "Ramen bowl", "38", "#FBE6E0"]] },
    { who: "a florist", title: "Friday bunches", items: [["flower", "Market bunch", "28", "#FBE6E0"], ["plant", "Potted fern", "22", "#EEF2E0"], ["wreath", "Door wreath", "40", "#F6F2EA"]] },
  ];
  const tile = (x) => `<span class="ds-tile${x.pop ? " pop" : ""}"><span class="ds-tp"${x.bg ? ` style="background:${x.bg}"` : ""}>${x.img ? `<img src="${esc(x.img)}" alt="">` : x.art || ART.bag}</span><b>${x.name ? esc(x.name) : `<i class="ds-bar"></i>`}</b><small>${x.price ? esc(x.price) : `<i class="ds-bar s"></i>`}</small></span>`;
  const tiles = (L) => `<span class="ds-tiles">${L.slice(0, 3).map(tile).join("")}</span>`;
  // step 2's copy of the order page: a row an item, as guests see them, with the name, how many are left and the price
  const row = (x) => `<span class="ds-li${x.pop ? " pop" : ""}"><span class="ds-tp"${x.bg ? ` style="background:${x.bg}"` : ""}>${x.img ? `<img src="${esc(x.img)}" alt="">` : x.art || ART.bag}</span><span class="ds-ln"><b>${x.name ? esc(x.name) : `<i class="ds-bar"></i>`}</b>${x.left ? `<small>${esc(x.left)}</small>` : ""}</span><b class="ds-lp">${x.price ? esc(x.price) : `<i class="ds-bar s"></i>`}</b></span>`;
  const rows = (L) => `<span class="ds-lis">${L.slice(0, 2).map(row).join("")}</span>${L.length > 2 ? `<span class="ds-hint">and ${L.length - 2} more</span>` : ""}`;
  const exRows = (i) => rows(EX[i].items.map(([a, name, p, bg], k) => ({ art: ART[a], name, price: money(+p), bg, left: k ? "" : "12 of 12 left" })));
  const exTiles = (i) => tiles(EX[i].items.map(([a, name, p, bg]) => ({ art: ART[a], name, price: money(+p), bg })));
  const av = (t, bg) => `<i class="ds-av" style="background:${bg}">${t}</i>`;
  const fl = (ic, b, sm) => `<span class="ds-fl"><i>${ic}</i><span><b>${b}</b>${sm ? `<small>${sm}</small>` : ""}</span></span>`;
  const check = `<svg viewBox="0 0 20 20" fill="none" stroke="#245A38" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4.5 10.5 3.5 3.5 7.5-8"/></svg>`;

  // ---- the screen: one dialog whose top, pane and foot are redrawn in place, so a step never flashes the page behind ----
  function shell({ label, compact = false, tint = "" }) {
    const old = $("#dpSheet"), keep = old?.__prev; if (old) { old.__key && document.removeEventListener("keydown", old.__key); old.remove(); }
    const bg = document.createElement("div"); bg.id = "dpSheet"; bg.className = "ds-bg pl-fun" + (old ? " ds-again" : "") + (compact ? " ds-compact" : ""); if (tint) bg.dataset.funTint = tint;
    bg.innerHTML = `<div class="ds" role="dialog" aria-modal="true" aria-label="${esc(label)}" tabindex="-1"><div class="ds-top"></div><div class="ds-tabsw"></div><div class="ds-scroll"><div class="ds-pane"></div></div><div class="ds-ft"></div></div>`;
    document.body.appendChild(bg); const prev = (keep && keep !== document.body && keep.isConnected ? keep : null) || document.activeElement; bg.__prev = prev; document.documentElement.style.overflow = "hidden";
    const S = { bg, el: $(".ds", bg), top: $(".ds-top", bg), tabs: $(".ds-tabsw", bg), scroll: $(".ds-scroll", bg), pane: $(".ds-pane", bg), ft: $(".ds-ft", bg), onDismiss: null };
    S.close = () => { bg.remove(); document.documentElement.style.overflow = ""; document.removeEventListener("keydown", key); try { prev?.focus?.(); } catch {} };
    S.dismiss = () => { S.close(); S.onDismiss?.(); };
    const key = (e) => { if (e.key !== "Escape" || !bg.isConnected || $("#dpSheet") !== bg) return; const m = $(".ds-menu-bg", bg); if (m) return m.remove(); S.dismiss(); };
    bg.__key = key; document.addEventListener("keydown", key); bg.addEventListener("mousedown", (e) => { if (e.target === bg) S.dismiss(); });
    /** Draw a screen. dir: 1 forward, -1 back (a 160ms slide), 0 the same screen again (scroll stays). */
    S.set = ({ top, tabs = "", pane, foot, dir = 0, first = false }) => { const y = S.scroll.scrollTop; S.top.innerHTML = top; S.tabs.innerHTML = tabs; S.pane.innerHTML = pane; S.ft.innerHTML = foot;
      S.pane.classList.remove("ds-fwd", "ds-bwd"); if (dir) { void S.pane.offsetWidth; S.pane.classList.add(dir > 0 ? "ds-fwd" : "ds-bwd"); S.scroll.scrollTop = 0; } else if (!first) S.scroll.scrollTop = y;
      if (dir || first) setTimeout(() => { if (!bg.isConnected) return; const t = matchMedia("(pointer:fine)").matches ? $(".ds-rb", bg) : S.el; t?.focus({ preventScroll: true }); }, 30); };
    return S; }
  const topBar = (n, of, first, label) => `<button type="button" class="ds-rb" id="dpBack" aria-label="${first ? "Close" : "Back"}">${first ? I.x : I.back}</button>${of ? `<div class="ds-dash" role="img" aria-label="${esc(label || "Step")} ${n} of ${of}">${Array.from({ length: of }, (_, i) => `<i class="${i + 1 === n ? "on" : ""}"></i>`).join("")}</div>` : `<span></span>`}<span></span>`;
  const toggle = (label, cur, L, cls = "") => `<div class="ds-tog ${cls}" role="radiogroup" aria-label="${esc(label)}">${L.map(([v, t, ic]) => `<button type="button" role="radio" aria-checked="${v === cur}" tabindex="${v === cur ? 0 : -1}" data-tog="${v}">${ic || ""}<span>${esc(t)}</span></button>`).join("")}</div>`;
  // arrow keys move a choice, as radios do
  const togKeys = (S) => S.bg.addEventListener("keydown", (e) => { const b = e.target.closest?.("[data-tog]"); if (!b || !/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return; e.preventDefault(); const L = $$("[data-tog]", b.parentNode), n = L[(L.indexOf(b) + (/Left|Up/.test(e.key) ? -1 : 1) + L.length) % L.length]; n.click(); setTimeout(() => $(`[data-tog="${n.dataset.tog}"]`, S.bg)?.focus(), 0); });
  const visWrap = (inner, { ex = "", exBtn = false, cls = "" } = {}) => `<div class="ds-visw ${cls}"><span class="ds-potto" aria-hidden="true"><span id="dsPotto"></span></span><div class="ds-vis" id="dsVis">${visIn(inner, ex, exBtn)}</div></div>`;
  const visIn = (inner, ex, exBtn) => `${ex ? (exBtn ? `<button type="button" class="ds-ex" id="dsExN" aria-label="${esc(ex)}. See another example"><span>${esc(ex)}${I.chev}</span></button>` : `<span class="ds-ex">${esc(ex)}</span>`) : ""}${inner}`;
  const potto = (S, wear) => plush($("#dsPotto", S.bg), { size: 64, wear, tap: false }).catch(() => null);
  /** A small menu inside the screen. opts: [[icon, label, fn]] */
  function menu(S, title, opts) { const m = document.createElement("div"); m.className = "ds-menu-bg";
    m.innerHTML = `<div class="ds-menu" role="dialog" aria-label="${esc(title)}"><p>${esc(title)}</p>${opts.map(([ic, t], i) => `<button type="button" data-m="${i}">${ic}<span>${esc(t)}</span></button>`).join("")}<button type="button" class="q" data-m="x">Cancel</button></div>`;
    S.el.appendChild(m); m.addEventListener("click", (e) => { const b = e.target.closest("[data-m]"); if (!b && e.target !== m) return; m.remove(); if (b && b.dataset.m !== "x") opts[+b.dataset.m][2](); }); setTimeout(() => $("button", m)?.focus(), 30); }

  // ================= the first-time tutorial: what a drop is, in four cards =================
  const payVis = (mode, amt, name, paid) => `<span class="ds-ph"><b class="t">Order placed</b><span class="ds-ol"><span>2 × ${esc(name)}</span><b>${esc(amt)}</b></span>${mode === "pickup" ? `<span class="ds-pl">${I.bag}<span><b>Pay ${esc(amt)} at pickup</b></span></span><span class="s">Cash or a tap when they collect.</span>` : paid ? `<span class="ds-fakeb done ds-pop">${check}<span>Paid. Thanks!</span></span><span class="ds-hint">You see it in Orders.</span>` : `<button type="button" class="ds-fakeb" data-vpay>Pay ${esc(amt)}</button>${mode === "either" ? `<span class="ds-fakeb q">I'll pay at pickup</span>` : `<span class="ds-hint">Venmo, PayPal or Cash App</span>`}`}</span>`;
  function tour(o = {}) { const S = shell({ label: "How drops work", tint: "butter" }); let n = 1, left = 6, pick = -1, mode = "ahead", paid = false, pm = null; togKeys(S);
    const seen = () => { try { localStorage.setItem("pl.dropTour", "1"); } catch {} api("/api/host/drop-tour", {}).catch(() => {}); };
    const C = [["Sell what<br>you make", "A drop is a small sale you run yourself. People order ahead, then come pick up."], ["Set your<br>batch", "A batch is how many you're making this time. When they're gone, orders stop, so you never oversell."],
      ["Pickup times<br>you choose", "Say when you'll be there. Guests pick a time, and only they get your exact spot."], ["Get paid<br>your way", "Take Venmo, PayPal or Cash App ahead, or cash at pickup. The money goes straight to you."]];
    const vis = () => n === 1 ? `<span class="ds-ph"><b class="t">Pandan this Saturday</b><span class="ds-flow ds-seq">${fl(ART.cake, "You post Pandan cake, $18", "With a photo and a price")}${fl(av("L", "#F6EBC4"), "Lan orders 2 ahead", "You see it in Orders")}${fl(check, "Lan picks up Sat 9am", "Made to order, nothing wasted")}</span></span>`
      : n === 2 ? `<span class="ds-ph"><b class="t">Coconut buns</b><span class="s">${left ? `${left} left of 6` : "Sold out"}</span><span class="ds-dots">${Array.from({ length: 6 }, (_, i) => `<span class="${i >= left ? "gone" : ""}">${ART.bun}</span>`).join("")}</span>${left ? `<button type="button" class="ds-fakeb" data-tord>Take an order</button>` : `<button type="button" class="ds-fakeb q" data-tord>Start a new batch</button>`}<span class="ds-hint">${left ? "Tap it, as if a guest ordered." : "All gone. Orders stop by themselves."}</span></span>`
      : n === 3 ? `<span class="ds-ph"><b class="t">Pick a pickup time</b><span class="ds-chips">${["Sat 9 to 10am", "Sat 11am to 12pm"].map((t, i) => `<button type="button" class="ds-chip" data-tpick="${i}" aria-pressed="${i === pick}">${t}</button>`).join("")}</span><span class="ds-pl">${I.pin}<span>Greenpoint</span></span>${pick < 0 ? `<span class="ds-pl g">${I.lock}<span>Tap a time, as a guest would.</span></span>` : `<span class="ds-pl ds-pop">${I.lock}<span><b>12 Kent St, Apt 3</b><br>Sent to Lan the day before.</span></span>`}</span>`
      : payVis(mode, "$36", "Pandan cake", paid);
    const draw = (dir, first) => { const last = n === C.length;
      S.set({ dir, first, top: topBar(n, C.length, n === 1, "Card"), pane: `<h2 class="ds-h" id="dsH">${C[n - 1][0]}</h2><p class="ds-sub">${C[n - 1][1]}</p>${n === 4 ? toggle("How a guest pays", mode, [["ahead", "Pay ahead"], ["pickup", "At pickup"]]) : ""}${visWrap(vis(), { ex: "Example", cls: "ds-tall" })}`,
        foot: `<button type="button" class="ds-go" id="dsNext">${last ? (o.then ? (o.again ? "Back to my drop" : "Start my drop") : "Got it") : "Next"}</button><button type="button" class="ds-link" id="dsSkip"${last ? ` style="visibility:hidden" tabindex="-1" aria-hidden="true"` : ""}>Skip</button>` });
      potto(S, ["apron"]).then((m) => (pm = m)); };
    const re = () => { $("#dsVis", S.bg).innerHTML = visIn(vis(), "Example"); };
    const done = () => { seen(); if (o.then) o.then(); else S.close(); };
    S.onDismiss = () => { seen(); o.closed?.(); };
    S.bg.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return;
      if (b.id === "dpBack") { if (n === 1) return S.dismiss(); n--; return draw(-1); }
      if (b.id === "dsNext") { if (n === C.length) return done(); n++; return draw(1); }
      if (b.id === "dsSkip") return done();
      if (b.hasAttribute("data-tord")) { left = left ? left - 1 : 6; pm?.react(left ? "hop" : "pop"); return re(); }
      if (b.dataset.tpick) { pick = +b.dataset.tpick; pm?.react("hop"); return re(); }
      if (b.hasAttribute("data-vpay")) { paid = true; pm?.react("hop"); return re(); }
      if (b.dataset.tog) { mode = b.dataset.tog; paid = false; $$("[data-tog]", S.bg).forEach((x) => { x.setAttribute("aria-checked", String(x === b)); x.tabIndex = x === b ? 0 : -1; }); return re(); } });
    draw(0, true); }

  // ================= the drop setup =================
  // A drop asks only drop questions: photos, items and prices, how many, pickup times (a date and a time each, or the
  // same times every week), the neighborhood, the exact spot (private), when orders close, an allergen note and how
  // people pay. Never an event's date, guest list, plus-ones, bring list or questions.
  async function setup(opts = {}) {
    let D, firstTime = false; const edit = !!opts.drop;
    if (edit) D = JSON.parse(JSON.stringify(opts.drop));
    else { let L = null; try { const j = await api("/api/host/drops"); L = j.legacy; firstTime = !!j.tour; } catch {}
      // a shop set up before drops (never converted: no priced item yet) prefills what the host already typed
      D = { title: L?.title || "", note: L?.note || "", items: (L?.items || []).length ? L.items.map((x) => ({ ...x, price: x.price ? String(x.price) : "", photos: x.photo ? [x.photo] : [] })) : [], windows: [], area: L?.area || "", address: L?.address || "", pay: "ahead", payUrl: L?.payUrl || "", open: true, allergens: "", ...(opts.prefill || {}) }; }
    if (D.pay === "link") D.pay = "ahead"; // a pay link was paying ahead (server/droppay.js)
    D.items = (D.items || []).map((x) => ({ ...x, price: x.price ? fmtP(x.price) : "", stock: +x.stock ? String(x.stock) : "", photos: (x.photos || []).length ? x.photos.slice(0, MAXPH) : x.photo ? [x.photo] : [] }));
    D.weekly = (D.windows || []).length ? D.windows.every((w) => !w.date) : !!(edit && D.always);
    if (!(D.windows || []).length) D.windows = (D.slots || []).length && P0() ? P0().windowsOf({ slots: D.slots, date: D.date, always: D.always }).filter((w) => w.start).map((w) => ({ date: w.date, day: w.day, start: w.start, end: w.end })) : [];
    if (!D.windows.length) D.windows = [{ date: nextSat(), day: "Sat", start: "09:00", end: "10:00" }];
    let step = 1, S, pm = null, exI = 0, undo = null, undoT = 0, sel3 = 0, paid4 = false, made = false, touched3 = false, slotFor = null, drag = null; const fresh = new Set();
    const LAST = 4, TABS = ["Photos", "Items", "Pickup", "Payment"];
    const HEAD = { 1: ["Show what you're making", "People order what they can see. Add a photo for each thing you sell."], 2: ["What's for sale?", "Name each thing, give it a price, and say how many you're making this time."],
      3: ["When do they pick up?", "Choose the times you'll be there. Guests pick one when they order."], 4: ["How do people pay?", "The money goes straight to you. Choose when guests pay."] };
    const NEXT = { 1: "Next: name and price", 2: "Next: pickup times", 3: "Next: getting paid", 4: "Open for orders" };
    const PAYSAY = { ahead: "After ordering, they get your Venmo, PayPal or Cash App with the amount filled in.", either: "They choose. Reminders go only to people who haven't paid or picked pickup.", pickup: "Cash or a tap when they collect. Nothing to set up." };
    const allPhotos = () => D.items.flatMap((x) => x.photos || []);
    const real = () => D.items.filter((x) => x.name || x.price || (x.photos || []).length);
    const itemName = (x, i) => x.name || ["First item", "Second item", "Third item"][i] || `Item ${i + 1}`;
    const body = () => $("#dsBody", S.bg);
    const pull = () => { if (!S) return; const b = body(); if (!b) return;
      if (step === 2) D.items = $$(".dp-item", b).map((el, i) => ({ ...D.items[i], name: $("[data-n]", el).value.trim(), price: $("[data-p]", el).value.trim(), stock: $("[data-s]", el).value.replace(/\D/g, "") }));
      if (step === 3) { D.windows = $$(".dp-wrow", b).map((el) => ({ ...(D.weekly ? { day: $("[data-wd]", el).value, date: "" } : { date: $("[data-wdt]", el).value, day: "" }), start: hh(+$("[data-wa]", el).value), end: hh(+$("[data-wz]", el).value) }));
        D.area = $("#dpArea", b).value.trim(); D.address = $("#dpAddr", b).value.trim(); D.orderByDate = $("#dpByD", b)?.value || ""; D.orderByTime = $("#dpByT", b)?.value || ""; D.windowCap = +$("#dpCap", b)?.value || 0; }
      if (step === 4) { D.payUrl = $("#dpPayUrl", b)?.value.trim() || ""; D.note = $("#dpNote", b)?.value.trim() ?? D.note; D.allergens = $("#dpAlg", b)?.value.trim() ?? D.allergens; D.title = $("#dpTitle", b)?.value.trim() ?? D.title; } };
    const err = (t, el) => { const e = $("#dpErr", S.bg); if (e) e.textContent = t; if (el) { const d = el.closest("details"); if (d) d.open = true; el.setAttribute("aria-invalid", "true"); el.focus(); } return false; };
    const check1 = () => { pull(); $$("[aria-invalid]", S.bg).forEach((x) => x.removeAttribute("aria-invalid")); const b = body();
      if (step === 2) { const rows = $$(".dp-item", b), filled = D.items.map((x, i) => [x, rows[i]]).filter(([x]) => x.name || x.price || (x.photos || []).length);
        if (!filled.length) return err("Add at least one thing you're making.", rows[0] ? $("[data-n]", rows[0]) : null);
        for (const [x, el] of filled) { if (!x.name) return err("Give this item a name.", $("[data-n]", el)); if (!priceIn(x.price)) return err(x.price ? `Check the price for ${x.name}. Use a number like 12 or 12.50.` : `Add a price for ${x.name}.`, $("[data-p]", el)); } }
      if (step === 3) { if (!D.windows.length) return err("Add a pickup time.", $("#dpAddWin", b));
        for (const [i, w] of D.windows.entries()) { const row = $$(".dp-wrow", b)[i]; if (!D.weekly && !w.date) return err("Pick a day for each pickup time.", $("[data-wdt]", row)); if (mm(w.end) <= mm(w.start)) return err("The end time comes after the start.", $("[data-wz]", row)); }
        if (!D.area) return err("Add the neighborhood people see.", $("#dpArea", b)); }
      if (step === 4 && D.pay !== "pickup" && D.payUrl && !/^https:\/\/\S{3,}/i.test(D.payUrl)) return err("Pay links start with https://. Or leave it empty to use your Get paid methods.", $("#dpPayUrl", b));
      return true; };
    const toBody = () => ({ ...D, items: D.items.filter((x) => x.name || x.price).map((x) => ({ ...x, price: priceIn(x.price), stock: +x.stock || 0, photo: (x.photos || [])[0] || "", photos: x.photos || [] })), windows: D.windows.map((w) => (D.weekly ? { day: w.day, start: w.start, end: w.end } : { date: w.date, start: w.start, end: w.end })) });
    const coverHTML = () => { const u = D.coverPhoto || allPhotos()[0]; if (u) return `<img src="${esc(u)}" alt="Cover">`; try { const E = window.EventArt; if (E) { E.ensureCss?.(); return E.cover({ title: D.title || "Bake", activity: "bake", coverArt: D.coverArt || null }, { title: "", label: "" }); } } catch {} return ""; };
    const winLabels = () => D.windows.map((w) => { const x = D.weekly ? { day: w.day || "Sat", start: w.start, end: w.end } : { date: w.date, start: w.start, end: w.end }; try { return P0().label(x) || ""; } catch { return ""; } }).filter(Boolean);

    // ---- the teaching visual: a small copy of the order page, filled from what they've typed so far ----
    const exOn = () => (step <= 2 ? !real().length : step === 3 ? !edit && !touched3 && !D.area : false);
    const visInner = () => { const R = real(), ex = exOn();
      if (step <= 2) { if (ex) return step === 2 ? `<span class="ds-ph"><b class="t">${EX[exI].title}</b>${exRows(exI)}</span>` : `<span class="ds-ph"><b class="t">${EX[exI].title}</b><span class="s">Pickup Sat 9 to 10am</span>${exTiles(exI)}</span>`;
        if (step === 2) return `<span class="ds-ph"><b class="t">${esc(D.title || "Your drop")}</b>${rows(R.map((x) => ({ img: (x.photos || [])[0], name: x.name, price: priceIn(x.price) ? money(priceIn(x.price)) : "", left: +x.stock ? `${+x.stock} of ${+x.stock} left` : "", pop: fresh.has((x.photos || [])[0]) })))}</span>`;
        return `<span class="ds-ph"><b class="t">${esc(D.title || "Your drop")}</b><span class="s">${allPhotos().length} photo${allPhotos().length === 1 ? "" : "s"}${R.length > 3 ? ", 3 shown" : ""}. Names and prices come next.</span>${tiles(R.map((x) => ({ img: (x.photos || [])[0], name: "", price: "", pop: fresh.has((x.photos || [])[0]) })))}</span>`; }
      if (step === 3) { const A = winLabels(), W = A.slice(0, 2); sel3 = Math.min(sel3, Math.max(0, W.length - 1));
        return `<span class="ds-ph"><b class="t">Pick a pickup time</b><span class="ds-pl">${I.pin}<span>${esc(D.area || (ex ? "Greenpoint" : "Your neighborhood"))}</span></span><span class="ds-chips">${W.map((l, i) => `<button type="button" class="ds-chip" data-vchip="${i}" aria-pressed="${i === sel3}">${esc(l)}</button>`).join("")}</span>${A.length > 2 ? `<span class="ds-hint">and ${A.length - 2} more</span>` : ""}</span>`; }
      const it = R.find((x) => priceIn(x.price)) || { name: "Pandan cake", price: "18" }; return payVis(D.pay, money(priceIn(it.price) * 2), it.name || "Pandan cake", paid4); };
    const exLabel = () => (!exOn() ? "" : step <= 2 ? `Example: ${EX[exI].who}` : "Example");
    const sayText = () => (step === 3 ? (() => { const l = winLabels()[sel3]; return l ? `A guest who picks ${l} gets ${D.address ? "your exact spot" : "the exact spot, if you add one,"} the day before.` : "Add a time and it shows here."; })() : step === 4 ? PAYSAY[D.pay] : "");
    // the visual is only redrawn when it would differ: a tap on one of its chips must never land on a chip that was just replaced
    const paintVis = () => { const v = $("#dsVis", S.bg); if (!v) return; const h = visIn(visInner(), exLabel(), step <= 2); if (v.__h !== h) { v.innerHTML = h; v.__h = h; } };
    const refresh = () => { pull(); paintVis(); const s = $("#dsSay", S.bg); if (s && s.textContent !== sayText()) s.textContent = sayText();
      if (step === 2) $$(".dp-item [data-ih]", S.bg).forEach((h, i) => { const t = itemName(D.items[i] || {}, i); if (h.textContent !== t) h.textContent = t; }); };

    // ---- the fields ----
    const dateCtl = (attr, v, empty) => `<span class="ds-date"><b>${esc(v ? dayLabel(v) : empty)}</b><input type="date" ${attr} value="${esc(v || "")}" min="${isoToday()}" data-empty="${esc(empty)}"></span>`;
    const timeSel = (a, cur) => `<select ${a}>${TIMES.map((m) => `<option value="${m}"${m === mm(cur) ? " selected" : ""}>${tLabel(m)}</option>`).join("")}</select>`;
    const thumbs = (x, i) => `<div class="dp-thumbs" data-ti="${i}" aria-label="Photos of ${esc(itemName(x, i))}">${(x.photos || []).map((u, k) => `<div class="dp-th" draggable="true" data-pi="${i}" data-pk="${k}">${k ? "" : `<span class="main">Main</span>`}<img src="${esc(u)}" alt="${esc(x.name || "Item")} photo ${k + 1}"><button type="button" data-prm="${i}:${k}" aria-label="Remove photo ${k + 1}">${I.x}</button>${k ? `<button type="button" data-pmv="${i}:${k}" aria-label="Move photo ${k + 1} earlier">${I.back}</button>` : ""}</div>`).join("")}
      ${(x.photos || []).length < MAXPH ? `<button type="button" class="dp-addph" data-slot="${i}" data-more="1">${I.camera}<span>Add photo</span></button>` : ""}</div>`;
    const cover = () => `<p class="ds-lab" style="margin:0 0 4px">Cover</p><p class="ds-help" style="margin:0 0 10px">The picture at the top of your drop. We use your first photo unless you pick one.</p><div class="dp-cov" id="dpCov">${coverHTML()}<button type="button" class="dp-b sm" id="dpCovBtn">${I.edit}<span>${D.coverPhoto || D.coverArt ? "Change cover" : "Choose a cover"}</span></button></div>`;
    const fields = () => { const n = allPhotos().length, open = edit ? " open" : "";
      if (step === 1) return `<input type="file" accept="image/*" multiple id="dpZoneIn" class="ds-vh" tabindex="-1" aria-label="Choose photos"><input type="file" accept="image/*" capture="environment" id="dpCamIn" class="ds-vh" tabindex="-1" aria-label="Take a photo">
        ${edit && n ? `<div class="dp-thumbs">${allPhotos().map((u) => `<div class="dp-th"><img src="${esc(u)}" alt=""></div>`).join("")}</div>` : ""}
        ${n || edit ? `${edit ? "" : `<p class="ds-made">${n} photo${n === 1 ? "" : "s"} added. You name and price ${n === 1 ? "it" : "them"} next.</p>`}<button type="button" class="ds-sec" id="dpZone">${I.camera}<span>${n ? "Add more photos" : "Add photos of what you're making"}</span></button>` : ""}
        ${edit ? cover() : `<details class="ds-more"><summary>More options</summary><div>${cover()}</div></details><p class="ds-c"><button type="button" class="ds-link" id="dsHow">How drops work</button></p>
        <p class="ds-note">${n ? "You can add or change photos any time." : "No photos yet? You can add them later, but drops with photos get more orders."}</p>`}`;
      if (step === 2) { if (!D.items.length) D.items.push({ name: "", price: "", stock: "", photos: [] }); const N = D.items.length;
        return `${made && !edit ? `<p class="ds-made">We made one item for each photo.</p>` : ""}${D.items.map((x, i) => { const ph = (x.photos || [])[0], nm = itemName(x, i);
          return `<div class="ds-card dp-item" data-i="${i}"><div class="ds-ihd"><b data-ih>${esc(nm)}</b>${N > 1 ? `<button type="button" class="ds-ib up" data-mv="${i}:-1" aria-label="Move ${esc(nm)} up"${i ? "" : " disabled"}>${I.back}</button><button type="button" class="ds-ib dn" data-mv="${i}:1" aria-label="Move ${esc(nm)} down"${i < N - 1 ? "" : " disabled"}>${I.back}</button><button type="button" class="ds-ib" data-rm="${i}" aria-label="Remove ${esc(nm)}">${I.trash}</button>` : ""}</div>
          ${ph ? `<div class="ds-shot"><img src="${esc(ph)}" alt="Photo of ${esc(nm)}"><span class="ds-sa"><button type="button" class="ds-sm" data-slot="${i}" data-rep="1">${I.camera}<span>Replace</span></button><button type="button" class="ds-sm" data-prm="${i}:0">Remove</button></span></div>` : `<button type="button" class="ds-slot" data-slot="${i}">${I.camera}<span>Add a photo</span></button>`}
          <label class="ds-f"><span>Name</span><input data-n value="${esc(x.name)}" maxlength="60" placeholder="${["Pandan honeycomb cake", "Kaya toast box"][i] || "Another thing you make"}" autocomplete="off"></label>
          <div class="ds-row"><label class="ds-f"><span>Price</span><span class="ds-money"><b aria-hidden="true">$</b><input data-p value="${esc(x.price)}" inputmode="decimal" placeholder="${["18", "9.50"][i] || "12"}" aria-label="Price in dollars" autocomplete="off"></span></label>
          <label class="ds-f"><span>How many are you making?</span><input data-s value="${esc(x.stock)}" inputmode="numeric" pattern="[0-9]*" placeholder="No limit" autocomplete="off"></label></div><p class="ds-help">Leave empty for no limit. We stop orders when they're gone.</p>
          ${ph ? `<details class="ds-more"><summary>More photos (${x.photos.length} of ${MAXPH})</summary><div>${thumbs(x, i)}<p class="ds-help">The first photo is the one guests see first. Drag to reorder.</p></div></details>` : ""}</div>`; }).join("")}
        <input type="file" accept="image/*" id="dpItemIn" class="ds-vh" tabindex="-1" aria-label="Choose a photo"><input type="file" accept="image/*" capture="environment" id="dpItemCam" class="ds-vh" tabindex="-1" aria-label="Take a photo">
        ${N < 12 ? `<button type="button" class="ds-sec" id="dpAdd">${I.plus}<span>Add another item</span></button>` : ""}${edit ? "" : `<p class="ds-note">You can change names and prices any time.</p>`}`; }
      if (step === 3) { const wk = !!D.weekly, N = D.windows.length;
        return `<div id="dpWins">${D.windows.map((w, i) => `<div class="ds-wrow dp-wrow${N > 1 ? " rm" : ""}" data-w="${i}">${wk ? `<label class="ds-f"><span>Day</span><select data-wd>${DAYS7.map((d0) => `<option${(w.day || "Sat") === d0 ? " selected" : ""}>${d0}</option>`).join("")}</select></label>` : `<label class="ds-f"><span>Day</span>${dateCtl("data-wdt", w.date, "Pick a day")}</label>`}
          <label class="ds-f"><span>From</span>${timeSel("data-wa", w.start)}</label><label class="ds-f"><span>To</span>${timeSel("data-wz", w.end || hh(mm(w.start) + 60))}</label>${N > 1 ? `<button type="button" class="ds-ib" data-wrm="${i}" aria-label="Remove this time">${I.x}</button>` : ""}</div>`).join("")}</div>
        ${N < 8 ? `<button type="button" class="ds-sec" id="dpAddWin">${I.plus}<span>Add another time</span></button>` : ""}
        <label class="ds-f"><span>Neighborhood people see</span><input id="dpArea" value="${esc(D.area)}" maxlength="80" placeholder="Greenpoint" autocomplete="off"><small>Everyone sees this, so they know roughly where to come.</small></label>
        <label class="ds-f"><span>Exact pickup spot <small>(optional)</small></span><input id="dpAddr" value="${esc(D.address)}" maxlength="160" placeholder="12 Kent St, Apt 3" autocomplete="off"><small>Private. Only people who ordered get it, the day before pickup.</small></label>
        <details class="ds-more"${open}><summary>More options</summary><div><label class="ds-f"><span>Orders for each time <small>(optional)</small></span><input id="dpCap" inputmode="numeric" pattern="[0-9]*" value="${+D.windowCap || ""}" placeholder="No limit"><small>So pickups don't bunch up. A full time can't be picked.</small></label>
        <div class="ds-2"><label class="ds-f"><span>Orders close <small>(optional)</small></span>${dateCtl('id="dpByD"', D.orderByDate, "No cutoff")}</label><label class="ds-f"><span>At</span><select id="dpByT"><option value="">End of day</option>${TIMES.map((m) => `<option value="${hh(m)}"${hh(m) === D.orderByTime ? " selected" : ""}>${tLabel(m)}</option>`).join("")}</select></label></div>
        <p class="ds-help" style="margin:-8px 0 12px">Stop taking orders early, so you know how much to make.${D.orderByDate ? ` <button type="button" class="ds-link" id="dpByX" style="min-height:44px;padding:0 4px">Clear</button>` : ""}</p></div></details>${edit ? "" : `<p class="ds-note">You can change times any time.</p>`}`; }
      return `<div id="dpPayM" ${D.pay === "pickup" ? "hidden" : ""}></div>
        <details class="ds-more"${open}><summary>More options</summary><div><label class="ds-f" id="dpPayL" ${D.pay === "pickup" ? "hidden" : ""}><span>Your own pay link <small>(optional)</small></span><input id="dpPayUrl" type="url" inputmode="url" value="${esc(D.payUrl)}" placeholder="https://buy.stripe.com/..." autocomplete="off"><small>Have a Stripe or Square link? Guests pay there. Leave it empty to use the ways you get paid above.</small></label>
        <label class="ds-f"><span>Allergens <small>(optional)</small></span><input id="dpAlg" value="${esc(D.allergens || "")}" maxlength="200" placeholder="Contains egg, coconut and wheat"><small>Shown to everyone on the order page, before they order.</small></label>
        <label class="ds-f"><span>A line about it <small>(optional)</small></span><textarea id="dpNote" rows="2" maxlength="240" placeholder="Baked Saturday morning, still warm at pickup.">${esc(D.note)}</textarea><small>Sits under the name. One sentence is plenty.</small></label>
        <label class="ds-f"><span>Name this drop <small>(optional)</small></span><input id="dpTitle" value="${esc(D.title)}" maxlength="80" placeholder="Pandan this Saturday"><small>The headline guests see. Leave it empty and we use your first item.</small></label></div></details>${edit ? "" : `<p class="ds-note">You can pause orders or change anything later.</p>`}`; };
    const togHTML = () => (step === 3 ? toggle("How often", D.weekly ? "weekly" : "date", [["date", "On a date"], ["weekly", "Every week"]]) : step === 4 ? toggle("When guests pay", D.pay || "ahead", [["ahead", "Pay ahead"], ["either", "Either"], ["pickup", "At pickup"]]) : "");
    const footHTML = () => { const undoBar = undo ? `<p class="ds-undo" role="status"><span>${esc(undo.text)}</span><button type="button" id="dsUndo">Undo</button></p>` : "", e = `<p class="ds-err" id="dpErr" role="alert"></p>`;
      if (edit) return `${undoBar}${e}<button type="button" class="ds-go" id="dpSave">Save</button>`;
      if (step === 1 && !allPhotos().length) return `${e}<button type="button" class="ds-go" id="dpZone">${I.camera}<span>Add photos</span></button><button type="button" class="ds-link" id="dpNext">Skip for now</button>`;
      return `${undoBar}${e}<button type="button" class="ds-go" id="dpNext">${NEXT[step]}</button>`; };
    /** dir: 1 or -1 a new step, 0 the same step again (the fields and the visual only: the headline and Potto stay). */
    function draw(dir = 0, first = false) {
      const same = !dir && !first && $("#dsBody", S.bg);
      if (same) { same.innerHTML = fields(); const t = $(".ds-tog", S.bg); if (t) t.outerHTML = togHTML(); S.ft.innerHTML = footHTML(); paintVis(); const s = $("#dsSay", S.bg); if (s) s.textContent = sayText(); }
      else S.set({ dir, first, top: edit ? `<button type="button" class="ds-rb" id="dpBack" aria-label="Close">${I.x}</button><p class="ds-et">Edit your drop</p><span></span>` : topBar(step, LAST, step === 1),
        tabs: edit ? `<div class="ds-tabs" role="tablist" aria-label="Parts of your drop">${TABS.map((t, i) => `<button type="button" role="tab" aria-selected="${i + 1 === step}" data-tab="${i + 1}">${t}</button>`).join("")}</div>` : "",
        pane: edit ? `${togHTML()}${step >= 3 ? `<p class="ds-help" id="dsSay" style="margin:-8px 0 16px" aria-live="polite">${step === 4 ? esc(sayText()) : ""}</p>` : ""}<div class="ds-body" id="dsBody">${fields()}</div>`
          : `<h2 class="ds-h" id="dsH">${HEAD[step][0]}</h2><p class="ds-sub">${HEAD[step][1]}</p>${togHTML()}${visWrap(visInner(), { ex: exLabel(), exBtn: step <= 2, cls: step === 2 ? "ds-s2" : "" })}${step >= 3 ? `<p class="ds-say" id="dsSay" aria-live="polite">${esc(sayText())}</p>` : ""}<div class="ds-body" id="dsBody">${fields()}</div>`, foot: footHTML() });
      if (!same && !edit) { pm = null; potto(S, ["apron"]).then((m) => (pm = m)); paintVis(); }
      fresh.clear();
      // ---- Get paid (public/paymethods.js): "Guests pay you through" the host's profile methods, Change opens a small sheet ----
      if (step === 4 && $("#dpPayM", S.bg)) { const pmr = () => { const P = window.PayMethods, el = $("#dpPayM", S.bg); if (P && el) P.dropRow(el); }; if (window.PayMethods) pmr(); else loadJs("/paymethods.js", pmr); } }
    const go = (n, dir) => { step = n; undo = null; draw(dir); };
    const setUndo = (text, items) => { undo = { text, items }; clearTimeout(undoT); undoT = setTimeout(() => { undo = null; $(".ds-undo", S?.bg)?.remove(); }, 9000); };
    // photos: many at once on step 1 (each one starts an item), or onto one item (its first photo, a replacement or one more)
    const addFiles = async (files, into, rep) => { const F = [...files].slice(0, into == null ? 12 : 1); if (!F.length) return; pull(); const slow = setTimeout(() => toast(F.length > 1 ? `Adding ${F.length} photos…` : "Adding the photo…"), 700); let n = 0;
      for (const f of F) { try { const u = await upPhoto(f); fresh.add(u); if (into == null) { D.items.push({ name: "", price: "", stock: "", photos: [u] }); made = true; } else { const x = D.items[into]; if (!x) continue; if (rep) x.photos = [u, ...(x.photos || []).slice(1)]; else if ((x.photos || []).length < MAXPH) x.photos = [...(x.photos || []), u]; } n++; } catch (e) { toast(e.message); } }
      clearTimeout(slow); if (into == null) D.items = D.items.filter((x) => x.name || x.price || (x.photos || []).length); if (!S.bg.isConnected) return; draw(); if (n) setTimeout(() => pm?.react("hop"), 60); };
    const pickPhoto = (title, cam, lib) => (coarse() ? menu(S, title, [[I.camera, "Take a photo", () => cam.click()], [I.plus, "Choose from library", () => lib.click()]]) : lib.click());
    const save = async (btn) => { btn.disabled = true; const t0 = btn.textContent; btn.textContent = "Saving…"; const body0 = toBody();
      try { const j = await api(edit ? "/api/host/drops/" + encodeURIComponent(D.id) : "/api/host/drops", body0); try { window.EncoreCommunity?.oink?.(); } catch {}
        if (edit) { S.close(); toast(`Saved. ${body0.items.length} item${body0.items.length === 1 ? "" : "s"}, ${body0.windows.length} pickup time${body0.windows.length === 1 ? "" : "s"}. Guests see it now.`); opts.onDone?.(j); }
        else live(j, { ...body0, ...(j.drop || {}), items: body0.items }, opts.onDone); }
      catch (e) { btn.disabled = false; btn.textContent = t0; err(e.message); } };
    function open(first = true) { S = shell({ label: edit ? "Edit your drop" : "Set up a drop", compact: edit, tint: "coral" }); togKeys(S); const bg = S.bg;
      bg.addEventListener("input", (e) => { const t = e.target; t.removeAttribute?.("aria-invalid"); const er = $("#dpErr", bg); if (er) er.textContent = ""; if (step === 3) touched3 = true;
        if (t.matches?.("[data-p]") && !draw.priced && priceIn(t.value)) { draw.priced = true; pm?.react("pop"); } clearTimeout(draw.t); draw.t = setTimeout(refresh, 120); });
      bg.addEventListener("change", (e) => { const t = e.target;
        if (t.type === "file") { const F = [...t.files]; t.value = ""; if (t.id === "dpZoneIn" || t.id === "dpCamIn") return addFiles(F, null); if (slotFor) return addFiles(F, slotFor.i, slotFor.rep); return; }
        if (t.type === "date") { const b = t.previousElementSibling; if (b) b.textContent = t.value ? dayLabel(t.value) : t.dataset.empty; if (t.id === "dpByD") { pull(); return draw(); } }
        if (t.matches("[data-p]")) t.value = fmtP(t.value); if (t.matches("[data-s]")) t.value = t.value.replace(/\D/g, "");
        if (step === 3) touched3 = true; refresh(); });
      bg.addEventListener("click", (e) => { const d = e.target.closest(".ds-date"); if (d) { try { $("input", d).showPicker?.(); } catch {} }
        const b = e.target.closest("button"); if (!b || !S.el.contains(b) || b.closest(".ds-menu-bg")) return; const ds = b.dataset;
        if (b.id === "dpBack") { if (edit || step === 1) return S.dismiss(); pull(); return go(step - 1, -1); }
        if (b.id === "dpNext") { if (!check1()) return; if (step < LAST) return go(step + 1, 1); return save(b); }
        if (b.id === "dpSave") { if (!check1()) return; return save(b); }
        if (ds.tab) { if (+ds.tab === step || !check1()) return; return go(+ds.tab, +ds.tab > step ? 1 : -1); }
        if (b.id === "dpZone") return pickPhoto("Add photos", $("#dpCamIn", bg), $("#dpZoneIn", bg));
        if (b.id === "dsExN") { exI = (exI + 1) % EX.length; return refresh(); }
        if (b.id === "dsHow") { pull(); return tour({ again: true, then: () => open(), closed: () => open() }); }
        if (b.id === "dsUndo") { if (undo) D.items = JSON.parse(undo.items); undo = null; return draw(); }
        if (ds.vchip) { sel3 = +ds.vchip; pm?.react("hop"); return refresh(); }
        if (b.hasAttribute("data-vpay")) { paid4 = true; pm?.react("hop"); return refresh(); }
        if (ds.tog) { pull(); if (step === 3) { const wk = ds.tog === "weekly"; if (wk !== !!D.weekly) { D.weekly = wk; touched3 = true; D.windows = D.windows.map((w) => (wk ? { ...w, day: w.date ? DAYS7[new Date(w.date + "T12:00:00").getDay()] : w.day || "Sat", date: "" } : { ...w, date: w.date || nextSat(), day: "" })); } }
          else if (step === 4) { D.pay = ds.tog; paid4 = false; } pm?.react("tilt"); draw(); return setTimeout(() => $(`[data-tog="${ds.tog}"]`, bg)?.focus({ preventScroll: true }), 0); }
        if (ds.slot) { slotFor = { i: +ds.slot, rep: !!ds.rep }; return pickPhoto(ds.rep ? "Replace the photo" : "Add a photo", $("#dpItemCam", bg), $("#dpItemIn", bg)); }
        if (ds.prm) { pull(); const [i, k] = ds.prm.split(":").map(Number); setUndo("Photo removed.", JSON.stringify(D.items)); D.items[i].photos.splice(k, 1); return draw(); }
        if (ds.pmv) { pull(); const [i, k] = ds.pmv.split(":").map(Number), P = D.items[i].photos; [P[k - 1], P[k]] = [P[k], P[k - 1]]; return draw(); }
        if (b.id === "dpAdd") { pull(); D.items.push({ name: "", price: "", stock: "", photos: [] }); draw(); return setTimeout(() => { const L = $$("[data-n]", bg), el = L[L.length - 1]; el?.focus({ preventScroll: true }); el?.closest(".dp-item")?.scrollIntoView({ block: "start", behavior: still() ? "auto" : "smooth" }); }, 40); }
        if (ds.rm) { pull(); const i = +ds.rm, x = D.items[i]; setUndo(`Removed ${itemName(x, i)}.`, JSON.stringify(D.items)); D.items.splice(i, 1); draw(); return setTimeout(() => $("#dsUndo", bg)?.focus({ preventScroll: true }), 40); }
        if (ds.mv) { pull(); const [i, by] = ds.mv.split(":").map(Number), j = i + by; if (j < 0 || j >= D.items.length) return; const x = D.items[i]; setUndo(`Moved ${itemName(x, i)} ${by < 0 ? "up" : "down"}.`, JSON.stringify(D.items)); D.items.splice(i, 1); D.items.splice(j, 0, x); draw();
          return setTimeout(() => { const el = $(`.dp-item[data-i="${j}"]`, bg); el?.scrollIntoView({ block: "nearest" }); ($(`[data-mv="${j}:${by}"]:not([disabled])`, el) || $("[data-mv]:not([disabled])", el))?.focus({ preventScroll: true }); }, 40); }
        if (b.id === "dpAddWin") { pull(); touched3 = true; const l = D.windows[D.windows.length - 1] || { date: nextSat(), day: "Sat", start: "09:00", end: "10:00" }; D.windows.push({ ...l, start: l.end || "10:00", end: hh(Math.min(22 * 60, mm(l.end || "10:00") + 60)) }); return draw(); }
        if (ds.wrm) { pull(); touched3 = true; D.windows.splice(+ds.wrm, 1); return draw(); }
        if (b.id === "dpByX") { pull(); D.orderByDate = ""; D.orderByTime = ""; return draw(); }
        if (b.id === "dpCovBtn") return loadJs("/photosheet.js", () => { const PS = window.PhotoSheet, EA = window.EventArt; if (!PS) return toast("The photo picker is still loading. Try again.");
          const ev = () => ({ title: D.title || D.items[0]?.name || "Bake", activity: "bake" });
          PS.open({ for: "cover", current: { url: D.coverPhoto || "", source: D.coverSource || "", focus: D.coverFocus || null }, draw: EA ? { render: (svg, prompt) => { try { EA.ensureCss?.(); return EA.cover({ ...ev(), coverArt: null }, { svg, title: ev().title || String(prompt || "").slice(0, 40), label: "" }); } catch { return ""; } } } : undefined,
            onChange: (c) => { if (c.removed) Object.assign(D, { coverPhoto: "", coverSource: "", coverFocus: null, coverArt: null });
              else if (c.drawn) Object.assign(D, { coverPhoto: "", coverSource: "", coverFocus: null, coverArt: { kind: "custom", svg: c.drawn.svg, prompt: c.drawn.prompt } });
              else if (c.template) Object.assign(D, { coverPhoto: "", coverSource: "", coverFocus: null, coverArt: { kind: c.template } });
              else Object.assign(D, { coverPhoto: c.url, coverSource: c.source || "", coverFocus: c.focus || null, coverArt: null });
              const cv = $("#dpCov", bg); if (cv) { const open0 = cv.closest("details")?.open; draw(); const d2 = $("#dpCov", bg)?.closest("details"); if (d2 && open0) d2.open = true; } } }); }); });
      // photos dropped onto the visual (a desktop), and dragging one photo onto another to reorder (the first is the main one)
      bg.addEventListener("dragover", (e) => { const v = e.target.closest?.(".ds-vis"); if (v && step === 1 && !drag) { e.preventDefault(); v.classList.add("drag"); } const t = e.target.closest?.(".dp-th[draggable]"); if (t && drag && +t.dataset.pi === drag[0]) e.preventDefault(); });
      bg.addEventListener("dragleave", (e) => e.target.closest?.(".ds-vis")?.classList.remove("drag"));
      bg.addEventListener("dragstart", (e) => { const t = e.target.closest?.(".dp-th[draggable]"); if (!t) return; drag = [+t.dataset.pi, +t.dataset.pk]; e.dataTransfer.effectAllowed = "move"; });
      bg.addEventListener("dragend", () => { drag = null; });
      bg.addEventListener("drop", (e) => { const v = e.target.closest?.(".ds-vis"); if (v && step === 1 && !drag) { e.preventDefault(); v.classList.remove("drag"); return addFiles(e.dataTransfer.files, null); }
        const t = e.target.closest?.(".dp-th[draggable]"); if (!t || !drag || +t.dataset.pi !== drag[0]) return; e.preventDefault(); pull(); const P = D.items[drag[0]].photos, [m0] = P.splice(drag[1], 1); P.splice(+t.dataset.pk, 0, m0); drag = null; draw(); });
      draw(0, first); }
    let seenLocal = false; try { seenLocal = !!localStorage.getItem("pl.dropTour"); } catch {}
    if (!edit && firstTime && !seenLocal && opts.tour !== false) tour({ then: () => open() }); else open(); }

  // the moment it's live: what guests see, the link, and Share as the one next step
  function live(j, d, onDone) { const url = j.url || location.origin + j.path, S = shell({ label: "Your drop is live", tint: "moss" }), R = (d.items || []).filter((x) => x.name); let when = ""; try { when = P0().line(d); } catch {}
    S.set({ first: true, top: topBar(0, 0, true), pane: `<h2 class="ds-h" id="dsH">Your drop is live</h2><p class="ds-sub">People can order now. Every order lands in Orders.</p>${visWrap(`<span class="ds-ph"><b class="t">${esc(d.title || R[0]?.name || "Your drop")}</b><span class="s">${esc([when, d.area].filter(Boolean).join(" · "))}</span>${tiles(R.map((x) => ({ img: (x.photos || [])[0] || x.photo, name: x.name, price: priceIn(x.price) ? money(priceIn(x.price)) : "", pop: true })))}</span>`, { ex: "What guests see", cls: "ds-grow" })}
      <div class="ds-body"><div class="ds-url"><span>${esc(url.replace(/^https?:\/\//, ""))}</span><button type="button" class="ds-sm" id="dpCopy">${I.copy}<span>Copy</span></button></div><p class="ds-c"><a class="ds-link" href="${esc(j.path)}" target="_blank" rel="noopener">See it as a guest</a></p></div>`,
      foot: `<button type="button" class="ds-go" id="dpShare">${I.share}<span>Share my drop</span></button><p class="ds-note" style="margin:6px 0 0">Paste the link in your group chat. That's where orders start.</p>` });
    potto(S, ["partyhat"]).then((m) => setTimeout(() => m?.react("hop"), 300)); S.onDismiss = () => onDone?.(j);
    S.bg.addEventListener("click", async (e) => { const b = e.target.closest("button"); if (!b) return; if (b.id === "dpBack") return S.dismiss(); if (b.id === "dpCopy") return copy(url, "Link copied. Paste it in your group chat.");
      if (b.id === "dpShare") { if (navigator.share) { try { await navigator.share({ title: d.title || "My drop", text: `${d.title || "My drop"}: order ahead, pick up ${(d.slots || [])[0] || "soon"}.`, url }); return; } catch {} } copy(url, "Link copied. Paste it in your group chat."); } }); }

  // ================= "Something to book": what a team can ask you for =================
  function bookable(o = {}) { const edit = !!o.exp, X = { name: "", price: "", min: 8, max: 20, length: "", includes: [], ...(o.exp || {}) }; X.price = fmtP(String(X.price || "").replace(/[^0-9.]/g, "")); X.inc = (X.includes || []).join("\n");
    let step = 1, team = 12, pm = null; const S = shell({ label: edit ? "Edit what teams can book" : "Something to book", compact: edit, tint: "sky" });
    const line = (x) => [priceIn(x.price) ? `From ${money(priceIn(x.price))} a person` : "", x.min && x.max ? `${x.min} to ${x.max} guests` : "", x.length].filter(Boolean).join(" · ");
    const HEAD = { 1: ["What can teams book?", "Say what you'd run for a group. Teams see it on your page and ask for a date."], 2: ["How big, and how long?", "Set the smallest and largest group you'd take. A team picks a number in between."] };
    const pull = () => { const g = (id) => $(id, S.bg); if (g("#bkName")) { X.name = g("#bkName").value.trim(); X.price = g("#bkPrice").value.trim(); } if (g("#bkMin")) { X.min = Math.max(1, +g("#bkMin").value || 1); X.max = Math.max(1, +g("#bkMax").value || 1); X.length = g("#bkLen").value.trim(); X.inc = g("#bkInc").value; } };
    const ex = () => !X.name && !priceIn(X.price);
    const vis = () => { const V = ex() ? { name: "Pottery class for your team", price: "55", min: X.min, max: X.max, length: X.length || "2 hours" } : X, p = priceIn(V.price); team = Math.min(Math.max(team, V.min || 1), Math.max(V.max || 1, V.min || 1));
      return `<span class="ds-ph"><b class="t">${esc(V.name || "Your experience")}</b><span class="s">${esc(line(V) || "Add a price a person")}</span>${step === 1 && !edit ? `<span class="ds-flow ds-seq">${fl(av("A", "#DCEBF6"), "Acme Design asks for a date", "12 people · Thu, Dec 10")}${fl(check, `You reply with a quote${p ? `, ${money(p * 12)}` : ""}`, "Or pass. Nothing is booked until you both agree.")}</span>`
        : `<span class="ds-step"><span>A team of</span><span><button type="button" data-team="-1" aria-label="One fewer person">−</button><b>${team}</b><button type="button" data-team="1" aria-label="One more person">+</button></span></span><span class="ds-pl"><span>${p ? `Your quote starts at <b>${money(p * team)}</b>` : "Add a price to see the quote"}</span></span><span class="ds-hint">${team <= V.min ? `Your smallest group is ${V.min}.` : team >= V.max ? `Your largest group is ${V.max}.` : "Tap + and − to try a group size."}</span>`}</span>`; };
    const f1 = () => `<label class="ds-f"><span>What it is</span><input id="bkName" value="${esc(X.name)}" maxlength="70" placeholder="Pottery class for your team" autocomplete="off"></label>
      <label class="ds-f"><span>Price a person</span><span class="ds-money"><b aria-hidden="true">$</b><input id="bkPrice" value="${esc(X.price)}" inputmode="decimal" placeholder="55" aria-label="Price a person in dollars" autocomplete="off"></span><small>Your starting price. You send the final quote.</small></label>`;
    const f2 = () => `<div class="ds-2"><label class="ds-f"><span>Fewest guests</span><input id="bkMin" value="${esc(X.min || 8)}" inputmode="numeric" pattern="[0-9]*"></label><label class="ds-f"><span>Most guests</span><input id="bkMax" value="${esc(X.max || 20)}" inputmode="numeric" pattern="[0-9]*"></label></div>
      <label class="ds-f"><span>How long <small>(optional)</small></span><input id="bkLen" value="${esc(X.length || "")}" maxlength="40" placeholder="2 hours" autocomplete="off"></label>
      <details class="ds-more"${edit ? " open" : ""}><summary>More options</summary><div><label class="ds-f"><span>What's included <small>(optional, one per line)</small></span><textarea id="bkInc" rows="3" placeholder="Clay and glazes&#10;Firing, ready in 2 weeks">${esc(X.inc)}</textarea><small>Teams see this list under the price.</small></label></div></details>`;
    const draw = (dir, first) => { S.set({ dir, first, top: edit ? `<button type="button" class="ds-rb" id="dpBack" aria-label="Close">${I.x}</button><p class="ds-et">Edit what teams can book</p><span></span>` : topBar(step, 2, step === 1),
      pane: edit ? `<div class="ds-body" id="dsBody">${f1()}${f2()}</div>` : `<h2 class="ds-h" id="dsH">${HEAD[step][0]}</h2><p class="ds-sub">${HEAD[step][1]}</p>${visWrap(vis(), { ex: ex() ? "Example" : "", cls: "ds-grow" })}<div class="ds-body" id="dsBody">${step === 1 ? f1() : f2()}</div><p class="ds-note">${step === 1 ? "Teams send a request. You reply with a quote, or pass." : "Once they accept your quote, they pay a 50% deposit to confirm."}</p>`,
      foot: `<p class="ds-err" id="dpErr" role="alert"></p><button type="button" class="ds-go" id="${edit || step === 2 ? "bkSave" : "bkNext"}">${edit ? "Save" : step === 1 ? "Next: group size" : "Add it to my page"}</button>` });
      if (!edit) { pm = null; potto(S, ["glasses", "bowtie"]).then((m) => (pm = m)); } };
    const re = () => { pull(); const v = $("#dsVis", S.bg); if (v) v.innerHTML = visIn(vis(), ex() ? "Example" : ""); };
    const er = (t, id) => { $("#dpErr", S.bg).textContent = t; const el = $(id, S.bg); if (el) { el.setAttribute("aria-invalid", "true"); el.focus(); } return false; };
    const ok1 = () => (!X.name ? er("Say what it is.", "#bkName") : !priceIn(X.price) ? er("Add a price a person, like 55.", "#bkPrice") : true);
    S.bg.addEventListener("input", (e) => { e.target.removeAttribute?.("aria-invalid"); $("#dpErr", S.bg).textContent = ""; clearTimeout(draw.t); draw.t = setTimeout(re, 120); });
    S.bg.addEventListener("change", (e) => { if (e.target.id === "bkPrice") { e.target.value = fmtP(e.target.value); if (priceIn(e.target.value)) pm?.react("pop"); } re(); });
    S.bg.addEventListener("click", async (e) => { const b = e.target.closest("button"); if (!b) return;
      if (b.id === "dpBack") { if (edit || step === 1) return S.dismiss(); pull(); step = 1; return draw(-1); }
      if (b.dataset.team) { team += +b.dataset.team; pm?.react("hop"); re(); return $(`[data-team="${b.dataset.team}"]`, S.bg)?.focus({ preventScroll: true }); }
      if (b.id === "bkNext") { pull(); if (!ok1()) return; step = 2; return draw(1); }
      if (b.id !== "bkSave") return; pull(); if (edit && !ok1()) return; if (X.max < X.min) return er("Most guests is at least the fewest.", "#bkMax");
      const x = { name: X.name, price: `${priceIn(X.price)}`, length: X.length, min: X.min, max: X.max, includes: X.inc.split("\n").map((s) => s.trim()).filter(Boolean) };
      b.disabled = true; try { const me = (await api("/api/host/profile")).host || {}; const L = [...(me.experiences || [])]; const row = { ...(o.exp || {}), ...x };
        if (o.exp) { const i = L.findIndex((y) => y.id === o.exp.id); if (i >= 0) L[i] = row; else L.push(row); } else L.push(row);
        const sv = await api("/api/host/profile", { experiences: L, forHire: true }); S.close(); toast(`${edit ? "Saved" : "Added"}. Teams see "${x.name}, ${line(x)}" with Request a date.`);
        o.onDone?.({ book: true, name: x.name, handle: sv?.host?.handle || me.handle || "" }); } // the caller takes the host to where it now lives (their page), not back to wherever the chooser opened
      catch (er2) { b.disabled = false; er(er2.message); } });
    draw(0, true); }

  // ================= "What are you making?": each choice shows what it makes before you start =================
  const KIND = { event: { t: "An event", go: "Start an event", tint: "butter", wear: ["partyhat"], say: "Pick a date and invite people. Guests tap I'm in.", like: "Dumpling night, Sat 7pm",
      vis: () => `<span class="ds-ph"><b class="t">Dumpling night</b><span class="s">Sat, Dec 5 · 7pm · Greenpoint</span><span class="ds-fakeb">I'm in</span><span class="ds-seq">${[["L", "#F6EBC4", "<b>Lan</b> is in"], ["S", "#F8DDD6", "<b>Sam</b> is in, bringing chili oil"], ["+4", "#DCEBF6", "4 more are in"]].map(([a, c, t]) => `<span class="ds-rep">${av(a, c)}<span>${t}</span></span>`).join("")}</span></span>` },
    drop: { t: "A drop", go: "Start a drop", tint: "coral", wear: ["apron"], say: "Show what you're making. People order ahead, then pick up.", like: "Pandan cake, pick up Sat 9am",
      vis: () => `<span class="ds-ph"><b class="t">Pandan this Saturday</b><span class="s">Order ahead · Pickup Sat 9 to 10am</span><span class="ds-flow ds-seq">${fl(ART.cake, "Pandan cake", "$18 · 2 in the order")}${fl(ART.toast, "Kaya toast box", "$9.50")}<span class="ds-fakeb">Order · $36</span></span></span>` },
    book: { t: "Something to book", go: "Start something to book", tint: "sky", wear: ["glasses", "bowtie"], say: "Offer something for a group. Teams ask for a date and you send a price.", like: "Pottery class, $55 a person",
      vis: () => `<span class="ds-ph"><b class="t">Pottery class for your team</b><span class="s">From $55 a person · 8 to 20 guests</span><span class="ds-flow ds-seq">${fl(av("A", "#DCEBF6"), "Acme Design asks for a date", "12 people · Thu, Dec 10")}${fl(check, "You quote $660", "They pay a deposit to confirm")}</span></span>` } };
  function choose(o = {}) { if (o.event && /[?&]poll=[a-f0-9]{24}(&|$)/.test(location.search)) return o.event(); /* "Pick this date" on an availability poll (public/feedpoll.js) is already an event: straight to the editor */ const S = shell({ label: "What are you making?", tint: KIND.event.tint }), ORDER = ["event", "drop", "book"], IC = { event: I.cal, drop: I.bag, book: I.people }; let k = "event", pm = null; togKeys(S);
    S.set({ first: true, top: topBar(0, 0, true), pane: `<h2 class="ds-h" id="dsH">What are you making?</h2><p class="ds-sub" id="dsKind" aria-live="polite">${KIND[k].say}</p>${toggle("What are you making?", k, ORDER.map((x) => [x, KIND[x].t, IC[x]]), "k3")}${visWrap(KIND[k].vis(), { cls: "ds-tall ds-chv" })}<p class="ds-note" id="dsLike">Like: ${KIND[k].like}</p>`,
      foot: `<button type="button" class="ds-go" id="dsStart">${KIND[k].go}</button><p class="ds-note" id="dsAny" style="margin:6px 0 0">You can make the others any time.</p>` });
    $$("[data-tog]", S.bg).forEach((b) => (b.dataset.kind = b.dataset.tog));
    potto(S, KIND[k].wear).then((m) => (pm = m));
    const pick = (n) => { if (n === k || !KIND[n]) return; k = n; S.bg.dataset.funTint = KIND[k].tint; $$("[data-tog]", S.bg).forEach((x) => { const on = x.dataset.tog === k; x.setAttribute("aria-checked", String(on)); x.tabIndex = on ? 0 : -1; });
      $("#dsVis", S.bg).innerHTML = KIND[k].vis(); $("#dsKind", S.bg).textContent = KIND[k].say; $("#dsLike", S.bg).textContent = "Like: " + KIND[k].like; $("#dsStart", S.bg).textContent = KIND[k].go; pm?.set({ wear: KIND[k].wear }); };
    let x0 = null; const v = $(".ds-visw", S.bg); v.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    v.addEventListener("touchend", (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 44) pick(ORDER[ORDER.indexOf(k) + (dx < 0 ? 1 : -1)]); }, { passive: true });
    S.bg.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; if (b.id === "dpBack") return S.dismiss(); if (b.dataset.tog) return pick(b.dataset.tog);
      if (b.id === "dsStart") { if (k === "event") { S.close(); return (o.event || (() => (location.href = "/?app=1#studio")))(); } b.disabled = true; if (k === "drop") return setup({ onDone: o.onDone }); return bookable({ onDone: o.onDone }); } }); }

  window.EncoreDropSetup = { setup, tour, bookable, choose };
})();
