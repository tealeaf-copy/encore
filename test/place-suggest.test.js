// Potto's picks (public/placesuggest.js, server/placesuggest.js): the moment someone starts making an event, places that
// fit it near where it makes sense, with honest labels, one or two nudges, and a provider API other features plug into.
// Offline: the places provider is a local stub (ENCORE_PLACES_URL) speaking Overpass, and Google is a stubbed fetch.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { makeNearby, providerWhy, platformWhy, pure } from "../server/placesuggest.js";

const require = createRequire(import.meta.url);
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
require("../public/placesuggest.js");
const PS = globalThis.PLSuggestPlaces;
const J = { "content-type": "application/json" };
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "place-suggest-0123456789abcdef", ENCORE_SIGNUP_PER_HOUR: "200", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_GEO: "1", ENCORE_PLACES_GAP_MS: "0" };
const SHOTS = process.env.PSG_SHOTS || "";
let srv, stub, stubHits = [], host, host2, sam, browser = null;

// an Overpass stand-in: a few named places around the asked centre, by what the query looks for
const STUB = { cafe: ["Stub Café Norte", "Stub Café Sur", "Café Grumpy", "Stub Espresso Bar"], bar: ["Stub Wine Bar", "Stub Pub"], restaurant: ["Stub Trattoria", "Stub Dumpling House", "Stub Bistro"], park: ["Stub Park", "Stub Garden Green"] };
function overpass(q) { const m = /around:(\d+),(-?[\d.]+),(-?[\d.]+)/.exec(q), lat = +m[2], lng = +m[3], out = [];
  const add = (names, tag) => names.forEach((name, i) => out.push({ type: "node", id: 1000 + out.length, lat: lat + 0.002 * (i + 1), lon: lng + 0.001 * i, tags: { name, ...tag, ...(i === 0 ? { "addr:housenumber": "1", "addr:street": "Stub St" } : {}) } }));
  if (/"amenity"="cafe"/.test(q)) add(STUB.cafe, { amenity: "cafe" }); if (/bar\|pub/.test(q)) add(STUB.bar, { amenity: "bar" }); if (/"amenity"="restaurant"/.test(q)) add(STUB.restaurant, { amenity: "restaurant" }); if (/"leisure"="park"|park\|nature_reserve/.test(q)) add(STUB.park, { leisure: "park" });
  out.push({ type: "node", id: 9, lat, lon: lng, tags: { amenity: "cafe" } }); // no name: never shown
  return { elements: out }; }
const post = (p, body, cookie) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body || {}) });
const signup = async (name, email) => { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200, await r.clone().text()); return { cookie: r.headers.get("set-cookie").split(";")[0], name, email }; };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const putEv = (c, id, e) => fetch(srv.base + "/api/db/doc?path=events/" + id, { method: "PUT", headers: { ...J, cookie: c }, body: JSON.stringify(e) });

before(async () => {
  stub = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { const q = decodeURIComponent(String(b).replace(/^data=/, "").replace(/\+/g, " ")); stubHits.push({ ua: req.headers["user-agent"], q });
    setTimeout(() => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(overpass(q))); }, /"craft"="pottery"/.test(q) ? 1500 : 20); }); });
  await new Promise((r) => stub.listen(0, "127.0.0.1", r));
  Object.assign(process.env, ENV, { ENCORE_PLACES_URL: `http://127.0.0.1:${stub.address().port}/api/interpreter` }); resetLoginLimits(); srv = await startServer();
  host = await signup("Ada Picks", "ada.picks@example.com"); host2 = await signup("Bo Host", "bo.picks@example.com"); sam = await signup("Sam Rivera", "sam.picks@example.com");
  for (const [u, h] of [[host, "ada-picks"], [host2, "bo-picks"], [sam, "sam-picks"]]) assert.equal((await post("/api/host/profile", { handle: h, name: u.name, city: "New York" }, u.cookie)).status, 200);
  // two hosts used the same public café for public events this month, so it has earned "Loved on Pottery Lab"
  const pub = { kind: "social", casual: true, published: true, discoverable: true, unlisted: false, placePublic: true, venueName: "Café Grumpy", city: "New York", hood: "Greenpoint", startTime: "10:00" };
  assert.equal((await putEv(host2.cookie, "psgEv1", { ...pub, pubTitle: "Coffee and sketching", name: "Coffee and sketching", date: day(-9) })).status, 200);
  assert.equal((await putEv(sam.cookie, "psgEv2", { ...pub, pubTitle: "Saturday coffee", name: "Saturday coffee", date: day(-3) })).status, 200);
  // a private event at a home never shows up anywhere
  assert.equal((await putEv(host2.cookie, "psgEv3", { ...pub, discoverable: false, unlisted: true, venueName: "Bo's apartment", pubTitle: "Coffee at mine", date: day(-2) })).status, 200);
  const X = srv.app.locals.social; X.addFriend(host.email, sam.email); X.addFriend(sam.email, host.email);
  // Sam shares an area for "Somewhere in the middle"; and Ada has a home area (so each test can run alone)
  assert.equal((await post("/api/me/home-area", { area: "Astoria", city: "New York", share: true }, sam.cookie)).status, 200);
  assert.equal((await post("/api/me/home-area", { area: "Greenpoint", city: "New York" }, host.cookie)).status, 200);
  try { ({ chromium: browser } = createRequire(import.meta.url)("playwright")); } catch { browser = null; }
});
after(async () => { for (const k of [...Object.keys(ENV), "ENCORE_PLACES_URL", "ENCORE_PLACE_IDEAS_PER_HOUR"]) delete process.env[k]; await srv?.close(); await new Promise((r) => stub.close(r)); });

// ---------- the words ----------
test("intents: the first words say what it is, the kind fills in, at home needs no venue", () => {
  const k = (t, o = {}) => PS.intentOf({ text: t, ...o })?.key || "";
  assert.equal(k("coffee with Sam"), "coffee"); assert.deepEqual(PS.intentOf({ text: "coffee with Sam" }).with, ["Sam"]);
  assert.equal(k("drinks Friday"), "drinks"); assert.equal(k("dinner for 6"), "dinner"); assert.equal(PS.intentOf({ text: "dinner for 6" }).n, 6);
  assert.equal(k("picnic"), "picnic"); assert.equal(k("board games"), "games"); assert.equal(k("pottery class"), "class");
  const b = PS.intentOf({ text: "birthday brunch" }); assert.equal(b.key, "brunch"); assert.ok(b.birthday);
  assert.equal(k("Saturday 5k, coffee after"), "run", "the earliest word wins"); assert.equal(k("", { planKind: "picnic" }), "picnic"); assert.equal(k("", { planKind: "brunch" }), "coffee");
  assert.equal(k("Something", { planKind: "summit" }), ""); assert.ok(PS.intentOf({ text: "Dinner at my place Friday" }).atHome);
  assert.deepEqual(PS.withNames("drinks with Ana and Jun, with friends"), ["Ana", "Jun"]); assert.deepEqual(PS.withNames("dinner with friends"), []);
  assert.equal(pure().intentOf({ text: "coffee with Sam" }).key, "coffee", "the server reads the words the same way");
});
test("nudges: never more than 2, fitting, one tap each", () => {
  const ids = (t, W = {}) => PS.nudges(PS.intentOf({ text: t }), W).map((n) => n.id);
  assert.deepEqual(ids("coffee with Sam"), ["time", "line"]); assert.equal(PS.nudges(PS.intentOf({ text: "coffee" }), {})[0].patch.startTime, "09:30");
  assert.deepEqual(ids("dinner for 6"), ["table", "diet"]); assert.deepEqual(ids("dinner for 6", { planKind: "table", askDiet: true }), []);
  assert.deepEqual(ids("picnic"), ["rain", "bring"]); assert.deepEqual(ids("birthday brunch"), ["gift", "time"]); assert.deepEqual(ids("Dinner at my place"), ["diet", "bring"]);
  for (const t of ["coffee", "drinks", "dinner for 8", "picnic", "board games", "pottery class", "birthday dinner for 10", "hike", "book club", "watch party"]) assert.ok(ids(t).length <= 2, t);
  assert.deepEqual(PS.nudges(PS.intentOf({ text: "dinner for 6" }), {}, { can: { kind: false, diet: false } }), [], "/start can't book a table or ask questions");
  assert.equal(PS.fmtDist(640), "8 min walk"); assert.equal(PS.fmtDist(3200), "3.2 km away"); assert.equal(PS.fmtDist(3219, true), "2.0 mi away");
  assert.match(PS.mapsUrl({ name: "Stub Park", lat: 1, lng: 2 }, true), /^https:\/\/maps\.apple\.com\/\?q=Stub%20Park&ll=1,2$/); assert.match(PS.mapsUrl({ name: "A", city: "New York" }), /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=A%2C%20New%20York$/);
});
test("labels are honest: Pottery Lab only when earned, Google only from its numbers, no 'trendy' without data", () => {
  assert.deepEqual(platformWhy({ againOf: 20, againYes: 19, recent: 2, events: 3, hosts: new Set([1, 2]) }), { label: "Loved on Pottery Lab", why: ["Hosts here got 95% would go again", "Popular on Pottery Lab this month"] });
  assert.equal(platformWhy({ againOf: 0, againYes: 0, recent: 0, events: 1, hosts: new Set([1]) }).label, "Hosted on Pottery Lab");
  assert.deepEqual(providerWhy({ source: "google", rating: 4.6, reviews: 1240, openNow: true }), { label: "Popular on Google", why: ["4.6 on Google (1,240 reviews)", "Open now"] });
  assert.equal(providerWhy({ source: "google", rating: 4.3, reviews: 60 }).label, "Well rated"); assert.equal(providerWhy({ source: "google", rating: 3.9, reviews: 900 }).label, "Nearby");
  assert.deepEqual(providerWhy({ source: "osm" }), { label: "Nearby", why: [] }, "OpenStreetMap has no ratings, so it says Nearby and nothing more");
  assert.equal(providerWhy({ source: "google", rating: 4.5, reviews: 80, groups: true }, { n: 6, intent: "dinner" }).why.includes("Takes groups"), true);
  const src = read("public/placesuggest.js") + read("server/placesuggest.js"); assert.doesNotMatch(src, /\btrendy\b/i); assert.doesNotMatch(src, /—/); assert.doesNotMatch(src, /claude|opus|sonnet|haiku/i);
});
test("Google Places with a key: one POST with a field mask, the centre rounded, cached in memory only, attributed", async () => {
  const calls = [], store = { set: () => { throw new Error("never written to disk"); }, get: () => null };
  const fetchImpl = async (u, o) => { calls.push({ u: String(u), o }); return { ok: true, json: async () => ({ places: [{ id: "abc", displayName: { text: "Stub Roasters" }, shortFormattedAddress: "1 Stub St", location: { latitude: 40.7301, longitude: -73.9542 }, rating: 4.7, userRatingCount: 812, currentOpeningHours: { openNow: true }, googleMapsUri: "https://maps.google.com/?cid=1", goodForGroups: false }] }) }; };
  const N = makeNearby({ store, env: { ENCORE_PLACES_KEY: "k-test" }, fetchImpl });
  assert.equal(N.provider, "google"); assert.equal(N.attribution, "Places and ratings from Google Maps");
  const A = await N.near("coffee", { lat: 40.73012, lng: -73.95431 }, 1500); assert.equal(A[0].name, "Stub Roasters"); assert.equal(A[0].rating, 4.7); assert.equal(A[0].reviews, 812); assert.ok(A[0].openNow);
  assert.equal(calls.length, 1); assert.match(calls[0].u, /places\.googleapis\.com\/v1\/places:searchNearby$/); const h = calls[0].o.headers, body = JSON.parse(calls[0].o.body);
  assert.equal(h["X-Goog-Api-Key"], "k-test"); assert.match(h["X-Goog-FieldMask"], /places\.rating,places\.userRatingCount,places\.currentOpeningHours\.openNow/);
  assert.deepEqual(body.includedTypes, ["cafe", "coffee_shop"]); assert.equal(body.locationRestriction.circle.center.latitude, 40.73); assert.equal(body.locationRestriction.circle.center.longitude, -73.955);
  await N.near("coffee", { lat: 40.7302, lng: -73.9544 }, 1500); assert.equal(calls.length, 1, "a nearby ask shares the cached answer");
  await N.near("class", { lat: 40.73, lng: -73.95 }, 4000, "pottery class"); assert.match(calls[1].u, /:searchText$/); assert.equal(JSON.parse(calls[1].o.body).textQuery, "pottery studio");
  assert.equal(makeNearby({ env: {} }).provider, "osm", "no key: OpenStreetMap"); assert.equal(makeNearby({ env: { ENCORE_FAKE_GEO: "1" } }).provider, "off", "test runs make no requests");
  const doc = read("docs/launch-checklist.md"); for (const k of ["ENCORE_PLACES_KEY", "ENCORE_PLACES_PROVIDER", "ENCORE_PLACES_UA", "ENCORE_PLACE_IDEAS_PER_HOUR"]) assert.match(doc, new RegExp("`" + k + "`"), k);
});

// ---------- the server ----------
test("home area: private, set in Settings, never sent back as a point; deleted with the account", async () => {
  assert.equal((await fetch(srv.base + "/api/me/home-area")).status, 401);
  const r = await post("/api/me/home-area", { area: "Greenpoint", city: "New York" }, host.cookie), j = await r.json(); assert.equal(r.status, 200); assert.equal(j.found, true);
  const g = await (await fetch(srv.base + "/api/me/home-area", { headers: { cookie: host.cookie } })).json(); assert.deepEqual(g, { set: true, area: "Greenpoint", city: "New York", share: false, found: true });
  assert.equal(JSON.stringify(g).includes("lat"), false);
  assert.equal((await post("/api/me/home-area", { area: "x" }, host.cookie)).status, 400);
  assert.equal((await post("/api/me/home-area", { area: "Astoria", city: "New York", share: true }, sam.cookie)).status, 200);
  assert.match(read("server/account.js"), /"plhome-"/, "account deletion removes it");
  const st = read("public/settings.html"); assert.match(st, /id="plHomeSet"/); assert.match(st, /\/homearea\.js/); assert.match(read("public/homearea.js"), /Only you see it/);
});
test("coffee with Sam: cafés near the home area, Pottery Lab's own first, OpenStreetMap after, honest labels and credit", async () => {
  const r = await post("/api/place-suggest", { intent: "coffee", text: "coffee with Sam", mode: "auto", with: ["Sam"] }, host.cookie), j = await r.json();
  assert.equal(r.status, 200); assert.equal(r.headers.get("cache-control"), "private, no-store");
  assert.equal(j.where.mode, "home"); assert.equal(j.where.line, "near your home area, Greenpoint"); assert.equal(j.where.lat, undefined, "the home area never goes back as a point");
  assert.deepEqual(j.modes.map((m) => m.id), ["home", "city", "middle"]);
  const L = j.sections[0].items; assert.ok(L.length >= 3 && L.length <= 5, JSON.stringify(L));
  assert.equal(L[0].name, "Café Grumpy"); assert.equal(L[0].label, "Loved on Pottery Lab"); assert.ok(L[0].why.some((w) => /Pottery Lab this month/.test(w)));
  assert.equal(L.filter((x) => x.name === "Café Grumpy").length, 1, "the same café once");
  assert.ok(L.slice(1).every((x) => x.label === "Nearby" && x.source === "osm"), "no key: OpenStreetMap, labelled Nearby");
  assert.ok(L.some((x) => /^Near you, \d+ min walk$/.test(x.why[0] || "")), "distance from the home area");
  assert.ok(!L.some((x) => /apartment/i.test(x.name)), "a home never shows"); assert.deepEqual(j.attribution, ["Map data © OpenStreetMap contributors"]);
  assert.ok(stubHits.length && stubHits.every((h) => /^PotteryLab\/1\.0 \(place ideas/.test(h.ua)), "a polite user agent");
  assert.ok(stubHits.every((h) => /around:1500,40\.73\d*,-73\.95\d*/.test(h.q)), "a rounded centre, never more exact than about 500 m");
});
test("somewhere in the middle: only mutual friends who shared, an aggregate line, no one's area or name", async () => {
  const j = await (await post("/api/place-suggest", { intent: "coffee", text: "coffee with Sam", mode: "middle", with: ["Sam"] }, host.cookie)).json();
  assert.equal(j.where.mode, "middle"); assert.match(j.where.line, /^between you and 1 friend who shared an area/);
  const s = JSON.stringify(j); for (const bad of ["Astoria", "Sam", "sam.picks", "Rivera"]) assert.ok(!s.includes(bad), bad);
  assert.equal(j.where.lat, undefined);
  const no = await (await post("/api/place-suggest", { intent: "coffee", text: "coffee with Bo", mode: "middle", with: ["Bo"] }, host.cookie)).json();
  assert.ok(!no.modes.some((m) => m.id === "middle"), "Bo isn't a friend who shared"); assert.notEqual(no.where.mode, "middle");
});
test("dinner, picnic and drinks give fitting picks; signed out works by city or location; slow providers come back pending", async () => {
  const ask = async (b, c) => (await post("/api/place-suggest", b, c)).json();
  const din = await ask({ intent: "dinner", text: "dinner for 6", n: 6 }, host.cookie); assert.ok(din.sections[0].items.some((x) => /Trattoria|Dumpling|Bistro/.test(x.name))); assert.equal(din.sections[0].title, "Restaurants");
  const pic = await ask({ intent: "picnic", text: "picnic" }, host.cookie); assert.ok(pic.sections[0].items.every((x) => /Park|Green/.test(x.name)), JSON.stringify(pic.sections[0].items));
  const dr = await ask({ intent: "drinks", text: "drinks Friday" }, host.cookie); assert.ok(dr.sections[0].items.some((x) => /Wine Bar|Pub/.test(x.name)));
  const out = await ask({ intent: "coffee", text: "coffee", mode: "auto", city: "New York" }); assert.equal(out.where.mode, "city"); assert.ok(out.sections[0].items.length >= 3);
  const here = await ask({ intent: "coffee", text: "coffee", mode: "here", lat: 40.7448123, lng: -73.9485123 }); assert.equal(here.where.mode, "here"); assert.equal(here.where.line, "near you right now");
  const none = await ask({ intent: "coffee", text: "coffee" }); assert.equal(none.sections[0].items.length, 0); assert.match(none.sections[0].note, /Use my location/);
  const slow = await ask({ intent: "class", text: "pottery class", city: "New York" }); assert.equal(slow.pending, true, "the page asks again in a moment");
  assert.equal((await ask({ text: "a summit" })).intent, "");
});
test("other providers plug in: a server section for an intent with the private centre, listed in meta", async () => {
  let seen = null; const off = srv.app.locals.placeSuggest.register("run", { id: "routes", title: "Routes near you", load: (ctx) => { seen = ctx; return { items: [{ name: "Stub loop, 5 km", why: ["Flat, along the water"], label: "Route" }], attribution: "Routes from a stub" }; } });
  const m = await (await fetch(srv.base + "/api/public/place-suggest/meta")).json(); assert.deepEqual(m.sections.run, [{ id: "routes", title: "Routes near you" }]); assert.equal(m.provider, "osm");
  const j = await (await post("/api/place-suggest", { intent: "run", text: "Saturday 5k" }, host.cookie)).json();
  assert.deepEqual(j.sections.map((s) => s.id), ["places", "routes"]); assert.equal(j.sections[1].items[0].name, "Stub loop, 5 km"); assert.ok(j.attribution.includes("Routes from a stub"));
  assert.ok(seen.center && Math.abs(seen.center.lat - 40.73) < 0.02, "the provider gets the centre"); assert.equal(seen.mode, "home");
  const only = await (await post("/api/place-suggest", { intent: "run", text: "5k", section: "routes" }, host.cookie)).json(); assert.deepEqual(only.sections.map((s) => s.id), ["routes"]);
  off();
});
test("rate limited per person, and per address signed out", async () => {
  process.env.ENCORE_PLACE_IDEAS_PER_HOUR = "2"; let last = 200; for (let i = 0; i < 3; i++) last = (await post("/api/place-suggest", { intent: "coffee", text: "coffee", city: "Boston" })).status;
  assert.equal(last, 429); delete process.env.ENCORE_PLACE_IDEAS_PER_HOUR;
});
test("wiring: small hooks in the canvas and /start, loaded lazily, nothing in the app shell", () => {
  const cv = read("public/canvas.js"), st = read("public/start.html"), html = read("index.html");
  assert.match(cv, /<div id="cvPicks" class="cv-picks" hidden><\/div>/); assert.match(cv, /s\.src = "\/placesuggest\.js"/); assert.match(cv, /picksPoke\(\)/);
  assert.match(st, /<div id="stPicks" hidden><\/div>/); assert.match(st, /<script src="\/placesuggest\.js" defer><\/script>/);
  assert.ok(!html.includes("placesuggest"), "the app shell doesn't carry it"); assert.match(html.slice(html.lastIndexOf("\n<script")), /^\n<script>\n\/\/ ---- "Come with me\?"/);
  const js = read("public/placesuggest.js"); assert.match(js, /height:236px/, "fixed-height rows"); assert.match(js, /min-height:44px/); assert.doesNotMatch(js, /--pl-font-serif|--pl-font-display|--sys-display/, "no display serif in the panel");
});

// ---------- in a browser ----------
async function page(br, { width, cookie = "", geo = null }) {
  const mobile = width < 500, ctx = await br.newContext({ viewport: { width, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1, serviceWorkers: "block", ...(geo ? { geolocation: geo, permissions: ["geolocation"] } : {}) });
  ctx.setDefaultTimeout(30000); await ctx.addInitScript(() => { try { localStorage.removeItem("encore.canvas.new"); localStorage.removeItem("pl.startDraft"); } catch {} });
  if (cookie) { const [k, ...v] = cookie.split("="); await ctx.addCookies([{ name: k, value: v.join("="), url: srv.base }, { name: "encore_in", value: "1", url: srv.base }]); }
  const p = await ctx.newPage(), errs = [], bad = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("response", (r) => { if (r.status() >= 500) bad.push(r.url() + " " + r.status()); }); p.errs = errs; p.bad = bad; p.ctx = ctx; return p; }
const shot = async (p, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.evaluate(() => document.querySelector("#cvPicks:not([hidden]),#stPicks:not([hidden])")?.scrollIntoView({ block: "start" })); await p.waitForTimeout(150); await p.screenshot({ path: `${SHOTS}/${name}.png` }); } };
async function canvas(p) { await p.goto(srv.base + "/?app=1&new=1#studio"); { const ev = p.getByRole("button", { name: /^An event/ }).or(p.getByRole("tab", { name: /^An event/ })).or(p.getByRole("radio", { name: /^An event/ })).first(); await ev.click(); const go = p.getByRole("button", { name: "Start an event" }); if (await go.count()) await go.click(); } /* the chooser: pick An event, then Start an event */ await p.waitForSelector("#cv #cvTitle"); await p.waitForTimeout(600);
  await p.evaluate(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: false }); }); }
async function typeTitle(p, text) { await p.click("#cvTitle"); await p.keyboard.type(text, { delay: 25 }); }

for (const width of [390, 1280]) test(`browser at ${width}: coffee with Sam, the middle, dinner, picnic, drinks, dismiss, /start`, { timeout: 240000 }, async (t) => {
  if (!browser) return t.skip("no playwright"); let br; try { br = await browser.launch(); } catch { return t.skip("no browser"); }
  try {
    const p = await page(br, { width, cookie: host.cookie }); await canvas(p);
    assert.equal(await p.locator("#cvPicks").isHidden(), true, "nothing opens by itself");
    await typeTitle(p, "coffee with Sam"); const t0 = Date.now();
    await p.waitForSelector("#cvPicks .psg-c:not(.psg-sk)", { timeout: 1000 }); const ms = Date.now() - t0;
    await p.waitForFunction(() => document.querySelector("#cvPicks .psg-l")?.textContent.includes("near your home area"));
    const cards = await p.$$eval("#cvPicks [data-psg-sec=places] .psg-c", (L) => L.map((c) => ({ label: c.querySelector(".psg-b")?.textContent, name: c.querySelector(".psg-n")?.textContent, why: [...c.querySelectorAll(".psg-w")].map((x) => x.textContent), map: c.querySelector(".psg-map")?.href })));
    assert.ok(cards.length >= 3 && cards.length <= 5, JSON.stringify(cards)); assert.equal(cards[0].label, "Loved on Pottery Lab"); assert.ok(cards.slice(1).every((c) => c.label === "Nearby"));
    assert.ok(cards.every((c) => /^https:\/\/(maps\.apple\.com|www\.google\.com\/maps|www\.openstreetmap\.org)\//.test(c.map)), "each opens in a maps app");
    assert.match(await p.locator("#cvPicks .psg-src").innerText(), /OpenStreetMap contributors/);
    assert.equal(await p.locator("#cvPicks .psg-nudges li").count(), 2); await shot(p, `coffee-${width}`);
    // a box that sits below the panel doesn't move while picks load
    // fixed heights: every row is the same height whether loading or loaded
    const hs = await p.$$eval("#cvPicks .psg-row", (L) => L.map((r) => r.getBoundingClientRect().height)); assert.ok(hs.every((h) => h === 236), JSON.stringify(hs));
    // Somewhere in the middle: no friend's area, name or point on the page
    await p.click("#cvPicks [data-psg-mode=middle]"); await p.waitForFunction(() => /between you and 1 friend/.test(document.querySelector("#cvPicks .psg-l")?.textContent || ""));
    const txt = await p.locator("#cvPicks").innerText(); assert.ok(!/Astoria|Rivera/.test(txt), txt); await shot(p, `middle-${width}`);
    await p.click("#cvPicks [data-psg-mode=home]"); await p.waitForFunction(() => /home area/.test(document.querySelector("#cvPicks .psg-l")?.textContent || ""));
    // picking one fills the place
    await p.click("#cvPicks [data-psg-sec=places] .psg-use >> nth=0"); await p.waitForFunction(() => /Café Grumpy/.test(document.querySelector("#cvPlace")?.textContent || ""));
    assert.equal(await p.locator("#cvPicks .psg-use[aria-pressed=true]").count(), 1); await shot(p, `picked-${width}`);
    const cls = await p.evaluate(() => window.__cls); assert.ok(cls < 0.05, "layout shift " + cls);
    // dismiss
    await p.click("#cvPicks [data-psg-x]"); assert.equal(await p.locator("#cvPicks").isHidden(), true); await typeTitle(p, " again"); await p.waitForTimeout(400); assert.equal(await p.locator("#cvPicks").isHidden(), true, "stays hidden for this event");
    assert.deepEqual(p.errs, []); assert.deepEqual(p.bad, []); assert.ok(ms < 1000, "picks within a second: " + ms); await p.ctx.close();

    // dinner for 6: restaurants and the booking nudge; picnic: parks and a rain plan; drinks: bars
    for (const [title, re, nudge] of [["dinner for 6", /Trattoria|Dumpling|Bistro/, "Ask about food"], ["picnic", /Park|Green/, "Add a rain plan"], ["drinks Friday", /Wine Bar|Pub/, ""]]) {
      const q = await page(br, { width, cookie: host.cookie }); await canvas(q); await typeTitle(q, title);
      await q.waitForSelector("#cvPicks .psg-c:not(.psg-sk)"); await q.waitForFunction((s) => [...document.querySelectorAll("#cvPicks .psg-n")].some((n) => new RegExp(s).test(n.textContent)), re.source);
      const nb = await q.$$eval("#cvPicks .psg-nb", (L) => L.map((b) => b.textContent)); assert.ok(nb.length >= 1 && nb.length <= 2, nb.join("|"));
      if (title.startsWith("dinner")) assert.ok(nb.includes("Make it a booking"), nb.join("|"));
      await shot(q, `${title.split(" ")[0]}-${width}`);
      if (nudge) { await q.click(`#cvPicks .psg-nb:text("${nudge}")`); await q.waitForTimeout(300); if (nudge === "Add a rain plan") assert.match(await q.locator("#cvBlocks").innerText(), /If it rains/); }
      assert.deepEqual(q.errs, []); await q.ctx.close(); }

    // a run: the routes provider plugs into the same panel from the page
    const r = await page(br, { width, cookie: host.cookie }); await canvas(r);
    await r.evaluate(() => { window.__plPicksQ = window.__plPicksQ || []; const go = (P) => P.register("run", { id: "routesStub", title: "Routes near you", load: async (ctx) => ({ items: [{ name: "Stub river loop, 5 km", why: ["Flat", ctx.where.mode]  , label: "Route", fill: { meetPoint: "Stub river loop start" } }] }) }); window.PLSuggestPlaces?.register ? go(window.PLSuggestPlaces) : window.__plPicksQ.push(go); });
    if (await r.locator("[data-kind=run]").isHidden()) await r.click("[data-kmore]"); await r.click("[data-kind=run]"); await r.waitForFunction(() => /Stub river loop/.test(document.querySelector("#cvPicks [data-psg-sec=routesStub]")?.textContent || ""));
    await r.click("#cvPicks [data-psg-sec=routesStub] .psg-use"); await r.waitForFunction(() => /Stub river loop start/.test(document.querySelector("#cvPlace")?.textContent || "")); await shot(r, `run-${width}`); assert.deepEqual(r.errs, []); await r.ctx.close();

    // /start signed out: a chip opens it; with no area it says how; Use my location finds cafés
    const s = await page(br, { width, geo: { latitude: 40.7295, longitude: -73.9545 } }); await s.goto(srv.base + "/start"); await s.waitForTimeout(800);
    assert.equal(await s.locator("#stPicks").isHidden(), true, "nothing opens by itself on /start");
    await s.click(".chip[data-t=coffee]"); await s.waitForSelector("#stPicks .psg-h"); await s.waitForFunction(() => /Use my location/.test(document.querySelector("#stPicks .psg-empty")?.textContent || ""));
    await s.click("#stPicks [data-psg-mode=here]"); await s.waitForFunction(() => document.querySelectorAll("#stPicks .psg-c:not(.psg-sk)").length >= 3);
    assert.match(await s.locator("#stPicks .psg-l").innerText(), /near you right now/); await shot(s, `start-${width}`);
    await s.click("#stPicks .psg-use >> nth=1"); const placeVal = await s.inputValue("input[name=place]"); assert.ok(/Stub|Café/.test(placeVal), placeVal);
    assert.deepEqual(s.errs, []); await s.ctx.close();
  } finally { await br.close(); }
});
