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
      S(ws).set("scrapbookmeta/seed", { from: P.handle, at: Date.now() }); for (const x of P.scrapbook) save(ws, { ...x, id: "", photos: [], at: Date.now() }); } catch {} };
  const list = (ws) => { seed(ws); return S(ws).list("scrapbook").map((d) => ({ id: String(d.id).split("/").pop(), ...d.data })).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || (b.at || 0) - (a.at || 0)); };
  const save = (ws, item) => { const id = item.id || crypto.randomBytes(6).toString("hex"), link = safeUrl(item.link)?.href || "", source = item.source && SOURCES.includes(item.source) ? item.source : link ? sourceOf(new URL(link).hostname) : "";
    const v = { title: clean(item.title, 140) || "A past event", date: isoDate(item.date), time: clean(item.time, 40), place: safePlace(item.place), guests: Math.max(0, Math.min(10000, Math.round(+item.guests || 0))) || 0,
      note: clean(item.note, 400), about: clean(scrubAddress(item.about), 600), source, site: source === "Web" ? siteOf(link) : "", link,
      photos: (Array.isArray(item.photos) ? item.photos : []).filter((u) => /^\/_blob\/[A-Za-z0-9]{20}$/.test(u)).slice(0, 12), cover: COVER_OK(item.cover) ? item.cover : "", at: item.at || Date.now() };
    S(ws).set("scrapbook/" + id, v); return { id, ...v }; };
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
  app.get("/api/public/host/:handle/scrapbook", (req, res) => { const ws = C.wsOfHandle(String(req.params.handle || "").toLowerCase()); if (!ws) return res.json({ items: [] });
    res.json({ items: list(ws).map(({ id, title, date, time, place, guests, note, about, source, site, link, photos, cover }) => ({ id, title, date, time, place, guests, note, about, source, site, link, photos, cover })) }); });
  app.get("/api/host/scrapbook", (req, res) => { const u = me(req, res); if (!u) return; res.json({ items: list(u.ws) }); });
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
    for (const r of (Array.isArray(b.rows) ? b.rows : []).slice(0, 100)) { if (!clean(r?.title, 140)) continue; out.push(save(u.ws, { ...r, link: "", source: "CSV", photos: [], cover: "" })); }
    if (b.item && clean(b.item.title, 140)) out.push(save(u.ws, { ...b.item, link: "", source: "" }));
    res.json({ added: out, skipped }); });
  app.post("/api/host/scrapbook/:id", small, (req, res) => { const u = me(req, res); if (!u) return; const id = String(req.params.id).replace(/[^a-f0-9]/g, ""); const cur = S(u.ws).get("scrapbook/" + id)?.data; if (!cur) return res.status(404).json({ code: "not_found", message: "Not in your scrapbook." });
    res.json({ item: save(u.ws, { ...cur, ...req.body, id, source: cur.source, link: cur.link, at: cur.at, cover: req.body?.cover !== undefined && COVER_OK(req.body.cover) ? req.body.cover : cur.cover }) }); });
  app.delete("/api/host/scrapbook/:id", (req, res) => { const u = me(req, res); if (!u) return; const id = String(req.params.id).replace(/[^a-f0-9]/g, ""); S(u.ws).delete("scrapbook/" + id); res.json({ ok: true }); });
}
