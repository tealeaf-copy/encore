// The events directory: every event hosts made public, in one place, as a page (/events), a read-only API (/api/v1)
// and a public MCP server (/mcp/public) that agents can pull from.
//
// What's in it:
// - Upcoming: exactly the events Discover lists (discoverable, not unlisted, not link-only, not past; sample hosts only
//   with include_examples).
// - Past: the events a public host page shows under "Past events": its scrapbook (imported from Partiful, Luma,
//   Eventbrite or added by hand, prepared pages included) and the open events it hosted here.
// - Reviews: guests' kudos, as the host's page shows them (first name, what they loved, the chips they tapped, the date).
//
// Privacy: everything here is already on a public page, and less. Only the neighborhood and city, never a street address
// or meet point. No guest names beyond a reviewer's first name, no guest counts, no emails or phone numbers, no pay links,
// no private feedback ("improve", "compare"). A host's page settings carry over: past events hidden on the page stay out,
// kudos hidden on the page stay out, and `directory: false` on the profile takes their past events and reviews out.
import { scopeStore, getWorkspace, allWorkspaceIds } from "./workspaces.js";
import { KUDOS_TAGS, VERIFIED_LABEL, withVerified } from "./social.js";
import { guessFormat, cleanLogos, isTalk, TALK_FORMATS, httpsLink, audienceOf } from "./scrapbook.js";
import { categoryOf as bookCategoryOf, CATEGORIES as BOOK_CATEGORIES } from "./market.js";
import { perPerson, isFlat, priceText } from "./search.js";
import { tzOk, tzOfCity, ordersClosed } from "./tz.js";
import { partyUnit } from "./social.js";

const TTL = () => (process.env.ENCORE_DIRECTORY_CACHE_MS != null ? Math.max(0, +process.env.ENCORE_DIRECTORY_CACHE_MS || 0) : 60_000);
const PER_HOUR = () => Math.max(1, +process.env.ENCORE_DIRECTORY_PER_HOUR || 600);
const MAX_LIMIT = 100;
const today = () => new Date().toISOString().slice(0, 10);
const s = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const first = (n) => { const f = String(n || "").trim().split(/\s+/)[0] || ""; return /@|\d{3}/.test(f) ? "" : s(f, 30); };
const isDemo = (ws) => /@demo\.encore$/i.test(getWorkspace(ws)?.ownerEmail || "");
const TAG_LABEL = Object.fromEntries(KUDOS_TAGS.map(([k, , label]) => [k, label]));
const ID_OK = /^[A-Za-z0-9_-]{1,120}$/, HANDLE = /^[a-z0-9][a-z0-9-]{1,29}$/;

// ---- small formatters ----
const FORMAT_WORDS = [["run", /\b(run|runs|running|5k|10k|jog|marathon)\b/], ["hike", /\b(hike|hiking|trail)\b/], ["dinner", /\b(dinner|supper|omakase|potluck)\b/], ["brunch", /\b(brunch|breakfast)\b/],
  ["workshop", /\b(workshop|masterclass|hands-on|wheel|throwing)\b/], ["class", /\b(class|classes|lessons?)\b/], ["pop-up", /\bpop[- ]?ups?\b|bake sale/], ["coffee", /\b(coffee|matcha|cafe|café)\b/], ["picnic", /\bpicnic\b/],
  ["game night", /game night|board game|trivia/], ["book club", /book club/], ["drinks", /happy hour|\bdrinks\b|\bwine\b|cocktail/], ["movement", /\b(movement|stretch)\b/],
  ["party", /\b(party|parties|celebration|disco)\b/], ["social", /\b(social|socials|mixer|mixers)\b/], ["summit", /\bsummit\b/], ["conference", /\bconference\b/], ["panel", /\bpanel\b|fireside/], ["meetup", /meetup|meet-up/], ["online", /\b(webinar|virtual|online|zoom)\b/],
  ["tour", /\btour\b/], ["launch", /\blaunch\b/], ["offsite", /offsite|retreat/]];
// a class: dance, salsa, bachata, improv, yoga, pilates, a language or music lessons. Not a workshop (one-off, hands-on).
// A language or an instrument only counts with a class word ("Spanish class", "guitar lessons"; not "French bistro night").
const CLASS_RE = /\b(dance|dancing|salsa|bachata|tango|swing dance|ballet|hip[- ]hop|zumba|improv|yoga|pilates|barre)\b/, LESSON_RE = /\b(language|spanish|french|italian|japanese|mandarin|korean|german|music|guitar|piano|violin|singing|voice|drum|drums)\b/, CLASSY = /\b(class|classes|lessons?|course|exchange|conversation)\b/;
const CLASS_WORDS = { test: (t) => CLASS_RE.test(t) || (LESSON_RE.test(t) && CLASSY.test(t)) };
const SOCIAL_RE = /\b(social|socials|mixer|mixers|party|parties)\b/;
export function formatOf({ activity = "", title = "", tags = [], format = "", about = "", place = "" } = {}) {
  if (format) return s(format, 24).toLowerCase();
  // a course or class the app filed under "workshop" (or "movement") is a class when its words say so
  { const a = String(activity).toLowerCase(), byAct = FORMAT_WORDS.find(([, re]) => a && re.test(a))?.[0] || "";
    // ...but a dance social, party or mixer is a night out, not a class ("Bachata social"), unless it says class too
    const said = `${title} ${(tags || []).join(" ")}`.toLowerCase();
    if ((!byAct || ["workshop", "class", "movement", "party", "social"].includes(byAct)) && SOCIAL_RE.test(said) && !CLASSY.test(said)) return /\bpart(y|ies)\b/.test(said) ? "party" : "social";
    if ((!byAct || ["workshop", "class", "movement"].includes(byAct)) && CLASS_WORDS.test(`${activity} ${title} ${(tags || []).join(" ")}`.toLowerCase())) return "class"; }
  for (const t of [String(activity).toLowerCase(), `${activity} ${title} ${(tags || []).join(" ")}`.toLowerCase()]) for (const [f, re] of FORMAT_WORDS) if (t && re.test(t)) return f;
  return guessFormat({ title, about, place }) || "other";
}
const clock = (t) => { const m = String(t || "").match(/^(\d{1,2}):(\d{2})$/); if (!m) return s(t, 40); const h = +m[1], mm = m[2]; return `${h % 12 || 12}${mm === "00" ? "" : ":" + mm}${h < 12 ? "am" : "pm"}`; };
// ---- series: a class that repeats, a multi-week course, a class pass ----
// A port of public/invite.html's srEvery/srSpan/srWhen/srPrice (index.html's seriesEvery/seriesSpan/seriesPrice): the
// same words, checked against invite.html in test/directory-accuracy.test.js.
const SR_DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], SR_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const srDate = (v) => { const x = new Date(String(v || "") + "T12:00:00"); return isNaN(x) ? null : x; }, srMD = (x) => `${SR_MON[x.getMonth()]} ${x.getDate()}`;
const srNth = (x) => { const n = Math.ceil(x.getDate() / 7), last = new Date(x.getFullYear(), x.getMonth(), x.getDate() + 7, 12).getMonth() !== x.getMonth() && n >= 4; return last ? -1 : n; };
const srRep = (e) => e.repeat || (+e.sessions > 1 ? "weekly" : "");
const srDays = (e) => [...new Set((Array.isArray(e.weekdays) ? e.weekdays : []).map((w) => SR_DAY.findIndex((d) => d.toLowerCase() === String(w).toLowerCase())).filter((i) => i >= 0))];
const srEvery = (e) => { const x = srDate(e.date), r = srRep(e); if (!x || !r) return ""; const day = SR_DAY[x.getDay()].slice(0, 3); if (r === "weekly" && srDays(e).length > 1) return `Every ${srDays(e).map((i) => SR_DAY[i].slice(0, 3)).join(" and ")}`; if (r === "monthly") { const k = srNth(x), w = k < 0 ? "Last" : ["First", "Second", "Third", "Fourth"][k - 1]; return `${w} ${day} of each month`; } return r === "biweekly" ? `Every other ${day}` : r === "weekly" ? `Every ${day}` : ""; };
const srLast = (e) => { const x = srDate(e.date), n = +e.sessions || 0; if (!x || n < 2) return null; const y = new Date(x); y.setDate(y.getDate() + (n - 1) * (e.repeat === "biweekly" ? 14 : 7)); return y; };
const srSpan = (e) => { const x = srDate(e.date), y = srLast(e); return x && y ? `${+e.sessions} ${SR_DAY[x.getDay()]}s, ${srMD(x)} to ${srMD(y)}` : ""; };
const srWhen = (e) => { const head = srSpan(e) || srEvery(e); if (!head) return ""; const st = clockOr(e.startTime), en = st && e.endTime !== e.startTime ? clockOr(e.endTime) : ""; return [head, st && (en ? `${st} to ${en}` : st)].filter(Boolean).join(" · "); };
const dol = (n) => "$" + (n % 1 ? n.toFixed(2) : String(n));
const srAmt = (v) => { const m = String(v ?? "").match(/(\d+(?:\.\d{1,2})?)/); return m ? "$" + m[1] : ""; };
const srPrice = (e) => { const p = e.price && e.price !== "chip" ? srAmt(e.price) : "", n = +e.sessions || 0, pp = +e.passPrice || 0, pc = +e.passCount || 0;
  // a pass and sessions together: the pass is the bundle ("$20 a class, or $100 for all 6"), never "$20 for all 6" beside it
  if (pp && pc > 1) { const of = n > 1 && pc === n ? `all ${n}` : ""; return p ? `${p} a class, or ${srAmt(pp)} for ${of || pc}` : `${srAmt(pp)} for ${of || pc + " classes"}`; } if (p && e.priceUnit === "total") return +e.dropIn > 0 ? `${p} for the course, or ${srAmt(e.dropIn)} a class` : `${p} total`; if (p && e.priceUnit === "class") return `${p} a class`; if (n > 1 && p) return +e.dropIn > 0 ? `${p} for all ${n}, or ${srAmt(e.dropIn)} a class` : `${p} for all ${n}`; return ""; };
// invite.html's clock: "7pm", "7:30am"; "" for anything that isn't HH:MM
const clockOr = (t) => (/^\d{2}:\d{2}$/.test(t || "") ? clock(t) : "");
const ymd = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
const sessionsOf = (c) => { const n = Math.round(+c.sessions || 0); return n > 1 && n <= 52 ? n : null; };
/** The series fields a directory record carries: repeat, sessions, ends (a course's last date), pass, when. */
export function seriesOf(c) { const sessions = sessionsOf(c), r = srRep({ ...c, sessions }), repeat = ["weekly", "biweekly", "monthly"].includes(r) ? r : "";
  const e = { ...c, repeat: repeat || undefined, sessions }, last = sessions ? srLast(e) : null, pp = +c.passPrice || 0, pc = Math.round(+c.passCount || 0);
  return { repeat, sessions, ends: last ? ymd(last) : "", pass: pp > 0 && pc > 1 ? { price: srAmt(pp), count: pc } : null, when: repeat ? srWhen(e) : "" }; }
export const SERIES = { srEvery, srSpan, srWhen, srPrice };
// ---- end series ----
// the price the event card shows: "Free", "Pay what you like", "$20 a person", "$320 for all 8", "$20 a class, or $70 for 4", "$12 each"
export function priceOf(c) {
  const p = String(c.price ?? "").trim();
  // a course or a class pass says what it costs in its own words (a pass with no drop-in price too: "$70 for 4 classes")
  if (c.free !== true && p !== "chip") { const sp = srPrice({ ...c, price: /^(free|0|\$0)$/i.test(p) ? "" : c.price, sessions: sessionsOf(c) || 0 }); if (sp) return sp; }
  if (c.free === true || /^(free|0|\$0)$/i.test(p)) return "Free";
  // no price written down isn't "Free": say nothing (null) rather than promise it
  if (!p) return null;
  if (p === "chip") return "Pay what you like";
  // review round 11: a pair or a group books together ("$60 for 2", "$120 for 4"), never "a person"
  { const gp = +c.groupPrice, gs = Math.floor(+c.groupSize); if (gp > 0 && gs > 1) return `${dol(gp)} for ${gs}`; }
  // review round 11: a pre-order with the host's items: the cheapest ("$3 each", or "from $3 each" when prices differ)
  if (c.preorder) { const P = orderItemsOf(c).map((x) => x.price).filter((x) => x > 0); if (P.length) { const lo = Math.min(...P); return `${new Set(P).size > 1 ? "from " : ""}${dol(lo)} each`; } }
  // a pre-order or a pop-up priced by the item
  if ((c.preorder || /^(each|item)$/i.test(String(c.priceUnit || ""))) && /^\$?\d/.test(p) && !/a person|per |at the door/i.test(p)) return /\beach\b/i.test(p) ? s(p.startsWith("$") ? p : "$" + p, 40) : `${srAmt(p)} each`;
  if (/^\$?\d/.test(p)) { const amt = p.startsWith("$") ? p : "$" + p; return /a person|each|per |at the door/i.test(amt) ? s(amt, 40) : `${s(amt, 30)} a person`; }
  return /^quoted$/i.test(p) ? null : s(p, 40) || null;
}
/** A pre-order's items as the directory lists them: [{ name, price }] (price in dollars, 0 when the host gave none). */
export const orderItemsOf = (c) => (Array.isArray(c?.orderItems) ? c.orderItems : []).slice(0, 12).map((x) => ({ name: s(x?.name, 60), price: Math.round((+String(x?.price ?? "").replace(/[^\d.]/g, "") || 0) * 100) / 100 })).filter((x) => x.name);
// "Chelsea, New York" -> area Chelsea, city New York; "Napa Valley, CA" -> city "Napa Valley, CA"
// A country on its own is never a city: "Sydney, Australia" -> city Sydney; "USA" -> nothing.
const COUNTRY = /^(australia|usa|us|u\.s\.a?\.?|united states(?: of america)?|canada|uk|u\.k\.|united kingdom|great britain|england|new zealand)$/i;
export function splitPlace(place) {
  const P = String(place || "").split(/,\s*/).map((x) => x.trim()).filter(Boolean);
  while (P.length && COUNTRY.test(P[P.length - 1])) P.pop();
  if (!P.length) return { city: "", area: "" };
  if (P.length === 1) return { city: P[0], area: "" };
  if (/^([A-Z]{2}|NSW|VIC|QLD|ACT|TAS)$/.test(P[P.length - 1])) return { city: P.slice(-2).join(", "), area: P.length > 2 ? P.slice(0, -2).join(", ") : "" };
  return { city: P[P.length - 1], area: P.slice(0, -1).join(", ") };
}
// a speaking engagement from a scrapbook: its directory format (a fireside chat lists as a panel; a talk by role alone, a
// talk) and what the host wrote about it. Anything that isn't a talk has speaking: null.
function speakingOf(x) { if (!isTalk(x)) return null;
  return { role: s(x.role, 40), topic: s(x.topic, 140), organizer: s(x.organizer, 60), audience: audienceOf(x.audience) || null, recording: httpsLink(x.recording), slides: httpsLink(x.slides) }; }
const talkFormat = (x) => { const f = s(x.format, 24).toLowerCase(); return f === "fireside" ? "panel" : TALK_FORMATS.includes(f) ? f : f || "talk"; };
const csvCell = (v) => { let t = Array.isArray(v) ? v.join("; ") : v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };

// ---- reviews (guests' kudos) ----
const EMPTY_REVIEWS = () => ({ count: 0, would_go_again_pct: null, top_tags: [], items: [] });
const noContact = (t) => String(t || "").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "…").replace(/\(?(?:\+?\d[\s().-]*){7,}\d/g, "…");
// ---- reviews: verified labels (kudos ask work) ----
// verified: "guest_list" (came, on the guest list), "rsvp" (replied I'm in) or null (we claim nothing). Picked field by
// field: never the reviewer's email, the reply id, "improve" or "compare".
const VERIFIED = new Set(Object.keys(VERIFIED_LABEL));
function reviewItem(k) { const v = VERIFIED.has(k.verified) ? k.verified : null;
  return { name: first(k.name) || "A guest", text: s(noContact(k.love), 500), tags: (k.tags || []).filter((t) => TAG_LABEL[t]).map((t) => TAG_LABEL[t]), at: k.at ? new Date(k.at).toISOString().slice(0, 10) : "", verified: v, verified_label: v ? VERIFIED_LABEL[v] : "" }; }
// ---- end verified labels ----
// the host page's numbers: reviews are kudos with words or chips; "would go again" is the same definition the page uses
function summarize(K, { items = 10 } = {}) {
  const shown = K.filter((k) => k.love || (k.tags || []).length).sort((a, b) => (b.at || 0) - (a.at || 0));
  if (!shown.length) return EMPTY_REVIEWS();
  const tags = {}; for (const k of shown) for (const t of k.tags || []) if (TAG_LABEL[t]) tags[t] = (tags[t] || 0) + 1;
  const yes = K.filter((k) => (k.tags || []).includes("again") || k.compare === "better").length, of = K.filter((k) => (k.tags || []).length || k.love || k.compare).length;
  return { count: shown.length, would_go_again_pct: shown.length >= 3 && of ? Math.round((100 * yes) / of) : null,
    top_tags: Object.entries(tags).sort((a, b) => b[1] - a[1] || (/^(again|Would go again)$/.test(a[0]) ? 1 : 0) - (/^(again|Would go again)$/.test(b[0]) ? 1 : 0) || String(a[0]).localeCompare(String(b[0]))).slice(0, 5).map(([tag, count]) => ({ tag, label: TAG_LABEL[tag], count })),
    items: shown.slice(0, items == null ? shown.length : items).map(reviewItem) };
}

// ---- search: any of the words, ranked ----
// "pottery class", "dance this weekend", "dinner near me": filler words drop out, plurals fold ("classes" -> class),
// and a few words stand for their kinds ("dance" finds salsa and bachata; "pottery" finds ceramics and the wheel).
const STOP = new Set("a an the this that these those weekend weekends near me my in on at for with and or of to any some tonight today tomorrow".split(" "));
const SYN = { dance: ["dance", "dancing", "salsa", "bachata", "tango", "swing", "ballet", "hip", "zumba"], pottery: ["pottery", "ceramic", "ceramics", "clay", "wheel", "throwing"], ceramic: ["ceramic", "pottery", "clay"],
  class: ["class", "lesson", "course"], lesson: ["lesson", "class"], dinner: ["dinner", "supper"], supper: ["supper", "dinner"], run: ["run", "running", "5k", "10k", "jog"], yoga: ["yoga"], language: ["language", "spanish", "french", "italian", "japanese", "mandarin", "korean", "german"] };
const stem = (w) => (w.length > 4 && /ies$/.test(w) ? w.slice(0, -3) + "y" : w.length > 4 && /(ches|shes|sses|xes)$/.test(w) ? w.slice(0, -2) : w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w);
const toks = (t) => String(t || "").toLowerCase().split(/[^a-z0-9\u00c0-\u024f]+/).filter(Boolean);
export const queryWords = (q) => [...new Set(toks(s(q, 120)).filter((w) => !STOP.has(w)).map(stem))].slice(0, 12);
// ---- dates in the words: "tonight", "tomorrow", "this weekend", "next weekend", "this week" ----
// They become from/to (in the event city's time zone when we know it, else ENCORE_TZ) and drop out of the words.
// A weekend is Friday to Sunday; "next weekend" is the one after this one; "this week" runs to Sunday.
const DATE_RE = /\b(tonight|today|tomorrow|this\s+weekend|next\s+weekend|this\s+week)\b/i;
export { tzOfCity }; // (server/tz.js)
/** The date phrase in a query and the query without it. */
export function datePhrase(q) { const m = String(q || "").match(DATE_RE); return m ? { phrase: m[1].toLowerCase().replace(/\s+/g, " "), rest: String(q).replace(DATE_RE, " ").replace(/\s+/g, " ").trim() } : { phrase: "", rest: String(q || "") }; }
/** from/to (YYYY-MM-DD) for a date phrase, in a time zone ("" = ENCORE_TZ, else the server's). */
export function dateRange(phrase, tz = "", now = Date.now()) {
  const zone = tzOk(tz) ? tz : tzOk(process.env.ENCORE_TZ) ? process.env.ENCORE_TZ : undefined;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  const d0 = Date.parse(day + "T12:00:00Z"), dow = new Date(d0).getUTCDay(), add = (n) => new Date(d0 + n * 864e5).toISOString().slice(0, 10);
  const fri = dow === 0 ? -2 : dow === 6 ? -1 : 5 - dow; // this weekend's Friday (today or before, once it has started)
  switch (phrase) {
    case "tonight": case "today": return { from: day, to: day };
    case "tomorrow": return { from: add(1), to: add(1) };
    case "this week": return { from: day, to: add((7 - dow) % 7) };
    case "this weekend": return { from: add(Math.max(0, fri)), to: add(fri + 2) };
    case "next weekend": return { from: add(fri + 7), to: add(fri + 9) };
    default: return null; } }
function matchScore(e, words) {
  const F = [[3, [e.title]], [2, [...e.tags, e.format, e.host.name, e.host.handle, e.area]], [1, [e.city, ...e.companies, e.speaking?.topic || "", e.speaking?.organizer || ""]]].map(([w, L]) => [w, toks(L.join(" "))]);
  const hit = words.map((q) => { const alts = SYN[q] || [q]; let best = 0; for (const [wt, T] of F) if (wt > best && T.some((t) => alts.some((a) => t.startsWith(a)))) best = wt; return best; });
  return { n: hit.filter(Boolean).length, hit }; }
// ---- end search ----

export function makeDirectory({ store, C, SB, LB = () => null }) {
  let cache = null;
  // typical first reply to a brand request: the median time to the host's first message, quote or answer
  function respondsIn(ws) { const T = [];
    for (const d of scopeStore(store, ws).list("inquiries")) { const r = d.data; if (!r?.at) continue; const hostAt = [...(r.thread || []), ...(r.history || [])].filter((m) => m?.by === "host" && +m.at > r.at).map((m) => +m.at);
      if (hostAt.length) T.push(Math.min(...hostAt) - r.at); }
    if (!T.length) return null; T.sort((a, b) => a - b); const h = T[Math.floor((T.length - 1) / 2)] / 3600e3;
    return { hours: Math.round(h * 10) / 10, text: h <= 1 ? "within an hour" : h <= 24 ? `within ${Math.ceil(h - 0.01)} hours` : `within ${Math.ceil(h / 24)} days` }; }
  function build(base) {
    const now = today(), hideDemo = process.env.ENCORE_HIDE_DEMO === "1";
    const D = C.discover({ all: true });
    const hosts = new Map(), events = [], kudosOf = new Map();
    const abs = (u) => (!u ? "" : /^https:\/\//i.test(u) ? u : /^\/[A-Za-z0-9_\-./]+$/.test(u) && !u.includes("..") ? base + u : "");
    const hostRef = (h) => ({ handle: h.handle, name: s(h.name || h.handle, 60), url: `${base}/@${h.handle}` });
    const addHost = (h, { ws = null, sample = false, showcase = false } = {}) => {
      const rec = { handle: h.handle, name: s(h.name || h.handle, 60), url: `${base}/@${h.handle}`, city: s(h.city, 60), area: s(h.hood, 60), tagline: s(h.tagline, 140), bio: s(h.bio, 400),
        tags: (Array.isArray(h.tags) ? h.tags : []).map((t) => s(t, 24)).filter(Boolean).slice(0, 8), emoji: s(h.emoji, 4), avatar: abs((h.gallery || [])[0] || h.theme?.avatarUrl || ""),
        prepared: !!showcase, example: !!sample };
      hosts.set(h.handle, { rec, ws, h, sample, showcase, kudosOff: h.sections?.kudos === false || h.directory === false, pastOff: h.sections?.past === false || h.directory === false });
    };
    // host pages the public lists show: finished pages (or sample hosts), plus prepared pages nobody has claimed yet
    for (const ws of allWorkspaceIds()) { const h = C.profileOf(ws); if (!h?.handle || !HANDLE.test(h.handle)) continue; const sample = isDemo(ws);
      if ((sample && hideDemo) || (!sample && C.pageGaps(h).length)) continue; addHost(h, { ws, sample }); }
    for (const x of D.hosts) if (x.showcase && !hosts.has(x.handle)) { const P = C.showcaseOf(x.handle); if (P) addHost(P, { showcase: true }); }

    const reviewsFor = (H, eventId) => { if (!H?.ws || H.kudosOff) return EMPTY_REVIEWS();
      // verified labels (kudos ask work): worked out on read and saved back, so older kudos get one too
      if (!kudosOf.has(H.ws)) { const KS = scopeStore(store, H.ws); kudosOf.set(H.ws, KS.list("kudos").filter((d) => d.data && typeof d.data === "object").map((d) => withVerified(KS, d.id, d.data))); }
      return eventId ? summarize(kudosOf.get(H.ws).filter((k) => k.eventId === eventId), { items: null }) : summarize(kudosOf.get(H.ws), { items: null }); };
    // place: the event's own neighborhood, else its city, else blank (the card leaves the host's neighborhood out for an
    // event in another city; see community.js publicCard). spots_left: a public headcount minus who's going, 0 replies
    // included; null with no headcount or when the host hides who's going. Upcoming only.
    const fromCard = (c, H, status) => { const cp = splitPlace(c.city), city = cp.area ? s(c.city, 60) : s(cp.city, 60), sr = seriesOf(c);
      return { id: c.id, title: s(c.title, 140), status, start: /^\d{4}-\d{2}-\d{2}$/.test(c.date || "") ? c.date : "", time: [clock(c.startTime), clock(c.endTime)].filter(Boolean).join(" to "),
      city, area: s(c.hood, 60), format: formatOf({ activity: c.activity, title: c.title, tags: c.tags }), tags: (Array.isArray(c.tags) ? c.tags : []).map((t) => s(t, 24)).filter(Boolean).slice(0, 8),
      price: priceOf(c), spots_left: status === "upcoming" && +c.headcount > 0 && !c.hideGuests ? Math.floor(Math.max(0, Math.round(+c.headcount - (c.preorder ? +c.ordered || 0 : +c.going || 0))) / partyUnit(c)) : null, ask_to_join: !!c.approvalRequired,
      // review round 11: what one spot is (a person, a pair or group that books together, an item of a pre-order), in spots_left's units
      spot_unit: c.preorder ? "item" : partyUnit(c) > 1 ? "group" : "person", group_size: Math.floor(+c.groupSize) > 1 ? Math.min(50, Math.floor(+c.groupSize)) : null,
      // review round 11: a pre-order says so, with its items and when orders close (spots_left counts what's left to order)
      ...(c.preorder ? { preorder: true, items: orderItemsOf(c), order_by: s(c.orderBy, 40) || (/^\d{4}-\d{2}-\d{2}$/.test(c.orderByDate || "") ? c.orderByDate : ""),
        order_by_date: /^\d{4}-\d{2}-\d{2}$/.test(c.orderByDate || "") ? c.orderByDate : null, orders_open: status === "upcoming" && !ordersClosed({ ...c, tz: tzOk(c.tz) ? c.tz : tzOfCity(`${c.city || ""} ${c.hood || ""} ${H.h.city || ""}`) }) } : {}),
      repeat: sr.repeat, sessions: sr.sessions, ends: sr.ends, pass: sr.pass, when: sr.when,
      host: hostRef(H.h), url: `${base}/e/${encodeURIComponent(c.id)}`, source: "hosted", speaking: null, original_link: "", companies: [], cover: abs(c.coverPhoto), example: !!(c.sample || H.sample),
      // a class that repeats keeps its id, so guests' kudos from earlier sessions belong to the upcoming one too
      reviews: reviewsFor(H, c.id), _start: c.startTime || "", _raw: { price: c.price, free: c.free }, _tz: tzOk(c.tz) ? c.tz : tzOfCity(`${c.city || ""} ${c.hood || ""} ${H.h.city || ""}`) }; };

    // upcoming: Discover's list, as is
    for (const c of D.events) { const H = hosts.get(c.host?.handle); if (!H || !ID_OK.test(String(c.id)) || c.private || c.unlisted) continue; if ((c.date || "9999") < now) continue; events.push(fromCard(c, H, "upcoming")); }
    // past: what each page shows under "Past events"
    for (const H of hosts.values()) { if (H.pastOff) continue; const seen = new Set();
      if (H.ws) for (const c of C.eventsOf(H.ws, { upcoming: false })) { if (c.private || c.unlisted || !ID_OK.test(String(c.id))) continue; seen.add(`${String(c.title || "").toLowerCase()}|${c.date || ""}`); events.push(fromCard(c, H, "past")); }
      const items = H.ws ? SB.publicItems(H.ws) : H.h.scrapbook || [];
      for (const x of items) { const date = /^\d{4}-\d{2}-\d{2}$/.test(x.date || "") ? x.date : ""; if (date && date >= now) continue;
        const k = `${String(x.title || "").toLowerCase()}|${date}`; if (seen.has(k)) continue; seen.add(k);
        const { city, area } = splitPlace(x.place), link = /^https:\/\//i.test(x.link || "") ? x.link : "";
        const speaking = speakingOf(x);
        events.push({ id: `sb-${H.rec.handle}-${String(x.id).replace(/[^A-Za-z0-9_-]/g, "")}`, title: s(x.title, 140), status: "past", start: date, time: s(x.time, 40).replace(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s*·\s*/i, ""), city, area,
          format: speaking ? talkFormat(x) : formatOf({ format: x.format, title: x.title, about: x.about, place: x.place }), speaking, tags: [], price: null, spots_left: null, ask_to_join: false, repeat: "", sessions: null, ends: "", pass: null, when: "", host: hostRef(H.h), url: `${H.rec.url}#scrapbook`, source: "scrapbook",
          original_link: link, companies: cleanLogos(x.logos).map((l) => l.name), cover: abs(x.cover), example: !!H.sample, reviews: EMPTY_REVIEWS(), _start: "" }); } }

    // one event listed by two hosts (co-hosted, same original link): show it once, with both hosts; each host's own list still has it
    { const first = new Map(); for (const e of events) { const k = e.original_link && e.original_link.toLowerCase(); if (!k) continue; const f = first.get(k); if (!f) { first.set(k, e); continue; }
        if (f.host.handle !== e.host.handle) { e._dup = true; f.cohosts = [...(f.cohosts || []), e.host]; } } }
    // per-host numbers and reviews
    const byHost = new Map(); for (const e of events) { if (!byHost.has(e.host.handle)) byHost.set(e.host.handle, []); byHost.get(e.host.handle).push(e); }
    const listed = new Set(D.hosts.map((h) => h.handle)), titles = new Map(events.map((e) => [e.id, e]));
    let ranks = new Map(); try { ranks = LB()?.bestRanks?.() || new Map(); } catch {}
    const reviews = [];
    for (const [handle, H] of hosts) { const L = byHost.get(handle) || [];
      if (!L.length && !listed.has(handle) && !(H.h.forHire && !H.sample && !H.showcase)) { hosts.delete(handle); continue; } // hosts open to paid work stay findable (find_hosts)
      H.rec.upcoming_count = L.filter((e) => e.status === "upcoming").length; H.rec.past_count = L.filter((e) => e.status === "past").length;
      H.rec.formats = [...new Set(L.map((e) => e.format).filter((f) => f && f !== "other"))].slice(0, 8);
      // for brands and agents: open to paid work, group size, how fast they reply, best board, talk topics
      const X0 = (H.h.experiences || []).filter((x) => x && x.name), mins = X0.map((x) => Math.max(1, +x.min || 1)), maxs = X0.map((x) => +x.max || 0).filter((n) => n > 0);
      H.rec.for_hire = !H.sample && !H.showcase && !!H.h.forHire;
      H.rec.group_size = X0.length ? { min: Math.min(...mins), max: maxs.length ? Math.max(...maxs) : null } : null;
      const RI = H.ws && !H.sample ? respondsIn(H.ws) : null; H.rec.responds_in = RI?.text || null; H.rec.responds_in_hours = RI?.hours ?? null;
      H.rec.leaderboard = ranks.get(handle) || null;
      H.rec.speaking_topics = [...new Set(L.filter((e) => e.speaking?.topic).map((e) => e.speaking.topic))].slice(0, 8);
      H.packages = X0.map((x) => ({ id: s(x.id, 40), name: s(x.name, 80), price: s(priceText(x.price), 60), min: Math.max(1, +x.min || 1), max: +x.max || null, category: bookCategoryOf(x), per_person: perPerson(priceText(x.price)) || null, flat: isFlat(priceText(x.price)), _x: x }));
      const R = reviewsFor(H, null); H.rec.reviews = { count: R.count, would_go_again_pct: R.would_go_again_pct, top_tags: R.top_tags }; H.reviewItems = R.items;
      if (H.ws && !H.kudosOff) for (const k of (kudosOf.get(H.ws) || []).filter((k) => k.love || (k.tags || []).length)) { const ev = titles.get(k.eventId);
        reviews.push({ ...reviewItem(k), event: ev && ev.host.handle === handle ? { id: ev.id, title: ev.title, url: ev.url } : null, host: hostRef(H.h), example: !!H.sample, _at: k.at || 0 }); } }
    reviews.sort((a, b) => b._at - a._at);
    return { at: Date.now(), events, hosts, reviews };
  }
  const data = (base) => { if (!cache || cache.base !== base || Date.now() - cache.at > TTL()) cache = { ...build(base), base }; return cache; };

  // ---- queries ----
  const strip = (e, { items = 10 } = {}) => { const { _start, _dup, _raw, _tz, ...o } = e; return { ...o, reviews: { ...e.reviews, items: items == null ? e.reviews.items : e.reviews.items.slice(0, items) } }; };
  const truthy = (v) => /^(1|true|yes)$/i.test(String(v ?? ""));
  const encodeCursor = (n) => Buffer.from("o:" + n).toString("base64url");
  // review round 11: a cursor we didn't make, or one past the end of the list now (it changed since), is a 400 invalid_cursor
  const badCursor = () => Object.assign(new Error("That cursor doesn't work any more. Start again without one."), { status: 400, code: "invalid_cursor" });
  const decodeCursor = (c) => { if (c == null || c === "") return 0; const m = (() => { try { return Buffer.from(String(c), "base64url").toString().match(/^o:(\d{1,7})$/); } catch { return null; } })(); if (!m) throw badCursor(); return +m[1]; };
  const pageOf = (L, q, d) => { const off = decodeCursor(q.cursor), lim = limitOf(q.limit, d); if (off > 0 && off >= L.length) throw badCursor(); return { off, lim, page: L.slice(off, off + lim), next_cursor: off + lim < L.length ? encodeCursor(off + lim) : null }; };
  const limitOf = (v, d = 20) => Math.max(1, Math.min(MAX_LIMIT, Math.round(+v || d)));
  function filterEvents(base, q = {}) {
    const D = data(base), format = s(q.format, 24).toLowerCase(), type = s(q.type, 24).toLowerCase();
    // talks are mostly in the past (scrapbooks), so a speaking search looks at all of them unless it says otherwise
    const talky = type === "speaking" || format === "talk" || format === "speaking" || TALK_FORMATS.includes(format);
    const status = ["upcoming", "past", "all"].includes(q.status) ? q.status : talky ? "all" : "upcoming";
    const DP = datePhrase(s(q.q, 120)), words = queryWords(DP.rest);
    const city = s(q.city, 60).toLowerCase(), host = s(q.host, 30).toLowerCase().replace(/^@/, ""), ex = truthy(q.include_examples);
    const from0 = /^\d{4}-\d{2}-\d{2}$/.test(q.from || "") ? q.from : "", to0 = /^\d{4}-\d{2}-\d{2}$/.test(q.to || "") ? q.to : "";
    // "this weekend" in the words: each event's own dates, in its city's time zone (explicit from/to win)
    const byTz = new Map(), rangeOf = (e) => { if (!DP.phrase || from0 || to0) return { from: from0, to: to0 }; const tz = e._tz || ""; if (!byTz.has(tz)) byTz.set(tz, dateRange(DP.phrase, tz) || { from: "", to: "" }); return byTz.get(tz); };
    const inRange = (e) => { const { from, to } = rangeOf(e); return (!from || (e.start && e.start >= from)) && (!to || (e.start && e.start <= to)); };
    const L = D.events.filter((e) => (!e._dup || host) && (status === "all" || e.status === status) && (ex || !e.example) && (!city || `${e.city} ${e.area}`.toLowerCase().includes(city)) && (!format || (format === "talk" || format === "speaking" ? !!e.speaking : e.format === format)) && (type !== "speaking" || !!e.speaking) && (!host || e.host.handle === host)
      && inRange(e)
    );
    const up = L.filter((e) => e.status === "upcoming").sort((a, b) => String(a.start || "9").localeCompare(String(b.start || "9")) || a._start.localeCompare(b._start));
    const past = L.filter((e) => e.status === "past").sort((a, b) => String(b.start || "0").localeCompare(String(a.start || "0")));
    if (!words.length) return [...up, ...past];
    // any of the words, best first: the most words matched, then where they matched (title, then tags, format, host and
    // neighborhood, then the rest), then the usual order
    // (a rarer word counts for more: "pottery" over "class" in "pottery class")
    const M = [...up, ...past].map((e, i) => ({ e, i, m: matchScore(e, words) })).filter((x) => x.m.n), df = words.map((_, k) => M.filter((x) => x.m.hit[k]).length || 1);
    for (const x of M) x.w = x.m.hit.reduce((a, h, k) => a + h / df[k], 0);
    return M.sort((a, b) => b.m.n - a.m.n || b.w - a.w || a.i - b.i).map((x) => x.e);
  }
  function searchEvents(base, q = {}) { const L = filterEvents(base, q), P = pageOf(L, q, 20);
    return { data: P.page.map((e) => strip(e)), next_cursor: P.next_cursor, total: L.length }; }
  function getEvent(base, id) { const e = data(base).events.find((x) => x.id === String(id || "")); return e ? strip(e, { items: null }) : null; }
  // review 8: free text also reads the bio, talk topics, services and package names; "speaker" means talk formats
  const hostBlob = (H) => { const h = H.rec; return [h.name, h.handle, h.city, h.area, h.tagline, h.bio || "", ...h.tags, ...h.formats, ...(h.speaking_topics || []), H.h.services || "", ...(H.packages || []).map((p) => p.name)].join(" ").toLowerCase(); };
  const wordHits = (t, w) => t.includes(w) || (HOST_WORDS[w] ? HOST_WORDS[w].test(t) : false);
  function listHosts(base, q = {}) { const words = s(q.q, 120).toLowerCase().split(/\s+/).filter(Boolean), city = s(q.city, 60).toLowerCase(), ex = truthy(q.include_examples);
    const L = [...data(base).hosts.values()].filter((H) => { const h = H.rec; return (ex || !h.example) && (!city || `${h.city} ${h.area}`.toLowerCase().includes(city))
      && (!words.length || ((t) => words.every((w) => wordHits(t, w)))(hostBlob(H))); }).map((H) => H.rec)
      .sort((a, b) => b.upcoming_count + b.past_count + b.reviews.count - (a.upcoming_count + a.past_count + a.reviews.count) || a.name.localeCompare(b.name));
    const P = pageOf(L, q, 50);
    return { data: P.page, next_cursor: P.next_cursor, total: L.length }; }
  function getHost(base, handle) { const H = data(base).hosts.get(s(handle, 30).toLowerCase().replace(/^@/, "")); if (!H) return null;
    return { ...H.rec, reviews: { ...H.rec.reviews, items: H.reviewItems.slice(0, 50) }, events: filterEvents(base, { status: "all", host: H.rec.handle, include_examples: "1" }).map((e) => strip(e)) }; }
  function formats(base, q = {}) { const L = filterEvents(base, { status: q.status || "all", include_examples: q.include_examples }), F = {}, Ci = {}, FC = {}, speaking = L.filter((e) => e.speaking).length;
    for (const e of L) { F[e.format] = (F[e.format] || 0) + 1; if (e.city) { Ci[e.city] = (Ci[e.city] || 0) + 1; const k = e.format + "|" + e.city; FC[k] = (FC[k] || 0) + 1; } }
    const sort = (o) => Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { total: L.length, types: { speaking }, formats: sort(F).map(([format, count]) => ({ format, count })), cities: sort(Ci).map(([city, count]) => ({ city, count })), by_format_and_city: sort(FC).map(([k, count]) => { const [format, city] = k.split("|"); return { format, city, count }; }) }; }
  function listReviews(base, q = {}) { const D = data(base), host = s(q.host, 30).toLowerCase().replace(/^@/, ""), ev = s(q.event ?? q.event_id, 120), words = s(q.q, 120).toLowerCase().split(/\s+/).filter(Boolean), ex = truthy(q.include_examples) || !!host || !!ev;
    const L = D.reviews.filter((r) => (ex || !r.example) && (!host || r.host.handle === host) && (!ev || r.event?.id === ev) && (!words.length || ((t) => words.every((w) => t.includes(w)))([r.text, r.name, ...r.tags, r.event?.title || "", r.host.name].join(" ").toLowerCase())));
    const P = pageOf(L, q, 20), tags = {}; for (const r of L) for (const t of r.tags) tags[t] = (tags[t] || 0) + 1;
    return { data: P.page.map(({ _at, ...r }) => r), next_cursor: P.next_cursor, total: L.length,
      top_tags: Object.entries(tags).sort((a, b) => b[1] - a[1] || (/^(again|Would go again)$/.test(a[0]) ? 1 : 0) - (/^(again|Would go again)$/.test(b[0]) ? 1 : 0) || String(a[0]).localeCompare(String(b[0]))).slice(0, 5).map(([label, count]) => ({ tag: KUDOS_TAGS.find((k) => k[2] === label)?.[0] || "", label, count })) }; }
  function csv(base, q = {}) {
    const cols = ["id", "title", "status", "start", "time", "city", "area", "format", "tags", "price", "spots_left", "host_handle", "host_name", "host_url", "url", "source", "original_link", "companies", "cover", "example", "review_count", "would_go_again_pct", "when", "repeat", "sessions", "pass_price", "pass_count"];
    const rows = filterEvents(base, q).slice(0, 5000).map((e) => [e.id, e.title, e.status, e.start, e.time, e.city, e.area, e.format, e.tags, e.price, e.spots_left, e.host.handle, e.host.name, e.host.url, e.url, e.source, e.original_link, e.companies, e.cover, e.example, e.reviews.count, e.reviews.would_go_again_pct, e.when, e.repeat, e.sessions, e.pass?.price, e.pass?.count]);
    return [cols, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n"; }
  // schema.org Event for the page's upcoming events (for search engines; same public fields)
  // A course is one Event with an eventSchedule (weekly, N times) and an Offer for the whole course, never a per-person
  // price. A class that repeats gets an eventSchedule too, and Offers per class (and for the pass).
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  function ldSeries(e, hhmm) { const x = e.start ? new Date(e.start + "T12:00:00") : null, raw = e._raw || {}, chip = raw.price === "chip" || raw.free === true || e.price === "Free";
    const amt = chip ? 0 : +(String(raw.price ?? "").match(/(\d+(?:\.\d{1,2})?)/)?.[1] || 0), offer = (price, name) => ({ "@type": "Offer", price, priceCurrency: "USD", url: e.url, ...(name ? { name } : {}) });
    const sched = x && !isNaN(x) ? { "@type": "Schedule", startDate: e.start, ...(e.ends ? { endDate: e.ends } : {}), repeatFrequency: e.repeat === "monthly" ? "P1M" : e.repeat === "biweekly" ? "P2W" : "P1W", ...(e.sessions ? { repeatCount: e.sessions } : {}),
      byDay: "https://schema.org/" + DAYS[x.getDay()], ...(e.repeat === "monthly" ? { byMonthWeek: srNth(x) } : {}), ...(hhmm ? { startTime: hhmm } : {}) } : null;
    const offers = e.sessions && !e.pass ? (amt ? [offer(amt, `All ${e.sessions} sessions`)] : []) : [...(amt ? [offer(amt, "One class")] : []), ...(e.pass ? [offer(+e.pass.price.slice(1), `${e.pass.count}-class pass`)] : [])];
    return { ...(sched ? { eventSchedule: sched } : {}), ...(e.ends ? { endDate: e.ends } : {}), ...(e.price === "Free" ? { isAccessibleForFree: true } : {}), ...(offers.length ? { offers: offers.length === 1 ? offers[0] : offers } : e.price === "Free" ? { offers: offer(0) } : {}) }; }
  function jsonLd(base) { return filterEvents(base, { status: "upcoming" }).slice(0, 100).map((e) => { const m = String(e._start).match(/^(\d{1,2}):(\d{2})$/), amt = String(e.price || "").match(/^\$(\d+(?:\.\d{1,2})?) (?:a person|each)$/), hhmm = m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
    return { "@context": "https://schema.org", "@type": "Event", name: e.title, startDate: e.start ? e.start + (hhmm ? "T" + hhmm : "") : undefined, eventStatus: "https://schema.org/EventScheduled", eventAttendanceMode: e.format === "online" ? "https://schema.org/OnlineEventAttendanceMode" : "https://schema.org/OfflineEventAttendanceMode",
      location: e.format === "online" ? { "@type": "VirtualLocation", url: e.url } : { "@type": "Place", name: [e.area, e.city].filter(Boolean).join(", ") || "Shared with guests", address: { "@type": "PostalAddress", addressLocality: e.city || undefined } },
      organizer: { "@type": "Person", name: e.host.name, url: e.host.url }, url: e.url, ...(e.cover ? { image: e.cover } : {}),
      ...(e.repeat ? ldSeries(e, hhmm) : e.price === "Free" ? { isAccessibleForFree: true, offers: { "@type": "Offer", price: 0, priceCurrency: "USD", url: e.url } } : amt ? { offers: { "@type": "Offer", price: +amt[1], priceCurrency: "USD", url: e.url } } : {}) }; }); }
  // ---- "More like this" after kudos (kudos ask work) ----
  // Three upcoming events like the one a guest just sent kudos for: the same format in the same city first, then the same
  // format, then the same city. Other hosts lead (that's the second-host loop); the event itself is never in it.
  function similar(base, { eventId = "", format = "", activity = "", title = "", city = "", host = "", limit = 3 } = {}) {
    const D = data(base), me = D.events.find((e) => e.id === eventId), f = s(format || me?.format || (activity || title ? formatOf({ activity, title }) : ""), 24).toLowerCase(), c = s(city || me?.city, 60).toLowerCase(), h = s(host || me?.host?.handle, 30).toLowerCase();
    const L = filterEvents(base, { status: "upcoming" }).filter((e) => e.id !== eventId), inCity = (e) => !!c && `${e.city} ${e.area}`.toLowerCase().includes(c), fits = (e) => !!f && f !== "other" && e.format === f;
    const score = (e) => (fits(e) && inCity(e) ? 3 : fits(e) ? 2 : inCity(e) ? 1 : 0) * 2 + (e.host.handle !== h ? 1 : 0);
    return L.map((e) => ({ e, n: score(e) })).filter((x) => x.n >= 2).sort((a, b) => b.n - a.n || String(a.e.start).localeCompare(String(b.e.start))).slice(0, limit)
      .map(({ e }) => ({ id: e.id, title: e.title, start: e.start, time: e.time, city: e.city, area: e.area, format: e.format, price: e.price, host: e.host, url: e.url, cover: e.cover })); }
  // ---- end "More like this" ----
  // ---- find_hosts: hosts open to paid work for a city, kind of event, group size, date and budget ----
  // category: a booking category (food, dining, movement, workshop, drinks, culture), or any word their formats, tags
  // or packages use. A host with no priced package still shows (after those with one), with "quoted on request".
  function findHosts(base, q = {}) {
    const bad = findArgsError(q); if (bad) throw Object.assign(new Error(bad), { status: 400 });
    const verifiedOnly = truthy(q.verified_only), minReviews = Math.max(0, Math.round(+q.min_reviews || 0));
    const D = data(base), city = s(q.city, 60).toLowerCase(), cat = s(q.category, 40).toLowerCase(), catRe = Object.hasOwn(CATEGORY_WORDS, cat) ? CATEGORY_WORDS[cat] : null, n = Math.max(0, Math.min(5000, Math.round(+q.group_size || 0))), date = /^\d{4}-\d{2}-\d{2}$/.test(q.date || "") ? q.date : "", budget = Math.max(0, +String(q.budget ?? "").replace(/[^\d.]/g, "") || 0), ex = truthy(q.include_examples);
    const out = [];
    for (const H of D.hosts.values()) { const h = H.rec; if (!(H.sample ? !!H.h.forHire : h.for_hire)) continue; if (!ex && h.example) continue;
      if (city && !`${h.city} ${h.area}`.toLowerCase().includes(city)) continue;
      const verified = (H.reviewItems || []).filter((r) => r.verified).length;
      if (verifiedOnly && !verified) continue; if (minReviews && (h.reviews?.count || 0) < minReviews) continue;
      const blob = [...h.formats, ...h.tags, h.tagline, H.h.services || "", ...H.packages.map((p) => `${p.name} ${p.category}`)].join(" ").toLowerCase();
      // a category is its booking category or the words people use for it ("dining" is dinners, suppers, tastings, chef's tables)
      // the words are matched against what they offer (formats, services, packages), not a tagline
      const fits = (t) => !cat || t.includes(cat) || (catRe ? catRe.test(t) : false), offers = [...h.formats, H.h.services || "", ...H.packages.map((p) => `${p.name} ${p._x.desc || ""}`)].join(" ").toLowerCase();
      let P = H.packages.filter((p) => !cat || p.category === cat || fits(`${p.name} ${p._x.desc || ""}`.toLowerCase()));
      if (cat && !P.length && !blob.includes(cat) && !fits(offers)) continue;
      const why = [], pk = P.map((p) => { const fits = !n ? null : n >= p.min && (!p.max || n <= p.max); const est = p.per_person ? (p.flat ? p.per_person : n ? p.per_person * n : null) : null;
        let open = null; try { const O = H.ws ? C.openDatesOf(H.ws, p._x) : []; open = date ? (O.length ? O.includes(date) : null) : null; } catch {}
        return { id: p.id, name: p.name, price: p.price || "Quoted on request", min: p.min, max: p.max, category: p.category, estimate: est, fits_group: fits, within_budget: budget && est != null ? est <= budget : null, date_open: open }; });
      const best = pk.filter((p) => p.fits_group !== false && p.within_budget !== false && p.date_open !== false);
      if (P.length && !best.length) continue; // every package they have is too small, too big, over budget or booked that day
      if (n && h.group_size && best.length) why.push(`Takes groups of ${h.group_size.min}${h.group_size.max ? `–${h.group_size.max}` : "+"}`);
      if (budget && best.some((p) => p.within_budget)) why.push("Fits the budget");
      if (date && best.some((p) => p.date_open)) why.push(`Open on ${date}`);
      if (h.leaderboard) why.push(h.leaderboard.text); if (h.responds_in) why.push(`Usually replies ${h.responds_in}`); if (h.reviews.count) why.push(`${h.reviews.count} reviews`);
      const score = (best.length ? 10 : 0) + best.filter((p) => p.fits_group).length * 2 + best.filter((p) => p.within_budget).length * 2 + best.filter((p) => p.date_open).length * 3 + (h.leaderboard ? 6 - Math.min(5, h.leaderboard.rank) : 0) + Math.min(5, h.reviews.count / 2) + (h.responds_in_hours != null && h.responds_in_hours <= 24 ? 1 : 0);
      if (verified) why.push(`${verified} verified ${verified === 1 ? "review" : "reviews"}`);
      out.push({ score, host: h, packages: best, quoted_on_request: !H.packages.length, verified_reviews: verified, why: why.slice(0, 4) }); }
    out.sort((a, b) => b.score - a.score || a.host.name.localeCompare(b.host.name));
    const lim = limitOf(q.limit, 10);
    return { data: out.slice(0, lim).map(({ score, ...x }) => x), total: out.length, query: { city: s(q.city, 60), category: cat, group_size: n || null, date: date || null, budget: budget || null, verified_only: verifiedOnly, min_reviews: minReviews || null },
      book_url: `${base}/hosts/book${city ? `?city=${encodeURIComponent(s(q.city, 60))}` : ""}` }; }
  /** What a host actually does, as text: the formats and titles of their events, their services and packages (not the tagline). */
  function hostText(base, handle) { const D = data(base), H = D.hosts.get(String(handle || "").toLowerCase()); if (!H) return "";
    const ev = D.events.filter((e) => e.host.handle === H.rec.handle && !e._dup).slice(0, 40).map((e) => `${e.format} ${e.title} ${(e.tags || []).join(" ")}`);
    return [...H.rec.formats, ...ev, H.rec.bio || "", ...(H.rec.speaking_topics || []), H.h.services || "", ...(H.packages || []).map((p) => `${p.name} ${p.category} ${p._x?.desc || ""}`), ...(H.h.experiences || []).map((x) => `${x?.name || ""} ${x?.category || ""}`)].join(" ").slice(0, 8000); }
  return { searchEvents, getEvent, listHosts, getHost, formats, listReviews, csv, jsonLd, filterEvents, similar, findHosts, hostText };
}

// review 8: words people type for a host that the host's own text says differently
const TALK_RE = /\b(talks?|keynotes?|panels?|panelist|webinars?|podcasts?|speaking|speaker)\b/;
const HOST_WORDS = { speaker: TALK_RE, speakers: TALK_RE, talk: TALK_RE, talks: TALK_RE, speaking: TALK_RE, keynote: TALK_RE };
// review round 8: get_leaderboard's categories (server/leaderboard.js CATEGORIES) and the words people use for them
export const LB_CATS = ["all", "supper", "movement", "workshop", "popup", "talks", "community"];
const LB_ALIAS = { dining: "supper", dinner: "supper", dinners: "supper", suppers: "supper", "supper club": "supper", "supper clubs": "supper", food: "supper", brunch: "supper", drinks: "supper",
  run: "movement", runs: "movement", running: "movement", hike: "movement", hikes: "movement", hiking: "movement", fitness: "movement", sport: "movement", sports: "movement",
  workshops: "workshop", class: "workshop", classes: "workshop", craft: "workshop", crafts: "workshop", "pop-up": "popup", "pop-ups": "popup", popups: "popup", market: "popup",
  talk: "talks", speaking: "talks", speakers: "talks", speaker: "talks", keynote: "talks", keynotes: "talks", panel: "talks", panels: "talks",
  meetup: "community", meetups: "community", social: "community", party: "community", parties: "community", everything: "all", any: "all" };
/** A leaderboard category id for what a caller typed, or "" when it isn't one. */
export function leaderboardCategory(v) { const k = String(v ?? "").trim().toLowerCase(); return LB_CATS.includes(k) ? k : Object.hasOwn(LB_ALIAS, k) ? LB_ALIAS[k] : ""; }
// ---- find_hosts: what each booking category means in the words hosts use (their services, formats, packages) ----
export const CATEGORY_WORDS = {
  dining: /\b(dinners?|suppers?|tastings?|chefs?|tables?|omakase|feasts?|supper club)\b/i,
  movement: /\b(runs?|running|hikes?|hiking|yoga|dance|dancing|class(es)?|pilates|walks?|bike|cycling)\b/i,
  workshop: /\b(workshops?|class(es)?|pottery|ceramics?|crafts?|clay|wheel|masterclass)\b/i,
  drinks: /\b(coffee|caf[eé]|wine|cocktails?|matcha|tea|spritz|natural wine|happy hour)\b/i,
  food: /\b(pop-?ups?|bakes?|baking|bakery|cater(ing|s|ed)?|pastr(y|ies)|bread|desserts?)\b/i,
};
const posNum = (v) => { if (v == null || v === "") return true; const n = typeof v === "number" ? v : +String(v).replace(/[$,\s]/g, ""); return Number.isFinite(n) && n > 0; };
/** Why these find_hosts arguments can't be used, or "" when they can. */
/** A real calendar day as YYYY-MM-DD (2026-02-31 isn't one). */
export const realDate = (v) => { const t = String(v ?? ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return false; const d = new Date(t + "T00:00:00Z"); return !isNaN(d) && d.toISOString().slice(0, 10) === t; };
const BAD_KEYS = /^(__proto__|constructor|prototype)$/i;
/** Review round 10: every MCP argument checked against the tool's schema: text is text (not an object), a choice is one
 *  of its choices, dates are real days, limit is a whole number of 1 or more. "" means not given. */
export function mcpArgsError(props = {}, args = {}) {
  for (const [k, v] of Object.entries(args)) { const P = props[k]; if (!P || v == null || v === "") continue;
    if (P.type === "string") { if (typeof v !== "string" && typeof v !== "number") return `${k} must be text${k === "city" ? ", e.g. \"Brooklyn\"" : ""}.`;
      const t = String(v).trim(); if (["category", "format", "city", "host", "handle", "type", "status", "period"].includes(k) && BAD_KEYS.test(t)) return `Unknown ${k} "${t.slice(0, 40)}".`;
      if (P.enum && !P.enum.includes(t.toLowerCase())) return `${k} must be one of: ${P.enum.join(", ")}.`;
      if (["from", "to", "date"].includes(k) && !realDate(t)) return `${k} must be a date as YYYY-MM-DD, e.g. 2026-03-14.`; }
    if (P.type === "boolean" && typeof v !== "boolean" && !/^(true|false|1|0)$/i.test(String(v))) return `${k} must be true or false.`;
    if (P.type === "number") { const n = typeof v === "string" && v.trim() !== "" ? +v.replace(/[$,\s]/g, "") : v; if (typeof n !== "number" || !Number.isFinite(n)) return `${k} must be a number.`;
      if (k === "limit" && !(Number.isInteger(n) && n >= 1 && n <= MAX_LIMIT)) return `limit must be a whole number from 1 to ${MAX_LIMIT}.`; } } // review round 11: over 100 is an error, not a quiet clamp
  return ""; }
export function findArgsError(q = {}) {
  if (!posNum(q.group_size)) return "group_size must be a positive number of people, e.g. 20.";
  if (!posNum(q.budget)) return "budget must be a positive number of dollars, e.g. 2500.";
  if (q.min_reviews != null && q.min_reviews !== "" && !(Number.isFinite(+q.min_reviews) && +q.min_reviews >= 0)) return "min_reviews must be 0 or more.";
  if (q.date != null && q.date !== "" && !realDate(q.date)) return "date must be YYYY-MM-DD, e.g. 2026-03-14.";
  // review round 8: yes/no arguments are yes or no
  for (const k of ["verified_only", "include_examples"]) if (q[k] != null && q[k] !== "" && typeof q[k] !== "boolean" && !/^(true|false|1|0)$/i.test(String(q[k]))) return `${k} must be true or false.`;
  return ""; }
// common names for arguments, so an unknown one can be pointed at the right one
const ARG_ALIASES = { query: "q", search: "q", text: "q", keywords: "q", keyword: "q", people: "group_size", guests: "group_size", headcount: "group_size", size: "group_size", group: "group_size", attendees: "group_size", party_size: "group_size",
  location: "city", place: "city", where: "city", near: "city", kind: "category", type: "category", format: "category", max_budget: "budget", price: "budget", total_budget: "budget", when: "date", day: "date",
  verified: "verified_only", only_verified: "verified_only", reviews: "min_reviews", min_review_count: "min_reviews", examples: "include_examples", event: "event_id", id: "id", handle: "handle", host_handle: "handle" };
const editDist = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
/** The argument a tool takes that an unknown one most likely meant, or "". */
export function closestArg(name, known) { const k = String(name || "").toLowerCase(), a = ARG_ALIASES[k]; if (a && known.includes(a)) return a;
  let best = "", bd = 99; for (const x of known) { const dd = editDist(k, x); if (dd < bd) { bd = dd; best = x; } } return bd <= Math.max(2, Math.floor(k.length / 3)) ? best : ""; }

// ---- the public MCP server's tools (read-only) ----
const str = (description, extra = {}) => ({ type: "string", description, ...extra });
// formats the directory files events under (a host's scrapbook can add its own, so this is a list of examples, not a closed set)
export const FORMATS = ["dinner", "brunch", "run", "hike", "class", "workshop", "pop-up", "coffee", "picnic", "game night", "book club", "drinks", "movement", "party", "social", "meetup", "summit", "conference", "online", "tour", "launch", "offsite", "talk", "keynote", "webinar", "podcast", "panel"];
const EVENT_FILTERS = { q: str("Words to look for, any of them: events matching more of the words come first (title counts most, then tags, format, host and neighborhood). Filler words like the, near, me drop out. Date words in q become dates and drop out of the words: tonight and today (that day), tomorrow, this week (to Sunday), this weekend (Friday to Sunday), next weekend (the one after), in the event city's time zone. from and to, when you pass them, win. e.g. pottery class, dance this weekend, supper Brooklyn tomorrow"), city: str("City or neighborhood, e.g. Brooklyn"),
  format: str("One format. class = a class or course people sign up for (dance, salsa, bachata, improv, yoga, pilates, a language, music lessons); workshop = a hands-on one-off (pottery, the wheel, a masterclass). Others: dinner, brunch, run, hike, pop-up, coffee, picnic, drinks, party, meetup, summit, conference, online. talk matches every speaking engagement (talk, keynote, webinar, podcast, panel).", { examples: FORMATS }),
  type: str("speaking: only speaking engagements (talks, keynotes, webinars, podcasts, panels, workshops the host taught)", { enum: ["speaking"] }),
  status: str("upcoming (default), past or all", { enum: ["upcoming", "past", "all"] }), from: str("Earliest date, YYYY-MM-DD"), to: str("Latest date, YYYY-MM-DD"), host: str("A host's handle, e.g. atbo"),
  include_examples: { type: "boolean", description: "Also return sample events from example hosts (off by default)" }, limit: { type: "number", description: "1 to 100 (default 20); more is an error" }, cursor: str("next_cursor from the last page") };
const OBJ = { type: "object" }, PAGE_OUT = (extra = {}) => ({ type: "object", properties: { data: { type: "array", items: OBJ }, next_cursor: { type: ["string", "null"] }, total: { type: "integer" }, ...extra }, required: ["data", "next_cursor", "total"] });
const OUT = { search_events: PAGE_OUT(), get_event: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, when: { type: "string" }, price: { type: ["string", "null"] }, reviews: OBJ }, required: ["id", "title"] },
  list_hosts: PAGE_OUT(), find_hosts: { type: "object", properties: { data: { type: "array", items: OBJ }, total: { type: "integer" }, query: OBJ, book_url: { type: "string" } }, required: ["data", "total"] }, get_host: { type: "object", properties: { handle: { type: "string" }, name: { type: "string" }, events: { type: "array", items: OBJ }, reviews: OBJ }, required: ["handle", "name"] },
  list_formats: { type: "object", properties: { total: { type: "integer" }, types: OBJ, formats: { type: "array", items: OBJ }, cities: { type: "array", items: OBJ }, by_format_and_city: { type: "array", items: OBJ } }, required: ["total", "formats", "cities"] },
  get_reviews: PAGE_OUT({ top_tags: { type: "array", items: OBJ } }) };
export const PUBLIC_TOOLS = [
  { name: "search_events", description: "Search the Pottery Lab events directory: upcoming events hosts made public and past events from their scrapbooks, including speaking engagements (talks, keynotes, webinars, podcasts, panels) with a speaking object { role, topic, organizer, audience, recording, slides }. Use format talk or type speaking for those; a speaking search looks at past and upcoming (status all) unless you pass status. Date words in q become dates and drop out of the words: tonight and today (that day), tomorrow, this week (to Sunday), this weekend (Friday to Sunday), next weekend (the one after), in the event city's time zone. from and to, when you pass them, win. price is null when the host didn't set one (Free only when they said so). Returns { data, next_cursor, total }.", inputSchema: { type: "object", properties: EVENT_FILTERS }, annotations: { readOnlyHint: true } },
  { name: "get_event", description: "One event from the directory by id, with all its reviews.", inputSchema: { type: "object", properties: { id: str("Event id from search_events") }, required: ["id"] }, annotations: { readOnlyHint: true } },
  { name: "find_hosts", description: "Hosts open to paid work (for_hire) for a brand or team event: by city, kind of event, group size, and optionally a date and a total budget. Each result has the host record (group_size, responds_in, leaderboard, speaking_topics, reviews), the packages that fit with an estimate (price a person x group size, or the flat price), and why it fits. Hosts with no priced package show with quoted_on_request: true. Returns { data, total, query, book_url }.",
    inputSchema: { type: "object", properties: { city: str("City or neighborhood, e.g. Brooklyn"), category: str("food, dining, movement, workshop, drinks or culture, or any word their packages and formats use (e.g. pottery, run, talk)"), group_size: { type: "number", description: "How many people" },
      date: str("YYYY-MM-DD. Hosts who list open dates must have this one; hosts who don't list dates say on request"), budget: { type: "number", description: "Total budget in dollars" },
      verified_only: { type: "boolean", description: "Only hosts with at least one verified review (a guest who came, or replied I'm in)" }, min_reviews: { type: "number", description: "Only hosts with at least this many reviews" }, include_examples: { type: "boolean", description: "Also return example hosts (off by default)" }, limit: { type: "number", description: "Up to 100 (default 10)" } } }, annotations: { readOnlyHint: true } },
  { name: "list_hosts", description: "Hosts with a public page: name, city, what they host, event counts, a review summary, whether they're open to paid work (for_hire), group_size, responds_in, their best leaderboard rank and speaking_topics.", inputSchema: { type: "object", properties: { q: str("Words to match"), city: str("City or neighborhood"), limit: { type: "number", description: "Up to 100 (default 50)" }, cursor: str("next_cursor from the last page") } }, annotations: { readOnlyHint: true } },
  { name: "get_host", description: "One host's public profile, their events in the directory and recent reviews.", inputSchema: { type: "object", properties: { handle: str("The host's handle, e.g. atbo") }, required: ["handle"] }, annotations: { readOnlyHint: true } },
  { name: "list_formats", description: "Event counts by format and by city, for building filters.", inputSchema: { type: "object", properties: { status: str("upcoming, past or all (default)", { enum: ["upcoming", "past", "all"] }) } }, annotations: { readOnlyHint: true } },
  { name: "get_reviews", description: "Guests' reviews (kudos) for one event or for a host: first name, what they loved, the chips they tapped, the date, how we know they were a guest (verified: guest_list = came, on the guest list; rsvp = replied I'm in; null = neither), plus counts. No star ratings exist.", inputSchema: { type: "object", properties: { event_id: str("An event id"), host: str("A host's handle"), q: str("Words to match"), limit: { type: "number", description: "1 to 100 (default 20); more is an error" }, cursor: str("next_cursor from the last page") } }, annotations: { readOnlyHint: true } },
].map((t) => ({ ...t, outputSchema: OUT[t.name] }));

// ---- leaderboard (host awards work): the MCP tool for server/leaderboard.js, and formatOf shared with it ----
PUBLIC_TOOLS.push({ outputSchema: { type: "object", properties: { qualified: { type: "boolean" }, entries: { type: "array" } } }, name: "get_leaderboard", description: "Host leaderboards: who guests loved most in a city, per kind of event (supper, movement, workshop, popup, talks, community, or all), this month (last 30 days) or all time. Ranked by verified kudos, the share who'd go again (3+ kudos), different guests who came and a small capped bonus per event. Only real hosts; a board shows once 3 hosts are on it (qualified: false otherwise). Returns { data: { city, category, period, qualified, entries: [{ rank, host, score, why, badges, streak, movement }] }, boards, rules_url }.",
  inputSchema: { type: "object", properties: { city: str("A city, e.g. Brooklyn. Leave out for the city with the most going on"), category: str("all (default), supper, movement, workshop, popup, talks or community", { enum: ["all", "supper", "movement", "workshop", "popup", "talks", "community"] }), period: str("month (last 30 days, default) or all", { enum: ["month", "all"] }) } }, annotations: { readOnlyHint: true } });
// ---- end leaderboard ----

export function mountDirectory(app, { store, small, C, SB, PUBLIC_DIR, sendText, guestRedirect = "", publicOrigin }) {
  const Dir = makeDirectory({ store, C, SB, LB: () => app.locals.leaderboard });
  app.locals.directory = Dir;
  const base = (req) => String(publicOrigin(req) || "").replace(/\/+$/, "");
  // per IP, per hour, like the other public routes
  const hits = new Map();
  const overLimit = (req, bucket) => { const k = bucket + "|" + (req.ip || "?"), now = Date.now(); let h = hits.get(k); if (!h || now - h.start > 3600_000) { h = { n: 0, start: now }; hits.set(k, h); if (hits.size > 20000) hits.clear(); }
    return ++h.n > PER_HOUR() ? Math.ceil((h.start + 3600_000 - now) / 1000) : 0; };
  const open = (res) => res.set({ "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id", "Access-Control-Max-Age": "86400" });
  const api = (req, res, next) => { open(res); if (req.method === "OPTIONS") return res.status(204).end();
    const wait = overLimit(req, "api"); if (wait) { res.set("Retry-After", String(wait)); return res.status(429).json({ code: "rate_limited", message: `Too many requests. Try again in ${wait}s.` }); }
    res.set("Cache-Control", "public, max-age=60"); next(); };
  const notFound = (res, what) => res.status(404).json({ code: "not_found", message: `No ${what} by that id.` });
  app.options(/^\/api\/v1\//, api);
  // review round 11: each route checks its query against the matching MCP tool's schema (the same messages as MCP's -32602)
  const v1Check = (tool) => (req, res, next) => { const q = { ...req.query }; if (tool === "get_leaderboard" && q.category != null && q.category !== "" && typeof q.category === "string") { const c = leaderboardCategory(q.category); if (!c) return res.status(400).json({ code: "invalid", message: `Unknown category "${q.category.slice(0, 40)}". Use one of: ${LB_CATS.join(", ")}.` }); q.category = c; }
    const bad = mcpArgsError(PUBLIC_TOOLS.find((t) => t.name === tool)?.inputSchema?.properties || {}, q); if (bad) return res.status(400).json({ code: "invalid", message: bad }); next(); };
  app.get("/api/v1/events", api, v1Check("search_events"), (req, res) => res.json(Dir.searchEvents(base(req), req.query)));
  app.get("/api/v1/events.csv", api, v1Check("search_events"), (req, res) => res.type("text/csv; charset=utf-8").set("Content-Disposition", 'inline; filename="pottery-lab-events.csv"').send(Dir.csv(base(req), req.query)));
  app.get("/api/v1/events/:id", api, (req, res) => { const e = Dir.getEvent(base(req), req.params.id); return e ? res.json({ data: e }) : notFound(res, "event"); });
  app.get("/api/v1/hosts", api, v1Check("list_hosts"), (req, res) => res.json(Dir.listHosts(base(req), req.query)));
  app.get("/api/v1/hosts/find", api, v1Check("find_hosts"), (req, res) => { const bad = findArgsError(req.query); if (bad) return res.status(400).json({ code: "invalid", message: bad }); res.json(Dir.findHosts(base(req), req.query)); });
  app.get("/api/v1/hosts/:handle", api, (req, res) => { const h = Dir.getHost(base(req), req.params.handle); return h ? res.json({ data: h }) : res.status(404).json({ code: "not_found", message: "No host by that name." }); });
  app.get("/api/v1/formats", api, v1Check("list_formats"), (req, res) => res.json(Dir.formats(base(req), req.query)));
  app.get("/api/v1/reviews", api, v1Check("get_reviews"), (req, res) => res.json(Dir.listReviews(base(req), req.query)));
  // ---- leaderboard (host awards work): read from app.locals.leaderboard (server/leaderboard.js) ----
  const lb = () => app.locals.leaderboard;
  app.get("/api/v1/leaderboard", api, v1Check("get_leaderboard"), (req, res) => (lb() ? res.json(lb().board(req.query, base(req))) : res.status(404).json({ code: "not_found", message: "No leaderboard here." })));
  app.get("/api/v1/leaderboard/rules", api, (req, res) => (lb() ? res.json(lb().rules()) : res.status(404).json({ code: "not_found", message: "No leaderboard here." })));
  // ---- end leaderboard ----
  app.get("/api/v1/openapi.json", api, (req, res) => res.json(openapi(base(req))));
  app.get("/llms.txt", (req, res) => { open(res); res.set("Cache-Control", "public, max-age=300").type("text/plain; charset=utf-8").send(llms(base(req))); });

  // ---- the public MCP server: JSON-RPC 2.0 over HTTP POST (streamable HTTP, JSON responses, batches), read-only ----
  // a tool result: the JSON as text (for older clients) and as structuredContent (matching the tool's outputSchema)
  const text = (obj) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }], ...(obj && typeof obj === "object" ? { structuredContent: obj } : {}) });
  const run = {
    search_events: (a, b) => Dir.searchEvents(b, a),
    get_event: (a, b) => { const e = Dir.getEvent(b, a.id); if (!e) throw new Error("No event by that id. Use search_events to find one."); return e; },
    list_hosts: (a, b) => Dir.listHosts(b, a),
    get_host: (a, b) => { const h = Dir.getHost(b, a.handle); if (!h) throw new Error("No host by that handle. Use list_hosts to find one."); return h; },
    list_formats: (a, b) => Dir.formats(b, a),
    find_hosts: (a, b) => Dir.findHosts(b, a),
    get_reviews: (a, b) => { if (!a.event_id && !a.host) throw new Error("Pass event_id or host."); return Dir.listReviews(b, { ...a, event: a.event_id }); },
  };
  // ---- leaderboard (host awards work) ----
  run.get_leaderboard = (a, b) => { if (!app.locals.leaderboard) throw new Error("No leaderboard here."); return app.locals.leaderboard.board(a, b); };
  // ---- end leaderboard ----
  function handle(msg, b) {
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } };
    if (msg.id === undefined) return null; // notifications
    const reply = (result) => ({ jsonrpc: "2.0", id: msg.id ?? null, result }), fail = (code, message) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
    try {
      if (msg.method === "initialize") return reply({ protocolVersion: msg.params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "pottery-lab-directory", version: "1.0.0" },
        instructions: "Pottery Lab's public events directory, read-only. Start with search_events or list_formats. Places are a neighborhood or city only; exact addresses go to guests who are in. Reviews are guests' kudos; there are no star ratings. Don't invent events, prices or reviews." });
      if (msg.method === "ping") return reply({});
      if (msg.method === "tools/list") return reply({ tools: PUBLIC_TOOLS });
      if (msg.method === "tools/call") { const name = msg.params?.name, fn = Object.hasOwn(run, name) ? run[name] : null, args0 = msg.params?.arguments && typeof msg.params.arguments === "object" && !Array.isArray(msg.params.arguments) ? msg.params.arguments : {};
        if (!fn) return fail(-32602, `Unknown tool ${name}`);
        // ---- review round 8: arguments must be an object, booleans boolean (or "true"/"false"), a leaderboard category one we have ----
        { const A = msg.params?.arguments; if (A != null && (typeof A !== "object" || Array.isArray(A))) return fail(-32602, `${name}: arguments must be an object, e.g. {"city": "Brooklyn"}.`);
          const props = PUBLIC_TOOLS.find((t) => t.name === name)?.inputSchema?.properties || {};
          for (const [k, v] of Object.entries(A || {})) if (props[k]?.type === "boolean" && v != null) { if (v === "true") args0[k] = true; else if (v === "false") args0[k] = false; else if (typeof v !== "boolean") return fail(-32602, `${k} must be true or false.`); }
          if (name === "get_leaderboard" && args0.category != null && args0.category !== "") { const c = leaderboardCategory(args0.category); if (!c) return fail(-32602, `Unknown category "${String(args0.category).slice(0, 40)}". Use one of: ${LB_CATS.join(", ")}.`); args0.category = c; } }
        // ---- end review round 8 ----
        // arguments the tool doesn't take: query is q; anything else is an error that names the one it likely meant
        const known = Object.keys(PUBLIC_TOOLS.find((t) => t.name === name)?.inputSchema?.properties || {}), args = { ...args0 };
        if ("query" in args && !known.includes("query") && known.includes("q")) { if (args.q == null) args.q = args.query; delete args.query; }
        const extra = Object.keys(args).filter((k) => !known.includes(k));
        if (extra.length) { const k = extra[0], m = closestArg(k, known); return fail(-32602, `${name} has no argument "${k}".${m ? ` Did you mean "${m}"?` : ""} It takes: ${known.join(", ") || "no arguments"}.`); }
        { const bad = mcpArgsError(PUBLIC_TOOLS.find((t) => t.name === name)?.inputSchema?.properties || {}, args); if (bad) return fail(-32602, bad); }
        if (name === "find_hosts") { const bad = findArgsError(args); if (bad) return fail(-32602, bad); }
        try { return reply(text(fn(args, b))); } catch (e) { if (e?.code === "invalid_cursor") return fail(-32602, e.message); return reply({ ...text(String(e.message || e)), isError: true }); } }
      return fail(-32601, `Method not found: ${msg.method}`);
    } catch (e) { return fail(-32603, String(e.message || e)); }
  }
  app.options("/mcp/public", (req, res) => { open(res); res.status(204).end(); });
  app.get("/mcp/public", (req, res) => { open(res); res.set("Allow", "POST, OPTIONS").status(405).json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "POST JSON-RPC messages here. This server sends JSON responses, no event stream." } }); });
  app.post("/mcp/public", (req, res, next) => { open(res); const wait = overLimit(req, "mcp"); if (wait) { res.set("Retry-After", String(wait)); return res.status(429).json({ jsonrpc: "2.0", id: null, error: { code: -32029, message: `Too many requests. Try again in ${wait}s.` } }); } next(); },
    small, (err, req, res, next) => (err?.type === "entity.parse.failed" || err instanceof SyntaxError ? res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) : next(err)),
    (req, res) => { const b = base(req), body = req.body;
      // review round 11: a body that isn't JSON (text/plain, a form) is a JSON-RPC parse error, not a silent 202
      if (!req.is("application/json") || body == null || typeof body !== "object") return res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error: send a JSON-RPC message as application/json." } });
      if (Array.isArray(body)) { if (!body.length) return res.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Empty batch" } }); const out = body.slice(0, 100).map((m) => handle(m, b)).filter(Boolean); return out.length ? res.json(out) : res.status(202).end(); }
      const out = handle(body || {}, b); return out ? res.json(out) : res.status(202).end(); });

  // ---- the page ----
  const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  app.get("/events", async (req, res) => {
    let html; try { html = await (await import("node:fs/promises")).readFile(PUBLIC_DIR + "/events.html", "utf8"); } catch { return res.status(500).type("text/plain").send("Events page missing."); }
    const ld = JSON.stringify(Dir.jsonLd(base(req))).replace(/</g, "\\u003c");
    html = html.replace(/<head[^>]*>/i, (m) => m + guestRedirect).replace("</head>", `<link rel="canonical" href="${esc(base(req) + "/events")}"><script type="application/ld+json">${ld}</script></head>`);
    sendText(req, res, html);
  });
}

// ---- docs: OpenAPI and llms.txt ----
function openapi(base) {
  const q = (name, description, schema = { type: "string" }) => ({ name, in: "query", required: false, description, schema });
  const filters = [q("q", "Any of these words, best matches first (more words matched, then title, tags, format, host, neighborhood). Filler words (the, near, me…) drop out. Date words in q become dates and drop out of the words: tonight and today (that day), tomorrow, this week (to Sunday), this weekend (Friday to Sunday), next weekend (the one after), in the event city's time zone. from and to, when you pass them, win."), q("city", "City or neighborhood (contains, any case)"),
    q("format", "class (dance, salsa, bachata, improv, yoga, pilates, language, music lessons; courses and drop-ins), workshop (a hands-on one-off), dinner, run, pop-up, coffee, hike, party, summit, talk, keynote, webinar, podcast, panel… talk matches every speaking engagement", { type: "string", examples: FORMATS }),
    q("type", "speaking: only speaking engagements", { type: "string", enum: ["speaking"] }), q("status", "Which events. Default upcoming; all for a speaking search (type=speaking or a talk format)", { type: "string", enum: ["upcoming", "past", "all"], default: "upcoming" }), q("from", "Earliest date, YYYY-MM-DD", { type: "string", format: "date" }), q("to", "Latest date, YYYY-MM-DD", { type: "string", format: "date" }),
    q("host", "A host's handle"), q("include_examples", "Also include sample events from example hosts", { type: "boolean", default: false })];
  const page = [q("limit", "Page size, at most 100", { type: "integer", minimum: 1, maximum: 100, default: 20 }), q("cursor", "next_cursor from the previous page")];
  const ref = (n) => ({ $ref: "#/components/schemas/" + n });
  const json = (schema) => ({ "application/json": { schema } });
  const list = (item, extra = {}) => ({ type: "object", required: ["data", "next_cursor", "total"], properties: { data: { type: "array", items: ref(item) }, next_cursor: { type: ["string", "null"] }, total: { type: "integer" }, ...extra } });
  const ok = (schema, d = "OK") => ({ 200: { description: d, content: json(schema) }, 400: { description: "A bad parameter: code invalid (the message says which), or invalid_cursor (a cursor that isn't one of ours, or past the end of a list that changed; start again without it)", content: json(ref("Error")) }, 429: { description: "Too many requests from this IP this hour", content: json(ref("Error")) } });
  const nf = { 404: { description: "Not found", content: json(ref("Error")) } };
  const nstr = { type: ["string", "null"] };
  return { openapi: "3.1.0",
    info: { title: "Pottery Lab events directory", version: "1.0.0", description: "Read-only data on events hosts made public on Pottery Lab: upcoming events and past events from host scrapbooks, with guests' reviews. No auth. CORS open. Cached for 60 seconds. Rate limited per IP. Places are a neighborhood or city only. There are no star ratings; reviews are guests' kudos." },
    servers: [{ url: base }],
    paths: {
      "/api/v1/events": { get: { operationId: "searchEvents", summary: "Search events", parameters: [...filters, ...page], responses: ok(list("Event")) } },
      "/api/v1/events.csv": { get: { operationId: "eventsCsv", summary: "Events as CSV (same filters, up to 5000 rows)", parameters: filters, responses: { 200: { description: "CSV with a header row", content: { "text/csv": { schema: { type: "string" } } } } } } },
      "/api/v1/events/{id}": { get: { operationId: "getEvent", summary: "One event, with all its reviews", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { ...ok({ type: "object", properties: { data: ref("Event") } }), ...nf } } },
      "/api/v1/hosts": { get: { operationId: "listHosts", summary: "Hosts with a public page", parameters: [q("q", "Words to match"), q("city", "City or neighborhood"), q("include_examples", "Also include example hosts", { type: "boolean" }), ...page], responses: ok(list("Host")) } },
      "/api/v1/hosts/find": { get: { operationId: "findHosts", summary: "Hosts open to paid work for a city, kind of event, group size, date and budget (the find_hosts MCP tool)", parameters: [q("city", "City or neighborhood"), q("category", "food, dining, movement, workshop, drinks, culture, or any word their packages and formats use"), q("group_size", "How many people", { type: "integer", minimum: 1 }), q("date", "YYYY-MM-DD", { type: "string", format: "date" }), q("budget", "Total budget in dollars", { type: "number", exclusiveMinimum: 0 }), q("verified_only", "Only hosts with at least one verified review", { type: "boolean" }), q("min_reviews", "Only hosts with at least this many reviews", { type: "integer", minimum: 0 }), q("include_examples", "Also include example hosts", { type: "boolean" }), q("limit", "At most 100", { type: "integer", default: 10 })],
        responses: ok({ type: "object", properties: { data: { type: "array", items: { type: "object", properties: { host: ref("Host"), packages: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, price: { type: "string" }, min: { type: "integer" }, max: { type: ["integer", "null"] }, category: { type: "string" }, estimate: { type: ["number", "null"], description: "Price a person x group size, or the flat price; null with no price" }, fits_group: { type: ["boolean", "null"] }, within_budget: { type: ["boolean", "null"] }, date_open: { type: ["boolean", "null"], description: "null when the host doesn't list open dates" } } } }, quoted_on_request: { type: "boolean" }, why: { type: "array", items: { type: "string" } } } } }, total: { type: "integer" }, query: { type: "object" }, book_url: { type: "string" } } }) } },
      "/api/v1/hosts/{handle}": { get: { operationId: "getHost", summary: "One host, their events and recent reviews", parameters: [{ name: "handle", in: "path", required: true, schema: { type: "string" } }], responses: { ...ok({ type: "object", properties: { data: { allOf: [ref("Host"), { type: "object", properties: { events: { type: "array", items: ref("Event") }, reviews: ref("Reviews") } }] } } }), ...nf } } },
      "/api/v1/formats": { get: { operationId: "listFormats", summary: "Counts by format and city, for filters", parameters: [q("status", "Which events", { type: "string", enum: ["upcoming", "past", "all"], default: "all" })],
        responses: ok({ type: "object", properties: { total: { type: "integer" }, types: { type: "object", properties: { speaking: { type: "integer", description: "How many are speaking engagements" } } }, formats: { type: "array", items: { type: "object", properties: { format: { type: "string" }, count: { type: "integer" } } } }, cities: { type: "array", items: { type: "object", properties: { city: { type: "string" }, count: { type: "integer" } } } }, by_format_and_city: { type: "array", items: { type: "object", properties: { format: { type: "string" }, city: { type: "string" }, count: { type: "integer" } } } } } }) } },
      "/api/v1/reviews": { get: { operationId: "listReviews", summary: "Guests' reviews (kudos), newest first", parameters: [q("host", "A host's handle"), q("event", "An event id"), q("q", "Words to match"), ...page], responses: ok(list("ReviewEntry", { top_tags: { type: "array", items: ref("TagCount") } })) } },
      // ---- leaderboard (host awards work) ----
      "/api/v1/leaderboard": { get: { operationId: "getLeaderboard", summary: "A host leaderboard for one city, category and period", parameters: [q("city", "A city, e.g. Brooklyn; leave out for the city with the most going on"), q("category", "Kind of event", { type: "string", enum: ["all", "supper", "movement", "workshop", "popup", "talks", "community"], default: "all" }), q("period", "month is the last 30 days", { type: "string", enum: ["month", "all"], default: "month" })],
        responses: ok({ type: "object", properties: { data: ref("Leaderboard"), boards: { type: "array", items: { type: "object", properties: { city: { type: "string" }, category: { type: "string" }, category_label: { type: "string" }, period: { type: "string" }, hosts: { type: "integer" } } } }, rules_url: { type: "string" } } }) } },
      "/api/v1/leaderboard/rules": { get: { operationId: "leaderboardRules", summary: "How boards are scored, in numbers and plain words", responses: ok({ type: "object", properties: { formula: { type: "string" }, points: { type: "object" }, kudosWeight: { type: "object" }, minHosts: { type: "integer" }, text: { type: "array", items: { type: "string" } } } }) } },
      // ---- end leaderboard ----
      // ---- inspo (hooks work): the /ideas wall, from the same public data plus the ideas library ----
      "/api/public/inspo": { get: { operationId: "listInspo", summary: "Idea cards for /ideas: photos and flyers from public events and host scrapbooks, plus ideas to host. Nothing a public page doesn't already show.", parameters: [q("interests", "Comma-separated interest ids to rank by (supper, run, pottery, matcha, dance, improv, book, popup, market, hike, talks, workshop, wine, coffee, crafts, baking, games, movement, picnic)"), q("tag", "One interest id: only cards with it"), q("city", "City or neighborhood to rank by"), q("limit", "Page size, at most 60", { type: "integer", minimum: 1, maximum: 60, default: 24 }), q("cursor", "next_cursor from the previous page")],
        responses: ok({ type: "object", required: ["data", "next_cursor", "total"], properties: { data: { type: "array", items: ref("InspoItem") }, next_cursor: nstr, total: { type: "integer" } } }) } },
      "/api/v1/openapi.json": { get: { operationId: "openapi", summary: "This document", responses: { 200: { description: "OpenAPI 3.1", content: json({ type: "object" }) } } } },
    },
    components: { schemas: {
      Error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
      // ---- leaderboard (host awards work) ----
      Leaderboard: { type: "object", properties: { city: { type: "string" }, category: { type: "string" }, category_label: { type: "string" }, period: { type: "string", enum: ["month", "all"] }, from: { type: ["string", "null"], format: "date" }, to: { type: "string", format: "date" }, title: { type: "string" },
        qualified: { type: "boolean", description: "False until 3 hosts are on the board; entries is empty then" }, min_hosts: { type: "integer" }, hosts_on_board: { type: ["integer", "null"] }, url: { type: "string" }, note: { type: "string" },
        entries: { type: "array", items: { type: "object", properties: { rank: { type: "integer" }, host: { type: "object", properties: { handle: { type: "string" }, name: { type: "string" }, url: { type: "string" }, city: { type: "string" } } }, score: { type: "integer" }, why: { type: "string", description: "e.g. 12 kudos · 90% would go again · 34 guests" },
          badges: { type: "array", items: { type: "object", properties: { id: { type: "string" }, emoji: { type: "string" }, label: { type: "string" } } } }, streak: { type: "object", properties: { weeks: { type: "integer" }, months: { type: "integer" } } },
          movement: { type: "object", properties: { direction: { type: "string", enum: ["up", "down", "same", "new"] }, by: { type: "integer" } }, description: "Against the 30 days before (month) or the board as of 30 days ago (all)" },
          stats: { type: "object", properties: { kudos: { type: "integer" }, would_go_again_pct: { type: ["integer", "null"] }, guests: { type: "integer" }, events: { type: "integer" } } } } } } } },
      // ---- end leaderboard ----
      InspoItem: { type: "object", properties: { id: { type: "string" }, type: { type: "string", enum: ["photo", "flyer", "art", "idea"] }, title: { type: "string" }, line: { type: "string", description: "One line, e.g. Supper club · $45 a person · Sat, Dec 12" }, img: { type: "string", description: "Photo for photo cards" },
        look: { type: ["object", "null"], description: "Palette, effect, title font and reply button for flyer and idea cards" }, art: { type: ["object", "null"], description: "Illustrated cover kind and tone" }, host: { anyOf: [ref("HostRef"), { type: "null" }], description: "The host, for cards from a real event; null for ideas" },
        city: { type: "string" }, area: { type: "string" }, tags: { type: "array", items: { type: "string" } }, status: { type: "string", enum: ["upcoming", "past", "idea"] }, date: { type: "string" }, example: { type: "boolean", description: "From a sample or prepared page" },
        real: { type: ["object", "null"], properties: { url: { type: "string" } }, description: "The real event this came from" }, save: { type: "object", properties: { kind: { type: "string", enum: ["event", "idea"] }, ref: { type: "string" } } }, saves: { type: "integer", description: "How many accounts saved it" },
        hostThis: { type: "object", properties: { say: { type: "string" }, vibe: { type: "string" } } } } },
      TagCount: { type: "object", properties: { tag: { type: "string" }, label: { type: "string" }, count: { type: "integer" } } },
      // verified labels (kudos ask work)
      Review: { type: "object", properties: { name: { type: "string", description: "The guest's first name, or A guest" }, text: { type: "string", description: "What they loved" }, tags: { type: "array", items: { type: "string" } }, at: { type: "string", format: "date" },
        verified: { type: ["string", "null"], enum: ["guest_list", "rsvp", null], description: "How we know the reviewer was a guest: guest_list (replied I'm in and the host marked them as there), rsvp (replied I'm in), null (neither)" },
        verified_label: { type: "string", description: "The label the site shows: \"Came, on the guest list\", \"Replied I'm in\", or empty" } } },
      ReviewEntry: { allOf: [ref("Review"), { type: "object", properties: { event: { type: ["object", "null"], properties: { id: { type: "string" }, title: { type: "string" }, url: { type: "string" } } }, host: ref("HostRef"), example: { type: "boolean" } } }] },
      Reviews: { type: "object", required: ["count"], properties: { count: { type: "integer" }, would_go_again_pct: { type: ["integer", "null"], description: "Share of guests who said they'd go again; null under 3 reviews" }, top_tags: { type: "array", items: ref("TagCount") }, items: { type: "array", items: ref("Review"), description: "Up to 10 in lists, all on GET /api/v1/events/{id}" } } },
      HostRef: { type: "object", properties: { handle: { type: "string" }, name: { type: "string" }, url: { type: "string", format: "uri" } } },
      Event: { type: "object", required: ["id", "title", "status", "host", "url", "source", "example", "reviews"], properties: {
        id: { type: "string" }, title: { type: "string" }, status: { type: "string", enum: ["upcoming", "past"] }, start: { type: "string", description: "YYYY-MM-DD, or empty when the host hasn't set a date" }, time: { type: "string", description: "e.g. 7pm, or 7pm to 10pm" },
        city: { type: "string", description: "The event's city (never a country on its own)" }, area: { type: "string", description: "Neighborhood. Never a street address. Empty when the event is somewhere the host's neighborhood doesn't apply." }, format: { type: "string" }, tags: { type: "array", items: { type: "string" } },
        price: { ...nstr, description: "e.g. Free, $20 a person, Pay what you like, $12 each or from $3 each (a pre-order), $60 for 2 (a pair or group books together), $320 for all 8 (a course), $20 a class, or $70 for 4 (a class pass); null when unknown" },
        spots_left: { type: ["integer", "null"], description: "The public headcount minus who has replied I'm in (the headcount itself with no replies yet); null with no headcount, when the host hides who's going, or for a past event" },
        repeat: { type: "string", enum: ["", "weekly", "biweekly", "monthly"], description: "How it repeats; empty for a one-off" }, sessions: { type: ["integer", "null"], description: "How many sessions a course has; null if it isn't a course" },
        ends: { type: "string", description: "A course's last session, YYYY-MM-DD; empty otherwise" }, pass: { type: ["object", "null"], properties: { price: { type: "string", description: "e.g. $70" }, count: { type: "integer" } }, description: "A class pass: price for count classes" },
        when: { type: "string", description: "The series in words, e.g. 8 Wednesdays, Jan 6 to Feb 24 · 7pm; Every Tue · 7pm; First Sun of each month. Empty for a one-off" }, ask_to_join: { type: "boolean", description: "The host lets guests in" },
        spot_unit: { type: "string", enum: ["person", "group", "item"], description: "What spots_left counts: people, whole groups (a pair or group books together, see group_size) or a pre-order's items" },
        group_size: { type: ["integer", "null"], description: "How many people one booking is, for a price per pair or group; null otherwise" },
        order_by_date: { type: ["string", "null"], description: "A pre-order's last day to order, YYYY-MM-DD, or null" }, orders_open: { type: "boolean", description: "A pre-order still taking orders (its order-by day hasn't passed where the event is)" },
        preorder: { type: "boolean", description: "A pre-order (set only on one): guests order items for pickup" }, items: { type: "array", items: { type: "object", properties: { name: { type: "string" }, price: { type: "number", description: "Dollars; 0 when the host gave none" } } }, description: "A pre-order's items" }, order_by: { type: "string", description: "When a pre-order's orders close, as the host said it (e.g. Thursday), or empty" },
        host: ref("HostRef"), url: { type: "string", format: "uri", description: "The public invite (/e/:id) or the host page's scrapbook" }, source: { type: "string", enum: ["hosted", "scrapbook"] },
        original_link: { type: "string", description: "The original page for an imported event (Partiful, Luma, Eventbrite, a website)" }, companies: { type: "array", items: { type: "string" } }, cover: { type: "string" }, example: { type: "boolean" }, reviews: ref("Reviews"),
        speaking: { anyOf: [ref("Speaking"), { type: "null" }], description: "Set on a speaking engagement (talk, keynote, webinar, podcast, panel); null otherwise" } } },
      Speaking: { type: "object", description: "A talk, in the host's words. Nothing is filled in for them.", properties: { role: { type: "string", description: "e.g. Speaker, Keynote speaker, Panelist, Moderator, Guest, Host" }, topic: { type: "string" }, organizer: { type: "string", description: "The conference, company or show" },
        audience: { type: ["integer", "null"], description: "Audience size the host typed; null when they didn't" }, recording: { type: "string", description: "https link to the video or episode, or empty" }, slides: { type: "string", description: "https link to the slides, or empty" } } },
      Host: { type: "object", properties: { handle: { type: "string" }, name: { type: "string" }, url: { type: "string" }, city: { type: "string" }, area: { type: "string" }, tagline: { type: "string" }, bio: { type: "string" }, tags: { type: "array", items: { type: "string" } }, emoji: { type: "string" }, avatar: { type: "string" },
        prepared: { type: "boolean" }, example: { type: "boolean" }, upcoming_count: { type: "integer" }, past_count: { type: "integer" }, formats: { type: "array", items: { type: "string" } }, reviews: ref("Reviews"),
        for_hire: { type: "boolean", description: "Open to paid work from brands" }, group_size: { type: ["object", "null"], properties: { min: { type: "integer" }, max: { type: ["integer", "null"] } }, description: "Smallest and largest group across their packages; null with none" },
        responds_in: { type: ["string", "null"], description: "Typical first reply to a brand request, e.g. within 3 hours; null until they've answered one" }, responds_in_hours: { type: ["number", "null"] },
        leaderboard: { type: ["object", "null"], properties: { rank: { type: "integer" }, city: { type: "string" }, category: { type: "string" }, period: { type: "string", enum: ["month", "all"] }, place: { type: "string" }, text: { type: "string" }, url: { type: "string" } }, description: "Their best current board (this month first, else all time); null when they aren't on one" },
        speaking_topics: { type: "array", items: { type: "string" }, description: "Topics of talks they've given, in their words" } } },
    } } };
}

function llms(base) {
  return `# Pottery Lab events directory

> Events that hosts on Pottery Lab made public: supper clubs, run clubs, pottery and matcha workshops, pop-ups, summits, and the talks, podcasts and panels hosts spoke at. Upcoming events and past events from host scrapbooks, with guests' reviews. Read-only, free, no sign-in.

People browse it at ${base}/events. Agents and scripts can read the same data below.

## API

- ${base}/api/v1/events : search events. Filters: q (any of the words; events matching more of them come first; filler words like "near me" drop out; tonight, today, tomorrow, this week, this weekend and next weekend become dates in the event city's time zone and drop out of the words), city, format (format=talk matches every speaking engagement), type (type=speaking), status (upcoming, past, all; default upcoming, and all for a speaking search), from, to (YYYY-MM-DD; they win over date words), host (a handle), include_examples, limit (up to 100), cursor. Returns { data, next_cursor, total }.
- ${base}/api/v1/events/{id} : one event, with all its reviews.
- ${base}/api/v1/events.csv : the same filters as a spreadsheet (with when, repeat, sessions, pass_price and pass_count columns).
- ${base}/api/v1/hosts : hosts with a public page (q, city). ${base}/api/v1/hosts/{handle} : one host, their events and reviews. Each host has for_hire, group_size { min, max }, responds_in (typical first reply to a brand request, or null), leaderboard (their best current board, or null) and speaking_topics.
- ${base}/api/v1/hosts/find : hosts open to paid work (city, category, group_size, date, budget, verified_only, min_reviews), with the packages that fit and an estimate. Hosts with no priced package come after, quoted on request. category is food, dining, movement, workshop, drinks or culture (matched against what hosts list: dining is dinners, suppers, tastings, chefs and tables) or any word. verified_only=true keeps hosts with at least one verified review; min_reviews=N keeps hosts with N or more. group_size and budget are positive numbers; anything else is a 400.
- ${base}/api/v1/formats : counts by format and city.
- ${base}/api/v1/reviews : guests' reviews (host, event, q, limit, cursor).
- ${base}/api/v1/leaderboard : host leaderboards (city, category: all, supper, movement, workshop, popup, talks, community; period: month or all). ${base}/api/v1/leaderboard/rules : how they're scored.
- ${base}/api/public/inspo : idea cards for ${base}/ideas: photos and flyers from public events and host scrapbooks, plus ideas to host (interests, tag, city, limit, cursor).
- ${base}/api/v1/openapi.json : OpenAPI 3.1 for all of the above.

JSON, CORS open, cached for 60 seconds, rate limited per IP. Page through with next_cursor until it's null.
Each route checks its filters the way the matching MCP tool does (text is text, a choice is one of its choices, dates are real YYYY-MM-DD days, limit is a whole number, yes/no is true or false). A bad one is a 400 with { "code": "invalid", "message" } that says what to send.

## MCP

A public MCP server, no auth: ${base}/mcp/public (streamable HTTP, JSON responses).
Tools: search_events, get_event, list_hosts, find_hosts, get_host, list_formats, get_reviews, get_leaderboard.
Arguments are the ones each tool lists. query works as q; any other unknown argument is a JSON-RPC error (-32602) that names the one you likely meant. find_hosts takes verified_only and min_reviews too.

## Each event

id, title, status (upcoming or past), start (YYYY-MM-DD; for a class that repeats, the next one), time, city, area (neighborhood), format, tags, price ("Free" only when the host said so, "$20 a person", "Pay what you like", "$12 each", "from $3 each" (a pre-order whose items cost different amounts), "$60 for 2" (a pair or a group books together: the price is for all of them, not a person), "$320 for all 8", "$20 a class, or $70 for 4", "$20 a class, or $100 for all 6"; null when no price is set), spots_left (headcount minus who has replied, or null; for a pre-order, how many items are left to order), repeat (weekly, biweekly, monthly or empty), sessions (a course's length, or null), ends (a course's last date), pass ({ price, count } or null), when ("8 Wednesdays, Jan 6 to Feb 24 · 7pm", "Every Tue · 7pm", "First Sun of each month"; empty for a one-off), host { handle, name, url }, url (the public invite or the host's page), source (hosted or scrapbook), original_link (Partiful, Luma, Eventbrite), companies, cover, example, reviews { count, would_go_again_pct, top_tags, items }, speaking. Each review item: name, text, tags, at, verified, verified_label.
A pre-order also has preorder: true, items [{ name, price }] (what the host sells, price in dollars) and order_by (when orders close, as the host said it, e.g. "Thursday", or empty).

## Formats

class is a class or course people sign up for: dance, salsa, bachata, improv, yoga, pilates, a language, music lessons. workshop is a hands-on one-off, like a pottery or wheel night. social is a dance social or mixer and party is a party: a "Bachata social" is social, not class. Filter with format=class or format=workshop; /api/v1/formats has the counts.

## Classes and courses

A course (sessions set) is one record: start is the first session, ends the last, price the whole course ("$320 for all 8"). A class that repeats has repeat set and its price per class, with pass when there's a class pass. Say what "when" says; don't list dates it doesn't give.

## Speaking

Talks, keynotes, webinars, podcasts, panels and fireside chats from a host's scrapbook, and workshops they taught. Their format is talk, keynote, webinar, podcast or panel, and they carry speaking { role, topic, organizer (the conference, company or show), audience (a number the host typed, or null), recording, slides (https links or empty) }. Every other event has speaking: null. Filter with format=talk or type=speaking. Talks have no reviews yet: reviews.count is 0.

## Leaderboards

People see them at ${base}/leaderboard. Each board is one city, one kind of event and one period (month is the last 30 days). Hosts are ranked by what guests did: score = 3 x (kudos from guests on the guest list + 0.6 x kudos from guests who replied I'm in) + 20 x the share who'd go again (once there are 3 or more of those kudos) + 1 x each different guest who came + 2 x each event, counting at most 4. Example hosts and hosts who opted out are never ranked. A board shows once 3 hosts are on it; until then qualified is false and entries is empty. Each entry: rank, host, score, why, badges, streak, movement.

## Data rules

- Only what a public page already shows. Upcoming events are the ones Discover lists. Link-only, unlisted and past invites stay off it.
- Places are a neighborhood or city. Street addresses and meet points go to guests who are in, never here.
- No guest lists, guest counts, emails, phone numbers or pay links. A talk's audience is the size its speaker typed, nothing more.
- Reviews are guests' kudos: a first name, what they loved, the chips they tapped and the date. Only guests who replied to that event can leave one. There are no star ratings. "would_go_again_pct" is null under 3 reviews.
- Each review has "verified": "guest_list" (they replied I'm in and the host marked them as there; the site shows "Came, on the guest list"), "rsvp" (they replied I'm in; the site shows "Replied I'm in") or null. "verified_label" is that text. Don't claim more than the label says.
- Imported past events have no reviews unless guests left kudos here. Their count is 0.
- Hosts can keep their past events and reviews out of the directory.
- Sample events from example hosts are marked example: true and left out unless you pass include_examples.
- Don't invent events, prices, ratings or reviews from this data. Link to the event's url when you mention it.
`;
}
