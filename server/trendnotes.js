// Trend notes: the editorial half of Potto's ideas (server/trends.js). We have no API from group invite apps or social
// apps, and scraping them breaks their terms, so we don't. Instead the team writes short notes by hand about social
// formats that are broadly popular right now, and Potto shows them as "Trending on social", never as measured.
//
// Rules for a note (docs/launch-checklist.md has the admin steps):
// - general terms only: no numbers, no quotes from a named app's data, no real brand's events, no em dashes
// - name (short), line (one sentence), where ("social media", "group invite apps"), season, cities (optional), added
// - a note older than NOTE_DAYS (about four months) drops out by itself, so the shelf never goes stale quietly
//
// The seed below ships in the code. Admins add and retire notes at runtime (POST /api/admin/trend-notes, gated by
// ENCORE_ADMIN_EMAILS like every admin route); those live in one system doc, system/trendnotes, with no personal data.
import crypto from "node:crypto";

export const NOTE_DAYS = 120;
const DAY = 864e5;
export const SEASONS = ["winter", "spring", "summer", "autumn"];
export const WHERE = ["social media", "group invite apps", "social media and group invite apps"];

// [id, name, line, where, seasons ("any" or a list), format (server/trends.js FORMATS key), say, added]
const SEED = [
  ["run-coffee", "Run club, coffee after", "An easy social run that ends at a café. The coffee is half the point.", "social media", "any", "run-coffee", "An easy 5k run club Saturday at 8, coffee after", "2026-11-02"],
  ["supper-club", "Supper club at home", "A set menu for a small table of people who don't all know each other yet.", "social media and group invite apps", "any", "supper-club", "A supper club for 8 at my place Saturday at 7, three courses", "2026-11-02"],
  ["theme-dinner", "Dinner party with a theme", "One playful theme, a dress cue and a menu that leans into it.", "group invite apps", ["autumn", "winter"], "dinner-party", "A themed dinner party for 8 Friday at 7, dress to the theme", "2026-11-04"],
  ["craft-night", "Pottery or craft night", "Hands busy, phones away: clay, a craft kit or a beginner class with friends.", "social media", "any", "craft-night", "A craft night for 8 Thursday at 7, everything provided", "2026-11-04"],
  ["picnic-setup", "A styled picnic", "Blankets, low tables and a spread worth a photo, in a park.", "social media", ["spring", "summer"], "picnic", "A picnic in the park Sunday at 1, everyone brings one thing", "2026-11-06"],
  ["coffee-popup", "Matcha or coffee pop-up", "A one-morning bar for matcha or good coffee, in a shop, a studio or on a stoop.", "social media", "any", "coffee-popup", "A matcha pop-up Sunday at 10, three drinks to try", "2026-11-06"],
  ["listening-night", "Listening night", "One album start to finish, good speakers, low lights, talking after.", "social media", ["autumn", "winter"], "listening-night", "A listening night Friday at 8, one album start to finish", "2026-11-08"],
  ["gallery-night", "Friends' gallery night", "A small show of friends' work with drinks and a short hello from each maker.", "group invite apps", "any", "gallery-night", "A gallery night Thursday at 7, friends' work on the walls", "2026-11-08"],
  ["singles-activity", "Singles night with something to do", "Singles events built around an activity, so nobody has to stand at a bar.", "social media", "any", "singles", "A singles night Thursday at 7 with a cooking class, no bar stools", "2026-11-10"],
  ["game-night", "Game night", "Board and party games with a rule that every game takes five minutes to teach.", "group invite apps", ["autumn", "winter"], "game-night", "A game night for 8 Friday at 7, bring a game you can teach in five minutes", "2026-11-10"],
  ["sound-bath", "Sound bath", "A guided sound session with mats and tea, often on a slow weekend morning.", "social media", "any", "sound-bath", "A sound bath Sunday at 10, mats and tea after", "2026-11-12"],
  ["mahjong", "Mahjong night", "Learn-to-play tables for beginners next to tables for regulars.", "social media", ["autumn", "winter"], "mahjong", "A mahjong night for 8 Friday at 7, beginners welcome", "2026-11-12"],
  ["potluck-theme", "Potluck with a theme", "Everyone brings a dish to one theme: a country, a colour, a family recipe.", "group invite apps", ["autumn", "winter"], "potluck", "A themed potluck Sunday at 6, everyone brings a family recipe", "2026-11-14"],
  ["pickleball", "Pickleball meetup", "Casual doubles for mixed levels, with a rotation so everyone plays.", "social media", ["spring", "summer", "autumn"], "pickleball", "A pickleball meetup Saturday at 10, mixed levels, we rotate", "2026-11-14"],
  ["book-club", "Book club, finishing optional", "A book club at a bar or café where you can come even if you didn't finish.", "social media", "any", "book-club", "A book club Tuesday at 7 at a café, finished or not, come", "2026-11-16"],
  ["fold-together", "Dumpling or pasta night", "Everyone folds or rolls, then everyone eats.", "social media", ["autumn", "winter"], "cooking-party", "A dumpling-folding night for 10 Sunday at 5, everyone folds", "2026-11-16"],
  ["holiday-swap", "Friends' holiday dinner or swap", "A friends' holiday dinner, or a cookie or gift swap before the year ends.", "group invite apps", ["autumn", "winter"], "holiday-swap", "A cookie swap Saturday at 3, bring a dozen and leave with a mix", "2026-11-18"],
  ["walk-club", "Walking club", "A brisk walk on a set route with a bakery or coffee stop.", "social media", "any", "walk", "A walking club Sunday at 9, a set route and a bakery stop", "2026-11-18"],
];
export const SEED_NOTES = SEED.map(([id, name, line, where, seasons, format, say, added]) => ({ id, name, line, where, seasons: seasons === "any" ? ["any"] : seasons, format, say, cities: [], added, seed: true }));

const clean = (v, n) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\u2014/g, ", ").replace(/\s+/g, " ").trim().slice(0, n);
const lc = (s) => String(s || "").trim().toLowerCase();
const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** The season a date falls in (northern hemisphere, where Pottery Lab's cities are today). */
export const seasonOf = (t = Date.now()) => { const m = new Date(t).getUTCMonth(); return m === 11 || m <= 1 ? "winter" : m <= 4 ? "spring" : m <= 7 ? "summer" : "autumn"; };
/** Is a note still fresh: added within NOTE_DAYS days? */
export const fresh = (n, now = Date.now()) => !!n && ISO.test(n.added || "") && now - Date.parse(n.added + "T00:00:00Z") <= NOTE_DAYS * DAY && Date.parse(n.added + "T00:00:00Z") <= now + DAY;
/** Does a note fit a season (and a city, when it names any)? */
export const fits = (n, { season = "", city = "" } = {}) => (!season || n.seasons.includes("any") || n.seasons.includes(season)) && (!n.cities?.length || !city || n.cities.some((c) => lc(c) === lc(city)));

/** Check and tidy a note an admin sends. Returns { note } or { error }. */
export function cleanNote(b = {}, now = Date.now()) {
  const name = clean(b.name, 60), line = clean(b.line, 160), where = WHERE.includes(lc(b.where)) ? lc(b.where) : "social media";
  if (name.length < 3) return { error: "Give the note a short name." };
  if (line.length < 10) return { error: "Add a one-line description." };
  // honesty: notes speak in general terms, so no numbers or percentages and no em dashes
  if (/\d+\s*(%|percent|k\b|million|thousand|views|likes|followers|rsvps?)/i.test(`${name} ${line}`)) return { error: "Keep it general: no numbers or counts. Trend notes are editorial, not data." };
  let seasons = (Array.isArray(b.seasons) ? b.seasons : String(b.seasons || b.season || "any").split(/[\s,]+/)).map(lc).filter((s) => s === "any" || SEASONS.includes(s));
  if (!seasons.length || seasons.includes("any")) seasons = ["any"];
  const cities = (Array.isArray(b.cities) ? b.cities : String(b.cities || "").split(",")).map((c) => clean(c, 40)).filter(Boolean).slice(0, 8);
  const added = ISO.test(b.added || "") && Date.parse(b.added) <= now + DAY ? b.added : new Date(now).toISOString().slice(0, 10);
  const id = "n-" + crypto.createHash("sha256").update(name + "|" + added).digest("hex").slice(0, 10);
  return { note: { id, name, line, where, seasons, cities, added, format: clean(b.format, 30).toLowerCase().replace(/[^a-z-]/g, ""), say: clean(b.say, 200) || `${name}: ${line}` } };
}

const PATH = "system/trendnotes";
export function makeTrendNotes(store) {
  const doc = () => store.get(PATH)?.data || { kind: "trendnotes", added: [], retired: [] };
  const all = () => { const d = doc(), gone = new Set(d.retired || []); return [...SEED_NOTES, ...(d.added || [])].map((n) => ({ ...n, retired: gone.has(n.id) })); };
  /** The notes Potto may use now: not retired, not older than NOTE_DAYS. */
  const active = (now = Date.now()) => all().filter((n) => !n.retired && fresh(n, now));
  function add(b, by = "", now = Date.now()) { const r = cleanNote(b, now); if (r.error) return r; const d = doc();
    if ([...SEED_NOTES, ...(d.added || [])].some((n) => n.id === r.note.id)) return { error: "That note is already there." };
    store.set(PATH, { ...d, kind: "trendnotes", added: [...(d.added || []), { ...r.note, by: by ? "admin" : "" }].slice(-200) }); return { note: r.note }; }
  function retire(id, on = true) { const d = doc(); if (!all().some((n) => n.id === id)) return { error: "No such note." };
    const R = new Set(d.retired || []); if (on) R.add(id); else R.delete(id); store.set(PATH, { ...d, kind: "trendnotes", retired: [...R] }); return { ok: true }; }
  return { all, active, add, retire };
}
