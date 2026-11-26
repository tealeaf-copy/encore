import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore, updateWorkspace } from "../server/workspaces.js";
import { scoreOf, categoryOf, RULES } from "../server/leaderboard.js";

let srv;
const J = { "Content-Type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const put = (path, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const get = async (path, cookie) => { const r = await fetch(srv.base + path, cookie ? { headers: { cookie } } : {}); assert.equal(r.status, 200, path); return r.json(); };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const wsOf = (handle) => srv.store.get("system/handle-" + handle).data.ws;
const fresh = () => { srv.app.locals.social.bust(); srv.app.locals.leaderboard.reset(); };
const C = {};

async function account(email, name) {
  const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" });
  return r.headers.get("set-cookie").split(";")[0];
}
async function host(email, handle, name, extra = {}) {
  const cookie = await account(email, name);
  const p = await post("/api/host/profile", { handle, name, tagline: "Small dinners for new friends.", city: "Brooklyn", emoji: "🍜", ...extra }, cookie);
  assert.ok(p.ok, "profile saved " + handle);
  return cookie;
}
// a past event with guests marked as there
async function event(cookie, id, { date = day(-3), name = "Supper night", activity = "dinner", city = "Brooklyn", guests = [] } = {}) {
  assert.ok((await put("events/" + id, { date, name, activity, city, casual: true, guests: guests.map((g) => ({ email: g, name: g.split("@")[0], status: "Attended" })) }, cookie)).ok);
}
const kudos = (handle, id, eventId, email, extra = {}) => scopeStore(srv.store, wsOf(handle)).set("kudos/" + id, { eventId, name: email.split("@")[0], email, tags: ["again"], love: "Lovely night", at: Date.now() - 1000, ...extra });

before(async () => {
  Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "lb-secret", ENCORE_SIGNUP_PER_HOUR: "200", ENCORE_DIRECTORY_CACHE_MS: "0", ENCORE_LEADERBOARD_CACHE_MS: "0", ENCORE_LEADERBOARD_OBSERVE_MS: "0" }); resetLoginLimits();
  srv = await startServer();
  // Mai: two dinners, six kudos from guests on the guest list
  C.mai = await host("mai.lb@example.com", "mai-lb", "Mai's Table");
  const maiGuests = ["g1", "g2", "g3", "g4", "g5", "g6"].map((g) => g + "@guest.example.com");
  await event(C.mai, "lbMai1", { date: day(-4), guests: maiGuests.slice(0, 3) });
  await event(C.mai, "lbMai2", { date: day(-11), guests: maiGuests.slice(3) });
  maiGuests.forEach((g, i) => kudos("mai-lb", "mk" + i, i < 3 ? "lbMai1" : "lbMai2", g));
  // Tiny: twelve tiny dinners, one guest, no kudos
  C.tiny = await host("tiny.lb@example.com", "tiny-lb", "Tiny Dinners");
  for (let i = 0; i < 12; i++) await event(C.tiny, "lbTiny" + i, { date: day(-1 - i), guests: ["fan@guest.example.com"] });
  // Dee: one dinner, six guests, no kudos (one event behind the top 3)
  C.dee = await host("dee.lb@example.com", "dee-lb", "Dee's Kitchen");
  await event(C.dee, "lbDee1", { date: day(-6), guests: ["d1", "d2", "d3", "d4", "d5", "d6"].map((g) => g + "@guest.example.com") });
  // Cy: one dinner, three guests, one kudos from someone who only replied I'm in
  C.cy = await host("cy.lb@example.com", "cy-lb", "Cy's Supper");
  await event(C.cy, "lbCy1", { date: day(-8), guests: ["c1@guest.example.com", "c2@guest.example.com", "c3@guest.example.com"] });
  kudos("cy-lb", "ck0", "lbCy1", "someone@guest.example.com", { tags: ["food"] });
  // left out: opted out of the leaderboard, left the directory, an example host
  C.out = await host("out.lb@example.com", "out-lb", "Opted Out Suppers", { leaderboard: false });
  C.dir = await host("dir.lb@example.com", "dir-lb", "No Directory Suppers", { directory: false });
  C.ex = await host("ex.lb@example.com", "ex-lb", "Example Suppers");
  updateWorkspace(wsOf("ex-lb"), { ownerEmail: "ex.lb@demo.encore" });
  for (const h of ["out", "dir", "ex"]) { const big = Array.from({ length: 10 }, (_, i) => `${h}${i}@guest.example.com`); await event(C[h], "lb" + h, { date: day(-2), guests: big }); big.forEach((g, i) => kudos(h + "-lb", h + "k" + i, "lb" + h, g)); }
  // Queens: only two hosts, so no board
  C.q1 = await host("q1.lb@example.com", "q1-lb", "Queens One", { city: "Queens" }); await event(C.q1, "lbQ1", { city: "Queens", guests: ["q@guest.example.com"] });
  C.q2 = await host("q2.lb@example.com", "q2-lb", "Queens Two", { city: "Queens" }); await event(C.q2, "lbQ2", { city: "Queens", guests: ["q2@guest.example.com"] });
  fresh();
});
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_DIRECTORY_CACHE_MS", "ENCORE_LEADERBOARD_CACHE_MS", "ENCORE_LEADERBOARD_OBSERVE_MS"]) delete process.env[k]; await srv.close(); });

test("Scoring: verified kudos beat a pile of tiny events, and unverified kudos count nothing", () => {
  const loved = scoreOf({ kudos: Array.from({ length: 4 }, () => ({ verified: "guest_list", tags: ["again"] })), guests: 4, events: 1 });
  const busy = scoreOf({ kudos: [], guests: 1, events: 30 });
  assert.ok(loved.raw > busy.raw, `${loved.raw} > ${busy.raw}`);
  assert.equal(busy.raw, RULES.points.guest + RULES.points.event * RULES.points.eventCap, "the event bonus is capped");
  assert.equal(scoreOf({ kudos: [{ verified: null, tags: ["again"] }], guests: 0, events: 1 }).kudos, 0);
  assert.equal(scoreOf({ kudos: [{ verified: "rsvp" }], events: 0 }).raw, 3 * 0.6);
  assert.equal(scoreOf({ kudos: [{ verified: "guest_list", tags: ["again"] }, { verified: "guest_list", tags: ["again"] }], events: 1 }).againPct, null, "would go again needs 3+ kudos");
  assert.equal(loved.why, "4 kudos · 100% would go again · 4 guests");
  assert.equal(categoryOf({ activity: "dinner" }), "supper"); assert.equal(categoryOf({ name: "Sunrise 5k" }), "movement"); assert.equal(categoryOf({ name: "Holiday market" }), "popup"); assert.equal(categoryOf({ name: "Wheel throwing workshop" }), "workshop");
});

test("API: board shape, order, and who's left off", async () => {
  const j = await get("/api/v1/leaderboard?city=Brooklyn&category=supper&period=month");
  assert.equal(j.data.qualified, true); assert.equal(j.data.city, "Brooklyn"); assert.equal(j.data.category, "supper"); assert.equal(j.data.period, "month");
  const H = j.data.entries.map((e) => e.host.handle);
  assert.deepEqual(H, ["mai-lb", "tiny-lb", "dee-lb", "cy-lb"]);
  for (const h of ["out-lb", "dir-lb", "ex-lb"]) assert.ok(!H.includes(h), h + " is left off");
  const e = j.data.entries[0];
  for (const k of ["rank", "host", "score", "why", "badges", "streak", "movement", "stats"]) assert.ok(k in e, k);
  assert.deepEqual(Object.keys(e.host).slice(0, 4), ["handle", "name", "url", "city"]); assert.equal(e.host.url, srv.base + "/@mai-lb"); assert.equal(e.rank, 1);
  assert.equal(e.why, "6 kudos · 100% would go again · 6 guests"); assert.equal(e.movement.direction, "new");
  assert.ok(!JSON.stringify(j).includes("_ws") && !JSON.stringify(j).includes("@guest.example.com"), "nothing private");
  assert.ok(j.boards.some((b) => b.city === "Brooklyn" && b.category === "supper"));
  const rules = await get("/api/v1/leaderboard/rules"); assert.equal(rules.minHosts, 3); assert.match(rules.formula, /0\.6/);
  const open = await get("/api/v1/openapi.json"); assert.ok(open.paths["/api/v1/leaderboard"] && open.paths["/api/v1/leaderboard/rules"]);
  assert.match(await (await fetch(srv.base + "/llms.txt")).text(), /api\/v1\/leaderboard/);
  assert.equal((await fetch(srv.base + "/leaderboard")).status, 200);
});

test("A board needs 3 hosts", async () => {
  const j = await get("/api/v1/leaderboard?city=Queens");
  assert.equal(j.data.qualified, false); assert.deepEqual(j.data.entries, []); assert.equal(j.data.hosts_on_board, null);
  assert.ok(!j.boards.some((b) => b.city === "Queens"));
  assert.deepEqual((await get("/api/public/host/q1-lb/rank")).ranks, []);
});

test("Public MCP: get_leaderboard", async () => {
  const r = await (await post("/mcp/public", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_leaderboard", arguments: { city: "Brooklyn", category: "supper" } } })).json();
  const d = JSON.parse(r.result.content[0].text);
  assert.equal(d.data.entries[0].host.handle, "mai-lb"); assert.equal(d.data.qualified, true);
});

test("Host page chip and the signed-out card", async () => {
  const r = await get("/api/public/host/mai-lb/rank");
  assert.equal(r.ranks[0].text, "#1 in Brooklyn supper clubs this month"); assert.match(r.ranks[0].url, /^\/leaderboard\?city=Brooklyn&category=supper$/);
  const { card } = await get("/api/public/leaderboard/card");
  assert.equal(card.kind, "leaderboard"); assert.equal(card.title, "This week in Brooklyn"); assert.equal(card.entries.length, 3);
});

test("Feed: one leaderboard card, only when the board qualifies; a moment once per rank change; your own standing", async () => {
  const viewer = await account("viewer.lb@example.com", "Vee Lb");
  assert.ok((await post("/api/public/follow", { handle: "cy-lb" }, viewer)).ok);
  fresh();
  let F = await get("/api/me/feed", viewer);
  assert.equal(F.items.filter((i) => i.kind === "leaderboard").length, 1, "one card");
  const card = F.items.find((i) => i.kind === "leaderboard");
  assert.equal(card.category, "supper"); assert.equal(card.entries[0].host.handle, "mai-lb"); assert.ok(card.entries[0].why);
  assert.equal(F.items.filter((i) => i.kind === "standing").length, 0, "the first look only remembers where everyone is");
  // Cy gets four kudos from guests on the guest list: now #2
  for (let i = 0; i < 4; i++) kudos("cy-lb", "ckv" + i, "lbCy1", ["c1", "c2", "c3", "c1"][i] + "@guest.example.com");
  fresh();
  F = await get("/api/me/feed", viewer); fresh(); F = await get("/api/me/feed", viewer);
  const st = F.items.filter((i) => i.kind === "standing");
  assert.equal(st.length, 1, "emitted once"); assert.equal(st[0].text, "Cy's Supper is now #2 in Brooklyn supper clubs"); assert.equal(st[0].who.handle, "cy-lb");
  assert.equal(srv.app.locals.leaderboard.momentsOf().filter((m) => m.handle === "cy-lb" && m.type === "rank").length, 1);
  assert.equal(F.items.filter((i) => i.kind === "leaderboard").length, 1);
  // Dee is #4, one event behind #3 by the formula
  const D = await get("/api/me/feed", C.dee), me = D.items.find((i) => i.kind === "you-rank");
  assert.equal(me.text, "You're #4 in Brooklyn supper clubs. One more event this month could put you in the top 3.");
  const M = (await get("/api/me/feed", C.mai)).items.find((i) => i.kind === "you-rank"); assert.equal(M.text, "You're #1 in Brooklyn supper clubs this month.");
  // a viewer in Queens (only two hosts) gets no card
  const qv = await host("qv.lb@example.com", "qv-lb", "Queens Viewer", { city: "Queens" });
  assert.equal((await get("/api/me/feed", qv)).items.filter((i) => i.kind === "leaderboard").length, 0);
});

// ---- review round 6: cold start ----
test("Cold start: every city with a host is in the picker; under 3 hosts a Rising list with no ranks or scores", async () => {
  const j = await get("/api/v1/leaderboard?city=Queens");
  assert.equal(j.data.qualified, false); assert.ok(j.cities.some((c) => c.city === "Queens" && c.hosts >= 2), JSON.stringify(j.cities));
  const R = j.data.rising.map((h) => h.handle); assert.ok(R.includes("q1-lb") && R.includes("q2-lb"), JSON.stringify(R));
  for (const h of j.data.rising) { assert.equal(h.rank, undefined); assert.equal(h.score, undefined); assert.equal(h.why, undefined); assert.match(h.url, /\/@q[12]-lb$/); }
});

test("Cold start: when this month doesn't qualify, All time does (unless the period was asked for)", async () => {
  const old = day(-45);
  for (const [k, n] of [["a1", "Austin One"], ["a2", "Austin Two"], ["a3", "Austin Three"]]) { const c = await host(`${k}.lb@example.com`, k + "-lb", n, { city: "Austin" }); await event(c, "lbAus" + k, { city: "Austin", date: old, guests: [`${k}g@guest.example.com`, `${k}h@guest.example.com`] }); }
  fresh();
  const j = await get("/api/v1/leaderboard?city=Austin");
  assert.equal(j.data.qualified, true); assert.equal(j.data.period, "all"); assert.equal(j.data.fell_back, "all"); assert.equal(j.data.entries.length, 3);
  const m = await get("/api/v1/leaderboard?city=Austin&period=month");
  assert.equal(m.data.qualified, false); assert.equal(m.data.fell_back, null); assert.equal(m.data.rising.length, 3, "hosted in the last 90 days: rising, with no ranks");
  // the directory's host record carries the best current board (all time here)
  const r = await fetch(srv.base + "/api/v1/hosts/a1-lb"); if (r.ok) { const d = (await r.json()).data; assert.equal(d.leaderboard?.period, "all"); assert.match(d.leaderboard.text, /all time$/); }
  const page = await (await fetch(srv.base + "/leaderboard")).text(); assert.match(page, /Rising in/); assert.match(page, /Not enough hosts this month yet, so this is All time/);
});
