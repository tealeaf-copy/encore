// The map view (/map, public/map.html): Discover's upcoming events as small drawn pins, and "Your map" of what you
// saved or went to. Geodata and the privacy rule for where a pin goes live in server/geo.js.
//
// What a map card never carries: a street address, a meeting point the public card doesn't already show, a guest's
// name or email. What never gets a card: private and link-only events, unlisted ones, members-only and members-first
// events (server/fanclub.js), preview and interest-check events, tentative ones, cancelled ones, examples, and pages
// Discover doesn't list yet. mapEligible() is that rule; test/map.test.js holds it.
//
// GET /api/public/map?city=     upcoming cards for a city (or the busiest one), its centre, and the tile setup
// GET /api/public/map/places?ids= cards for saved or past events (Your map), same rules, past allowed
// GET /api/me/map?ids=          signed in: hosts you follow, friends going (server/hooks.js), events you went to
import { scopeStore, workspaceOfEvent, getWorkspace, allWorkspaceIds, DEFAULT_WS } from "./workspaces.js";
import { makeGeocoder, cityCentre, hoodsIn, distanceKm } from "./geo.js";
import { cspWith } from "./posthog.js";

const lc = (s) => String(s || "").trim().toLowerCase();
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const ID_OK = /^[A-Za-z0-9_-]{1,120}$/;
const PHOTO_OK = (u) => /^\/_blob\/[A-Za-z0-9]{20}$/.test(u || "") || /^\/presets\/[a-z0-9-]{1,60}\.(jpg|webp|png)$/.test(u || "");
const ART_OK = (k) => /^[a-z]{2,20}(\+[a-z]{2,20})?$/.test(String(k || ""));
const iso = (t) => new Date(t).toISOString().slice(0, 10);

// ---- what kind of thing it is: a category chip, a vibe (its pin), a price tier ----
export const CATS = ["supper", "games", "run", "workshop", "drop", "market"];
export const VIBES = ["cozy", "nerdy", "active", "food", "make", "late"];
const textOf = (e) => lc([e.pubTitle, e.title, e.name, e.activity, e.format, e.dinnerTheme, ...(Array.isArray(e.tags) ? e.tags : []), e.coverArt?.kind].filter(Boolean).join(" "));
export function catOf(e = {}) { const t = textOf(e);
  if (e.drop || e.preorder || /\b(drop|pre-?orders?|bake sale|cake box)\b/.test(t)) return "drop";
  if (/\b(market|flea|bazaar|fair|swap|stalls?|pop-?up shop)\b/.test(t)) return "market";
  if (/\b(run|runs|running|5k|10k|jog|jogging)\b|run club/.test(t)) return "run";
  if (/\b(games?|board ?games?|meeple|d&d|dnd|dungeons|chess|go club|trivia|mahjong|puzzles?|catan|tabletop|lan party)\b/.test(t)) return "games";
  if (/\b(workshop|class|lesson|learn|bouquet|pottery|ceramics?|wheel|craft|knit|knitting|sew|sewing|print|printing|zine|risograph|calligraphy|build)\b/.test(t)) return "workshop";
  if (/\b(supper|dinner|omakase|potluck|cooking night|cook night|tasting|brunch|feast|dumpling|noodle|banquet)\b/.test(t)) return "supper";
  return ""; }
export function vibeOf(e = {}, cat = catOf(e)) { const t = textOf(e), hh = +String(e.startTime || "").slice(0, 2);
  if ((Number.isFinite(hh) && String(e.startTime || "").length >= 4 && (hh >= 21 || hh < 4)) || /\b(late night|late-night|after dark|midnight|karaoke|dj set|night market)\b/.test(t)) return "late";
  if (cat === "run" || /\b(hike|hiking|yoga|climb|climbing|bouldering|swim|ride|cycling|bike|walk|dance|pickleball|tennis|football|soccer)\b/.test(t)) return "active";
  if (cat === "games" || /\b(book club|reading|hack|hackathon|code|coding|tech|study|lecture|talk|demo night|chess|science|maths?)\b/.test(t)) return "nerdy";
  if (cat === "workshop" || /\b(make|making|craft|paint|painting|draw|drawing|sketch|zine|knit|pottery)\b/.test(t)) return "make";
  if (/\b(coffee|caf[eé]|pour-?overs?|tea|matcha|cozy|cosy|quiet|candle|slow morning|pastr(y|ies)|listening)\b/.test(t)) return "cozy";
  if (cat === "supper" || cat === "drop" || cat === "market" || /\b(food|eat|bake|baking|cake|bread|b[aá]nh|cook|cooking|wine|dinner|lunch|picnic)\b/.test(t)) return "food";
  return "cozy"; }
/** "free", "$" (about $20 or less a person), "$$" (to $60), "$$$" (more), or "" when we can't tell. */
export function tierOf(e = {}) { if (e.free || e.payWhatYouLike) return "free"; const s = String(e.price ?? e.priceLine ?? "").replace(/,/g, "");
  if (!s.trim() || /^\s*(0|free)\s*$/i.test(s)) return "free"; // no price on an open event means free, as Discover says
  const m = s.match(/(\d+(?:\.\d+)?)/); if (!m) return /free/i.test(s) ? "free" : ""; const n = +m[1]; if (!n) return "free"; return n <= 20 ? "$" : n <= 60 ? "$$" : "$$$"; }

// ---- the rule for what may go on a map ----
/** An event (the stored doc) that may go on a map. past: allow ones that already happened (Your map). */
export function mapEligible(e, { past = false, today = iso(Date.now()), club = null } = {}) {
  if (!e || typeof e !== "object") return false;
  if (!e.discoverable || e.unlisted || e.example || e.cancelled || e.private) return false; // private and link-only events
  if (club?.only || (club?.earlyUntil && club.earlyUntil > Date.now()) || e.membersOnly || e.visibility === "members") return false; // members-only and members-first
  if (e.stage === "interest" || e.tentative || e.preview) return false; // previews and interest checks
  if (!past && e.date && e.date < today) return false;
  return true; }

export function makeMap({ store, C, H = null, geo = makeGeocoder({ store }) }) {
  const clubOf = (ws, id) => { try { return scopeStore(store, ws).get("clubevents/" + id)?.data || null; } catch { return null; } };
  const isSample = (ws) => /@demo\.encore$/i.test(getWorkspace(ws)?.ownerEmail || "");
  /** One event as the map shows it, from the stored doc. Only these fields, by name: nothing else reaches the page. */
  function card(id, e, ws, host) { const g = geo.locate(id, e, host); if (!g) return null;
    const cat = catOf(e), vibe = vibeOf(e, cat), going = (() => { try { return C.goingOf(ws, id, e) || {}; } catch { return {}; } })();
    const hood = clean(e.hood || (host?.hood && lc(String(e.city || "").split(",")[0]) === lc(String(host?.city || "").split(",")[0]) ? host.hood : "") || (!e.city ? host?.hood : "") || "", 60);
    const pub = !!e.meetPoint && !e.approvalRequired && e.discoverable && g.exact; // the place name only where the public card already shows it
    return { id, url: "/e/" + encodeURIComponent(id), title: clean(e.pubTitle || e.name, 140), date: /^\d{4}-\d{2}-\d{2}$/.test(e.date || "") ? e.date : "", startTime: /^\d{2}:\d{2}$/.test(e.startTime || "") ? e.startTime : "",
      hood, city: clean(e.city || host?.city, 60), cat, vibe, tier: tierOf(e), priceText: e.free ? "Free" : clean(typeof e.price === "string" || typeof e.price === "number" ? String(e.price) : "", 40),
      cover: PHOTO_OK(e.coverPhoto) ? e.coverPhoto : "", art: { activity: clean(e.activity, 40), kind: ART_OK(e.coverArt?.kind) ? e.coverArt.kind : "", tone: ART_OK(e.coverArt?.tone) ? e.coverArt.tone : "" },
      host: host ? { handle: clean(host.handle, 40), name: clean(host.name || host.handle, 60), color: /^#[0-9a-f]{6}$/i.test(host.theme?.accent || host.color || "") ? host.theme?.accent || host.color : "", avatarArt: /^[a-z]+(~\d){0,6}$/.test(host.theme?.avatarArt || "") ? host.theme.avatarArt : "", url: host.handle ? "/@" + host.handle : "" } : null,
      going: +going.going || 0, faces: (going.faces || []).slice(0, 3).map((f) => ({ art: /^[a-z]+$/.test(f.art || "") ? f.art : "", color: /^#[0-9a-f]{6}$/i.test(f.color || "") ? f.color : "" })),
      saves: (() => { try { return H?.countOf?.("event", id) || 0; } catch { return 0; } })(),
      geo: g.exact ? { lat: g.lat, lng: g.lng, exact: true } : { lat: g.lat, lng: g.lng, exact: false, r: g.r },
      ...(pub ? { place: clean(e.meetPoint, 80) } : {}), ...(isSample(ws) ? { sample: true } : {}) }; }
  /** Upcoming map cards: Discover's own list (ready pages, listed, no doubles), then the map's rule on each stored event. */
  function upcoming() { const out = [], today = iso(Date.now());
    for (const c of C.discover({ all: true }).events) { if (!ID_OK.test(c.id || "") || c.private) continue; const ws = workspaceOfEvent(c.id); if (!ws || ws === DEFAULT_WS) continue;
      const e = scopeStore(store, ws).get("events/" + c.id)?.data; if (!mapEligible(e, { today, club: clubOf(ws, c.id) })) continue;
      const k = card(c.id, e, ws, C.profileOf(ws)); if (k) out.push(k); }
    return out; }
  /** Cards for given ids (saves, places you went): the same rule, past events allowed. */
  function places(ids) { const out = [];
    for (const id of [...new Set(ids)].slice(0, 100)) { if (!ID_OK.test(id)) continue; const ws = workspaceOfEvent(id); if (!ws || ws === DEFAULT_WS) continue;
      const e = scopeStore(store, ws).get("events/" + id)?.data, host = C.profileOf(ws); if (!host?.handle || !mapEligible(e, { past: true, club: clubOf(ws, id) })) continue;
      const k = card(id, e, ws, host); if (k) out.push({ ...k, past: !!k.date && k.date < iso(Date.now()) }); }
    return out; }
  /** A city's cards: those within about 60 km of its centre (or that name it). No city: the one with the most events. */
  function forCity(city) { const all = upcoming(); let c = cityCentre(city);
    if (!c) { const n = new Map(); for (const k of all) { const cc = cityCentre(k.city); if (cc) n.set(cc.name, (n.get(cc.name) || 0) + 1); } const top = [...n].sort((a, b) => b[1] - a[1])[0]; c = top ? cityCentre(top[0]) : null; }
    const events = c ? all.filter((k) => distanceKm(c, k.geo) < 60 || cityCentre(k.city)?.name === c.name) : all;
    const hoods = [...new Set([...events.map((k) => k.hood).filter(Boolean), ...hoodsIn(c?.name).map((h) => h.hood)])];
    return { city: c?.name || clean(city, 60), center: c ? { lat: c.lat, lng: c.lng } : null, events, hoods, others: c ? all.length - events.length : 0 }; }
  return { card, upcoming, places, forCity, geo };
}

// the map's tile setup, from env: ENCORE_MAP_TILES "openfreemap" (default, keyless vector tiles), "off" (the list only),
// or the URL of another MapLibre style; ENCORE_MAP_HOSTS lists any extra hosts that style reads (comma separated)
export function tilesConfig(env = process.env) { const t = String(env.ENCORE_MAP_TILES || "openfreemap").trim();
  if (/^off$/i.test(t)) return { kind: "off", hosts: [] };
  const extra = String(env.ENCORE_MAP_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter((h) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h));
  if (/^https:\/\/[^\s"'<>]+$/.test(t)) { let host = ""; try { host = new URL(t).host; } catch {} return { kind: "style", style: t, hosts: [...new Set([host, ...extra].filter(Boolean))] }; }
  return { kind: "openfreemap", source: "https://tiles.openfreemap.org/planet", glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf", hosts: ["tiles.openfreemap.org", ...extra] }; }
export const MAP_LIB = { js: "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js", css: "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" };
export function mapCsp(env = process.env) { const hosts = tilesConfig(env).hosts.map((h) => "https://" + h).join(" ");
  return cspWith(["default-src 'self'", "script-src 'self' 'unsafe-inline' https://unpkg.com", "worker-src 'self' blob:", "child-src 'self' blob:", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
    "font-src 'self' https://fonts.gstatic.com data:", "img-src 'self' data: blob: https:", `connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com${hosts ? " " + hosts : ""}`, "frame-ancestors 'self'", "base-uri 'self'", "form-action 'self'", "report-uri /api/csp-report"].join("; ")); }

export function mountMap(app, { store, C, currentUser, sendStatic }) {
  const H = app.locals.hooks || null, M = makeMap({ store, C, H }); app.locals.map = M; app.locals.geo = M.geo;
  const hits = new Map(); const limited = (req, n) => { const k = (req.ip || "?") + "|map", now = Date.now(); let h = hits.get(k); if (!h || now - h.start > 3600e3) { h = { n: 0, start: now }; hits.set(k, h); if (hits.size > 20000) hits.clear(); } return ++h.n > n; };
  const slow = (res) => res.status(429).json({ code: "rate_limited", message: "Slow down a little. Try again in a bit." });
  const list = (v) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
  app.get("/map", (req, res) => { res.set(process.env.ENCORE_CSP === "report" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy", mapCsp()); sendStatic(res, "map.html", "<p>Map page missing.</p>"); });
  app.get("/api/public/map", (req, res) => { if (limited(req, 1500)) return slow(res); res.set("Cache-Control", "public, max-age=30");
    const t = tilesConfig(); res.json({ ...M.forCity(clean(req.query.city, 60)), tiles: { kind: t.kind, source: t.source || "", glyphs: t.glyphs || "", style: t.style || "" }, lib: MAP_LIB }); });
  app.get("/api/public/map/places", (req, res) => { if (limited(req, 1500)) return slow(res); res.set("Cache-Control", "private, max-age=15"); res.json({ events: M.places(list(req.query.ids)) }); });
  app.get("/api/me/map", (req, res) => { const u = currentUser(req); res.set("Cache-Control", "private, no-store"); if (!u || u.ws === DEFAULT_WS) return res.json({ signedIn: false, follows: [], friends: {}, went: [] });
    const ids = list(req.query.ids).filter((i) => ID_OK.test(i)).slice(0, 40); let follows = [], friends = {}, went = [];
    try { const me = lc(u.email); for (const ws of allWorkspaceIds()) { try { if (C.followersOf(ws).some((f) => lc(f.email) === me)) { const h = C.profileOf(ws); if (h?.handle) follows.push(h.handle); } } catch {} } } catch {}
    try { friends = H?.friendsGoing?.(u.email, ids) || {}; } catch {}
    try { went = (H?.passport?.(u.email)?.stamps || []).filter((s) => s.public && ID_OK.test(s.eventId || "")).map((s) => s.eventId).slice(0, 100); } catch {}
    res.json({ signedIn: true, follows: [...new Set(follows)], friends, went }); });
  return M;
}
