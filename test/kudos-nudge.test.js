// Kudos nudges (server/kudosnudge.js): the group kudos link, per-guest links, "Send for me" caps, the automatic reminder
// and the host's progress counts.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { fakeTexts } from "../server/sms.js";
import { fakeOutbox } from "../server/email.js";
import { scopeStore } from "../server/workspaces.js";
import { qrMatrix } from "../server/qr.js";

let srv, host, other, ws;
const DAYMS = 864e5;
const J = { "Content-Type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const put = (path, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const getJ = async (path, cookie) => { const r = await fetch(srv.base + path, { headers: cookie ? { cookie } : {} }); return { status: r.status, j: await r.json().catch(() => null) }; };
const day = (n) => new Date(Date.now() + n * DAYMS).toISOString().slice(0, 10);
const morning = Date.parse(day(0) + "T15:00:00Z"); // the morning after (events are in UTC), 3pm
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "kudos-nudge-secret", ENCORE_SIGNUP_PER_HOUR: "100", ENCORE_FAKE_SMS: "1", ENCORE_FAKE_EMAIL: "1", ENCORE_DIRECTORY_CACHE_MS: "0", ENCORE_KUDOS_GROUP_PER_IP: "1000", ENCORE_KUDOS_GROUP_PER_EVENT: "1000" };
const S = () => scopeStore(srv.store, ws);
const R = {}; // reply ids by guest
const sheet = async (id, cookie = host) => (await getJ("/api/host/kudos-nudge/" + id, cookie)).j;
const group = (id, contact, g) => post("/api/public/kudos-group/" + id, { g, contact });
const tokenOf = (s) => new URL(s.group.link).searchParams.get("g");

async function signup(name, email, handle) {
  const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); const cookie = r.headers.get("set-cookie").split(";")[0];
  if (handle) assert.ok((await post("/api/host/profile", { handle, name, tagline: "Small dinners for new friends.", city: "Brooklyn", hood: "Bed-Stuy", emoji: "🍜" }, cookie)).ok);
  return cookie;
}
const add = async (eventId, body, key) => { const id = (await (await post("/api/db/collection?path=rsvps", { eventId, code: "C" + Math.random().toString(36).slice(2, 7).toUpperCase(), createdAt: Date.now(), ...body }, host)).json()).id; if (key) R[key] = id; return id; };
const kudos = (eventId, rid, tags = ["food"]) => post("/api/public/kudos", { eventId, rid, code: S().get("rsvps/" + rid).data.code, tags });

before(async () => {
  Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer();
  host = await signup("Rae Potter", "rae.nudge@example.com", "rae-nudge");
  other = await signup("Lou Baker", "lou.nudge@example.com", "lou-nudge");
  ws = srv.store.get("system/handle-rae-nudge").data.ws;
  const base = { casual: true, date: day(-1), startTime: "18:00", endTime: "21:00", tz: "UTC", published: true, city: "Brooklyn", activity: "dinner" };
  for (const [id, name, extra] of [["nzProg", "Taco night"], ["nzGroup", "Dumpling night"], ["nzRate", "Soup night"], ["nzRate2", "Pie night"], ["nzSend", "Pasta night"], ["nzAuto", "Curry night"], ["nzOff", "Quiet supper"], ["nzSoon", "Next week", { date: day(6) }]])
    assert.ok((await put("events/" + id, { ...base, name, ...(extra || {}) }, host)).ok);
});
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

test("Progress: M of N guests who were in left kudos, with first names; no-shows, maybes and repeat replies don't count twice", async () => {
  const a = await add("nzProg", { name: "Ana Diaz", email: "ana.p@guest.example.com", response: "going" });
  const b = await add("nzProg", { name: "Bo Chen", phone: "+14155550302", response: "going" });
  await add("nzProg", { name: "Cy Park", email: "cy.p@guest.example.com", response: "going" });
  await add("nzProg", { name: "Di Lopez", email: "di.p@guest.example.com", response: "going", noShow: true });
  const maybe = await add("nzProg", { name: "Ed Moss", email: "ed.p@guest.example.com", response: "maybe" });
  await add("nzProg", { name: "Cy Park", email: "cy.p@guest.example.com", response: "going", createdAt: Date.now() + 1 }); // Cy replied twice
  let s = await sheet("nzProg");
  assert.deepEqual([s.progress.guests, s.progress.kudos, s.progress.pct], [3, 0, 0]);
  assert.equal(s.potto, true, "Potto's list asks: under 60%, over and within 14 days");
  assert.equal((await kudos("nzProg", a)).status, 200); assert.equal((await kudos("nzProg", maybe)).status, 200);
  s = await sheet("nzProg"); assert.deepEqual([s.progress.guests, s.progress.kudos], [3, 1], "a Maybe's kudos doesn't count toward guests who were in");
  assert.deepEqual(s.progress.givers, [{ first: "Ana" }]);
  assert.deepEqual(s.guests.map((g) => g.first).sort(), ["Bo", "Cy"], "the list is who hasn't left kudos, once each");
  assert.equal((await kudos("nzProg", b)).status, 200);
  s = await sheet("nzProg"); assert.deepEqual([s.progress.kudos, s.progress.pct], [2, 67]); assert.equal(s.potto, false, "at 60% or more, Potto stops asking");
  // the existing "Kudos asked of N" count ignores nudges
  assert.deepEqual((await getJ("/api/host/kudos/nzProg", host)).j.ask, { asked: 0, sent: 3 });
  // not over yet: nothing to nudge; and it's the host's own
  const soon = await sheet("nzSoon"); assert.equal(soon.ended, false); assert.equal(soon.potto, false);
  assert.equal((await getJ("/api/host/kudos-nudge/nzProg")).status, 403, "signed out");
  assert.equal((await getJ("/api/host/kudos-nudge/nzProg", other)).status, 404, "another host's event");
});

test("Per-guest links: each guest who hasn't left kudos gets their own working link (a code is made if missing); tapping marks them nudged", async () => {
  const nc = await add("nzProg", { name: "Fy Grant", phone: "+14155550306", response: "going", code: "" });
  const s = await sheet("nzProg"), fy = s.guests.find((g) => g.rid === nc);
  assert.ok(fy, "Fy is listed"); const u = new URL(fy.link);
  assert.equal(u.pathname, "/k/nzProg"); assert.equal(u.searchParams.get("rid"), nc); assert.ok(u.searchParams.get("code"));
  assert.equal(S().get("rsvps/" + nc).data.code, u.searchParams.get("code"), "the new code is saved on the reply, like the morning-after ask");
  const page = await getJ(`/api/public/kudos-page/nzProg?rid=${nc}&code=${u.searchParams.get("code")}`); assert.equal(page.status, 200); assert.equal(page.j.title, "Taco night");
  assert.equal(fy.nudgedAt, null);
  const m = await post("/api/host/kudos-nudge/nzProg/nudged", { rid: nc, via: "text" }, host); assert.equal(m.status, 200);
  const again = (await sheet("nzProg")).guests.find((g) => g.rid === nc); assert.ok(again.nudgedAt > 0); assert.equal(again.nudgedVia, "text");
  assert.equal((await post("/api/host/kudos-nudge/nzProg/nudged", { rid: "nope", via: "text" }, host)).status, 404);
  assert.equal((await post("/api/host/kudos-nudge/nzProg/nudged", { rid: nc, via: "text" })).status, 403, "only the host");
  // the group message, word for word, and a QR code of the group link
  assert.equal(s.group.message, `Thank you for coming to Taco night. If you have 10 seconds, tap a few words about it: ${s.group.link}`);
  assert.match(s.group.link, /\/k\/nzProg\?g=[A-Za-z0-9]{16,}$/);
  const qr = await fetch(srv.base + "/api/host/kudos-nudge/nzProg/qr.svg", { headers: { cookie: host } }); assert.equal(qr.status, 200); assert.match(qr.headers.get("content-type"), /svg/); assert.match(await qr.text(), /^<svg /);
  assert.equal(qrMatrix(s.group.link).length % 4, 1, "a QR code is 17 + 4 x version modules wide");
});

test("Group kudos link: the email or phone you replied with opens kudos; anything else gets the same message", async () => {
  const ana = await add("nzGroup", { name: "Ana Diaz", email: "Ana.G@guest.example.com", response: "going" }, "gAna");
  await add("nzGroup", { name: "Bo Chen", phone: "(415) 555-0402", response: "going" }, "gBo");
  await add("nzGroup", { name: "Cy Park", email: "cy.g@guest.example.com", response: "going", noShow: true }, "gCy");
  await add("nzGroup", { name: "Di Lopez", email: "di.g@guest.example.com", response: "maybe" }, "gDi");
  const s = await sheet("nzGroup"), g = tokenOf(s);
  // the page loads with the token, and not without
  const info = await getJ(`/api/public/kudos-group/nzGroup?g=${g}`); assert.equal(info.status, 200); assert.equal(info.j.title, "Dumpling night"); assert.equal(info.j.hostFirst, "Rae"); assert.equal(info.j.open, true);
  assert.ok(!JSON.stringify(info.j).includes("guest.example.com"), "never lists guests");
  assert.equal((await getJ(`/api/public/kudos-group/nzGroup?g=WRONG${g.slice(5)}`)).status, 403);
  assert.equal((await getJ(`/api/public/kudos-group/nzProg?g=${g}`)).status, 403, "one event's token doesn't open another");
  const page = await fetch(srv.base + `/k/nzGroup?g=${g}`); assert.equal(page.status, 200); assert.equal(page.headers.get("referrer-policy"), "no-referrer");
  // match or not, the same answer: a stranger, a no-show, a Maybe, a near miss and a real guest all read the same,
  // and none of them gets a code back (email and texting are set up here, so the link goes to the guest instead)
  const answers = [];
  for (const contact of ["nobody@example.com", "cy.g@guest.example.com", "di.g@guest.example.com", "ana.g@guest.example.co", "4155550499", "  ANA.G@guest.example.com ", "+1 415-555-0402"]) {
    const t0 = Date.now(), r = await group("nzGroup", contact, g); answers.push({ status: r.status, keys: Object.keys(await r.json()).sort().join(","), ms: Date.now() - t0 }); }
  for (const x of answers) { assert.equal(x.status, 200); assert.equal(x.keys, "message,ok,sent"); assert.ok(x.ms >= 300, "the same pace either way"); }
  assert.equal((await (await group("nzGroup", "nobody2@example.com", g)).json()).message, "Thanks. If that's the email or phone you replied with, your kudos link is on its way there.");
  assert.equal((await group("nzGroup", "", g)).status, 400);
  assert.equal((await group("nzGroup", "ana.g@guest.example.com", "bad")).status, 403, "a bad token never matches");
  // the matched guests got their kudos link by email (any case) and by text (any format)
  await new Promise((ok) => setTimeout(ok, 50));
  const mail = fakeOutbox.filter((m) => [m.to].flat().includes("ana.g@guest.example.com") && /kudos link/.test(m.subject)).pop(), txt = fakeTexts.filter((t) => t.to === "+14155550402").pop();
  assert.ok(mail && txt, "sent to the email and the phone that replied " + JSON.stringify([fakeOutbox.slice(-4).map((m) => [m.to, m.subject]), fakeTexts.slice(-3)])); assert.ok(!fakeOutbox.some((m) => /nobody@example\.com|cy\.g@/.test([m.to].flat().join(" ")) && /kudos link/.test(m.subject)), "nothing to a miss or a no-show");
  const linkOf = (t) => new URL(t.match(/https?:\/\/\S+\/k\/\S+/)[0]).searchParams, L1 = linkOf(mail.text), L2 = linkOf(txt.text);
  const m1 = { rid: L1.get("rid"), code: L1.get("code") }, m2 = { rid: L2.get("rid"), code: L2.get("code") };
  assert.equal(m1.rid, ana); assert.match(m1.code, /^gk_[A-Za-z0-9]{24}$/); assert.equal(m2.rid, R.gBo);
  assert.notEqual(m1.code, S().get("rsvps/" + ana).data.code, "never the reply's own code");
  // the kudos page doesn't say whose reply it is before they send
  assert.equal((await getJ(`/api/public/kudos-page/nzGroup?rid=${m1.rid}&code=${m1.code}`)).j.name, "");
  // the kudos-only code opens the kudos page and Send, then shows as sent
  const kp = await getJ(`/api/public/kudos-page/nzGroup?rid=${m1.rid}&code=${m1.code}`); assert.equal(kp.status, 200); assert.equal(kp.j.sent, false);
  assert.equal((await post("/api/public/kudos", { eventId: "nzGroup", rid: m1.rid, code: m1.code, tags: ["food", "again"], via: "ask" })).status, 200);
  assert.equal((await getJ(`/api/public/kudos-page/nzGroup?rid=${m1.rid}&code=${m1.code}`)).j.sent, true);
  assert.equal((await sheet("nzGroup")).progress.kudos, 1);
  // ...and Follow, but nothing else the reply's own code opens
  const fo = await post("/api/public/follow", { handle: "rae-nudge", eventId: "nzGroup", rid: m1.rid, code: m1.code, via: "kudos" }); assert.equal(fo.status, 200);
  // a follow through the group link waits for the email confirmation: not confirmed, not counted yet
  const fj = await fo.json(); assert.equal(fj.confirmed, false); assert.equal(fj.pending, true);
  const conf = fakeOutbox.filter((m) => [m.to].flat().includes("ana.g@guest.example.com") && /^Confirm: follow/.test(m.subject)).pop(); assert.ok(conf, "a confirmation email");
  const before = (await getJ("/api/public/host/rae-nudge")).j.followers;
  const cr = await fetch(conf.text.match(/https?:\/\/\S+follow-confirm\S+/)[0].replace(/^https?:\/\/[^/]+/, srv.base), { redirect: "manual" }); assert.equal(cr.status, 302);
  assert.equal((await getJ("/api/public/host/rae-nudge")).j.followers, before + 1, "counted once confirmed");
  // kudos through the group link are "rsvp" at most, even for a guest the host marked as there
  S().update("rsvps/" + ana, { checkedInAt: Date.now() });
  assert.equal(S().get("kudos/" + ana).data.verified, "rsvp", JSON.stringify(S().get("kudos/" + ana)));
  const hk = (await getJ("/api/host/kudos/nzGroup", host)).j, rv = (hk.kudos || hk).find?.((x) => x.rid === ana); assert.equal(rv?.verified, "rsvp", "worked out again on read, still rsvp");
  assert.equal((await getJ(`/api/public/reply/nzGroup?rid=${m1.rid}&code=${m1.code}`)).status, 404, "not the reply");
  assert.equal((await getJ(`/api/public/chat/nzGroup?rid=${m1.rid}&code=${m1.code}`)).status, 403, "not the chat");
  assert.equal((await getJ(`/api/public/address/nzGroup?rid=${m1.rid}&code=${m1.code}`)).j.ok, false, "not the address");
  assert.equal((await getJ(`/api/public/kudos-page/nzGroup?rid=${R.gBo}&code=${m1.code}`)).status, 403, "one guest's code doesn't open another's");
  // rotating: the old link and old codes stop working
  const r2 = await (await post("/api/host/kudos-nudge/nzGroup/rotate", {}, host)).json(); const g2 = tokenOf(r2); assert.notEqual(g2, g);
  assert.equal((await getJ(`/api/public/kudos-group/nzGroup?g=${g}`)).status, 403);
  assert.equal((await getJ(`/api/public/kudos-page/nzGroup?rid=${m2.rid}&code=${m2.code}`)).status, 403);
  assert.equal((await group("nzGroup", "4155550402", g2)).status, 200);
  // with no email or texting set up, a match goes on to the kudos page (same message), a miss doesn't
  for (const k of ["ENCORE_FAKE_EMAIL", "ENCORE_FAKE_SMS"]) delete process.env[k];
  try { const hit = await (await group("nzGroup", "4155550402", g2)).json(), miss = await (await group("nzGroup", "4155550411", g2)).json();
    assert.equal(hit.message, miss.message); assert.match(hit.next, /^\/k\/nzGroup\?rid=/); assert.equal(miss.next, undefined); }
  finally { process.env.ENCORE_FAKE_EMAIL = "1"; process.env.ENCORE_FAKE_SMS = "1"; }
  // per contact: the same email from anywhere is capped
  process.env.ENCORE_KUDOS_GROUP_PER_CONTACT = "2";
  try { for (let i = 0; i < 2; i++) assert.equal((await group("nzGroup", "cap@example.com", g2)).status, 200); assert.equal((await group("nzGroup", "CAP@example.com", g2)).status, 429); }
  finally { delete process.env.ENCORE_KUDOS_GROUP_PER_CONTACT; }
});

test("Group kudos link: rate limited per event and per IP", async () => {
  const g = tokenOf(await sheet("nzRate"));
  process.env.ENCORE_KUDOS_GROUP_PER_EVENT = "3";
  for (let i = 0; i < 3; i++) assert.equal((await group("nzRate", `x${i}@example.com`, g)).status, 200);
  const r = await group("nzRate", "x9@example.com", g); assert.equal(r.status, 429); assert.equal((await r.json()).code, "rate_limited");
  // per IP: a different event, but this IP is over its limit
  process.env.ENCORE_KUDOS_GROUP_PER_EVENT = "1000"; process.env.ENCORE_KUDOS_GROUP_PER_IP = "1";
  const g2 = tokenOf(await sheet("nzRate2"));
  assert.equal((await group("nzRate2", "y@example.com", g2)).status, 429);
  process.env.ENCORE_KUDOS_GROUP_PER_IP = "1000";
});

test("Send for me: once per guest per 3 days, at most 2 per event, never to opted-out guests or anyone who left kudos", async () => {
  // Cy turned off emails; Di replied STOP; Ed left kudos; Fy has neither phone nor email; Gus was texted by the host yesterday
  const cy = await signup("Cy Park", "cy.s@guest.example.com"); assert.ok((await post("/api/me/prefs", { emails: false }, cy)).ok);
  const stop = await fetch(srv.base + "/api/public/sms/inbound", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ From: "+14155550504", Body: "STOP" }) }); assert.equal(stop.status, 200);
  await add("nzSend", { name: "Ana Diaz", phone: "+14155550501", email: "ana.s@guest.example.com", response: "going" }, "sAna");
  await add("nzSend", { name: "Bo Chen", email: "bo.s@guest.example.com", response: "going" }, "sBo");
  await add("nzSend", { name: "Cy Park", email: "cy.s@guest.example.com", response: "going" }, "sCy");
  await add("nzSend", { name: "Di Lopez", phone: "+14155550504", email: "di.s@guest.example.com", response: "going" }, "sDi");
  await add("nzSend", { name: "Ed Moss", email: "ed.s@guest.example.com", response: "going" }, "sEd");
  await add("nzSend", { name: "Fy Grant", response: "going" }, "sFy");
  await add("nzSend", { name: "Gus Hale", email: "gus.s@guest.example.com", response: "going" }, "sGus");
  assert.equal((await kudos("nzSend", R.sEd)).status, 200);
  assert.ok((await post("/api/host/kudos-nudge/nzSend/nudged", { rid: R.sGus, via: "text" }, host)).ok);
  let s = await sheet("nzSend"); assert.equal(s.send.available, true); assert.equal(s.send.eligible, 2); assert.deepEqual([s.send.used, s.send.max], [0, 2]);
  assert.ok(s.guests.find((g) => g.rid === R.sCy).optedOut && s.guests.find((g) => g.rid === R.sDi).optedOut);
  assert.ok(!s.bcc.includes("cy.s@guest.example.com") && !s.bcc.includes("di.s@guest.example.com"), "BCC leaves out opted-out guests");
  const t0 = fakeTexts.length, e0 = fakeOutbox.length;
  const r1 = await (await post("/api/host/kudos-nudge/nzSend/send", {}, host)).json();
  assert.deepEqual([r1.sent, r1.used], [2, 1], JSON.stringify(r1));
  const texts = fakeTexts.slice(t0), mails = fakeOutbox.slice(e0);
  assert.equal(texts.length, 1); assert.equal(texts[0].to, "+14155550501");
  assert.match(texts[0].text, /^Rae would love to hear how Pasta night was\. 10 seconds: http:\/\/127\.0\.0\.1:\d+\/k\/nzSend\?rid=[A-Za-z0-9_-]+&code=[A-Za-z0-9]+ Reply STOP to opt out\.$/);
  assert.equal(mails.length, 1); assert.deepEqual(mails[0].to, ["bo.s@guest.example.com"]); assert.equal(mails[0].subject, "How was Pasta night?");
  assert.match(mails[0].text, /Rae would love to hear how Pasta night was\. 10 seconds: http/);
  for (const who of ["+14155550504", "cy.s@", "di.s@", "ed.s@", "gus.s@"]) assert.ok(!JSON.stringify([texts, mails]).includes(who), who + " isn't reminded");
  // right away again: everyone was just reminded, so nothing goes and the send isn't used up
  const r2 = await (await post("/api/host/kudos-nudge/nzSend/send", {}, host)).json(); assert.deepEqual([r2.sent, r2.used], [0, 1]);
  s = await sheet("nzSend"); assert.equal(s.send.used, 1); assert.ok(s.guests.find((g) => g.rid === R.sAna).nudgedAt, "shows as nudged");
  // 4 days later: Ana, Bo and Gus (the host's own text was 4 days ago) get the second; then that's the most
  const N = srv.app.locals.kudosNudge, origin = "https://pl.example";
  const r3 = await N.sendForMe(ws, "nzSend", origin, Date.now() + 4 * DAYMS); assert.deepEqual([r3.sent, r3.used], [3, 2], JSON.stringify(r3));
  const r4 = await N.sendForMe(ws, "nzSend", origin, Date.now() + 8 * DAYMS); assert.equal(r4.ok, false); assert.equal(r4.status, 429);
  assert.equal(r4.message, "You've sent 2 reminders for this event. That's the most we send.");
  const http = await post("/api/host/kudos-nudge/nzSend/send", {}, host); assert.equal(http.status, 429);
  // not before the event's over, and only the host
  assert.equal((await post("/api/host/kudos-nudge/nzSoon/send", {}, host)).status, 400);
  assert.equal((await post("/api/host/kudos-nudge/nzSend/send", {})).status, 403);
});

test("The automatic reminder: 3 days after the first ask, once, only to guests who haven't left kudos; the host can switch it off", async () => {
  await add("nzAuto", { name: "Ana Diaz", phone: "+14155550601", response: "going" }, "aAna");
  await add("nzAuto", { name: "Bo Chen", email: "bo.a@guest.example.com", response: "going" }, "aBo");
  await add("nzAuto", { name: "Cy Park", email: "cy.a@guest.example.com", response: "going" }, "aCy");
  await add("nzAuto", { name: "Di Lopez", phone: "+14155550604", response: "going" }, "aDi");
  await add("nzOff", { name: "Ed Moss", phone: "+14155550605", response: "going" }, "oEd");
  const first = await srv.app.locals.kudosAsks.run({ now: morning, origin: "https://pl.example", workspaces: [ws] });
  assert.ok(first.asked >= 5, JSON.stringify(first));
  // the host sees when it goes out
  let s = await sheet("nzAuto"); assert.equal(s.followUp.on, true); assert.equal(s.followUp.date, new Date(morning + 3 * DAYMS).toISOString().slice(0, 10));
  assert.equal(s.followUp.day, new Date(morning + 3 * DAYMS).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }));
  // Cy leaves kudos; Di was nudged by the host 1 day before the reminder; the host switches off the reminder for nzOff
  assert.equal((await kudos("nzAuto", R.aCy)).status, 200);
  assert.ok((await post("/api/host/kudos-nudge/nzOff/follow-up", { on: false }, host)).ok);
  assert.equal((await sheet("nzOff")).followUp.on, false);
  const N = srv.app.locals.kudosNudge;
  N.markNudged(ws, "nzAuto", R.aDi, "text", morning + 2 * DAYMS);
  const early = await N.runFollowUps({ now: morning + 2 * DAYMS, workspaces: [ws], origin: "https://pl.example" }); assert.equal(early.sent, 0, "not before 3 days");
  const t0 = fakeTexts.length, e0 = fakeOutbox.length;
  const due = morning + 3 * DAYMS + 3600e3, r1 = await N.runFollowUps({ now: due, workspaces: [ws], origin: "https://pl.example" });
  assert.deepEqual(r1.events.find((e) => e.eventId === "nzAuto"), { ws, eventId: "nzAuto", sent: 2, skipped: 2 }, JSON.stringify(r1));
  assert.ok(!r1.events.some((e) => e.eventId === "nzOff"), "switched off: nothing, not even logged");
  const mine = (x) => /nzAuto/.test(x.text), texts = fakeTexts.slice(t0).filter(mine), mails = fakeOutbox.slice(e0).filter(mine);
  assert.deepEqual(texts.map((t) => t.to), ["+14155550601"], "Ana by text; not Di (the host just nudged her), not Ed (switched off)");
  assert.match(texts[0].text, /^One last ask: how was Curry night\? Kudos for Rae take 10 seconds: https:\/\/pl\.example\/k\/nzAuto\?rid=[A-Za-z0-9_-]+&code=[A-Za-z0-9]+ Reply STOP to opt out\.$/);
  assert.deepEqual(mails.map((m) => m.to[0]), ["bo.a@guest.example.com"], "Bo by email; not Cy (left kudos)");
  // never twice
  const r2 = await N.runFollowUps({ now: due + 3600e3, workspaces: [ws], origin: "https://pl.example" }), r3 = await N.runFollowUps({ now: due + 2 * DAYMS, workspaces: [ws], origin: "https://pl.example" });
  assert.equal(r2.sent + r3.sent, 0); assert.equal(fakeTexts.slice(t0).filter(mine).length, 1); assert.equal(fakeOutbox.slice(e0).filter(mine).length, 1);
  s = await sheet("nzAuto"); assert.equal(s.followUp.sent, true); assert.equal(s.followUp.count, 2);
  // logged in kudosasks, and the first-ask count is unchanged
  assert.ok(S().list("kudosasks").some((d) => d.id === `nzAuto--${R.aAna}--f` && d.data.channel === "sms"));
  assert.deepEqual((await getJ("/api/host/kudos/nzAuto", host)).j.ask, { asked: 4, sent: 1 });
  // the host can't write the log through the data API
  assert.equal((await put(`kudosasks/nzAuto--${R.aBo}--f`, { kind: "followup" }, host)).status, 403);
});
