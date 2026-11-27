// The brand panel, round 3 (server/brandpanel3.js and the round 2 pieces it changes): a test or more for each item the
// panel named. The hold runs on a fake clock. The world is invented (test/brand-panel-seed.js).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { seedBrandPanel } from "./brand-panel-seed.js";
import { scopeStore } from "../server/workspaces.js";
import { guestChangeNote, changesFor, timeLabel, cancelNote, MATCH, matchCheck, groupProfile, liftRecs, durability } from "../server/brandpanel2.js";
import { clock, HOLD, leftText, holdWindow, holdState, canCommit, rsvpCounts, holdView, defaultThreshold, pilotMetrics, matchProfile, followupsOf, OFF_QUESTION, repeatEarnings, hoursOf,
  MARGIN, cleanMargin, marginReport, cohortDiscovery } from "../server/brandpanel3.js";

let srv, S;
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "brand-panel-r3-secret-0123456789", ENCORE_SIGNUP_PER_HOUR: "1000", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_SMS: "1", ENCORE_INSIGHTS_CACHE_MS: "0", ENCORE_ADMIN_EMAILS: "ada@pl-admin.example", ENCORE_TEAM_FEE_BPS: "800" };
const J = { "content-type": "application/json" };
const req = (method, p, body, cookie) => fetch(srv.base + p, { method, headers: { ...J, ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
const get = (p, c) => req("GET", p, null, c), post = (p, b, c) => req("POST", p, b, c);
const ok = async (r) => { const t = await r.text(); assert.ok(r.ok, `${r.status} ${t.slice(0, 400)}`); return t.startsWith("{") ? JSON.parse(t) : t; };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const weekday = (n) => { for (let i = n; i < n + 10; i++) { const d = day(i), w = new Date(d + "T12:00:00Z").getUTCDay(); if (w >= 2 && w <= 4) return d; } };
const HOUR = 3600e3;
const R = (id) => srv.store.get("system/bbreq-" + id).data, EV = (id) => srv.store.get("system/bpev-" + id)?.data, CAMP = (id) => srv.store.get("system/camp-" + id).data;
const host = (h) => S.hosts.find((x) => x.handle === h);
const setPkg = (h, f) => { const S2 = scopeStore(srv.store, host(h).ws), st = S2.get("teambook/setup").data; st.packages = st.packages.map((p) => ({ ...p, ...f(p) })); S2.set("teambook/setup", st); };
async function signup(name, email, company) { const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name, email, password: "long-password-1", mode: company ? "work" : "friends", company, city: "New York" }) }); assert.ok(r.ok); return r.headers.get("set-cookie").split(";")[0]; }
async function book(handle, headcount, date, cookie, extra = {}) { const H = host(handle); return ok(await post("/api/bb/requests", { handle, pkg: H.pkgId, headcount, date, company: "Fernwood Labs", ...extra }, cookie)); }
async function accept(id, handle, cookie) { await ok(await post(`/api/bb/requests/${id}/pay`, {}, cookie)); await ok(await post(`/api/bb/host/requests/${id}`, { action: "accept" }, host(handle).c)); }
/** A booked customer dinner with 9 guests (6 target accounts among them), which the host then cancels. */
async function cancelledDinner(date, { targets = true } = {}) {
  const j = await book("long-table", 12, date, S.owner.c, { single: true, goal: "customer", brief: { goal: "customer", together: "roundtable", mix: { brand: 12, host: 0 } } });
  await accept(j.id, "long-table", S.owner.c); const cid = R(j.id).campaignId, cos = ["Larkspur", "Northpine", "Tidewater", "Quillon", "Arbor", "Meridian", "Larkspur", "Other Co", "Another Co"];
  await ok(await post(`/api/campaigns/${cid}/guests`, { event: j.id, guests: cos.map((co, i) => ({ name: `Guest${i} Lane`, email: `g${i}.${j.id}@guests.example`, company: co, consent: true })) }, S.owner.c));
  const C = CAMP(cid); C.guests.forEach((g) => { if (g.event === j.id) { g.status = "yes"; g.invitedAt = Date.now() - 864e5; } }); if (targets) C.targets = ["Larkspur", "Northpine", "Tidewater", "Quillon", "Arbor", "Meridian"]; srv.store.set("system/camp-" + cid, C);
  await ok(await post(`/api/bb/requests/${j.id}/cancel`, {}, host("long-table").c)); return { id: j.id, cid };
}
const tokens = (id) => srv.store.listPrefix("system", "bprc-").map((d) => d.data).filter((x) => x.reqId === id);

before(async () => { Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer(); S = await seedBrandPanel(srv.base, srv.store);
  setPkg("corner-cellar", () => ({ leadDays: 1, access: [] })); setPkg("wheel-and-kiln", () => ({ leadDays: 1, time: "daytime", access: ["step-free"] })); setPkg("long-table", () => ({ access: ["step-free"] })); });
after(async () => { clock.now = () => Date.now(); for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

// ---------------------------------------------------------------------------------------------------------------
// A1. The guest note
test("A1. the note says \"same evening\" only when the date and time are unchanged, and states the new date, time, format and access plainly", () => {
  const base = { oldName: "Long Table", newName: "Wine night", newHost: "Margo", company: "Fernwood Labs", from: "Maya" };
  const same = guestChangeNote({ ...base, oldDate: "2026-12-01", newDate: "2026-12-01", oldTime: "19:00", newTime: "19:00" });
  assert.equal(same.same, true); assert.match(same.subject, /^Change of plan, same evening/); assert.match(same.text, /still on Tue, Dec 1 at 7pm/);
  const moved = guestChangeNote({ ...base, oldDate: "2026-12-01", newDate: "2026-12-03", oldTime: "evening", newTime: "evening", format: "Wine night is a different kind of experience", access: ["the new place doesn't list step-free entry"] });
  assert.equal(moved.same, false); assert.doesNotMatch(moved.subject + moved.text, /same evening/i); assert.match(moved.text, /New date: Thu, Dec 3 \(was Tue, Dec 1\)\./); assert.match(moved.text, /Time: In the evening, as before\./);
  assert.match(moved.text, /Format: Wine night is a different kind of experience\./); assert.match(moved.text, /Access: the new place doesn't list step-free entry\./); assert.match(moved.text, /Can you still come\?/);
  const later = guestChangeNote({ ...base, oldDate: "2026-12-01", newDate: "2026-12-01", oldTime: "19:00", newTime: "daytime" });
  assert.doesNotMatch(later.text, /same evening/i, "same date, new time: no promise"); assert.match(later.text, /Date: Tue, Dec 1, as before\./); assert.match(later.text, /New time: During the day \(was 7pm\)\./);
  assert.doesNotMatch(guestChangeNote({ ...base, newDate: "2026-12-01" }).text, /same evening/i, "no original date: no promise");
  assert.match(guestChangeNote({ ...base, oldDate: "2026-12-01", newDate: "2026-12-03", rsvpLink: "https://x/reconfirm/abc" }).text, /Tell us here: https:\/\/x\/reconfirm\/abc/);
  for (const n of [same, moved, later]) assert.ok(!/\u2014/.test(n.subject + n.text), "no em dashes");
  assert.equal(timeLabel("19:30"), "7:30pm"); assert.equal(timeLabel("evening"), "in the evening");
  const ch = changesFor({ date: "2026-12-01", time: "19:00", pkgTime: "evening", access: ["step-free"], moods: ["client"], venue: "host" }, { name: "Clay", pkgTime: "daytime", access: [], moods: ["handson"], venue: "host" }, "2026-12-01");
  assert.equal(ch.date, false); assert.equal(ch.time, true); assert.equal(ch.newTime, "daytime"); assert.equal(ch.access.length, 1); assert.match(ch.format, /different kind/); assert.equal(ch.rsvp, true); assert.equal(ch.sameEvening, false);
  assert.equal(changesFor({ date: "2026-12-01", time: "19:00", pkgTime: "evening" }, { pkgTime: "evening" }, "2026-12-01").rsvp, false, "same date, same part of the day, keeps 7pm");
  assert.match(cancelNote({ name: "Long Table", date: "2026-12-01", company: "Fernwood Labs" }).text, /is cancelled/);
});

test("A1. in the app: an option that moves the date drafts a note with the new date and no \"same evening\"", async () => {
  const date = weekday(5); setPkg("corner-cellar", () => ({ closed: [date] })); const { id } = await cancelledDinner(date);
  const V = await ok(await get(`/api/teams/events/${id}/recovery`, S.owner.c)); assert.ok(V.options.length >= 2, V.line);
  const moved = V.options.find((o) => o.date !== date), later = V.options.find((o) => o.handle === "wheel-and-kiln");
  assert.ok(moved && moved.changes.date && moved.rsvp, "corner-cellar is closed that day, so it offers another date");
  assert.ok(later.changes.time && later.rsvp, "the workshop runs in the day, so the time changes"); assert.ok(later.differs.some((d) => /During the day instead of in the evening/.test(d)));
  assert.ok(moved.differs.some((d) => /doesn't list step-free entry/.test(d)), "access is named");
  await ok(await post(`/api/teams/events/${id}/recovery/hold`, { handle: moved.handle, pkg: moved.pkg }, S.owner.c));
  const V2 = await ok(await get(`/api/teams/events/${id}/recovery`, S.owner.c)); assert.doesNotMatch(V2.note.subject + V2.note.text, /same evening/i); assert.match(V2.note.text, /New date: /); assert.match(V2.note.text, /Access: /);
  assert.equal((await post(`/api/teams/events/${id}/recovery/rebook`, { handle: later.handle, pkg: later.pkg }, S.owner.c)).status, 409, "no one-tap rebook when guests must reconfirm");
  setPkg("corner-cellar", () => ({ closed: [] }));
});

// ---------------------------------------------------------------------------------------------------------------
// A2. The hold and its clock, on a fake clock
test("A2. the hold: a visible clock, ends at the deadline or when reconfirmations can't reach the threshold (pure, fake clock)", () => {
  const t0 = Date.parse("2026-12-01T10:00:00Z"), H = { state: "held", startedAt: t0, expiresAt: holdWindow(t0, "2026-12-10", 24), threshold: 3, rsvp: { needed: true, sentAt: 0, list: [], answers: {} } };
  assert.equal(H.expiresAt, t0 + 24 * HOUR); assert.equal(holdWindow(t0, "2026-12-01", 24), t0 + HOLD.minHours * HOUR, "never past the morning of the new date, at least an hour");
  assert.equal(leftText(23 * HOUR + 10 * 60e3), "23h 10m left"); assert.equal(leftText(0), "Ended");
  assert.equal(holdState(H, t0 + HOUR).state, "held"); assert.equal(holdState(H, t0 + 24 * HOUR).state, "released"); assert.equal(holdState(H, t0 + 24 * HOUR).why, "time");
  assert.equal(canCommit(H, t0 + HOUR).ok, false, "guests haven't been asked yet");
  H.rsvp = { needed: true, sentAt: t0, list: [1, 2, 3, 4].map((i) => ({ id: "g" + i, company: "" })), answers: { g1: "yes", g2: "yes" } };
  assert.match(canCommit(H, t0 + HOUR).why, /2 of 4 guests reconfirmed so far\. You set 3/); H.rsvp.answers.g3 = "yes"; assert.equal(canCommit(H, t0 + HOUR).ok, true);
  H.rsvp.answers = { g1: "no" }; assert.equal(holdState(H, t0 + HOUR).state, "held", "3 can still say yes");
  H.rsvp.answers = { g1: "no", g2: "no" }; const S1 = holdState(H, t0 + HOUR); assert.equal(S1.state, "released"); assert.equal(S1.why, "short", "the threshold can't be reached");
  const V = holdView({ ...H, state: "held", rsvp: { ...H.rsvp, answers: {} }, changes: { date: true, oldDate: "2026-12-01", newTime: "evening", oldTime: "evening" }, date: "2026-12-03", price: { totalCents: 130000, depositCents: 32500 }, was: { totalCents: 120000, depositCents: 30000, paidCents: 30000 }, money: "credit" }, { now: t0 + HOUR });
  assert.equal(V.left, "23h 0m left"); assert.equal(V.live, true); assert.match(V.changes[0], /New date: Thu, Dec 3 \(was Tue, Dec 1\)/);
  assert.ok(V.price.lines.some((l) => /New total: \$1,300 \(was \$1,200, \$100 more\)/.test(l)) && V.price.lines.some((l) => /Deposit to confirm: \$325 \(was \$300\)/.test(l)) && V.price.lines.some((l) => /kept as credit/.test(l)));
  assert.equal(holdView({ ...H, state: "held" }, { side: "host", now: t0 }).price.lines, undefined, "the host doesn't see the brand's money lines");
  assert.equal(defaultThreshold(9), 6);
});

test("A2. in the app: the replacement host sees the hold and its clock; it ends on its own at the deadline and the date opens again", async () => {
  const date = weekday(6), { id } = await cancelledDinner(date);
  const V = await ok(await get(`/api/teams/events/${id}/recovery`, S.owner.c)), x = V.options.find((o) => o.handle === "wheel-and-kiln");
  const t0 = Date.now(); clock.now = () => t0;
  const H1 = await ok(await post(`/api/teams/events/${id}/recovery/hold`, { handle: x.handle, pkg: x.pkg, hours: 12 }, S.owner.c));
  assert.equal(H1.state, "held"); assert.equal(H1.hold.live, true); assert.equal(H1.hold.expiresAt, t0 + 12 * HOUR); assert.equal(H1.hold.left, "12h 0m left"); assert.ok(H1.hold.rsvpNeeded); assert.equal(H1.hold.threshold, 6);
  assert.ok(EV(id).recovery.foundMinutes != null, "time to find a host is recorded");
  const HV = await ok(await get("/api/bb/host/holds", host("wheel-and-kiln").c)), mine = HV.holds.find((h) => h.id === H1.hold.id);
  assert.ok(mine && mine.live); assert.equal(mine.expiresAt, t0 + 12 * HOUR); assert.equal(mine.company, "Fernwood Labs"); assert.ok(mine.price.totalCents > 0); assert.equal(mine.price.lines, undefined); assert.match(mine.deadline, /sooner if fewer than 6 guests/);
  const avail = async () => (await ok(await get(`/api/bb/x/wheel-and-kiln/${host("wheel-and-kiln").pkgId}/availability?month=${date.slice(0, 7)}`))).days.find((d) => d.date === date)?.state;
  assert.notEqual(await avail(), "open", "the held date is blocked for everyone else");
  clock.now = () => t0 + 12 * HOUR - 60e3; assert.equal((await ok(await get(`/api/teams/events/${id}/recovery`, S.owner.c))).hold.left, "1m left");
  clock.now = () => t0 + 12 * HOUR + 1; // past the deadline: the next read ends it
  const V3 = await ok(await get(`/api/teams/events/${id}/recovery`, S.owner.c)); assert.equal(V3.hold.state, "released"); assert.match(V3.hold.why, /no commit by the deadline/); assert.equal(V3.state, "open"); assert.equal(EV(id).recovery.hold.why, "time");
  assert.equal((await post(`/api/teams/events/${id}/recovery/commit`, {}, S.owner.c)).status, 409, "too late to commit");
  assert.equal((await ok(await get("/api/bb/host/holds", host("wheel-and-kiln").c))).holds.find((h) => h.id === H1.hold.id).live, false);
  assert.equal(await avail(), "open", "the date opens again");
  // the server timer runs the same check
  const t1 = t0 + 13 * HOUR; clock.now = () => t1; await ok(await post(`/api/teams/events/${id}/recovery/hold`, { handle: x.handle, pkg: x.pkg, hours: 12 }, S.owner.c));
  clock.now = () => t1 + 13 * HOUR; assert.ok(srv.app.locals.brandPanel3.sweepAll() >= 1); assert.equal(EV(id).recovery.hold.state, "released");
  clock.now = () => Date.now();
});

// ---------------------------------------------------------------------------------------------------------------
// A3. The fresh RSVP and the counts
test("A3. reconfirm counts: everyone the note went to, and target accounts on their own line", () => {
  const H = { rsvp: { list: [["a", "Larkspur"], ["b", "Larkspur"], ["c", "Northpine"], ["d", "Tidewater"], ["e", "Quillon"], ["f", "Arbor"], ["g", "Meridian"], ["h", "Other"]].map(([id, company]) => ({ id, company })), answers: { a: "yes", c: "yes", d: "yes", e: "yes", f: "no", h: "yes" } } };
  const C = rsvpCounts(H, ["Larkspur", "Northpine", "Tidewater", "Quillon", "Arbor", "Meridian"]);
  assert.equal(C.text, "5 of 8 guests reconfirmed"); assert.equal(C.targets.text, "4 of 6 target accounts reconfirmed"); assert.equal(C.no, 1); assert.equal(C.waiting, 2);
});

test("A3. in the app: a change of date sends a fresh RSVP; the owner sees the counts and the price and deposit change before committing", async () => {
  const date = weekday(5); setPkg("corner-cellar", () => ({ closed: [date] })); const { id, cid } = await cancelledDinner(date);
  const V = await ok(await get(`/api/teams/events/${id}/recovery`, S.owner.c)), x = V.options.find((o) => o.handle === "corner-cellar"); assert.ok(x.changes.date);
  await ok(await post(`/api/teams/events/${id}/recovery/money`, { choice: "credit" }, S.owner.c));
  const H = (await ok(await post(`/api/teams/events/${id}/recovery/hold`, { handle: x.handle, pkg: x.pkg, threshold: 5 }, S.owner.c))).hold; assert.equal(H.threshold, 5);
  assert.ok(H.price.lines.some((l) => /^New total: /.test(l)) && H.price.lines.some((l) => /^Deposit to confirm: /.test(l)) && H.price.lines.some((l) => /No booking fee on a replacement/.test(l)) && H.price.lines.some((l) => /kept as credit/.test(l)));
  assert.equal(H.commit.ok, false); assert.match(H.commit.why, /Send the note first/);
  const M = await ok(await post(`/api/teams/events/${id}/recovery/message`, {}, S.owner.c)); assert.equal(M.guests, 9); assert.equal(M.links, true);
  const T = tokens(id); assert.equal(T.length, 9, "one link per guest");
  const gid = new Map(CAMP(cid).guests.map((g) => [g.id, g])), yesTo = (co) => T.filter((t) => gid.get(t.gid).company === co);
  const page = await ok(await get(`/api/reconfirm/${T[0].t}`)); assert.ok(page.open); assert.doesNotMatch(JSON.stringify(page), /same evening/i); assert.match(page.changes[0], /New date/);
  assert.equal((await get(`/reconfirm/${T[0].t}`)).status, 200);
  for (const co of ["Larkspur", "Northpine", "Tidewater", "Quillon"]) await ok(await post(`/api/reconfirm/${yesTo(co)[0].t}`, { answer: "yes" }));
  await ok(await post(`/api/reconfirm/${yesTo("Arbor")[0].t}`, { answer: "no" }));
  let V2 = await ok(await get(`/api/teams/events/${id}/recovery`, S.owner.c)); assert.equal(V2.hold.counts.text, "4 of 9 guests reconfirmed"); assert.equal(V2.hold.counts.targets.text, "4 of 6 target accounts reconfirmed");
  const c409 = await post(`/api/teams/events/${id}/recovery/commit`, {}, S.owner.c); assert.equal(c409.status, 409); assert.match((await c409.json()).message, /4 of 9 guests reconfirmed so far\. You set 5/);
  await ok(await post(`/api/reconfirm/${yesTo("Other Co")[0].t}`, { answer: "yes" }));
  assert.equal((await post(`/api/reconfirm/${T[0].t}`, { answer: "maybe" })).status, 400);
  V2 = await ok(await get(`/api/teams/events/${id}/recovery`, S.owner.c)); assert.equal(V2.hold.commit.ok, true);
  await ok(await post(`/api/bb/host/holds/${V2.hold.id}`, { yes: true }, host("corner-cellar").c));
  const O = await ok(await post(`/api/teams/events/${id}/recovery/commit`, {}, S.owner.c)), nr = R(O.id);
  assert.equal(nr.status, "accepted", "the host said yes during the hold"); assert.equal(nr.date, x.date); assert.ok(nr.feeWaivedCents > 0); assert.equal(nr.price.feeCents, 0); assert.ok(nr.credit?.cents > 0, "the credit carries over");
  assert.equal(EV(id).recovery.state, "rebooked"); assert.equal(EV(id).recovery.targetGuests.length, 7, "original target guests: 7 people at 6 accounts");
  const G = CAMP(cid).guests.filter((g) => g.event === O.id); assert.equal(G.length, 9, "guests move to the new booking"); assert.equal(G.filter((g) => g.status === "no").length, 1, "the guest who can't go is marked");
  setPkg("corner-cellar", () => ({ closed: [] }));
});

test("A3. fewer reconfirmations than the threshold ends the hold early", async () => {
  const date = weekday(5); setPkg("corner-cellar", () => ({ closed: [date] })); const { id } = await cancelledDinner(date, { targets: false });
  const V = await ok(await get(`/api/teams/events/${id}/recovery`, S.owner.c)), x = V.options.find((o) => o.handle === "corner-cellar");
  await ok(await post(`/api/teams/events/${id}/recovery/hold`, { handle: x.handle, pkg: x.pkg, threshold: 8 }, S.owner.c)); await ok(await post(`/api/teams/events/${id}/recovery/message`, {}, S.owner.c));
  const T = tokens(id); await ok(await post(`/api/reconfirm/${T[0].t}`, { answer: "no" })); await ok(await post(`/api/reconfirm/${T[1].t}`, { answer: "no" }));
  const V2 = await ok(await get(`/api/teams/events/${id}/recovery`, S.owner.c)); assert.equal(V2.hold.state, "released"); assert.match(V2.hold.why, /fewer guests can make the new plan/);
  assert.equal((await post(`/api/reconfirm/${T[2].t}`, { answer: "yes" })).status, 409, "the link says the plan didn't go ahead");
  setPkg("corner-cellar", () => ({ closed: [] }));
});

// ---------------------------------------------------------------------------------------------------------------
// A4. Cancel the event
test("A4. Cancel the event: the money by the guarantee (refund or credit) and a drafted note to guests", async () => {
  const { id } = await cancelledDinner(weekday(7)); const V = await ok(await get(`/api/teams/events/${id}/recovery`, S.owner.c));
  assert.match(V.cancelNote.subject, /^Cancelled: /); assert.match(V.cancelNote.text, /Nothing is owed by you/); assert.ok(!/\u2014/.test(V.cancelNote.text));
  const x = V.options[0]; await ok(await post(`/api/teams/events/${id}/recovery/hold`, { handle: x.handle, pkg: x.pkg }, S.owner.c));
  const C = await ok(await post(`/api/teams/events/${id}/recovery/cancel`, { choice: "credit" }, S.owner.c)); assert.equal(C.money.choice, "credit"); assert.ok(C.money.cents > 0); assert.equal(C.guests, 9);
  const ev = EV(id); assert.equal(ev.recovery.state, "cancelled"); assert.equal(ev.recovery.hold.state, "released", "the hold is let go"); assert.equal(ev.recovery.hold.why, "cancelled");
  assert.ok((scopeStore(srv.store, R(id).brandWs).get("teambook/credits").data.list || []).some((c) => c.from === id), "the credit is kept for the brand");
  const V2 = await ok(await get(`/api/teams/events/${id}/recovery`, S.owner.c)); assert.equal(V2.state, "cancelled"); assert.equal(V2.cancelled.told, 9);
  assert.equal((await post(`/api/teams/events/${id}/recovery/cancel`, {}, S.owner.c)).status, 409);
  const { id: id2 } = await cancelledDinner(weekday(8)); assert.equal((await ok(await post(`/api/teams/events/${id2}/recovery/cancel`, { choice: "refund", tell: false }, S.owner.c))).money.choice, "refund");
});

test("A4. with no replacement open, no change note is drafted (nothing promises the same evening), only the cancel note", async () => {
  const j = await book("long-table", 20, weekday(9), S.owner.c, { single: true, goal: "customer" }); await accept(j.id, "long-table", S.owner.c);
  await ok(await post(`/api/bb/requests/${j.id}/cancel`, {}, host("long-table").c));
  const V = await ok(await get(`/api/teams/events/${j.id}/recovery`, S.owner.c)); assert.equal(V.options.length, 0); assert.equal(V.note, null); assert.match(V.line, /cancel the event/); assert.match(V.cancelNote.text, /is cancelled/);
  assert.equal((await post(`/api/teams/events/${j.id}/recovery/message`, {}, S.owner.c)).status, 409); assert.doesNotMatch(JSON.stringify(V), /same evening/i);
});

// ---------------------------------------------------------------------------------------------------------------
// A5. Pilot metrics
test("A5. pilot metrics: a drill is an operations test; a recovery succeeds only once the original target guests attend", () => {
  const P = pilotMetrics([{ foundMinutes: 6, state: "rebooked", targets: 4, attended: 3, replacementDone: true }, { foundMinutes: 10, state: "rebooked", targets: 4, attended: 1, replacementDone: true }, { foundMinutes: 4, state: "rebooked", targets: 3, attended: 0, replacementDone: false }, { foundMinutes: null, state: "cancelled", targets: 0 }], [{ startedAt: 0, finishedAt: 120e3 }, { startedAt: 0, finishedAt: 60e3 }]);
  assert.equal(P.tests, 2); assert.match(P.testLine, /operations tests\. They aren't counted as recoveries/); assert.equal(P.recoveries, 4, "drills are not recoveries");
  assert.equal(P.found.medianMinutes, 6); assert.equal(P.targetsAttended.text, "4 of 8", "only replacements that happened"); assert.equal(P.successes.text, "1 of 2", "3 of 4 came: a success; 1 of 4: not"); assert.equal(P.cancelled, 1);
});

// ---------------------------------------------------------------------------------------------------------------
// B. Lift only for matched comparisons
test("B. \"lift\" only when the groups match on invite mix, effort, spend, city and goal; otherwise an observed difference, with the match fields beside both denominators", () => {
  const prof = (o = {}) => ({ brandShare: 0.8, targetShare: 0.5, effort: 14, spendPerGuestCents: 11000, city: "New York", goal: "customer", ...o });
  const cell = (format, events, respondents, useful, profiles) => ({ format, events, people: respondents, respondents, useful, meetings: 0, attended: respondents, profiles });
  const many = (n, o) => Array.from({ length: n }, () => prof(o));
  const matched = liftRecs([cell("roundtable", 4, 40, 24, many(4)), cell("standard", 4, 40, 12, many(4, { spendPerGuestCents: 10000, effort: 12 }))]);
  const u = matched.items[0]; assert.equal(u.matched, true); assert.equal(u.label, "Lift"); assert.match(u.text, /2\.0× lift in the useful-connection rate over standard dinners \(4 events vs 4 events\)/); assert.equal(u.a.text, "24 of 40"); assert.equal(u.b.text, "12 of 40");
  assert.deepEqual(u.match.fields.map((f) => f.k), ["brandShare", "targetShare", "effort", "spend", "city", "goal"]); assert.ok(u.match.fields.every((f) => f.ok && f.a && f.b)); assert.equal(u.match.checked.a, "4 of 4 events");
  const spend = liftRecs([cell("roundtable", 4, 40, 24, many(4)), cell("standard", 4, 40, 12, many(4, { spendPerGuestCents: 7000 }))]).items[0];
  assert.equal(spend.matched, false); assert.equal(spend.label, "Observed difference"); assert.doesNotMatch(spend.text, /lift/i); assert.match(spend.text, /an observed difference/); assert.match(spend.match.why, /spend per guest/);
  assert.equal(liftRecs([cell("roundtable", 4, 40, 24, many(4)), cell("standard", 4, 40, 12, many(4, { city: "San Francisco" }))]).items[0].matched, false, "another city");
  assert.equal(liftRecs([cell("roundtable", 4, 40, 24, many(4)), cell("standard", 4, 40, 12, many(4, { goal: "team" }))]).items[0].matched, false, "another goal");
  assert.equal(liftRecs([cell("roundtable", 4, 40, 24, many(4)), cell("standard", 4, 40, 12, many(4, { brandShare: 0.5 }))]).items[0].matched, false, "another invite mix: 30 points apart");
  const partial = liftRecs([cell("roundtable", 4, 40, 24, [...many(3), null]), cell("standard", 4, 40, 12, many(4))]).items[0]; assert.equal(partial.matched, false); assert.match(partial.match.why, /1 of 8 events have no match check/);
  assert.equal(MATCH.sharePts, 20); assert.equal(MATCH.relative, 0.2); assert.ok(MATCH.sameCity && MATCH.sameGoal);
  const G = groupProfile(many(2)); assert.equal(G.n, 2); assert.equal(matchCheck(G, groupProfile(many(2, { effort: 18 }))).matched, false, "14 invites against 18 is more than 20% off");
});

test("B. the match check is taken from the rebooking rule's planned invite list, stored with the event before it happens, and locked when invites go out", async () => {
  const j = await book("dice-and-dumplings", 14, weekday(30), S.owner.c, { single: true, goal: "customer", brief: { goal: "customer", together: "roundtable", mix: { brand: 10, host: 4 } } });
  const cid = R(j.id).campaignId; await ok(await post(`/api/campaigns/${cid}/guests`, { event: j.id, guests: ["Larkspur Systems", "Larkspur Systems", "Other"].map((co, i) => ({ name: `P${i} Q`, email: `p${i}.${j.id}@x.example`, company: co })) }, S.owner.c));
  await ok(await post(`/api/teams/events/${j.id}/rule`, { accounts: "Larkspur Systems", useful: "A platform lead meets our engineer", metric: "targetsAttended", atLeast: 1 }, S.owner.c));
  const M = EV(j.id).matchCheck; assert.ok(M.before); assert.equal(M.locked, false); assert.equal(M.profile.planned, 3); assert.equal(M.profile.effort, 3); assert.equal(Math.round(M.profile.targetShare * 100), 67); assert.equal(M.profile.brandShare, 10 / 14); assert.equal(M.profile.goal, "customer"); assert.equal(M.profile.city, "New York");
  const C = CAMP(cid); C.guests.forEach((g) => { if (g.event === j.id) { g.status = "invited"; g.invitedAt = Date.now(); } }); srv.store.set("system/camp-" + cid, C);
  const more = await ok(await get(`/api/teams/events/${j.id}/more`, S.owner.c)); assert.equal(more.matchCheck.locked, true); assert.match(more.matchCheck.source, /when invites went out/);
  const p = matchProfile({ r: { id: "x", headcount: 10, price: { totalCents: 100000 } }, ev: { brief: { goal: "team", mix: { brand: 6, host: 4 } } }, guests: [{ event: "x", status: "yes", company: "A" }, { event: "x", status: "asked", company: "A" }], targets: ["A"], city: "NYC" });
  assert.equal(p.brandShare, 0.6); assert.equal(p.targetShare, 1); assert.equal(p.effort, 1); assert.equal(p.spendPerGuestCents, 10000);
  const L = await ok(await get("/api/teams/recommendations/lift?city=New%20York", S.juniper.c)); assert.ok(L.items.every((x) => (x.matched ? x.label === "Lift" : x.label === "Observed difference" && !/lift/i.test(x.text)) && x.match.fields.length === 6)); assert.match(L.note, /Lift only where both groups match/);
});

// ---------------------------------------------------------------------------------------------------------------
// C1. The on-platform rate counts direct repeat bookings
test("C1. on-platform rate: direct repeat bookings from both sides' follow-up go in the denominator, with the response rate", () => {
  const F = followupsOf([{ brandWs: "B1", hostWs: "H1", offAsk: { sentAt: 1, brand: { count: 2 }, host: { count: 1 } } }, { brandWs: "B2", hostWs: "H2", offAsk: { sentAt: 1, brand: { count: 0 }, host: null } }, { brandWs: "B3", hostWs: "H1", offAsk: { sentAt: 1, brand: null, host: null } }]);
  assert.deepEqual(F.followups["B1|H1"], { brand: 2, host: 1 }); assert.deepEqual(F.asks, { asked: 6, answered: 3 });
  const mk = (id, b, h, d) => ({ id, brandWs: b, hostWs: h, date: d, status: "booked", createdAt: Date.parse(d) });
  const D = durability([mk("a1", "B1", "H1", day(-100)), mk("a2", "B1", "H1", day(-50)), mk("b1", "B2", "H2", day(-90))], { followups: F.followups, asks: F.asks, offPlatform: { H1: 5 } });
  assert.equal(D.onPlatform.on, 1); assert.equal(D.onPlatform.direct, 2, "the larger side's answer, counted once"); assert.equal(D.onPlatform.selfReported, 0, "a host's own report is left out once the follow-up answered"); assert.equal(D.onPlatform.of, 3); assert.equal(D.onPlatform.value, 33);
  assert.equal(D.onPlatform.response.text, "3 of 6"); assert.equal(D.more.find((m) => m.key === "onPlatform").text, "1 of 3"); assert.equal(OFF_QUESTION, "Did you book each other again outside Pottery Lab?");
});

test("C1. in the app: after an event both sides are asked separately, and the admin page shows the rate and the response rate", async () => {
  const id = S.bookings.b1, more = await ok(await get(`/api/teams/events/${id}/more`, S.owner.c)); assert.equal(more.offAsk.question, OFF_QUESTION); assert.equal(more.offAsk.mine, null);
  const hostOf = S.hosts.find((h) => h.handle === R(id).handle);
  const hm = await ok(await get(`/api/bb/host/events/${id}/more`, hostOf.c)); assert.equal(hm.offAsk.mine, null, "the host is asked separately");
  await ok(await post(`/api/teams/events/${id}/off-platform`, { count: 1 }, S.owner.c)); assert.equal((await post(`/api/teams/events/${id}/off-platform`, {}, S.owner.c)).status, 400);
  assert.equal((await ok(await get(`/api/bb/host/events/${id}/more`, hostOf.c))).offAsk.mine, null, "the brand's answer isn't shown to the host");
  assert.equal((await post(`/api/teams/events/${S.bookings.b3}/off-platform`, { count: 0 }, S.owner.c)).status, 409, "not before the event");
  const admin = await signup("Ada Admin", "ada@pl-admin.example"); S.admin = admin; const A = await ok(await get("/api/admin/brand-measures", admin));
  assert.ok(A.onPlatform.direct >= 1); assert.ok(A.onPlatform.of >= A.onPlatform.on + A.onPlatform.direct); assert.ok(A.onPlatform.response.of >= 2 && A.onPlatform.response.n >= 1);
  const U = await ok(await get("/api/admin/brand-durability", admin)); assert.ok(U.onPlatform.direct >= 1, "the durability bars use the same denominator");
  assert.equal((await get("/api/admin/brand-measures", S.owner.c)).status, 404);
});

// ---------------------------------------------------------------------------------------------------------------
// C2. Earnings per prep hour, first vs second bookings
test("C2. host net earnings per prep hour on second bookings against first bookings, per host and overall", () => {
  const b = (hostWs, brandWs, date, net, hours) => ({ hostWs, brandWs, date, net, hours });
  const E = repeatEarnings([b("H1", "B1", "2026-01-01", 100000, 10), b("H1", "B1", "2026-03-01", 100000, 5), b("H1", "B2", "2026-02-01", 60000, 6), b("H2", "B1", "2026-01-05", 50000, null), b("H2", "B1", "2026-04-05", 80000, 4)]);
  const h1 = E.hosts.find((h) => h.hostWs === "H1"); assert.equal(h1.first.n, 2); assert.equal(h1.first.perHourCents, 10000); assert.equal(h1.second.perHourCents, 20000);
  const h2 = E.hosts.find((h) => h.hostWs === "H2"); assert.equal(h2.first.perHourCents, null, "no hours logged"); assert.equal(h2.first.withHours, 0); assert.equal(h2.second.perHourCents, 20000);
  assert.equal(E.all.first.perHourCents, 10000); assert.equal(E.all.second.perHourCents, 20000); assert.match(E.line, /\$200 a prep hour, against \$100 on first bookings/);
  assert.equal(hoursOf({ prep: { logged: [{ hours: 2 }, { hours: 1.5 }], prepHours: 9 } }), 3.5); assert.equal(hoursOf({ prep: { prepHours: 4 } }), 4); assert.equal(hoursOf({}), null);
});

// ---------------------------------------------------------------------------------------------------------------
// C3. Contribution margin after replacement costs
test("C3. contribution margin per booking after replacement costs (credits, fee waivers, the repeat-fee discount), on configurable assumptions", async () => {
  const A = { ...MARGIN, processingBps: 300, processingFixedCents: 0, supportCentsPerBooking: 1000, recoveryHandlingCents: 5000, creditCostPct: 10 };
  const M = marginReport([{ totalCents: 108000, subtotalCents: 100000, feeCents: 8000 }, { totalCents: 104000, subtotalCents: 100000, feeCents: 4000 }, { totalCents: 100000, subtotalCents: 100000, feeCents: 0, feeWaivedCents: 8000, creditCents: 30000, replacement: true }], { A, baseBps: 800, cancelledRecoveries: 1 });
  const L = Object.fromEntries(M.lines.map((l) => [l.k, l.cents]));
  assert.equal(L.list, 24000); assert.equal(L.processing, -(3240 + 3120 + 3000)); assert.equal(L.support, -3000); assert.equal(M.beforeCents, 24000 - 9360 - 3000);
  assert.equal(L.repeat, -4000, "half the fee on the repeat booking"); assert.equal(L.waived, -8000); assert.equal(L.credit, -3000); assert.equal(L.handling, -10000, "one replacement and one cancelled event");
  assert.equal(M.afterCents, M.beforeCents - 4000 - 8000 - 3000 - 10000); assert.equal(M.perBookingAfterCents, Math.round(M.afterCents / 3));
  const C = cleanMargin({ processingBps: "250", creditCostPct: 500, waiveReplacementFee: false }); assert.equal(C.processingBps, 250); assert.equal(C.creditCostPct, 100); assert.equal(C.waiveReplacementFee, false); assert.equal(C.supportCentsPerBooking, MARGIN.supportCentsPerBooking);
  const S2 = await ok(await post("/api/admin/margin", { supportCentsPerBooking: 2000 }, S.admin)); assert.equal(S2.assumptions.supportCentsPerBooking, 2000);
  const rb = srv.store.listPrefix("system", "bbreq-").map((d) => d.data).find((r) => r.feeWaivedCents && r.status === "accepted"); assert.ok(rb, "the replacement committed in A3"); await ok(await post(`/api/bb/requests/${rb.id}/pay`, {}, S.owner.c)); // its deposit makes it a booking
  const D = await ok(await get("/api/admin/brand-measures", S.admin)); assert.equal(D.margin.assumptions.supportCentsPerBooking, 2000); assert.ok(D.margin.lines.some((l) => l.k === "after")); assert.ok(D.margin.bookings >= 1);
  assert.ok(D.margin.lines.find((l) => l.k === "waived").cents < 0, "the replacement booked earlier waived its fee");
  assert.equal((await post("/api/admin/margin", {}, S.owner.c)).status, 404);
  await ok(await post("/api/admin/margin", { supportCentsPerBooking: MARGIN.supportCentsPerBooking }, S.admin));
});

// ---------------------------------------------------------------------------------------------------------------
// C4. The first two ordinary host cohorts
test("C4. the first two ordinary host cohorts: hosts whose followers discover another host against hosts whose followers stay", async () => {
  const bk = (date, net, hours) => ({ date, net, hours });
  const D = cohortDiscovery([{ ws: "F", founding: true, discovered: true, bookings: [bk("2025-12-02", 1, 1)] }, { ws: "a", discovered: true, bookings: [bk("2026-01-02", 100000, 10), bk("2026-02-02", 100000, 10)] }, { ws: "b", discovered: false, bookings: [bk("2026-01-09", 60000, 10)] },
    { ws: "c", discovered: false, bookings: [bk("2026-02-03", 50000, 5), bk("2026-03-03", 50000, 5)] }, { ws: "d", discovered: true, bookings: [bk("2026-03-01", 1, 1)] }]);
  assert.deepEqual(D.cohorts.map((c) => c.cohort), ["2026-01", "2026-02"], "founding hosts left out, first two cohorts only");
  const [jan, feb] = D.cohorts; assert.equal(jan.discover.hosts, 1); assert.equal(jan.discover.perHourCents, 10000); assert.equal(jan.discover.secondEvent.text, "1 of 1"); assert.equal(jan.stay.perHourCents, 6000); assert.equal(jan.stay.secondEvent.text, "0 of 1");
  assert.equal(feb.discover.hosts, 0); assert.equal(feb.stay.secondBookings, 1); assert.match(D.note, /founding hosts are left out/);
  const A = await ok(await get("/api/admin/brand-measures", S.admin)); assert.ok(Array.isArray(A.cohorts.cohorts) && A.cohorts.cohorts.length <= 2); assert.ok(A.earnings.all.first.n >= 1); assert.ok(A.pilot.recoveries >= 1);
});

test("the round 3 files: no em dashes, brand tokens only, body copy at 16px or more", async () => {
  const fs = await import("node:fs"); const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
  for (const f of ["server/brandpanel3.js", "public/teams-panel3.js", "public/teams-reconfirm.html", "docs/brand-panel-update-r3.md"]) assert.ok(!/\u2014/.test(read(f)), f);
  const css = read("public/teams-panel.css").split("/* round 3")[1]; assert.ok(css); assert.doesNotMatch(css, /#[0-9a-f]{3,6}\b/i, "colors come from the tokens"); assert.doesNotMatch(css, /pl-font-display/, "no headline face under 24px");
  const html = (await ok(await get("/teams/bookings/x", S.owner.c))); assert.match(html, /teams-panel3\.js/);
});
