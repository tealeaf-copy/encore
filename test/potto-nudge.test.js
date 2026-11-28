// Potto nudges the people who haven't replied (server/pottonudge.js, public/pottonudge.js): only people the host invited
// through the app who haven't replied; never the ones who replied, unsubscribed, replied STOP, blocked the host or turned
// emails off; a link-only event gets a message to paste and nothing is sent; nothing goes without confirm; two per person,
// three days apart, a daily cap per host, quiet hours queue for 9am, nothing near or after the start; the record shows on
// the overview and in Potto's answers; the maybes; and a browser walk at 390 (touch) and 1280.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { fakeOutbox, setUnsubscribed } from "../server/email.js";
import { fakeTexts } from "../server/sms.js";
import { cleanBody, compose, defaultBody, isNudgeAsk, isMaybeAsk, isWhoNudged, isRemindIn, nextMorning, LIMITS, nudgesPerDay } from "../server/pottonudge.js";
import { zonedMs, hourIn } from "../server/tz.js";

let srv, N;
const J = { "content-type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body || {}) });
const getJ = async (path, cookie) => (await fetch(srv.base + path, { headers: cookie ? { cookie } : {} })).json();
const put = (path, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
let n = 0;
const person = async (name) => { const email = `${name.toLowerCase().replace(/\W+/g, "")}${++n}@example.com`; const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); const b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); return { cookie: cookieOf(r), ws: b.workspace.id, email, name }; };
const host = async (name, handle) => { const h = await person(name); const r = await post("/api/host/profile", { handle, name, city: "New York", bio: "Dinners at home.", emoji: "🍵" }, h.cookie); assert.equal(r.status, 200, await r.text()); return { ...h, handle }; };
const guestRsvp = (ws, body, cookie) => fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, "x-encore-guest": "1", "x-encore-key": "k" + Math.random().toString(36).slice(2), "x-encore-workspace": ws, ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ createdAt: Date.now(), ...body }) });
const TZ = "America/New_York";
const nyDay = (k, base = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(base + k * 864e5));
const at = (dayIso, hhmm) => zonedMs(dayIso, hhmm, TZ); // a moment in New York
const hash = (s) => crypto.createHash("sha256").update(String(s).trim().toLowerCase()).digest("hex").slice(0, 24);
const ask = async (who, message, extra = {}) => { const r = await post("/api/potto/ask", { message, tz: TZ, ...extra }, who.cookie); const j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j)); return j; };
const mailTo = (email) => fakeOutbox.filter((m) => [m.to].flat().includes(email));
const event = (id, o, h) => put("events/" + id, { name: "Dumpling night", kind: "social", casual: true, date: nyDay(6), startTime: "19:00", city: "New York", hood: "Astoria", meetPoint: "Maya's place", published: true, headcount: 10, ...o }, h.cookie);
/** Put people on the invite plan and send them the invite through the app. */
async function invite(h, id, emails) { let r = await post(`/api/plan/${id}/add`, { emails }, h.cookie); assert.equal(r.status, 200, await r.text()); r = await post(`/api/plan/${id}/send`, {}, h.cookie); const j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j)); return j; }
const preview = (h, id, who = "noreply") => getJ(`/api/host/nudge/${id}?who=${who}`, h.cookie);
const send = async (h, id, body = {}) => { const r = await post(`/api/host/nudge/${id}/send`, { confirm: true, ...body }, h.cookie); return { status: r.status, ...(await r.json()) }; };
const NOON = () => at(nyDay(0), "12:00"); // today at noon in New York: out of quiet hours

let maya, sam, ana, blocker, off, other;
before(async () => {
  srv = await startServer();
  Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "nudge-secret", ENCORE_SIGNUP_PER_HOUR: "500", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_SMS: "1" });
  N = srv.app.locals.pottoNudge; N.setClock(NOON);
  maya = await host("Maya Okafor", "maya-nudge"); other = await host("Otto Other", "otto-nudge");
  sam = await person("Sam Diaz"); ana = await person("Ana Lima"); blocker = await person("Bea Block"); off = await person("Omar Off");
  // Dumpling night, in 6 days: seven people on the invite plan, sent through the app
  assert.equal((await event("dump1", { guests: [{ name: "Gil Listed", email: "gil.listed@example.com", status: "Invited" }, { name: "Nia Notsent", email: "nia.notsent@example.com", status: "Not invited" }] }, maya)).status, 200);
  const j = await invite(maya, "dump1", `Sam Diaz <${sam.email}>, Ana Lima <${ana.email}>, Lee Park <lee.park@example.com>, Uma Unsub <uma.unsub@example.com>, Bea Block <${blocker.email}>, Omar Off <${off.email}>, Rex Replied <rex.replied@example.com>`);
  assert.equal(j.sent, 7, JSON.stringify(j));
  // and two numbers texted the invite
  const t = await (await post("/api/host/text-invites", { eventId: "dump1", phones: "+14155550111\n+14155550122" }, maya.cookie)).json(); assert.equal(t.sent, 2, JSON.stringify(t));
  // Rex replied; Uma unsubscribed; one number replied STOP; Bea blocked Maya; Omar turned emails off
  assert.equal((await guestRsvp(maya.ws, { eventId: "dump1", name: "Rex Replied", email: "rex.replied@example.com", response: "no", code: "R1" })).status, 200);
  setUnsubscribed("uma.unsub@example.com");
  srv.store.set("system/smsstop-" + hash("+14155550122"), { phone: "+14155550122", at: Date.now() });
  assert.equal((await post("/api/me/blocks", { kind: "host", handle: "maya-nudge" }, blocker.cookie)).status, 200);
  assert.equal((await post("/api/me/prefs", { emails: false }, off.cookie)).status, 200);
  srv.app.locals.social.bust();
});
beforeEach(() => { resetLoginLimits(); N.setClock(NOON); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL", "ENCORE_FAKE_SMS", "ENCORE_NUDGES_PER_DAY"]) delete process.env[k]; await srv.close(); });

test("the words: what counts as a nudge ask, the host's line cleaned, the message", () => {
  for (const m of ["Nudge the people who haven't replied", "nudge them", "Can you chase everyone who hasn't replied to Dumpling night?", "Remind the people who have not RSVP'd", "text the ones who didn't answer", "ping the non-responders", "Yes, nudge them"]) assert.ok(isNudgeAsk(m), m);
  for (const m of ["Who hasn't replied?", "Who's going to dumpling night?", "Draft a reminder for Dumpling night", "What's on this weekend?"]) assert.ok(!isNudgeAsk(m), m);
  assert.ok(isMaybeAsk("Message the maybes")); assert.ok(isMaybeAsk("nudge everyone who said maybe")); assert.ok(!isMaybeAsk("Who said maybe?"));
  assert.ok(isWhoNudged("Who did I nudge?")); assert.ok(isWhoNudged("who have I nudged for dumpling night")); assert.ok(!isWhoNudged("nudge them"));
  assert.ok(isRemindIn("Remind everyone who's in")); assert.ok(isRemindIn("remind the guests who are going")); assert.ok(!isRemindIn("Remind the people who haven't replied"));
  assert.equal(cleanBody("Come!\u0007 See https://evil.example/x and www.spam.io or bit.ly/abc — ok <b>"), "Come! See and or ok b");
  assert.equal(cleanBody("x".repeat(900)).length, LIMITS.bodyMax);
  const ev = { name: "Dumpling night", date: "2026-12-05", startTime: "19:00" };
  assert.equal(compose({ name: "Sam", host: "Maya", body: defaultBody("noreply", ev), link: "https://x.test/l" }), "Hi Sam, Maya here. Are you in for Dumpling night on Sat, Dec 5 at 7pm? One tap to reply: https://x.test/l");
  assert.equal(hourIn(TZ, nextMorning(at("2026-12-01", "23:10"), TZ)), 9); assert.equal(nudgesPerDay(), 50);
});

test("who gets it: invited through the app and not replied; nobody who replied, unsubscribed, replied STOP, blocked or turned emails off", async () => {
  const p = await preview(maya, "dump1");
  assert.deepEqual(p.people.map((x) => [x.name, x.by]).sort(), [["Ana Lima", "by email"], ["Gil Listed", "by email"], ["Lee Park", "by email"], ["Number ending 0111", "by text"], ["Sam Diaz", "by email"]].sort());
  assert.equal(p.count, 5);
  assert.deepEqual(p.skipped.map((x) => [x.name, x.why]).sort(), [["Number ending 0122", "replied STOP to texts"], ["Omar Off", "emails are off"], ["Uma Unsub", "unsubscribed from emails"]].sort());
  const all = JSON.stringify(p);
  assert.ok(!/Bea|Block/.test(all), "someone who blocked the host is left out without a word");
  assert.ok(!/Rex/.test(all), "Rex replied"); assert.ok(!/Nia/.test(all), "Nia is on the list but was never invited");
  // names and a channel only: never an address or a full number in the list
  for (const secret of [ana.email, "lee.park@example.com", "gil.listed@example.com", "+14155550111", "4155550122"]) assert.ok(!JSON.stringify([p.people, p.skipped]).includes(secret), secret);
  assert.match(p.sample.text, /^Hi \w+, Maya here\. Are you in for Dumpling night on \w{3}, \w{3} \d+ at 7pm\? One tap to reply: http:\/\/127\.0\.0\.1:\d+\/\S+$/);
  assert.equal(p.gate, ""); assert.equal(p.linkOnly, false); assert.equal(p.quiet, null);
  // another host can't see or send this one
  assert.equal((await fetch(srv.base + "/api/host/nudge/dump1", { headers: { cookie: other.cookie } })).status, 404);
  assert.equal((await post("/api/host/nudge/dump1/send", { confirm: true }, other.cookie)).status, 404);
  assert.equal((await fetch(srv.base + "/api/host/nudge/dump1")).status, 401);
});

test("nothing goes without confirm; Send reaches each person on their own channel with their own link and a way out", async () => {
  const m0 = fakeOutbox.length, t0 = fakeTexts.length;
  let r = await post("/api/host/nudge/dump1/send", {}, maya.cookie); assert.equal(r.status, 400); assert.equal((await r.json()).code, "confirm_required");
  assert.equal(fakeOutbox.length, m0); assert.equal(fakeTexts.length, t0);
  const j = await send(maya, "dump1", { body: "Dumplings on Saturday, are you in? More at https://evil.example/x" });
  assert.equal(j.status, 200, JSON.stringify(j)); assert.equal(j.sent, 5); assert.equal(j.queued, 0);
  assert.match(j.report, /^Sent to 5\. I skipped /); assert.match(j.report, /Omar \(emails are off\)/); assert.match(j.report, /Uma \(unsubscribed from emails\)/); assert.ok(!/Bea/.test(j.report));
  const mails = fakeOutbox.slice(m0), texts = fakeTexts.slice(t0);
  assert.deepEqual(mails.map((m) => m.to[0]).sort(), [ana.email, "gil.listed@example.com", "lee.park@example.com", sam.email].sort());
  const s = mailTo(sam.email).pop();
  assert.equal(s.subject, "Are you in for Dumpling night?"); assert.match(s.from, /^Maya Okafor </);
  assert.match(s.text, /^Hi Sam, Maya here\. Dumplings on Saturday, are you in\? More at One tap to reply: http:\/\/127\.0\.0\.1:\d+\/api\/public\/inv\/[\w.-]+\n/);
  assert.ok(!s.text.includes("evil.example"), "the only link is the invite"); assert.match(s.text, /Unsubscribe: http\S+\/unsubscribe\?t=/); assert.ok(s.headers["List-Unsubscribe"]);
  const links = mails.map((m) => /One tap to reply: (\S+)/.exec(m.text)[1]); assert.equal(new Set(links).size, 4, "each person has their own link");
  // Sam's link is his: it opens the invite and marks it seen on the plan
  const go = await fetch(links[mails.findIndex((m) => m.to[0] === sam.email)], { redirect: "manual" }); assert.equal(go.status, 302); assert.equal(go.headers.get("location"), "/e/dump1");
  assert.match(/One tap to reply: (\S+)/.exec(mailTo("gil.listed@example.com").pop().text)[1], /\/#rsvp-dump1\.g0\.i-[\w-]+~[a-f0-9]+$/);
  assert.equal(texts.length, 1); assert.equal(texts[0].to, "+14155550111");
  assert.match(texts[0].text, /^Hi, Maya here\. Dumplings on Saturday.* One tap to reply: http\S+\/g#rsvp-dump1 Reply STOP to opt out\.$/);
  for (const never of ["uma.unsub@example.com", blocker.email, off.email, "rex.replied@example.com", "nia.notsent@example.com"]) assert.ok(!mails.some((m) => m.to.includes(never)), never);
});

test("the record: Nudged on the overview, in Potto's answer, and replies after a nudge show as replies", async () => {
  const wd = new Date(NOON()).toLocaleDateString("en-US", { weekday: "short", timeZone: TZ });
  let st = await getJ("/api/host/nudge/dump1/state", maya.cookie);
  assert.equal(st.nudged.length, 5); assert.ok(st.nudged.every((x) => x.label === "Nudged " + wd), JSON.stringify(st.nudged));
  assert.ok(st.nudged.find((x) => x.name === "Sam Diaz").keys.includes(sam.email), "the host's own list can match the row");
  assert.equal(st.can, 0, "no one can be nudged again today"); assert.equal(st.waiting, 8); assert.equal(st.suggest, null);
  // the invite plan shows it too (its own reminders count the nudge)
  const plan = await getJ("/api/plan/dump1", maya.cookie); assert.equal(plan.rows.find((r) => r.name.startsWith("Sam")).reminders, 1);
  let j = await ask(maya, "Who did I nudge?");
  assert.match(j.answer, new RegExp(`For Dumpling night you nudged .*Sam \\(${wd}\\)`)); assert.match(j.answer, /Ana/); assert.equal(j.actions.length, 0);
  // Sam replies after the nudge
  assert.equal((await guestRsvp(maya.ws, { eventId: "dump1", name: "Sam Diaz", email: sam.email, response: "going", code: "S1" }, sam.cookie)).status, 200); srv.app.locals.social.bust();
  j = await ask(maya, "who have I nudged for dumpling night?"); assert.match(j.answer, /Sam has replied since\./);
  st = await getJ("/api/host/nudge/dump1/state", maya.cookie); assert.equal(st.nudged.find((x) => x.name === "Sam Diaz").waiting, false); assert.equal(st.waiting, 7);
  const who = await ask(maya, "Who's going to Dumpling night?"); assert.match(who.answer, /Sam/);
  const no = await ask(maya, "Who hasn't replied to Dumpling night?"); assert.match(no.answer, /Ana/); assert.match(no.answer, /Lee/); assert.ok(!/Sam/.test(no.answer));
});

test("spacing and the limit: not again within 3 days, twice at most", async () => {
  const m0 = fakeOutbox.length;
  let j = await send(maya, "dump1"); assert.equal(j.sent, 0); assert.match(j.report, /^I didn't send anything\./); assert.match(j.report, /Ana \(nudged \w{3}, next from \w{3}\)/); assert.equal(fakeOutbox.length, m0);
  N.setClock(() => NOON() + 2 * 864e5); assert.equal((await preview(maya, "dump1")).count, 0, "two days on is still too soon");
  N.setClock(() => NOON() + 3 * 864e5 + 60e3);
  let p = await preview(maya, "dump1"); assert.deepEqual(p.people.map((x) => x.name).sort(), ["Ana Lima", "Gil Listed", "Lee Park", "Number ending 0111"]); assert.ok(p.people.every((x) => x.nudged === 1 && x.last));
  j = await send(maya, "dump1"); assert.equal(j.sent, 4); assert.match(j.report, /^Sent to 4\./);
  N.setClock(() => NOON() + 5.5 * 864e5); // well before the 7pm start on day 6
  p = await preview(maya, "dump1"); assert.equal(p.count, 0); assert.ok(p.skipped.some((x) => x.name === "Ana Lima" && x.why === "already nudged twice"));
  j = await send(maya, "dump1"); assert.equal(j.sent, 0); assert.equal(mailTo(ana.email).filter((m) => /^Are you in/.test(m.subject)).length, 2);
});

test("not near the start and not after it", async () => {
  await event("near1", { name: "Tea at four" }, maya); await invite(maya, "near1", "Kit Close <kit.close@example.com>, Jo Close <jo.close@example.com>");
  const start = at(nyDay(6), "19:00"), m0 = fakeOutbox.length;
  N.setClock(() => start - 2 * 3600e3 - 60e3); assert.equal((await preview(maya, "near1")).gate, "");
  N.setClock(() => start - 90 * 60e3);
  let p = await preview(maya, "near1"); assert.match(p.gate, /under 2 hours/);
  let j = await send(maya, "near1"); assert.equal(j.status, 409); assert.equal(j.code, "too_late");
  N.setClock(() => start + 60e3); p = await preview(maya, "near1"); assert.match(p.gate, /already started/); j = await send(maya, "near1"); assert.equal(j.status, 409);
  assert.equal(fakeOutbox.length, m0, "nothing went out");
  const a = await ask(maya, "Nudge the people who haven't replied to Tea at four"); assert.match(a.answer, /already started/); assert.equal(a.actions.length, 0);
});

test("quiet hours: after 9pm it waits for 9am, says so, and drops whoever replied overnight", async () => {
  await event("late1", { name: "Late soup" }, maya); await invite(maya, "late1", "Pia Late <pia.late@example.com>, Quin Late <quin.late@example.com>, Rob Late <rob.late@example.com>");
  const night = at(nyDay(1), "22:30"), m0 = fakeOutbox.length; N.setClock(() => night);
  const p = await preview(maya, "late1"); assert.deepEqual(p.quiet, { at: "9am" });
  const j = await send(maya, "late1"); assert.equal(j.sent, 0); assert.equal(j.queued, 3); assert.match(j.report, /^It's after 9pm where your guests are, so 3 nudges go out at 9am\.$/);
  assert.equal(fakeOutbox.length, m0, "nothing is sent at night"); assert.equal(hourIn(TZ, j.queuedFor), 9);
  let st = await getJ("/api/host/nudge/late1/state", maya.cookie); assert.ok(st.nudged.every((x) => x.label === "Nudge goes at 9am"));
  assert.equal((await send(maya, "late1")).queued, 0, "asking twice doesn't queue twice");
  assert.equal((await N.runDue(night + 3600e3)).sent, 0, "still night");
  // Quin replies before the morning
  assert.equal((await guestRsvp(maya.ws, { eventId: "late1", name: "Quin Late", email: "quin.late@example.com", response: "maybe", code: "Q1" })).status, 200);
  const morning = at(nyDay(2), "09:02"); N.setClock(() => morning);
  assert.equal((await N.runDue(morning)).sent, 2);
  assert.deepEqual(fakeOutbox.slice(m0).map((m) => m.to[0]).sort(), ["pia.late@example.com", "rob.late@example.com"]);
  assert.equal((await N.runDue(morning + 60e3)).sent, 0, "once");
  st = await getJ("/api/host/nudge/late1/state", maya.cookie); assert.equal(st.nudged.filter((x) => /^Nudged /.test(x.label)).length, 2);
});

test("the per-host daily cap", async () => {
  process.env.ENCORE_NUDGES_PER_DAY = "2"; const cy = await host("Cy Cap", "cy-cap");
  await event("cap1", { name: "Cap supper" }, cy); await invite(cy, "cap1", "A One <a.one@example.com>, B Two <b.two@example.com>, C Three <c.three@example.com>");
  let j = await send(cy, "cap1"); assert.equal(j.sent, 2); assert.equal(j.held, 1); assert.match(j.report, /Sent to \w+ and \w+\. You've reached today's limit of 2 nudges, so \w+ is still waiting\. Ask me again tomorrow\./);
  j = await send(cy, "cap1"); assert.equal(j.sent, 0); assert.equal(j.held, 1);
  N.setClock(() => NOON() + 864e5); j = await send(cy, "cap1"); assert.equal(j.sent, 1, "the next day the last one goes");
  delete process.env.ENCORE_NUDGES_PER_DAY;
});

test("a link-only event: Potto says so, gives a message to paste, and sends nothing", async () => {
  const li = await host("Lin Link", "lin-link"); await event("link1", { name: "Link picnic" }, li);
  assert.equal((await guestRsvp(li.ws, { eventId: "link1", name: "Kai In", email: "kai.in@example.com", response: "going", code: "K1" })).status, 200); srv.app.locals.social.bust();
  const m0 = fakeOutbox.length, t0 = fakeTexts.length;
  const p = await preview(li, "link1"); assert.equal(p.linkOnly, true); assert.equal(p.count, 0); assert.equal(p.people.length, 0);
  assert.match(p.paste.text, /^Hi all, Lin here\. Are you in for Link picnic on .+\? One tap to reply: http\S+\/e\/link1$/); assert.deepEqual(p.paste.chat, { going: 1, url: "/api/chats/link1/messages" });
  const a = await ask(li, "Nudge the people who haven't replied");
  assert.match(a.answer, /^You shared Link picnic as a link, so I can't see who has it and I can't message them myself\./); assert.match(a.answer, /One tap to reply: http\S+\/e\/link1/);
  assert.deepEqual(a.actions.map((x) => [x.type, x.eventId, x.who]), [["nudge", "link1", "noreply"]]);
  const j = await send(li, "link1"); assert.equal(j.sent, 0); assert.match(j.report, /There was no one to nudge\./);
  assert.equal(fakeOutbox.length, m0); assert.equal(fakeTexts.length, t0);
  assert.equal((await getJ("/api/host/nudge/link1/state", li.cookie)).suggest, null);
});

test("Ask Potto: the nudge is an action to confirm, never a send; remind everyone who's in goes to the reminder", async () => {
  const zo = await host("Zoe Ask", "zoe-ask"); await event("ask1", { name: "Noodle club" }, zo);
  await invite(zo, "ask1", "Ivy Ask <ivy.ask@example.com>, Jon Ask <jon.ask@example.com>");
  assert.equal((await guestRsvp(zo.ws, { eventId: "ask1", name: "Mo May", email: "mo.may@example.com", response: "maybe", code: "M1" })).status, 200);
  assert.equal((await guestRsvp(zo.ws, { eventId: "ask1", name: "Gus Going", email: "gus.going@example.com", response: "going", code: "G1" })).status, 200); srv.app.locals.social.bust();
  const m0 = fakeOutbox.length;
  for (const q of ["Nudge the people who haven't replied", "Can you chase the ones who haven't replied to Noodle club?", "nudge them"]) {
    const a = await ask(zo, q); assert.equal(a.mode, "rules");
    assert.match(a.answer, /^I can nudge 2 people about Noodle club: Ivy by email and Jon by email\. Here's the message\. Nothing goes out until you tap Send\.$/, q);
    assert.deepEqual(a.actions, [{ id: "nudge-noreply-ask1", type: "nudge", eventId: "ask1", who: "noreply", label: "Check and send" }]); }
  assert.equal(fakeOutbox.length, m0, "asking sends nothing");
  // the maybes: the same sheet, the Maybe replies
  const mb = await ask(zo, "Message the maybes"); assert.match(mb.answer, /^1 person said Maybe to Noodle club: Mo by email\./); assert.deepEqual(mb.actions.map((x) => x.who), ["maybe"]);
  const pm = await preview(zo, "ask1", "maybe"); assert.deepEqual(pm.people.map((x) => x.name), ["Mo May"]); assert.match(pm.sample.text, /^Hi Mo, Zoe here\. Still a maybe for Noodle club on .+\? A yes or a no both help me plan\. One tap to reply: /);
  const sm = await send(zo, "ask1", { who: "maybe" }); assert.equal(sm.sent, 1); assert.equal(sm.report, "Sent to Mo.");
  const mm = mailTo("mo.may@example.com").pop(); assert.equal(mm.subject, "Still a maybe for Noodle club?"); assert.match(mm.text, /Unsubscribe: /);
  assert.equal(mailTo("ivy.ask@example.com").filter((m) => /maybe/.test(m.subject)).length, 0, "only the maybes");
  // remind everyone who's in: the reminder that already exists (the group chat, on Send)
  const rm = await ask(zo, "Remind everyone who's in");
  assert.match(rm.answer, /Here's a reminder for Noodle club\. It goes to the 1 guest in the group chat once you tap Send\./); assert.match(rm.answer, /my reminder the day before/);
  assert.deepEqual(rm.actions.map((x) => [x.type, x.url]), [["remind", "/api/chats/ask1/messages"]]);
  // a guest asking gets no nudge powers
  const g = await ask(sam, "Nudge the people who haven't replied"); assert.equal((g.actions || []).length, 0); assert.match(g.answer, /no upcoming events/);
});

test("the proactive line: 48 hours after the invite or 72 before the event, two or more to nudge, quiet for 3 days after a nudge or a dismiss", async () => {
  const pa = await host("Pat Proactive", "pat-pro");
  await event("pro1", { name: "Hot pot", date: nyDay(10) }, pa);
  await invite(pa, "pro1", "Ed One <ed.one@example.com>, Flo Two <flo.two@example.com>, Hal Three <hal.three@example.com>");
  const t0 = Date.now(), noon3 = at(nyDay(3), "12:00"); N.setClock(() => t0 + 60e3); // the invite plan stamps the real time; noon3 is noon in New York three days on (48 to 84 hours from now)
  const top = async () => (await getJ("/api/host/nudge/suggest", pa.cookie)).suggest;
  assert.equal(await top(), null, "too soon after the invite");
  N.setClock(() => t0 + 47 * 3600e3); assert.equal(await top(), null);
  N.setClock(() => t0 + 49 * 3600e3);
  assert.deepEqual(await top(), { eventId: "pro1", title: "Hot pot", n: 3, can: 3, line: "3 people haven't replied to Hot pot. Want me to nudge them?" });
  assert.equal((await getJ("/api/host/nudge/pro1/state", pa.cookie)).suggest.n, 3);
  // only one to nudge: no line
  for (const [nm, em] of [["Ed One", "ed.one@example.com"], ["Flo Two", "flo.two@example.com"]]) assert.equal((await guestRsvp(pa.ws, { eventId: "pro1", name: nm, email: em, response: "going", code: "X" + nm.length })).status, 200);
  assert.equal(await top(), null);
  // a second event, invited a moment ago, but its start (7pm in 4 days) is under 72 hours from this clock (noon in 2 days, plus an hour)
  await event("pro2", { name: "Quick ramen", date: nyDay(4), guests: [{ name: "Vi List", email: "vi.list@example.com", status: "Invited", invitedAt: t0 + 49 * 3600e3 - 60e3 }, { name: "Wes List", email: "wes.list@example.com", status: "Invited", invitedAt: t0 + 49 * 3600e3 - 60e3 }] }, pa);
  let s = await top(); assert.equal(s?.eventId, "pro2", JSON.stringify(s)); assert.equal(s.line, "2 people haven't replied to Quick ramen. Want me to nudge them?");
  // dismissed: gone for 3 days
  assert.equal((await post("/api/host/nudge/pro2/dismiss", {}, pa.cookie)).status, 200); assert.equal(await top(), null);
  // after a nudge: quiet too
  await event("pro3", { name: "Slow stew", date: nyDay(12) }, pa); await invite(pa, "pro3", "Yan A <yan.a@example.com>, Zed B <zed.b@example.com>");
  N.setClock(() => noon3); assert.equal((await top())?.eventId, "pro3");
  assert.equal((await send(pa, "pro3")).sent, 2); assert.equal(await top(), null);
  N.setClock(() => noon3 + 3 * 864e5 + 60e3); assert.equal((await top())?.eventId, "pro3", "three days on it may ask again");
});

// ---------- the browser walk ----------
let chromium = null, browser = null;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch {}
const SHOTS = process.env.NUDGE_SHOTS || ""; // a folder for viewport screenshots, when set
async function walk(t, width, touch) {
  if (!chromium) return t.skip("playwright isn't installed");
  browser = browser || (await chromium.launch());
  const tag = `w${width}`, id = "walk" + width, wd = () => new Date(N_now()).toLocaleDateString("en-US", { weekday: "short", timeZone: TZ });
  let now = NOON(); const N_now = () => now; N.setClock(N_now);
  const h = await host("Wren Walker", "wren-" + tag);
  assert.equal((await event(id, { name: "Dumpling night", guests: [{ name: "Gil Listed", email: `gil.${tag}@example.com`, status: "Invited", invitedAt: now }] }, h)).status, 200);
  await invite(h, id, `Sam Diaz <sam.${tag}@example.com>, Ana Lima <ana.${tag}@example.com>, Uma Unsub <uma.${tag}@example.com>`); setUnsubscribed(`uma.${tag}@example.com`);
  assert.equal((await guestRsvp(h.ws, { eventId: id, name: "Ines In", email: `ines.${tag}@example.com`, response: "going", code: "I1" })).status, 200); srv.app.locals.social.bust();
  now = at(nyDay(3), "12:00"); // noon three days on (the invite plan stamps the real time): time for Potto's line, and out of quiet hours
  const ctx = await browser.newContext({ viewport: { width, height: touch ? 844 : 800 }, hasTouch: touch, isMobile: touch, timezoneId: TZ });
  const [k, ...v] = h.cookie.split("="); await ctx.addCookies([{ name: k, value: v.join("="), url: srv.base }, { name: "encore_in", value: "1", url: srv.base }]);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, body: "" }));
  const page = await ctx.newPage(), errs = [];
  page.on("pageerror", (e) => errs.push("pageerror " + e.message)); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push("console " + m.text()); });
  page.on("requestfailed", (r) => { if (r.url().startsWith(srv.base) && !/ERR_ABORTED/.test(r.failure()?.errorText || "")) errs.push("failed " + r.url()); });
  page.on("response", (r) => { if (r.url().startsWith(srv.base) && r.status() >= 400) errs.push(`${r.status()} ${r.url()}`); });
  const shot = async (name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await page.waitForTimeout(250); await page.screenshot({ path: `${SHOTS}/${tag}-${name}.png` }); };
  // an element the person can really tap: on screen, at least 44px tall, and nothing (tab bar, dock) on top of it
  const tappable = async (sel) => { const el = page.locator(sel).first(); for (let i = 0; i < 4; i++) { try { await el.scrollIntoViewIfNeeded({ timeout: 5000 }); break; } catch (e) { if (i === 3) throw e; } } const r = await el.evaluate((n) => { const b = n.getBoundingClientRect(), top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { h: b.height, w: b.width, hit: !!top && (top === n || n.contains(top)), inView: b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth, cut: n.scrollWidth > n.clientWidth + 1 }; }); assert.ok(r.h >= 44 && r.hit && r.inView && !r.cut, `${sel} ${JSON.stringify(r)}`); return el; };
  const noSideScroll = async (what) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${what}: the page scrolls sideways`);
  const fontOf = (sel) => page.locator(sel).first().evaluate((n) => { const c = getComputedStyle(n); return `${c.fontFamily.split(",")[0].replace(/"/g, "")} ${c.fontSize} ${c.fontWeight}`; });
  try {
    // 1. Home: one line from Potto, and nothing opens by itself
    await page.goto(srv.base + "/?app=1"); const home = page.locator("#pnHome"); await home.waitFor({ timeout: 20000 });
    assert.equal((await home.locator("p").first().innerText()).trim(), "4 people haven't replied to Dumpling night. Want me to nudge them?");
    assert.equal(await page.locator("#pnHome").count(), 1); assert.equal(await page.locator("#pnSheet,#ptSheet").count(), 0, "nothing opens by itself");
    assert.equal(await fontOf("#pnHome p"), "IBM Plex Sans 16px 400");
    await tappable("#pnHome [data-pn-open]"); await tappable("#pnHome [data-pn-no]"); await noSideScroll("home"); await shot("1-home-line");
    // 2. the overview: the same line, and "3 haven't replied" with "Nudge 3 people" in Who's coming
    await page.goto(srv.base + `/?app=1&open=${id}#studio`); await page.locator("#hv .pn-hvrow").waitFor({ timeout: 20000 });
    assert.equal((await page.locator("#hv .pn-line p").first().innerText()).trim(), "4 people haven't replied to Dumpling night. Want me to nudge them?");
    assert.equal(await page.locator("#hv .pn-line, #hv .hv-potto").count(), 1, "one line from Potto at a time");
    assert.match(await page.locator("#hv .pn-hvrow p").innerText(), /^4 haven't replied/); assert.equal(await fontOf("#hv .pn-hvrow p"), "IBM Plex Sans 16px 500");
    const nb = await tappable("#hv .pn-hvrow [data-pn-open]"); assert.equal((await nb.innerText()).trim(), "Nudge 3 people"); await shot("2-overview-row");
    // the button opens the confirm sheet: who, by which channel, the exact message; Esc closes and focus goes back
    await nb.click(); const sheet = page.locator("#pnSheet [role=dialog]"); await sheet.locator(".pn-who li").first().waitFor();
    assert.equal(await sheet.getAttribute("aria-modal"), "true"); assert.equal((await sheet.locator("h2").innerText()).trim(), "Nudge the people who haven't replied");
    assert.deepEqual((await sheet.locator(".pn-who li").allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim()).sort(), ["Ana Lima by email", "Gil Listed by email", "Sam Diaz by email"]);
    assert.match(await sheet.locator(".pn-skip").innerText(), /Not getting it: Uma Unsub \(unsubscribed from emails\)\./);
    const txt = (await sheet.locator(".pn-text").innerText()).replace(/\s+/g, " ").trim(); assert.match(txt, /^Hi \w+, Wren here\. Are you in for Dumpling night on \w{3}, \w{3} \d+ at 7pm\? One tap to reply: http\S+$/);
    assert.ok(!/@example\.com/.test(await sheet.innerText()), "no addresses in the sheet");
    assert.equal(await fontOf("#pnSheet .pn-text"), "IBM Plex Sans 16px 400"); assert.equal(await fontOf("#pnSheet .pn-who .pn-n"), "IBM Plex Sans 16px 500"); assert.equal(await fontOf("#pnSheet h2"), "IBM Plex Sans 20px 600");
    assert.equal(await sheet.locator(".pn-b.pri").count(), 1, "one primary"); for (const s of ["#pnSheet [data-send]", "#pnSheet [data-edit]", "#pnSheet [data-no]", "#pnSheet .pn-x"]) await tappable(s);
    assert.ok(await sheet.locator(".pn-text").evaluate((n) => n.scrollWidth <= n.clientWidth + 1), "the message wraps, never cut"); await noSideScroll("sheet"); await shot("3-confirm-sheet");
    await page.keyboard.press("Escape"); await page.locator("#pnSheet").waitFor({ state: "detached" });
    assert.ok(await page.evaluate(() => document.activeElement?.matches?.("[data-pn-open]")), "focus returns to the button"); assert.equal(fakeOutbox.filter((m) => m.to[0].endsWith(`.${tag}@example.com`) && /^Are you in/.test(m.subject)).length, 0, "looking sends nothing");
    // the line dismisses, here and on Home
    await (await tappable("#hv .pn-line [data-pn-no]")).click(); await page.locator("#hv .pn-line").waitFor({ state: "detached" }); await page.locator("#hv .hv-potto").waitFor();
    assert.equal((await getJ("/api/host/nudge/suggest", h.cookie)).suggest, null);
    await page.goto(srv.base + "/?app=1"); await page.locator("#ptDock [data-pt=ask]").waitFor({ timeout: 20000 }); await page.waitForTimeout(1200); assert.equal(await page.locator("#pnHome").count(), 0, "dismissed");
    // 3. Ask Potto: the answer names who gets it, the card shows the message; Edit, then Send
    await page.locator("#ptDock [data-pt=ask]").click(); const ta = page.locator("#ptSheet textarea[aria-label='Ask Potto']"); await ta.waitFor(); await ta.fill("Nudge the people who haven't replied"); await ta.press("Enter");
    const card = page.locator("#ptSheet [data-nk]"); await card.locator(".pn-who li").first().waitFor({ timeout: 20000 });
    assert.match(await page.locator("#ptSheet .pt-po").last().innerText(), /^I can nudge 3 people about Dumpling night: .* I'd skip Uma \(unsubscribed from emails\)\. Here's the message\. Nothing goes out until you tap Send\.$/);
    assert.deepEqual((await card.locator(".pn-btns button").allInnerTexts()).map((x) => x.trim()), ["Send to 3", "Edit", "Not now"]); await shot("4-potto-card");
    await (await tappable("#ptSheet [data-nk] [data-edit]")).click(); const body = card.locator("textarea"); await body.waitFor();
    assert.ok(await body.evaluate((n) => document.activeElement === n && !!n.labels?.length), "the editor is focused and labelled");
    await body.fill("Dumplings on Saturday, are you in? See https://evil.example/x");
    assert.match((await card.locator(".pn-text").innerText()).replace(/\s+/g, " "), /Wren here\. Dumplings on Saturday, are you in\? See One tap to reply: /, "the preview is what goes out: the pasted link is left out");
    await tappable("#ptSheet [data-nk] [data-send]"); await shot("5-potto-edit");
    await card.locator("[data-send]").click(); await card.locator(".pn-done").waitFor();
    assert.equal((await card.locator(".pn-done").innerText()).trim(), "Sent to Ana, Gil and Sam. I skipped Uma (unsubscribed from emails).");
    const sent = fakeOutbox.filter((m) => m.to[0].endsWith(`.${tag}@example.com`) && /^Are you in/.test(m.subject)); assert.deepEqual(sent.map((m) => m.to[0]).sort(), [`ana.${tag}@example.com`, `gil.${tag}@example.com`, `sam.${tag}@example.com`]);
    assert.ok(sent.every((m) => /Dumplings on Saturday, are you in\? See One tap to reply: http/.test(m.text) && !m.text.includes("evil.example") && /Unsubscribe: /.test(m.text)), "the edited line, no other link, the unsubscribe footer"); await shot("6-potto-sent");
    // asking again: Potto says what's true
    await ta.fill("Who did I nudge?"); await ta.press("Enter"); await page.locator("#ptSheet .pt-po", { hasText: "you nudged" }).waitFor({ timeout: 20000 });
    assert.match(await page.locator("#ptSheet .pt-po").last().innerText(), new RegExp(`^For Dumpling night you nudged .*Sam \\(${wd()}\\)`));
    assert.equal((await card.locator(".pn-done").innerText()).trim(), "Sent to Ana, Gil and Sam. I skipped Uma (unsubscribed from emails).", "the sent card stays sent");
    // 4. the overview: "Nudged <day>" beside the person, and no button while no one can be nudged again
    await page.goto(srv.base + `/?app=1&open=${id}&step=6#studio`); const row = page.locator("#hv .hv-g", { hasText: "Gil Listed" }); await row.waitFor({ timeout: 20000 });
    await page.locator("#hv .hv-g small", { hasText: "Nudged " + wd() }).waitFor({ timeout: 20000 }); assert.match(await row.innerText(), new RegExp("Nudged " + wd())); await row.scrollIntoViewIfNeeded(); await noSideScroll("guests"); await shot("7-guests-nudged");
    await page.locator("#hv [data-tab=overview]").click(); await page.locator("#hv .pn-hvrow").waitFor();
    assert.match((await page.locator("#hv .pn-hvrow").innerText()).replace(/\s+/g, " "), /^4 haven't replied No one to nudge right now\. Each person gets two at most, three days apart\.$/); assert.equal(await page.locator("#hv .pn-hvrow button").count(), 0);
    await page.locator("#hv .pn-hvrow").scrollIntoViewIfNeeded(); await shot("8-overview-after");
    assert.deepEqual(errs, [], "console clean, no failed requests");
  } finally { await ctx.close(); N.setClock(NOON); }
}
test("browser, 390 touch: Home line, the overview row and sheet, dismiss, Ask Potto, edit, send, Nudged on the overview", { timeout: 200000 }, (t) => walk(t, 390, true));
test("browser, 1280: the same walk", { timeout: 200000 }, (t) => walk(t, 1280, false));
test("browser, 390 touch: a link-only event gets a message to copy or share, and the group chat on a second tap", { timeout: 120000 }, async (t) => {
  if (!chromium) return t.skip("playwright isn't installed"); browser = browser || (await chromium.launch());
  const h = await host("Lin Linkwalk", "lin-linkwalk"); await event("linkw", { name: "Link picnic" }, h);
  assert.equal((await guestRsvp(h.ws, { eventId: "linkw", name: "Kai In", email: "kai.linkw@example.com", response: "going", code: "K1" })).status, 200); srv.app.locals.social.bust();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, timezoneId: TZ, permissions: ["clipboard-read", "clipboard-write"] });
  const [k, ...v] = h.cookie.split("="); await ctx.addCookies([{ name: k, value: v.join("="), url: srv.base }, { name: "encore_in", value: "1", url: srv.base }]);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, body: "" }));
  const page = await ctx.newPage(), errs = []; page.on("pageerror", (e) => errs.push("pageerror " + e.message)); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push("console " + m.text()); });
  page.on("response", (r) => { if (r.url().startsWith(srv.base) && r.status() >= 400) errs.push(`${r.status()} ${r.url()}`); });
  try { const m0 = fakeOutbox.length;
    await page.goto(srv.base + "/?app=1"); await page.locator("#ptDock [data-pt=ask]").click(); const ta = page.locator("#ptSheet textarea[aria-label='Ask Potto']"); await ta.waitFor(); await ta.fill("Nudge the people who haven't replied"); await ta.press("Enter");
    const card = page.locator("#ptSheet [data-nk]"); await card.locator("[data-copy]").waitFor({ timeout: 20000 });
    assert.match(await page.locator("#ptSheet .pt-po").last().innerText(), /^You shared Link picnic as a link, so I can't see who has it and I can't message them myself\./); assert.equal(await card.locator(".pn-lead").count(), 0, "said once");
    const msg = (await card.locator(".pn-text").innerText()).trim(); assert.match(msg, /^Hi all, Lin here\. Are you in for Link picnic on .+\? One tap to reply: http\S+\/e\/linkw$/);
    assert.equal(await card.locator(".pn-b.pri").count(), 1); assert.ok((await card.locator(".pn-btns button").allInnerTexts()).map((x) => x.trim()).includes("Post to the group chat"));
    for (const b of await card.locator(".pn-btns button").all()) assert.ok((await b.boundingBox()).height >= 44);
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.waitForTimeout(250); await page.screenshot({ path: `${SHOTS}/w390-9-link-only.png` }); }
    await card.locator("[data-copy]").click(); await page.locator("#ptSheet [data-said]", { hasText: "Copied" }).waitFor(); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), msg);
    // the group chat is a send, so it asks first
    await card.locator("[data-chat]").click(); assert.match(await card.locator(".pn-quiet").innerText(), /^Post this to the 1 guest in the group chat\?$/); await card.locator("[data-back]").click(); await card.locator("[data-chat]").click(); await card.locator("[data-post]").click();
    await card.locator(".pn-done").waitFor(); assert.equal((await card.locator(".pn-done").innerText()).trim(), "Posted to the group chat for the 1 guest already in. I didn't message anyone else.");
    assert.equal(fakeOutbox.length, m0, "no emails"); assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});
after(async () => { await browser?.close(); });
