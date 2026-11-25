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
import { KUDOS_TAGS } from "./social.js";
import { guessFormat, cleanLogos } from "./scrapbook.js";

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
  ["workshop", /\b(workshop|masterclass|hands-on|wheel|throwing)\b/], ["class", /\b(class|lesson)\b/], ["pop-up", /\bpop[- ]?ups?\b|bake sale/], ["coffee", /\b(coffee|matcha|cafe|café)\b/], ["picnic", /\bpicnic\b/],
  ["game night", /game night|board game|trivia/], ["book club", /book club/], ["drinks", /happy hour|\bdrinks\b|\bwine\b|cocktail/], ["movement", /\b(yoga|pilates|dance|movement|stretch)\b/],
  ["party", /\b(party|celebration|disco)\b/], ["summit", /\bsummit\b/], ["conference", /\bconference\b/], ["panel", /\bpanel\b|fireside/], ["meetup", /meetup|meet-up/], ["online", /\b(webinar|virtual|online|zoom)\b/],
  ["tour", /\btour\b/], ["launch", /\blaunch\b/], ["offsite", /offsite|retreat/]];
function formatOf({ activity = "", title = "", tags = [], format = "", about = "", place = "" } = {}) {
  if (format) return s(format, 24).toLowerCase();
  for (const t of [String(activity).toLowerCase(), `${activity} ${title} ${(tags || []).join(" ")}`.toLowerCase()]) for (const [f, re] of FORMAT_WORDS) if (t && re.test(t)) return f;
  return guessFormat({ title, about, place }) || "other";
}
const clock = (t) => { const m = String(t || "").match(/^(\d{1,2}):(\d{2})$/); if (!m) return s(t, 40); const h = +m[1], mm = m[2]; return `${h % 12 || 12}${mm === "00" ? "" : ":" + mm}${h < 12 ? "am" : "pm"}`; };
// the price the event card shows: "Free", "Pay what you like", "$20 a person"
function priceOf(c) {
  const p = String(c.price ?? "").trim();
  if (c.free === true || !p || /^(free|0|\$0)$/i.test(p)) return "Free";
  if (p === "chip") return "Pay what you like";
  if (/^\$?\d/.test(p)) { const amt = p.startsWith("$") ? p : "$" + p; return /a person|each|per |at the door/i.test(amt) ? s(amt, 40) : `${s(amt, 30)} a person`; }
  return /^quoted$/i.test(p) ? "" : s(p, 40);
}
// "Chelsea, New York" -> area Chelsea, city New York; "Napa Valley, CA" -> city "Napa Valley, CA"
function splitPlace(place) {
  const P = String(place || "").split(/,\s*/).map((x) => x.trim()).filter(Boolean);
  if (!P.length) return { city: "", area: "" };
  if (P.length === 1) return { city: P[0], area: "" };
  if (/^[A-Z]{2}$/.test(P[P.length - 1])) return { city: P.slice(-2).join(", "), area: P.length > 2 ? P.slice(0, -2).join(", ") : "" };
  return { city: P[P.length - 1], area: P.slice(0, -1).join(", ") };
}
const csvCell = (v) => { let t = Array.isArray(v) ? v.join("; ") : v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };

// ---- reviews (guests' kudos) ----
const EMPTY_REVIEWS = () => ({ count: 0, would_go_again_pct: null, top_tags: [], items: [] });
function reviewItem(k) { return { name: first(k.name) || "A guest", text: s(k.love, 500), tags: (k.tags || []).filter((t) => TAG_LABEL[t]).map((t) => TAG_LABEL[t]), at: k.at ? new Date(k.at).toISOString().slice(0, 10) : "" }; }
// the host page's numbers: reviews are kudos with words or chips; "would go again" is the same definition the page uses
function summarize(K, { items = 10 } = {}) {
  const shown = K.filter((k) => k.love || (k.tags || []).length).sort((a, b) => (b.at || 0) - (a.at || 0));
  if (!shown.length) return EMPTY_REVIEWS();
  const tags = {}; for (const k of shown) for (const t of k.tags || []) if (TAG_LABEL[t]) tags[t] = (tags[t] || 0) + 1;
  const yes = K.filter((k) => (k.tags || []).includes("again") || k.compare === "better").length, of = K.filter((k) => (k.tags || []).length || k.love || k.compare).length;
  return { count: shown.length, would_go_again_pct: shown.length >= 3 && of ? Math.round((100 * yes) / of) : null,
    top_tags: Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([tag, count]) => ({ tag, label: TAG_LABEL[tag], count })),
    items: shown.slice(0, items == null ? shown.length : items).map(reviewItem) };
}

export function makeDirectory({ store, C, SB }) {
  let cache = null;
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
      if (!kudosOf.has(H.ws)) kudosOf.set(H.ws, scopeStore(store, H.ws).list("kudos").map((d) => d.data).filter((k) => k && typeof k === "object"));
      return eventId ? summarize(kudosOf.get(H.ws).filter((k) => k.eventId === eventId), { items: null }) : summarize(kudosOf.get(H.ws), { items: null }); };
    const fromCard = (c, H, status) => ({ id: c.id, title: s(c.title, 140), status, start: /^\d{4}-\d{2}-\d{2}$/.test(c.date || "") ? c.date : "", time: [clock(c.startTime), clock(c.endTime)].filter(Boolean).join(" to "),
      city: s(c.city, 60), area: s(c.hood, 60), format: formatOf({ activity: c.activity, title: c.title, tags: c.tags }), tags: (Array.isArray(c.tags) ? c.tags : []).map((t) => s(t, 24)).filter(Boolean).slice(0, 8),
      price: priceOf(c), spots_left: +c.headcount > 0 && c.going != null ? Math.max(0, Math.round(+c.headcount - +c.going)) : null, ask_to_join: !!c.approvalRequired,
      host: hostRef(H.h), url: `${base}/e/${encodeURIComponent(c.id)}`, source: "hosted", original_link: "", companies: [], cover: abs(c.coverPhoto), example: !!(c.sample || H.sample),
      reviews: status === "past" ? reviewsFor(H, c.id) : EMPTY_REVIEWS(), _start: c.startTime || "" });

    // upcoming: Discover's list, as is
    for (const c of D.events) { const H = hosts.get(c.host?.handle); if (!H || !ID_OK.test(String(c.id)) || c.private || c.unlisted) continue; if ((c.date || "9999") < now) continue; events.push(fromCard(c, H, "upcoming")); }
    // past: what each page shows under "Past events"
    for (const H of hosts.values()) { if (H.pastOff) continue; const seen = new Set();
      if (H.ws) for (const c of C.eventsOf(H.ws, { upcoming: false })) { if (c.private || c.unlisted || !ID_OK.test(String(c.id))) continue; seen.add(`${String(c.title || "").toLowerCase()}|${c.date || ""}`); events.push(fromCard(c, H, "past")); }
      const items = H.ws ? SB.publicItems(H.ws) : H.h.scrapbook || [];
      for (const x of items) { const date = /^\d{4}-\d{2}-\d{2}$/.test(x.date || "") ? x.date : ""; if (date && date >= now) continue;
        const k = `${String(x.title || "").toLowerCase()}|${date}`; if (seen.has(k)) continue; seen.add(k);
        const { city, area } = splitPlace(x.place), link = /^https:\/\//i.test(x.link || "") ? x.link : "";
        events.push({ id: `sb-${H.rec.handle}-${String(x.id).replace(/[^A-Za-z0-9_-]/g, "")}`, title: s(x.title, 140), status: "past", start: date, time: s(x.time, 40).replace(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s*·\s*/i, ""), city, area,
          format: formatOf({ format: x.format, title: x.title, about: x.about, place: x.place }), tags: [], price: null, spots_left: null, ask_to_join: false, host: hostRef(H.h), url: `${H.rec.url}#scrapbook`, source: "scrapbook",
          original_link: link, companies: cleanLogos(x.logos).map((l) => l.name), cover: abs(x.cover), example: !!H.sample, reviews: EMPTY_REVIEWS(), _start: "" }); } }

    // one event listed by two hosts (co-hosted, same original link): show it once, with both hosts; each host's own list still has it
    { const first = new Map(); for (const e of events) { const k = e.original_link && e.original_link.toLowerCase(); if (!k) continue; const f = first.get(k); if (!f) { first.set(k, e); continue; }
        if (f.host.handle !== e.host.handle) { e._dup = true; f.cohosts = [...(f.cohosts || []), e.host]; } } }
    // per-host numbers and reviews
    const byHost = new Map(); for (const e of events) { if (!byHost.has(e.host.handle)) byHost.set(e.host.handle, []); byHost.get(e.host.handle).push(e); }
    const listed = new Set(D.hosts.map((h) => h.handle)), titles = new Map(events.map((e) => [e.id, e]));
    const reviews = [];
    for (const [handle, H] of hosts) { const L = byHost.get(handle) || [];
      if (!L.length && !listed.has(handle)) { hosts.delete(handle); continue; }
      H.rec.upcoming_count = L.filter((e) => e.status === "upcoming").length; H.rec.past_count = L.filter((e) => e.status === "past").length;
      H.rec.formats = [...new Set(L.map((e) => e.format).filter((f) => f && f !== "other"))].slice(0, 8);
      const R = reviewsFor(H, null); H.rec.reviews = { count: R.count, would_go_again_pct: R.would_go_again_pct, top_tags: R.top_tags }; H.reviewItems = R.items;
      if (H.ws && !H.kudosOff) for (const k of (kudosOf.get(H.ws) || []).filter((k) => k.love || (k.tags || []).length)) { const ev = titles.get(k.eventId);
        reviews.push({ ...reviewItem(k), event: ev && ev.host.handle === handle ? { id: ev.id, title: ev.title, url: ev.url } : null, host: hostRef(H.h), example: !!H.sample, _at: k.at || 0 }); } }
    reviews.sort((a, b) => b._at - a._at);
    return { at: Date.now(), events, hosts, reviews };
  }
  const data = (base) => { if (!cache || cache.base !== base || Date.now() - cache.at > TTL()) cache = { ...build(base), base }; return cache; };

  // ---- queries ----
  const strip = (e, { items = 10 } = {}) => { const { _start, _dup, ...o } = e; return { ...o, reviews: { ...e.reviews, items: items == null ? e.reviews.items : e.reviews.items.slice(0, items) } }; };
  const truthy = (v) => /^(1|true|yes)$/i.test(String(v ?? ""));
  const encodeCursor = (n) => Buffer.from("o:" + n).toString("base64url");
  const decodeCursor = (c) => { try { const m = Buffer.from(String(c || ""), "base64url").toString().match(/^o:(\d{1,7})$/); return m ? +m[1] : 0; } catch { return 0; } };
  const limitOf = (v, d = 20) => Math.max(1, Math.min(MAX_LIMIT, Math.round(+v || d)));
  function filterEvents(base, q = {}) {
    const D = data(base), status = ["upcoming", "past", "all"].includes(q.status) ? q.status : "upcoming", words = s(q.q, 120).toLowerCase().split(/\s+/).filter(Boolean);
    const city = s(q.city, 60).toLowerCase(), format = s(q.format, 24).toLowerCase(), host = s(q.host, 30).toLowerCase().replace(/^@/, ""), ex = truthy(q.include_examples);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from || "") ? q.from : "", to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || "") ? q.to : "";
    const L = D.events.filter((e) => (!e._dup || host) && (status === "all" || e.status === status) && (ex || !e.example) && (!city || `${e.city} ${e.area}`.toLowerCase().includes(city)) && (!format || e.format === format) && (!host || e.host.handle === host)
      && (!from || (e.start && e.start >= from)) && (!to || (e.start && e.start <= to))
      && (!words.length || ((t) => words.every((w) => t.includes(w)))([e.title, e.city, e.area, e.format, e.host.name, e.host.handle, ...e.tags, ...e.companies].join(" ").toLowerCase())));
    const up = L.filter((e) => e.status === "upcoming").sort((a, b) => String(a.start || "9").localeCompare(String(b.start || "9")) || a._start.localeCompare(b._start));
    const past = L.filter((e) => e.status === "past").sort((a, b) => String(b.start || "0").localeCompare(String(a.start || "0")));
    return [...up, ...past];
  }
  function searchEvents(base, q = {}) { const L = filterEvents(base, q), off = decodeCursor(q.cursor), lim = limitOf(q.limit), page = L.slice(off, off + lim);
    return { data: page.map((e) => strip(e)), next_cursor: off + lim < L.length ? encodeCursor(off + lim) : null, total: L.length }; }
  function getEvent(base, id) { const e = data(base).events.find((x) => x.id === String(id || "")); return e ? strip(e, { items: null }) : null; }
  function listHosts(base, q = {}) { const words = s(q.q, 120).toLowerCase().split(/\s+/).filter(Boolean), city = s(q.city, 60).toLowerCase(), ex = truthy(q.include_examples);
    const L = [...data(base).hosts.values()].map((H) => H.rec).filter((h) => (ex || !h.example) && (!city || `${h.city} ${h.area}`.toLowerCase().includes(city))
      && (!words.length || ((t) => words.every((w) => t.includes(w)))([h.name, h.handle, h.city, h.area, h.tagline, ...h.tags, ...h.formats].join(" ").toLowerCase())))
      .sort((a, b) => b.upcoming_count + b.past_count + b.reviews.count - (a.upcoming_count + a.past_count + a.reviews.count) || a.name.localeCompare(b.name));
    const off = decodeCursor(q.cursor), lim = limitOf(q.limit, 50);
    return { data: L.slice(off, off + lim), next_cursor: off + lim < L.length ? encodeCursor(off + lim) : null, total: L.length }; }
  function getHost(base, handle) { const H = data(base).hosts.get(s(handle, 30).toLowerCase().replace(/^@/, "")); if (!H) return null;
    return { ...H.rec, reviews: { ...H.rec.reviews, items: H.reviewItems.slice(0, 50) }, events: filterEvents(base, { status: "all", host: H.rec.handle, include_examples: "1" }).map((e) => strip(e)) }; }
  function formats(base, q = {}) { const L = filterEvents(base, { status: q.status || "all", include_examples: q.include_examples }), F = {}, Ci = {}, FC = {};
    for (const e of L) { F[e.format] = (F[e.format] || 0) + 1; if (e.city) { Ci[e.city] = (Ci[e.city] || 0) + 1; const k = e.format + "|" + e.city; FC[k] = (FC[k] || 0) + 1; } }
    const sort = (o) => Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { total: L.length, formats: sort(F).map(([format, count]) => ({ format, count })), cities: sort(Ci).map(([city, count]) => ({ city, count })), by_format_and_city: sort(FC).map(([k, count]) => { const [format, city] = k.split("|"); return { format, city, count }; }) }; }
  function listReviews(base, q = {}) { const D = data(base), host = s(q.host, 30).toLowerCase().replace(/^@/, ""), ev = s(q.event ?? q.event_id, 120), words = s(q.q, 120).toLowerCase().split(/\s+/).filter(Boolean), ex = truthy(q.include_examples) || !!host || !!ev;
    const L = D.reviews.filter((r) => (ex || !r.example) && (!host || r.host.handle === host) && (!ev || r.event?.id === ev) && (!words.length || ((t) => words.every((w) => t.includes(w)))([r.text, r.name, ...r.tags, r.event?.title || "", r.host.name].join(" ").toLowerCase())));
    const off = decodeCursor(q.cursor), lim = limitOf(q.limit, 20), tags = {}; for (const r of L) for (const t of r.tags) tags[t] = (tags[t] || 0) + 1;
    return { data: L.slice(off, off + lim).map(({ _at, ...r }) => r), next_cursor: off + lim < L.length ? encodeCursor(off + lim) : null, total: L.length,
      top_tags: Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, count]) => ({ tag: KUDOS_TAGS.find((k) => k[2] === label)?.[0] || "", label, count })) }; }
  function csv(base, q = {}) {
    const cols = ["id", "title", "status", "start", "time", "city", "area", "format", "tags", "price", "spots_left", "host_handle", "host_name", "host_url", "url", "source", "original_link", "companies", "cover", "example", "review_count", "would_go_again_pct"];
    const rows = filterEvents(base, q).slice(0, 5000).map((e) => [e.id, e.title, e.status, e.start, e.time, e.city, e.area, e.format, e.tags, e.price, e.spots_left, e.host.handle, e.host.name, e.host.url, e.url, e.source, e.original_link, e.companies, e.cover, e.example, e.reviews.count, e.reviews.would_go_again_pct]);
    return [cols, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n"; }
  // schema.org Event for the page's upcoming events (for search engines; same public fields)
  function jsonLd(base) { return filterEvents(base, { status: "upcoming" }).slice(0, 100).map((e) => { const m = String(e._start).match(/^(\d{1,2}):(\d{2})$/), amt = String(e.price || "").match(/^\$(\d+(?:\.\d{1,2})?) a person$/);
    return { "@context": "https://schema.org", "@type": "Event", name: e.title, startDate: e.start ? e.start + (m ? `T${m[1].padStart(2, "0")}:${m[2]}` : "") : undefined, eventStatus: "https://schema.org/EventScheduled", eventAttendanceMode: e.format === "online" ? "https://schema.org/OnlineEventAttendanceMode" : "https://schema.org/OfflineEventAttendanceMode",
      location: e.format === "online" ? { "@type": "VirtualLocation", url: e.url } : { "@type": "Place", name: [e.area, e.city].filter(Boolean).join(", ") || "Shared with guests", address: { "@type": "PostalAddress", addressLocality: e.city || undefined } },
      organizer: { "@type": "Person", name: e.host.name, url: e.host.url }, url: e.url, ...(e.cover ? { image: e.cover } : {}),
      ...(e.price === "Free" ? { isAccessibleForFree: true, offers: { "@type": "Offer", price: 0, priceCurrency: "USD", url: e.url } } : amt ? { offers: { "@type": "Offer", price: +amt[1], priceCurrency: "USD", url: e.url } } : {}) }; }); }
  return { searchEvents, getEvent, listHosts, getHost, formats, listReviews, csv, jsonLd, filterEvents };
}

// ---- the public MCP server's tools (read-only) ----
const str = (description, extra = {}) => ({ type: "string", description, ...extra });
const EVENT_FILTERS = { q: str("Words to match in the title, host, place, format, tags or companies"), city: str("City or neighborhood, e.g. Brooklyn"), format: str("dinner, run, workshop, pop-up, coffee, class, hike, party, summit…"),
  status: str("upcoming (default), past or all", { enum: ["upcoming", "past", "all"] }), from: str("Earliest date, YYYY-MM-DD"), to: str("Latest date, YYYY-MM-DD"), host: str("A host's handle, e.g. atbo"),
  include_examples: { type: "boolean", description: "Also return sample events from example hosts (off by default)" }, limit: { type: "number", description: "Up to 100 (default 20)" }, cursor: str("next_cursor from the last page") };
export const PUBLIC_TOOLS = [
  { name: "search_events", description: "Search the Pottery Lab events directory: upcoming events hosts made public and past events from their scrapbooks. Returns { data, next_cursor, total }.", inputSchema: { type: "object", properties: EVENT_FILTERS }, annotations: { readOnlyHint: true } },
  { name: "get_event", description: "One event from the directory by id, with all its reviews.", inputSchema: { type: "object", properties: { id: str("Event id from search_events") }, required: ["id"] }, annotations: { readOnlyHint: true } },
  { name: "list_hosts", description: "Hosts with a public page: name, city, what they host, event counts and a review summary.", inputSchema: { type: "object", properties: { q: str("Words to match"), city: str("City or neighborhood"), limit: { type: "number", description: "Up to 100 (default 50)" }, cursor: str("next_cursor from the last page") } }, annotations: { readOnlyHint: true } },
  { name: "get_host", description: "One host's public profile, their events in the directory and recent reviews.", inputSchema: { type: "object", properties: { handle: str("The host's handle, e.g. atbo") }, required: ["handle"] }, annotations: { readOnlyHint: true } },
  { name: "list_formats", description: "Event counts by format and by city, for building filters.", inputSchema: { type: "object", properties: { status: str("upcoming, past or all (default)", { enum: ["upcoming", "past", "all"] }) } }, annotations: { readOnlyHint: true } },
  { name: "get_reviews", description: "Guests' reviews (kudos) for one event or for a host: first name, what they loved, the chips they tapped, the date, plus counts. No star ratings exist.", inputSchema: { type: "object", properties: { event_id: str("An event id"), host: str("A host's handle"), q: str("Words to match"), limit: { type: "number", description: "Up to 100 (default 20)" }, cursor: str("next_cursor from the last page") } }, annotations: { readOnlyHint: true } },
];

export function mountDirectory(app, { store, small, C, SB, PUBLIC_DIR, sendText, guestRedirect = "", publicOrigin }) {
  const Dir = makeDirectory({ store, C, SB });
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
  app.get("/api/v1/events", api, (req, res) => res.json(Dir.searchEvents(base(req), req.query)));
  app.get("/api/v1/events.csv", api, (req, res) => res.type("text/csv; charset=utf-8").set("Content-Disposition", 'inline; filename="pottery-lab-events.csv"').send(Dir.csv(base(req), req.query)));
  app.get("/api/v1/events/:id", api, (req, res) => { const e = Dir.getEvent(base(req), req.params.id); return e ? res.json({ data: e }) : notFound(res, "event"); });
  app.get("/api/v1/hosts", api, (req, res) => res.json(Dir.listHosts(base(req), req.query)));
  app.get("/api/v1/hosts/:handle", api, (req, res) => { const h = Dir.getHost(base(req), req.params.handle); return h ? res.json({ data: h }) : res.status(404).json({ code: "not_found", message: "No host by that name." }); });
  app.get("/api/v1/formats", api, (req, res) => res.json(Dir.formats(base(req), req.query)));
  app.get("/api/v1/reviews", api, (req, res) => res.json(Dir.listReviews(base(req), req.query)));
  app.get("/api/v1/openapi.json", api, (req, res) => res.json(openapi(base(req))));
  app.get("/llms.txt", (req, res) => { open(res); res.set("Cache-Control", "public, max-age=300").type("text/plain; charset=utf-8").send(llms(base(req))); });

  // ---- the public MCP server: JSON-RPC 2.0 over HTTP POST (streamable HTTP, JSON responses, batches), read-only ----
  const text = (obj) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] });
  const run = {
    search_events: (a, b) => Dir.searchEvents(b, a),
    get_event: (a, b) => { const e = Dir.getEvent(b, a.id); if (!e) throw new Error("No event by that id. Use search_events to find one."); return e; },
    list_hosts: (a, b) => Dir.listHosts(b, a),
    get_host: (a, b) => { const h = Dir.getHost(b, a.handle); if (!h) throw new Error("No host by that handle. Use list_hosts to find one."); return h; },
    list_formats: (a, b) => Dir.formats(b, a),
    get_reviews: (a, b) => { if (!a.event_id && !a.host) throw new Error("Pass event_id or host."); return Dir.listReviews(b, { ...a, event: a.event_id }); },
  };
  function handle(msg, b) {
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } };
    if (msg.id === undefined) return null; // notifications
    const reply = (result) => ({ jsonrpc: "2.0", id: msg.id ?? null, result }), fail = (code, message) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
    try {
      if (msg.method === "initialize") return reply({ protocolVersion: msg.params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "pottery-lab-directory", version: "1.0.0" },
        instructions: "Pottery Lab's public events directory, read-only. Start with search_events or list_formats. Places are a neighborhood or city only; exact addresses go to guests who are in. Reviews are guests' kudos; there are no star ratings. Don't invent events, prices or reviews." });
      if (msg.method === "ping") return reply({});
      if (msg.method === "tools/list") return reply({ tools: PUBLIC_TOOLS });
      if (msg.method === "tools/call") { const name = msg.params?.name, fn = Object.hasOwn(run, name) ? run[name] : null, args = msg.params?.arguments && typeof msg.params.arguments === "object" ? msg.params.arguments : {};
        if (!fn) return fail(-32602, `Unknown tool ${name}`);
        try { return reply(text(fn(args, b))); } catch (e) { return reply({ ...text(String(e.message || e)), isError: true }); } }
      return fail(-32601, `Method not found: ${msg.method}`);
    } catch (e) { return fail(-32603, String(e.message || e)); }
  }
  app.options("/mcp/public", (req, res) => { open(res); res.status(204).end(); });
  app.get("/mcp/public", (req, res) => { open(res); res.set("Allow", "POST, OPTIONS").status(405).json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "POST JSON-RPC messages here. This server sends JSON responses, no event stream." } }); });
  app.post("/mcp/public", (req, res, next) => { open(res); const wait = overLimit(req, "mcp"); if (wait) { res.set("Retry-After", String(wait)); return res.status(429).json({ jsonrpc: "2.0", id: null, error: { code: -32029, message: `Too many requests. Try again in ${wait}s.` } }); } next(); },
    small, (req, res) => { const b = base(req), body = req.body;
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
  const filters = [q("q", "Words to match in the title, host, place, format, tags or companies"), q("city", "City or neighborhood (contains, any case)"), q("format", "dinner, run, workshop, pop-up, coffee, class, hike, party, summit…"),
    q("status", "Which events", { type: "string", enum: ["upcoming", "past", "all"], default: "upcoming" }), q("from", "Earliest date, YYYY-MM-DD", { type: "string", format: "date" }), q("to", "Latest date, YYYY-MM-DD", { type: "string", format: "date" }),
    q("host", "A host's handle"), q("include_examples", "Also include sample events from example hosts", { type: "boolean", default: false })];
  const page = [q("limit", "Page size, at most 100", { type: "integer", minimum: 1, maximum: 100, default: 20 }), q("cursor", "next_cursor from the previous page")];
  const ref = (n) => ({ $ref: "#/components/schemas/" + n });
  const json = (schema) => ({ "application/json": { schema } });
  const list = (item, extra = {}) => ({ type: "object", required: ["data", "next_cursor", "total"], properties: { data: { type: "array", items: ref(item) }, next_cursor: { type: ["string", "null"] }, total: { type: "integer" }, ...extra } });
  const ok = (schema, d = "OK") => ({ 200: { description: d, content: json(schema) }, 429: { description: "Too many requests from this IP this hour", content: json(ref("Error")) } });
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
      "/api/v1/hosts/{handle}": { get: { operationId: "getHost", summary: "One host, their events and recent reviews", parameters: [{ name: "handle", in: "path", required: true, schema: { type: "string" } }], responses: { ...ok({ type: "object", properties: { data: { allOf: [ref("Host"), { type: "object", properties: { events: { type: "array", items: ref("Event") }, reviews: ref("Reviews") } }] } } }), ...nf } } },
      "/api/v1/formats": { get: { operationId: "listFormats", summary: "Counts by format and city, for filters", parameters: [q("status", "Which events", { type: "string", enum: ["upcoming", "past", "all"], default: "all" })],
        responses: ok({ type: "object", properties: { total: { type: "integer" }, formats: { type: "array", items: { type: "object", properties: { format: { type: "string" }, count: { type: "integer" } } } }, cities: { type: "array", items: { type: "object", properties: { city: { type: "string" }, count: { type: "integer" } } } }, by_format_and_city: { type: "array", items: { type: "object", properties: { format: { type: "string" }, city: { type: "string" }, count: { type: "integer" } } } } } }) } },
      "/api/v1/reviews": { get: { operationId: "listReviews", summary: "Guests' reviews (kudos), newest first", parameters: [q("host", "A host's handle"), q("event", "An event id"), q("q", "Words to match"), ...page], responses: ok(list("ReviewEntry", { top_tags: { type: "array", items: ref("TagCount") } })) } },
      "/api/v1/openapi.json": { get: { operationId: "openapi", summary: "This document", responses: { 200: { description: "OpenAPI 3.1", content: json({ type: "object" }) } } } },
    },
    components: { schemas: {
      Error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
      TagCount: { type: "object", properties: { tag: { type: "string" }, label: { type: "string" }, count: { type: "integer" } } },
      Review: { type: "object", properties: { name: { type: "string", description: "The guest's first name, or A guest" }, text: { type: "string", description: "What they loved" }, tags: { type: "array", items: { type: "string" } }, at: { type: "string", format: "date" } } },
      ReviewEntry: { allOf: [ref("Review"), { type: "object", properties: { event: { type: ["object", "null"], properties: { id: { type: "string" }, title: { type: "string" }, url: { type: "string" } } }, host: ref("HostRef"), example: { type: "boolean" } } }] },
      Reviews: { type: "object", required: ["count"], properties: { count: { type: "integer" }, would_go_again_pct: { type: ["integer", "null"], description: "Share of guests who said they'd go again; null under 3 reviews" }, top_tags: { type: "array", items: ref("TagCount") }, items: { type: "array", items: ref("Review"), description: "Up to 10 in lists, all on GET /api/v1/events/{id}" } } },
      HostRef: { type: "object", properties: { handle: { type: "string" }, name: { type: "string" }, url: { type: "string", format: "uri" } } },
      Event: { type: "object", required: ["id", "title", "status", "host", "url", "source", "example", "reviews"], properties: {
        id: { type: "string" }, title: { type: "string" }, status: { type: "string", enum: ["upcoming", "past"] }, start: { type: "string", description: "YYYY-MM-DD, or empty when the host hasn't set a date" }, time: { type: "string", description: "e.g. 7pm, or 7pm to 10pm" },
        city: { type: "string" }, area: { type: "string", description: "Neighborhood. Never a street address." }, format: { type: "string" }, tags: { type: "array", items: { type: "string" } },
        price: { ...nstr, description: "e.g. Free, $20 a person, Pay what you like; null when unknown" }, spots_left: { type: ["integer", "null"] }, ask_to_join: { type: "boolean", description: "The host lets guests in" },
        host: ref("HostRef"), url: { type: "string", format: "uri", description: "The public invite (/e/:id) or the host page's scrapbook" }, source: { type: "string", enum: ["hosted", "scrapbook"] },
        original_link: { type: "string", description: "The original page for an imported event (Partiful, Luma, Eventbrite, a website)" }, companies: { type: "array", items: { type: "string" } }, cover: { type: "string" }, example: { type: "boolean" }, reviews: ref("Reviews") } },
      Host: { type: "object", properties: { handle: { type: "string" }, name: { type: "string" }, url: { type: "string" }, city: { type: "string" }, area: { type: "string" }, tagline: { type: "string" }, bio: { type: "string" }, tags: { type: "array", items: { type: "string" } }, emoji: { type: "string" }, avatar: { type: "string" },
        prepared: { type: "boolean" }, example: { type: "boolean" }, upcoming_count: { type: "integer" }, past_count: { type: "integer" }, formats: { type: "array", items: { type: "string" } }, reviews: ref("Reviews") } },
    } } };
}

function llms(base) {
  return `# Pottery Lab events directory

> Events that hosts on Pottery Lab made public: supper clubs, run clubs, pottery and matcha workshops, pop-ups, summits. Upcoming events and past events from host scrapbooks, with guests' reviews. Read-only, free, no sign-in.

People browse it at ${base}/events. Agents and scripts can read the same data below.

## API

- ${base}/api/v1/events : search events. Filters: q, city, format, status (upcoming, past, all; default upcoming), from, to (YYYY-MM-DD), host (a handle), include_examples, limit (up to 100), cursor. Returns { data, next_cursor, total }.
- ${base}/api/v1/events/{id} : one event, with all its reviews.
- ${base}/api/v1/events.csv : the same filters as a spreadsheet.
- ${base}/api/v1/hosts : hosts with a public page (q, city). ${base}/api/v1/hosts/{handle} : one host, their events and reviews.
- ${base}/api/v1/formats : counts by format and city.
- ${base}/api/v1/reviews : guests' reviews (host, event, q, limit, cursor).
- ${base}/api/v1/openapi.json : OpenAPI 3.1 for all of the above.

JSON, CORS open, cached for 60 seconds, rate limited per IP. Page through with next_cursor until it's null.

## MCP

A public MCP server, no auth: ${base}/mcp/public (streamable HTTP, JSON responses).
Tools: search_events, get_event, list_hosts, get_host, list_formats, get_reviews.

## Each event

id, title, status (upcoming or past), start (YYYY-MM-DD), time, city, area (neighborhood), format, tags, price ("Free", "$20 a person"), spots_left, host { handle, name, url }, url (the public invite or the host's page), source (hosted or scrapbook), original_link (Partiful, Luma, Eventbrite), companies, cover, example, reviews { count, would_go_again_pct, top_tags, items }.

## Data rules

- Only what a public page already shows. Upcoming events are the ones Discover lists. Link-only, unlisted and past invites stay off it.
- Places are a neighborhood or city. Street addresses and meet points go to guests who are in, never here.
- No guest lists, guest counts, emails, phone numbers or pay links.
- Reviews are guests' kudos: a first name, what they loved, the chips they tapped and the date. Only guests who replied to that event can leave one. There are no star ratings. "would_go_again_pct" is null under 3 reviews.
- Imported past events have no reviews unless guests left kudos here. Their count is 0.
- Hosts can keep their past events and reviews out of the directory.
- Sample events from example hosts are marked example: true and left out unless you pass include_examples.
- Don't invent events, prices, ratings or reviews from this data. Link to the event's url when you mention it.
`;
}
