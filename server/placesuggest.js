// Potto's picks on the server: places that fit what someone is planning, near where it makes sense
// (public/placesuggest.js draws them in the create canvas and on /start).
//
// Routes:
//   POST /api/place-suggest { intent, text, kind, n, birthday, mode, place, hood, city, lat, lng, with, guests, section }
//     -> { intent, where: { mode, line, city }, modes: [{ id, label }], sections: [{ id, title, items }], attribution, pending }
//     mode: "auto" (home area, then the event's place, then the page city), "home", "event", "city", "middle", "here".
//     pending: the places provider is still answering; ask again in a second (the answer is cached by then).
//   GET /api/public/place-suggest/meta -> { provider, sections: { run: [{ id, title }] } }, the extra sections providers add.
//   GET, POST, DELETE /api/me/home-area { area, city, share } : the person's home area, private (Settings).
//
// Where the places come from, in this order, and how each is labelled (never "popular" without numbers behind it):
//   1. Pottery Lab: places hosts marked public (placePublic) on events anyone could find on Discover, by real accounts.
//      Ranked by verified "Would go again", repeat use and how recent. "Loved on Pottery Lab" when it earned it (2+ hosts,
//      2+ events this month, or 3+ verified kudos with 80% would go again); otherwise "Hosted on Pottery Lab".
//   2. A places provider. With ENCORE_PLACES_KEY: Google Places (searchNearby, or searchText for a board-game café or a
//      studio), rating, review count and open now, labelled "Popular on Google" (4.4+, 500+ reviews), "Well rated"
//      (4.3+, 50+) or "Nearby". Held in memory for ENCORE_PLACES_CACHE_MIN minutes (default 30), never written to disk.
//      Without a key: OpenStreetMap through Overpass, one request at a time with a gap, a daily cap and a user agent that
//      names the app, cached 7 days. Labelled "Nearby" and credited "© OpenStreetMap contributors". No ratings.
//   Names, addresses, ratings and counts come only from data. The words around them are fixed lines, in Potto's voice.
//
// Privacy: the home area is only ever read for its owner, and never sent to the browser as a point. A provider gets the
// centre rounded to about 500 m. "Somewhere in the middle" uses only mutual friends who turned on sharing, averages
// their areas with the host's, snaps the result to about 1 km and names only the nearest neighbourhood; no friend's
// name, area or point is in any answer, only how many shared. "Use my location" is rounded to about 100 m, never stored.
// Limits: ENCORE_PLACE_IDEAS_PER_HOUR (default 240) and 40 a minute per person, half per address signed out.
//
// Other providers plug in: app.locals.placeSuggest.register(kind, { id, title, load(ctx) }) adds a section for an
// intent. ctx = { intent, n, text, center: { lat, lng }, radius, city, mode, signal }; load returns { items, attribution }.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { cityCentre, hoodCentre, hoodsIn, distanceKm, placeOf } from "./geo.js";
import { countsPublicly } from "./trends.js";
import { getWorkspace, getDbUser, DEFAULT_WS } from "./workspaces.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DAY = 864e5;
const lc = (s) => String(s || "").trim().toLowerCase();
const clean = (v, n = 120) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\u2014/g, ", ").replace(/\s+/g, " ").trim().slice(0, n);
const norm = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const hash = (s) => crypto.createHash("sha256").update(lc(s)).digest("hex").slice(0, 24); // the same as server/social.js
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
const snap = (x, step) => Math.round(x / step) * step;
const round = (x, n) => Math.round(x * 10 ** n) / 10 ** n;
const okPt = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
const looksLikeAddress = (t) => /\b\d{1,6}[a-z]?\s+[A-Za-zÀ-ÿ'.-]+(\s+[A-Za-zÀ-ÿ'.-]+){0,3}\s+(st|street|ave|avenue|rd|road|blvd|ln|lane|dr|drive|pl|way|ct|court)\b|\b(apt|apartment|unit|suite|flat)\s*#?\s*\w+|\b(my|our)\s+(place|apartment|flat|house|home)\b|['’]s\s+(place|apartment|flat|house|home)\b|\b(home|house)\b/i.test(String(t || ""));
const fakeEmail = (em) => !em || /@demo\.encore$/i.test(em) || /@(example\.invalid|preview\.encore)$/i.test(em);

// ---- the words: the same reading as the page (public/placesuggest.js) ----
let PURE = null;
export function pure() { if (PURE) return PURE; try { const box = { window: {} }; box.globalThis = box.window; vm.runInNewContext(fs.readFileSync(path.join(here, "..", "public", "placesuggest.js"), "utf8"), box, { timeout: 500 }); PURE = box.window.PLSuggestPlaces; } catch { PURE = null; } return PURE || { INTENTS: [], intentOf: () => null }; }

// ---- what each intent looks for: OpenStreetMap tags (Overpass) and Google Places types or a text search ----
export const LOOK = {
  coffee: { osm: ['["amenity"="cafe"]'], google: { types: ["cafe", "coffee_shop"] }, radius: 1500, walk: true },
  brunch: { osm: ['["amenity"="restaurant"]["cuisine"~"breakfast|brunch",i]', '["amenity"="cafe"]'], google: { types: ["brunch_restaurant", "breakfast_restaurant"] }, radius: 2000 },
  drinks: { osm: ['["amenity"~"^(bar|pub)$"]'], google: { types: ["bar", "wine_bar", "pub"] }, radius: 2000 },
  dinner: { osm: ['["amenity"="restaurant"]'], google: { types: ["restaurant"] }, radius: 2000 },
  picnic: { osm: ['["leisure"="park"]["name"]'], google: { types: ["park"] }, radius: 3000 },
  games: { osm: ['["amenity"~"^(cafe|bar|pub)$"]["name"~"game|board|dice|meeple|chess",i]', '["shop"="games"]', '["leisure"="park"]["name"]'], google: { text: "board game cafe" }, radius: 3000 },
  class: { osm: ['["craft"="pottery"]', '["amenity"="arts_centre"]', '["shop"="craft"]'], google: { text: "pottery studio" }, radius: 4000 },
  run: { osm: ['["leisure"="park"]["name"]'], google: { types: ["park"] }, radius: 3000 },
  hike: { osm: ['["leisure"~"^(park|nature_reserve)$"]["name"]'], google: { types: ["park", "hiking_area"] }, radius: 6000 },
  book: { osm: ['["amenity"="cafe"]', '["amenity"="library"]'], google: { types: ["cafe", "library"] }, radius: 1800, walk: true },
  watch: { osm: ['["amenity"~"^(bar|pub)$"]["sport"]', '["amenity"~"^(bar|pub)$"]'], google: { types: ["sports_bar", "bar"] }, radius: 2500 },
};
const RELATED = { coffee: ["coffee", "brunch", "book"], brunch: ["brunch", "coffee"], book: ["book", "coffee"], drinks: ["drinks", "watch"], watch: ["watch", "drinks"], dinner: ["dinner"], picnic: ["picnic", "run", "hike"], run: ["run", "picnic", "hike"], hike: ["hike", "run", "picnic"], games: ["games"], class: ["class"] };
const VENUE_HINTS = [["coffee", /\b(caf[eé]|coffee|espresso|roast(ers|ery)?)\b/i], ["drinks", /\b(bar|pub|tavern|wine|taproom|brewery|cocktail)\b/i], ["picnic", /\b(park|garden|green|meadow|lawn|beach|pier)\b/i], ["class", /\b(studio|ceramic|pottery|clay|atelier)\b/i], ["dinner", /\b(restaurant|kitchen|bistro|trattoria|taqueria|diner|osteria)\b/i], ["games", /\b(game|board|dice|meeple)\b/i]];
/** A studio search for what they typed: a cooking class is not a pottery studio. */
const classText = (t) => /cook/i.test(t) ? "cooking class" : /paint|drawing/i.test(t) ? "art studio" : /candle/i.test(t) ? "candle making workshop" : /flower/i.test(t) ? "flower workshop" : "pottery studio";

// ---- the providers: Google Places (with a key) or OpenStreetMap, behind one fetch with a queue and a cache ----
export function makeNearby({ store = null, env = process.env, fetchImpl = (...a) => fetch(...a), now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const key = String(env.ENCORE_PLACES_KEY || ""), pick = lc(env.ENCORE_PLACES_PROVIDER || (key ? "google" : "osm"));
  const name = pick === "google" && key ? "google" : pick === "off" ? "off" : pick === "google" ? "osm" : "osm";
  // test and smoke runs (ENCORE_FAKE_GEO=1) make no requests unless a stub is pointed at with ENCORE_PLACES_URL
  const on = name !== "off" && (env.ENCORE_FAKE_GEO !== "1" || !!env.ENCORE_PLACES_URL);
  const ua = `PotteryLab/1.0 (place ideas for event hosts${env.ENCORE_PLACES_UA ? "; " + String(env.ENCORE_PLACES_UA).slice(0, 120) : ""})`;
  const gap = num(env.ENCORE_PLACES_GAP_MS, name === "osm" ? 1100 : 0), perDay = num(env.ENCORE_PLACES_PER_DAY, 2000), timeout = num(env.ENCORE_PLACES_TIMEOUT_MS, 6000);
  const ttl = name === "google" ? num(env.ENCORE_PLACES_CACHE_MIN, 30) * 60e3 : 7 * DAY, mem = new Map(), inflight = new Map(), stats = { requests: 0, errors: 0, dropped: 0, hits: 0 };
  let chain = Promise.resolve(), last = -Infinity, day = "", today = 0;
  const docOf = (k) => "system/plnear-" + crypto.createHash("sha256").update(k).digest("hex").slice(0, 24);
  function cached(k) { const m = mem.get(k); if (m && now() - m.at < ttl) return m; if (name !== "osm") return null; const d = store?.get?.(docOf(k))?.data; if (d && now() - (d.at || 0) < ttl) { mem.set(k, d); return d; } return null; }
  function keep(k, items) { const rec = { at: now(), items }; if (mem.size > 3000) mem.clear(); mem.set(k, rec); if (name === "osm") try { store?.set?.(docOf(k), { kind: "plnear", ...rec }); } catch {} return rec; }
  async function call(url, init) { const d = new Date(now()).toISOString().slice(0, 10); if (d !== day) { day = d; today = 0; } if (today >= perDay) { stats.dropped++; throw new Error("cap"); } today++;
    const wait = last + gap - now(); if (wait > 0) await sleep(wait); last = now(); stats.requests++;
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
    try { const r = await fetchImpl(url, { ...init, signal: ctl.signal }); if (!r.ok) throw new Error("places " + r.status); return await r.json(); } finally { clearTimeout(t); } }
  function osmQuery(I, c, r) { const L = LOOK[I] || LOOK.coffee; return `[out:json][timeout:8];(${L.osm.map((t) => `nwr${t}(around:${r},${c.lat},${c.lng});`).join("")});out center tags 40;`; }
  async function osm(I, c, r) { const j = await call(env.ENCORE_PLACES_URL || "https://overpass-api.de/api/interpreter", { method: "POST", headers: { "User-Agent": ua, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: "data=" + encodeURIComponent(osmQuery(I, c, r)) });
    const out = []; for (const e of j?.elements || []) { const t = e.tags || {}, nm = clean(t.name, 80); const lat = +(e.lat ?? e.center?.lat), lng = +(e.lon ?? e.center?.lon); if (!nm || !okPt({ lat, lng })) continue;
      const addr = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
      out.push({ id: `osm:${e.type}/${e.id}`, name: nm, lat: round(lat, 5), lng: round(lng, 5), address: clean(addr, 80), hood: clean(t["addr:suburb"] || t["addr:neighbourhood"] || "", 50), source: "osm", mapsUrl: `https://www.openstreetmap.org/${e.type}/${e.id}` }); }
    return out; }
  const MASK = "places.id,places.displayName,places.shortFormattedAddress,places.location,places.rating,places.userRatingCount,places.currentOpeningHours.openNow,places.googleMapsUri,places.primaryType,places.goodForGroups";
  async function google(I, c, r, text) { const L = LOOK[I] || LOOK.coffee, circle = { circle: { center: { latitude: c.lat, longitude: c.lng }, radius: r } }, txt = L.google.text ? (I === "class" ? classText(text) : L.google.text) : "";
    const base = env.ENCORE_PLACES_URL || "https://places.googleapis.com/v1/places";
    const j = await call(base + (txt ? ":searchText" : ":searchNearby"), { method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": MASK, "User-Agent": ua },
      body: JSON.stringify(txt ? { textQuery: txt, locationBias: circle, pageSize: 10 } : { includedTypes: L.google.types, maxResultCount: 10, rankPreference: "POPULARITY", locationRestriction: circle }) });
    return (j?.places || []).map((p) => ({ id: "g:" + clean(p.id, 200), name: clean(p.displayName?.text, 80), lat: round(+p.location?.latitude, 5), lng: round(+p.location?.longitude, 5), address: clean(p.shortFormattedAddress, 100),
      rating: Number.isFinite(+p.rating) && p.rating ? round(+p.rating, 1) : null, reviews: Math.max(0, Math.floor(+p.userRatingCount || 0)), openNow: p.currentOpeningHours?.openNow === true, groups: p.goodForGroups === true,
      source: "google", mapsUrl: /^https:\/\/(maps\.google\.com|www\.google\.com\/maps|maps\.app\.goo\.gl)\//.test(p.googleMapsUri || "") ? p.googleMapsUri : "" })).filter((p) => p.name && okPt(p)); }
  /** Places near a point for an intent. Resolves to [] on any failure. The centre is rounded to about 500 m first. */
  function near(I, center, radius, text = "") { if (!on || !okPt(center) || !LOOK[I]) return Promise.resolve([]); const c = { lat: round(snap(center.lat, 0.005), 3), lng: round(snap(center.lng, 0.005), 3) };
    const k = [name, I, I === "class" ? classText(text) : "", c.lat, c.lng, radius].join("|"), hit = cached(k); if (hit) { stats.hits++; return Promise.resolve(hit.items); }
    if (inflight.has(k)) return inflight.get(k);
    const p = (chain = chain.then(() => (name === "google" ? google(I, c, radius, text) : osm(I, c, radius))).then((items) => keep(k, items.slice(0, 40)).items).catch(() => { stats.errors++; return null; }))
      .then((v) => { inflight.delete(k); return v || []; }); inflight.set(k, p); return p; }
  const attribution = name === "google" ? "Places and ratings from Google Maps" : "Map data © OpenStreetMap contributors";
  return { on, provider: on ? name : "off", near, attribution, userAgent: ua, stats, cached: (I, center, radius, text = "") => { if (!okPt(center)) return null; const c = { lat: round(snap(center.lat, 0.005), 3), lng: round(snap(center.lng, 0.005), 3) }; return cached([name, I, I === "class" ? classText(text) : "", c.lat, c.lng, radius].join("|")); } };
}

// ---- the places hosts here already used, with their signals ----
/** Public places from public events by real accounts, grouped by venue and city. Internal: no host, guest or event id leaves. */
export function platformPlaces({ X, C = null, geo = null, now = Date.now() }) {
  const I = X.index(), P = pure(), out = new Map();
  const guestsOf = new Map(); for (const [, L] of I.att) for (const a of L) guestsOf.set(a.eventId, (guestsOf.get(a.eventId) || 0) + 1);
  const kudosOf = new Map(); for (const k of I.kudos || []) { if (!k?.eventId || !k.verified) continue; let L = kudosOf.get(k.eventId); if (!L) kudosOf.set(k.eventId, (L = [])); L.push(k); }
  for (const x of I.events.values()) { const e = x.e || {}; if (!x.ws || x.ws === DEFAULT_WS || !countsPublicly(e) || e.placePublic !== true || e.approvalRequired) continue;
    const owner = lc(x.owner); if (fakeEmail(owner) || !getDbUser(owner) || !getWorkspace(x.ws)) continue;
    const venue = clean(e.venueName || e.meetPoint, 80); if (venue.length < 2 || looksLikeAddress(venue)) continue;
    const host = (() => { try { return C?.profileOf?.(x.ws) || {}; } catch { return {}; } })(), city = clean(e.city || host.city, 60); if (!city) continue;
    const k = norm(venue) + "|" + norm(String(city).split(",")[0]); let g = out.get(k);
    if (!g) out.set(k, (g = { name: venue, city, hood: clean(e.hood, 50), intents: new Set(), hosts: new Set(), events: 0, recent: 0, guests: 0, againYes: 0, againOf: 0, lat: null, lng: null, last: 0 }));
    const it = P.intentOf({ text: `${e.pubTitle || e.name || ""} ${e.activity || ""}`, planKind: e.planKind || "" }); if (it) g.intents.add(it.key);
    for (const [ik, re] of VENUE_HINTS) if (re.test(venue)) g.intents.add(ik);
    const at = Date.parse((e.date || "") + "T12:00:00Z") || 0, age = (now - at) / DAY; g.hosts.add(x.ws); g.events++; if (age <= 30 && age >= -30) g.recent++; g.last = Math.max(g.last, at);
    g.guests += guestsOf.get(x.id) || 0; const K = (kudosOf.get(x.id) || []).filter((q) => q.love || (q.tags || []).length || q.compare); g.againOf += K.length; g.againYes += K.filter((q) => (q.tags || []).includes("again") || q.compare === "better").length;
    if (!g.hood && e.hood) g.hood = clean(e.hood, 50);
    if (g.lat == null) { let p = null; try { const pl = placeOf(e, host); p = pl.exact && geo?.cached ? geo.cached(pl.query) : null; if (p?.miss) p = null; } catch {} p = p || hoodCentre(e.hood, city); if (okPt(p)) { g.lat = p.lat; g.lng = p.lng; g.approx = !!p.hood; } } }
  return [...out.values()];
}
/** The label and the why lines a Pottery Lab place has earned. */
export function platformWhy(g) { const rate = g.againOf ? g.againYes / g.againOf : 0, why = [];
  if (g.againOf >= 5 && rate >= 0.6) why.push(`Hosts here got ${Math.round(rate * 100)}% would go again`);
  if (g.recent >= 2) why.push("Popular on Pottery Lab this month"); else if (g.events >= 2) why.push(`Hosted ${g.events} times on Pottery Lab`);
  const loved = g.hosts.size >= 2 || g.recent >= 2 || (g.againOf >= 3 && rate >= 0.8);
  return { label: loved ? "Loved on Pottery Lab" : "Hosted on Pottery Lab", why: why.length ? why : ["A host here used it for a public event"] }; }
/** The label and the why lines a provider place has, only from its own numbers. */
export function providerWhy(p, { n = 0, intent = "" } = {}) { const why = [];
  if (p.source === "google" && p.rating) why.push(`${p.rating} on Google (${p.reviews.toLocaleString("en-US")} reviews)`);
  if (p.openNow) why.push("Open now");
  if (p.groups && n >= 5 && ["dinner", "brunch", "drinks"].includes(intent)) why.push("Takes groups");
  const label = p.source === "google" && p.rating >= 4.4 && p.reviews >= 500 ? "Popular on Google" : p.source === "google" && p.rating >= 4.3 && p.reviews >= 50 ? "Well rated" : "Nearby";
  return { label, why }; }

const nearestHood = (pt, city) => { let best = null, d = Infinity; for (const h of hoodsIn(city)) { const k = distanceKm(pt, h); if (k < d) { d = k; best = h; } } return best && d < 2.5 ? best.hood : ""; };

export function mountPlaceSuggest(app, { store, small, currentUser, C, X }) {
  const who = (req) => { let u = null; try { u = currentUser(req); } catch {} return u && u.email && u.ws !== DEFAULT_WS ? u : null; };
  const N = makeNearby({ store }), SERVER = new Map(), hits = new Map();
  let PL = null, plAt = 0; const places = () => { if (!PL || Date.now() - plAt > 10 * 60e3) { try { PL = platformPlaces({ X, C, geo: app.locals.geo || null }); } catch { PL = []; } plAt = Date.now(); } return PL; };
  try { store.events?.on?.("change", (e) => { if (/^ws\/[^/]+\/events\//.test(String(e?.path || ""))) plAt = 0; }); } catch {}
  /** Add a section for an intent: provider = { id, title, load(ctx) -> { items, attribution } }. */
  function register(kind, provider) { if (!kind || !provider?.load) throw new Error("register(kind, { id, title, load })"); const p = { id: String(provider.id || kind), title: String(provider.title || "More ideas"), ...provider };
    SERVER.set(kind, [...(SERVER.get(kind) || []).filter((x) => x.id !== p.id), p]); return () => SERVER.set(kind, (SERVER.get(kind) || []).filter((x) => x !== p)); }
  app.locals.placeSuggest = { register, nearby: N, platformPlaces: places, bust: () => (plAt = 0) };

  const limited = (key, anon) => { const now = Date.now(), H = (hits.get(key) || []).filter((t) => now - t < 3600e3), div = anon ? 2 : 1;
    const perHour = Math.max(1, Math.floor(num(process.env.ENCORE_PLACE_IDEAS_PER_HOUR, 240) / div)), perMin = Math.max(1, Math.floor(40 / div));
    if (H.length >= perHour || H.filter((t) => now - t < 60e3).length >= perMin) { hits.set(key, H); return true; } H.push(now); hits.set(key, H); if (hits.size > 20000) hits.clear(); return false; };

  // ---- the home area: private to its owner ----
  const homePath = (em) => "system/plhome-" + hash(em);
  const homeOf = (em) => { const d = store.get(homePath(em))?.data; return d && d.area ? d : null; };
  async function locateArea(area, city) { const a = clean(area, 80), c = clean(city, 60); let p = hoodCentre(a, c) || (c ? null : hoodCentre(a));
    if (!p && app.locals.geo?.on) { try { p = await Promise.race([app.locals.geo.geocode([a, c].filter(Boolean).join(", ")), new Promise((r) => setTimeout(() => r(null), 4000))]); } catch {} }
    if (okPt(p)) return { lat: round(p.lat, 3), lng: round(p.lng, 3), found: true };
    const cc = cityCentre(c); return cc ? { lat: round(cc.lat, 3), lng: round(cc.lng, 3), found: false } : null; }
  app.get("/api/me/home-area", (req, res) => { res.set("Cache-Control", "private, no-store"); const u = who(req); if (!u) return res.status(401).json({ code: "signin", message: "Sign in to set a home area." });
    const h = homeOf(u.email); res.json(h ? { set: true, area: h.area, city: h.city || "", share: h.share === true, found: h.found !== false } : { set: false, area: "", city: (() => { try { return C.profileOf(u.ws)?.city || ""; } catch { return ""; } })(), share: false }); });
  app.post("/api/me/home-area", small, async (req, res) => { res.set("Cache-Control", "private, no-store"); const u = who(req); if (!u) return res.status(401).json({ code: "signin", message: "Sign in to set a home area." });
    const b = req.body || {}, area = clean(b.area, 80), city = clean(b.city, 60);
    if (area.length < 2) return res.status(400).json({ code: "invalid", message: "Add a neighbourhood or two cross streets." });
    if (limited("home:" + hash(u.email), false)) return res.status(429).json({ code: "rate_limited", message: "Give it a minute and try again." });
    const p = await locateArea(area, city); if (!p) return res.status(400).json({ code: "not_found", message: "I couldn't place that. Add the city too." });
    store.set(homePath(u.email), { kind: "plhome", area, city, share: b.share === true, ...p, at: Date.now() });
    res.json({ ok: true, set: true, area, city, share: b.share === true, found: p.found }); });
  app.delete("/api/me/home-area", (req, res) => { const u = who(req); if (!u) return res.status(401).json({ code: "signin" }); try { store.delete(homePath(u.email)); } catch {} res.json({ ok: true, set: false }); });

  app.get("/api/public/place-suggest/meta", (req, res) => { res.set("Cache-Control", "private, max-age=60"); const sections = {}; for (const [k, L] of SERVER) if (L.length) sections[k] = L.map((p) => ({ id: p.id, title: p.title }));
    res.json({ provider: N.provider, sections }); });

  // ---- somewhere in the middle: mutual friends who shared an area, never shown ----
  function middleOf(u, names, emails) { if (!u || !X?.friendsOf) return null; const me = lc(u.email), mine = homeOf(me), F = (X.friendsOf(me) || []).map((f) => lc(f.email)).filter((em) => (X.friendsOf(em) || []).some((x) => lc(x.email) === me));
    const wantN = (names || []).map((n) => lc(n)).filter(Boolean), wantE = new Set((emails || []).map(lc)), pts = [];
    for (const em of F) { let first = ""; try { first = lc(String(X.person(em)?.name || "").split(/\s+/)[0]); } catch {} if (!wantE.has(em) && !(first && wantN.includes(first))) continue;
      const h = homeOf(em); if (h?.share === true && okPt(h)) pts.push(h); }
    if (!pts.length) return { ok: false, shared: 0 };
    const all = okPt(mine) ? [mine, ...pts] : pts; if (all.length < 2) return { ok: false, shared: pts.length };
    const c = { lat: round(snap(all.reduce((s, p) => s + p.lat, 0) / all.length, 0.01), 3), lng: round(snap(all.reduce((s, p) => s + p.lng, 0) / all.length, 0.01), 3) };
    return { ok: true, shared: pts.length, center: c, city: mine?.city || pts[0].city || "", hide: new Set(pts.map((p) => norm(p.area))) }; }

  app.post("/api/place-suggest", small, async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    const b = req.body || {}, u = who(req), P = pure(), key = u ? "u:" + hash(u.email) : "ip:" + (req.ip || "?");
    if (limited(key, !u)) return res.status(429).json({ code: "rate_limited", message: "That's a lot of looking. Give me a minute." });
    const text = clean(b.text, 120), I0 = P.intentOf({ text, planKind: clean(b.kind, 20) }), intent = LOOK[b.intent] ? b.intent : I0?.key || "";
    if (!intent) return res.json({ intent: "", sections: [], modes: [], attribution: [] });
    const n = Math.max(0, Math.min(200, Math.floor(+b.n || 0))), L = LOOK[intent];
    // where, in order: home area, the event's own place, the page city; or what they tapped
    const home = u ? homeOf(u.email) : null, pageCity = u ? (() => { try { return C.profileOf(u.ws)?.city || ""; } catch { return ""; } })() : "";
    const city = clean(b.city, 60) || home?.city || pageCity, place = clean(b.place, 80), hood = clean(b.hood, 60);
    const eventPt = place && !looksLikeAddress(place) ? hoodCentre(place, city) || hoodCentre(hood, city) || (app.locals.geo?.cached ? (() => { const c = app.locals.geo.cached([place, city].filter(Boolean).join(", ")); return c && !c.miss ? c : null; })() : null) : hood ? hoodCentre(hood, city) : null;
    const cityPt = cityCentre(city) || hoodCentre(city), mid = u && (Array.isArray(b.with) && b.with.length || Array.isArray(b.guests) && b.guests.length || n >= 3) ? middleOf(u, (b.with || []).slice(0, 6).map((x) => clean(x, 40)), (b.guests || []).slice(0, 30).map((x) => clean(x, 120))) : null;
    const modes = []; if (home && okPt(home)) modes.push({ id: "home", label: "Near home" }); if (eventPt) modes.push({ id: "event", label: `Near ${place || hood}` }); if (cityPt) modes.push({ id: "city", label: `In ${cityCentre(city)?.name || city}` }); if (mid?.ok) modes.push({ id: "middle", label: "In the middle" });
    let mode = String(b.mode || "auto"); if (mode === "auto" || (mode !== "here" && !modes.some((m) => m.id === mode))) mode = modes[0]?.id || "none";
    let center = null, line = "", whereCity = city, pub = false;
    if (mode === "home") { center = home; line = `near your home area, ${home.area}`; whereCity = home.city || city; }
    else if (mode === "event") { center = eventPt; line = `near ${place || hood}`; pub = true; }
    else if (mode === "city") { center = cityPt; line = `in ${cityCentre(city)?.name || city}`; pub = true; }
    else if (mode === "middle") { center = mid.center; const h = nearestHood(center, mid.city); line = `between you and ${mid.shared === 1 ? "1 friend who" : mid.shared + " friends who"} shared an area${h ? `, around ${h}` : ""}`; whereCity = mid.city; }
    else if (mode === "here") { const p = { lat: round(+b.lat, 3), lng: round(+b.lng, 3) }; if (okPt(p)) { center = p; line = "near you right now"; } }
    const where = { mode, line: line || (city ? `in ${city}` : "near you"), city: whereCity, ...(pub && okPt(center) ? { public: true, lat: center.lat, lng: center.lng } : {}) };
    const R = (L.radius || 2000) * (mode === "city" ? 2 : 1), dist = (p) => (okPt(center) && okPt(p) ? Math.round(distanceKm(center, p) * 1000) : null);
    const nearWord = mode === "home" ? "Near you" : mode === "middle" ? "Near the middle" : mode === "here" ? "Near you" : "";
    const walkWhy = (d) => (d != null && d <= 2400 && nearWord ? `${nearWord}, ${Math.max(1, Math.round(d / 80))} min walk` : "");
    const pubItem = (it, d) => ({ ...it, distanceM: d ?? undefined });
    // 1. Pottery Lab places
    const want = new Set(RELATED[intent] || [intent]), plat = [];
    for (const g of places()) { if (![...g.intents].some((k) => want.has(k))) continue; const d = dist(g);
      if (okPt(center) ? (d == null ? norm(g.city.split(",")[0]) !== norm(String(whereCity).split(",")[0]) : d > Math.max(5000, R * 2)) : norm(g.city.split(",")[0]) !== norm(String(whereCity).split(",")[0])) continue;
      const w = platformWhy(g), rate = g.againOf ? g.againYes / g.againOf : 0.6, score = (w.label.startsWith("Loved") ? 40 : 20) + rate * 20 + Math.min(10, g.events * 2) + g.recent * 3 - (d != null ? d / 250 : 6) + (g.intents.has(intent) ? 8 : 0);
      plat.push({ score, it: pubItem({ id: "pl:" + hash(g.name + "|" + g.city), name: g.name, hood: g.hood || (okPt(g) ? nearestHood(g, g.city) : ""), city: g.city, ...(okPt(g) && !g.approx ? { lat: g.lat, lng: g.lng } : {}), label: w.label, why: [g.approx ? "" : walkWhy(d), ...w.why].filter(Boolean).slice(0, 2), source: "pottery-lab", fill: { meetPoint: g.name, city: g.city, hood: g.hood, placePublic: true } }, g.approx ? null : d) }); }
    plat.sort((a, b) => b.score - a.score);
    // 2. the places provider, waiting at most a moment (the page asks again for the rest)
    let pending = false, prov = [];
    if (okPt(center) && N.on) { const hit = N.cached(intent, center, R, text); if (hit) prov = hit.items;
      else { const pr = N.near(intent, center, R, text); const r = await Promise.race([pr, new Promise((ok) => setTimeout(() => ok(null), num(process.env.ENCORE_PLACES_WAIT_MS, 900)))]); if (r) prov = r; else pending = true; } }
    const seen = new Set(plat.map((x) => norm(x.it.name))), pv = [];
    for (const p of prov) { if (seen.has(norm(p.name))) continue; seen.add(norm(p.name)); const d = dist(p), w = providerWhy(p, { n, intent });
      const score = (p.rating ? (p.rating - 3.5) * 10 + Math.min(8, Math.log10(1 + p.reviews) * 2) : 0) + (p.openNow ? 2 : 0) + (p.groups && n >= 5 ? 4 : 0) - (d != null ? d / 200 : 0);
      pv.push({ score, it: pubItem({ id: p.id, name: p.name, hood: p.hood || nearestHood(p, whereCity), city: whereCity, lat: p.lat, lng: p.lng, label: w.label, why: [walkWhy(d), ...w.why].filter(Boolean).slice(0, 2), source: p.source, mapsUrl: p.mapsUrl || "",
        fill: { meetPoint: p.name, city: whereCity, hood: p.hood || nearestHood(p, whereCity), placePublic: true, ...(p.source === "osm" && p.address ? { venueAddr: p.address } : {}) } }, d) }); }
    pv.sort((a, b) => b.score - a.score);
    const items = [...plat.slice(0, 3), ...pv].slice(0, 5).map((x) => x.it);
    // in the middle, a place is never labelled with a friend's own area: that would say where they live
    if (mode === "middle") for (const it of items) if (mid.hide.has(norm(it.hood))) { it.hood = ""; if (it.fill) it.fill.hood = ""; }
    const sources = new Set(items.map((x) => x.source)), attribution = [...(sources.has("google") || (pending && N.provider === "google") ? [N.attribution] : []), ...(sources.has("osm") || (pending && N.provider === "osm") ? [N.attribution] : [])];
    const heading = P.INTENTS.find((x) => x.key === intent)?.heading || "Places";
    const note = !okPt(center) ? (city ? `I don't know ${city} well enough yet. Try Use my location.` : "Tell me where: add a home area in Settings, a place under Where, or tap Use my location.") : pending ? "Looking nearby…" : N.on ? "Nothing nearby I can vouch for yet. Try another area above." : "Nothing from Pottery Lab hosts nearby yet. Try another area above.";
    const sections = [{ id: "places", title: heading, items, note }];
    // 3. other providers for this intent (Routes near you and friends), with the same private centre
    for (const p of SERVER.get(intent) || []) { if (b.section && b.section !== p.id) continue; let r = null;
      try { const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 4000); r = await Promise.race([Promise.resolve(p.load({ intent, n, text, center: okPt(center) ? { lat: round(center.lat, 3), lng: round(center.lng, 3) } : null, radius: R, city: whereCity, mode, signal: ctl.signal })), new Promise((ok) => setTimeout(() => ok(null), 4000))]); clearTimeout(t); } catch { r = null; }
      const its = (r?.items || []).slice(0, 5).map((x) => ({ ...x, name: clean(x.name, 80), why: (x.why || []).map((w) => clean(w, 80)).slice(0, 2), label: clean(x.label || "Nearby", 40) })).filter((x) => x.name);
      sections.push({ id: p.id, title: p.title, items: its, note: r?.note || "Nothing to show here yet." }); if (r?.attribution) attribution.push(clean(r.attribution, 120)); }
    res.json({ intent, where, modes, sections: b.section ? sections.filter((s) => s.id === b.section) : sections, attribution: [...new Set(attribution)], pending, provider: N.provider });
  });
}
