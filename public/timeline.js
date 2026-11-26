// The plans timeline (public/plans.html, public/plan.html and the itinerary on the light invite).
// Pure parts first (days, grouping, the Now marker, multi-day spans, calendar dots), then the HTML for rows, days, the
// month grid, a plan's cover and its itinerary. Items come from POST /api/plans/timeline (server/plans.js).
// window.PLTimeline. Styles: public/timeline.css.
(function () {
  if (window.PLTimeline) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const zoneOk = (tz) => { if (!tz) return false; try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } };
  /** The date (YYYY-MM-DD) at `ms` in a time zone; the browser's own zone when none is given. Same as server/hooks.js localDay. */
  const localDay = (ms = Date.now(), tz = "") => { if (!zoneOk(tz)) { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms)); };
  const addDays = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);
  const fmt = (d, o) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { ...o, timeZone: "UTC" });
  /** "Fri · Dec 5", with "Today" or "Tomorrow" as its kicker. Pure. */
  function dayLabel(d, today) { const n = ISO.test(today || "") ? daysBetween(today, d) : NaN;
    return { kicker: n === 0 ? "Today" : n === 1 ? "Tomorrow" : n === -1 ? "Yesterday" : "", text: `${fmt(d, { weekday: "short" })} · ${fmt(d, { month: "short", day: "numeric" })}`, rel: n }; }
  /** "7pm", "7:30pm". Pure. */
  const clock = (t) => { const m = /^(\d{2}):(\d{2})$/.exec(t || ""); if (!m) return ""; let h = +m[1]; const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return `${h}${m[2] === "00" ? "" : ":" + m[2]}${ap}`; };
  /** "Dec 5 to 7", "Nov 29 to Dec 1", or one day. Pure. */
  function rangeText(a, b) { if (!ISO.test(a || "")) return ""; if (!ISO.test(b || "") || b <= a) return fmt(a, { weekday: "short", month: "short", day: "numeric" });
    const sameM = a.slice(0, 7) === b.slice(0, 7); return `${fmt(a, { month: "short", day: "numeric" })} to ${sameM ? fmt(b, { day: "numeric" }) : fmt(b, { month: "short", day: "numeric" })}`; }

  /** Over by now. An all-day item is over once its day is. Pure. */
  const isPast = (it, now) => it.endMs != null && it.endMs <= now;
  /** Happening right now (started, not over, not all day). Pure. */
  const isLive = (it, now) => !it.allDay && it.startMs != null && it.startMs <= now && now < it.endMs;
  /** Where the Now marker goes in a day's rows: after every row that has started (all-day rows sit first). Pure. */
  const nowIndex = (rows, now) => { let i = 0; for (const r of rows) { if (r.allDay || (r.startMs != null && r.startMs <= now)) i++; else break; } return i; };

  /**
   * Items grouped by day: [{ date, label, items }]. A multi-day item (endDate after date) is one block on its first day,
   * or on today while it's on. Days run in order; each day's rows by time, all-day first. Pure.
   */
  function groupByDay(items, { today = "" } = {}) {
    const G = new Map();
    for (const it of items || []) { if (!ISO.test(it.date || "")) continue; const span = ISO.test(it.endDate || "") && it.endDate > it.date;
      const at = span && today && it.date < today && it.endDate >= today ? today : it.date; if (!G.has(at)) G.set(at, []); G.get(at).push({ ...it, span }); }
    const ord = (a, b) => (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1) || (a.startMs || 0) - (b.startMs || 0) || (a.ord || 0) - (b.ord || 0) || String(a.title).localeCompare(String(b.title));
    return [...G.keys()].sort().map((d) => ({ date: d, label: dayLabel(d, today), items: G.get(d).sort(ord) }));
  }
  /** A multi-day item's days, each with its itinerary rows: [{ date, n, items }]. Pure. */
  function spanDays(it) { if (!ISO.test(it?.date || "")) return []; const to = ISO.test(it.endDate || "") && it.endDate > it.date ? it.endDate : it.date, out = [];
    for (let d = it.date, n = 1; d <= to && n <= 31; d = addDays(d, 1), n++) out.push({ date: d, n, items: (it.itinerary || []).filter((x) => x.day === d) }); return out; }

  // the order kinds take in a day's dots, and their names
  const KIND = { hosting: "Hosting", going: "Going", class: "Class", pickup: "Pickup", waitlist: "Waitlist", saved: "Saved", todo: "To do" };
  const DOT_ORDER = ["hosting", "going", "class", "pickup", "waitlist", "saved"];
  /** { "YYYY-MM-DD": ["hosting", "going"] } for a month ("YYYY-MM"): one dot per kind a day has, a span on each of its days. To-dos ride on their event. Pure. */
  function calendarDots(items, ym) { const out = {};
    for (const it of items || []) { if (it.kind === "todo" || !ISO.test(it.date || "")) continue; const to = ISO.test(it.endDate || "") && it.endDate > it.date ? it.endDate : it.date;
      for (let d = it.date, n = 0; d <= to && n < 62; d = addDays(d, 1), n++) { if (ym && d.slice(0, 7) !== ym) continue; (out[d] = out[d] || new Set()).add(it.kind); } }
    for (const d of Object.keys(out)) out[d] = DOT_ORDER.filter((k) => out[d].has(k)); return out; }
  /** The month's grid, Sunday first: 5 or 6 weeks of { date, inMonth }. Pure. */
  function monthCells(ym) { const first = ym + "-01", wd = new Date(first + "T12:00:00Z").getUTCDay(), start = addDays(first, -wd), cells = [];
    const next = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 1, 12)).toISOString().slice(0, 10), weeks = Math.ceil((wd + daysBetween(first, next)) / 7);
    for (let i = 0; i < weeks * 7; i++) { const d = addDays(start, i); cells.push({ date: d, inMonth: d.slice(0, 7) === ym }); } return cells; }
  const shiftMonth = (ym, n) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1, 12)).toISOString().slice(0, 7);
  /** The items on one day (spans that cover it too). Pure. */
  const itemsOn = (items, d) => (items || []).filter((it) => it.date === d || (ISO.test(it.endDate || "") && it.date < d && it.endDate >= d));

  // ---------- look ----------
  const ic = (d, extra = "") => `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"${extra}><path d="${d}"/></svg>`;
  const ICON = {
    going: ic("M4.5 10.5l3.5 3.5 7.5-8"), hosting: ic("M3.5 9.5 10 4l6.5 5.5M5.5 8v8h9V8M8.5 16v-4h3v4"),
    pickup: ic("M4.5 7h11l-1 9.5h-9zM7.5 7V5.5a2.5 2.5 0 0 1 5 0V7"), class: ic("M3.5 5.5h5a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 0-1.5-1.5h-5zM16.5 5.5h-5A1.5 1.5 0 0 0 10 7v9a1.5 1.5 0 0 1 1.5-1.5h5z"),
    todo: ic("M5 10.5l3 3 7-7.5"), waitlist: ic("M6 3.5h8M6 16.5h8M7 3.5c0 4 6 4 6 6.5s-6 2.5-6 6.5M13 3.5c0 4-6 4-6 6.5s6 2.5 6 6.5"), saved: ic("M10 16.2S3.5 12.3 3.5 7.8A3.3 3.3 0 0 1 10 6.4a3.3 3.3 0 0 1 6.5 1.4c0 4.5-6.5 8.4-6.5 8.4z"),
    arrive: ic("M10 17c-3.4-4-5-6.9-5-9.2a5 5 0 0 1 10 0C15 10.1 13.4 13 10 17zM10 9.6a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z"), checkin: ic("M12.5 4.5a3 3 0 1 1-2.6 4.5L4.5 14.4V16H6v-1.5h1.5V13H9l1.6-1.6A3 3 0 0 1 12.5 4.5z"),
    meal: ic("M6 3.5v13M4 3.5v4a2 2 0 0 0 4 0v-4M14 16.5v-13c-1.8 1-2.8 3-2.8 5.5 0 1.2.8 2 2.8 2"), workshop: ic("M4 16l1-4 8-8 3 3-8 8zM11.5 5.5l3 3"), talk: ic("M10 3.5a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-5 0V6A2.5 2.5 0 0 1 10 3.5zM5.5 9.5a4.5 4.5 0 0 0 9 0M10 14v2.5"),
    activity: ic("M10 3.5l1.8 4.2 4.2 1.8-4.2 1.8L10 15.5l-1.8-4.2L4 9.5l4.2-1.8z"), free: ic("M10 6.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM10 2.5v1.5M10 16v1.5M2.5 10H4M16 10h1.5M4.7 4.7l1 1M14.3 14.3l1 1M4.7 15.3l1-1M14.3 5.7l1-1"),
    travel: ic("M4 13.5V7.5A2.5 2.5 0 0 1 6.5 5h7A2.5 2.5 0 0 1 16 7.5v6zM4 10h12M6.5 16.5l1-3M13.5 16.5l-1-3M7 12h.01M13 12h.01"), checkout: ic("M11 4.5H5.5v11H11M9 10h7.5M13.5 7l3 3-3 3"),
    chev: ic("M8 5l5 5-5 5"), back: ic("M12 5l-5 5 5 5"), more: ic("M5 10h.01M10 10h.01M15 10h.01"), cal: ic("M4 5.5h12v10.5H4zM4 8.5h12M7 3.5v3M13 3.5v3"),
  };
  const ITIN_LABEL = { arrive: "Arrive", checkin: "Check in", meal: "Meal", workshop: "Workshop", talk: "Talk", activity: "Activity", free: "Free time", travel: "Travel", checkout: "Check out" };

  /** A row opens the peek (public/peek.js) on a plain tap; it stays a link for everything else. */
  const peekAttr = (it) => (it.eventId ? ` data-peek="${esc(it.eventId)}"` : "");
  /** One row: the time, a node on the line, the title (serif for events), one muted sub-line, a chevron. */
  const calOk = (it) => it.kind !== "todo" && !it.draft && /^\d{4}-\d{2}-\d{2}$/.test(it.date || "");
  const calBtn = (it) => `<button type="button" class="tl-cal" data-addcal="${esc(it.key)}" aria-label="Add ${esc(it.title)} to your calendar" aria-haspopup="menu" aria-expanded="false">${ICON.cal}</button>`;
  function rowHtml(it, { now = Date.now(), dim = true, cal = false } = {}) { const withCal = cal && calOk(it);
    const past = dim && isPast(it, now), live = isLive(it, now), time = it.allDay ? (it.span ? "" : "All day") : clock(it.time);
    const st = it.status ? `<span class="tl-st">${esc(it.status)}</span>` : "", rest = it.host ? esc(`with ${it.host}`) : "";
    // where it is, on its own line with a pin: the venue for people who are in and the host, else the area (the address follows once you're in)
    const locked = (it.kind === "going" || it.kind === "waitlist" || it.kind === "saved") && it.in === false && it.place;
    const loc = it.place ? `<span class="tl-loc"><svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M8 14.5c-2.9-3.3-4.3-5.7-4.3-7.6a4.3 4.3 0 0 1 8.6 0c0 1.9-1.4 4.3-4.3 7.6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="8" cy="6.9" r="1.5" fill="currentColor"/></svg><span>${esc(it.place)}${locked ? ' · <span class="tl-locked">address when you\'re in</span>' : ""}</span></span>` : "";
    const href = it.draft ? `/?open=${encodeURIComponent(it.eventId)}` : it.href || `/e/${encodeURIComponent(it.eventId)}`;
    return `<li class="tl-row k-${esc(it.kind)}${past ? " is-past" : ""}${live ? " is-live" : ""}${it.draft ? " is-draft" : ""}${withCal ? " has-cal" : ""}"><a class="tl-a" href="${esc(href)}"${peekAttr(it)}>`
      + `<span class="tl-time">${live ? "Now" : esc(time)}</span><span class="tl-node" aria-hidden="true">${ICON[it.kind] || ICON.going}</span>`
      + `<span class="tl-body"><span class="tl-k">${esc(KIND[it.kind] || "")}</span><b class="tl-title">${esc(it.title)}</b><span class="tl-sub">${st}${st && rest ? " · " : ""}${rest}</span>${loc}</span>`
      + `<span class="tl-chev" aria-hidden="true">${ICON.chev}</span></a>${withCal ? calBtn(it) : ""}</li>`;
  }
  /** An itinerary row (inside a plan, or nested in a multi-day block). */
  function itinRowHtml(x, { href = "", tag = "li" } = {}) {
    const inner = `<span class="tl-time">${esc(clock(x.time))}</span><span class="tl-node tl-node-i" aria-hidden="true">${ICON[x.kind] || ICON.activity}</span><span class="tl-body"><b class="tl-title tl-ititle">${esc(x.title)}</b>${x.sub ? `<span class="tl-sub">${esc(x.sub)}</span>` : ""}</span>`;
    return `<${tag} class="tl-row tl-irow k-i-${esc(x.kind)}">${href ? `<a class="tl-a" href="${esc(href)}">${inner}<span class="tl-chev" aria-hidden="true">${ICON.chev}</span></a>` : `<div class="tl-a">${inner}</div>`}</${tag}>`;
  }
  /** A multi-day plan: one block across its days, its own days nested inside. */
  function spanHtml(it, { now = Date.now(), today = "", cal = false } = {}) {
    const days = spanDays(it), href = it.href || `/plans/${encodeURIComponent(it.eventId)}`, past = isPast(it, now);
    const nest = days.map((d) => { const L = dayLabel(d.date, today), on = d.date === today;
      const rows = d.items.length ? d.items.slice(0, 2).map((x) => itinRowHtml(x)).join("") + (d.items.length > 2 ? `<li class="tl-more"><a href="${esc(href)}">${d.items.length - 2} more that day</a></li>` : "")
        : `<li class="tl-row tl-irow tl-quiet"><div class="tl-a"><span class="tl-time">${d.n === 1 && it.time ? esc(clock(it.time)) : ""}</span><span class="tl-node tl-node-i" aria-hidden="true">${ICON[d.n === 1 ? "arrive" : d.n === days.length ? "checkout" : "free"]}</span><span class="tl-body"><span class="tl-sub">${d.n === 1 ? "First day" : d.n === days.length ? "Last day" : `Day ${d.n}`}</span></span></div></li>`;
      return `<li class="tl-nday${on ? " is-today" : ""}"><span class="tl-ndh">${on ? "<b>Today</b> · " : ""}${esc(L.text)}</span><ol class="tl-list tl-nlist">${rows}</ol></li>`; }).join("");
    return `<li class="tl-span k-${esc(it.kind)}${past ? " is-past" : ""}${cal ? " has-cal" : ""}"><a class="tl-a tl-spanhead" href="${esc(href)}"${peekAttr(it)}><span class="tl-time">${esc(it.allDay ? "" : clock(it.time))}</span><span class="tl-node" aria-hidden="true">${ICON[it.kind] || ICON.going}</span>`
      + `<span class="tl-body"><span class="tl-k">${esc(rangeText(it.date, it.endDate))} · ${days.length} days</span><b class="tl-title">${esc(it.title)}</b><span class="tl-sub">${it.status ? `<span class="tl-st">${esc(it.status)}</span>` : ""}${[it.place, it.host ? `with ${it.host}` : ""].filter(Boolean).map((x) => " · " + esc(x)).join("")}</span></span><span class="tl-chev" aria-hidden="true">${ICON.chev}</span></a>${cal ? calBtn(it) : ""}`
      + `<ol class="tl-nest">${nest}</ol></li>`;
  }
  const nowHtml = (now, tz) => { const t = new Date(now).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...(zoneOk(tz) ? { timeZone: tz } : {}) }).replace(/\s([AP]M)$/, (_, x) => x.toLowerCase()).replace(":00", "");
    return `<li class="tl-now" role="presentation"><span class="tl-time">Now</span><span class="tl-nowdot" aria-hidden="true"></span><span class="tl-nowline"><span>${esc(t)}</span></span></li>`; };
  /** The day groups, with sticky headers and the Now marker on today. */
  function timelineHtml(items, { now = Date.now(), today = "", tz = "", nowMarker = true, cal = false } = {}) {
    const groups = groupByDay(items, { today }); let out = "";
    if (nowMarker && today && !groups.some((g) => g.date === today) && groups.length) out += `<section class="tl-day is-today"><h3 class="tl-dh"><span class="tl-dk">Today</span>${esc(dayLabel(today, today).text)}</h3><ol class="tl-list">${nowHtml(now, tz)}<li class="tl-row tl-quiet"><div class="tl-a"><span class="tl-time"></span><span class="tl-node tl-node-i" aria-hidden="true"></span><span class="tl-body"><span class="tl-sub">Nothing else today</span></span></div></li></ol></section>`;
    // a row that's happening says "Now" itself; otherwise a marker sits where the time falls
    for (const g of groups) { const on = g.date === today, at = on && nowMarker && !g.items.some((it) => !it.span && isLive(it, now)) ? nowIndex(g.items, now) : -1;
      const rows = g.items.map((it, i) => (i === at ? nowHtml(now, tz) : "") + (it.span ? spanHtml(it, { now, today, cal }) : rowHtml(it, { now, dim: on, cal }))).join("") + (at === g.items.length ? nowHtml(now, tz) : "");
      out += `<section class="tl-day${on ? " is-today" : ""}" data-date="${esc(g.date)}"><h3 class="tl-dh">${g.label.kicker ? `<span class="tl-dk">${esc(g.label.kicker)}</span>` : ""}${esc(g.label.text)}</h3><ol class="tl-list">${rows}</ol></section>`; }
    return `<div class="tl">${out}</div>`;
  }
  /** The month grid: a day number and one dot per kind, today ringed, the picked day filled. */
  function calendarHtml(ym, dots, { today = "", selected = "", mini = false } = {}) {
    const head = ["S", "M", "T", "W", "T", "F", "S"].map((d, i) => `<span class="cal-wd" aria-hidden="true">${d}</span>`).join("");
    const cells = monthCells(ym).map((c) => { const k = dots[c.date] || [], lab = `${fmt(c.date, { weekday: "long", month: "long", day: "numeric" })}${k.length ? ": " + k.map((x) => KIND[x]).join(", ") : ""}`;
      return `<button type="button" class="cal-d${c.inMonth ? "" : " is-out"}${c.date === today ? " is-today" : ""}${c.date === selected ? " is-sel" : ""}${c.date < today ? " is-before" : ""}" data-day="${c.date}" aria-label="${esc(lab)}"${c.date === selected ? ' aria-pressed="true"' : ""}><span class="cal-n">${+c.date.slice(8)}</span><span class="cal-dots">${k.slice(0, 3).map((x) => `<i class="dot k-${x}"></i>`).join("")}${k.length > 3 ? '<i class="dot more"></i>' : ""}</span></button>`; }).join("");
    return `<div class="cal${mini ? " cal-mini" : ""}"><div class="cal-top"><button type="button" class="cal-nav" data-shift="-1" aria-label="Previous month">${ICON.back}</button><b class="cal-m">${esc(fmt(ym + "-15", { month: "long", year: "numeric" }))}</b><button type="button" class="cal-nav" data-shift="1" aria-label="Next month">${ICON.chev}</button></div><div class="cal-g" role="group">${head}${cells}</div></div>`;
  }
  const legendHtml = (kinds) => `<p class="cal-key">${(kinds || DOT_ORDER).map((k) => `<span><i class="dot k-${k}"></i>${esc(KIND[k])}</span>`).join("")}</p>`;

  /** A plan's cover: the photo (or a quiet drawn panel), back and more buttons, the host, the dates and a type chip. */
  function coverHtml(p, { avatar = "", art = "", back = "/plans" } = {}) {
    const bg = p.cover ? `<img class="pc-img" src="${esc(p.cover)}" alt="">` : `<div class="pc-art" aria-hidden="true">${art || ""}</div>`;
    const range = p.multi ? rangeText(p.date, p.endDate) : [rangeText(p.date), clock(p.startTime)].filter(Boolean).join(" · ");
    return `<header class="pc"><div class="pc-ph">${bg}<div class="pc-shade"></div>`
      + `<a class="pc-btn pc-back" href="${esc(back)}" aria-label="Back to your plans">${ICON.back}</a><button type="button" class="pc-btn pc-more" aria-label="More" aria-haspopup="true" aria-expanded="false">${ICON.more}</button>`
      + `<div class="pc-foot"><span class="pc-av">${avatar || esc((p.host?.first || "?")[0])}</span><span class="pc-when"><b>${esc(range || "Date to come")}</b><small>${p.host?.first ? `Hosted by ${esc(p.host.first)}` : ""}</small></span><span class="pc-chip">${esc(p.chip || "")}</span></div></div>`
      + `<h1 class="pc-title">${esc(p.title)}</h1>${p.place ? `<p class="pc-place">${esc(p.place)}</p>` : ""}</header>`;
  }
  /** The plan, day by day, in the timeline's row style. */
  function itineraryHtml(days, { today = "" } = {}) {
    return `<div class="tl tl-itin">${(days || []).map((d) => { const L = dayLabel(d.date, today);
      return `<section class="tl-day" data-date="${esc(d.date)}"><h3 class="tl-dh">${days.length > 1 ? `<span class="tl-dk">Day ${d.n}</span>` : L.kicker ? `<span class="tl-dk">${esc(L.kicker)}</span>` : ""}${esc(L.text)}</h3><ol class="tl-list">${d.items.length ? d.items.map((x) => itinRowHtml(x)).join("") : `<li class="tl-row tl-irow tl-quiet"><div class="tl-a"><span class="tl-time"></span><span class="tl-node tl-node-i" aria-hidden="true">${ICON.free}</span><span class="tl-body"><span class="tl-sub">Nothing planned yet</span></span></div></li>`}</ol></section>`; }).join("")}</div>`;
  }

  window.PLTimeline = { esc, localDay, addDays, daysBetween, dayLabel, clock, rangeText, isPast, isLive, nowIndex, groupByDay, spanDays, calendarDots, monthCells, shiftMonth, itemsOn,
    KIND, DOT_ORDER, ICON, calOk, ITIN_LABEL, rowHtml, itinRowHtml, spanHtml, timelineHtml, calendarHtml, legendHtml, coverHtml, itineraryHtml };
})();
