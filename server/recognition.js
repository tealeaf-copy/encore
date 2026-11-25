// Recognition for hosts, borrowing what makes Strava and Substack rewarding:
//  - Strava: streaks (show up week after week), Local Legend (most active in your area lately), milestones.
//  - Substack: a "rising" list and bestseller-style badges that reward regular publishing and a loyal audience.
// Everything is earned from real activity (events that happened, guests who came back, kudos) and never from money.
import { allWorkspaceIds, getWorkspace } from "./workspaces.js";

const DAY = 864e5, CACHE_MS = 5 * 60e3;
const today = () => new Date().toISOString().slice(0, 10);
// ISO-ish week number counted from a fixed Monday, so consecutive weeks differ by exactly 1
const weekOf = (d) => Math.floor((Date.parse(d + "T12:00:00Z") - Date.parse("2001-01-01T00:00:00Z")) / (7 * DAY));
const monthOf = (d) => +d.slice(0, 4) * 12 + +d.slice(5, 7) - 1;

/** How many periods in a row (ending now or in the last period, so a streak survives until the period is over). */
export function streakOf(dates, now = today(), unit = "week") {
  const f = unit === "week" ? weekOf : monthOf, have = new Set(dates.filter((d) => d && d <= now).map(f)), cur = f(now);
  let start = have.has(cur) ? cur : have.has(cur - 1) ? cur - 1 : null; if (start == null) return 0;
  let n = 0; while (have.has(start - n)) n++; return n;
}

const MILESTONES = { events: [100, 50, 25, 10, 5, 1], guests: [500, 250, 100, 50, 25, 10] };
// The rules behind every badge, in one place, so a badge always means the same thing wherever it shows.
export const BADGE_RULES = {
  newMaxGuests: 10, // "New host" stops once 10 different people have come, or a brand has booked, or the host lists past clients
  legendRecent: 3, legendGuests: 20, legendMinHosts: 3, // "Local legend": most events in the city over 90 days (at least 3), 20+ guests overall, and at least 3 active hosts in that city to beat
  text: {
    new: "New host: started hosting in the last few weeks, fewer than 10 guests so far, no brand bookings yet.",
    legend: "Local legend: hosted the most in their city over the last 90 days (3 or more), with 20+ guests overall, among at least 3 active hosts there.",
    super: "Super host: 5+ events, 15+ guests, guests coming back (or 5+ kudos), and active in the last 90 days.",
    streak: "Streak: hosted something 3 weeks (or 3 months) in a row.",
  },
};
export const SUPER = { events: 5, guests: 15, returningShare: 0.3, kudos: 5, activeDays: 90 };

/** The badges a host has earned, from their activity. */
export function badgesFor({ dates = [], guests = 0, returning = 0, kudos = 0, createdAt = 0, bookings = 0, clients = 0 }, now = today()) {
  const past = dates.filter((d) => d && d <= now), last = past[past.length - 1] || "", first = past[0] || "", B = [];
  const wk = streakOf(past, now, "week"), mo = streakOf(past, now, "month"), daysSince = (d) => (d ? (Date.parse(now) - Date.parse(d)) / DAY : Infinity);
  // "New host": hosted at least once, recently started, and nothing yet that says otherwise (a brand booking, past clients, 10+ guests)
  const isNew = past.length >= 1 && past.length <= 5 && guests < BADGE_RULES.newMaxGuests && !bookings && !clients && ((createdAt && Date.now() - createdAt < 60 * DAY) || daysSince(first) < 45);
  const isSuper = past.length >= SUPER.events && guests >= SUPER.guests && (returning / Math.max(1, guests) >= SUPER.returningShare || kudos >= SUPER.kudos) && daysSince(last) <= SUPER.activeDays;
  if (isSuper) B.push({ id: "super", emoji: "⭐", label: "Super host", why: `${past.length} events, ${guests} guests, and guests keep coming back` });
  if (wk >= 3) B.push({ id: "streak", emoji: "🔥", label: `${wk}-week streak`, n: wk, unit: "week", why: `Hosted something ${wk} weeks in a row` });
  else if (mo >= 3) B.push({ id: "streak", emoji: "🔥", label: `${mo} months in a row`, n: mo, unit: "month", why: `Hosted something ${mo} months in a row` });
  if (isNew) B.push({ id: "new", emoji: "🌱", label: "New host", why: "Just started hosting on Pottery Lab" });
  const ev = MILESTONES.events.find((m) => past.length >= m), gu = MILESTONES.guests.find((m) => guests >= m);
  if (ev && ev > 1) B.push({ id: "m-events", emoji: "🎉", label: `${ev}+ events`, n: ev, why: `Has hosted ${past.length} events` });
  if (gu) B.push({ id: "m-guests", emoji: "🙌", label: `${gu}+ guests`, n: gu, why: `${guests} different people have come` });
  // what's next, for the host's own eyes (Strava goals): keep the streak alive, the next badge, the next milestone
  const next = [], cur = weekOf(now), hostedThisWeek = past.some((d) => weekOf(d) === cur), upcomingThisWeek = dates.some((d) => d > now && weekOf(d) === cur);
  if (wk >= 2 && !hostedThisWeek) next.push({ id: "streak", emoji: "🔥", text: upcomingThisWeek ? `Your next one keeps your streak going: ${wk + 1} weeks in a row.` : `Host something by Sunday to make it ${wk + 1} weeks in a row.` });
  if (!isSuper) { const need = []; if (past.length < SUPER.events) need.push(`${SUPER.events - past.length} more ${SUPER.events - past.length === 1 ? "event" : "events"}`); if (guests < SUPER.guests) need.push(`${SUPER.guests - guests} more guests`);
    if (returning / Math.max(1, guests) < SUPER.returningShare && kudos < SUPER.kudos) need.push(`a few more people coming back (or ${SUPER.kudos - kudos} more kudos)`); if (past.length && daysSince(last) > SUPER.activeDays) need.push("an event in the next few weeks");
    if (need.length && need.length <= 2) next.push({ id: "super", emoji: "⭐", text: `Super host is close: ${need.join(" and ")}.` }); }
  const nextEv = [...MILESTONES.events].reverse().find((m) => m > past.length); if (!past.length) next.push({ id: "first", emoji: "🌱", text: "Host your first event to start a streak." });
  else if (nextEv && nextEv - past.length <= 3) next.push({ id: "m-events", emoji: "🎉", text: `${nextEv - past.length} more to reach ${nextEv} events.` });
  return { badges: B, next, streak: { weeks: wk, months: mo }, events: past.length, last, isNew: !!isNew, isSuper };
}

export function makeRecognition({ C, X }) {
  let cache = null;
  function all() {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
    const out = [];
    for (const ws of allWorkspaceIds()) { const h = C.profileOf(ws); if (!h?.handle || !h.name) continue; let S; try { S = X.hostStrengths(ws); } catch { continue; }
      const W = getWorkspace(ws), example = isExampleEmail(W?.ownerEmail), clients = (h.gigs || []).filter((g) => g.client && !isPlaceholderBrand(g.client)).length, bookings = +(X.bookingsOf?.(ws) || 0);
      const r = example ? { badges: [], next: [], streak: { weeks: 0, months: 0 }, events: (S.dates || []).length, last: "", isNew: false, isSuper: false } : badgesFor({ dates: S.dates || [], guests: S.guests, returning: S.returning, kudos: S.kudosCount, createdAt: W?.createdAt || 0, bookings, clients });
      const recent = (S.dates || []).filter((d) => d <= today() && (Date.parse(today()) - Date.parse(d)) / DAY <= 90).length;
      out.push({ ws, handle: h.handle, city: String(h.city || "").trim(), recent, guests: S.guests, returning: S.returning, example, ...r }); }
    // Local Legend (Strava): the most active real host in each city over the last 90 days, only where there's a field to beat (BADGE_RULES)
    const active = new Map(); for (const x of out) if (x.city && x.recent && !x.example) active.set(x.city.toLowerCase(), (active.get(x.city.toLowerCase()) || 0) + 1);
    const byCity = new Map(); for (const x of out) { if (!x.city || x.example || x.recent < BADGE_RULES.legendRecent || x.guests < BADGE_RULES.legendGuests || (active.get(x.city.toLowerCase()) || 0) < BADGE_RULES.legendMinHosts) continue; const k = x.city.toLowerCase(), cur = byCity.get(k); if (!cur || x.recent > cur.recent) byCity.set(k, x); }
    for (const x of byCity.values()) { x.badges.splice(x.isSuper ? 1 : 0, 0, { id: "legend", emoji: "👑", label: `Local legend · ${x.city}`, why: `Hosted the most in ${x.city} over the last 90 days` });
      // one story per host: a Local legend isn't also introduced as "new"
      x.badges = x.badges.filter((b) => b.id !== "new"); x.isNew = false; x.legend = true; }
    cache = { at: Date.now(), data: out }; return out;
  }
  const of = (handle) => all().find((x) => x.handle === String(handle || "").toLowerCase()) || null;
  function showcase() {
    const L = all(), pick = (f, sort, n = 8) => L.filter(f).sort(sort).slice(0, n).map((x) => x.handle);
    return {
      super: pick((x) => x.isSuper, (a, b) => b.events - a.events || b.guests - a.guests),
      streaks: pick((x) => x.streak.weeks >= 3 || x.streak.months >= 3, (a, b) => b.streak.weeks - a.streak.weeks || b.streak.months - a.streak.months),
      legends: pick((x) => x.badges.some((b) => b.id === "legend"), (a, b) => b.recent - a.recent),
      newHosts: pick((x) => x.isNew, (a, b) => b.events - a.events || String(b.last).localeCompare(String(a.last))),
      badges: Object.fromEntries(L.filter((x) => x.badges.length).map((x) => [x.handle, x.badges])),
    };
  }
  return { all, of, showcase, reset: () => { cache = null; } };
}

/** Longest run of consecutive weeks with an event, within the given dates. */
export function longestWeeks(dates) { const W = [...new Set(dates.map(weekOf))].sort((a, b) => a - b); let best = 0, run = 0, prev = null; for (const w of W) { run = prev != null && w === prev + 1 ? run + 1 : 1; best = Math.max(best, run); prev = w; } return best; }
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A host's year (Strava year-in-review style): only what happened, nothing estimated. */
export function recapOf(S, year) {
  const dates = (S.dates || []).filter((d) => d.startsWith(String(year))), byMonth = {}; for (const d of dates) byMonth[+d.slice(5, 7) - 1] = (byMonth[+d.slice(5, 7) - 1] || 0) + 1;
  const top = Object.entries(byMonth).sort((a, b) => b[1] - a[1])[0];
  return { year: +year, events: dates.length, guests: S.guests || 0, returning: S.returning || 0, kudos: S.kudosCount || 0, firstDate: dates[0] || "", longestStreak: longestWeeks(dates),
    busiestMonth: top ? { month: MONTHS[+top[0]], n: top[1] } : null, months: Array.from({ length: 12 }, (_, i) => byMonth[i] || 0), kinds: (S.kinds || []).slice(0, 3), tags: (S.tags || []).slice(0, 3).map((t) => ({ emoji: t.emoji, label: t.label, n: t.n })),
    quote: (S.kudos || []).find((k) => k.love && k.love.length > 12) || null, photos: (S.moments || []).filter((m) => m.type !== "video").slice(0, 4).map((m) => m.url) };
}

export function mountRecognition(app, { C, X }) {
  const R = makeRecognition({ C, X }); X.recognition = R;
  // totals a host can show a sponsor or venue (never names); only once there's something to show
  app.get("/api/public/host/:handle/turnout", (req, res) => { const ws = C.wsOfHandle(String(req.params.handle || "").toLowerCase()); if (!ws || !C.profileOf(ws)) return res.status(404).json({ code: "not_found", message: "No host by that name." });
    let T = null; try { T = X.turnoutOf(ws); } catch {} res.set("Cache-Control", "public, max-age=120").json({ turnout: T && T.events ? T : null }); });
  app.get("/api/public/host/:handle/recap", (req, res) => { const ws = C.wsOfHandle(String(req.params.handle || "").toLowerCase()), h = ws && C.profileOf(ws); if (!h) return res.status(404).json({ code: "not_found", message: "No host by that name." });
    const year = /^20\d\d$/.test(String(req.query.year || "")) ? +req.query.year : new Date().getFullYear(); let S; try { S = X.hostStrengths(ws, { year }); } catch { S = {}; }
    let all = []; try { all = X.hostStrengths(ws).dates || []; } catch {} const years = [...new Set(all.map((d) => +d.slice(0, 4)))].sort();
    const me = R.of(h.handle); res.json({ years, host: { handle: h.handle, name: h.name, city: h.city || "", emoji: h.emoji || "", theme: { avatarArt: h.theme?.avatarArt || "", avatarUrl: h.theme?.avatarUrl || "", accent: h.theme?.accent || h.color || "#C2553A" } }, badges: me?.badges || [], ...recapOf(S, year) }); });
  app.get("/api/public/hosts/showcase", (req, res) => res.json(R.showcase()));
  app.get("/api/public/badge-rules", (req, res) => res.json(BADGE_RULES));
  app.get("/api/public/host/:handle/badges", (req, res) => { const ws0 = C.wsOfHandle(String(req.params.handle || "").toLowerCase()); if (ws0 && /@demo\.encore$/i.test(getWorkspace(ws0)?.ownerEmail || "")) return res.json({ badges: [], streak: { weeks: 0, months: 0 }, events: 0, example: true }); const x = R.of(req.params.handle); res.json(x ? { badges: x.badges, next: x.next, streak: x.streak, events: x.events } : { badges: [], streak: { weeks: 0, months: 0 }, events: 0 }); });
  return R;
}

// ---------------------------------------------------------------------------------------------------------------
// Trust: one source of truth for the numbers and proof a brand sees about a host, on every page.
// Every number comes with its n; under MIN_N we show counts ("5 of 6 guests came back"), never a percentage.
export const MIN_N = 10;
export const isExampleEmail = (e) => /@demo\.encore$/i.test(String(e || ""));
// names that are obviously placeholders: never rendered as a testimonial author or a client
const PLACEHOLDER_PERSON = /^(sample|test|example|demo|placeholder|lorem|ipsum|dummy|fake|your|first\s+last|full\s+name|name|jane\s+doe|john\s+doe|john\s+smith|jane\s+smith|guest\s+name|customer\s+name|client\s+name|person|someone|xxx+|tbd|n\/?a)\b|\b(person|doe|placeholder|ipsum)$/i;
const PLACEHOLDER_BRAND = /\b(acme|northwind|contoso|fabrikam|initech|globex|umbrella corp(oration)?|wayne enterprises|stark industries|hooli|example|sample|placeholder|lorem|dummy|test (co|company|inc)|your (company|brand)|company name|brand name)\b/i;
export const isPlaceholderName = (s) => { const t = String(s || "").trim(); return !t || PLACEHOLDER_PERSON.test(t); };
export const isPlaceholderBrand = (s) => { const t = String(s || "").trim(); return !t || PLACEHOLDER_BRAND.test(t); };

/** "67% of 18 guests came back" at n >= MIN_N, "5 of 6 guests came back" below it. Null when there's nothing to say. */
export function shareLine(n, of, noun, verb, min = MIN_N) {
  n = Math.max(0, Math.round(+n || 0)); of = Math.max(0, Math.round(+of || 0)); if (!of || !n) return null;
  const pct = Math.round((100 * n) / of);
  return { n, of, pct: of >= min ? pct : null, text: of >= min ? `${pct}% of ${of} ${noun} ${verb}` : `${n} of ${of} ${noun} ${verb}` };
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const SOCIAL = { instagram: "Instagram", tiktok: "TikTok", strava: "Strava", linkedin: "LinkedIn" };
const fmtCount = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}k` : String(n));

/** Everything a brand should see about a host, assembled from real activity. Pure: callers pass the data in. */
export function trustFrom({ S = {}, h = {}, example = false, bookings = [], proof = {}, scrapbook = [], badges = [], followers = 0, person = "", now = today() } = {}) {
  const tag = (real) => (example ? "Example" : real);
  const guests = +S.guests || 0, returning = +S.returning || 0, kudos = +S.kudosCount || 0, events = (S.dates || []).filter((d) => d <= now).length;
  const done = bookings.filter((b) => ["booked", "done"].includes(b.status));
  // a brand is named on a host's public page only after the event, and only if the brand said it's OK
  const listable = done.filter((b) => b.status === "done" && b.listOk === true && (!b.date || String(b.date).slice(0, 10) <= now));
  const returned = shareLine(returning, guests, guests === 1 ? "guest" : "guests", "came back for another");
  const again = shareLine(S.againYes, S.againOf, "guests who left kudos", "would go again");
  const pastSb = scrapbook.filter((x) => x && x.title && (!x.date || x.date <= now));
  // worked with: brands from bookings on Pottery Lab first, then what the host typed in (labelled), never placeholders
  const W = [], seen = new Set(), add = (client, what, when, source, label) => { const k = String(client).trim().toLowerCase(); if (!k || seen.has(k) || isPlaceholderBrand(client)) return; seen.add(k); W.push({ client: String(client).trim(), what: what || "", when: when || "", source, label: tag(label) }); };
  for (const b of listable) add(b.company, b.experience || "", b.date || "", "booking", "Booked on Pottery Lab");
  for (const g of h.gigs || []) add(g.client, g.what, g.when, "host", "Added by the host");
  // testimonials: guests' own kudos (from the platform) and quotes the host typed in (labelled); no placeholder authors
  const testimonials = [];
  for (const k of (S.kudos || []).filter((k) => k.love && k.love.length >= 12 && !isPlaceholderName(k.name)).slice(0, 6)) testimonials.push({ quote: k.love, name: k.name, event: k.event || "", source: "guest", label: tag("Kudos from a guest on Pottery Lab") });
  for (const q of h.corpQuotes || []) if (q.quote && !isPlaceholderName(q.name) && !isPlaceholderBrand(q.company || "")) testimonials.push({ quote: q.quote, name: q.name, title: q.title || "", company: q.company || "", source: "host", label: tag("Added by the host") });
  const pastCorporate = (proof.pastEvents || []).map((x) => ({ ...x, label: tag("Added by the host") }));
  const socials = (proof.socials || []).filter((x) => SOCIAL[x.platform] && x.handle).map((x) => ({ ...x, name: SOCIAL[x.platform], followersText: x.followers ? `${fmtCount(x.followers)} followers` : "", label: x.verifiedAt && !example ? "Verified" : tag("Self-reported") }));
  // insurance: one statement everywhere
  const coiUrl = proof.coi?.url || h.insuranceDoc || "", expires = proof.coi?.expires || "", expired = !!expires && expires < now;
  const insurance = example ? { onFile: false, url: "", expires: "", expired: false, text: "Example page: no insurance on file" }
    : coiUrl && !expired ? { onFile: true, url: coiUrl, expires, expired: false, text: `Insurance certificate on file${expires ? ` (expires ${new Date(expires + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })})` : ""}` }
    : expired ? { onFile: false, url: "", expires, expired, insured: !!h.insured, text: "Insurance certificate expired. A new one on request." }
    // "on request" only when the host said they're insured; otherwise say plainly there's nothing on file
    : h.insured ? { onFile: false, url: "", expires, expired, insured: true, text: "Says they're insured. Certificate on request" }
    : { onFile: false, url: "", expires, expired, insured: false, text: "No insurance certificate on file" };
  // what IS real, short lines in order of weight; nothing invented
  const lines = [];
  if (done.length) lines.push({ k: "bookings", text: plural(done.length, "brand booking", "brand bookings") });
  if (guests) lines.push({ k: "guests", text: `${plural(guests, "guest", "guests")} hosted` });
  if (returned) lines.push({ k: "returned", text: returned.text });
  if (again) lines.push({ k: "again", text: again.text });
  if (events) lines.push({ k: "events", text: `${plural(events, "event", "events")} hosted` });
  if (pastSb.length) lines.push({ k: "scrapbook", text: `${plural(pastSb.length, "past event", "past events")} in their scrapbook` });
  if (kudos) lines.push({ k: "kudos", text: `${kudos} kudos from guests` });
  const isNewHere = !example && !guests && !done.length && !events;
  return { example, guests, returning, kudos, events, followers, bookings: done.length, scrapbook: pastSb.length, returned, again, lines: lines.map((l) => ({ ...l, label: "" })), badges: example ? [] : badges,
    workedWith: W, testimonials, pastCorporate, socials, insurance, isNewHere,
    newLine: isNewHere ? "Sending a request is free." : "",
    rules: { minN: MIN_N } };
}
