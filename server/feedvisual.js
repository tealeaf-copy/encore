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
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scopeStore, getWorkspace, workspaceOfEvent, DEFAULT_WS } from "./workspaces.js";
import { cleanLook } from "./looks.js";

const PRESETS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "presets");
const DAY = 864e5;
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
export const momentsPublic = (e) => !!e && !!e.discoverable && !e.unlisted && !e.approvalRequired && !e.noPhotos && !e.cancelled && !e.example;
/** On the host's page: open events (unlisted ones too, they're on the page), or any event when the host turned it on. */
export const momentsOnPage = (e) => !!e && !e.noPhotos && !e.cancelled && ((!!e.discoverable && !e.approvalRequired) || e.momentsOnPage === true);
/** An event card (title, flyer, when) may show to strangers: it's on Discover. Its photos follow momentsPublic. */
const cardPublic = (e) => !!e && !!e.discoverable && !e.unlisted && !e.cancelled && !e.example;

const MEDIA_OK = (u) => /^\/_blob\/[A-Za-z0-9]{20}$/.test(u || "") || /^\/presets\/[a-z0-9-]{1,60}\.(jpg|webp|png)$/.test(u || "");
export const REACTIONS = ["🔥", "😍", "🥟", "🙌"];

export function makeFeedVisual(store, { C, X }) {
  const sample = (ws) => /@demo\.encore$/i.test(getWorkspace(ws)?.ownerEmail || "");
  function hostOf(ws) { const h = C.profileOf(ws); if (!h?.handle) return null;
    return { handle: h.handle, name: h.name || h.handle, emoji: h.emoji || "🎉", color: h.theme?.accent || h.color || "#E26D8E", avatarArt: h.theme?.avatarArt || "", avatarUrl: MEDIA_OK(h.theme?.avatarUrl) || /^\/presets\/[a-z0-9-]+\.svg$/.test(h.theme?.avatarUrl || "") ? h.theme.avatarUrl : "" }; }
  const lookOf = (e) => { const L = cleanLook(e?.look) || {}; const o = {}; for (const k of ["palette", "coverFit", "coverW", "coverH", "effect", "titleFont", "buttonEmoji", "buttonLabel", "lights", "vibe"]) if (L[k] != null) o[k] = L[k]; return o; };
  const artOf = (e) => { const a = e?.coverArt; if (!a || typeof a !== "object") return null; const o = {}; if (typeof a.kind === "string") o.kind = a.kind.slice(0, 40); if (typeof a.tone === "string") o.tone = a.tone.slice(0, 20); if (typeof a.label === "string") o.label = clean(a.label, 40); if (typeof a.svg === "string" && /^<svg /.test(a.svg) && a.svg.length < 40000) o.svg = a.svg; return o; };
  const momentOut = (m) => ({ id: m.id, url: m.url, type: m.type, ...(MEDIA_OK(m.poster) ? { poster: m.poster } : {}), ...(m.w && m.h ? { w: m.w, h: m.h } : {}), caption: m.caption || "", by: first(m.authorName) || "", at: m.at || 0 });
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
    const e = x.e, past = !!e.date && e.date < today(), h = hostOf(x.ws), going = past ? 0 : (C.goingOf(x.ws, x.id, e).going || 0);
    const photos = I.moments.filter((m) => m.eventId === x.id && momentSeen(I, m, email)).sort((a, b) => (a.at || 0) - (b.at || 0)).slice(0, 12).map(momentOut);
    const K = I.kudos.filter((k) => k.eventId === x.id && (k.love || (k.tags || []).length)), q = K.filter((k) => k.love && k.verified).sort((a, b) => (b.verified === "guest_list") - (a.verified === "guest_list") || b.love.length - a.love.length)[0];
    const came = [...I.att.values()].filter((L) => L.some((a) => a.eventId === x.id)).length;
    const cap = +e.headcount || 0;
    return { id: x.id, title: e.pubTitle || e.name || "", date: e.date || "", startTime: e.startTime || "", city: e.city || "", hood: e.hood || "", emoji: e.emoji || "", activity: e.activity || "", free: !!(e.free || !e.price), price: e.price || "",
      approvalRequired: !!e.approvalRequired, past, cover: MEDIA_OK(e.coverPhoto) ? e.coverPhoto : "", coverArt: artOf(e), look: lookOf(e), host: h, url: `/g#rsvp-${encodeURIComponent(x.id)}`, page: h ? `/@${h.handle}` : "",
      ...(sample(x.ws) ? { sample: true } : {}), ...(past ? { came, kudos: K.length, photos, ...(q ? { quote: { text: scrub(q.love).slice(0, 220), name: first(q.name) || "A guest", verifiedLabel: q.verified === "guest_list" ? "Came, on the guest list" : "Replied I'm in" } } : {}), reacts: reactsOf(x.id), myReacts: myReacts(x.id, email || device) } : { going, ...(cap && going ? { spotsLeft: Math.max(0, cap - going) } : {}) }),
      fresh: (Date.now() - (e.createdAt || e.updatedAt || 0)) < 4 * DAY };
  }
  // ---------- prepared pages ----------
  let SC = null;
  function showcases() { if (SC && Date.now() - SC.at < 60_000) return SC.list; const list = [];
    try { for (const f of JSON.parse(fs.readFileSync(path.join(PRESETS, "showcase.json"), "utf8"))) { if (!/^[a-z0-9-]{1,40}$/.test(f)) continue; let handle = f; try { handle = lc(JSON.parse(fs.readFileSync(path.join(PRESETS, f + ".json"), "utf8")).handle || f); } catch {}
      const P = C.showcaseOf(handle); if (!P) continue; // claimed pages show as real hosts instead
      const host = { handle: P.handle, name: P.name, emoji: P.emoji || "🎉", color: P.theme?.accent || P.color || "#E26D8E", avatarArt: P.theme?.avatarArt || "", avatarUrl: /^\/presets\/[a-z0-9-]+\.(svg|jpg|png)$/.test(P.theme?.avatarUrl || "") ? P.theme.avatarUrl : "" };
      const past = (P.scrapbook || []).slice(0, 8).map((s, i) => ({ id: `sc-${P.handle}-${i}`, title: clean(s.title, 120), date: s.date || "", place: clean(s.place, 80), note: clean(s.note || s.about, 200), cover: MEDIA_OK(s.cover) ? s.cover : "", photos: (s.photos || []).filter(MEDIA_OK).slice(0, 6) }));
      const exps = (P.experiences || []).slice(0, 4).map((x, i) => ({ id: `sx-${P.handle}-${i}`, title: clean(x.name, 100), desc: clean(x.desc, 200), emoji: clean(x.emoji, 8), price: clean(x.price, 40), category: clean(x.category, 30) }));
      list.push({ host, tagline: clean(P.tagline, 160), city: clean(P.city, 60), hood: clean(P.hood, 60), example: !!P.example, past, experiences: exps, page: `/@${P.handle}` }); } } catch {}
    SC = { at: Date.now(), list }; return list; }

  /** Everything for the feed's visual sections, for one viewer (email "" when signed out). */
  function sections({ email = "", device = "" } = {}) {
    const I = X.index(), now = Date.now(), t = today(now), all = [...I.events.values()].filter((x) => C.profileOf(x.ws)?.handle);
    const upcoming = all.filter((x) => cardPublic(x.e) && (x.e.date || "") >= t && x.e.stage !== "interest").sort((a, b) => (sample(a.ws) - sample(b.ws)) || String(a.e.date).localeCompare(String(b.e.date))).slice(0, 16).map((x) => card(I, x, { email, device }));
    const pastX = all.filter((x) => x.e.date && x.e.date < t && Date.parse(x.e.date) > now - 120 * DAY && (cardPublic(x.e) || wasThere(I, x.id, email)) && !x.e.cancelled);
    const past = pastX.map((x) => card(I, x, { email, device })).sort((a, b) => (!!b.photos.length - !!a.photos.length) || (!!a.sample - !!b.sample) || String(b.date).localeCompare(String(a.date))).slice(0, 12);
    const moments = I.moments.filter((m) => m.at > now - 30 * DAY && momentSeen(I, m, email)).sort((a, b) => b.at - a.at).slice(0, 12).map((m) => { const x = I.events.get(m.eventId); return { ...momentOut(m), event: { id: x.id, title: x.e.pubTitle || x.e.name || "", date: x.e.date || "", host: hostOf(x.ws), page: hostOf(x.ws) ? `/@${hostOf(x.ws).handle}` : "" } }; });
    const kudos = I.kudos.filter((k) => k.love && k.verified && cardPublic(I.events.get(k.eventId)?.e) && k.at > now - 120 * DAY).sort((a, b) => b.at - a.at).slice(0, 8).map((k) => { const x = I.events.get(k.eventId), h = hostOf(x.ws);
      return { id: k.id, text: scrub(k.love).slice(0, 240), name: first(k.name) || "A guest", tags: (k.tags || []).slice(0, 3), verifiedLabel: k.verified === "guest_list" ? "Came, on the guest list" : "Replied I'm in", event: { id: x.id, title: x.e.pubTitle || x.e.name || "", host: h, page: h ? `/@${h.handle}` : "" } }; });
    return { upcoming, past, moments, kudos, showcase: showcases() };
  }
  /** Stories: one circle per host with photos, videos or flyers from the last 14 days, newest first. */
  function stories({ email = "", following = [] } = {}) {
    const I = X.index(), now = Date.now(), since = now - 14 * DAY, t = today(now), by = new Map();
    const add = (ws, it) => { const h = hostOf(ws); if (!h) return; if (!by.has(h.handle)) by.set(h.handle, { key: "h:" + h.handle, host: h, items: [], showcase: false, ...(sample(ws) ? { sample: true } : {}) }); by.get(h.handle).items.push(it); };
    const when = (e) => { const d = e.date ? new Date(e.date + "T12:00:00") : null; return d && !isNaN(d) ? d.toLocaleDateString("en-US", { weekday: "short" }) : ""; };
    for (const m of I.moments) { if (!(m.at > since) || !momentSeen(I, m, email)) continue; const x = I.events.get(m.eventId);
      add(x.ws, { id: "m:" + m.id, type: m.type === "video" ? "video" : "image", url: m.url, ...(MEDIA_OK(m.poster) ? { poster: m.poster } : {}), thumb: m.type === "video" ? (MEDIA_OK(m.poster) ? m.poster : "") : m.url, caption: [x.e.pubTitle || x.e.name, when(x.e)].filter(Boolean).join(" · "), note: m.caption || "", by: first(m.authorName) || "", at: m.at, past: true, cta: { label: "See page", url: hostOf(x.ws) ? `/@${hostOf(x.ws).handle}` : `/g#rsvp-${x.id}` } }); }
    for (const x of I.events.values()) { const e = x.e; if (!cardPublic(e) && !wasThere(I, x.id, email)) continue; const at = e.updatedAt || e.createdAt || 0, up = (e.date || "") >= t;
      if (up && e.stage !== "interest" && (at > since || Date.parse(e.date) - now < 21 * DAY)) add(x.ws, { id: "f:" + x.id, type: MEDIA_OK(e.coverPhoto) ? "image" : "art", url: MEDIA_OK(e.coverPhoto) ? e.coverPhoto : "", thumb: MEDIA_OK(e.coverPhoto) ? e.coverPhoto : "", art: { title: e.pubTitle || e.name || "", activity: e.activity || "", coverArt: artOf(e), date: e.date || "", id: x.id }, look: lookOf(e), caption: [e.pubTitle || e.name, when(e)].filter(Boolean).join(" · "), at: Math.max(at, since + 1), past: false, cta: { label: "See invite", url: `/g#rsvp-${encodeURIComponent(x.id)}` } });
      else if (!up && e.date && Date.parse(e.date) > since && MEDIA_OK(e.coverPhoto) && momentsOnPage(e)) add(x.ws, { id: "c:" + x.id, type: "image", url: e.coverPhoto, thumb: e.coverPhoto, caption: [e.pubTitle || e.name, when(e)].filter(Boolean).join(" · "), at: Date.parse(e.date) + 20 * 3600e3, past: true, cta: { label: "See page", url: hostOf(x.ws) ? `/@${hostOf(x.ws).handle}` : `/g#rsvp-${x.id}` } }); }
    const F = new Set(following); let L = [...by.values()].map((s) => { s.items.sort((a, b) => (!!a.past === !!b.past ? a.at - b.at : a.past ? -1 : 1)); /* what happened, oldest first, then what's next */ s.items = [...s.items.filter((i) => i.past).slice(-7), ...s.items.filter((i) => !i.past).slice(0, 3)]; s.latestAt = Math.max(...s.items.map((i) => i.at)); s.thumb = (s.items.slice().reverse().find((i) => i.thumb) || {}).thumb || ""; return s; })
      .sort((a, b) => (F.has(b.host.handle) - F.has(a.host.handle)) || (!!a.sample - !!b.sample) || b.latestAt - a.latestAt).slice(0, 20);
    // a quiet week still has something to tap: prepared pages, with their covers and illustrated art
    if (L.filter((s) => !s.sample).length < 6) for (const P of showcases()) { if (L.length >= 12) break; const items = [];
      for (const p of P.past) items.push(p.cover ? { id: "s:" + p.id, type: "image", url: p.cover, thumb: p.cover, caption: [p.title, p.place].filter(Boolean).join(" · "), at: 0, past: true, cta: { label: "See page", url: P.page } } : { id: "s:" + p.id, type: "art", url: "", thumb: "", art: { title: p.title, activity: p.title, id: p.id }, caption: [p.title, p.place].filter(Boolean).join(" · "), at: 0, past: true, cta: { label: "See page", url: P.page } });
      for (const x of P.experiences) items.push({ id: "s:" + x.id, type: "art", url: "", thumb: "", art: { title: x.title, activity: `${x.title} ${x.category}`, id: x.id }, caption: x.title + (x.price ? " · " + x.price : ""), note: x.desc, at: 0, past: false, cta: { label: "See page", url: P.page } });
      if (items.length) L.push({ key: "s:" + P.host.handle, host: P.host, items: items.slice(0, 6), latestAt: 0, thumb: (items.find((i) => i.thumb) || {}).thumb || "", showcase: true, ...(P.example ? { example: true } : {}) }); }
    return L;
  }
  return { sections, stories, card, react, reactsOf, showcases, momentsPublic, momentsOnPage, wasThere };
}

export function mountFeedVisual(app, { store, small, currentUser, C, X }) {
  const V = makeFeedVisual(store, { C, X });
  app.locals.feedVisual = V;
  const hits = new Map(); const limited = (req, n) => { const k = (req.ip || "?") + req.path.split("/").slice(0, 4).join("/"), now = Date.now(); let h = hits.get(k); if (!h || now - h.start > 3600_000) { h = { n: 0, start: now }; hits.set(k, h); } return ++h.n > n; };
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const viewer = (req) => { const u = currentUser(req); return u && u.ws !== DEFAULT_WS && u.email ? u : null; };
  const followingOf = (email) => { try { return email ? [...new Set([...X.index().events.values()].map((v) => v.ws))].filter((w) => C.followersOf(w).some((f) => lc(f.email) === lc(email))).map((w) => C.profileOf(w)?.handle).filter(Boolean) : []; } catch { return []; } };
  const device = (req) => (/^[A-Za-z0-9_-]{8,40}$/.test(String(req.query.device || req.body?.device || "")) ? "dev:" + String(req.query.device || req.body.device) : "");
  // the signed-out feed: public content only (and no cookies needed, so it can be cached for a minute)
  app.get("/api/public/feed", (req, res) => { const u = viewer(req); res.set("Cache-Control", u ? "private, no-store" : "public, max-age=60");
    const email = u ? lc(u.email) : ""; res.json({ ...V.sections({ email, device: device(req) }), stories: V.stories({ email, following: followingOf(email) }) }); });
  // stories on their own (the rail can refresh without the whole feed)
  app.get("/api/feed/stories", (req, res) => { const u = viewer(req), email = u ? lc(u.email) : ""; res.set("Cache-Control", "private, no-store"); res.json({ stories: V.stories({ email, following: followingOf(email) }) }); });
  // what an upload may be, for the browser's own check before it sends anything
  app.get("/api/public/moment-limits", (req, res) => res.json({ imageMB: Math.round((momentMaxBytes("image") / 1048576) * 10) / 10, videoMB: Math.round((momentMaxBytes("video") / 1048576) * 10) / 10, seconds: MOMENT_MAX_SECONDS, perPick: 6, types: [...MOMENT_IMAGE_TYPES, ...MOMENT_VIDEO_TYPES] }));
  // tap-to-react on past events: one of each emoji per person (signed in) or device, toggled
  app.post("/api/feed/react", small, (req, res) => { if (limited(req, 120)) return bad(res, "Slow down.", 429, "rate_limited"); const b = req.body || {}, emoji = String(b.emoji || ""), id = clean(b.eventId, 80);
    if (!V.reactsOf || !["🔥", "😍", "🥟", "🙌"].includes(emoji)) return bad(res, "Pick one of the reactions.");
    const u = viewer(req), who = u ? "u:" + lc(u.email) : device(req); if (!who) return bad(res, "Missing device.", 400, "invalid");
    let ok = /^s[cx]-[a-z0-9-]{1,40}-\d{1,2}$/.test(id) && V.showcases().some((P) => [...P.past, ...P.experiences].some((x) => x.id === id));
    if (!ok) { const I = X.index(), x = I.events.get(id); ok = !!x && x.e.date && x.e.date < today() && ((!!x.e.discoverable && !x.e.unlisted && !x.e.cancelled) || V.wasThere(I, id, u ? lc(u.email) : "")); }
    if (!ok) return bad(res, "No such event.", 404, "not_found");
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
  return V;
}
// ---- end visual feed ----
