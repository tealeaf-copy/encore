// The scrapbook ("Past events" on a host's page): every event a host has hosted, including ones from before Pottery Lab.
// Hosts drop links (Partiful, Luma, Eventbrite, Henly, or any website with an events page), a CSV, or add one by hand.
// Potto reads each page into draft cards first (title, date, neighborhood or city, cover, a short description, the
// original link); the host edits or removes any, then adds them.
//
// Reading a page: schema.org Event JSON-LD (every event on the page, so a company's past-events page gives many cards),
// then Partiful's page data, then Open Graph / meta tags, then the page title.
// Fetching any website safely: https only (http is upgraded), every address the name resolves to is checked against
// private, loopback, link-local and metadata ranges, at connect time and again on every redirect (at most 5), 8s for the
// whole read, 2 MB for a page, HTML only, and a per-host rate limit.
// Privacy: a street address or a private home never gets stored or shown; only the neighborhood or city. Attendance and
// quotes are never made up: imported events carry no headcount unless the host types one.
import crypto from "node:crypto";
import dns from "node:dns";
import net from "node:net";
import https from "node:https";
import { scopeStore, DEFAULT_WS } from "./workspaces.js";

const SITES = [/(^|\.)partiful\.com$/i, /(^|\.)lu\.ma$/i, /(^|\.)luma\.com$/i, /(^|\.)eventbrite\.[a-z.]{2,8}$/i, /(^|\.)henly\.app$/i];
const MAX_PAGE = 2_000_000, MAX_IMG = 6_000_000, MAX_ITEMS = 200, MAX_LINKS = 15, MAX_REDIRECTS = 5, TIMEOUT = 8000, MAX_DRAFTS = 60;
const clean = (s, n) => String(s ?? "").replace(/<[^>]*>/g, " ").replace(/[<>\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const decode = (s) => String(s ?? "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#x27;/gi, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
export const sourceOf = (host) => (/partiful/i.test(host) ? "Partiful" : /lu\.ma|luma\.com/i.test(host) ? "Luma" : /eventbrite/i.test(host) ? "Eventbrite" : /henly/i.test(host) ? "Henly" : host ? "Web" : "");
const SOURCES = ["Partiful", "Luma", "Eventbrite", "Henly", "CSV", "Web", ""];
const siteOf = (link) => { try { return new URL(link).hostname.replace(/^www\./, ""); } catch { return ""; } };
const isoDate = (v) => { const s = String(v || "").trim(); if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); const t = Date.parse(s); return isFinite(t) ? new Date(t).toISOString().slice(0, 10) : ""; };
// "2026-07-15T21:30:00Z" in America/New_York is the 15th; with no zone, the date as written
const localDate = (v, tz) => { const s = String(v || "").trim(); if (!tz || !/Z$|[+-]\d\d:?\d\d$/.test(s)) return isoDate(s); try { const t = new Date(s); if (!isFinite(t)) return isoDate(s); return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(t); } catch { return isoDate(s); } };
// companies that were in the room (a logo strip on the card): a name, and a web domain for its icon. Host-written, never guessed.
export function cleanLogos(L) { const out = [], seen = new Set();
  for (const x of (Array.isArray(L) ? L : []).slice(0, 60)) { const name = clean(typeof x === "string" ? x : x?.name, 40); if (!name || seen.has(name.toLowerCase())) continue; seen.add(name.toLowerCase());
    const d = String((typeof x === "object" && x?.domain) || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    out.push({ name, domain: /^(?=.{3,80}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d) ? d : "" }); if (out.length >= 40) break; }
  return out; }
const COVER_OK = (u) => /^\/_blob\/[A-Za-z0-9]{20}$/.test(u || "") || /^\/presets\/[a-z0-9-]{1,60}\.(jpg|webp|png|svg)$/.test(u || "");

/** Is this a link from one of the event platforms we know? (Any other https site can still be read; see safeUrl.) */
export function importable(u) { try { const x = new URL(String(u).trim()); return x.protocol === "https:" && SITES.some((re) => re.test(x.hostname)) ? x : null; } catch { return null; } }

// ---------- link safety ----------
/** Is this IP address one we must never connect to (private, loopback, link-local, metadata, multicast, reserved)? */
export function isPrivateIp(ip) {
  const s = String(ip || "").trim().replace(/^\[|\]$/g, "").toLowerCase();
  if (net.isIPv4(s)) { const [a, b] = s.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224; }
  if (net.isIPv6(s)) { if (s === "::" || s === "::1") return true;
    const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) || s.match(/^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/); if (m) return isPrivateIp(m[1]);
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(s)) { const [h1, h2] = s.split(":").slice(-2).map((x) => parseInt(x, 16)); return isPrivateIp(`${h1 >> 8}.${h1 & 255}.${h2 >> 8}.${h2 & 255}`); }
    return /^(fc|fd|fe[89ab]|ff)/.test(s) || /^fd00:ec2::254$/.test(s) || /^2001:db8/.test(s) || /^100::/.test(s); }
  return true; // not an IP at all: refuse
}
/** A link we're willing to read: https (http becomes https), a public host name, no credentials, the normal port. */
export function safeUrl(u) {
  let s = String(u || "").trim(); if (!s) return null; if (/^\/\//.test(s)) s = "https:" + s; else if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
  let x; try { x = new URL(s); } catch { return null; }
  if (x.protocol === "http:") { x = new URL(x.href.replace(/^http:/i, "https:")); if (x.port === "80") x.port = ""; }
  if (x.protocol !== "https:" || x.username || x.password || (x.port && x.port !== "443")) return null;
  const h = x.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h || /^(localhost|metadata(\.google\.internal)?)$/.test(h) || /\.(local|localhost|internal|lan|home|corp|intranet|arpa)$/.test(h)) return null;
  if (net.isIP(h)) return isPrivateIp(h) ? null : x;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(h) || /^\d+$/.test(h.split(".").pop())) return null; // a real dotted name; no "0x7f.1" tricks
  x.hash = ""; return x;
}
/** Every link in a block of text: pasted lists, a dictated message, links mixed in with words. */
export function extractLinks(text, max = MAX_LINKS) {
  const out = [], seen = new Set(), T = String(text || "").slice(0, 20000);
  const re = /\b(?:https?:\/\/[^\s<>"'`]+|www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s<>"'`]*|(?:partiful\.com|lu\.ma|luma\.com|eventbrite\.[a-z.]{2,8}|henly\.app)\/[^\s<>"'`]+)/gi;
  for (const m of T.matchAll(re)) { let raw = m[0].replace(/[.,;:!?)\]}'"»”’]+$/, ""); if ((raw.match(/\(/g) || []).length > (raw.match(/\)/g) || []).length && m[0].endsWith(")")) raw += ")";
    const x = safeUrl(raw); if (!x) continue; const k = x.href.replace(/\/$/, ""); if (seen.has(k)) continue; seen.add(k); out.push(x.href); if (out.length >= max) break; }
  return out;
}
// DNS that refuses private addresses: used for the actual connection, so a name can't switch to a private address after we checked it
export function guardedLookup(resolve = dns.lookup) {
  return (hostname, options, cb) => { if (typeof options === "function") { cb = options; options = {}; } const o = typeof options === "number" ? { family: options } : options || {};
    resolve(hostname, { ...o, all: true }, (err, addrs) => { if (err) return cb(err); const L = (Array.isArray(addrs) ? addrs : [{ address: addrs, family: net.isIP(addrs) }]).filter(Boolean);
      if (!L.length || L.some((a) => isPrivateIp(a.address))) { const e = new Error("That address isn't public."); e.code = "EPRIVATE"; return cb(e); }
      return o.all ? cb(null, L) : cb(null, L[0].address, L[0].family); }); };
}
// one GET, no redirects followed, body streamed back; the connection only goes to a checked public address
function httpsGet(x, { signal, accept, lookup }) {
  return new Promise((resolve, reject) => {
    const req = https.request(x, { method: "GET", lookup, signal, headers: { "user-agent": "PotteryLabBot/1.0 (+past events import)", accept, "accept-language": "en-US,en;q=0.8" } }, (res) => resolve({ status: res.statusCode || 0, headers: res.headers, body: res }));
    req.on("error", reject); req.end(); });
}
/**
 * Read a public https page or image: checks the address on every hop, follows at most 5 redirects, gives up after 8s,
 * stops past `limit` bytes, and only accepts the content types asked for. Returns { buf, type, finalUrl } or null.
 * `get` and `lookup` can be swapped in tests.
 */
export async function safeFetch(url, { limit = MAX_PAGE, kind = "html", timeout = TIMEOUT, get = httpsGet, lookup = guardedLookup() } = {}) {
  let x = safeUrl(url); if (!x) return null;
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout), accept = kind === "image" ? "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8" : "text/html,application/xhtml+xml;q=0.9";
  const typeOk = (ty) => (kind === "image" ? /^image\/(png|jpe?g|webp|gif)\b/i : /^(text\/html|application\/xhtml\+xml)\b/i).test(ty || "");
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const r = await get(x, { signal: ctl.signal, accept, lookup });
      if (r.status >= 300 && r.status < 400 && r.headers?.location) { r.body?.destroy?.(); let next; try { next = safeUrl(new URL(String(r.headers.location), x).href); } catch { next = null; } if (!next) return null; x = next; continue; }
      if (r.status < 200 || r.status >= 300) { r.body?.destroy?.(); return null; }
      const type = String(r.headers?.["content-type"] || ""); if (!typeOk(type)) { r.body?.destroy?.(); return null; }
      if (+r.headers?.["content-length"] > limit) { r.body?.destroy?.(); return null; }
      const chunks = []; let n = 0;
      for await (const c of r.body) { n += c.length; if (n > limit) { r.body?.destroy?.(); return null; } chunks.push(Buffer.from(c)); }
      return { buf: Buffer.concat(chunks), type, finalUrl: x.href };
    }
    return null; // too many redirects
  } catch { return null; } finally { clearTimeout(t); }
}

// ---------- privacy: neighborhood or city, never a street address or a home ----------
const HOME = /\b(apt|apartment|apts|unit|suite|ste|flat|floor|fl|loft|residence|condo|house|home|my place|our place|place of|basement|backyard|rooftop of)\b|#\s*\d|\b\d+(st|nd|rd|th)\s+floor\b/i;
const STREET = /\b\d{1,6}[a-z]?\s+(?:[nsew]\.?\s+)?(?:[a-z0-9.'-]+\s+){0,4}(?:st|street|ave|avenue|av|rd|road|blvd|boulevard|dr|drive|ln|lane|pl|pkwy|parkway|ter|terrace|hwy|highway|broadway)\b\.?/i;
const CORNER = /\b\d+(st|nd|rd|th)\s+(and|&)\s+\d+(st|nd|rd|th)\b/i;
/** A place line that's safe to show: drops street addresses, apartments and homes, ZIP codes; keeps venue, neighborhood, city. */
export function safePlace(s) {
  const parts = String(s || "").split(/[,\n·|]+/).map((p) => clean(p, 80).replace(/\b\d{5}(-\d{4})?\b/g, "").trim()).filter(Boolean);
  const kept = parts.filter((p) => !HOME.test(p) && !STREET.test(p) && !CORNER.test(p) && !/^\d/.test(p) && !/^(usa|us|united states)$/i.test(p));
  const out = []; for (const p of kept) if (!out.some((q) => q.toLowerCase() === p.toLowerCase())) out.push(p);
  // a lone two-letter state after the city reads fine ("Brooklyn, NY"); on its own it's not a place
  return out.length === 1 && /^[A-Z]{2}$/.test(out[0]) ? "" : out.slice(0, 3).join(", ").slice(0, 120);
}
/** Takes street addresses and apartment numbers out of a description. */
export function scrubAddress(s) {
  return String(s || "").split(/\n/).filter((line) => !/📍|\baddress\s*:/i.test(line) || !(STREET.test(line) || HOME.test(line)))
    .join("\n").replace(new RegExp(STREET.source + "(?:[ ,]+(?:apt|apartment|unit|suite|ste|#)\\.?\\s*#?\\s*[a-z0-9-]+)?(?:,?\\s*[a-z .]+,?\\s*[A-Z]{2}\\s*\\d{5})?", "gi"), "")
    .replace(/\b(?:apt|apartment|unit|suite)\.?\s*#?\s*\d+[a-z]?\b/gi, "").replace(/#\s*\d+[a-z]?\b/gi, "").replace(/[ \t]+([,.;])/g, "$1").replace(/\(\s*\)/g, "");
}
const placeFromLd = (loc) => {
  if (!loc) return ""; if (Array.isArray(loc)) return placeFromLd(loc[0]); if (typeof loc === "string") return safePlace(decode(loc));
  if (/Virtual/i.test(String(loc["@type"] || ""))) return "Online";
  const a = loc.address, area = typeof a === "string" ? safePlace(decode(a)) : [a?.addressLocality, a?.addressRegion].filter(Boolean).join(", ");
  const name = safePlace(decode(loc.name || "")); return safePlace([name, area].filter(Boolean).join(", "));
};
// sentences that say the event was at someone's home go too ("a pop-up at our apartment")
const dropHomeLines = (t) => t.split(/(?<=[.!?])\s+|\n+/).filter((x) => !/\b(apt|apartment|our place|my place|my home|our home)\b/i.test(x)).join(" ");
const shortAbout = (s, n = 320) => { const t = clean(dropHomeLines(scrubAddress(decode(s))), 2000); if (t.length <= n) return t; const cut = t.slice(0, n), end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? ")); return (end > n * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…").trim(); };
const SITE_SUFFIX = /\s*[|·–—-]\s*(Partiful|Luma|Eventbrite|Henly|Meetup|Posh|Facebook)\s*$/i;
const titleOf = (s) => clean(decode(s).replace(SITE_SUFFIX, ""), 140);

// ---------- reading a page ----------
function ldEvents(html) {
  const out = [];
  const walk = (o, depth = 0) => { if (!o || depth > 8) return; if (Array.isArray(o)) { for (const v of o) walk(v, depth + 1); return; } if (typeof o !== "object") return;
    const ty = [].concat(o["@type"] || []).join(" ");
    if (/Event\b/i.test(ty) && !/EventSeries|EventReservation/i.test(ty) && o.name) out.push(o);
    for (const k of ["@graph", "itemListElement", "item", "subEvent", "subEvents", "event", "events", "mainEntity", "hasPart", "workFeatured"]) if (o[k]) walk(o[k], depth + 1); };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) { try { walk(JSON.parse(m[1].trim())); } catch {} }
  return out;
}
function partifulData(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i); if (!m) return null;
  try { const e = JSON.parse(m[1])?.props?.pageProps?.event; if (!e?.title) return null; const L = e.locationInfo || {}, city = String(L.mapsInfo?.approximateLocation || "").split(",")[0].replace(/^Nueva York$/i, "New York").trim();
    return { title: titleOf(e.title), date: localDate(e.startDate, e.timezone), place: safePlace([L.neighborhood, city].filter(Boolean).join(", ")) || (L.type === "virtual" ? "Online" : ""), about: shortAbout(e.description || ""), image: e.image?.url || "" };
  } catch { return null; }
}
/** Every event a page describes: schema.org events first, then Partiful's page data, then Open Graph, then the title. */
export function parseEvents(html, url = "") {
  html = String(html || "");
  const meta = (p) => { const m = html.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${p}["'][^>]*content=["']([^"']*)["']`, "i")) || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name|itemprop)=["']${p}["']`, "i")); return m ? decode(m[1]) : ""; };
  const ogImage = meta("og:image") || meta("og:image:secure_url") || meta("twitter:image"), base = (() => { try { return new URL(url); } catch { return null; } })();
  const abs = (u) => { if (!u) return ""; try { return new URL(String(u), base || undefined).href; } catch { return ""; } };
  const pf = /partiful\.com$/i.test(base?.hostname || "") || /__NEXT_DATA__/.test(html) && /partiful/i.test(html.slice(0, 5000)) ? partifulData(html) : null;
  const L = ldEvents(html), seen = new Set(), out = [];
  for (const e of L) { const img = Array.isArray(e.image) ? e.image[0] : typeof e.image === "object" ? e.image?.url || e.image?.contentUrl : e.image;
    const link = abs(typeof e.url === "string" ? e.url : "") || url, title = titleOf(e.name), date = localDate(e.startDate, ""), k = `${title.toLowerCase()}|${date}`; if (!title || seen.has(k)) continue; seen.add(k);
    out.push({ title, date, place: placeFromLd(e.location), about: shortAbout(e.description || ""), image: abs(img) || (L.length === 1 ? abs(ogImage) : ""), url: L.length === 1 ? url : link }); }
  if (pf) { if (out.length === 1) Object.assign(out[0], { title: pf.title || out[0].title, date: pf.date || out[0].date, place: pf.place, about: pf.about || out[0].about, image: abs(ogImage) || pf.image || out[0].image }); else if (!out.length) out.push({ ...pf, image: abs(ogImage) || pf.image, url }); }
  if (!out.length) { const title = titleOf(meta("og:title") || meta("twitter:title") || (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]);
    if (title) out.push({ title, date: isoDate(meta("event:start_time") || meta("og:event:start_time") || meta("startDate") || meta("event:start_date")), place: safePlace(meta("event:location") || meta("og:locality")), about: shortAbout(meta("og:description") || meta("description") || meta("twitter:description")), image: abs(ogImage), url }); }
  return out.slice(0, MAX_DRAFTS);
}
/** The one event a page is about (kept for callers that read a single event). */
export function parseEventPage(html, url = "") { return parseEvents(html, url)[0] || { title: "", date: "", place: "", about: "", image: "", url }; }

// ---------- featured events and named sections ----------
// A host can feature up to 6 events (in their order) and group the rest into up to 8 named sections, by what they were
// for. A "program" section is one card with a dated timeline (a company's year of coffees, dinners and workshops).
// Role, room ("who was there") and proof are host-written lines; nothing here fills them in, least of all with numbers.
export const MAX_FEATURED = 6, MAX_SECTIONS = 8;
export const ROLES = ["Organized", "Produced", "Hosted", "Co-hosted", "Lead host"];
export const FORMATS = ["dinner", "summit", "conference", "meetup", "workshop", "online", "booth", "coffee", "breakfast", "lunch", "happy hour", "panel", "offsite", "party", "tour", "class", "launch", "roadshow"];
export const LIMITS = { role: 40, room: 120, proof: 140, format: 24, company: 60, name: 60, blurb: 140 };
const SEC_ID = /^[a-z0-9-]{1,24}$/;
const cleanFormat = (v) => clean(v, LIMITS.format).toLowerCase();
const cleanLine = (v, n) => clean(scrubAddress(v), n);
/** Sections as stored: [{ id, name, blurb, kind: "list" | "program", order }], at most 8, in order. */
export function cleanScrapSections(L) {
  const out = [], seen = new Set();
  for (const x of (Array.isArray(L) ? L : []).slice(0, 50)) { if (out.length >= MAX_SECTIONS) break; const name = clean(x?.name, LIMITS.name); if (!name) continue;
    let id = SEC_ID.test(String(x?.id || "")) ? String(x.id) : ""; if (!id || seen.has(id)) id = crypto.randomBytes(4).toString("hex"); seen.add(id);
    out.push({ id, name, blurb: clean(x?.blurb, LIMITS.blurb), kind: x?.kind === "program" ? "program" : "list", order: isFinite(+x?.order) ? +x.order : out.length }); }
  return out.map((x, i) => ({ ...x, i })).sort((a, b) => a.order - b.order || a.i - b.i).map(({ i, ...x }, n) => ({ ...x, order: n }));
}
/** A prepared page's scrapbook as a claimed page starts with it: its items (with their sections and featured order) and its sections. */
export function presetToScrapbook(P) { const sections = cleanScrapSections(P?.scrapSections || (Array.isArray(P?.sections) ? P.sections : [])), ids = new Set(sections.map((s) => s.id));
  return { sections, items: (P?.scrapbook || []).map((x) => ({ ...x, section: ids.has(x.section) ? x.section : "" })) }; }

// what a past event was, guessed from its words (for suggestions only; never stored unless the host keeps it)
export function guessFormat(x) { if (x?.format) return x.format; const t = `${x?.title || ""} ${x?.about || ""}`.toLowerCase(), place = String(x?.place || "");
  if (/^online$/i.test(place) || /\b(webinar|virtual|online|livestream|zoom)\b/.test(t)) return "online";
  for (const [f, re] of [["summit", /\bsummit\b/], ["conference", /\bconference|\bconf\b|user group|\bforum\b/], ["booth", /\bbooth\b/], ["roadshow", /roadshow/], ["workshop", /workshop|masterclass|hands-on/], ["dinner", /dinner|supper|omakase/], ["breakfast", /breakfast|brunch/], ["lunch", /\blunch/], ["coffee", /coffee|matcha|cafe\b/], ["happy hour", /happy hour|drinks|mixer/], ["meetup", /meetup|meet-up|community|club\b/], ["panel", /\bpanel\b|fireside/], ["offsite", /offsite|retreat/], ["party", /party|celebration/], ["launch", /\blaunch\b/]]) if (re.test(t)) return f;
  return ""; }
const NOT_COMPANY = new Set("the a an and or of for with at in on to by from our my your this that x vs exec execs executive executives customer customers community partner partners annual spring summer fall autumn winter night day morning evening happy hour dinner dinners supper coffee breakfast lunch brunch summit conference meetup workshop online webinar booth panel party launch roundtable session series club social mixer kickoff field program q1 q2 q3 q4 nyc sf la new york san francisco brooklyn chicago boston austin seattle london toronto denver miami atlanta dallas jan feb mar apr may jun jul aug sep sept oct nov dec january february march april june july august september october november december cmo cfo cio cto ciso vp leaders founders".split(" "));
const companyWords = (x) => [...new Set((String(x?.title || "").match(/\b[A-Z][A-Za-z0-9&.'-]{1,30}\b/g) || []).map((w) => w.replace(/['’]s$/, "")).filter((w) => !NOT_COMPANY.has(w.toLowerCase())))];
/**
 * Potto's "Sort my events": sections by goal for the events that aren't in one yet. Suggestions only; the host confirms.
 * Field programs (3+ events for one company in one year) come first, then online, customer events, dinners, partner and community.
 * Returns [{ id, name, blurb, kind, items: [ids] }] in the order a page would show them, and a format guess per event that has none.
 */
export function suggestSections(items, existing = []) {
  const have = new Set((existing || []).map((s) => s.id)), pool = (items || []).filter((x) => x.id && !(x.section && have.has(x.section))), taken = new Set(), formats = {};
  for (const x of pool) if (!x.format) { const g = guessFormat(x); if (g) formats[x.id] = g; }
  const fmt = (x) => x.format || formats[x.id] || "", text = (x) => `${x.title || ""} ${x.about || ""} ${x.room || ""} ${x.company || ""}`;
  const programs = [];
  // a company named on the event, or a name that recurs in titles across different kinds of events in one year
  for (let round = 0; round < 2; round++) { const G = new Map();
    for (const x of pool) { if (taken.has(x.id) || !x.date) continue; const y = x.date.slice(0, 4), keys = round === 0 ? (x.company ? [x.company.trim()] : []) : companyWords(x);
      for (const k of keys) { const g = `${k.toLowerCase()}|${y}`; if (!G.has(g)) G.set(g, { name: k, year: y, L: [] }); G.get(g).L.push(x); } }
    for (const g of [...G.values()].sort((a, b) => b.L.length - a.L.length)) { const L = g.L.filter((x) => !taken.has(x.id)); if (L.length < 3) continue;
      if (round === 1 && new Set(L.map(fmt).filter(Boolean)).size < 2) continue; // five dinners in one city aren't a program
      L.forEach((x) => taken.add(x.id)); programs.push({ name: `${g.name}, ${g.year}`, blurb: "", kind: "program", items: L.sort((a, b) => String(a.date).localeCompare(String(b.date))).map((x) => x.id) }); } }
  const EXEC = /\b(exec|execs|executive|executives|cxo|c-suite|leaders|leadership|cmo|cfo|cio|cto|ciso|cro|vps?|founders|chief)\b/i;
  const RULES = [
    ["online", "Online", (x) => fmt(x) === "online" || /^online$/i.test(x.place || "")],
    ["customer", "Customer events", (x) => ["summit", "conference", "booth", "roadshow"].includes(fmt(x)) || /\b(customer|customers|user group|roadshow|advisory board|cab)\b/i.test(text(x))],
    ["dinners", "Executive dinners", (x) => ["dinner", "breakfast", "lunch"].includes(fmt(x)) || /\b(dinner|supper)\b/i.test(x.title || "")],
    ["community", "Partner and community", (x) => ["meetup", "happy hour", "party", "panel", "coffee"].includes(fmt(x)) || /\b(meetup|community|partner|partners|mixer|happy hour|club)\b/i.test(text(x))],
  ], found = {};
  for (const [k, name, test] of RULES) { const L = pool.filter((x) => !taken.has(x.id) && test(x)); if (!L.length) continue; L.forEach((x) => taken.add(x.id)); found[k] = { name, L }; }
  if (found.dinners && !found.dinners.L.some((x) => EXEC.test(text(x)))) found.dinners.name = "Dinners";
  const list = (k) => (found[k] ? [{ name: found[k].name, blurb: "", kind: "list", items: found[k].L.map((x) => x.id) }] : []);
  // a section the host already has by that name takes the events; new ones fill the free slots (8 in all)
  let room = Math.max(0, MAX_SECTIONS - (existing || []).length); const out = [];
  for (const s of [...list("customer"), ...list("dinners"), ...programs, ...list("community"), ...list("online")]) { const same = (existing || []).find((e) => e.name.toLowerCase() === s.name.toLowerCase());
    if (same) out.push({ ...s, id: same.id, kind: same.kind, existing: true }); else if (room > 0) { room--; out.push({ id: "s" + crypto.randomBytes(3).toString("hex") + out.length, ...s }); } }
  return { sections: out, formats };
}

// ---------- routes ----------
// the reader the routes use; tests swap in saved pages so they never touch the network
let fetcher = safeFetch;
export function useFetcher(f) { fetcher = f || safeFetch; }
export function mountScrapbook(app, { store, small, currentUser, C, saveImage }) {
  const S = (ws) => scopeStore(store, ws);
  const me = (req, res) => { const u = currentUser(req); if (!u || !u.ws || u.ws === DEFAULT_WS) { res.status(401).json({ code: "unauthenticated", message: "Sign in first." }); return null; } return u; };
  // links read per host: 60 an hour
  const reads = new Map(), overLimit = (ws, n) => { const now = Date.now(), L = (reads.get(ws) || []).filter((t) => now - t < 3600_000); if (L.length + n > 60) { reads.set(ws, L); return true; } for (let i = 0; i < n; i++) L.push(now); reads.set(ws, L); return false; };
  // a claimed prepared page starts with the prepared page's past events, once (removing one later sticks)
  const seed = (ws) => { try { if (S(ws).get("scrapbookmeta/seed")) return; const h = C.profileOf?.(ws); if (!h?.handle || !C.showcasePreset) return;
      const P = C.showcasePreset(h.handle) || (/^(.+)-[a-z0-9]{3}$/.test(h.handle) ? C.showcasePreset(h.handle.replace(/-[a-z0-9]{3}$/, "")) : null); if (!P?.scrapbook?.length) return;
      S(ws).set("scrapbookmeta/seed", { from: P.handle, at: Date.now() }); const B = presetToScrapbook(P); if (B.sections.length) setSections(ws, B.sections);
      let fo = 0; for (const x of [...B.items].sort((a, b) => (a.featuredOrder || 0) - (b.featuredOrder || 0))) save(ws, { ...x, id: "", photos: [], at: Date.now(), featured: !!x.featured && fo < MAX_FEATURED, featuredOrder: x.featured && fo < MAX_FEATURED ? ++fo : 0 }); } catch {} };
  const sectionsOf = (ws) => cleanScrapSections(S(ws).get("scrapbookmeta/sections")?.data?.list || []);
  const setSections = (ws, L) => { const list = cleanScrapSections(L); S(ws).set("scrapbookmeta/sections", { list, at: Date.now() }); return list; };
  const featuredIds = (L) => L.filter((x) => x.featured).sort((a, b) => (a.featuredOrder || 0) - (b.featuredOrder || 0)).map((x) => x.id);
  const list = (ws) => { seed(ws); return S(ws).list("scrapbook").map((d) => ({ id: String(d.id).split("/").pop(), ...d.data })).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || (b.at || 0) - (a.at || 0)); };
  const save = (ws, item) => { const id = item.id || crypto.randomBytes(6).toString("hex"), link = safeUrl(item.link)?.href || "", source = item.source && SOURCES.includes(item.source) ? item.source : link ? sourceOf(new URL(link).hostname) : "";
    const v = { title: clean(item.title, 140) || "A past event", date: isoDate(item.date), time: clean(item.time, 40), place: safePlace(item.place), guests: Math.max(0, Math.min(10000, Math.round(+item.guests || 0))) || 0,
      note: clean(item.note, 400), about: clean(scrubAddress(item.about), 600), source, site: source === "Web" ? siteOf(link) : "", link,
      photos: (Array.isArray(item.photos) ? item.photos : []).filter((u) => /^\/_blob\/[A-Za-z0-9]{20}$/.test(u)).slice(0, 12), cover: COVER_OK(item.cover) ? item.cover : "", at: item.at || Date.now(),
      featured: !!item.featured, featuredOrder: item.featured ? Math.max(0, Math.round(+item.featuredOrder || 0)) : 0, section: SEC_ID.test(String(item.section || "")) ? String(item.section) : "",
      role: clean(item.role, LIMITS.role), room: cleanLine(item.room, LIMITS.room), proof: cleanLine(item.proof, LIMITS.proof), format: cleanFormat(item.format), company: clean(item.company, LIMITS.company), logos: cleanLogos(item.logos) };
    S(ws).set("scrapbook/" + id, v); return { id, ...v }; };
  // owner request (Nov 2026): Tuongvan's page gets who-was-in-the-room logos on matching events, plus the Atelier Bò pop-up and Apt Cafe Club. Once.
  try { const ws = C.wsOfHandle?.("tuongvan"), P = ws && C.showcasePreset?.("tuongvan");
    if (ws && P && S(ws).get("scrapbookmeta/seed") && !S(ws).get("scrapbookmeta/sync-logos-1")) { S(ws).set("scrapbookmeta/sync-logos-1", { at: Date.now() });
      const have = S(ws).list("scrapbook").map((d) => ({ id: String(d.id).split("/").pop(), ...d.data })), key = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      for (const x of P.scrapbook || []) { const cur = have.find((h) => key(h.title) === key(x.title));
        if (cur) { if (x.logos?.length && !cur.logos?.length) save(ws, { ...cur, logos: x.logos }); }
        else if (x.add) save(ws, { ...x, id: "", photos: [], at: Date.now(), featured: false, featuredOrder: 0 }); } } } catch (err) { console.warn("tuongvan logos", err?.message); }
  const keepImage = async (src, ws) => { if (!src || !saveImage) return ""; const r = await fetcher(src, { limit: MAX_IMG, kind: "image" }); if (!r) return ""; try { return (await saveImage(r.buf, r.type.split(";")[0].trim(), ws)) || ""; } catch { return ""; } };
  // read links into drafts; nothing is saved except a copy of each cover image (so the draft can show it)
  const readLinks = async (ws, links, { covers = true } = {}) => { const drafts = [], skipped = [], have = new Set(list(ws).map((x) => x.link).filter(Boolean));
    for (const raw of links.slice(0, MAX_LINKS)) { const x = safeUrl(raw); if (!x) { skipped.push({ link: clean(raw, 200), why: "That link can't be read. Use a public https page." }); continue; }
      if (have.has(x.href)) { skipped.push({ link: x.href, why: "Already in your scrapbook." }); continue; }
      const page = await fetcher(x.href, { limit: MAX_PAGE, kind: "html" }); if (!page) { skipped.push({ link: x.href, why: "Couldn't read that page. Add it by hand instead." }); continue; }
      const found = parseEvents(page.buf.toString("utf8"), page.finalUrl || x.href); if (!found.length) { skipped.push({ link: x.href, why: "No event on that page." }); continue; }
      for (const e of found) { if (drafts.length >= MAX_DRAFTS) break; const link = safeUrl(e.url)?.href || x.href; if (have.has(link) && found.length > 1) continue; have.add(link);
        const cover = covers && e.image && drafts.filter((d) => d.cover).length < 30 ? await keepImage(e.image, ws) : "";
        drafts.push({ key: crypto.randomBytes(4).toString("hex"), title: e.title, date: e.date, place: e.place, about: e.about, cover, link, source: sourceOf(siteOf(link)), site: siteOf(link), past: !e.date || e.date < new Date().toISOString().slice(0, 10) }); } }
    return { drafts, skipped }; };

  // the public scrapbook: imported events plus the ones hosted here
  // sections come back in order, only the ones with an event in them; featured is the host's order (at most 6)
  app.get("/api/public/host/:handle/scrapbook", (req, res) => { const ws = C.wsOfHandle(String(req.params.handle || "").toLowerCase()); if (!ws) return res.json({ items: [], sections: [], featured: [] });
    const L = list(ws), secs = sectionsOf(ws), used = new Set(L.map((x) => x.section).filter(Boolean)), ids = new Set(secs.map((s) => s.id));
    res.json({ items: L.map(({ id, title, date, time, place, guests, note, about, source, site, link, photos, cover, featured, featuredOrder, section, role, room, proof, format, company, logos }) => ({ id, title, date, time, place, guests, note, about, source, site, link, photos, cover, featured: !!featured, featuredOrder: featuredOrder || 0, section: ids.has(section) ? section : "", role: role || "", room: room || "", proof: proof || "", format: format || "", company: company || "", logos: cleanLogos(logos) })),
      sections: secs.filter((s) => used.has(s.id)), featured: featuredIds(L).slice(0, MAX_FEATURED) }); });
  app.get("/api/host/scrapbook", (req, res) => { const u = me(req, res); if (!u) return; const L = list(u.ws); res.json({ items: L, sections: sectionsOf(u.ws), featured: featuredIds(L), limits: { ...LIMITS, featured: MAX_FEATURED, sections: MAX_SECTIONS }, roles: ROLES, formats: FORMATS }); });
  // Potto's "Sort my events": suggested sections for the events not in one yet. Nothing changes until the host confirms (PUT below).
  app.get("/api/host/scrapbook/suggest", (req, res) => { const u = me(req, res); if (!u) return; res.json(suggestSections(list(u.ws), sectionsOf(u.ws))); });
  // the whole list of sections (create, rename, reorder, delete, list or program), plus optional moves and formats in one go
  app.put("/api/host/scrapbook-sections", small, (req, res) => { const u = me(req, res); if (!u) return; const b = req.body || {};
    if (!Array.isArray(b.sections)) return res.status(400).json({ code: "invalid", message: "Send the list of sections." });
    if (b.sections.length > MAX_SECTIONS) return res.status(400).json({ code: "limit", message: `Up to ${MAX_SECTIONS} sections.` });
    for (const x of b.sections) { if (!clean(x?.name, 200)) return res.status(400).json({ code: "invalid", message: "Every section needs a name." });
      if (clean(x?.name, 500).length > LIMITS.name) return res.status(400).json({ code: "too_long", message: `Keep section names to ${LIMITS.name} characters.` });
      if (clean(x?.blurb, 500).length > LIMITS.blurb) return res.status(400).json({ code: "too_long", message: `Keep the line under a section to ${LIMITS.blurb} characters.` });
      if (x?.kind != null && !["list", "program"].includes(x.kind)) return res.status(400).json({ code: "invalid", message: "A section is a list or a program." }); }
    // ids the client made up for new sections are kept when they're valid; moves follow any id the server had to change
    const remap = {}, seen = new Set(), given = b.sections.map((x, i) => { const id = SEC_ID.test(String(x?.id || "")) && !seen.has(String(x.id)) ? String(x.id) : crypto.randomBytes(4).toString("hex"); if (x?.id && String(x.id) !== id) remap[String(x.id)] = id; seen.add(id); return { ...x, id, order: x?.order ?? i }; });
    const secs = setSections(u.ws, given), ok = new Set(secs.map((s) => s.id)), assign = b.assign && typeof b.assign === "object" ? b.assign : {}, formats = b.formats && typeof b.formats === "object" ? b.formats : {};
    for (const x of list(u.ws)) { let sec = x.section; if (Object.prototype.hasOwnProperty.call(assign, x.id)) { const t = remap[assign[x.id]] || String(assign[x.id] || ""); if (!t || ok.has(t)) sec = t; }
      if (sec && !ok.has(sec)) sec = ""; const f = !x.format && formats[x.id] ? cleanFormat(formats[x.id]) : x.format;
      if (sec !== x.section || f !== x.format) S(u.ws).set("scrapbook/" + x.id, { ...S(u.ws).get("scrapbook/" + x.id).data, section: sec, format: f }); }
    const L = list(u.ws); res.json({ sections: secs, items: L, featured: featuredIds(L) }); });
  // the featured row, in the host's order: these ids are featured, every other event isn't
  app.put("/api/host/scrapbook-featured", small, (req, res) => { const u = me(req, res); if (!u) return; const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map((x) => String(x).replace(/[^a-f0-9]/g, "")))] : null;
    if (!ids) return res.status(400).json({ code: "invalid", message: "Send the featured events in order." });
    if (ids.length > MAX_FEATURED) return res.status(400).json({ code: "limit", message: `You can feature up to ${MAX_FEATURED} events.` });
    const L = list(u.ws), have = new Set(L.map((x) => x.id)); if (ids.some((id) => !have.has(id))) return res.status(404).json({ code: "not_found", message: "One of those isn't in your scrapbook." });
    for (const x of L) { const i = ids.indexOf(x.id), want = i >= 0, fo = want ? i + 1 : 0; if (want !== !!x.featured || fo !== (x.featuredOrder || 0)) S(u.ws).set("scrapbook/" + x.id, { ...S(u.ws).get("scrapbook/" + x.id).data, featured: want, featuredOrder: fo }); }
    res.json({ featured: ids }); });
  // Potto's "Drop links to past events": text with links in it (pasted, dropped or dictated) or a list → draft cards, nothing saved yet
  app.post("/api/host/scrapbook/preview", small, async (req, res) => { const u = me(req, res); if (!u) return; const b = req.body || {};
    const links = [...new Set([...extractLinks(b.text || ""), ...(Array.isArray(b.links) ? b.links : []).flatMap((l) => extractLinks(String(l)))])].slice(0, MAX_LINKS);
    if (!links.length) return res.status(400).json({ code: "no_links", message: "Paste at least one link to an event page." });
    if (overLimit(u.ws, links.length)) return res.status(429).json({ code: "rate_limited", message: "That's a lot of links for one hour. Try again in a bit." });
    res.json(await readLinks(u.ws, links)); });
  // add the drafts the host kept (after editing); also takes CSV rows and one event by hand
  const addDrafts = (ws, L) => (Array.isArray(L) ? L : []).slice(0, MAX_DRAFTS).filter((d) => clean(d?.title, 140)).map((d) => save(ws, { title: d.title, date: d.date, time: d.time, place: d.place, about: d.about, note: d.note, link: d.link, source: "", cover: d.cover, photos: /^\/_blob\//.test(d.cover || "") ? [d.cover] : [] }));
  app.post("/api/host/scrapbook/add", small, (req, res) => { const u = me(req, res); if (!u) return; if (list(u.ws).length >= MAX_ITEMS) return res.status(400).json({ code: "limit", message: "Your scrapbook is full (200 events)." });
    res.json({ added: addDrafts(u.ws, (req.body || {}).drafts), skipped: [] }); });
  // one step: links are read and added straight away (older pages use this), CSV rows, or one by hand
  app.post("/api/host/scrapbook/import", small, async (req, res) => { const u = me(req, res); if (!u) return; const b = req.body || {}, out = [];
    if (list(u.ws).length >= MAX_ITEMS) return res.status(400).json({ code: "limit", message: "Your scrapbook is full (200 events)." });
    let skipped = []; const links = (Array.isArray(b.links) ? b.links : []).map(String).slice(0, MAX_LINKS);
    if (links.length) { if (overLimit(u.ws, links.length)) return res.status(429).json({ code: "rate_limited", message: "That's a lot of links for one hour. Try again in a bit." }); const r = await readLinks(u.ws, links); skipped = r.skipped; out.push(...addDrafts(u.ws, r.drafts)); }
    if (Array.isArray(b.drafts)) out.push(...addDrafts(u.ws, b.drafts));
    for (const r of (Array.isArray(b.rows) ? b.rows : []).slice(0, 100)) { if (!clean(r?.title, 140)) continue; out.push(save(u.ws, { ...r, link: "", source: "CSV", photos: [], cover: "", featured: false, section: "", proof: "" })); }
    if (b.item && clean(b.item.title, 140)) out.push(save(u.ws, { ...b.item, link: "", source: "", featured: false, section: "" }));
    res.json({ added: out, skipped }); });
  // change one event: its details, ☆ featured, its section, and the role / room / proof / format lines (POST kept for older pages)
  const TOO_LONG = { role: "Keep your role short (40 characters).", room: "Keep who was there to one line (120 characters).", proof: "Keep the proof to one line (140 characters).", format: "Keep the format short (24 characters).", company: "Keep the company name to 60 characters." };
  const patch = (req, res) => { const u = me(req, res); if (!u) return; const id = String(req.params.id).replace(/[^a-f0-9]/g, ""); const cur = S(u.ws).get("scrapbook/" + id)?.data; if (!cur) return res.status(404).json({ code: "not_found", message: "Not in your scrapbook." });
    const b = req.body && typeof req.body === "object" ? req.body : {};
    for (const k of Object.keys(TOO_LONG)) if (b[k] != null && clean(b[k], 1000).length > LIMITS[k]) return res.status(400).json({ code: "too_long", field: k, message: TOO_LONG[k] });
    const next = { ...cur, ...b, id, source: cur.source, link: cur.link, at: cur.at, cover: b.cover !== undefined && COVER_OK(b.cover) ? b.cover : cur.cover, featured: cur.featured, featuredOrder: cur.featuredOrder, section: cur.section || "" };
    if (b.section !== undefined) { const sec = String(b.section || ""); if (sec && !sectionsOf(u.ws).some((s) => s.id === sec)) return res.status(400).json({ code: "invalid", field: "section", message: "That section isn't there any more." }); next.section = sec; }
    if (b.featured !== undefined) { const want = !!b.featured;
      if (want && !cur.featured) { const F = list(u.ws).filter((x) => x.featured); if (F.length >= MAX_FEATURED) return res.status(400).json({ code: "limit", message: `You can feature up to ${MAX_FEATURED} events. Unfeature one first.` }); next.featured = true; next.featuredOrder = Math.max(0, ...F.map((x) => x.featuredOrder || 0)) + 1; }
      if (!want) { next.featured = false; next.featuredOrder = 0; } }
    res.json({ item: save(u.ws, next) }); };
  app.post("/api/host/scrapbook/:id", small, patch);
  app.patch("/api/host/scrapbook/:id", small, patch);
  app.delete("/api/host/scrapbook/:id", (req, res) => { const u = me(req, res); if (!u) return; const id = String(req.params.id).replace(/[^a-f0-9]/g, ""); S(u.ws).delete("scrapbook/" + id); res.json({ ok: true }); });
}
