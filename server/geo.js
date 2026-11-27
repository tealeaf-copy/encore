// Geodata for the map (public/map.html, server/map.js): where an event sits on a map, without ever giving away a home.
//
// The rules, in one place (test/map.test.js holds them):
// - Exact spots only for a place the host marked public (event.placePublic === true) on an open event: a park, a cafe,
//   a shop. Even then the map gets a point, never the street address text.
// - Everything else (homes, ask-to-join events, any place name that reads like an address) gets an approximate area:
//   the neighbourhood centroid, moved a little by a jitter seeded from the event id (so it never lands on the house and
//   never moves between loads), rounded to about 100 m, drawn as a soft circle. The geocoder is only ever asked about
//   "neighbourhood, city" for these, so a home address never leaves the server.
// - The geocoder: off unless ENCORE_GEO_PROVIDER is set ("nominatim", "photon", or "opencage" with ENCORE_GEO_KEY).
//   Answers are cached in the store (system/plgeo-<hash>) for 90 days (misses for 7), requests go one at a time with a
//   gap (1.1 s by default, Nominatim's policy is at most 1 a second) and a daily cap (ENCORE_GEO_PER_DAY, default 2000),
//   with a User-Agent that names the app (ENCORE_GEO_UA to add a contact). ENCORE_FAKE_GEO=1 (tests, smoke runs) answers
//   from the centroid table below with deterministic offsets and makes no requests.
// - When nothing is known, the neighbourhood centroid table, then the city centre (public/place.js) stand in.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const norm = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const h32 = (s) => crypto.createHash("sha256").update(String(s)).digest().readUInt32BE(0);
const DAY = 864e5;

// ---- cities: the same list the app uses for "where are you" (public/place.js), read once ----
let PLACE = null;
function place() { if (PLACE) return PLACE; try { const box = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(here, "..", "public", "place.js"), "utf8"), box, { timeout: 500 }); PLACE = box.window.EncorePlace || null; } catch { PLACE = null; } return PLACE || { CITIES: [], find: () => null }; }
/** The centre of a city we know ({ name, lat, lng }), or null. */
export function cityCentre(city) { try { const c = place().find(String(city || "")); return c ? { name: c[0], lat: c[1], lng: c[2] } : null; } catch { return null; } }

// ---- neighbourhood centroids: the common ones, so most events have a sensible area with no geocoder at all ----
// [city, neighbourhood, lat, lng]. Approximate centres, good to a few hundred metres, which is all an area needs.
const HOOD_ROWS = [
  // New York
  ["New York", "Williamsburg", 40.7142, -73.9580], ["New York", "Greenpoint", 40.7297, -73.9540], ["New York", "Bushwick", 40.6950, -73.9180],
  ["New York", "Bed-Stuy", 40.6872, -73.9418], ["New York", "Bedford-Stuyvesant", 40.6872, -73.9418], ["New York", "Park Slope", 40.6710, -73.9814],
  ["New York", "Crown Heights", 40.6694, -73.9422], ["New York", "Prospect Heights", 40.6775, -73.9692], ["New York", "Fort Greene", 40.6892, -73.9742],
  ["New York", "Clinton Hill", 40.6896, -73.9661], ["New York", "DUMBO", 40.7033, -73.9881], ["New York", "Brooklyn Heights", 40.6960, -73.9933],
  ["New York", "Red Hook", 40.6756, -74.0095], ["New York", "Gowanus", 40.6733, -73.9897], ["New York", "Carroll Gardens", 40.6795, -73.9991],
  ["New York", "Cobble Hill", 40.6866, -73.9962], ["New York", "Sunset Park", 40.6455, -74.0124], ["New York", "Ridgewood", 40.7043, -73.9018],
  ["New York", "Long Island City", 40.7447, -73.9485], ["New York", "Astoria", 40.7644, -73.9235], ["New York", "Sunnyside", 40.7433, -73.9196],
  ["New York", "Jackson Heights", 40.7557, -73.8831], ["New York", "Lower East Side", 40.7150, -73.9843], ["New York", "East Village", 40.7265, -73.9815],
  ["New York", "West Village", 40.7358, -74.0036], ["New York", "Greenwich Village", 40.7336, -73.9990], ["New York", "Chinatown", 40.7158, -73.9970],
  ["New York", "SoHo", 40.7233, -74.0030], ["New York", "Tribeca", 40.7163, -74.0086], ["New York", "Financial District", 40.7075, -74.0113],
  ["New York", "Chelsea", 40.7465, -74.0014], ["New York", "Flatiron", 40.7410, -73.9897], ["New York", "Midtown", 40.7549, -73.9840],
  ["New York", "Hell's Kitchen", 40.7638, -73.9918], ["New York", "Upper West Side", 40.7870, -73.9754], ["New York", "Upper East Side", 40.7736, -73.9566],
  ["New York", "Harlem", 40.8116, -73.9465], ["New York", "Washington Heights", 40.8417, -73.9394], ["New York", "Flatbush", 40.6409, -73.9624],
  // the parks and spots the New York run templates meet at (public/runtemplates.js)
  ["New York", "Central Park", 40.7829, -73.9654], ["New York", "Carnegie Hill", 40.7845, -73.9550], ["New York", "Yorkville", 40.7762, -73.9492],
  ["New York", "Columbus Circle", 40.7681, -73.9819], ["New York", "Civic Center", 40.7134, -74.0034], ["New York", "Prospect Park", 40.6602, -73.9690],
  ["New York", "Van Cortlandt Park", 40.8972, -73.8861], ["New York", "Astoria Park", 40.7794, -73.9223], ["New York", "McCarren Park", 40.7206, -73.9516],
  // San Francisco and the Bay
  ["San Francisco", "Mission", 37.7599, -122.4148], ["San Francisco", "Mission District", 37.7599, -122.4148], ["San Francisco", "SoMa", 37.7785, -122.4056],
  ["San Francisco", "Hayes Valley", 37.7759, -122.4245], ["San Francisco", "Noe Valley", 37.7502, -122.4337], ["San Francisco", "Castro", 37.7609, -122.4350],
  ["San Francisco", "Inner Richmond", 37.7802, -122.4645], ["San Francisco", "Inner Sunset", 37.7602, -122.4677], ["San Francisco", "North Beach", 37.8061, -122.4103],
  ["San Francisco", "Dogpatch", 37.7609, -122.3888], ["San Francisco", "Bernal Heights", 37.7389, -122.4152], ["San Francisco", "Lower Haight", 37.7717, -122.4310],
  ["San Francisco", "Oakland", 37.8044, -122.2712], ["San Francisco", "Berkeley", 37.8715, -122.2730],
  // Los Angeles
  ["Los Angeles", "Silver Lake", 34.0869, -118.2702], ["Los Angeles", "Echo Park", 34.0782, -118.2606], ["Los Angeles", "Los Feliz", 34.1063, -118.2848],
  ["Los Angeles", "Highland Park", 34.1115, -118.1923], ["Los Angeles", "Venice", 33.9850, -118.4695], ["Los Angeles", "Santa Monica", 34.0195, -118.4912],
  ["Los Angeles", "Koreatown", 34.0618, -118.3004], ["Los Angeles", "Arts District", 34.0403, -118.2352], ["Los Angeles", "West Hollywood", 34.0900, -118.3617],
  // London
  ["London", "Shoreditch", 51.5265, -0.0780], ["London", "Hackney", 51.5450, -0.0553], ["London", "Dalston", 51.5465, -0.0750], ["London", "Peckham", 51.4740, -0.0690],
  ["London", "Brixton", 51.4613, -0.1156], ["London", "Camden", 51.5390, -0.1426], ["London", "Islington", 51.5362, -0.1033], ["London", "Bermondsey", 51.4979, -0.0637],
  ["London", "Soho", 51.5136, -0.1365], ["London", "Clapham", 51.4618, -0.1384],
  // Sydney
  ["Sydney", "Surry Hills", -33.8861, 151.2111], ["Sydney", "Newtown", -33.8981, 151.1749], ["Sydney", "Redfern", -33.8928, 151.2048], ["Sydney", "Bondi", -33.8915, 151.2767],
  ["Sydney", "Marrickville", -33.9110, 151.1550], ["Sydney", "Glebe", -33.8798, 151.1857], ["Sydney", "Darlinghurst", -33.8790, 151.2190],
  // a few more cities hosts are in
  ["Chicago", "Logan Square", 41.9231, -87.7093], ["Chicago", "Wicker Park", 41.9088, -87.6796], ["Chicago", "Pilsen", 41.8565, -87.6564], ["Chicago", "Hyde Park", 41.7943, -87.5907],
  ["Seattle", "Capitol Hill", 47.6253, -122.3222], ["Seattle", "Ballard", 47.6687, -122.3842], ["Seattle", "Fremont", 47.6505, -122.3493],
  ["Austin", "East Austin", 30.2640, -97.7220], ["Austin", "South Congress", 30.2470, -97.7510], ["Austin", "Hyde Park", 30.3060, -97.7290],
  ["Toronto", "Kensington Market", 43.6547, -79.4005], ["Toronto", "Queen West", 43.6476, -79.4078], ["Toronto", "Leslieville", 43.6626, -79.3326],
  ["Berlin", "Kreuzberg", 52.4986, 13.4033], ["Berlin", "Neukölln", 52.4811, 13.4350], ["Berlin", "Mitte", 52.5200, 13.4050], ["Berlin", "Prenzlauer Berg", 52.5390, 13.4246],
];
export const HOODS = new Map(HOOD_ROWS.map(([city, hood, lat, lng]) => [norm(hood) + "|" + norm(city), { city, hood, lat, lng }]));
const HOOD_BY_NAME = new Map(); for (const r of HOODS.values()) { const k = norm(r.hood); if (!HOOD_BY_NAME.has(k)) HOOD_BY_NAME.set(k, r); }
/** A neighbourhood's centre from the table ({ lat, lng, hood, city }), or null. The city helps where names repeat. */
export function hoodCentre(hood, city = "") { const h = norm(hood); if (!h) return null; const c = cityCentre(city)?.name || city;
  return HOODS.get(h + "|" + norm(c)) || (!c ? HOOD_BY_NAME.get(h) : (() => { const r = HOOD_BY_NAME.get(h); return r && cityCentre(r.city)?.name === cityCentre(c)?.name ? r : null; })()) || null; }
/** The neighbourhoods we know in a city, for the map's fallback list. */
export const hoodsIn = (city) => { const c = cityCentre(city)?.name; return c ? [...HOODS.values()].filter((r) => r.city === c) : []; };

// ---- small geometry ----
const R_EARTH = 6371.0088;
export function distanceKm(a, b) { const r = (x) => (x * Math.PI) / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2; return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h))); }
/** Move a point by metres along a bearing (degrees). */
export function offset(lat, lng, metres, bearing) { const d = metres / 1000 / R_EARTH, t = (bearing * Math.PI) / 180, p1 = (lat * Math.PI) / 180, l1 = (lng * Math.PI) / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t)), l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: (p2 * 180) / Math.PI, lng: (((l2 * 180) / Math.PI + 540) % 360) - 180 }; }
const round = (x, n = 3) => Math.round(x * 10 ** n) / 10 ** n;
/** An approximate area for a point: moved 150 to 450 m on a bearing seeded by `seed`, rounded to 3 decimals (about 100 m). */
export function approxArea(lat, lng, seed, { radius = 600 } = {}) { const h = h32("area|" + seed), m = 150 + (h % 300), b = (h >>> 9) % 360, p = offset(lat, lng, m, b);
  return { lat: round(p.lat), lng: round(p.lng), exact: false, r: radius }; }

// ---- fake geo: deterministic coordinates for tests and smoke runs (ENCORE_FAKE_GEO=1) ----
/** "Williamsburg, New York" -> near the Williamsburg centroid; an unknown place in a known city -> within 3 km of its
 * centre; anything else -> a stable point from the text. Always the same answer for the same text. */
export function fakeGeo(q) { const parts = String(q || "").split(",").map((s) => s.trim()).filter(Boolean), h = h32("fake|" + norm(q));
  for (let i = 0; i < parts.length; i++) { const c = hoodCentre(parts[i], parts.slice(i + 1).join(", ")); if (c) { const p = i === 0 && parts.length <= 2 ? c : offset(c.lat, c.lng, 80 + (h % 420), (h >>> 8) % 360); return { lat: round(p.lat, 5), lng: round(p.lng, 5), fake: true }; } }
  for (let i = parts.length - 1; i >= 0; i--) { const c = cityCentre(parts[i]); if (c) { const p = offset(c.lat, c.lng, 400 + (h % 2600), (h >>> 8) % 360); return { lat: round(p.lat, 5), lng: round(p.lng, 5), fake: true }; } }
  if (!parts.length) return null; return { lat: round(((h % 12000) / 100) - 60, 5), lng: round((((h >>> 12) % 36000) / 100) - 180, 5), fake: true }; }

// ---- what to place, and how exactly (the privacy rule) ----
// a copy of server/app.js looksLikeAddress (importing it here would be a cycle): street numbers, flats, "my place"
const looksLikeAddress = (t) => { const x = String(t || ""); return /\b\d{1,6}[a-z]?\s+[A-Za-zÀ-ÿ'.-]+(\s+[A-Za-zÀ-ÿ'.-]+){0,3}\s+(st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|pl|place|way|ct|court|ter|terrace|pkwy|parkway|hwy|sq|square)\b\.?/i.test(x) || /\b(apt|apartment|unit|suite|flat|floor)\s*#?\s*\w+|#\s*\d+|\b(my|our)\s+(place|apartment|flat|house|home|backyard|rooftop|loft|kitchen|stoop|porch|yard|garden|studio)\b|['’]s\s+(place|apartment|flat|house|home|kitchen|stoop|porch|backyard|rooftop|loft)\b/i.test(x); };
const sameCity = (a, b) => { const k = (v) => String(v || "").split(",")[0].trim().toLowerCase(); return !k(a) || k(a) === k(b); };
/** How an event goes on the map: { exact, query, hood, city }. exact only for a public venue the host marked public. */
export function placeOf(e = {}, host = {}) {
  const city = String(e.city || host?.city || "").trim(), hood = String(e.hood || (host?.hood && sameCity(e.city, host?.city) ? host.hood : "") || "").trim();
  const venue = String(e.venueName || e.meetPoint || "").trim();
  const exact = e.placePublic === true && !e.approvalRequired && !!venue && !looksLikeAddress(venue) && !looksLikeAddress(e.meetPoint) && !/\b(home|house|apartment|flat)\b/i.test(venue);
  // a venue's own street address is public on a non-casual invite, and finds it best; a casual one keeps it for guests
  if (exact) return { exact: true, query: [(!e.casual && String(e.venueAddr || "").trim()) || venue, hood, city].filter(Boolean).join(", "), hood, city };
  return { exact: false, query: [hood, city].filter(Boolean).join(", "), hood, city };
}

// ---- the geocoder: cached, one request at a time, a daily cap, off unless a provider is set ----
const PROVIDERS = {
  nominatim: { url: "https://nominatim.openstreetmap.org/search", build: (u, q) => { u.searchParams.set("q", q); u.searchParams.set("format", "jsonv2"); u.searchParams.set("limit", "1"); }, parse: (j) => (Array.isArray(j) && j[0] ? { lat: +j[0].lat, lng: +j[0].lon } : null) },
  photon: { url: "https://photon.komoot.io/api/", build: (u, q) => { u.searchParams.set("q", q); u.searchParams.set("limit", "1"); }, parse: (j) => { const c = j?.features?.[0]?.geometry?.coordinates; return c ? { lat: +c[1], lng: +c[0] } : null; } },
  opencage: { url: "https://api.opencagedata.com/geocode/v1/json", key: true, build: (u, q, key) => { u.searchParams.set("q", q); u.searchParams.set("limit", "1"); u.searchParams.set("no_annotations", "1"); u.searchParams.set("key", key); }, parse: (j) => { const g = j?.results?.[0]?.geometry; return g ? { lat: +g.lat, lng: +g.lng } : null; } },
};
export function makeGeocoder({ store = null, env = process.env, fetchImpl = (...a) => fetch(...a), now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const fake = env.ENCORE_FAKE_GEO === "1", name = String(env.ENCORE_GEO_PROVIDER || "off").toLowerCase(), P = PROVIDERS[name], key = String(env.ENCORE_GEO_KEY || "");
  const on = !fake && !!P && (!P.key || !!key), gap = Math.max(0, Number(env.ENCORE_GEO_GAP_MS ?? 1100)), perDay = Math.max(0, Number(env.ENCORE_GEO_PER_DAY ?? 2000));
  const ua = `PotteryLab/1.0 (event map${env.ENCORE_GEO_UA ? "; " + String(env.ENCORE_GEO_UA).slice(0, 120) : ""})`;
  const mem = new Map(), docOf = (q) => "system/plgeo-" + crypto.createHash("sha256").update(norm(q)).digest("hex").slice(0, 24);
  const fresh = (v) => v && now() - (v.at || 0) < (v.miss ? 7 : 90) * DAY;
  const stats = { requests: 0, hits: 0, misses: 0, dropped: 0 };
  let last = -Infinity, chain = Promise.resolve(), queued = 0, day = "", today = 0; const inflight = new Map();
  /** What we already know about a place (no request): { lat, lng } , { miss: true }, or null. */
  function cached(q) { const k = norm(q); if (!k) return null; if (fake) return fakeGeo(q); const m = mem.get(k); if (fresh(m)) return m;
    const d = store?.get?.(docOf(q))?.data; if (fresh(d)) { mem.set(k, d); return d; } return null; }
  const remember = (q, v) => { const k = norm(q), rec = { ...v, q: String(q).slice(0, 200), at: now() }; if (mem.size > 5000) mem.clear(); mem.set(k, rec); try { store?.set?.(docOf(q), { kind: "plgeo", ...rec }); } catch {} return rec; };
  async function ask(q) { const d = new Date(now()).toISOString().slice(0, 10); if (d !== day) { day = d; today = 0; }
    if (today >= perDay) { stats.dropped++; return null; } today++;
    const wait = last + gap - now(); if (wait > 0) await sleep(wait); last = now(); stats.requests++;
    try { const u = new URL(env.ENCORE_GEO_URL || P.url); P.build(u, q, key); const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 5000);
      const r = await fetchImpl(u, { signal: ctl.signal, headers: { "User-Agent": ua, "Accept-Language": "en" } }); clearTimeout(t); if (!r.ok) throw new Error("geo " + r.status);
      const p = P.parse(await r.json()); if (p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180) { stats.hits++; return remember(q, { lat: round(p.lat, 5), lng: round(p.lng, 5) }); }
      stats.misses++; return remember(q, { miss: true }); }
    catch { stats.misses++; return null; } } // a network failure isn't cached: the next save can try again
  /** Look a place up: the cache first, then (when a provider is set) one request in the queue. Resolves to a point or null. */
  function geocode(q) { const k = norm(q); if (!k) return Promise.resolve(null); const c = cached(q); if (c) return Promise.resolve(c.miss ? null : c);
    if (!on) return Promise.resolve(null); if (inflight.has(k)) return inflight.get(k);
    if (queued >= 200) { stats.dropped++; return Promise.resolve(null); } queued++;
    const p = (chain = chain.then(() => ask(q)).catch(() => null)).then((v) => { queued--; inflight.delete(k); return v && !v.miss ? v : null; }); inflight.set(k, p); return p; }
  /** Where an event goes now, with no waiting: { lat, lng, exact, r } or null. Starts a lookup in the background when one would help. */
  function locate(id, e, host) { const pl = placeOf(e, host); let hit = pl.query ? cached(pl.query) : null;
    if (!hit && pl.query && on) geocode(pl.query).catch(() => {});
    if (hit?.miss) hit = null;
    if (pl.exact && hit) return { lat: round(hit.lat, 5), lng: round(hit.lng, 5), exact: true };
    // an area: the neighbourhood (cached, or the table), else the city centre; jittered either way
    const areaQ = [pl.hood, pl.city].filter(Boolean).join(", "), a = (!pl.exact ? hit : null) || (areaQ ? cached(areaQ) : null), base = (a && !a.miss ? a : null) || hoodCentre(pl.hood, pl.city) || cityCentre(pl.city);
    if (!base) return null; return approxArea(base.lat, base.lng, id, { radius: hoodCentre(pl.hood, pl.city) || (a && !a.miss) ? 600 : 1400 }); }
  /** When a host saves an event: look up its place (only "neighbourhood, city" unless the place is marked public). */
  function onEventWrite(e, host) { if (!e || !on) return null; const pl = placeOf(e, host); const out = []; if (pl.query) out.push(geocode(pl.query)); const areaQ = [pl.hood, pl.city].filter(Boolean).join(", "); if (pl.exact && areaQ) out.push(geocode(areaQ)); return Promise.all(out).catch(() => null); }
  return { on, fake, provider: on ? name : fake ? "fake" : "off", userAgent: ua, cached, geocode, locate, onEventWrite, stats, placeOf };
}
