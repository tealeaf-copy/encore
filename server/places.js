// "Your places" and the year in nights: where someone has been through Pottery Lab, on a small drawn map, and a
// tap-through story of their year, with cards they can save as PNGs (server/sharecards.js) and an opt-in public link.
//
// What counts as a place (a "night"), and only these:
// - went:    a reply of I'm in to an event that has happened, not marked no-show, not cancelled
// - checkin: the same, checked in at the door (checkedInAt)
// - drop:    a drop or pre-order that was picked up (orderStatus "picked" or checked in); a paid order alone isn't a night
// - brand:   a brand-booked experience that happened, where the person was checked in (a host seat or the brand's list)
// - guestlist: a host added them to the guest list as Attended (or Going, once it happened)
// - hosted:  an event in their own workspace that happened and was shared (or had guests), not cancelled
// Saves, maybes, waitlists, can't-gos, upcoming events, drafts and examples never count.
//
// Privacy, in one place (test/places.test.js holds it):
// - A private event (not listed on Discover, unlisted, members-only, a brand booking) is only ever an area: the
//   neighbourhood's centre from server/geo.js, never a point, and it is labelled by neighbourhood ("A dinner in
//   Greenpoint"), never by its title, anywhere anyone but you can see: your page, a friend's layer, a share card, a
//   public link. Only public events with a public place the host marked get a point, and only one geo already knows.
// - Your places on your page: off for others until you turn it on ("Show my places on my page"); you always see them.
// - Friends: off until you turn on "Let friends see where I've been". A friend is someone on each other's friends list.
//   That switch also lets friends' year cards name you (first name only). Nobody else is ever named on a card.
// - Hide one event and it leaves your page, your friends' layer, your story and your cards. Blocks go both ways.
// - Share cards carry no photos (so no faces): only drawings, counts, neighbourhoods, kinds, months and public titles.
//
// GET  /api/me/places?year=&type=             your places (everything, with real titles: only you see this)
// GET  /api/public/places/:handle?year=      someone's places, if they show them, as anyone may see them
// GET  /api/me/places/friends?year=          places from people you know (friends who opted in)
// GET  /api/me/places/settings               PUT the same: { showOnProfile, friendsSee }
// PUT  /api/me/places/hide                   { eventId, hidden }
// GET  /api/me/places/prompt                 a calm card for Home in December or at a milestone, or nothing
// GET  /api/me/year/:year?type=&edition=     the story: cards (each a share-card spec) and the share link
// GET  /api/me/year/:year/card/:id.png?size=story|link&type=&edition=   one card as a PNG
// PUT  /api/me/year/:year/share              { on, type, edition } an opt-in public link (/y/<token>)
// GET  /y/:token, /api/public/year/:token, /y/:token/:id.png   the public link page, its cards and PNGs
// GET  /year/:year                           the story page (public/year.html, public/yearreview.js)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { scopeStore, allWorkspaceIds, getWorkspace, DEFAULT_WS, getDbUser } from "./workspaces.js";
import { hoodCentre, cityCentre } from "./geo.js";
import { catOf } from "./map.js";
import { makeSafety, keyOf } from "./safety.js";
import { renderCardAsync, textOf, cardText, SIZES } from "./sharecards.js";

const here = path.dirname(fileURLToPath(import.meta.url)), PUBLIC = path.join(here, "..", "public");
const lc = (s) => String(s || "").trim().toLowerCase();
const hash = (s) => crypto.createHash("sha256").update(lc(s)).digest("hex").slice(0, 24);
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const DAY = 864e5;
const ID_OK = /^[A-Za-z0-9_-]{1,120}$/;
const PHOTO_OK = (u) => /^\/_blob\/[A-Za-z0-9]{20}$/.test(u || "") || /^\/presets\/[a-z0-9-]{1,60}\.(jpg|webp|png)$/.test(u || "");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthOf = (d) => MON[+String(d).slice(5, 7) - 1] || "", niceDay = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || "") ? `${monthOf(d)} ${+d.slice(8, 10)}` : "");

// the kinds of night, for filters, labels and the drawing on a card
export const KINDS = { supper: { label: "Supper clubs", one: "Supper club", noun: "dinner", art: "dinner" }, games: { label: "Game nights", one: "Game night", noun: "games night", art: "games" }, run: { label: "Run clubs", one: "Run club", noun: "run", art: "run" },
  workshop: { label: "Workshops", one: "Workshop", noun: "workshop", art: "workshop" }, drop: { label: "Drops", one: "Drop", noun: "drop pickup", art: "bake" }, market: { label: "Markets", one: "Market", noun: "market", art: "market" }, other: { label: "Other nights", one: "Night out", noun: "night out", art: "party" } };
const kindOfEvent = (e) => catOf(e) || "other";
// EventArt (public/eventart.js) for the drawing that fits an event
let EA = null; const art = () => { if (EA) return EA; try { const box = { window: {}, document: undefined }; vm.runInNewContext(fs.readFileSync(path.join(PUBLIC, "eventart.js"), "utf8"), box, { timeout: 1000 }); EA = box.window.EventArt; } catch { EA = { kindOf: () => "party", valid: () => false }; } return EA; };
const KIT = (() => { try { return JSON.parse(fs.readFileSync(path.join(PUBLIC, "og", "kit", "kit.json"), "utf8")).art || {}; } catch { return {}; } })();
export function artOf(e = {}) { let k = ""; try { k = e.coverArt && typeof e.coverArt === "object" && art().valid(e.coverArt.kind) ? String(e.coverArt.kind).split("+")[0] : String(art().kindOf(e) || "").split("+")[0]; } catch {} return KIT[k] ? k : KIT[KINDS[kindOfEvent(e)].art] ? KINDS[kindOfEvent(e)].art : "party"; }

/** Whether an event is public: listed on Discover, not unlisted, not members-only, not a fan-club-only event. */
export function isPublicEvent(e = {}, club = null) { return !!e.discoverable && !e.unlisted && !e.private && !e.example && !e.membersOnly && e.visibility !== "members" && !club?.only; }
/** The label a private event goes by: "A dinner in Greenpoint". Never its title, never a street. */
export function privateLabel(e = {}, host = {}, { brand = false } = {}) { const k = KINDS[kindOfEvent(e)] || KINDS.other, area = clean(e.hood || host?.hood || "", 50) || clean(String(e.city || host?.city || "").split(",")[0], 40);
  return `A ${brand ? "team " : ""}${k.noun}${area ? " in " + area : " with friends"}`; }
/** Whether a reply means the person was there: I'm in to something that happened (or a drop picked up). */
export function attendedVia(r = {}, e = {}, today = iso(Date.now())) {
  if (!r || !e || e.cancelled || e.example) return "";
  if (e.drop || e.preorder) return r.orderStatus === "picked" || (r.checkedInAt && r.response !== "no") ? "drop" : "";
  if (r.response !== "going" || r.noShow === true) return "";
  if (r.checkedInAt) return "checkin";
  return e.date && e.date < today ? "went" : ""; }
/** Whether an event in your own workspace counts as hosted: it happened, it was shared or had guests, not cancelled. */
export function hostedCounts(e = {}, going = 0, today = iso(Date.now())) { return !!e.date && e.date < today && !e.cancelled && !e.example && !e.tentative && e.stage !== "interest" && !e.preview && (!!e.published || !!e.discoverable || going > 0); }

// ---- the hand-drawn map: neighbourhoods as areas on a 0..1 box, with a few wobbly streets and a river ----
const h32 = (s) => crypto.createHash("sha256").update(String(s)).digest().readUInt32BE(0);
function rng(seed) { let x = h32(seed) || 1; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 10000) / 10000; }; }
function doodle(seed) { const R = rng("map|" + seed), lines = [], wob = (a, b, horiz) => { const pts = []; for (let i = 0; i <= 20; i++) { const t = i / 20, base = a + (b - a) * t, off = Math.sin(t * 6.3 + R() * 6) * 0.012 + (R() - 0.5) * 0.006; pts.push(...(horiz ? [t, base + off] : [base + off, t])); } return pts.map((v) => Math.round(v * 1000) / 1000); };
  const ry = 0.3 + R() * 0.4; lines.push(wob(ry, ry + (R() - 0.5) * 0.4, true)); // the river
  for (let i = 0; i < 2; i++) { const x = 0.18 + i * 0.5 + R() * 0.2; lines.push(wob(x, x + (R() - 0.5) * 0.12, false)); }
  for (let i = 0; i < 2; i++) { const y = 0.12 + i * 0.62 + R() * 0.16; lines.push(wob(y, y + (R() - 0.5) * 0.12, true)); }
  return { river: true, lines }; }
/** Areas ({ key, lat, lng, n, label }) to a drawn map: spread over the box, a stable doodle for the city. */
export function mapOf(areas = [], seed = "") { const A = areas.filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lng)); if (!A.length) return { ...doodle(seed), areas: [] };
  const k = Math.cos((A.reduce((s, a) => s + a.lat, 0) / A.length) * Math.PI / 180), xs = A.map((a) => a.lng * k), ys = A.map((a) => -a.lat);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), span = Math.max(x1 - x0, y1 - y0, 0.02), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const r3 = (v) => Math.round(v * 1000) / 1000, max = Math.max(...A.map((a) => a.n || 1));
  const pts = A.map((a, i) => ({ x: 0.5 + ((xs[i] - cx) / span) * 0.7, y: 0.5 + ((ys[i] - cy) / span) * 0.7 }));
  // neighbours that sit close on a real map are nudged apart, so each one's pins and name can be read (it's a drawing, not a survey)
  for (let it = 0; it < 40; it++) for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) { const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y, d = Math.hypot(dx, dy) || 0.001; if (d >= 0.22) continue;
    const push = (0.22 - d) / 2, ux = dx / d, uy = dy / d; pts[i].x -= ux * push; pts[i].y -= uy * push; pts[j].x += ux * push; pts[j].y += uy * push; }
  const cl = (v) => Math.min(0.9, Math.max(0.1, v));
  return { ...doodle(seed), areas: A.map((a, i) => ({ key: a.key, x: r3(cl(pts[i].x)), y: r3(cl(pts[i].y)), r: r3(0.045 + 0.04 * Math.sqrt((a.n || 1) / max)), n: a.n || 1, label: clean(a.label, 30) })) }; }
// keeps a quote someone wrote free of contact details and of anyone else's name
export function scrubQuote(text, names = []) { let t = clean(text, 280).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "…").replace(/\(?(?:\+?\d[\s().-]*){7,}\d/g, "…").replace(/\u2014/g, ", ");
  for (const n of names) { const f = first(n); if (f.length > 1) t = t.replace(new RegExp(`\\b${f.replace(/[^\p{L}'-]/gu, "")}\\b`, "giu"), "…"); } return t; }

export function makePlaces({ store, C, X = null, geo = null, now = () => Date.now() }) {
  const SF = makeSafety(store);
  const sys = (k) => store.get("system/" + k)?.data || null, put = (k, v) => store.set("system/" + k, v);
  const prefKey = (em) => "plplaces-" + hash(em);
  /** Your settings: { showOnProfile, friendsSee, hidden } (both switches off until you turn them on). */
  function settings(email) { const v = sys(prefKey(email)) || {}; return { showOnProfile: v.showOnProfile === true, friendsSee: v.friendsSee === true, hidden: Array.isArray(v.hidden) ? v.hidden.filter((x) => ID_OK.test(x)).slice(0, 500) : [], share: v.share && typeof v.share === "object" ? v.share : {} }; }
  function setSettings(email, b = {}) { const cur = settings(email), next = { ...cur, ...(typeof b.showOnProfile === "boolean" ? { showOnProfile: b.showOnProfile } : {}), ...(typeof b.friendsSee === "boolean" ? { friendsSee: b.friendsSee } : {}) };
    put(prefKey(email), { kind: "plplaces", email: lc(email), ...next, at: now() }); return next; }
  function setHidden(email, eventId, hidden) { if (!ID_OK.test(eventId || "")) return null; const S = settings(email), H = new Set(S.hidden); if (hidden) H.add(eventId); else H.delete(eventId);
    const next = { ...S, hidden: [...H].slice(-500) }; put(prefKey(email), { kind: "plplaces", email: lc(email), ...next, at: now() }); return next; }
  const handleOf = (email) => { const u = getDbUser(lc(email)); return (u?.ws && C.profileOf(u.ws)?.handle) || ""; };
  /** Blocks count both ways: either person blocked the other (as a person or as a host). */
  function blocked(a, b) { if (!a || !b) return false; const A = lc(a), B = lc(b), hb = handleOf(B), ha = handleOf(A);
    try { return SF.blocksOf(A).some((t) => t.target === "person:" + keyOf(B) || (hb && t.target === "host:" + hb)) || SF.blocksOf(B).some((t) => t.target === "person:" + keyOf(A) || (ha && t.target === "host:" + ha)); } catch { return false; } }
  const friendsOf = (email) => { try { return (X?.friendsOf?.(lc(email)) || []).map((f) => lc(f.email)); } catch { return []; } };
  /** Friends both ways: each on the other's list. */
  const mutual = (a, b) => friendsOf(a).includes(lc(b)) && friendsOf(b).includes(lc(a));

  // ---- the index: every night, for everyone, read once in a while ----
  let cache = null;
  function index() { if (cache && now() - cache.at < 20_000) return cache; const today = iso(now()), nights = new Map(), events = new Map(), moments = [], kudos = [], names = new Map(), nameOn = (id, n) => { const f = first(n); if (!f) return; if (!names.has(id)) names.set(id, new Set()); names.get(id).add(f); };
    const add = (email, n) => { const k = lc(email); if (!k) return; if (!nights.has(k)) nights.set(k, []); const L = nights.get(k); const at = L.findIndex((x) => x.id === n.id); if (at < 0) L.push(n); else if (n.via === "checkin" || n.role === "hosted") L[at] = n; };
    for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; const S = scopeStore(store, ws), W = getWorkspace(ws), owner = lc(W?.ownerEmail), host = C.profileOf(ws) || null, demo = /@demo\.encore$/i.test(owner);
      if (demo) continue;
      const evs = new Map(); for (const d of S.list("events")) { const e = d.data; if (!e || e.example || !ID_OK.test(d.id)) continue; let club = null; try { club = S.get("clubevents/" + d.id)?.data || null; } catch {} evs.set(d.id, { e, club }); events.set(d.id, { id: d.id, ws, e, host, owner, club }); }
      const going = new Map(); for (const d of S.list("rsvps")) { const r = d.data || {}, x = evs.get(r.eventId); if (!x) continue; const via = attendedVia(r, x.e, today); if (r.name) nameOn(r.eventId, r.name);
        if (via) { going.set(r.eventId, (going.get(r.eventId) || 0) + 1); if (r.email && lc(r.email) !== owner) add(r.email, { id: r.eventId, ws, role: "went", via, date: via === "drop" && (r.pickedAt || r.checkedInAt) ? iso(r.pickedAt || r.checkedInAt) : x.e.date, rid: d.id, guestKey: lc(r.email) || r.name }); } }
      for (const [id, x] of evs) for (const g of x.e.guests || []) { if (g?.name) nameOn(id, g.name); if (!g?.email || g.noShow || lc(g.email) === owner || x.e.cancelled) continue; if (/Attended/.test(g.status || "") || (/Going/.test(g.status || "") && x.e.date && x.e.date < today)) { going.set(id, (going.get(id) || 0) + 1); add(g.email, { id, ws, role: "went", via: "guestlist", date: x.e.date }); } }
      if (owner) for (const [id, x] of evs) if (hostedCounts(x.e, going.get(id) || 0, today)) add(owner, { id, ws, role: "hosted", via: "hosted", date: x.e.date });
      for (const d of S.list("moments")) { const m = d.data; if (m && !m.hidden && m.type !== "video" && PHOTO_OK(m.url)) moments.push({ ws, eventId: m.eventId, email: lc(m.authorEmail), url: m.url, at: m.at || 0 }); }
      for (const d of S.list("kudos")) { const k = d.data; if (k && evs.has(k.eventId)) kudos.push({ ws, eventId: k.eventId, email: lc(k.email), name: clean(k.name, 60), love: clean(k.love, 400), tags: k.tags || [], at: k.at || 0 }); }
    }
    // brand-booked experiences: checked in at one that happened
    try { for (const d of store.listPrefix("system", "bbreq-")) { const r = d.data; if (r?.kind !== "bbreq" || !/^[a-f0-9]{4,24}$/.test(r.id || "")) continue; const st = r.status;
      if (!(st === "done" || (["booked", "accepted"].includes(st) && r.date && r.date < today))) continue; const bp = store.get("system/bpev-" + r.id)?.data || {}, host = C.profileOf(r.hostWs) || {}, id = "bb-" + r.id;
      const who = new Set((bp.hostSeats || []).filter((s) => s.checkedIn && s.email).map((s) => lc(s.email)));
      for (const c of store.listPrefix("system", "camp-")) for (const g of c.data?.guests || []) if (g.event === r.id && g.checkedIn && g.email) who.add(lc(g.email));
      if (!who.size) continue; events.set(id, { id, ws: r.hostWs, e: { name: r.pkgName, activity: r.pkgName, date: r.date, city: host.city || "", hood: host.hood || "" }, host, owner: "", brand: true });
      for (const em of who) add(em, { id, ws: r.hostWs, role: "went", via: "brand", date: r.date }); } } catch {}
    cache = { at: now(), nights, events, moments, kudos, names }; return cache; }
  const bust = () => { cache = null; };

  /** Where a night goes: an area (always), and a point only for a public event at a place the host marked public. */
  function whereOf(x, pub) { const e = x.e, host = x.host || {}, hood = clean(e.hood || (host.hood && (!e.city || lc(String(e.city).split(",")[0]) === lc(String(host.city || "").split(",")[0])) ? host.hood : ""), 50), city = clean(String(e.city || host.city || "").split(",")[0], 40);
    const c = hoodCentre(hood, city || host.city) || null, cc = c ? null : cityCentre(city || host.city);
    const area = c ? { key: lc(c.hood) + "|" + lc(c.city), hood: c.hood, city: c.city, lat: +c.lat.toFixed(3), lng: +c.lng.toFixed(3), r: 600 } : cc ? { key: "|" + lc(cc.name), hood: "", city: cc.name, lat: +cc.lat.toFixed(3), lng: +cc.lng.toFixed(3), r: 1400 } : hood || city ? { key: lc(hood) + "|" + lc(city), hood, city, lat: null, lng: null, r: 0 } : null;
    let point = null; if (pub && !x.brand && e.placePublic === true && !e.approvalRequired) { try { const g = geo?.locate?.(x.id, e, host); if (g?.exact) point = { lat: g.lat, lng: g.lng }; } catch {} }
    return { area, point }; }
  /** One night, full (for you): real title, your photos, kudos you gave and got. */
  function row(email, n, I, hiddenSet) { const x = I.events.get(n.id); if (!x) return null; const e = x.e, pub = !x.brand && isPublicEvent(e, x.club), host = x.host || {}, kind = kindOfEvent(e), me = lc(email);
    const { area, point } = whereOf(x, pub), mine = I.moments.filter((m) => m.eventId === n.id && m.email === me).sort((a, b) => b.at - a.at).map((m) => m.url).slice(0, 6);
    const gave = I.kudos.find((k) => k.eventId === n.id && k.email === me && k.love), got = n.role === "hosted" ? I.kudos.filter((k) => k.eventId === n.id && k.love && k.email !== me).slice(0, 3) : [];
    const cover = PHOTO_OK(e.coverPhoto) ? e.coverPhoto : "";
    return { id: n.id, role: n.role, via: n.via, date: n.date || "", month: monthOf(n.date), year: +String(n.date || "").slice(0, 4) || 0, kind, art: artOf(e), public: pub, brand: !!x.brand,
      title: clean(e.pubTitle || e.name, 120) || privateLabel(e, host, { brand: x.brand }), label: privateLabel(e, host, { brand: x.brand }),
      host: host.handle ? { name: clean(host.name || host.handle, 60), handle: host.handle, url: "/@" + host.handle } : null, area, point,
      photo: mine[0] ? { url: mine[0], from: "mine" } : cover ? { url: cover, from: "cover" } : null, photos: mine, url: pub ? "/e/" + encodeURIComponent(n.id) : "",
      kudos: { gave: gave ? gave.love : "", got: got.map((k) => ({ text: k.love, by: "A guest" })) }, hidden: hiddenSet.has(n.id) }; }
  /** The same night as anyone else may see it: a private one by its label and area only; no photos but a public cover. */
  function publicRow(r) { const pub = r.public; return { id: pub ? r.id : hash("p|" + r.id).slice(0, 12), role: r.role, date: r.date, month: r.month, year: r.year, kind: r.kind, art: r.art, public: pub, title: pub ? r.title : r.label, label: r.label,
    host: pub ? r.host : null, area: r.area ? { key: r.area.key, hood: r.area.hood, city: r.area.city, lat: r.area.lat, lng: r.area.lng, r: r.area.r } : null, point: pub ? r.point : null,
    photo: pub && r.photo?.from === "cover" ? r.photo : null, url: pub ? r.url : "" }; }

  /** Your nights (rows), newest first, filtered by year and type ("all", "hosted", "went" or a kind). */
  function nightsOf(email, { year = 0, type = "all", withHidden = true } = {}) { const I = index(), S = settings(email), H = new Set(S.hidden);
    let L = (I.nights.get(lc(email)) || []).map((n) => row(email, n, I, H)).filter(Boolean);
    if (!withHidden) L = L.filter((r) => !r.hidden); if (year) L = L.filter((r) => r.year === +year);
    if (type === "hosted" || type === "went") L = L.filter((r) => (type === "hosted" ? r.role === "hosted" : r.role !== "hosted")); else if (KINDS[type]) L = L.filter((r) => r.kind === type);
    return L.sort((a, b) => String(b.date).localeCompare(String(a.date))); }
  const yearsOf = (email) => [...new Set((index().nights.get(lc(email)) || []).map((n) => +String(n.date || "").slice(0, 4)).filter((y) => y > 2000))].sort((a, b) => b - a);
  function areasOf(rows) { const m = new Map(); for (const r of rows) { if (!r.area) continue; const a = m.get(r.area.key) || { ...r.area, n: 0, label: r.area.hood || r.area.city, ids: [] }; a.n++; a.ids.push(r.id); m.set(r.area.key, a); } return [...m.values()].sort((a, b) => b.n - a.n); }
  const hoodsCount = (rows) => new Set(rows.filter((r) => r.area).map((r) => r.area.key)).size;
  /** "23 nights in 6 neighbourhoods this year": true counts, plain words. */
  function lineOf(rows, year) { const n = rows.length, h = hoodsCount(rows), cur = +iso(now()).slice(0, 4), when = !year ? "so far" : +year === cur ? "this year" : `in ${year}`;
    if (!n) return +year === cur || !year ? "No nights yet this year. The first one goes here." : `No nights in ${year}.`;
    return `${n} ${n === 1 ? "night" : "nights"}${h ? ` in ${h} ${h === 1 ? "neighbourhood" : "neighbourhoods"}` : ""} ${when}`; }
  function typesOf(rows) { const c = {}; for (const r of rows) c[r.kind] = (c[r.kind] || 0) + 1; return Object.keys(KINDS).filter((k) => c[k]).map((k) => ({ id: k, label: KINDS[k].label, n: c[k] })); }
  /** Your places, for you. */
  function mine(email, { year = +iso(now()).slice(0, 4), type = "all" } = {}) { const rows = nightsOf(email, { year, type }), all = nightsOf(email, { year });
    return { me: true, year: +year || 0, years: yearsOf(email), type, types: typesOf(all), hosted: all.some((r) => r.role === "hosted"), line: lineOf(rows, year), counts: { nights: rows.length, hoods: hoodsCount(rows), hosted: rows.filter((r) => r.role === "hosted").length }, areas: areasOf(rows).map(({ ids, ...a }) => ({ ...a, ids })), map: mapOf(areasOf(rows), rows[0]?.area?.city || "home"), places: rows, settings: (({ share, ...s }) => s)(settings(email)) }; }
  /** Someone's places, as a visitor sees them: only if they turned it on, nothing hidden, private ones as areas. */
  function forProfile(handle, viewerEmail, { year = +iso(now()).slice(0, 4), type = "all" } = {}) { const ws = C.wsOfHandle(lc(handle)), W = ws && getWorkspace(ws), owner = lc(W?.ownerEmail);
    if (!owner || /@demo\.encore$/i.test(owner)) return { on: false };
    if (viewerEmail && lc(viewerEmail) === owner) return { on: true, own: true, ...mine(owner, { year, type }) };
    if (!settings(owner).showOnProfile || blocked(owner, viewerEmail)) return { on: false };
    const rows = nightsOf(owner, { year, type, withHidden: false }).map(publicRow), all = nightsOf(owner, { year, withHidden: false });
    return { on: true, me: false, year: +year || 0, years: yearsOf(owner), type, types: typesOf(all), line: lineOf(rows, year), counts: { nights: rows.length, hoods: hoodsCount(rows) }, areas: areasOf(rows).map(({ ids, ...a }) => ({ ...a, ids })), map: mapOf(areasOf(rows), rows[0]?.area?.city || "home"), places: rows, first: first(C.profileOf(ws)?.person || getDbUser(owner)?.name || "") }; }
  /** Places from people you know: friends both ways, who turned "Let friends see where I've been" on, not blocked. */
  function friendsLayer(email, { year = 0 } = {}) { const me = lc(email), out = [], who = [];
    for (const f of friendsOf(me)) { if (f === me || !mutual(me, f) || !settings(f).friendsSee || blocked(me, f)) continue; const u = getDbUser(f), name = first(u?.name || X?.person?.(f)?.name || ""); if (!name) continue;
      const rows = nightsOf(f, { year, withHidden: false }).slice(0, 60).map(publicRow); if (!rows.length) continue; const handle = handleOf(f);
      who.push({ first: name, handle, n: rows.length });
      for (const r of rows) out.push({ ...r, who: { first: name, handle }, line: `${name} went here in ${MONTH[+String(r.date).slice(5, 7) - 1] || ""}`.trim() }); }
    out.sort((a, b) => String(b.date).localeCompare(String(a.date))); const rows = out.slice(0, 200);
    return { friends: who, places: rows, areas: areasOf(rows).map(({ ids, ...a }) => a), map: mapOf(areasOf(rows), rows[0]?.area?.city || "friends") }; }

  // ---- the year in nights: the story's cards, each a share-card spec ----
  function weeksStreak(rows) { const wk = (d) => Math.floor((Date.parse(d + "T12:00:00Z") / DAY + 3) / 7), W = [...new Set(rows.map((r) => wk(r.date)))].sort((a, b) => a - b); let best = { n: 0 }, run = null;
    for (const w of W) { if (run && w === run.end + 1) { run.end = w; run.n++; } else run = { start: w, end: w, n: 1 }; if (run.n > best.n) best = { ...run }; }
    const day = (w) => iso((w * 7 - 3) * DAY); return best.n ? { n: best.n, from: day(best.start), to: day(best.end) } : { n: 0 }; }
  const nameForCard = (email, subject) => { const u = getDbUser(lc(email)); return mutual(subject, email) && settings(email).friendsSee && !blocked(subject, email) ? first(u?.name || "") : ""; };
  /** The words for a card about a night: the public title, or the private label. */
  const nightName = (r) => (r.public ? r.title : r.label);
  /** Everyone named at a night, but the person the card is about: kept off the card. */
  const othersAt = (I, eventId, me) => { const mine = first(getDbUser(me)?.name || ""); return [...(I.names.get(eventId) || [])].filter((n) => n && n !== mine); };
  const potto = { intro: "I kept the list. Here's your year.", streak: "Showing up is the whole thing.", route: "Same table, new night.", quote: "Someone wrote this down. I kept it.", hostIntro: "Every one of these happened because you opened the door." };
  function story(email, { year = +iso(now()).slice(0, 4), type = "all", edition = "guest" } = {}) {
    const me = lc(email), Y = +year, cur = +iso(now()).slice(0, 4), live = Y === cur && +iso(now()).slice(5, 7) < 12, I = index(), u = getDbUser(me) || {};
    const allRows = nightsOf(me, { year: Y, withHidden: false }), typed = KINDS[type] ? allRows.filter((r) => r.kind === type) : allRows;
    const hostedRows = allRows.filter((r) => r.role === "hosted"), rows = edition === "host" ? hostedRows : typed;
    const yr = live ? `Your ${Y} so far` : `Your ${Y}`, foot = `pottery lab · ${Y}`, kindLabel = KINDS[type] ? KINDS[type].label.toLowerCase() : "";
    const unit = (n, one, many) => `${n} ${n === 1 ? one : many}`, cards = [], add = (id, spec, extra = {}) => cards.push({ id, spec: { foot, ...spec }, ...extra });
    const areas = areasOf(rows), m = mapOf(areas, areas[0]?.city || "home"), hoods = areas.filter((a) => a.hood || a.city);
    const base = { year: Y, live, edition, editions: hostedRows.length ? ["guest", "host"] : ["guest"], type, types: typesOf(allRows), counts: { nights: rows.length, hoods: hoods.length }, first: first(u.name) };
    if (!rows.length) { add("intro", { kicker: yr, title: edition === "host" ? "Nothing hosted yet" : "No nights yet", sub: live ? "Your year fills in as you go. Even a coffee counts." : `Nothing on Pottery Lab in ${Y}.`, potto: "wave" }); return { ...base, cards }; }
    const byDate = [...rows].sort((a, b) => a.date.localeCompare(b.date)), firstN = byDate[0], latest = byDate[byDate.length - 1];
    if (edition === "host") {
      const ids = new Set(hostedRows.map((r) => r.id)), guests = new Map(); for (const [em, L] of I.nights) for (const n of L) if (n.role === "went" && ids.has(n.id)) guests.set(em, (guests.get(em) || 0) + 1);
      const regulars = [...guests.values()].filter((n) => n > 1).length, K = I.kudos.filter((k) => ids.has(k.eventId) && k.email !== me), hoodsFrom = new Set();
      for (const em of guests.keys()) { const g = getDbUser(em), p = g?.ws ? C.profileOf(g.ws) : null; if (p?.hood) hoodsFrom.add(lc(p.hood)); }
      add("intro", { kicker: `${yr} · Host edition`, title: unit(rows.length, "night hosted", "nights hosted"), sub: hoods.length ? `in ${unit(hoods.length, "neighbourhood", "neighbourhoods")}` : "", map: m, body: potto.hostIntro, potto: "carry", big: true });
      if (guests.size) add("guests", { kicker: "Guests welcomed", title: unit(guests.size, "guest", "guests"), sub: regulars ? `${unit(regulars, "regular", "regulars")} came back more than once.` : "Every one of them said I'm in.", art: "potluck", tone: "butter" });
      if (K.length) { const q = K.filter((k) => k.love).sort((a, b) => b.love.length - a.love.length)[0], ev = q && I.events.get(q.eventId), qr = q && rows.find((r) => r.id === q.eventId), by = q ? nameForCard(q.email, me) : "";
        add("kudos", { kicker: "Kudos received", title: unit(K.length, "kudos", "kudos"), ...(q ? { quote: { text: scrubQuote(q.love, othersAt(I, q.eventId, me)), by: by ? `${by}, after ${qr ? nightName(qr) : "a night"}` : `A guest at ${qr ? nightName(qr) : "one of your nights"}` } } : {}), potto: "cheer", tone: "blush" }); void ev; }
      if (hoodsFrom.size) add("from", { kicker: "Where guests came from", title: unit(hoodsFrom.size, "neighbourhood", "neighbourhoods"), sub: "Counts only. Nobody's address, nobody's name.", art: "walk", tone: "mint" });
      add("summary", { kicker: `${yr}, all in one`, title: unit(rows.length, "night hosted", "nights hosted"), stats: [{ n: String(rows.length), label: rows.length === 1 ? "night hosted" : "nights hosted" }, { n: String(guests.size), label: "guests welcomed" }, { n: String(regulars), label: "regulars" }, { n: String(K.length), label: "kudos" }, ...(hoodsFrom.size ? [{ n: String(hoodsFrom.size), label: "neighbourhoods guests came from" }] : [])],
        list: [{ k: "First", v: `${niceDay(firstN.date)} · ${nightName(firstN)}` }, ...(latest !== firstN ? [{ k: "Latest", v: `${niceDay(latest.date)} · ${nightName(latest)}` }] : [])] }, { summary: true });
      return { ...base, cards, numbers: { hosted: rows.length, guests: guests.size, regulars, kudos: K.length, hoodsFrom: hoodsFrom.size } };
    }
    // the guest edition (every night: went and hosted)
    const earlier = new Set(nightsOf(me, { withHidden: false }).filter((r) => r.year && r.year < Y && r.area).map((r) => r.area.key)), fresh = hoods.filter((a) => !earlier.has(a.key));
    add("intro", { kicker: yr + (kindLabel ? ` · ${kindLabel}` : ""), title: unit(rows.length, "night", "nights"), sub: hoods.length ? `in ${unit(hoods.length, "neighbourhood", "neighbourhoods")}` : "", map: m, body: potto.intro, potto: "wave", big: true });
    if (hoods.length) { const names = (L) => (L.length <= 2 ? L.map((a) => a.label).join(" and ") : `${L.slice(0, 2).map((a) => a.label).join(", ")} and ${L.length - 2} more`);
      add("hoods", fresh.length ? { kicker: "New on your map", title: unit(fresh.length, "new neighbourhood", "new neighbourhoods"), sub: `First time in ${names(fresh)}.`, map: mapOf(fresh, fresh[0]?.city || "new"), tone: "sky" }
        : { kicker: "Your corners", title: unit(hoods.length, "neighbourhood", "neighbourhoods"), sub: `Back to ${names(hoods)}.`, map: m, tone: "sky" }); }
    const hostN = new Map(); for (const r of rows) if (r.role !== "hosted" && r.host) { const k = r.host.handle; hostN.set(k, { h: r.host, n: (hostN.get(k)?.n || 0) + 1, pub: (hostN.get(k)?.pub || false) || r.public, art: r.art }); }
    const top = [...hostN.values()].sort((a, b) => b.n - a.n)[0];
    if (top && top.n > 1) add("route", { kicker: "Your favourite route", title: top.pub ? top.h.name : "One host, many nights", sub: `${unit(top.n, "night", "nights")} at the same table.`, art: top.art, body: potto.route, tone: "peach" });
    const st = weeksStreak(rows); if (st.n > 1) add("streak", { kicker: "Longest streak", title: unit(st.n, "week", "weeks") + " in a row", sub: `From ${niceDay(st.from)} to ${niceDay(st.to)}.`, art: "fireworks", body: potto.streak, tone: "mint" });
    const kc = {}; for (const r of rows) kc[r.kind] = (kc[r.kind] || 0) + 1; const fav = Object.entries(kc).sort((a, b) => b[1] - a[1])[0];
    if (fav && !KINDS[type]) add("kind", { kicker: "Favourite kind of night", title: KINDS[fav[0]].label, sub: `${fav[1]} of your ${unit(rows.length, "night", "nights")}.`, art: KINDS[fav[0]].art, tone: "butter" });
    // a human moment: words someone wrote about you (kudos on what you hosted), else your own words to a host
    const ids = new Set(rows.map((r) => r.id)), got = I.kudos.filter((k) => ids.has(k.eventId) && k.love && k.email !== me && rows.find((r) => r.id === k.eventId)?.role === "hosted").sort((a, b) => b.love.length - a.love.length)[0];
    const gave = I.kudos.filter((k) => ids.has(k.eventId) && k.love && k.email === me).sort((a, b) => b.love.length - a.love.length)[0];
    if (got) { const r = rows.find((x) => x.id === got.eventId), by = nameForCard(got.email, me); add("quote", { kicker: "In someone's words", quote: { text: scrubQuote(got.love, othersAt(I, got.eventId, me)), by: by ? `${by}, after ${nightName(r)}` : `A guest at ${nightName(r)}` }, potto: "cheer", tone: "blush" }); }
    else if (gave) { const r = rows.find((x) => x.id === gave.eventId), ow = getDbUser(lc(getWorkspace(I.events.get(gave.eventId)?.ws)?.ownerEmail || ""))?.name; add("quote", { kicker: "In your words", quote: { text: scrubQuote(gave.love, [...othersAt(I, gave.eventId, me), ...(r && !r.public && ow ? [first(ow)] : [])]), by: `You, after ${nightName(r)}` }, potto: "cheer", tone: "blush" }); }
    // your favourite night: one you took photos at, else one you sent kudos for, else the one of your favourite kind
    const favNight = rows.find((r) => r.photos.length) || (gave && rows.find((r) => r.id === gave.eventId)) || rows.find((r) => fav && r.kind === fav[0]) || latest;
    add("photo", { kicker: "A night to keep", title: nightName(favNight), sub: [niceDay(favNight.date), favNight.area?.hood || favNight.area?.city].filter(Boolean).join(" · "), art: favNight.art, tone: "lilac" }, { photo: favNight.photos[0] || "", photoNote: favNight.photos[0] ? "Only you see this photo. Cards you save use the drawing." : "" });
    add("firsts", { kicker: "First and latest", title: latest === firstN ? "One night to start" : `${monthOf(firstN.date)} to ${monthOf(latest.date)}`, list: [{ k: "First", v: `${niceDay(firstN.date)} · ${nightName(firstN)}` }, ...(latest !== firstN ? [{ k: "Latest", v: `${niceDay(latest.date)} · ${nightName(latest)}` }] : [])], art: latest.art, tone: "sand" });
    add("summary", { kicker: `${yr}, all in one` + (kindLabel ? ` · ${kindLabel}` : ""), title: unit(rows.length, "night", "nights"),
      stats: [{ n: String(rows.length), label: rows.length === 1 ? "night" : "nights" }, { n: String(hoods.length), label: hoods.length === 1 ? "neighbourhood" : "neighbourhoods" }, ...(st.n > 1 ? [{ n: unit(st.n, "week", "weeks"), label: "longest streak" }] : []), ...(fav && !KINDS[type] ? [{ n: KINDS[fav[0]].one, label: "favourite kind" }] : []), ...(top && top.n > 1 && top.pub ? [{ n: String(top.n), label: `nights with ${top.h.name}` }] : [])].slice(0, 4),
      list: [{ k: "First", v: `${niceDay(firstN.date)} · ${nightName(firstN)}` }, ...(latest !== firstN ? [{ k: "Latest", v: `${niceDay(latest.date)} · ${nightName(latest)}` }] : [])], map: m }, { summary: true });
    return { ...base, cards, numbers: { nights: rows.length, hoods: hoods.length, newHoods: fresh.length, streak: st.n, favourite: fav?.[0] || "", topHost: top?.n > 1 ? top.n : 0 } };
  }

  // ---- share links ----
  const tokOk = (t) => /^[A-Za-z0-9_-]{16,40}$/.test(t || "");
  function setShare(email, year, { on = true, type = "all", edition = "guest" } = {}) { const S = settings(email), share = { ...S.share }, Y = String(+year);
    if (!on) { if (share[Y]) { try { store.delete("system/plyshare-" + share[Y]); } catch {} delete share[Y]; } }
    else { const t = share[Y] || crypto.randomBytes(15).toString("base64url"); share[Y] = t; put("plyshare-" + t, { kind: "plyshare", email: lc(email), year: +Y, type: KINDS[type] ? type : "all", edition: edition === "host" ? "host" : "guest", at: now() }); }
    put(prefKey(email), { kind: "plplaces", email: lc(email), ...S, share, at: now() }); return share[Y] || ""; }
  function shared(token) { if (!tokOk(token)) return null; const s = sys("plyshare-" + token); if (!s || s.off || s.kind !== "plyshare" || !s.email) return null; if (settings(s.email).share[String(s.year)] !== token) return null; return s; }

  // ---- prompts: a calm card on Home in December, and at a milestone night ----
  const MILESTONES = [10, 25, 50, 100];
  function prompt(email) { const t = iso(now()), Y = +t.slice(0, 4), rows = nightsOf(email, { year: Y, withHidden: false }), n = rows.length; if (!n) return { show: false };
    if (t.slice(5, 7) === "12") return { show: true, kind: "december", key: "dec-" + Y, title: `Your ${Y} in nights is ready`, line: `${lineOf(rows, Y)}. A minute of cards, free, on web and phone.`, link: `/year/${Y}`, cta: "See your year" };
    const latest = rows[0]; if (MILESTONES.includes(n) && latest?.date && Date.parse(latest.date) > now() - 14 * DAY) return { show: true, kind: "milestone", key: `ms-${Y}-${n}`, title: `Your ${n}th night this year`, line: n === 10 ? "Ten nights out. That's a habit now. A good one." : `${n} nights. Every one of them counted.`, link: `/year/${Y}`, cta: "See your year so far" };
    return { show: false }; }

  return { settings, setSettings, setHidden, index, bust, nightsOf, mine, forProfile, friendsLayer, story, setShare, shared, prompt, blocked, mutual, lineOf };
}

// ---------------------------------------------------------------- routes
export function mountPlaces(app, { store, small, currentUser, C, X, sendStatic }) {
  const P = makePlaces({ store, C, X, geo: app.locals.geo || null }); app.locals.places = P;
  const hits = new Map(); const limited = (req, n) => { const k = (req.ip || "?") + "|places", t = Date.now(); let h = hits.get(k); if (!h || t - h.start > 3600e3) { h = { n: 0, start: t }; hits.set(k, h); if (hits.size > 20000) hits.clear(); } return ++h.n > n; };
  const me = (req, res) => { const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) { res.status(401).json({ code: "unauthenticated", message: "Sign in to see your places." }); return null; } return u; };
  const yearOf = (v) => (/^20\d\d$/.test(String(v || "")) ? +v : +iso(Date.now()).slice(0, 4));
  const typeOf = (v) => (["all", "hosted", "went", ...Object.keys(KINDS)].includes(String(v || "")) ? String(v) : "all");
  const editionOf = (v) => (v === "host" ? "host" : "guest");
  const png = (res, buf, priv) => { res.set({ "Content-Type": "image/png", "Cache-Control": priv ? "private, max-age=300" : "public, max-age=600", "Content-Disposition": "inline" }); res.send(buf); };
  const pickCard = (S, id) => S.cards.find((c) => c.id === id) || null;

  app.get("/api/me/places", (req, res) => { const u = me(req, res); if (!u) return; res.set("Cache-Control", "private, no-store"); res.json(P.mine(u.email, { year: yearOf(req.query.year), type: typeOf(req.query.type) })); });
  app.get("/api/public/places/:handle", (req, res) => { if (limited(req, 2000)) return res.status(429).json({ code: "rate_limited", message: "Slow down a little." }); res.set("Cache-Control", "private, no-store");
    const v = currentUser(req), viewer = v && v.ws !== DEFAULT_WS ? v.email : ""; res.json(P.forProfile(clean(req.params.handle, 40), viewer, { year: yearOf(req.query.year), type: typeOf(req.query.type) })); });
  app.get("/api/me/places/friends", (req, res) => { const u = me(req, res); if (!u) return; res.set("Cache-Control", "private, no-store"); res.json(P.friendsLayer(u.email, { year: /^20\d\d$/.test(String(req.query.year || "")) ? +req.query.year : 0 })); });
  app.get("/api/me/places/settings", (req, res) => { const u = me(req, res); if (!u) return; res.set("Cache-Control", "private, no-store"); const { share, ...s } = P.settings(u.email); res.json(s); });
  app.put("/api/me/places/settings", small, (req, res) => { const u = me(req, res); if (!u) return; const { share, ...s } = P.setSettings(u.email, req.body || {}); res.json({ ok: true, ...s }); });
  app.put("/api/me/places/hide", small, (req, res) => { const u = me(req, res); if (!u) return; const id = clean(req.body?.eventId, 120); if (!(P.index().nights.get(lc(u.email)) || []).some((n) => n.id === id)) return res.status(404).json({ code: "not_found", message: "That isn't one of your places." });
    const s = P.setHidden(u.email, id, req.body?.hidden !== false); res.json({ ok: true, hidden: s.hidden }); });
  app.get("/api/me/places/prompt", (req, res) => { const u = currentUser(req); res.set("Cache-Control", "private, no-store"); if (!u || u.ws === DEFAULT_WS) return res.json({ show: false }); res.json(P.prompt(u.email)); });
  // the story
  app.get("/year/:year", (req, res) => { if (!/^20\d\d$/.test(req.params.year)) { res.status(404); return sendStatic(res, "404.html", "<p>Page not found.</p>"); } sendStatic(res, "year.html", "<p>Year page missing.</p>"); });
  app.get("/api/me/year/:year", (req, res) => { const u = me(req, res); if (!u) return; res.set("Cache-Control", "private, no-store"); const Y = yearOf(req.params.year), S = P.story(u.email, { year: Y, type: typeOf(req.query.type), edition: editionOf(req.query.edition) }), tok = P.settings(u.email).share[String(Y)] || "";
    res.json({ ...S, share: { on: !!tok, url: tok ? "/y/" + tok : "" } }); });
  app.get("/api/me/year/:year/card/:id.png", async (req, res) => { const u = me(req, res); if (!u) return; const S = P.story(u.email, { year: yearOf(req.params.year), type: typeOf(req.query.type), edition: editionOf(req.query.edition) }), c = pickCard(S, clean(req.params.id, 20));
    if (!c) return res.status(404).json({ code: "not_found", message: "No such card." }); png(res, await renderCardAsync(c.spec, req.query.size === "link" ? "link" : "story"), true); });
  app.put("/api/me/year/:year/share", small, (req, res) => { const u = me(req, res); if (!u) return; const t = P.setShare(u.email, yearOf(req.params.year), { on: req.body?.on !== false, type: typeOf(req.body?.type), edition: editionOf(req.body?.edition) }); res.json({ ok: true, on: !!t, url: t ? "/y/" + t : "" }); });
  // the public link: only the cards, as they are on the PNGs; a "Make your own"
  const publicStory = (s) => { const S = P.story(s.email, { year: s.year, type: s.type, edition: s.edition }); return { year: S.year, live: S.live, edition: S.edition, first: S.first, cards: S.cards.map((c) => ({ id: c.id, spec: c.spec, summary: !!c.summary })) }; };
  app.get("/api/public/year/:token", (req, res) => { if (limited(req, 2000)) return res.status(429).json({ code: "rate_limited", message: "Slow down a little." }); const s = P.shared(String(req.params.token)); if (!s) return res.status(404).json({ code: "not_found", message: "This link was turned off." }); res.set("Cache-Control", "public, max-age=120"); res.json(publicStory(s)); });
  app.get("/y/:token/:id.png", async (req, res) => { if (limited(req, 2000)) return res.status(429).end(); const s = P.shared(String(req.params.token)); if (!s) return res.status(404).end(); const S = publicStory(s), c = S.cards.find((x) => x.id === clean(req.params.id, 20)); if (!c) return res.status(404).end(); png(res, await renderCardAsync(c.spec, req.query.size === "link" ? "link" : "story"), false); });
  app.get("/y/:token", async (req, res) => { const s = P.shared(String(req.params.token)); let html = ""; try { html = await fs.promises.readFile(path.join(PUBLIC, "year.html"), "utf8"); } catch { return res.status(500).send("Year page missing."); }
    if (!s) { res.status(404); return res.type("html").send(html.replace("<!--og-->", `<meta name="robots" content="noindex">`)); }
    const S = publicStory(s), intro = S.cards[0]?.spec || {}, esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const title = `${S.first ? S.first + "'s" : "A"} ${S.year} in nights`, desc = cardText([intro.title, intro.sub].filter(Boolean).join(" "), 160), img = `/y/${encodeURIComponent(req.params.token)}/summary.png?size=link`;
    res.set("Cache-Control", "public, max-age=120").type("html").send(html.replace("<!--og-->", `<meta name="robots" content="noindex"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:image" content="${esc(img)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">`).replace(/<title>[^<]*<\/title>/, `<title>${esc(title)} · Pottery Lab</title>`)); });
  return P;
}
export { textOf, SIZES };
