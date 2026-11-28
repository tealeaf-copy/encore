// Direct messages (server/dm.js, public/chat.js, public/dmstart.js): who may message whom, requests (one message, no
// photos or links, accept, delete, block), privacy (a third person gets a 404 on a thread and its photos), blocks both
// ways, reports with the messages attached, unsend, reactions, seen, mute, unread counts and the Chats badge, rate
// limits, story replies as the first message with the story card, account deletion, and a two-person walk in a
// browser at 390 (touch) and 1280.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { fakeOutbox } from "../server/email.js";
import { dmLimits, DM_MAX_TEXT, DM_EMAIL_AFTER } from "../server/dm.js";
import { getDbUser, putDbUser } from "../server/workspaces.js";

const SHOTS = process.env.DM_SHOTS || "";
let srv, X, DM, M;
const J = { "content-type": "application/json" };
const post = (p, body, cookie) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body || {}) });
const get = (p, cookie) => fetch(srv.base + p, { headers: cookie ? { cookie } : {} });
const getJ = async (p, cookie) => (await get(p, cookie)).json();
const postJ = async (p, body, cookie) => (await post(p, body, cookie)).json();
const put = (p, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + p, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
const day = (n) => { const d = new Date(Date.now() + n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const keyOf = (email) => Buffer.from(email).toString("base64url");
function png(w, h, [r, g, b]) { const crc = (buf) => { let c, n = ~0; for (const x of buf) { c = (n ^ x) & 255; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; n = (n >>> 8) ^ c; } return ~n >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2; const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).map((_, i) => [r, g, b][i % 3])]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk("IEND", Buffer.alloc(0))]); }
const PNG = png(40, 30, [200, 80, 40]), JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const join = async (name, email, extra = {}) => { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends", ...extra }); const b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); return { cookie: cookieOf(r), ws: b.workspace.id, email, name, key: keyOf(email) }; };
const page = async (who, handle, name) => assert.ok((await post("/api/host/profile", { handle, name }, who.cookie)).ok, handle);
const ev = (id, extra, host) => put("events/" + id, { kind: "social", casual: true, activity: "dinner", published: true, discoverable: true, date: day(4), startTime: "19:00", ...extra }, host.cookie).then((r) => assert.equal(r.status, 200, id));
const went = (host, eventId, who, response = "going") => { srv.store.set(`ws/${host.ws}/rsvps/r-${eventId}-${who.email.split("@")[0].replace(/\W/g, "")}`, { response, createdAt: Date.now() - 5 * 864e5, eventId, name: who.name, email: who.email, code: "C" + eventId }); X.bust(); };
const open = async (from, to, how = {}) => { const r = await post("/api/dm/open", Object.keys(how).length ? how : { key: to.key }, from.cookie); return { status: r.status, ...(await r.json()) }; };
const say = async (from, id, text, more = {}) => { const r = await post(`/api/dm/${id}/messages`, { text, ...more }, from.cookie); return { status: r.status, ...(await r.json()) }; };
const thread = async (who, id, q = "") => { const r = await get(`/api/dm/${id}${q}`, who.cookie); return { status: r.status, ...(await r.json()) }; };
const photo = async (from, id, body = PNG, ct = "image/png") => { const r = await fetch(`${srv.base}/api/dm/${id}/photo?w=40&h=30`, { method: "POST", headers: { "content-type": ct, cookie: from.cookie }, body }); return { status: r.status, ...(await r.json()) }; };
const list = (who) => getJ("/api/chats", who.cookie);
const unread = (who) => getJ("/api/me/unread", who.cookie);
const bell = (who) => X.inbox(who.email).filter((n) => n.kind === "dm");
const U = {};

before(async () => {
  Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "dm-secret-0123456789abcdef", ENCORE_SIGNUP_PER_HOUR: "400", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_PUSH: "1", ENCORE_ADMIN_EMAILS: "mod.dm@example.com" }); resetLoginLimits();
  srv = await startServer(); X = srv.app.locals.social; DM = srv.app.locals.dm; M = srv.app.locals.storyMake;
  U.maya = await join("Maya Chen", "maya.dm@example.com"); U.sam = await join("Sam Ortiz", "sam.dm@example.com"); U.gia = await join("Gia Lund", "gia.dm@example.com"); U.hal = await join("Hal Moss", "hal.dm@example.com");
  U.ivy = await join("Ivy Stone", "ivy.dm@example.com"); U.zed = await join("Zed Vance", "zed.dm@example.com"); U.mod = await join("Mod Team", "mod.dm@example.com");
  await page(U.maya, "maya-dm", "Maya's table"); await page(U.sam, "sam-dm", "Sam's supper club");
  await ev("dmDinner", { name: "Dumpling Night" }, U.maya); await ev("dmPast", { name: "Hot pot", date: day(-3) }, U.maya); await ev("dmSam", { name: "Sam's picnic" }, U.sam);
  went(U.maya, "dmDinner", U.gia); went(U.maya, "dmDinner", U.hal); went(U.maya, "dmPast", U.ivy, "maybe"); X.bust();
});
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "dm-secret-0123456789abcdef"; resetLoginLimits(); DM.resetLimits(); M.resetLimits(); for (const k of ["ENCORE_DM_PER_HOUR", "ENCORE_DM_NEW_PER_DAY", "ENCORE_DM_REQUESTS_PER_DAY", "ENCORE_DM_PHOTOS_PER_HOUR"]) delete process.env[k]; });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL", "ENCORE_FAKE_PUSH", "ENCORE_ADMIN_EMAILS"]) delete process.env[k]; await srv.close(); });

test("who may message whom without asking, who goes to requests, and who can't write at all", async () => {
  const may = (a, b) => DM.may(a.email, b.email);
  // the same event: host and guest, and two guests
  assert.equal(may(U.gia, U.maya).ok, "free"); assert.equal(may(U.maya, U.gia).why, "event"); assert.equal(may(U.gia, U.hal).ok, "free", "two guests of the same event");
  // a host and someone who replied to their event, whatever the reply was
  assert.equal(may(U.ivy, U.maya).why, "guest"); assert.equal(may(U.maya, U.ivy).ok, "free");
  // a stranger to a host: a request (hosts take requests from everyone by default)
  assert.deepEqual(DM.whoOf(U.maya.email), { who: "everyone", default: "everyone", host: true }); assert.equal(may(U.zed, U.maya).ok, "request");
  // a stranger to someone who has never hosted: nothing in common, so no request either
  assert.equal(DM.whoOf(U.zed.email).who, "common"); const no = may(U.gia, U.zed); assert.equal(no.ok, false); assert.equal(no.code, "not_open"); assert.match(no.message, /something in common/);
  // one-way: Zed adds Gia as a friend. Gia may write to Zed freely (he reached out); Zed to Gia is a request now that they have a tie
  assert.equal((await post("/api/me/friends", { key: U.gia.key }, U.zed.cookie)).status, 200);
  assert.equal(may(U.gia, U.zed).why, "friend"); assert.equal(may(U.zed, U.gia).ok, "request");
  await fetch(`${srv.base}/api/me/friends/${U.gia.key}`, { method: "DELETE", headers: { cookie: U.zed.cookie } });
  // people who follow each other: Zed follows Sam's page, Sam adds Zed
  assert.equal((await post("/api/public/follow", { handle: "sam-dm" }, U.zed.cookie)).status, 200); assert.equal(may(U.zed, U.sam).ok, "request", "one way is not enough");
  assert.equal((await post("/api/me/friends", { key: U.zed.key }, U.sam.cookie)).status, 200); assert.equal(may(U.zed, U.sam).ok, "free"); assert.equal(may(U.sam, U.zed).why, "mutual");
  await fetch(`${srv.base}/api/me/friends/${U.zed.key}`, { method: "DELETE", headers: { cookie: U.sam.cookie } });
  // both sides of an accepted team-up
  assert.equal(may(U.maya, U.sam).ok, "request"); srv.store.set("system/teamup-t1", { kind: "teamup", id: "t1", status: "sent", fromWs: U.maya.ws, toWs: U.sam.ws }); assert.equal(may(U.maya, U.sam).ok, "request", "not until it's accepted");
  srv.store.set("system/teamup-t1", { kind: "teamup", id: "t1", status: "accepted", fromWs: U.maya.ws, toWs: U.sam.ws }); assert.equal(may(U.sam, U.maya).why, "teamup"); srv.store.delete("system/teamup-t1");
  // "Who can message me": No one new, and People I follow and guests
  assert.equal((await post("/api/dm/settings", { who: "nobody" }, U.maya.cookie)).status, 400);
  assert.equal((await postJ("/api/dm/settings", { who: "none" }, U.maya.cookie)).who, "none"); assert.equal(may(U.zed, U.maya).code, "not_open"); assert.equal(may(U.gia, U.maya).ok, "free", "guests can still write");
  await post("/api/dm/settings", { who: "follow" }, U.maya.cookie); assert.equal(may(U.zed, U.maya).ok, false); await post("/api/me/friends", { key: U.zed.key }, U.maya.cookie); assert.equal(may(U.zed, U.maya).ok, "free", "Maya added Zed, so he may write");
  await fetch(`${srv.base}/api/me/friends/${U.zed.key}`, { method: "DELETE", headers: { cookie: U.maya.cookie } }); await post("/api/dm/settings", { who: "everyone" }, U.maya.cookie);
  const S = await getJ("/api/dm/settings", U.maya.cookie); assert.deepEqual(S.options, ["everyone", "follow", "none"]); assert.deepEqual((await getJ("/api/dm/settings", U.zed.cookie)).options, ["everyone", "common", "follow", "none"]);
  // yourself, someone who isn't there, signed out
  assert.equal(may(U.gia, U.gia).code, "self"); assert.equal((await open(U.gia, { key: keyOf("nobody.dm@example.com") })).status, 404); assert.equal((await post("/api/dm/open", { key: U.maya.key })).status, 401);
  // a brand account writing to a host goes to the booking request thread, not a second place
  const brand = await join("Bea Brand", "bea.dm@fernwoodlabs.com", { mode: "work", company: "Fernwood Labs", website: "fernwoodlabs.com" }); const b = await open(brand, U.maya, { handle: "maya-dm" });
  assert.equal(b.status, 409); assert.equal(b.code, "use_booking"); assert.equal(b.link, "/teams/bookings");
});

test("a conversation: text, a photo, an event card, a reaction, a quote reply, seen, typing, unread and the Chats badge", async () => {
  const o = await open(U.gia, U.maya, { handle: "maya-dm" }); assert.equal(o.status, 200); assert.equal(o.state, "new"); assert.equal(o.url, "/chats/dm/" + o.id); P.gm = o.id;
  assert.deepEqual((await list(U.maya)).dms, [], "nothing shows for Maya until there is a message");
  let t = await thread(U.gia, o.id); assert.equal(t.status, 200); assert.equal(t.dm, true); assert.equal(t.peer.name, "Maya Chen"); assert.equal(t.peer.handle, "maya-dm"); assert.equal(t.me.canWrite, true); assert.equal(t.request, undefined); assert.equal(t.limits.text, 2000);
  assert.equal((await say(U.gia, o.id, "   ")).status, 400);
  const m1 = await say(U.gia, o.id, "Hi Maya\u0007, see you <b>Saturday</b>? https://example.com/menu"); assert.equal(m1.status, 200); assert.equal(m1.message.text, "Hi Maya , see you <b>Saturday</b>? https://example.com/menu", "control characters go, the rest is plain text the page escapes"); assert.equal(m1.message.mine, true);
  assert.equal((await say(U.gia, o.id, "x".repeat(DM_MAX_TEXT + 50))).message.text.length, DM_MAX_TEXT);
  // the other person: one unread conversation, counted in the list, the tab badge and the bell, batched
  let L = await list(U.maya); assert.equal(L.dms.length, 1); assert.equal(L.dms[0].id, "dm/" + o.id); assert.equal(L.dms[0].dm, true); assert.equal(L.dms[0].title, "Gia Lund"); assert.equal(L.dms[0].unread, 2); assert.equal(L.unread, 1); assert.equal(L.requests.length, 0);
  let un = await unread(U.maya); assert.equal(un.chats, 1); assert.equal(un.messages, 2); assert.equal(un.latest.chat, "dm/" + o.id); assert.equal(un.latest.dm, true); assert.equal(un.latest.by, "Gia Lund");
  assert.equal(bell(U.maya).length, 1, "one bell item for the conversation"); assert.equal(bell(U.maya)[0].title, "2 new messages from Gia Lund"); assert.equal(bell(U.maya)[0].link, "/chats/dm/" + o.id); assert.equal((await unread(U.gia)).chats, 0, "your own messages never count");
  // not seen yet; Maya opens it: read, seen, bell item read
  assert.equal((await thread(U.gia, o.id)).seen, null); t = await thread(U.maya, o.id, "?read=1"); assert.equal(t.messages.length, 2); assert.equal(t.messages[0].mine, false); assert.equal(t.unreadFrom, 0);
  assert.equal((await unread(U.maya)).chats, 0); assert.equal(bell(U.maya)[0].read, true); assert.equal((await thread(U.gia, o.id)).seen.id, t.messages[1].id, "Seen under the last message");
  // a reply quoting a message, a reaction (one per person), typing
  const r1 = await say(U.maya, o.id, "Yes! Bring chili oil", { replyTo: m1.message.id }); assert.equal(r1.message.replyTo.id, m1.message.id); assert.equal(r1.message.replyTo.by, "Gia"); assert.equal((await thread(U.maya, o.id)).seen, null, "a new message isn't seen yet"); assert.ok((await thread(U.gia, o.id)).seen, "replying means you read it");
  assert.equal((await post(`/api/dm/${o.id}/react`, { id: r1.message.id, emoji: "💣" }, U.gia.cookie)).status, 400);
  let rx = await postJ(`/api/dm/${o.id}/react`, { id: r1.message.id, emoji: "❤️" }, U.gia.cookie); assert.deepEqual(rx.message.reactions, { "❤️": { n: 1, mine: true } });
  rx = await postJ(`/api/dm/${o.id}/react`, { id: r1.message.id, emoji: "😂" }, U.gia.cookie); assert.deepEqual(rx.message.reactions, { "😂": { n: 1, mine: true } }, "one reaction each");
  assert.deepEqual((await thread(U.maya, o.id)).messages[2].reactions, { "😂": { n: 1, mine: false } });
  await post(`/api/dm/${o.id}/typing`, {}, U.gia.cookie); assert.deepEqual((await thread(U.maya, o.id)).typing, ["Gia"]); assert.deepEqual((await thread(U.gia, o.id)).typing, []);
  const v = (await thread(U.maya, o.id)).v; const same = await thread(U.maya, o.id, "?v=" + v); assert.equal(same.same, true, "the poll is cheap when nothing changed");
  // a photo: the moment upload rules, served only through the thread
  assert.equal((await photo(U.gia, o.id, Buffer.from("not a photo"), "image/png")).status, 415); assert.equal((await photo(U.gia, o.id, PNG, "text/plain")).status, 415);
  const ph = await photo(U.gia, o.id); assert.equal(ph.status, 200, JSON.stringify(ph)); assert.equal(ph.message.kind, "photo"); assert.match(ph.message.photo.url, new RegExp(`^/api/dm/${o.id}/media/[A-Za-z0-9]{20}$`)); assert.deepEqual([ph.message.photo.w, ph.message.photo.h], [40, 30]); P.photo = ph.message.photo.url;
  const img = await get(P.photo, U.maya.cookie); assert.equal(img.status, 200); assert.equal(img.headers.get("content-type"), "image/png"); assert.equal(Buffer.from(await img.arrayBuffer()).length, PNG.length);
  // an event as a card, and a link in a message that becomes one
  const c1 = await say(U.maya, o.id, "", { card: { type: "event", id: "dmDinner" } }); assert.equal(c1.status, 200); assert.equal(c1.message.card.type, "event"); assert.equal(c1.message.card.title, "Dumpling Night"); assert.equal(c1.message.card.url, "/e/dmDinner"); assert.match(c1.message.card.sub, /7pm/);
  const c2 = await say(U.maya, o.id, "my page is /@maya-dm"); assert.equal(c2.message.card.type, "host"); assert.equal(c2.message.card.url, "/@maya-dm"); assert.equal(c2.message.card.title, "Maya's table");
  assert.equal((await say(U.maya, o.id, "", { card: { type: "event", id: "nope" } })).status, 400); assert.equal((await say(U.maya, o.id, "", { card: { type: "host", id: "no-such-page" } })).status, 400);
  L = await list(U.gia); assert.equal(L.dms[0].last.text, "my page is /@maya-dm"); assert.equal(L.dms[0].last.by, ""); assert.equal((await list(U.maya)).dms[0].last.by, "You");
  // nothing in any of it names an email or a phone
  for (const who of [U.gia, U.maya]) { const all = JSON.stringify([await thread(who, o.id), await list(who), await unread(who), await getJ("/api/dm/people", who.cookie)]); assert.ok(!/@example\.com/.test(all), "no email in a response"); assert.ok(!all.includes(U.maya.key) && !all.includes(U.gia.key), "nor the friend key that holds one"); }
});
const P = {};

test("privacy: a third person, or nobody signed in, gets a 404 on the thread, its messages and its photos", async () => {
  const id = P.gm, blob = P.photo.split("/").pop();
  for (const who of [U.hal, U.sam, U.mod]) { assert.equal((await get(`/api/dm/${id}`, who.cookie)).status, 404); assert.equal((await say(who, id, "hi")).status, 404); assert.equal((await get(P.photo, who.cookie)).status, 404);
    for (const p of ["react", "unsend", "read", "typing", "mute", "accept", "delete", "block"]) assert.equal((await post(`/api/dm/${id}/${p}`, { id: "0".repeat(16), emoji: "❤️" }, who.cookie)).status, 404, p);
    assert.equal((await photo(who, id)).status, 404); assert.ok(!JSON.stringify(await list(who)).includes(id)); }
  assert.equal((await get(`/api/dm/${id}`)).status, 401); assert.equal((await get(P.photo)).status, 404); assert.equal((await get(`/_blob/${blob}`)).status, 404, "a DM photo is never a public file"); assert.equal((await get(`/_blob/${blob}`, U.gia.cookie)).status, 404);
  assert.equal((await get(`/api/dm/${"0".repeat(24)}`, U.gia.cookie)).status, 404); assert.equal((await get(`/api/dm/${id}/media/${"A".repeat(20)}`, U.gia.cookie)).status, 404);
  // a photo from one thread can't be read through another
  const o2 = await open(U.hal, U.gia); await say(U.hal, o2.id, "hey"); assert.equal((await get(`/api/dm/${o2.id}/media/${blob}`, U.hal.cookie)).status, 404);
  assert.equal(srv.store.get("system/dm-" + id).data.m[Object.keys(srv.store.get("system/dm-" + id).data.m)[0]].readAt > 0, true); assert.ok(!Object.keys(srv.store.get("system/dm-" + id).data.m).some((k) => /@/.test(k)), "read state is keyed by a hash");
});

test("unsend, mute and delete a conversation for yourself", async () => {
  const id = P.gm; let t = await thread(U.gia, id); const mine = t.messages.filter((m) => m.mine), theirs = t.messages.find((m) => !m.mine);
  assert.equal((await post(`/api/dm/${id}/unsend`, { id: theirs.id }, U.gia.cookie)).status, 403, "only your own");
  await post(`/api/dm/${id}/read`, {}, U.maya.cookie); const extra = await say(U.gia, id, "oops wrong chat"); assert.equal((await unread(U.maya)).messages, 1);
  assert.equal((await post(`/api/dm/${id}/unsend`, { id: extra.message.id }, U.gia.cookie)).status, 200); t = await thread(U.maya, id); const gone = t.messages.find((m) => m.id === extra.message.id); assert.equal(gone.removed, true); assert.equal(gone.text, "");
  assert.equal(srv.store.get(`system/dmm-${id}-${extra.message.id}`).data.text, "", "the words are gone from the store too"); assert.equal((await unread(U.maya)).messages, 0, "an unsent message isn't unread"); assert.equal((await list(U.maya)).dms[0].last.text, "Message removed");
  // the photo's file goes with it
  const pm = mine.find((m) => m.kind === "photo"); assert.equal((await post(`/api/dm/${id}/unsend`, { id: pm.id }, U.gia.cookie)).status, 200); await new Promise((r) => setTimeout(r, 60)); assert.equal((await get(P.photo, U.gia.cookie)).status, 404); assert.ok(!fs.existsSync(path.join(srv.dir, "assets", P.photo.split("/").pop())));
  // mute: no badge, no bell, and it says so in the list
  assert.equal((await postJ(`/api/dm/${id}/mute`, { on: true }, U.maya.cookie)).muted, true); const before = bell(U.maya).length; await say(U.gia, id, "are you there?");
  let L = await list(U.maya); assert.equal(L.dms[0].muted, true); assert.equal(L.dms[0].unread, 0); assert.equal(L.dms[0].unreadMuted, 1); assert.equal(L.unread, 0); assert.equal((await unread(U.maya)).chats, 0); assert.equal(bell(U.maya).length, before, "a muted conversation sends nothing");
  assert.equal((await thread(U.maya, id)).me.muted, true); await post(`/api/dm/${id}/mute`, { on: false }, U.maya.cookie); assert.equal((await unread(U.maya)).chats, 1);
  // delete for yourself: it leaves your list, the other person keeps theirs, and a new message brings it back without the old ones
  assert.equal((await post(`/api/dm/${id}/delete`, {}, U.maya.cookie)).status, 200); assert.equal((await list(U.maya)).dms.length, 0); assert.equal((await unread(U.maya)).chats, 0); assert.ok((await thread(U.gia, id)).messages.length > 3, "Gia keeps her copy");
  assert.equal((await thread(U.maya, id)).messages.length, 0); await new Promise((r) => setTimeout(r, 5)); await say(U.gia, id, "new start"); t = await thread(U.maya, id); assert.deepEqual(t.messages.map((m) => m.text), ["new start"]); assert.equal((await list(U.maya)).dms.length, 1);
});

test("a request: one message, words only, no Seen; accept opens it; delete and block are quiet", async () => {
  fakeOutbox.length = 0;
  // Zed has no tie to Maya: his first message is a request
  const o = await open(U.zed, U.maya, { handle: "maya-dm" }); assert.equal(o.status, 200); let t = await thread(U.zed, o.id); assert.equal(t.request, true, "the thread says it will be a request before anything is sent");
  assert.equal((await say(U.zed, o.id, "call me on 415 555 0134")).code, "contact_info"); assert.equal((await say(U.zed, o.id, "you total asshole")).code, "language"); assert.equal((await photo(U.zed, o.id)).code, "request_pending");
  const m = await say(U.zed, o.id, "Hi Maya, loved your page. Menu here: https://example.com/x", { card: { type: "event", id: "dmSam" } }); assert.equal(m.status, 200); assert.equal(m.state, "request_out"); assert.equal(m.message.card, undefined, "no cards in a request");
  const again = await say(U.zed, o.id, "hello??"); assert.equal(again.status, 403); assert.equal(again.code, "request_pending"); assert.match(again.message, /once Maya accepts/); assert.equal((await photo(U.zed, o.id)).status, 403);
  t = await thread(U.zed, o.id); assert.equal(t.state, "request_out"); assert.equal(t.me.canWrite, false); assert.equal(t.plain, true); assert.equal(t.messages.length, 1);
  // Maya: under Requests, not in the list or the badge; a bell item and one email
  let L = await list(U.maya); assert.ok(!L.dms.some((d) => d.id === "dm/" + o.id)); assert.equal(L.requests.length, 1); assert.equal(L.requests[0].state, "request_in"); assert.equal(L.requests[0].last.text, "Hi Maya, loved your page. Menu here: (link)"); assert.ok(!L.dms.some((d) => d.unread && d.id === "dm/" + o.id));
  const b0 = bell(U.maya).find((n) => n.link === "/chats/dm/requests"); assert.ok(b0); assert.equal(b0.title, "Zed Vance wants to send you a message"); assert.equal(b0.preview || "", "", "the bell doesn't carry a stranger's words");
  await new Promise((r) => setTimeout(r, 30)); const mail = fakeOutbox.filter((e) => /wants to send you a message/.test(e.subject)); assert.equal(mail.length, 1); assert.deepEqual(mail[0].to, ["maya.dm@example.com"]); assert.ok(!/loved your page/.test(mail[0].text), "nor does the email");
  // she reads it: links stay plain, nothing is marked read, and Zed never sees Seen
  t = await thread(U.maya, o.id, "?read=1"); assert.equal(t.state, "request_in"); assert.equal(t.plain, true); assert.equal(t.me.canWrite, false); assert.equal(t.messages[0].text, "Hi Maya, loved your page. Menu here: https://example.com/x");
  await post(`/api/dm/${o.id}/read`, {}, U.maya.cookie); assert.equal((await thread(U.zed, o.id)).seen, null, "a request never shows Seen"); assert.equal((await say(U.maya, o.id, "hi")).code, "accept_first"); assert.equal((await post(`/api/dm/${o.id}/react`, { id: t.messages[0].id, emoji: "❤️" }, U.maya.cookie)).status, 403);
  // accept: an ordinary conversation from here
  assert.equal((await postJ(`/api/dm/${o.id}/accept`, {}, U.maya.cookie)).state, "open"); assert.equal((await post(`/api/dm/${o.id}/accept`, {}, U.maya.cookie)).status, 409); L = await list(U.maya); assert.equal(L.requests.length, 0); assert.ok(L.dms.some((d) => d.id === "dm/" + o.id));
  t = await thread(U.zed, o.id); assert.equal(t.state, "open"); assert.equal(t.plain, false); assert.equal(t.seen.id, t.messages[0].id); assert.equal((await say(U.zed, o.id, "thanks for accepting")).status, 200); assert.equal((await photo(U.zed, o.id)).status, 200);
  // delete: Ivy asks Sam; Sam deletes. Ivy isn't told, can't send more, and Sam's list is clean
  const o2 = await open(U.ivy, U.sam, { handle: "sam-dm" }); assert.equal((await say(U.ivy, o2.id, "Hello Sam")).status, 200); assert.equal((await list(U.sam)).requests.length, 1);
  assert.equal((await post(`/api/dm/${o2.id}/delete`, {}, U.sam.cookie)).status, 200); L = await list(U.sam); assert.equal(L.requests.length, 0); assert.equal(L.dms.length, 0);
  t = await thread(U.ivy, o2.id); assert.equal(t.state, "request_out", "it still reads as waiting"); assert.equal((await say(U.ivy, o2.id, "hello again")).code, "request_pending");
  // block from a request: Hal asks Sam; Sam blocks. Closed for both, gone from Sam's list, and it's a real safety block
  const o3 = await open(U.hal, U.sam, { handle: "sam-dm" }); await say(U.hal, o3.id, "Hey Sam"); assert.equal((await postJ(`/api/dm/${o3.id}/block`, {}, U.sam.cookie)).blocked, true);
  assert.ok((await getJ("/api/me/blocks", U.sam.cookie)).blocks.some((x) => x.target === "person:" + U.hal.key)); assert.equal((await list(U.sam)).requests.length, 0);
  t = await thread(U.hal, o3.id); assert.equal(t.state, "closed"); assert.equal(t.me.canWrite, false); assert.equal(t.me.readOnly, "You can't send messages in this conversation."); assert.equal((await say(U.hal, o3.id, "why")).code, "closed");
  await post(`/api/dm/${o3.id}/block`, { on: false }, U.sam.cookie);
});

test("block closes an open conversation both ways and hides it from the person who blocked", async () => {
  const o = await open(U.hal, U.gia); assert.equal((await say(U.gia, o.id, "hi Hal")).status, 200); assert.ok((await list(U.gia)).dms.some((d) => d.id === "dm/" + o.id));
  assert.equal((await post("/api/me/blocks", { kind: "person", key: U.hal.key, name: "Hal" }, U.gia.cookie)).status, 200); // the block every other page uses
  assert.ok(!(await list(U.gia)).dms.some((d) => d.id === "dm/" + o.id), "gone from the blocker's list"); assert.equal((await unread(U.gia)).chats, 0);
  for (const who of [U.hal, U.gia]) { const s = await say(who, o.id, "still there?"); assert.equal(s.status, 403); assert.equal(s.code, "closed"); assert.equal((await photo(who, o.id)).status, 403); }
  let t = await thread(U.hal, o.id); assert.equal(t.state, "closed"); assert.equal(t.why, "closed"); assert.ok(!/block/i.test(t.me.readOnly), "Hal isn't told he was blocked"); assert.ok((await list(U.hal)).dms.find((d) => d.id === "dm/" + o.id).readOnly);
  t = await thread(U.gia, o.id); assert.equal(t.why, "you_blocked"); assert.equal((await open(U.hal, U.gia)).state, "closed"); assert.equal(DM.may(U.hal.email, U.gia.email).code, "closed");
  assert.ok(!(await getJ("/api/dm/people", U.hal.cookie)).people.some((p) => p.name === "Gia Lund"));
  await fetch(`${srv.base}/api/me/blocks?target=${encodeURIComponent("person:" + U.hal.key)}`, { method: "DELETE", headers: { cookie: U.gia.cookie } }); assert.equal((await say(U.hal, o.id, "back")).status, 200);
});

test("report: through /api/report, with the last messages attached for the moderation queue", async () => {
  const o = await open(U.ivy, U.maya, { handle: "maya-dm" }); await say(U.ivy, o.id, "first"); await say(U.maya, o.id, "second"); const bad = await say(U.ivy, o.id, "something unkind"); const ph = await photo(U.ivy, o.id);
  assert.equal((await post("/api/report", { type: "message", target: `dm:${o.id}:${bad.message.id}`, reason: "hate" }, U.hal.cookie)).status, 404, "only the two people in it can report it");
  assert.equal((await post("/api/report", { type: "message", target: `dm:${o.id}:${bad.message.id}`, reason: "hate" })).status, 404); assert.equal((await post("/api/report", { type: "message", target: `dm:${o.id}:${"f".repeat(16)}`, reason: "hate" }, U.maya.cookie)).status, 404);
  const r = await post("/api/report", { type: "message", target: `dm:${o.id}:${bad.message.id}`, reason: "hate", text: "made up" }, U.maya.cookie); assert.equal(r.status, 200); const { id } = await r.json();
  const doc = srv.store.get("system/report-" + id).data; assert.equal(doc.text, "something unkind", "the server reads the words, not the browser"); assert.equal(doc.name, "Ivy Stone"); assert.equal(doc.about, "person:" + U.ivy.key);
  assert.deepEqual(doc.messages.map((m) => [m.by, m.text, !!m.reported]), [["Ivy Stone", "first", false], ["Reporter", "second", false], ["Ivy Stone", "something unkind", true], ["Ivy Stone", "Sent a photo", false]]); assert.match(doc.messages[3].photo, /^\/api\/dm\//);
  // the team sees it in the queue, can open the reported photo, and hiding it removes the message for both
  assert.equal((await get("/api/admin/reports", U.hal.cookie)).status, 404); const Q = await getJ("/api/admin/reports", U.mod.cookie); const row = Q.reports.find((x) => x.id === id); assert.equal(row.messages.length, 4); assert.equal(row.type, "message");
  assert.equal((await get(ph.message.photo.url, U.mod.cookie)).status, 200, "the team can see a photo in a reported thread"); assert.equal((await get(`/api/dm/${o.id}`, U.mod.cookie)).status, 404, "but never opens the thread itself");
  assert.equal((await post("/api/admin/reports/" + id, { action: "hide" }, U.mod.cookie)).status, 200); assert.equal((await thread(U.ivy, o.id)).messages.find((m) => m.id === bad.message.id).removed, true);
  // a whole conversation can be reported too
  const r2 = await post("/api/report", { type: "message", target: `dm:${o.id}`, reason: "spam" }, U.maya.cookie); assert.equal(r2.status, 200); assert.ok(srv.store.get("system/report-" + (await r2.json()).id).data.messages.length >= 3);
  assert.match(fs.readFileSync(new URL("../public/moderation.html", import.meta.url), "utf8"), /r\.messages/, "the queue page shows the attached messages");
});

test("rate limits: messages an hour, new conversations a day, requests a day (env)", async () => {
  assert.deepEqual(dmLimits({}), { perHour: 200, photosPerHour: 30, newPerDay: 30, requestsPerDay: 8 }); assert.equal(dmLimits({ ENCORE_DM_PER_HOUR: "5", ENCORE_DM_NEW_PER_DAY: "2", ENCORE_DM_REQUESTS_PER_DAY: "1", ENCORE_DM_PHOTOS_PER_HOUR: "3" }).requestsPerDay, 1);
  const o = await open(U.hal, U.maya, { handle: "maya-dm" }); process.env.ENCORE_DM_PER_HOUR = "3"; DM.resetLimits();
  for (let i = 0; i < 3; i++) assert.equal((await say(U.hal, o.id, "m" + i)).status, 200); const slow = await say(U.hal, o.id, "m4"); assert.equal(slow.status, 429); assert.equal(slow.code, "rate_limited"); delete process.env.ENCORE_DM_PER_HOUR; DM.resetLimits();
  // new conversations a day: Kit has started none, and may start two
  const kit = await join("Kit Reed", "kit.dm@example.com"); went(U.maya, "dmDinner", kit); process.env.ENCORE_DM_NEW_PER_DAY = "2";
  for (const to of [U.maya, U.gia]) { const x = await open(kit, to); assert.equal((await say(kit, x.id, "hello")).status, 200); } const x3 = await open(kit, U.hal); const s3 = await say(kit, x3.id, "hello"); assert.equal(s3.status, 429); assert.match(s3.message, /tomorrow/);
  assert.equal((await say(kit, (await open(kit, U.maya)).id, "more to someone I already talk to")).status, 200, "the cap is on new conversations only"); delete process.env.ENCORE_DM_NEW_PER_DAY;
  // requests to people you don't know: a smaller cap
  process.env.ENCORE_DM_REQUESTS_PER_DAY = "1"; const lee = await join("Lee Park", "lee.dm@example.com"); const a = await open(lee, U.maya, { handle: "maya-dm" }); assert.equal((await say(lee, a.id, "hello Maya")).status, 200);
  const b = await open(lee, U.sam, { handle: "sam-dm" }); const sb = await say(lee, b.id, "hello Sam"); assert.equal(sb.status, 429); assert.match(sb.message, /requests today/);
  const doc = fs.readFileSync(new URL("../docs/launch-checklist.md", import.meta.url), "utf8"); for (const k of ["ENCORE_DM_PER_HOUR", "ENCORE_DM_NEW_PER_DAY", "ENCORE_DM_REQUESTS_PER_DAY", "ENCORE_DM_PHOTOS_PER_HOUR"]) assert.ok(doc.includes(k), k + " is in the launch checklist");
});

test("a story reply starts or continues the DM with the story as a card; reactions and answers are small rows", async () => {
  const media = async (who) => { const r = await fetch(`${srv.base}/api/story/media?as=image`, { method: "POST", headers: { "content-type": "image/jpeg", cookie: who.cookie }, body: JPG }); return (await r.json()).url; };
  const made = await postJ("/api/story", { slides: [{ url: await media(U.maya), dur: 5000, stickers: [{ id: "q", t: "question", x: 0.5, y: 0.5, prompt: "What should I cook?" }] }] }, U.maya.cookie); X.bust(); const sid = made.ids[0]; assert.ok(sid, JSON.stringify(made));
  // Gia (a guest of Maya's) replies: it lands in their conversation, quoting the story
  const before = (await thread(U.maya, P.gm)).messages.length, r = await post(`/api/story/${sid}/reply`, { text: "Save me a seat" }, U.gia.cookie), j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j)); assert.equal(j.dm, P.gm);
  let t = await thread(U.maya, P.gm); assert.equal(t.messages.length, before + 1); const m = t.messages[t.messages.length - 1]; assert.equal(m.text, "Save me a seat"); assert.equal(m.card.type, "story"); assert.equal(m.card.reply, true); assert.equal(m.card.url, "/feed?st=" + sid); assert.equal(m.card.title, "Your story");
  assert.equal((await thread(U.gia, P.gm)).messages.at(-1).card.title, "Maya's story"); assert.ok(bell(U.maya).some((n) => n.link === "/chats/dm/" + P.gm && !n.read), "the DM's own bell item, not a second story note"); assert.ok(!X.inbox(U.maya.email).some((n) => /replied to your story/.test(n.text || "")));
  // a reaction and a question answer: one compact row each, the bell batching for stories stays as it was
  await post(`/api/story/${sid}/react`, { emoji: "🔥" }, U.gia.cookie); await post(`/api/story/${sid}/answer`, { sticker: "q", text: "Dan dan noodles" }, U.gia.cookie);
  t = await thread(U.maya, P.gm); const notes = t.messages.filter((x) => x.kind === "note"); assert.deepEqual(notes.map((n) => n.text), ["Reacted 🔥 to your story", 'Answered "What should I cook?": Dan dan noodles']); assert.equal(notes[0].card.url, "/feed?st=" + sid);
  assert.equal((await thread(U.gia, P.gm)).messages.filter((x) => x.kind === "note")[0].text, "You reacted 🔥 to their story"); assert.ok(X.inbox(U.maya.email).some((n) => n.kind === "story" && /reacted 🔥 to your story/.test(n.text)), "the story's own batched note is still there");
  await post(`/api/story/${sid}/react`, { emoji: "🙌" }, U.gia.cookie); assert.deepEqual((await thread(U.maya, P.gm)).messages.filter((x) => x.kind === "note" && /Reacted/.test(x.text)).map((n) => n.text), ["Reacted 🙌 to your story"], "a changed reaction changes its row");
  await post(`/api/story/${sid}/react`, { emoji: "🙌" }, U.gia.cookie); assert.equal((await thread(U.maya, P.gm)).messages.filter((x) => /Reacted/.test(x.text)).length, 0, "taking it back takes the row away");
  // a stranger's reply is a request, with the story named but no picture; their second one waits; their reaction makes no thread
  const lou = await join("Lou Hart", "lou.dm@example.com"); const s1 = await postJ(`/api/story/${sid}/reply`, { text: "Looks great" }, lou.cookie); assert.equal(s1.request, true);
  const req = (await list(U.maya)).requests.find((x) => x.title === "Lou Hart"); assert.ok(req); const rt = await thread(U.maya, req.id.slice(3)); assert.equal(rt.messages[0].card.title, "Your story"); assert.equal(rt.messages[0].card.img, undefined);
  const s2 = await post(`/api/story/${sid}/reply`, { text: "Hello?" }, lou.cookie); assert.equal(s2.status, 403); assert.match((await s2.json()).message, /once Maya accepts/);
  const n0 = srv.store.listPrefix("system", "dmm-").length; await post(`/api/story/${sid}/react`, { emoji: "🔥" }, lou.cookie); assert.equal(srv.store.listPrefix("system", "dmm-").length, n0);
  // a story shared as a card; when the story is gone the card says so and opens nothing
  const c = await say(U.maya, P.gm, "", { card: { type: "story", id: sid } }); assert.equal(c.message.card.url, "/feed?st=" + sid);
  assert.equal((await fetch(`${srv.base}/api/story/${sid}`, { method: "DELETE", headers: { cookie: U.maya.cookie } })).status, 200);
  t = await thread(U.gia, P.gm); for (const x of t.messages.filter((y) => y.card?.type === "story")) { assert.equal(x.card.gone, true); assert.equal(x.card.title, "Story no longer available"); assert.equal(x.card.url, undefined); }
});

test("notifications: one bell item per unread streak, a push through the bell, an email after a long unread, never by text", async () => {
  const push = (await import("../server/push.js")).PUSH_KINDS; assert.ok(push.replies.kinds.includes("dm"), "DMs follow the Replies and messages push setting");
  const o = await open(U.hal, U.maya, { handle: "maya-dm" }); await post(`/api/dm/${o.id}/read`, {}, U.maya.cookie); const n0 = bell(U.maya).filter((n) => n.link === "/chats/dm/" + o.id).length;
  await say(U.hal, o.id, "one"); await say(U.hal, o.id, "two"); await say(U.hal, o.id, "three"); let B = bell(U.maya).filter((n) => n.link === "/chats/dm/" + o.id); assert.equal(B.length, n0 + 1, "three messages, one row"); assert.match(B[0].title, /new messages from Hal Moss/); assert.equal(B[0].preview, "three");
  await post(`/api/dm/${o.id}/read`, {}, U.maya.cookie); assert.equal(bell(U.maya).filter((n) => n.link === "/chats/dm/" + o.id && !n.read).length, 0); await say(U.hal, o.id, "four"); assert.equal(bell(U.maya).filter((n) => n.link === "/chats/dm/" + o.id).length, n0 + 2, "after reading, the next message is a new row");
  // the Inbox shows it as a chat row with the sender's name and no email
  const I = await getJ("/api/inbox?filter=chats", U.maya.cookie), row = I.groups.flatMap((g) => g.items).find((x) => x.link === "/chats/dm/" + o.id); assert.ok(row); assert.equal(row.type, "chat"); assert.equal(row.actor.name, "Hal Moss"); assert.ok(!JSON.stringify(I).includes("hal.dm@"));
  // email: nothing while it's fresh; one after DM_EMAIL_AFTER unread; not a second the same day
  fakeOutbox.length = 0; assert.equal((await DM.runDigest()).sent, 0); const later = Date.now() + DM_EMAIL_AFTER + 60e3; await DM.runDigest(later); const fromHal = () => fakeOutbox.filter((e) => /from Hal Moss/.test(e.subject) && e.to.includes("maya.dm@example.com")); assert.equal(fromHal().length, 1); assert.equal(fromHal()[0].subject, "A message from Hal Moss"); assert.deepEqual(fromHal()[0].to, ["maya.dm@example.com"]); assert.ok(!/four/.test(fromHal()[0].text), "the email doesn't carry the words");
  assert.equal((await DM.runDigest(later + 3600e3)).sent, 0, "at most one a day per conversation"); await post("/api/me/prefs", { emails: false }, U.maya.cookie); await DM.runDigest(later + 26 * 3600e3); assert.equal(fromHal().length, 1, "emails off in Settings"); await post("/api/me/prefs", { emails: true }, U.maya.cookie);
  // Potto by text never carries a DM
  const pt = fs.readFileSync(new URL("../server/pottotext.js", import.meta.url), "utf8"); assert.ok(!/kind === "dm"/.test(pt)); assert.match(pt, /n\.kind === "reply"/);
});

test("account deletion removes the person's messages and their photos, and their story files", async () => {
  const tom = await join("Tom Ash", "tom.dm@example.com"); went(U.maya, "dmDinner", tom); await page(tom, "tom-dm", "Tom's place");
  const o = await open(tom, U.gia); await say(tom, o.id, "from Tom"); await say(U.gia, o.id, "from Gia"); const ph = await photo(tom, o.id); const blob = ph.message.photo.url.split("/").pop(); assert.ok(fs.existsSync(path.join(srv.dir, "assets", blob)));
  const o2 = await open(tom, U.hal); await say(tom, o2.id, "only Tom wrote here");
  const up = await (await fetch(`${srv.base}/api/story/media?as=image`, { method: "POST", headers: { "content-type": "image/jpeg", cookie: tom.cookie }, body: JPG })).json(); const st = await postJ("/api/story", { slides: [{ url: up.url, dur: 5000 }] }, tom.cookie); assert.ok(st.ids?.[0]); const sfile = path.join(srv.dir, "assets", up.url.split("/").pop()); assert.ok(fs.existsSync(sfile));
  // a second member keeps the workspace (and every file saved under it) alive, so the files below only go if deletion names them
  putDbUser({ ...getDbUser(tom.email), email: "tom2.dm@example.com", name: "Tom Two", owner: false });
  const r = await post("/api/me/delete", { confirm: "DELETE", when: "now" }, tom.cookie); assert.equal(r.status, 200); const j = await r.json(); assert.equal(j.messages, 3);
  assert.ok(!fs.existsSync(path.join(srv.dir, "assets", blob)), "the DM photo file is gone"); assert.ok(!fs.existsSync(sfile), "and the story's image file"); assert.equal(srv.store.get("system/pstory-" + st.ids[0]), null);
  const left = srv.store.listPrefix("system", "dmm-" + o.id).map((d) => d.data); assert.deepEqual(left.map((m) => m.text), ["from Gia"]); assert.ok(!JSON.stringify(srv.store.listPrefix("system", "dm")).includes("tom.dm@"), "no trace of the email in any DM doc");
  const t = await thread(U.gia, o.id); assert.equal(t.state, "closed"); assert.equal(t.why, "gone"); assert.equal(t.peer.name, "Deleted account"); assert.equal(t.me.readOnly, "This person deleted their account."); assert.deepEqual(t.messages.map((m) => m.text), ["from Gia"]);
  assert.equal(srv.store.get("system/dm-" + o2.id), null, "a thread with nothing left is removed"); assert.ok(!(await list(U.hal)).dms.some((d) => d.id === "dm/" + o2.id));
});

// ---- two people in a browser: from a host page to a conversation, a request, and a story reply ----
for (const W of [390, 1280]) test(`browser walk at ${W}: Message on a host page, text, a photo, an event card, a reaction, a quote reply, unread, a request, a story reply`, { timeout: 240000 }, async (t) => {
  let pw; try { pw = createRequire(import.meta.url)("playwright"); } catch { return t.skip("playwright is not installed"); }
  let browser; try { browser = await pw.chromium.launch(); } catch { return t.skip("no Chromium here"); }
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true }); const shot = async (pg, name) => { if (SHOTS) { await pg.waitForTimeout(250); await pg.screenshot({ path: path.join(SHOTS, `${name}-${W}.png`) }); } };
  const touch = W === 390, ana = await join("Ana Ruiz", `ana${W}.dm@example.com`), ben = await join("Ben Okafor", `ben${W}.dm@example.com`), cy = await join("Cy Stranger", `cy${W}.dm@example.com`), EV = `dmW${W}`, handle = `ana-dm-${W}`;
  await page(ana, handle, "Ana's table"); await ev(EV, { name: "Noodle night" }, ana); went(ana, EV, ben); DM.resetLimits(); M.resetLimits();
  const ctxFor = async (who) => { const ctx = await browser.newContext(touch ? { ...pw.devices["iPhone 13"], viewport: { width: 390, height: 844 }, reducedMotion: "reduce", serviceWorkers: "block" } : { viewport: { width: 1280, height: 800 }, reducedMotion: "reduce", serviceWorkers: "block" });
    await ctx.addCookies(who.cookie.split("; ").map((kv) => { const i = kv.indexOf("="); return { name: kv.slice(0, i), value: kv.slice(i + 1), url: srv.base }; }).concat([{ name: "encore_in", value: "1", url: srv.base }]));
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, body: "" })); return ctx; };
  const errs = []; const watch = (pg, who) => { pg.on("pageerror", (e) => errs.push(`${who} pageerror ${e.message}`)); pg.on("console", (m) => { if (m.type() === "error") errs.push(`${who} console ${m.text()}`); }); pg.on("requestfailed", (r) => { if (r.url().startsWith(srv.base) && !/ERR_ABORTED/.test(r.failure()?.errorText || "")) errs.push(`${who} failed ${r.url()}`); });
    pg.on("response", (r) => { if (r.status() >= 400 && r.url().startsWith(srv.base)) errs.push(`${who} ${r.status()} ${r.url()}`); }); };
  const tapOn = (pg, sel) => (touch ? pg.tap(sel) : pg.click(sel));
  // the composer sits inside the window, above nothing; the last message is fully in view; nothing scrolls sideways; controls are big enough
  const fits = (pg) => pg.evaluate(() => { const out = [], c = (document.querySelector("#chComp") || document.querySelector("#chReq") || document.querySelector(".ch-ro")).getBoundingClientRect(), L = [...document.querySelectorAll("#chMsgs .ch-m, #chMsgs .ch-sys")].pop()?.getBoundingClientRect();
    if (c.bottom > innerHeight + 1 || c.top < 0) out.push(`composer off screen ${Math.round(c.top)}-${Math.round(c.bottom)} of ${innerHeight}`); if (L && (L.bottom > c.top + 1 || L.top < 0)) out.push(`last message hidden ${Math.round(L.top)}-${Math.round(L.bottom)} vs composer ${Math.round(c.top)}`);
    if (document.documentElement.scrollWidth > innerWidth + 1) out.push("sideways scroll");
    for (const b of document.querySelectorAll("#chCompWrap button, #chCompWrap label.ch-icon, .ch-thead button, .ch-thead a")) { const r = b.getBoundingClientRect(); if (r.width && (r.width < 43.5 || r.height < 43.5)) out.push(`small ${b.getAttribute("aria-label") || b.textContent.trim()} ${Math.round(r.width)}x${Math.round(r.height)}`);
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); if (r.width && top && !(b.contains(top) || top.contains(b))) out.push(`covered ${b.getAttribute("aria-label") || b.textContent.trim()}`); }
    const H = [...document.querySelectorAll("#chCompWrap .ch-req-b .ch-btn")].map((b) => Math.round(b.getBoundingClientRect().height)); if (new Set(H).size > 1) out.push("request buttons differ in height " + H.join("/")); return out; });
  const sendText = async (pg, text) => { await pg.fill("#chIn", text); await tapOn(pg, "#chSend"); await pg.waitForFunction((x) => [...document.querySelectorAll(".ch-grp.me .ch-m:not(.pending) .ch-b")].some((b) => b.textContent.includes(x)), text); };
  const press = (pg, id) => pg.evaluate((id) => { const b = document.querySelector(".ch-grp:not(.me) .ch-m .ch-b"), r = b.getBoundingClientRect(); b.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [new Touch({ identifier: id, target: b, clientX: r.x + 10, clientY: r.y + 10 })] })); }, id);
  try {
    // ---- Ben, a guest, opens Ana's page and taps Message ----
    const cb = await ctxFor(ben), pb = await cb.newPage(); watch(pb, "ben"); await pb.goto(`${srv.base}/@${handle}`); await pb.waitForSelector("#topMsg");
    const hb = await pb.$$eval("#topFollow, #topMsg, #shareBtn", (L) => L.map((b) => Math.round(b.getBoundingClientRect().height))); assert.equal(hb.length, 3); assert.equal(new Set(hb).size, 1, "buttons in the row share a height: " + hb.join("/")); assert.ok(hb[0] >= 44);
    assert.notEqual(await pb.$eval("#topMsg", (b) => getComputedStyle(b).backgroundColor), await pb.$eval("#topFollow", (b) => getComputedStyle(b).backgroundColor), "Follow stays the one primary; Message is a quiet button");
    await shot(pb, "01-host-page"); await tapOn(pb, "#topMsg"); await pb.waitForURL(/\/chats\/dm\/[a-f0-9]{24}$/); await pb.waitForSelector("#chIn"); const tid = pb.url().split("/").pop();
    assert.match(await pb.$eval("#chMsgs", (e) => e.textContent), /Say hi to Ana\. Only the two of you can read this\./); assert.equal(await pb.$eval(".ch-thead b", (e) => e.textContent), "Ana Ruiz"); assert.deepEqual(await fits(pb), []);
    await sendText(pb, "Hi Ana, is there room for one more?"); await pb.setInputFiles("#chFile", { name: "bowl.png", mimeType: "image/png", buffer: PNG }); await pb.waitForSelector(".ch-grp.me .ch-m:not(.pending) .ch-ph img"); assert.match(await pb.$eval(".ch-grp.me .ch-m:not(.pending) .ch-ph img", (i) => i.getAttribute("src")), /^\/api\/dm\//);
    await pb.waitForFunction(() => { const i = document.querySelector(".ch-grp.me .ch-m:not(.pending) .ch-ph img"); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 }); // the photo loads through the thread
    await tapOn(pb, "#chShare"); await pb.waitForSelector(".ch-sheet .ch-pbtn"); await shot(pb, "02-share-sheet"); await tapOn(pb, ".ch-sheet .ch-pbtn"); await pb.waitForSelector("#chMsgs a.ch-card"); assert.equal(await pb.$eval("#chMsgs a.ch-card", (a) => a.getAttribute("href")), "/e/" + EV); assert.match(await pb.$eval("#chMsgs a.ch-card b", (b) => b.textContent), /Noodle night/);
    await pb.waitForTimeout(400); assert.deepEqual(await fits(pb), []); await shot(pb, "03-thread-ben");
    // the keyboard open (a shorter window): the composer rides up and the last message stays in view
    if (touch) { await pb.focus("#chIn"); await pb.setViewportSize({ width: 390, height: 420 }); await pb.waitForTimeout(450); assert.deepEqual(await fits(pb), [], "with the keyboard up"); await shot(pb, "04-keyboard"); await pb.setViewportSize({ width: 390, height: 664 }); await pb.waitForTimeout(300); assert.deepEqual(await fits(pb), [], "on a short phone"); await shot(pb, "04-short"); await pb.setViewportSize({ width: 390, height: 844 }); }
    // ---- Ana sees it unread: the tab badge, the row, then the thread ----
    const ca = await ctxFor(ana), pa = await ca.newPage(); watch(pa, "ana"); await pa.goto(srv.base + (touch ? "/chats" : "/feed")); if (!touch) { await pa.waitForFunction(() => [...document.querySelectorAll("[data-chats-badge]")].some((b) => !b.hidden && b.textContent === "1"), null, { timeout: 15000 }); await pa.goto(srv.base + "/chats/dm/requests"); await pa.waitForSelector("#chRows .ch-empty"); await pa.click("#chReqBack"); }
    await pa.waitForSelector(`.ch-row.ch-dm[data-id="dm/${tid}"]`); assert.match(await pa.$eval(`.ch-row[data-id="dm/${tid}"]`, (r) => r.className), /unread/); assert.equal(await pa.$eval(`.ch-row[data-id="dm/${tid}"] .ch-n`, (b) => b.textContent), "3");
    if (touch) await pa.waitForFunction(() => [...document.querySelectorAll("[data-chats-badge]")].some((b) => !b.hidden && b.textContent === "1"), null, { timeout: 15000 });
    assert.match(await pa.$eval(`.ch-row[data-id="dm/${tid}"] .ch-kind`, (b) => b.textContent), /Direct message/); assert.match(await pa.$eval(".ch-row:not(.ch-dm):not(.ch-reqrow):not(.ch-linkrow) .ch-kind", (b) => b.textContent), /Event chat/, "each row says which kind it is"); await shot(pa, "05-list-ana");
    await tapOn(pa, `.ch-row[data-id="dm/${tid}"]`); await pa.waitForSelector(".ch-grp:not(.me) .ch-m .ch-b"); assert.equal(await pa.$eval(".ch-thead b", (e) => e.textContent), "Ben Okafor");
    if (touch) { await pa.goBack(); } await pa.waitForFunction(() => !document.querySelector(".ch-row.ch-dm.unread"), null, { timeout: 20000 }); if (touch) { await tapOn(pa, `.ch-row[data-id="dm/${tid}"]`); await pa.waitForSelector(".ch-grp:not(.me) .ch-m .ch-b"); } // opening it reads it
    // react: the message menu (long-press on a phone, the hover tools with a mouse)
    if (touch) await press(pa, 1); else { await pa.hover(".ch-grp:not(.me) .ch-m .ch-b"); await pa.click(".ch-grp:not(.me) .ch-m [data-tool=more]"); }
    await pa.waitForSelector(".ch-sheet .ch-react"); await shot(pa, "06-message-menu"); await tapOn(pa, '.ch-sheet [data-e="❤️"]'); await pa.waitForSelector(".ch-grp:not(.me) .ch-rx button.mine");
    // quote reply
    if (touch) { await pa.evaluate(() => document.dispatchEvent(new TouchEvent("touchend", { bubbles: true }))); await press(pa, 2); await pa.waitForSelector('.ch-sheet [data-a="reply"]'); await tapOn(pa, '.ch-sheet [data-a="reply"]'); }
    else { await pa.hover(".ch-grp:not(.me) .ch-m .ch-b"); await pa.click(".ch-grp:not(.me) .ch-m [data-tool=reply]"); }
    await pa.waitForSelector(".ch-replying"); await sendText(pa, "Yes, come!"); assert.match(await pa.$eval(".ch-grp.me .ch-b .ch-q", (q) => q.textContent), /Hi Ana, is there room/); await pa.waitForTimeout(400); assert.deepEqual(await fits(pa), []); await shot(pa, "07-thread-ana");
    // ---- Ben gets the reply, with the heart and Seen on his side ----
    await pb.waitForFunction(() => [...document.querySelectorAll(".ch-grp:not(.me) .ch-b")].some((b) => b.textContent.includes("Yes, come!")), null, { timeout: 20000 }); assert.ok(await pb.$(".ch-grp.me .ch-rx button"), "Ana's heart shows for Ben"); await sendText(pb, "See you there");
    await pb.waitForFunction(() => document.querySelector(".ch-seen")?.textContent === "Seen", null, { timeout: 25000 }); await shot(pb, "08-seen");
    // the details: mute, delete, block and report are all there
    await tapOn(pb, ".ch-thead button.ch-icon[data-det]"); await pb.waitForSelector(".ch-sheet #chMute"); assert.deepEqual(await pb.$$eval(".ch-sheet [data-d]", (L) => L.map((b) => b.textContent.trim())), ["Delete conversation", "Block Ana", "Report"]); await shot(pb, "09-details"); await pb.keyboard.press("Escape"); await pb.waitForFunction(() => !document.querySelector(".ch-sheet"));
    // ---- Cy, a stranger: the thread says it will be a request; one message; then it waits ----
    const cc = await ctxFor(cy), pc = await cc.newPage(); watch(pc, "cy"); await pc.goto(`${srv.base}/@${handle}`); await pc.waitForSelector("#topMsg"); await tapOn(pc, "#topMsg"); await pc.waitForURL(/\/chats\/dm\//); await pc.waitForSelector("#chIn");
    assert.match(await pc.$eval("#chMsgs", (e) => e.textContent), /goes to them as a request/); assert.equal(await pc.$("#chFile"), null, "no photos in a request"); await sendText(pc, "Hi Ana, a friend told me about your dinners https://example.com/cy");
    await pc.waitForSelector(".ch-ro"); assert.match(await pc.$eval(".ch-ro", (e) => e.textContent), /You can send more once Ana accepts/); assert.equal(await pc.$("#chMsgs .ch-b a"), null, "the link is plain text"); assert.deepEqual(await fits(pc), []); await shot(pc, "10-request-sent");
    // ---- Ana: Requests, the preview, Accept ----
    await pa.goto(srv.base + "/chats"); await pa.waitForSelector(".ch-reqrow"); await shot(pa, "11-list-with-requests"); await tapOn(pa, ".ch-reqrow"); await pa.waitForURL(/\/chats\/dm\/requests$/); await pa.waitForSelector(".ch-row.ch-dm"); assert.equal(await pa.$eval("#chHead", (h) => h.textContent), "Requests"); await shot(pa, "12-requests");
    await tapOn(pa, ".ch-row.ch-dm"); await pa.waitForSelector("#chReq"); assert.equal(await pa.$("#chMsgs .ch-b a"), null, "no links render before she accepts"); assert.equal(await pa.$("#chIn"), null); assert.deepEqual(await pa.$$eval("#chReq .ch-btn", (L) => L.map((b) => b.textContent)), ["Accept", "Delete", "Block"]); assert.equal(await pa.$$eval("#chReq .ch-btn.primary", (L) => L.length), 1);
    await pa.waitForTimeout(400); assert.deepEqual(await fits(pa), []); await shot(pa, "13-request-preview"); await tapOn(pa, '#chReq [data-req="accept"]'); await pa.waitForSelector("#chIn"); assert.ok(await pa.$("#chMsgs .ch-b a"), "links work once accepted"); await sendText(pa, "Welcome, Cy"); await shot(pa, "14-accepted");
    await pc.waitForFunction(() => !!document.querySelector("#chIn"), null, { timeout: 25000 });
    // ---- a story reply lands in the thread, quoting the story ----
    const up = await (await fetch(`${srv.base}/api/story/media?as=image`, { method: "POST", headers: { "content-type": "image/png", cookie: ana.cookie }, body: png(108, 192, [60, 90, 160]) })).json(); const st = await postJ("/api/story", { slides: [{ url: up.url, dur: 15000 }] }, ana.cookie); X.bust(); assert.ok(st.ids?.[0], JSON.stringify(st));
    await pb.goto(`${srv.base}/feed?st=${st.ids[0]}`); await pb.waitForSelector("#svRe", { timeout: 20000 }); await pb.fill("#svRe", "Save me a bowl"); await pb.keyboard.press("Enter"); await pb.waitForFunction(() => /in your chats with/.test(document.querySelector("[data-sv-msg]")?.textContent || ""), null, { timeout: 10000 }); await shot(pb, "15-story-reply");
    await pa.goto(`${srv.base}/chats/dm/${tid}`); await pa.waitForSelector("#chMsgs a.ch-card.story"); assert.equal(await pa.$eval("#chMsgs a.ch-card.story", (a) => a.getAttribute("href")), "/feed?st=" + st.ids[0]); assert.match(await pa.$eval("#chMsgs", (e) => e.textContent), /Replied to your story[\s\S]*Save me a bowl/); await pa.waitForTimeout(400); assert.deepEqual(await fits(pa), []); await shot(pa, "16-story-card");
    assert.equal((await fetch(`${srv.base}/api/story/${st.ids[0]}`, { method: "DELETE", headers: { cookie: ana.cookie } })).status, 200); await pa.reload(); await pa.waitForSelector("#chMsgs .ch-card.gone"); assert.equal(await pa.$eval("#chMsgs .ch-card.gone", (e) => e.textContent), "Story no longer available"); await shot(pa, "17-story-gone");
    // New message: only people she may write to, searchable
    await pa.goto(srv.base + "/chats"); await pa.waitForSelector("#chNew:not([hidden])"); await tapOn(pa, "#chNew"); await pa.waitForSelector(".ch-sheet .ch-pbtn"); const names = await pa.$$eval(".ch-sheet .ch-pbtn", (L) => L.map((b) => b.textContent)); assert.ok(names.some((n) => /Ben Okafor/.test(n))); assert.ok(!(await pa.evaluate(() => document.activeElement?.id === "chPq")), "the search box isn't focused for you, so the keyboard doesn't jump up");
    await pa.fill("#chPq", "ben"); await pa.waitForFunction(() => document.querySelectorAll(".ch-sheet .ch-pbtn").length === 1); await shot(pa, "18-new-message"); await tapOn(pa, ".ch-sheet .ch-pbtn"); await pa.waitForURL(new RegExp(`/chats/dm/${tid}$`));
    assert.deepEqual(errs, [], "console clean, no failed requests");
  } finally { await browser.close(); }
});
