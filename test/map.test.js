// The map view (/map): where a pin may go (server/geo.js), what may be on a map at all (server/map.js), the filters,
// distances and sheet (public/mapcore.js), the geocoder's cache and pace, the fake geo, the tile-failure fallback
// (public/map.js, public/map.html) and saves on the map.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { placeOf, makeGeocoder, fakeGeo, hoodCentre, approxArea, distanceKm } from "../server/geo.js";
import { mapEligible, catOf, vibeOf, tierOf, tilesConfig, mapCsp } from "../server/map.js";

const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
const browser = (file, extra = {}) => { const box = { window: {}, ...extra }; box.window = box; vm.runInNewContext(read(file), box); return box; };
const K = browser("public/mapcore.js").PLMapCore;
const DAY = 864e5, iso = (t) => new Date(t).toISOString().slice(0, 10);

// ---------------------------------------------------------------- privacy: where a pin goes
test("a home event gets an approximate area, never the address; only a public venue the host marked gets an exact pin", () => {
  const home = { casual: true, hood: "Greenpoint", city: "New York", venueAddr: "214 Milton St, Apt 3", meetPoint: "My apartment" };
  const p = placeOf(home);
  assert.equal(p.exact, false); assert.equal(p.query, "Greenpoint, New York", "the geocoder is only asked about the neighbourhood");
  assert.ok(!/Milton|Apt|apartment/i.test(p.query));
  // marked public but it reads like a home or an address: still an area
  assert.equal(placeOf({ ...home, placePublic: true }).exact, false);
  assert.equal(placeOf({ placePublic: true, meetPoint: "12 Bedford Ave", hood: "Williamsburg", city: "New York" }).exact, false);
  assert.equal(placeOf({ placePublic: true, meetPoint: "Lantern Cafe", approvalRequired: true, hood: "Bushwick", city: "New York" }).exact, false, "ask-to-join keeps where-exactly for guests");
  const venue = placeOf({ placePublic: true, casual: true, meetPoint: "Grand Army Plaza fountain", venueAddr: "hidden for guests", hood: "Park Slope", city: "New York" });
  assert.equal(venue.exact, true); assert.equal(venue.query, "Grand Army Plaza fountain, Park Slope, New York", "a casual event's address stays for guests even when the spot is public");
  assert.equal(placeOf({ meetPoint: "Lantern Cafe", hood: "Bushwick", city: "New York" }).exact, false, "not marked public: an area");
});

test("an area is moved off the centroid by a seeded jitter, rounded to about 100 m, and stable between loads", () => {
  const c = hoodCentre("Williamsburg", "New York"); assert.ok(c);
  const a = approxArea(c.lat, c.lng, "evt1"), b = approxArea(c.lat, c.lng, "evt1"), z = approxArea(c.lat, c.lng, "evt2");
  assert.deepEqual(a, b); assert.notDeepEqual(a, z); assert.equal(a.exact, false); assert.equal(a.r, 600);
  const m = distanceKm(c, a) * 1000; assert.ok(m > 80 && m < 520, `moved ${m} m`);
  assert.equal(a.lat, Math.round(a.lat * 1000) / 1000); assert.equal(a.lng, Math.round(a.lng * 1000) / 1000);
  const G = makeGeocoder({ env: { ENCORE_FAKE_GEO: "1" } });
  const loc = G.locate("evt1", { casual: true, hood: "Williamsburg", city: "New York", venueAddr: "99 Grand St" });
  assert.equal(loc.exact, false); assert.ok(loc.r >= 600);
  assert.ok(G.locate("evt9", { city: "Nowhere-at-all" }) === null || G.locate("evt9", { city: "Nowhere-at-all" }).exact === false);
});

test("what may be on a map: private, unlisted, members-only, members-first, preview, interest and past events are left off", () => {
  const today = "2026-11-26", ok = { discoverable: true, date: "2026-11-28" };
  assert.equal(mapEligible(ok, { today }), true);
  for (const [why, e] of [["private", { ...ok, discoverable: false }], ["unlisted", { ...ok, unlisted: true }], ["example", { ...ok, example: true }], ["cancelled", { ...ok, cancelled: true }],
    ["interest check", { ...ok, stage: "interest" }], ["tentative", { ...ok, tentative: true }], ["preview", { ...ok, preview: true }], ["members", { ...ok, visibility: "members" }], ["past", { ...ok, date: "2026-11-01" }]]) assert.equal(mapEligible(e, { today }), false, why);
  assert.equal(mapEligible(ok, { today, club: { only: true } }), false, "fan club only");
  assert.equal(mapEligible(ok, { today, club: { earlyUntil: Date.now() + DAY } }), false, "members-first window");
  assert.equal(mapEligible({ ...ok, date: "2026-11-01" }, { today, past: true }), true, "Your map may show places you went");
});

test("kinds, vibes and price tiers", () => {
  assert.equal(catOf({ activity: "run club" }), "run"); assert.equal(catOf({ pubTitle: "Board game night" }), "games"); assert.equal(catOf({ pubTitle: "Omakase at home" }), "supper");
  assert.equal(catOf({ drop: true }), "drop"); assert.equal(catOf({ pubTitle: "Winter flea market" }), "market"); assert.equal(catOf({ activity: "zine workshop" }), "workshop");
  assert.equal(vibeOf({ pubTitle: "Karaoke", startTime: "22:00" }), "late"); assert.equal(vibeOf({ activity: "run club" }), "active"); assert.equal(vibeOf({ activity: "book club" }), "nerdy");
  assert.equal(vibeOf({ activity: "apartment café" }), "cozy"); assert.equal(vibeOf({ pubTitle: "Sunday supper" }), "food"); assert.equal(vibeOf({ activity: "pottery workshop" }), "make");
  assert.equal(tierOf({ free: true }), "free"); assert.equal(tierOf({ price: "$12" }), "$"); assert.equal(tierOf({ price: "$45" }), "$$"); assert.equal(tierOf({ price: "$65 a person" }), "$$$"); assert.equal(tierOf({}), "free");
});

// ---------------------------------------------------------------- fake geo and the geocoder
test("fake geo: deterministic coordinates per neighbourhood, no requests", async () => {
  const a = fakeGeo("Williamsburg, New York"), b = fakeGeo("Williamsburg, New York"), c = hoodCentre("Williamsburg", "New York");
  assert.deepEqual(a, b); assert.ok(distanceKm(a, c) < 0.01, "a neighbourhood on its own is its centroid");
  const spot = fakeGeo("Lantern Cafe, Bushwick, New York"); assert.ok(distanceKm(spot, hoodCentre("Bushwick", "New York")) < 0.6, "a place in a neighbourhood lands near it");
  const city = fakeGeo("Somewhere new, Austin"); assert.ok(distanceKm(city, { lat: 30.27, lng: -97.74 }) < 3.5);
  let calls = 0; const G = makeGeocoder({ env: { ENCORE_FAKE_GEO: "1", ENCORE_GEO_PROVIDER: "nominatim" }, fetchImpl: async () => { calls++; return { ok: true, json: async () => [] }; } });
  assert.equal(G.provider, "fake"); assert.deepEqual(await G.geocode("Williamsburg, New York"), a); assert.equal(calls, 0, "fake geo never calls out");
});

test("the geocoder: off by default, cached in the store, one request at a time with a gap, a daily cap, a User-Agent", async () => {
  assert.equal(makeGeocoder({ env: {} }).on, false, "no provider, no requests");
  assert.equal(makeGeocoder({ env: { ENCORE_GEO_PROVIDER: "opencage" } }).on, false, "a keyed provider needs its key");
  const docs = new Map(), store = { get: (k) => (docs.has(k) ? { data: docs.get(k) } : null), set: (k, v) => docs.set(k, v) };
  let t = 1_000_000; const now = () => t, slept = [], sleep = async (ms) => { slept.push(ms); t += ms; };
  const calls = []; const fetchImpl = async (u, o) => { calls.push({ u: String(u), ua: o.headers["User-Agent"], at: t }); t += 5; return { ok: true, json: async () => (String(u).includes("Nowhere") ? [] : [{ lat: "40.7142", lon: "-73.958" }]) }; };
  const env = { ENCORE_GEO_PROVIDER: "nominatim", ENCORE_GEO_GAP_MS: "1100", ENCORE_GEO_PER_DAY: "3", ENCORE_GEO_UA: "ops@example.org" };
  const G = makeGeocoder({ store, env, fetchImpl, now, sleep });
  const [a, b, c] = await Promise.all([G.geocode("Williamsburg, New York"), G.geocode("williamsburg,  new york"), G.geocode("Greenpoint, New York")]);
  assert.deepEqual([a.lat, a.lng], [40.7142, -73.958]); assert.deepEqual(b, a, "the same place (any spacing or case) is asked once");
  assert.equal(calls.length, 2); assert.ok(calls[1].at - calls[0].at >= 1100, "requests keep their gap"); assert.ok(slept.length >= 1);
  assert.match(calls[0].ua, /^PotteryLab\/1\.0 \(event map; ops@example\.org\)$/); assert.match(calls[0].u, /nominatim\.openstreetmap\.org\/search\?q=Williamsburg/);
  assert.equal(docs.size, 2, "answers are kept in the store");
  const G2 = makeGeocoder({ store, env, fetchImpl, now, sleep }); const a2 = await G2.geocode("Williamsburg, New York"); assert.deepEqual([a2.lat, a2.lng], [a.lat, a.lng], "a new process reads the cache"); assert.equal(calls.length, 2);
  assert.equal(await G.geocode("Nowhere, Atlantis"), null); assert.equal(calls.length, 3); assert.equal(await G.geocode("Nowhere, Atlantis"), null); assert.equal(calls.length, 3, "a miss is cached too");
  assert.equal(await G.geocode("Bushwick, New York"), null, "past the daily cap: no request"); assert.equal(calls.length, 3); assert.equal(G.stats.dropped, 1);
  t += 91 * DAY; await G2.geocode("Williamsburg, New York"); assert.ok(calls.length >= 3, "old answers expire");
  // a failed request isn't cached, so the next save can try again
  let fail = true; const G3 = makeGeocoder({ env: { ENCORE_GEO_PROVIDER: "photon", ENCORE_GEO_GAP_MS: "0" }, fetchImpl: async () => { if (fail) throw new Error("offline"); return { ok: true, json: async () => ({ features: [{ geometry: { coordinates: [-73.95, 40.73] } }] }) }; } });
  assert.equal(await G3.geocode("Greenpoint, New York"), null); fail = false; assert.deepEqual(await G3.geocode("Greenpoint, New York"), { lat: 40.73, lng: -73.95, q: "Greenpoint, New York", at: G3.cached("Greenpoint, New York").at });
});

test("a host saving a home event only ever sends the neighbourhood to the geocoder", async () => {
  const asked = []; const G = makeGeocoder({ env: { ENCORE_GEO_PROVIDER: "photon", ENCORE_GEO_GAP_MS: "0" }, fetchImpl: async (u) => { asked.push(decodeURIComponent(new URL(u).searchParams.get("q"))); return { ok: true, json: async () => ({ features: [] }) }; } });
  await G.onEventWrite({ casual: true, venueAddr: "214 Milton St", meetPoint: "my apartment", hood: "Greenpoint", city: "New York" }, {});
  assert.deepEqual(asked, ["Greenpoint, New York"]);
});

// ---------------------------------------------------------------- filters, distances, the sheet
const today = "2026-11-25"; // a Wednesday
const E = [
  { id: "a", date: today, startTime: "20:00", tier: "free", vibe: "late", cat: "games", host: { handle: "kai" }, geo: { lat: 40.70, lng: -73.95 } },
  { id: "b", date: "2026-11-28", startTime: "19:00", tier: "$$", vibe: "food", cat: "supper", host: { handle: "maya" }, geo: { lat: 40.73, lng: -73.95 } },
  { id: "c", date: "2026-12-01", startTime: "08:00", tier: "$", vibe: "active", cat: "run", host: { handle: "theo" }, geo: { lat: 40.67, lng: -73.97 } },
  { id: "d", date: "2026-12-20", startTime: "11:00", tier: "$$$", vibe: "make", cat: "workshop", host: { handle: "omar" }, geo: { lat: 40.68, lng: -74.0 } },
  { id: "p", date: "2026-10-01", past: true, tier: "$", vibe: "active", cat: "run", host: { handle: "claire" }, geo: { lat: 40.71, lng: -73.96 } },
];
const ids = (L) => L.map((e) => e.id).join(",");
test("filters: who, price, vibe, when, category and Your map", () => {
  const f = (o, c = {}) => ids(K.filterEvents(E, { ...K.EMPTY(), ...o }, { today, ...c }));
  assert.equal(f({}), "a,b,c,d", "past places only show on Your map");
  assert.equal(f({ when: "tonight" }), "a"); assert.equal(f({ when: "weekend" }), "b"); assert.equal(f({ when: "week" }), "a,b,c");
  assert.equal(f({ prices: ["free", "$"] }), "a,c"); assert.equal(f({ vibes: ["food", "make"] }), "b,d"); assert.equal(f({ cat: "run" }), "c");
  assert.equal(f({ who: "following" }, { follows: ["maya", "omar"] }), "b,d"); assert.equal(f({ who: "friends" }, { friends: { c: { line: "Ana is in" } } }), "c");
  assert.equal(f({ mine: true }, { saved: ["b"], went: ["p"] }), "b,p", "Your map: what you saved or went to");
  assert.equal(f({ mine: true, vibes: ["active"] }, { saved: ["b"], went: ["p"] }), "p");
  assert.equal(f({ when: "tonight", prices: ["$$"] }), "", "filters add up");
  assert.equal(K.activeCount({ ...K.EMPTY(), when: "week", vibes: ["food"] }), 2);
  assert.deepEqual({ ...K.weekendOf("2026-11-27") }, { from: "2026-11-27", to: "2026-11-29" }); assert.deepEqual({ ...K.weekendOf("2026-11-29") }, { from: "2026-11-29", to: "2026-11-29" });
  assert.equal(ids(K.sortEvents(E.slice(0, 4), { lat: 40.731, lng: -73.951 })), "b,a,c,d", "nearest first once we know where you are");
  assert.equal(ids(K.sortEvents(E.slice(0, 4), null)), "a,b,c,d", "else soonest");
  assert.equal(K.proofLine({ going: 12, saves: 3 }), "12 going"); assert.equal(K.proofLine({ going: 0, saves: 27 }), "Saved 27 times"); assert.equal(K.proofLine({ going: 0, saves: 1 }), "Saved 1 time");
  assert.equal(K.proofLine({ going: 3 }, { line: "Priya is in" }), "Priya is in"); assert.equal(K.proofLine({}), "");
  assert.deepEqual([...K.groupByHood([{ id: 1, hood: "Bushwick" }, { id: 2 }, { id: 3, hood: "Greenpoint" }, { id: 4, hood: "Greenpoint" }]).map((g) => g.hood)], ["Greenpoint", "Bushwick", "Around town"]);
});

test("distances read the way people say them: km, or miles by locale", () => {
  assert.equal(K.formatDistance(1.234, "en-AU"), "1.2 km"); assert.equal(K.formatDistance(0.33, "fr-FR"), "350 m"); assert.equal(K.formatDistance(0.01, "en"), "50 m");
  assert.equal(K.formatDistance(14.6, "de-DE"), "15 km"); assert.equal(K.formatDistance(1.25, "de-DE"), "1,3 km", "the locale's decimal mark");
  assert.equal(K.formatDistance(1.931, "en-US"), "1.2 mi"); assert.equal(K.formatDistance(0.05, "en-US"), "0.1 mi"); assert.equal(K.formatDistance(20, "en-GB"), "12 mi");
  assert.equal(K.formatDistance(null, "en-US"), ""); assert.equal(K.formatDistance(NaN), "");
  assert.ok(Math.abs(K.distanceKm({ lat: 40.7142, lng: -73.958 }, { lat: 40.7297, lng: -73.954 }) - 1.75) < 0.1);
  assert.equal(K.whenLabel(today, "20:00", today), "Tonight, 8 pm"); assert.equal(K.whenLabel("2026-11-26", "09:30", today), "Tomorrow, 9:30 am"); assert.equal(K.whenLabel("2026-11-28", "", today), "Sat"); assert.equal(K.whenLabel("2026-12-20", "", today), "Dec 20");
});

test("the sheet snaps to peek, half and full, and a flick moves it one step", () => {
  const H = K.snapHeights(844); assert.ok(H.peek < H.half && H.half < H.full); assert.equal(H.full, 780);
  assert.equal(K.snapTo(H.peek + 20, 0, H), "peek"); assert.equal(K.snapTo(H.half - 30, 0, H), "half"); assert.equal(K.snapTo(H.full - 10, 0, H), "full");
  assert.equal(K.snapTo(H.peek + 20, 1, H), "half", "a flick up from peek opens half"); assert.equal(K.snapTo(H.half + 20, -1, H), "half", "a flick down from just above half settles on half");
  assert.equal(K.snapTo(H.half - 20, -1, H), "peek");
  const S = K.spread([{ id: "x", geo: { lat: 40.7, lng: -73.9 } }, { id: "y", geo: { lat: 40.7001, lng: -73.9 } }, { id: "z", geo: { lat: 40.8, lng: -73.9 } }]);
  assert.ok(distanceKm(S.x, S.y) > 0.2, "pins on one spot fan out"); assert.deepEqual({ ...S.z }, { lat: 40.8, lng: -73.9 }, "a pin on its own stays put");
});

// ---------------------------------------------------------------- the map component: tiles that don't load
test("the shared map gives up and the page shows its list when tiles fail, time out, or are switched off", async () => {
  const ev = () => { const h = {}; return { on: (k, f) => ((h[k] ||= []).push(f)), fire: (k, e) => (h[k] || []).forEach((f) => f(e)) }; };
  const M = browser("public/map.js", { setTimeout, clearTimeout }).PLMap;
  { const m = ev(); let why = null, ok = false; M.watchTiles(m, { timeoutMs: 1000, onFail: (w) => (why = w), onReady: () => (ok = true) }); m.fire("error", { error: { message: "Failed to fetch" } }); m.fire("idle"); assert.equal(why, "Failed to fetch"); assert.equal(ok, false, "only one answer"); }
  { const m = ev(); let why = null; M.watchTiles(m, { timeoutMs: 20, onFail: (w) => (why = w) }); await new Promise((r) => setTimeout(r, 40)); assert.equal(why, "timeout"); }
  { const m = ev(); let ok = false, why = null; M.watchTiles(m, { timeoutMs: 1000, onReady: () => (ok = true), onFail: (w) => (why = w) }); m.fire("sourcedata", { tile: {}, isSourceLoaded: true }); m.fire("idle"); m.fire("error", {}); assert.equal(ok, true); assert.equal(why, null, "a later error doesn't take the map away"); }
  await assert.rejects(M.mount({}, { tiles: { kind: "off" } }), /tiles off/);
  const st = M.fieldNotesStyle({}); assert.equal(st.layers[0].paint["background-color"], "#EFEBE2", "linen land"); assert.match(JSON.stringify(st.sources), /OpenStreetMap/, "attribution travels with the tiles");
  assert.match(M.LIB.js, /maplibre-gl@\d+\.\d+\.\d+\//, "a pinned version"); assert.match(M.LIB.jsHash, /^sha384-/, "with its hash");
  const page = read("public/map.html");
  assert.match(page, /catch \(e\) \{ return noMap\(e\?\.message\); \}/, "a failed mount shows the list");
  assert.match(page, /The map didn't load, so here's everything by neighbourhood\./); assert.match(page, /K\.groupByHood\(L\)/);
  assert.equal(tilesConfig({ ENCORE_MAP_TILES: "off" }).kind, "off"); assert.equal(tilesConfig({}).kind, "openfreemap");
  assert.match(mapCsp({}), /connect-src 'self'[^;]*https:\/\/tiles\.openfreemap\.org/); assert.match(mapCsp({}), /worker-src 'self' blob:/); assert.match(mapCsp({}), /script-src 'self' 'unsafe-inline' https:\/\/unpkg\.com/);
});

test("the map's files read plainly and keep to the brand: no em dashes, no emoji pins, light only", () => {
  for (const f of ["public/map.html", "public/map.js", "public/mapcore.js", "public/pins.js", "server/geo.js", "server/map.js"]) { const s = read(f); assert.ok(!s.includes("—"), f + " has no em dash"); assert.ok(!/prefers-color-scheme:\s*dark/.test(s), f + " is light only"); }
  const pins = browser("public/pins.js", { PLMapCore: K }).PLPins;
  assert.deepEqual([...pins.OBJ], ["cozy", "nerdy", "active", "food", "make", "late"]); assert.deepEqual([...pins.CATS], ["supper", "games", "run", "workshop", "drop", "market"]);
  assert.match(pins.pin({ vibe: "late" }, { exact: true, saved: true }), /plpin--exact is-saved/); assert.match(pins.pin({ vibe: "cozy" }, {}), /plpin--area/);
  assert.match(read("public/discover.html"), /<a href="\/map" id="mapLink">/, "Discover has the Map toggle beside the list");
});

// ---------------------------------------------------------------- through the server
let srv;
const J = { "content-type": "application/json" };
const post = (p, body, cookie, method = "POST") => fetch(srv.base + p, { method, headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body || {}) });
const getJ = async (p, cookie) => { const r = await fetch(srv.base + p, { headers: cookie ? { cookie } : {} }); return { status: r.status, body: await r.json().catch(() => null), headers: r.headers }; };
const put = (path, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
let n = 0;
const person = async (name) => { const email = `${name.toLowerCase().replace(/\W+/g, "")}${++n}@example.com`; const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); const b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); return { cookie: cookieOf(r), ws: b.workspace.id, email, name }; };
const host = async (name, handle, o = {}) => { const h = await person(name); const r = await post("/api/host/profile", { handle, name, city: "New York", bio: "Small nights for people who like a quiet table.", emoji: "🎲", ...o }, h.cookie); assert.equal(r.status, 200, await r.text()); return { ...h, handle }; };
const day = (k) => iso(Date.now() + k * DAY);

before(async () => { process.env.ENCORE_FAKE_GEO = "1"; srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "map-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "500"; process.env.ENCORE_FAKE_EMAIL = "1"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL", "ENCORE_FAKE_GEO"]) delete process.env[k]; await srv.close(); });

test("the map API: home events as areas with no address in the payload, public venues exact, excluded kinds left off, saves counted", async () => {
  const maya = await host("Maya Okafor", "map-mayas-table", { hood: "Greenpoint" }), kai = await host("Kai Brenner", "map-meeple-hall", { hood: "Bushwick" });
  const base = { kind: "social", casual: true, discoverable: true, published: true, city: "New York", createdAt: Date.now() };
  for (const [who, id, e] of [
    [maya, "mapHome", { name: "Sunday supper", pubTitle: "Sunday supper", date: day(2), startTime: "19:00", hood: "Greenpoint", price: "$45", venueAddr: "214 Milton St, Apt 3", meetPoint: "My apartment, 214 Milton St" }],
    [kai, "mapCafe", { name: "Board game night", pubTitle: "Quiet board game night", date: day(1), startTime: "19:30", hood: "Bushwick", free: true, meetPoint: "Lantern Cafe", placePublic: true }],
    [maya, "mapAsk", { name: "Dinner, ask to join", pubTitle: "Dinner, ask to join", date: day(3), hood: "Greenpoint", approvalRequired: true, meetPoint: "Lantern Cafe", placePublic: true }],
    [maya, "mapPriv", { name: "Private family dinner", date: day(2), discoverable: false, hood: "Greenpoint" }],
    [maya, "mapUnl", { name: "Unlisted thing", date: day(2), unlisted: true, hood: "Greenpoint" }],
    [kai, "mapIdea", { name: "Hike idea", pubTitle: "Hike idea", date: day(5), stage: "interest", hood: "Bushwick" }],
    [kai, "mapPast", { name: "Last month's game night", pubTitle: "Last month's game night", date: day(-20), hood: "Bushwick", meetPoint: "Lantern Cafe", placePublic: true }],
  ]) { const r = await put("events/" + id, { ...base, ...e }, who.cookie); assert.equal(r.status, 200, await r.text()); }
  // members-only: the fan club marks it (server/fanclub.js keeps the doc in the host's workspace)
  srv.store.set(`ws/${kai.ws}/clubevents/mapCafe2`, { only: true }); await put("events/mapCafe2", { ...base, name: "Members night", pubTitle: "Members night", date: day(2), hood: "Bushwick" }, kai.cookie);
  const fan = await person("Ada Moss"); assert.equal((await post("/api/me/saves", { kind: "event", ref: "mapCafe", title: "Quiet board game night" }, fan.cookie)).status, 200);

  const r = await getJ("/api/public/map?city=New%20York"), L = r.body.events, raw = JSON.stringify(r.body);
  assert.equal(r.status, 200); assert.equal(r.body.city, "New York");
  const by = Object.fromEntries(L.map((e) => [e.id, e]));
  assert.ok(by.mapHome && by.mapCafe && by.mapAsk, "listed events are on the map");
  for (const id of ["mapPriv", "mapUnl", "mapIdea", "mapPast", "mapCafe2"]) assert.ok(!by[id], id + " is left off");
  assert.ok(!/Milton|Apt 3|apartment/i.test(raw), "no address or home words anywhere in the payload");
  assert.equal(by.mapHome.geo.exact, false); assert.ok(by.mapHome.geo.r >= 600); assert.equal(by.mapHome.place, undefined);
  assert.ok(distanceKm(by.mapHome.geo, hoodCentre("Greenpoint", "New York")) < 0.6, "the area is around the neighbourhood");
  assert.equal(by.mapCafe.geo.exact, true); assert.equal(by.mapCafe.place, "Lantern Cafe"); assert.equal(by.mapAsk.geo.exact, false, "ask-to-join: an area even when marked public");
  for (const e of L) for (const k of ["venueAddr", "meetPoint", "venueName", "email", "guests"]) assert.ok(!(k in e), `${e.id} has no ${k}`);
  assert.equal(by.mapCafe.saves, 1, "saves counted from accounts"); assert.equal(by.mapCafe.vibe, "nerdy"); assert.equal(by.mapCafe.cat, "games"); assert.equal(by.mapHome.tier, "$$");
  assert.equal(by.mapHome.host.name, "Maya Okafor"); assert.equal(by.mapHome.url, "/e/mapHome");
  // Your map: saved or past places by id, same rules
  const P = (await getJ("/api/public/map/places?ids=mapPast,mapPriv,mapCafe2,mapHome")).body.events.map((e) => e.id).sort();
  assert.deepEqual(P, ["mapHome", "mapPast"]);
  assert.deepEqual((await getJ("/api/me/map")).body, { signedIn: false, follows: [], friends: {}, went: [] });
  const me = (await getJ("/api/me/map?ids=mapCafe", fan.cookie)).body; assert.equal(me.signedIn, true); assert.ok(Array.isArray(me.follows) && Array.isArray(me.went));
  // the page and its own CSP (MapLibre, its workers and the tiles)
  const page = await fetch(srv.base + "/map"); assert.equal(page.status, 200); assert.match(await page.text(), /Your city, drawn by hand|PLPins\.intro/);
  assert.match(page.headers.get("content-security-policy") || "", /tiles\.openfreemap\.org/);
});
