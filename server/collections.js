// Collections: themed shelves on Discover ("Quiet and nerdy", "Good for going solo", "This weekend near you"...), each
// with its own page at /c/<id> (public/collections.html). They fill themselves from what's real: public upcoming events
// (their tags, format, comfort notes, time and place) and hosts whose guests say they'd go again. A small editorial file
// (server/collections.json) can pin, leave out, retitle or switch off a shelf. When real events are thin, a shelf adds a
// few ideas to host (server/ideas.js): suggestions, clearly labelled, never dressed up as events.
//
// What never shows on a shelf: private, unlisted or members-only events, events whose date has passed, sample and
// example pages, and preview pages for businesses that haven't joined (server/previews.js). eligible() is that rule,
// in one place, and test/collections.test.js holds it to it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { weekendOf, zoneOf, interestsOf, IDEAS } from "./hooks.js";
import { shareLine } from "./recognition.js";
import { allWorkspaceIds, getWorkspace, DEFAULT_WS } from "./workspaces.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const OVERRIDES_FILE = path.join(here, "collections.json");
const lc = (s) => String(s || "").trim().toLowerCase();
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const iso = (t) => new Date(t).toISOString().slice(0, 10);

/** An event a shelf may show: public, listed, upcoming, open to everyone, from a real host page. */
export function eligible(e, host = {}, today = iso(Date.now())) {
  if (!e || !e.id || !e.title) return false;
  if (e.private || e.unlisted || e._dup) return false;
  if (e.visibility === "members" || e.membersOnly || e.club?.only) return false;
  if (e.example || e.sample) return false;
  if (host?.prepared || host?.showcase || host?.example || host?.sample || host?.preview) return false;
  if (e.status && e.status !== "upcoming") return false;
  if (!ISO.test(e.start || "") || e.start < today) return false;
  return true;
}
/** A host a shelf may show: a real page, not a preview or an example. */
export const hostEligible = (h) => !!h && !!h.handle && !h.prepared && !h.showcase && !h.example && !h.sample && !h.preview;

const hourOf = (e) => { const m = String(e._start || e.startTime || "").match(/^(\d{1,2}):(\d{2})$/); if (m) return +m[1]; const t = String(e.time || "").match(/^(\d{1,2})(?::\d{2})?(am|pm)/i); return t ? (+t[1] % 12) + (/pm/i.test(t[2]) ? 12 : 0) : null; };
const textOf = (e) => lc(`${e.title} ${(e.tags || []).join(" ")} ${e.format || ""} ${(e.comfort_labels || []).join(" ")} ${e.first_30 || ""}`);
const hasWord = (t, words) => words.some((w) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(t));
const inCity = (e, city) => !city || lc(`${e.city} ${e.area}`).includes(lc(city));

const NERDY = ["board game", "boardgame", "game night", "games night", "tabletop", "d&d", "dnd", "dungeons", "ttrpg", "hack", "hackathon", "coding", "code", "build night", "maker", "demo night", "show and tell", "book club", "reading", "chess", "puzzle", "trivia", "quiz", "retro", "sci-fi", "science", "robot", "lan party", "crossword", "go club", "mahjong"];
const FOOD = ["supper", "dinner", "brunch", "tasting", "omakase", "dumpling", "ramen", "taco", "bakery", "bake", "pastry", "cake", "pop-up", "popup", "food", "market", "noodle", "pho", "banh mi", "bánh mì", "cheese", "coffee", "matcha", "wine", "picnic", "potluck", "street food", "cook"];
const COZY = ["supper", "dinner", "soup", "stew", "hot pot", "hotpot", "fondue", "cocoa", "cider", "mulled", "tea", "candle", "fireside", "knit", "book", "board game", "game night", "puzzle", "wine", "ramen", "dumpling", "bake", "pottery", "film", "movie", "records", "vinyl", "potluck"];
const SOLO_FORMATS = ["class", "workshop", "run", "hike", "book club", "game night", "tour", "talk"];
const SOLO_WORDS = ["solo", "come alone", "newcomer", "beginner", "all levels", "strangers", "first timers", "first-timers", "no experience"];

/** The shelves: what each one is about and who belongs on it. match(e, ctx) for events; hosts for "Most-loved hosts". */
export const DEFS = [
  { id: "weekend", title: "This weekend near you", titleAnywhere: "This weekend", intro: "Small things on this Friday to Sunday. Pick one and go.", interests: [],
    match: (e, x) => !!x.weekend && e.start >= x.weekend.from && e.start <= x.weekend.to && inCity(e, x.city) },
  { id: "quiet-nerdy", title: "Quiet and nerdy", intro: "Board games, hack nights and book clubs. Good company, low volume.", interests: ["games", "book", "talks"],
    match: (e) => hasWord(textOf(e), NERDY) || ["game night", "book club"].includes(e.format) || (e.comfort || []).includes("quiet") || e.noise === "quiet" },
  { id: "solo", title: "Good for going solo", intro: "Hosts who make a first-timer feel at home. Come on your own, leave with names.", interests: ["book", "games", "workshop", "run"],
    match: (e) => (e.comfort || []).includes("solo") || !!e.open_table || hasWord(textOf(e), SOLO_WORDS) || (SOLO_FORMATS.includes(e.format) && (e.group_size_expected == null || +e.group_size_expected <= 16)) },
  { id: "cozy-winter", title: "Cozy winter nights", intro: "Long tables, warm drinks and somewhere to be when it gets dark early.", interests: ["supper", "book", "games", "wine", "baking"], season: [11, 12, 1, 2],
    match: (e) => { const m = +String(e.start).slice(5, 7), h = hourOf(e); return [11, 12, 1, 2, 3].includes(m) && (hasWord(textOf(e), COZY) || (h != null && h >= 17 && ["dinner", "game night", "book club", "drinks", "workshop", "class"].includes(e.format))); } },
  { id: "eat-around", title: "Eat your way around", intro: "Supper clubs, pop-ups and bakes on a stoop. Come hungry.", interests: ["supper", "popup", "baking", "coffee", "matcha", "wine"],
    match: (e) => ["dinner", "brunch", "pop-up", "coffee", "picnic", "drinks"].includes(e.format) || !!e.preorder || hasWord(textOf(e), FOOD) },
  { id: "loved-hosts", title: "Most-loved hosts", intro: "Hosts whose guests say they'd go again. Follow one and hear first.", interests: [], hosts: true },
];
export const MIN_REAL = 4; // under this many real events, a shelf adds ideas to host
const LOVED_MIN = 3, LOVED_SHARE = 0.8; // "Most-loved": at least 3 guests left feedback and 80% or more would go again

export function loadOverrides(file = OVERRIDES_FILE) { try { const j = JSON.parse(fs.readFileSync(file, "utf8")); return { order: Array.isArray(j.order) ? j.order : [], hidden: Array.isArray(j.hidden) ? j.hidden : [], collections: j.collections && typeof j.collections === "object" ? j.collections : {} }; } catch { return { order: [], hidden: [], collections: {} }; } }

/**
 * Every shelf, filled. Pure: callers pass the data in.
 *   events: directory events (server/directory.js shape, with host.handle); hosts: Map or object of host records by handle
 *   loved: [{ handle, name, againYes, againOf, ... }] for "Most-loved hosts"; ideas: the ideas library
 */
export function buildCollections({ events = [], hosts = new Map(), loved = [], ideas = IDEAS, now = Date.now(), city = "", tz = "", overrides = { order: [], hidden: [], collections: {} } } = {}) {
  const H = hosts instanceof Map ? hosts : new Map(Object.entries(hosts || {})), today = iso(now), month = new Date(now).getUTCMonth() + 1;
  const pool = events.filter((e) => eligible(e, H.get(e.host?.handle) || {}, today));
  const ctx = { city: String(city || "").trim(), weekend: weekendOf(now, tz || zoneOf(city)), today };
  const order = [...(overrides.order || []), ...DEFS.map((d) => d.id)].filter((id, i, a) => a.indexOf(id) === i);
  const out = [];
  for (const id of order) { const d = DEFS.find((x) => x.id === id); if (!d || (overrides.hidden || []).includes(id)) continue;
    const O = overrides.collections?.[id] || {}, pin = (O.pin || []).map(String), ex = new Set((O.exclude || []).map((x) => lc(x)));
    const seasonal = !!d.season && !d.season.includes(month);
    const base = { id, title: O.title || (id === "weekend" && !ctx.city ? d.titleAnywhere : d.title), intro: O.intro || d.intro, seasonal };
    if (d.hosts) {
      const L = loved.filter((h) => hostEligible(H.size ? H.get(h.handle) : h) && !ex.has(lc(h.handle)) && h.againOf >= LOVED_MIN && h.againYes / h.againOf >= LOVED_SHARE)
        .sort((a, b) => pin.indexOf(b.handle) - pin.indexOf(a.handle) || b.againYes / b.againOf - a.againYes / a.againOf || b.againOf - a.againOf)
        .map((h) => ({ ...h, again: shareLine(h.againYes, h.againOf, "guests", "would go again") }));
      out.push({ ...base, kind: "hosts", events: [], hosts: L, ideas: [], count: L.length }); continue; }
    if (seasonal) continue; // "Cozy winter nights" sleeps through the summer
    const rank = (e) => (pin.includes(e.id) || pin.includes(e.host?.handle) ? -1 : 0);
    const L = pool.filter((e) => !ex.has(lc(e.id)) && !ex.has(lc(e.host?.handle)) && (d.match(e, ctx) || pin.includes(e.id)))
      // the chosen city first, then soonest; pinned ones lead
      .sort((a, b) => rank(a) - rank(b) || (inCity(b, ctx.city) - inCity(a, ctx.city)) || a.start.localeCompare(b.start) || String(a.title).localeCompare(String(b.title)));
    const fill = L.length < MIN_REAL ? ideas.filter((x) => d.interests.includes((x.interests || [])[0])).slice(0, Math.max(0, MIN_REAL - L.length)) : [];
    out.push({ ...base, kind: "events", events: L, hosts: [], ideas: id === "weekend" ? [] : fill, count: L.length });
  }
  return out;
}

/** A card for one event: what a calm card needs, nothing about who's going. */
export function eventCard(e, rel = (u) => u) {
  return { id: e.id, title: e.title, date: e.start, time: String(e.time || "").split(" to ")[0], city: e.city || "", area: e.area || "", format: e.format || "", price: e.price || "", spots_left: e.spots_left ?? null,
    host: { handle: e.host?.handle || "", name: e.host?.name || "" }, url: rel(e.url) || "/e/" + encodeURIComponent(e.id), cover: rel(e.cover || "") || "", ask: !!e.ask_to_join, comfort: (e.comfort_labels || []).slice(0, 2) };
}
const ideaCard = (x) => ({ id: x.id, title: x.title, line: x.line, art: x.art, tone: x.tone, url: "/ideas#" + x.id, say: x.say });

export function mountCollections(app, { C, X, sendStatic, publicOrigin }) {
  const base = (req) => String(publicOrigin(req) || "").replace(/\/+$/, "");
  let ov = { at: 0, data: null }; const overrides = () => { if (!ov.data || Date.now() - ov.at > 60e3) ov = { at: Date.now(), data: loadOverrides() }; return ov.data; };
  // hosts whose guests say they'd go again, from the same numbers their page uses (server/social.js hostStrengths)
  let lovedCache = null;
  function loved() { if (lovedCache && Date.now() - lovedCache.at < 60e3) return lovedCache.L; const L = [];
    for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; const h = C.profileOf(ws); if (!h?.handle || /@demo\.encore$/i.test(getWorkspace(ws)?.ownerEmail || "")) continue; let S; try { S = X.hostStrengths(ws); } catch { continue; }
      if (!S?.againOf) continue; L.push({ handle: h.handle, name: h.name || h.handle, city: h.city || "", area: h.hood || "", tagline: h.tagline || "", emoji: h.emoji || "", accent: h.theme?.accent || h.color || "", avatarArt: h.theme?.avatarArt || "", avatarUrl: /^\/_blob\/[A-Za-z0-9]{20}$/.test(h.theme?.avatarUrl || "") ? h.theme.avatarUrl : "", againYes: S.againYes || 0, againOf: S.againOf || 0, events: S.events || 0 }); }
    lovedCache = { at: Date.now(), L }; return L; }
  function all(req, city) {
    const b = base(req), Dir = app.locals.directory, K = app.locals.hooks?.catalog?.(b), rel = (u) => app.locals.hooks?.rel ? app.locals.hooks.rel(b, u) : u;
    let events = []; try { events = Dir.filterEvents(b, { status: "upcoming", include_examples: "1" }); } catch {}
    // members-only events never reach the directory; this is the belt to that brace
    const F = app.locals.fanclub; if (F?.visibility) events = events.filter((e) => { try { const ws = C.wsOfHandle(e.host?.handle); return !ws || F.visibility(ws, e.id) !== "members"; } catch { return true; } });
    const L = buildCollections({ events, hosts: K?.hosts || new Map(), loved: loved(), city, overrides: overrides() });
    const nextOf = new Map(); for (const e of events) if (eligible(e, K?.hosts?.get(e.host?.handle) || {}) && !nextOf.has(e.host.handle)) nextOf.set(e.host.handle, e);
    return L.map((c) => ({ ...c, events: c.events.map((e) => eventCard(e, rel)), ideas: c.ideas.map(ideaCard), hosts: c.hosts.map((h) => { const n = [...events].sort((a, b) => a.start.localeCompare(b.start)).find((e) => e.host?.handle === h.handle && eligible(e, K?.hosts?.get(h.handle) || {}));
      return { handle: h.handle, name: h.name, city: h.city, area: h.area, tagline: h.tagline, emoji: h.emoji, accent: h.accent, avatarArt: h.avatarArt, avatarUrl: h.avatarUrl, again: h.again?.text || "", events: h.events, next: n ? eventCard(n, rel) : null }; }) }));
  }
  const cityOf = (req) => String(req.query.city || "").replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, 60);
  app.get("/api/public/collections", (req, res) => { res.set("Cache-Control", "public, max-age=60");
    // the shelves: a few cards each, only shelves with something on them
    res.json({ collections: all(req, cityOf(req)).filter((c) => c.count > 0 || c.ideas.length).map((c) => ({ id: c.id, title: c.title, intro: c.intro, kind: c.kind, count: c.count, events: c.events.slice(0, 8), hosts: c.hosts.slice(0, 8), ideas: c.count ? c.ideas.slice(0, 2) : [], url: "/c/" + c.id })).filter((c) => c.count > 0) }); });
  app.get("/api/public/collections/:id", (req, res) => { const c = all(req, cityOf(req)).find((x) => x.id === String(req.params.id || "")); if (!c) return res.status(404).json({ code: "not_found", message: "That collection isn't here." });
    res.set("Cache-Control", "public, max-age=60"); res.json({ collection: { ...c, url: "/c/" + c.id }, others: DEFS.filter((d) => d.id !== c.id).map((d) => ({ id: d.id, title: d.title, url: "/c/" + d.id })) }); });
  app.get("/collections", (req, res) => sendStatic(res, "collections.html", "<p>Collections page missing.</p>"));
  app.get("/c/:id", (req, res) => { if (!DEFS.some((d) => d.id === req.params.id)) { res.status(404); return sendStatic(res, "404.html", "<p>Page not found.</p>"); } sendStatic(res, "collections.html", "<p>Collections page missing.</p>"); });
  return { all, buildCollections };
}
