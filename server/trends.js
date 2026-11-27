// Potto's idea engine: what to host next, grounded first in what people on Pottery Lab actually loved.
//
// Three sources, ranked in this order, and always labelled so nobody mistakes one for another:
//   platform   "Loved here: 18 guests, 94% would go again". Measured from events on Pottery Lab (below).
//   editorial  "Trending on social". The team's hand-written trend notes (server/trendnotes.js). Never measured.
//   potto      "An idea from Potto". The ideas library (server/ideas.js) and, with a key, a few general ideas from the
//              model (server/ai.js complete), cached a day. General ideas, never data.
//
// Platform signals, per event (collect): who came (replies and the guest list, real emails only, never the host),
// fill rate (spots, or a drop's sell-through), the waitlist, kudos and "Would go again" (verified guests only, the same
// definition as server/social.js), "I'd go again" (server/curation.js), saves and list adds (server/hooks.js,
// server/library.js), feed kudos and comments on its card and recap, follows the host gained in the week after, and
// repeat guests (people who came to an earlier one by the same host). Events are grouped by format (FORMATS, finer than
// public/eventtypes.js types), by city and neighbourhood, and read by season and day of week.
//
// Scoring (scoreGroup): every event weighs by its age (decay: full for 30 days, half at 90, a quarter at 150), each
// rate is Bayesian-smoothed toward the platform's own average (smooth) so a few kudos can't make 100%, and one event's
// guests count up to PER_EVENT_CAP so one viral night can't carry a format. Nothing is called trending until it has
// at least MIN_HOSTS different hosts and MIN_GUESTS guests (ENCORE_TRENDS_MIN_HOSTS, ENCORE_TRENDS_MIN_GUESTS).
//
// Privacy: only events anyone could find on Discover count (not private, friends-only, unlisted, members-only, a
// sample, an example, a preview or cancelled), only real accounts host them, and only aggregate counts ever leave this
// file: no event id, host, guest, name or email is in any answer. The computation is cached for an hour.
//
// Routes: GET /api/public/trends?city=&type=&season=, GET /api/public/ideas/suggest (3 to 5 ideas and "more"),
// GET /api/me/trends/home (the host's "What's working near you" card and how their last event compared), and the
// admin notes routes GET/POST /api/admin/trend-notes, POST /api/admin/trend-notes/:id/retire.
import crypto from "node:crypto";
import { scopeStore, getWorkspace, getDbUser, DEFAULT_WS } from "./workspaces.js";
import { typeOf, TYPES } from "./eventtypes.js";
import { complete, aiMode, parseJsonLoose } from "./ai.js";
import { makeTrendNotes, seasonOf, fits, SEASONS } from "./trendnotes.js";
import { isAdmin } from "./metrics.js";

const DAY = 864e5;
const lc = (s) => String(s || "").trim().toLowerCase();
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\u2014/g, ", ").replace(/\s+/g, " ").trim().slice(0, n);
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const h24 = (s) => crypto.createHash("sha256").update(lc(s)).digest("hex").slice(0, 24); // server/curation.js hash
const h20 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 20); // server/feedblend.js hashKey
const cap1 = (s) => String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1);
const pct = (x) => Math.round(x * 100);
const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

export const MIN_HOSTS = () => Math.max(1, +process.env.ENCORE_TRENDS_MIN_HOSTS || 3);
export const MIN_GUESTS = () => Math.max(1, +process.env.ENCORE_TRENDS_MIN_GUESTS || 15);
export const CACHE_MS = 3600e3;
export const PER_EVENT_CAP = 40;
export const WINDOW_DAYS = 365;
export const SOURCE = { platform: "Loved here", editorial: "Trending on social", potto: "An idea from Potto" };

// ---------- formats: finer than the event types, specific first ----------
// key, title (one, for a suggestion), label (many, for a reason line), one/many (plain nouns for "your run"), the
// event type, the canvas kind it starts from (public/canvas.js PLAN_KINDS), interests (public/interests.json), say
const F = (key, title, label, one, many, re, type, kind, interests, say) => ({ key, title, label, one, many, re, type, kind, interests, say });
export const FORMATS = [
  F("mahjong", "Mahjong night", "Mahjong nights", "mahjong night", "mahjong nights", /mahjong/, "games", "game", ["games"], "A mahjong night for 8 Friday at 7, beginners welcome"),
  F("singles", "Singles night", "Singles nights", "singles night", "singles nights", /singles|speed dat/, "party", "drinks", [], "A singles night Thursday at 7 with something to do"),
  F("sound-bath", "Sound bath", "Sound baths", "sound bath", "sound baths", /sound bath|sound healing|breathwork|meditat/, "active", "", ["movement"], "A sound bath Sunday at 10, mats and tea after"),
  F("pickleball", "Pickleball meetup", "Pickleball meetups", "pickleball meetup", "pickleball meetups", /pickleball|padel/, "active", "", ["movement"], "A pickleball meetup Saturday at 10, mixed levels"),
  F("run-coffee", "Run, then coffee", "Runs with coffee after", "run", "runs", /(\brun\b|running|5k|10k|jog).*(coffee|bagel|brunch|caf[eé]|pastr)|(coffee|bagel).*\brun\b/, "active", "run", ["run", "coffee"], "An easy 5k run club Saturday at 8, coffee after"),
  F("run", "Run club", "Run clubs", "run", "runs", /\brun\b|running|\bruns\b|5k|10k|jog/, "active", "run", ["run"], "An easy 5k run club Saturday at 8"),
  F("walk", "Walking club", "Walking clubs", "walk", "walks", /\bwalk/, "active", "run", ["hike"], "A walking club Sunday at 9, a set route and a bakery stop"),
  F("hike", "Group hike", "Group hikes", "hike", "hikes", /hike|trail/, "active", "hike", ["hike"], "A group hike Saturday at 8:30, rides shared"),
  F("supper-club", "Supper club", "Supper clubs", "supper club", "supper clubs", /supper|tasting menu|chef'?s table/, "dinner", "dinner", ["supper"], "A supper club for 8 at my place Saturday at 7, three courses"),
  F("cooking-party", "Dumpling or pasta night", "Cook-together nights", "cooking night", "cooking nights", /dumpling|pasta|sushi|taco|pizza night|cook/, "dinner", "dinner", ["supper", "baking"], "A dumpling-folding night for 10 Sunday at 5, everyone folds"),
  F("potluck", "Potluck", "Potlucks", "potluck", "potlucks", /potluck/, "dinner", "potluck", ["supper"], "A potluck Sunday at 6, everyone brings one dish"),
  F("holiday-swap", "Holiday swap", "Holiday dinners and swaps", "holiday get-together", "holiday get-togethers", /friendsgiving|cookie (swap|exchange)|gift swap|secret santa|holiday/, "party", "potluck", [], "A cookie swap Saturday at 3, bring a dozen"),
  F("dinner-party", "Dinner party", "Dinner parties", "dinner", "dinners", /dinner/, "dinner", "dinner", ["supper"], "A dinner party for 6 Friday at 7"),
  F("brunch", "Brunch", "Brunches", "brunch", "brunches", /brunch/, "dinner", "brunch", ["coffee"], "A slow brunch for 6 Sunday at 11"),
  F("coffee-popup", "Matcha or coffee morning", "Matcha and coffee mornings", "coffee morning", "coffee mornings", /matcha|coffee|caf[eé]|espresso|\btea\b/, "event", "brunch", ["matcha", "coffee"], "A matcha tasting morning for 10 Sunday at 10"),
  F("pottery-class", "Pottery class", "Pottery classes", "pottery class", "pottery classes", /pottery|wheel|clay|ceramic/, "class", "class", ["pottery", "crafts"], "A pottery night for 6 Thursday at 7, wheel throwing for beginners"),
  F("craft-night", "Craft night", "Craft nights", "craft night", "craft nights", /craft|knit|embroider|paint|sketch|bouquet|flower|candle|collage/, "class", "class", ["crafts"], "A craft night for 8 Thursday at 7, everything provided"),
  F("baking", "Baking class", "Baking classes", "bake", "bakes", /bake|sourdough|bread|cookie|pastry/, "class", "class", ["baking"], "A sourdough class for 6 Saturday at 10"),
  F("game-night", "Game night", "Game nights", "game night", "game nights", /board game|game night|\bgames?\b|trivia|chess/, "games", "game", ["games"], "A game night for 8 Friday at 7, bring a game"),
  F("book-club", "Book club", "Book clubs", "book club", "book clubs", /\bbook/, "talk", "book", ["book"], "A book club Tuesday at 7, finished or not, come"),
  F("listening-night", "Listening night", "Listening nights", "listening night", "listening nights", /listening|vinyl|album/, "event", "drinks", [], "A listening night Friday at 8, one album start to finish"),
  F("gallery-night", "Gallery night", "Gallery nights", "gallery night", "gallery nights", /gallery|art show|exhibit/, "event", "drinks", ["crafts"], "A gallery night Thursday at 7, friends' work on the walls"),
  F("yoga", "Yoga session", "Yoga sessions", "yoga session", "yoga sessions", /yoga|pilates/, "active", "", ["movement"], "Sunset yoga on the roof Wednesday at 6:30, tea after"),
  F("dance", "Dance night", "Dance nights", "dance night", "dance nights", /salsa|dance|bachata/, "event", "", ["dance"], "Salsa in the park Sunday at 5, a free beginner lesson first"),
  F("improv", "Improv jam", "Improv jams", "improv jam", "improv jams", /improv|comedy/, "talk", "", ["improv"], "An improv jam for beginners Wednesday at 7"),
  F("picnic", "Picnic", "Picnics", "picnic", "picnics", /picnic/, "party", "picnic", ["picnic"], "A picnic in the park Sunday at 1, everyone brings one thing"),
  F("market", "Pop-up market", "Pop-up markets", "pop-up", "pop-ups", /market|pop-?up|stall|\bsale\b|\bswap\b/, "popup", "popup", ["popup", "market"], "A makers' market Saturday at noon, six tables"),
  F("wine", "Wine night", "Wine nights", "wine night", "wine nights", /wine|cocktail/, "event", "drinks", ["wine"], "A natural wine swap Friday at 7, everyone brings one bottle"),
  F("hack-night", "Hack night", "Hack nights", "hack night", "hack nights", /hack|build night|demo night/, "games", "hack", [], "A hack night Thursday at 6:30, demos at the end"),
  F("watch-party", "Watch party", "Watch parties", "watch party", "watch parties", /watch party|movie|film|screening/, "games", "watch", [], "A watch party Sunday at 7, snacks to share"),
  F("salon", "Living-room salon", "Salons and talks", "talk", "talks", /\btalks?\b|salon|panel|lecture/, "talk", "", ["talks"], "A living-room salon Thursday at 7, one short talk then a big conversation"),
  F("workshop", "Workshop", "Workshops", "workshop", "workshops", /class|workshop|lesson/, "class", "class", ["workshop"], "A hands-on workshop for 8 Saturday at 2"),
  F("drinks", "Drinks", "Drinks nights", "drinks", "drinks nights", /drinks|happy hour/, "party", "drinks", [], "Drinks after work Thursday at 6:30"),
  F("trip", "Weekend away", "Weekends away", "weekend away", "weekends away", /weekend|trip|cabin|getaway/, "trip", "weekend", [], "A weekend away for 8, one house, shared costs"),
];
export const FORMAT_BY = new Map(FORMATS.map((f) => [f.key, f]));
const DROP = F("drop", "Order-ahead drop", "Order-ahead drops", "drop", "drops", /$^/, "pickup", "drop", ["popup", "baking"], "");
FORMAT_BY.set("drop", DROP);
/** The format key for an event or an idea, or "" when nothing fits. Pure. */
export function formatOf(e = {}) {
  const t = lc(`${e.pubTitle || e.name || e.title || ""} ${e.activity || ""} ${e.format || ""} ${e.typeLabel || ""} ${e.line || ""}`);
  const f = FORMATS.find((x) => x.re.test(t)); if (f) return f.key;
  return e.drop || e.preorder ? "drop" : "";
}

// ---------- the maths ----------
/** How much an event of this age (days) counts: 1 up to 30 days, then halving every 60 days. Upcoming counts fully. */
export const decay = (age) => (age <= 30 ? 1 : 0.5 ** ((age - 30) / 60));
/** A rate pulled toward the prior: (yes + m * prior) / (of + m). A few answers barely move it; many answers decide. */
export const smooth = (yes, of, prior, m) => (yes + m * prior) / (of + m);

// ---------- who counts publicly ----------
const closed = (e) => e.private === true || e.friendsOnly === true || e.visibility === "private" || e.visibility === "friends";
/** Could anyone find this event on Discover? Members-only, private, friends-only, unlisted, examples and samples don't count. */
export const countsPublicly = (e, membersOnly = false) => !!e && !!e.discoverable && !e.unlisted && !e.cancelled && !e.example && !e.sample && !e.preview && !closed(e) && !membersOnly && !e.membersOnly && !e.clubOnly;
const fakeEmail = (em) => !em || /@demo\.encore$/i.test(em) || /@(example\.invalid|preview\.encore)$/i.test(em);

/** Every public event's signals, one record each. Internal only: records never leave this file. */
export function collect({ store, X, C = null, app = null, now = Date.now() }) {
  const I = X.index(), fc = app?.locals?.fanclub || null, recs = [];
  const guestsOf = new Map(); for (const [em, L] of I.att) for (const a of L) { let S = guestsOf.get(a.eventId); if (!S) guestsOf.set(a.eventId, (S = new Set())); S.add(lc(em)); }
  const kudosOf = new Map(); for (const k of I.kudos) { if (!k?.eventId) continue; let L = kudosOf.get(k.eventId); if (!L) kudosOf.set(k.eventId, (L = [])); L.push(k); }
  // saves and list adds: one per person per event (a heart and a list add by the same person count once)
  const saves = new Map(), addSave = (id, who) => { let S = saves.get(id); if (!S) saves.set(id, (S = new Set())); S.add(who); };
  try { for (const d of store.listPrefix("system", "plsave-")) for (const i of d.data?.items || []) if (i?.kind === "event" && i.ref) addSave(i.ref, d.id); } catch {}
  try { for (const d of store.listPrefix("system", "pllib-")) for (const L of d.data?.lists || []) for (const i of L?.items || []) if (i?.kind === "event" && i.ref) addSave(i.ref, d.id); } catch {}
  const byWs = new Map(); for (const x of I.events.values()) { let L = byWs.get(x.ws); if (!L) byWs.set(x.ws, (L = [])); L.push(x); }
  for (const [ws, L] of byWs) {
    if (!ws || ws === DEFAULT_WS) continue; const W = getWorkspace(ws), owner = lc(W?.ownerEmail);
    if (!W || fakeEmail(owner) || !getDbUser(owner)) continue; // real accounts only: no samples, demos or previews
    const S = scopeStore(store, ws); let R = []; try { R = (S.listShared ? S.listShared("rsvps") : S.list("rsvps")).map((d) => d.data).filter(Boolean); } catch {}
    let fol = []; try { fol = (C?.followersOf?.(ws) || []).filter((f) => f && +f.at); } catch {}
    const seen = new Set(); // guests at this host's earlier public events, for repeat guests
    for (const x of L.filter((y) => /^\d{4}-\d{2}-\d{2}$/.test(y.e?.date || "")).sort((a, b) => a.e.date.localeCompare(b.e.date))) {
      const e = x.e; let members = false; try { members = fc?.visibility?.(ws, x.id) === "members"; } catch {}
      if (!countsPublicly(e, members)) continue;
      const at = Date.parse(e.date + "T12:00:00Z"), age = (now - at) / DAY; if (age > WINDOW_DAYS || age < -21) continue;
      const past = age > 0, G = [...(guestsOf.get(x.id) || [])].filter((em) => em !== owner && !fakeEmail(em)), guests = G.length;
      const repeat = G.filter((em) => seen.has(em)).length; if (past) for (const em of G) seen.add(em);
      let fill = null; const cap = +e.headcount || +e.capacity || 0;
      if (e.drop || e.preorder) { const stock = (e.orderItems || []).reduce((n, i) => n + (+i?.stock || 0), 0); if (stock > 0) { let sold = 0; for (const r of R) if (r.eventId === x.id && r.response !== "no" && !r.cancelledAt) for (const l of r.orderLines || []) sold += Math.max(0, Math.floor(+l.qty) || 0); fill = Math.min(1, sold / stock); } }
      else if (cap > 0) fill = Math.min(1, guests / cap);
      const waitlist = R.filter((r) => r.eventId === x.id && r.response === "waitlist").length;
      const K = (kudosOf.get(x.id) || []).filter((k) => k.verified && (k.love || (k.tags || []).length || k.compare));
      const againYes = K.filter((k) => (k.tags || []).includes("again") || k.compare === "better").length;
      let vouches = 0; try { vouches = (store.get("system/plvouch-" + h24("event:" + x.id))?.data?.by || []).length; } catch {}
      let buzz = 0; try { for (const t of ["e:", "r:"]) buzz += +store.get("system/feedkudos-" + h20("k:" + t + x.id))?.data?.n || 0; buzz += (store.get("system/feedcom-" + h20("c:ev:" + x.id))?.data?.list || []).filter((c) => !c?.hidden).length; } catch {}
      const follows = past ? fol.filter((f) => f.at >= at - DAY / 2 && f.at <= at + 7 * DAY).length : 0;
      const d = new Date(at);
      recs.push({ ws, format: formatOf(e), type: typeOf(e), city: clean(e.city, 60), hood: clean(e.hood, 60), age, past, dow: d.getUTCDay(), season: seasonOf(at),
        guests, fill, waitlist, againYes, againOf: K.length, saves: saves.get(x.id)?.size || 0, vouches, buzz, follows, repeat, host: !!owner });
    }
  }
  return recs;
}

// ---------- groups ----------
function newGroup(key, f, city, hood) { return { key, format: f, city, hood, hosts: new Set(), w: 0, events: 0, wGuests: 0, guestsPast: 0, yesW: 0, ofW: 0, fillW: 0, fillN: 0, waitW: 0, evW: 0, repW: 0, buzzW: 0, dow: new Array(7).fill(0), win: { 30: newWin(), 90: newWin(), [WINDOW_DAYS]: newWin() } }; }
const newWin = () => ({ hosts: new Set(), guests: 0, yes: 0, of: 0, events: 0 });
function addTo(g, r) {
  const w = decay(r.age); g.hosts.add(r.ws); g.events++; g.w += w; g.evW += w;
  g.wGuests += w * Math.min(r.guests, PER_EVENT_CAP); if (r.waitlist > 0) g.waitW += w;
  if (r.fill != null) { g.fillW += w * r.fill; g.fillN += w; }
  if (r.past) { g.yesW += w * r.againYes; g.ofW += w * r.againOf; g.guestsPast += w * r.guests; g.repW += w * r.repeat; g.buzzW += w * (r.saves + r.vouches + r.buzz + r.follows); g.dow[r.dow] += w; }
  else g.buzzW += w * (r.saves + r.vouches);
  for (const d of [30, 90, WINDOW_DAYS]) if (r.age <= d) { const W = g.win[d]; W.hosts.add(r.ws); W.guests += r.guests; W.yes += r.againYes; W.of += r.againOf; W.events++; }
}
/** The platform's own averages, the priors every group is smoothed toward. */
export function priors(recs) { let yes = 0, of = 0, fill = 0, fn = 0, rep = 0, gp = 0;
  for (const r of recs) { const w = decay(r.age); if (r.past) { yes += w * r.againYes; of += w * r.againOf; rep += w * r.repeat; gp += w * r.guests; } if (r.fill != null) { fill += w * r.fill; fn += w; } }
  return { again: smooth(yes, of, 0.6, 20), fill: smooth(fill, fn, 0.6, 5), repeat: smooth(rep, gp, 0.15, 30) }; }
/** A group's score, 0 to 100. See the top of the file. */
export function scoreGroup(g, P = { again: 0.6, fill: 0.6, repeat: 0.15 }) {
  const again = smooth(g.yesW, g.ofW, P.again, 10), fill = smooth(g.fillW, g.fillN, P.fill, 3), wait = smooth(g.waitW, g.evW, 0.1, 5), repeat = smooth(g.repW, g.guestsPast, P.repeat, 30);
  const buzz = Math.min(1, (g.buzzW / (g.guestsPast + 30)) * 3), reach = Math.min(1, Math.log1p(g.wGuests) / Math.log1p(150));
  return Math.round(1000 * (0.35 * again + 0.2 * fill + 0.1 * wait + 0.15 * repeat + 0.1 * buzz + 0.1 * reach)) / 10;
}
/** Big enough to call: at least MIN_HOSTS hosts and MIN_GUESTS guests in the window. */
export const gated = (W) => W.hosts.size >= MIN_HOSTS() && W.guests >= MIN_GUESTS();
/** Group records by format and place. level: "city" | "hood" | "all". */
export function groupsOf(recs, level = "city") {
  const M = new Map();
  for (const r of recs) { if (!r.format) continue; if (level !== "all" && !r.city) continue; if (level === "hood" && !r.hood) continue;
    const key = level === "all" ? r.format : level === "hood" ? `${r.format}|${lc(r.city)}|${lc(r.hood)}` : `${r.format}|${lc(r.city)}`;
    let g = M.get(key); if (!g) M.set(key, (g = newGroup(key, r.format, level === "all" ? "" : r.city, level === "hood" ? r.hood : ""))); addTo(g, r); }
  return [...M.values()];
}
const PERIOD = { 30: "this month", 90: "in the last 3 months", [WINDOW_DAYS]: "this year" };
/** What a group shows the world: aggregate counts and plain words, nothing about any one event or person. */
export function publicView(g, P) {
  const d = [30, 90, WINDOW_DAYS].find((k) => gated(g.win[k])); if (!d) return null;
  const f = FORMAT_BY.get(g.format), W = g.win[d], again = W.of >= 5 ? pct(W.yes / W.of) : null, place = g.hood || g.city;
  const total = g.dow.reduce((a, b) => a + b, 0), top = g.dow.indexOf(Math.max(...g.dow)), bestDay = total && g.events >= 3 && g.dow[top] / total >= 0.4 ? WEEKDAYS[top] : "";
  const counts = again != null ? `${W.hosts.size} hosts, ${again}% would go again` : `${W.hosts.size} hosts, ${W.guests} guests`;
  const reason = `${f.label} ${place ? "in " + place : "on Pottery Lab"}: ${counts} ${PERIOD[d]}`;
  const sourceLine = `${place ? "Loved here" : "Loved on Pottery Lab"}: ${W.guests} guests${again != null ? `, ${again}% would go again` : `, ${W.hosts.size} hosts`}`;
  return { format: g.format, title: f.title, label: f.label, type: f.type, kind: f.kind, city: g.city, hood: g.hood, hosts: W.hosts.size, guests: W.guests, events: W.events, again,
    fill: g.fillN ? pct(smooth(g.fillW, g.fillN, P.fill, 3)) : null, bestDay, period: PERIOD[d], score: scoreGroup(g, P), reason, source: "platform", sourceLine };
}

// ---------- the engine ----------
export function makeTrends({ store, X, C = null, app = null, IDEAS = () => [], clock = () => Date.now() }) {
  const notes = makeTrendNotes(store);
  let state = null;
  function compute(now = clock()) { if (state && now - state.at < CACHE_MS) return state;
    let recs = []; try { recs = collect({ store, X, C, app, now }); } catch (e) { console.warn("[trends]", e?.message); }
    state = { at: now, recs, P: priors(recs), views: new Map() }; return state; }
  const bust = () => { state = null; };
  /** Top platform formats, aggregates only. city "" = across Pottery Lab. */
  function top({ city = "", type = "", season = "", n = 10 } = {}, now = clock()) {
    const St = compute(now), k = `${lc(city)}|${type}|${season}`; if (St.views.has(k)) return St.views.get(k).slice(0, n);
    let R = St.recs; if (season) R = R.filter((r) => r.season === season); if (type) R = R.filter((r) => FORMAT_BY.get(r.format)?.type === type);
    let L;
    if (city) { R = R.filter((r) => lc(r.city) === lc(city)); const C0 = groupsOf(R, "city").map((g) => publicView(g, St.P)).filter(Boolean), have = new Set(C0.map((x) => x.format));
      L = [...C0, ...groupsOf(R, "hood").map((g) => publicView(g, St.P)).filter((x) => x && !have.has(x.format))]; }
    else L = groupsOf(R, "all").map((g) => publicView(g, St.P)).filter(Boolean);
    L.sort((a, b) => b.score - a.score || b.guests - a.guests); const seen = new Set(); L = L.filter((x) => !seen.has(x.format) && seen.add(x.format));
    St.views.set(k, L); return L.slice(0, n); }

  // ideas from the model: general ideas, never data. Cached a day per city and season; requests never wait for it.
  const model = new Map(), pending = new Set();
  function modelIdeas(city, season, now = clock()) { const k = lc(city) + "|" + season, c = model.get(k); if (c && now - c.at < DAY) return c.ideas;
    if (aiMode() === "live" && !pending.has(k) && pending.size < 4) { pending.add(k);
      const prompt = `POTTO-TREND-IDEAS\nSuggest 5 small social get-togethers a person could host${city ? ` in ${clean(city, 60)}` : ""} this ${season}. These are general ideas, not data: no numbers, no statistics, no app, brand or venue names. Plain words, no em dashes.\nReply with only JSON: {"ideas": [{"title": string (under 40 characters), "line": string (one sentence), "say": string (the plan in one line, like "A soup night for 10 Saturday at 6")}]}`;
      complete({ prompt, effort: "low" }).then((r) => { const j = parseJsonLoose(r.text); const L = (Array.isArray(j?.ideas) ? j.ideas : []).map((x) => ({ title: clean(x?.title, 40), line: clean(x?.line, 140), say: clean(x?.say, 160) }))
        .filter((x) => x.title.length > 2 && x.line && !/\d+\s*%|\bpercent\b/i.test(x.title + x.line)).slice(0, 5); model.set(k, { at: clock(), ideas: L }); })
        .catch(() => model.set(k, { at: clock(), ideas: [] })).finally(() => pending.delete(k)); }
    return c?.ideas || []; }

  const SEASON_WORDS = { winter: /soup|game|mahjong|movie|watch|bake|sourdough|dumpling|supper|salon|book|matcha|coffee|pottery|wheel|holiday|swap|listening/, spring: /run|hike|picnic|walk|sketch|bouquet|market|coffee|salsa/, summer: /picnic|park|run|hike|sunset|yoga|roof|salsa|taco|wine|market|bagel|pickleball/, autumn: /supper|potluck|dumpling|pottery|wheel|book|salon|improv|game|run|hike|wine|sourdough|mahjong|listening/ };
  /**
   * Ideas for one person, best first: platform trends in their city, then the platform overall, then trend notes for
   * the season, then Potto's general ideas. Within a tier, their interests and what they've hosted lift an idea a
   * little. Formats they did recently never show (no "host a run" the week after their run).
   * Returns { ideas: [{ id, title, line, say, format, type, kind, source, sourceLine }], more, total }.
   */
  function suggest({ city = "", interests = [], made = [], recent = [], n = 4, offset = 0, season = "" } = {}, now = clock()) {
    season = SEASONS.includes(season) ? season : seasonOf(now); n = Math.max(3, Math.min(5, +n || 4)); offset = Math.max(0, Math.min(60, +offset || 0));
    const I = new Set(interests.map(lc)), madeT = new Set(made.map(lc)), made_ = made.map(lc).join(" "), skip = new Set(recent.map((x) => (FORMAT_BY.has(x) ? x : formatOf({ title: x }))).filter(Boolean));
    const fit = (fk) => { const f = FORMAT_BY.get(fk); if (!f) return 0; let s = f.interests.filter((k) => I.has(k)).length * 2; if (f.re.test(made_)) s += 1; return s; };
    const tiers = [[], [], [], []];
    for (const x of top({ city, n: 12 }, now)) tiers[0].push({ ...x, s: x.score, id: "trend-" + x.format, line: FORMAT_BY.get(x.format)?.say || "", say: FORMAT_BY.get(x.format)?.say || x.title });
    if (city) for (const x of top({ n: 12 }, now)) tiers[1].push({ ...x, s: x.score, id: "trend-" + x.format, line: FORMAT_BY.get(x.format)?.say || "", say: FORMAT_BY.get(x.format)?.say || x.title });
    for (const nt of notes.active(now).filter((x) => fits(x, { season, city }))) { const f = FORMAT_BY.get(nt.format);
      tiers[2].push({ id: nt.id, title: nt.name, line: nt.line, say: nt.say, format: nt.format || formatOf({ title: nt.name, line: nt.line }), type: f?.type || "event", kind: f?.kind || "", s: nt.cities?.length ? 5 : 0, source: "editorial", sourceLine: SOURCE.editorial }); }
    const sw = SEASON_WORDS[season];
    for (const x of [...modelIdeas(city, season, now).map((m, i) => ({ id: "potto-" + h20(m.title).slice(0, 10), title: m.title, line: m.line, say: m.say || m.title, s: 3 - i * 0.1 })), ...(typeof IDEAS === "function" ? IDEAS() : IDEAS || []).map((x) => ({ id: x.id, title: x.title, line: x.line, say: x.say, s: sw.test(lc(x.title + " " + x.line)) ? 1 : 0 }))]) {
      const fk = formatOf({ title: x.title, line: x.line }), f = FORMAT_BY.get(fk); tiers[3].push({ ...x, format: fk, type: f?.type || "event", kind: f?.kind || "", source: "potto", sourceLine: SOURCE.potto }); }
    const day = iso(now), jitter = (id) => parseInt(h20(id + day).slice(0, 6), 16) / 0xffffff; // a steady daily shuffle among equals
    const out = [], fmts = new Set(), titles = new Set();
    for (const T of tiers) for (const x of T.map((x) => ({ x, k: x.s + fit(x.format) * (x.source === "platform" ? 4 : 1) + (x.source === "platform" ? 0 : jitter(x.id) * 0.5) })).sort((a, b) => b.k - a.k).map((y) => y.x)) {
      if (x.format && (fmts.has(x.format) || skip.has(x.format))) continue; if (titles.has(lc(x.title)) || madeT.has(lc(x.title))) continue;
      if (x.format) fmts.add(x.format); titles.add(lc(x.title));
      out.push({ id: x.id, title: x.title, line: x.line || "", say: x.say || x.title, format: x.format || "", type: x.type || "event", kind: x.kind || "", source: x.source, sourceLine: x.sourceLine, ...(x.reason ? { reason: x.reason } : {}) }); }
    return { ideas: out.slice(offset, offset + n), more: out.length > offset + n, total: out.length, offset, season };
  }
  /** The same labels on the ideas library's own entries (ideasnudge, the swipe deck): which source vouches for each. */
  function annotate(list, { city = "" } = {}, now = clock()) {
    const plat = new Map(); for (const x of [...(city ? top({ city, n: 30 }, now) : []), ...top({ n: 30 }, now)]) if (!plat.has(x.format)) plat.set(x.format, x);
    const ed = new Set(notes.active(now).filter((x) => fits(x, { season: seasonOf(now), city })).map((x) => x.format));
    return (list || []).map((x) => { const fk = formatOf({ title: x.title, line: x.line }), p = plat.get(fk);
      return p ? { ...x, format: fk, source: "platform", sourceLine: p.sourceLine, rank: 2 + p.score / 100 } : ed.has(fk) ? { ...x, format: fk, source: "editorial", sourceLine: SOURCE.editorial, rank: 1 } : { ...x, format: fk, source: "potto", sourceLine: SOURCE.potto, rank: 0 }; });
  }
  /** The feed's ideas card: three titles and an honest heading. */
  function feedCard({ city = "" } = {}, now = clock()) { const r = suggest({ city, n: 5 }, now); if (!r.ideas.length) return null; const p = r.ideas[0].source === "platform";
    return { titles: r.ideas.slice(0, 3).map((x) => x.title), count: r.total, head: p ? "Small formats people loved here" : "Small formats worth a try", sourceLine: r.ideas[0].sourceLine, source: r.ideas[0].source }; }

  // ---------- one person ----------
  /** Interests, city, what they've made and what they did lately, for a signed-in person. */
  function personOf(u, now = clock()) { const o = { interests: [], city: "", made: [], recent: [] }; if (!u?.email) return o;
    try { const P = app?.locals?.hooks?.interestsOfUser?.(u.email); o.interests = P?.interests || []; o.city = P?.city || ""; } catch {}
    try { const h = C?.profileOf?.(u.ws); if (h?.city && !o.city) o.city = clean(h.city, 60); } catch {}
    if (u.ws && u.ws !== DEFAULT_WS) { try { const t = iso(now), soon = iso(now - 30 * DAY), E = scopeStore(store, u.ws).list("events").map((d) => d.data).filter((e) => e && !e.example && !e.sample && !e.cancelled);
      o.made = E.map((e) => e.pubTitle || e.name || "").filter(Boolean); const past = E.filter((e) => e.date && e.date <= t).sort((a, b) => String(b.date).localeCompare(String(a.date)));
      o.recent = [...new Set([...past.filter((e) => e.date >= soon), ...past.slice(0, 1), ...E.filter((e) => e.date && e.date > t).slice(0, 2)].map((e) => formatOf(e)).filter(Boolean))];
      if (!o.city) o.city = clean(E.find((e) => e.city)?.city, 60); } catch {} }
    return o; }
  /** For Potto's chat and texts: a few ideas with their labels, no ids. */
  function forPotto(u, { n = 5 } = {}, now = clock()) { const p = personOf(u, now); return suggest({ ...p, n }, now).ideas.map(({ title, line, reason, say, source, sourceLine }) => ({ title, line: reason || line, say, source, label: sourceLine })); }

  /** "Your run had more repeat guests than most runs in Brooklyn this month", or "" when the sample is too small. */
  function compareLine(r, now = clock()) {
    const St = compute(now), f = FORMAT_BY.get(r.format); if (!f || !r.city || !r.past) return "";
    const peers = St.recs.filter((y) => y !== r && y.past && y.ws !== r.ws && y.format === r.format && lc(y.city) === lc(r.city) && y.age <= 90);
    const near = peers.filter((y) => y.age <= 30), useP = near.length && new Set(near.map((y) => y.ws)).size >= MIN_HOSTS() && near.reduce((n, y) => n + y.guests, 0) >= MIN_GUESTS() ? near : peers;
    if (new Set(useP.map((y) => y.ws)).size < MIN_HOSTS() || useP.reduce((n, y) => n + y.guests, 0) < MIN_GUESTS()) return "";
    const period = useP === near ? "this month" : "lately", where = `most ${f.many} in ${r.city} ${period}`;
    const med = (L) => { const s = L.filter((v) => v != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
    const rate = (y, k) => (k === "repeat" ? (y.guests ? y.repeat / y.guests : null) : k === "again" ? (y.againOf >= 3 ? y.againYes / y.againOf : null) : y.fill);
    const words = { repeat: `Your ${f.one} had more repeat guests than ${where}`, again: `More of your guests said they'd go again than at ${where}`, fill: `Your ${f.one} filled more of its spots than ${where}` };
    let best = null; for (const k of ["repeat", "again", "fill"]) { const mine = rate(r, k), m = med(useP.map((y) => rate(y, k))); if (mine == null || m == null) continue; const gap = mine - m; if (gap > 0.05 && (!best || gap > best.gap)) best = { k, gap }; }
    return best ? words[best.k] : `Your ${f.one} was right in line with ${where}`; }
  /** The host's Home card: the top 3 formats in their city, and how their recent events compared. */
  function home(u, now = clock()) { const p = personOf(u, now), city = p.city, St = compute(now);
    const mine = St.recs.filter((r) => r.ws === u.ws && r.past && r.age <= 30).sort((a, b) => a.age - b.age).slice(0, 2);
    const compare = mine.map((r) => compareLine(r, now)).filter(Boolean);
    return { city, top: city ? top({ city, n: 3 }, now).map(({ title, label, reason, sourceLine, format, kind, hosts, guests, again }) => ({ title, label, reason, sourceLine, format, kind, hosts, guests, again, say: FORMAT_BY.get(format)?.say || title })) : [], compare: compare.slice(0, 1) }; }

  return { compute, bust, top, suggest, annotate, feedCard, personOf, forPotto, compareLine, home, notes, modelIdeas, get recs() { return compute().recs; } };
}

const listOf = (v, re = /^[a-z-]{2,24}$/) => String(v || "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => re.test(s)).slice(0, 12);
export function mountTrends(app, { store, express, currentUser, C, X, IDEAS }) {
  const T = makeTrends({ store, X, C, app, IDEAS: () => IDEAS || app.locals.hooks?.IDEAS || [] }); app.locals.trends = T;
  const small = express.json({ limit: "8kb" }), viewer = (req) => { try { const u = currentUser(req); return u && u.email && u.ws !== DEFAULT_WS ? u : null; } catch { return null; } };
  const cityQ = (req) => clean(req.query.city, 60), hits = new Map();
  const slow = (req, res, max = 300) => { const k = req.ip || "?", now = Date.now(), L = (hits.get(k) || []).filter((t) => now - t < 3600e3); L.push(now); hits.set(k, L); if (hits.size > 20000) hits.clear(); if (L.length > max) { res.status(429).json({ code: "rate_limited", message: "Slow down." }); return true; } return false; };
  // the public view: aggregate counts only, the same for everyone, so it can be cached
  app.get("/api/public/trends", (req, res) => { if (slow(req, res)) return; const type = TYPES.includes(lc(req.query.type)) ? lc(req.query.type) : "", season = SEASONS.includes(lc(req.query.season)) ? lc(req.query.season) : "", city = cityQ(req);
    res.set("Cache-Control", "public, max-age=600").json({ city, type, season, ideas: T.top({ city, type, season, n: Math.max(1, Math.min(10, +req.query.n || 5)) }).map(({ format, title, label, type: ty, city: c, hood, hosts, guests, events, again, fill, bestDay, period, reason, source, sourceLine }) => ({ format, title, label, type: ty, city: c, hood, hosts, guests, events, again, fill, bestDay, period, reason, source, sourceLine })),
      min: { hosts: MIN_HOSTS(), guests: MIN_GUESTS() }, about: "Counts from public events on Pottery Lab. Private, members-only and example events are never counted." }); });
  // ideas for this person: 3 to 5 at a time, with "more"
  app.get("/api/public/ideas/suggest", (req, res) => { if (slow(req, res, 600)) return; const u = viewer(req), p = u ? T.personOf(u) : { interests: [], city: "", made: [], recent: [] };
    const q = { city: cityQ(req) || p.city, interests: [...new Set([...listOf(req.query.interests), ...p.interests])], made: p.made, recent: p.recent, n: +req.query.n || 4, offset: +req.query.offset || 0 };
    res.set("Cache-Control", u ? "private, no-store" : "public, max-age=300").json({ city: q.city, ...T.suggest(q) }); });
  app.get("/api/me/trends/home", (req, res) => { const u = viewer(req); res.set("Cache-Control", "private, no-store"); if (!u) return res.status(401).json({ code: "unauthenticated", message: "Sign in first." }); res.json(T.home(u)); });
  // trend notes, for ENCORE_ADMIN_EMAILS only (404 for everyone else, as if the route weren't here)
  const admin = (req, res) => { const u = viewer(req) || (() => { try { return currentUser(req); } catch { return null; } })(); if (!u || !isAdmin(u.email)) { res.status(404).json({ code: "not_found", message: "Not found." }); return null; } res.set("Cache-Control", "private, no-store"); return u; };
  app.get("/api/admin/trend-notes", (req, res) => { if (!admin(req, res)) return; const now = Date.now(), A = new Set(T.notes.active(now).map((n) => n.id)); res.json({ notes: T.notes.all().map((n) => ({ ...n, active: A.has(n.id) })), days: 120 }); });
  app.post("/api/admin/trend-notes", small, (req, res) => { const u = admin(req, res); if (!u) return; const r = T.notes.add(req.body || {}, u.email); if (r.error) return res.status(400).json({ code: "invalid", message: r.error }); res.json({ ok: true, note: r.note }); });
  app.post("/api/admin/trend-notes/:id/retire", small, (req, res) => { if (!admin(req, res)) return; const r = T.notes.retire(String(req.params.id).slice(0, 40), req.body?.on !== false); if (r.error) return res.status(404).json({ code: "not_found", message: r.error }); res.json({ ok: true }); });
  return T;
}
