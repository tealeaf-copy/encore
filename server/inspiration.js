// Inspiration cards in the feed: a nudge to build an event around something real that's coming up or just opened.
//
// Two sources, each labelled honestly on the card:
//   calendar   "On the calendar": holidays, observances and seasonal moments from server/moments.json, shown in a lead
//              window before the date (about 1 to 4 weeks), only in the regions they belong to (country, hemisphere,
//              and for seasons like cherry blossoms, the cities where they happen). Religious observances are framed
//              as "If you celebrate" and never get party ideas (checkMoment); Ramadan is iftars, never parties.
//   spots      "New in your area", in this order, never invented:
//              new_here  "New on Pottery Lab": a public place (a venue the host marked public) whose first public event
//                        on Pottery Lab was in the last NEW_DAYS days, in the viewer's city. It says what we know: when
//                        the first event was, not that the place opened.
//              team      "Spotted by the Pottery Lab team": spot notes added by hand (server/spotnotes.js), with the
//                        link the team read it in, expiring after about 60 days.
//              provider  only when a places provider is configured and gives a "new" or "hot and new" flag
//                        (app.locals.placeSuggest.newSpots(city), sync from its own cache). Labelled with its name,
//                        like "Hot and new on Yelp". Nothing here calls out to the network.
//
// The card (public/inspire.js draws it): a light dashed "idea" frame, the source label, a head ("Friendsgiving is in 3
// weeks"), the idea ("Host a potluck"), one line, the cover drawing, one primary "Plan this" (the create canvas, filled
// in: kind, title, date near the holiday, the place for a spot) and "Not for me" (hidden for that person or device).
// Rules (weave): at most one inspiration per EVERY feed items and at most PER_DAY different ones a day per person or
// device; the viewer's city decides regions and spots; signed out with no city, a city prompt takes the slot instead.
//
// Measured in PostHog (server/posthog.js, allow-listed words only): inspiration_shown, inspiration_tapped,
// inspiration_planned, inspiration_dismissed, with via (the source), kind (the type) and goal (the moment or category).
//
// Routes: POST /api/inspiration/track { id, action: shown|tapped|dismissed, device }, GET /api/me/inspiration (today's
// cards, for checking), admin GET/POST /api/admin/spot-notes, POST /api/admin/spot-notes/:id/retire (ENCORE_ADMIN_EMAILS).
// ENCORE_INSPIRATION_TODAY (YYYY-MM-DD) pins "today" for a QA run only; leave it unset in production.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { cityCentre, placeOf as geoPlace } from "./geo.js";
import { makeSpotNotes, CATS } from "./spotnotes.js";
import { capture, EVENTS } from "./posthog.js";
import { isAdmin } from "./metrics.js";
import { DEFAULT_WS, getWorkspace } from "./workspaces.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DAY = 864e5;
export const EVERY = 8, PER_DAY = 2, FIRST_AT = 3, NEW_DAYS = 60;
export const LABEL = { calendar: "On the calendar", new_here: "New on Pottery Lab", team: "Spotted by the Pottery Lab team" };
export const TYPES = ["civic", "cultural", "religious", "season", "watch"];
const KINDS = ["dinner", "drinks", "game", "brunch", "table", "class", "potluck", "picnic", "book", "run", "hike", "watch", "popup", "other"]; // public/canvas.js PLAN_KINDS
const COVERS = ["coffee", "cook", "dinner", "run", "hike", "walk", "bake", "craft", "pottery", "garden", "tea", "wine", "brunch", "potluck", "picnic", "games", "book", "movie", "music", "market", "party", "turkey", "leaf", "tree", "lantern", "fireworks", "dumpling", "park", "dance", "heart", "screen"]; // public/eventart.js
for (const e of ["inspiration_shown", "inspiration_tapped", "inspiration_planned", "inspiration_dismissed"]) EVENTS.add(e); // ---- inspiration events (docs/analytics.md) ----

const lc = (s) => String(s || "").trim().toLowerCase();
const clean = (v, n = 120) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\u2014/g, ", ").replace(/\s+/g, " ").trim().slice(0, n);
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const at = (d) => Date.parse(d + "T00:00:00Z");
const h10 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 10);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dateLabel = (d) => `${MON[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}`;
const pad = (n) => String(n).padStart(2, "0");

// ---------- the calendar ----------
export const MOMENTS = JSON.parse(fs.readFileSync(path.join(here, "moments.json"), "utf8")).moments;
/** Easter Sunday (Western), by the anonymous Gregorian computus. */
export function easterOf(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return `${y}-${pad(mo)}-${pad(da)}`; }
/** The nth weekday (0 Sunday) of a month; n -1 is the last one. */
export function nthWeekday(y, month, wd, n) { if (n > 0) { const first = new Date(Date.UTC(y, month - 1, 1)).getUTCDay(); return `${y}-${pad(month)}-${pad(1 + ((wd - first + 7) % 7) + (n - 1) * 7)}`; }
  const last = new Date(Date.UTC(y, month, 0)), ld = last.getUTCDate(), lw = last.getUTCDay(); return `${y}-${pad(month)}-${pad(ld - ((lw - wd + 7) % 7))}`; }
/** A moment's date in a year (YYYY-MM-DD), or "" when its rule doesn't cover that year (a table without the year). */
export function dateOf(m, y) { const R = m.rule || {}; let d = "";
  if (R.table && R.table[y]) d = `${y}-${R.table[y]}`; else if (R.fixed) d = `${y}-${pad(R.fixed[0])}-${pad(R.fixed[1])}`; else if (R.nth) d = nthWeekday(y, ...R.nth); else if (R.easter != null) d = easterOf(y);
  if (d && R.days) d = iso(at(d) + R.days * DAY); return d; }
const dow = (d) => new Date(at(d)).getUTCDay();
/** The day to put in "Plan this": the date itself, or a Saturday near it. */
export function planDate(d, how = "on") { const w = dow(d);
  if (how === "saturday-before") return iso(at(d) - ((w - 6 + 7) % 7) * DAY);
  if (how === "saturday-after") return iso(at(d) + ((6 - w + 7) % 7) * DAY);
  if (how === "saturday-near") { const back = (w - 6 + 7) % 7, fwd = (6 - w + 7) % 7; return iso(fwd < back ? at(d) + fwd * DAY : at(d) - back * DAY); }
  return d; }
/** The occurrence of a moment whose lead window holds today: { date, days } or null. lead: [min, max] days before. */
export function occurrence(m, now = Date.now()) { const t = at(iso(now)), y = new Date(t).getUTCFullYear(), [lo, hi] = m.lead || [7, 28];
  for (const yy of [y - 1, y, y + 1]) { const d = dateOf(m, yy); if (!d) continue; const days = Math.round((at(d) - t) / DAY); if (days >= lo && days <= hi) return { date: d, days }; } return null; }

// ---------- regions ----------
const COUNTRY = { US: ["New York", "Los Angeles", "San Francisco", "Chicago", "Boston", "Seattle", "Austin", "Denver", "Miami", "Washington", "Philadelphia", "Atlanta", "Dallas", "Houston", "Portland", "San Diego", "Las Vegas", "Nashville", "Minneapolis"],
  CA: ["Toronto", "Vancouver", "Montreal"], GB: ["London", "Manchester", "Edinburgh"], IE: ["Dublin"], MX: ["Mexico City"] };
const COUNTRY_OF = new Map(Object.entries(COUNTRY).flatMap(([k, L]) => L.map((c) => [c, k])));
/** Where a city is: { city, country, north } from server/geo.js, or null for a city we don't know. */
export function whereOf(city) { const c = city ? cityCentre(city) : null; return c ? { city: c.name, country: COUNTRY_OF.get(c.name) || "", north: c.lat > 0 } : null; }
/** Is this moment for this place? No place: only moments for everywhere. */
export function regionOK(m, W) { const R = m.regions || ["US"];
  if (!W) return R.includes("*") && !m.cities?.length;
  if (m.cities?.length && !m.cities.includes(W.city)) return false;
  return R.includes("*") || (R.includes("N") && W.north) || (!!W.country && R.includes(W.country)); }

// ---------- sensitivity: plain, respectful, no party themes for religious observances ----------
const PARTYISH = /\bpart(y|ies)\b|\btheme|\bcostume|\bdrinks?\b|cocktail|\bbar\b|\bbash\b|\brave\b|\bshots?\b|\bbooz|\bdrunk|\bwasted\b/i;
const STEREO = /leprechaun|sombrero|geisha|\bexotic\b|\boriental\b|\btribal\b|\bgypsy\b|kiss me i'?m|\bdrunk/i;
/** Every rule a moment must keep. Returns a list of problems (empty when it's fine). */
export function checkMoment(m) { const E = [], all = (m.ideas || []).map((i) => `${i.title} ${i.cta} ${i.line}`).join(" ") + ` ${m.name} ${m.head || ""}`;
  if (!/^[a-z0-9-]{2,40}$/.test(m.id || "")) E.push("id"); if (!TYPES.includes(m.type)) E.push("type"); if (!COVERS.includes(m.cover)) E.push("cover");
  if (!(m.ideas?.length >= 2 && m.ideas.length <= 3)) E.push("2 or 3 ideas");
  for (const i of m.ideas || []) { if (!KINDS.includes(i.kind)) E.push("kind " + i.kind); if (!i.title || !i.cta || !i.line) E.push("idea words"); }
  const [lo, hi] = m.lead || []; if (!(hi >= 7 && hi <= 28 && lo <= hi && lo >= -14)) E.push("lead");
  if (!m.regions?.length) E.push("regions"); if (!dateOf(m, 2026) && !dateOf(m, 2027)) E.push("no date");
  if (/\u2014/.test(all)) E.push("em dash"); if (STEREO.test(all)) E.push("stereotype");
  if (m.type === "religious") { if (PARTYISH.test(all)) E.push("party words on a religious observance"); for (const i of m.ideas || []) if (!/^If you/.test(i.cta)) E.push("religious ideas start 'If you celebrate'"); }
  return E; }

// ---------- cards ----------
const when = (n, starts) => (n <= 0 ? "" : n === 1 ? "tomorrow" : n < 14 ? `in ${n} days` : `in ${Math.round(n / 7)} weeks`);
/** The idea that fits this person best (interests), else the first. */
const pickIdea = (ideas, interests = []) => { const I = new Set(interests); let best = ideas[0], s = -1; for (const x of ideas) { const n = (x.interests || []).filter((i) => I.has(i)).length; if (n > s) { s = n; best = x; } } return { idea: best, fit: Math.max(0, s) }; };
export function momentCard(m, occ, { interests = [], city = "", now = Date.now() } = {}) {
  const { idea, fit } = pickIdea(m.ideas, interests), w = when(occ.days), nm = m.name;
  const head = m.usually ? `${nm} usually peak in ${m.usually}` : m.head ? m.head.replace("{when}", w || "here") : occ.days <= 0 ? `${nm} has begun` : m.starts ? `${nm} starts ${w}` : `${nm} is ${w}`;
  // a Saturday near the date, but never one that's gone or too close to plan: then the day itself, or the next Saturday
  let date = planDate(occ.date, m.plan); const t0 = at(iso(now));
  if (at(date) < t0 + 2 * DAY) date = at(occ.date) >= t0 + 2 * DAY ? occ.date : iso(t0 + ((6 - dow(iso(now)) + 7) % 7 || 7) * DAY);
  const line = idea.line + (m.around ? ` Expected around ${dateLabel(occ.date)}.` : "");
  const type = m.type === "religious" || m.type === "cultural" ? "observance" : m.type === "season" ? "season" : m.type === "watch" ? "watch" : "holiday";
  return { kind: "inspire", key: `in:m:${m.id}:${occ.date.slice(0, 4)}`, id: `m:${m.id}:${occ.date.slice(0, 4)}`, source: "calendar", type, label: LABEL.calendar, head, idea: idea.cta, line, cover: m.cover,
    plan: { kind: idea.kind, title: idea.title, date, city: clean(city, 60) }, track: { via: "calendar", kind: type, goal: m.id }, _s: 3 + fit - (type === "observance" ? 0.5 : 0) - occ.days / 60 };
}
const catOf = (t) => { t = lc(t); return /matcha/.test(t) ? "matcha" : /wine ?bar|\bwine\b|natural wine|enoteca/.test(t) ? "wine bar" : /bakery|bakehouse|boulangerie|patisserie|pâtisserie|pastry|croissant|bread|\bbake/.test(t) ? "bakery"
  : /coffee|caf[eé]\b|espresso|roaster|\bbrew/.test(t) ? "coffee" : /restaurant|bistro|trattoria|kitchen|dinner|supper|tavern|osteria|izakaya|eatery|brasserie|taqueria|omakase/.test(t) ? "dinner" : ""; };
const slug = (c) => c.replace(/\s+/g, "-");
export function spotCard({ source, label, name, hood = "", city = "", category, line, link = null, firstNew = false, n = 0, first = "" }) {
  const C = CATS[category], where = hood || city;
  const head = firstNew ? `${name} in ${where}` : `New ${C.noun} in ${where}`;
  const text = firstNew ? (n > 1 ? `${n} public events here on Pottery Lab since ${dateLabel(first)}.` : `Its first public event on Pottery Lab was ${dateLabel(first)}.`) : `${name}. ${line}`;
  const id = `s:${source === "new_here" ? "new" : source === "team" ? "team" : "prov"}:${slug(category)}:${h10(lc(name) + "|" + lc(city))}`;
  return { kind: "inspire", key: "in:" + id, id, source, type: "spot", label, head, idea: C.plan, line: clean(text, 220), cover: C.cover, ...(link ? { link } : {}),
    plan: { kind: C.kind, title: C.title(name), place: name, hood, city }, track: { via: source, kind: "spot", goal: slug(category).replace(/-/g, "_") }, _s: source === "new_here" ? 3.2 : source === "team" ? 3 : 2.6, _cat: category };
}

// ---------- the feed rhythm ----------
/** Where inspiration may go in a stream of n cards: FIRST_AT, then every EVERY cards after it. */
export function slotsFor(n) { if (n <= 0) return []; const S = []; for (let p = Math.min(FIRST_AT, n); p <= n; p += EVERY) S.push(p); return S; }
/** Put cards into a stream at the slots, never right next to the ideas deck. */
export function place(items, cards) { const base = items.filter((x) => x.kind !== "inspire"), S = slotsFor(base.length), at = [];
  for (let i = 0; i < Math.min(S.length, cards.length); i++) { let p = Math.max(S[i], at.length ? at[at.length - 1] + EVERY - 1 : 0); if (base[p]?.kind === "ideas") p += 1; if (base[p - 1]?.kind === "ideas") p += 1; if (p > base.length) break; at.push(p); }
  const out = [...base]; for (let i = at.length - 1; i >= 0; i--) out.splice(at[i], 0, cards[i]); return out; }
/** Today's day cap: cards already shown today stay, new ones only while fewer than PER_DAY different ones were shown. */
export function capDay(cards, seenToday = []) { const seen = new Set(seenToday), out = []; let n = seen.size;
  for (const c of cards) { if (c.type === "city" || seen.has(c.id)) { out.push(c); continue; } if (n < PER_DAY) { out.push(c); n++; } } return out; }

export function makeInspiration({ store, app = null, clock = () => Date.now() } = {}) {
  const spots = makeSpotNotes(store);
  const today = () => { const t = process.env.ENCORE_INSPIRATION_TODAY; return /^\d{4}-\d{2}-\d{2}$/.test(t || "") ? at(t) + 15 * 3600e3 : clock(); };
  // what one person or device did: dismissed cards (kept), cards shown per day (the last few days)
  const P = (who) => "system/inspire-" + h10("i:" + who) + h10("j:" + who);
  const stateOf = (who) => (who && store.get(P(who))?.data) || { kind: "inspire", dismissed: [], days: {} };
  const save = (who, d) => { const keep = Object.keys(d.days || {}).sort().slice(-3); store.set(P(who), { kind: "inspire", dismissed: (d.dismissed || []).slice(0, 300), days: Object.fromEntries(keep.map((k) => [k, d.days[k].slice(0, 20)])) }); };
  function dismiss(who, id) { if (!who) return; const d = stateOf(who); d.dismissed = [id, ...(d.dismissed || []).filter((x) => x !== id)]; save(who, d); }
  function seen(who, id, now = today()) { if (!who) return; const d = stateOf(who), k = iso(now), L = d.days[k] || []; if (!L.includes(id)) { d.days[k] = [...L, id]; save(who, d); } }
  const seenToday = (who, now = today()) => (who ? stateOf(who).days?.[iso(now)] || [] : []);

  /** New on Pottery Lab: public places whose first public event here was in the last NEW_DAYS days, in this city. */
  function newHere(I, publicOK, W, now = today()) { if (!I || !W) return []; const M = new Map();
    for (const x of I.events.values()) { const e = x.e || {}; if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || "")) continue; let ok = false; try { ok = publicOK(x); } catch {} if (!ok || e.example || e.sample || e.cancelled) continue;
      const g = geoPlace(e); if (!g.exact) continue; const c = whereOf(e.city)?.city || ""; if (!c) continue; const name = clean(e.venueName, 60); if (!name) continue;
      const k = lc(name) + "|" + c; let r = M.get(k); if (!r) M.set(k, (r = { name, city: c, hood: clean(e.hood, 60), first: e.date, n: 0, text: "" })); r.n++; if (e.date < r.first) r.first = e.date; r.text += ` ${name} ${e.activity || ""} ${e.pubTitle || e.name || ""}`; }
    const t = at(iso(now)); return [...M.values()].filter((r) => r.city === W.city && at(r.first) >= t - NEW_DAYS * DAY && at(r.first) <= t + 14 * DAY).map((r) => ({ ...r, category: catOf(r.name) || catOf(r.text) })).filter((r) => r.category)
      .map((r) => spotCard({ source: "new_here", label: LABEL.new_here, name: r.name, hood: r.hood, city: r.city, category: r.category, firstNew: true, n: r.n, first: r.first })); }
  /** A configured places provider's "new" or "hot and new" places (app.locals.placeSuggest.newSpots), labelled by name. */
  function provider(W) { const F = app?.locals?.placeSuggest?.newSpots; if (!W || typeof F !== "function") return []; let L = []; try { L = F(W.city) || []; } catch { return []; } if (!Array.isArray(L)) return [];
    return L.filter((p) => p && (p.flag === "new" || p.flag === "hot_and_new") && CATS[lc(p.category)] && clean(p.name, 60) && /^[A-Za-z][A-Za-z .-]{1,30}$/.test(p.source || "") && (!p.city || whereOf(p.city)?.city === W.city)).slice(0, 6)
      .map((p) => spotCard({ source: "provider", label: `${p.flag === "hot_and_new" ? "Hot and new" : "New"} on ${clean(p.source, 30)}`, name: clean(p.name, 60), hood: clean(p.hood, 60), city: W.city, category: lc(p.category), line: clean(p.line || "Just opened, by their listing.", 140), link: /^https:\/\//.test(p.url || "") ? { href: String(p.url).slice(0, 300), text: `See it on ${clean(p.source, 30)}` } : null })); }
  /** Every card this person could get today, best first (before dismissals and the day cap). */
  function candidates({ city = "", interests = [], I = null, publicOK = () => false } = {}, now = today()) {
    const W = whereOf(city), M = MOMENTS.filter((m) => !checkMoment(m).length && regionOK(m, W)).map((m) => [m, occurrence(m, now)]).filter(([, o]) => o).map(([m, o]) => momentCard(m, o, { interests, city: W?.city || "", now }));
    const team = W ? spots.active(now, W.city).map((n) => spotCard({ source: "team", label: LABEL.team, name: n.name, hood: n.hood, city: n.city, category: n.category, line: n.line, link: { href: n.source, text: "Where we saw it" } })) : [];
    const S = [...newHere(I, publicOK, W, now), ...team, ...provider(W)], seenS = new Set(), fitS = (c) => (CATS[c._cat]?.interests || []).some((i) => interests.includes(i)) ? 1 : 0;
    const spotsL = S.filter((c) => (seenS.has(c.id) ? false : (seenS.add(c.id), true))).sort((a, b) => b._s + fitS(b) - (a._s + fitS(a)));
    M.sort((a, b) => b._s - a._s); const out = []; for (let i = 0; i < Math.max(M.length, spotsL.length); i++) { if (M[i]) out.push(M[i]); if (spotsL[i]) out.push(spotsL[i]); } // take turns: a moment, a spot
    return out.map(({ _s, _cat, ...c }) => c); }
  const CITY = { kind: "inspire", key: "in:city", id: "city", type: "city", source: "prompt", label: "Ideas near you", head: "Where are you hosting?", idea: "", line: "I'll suggest things to host around what's coming up there, like holidays and new places." };
  /** Only what this person or device may still see: not dismissed, and the day cap. */
  function forWho(items, who, now = today()) { if (!who) return items; const d = stateOf(who), gone = new Set(d.dismissed || []);
    const ins = capDay(items.filter((x) => x.kind === "inspire" && !gone.has(x.id)), d.days?.[iso(now)] || []), keep = new Set(ins); return items.filter((x) => x.kind !== "inspire" || keep.has(x)); }
  /** The feed hook (server/feedblend.js blend): put today's inspiration into a stream. */
  function weave(items, { email = "", ws = "", device = "", city = "", interests = [], I = null, publicOK = () => false } = {}, now = today()) {
    let c = clean(city, 60), ints = interests; if (email && (!c || !ints.length)) { try { const p = app?.locals?.trends?.personOf({ email, ws }); if (!c) c = p?.city || ""; if (!ints.length) ints = p?.interests || []; } catch {} if (!c && ws) { try { c = clean(getWorkspace(ws)?.city, 60); } catch {} } }
    if (!email && !c) return place(items, [CITY]);
    const who = email ? "u:" + lc(email) : device; let L = candidates({ city: c, interests: ints, I, publicOK }, now);
    if (who) { const d = stateOf(who), gone = new Set(d.dismissed || []); L = capDay(L.filter((x) => !gone.has(x.id)), d.days?.[iso(now)] || []); } else L = L.slice(0, PER_DAY);
    return place(items, L); }
  const FROM = { m: "calendar", new: "new_here", team: "team", prov: "provider" };
  /** What a card id says about itself, for counting: { via, kind, goal }. */
  function tagsOf(id) { const s = String(id || ""), mm = /^m:([a-z0-9-]{2,40}):\d{4}$/.exec(s), sm = /^s:(new|team|prov):([a-z-]{2,20}):[0-9a-f]{10}$/.exec(s);
    if (mm) { const m = MOMENTS.find((x) => x.id === mm[1]); if (!m) return null; const t = m.type === "religious" || m.type === "cultural" ? "observance" : m.type === "season" ? "season" : m.type === "watch" ? "watch" : "holiday"; return { via: "calendar", kind: t, goal: m.id }; }
    if (sm) return { via: FROM[sm[1]], kind: "spot", goal: sm[2].replace(/-/g, "_") }; return s === "city" ? { via: "prompt", kind: "city", goal: "city" } : null; }
  /** An event saved from a "Plan this" (its inspiredBy): counted once as planned. */
  function planned(e, ws) { const T = tagsOf(e?.inspiredBy); if (!T) return false; return capture("inspiration_planned", { ws, ...T, region: e.city }); }
  return { candidates, weave, forWho, dismiss, seen, seenToday, stateOf, tagsOf, planned, newHere, spots, today, CITY };
}

export function mountInspiration(app, { store, express, currentUser }) {
  const IN = makeInspiration({ store, app }); app.locals.inspiration = IN;
  const small = express.json({ limit: "4kb" }), viewer = (req) => { try { const u = currentUser(req); return u && u.email && u.ws !== DEFAULT_WS ? u : null; } catch { return null; } };
  const hits = new Map(), over = (k, n) => { const now = Date.now(); let h = hits.get(k); if (!h || now - h.start > 3600e3) hits.set(k, (h = { n: 0, start: now })); if (hits.size > 50000) hits.clear(); return ++h.n > n; };
  const devOf = (req) => (/^[A-Za-z0-9_-]{8,40}$/.test(String(req.body?.device || req.query.device || "")) ? "dev:" + String(req.body?.device || req.query.device) : "");
  // shown, tapped (Plan this) and dismissed (Not for me); dismissed and shown are kept for the person or device
  app.post("/api/inspiration/track", small, (req, res) => { res.set("Cache-Control", "private, no-store"); if (over("ip|" + (req.ip || "?"), 600)) return res.status(429).json({ code: "rate_limited", message: "Slow down." });
    const id = String(req.body?.id || "").slice(0, 80), action = String(req.body?.action || ""), T = IN.tagsOf(id); if (!T || !["shown", "tapped", "dismissed"].includes(action)) return res.status(400).json({ code: "invalid", message: "Pick a card." });
    const u = viewer(req), who = u ? "u:" + lc(u.email) : devOf(req);
    if (action === "dismissed" && id !== "city") IN.dismiss(who, id); if (action === "shown" && id !== "city") IN.seen(who, id);
    capture("inspiration_" + action, { ...(u ? { ws: u.ws } : {}), ...T, signed_in: !!u, region: String(req.body?.city || "").slice(0, 40) });
    res.json({ ok: true, kept: !!who }); });
  // today's cards for this person (signed in), for checking what the feed would offer
  app.get("/api/me/inspiration", (req, res) => { res.set("Cache-Control", "private, no-store"); const u = viewer(req); if (!u) return res.status(401).json({ code: "unauthenticated", message: "Sign in first." });
    // the feed's own index and its public-card rule (server/feedblend.js cardOf), so this answers what the feed would
    let I = null, publicOK = () => false; try { const B = app.locals.feedBlend, v = B.viewerOf({}); I = v.I; publicOK = (x) => !!B.cardOf("e:" + x.id, v) || !!B.cardOf("r:" + x.id, v); } catch {}
    const q = { email: u.email, ws: u.ws, city: String(req.query.city || "").slice(0, 60), I, publicOK }, filler = Array.from({ length: 24 }, (_, i) => ({ kind: "event", key: "x" + i }));
    res.json({ cards: IN.weave(filler, q).filter((x) => x.kind === "inspire"), all: IN.candidates(q).map(({ id, head, label, source, type }) => ({ id, head, label, source, type })), today: iso(IN.today()) }); });
  // spot notes, for ENCORE_ADMIN_EMAILS only (404 for everyone else, as if the route weren't here)
  const admin = (req, res) => { let u = null; try { u = currentUser(req); } catch {} if (!u || !isAdmin(u.email)) { res.status(404).json({ code: "not_found", message: "Not found." }); return null; } res.set("Cache-Control", "private, no-store"); return u; };
  app.get("/api/admin/spot-notes", (req, res) => { if (!admin(req, res)) return; const now = IN.today(), A = new Set(IN.spots.active(now).map((n) => n.id)); res.json({ notes: IN.spots.all().map((n) => ({ ...n, active: A.has(n.id) })), categories: Object.keys(CATS), days: 60 }); });
  app.post("/api/admin/spot-notes", small, (req, res) => { if (!admin(req, res)) return; const r = IN.spots.add(req.body || {}, IN.today()); if (r.error) return res.status(400).json({ code: "invalid", message: r.error }); res.json({ ok: true, note: r.note }); });
  app.post("/api/admin/spot-notes/:id/retire", small, (req, res) => { if (!admin(req, res)) return; const r = IN.spots.retire(String(req.params.id).slice(0, 40), req.body?.on !== false); if (r.error) return res.status(404).json({ code: "not_found", message: r.error }); res.json({ ok: true }); });
  return IN;
}
