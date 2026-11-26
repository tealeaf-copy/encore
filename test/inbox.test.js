// The Inbox (server/inbox.js): grouped Today / This week / Older and newest first, one bold line per row, unread counts
// that match the badge, deep links to the exact place, only your own items, blocks respected, and Let in / Not this time
// for the host right in the row.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { groupKey, groupItems, shortWhen, linesOf as linesOf0, typeOf, mentions, notify, safeLink, namesLine, foldRows } from "../server/inbox.js";

let srv;
const J = { "content-type": "application/json" };
const post = (path, body, cookie, extra = {}) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}), ...extra }, body: JSON.stringify(body || {}) });
const getJ = async (path, cookie) => (await fetch(srv.base + path, { headers: cookie ? { cookie } : {} })).json();
const put = (path, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
let n = 0;
const person = async (name) => { const email = `${name.toLowerCase().replace(/\W+/g, "")}${++n}@example.com`; const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); const b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); return { cookie: cookieOf(r), ws: b.workspace.id, email, name }; };
const host = async (name, handle) => { const h = await person(name); const r = await post("/api/host/profile", { handle, name, city: "New York", bio: "Dinners at home." }, h.cookie); assert.equal(r.status, 200, await r.text()); return { ...h, handle }; };
const guestRsvp = (ws, body, cookie) => fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, "x-encore-guest": "1", "x-encore-key": "k" + Math.random().toString(36).slice(2), "x-encore-workspace": ws, ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ createdAt: Date.now(), ...body }) });
const day = (k) => new Date(Date.now() + k * 864e5).toISOString().slice(0, 10);
const inbox = (who, q = "") => getJ("/api/inbox" + (q ? "?" + q : ""), who.cookie);
const allItems = (j) => j.groups.flatMap((g) => g.items).flatMap((x) => (x.group ? x.items : [x]));

before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "inbox-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "500"; process.env.ENCORE_FAKE_EMAIL = "1"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv.close(); });

test("groups: Today, This week and Older on the reader's calendar, newest first, empty groups left out", () => {
  const now = Date.parse("2026-11-26T15:00:00Z"), H = 3600e3;
  assert.equal(groupKey(now - 2 * H, now, "UTC"), "today");
  assert.equal(groupKey(now - 20 * H, now, "UTC"), "week", "yesterday afternoon is this week, not today");
  assert.equal(groupKey(now - 6 * 24 * H, now, "UTC"), "week");
  assert.equal(groupKey(now - 8 * 24 * H, now, "UTC"), "older");
  // 1am UTC is still yesterday evening in New York
  assert.equal(groupKey(Date.parse("2026-11-26T01:00:00Z"), now, "UTC"), "today");
  assert.equal(groupKey(Date.parse("2026-11-26T01:00:00Z"), now, "America/New_York"), "week");
  const G = groupItems([{ id: "a", at: now - 30 * 24 * H }, { id: "b", at: now - H }, { id: "c", at: now - 3 * 24 * H }, { id: "d", at: now - 5 * 60e3 }, { id: "e", at: now - 2 * 24 * H }], now, "UTC");
  assert.deepEqual(G.map((g) => g.label), ["Today", "This week", "Older"]);
  assert.deepEqual(G.map((g) => g.items.map((x) => x.id)), [["d", "b"], ["e", "c"], ["a"]]);
  assert.deepEqual(groupItems([{ id: "x", at: now - 60e3 }], now, "UTC").map((g) => g.key), ["today"], "no empty This week or Older");
  assert.equal(shortWhen(now - 20e3, now, "UTC"), "now");
  assert.equal(shortWhen(now - 12 * 60e3, now, "UTC"), "12m");
  assert.equal(shortWhen(now - 3 * H, now, "UTC"), "3h");
  assert.equal(shortWhen(now - 9 * H, now, "UTC"), "9h");
  assert.equal(shortWhen(now - 20 * H, now, "UTC"), "20h", "the last day reads in hours");
  assert.equal(shortWhen(now - 2 * 24 * H, now, "UTC"), "Nov 24", "then dates");
  assert.equal(shortWhen(Date.parse("2026-11-03T12:00:00Z"), now, "UTC"), "Nov 3");
});

test("rows: one bold line with the actor and the thing, a preview, and the right type", () => {
  const linesOf = (n, o) => { const r = linesOf0(n, o); return { line: r.line, preview: r.preview }; };
  assert.deepEqual(linesOf({ kind: "reply", text: "🎉 Maya is in for Dumpling Night." }), { line: "Maya replied I'm in to Dumpling Night", preview: "" });
  assert.equal(linesOf({ kind: "reply", text: "Jo said Maybe to Game night." }).line, "Jo replied Maybe to Game night");
  assert.deepEqual(linesOf({ kind: "reply", text: "Ana can't go to Supper now. Their spot opened up." }), { line: "Ana replied Can't go to Supper", preview: "Their spot opened up." });
  assert.deepEqual(linesOf({ kind: "chat", text: "💬 Dumpling Night. Maya: see you at 7, @Sam" }, { title: "Dumpling Night" }), { line: "Maya wrote in Dumpling Night", preview: "see you at 7, @Sam" });
  assert.equal(linesOf({ kind: "mention", text: "💬 Dumpling Night. Maya: @Sam bring cards" }, { title: "Dumpling Night" }).line, "Maya mentioned you in Dumpling Night");
  assert.deepEqual(linesOf({ kind: "kudos-in", text: "💌 Ana sent kudos for Supper: \"So warm\"" }), { line: "Ana sent kudos for Supper", preview: "So warm" });
  assert.equal(linesOf({ kind: "club", text: "Bo's Regulars first: Pandan drop. Open to members until Fri 6pm." }).line, "Your Bo's Regulars spots open now");
  assert.equal(linesOf({ title: "Maya asked to join", preview: "Hi" }).preview, "Hi", "a notify() item keeps its own title and preview");
  assert.ok(mentions("see you @sam!", "Sam Diaz")); assert.ok(!mentions("see you sam", "Sam Diaz")); assert.ok(!mentions("@samantha", "Sam"));
  assert.equal(typeOf({ kind: "chat", text: "Maya: @Sam hi" }, { name: "Sam" }), "mention");
  assert.equal(typeOf({ kind: "chat", text: "Maya: hi" }, { name: "Sam" }), "chat");
  assert.equal(typeOf({ kind: "club", key: "club-ev1" }), "members");
  assert.equal(typeOf({ kind: "club", key: "join-abc" }), "people");
  assert.equal(typeOf({ kind: "waitlist" }), "spot");
  assert.equal(typeOf({ kind: "prep" }), "reminder");
  assert.equal(typeOf({ kind: "follow" }), "event");
  assert.equal(typeOf({ kind: "kudos-in" }), "kudos");
  assert.equal(safeLink("https://evil.example/x"), ""); assert.equal(safeLink("//evil.example"), ""); assert.equal(safeLink("/chats/ev1"), "/chats/ev1");
});

test("ask to join: the host sees it under Needs you with Let in and Not this time, and one tap lets the guest in", async () => {
  const bo = await host("Bo Tran", "bo-inbox"), sam = await person("Sam Diaz");
  assert.equal((await put("events/inbdin1", { name: "Dumpling Night", kind: "social", casual: true, date: day(5), city: "New York", approvalRequired: true, discoverable: true, published: true, headcount: 8 }, bo.cookie)).status, 200);
  let r = await guestRsvp(bo.ws, { eventId: "inbdin1", name: "Sam Diaz", email: sam.email, response: "going", code: "S1" }, sam.cookie); assert.equal(r.status, 200, await r.text());
  let j = await inbox(bo, "tz=America/New_York");
  const ask = allItems(j).find((x) => x.type === "approval"); assert.ok(ask, JSON.stringify(j));
  assert.equal(ask.line, "Sam asked to join Dumpling Night");
  assert.equal(ask.actor.name, "Sam");
  assert.deepEqual(ask.needs, { type: "approve", state: "pending" });
  assert.equal(ask.link, "/?app=1&open=inbdin1&step=6#studio", "opens the guest list");
  assert.ok(ask.filters.includes("needs")); assert.equal(j.counts.needs, 1);
  assert.equal(j.groups[0].label, "Today");
  assert.ok(!JSON.stringify(j).includes(sam.email), "the guest's email never reaches the page");
  const needs = await inbox(bo, "filter=needs"); assert.equal(allItems(needs).length, 1); assert.equal(needs.filter, "needs");
  // someone else can't decide it, even with the id
  r = await post("/api/inbox/decide", { id: ask.id, decision: "in" }, sam.cookie); assert.equal(r.status, 404);
  r = await post("/api/inbox/decide", { id: ask.id, decision: "maybe" }, bo.cookie); assert.equal(r.status, 400);
  r = await post("/api/inbox/decide", { id: ask.id, decision: "in" }, bo.cookie); j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j));
  assert.equal(j.needs.state, "in"); assert.equal(j.name, "Sam");
  j = await inbox(bo); const after = allItems(j).find((x) => x.id === ask.id); assert.equal(after.needs.state, "in"); assert.equal(after.type, "reply"); assert.equal(after.read, true); assert.equal(j.counts.needs, 0);
  r = await post("/api/inbox/decide", { id: ask.id, decision: "not" }, bo.cookie); assert.equal((await r.json()).already, true, "a decided ask stays decided");
  // the guest hears they're in, and the row opens the group chat
  const mine = allItems(await inbox(sam)); const letin = mine.find((x) => x.kind === "letin"); assert.ok(letin, JSON.stringify(mine));
  assert.equal(letin.type, "spot"); assert.equal(letin.link, "/chats/inbdin1"); assert.equal(letin.actor.name, "Bo Tran", "the host's face on the row");
  assert.ok(!mine.some((x) => x.kind === "ask"), "only your own items");
});

test("Not this time from the Inbox says no and the guest isn't told they're in", async () => {
  const bo = await host("Bo Two", "bo-inbox2"), kim = await person("Kim Park");
  await put("events/inbdin2", { name: "Hot pot", kind: "social", casual: true, date: day(4), city: "New York", approvalRequired: true, published: true, headcount: 6 }, bo.cookie);
  await guestRsvp(bo.ws, { eventId: "inbdin2", name: "Kim Park", email: kim.email, response: "going", code: "K1" }, kim.cookie);
  const ask = allItems(await inbox(bo)).find((x) => x.type === "approval");
  const j = await (await post("/api/inbox/decide", { id: ask.id, decision: "not" }, bo.cookie)).json(); assert.equal(j.needs.state, "not");
  assert.ok(!allItems(await inbox(kim)).some((x) => x.kind === "letin"));
});

test("unread counts and the badge stay in step: read one, read all, mark unread, archive", async () => {
  const ana = await person("Ana Lee"); const X = srv.app.locals.social;
  for (let i = 0; i < 3; i++) notify(X, ana.email, { kind: "reminder", key: "r" + i, title: `Reminder ${i}`, link: "/plans" });
  let b = await getJ("/api/inbox/badge", ana.cookie); assert.equal(b.unread, 3);
  let j = await inbox(ana); assert.equal(j.unread, 3); assert.equal(j.counts.all, 3);
  const [one, two] = allItems(j);
  let r = await (await post("/api/inbox/read", { ids: [one.id] }, ana.cookie)).json(); assert.equal(r.unread, 2);
  assert.equal((await getJ("/api/inbox/badge", ana.cookie)).unread, 2, "the badge matches the page");
  r = await (await post("/api/inbox/read", { ids: [one.id], unread: true }, ana.cookie)).json(); assert.equal(r.unread, 3, "mark unread again");
  r = await (await post("/api/inbox/archive", { ids: [two.id] }, ana.cookie)).json(); assert.equal(r.unread, 2);
  j = await inbox(ana); assert.equal(j.counts.all, 2); assert.ok(!allItems(j).some((x) => x.id === two.id), "archived rows leave the list");
  r = await (await post("/api/inbox/archive", { ids: [two.id], undo: true }, ana.cookie)).json(); assert.equal((await inbox(ana)).counts.all, 3, "undo brings it back");
  r = await (await post("/api/inbox/read", { all: true }, ana.cookie)).json(); assert.equal(r.unread, 0);
  assert.equal((await getJ("/api/inbox/badge", ana.cookie)).unread, 0);
  assert.equal((await fetch(srv.base + "/api/inbox/badge")).status, 401, "signed out: nothing");
});

test("deep links: each kind opens the exact place", async () => {
  const bo = await host("Bo Three", "bo-inbox3"), lee = await person("Lee Wong"), X = srv.app.locals.social;
  await put("events/inbev3", { name: "Game night", kind: "social", casual: true, date: day(2), city: "New York", discoverable: true, published: true, headcount: 8 }, bo.cookie);
  X.notify(lee.email, { kind: "chat", key: "c1", text: "💬 Game night. Bo: @Lee bring Catan", link: "/chats/inbev3", eventId: "inbev3" });
  X.notify(lee.email, { kind: "follow", key: "f1", text: "Bo Three posted something new: Game night", link: "/e/inbev3", eventId: "inbev3" });
  X.notify(lee.email, { kind: "club", key: "club-inbev3", text: "Bo's Regulars first: Game night. Open to members until Fri 6pm.", link: "/e/inbev3", eventId: "inbev3" });
  X.notify(lee.email, { kind: "waitlist", key: "w1", text: "🎉 A spot opened up. You're in for Game night.", link: "/g#rsvp-inbev3", eventId: "inbev3" });
  X.notify(lee.email, { kind: "vibe", key: "v1", text: "Bo gave you a badge for Game night", link: "/kudos" });
  X.notify(lee.email, { kind: "reminder", key: "rm", text: "Game night is tomorrow", eventId: "inbev3" });
  const I = allItems(await inbox(lee)), by = (k) => I.find((x) => x.kind === k);
  assert.equal(by("chat").type, "mention"); assert.equal(by("chat").link, "/chats/inbev3"); assert.equal(by("chat").line, "Bo mentioned you in Game night"); assert.ok(by("chat").filters.includes("needs"));
  assert.equal(by("follow").link, "/e/inbev3"); assert.equal(by("follow").type, "event"); assert.equal(by("follow").actor.name, "Bo Three");
  assert.equal(by("club").type, "members"); assert.equal(by("club").line, "Your Bo's Regulars spots open now");
  assert.equal(by("waitlist").link, "/g#rsvp-inbev3"); assert.equal(by("waitlist").type, "spot");
  assert.equal(by("vibe").link, "/kudos"); assert.equal(by("vibe").type, "kudos");
  assert.equal(by("reminder").link, "/e/inbev3", "no link of its own: the event"); assert.equal(by("reminder").actor.glyph, "clock", "notes from us get a glyph, not a face");
  const chats = allItems(await inbox(lee, "filter=chats")); assert.deepEqual(chats.map((x) => x.kind), ["chat"]);
  const events = allItems(await inbox(lee, "filter=events")).map((x) => x.kind).sort(); assert.deepEqual(events, ["club", "follow", "reminder", "waitlist"]);
});

test("privacy: blocked people and hosts drop out, and the notify() helper keeps the actor's email on the server", async () => {
  const me = await person("Mia Cole"), pest = await person("Pat Moss"), bo = await host("Bo Four", "bo-inbox4"), X = srv.app.locals.social;
  await put("events/inbev4", { name: "Supper", kind: "social", casual: true, date: day(3), city: "New York", discoverable: true, published: true }, bo.cookie);
  notify(X, me.email, { kind: "reply", key: "p1", actor: { name: "Pat Moss", email: pest.email }, title: "Pat replied I'm in to your thing", preview: "See you", link: "/plans" });
  X.notify(me.email, { kind: "friend", key: "p2", from: pest.email, text: "Pat added you as a friend", link: "/feed" });
  X.notify(me.email, { kind: "follow", key: "b1", text: "Bo Four posted something new: Supper", link: "/e/inbev4", eventId: "inbev4" });
  let j = await inbox(me); assert.equal(j.counts.all, 3);
  const p1 = allItems(j).find((x) => x.line === "Pat replied I'm in to your thing"); assert.equal(p1.preview, "See you"); assert.equal(p1.actor.name, "Pat Moss");
  assert.ok(!JSON.stringify(j).includes(pest.email), "no one else's email in the page");
  const key = Buffer.from(pest.email).toString("base64url");
  assert.equal((await post("/api/me/blocks", { kind: "person", key, name: "Pat" }, me.cookie)).status, 200);
  j = await inbox(me); assert.equal(j.counts.all, 1, "both of Pat's items are gone"); assert.equal((await getJ("/api/inbox/badge", me.cookie)).unread, 1);
  assert.equal((await post("/api/me/blocks", { kind: "host", handle: "bo-inbox4", name: "Bo" }, me.cookie)).status, 200);
  j = await inbox(me); assert.equal(j.counts.all, 0, "a blocked host's events leave too");
  // someone else's ids do nothing
  const other = await person("Oz Ray"); notify(X, other.email, { kind: "reminder", key: "o1", title: "Yours" });
  const oid = allItems(await inbox(other))[0].id;
  const r = await (await post("/api/inbox/archive", { ids: [oid] }, me.cookie)).json(); assert.equal(r.changed, 0);
  assert.equal((await inbox(other)).counts.all, 1);
});

test("the page is served and the bell hook is on every shell page", async () => {
  const r = await fetch(srv.base + "/inbox"); assert.equal(r.status, 200); const h = await r.text();
  assert.match(h, /<title>Inbox/); assert.match(h, /\/potto\.js/);
  const shell = fs.readFileSync(new URL("../public/shell.js", import.meta.url), "utf8"); assert.match(shell, /\/potto\.js/);
  const p = fs.readFileSync(new URL("../public/potto.js", import.meta.url), "utf8"); assert.match(p, /#bell|homeBell/); assert.match(p, /\/api\/inbox\/badge/);
  for (const f of ["../public/inbox.html", "../public/potto.js", "../server/inbox.js", "../server/potto.js", "../server/pottorules.js"]) assert.ok(!/—/.test(fs.readFileSync(new URL(f, import.meta.url), "utf8")), f + " has no em dashes");
});

test("folding: similar rows collapse into one with an avatar stack, approvals and mentions never do", () => {
  assert.equal(namesLine(["Priya"]), "Priya"); assert.equal(namesLine(["Priya", "Jun"]), "Priya and Jun"); assert.equal(namesLine(["Priya", "Jun", "Ana"]), "Priya, Jun and Ana");
  assert.equal(namesLine(["Priya", "Jun", ...Array.from({ length: 10 }, (_, i) => "P" + i)]), "Priya, Jun and 10 others");
  const r = (id, name, verb = "I'm in", ev = "e1") => ({ id, kind: "reply", type: "reply", eventId: ev, at: 100 - +id, read: false, actor: { name }, line: `${name} replied ${verb} to Dumpling Night`, _c: { verb, obj: "Dumpling Night" } });
  const F = foldRows([r("1", "Priya"), r("2", "Jun"), { id: "a", kind: "ask", type: "approval", at: 97, actor: { name: "Sam" } }, r("3", "Ana"), r("4", "Bo", "Maybe"), r("5", "Kit", "I'm in", "e2")]);
  assert.equal(F.length, 4);
  assert.equal(F[0].group, true); assert.equal(F[0].count, 3); assert.equal(F[0].line, "Priya, Jun and Ana replied I'm in to Dumpling Night"); assert.deepEqual(F[0].ids, ["1", "2", "3"]); assert.equal(F[0].faces.length, 3); assert.equal(F[0].unread, 3);
  assert.equal(F[1].type, "approval", "an ask stays on its own"); assert.equal(F[2].line, "Bo replied Maybe to Dumpling Night", "Maybe is its own row"); assert.equal(F[3].id, "5", "another event is its own row");
  const ev = (id, host) => ({ id, kind: "follow", type: "event", at: 50, actor: { name: host }, _c: {} });
  assert.equal(foldRows([ev("x", "Maya's Table"), ev("y", "Bo's Omecasa"), ev("z", "Claire")])[0].line, "New events from Maya's Table and 2 others");
});

test("the Inbox folds replies to the same event, and a row's menu mutes a host or turns a kind off", async () => {
  const bo = await host("Bo Five", "bo-inbox5"), me = await person("Uma Fold"), X = srv.app.locals.social;
  await put("events/inbev5", { name: "Hot pot", kind: "social", casual: true, date: day(3), city: "New York", discoverable: true, published: true, headcount: 8 }, bo.cookie);
  for (const nm of ["Priya", "Jun", "Ana", "Lee"]) X.notify(bo.email, { kind: "reply", key: "f-" + nm, text: `🎉 ${nm} is in for Hot pot.`, link: "/?app=1&open=inbev5#studio", eventId: "inbev5" });
  let j = await inbox(bo); const g = j.groups[0].items.find((x) => x.group); assert.ok(g, JSON.stringify(j.groups[0].items));
  assert.equal(g.line, "Lee, Ana and 2 others replied I'm in to Hot pot"); assert.equal(g.count, 4); assert.equal(g.glyph, "check"); assert.equal(g.items.length, 4);
  let r = await (await post("/api/inbox/read", { ids: g.ids }, bo.cookie)).json(); assert.equal(r.unread, 0, "marking the folded row reads every row in it");
  // Uma follows Bo with the bell on, so his new events reach her
  assert.equal((await post("/api/me/following/bo-inbox5", { on: true }, me.cookie)).status, 200);
  X.notify(me.email, { kind: "follow", key: "fol-inbev5", text: "Bo Five posted something new: Hot pot", link: "/e/inbev5", eventId: "inbev5" });
  X.notify(me.email, { kind: "kudos-in", key: "k1", text: "💌 Ana sent kudos for Supper: \"Lovely\"", link: "/kudos" });
  j = await inbox(me); const fol = allItems(j).find((x) => x.kind === "follow"); assert.equal(fol.glyph, "bell"); assert.deepEqual(fol.host, { handle: "bo-inbox5", name: "Bo Five" });
  r = await (await post("/api/inbox/mute", { id: fol.id }, me.cookie)).json(); assert.equal(r.muted.handle, "bo-inbox5"); assert.equal(r.bellOff, true);
  j = await inbox(me); assert.ok(!allItems(j).some((x) => x.kind === "follow"), "the muted host's rows leave"); assert.deepEqual(j.prefs.mutedHosts.map((m) => m.handle), ["bo-inbox5"]);
  const f = await getJ("/api/me/following", me.cookie); assert.equal(f.hosts[0].notify, false, "and the follow bell is off");
  await post("/api/inbox/mute", { undo: true, handle: "bo-inbox5" }, me.cookie); assert.ok(allItems(await inbox(me)).some((x) => x.kind === "follow"), "unmute brings them back");
  const kd = allItems(await inbox(me)).find((x) => x.kind === "kudos-in");
  r = await (await post("/api/inbox/kind", { id: kd.id }, me.cookie)).json(); assert.equal(r.type, "kudos"); assert.equal(r.label, "Kudos");
  j = await inbox(me); assert.ok(!allItems(j).some((x) => x.type === "kudos")); assert.deepEqual(j.prefs.offTypes, [{ type: "kudos", label: "Kudos" }]);
  await post("/api/inbox/kind", { type: "kudos", on: true }, me.cookie); assert.ok(allItems(await inbox(me)).some((x) => x.type === "kudos"));
  assert.equal((await post("/api/inbox/kind", { type: "approval" }, me.cookie)).status, 400, "asks to join can't be turned off");
});

test("a host's update to the fan club reads as a post, with the host's face and a two-line preview", async () => {
  const bo = await host("Bo Six", "bo-inbox6"), mem = await person("Mo Member");
  assert.equal((await post("/api/host/club", { on: true }, bo.cookie)).status, 200);
  assert.equal((await post("/api/me/club/bo-inbox6/join", {}, mem.cookie)).status, 200);
  const r = await post("/api/host/club/posts", { text: "Testing a new dumpling fold this week. Members get first dibs on Friday's batch." }, bo.cookie); assert.equal(r.status, 200, await r.text());
  const p = allItems(await inbox(mem)).find((x) => x.type === "post"); assert.ok(p);
  assert.equal(p.style, "post"); assert.equal(p.glyph, "spark"); assert.equal(p.actor.name, "Bo Six"); assert.equal(p.line, "Recent post from Bo Six"); assert.match(p.preview, /^Testing a new dumpling fold.*Friday's batch\.$/); assert.equal(p.link, "/@bo-inbox6#club");
});
