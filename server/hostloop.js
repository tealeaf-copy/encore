// The host loop: what makes hosting feel rewarding, from a dinner for four to a summit, at a hosting cadence
// (weeks and months, never days). The idea: showing up is the goal, the ask is small, consistency is rewarded, and a
// quiet month costs a little without ever shaming anyone.
//
// - Streaks the host owns: counted monthly by default, weekly for clubs that meet weekly (the host picks). A streak
//   counts hosted periods in a row. Rest passes: the first event earns one, then one every 3 hosted months (or 4 hosted
//   weeks), holding at most 2; a quiet period uses one automatically. With no pass left, the streak pauses and any
//   event in the next 14 days repairs it, even a coffee for two. After that it ends with a kind line and an easy restart.
// - Small moves: a short list of 1 to 2 minute things that count (remind, thank, a photo, a reply, a feeler, one new
//   person, the next date), ordered for the host's moment. Host Home shows one: today's small move.
// - Warmth points for hosting effort (events, guests welcomed, would-go-again, small moves) against a monthly goal.
// - Milestones (first event out, 10th event, first sold-out night, first regular) are celebrated once each.
// - Circles, opt-in only: about 10 hosts of a similar size and city, ranked on warmth points for the period. The top 3
//   move up a table; everyone else stays. Nobody is ever moved down, and boards are seen only by their members.
// - Potto's nudges, at the host's own rhythm (their usual planning day and hour, learned from when they make events),
//   through the bell (which pushes, server/push.js) and email when there's no phone. Quiet hours, at most 2 a week,
//   and an off switch per kind in /settings.
// - The pre-signup draft from /start: a visitor plans a dinner before having an account; it carries over on save.
//
// Storage: system/hostloop-<ws> (prefs, moves, milestones seen, nudges sent, circle membership) and
// system/hostloop-settled (which circle periods have been settled). Everything is computed from real events.
import crypto from "node:crypto";
import { scopeStore, allWorkspaceIds, getWorkspace, DEFAULT_WS } from "./workspaces.js";
import { badgesFor } from "./recognition.js";
import { tzOk, tzOfCity } from "./tz.js";
import { emailConfig, sendEmail } from "./email.js";
import { expose, convert, assign } from "./experiments.js";
import { notify as inboxNotify } from "./inbox.js";
import { GUIDES } from "./guides.js";

const DAY = 864e5, ISO = /^\d{4}-\d{2}-\d{2}$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const today = () => new Date().toISOString().slice(0, 10);
const lc = (s) => String(s || "").trim().toLowerCase();
const clean = (v, n = 80) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / DAY);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export const LOOP = { maxPasses: 2, earnEvery: { month: 3, week: 4 }, repairDays: 14, headsUp: { month: { seven: 7, four: 4 }, week: 2 }, capPerWeek: 2, quiet: [21, 9], goal: 30, goals: [15, 30, 60] };

// ---------- periods ----------
const W0 = Date.parse("2001-01-01T00:00:00Z"); // a Monday
export const periodOf = (d, cad) => (cad === "week" ? Math.floor((Date.parse(d + "T12:00:00Z") - W0) / (7 * DAY)) : +d.slice(0, 4) * 12 + +d.slice(5, 7) - 1);
export function periodStart(p, cad) { if (cad === "week") return new Date(W0 + p * 7 * DAY).toISOString().slice(0, 10); return new Date(Date.UTC(Math.floor(p / 12), p % 12, 1)).toISOString().slice(0, 10); }
export function periodEnd(p, cad) { if (cad === "week") return addDays(periodStart(p, cad), 6); return new Date(Date.UTC(Math.floor(p / 12), (p % 12) + 1, 0)).toISOString().slice(0, 10); }
export const periodName = (p, cad) => (cad === "week" ? "this week" : MONTHS[p % 12]);
const earns = (n, cad) => (n - 1) % LOOP.earnEvery[cad] === 0;

/**
 * A host's streak at their cadence, with rest passes and repair. Pure.
 * dates: days they hosted (any size counts). upcoming: days of events still to come.
 */
export function streakState({ dates = [], upcoming = [], cadence = "month", now = today() } = {}) {
  // a summit or a yearly trip doesn't need a streak: "off" counts events instead, and nothing ever lapses
  if (cadence === "off") { const n = new Set(dates.filter((d) => ISO.test(d || "") && d <= now)).size, up = upcoming.filter((d) => ISO.test(d || "") && d > now).sort();
    return { cadence: "off", count: n, best: n, passes: 0, maxPasses: 0, restUsed: [], repaired: [], status: "off", hostedThisPeriod: false, upcomingThisPeriod: false, periodEnd: "", daysLeft: 0, period: 0, periodLabel: "", nextUpcoming: up[0] || "", repairBy: "", lapsedFrom: 0, hosted: n, nextPassIn: 0 }; }
  const cad = cadence === "week" ? "week" : "month", P = (d) => periodOf(d, cad), cur = P(now);
  const past = [...new Set(dates.filter((d) => ISO.test(d || "") && d <= now))].sort(), hosted = new Set(past.map(P));
  const end = periodEnd(cur, cad), up = upcoming.filter((d) => ISO.test(d || "") && d > now).sort();
  const out = { cadence: cad, count: 0, best: 0, passes: 0, maxPasses: LOOP.maxPasses, restUsed: [], repaired: [], status: "none", hostedThisPeriod: hosted.has(cur), upcomingThisPeriod: up.some((d) => P(d) === cur),
    periodEnd: end, daysLeft: daysBetween(now, end), period: cur, periodLabel: periodName(cur, cad), nextUpcoming: up[0] || "", repairBy: "", lapsedFrom: 0, hosted: past.length, nextPassIn: 0 };
  if (!past.length) return out;
  let count = 0, best = 0, passes = 0, n = 0, lapse = null, pause = null;
  for (let p = P(past[0]); p < cur; p++) {
    if (hosted.has(p)) { count++; n++; if (earns(n, cad)) passes = Math.min(LOOP.maxPasses, passes + 1); best = Math.max(best, count); continue; }
    if (!count) continue; // nothing to keep after a lapse
    if (passes > 0) { passes--; out.restUsed.push(periodStart(p, cad)); continue; }
    const e = periodEnd(p, cad), by = addDays(e, LOOP.repairDays), fix = past.find((d) => d > e && d <= by);
    if (fix) { out.repaired.push(periodStart(p, cad)); continue; }
    if (by >= now) { pause = { from: count, by }; break; } // still time to repair: paused, not over
    lapse = { from: count, by }; count = 0;
  }
  if (!pause && hosted.has(cur)) { count++; n++; if (earns(n, cad)) passes = Math.min(LOOP.maxPasses, passes + 1); best = Math.max(best, count); }
  Object.assign(out, { count, best: Math.max(best, count), passes, nextPassIn: passes >= LOOP.maxPasses ? 0 : LOOP.earnEvery[cad] - ((n - 1) % LOOP.earnEvery[cad]) });
  const lastClosed = periodStart(cur - 1, cad);
  if (pause) Object.assign(out, { status: "repairable", repairBy: pause.by, lapsedFrom: pause.from, count: pause.from });
  else if (!count && lapse) Object.assign(out, { status: "lapsed", lapsedFrom: lapse.from });
  else if (out.hostedThisPeriod) out.status = lapse && count === 1 ? "restarted" : "done";
  else if (out.restUsed.includes(lastClosed)) out.status = "resting";
  else out.status = "open";
  if (lapse) out.lapsedFrom = lapse.from;
  return out;
}

const fmtDay = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const unitWord = (cad, n) => (cad === "week" ? plural(n, "week") : plural(n, "month"));

/** The one line under the streak, in Potto's voice. Pure. */
export function streakLine(s) {
  const unit = s.cadence === "week" ? "week" : "month", run = (n) => (n === 1 ? `One ${unit} so far` : `${n} ${unit}s in a row`), named = (n) => `${n}-${unit} streak`, when = s.cadence === "week" ? "this week" : `in ${s.periodLabel}`;
  switch (s.status) {
    case "none": return { line: "Your first one starts a streak. Dinner for four is plenty.", tone: "start" };
    case "off": return { line: s.count ? `${s.count === 1 ? "One event" : `${s.count} events`} hosted. No streak to keep; every one counts.` : "No streak to keep. Every event counts when it happens.", tone: "good" };
    case "done": return { line: `${run(s.count)}. ${s.cadence === "week" ? "This week" : s.periodLabel} is covered.`, tone: "good" };
    case "restarted": return { line: "A new run, started. The first one back is the hardest, and it's done.", tone: "good" };
    case "resting": return { line: `A rest pass covered last ${unit}. Your ${named(s.count)} is safe.`, tone: "rest" };
    case "repairable": return { line: `Your ${named(s.count)} is paused, not gone. Host anything by ${fmtDay(s.repairBy)}, even a coffee, and it's back.`, tone: "repair" };
    case "lapsed": return { line: `Your ${named(s.lapsedFrom)} ended. Streaks end; tables don't. The next one starts a new run.${s.cadence === "month" ? " Big events, less often? Count events instead in Settings." : ""}`, tone: "restart" };
    default: return s.upcomingThisPeriod ? { line: `${run(s.count)}. Your next one, ${fmtDay(s.nextUpcoming)}, keeps it going.`, tone: "good" }
      : s.passes ? { line: `${run(s.count)}. Nothing ${when} yet, and that's fine.`, tone: "open" }
      : { line: `${run(s.count)}. Something small ${when} keeps it going.`, tone: "open" };
  }
}

/** Before a streak would lapse: a gentle heads-up with a tiny event idea, or null. Pure. */
export function headsUp(s, { days = 7 } = {}) {
  if (s.status === "repairable") return { kind: "repair", text: `The table misses you. Even a coffee counts. ${fmtDay(s.repairBy)} is the last day to keep your ${s.count}-${s.cadence === "week" ? "week" : "month"} streak.`, idea: "Coffee for two", t: "coffee" };
  if (s.status !== "open" || !s.count || s.upcomingThisPeriod || s.daysLeft > days) return null;
  const ends = s.cadence === "week" ? "The week ends Sunday" : `${s.periodLabel} ends ${s.daysLeft <= 1 ? "tomorrow" : `in ${s.daysLeft} days`}`;
  return s.passes ? { kind: "pass", text: `${ends}. If it stays quiet, a rest pass covers it. Or a coffee for two counts too.`, idea: "Coffee for two", t: "coffee" }
    : { kind: "last", text: `${ends}. The table misses you. Even a coffee counts.`, idea: "Coffee for two", t: "coffee" };
}

// ---------- small moves ----------
export const MOVES = {
  plan: { label: "Pick a night for dinner for 4", why: "Four is a table. You can decide the rest later.", min: 2 },
  remind: { label: "Send a reminder", why: "One line to the people who are in. It helps them show up.", min: 1 },
  reply: { label: "Answer a reply", why: "Someone asked to join. A yes or a kind no both count.", min: 1 },
  thank: { label: "Thank your guests", why: "A short thank-you the day after is the thing people remember.", min: 2 },
  photo: { label: "Post one photo from last time", why: "One is enough. It tells the next guest what it's like.", min: 1 },
  nextdate: { label: "Set the next date", why: "A date on the calendar is most of the work.", min: 2 },
  feeler: { label: "Share a feeler", why: "\"Would you come to a dumpling night?\" Ask three people and see.", min: 2 },
  invite: { label: "Invite one new person", why: "One new face keeps a table interesting.", min: 1 },
};
/**
 * The small moves that fit this host right now, best first. Pure.
 * f: { events, upcoming: [{id,name,date,going,cap,reminded}], last: {id,name,date,going,thanked,photos}, asks, now }
 */
export function smallMoves(f = {}, { order = "context", done = [] } = {}) {
  const now = f.now || today(), L = [], add = (id, extra = {}) => { if (!L.some((x) => x.id === id)) L.push({ id, ...MOVES[id], minutes: MOVES[id].min, ...extra }); };
  const up = (f.upcoming || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date))), soon = up.find((e) => daysBetween(now, e.date) <= 7 && !e.reminded && e.going > 0), last = f.last;
  if (!f.events && !up.length) { add("plan", { href: "/start" }); add("feeler", { href: "/start?t=feeler" }); add("invite", { href: "/start" }); }
  if (soon) add("remind", { eventId: soon.id, href: `/?app=1&open=${encodeURIComponent(soon.id)}&step=6#studio`, about: soon.name });
  if (f.asks > 0) add("reply", { href: up[0] ? `/?app=1&open=${encodeURIComponent(up[0].id)}&step=6#studio` : "/?app=1", about: plural(f.asks, "person", "people") + " waiting" });
  if (last && daysBetween(last.date, now) <= 14 && !last.thanked && last.going > 0) add("thank", { eventId: last.id, href: `/?app=1&open=${encodeURIComponent(last.id)}&step=6#studio`, about: last.name });
  if (last && daysBetween(last.date, now) <= 30 && !last.photos) add("photo", { eventId: last.id, href: `/?app=1&open=${encodeURIComponent(last.id)}#studio`, about: last.name });
  if (!up.length && last) add("nextdate", { eventId: last.id, href: `/start?t=again&from=${encodeURIComponent(last.id)}`, about: last.name });
  const open = up.find((e) => !e.cap || e.going < e.cap); if (open) add("invite", { eventId: open.id, href: `/?app=1&open=${encodeURIComponent(open.id)}#studio`, about: open.name });
  const real = L.length; add("feeler", { href: "/start?t=feeler" }); add("invite", { href: up[0] ? `/?app=1&open=${encodeURIComponent(up[0].id)}#studio` : "/start" });
  const D = new Set(done), rank = L.map((x, i) => ({ ...x, i, done: D.has(x.id), fill: i >= real }));
  // the quickest order sorts the moves that fit the moment; the always-there fillers stay last
  if (order === "quickest" && (f.events || up.length)) rank.sort((a, b) => a.fill - b.fill || a.minutes - b.minutes || a.i - b.i);
  return rank.map(({ i, fill, ...x }) => x);
}
/** Today's one move: the first one not done today. */
export const todaysMove = (list) => list.find((x) => !x.done) || null;

// ---------- warmth points ----------
export const WARMTH = { event: 10, guest: 2, again: 3, move: 1, movesPerMonth: 20 };
/** Warmth points for a period [from, to] (inclusive ISO days). events: [{date, guests, again}], moves: [{at}]. Pure. */
export function warmthOf({ events = [], moves = [] } = {}, from, to) {
  const E = events.filter((e) => e.date >= from && e.date <= to), M = moves.filter((m) => { const d = new Date(m.at).toISOString().slice(0, 10); return d >= from && d <= to; });
  const parts = { events: E.length * WARMTH.event, guests: E.reduce((a, e) => a + (+e.guests || 0), 0) * WARMTH.guest, again: E.reduce((a, e) => a + (+e.again || 0), 0) * WARMTH.again, moves: Math.min(WARMTH.movesPerMonth, M.length) * WARMTH.move };
  return { points: parts.events + parts.guests + parts.again + parts.moves, parts };
}
export const ring = (points, goal) => ({ points, goal, pct: Math.min(100, Math.round((100 * points) / Math.max(1, goal))), met: points >= goal });

// ---------- milestones ----------
export const MILESTONES = [
  { id: "first", test: (s) => s.published >= 1 && !(s.hosted >= 1), /* a first, not the fifth: someone who has already held one is never told this is their first */ title: "Your first one is out in the world.", line: "Now the only job is to show up. I'll keep the list." },
  // the first guest to say yes, before the host has held anything: the moment it turns into a real night (the sheet names the guest, see stateOf)
  { id: "firstyes", test: (s) => s.guests >= 1 && !(s.hosted >= 1), title: "Your first yes.", line: "Someone's coming. It's a real night now." },
  { id: "tenth", test: (s) => s.hosted >= 10, title: "Ten nights hosted.", line: "That's a habit now. A good one." },
  { id: "soldout", test: (s) => s.soldOut >= 1, title: "Every spot taken.", line: "Your first sold-out night. Someone's on the waitlist wishing they'd been faster." },
  { id: "regular", test: (s) => s.regulars >= 1, title: "You have a regular.", line: "Someone came back a third time. That's the whole point." },
];
/** The next milestone to celebrate (achieved, not seen yet), or null. Pure. */
export const nextCelebration = (stats, seen = []) => MILESTONES.find((m) => m.test(stats) && !seen.includes(m.id)) || null;

// ---------- the host path ----------
// Each node links to its guide (server/guides.js, /guides/<id>) when there is one, else to its own notes on /path.
const GUIDE_OF = { dinner4: "first-supper", booked: "book-a-table", table8: "first-supper", ticketed: "first-supper", regular: "game-night", series: "grow-regulars", soldout: "grow-regulars", weekend: "weekend-away", summit: "small-summit" };
export const guideHrefOf = (id) => (GUIDES.some((g) => g.id === GUIDE_OF[id]) ? `/guides/${GUIDE_OF[id]}` : `/path#guide-${id}`);
export const PATH = [
  { id: "dinner4", title: "Dinner for 4", test: (f) => f.hosted >= 1, steps: ["Pick a night two weeks out.", "Ask three people you'd like at the same table.", "Cook one thing well. Buy the rest."] },
  { id: "booked", title: "Book a table for friends", test: (f) => f.tables >= 1, steps: ["Book for the number you expect, not the number you invite.", "Give a reply-by day two days before.", "Call the restaurant when the count moves."] },
  { id: "table8", title: "A table of 8", test: (f) => f.maxGuests >= 8, steps: ["Invite ten. About eight will be in.", "Seat people next to someone new.", "Send a reminder the day before."] },
  { id: "regular", title: "A regular night", test: (f) => f.hosted >= 3 && f.streakBest >= 3, steps: ["Same day, same time, every month.", "Say the next date out loud at the end.", "Let a regular bring a friend."] },
  { id: "ticketed", title: "Your first ticketed event", test: (f) => f.ticketed >= 1, steps: ["Price to cover costs, then a little.", "Say what the money pays for.", "Keep a few spots for people you know."] },
  { id: "series", title: "A series", test: (f) => f.series >= 1, steps: ["Give it a name people can say.", "Number the episodes.", "Your regulars hear first."] },
  { id: "soldout", title: "A sold-out night", test: (f) => f.soldOut >= 1, steps: ["Fewer spots than you think.", "Turn on the waitlist.", "Tell the waitlist first next time."] },
  { id: "weekend", title: "A weekend away", test: (f) => f.multiDay >= 1, steps: ["Book the place before the people.", "Share a rough plan, not a schedule.", "Collect money early."] },
  { id: "summit", title: "A summit", test: (f) => f.maxGuests >= 60, steps: ["Start with five speakers you know.", "A host for every room.", "Leave the hallway time long."] },
];
export function pathOf(f) { let nextSet = false; return PATH.map((n) => { const done = !!n.test(f), next = !done && !nextSet; if (next) nextSet = true;
  return { id: n.id, title: n.title, state: done ? "done" : next ? "next" : "later", steps: n.steps, template: `/start?t=${({ booked: "table" })[n.id] || n.id}`, guideHref: guideHrefOf(n.id) }; }); }

/** Badges: everything recognition.js earns, plus the ones the loop adds. Pure. */
export function loopBadges(base, f, s) {
  const B = (base?.badges || []).slice();
  if (s.restUsed.length && s.count > 0 && s.status !== "repairable") B.push({ id: "rested", label: "Rested and back", why: "Took a rest month and kept hosting" });
  if (s.repaired.length) B.push({ id: "repaired", label: "Picked it back up", why: "Repaired a streak within two weeks" });
  if (f.soldOut) B.push({ id: "soldout", label: "Sold out once", why: "Every spot taken at least once" });
  if (f.regulars) B.push({ id: "regular", label: "Has regulars", why: `${plural(f.regulars, "guest")} came three times or more` });
  if (f.movesDone >= 10) B.push({ id: "moves", label: "Ten small moves", why: "Small things, done often" });
  return B;
}

// ---------- circles ----------
export const CIRCLE = { size: 10, min: 4, promote: 3, tiers: ["Kitchen table", "Long table", "Garden table", "Banquet table"] };
export const bandOf = (avgGuests) => (avgGuests >= 25 ? "large" : avgGuests >= 9 ? "mid" : "small");
const h8 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 12);
const chunk = (L, size) => { const n = Math.max(1, Math.ceil(L.length / size)), per = Math.ceil(L.length / n), out = []; for (let i = 0; i < L.length; i += per) out.push(L.slice(i, i + per)); return out; };
/**
 * Group opted-in hosts into circles of about 10: same cadence and table, then same city and size, then same city,
 * then anyone at that table. Deterministic for a period. members: [{ws, city, band, tier, cadence}]. Pure.
 */
export function groupCircles(members, periodKey) {
  const out = [], by = (L, f) => { const m = new Map(); for (const x of L) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
  const shuffle = (L) => L.slice().sort((a, b) => h8(periodKey + a.ws).localeCompare(h8(periodKey + b.ws)));
  const emit = (L, city, band) => { for (const g of chunk(shuffle(L), CIRCLE.size)) out.push({ id: h8(periodKey + g.map((x) => x.ws).sort().join(",")), tier: g[0].tier || 0, cadence: g[0].cadence, city, band, members: g.map((x) => x.ws) }); };
  for (const [, T] of by(members, (x) => `${x.cadence}|${x.tier || 0}`)) {
    const rest = [];
    for (const [, L] of by(T, (x) => `${lc(x.city)}|${x.band}`)) (L.length >= CIRCLE.min ? emit(L, L[0].city || "", L[0].band) : rest.push(...L));
    const rest2 = [];
    for (const [, L] of by(rest, (x) => lc(x.city))) (L.length >= CIRCLE.min && L[0].city ? emit(L, L[0].city, null) : rest2.push(...L));
    if (rest2.length) emit(rest2, null, null);
  }
  return out;
}
/** A circle's board for a period: ranked on effort; the top 3 (with points) are moving up, everyone else stays. Pure. */
export function boardOf(scores, { closed = false } = {}) {
  const L = scores.slice().sort((a, b) => b.points - a.points || String(a.name).localeCompare(String(b.name)));
  return L.map((x, i) => ({ ...x, place: i + 1, standing: i < CIRCLE.promote && x.points > 0 ? (closed ? "Moved up" : "Moving up") : "Staying" }));
}
/** After a period: the next tier for each member. Top 3 move up one table; nobody moves down. Pure. */
export function settleTiers(board, tiers) { const next = { ...tiers }; for (const x of board) { const t = +tiers[x.ws] || 0; next[x.ws] = x.standing.startsWith("Mov") ? Math.min(CIRCLE.tiers.length - 1, t + 1) : t; } return next; }

// ---------- notifications ----------
const parts = (ms, tz) => { const o = {}; for (const p of new Intl.DateTimeFormat("en-US", { timeZone: tzOk(tz) ? tz : "UTC", weekday: "short", hour: "numeric", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms))) o[p.type] = p.value; return { wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(o.weekday), hour: +o.hour % 24, day: `${o.year}-${o.month}-${o.day}` }; };
export const localHour = (ms, tz) => parts(ms, tz).hour;
export const inQuiet = (ms, tz, q = LOOP.quiet) => { const h = localHour(ms, tz), [a, b] = q; return a > b ? h >= a || h < b : h >= a && h < b; };
/** The host's usual planning day and hour, from when they made events (local time). Sunday 6pm until there are 3. Pure. */
export function usualRhythm(times = [], tz = "UTC") {
  const T = times.filter((t) => +t > 0); if (T.length < 3) return { weekday: 0, hour: 18, learned: false };
  const wd = new Map(), hr = new Map(); for (const t of T) { const p = parts(+t, tz); wd.set(p.wd, (wd.get(p.wd) || 0) + 1); hr.set(p.hour, (hr.get(p.hour) || 0) + 1); }
  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  let hour = top(hr); if (inQuiet(Date.UTC(2026, 0, 5, hour), "UTC")) hour = hour >= 21 ? 20 : 9; // a night owl still hears from Potto at a kind hour
  return { weekday: top(wd), hour, learned: true };
}
/** The next moment at or after `from` that is this weekday and hour in tz (an hour's precision). */
export function nextAt(from, { weekday = null, hour }, tz) { const s = Math.ceil(from / 3600e3) * 3600e3; for (let i = 0; i < 24 * 9; i++) { const t = s + i * 3600e3, p = parts(t, tz); if (p.hour === hour && (weekday == null || p.wd === weekday)) return t; } return s; }
/** The last moment at or before `from` that is this weekday and hour in tz. */
export function prevAt(from, { weekday = null, hour }, tz) { const s = Math.floor(from / 3600e3) * 3600e3; for (let i = 0; i < 24 * 9; i++) { const t = s - i * 3600e3, p = parts(t, tz); if (p.hour === hour && (weekday == null || p.wd === weekday)) return t; } return s; }
/** Their usual moment once the nudge became true (the last one since `since`), else the next one. */
const rhythmAt = (now, r, tz, since) => { const p = prevAt(now, r, tz); return p >= since ? p : nextAt(now, r, tz); };
/** Out of quiet hours: the next morning at the end of them. */
export const outOfQuiet = (ms, tz, q = LOOP.quiet) => (inQuiet(ms, tz, q) ? nextAt(ms, { hour: q[1] }, tz) : ms);
const dayMs = (d, tz, hour) => nextAt(Date.parse(d + "T00:00:00Z") - 14 * 3600e3, { hour }, tz);

export const NUDGE_TYPES = { prep: "Before an event: a short checklist", thanks: "After an event: thank your guests", streak: "Streak heads-ups", comeback: "A nudge when it's been a while" };
/** Every nudge that could go out for this host, with when. Pure. ctx: { tz, rhythm, upcoming, last, streak, headsUpDays, cadence } */
export function planNudges(ctx, now = Date.now()) {
  const tz = ctx.tz || "UTC", r = ctx.rhythm || { weekday: 0, hour: 18 }, L = [], day = parts(now, tz).day;
  for (const e of ctx.upcoming || []) { const d = daysBetween(day, e.date); if (d < 1 || d > 2) continue;
    L.push({ type: "prep", key: `prep:${e.id}`, at: dayMs(addDays(e.date, -1), tz, 10), title: "Potto", body: `${e.name} is tomorrow. Three things: send a reminder, check the spots, pick a playlist. That's it.`, link: `/?app=1&open=${encodeURIComponent(e.id)}#studio` }); }
  const last = ctx.last;
  if (last && daysBetween(last.date, day) >= 1 && daysBetween(last.date, day) <= 3 && last.going > 0)
    L.push({ type: "thanks", key: `thanks:${last.id}`, at: dayMs(addDays(last.date, 1), tz, 10), title: "Potto", body: `How was ${last.name}? A two-line thank-you to the ${plural(last.going, "guest")} who came is the thing they'll remember.`, link: `/?app=1&open=${encodeURIComponent(last.id)}&step=6#studio` });
  const s = ctx.streak, hu = s ? headsUp(s, { days: ctx.headsUpDays || 7 }) : null;
  if (hu) L.push({ type: "streak", key: `streak:${s.cadence}:${s.period}`, at: Math.min(rhythmAt(now, r, tz, Date.parse(addDays(s.repairBy || s.periodEnd, -(ctx.headsUpDays || 7)) + "T00:00:00Z")), dayMs(s.repairBy || s.periodEnd, tz, r.hour)), title: "Potto", body: hu.text, link: "/start?t=coffee" });
  if (last && !(ctx.upcoming || []).length) { const gap = daysBetween(last.date, day), wk = Math.floor(gap / 7), due = ctx.cadence === "week" ? 10 : 28;
    // twice at most for the same last event (at about a month, then three weeks later), then Potto lets it be
    if (gap >= due && gap <= due + 42) L.push({ type: "comeback", key: `comeback:${last.id}:${gap >= due + 21 ? 2 : 1}`, at: rhythmAt(now, r, tz, Date.parse(addDays(last.date, due) + "T00:00:00Z")), title: "Potto", body: `It's been ${plural(wk, "week")} since ${last.name}. Same crew, new ${ctx.cadence === "week" ? "week" : "month"}?`, link: `/start?t=again&from=${encodeURIComponent(last.id)}` }); }
  // one note about hosting again, not two: the comeback line says it more kindly than the streak heads-up
  const M = L.some((n) => n.type === "comeback") ? L.filter((n) => n.type !== "streak") : L;
  return M.map((n) => ({ ...n, at: outOfQuiet(n.at, tz, ctx.quiet || LOOP.quiet) }));
}
const ORDER = ["prep", "thanks", "streak", "comeback"];
/** Which nudges go now: due, not sent before, the kind is on, not in quiet hours, at most 2 in any 7 days. Pure. */
export function dueNudges(cands, { now = Date.now(), tz = "UTC", prefs = {}, sent = [], cap = LOOP.capPerWeek } = {}) {
  if (prefs.on === false || inQuiet(now, tz, prefs.quiet || LOOP.quiet)) return [];
  const recent = sent.filter((x) => now - x.at < 7 * DAY).length, room = Math.max(0, cap - recent), keys = new Set(sent.map((x) => x.key));
  return cands.filter((n) => n.at <= now && now - n.at < 2 * DAY && !keys.has(n.key) && prefs[n.type] !== false).sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type)).slice(0, room);
}

// ---------- the pre-signup draft ----------
const nextFriday = (now) => { const d = new Date(now + "T12:00:00Z"); const add = (5 - d.getUTCDay() + 7) % 7 || 7; d.setUTCDate(d.getUTCDate() + add); return d.toISOString().slice(0, 10); };
/** A visitor's draft from /start, made safe and shaped as an event. Pure. */
export function draftToEvent(d = {}, { now = today(), city = "", tz = "" } = {}) {
  const title = clean(d.title, 80) || "Dinner for 4", seats = Math.max(2, Math.min(200, Math.round(+d.seats || 4))), date = ISO.test(d.date || "") && d.date >= now ? d.date : nextFriday(now);
  const ev = { name: title, pubTitle: title, date, startTime: TIME.test(d.time || "") ? d.time : "19:00", headcount: seats, casual: true, activity: clean(d.kind, 30).toLowerCase() || "dinner", concept: clean(d.note, 280),
    venueName: clean(d.place, 80), city: clean(d.city || city, 60), discoverable: false, fromStart: true, createdAt: Date.now() };
  if (tz && tzOk(tz)) ev.tz = tz;
  if (ISO.test(d.endDate || "") && d.endDate > date) ev.endDate = d.endDate;
  // the kind the template started from (server/kinds.js): a booked table, a weekend away, a summit
  const kind = { table: "table", weekend: "weekend", summit: "summit", game: "game", dinner4: "dinner", table8: "dinner", soldout: "dinner", again: "dinner", drinks: "drinks", coffee: "brunch", potluck: "potluck", picnic: "picnic", run: "run", bookclub: "book", series: "hack" }[d.t];
  if (kind) ev.planKind = kind;
  if (kind === "table") { const place = clean(d.place, 80); ev.activity = "dinner"; ev.headcount = Math.max(1, seats - 1); ev.reservation = { restaurant: place, time: ev.startTime, party: seats, split: "even", holdUntil: addDays(date, -2) < now ? now : addDays(date, -2) }; ev.noMaybe = true; }
  if (kind === "weekend") { ev.carpool = true; ev.noMaybe = true; if (!ev.endDate) ev.endDate = addDays(date, 2); ev.lodging = { area: clean(d.place, 60) }; }
  if (kind === "summit") { ev.kind = "summit"; ev.noMaybe = true; ev.itineraryPublic = true; ev.agenda = { tracks: ["Main stage", "Workshops"], rooms: [{ name: "Main hall", capacity: seats }, { name: "Studio", capacity: Math.max(10, Math.round(seats / 4)) }], sessions: [] }; }
  if (ev.concept) ev.why = ev.concept; // "A line for guests" is for guests: it shows on the invite
  if (!ev.concept) delete ev.concept; if (!ev.venueName) delete ev.venueName; if (!ev.city) delete ev.city;
  return ev;
}

// ---------- Potto's lines for empty states and the card ----------
export const POTTO = {
  empty: "Nothing on the calendar. That's fine. A dinner for four is a whole event.",
  moveDone: ["Done. That counts.", "Noted in the book.", "Small, and it counts.", "That's the move. Nice."],
  allDone: "That's today's move done. The rest can wait.",
  circlesIntro: "A small circle of about ten hosts near your size. You're ranked on effort, not fame. The top three move up a table. Nobody moves down. Leave any time.",
};

// ---------- the loop, on the store ----------
export function makeHostLoop(store, { C, X, push = () => null, origin = () => process.env.ENCORE_PUBLIC_URL || "" } = {}) {
  const key = (ws) => "system/hostloop-" + ws;
  const base = (ws) => ({ kind: "hostloop", ws, cadence: "month", showStreak: false, goal: LOOP.goal, sounds: false, notif: { on: true, prep: true, thanks: true, streak: true, comeback: true }, quiet: LOOP.quiet, seen: [], moves: [], sent: [], circle: { on: false, cadence: "month", tier: 0 }, createdAt: Date.now() });
  function get(ws) { const d = store.get(key(ws))?.data; return d ? { ...base(ws), ...d, notif: { ...base(ws).notif, ...(d.notif || {}) }, circle: { ...base(ws).circle, ...(d.circle || {}) } } : null; }
  const put = (ws, d) => store.set(key(ws), d);
  /** First time: start the record; an existing host's old milestones count as seen (we celebrate what happens next). */
  function ensure(ws, f) { let d = get(ws); if (d) return d; d = base(ws); const W = getWorkspace(ws), fresh = !W?.createdAt || Date.now() - W.createdAt < 3 * DAY;
    if (!fresh && f) d.seen = MILESTONES.filter((m) => m.test(f)).map((m) => m.id); put(ws, d); return d; }

  /** Everything the loop knows about a host, from their events, replies, kudos and photos. */
  function facts(ws, now = today()) {
    const S = scopeStore(store, ws), evs = S.list("events").map((x) => ({ id: x.id, e: x.data || {}, updated: x.updated })).filter((x) => x.e && !x.e.example && !x.e.sample && !x.e.cancelled && x.e.stage !== "interest" && ISO.test(x.e.date || ""));
    const R = S.list("rsvps").map((x) => x.data || {}), going = new Map(), asks = R.filter((r) => r.response === "requested").length, people = new Map();
    for (const r of R) if (r.response === "going" && r.noShow !== true && r.eventId) { going.set(r.eventId, (going.get(r.eventId) || 0) + 1 + Math.max(0, Math.min(10, +r.party - 1 || 0)));
      const who = lc(r.email || r.phone || r.name); if (who) { if (!people.has(who)) people.set(who, new Set()); people.get(who).add(r.eventId); } }
    let I = null; try { I = X?.index?.(); } catch {}
    const kudos = I ? I.kudos.filter((k) => k.ws === ws) : [], photos = new Set(I ? I.moments.filter((m) => m.ws === ws).map((m) => m.eventId) : []);
    const D = get(ws), moved = (id, eventId) => (D?.moves || []).some((m) => m.id === id && m.eventId === eventId);
    const shared = (x) => !!(x.e.published || x.e.discoverable || going.get(x.id));
    const pastE = evs.filter((x) => x.e.date <= now && shared(x)).sort((a, b) => a.e.date.localeCompare(b.e.date)), upE = evs.filter((x) => x.e.date > now && (x.e.published || x.e.discoverable)).sort((a, b) => a.e.date.localeCompare(b.e.date));
    const again = (id) => kudos.filter((k) => k.eventId === id && ((k.tags || []).includes("again") || k.compare === "better")).length;
    const pastIds = new Set(pastE.map((x) => x.id)), regulars = [...people.values()].filter((s) => [...s].filter((id) => pastIds.has(id)).length >= 3).length;
    const cap = (e) => +e.headcount || 0, name = (x) => clean(x.e.pubTitle || x.e.name, 60) || "your last one";
    const last = pastE[pastE.length - 1];
    return {
      now, hosted: pastE.length, published: evs.filter((x) => x.e.published || x.e.discoverable).length, events: evs.length,
      dates: pastE.map((x) => x.e.date), upcomingDates: upE.map((x) => x.e.date),
      list: pastE.map((x) => ({ id: x.id, date: x.e.date, guests: going.get(x.id) || 0, again: again(x.id) })),
      upcoming: upE.map((x) => ({ id: x.id, name: name(x), date: x.e.date, going: going.get(x.id) || 0, cap: cap(x.e), reminded: !!x.e.remindedAt || moved("remind", x.id) })),
      last: last ? { id: last.id, name: name(last), date: last.e.date, going: going.get(last.id) || 0, thanked: moved("thank", last.id), photos: photos.has(last.id) || moved("photo", last.id) } : null,
      asks, regulars, guests: [...people.keys()].length, firstGuest: clean(String(R.filter((r) => r.response === "going" && r.noShow !== true && r.eventId && r.name).sort((a, b) => (+a.at || +a.createdAt || 0) - (+b.at || +b.createdAt || 0))[0]?.name || "").trim().split(/\s+/)[0], 24),
      maxGuests: Math.max(0, ...pastE.map((x) => going.get(x.id) || 0)), soldOut: pastE.concat(upE).filter((x) => cap(x.e) >= 2 && (going.get(x.id) || 0) >= cap(x.e)).length,
      ticketed: pastE.concat(upE).filter((x) => { const p = String(x.e.price ?? ""); return p && !/^(free|0|\$?0|chip)$/i.test(p) && !x.e.free; }).length,
      series: evs.filter((x) => x.e.series === true || x.e.repeat === "weekly" || x.e.repeat === "monthly" || x.e.episode).length ? 1 : 0,
      multiDay: evs.filter((x) => ISO.test(x.e.endDate || "") && x.e.endDate > x.e.date).length,
      tables: evs.filter((x) => x.e.planKind === "table" || !!x.e.reservation?.restaurant).length,
      createdTimes: evs.map((x) => +x.e.createdAt || x.updated || 0).filter(Boolean),
      tz: (() => { const z = [...evs].reverse().map((x) => x.e.tz).find((t) => tzOk(t)); return z || tzOfCity(C?.profileOf?.(ws)?.city) || process.env.ENCORE_TZ || "UTC"; })(),
      movesDone: (D?.moves || []).length,
    };
  }
  const variantOf = (k, ws) => expose(k, ws) || assign(k, ws);
  function streakOfWs(ws, f, d) { return streakState({ dates: f.dates, upcoming: f.upcomingDates, cadence: d.cadence, now: f.now }); }
  function warmthFor(ws, f, d, from, to) { return warmthOf({ events: f.list, moves: d.moves }, from, to); }
  const monthRange = (now) => [now.slice(0, 8) + "01", periodEnd(periodOf(now, "month"), "month")];

  /** Host Home's card: the streak, today's small move, warmth, a celebration once, the path and circles. */
  function stateOf(ws, { now = today(), peek = false } = {}) {
    const f = facts(ws, now), d = ensure(ws, f), s = streakOfWs(ws, f, d), line = streakLine(s);
    const hv = d.cadence === "week" ? LOOP.headsUp.week : d.cadence === "off" ? 0 : LOOP.headsUp.month[variantOf("streak-headsup-timing", ws)] || 7;
    const doneToday = d.moves.filter((m) => new Date(m.at).toISOString().slice(0, 10) === now).map((m) => m.id);
    const order = variantOf("small-move-order", ws), list = smallMoves({ ...f }, { order, done: doneToday }).slice(0, 5);
    const [from, to] = monthRange(now), w = warmthFor(ws, f, d, from, to);
    let celebrate = nextCelebration(f, d.seen); if (celebrate && !peek) { d.seen = [...d.seen, celebrate.id]; put(ws, d); }
    const base0 = badgesFor({ dates: f.dates, upcoming: f.upcomingDates, guests: f.guests, rhythm: d.cadence });
    return {
      prefs: { cadence: d.cadence, showStreak: !!d.showStreak, goal: d.goal, sounds: !!d.sounds, notif: d.notif, quiet: d.quiet },
      streak: { ...s, ...line }, headsUp: headsUp(s, { days: hv }),
      moves: { today: todaysMove(list), list, order, doneToday },
      warmth: { ...ring(w.points, d.goal), parts: w.parts, month: MONTHS[+now.slice(5, 7) - 1] },
      celebrate: celebrate ? { id: celebrate.id, ...(celebrate.id === "firstyes" && f.firstGuest ? { title: `${f.firstGuest} is in.`, line: "Your first yes. It's a real night now." } : { title: celebrate.title, line: celebrate.line }), eventId: f.upcoming[0]?.id || f.last?.id || "" } : null,
      path: pathOf({ ...f, streakBest: s.best }), badges: loopBadges(base0, f, s).map(({ id, label, why }) => ({ id, label, why })),
      circle: { on: !!d.circle.on, cadence: d.circle.cadence, tier: CIRCLE.tiers[d.circle.tier || 0] },
      potto: f.events ? "" : POTTO.empty, hosted: f.hosted, events: f.events,
    };
  }
  function setPrefs(ws, b = {}) { const f = facts(ws), d = ensure(ws, f);
    if (b.cadence === "week" || b.cadence === "month" || b.cadence === "off") d.cadence = b.cadence;
    if (b.showStreak != null) d.showStreak = !!b.showStreak; if (b.sounds != null) d.sounds = !!b.sounds;
    if (LOOP.goals.includes(+b.goal)) d.goal = +b.goal;
    if (b.notif && typeof b.notif === "object") for (const k of ["on", ...Object.keys(NUDGE_TYPES)]) if (b.notif[k] != null) d.notif[k] = !!b.notif[k];
    if (Array.isArray(b.quiet) && b.quiet.length === 2 && b.quiet.every((h) => Number.isInteger(+h) && +h >= 0 && +h < 24)) d.quiet = b.quiet.map(Number);
    put(ws, d); return stateOf(ws, { peek: true }).prefs; }
  function doMove(ws, id, eventId = "") { if (!MOVES[id]) return null; const d = ensure(ws, facts(ws)), day = today(), ev = /^[A-Za-z0-9_-]{1,80}$/.test(eventId) ? eventId : "";
    if (!d.moves.some((m) => m.id === id && new Date(m.at).toISOString().slice(0, 10) === day && (m.eventId || "") === ev)) { d.moves = [...d.moves, { id, at: Date.now(), ...(ev ? { eventId: ev } : {}) }].slice(-400); put(ws, d); convert("small-move-order", ws, "move_done"); }
    const n = d.moves.length; return { ok: true, line: POTTO.moveDone[n % POTTO.moveDone.length], state: stateOf(ws, { peek: true }) }; }
  const streakPublic = (ws) => !!get(ws)?.showStreak;
  function publicStreak(ws) { if (!streakPublic(ws)) return null; const f = facts(ws), d = get(ws), s = streakOfWs(ws, f, d); return s.count && s.cadence !== "off" ? { count: s.count, cadence: s.cadence, best: s.best, text: s.count === 1 ? `Hosting: one ${s.cadence} so far` : `${s.count} ${s.cadence}s of hosting in a row` } : null; }

  // ---- circles ----
  function members(cadence) { const out = [];
    for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; const d = get(ws); if (!d?.circle?.on || d.circle.cadence !== cadence) continue; const h = C?.profileOf?.(ws) || {}; let f; try { f = facts(ws); } catch { continue; }
      const recent = f.list.filter((x) => daysBetween(x.date, f.now) <= 90), avg = recent.length ? recent.reduce((a, x) => a + x.guests, 0) / recent.length : 0;
      out.push({ ws, city: clean(String(h.city || "").split(",")[0], 60), band: bandOf(avg), tier: d.circle.tier || 0, cadence, name: clean(h.name, 60) || "A host", handle: h.handle || "", f, d }); }
    return out; }
  function circleBoard(ws, { now = today() } = {}) {
    const d = get(ws); if (!d?.circle?.on) return null; const cad = d.circle.cadence, p = periodOf(now, cad), M = members(cad), G = groupCircles(M, `${cad}:${p}`), g = G.find((x) => x.members.includes(ws)); if (!g) return null;
    const from = periodStart(p, cad), to = periodEnd(p, cad), by = new Map(M.map((m) => [m.ws, m]));
    const scores = g.members.map((w) => { const m = by.get(w), W = warmthOf({ events: m.f.list, moves: m.d.moves }, from, to); return { ws: w, name: m.name, handle: m.handle, points: W.points, events: m.f.list.filter((x) => x.date >= from && x.date <= to).length, you: w === ws }; });
    const B = boardOf(scores).map(({ ws: w, ...x }) => x);
    return { tier: CIRCLE.tiers[g.tier] || CIRCLE.tiers[0], cadence: cad, city: g.city || "", size: g.members.length, ends: to, daysLeft: daysBetween(now, to), board: B, rule: "Ranked on effort: events held, guests welcomed, would-go-again and small moves. The top three move up a table. Everyone else stays. Nobody moves down." };
  }
  function setCircle(ws, b = {}) { const d = ensure(ws, facts(ws)); if (b.cadence === "week" || b.cadence === "month") d.circle.cadence = b.cadence;
    if (b.on != null) { d.circle.on = !!b.on; if (d.circle.on) d.circle.joinedAt = d.circle.joinedAt || Date.now(); } put(ws, d); return { on: d.circle.on, cadence: d.circle.cadence, tier: CIRCLE.tiers[d.circle.tier || 0] }; }
  /** At the end of each period: the top 3 of every circle move up a table. Idempotent per period. */
  function settle(now = today()) {
    const K = "system/hostloop-settled", done = store.get(K)?.data?.periods || []; let moved = 0;
    for (const cad of ["week", "month"]) { const p = periodOf(now, cad) - 1, tag = `${cad}:${p}`; if (done.includes(tag)) continue;
      const M = members(cad), from = periodStart(p, cad), to = periodEnd(p, cad), by = new Map(M.map((m) => [m.ws, m]));
      for (const g of groupCircles(M, tag)) { const B = boardOf(g.members.map((w) => ({ ws: w, name: by.get(w).name, points: warmthOf({ events: by.get(w).f.list, moves: by.get(w).d.moves }, from, to).points })), { closed: true });
        const next = settleTiers(B, Object.fromEntries(g.members.map((w) => [w, by.get(w).d.circle.tier || 0])));
        for (const w of g.members) if (next[w] !== (by.get(w).d.circle.tier || 0)) { const d = get(w); d.circle.tier = next[w]; put(w, d); moved++; } }
      done.push(tag); }
    store.set(K, { kind: "hostloop-settled", periods: done.slice(-60) }); return moved; }

  // ---- nudges ----
  function nudgesFor(ws, now = Date.now()) {
    const day = new Date(now).toISOString().slice(0, 10), f = facts(ws, day), d = ensure(ws, f), s = streakOfWs(ws, f, d);
    const hv = d.cadence === "week" ? LOOP.headsUp.week : LOOP.headsUp.month[assign("streak-headsup-timing", ws)] || 7;
    const ctx = { tz: f.tz, rhythm: usualRhythm(f.createdTimes, f.tz), upcoming: f.upcoming, last: f.last, streak: f.hosted ? s : null, headsUpDays: hv, cadence: d.cadence, quiet: d.quiet };
    return { cands: planNudges(ctx, now), d, f };
  }
  /** The Inbox (and so the bell and a push) first, through inbox.notify(); email only when they have no phone set up. */
  async function deliver(ws, n) {
    const W = getWorkspace(ws), em = lc(W?.ownerEmail); if (!em) return false;
    let belled = false; try { belled = inboxNotify(X, em, { kind: "nudge", type: "note", key: "hl-" + n.key, title: n.title || "Potto", text: n.body, link: n.link, actor: { name: "Potto" } }) !== false; } catch {}
    let phone = false; try { phone = !!push()?.devicesOf?.(em)?.length; } catch {}
    if (!phone && X?.canEmail?.(em) !== false) { const cfg = emailConfig(DEFAULT_WS, true); if (cfg) { try { await sendEmail(cfg, { to: em, subject: n.body.length > 60 ? n.body.slice(0, 57).replace(/\s+\S*$/, "") + "…" : n.body, text: `${n.body}\n\n${(origin() || "") + n.link}\n\nPotto, from Pottery Lab. Turn these off in Settings: ${(origin() || "")}/settings`, origin: origin() }); } catch {} } }
    return belled;
  }
  async function runJobs(now = Date.now()) {
    let sent = 0; try { settle(new Date(now).toISOString().slice(0, 10)); } catch (e) { console.warn("[hostloop] settle", e.message); }
    for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; const W = getWorkspace(ws); if (!W?.ownerEmail || /@demo\.encore$/i.test(W.ownerEmail) || W.personal === false) continue;
      let r; try { r = nudgesFor(ws, now); } catch { continue; } if (!r.f.events) continue;
      const go = dueNudges(r.cands, { now, tz: r.f.tz, prefs: { ...r.d.notif, quiet: r.d.quiet }, sent: r.d.sent });
      for (const n of go) { if (await deliver(ws, n)) { const d = get(ws); d.sent = [...(d.sent || []), { key: n.key, type: n.type, at: now }].slice(-60); put(ws, d); sent++; } } }
    return sent; }
  /** A sample of what Potto would send this host (for Settings and the screenshot), never sent. */
  function sample(ws) { const { cands, f } = nudgesFor(ws); return cands[0] || { type: "comeback", title: "Potto", body: f.last ? `It's been 5 weeks since ${f.last.name}. Same crew, new month?` : "It's been 5 weeks since Dumpling Night. Same crew, new month?", link: "/start?t=again" }; }

  return { get, ensure, facts, stateOf, setPrefs, doMove, streakPublic, publicStreak, circleBoard, setCircle, settle, nudgesFor, runJobs, deliver, sample };
}

export function mountHostLoop(app, { store, small, currentUser, C, X, sendStatic, publicOrigin }) {
  const L = makeHostLoop(store, { C, X, push: () => app.locals.appstore?.push, origin: () => process.env.ENCORE_PUBLIC_URL || "" });
  app.locals.hostloop = L; X.hostloop = L;
  const me = (req, res) => { const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) { res.status(401).json({ code: "unauthenticated", message: "Sign in first." }); return null; } return u; };
  const no = (res) => res.set("Cache-Control", "private, no-store");
  app.get("/start", (req, res) => sendStatic(res, "start.html", "<p>Start page missing.</p>"));
  app.get("/path", (req, res) => sendStatic(res, "path.html", "<p>Path page missing.</p>"));
  app.get("/circles", (req, res) => sendStatic(res, "circles.html", "<p>Circles page missing.</p>"));
  app.get("/api/me/hostloop", (req, res) => { const u = me(req, res); if (!u) return; if (getWorkspace(u.ws)?.personal === false) return no(res).json({ off: true }); no(res).json(L.stateOf(u.ws, { peek: req.query.peek === "1" })); });
  app.post("/api/me/hostloop/prefs", small, (req, res) => { const u = me(req, res); if (!u) return; const prefs = L.setPrefs(u.ws, req.body || {}); try { X.recognition?.reset?.(); } catch {} no(res).json({ ok: true, prefs }); });
  app.post("/api/me/hostloop/moves/:id", small, (req, res) => { const u = me(req, res); if (!u) return; const r = L.doMove(u.ws, String(req.params.id || ""), String(req.body?.eventId || "")); if (!r) return res.status(404).json({ code: "not_found", message: "No such move." }); no(res).json(r); });
  app.get("/api/me/hostloop/circle", (req, res) => { const u = me(req, res); if (!u) return; no(res).json({ circle: L.circleBoard(u.ws), intro: POTTO.circlesIntro, tiers: CIRCLE.tiers }); });
  app.post("/api/me/hostloop/circle", small, (req, res) => { const u = me(req, res); if (!u) return; const c = L.setCircle(u.ws, req.body || {}); no(res).json({ ok: true, ...c, circle: c.on ? L.circleBoard(u.ws) : null }); });
  app.get("/api/me/hostloop/sample", (req, res) => { const u = me(req, res); if (!u) return; no(res).json({ nudge: L.sample(u.ws), types: NUDGE_TYPES }); });
  // the visitor's draft from /start, once they have an account: shaped and cleaned here, saved by the app's own write
  // path (PUT /api/db/doc), so publishing still waits for a confirmed email like any other invite
  app.post("/api/me/hostloop/draft", small, (req, res) => { const u = me(req, res); if (!u) return; const b = req.body || {}, h = C?.profileOf?.(u.ws) || {};
    const ev = draftToEvent(b.draft || {}, { city: String(h.city || getWorkspace(u.ws)?.city || "").split(",")[0], tz: b.tz });
    const id = "st" + crypto.randomBytes(9).toString("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
    if (/^[A-Za-z0-9_-]{6,80}$/.test(String(b.u || ""))) convert("first-win-copy", "anon-" + b.u, "draft_saved");
    L.ensure(u.ws, null); no(res).json({ ok: true, id, event: ev }); });
  app.get("/api/public/host/:handle/streak", (req, res) => { const ws = C?.wsOfHandle?.(lc(req.params.handle)); res.set("Cache-Control", "public, max-age=120").json({ streak: ws ? L.publicStreak(ws) : null }); });
  return L;
}
