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
export const SUPER = { events: 5, guests: 15, returningShare: 0.3, kudos: 5, activeDays: 90 };

/** The badges a host has earned, from their activity. */
export function badgesFor({ dates = [], guests = 0, returning = 0, kudos = 0, createdAt = 0 }, now = today()) {
  const past = dates.filter((d) => d && d <= now), last = past[past.length - 1] || "", first = past[0] || "", B = [];
  const wk = streakOf(past, now, "week"), mo = streakOf(past, now, "month"), daysSince = (d) => (d ? (Date.parse(now) - Date.parse(d)) / DAY : Infinity);
  const isNew = past.length >= 1 && past.length <= 5 && ((createdAt && Date.now() - createdAt < 60 * DAY) || daysSince(first) < 45); // hosted at least once, recently started
  const isSuper = past.length >= SUPER.events && guests >= SUPER.guests && (returning / Math.max(1, guests) >= SUPER.returningShare || kudos >= SUPER.kudos) && daysSince(last) <= SUPER.activeDays;
  if (isSuper) B.push({ id: "super", emoji: "⭐", label: "Super host", why: `${past.length} gatherings, ${guests} guests, and people keep coming back` });
  if (wk >= 3) B.push({ id: "streak", emoji: "🔥", label: `${wk}-week streak`, n: wk, unit: "week", why: `Hosted something ${wk} weeks in a row` });
  else if (mo >= 3) B.push({ id: "streak", emoji: "🔥", label: `${mo} months in a row`, n: mo, unit: "month", why: `Hosted something ${mo} months in a row` });
  if (isNew) B.push({ id: "new", emoji: "🌱", label: "New host", why: "Just started hosting on Encore" });
  const ev = MILESTONES.events.find((m) => past.length >= m), gu = MILESTONES.guests.find((m) => guests >= m);
  if (ev && ev > 1) B.push({ id: "m-events", emoji: "🎉", label: `${ev}+ gatherings`, n: ev, why: `Has hosted ${past.length} gatherings` });
  if (gu) B.push({ id: "m-guests", emoji: "🙌", label: `${gu}+ guests`, n: gu, why: `${guests} different people have come` });
  return { badges: B, streak: { weeks: wk, months: mo }, events: past.length, last, isNew: !!isNew, isSuper };
}

export function makeRecognition({ C, X }) {
  let cache = null;
  function all() {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
    const out = [];
    for (const ws of allWorkspaceIds()) { const h = C.profileOf(ws); if (!h?.handle || !h.name) continue; let S; try { S = X.hostStrengths(ws); } catch { continue; }
      const W = getWorkspace(ws), r = badgesFor({ dates: S.dates || [], guests: S.guests, returning: S.returning, kudos: S.kudosCount, createdAt: W?.createdAt || 0 });
      const recent = (S.dates || []).filter((d) => d <= today() && (Date.parse(today()) - Date.parse(d)) / DAY <= 90).length;
      out.push({ ws, handle: h.handle, city: String(h.city || "").trim(), recent, guests: S.guests, returning: S.returning, ...r }); }
    // Local Legend (Strava): the most active host in each city over the last 90 days, with at least 3 gatherings
    const byCity = new Map(); for (const x of out) { if (!x.city || x.recent < 3) continue; const k = x.city.toLowerCase(), cur = byCity.get(k); if (!cur || x.recent > cur.recent) byCity.set(k, x); }
    for (const x of byCity.values()) x.badges.splice(x.isSuper ? 1 : 0, 0, { id: "legend", emoji: "👑", label: `Local legend · ${x.city}`, why: `Hosted the most in ${x.city} over the last 90 days` });
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

export function mountRecognition(app, { C, X }) {
  const R = makeRecognition({ C, X });
  app.get("/api/public/hosts/showcase", (req, res) => res.json(R.showcase()));
  app.get("/api/public/host/:handle/badges", (req, res) => { const x = R.of(req.params.handle); res.json(x ? { badges: x.badges, streak: x.streak, events: x.events } : { badges: [], streak: { weeks: 0, months: 0 }, events: 0 }); });
  return R;
}
