// Review round 10: I paid on /g for signed-out guests, the Discover nudge (link only or on your page, and a page that
// isn't ready), the owner's own paid events, pre-order share notes, shop slots and whole quantities, MCP value checks,
// help and copy fixes, and picks from before signup carried into the account.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore } from "../server/workspaces.js";
import { offlineAnswer } from "../server/help.js";
import { mcpArgsError, realDate, leaderboardCategory } from "../server/directory.js";

let srv, ready, bare, wsReady, wsBare;
const J = { "Content-Type": "application/json" };
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const post = (path, body, h = {}) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...h }, body: JSON.stringify(body) });
const get = async (path, cookie) => (await fetch(srv.base + path, { headers: cookie ? { cookie } : {} })).json();
const put = (id, d, cookie) => fetch(srv.base + "/api/db/doc?path=events/" + id, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(d) });
const rpc = async (name, args) => (await post("/mcp/public", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })).json();
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "r10-secret", ENCORE_FAKE_EMAIL: "1", ENCORE_SIGNUP_PER_HOUR: "100", ENCORE_DIRECTORY_CACHE_MS: "0" };

async function signup(name, email, profile) {
  const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200, "signup " + email);
  const c = r.headers.get("set-cookie").split(";")[0];
  if (profile) assert.ok((await post("/api/host/profile", { name, city: "Brooklyn", ...profile }, { cookie: c })).ok);
  return c;
}

before(async () => {
  Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer();
  ready = await signup("Priya Shah", "priya.r10@example.com", { handle: "crumb-r10", emoji: "🍞", tagline: "Small things for new friends." });
  bare = await signup("Theo Park", "theo.r10@example.com", { handle: "theo-r10" });
  wsReady = srv.store.get("system/handle-crumb-r10").data.ws; wsBare = srv.store.get("system/handle-theo-r10").data.ws;
});
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

test("/g: I paid goes to the event's own workspace, never \"default\"; no throw when there's no reply box", () => {
  const app = read("index.html");
  assert.match(app, /let ws=e\.workspace\|\|""; if\(!ws\)\{ const d=await \(await fetch\("\/api\/db\/doc\?path="\+encodeURIComponent\("events\/"\+e\.id\)/);
  assert.match(app, /if\(!ws&&window\.__encoreWs&&window\.__encoreWs!=="default"\) ws=window\.__encoreWs;/);
  assert.doesNotMatch(app, /let ws=window\.__encoreWs\|\|""/);
  assert.doesNotMatch(app, /\(e\.stage==="interest"&&\$\("#g-name",host\)\)\)\?\.closest/, "false?.closest() throws");
  assert.match(app, /e\.stage==="interest"\?\$\("#g-name",host\):null/);
});

test("Discover nudge: link only or on your page, and whether the page is ready for Discover", async () => {
  assert.ok((await put("r10Link", { kind: "social", casual: true, name: "Bread swap", date: day(6), city: "Brooklyn", published: true, discoverable: false }, ready)).ok);
  let N = (await get("/api/host/nudges", ready)).discover;
  assert.equal(N.eventId, "r10Link"); assert.equal(N.unlisted, true, "link only"); assert.equal(N.pageReady, true); assert.deepEqual(N.gaps, []);
  await post("/api/host/nudges/discover", { eventId: "r10Link", show: false }, { cookie: ready });
  assert.ok((await put("r10Page", { kind: "social", casual: true, name: "Focaccia night", date: day(7), city: "Brooklyn", published: true, discoverable: true, unlisted: true }, ready)).ok);
  N = (await get("/api/host/nudges", ready)).discover; assert.equal(N.eventId, "r10Page"); assert.equal(N.unlisted, false, "on the page already");
  // a page with no line about you and no face: Show it on Discover would change nothing anyone sees, so say what's missing
  assert.ok((await put("r10Bare", { kind: "social", casual: true, name: "Board games", date: day(6), city: "Brooklyn", published: true, discoverable: false }, bare)).ok);
  N = (await get("/api/host/nudges", bare)).discover; assert.equal(N.pageReady, false);
  assert.ok(N.gaps.includes("a line about you") && N.gaps.includes("a face or photo"), JSON.stringify(N.gaps)); assert.equal(N.handle, "theo-r10");
  const js = read("public/nudges.js");
  assert.match(js, /is link only/); assert.doesNotMatch(js, /is Link only/); assert.match(js, /is on your page/);
  assert.match(js, /Followers see it\. Put it on Discover so people nearby find it too\./);
  assert.match(js, /so it shows on Discover/); assert.match(js, /Finish your page/); assert.match(js, /\?customize=1/);
  assert.match(js, /if \(!N\?\.discover\) \{ put\(DONE\); return; \}/, "the done state stays when Home redraws");
  assert.doesNotMatch(js, /—/);
});

test("the owner sees their own private paid events with the price; strangers don't see them; drafts say Draft", async () => {
  assert.ok((await put("r10Paid", { kind: "social", casual: true, name: "Pasta class", date: day(9), city: "Brooklyn", published: true, discoverable: false, price: "$25", headcount: 8 }, ready)).ok);
  const mine = await get("/api/public/host/crumb-r10", ready), e = mine.upcoming.find((x) => x.id === "r10Paid");
  assert.ok(e, "the owner sees it"); assert.equal(e.price, "$25"); assert.equal(e.headcount, 8); assert.equal(e.private, true);
  const theirs = await get("/api/public/host/crumb-r10"); assert.ok(!theirs.upcoming.some((x) => x.id === "r10Paid" || x.price === "$25"));
  const host = read("public/host.html");
  assert.match(host, /price: e\.price, free: e\.free, costNote: e\.costNote, groupPrice: e\.groupPrice/);
  assert.match(host, /!e\.published && !e\.discoverable \? "Draft"/);
});

test("share note: a pre-order keeps Guests order for pickup; others say the word list's I'm in", () => {
  const app = read("index.html");
  assert.match(app, /if\(n&&d&&!d\.approvalRequired&&!d\.preorder&&LK\)\{[^}]*n\.textContent=`Guests tap \$\{d\.rsvpWords\?\.yes\|\|"I'm in"\}\.`/);
  assert.doesNotMatch(app, /LK\.buttonText\(d,d\.rsvpWords\?\.yes\|\|"I'm in"\), word=/);
  assert.match(app, /const fc=ta\.closest\("label"\)\?\.firstChild; if\(fc\?\.nodeType===3\)/, "drawHostKit: no null firstChild");
  assert.match(read("public/invite-order.js"), /id="oPaid"\$\{tapped \? "" : " hidden"\}>I paid<\/button>/);
  assert.match(read("public/invite-order.js"), /paidClaim: true/);
});

test("shop orders: slots stored and emailed as 10am to 11am; quantities are whole numbers", async () => {
  const r = await (await post("/api/host/profile", { shop: { open: true, title: "Loaves", where: "Bed-Stuy", slots: ["10:00–11:00"], items: [{ name: "Country loaf", cents: 1200, stock: 0, max: 6 }] } }, { cookie: ready })).json();
  const id = r.host.shop.items[0].id;
  let o = await post("/api/public/order/crumb-r10", { name: "Ben Ito", email: "ben.r10@example.com", slot: "10:00–11:00", items: [{ id, qty: 2.6 }] });
  assert.equal(o.status, 400); assert.equal((await o.json()).code, "invalid_order");
  o = await post("/api/public/order/crumb-r10", { name: "Ben Ito", email: "ben.r10@example.com", slot: "10:00–11:00", items: [{ id, qty: 2 }] });
  assert.equal(o.status, 200); const j = await o.json(); assert.equal(j.slot, "10am to 11am"); assert.equal(j.total, "$24");
  const saved = scopeStore(srv.store, wsReady).list("orders").map((d) => d.data).find((x) => x.code === j.code); assert.equal(saved.slot, "10am to 11am");
  assert.match(read("server/shop.js"), /Pickup: \$\{o\.slot\}/);
});

test("MCP: bad values are JSON-RPC -32602, not accepted or a crash", async () => {
  const cases = [["search_events", { from: "tomorrow" }], ["search_events", { to: "2026-02-30" }], ["search_events", { limit: -3 }], ["search_events", { limit: 2.5 }],
    ["search_events", { city: { a: 1 } }], ["list_hosts", { city: ["x"] }], ["search_events", { include_examples: "yes" }], ["find_hosts", { date: "2026-02-31" }],
    ["find_hosts", { category: "__proto__" }], ["get_leaderboard", { category: "__proto__" }], ["get_leaderboard", { period: "week" }], ["search_events", { status: "soon" }],
    ["get_reviews", { limit: "abc" }], ["get_event", { id: { x: 1 } }], ["find_hosts", { verified_only: "maybe" }]];
  for (const [name, args] of cases) { const j = await rpc(name, args); assert.equal(j.error?.code, -32602, name + " " + JSON.stringify(args) + " " + JSON.stringify(j).slice(0, 160)); }
  for (const [name, args] of [["search_events", { from: day(1), limit: 5 }], ["find_hosts", { include_examples: "false" }], ["get_leaderboard", { category: "dining", period: "all" }], ["list_hosts", { limit: "10" }]]) {
    const j = await rpc(name, args); assert.ok(j.result && !j.result.isError, name + " " + JSON.stringify(j).slice(0, 160)); }
  assert.equal(leaderboardCategory("__proto__"), ""); assert.equal(realDate("2026-02-29"), false); assert.equal(realDate("2028-02-29"), true);
  assert.equal(mcpArgsError({ city: { type: "string" } }, { city: "Austin" }), "");
});

test("help and copy: the host-code answer keeps Your turn?, no italics, the code hint hides, Visitor, the composer clears", () => {
  const a = offlineAnswer("I don't have a host code. How do I get one?");
  assert.match(a.answer, /Been a guest at an event here\? Tap Your turn\? on that invite\./); assert.match(a.answer, /No code\?/);
  const app = read("index.html");
  assert.match(app, /\.pp-why\{font-family:inherit;font-style:normal;/); assert.doesNotMatch(app, /\.pp-why\{[^}]*italic/);
  assert.match(read("public/signup.html"), /hint\(!j\.valid\)/);
  assert.doesNotMatch(read("server/social.js"), /were in early once/); assert.match(read("server/social.js"), /among the first in at one event/);
  assert.match(read("server/help.js"), /m\.role==="potto"\?"Potto":\(t\.signedIn\?"Host":"Visitor"\)/);
  assert.match(app, /localStorage\.removeItem\(typeof CG_DRAFT==="string"\?CG_DRAFT:"encore\.cgDraft"\)/); assert.doesNotMatch(app, /removeItem\("encore-cg-draft"\)/);
});

test("picks from before signup come into the new account; Your turn? fills the event's city", async () => {
  const c = await signup("Nia Guest", "nia.r10@example.com");
  assert.deepEqual((await get("/api/me/interests", c)).interests, [], "a new account starts empty");
  // what signup.html and save.js send from pl.interests
  assert.ok((await fetch(srv.base + "/api/me/interests", { method: "PUT", headers: { ...J, cookie: c }, body: JSON.stringify({ interests: ["supper", "run"], city: "Austin" }) })).ok);
  const I = await get("/api/me/interests", c); assert.deepEqual(I.interests, ["supper", "run"]); assert.equal(I.city, "Austin");
  const su = read("public/signup.html"), sv = read("public/save.js");
  assert.match(su, /localStorage\.getItem\("pl\.interests"\)[\s\S]*fetch\("\/api\/me\/interests", \{ method: "PUT"/);
  assert.match(su, /d\?\.data\?\.city/); assert.match(sv, /async function carryInterests\(\)/); assert.match(sv, /carryInterests\(\); return merge\(\);/);
});
