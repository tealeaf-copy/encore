// The story composer (public/storycomposer.js, server/storymake.js) and the viewer's live stickers (public/storyview.js):
// the server's rules first (with and without an event, who may see what, one vote each, replies for the author only,
// seen by for the author only, delete, the rate limit, sticker data cleaned, links only to what the author may link),
// then a browser walk at 390 (touch) and 1280 from the ring to a reply.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { cleanSticker, STORY_LIMITS } from "../server/storymake.js";

const SHOTS = process.env.STORY_SHOTS || "";
let srv, X, M;
const J = { "content-type": "application/json" };
const post = (p, body, cookie) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body || {}) });
const del = (p, cookie) => fetch(srv.base + p, { method: "DELETE", headers: cookie ? { cookie } : {} });
const get = (p, cookie) => fetch(srv.base + p, { headers: cookie ? { cookie } : {} });
const getJ = async (p, cookie) => (await get(p, cookie)).json();
const put = (p, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + p, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
const day = (n) => { const d = new Date(Date.now() + n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const keyOf = (email) => Buffer.from(email).toString("base64url");
// a real PNG the browser can decode (w by h, one colour)
function png(w, h, [r, g, b]) { const crc = (buf) => { let c, n = ~0; for (const x of buf) { c = (n ^ x) & 255; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; n = (n >>> 8) ^ c; } return ~n >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2; const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).map((_, i) => [r, g, b][i % 3])]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk("IEND", Buffer.alloc(0))]); }
const PNG = png(8, 8, [200, 80, 40]), JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypmp42"), Buffer.alloc(40)]);
const join = async (name, email) => { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); const b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); return { cookie: cookieOf(r), ws: b.workspace.id, email, name, key: keyOf(email) }; };
const went = (host, eventId, who) => srv.store.set(`ws/${host.ws}/rsvps/r-${eventId}-${who.email.split("@")[0].replace(/\W/g, "")}`, { response: "going", createdAt: Date.now() - 5 * 864e5, eventId, name: who.name, email: who.email, code: "C" + eventId });
const ev = (id, extra, host) => put("events/" + id, { kind: "social", casual: true, activity: "dinner", published: true, discoverable: true, date: day(-2), ...extra }, host.cookie).then((r) => assert.equal(r.status, 200, id));
const media = async (who, as = "image", body = JPG, ct = "image/jpeg", q = "") => { const r = await fetch(`${srv.base}/api/story/media?as=${as}${q}`, { method: "POST", headers: { "content-type": ct, cookie: who.cookie }, body }); const j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j)); return j.url; };
const make = async (who, body = {}, slides = 1) => { const S = []; for (let i = 0; i < slides; i++) S.push({ url: await media(who), dur: 5000, ...(body.slide || {}) }); const { slide, ...rest } = body; const r = await post("/api/story", { slides: S, ...rest }, who.cookie), j = await r.json(); X.bust(); return { status: r.status, ...j }; };
const rings = async (cookie) => (cookie ? (await getJ("/api/feed/stories", cookie)).stories : (await getJ("/api/public/feed?x=" + Math.random())).stories);
const ring = async (handle, cookie) => (await rings(cookie)).find((s) => s.host?.handle === handle && !s.showcase) || null;
const sids = async (handle, cookie) => ((await ring(handle, cookie))?.items || []).filter((i) => i.st).map((i) => i.st.sid);
const U = {};

before(async () => {
  srv = await startServer(); X = srv.app.locals.social; M = srv.app.locals.storyMake;
  Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "sc-secret", ENCORE_SIGNUP_PER_HOUR: "400", ENCORE_FAKE_EMAIL: "1" }); resetLoginLimits();
  U.mai = await join("Mai Pham", "mai.sc@example.com"); U.linh = await join("Linh Tran", "linh.sc@example.com"); U.jun = await join("Jun Park", "jun.sc@example.com"); U.zed = await join("Zed New", "zed.sc@example.com"); U.gus = await join("Gus Guest", "gus.sc@example.com");
  assert.ok((await post("/api/host/profile", { handle: "mai-sc", name: "Mai's supper club", tagline: "Small dinners.", emoji: "🍜" }, U.mai.cookie)).ok);
  assert.ok((await post("/api/host/profile", { handle: "linh-sc", name: "Linh Tran" }, U.linh.cookie)).ok);
  assert.ok((await post("/api/host/profile", { handle: "gus-sc", name: "Gus" }, U.gus.cookie)).ok);
  await ev("scNext", { name: "Dumpling Night", date: day(6), startTime: "19:00" }, U.mai); await ev("scPast", { name: "Board game night", date: day(-2) }, U.mai); await ev("scPriv", { name: "Quiet supper", discoverable: false, date: day(-2) }, U.mai);
  await ev("scLinh", { name: "Linh's picnic", date: day(3) }, U.linh);
  for (const id of ["scNext", "scPast", "scPriv"]) went(U.mai, id, U.linh); went(U.mai, "scPast", U.gus);
  // Jun follows Mai's page; Mai adds Linh as a friend
  assert.equal((await post("/api/public/follow", { handle: "mai-sc" }, U.jun.cookie)).status, 200); assert.equal((await post("/api/me/friends", { key: U.linh.key }, U.mai.cookie)).status, 200);
  X.bust();
});
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "sc-secret"; resetLoginLimits(); M.resetLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL", "STORY_PER_HOUR"]) delete process.env[k]; await srv.close(); });

const P = {};
test("a story needs no event: it goes on its author's ring for a day, and a file it didn't upload can't be used", async () => {
  assert.equal((await get("/api/story/compose")).status, 401); assert.equal((await post("/api/story", { slides: [] })).status, 401);
  const C0 = await getJ("/api/story/compose", U.mai.cookie); assert.equal(C0.reach, "public"); assert.equal(C0.limits.slides, STORY_LIMITS.slides); assert.equal(C0.limits.seconds, 30);
  assert.deepEqual(C0.events.map((e) => e.ev).sort(), ["scNext", "scPast", "scPriv"]); assert.equal(C0.events[0].ev, "scNext", "what's coming first");
  assert.equal((await post("/api/story", { slides: [] }, U.mai.cookie)).status, 400);
  assert.equal((await post("/api/story", { slides: [{ url: "/_blob/AAAAAAAAAAAAAAAAAAAA" }] }, U.mai.cookie)).status, 400, "a blob that isn't a story upload of mine");
  const other = await media(U.linh); assert.equal((await post("/api/story", { slides: [{ url: other }] }, U.mai.cookie)).status, 400, "nor someone else's upload");
  // files: the type is read from the bytes
  assert.equal((await fetch(srv.base + "/api/story/media?as=image", { method: "POST", headers: { "content-type": "image/jpeg", cookie: U.mai.cookie }, body: Buffer.from("not a photo at all") })).status, 415);
  assert.equal((await fetch(srv.base + "/api/story/media?as=overlay", { method: "POST", headers: { "content-type": "image/jpeg", cookie: U.mai.cookie }, body: JPG })).status, 415, "an overlay is a PNG");
  assert.equal((await fetch(srv.base + "/api/story/media?as=video&duration=75", { method: "POST", headers: { "content-type": "video/mp4", cookie: U.mai.cookie }, body: MP4 })).status, 400, "a file twice the play window at most");
  assert.equal((await fetch(srv.base + "/api/story/media?as=image", { method: "POST", headers: { "content-type": "image/jpeg" }, body: JPG })).status, 401);
  const R = await make(U.mai, {}, 2); assert.equal(R.status, 200, JSON.stringify(R)); assert.equal(R.ids.length, 2); assert.equal(R.audience, "everyone"); P.open = R.ids;
  const d = srv.store.get("system/pstory-" + R.ids[0]).data; assert.equal(d.eventId, undefined); assert.equal(d.dur, 5000); assert.ok(d.until - d.at > 23.9 * 3600e3 && d.until - d.at <= 24 * 3600e3);
  assert.deepEqual(await sids("mai-sc"), R.ids, "a stranger who isn't signed in sees an open story"); assert.deepEqual(await sids("mai-sc", U.zed.cookie), R.ids);
  const mine = await ring("mai-sc", U.mai.cookie); assert.equal(mine.own, true); assert.equal(mine.items[0].st.own, true); assert.equal(mine.items[0].id, "p:" + R.ids[0], "the day's stories lead the ring");
  assert.equal((await ring("mai-sc", U.zed.cookie)).items[0].st.own, undefined);
  // a video keeps its own file, with the overlay and poster beside it and its trim
  const v = await media(U.mai, "video", MP4, "video/mp4", "&duration=12"), o = await media(U.mai, "overlay", PNG, "image/png"), po = await media(U.mai, "poster");
  const rv = await post("/api/story", { slides: [{ url: v, overlay: o, poster: po, trim: [2, 9.5] }] }, U.mai.cookie), jv = await rv.json(); assert.equal(rv.status, 200, JSON.stringify(jv)); P.video = jv.ids[0];
  const it = (await ring("mai-sc", U.zed.cookie)).items.find((i) => i.st?.sid === P.video); assert.equal(it.type, "video"); assert.equal(it.url, v); assert.equal(it.poster, po); assert.equal(it.st.overlay, o); assert.deepEqual(it.st.trim, [2, 9.5]); assert.equal(it.st.dur, 7500);
  // after its day it leaves the ring; nothing is deleted
  srv.store.update("system/pstory-" + P.video, { until: Date.now() - 1000 }); X.bust(); assert.ok(!(await sids("mai-sc")).includes(P.video)); assert.ok(srv.store.get("system/pstory-" + P.video));
});

test("who sees it: followers, friends and people at the event; a stranger never gets a private one, by any door", async () => {
  P.fol = (await make(U.mai, { audience: "followers" })).ids[0]; P.fri = (await make(U.mai, { audience: "friends" })).ids[0];
  const E = await make(U.mai, { audience: "event", eventId: "scPast" }); assert.equal(E.status, 200, JSON.stringify(E)); P.evOnly = E.ids[0];
  assert.equal((await make(U.mai, { audience: "event" })).status, 400, "the event audience needs an event");
  const see = async (who) => { const L = await sids("mai-sc", who?.cookie); return { fol: L.includes(P.fol), fri: L.includes(P.fri), ev: L.includes(P.evOnly) }; };
  assert.deepEqual(await see(null), { fol: false, fri: false, ev: false }, "signed out");
  assert.deepEqual(await see(U.zed), { fol: false, fri: false, ev: false }, "a stranger");
  assert.deepEqual(await see(U.jun), { fol: true, fri: false, ev: false }, "a follower");
  assert.deepEqual(await see(U.linh), { fol: true, fri: true, ev: true }, "a friend who was at the event");
  assert.deepEqual(await see(U.gus), { fol: false, fri: false, ev: true }, "a guest who was there");
  assert.deepEqual(await see(U.mai), { fol: true, fri: true, ev: true });
  // every tap answers like a story that isn't there
  for (const id of [P.fol, P.fri, P.evOnly]) { for (const [p, b] of [["vote", { sticker: "a", option: 0 }], ["reply", { text: "hi" }], ["react", { emoji: "🔥" }], ["answer", { sticker: "a", text: "x" }], ["slide", { sticker: "a", value: 5 }]]) assert.equal((await post(`/api/story/${id}/${p}`, b, U.zed.cookie)).status, 404, p);
    assert.equal((await get(`/api/story/${id}/insights`, U.zed.cookie)).status, 404); assert.equal((await del(`/api/story/${id}`, U.zed.cookie)).status, 404); }
  assert.equal((await (await post("/api/story/seen", { ids: [P.fol, P.fri, P.evOnly] }, U.zed.cookie)).json()).seen, 0);
  const raw = JSON.stringify(await getJ("/api/public/feed?z=" + Math.random())) + JSON.stringify(await rings(U.zed.cookie)); for (const id of [P.fol, P.fri, P.evOnly]) assert.ok(!raw.includes(id), "not in any feed answer");
  // a link-only event's story stays with the people who were there, whatever was asked
  const pr = await make(U.mai, { audience: "everyone", eventId: "scPriv" }); assert.equal(pr.audience, "event"); P.priv = pr.ids[0];
  assert.ok(!(await sids("mai-sc", U.zed.cookie)).includes(P.priv)); assert.ok(!(await sids("mai-sc")).includes(P.priv)); assert.ok((await sids("mai-sc", U.linh.cookie)).includes(P.priv));
  assert.ok(!JSON.stringify(await rings(U.zed.cookie)).includes("Quiet supper"));
  // a block, either way, takes an open story away too
  assert.equal((await post("/api/me/blocks", { kind: "person", key: U.zed.key, name: "Zed" }, U.mai.cookie)).status, 200);
  assert.ok(!(await sids("mai-sc", U.zed.cookie)).includes(P.open[0]), "the author blocked this viewer"); assert.equal((await post(`/api/story/${P.open[0]}/reply`, { text: "hello" }, U.zed.cookie)).status, 404);
  assert.equal((await fetch(srv.base + "/api/me/blocks?target=" + encodeURIComponent("person:" + U.zed.key), { method: "DELETE", headers: { cookie: U.mai.cookie } })).status, 200);
  assert.ok((await sids("mai-sc", U.zed.cookie)).includes(P.open[0]));
});

test("someone who has never hosted: their story reaches their own circle, never a stranger", async () => {
  assert.equal((await getJ("/api/story/compose", U.gus.cookie)).reach, "circle");
  const R = await make(U.gus, { audience: "everyone" }); assert.equal(R.status, 200, JSON.stringify(R)); assert.equal(R.reach, "circle"); P.gus = R.ids[0];
  assert.deepEqual(await sids("gus-sc"), []); assert.deepEqual(await sids("gus-sc", U.zed.cookie), []); assert.deepEqual(await sids("gus-sc", U.gus.cookie), [P.gus]);
  assert.equal((await post("/api/me/friends", { key: U.gus.key }, U.jun.cookie)).status, 200); // Jun adds Gus: that is following a person
  assert.deepEqual(await sids("gus-sc", U.jun.cookie), [P.gus]); assert.equal((await post(`/api/story/${P.gus}/react`, { emoji: "🔥" }, U.zed.cookie)).status, 404);
});

test("stickers are cleaned, and link only to events and hosts the author may link", async () => {
  assert.equal(cleanSticker({ t: "script", x: 0.5 }), null); assert.equal(cleanSticker({ t: "event", ev: "../x" }), null); assert.equal(cleanSticker({ t: "mention", handle: "<b>" }), null);
  assert.deepEqual(cleanSticker({ id: "A B", t: "poll", x: 9, y: -3, s: 99, r: 720, q: "  Dumplings <b>or</b> noodles? mail me a@b.co ", a: "", b: "Noodles ".repeat(9), html: "<script>" }, 2), { id: "k2", t: "poll", x: 1.2, y: -0.2, s: 4, r: 180, q: "Dumplings or noodles? mail me …", a: "Yes", b: "Noodles Noodles Noodles Noodle" });
  const stickers = [{ id: "ev", t: "event", ev: "scNext", x: 0.5, y: 0.3, s: 1, r: 0 }, { id: "no", t: "event", ev: "scLinh" /* Linh's event: Mai isn't going */, x: 0.5, y: 0.5 }, { id: "gh", t: "event", ev: "nope" },
    { id: "in", t: "imin", ev: "scNext" }, { id: "cd", t: "count", ev: "scNext" }, { id: "at", t: "mention", handle: "linh-sc" }, { id: "at2", t: "mention", handle: "nobody-here" },
    { id: "q", t: "question", prompt: "" }, { id: "p", t: "poll", q: "Dumplings or noodles?", a: "Dumplings", b: "Noodles" }, { id: "sl", t: "slider", q: "How hungry?", emoji: "🥟" }, { t: "iframe", src: "https://x.test" }, { id: "pv", t: "event", ev: "scPriv" }];
  const R = await make(U.mai, { slide: { stickers } }); assert.equal(R.status, 200, JSON.stringify(R)); assert.equal(R.dropped, 4); P.st = R.ids[0];
  const d = srv.store.get("system/pstory-" + P.st).data; assert.deepEqual(d.stickers.map((s) => s.id), ["ev", "in", "cd", "at", "q", "p", "sl", "pv"]); assert.equal(d.stickers.find((s) => s.id === "q").prompt, "Ask me something");
  const forZed = (await ring("mai-sc", U.zed.cookie)).items.find((i) => i.st?.sid === P.st).st, by = (S, id) => S.stickers.find((s) => s.id === id);
  assert.equal(by(forZed, "ev").url, "/e/scNext"); assert.equal(by(forZed, "ev").title, "Dumpling Night"); assert.equal(by(forZed, "in").label, "I'm in"); assert.ok(by(forZed, "cd").at > Date.now()); assert.equal(by(forZed, "at").url, "/@linh-sc"); assert.equal(by(forZed, "at").name, "Linh Tran");
  assert.equal(by(forZed, "pv"), undefined, "a private event's sticker never reaches someone who wasn't there"); assert.equal(forZed.reply, true); assert.equal(by(forZed, "p").res, undefined, "no results before voting");
  const forLinh = (await ring("mai-sc", U.linh.cookie)).items.find((i) => i.st?.sid === P.st).st; assert.equal(by(forLinh, "pv").title, "Quiet supper");
  assert.equal((await ring("mai-sc")).items.find((i) => i.st?.sid === P.st).st.reply, false, "signed out: nothing to reply with");
  // strong language in a sticker is refused like any public text; someone else's event can't be attached either
  assert.equal((await make(U.mai, { slide: { stickers: [{ t: "poll", q: "shit or not", a: "a", b: "b" }] } })).status, 400);
  assert.equal((await make(U.mai, { eventId: "scLinh" })).status, 403); assert.equal((await make(U.mai, { eventId: "nope" })).status, 403);
});

test("a poll counts one vote each and shows results after; a slider the same; reactions and replies make one bell note per batch", async () => {
  const v = (who, body) => post(`/api/story/${P.st}/vote`, body, who.cookie), bell = () => X.inbox(U.mai.email).filter((n) => n.kind === "story");
  assert.equal((await v(U.mai, { sticker: "p", option: 0 })).status, 400, "not on your own"); assert.equal((await v(U.zed, { sticker: "q", option: 0 })).status, 404); assert.equal((await v(U.zed, { sticker: "p", option: 2 })).status, 404);
  const r1 = await v(U.zed, { sticker: "p", option: 1 }), j1 = await r1.json(); assert.equal(r1.status, 200); assert.deepEqual(j1.st.stickers.find((s) => s.id === "p").res, [0, 1]); assert.equal(j1.st.stickers.find((s) => s.id === "p").my, 1);
  assert.equal((await v(U.zed, { sticker: "p", option: 0 })).status, 409, "once per person"); assert.equal((await v(U.jun, { sticker: "p", option: 0 })).status, 200); assert.equal((await v(U.linh, { sticker: "p", option: 1 })).status, 200);
  assert.deepEqual((await getJ(`/api/story/${P.st}/insights`, U.mai.cookie)).stickers.find((s) => s.id === "p").res, [1, 2]);
  assert.equal((await post(`/api/story/${P.st}/slide`, { sticker: "sl", value: 80 }, U.zed.cookie)).status, 200); assert.equal((await post(`/api/story/${P.st}/slide`, { sticker: "sl", value: 10 }, U.zed.cookie)).status, 409);
  const s2 = await (await post(`/api/story/${P.st}/slide`, { sticker: "sl", value: 400 }, U.jun.cookie)).json(); assert.equal(s2.st.stickers.find((s) => s.id === "sl").avg, 90); assert.equal(s2.st.stickers.find((s) => s.id === "sl").my, 100);
  assert.equal(bell().length, 0, "votes never ring the bell");
  // reactions: one note for the story, its count kept true while unread
  assert.equal((await post(`/api/story/${P.st}/react`, { emoji: "💣" }, U.zed.cookie)).status, 400);
  assert.equal((await (await post(`/api/story/${P.st}/react`, { emoji: "🔥" }, U.zed.cookie)).json()).mine, "🔥"); assert.equal(bell().length, 1); assert.equal(bell()[0].text, "Zed reacted 🔥 to your story");
  await post(`/api/story/${P.st}/react`, { emoji: "😍" }, U.zed.cookie); await post(`/api/story/${P.st}/react`, { emoji: "🙌" }, U.jun.cookie);
  assert.equal(bell().length, 1, "one note, not one per tap"); assert.equal(bell()[0].text, "2 people reacted to your story"); assert.equal(bell()[0].link, "/feed?st=" + P.st);
  // a reply and a question's answer reach the author's inbox, and only the author can read them
  assert.equal((await post(`/api/story/${P.st}/reply`, { text: "   " }, U.zed.cookie)).status, 400);
  assert.equal((await post(`/api/story/${P.st}/reply`, { text: "Save me a seat <b>please</b>, call 212 555 0142" }, U.zed.cookie)).status, 200); 
  // a reply is a direct message now (server/dm.js, test/dm.test.js). Zed has no tie to Mai, so his is a request: one message until she accepts, and the bell says who, not what
  const again = await post(`/api/story/${P.st}/reply`, { text: "and one for Jun" }, U.zed.cookie); assert.equal(again.status, 403); assert.match((await again.json()).message, /once Mai accepts/);
  assert.equal(bell().filter((n) => /^st-re-/.test(n.key)).length, 0, "no second kind of note for a reply"); const dm = X.inbox(U.mai.email).filter((n) => n.kind === "dm"); assert.equal(dm.length, 1); assert.equal(dm[0].title, "Zed New wants to send you a message"); assert.equal(dm[0].link, "/chats/dm/requests");
  assert.equal((await post(`/api/story/${P.st}/answer`, { sticker: "q", text: "What should I bring?" }, U.linh.cookie)).status, 200); assert.equal((await post(`/api/story/${P.st}/answer`, { sticker: "p", text: "x" }, U.linh.cookie)).status, 404);
  assert.equal(bell().find((n) => /^st-q-/.test(n.key)).text, 'Linh answered "Ask me something": What should I bring?');
  assert.equal(X.inbox(U.zed.email).filter((n) => n.kind === "story").length, 0); assert.equal(X.inbox(U.linh.email).filter((n) => n.kind === "story").length, 0);
  const I = await getJ(`/api/story/${P.st}/insights`, U.mai.cookie); assert.deepEqual(I.replies.map((r) => [r.name, r.text]).reverse(), [["Zed", "Save me a seat please , call …"]]);
  assert.deepEqual(I.stickers.find((s) => s.id === "q").answers.map((a) => [a.name, a.text]), [["Linh", "What should I bring?"]]); assert.ok(!JSON.stringify(I).includes("@example.com"), "names only, never an address");
  for (const who of [U.zed, U.linh, U.jun]) assert.equal((await get(`/api/story/${P.st}/insights`, who.cookie)).status, 404, "insights are the author's");
  assert.equal((await get(`/api/story/${P.st}/insights`)).status, 401);
  const zedSees = JSON.stringify((await ring("mai-sc", U.zed.cookie)).items.find((i) => i.st?.sid === P.st)); assert.ok(!zedSees.includes("What should I bring") && !zedSees.includes("Save me a seat"), "a viewer never gets other people's replies");
});

test("seen by: counted once per person, for the author only", async () => {
  assert.equal((await post("/api/story/seen", { ids: [P.st] })).status, 401);
  assert.equal((await (await post("/api/story/seen", { ids: [P.st, P.st, "nope"] }, U.zed.cookie)).json()).seen, 0, "Zed voted and replied: already counted"); assert.equal((await (await post("/api/story/seen", { ids: [P.st, P.st, "nope"] }, U.gus.cookie)).json()).seen, 1); assert.equal((await (await post("/api/story/seen", { ids: [P.st] }, U.gus.cookie)).json()).seen, 0, "once"); assert.equal((await (await post("/api/story/seen", { ids: [P.st] }, U.zed.cookie)).json()).seen, 0);
  await post("/api/story/seen", { ids: [P.st] }, U.linh.cookie); assert.equal((await (await post("/api/story/seen", { ids: [P.st] }, U.mai.cookie)).json()).seen, 0, "your own look doesn't count");
  const I = await getJ(`/api/story/${P.st}/insights`, U.mai.cookie); assert.equal(I.count, 4); assert.deepEqual(I.seen.map((s) => s.name).sort(), ["Gus", "Jun", "Linh", "Zed"], "Jun voted, so Jun saw it"); assert.equal(I.seen.find((s) => s.name === "Zed").react, "😍");
  const own = (await ring("mai-sc", U.mai.cookie)).items.find((i) => i.st?.sid === P.st).st; assert.equal(own.seen, 4); assert.equal(own.replies, 2);
  const theirs = (await ring("mai-sc", U.zed.cookie)).items.find((i) => i.st?.sid === P.st).st; assert.equal(theirs.seen, undefined); assert.equal(theirs.replies, undefined); assert.equal(theirs.myReact, "😍");
});

test("with an event: the story is the author's for a day, and its picture joins the event's photos by the rules photos already have", async () => {
  // the host's own event: the photo is out at once, and on the host's ring the story stands in for it
  const H = await make(U.mai, { eventId: "scPast", eventPhoto: true }); assert.equal(H.status, 200, JSON.stringify(H)); assert.equal(H.photos, 1); assert.equal(H.waiting, false);
  const hd = srv.store.get("system/pstory-" + H.ids[0]).data, hm = srv.store.get(`ws/${U.mai.ws}/moments/${hd.momentId}`).data; assert.equal(hm.eventId, "scPast"); assert.equal(hm.url, hd.url); assert.equal(hm.story, hd.id);
  let R = await ring("mai-sc", U.zed.cookie); assert.ok(R.items.some((i) => i.id === "p:" + hd.id)); assert.ok(!R.items.some((i) => i.id === "m:" + hd.momentId), "never the same picture twice");
  assert.equal(R.items.find((i) => i.id === "p:" + hd.id).cta.url, "/e/scPast");
  // a guest's story on the host's event: on the guest's own ring now, on the host's ring once the host approves
  const G = await make(U.linh, { eventId: "scPast", eventPhoto: true, slide: { stickers: [{ id: "p", t: "poll", q: "Again?", a: "Yes", b: "Yes!" }] } }); assert.equal(G.status, 200, JSON.stringify(G)); assert.equal(G.photos, 1); assert.equal(G.waiting, true);
  const gd = srv.store.get("system/pstory-" + G.ids[0]).data; assert.ok((await sids("linh-sc", U.zed.cookie)).includes(gd.id)); assert.ok(!(await ring("mai-sc", U.zed.cookie)).items.some((i) => i.id === "m:" + gd.momentId), "waits for the host");
  assert.equal((await getJ("/api/me/stories", U.mai.cookie)).waiting.find((e) => e.eventId === "scPast").photos[0].id, gd.momentId); assert.equal((await getJ("/api/story/mine", U.linh.cookie)).stories.find((s) => s.st.sid === gd.id).waiting, true);
  assert.equal((await post("/api/me/stories/approve", { ids: [gd.momentId] }, U.mai.cookie)).status, 200); X.bust();
  const onHost = (await ring("mai-sc", U.zed.cookie)).items.find((i) => i.id === "m:" + gd.momentId); assert.ok(onHost, "approved: on the host's ring as the event's photo"); assert.equal(onHost.st.sid, gd.id, "with its stickers"); assert.equal(onHost.st.stickers[0].t, "poll");
  // the two clocks: after a day the story is off its author's ring; the event's photo stays its 14 days
  srv.store.update("system/pstory-" + gd.id, { until: Date.now() - 1000 }); X.bust(); assert.ok(!(await sids("linh-sc", U.zed.cookie)).includes(gd.id)); assert.ok((await ring("mai-sc", U.zed.cookie)).items.some((i) => i.id === "m:" + gd.momentId));
  // not everything fits the photo wall: a narrower audience on an open event, an event that hasn't happened (for a guest)
  const N = await make(U.mai, { eventId: "scPast", eventPhoto: true, audience: "friends" }); assert.equal(N.photos, 0); assert.equal(N.photoNote, "audience");
  const F = await make(U.linh, { eventId: "scNext", eventPhoto: true }); assert.equal(F.status, 200); assert.equal(F.photos, 0); assert.equal(F.photoNote, "not_yet");
  // a private event: the photo and the story both stay with the people who were there
  const Pv = await make(U.linh, { eventId: "scPriv", eventPhoto: true, audience: "everyone" }); assert.equal(Pv.audience, "event"); assert.equal(Pv.photos, 1); assert.ok(!(await sids("linh-sc", U.zed.cookie)).includes(Pv.ids[0])); assert.ok((await sids("linh-sc", U.mai.cookie)).includes(Pv.ids[0]));
  P.guest = gd; P.hostEv = hd;
});

test("a highlight keeps a story past its day, the scrapbook keeps its picture, and delete takes it away everywhere", async () => {
  const R = await make(U.mai, { highlight: { name: "Dumpling nights <3" }, scrapbook: true }); assert.equal(R.status, 200, JSON.stringify(R)); assert.ok(R.highlight.id); assert.ok(R.scrapbook);
  let H = (await getJ("/api/public/highlights/mai-sc")).highlights; assert.equal(H.length, 1); assert.equal(H[0].items[0].st.sid, R.ids[0]);
  assert.equal((await getJ("/api/host/scrapbook", U.mai.cookie)).items.find((x) => x.id === R.scrapbook).photos.length, 1);
  srv.store.update("system/pstory-" + R.ids[0], { until: Date.now() - 1000 }); X.bust(); assert.ok(!(await sids("mai-sc")).includes(R.ids[0]), "off the ring");
  H = (await getJ("/api/public/highlights/mai-sc")).highlights; assert.equal(H[0].items.length, 1, "still in the highlight");
  // a friends-only story in a highlight is still friends-only
  const F = await make(U.mai, { audience: "friends", highlight: { id: R.highlight.id } }); assert.equal(F.highlight.id, R.highlight.id);
  assert.equal((await getJ("/api/public/highlights/mai-sc")).highlights[0].items.length, 1); assert.equal((await getJ("/api/public/highlights/mai-sc", U.zed.cookie)).highlights[0].items.length, 1); assert.equal((await getJ("/api/public/highlights/mai-sc", U.linh.cookie)).highlights[0].items.length, 2);
  // someone else's story can't go in my highlight
  assert.equal((await (await post("/api/me/stories/highlights", { id: R.highlight.id, add: "s:" + P.gus }, U.mai.cookie)).json()).highlight.items.includes("s:" + P.gus), false);
  // delete: the author only; the story, what came back for it, and its event photo all go
  assert.equal((await del(`/api/story/${P.hostEv.id}`, U.linh.cookie)).status, 404); assert.equal((await del(`/api/story/${P.hostEv.id}`)).status, 401);
  assert.equal((await del(`/api/story/${P.hostEv.id}`, U.mai.cookie)).status, 200); X.bust();
  assert.equal(srv.store.get("system/pstory-" + P.hostEv.id), null); assert.equal(srv.store.get(`ws/${U.mai.ws}/moments/${P.hostEv.momentId}`), null); assert.ok(!(await sids("mai-sc", U.zed.cookie)).includes(P.hostEv.id));
  assert.equal((await del(`/api/story/${P.st}`, U.mai.cookie)).status, 200); assert.equal(srv.store.get("system/storyx-" + P.st), null); assert.equal((await post(`/api/story/${P.st}/reply`, { text: "still there?" }, U.zed.cookie)).status, 404);
});

test("the rate limit: so many stories an hour per person, and someone else's count is their own", async () => {
  process.env.STORY_PER_HOUR = "2"; M.resetLimits();
  assert.equal((await make(U.jun)).status, 200); assert.equal((await make(U.jun)).status, 200); const r = await make(U.jun); assert.equal(r.status, 429); assert.equal(r.code, "rate_limited");
  assert.equal((await make(U.zed)).status, 200); delete process.env.STORY_PER_HOUR;
  const many = Array(STORY_LIMITS.slides + 1).fill({ url: "/_blob/AAAAAAAAAAAAAAAAAAAA" }); M.resetLimits(); assert.equal((await post("/api/story", { slides: many }, U.jun.cookie)).status, 400, "ten slides at most");
});

// ---------- after Share: every way a story could fail to show for the person who made it ----------
test("after Share the answer carries the author's own ring; a saved feed never hides it; a person with no page still sees their own", async () => {
  M.resetLimits(); const url = "/api/public/feed"; await getJ(url); await getJ(url); // the public feed's answer is cached
  const R = await make(U.mai); assert.equal(R.status, 200, JSON.stringify(R)); assert.equal(R.ring.own, true); assert.equal(R.ring.host.handle, "mai-sc"); assert.equal(R.ring.items[R.first].st.sid, R.ids[0], "the page can open the viewer on the new story without asking again");
  assert.ok(JSON.stringify((await getJ(url)).stories).includes(R.ids[0]), "the cached public feed is rebuilt when a story is made"); const mine = (await rings(U.mai.cookie))[0]; assert.equal(mine.own, true, "my own ring is first"); assert.ok(mine.items.some((i) => i.st?.sid === R.ids[0]));
  // the service worker drops its saved feed copies when a story is made or deleted (a slow connection used to answer with the old feed)
  const sw = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"); assert.match(sw, /api\\\/story\(\\\/\(\?!media\$\|seen\$\)/, "POST /api/story and DELETE /api/story/<id> drop the saved feed; uploads and seen pings don't");
  // a clock a little ahead of the server's still shows it; 24 hours is 24 hours whatever the time zone
  srv.store.update("system/pstory-" + R.ids[0], { at: Date.now() + 30e3 }); X.bust(); assert.ok((await sids("mai-sc", U.mai.cookie)).includes(R.ids[0])); const d = srv.store.get("system/pstory-" + R.ids[0]).data; assert.ok(Math.abs(d.until - Date.now() - 24 * 3600e3) < 60e3);
  // someone with no host page at all (a workspace that isn't a person's own page): the story is on their own ring, for them, and no stranger's
  const nia = await join("Nia Okoro", "nia.sc@example.com"); srv.store.update("system/ws-" + nia.ws, { personal: false, host: null }); X.bust();
  const N = await make(nia); assert.equal(N.status, 200, JSON.stringify(N)); assert.equal(N.ring.own, true); assert.equal(N.ring.host.handle, ""); assert.equal(N.ring.host.name, "Nia"); assert.equal(N.reach, "circle");
  const hers = (await rings(nia.cookie))[0]; assert.equal(hers.own, true, "first on her own rail"); assert.deepEqual(hers.items.map((i) => i.st.sid), N.ids); assert.ok(!JSON.stringify(await rings(U.zed.cookie)).includes(N.ids[0])); assert.ok(!JSON.stringify(await rings()).includes(N.ids[0]));
  // a guest's story on a host's event: on the guest's ring at once, saying who it waits for; never gone
  const G = await make(U.linh, { eventId: "scPast", eventPhoto: true }); assert.equal(G.waiting, true); assert.equal(G.waitingFor, "Mai's supper club"); assert.equal(G.ring.items[G.first].st.waitingFor, "Mai's supper club"); assert.ok((await sids("linh-sc", U.linh.cookie)).includes(G.ids[0]));
  const gd = srv.store.get("system/pstory-" + G.ids[0]).data; assert.equal((await post("/api/me/stories/approve", { ids: [gd.momentId] }, U.mai.cookie)).status, 200); X.bust(); assert.equal((await ring("linh-sc", U.linh.cookie)).items.find((i) => i.st.sid === G.ids[0]).st.waitingFor, undefined, "approved: nothing waits");
  // a link to one story: its ring for whoever may see it, a plain 404 otherwise
  const L = await getJ("/api/public/story/" + R.ids[0]); assert.equal(L.ring.items[L.k].st.sid, R.ids[0]); assert.equal(L.ring.own, undefined);
  const F = await make(U.mai, { audience: "friends" }); assert.equal((await get("/api/public/story/" + F.ids[0])).status, 404); assert.equal((await get("/api/public/story/" + F.ids[0], U.zed.cookie)).status, 404); assert.equal((await get("/api/public/story/" + F.ids[0], U.linh.cookie)).status, 200); assert.equal((await get("/api/public/story/nope")).status, 404);
  srv.store.update("system/pstory-" + F.ids[0], { until: Date.now() - 1000 }); X.bust(); assert.equal((await get("/api/public/story/" + F.ids[0], U.linh.cookie)).status, 404, "off the ring: the link is gone for others"); assert.equal((await getJ("/api/public/story/" + F.ids[0], U.mai.cookie)).ring.own, true, "its author can still open it");
  // a sticker's look is one of three and travels with it
  assert.equal(cleanSticker({ t: "poll", v: 2 }).v, 2); assert.equal(cleanSticker({ t: "poll", v: 7 }).v, undefined); assert.equal(cleanSticker({ t: "poll", v: "x" }).v, undefined);
});

test("the rail shows 20 rings at most, and the author's own is never the one that's cut", { timeout: 120_000 }, async () => {
  M.resetLimits(); for (let i = 0; i < 22; i++) { const h = await join("Host " + i, `host${i}.sc@example.com`); assert.ok((await post("/api/host/profile", { handle: "host-sc-" + i, name: "Host " + i }, h.cookie)).ok); await ev("scH" + i, { name: "Night " + i, date: day(2 + (i % 5)) }, h); await post("/api/public/follow", { handle: "host-sc-" + i }, U.jun.cookie); }
  X.bust(); const R = await make(U.jun); assert.equal(R.status, 200, JSON.stringify(R)); const L = await rings(U.jun.cookie); assert.ok(L.length >= 20, "a full rail: " + L.length); assert.equal(L[0].own, true, "Jun follows 22 hosts with something on, and his own ring still leads"); assert.ok(L[0].items.some((i) => i.st?.sid === R.ids[0]));
  const nia = { cookie: (await post("/api/login", { email: "nia.sc@example.com", password: "long-password-1" })).headers.get("set-cookie")?.split(";")[0] }; if (nia.cookie) { const N = await rings(nia.cookie); assert.equal(N[0].own, true, "and so does a ring with no page behind it"); }
});

// ---------- the browser walk: from the ring to a reply, at 390 (touch) and 1280 ----------
const PHOTO = png(360, 480, [60, 120, 170]), PHOTO2 = png(480, 300, [200, 150, 60]);
for (const W of [390, 1280]) test(`browser at ${W}: make a story from the ring, share it into the viewer, and someone else votes, follows the event sticker and replies`, { timeout: 240_000 }, async (t) => {
  let pw; try { pw = createRequire(import.meta.url)("playwright"); } catch { return t.skip("playwright is not installed"); }
  let browser; try { browser = await pw.chromium.launch(); } catch { return t.skip("no Chromium here"); }
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true }); const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}-${W}.png`) }); };
  const touch = W === 390, ana = await join("Ana Ruiz", `ana${W}.sc@example.com`), ben = await join("Ben Okafor", `ben${W}.sc@example.com`), EV = `scW${W}`, handle = `ana-sc-${W}`;
  assert.ok((await post("/api/host/profile", { handle, name: `Ana${W}'s table` }, ana.cookie)).ok); assert.ok((await post("/api/host/profile", { handle: `ben-sc-${W}`, name: "Ben" }, ben.cookie)).ok);
  await ev(EV, { name: "Noodle night", date: day(5), startTime: "19:00" }, ana); X.bust(); M.resetLimits();
  const ctxFor = async (who) => { const ctx = await browser.newContext(touch ? { ...pw.devices["iPhone 13"], viewport: { width: 390, height: 844 }, reducedMotion: "reduce", serviceWorkers: "block" } : { viewport: { width: 1280, height: 800 }, reducedMotion: "reduce", serviceWorkers: "block" });
    await ctx.addCookies(who.cookie.split("; ").map((kv) => { const i = kv.indexOf("="); return { name: kv.slice(0, i), value: kv.slice(i + 1), url: srv.base }; }).concat([{ name: "encore_in", value: "1", url: srv.base }]));
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, body: "" })); return ctx; };
  const errs = [], asked = []; const watch = (page) => { page.on("pageerror", (e) => errs.push("pageerror " + e.message)); page.on("console", (m) => { if (m.type() === "error") errs.push("console " + m.text()); }); page.on("requestfailed", (r) => { if (r.url().startsWith(srv.base) && !/ERR_ABORTED/.test(r.failure()?.errorText || "")) errs.push("failed " + r.url()); });
    page.on("request", (r) => asked.push(new URL(r.url()).pathname)); page.on("response", (r) => { if (r.status() >= 400 && r.url().startsWith(srv.base)) errs.push(r.status() + " " + r.url()); }); };
  const tap = (page, sel) => (touch ? page.tap(sel) : page.click(sel));
  const tapAt = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }).then((p) => (touch ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y)));
  const state = (page) => page.evaluate(() => { const S = window.PLStoryComposer.state; return { n: S.slides.length, cur: S.cur, sel: S.sel, tool: S.tool, slides: S.slides.map((s) => ({ kind: s.kind, items: s.items.map((i) => ({ ...i })), strokes: s.strokes.length })) }; });
  const range = (page, sel, v) => page.$eval(sel, (r, v) => { r.value = v; r.dispatchEvent(new Event("input", { bubbles: true })); r.dispatchEvent(new Event("change", { bubbles: true })); }, v);
  // every control on screen: big enough to tap, inside the window, and not under another one
  const audit = (page, root) => page.evaluate((root) => { const R = document.querySelector(root), out = []; const B = [...R.querySelectorAll("button,a[href],input,select,textarea")].filter((b) => b.offsetParent !== null && !b.closest("[hidden]") && !b.classList.contains("stc-sr") && getComputedStyle(b).visibility !== "hidden" && getComputedStyle(b).opacity !== "0").map((b) => ({ b, r: b.getBoundingClientRect() })).filter((x) => x.r.width > 0 && x.r.bottom > 0 && x.r.top < innerHeight && x.r.right > 0 && x.r.left < innerWidth);
    const name = (b) => (b.getAttribute("aria-label") || b.textContent || b.id || b.tagName).trim().slice(0, 30);
    for (const { b, r } of B) { const sc = b.closest(".stc-scroll,.stc-prev,.stc-sh-body,.sv-sh-body,.stc-start,.fv-rail"); if (sc) { const s = sc.getBoundingClientRect(); if (r.right > s.right + 1 || r.left < s.left - 1 || r.bottom > s.bottom + 1 || r.top < s.top - 1) continue; } // scrolled out of its own row: not on screen
      const hit = b.matches(".stc-fold") ? { width: r.width / 2, height: r.height + 20 } /* the handle's tap area reaches past its bar */ : b.matches("input[type=radio],input[type=checkbox]") ? b.closest("label").getBoundingClientRect() : r; if (hit.height < 43.5 || (hit.width < 43.5 && !b.matches("input[type=range]"))) out.push(`small: ${name(b)} ${Math.round(hit.width)}x${Math.round(hit.height)}`);
      if (r.left < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.top < -1) out.push(`off screen: ${name(b)}`);
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2, top = document.elementFromPoint(cx, cy); if (top && !(b.contains(top) || top.contains(b) || top.closest("label")?.contains(b))) out.push(`covered: ${name(b)} by ${top.className || top.tagName}`);
      if (b.tagName === "BUTTON" && !name(b)) out.push("no name: " + b.outerHTML.slice(0, 60)); }
    for (const el of R.querySelectorAll("button span, .stc-act span, h2, h3, .stc-chip, .stc-tab")) if (el.offsetParent !== null && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== "visible") out.push("cut off: " + el.textContent.trim().slice(0, 30));
    if (document.documentElement.scrollWidth - innerWidth > 1) out.push("the page scrolls sideways"); return out; }, root);
  try {
    // ---- Ana makes a story from the ring
    let ctx = await ctxFor(ana), page = await ctx.newPage(); watch(page); await page.goto(srv.base + "/feed", { waitUntil: "domcontentloaded" }); await page.waitForSelector("#fvAdd", { timeout: 20000 }); await page.waitForTimeout(600); await page.evaluate(() => (window.__samePage = 1));
    assert.ok(!asked.some((p) => /storycomposer|storykit|storyview/.test(p)), "the feed's first load doesn't fetch the composer"); assert.equal(await page.$(".stc"), null, "nothing opens by itself"); assert.equal(await page.$(".fv-mine"), null, "no story yet: the ring is the dashed +"); await shot(page, "ring-before");
    await tap(page, "#fvAdd"); await page.waitForSelector(".stc .stc-start", { timeout: 15000 }); assert.ok(asked.includes("/storycomposer.js") && asked.includes("/storycomposer.css"), "fetched on the tap");
    assert.deepEqual(await audit(page, ".stc"), [], "the start screen"); assert.equal(await page.$$eval(".stc .stc-btn.pri:not(:disabled), .stc .stc-opt.pri", (L) => L.length), 1, "one primary"); assert.deepEqual(await page.$$eval(".stc [data-tpl]", (L) => L.map((b) => b.textContent)), ["Tonight's plan", "Recap", "Thank you", "Come with me", "New drop", "Poll the group"]); await shot(page, "sc-start");
    const [fc] = await Promise.all([page.waitForEvent("filechooser"), tap(page, '.stc [data-s="lib"]')]); assert.equal(fc.isMultiple(), true, "several at once make several slides"); await fc.setFiles([{ name: "a.png", mimeType: "image/png", buffer: PHOTO }]);
    await page.waitForSelector(".stc .stc-stage", { timeout: 15000 }); await page.waitForTimeout(300);
    const geo = await page.evaluate(() => { const s = document.querySelector(".stc-stage").getBoundingClientRect(), top = document.querySelector(".stc-top").getBoundingClientRect(), strip = document.querySelector(".stc-strip").getBoundingClientRect(), tools = document.querySelector(".stc-tools").getBoundingClientRect(); return { ratio: s.width / s.height, w: s.width, share: (s.width * s.height) / (innerWidth * innerHeight), clearTop: s.top >= top.bottom - 0.5, clear: innerWidth >= 900 ? s.right <= tools.left + 0.5 : s.bottom <= strip.top + 0.5, railInTop: innerWidth >= 900 || tools.bottom <= s.top + s.height * 0.12 + 20, in: s.left >= 0 && s.right <= innerWidth && s.bottom <= innerHeight, font: getComputedStyle(document.querySelector(".stc-chip, .stc-btn")).fontFamily, radius: getComputedStyle(document.querySelector(".stc-btn.pri")).borderRadius, pri: getComputedStyle(document.querySelector(".stc-btn.pri")).backgroundColor, panel: document.querySelector(".stc-panel").hidden }; });
    assert.ok(Math.abs(geo.ratio - 9 / 16) < 0.01, "a 9:16 page"); assert.ok(geo.clearTop && geo.clear && geo.in, "the bars never cover the slide: " + JSON.stringify(geo)); assert.match(geo.font, /IBM Plex Sans/); assert.equal(geo.radius, "6px"); assert.equal(geo.pri, "rgb(41, 72, 154)", "ink blue");
    if (touch) { assert.ok(geo.w >= 370, "the slide is the hero: nearly the full width of the phone: " + geo.w); assert.ok(geo.share > 0.75, "and most of the screen: " + geo.share.toFixed(2)); assert.ok(geo.railInTop, "the tool rail sits in the strip the viewer's top bar covers"); assert.equal(geo.panel, true, "no options sheet until something is picked"); }
    assert.deepEqual(await audit(page, ".stc"), [], "the editor"); await shot(page, "sc-editor");
    // text: the tool adds words and the keyboard bar; restyle; move with the keyboard
    await tap(page, '.stc [data-tool="text"]'); await page.waitForSelector(".stc-edit textarea"); assert.equal(await page.evaluate(() => document.activeElement.id), "scTxt", "the first tap puts the cursor in the words"); await page.keyboard.type("Noodles tonight"); assert.ok(await page.$(".stc-edit [data-kfont]"), "type styles right above the keyboard"); await shot(page, "sc-typing"); await tap(page, ".stc-edit [data-done]"); await page.waitForSelector(".stc [data-font]");
    assert.deepEqual(await audit(page, ".stc"), [], "the text options"); assert.ok((await page.$$eval(".stc [data-font]", (L) => L.length)) >= 12, "twelve type styles or more");
    await tap(page, '.stc [data-font="serif"]'); await tap(page, '.stc [data-tab="colour"]'); await tap(page, '.stc [data-col="#F2DD6B"]'); assert.ok(await page.$(".stc [data-wheel]"), "any colour, not only the swatches"); assert.deepEqual(await audit(page, ".stc"), [], "the colour row");
    await tap(page, '.stc [data-tab="shape"]'); await tap(page, ".stc [data-pill]"); await tap(page, ".stc [data-align]"); await tap(page, ".stc [data-fx]"); assert.deepEqual(await audit(page, ".stc"), [], "the shape row");
    let S = await state(page), tx = S.slides[0].items[0]; assert.deepEqual([tx.txt, tx.font, tx.color, tx.pill, tx.align, tx.fx], ["Noodles tonight", "serif", "#F2DD6B", "solid", "left", "outline"]);
    // an effect and letter spacing change the picture that is shared, not only the screen
    const px = (page) => page.evaluate(() => { const S = window.PLStoryComposer.state, c = window.PLStoryComposer._flat(S.slides[S.cur], 0.25), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0; return h; });
    const p0 = await px(page); await tap(page, ".stc [data-fx]"); const p1 = await px(page); assert.notEqual(p0, p1, "a text effect is in the flattened picture"); await tap(page, '.stc [data-tab="space"]'); await range(page, "#scLs", 0.2); const p2 = await px(page); assert.notEqual(p1, p2, "so is letter spacing"); assert.equal((await state(page)).slides[0].items[0].ls, 0.2);
    await page.focus(".stc-it"); tx = (await state(page)).slides[0].items[0]; const was = { x: tx.x, y: tx.y, s: tx.s, r: tx.r }; for (const k of ["ArrowRight", "ArrowDown", "ArrowDown", "+", "]"]) await page.keyboard.press(k); await page.waitForTimeout(450);
    tx = (await state(page)).slides[0].items[0]; assert.ok(tx.x > was.x && tx.y > was.y && tx.s > was.s && tx.r === was.r + 5, "arrow keys move it, + resizes, ] turns: " + JSON.stringify(tx)); assert.match(await page.$eval(".stc-it", (e) => e.getAttribute("aria-label")), /^Text: Noodles tonight, selected/);
    assert.ok(await page.$eval(".stc-it", (c) => c.tagName === "CANVAS" && c.width > 100), "the words are painted, the same on screen as in the shared picture"); await shot(page, "sc-text");
    // hold on it (or M): duplicate, order, lock, delete; a delete can be undone from its note
    await page.keyboard.press("m"); await page.waitForSelector(".stc-sheet [data-m]"); assert.deepEqual(await page.$$eval(".stc-sheet [data-m]", (L) => L.map((b) => b.textContent.trim())), ["Duplicate", "Bring forward", "Send back", "Lock in place", "Use this style on all text", "Delete"]); assert.deepEqual(await audit(page, ".stc-sheet"), [], "the item menu"); await tap(page, '.stc-sheet [data-m="dup"]'); assert.equal((await state(page)).slides[0].items.length, 2);
    await page.keyboard.press("Delete"); assert.equal((await state(page)).slides[0].items.length, 1); await page.waitForSelector(".stc-toast-b"); await tap(page, ".stc-toast-b"); assert.equal((await state(page)).slides[0].items.length, 2, "Undo on the note brings it back"); await page.keyboard.press("Control+z"); assert.equal((await state(page)).slides[0].items.length, 1);
    assert.match(await page.$eval("[data-saved]", (e) => e.textContent), /Saving draft|Draft saved/, "it says the draft is being kept");
    // the photo: looks, sliders and a frame all end up in the picture
    await tap(page, ".stc-stage"); await tap(page, '.stc [data-tool="look"]'); await page.waitForSelector(".stc [data-look]"); assert.equal(await page.$$eval(".stc [data-look]", (L) => L.length), 8); await tap(page, '.stc [data-tab="adjust"]'); assert.deepEqual(await page.$$eval(".stc [data-adj]", (L) => L.map((r) => r.dataset.adj)), ["b", "c", "w", "s"]); assert.deepEqual(await audit(page, ".stc"), [], "the adjust sliders");
    const q0 = await px(page); await range(page, "#scAdjw", 40); const q1 = await px(page); assert.notEqual(q0, q1, "warmth is in the flattened picture"); await tap(page, '.stc [data-tab="frame"]'); await tap(page, '.stc [data-frame="polaroid"]'); const q2 = await px(page); assert.notEqual(q1, q2, "and the frame"); await shot(page, "sc-frame");
    // draw, then undo and redo
    await tap(page, '.stc [data-tool="draw"]'); await page.waitForSelector(".stc [data-pen]"); assert.deepEqual(await page.$$eval(".stc [data-pen]", (L) => L.map((b) => b.dataset.pen)), ["pen", "marker", "hi", "erase"]); assert.equal(await page.$$eval(".stc [data-w]", (L) => L.length), 3); assert.deepEqual(await audit(page, ".stc"), [], "the draw options");
    const st = await page.$eval(".stc-stage", (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    await page.evaluate(({ st, touch }) => { const el = document.querySelector(".stc-stage"), ev = (t, x, y) => el.dispatchEvent(new PointerEvent(t, { pointerId: 5, pointerType: touch ? "touch" : "mouse", isPrimary: true, clientX: x, clientY: y, bubbles: true, button: 0 })); el.setPointerCapture = () => {}; ev("pointerdown", st.x + st.w * 0.2, st.y + st.h * 0.6); for (let i = 1; i <= 8; i++) ev("pointermove", st.x + st.w * (0.2 + i * 0.07), st.y + st.h * (0.6 + (i % 2) * 0.03)); ev("pointerup", st.x + st.w * 0.76, st.y + st.h * 0.6); }, { st, touch });
    assert.equal((await state(page)).slides[0].strokes, 1, "a line was drawn"); await tap(page, '.stc [data-a="undo"]'); assert.equal((await state(page)).slides[0].strokes, 0, "Undo takes the line away"); assert.equal((await state(page)).slides[0].items.length, 1, "and only the line");
    await tap(page, '.stc [data-a="redo"]'); assert.equal((await state(page)).slides[0].strokes, 1, "Redo brings it back");
    // stickers: an event and a poll, the poll in its second look
    await tap(page, '.stc [data-tool="sticker"]'); await page.waitForSelector(".stc-sheet [data-st]"); assert.deepEqual(await page.$$eval(".stc-sheet [data-st]", (L) => L.map((b) => b.dataset.st)), ["event", "imin", "count", "mention", "question", "poll", "slider", "place", "when"]); assert.ok((await page.$$eval(".stc-sheet [data-art]", (L) => L.length)) >= 30, "drawings from the app's own art, and more of our own");
    assert.deepEqual(await audit(page, ".stc-sheet"), [], "the sticker sheet"); await shot(page, "sc-stickers");
    await tap(page, '.stc-sheet [data-st="event"]'); await page.waitForSelector(`.stc-sheet [data-ev="${EV}"]`); await tap(page, `.stc-sheet [data-ev="${EV}"]`); await page.waitForSelector(".stc-it.sk .sk-card");
    for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowUp"); // with the keyboard
    await tap(page, '.stc [data-tool="sticker"]'); await tap(page, '.stc-sheet [data-st="poll"]'); await page.waitForSelector("#scA"); await page.fill("#scA", "Broth or dry?"); await page.fill("#scB", "Broth"); await page.fill("#scC", "Dry"); assert.deepEqual(await audit(page, ".stc-sheet"), [], "the poll form"); await tap(page, ".stc-sheet [data-ok]"); await page.waitForSelector(".stc-it.sk .sk-btn");
    S = await state(page); const evS = S.slides[0].items.find((i) => i.t === "event"), poll = S.slides[0].items.find((i) => i.t === "poll"); assert.ok(poll.y - evS.y > 0.15, "a new sticker lands clear of the last one: " + evS.y + " " + poll.y);
    for (let i = 0; i < 24; i++) await page.keyboard.press("ArrowDown"); await page.waitForTimeout(450); await tap(page, '.stc [data-i="look"]'); await page.waitForTimeout(100);
    S = await state(page); assert.deepEqual(S.slides[0].items.map((i) => i.t), ["text", "event", "poll"]); assert.equal(S.slides[0].items[2].v, 1); assert.ok(await page.$(".stc-it.sk.v1"), "the sticker's second look"); assert.deepEqual(await audit(page, ".stc"), [], "a sticker's own options"); await shot(page, "sc-slide");
    // a second slide from a template, then reorder with Move left
    await tap(page, ".stc [data-addslide]"); const [fc2] = await Promise.all([page.waitForEvent("filechooser"), tap(page, '.stc-sheet [data-s="lib"]')]); await fc2.setFiles([{ name: "b.png", mimeType: "image/png", buffer: PHOTO2 }]);
    await page.waitForFunction(() => window.PLStoryComposer.state.slides.length === 2, null, { timeout: 15000 }); assert.equal((await state(page)).cur, 1); if (touch) await tap(page, '.stc [data-th="1"]'); // on a phone a second tap on the slide in view opens its options
    await page.waitForSelector('.stc [data-mv="-1"]:not(:disabled)'); assert.deepEqual(await audit(page, ".stc"), [], "the slides row and its options");
    assert.deepEqual(await page.$$eval(".stc-acts .stc-act", (L) => [...new Set(L.map((b) => Math.round(b.getBoundingClientRect().height)))].length), 1, "the slide buttons share one height"); assert.deepEqual(await page.$$eval(".stc-acts .stc-act", (L) => L.map((b) => b.textContent.trim())), ["Move left", "Move right", "Copy", "Delete"]);
    await tap(page, '.stc [data-mv="-1"]'); S = await state(page); assert.deepEqual([S.cur, S.slides[0].items.length, S.slides[1].items.length], [0, 0, 3], "the new slide is first now"); await tap(page, '.stc [data-mv="1"]'); assert.equal((await state(page)).slides[0].items.length, 3, "and back");
    await shot(page, "sc-strip");
    // share: the sharing screen at once, then the viewer on the new story
    await tap(page, '.stc [data-a="next"]'); await page.waitForSelector(".stc-sheet [data-share]"); assert.deepEqual(await page.$$eval('.stc-sheet [name="scAud"]', (L) => L.map((r) => r.value)), ["everyone", "followers", "friends"]); assert.equal(await page.$$eval(".stc-sheet .stc-btn.pri", (L) => L.length), 1, "one primary: Share");
    assert.deepEqual(await audit(page, ".stc-sheet"), [], "the share step"); await shot(page, "sc-share");
    await page.route("**/api/story", async (r) => { await new Promise((res) => setTimeout(res, 500)); r.continue(); }); const made = page.waitForResponse((r) => /\/api\/story$/.test(r.url()) && r.request().method() === "POST"); await tap(page, ".stc-sheet [data-share]");
    await page.waitForSelector(".stc-pub canvas"); assert.match(await page.$eval(".stc-pub [data-ps]", (e) => e.textContent), /Sharing/, "its own picture is on screen while the files go up"); await shot(page, "sc-sharing");
    const res = await made; assert.equal(res.status(), 200, await res.text()); const R = await res.json(); assert.equal(R.ids.length, 2);
    await page.waitForSelector(".fv-sv [data-live]", { timeout: 15000 }); assert.equal(await page.$(".stc"), null, "the composer closed straight into the viewer"); assert.equal(await page.evaluate(() => window.__samePage), 1, "no reload");
    const live = await page.evaluate(() => ({ text: document.querySelector(".fv-sv .sv-live-h").innerText, btns: [...document.querySelectorAll(".fv-sv [data-live] button")].map((b) => b.textContent), img: document.querySelector(".fv-sv-box img")?.getAttribute("src"), burst: !!document.querySelector(".sv-burst") }));
    assert.match(live.text, /Your story is live for 24 hours/); assert.deepEqual(live.btns, ["Share link", "Add to a highlight"]); assert.equal(live.burst, false, "reduced motion: no burst"); X.bust();
    const d = srv.store.get("system/pstory-" + R.ids[0]).data; assert.equal(live.img, d.url, "playing the first new slide"); assert.deepEqual(await audit(page, ".fv-sv"), [], "the viewer, just shared"); await shot(page, "sv-live");
    assert.deepEqual(d.stickers.map((s) => [s.t, s.v || 0]), [["event", 0], ["poll", 1]], "the poll's look travels with it"); assert.ok(d.stickers.every((s) => s.x > 0 && s.x < 1 && s.y > 0 && s.y < 1), "each with its place on the slide"); assert.ok(d.stickers[0].y < 0.4 && d.stickers[1].y > 0.5, "where the keyboard put them: " + JSON.stringify(d.stickers.map((s) => s.y)));
    const pic = Buffer.from(await (await fetch(srv.base + d.url)).arrayBuffer()); assert.equal(pic[0], 0xff); assert.equal(pic[1], 0xd8, "a JPEG"); assert.ok(pic.length < 600 * 1024, "under 600 KB: " + pic.length); assert.equal(d.w, 1080); assert.equal(d.h, 1920);
    // Add to a highlight from the live note; then the ring behind is already "Your story", with a + beside it
    await tap(page, ".fv-sv [data-hl]"); await page.waitForSelector("#svHn"); await page.fill("#svHn", "Noodle nights"); assert.deepEqual(await audit(page, ".fv-sv .sv-sheet"), [], "the highlight sheet"); await tap(page, ".sv-sheet [data-new]"); await page.waitForFunction(() => /Saved to Noodle nights/.test(document.querySelector("[data-sv-msg]")?.textContent || ""));
    assert.equal((await getJ("/api/public/highlights/" + handle)).highlights[0].items[0].st.sid, R.ids[0]);
    await page.click(".fv-sv-x"); await page.waitForSelector(".fv-mine [data-fv-story]"); const ringNow = await page.evaluate(() => { const m = document.querySelector(".fv-mine"), rail = document.querySelector(".fv-rail"), b = m.querySelector("[data-fv-story]"), plus = m.querySelector("#fvAdd").getBoundingClientRect(); return { first: rail.firstElementChild === m, label: b.querySelector("small").textContent, img: !!b.querySelector("img"), aria: b.getAttribute("aria-label").replace(/\d+ stories/, "N stories"), plus: [Math.round(plus.width), Math.round(plus.height)], plusLabel: m.querySelector("#fvAdd").getAttribute("aria-label"), same: window.__samePage, dupes: [...document.querySelectorAll('#rail [data-fv-story]')].filter((x) => x.getAttribute('aria-label').startsWith('Ana' + innerWidth)).map((x) => JSON.stringify(window.FeedVisual.REG.get(x.dataset.fvStory).items.map((i) => i.id))).join(' / ') }; });
    assert.deepEqual(ringNow, { first: true, label: "Your story", img: true, aria: "Your story. N stories. Open it", plus: [44, 44], plusLabel: "Add to your story", same: 1, dupes: "" }, "the ring shows it at once, first, without a reload"); assert.deepEqual(await audit(page, "#rail"), [], "the ring and its +"); await shot(page, "ring-after");
    await tap(page, ".fv-mine [data-fv-story]"); await page.waitForSelector(".fv-sv [data-seen]"); assert.equal(await page.$(".fv-sv [data-live]"), null, "the live note is for the moment after sharing only"); await page.click(".fv-sv-x");
    await tap(page, "#fvAdd"); await page.waitForSelector(".stc .stc-start"); // the + opens the composer: a template makes a story that shares as it is
    await tap(page, '.stc [data-tpl="poll"]'); await page.waitForSelector(".stc .stc-stage"); S = await state(page); assert.deepEqual(S.slides[0].items.map((i) => i.t), ["text", "text", "poll"]); assert.deepEqual(await audit(page, ".stc"), [], "a template"); await shot(page, "sc-template");
    await tapAt(page, "canvas.stc-it"); await page.waitForSelector(".stc-edit textarea"); assert.equal(await page.$eval("#scTxt", (t) => t.value), "Help me pick", "tap the words to change them"); await page.keyboard.type("!"); await tap(page, ".stc-edit [data-done]");
    await page.unroute("**/api/story"); await tap(page, '.stc [data-a="next"]'); await page.waitForSelector(".stc-sheet [data-share]"); const made2 = page.waitForResponse((r) => /\/api\/story$/.test(r.url()) && r.request().method() === "POST"); await tap(page, ".stc-sheet [data-share]"); const R2 = await (await made2).json(); assert.equal(R2.ok, true, JSON.stringify(R2)); X.bust();
    assert.deepEqual(srv.store.get("system/pstory-" + R2.ids[0]).data.stickers.map((s) => [s.t, s.q, s.a, s.b]), [["poll", "Which night works?", "Friday", "Saturday"]], "the template's poll is a real poll"); await page.waitForSelector(".fv-sv [data-live]"); await page.click(".fv-sv-x");
    assert.ok((await getJ("/api/feed/stories", ana.cookie)).stories[0].items.filter((i) => i.st).length === 3, "three stories on her ring now"); await ctx.close();

    // ---- Ben, someone else: the viewer draws the stickers live
    ctx = await ctxFor(ben); page = await ctx.newPage(); watch(page); await page.goto(srv.base + "/feed", { waitUntil: "domcontentloaded" }); await page.waitForSelector(`[data-fv-story][aria-label^="Ana${W}"]`, { timeout: 20000 }); await page.waitForTimeout(400);
    await tap(page, `[data-fv-story][aria-label^="Ana${W}"]`); await page.waitForSelector(".fv-sv [data-sk-vote]", { timeout: 15000 }); await page.click(".fv-sv-pause");
    const vw = await page.evaluate(() => { const box = document.querySelector(".fv-sv-box").getBoundingClientRect(), P = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: (r.left + r.width / 2 - box.left) / box.width, y: (r.top + r.height / 2 - box.top) / box.height }; }; return { ratio: box.width / box.height, ev: P('.fv-sv [data-sk] a.sk-card'), href: document.querySelector(".fv-sv [data-sk] a.sk-card").getAttribute("href"), ph: document.querySelector("#svRe").placeholder, look: !!document.querySelector(".fv-sv .sk.v1 [data-sk-vote]") }; });
    assert.ok(Math.abs(vw.ratio - 9 / 16) < 0.01); assert.ok(Math.abs(vw.ev.x - d.stickers[0].x) < 0.02 && Math.abs(vw.ev.y - d.stickers[0].y) < 0.02, "the event sticker sits where it was put: " + JSON.stringify(vw.ev)); assert.equal(vw.href, "/e/" + EV); assert.equal(vw.ph, "Reply to Ana"); assert.ok(vw.look, "in the look it was given");
    assert.deepEqual(await audit(page, ".fv-sv"), [], "the viewer"); await shot(page, "sv-viewer");
    await tap(page, '.fv-sv [data-sk-vote="0"]'); await page.waitForSelector(".fv-sv .sk-res.me"); assert.match(await page.$eval(".fv-sv .sk-res.me", (e) => e.textContent), /Broth\s*100%/, "results after voting"); assert.equal(await page.$(".fv-sv [data-sk-vote]"), null, "one vote");
    await tap(page, ".fv-sv [data-react]"); await page.waitForSelector(".fv-sv [data-rx]:not([hidden])"); await tap(page, '.fv-sv [data-r="🔥"]'); await page.waitForFunction(() => /will see your/.test(document.querySelector("[data-sv-msg]").textContent));
    await page.fill("#svRe", "Save me a bowl"); await page.keyboard.press("Enter"); await page.waitForFunction(() => /Sent as a request\. Ana sees it under Requests\./.test(document.querySelector("[data-sv-msg]")?.textContent || "")); await shot(page, "sv-replied"); // Ben has no tie to Ana yet, so his reply is a message request (server/dm.js)
    assert.ok(await page.$(".fv-sv #svRe"), "typing a reply never moved the story on");
    await Promise.all([page.waitForURL((u) => new URL(u).pathname === "/e/" + EV, { timeout: 15000 }), tap(page, ".fv-sv [data-sk] a.sk-card")]);
    // the Share link: anyone who may see it lands on the story
    await page.goto(srv.base + "/feed?st=" + R.ids[1], { waitUntil: "domcontentloaded" }); await page.waitForSelector(".fv-sv .fv-sv-box img", { timeout: 20000 }); assert.equal(await page.$eval(".fv-sv .fv-sv-box img", (i) => i.getAttribute("src")), srv.store.get("system/pstory-" + R.ids[1]).data.url); await ctx.close();

    // ---- Ana again: who saw it, and the reply
    assert.equal(X.inbox(ana.email).filter((n) => n.kind === "story").length, 1, "one note for the reaction"); assert.equal(X.inbox(ana.email).filter((n) => n.kind === "dm").length, 1, "and the reply as a message request");
    ctx = await ctxFor(ana); page = await ctx.newPage(); watch(page); await page.goto(srv.base + "/feed?st=" + R.ids[0], { waitUntil: "domcontentloaded" }); await page.waitForSelector(".fv-sv .sv-sheet .sv-list", { timeout: 20000 }); // the bell note's link opens the story with what came back
    const ins = await page.$eval(".fv-sv .sv-sheet", (s) => s.innerText); assert.match(ins, /Seen by 1/i); assert.match(ins, /Ben\s*🔥/); assert.match(ins, /Ben\s+Save me a bowl/); assert.match(ins, /Broth\s+1 \(100%\)/); assert.deepEqual(await audit(page, ".fv-sv .sv-sheet"), [], "seen by"); await shot(page, "sv-seen-by");
    await tap(page, ".fv-sv .sv-sheet [data-x]"); assert.match(await page.$eval(".fv-sv [data-seen]", (b) => b.textContent), /Seen by 1 · 1 reply/); assert.ok(await page.$(".fv-sv [data-del]"), "Delete on your own"); assert.equal(await page.$(".fv-sv #svRe"), null, "no reply box on your own story");
    await page.click(".fv-sv-x"); await page.goto(srv.base + "/your-stories", { waitUntil: "domcontentloaded" }); await page.waitForSelector("#ysS", { timeout: 20000 }); assert.equal(await page.evaluate(() => document.querySelector("#ys .ys-sec").getAttribute("aria-labelledby")), "ysS", "Stories you made is the first section"); assert.equal(await page.$$eval("[data-sopen]", (L) => L.length), 3); await shot(page, "your-stories"); await ctx.close();
    assert.deepEqual(errs, [], "console clean, nothing failed");
  } finally { await browser.close(); }
});

test("browser at 390x664 (a phone with its browser bars): a guest-only person shares a blank page and sees it at once; a failed upload says so and keeps the draft", { timeout: 200_000 }, async (t) => {
  let pw; try { pw = createRequire(import.meta.url)("playwright"); } catch { return t.skip("playwright is not installed"); }
  let browser; try { browser = await pw.chromium.launch(); } catch { return t.skip("no Chromium here"); }
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}-664.png`) }); };
  const kit = await join("Kit Lane", "kit.sc@example.com"); M.resetLimits(); // never hosted, never opened the feed: no page of their own yet
  try { const ctx = await browser.newContext({ ...pw.devices["iPhone 13"], viewport: { width: 390, height: 664 }, serviceWorkers: "block" }); await ctx.addCookies(kit.cookie.split("; ").map((kv) => { const i = kv.indexOf("="); return { name: kv.slice(0, i), value: kv.slice(i + 1), url: srv.base }; }).concat([{ name: "encore_in", value: "1", url: srv.base }])); await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, body: "" }));
    const page = await ctx.newPage(), errs = []; page.on("pageerror", (e) => errs.push(e.message)); await page.goto(srv.base + "/feed", { waitUntil: "domcontentloaded" }); await page.waitForSelector("#fvAdd", { timeout: 20000 }); await page.waitForTimeout(500);
    await page.tap("#fvAdd"); await page.waitForSelector(".stc .stc-start"); await shot(page, "sc-start"); await page.tap('.stc [data-s="blank"]'); await page.waitForSelector(".stc .stc-stage");
    const w = await page.$eval(".stc-stage", (e) => e.getBoundingClientRect().width); assert.ok(w >= 295, "on a short phone the slide still gets most of the width: " + w); await shot(page, "sc-blank");
    await page.tap('.stc [data-tool="text"]'); await page.keyboard.type("Home tonight, come over"); await page.tap(".stc-edit [data-done]"); await shot(page, "sc-text");
    await page.tap('.stc [data-a="next"]'); await page.waitForSelector(".stc-sheet [data-share]"); assert.match(await page.$eval(".stc-sheet .stc-radio b", (b) => b.textContent), /Friends and followers/, "nobody is told Everyone when it isn't everyone");
    // the upload fails once: it says so, offers Try again, and the draft is still there
    let fail = true; await page.route("**/api/story/media**", (r) => (fail ? r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "The server hiccuped." }) }) : r.continue()));
    await page.tap(".stc-sheet [data-share]"); await page.waitForSelector(".stc-pub [data-again]:not([hidden])", { timeout: 15000 }); await page.waitForFunction(() => !document.querySelector(".stc-pub-acts").hidden); assert.match(await page.$eval(".stc-pub [data-ps]", (e) => e.textContent), /The server hiccuped\. Nothing was lost: your draft is saved\./); await shot(page, "sc-share-failed");
    assert.equal(await page.evaluate(() => new Promise((res) => { const r = indexedDB.open("pl-story"); r.onsuccess = () => { const q = r.result.transaction("kv").objectStore("kv").getAllKeys(); q.onsuccess = () => res(q.result.filter((k) => /^draft:/.test(k) && !/:m:/.test(k)).length); }; })), 1, "the draft is kept");
    fail = false; await page.tap(".stc-pub [data-again]"); await page.waitForSelector(".fv-sv [data-live]", { timeout: 20000 }); assert.match(await page.$eval(".fv-sv .sv-live-h", (e) => e.innerText), /Your story is live for 24 hours/); assert.ok(await page.$(".sv-burst"), "a soft burst when motion is allowed"); await shot(page, "sv-live");
    await page.waitForTimeout(1000); assert.equal(await page.$(".sv-burst"), null, "gone within a second"); await page.click(".fv-sv-x"); await page.waitForSelector(".fv-mine [data-fv-story]"); assert.equal(await page.$eval(".fv-mine small", (s) => s.textContent), "Your story"); await shot(page, "ring-after");
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForSelector(".fv-mine [data-fv-story]", { timeout: 20000 }); assert.equal(await page.$$eval(".fv-mine", (L) => L.length), 1, "still there, once, after a reload"); assert.deepEqual(errs, []); await ctx.close();
  } finally { await browser.close(); }
});
