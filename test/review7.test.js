// Review round 7: a public feed that follows what new visitors picked, "Show it on Discover" on Home, a signup that
// remembers, brand screens that read right, find_hosts for agents, uploads checked by their bytes, reaction limits,
// saves that keep only our pictures, the help button out of the way, and polish.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore } from "../server/workspaces.js";
import { weekendOf, localDay } from "../server/hooks.js";
import { trustFrom } from "../server/recognition.js";
import { priceText } from "../server/search.js";
import { sniffType, sniffedAs } from "../server/feedvisual.js";
import { CATEGORY_WORDS, closestArg } from "../server/directory.js";

let srv;
const J = { "Content-Type": "application/json" };
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const req = (method, path, body, cookie) => fetch(srv.base + path, { method, headers: { ...J, ...(cookie ? { cookie } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const post = (path, body, cookie) => req("POST", path, body, cookie);
const put = (path, body, cookie) => req("PUT", "/api/db/doc?path=" + path, body, cookie);
const get = async (path, cookie) => { const r = await fetch(srv.base + path, { headers: cookie ? { cookie } : {} }); assert.equal(r.status, 200, path + " " + r.status); return r.json(); };
const rpc = async (name, args) => (await post("/mcp/public", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })).json();
const mcp = async (name, args) => { const r = await rpc(name, args); assert.ok(r.result, JSON.stringify(r)); return JSON.parse(r.result.content[0].text); };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const wsOf = (handle) => srv.store.get("system/handle-" + handle).data.ws;
const H = () => srv.app.locals.hooks, X = () => srv.app.locals.social;
async function account(name, email) { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200, "signup " + email); return r.headers.get("set-cookie").split(";")[0]; }
async function host(email, handle, name, extra = {}) { const c = await account(name, email);
  const p = await post("/api/host/profile", { handle, name, tagline: "Small things for new friends.", emoji: "🍜", city: "Brooklyn", hood: "Bed-Stuy", ...extra }, c); assert.ok(p.ok, "profile " + handle + " " + (await p.clone().text())); return c; }

let runC, supC, aiC, chefC;
before(async () => {
  Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "r7-secret", ENCORE_SIGNUP_PER_HOUR: "200", ENCORE_DIRECTORY_CACHE_MS: "0", ENCORE_LEADERBOARD_CACHE_MS: "0", ENCORE_FAKE_EMAIL: "1" }); resetLoginLimits();
  srv = await startServer();
  runC = await host("rae.r7@example.com", "rae-r7", "Rae's Run Club", { tagline: "A no-drop 5K and coffee after." });
  supC = await host("sol.r7@example.com", "sol-r7", "Sol's Supper Club", { city: "Austin", hood: "East Austin", tagline: "Dumplings for twelve." });
  // a B2B host whose tagline says "dinner" but who doesn't host suppers
  aiC = await host("ada.r7@example.com", "ada-r7", "Agent Ops Lab", { tagline: "Dinner-table talk about AI agents for sales teams.", forHire: true, services: "AI agent workshops for B2B sales teams" });
  chefC = await host("kai.r7@example.com", "kai-r7", "Kai Cooks", { forHire: true, services: "Chef's table dinners for teams, 8 to 20", experiences: [{ name: "Team tasting", desc: "Six courses at one long table.", min: 8, max: 20, price: "95" }] });
  const up = { startTime: "19:00", discoverable: true, headcount: 12 };
  assert.ok((await put("events/r7Run", { ...up, city: "Brooklyn", hood: "Bed-Stuy", date: day(20), name: "Prospect Park 5k", activity: "run" }, runC)).ok);
  assert.ok((await put("events/r7Sup", { ...up, city: "Austin", hood: "East Austin", date: day(21), name: "Dumpling supper", activity: "dinner" }, supC)).ok);
  assert.ok((await put("events/r7RunPast", { ...up, city: "Brooklyn", hood: "Bed-Stuy", date: day(-3), name: "Bagel run", activity: "run" }, runC)).ok);
});
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_DIRECTORY_CACHE_MS", "ENCORE_LEADERBOARD_CACHE_MS", "ENCORE_FAKE_EMAIL", "ENCORE_REACTS_PER_IP", "MOMENT_UNREAD_VIDEO_MB"]) delete process.env[k]; await srv.close(); });

// ---------- 1 ----------
test("Public feed: what a visitor picked comes first, old prepared things become ideas", async () => {
  const runFirst = await get("/api/public/feed?interests=run&city=Brooklyn"), supFirst = await get("/api/public/feed?interests=supper&city=Austin");
  const at = (F, id) => F.upcoming.findIndex((e) => e.id === id);
  assert.ok(at(runFirst, "r7Run") >= 0 && at(runFirst, "r7Run") < at(runFirst, "r7Sup"), "runs in Brooklyn lead for a runner");
  assert.ok(at(supFirst, "r7Sup") < at(supFirst, "r7Run"), "suppers in Austin lead for a supper person");
  assert.deepEqual(runFirst.picked, { interests: ["run"], city: "Brooklyn" });
  // prepared pages: nothing older than 14 days on the wall; older things are labelled ideas below it
  const cut = Date.now() - 14 * 864e5;
  for (const P of runFirst.showcase) for (const p of P.past) assert.ok(p.date && Date.parse(p.date) >= cut, `${p.title} (${p.date}) is old`);
  assert.ok(runFirst.ideas.length > 0, "old prepared events show as ideas"); for (const x of runFirst.ideas) { assert.equal(x.example, true); assert.ok(x.title && x.page); }
  // the browser sends what was picked
  const fv = read("public/feedvisual.js"), feed = read("public/feed.html");
  assert.match(fv, /localStorage\.getItem\("pl\.interests"\)/); assert.match(fv, /More ideas to steal/); assert.match(feed, /V\.publicQuery\(\)/); assert.match(feed, /pl:interests-saved/);
});

test("Your scene: hosts must really do what you picked, the same city first", async () => {
  const S = await get("/api/public/suggest/hosts?interests=supper&city=Austin");
  assert.ok(!S.hosts.some((h) => h.handle === "ada-r7"), "a B2B AI host isn't a supper club because its tagline says dinner");
  assert.equal(S.hosts[0].handle, "sol-r7"); assert.ok(S.hosts.filter((h) => !h.example).every((h) => /Supper clubs/.test(h.why)), JSON.stringify(S.hosts.map((h) => [h.handle, h.why])));
  for (const h of S.hosts) if (h.example) assert.ok(h.why, "an example still matches");
  const R = await get("/api/public/suggest/hosts?interests=run&city=Brooklyn"); assert.ok(!R.hosts.some((h) => ["ada-r7", "kai-r7", "sol-r7"].includes(h.handle)), "same city alone isn't a match");
});

// ---------- 2 ----------
test("Home: a shared Link only event gets one Show it on Discover nudge", async () => {
  assert.ok((await put("events/r7Wheel", { startTime: "18:00", city: "Brooklyn", hood: "Bed-Stuy", date: day(15), name: "Wheel-throwing night", published: true, discoverable: false }, runC)).ok);
  assert.equal((await fetch(srv.base + "/api/host/nudges")).status, 401);
  const N = await get("/api/host/nudges", runC); assert.equal(N.discover.eventId, "r7Wheel"); assert.equal(N.discover.title, "Wheel-throwing night");
  assert.equal((await post("/api/host/nudges/discover", { eventId: "r7Wheel", show: true }, supC)).status, 404, "only the host's own event");
  const r = await (await post("/api/host/nudges/discover", { eventId: "r7Wheel", show: true }, runC)).json(); assert.equal(r.discoverable, true);
  const ev = scopeStore(srv.store, wsOf("rae-r7")).get("events/r7Wheel").data; assert.equal(ev.discoverable, true); assert.equal(ev.unlisted, false);
  assert.equal((await get("/api/host/nudges", runC)).discover, null, "asked once");
  // "Not now" never asks about that event again, and it stays Link only
  assert.ok((await put("events/r7Bday", { startTime: "18:00", city: "Brooklyn", date: day(16), name: "Birthday", published: true, discoverable: false }, runC)).ok);
  assert.equal((await get("/api/host/nudges", runC)).discover.eventId, "r7Bday");
  await post("/api/host/nudges/discover", { eventId: "r7Bday", show: false }, runC);
  assert.equal((await get("/api/host/nudges", runC)).discover, null); assert.equal(scopeStore(srv.store, wsOf("rae-r7")).get("events/r7Bday").data.discoverable, false);
  // the card is drawn by public/nudges.js, which shell.js loads for signed-in people on the app
  assert.match(read("public/shell.js"), /\/nudges\.js/); assert.match(read("public/nudges.js"), /Show it on Discover/); assert.match(read("public/nudges.js"), /\/api\/host\/nudges/);
});

// ---------- 3 ----------
test("/signup: the waiting idea, the picked city, and with ?ref= the name and email from this device's reply", async () => {
  scopeStore(srv.store, wsOf("rae-r7")).set("rsvps/r7g1", { eventId: "r7Run", response: "going", name: "Nia Guest", email: "nia.r7@example.com", code: "CODE7", createdAt: Date.now() });
  const ok = await (await post("/api/public/reply/r7Run/me", { rid: "r7g1", code: "CODE7" })).json();
  assert.deepEqual(ok, { name: "Nia Guest", email: "nia.r7@example.com" });
  assert.equal((await post("/api/public/reply/r7Run/me", { rid: "r7g1", code: "WRONG" })).status, 404, "no proof, nothing");
  assert.equal((await post("/api/public/reply/r7Sup/me", { rid: "r7g1", code: "CODE7" })).status, 404, "the proof is for one event");
  assert.equal((await post("/api/public/reply/r7Run/me", { rid: "r7g1" })).status, 404);
  const page = read("public/signup.html");
  assert.match(page, /pl\.hostIdea/); assert.match(page, /is waiting/); assert.match(page, /pl\.interests/); assert.match(page, /encore-rsvp-/); assert.match(page, /\/api\/public\/reply\/" \+ encodeURIComponent\(ref\) \+ "\/me"/);
  assert.equal((page.match(/<h1/g) || []).length, 1, "still one h1");
});

// ---------- 4 ----------
test("Brands: request cards lead with what the host does; prices read $X a person; weak proof waits for 3", async () => {
  const B = await get("/api/public/hosts/book"), ada = B.hosts.find((h) => h.handle === "ada-r7"), kai = B.hosts.find((h) => h.handle === "kai-r7");
  assert.ok(ada && ada.request); assert.equal(ada.options[0].name, "AI agent workshops for B2B sales teams"); assert.notEqual(ada.options[0].name, "Request a date");
  assert.equal(kai.options[0].price, "$95 a person", "a bare 95 reads $95 a person"); assert.equal(kai.options[0].perHead, 95);
  for (const [a, b] of [["95", "$95 a person"], ["40 per person", "$40 a person"], ["$40/person", "$40 a person"], ["$1200 flat", "$1,200 flat"], ["From $120 a person", "From $120 a person"], ["Quote on request", ""], ["$2,200 flat", "$2,200 flat"]]) assert.equal(priceText(a), b, a);
  // the page and the host's own form use the same rules
  const hosts = read("public/hosts.html"), shop = read("public/storeshop.js");
  assert.match(hosts, /o\.perHead > 0 \?/); assert.match(shop, /const priceText = /); assert.match(shop, /const priceOf = \(p\) => priceText\(p\) \|\| "To be quoted"/);
  // trust: 1 guest, 2 events, "1 of 2 came back" stay off until n >= 3
  const weak = trustFrom({ S: { guests: 2, returning: 1, dates: ["2026-01-01", "2026-02-01"] }, h: { name: "New Host" } });
  assert.ok(!weak.lines.some((l) => ["guests", "returned", "events"].includes(l.k)), JSON.stringify(weak.lines));
  const ok = trustFrom({ S: { guests: 12, returning: 4, dates: ["2026-01-01", "2026-02-01", "2026-03-01"] }, h: { name: "Real Host" } });
  for (const k of ["guests", "returned", "events"]) assert.ok(ok.lines.some((l) => l.k === k), k);
  // the sheet sits above the phone tab bar (z-index 60)
  assert.ok(+hosts.match(/\.sheet\{position:fixed;inset:0;[^}]*z-index:(\d+)/)[1] > 60);
});

test("Team bookings: what brands can book comes first; invoice details are optional, below", async () => {
  const s = read("public/storeshop.js"), i = (t) => s.indexOf(t);
  assert.ok(i('id="owList">What brands can book') > 0 && i('id="owList">What brands can book') < i("<h4>Requests</h4>"), "the list first");
  assert.ok(i('id="exAdd">+ Add an experience') < i("<h4>Requests</h4>"));
  const inv = i("For invoices (optional)"); assert.ok(inv > i("<h4>Proof: who you've worked with</h4>"));
  for (const id of ['id="hLegal"', 'id="hTax"', 'id="hIns"']) assert.ok(i(id) > inv, id + " sits under For invoices");
});

test("A brand request with an empty Where stores nothing, not the Meeting point hint", async () => {
  const c = await host("mia.r7@example.com", "mia-r7", "Mia's Food Walks", { forHire: true, experiences: [{ name: "Food walk", desc: "Six stops in Chinatown.", min: 6, max: 20, price: "$60 a person" }] });
  const x = (await get("/api/public/host/mia-r7")).host.experiences[0];
  const r = await (await post("/api/public/book/mia-r7", { name: "Sam", company: "Northwind", email: "sam@northwind.example", experienceId: x.id, people: 10, when: "Mar 14", where: "Meeting point in Chinatown", message: "Team walk" })).json();
  assert.ok(r.ok, JSON.stringify(r)); const b = scopeStore(srv.store, wsOf("mia-r7")).list("inquiries").map((d) => d.data).find((q) => q.id === r.id); assert.equal(b.where, "");
  assert.match(read("public/storeshop.js"), /where\.placeholder = `Meeting point/); assert.ok(c);
});

// ---------- 5 ----------
test("find_hosts: categories in hosts' own words, verified_only and min_reviews, and arguments checked", async () => {
  assert.ok(CATEGORY_WORDS.dining.test("chef's table dinners") && CATEGORY_WORDS.movement.test("yoga in the park") && CATEGORY_WORDS.workshop.test("pottery night") && CATEGORY_WORDS.drinks.test("matcha bar") && CATEGORY_WORDS.food.test("we cater lunches"));
  const D = await mcp("find_hosts", { category: "dining" }); assert.ok(D.data.some((x) => x.host.handle === "kai-r7"), "dining finds a chef's table");
  assert.ok(!D.data.some((x) => x.host.handle === "ada-r7"), "not the AI workshop host");
  const W = await mcp("find_hosts", { category: "workshop" }); assert.ok(W.data.some((x) => x.host.handle === "ada-r7"));
  // reviews
  scopeStore(srv.store, wsOf("kai-r7")).set("events/r7Tasting", { name: "Tasting", date: day(-10), city: "Brooklyn", discoverable: true });
  scopeStore(srv.store, wsOf("kai-r7")).set("kudos/k1", { eventId: "r7Tasting", name: "Bo", email: "bo@example.com", love: "Six perfect courses", tags: ["food"], verified: "guest_list", at: Date.now() }); X().bust();
  const V = await mcp("find_hosts", { verified_only: true }); assert.ok(V.data.length && V.data.every((x) => x.verified_reviews > 0), JSON.stringify(V.data.map((x) => [x.host.handle, x.verified_reviews])));
  assert.ok(V.data.some((x) => x.host.handle === "kai-r7")); assert.equal(V.query.verified_only, true);
  assert.ok(!(await mcp("find_hosts", { min_reviews: 5 })).data.some((x) => x.host.handle === "kai-r7"));
  // unknown arguments name the right one; query is q; numbers must be positive
  const bad = await rpc("find_hosts", { people: 12 }); assert.equal(bad.error.code, -32602); assert.match(bad.error.message, /"people"/); assert.match(bad.error.message, /group_size/);
  assert.equal(closestArg("location", ["city", "category"]), "city"); assert.equal(closestArg("catgory", ["city", "category"]), "category");
  const q = await mcp("search_events", { query: "Prospect" }); assert.ok(q.data.some((e) => e.id === "r7Run"), "query works as q");
  for (const a of [{ group_size: -3 }, { group_size: "lots" }, { budget: 0 }, { budget: -100 }]) { const r = await rpc("find_hosts", a); assert.equal(r.error?.code, -32602, JSON.stringify(a)); }
  assert.equal((await fetch(srv.base + "/api/v1/hosts/find?group_size=-2")).status, 400); assert.equal((await fetch(srv.base + "/api/v1/hosts/find?budget=%245%2C000")).status, 200, "$5,000 is a number");
  // documented
  const tool = (await post("/mcp/public", { jsonrpc: "2.0", id: 2, method: "tools/list" }).then((r) => r.json())).result.tools.find((t) => t.name === "find_hosts");
  assert.ok(tool.inputSchema.properties.verified_only && tool.inputSchema.properties.min_reviews);
  const O = await get("/api/v1/openapi.json"), P = O.paths["/api/v1/hosts/find"].get.parameters.map((p) => p.name); assert.ok(P.includes("verified_only") && P.includes("min_reviews"));
  const L = await (await fetch(srv.base + "/llms.txt")).text(); assert.match(L, /verified_only/); assert.match(L, /min_reviews/); assert.match(L, /query works as q/);
});

// ---------- 6 ----------
test("Uploads: the bytes must be what the type says; a video whose length can't be read stays small", async () => {
  assert.equal(sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), "image/jpeg"); assert.equal(sniffType(Buffer.from("GIF89a....")), "image/gif");
  assert.equal(sniffType(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")])), "image/webp");
  assert.equal(sniffType(Buffer.from("\0\0\0\x18ftypqt  ", "latin1")), "video/quicktime"); assert.equal(sniffType(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1])), "video/webm");
  assert.equal(sniffedAs("image/png", Buffer.from("<html><script>")), ""); assert.equal(sniffedAs("video/mp4", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0])), "");
  const q = (b, t, extra = "") => fetch(`${srv.base}/api/moments?eventId=r7RunPast${extra}`, { method: "POST", headers: { "content-type": t, cookie: runC }, body: b });
  const html = await q(Buffer.from("<html><script>alert(1)</script></html>"), "image/png"); assert.equal(html.status, 415); assert.equal((await html.json()).code, "unsupported_type");
  assert.equal((await q(Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), "video/mp4")).status, 415, "a PNG isn't a video");
  const png = await q(Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13]), "image/jpeg"); assert.equal(png.status, 200, "a mislabelled photo is still a photo");
  const blob = await fetch(srv.base + (await png.json()).url); assert.equal(blob.headers.get("content-type"), "image/png", "stored as what it is");
  process.env.MOMENT_UNREAD_VIDEO_MB = "0.001";
  const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(3000)]);
  const r = await q(webm, "video/webm"); assert.equal(r.status, 400); const j = await r.json(); assert.equal(j.code, "unknown_length"); assert.equal(j.message, "We couldn't read this video's length. Try an MP4 from your camera.");
  delete process.env.MOMENT_UNREAD_VIDEO_MB;
  assert.equal((await q(webm, "video/webm")).status, 200, "a short clip under the cap is fine");
  const post1 = await fetch(srv.base + "/api/me/posts/photo", { method: "POST", headers: { "content-type": "image/png", cookie: runC }, body: Buffer.from("not a photo") }); assert.equal(post1.status, 415);
});

// ---------- 7 ----------
test("Reactions: signed out, one IP gets a few taps per event a day; the page puts a refused tap back", async () => {
  process.env.ENCORE_REACTS_PER_IP = "3";
  const tap = (device, emoji = "🔥") => post("/api/feed/react", { eventId: "r7RunPast", emoji, device });
  for (let i = 0; i < 3; i++) assert.equal((await tap("device-r7-" + i)).status, 200);
  const no = await tap("device-r7-9"); assert.equal(no.status, 429); assert.equal((await no.json()).code, "rate_limited");
  const me = await post("/api/feed/react", { eventId: "r7RunPast", emoji: "🙌" }, supC); assert.equal(me.status, 200, "signed in isn't limited this way");
  delete process.env.ENCORE_REACTS_PER_IP;
  const fv = read("public/feedvisual.js"); assert.match(fv, /if \(!r\.ok \|\| !j\.counts\) \{ undo\(\); return; \}/); assert.match(fv, /b\.setAttribute\("aria-label", was\.label\)/);
});

// ---------- 8 ----------
test("Saves keep only our own pictures", async () => {
  const c = await account("Pat Save", "pat.r7@example.com");
  await post("/api/me/saves", { kind: "event", ref: "r7Run", img: "https://tracker.example/pixel.gif" }, c);
  await post("/api/me/saves", { kind: "event", ref: "r7Sup", img: "/presets/atelier-bo-apt-cafe-club.jpg" }, c);
  const S = await get("/api/me/saves", c);
  assert.equal(S.items.find((i) => i.ref === "r7Run").img, ""); assert.equal(S.items.find((i) => i.ref === "r7Sup").img, "/presets/atelier-bo-apt-cafe-club.jpg");
  assert.match(read("public/save.js"), /img: imgOk\(item\.img\)/); assert.ok(!/https:\\\/\\\//.test(read("public/saved.html").match(/const safeImg = [^\n]+/)[0]));
});

// ---------- 9 ----------
test("Help: the button steps aside for dialogs; guests don't need a host code", async () => {
  const h = read("public/help.js"); assert.match(h, /const modalOpen = /); assert.match(h, /\[role=dialog\]/); assert.match(h, /\.store-pane/); assert.match(h, /#wizBg/); assert.match(h, /\.eh-away\{display:none!important\}/);
  const md = read("docs/help.md"), sec = md.slice(md.indexOf("## Host codes"), md.indexOf("## The waitlist"));
  assert.match(sec, /Been a guest at an event here\? Tap Your turn\? on that invite\. You don't need a code\./);
});

// ---------- 10 ----------
test("Polish: ideas say a title once, stickers clear the host's name, the picker, the side card, the digest's day, brand words", async () => {
  const ins = read("public/inspo.js"); assert.match(ins, /EA\.cover\(e, \{ title: ""/); assert.match(ins, /const lineOf = /); assert.match(ins, /\.pli-flyer \.pli-sticker\{left:auto;right:-8px/);
  const pin = read("public/interests.js"); assert.match(pin, /\.pin \.pin-x\{position:absolute;z-index:3/); assert.match(pin, /\.pin-main:disabled\{background:#EFE6D8;color:#4A3F37/); assert.ok(!/\.pin-main:disabled\{opacity/.test(pin));
  assert.match(read("public/feed.html"), /\.fside:empty\{display:none!important\}/);
  // the weekend is worked out where the person is: Sunday 8pm in LA is Monday in UTC
  const sun8pmLA = Date.parse("2026-11-30T04:00:00Z"); assert.equal(localDay(sun8pmLA, "America/Los_Angeles"), "2026-11-29");
  assert.deepEqual(weekendOf(sun8pmLA, "America/Los_Angeles"), { from: "2026-11-29", to: "2026-11-29" }); assert.deepEqual(weekendOf(sun8pmLA, "UTC"), { from: "2026-12-04", to: "2026-12-06" });
  // the digest goes Thursday where they live: Wednesday 8pm in LA (Thursday in UTC) is too early
  const c = await account("Lee Digest", "lee.r7@example.com"); await req("PUT", "/api/me/interests", { interests: ["games"], city: "Los Angeles" }, c);
  const wed8pmLA = Date.parse(day(0) + "T12:00:00Z"); let thuUTC = wed8pmLA; for (let i = 0; i < 8; i++) { const t = Date.parse(day(i) + "T04:00:00Z"); if (new Date(t).getUTCDay() === 4 && t > Date.now()) { thuUTC = t; break; } }
  const W = weekendOf(thuUTC + 864e5, "America/Los_Angeles");
  assert.ok((await put("events/r7Games", { startTime: "19:00", city: "Los Angeles", hood: "Echo Park", date: W.from, name: "Board game night", activity: "games", discoverable: true }, supC)).ok);
  const inbox = () => X().inbox("lee.r7@example.com").filter((x) => x.kind === "digest").length;
  await H().runJobs(thuUTC, srv.base); assert.equal(inbox(), 0, "still Wednesday in Los Angeles");
  await H().runJobs(thuUTC + 16 * 3600e3, srv.base); assert.equal(inbox(), 1, "Thursday afternoon in Los Angeles");
  // brand words: no "Meetup" label, no "club meetup"
  assert.ok(!/meetup: "Meetup"/.test(read("server/hooks.js"))); assert.ok(!/club meetup/.test(read("public/feed.html")));
});
