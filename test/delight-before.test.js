// Potto as a co-host before the event (server/cohost.js, public/cohost.js, public/cohost.html): one sentence to a plan,
// a time that works without a poll (who can't make each, from host-visible data only), a line per friend that only
// uses that friend's history with this host and goes nowhere without a tap, and the "nobody's replied" rescue: once,
// two days before, inside quiet hours and the host's settings, never automatic. All of it in offline fake AI mode.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore } from "../server/workspaces.js";
import { keyFor, idOf } from "../server/people.js";
import { readNote, nightOf, MARKS, makeCohost } from "../server/cohost.js";
import { EVENTS, _queue, _reset, _setFetch } from "../server/posthog.js";

const require = createRequire(import.meta.url);
require("../public/cohost.js"); const PC = globalThis.PLCohost;
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
let srv;
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "cohost-secret-0123456789", ENCORE_SIGNUP_PER_HOUR: "200", ENCORE_FAKE_EMAIL: "1", ENCORE_DIRECTORY_CACHE_MS: "0", ENCORE_TZ: "UTC" };
const J = { "content-type": "application/json" };
const post = (p, b, cookie) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(b || {}) });
const put = (p, b, cookie) => fetch(srv.base + "/api/db/doc?path=" + encodeURIComponent(p), { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(b) });
const getJ = async (p, cookie) => { const r = await fetch(srv.base + p, { headers: cookie ? { cookie } : {} }); return { status: r.status, j: await r.json().catch(() => null) }; };
const iso = (d) => d.toISOString().slice(0, 10);
const day = (n) => iso(new Date(Date.now() + n * 864e5));
const wd = (s) => new Date(s + "T12:00:00Z").getUTCDay();
/** The first date at least n days out that falls on weekday w (0 Sunday). */
const nextWd = (w, n = 4) => { for (let i = n; i < n + 7; i++) if (wd(day(i)) === w) return day(i); };
const pastWd = (w, weeks) => { for (let i = 7 * weeks; i < 7 * weeks + 7; i++) if (wd(day(-i)) === w) return day(-i); };
async function signup(name, email, handle) {
  const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends", city: "Brooklyn" }); assert.equal(r.status, 200, await r.clone().text()); const cookie = r.headers.get("set-cookie").split(";")[0];
  if (handle) assert.ok((await post("/api/host/profile", { handle, name, city: "Brooklyn" }, cookie)).ok);
  return { cookie, ws: (await getJ("/api/me", cookie)).j.workspace.id };
}
const pid = (email) => idOf(keyFor(email));
let host, other, jun;
const FRIENDS = { ada: "ada.co@example.com", sam: "sam.co@example.com", jun: "jun.co@example.com", lee: "lee.co@example.com" };

before(async () => { Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer();
  host = await signup("Mina Host", "mina.cohost@example.com", "mina-cohost");
  other = await signup("Otto Other", "otto.cohost@example.com", "otto-cohost");
  jun = await signup("Jun Park", FRIENDS.jun, null); // Jun has an account, so an invite reaches the bell
  const S = scopeStore(srv.store, host.ws), O = scopeStore(srv.store, other.ws);
  // Mina's past nights: two Saturday dinners and a Thursday hack night
  const sat1 = pastWd(6, 2), sat2 = pastWd(6, 4), thu = pastWd(4, 3);
  for (const [id, name, date, extra] of [["p1", "Taco night", sat1, { guests: [{ name: "Lee Moss", email: FRIENDS.lee, status: "Not invited" }] }], ["p2", "Pasta night", sat2, {}], ["p3", "Hack night", thu, {}]]) assert.equal((await put("events/" + id, { name, pubTitle: name, casual: true, published: true, date, startTime: "19:00", tz: "UTC", ...extra }, host.cookie)).status, 200);
  const rs = (id, eventId, d) => S.set("rsvps/" + id, { eventId, createdAt: Date.now() - 30 * 864e5, ...d });
  rs("r1", "p1", { name: "Ada Lim", email: FRIENDS.ada, response: "going" }); rs("r2", "p2", { name: "Ada Lim", email: FRIENDS.ada, response: "going" });
  rs("r3", "p1", { name: "Sam Reyes", email: FRIENDS.sam, response: "no", note: "Can't do weekends anymore, sorry!" });
  rs("r4", "p3", { name: "Sam Reyes", email: FRIENDS.sam, response: "going" });
  rs("r5", "p1", { name: "Jun Park", email: FRIENDS.jun, response: "going", slot: "Chilli oil" });
  S.set("kudos/r2", { eventId: "p2", rid: "r2", name: "Ada Lim", email: FRIENDS.ada, tags: ["food"], love: "So good", at: Date.now() - 20 * 864e5 });
  // Otto's (another host's) night: Jun is in on the Saturday we'll ask about and told Otto "can't do Saturdays".
  // None of this is Mina's to see, so none of it may count.
  const target = nextWd(6);
  assert.equal((await put("events/o1", { name: "Otto's wine night", pubTitle: "Otto's wine night", casual: true, published: true, date: target, startTime: "19:00", tz: "UTC" }, other.cookie)).status, 200);
  O.set("rsvps/o1r", { eventId: "o1", name: "Jun Park", email: FRIENDS.jun, response: "going", note: "Can't do Saturdays usually", slot: "Natural wine" });
});
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; delete process.env.ENCORE_POSTHOG_KEY; _reset(); await srv.close(); });

// ---------------------------------------------------------------- 1
test("Here's your night: one sentence becomes a near-finished plan, honest about what's suggested", async () => {
  const fri = new Date(2026, 10, 27); // a Friday
  const P = PC.nightFromSentence("dumpling night for 8 next Saturday", fri);
  assert.equal(P.title, "Dumpling night"); assert.equal(P.kind, "dinner"); assert.equal(P.headcount, 8); assert.equal(P.spotsSuggested, false);
  assert.equal(P.date, "2026-12-05", "next Saturday, not tomorrow"); assert.equal(P.startTime, "19:00"); assert.equal(P.timeSuggested, true, "the time is a suggestion and says so");
  assert.equal(P.place, "", "no place is made up"); assert.match(P.note, /^Dumpling night, Sat, Dec 5 at 7pm\. 8 spots\. Are you in\?/); assert.doesNotMatch(P.note, /book|reserv|\u2014/i, "never claims a booking");
  assert.equal(PC.nightFromSentence("Dumpling night", fri), null, "a plain title stays a title");
  assert.equal(PC.nightFromSentence("brunch this sunday 11am for four", fri).startTime, "11:00");
  assert.equal(PC.nightFromSentence("Picnic in McCarren Park on Dec 6 for 10", fri).place, "McCarren Park", "a place they typed is kept");
  assert.equal(nightOf("dumpling night for 8 next Saturday", fri).cover, "dumpling", "a fitting drawn cover from the illustration set");
  // the server reading (offline fake AI runs the same checks a model reply gets)
  const r = await post("/api/cohost/night", { text: "dumpling night for 8 next Saturday", today: "2026-11-27" }, host.cookie); assert.equal(r.status, 200); const j = (await r.json()).plan;
  assert.equal(j.title, "Dumpling night"); assert.equal(j.headcount, 8); assert.equal(j.date, "2026-12-05"); assert.equal(j.cover, "dumpling"); assert.doesNotMatch(j.note, /book/i);
  assert.equal((await post("/api/cohost/night", { text: "x" })).status, 401, "the server reading is for signed-in hosts; /start reads on the phone");
  // Potto answers the same sentence with a link that opens the canvas with the card
  const a = await (await post("/api/potto/ask", { message: "dumpling night for 8 next Saturday" }, host.cookie)).json();
  assert.match(a.answer, /^Here's your night: Dumpling night, .*8 spots/); assert.match(a.answer, /Nothing's sent or booked/); assert.match(a.links[0].href, /^\/\?app=1&new=1&kind=dinner&night=dumpling%20night/);
  // the hooks are in place: the canvas card, /start and the one script in the app shell
  assert.match(read("public/canvas.js"), /root\.PLCohost\?\.typed\?\.\(t\.value, cohost\(\)\)/); assert.match(read("public/canvas.js"), /<div id="cvNight"/);
  assert.match(read("public/start.html"), /window\.PLStart = \{ apply\(P\)/); assert.match(read("public/canvas.js"), /s\.src = "\/cohost\.js"/, "the canvas loads it, so the app shell keeps its size"); assert.doesNotMatch(read("index.html"), /cohost\.js/);
  const card = read("public/cohost.js"); assert.match(card, /Here's your night/); assert.match(card, /Looks good/); assert.match(card, /Nothing is sent or booked/);
});

// ---------------------------------------------------------------- 2
test("A time that works: up to three times, who can't make each, no info yet, host-visible data only", async () => {
  const target = nextWd(6), thu = nextWd(4);
  assert.equal((await put("events/ev1", { name: "Dumpling night", pubTitle: "Dumpling night", casual: true, published: true, date: thu, startTime: "19:00", headcount: 8, tz: "UTC" }, host.cookie)).status, 200);
  const I = srv.app.locals.invites; I.add(host.ws, "ev1", { ids: Object.values(FRIENDS).map(pid) });
  const { status, j } = await getJ("/api/cohost/ev1/times", host.cookie); assert.equal(status, 200);
  assert.equal(j.enough, true); assert.ok(j.options.length >= 1 && j.options.length <= 3);
  assert.deepEqual(j.noInfo, ["Lee"], "Lee has no signal: no info yet, never a guess");
  const sat = j.options.find((o) => o.date === target); assert.ok(sat, "the Saturday after next is offered: " + JSON.stringify(j.options));
  assert.match(sat.line, /: everyone but Sam$/, "Sam can't do weekends, and the line says only who");
  assert.ok(!sat.cant.includes("Jun"), "Jun's plans with another host don't count against Mina's Saturday");
  assert.ok(j.options.every((o) => /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}, \d{1,2}(:\d{2})?(am|pm): /.test(o.line)), "lines read like 'Sat, Dec 5, 7pm: ...'");
  const raw = JSON.stringify(j); for (const bad of [/weekend/i, /saturdays/i, /@/, /Otto/, /wine/i, /sorry/i]) assert.doesNotMatch(raw, bad, "no reasons, notes, emails or another host's data");
  // what a note says about days, read plainly
  assert.equal(readNote("can't do weekends anymore").weekend, false); assert.equal(readNote("not on Fridays").wd[5], false); assert.equal(readNote("Thursdays are good for me").wd[4], true); assert.equal(readNote("see you there").weekend, undefined);
  // only the host gets them
  assert.equal((await getJ("/api/cohost/ev1/times", other.cookie)).status, 404); assert.equal((await getJ("/api/cohost/ev1/times")).status, 401);
  // too little to go on: a three-date poll instead
  assert.equal((await put("events/ev2", { name: "Book club", pubTitle: "Book club", casual: true, published: true, date: thu, startTime: "19:00", tz: "UTC" }, host.cookie)).status, 200);
  I.add(host.ws, "ev2", { ids: [pid(FRIENDS.lee)] });
  const p = (await getJ("/api/cohost/ev2/times", host.cookie)).j; assert.equal(p.enough, false); assert.equal(p.options.length, 0); assert.equal(p.poll.length, 3); assert.deepEqual(p.noInfo, ["Lee"]);
  assert.match(read("public/cohost.html"), /stage: "interest", dateOptions: dates, date: ""/, "the poll is the app's own interest stage");
  // Potto points to it
  const a = await (await post("/api/potto/ask", { message: "Can you find a time that works for Dumpling night?", eventId: "ev1" }, host.cookie)).json();
  assert.match(a.answer, /^For Dumpling night, /); assert.match(a.links[0].href, /^\/cohost\/ev1\?m=time$/);
});

// ---------------------------------------------------------------- 3
test("A line per friend: different lines from each friend's own history with this host, nothing sent without a tap", async () => {
  const { status, j } = await getJ("/api/cohost/ev1/lines", host.cookie); assert.equal(status, 200);
  const by = Object.fromEntries(j.items.map((x) => [x.first, x])); assert.deepEqual(Object.keys(by).sort(), ["Ada", "Jun", "Lee", "Sam"]);
  assert.match(by.Jun.line, /^Jun, you brought the chilli oil/, "what Jun brought to Mina's night"); assert.doesNotMatch(by.Jun.line, /wine|Otto/i, "never what Jun did with another host");
  assert.match(by.Ada.line, /^Ada, /); assert.equal(by.Lee.line, "", "no history: the plain invite"); assert.equal(by.Lee.basis, "plain");
  const L = j.items.map((x) => x.line).filter(Boolean); assert.equal(new Set(L.map((l) => l.replace(/^\w+, /, ""))).size, L.length, "a different line for each person");
  for (const x of j.items) for (const o of j.items) if (o !== x && x.line) assert.ok(!x.line.includes(o.first), `${x.first}'s line never names ${o.first}`);
  assert.doesNotMatch(JSON.stringify(j), /@/, "no emails in the drafts");
  // drafting sent nothing
  const X = srv.app.locals.social, I = srv.app.locals.invites;
  assert.ok(!X.inbox(FRIENDS.jun).some((n) => n.eventId === "ev1"), "no bell for Jun yet"); assert.ok(Object.values(I.plan(host.ws, "ev1").people).every((e) => !e.invitedAt), "nobody invited yet");
  // the host edits Jun's line and taps Send
  const edited = "Jun, you brought the chilli oil last time. Bring it again?";
  const items = j.items.map((x) => ({ id: x.id, line: x.first === "Jun" ? edited : x.line }));
  assert.equal((await post("/api/cohost/ev1/lines/send", { items: [{ id: "f".repeat(24), line: "Hi" }] }, host.cookie)).status, 200, "an id not on the list is ignored");
  const s = await (await post("/api/cohost/ev1/lines/send", { items }, host.cookie)).json(); assert.equal(s.ok, true); assert.ok(s.sent >= 1);
  const bell = X.inbox(FRIENDS.jun).find((n) => n.eventId === "ev1"); assert.ok(bell, "Jun's invite is in the bell"); assert.match(bell.text, /Bring it again\?$/, "with the line the host saw and edited");
  assert.ok(!X.inbox(FRIENDS.jun).some((n) => /Ada|Sam|Lee/.test(n.text)), "Jun never sees another guest's line");
  assert.equal((await post("/api/cohost/ev1/lines/send", { items }, other.cookie)).status, 404, "only the host sends");
  assert.match(read("server/invites.js"), /co-host hook \(server\/cohost\.js\)/);
});

// ---------------------------------------------------------------- 4
test("The rescue: two days before, low replies, once, inside quiet hours and settings, never automatic", async () => {
  const K = srv.app.locals.cohost, X = srv.app.locals.social, I = srv.app.locals.invites, owner = "mina.cohost@example.com";
  const d2 = day(2), noon = Date.parse(d2 + "T12:00:00Z") - 2 * 864e5, late = Date.parse(day(0) + "T23:30:00Z");
  assert.equal((await put("events/ev3", { name: "Game night", pubTitle: "Game night", casual: true, published: true, date: d2, startTime: "19:30", headcount: 8, tz: "UTC" }, host.cookie)).status, 200);
  scopeStore(srv.store, host.ws).set("rsvps/g1", { eventId: "ev3", name: "Ada Lim", email: FRIENDS.ada, response: "going" });
  I.add(host.ws, "ev3", { ids: [pid(FRIENDS.sam), pid(FRIENDS.lee)] }); const pl = I.plan(host.ws, "ev3"); for (const e of Object.values(pl.people)) e.invitedAt = Date.now() - 864e5; I.save(host.ws, "ev3", pl);
  // a healthy event two days out is left alone
  assert.equal((await put("events/ev4", { name: "Full supper", pubTitle: "Full supper", casual: true, published: true, date: d2, startTime: "19:00", headcount: 2, tz: "UTC" }, host.cookie)).status, 200);
  for (const [i, n] of ["Ada", "Sam"].entries()) scopeStore(srv.store, host.ws).set("rsvps/f" + i, { eventId: "ev4", name: n, email: n.toLowerCase() + ".f@example.com", response: "going" });
  // quiet hours: nothing
  assert.equal(K.rescueDue(host.ws, late).length, 0, "11:30pm is quiet");
  // the master switch off: nothing
  srv.app.locals.hostloop.setPrefs(host.ws, { notif: { on: false } }); assert.equal(K.rescueDue(host.ws, noon).length, 0, "notifications off");
  srv.app.locals.hostloop.setPrefs(host.ws, { notif: { on: true } });
  const due = K.rescueDue(host.ws, noon).map((x) => x.id); assert.deepEqual(due, ["ev3"], "only the event with low replies");
  assert.ok((await K.runJobs(noon)) >= 1);
  const bell = X.inbox(owner).find((n) => n.key === "cohost-rescue-ev3"); assert.ok(bell, "the host's bell"); assert.match(bell.text, /^Game night is in two days and 1 of 8 spots are filled\. I drafted a friendlier reminder/); assert.equal(bell.link, "/cohost/ev3?m=rescue");
  assert.equal(await K.runJobs(noon + 3600e3), 0, "at most one rescue per event"); assert.equal(X.inbox(owner).filter((n) => n.key === "cohost-rescue-ev3").length, 1);
  // never automatic: no reminder went to guests and the date stayed
  assert.ok(Object.values(I.plan(host.ws, "ev3").people).every((e) => !(e.reminders || []).length)); assert.equal(scopeStore(srv.store, host.ws).get("events/ev3").data.date, d2);
  // the page's options, then one tap sends the reminder the host read to the two who haven't replied
  const r = (await getJ("/api/cohost/ev3/rescue", host.cookie)).j; assert.equal(r.low, true); assert.equal(r.waiting, 2); assert.match(r.draft, /^Quick one: Game night is /); assert.doesNotMatch(r.draft, /\u2014|book/i);
  assert.equal((await getJ("/api/cohost/ev3/rescue", other.cookie)).status, 404);
  const x = await (await post("/api/cohost/ev3/rescue/remind", { text: "Quick one: Game night is Saturday. Can you make it?" }, host.cookie)).json(); assert.equal(x.reminded, 2, "both who haven't replied");
  assert.ok(Object.values(I.plan(host.ws, "ev3").people).every((e) => !e.nudge), "the reminder text isn't kept on the plan");
  // a text too, only through Potto by text (its own opt-in and quiet hours): the job hands it over once
  const texts = [], K2 = makeCohost({ store: srv.store, X, I, L: srv.app.locals.hostloop, T: { enqueue: (em, o) => { texts.push({ em, ...o }); return true; } } });
  assert.equal((await put("events/ev5", { name: "Movie night", pubTitle: "Movie night", casual: true, published: true, date: d2, startTime: "20:00", headcount: 6, tz: "UTC" }, host.cookie)).status, 200);
  assert.equal(await K2.runJobs(noon), 1); assert.equal(texts.length, 1); assert.equal(texts[0].em, owner); assert.equal(texts[0].kind, "rescue");
  assert.match(texts[0].text, /^Potto: Movie night is in two days and 0 of 6 spots are filled\..*\/cohost\/ev5\?m=rescue$/);
  assert.equal(await K2.runJobs(noon + 7200e3), 0, "still once");
  assert.equal(srv.app.locals.pottoText.enqueue(owner, { key: "cohost-rescue-x", kind: "rescue", text: "hi" }), false, "the real Potto by text sends nothing to a host who didn't turn it on");
});

// ---------------------------------------------------------------- measuring
test("Measured with privacy-safe PostHog events", async () => {
  for (const m of MARKS) assert.ok(EVENTS.has(m), m);
  process.env.ENCORE_POSTHOG_KEY = "phc_testcohost1234"; _reset(); _setFetch(async () => ({ ok: true, status: 200 }));
  assert.equal((await post("/api/cohost/mark", { event: "cohost_night_applied", via: "canvas", kind: "dinner", tweaked: true, title: "Dumpling night", email: "a@b.c" }, host.cookie)).status, 200);
  assert.equal((await post("/api/cohost/mark", { event: "something_else" }, host.cookie)).status, 400);
  await getJ("/api/cohost/ev1/lines", host.cookie);
  const Q = _queue(), m = Q.find((e) => e.event === "cohost_night_applied"); assert.ok(m); assert.equal(m.properties.via, "canvas"); assert.equal(m.properties.kind, "dinner");
  const all = JSON.stringify(Q.filter((e) => e.event.startsWith("cohost_"))); assert.doesNotMatch(all, /Dumpling|@|Jun|Ada|chilli/i, "no titles, names or emails");
  assert.ok(Q.some((e) => e.event === "cohost_lines_drafted"));
  delete process.env.ENCORE_POSTHOG_KEY; _reset();
});
