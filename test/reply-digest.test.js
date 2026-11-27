// The host's reply summary (server/replydigest.js): after the first yes, replies reach the host as one calm email per
// event every few hours, listing who said yes, maybe and can't, with one link to the guest list.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { fakeOutbox } from "../server/email.js";
import { digestCopy, REPLY_DIGEST_GAP, REPLY_DIGEST_DELAY } from "../server/replydigest.js";

let srv, host, hostWs, D;
const J = { "content-type": "application/json" };
const post = (p, body, cookie, headers = {}) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}), ...headers }, body: JSON.stringify(body || {}) });
const cookieOf = (r) => r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "rd-secret", ENCORE_SIGNUP_PER_HOUR: "500", ENCORE_FAKE_EMAIL: "1", ENCORE_TZ: "UTC" };
const HOST = "nina.rd@example.com";
// noon UTC tomorrow: never quiet hours, and after every reply made in this run
const noon = (plusDays = 1) => { const d = new Date(Date.now() + plusDays * 864e5); d.setUTCHours(12, 0, 0, 0); return +d; };
const reply = async (eventId, name, response, extra = {}, ws = hostWs) => { const who = name.split(" ")[0].toLowerCase(); const r = await post("/api/db/collection?path=rsvps", { eventId, name, email: `${who}.rd@guest.example.com`, response, code: "RD" + who.slice(0, 3).toUpperCase(), createdAt: Date.now(), via: "invite-lite", ...extra }, null, { "x-encore-guest": "1", "x-encore-key": "rd-" + who + "-" + eventId, "x-encore-workspace": ws }); assert.equal(r.status, 200, await r.clone().text()); return (await r.json()).id; };
const mailTo = (to, from = 0) => fakeOutbox.slice(from).filter((m) => [].concat(m.to).includes(to));

before(async () => {
  srv = await startServer(); Object.assign(process.env, ENV); resetLoginLimits(); D = srv.app.locals.replyDigest;
  const r = await post("/api/signup", { name: "Nina Park", email: HOST, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200); host = cookieOf(r); hostWs = (await r.json()).workspace.id;
  for (const [id, name] of [["rdA", "Dumpling night"], ["rdB", "Soup Sunday"], ["rdC", "Tea morning"]]) assert.equal((await fetch(srv.base + "/api/db/doc?path=events/" + id, { method: "PUT", headers: { ...J, cookie: host }, body: JSON.stringify({ kind: "social", casual: true, published: true, name, pubTitle: name, date: day(9), startTime: "19:00", city: "London" }) })).status, 200);
});
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

test("the words: one line per answer, totals, one link to the guest list, how to turn it off, no em dash", () => {
  const C = digestCopy({ title: "Dumpling night", when: "Fri, Dec 4", items: [{ name: "Sam Okafor", state: "going", plus: 1 }, { name: "Ivy Chen", state: "going" }, { name: "Omar", state: "maybe" }, { name: "Lena", state: "no" }], totals: { going: 6, maybe: 1, no: 1 }, link: "http://x/?app=1&open=rdA#studio", settings: "http://x/settings#notify" });
  assert.equal(C.subject, "4 new replies for Dumpling night");
  assert.match(C.text, /I'm in \(2\): Sam Okafor \+1, Ivy Chen\nMaybe \(1\): Omar\nCan't go \(1\): Lena/);
  assert.match(C.text, /So far: 6 in, 1 maybe, 1 can't go\./);
  assert.equal(C.text.match(/https?:\/\/\S+/g).length, 2, "the guest list and Settings, nothing else");
  assert.match(C.html, /<a href="http:\/\/x\/\?app=1&amp;open=rdA#studio"[^>]*border-radius:6px[^>]*>See the guest list<\/a>/); assert.equal(C.html.match(/See the guest list/g).length, 1, "one button");
  assert.ok(!/—/.test(C.text + C.html + C.subject));
  const one = digestCopy({ title: "Dumpling night", items: [{ name: "Sam", state: "no" }], totals: {}, link: "l", settings: "s" }); assert.equal(one.subject, "Sam can't go to Dumpling night"); assert.match(one.text, /^One new reply for Dumpling night\./);
  const many = digestCopy({ title: "T", items: Array.from({ length: 15 }, (_, i) => ({ name: "G" + i, state: "going" })), totals: { going: 15 }, link: "l", settings: "s" }); assert.match(many.text, /G11 and 3 more/);
});

test("the first yes emails at once and says a summary follows; later replies wait and arrive as one email", async () => {
  const m0 = fakeOutbox.length;
  await reply("rdA", "Sam Okafor", "going");
  const first = mailTo(HOST, m0); assert.equal(first.length, 1); assert.equal(first[0].subject, "Sam is in for Dumpling night"); assert.match(first[0].text, /one short summary every few hours, never one by one/);
  assert.equal(D.pendingOf(hostWs, "rdA").length, 0, "the first yes is not repeated in the summary");
  await reply("rdA", "Ivy Chen", "going", { plusOne: 1 }); await reply("rdA", "Omar Haddad", "maybe"); const lena = await reply("rdA", "Lena Brandt", "going");
  assert.equal(mailTo(HOST, m0).length, 1, "no email per reply");
  // Lena changes her mind before the summary: one line, her latest answer
  const lk = await post("/api/public/reply/rdA", { rid: lena, code: "RDLEN", response: "no" }); assert.equal(lk.status, 200, await lk.clone().text());
  assert.equal(D.pendingOf(hostWs, "rdA").length, 3);
  // inside the gap after the first-yes email: nothing yet
  assert.deepEqual(await D.run(Date.now() + REPLY_DIGEST_DELAY + 60e3, "http://x"), { sent: 0 });
  const t = Math.max(noon(), Date.now() + REPLY_DIGEST_GAP + 60e3);
  assert.deepEqual(await D.run(t, "http://x"), { sent: 1 });
  const L = mailTo(HOST, m0); assert.equal(L.length, 2); const m = L[1];
  assert.equal(m.subject, "3 new replies for Dumpling night");
  assert.match(m.text, /I'm in \(1\): Ivy Chen \+1\nMaybe \(1\): Omar Haddad\nCan't go \(1\): Lena Brandt/);
  assert.match(m.text, /So far: 3 in, 1 maybe, 1 can't go\./); // Sam, Ivy and her plus one
  assert.match(m.text, /See the guest list: http:\/\/x\/\?app=1&open=rdA#studio/); assert.match(m.text, /Turn them off in Settings: http:\/\/x\/settings#notify/);
  assert.ok(m.html && /See the guest list<\/a>/.test(m.html), "the email carries one button");
  assert.ok(!m.headers, "not a list email: no unsubscribe footer, the switch is in Settings");
  // nothing new: no second email
  assert.deepEqual(await D.run(t + REPLY_DIGEST_GAP + 60e3, "http://x"), { sent: 0 });
  // a reply right after a summary waits a full gap, and for the quiet half hour
  await reply("rdA", "Theo Marsh", "going");
  assert.deepEqual(await D.run(t + 3600e3, "http://x"), { sent: 0 });
  const t2 = noon(2); assert.deepEqual(await D.run(t2, "http://x"), { sent: 1 }); assert.equal(mailTo(HOST, m0)[2].subject, "Theo Marsh is in for Dumpling night");
  const log = srv.store.list(`ws/${hostWs}/outbox`).map((d) => d.data).filter((x) => x.kind === "replydigest"); assert.equal(log.length, 2, "each summary is in the outbox log");
});

test("never at night, never for what the host already read, and each event has its own clock", async () => {
  const m0 = fakeOutbox.length;
  await reply("rdB", "Sam Okafor", "going"); assert.equal(mailTo(HOST, m0).length, 1, "first yes for the second event");
  await reply("rdB", "Ivy Chen", "going"); await reply("rdC", "Sam Okafor", "going"); await reply("rdC", "Omar Haddad", "maybe");
  const night = new Date(noon(1)); night.setUTCHours(23, 30, 0, 0);
  assert.deepEqual(await D.run(+night, "http://x"), { sent: 0 }, "quiet hours");
  // the host opens the bell and reads everything: Soup Sunday's reply is no longer news
  const list = srv.app.locals.social.inbox(HOST); assert.ok(list.some((x) => /Ivy is in for Soup Sunday/.test(x.text)), "the bell has every reply");
  srv.app.locals.social.markRead(HOST);
  await reply("rdC", "Lena Brandt", "going"); // after reading: still news
  assert.deepEqual(await D.run(noon(2), "http://x"), { sent: 1 });
  const L = mailTo(HOST, m0); assert.equal(L.length, 3); assert.equal(L[2].subject, "Lena Brandt is in for Tea morning");
  assert.equal(D.pendingOf(hostWs, "rdB").length, 0);
});

test("the switches: Reply summaries off, Emails off, Replies off in the Inbox; a placeholder address is never mailed", async () => {
  const mk = async (who, email) => { const r = await post("/api/signup", { name: who, email, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200); const c = cookieOf(r), ws = (await r.json()).workspace.id;
    await fetch(srv.base + "/api/db/doc?path=events/ev" + ws.slice(0, 6), { method: "PUT", headers: { ...J, cookie: c }, body: JSON.stringify({ kind: "social", casual: true, published: true, name: "Quiet supper", pubTitle: "Quiet supper", date: day(9) }) }); return { c, ws, ev: "ev" + ws.slice(0, 6), email }; };
  const a = await mk("Kit Alvarez", "kit.rd@example.com"), b = await mk("Ana Ruiz", "ana.rd@example.com"), c = await mk("Jun Park", "jun.rd@example.com");
  // the default is on, and saving one switch keeps the other
  const p0 = await (await fetch(srv.base + "/api/me/prefs", { headers: { cookie: a.c } })).json(); assert.equal(p0.replyDigest, true); assert.equal(p0.emails, true);
  assert.deepEqual((({ emails, replyDigest }) => ({ emails, replyDigest }))(await (await post("/api/me/prefs", { replyDigest: false }, a.c)).json()), { emails: true, replyDigest: false });
  assert.equal((await (await post("/api/me/prefs", { emails: true }, a.c)).json()).replyDigest, false, "the Emails switch alone doesn't turn summaries back on");
  assert.equal((await (await post("/api/me/prefs", { emails: false }, b.c)).json()).replyDigest, true);
  assert.equal((await post("/api/inbox/kind", { type: "reply", on: false }, c.c)).status, 200);
  const m0 = fakeOutbox.length;
  for (const h of [a, b, c]) { await reply(h.ev, "Sam Okafor", "going", {}, h.ws); await reply(h.ev, "Ivy Chen", "going", {}, h.ws); }
  const first = fakeOutbox.slice(m0); assert.equal(first.filter((m) => /is in for Quiet supper/.test(m.subject)).length, 2, "the first yes still follows the Emails switch only"); assert.ok(!mailTo(b.email, m0).length);
  assert.match(mailTo(a.email, m0)[0].text, /The next replies wait in your bell, not your inbox\./, "summaries off: the first-yes email doesn't promise one");
  const n1 = fakeOutbox.length; assert.deepEqual(await D.run(noon(2), "http://x"), { sent: 0 }); assert.equal(fakeOutbox.length, n1);
  // on again: the next reply is summarised
  await post("/api/me/prefs", { replyDigest: true }, a.c); await reply(a.ev, "Omar Haddad", "maybe", {}, a.ws);
  assert.deepEqual(await D.run(noon(3), "http://x"), { sent: 1 }); assert.equal(mailTo(a.email, n1)[0].subject, "Omar Haddad said maybe to Quiet supper");
  // a phone-only account holds a .invalid stand-in address: nothing is sent, and nothing piles up
  const ws = a.ws, W = srv.store.get("system/ws-" + ws).data; srv.store.set("system/ws-" + ws, { ...W, ownerEmail: "15550001111@phone.potterylab.invalid" });
  try { await reply(a.ev, "Theo Marsh", "going", {}, a.ws); const n2 = fakeOutbox.length; assert.deepEqual(await D.run(noon(4), "http://x"), { sent: 0 }); assert.equal(fakeOutbox.length, n2); assert.equal(D.pendingOf(ws, a.ev).length, 0); } finally { srv.store.set("system/ws-" + ws, W); }
});

test("Settings has the switch, saved without touching Emails", () => {
  const html = fs.readFileSync(new URL("../public/settings.html", import.meta.url), "utf8");
  assert.match(html, /id="replyDigest"[^>]*aria-label="Reply summaries"/); assert.match(html, /send\("\/api\/me\/prefs", \{ replyDigest: e\.target\.checked \}\)/); assert.match(html, /send\("\/api\/me\/prefs", \{ emails: e\.target\.checked \}\)/);
  assert.match(html, /id="notify"/, "the email's Settings link lands on Notifications");
});
