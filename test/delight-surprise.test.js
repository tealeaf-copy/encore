// The small personal surprises (server/surprise.js, public/surprise.js, public/surprise-host.js):
// 17 a cover drawn for this event, 18 milestones and regulars, 19 the line at the top of an invite, 20 the send-off.
// Each one says only what is true and what the viewer may know. Then a browser check at 390 (iPhone 13).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore, workspaceOfEvent } from "../server/workspaces.js";
import { cleanSvg } from "../server/art.js";
import { composeTitleArt, titleMotifs, milestonesFrom, foldMilestones, visitsOf, regularsOf, inviteLine, sendOffLine, rewordOk, SURPRISE_EVENTS } from "../server/surprise.js";
import { EVENTS } from "../server/posthog.js";

let srv;
const J = { "content-type": "application/json" };
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "delight-surprise-secret", ENCORE_SIGNUP_PER_HOUR: "200", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_SMS: "1" };
const SHOTS = process.env.DELIGHT_SHOTS || path.join(os.tmpdir(), "delight-surprise");
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const U = {};
async function signup(key, name, email) { const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name, email, password: "long-password-1", mode: "friends" }) });
  assert.equal(r.status, 200, key + " signs up"); U[key] = { name, email, cookie: r.headers.get("set-cookie").split(";")[0] }; return U[key]; }
const req = (method, p, body, who, headers = {}) => fetch(srv.base + p, { method, headers: { ...J, ...(who ? { cookie: who.cookie } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
const put = (id, d, who) => req("PUT", "/api/db/doc?path=events/" + id, d, who);
const St = (id) => scopeStore(srv.store, workspaceOfEvent(id));
let rn = 0;
const rsvp = (eventId, who, extra = {}) => St(eventId).set("rsvps/r" + ++rn, { eventId, response: "going", name: who.name, email: who.email, createdAt: Date.now() - 1e6 + rn, ...extra });
const bust = () => srv.app.locals.social.bust();
const EA = (() => { const box = { window: {}, document: undefined }; vm.runInNewContext(read("public/eventart.js"), box); return box.window.EventArt; })();

before(async () => { Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer();
  await signup("maya", "Maya Chen", "maya.ds@example.com"); await signup("jun", "Jun Park", "jun.ds@example.com"); await signup("priya", "Priya Rao", "priya.ds@example.com");
  await signup("sam", "Sam Ortiz", "sam.ds@example.com"); await signup("noor", "Noor Ali", "noor.ds@example.com"); await signup("lee", "Lee Wong", "lee.ds@example.com");
  assert.equal((await req("POST", "/api/host/profile", { handle: "maya-cooks", name: "Maya's Table" }, U.maya)).status, 200); });
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

// ---------------------------------------------------------------- 17
test("17: a cover drawn for this event: composed from the title's nouns, clean, no words, not the generic drawing", () => {
  const M = titleMotifs("Dumpling night with Jun"); assert.ok(M.kinds.includes("dumpling"), "dumplings, from the library's own word list"); assert.ok(M.accents.includes("night"));
  const a = composeTitleArt("Dumpling night with Jun", { seed: "ev1" }), b = composeTitleArt("Taco Tuesday and board games", { seed: "ev2" });
  assert.ok(a.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150">'), "a 200x150 drawing");
  assert.equal(cleanSvg(a.svg), a.svg, "already only the allowed shapes and attributes (server/art.js cleanSvg)");
  assert.doesNotMatch(a.svg, /<text|<image|href|style=|script|Jun|Dumpling/i, "no words, no images, no links: never the title inside the drawing");
  assert.doesNotMatch(a.svg, /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/u, "never an emoji");
  assert.deepEqual(b.kinds.slice(0, 2), ["taco", "games"], "each noun gets its drawing, in title order");
  assert.notEqual(a.svg, b.svg); assert.notEqual(a.svg, cleanSvg(EA.drawing("party", "#29489A")), "its own drawing, not generic art");
  assert.equal(composeTitleArt("Dumpling night with Jun", { seed: "ev1" }).svg, a.svg, "the same title draws the same picture");
  assert.ok(composeTitleArt("Saturday thing", { seed: "x" }).svg, "a title with no drawable noun still gets a drawing");
});

test("17: the drawing is made once per event and title (cached), then saved as the one shared cover and shown everywhere", async () => {
  const id = "dsDumpling", d0 = day(-40);
  assert.equal((await put(id, { kind: "social", casual: true, name: "Dumpling night with Jun", date: day(9), startTime: "19:00", published: true, discoverable: true, headcount: 12, why: "We fold 40 dumplings together, then eat them." }, U.maya)).status, 200);
  assert.equal((await req("POST", "/api/art/for-event", { eventId: id }, null)).status, 401, "hosts only");
  assert.equal((await req("POST", "/api/art/for-event", { eventId: id }, U.jun)).status, 404, "only for your own event");
  const r1 = await (await req("POST", "/api/art/for-event", { eventId: id }, U.maya)).json();
  assert.ok(r1.svg && r1.kinds.includes("dumpling")); assert.equal(r1.cached, false); assert.equal(r1.source, "rules", "offline: rule-based composition");
  const r2 = await (await req("POST", "/api/art/for-event", { eventId: id }, U.maya)).json(); assert.equal(r2.cached, true); assert.equal(r2.svg, r1.svg, "cached per event");
  assert.equal(St(id).get("titleart/" + id).data.svg, r1.svg, "kept in titleart/<event>");
  const r3 = await (await req("POST", "/api/art/for-event", { eventId: id, title: "Taco night with Jun" }, U.maya)).json(); assert.equal(r3.cached, false, "a new title draws again"); assert.ok(r3.kinds.includes("taco"));
  const r4 = await (await req("POST", "/api/art/for-event", { eventId: id }, U.maya)).json(); assert.equal(r4.svg, r1.svg);
  // the page saves it the shared cover way (public/surprise-host.js art()): coverArt { kind: "custom", svg, prompt, tone }
  const ev = St(id).get("events/" + id).data; await put(id, { ...ev, coverPhoto: "", coverArt: { kind: "custom", svg: r1.svg, prompt: r1.prompt, tone: "blush", drawnFor: "title" } }, U.maya);
  assert.equal((await (await req("POST", "/api/art/for-event/used", { eventId: id }, U.maya)).json()).ok, true);
  const guest = await (await fetch(srv.base + "/api/db/doc?path=" + encodeURIComponent("events/" + id), { headers: { "x-encore-guest": "1" } })).json();
  assert.equal(guest.data.coverArt.svg, r1.svg, "guests read the same drawing");
  const big = EA.cover(guest.data), small = EA.cover({ id, title: guest.data.name, coverArt: guest.data.coverArt }, { title: "", label: "" }), enc = encodeURIComponent(r1.svg);
  assert.ok(big.includes(enc) && small.includes(enc), "the big cover and a small card draw the same picture, from the one recipe");
  if (EA.spec) assert.equal(EA.spec(guest.data).custom, true, "the shared recipe reads it as the event's own drawing");
  if (EA.thumb) assert.ok(EA.thumb(guest.data).includes(enc));
  void d0;
});

// ---------------------------------------------------------------- 18
test("18: milestones trigger at 1, 5, 10, 25, 50 and 100 hosted, the first sold-out, the first repeat guest and the first year; never twice", () => {
  const list = Array.from({ length: 10 }, (_, i) => ({ id: "e" + i, date: day(-400 + i * 30) }));
  const f = { hosted: 10, list, dates: list.map((x) => x.date) };
  const R = milestonesFrom(f, { visits: [{ name: "Sam Ortiz", secondAt: day(-300) }], nounAt: (i) => (i === 9 ? "dinner" : "event"), soldOutAt: day(-100), now: day(0) });
  const ids = R.map((m) => m.id); for (const k of ["hosted1", "hosted5", "hosted10", "soldout", "repeat", "year"]) assert.ok(ids.includes(k), k);
  assert.ok(!ids.includes("hosted25")); assert.equal(R.find((m) => m.id === "hosted10").title, "Your 10th dinner"); assert.match(R.find((m) => m.id === "repeat").line, /^Sam came back/);
  assert.equal(milestonesFrom({ hosted: 4, list: list.slice(0, 4), dates: [day(-10)] }, { now: day(0) }).some((m) => m.id === "year"), false, "a year only after a year");
  for (const m of R) { assert.doesNotMatch(m.title + m.line, /\u2014|!/, "no em dashes, no shouting"); assert.ok(m.line.length <= 90, "short"); }
  const A = foldMilestones(null, R, { now: 1, fresh: true }); assert.equal(A.added.length, 2, "a new host sees at most two at once"); assert.equal(A.rec.cards.length, R.length, "the rest are kept as seen");
  const B = foldMilestones(A.rec, R, { now: 2 }); assert.deepEqual(B.added, [], "nothing is added twice"); assert.equal(B.rec.cards.length, R.length);
  const old = foldMilestones(null, R, { now: 1, fresh: false }); assert.equal(old.added.length, 1, "an existing host gets only the newest one");
  const more = foldMilestones(B.rec, [...R, { id: "hosted25", at: day(0) }], { now: 3 }); assert.deepEqual(more.added, ["hosted25"]);
});

test("18: Regular means 2 or more of this host's past events, replied I'm in, not a no-show", async () => {
  const ids = ["dsPast1", "dsPast2", "dsPast3"]; for (const [i, id] of ids.entries()) await put(id, { kind: "social", casual: true, name: ["Pottery night", "Supper club", "Wheel night"][i], date: day(-60 + i * 20), published: true, discoverable: true, headcount: 6 }, U.maya);
  await put("dsSoon", { kind: "social", casual: true, name: "Coffee walk", date: day(5), published: true, discoverable: true, headcount: 2 }, U.maya);
  rsvp("dsPast1", U.priya); rsvp("dsPast2", U.priya); // Priya: twice, a regular
  rsvp("dsPast1", U.jun); rsvp("dsSoon", U.jun); // Jun: once, and once still to come
  rsvp("dsPast1", U.lee); rsvp("dsPast3", U.lee, { noShow: true }); // Lee: once, and a no-show
  rsvp("dsPast1", U.sam); rsvp("dsPast2", U.sam); rsvp("dsPast3", U.sam); // Sam: three times
  rsvp("dsSoon", U.noor); rsvp("dsSoon", U.sam); // Coffee walk: full (2 of 2)
  const ws = workspaceOfEvent("dsPast1"), V = visitsOf(srv.store, ws), of = (u) => V.find((v) => v.key === u.email)?.times || 0;
  assert.equal(of(U.priya), 2); assert.equal(of(U.jun), 1, "an event still to come doesn't count"); assert.equal(of(U.lee), 1, "a no-show doesn't count");
  assert.deepEqual(regularsOf(srv.store, ws).map((v) => v.email), [U.sam.email, U.priya.email], "most visits first");
  const reg = async (who, q) => (await req("GET", "/api/me/regular?" + q, null, who)).json();
  assert.deepEqual(await reg(U.priya, "handle=maya-cooks"), { regular: true, times: 2, host: "Maya" });
  assert.equal((await reg(U.jun, "handle=maya-cooks")).regular, false); assert.equal((await reg(U.lee, "event=dsSoon")).regular, false);
  assert.equal((await reg(U.sam, "event=dsSoon")).regular, true, "on that host's invites too");
  assert.equal((await reg(U.maya, "handle=maya-cooks")).regular, false, "a host isn't their own regular");
  assert.equal((await (await fetch(srv.base + "/api/me/regular?handle=maya-cooks")).json()).regular, false, "signed out: nothing");
  // the host sees who their regulars are, by first name and initial, and the milestones they've reached
  const m = await (await req("GET", "/api/me/milestones", null, U.maya)).json();
  assert.deepEqual(m.regulars.map((r) => [r.name, r.times]), [["Sam O.", 3], ["Priya R.", 2]]);
  assert.ok(m.cards.length >= 1 && m.cards.length <= 3); const all = srv.store.get("system/milestones-" + ws).data.cards.map((c) => c.id);
  for (const k of ["hosted1", "repeat", "soldout"]) assert.ok(all.includes(k), k + " is on the record");
  assert.equal(new Set(all).size, all.length, "one record per milestone");
  const m2 = await (await req("GET", "/api/me/milestones", null, U.maya)).json(); assert.deepEqual(m2.cards.map((c) => c.id), m.cards.map((c) => c.id), "the same cards, not new ones");
  const c0 = m.cards[0]; assert.match(c0.png, /^\/api\/me\/milestones\/[a-z0-9]+\.png$/);
  const png = await req("GET", c0.png, null, U.maya); assert.equal(png.status, 200); assert.equal(png.headers.get("content-type"), "image/png"); assert.ok((await png.arrayBuffer()).byteLength > 2000, "a share image");
  assert.equal((await req("GET", c0.png, null, U.jun)).status, 404, "only the host's own cards");
  assert.equal((await req("POST", `/api/me/milestones/${c0.id}/close`, {}, U.maya)).status, 200);
  const m3 = await (await req("GET", "/api/me/milestones", null, U.maya)).json(); assert.ok(!m3.cards.some((c) => c.id === c0.id), "closed for good");
  assert.equal((await req("GET", "/api/me/milestones", null, U.priya)).status, 200, "a guest's own Home asks too"); assert.deepEqual((await (await req("GET", "/api/me/milestones", null, U.priya)).json()).regulars, []);
  // never a popup: the host loop's once-only sheet becomes a card on Home
  assert.match(read("public/hostloop.js"), /if \(window\.PLMilestones\) window\.PLMilestones\.loopCard\(c\)/);
});

// ---------------------------------------------------------------- 19
test("19: the line says only true facts, in order: a personal invite, a shared loved night, friends going", () => {
  assert.equal(inviteLine({}), null, "nothing true to say, nothing said");
  assert.equal(inviteLine({ personalFrom: "Maya" }).text, "Maya saved you a seat.");
  assert.equal(inviteLine({ personalFrom: "Maya", full: true }), null, "a full event can't promise a seat");
  assert.equal(inviteLine({ friends: ["Priya"] }).text, "Priya is going."); assert.equal(inviteLine({ friends: ["Priya", "Sam", "Jo"] }).text, "3 friends are going.");
  assert.equal(inviteLine({ personalFrom: "Maya", friends: ["Priya", "Sam"] }).text, "Maya saved you a seat. 2 friends are going.");
  assert.equal(inviteLine({ friends: ["Priya"], sharedLoved: { name: "Priya", title: "Pottery night" } }).text, "Priya is going. You both loved Pottery night.");
});

test("19: on /g and /e, a guest sees the line only with facts they may know; the light invite stays under 40,000 characters", async () => {
  // Priya and Sam went to Pottery night and both sent kudos; Priya and Jun are friends; Jun is invited to the dumplings
  const pastWs = St("dsPast1"); pastWs.set("kudos/kp", { eventId: "dsPast1", rid: "x1", name: "Priya", email: U.priya.email, tags: ["again"], love: "", at: Date.now() });
  rsvp("dsPast1", U.noor); pastWs.set("kudos/kn", { eventId: "dsPast1", rid: "x2", name: "Noor", email: U.noor.email, tags: ["food"], love: "So good", at: Date.now() });
  pastWs.set("kudos/kj", { eventId: "dsPast1", rid: "x3", name: "Jun", email: U.jun.email, tags: ["again"], love: "", at: Date.now() });
  const X = srv.app.locals.social; X.addFriend(U.jun.email, U.priya.email); X.addFriend(U.priya.email, U.jun.email); X.addFriend(U.jun.email, U.noor.email);
  rsvp("dsDumpling", U.priya); bust();
  const line = async (who, id = "dsDumpling", headers = {}) => (await req("GET", `/api/public/surprise/${id}?track=0`, null, who, headers)).json();
  const j1 = await line(U.jun); assert.equal(j1.line, "Priya is going. You both loved Pottery night.", "a friend going, and a night you both went to and both sent kudos for");
  assert.equal(j1.kind, "loved");
  // Priya keeps her name to hosts only: the shared night isn't said, just that she's going (the Friends going pill's rule)
  await req("POST", "/api/me/prefs", { socialName: "hosts" }, U.priya); bust();
  assert.equal((await line(U.jun)).line, "Priya is going.");
  await req("POST", "/api/me/prefs", { socialName: "everyone" }, U.priya);
  // Noor (a friend of Jun) going with "Show me" off: not counted
  rsvp("dsDumpling", U.noor, { showMe: false }); bust(); assert.match((await line(U.jun)).line, /^Priya is going\./);
  // a stranger going is never "a friend"; someone with no friends going sees no line
  assert.equal((await line(U.lee)).line, undefined); assert.equal((await line(null)).line, undefined, "signed out, with no personal link: no line");
  assert.equal((await line(U.maya)).line, undefined, "the host looking at their own invite");
  // an event that hides who's coming: no friends line at all
  const ev = St("dsDumpling").get("events/dsDumpling").data; await put("dsDumpling", { ...ev, hideGuests: true }, U.maya); bust();
  assert.equal((await line(U.jun)).line, undefined); await put("dsDumpling", { ...ev, hideGuests: false }, U.maya); bust();
  // a personal link the host made: "Maya saved you a seat", with no sign-in
  await put("dsDumpling", { ...ev, guests: [{ id: "gjun", name: "Jun Park", email: U.jun.email, status: "Invited" }] }, U.maya);
  const tok = (await (await req("POST", "/api/invitetoken", { eventId: "dsDumpling", guestKey: "gjun" }, U.maya)).json()).token; assert.ok(tok);
  const p1 = await line(null, "dsDumpling", { "x-encore-invite": "gjun~" + tok }); assert.equal(p1.line, "Maya saved you a seat."); assert.equal(p1.kind, "personal");
  assert.equal((await line(null, "dsDumpling", { "x-encore-invite": "gjun~" + "0".repeat(tok.length) })).line, undefined, "a forged link says nothing");
  const p2 = await line(U.jun, "dsDumpling", { "x-encore-invite": "gjun~" + tok }); assert.equal(p2.line, "Maya saved you a seat. Priya is going. You both loved Pottery night.", "the seat first, then the friend");
  // a full event: no seat promised (Coffee walk is 2 of 2)
  const cw = St("dsSoon").get("events/dsSoon").data; await put("dsSoon", { ...cw, guests: [{ id: "gl", name: "Lee", email: U.lee.email }] }, U.maya);
  const tk2 = (await (await req("POST", "/api/invitetoken", { eventId: "dsSoon", guestKey: "gl" }, U.maya)).json()).token;
  assert.equal((await line(null, "dsSoon", { "x-encore-invite": "gl~" + tk2 })).line, undefined);
  // the light invite: the line is a short string from the server, so the page itself carries nothing extra and stays
  // inside its budget, and the same page (cacheable) serves everyone
  const pristine = read("public/invite.html"); assert.ok(pristine.length < 40000, "invite.html itself: " + pristine.length); assert.doesNotMatch(pristine, /surprise/, "no edit to the light invite");
  const e1 = await req("GET", "/e/dsDumpling", null, U.jun), h1 = await e1.text(), e2 = await fetch(srv.base + "/e/dsDumpling"), h2 = await e2.text();
  assert.ok(h1.length < 40000, "the light invite stays under 40,000 characters: " + h1.length); assert.ok(h2.length < 40000, String(h2.length));
  assert.doesNotMatch(h1 + h2, /Priya is going|saved you a seat/, "nothing about a person is written into the page"); assert.match(e2.headers.get("cache-control"), /public/);
  assert.match(read("public/friendsgoing.js"), /s\.src = "\/surprise\.js"/, "the invite's own Friends going script brings the line in");
  const regE = await (await req("GET", "/api/public/surprise/dsSoon?track=0", null, U.sam)).json(); assert.equal(regE.regular, 3); assert.equal(regE.host, "Maya", "a regular sees the badge on that host's invite");
  // the Friends going pill steps aside when the line says it
  assert.match(read("public/friendsgoing.js"), /!document\.documentElement\.dataset\.plsFriends/);
});

// ---------------------------------------------------------------- 20
test("20: the send-off comes from the event's own details, never made-up facts", async () => {
  assert.equal(sendOffLine({ name: "Dumpling night", why: "We fold 40 dumplings together" }).text, "Bring an appetite, there are 40 dumplings.");
  assert.equal(sendOffLine({ name: "Dumpling night" }).text, "Come hungry.", "no number in the event, no number in the line");
  assert.equal(sendOffLine({ name: "Run club", activity: "run" }).text, "Wear shoes you can run in.");
  assert.equal(sendOffLine({ name: "Sunrise run", activity: "run", startTime: "08:00", weather: { tempF: 45, at: "08:00" } }).text, "Dress warm, it's 45F at 8am.");
  for (const e of [{ name: "Run club", activity: "run", startTime: "08:00" }, { name: "Picnic in the park" }, { name: "Supper" }]) assert.doesNotMatch(sendOffLine(e)?.text || "", /\dF\b|warm|cold|rain/i, "weather only when the event has it");
  assert.equal(sendOffLine({ name: "Coffee and a chat" }), null, "nothing to say, nothing said");
  assert.equal(sendOffLine({ name: "Pottery class" }).text, "Wear something you don't mind getting clay on.");
  assert.equal(sendOffLine({ name: "Early walk", startTime: "06:30" }).text, "Set an alarm, it starts at 6:30am.");
  // a model rewording is only kept when it adds no fact
  assert.equal(rewordOk("Come hungry, 40 dumplings are waiting.", "Bring an appetite, there are 40 dumplings.", { why: "40 dumplings" }), true);
  assert.equal(rewordOk("Come hungry, 60 dumplings are waiting.", "Bring an appetite, there are 40 dumplings.", { why: "40 dumplings" }), false);
  assert.equal(rewordOk("Bring a coat \u2014 it's cold.", "Wear shoes you can run in.", {}), false);
  const j = await (await req("GET", "/api/public/surprise/dsDumpling?track=0", null, null)).json(); assert.equal(j.sendoff, "Bring an appetite, there are 40 dumplings."); assert.equal(j.sendoffKind, "food");
  assert.equal((await fetch(srv.base + "/api/public/surprise/dsDumpling/seen?what=sendoff", { method: "POST" })).status, 204);
});

test("measured with privacy-safe events, in Potto's plain voice, with no emoji, em dashes or model names", () => {
  for (const e of SURPRISE_EVENTS) assert.ok(EVENTS.has(e), e + " is allow-listed");
  const MODEL_NAMES = new RegExp(["cla" + "ude-", "op" + "us", "son" + "net", "hai" + "ku", "gp" + "t-"].join("|"), "i");
  const files = ["server/surprise.js", "public/surprise.js", "public/surprise-host.js", "test/delight-surprise.test.js"];
  for (const f of files) { const t = read(f); assert.doesNotMatch(t, /\u2014/, f + ": no em dashes"); assert.doesNotMatch(t, /[\u{1F300}-\u{1FAFF}]/u, f + ": no emoji"); if (!f.startsWith("test/")) assert.doesNotMatch(t, MODEL_NAMES, f + ": no model names"); }
  const src = read("server/surprise.js"); for (const m of src.matchAll(/capture\("([a-z_]+)", \{([^}]*)\}/g)) assert.doesNotMatch(m[2], /email|name|title|line|text/, m[1] + " sends no names or words");
  const idx = read("index.html"), scripts = [...idx.matchAll(/<script[^>]*>[\s\S]*?<\/script>/g)].map((m) => m[0]);
  assert.match(scripts[scripts.length - 1], /Come with me\?/, "the Come with me? loader stays last");
  assert.ok(idx.indexOf('src="/surprise-host.js"') > 0 && idx.indexOf('src="/surprise-host.js"') < idx.lastIndexOf('"Come with me?"'));
});

// ---------------------------------------------------------------- the browser
test("browser at 390: the drawn cover tile, a milestone card on Home, the line and the send-off on the invite", { timeout: 180000 }, async (t) => {
  let pw; try { pw = createRequire(import.meta.url)("playwright"); } catch { return t.skip("playwright is not installed"); }
  let browser; try { browser = await pw.chromium.launch(); } catch { return t.skip("no Chromium here"); }
  fs.mkdirSync(SHOTS, { recursive: true });
  const ctxFor = async (who) => { const ctx = await browser.newContext({ ...pw.devices["iPhone 13"], viewport: { width: 390, height: 844 }, reducedMotion: "reduce", serviceWorkers: "block" });
    if (who) await ctx.addCookies(who.cookie.split("; ").map((kv) => { const i = kv.indexOf("="); return { name: kv.slice(0, i), value: kv.slice(i + 1), url: srv.base }; }).concat([{ name: "encore_in", value: "1", url: srv.base }]));
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, body: "" })); return ctx; };
  const watch = (page, errs) => { page.on("pageerror", (e) => errs.push("pageerror " + e.message)); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push("console " + m.text()); }); };
  try {
    // Home: the milestone card, stamped, with Potto's line and Save / Share
    const errs = []; let ctx = await ctxFor(U.maya), page = await ctx.newPage(); watch(page, errs);
    srv.store.delete?.("system/milestones-" + workspaceOfEvent("dsPast1"));
    await page.goto(srv.base + "/?app=1#programs", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#plmsBox .plms-card", { timeout: 20000 });
    assert.equal(await page.$(".hl-sheet-bg"), null, "no celebration sheet over the page");
    const box = await page.$eval("#plmsBox", (el) => ({ text: el.innerText, x: el.querySelector(".plms-x").getBoundingClientRect(), font: getComputedStyle(el.querySelector("h3")).fontFamily, r: getComputedStyle(el.querySelector(".plms-card")).borderRadius }));
    assert.match(box.text, /Your first|Your 1st|repeat guest|sold-out/); assert.match(box.text, /Your regulars/); assert.match(box.text, /Sam O\.\s+3 times/);
    assert.ok(box.x.width >= 44 && box.x.height >= 44, "44px close"); assert.match(box.font, /Plex/); assert.equal(box.r, "6px");
    await page.waitForSelector("#plmsBox [data-plsc-share]", { timeout: 10000 });
    await page.$eval("#plmsBox", (el) => el.scrollIntoView({ block: "start" })); await page.waitForTimeout(300);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1), "no sideways scroll");
    await page.screenshot({ path: path.join(SHOTS, "home-milestone-390.png") });
    // the cover sheet from the event: Potto's drawing for this title is the first tile
    await page.goto(srv.base + "/?app=1&open=dsPast2#studio", { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
    const sheet = await page.evaluate(async () => { const d = { id: "dsPast2", name: "Dumpling night with Jun", activity: "", coverPhoto: "" }; await window.PLTitleCover.fetchFor(d); return window.PLTitleCover.tiles(d, [{ id: "dinner", label: "Dinner", html: "" }]).map((x) => x.id); });
    assert.deepEqual(sheet.slice(0, 2), ["drawn-for-event", "dinner"]);
    await page.evaluate(async () => { window.PhotoSheet.open({ for: "cover", eventId: "", templates: window.PLTitleCover.tiles({ id: "dsPast2", name: "Dumpling night with Jun", coverPhoto: "" }, []), onChange: async () => {} }); });
    await page.waitForSelector(".phs [data-t]", { timeout: 10000 }); await page.waitForTimeout(300);
    const tile = await page.$eval(".phs [data-t]", (b) => ({ label: b.getAttribute("aria-label"), img: !!b.querySelector(".ea-custom img"), r: b.getBoundingClientRect() }));
    assert.equal(tile.label, "A cover Potto drew for this event"); assert.ok(tile.img, "the drawing, as an image"); assert.ok(tile.r.width >= 44 && tile.r.height >= 44);
    await page.$eval(".phs [data-tpl]", (el) => el.scrollIntoView({ block: "center" })); await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SHOTS, "cover-sheet-drawn-390.png") });
    assert.deepEqual(errs, []); await ctx.close();
    // the light invite as Jun: the line at the top, then reply I'm in and Potto's send-off
    const e2 = []; ctx = await ctxFor(U.jun); page = await ctx.newPage(); watch(page, e2);
    await page.goto(srv.base + "/e/dsDumpling", { waitUntil: "domcontentloaded" }); await page.waitForSelector("#m .plsu-line", { timeout: 20000 });
    const L = await page.$eval("#m .plsu-line", (el) => ({ text: el.innerText, top: el.getBoundingClientRect().top, h1: document.querySelector("#m h1").getBoundingClientRect().top }));
    assert.match(L.text, /Priya is going\. You both loved Pottery night\./); assert.ok(L.top < L.h1, "at the top, above the title");
    await page.screenshot({ path: path.join(SHOTS, "invite-line-390.png") });
    await page.fill("#nm", "Jun Park").catch(() => {}); await page.fill("#ct", U.jun.email).catch(() => {});
    await page.click("#send"); await page.waitForSelector(".plsu-send", { timeout: 15000 });
    assert.match(await page.$eval(".plsu-send", (el) => el.innerText), /^Potto: Bring an appetite, there are 40 dumplings\.$/);
    await page.$eval(".plsu-send", (el) => el.scrollIntoView({ block: "center" })); await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SHOTS, "invite-sendoff-390.png") });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1));
    assert.deepEqual(e2, []); await ctx.close();
    // the host's page as a regular: the badge by the name
    const e3 = []; ctx = await ctxFor(U.sam); page = await ctx.newPage(); watch(page, e3);
    await page.goto(srv.base + "/@maya-cooks", { waitUntil: "domcontentloaded" }); await page.waitForSelector(".plsu-hostreg", { timeout: 20000 });
    assert.match(await page.$eval(".plsu-hostreg", (el) => el.innerText), /Regular\s*You've been to 3 of Maya's events\./);
    await page.$eval(".plsu-hostreg", (el) => el.scrollIntoView({ block: "center" })); await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SHOTS, "hostpage-regular-390.png") });
    assert.deepEqual(e3, []); await ctx.close();
  } finally { await browser.close(); }
});
