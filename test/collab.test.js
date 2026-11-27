// Team up (server/collab.js, public/collab.js): opt in, find, ask, say yes, plan together, and the safety rules.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { fakeOutbox } from "../server/email.js";
import { scopeStore, updateWorkspace } from "../server/workspaces.js";
import { lanesOf, complements, matchOf, pickLine, offlineConcepts, guardConcepts, hideContact, publicTeamUp, collabFlag, teamUpNames } from "../server/collab.js";

let srv;
const J = { "content-type": "application/json" };
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const req = (method, path, body, cookie, extra = {}) => fetch(srv.base + path, { method, headers: { ...J, ...(cookie ? { cookie } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
const json = async (method, path, body, cookie) => { const r = await req(method, path, body, cookie); return { status: r.status, j: await r.json().catch(() => ({})) }; };
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
async function person(name, email, page, regularOf) { const r = await req("POST", "/api/signup", { name, email, password: "long-password-1", mode: "friends", ...(regularOf ? { regularOf } : {}) }); assert.equal(r.status, 200); const c = cookieOf(r);
  if (page) { const p = await req("POST", "/api/host/profile", page, c); assert.equal(p.status, 200, await p.text()); } return c; }
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "teamup-secret-0123456789abcdef", ENCORE_SIGNUP_PER_HOUR: "200", ENCORE_FAKE_EMAIL: "1", ENCORE_TEAMUP_WEEKLY: "3" };
let maya, sam, lee, kim, ana, fan, guest;
before(async () => { Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer();
  maya = await person("Maya Lee", "maya.tu@example.com", { handle: "maya-runs", name: "Maya's Run Club", city: "New York", hood: "Greenpoint", tagline: "Easy Saturday runs, 5k, all paces" });
  sam = await person("Sam Ortiz", "sam.tu@example.com", { handle: "sam-coffee", name: "Sam's Coffee Pop-up", city: "New York", hood: "Greenpoint", tagline: "Pour-over coffee pop-ups on weekends" });
  lee = await person("Lee Park", "lee.tu@example.com", { handle: "lee-supper", name: "Lee's Supper Club", city: "Austin", tagline: "Supper club, six courses" });
  kim = await person("Kim Wu", "kim.tu@example.com", { handle: "kim-flowers", name: "Kim's Flowers", city: "New York", tagline: "Florist, bouquet workshops" });
  ana = await person("Ana Ruiz", "ana.tu@example.com", { handle: "ana-wine", name: "Ana's Wine Nights", city: "New York", tagline: "Natural wine nights" });
  fan = await person("Fay Fan", "fay.tu@example.com", null, "sam-coffee"); // a guest with an account (a regular), no page
  guest = await person("Gus Guest", "gus.tu@example.com", null, "maya-runs");
  for (const c of [fan, guest]) updateWorkspace((await (await req("GET", "/api/workspace", null, c)).json()).id, { regularOnly: true }); }); // guests: an account to follow and reply, no page
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

test("matching: lanes, formats that go together, the reasons and Potto's line use only facts", () => {
  const run = lanesOf({ name: "Run Club", tagline: "Saturday 5k" }), coffee = lanesOf({ name: "Coffee pop-up" }), supper = lanesOf({ name: "Supper club" }), flowers = lanesOf({ tagline: "Florist" }), pottery = lanesOf({ tagline: "Pottery workshop" });
  assert.ok(run.has("run") && coffee.has("coffee") && supper.has("supper") && flowers.has("flowers") && pottery.has("workshop"));
  assert.equal(complements(run, coffee)[0].line, "A run, then coffee");
  assert.equal(complements(supper, flowers)[0].line, "A supper club with flowers on the table");
  assert.equal(complements(pottery, supper)[0].line, "A workshop with food after");
  assert.deepEqual(complements(run, run), [], "two run clubs are not complementary");
  const m = matchOf({ hood: "Greenpoint", city: "New York", lanes: run }, { hood: "Greenpoint", city: "New York", lanes: coffee, shared: 12 });
  assert.deepEqual(m.reasons.map((r) => r.text), ["You're both in Greenpoint", "Your runs and their coffee", "12 of your guests follow them"]);
  assert.equal(pickLine(m.reasons), "You're both in Greenpoint, your runs and their coffee, and 12 of your guests follow them.");
  // offline ideas name only the two hosts and their place; the model's are guarded the same way
  const C = offlineConcepts({ name: "Maya", city: "New York", hood: "Greenpoint", lanes: run }, { name: "Sam", city: "New York", hood: "Greenpoint", lanes: coffee });
  assert.ok(C.length >= 2 && C.length <= 3); assert.match(C[0].line, /Maya leads an easy run, Sam has coffee ready/); for (const c of C) assert.doesNotMatch(c.title + c.line, /\u2014|\u2013|\$\d/);
  assert.equal(guardConcepts([{ title: "Brunch at Le Bernardin", line: "Sam pours, 40 people come." }, { title: "Run and pour", line: "Maya runs, Sam pours." }], { name: "Maya" }, { name: "Sam" }).length, 1, "a made-up place or number is dropped");
  assert.equal(hideContact("text me at 718 555 0199 or sam@example.com"), "text me at (contact details hidden) or (contact details hidden)");
  // the joint event's public part: two hosts, faces, no split
  const t = publicTeamUp({ hosts: [{ handle: "maya-runs", name: "Maya", first: "Maya", avatarUrl: "javascript:x" }, { handle: "sam-coffee", name: "Sam" }], split: "60-40", cost: "$20" });
  assert.deepEqual(Object.keys(t), ["hosts"]); assert.equal(t.hosts[0].avatarUrl, ""); assert.equal(teamUpNames({ teamUp: t }), "Maya and Sam");
  assert.deepEqual(collabFlag({ teamUp: t }, "maya-runs"), { collab: true, partners: [{ handle: "sam-coffee", name: "Sam" }] });
  assert.deepEqual(collabFlag({}, "maya-runs"), {});
});

test("Team up end to end: opt in, discovery, the request, the thread, yes, the joint event, both pages and both audiences", async () => {
  // 1. off by default: nobody sees Team up on Sam's page
  assert.equal((await json("GET", "/api/teamup/me", null, sam)).j.pref.open, false);
  assert.equal((await json("GET", "/api/teamup/with/sam-coffee", null, maya)).j.show, false);
  assert.equal((await json("POST", "/api/teamup/me", { open: true }, fan)).status, 403, "guests can't opt in");
  for (const [c, pitch] of [[sam, "Coffee for your run club"], [maya, "Runs that end somewhere good"], [lee, "Supper, looking for flowers"], [kim, "Flowers for supper clubs"], [ana, "Wine for dinners"]]) assert.equal((await json("POST", "/api/teamup/me", { open: true, pitch }, c)).status, 200);
  // shared audience: two of Maya's guests follow Sam (counted, never named)
  const S = scopeStore(srv.store, (await json("GET", "/api/workspace", null, maya)).j.id);
  for (const em of ["g1.tu@example.com", "g2.tu@example.com", "g3.tu@example.com"]) S.add("rsvps", { eventId: "x", response: "going", email: em, name: "G" });
  for (const em of ["g1.tu@example.com", "g2.tu@example.com"]) assert.equal((await req("POST", "/api/public/follow", { handle: "sam-coffee", email: em, name: "G" })).status, 200);

  // 2. discovery: Sam first (same neighbourhood, run plus coffee, 2 guests in common); Potto's picks say why
  const M = (await json("GET", "/api/teamup/matches", null, maya)).j;
  assert.equal(M.host, true); assert.equal(M.hosts[0].handle, "sam-coffee"); assert.equal(M.hosts[0].shared, 2);
  assert.deepEqual(M.hosts[0].reasons, ["You're both in Greenpoint", "Your runs and their coffee", "2 of your guests follow them"]);
  assert.ok(!M.hosts.some((h) => h.handle === "maya-runs"), "never yourself");
  assert.equal(M.picks[0].handle, "sam-coffee"); assert.match(M.picks[0].why, /Greenpoint/); assert.ok(M.picks.length <= 3);
  assert.ok(!JSON.stringify(M).includes("g1.tu@example.com"), "no guest emails leave");
  const L = (await json("GET", "/api/teamup/matches", null, lee)).j; assert.ok(L.hosts.findIndex((h) => h.handle === "kim-flowers") < L.hosts.findIndex((h) => h.handle === "maya-runs"), "supper club plus flowers ranks above a run club");
  assert.equal((await json("GET", "/api/teamup/matches", null, fan)).j.host, false); assert.equal((await json("GET", "/api/teamup/matches")).j.signedIn, false);

  // 3. the request: never your own page, never for guests, Potto drafts ideas offline
  assert.equal((await json("GET", "/api/teamup/with/maya-runs", null, maya)).j.own, true);
  assert.equal((await json("GET", "/api/teamup/with/sam-coffee", null, fan)).j.show, false, "guests never see Team up");
  assert.equal((await json("GET", "/api/teamup/with/sam-coffee")).j.show, false);
  const W = (await json("GET", "/api/teamup/with/sam-coffee", null, maya)).j; assert.equal(W.show, true); assert.equal(W.pitch, "Coffee for your run club"); assert.equal(W.left, 3);
  assert.equal((await json("POST", "/api/teamup/request/sam-coffee", { idea: "A run then coffee" }, fan)).status, 403);
  assert.equal((await json("POST", "/api/teamup/request/maya-runs", { idea: "Talking to myself here" }, maya)).status, 400);
  const D = (await json("POST", "/api/teamup/draft/sam-coffee", { idea: "" }, maya)).j; assert.ok(D.concepts.length >= 2 && D.concepts.length <= 3, JSON.stringify(D)); assert.equal(D.source, "offline"); assert.match(D.concepts[0].line, /coffee/);
  const mails0 = fakeOutbox.length;
  const R = await json("POST", "/api/teamup/request/sam-coffee", { idea: D.concepts[0].line, title: D.concepts[0].title, dates: ["2099-03-07", "2099-03-14", "1999-01-01"], mine: "Lead the 5k", theirs: "Pour the coffee", cost: "$15 a person", split: "60-40", audience: "both", message: "Hi Sam! Text me on 718 555 0199." }, maya);
  assert.equal(R.status, 200, JSON.stringify(R.j)); const id = R.j.id; assert.equal(R.j.left, 2);
  assert.equal((await json("POST", "/api/teamup/request/sam-coffee", { idea: "Asking twice before she answers" }, maya)).status, 409);
  // delivered: the bell (which also pushes) and an email
  const bell = (await json("GET", "/api/me/inbox", null, sam)).j.items.find((n) => n.kind === "teamup"); assert.ok(bell); assert.equal(bell.link, `/teamup/${id}`); assert.match(bell.text, /^Maya wants to team up/);
  assert.ok(fakeOutbox.slice(mails0).some((m) => String(m.to).includes("sam.tu@example.com") && /wants to team up/.test(m.subject)));
  assert.ok(!fakeOutbox.slice(mails0).some((m) => /maya\.tu@example\.com/.test(m.text || "")), "the email never carries Maya's address");

  // the thread: sent, seen, replied; contact details hidden; nobody else gets in
  let T = (await json("GET", `/api/teamup/requests/${id}`, null, maya)).j.teamup; assert.equal(T.status, "sent"); assert.equal(T.thread[0].text, "Hi Sam! Text me on (contact details hidden)."); assert.deepEqual(T.dates, ["2099-03-07", "2099-03-14"]);
  T = (await json("GET", `/api/teamup/requests/${id}`, null, sam)).j.teamup; assert.equal(T.status, "seen"); assert.equal(T.incoming, true); assert.deepEqual(T.roles, { me: "Pour the coffee", them: "Lead the 5k" });
  assert.equal((await json("GET", `/api/teamup/requests/${id}`, null, kim)).status, 404);
  assert.equal((await json("POST", `/api/teamup/requests/${id}`, { action: "accept" }, maya)).status, 403, "only Sam can say yes");
  T = (await json("POST", `/api/teamup/requests/${id}`, { action: "message", text: "Love it. sam@example.com if easier" }, sam)).j.teamup; assert.equal(T.status, "replied"); assert.match(T.thread[1].text, /\(contact details hidden\)/);
  assert.ok((await json("GET", "/api/me/inbox", null, maya)).j.items.some((n) => n.kind === "teamup" && /Sam on your team-up/.test(n.text)));

  // 4. yes: a draft co-hosted event in Maya's planner, both hosts on it, the money split with each host's own Get paid
  assert.equal((await json("POST", "/api/me/pay", { venmo: "sam-coffee" }, sam)).status, 200);
  T = (await json("POST", `/api/teamup/requests/${id}`, { action: "accept" }, sam)).j.teamup; assert.equal(T.status, "accepted"); const evId = T.event.id; assert.ok(evId);
  assert.equal(T.event.live, false); assert.match(T.money.splitLine, /Maya 60%, Sam 40%/); assert.equal(T.money.methods.from.length, 0); assert.equal(T.money.methods.to[0].label, "Venmo"); assert.equal(T.money.methods.to[0].handle, "sam-coffee");
  assert.equal((await json("POST", `/api/teamup/requests/${id}`, { action: "decline" }, sam)).status, 409, "answered once");
  const ev = (await json("GET", "/api/db/doc?path=events/" + evId, null, maya)).j.data;
  assert.equal(ev.published, false); assert.deepEqual(ev.cohosts, [{ handle: "sam-coffee", name: "Sam's Coffee Pop-up" }]); assert.deepEqual(ev.teamUp.hosts.map((h) => h.handle), ["maya-runs", "sam-coffee"]);
  assert.deepEqual(ev.dateOptions, ["2099-03-07", "2099-03-14"]); assert.equal(ev.date, undefined, "two dates make a date poll, not a fixed date"); assert.match(ev.sections[0].body, /Maya: Lead the 5k\nSam: Pour the coffee/);
  assert.ok((await json("GET", "/api/me/inbox", null, maya)).j.items.some((n) => /Sam said yes/.test(n.text)));
  // either host edits the plan
  assert.equal((await json("POST", `/api/teamup/requests/${id}/event`, { title: "Run to Coffee", date: "2099-03-07", startTime: "08:30", place: "McCarren Park", city: "New York" }, sam)).status, 200);
  assert.equal((await json("POST", `/api/teamup/requests/${id}/event`, { date: "next week" }, maya)).status, 400);
  assert.equal((await json("POST", `/api/teamup/requests/${id}/announce`, {}, maya)).status, 409, "share once it's live");
  // Maya shares it (discoverable): the guest page says both hosts, never the split
  { const cur = (await json("GET", "/api/db/doc?path=events/" + evId, null, maya)).j.data; const pr = await req("PATCH", "/api/db/doc?path=events/" + evId, { published: true, discoverable: true, _base: cur.updatedAt }, maya); assert.equal(pr.status, 200, await pr.text()); }
  const g2 = await (await req("GET", "/api/db/doc?path=" + encodeURIComponent("events/" + evId), null, "", { "x-encore-guest": "1" })).json(); const gv = g2.data || g2;
  assert.equal(gv.pubTitle, "Run to Coffee"); assert.deepEqual(gv.teamUp.hosts.map((h) => h.first), ["Maya", "Sam"]); assert.equal(gv.teamUp.split, undefined); assert.equal(gv.teamUp.cost, undefined);
  // 5. on both pages, with collab: true and the partner's name; Collaborations on both
  const pm = (await json("GET", "/api/public/host/maya-runs")).j, ps = (await json("GET", "/api/public/host/sam-coffee")).j;
  const cm = pm.upcoming.find((e) => e.id === evId); assert.ok(cm); assert.equal(cm.collab, true); assert.deepEqual(cm.partners, [{ handle: "sam-coffee", name: "Sam's Coffee Pop-up" }]);
  assert.ok(ps.upcoming.some((e) => e.id === evId), "on Sam's page too");
  assert.equal((await json("GET", "/api/public/discover")).j.events.filter((e) => e.id === evId).length <= 1, true, "Discover lists it once");
  const cs = (await json("GET", "/api/public/teamup/sam-coffee")).j.collaborations; assert.equal(cs[0].partner.handle, "maya-runs"); assert.equal(cs[0].events[0].title, "Run to Coffee");
  // both audiences: a follower of Sam's sees it in their feed; each host tells their own followers
  assert.equal((await req("POST", "/api/public/follow", { handle: "sam-coffee" }, guest)).status, 200);
  const feed = (await json("GET", "/api/me/feed", null, guest)).j; assert.ok(JSON.stringify(feed).includes(evId), "Sam's follower sees the joint event");
  const an = (await json("POST", `/api/teamup/requests/${id}/announce`, {}, sam)).j; assert.ok(an.told >= 1, JSON.stringify(an));
  assert.ok((await json("GET", "/api/me/inbox", null, guest)).j.items.some((n) => n.eventId === evId && /Maya and Sam/.test(n.text)));
  assert.equal((await json("POST", `/api/teamup/requests/${id}/announce`, {}, sam)).j.already, true);
  // both hear replies
  const doc = await (await req("GET", "/api/db/doc?path=" + encodeURIComponent("events/" + evId), null, "", { "x-encore-guest": "1" })).json();
  const r = await req("POST", "/api/db/collection?path=rsvps", { eventId: evId, response: "going", name: "Rae Runner", email: "rae.tu@example.com", code: "CRAE01", createdAt: Date.now(), via: "invite-lite" }, "", { "x-encore-guest": "1", "x-encore-key": "k-rae-000001", "x-encore-workspace": doc.workspace });
  assert.equal(r.status, 200, await r.text());
  assert.ok((await json("GET", "/api/me/inbox", null, maya)).j.items.some((n) => n.kind === "reply" && /Rae/.test(n.text)), "Maya hears");
  assert.ok((await json("GET", "/api/me/inbox", null, sam)).j.items.some((n) => n.kind === "reply" && /Rae/.test(n.text) && n.link === `/teamup/${id}`), "Sam hears too");
  // the chat has both hosts (server/chat.js reads event.cohosts)
  assert.equal((await req("GET", `/api/chats/${evId}`, null, sam)).status, 200);
});

test("safety: not now and the 30-day cooldown, the weekly cap, block, requests off, host to host only", async () => {
  // Lee says not now to Kim: Kim can't ask again for 30 days
  const a = (await json("POST", "/api/teamup/request/lee-supper", { idea: "Flowers on your supper table" }, kim)).j.id; assert.ok(a);
  const nn = (await json("POST", `/api/teamup/requests/${a}`, { action: "notnow" }, lee)).j.teamup; assert.equal(nn.status, "declined"); assert.equal(nn.declineKind, "notnow");
  assert.ok((await json("GET", "/api/me/inbox", null, kim)).j.items.some((n) => /can't do this one right now/.test(n.text)));
  const again = await json("POST", "/api/teamup/request/lee-supper", { idea: "Flowers again, please" }, kim); assert.equal(again.status, 429); assert.equal(again.j.code, "cooldown"); assert.match(again.j.message, /ask again from/);
  assert.ok((await json("GET", "/api/teamup/with/lee-supper", null, kim)).j.cooldownUntil > Date.now() + 29 * 864e5);
  // the weekly cap (3 in this test): Maya has sent one; two more, then no
  assert.equal((await json("POST", "/api/teamup/request/kim-flowers", { idea: "Flowers at the finish line" }, maya)).status, 200);
  assert.equal((await json("POST", "/api/teamup/request/ana-wine", { idea: "Wine after the evening run" }, maya)).status, 200);
  const capped = await json("POST", "/api/teamup/request/lee-supper", { idea: "Supper after a long run" }, maya); assert.equal(capped.status, 429); assert.equal(capped.j.code, "weekly_cap");
  // block from the thread: Ana blocks Maya; Maya never sees Team up for Ana again, nor Ana in her matches
  const ab = (await json("GET", "/api/teamup/requests", null, ana)).j.incoming[0]; assert.equal(ab.other.handle, "maya-runs");
  assert.equal((await json("POST", `/api/teamup/requests/${ab.id}`, { action: "block" }, ana)).j.teamup.status, "declined");
  assert.equal((await json("GET", "/api/teamup/with/ana-wine", null, maya)).j.show, false);
  assert.equal((await json("GET", "/api/teamup/with/maya-runs", null, ana)).j.show, false, "both ways");
  assert.ok(!(await json("GET", "/api/teamup/matches", null, maya)).j.hosts.some((h) => h.handle === "ana-wine"));
  assert.equal((await json("POST", "/api/teamup/request/maya-runs", { idea: "Trying after blocking" }, ana)).status, 403);
  assert.equal((await json("POST", "/api/report", { type: "host", target: "host:maya-runs", reason: "spam", note: "test" }, ana)).status, 200, "report from the thread");
  // requests off: Kim turns it off; nobody sees Team up and nobody can ask
  assert.equal((await json("POST", "/api/teamup/me", { open: false }, kim)).j.pref.open, false);
  assert.equal((await json("GET", "/api/teamup/with/kim-flowers", null, lee)).j.show, false);
  assert.equal((await json("POST", "/api/teamup/request/kim-flowers", { idea: "Supper and flowers please" }, lee)).status, 403);
  // the earlier, still-open request from Maya can still be answered
  const km = (await json("GET", "/api/teamup/requests", null, kim)).j.incoming.find((t) => t.other.handle === "maya-runs"); assert.equal((await json("POST", `/api/teamup/requests/${km.id}`, { action: "decline" }, kim)).j.teamup.declineKind, "nothanks");
});

test("the pages: Team up on host pages, Edit page, Find a host and the thread page, in the kit", async () => {
  const c = read("public/collab.js");
  assert.match(c, /data-section="collabs"|dataset\.section = "collabs"/, "Collaborations is a marked, arrangeable block");
  assert.doesNotMatch(c.split("the old \"Suggest a collab\" records")[0], /\u2014|\p{Extended_Pictographic}/u, "no em dashes or emoji in Team up");
  assert.match(read("public/storefront.js"), /EncoreTeamUp\?\.settingsRow/); assert.match(read("public/hostdir.html"), /EncoreTeamUp\?\.dirView/);
  assert.match(read("public/sections.js"), /Hosted by \$\{esc\(nm\(H\[0\]\)\)\} and/);
  for (const p of ["/teamup", "/teamup/abc123abc123", "/hosts?view=teamup"]) { const r = await req("GET", p, null, maya); assert.equal(r.status, 200); }
  assert.ok(read("public/invite.html").length < 40000);
  assert.doesNotMatch(read("server/collab.js"), /claude-|opus|sonnet|haiku/i, "no model names");
});
