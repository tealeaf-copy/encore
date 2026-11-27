// The feed's Watching and Friends tabs (server/social.js): alerts that match and notify (on save and on the hourly
// sweep, never twice), pause and per-alert channels, "Send me a test", friend requests you can accept or set aside,
// what friends are up to, and the city picker's list of cities with events.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { parseAlert, alertSummary } from "../server/social.js";

let srv;
const J = { "content-type": "application/json" };
const req = (method, path, body, cookie) => fetch(srv.base + path, { method, headers: { ...J, ...(cookie ? { cookie } : {}) }, body: body == null ? undefined : JSON.stringify(body) });
const post = (p, b, c) => req("POST", p, b, c), get = (p, c) => fetch(srv.base + p, { headers: c ? { cookie: c } : {} });
const put = (p, b, c) => req("PUT", "/api/db/doc?path=" + p, b, c);
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const key = (e) => Buffer.from(e).toString("base64url");
const join = async (name, email) => { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); const b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); return { cookie: r.headers.get("set-cookie").split(";")[0], ws: b.workspace.id, email }; };
const inbox = async (c) => (await (await get("/api/me/inbox", c)).json()).items;
const wait = () => new Promise((r) => setTimeout(r, 120));
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "feed-ux-secret", ENCORE_SIGNUP_PER_HOUR: "100", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_PUSH: "1" };

before(async () => { Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer(); });
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

test("alerts read in plain words, any case, and 'my city' means the city you're in", () => {
  const a = parseAlert("runs in austin on weekends");
  assert.equal(a.city, "Austin"); assert.equal(a.weekend, "weekend"); assert.equal(a.summary, "Runs in Austin, on weekends");
  const b = parseAlert("Dinners in Brooklyn"); assert.equal(b.summary, "Dinners and cooking nights in Brooklyn");
  const c = parseAlert("free board game nights in my city"); assert.equal(c.city, "", "my city isn't a city name"); assert.equal(c.myCity, true);
  assert.equal(alertSummary({ ...c, homeCity: "Lisbon" }), "Game nights in Lisbon, free");
});

test("Watching: an alert shows what it watches, what's on now, and tells you once about a new match", async () => {
  const host = await join("Mai Pham", "mai.ux@example.com"), sam = await join("Sam Ortiz", "sam.ux@example.com");
  await put("events/uxOld", { name: "Thursday run club", activity: "run club", kind: "social", casual: true, discoverable: true, published: true, date: day(3), city: "Austin" }, host.cookie);
  // "my city": the page sends the city from the picker
  const r = await (await post("/api/me/alerts", { text: "runs in my city", city: "Austin" }, sam.cookie)).json();
  assert.equal(r.alert.summary, "Runs in Austin"); assert.equal(r.alert.where, "Austin"); assert.equal(r.matchCount, 1, "what's already on shows right away");
  assert.equal(r.matches[0].id, "uxOld"); assert.equal(r.alert.paused, false); assert.equal(r.alert.email, true);
  // a new run in Austin: Sam hears now, in the bell, once
  await put("events/uxNew", { name: "Sunday long run", activity: "run", kind: "social", casual: true, discoverable: true, published: true, date: day(5), city: "Austin" }, host.cookie); await wait();
  let items = (await inbox(sam.cookie)).filter((n) => n.kind === "alert");
  assert.equal(items.length, 1); assert.equal(items[0].eventId, "uxNew"); assert.match(items[0].text, /Sunday long run/); assert.match(items[0].text, /runs in Austin/);
  assert.ok(!items.some((n) => n.eventId === "uxOld"), "what was already on isn't announced as new");
  // saving it again, and the hourly sweep, don't tell Sam twice
  await put("events/uxNew", { name: "Sunday long run", activity: "run", kind: "social", casual: true, discoverable: true, published: true, date: day(5), city: "Austin", headcount: 12 }, host.cookie); await wait();
  const jobs = await srv.app.locals.social.runJobs(); assert.equal(jobs.alerts, 0);
  assert.equal((await inbox(sam.cookie)).filter((n) => n.kind === "alert").length, 1);
  // the tab: status, what's on now, what it told you, when it last checked
  const W = await (await get("/api/me/alerts", sam.cookie)).json();
  const a = W.alerts[0]; assert.equal(a.weekHits, 1); assert.equal(a.hits[0].eventId, "uxNew"); assert.equal(a.upcomingCount, 2);
  assert.ok(W.checkedAt > Date.now() - 60e3, "last checked is recent"); assert.equal(W.everyMin, 60); assert.equal(W.channels.email, true);
});

test("the hourly sweep finds a match the save missed; pause stops it; phone off keeps it in the bell", async () => {
  const host = await join("Lia Host", "lia.ux@example.com"), ana = await join("Ana Diaz", "ana.ux@example.com");
  const al = (await (await post("/api/me/alerts", { text: "hikes in Denver" }, ana.cookie)).json()).alert;
  // an event made public behind the save hook's back (straight into the store): only the sweep can catch it
  srv.store.set(`ws/${host.ws}/events/uxHike`, { name: "Saturday hike", activity: "hike", discoverable: true, published: true, date: day(4), city: "Denver" });
  srv.app.locals.social.bust();
  assert.ok((await srv.app.locals.social.runJobs()).alerts >= 1);
  assert.ok((await inbox(ana.cookie)).some((n) => n.kind === "alert" && n.eventId === "uxHike"));
  // paused: nothing new arrives
  const p = await (await req("PATCH", "/api/me/alerts/" + al.id, { paused: true }, ana.cookie)).json(); assert.equal(p.alert.paused, true);
  await put("events/uxHike2", { name: "Sunrise hike", activity: "hike", kind: "social", casual: true, discoverable: true, published: true, date: day(6), city: "Denver" }, host.cookie); await wait();
  await srv.app.locals.social.runJobs();
  assert.ok(!(await inbox(ana.cookie)).some((n) => n.eventId === "uxHike2"), "paused alerts stay quiet");
  // back on, with phone notifications off for this alert: it lands in the bell marked nopush
  await req("PATCH", "/api/me/alerts/" + al.id, { paused: false, push: false }, ana.cookie);
  await srv.app.locals.social.runJobs();
  const hit = (await inbox(ana.cookie)).find((n) => n.eventId === "uxHike2"); assert.ok(hit, "turned back on, the sweep catches up"); assert.equal(hit.nopush, true);
  // edit what it watches
  const e = await (await req("PATCH", "/api/me/alerts/" + al.id, { text: "hikes in Boulder" }, ana.cookie)).json(); assert.equal(e.alert.summary, "Hikes in Boulder");
});

test("Send me a test drops a sample in the bell, and on the phone when the app is there", async () => {
  const kim = await join("Kim Lee", "kim.ux@example.com");
  const al = (await (await post("/api/me/alerts", { text: "potlucks in Austin" }, kim.cookie)).json()).alert;
  let t = await (await post(`/api/me/alerts/${al.id}/test`, {}, kim.cookie)).json();
  assert.equal(t.ok, true); assert.equal(t.bell, true); assert.equal(t.push, false, "no phone app yet");
  const n = (await inbox(kim.cookie)).find((x) => x.test); assert.ok(n); assert.equal(n.kind, "alert"); assert.match(n.text, /^Test: /); assert.equal(n.link, "/feed#alerts"); assert.equal(n.read, false);
  assert.equal((await post(`/api/me/push/devices`, { token: "a".repeat(64), platform: "ios" }, kim.cookie)).status, 200);
  const { fakeOutbox } = await import("../server/push.js"); const before = fakeOutbox().length;
  t = await (await post(`/api/me/alerts/${al.id}/test`, {}, kim.cookie)).json(); assert.equal(t.push, true); await wait();
  assert.ok(fakeOutbox().slice(before).some((x) => x.to === "kim.ux@example.com" && /Test: /.test(x.body)), "the phone gets it too");
  assert.equal((await post(`/api/me/alerts/nope/test`, {}, kim.cookie)).status, 404);
});

test("Friends: a request you can accept or set aside, and what friends are up to", async () => {
  const a = await join("Ava Stone", "ava.ux@example.com"), b = await join("Ben Cho", "ben.ux@example.com"), c = await join("Cy Park", "cy.ux@example.com");
  assert.equal((await post("/api/me/friends", { key: key(a.email) }, b.cookie)).status, 200); // Ben adds Ava
  assert.equal((await post("/api/me/friends", { key: key(a.email) }, c.cookie)).status, 200); // Cy adds Ava
  let A = await (await get("/api/me/friends", a.cookie)).json();
  assert.deepEqual(A.requests.map((p) => p.name).sort(), ["Ben Cho", "Cy Park"]); assert.equal(A.friends.length, 0);
  const note = (await inbox(a.cookie)).find((n) => n.kind === "friend"); assert.equal(note.link, "/feed#friends"); assert.match(note.text, /Add them back\?/);
  // Ben's side: Ava is on his list, waiting for her
  let B = await (await get("/api/me/friends", b.cookie)).json(); assert.equal(B.friends[0].name, "Ava Stone"); assert.equal(B.friends[0].mutual, false); assert.equal(B.waiting, 1);
  // Ava adds Ben back; sets Cy aside
  assert.equal((await post("/api/me/friends", { key: key(b.email) }, a.cookie)).status, 200);
  assert.equal((await post("/api/me/friends/ignore", { key: key(c.email) }, a.cookie)).status, 200);
  A = await (await get("/api/me/friends", a.cookie)).json(); assert.equal(A.requests.length, 0); assert.equal(A.friends[0].mutual, true);
  assert.match((await inbox(b.cookie)).find((n) => n.kind === "friend").text, /added you back/);
  // what Ben is up to shows on Ava's list: hosting an open event
  await put("events/uxBen", { name: "Ben's dumpling night", activity: "dinner", kind: "social", casual: true, discoverable: true, published: true, date: day(7), city: "Austin" }, b.cookie); await wait();
  srv.app.locals.social.bust();
  A = await (await get("/api/me/friends", a.cookie)).json(); const ben = A.friends.find((f) => f.name === "Ben Cho");
  assert.equal(ben.doing[0].kind, "hosting"); assert.equal(ben.doing[0].title, "Ben's dumpling night"); assert.equal(ben.doing[0].url, "/g#rsvp-uxBen");
  // a private event never shows
  await put("events/uxBenPriv", { name: "Ben's birthday", activity: "dinner", kind: "social", casual: true, discoverable: false, date: day(8) }, b.cookie); srv.app.locals.social.bust();
  A = await (await get("/api/me/friends", a.cookie)).json(); assert.ok(!JSON.stringify(A).includes("birthday"));
  assert.equal((await get("/api/me/friends")).status, 401);
});

test("the city picker lists cities with open events coming up, busiest first", async () => {
  const j = await (await get("/api/public/places")).json();
  assert.ok(Array.isArray(j.cities) && j.cities.length >= 2, JSON.stringify(j));
  assert.equal(j.cities[0].city, "Austin"); assert.ok(j.cities[0].n >= j.cities[1].n);
  assert.ok(!JSON.stringify(j).includes("birthday"));
});
