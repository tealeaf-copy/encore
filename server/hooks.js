// Hooks for new people: "What are you into?" (interests and a city), Inspo (/ideas), saves and boards (/saved),
// a guest's "Your scene" passport, "Friends going" on public events, saved-event reminders and the weekend digest.
//
// Where the data comes from, and what never shows:
// - Inspo and suggestions read the events directory (server/directory.js): only events and hosts a public page already
//   shows (upcoming open events, past events and scrapbook photos from host pages). Prepared and sample pages are
//   marked example. Guest-only photos (moments) never show here. Ideas come from server/ideas.js and are suggestions,
//   never events: no host, no counts.
// - Saves: one record per signed-in person (system/plsave-<hash>), with optional boards. Visitors keep saves in their
//   browser and send them on signup (POST /api/me/saves {merge}). "Saved N times" counts only these server records.
// - Friends going: people you follow (friends, and hosts you follow) who replied I'm in to a public, listed event that
//   doesn't hide its guests, and who didn't hide themselves (showMe). Only first names, the same names the event's
//   "Who's coming" shows.
// - The weekend digest and saved-event reminders go to the bell, and by email (list "guest", so unsubscribe works) when
//   email is set up. Nothing is sent when nothing matches.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { scopeStore, getWorkspace, allWorkspaceIds, workspaceOfEvent, DEFAULT_WS, getDbUser } from "./workspaces.js";
import { emailConfig, sendEmail } from "./email.js";
import { buildIdeas } from "./ideas.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(here, "..", "public");
const DAY = 864e5;
const lc = (s) => String(s || "").trim().toLowerCase();
const hash = (s) => crypto.createHash("sha256").update(lc(s)).digest("hex").slice(0, 24);
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (d, n) => iso(Date.parse(d + "T12:00:00Z") + n * DAY);
const dow = (d) => new Date(d + "T12:00:00Z").getUTCDay();
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const niceDate = (d) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "")) return ""; const x = new Date(d + "T12:00:00Z"); return `${WEEKDAY[x.getUTCDay()].slice(0, 3)}, ${MON[x.getUTCMonth()]} ${x.getUTCDate()}`; };
const ID_OK = /^[A-Za-z0-9_-]{1,120}$/, HANDLE = /^[a-z0-9][a-z0-9-]{1,29}$/, IDEA_OK = /^idea-[a-z0-9-]{1,60}$/;
const IMG_OK = (u) => /^\/_blob\/[A-Za-z0-9]{20}$/.test(u || "") || /^\/presets\/[A-Za-z0-9_.-]{1,80}$/.test(u || "") || /^https:\/\/[^\s"'<>()]{1,400}$/.test(u || "");

export const INTERESTS = (() => { try { return JSON.parse(fs.readFileSync(path.join(PUBLIC, "interests.json"), "utf8")).interests || []; } catch { return []; } })();
const INTEREST_IDS = new Set(INTERESTS.map((i) => i.id));
// the looks the app offers (public/looks.js VIBES), so an idea's "Host this" carries the same look the card shows
export const VIBES = (() => { try { const box = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(PUBLIC, "looks.js"), "utf8"), box, { timeout: 500 }); return box.window.EncoreLooks?.VIBES || {}; } catch { return {}; } })();
export const IDEAS = buildIdeas(INTERESTS);
const IDEA_BY_ID = new Map(IDEAS.map((x) => [x.id, x]));
const reWord = new Map(); const wordRe = (w) => { if (!reWord.has(w)) reWord.set(w, new RegExp(`(^|[^a-z0-9\u00c0-\u024f])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9\u00c0-\u024f]|$)`, "i")); return reWord.get(w); };
/** Which interests some text (and a directory format) is about. */
export function interestsOf(text, format = "") { const t = String(text || "").toLowerCase(), f = lc(format);
  return INTERESTS.filter((i) => (f && (i.formats || []).includes(f)) || (i.words || []).some((w) => wordRe(w).test(t))).map((i) => i.id); }
export const cleanInterests = (L) => [...new Set((Array.isArray(L) ? L : String(L || "").split(",")).map((x) => lc(x)).filter((x) => INTEREST_IDS.has(x)))].slice(0, 20);
const FORMAT_LABEL = { dinner: "Supper club", run: "Run club", hike: "Hike", workshop: "Workshop", class: "Class", "pop-up": "Pop-up", coffee: "Coffee", picnic: "Picnic", "game night": "Game night", "book club": "Book club", drinks: "Drinks", movement: "Movement", party: "Party", brunch: "Brunch", meetup: "Meetup", summit: "Summit", conference: "Conference", panel: "Panel", online: "Online", tour: "Tour", launch: "Launch", offsite: "Offsite", talk: "Talk", keynote: "Keynote", podcast: "Podcast", webinar: "Webinar" };
/** This weekend, as dates: Friday to Sunday (from today when it's already the weekend). */
export function weekendOf(now = Date.now()) { const t = iso(now), d = dow(t); if (d === 6) return { from: t, to: addDays(t, 1) }; if (d === 0) return { from: t, to: t }; const fri = addDays(t, 5 - d); return { from: d === 5 ? t : fri, to: addDays(fri, 2) }; }

export function makeHooks({ store, C, X, Dir, SB }) {
  const sys = (k) => store.get("system/" + k)?.data;
  const put = (k, v) => store.set("system/" + k, v);
  const rel = (base, u) => { const s = String(u || ""); return base && s.startsWith(base) ? s.slice(base.length) || "/" : s; };
  const isUser = (email) => !!getDbUser(lc(email));

  // ---- interests ----
  const iKey = (email) => "plint-" + hash(email);
  const interestsOfUser = (email) => { const d = sys(iKey(email)); return { interests: cleanInterests(d?.interests), city: clean(d?.city, 60), at: d?.at || null }; };
  function setInterests(email, { interests, city }) { const v = { kind: "plint", email: lc(email), interests: cleanInterests(interests), city: clean(city, 60), at: Date.now() }; put(iKey(email), v); return { interests: v.interests, city: v.city, at: v.at }; }

  // ---- saves and boards ----
  const sKey = (email) => "plsave-" + hash(email);
  const savesRaw = (email) => { const d = sys(sKey(email)) || {}; return { items: Array.isArray(d.items) ? d.items : [], boards: Array.isArray(d.boards) ? d.boards : [] }; };
  let countCache = null; const bustCounts = () => { countCache = null; };
  const writeSaves = (email, v) => { put(sKey(email), { kind: "plsave", email: lc(email), items: v.items.slice(0, 500), boards: v.boards.slice(0, 40), at: Date.now() }); bustCounts(); };
  const refOk = (kind, ref) => (kind === "event" ? ID_OK.test(ref) : kind === "idea" ? IDEA_OK.test(ref) : kind === "host" ? HANDLE.test(ref) : false);
  /** One save from what a client sent: kind, ref, an optional board and a small snapshot (title, image) for its own collage. */
  function cleanSave(x, boards) { const kind = lc(x?.kind), ref = String(x?.ref || "").trim(); if (!refOk(kind, ref)) return null;
    const board = boards.some((b) => b.id === x?.board) ? x.board : "";
    return { kind, ref, board, title: clean(x?.title, 140), img: IMG_OK(x?.img) ? x.img : "", at: Math.min(Number.isFinite(+x?.at) && +x.at > 0 ? +x.at : Date.now(), Date.now()) }; }
  function addSave(email, x) { const S = savesRaw(email), s = cleanSave(x, S.boards); if (!s) return null; const cur = S.items.find((i) => i.kind === s.kind && i.ref === s.ref);
    if (cur) { if (x.board !== undefined) cur.board = s.board; if (s.title && !cur.title) cur.title = s.title; if (s.img && !cur.img) cur.img = s.img; } else S.items.unshift(s);
    writeSaves(email, S); return { saved: cur || s, isNew: !cur }; }
  function removeSave(email, kind, ref) { const S = savesRaw(email), n = S.items.length; S.items = S.items.filter((i) => !(i.kind === kind && i.ref === ref)); if (S.items.length !== n) writeSaves(email, S); return n !== S.items.length; }
  function mergeSaves(email, list) { const S = savesRaw(email); let n = 0;
    for (const x of (Array.isArray(list) ? list : []).slice(0, 200)) { const s = cleanSave({ ...x, board: "" }, S.boards); if (!s || S.items.some((i) => i.kind === s.kind && i.ref === s.ref)) continue; S.items.push(s); n++; }
    if (n) { S.items.sort((a, b) => b.at - a.at); writeSaves(email, S); } return n; }
  function addBoard(email, name) { const S = savesRaw(email), nm = clean(name, 40); if (!nm) return null; const have = S.boards.find((b) => lc(b.name) === lc(nm)); if (have) return have; if (S.boards.length >= 40) return null;
    const b = { id: "b" + crypto.randomBytes(5).toString("hex"), name: nm, at: Date.now() }; S.boards.push(b); writeSaves(email, S); return b; }
  function renameBoard(email, id, name) { const S = savesRaw(email), b = S.boards.find((x) => x.id === id), nm = clean(name, 40); if (!b || !nm) return null; b.name = nm; writeSaves(email, S); return b; }
  function dropBoard(email, id) { const S = savesRaw(email); if (!S.boards.some((b) => b.id === id)) return false; S.boards = S.boards.filter((b) => b.id !== id); for (const i of S.items) if (i.board === id) i.board = ""; writeSaves(email, S); return true; }
  /** How many people saved each thing: real saves on accounts only. */
  function counts() { if (countCache && Date.now() - countCache.at < 20_000) return countCache.map; const m = new Map();
    for (const d of store.list("system")) { const v = d.data; if (v?.kind !== "plsave" || !Array.isArray(v.items)) continue; for (const i of v.items) { const k = i.kind + ":" + i.ref; m.set(k, (m.get(k) || 0) + 1); } }
    countCache = { at: Date.now(), map: m }; return m; }
  const countOf = (kind, ref) => counts().get(kind + ":" + ref) || 0;

  // ---- the directory, as cards ----
  let cat = null;
  function hostsOf(base) { const out = new Map(); let cursor = ""; for (let i = 0; i < 50; i++) { const p = Dir.listHosts(base, { include_examples: "1", limit: 100, cursor }); for (const h of p.data) out.set(h.handle, h); if (!p.next_cursor) break; cursor = p.next_cursor; } return out; }
  function eventLine(e) { const f = FORMAT_LABEL[e.format] || (e.format && e.format !== "other" ? e.format[0].toUpperCase() + e.format.slice(1) : "");
    const when = e.status === "upcoming" ? [niceDate(e.start), e.time.split(" to ")[0]].filter(Boolean).join(" · ") : e.start ? `Past · ${MON[+e.start.slice(5, 7) - 1]} ${+e.start.slice(8, 10)}` : "Past";
    return [f, e.status === "upcoming" ? e.price : "", when, e.area || e.city].filter(Boolean).slice(0, 3).join(" · "); }
  function catalog(base) {
    const ttl = process.env.ENCORE_DIRECTORY_CACHE_MS != null ? Math.max(0, +process.env.ENCORE_DIRECTORY_CACHE_MS || 0) : 30_000; if (cat && cat.base === base && Date.now() - cat.at < ttl) return cat;
    const H = hostsOf(base), items = [], events = new Map(), today = iso(Date.now());
    const SBcache = new Map(), sbOf = (ws) => { if (!SBcache.has(ws)) { let L = []; try { L = SB.publicItems(ws) || []; } catch {} SBcache.set(ws, L); } return SBcache.get(ws); };
    for (const e of Dir.filterEvents(base, { status: "all", include_examples: "1" })) {
      if (e._dup) continue; const h = H.get(e.host.handle), example = !!(e.example || h?.example || h?.prepared), url = rel(base, e.url);
      const ws = e.source === "hosted" ? workspaceOfEvent(e.id) : C.wsOfHandle(e.host.handle), doc = e.source === "hosted" && ws ? scopeStore(store, ws).get("events/" + e.id)?.data : null;
      let tags = interestsOf(`${e.title} ${(e.tags || []).join(" ")} ${doc?.activity || ""}`, e.format); if (!tags.length && h) tags = interestsOf((h.tags || []).join(" ") + " " + (h.tagline || ""), "");
      const L = doc?.look && typeof doc.look === "object" && (doc.look.palette || []).some((c) => /^#[0-9a-f]{6}$/i.test(c)) ? { palette: doc.look.palette.slice(0, 3), effect: doc.look.effect || "", titleFont: doc.look.titleFont || "", buttonEmoji: doc.look.buttonEmoji || "", buttonLabel: doc.look.buttonLabel || "", vibe: doc.look.vibe || "" } : null;
      const art = { activity: clean(doc?.activity || e.format, 40), kind: clean(doc?.coverArt?.kind, 30), tone: clean(doc?.coverArt?.tone, 12) };
      const card = { title: e.title, line: eventLine(e), host: { handle: e.host.handle, name: e.host.name, url: rel(base, e.host.url) }, city: e.city, area: e.area, tags, example, status: e.status, date: e.start,
        real: { url }, save: { kind: "event", ref: e.id }, hostThis: { say: `${e.title}${FORMAT_LABEL[e.format] ? ", a " + FORMAT_LABEL[e.format].toLowerCase() : ""}`, vibe: L?.vibe || "", look: L } };
      events.set(e.id, { e, card, example });
      const cover = rel(base, e.cover);
      if (cover && IMG_OK(cover)) items.push({ id: "ev-" + e.id, type: "photo", img: cover, ...card });
      if (L) items.push({ id: "fl-" + e.id, type: "flyer", look: L, art, ...card });
      if (!cover && !L && e.status === "upcoming") items.push({ id: "ev-" + e.id, type: "art", art, ...card });
      if (e.source === "scrapbook" && ws) { const sb = sbOf(ws).find((x) => `sb-${e.host.handle}-${String(x.id).replace(/[^A-Za-z0-9_-]/g, "")}` === e.id);
        (sb?.photos || []).filter(IMG_OK).slice(0, 4).forEach((p, i) => { if (p !== cover) items.push({ id: `ph-${e.id}-${i}`, type: "photo", img: p, ...card }); }); }
    }
    for (const x of IDEAS) { const look = VIBES[x.vibe]?.look ? { ...VIBES[x.vibe].look, vibe: x.vibe } : null;
      items.push({ id: x.id, type: "idea", title: x.title, line: x.line, art: { kind: x.art, tone: x.tone }, look, host: null, city: "", area: "", tags: x.interests, example: false, status: "idea", date: "", real: null, save: { kind: "idea", ref: x.id }, hostThis: { say: x.say, vibe: x.vibe, look } }); }
    cat = { at: Date.now(), base, items, hosts: H, events, today };
    return cat;
  }
  const cityHit = (x, city) => !!city && `${x.city || ""} ${x.area || ""}`.toLowerCase().includes(lc(city));
  /** The Inspo wall: every card, best first for these interests and this city, kinds mixed so it never reads as a list. */
  function inspo(base, { interests = [], city = "", tag = "", cursor = "", limit = 24 } = {}) {
    const I = cleanInterests(interests), T = cleanInterests([tag])[0] || "", K = catalog(base), M = counts(), lim = Math.max(1, Math.min(60, Math.round(+limit) || 24));
    let L = K.items.filter((x) => !T || x.tags.includes(T)).map((x, i) => {
      let s = 0; if (I.length && x.tags.some((t) => I.includes(t))) s += 3; if (cityHit(x, city)) s += 2; if (x.type === "photo") s += 1.2; if (x.status === "upcoming") s += 1; if (x.example) s -= 1.5; if (x.type === "idea") s += 0.3;
      // a steady shuffle that changes daily, so the wall isn't always in the same order
      const j = parseInt(hash(x.id + K.today).slice(0, 6), 16) / 0xffffff; return { x, s: s + j * 1.6, i }; }).sort((a, b) => b.s - a.s || a.i - b.i).map((r) => r.x);
    // mix: no more than two cards of one kind in a row when something else is close behind
    const out = []; while (L.length) { const t1 = out.at(-1)?.type, t2 = out.at(-2)?.type; let k = 0; if (t1 && t1 === t2) { const j = L.slice(0, 6).findIndex((x) => x.type !== t1); if (j > 0) k = j; } out.push(L[k]); L.splice(k, 1); }
    const off = (() => { try { const m = Buffer.from(String(cursor || ""), "base64url").toString().match(/^i:(\d{1,6})$/); return m ? +m[1] : 0; } catch { return 0; } })();
    const page = out.slice(off, off + lim).map((x) => ({ ...x, saves: M.get(x.save.kind + ":" + x.save.ref) || 0 }));
    return { data: page, next_cursor: off + lim < out.length ? Buffer.from("i:" + (off + lim)).toString("base64url") : null, total: out.length };
  }
  const inspoItem = (base, id) => { const x = catalog(base).items.find((i) => i.id === id); return x ? { ...x, saves: countOf(x.save.kind, x.save.ref) } : null; };

  // ---- suggestions ----
  function suggestHosts(base, { interests = [], city = "", limit = 6, exclude = [] } = {}) {
    const I = cleanInterests(interests), K = catalog(base), ex = new Set(exclude), up = new Map();
    for (const { e } of K.events.values()) if (e.status === "upcoming") { const L = up.get(e.host.handle) || []; L.push(e); up.set(e.host.handle, L); }
    const scored = [...K.hosts.values()].filter((h) => !ex.has(h.handle)).map((h) => { const tags = interestsOf(`${(h.tags || []).join(" ")} ${h.tagline} ${(h.formats || []).join(" ")}`, ""); for (const f of h.formats || []) for (const t of interestsOf("", f)) if (!tags.includes(t)) tags.push(t);
      const hit = I.filter((t) => tags.includes(t)), inCity = cityHit(h, city), example = !!(h.example || h.prepared);
      const s = hit.length * 3 + (inCity ? 2 : 0) + (h.upcoming_count ? 1 : 0) + Math.min(1, (h.reviews?.count || 0) / 5) + (h.past_count ? 0.3 : 0);
      const next = (up.get(h.handle) || [])[0];
      return { h, s, hit, inCity, example, tags, next }; }).filter((x) => x.hit.length || x.inCity || !I.length);
    const real = scored.filter((x) => !x.example).sort((a, b) => b.s - a.s), demo = scored.filter((x) => x.example && (x.hit.length || x.inCity)).sort((a, b) => b.s - a.s);
    const lim = Math.max(3, Math.min(6, +limit || 6)), pick = real.slice(0, lim); if (pick.length < 3) pick.push(...demo.slice(0, 3 - pick.length));
    return pick.map(({ h, hit, inCity, example, tags, next }) => ({ handle: h.handle, name: h.name, url: rel(base, h.url), city: h.city, area: h.area, tagline: h.tagline, emoji: h.emoji, avatar: rel(base, h.avatar), example,
      why: [...hit.map((t) => INTERESTS.find((i) => i.id === t)?.label), inCity ? h.area || h.city : ""].filter(Boolean).slice(0, 2).join(" · "), tags: tags.slice(0, 4), upcoming: h.upcoming_count, past: h.past_count,
      next: next ? { id: next.id, title: next.title, date: next.start, url: rel(base, next.url), cover: rel(base, next.cover) } : null, saves: countOf("host", h.handle) })); }
  function evCard(base, e) { return { id: e.id, title: e.title, date: e.start, when: [niceDate(e.start), e.time.split(" to ")[0]].filter(Boolean).join(" · "), city: e.city, area: e.area, format: e.format, price: e.price, spots_left: e.spots_left,
    host: { handle: e.host.handle, name: e.host.name, url: rel(base, e.host.url) }, url: rel(base, e.url), cover: rel(base, e.cover), tags: interestsOf(`${e.title} ${(e.tags || []).join(" ")}`, e.format), example: !!e.example, saves: countOf("event", e.id) }; }
  /** Upcoming public events this weekend (Fri to Sun) for these interests and this city. Real hosts only. */
  function weekend(base, { interests = [], city = "", saved = [], now = Date.now(), limit = 8 } = {}) {
    const I = cleanInterests(interests), W = weekendOf(now), want = new Set(saved);
    const L = Dir.filterEvents(base, { status: "upcoming", from: W.from, to: W.to }).filter((e) => !e.example && !e._dup).map((e) => { const tags = interestsOf(`${e.title} ${(e.tags || []).join(" ")}`, e.format);
      const fit = (!I.length || tags.some((t) => I.includes(t))) && (!city || cityHit(e, city)); return { e, fit, saved: want.has(e.id) }; }).filter((x) => x.fit || x.saved);
    return { from: W.from, to: W.to, events: L.slice(0, limit).map((x) => ({ ...evCard(base, x.e), saved: x.saved })) }; }

  // ---- friends going ----
  function followSet(email) { const me = lc(email), S = new Set(X.friendsOf(me).map((f) => lc(f.email)));
    for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; try { if (C.followersOf(ws).some((f) => lc(f.email) === me)) { const o = lc(getWorkspace(ws)?.ownerEmail); if (o) S.add(o); } } catch {} }
    S.delete(me); return S; }
  /** For each event: people this person follows who replied I'm in, by first name, where the event shows its guests. */
  function friendsGoing(email, ids) { const F = followSet(email), out = {}; if (!F.size) return out;
    for (const id of ids.slice(0, 40)) { if (!ID_OK.test(id)) continue; const ws = workspaceOfEvent(id); if (!ws) continue; const S = scopeStore(store, ws), ev = S.get("events/" + id)?.data;
      // public and listed, and the event shows who's coming: the same rule as its "Who's coming" list
      if (!ev || ev.example || !ev.discoverable || ev.unlisted || ev.hideGuests) continue;
      const seen = new Set(), people = [];
      for (const d of S.list("rsvps").sort((x, y) => (x.data?.createdAt || 0) - (y.data?.createdAt || 0))) { const r = d.data || {}, em = lc(r.email); if (r.eventId !== id || r.response !== "going" || r.noShow || r.showMe === false || !em || !F.has(em) || seen.has(em)) continue; seen.add(em);
        const p = X.person(em), name = first(r.name) || first(p.name); if (!name) continue; people.push({ name, emoji: p.emoji || "🙂", color: p.color || "#E26D8E", handle: p.handle || null }); }
      if (people.length) out[id] = { count: people.length, people: people.slice(0, 5), line: friendsLine(people.map((p) => p.name)) }; }
    return out; }
  const friendsLine = (names) => (names.length === 1 ? `${names[0]} is in` : names.length === 2 ? `${names[0]} and ${names[1]} are in` : `${names[0]} and ${names.length - 1} friends are in`);

  // ---- the passport ("Your scene") ----
  function passport(email) { const me = lc(email), I = X.index(), today = iso(Date.now()), A = I.att.get(me) || [];
    const row = (a) => { const x = I.events.get(a.eventId); if (!x) return null; const e = x.e, h = C.profileOf(x.ws) || {}, pub = !!e.discoverable && !e.unlisted;
      return { eventId: a.eventId, title: clean(e.pubTitle || e.name, 120), date: e.date || "", activity: clean(e.activity, 40), kind: clean(e.coverArt?.kind, 30), interests: interestsOf(`${e.pubTitle || e.name} ${e.activity || ""}`, ""), host: { name: clean(h.name, 60), handle: h.handle || null, emoji: h.emoji || "" }, city: clean(e.city, 60), public: pub, url: pub ? "/e/" + encodeURIComponent(a.eventId) : "" }; };
    const all = A.map(row).filter(Boolean), stamps = all.filter((s) => s.date && s.date <= today).sort((a, b) => b.date.localeCompare(a.date)), next = all.filter((s) => !s.date || s.date > today).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const hosts = []; for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; try { const f = C.followersOf(ws).find((x) => lc(x.email) === me); if (!f) continue; const h = C.profileOf(ws); if (h?.handle) hosts.push({ handle: h.handle, name: clean(h.name || h.handle, 60), emoji: h.emoji || "", at: f.at || 0 }); } catch {} }
    hosts.sort((a, b) => b.at - a.at);
    const kudos = I.kudos.filter((k) => lc(k.email) === me).length, p = X.person(me);
    const kinds = [...new Set(stamps.map((s) => s.kind || s.interests[0] || s.activity).filter(Boolean))];
    return { unlocked: all.length > 0 || kudos > 0, name: p.name || "", first: first(p.name), handle: p.handle, emoji: p.emoji, stamps, next, hosts: hosts.map(({ at, ...h }) => h), counts: { events: stamps.length, coming: next.length, hosts: hosts.length, kudos, kinds: kinds.length } }; }

  // ---- jobs: saved-event reminders and the weekend digest ----
  const done = (k) => !!sys("pljob-" + hash(k)), mark = (k) => put("pljob-" + hash(k), { kind: "pljob", at: Date.now() });
  function savers() { return store.list("system").map((d) => d.data).filter((v) => v?.kind === "plsave" && v.email); }
  function digest(base, email, now = Date.now()) { const P = interestsOfUser(email), S = savesRaw(email), saved = S.items.filter((i) => i.kind === "event").map((i) => i.ref);
    if (!P.interests.length && !P.city && !saved.length) return { from: "", to: "", events: [] };
    return weekend(base, { interests: P.interests, city: P.city, saved, now, limit: 6 }); }
  async function runJobs(now = Date.now(), origin = process.env.ENCORE_PUBLIC_URL || "") {
    const base = String(origin || "").replace(/\/+$/, ""), out = { reminders: 0, digests: 0, skipped: 0 }, today = iso(now), cfg = emailConfig(DEFAULT_WS, true), link = (u) => (base && u.startsWith("/") ? base + u : u);
    // saved events two days out: once per person and event
    for (const v of savers()) { if (!isUser(v.email)) continue;
      for (const i of v.items) { if (i.kind !== "event") continue; const e = Dir.getEvent(base, i.ref); if (!e || e.status !== "upcoming" || e.start !== addDays(today, 2)) continue; const k = `remind|${lc(v.email)}|${i.ref}|${e.start}`; if (done(k)) continue; mark(k);
        const day = WEEKDAY[dow(e.start)], spots = e.spots_left != null ? ` Spots left: ${e.spots_left}.` : "", text = `Your saved event is ${day}: ${e.title}.${spots}`;
        X.notify(v.email, { kind: "saved", key: "plsave-" + i.ref + "-" + e.start, text, link: rel(base, e.url), eventId: i.ref }); out.reminders++;
        if (cfg && X.canEmail(v.email)) sendEmail(cfg, { list: "guest", origin: base, to: v.email, subject: `Your saved event is ${day}`, text: `${e.title}, ${niceDate(e.start)}${e.time ? " at " + e.time.split(" to ")[0] : ""}${e.area || e.city ? `, ${e.area || e.city}` : ""}.${spots}\n\nAre you in? ${link(rel(base, e.url))}\n\nYou saved this on Pottery Lab. See your saves: ${link("/saved")}` }).catch(() => {}); } }
    // the weekend digest: Thursday or Friday, once per weekend, only when something matches
    const d = dow(today);
    if (d === 4 || d === 5) { const W = weekendOf(now), people = new Set([...store.list("system").map((x) => x.data).filter((v) => v?.kind === "plint" && v.email).map((v) => lc(v.email)), ...savers().map((v) => lc(v.email))]);
      for (const em of people) { if (!isUser(em)) continue; const k = `digest|${em}|${W.from}`; if (done(k)) continue; const D = digest(base, em, now); if (!D.events.length) { out.skipped++; continue; } mark(k);
        const names = D.events.map((e) => e.title), text = `This weekend near you: ${names.slice(0, 2).join(", ")}${names.length > 2 ? ` and ${names.length - 2} more` : ""}`;
        X.notify(em, { kind: "digest", key: "digest-" + W.from, text, link: D.events.length === 1 ? D.events[0].url : "/saved#weekend" }); out.digests++;
        if (cfg && X.canEmail(em)) sendEmail(cfg, { list: "guest", origin: base, to: em, subject: "This weekend near you", text: `Picked from what you're into${interestsOfUser(em).city ? ` in ${interestsOfUser(em).city}` : ""}:\n\n${D.events.map((e) => `${e.saved ? "♥ " : ""}${e.title}\n${[e.when, e.area || e.city, e.price].filter(Boolean).join(" · ")}${e.spots_left != null ? ` · ${e.spots_left} spots left` : ""}\n${link(e.url)}`).join("\n\n")}\n\nChange what you're into: ${link("/ideas")}` }).catch(() => {}); } }
    return out; }

  return { INTERESTS, IDEAS, VIBES, interestsOfUser, setInterests, savesRaw, addSave, removeSave, mergeSaves, addBoard, renameBoard, dropBoard, counts, countOf, catalog, inspo, inspoItem, suggestHosts, weekend, friendsGoing, followSet, passport, digest, runJobs, rel };
}

export function mountHooks(app, { store, currentUser, publicOrigin, C, X, SB, sendStatic, express }) {
  const Dir = app.locals.directory, H = makeHooks({ store, C, X, Dir, SB });
  app.locals.hooks = H;
  const base = (req) => String(publicOrigin(req) || "").replace(/\/+$/, "");
  const json = express.json({ limit: "64kb" });
  const hits = new Map(); const limited = (req, bucket, n) => { const k = bucket + "|" + (req.ip || "?"), now = Date.now(); let h = hits.get(k); if (!h || now - h.start > 3600e3) { h = { n: 0, start: now }; hits.set(k, h); if (hits.size > 20000) hits.clear(); } return ++h.n > n; };
  const me = (req, res) => { const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) { res.status(401).json({ code: "unauthenticated", message: "Make a free account to keep your saves." }); return null; } return u; };
  const slow = (res) => res.status(429).json({ code: "rate_limited", message: "Slow down a little. Try again in a bit." });
  const list = (v) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean);

  app.get("/ideas", (req, res) => sendStatic(res, "ideas.html", "<p>Ideas page missing.</p>"));
  app.get("/saved", (req, res) => sendStatic(res, "saved.html", "<p>Saved page missing.</p>"));
  // ---- public reads ----
  app.get("/api/public/inspo", (req, res) => { if (limited(req, "read", 1200)) return slow(res); res.set("Cache-Control", "public, max-age=30");
    res.json(H.inspo(base(req), { interests: list(req.query.interests), city: clean(req.query.city, 60), tag: clean(req.query.tag, 20), cursor: String(req.query.cursor || "").slice(0, 40), limit: req.query.limit })); });
  app.get("/api/public/inspo/item", (req, res) => { const x = H.inspoItem(base(req), clean(req.query.id, 200)); return x ? res.json({ data: x }) : res.status(404).json({ code: "not_found", message: "That idea isn't here any more." }); });
  app.get("/api/public/suggest/hosts", (req, res) => { if (limited(req, "read", 1200)) return slow(res); const u = currentUser(req);
    const following = u && u.ws !== DEFAULT_WS ? allWorkspaceIds().filter((ws) => { try { return C.followersOf(ws).some((f) => lc(f.email) === lc(u.email)); } catch { return false; } }).map((ws) => C.profileOf(ws)?.handle).filter(Boolean) : [];
    res.json({ hosts: H.suggestHosts(base(req), { interests: list(req.query.interests), city: clean(req.query.city, 60), limit: req.query.limit }), following }); });
  app.get("/api/public/suggest/weekend", (req, res) => { if (limited(req, "read", 1200)) return slow(res); res.json(H.weekend(base(req), { interests: list(req.query.interests), city: clean(req.query.city, 60), saved: list(req.query.saved).slice(0, 50) })); });
  app.get("/api/public/saves/counts", (req, res) => { const out = {}; for (const k of list(req.query.keys).slice(0, 100)) { const [kind, ...r] = k.split(":"), n = H.countOf(kind, r.join(":")); if (n) out[k] = n; } res.json({ counts: out }); });
  // ---- interests ----
  app.get("/api/me/interests", (req, res) => { const u = me(req, res); if (!u) return; res.json(H.interestsOfUser(u.email)); });
  app.put("/api/me/interests", json, (req, res) => { const u = me(req, res); if (!u) return; if (limited(req, "write", 300)) return slow(res); res.json({ ok: true, ...H.setInterests(u.email, req.body || {}) }); });
  // ---- saves and boards ----
  const savesView = (req, email) => { const b = base(req), S = H.savesRaw(email), K = H.catalog(b), M = H.counts();
    const items = S.items.map((i) => { let v = { title: i.title, img: i.img, url: "", line: "", date: "", status: "", art: null, look: null, example: false };
      if (i.kind === "event") { const e = Dir.getEvent(b, i.ref); if (e) v = { ...v, title: e.title, img: H.rel(b, e.cover) || i.img, url: H.rel(b, e.url), line: K.events.get(i.ref)?.card.line || "", date: e.start, status: e.status, example: !!e.example, art: { activity: e.format } }; else v.gone = true; }
      else if (i.kind === "idea") { const x = H.IDEAS.find((y) => y.id === i.ref); if (x) v = { ...v, title: x.title, line: x.line, url: "/ideas#" + x.id, status: "idea", art: { kind: x.art, tone: x.tone }, look: H.VIBES[x.vibe]?.look || null }; else v.gone = true; }
      else if (i.kind === "host") { const h = K.hosts.get(i.ref); if (h) v = { ...v, title: h.name, img: H.rel(b, h.avatar) || i.img, url: H.rel(b, h.url), line: [h.tagline].filter(Boolean).join(""), status: "host", emoji: h.emoji, example: !!(h.example || h.prepared) }; else v.gone = true; }
      return { kind: i.kind, ref: i.ref, board: i.board, at: i.at, saves: M.get(i.kind + ":" + i.ref) || 0, ...v }; });
    return { items, boards: S.boards.map((x) => ({ ...x, count: items.filter((i) => i.board === x.id).length })) }; };
  app.get("/api/me/saves", (req, res) => { const u = me(req, res); if (!u) return; res.set("Cache-Control", "private, no-store"); res.json(savesView(req, u.email)); });
  app.post("/api/me/saves", json, (req, res) => { const u = me(req, res); if (!u) return; if (limited(req, "write", 300)) return slow(res); const b = req.body || {};
    if (Array.isArray(b.merge)) { const merged = H.mergeSaves(u.email, b.merge); return res.json({ ok: true, merged, total: H.savesRaw(u.email).items.length }); }
    if (b.boardName && !b.board) { const B = H.addBoard(u.email, b.boardName); if (!B) return res.status(400).json({ code: "invalid", message: "Give the board a name (up to 40 boards)." }); b.board = B.id; }
    const r = H.addSave(u.email, b); if (!r) return res.status(400).json({ code: "invalid", message: "That can't be saved." });
    res.json({ ok: true, saved: r.saved, isNew: r.isNew, count: H.countOf(r.saved.kind, r.saved.ref) }); });
  app.delete("/api/me/saves", json, (req, res) => { const u = me(req, res); if (!u) return; if (limited(req, "write", 300)) return slow(res); const kind = lc(req.query.kind || req.body?.kind), ref = String(req.query.ref || req.body?.ref || "").trim();
    const removed = H.removeSave(u.email, kind, ref); res.json({ ok: true, removed, count: H.countOf(kind, ref) }); });
  app.post("/api/me/boards", json, (req, res) => { const u = me(req, res); if (!u) return; if (limited(req, "write", 300)) return slow(res); const B = H.addBoard(u.email, req.body?.name); return B ? res.json({ ok: true, board: B }) : res.status(400).json({ code: "invalid", message: "Give the board a name (up to 40 boards)." }); });
  app.post("/api/me/boards/:id", json, (req, res) => { const u = me(req, res); if (!u) return; if (limited(req, "write", 300)) return slow(res); const B = H.renameBoard(u.email, String(req.params.id), req.body?.name); return B ? res.json({ ok: true, board: B }) : res.status(404).json({ code: "not_found", message: "No such board." }); });
  app.delete("/api/me/boards/:id", (req, res) => { const u = me(req, res); if (!u) return; if (limited(req, "write", 300)) return slow(res); res.json({ ok: H.dropBoard(u.email, String(req.params.id)) }); });
  // ---- passport, friends going, the digest ----
  app.get("/api/me/passport", (req, res) => { const u = me(req, res); if (!u) return; res.set("Cache-Control", "private, no-store"); res.json(H.passport(u.email)); });
  app.get("/api/me/friends-going", (req, res) => { const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) return res.json({ events: {} }); res.set("Cache-Control", "private, no-store"); res.json({ events: H.friendsGoing(u.email, list(req.query.ids)) }); });
  app.get("/api/me/digest", (req, res) => { const u = me(req, res); if (!u) return; res.json(H.digest(base(req), u.email)); });
  return H;
}
