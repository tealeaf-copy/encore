// When and how to pick up a drop, in one place for every view: the order page, feed and Discover cards, the host page,
// Plans, chats, emails and share previews. The server imports this same file (server/drops.js), so a page and an email
// never disagree. window.PLPickup (globalThis.PLPickup on the server).
//
// A drop's pickup windows: [{ id, date: "2026-12-06" or "" (every week), day: "Sun" (every week), start: "09:00", end: "10:00", cap }].
// Drops saved before windows existed keep "slots" (free words like "Sun 9am to 10pm" or "9 to 10am" with the drop's
// date); windowsOf reads those too, so an old drop never reads "Date TBD" either.
//
//   windowsOf(e)          the windows, earliest first
//   label(w)              "Sun, Dec 6 · 9 to 10am" or "Sundays · 9 to 10am"
//   line(e)               "Pickup Sun, Dec 6 · 9 to 10am", "Pickup Sat or Sun", "Pickup Dec 5 or Dec 6"
//   firstDate(e, today)   the first pickup day on or after today ("" when there is none)
//   leftLine(items, sold) "12 of 30 left" across the batch ("" with no batch size)
//   isDrop(e)             a drop (order ahead), not an event
(function (root) {
  if (root.PLPickup) return;
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const FULL = { Sun: "Sundays", Mon: "Mondays", Tue: "Tuesdays", Wed: "Wednesdays", Thu: "Thursdays", Fri: "Fridays", Sat: "Saturdays" }, WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const ISO = /^\d{4}-\d{2}-\d{2}$/, HM = /^\d{2}:\d{2}$/;
  const isDrop = (e) => !!(e && (e.drop || e.planKind === "drop"));
  const dateOf = (d) => new Date(d + "T12:00:00Z");
  const dayName = (d) => DAYS[dateOf(d).getUTCDay()];
  /** "Sun, Dec 6" */
  const day = (d) => { const x = dateOf(d); return `${DAYS[x.getUTCDay()]}, ${MON[x.getUTCMonth()]} ${x.getUTCDate()}`; };
  const mins = (t) => (HM.test(t || "") ? +t.slice(0, 2) * 60 + +t.slice(3) : null);
  const ap = (m) => (m < 720 || m >= 1440 ? "am" : "pm");
  const clock = (m, withAp = true) => { const h = Math.floor(m / 60) % 24, mm = m % 60; return `${h % 12 || 12}${mm ? ":" + String(mm).padStart(2, "0") : ""}${withAp ? ap(m) : ""}`; };
  /** "9 to 10am", "11am to 12pm", "9am" */
  const span = (w) => { const a = mins(w.start), b = mins(w.end); if (a == null) return ""; if (b == null || b <= a) return clock(a); return `${clock(a, ap(a) !== ap(b))} to ${clock(b)}`; };
  // ---- the old free-text slots: "Sun 9am to 10pm", "9 to 10am", "11:30am to 1pm" ----
  const RX = /^(?:(sun|mon|tue|wed|thu|fri|sat)[a-z]*,?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-|–)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i;
  const hm = (h, m) => `${String(h).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}`;
  function parseSlot(s) { const m = RX.exec(String(s || "").trim()); if (!m) return null;
    let a = +m[2], b = +m[5]; const am = +(m[3] || 0), bm = +(m[6] || 0), apB = (m[7] || "").toLowerCase(), apA = (m[4] || "").toLowerCase() || apB;
    if (a > 23 || b > 23 || am > 59 || bm > 59) return null;
    const to24 = (h, p) => (p === "pm" && h < 12 ? h + 12 : p === "am" && h === 12 ? 0 : h);
    let A = to24(a, apA), B = to24(b, apB); if (!m[4] && apB === "pm" && A > B) A -= 12; // "11 to 1pm" starts in the morning
    if (!apA && !apB && A < 7) { A += 12; B += 12; }
    const d = m[1] ? DAYS.find((x) => x.toLowerCase() === m[1].slice(0, 3).toLowerCase()) : "";
    return { day: d || "", start: hm(A, am), end: hm(B, bm) }; }
  /** The drop's windows, earliest first. Pure. */
  function windowsOf(e) { if (!e) return [];
    const W = Array.isArray(e.windows) && e.windows.length ? e.windows : (Array.isArray(e.slots) ? e.slots : []).map((s, i) => { const p = parseSlot(s); const date = ISO.test(e.date || "") && !e.always ? e.date : "";
      return p ? { id: "s" + i, date: p.day && !date ? "" : date, day: p.day && !date ? p.day : date ? dayName(date) : "", start: p.start, end: p.end, text: String(s) } : { id: "s" + i, date, day: date ? dayName(date) : "", start: "", end: "", text: String(s) }; });
    return W.filter((w) => w && (ISO.test(w.date || "") || w.day || w.text)).map((w) => ({ ...w, day: ISO.test(w.date || "") ? dayName(w.date) : w.day || "" }))
      .sort((a, b) => (a.date || "9") .localeCompare(b.date || "9") || WEEK.indexOf(a.day) - WEEK.indexOf(b.day) || String(a.start).localeCompare(String(b.start))); }
  /** One window in words. Pure. */
  function label(w) { if (!w) return ""; const t = span(w);
    if (ISO.test(w.date || "")) return [day(w.date), t].filter(Boolean).join(" · ");
    if (w.day) return [FULL[w.day] || w.day, t].filter(Boolean).join(" · ");
    return w.text || t; }
  /** The whole drop's pickup in one short line, "Pickup ..." (never "Date TBD" when a window has a date). Pure. */
  function line(e, { prefix = "Pickup " } = {}) { const W = windowsOf(e); if (!W.length) return e && ISO.test(e.date || "") ? prefix + day(e.date) : prefix + "time coming soon";
    const dated = W.filter((w) => ISO.test(w.date || "")), dates = [...new Set(dated.map((w) => w.date))];
    if (dates.length === 1) { const same = dated.filter((w) => w.date === dates[0]); return prefix + [day(dates[0]), same.length === 1 ? span(same[0]) : same.length === 2 ? same.map(span).filter(Boolean).join(" or ") : `${same.length} times`].filter(Boolean).join(" · "); }
    if (dates.length === 2) return prefix + dates.map(day).join(" or ");
    if (dates.length > 2) { const a = dateOf(dates[0]), b = dateOf(dates[dates.length - 1]); return `${prefix}${MON[a.getUTCMonth()]} ${a.getUTCDate()} to ${MON[b.getUTCMonth()]} ${b.getUTCDate()}`; }
    const days = [...new Set(W.map((w) => w.day).filter(Boolean))];
    if (days.length === 1) { const same = W.filter((w) => w.day === days[0]); return prefix + [FULL[days[0]] || days[0], same.length === 1 ? span(same[0]) : ""].filter(Boolean).join(" · "); }
    if (days.length) return prefix + (days.length === 2 ? days.join(" or ") : days.slice(0, -1).join(", ") + " or " + days[days.length - 1]);
    return prefix + (W[0].text || "time coming soon"); }
  /** The next pickup day on or after today, for a dated or every-week drop ("" with none). Pure. */
  function firstDate(e, today = new Date().toISOString().slice(0, 10)) { const W = windowsOf(e); let best = "";
    for (const w of W) { let d = ISO.test(w.date || "") ? w.date : "";
      if (!d && w.day) { const t = dateOf(today); const k = (DAYS.indexOf(w.day) - t.getUTCDay() + 7) % 7; t.setUTCDate(t.getUTCDate() + k); d = t.toISOString().slice(0, 10); }
      if (d && d >= today && (!best || d < best)) best = d; }
    return best || (ISO.test(e?.date || "") && e.date >= today ? e.date : ""); }
  /** The calendar date for a window: its own date, else its next weekday. Pure. */
  const dateFor = (w, today) => (ISO.test(w?.date || "") ? w.date : w?.day ? firstDate({ windows: [w] }, today) : "");
  /** "12 of 30 left" across the items that have a batch size. Pure. */
  function leftLine(items, sold = {}) { let total = 0, left = 0, any = false;
    for (const x of items || []) { const n = +x.stock || 0; if (!n) continue; any = true; total += n; left += x.left != null ? Math.max(0, +x.left) : Math.max(0, n - (+sold[x.name] || 0)); }
    return !any ? "" : left ? `${left} of ${total} left` : "Sold out"; }
  /** Which window an order's slot words name. Pure. */
  const windowOfSlot = (e, slot) => { const s = String(slot || "").trim(); if (!s) return null; const W = windowsOf(e); return W.find((w) => label(w) === s || w.text === s || w.id === s) || null; };
  root.PLPickup = { isDrop, windowsOf, label, line, span, day, firstDate, dateFor, leftLine, windowOfSlot, parseSlot };
})(typeof window !== "undefined" ? window : globalThis);
