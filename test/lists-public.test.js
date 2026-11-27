// Lists people follow (server/curation.js, server/listfeed.js, docs/lists-pm-spec.md): Private, Friends, Link and
// Public lists on every surface (curator page, Discover's shelf, a host's lists, the feed, kudos and comments on a list
// card, the list page), private events masked inside public lists, follow a curator or a list in place, feed card
// batching, "I'd go again" only after going, a host's "On N public lists" counting public lists only, blocks both
// ways and stepping out of a friend's lists.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore } from "../server/workspaces.js";
import { batchCards, namesLine } from "../server/listfeed.js";
import { goAgainLine } from "../server/curation.js";

let srv;
const J = { "Content-Type": "application/json" };
const req = (method, path, body, cookie) => fetch(srv.base + path, { method, headers: { ...J, ...(cookie ? { cookie } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const post = async (path, body, cookie) => (await req("POST", path, body, cookie)).json();
const put = (path, body, cookie) => req("PUT", "/api/db/doc?path=" + path, body, cookie);
const raw = async (path, cookie) => { const r = await fetch(srv.base + path, { headers: cookie ? { cookie } : {} }); return { status: r.status, text: await r.text() }; };
const get = async (path, cookie, status = 200) => { const r = await raw(path, cookie); assert.equal(r.status, status, path + " " + r.text.slice(0, 200)); return JSON.parse(r.text); };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const wsOf = (handle) => srv.store.get("system/handle-" + handle).data.ws;
const X = () => srv.app.locals.social;
let n = 0;
async function account(name, email) { const r = await req("POST", "/api/signup", { name, email, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200, "signup " + email); return r.headers.get("set-cookie").split(";")[0]; }
const rsvp = (handle, eventId, r) => scopeStore(srv.store, wsOf(handle)).set("rsvps/lp" + ++n, { eventId, response: "going", createdAt: Date.now() - 864e5 * 20, ...r });

const E = { maya: "maya.lp@example.com", ben: "ben.lp@example.com", cy: "cy.lp@example.com", dee: "dee.lp@example.com", ada: "ada.lp@example.com" };
let maya, ben, cy, dee, ada, hostC, mayaHandle, listId, token;
const feedOf = async (c) => (await get("/api/me/feed", c)).blend?.items || [];
const listCards = async (c) => (await feedOf(c)).filter((i) => i.kind === "list");
// what a stranger can reach about Maya's lists, as one string
const strangerView = async (c) => { const parts = [];
  for (const p of [`/api/public/curators/${mayaHandle}`, "/api/public/lists-popular", "/api/public/host-lists/mo-lists", "/api/public/feed"]) parts.push((await raw(p, c)).text);
  if (c) { parts.push((await raw("/api/me/feed", c)).text); parts.push((await raw("/api/me/library", c)).text); parts.push((await raw("/api/me/lists/following", c)).text); }
  return parts.join("\n"); };

before(async () => {
  Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "lists-public-secret", ENCORE_SIGNUP_PER_HOUR: "200", ENCORE_DIRECTORY_CACHE_MS: "0", ENCORE_FAKE_EMAIL: "1", ENCORE_LISTS_NUDGE_MIN: "1" }); resetLoginLimits();
  srv = await startServer();
  hostC = await account("Mo Rivera", "mo.lp@example.com");
  assert.ok((await post("/api/host/profile", { handle: "mo-lists", name: "Mo Rivera", tagline: "Small suppers.", emoji: "🍜", city: "Brooklyn", hood: "Bed-Stuy" }, hostC)).ok);
  const up = { startTime: "19:00", city: "Brooklyn", hood: "Bed-Stuy", headcount: 10, discoverable: true, activity: "dinner" };
  for (const [id, name, d] of [["lpA", "Dumpling night", 6], ["lpB", "Sunday pasta", 7], ["lpC", "Bar seats supper", 8], ["lpD", "Pie social", 9], ["lpE", "Soup swap", 10]]) assert.ok((await put("events/" + id, { ...up, date: day(d), name }, hostC)).ok);
  assert.ok((await put("events/lpSecret", { ...up, date: day(9), name: "HUSH-SECRET-BIRTHDAY", discoverable: false, published: true }, hostC)).ok);
  assert.ok((await put("events/lpPast", { ...up, date: day(-5), name: "Autumn soup night" }, hostC)).ok);
  assert.ok((await put("events/lpMissed", { ...up, date: day(-3), name: "Rainy noodle night" }, hostC)).ok);
  rsvp("mo-lists", "lpPast", { name: "Ada Lovel", email: E.ada });
  rsvp("mo-lists", "lpMissed", { name: "Ben Okafor", email: E.ben, noShow: true });
  rsvp("mo-lists", "lpA", { name: "Ben Okafor", email: E.ben, createdAt: Date.now() + 3600e3 }); // after he opens Maya's list
  maya = await account("Maya Chen", E.maya); ben = await account("Ben Okafor", E.ben); cy = await account("Cy Stranger", E.cy); dee = await account("Dee Blocker", E.dee); ada = await account("Ada Lovel", E.ada);
  for (const c of [maya, ben, cy, dee, ada]) await get("/api/me/profile", c);
  mayaHandle = X().person(E.maya).handle; assert.ok(mayaHandle, "maya has a handle");
  // Maya adds Ben and Dee as friends (one way: they can see her Friends lists)
  X().addFriend(E.maya, E.ben); X().addFriend(E.maya, E.dee); X().bust();
  const L = await post("/api/me/library/lists", { name: "Quiet dinners in Brooklyn" }, maya); listId = L.list.id; assert.equal(L.list.share, "private", "new lists start private");
  for (const [ref, title] of [["lpSecret", "HUSH-SECRET-BIRTHDAY"], ["lpA", "Dumpling night"], ["lpB", "Sunday pasta"], ["lpC", "Bar seats supper"]]) assert.ok((await post(`/api/me/library/lists/${listId}/items`, { kind: "event", ref, title }, maya)).added);
  assert.ok((await post(`/api/me/library/lists/${listId}/items`, { kind: "host", ref: "mo-lists", title: "Mo Rivera" }, maya)).added);
});
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_DIRECTORY_CACHE_MS", "ENCORE_FAKE_EMAIL", "ENCORE_LISTS_NUDGE_MIN"]) delete process.env[k]; await srv.close(); });

const setShare = async (share) => { const r = await post(`/api/me/library/lists/${listId}`, { share }, maya); assert.equal(r.list.share, share); token = r.list.link ? r.list.link.slice(3) : ""; return r; };

test("feed card batching: one card per list per day, made at 3+ items, added only for 2+ new on a later day", () => {
  const D = 864e5, now = Date.parse("2026-11-20T18:00:00Z"), t = (d, h = 12) => Date.parse(`2026-11-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00Z`), it = (title, at) => ({ title, at });
  assert.deepEqual(batchCards([it("a", t(10)), it("b", t(10))], { now }), [], "two things is not a list yet");
  const C = batchCards([it("a", t(10, 9)), it("b", t(10, 10)), it("c", t(10, 11)), it("d", t(10, 15)), it("e", t(12)), it("f", t(14, 9)), it("g", t(14, 10)), it("h", t(15))], { now });
  assert.deepEqual(C.map((c) => [c.type, c.items.length]), [["made", 4], ["added", 2]], "made joins the same day's adds; one add on a day is not shown; two on a day are");
  assert.equal(new Set(C.map((c) => c.day)).size, C.length, "at most one card per list per day");
  // shared later: made lands the day it reached the viewer, with everything so far
  const S = batchCards([it("a", t(1)), it("b", t(2)), it("c", t(3)), it("d", t(18, 9)), it("e", t(18, 10))], { from: t(17), now });
  assert.deepEqual(S.map((c) => [c.type, c.items.length]), [["made", 3], ["added", 2]]);
  assert.deepEqual(batchCards([it("a", t(1)), it("b", t(1)), it("c", t(1))], { now: now + 30 * D }), [], "old cards drop out");
  assert.equal(namesLine([{ title: "A" }, { title: "B" }]), "A and B"); assert.equal(namesLine([{ title: "A" }, { title: "B" }, { title: "C" }]), "A and 2 more");
  assert.equal(goAgainLine(5, false, ["Maya"]), "5 would go again, including Maya"); assert.equal(goAgainLine(1, true), "You'd go again"); assert.equal(goAgainLine(3, false), "3 would go again");
});

test("Private: never on any surface, for a friend or a stranger", async () => {
  await setShare("private"); assert.equal(token, "", "a private list has no link");
  for (const c of [ben, cy, null]) { const s = await strangerView(c); assert.ok(!s.includes("Quiet dinners"), "private list leaked"); }
  assert.equal((await get("/api/public/host-lists/mo-lists")).count, 0, "a host never counts a private list");
  assert.equal((await listCards(ben)).length, 0);
});

test("Friends: friends see the card and the list; strangers, signed out and the host's count never do", async () => {
  await setShare("friends"); assert.ok(token);
  const cards = await listCards(ben); assert.equal(cards.length, 1, "a friend gets one card"); const c = cards[0];
  assert.equal(c.type, "made"); assert.equal(c.text, "Maya made a list"); assert.equal(c.list.name, "Quiet dinners in Brooklyn"); assert.equal(c.list.count, 4, "the private event is not counted");
  assert.ok(c.items.length >= 3 && c.items.length <= 4); assert.ok(!JSON.stringify(c).includes("HUSH"), "no private event title in a feed card"); assert.ok(!JSON.stringify(c).includes("@example.com"), "no email in a feed card");
  assert.equal(c.list.canFollow, false, "a friends list isn't followable");
  // kudos and comments go through the same gate: a friend can, a stranger can't
  assert.ok((await post("/api/feed/kudos", { target: c.kudos.target }, ben)).ok);
  assert.equal((await req("POST", "/api/feed/kudos", { target: c.kudos.target }, cy)).status, 404);
  assert.equal((await raw("/api/feed/comments?target=" + encodeURIComponent(c.kudos.target), cy)).status, 404);
  for (const ck of [cy, null]) { const s = await strangerView(ck); assert.ok(!s.includes("Quiet dinners"), "friends list leaked to a stranger"); }
  assert.equal((await raw("/api/public/lists/" + token, cy)).status, 403, "a stranger with the link is told it's for friends");
  assert.equal((await get("/api/public/host-lists/mo-lists")).count, 0, "a friends list isn't public to the host");
  assert.equal((await listCards(maya)).length, 0, "never in the owner's own feed");
  assert.equal((await get("/api/public/lists/" + token, ben)).name, "Quiet dinners in Brooklyn", "a friend opens it");
  const lib = await get("/api/me/library", ben); assert.ok(lib.shared.some((l) => l.name === "Quiet dinners in Brooklyn"), "Shared with you");
});

test("Link: anyone with the link can open it, and it's on no list of anything", async () => {
  await setShare("link");
  const v = await get("/api/public/lists/" + token, cy); assert.equal(v.name, "Quiet dinners in Brooklyn"); assert.ok(!JSON.stringify(v).includes("HUSH"));
  for (const c of [ben, cy, null]) { const s = await strangerView(c); assert.ok(!s.includes("Quiet dinners"), "link list listed somewhere"); }
  assert.equal((await post(`/api/me/lists/${token}/follow`, {}, cy)).code, "not_found", "only public lists can be followed");
});

test("Public: on the curator page, the shelf, the host's lists and followers' feeds, private events masked", async () => {
  const before = token; await setShare("public"); assert.equal(token, before, "the old share link keeps working");
  const cur = await get(`/api/public/curators/${mayaHandle}`); assert.equal(cur.name, "Maya"); assert.equal(cur.lists.length, 1); assert.equal(cur.lists[0].count, 4);
  const pop = await get("/api/public/lists-popular"); assert.ok(pop.lists.some((l) => l.name === "Quiet dinners in Brooklyn"));
  const hl = await get("/api/public/host-lists/mo-lists"); assert.equal(hl.count, 1); assert.equal(hl.top[0].name, "Quiet dinners in Brooklyn");
  const view = await get("/api/public/lists/" + token); assert.equal(view.mode, "public"); assert.equal(view.curator.url, `/@${mayaHandle}/lists`);
  const all = [JSON.stringify(cur), JSON.stringify(pop), JSON.stringify(hl), JSON.stringify(view), (await raw(`/@${mayaHandle}/lists`)).text];
  for (const s of all) { assert.ok(!s.includes("HUSH"), "a private event title in a public list"); assert.ok(!s.includes("@example.com"), "an email in a public answer"); }
  assert.equal((await raw(`/@${mayaHandle}/lists`)).status, 200);
  // a stranger who doesn't follow sees no card; following the curator puts it in their feed
  assert.equal((await listCards(cy)).length, 0);
  const f = await post(`/api/me/curators/${mayaHandle}/follow`, { on: true }, cy); assert.equal(f.following, true); assert.equal(f.followers, 1);
  const cc = await listCards(cy); assert.equal(cc.length, 1); assert.equal(cc[0].list.canFollow, true); assert.ok(!JSON.stringify(cc).includes("HUSH"));
  // Undo
  assert.equal((await post(`/api/me/curators/${mayaHandle}/follow`, { on: false }, cy)).following, false); assert.equal((await listCards(cy)).length, 0);
  assert.equal((await get(`/api/public/curators/${mayaHandle}`, cy)).following, false);
});

test("follow one list and save it, in place; the curator's strip counts them", async () => {
  const f = await post(`/api/me/lists/${token}/follow`, { on: true }, cy); assert.equal(f.following, true); assert.equal(f.followers, 1);
  assert.equal((await listCards(cy)).length, 1, "a followed list shows in the feed");
  const s = await post(`/api/me/lists/${token}/save`, { on: true }, cy); assert.equal(s.saved, true);
  const fol = await get("/api/me/lists/following", cy); assert.equal(fol.lists[0].name, "Quiet dinners in Brooklyn"); assert.equal(fol.lists[0].following, true);
  assert.equal((await post(`/api/me/lists/${token}/follow`, {}, maya)).code, "invalid", "not your own list");
  const st = await get("/api/me/lists/stats", maya); assert.equal(st.followers, 1); assert.equal(st.saves, 1); assert.ok(st.went >= 1, "Ben opened the list, then said I'm in to Dumpling night"); assert.equal(st.publicLists, 1);
});

test("I'd go again: only after going, counted on the item and the event and host pages", async () => {
  assert.equal((await req("POST", "/api/me/again", { kind: "event", ref: "lpPast", on: true }, cy)).status, 403, "Cy didn't go");
  assert.equal((await req("POST", "/api/me/again", { kind: "event", ref: "lpMissed", on: true }, ben)).status, 403, "a no-show didn't go");
  assert.equal((await req("POST", "/api/me/again", { kind: "event", ref: "lpA", on: true }, ben)).status, 403, "an upcoming event can't be vouched for yet");
  const a = await post("/api/me/again", { kind: "event", ref: "lpPast", on: true }, ada); assert.equal(a.mine, true); assert.equal(a.line, "You'd go again");
  assert.ok((await post("/api/me/again", { kind: "host", ref: "mo-lists", on: true }, ada)).ok);
  const ev = await get("/api/public/again?kind=event&ref=lpPast", cy); assert.equal(ev.count, 1); assert.equal(ev.line, "1 person would go again"); assert.equal(ev.can, false);
  const h = await get("/api/public/again?kind=host&ref=mo-lists"); assert.equal(h.count, 1, "a host counts each person once"); assert.ok(!JSON.stringify(h).includes("@"));
  assert.equal((await get("/api/public/again?kind=event&ref=lpSecret")).count, 0, "nothing about a private event");
  // on the list item, with the curator's note; Maya's friend Ada? no: names only people the viewer knows
  X().addFriend(E.cy, E.ada); X().bust();
  assert.ok((await post(`/api/me/library/lists/${listId}/note`, { kind: "host", ref: "mo-lists", why: "Order the dumplings, sit at the bar." }, maya)).ok);
  const v = await get("/api/public/lists/" + token, cy), mo = v.items.find((i) => i.kind === "host");
  assert.equal(mo.why, "Order the dumplings, sit at the bar."); assert.equal(mo.again.count, 1); assert.equal(mo.again.line, "Ada would go again", "a name the viewer knows");
});

test("blocks hide lists both ways, and a friend can step out of someone's lists", async () => {
  await post("/api/me/blocks", { kind: "person", key: Buffer.from(E.maya).toString("base64url"), name: "Maya" }, dee);
  assert.equal((await raw(`/api/public/curators/${mayaHandle}`, dee)).status, 404);
  assert.equal((await raw("/api/public/lists/" + token, dee)).status, 404);
  const s = await strangerView(dee); assert.ok(!s.includes("Quiet dinners"), "a blocked person sees the list");
  assert.equal((await post(`/api/me/curators/${mayaHandle}/follow`, {}, dee)).code, "not_found");
  // the other way: Maya blocks Cy, and Cy's follow stops showing anything
  await post("/api/me/blocks", { kind: "person", key: Buffer.from(E.cy).toString("base64url"), name: "Cy" }, maya);
  assert.equal((await listCards(cy)).length, 0); assert.equal((await raw("/api/public/lists/" + token, cy)).status, 404);
  assert.ok(!(await get("/api/public/lists-popular", cy)).lists.length);
  // Ben steps out of Maya's friends lists: her Friends list leaves his feed and his library
  await setShare("friends"); assert.equal((await listCards(ben)).length, 1);
  assert.equal((await post(`/api/me/lists/${token}/step-out`, { on: true }, ben)).steppedOut, true);
  assert.equal((await listCards(ben)).length, 0); assert.ok(!(await get("/api/me/library", ben)).shared.length);
  await post(`/api/me/lists/${token}/step-out`, { on: false }, ben); assert.equal((await listCards(ben)).length, 1);
});

test("the nudge: a Friends list friends opened asks once to go public", async () => {
  await get("/api/public/lists/" + token, ben); // opened by a friend
  const st = await get("/api/me/lists/stats", maya); assert.ok(st.nudge, "a nudge"); assert.match(st.nudge.line, /friends? opened Quiet dinners in Brooklyn\. Make it public\?$/);
  await post("/api/me/lists/nudge", { id: st.nudge.id }, maya); assert.equal((await get("/api/me/lists/stats", maya)).nudge, null, "Not now keeps it gone");
});
