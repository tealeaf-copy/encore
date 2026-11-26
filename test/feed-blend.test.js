// The blended feed (server/feedblend.js), Find people (server/findpeople.js) and the "+" sheet (public/composer.js):
// the rhythm rule, real reasons, what never shows, kudos and dismiss rules, where the button goes, contacts privacy,
// fan club posts for members, and the tiles each person gets.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { arrange, maxRun, MAX_RUN, nounOf, ord } from "../server/feedblend.js";
import { contactHashes, normEmail, normPhone } from "../server/findpeople.js";

let srv;
const J = { "content-type": "application/json" };
const post = (p, body, cookie) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body || {}) });
const get = (p, cookie) => fetch(srv.base + p, { headers: cookie ? { cookie } : {} });
const put = (p, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + p, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const key = (em) => Buffer.from(em).toString("base64url");
const U = {};
const cookies = (r, prev = "") => { const M = new Map(prev.split("; ").filter(Boolean).map((x) => [x.split("=")[0], x])); for (const c of r.headers.getSetCookie()) { const kv = c.split(";")[0]; M.set(kv.split("=")[0], kv); } return [...M.values()].join("; "); };
const join = async (who, name) => { const email = `${who}.fb@example.com`, r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }), b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); U[who] = { cookie: cookies(r), ws: b.workspace.id, email }; };
const reply = (host, id, eventId, email, extra = {}) => srv.store.set(`ws/${U[host].ws}/rsvps/${id}`, { eventId, email, name: extra.name || email.split(".")[0], response: "going", createdAt: Date.now() - 864e5, code: "C" + id, ...extra });
const feedOf = async (who) => { srv.app.locals.social.bust(); const r = await get("/api/me/feed", U[who].cookie); assert.equal(r.status, 200); return (await r.json()).blend; };

before(async () => {
  srv = await startServer();
  Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "fb-secret", ENCORE_SIGNUP_PER_HOUR: "500", ENCORE_FAKE_EMAIL: "1" }); resetLoginLimits();
  for (const [w, n] of [["ana", "Ana Ruiz"], ["maya", "Maya Okafor"], ["jun", "Jun Park"], ["sam", "Sam Idris"], ["lee", "Lee Carter"], ["theo", "Theo Marsh"], ["ivy", "Ivy Chen"], ["kit", "Kit Alvarez"], ["noor", "Noor Haddad"]]) await join(w, n);
  for (const [w, h, name, hood] of [["theo", "crumb-fb", "Crumb Theory", "Fort Greene"], ["ivy", "laps-fb", "Night Laps", "Prospect Park"], ["kit", "reads-fb", "Slow Reads", "Park Slope"]])
    assert.ok((await post("/api/host/profile", { handle: h, name, city: "Brooklyn", hood, tagline: "Small and calm." }, U[w].cookie)).ok);
  const ev = (w, id, d) => put("events/" + id, { kind: "social", casual: true, city: "Brooklyn", discoverable: true, published: true, ...d }, U[w].cookie);
  for (let i = 0; i < 10; i++) assert.equal((await ev("theo", "fbCt" + i, { name: "Crumb Supper", activity: "supper", hood: "Fort Greene", date: day(-4 - (9 - i) * 14) })).status, 200);
  await ev("theo", "fbCtUp", { name: "Winter Bread Supper", activity: "supper", hood: "Fort Greene", date: day(4), blurb: "Rye and a slow braise." });
  await ev("ivy", "fbRun1", { name: "Evening 5k", activity: "run", date: day(2) }); await ev("ivy", "fbRun2", { name: "Hill repeats", activity: "run", date: day(5) }); await ev("ivy", "fbRun3", { name: "Long slow run", activity: "run", date: day(8) });
  await ev("kit", "fbRead", { name: "Slow Reads: Train Dreams", activity: "book club", date: day(9) });
  await ev("kit", "fbPrivate", { name: "Private birthday", activity: "dinner", date: day(3), private: true, discoverable: false });
  await ev("kit", "fbUnlisted", { name: "Unlisted test run", activity: "dinner", date: day(3), discoverable: false, unlisted: true });
  await ev("kit", "fbFriends", { name: "Friends only picnic", activity: "picnic", date: day(3), friendsOnly: true });
  await ev("kit", "fbCancelled", { name: "Cancelled night", activity: "games", date: day(3), cancelled: true });
  // replies: Maya and Jun going to the bread supper; Lee going and opted in to show; Sam hid himself
  reply("theo", "fbR1", "fbCtUp", U.maya.email, { name: "Maya Okafor" }); reply("theo", "fbR2", "fbCtUp", U.jun.email, { name: "Jun Park" });
  reply("theo", "fbR3", "fbCtUp", U.lee.email, { name: "Lee Carter", showMe: true }); reply("theo", "fbR4", "fbCtUp", U.sam.email, { name: "Sam Idris", showMe: false });
  for (let i = 0; i < 3; i++) reply("theo", "fbRx" + i, "fbCtUp", `guest${i}.fb@example.org`);
  // Ana was at the 10th supper with Noor's friend Lee
  reply("theo", "fbP1", "fbCt9", U.ana.email, { name: "Ana Ruiz" }); reply("theo", "fbP2", "fbCt9", U.lee.email, { name: "Lee Carter" });
  // friends: Ana with Maya and Jun; Maya with Sam
  for (const [a, b] of [["ana", "maya"], ["ana", "jun"], ["maya", "sam"]]) { await post("/api/me/friends", { key: key(U[b].email) }, U[a].cookie); await post("/api/me/friends", { key: key(U[a].email) }, U[b].cookie); }
  await post("/api/me/following/laps-fb", { on: true }, U.maya.cookie); await post("/api/me/following/laps-fb", { on: true }, U.jun.cookie);
  await post("/api/me/following/crumb-fb", { on: true }, U.ana.cookie);
  srv.app.locals.social.bust();
});
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "fb-secret"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL", "ENCORE_FEED_KUDOS_PER_HOUR", "ENCORE_CONTACT_MATCH_PER_HOUR"]) delete process.env[k]; await srv.close(); });

test("Rhythm: never more than two of one kind in a row, the follow row early, leftovers in one row", () => {
  const E = (n) => Array.from({ length: n }, (_, i) => ({ key: "e" + i }));
  for (const pools of [{ event: E(9) }, { event: E(9), recap: E(1) }, { event: E(5), recap: E(4), milestone: E(2), post: E(3), club: E(2) }, { post: E(6), event: E(2) }]) {
    const L = arrange({ ...pools, follow: [{ key: "follow" }], ideas: [{ key: "ideas" }] });
    assert.ok(maxRun(L) <= MAX_RUN, `run of ${maxRun(L)}: ${L.map((x) => x.kind).join(",")}`);
    assert.equal(L.filter((x) => x.kind === "follow").length, 1); assert.ok(L.findIndex((x) => x.kind === "follow") <= 2);
    const placed = L.filter((x) => x.kind === "event").length, row = L.find((x) => x.kind === "row");
    assert.equal(placed + (row ? row.items.length : 0), (pools.event || []).length, "every event is placed once");
  }
  assert.equal(maxRun([{ kind: "a" }, { kind: "a" }, { kind: "a" }]), 3);
  assert.equal(nounOf({ name: "Crumb Supper" }), "supper"); assert.equal(nounOf({ activity: "run" }, true), "runs"); assert.equal(ord(10), "10th"); assert.equal(ord(3), "3rd");
});

test("The stream: followed hosts first, rhythm held, real social proof, every event button opens the event's own page", async () => {
  const B = await feedOf("ana");
  assert.ok(maxRun(B.items) <= 2);
  const ev = B.items.filter((x) => x.kind === "event");
  assert.equal(ev[0].id, "fbCtUp", "a host Ana follows ranks first");
  for (const e of [...ev, ...B.items.filter((x) => x.kind === "row").flatMap((r) => r.items)]) {
    assert.equal(e.cta.url, `/e/${e.id}`); assert.ok(!e.cta.url.startsWith("/@")); assert.ok(e.host.handle && e.host.page === `/@${e.host.handle}`); }
  const bread = ev.find((e) => e.id === "fbCtUp");
  // friends by first name; Lee opted in; Sam hid himself and is never named
  assert.equal(bread.proof.line, "Maya, Jun and 5 others are going");
  assert.deepEqual(bread.proof.faces.map((f) => f.name), ["Maya", "Jun", "Lee"]);
  assert.ok(!JSON.stringify(ev.map((e) => e.proof)).includes("Sam"), "a guest who hid himself is never named on a card");
  assert.ok(!B.items.find((x) => x.kind === "follow")?.cards.some((c) => c.name === "Sam" && /with you/.test(c.reason)), "nor suggested from that reply");
  assert.ok(!JSON.stringify(B).includes("Okafor"), "first names only");
  // the 10th supper: a milestone, and a recap only with photos
  const ms = B.items.find((x) => x.kind === "milestone"); assert.equal(ms.text, "Crumb Theory hosted their 10th supper"); assert.ok(ms.kudos.target.startsWith("m:"));
  assert.equal(B.cold, false);
  // the host's own card: Manage, and no Follow on themselves
  const own = (await feedOf("theo")).items.find((x) => x.id === "fbCtUp"); assert.equal(own.cta.label, "Manage"); assert.equal(own.host.mine, true);
});

test("Who to follow: every reason is a real one, nothing invented", async () => {
  const B = await feedOf("ana"), row = B.items.find((x) => x.kind === "follow"); assert.ok(row, "the follow row shows");
  const laps = row.cards.find((c) => c.handle === "laps-fb"); assert.equal(laps.reason, "2 friends follow");
  assert.ok(!row.cards.some((c) => c.handle === "crumb-fb"), "a host you follow isn't suggested");
  const ok = [/^\d+ friends? follows?$/, /^You went to their /, /^Hosts in /, /^\d+ people follow$/, /^[A-Z][a-z ]+ in /, /^\d+ [a-z ]+ coming up$/, /^Went to .+ with you$/, /^\d+ events together$/, /^Follows \d+ hosts you follow$/, /^Friends with [A-Z][a-z]+$/];
  for (const c of row.cards) assert.ok(ok.some((re) => re.test(c.reason)), `reason "${c.reason}"`);
  // Lee went to the 10th supper with Ana: a person suggestion with that reason
  const lee = row.cards.find((c) => c.type === "person" && c.name === "Lee"); assert.equal(lee?.reason, "Went to Crumb Supper with you");
  // a cold start: no friends, no follows, still a rich stream from real data
  const N = await feedOf("noor"); assert.equal(N.cold, true);
  const kinds = new Set(N.items.map((x) => x.kind)); for (const k of ["event", "follow", "milestone"]) assert.ok(kinds.has(k), `cold start has ${k}`);
  assert.ok(maxRun(N.items) <= 2);
});

test("Private, friends-only, unlisted, cancelled, sample and preview events never reach the stream", async () => {
  // a sample (demo) host with a public event
  const r = await post("/api/signup", { name: "Demo Dee", email: "dee@demo.encore", password: "long-password-1", mode: "friends" }), c = cookies(r);
  await post("/api/host/profile", { handle: "demo-fb", name: "Demo Supper", city: "Brooklyn" }, c);
  await put("events/fbDemo", { kind: "social", casual: true, name: "Demo night", activity: "supper", date: day(3), discoverable: true, published: true }, c);
  for (const who of ["ana", "noor"]) { const s = JSON.stringify(await feedOf(who));
    for (const id of ["fbPrivate", "fbUnlisted", "fbFriends", "fbCancelled", "fbDemo"]) assert.ok(!s.includes(id), `${id} hidden from ${who}`);
    assert.ok(!s.includes("demo-fb") && !/"\/x\//.test(s), "no sample hosts or preview pages"); }
  const pub = await (await get("/api/public/feed")).json(), s = JSON.stringify(pub.blend || {});
  for (const id of ["fbPrivate", "fbUnlisted", "fbFriends", "fbDemo"]) assert.ok(!s.includes(id));
});

test("Kudos and dismiss: signed in only, real targets, rate limited", async () => {
  assert.equal((await post("/api/feed/kudos", { target: "e:fbCtUp" })).status, 401);
  assert.equal((await post("/api/feed/kudos", { target: "e:fbCtUp", device: "abcdefgh12345" })).status, 401, "a device key alone isn't enough");
  assert.equal((await post("/api/feed/dismiss", { target: "host:laps-fb" })).status, 401);
  assert.equal((await post("/api/feed/kudos", { target: "e:fbPrivate" }, U.noor.cookie)).status, 404, "no kudos on a private event");
  assert.equal((await post("/api/feed/kudos", { target: "e:nope" }, U.noor.cookie)).status, 404);
  let j = await (await post("/api/feed/kudos", { target: "e:fbCtUp" }, U.noor.cookie)).json(); assert.equal(j.count, 1); assert.equal(j.mine, true);
  j = await (await post("/api/feed/kudos", { target: "e:fbCtUp" }, U.maya.cookie)).json(); assert.equal(j.count, 2);
  const B = await feedOf("ana"); assert.equal(B.items.find((x) => x.id === "fbCtUp").kudos.line, "Maya and 1 more gave kudos", "friends named, others counted");
  j = await (await post("/api/feed/kudos", { target: "e:fbCtUp" }, U.noor.cookie)).json(); assert.equal(j.count, 1); assert.equal(j.mine, false, "a second tap takes it back");
  // dismiss: gone from that person's follow row
  assert.equal((await post("/api/feed/dismiss", { target: "host:laps-fb" }, U.ana.cookie)).status, 200);
  assert.ok(!(await feedOf("ana")).items.find((x) => x.kind === "follow")?.cards.some((c) => c.handle === "laps-fb"));
  assert.equal((await post("/api/feed/dismiss", { target: "<script>" }, U.ana.cookie)).status, 400);
  process.env.ENCORE_FEED_KUDOS_PER_HOUR = "3"; let last = 0;
  for (let i = 0; i < 5; i++) last = (await post("/api/feed/kudos", { target: "e:fbRead" }, U.kit.cookie)).status;
  assert.equal(last, 429); delete process.env.ENCORE_FEED_KUDOS_PER_HOUR;
});

test("Fan club posts reach members only, the host first, and members-only events stay with members", async () => {
  assert.ok((await post("/api/host/club", { on: true, name: "Crumb Regulars" }, U.theo.cookie)).ok);
  assert.ok((await post("/api/me/club/crumb-fb/join", {}, U.ana.cookie)).ok);
  assert.ok((await post("/api/host/club/posts", { text: "Starter is bubbling for Thursday." }, U.theo.cookie)).ok);
  const mine = (await feedOf("ana")).items.find((x) => x.kind === "club");
  assert.ok(mine, "a member sees the club post"); assert.equal(mine.host.handle, "crumb-fb"); assert.equal(mine.club.name, "Crumb Regulars"); assert.ok(mine.report.startsWith("post:club.crumb-fb:"));
  assert.ok(!(await feedOf("noor")).items.some((x) => x.kind === "club"), "a non-member doesn't");
  // a members-only event
  await put("events/fbClubOnly", { kind: "social", casual: true, name: "Members' bread night", activity: "supper", date: day(6), discoverable: true, published: true }, U.theo.cookie);
  assert.ok((await post("/api/host/club/events/fbClubOnly", { visibility: "members" }, U.theo.cookie)).ok);
  assert.ok((await feedOf("ana")).items.some((x) => x.id === "fbClubOnly" && x.members), "members see it, marked for members");
  assert.ok(!JSON.stringify(await feedOf("noor")).includes("fbClubOnly"));
});

test("Find people: suggestions with reasons, search, blocks both ways", async () => {
  assert.equal((await get("/api/me/people/suggested")).status, 401);
  const S = await (await get("/api/me/people/suggested", U.ana.cookie)).json();
  assert.ok(S.people.some((p) => p.name === "Lee" && p.reason === "Went to Crumb Supper with you"));
  assert.ok(S.people.every((p) => p.reason && !/\s/.test(p.name)), "first names, real reasons");
  // Sam (friend of Maya) is suggested to Ana until one of them blocks the other
  assert.ok(S.people.some((p) => p.name === "Sam"));
  assert.ok((await post("/api/me/blocks", { kind: "person", key: key(U.ana.email), name: "Ana" }, U.sam.cookie)).ok);
  const S2 = await (await get("/api/me/people/suggested", U.ana.cookie)).json(); assert.ok(!S2.people.some((p) => p.name === "Sam"), "they blocked her: never suggested");
  const q = await (await get("/api/me/people/search?q=sam", U.ana.cookie)).json(); assert.ok(!q.people.some((p) => p.name === "Sam"));
  const h = await (await get("/api/me/people/search?q=night", U.noor.cookie)).json(); assert.ok(h.hosts.some((x) => x.handle === "laps-fb"));
});

test("Contacts: only people who opted in match, blocks hold, no hash is stored, rate limited", async () => {
  assert.equal(normEmail(" Maya.FB@Example.com "), "maya.fb@example.com"); assert.equal(normPhone("+1 (415) 555-0101"), normPhone("415 555 0101"));
  const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
  const H = [hash("e:" + U.maya.email), hash("e:" + U.lee.email), hash("e:" + U.jun.email), hash("e:nobody@example.com")];
  assert.equal((await post("/api/me/people/match", { hashes: H })).status, 401);
  assert.deepEqual(await (await get("/api/me/findable", U.maya.cookie)).json(), { on: false }, "off by default");
  let j = await (await post("/api/me/people/match", { hashes: H }, U.noor.cookie)).json(); assert.equal(j.matches.length, 0, "no one opted in yet");
  for (const w of ["maya", "lee"]) assert.ok((await post("/api/me/findable", { on: true }, U[w].cookie)).ok);
  j = await (await post("/api/me/people/match", { hashes: H }, U.noor.cookie)).json();
  assert.deepEqual(j.matches.map((m) => m.name).sort(), ["Lee", "Maya"], "Jun didn't opt in"); assert.ok(j.matches.every((m) => m.reason === "In your contacts" && !m.email));
  assert.deepEqual(contactHashes({ email: U.maya.email }), [H[0]]);
  // Lee blocks Noor: no match either way
  assert.ok((await post("/api/me/blocks", { kind: "person", key: key(U.noor.email), name: "Noor" }, U.lee.cookie)).ok);
  j = await (await post("/api/me/people/match", { hashes: H }, U.noor.cookie)).json(); assert.deepEqual(j.matches.map((m) => m.name), ["Maya"]);
  // nothing sent is kept: no hash anywhere in the store
  const dump = fs.readFileSync(srv.dir + "/test.db").toString("latin1") + JSON.stringify(srv.store.listPrefix("system", ""));
  for (const h of H) assert.ok(!dump.includes(h), "hash not stored");
  assert.equal((await post("/api/me/people/match", { hashes: ["nothex"] }, U.noor.cookie)).status, 200);
  assert.equal((await post("/api/me/people/match", { hashes: Array(1001).fill(H[0]) }, U.noor.cookie)).status, 413);
  process.env.ENCORE_CONTACT_MATCH_PER_HOUR = "1"; let last = 0;
  for (let i = 0; i < 3; i++) last = (await post("/api/me/people/match", { hashes: H }, U.jun.cookie)).status;
  assert.equal(last, 429); delete process.env.ENCORE_CONTACT_MATCH_PER_HOUR;
  // the settings toggle and the page exist
  assert.match(fs.readFileSync(new URL("../public/settings.html", import.meta.url), "utf8"), /Let people find me by email or phone/);
  const page = await get("/people"); assert.equal(page.status, 200); const html = await page.text();
  for (const s of ["Hosts &amp; clubs", "Suggested", "Contacts", "My code", "Invite friends who aren't on Pottery Lab", "/qr.js", "crypto.subtle"]) assert.ok(html.includes(s), s);
  assert.match(fs.readFileSync(new URL("../public/qr.js", import.meta.url), "utf8"), /MIT license/);
});

test("The + sheet: a Create button on the feed, tiles that fit each person, posts through the feed's own endpoint", async () => {
  const feed = await (await get("/feed")).text(); assert.ok(feed.includes('src="/composer.js"'));
  const js = fs.readFileSync(new URL("../public/composer.js", import.meta.url), "utf8");
  assert.ok(js.includes('aria-label", "Create"') && js.includes("prefers-reduced-motion") && js.includes("safe-area-inset-bottom"));
  assert.ok(js.includes('"/api/me/posts"') && js.includes('"/api/host/club/posts"') && !/\u2014/.test(js), "the feed's own posts and the club's, no em dashes");
  assert.deepEqual(await (await get("/api/me/compose")).json(), { signedIn: false, tiles: [] });
  const tiles = async (w) => (await (await get("/api/me/compose", U[w].cookie)).json()).tiles;
  assert.deepEqual(await tiles("noor"), ["event"], "a new member: a new event only");
  assert.deepEqual(await tiles("ana"), ["event", "photos"], "went to something: photos from it");
  assert.deepEqual(await tiles("kit"), ["event", "drop"], "a host: a drop too");
  assert.deepEqual(await tiles("theo"), ["event", "drop", "photos", "club"], "a host with a fan club on: an update for members");
  // a "Who's in?" post through the existing endpoint shows in a friend's stream
  const r = await post("/api/me/posts", { text: "Dumplings at mine Friday?", ask: true }, U.maya.cookie); assert.equal(r.status, 200);
  const p = (await feedOf("ana")).items.find((x) => x.kind === "post" && x.text === "Dumplings at mine Friday?"); assert.ok(p); assert.equal(p.ask, true);
});
