// The host loop (server/hostloop.js), the pure parts: streaks at a weekly and monthly cadence, rest passes, repair
// within 14 days, small moves per host state, warmth points, milestones once, Circles grouping with no demotion,
// and Potto's nudges: timing, caps, quiet hours and opt-outs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { streakState, streakLine, headsUp, smallMoves, todaysMove, warmthOf, ring, nextCelebration, MILESTONES, groupCircles, boardOf, settleTiers, CIRCLE, bandOf,
  usualRhythm, planNudges, dueNudges, inQuiet, localHour, draftToEvent, pathOf, LOOP, periodEnd, POTTO, NUDGE_TYPES, loopBadges } from "../server/hostloop.js";

const NOW = "2026-11-26"; // a Thursday
const wk = (n) => { const d = new Date(NOW + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 7 * n); return d.toISOString().slice(0, 10); };

test("Monthly streak (the default): counts months in a row and survives until the month is over", () => {
  const s = streakState({ dates: ["2026-09-12", "2026-10-03", "2026-11-07"], now: NOW });
  assert.equal(s.cadence, "month"); assert.equal(s.count, 3); assert.equal(s.status, "done");
  const open = streakState({ dates: ["2026-09-12", "2026-10-03"], now: NOW });
  assert.equal(open.count, 2); assert.equal(open.status, "open", "nothing yet in November: still counting");
  assert.equal(streakState({ dates: [], now: NOW }).status, "none");
  assert.equal(streakState({ dates: ["2026-12-05"], now: NOW }).status, "none", "a future event isn't hosting yet");
  assert.equal(streakState({ dates: ["2026-10-01", "2026-10-20"], now: NOW }).count, 1, "two in one month is one month");
});

test("Streaks can be off (a summit, a yearly trip): events count, nothing lapses, no heads-up", () => {
  const s = streakState({ dates: ["2026-03-10", "2026-09-20"], cadence: "off", now: NOW });
  assert.equal(s.status, "off"); assert.equal(s.count, 2); assert.equal(headsUp(s), null); assert.match(streakLine(s).line, /every one counts/);
  assert.match(streakLine(streakState({ dates: ["2026-08-10"], now: NOW })).line, /Count events instead in Settings/, "a lapsed monthly streak offers the switch");
});

test("Weekly streak for regular clubs: counts weeks in a row", () => {
  const s = streakState({ dates: [wk(0), wk(1), wk(2), wk(3)], cadence: "week", now: NOW });
  assert.equal(s.cadence, "week"); assert.equal(s.count, 4); assert.equal(s.status, "done");
  const s2 = streakState({ dates: [wk(1), wk(2), wk(3)], cadence: "week", now: NOW });
  assert.equal(s2.count, 3); assert.equal(s2.status, "open");
  assert.equal(periodEnd(s2.period, "week"), "2026-11-29", "a week ends on Sunday");
});

test("Rest passes: the first event earns one, then one every 3 hosted months, held up to 2, used automatically", () => {
  assert.equal(streakState({ dates: ["2026-11-02"], now: NOW }).passes, 1, "the first event earns the first pass");
  assert.equal(streakState({ dates: ["2026-08-02", "2026-09-02", "2026-10-02"], now: NOW }).passes, 1, "3 hosted months: still 1 (the next comes with the 4th)");
  const four = streakState({ dates: ["2026-07-02", "2026-08-02", "2026-09-02", "2026-10-02"], now: NOW }); assert.equal(four.passes, 2); assert.equal(four.nextPassIn, 0, "full");
  const many = streakState({ dates: ["2026-01-05", "2026-02-05", "2026-03-05", "2026-04-05", "2026-05-05", "2026-06-05", "2026-07-05", "2026-08-05", "2026-09-05", "2026-10-05"], now: NOW });
  assert.equal(many.passes, LOOP.maxPasses, "never more than 2");
  // a quiet October: a pass covers it and the streak keeps going
  const rest = streakState({ dates: ["2026-08-10", "2026-09-10", "2026-11-03"], now: NOW });
  assert.deepEqual(rest.restUsed, ["2026-10-01"]); assert.equal(rest.count, 3, "two months, a rest month, then November"); assert.equal(rest.passes, 0);
  const resting = streakState({ dates: ["2026-08-10", "2026-09-10"], now: NOW });
  assert.equal(resting.status, "resting"); assert.match(streakLine(resting).line, /rest pass covered last month/);
  // weekly passes: every 4 hosted weeks
  assert.equal(streakState({ dates: [wk(4), wk(3), wk(2), wk(1)], cadence: "week", now: NOW }).passes, 1);
  assert.equal(streakState({ dates: [wk(5), wk(4), wk(3), wk(2), wk(1)], cadence: "week", now: NOW }).passes, 2);
});

test("Repair: with no pass left, anything hosted within 14 days of the missed period restores the streak", () => {
  // Aug (pass earned), Sep (pass used), Oct missed with no pass; window runs to Nov 14
  const paused = streakState({ dates: ["2026-08-10"], now: "2026-11-10" });
  assert.equal(paused.status, "repairable"); assert.equal(paused.repairBy, "2026-11-14"); assert.equal(paused.count, 1, "paused, not gone");
  assert.match(streakLine(paused).line, /paused, not gone/); assert.match(streakLine(paused).line, /even a coffee/);
  const hu = headsUp(paused); assert.equal(hu.kind, "repair"); assert.match(hu.text, /Even a coffee counts/);
  const fixed = streakState({ dates: ["2026-08-10", "2026-11-12"], now: "2026-11-20" });
  assert.deepEqual(fixed.repaired, ["2026-10-01"]); assert.equal(fixed.count, 2); assert.equal(fixed.status, "done");
  const late = streakState({ dates: ["2026-08-10", "2026-11-20"], now: "2026-11-26" });
  assert.equal(late.repaired.length, 0); assert.equal(late.count, 1, "too late to repair: a new run"); assert.equal(late.status, "restarted");
  const gone = streakState({ dates: ["2026-08-10"], now: NOW });
  assert.equal(gone.status, "lapsed"); assert.equal(gone.lapsedFrom, 1);
  const kind = streakLine(gone).line; assert.match(kind, /Streaks end\. Tables don't/); assert.doesNotMatch(kind, /lost|failed|broke|shame|sad/i, "never shame");
  // weekly: the 14 days cover the next two weeks
  const w = streakState({ dates: [wk(4), wk(3), wk(0)], cadence: "week", now: NOW });
  assert.ok(w.restUsed.length === 1 && w.repaired.length === 1, "one week rested, the next repaired"); assert.equal(w.count, 3);
});

test("Heads-up: only near the end of a quiet period, never once there's something on the calendar", () => {
  const s = streakState({ dates: ["2026-09-10", "2026-10-10"], now: NOW }); // November, 4 days left
  assert.equal(s.daysLeft, 4);
  assert.ok(headsUp(s, { days: 7 }), "inside 7 days"); assert.equal(headsUp(s, { days: 3 }), null, "not yet at 3 days");
  assert.match(headsUp(s, { days: 7 }).text, /rest pass covers it/, "with a pass, the heads-up says so");
  assert.equal(headsUp(streakState({ dates: ["2026-09-10", "2026-10-10"], upcoming: ["2026-11-28"], now: NOW }), { days: 7 }), null, "something's coming");
  assert.equal(headsUp(streakState({ dates: ["2026-11-02"], now: NOW })), null, "already hosted this month");
  for (const t of [headsUp(s, { days: 7 }).text, ...Object.values(POTTO).flat()]) { assert.doesNotMatch(t, /—/, "no em dashes"); assert.doesNotMatch(t, /don't break|you'll lose|disappoint/i, "no guilt"); }
});

test("Small moves: the list fits the host's moment, and there's always one believable move", () => {
  const fresh = smallMoves({ events: 0, upcoming: [], now: NOW });
  assert.equal(fresh[0].id, "plan", "a new host starts with a dinner for 4"); assert.ok(fresh.some((m) => m.id === "feeler"));
  const prep = smallMoves({ events: 3, upcoming: [{ id: "e1", name: "Dumpling Night", date: "2026-11-28", going: 5, cap: 8 }], last: { id: "e0", name: "Taco night", date: "2026-10-30", going: 6, thanked: true, photos: true }, now: NOW });
  assert.equal(prep[0].id, "remind"); assert.equal(prep[0].eventId, "e1"); assert.ok(prep.some((m) => m.id === "invite"), "open spots: invite one new person");
  const after = smallMoves({ events: 3, upcoming: [], last: { id: "e0", name: "Taco night", date: "2026-11-24", going: 6, thanked: false, photos: false }, now: NOW });
  assert.deepEqual(after.slice(0, 3).map((m) => m.id), ["thank", "photo", "nextdate"]);
  const asks = smallMoves({ events: 2, asks: 2, upcoming: [{ id: "e1", name: "x", date: "2026-12-20", going: 1, cap: 0 }], now: NOW });
  assert.equal(asks[0].id, "reply");
  for (const L of [fresh, prep, after, asks]) { assert.ok(L.length >= 2); for (const m of L) assert.ok(m.minutes >= 1 && m.minutes <= 2, "1 to 2 minutes each"); }
  const quick = smallMoves({ events: 3, upcoming: [], last: { id: "e0", name: "T", date: "2026-11-24", going: 6 }, now: NOW }, { order: "quickest" });
  assert.equal(quick[0].minutes, 1, "the quickest order leads with a 1-minute move");
  const done = smallMoves({ events: 0, now: NOW }, { done: ["plan"] }); assert.equal(todaysMove(done).id, "feeler", "today's move skips what's done today");
});

test("Warmth points: events, guests welcomed, would-go-again and small moves, against a monthly goal", () => {
  const W = warmthOf({ events: [{ date: "2026-11-07", guests: 6, again: 2 }, { date: "2026-10-30", guests: 9, again: 4 }], moves: [{ at: Date.parse("2026-11-10T12:00:00Z") }, { at: Date.parse("2026-10-10T12:00:00Z") }] }, "2026-11-01", "2026-11-30");
  assert.deepEqual(W.parts, { events: 10, guests: 12, again: 6, moves: 1 }); assert.equal(W.points, 29);
  const capped = warmthOf({ moves: Array.from({ length: 40 }, () => ({ at: Date.parse("2026-11-10T12:00:00Z") })) }, "2026-11-01", "2026-11-30");
  assert.equal(capped.points, 20, "small moves count up to 20 a month, so nobody farms taps");
  assert.deepEqual(ring(29, 30), { points: 29, goal: 30, pct: 97, met: false }); assert.equal(ring(45, 30).pct, 100);
});

test("Milestones are celebrated once each: first event out, the 10th, the first sold-out night, the first regular", () => {
  assert.deepEqual(MILESTONES.map((m) => m.id), ["first", "firstyes", "tenth", "soldout", "regular"]);
  assert.equal(nextCelebration({ published: 1, hosted: 0, guests: 1 }, ["first"]).id, "firstyes", "the first guest to say yes is its own moment");
  assert.equal(nextCelebration({ published: 3, hosted: 2, guests: 9 }, ["first"]), null, "not for a host who has already held one");
  const f = { published: 1, hosted: 0, soldOut: 0, regulars: 0 };
  const c = nextCelebration(f, []); assert.equal(c.id, "first"); assert.equal(c.title, "Your first one is out in the world.");
  assert.equal(nextCelebration(f, ["first"]), null, "seen: never again");
  assert.equal(nextCelebration({ published: 4, hosted: 2, soldOut: 0, regulars: 0 }, []), null, "a host who has already held one is never told this is their first");
  assert.equal(nextCelebration({ published: 12, hosted: 10, soldOut: 1, regulars: 1 }, ["first", "tenth"]).id, "soldout");
  assert.equal(nextCelebration({ published: 3, hosted: 3, soldOut: 0, regulars: 0 }, ["first"]), null, "no celebration for ordinary progress");
});

test("Circles: opt-in hosts grouped by cadence, table, city and size; top 3 move up and nobody moves down", () => {
  const M = [];
  for (let i = 0; i < 23; i++) M.push({ ws: "b" + i, city: "Brooklyn", band: "small", tier: 0, cadence: "month" });
  for (let i = 0; i < 3; i++) M.push({ ws: "o" + i, city: "Oakland", band: "small", tier: 0, cadence: "month" });
  for (let i = 0; i < 2; i++) M.push({ ws: "z" + i, city: "Zurich", band: "mid", tier: 0, cadence: "month" });
  M.push({ ws: "w0", city: "Brooklyn", band: "small", tier: 0, cadence: "week" }); M.push({ ws: "t2", city: "Brooklyn", band: "small", tier: 2, cadence: "month" });
  const G = groupCircles(M, "month:1"), of = (ws) => G.find((g) => g.members.includes(ws));
  assert.equal(G.reduce((a, g) => a + g.members.length, 0), M.length, "everyone who opted in is in exactly one circle");
  for (const g of G) assert.ok(g.members.length <= CIRCLE.size, "about ten at most");
  const bk = G.filter((g) => g.city === "Brooklyn" && g.band === "small" && g.tier === 0 && g.cadence === "month"); assert.equal(bk.length, 3, "23 Brooklyn hosts: three even circles"); assert.ok(bk.every((g) => g.members.length >= 7));
  assert.equal(of("o0").city, null, "too few in Oakland: an Anywhere circle"); assert.ok(of("o0").members.includes("z0"));
  assert.notEqual(of("w0"), of("b0"), "weekly and monthly never mix"); assert.notEqual(of("t2"), of("b0"), "tables don't mix");
  assert.deepEqual(groupCircles(M, "month:1"), G, "deterministic for a period");
  const B = boardOf([{ ws: "a", name: "A", points: 40 }, { ws: "b", name: "B", points: 35 }, { ws: "c", name: "C", points: 20 }, { ws: "d", name: "D", points: 10 }, { ws: "e", name: "E", points: 0 }]);
  assert.deepEqual(B.map((x) => x.standing), ["Moving up", "Moving up", "Moving up", "Staying", "Staying"]);
  assert.ok(B.every((x) => !/down|demot|relegat|drop/i.test(x.standing)), "no public demotion");
  const next = settleTiers(boardOf([{ ws: "a", points: 9 }, { ws: "b", points: 5 }, { ws: "c", points: 3 }, { ws: "d", points: 1 }], { closed: true }), { a: 0, b: 3, c: 1, d: 2 });
  assert.deepEqual(next, { a: 1, b: 3, c: 2, d: 2 }, "up one table (the top table stays the top); 4th place keeps its table");
  assert.equal(boardOf([{ ws: "a", points: 0 }])[0].standing, "Staying", "no points, no move");
  assert.equal(bandOf(4), "small"); assert.equal(bandOf(12), "mid"); assert.equal(bandOf(40), "large");
});

test("Usual rhythm: learned from when the host makes events, in their time zone, at a kind hour", () => {
  const T = ["2026-10-06T00:30:00Z", "2026-10-13T00:10:00Z", "2026-10-20T00:45:00Z", "2026-11-02T15:00:00Z"].map(Date.parse); // Mondays 8pm New York
  const r = usualRhythm(T, "America/New_York"); assert.equal(r.learned, true); assert.equal(r.weekday, 1); assert.equal(r.hour, 20);
  assert.deepEqual(usualRhythm([Date.now()], "UTC"), { weekday: 0, hour: 18, learned: false }, "Sunday evening until there are 3");
  assert.equal(usualRhythm(["2026-10-06T03:00:00Z", "2026-10-13T03:00:00Z", "2026-10-20T03:00:00Z"].map(Date.parse), "UTC").hour, 9, "a 3am planner hears from Potto at 9");
});

test("Nudges: timed to the host's rhythm, kept out of quiet hours, at most 2 a week, each kind can be turned off", () => {
  const tz = "America/New_York", now = Date.parse("2026-11-26T15:00:00Z"); // Thu 10am in New York
  const ctx = { tz, rhythm: { weekday: 0, hour: 18 }, cadence: "month", upcoming: [], last: { id: "dn", name: "Dumpling Night", date: "2026-10-22", going: 7 }, streak: streakState({ dates: ["2026-09-20", "2026-10-22"], now: "2026-11-26" }), headsUpDays: 7 };
  const C = planNudges(ctx, now), cb = C.find((n) => n.type === "comeback"), st = C.find((n) => n.type === "streak");
  assert.equal(cb.body, "It's been 5 weeks since Dumpling Night. Same crew, new month?");
  assert.equal(new Date(cb.at).toISOString(), "2026-11-22T23:00:00.000Z", "Sunday 6pm in New York: their usual planning time");
  assert.equal(dueNudges([cb], { tz, now }).length, 0, "Thursday: that Sunday has passed, so it waits for the next one");
  const sun = Date.parse("2026-11-29T23:05:00Z"), cb2 = planNudges(ctx, sun).find((n) => n.type === "comeback");
  assert.equal(cb2.at, Date.parse("2026-11-29T23:00:00Z")); assert.equal(dueNudges([cb2], { tz, now: sun }).length, 1, "Sunday 6pm: it goes");
  assert.equal(st, undefined, "one note about hosting again, not two");
  const st2 = planNudges({ ...ctx, last: { ...ctx.last, date: "2026-11-05" }, streak: streakState({ dates: ["2026-09-20", "2026-10-05"], now: "2026-11-26" }) }, now).find((n) => n.type === "streak");
  assert.ok(st2 && st2.at <= Date.parse("2026-11-30T23:00:00Z"), "a streak heads-up lands before the month ends");
  for (const n of C) assert.equal(inQuiet(n.at, tz), false, "never in quiet hours");
  // the pre-event checklist and the post-event thank-you
  const P = planNudges({ ...ctx, upcoming: [{ id: "e2", name: "Pie night", date: "2026-11-28" }], last: { id: "e1", name: "Soup night", date: "2026-11-25", going: 4 } }, now);
  const prep = P.find((n) => n.type === "prep"), thx = P.find((n) => n.type === "thanks");
  assert.match(prep.body, /Pie night is tomorrow/); assert.equal(localHour(prep.at, tz), 10); assert.match(thx.body, /thank-you to the 4 guests/);
  assert.equal(P.find((n) => n.type === "comeback"), undefined, "no comeback nudge when something's on the calendar");
  // due: caps, quiet hours, opt-outs, never twice
  const due = (cands, o) => dueNudges(cands, { tz, now: Date.parse("2026-11-30T15:00:00Z"), ...o });
  const all = [...P.map((n) => ({ ...n, at: Date.parse("2026-11-29T15:00:00Z") })), { ...cb, at: Date.parse("2026-11-29T23:00:00Z") }];
  assert.equal(due(all, {}).length, 2, "at most 2 at once"); assert.deepEqual(due(all, {}).map((n) => n.type), ["prep", "thanks"], "the most useful first");
  assert.equal(due(all, { sent: [{ key: "x", at: Date.parse("2026-11-27T15:00:00Z") }, { key: "y", at: Date.parse("2026-11-28T15:00:00Z") }] }).length, 0, "2 in the last 7 days: nothing more this week");
  assert.equal(due(all, { sent: [{ key: "x", at: Date.parse("2026-11-20T15:00:00Z") }] }).length, 2, "older than a week doesn't count");
  assert.equal(due(all, { prefs: { prep: false, thanks: false } }).map((n) => n.type).join(), "streak,comeback", "per-kind opt-outs");
  assert.equal(due(all, { prefs: { prep: false, thanks: false, streak: false } }).map((n) => n.type).join(), "comeback");
  assert.equal(due(all, { prefs: { on: false } }).length, 0, "all off");
  assert.equal(due(all, { sent: [{ key: prep.key, at: Date.parse("2026-11-10T15:00:00Z") }] }).some((n) => n.key === prep.key), false, "never the same nudge twice");
  assert.equal(dueNudges(all, { tz, now: Date.parse("2026-12-01T04:00:00Z") }).length, 0, "11pm in New York: quiet hours");
  assert.deepEqual(Object.keys(NUDGE_TYPES), ["prep", "thanks", "streak", "comeback"]);
});

test("The pre-signup draft becomes a clean event: defaults, limits, no markup", () => {
  const e = draftToEvent({ title: "<b>Dumpling night</b>", date: "2026-12-04", time: "19:30", seats: 6, place: "My place, Greenpoint", note: "Bring a drink" }, { now: NOW, city: "Brooklyn", tz: "America/New_York" });
  assert.match(e.name, /Dumpling night/); assert.doesNotMatch(e.name, /[<>]/, "no markup");
  assert.equal(e.date, "2026-12-04"); assert.equal(e.startTime, "19:30"); assert.equal(e.headcount, 6); assert.equal(e.venueName, "My place, Greenpoint"); assert.equal(e.city, "Brooklyn"); assert.equal(e.tz, "America/New_York");
  assert.equal(e.casual, true); assert.equal(e.discoverable, false, "private until the host lists it"); assert.equal(e.fromStart, true); assert.equal(e.published, undefined, "publishing is the app's write path, with its email check");
  const d = draftToEvent({ date: "2020-01-01", time: "late", seats: 9999 }, { now: NOW });
  assert.equal(d.name, "Dinner for 4"); assert.equal(d.date, "2026-11-27", "a past date becomes next Friday"); assert.equal(d.startTime, "19:00"); assert.equal(d.headcount, 200);
  assert.equal(draftToEvent({ date: "2026-12-04", endDate: "2026-12-06" }, { now: NOW }).endDate, "2026-12-06", "a weekend keeps its last day");
});

test("The Host path scales from a dinner for 4 to a summit, with a guide and a template on every node", () => {
  const P = pathOf({ hosted: 1, maxGuests: 6, streakBest: 1, ticketed: 0, series: 0, soldOut: 0, multiDay: 0 });
  assert.deepEqual(P.map((n) => n.title), ["Dinner for 4", "Book a table for friends", "A table of 8", "A regular night", "Your first ticketed event", "A series", "A sold-out night", "A weekend away", "A summit"]);
  assert.deepEqual(P.slice(0, 3).map((n) => n.state), ["done", "next", "later"]);
  for (const n of P) { assert.ok(n.steps.length >= 3); assert.match(n.template, /^\/start\?t=/); assert.match(n.guideHref, /^\/(?:guides\/[a-z-]+|path#guide-[a-z0-9]+)$/); }
  const G = Object.fromEntries(P.map((n) => [n.id, n.guideHref]));
  assert.equal(G.dinner4, "/guides/first-supper", "a node with a written guide links to it");
  assert.equal(G.regular, "/guides/game-night"); assert.equal(G.series, "/guides/grow-regulars");
  assert.equal(G.summit, "/guides/small-summit"); assert.equal(G.weekend, "/guides/weekend-away"); assert.equal(G.booked, "/guides/book-a-table", "review 18: every scale has its written guide");
  const B = loopBadges({ badges: [{ id: "new", label: "New host", why: "x" }] }, { soldOut: 1, regulars: 2, movesDone: 12 }, { restUsed: ["2026-10-01"], repaired: [], count: 3, status: "done" });
  assert.deepEqual(B.map((b) => b.id), ["new", "rested", "soldout", "regular", "moves"], "recognition's badges first, then the loop's");
});
