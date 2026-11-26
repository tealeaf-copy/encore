// "Come with me?" (server/comewith.js, public/comewith.js) and "Host one like this" (server/hostlike.js,
// public/hostlike.js): the link, the 48-hour hold against the cap, pairs, Ask to join, who came together, the draft
// prompt and the "hosted this after seeing it" count.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { holdsOf, tokenHash, togetherOf, unitSize, HOLD_MS } from "../server/comewith.js";
import { promptFor, roughPrice, roughSize } from "../server/hostlike.js";
import { seatsTaken } from "../server/social.js";

let srv, host;
const J = { "content-type": "application/json" };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
before(async () => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "cwm-secret-0123456789abcdef"; process.env.ENCORE_FAKE_EMAIL = "1"; resetLoginLimits(); srv = await startServer();
  const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name: "Ada Host", email: "ada.cwm@example.com", password: "long-password-1", mode: "friends" }) });
  host = r.headers.get("set-cookie").split(";")[0];
  assert.equal((await fetch(srv.base + "/api/host/profile", { method: "POST", headers: { ...J, cookie: host }, body: JSON.stringify({ handle: "ada-cwm", name: "Ada Host" }) })).status, 200); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv.close(); });

const put = (id, d) => fetch(srv.base + "/api/db/doc?path=events/" + id, { method: "PUT", headers: { ...J, cookie: host }, body: JSON.stringify(d) });
async function reply(eventId, key, { name, email = "", resp = "going", cookie = "", party } = {}) {
  const doc = await (await fetch(srv.base + "/api/db/doc?path=" + encodeURIComponent("events/" + eventId), { headers: { "x-encore-guest": "1" } })).json();
  const ask = !!doc.data.approvalRequired, code = "C" + key.slice(-5).toUpperCase();
  const data = { eventId, response: ask && resp !== "no" ? "requested" : resp, name, email, code, createdAt: Date.now(), via: "invite-lite", ...(party ? { party } : {}) };
  const r = await fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, "x-encore-guest": "1", "x-encore-key": key, "x-encore-workspace": doc.workspace, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(data) });
  const j = await r.json(); return { status: r.status, j, rid: String(j.id || "").split("/").pop(), code };
}
const link = (eventId, rid, code) => fetch(srv.base + "/api/public/come-with", { method: "POST", headers: J, body: JSON.stringify({ eventId, rid, code }) });
const open = async (eventId, token) => { const r = await fetch(`${srv.base}/api/public/come-with/${eventId}/${token}`); return { j: await r.json(), cookie: (r.headers.get("set-cookie") || "").split(";")[0] }; };
const rsvp = async (rid) => (await (await fetch(srv.base + "/api/db/doc?path=rsvps/" + rid, { headers: { cookie: host } })).json()).data;

test("Come with me?: the link holds one spot for 48 hours, the friend fills it, and both show together", async () => {
  await put("cwopen", { kind: "social", casual: true, name: "Salsa Sunday", date: day(5), startTime: "19:00", published: true, discoverable: true, headcount: 3 });
  const mia = await reply("cwopen", "key-mia-0001", { name: "Mia Lopez", email: "mia@example.com" }); assert.equal(mia.j.response, "going");
  // only the reply's own proof makes a link
  assert.equal((await link("cwopen", mia.rid, "WRONG")).status, 403);
  const L = await (await link("cwopen", mia.rid, mia.code)).json();
  assert.ok(L.ok); assert.match(L.url, /^\/i\/cwopen\?with=[A-Za-z0-9_-]{24}$/); assert.ok(L.held?.until > Date.now() + HOLD_MS - 60e3, "held for 48 hours");
  // the token is not stored, only its hash
  const saved = await rsvp(mia.rid); assert.equal(saved.withHolds.length, 1); assert.equal(saved.withHolds[0].h, tokenHash(L.token)); assert.ok(!JSON.stringify(saved).includes(L.token));
  // the hold counts toward the cap: Mia + her friend's spot + one stranger = 3; the next stranger waits
  const s1 = await reply("cwopen", "key-sam-0001", { name: "Sam Park", email: "sam@example.com" }); assert.equal(s1.j.response, "going");
  const s2 = await reply("cwopen", "key-lee-0001", { name: "Lee Wong", email: "lee@example.com" }); assert.equal(s2.j.response, "waitlist", "the held spot isn't up for grabs");
  const A0 = await (await fetch(srv.base + "/api/public/attendees/cwopen")).json(); assert.equal(A0.left, 0);
  // the friend opens the link: who sent it and the held spot; the cookie it sets lets the attendees count it as theirs
  const o = await open("cwopen", L.token); assert.equal(o.j.ok, true); assert.equal(o.j.from.name, "Mia"); assert.equal(o.j.title, "Salsa Sunday"); assert.ok(o.j.held);
  assert.match(o.cookie, /^plw_cwopen=/);
  const A1 = await (await fetch(srv.base + "/api/public/attendees/cwopen", { headers: { cookie: o.cookie } })).json(); assert.equal(A1.left, 1, "the friend sees their spot");
  const pv = await (await fetch(srv.base + L.url)).text(); assert.match(pv, /og:title" content="Mia wants you to come to Salsa Sunday"/, "the link preview says who sent it");
  // a guessed token reads nothing
  assert.equal((await open("cwopen", "A".repeat(24))).j.ok, false);
  const jo = await reply("cwopen", "key-jo-00001", { name: "Jo Kim", email: "jo@example.com", cookie: o.cookie }); assert.equal(jo.j.response, "going", "the friend's I'm in fills the held spot even with a waitlist");
  const jd = await rsvp(jo.rid); assert.equal(jd.withOf, mia.rid);
  assert.equal((await rsvp(mia.rid)).withHolds[0].by, jo.rid, "the hold is used up");
  // the link works once
  const again = await reply("cwopen", "key-zed-0001", { name: "Zed", email: "zed@example.com", cookie: o.cookie }); assert.equal(again.j.response, "waitlist");
  const A2 = await (await fetch(srv.base + "/api/public/attendees/cwopen")).json();
  assert.deepEqual(A2.together.map((t) => t.line), ["Mia and Jo are in"]); assert.equal(A2.together[0].people.length, 2);
  // the feed card says it too (public, listed)
  const F = await (await fetch(srv.base + "/api/public/feed")).json(), card = F.upcoming.find((e) => e.id === "cwopen");
  assert.equal(card.together[0].line, "Mia and Jo are in"); assert.deepEqual(card.together[0].people.map((p) => p.name), ["Mia", "Jo"]);
});

test("Come with me?: holds run out after 48 hours, at most three at once, and links are rate limited", async () => {
  const ev = { headcount: 4 }, now = Date.now(), r = { response: "going", withHolds: [{ h: "a", exp: now + 1000 }, { h: "b", exp: now - 1 }, { h: "c", exp: now + 1000, by: "x" }] };
  assert.equal(holdsOf(r, ev, now), 1, "only open, unexpired holds count");
  assert.equal(holdsOf({ ...r, response: "maybe" }, ev, now), 0, "an inviter who isn't in holds nothing");
  assert.equal(holdsOf(r, { ...ev, approvalRequired: true }, now), 0); assert.equal(holdsOf(r, { ...ev, headUnit: "pairs" }, now), 0);
  assert.equal(seatsTaken(ev, [{ id: "1", data: r }]), 2);
  await put("cwmany", { kind: "social", casual: true, name: "Board games", date: day(4), published: true, headcount: 20 });
  const g = await reply("cwmany", "key-many-001", { name: "Rae", email: "rae@example.com" });
  for (let i = 0; i < 3; i++) assert.equal((await link("cwmany", g.rid, g.code)).status, 200);
  const four = await link("cwmany", g.rid, g.code); assert.equal(four.status, 429); assert.match((await four.json()).message, /holding 3 spots/);
  // a Maybe can't make one
  const m = await reply("cwmany", "key-many-002", { name: "Kai", email: "kai@example.com", resp: "maybe" }); assert.equal((await (await link("cwmany", m.rid, m.code)).json()).code, "reply_first");
});

test("Come with me?: on a pairs event the friend joins the inviter's pair instead of taking a new one", async () => {
  await put("cwpair", { kind: "social", casual: true, name: "Bachata for two", date: day(6), published: true, headUnit: "pairs", groupSize: 2, unitCount: 2, headcount: 4 });
  assert.equal(unitSize({ headUnit: "pairs" }), 2);
  const a = await reply("cwpair", "key-pair-001", { name: "Mia", email: "mia2@example.com", party: 2 });
  const b = await reply("cwpair", "key-pair-002", { name: "Ben", email: "ben@example.com", party: 2 }); assert.equal(b.j.response, "going");
  const L = await (await link("cwpair", a.rid, a.code)).json(); assert.equal(L.pair, true); assert.equal(L.held, null, "nothing new to hold");
  const o = await open("cwpair", L.token); assert.equal(o.j.pair, true);
  const jo = await reply("cwpair", "key-pair-003", { name: "Jo", email: "jo2@example.com", cookie: o.cookie, party: 2 }); assert.equal(jo.j.response, "going", "the event is full of pairs, but Jo joins Mia's");
  const jd = await rsvp(jo.rid); assert.equal(jd.pairOf, a.rid); assert.ok(!jd.party);
  const A = await (await fetch(srv.base + "/api/public/attendees/cwpair")).json(); assert.equal(A.count, 4, "still two pairs"); assert.equal(A.left, 0);
  assert.equal((await link("cwpair", a.rid, a.code)).status, 409, "the pair is full");
  const s = await reply("cwpair", "key-pair-004", { name: "Sol", email: "sol@example.com", party: 2 }); assert.equal(s.j.response, "waitlist");
});

test("Come with me?: Ask to join events still ask; the link lets no one in", async () => {
  await put("cwask", { kind: "social", casual: true, name: "Supper club", date: day(6), published: true, approvalRequired: true, headcount: 2 });
  const a = await reply("cwask", "key-ask-0001", { name: "Mia", email: "mia3@example.com" }); assert.equal(a.j.response, "requested");
  assert.equal((await (await link("cwask", a.rid, a.code)).json()).code, "reply_first", "not let in yet, so no link");
  // the host lets Mia in, then she brings a friend: the friend still asks
  await fetch(srv.base + "/api/db/doc?path=rsvps/" + a.rid, { method: "PATCH", headers: { ...J, cookie: host }, body: JSON.stringify({ response: "going", letInAt: Date.now() }) });
  const L = await (await link("cwask", a.rid, a.code)).json(); assert.equal(L.ask, true); assert.equal(L.held, null);
  const o = await open("cwask", L.token); assert.equal(o.j.ask, true); assert.equal(o.j.held, null);
  const f = await reply("cwask", "key-ask-0002", { name: "Jo", email: "jo3@example.com", cookie: o.cookie }); assert.equal(f.j.response, "requested");
});

test("Come with me?: a signed-in person makes one from a feed card, from their own reply", async () => {
  const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name: "Nia Guest", email: "nia.cwm@example.com", password: "long-password-1", mode: "friends" }) });
  const nia = r.headers.get("set-cookie").split(";")[0];
  const mk = () => fetch(srv.base + "/api/me/come-with", { method: "POST", headers: { ...J, cookie: nia }, body: JSON.stringify({ eventId: "cwmany" }) });
  assert.equal((await (await mk()).json()).code, "reply_first");
  await reply("cwmany", "key-nia-0001", { name: "Nia Guest", email: "nia.cwm@example.com" });
  const j = await (await mk()).json(); assert.ok(j.ok); assert.match(j.url, /^\/i\/cwmany\?with=/);
  assert.equal((await fetch(srv.base + "/api/me/come-with", { method: "POST", headers: J, body: "{}" })).status, 401);
});

test("togetherOf: names only where the event shows its guests", () => {
  const D = [{ id: "a", data: { eventId: "e", response: "going", name: "Mia" } }, { id: "b", data: { eventId: "e", response: "going", name: "Jo", withOf: "a" } }, { id: "c", data: { eventId: "e", response: "going", name: "Al", withOf: "a" } }];
  assert.equal(togetherOf(D, {}, "e")[0].line, "Mia, Jo and Al are in");
  assert.deepEqual(togetherOf(D, { hideGuests: true }, "e"), []);
  assert.deepEqual(togetherOf([D[0], { id: "b", data: { ...D[1].data, showMe: false } }], {}, "e"), []);
});

test("Host one like this: the prompt has the title, kind, rough price and size and the visitor's city, never the address or names", async () => {
  const ev = { name: "Dumpling night", activity: "dinner", price: "$23", headcount: 14, venueName: "Ada's loft", address: "12 Main St", hostName: "Ada", city: "Brooklyn" };
  assert.equal(roughPrice(ev), "about $25 a person"); assert.equal(roughSize(ev), "about 15 people"); assert.equal(roughPrice({ price: "free" }), "free"); assert.equal(roughSize({ headUnit: "pairs", unitCount: 6, headcount: 12 }), "6 pairs");
  const p = promptFor(ev, "Oakland"); assert.equal(p, "Dumpling night: a dinner for about 15 people, about $25 a person, in Oakland");
  assert.doesNotMatch(p, /Main St|loft|Ada|Brooklyn/);
  await put("hlpast", { kind: "social", casual: true, name: "Pottery wheel night", activity: "pottery", date: day(-3), published: true, discoverable: true, price: "$40", headcount: 8, address: "9 Secret Ln", venueName: "Ada's studio" });
  const j = await (await fetch(srv.base + "/api/public/like/hlpast")).json();
  assert.equal(j.ok, true); assert.equal(j.title, "Pottery wheel night"); assert.equal(j.price, "about $40 a person"); assert.equal(j.size, "8 people"); assert.equal(j.past, true); assert.equal(j.hosted, 0); assert.equal(j.line, "");
  assert.doesNotMatch(JSON.stringify(j), /Secret|studio|Ada/);
});

test("Host one like this: counts hosts who shared a draft made from the event, once each, never the source host", async () => {
  const sign = async (n) => (await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name: "Host " + n, email: `hl${n}@example.com`, password: "long-password-1", mode: "friends" }) })).headers.get("set-cookie").split(";")[0];
  const started = (c, key, draftId) => fetch(srv.base + `/api/me/like/${key}/started`, { method: "POST", headers: { ...J, cookie: c }, body: JSON.stringify({ draftId }) });
  for (let i = 1; i <= 3; i++) { const c = await sign(i), id = "hlnew" + i;
    await fetch(srv.base + "/api/db/doc?path=events/" + id, { method: "PUT", headers: { ...J, cookie: c }, body: JSON.stringify({ kind: "social", casual: true, name: "Pottery wheel night", date: day(10), likeOf: "hlpast", ...(i < 3 ? { published: true } : {}) }) });
    assert.equal((await started(c, "hlpast", id)).status, 200); if (i === 1) await started(c, "hlpast", id); }
  assert.equal((await started(host, "hlpast", "hlpast")).status, 200);
  const j = await (await fetch(srv.base + "/api/public/like/hlpast")).json();
  assert.equal(j.hosted, 2, "two shared theirs; the third is still a draft; the source host doesn't count"); assert.equal(j.line, "2 people hosted this after seeing it");
  assert.deepEqual((await (await fetch(srv.base + "/api/public/like-counts?ids=hlpast,cwask")).json()).counts, { hlpast: 2 });
  // a private event never shows the count
  await put("hlpriv", { kind: "social", casual: true, name: "Secret supper", date: day(-2), published: true });
  assert.equal((await fetch(srv.base + "/api/public/like/hlpriv")).status, 404, "a private event is no such event to anyone but its host");
  assert.equal((await (await fetch(srv.base + "/api/public/like/hlpriv", { headers: { cookie: host } })).json()).line, "", "its host can still copy it, with no count");
  assert.equal((await started("", "hlpast", "x1")).status, 401);
});

test("Come with me? and Host one like this: wiring and copy", () => {
  const inv = read("public/invite.html"); assert.ok(inv.length < 40000, "the light invite stays small"); assert.match(inv, /\/comewith\.js/); assert.match(inv, /\^\\\/\[ei\]\\\//);
  const cw = read("public/comewith.js"), hl = read("public/hostlike.js"), fv = read("public/feedvisual.js"), sb = read("public/scrapbook.js"), spa = read("index.html");
  assert.match(cw, /wants you to come to/); assert.match(cw, /<span>Invite friends<\/span>/); assert.doesNotMatch(cw.replace(/^\/\/.*$/gm, ""), /Come with me\?/, "the button says Invite friends now"); assert.match(cw, /We'll hold a spot for a friend for 48 hours\./); assert.match(cw, /ShareKit\.open/); assert.match(cw, /navigator\.share/); assert.match(cw, /clipboard\.writeText/); assert.match(cw, /PLFriends/);
  assert.match(hl, /Host one like this/); assert.match(hl, /hosted this after seeing it/); assert.match(hl, /\/signup\?mode=friends&from=like/); assert.match(hl, /data-casualidea|dataset\.casualidea/);
  assert.match(fv, /data-fv-with/); assert.match(fv, />Invite friends<\/button>/); assert.match(fv, /data-pl-like/); assert.match(fv, /data-fv-together/); assert.match(sb, /data-pl-like/);
  const tail = spa.slice(spa.lastIndexOf("<script>")); assert.match(tail, /comewith\.js/); assert.match(tail, /hostlike\.js/); assert.ok(tail.length < 900, "a small appended block");
  for (const t of [cw, hl, read("server/comewith.js"), read("server/hostlike.js"), tail]) { assert.doesNotMatch(t, /—/, "no em dashes"); assert.doesNotMatch(t.replace(/\/api\/public\/attendees/g, ""), /per person|attendees|RSVP yes|I.m going|seamless|unlock|curated/i); }
});
