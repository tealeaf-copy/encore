// Group chats (server/chat.js, public/chats.html, public/chat.js): who's in the chat, guests by their reply proof,
// non-members and private events, rate limits, the email digest, unread counts, the host taking a guest out, and the
// guest-list emoji picker being gone from every reply screen.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { fakeOutbox } from "../server/email.js";
import { accessOf, scrubContact, hasContact, whenLine, clock, DIGEST_GAP, DIGEST_DELAY, MSG_PER_MIN } from "../server/chat.js";

let srv, host, hostB;
const J = { "content-type": "application/json" };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
async function signup(name, email) { const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name, email, password: "long-password-1", mode: "friends" }) }); return r.headers.get("set-cookie").split(";")[0]; }
before(async () => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "chat-secret-0123456789abcdef"; process.env.ENCORE_FAKE_EMAIL = "1"; resetLoginLimits(); srv = await startServer();
  host = await signup("Ada Host", "ada.chat@example.com"); hostB = await signup("Bo Other", "bo.chat@example.com"); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv.close(); });

const put = (id, d, cookie = host) => fetch(srv.base + "/api/db/doc?path=events/" + id, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(d) });
const getEv = async (id) => (await (await fetch(srv.base + "/api/db/doc?path=events/" + id, { headers: { cookie: host } })).json()).data;
async function reply(eventId, key, { name, email = "", resp = "going", cookie = "" } = {}) {
  const doc = await (await fetch(srv.base + "/api/db/doc?path=" + encodeURIComponent("events/" + eventId), { headers: { "x-encore-guest": "1" } })).json();
  const ask = !!doc.data.approvalRequired, code = "C" + key.slice(-5).toUpperCase();
  const data = { eventId, response: ask && resp === "going" ? "requested" : resp, name, email, code, createdAt: Date.now(), via: "invite-lite" };
  const r = await fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, "x-encore-guest": "1", "x-encore-key": key, "x-encore-workspace": doc.workspace, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(data) });
  const j = await r.json(); return { status: r.status, j, rid: String(j.id || "").split("/").pop(), code, key, ws: doc.workspace };
}
const change = (g, response) => fetch(srv.base + "/api/db/doc?path=rsvps/" + g.rid, { method: "PATCH", headers: { ...J, "x-encore-guest": "1", "x-encore-key": g.key, "x-encore-workspace": g.ws }, body: JSON.stringify({ response, changedAt: Date.now() }) });
const letIn = (rid) => fetch(srv.base + "/api/db/doc?path=rsvps/" + rid, { method: "PATCH", headers: { ...J, cookie: host }, body: JSON.stringify({ response: "going" }) });
const q = (g) => `rid=${encodeURIComponent(g.rid)}&code=${encodeURIComponent(g.code)}`;
const chat = (id, g, extra = "") => fetch(`${srv.base}/api/chats/${id}?${g ? q(g) : ""}${extra}`, { headers: g?.cookie ? { cookie: g.cookie } : {} });
const say = (id, g, text, more = {}) => fetch(`${srv.base}/api/chats/${id}/messages`, { method: "POST", headers: { ...J, ...(g?.cookie ? { cookie: g.cookie } : {}) }, body: JSON.stringify({ ...(g?.rid ? { rid: g.rid, code: g.code } : {}), text, ...more }) });
const act = (id, path, g, body = {}) => fetch(`${srv.base}/api/chats/${id}/${path}`, { method: "POST", headers: { ...J, ...(g?.cookie ? { cookie: g.cookie } : {}) }, body: JSON.stringify({ ...(g?.rid ? { rid: g.rid, code: g.code } : {}), ...body }) });

test("membership rules: going, maybe, waitlist, asked, let in, can't go, removed, host", () => {
  const ev = {}, evM = { chatMaybeRead: true };
  assert.deepEqual(pick(accessOf({ role: "host" })), [true, true]);
  assert.deepEqual(pick(accessOf({ role: "cohost" })), [true, true]);
  assert.deepEqual(pick(accessOf({ role: "guest", rsvp: { response: "going" }, ev })), [true, true], "I'm in: read and write");
  assert.deepEqual(pick(accessOf({ role: "guest", rsvp: { response: "maybe" }, ev })), [false, false], "Maybe: nothing by default");
  assert.deepEqual(pick(accessOf({ role: "guest", rsvp: { response: "maybe" }, ev: evM })), [true, false], "Maybe: read only when the host allows it");
  assert.deepEqual(pick(accessOf({ role: "guest", rsvp: { response: "waitlist" }, ev })), [false, false]);
  assert.equal(accessOf({ role: "guest", rsvp: { response: "requested" }, ev }).why, "asked");
  assert.deepEqual(pick(accessOf({ role: "guest", rsvp: { response: "no" }, ev, state: { joinedAt: 1 } })), [true, false], "Can't go after being in: read only");
  assert.deepEqual(pick(accessOf({ role: "guest", rsvp: { response: "no" }, ev })), [false, false], "Can't go without ever being in: nothing");
  assert.deepEqual(pick(accessOf({ role: "guest", rsvp: { response: "going" }, ev, state: { removed: true } })), [false, false], "removed by the host");
  assert.deepEqual(pick(accessOf({ role: null })), [false, false]);
  function pick(a) { return [a.read, a.write]; }
});

test("helpers: contact details are hidden, times read the house way", () => {
  assert.equal(scrubContact("text me 415 555 0134 or mia@example.com"), "text me (number hidden) or (email hidden)");
  assert.equal(scrubContact("see you at 7:30, bring 2 chairs"), "see you at 7:30, bring 2 chairs");
  assert.ok(hasContact("+1 (415) 555-0134")); assert.ok(!hasContact("Sat at 7"));
  assert.equal(clock("19:30"), "7:30pm"); assert.equal(clock("19:00"), "7pm"); assert.equal(whenLine({ date: "2026-12-12", startTime: "19:00" }), "Sat, Dec 12 · 7pm");
});

test("a guest who's in lands in the chat by their reply proof; others don't get in", async () => {
  await put("chopen", { kind: "social", casual: true, name: "Dumpling night", date: day(5), startTime: "19:00", published: true, headcount: 10 });
  const mia = await reply("chopen", "key-mia-00001", { name: "Mia Lopez", email: "mia.chat@example.com" }); assert.equal(mia.j.response, "going");
  const r = await chat("chopen", mia); assert.equal(r.status, 200); const T = await r.json();
  assert.equal(T.event.title, "Dumpling night"); assert.equal(T.me.canWrite, true); assert.equal(T.me.role, "guest"); assert.equal(T.event.inCount, 1);
  assert.ok(T.messages.some((m) => m.kind === "system" && m.text === "Mia is in."), "a quiet line when someone's in");
  assert.ok(T.members.some((m) => m.role === "host" && m.name === "Ada"));
  assert.ok(!JSON.stringify(T).includes("mia.chat@example.com"), "no emails in the chat"); assert.ok(!JSON.stringify(T).includes(mia.rid), "no reply ids in the chat");
  assert.ok(T.members.every((m) => !/\s/.test(m.name)), "first names only");
  // a wrong code, no proof, and someone else's event
  assert.equal((await chat("chopen", { rid: mia.rid, code: "WRONG" })).status, 403);
  assert.equal((await chat("chopen", null)).status, 403);
  assert.equal((await fetch(`${srv.base}/api/chats/chopen`, { headers: { cookie: hostB } })).status, 403, "another host isn't a member");
  assert.equal((await chat("nosuchevent", mia)).status, 404);
  // sending: text, contact details hidden for guests, the host's own kept, replies quote the message
  const s1 = await (await say("chopen", mia, "Can I bring my sister? Call me on 415 555 0134")).json(); assert.equal(s1.ok, true); assert.match(s1.message.text, /\(number hidden\)$/);
  const h1 = await (await say("chopen", { cookie: host }, "Of course! My number for the door is 415 555 0199", { replyTo: s1.message.id })).json();
  assert.match(h1.message.text, /415 555 0199/); assert.equal(h1.message.replyTo.by, "Mia");
  // non-members can't write
  assert.equal((await say("chopen", { rid: mia.rid, code: "WRONG" }, "hi")).status, 403);
  assert.equal((await say("chopen", { cookie: hostB }, "hi")).status, 403);
  // the generic data API can't write chat messages or member state
  assert.equal((await fetch(srv.base + "/api/db/collection?path=chat", { method: "POST", headers: { ...J, cookie: host }, body: JSON.stringify({ eventId: "chopen", text: "x" }) })).status, 403);
  assert.equal((await fetch(srv.base + "/api/db/doc?path=chatmembers/x", { method: "PUT", headers: { ...J, cookie: host }, body: JSON.stringify({ removed: false }) })).status, 403);
});

test("Maybe, waitlist and Can't go: a clear state, reading only when allowed", async () => {
  await put("chmaybe", { kind: "social", casual: true, name: "Board games", date: day(6), published: true, headcount: 2 });
  const a = await reply("chmaybe", "key-may-00001", { name: "Kai", email: "kai.chat@example.com", resp: "maybe" });
  const r0 = await chat("chmaybe", a); assert.equal(r0.status, 403); assert.match((await r0.json()).message, /Tap I'm in/);
  assert.equal((await act("chmaybe", "settings", { cookie: host }, { maybeRead: true })).status, 200);
  const r1 = await (await chat("chmaybe", a)).json(); assert.equal(r1.me.canWrite, false); assert.ok(r1.me.readOnly);
  assert.equal((await say("chmaybe", a, "hello")).status, 403, "Maybe reads but doesn't write");
  // the waitlist
  await reply("chmaybe", "key-wl1-00001", { name: "Rae", email: "rae.chat@example.com" }); await reply("chmaybe", "key-wl2-00001", { name: "Lee", email: "lee.chat@example.com" });
  const w = await reply("chmaybe", "key-wl3-00001", { name: "Zed", email: "zed.chat@example.com" }); assert.equal(w.j.response, "waitlist");
  const rw = await chat("chmaybe", w); assert.equal(rw.status, 403); assert.equal((await rw.json()).code, "not_granted");
});

test("Can't go keeps your messages and leaves you reading; the host can take a guest out", async () => {
  await put("chleave", { kind: "social", casual: true, name: "Picnic", date: day(4), published: true, headcount: 10 });
  const jo = await reply("chleave", "key-jo-000001", { name: "Jo Kim", email: "jo.chat@example.com" });
  const sam = await reply("chleave", "key-sam-00001", { name: "Sam Park", email: "sam.chat@example.com" });
  await (await chat("chleave", jo, "&read=1")).json();
  assert.equal((await say("chleave", jo, "I'll bring a blanket")).status, 200);
  assert.equal((await change(jo, "no")).status, 200);
  const T = await (await chat("chleave", jo)).json(); assert.equal(T.me.canWrite, false, "read only after Can't go"); assert.match(T.me.readOnly, /Can't go/);
  assert.ok(T.messages.some((m) => m.text === "I'll bring a blanket"), "their messages stay"); assert.ok(T.messages.some((m) => m.text === "Jo can't go now."));
  assert.equal((await say("chleave", jo, "still here?")).status, 403);
  // the host takes Sam out: Sam can't read; Sam's messages stay for everyone else
  assert.equal((await say("chleave", sam, "hi all")).status, 200);
  const TH = await (await fetch(srv.base + "/api/chats/chleave", { headers: { cookie: host } })).json(); const s = TH.members.find((m) => m.name === "Sam"); assert.ok(s?.canRemove);
  assert.equal((await act("chleave", "remove", sam, { who: s.who })).status, 403, "only the host removes");
  assert.equal((await act("chleave", "remove", { cookie: host }, { who: s.who })).status, 200);
  const rs = await chat("chleave", sam); assert.equal(rs.status, 403); assert.match((await rs.json()).message, /took you out/);
  const TH2 = await (await fetch(srv.base + "/api/chats/chleave", { headers: { cookie: host } })).json(); assert.ok(TH2.messages.some((m) => m.text === "hi all"));
  assert.ok(!TH2.members.some((m) => m.name === "Sam"));
});

test("Ask to join: no chat while asked; once the host lets them in they join, with a bell and an email", async () => {
  await put("chask", { kind: "social", casual: true, name: "Supper club", date: day(7), startTime: "19:30", published: true, approvalRequired: true, headcount: 8 });
  const m0 = fakeOutbox.length;
  const jo = await reply("chask", "key-ask-00001", { name: "Jo Rivera", email: "jo.ask@example.com" }); assert.equal(jo.j.response, "requested");
  const r0 = await chat("chask", jo); assert.equal(r0.status, 403); assert.match((await r0.json()).message, /once Ada lets you in/);
  assert.equal((await letIn(jo.rid)).status, 200);
  const T = await (await chat("chask", jo)).json(); assert.equal(T.me.canWrite, true);
  assert.ok(T.messages.some((m) => m.kind === "system" && m.text === "Ada let Jo in."));
  const mail = fakeOutbox.slice(m0).find((x) => String(x.to).includes("jo.ask@example.com") && /You're in/.test(x.subject));
  assert.ok(mail, "the let-in email"); assert.match(mail.text, /You're in\. Say hi in the group chat: http[^\s]*\/chats\/chask#reply=/);
  // the emailed link (rid + signed token) opens the chat and hands this browser its code
  const link = mail.text.match(/\/chats\/chask#reply=([^.\s]+)\.([a-f0-9]+)/); assert.ok(link);
  const viaT = await (await fetch(`${srv.base}/api/chats/chask?rid=${link[1]}&t=${link[2]}`)).json(); assert.equal(viaT.proof.code, jo.code);
  assert.equal((await fetch(`${srv.base}/api/chats/chask?rid=${link[1]}&t=${"0".repeat(32)}`)).status, 403);
});

test("signed-in guests see all their chats in one inbox with unread counts; muted chats don't count", async () => {
  const kim = await signup("Kim Lee", "kim.chat@example.com");
  await put("chin1", { kind: "social", casual: true, name: "Run club", date: day(2), startTime: "08:00", published: true, headcount: 10 });
  await put("chin2", { kind: "social", casual: true, name: "Wine night", date: day(9), startTime: "19:00", published: true, headcount: 10 });
  await put("chpast", { kind: "social", casual: true, name: "Last month's potluck", date: day(-20), published: true, headcount: 10 });
  const k1 = await reply("chin1", "key-kim-00001", { name: "Kim Lee", email: "kim.chat@example.com", cookie: kim });
  const k2 = await reply("chin2", "key-kim-00002", { name: "Kim Lee", email: "kim.chat@example.com", cookie: kim });
  void k1; void k2;
  await say("chin1", { cookie: host }, "Meet at the gate"); await say("chin1", { cookie: host }, "Bring water");
  await say("chin2", { cookie: host }, "Reds or whites?");
  const B = await (await fetch(srv.base + "/api/chats", { headers: { cookie: kim } })).json();
  const c1 = B.chats.find((c) => c.id === "chin1"), c2 = B.chats.find((c) => c.id === "chin2");
  assert.equal(c1.unread, 2); assert.equal(c1.last.by, "Ada"); assert.equal(c1.last.text, "Bring water"); assert.equal(c2.unread, 1);
  assert.equal(B.unread, 2, "the badge counts chats with something new"); assert.ok(B.chats.indexOf(c1) < B.chats.indexOf(c2), "upcoming, soonest first");
  // reading clears it; muting hides it from the badge
  await (await fetch(srv.base + "/api/chats/chin1?read=1", { headers: { cookie: kim } })).json();
  await act("chin2", "mute", { cookie: kim }, { on: true });
  const B2 = await (await fetch(srv.base + "/api/chats/badge", { method: "POST", headers: { ...J, cookie: kim }, body: "{}" })).json(); assert.equal(B2.unread, 0);
  // the host's inbox has their events, including the past one only once it has guests
  const HB = await (await fetch(srv.base + "/api/chats", { headers: { cookie: host } })).json(); assert.ok(HB.chats.some((c) => c.id === "chin1" && c.role === "host"));
  // a guest without an account: the inbox from the proofs this browser holds
  const ana = await reply("chin1", "key-ana-00001", { name: "Ana", email: "" });
  const G = await (await fetch(srv.base + "/api/chats", { method: "POST", headers: J, body: JSON.stringify({ proofs: [{ eventId: "chin1", rid: ana.rid, code: ana.code }, { eventId: "chin2", rid: ana.rid, code: ana.code }] }) })).json();
  assert.deepEqual(G.chats.map((c) => c.id), ["chin1"], "only chats the proof is for"); assert.equal(G.signedIn, false);
  // seen by
  await say("chin1", ana, "First run for me!"); await (await fetch(srv.base + "/api/chats/chin1?read=1", { headers: { cookie: host } })).json();
  const TA = await (await chat("chin1", ana)).json(); assert.equal(TA.seen.n >= 1, true); assert.ok(TA.seen.names.includes("Ada"));
});

test("private events stay private: the inbox and the chat only open for members", async () => {
  await put("chpriv", { kind: "social", casual: true, name: "Secret supper", date: day(3), published: true, unlisted: true, discoverable: false, headcount: 6 });
  const g = await reply("chpriv", "key-prv-00001", { name: "Tess", email: "tess.chat@example.com" });
  await say("chpriv", g, "Can't wait");
  assert.equal((await fetch(srv.base + "/api/chats/chpriv")).status, 403);
  const other = await signup("Nosy Parker", "nosy.chat@example.com");
  assert.equal((await fetch(srv.base + "/api/chats/chpriv", { headers: { cookie: other } })).status, 403);
  const B = await (await fetch(srv.base + "/api/chats", { headers: { cookie: other } })).json(); assert.ok(!B.chats.some((c) => c.id === "chpriv"));
  const B2 = await (await fetch(srv.base + "/api/chats", { method: "POST", headers: { ...J, cookie: other }, body: JSON.stringify({ proofs: [{ eventId: "chpriv", rid: g.rid, code: "nope" }] }) })).json(); assert.ok(!B2.chats.some((c) => c.id === "chpriv"));
});

test("rate limits, reactions, pins, typing, report and block", async () => {
  await put("chrate", { kind: "social", casual: true, name: "Karaoke", date: day(3), published: true, headcount: 10 });
  const g = await reply("chrate", "key-rat-00001", { name: "Lou", email: "lou.chat@example.com" });
  const p = await reply("chrate", "key-pal-00001", { name: "Pat", email: "pat.chat@example.com" });
  let last; for (let i = 0; i < MSG_PER_MIN; i++) { last = await say("chrate", g, "la " + i); assert.equal(last.status, 200); }
  const over = await say("chrate", g, "one too many"); assert.equal(over.status, 429); assert.equal((await over.json()).code, "rate_limited");
  const T = await (await chat("chrate", p)).json(); const m = T.messages.find((x) => x.text === "la 0");
  // reactions: a small set, one per person
  assert.equal((await act("chrate", "react", p, { id: m.id, emoji: "💩" })).status, 400);
  assert.equal((await act("chrate", "react", p, { id: m.id, emoji: "❤️" })).status, 200);
  const rr = await (await act("chrate", "react", p, { id: m.id, emoji: "😂" })).json(); assert.deepEqual(Object.keys(rr.message.reactions), ["😂"]);
  // only the host pins
  assert.equal((await act("chrate", "pin", p, { id: m.id })).status, 403);
  assert.equal((await act("chrate", "pin", { cookie: host }, { id: m.id })).status, 200);
  const T2 = await (await chat("chrate", p)).json(); assert.equal(T2.pins[0].id, m.id);
  // typing shows for others
  await act("chrate", "typing", g, {}); const T3 = await (await chat("chrate", p)).json(); assert.deepEqual(T3.typing, ["Lou"]);
  // block hides Lou for Pat; report tells the host
  const lou = T3.members.find((x) => x.name === "Lou"); assert.equal((await act("chrate", "block", p, { who: lou.who })).status, 200);
  const T4 = await (await chat("chrate", p)).json(); assert.ok(!T4.messages.some((x) => x.text?.startsWith("la ") && !x.pinned));
  const host1 = T4.members.find((x) => x.role === "host"); assert.equal((await act("chrate", "block", p, { who: host1.who })).status, 400, "you can't block the host");
  assert.equal((await act("chrate", "report", p, { id: m.id, reason: "spam" })).status, 200);
  const inbox = await (await fetch(srv.base + "/api/me/inbox", { headers: { cookie: host } })).json(); assert.ok(inbox.items.some((x) => x.kind === "report"));
  // the version lets polling skip unchanged threads
  const v = (await (await chat("chrate", p)).json()).v; const same = await (await chat("chrate", p, `&v=${v}`)).json(); assert.equal(same.same, true);
});

test("photos reuse the moments checks; email digests are batched", async () => {
  await put("chpic", { kind: "social", casual: true, name: "Pottery night", date: day(2), published: true, headcount: 10, tz: "UTC" });
  const g = await reply("chpic", "key-pic-00001", { name: "Nia", email: "nia.chat@example.com" });
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a7a00000000049454e44ae426082", "hex");
  const up = await fetch(`${srv.base}/api/chats/chpic/photo?${q(g)}&w=1&h=1`, { method: "POST", headers: { "content-type": "image/png" }, body: png }); assert.equal(up.status, 200);
  const pm = (await up.json()).message; assert.equal(pm.kind, "photo"); assert.match(pm.photo.url, /^\/_blob\//);
  assert.equal((await fetch(`${srv.base}/api/chats/chpic/photo?${q(g)}`, { method: "POST", headers: { "content-type": "image/png" }, body: Buffer.from("not a png at all") })).status, 415);
  assert.equal((await fetch(`${srv.base}/api/chats/chpic/photo?${q(g)}`, { method: "POST", headers: { "content-type": "video/mp4" }, body: png })).status, 415, "photos only");
  // digests: nothing for fresh messages, one email once they've sat unread, then nothing more for DIGEST_GAP
  const D = srv.app.locals.chat; const m0 = fakeOutbox.length;
  for (let i = 0; i < 5; i++) await say("chpic", { cookie: host }, "Message " + i);
  const now = Date.now();
  await D.runDigest(now, "http://x"); assert.equal(fakeOutbox.slice(m0).filter((x) => String(x.to).includes("nia.chat")).length, 0, "not while fresh");
  // the first noon (UTC, the event's zone) after the messages have sat unread: outside quiet hours
  const noon = new Date(now + DIGEST_DELAY + 60e3); if (noon.getUTCHours() >= 12) noon.setUTCDate(noon.getUTCDate() + 1); noon.setUTCHours(12, 0, 0, 0); const later = +noon;
  const night = new Date(later); night.setUTCHours(23, 0, 0, 0); await D.runDigest(+night - 864e5 > now + DIGEST_DELAY ? +night - 864e5 : +night, "http://x");
  const held = fakeOutbox.slice(m0).filter((x) => String(x.to).includes("nia.chat")).length;
  await D.runDigest(later, "http://x"); await D.runDigest(later + 60e3, "http://x");
  const got = fakeOutbox.slice(m0).filter((x) => String(x.to).includes("nia.chat"));
  // quiet hours (9pm to 8am where the event is) hold it; then exactly one, never one per message
  assert.equal(held, 0, "held in quiet hours"); assert.equal(got.length, 1); assert.match(got[0].subject, /5 new in Pottery night/); assert.match(got[0].text, /#reply=/, "a link that opens the chat for a guest");
  await say("chpic", { cookie: host }, "One more"); await D.runDigest(later + 2 * DIGEST_DELAY, "http://x");
  assert.equal(fakeOutbox.slice(m0).filter((x) => String(x.to).includes("nia.chat")).length, got.length, "the gap holds");
  assert.ok(DIGEST_GAP >= 3 * 3600e3);
  // a muted chat never emails
  await act("chpic", "mute", g, { on: true }); await D.runDigest(later + DIGEST_GAP + 60e3, "http://x");
  assert.equal(fakeOutbox.slice(m0).filter((x) => String(x.to).includes("nia.chat")).length, got.length);
});

test("event edits show in the chat: a new time, the address", async () => {
  await put("chedit", { kind: "social", casual: true, name: "Book club", date: day(5), startTime: "19:00", published: true, headcount: 10 });
  const g = await reply("chedit", "key-edt-00001", { name: "Ola", email: "ola.chat@example.com" });
  const ev = await getEv("chedit"); await put("chedit", { ...ev, startTime: "19:30" });
  const ev2 = await getEv("chedit"); await put("chedit", { ...ev2, venueAddr: "12 Elm St" });
  const T = await (await chat("chedit", g)).json(), lines = T.messages.filter((m) => m.kind === "system").map((m) => m.text);
  assert.ok(lines.includes("Ada moved it to 7:30pm."), lines.join(" | ")); assert.ok(lines.includes("Ada shared the address with guests. It's on the invite."));
  assert.ok(!lines.some((l) => /12 Elm/.test(l)), "the address itself stays on the invite");
});

test("the guest-list emoji picker is gone; replies point to the group chat", () => {
  const html = read("index.html"), inv = read("public/invite.html");
  for (const [f, s] of [["index.html", html], ["public/invite.html", inv], ["public/invite-order.js", read("public/invite-order.js")]]) {
    assert.ok(!/guest-list emoji/i.test(s), f + " has no emoji picker copy"); assert.ok(!/party-emo|data-emo=/.test(s), f + " has no emoji buttons"); }
  assert.match(html, /Open the group chat/); assert.match(inv, /Open the group chat/);
  assert.ok(inv.length < 40000, "the light invite stays under its cap: " + inv.length);
  // the "Come with me?" loader is still the last script on both pages
  const lastScript = (s) => s.slice(s.lastIndexOf("<script"));
  assert.match(lastScript(html), /comewith\.js/); assert.match(lastScript(inv), /comewith|\/g#rsvp-|function|\(\(\)|\(async/);
  // the nav has Chats
  assert.match(read("public/shell.js"), /\/chats/); assert.ok(fs.existsSync(new URL("../public/chats.html", import.meta.url)));
});
