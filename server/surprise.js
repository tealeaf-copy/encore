// Small personal surprises (owner items 17 to 20). Everything here is worked out from facts already stored, and says
// nothing a person isn't allowed to know. Potto's voice: a smart, humble, fun friend. One file, hooked in by app.js.
//
// 17. A cover drawn for this event: "Dumpling night with Jun" gets its own line drawing, composed from the title's
//     nouns with the cover library itself (public/eventart.js, its word list and its drawings), or drawn by the model
//     when a key is set (server/art.js drawArt, cleaned by cleanSvg either way). Cached per event in titleart/<id> until
//     the title changes. The page saves it the shared cover way: coverArt { kind: "custom", svg, prompt, tone }, the one
//     recipe every surface reads (EventArt.cover / EventArt.spec), so it is the event's one cover everywhere.
// 18. Milestones: the 1st, 5th, 10th, 25th, 50th and 100th event hosted, the first sold-out one, the first repeat
//     guest and the first year. Each is a stamped card on the host's Home (never a popup) with a short thank-you from
//     Potto and a share image (server/sharecards.js). Stored once each in system/milestones-<ws>, so no card repeats.
//     Regulars: guests who came to 2 or more of this host's events (past, replied I'm in, not marked a no-show). They
//     see a small "Regular" badge on that host's page and invites; the host sees who they are.
// 19. A warm line at the top of /e and /g when it is true: "Maya saved you a seat" (a personal invite link the host
//     made), "Priya is going. You both loved Pottery night." (a friend going, and you both went to and sent kudos for
//     the same past event, with the friend's name allowed on kudos), "3 friends are going" (the same rule as the
//     Friends going pill). Short strings, rendered on the server (GET /api/public/surprise/<id>), so the light invite
//     carries no extra bytes: public/friendsgoing.js, which it already loads, brings in public/surprise.js.
// 20. A send-off after "I'm in": one small human line from the event's own details ("Bring an appetite, there are 40
//     dumplings", "Wear shoes you can run in", weather only when the event carries weather). Rules offline; the model
//     may reword it when a key is set, and is only kept when it adds no number or word of fact the event doesn't have.
// Measured with privacy-safe PostHog events (server/posthog.js): names of things, counts and kinds, never people.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { scopeStore, workspaceOfEvent, getWorkspace, getDbUser, DEFAULT_WS } from "./workspaces.js";
import { isFake, complete } from "./ai.js";
import { cleanSvg, drawArt } from "./art.js";
import { EVENTS, capture } from "./posthog.js";
import { renderCardAsync, cardText } from "./sharecards.js";

const DAY = 864e5, ID_OK = /^[A-Za-z0-9_-]{2,80}$/, ISO = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);
const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const clean = (v, n = 120) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s*\u2014\s*/g, ", ").replace(/\s+/g, " ").trim().slice(0, n);
const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };

// the analytics events this file sends (allow-listed here, so server/posthog.js needs no edit)
export const SURPRISE_EVENTS = ["drawn_cover_made", "drawn_cover_used", "milestone_shown", "milestone_shared", "milestone_closed", "invite_line_shown", "sendoff_shown", "regular_badge_shown"];
for (const e of SURPRISE_EVENTS) EVENTS.add(e);

// ---------------------------------------------------------------- 17. covers drawn for your event
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
let EA = null;
export const art = () => { if (EA) return EA; try { const box = { window: {}, document: undefined }; vm.runInNewContext(fs.readFileSync(path.join(PUBLIC, "eventart.js"), "utf8"), box, { timeout: 1000 }); EA = box.window.EventArt; } catch { EA = null; } return EA; };
const INK = "#2A2622", S = `fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"`, F = (c) => `fill="${c}" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"`;
// small touches for the words a title has that the library has no drawing for: the time of day and the company
const ACCENTS = {
  night: (A) => `<path ${F(A)} d="M176 14a16 16 0 1 0 12 26 13 13 0 0 1-12-26z"/><path ${S} d="M146 18v8M142 22h8M162 48v6M159 51h6"/>`,
  morning: (A) => `<circle ${F(A)} cx="170" cy="30" r="13"/><path ${S} d="M170 8v5M170 47v5M148 30h5M187 30h5M155 15l3 3M182 42l3 3M185 15l-3 3"/>`,
  lights: (A) => `<path ${S} d="M100 6c24 16 56 16 96 2"/>${[[118, 15], [140, 19], [162, 18], [184, 12]].map(([x, y], i) => `<path ${F(i % 2 ? "#fff" : A)} d="M${x - 4} ${y + 2}h8l-1 9h-6z"/>`).join("")}`,
  together: (A) => `<path ${F(A)} d="M178 22c-5-7-15-3-12 4 2 5 12 10 12 10s10-5 12-10c3-7-7-11-12-4z"/>`,
  sparkle: () => `<path ${S} d="M182 18v14M175 25h14M156 40v8M152 44h8"/>`,
};
const ACCENT_WORDS = [[/\b(night|nights|evening|supper|after dark|late|moon)\b/i, "night"], [/\b(morning|sunrise|breakfast|brunch|am\b|dawn|early)\b/i, "morning"], [/\b(party|birthday|celebrat\w*|fest|festival|launch|reunion)\b/i, "lights"], [/\bwith [A-Z][a-z]+|\bfriends?\b|\bpals?\b|\bcrew\b|\bgang\b/, "together"]];
/** The words in a title that can be drawn: library drawings (in title order) and the touches above. Pure. */
export function titleMotifs(title, e = {}) {
  const A = art(), t = clean(title, 140); if (!A || !t) return { kinds: [], accents: [] };
  let kinds = []; /* a plain array, not the sandbox one */ try { kinds = Array.from(A.kindsOf({ title: t, activity: e.activity || "" }), String).filter((k) => A.KINDS.includes(k)).slice(0, 3); } catch {}
  const accents = ACCENT_WORDS.filter(([re]) => re.test(t)).map(([, k]) => k);
  return { kinds, accents: [...new Set(accents)].slice(0, 2) };
}
// one library drawing, on the shared ground line, with its lines kept the same weight when it is drawn smaller
const placed = (A, kind, x, sc, spot, flip) => { const body = A.drawing(kind, spot).replace(/^<svg[^>]*>|<\/svg>$/g, "").replace(/stroke-width="3"/g, `stroke-width="${(3 / sc).toFixed(2)}"`);
  const y = (146 - 136 * sc).toFixed(1); return flip ? `<g transform="translate(${(x + 200 * sc).toFixed(1)} ${y}) scale(${-sc} ${sc})">${body}</g>` : `<g transform="translate(${x.toFixed(1)} ${y}) scale(${sc})">${body}</g>`; };
const LAYOUTS = { 1: [[16, 0.86]], 2: [[-8, 0.68], [96, 0.54]], 3: [[-10, 0.6], [80, 0.46], [136, 0.36]] };
/**
 * A line-art cover for one event from its title: up to three library drawings for the title's nouns, standing on one
 * ground line, plus a touch for the time of day or the company. No words, no faces, no emoji. Pure: the same title
 * and seed draw the same picture. Returns { svg, kinds, accents } (svg is "" when nothing could be drawn).
 */
export function composeTitleArt(title, { seed = "", activity = "", spot = "#29489A" } = {}) {
  const A = art(); if (!A) return { svg: "", kinds: [], accents: [] };
  const M = titleMotifs(title, { activity }), kinds = M.kinds.length ? M.kinds : [(() => { try { return String(A.kindOf({ title: clean(title, 140), activity }) || "party").split("+")[0]; } catch { return "party"; } })()];
  const h = hash(lc(title) + "|" + seed), L = LAYOUTS[kinds.length], flip = !!(h & 1) && kinds.length === 1;
  const body = kinds.map((k, i) => placed(A, k, L[i][0], L[i][1], spot, flip && i === 0)).join("");
  const accents = M.accents.length ? M.accents : kinds.length === 1 ? ["sparkle"] : [], acc = accents.slice(0, 1).map((k) => ACCENTS[k](spot)).join("");
  const svg = cleanSvg(`<svg viewBox="0 0 200 150"><path ${S} d="M6 146h188"/>${body}${acc}</svg>`);
  return { svg, kinds, accents: accents.slice(0, 1) };
}
const titleKey = (t) => lc(t).replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim().slice(0, 140);
const modelPrompt = (title, M) => `A cover for an event called "${clean(title, 120)}". Draw the things it is about${M.kinds.length ? ` (${M.kinds.join(", ")})` : ""}${M.accents.includes("night") ? ", at night" : M.accents.includes("morning") ? ", in the morning" : ""}, as objects on a table or ground. No people's faces, no words, no letters, no numbers.`;

// ---------------------------------------------------------------- 18. milestones and regulars
/** Every guest's visits to this host: past events they replied I'm in to and weren't marked a no-show. Pure on the store. */
export function visitsOf(store, ws, now = today()) {
  const St = scopeStore(store, ws), evs = new Map(), V = new Map();
  for (const d of St.list("events")) { const e = d.data || {}; if (e.example || e.sample || e.cancelled || e.stage === "interest" || !ISO.test(e.date || "") || e.date > now) continue; evs.set(d.id, e); }
  const add = (key, name, email, eventId, date) => { if (!key) return; let v = V.get(key); if (!v) V.set(key, (v = { key, name: "", email: "", events: new Map() })); if (name && !v.name) v.name = name; if (email && !v.email) v.email = email; v.events.set(eventId, date); };
  for (const d of St.list("rsvps")) { const r = d.data || {}, e = evs.get(r.eventId); if (!e || r.response !== "going" || r.noShow === true) continue;
    const key = lc(r.email) || (r.phone ? "tel:" + String(r.phone).replace(/[^\d+]/g, "") : ""); add(key, clean(r.name, 60), lc(r.email), r.eventId, e.date); }
  for (const [id, e] of evs) for (const g of e.guests || []) if (/Attended/.test(g.status || "") && lc(g.email)) add(lc(g.email), clean(g.name, 60), lc(g.email), id, e.date);
  return [...V.values()].map((v) => { const dates = [...v.events.values()].sort(); return { key: v.key, name: v.name, email: v.email, times: dates.length, firstAt: dates[0], secondAt: dates[1] || "", lastAt: dates[dates.length - 1] }; });
}
export const REGULAR_MIN = 2;
/** This host's regulars, most visits first. Pure on the store. */
export const regularsOf = (store, ws, now) => visitsOf(store, ws, now).filter((v) => v.times >= REGULAR_MIN).sort((a, b) => b.times - a.times || String(b.lastAt).localeCompare(String(a.lastAt)));
const shortName = (n) => { const w = String(n || "").trim().split(/\s+/).filter(Boolean); return w.length ? w[0] + (w[1] ? " " + w[1][0].toUpperCase() + "." : "") : "A guest"; };

const ORD = (n) => n === 1 ? "first" : `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;
const NOUNS = [[/dinner|supper|feast|friendsgiving|thanksgiving/, "dinner"], [/brunch/, "brunch"], [/\bruns?\b|run club|5k|10k|jog/, "run"], [/hike|trail/, "hike"], [/\bwalk/, "walk"], [/coffee|cafe/, "coffee"], [/potluck/, "potluck"], [/picnic/, "picnic"], [/game night|board game|games/, "game night"], [/class|workshop|lesson/, "class"], [/party/, "party"]];
const nounOf = (e = {}) => { const t = lc(`${e.activity || ""} ${e.pubTitle || e.name || ""}`); return (NOUNS.find(([re]) => re.test(t)) || [, "event"])[1]; };
export const COUNTS = [1, 5, 10, 25, 50, 100];
const THANKS = {
  1: "You did the hard part: you asked people to come. Thank you for hosting.",
  5: "Five times you made room for people. They noticed. Thank you.",
  10: "Ten. That's a habit now, and a good one. Thank you for hosting.",
  25: "Twenty-five times, people met people because of you. Thank you.",
  50: "Fifty. I've been keeping count so you don't have to. Thank you.",
  100: "A hundred. I don't have hands, but I'd clap. Thank you.",
};
/** The milestones a host has reached, with the day each was reached. Pure: f is server/hostloop.js facts(ws). */
export function milestonesFrom(f = {}, { visits = [], nounAt = () => "event", soldOutAt = "", now = today() } = {}) {
  const out = [], L = f.list || [];
  for (const n of COUNTS) if ((f.hosted || 0) >= n && L[n - 1]) { const noun = nounAt(n - 1); out.push({ id: "hosted" + n, stamp: String(n), at: L[n - 1].date, title: n === 1 ? `Your first ${noun}, hosted` : `Your ${ORD(n)} ${noun}`, line: THANKS[n], art: noun, stat: { n: String(n), label: n === 1 ? "hosted" : "hosted so far" } }); }
  if (soldOutAt) out.push({ id: "soldout", stamp: "Full", at: soldOutAt, title: "Your first sold-out one", line: "Every spot taken. Word got around, and you earned it.", stat: { n: "Full", label: "every spot taken" } });
  const rep = visits.filter((v) => v.secondAt).sort((a, b) => a.secondAt.localeCompare(b.secondAt))[0];
  if (rep) out.push({ id: "repeat", stamp: "2x", at: rep.secondAt, title: "Your first repeat guest", line: `${first(rep.name) || "Someone"} came back. That's the best review there is.`, stat: { n: "2x", label: "came back" } });
  const d0 = (f.dates || [])[0]; if (d0 && ISO.test(d0)) { const y = new Date(d0 + "T12:00:00Z"); y.setUTCFullYear(y.getUTCFullYear() + 1); const at = y.toISOString().slice(0, 10); if (at <= now) out.push({ id: "year", stamp: "1 yr", at, title: "One year of hosting", line: "A year since your first. Thanks for making room for people.", stat: { n: "1", label: "year of hosting" } }); }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
export const CARD_DAYS = 21, NEW_AT_ONCE = 2;
/**
 * Fold what's reached into the stored record. Every id is stored once, ever: a card shows until it's closed or three
 * weeks pass, and never comes back. A host who already had milestones before this existed gets only the newest one.
 * Pure: returns { rec, added }.
 */
export function foldMilestones(rec, reached, { now = Date.now(), fresh = true } = {}) {
  const R = { kind: "milestones", cards: [], ...(rec || {}) }, have = new Set(R.cards.map((c) => c.id)), add = reached.filter((m) => !have.has(m.id));
  const show = new Set((!rec && !fresh ? add.slice(-1) : add.slice(-NEW_AT_ONCE)).map((m) => m.id)), added = [];
  for (const m of add) { const c = { id: m.id, at: now, reachedOn: m.at, ...(show.has(m.id) ? {} : { archived: true }) }; R.cards.push(c); if (!c.archived) added.push(m.id); }
  return { rec: R, added };
}

// ---------------------------------------------------------------- 19. the line at the top of an invite
/** One or two short, true sentences, from facts the viewer may know. Pure: the caller works the facts out. */
export function inviteLine({ personalFrom = "", full = false, sharedLoved = null, friends = [] } = {}) {
  const parts = [], kinds = [];
  if (personalFrom && !full) { parts.push(`${personalFrom} saved you a seat.`); kinds.push("personal"); }
  if (sharedLoved?.name && sharedLoved?.title) { parts.push(`${sharedLoved.name} is going. You both loved ${sharedLoved.title}.`); kinds.push("loved"); }
  else if (friends.length) { parts.push(friends.length === 1 ? `${friends[0]} is going.` : `${friends.length} friends are going.`); kinds.push("friends"); }
  const text = parts.slice(0, 2).join(" ");
  return text ? { text: text.length > 160 ? parts[0] : text, kind: kinds[0], kinds } : null;
}

// ---------------------------------------------------------------- 20. the send-off
const FOODS = "dumplings|tacos|pizzas|pies|cookies|oysters|wings|bagels|donuts|doughnuts|cupcakes|empanadas|pierogi|bao|buns|courses|dishes|cheeses|wines|beers|sandwiches|croissants|pastries|burgers|skewers|rolls";
const F12 = (t) => { const m = /^(\d{2}):(\d{2})$/.exec(t || ""); if (!m) return ""; const h = +m[1], mm = m[2]; return `${h % 12 || 12}${mm === "00" ? "" : ":" + mm}${h < 12 ? "am" : "pm"}`; };
/** The event's own words, as one lowercase string (title, description, menu, theme, tags). */
const wordsOf = (e = {}) => [e.pubTitle, e.name, e.why, e.concept, e.dinnerTheme, e.menu, ...(Array.isArray(e.courses) ? e.courses.map((c) => (typeof c === "string" ? c : c?.name || c?.dish || "")) : []), ...(Array.isArray(e.tags) ? e.tags : []), e.activity].filter(Boolean).join(" ").toLowerCase();
/**
 * One small line after "I'm in", from the event's details only. Weather only when the event carries it
 * (e.weather: { tempF, at? }). Returns { text, kind } or null. Pure.
 */
export function sendOffLine(e = {}) {
  const W = wordsOf(e), act = lc(e.activity), at = F12(e.startTime), w = e.weather && typeof e.weather === "object" ? e.weather : null;
  if (w && Number.isFinite(+w.tempF)) { const t = Math.round(+w.tempF), when = F12(w.at) || at;
    if (t <= 50) return { text: `Dress warm, it's ${t}F${when ? ` at ${when}` : ""}.`, kind: "weather" };
    if (t >= 85) return { text: `Bring water, it's ${t}F${when ? ` at ${when}` : ""}.`, kind: "weather" }; }
  const n = new RegExp(`\\b(\\d{1,3})\\s+(?:[a-z-]+\\s+)?(${FOODS})\\b`).exec(W); if (n && +n[1] >= 2) return { text: `Bring an appetite, there are ${+n[1]} ${n[2]}.`, kind: "food" };
  const is = (re) => re.test(act) || re.test(W);
  if (is(/\brun\b|\bruns\b|run club|\b5k\b|\b10k\b|jog/)) return { text: "Wear shoes you can run in.", kind: "run" };
  if (is(/\bhike|trail/)) return { text: "Wear shoes with some grip.", kind: "hike" };
  if (is(/\bbike|\bcycl|\bride\b/)) return { text: "Bring your helmet.", kind: "bike" };
  if (is(/\bswim|pool|beach|plunge/)) return { text: "Pack a towel.", kind: "swim" };
  if (is(/pottery|ceramic|\bclay\b|wheel night/)) return { text: "Wear something you don't mind getting clay on.", kind: "pottery" };
  if (is(/\bpaint/)) return { text: "Wear something you don't mind getting paint on.", kind: "paint" };
  if (is(/potluck/)) return { text: "Bring a dish you'd want seconds of.", kind: "potluck" };
  if (/\bbyob\b|bring your own/.test(W)) return { text: "It's BYO, so bring what you like to drink.", kind: "byo" };
  if (is(/picnic|\bpark\b/)) return { text: "Bring something to sit on.", kind: "picnic" };
  if (/^(0[5-7]):/.test(e.startTime || "")) return { text: `Set an alarm, it starts at ${at}.`, kind: "early" };
  if (is(/game night|board game|\bgames\b|trivia/)) return { text: "Bring your competitive side.", kind: "games" };
  if (is(/dinner|supper|feast|tasting|dumpling|taco|brunch/)) return { text: "Come hungry.", kind: "food" };
  return null;
}
/** A model rewording is kept only if it adds no number or fact word the rules line and the event don't already have. Pure. */
export function rewordOk(line, base, e = {}) {
  const s = String(line || "").trim(); if (!s || s.length > 90 || /[\u2014\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}"<>]/u.test(s) || /\n/.test(s)) return false;
  const known = `${base} ${wordsOf(e)} ${F12(e.startTime)} ${e.weather?.tempF ?? ""}`.toLowerCase(), nums = s.match(/\d+/g) || [];
  return nums.every((d) => known.includes(d));
}

// ---------------------------------------------------------------- the routes
export function mountSurprise(app, { store, small, currentUser, C, X, H, invitedGuest = null }) {
  const me = (req, res) => { const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) { res.status(401).json({ code: "unauthenticated", message: "Sign in first." }); return null; } return u; };
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const no = (res) => res.set("Cache-Control", "private, no-store");
  const evOf = (ws, id) => (ws && ID_OK.test(id || "") ? scopeStore(store, ws).get("events/" + id)?.data || null : null);
  const hostFirst = (ws, e = {}) => first(e.hostName) || first(getDbUser(getWorkspace(ws)?.ownerEmail || "")?.name) || first(C.profileOf(ws)?.name) || "Your host";

  // ---- 17 ----
  const modelUses = new Map();
  async function drawnFor(ws, id, title, { activity = "", spot = "#29489A" } = {}) {
    const t = clean(title, 140), key = titleKey(t); if (key.length < 2) return null;
    const St = ws && ID_OK.test(id || "") ? scopeStore(store, ws) : null, hit = St?.get("titleart/" + id)?.data;
    if (hit?.key === key && hit.svg && hit.spot === spot) return { ...hit, cached: true };
    const M = composeTitleArt(t, { seed: id, activity, spot }); let svg = M.svg, source = "rules";
    // with a key set, the model draws it from the same nouns; the rules drawing stays if it can't (or the day's use is up)
    if (!isFake() && ws) { const k = ws + "|" + today(), n = modelUses.get(k) || 0;
      if (n < 20) { modelUses.set(k, n + 1); if (modelUses.size > 5000) modelUses.clear(); try { const m = await drawArt(modelPrompt(t, M), spot); if (m) { svg = m; source = "model"; } } catch {} } }
    if (!svg) return null;
    const rec = { kind: "titleart", eventId: id || "", key, title: t, svg, kinds: M.kinds, accents: M.accents, spot, source, at: Date.now() };
    if (St) St.set("titleart/" + id, rec); return { ...rec, cached: false };
  }
  app.post("/api/art/for-event", small, async (req, res) => { const u = me(req, res); if (!u) return; no(res); const b = req.body || {}, id = String(b.eventId || "").slice(0, 80);
    const ev = id ? evOf(u.ws, id) : null; if (id && !ev) return bad(res, "No such event.", 404, "not_found");
    const title = clean(b.title || ev?.pubTitle || ev?.name, 140); if (title.length < 3) return bad(res, "Give it a title first, and Potto will draw it.");
    const spot = /^#[0-9a-f]{6}$/i.test(b.spot || "") ? b.spot : "#29489A";
    const r = await drawnFor(u.ws, ev ? id : "", title, { activity: clean(b.activity || ev?.activity, 40), spot }); if (!r) return bad(res, "Potto couldn't draw that one. Try a few more words in the title.", 422, "no_drawing");
    if (!r.cached) capture("drawn_cover_made", { ws: u.ws, via: r.source, kind: r.kinds[0] || "party", count: r.kinds.length });
    res.json({ svg: r.svg, title: r.title, kinds: r.kinds, source: r.source, cached: r.cached, prompt: `Drawn for ${r.title}`.slice(0, 120) }); });

  app.post("/api/art/for-event/used", small, (req, res) => { const u = me(req, res); if (!u) return; no(res); const id = String(req.body?.eventId || "").slice(0, 80), ev = evOf(u.ws, id);
    const ok = !!ev && ev.coverArt?.drawnFor === "title" && typeof ev.coverArt.svg === "string"; if (ok) capture("drawn_cover_used", { ws: u.ws, first: !ev.coverPhoto }); res.json({ ok }); });

  // ---- 18 ----
  const mKey = (ws) => "system/milestones-" + ws;
  function milestoneView(ws) {
    const L = app.locals.hostloop; if (!L?.facts) return { cards: [], regulars: [] };
    const f = L.facts(ws), St = scopeStore(store, ws), now = today(), visits = visitsOf(store, ws, now);
    const evs = St.list("events").map((d) => ({ id: d.id, e: d.data || {} })), byId = new Map(evs.map((x) => [x.id, x.e]));
    const going = new Map(); for (const d of St.list("rsvps")) { const r = d.data || {}; if (r.response === "going" && r.noShow !== true && r.eventId) going.set(r.eventId, (going.get(r.eventId) || 0) + 1 + Math.max(0, Math.min(10, +r.party - 1 || 0))); }
    const sold = evs.filter((x) => !x.e.example && !x.e.sample && !x.e.cancelled && ISO.test(x.e.date || "") && +x.e.headcount >= 2 && (going.get(x.id) || 0) >= +x.e.headcount).map((x) => (x.e.date <= now ? x.e.date : now)).sort()[0] || "";
    const reached = milestonesFrom(f, { visits, nounAt: (i) => nounOf(byId.get(f.list[i]?.id)), soldOutAt: sold, now });
    const was = store.get(mKey(ws))?.data || null, W = getWorkspace(ws), fresh = !W?.createdAt || Date.now() - W.createdAt < 3 * DAY;
    const { rec, added } = foldMilestones(was, reached, { fresh });
    if (!was || added.length || rec.cards.length !== (was.cards || []).length) store.set(mKey(ws), rec);
    for (const id of added) capture("milestone_shown", { ws, kind: id.replace(/\d+$/, ""), count: +(/\d+$/.exec(id) || [0])[0] || undefined });
    const byM = new Map(reached.map((m) => [m.id, m])), cutoff = Date.now() - CARD_DAYS * DAY;
    const cards = rec.cards.filter((c) => !c.archived && !c.closedAt && c.at >= cutoff && byM.has(c.id)).sort((a, b) => b.at - a.at || String(b.reachedOn).localeCompare(String(a.reachedOn))).slice(0, 3)
      .map((c) => { const m = byM.get(c.id); return { id: c.id, stamp: m.stamp, title: m.title, line: m.line, on: m.at, png: `/api/me/milestones/${c.id}.png` }; });
    return { cards, regulars: regularsOf(store, ws, now).slice(0, 24).map((v) => ({ name: shortName(v.name), times: v.times, last: v.lastAt })), reached: byM, rec };
  }
  app.get("/api/me/milestones", (req, res) => { const u = me(req, res); if (!u) return; no(res); const V = milestoneView(u.ws); res.json({ cards: V.cards, regulars: V.regulars, regularMin: REGULAR_MIN }); });
  app.post("/api/me/milestones/:id/close", (req, res) => { const u = me(req, res); if (!u) return; no(res); const id = String(req.params.id).slice(0, 20), d = store.get(mKey(u.ws))?.data; const c = d?.cards?.find((x) => x.id === id);
    if (!c) return bad(res, "No such card.", 404, "not_found"); if (!c.closedAt) { c.closedAt = Date.now(); store.set(mKey(u.ws), d); capture("milestone_closed", { ws: u.ws, kind: id.replace(/\d+$/, "") }); } res.json({ ok: true }); });
  app.post("/api/me/milestones/:id/shared", (req, res) => { const u = me(req, res); if (!u) return; no(res); capture("milestone_shared", { ws: u.ws, kind: String(req.params.id).replace(/\d+$/, "").slice(0, 20), via: ["save", "share"].includes(req.query.via) ? req.query.via : "share" }); res.json({ ok: true }); });
  const specOf = (m, ws) => ({ tone: "sky", kicker: "A milestone", title: cardText(m.title, 60), body: cardText(m.line, 140), stats: [m.stat], potto: "cheer", foot: C.profileOf(ws)?.handle ? `pottery.lab/@${C.profileOf(ws).handle}` : "Pottery Lab" });
  app.get(/^\/api\/me\/milestones\/([a-z0-9]{2,20})\.png$/, async (req, res) => { const u = me(req, res); if (!u) return; const V = milestoneView(u.ws), m = V.reached.get(req.params[0]);
    if (!m || !V.rec.cards.some((c) => c.id === m.id)) return res.status(404).json({ code: "not_found", message: "No such card." });
    res.set("Cache-Control", "private, max-age=300").type("png").send(await renderCardAsync(specOf(m, u.ws), req.query.size === "link" ? "link" : "story")); });
  /** Is this person one of this host's regulars? Only ever about the signed-in person themselves. */
  const regularOf = (ws, email) => { if (!ws || !email) return null; const k = lc(email); if (lc(getWorkspace(ws)?.ownerEmail) === k) return null; const v = visitsOf(store, ws).find((x) => x.key === k); return v && v.times >= REGULAR_MIN ? { times: v.times } : null; };
  app.get("/api/me/regular", (req, res) => { no(res); const u = currentUser(req); if (!u?.email || u.ws === DEFAULT_WS) return res.json({ regular: false });
    const ws = req.query.event ? workspaceOfEvent(String(req.query.event).slice(0, 80)) : req.query.handle ? C.wsOfHandle(String(req.query.handle).slice(0, 40)) : null; const r = regularOf(ws, u.email);
    if (r) capture("regular_badge_shown", { ws, via: req.query.event ? "invite" : "page", count: r.times });
    res.json(r ? { regular: true, times: r.times, host: hostFirst(ws) } : { regular: false }); });

  // ---- 19 ----
  /** The facts for the line, for this viewer (signed in, and/or holding the host's personal link). */
  function lineFor(req, ws, id, ev) {
    if (!ev || ev.example || ev.cancelled) return null;
    const u = (() => { try { return currentUser(req); } catch { return null; } })(), email = u?.email && u.ws !== DEFAULT_WS ? lc(u.email) : "", owner = lc(getWorkspace(ws)?.ownerEmail);
    if (email && email === owner) return null; // the host looking at their own invite
    const St = scopeStore(store, ws), R = St.list("rsvps").map((d) => d.data || {}).filter((r) => r.eventId === id);
    let personalFrom = "", full = false;
    let g = null; try { g = invitedGuest ? invitedGuest(req, ws, id, ev) : null; } catch {}
    if (g) { personalFrom = hostFirst(ws, ev); const cap = +ev.headcount || 0, n = R.filter((r) => r.response === "going").reduce((a, r) => a + 1 + Math.max(0, Math.min(10, +r.party - 1 || 0)), 0); full = cap > 0 && n >= cap && !R.some((r) => r.response === "going" && ((lc(g.email) && lc(r.email) === lc(g.email)) || (g.id && r.guestId === g.id))); } // a full event can't promise a seat, unless it's already theirs
    let friends = [], sharedLoved = null;
    // friends going: the Friends going pill's own rule (server/hooks.js friendsGoing): a public, listed event that shows its guests
    if (email && H?.followSet && ev.discoverable && !ev.unlisted && !ev.hideGuests) {
      const Fs = H.followSet(email), seen = new Set(), going = [];
      for (const r of R.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))) { const em = lc(r.email); if (r.response !== "going" || r.noShow || r.showMe === false || !em || !Fs.has(em) || seen.has(em)) continue; seen.add(em); const nm = first(r.name) || first(X.person(em)?.name); if (nm) going.push({ email: em, name: nm }); }
      friends = going.map((x) => x.name);
      // "You both loved": you and that friend both went to the same past event and both sent kudos for it, and the
      // friend lets their name show on kudos to you (Settings: everyone, or people they follow when you're friends)
      let I = null; try { I = X.index(); } catch {}
      if (I && going.length) { const mineAtt = new Set((I.att.get(email) || []).map((a) => a.eventId)), loved = (em, eid) => I.kudos.some((k) => lc(k.email) === em && k.eventId === eid && ((k.tags || []).length || k.love));
        for (const fr of going) { const sn = X.prefs?.(fr.email)?.socialName || "everyone", friendsBoth = (X.friendsOf(fr.email) || []).some((x) => lc(x.email) === email);
          if (sn === "hosts" || (sn === "follow" && !friendsBoth)) continue;
          const both = (I.att.get(fr.email) || []).filter((a) => a.eventId !== id && mineAtt.has(a.eventId) && (I.events.get(a.eventId)?.e?.date || "9") <= today() && !I.events.get(a.eventId)?.e?.cancelled && loved(email, a.eventId) && loved(fr.email, a.eventId)).sort((a, b) => (b.at || 0) - (a.at || 0))[0];
          if (both) { const E = I.events.get(both.eventId)?.e || {}; sharedLoved = { name: fr.name, title: clean(E.pubTitle || E.name, 60) }; break; } } } }
    const L = inviteLine({ personalFrom, full, sharedLoved, friends });
    const reg = email ? regularOf(ws, email) : null;
    return L || reg ? { line: L?.text || "", kind: L?.kind || "", regular: reg ? reg.times : 0, host: reg ? hostFirst(ws, ev) : "" } : null;
  }
  const sendOffCache = new Map();
  async function sendOffFor(ws, id, ev) {
    const base = sendOffLine(ev); if (!base || isFake()) return base;
    const k = id + "|" + hash(JSON.stringify([base.text, wordsOf(ev), ev.startTime, ev.weather])); if (sendOffCache.has(k)) return sendOffCache.get(k);
    let out = base; try { const r = await complete({ prompt: `You are Potto, a smart, humble, fun friend. Reword this note for a guest who just said yes, in under 12 words, keeping every fact and adding none: "${base.text}". Reply with the line only.`, effort: "low" }); const t = String(r?.text || "").trim().replace(/^"|"$/g, ""); if (rewordOk(t, base.text, ev)) out = { ...base, text: t }; } catch {}
    sendOffCache.set(k, out); if (sendOffCache.size > 2000) sendOffCache.clear(); return out;
  }
  app.get("/api/public/surprise/:id", async (req, res) => { no(res); const id = String(req.params.id).slice(0, 80), ws = ID_OK.test(id) ? workspaceOfEvent(id) : null, ev = evOf(ws, id);
    if (!ev || ev.example) return res.json({}); const P = lineFor(req, ws, id, ev), s = await sendOffFor(ws, id, ev);
    if (P?.line && req.query.track !== "0") capture("invite_line_shown", { ws, kind: P.kind, via: "full" });
    res.json({ ...(P || {}), ...(s ? { sendoff: s.text, sendoffKind: s.kind } : {}) }); });
  app.post("/api/public/surprise/:id/seen", (req, res) => { const id = String(req.params.id).slice(0, 80), ws = ID_OK.test(id) ? workspaceOfEvent(id) : null, ev = evOf(ws, id);
    if (ev && req.query.what === "sendoff") capture("sendoff_shown", { ws, kind: sendOffLine(ev)?.kind || "none" }); res.status(204).end(); });

  app.locals.surprise = { drawnFor, lineFor, regularOf, sendOffFor };
  return app.locals.surprise;
}
