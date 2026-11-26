// Weekly and monthly events keep going: the job makes exactly one next date, an old link points to it, a course
// stops after its last session, and the monthly first-Sunday rule picks the right day (server/repeats.js).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore } from "../server/workspaces.js";
import { stepDate, nextRepeatDate, nextCopy, continues } from "../server/repeats.js";

let srv, host, ws;
const J = { "Content-Type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const put = (path, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const morning = Date.parse(day(0) + "T15:00:00Z"); // 3pm UTC today: the morning after anything dated yesterday (tz UTC)
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "repeats-secret", ENCORE_SIGNUP_PER_HOUR: "100", ENCORE_FAKE_EMAIL: "1" };
const S = () => scopeStore(srv.store, ws);
const series = (title) => S().list("events").filter((d) => (d.data.pubTitle || d.data.name) === title).sort((a, b) => a.data.date.localeCompare(b.data.date));

before(async () => {
  Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer();
  const r = await post("/api/signup", { name: "Jo Runner", email: "jo.repeat@example.com", password: "long-password-1", mode: "friends" }); host = r.headers.get("set-cookie").split(";")[0];
  assert.ok((await post("/api/host/profile", { handle: "jo-repeat", name: "Jo's Run Club", city: "Austin" }, host)).ok);
  ws = srv.store.get("system/handle-jo-repeat").data.ws;
  const base = { casual: true, tz: "UTC", startTime: "07:00", published: true, discoverable: true, city: "Austin", activity: "run", price: "$5", ticketUrl: "https://venmo.com/u/jo-runs", headcount: 20, look: { buttonLabel: "Count me in", buttonEmoji: "🏺" } };
  assert.ok((await put("events/rcWeek1", { ...base, name: "Tuesday Run", date: day(-1), repeat: "weekly", earlyUntil: new Date(Date.now() - 864e5).toISOString(), guests: [{ name: "Ana", email: "ana@x.example", status: "Going" }, { name: "Bo", email: "bo@x.example", status: "Invited" }] }, host)).ok);
  assert.ok((await put("events/rcOff", { ...base, name: "Opt-out Run", date: day(-1), repeat: "weekly", autoNext: false }, host)).ok);
  assert.ok((await put("events/rcEnded", { ...base, name: "Last Run", date: day(-1), repeat: "weekly", repeatUntil: day(2) }, host)).ok);
  assert.ok((await put("events/rcCourse", { ...base, name: "Pottery Course", date: day(-15), repeat: "weekly", sessions: 3 }, host)).ok); // sessions: day -15, -8, -1
  assert.ok((await put("events/rcCourse2", { ...base, name: "Clay Course", date: day(-8), repeat: "weekly", sessions: 3 }, host)).ok); // sessions: day -8, -1, +6
  assert.ok((await put("events/rcOnce", { ...base, name: "One-off Run", date: day(-1) }, host)).ok);
  // a guest left kudos on week 1
  const rid = (await (await post("/api/db/collection?path=rsvps", { eventId: "rcWeek1", name: "Ana", email: "ana@x.example", response: "going", code: "AB123", createdAt: Date.now() }, host)).json()).id;
  S().set("kudos/" + rid, { eventId: "rcWeek1", rid, tags: ["again", "vibe"], love: "Great pace", at: Date.now() });
});
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

test("monthly keeps the weekday rule: the first Sunday, the last Friday", () => {
  assert.equal(stepDate("2026-11-01", "monthly"), "2026-12-06", "first Sunday of Nov 2026 -> first Sunday of Dec 2026");
  assert.equal(stepDate("2026-12-06", "monthly"), "2027-01-03", "and of Jan 2027");
  assert.equal(stepDate("2026-11-27", "monthly"), "2026-12-25", "last Friday stays the last Friday");
  assert.equal(stepDate("2026-11-24", "weekly"), "2026-12-01");
  assert.equal(stepDate("2026-11-24", "biweekly"), "2026-12-08");
  assert.equal(nextRepeatDate({ date: "2026-11-01", repeat: "monthly" }, "2026-11-25"), "2026-12-06");
  assert.equal(nextRepeatDate({ date: "2026-11-24", repeat: "weekly", repeatUntil: "2026-11-30" }, "2026-11-25"), "", "past the host's last date");
  assert.equal(continues({ date: "2026-11-24", repeat: "weekly", sessions: 6 }), false, "a course is one event");
  const c = nextCopy("a1", { name: "Run", date: "2026-11-24", repeat: "weekly", kudosAskedAt: 1, guests: [{ name: "A", status: "Going" }, { name: "B", status: "No" }] }, "2026-12-01");
  assert.deepEqual([c.date, c.seriesId, c.prevId, c.kudosAskedAt, c.guests.length, c.guests[0].status], ["2026-12-01", "a1", "a1", undefined, 1, "Invited"]);
});

test("the job makes exactly one next date, with the same settings, and stops where the host said", async () => {
  const r1 = await srv.app.locals.repeats.run({ now: morning, workspaces: [ws] });
  assert.deepEqual(r1.events.map((e) => e.from).sort(), ["rcWeek1"], JSON.stringify(r1));
  const L = series("Tuesday Run"); assert.equal(L.length, 2);
  const [w1, w2] = L; assert.equal(w1.id, "rcWeek1"); assert.equal(w2.data.date, day(6));
  for (const k of ["price", "ticketUrl", "headcount", "city", "discoverable", "published", "startTime", "repeat"]) assert.deepEqual(w2.data[k], w1.data[k], k);
  assert.deepEqual(w2.data.look, w1.data.look, "same look");
  assert.equal(w2.data.seriesId, "rcWeek1"); assert.equal(w2.data.prevId, "rcWeek1"); assert.equal(w2.data.id, w2.id);
  assert.ok(Date.parse(w2.data.earlyUntil) > Date.now(), "followers get first dibs again");
  assert.deepEqual(w2.data.guests.map((g) => [g.name, g.status]), [["Ana", "Invited"]], "last time's crew, ready to invite");
  assert.equal(S().list("kudos").filter((d) => d.data.eventId === "rcWeek1").length, 1, "the kudos stay on week 1");
  // again, and again an hour later: nothing new
  assert.equal((await srv.app.locals.repeats.run({ now: morning, workspaces: [ws] })).made, 0);
  assert.equal((await srv.app.locals.repeats.run({ now: morning + 3600e3, workspaces: [ws] })).made, 0);
  assert.equal(series("Tuesday Run").length, 2, "one next copy per date");
  assert.equal(series("Opt-out Run").length, 1, "the host turned off Make the next one automatically");
  assert.equal(series("Last Run").length, 1, "the next date is after the host's last date");
  assert.equal(series("One-off Run").length, 1, "no repeat, no copy");
  assert.equal(series("Pottery Course").length, 1, "a course doesn't continue after its last session");
  assert.equal(series("Clay Course").length, 1, "nor does it copy itself while running");
  // not before the morning after
  assert.ok((await put("events/rcToday", { casual: true, tz: "UTC", name: "Tonight Run", date: day(0), repeat: "weekly" }, host)).ok);
  assert.equal((await srv.app.locals.repeats.run({ now: morning, workspaces: [ws] })).made, 0, "not the same day");
});

test("a past date's link points to the next one, with its photos and kudos; a running course points to its next session", async () => {
  const next = series("Tuesday Run")[1];
  const j = await (await fetch(srv.base + "/api/public/next/rcWeek1")).json();
  assert.equal(j.next.id, next.id); assert.equal(j.next.date, day(6));
  assert.equal(j.past.kudos, 1); assert.equal(j.past.tags[0].k, "again", "Would go again first");
  const n2 = await (await fetch(srv.base + "/api/public/next/" + next.id)).json(); assert.equal(n2.past, null, "the next one isn't past");
  const off = await (await fetch(srv.base + "/api/public/next/rcOff")).json(); assert.equal(off.next.id, null, "no copy yet, but the date is known"); assert.equal(off.next.date, day(6));
  assert.equal((await (await fetch(srv.base + "/api/public/next/rcCourse")).json()).next, null, "the course has ended");
  const c2 = await (await fetch(srv.base + "/api/public/next/rcCourse2")).json(); assert.deepEqual([c2.next.id, c2.next.date, c2.next.same], ["rcCourse2", day(6), true]);
  assert.equal((await (await fetch(srv.base + "/api/public/next/rcOnce")).json()).next, null);
  // the host can run it for their own events
  assert.equal((await post("/api/host/repeats/run", {}, host)).status, 200);
  assert.equal((await post("/api/host/repeats/run", {})).status === 200, false, "not signed out");
});

test("help: weekly, monthly and courses has its own answer, and the shop answer names the Shop button", async () => {
  const { offlineAnswer, loadGuide } = await import("../server/help.js");
  for (const q of ["How do weekly events work?", "Does my monthly book club make the next one?", "how do I set up a 6 week course"]) assert.equal(offlineAnswer(q).section, "Weekly, monthly and courses", q);
  const G = loadGuide(), shop = G.sections.find((s) => s.title === "The shop and pre-orders");
  assert.match(shop.body, /tap 🛍 Shop/); assert.ok(!/—/.test(G.md));
});

// review round 6: paid events say how to pay in "You're in" and let-in emails
test("paid events: You're in and let-in emails carry the pay link with the amount, I paid, or who sends a way to pay", async () => {
  const { fakeOutbox } = await import("../server/email.js");
  const G = { ...J, "x-encore-guest": "1", "x-encore-workspace": ws };
  const reply = (key, body) => fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...G, "x-encore-key": key }, body: JSON.stringify({ createdAt: Date.now(), code: "PX" + key, ...body }) });
  assert.ok((await put("events/payOpen", { casual: true, name: "Supper", date: day(4), published: true, price: "$45", ticketUrl: "https://venmo.com/u/jo-runs" }, host)).ok);
  assert.ok((await put("events/payNone", { casual: true, name: "Bread class", date: day(4), published: true, price: "$20" }, host)).ok);
  assert.ok((await put("events/payAsk", { casual: true, name: "Tasting", date: day(4), published: true, price: "45", ticketUrl: "https://paypal.me/jo", approvalRequired: true }, host)).ok);
  assert.ok((await put("events/payFree", { casual: true, name: "Picnic", date: day(4), published: true }, host)).ok);
  const m0 = fakeOutbox.length;
  await reply("p1", { eventId: "payOpen", name: "Ana Diaz", email: "ana.pay@x.example", response: "going" });
  await reply("p2", { eventId: "payNone", name: "Bo Chen", email: "bo.pay@x.example", response: "going" });
  await reply("p4", { eventId: "payFree", name: "Di Free", email: "di.pay@x.example", response: "going" });
  const to = (e) => fakeOutbox.slice(m0).find((m) => String(m.to).includes(e));
  const a = to("ana.pay@x.example"); assert.ok(a, "Ana's You're in");
  assert.match(a.text, /\nPay \$45 here: https:\/\/venmo\.com\/jo-runs\?txn=pay&amount=45&note=Ana%20Diaz%20%C2%B7%20Supper\n/);
  assert.match(a.text, /\nAlready paid\? Open your invite and tap I paid: http[^\s]+\/e\/payOpen#reply=/);
  assert.match(to("bo.pay@x.example").text, /\nJo will send you a way to pay\.\n/);
  assert.doesNotMatch(to("di.pay@x.example").text, /\bpay\b/i, "free: nothing about paying");
  const q = await (await reply("p3", { eventId: "payAsk", name: "Cy Lee", email: "cy.pay@x.example", response: "going" })).json();
  const m1 = fakeOutbox.length;
  const r = await (await fetch(srv.base + "/api/db/doc?path=rsvps/" + String(q.id).split("/").pop(), { method: "PATCH", headers: { ...J, cookie: host }, body: JSON.stringify({ response: "going" }) })).json();
  assert.equal(r.letIn.emailed, true);
  const l = fakeOutbox.slice(m1).find((m) => String(m.to).includes("cy.pay@x.example"));
  assert.match(l.text, /let you in/); assert.match(l.text, /\nPay \$45 here: https:\/\/paypal\.me\/jo\/45\nAlready paid\? Open your invite and tap I paid: /);
});
