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
  assert.equal((await fetch(srv.base + "/api/story/media?as=video&duration=45", { method: "POST", headers: { "content-type": "video/mp4", cookie: U.mai.cookie }, body: MP4 })).status, 400, "30 seconds at most");
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
  assert.equal((await post(`/api/story/${P.st}/reply`, { text: "Save me a seat <b>please</b>, call 212 555 0142" }, U.zed.cookie)).status, 200); assert.equal((await post(`/api/story/${P.st}/reply`, { text: "and one for Jun" }, U.zed.cookie)).status, 200);
  const re = bell().filter((n) => /^st-re-/.test(n.key)); assert.equal(re.length, 1, "two replies, one note"); assert.equal(re[0].text, "Zed sent 2 replies to your story");
  assert.equal((await post(`/api/story/${P.st}/answer`, { sticker: "q", text: "What should I bring?" }, U.linh.cookie)).status, 200); assert.equal((await post(`/api/story/${P.st}/answer`, { sticker: "p", text: "x" }, U.linh.cookie)).status, 404);
  assert.equal(bell().find((n) => /^st-q-/.test(n.key)).text, 'Linh answered "Ask me something": What should I bring?');
  assert.equal(X.inbox(U.zed.email).filter((n) => n.kind === "story").length, 0); assert.equal(X.inbox(U.linh.email).filter((n) => n.kind === "story").length, 0);
  const I = await getJ(`/api/story/${P.st}/insights`, U.mai.cookie); assert.deepEqual(I.replies.map((r) => [r.name, r.text]).reverse(), [["Zed", "Save me a seat please , call …"], ["Zed", "and one for Jun"]]);
  assert.deepEqual(I.stickers.find((s) => s.id === "q").answers.map((a) => [a.name, a.text]), [["Linh", "What should I bring?"]]); assert.ok(!JSON.stringify(I).includes("@example.com"), "names only, never an address");
  for (const who of [U.zed, U.linh, U.jun]) assert.equal((await get(`/api/story/${P.st}/insights`, who.cookie)).status, 404, "insights are the author's");
  assert.equal((await get(`/api/story/${P.st}/insights`)).status, 401);
  const zedSees = JSON.stringify((await ring("mai-sc", U.zed.cookie)).items.find((i) => i.st?.sid === P.st)); assert.ok(!zedSees.includes("What should I bring") && !zedSees.includes("Save me a seat"), "a viewer never gets other people's replies");
});

test("seen by: counted once per person, for the author only", async () => {
  assert.equal((await post("/api/story/seen", { ids: [P.st] })).status, 401);
  assert.equal((await (await post("/api/story/seen", { ids: [P.st, P.st, "nope"] }, U.zed.cookie)).json()).seen, 1); assert.equal((await (await post("/api/story/seen", { ids: [P.st] }, U.zed.cookie)).json()).seen, 0);
  await post("/api/story/seen", { ids: [P.st] }, U.linh.cookie); assert.equal((await (await post("/api/story/seen", { ids: [P.st] }, U.mai.cookie)).json()).seen, 0, "your own look doesn't count");
  const I = await getJ(`/api/story/${P.st}/insights`, U.mai.cookie); assert.equal(I.count, 2); assert.deepEqual(I.seen.map((s) => s.name).sort(), ["Linh", "Zed"]); assert.equal(I.seen.find((s) => s.name === "Zed").react, "😍");
  const own = (await ring("mai-sc", U.mai.cookie)).items.find((i) => i.st?.sid === P.st).st; assert.equal(own.seen, 2); assert.equal(own.replies, 3);
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
