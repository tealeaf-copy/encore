// Making a story (public/storycomposer.js) and what a story's viewers can do with it (public/storyview.js).
//
// A story is one slide: a picture the composer flattened in the browser (the photo or blank canvas, the words, the
// drawing and the drawn stickers, about 1080 by 1920), or a video as it was filmed with a see-through picture laid over
// it (the server never re-encodes video). The stickers people can tap are kept beside it as data with their place on
// the slide, so the viewer draws them live: an event, "I'm in" and a countdown (each a link to the invite), a host
// mention, a question box, a two-way poll and an emoji slider.
//
// Where a story shows, and for how long:
// - On its author's own ring for 24 hours (STORY_HOURS), then it is off the ring. Nothing is deleted when it runs out:
//   a highlight keeps it ("s:<story id>" in server/storyapprove.js), and its author can delete it any time.
// - A story does not need an event. With an event (one the author hosts or replied I'm in to), "Add to the event's
//   photos" also makes it a moment of that event, with every rule moments already have: 14 days on the host's ring and
//   the event's photo wall, the host's approval for a guest's photo (server/storyapprove.js), No photos events, the
//   per-person cap. The two live side by side: the ring copy runs out after a day, the event's photo stays its 14 days.
//
// Who sees it (canSee, the one gate, used by the rail, highlights and every tap):
// - everyone: anyone who can see the author's ring. An author who has never hosted has no public ring, so "everyone"
//   for them is the people who follow them or added them as a friend.
// - followers: people who follow the author's page or added the author as a friend, and the author's own friends.
// - friends: people the author added as friends.
// - event: people who were at the attached event (its host and guests who were in). An event that is not open to
//   everyone (link-only, Ask to join, unlisted) always uses this one, whatever was asked.
// - never anyone the author blocked or who blocked the author; never a removed story.
//
// Storage: system/pstory-<id> (the slide), system/storyx-<id> (who saw it, votes, answers, replies, reactions; kept
// apart so a view never rebuilds the feed), system/storyup-<hash of email> (blobs this person uploaded for stories:
// a story can only use these). The draft stays in the browser (IndexedDB), never here.
import crypto from "node:crypto";
import { scopeStore, getDbUser, getWorkspace, DEFAULT_WS, allWorkspaceIds } from "./workspaces.js";
import { cleanText } from "./storyapprove.js";
import { textProblem } from "./safety.js";
import { momentKind, momentMaxBytes, sniffedAs, videoSeconds, unreadVideoMaxBytes, MOMENTS_PER_PERSON, REACTIONS } from "./feedvisual.js";

const HOUR = 3600e3, ID = /^[A-Za-z0-9_-]{1,80}$/, BLOB = /^\/_blob\/[A-Za-z0-9]{20}$/, SID = /^[a-z0-9]{1,12}$/;
const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const hash = (s) => crypto.createHash("sha256").update(lc(s)).digest("hex").slice(0, 24);
const num = (v, lo, hi, d) => { const n = Number(v); return v != null && v !== "" && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const envN = (k, d) => { const n = Number(process.env[k]); return Number.isFinite(n) && n > 0 ? n : d; };
export const STORY_LIMITS = { slides: 10, stickers: 12, reply: 500, answer: 300, minMs: 2000, maxMs: 15000 };
export const storyHours = () => envN("STORY_HOURS", 24);
export const storyVideoSeconds = () => envN("STORY_VIDEO_MAX_SECONDS", 30);
export const storyPerHour = () => envN("STORY_PER_HOUR", 30);
export const AUDIENCES = ["everyone", "followers", "friends", "event"];
export const STICKERS = ["event", "imin", "count", "mention", "question", "poll", "slider"];

/** A sticker as the composer sent it, cleaned: its place on the slide and only the fields its kind has. null when it isn't one. */
export function cleanSticker(s, i = 0) {
  if (!s || typeof s !== "object" || !STICKERS.includes(s.t)) return null;
  const o = { id: SID.test(String(s.id || "")) ? String(s.id) : "k" + i, t: s.t, x: Math.round(num(s.x, -0.2, 1.2, 0.5) * 1e4) / 1e4, y: Math.round(num(s.y, -0.2, 1.2, 0.5) * 1e4) / 1e4, s: Math.round(num(s.s, 0.3, 4, 1) * 1e3) / 1e3, r: Math.round(num(s.r, -180, 180, 0) * 10) / 10 };
  if (["event", "imin", "count"].includes(s.t)) { if (!ID.test(String(s.ev || ""))) return null; o.ev = String(s.ev); }
  if (s.t === "mention") { const h = lc(s.handle).replace(/^@/, ""); if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(h)) return null; o.handle = h; }
  if (s.t === "question") o.prompt = cleanText(s.prompt, 80) || "Ask me something";
  if (s.t === "poll") { o.q = cleanText(s.q, 80); o.a = cleanText(s.a, 30) || "Yes"; o.b = cleanText(s.b, 30) || "No"; }
  if (s.t === "slider") { o.q = cleanText(s.q, 60); o.emoji = [...cleanText(s.emoji, 16)].slice(0, 2).join("") || "❤️"; }
  return o;
}

export function makeStoryMake(store, { C, X, V, blocksOf = () => [] }) {
  const sys = (k) => store.get("system/" + k)?.data || null;
  const keyOf = (email) => Buffer.from(lc(email)).toString("base64url");
  const ownerOf = (ws) => lc(getWorkspace(ws)?.ownerEmail || "");
  let cache = null;
  try { store.events?.on?.("change", (e) => { if (/^system\/pstory-/.test(String(e?.path || ""))) cache = null; }); } catch {}
  /** Every story that hasn't been removed. */
  const all = () => cache || (cache = store.listPrefix("system", "pstory-").map((d) => d.data).filter((d) => d && d.kind === "pstory" && !d.removed));
  const get = (id) => { if (!ID.test(String(id || ""))) return null; const d = sys("pstory-" + id); return d && d.kind === "pstory" && !d.removed ? d : null; };
  const xOf = (id) => ({ views: {}, votes: {}, slides: {}, answers: [], replies: [], reacts: {}, ...(sys("storyx-" + id) || {}) });
  const xSave = (id, d) => store.set("system/storyx-" + id, { ...d, kind: "storyx", id });
  const live = (st, now = Date.now()) => now >= st.at - 60e3 && now < st.until;

  // ---------- who is who ----------
  const blocked = (a, b) => { a = lc(a); b = lc(b); if (!a || !b || a === b) return false; try {
    const T = (em) => new Set((blocksOf(em) || []).map((x) => x.target)), A = T(a), B = T(b), ha = X.person(a).handle, hb = X.person(b).handle;
    return A.has("person:" + keyOf(b)) || (!!hb && A.has("host:" + hb)) || B.has("person:" + keyOf(a)) || (!!ha && B.has("host:" + ha)); } catch { return false; } };
  const friendOf = (author, viewer) => X.friendsOf(author).some((f) => lc(f.email) === viewer);
  const follows = (author, viewer) => { if (X.friendsOf(viewer).some((f) => lc(f.email) === author)) return true; const ws = getDbUser(author)?.ws; try { return !!ws && C.followersOf(ws).some((f) => lc(f.email) === viewer); } catch { return false; } };
  /** Has this person hosted anything? Someone who never has gets no public ring: their "everyone" is their own circle. */
  const hosts = (author, I) => { const ws = getDbUser(author)?.ws; if (!ws || !C.profileOf(ws)?.handle) return false; for (const x of I.events.values()) if (x.ws === ws) return true; return false; };
  const reachOf = (author, I = X.index()) => (hosts(lc(author), I) ? "public" : "circle");
  /** The one gate: may this viewer (an email, or "" for a stranger who isn't signed in) see this story? */
  function canSee(st, viewer = "", I = X.index()) { if (!st || st.removed) return false; viewer = lc(viewer); const author = lc(st.author); if (viewer && viewer === author) return true;
    if (viewer && blocked(author, viewer)) return false;
    const aud = AUDIENCES.includes(st.audience) ? st.audience : "friends";
    if (aud === "event") return !!viewer && !!st.eventId && V.wasThere(I, st.eventId, viewer);
    if (aud === "friends") return !!viewer && friendOf(author, viewer);
    if (aud === "followers") return !!viewer && (friendOf(author, viewer) || follows(author, viewer));
    return hosts(author, I) ? true : !!viewer && (friendOf(author, viewer) || follows(author, viewer)); }
  /** Events this person may put on a story: ones they host, and ones they replied I'm in to. */
  function myEvents(email, I = X.index()) { email = lc(email); const ws = getDbUser(email)?.ws, out = new Map();
    for (const x of I.events.values()) if (x.ws === ws && !x.e.example) out.set(x.id, { x, own: true });
    for (const a of I.att.get(email) || []) { const x = I.events.get(a.eventId); if (x && !out.has(x.id)) out.set(x.id, { x, own: false }); }
    return [...out.values()].filter(({ x }) => !x.e.cancelled); }
  const mayLink = (email, id, I) => myEvents(email, I).some(({ x }) => x.id === id);
  const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
  const startOf = (e) => { const t = Date.parse(`${e.date || ""}T${/^\d{1,2}:\d\d$/.test(e.startTime || "") ? e.startTime.padStart(5, "0") : "12:00"}:00`); return Number.isFinite(t) ? t : 0; };
  const evOut = (x) => { const e = x.e; return { ev: x.id, title: cleanText(e.pubTitle || e.name, 80) || "An event", date: e.date || "", startTime: e.startTime || "", activity: cleanText(e.activity, 40), cover: V.MEDIA_OK(e.coverPhoto) ? e.coverPhoto : "", where: cleanText(e.hood || e.city, 40) }; };

  // ---------- stickers: checked when the story is made, filled in for each viewer ----------
  /** Clean the composer's stickers, and keep only links this author may make: their own events, hosts that exist. */
  function checkStickers(list, author, I) { const out = []; let dropped = 0;
    for (const [i, raw] of (Array.isArray(list) ? list : []).slice(0, 40).entries()) { const s = cleanSticker(raw, i); if (!s) { dropped++; continue; }
      if (out.some((o) => o.id === s.id)) s.id = "k" + i + "x";
      if (s.ev && !mayLink(author, s.ev, I)) { dropped++; continue; }
      if (s.t === "mention") { const ws = C.wsOfHandle(s.handle); if (!ws || ws === DEFAULT_WS || !C.profileOf(ws)?.handle || blocked(author, ownerOf(ws))) { dropped++; continue; } }
      for (const k of ["prompt", "q", "a", "b"]) if (s[k]) { const p = textProblem(s[k]); if (p) return { error: p }; }
      if (out.length < STORY_LIMITS.stickers) out.push(s); else dropped++; }
    return { stickers: out, dropped }; }
  /** A story's stickers as this viewer gets them: links only to what they may see, their own vote, results once they voted. */
  function stickersFor(st, viewer, I, xd) { viewer = lc(viewer); const own = !!viewer && viewer === lc(st.author), vk = viewer ? hash(viewer) : "", out = [];
    for (const s of st.stickers || []) { const o = { id: s.id, t: s.t, x: s.x, y: s.y, s: s.s, r: s.r };
      if (s.ev) { const x = I.events.get(s.ev); if (!x || x.e.cancelled || !(V.cardPublic(x.e) || V.wasThere(I, x.id, viewer))) continue; // a private event's name never reaches someone who wasn't there
        Object.assign(o, evOut(x), { url: `/e/${encodeURIComponent(x.id)}` });
        if (s.t === "imin") o.label = (x.e.date || "") >= today() ? V.eventCta(x.e, x.id).label : "See the invite";
        if (s.t === "count") o.at = startOf(x.e); }
      else if (s.t === "mention") { const ws = C.wsOfHandle(s.handle), h = ws ? C.profileOf(ws) : null; if (!h?.handle || (viewer && blocked(viewer, ownerOf(ws)))) continue; o.handle = h.handle; o.name = cleanText(h.name || h.handle, 60); o.url = `/@${h.handle}`; }
      else if (s.t === "question") { o.prompt = s.prompt; if (vk && (xd.answers || []).some((a) => a.k === vk && a.sticker === s.id)) o.my = 1; if (own) o.n = (xd.answers || []).filter((a) => a.sticker === s.id).length; }
      else if (s.t === "poll") { Object.assign(o, { q: s.q, a: s.a, b: s.b }); const R = xd.votes?.[s.id] || {}, mine = vk && vk in R ? R[vk] : null; if (mine != null) o.my = mine;
        if (mine != null || own) { const L = Object.values(R); o.res = [L.filter((v) => v === 0).length, L.filter((v) => v === 1).length]; } }
      else if (s.t === "slider") { Object.assign(o, { q: s.q, emoji: s.emoji }); const R = xd.slides?.[s.id] || {}, mine = vk && vk in R ? R[vk] : null; if (mine != null) o.my = mine;
        if (mine != null || own) { const L = Object.values(R); o.n = L.length; o.avg = L.length ? Math.round(L.reduce((a, b) => a + b, 0) / L.length) : 0; } }
      out.push(o); }
    return out; }
  /** What the viewer draws over a story, for this viewer. */
  function stOf(st, viewer, I) { viewer = lc(viewer); const xd = xOf(st.id), own = !!viewer && viewer === lc(st.author), vk = viewer ? hash(viewer) : "";
    return { sid: st.id, dur: st.dur || 5000, ...(st.trim ? { trim: st.trim } : {}), ...(BLOB.test(st.overlay || "") ? { overlay: st.overlay } : {}), stickers: stickersFor(st, viewer, I, xd), by: first(st.authorName) || "Someone",
      ...(own ? { own: true, seen: Object.keys(xd.views || {}).length, replies: (xd.replies || []).length + (xd.answers || []).length, audience: st.audience, until: st.until } : { reply: !!viewer, ...(vk && xd.reacts?.[vk] ? { myReact: xd.reacts[vk].emoji } : {}) }) }; }
  /** One story as a ring item. */
  function item(st, viewer, I, { prefix = "p:" } = {}) { const x = st.eventId ? I.events.get(st.eventId) : null, evSeen = !!x && (V.cardPublic(x.e) || V.wasThere(I, x.id, viewer));
    const thumb = st.type === "video" ? (BLOB.test(st.poster || "") ? st.poster : "") : st.url;
    return { id: prefix + st.id, type: st.type === "video" ? "video" : "image", url: st.url, ...(st.type === "video" && thumb ? { poster: thumb } : {}), thumb, caption: evSeen ? cleanText(x.e.pubTitle || x.e.name, 80) : "", at: st.at, past: true, story: true,
      ...(evSeen ? { ev: x.id, cta: (x.e.date || "") >= today() ? V.eventCta(x.e, x.id) : { label: "See the invite", url: `/e/${encodeURIComponent(x.id)}` } } : {}), st: stOf(st, viewer, I) }; }

  /** For server/feedvisual.js stories(): each author's live stories this viewer may see, by workspace, and the moments they stand in for. */
  function rings({ I, email = "", now = Date.now() }) { email = lc(email); const byWs = new Map(), people = [], skip = new Set(), deco = new Map(), own = new Set();
    const mom = new Map(); for (const st of all()) if (st.momentId) mom.set(st.momentId, st);
    for (const st of all().filter((s) => live(s, now)).sort((a, b) => a.at - b.at)) { if (!canSee(st, email, I)) continue;
      const ws = st.ws, it = item(st, email, I); if (lc(st.author) === email) own.add(ws);
      if (C.profileOf(ws)?.handle && ownerOf(ws) === lc(st.author)) { if (!byWs.has(ws)) byWs.set(ws, []); if (byWs.get(ws).length < 30) byWs.get(ws).push(it); }
      else { let p = people.find((q) => q.email === lc(st.author)); if (!p) { const P = X.person(st.author); people.push((p = { email: lc(st.author), key: "p:" + hash(st.author).slice(0, 12), host: { handle: "", name: first(st.authorName || P.name) || "Someone", emoji: "", color: "#29489A" }, items: [], person: true, showcase: false, ...(lc(st.author) === email ? { own: true } : {}) })); } if (p.items.length < 30) p.items.push(it); }
      // its event photo: on its author's own ring the story stands in for it (never the same picture twice)
      if (st.momentId && I.events.get(st.eventId)?.ws === ws) skip.add(st.momentId); }
    // an event photo that came from a story keeps its stickers (and a video its overlay) wherever the photo shows
    for (const [mid, st] of mom) if (!skip.has(mid) && canSee(st, email, I)) deco.set(mid, { st: stOf(st, email, I), story: true });
    return { byWs, people: people.map(({ email: _e, ...p }) => ({ ...p, latestAt: Math.max(0, ...p.items.map((i) => i.at)), thumb: (p.items.slice().reverse().find((i) => i.thumb) || {}).thumb || "" })), skip, deco, own }; }
  /** A highlight's story ("s:<id>"): kept past its day, still only for people who may see it. */
  function kept(id, ws, viewer, I, prefix) { const st = get(id); if (!st || st.ws !== ws || !canSee(st, viewer, I)) return null; return item(st, viewer, I, { prefix }); }
  const mine = (id, email) => { const st = get(id); return !!st && lc(st.author) === lc(email); };

  // ---------- making one ----------
  const upKey = (email) => "storyup-" + hash(email);
  const uploadsOf = (email) => sys(upKey(email))?.list || [];
  function noteUpload(email, rec) { const L = [rec, ...uploadsOf(email)].slice(0, 80); store.set("system/" + upKey(email), { kind: "storyup", email: lc(email), list: L }); }
  /** Make a story's slides. Returns { ids, ... } or { error: { status, code, message } }. */
  function create(u, b = {}, { now = Date.now() } = {}) { const email = lc(u.email), I = X.index(), err = (message, status = 400, code = "invalid") => ({ error: { status, code, message } });
    const slides = Array.isArray(b.slides) ? b.slides : []; if (!slides.length) return err("Add a photo, a video or a blank page first.");
    if (slides.length > STORY_LIMITS.slides) return err(`A story can have up to ${STORY_LIMITS.slides} slides.`, 400, "too_many");
    const ups = new Map(uploadsOf(email).map((x) => [x.url, x]));
    let audience = AUDIENCES.includes(b.audience) ? b.audience : "everyone", x = null, own = false;
    if (b.eventId) { if (!ID.test(String(b.eventId))) return err("No such event.", 404, "not_found"); const m = myEvents(email, I).find((y) => y.x.id === String(b.eventId)); if (!m) return err("You can add events you host or said I'm in to.", 403, "not_granted"); x = m.x; own = m.own; }
    if (audience === "event" && !x) return err("Pick the event first.");
    if (x && !V.cardPublic(x.e)) audience = "event"; // a link-only or Ask to join event stays with the people who were there
    const made = [], batch = crypto.randomBytes(6).toString("hex");
    for (const [n, s] of slides.entries()) { const media = ups.get(String(s?.url || "")); if (!media || !["image", "video"].includes(media.as)) return err("That photo or video didn't finish uploading. Try again.", 400, "missing_media");
      const C0 = checkStickers(s.stickers, email, I); if (C0.error) return { error: { status: 400, ...C0.error } };
      const over = ups.get(String(s.overlay || "")), poster = ups.get(String(s.poster || ""));
      const d = { kind: "pstory", id: crypto.randomBytes(9).toString("hex"), batch, n, author: email, authorEmail: email /* account deletion finds it by this (server/account.js) */, authorName: cleanText(u.name, 80), ws: u.ws, at: now + n, until: now + storyHours() * HOUR, audience, ...(x ? { eventId: x.id } : {}),
        type: media.as, url: media.url, ...(media.w && media.h ? { w: media.w, h: media.h } : {}), ...(media.as === "video" && poster?.as === "poster" ? { poster: poster.url } : {}), ...(media.as === "video" && over?.as === "overlay" ? { overlay: over.url } : {}),
        dur: media.as === "video" ? Math.round(Math.min(storyVideoSeconds(), media.seconds || storyVideoSeconds()) * 1000) : Math.round(num(s.dur, STORY_LIMITS.minMs, STORY_LIMITS.maxMs, 5000)), stickers: C0.stickers, ...(C0.dropped ? { dropped: C0.dropped } : {}) };
      if (media.as === "video") { const cap = storyVideoSeconds(), max = media.seconds || cap, T = Array.isArray(s.trim) ? s.trim : []; let a = num(T[0], 0, max, 0), z = num(T[1], 0, max, max); if (z - a < 1) { a = 0; z = max; } if (z - a > cap) z = a + cap; // never more than the play window, whatever was asked
        if (a > 0.05 || z < max - 0.05) { d.trim = [Math.round(a * 10) / 10, Math.round(z * 10) / 10]; d.dur = Math.round((z - a) * 1000); } }
      made.push(d); }
    // the event's photos: the same rules a moment has (server/social.js POST /api/moments)
    let photos = 0, photoNote = "";
    if (x && b.eventPhoto === true) { const open = V.momentsPublic(x.e), fits = (audience === "everyone" && open) || (audience === "event" && !open);
      if (!fits) photoNote = "audience"; else if (!own && x.e.noPhotos) photoNote = "no_photos"; else if (!own && (x.e.date || "9") > today(now)) photoNote = "not_yet";
      else { const S = scopeStore(store, x.ws); let have = S.list("moments").filter((m) => m.data?.eventId === x.id && lc(m.data.authorEmail || "") === email).length;
        for (const d of made) { if (have >= MOMENTS_PER_PERSON) { photoNote = "too_many"; break; }
          const doc = S.add("moments", { eventId: x.id, authorEmail: email, authorName: cleanText(u.name, 80), authorKey: "u:" + email, url: d.url, type: d.type, contentType: ups.get(d.url).ct, caption: "", ...(d.w ? { w: d.w, h: d.h } : {}), ...(d.poster ? { poster: d.poster } : {}), ...(d.type === "video" ? { seconds: Math.round(d.dur / 100) / 10 } : {}), story: d.id, at: d.at });
          d.momentId = doc.id; have++; photos++; }
        if (photos) for (const [em, L] of I.att) if (em !== email && L.some((a) => a.eventId === x.id)) X.notify(em, { kind: "photos", key: `ph-${x.id}-${new Date(now).toISOString().slice(0, 13)}`, text: `New photos from ${cleanText(x.e.pubTitle || x.e.name, 80) || "your event"}${u.name ? `, from ${first(u.name)}` : ""}`, link: `/g#rsvp-${x.id}`, eventId: x.id }); } }
    for (const d of made) store.set("system/pstory-" + d.id, d); X.bust?.();
    return { ok: true, ids: made.map((d) => d.id), audience, reach: reachOf(email, X.index()), photos, ...(photoNote ? { photoNote } : {}), waiting: !!(photos && x && !own && V.approve?.waiting({ authorEmail: email }, x)), dropped: made.reduce((a, d) => a + (d.dropped || 0), 0) }; }
  /** The author takes a story away for good: its picture leaves the event's photos too. */
  function remove(st) { if (st.momentId && st.eventId) { const x = X.index().events.get(st.eventId); try { if (x) scopeStore(store, x.ws).delete("moments/" + st.momentId); } catch {} }
    store.delete("system/pstory-" + st.id); store.delete("system/storyx-" + st.id); X.bust?.(); }
  /** Account deletion: every story this person made. */
  function forget(email) { let n = 0; for (const st of all().filter((s) => lc(s.author) === lc(email))) { remove(st); n++; } store.delete("system/" + upKey(email)); return n; }

  // ---------- what viewers do ----------
  /** One bell note per batch: a second reply inside the hour changes the words of the first note while it's unread. */
  function tell(to, key, text, link) { to = lc(to); if (!to || !X.notify) return; const k = `${key}-${new Date().toISOString().slice(0, 13)}`;
    if (X.notify(to, { kind: "story", key: k, title: text, text, link }) !== false) return;
    try { const p = "system/inbox-" + hash(to), d = store.get(p)?.data, it = d?.list?.find((i) => i.key === k); if (it && !it.read && it.text !== text) { it.text = text; it.title = text; store.set(p, d); } } catch {} }
  const who = (u) => ({ k: hash(u.email), e: lc(u.email), name: cleanText(first(u.name), 40) || "Someone" });
  const link = (st) => `/feed?st=${st.id}`;
  function seen(st, u) { const W = who(u); if (W.e === lc(st.author)) return false; const d = xOf(st.id); if (d.views[W.k]) return false; d.views[W.k] = { e: W.e, name: W.name, at: Date.now() }; const keys = Object.keys(d.views); if (keys.length > 3000) delete d.views[keys[0]]; xSave(st.id, d); return true; }
  function vote(st, u, sticker, option) { const s = (st.stickers || []).find((y) => y.id === sticker && y.t === "poll"); if (!s || ![0, 1].includes(option)) return { error: "No such poll.", status: 404, code: "not_found" };
    const W = who(u), d = xOf(st.id), R = (d.votes[s.id] ||= {}); if (W.k in R) return { error: "You already voted.", code: "voted", status: 409 }; R[W.k] = option; xSave(st.id, d); return { ok: true }; }
  function slide(st, u, sticker, value) { const s = (st.stickers || []).find((y) => y.id === sticker && y.t === "slider"); if (!s) return { error: "No such slider.", status: 404, code: "not_found" };
    const W = who(u), d = xOf(st.id), R = (d.slides[s.id] ||= {}); if (W.k in R) return { error: "You already answered.", code: "voted", status: 409 }; R[W.k] = Math.round(num(value, 0, 100, 50)); xSave(st.id, d); return { ok: true }; }
  function answer(st, u, sticker, text) { const s = (st.stickers || []).find((y) => y.id === sticker && y.t === "question"); if (!s) return { error: "No such question.", status: 404, code: "not_found" };
    const t = cleanText(text, STORY_LIMITS.answer); if (!t) return { error: "Write something first." }; const p = textProblem(t); if (p) return { error: p.message, code: p.code };
    const W = who(u), d = xOf(st.id); if (d.answers.filter((a) => a.k === W.k).length >= 5) return { error: "That's plenty for one story.", code: "too_many", status: 429 };
    d.answers.push({ k: W.k, e: W.e, name: W.name, sticker: s.id, text: t, at: Date.now() }); xSave(st.id, d);
    const n = d.answers.filter((a) => a.sticker === s.id).length; tell(st.author, "st-q-" + st.id, n === 1 ? `${W.name} answered "${s.prompt}": ${t.slice(0, 80)}` : `${n} answers to "${s.prompt}"`, link(st)); return { ok: true }; }
  function reply(st, u, text) { const t = cleanText(text, STORY_LIMITS.reply); if (!t) return { error: "Write something first." }; const p = textProblem(t); if (p) return { error: p.message, code: p.code };
    const W = who(u), d = xOf(st.id); if (d.replies.filter((a) => a.k === W.k).length >= 20) return { error: "That's plenty for one story.", code: "too_many", status: 429 };
    d.replies.push({ k: W.k, e: W.e, name: W.name, text: t, at: Date.now() }); xSave(st.id, d);
    const n = d.replies.filter((a) => a.k === W.k).length; tell(st.author, `st-re-${st.id}-${W.k.slice(0, 8)}`, n === 1 ? `${W.name} replied to your story: ${t.slice(0, 100)}` : `${W.name} sent ${n} replies to your story`, link(st)); return { ok: true }; }
  function react(st, u, emoji) { if (!REACTIONS.includes(emoji)) return { error: "Pick one of the reactions." }; const W = who(u), d = xOf(st.id), had = d.reacts[W.k]?.emoji;
    if (had === emoji) delete d.reacts[W.k]; else d.reacts[W.k] = { e: W.e, name: W.name, emoji, at: Date.now() }; xSave(st.id, d);
    const n = Object.keys(d.reacts).length; if (had == null && n) tell(st.author, "st-rx-" + st.id, n === 1 ? `${W.name} reacted ${emoji} to your story` : `${n} people reacted to your story`, link(st)); return { ok: true, mine: d.reacts[W.k]?.emoji || "" }; }
  /** For the author only: who saw it, and what came back. */
  function insights(st) { const d = xOf(st.id), byT = (a, b) => (b.at || 0) - (a.at || 0), R = d.reacts || {}, avgOf = (L) => (L.length ? Math.round(L.reduce((a, b) => a + b, 0) / L.length) : 0);
    return { id: st.id, at: st.at, until: st.until, live: live(st), audience: st.audience,
      seen: Object.entries(d.views || {}).map(([k, v]) => ({ name: v.name, at: v.at, ...(R[k] ? { react: R[k].emoji } : {}) })).sort(byT), count: Object.keys(d.views || {}).length,
      replies: (d.replies || []).map((r) => ({ name: r.name, text: r.text, at: r.at })).sort(byT),
      stickers: (st.stickers || []).filter((s) => ["poll", "question", "slider"].includes(s.t)).map((s) => s.t === "poll" ? { id: s.id, t: "poll", q: s.q, a: s.a, b: s.b, res: [0, 1].map((o) => Object.values(d.votes?.[s.id] || {}).filter((v) => v === o).length) }
        : s.t === "slider" ? { id: s.id, t: "slider", q: s.q, emoji: s.emoji, n: Object.keys(d.slides?.[s.id] || {}).length, avg: avgOf(Object.values(d.slides?.[s.id] || {})) }
        : { id: s.id, t: "question", prompt: s.prompt, answers: (d.answers || []).filter((a) => a.sticker === s.id).map((a) => ({ name: a.name, text: a.text, at: a.at })).sort(byT) }) }; }
  return { all, get, live, canSee, reachOf, myEvents, mayLink, evOut, checkStickers, stickersFor, stOf, item, rings, kept, mine, uploadsOf, noteUpload, create, remove, forget, seen, vote, slide, answer, reply, react, insights, blocked, xOf, ownerOf };
}

export function mountStoryMake(app, { store, small, raw, currentUser, C, X }) {
  const V = app.locals.feedVisual, M = makeStoryMake(store, { C, X, V, blocksOf: (em) => app.locals.appstore?.safety?.blocksOf(em) || [] });
  app.locals.storyMake = M; X.storyHook = M.rings; X.storyOf = M;
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const me = (req, res) => { res.set("Cache-Control", "private, no-store"); const u = currentUser(req); if (!u || u.ws === DEFAULT_WS || !u.email) { bad(res, "Sign in first.", 401, "unauthenticated"); return null; } return u; };
  // per person, per hour: stories made, files sent, and taps (votes, answers, replies, reactions)
  const hits = new Map(); const limited = (u, what, n) => { const k = what + ":" + lc(u.email), now = Date.now(); let h = hits.get(k); if (!h || now - h.start > HOUR) { h = { n: 0, start: now }; hits.set(k, h); } if (hits.size > 20000) hits.clear(); return ++h.n > n; };
  M.resetLimits = () => hits.clear();
  const slow = (res) => bad(res, "That's a lot at once. Give it a little while and try again.", 429, "rate_limited");
  /** The story behind a tap, if this person may see it; answers 404 otherwise (a private story never says it exists). */
  const seenBy = (req, res, u) => { const st = M.get(req.params.id); if (!st || !M.canSee(st, u.email)) { bad(res, "This story isn't here any more.", 404, "not_found"); return null; } return st; };

  // what the composer needs: my events for stickers and attaching, my highlights, who "everyone" is for me, the limits
  app.get("/api/story/compose", (req, res) => { const u = me(req, res); if (!u) return; const I = X.index(), t = new Date().toISOString().slice(0, 10), em = lc(u.email), h = C.profileOf(u.ws);
    const events = M.myEvents(em, I).map(({ x, own }) => ({ ...M.evOut(x), own, past: (x.e.date || "9") < t, open: V.cardPublic(x.e), wall: V.momentsPublic(x.e), photos: own || (!x.e.noPhotos && (x.e.date || "9") <= t), cta: V.eventCta(x.e, x.id).label }))
      .sort((a, b) => (a.past - b.past) || (a.past ? String(b.date).localeCompare(String(a.date)) : String(a.date || "9").localeCompare(String(b.date || "9")))).slice(0, 40);
    let followers = 0; try { followers = C.followersOf(u.ws).length; } catch {}
    res.json({ me: { name: first(u.name), handle: h?.handle || "" }, reach: M.reachOf(em, I), events, highlights: h?.handle ? V.approve.highlightsOf(u.ws).map((x) => ({ id: x.id, name: x.name })) : [], canHighlight: !!h?.handle, friends: X.friendsOf(em).length, followers,
      limits: { ...STORY_LIMITS, imageMB: Math.round((momentMaxBytes("image") / 1048576) * 10) / 10, videoMB: Math.round((momentMaxBytes("video") / 1048576) * 10) / 10, seconds: storyVideoSeconds(), hours: storyHours() }, reactions: REACTIONS }); });
  // hosts to mention: the ones I follow or am friends with first, then anyone by name
  app.get("/api/story/hosts", (req, res) => { const u = me(req, res); if (!u) return; if (limited(u, "hosts", 600)) return slow(res); const q = lc(req.query.q).replace(/^@/, "").slice(0, 40), em = lc(u.email), out = [];
    const friends = new Set(X.friendsOf(em).map((f) => lc(f.email)));
    for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS || ws === u.ws) continue; const h = C.profileOf(ws); if (!h?.handle) continue; const name = cleanText(h.name || h.handle, 60);
      if (q && !lc(h.handle).includes(q) && !lc(name).includes(q)) continue; const owner = M.ownerOf(ws); if (owner && M.blocked(em, owner)) continue;
      let near = friends.has(owner); if (!near) try { near = C.followersOf(ws).some((f) => lc(f.email) === em); } catch {}
      out.push({ handle: h.handle, name, near }); if (out.length > 400) break; }
    res.json({ hosts: out.sort((a, b) => (b.near - a.near) || a.name.localeCompare(b.name)).slice(0, 12).map(({ near, ...h }) => h) }); });

  // one file for a story: the flattened picture, the video as filmed, a video's see-through overlay, or its poster
  app.post("/api/story/media", raw, async (req, res) => { const u = me(req, res); if (!u) return; if (limited(u, "media", storyPerHour() * 8)) return slow(res);
    const as = String(req.query.as || ""), ct = String(req.get("content-type") || "").split(";")[0].trim().toLowerCase(), body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!["image", "video", "overlay", "poster"].includes(as)) return bad(res, "Say what this file is.");
    if (!body.length) return bad(res, "Empty upload.");
    const kind = momentKind(ct), want = as === "video" ? "video" : "image"; if (kind !== want) return bad(res, as === "video" ? "Videos are MP4, MOV or WebM." : "Photos are JPEG, PNG or WebP.", 415, "unsupported_type");
    const max = as === "overlay" || as === "poster" ? 2 * 1048576 : momentMaxBytes(kind); if (body.length > max) return bad(res, `${as === "video" ? "Videos" : "Photos"} can be up to ${Math.round((max / 1048576) * 10) / 10} MB.`, 413, "too_large");
    const real = sniffedAs(ct, body); if (!real || real === "image/gif" || (as === "overlay" && real !== "image/png")) return bad(res, as === "video" ? "That file isn't a video we can play. Try an MP4, MOV or WebM." : "That file isn't a photo we can show.", 415, "unsupported_type");
    let seconds = 0; if (as === "video") { seconds = videoSeconds(body); const said = +req.query.duration || 0, cap = storyVideoSeconds();
      if (seconds > cap * 2 + 0.6 || said > cap * 2 + 0.6) return bad(res, `Videos can be up to ${cap * 2} seconds long. A story plays up to ${cap} of them.`, 400, "too_long"); // the composer's trim picks which seconds play; the file is kept whole
      if (!seconds && body.length > unreadVideoMaxBytes()) return bad(res, "We couldn't read this video's length. Try an MP4 from your camera.", 400, "unknown_length"); seconds = seconds || said || 0; }
    const meta = await X.saveBlob(body, real, u.ws), w = Math.floor(+req.query.w || 0), h = Math.floor(+req.query.h || 0);
    M.noteUpload(u.email, { url: meta.url, as, ct: real, at: Date.now(), ...(w > 0 && h > 0 && w <= 20000 && h <= 20000 ? { w, h } : {}), ...(seconds ? { seconds: Math.round(seconds * 10) / 10 } : {}) });
    res.json({ ok: true, url: meta.url, as }); });

  app.post("/api/story", small, (req, res) => { const u = me(req, res); if (!u) return; if (limited(u, "make", storyPerHour())) return slow(res); try { X.ensureProfile?.(u); } catch {}
    const b = req.body || {}, R = M.create(u, b); if (R.error) return bad(res, R.error.message, R.error.status || 400, R.error.code || "invalid");
    // a highlight keeps it past its day; the scrapbook keeps its pictures on the author's page
    if (b.highlight && typeof b.highlight === "object") { try { const A = V.approve, L = A.highlightsOf(u.ws).slice(), items = R.ids.map((id) => "s:" + id); let h = b.highlight.id ? L.find((y) => y.id === String(b.highlight.id)) : null; const name = cleanText(b.highlight.name, 30);
      if (!h && name && L.length < 8 && C.profileOf(u.ws)?.handle) { h = { id: crypto.randomBytes(5).toString("hex"), name, cover: "", items: [], at: Date.now() }; L.push(h); }
      if (h) { h.items = [...new Set([...(h.items || []), ...items])].slice(0, 30); A.save(u.ws, { highlights: L }); R.highlight = { id: h.id, name: h.name }; } } catch {} }
    if (b.scrapbook === true) { try { const L = M.all().filter((s) => R.ids.includes(s.id)), pics = L.filter((s) => s.type === "image").map((s) => s.url).slice(0, 12), x = L[0]?.eventId ? X.index().events.get(L[0].eventId) : null;
      if (pics.length) { const day = new Date().toISOString().slice(0, 10), id = crypto.randomBytes(6).toString("hex"); scopeStore(store, u.ws).set("scrapbook/" + id, { title: x ? cleanText(x.e.pubTitle || x.e.name, 140) : "From my story", date: x?.e.date || day, time: "", place: "", guests: 0, note: "", about: "", source: "", site: "", link: "", photos: pics, cover: pics[0], at: Date.now(), featured: false, featuredOrder: 0, section: "", story: R.ids[0] }); R.scrapbook = id; } } catch {} }
    res.json(R); });
  // my stories, newest first (Your stories, and the bell's link to one of them)
  app.get("/api/story/mine", (req, res) => { const u = me(req, res); if (!u) return; const I = X.index(), em = lc(u.email), now = Date.now(), h = C.profileOf(u.ws);
    const waits = (s) => { if (!s.momentId || !s.eventId) return false; const x = I.events.get(s.eventId), m = x && scopeStore(store, x.ws).get("moments/" + s.momentId)?.data; return !!m && !m.hidden && V.approve.waiting({ ...m, id: s.momentId }, x); };
    res.json({ host: { handle: h?.handle || "", name: h?.name || first(u.name), emoji: h?.emoji || "", color: "#29489A" }, stories: M.all().filter((s) => lc(s.author) === em).sort((a, b) => b.at - a.at).slice(0, 60).map((s) => ({ ...M.item(s, em, I), live: M.live(s, now), until: s.until, waiting: waits(s) })) }); });
  app.post("/api/story/seen", small, (req, res) => { const u = me(req, res); if (!u) return; if (limited(u, "seen", 3000)) return slow(res); let n = 0;
    for (const id of (Array.isArray(req.body?.ids) ? req.body.ids : []).slice(0, 40)) { const st = M.get(id); if (st && M.canSee(st, u.email) && M.seen(st, u)) n++; } res.json({ ok: true, seen: n }); });
  const tap = (f) => (req, res) => { const u = me(req, res); if (!u) return; if (limited(u, "tap", 240)) return slow(res); const st = seenBy(req, res, u); if (!st) return;
    if (lc(st.author) === lc(u.email)) return bad(res, "This one is yours.", 400, "own"); const R = f(st, u, req.body || {}); if (R.error) return bad(res, R.error, R.status || 400, R.code || "invalid");
    res.json({ ...R, st: M.stOf(st, u.email, X.index()) }); };
  app.post("/api/story/:id/vote", small, tap((st, u, b) => M.vote(st, u, String(b.sticker || ""), b.option)));
  app.post("/api/story/:id/slide", small, tap((st, u, b) => M.slide(st, u, String(b.sticker || ""), b.value)));
  app.post("/api/story/:id/answer", small, tap((st, u, b) => M.answer(st, u, String(b.sticker || ""), b.text)));
  app.post("/api/story/:id/reply", small, tap((st, u, b) => M.reply(st, u, b.text)));
  app.post("/api/story/:id/react", small, tap((st, u, b) => M.react(st, u, String(b.emoji || ""))));
  // seen by, replies, answers and results: the author only (anyone else gets the same 404 as a story that isn't there)
  app.get("/api/story/:id/insights", (req, res) => { const u = me(req, res); if (!u) return; const st = M.get(req.params.id); if (!st || lc(st.author) !== lc(u.email)) return bad(res, "This story isn't here any more.", 404, "not_found"); res.json(M.insights(st)); });
  app.delete("/api/story/:id", (req, res) => { const u = me(req, res); if (!u) return; const st = M.get(req.params.id); if (!st || lc(st.author) !== lc(u.email)) return bad(res, "This story isn't here any more.", 404, "not_found"); M.remove(st); res.json({ ok: true }); });
  return M;
}
