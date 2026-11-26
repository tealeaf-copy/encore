// Weekly, every-two-weeks and monthly events keep going (run club, book club, dance night).
//
// The morning after each date, an hourly job makes the next date as its own event: the same title, look, place, price,
// pass, spots and settings, a new id and the new date. It links the two with `seriesId` (the first event's id) and `prevId`
// (the one before). The one that just happened stays as it was, a past event with its own replies, photos and kudos.
// Followers-first stays on: an event that gave followers first dibs gives them 48 hours on the next one too.
//
// One next copy per date, ever: the job logs each one in the host's `repeats` collection before it writes, and it never
// makes one when a later date of the same series already exists (the host made it by hand, or the job did).
// It stops when the host turns Repeats off, sets a last date (`repeatUntil`) and the next one would be after it, or turns
// off "Make the next one automatically" (`autoNext: false`). A course (`sessions` > 1) is one event that guests sign up
// for once, so it never gets copies; it just ends after its last session.
//
// Guests on a past date's link see the next one (GET /api/public/next/:id): the light invite and the full invite show
// "Next one Tue, Dec 1" with the reply form for that date, and the past one's photos and kudos below.
import { randomId } from "./db.js";
import { scopeStore, allWorkspaceIds, getWorkspace, trialState, claimEvent } from "./workspaces.js";
import { localParts } from "./reminders.js";
import { KUDOS_TAGS } from "./social.js";
import { momentsOnPage } from "./feedvisual.js";

const ISO = /^\d{4}-\d{2}-\d{2}$/, DAY = 864e5, MORNING = 9, LOOKBACK = 45;
export const REPEATS = ["weekly", "biweekly", "monthly"];
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const utc = (s) => new Date(s + "T12:00:00Z");
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = utc(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const isDemo = (ws) => /@demo\.encore$/i.test(getWorkspace(ws)?.ownerEmail || "");
/** The title without a "(copy)" or "(Dec 1)" tag, for matching dates of one series by name. */
export const titleKey = (e) => String(e?.pubTitle || e?.name || "").replace(/ \((copy|[A-Z][a-z]{2} \d{1,2})\)$/, "").trim().toLowerCase();
export const isCourse = (e) => +e?.sessions > 1;

/** The date after `date` for a repeat (index.html's nextDate): +7, +14, or the same weekday of next month (first..fourth,
 *  or last when the date is in the last week and the fourth or fifth of its kind). Pure. */
export function stepDate(date, repeat) {
  if (!ISO.test(date || "")) return "";
  if (repeat === "weekly") return addDays(date, 7);
  if (repeat === "biweekly") return addDays(date, 14);
  if (repeat !== "monthly") return "";
  const x = utc(date), wd = x.getUTCDay(), nth = Math.ceil(x.getUTCDate() / 7), last = utc(addDays(date, 7)).getUTCMonth() !== x.getUTCMonth() && nth >= 4;
  const y = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 1, 12)), firstWd = 1 + ((wd - y.getUTCDay() + 7) % 7);
  const dim = new Date(Date.UTC(y.getUTCFullYear(), y.getUTCMonth() + 1, 0, 12)).getUTCDate();
  let day = firstWd + 7 * (nth - 1); if (last || day > dim) { day = firstWd; while (day + 7 <= dim) day += 7; }
  y.setUTCDate(day); return iso(y);
}
/** The first date of the repeat that is after `date` and on or after `today`; "" past the host's last date. Pure. */
export function nextRepeatDate(ev, today) {
  if (!REPEATS.includes(ev?.repeat) || !ISO.test(ev?.date || "")) return "";
  let d = ev.date, n = 0; do { d = stepDate(d, ev.repeat); n++; } while (d && d < today && n < 120);
  if (!d || (ISO.test(ev.repeatUntil || "") && d > ev.repeatUntil)) return ""; return d;
}
/** A course's sessions: its first date, then every week (or two) for `sessions` dates. */
export function courseDates(ev) { if (!isCourse(ev) || !ISO.test(ev.date || "")) return []; const step = ev.repeat === "biweekly" ? 14 : 7; return Array.from({ length: Math.min(52, +ev.sessions) }, (_, i) => addDays(ev.date, i * step)); }
/** Does this event make its next date by itself? */
export function continues(ev) {
  return !!ev && !ev.example && !ev.sample && !ev.cancelled && ev.stage !== "interest" && REPEATS.includes(ev.repeat) && !isCourse(ev) && ev.autoNext !== false && ISO.test(ev.date || "");
}
/** Other dates of the same series in this host's store: same seriesId (or the first one itself), or the same title and repeat. */
export function seriesSiblings(S, id, ev) {
  const root = ev.seriesId || id, key = titleKey(ev);
  return S.list("events").filter((d) => d.id !== id && d.data && !d.data.example && !d.data.cancelled && d.data.stage !== "interest" && ISO.test(d.data.date || "")
    && ((d.data.seriesId || d.id) === root || d.id === root || (!!key && titleKey(d.data) === key && !!d.data.repeat)));
}

/** What the next date copies: everything about the event, nothing about the date that happened. */
const PER_DATE = ["id", "date", "endDate", "createdAt", "updatedAt", "publishedAt", "kudosAskedAt", "remindedAt", "afterSent", "cameChecked", "dates", "dateOptions", "pollDates", "metrics", "opps", "debrief", "log", "oppLog", "answers", "tasksDone", "approvals", "blocked", "pmSent", "crmSyncedAt", "actualSpend", "commits", "meetLog", "rankSnap", "earlyUntil", "autoMade"];
export function nextCopy(id, ev, date, now = Date.now()) {
  const c = JSON.parse(JSON.stringify(ev)); for (const k of PER_DATE) delete c[k];
  c.date = date; if (ISO.test(ev.endDate || "") && ev.endDate > ev.date) c.endDate = addDays(date, Math.round((utc(ev.endDate) - utc(ev.date)) / DAY));
  c.seriesId = ev.seriesId || id; c.prevId = id; c.autoMade = true; c.createdAt = now; if (ev.published) c.publishedAt = now;
  // last time's crew stays on the host's list, ready to invite (like "Make the next one" in the app)
  c.guests = (Array.isArray(ev.guests) ? ev.guests : []).filter((g) => /Attended|Going/.test(g?.status || "")).map((g) => ({ ...g, status: "Invited", rsvpAt: null, invitedAt: null, slot: "", ride: "" }));
  // followers-first: followers get the first 48 hours again
  if (ev.earlyUntil) { const t = new Date(now + 48 * 3600e3); t.setUTCMinutes(0, 0, 0); c.earlyUntil = t.toISOString(); }
  return c;
}

/** Is it the morning after this date (or later) where the event is? */
export function morningAfter(ev, now, tz = ev?.tz || process.env.ENCORE_TZ || "") {
  const end = ISO.test(ev?.endDate || "") && ev.endDate >= (ev.date || "") ? ev.endDate : ev?.date; if (!ISO.test(end || "")) return false;
  const L = localParts(now, tz), days = Math.round((utc(L.day) - utc(end)) / DAY);
  return days >= 2 || (days === 1 && L.hour >= MORNING);
}

/** Make the next dates that are due, for every host (or `workspaces`). Returns what it made. */
export async function runRepeats(store, { now = Date.now(), workspaces = null, X = null, C = null, origin = process.env.ENCORE_PUBLIC_URL || "" } = {}) {
  const out = { made: 0, events: [] };
  for (const ws of workspaces || allWorkspaceIds()) { if (isDemo(ws)) continue; try { if (!trialState(getWorkspace(ws)).writable) continue; } catch {}
    const S = scopeStore(store, ws);
    for (const d of S.list("events")) { const ev = d.data, id = d.id; if (!continues(ev) || !morningAfter(ev, now)) continue;
      const today = localParts(now, ev.tz || process.env.ENCORE_TZ || "").day;
      if ((utc(today) - utc(ev.date)) / DAY > LOOKBACK) continue; // long stopped: don't bring an old series back
      if (S.get("repeats/" + id)) continue; // one next copy per date, ever (even if the host deleted it)
      if (seriesSiblings(S, id, ev).some((x) => x.data.date > ev.date)) continue; // a later date exists: the series goes on from that one
      const date = nextRepeatDate(ev, today); if (!date) continue; // the host's last date has passed
      let nid = randomId(); while (!claimEvent(nid, ws)) nid = randomId();
      S.set("repeats/" + id, { eventId: id, nextId: nid, date, at: now }); // logged first: a crash never makes two
      S.set("events/" + nid, { ...nextCopy(id, ev, date, now), id: nid });
      try { await X?.onEventChange?.(ws, nid, origin); } catch {}
      try { const owner = getWorkspace(ws)?.ownerEmail, title = clean(ev.pubTitle || ev.name, 120), day = utc(date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
        if (owner) X?.notify?.(owner, { kind: "repeat", key: "repeat-" + nid, text: `The next ${title} is up: ${day}. Last week's link shows it to guests.`, link: `/?app=1&open=${encodeURIComponent(nid)}#studio`, eventId: nid }); } catch {}
      out.made++; out.events.push({ ws, from: id, id: nid, date });
    }
  }
  return out;
}

/** The next date a guest on this event's link can reply to: { id, date, startTime, title } (id null when it isn't made yet),
 *  the next session of a course that's running ({ same: true }), or null. */
export function nextFor(S, id, ev, today) {
  if (!ev || ev.example) return null;
  if (isCourse(ev)) { const d = courseDates(ev).find((x) => x >= today); return d && ev.date < today ? { id, date: d, same: true, course: true } : null; }
  const later = seriesSiblings(S, id, ev).filter((x) => x.data.date >= today && x.data.date > ev.date).sort((a, b) => a.data.date.localeCompare(b.data.date))[0];
  if (later) return { id: later.id, date: later.data.date, startTime: later.data.startTime || "", title: clean(later.data.pubTitle || later.data.name, 120) };
  if (!REPEATS.includes(ev.repeat) || ev.cancelled) return null;
  const d = nextRepeatDate(ev, today); return d ? { id: null, date: d, startTime: ev.startTime || "", title: clean(ev.pubTitle || ev.name, 120) } : null;
}
/** What a past date leaves behind, for anyone with its link: photos (when the host shows them on their page) and kudos counts. */
export function pastSummary(S, id, ev) {
  const photos = momentsOnPage(ev) ? S.list("moments").map((d) => d.data).filter((m) => m && m.eventId === id && !m.hidden && m.type !== "video" && /^\/_blob\/[A-Za-z0-9_-]{6,80}$/.test(m.url || "")).sort((a, b) => (a.at || 0) - (b.at || 0)).slice(0, 8).map((m) => m.url) : [];
  const K = S.list("kudos").map((d) => d.data).filter((k) => k && k.eventId === id && (k.love || (k.tags || []).length)), n = {};
  for (const k of K) for (const t of k.tags || []) n[t] = (n[t] || 0) + 1;
  const tags = KUDOS_TAGS.filter(([k]) => n[k]).map(([k, emoji, label]) => ({ k, emoji, label, n: n[k] })).sort((a, b) => (b.k === "again") - (a.k === "again") || b.n - a.n).slice(0, 4);
  return { title: clean(ev.pubTitle || ev.name, 120), date: ev.date || "", photos, kudos: K.length, tags };
}

/** Check every hour, like the kudos asks. Returns {stop, run}. */
export function scheduleRepeats(store, opts = {}) {
  const tick = () => runRepeats(store, opts).catch((e) => console.warn("[repeats]", e?.message || e));
  const t = setInterval(tick, 3600e3); t.unref?.(); const firstRun = setTimeout(tick, 90e3); firstRun.unref?.();
  return { stop: () => { clearInterval(t); clearTimeout(firstRun); }, run: tick };
}

export function mountRepeats(app, { store, C, X, ownerOnly, workspaceOfEvent, jobs = !process.env.NODE_TEST_CONTEXT }) {
  const run = (o = {}) => runRepeats(store, { X, C, ...o });
  app.locals.repeats = { run };
  const hits = new Map(), limited = (req) => { const k = req.ip || "?", now = Date.now(); let h = hits.get(k); if (!h || now - h.start > 3600e3) { h = { n: 0, start: now }; hits.set(k, h); } return ++h.n > 300; };
  // a past date's link: where the series goes next, and what this date left behind
  app.get("/api/public/next/:id", (req, res) => { if (limited(req)) return res.status(429).json({ code: "rate_limited", message: "Slow down." });
    const id = clean(req.params.id, 80); if (!/^[A-Za-z0-9_-]{2,80}$/.test(id)) return res.status(404).json({ code: "not_found", message: "No such event." });
    const ws = workspaceOfEvent(id), S = scopeStore(store, ws), ev = S.get("events/" + id)?.data; if (!ev || ev.example) return res.status(404).json({ code: "not_found", message: "No such event." });
    const today = localParts(Date.now(), ev.tz || process.env.ENCORE_TZ || "").day; res.set("Cache-Control", "no-store");
    res.json({ next: nextFor(S, id, ev, today), past: ev.date && ev.date < today ? pastSummary(S, id, ev) : null }); });
  // the host can run the job for their own events now (the app's "Make the next one" still works by hand)
  app.post("/api/host/repeats/run", async (req, res) => { const u = ownerOnly(req, res); if (!u) return; res.json(await run({ workspaces: [u.ws] })); });
  if (jobs) app.locals.repeatsJob = scheduleRepeats(store, { X, C });
}
