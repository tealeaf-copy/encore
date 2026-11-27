// The host loop through the server: a dinner planned before signing up carries over into the new account, the first
// event out is celebrated once, streaks stay private until shown, small moves count, Circles are opt-in and nobody is
// moved down, and Potto's nudges go out through the bell with the weekly cap.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore } from "../server/workspaces.js";

let srv;
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "hostloop-secret", ENCORE_SIGNUP_PER_HOUR: "200", ENCORE_FAKE_EMAIL: "1", ENCORE_DIRECTORY_CACHE_MS: "0" };
const J = { "content-type": "application/json" };
const post = (p, b, cookie) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(b || {}) });
const put = (p, b, cookie) => fetch(srv.base + "/api/db/doc?path=" + encodeURIComponent(p), { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(b) });
const getJ = async (p, cookie) => { const r = await fetch(srv.base + p, { headers: cookie ? { cookie } : {} }); return { status: r.status, j: await r.json().catch(() => null) }; };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
async function signup(name, email, handle, city = "Brooklyn") {
  const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends", city }); assert.equal(r.status, 200, await r.clone().text()); const cookie = r.headers.get("set-cookie").split(";")[0];
  if (handle) assert.ok((await post("/api/host/profile", { handle, name, tagline: "Small dinners for new friends.", city, emoji: "🍜" }, cookie)).ok);
  return { cookie, ws: srv.store.get("system/user-" + email)?.data?.ws || (await getJ("/api/me", cookie)).j.workspace?.id };
}
const wsOf = async (cookie) => (await getJ("/api/me", cookie)).j.workspace.id;

before(async () => { Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer(); });
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

test("Pre-signup draft carryover: plan on /start signed out, sign up, and the same dinner is saved and sent", async () => {
  const page = await fetch(srv.base + "/start"); assert.equal(page.status, 200); const html = await page.text();
  assert.match(html, /id="save">Get my link</); assert.match(html, /Save your \$\{n\} and get a link to send/); assert.match(html, /pl\.startDraft/, "the draft lives on this phone"); assert.match(html, /next=%2Fstart%3Fsave%3D1/, "sign-up comes back to save the draft");
  assert.match(read("public/signup.html"), /q\.get\("next"\) === "start"\) \{ location\.href = "\/start\?save=1"/, "sign-up comes back to save the draft");
  assert.equal((await post("/api/me/hostloop/draft", { draft: { title: "x" } })).status, 401, "saving needs an account");
  const { cookie } = await signup("Mina Cho", "mina.loop@example.com", "mina-loop");
  // the browser's draft, as /start keeps it
  const draft = { t: "dinner4", title: "Dumpling night", date: day(9), time: "19:30", seats: 6, place: "My place, Greenpoint", note: "Bring something to drink." };
  const xp = await (await fetch(srv.base + "/api/public/xp/first-win-copy?u=visitorMina01")).json();
  const r = await post("/api/me/hostloop/draft", { draft, u: "visitorMina01", tz: "America/New_York" }, cookie); assert.equal(r.status, 200); const j = await r.json();
  assert.match(j.id, /^st[A-Za-z0-9]{6,}$/); assert.equal(j.event.name, "Dumpling night"); assert.equal(j.event.headcount, 6); assert.equal(j.event.venueName, "My place, Greenpoint"); assert.equal(j.event.city, "Brooklyn"); assert.equal(j.event.tz, "America/New_York");
  assert.equal((await put("events/" + j.id, { ...j.event, published: true }, cookie)).status, 200, "saved through the app's own write path");
  const ws = await wsOf(cookie), ev = scopeStore(srv.store, ws).get("events/" + j.id).data; assert.equal(ev.pubTitle, "Dumpling night"); assert.equal(ev.published, true); assert.equal(ev.concept, "Bring something to drink.");
  assert.equal((await fetch(srv.base + "/e/" + j.id)).status, 200, "the link to send works");
  const rows = srv.store.list("system/xp/events").map((d) => d.data).filter((x) => x.exp === "first-win-copy");
  assert.ok(rows.some((x) => x.kind === "exposure" && x.variant === xp.variant) && rows.some((x) => x.kind === "conversion" && x.variant === xp.variant), "the copy experiment counts the save");
  // the first event out is celebrated once, warmly
  const s1 = (await getJ("/api/me/hostloop", cookie)).j; assert.equal(s1.celebrate.id, "first"); assert.equal(s1.celebrate.title, "Your first one is out in the world.");
  assert.equal((await getJ("/api/me/hostloop", cookie)).j.celebrate, null, "fired once");
  assert.equal(s1.streak.status, "none", "nothing hosted yet: the streak starts with the dinner itself");
  assert.equal(s1.moves.today.id, "invite", "something is on the calendar: invite one new person");
});

test("An existing host isn't flooded with old milestones; new ones still celebrate once", async () => {
  const { cookie } = await signup("Old Hand", "old.loop@example.com", "old-loop"), ws = await wsOf(cookie);
  for (let i = 1; i <= 10; i++) assert.equal((await put(`events/old${i}`, { name: "Supper " + i, casual: true, published: true, date: day(-7 * i), tz: "UTC" }, cookie)).status, 200);
  srv.store.update("system/ws-" + ws, { createdAt: Date.now() - 400 * 864e5 }); // an account from last year
  assert.equal((await getJ("/api/me/hostloop", cookie)).j.celebrate, null, "their first and tenth were long ago");
  for (const n of ["Ana", "Bo", "Cy", "Di"]) await post("/api/db/collection?path=rsvps", { eventId: "oldsold", name: n, email: n.toLowerCase() + "@g.example.com", response: "going", code: "C" + n.toUpperCase() }, cookie);
  assert.equal((await put("events/oldsold", { name: "Tiny supper", casual: true, published: true, date: day(5), headcount: 4, tz: "UTC" }, cookie)).status, 200);
  const s = (await getJ("/api/me/hostloop", cookie)).j; assert.equal(s.celebrate?.id, "soldout"); assert.equal((await getJ("/api/me/hostloop", cookie)).j.celebrate, null);
});

test("Streaks: monthly by default, weekly by choice, private until the host shows them", async () => {
  const { cookie } = await signup("Wes Weekly", "wes.loop@example.com", "wes-loop");
  for (const [i, d] of [[0, -1], [1, -8], [2, -15], [3, -22]]) await put(`events/wes${i}`, { name: "Run club", casual: true, published: true, date: day(d), tz: "UTC" }, cookie);
  let s = (await getJ("/api/me/hostloop?peek=1", cookie)).j; assert.equal(s.streak.cadence, "month");
  const p = await (await post("/api/me/hostloop/prefs", { cadence: "week" }, cookie)).json(); assert.equal(p.prefs.cadence, "week");
  s = (await getJ("/api/me/hostloop?peek=1", cookie)).j; assert.equal(s.streak.cadence, "week"); assert.ok(s.streak.count >= 3, JSON.stringify(s.streak));
  assert.equal((await getJ("/api/public/host/wes-loop/streak")).j.streak, null, "private by default");
  const badges = (await getJ("/api/public/host/wes-loop/badges")).j; assert.ok(!badges.badges.some((b) => b.id === "streak"), "and no public streak badge either");
  await post("/api/me/hostloop/prefs", { showStreak: true }, cookie);
  const pub = (await getJ("/api/public/host/wes-loop/streak")).j.streak; assert.ok(pub.count >= 3); assert.equal(pub.cadence, "week"); assert.match(pub.text, /weeks of hosting in a row/);
  // bad values are ignored
  await post("/api/me/hostloop/prefs", { cadence: "daily", goal: 9999 }, cookie); s = (await getJ("/api/me/hostloop?peek=1", cookie)).j; assert.equal(s.prefs.cadence, "week"); assert.equal(s.prefs.goal, 30);
});

test("Small moves count: Done adds warmth once per move per day, and today's move moves on", async () => {
  const { cookie } = await signup("Sol Mover", "sol.loop@example.com", "sol-loop");
  let s = (await getJ("/api/me/hostloop", cookie)).j; assert.equal(s.moves.today.id, "plan"); assert.equal(s.warmth.points, 0); assert.match(s.potto, /dinner for four is a whole event/i);
  const r = await (await post("/api/me/hostloop/moves/plan", {}, cookie)).json(); assert.equal(r.ok, true); assert.ok(r.line); assert.equal(r.state.warmth.points, 1);
  assert.notEqual(r.state.moves.today.id, "plan", "the next move comes up");
  assert.equal((await (await post("/api/me/hostloop/moves/plan", {}, cookie)).json()).state.warmth.points, 1, "the same move twice in a day counts once");
  assert.equal((await post("/api/me/hostloop/moves/nope", {}, cookie)).status, 404);
});

test("Circles: off by default, opt in from Home, grouped with similar hosts, leave any time, and nobody is moved down", async () => {
  const H = [];
  for (const n of ["Ana", "Bo", "Cy", "Di", "Ed"]) { const h = await signup(n + " Circle", `${n.toLowerCase()}.circ@example.com`, `${n.toLowerCase()}-circ`); H.push(h); }
  const not = (await getJ("/api/me/hostloop/circle", H[0].cookie)).j; assert.equal(not.circle, null, "off by default"); assert.match(not.intro, /Nobody moves down/);
  for (const h of H.slice(0, 4)) assert.equal((await (await post("/api/me/hostloop/circle", { on: true, cadence: "month" }, h.cookie)).json()).on, true);
  await put("events/circ1", { name: "Supper", casual: true, published: true, date: day(-1), tz: "UTC" }, H[1].cookie);
  const b = (await getJ("/api/me/hostloop/circle", H[0].cookie)).j.circle;
  assert.equal(b.size, 4, "only the hosts who opted in"); assert.equal(b.tier, "Kitchen table"); assert.equal(b.board.filter((x) => x.you).length, 1);
  assert.equal(b.board[0].name, "Bo Circle"); assert.equal(b.board[0].standing, "Moving up"); assert.ok(b.board.slice(1).every((x) => x.standing === "Staying"), "no points, no move");
  assert.ok(!/down|demot|relegat/i.test(JSON.stringify(b.board)), "no public demotion"); assert.ok(!b.board.some((x) => "email" in x || "ws" in x));
  assert.ok(!JSON.stringify((await getJ("/api/public/host/ed-circ/badges")).j).includes("Kitchen"), "never on a public page");
  // the period ends: the top three with points move up, the rest stay at their table
  const L = srv.app.locals.hostloop; const nextMonth = new Date(); nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 2);
  L.settle(nextMonth.toISOString().slice(0, 10));
  const ws = await Promise.all(H.slice(0, 4).map((h) => wsOf(h.cookie))), tiers = ws.map((w) => L.get(w).circle.tier);
  assert.deepEqual(tiers, [0, 1, 0, 0], "Bo moves up a table; nobody moves down");
  L.settle(nextMonth.toISOString().slice(0, 10)); assert.deepEqual(ws.map((w) => L.get(w).circle.tier), [0, 1, 0, 0], "settling twice changes nothing");
  assert.equal((await (await post("/api/me/hostloop/circle", { on: false }, H[0].cookie)).json()).on, false, "leave any time");
  assert.equal((await getJ("/api/me/hostloop/circle", H[2].cookie)).j.circle.size, 2, "the circle regroups without them (Bo is a table up)");
});

test("Potto's nudges go through the bell at the host's rhythm, at most 2 a week, and Settings can turn each off", async () => {
  const { cookie } = await signup("Nia Nudge", "nia.loop@example.com", "nia-loop"), ws = await wsOf(cookie), L = srv.app.locals.hostloop, X = srv.app.locals.social;
  await put("events/niadn", { name: "Dumpling Night", casual: true, published: true, date: day(-35), tz: "UTC" }, cookie);
  const sample = (await getJ("/api/me/hostloop/sample", cookie)).j; assert.match(sample.nudge.body, /It's been 5 weeks since Dumpling Night\. Same crew, new month\?/); assert.deepEqual(Object.keys(sample.types), ["prep", "thanks", "streak", "comeback"]);
  const at = L.nudgesFor(ws).cands.find((n) => n.type === "comeback").at;
  const bell = () => X.inbox("nia.loop@example.com").filter((n) => n.kind === "nudge");
  if (at > Date.now()) { await L.runJobs(at - 3600e3); assert.equal(bell().length, 0, "not before their usual time"); }
  // run at their usual time: the comeback nudge reaches the bell (and so a push) once
  await L.runJobs(at + 60e3); assert.equal(bell().length, 1); assert.match(bell()[0].text, /Same crew, new month\?/); assert.match(bell()[0].link, /^\/start\?t=again/);
  assert.equal(bell()[0].actor?.name, "Potto", "through the Inbox's notify(), from Potto"); assert.equal(bell()[0].type, "note");
  const IN = (await getJ("/api/me/inbox", cookie)).j; assert.ok(JSON.stringify(IN).includes("Same crew, new month?"), "the nudge shows in the Inbox list");
  await L.runJobs(at + 2 * 3600e3); assert.equal(bell().length, 1, "never the same nudge twice");
  const d = L.get(ws); d.sent = [{ key: "a", type: "prep", at: at }, { key: "b", type: "thanks", at: at }]; srv.store.set("system/hostloop-" + ws, d);
  await post("/api/me/hostloop/prefs", { notif: { comeback: false } }, cookie);
  assert.equal((await getJ("/api/me/hostloop?peek=1", cookie)).j.prefs.notif.comeback, false, "per-kind opt-out saved");
  assert.match(read("public/hostloop.js"), /Hosting<\/h2>/, "the switches live in /settings"); assert.match(read("public/settings.html"), /hostloop\.js/);
});

test("Pages: /start, /path and /circles load; copy has no em dashes; the Potto voice guide exists", async () => {
  for (const p of ["/start", "/path", "/circles"]) assert.equal((await fetch(srv.base + p)).status, 200, p);
  for (const f of ["public/start.html", "public/path.html", "public/circles.html", "public/hostloop.js", "server/hostloop.js", "docs/potto-voice.md"]) {
    const s = read(f); assert.ok(!s.includes("—"), f + ": no em dashes");
    if (f.startsWith("public/")) assert.ok(!/(?<![\w-])#[0-9a-fA-F]{6}\b/.test(s.replace(/&#\d+;/g, "")), f + ": brand tokens only, no hard-coded colours");
  }
  assert.match(read("docs/potto-voice.md"), /## Do and don't/); assert.match(read("docs/potto-voice.md"), /## Seven principles/);
});
