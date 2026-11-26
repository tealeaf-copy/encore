// The invite planner (server/people.js, server/invites.js, server/seats.js): People built from real activity with no
// import, smart list counts, the expected-yes estimate, wave scheduling, the status board's transitions, Ask to join
// context, check-in and the next event, brand roles and consent, import dedupe, and privacy (workspace isolation,
// blocks, unsubscribes, no email leaks, a guest deleting what a host holds). Seats by audience: blocks, the best block
// a guest qualifies for, open times, roll-overs, races, presets and what members and the public read.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { setUnsubscribed, fakeOutbox } from "../server/email.js";
import { replyRate, expectedYes, chipLabel, chipMatch, readImport, matchAll } from "../server/people.js";
import { defaultWaves, statusOf, waveFor, LIMITS } from "../server/invites.js";
import { preset, cleanBlocks } from "../server/seats.js";

let srv;
const J = { "content-type": "application/json" };
const post = (path, body, cookie, extra = {}) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}), ...extra }, body: JSON.stringify(body || {}) });
const get = (path, cookie, extra = {}) => fetch(srv.base + path, { headers: { ...(cookie ? { cookie } : {}), ...extra } });
const getJ = async (path, cookie, extra) => (await get(path, cookie, extra)).json();
const put = (path, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const patch = (path, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PATCH", headers: { ...J, cookie }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
let n = 0;
const person = async (name, mode = "friends", extra = {}) => { const email = `${name.toLowerCase().replace(/\W+/g, "")}${++n}@example.com`; const r = await post("/api/signup", { name, email, password: "long-password-1", mode, ...extra }); const b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); return { cookie: cookieOf(r), ws: b.workspace.id, email, name }; };
const host = async (name, handle, mode = "friends") => { const h = await person(name, mode, mode === "work" ? { company: name + " Co" } : {}); const r = await post("/api/host/profile", { handle, name, city: "New York", bio: "Dinners at home." }, h.cookie); assert.equal(r.status, 200, await r.text()); return { ...h, handle }; };
const guestRsvp = (ws, body, cookie) => fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, "x-encore-guest": "1", "x-encore-key": "k" + Math.random().toString(36).slice(2), "x-encore-workspace": ws, ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ createdAt: Date.now(), ...body }) });
const hostRsvp = (h, body) => post("/api/db/collection?path=rsvps", { createdAt: Date.now(), ...body }, h.cookie);
const day = (k) => new Date(Date.now() + k * 864e5).toISOString().slice(0, 10);
let evN = 0;
const event = async (h, k, extra = {}) => { const id = "ip" + (++evN) + Math.random().toString(36).slice(2, 7); const r = await put("events/" + id, { name: "Supper " + evN, kind: "social", casual: true, date: day(k), city: "New York", published: true, ...extra }, h.cookie); assert.equal(r.status, 200, await r.text()); return id; };

before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "plan-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "1000"; process.env.ENCORE_FAKE_EMAIL = "1"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv.close(); });

/** A host with history: two past suppers, a follower, a fan club member, kudos. */
async function withHistory(handle) {
  const bo = await host("Bo Tran", handle);
  const p1 = await event(bo, -30), p2 = await event(bo, -10);
  const ana = { email: `ana.${handle}@example.com`, name: "Ana Lee" }, sam = { email: `sam.${handle}@example.com`, name: "Sam" }, kim = { email: `kim.${handle}@example.com`, name: "Kim Park" }, joe = { email: `joe.${handle}@example.com`, name: "Joe" };
  for (const id of [p1, p2]) assert.equal((await hostRsvp(bo, { eventId: id, ...ana, response: "going", party: 2 })).status, 200);
  await hostRsvp(bo, { eventId: p1, ...sam, response: "going" }); await hostRsvp(bo, { eventId: p2, ...sam, response: "maybe" });
  await hostRsvp(bo, { eventId: p1, ...kim, response: "going", noShow: true });
  await hostRsvp(bo, { eventId: p2, ...joe, response: "no" });
  return { bo, p1, p2, ana, sam, kim, joe };
}

// ---------------- pure pieces ----------------
test("the expected-yes estimate leans on each person's own replies", () => {
  const regular = { yes: 3, replies: 3, attended: 3 }, newbie = { yes: 0, replies: 0, follower: true }, flaky = { yes: 0, replies: 3, unanswered: 2, attended: 0 };
  assert.equal(Math.round(replyRate(regular) * 100), 86, "(3 + 2*.65) / (3 + 2)");
  assert.equal(Math.round(replyRate(newbie) * 100), 40, "no history: the follower base rate");
  assert.ok(replyRate(flaky) < 0.2, "five asks, no yes");
  assert.equal(expectedYes([regular, regular, newbie, flaky]), 2);
  assert.equal(expectedYes([]), 0);
});

test("chips read in plain words and match", () => {
  assert.equal(chipLabel({ k: "came", n: 2 }), "Came 2+ times");
  assert.equal(chipLabel({ k: "noShow", not: true }), "No no-shows");
  assert.equal(chipLabel({ k: "city", v: "Brooklyn" }), "In Brooklyn");
  const p = { attended: 2, follower: true, city: "Brooklyn, NY", tags: ["VIP"], noShows: 0, replies: 2, lastReply: { response: "maybe" } };
  assert.ok(matchAll(p, [{ k: "came", n: 2 }, { k: "follower" }, { k: "city", v: "brooklyn" }, { k: "tag", v: "vip" }, { k: "noShow", not: true }, { k: "maybeLast" }]));
  assert.ok(!chipMatch(p, { k: "repliedNeverCame" }));
});

test("waves: VIPs and the fan club now, the rest 48 hours later, then everyone, never after the day before", () => {
  const t0 = Date.parse("2026-12-01T15:00:00Z");
  const W = defaultWaves(t0, { date: "2026-12-20", startTime: "19:00" });
  assert.deepEqual(W.map((w) => w.kind), ["people", "people", "public"]);
  assert.equal(W[0].at, t0); assert.equal(W[1].at - W[0].at, 48 * 3600e3); assert.equal(W[2].at - W[1].at, 48 * 3600e3);
  const close = defaultWaves(t0, { date: "2026-12-03", startTime: "19:00" }), last = Date.parse("2026-12-03T19:00:00") - 24 * 3600e3;
  assert.ok(close[2].at <= last && close[1].at > t0, "a close date squeezes the gap");
  assert.equal(waveFor({}, { club: true, tags: [] }, W), "w1"); assert.equal(waveFor({}, { tags: ["VIP"] }, W), "w1");
  assert.equal(waveFor({}, { follower: true, tags: [] }, W), "w2"); assert.equal(waveFor({ wave: "w1" }, { tags: [] }, W), "w1", "the host's pick wins");
});

test("status transitions: planned, invited, seen, replied, let in or waitlist, came", () => {
  const ev = { date: day(5) }, past = { date: day(-1) };
  assert.equal(statusOf({}, null, ev), "planned"); assert.equal(statusOf({ invitedAt: 1 }, null, ev), "invited"); assert.equal(statusOf({ invitedAt: 1, seenAt: 2 }, null, ev), "seen");
  assert.equal(statusOf({ invitedAt: 1, seenAt: 2 }, { response: "maybe" }, ev), "maybe"); assert.equal(statusOf({}, { response: "declined" }, ev), "no");
  assert.equal(statusOf({}, { response: "requested" }, ev), "asked"); assert.equal(statusOf({}, { response: "going" }, ev), "yes"); assert.equal(statusOf({}, { response: "going", letInAt: 5 }, ev), "in");
  assert.equal(statusOf({}, { response: "waitlist" }, ev), "waitlist");
  assert.equal(statusOf({}, { response: "going", checkedInAt: 9 }, ev), "came"); assert.equal(statusOf({}, { response: "going", noShow: true }, past), "noshow");
  assert.equal(statusOf({}, { response: "going" }, past, { door: true }), "noshow", "a door list was used and they weren't on it");
  assert.equal(statusOf({}, { response: "going" }, past), "came");
});

test("import reads pasted emails and CSVs with a header", () => {
  const a = readImport("Ada Byron <ada@x.com>, bo@y.com; not-an-email\nada@x.com");
  assert.equal(a.rows.length, 3); assert.equal(a.rows[0].name, "Ada Byron"); assert.deepEqual(a.bad, ["not-an-email"]);
  const b = readImport('Email,First name,Last name,Company,Marketing opt-in\n"cy@z.com",Cy,"Ng, Jr",Acme,yes\ndee@z.com,Dee,,,no\n');
  assert.equal(b.rows.length, 2); assert.equal(b.rows[0].name, "Cy Ng, Jr"); assert.equal(b.rows[0].company, "Acme"); assert.equal(b.rows[0].optin, "in"); assert.equal(b.rows[1].optin, "out");
});

// ---------------- People ----------------
test("People builds itself from replies, attendance, follows, the fan club and kudos, with no import", async () => {
  const { bo, ana, sam, kim, joe } = await withHistory("bo-ppl");
  const fan = await person("Fen Odo"); await post("/api/me/following/bo-ppl", { on: true }, fan.cookie);
  await post("/api/host/club", { on: true }, bo.cookie); const mem = await person("Mo Rai"); assert.equal((await post("/api/me/club/bo-ppl/join", {}, mem.cookie)).status, 200);
  const j = await getJ("/api/contacts", bo.cookie); assert.equal(j.role, "manage"); assert.equal(j.brand, false);
  const by = (em) => j.people.find((p) => p.email === em);
  const A = by(ana.email); assert.equal(A.attended, 2); assert.equal(A.plusOnes, 2); assert.ok(A.via.includes("came")); assert.equal(A.name, "Ana Lee", "they typed a full name");
  assert.equal(by(sam.email).lastReply.response, "maybe"); assert.equal(by(kim.email).noShows, 1); assert.equal(by(kim.email).attended, 0);
  assert.equal(by(joe.email).attended, 0); assert.equal(by(joe.email).replies, 1);
  assert.ok(by(fan.email).follower); assert.equal(by(fan.email).name, "Fen", "an account follow shows a first name");
  assert.ok(by(mem.email).club && by(mem.email).follower, "a member follows too");
  assert.ok(!j.people.some((p) => p.email === bo.email), "the host isn't in their own book");
  assert.ok(A.lastSeen > 0);
});

test("smart lists: live counts for the built-in lists and saved ones", async () => {
  const { bo, ana, sam } = await withHistory("bo-lists");
  let j = await getJ("/api/contacts", bo.cookie); const L = (name) => j.lists.find((l) => l.name === name);
  assert.equal(L("Came 2+ times").count, 1); assert.equal(L("Said maybe last time").count, 1); assert.equal(L("No-shows").count, 1); assert.equal(L("Never came but replied").count, 2, "Kim (no-show) and Joe");
  // tag a VIP, save "VIP, no no-shows"
  const anaId = j.people.find((p) => p.email === ana.email).id;
  assert.equal((await post("/api/contacts/" + anaId, { tags: ["VIP", "Friend"], notes: "Loves natural wine" }, bo.cookie)).status, 200);
  j = await getJ("/api/contacts", bo.cookie); assert.equal(L("VIP").count, 1);
  const r = await post("/api/contacts-lists", { name: "Best guests", chips: [{ k: "tag", v: "VIP" }, { k: "noShow", not: true }] }, bo.cookie); assert.equal(r.status, 200);
  const saved = (await r.json()).lists.find((l) => l.name === "Best guests"); assert.equal(saved.count, 1); assert.deepEqual(saved.labels, ["VIP", "No no-shows"]);
  const c = await getJ("/api/contacts-count?chips=" + encodeURIComponent(JSON.stringify([{ k: "came", n: 1 }])), bo.cookie); assert.equal(c.count, 2); assert.deepEqual(c.labels, ["Came 1+ times"]);
  const one = await getJ("/api/contacts?list=" + saved.id, bo.cookie); assert.equal(one.count, 1);
  assert.equal((await getJ("/api/contacts?q=sam", bo.cookie)).people[0].email, sam.email, "search");
});

// ---------------- the plan ----------------
test("the Invite tab: pick from a list, the capacity meter, waves on schedule, the status board, reminders", async () => {
  const { bo, ana, sam, kim } = await withHistory("bo-plan");
  const fan = await person("Fen Odo"); await post("/api/me/following/bo-plan", { on: true }, fan.cookie);
  const id = await event(bo, 12, { headcount: 6 });
  let r = await post(`/api/plan/${id}/add`, { chips: [{ k: "noShow", not: true }] }, bo.cookie); let j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j));
  assert.equal(j.added, 4, "Ana, Sam, Joe and the follower, not Kim");
  let pl = j.plan; assert.equal(pl.meter.invited, 4); assert.equal(pl.meter.seats, 6); assert.match(pl.meter.line, /^4 on the list · 6 seats · expect ~\d+ yes$/);
  assert.equal(pl.waves.length, 3); assert.equal(pl.counts.planned, 4); assert.ok(pl.rows.every((x) => x.status === "planned"));
  // tag Ana VIP: she moves to the first wave
  const anaId = pl.rows.find((x) => x.email === ana.email).id; await post("/api/contacts/" + anaId, { tags: ["VIP"] }, bo.cookie);
  pl = await getJ(`/api/plan/${id}`, bo.cookie); assert.equal(pl.rows.find((x) => x.id === anaId).wave, "w1"); assert.equal(pl.waves[0].people, 1);
  // the first wave is due now; the second isn't
  const I = srv.app.locals.invites, before = fakeOutbox.length; await I.runDue(Date.now() + 1000);
  pl = await getJ(`/api/plan/${id}`, bo.cookie); assert.equal(pl.rows.find((x) => x.id === anaId).status, "invited"); assert.equal(pl.counts.planned, 3, "wave 2 waits 48 hours");
  const mail = fakeOutbox.slice(before).find((m) => m.to.includes(ana.email)); assert.ok(mail, "Ana got an email"); assert.match(mail.text, /\/api\/public\/inv\//); assert.ok(!mail.text.includes(sam.email), "nobody else's email");
  await I.runDue(Date.now() + 49 * 3600e3); pl = await getJ(`/api/plan/${id}`, bo.cookie); assert.equal(pl.counts.planned, 0); assert.ok(pl.waves[1].sentAt);
  assert.ok(pl.rows.find((x) => x.email === fan.email).invitedAt, "the follower has an account: the bell");
  // seen through the personal link
  const tok = mail.text.match(/\/api\/public\/inv\/([^\s]+)/)[1]; const s = await fetch(srv.base + "/api/public/inv/" + tok, { redirect: "manual" }); assert.equal(s.status, 302); assert.equal(s.headers.get("location"), "/e/" + id);
  pl = await getJ(`/api/plan/${id}`, bo.cookie); assert.equal(pl.rows.find((x) => x.id === anaId).status, "seen");
  assert.equal((await fetch(srv.base + "/api/public/inv/" + tok.slice(0, -2) + "xx", { redirect: "manual" })).headers.get("location"), "/", "a forged link does nothing");
  // replies move people along the board
  await guestRsvp(bo.ws, { eventId: id, name: "Ana Lee", email: ana.email, response: "going" });
  await guestRsvp(bo.ws, { eventId: id, name: "Sam", email: sam.email, response: "no" });
  pl = await getJ(`/api/plan/${id}`, bo.cookie); assert.equal(pl.rows.find((x) => x.id === anaId).status, "yes"); assert.equal(pl.counts.no, 1);
  assert.equal(pl.board.find((b) => b.k === "replied").n, 2); assert.ok(pl.meter.expect >= 1);
  // fill the empty seats: someone who came before and wasn't asked, never a no-show
  const past = await event(bo, -20); await hostRsvp(bo, { eventId: past, name: "Lou Bell", email: "lou.plan@example.com", response: "going" });
  pl = await getJ(`/api/plan/${id}`, bo.cookie); assert.ok(pl.fill, "a no frees a seat"); assert.match(pl.fill.text, /^1 can't make it\./);
  const book = await getJ("/api/contacts", bo.cookie), louId = book.people.find((p) => p.email === "lou.plan@example.com").id, kimId = book.people.find((p) => p.email === kim.email).id;
  assert.ok(pl.fill.ids.includes(louId)); assert.ok(!pl.fill.ids.includes(kimId), "never a no-show");
  // one-tap reminders to people who haven't replied, once a day at most
  r = await post(`/api/plan/${id}/remind`, {}, bo.cookie); j = await r.json(); assert.equal(j.reminded, 2, "Joe and the follower");
  j = await (await post(`/api/plan/${id}/remind`, {}, bo.cookie)).json(); assert.equal(j.reminded, 0); assert.equal(j.tooSoon, 2);
});

test("add someone new by email straight onto an event's list", async () => {
  const bo = await host("Bo Tran", "bo-new"); const id = await event(bo, 12);
  const j = await (await post(`/api/plan/${id}/add`, { emails: "Jess Moon <jess@example.com>" }, bo.cookie)).json(); assert.equal(j.added, 1); assert.equal(j.plan.rows[0].name, "Jess Moon");
  assert.ok((await getJ("/api/contacts", bo.cookie)).people.some((p) => p.email === "jess@example.com"), "they're in People too");
  assert.equal((await post(`/api/plan/${id}/add`, { emails: "nope" }, bo.cookie)).status, 400);
});

test("the public wave opens the event to everyone", async () => {
  const bo = await host("Bo Tran", "bo-pub"); const id = await event(bo, 12, { published: false, discoverable: false, unlisted: true });
  await post(`/api/plan/${id}/add`, { ids: [] }, bo.cookie);
  await srv.app.locals.invites.runDue(Date.now() + 200 * 3600e3);
  const ev = srv.store.get(`ws/${bo.ws}/events/${id}`).data; assert.equal(ev.discoverable, true); assert.equal(ev.unlisted, false);
});

test("Ask to join with context, check-in, thank-you and invite these people to the next one", async () => {
  const { bo, ana } = await withHistory("bo-ask");
  const id = await event(bo, 3, { approvalRequired: true, headcount: 10 }), next = await event(bo, 40);
  assert.equal((await guestRsvp(bo.ws, { eventId: id, name: "Ana Lee", email: ana.email, response: "going" })).status, 200);
  let pl = await getJ(`/api/plan/${id}`, bo.cookie); assert.equal(pl.asks.length, 1); assert.ok(pl.asks[0].context.includes("Came 2 times"), JSON.stringify(pl.asks[0].context));
  // let in through the same door the app uses, then check in at the door
  const rid = pl.asks[0].rid; assert.equal((await patch("rsvps/" + rid, { response: "going", decidedAt: Date.now() }, bo.cookie)).status, 200);
  pl = await getJ(`/api/plan/${id}`, bo.cookie); assert.equal(pl.rows.find((x) => x.rid === rid).status, "in");
  await patch("rsvps/" + rid, { checkedInAt: Date.now(), noShow: false }, bo.cookie);
  pl = await getJ(`/api/plan/${id}`, bo.cookie); assert.equal(pl.rows.find((x) => x.rid === rid).status, "came");
  const t = await (await post(`/api/plan/${id}/thanks`, {}, bo.cookie)).json(); assert.equal(t.thanked, 1); assert.equal((await (await post(`/api/plan/${id}/thanks`, {}, bo.cookie)).json()).already, true, "once");
  const c = await (await post(`/api/plan/${id}/next`, { to: next }, bo.cookie)).json(); assert.equal(c.added, 1);
  assert.ok((await getJ(`/api/plan/${next}`, bo.cookie)).rows.some((x) => x.email === ana.email));
});

test("suggested lists: regulars who haven't been invited yet", async () => {
  const { bo } = await withHistory("bo-sugg"); await event(bo, 4);
  const j = await getJ("/api/contacts", bo.cookie); const s = j.suggestions.find((x) => /regular/.test(x.text)); assert.ok(s, JSON.stringify(j.suggestions)); assert.match(s.text, /^1 regular hasn't been invited to /);
});

// ---------------- privacy ----------------
test("privacy: workspaces are separate, blocks take people out, unsubscribes are honoured, emails never reach guests", async () => {
  const { bo, ana, sam } = await withHistory("bo-priv"), cy = await host("Cy Ng", "cy-priv");
  assert.equal((await getJ("/api/contacts", cy.cookie)).total, 0, "another host sees nothing of Bo's book");
  const p0 = await getJ("/api/contacts", bo.cookie), anaId = p0.people.find((p) => p.email === ana.email).id;
  assert.equal((await get("/api/contacts/" + anaId, cy.cookie)).status, 404); assert.equal((await post("/api/contacts/" + anaId, { tags: ["x"] }, cy.cookie)).status, 404);
  assert.equal((await get("/api/contacts")).status, 401);
  const id = await event(bo, 9); assert.equal((await get(`/api/plan/${id}`, cy.cookie)).status, 404, "nor Bo's plan");
  // a guest account blocks the host: gone from the book and the plan
  const blocker = await person("Bea Lo"); await hostRsvp(bo, { eventId: p0.people[0] ? (await event(bo, -3)) : "", email: blocker.email, name: "Bea Lo", response: "going" });
  assert.ok((await getJ("/api/contacts", bo.cookie)).people.some((p) => p.email === blocker.email));
  assert.equal((await post("/api/me/blocks", { kind: "host", handle: "bo-priv" }, blocker.cookie)).status, 200);
  assert.ok(!(await getJ("/api/contacts", bo.cookie)).people.some((p) => p.email === blocker.email), "blocked: out of the book");
  // unsubscribed: still in the book, marked, never emailed
  setUnsubscribed(sam.email, true);
  const after = await getJ("/api/contacts", bo.cookie), S = after.people.find((p) => p.email === sam.email); assert.equal(S.unsubscribed, true); assert.equal(S.consent.status, "out");
  await post(`/api/plan/${id}/add`, { ids: [S.id] }, bo.cookie); const before = fakeOutbox.length;
  const r = await (await post(`/api/plan/${id}/send`, { ids: [S.id] }, bo.cookie)).json(); assert.equal(r.sent, 0); assert.equal(r.skipped, 1);
  assert.ok(!fakeOutbox.slice(before).some((m) => m.to.includes(sam.email)));
  assert.equal((await getJ(`/api/plan/${id}`, bo.cookie)).rows.find((x) => x.id === S.id).skipped, "Unsubscribed");
  setUnsubscribed(sam.email, false);
  // nothing public carries an email
  for (const u of [`/api/public/seats/${id}`, `/api/public/host/bo-priv`, `/api/public/going/${id}`]) { const t = await (await get(u)).text(); assert.ok(!t.includes(ana.email) && !t.includes(sam.email), u); }
});

test("a guest sees what a host holds about them and deletes it", async () => {
  const bo = await host("Bo Tran", "bo-held"), g = await person("Gil Ray"); const p = await event(bo, -5);
  await hostRsvp(bo, { eventId: p, email: g.email, name: "Gil Ray", response: "going" });
  const gid = (await getJ("/api/contacts", bo.cookie)).people.find((x) => x.email === g.email).id; await post("/api/contacts/" + gid, { tags: ["VIP"], notes: "Brings a cake" }, bo.cookie);
  const held = await getJ("/api/me/held", g.cookie); const h = held.hosts.find((x) => x.host === "Bo Tran"); assert.ok(h); assert.deepEqual(h.tags, ["VIP"]); assert.equal(h.notes, "Brings a cake"); assert.equal(h.attended, 1);
  assert.ok(!JSON.stringify(held).includes(bo.email), "never the host's email");
  const d = await (await fetch(srv.base + "/api/me/held/" + h.ws, { method: "DELETE", headers: { cookie: g.cookie } })).json(); assert.equal(d.hosts, 1);
  assert.ok(!(await getJ("/api/contacts", bo.cookie)).people.some((x) => x.email === g.email), "forgotten, and not rebuilt from old replies");
  assert.equal((await getJ("/api/me/held", g.cookie)).hosts.length, 0);
});

test("sends are rate limited per workspace and finish on the next run", async () => {
  const bo = await host("Bo Tran", "bo-rl"); const id = await event(bo, 20);
  const ppl = Array.from({ length: 5 }, (_, i) => `rl${i}@example.com`); await post("/api/contacts-import", { text: ppl.join(", ") }, bo.cookie);
  const old = LIMITS.perHour; LIMITS.perHour = 3;
  try { await post(`/api/plan/${id}/add`, { chips: [{ k: "imported" }] }, bo.cookie);
    const r = await (await post(`/api/plan/${id}/send`, {}, bo.cookie)).json(); assert.equal(r.sent, 3); assert.equal(r.held, 2); }
  finally { LIMITS.perHour = old; }
  srv.app.locals.invites._sent.clear(); const r2 = await (await post(`/api/plan/${id}/send`, {}, bo.cookie)).json(); assert.equal(r2.sent, 2);
});

// ---------------- brands ----------------
test("brands: team roles decide who sees contacts, company fields, consent, per-list exports", async () => {
  const br = await host("Fernwood", "fernwood-ip", "work");
  const inv = await (await post("/api/invite", { email: "rep@fernwood.example", role: "Field marketer" }, br.cookie)).json();
  const jr = await post("/api/join", { token: inv.token, name: "Rae Puri", password: "long-password-1" }); assert.equal(jr.status, 200); const rep = cookieOf(jr);
  const csv = "Email,Name,Company,Title,City,Marketing opt-in\nlena@acme.example,Lena Ortiz,Acme,VP Data,Brooklyn,yes\nomar@globex.example,Omar Haddad,Globex,CTO,Queens,\n";
  let j = await (await post("/api/contacts-import", { text: csv, source: "Booth scan, Nov 2026" }, br.cookie)).json(); assert.equal(j.added, 2);
  let book = await getJ("/api/contacts", br.cookie); assert.equal(book.brand, true); const L = book.people.find((p) => p.email === "lena@acme.example");
  assert.equal(L.company, "Acme"); assert.equal(L.title, "VP Data"); assert.equal(L.consent.status, "in"); assert.equal(L.consent.source, "Booth scan, Nov 2026"); assert.equal(L.name, "Lena Ortiz");
  assert.equal(book.people.find((p) => p.email === "omar@globex.example").consent.status, "unknown");
  // a team member reads names and companies, not emails or notes; can't export or edit
  let rv = await getJ("/api/contacts", rep); assert.equal(rv.role, "view"); const L2 = rv.people.find((p) => p.company === "Acme"); assert.equal(L2.email, "l***@acme.example"); assert.equal(L2.notes, "");
  assert.equal((await get("/api/contacts-export.csv", rep)).status, 403); assert.equal((await post("/api/contacts/" + L2.id, { tags: ["x"] }, rep)).status, 403);
  // the owner sets roles
  assert.equal((await post("/api/contacts-team", { email: "rep@fernwood.example", access: "none" }, br.cookie)).status, 200);
  assert.equal((await get("/api/contacts", rep)).status, 403);
  await post("/api/contacts-team", { email: "rep@fernwood.example", access: "manage" }, br.cookie); assert.equal((await getJ("/api/contacts", rep)).people.find((p) => p.company === "Acme").email, "lena@acme.example");
  assert.equal((await post("/api/contacts-team", { email: "rep@fernwood.example", access: "manage" }, rep)).status, 403, "only the owner changes roles");
  // the brand only emails people who opted in
  const id = await event(br, 15); await post(`/api/plan/${id}/add`, { chips: [{ k: "imported" }] }, br.cookie); const s = await (await post(`/api/plan/${id}/send`, {}, br.cookie)).json(); assert.equal(s.sent, 1); assert.equal(s.skipped, 1);
  assert.equal((await getJ(`/api/plan/${id}`, br.cookie)).rows.find((x) => x.company === "Globex").skipped, "No email opt-in");
  // this event's list, with each person's status
  const ex = await (await get(`/api/plan/${id}/export.csv`, br.cookie)).text(); assert.match(ex.split("\n")[0], /"Status","Invited","Seen"/); assert.match(ex, /"lena@acme\.example","Lena","Ortiz","Acme","VP Data","","Invited"/);
  assert.equal((await get(`/api/plan/${id}/export.csv`, rep)).status, 200, "a manager on the team can export");
  // per-list export for the CRM, with consent
  const x = await get("/api/contacts-export.csv?name=Acme&chips=" + encodeURIComponent(JSON.stringify([{ k: "company", v: "Acme" }])), br.cookie); assert.equal(x.status, 200);
  const text = await x.text(); assert.match(x.headers.get("content-disposition"), /Acme\.csv/); assert.match(text, /"lena@acme\.example","","Lena","Ortiz","Acme","VP Data","Brooklyn"/); assert.ok(!text.includes("omar@"));
  assert.match(text.split("\n")[0], /Email opt-in","Opt-in source","Opt-in date","Unsubscribed"/);
});

test("import dedupe: a preview says who's new, who's here and the repeats", async () => {
  const { bo, ana } = await withHistory("bo-imp");
  const text = `new1@example.com, ${ana.email}, NEW1@example.com, Pat Doe <pat@example.com>`;
  const p = await (await post("/api/contacts-import/preview", { text }, bo.cookie)).json();
  assert.equal(p.add.length, 2); assert.equal(p.update.length, 1); assert.equal(p.update[0].email, ana.email); assert.equal(p.dupes, 1);
  const r = await (await post("/api/contacts-import", { text }, bo.cookie)).json(); assert.equal(r.added, 2); assert.equal(r.updated, 1);
  const again = await (await post("/api/contacts-import/preview", { text }, bo.cookie)).json(); assert.equal(again.add.length, 0, "importing twice adds no one");
  const book = await getJ("/api/contacts", bo.cookie); assert.equal(book.people.filter((x) => x.email === ana.email).length, 1); assert.ok(book.people.find((x) => x.email === ana.email).attended === 2, "her history stays");
});

// ---------------- seats by audience ----------------
test("seat presets split the spots", () => {
  const t0 = Date.now(), ev = { date: day(14) };
  const ev2 = preset("even", { cap: 24, t0, ev, club: true }); assert.deepEqual(ev2.map((b) => [b.kind, b.n]), [["club", 8], ["regulars", 8], ["everyone", 8]]);
  const fr = preset("fresh", { cap: 24, t0, ev }); assert.deepEqual(fr.map((b) => [b.kind, b.n]), [["new", 12], ["everyone", 12]]);
  const mf = preset("members", { cap: 24, t0, ev, club: true, tiers: ["founding"] }); assert.equal(mf[0].kind, "tier"); assert.ok(mf[0].opensAt < mf[1].opensAt, "paid supporters open earlier");
  assert.equal(mf.reduce((s, b) => s + b.n, 0), 24); assert.ok(preset("regulars", { cap: 24, t0, ev })[0].releaseAt > t0, "roll-over on by default");
  assert.deepEqual(cleanBlocks([{ kind: "bogus", n: 3 }, { kind: "club", n: 0 }]).map((b) => b.kind), ["everyone"]);
});

test("seats: members get their block first, everyone else waits for the open time, full blocks go to the waitlist", async () => {
  const bo = await host("Bo Tran", "bo-seats"); await post("/api/host/club", { on: true }, bo.cookie);
  const id = await event(bo, 10, { headcount: 4, discoverable: true });
  const t = Date.now(), wed = t + 48 * 3600e3;
  let r = await post(`/api/plan/${id}/seats`, { on: true, blocks: [{ id: "club", kind: "club", n: 2, opensAt: t - 1000, releaseAt: wed }, { id: "all", kind: "everyone", n: 2, opensAt: wed }] }, bo.cookie); let j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j)); assert.equal(j.line, "Fan club 0/2 · Everyone else 0/2");
  const m1 = await person("Mia One"), m2 = await person("Max Two"), m3 = await person("Moe Three"), pub = await person("Pat Public");
  for (const m of [m1, m2, m3]) assert.equal((await post("/api/me/club/bo-seats/join", {}, m.cookie)).status, 200);
  // the guest side, plain
  assert.equal((await getJ(`/api/public/seats/${id}`, m1.cookie)).line, "Members get first dibs. 2 member seats left.");
  const pl = await getJ(`/api/public/seats/${id}`, pub.cookie); assert.match(pl.line, /^Opens to everyone \w{3} \d/); assert.equal(pl.remind, true); assert.ok(!/member|Fan club/i.test(JSON.stringify(pl)), "the public never reads about other blocks");
  // the public waits; members get in
  r = await guestRsvp(bo.ws, { eventId: id, name: "Pat Public", email: pub.email, response: "going" }, pub.cookie); assert.equal(r.status, 403); assert.equal((await r.json()).code, "seats_not_open");
  assert.equal((await (await post(`/api/public/seats/${id}/remind`, {}, pub.cookie)).json()).at > 0, true, "Remind me");
  for (const m of [m1, m2]) { r = await guestRsvp(bo.ws, { eventId: id, name: m.name, email: m.email, response: "going" }, m.cookie); assert.equal(r.status, 200, await r.text()); }
  const docs = srv.store.list(`ws/${bo.ws}/rsvps`).map((d) => d.data).filter((x) => x.eventId === id); assert.deepEqual(docs.map((x) => x.seatBlock), ["club", "club"]);
  // the member block is full, everyone else isn't open: the third member waits for the open time too
  r = await guestRsvp(bo.ws, { eventId: id, name: m3.name, email: m3.email, response: "going" }, m3.cookie); assert.equal(r.status, 403);
  j = await getJ(`/api/plan/${id}/seats`, bo.cookie); assert.equal(j.line, "Fan club 2/2 · Everyone else 0/2");
  assert.equal((await getJ(`/api/plan/${id}`, bo.cookie)).seats.line, "Fan club 2/2 · Everyone else 0/2", "the status board shows the blocks");
  // once everyone opens, the public gets the open block, then the waitlist
  const Z = srv.app.locals.seats, cfg = Z.cfgOf(bo.ws, id); cfg.blocks[1].opensAt = Date.now() - 1000; Z.setCfg(bo.ws, id, { blocks: cfg.blocks });
  r = await guestRsvp(bo.ws, { eventId: id, name: "Pat Public", email: pub.email, response: "going", party: 2 }, pub.cookie); assert.equal(r.status, 200, await r.text());
  const x = await guestRsvp(bo.ws, { eventId: id, name: m3.name, email: m3.email, response: "going" }, m3.cookie); assert.equal(x.status, 200);
  const all = srv.store.list(`ws/${bo.ws}/rsvps`).map((d) => d.data).filter((d) => d.eventId === id); assert.equal(all.find((d) => d.email === m3.email).response, "waitlist");
  assert.equal((await getJ(`/api/public/seats/${id}`, m3.cookie)).full, true);
});

test("seats: unfilled member seats roll over to everyone at the release time", async () => {
  const bo = await host("Bo Tran", "bo-roll"); await post("/api/host/club", { on: true }, bo.cookie);
  const id = await event(bo, 10, { headcount: 4 }), t = Date.now();
  await post(`/api/plan/${id}/seats`, { on: true, blocks: [{ id: "club", kind: "club", n: 3, opensAt: t - 1000, releaseAt: t - 500 }, { id: "all", kind: "everyone", n: 1, opensAt: t - 1000 }] }, bo.cookie);
  const s = await getJ(`/api/plan/${id}/seats`, bo.cookie); assert.equal(s.line, "Fan club 0/0 · Everyone else 0/4"); assert.equal(s.blocks[0].released, true);
  const a = await person("Al Pub"), b = await person("Bea Pub");
  assert.equal((await guestRsvp(bo.ws, { eventId: id, name: a.name, email: a.email, response: "going", party: 2 }, a.cookie)).status, 200);
  assert.equal((await guestRsvp(bo.ws, { eventId: id, name: b.name, email: b.email, response: "going", party: 2 }, b.cookie)).status, 200);
  const all = srv.store.list(`ws/${bo.ws}/rsvps`).map((d) => d.data).filter((d) => d.eventId === id); assert.ok(all.every((d) => d.response === "going"), "4 spots for everyone after roll-over");
  // with roll-over off, the member seats stay for members
  await post(`/api/plan/${id}/seats`, { rollover: false }, bo.cookie); assert.equal((await getJ(`/api/plan/${id}/seats`, bo.cookie)).line, "Fan club 0/3 · Everyone else 4/1");
});

test("seats: someone the host invited personally doesn't wait for the public open time", async () => {
  const bo = await host("Bo Tran", "bo-invd"); const id = await event(bo, 10, { headcount: 4 }), t = Date.now();
  await post(`/api/plan/${id}/seats`, { on: true, blocks: [{ id: "all", kind: "everyone", n: 4, opensAt: t + 48 * 3600e3 }] }, bo.cookie);
  const g = await person("Gus Invited"), other = await person("Oli Other");
  await post("/api/contacts-import", { text: g.email }, bo.cookie);
  const gid = (await getJ("/api/contacts", bo.cookie)).people.find((p) => p.email === g.email).id;
  await post(`/api/plan/${id}/add`, { ids: [gid] }, bo.cookie); assert.equal((await (await post(`/api/plan/${id}/send`, { ids: [gid] }, bo.cookie)).json()).sent, 1);
  assert.equal((await guestRsvp(bo.ws, { eventId: id, name: g.name, email: g.email, response: "going" }, g.cookie)).status, 200);
  assert.equal((await guestRsvp(bo.ws, { eventId: id, name: other.name, email: other.email, response: "going" }, other.cookie)).status, 403, "everyone else still waits");
});

test("a personal invite skips the fan club's members-first wait; everyone else still waits", async () => {
  const bo = await host("Bo Tran", "bo-early"); await post("/api/host/club", { on: true }, bo.cookie); const id = await event(bo, 10, { discoverable: true });
  const g = await person("Gia Asked"), o = await person("Ola Other"); await post("/api/contacts-import", { text: g.email }, bo.cookie);
  const gid = (await getJ("/api/contacts", bo.cookie)).people.find((p) => p.email === g.email).id; await post(`/api/plan/${id}/add`, { ids: [gid] }, bo.cookie); await post(`/api/plan/${id}/send`, { ids: [gid] }, bo.cookie);
  const r = await guestRsvp(bo.ws, { eventId: id, name: o.name, email: o.email, response: "going" }, o.cookie); assert.equal(r.status, 403); assert.equal((await r.json()).code, "club_early");
  assert.equal((await guestRsvp(bo.ws, { eventId: id, name: g.name, email: g.email, response: "going" }, g.cookie)).status, 200);
});

test("seats: two people racing for the last block seat, one gets it", async () => {
  const bo = await host("Bo Tran", "bo-race"); const id = await event(bo, 10, { headcount: 1 }), t = Date.now();
  await post(`/api/plan/${id}/seats`, { on: true, blocks: [{ id: "all", kind: "everyone", n: 1, opensAt: t - 1000 }] }, bo.cookie);
  const a = await person("Ann Race"), b = await person("Ben Race");
  const R = await Promise.all([a, b].map((g) => guestRsvp(bo.ws, { eventId: id, name: g.name, email: g.email, response: "going" }, g.cookie)));
  assert.deepEqual(R.map((r) => r.status), [200, 200]);
  const all = srv.store.list(`ws/${bo.ws}/rsvps`).map((d) => d.data).filter((d) => d.eventId === id); assert.deepEqual(all.map((d) => d.response).sort(), ["going", "waitlist"]);
});

test("seats: paid supporter tiers get their own block on the web and are never named in the app", async () => {
  const bo = await host("Bo Tran", "bo-tier"); await post("/api/host/profile", { handle: "bo-tier", name: "Bo Tran", support: { founding: 100 } }, bo.cookie);
  const id = await event(bo, 10, { headcount: 6 });
  let s = await getJ(`/api/plan/${id}/seats`, bo.cookie); assert.ok(s.kinds.includes("tier"), "the web offers supporter blocks"); assert.equal(s.tiers[0].id, "founding");
  const APP = { "user-agent": "Mozilla/5.0 (iPhone) PotteryLabApp/1.0" };
  const sApp = await getJ(`/api/plan/${id}/seats`, bo.cookie, APP); assert.ok(!sApp.kinds.includes("tier") && !sApp.tiers.length, "the app never offers paid tiers");
  const t = Date.now(); await post(`/api/plan/${id}/seats`, { on: true, blocks: [{ id: "pat", kind: "tier", tier: "founding", n: 2, opensAt: t - 1000 }, { id: "all", kind: "everyone", n: 4, opensAt: t + 48 * 3600e3 }] }, bo.cookie);
  const fan = await person("Fay Patron"); assert.equal((await post("/api/public/pledge", { handle: "bo-tier", tier: "founding", email: fan.email, name: fan.name }, fan.cookie)).status, 200);
  assert.equal((await getJ(`/api/public/seats/${id}`, fan.cookie)).line, "Supporters get first dibs. 2 supporter seats left.");
  const inApp = await getJ(`/api/public/seats/${id}`, fan.cookie, APP); assert.ok(!/supporter|patron|founding|tier/i.test(inApp.line), inApp.line); assert.equal(inApp.line, "You get first dibs. 2 early seats left.");
  assert.ok(!/founding|Supporter/i.test(JSON.stringify((await getJ(`/api/plan/${id}/seats`, bo.cookie, APP)).blocks)), "the host's own app view doesn't name it either");
  assert.equal((await guestRsvp(bo.ws, { eventId: id, name: fan.name, email: fan.email, response: "going" }, fan.cookie)).status, 200);
  // the app can't wipe out the paid block when it saves
  await post(`/api/plan/${id}/seats`, { blocks: [{ id: "all", kind: "everyone", n: 6 }] }, bo.cookie, APP); assert.ok(srv.app.locals.seats.cfgOf(bo.ws, id).blocks.some((b) => b.kind === "tier"));
});
