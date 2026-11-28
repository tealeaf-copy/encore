// ---- visual feed ----
// The feed as photos first: a stories rail (hosts with photos, short videos and flyers from the last 14 days), event
// cards built from the flyer or cover (or the illustrated cover art when there's no photo), past events as a carousel
// of photos with kudos, and the same layout for people who aren't signed in, made from public content only.
//
// Privacy, in one place:
// - Moments (photos and videos guests and hosts add after an event) reach strangers (the public feed, stories for
//   signed-out visitors) only from events that are open: on Discover (discoverable, not unlisted), not Ask to join,
//   not "No photography". Link-only and Ask to join events' moments show only to people who were there (the host and
//   guests who were in) and, on the host's page, only when the host turns that on (momentsOnPage).
// - A moment the host hides is gone everywhere except the host's own list, where it can be shown again.
// - Kudos quotes on public cards come from open events only, with emails and phone numbers scrubbed.
// Showcase (prepared) pages fill the signed-out feed with their covers and illustrated art, so it never looks empty.
import { coverOf } from "./eventcover.js"; // one cover per event everywhere
import crypto from "node:crypto";
import { previewListed } from "./previews.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scopeStore, getWorkspace, workspaceOfEvent, DEFAULT_WS } from "./workspaces.js";
import { cleanLook } from "./looks.js";
import "../public/pickup.js"; // a drop's pickup words (globalThis.PLPickup)
import { kitJson } from "./brandkit.js"; // a host's brand kit, for story cards
import { interestsOf, cleanInterests } from "./hooks.js";
import { typeOf } from "./eventtypes.js"; // the type tag on each card

const PRESETS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "presets");
const DAY = 864e5;
export const SHOWCASE_FRESH_DAYS = 14;
export const RECAP_MIN = 3, RECAP_WINDOW = 3 * DAY, RECAP_SHOWS = DAY; // recap stories: 3+ photos and kudos, made within 3 days of the event, shown 24 hours // prepared and example pages' past events older than this leave "What people are hosting"
const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
const scrub = (s) => String(s || "").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "…").replace(/\(?(?:\+?\d[\s().-]*){7,}\d/g, "…");
const hashKey = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 20);

// ---------- what a moment upload may be ----------
export const MOMENT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
// MOV plays in Safari (and in Chrome when it's H.264 inside); the viewer falls back to the poster when it can't
export const MOMENT_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
export const MOMENT_MAX_SECONDS = 15;
export const MOMENTS_PER_PERSON = 30; // per event, so one guest can't flood an event's page
/** "image", "video" or null for a content type a moment can't be. */
export const momentKind = (ct) => (MOMENT_IMAGE_TYPES.includes(ct) ? "image" : MOMENT_VIDEO_TYPES.includes(ct) ? "video" : null);
/** The size limit in bytes: ASSET_MAX_MB for anything, and MOMENT_VIDEO_MAX_MB (default the same) for videos. */
export function momentMaxBytes(kind) {
  const asset = Number(process.env.ASSET_MAX_MB || 15) || 15, video = Number(process.env.MOMENT_VIDEO_MAX_MB || asset) || asset;
  return Math.floor((kind === "video" ? Math.min(asset, video) : asset) * 1024 * 1024);
}
/** What the file's first bytes say it is (JPEG FFD8FF, PNG 89504E47, WebP RIFF....WEBP, GIF8, MP4/MOV ftyp at 4,
 * WebM/Matroska 1A45DFA3), or "" when they say nothing we take. The type a browser sends is only a claim. */
export function sniffType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return "";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length >= 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  if (buf.toString("latin1", 0, 4) === "GIF8") return "image/gif";
  if (buf.length >= 12 && buf.toString("latin1", 4, 8) === "ftyp") return buf.toString("latin1", 8, 12) === "qt  " ? "video/quicktime" : "video/mp4";
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "video/webm";
  return ""; }
/** The type to store an upload under: its bytes' own type when they're the same kind (a photo, a video) as the claim. */
export const sniffedAs = (claimed, buf) => { const t = sniffType(buf); return t && momentKind(t) === momentKind(claimed) ? t : ""; };
// a video whose length the file doesn't say: only this small (a short clip), else we ask for one from the camera
export const unreadVideoMaxBytes = () => Math.floor((Number(process.env.MOMENT_UNREAD_VIDEO_MB || 4) || 4) * 1024 * 1024);
/** Seconds in an MP4/MOV (from its mvhd box) or a WebM (its Duration element), or 0 when the file doesn't say. */
export function videoSeconds(buf) {
  try {
    const i = buf.indexOf("mvhd"); if (i > 3 && buf.length > i + 36) { const v = buf[i + 4];
      const scale = v === 1 ? buf.readUInt32BE(i + 24) : buf.readUInt32BE(i + 16), dur = v === 1 ? Number(buf.readBigUInt64BE(i + 28)) : buf.readUInt32BE(i + 20);
      if (scale > 0 && dur > 0 && dur < 2 ** 52) return dur / scale; }
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) { // EBML: Duration (0x4489) as a float, in TimecodeScale units (1 ms by default)
      const head = buf.subarray(0, Math.min(buf.length, 8192)); let scale = 1e6; const t = head.indexOf(Buffer.from([0x2a, 0xd7, 0xb1]));
      if (t >= 0) { const sz = head[t + 3] & 0x7f; if (sz >= 1 && sz <= 4) scale = head.readUIntBE(t + 4, sz); }
      const d = head.indexOf(Buffer.from([0x44, 0x89])); if (d >= 0) { const sz = head[d + 2]; const ms = sz === 0x84 ? head.readFloatBE(d + 3) : sz === 0x88 ? head.readDoubleBE(d + 3) : 0; if (ms > 0 && isFinite(ms)) return (ms * scale) / 1e9; }
    }
  } catch {}
  return 0;
}
// ---------- who can see an event's moments ----------
/** Open to anyone: on Discover, not Ask to join, photos allowed. The public feed and signed-out stories use only these. */
// private and friends-only events never reach strangers, whatever their other switches say (photo drops, recap stories)
const closed = (e) => !!e && (e.private === true || e.friendsOnly === true || e.visibility === "private" || e.visibility === "friends");
export const momentsPublic = (e) => !!e && !closed(e) && !!e.discoverable && !e.unlisted && !e.approvalRequired && !e.noPhotos && !e.cancelled && !e.example;
/** On the host's page: open events (unlisted ones too, they're on the page), or any event when the host turned it on. */
export const momentsOnPage = (e) => !!e && !e.noPhotos && !e.cancelled && ((!!e.discoverable && !e.approvalRequired) || e.momentsOnPage === true);
/** An event card (title, flyer, when) may show to strangers: it's on Discover. Its photos follow momentsPublic. */
const cardPublic = (e) => !!e && !closed(e) && !!e.discoverable && !e.unlisted && !e.cancelled && !e.example;

const MEDIA_OK = (u) => /^\/_blob\/[A-Za-z0-9]{20}$/.test(u || "") || /^\/presets\/[a-z0-9-]{1,60}\.(jpg|webp|png)$/.test(u || "");
export const REACTIONS = ["🔥", "😍", "🥟", "🙌"];

import { togetherOf } from "./comewith.js"; // "Come with me?": "Mia and Jo are in" on a card
import { hostedCount, countLine, isPublicEvent } from "./hostlike.js"; // "Host one like this": "3 people hosted this after seeing it"
import { seriesKey } from "./episodes.js"; // one card per series: the next episode coming up, the latest one past
import { mountFeedBlend } from "./feedblend.js"; // the blended feed: events, recaps, milestones, who to follow, ideas
import { mountFindPeople } from "./findpeople.js"; // Find people: search, suggestions, contacts, your code
export function makeFeedVisual(store, { C, X }) {
  // One pass over the index per rebuild: moments, kudos and who came grouped by event (and moments by workspace), and each
  // workspace's host card and sample flag read once, so building a card no longer scans every moment and guest list.
  const groups = new WeakMap();
  // writes that change what the feed shows: a host page (system/ws-), an event, reply, photo, kudos, badge or reaction
  let wsGen = 0, feedGen = 0;
  store.events?.on?.("change", (e) => { const p = String(e?.path || ""); if (p.startsWith("system/ws-")) wsGen++;
    if (/^system\/(ws|reacts|handle|feedkudos|feedcom|modhide|prefs)-/.test(p) || /(^|\/)(events|rsvps|moments|kudos|vibes|reviews)\/[^/]+$/.test(p)) feedGen++; });
  function G(I) { let g = groups.get(I); if (g && g.gen !== wsGen) { g.gen = wsGen; g.host = new Map(); g.sample = new Map(); } if (g) return g;
    g = { gen: wsGen, mom: new Map(), momWs: new Map(), kud: new Map(), came: new Map(), host: new Map(), sample: new Map(), when: new Map() };
    const push = (M, k, v) => { let L = M.get(k); if (!L) M.set(k, (L = [])); L.push(v); };
    for (const m of I.moments) { push(g.mom, m.eventId, m); const ws = I.events.get(m.eventId)?.ws; if (ws) push(g.momWs, ws, m); }
    for (const k of I.kudos) push(g.kud, k.eventId, k);
    for (const L of I.att.values()) for (const id of new Set(L.map((a) => a.eventId))) g.came.set(id, (g.came.get(id) || 0) + 1);
    groups.set(I, g); return g; }
  const momentsOf = (I, id) => G(I).mom.get(id) || [], kudosOf = (I, id) => G(I).kud.get(id) || [];
  const memo = (M, k, f) => { if (M.has(k)) return M.get(k); const v = f(); M.set(k, v); return v; };
  const sample = (ws, I = X.index()) => memo(G(I).sample, ws, () => /@demo\.encore$/i.test(getWorkspace(ws)?.ownerEmail || ""));
  const hostOf = (ws, I = X.index()) => memo(G(I).host, ws, () => hostOf0(ws));
  function hostOf0(ws) { const h = C.profileOf(ws); if (!h?.handle) return null;
    return { handle: h.handle, name: h.name || h.handle, emoji: h.emoji || "🎉", color: h.theme?.accent || h.color || "#E26D8E", kit: C.kitOf ? C.kitOf(ws) : kitJson(h) /* brand kit: story cards take its face and accent */, avatarArt: h.theme?.avatarArt || "", avatarUrl: MEDIA_OK(h.theme?.avatarUrl) || /^\/presets\/[a-z0-9-]+\.svg$/.test(h.theme?.avatarUrl || "") ? h.theme.avatarUrl : "" }; }
  const lookOf = (e) => { const L = cleanLook(e?.look) || {}; const o = {}; for (const k of ["palette", "coverFit", "coverW", "coverH", "effect", "titleFont", "buttonEmoji", "buttonLabel", "lights", "vibe", "kit", "ownFont"]) if (L[k] != null) o[k] = L[k]; return o; };
  const artOf = (e) => { const a = e?.coverArt; if (!a || typeof a !== "object") return null; const o = {}; if (typeof a.kind === "string") o.kind = a.kind.slice(0, 40); if (typeof a.tone === "string") o.tone = a.tone.slice(0, 20); if (typeof a.label === "string") o.label = clean(a.label, 40); if (typeof a.svg === "string" && /^<svg /.test(a.svg) && a.svg.length < 40000) o.svg = a.svg; return o; };
  const momentOut = (m) => ({ id: m.id, url: m.url, type: m.type, ...(MEDIA_OK(m.poster) ? { poster: m.poster } : {}), ...(m.w && m.h ? { w: m.w, h: m.h } : {}), caption: String(m.caption || "").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "…").replace(/\(?(?:\+?\d[\s().-]*){7,}\d/g, "…"), by: first(m.authorName) || "", at: m.at || 0 });
  // ---------- what a card or story's button does: the most direct place to act, never a generic host page ----------
  // an event: its light invite (/e/<id>), worded for what the guest does there
  const eventCta = (e, id) => ({ label: e?.preorder ? "Order" : e?.stage === "interest" ? "I'd go" : e?.approvalRequired ? "Ask to join" : "I'm in", url: `/e/${encodeURIComponent(id)}` });
  // a real host's first team experience, when they take requests: its own page with the request form (/x/<handle>/<id>)
  const bookOf = (ws, I = X.index()) => { if (sample(ws, I)) return null; const P = C.profileOf(ws), x = P?.handle && P.forHire ? (P.experiences || []).find((y) => y?.id && y.name) : null;
    return x ? { label: "Book for your team", url: `/x/${P.handle}/${encodeURIComponent(x.id)}` } : null; };
  // after an event: the host's next date, else something to book, else Follow (the one button that may open their page)
  const afterCta = (I, x, t = today()) => { const n = nextOf(I, x, t); if (n) return { label: n.approvalRequired ? "Ask to join" : "I'm in", url: n.url };
    const b = bookOf(x.ws, I); if (b) return b; const h = hostOf(x.ws, I); return h ? { label: "Follow", url: `/@${h.handle}`, follow: h.handle } : { label: "I'm in", url: `/e/${encodeURIComponent(x.id)}` }; };
  // the people who were at an event: its host and every guest who was in
  const wasThere = (I, id, email) => { if (!email) return false; const x = I.events.get(id); return !!x && (lc(x.owner) === email || (I.att.get(email) || []).some((a) => a.eventId === id)); };
  const momentSeen = (I, m, email) => { if (!m || m.hidden) return false; const x = I.events.get(m.eventId); if (!x) return false; return momentsPublic(x.e) || wasThere(I, m.eventId, email); };
  // ---------- reactions (🔥 😍 🥟 🙌 on past events): counts per event, one of each per person or device ----------
  const rKey = (k) => "reacts-" + hashKey(k);
  const reactsOf = (k) => store.get("system/" + rKey(k))?.data?.counts || {};
  function react(k, who, emoji) { const d = store.get("system/" + rKey(k))?.data || { kind: "reacts", key: k, counts: {}, by: {} }, w = hashKey(who), mine = new Set(d.by[w] || []);
    if (mine.has(emoji)) { mine.delete(emoji); d.counts[emoji] = Math.max(0, (d.counts[emoji] || 1) - 1); } else { mine.add(emoji); d.counts[emoji] = (d.counts[emoji] || 0) + 1; }
    d.by[w] = [...mine]; if (!d.by[w].length) delete d.by[w]; const keys = Object.keys(d.by); if (keys.length > 5000) for (const x of keys.slice(0, keys.length - 5000)) delete d.by[x];
    store.set("system/" + rKey(k), d); return { counts: d.counts, mine: [...mine] }; }
  const myReacts = (k, who) => (who ? store.get("system/" + rKey(k))?.data?.by?.[hashKey(who)] || [] : []);

  /** One event as a card: the flyer or cover, its look, the host, and for past events the photos people can see. */
  function card(I, x, { email = "", device = "" } = {}) {
    const e = x.e, past = !!e.date && e.date < today(), h = hostOf(x.ws, I), going = past ? 0 : (C.goingOf(x.ws, x.id, e).going || 0);
    const photos = momentsOf(I, x.id).filter((m) => momentSeen(I, m, email)).sort((a, b) => (a.at || 0) - (b.at || 0)).slice(0, 12).map(momentOut);
    const K = kudosOf(I, x.id).filter((k) => k.love || (k.tags || []).length), rq = past ? X.reviewQuote?.(x, email) : null /* reviews hook: a written review is the quote when there is one (server/reviews.js) */, q = K.filter((k) => k.love && k.verified).sort((a, b) => (b.verified === "guest_list") - (a.verified === "guest_list") || b.love.length - a.love.length)[0];
    const came = G(I).came.get(x.id) || 0;
    const cap = +e.headcount || 0;
    return { id: x.id, etype: typeOf(e), title: e.pubTitle || e.name || "", date: e.date || "", startTime: e.startTime || "", city: e.city || "", hood: e.hood || "", emoji: e.emoji || "", activity: e.activity || "", free: !!(e.free || !e.price), price: e.price || "",
      ...(e.drop ? { drop: true, pickup: globalThis.PLPickup.line(e), free: false } : {}), // a drop reads Pickup, never an event date
      approvalRequired: !!e.approvalRequired, past, cover: MEDIA_OK(e.coverPhoto) ? e.coverPhoto : e.drop ? (e.orderItems || []).map((it) => (it.photos || [])[0] || it.photo || "").find(MEDIA_OK) || "" : "", coverArt: artOf(e), coverSpec: coverOf(e, x.id), look: lookOf(e), host: h, url: e.drop ? `/e/${encodeURIComponent(x.id)}` : `/g#rsvp-${encodeURIComponent(x.id)}`, page: h ? `/@${h.handle}` : "",
      ...(sample(x.ws, I) ? { sample: true } : {}), ...(past ? { came, kudos: K.length, photos, newPhotos: photos.filter((m) => m.at > Date.now() - 3 * DAY).length /* photo drops: "5 new photos" */, ...(rq ? { quote: rq } : q ? { quote: { text: scrub(q.love).slice(0, 220), name: first(q.name) || "A guest", verifiedLabel: q.verified === "guest_list" ? "Came, on the guest list" : "Replied I'm in" } } : {}), reacts: reactsOf(x.id), myReacts: myReacts(x.id, email || device) } : { going, ...(cap && going ? { spotsLeft: Math.max(0, cap - going) } : {}) }),
      ...(() => { try { if (!isPublicEvent(e)) return {}; if (past) { const n = hostedCount(store, x.id); return n ? { hostedAfter: n, hostedLine: countLine(n) } : {}; }
        const T = togetherOf(scopeStore(store, x.ws).listShared("rsvps"), e, x.id); /* read only: parsed once per change (server/db.js) */ return T.length ? { together: T.slice(0, 2) } : {}; } catch { return {}; } })(),
      fresh: (Date.now() - (e.createdAt || e.updatedAt || 0)) < 4 * DAY, cta: email && lc(x.owner || "") === email ? { label: "Manage", url: `/?app=1&open=${encodeURIComponent(x.id)}#studio`, own: true } /* the host's own event: not I'm in */ : past ? afterCta(I, x) : eventCta(e, x.id) };
  }
  // ---------- prepared pages ----------
  let SC = null;
  function showcases() { if (SC && Date.now() - SC.at < 60_000) return SC.list; const list = [];
    try { for (const f of JSON.parse(fs.readFileSync(path.join(PRESETS, "showcase.json"), "utf8"))) { if (!/^[a-z0-9-]{1,40}$/.test(f)) continue; let handle = f; try { handle = lc(JSON.parse(fs.readFileSync(path.join(PRESETS, f + ".json"), "utf8")).handle || f); } catch {}
      const P = C.showcaseOf(handle); if (!P) continue; // claimed pages show as real hosts instead
      const host = { handle: P.handle, name: P.name, emoji: P.emoji || "🎉", color: P.theme?.accent || P.color || "#E26D8E", avatarArt: P.theme?.avatarArt || "", avatarUrl: /^\/presets\/[a-z0-9-]+\.(svg|jpg|png)$/.test(P.theme?.avatarUrl || "") ? P.theme.avatarUrl : "" };
      const past = (P.scrapbook || []).slice(0, 8).map((s, i) => ({ id: `sc-${P.handle}-${i}`, title: clean(s.title, 120), date: s.date || "", place: clean(s.place, 80), note: clean(s.note || s.about, 200), cover: MEDIA_OK(s.cover) ? s.cover : "", photos: (s.photos || []).filter(MEDIA_OK).slice(0, 6) }));
      // nothing here can be booked yet: every button is "I'm interested", on that one thing's own page (server/interest.js)
      const exps = (P.experiences || []).slice(0, 4).map((x, i) => ({ id: `sx-${P.handle}-${i}`, title: clean(x.name, 100), desc: clean(x.desc, 200), emoji: clean(x.emoji, 8), price: clean(x.price, 40), category: clean(x.category, 30), url: `/x/${P.handle}/${encodeURIComponent(x.id || "x" + i)}` }));
      const firstUrl = exps[0]?.url || ((P.gifts || [])[0] ? `/x/${P.handle}/${encodeURIComponent(P.gifts[0].id || "g0")}` : (P.shop?.items || []).length ? `/x/${P.handle}/shop/0` : `/x/${P.handle}/any`);
      list.push({ host, tagline: clean(P.tagline, 160), city: clean(P.city, 60), hood: clean(P.hood, 60), example: !!P.example, past, experiences: exps, page: `/@${P.handle}`, cta: { label: "I'm interested", url: firstUrl } }); } } catch {}
    SC = { at: Date.now(), list }; return list; }
  // the ones allowed into the feed, stories and deck (made-up examples, and ENCORE_FEED_PREVIEWS)
  const listedShowcases = () => showcases().filter((S) => previewListed(S.host.handle, S));

  // how well a card fits what a visitor picked (pl.interests: interest ids and a city): interests count most, then the city
  const fitOf = (P, text, place) => { let n = 0; if (P.interests.length) { const T = interestsOf(text, ""); n += P.interests.filter((i) => T.includes(i)).length * 3; } if (P.city && lc(place).includes(P.city)) n += 2; return n; };
  /** Everything for the feed's visual sections, for one viewer (email "" when signed out). interests and city order it. */
  function sections({ email = "", device = "", interests = [], city = "" } = {}) {
    const I = X.index(), now = Date.now(), t = today(now), all = [...I.events.values()].filter((x) => hostOf(x.ws, I));
    const P = { interests: cleanInterests(interests), city: lc(clean(city, 60)) }, fit = (x) => fitOf(P, `${x.e.pubTitle || x.e.name || ""} ${x.e.activity || ""} ${x.e.format || ""}`, `${x.e.city || ""} ${x.e.hood || ""}`);
    // the feed is a short weekly read, not a listing: real events first, the visitor's city before anywhere else, then fit and
    // date; one card per series (its next episode) and 12 at most
    const local = (x) => (P.city && lc(`${x.e.city || ""} ${x.e.hood || ""}`).includes(P.city) ? 1 : 0), once = new Set();
    const oneEach = (x) => { const k = x.ws + "|" + (seriesKey(x.e.pubTitle || x.e.name) || x.id); if (once.has(k)) return false; once.add(k); return true; };
    const upcoming = all.filter((x) => cardPublic(x.e) && (x.e.date || "") >= t && x.e.stage !== "interest").sort((a, b) => (sample(a.ws, I) - sample(b.ws, I)) || local(b) - local(a) || fit(b) - fit(a) || String(a.e.date).localeCompare(String(b.e.date))).filter(oneEach).slice(0, 12).map((x) => card(I, x, { email, device }));
    // a quiet city still has something coming up: Discover's example events, marked as examples, after the real ones
    if (upcoming.length < 6) { try { const have = new Set(upcoming.map((e) => e.id)); for (const d of C.discover().events || []) { if (upcoming.length >= 8) break; if (!d?.id || have.has(d.id) || !d.host?.handle || d.unlisted || (d.date && d.date < t)) continue; have.add(d.id);
      upcoming.push({ id: d.id, title: d.title || d.name || "", date: d.date || "", startTime: d.startTime || "", city: d.city || "", hood: d.hood || "", emoji: d.emoji || "", activity: d.activity || "", approvalRequired: !!d.approvalRequired, past: false, cover: MEDIA_OK(d.coverPhoto) ? d.coverPhoto : "", coverArt: artOf(d), look: {}, host: { handle: d.host.handle, name: d.host.name, emoji: d.host.emoji || "🎉", color: d.host.color || "#E26D8E", avatarArt: d.host.avatarArt || "", avatarUrl: "" }, url: `/g#rsvp-${encodeURIComponent(d.id)}`, page: `/@${d.host.handle}`, going: d.going || 0, sample: !!d.sample, fresh: false, cta: eventCta(d, d.id) }); } } catch {} }
    // example (sample) events stay only while they're recent: an old example isn't what people are hosting
    const fresh = now - SHOWCASE_FRESH_DAYS * DAY;
    const pastX = all.filter((x) => x.e.date && x.e.date < t && Date.parse(x.e.date) > now - 120 * DAY && (cardPublic(x.e) || wasThere(I, x.id, email)) && !x.e.cancelled && !(sample(x.ws, I) && Date.parse(x.e.date) < fresh));
    const fitC = (c) => fitOf(P, `${c.title} ${c.activity}`, `${c.city} ${c.hood}`);
    // ordered on what's known before a card is built (has photos this viewer may see, example, fit, newest), then only 12 built
    const pastK = pastX.map((x) => ({ x, ph: momentsOf(I, x.id).some((m) => momentSeen(I, m, email)), sm: sample(x.ws, I), fit: fitOf(P, `${x.e.pubTitle || x.e.name || ""} ${x.e.activity || ""}`, `${x.e.city || ""} ${x.e.hood || ""}`), date: x.e.date || "" }));
    once.clear(); // past: the latest episode with photos stands for its series
    const past = pastK.sort((a, b) => (b.ph - a.ph) || (a.sm - b.sm) || b.fit - a.fit || String(b.date).localeCompare(String(a.date))).filter((k) => oneEach(k.x)).slice(0, 12).map((k) => card(I, k.x, { email, device }));
    const near = (c) => (P.city && nearTo(P.city, c) ? 1 : 0);
    if (P.interests.length || P.city) upcoming.sort((a, b) => (!!a.sample - !!b.sample) || near(b) - near(a) || fitC(b) - fitC(a) || String(a.date).localeCompare(String(b.date)));
    const moments = I.moments.filter((m) => m.at > now - 30 * DAY && momentSeen(I, m, email)).sort((a, b) => b.at - a.at).slice(0, 12).map((m) => { const x = I.events.get(m.eventId); return { ...momentOut(m), event: { id: x.id, title: x.e.pubTitle || x.e.name || "", date: x.e.date || "", host: hostOf(x.ws, I), page: hostOf(x.ws, I) ? `/@${hostOf(x.ws, I).handle}` : "", cta: (x.e.date || "") >= t ? eventCta(x.e, x.id) : afterCta(I, x, t) } }; });
    const kudos = I.kudos.filter((k) => k.love && k.verified && cardPublic(I.events.get(k.eventId)?.e) && k.at > now - 120 * DAY).sort((a, b) => b.at - a.at).slice(0, 8).map((k) => { const x = I.events.get(k.eventId), h = hostOf(x.ws, I);
      return { id: k.id, text: scrub(k.love).slice(0, 240), name: first(k.name) || "A guest", tags: (k.tags || []).slice(0, 3), verifiedLabel: k.verified === "guest_list" ? "Came, on the guest list" : "Replied I'm in", event: { id: x.id, title: x.e.pubTitle || x.e.name || "", host: h, page: h ? `/@${h.handle}` : "" } }; });
    // prepared pages: what they did in the last two weeks stays with the real content; older things become ideas to try
    const isFresh = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "") && Date.parse(d) >= fresh, ideas = [];
    const showcase = listedShowcases().map((S) => { for (const p of S.past) if (!isFresh(p.date) && (p.cover || p.photos.length)) ideas.push({ id: p.id, title: p.title, note: p.note, cover: p.cover || p.photos[0] || "", host: S.host, page: S.page, cta: S.cta, city: S.city, example: true, fit: fitOf(P, `${p.title} ${p.note}`, `${S.city} ${S.hood}`) });
        return { ...S, past: S.past.filter((p) => isFresh(p.date)), fit: fitOf(P, `${S.tagline} ${S.experiences.map((x) => `${x.title} ${x.category} ${x.desc}`).join(" ")}`, `${S.city} ${S.hood}`) }; })
      .sort((a, b) => b.fit - a.fit).map(({ fit, ...S }) => S);
    ideas.sort((a, b) => b.fit - a.fit);
    return { upcoming, past, moments, kudos, showcase, ideas: ideas.slice(0, 8).map(({ fit, ...x }) => x), picked: { interests: P.interests, city: P.city ? clean(city, 60) : "" } };
  }
  // ---------- recap stories: a past event with 3+ photos and kudos between them gets one story on its host's ring ----------
  // Made here, on the server, the first time the event qualifies (within 3 days of it ending), then shown for 24 hours from
  // when it was made: a title card ("14 came"), the photos, the best kudos quote, and an ending card with "I'm in" for the
  // host's next date or "Follow". Strangers see recaps of open events only (momentsPublic); people who were there see
  // their own events' recaps too. Every photo still goes through momentSeen, and the quote is scrubbed.
  const recapKey = (id) => "system/recap-" + hashKey("recap:" + id);
  const norm = (s) => lc(s).replace(/[^a-z0-9]+/g, " ").trim();
  /** The host's next public date: the same event's next date first, else their next one. */
  function nextOf(I, x, t) { const name = norm(x.e.pubTitle || x.e.name);
    const L = [...I.events.values()].filter((y) => y.ws === x.ws && y.id !== x.id && cardPublic(y.e) && (y.e.date || "") >= t && y.e.stage !== "interest")
      .sort((a, b) => ((norm(b.e.pubTitle || b.e.name) === name) - (norm(a.e.pubTitle || a.e.name) === name)) || String(a.e.date).localeCompare(String(b.e.date)));
    const y = L[0]; return y ? { id: y.id, title: y.e.pubTitle || y.e.name || "", date: y.e.date, startTime: y.e.startTime || "", url: `/e/${encodeURIComponent(y.id)}`, approvalRequired: !!y.e.approvalRequired, cover: MEDIA_OK(y.e.coverPhoto) ? y.e.coverPhoto : "" } : null; }
  // "14 came": guests who were in, one per person, not marked a no-show (the host's own list wins over replies)
  function cameTo(x) { const seen = new Set(); try { for (const d of scopeStore(store, x.ws).list("rsvps")) { const r = d.data || {}; if (r.eventId !== x.id || r.response !== "going" || r.noShow === true) continue; seen.add(lc(r.email) || lc(r.phone) || d.id); } } catch {}
    for (const g of x.e.guests || []) if (/Going|Attended/.test(g.status || "") && !/no.?show/i.test(g.status || "")) seen.add(lc(g.email) || lc(g.name)); return seen.size; }
  /** One event's recap story for this viewer, or null. Makes (stores) the recap the first time it qualifies. */
  function recapOf(I, x, { email = "", now = Date.now() } = {}) {
    const e = x.e, t = today(now); if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(e.date || "") || e.date >= t || e.cancelled || e.example || e.stage === "interest") return null;
    if (!momentsPublic(e) && !wasThere(I, x.id, email)) return null;
    const photos = momentsOf(I, x.id).filter((m) => momentSeen(I, m, email)).sort((a, b) => (a.at || 0) - (b.at || 0));
    const K = kudosOf(I, x.id).filter((k) => k.love || (k.tags || []).length);
    if (photos.length + K.length < RECAP_MIN) return null;
    let d = store.get(recapKey(x.id))?.data;
    if (!d) { const end = /^\d{4}-\d{2}-\d{2}$/.test(e.endDate || "") && e.endDate >= e.date ? e.endDate : e.date; if (now - (Date.parse(end + "T12:00:00Z") + DAY) > RECAP_WINDOW) return null;
      d = { kind: "recap", eventId: x.id, madeAt: now, photos: photos.length, kudos: K.length }; store.set(recapKey(x.id), d); }
    if (now < d.madeAt || now - d.madeAt > RECAP_SHOWS) return null;
    const c = card(I, x, { email }), h = c.host; if (!h) return null;
    const label = [c.title, new Date(e.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" })].filter(Boolean).join(" · ");
    const P = photos.slice(-6).map(momentOut), still = P.find((m) => m.type === "image")?.url || P.find((m) => m.poster)?.poster || (MEDIA_OK(e.coverPhoto) ? e.coverPhoto : "");
    const see = c.cta; // the next date, something to book, or Follow
    const items = [{ id: `r:${x.id}:t`, type: "recap", ev: x.id, recap: { title: c.title, date: e.date, came: cameTo(x), photos: photos.length, kudos: K.length, where: e.hood || e.city || "", cover: still, art: { title: c.title, activity: e.activity || "", coverArt: artOf(e), id: x.id } }, look: lookOf(e), caption: label, at: d.madeAt, past: true, cta: see }];
    for (const m of P) items.push({ id: `r:${x.id}:m:${m.id}`, type: m.type === "video" ? "video" : "image", ev: x.id, url: m.url, ...(m.poster ? { poster: m.poster } : {}), caption: label, note: m.caption, by: m.by, at: d.madeAt, past: true, cta: see });
    if (c.quote) items.push({ id: `r:${x.id}:q`, type: "quote", ev: x.id, quote: c.quote, caption: label, at: d.madeAt, past: true, cta: see });
    const next = nextOf(I, x, t);
    items.push({ id: `r:${x.id}:e`, type: "end", ev: x.id, end: { title: c.title, next }, caption: label, at: d.madeAt, past: true,
      cta: next ? { label: next.approvalRequired ? "Ask to join" : "I'm in", url: next.url } : { label: "Follow", url: c.page || c.url, follow: h.handle } });
    return { eventId: x.id, madeAt: d.madeAt, host: h, items, thumb: still };
  }
  /** A real photo for a host's ring when their stories are only flyers or art: their newest photo anyone may see, or a cover. */
  function photoOf(I, ws, email) { const m = (G(I).momWs.get(ws) || []).filter((y) => momentSeen(I, y, email) && (y.type === "image" || MEDIA_OK(y.poster))).sort((a, b) => (b.at || 0) - (a.at || 0))[0];
    if (m) return m.type === "image" ? m.url : m.poster;
    const x = [...I.events.values()].find((y) => y.ws === ws && cardPublic(y.e) && MEDIA_OK(y.e.coverPhoto)); return x ? x.e.coverPhoto : ""; }
  /** Stories: one circle per host with photos, videos or flyers from the last 14 days, and recap stories, newest first. */
  function stories({ email = "", following = [], now = Date.now() } = {}) {
    const I = X.index(), since = now - 14 * DAY, t = today(now), by = new Map();
    const add = (ws, it) => { const h = hostOf(ws, I); if (!h) return null; if (!by.has(h.handle)) by.set(h.handle, { key: "h:" + h.handle, host: h, items: [], showcase: false, _ws: ws, ...(sample(ws, I) ? { sample: true } : {}) }); if (it) by.get(h.handle).items.push(it); return by.get(h.handle); };
    const CT = new Map(), ctaOf = (x) => memo(CT, x.id, () => ((x.e.date || "") >= t ? eventCta(x.e, x.id) : afterCta(I, x, t)));
    const when = (e) => memo(G(I).when, e.date || "", () => { const d = e.date ? new Date(e.date + "T12:00:00") : null; return d && !isNaN(d) ? d.toLocaleDateString("en-US", { weekday: "short" }) : ""; });
    for (const m of I.moments) { if (!(m.at > since) || !momentSeen(I, m, email)) continue; const x = I.events.get(m.eventId);
      add(x.ws, { id: "m:" + m.id, ev: x.id, type: m.type === "video" ? "video" : "image", url: m.url, ...(MEDIA_OK(m.poster) ? { poster: m.poster } : {}), thumb: m.type === "video" ? (MEDIA_OK(m.poster) ? m.poster : "") : m.url, caption: [x.e.pubTitle || x.e.name, when(x.e)].filter(Boolean).join(" · "), note: momentOut(m).caption, by: first(m.authorName) || "", at: m.at, past: true, cta: ctaOf(x) }); }
    for (const x of I.events.values()) { const e = x.e; if (!cardPublic(e) && !wasThere(I, x.id, email)) continue; const at = e.updatedAt || e.createdAt || 0, up = (e.date || "") >= t;
      if (up && (at > since || Date.parse(e.date) - now < 21 * DAY)) add(x.ws, { id: "f:" + x.id, type: MEDIA_OK(e.coverPhoto) ? "image" : "art", url: MEDIA_OK(e.coverPhoto) ? e.coverPhoto : "", thumb: MEDIA_OK(e.coverPhoto) ? e.coverPhoto : "", art: { title: e.pubTitle || e.name || "", activity: e.activity || "", coverArt: artOf(e), date: e.date || "", id: x.id }, look: lookOf(e), caption: [e.pubTitle || e.name, when(e)].filter(Boolean).join(" · "), at: Math.max(at, since + 1), past: false, cta: eventCta(e, x.id) });
      else if (!up && e.date && Date.parse(e.date) > since && MEDIA_OK(e.coverPhoto) && momentsOnPage(e)) add(x.ws, { id: "c:" + x.id, ev: x.id, type: "image", url: e.coverPhoto, thumb: e.coverPhoto, caption: [e.pubTitle || e.name, when(e)].filter(Boolean).join(" · "), at: Date.parse(e.date) + 20 * 3600e3, past: true, cta: ctaOf(x) });
      // a recap goes first on the host's ring (its photos aren't shown twice)
      const R = !up ? recapOf(I, x, { email, now }) : null; if (R) { const s = add(x.ws, null); if (s) (s.recaps ||= []).push(R); } }
    const F = new Set(following); let L = [...by.values()].map((s) => { const R = (s.recaps || []).sort((a, b) => b.madeAt - a.madeAt), done = new Set(R.map((r) => r.eventId));
      s.items.sort((a, b) => (!!a.past === !!b.past ? a.at - b.at : a.past ? -1 : 1)); /* what happened, oldest first, then what's next */
      const rest = s.items.filter((i) => !(i.ev && done.has(i.ev))); s.items = [...R.flatMap((r) => r.items).slice(0, 14), ...rest.filter((i) => i.past).slice(-7), ...rest.filter((i) => !i.past).slice(0, 3)];
      s.latestAt = Math.max(0, ...s.items.map((i) => i.at)); s.thumb = (MEDIA_OK(s.host?.avatarUrl) ? s.host.avatarUrl : "") /* the host's own profile picture on their ring, like a face */ || R[0]?.thumb || (s.items.slice().reverse().find((i) => i.thumb) || {}).thumb || photoOf(I, s._ws, email);
      if (R.length) s.recap = { eventId: R[0].eventId, title: R[0].items[0].recap.title };
      delete s.recaps; delete s._ws; return s; }).filter((s) => s.items.length)
      .sort((a, b) => (F.has(b.host.handle) - F.has(a.host.handle)) || (!!b.recap - !!a.recap) || (!!a.sample - !!b.sample) || b.latestAt - a.latestAt).slice(0, 20);
    // a quiet week still has something to tap: prepared pages, with their covers and illustrated art
    if (L.filter((s) => !s.sample).length < 6) for (const P of listedShowcases()) { if (L.length >= 12) break; const items = [];
      for (const p of P.past) items.push(p.cover ? { id: "s:" + p.id, type: "image", url: p.cover, thumb: p.cover, caption: [p.title, p.place].filter(Boolean).join(" · "), at: 0, past: true, cta: P.cta } : { id: "s:" + p.id, type: "art", url: "", thumb: "", art: { title: p.title, activity: p.title, id: p.id }, caption: [p.title, p.place].filter(Boolean).join(" · "), at: 0, past: true, cta: P.cta });
      for (const x of P.experiences) items.push({ id: "s:" + x.id, type: "art", url: "", thumb: "", art: { title: x.title, activity: `${x.title} ${x.category}`, id: x.id }, caption: x.title + (x.price ? " · " + x.price : ""), note: x.desc, at: 0, past: false, cta: { label: "I'm interested", url: x.url } });
      // a real photo on the ring when the page has one anywhere (covers or scrapbook photos), else the drawing
      const pic = (items.find((i) => i.thumb) || {}).thumb || (P.past.find((p) => p.photos.length) || {}).photos?.[0] || "";
      if (items.length) L.push({ key: "s:" + P.host.handle, host: P.host, items: items.slice(0, 6), latestAt: 0, thumb: pic, showcase: true, ...(P.example ? { example: true } : {}) }); }
    return L;
  }
  // near the visitor: the event's neighborhood, its city, or (when it has no city) its host's home city ("Greenpoint" events of a Brooklyn host)
  const hostCity = (e) => { const ws = e.host?.handle && C?.wsOfHandle?.(e.host.handle); return (ws && C.profileOf(ws)?.city) || ""; };
  const nearTo = (C0, e) => !!C0 && [e.city, e.hood, e.city ? "" : hostCity(e)].map((v) => lc(v || "")).filter((v) => v.length >= 2).some((v) => v.includes(C0) || (v.length >= 4 && C0.includes(v)));
  // ---------- the swipe deck: a first visit to /feed, one card at a time ----------
  // Real upcoming events in the visitor's city first, then ideas to try (the /ideas library) and photos from hosts'
  // pages, then events elsewhere. Every card says what it is (Example, Idea) and carries the interest ids it trains.
  function deck({ city = "", interests = [], email = "", ideas = [], limit = 12 } = {}) {
    const V = sections({ email, interests, city }), C0 = lc(clean(city, 60)), here = (e) => nearTo(C0, e), wk = today(Date.now() + 7 * DAY);
    const tagsOf = (text, fmt = "") => interestsOf(text, fmt).slice(0, 4);
    const ev = (e) => ({ key: "e:" + e.id, kind: "event", ref: e.id, title: e.title, when: e.date, startTime: e.startTime || "", where: e.hood || e.city || "", city: e.city || "", price: e.free ? "Free" : e.price || "", img: e.cover || "", art: { id: e.id, title: e.title, activity: e.activity || "", coverArt: e.coverArt || null }, look: e.look || {}, host: e.host, url: e.url, going: e.going || 0, approvalRequired: !!e.approvalRequired,
      badge: e.sample ? "Example" : e.date <= wk ? "This week" : "", example: !!e.sample, tags: tagsOf(`${e.title} ${e.activity || ""}`), local: here(e) });
    const up = (V.upcoming || []).filter((e) => e.id && !e.past), real = up.filter((e) => !e.sample);
    const lead = (C0 ? real.filter(here) : real).map(ev), later = [...(C0 ? real.filter((e) => !here(e)) : []), ...up.filter((e) => e.sample)].map(ev);
    const idea = (x) => ({ key: "i:" + x.id, kind: "idea", ref: x.id, title: x.title, line: x.line || "", img: "", art: { id: x.id, title: x.title, activity: x.title, coverArt: x.art ? { kind: x.art, tone: x.tone } : null }, look: {}, url: "/ideas#" + x.id, badge: "Idea", tags: (x.interests || []).slice(0, 4), ...(x.sourceLine ? { source: x.source, sourceLine: x.sourceLine } : {}) }); // trends: who vouches for it
    const pic = (P, p) => ({ key: "p:" + p.id, kind: "host", ref: P.host.handle, title: p.title, line: p.note || "", img: p.cover || p.photos[0] || "", art: { id: p.id, title: p.title, activity: p.title }, look: {}, host: P.host, url: P.cta?.url || P.page, where: P.city || "", badge: P.example ? "Example" : "Preview", example: !!P.example, tags: tagsOf(`${p.title} ${p.note || ""}`) });
    const I0 = cleanInterests(interests), ideaL = (Array.isArray(ideas) ? ideas : []).filter((x) => x?.id && x.title).map((x, i) => ({ x, i, s: I0.length && (x.interests || []).some((k) => I0.includes(k)) ? 1 : 0 }))
      .sort((a, b) => ((+b.x.rank || 0) + b.s * 0.5) - ((+a.x.rank || 0) + a.s * 0.5) || (parseInt(hashKey(a.x.id + today()).slice(0, 6), 16) - parseInt(hashKey(b.x.id + today()).slice(0, 6), 16))).map(({ x }) => idea(x)); // a steady daily shuffle
    // launch review: no old photos from preview pages ("7.26 1st pop up"): real upcoming events lead, then ideas
    const pics = [];
    // ideas and photos side by side, so after the real events the deck alternates a photo and an illustrated idea
    const mid = []; for (let i = 0; i < Math.max(ideaL.length, pics.length) && mid.length < limit; i++) { if (pics[i]) mid.push(pics[i]); if (ideaL[i]) mid.push(ideaL[i]); }
    const out = [], seenK = new Set(); for (const c of [...lead, ...mid, ...later]) { if (out.length >= limit || seenK.has(c.key)) continue; seenK.add(c.key); out.push(c); }
    return { cards: out, city: C0 ? clean(city, 60) : "", local: lead.length };
  }
  return { gen: () => feedGen, sections, stories, recapOf, deck, card, react, reactsOf, myReacts, showcases, momentsPublic, momentsOnPage, wasThere,
    // for the blended feed (server/feedblend.js)
    hostOf, sample, momentSeen, momentsOf, kudosOf, cardPublic, eventCta, nextOf, artOf, lookOf, momentOut, MEDIA_OK };
}

export function mountFeedVisual(app, { store, small, currentUser, C, X, sendPage = (res) => res.status(404).end() }) {
  const V = makeFeedVisual(store, { C, X });
  app.locals.feedVisual = V;
  const B = mountFeedBlend(app, { store, small, currentUser, C, X, V }); // the blended stream, kudos and dismiss (server/feedblend.js)
  mountFindPeople(app, { store, small, currentUser, C, X, B, sendPage }); // Find people (server/findpeople.js)
  const hits = new Map(); const limited = (req, n) => { const k = (req.ip || "?") + req.path.split("/").slice(0, 4).join("/"), now = Date.now(); let h = hits.get(k); if (!h || now - h.start > 3600_000) { h = { n: 0, start: now }; hits.set(k, h); } return ++h.n > n; };
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const ipDay = new Map(), REACTS_PER_IP = () => Math.max(1, +process.env.ENCORE_REACTS_PER_IP || 10);
  const overIpDay = (req, id) => { const k = `${req.ip || "?"}|${id}|${today()}`, n = (ipDay.get(k) || 0) + 1; if (ipDay.size > 50000) ipDay.clear(); ipDay.set(k, n); return n > REACTS_PER_IP(); };
  const viewer = (req) => { const u = currentUser(req); return u && u.ws !== DEFAULT_WS && u.email ? u : null; };
  const followingOf = (email) => { try { return email ? [...new Set([...X.index().events.values()].map((v) => v.ws))].filter((w) => C.followersOf(w).some((f) => lc(f.email) === lc(email))).map((w) => C.profileOf(w)?.handle).filter(Boolean) : []; } catch { return []; } };
  const device = (req) => (/^[A-Za-z0-9_-]{8,40}$/.test(String(req.query.device || req.body?.device || "")) ? "dev:" + String(req.query.device || req.body.device) : "");
  // the signed-out feed: public content only (and no cookies needed, so it can be cached for a minute)
  // Signed out, the answer is the same for everyone who picked the same things, so it's kept for a minute (or until
  // something it shows changes); only "my reactions" are per device, and those are filled in per request.
  const outCache = new Map(), OUT_MS = 60_000;
  const cachedOut = (key0, make) => { const key = key0 + "|" + (process.env.ENCORE_FEED_PREVIEWS || "") /* the consented previews change what shows */, now = Date.now(), c = outCache.get(key); if (c && c.gen === V.gen() && now - c.at < OUT_MS) return c.v;
    const v = make(), gen = V.gen(); /* after: what building it wrote itself (kudos labels saved back) changes nothing shown */ if (outCache.size > 500) outCache.clear(); outCache.set(key, { gen, at: now, v }); return v; };
  app.get("/api/public/feed", (req, res) => { if (limited(req, Math.max(60, +process.env.ENCORE_FEED_PER_IP_HOUR || 1200))) return bad(res, "Slow down.", 429, "rate_limited");
    const u = viewer(req); res.set("Cache-Control", u ? "private, no-store" : "public, max-age=60");
    const email = u ? lc(u.email) : "", interests = String(req.query.interests || "").slice(0, 400), city = String(req.query.city || "").slice(0, 120);
    if (u) return res.json({ ...V.sections({ email, device: device(req), interests, city }), stories: V.stories({ email, following: followingOf(email) }), blend: B.blend({ email, ws: u.ws, city }) });
    const body = cachedOut(`feed|${interests}|${city}`, () => ({ ...V.sections({ interests, city }), stories: V.stories({}), blend: B.blend({ city }) })), dev = device(req);
    res.json(dev ? { ...body, past: body.past.map((c) => ({ ...c, myReacts: V.myReacts(c.id, dev) })), blend: B.decorate(body.blend, { who: dev }) } : body); });
  // stories on their own (the rail can refresh without the whole feed)
  app.get("/api/feed/stories", (req, res) => { const u = viewer(req), email = u ? lc(u.email) : ""; res.set("Cache-Control", "private, no-store"); res.json({ stories: V.stories({ email, following: followingOf(email) }) }); });
  // the swipe deck on a first visit to /feed (public/swipedeck.js): real events in the visitor's city first, then ideas
  app.get("/api/public/deck", (req, res) => { if (limited(req, 600)) return bad(res, "Slow down.", 429, "rate_limited"); const u = viewer(req); res.set("Cache-Control", "private, no-store");
    const q = { city: String(req.query.city || "").slice(0, 120), interests: String(req.query.interests || "").slice(0, 400), email: u ? lc(u.email) : "", ideas: (() => { const L = app.locals.hooks?.IDEAS || []; try { return app.locals.trends?.annotate(L, { city: String(req.query.city || "").slice(0, 60) }) || L; } catch { return L; } })() /* trends: ranked and labelled (server/trends.js) */, limit: Math.max(5, Math.min(20, +req.query.limit || 12)) };
    res.json(u ? V.deck(q) : cachedOut(`deck|${q.interests}|${q.city}|${q.limit}`, () => V.deck(q))); });
  // what an upload may be, for the browser's own check before it sends anything
  app.get("/api/public/moment-limits", (req, res) => res.json({ imageMB: Math.round((momentMaxBytes("image") / 1048576) * 10) / 10, videoMB: Math.round((momentMaxBytes("video") / 1048576) * 10) / 10, seconds: MOMENT_MAX_SECONDS, perPick: 6, types: [...MOMENT_IMAGE_TYPES, ...MOMENT_VIDEO_TYPES] }));
  // tap-to-react on past events: one of each emoji per person (signed in) or device, toggled
  app.post("/api/feed/react", small, (req, res) => { if (limited(req, 120)) return bad(res, "Slow down.", 429, "rate_limited"); const b = req.body || {}, emoji = String(b.emoji || ""), id = clean(b.eventId, 80);
    if (!V.reactsOf || !["🔥", "😍", "🥟", "🙌"].includes(emoji)) return bad(res, "Pick one of the reactions.");
    const u = viewer(req), who = u ? "u:" + lc(u.email) : device(req); if (!who) return bad(res, "Missing device.", 400, "invalid");
    let ok = /^s[cx]-[a-z0-9-]{1,40}-\d{1,2}$/.test(id) && V.showcases().some((P) => [...P.past, ...P.experiences].some((x) => x.id === id));
    if (!ok) { const I = X.index(), x = I.events.get(id); ok = !!x && x.e.date && x.e.date < today() && ((!!x.e.discoverable && !x.e.unlisted && !x.e.cancelled) || V.wasThere(I, id, u ? lc(u.email) : "")); }
    if (!ok) return bad(res, "No such event.", 404, "not_found");
    // signed out, a device id is easy to make up: one IP gets REACTS_PER_IP taps on one event a day
    if (!u && overIpDay(req, id)) return bad(res, "That's a lot of reactions. Sign in to keep going.", 429, "rate_limited");
    res.json({ ok: true, ...V.react(id, who, emoji) }); });
  // ---- moments the host looks after: see every one (hidden too), hide or show one, show link-only moments on the page ----
  const hostEvent = (req, res) => { const u = viewer(req); if (!u) { res.status(401).json({ code: "unauthenticated", message: "Sign in first." }); return null; } const id = clean(req.params.eventId, 80);
    if (workspaceOfEvent(id) !== u.ws) { bad(res, "No such event.", 404, "not_found"); return null; } const S = scopeStore(store, u.ws), ev = S.get("events/" + id)?.data; if (!ev) { bad(res, "No such event.", 404, "not_found"); return null; } return { u, id, S, ev }; };
  app.get("/api/host/moments/:eventId", (req, res) => { const H = hostEvent(req, res); if (!H) return;
    const L = H.S.list("moments").filter((d) => d.data?.eventId === H.id).map((d) => ({ id: d.id, url: d.data.url, type: d.data.type, poster: d.data.poster || "", caption: d.data.caption || "", by: first(d.data.authorName) || "", host: lc(d.data.authorEmail) === lc(H.u.email), hidden: !!d.data.hidden, at: d.data.at || 0 })).sort((a, b) => b.at - a.at);
    res.json({ moments: L, public: momentsPublic(H.ev), onPage: momentsOnPage(H.ev), momentsOnPage: H.ev.momentsOnPage === true, canShowOnPage: !momentsPublic(H.ev) && !H.ev.noPhotos }); });
  app.post("/api/host/moments/:eventId/settings", small, (req, res) => { const H = hostEvent(req, res); if (!H) return; H.S.update("events/" + H.id, { momentsOnPage: req.body?.onPage === true }); X.bust(); res.json({ ok: true, momentsOnPage: req.body?.onPage === true }); });
  app.post("/api/host/moments/:eventId/:momentId/hide", small, (req, res) => { const H = hostEvent(req, res); if (!H) return; const mid = String(req.params.momentId || "").replace(/[^A-Za-z0-9_-]/g, ""), d = H.S.get("moments/" + mid)?.data;
    if (!d || d.eventId !== H.id) return bad(res, "No such photo.", 404, "not_found"); const hidden = req.body?.hidden !== false; H.S.update("moments/" + mid, { hidden, hiddenAt: hidden ? Date.now() : null }); X.bust(); res.json({ ok: true, hidden }); });
  // ---- Home to-dos from the server (public/nudges.js): "Show it on Discover" after a host shares a Link only event ----
  // New hosts' events start Link only, so they never fill the feed. Once one is shared (published), the host's Home
  // offers it once: one tap puts it on Discover (and their page), "Not now" never asks about that event again.
  const nudgeable = (e) => !!e && !!e.published && (!e.discoverable || e.unlisted) && !e.cancelled && !e.example && !e.private && !e.friendsOnly && e.discoverNudge !== "off" && /^\d{4}-\d{2}-\d{2}$/.test(e.date || "") && e.date >= today() && !!(e.city || e.hood || e.place || e.venue);
  app.get("/api/host/nudges", (req, res) => { res.set("Cache-Control", "private, no-store"); const u = viewer(req); if (!u) return res.status(401).json({ code: "unauthenticated", message: "Sign in first." });
    const P = C.profileOf(u.ws); if (!P?.handle) return res.json({ discover: null });
    // the page must have what Discover needs (a line about you, a face or photo) or Show it on Discover changes nothing anyone sees
    const gaps = /@demo\.encore$/i.test(getWorkspace(u.ws)?.ownerEmail || "") ? [] : C.pageGaps(P).filter((g) => g !== "a page");
    const S = scopeStore(store, u.ws), L = S.list("events").map((d) => ({ id: d.id, e: d.data })).filter((x) => nudgeable(x.e)).sort((a, b) => (b.e.publishedAt || b.e.updatedAt || 0) - (a.e.publishedAt || a.e.updatedAt || 0));
    // unlisted: link only (not on the host's page either); false means it's on their page but kept off Discover
    const x = L[0]; res.json({ discover: x ? { eventId: x.id, title: x.e.pubTitle || x.e.name || "Your event", date: x.e.date, unlisted: !x.e.discoverable, pageReady: !gaps.length, gaps, handle: P.handle } : null }); });
  app.post("/api/host/nudges/discover", small, (req, res) => { const u = viewer(req); if (!u) return res.status(401).json({ code: "unauthenticated", message: "Sign in first." }); const id = clean(req.body?.eventId, 80);
    if (workspaceOfEvent(id) !== u.ws) return bad(res, "No such event.", 404, "not_found"); const S = scopeStore(store, u.ws), ev = S.get("events/" + id)?.data; if (!ev) return bad(res, "No such event.", 404, "not_found");
    if (req.body?.show === true) { if (!nudgeable(ev)) return bad(res, "This one can't go on Discover from here. Open the event to change who can find it.", 409, "not_allowed"); S.update("events/" + id, { discoverable: true, unlisted: false, discoverNudge: "off", updatedAt: Date.now() }); X.bust(); return res.json({ ok: true, discoverable: true }); }
    S.update("events/" + id, { discoverNudge: "off" }); res.json({ ok: true, discoverable: !!ev.discoverable }); });
  return V;
}
// ---- end visual feed ----
