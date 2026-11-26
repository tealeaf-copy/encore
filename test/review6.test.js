// Review round 6: brand requests for hosts with no package, agent search (dates in words, talks, socials, prices),
// host records for agents and find_hosts, series prices, guest import, canvas effects and mobile polish.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore } from "../server/workspaces.js";
import { priceOf, formatOf, datePhrase, dateRange, queryWords, PUBLIC_TOOLS } from "../server/directory.js";

let srv;
const J = { "Content-Type": "application/json" };
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const put = (path, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const get = async (path) => { const r = await fetch(srv.base + path); assert.equal(r.status, 200, path); return r.json(); };
const mcp = async (name, args) => { const r = await (await post("/mcp/public", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })).json(); return JSON.parse(r.result.content[0].text); };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const wsOf = (handle) => srv.store.get("system/handle-" + handle).data.ws;
async function host(email, handle, name, extra = {}) {
  const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); const cookie = r.headers.get("set-cookie").split(";")[0];
  const p = await post("/api/host/profile", { handle, name, tagline: "Small dinners for new friends.", city: "Brooklyn", hood: "Bed-Stuy", emoji: "🍜", ...extra }, cookie); assert.ok(p.ok, await p.text());
  return cookie;
}
const PKG = { name: "Team supper", desc: "A long table supper for your team, cooked in front of you.", category: "dining", min: 8, max: 20, price: "$90 a person" };

before(async () => {
  Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "r6-secret", ENCORE_SIGNUP_PER_HOUR: "100", ENCORE_DIRECTORY_CACHE_MS: "0", ENCORE_LEADERBOARD_CACHE_MS: "0" }); resetLoginLimits();
  srv = await startServer();
  // a host with a priced package, a host open to brand work with no package, and one with neither
  const a = await host("pia.r6@example.com", "pia-r6", "Pia's Long Table", { forHire: true, experiences: [PKG] });
  await host("ren.r6@example.com", "ren-r6", "Ren Runs Brooklyn", { forHire: true, services: "Run club activations and group runs for 10 to 60" });
  await host("sol.r6@example.com", "sol-r6", "Sol's Suppers", { services: "Supper clubs" });
  // events: one with no price at all, a free one, a bachata social, and a pottery class this weekend
  const W = dateRange("this weekend", "America/New_York"), up = { startTime: "19:00", city: "Brooklyn", hood: "Bed-Stuy", discoverable: true };
  assert.ok((await put("events/r6NoPrice", { ...up, date: day(25), name: "Dumpling supper", activity: "dinner" }, a)).ok);
  assert.ok((await put("events/r6Free", { ...up, date: day(26), name: "Park run", activity: "run", free: true }, a)).ok);
  assert.ok((await put("events/r6Social", { ...up, date: day(27), name: "Bachata social", activity: "workshop", price: "$10" }, a)).ok);
  assert.ok((await put("events/r6Weekend", { ...up, date: W.to, name: "Pottery class", activity: "workshop", price: "$45" }, a)).ok);
  assert.ok((await put("events/r6Later", { ...up, date: day(40), name: "Pottery class again", activity: "workshop", price: "$45" }, a)).ok);
  assert.ok((await put("events/r6Course", { ...up, date: day(30), name: "Wheel course", activity: "workshop", sessions: 6, price: "$20", passPrice: 100, passCount: 6 }, a)).ok);
  // a talk from Pia's scrapbook (past)
  assert.ok((await post("/api/host/scrapbook/import", { item: { title: "Hosting for strangers", date: "2025-05-02", format: "Keynote", role: "Keynote speaker", topic: "Why small dinners beat big parties", organizer: "Hosts Summit 2025" } }, a)).ok);
  // a brand request Pia answered after 2 hours
  scopeStore(srv.store, wsOf("pia-r6")).set("inquiries/q1", { id: "q1", at: Date.now() - 10 * 3600e3, history: [{ by: "host", at: Date.now() - 8 * 3600e3, what: "sent a quote" }] });
});
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_DIRECTORY_CACHE_MS", "ENCORE_LEADERBOARD_CACHE_MS"]) delete process.env[k]; await srv.close(); });

// ---------- 1 ----------
test("/hosts/book: hosts open to brand work with no package are Request a date cards, after hosts with a price", async () => {
  const j = await get("/api/public/hosts/book");
  const pia = j.hosts.findIndex((h) => h.handle === "pia-r6"), ren = j.hosts.findIndex((h) => h.handle === "ren-r6");
  assert.ok(pia >= 0 && ren > pia, JSON.stringify(j.hosts.map((h) => h.handle)));
  const R = j.hosts[ren]; assert.equal(R.request, true); assert.equal(R.options.length, 1); assert.equal(R.options[0].price, "Quoted on request"); assert.equal(R.options[0].request, true); assert.equal(R.example, false);
  assert.ok(j.hosts.every((h, i) => !h.request || j.hosts.slice(i).every((x) => x.request)), "every priced host comes first");
  assert.ok(!j.hosts.some((h) => h.handle === "sol-r6"), "not open to brand work: not listed");
  assert.ok(j.examples.every((h) => h.example), "examples stay labeled, in their own list");
  // the card says it, and the request goes to the host's inbox
  const page = read("public/hosts.html"); assert.match(page, /Quoted on request/); assert.match(page, /\/api\/public\/inquiry\//);
  assert.ok((await post("/api/public/inquiry/ren-r6", { email: "jo@brand.example.com", message: "A launch run for 40 people in March." })).ok);
  // the host app: a Potto to-do to add one package
  assert.match(read("index.html"), /Add one package so brands see a price/);
});

// ---------- 2 ----------
test("Agent search: talks look at all dates, date words become dates, socials aren't classes, no price isn't Free", async () => {
  const talks = await get("/api/v1/events?type=speaking&host=pia-r6"); assert.ok(talks.data.some((e) => e.speaking), "past talks without status=all");
  assert.ok((await get("/api/v1/events?format=keynote&host=pia-r6")).total >= 1);
  assert.equal((await get("/api/v1/events?type=speaking&host=pia-r6&status=upcoming")).total, 0, "status still wins when given");
  assert.deepEqual(datePhrase("pottery this weekend"), { phrase: "this weekend", rest: "pottery" }); assert.deepEqual(queryWords(datePhrase("dance next weekend").rest), ["dance"]);
  // Wed Nov 25 2026 at 10:00 in New York: this weekend is Fri 27 to Sun 29, next weekend Dec 4 to 6, this week to Sun 29
  const t = Date.parse("2026-11-25T15:00:00Z");
  assert.deepEqual(dateRange("tonight", "America/New_York", t), { from: "2026-11-25", to: "2026-11-25" });
  assert.deepEqual(dateRange("tomorrow", "America/New_York", t), { from: "2026-11-26", to: "2026-11-26" });
  assert.deepEqual(dateRange("this weekend", "America/New_York", t), { from: "2026-11-27", to: "2026-11-29" });
  assert.deepEqual(dateRange("next weekend", "America/New_York", t), { from: "2026-12-04", to: "2026-12-06" });
  assert.deepEqual(dateRange("this week", "America/New_York", t), { from: "2026-11-25", to: "2026-11-29" });
  // late on Wednesday in Los Angeles is already Thursday in Sydney: each city's own today
  const late = Date.parse("2026-11-26T05:00:00Z");
  assert.equal(dateRange("tonight", "America/Los_Angeles", late).from, "2026-11-25"); assert.equal(dateRange("tonight", "Australia/Sydney", late).from, "2026-11-26");
  const wk = await get("/api/v1/events?q=pottery+this+weekend&host=pia-r6"); assert.deepEqual(wk.data.map((e) => e.id), ["r6Weekend"]);
  assert.equal(formatOf({ title: "Bachata social" }), "social"); assert.equal(formatOf({ title: "Salsa party" }), "party"); assert.equal(formatOf({ title: "Founders mixer" }), "social");
  assert.equal(formatOf({ title: "Bachata class" }), "class"); assert.equal(formatOf({ title: "Dinner party", activity: "dinner" }), "dinner");
  assert.equal((await get("/api/v1/events/r6Social")).data.format, "social");
  assert.equal(priceOf({}), null); assert.equal(priceOf({ price: "" }), null); assert.equal(priceOf({ free: true }), "Free"); assert.equal(priceOf({ price: "$0" }), "Free");
  assert.equal((await get("/api/v1/events/r6NoPrice")).data.price, null); assert.equal((await get("/api/v1/events/r6Free")).data.price, "Free");
  const html = await (await fetch(srv.base + "/events")).text(), ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1].replace(/\\u003c/g, "<"));
  const np = ld.find((e) => e.name === "Dumpling supper"), fr = ld.find((e) => e.name === "Park run");
  assert.ok(np && !("isAccessibleForFree" in np) && !np.offers, "no price: no Free claim"); assert.equal(fr.isAccessibleForFree, true);
  const tool = PUBLIC_TOOLS.find((x) => x.name === "search_events"); assert.match(tool.description, /this weekend/); assert.match(tool.description, /status all/);
  assert.match(await (await fetch(srv.base + "/llms.txt")).text(), /next weekend/);
});

// ---------- 3 ----------
test("Host records for agents, and find_hosts", async () => {
  const h = (await get("/api/v1/hosts/pia-r6")).data;
  assert.equal(h.for_hire, true); assert.deepEqual(h.group_size, { min: 8, max: 20 }); assert.equal(h.responds_in, "within 2 hours"); assert.equal(h.responds_in_hours, 2);
  assert.deepEqual(h.speaking_topics, ["Why small dinners beat big parties"]); assert.equal(h.leaderboard, null);
  const f = await mcp("find_hosts", { city: "Brooklyn", category: "dining", group_size: 12, budget: 1500 });
  assert.equal(f.data[0]?.host.handle, "pia-r6", JSON.stringify(f.data.map((x) => x.host.handle))); assert.equal(f.data[0].packages[0].estimate, 1080); assert.equal(f.data[0].packages[0].within_budget, true);
  assert.equal((await mcp("find_hosts", { city: "Brooklyn", category: "dining", group_size: 12, budget: 500 })).data.some((x) => x.host.handle === "pia-r6"), false, "over budget");
  assert.equal((await mcp("find_hosts", { city: "Brooklyn", category: "dining", group_size: 40 })).data.some((x) => x.host.handle === "pia-r6"), false, "too big a group");
  const all = await get("/api/v1/hosts/find?city=Brooklyn"); const ren = all.data.find((x) => x.host.handle === "ren-r6");
  assert.ok(ren?.quoted_on_request, "no package: quoted on request"); assert.ok(!all.data.some((x) => x.host.handle === "sol-r6"), "only hosts open to paid work");
  const open = await get("/api/v1/openapi.json"); assert.ok(open.paths["/api/v1/hosts/find"]); assert.ok(open.components.schemas.Host.properties.responds_in);
  assert.match(await (await fetch(srv.base + "/llms.txt")).text(), /find_hosts/);
});

// ---------- 10 ----------
test("Series prices: a pass with sessions is the bundle; a drop-in shows with the course price", async () => {
  assert.equal((await get("/api/v1/events/r6Course")).data.price, "$20 a class, or $100 for all 6");
  assert.equal(priceOf({ price: "$20", sessions: 6, passPrice: 70, passCount: 4 }), "$20 a class, or $70 for 4");
  assert.equal(priceOf({ price: "$320", sessions: 8, dropIn: 45 }), "$320 for all 8, or $45 a class");
  assert.equal(priceOf({ price: "$45", sessions: 8, priceUnit: "class" }), "$45 a class");
  // invite.html says the same words
  const src = read("public/invite.html"), a = src.indexOf("  const srPrice = "), b = src.indexOf("\n", src.indexOf("return \"\"; };", a));
  const ctx = {}; vm.createContext(ctx); vm.runInContext(src.slice(a, b + 1) + "\nthis.srPrice=srPrice;", ctx);
  assert.equal(ctx.srPrice({ price: "$20", sessions: 6, passPrice: 100, passCount: 6 }), "$20 a class, or $100 for all 6");
  assert.equal(ctx.srPrice({ price: "$320", sessions: 8, dropIn: 45 }), "$320 for all 8, or $45 a class");
  assert.equal(ctx.srPrice({ price: "$45", sessions: 8, priceUnit: "class" }), "$45 a class");
});

// ---------- 5 ----------
test("Guest import: a header only when line 1 is header words; Name <email>, bare emails and phones with +, spaces, () and -", () => {
  const html = read("index.html"), a = html.indexOf("function parseGuestList("), b = html.indexOf("function csvOf(", a);
  const ctx = {}; vm.createContext(ctx); vm.runInContext(html.slice(a, b) + "\nthis.parse=parseGuestList;", ctx); const P = (t) => JSON.parse(JSON.stringify(ctx.parse(t)));
  assert.deepEqual(P("Ana Diaz <ana@example.com>\nbo@example.com\n+1 (415) 555-0102 Cy"), [
    { name: "Ana Diaz", email: "ana@example.com", phone: "", status: "" },
    { name: "bo", email: "bo@example.com", phone: "", status: "" },
    { name: "Cy", email: "", phone: "+14155550102", status: "" }]);
  // a first line that's a guest is a guest, even one whose name starts like a header word
  assert.equal(P("Nameera Khan, nameera@example.com\nBo Chen, bo@example.com").length, 2);
  assert.equal(P("email@example.com\nbo@example.com").length, 2);
  // a real header still maps columns
  assert.deepEqual(P("First name,Last name,Email,Phone\nAna,Diaz,ana@example.com,415-555-0101")[0], { name: "Ana Diaz", email: "ana@example.com", phone: "4155550101", status: "" });
  assert.deepEqual(P("Name\tEmail\nAna Diaz\tAna Diaz <ana@example.com>")[0], { name: "Ana Diaz", email: "ana@example.com", phone: "", status: "" });
});

// ---------- 6 ----------
test("Canvas effects: sprites instead of shadowBlur per particle, 30fps, count by viewport area, paused off screen", () => {
  const src = read("public/looks.js"), draw = src.slice(src.indexOf("const draw = (k)"), src.indexOf("const loop = (now)"));
  assert.ok(!/shadowBlur/.test(draw), "no shadowBlur in the frame loop"); assert.match(draw, /stamp\(/);
  assert.match(src, /pointer: coarse/); assert.match(src, /visibilitychange/); assert.match(src, /io\.observe\(fixed \? host : layer\)/);
  const window = { devicePixelRatio: 1 }; vm.runInNewContext(src, { window, console, document: undefined, localStorage: {} }); const L = window.EncoreLooks;
  assert.equal(L.countFor("snow", 1280, 800), 30); assert.equal(L.countFor("snow", 1920, 1080), 30, "never over 30");
  assert.equal(L.countFor("snow", 390, 844), 10); assert.equal(L.countFor("petals", 390, 844), 8, "never under 8");
});

// ---------- 9 ----------
test("Mobile polish: one h1 on /signup, no Meetup on /events, New event reads New under 400px, host codes inline", async () => {
  assert.equal((read("public/signup.html").match(/<h1\b/g) || []).length, 1);
  const ev = read("public/events.html"); assert.match(ev, /meetup: "Community"/);
  const ix = read("index.html"); assert.match(ix, /nl-short" aria-hidden="true">New</); assert.match(ix, /setAttribute\("aria-label","New event"\)/);
  assert.ok(!/pipToast\(`You hosted\./.test(ix), "the host-codes note is inline, not a toast over the to-do card"); assert.match(ix, /inv-earned/);
});
