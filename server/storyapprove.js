// Your stories: what shows under your name is yours to approve and make your own (public/yourstories.html).
//
// Approve. A host's ring (the stories row, GET /api/feed/stories, the public feed, the host page's highlights) holds:
// - the host's own uploads, flyers for their own public events and past covers: out as before, no extra step;
// - photos guests add to the host's events, and recap stories made from an event's photos and kudos: these wait as
//   "Waiting for you" until the host taps Approve, unless "Show guests' photos without asking" is on. That switch is
//   off for hosts who join from now on and ON for hosts who were here before this shipped (system/storyapprove-start
//   records when), so nothing that showed yesterday disappears.
//   Not this one (and Remove) hides the photo everywhere, the way the host's Hide always has (moment.hidden); a declined
//   recap never shows. One bell note per event ("3 new photos from Board game night are waiting"), its count kept true.
// - Approval never widens who can see anything: every photo still goes through momentSeen and every recap through
//   momentsPublic / wasThere (server/feedvisual.js). A private or friends-only event stays with the people who were there.
// - A guest's photo is theirs: they can remove it anywhere, any time (it is deleted), and choose whether it shows
//   under their own name to friends (moment.offProfile; the photo stays on the event either way).
//
// Personalize. Captions (plain text, emails and phone numbers scrubbed), the order of an event's photos, the ring's cover,
// a recap's title line, its quote (one of the real kudos, or none) and its cover, and up to 8 named highlights that keep
// photos and recaps past their 14 days and 24 hours. server/feedvisual.js stories() and recapOf() read all of it here.
//
// Storage: system/stories-<ws> { guestsAuto?, order: { <eventId>: [momentId] }, ringCover, highlights: [{ id, name, cover, items }] };
// on a moment: storyOk (approved at), hidden, offProfile, caption; on the recap doc: okAt, declined, title, quote, cover.
import crypto from "node:crypto";
import { scopeStore, getWorkspace, getDbUser, workspaceOfEvent, DEFAULT_WS } from "./workspaces.js";

const DAY = 864e5, ID = /^[A-Za-z0-9_-]{1,80}$/;
export const STORY_LIMITS = { highlights: 8, highlightItems: 30, name: 30, caption: 200, title: 80 };
const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
/** User text, cleaned like every caption: no control characters, emails or phone numbers. */
export const cleanText = (v, n = 200) => String(v ?? "").replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s*\u2014\s*/g, ", ").replace(/\s+/g, " ").trim().slice(0, n).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "…").replace(/\(?(?:\+?\d[\s().-]*){7,}\d/g, "…");
const hash = (s) => crypto.createHash("sha256").update(lc(s)).digest("hex").slice(0, 24);
const hashKey = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 20); // the same key as server/feedvisual.js recapKey
export const recapPath = (id) => "system/recap-" + hashKey("recap:" + id);
/** "3 new photos from Board game night are waiting". Pure. */
export const waitingLine = (n, title) => `${n} new ${n === 1 ? "photo" : "photos"} from ${title} ${n === 1 ? "is" : "are"} waiting`;

export function makeStoryApprove(store, { C, X }) {
  const sys = (k) => store.get("system/" + k)?.data || null;
  // when approvals began here: hosts from before keep today's behaviour (guests' photos show without asking)
  const startedAt = () => { let d = sys("storyapprove-start"); if (!d) { d = { kind: "storyapprove", at: Date.now() }; store.set("system/storyapprove-start", d); } return d.at; };
  startedAt();
  const docOf = (ws) => sys("stories-" + ws) || { kind: "stories" };
  const save = (ws, patch) => { const d = { ...docOf(ws), ...patch, kind: "stories", ws }; store.set("system/stories-" + ws, d); X.bust?.(); return d; };
  const legacy = (ws) => { const at = getWorkspace(ws)?.createdAt || 0; return !!at && at < startedAt(); };
  /** { guestsAuto, legacy }: the switch as set, else on for hosts from before and off for new ones. */
  const cfg = (ws) => { const d = docOf(ws); return { guestsAuto: typeof d.guestsAuto === "boolean" ? d.guestsAuto : legacy(ws), legacy: legacy(ws) }; };
  const own = (m, x) => { const em = lc(m.authorEmail); return !!em && (em === lc(x.owner) || getDbUser(em)?.ws === x.ws); };
  /** A guest's photo the host hasn't approved yet (and hasn't said can show without asking). */
  const waiting = (m, x) => !!x && !m.storyOk && !own(m, x) && !cfg(x.ws).guestsAuto;
  /** A recap's state for its stored doc: "ok", "waiting" or "declined". */
  const recapState = (x, d) => (d?.declined ? "declined" : d?.okAt || cfg(x.ws).guestsAuto ? "ok" : "waiting");
  /** An event's photos in the host's order (ids not in the list keep their time order, after it). */
  const ordered = (ws, eventId, L, idOf = (m) => m.id) => { const O = docOf(ws).order?.[eventId]; if (!Array.isArray(O) || !O.length) return L; const at = new Map(O.map((id, i) => [id, i])); return L.map((m, i) => [m, i]).sort((a, b) => (at.has(idOf(a[0])) ? at.get(idOf(a[0])) : 1e6 + a[1]) - (at.has(idOf(b[0])) ? at.get(idOf(b[0])) : 1e6 + b[1])).map((p) => p[0]); };
  /** A ring's items with each event's photos in the host's order (the events stay where they were). */
  function arrange(ws, items) { if (!docOf(ws).order) return items; const by = new Map(); items.forEach((it, i) => { if (!/^m:/.test(it.id) || !it.ev) return; if (!by.has(it.ev)) by.set(it.ev, []); by.get(it.ev).push(i); });
    const out = items.slice(); for (const [ev, idx] of by) { const L = ordered(ws, ev, idx.map((i) => items[i]), (it) => it.id.slice(2)); idx.forEach((i, k) => (out[i] = L[k])); } return out; }
  const ringCover = (ws) => docOf(ws).ringCover || "";
  const highlightsOf = (ws) => (Array.isArray(docOf(ws).highlights) ? docOf(ws).highlights : []);
  // ---- the bell: one note per event, its count kept true while it is unread ----
  function tellHost(x, n) { const owner = lc(x.owner); if (!owner || !X.notify) return; const title = cleanText(x.e.pubTitle || x.e.name, 80) || "your event", key = "sa-wait-" + x.id, text = n ? waitingLine(n, title) : `A recap of ${title} is waiting`;
    if (X.notify(owner, { kind: "photos", key, title: text, text, link: "/your-stories", eventId: x.id }) !== false) return;
    try { const p = "system/inbox-" + hash(owner), d = store.get(p)?.data; const it = d?.list?.find((i) => i.key === key); if (n && it && !it.read && it.text !== text) { it.text = text; it.title = text; store.set(p, d); } } catch {} }
  return { cfg, own, waiting, recapState, ordered, arrange, ringCover, highlightsOf, docOf, save, legacy, tellHost, startedAt };
}

export function mountStoryApprove(app, { store, small, currentUser, C, X, sendStatic }) {
  const V = app.locals.feedVisual, A = V.approve; app.locals.storyApprove = A;
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const me = (req, res) => { res.set("Cache-Control", "private, no-store"); const u = currentUser(req); if (!u || u.ws === DEFAULT_WS || !u.email) { bad(res, "Sign in first.", 401, "unauthenticated"); return null; } return u; };
  const momentAt = (id) => { if (!ID.test(String(id || ""))) return null; const I = X.index(); let m = I.moments.find((y) => y.id === id), ws = m?.ws; if (!m) for (const w of new Set([...I.events.values()].map((v) => v.ws))) { const d = scopeStore(store, w).get("moments/" + id)?.data; if (d) { m = { id, ws: w, ...d }; ws = w; break; } }
    const x = m ? I.events.get(m.eventId) : null; return m && x ? { m, x, S: scopeStore(store, ws) } : null; };
  const isHost = (u, x) => x.ws === u.ws;
  const mOut = (m, x) => ({ id: m.id, url: m.url, type: m.type, poster: V.MEDIA_OK(m.poster) ? m.poster : "", caption: m.caption || "", by: first(m.authorName) || "", own: A.own(m, x), at: m.at || 0 });
  const myEvents = (u, I) => [...I.events.values()].filter((x) => x.ws === u.ws && !x.e.example);
  const allMoments = (x) => scopeStore(store, x.ws).list("moments").map((d) => ({ id: d.id, ws: x.ws, ...d.data })).filter((m) => m.eventId === x.id);
  const quotesOf = (I, x) => V.kudosOf(I, x.id).filter((k) => k.love && k.verified).map((k) => ({ id: k.id, text: cleanText(k.love, 220), name: first(k.name) || "A guest" }));
  const recapDoc = (id) => store.get(recapPath(id))?.data || null;
  // the bell for the host when a guest's photo starts waiting (server/social.js writes the moment; this only watches)
  const told = new Set();
  try { store.events?.on?.("change", (e) => { const m = /^ws\/([^/]+)\/moments\/([^/]+)$/.exec(String(e?.path || "")); if (!m || told.has(m[2])) return; told.add(m[2]); if (told.size > 5000) told.clear();
    setImmediate(() => { try { const d = scopeStore(store, m[1]).get("moments/" + m[2])?.data; if (!d || d.hidden || Date.now() - (d.at || 0) > 60e3) return; X.bust(); const x = X.index().events.get(d.eventId); if (!x || !A.waiting({ id: m[2], ...d }, x)) return;
      A.tellHost(x, allMoments(x).filter((y) => !y.hidden && A.waiting(y, x)).length); } catch {} }); }); } catch {}

  app.get("/your-stories", (req, res) => sendStatic(res, "yourstories.html", "<p>Page missing.</p>"));
  /** Everything "Your stories" shows this person. */
  app.get("/api/me/stories", (req, res) => { const u = me(req, res); if (!u) return; const I = X.index(), em = lc(u.email), h = C.profileOf(u.ws), now = Date.now(), c = A.cfg(u.ws);
    const waiting = [], live = [];
    for (const x of myEvents(u, I).sort((a, b) => String(b.e.date || "").localeCompare(String(a.e.date || "")))) { if (x.e.cancelled) continue; const M = allMoments(x).filter((m) => !m.hidden).sort((a, b) => (a.at || 0) - (b.at || 0)), W = M.filter((m) => A.waiting(m, x)), L = A.ordered(u.ws, x.id, M.filter((m) => !A.waiting(m, x)));
      const d = recapDoc(x.id), rs = d ? A.recapState(x, d) : "", title = x.e.pubTitle || x.e.name || "", ev = { eventId: x.id, title, date: x.e.date || "", open: V.momentsPublic(x.e) };
      const recap = d && rs !== "declined" ? { state: rs, title: d.title || title, quote: d.quote || "", cover: d.cover || "", quotes: quotesOf(I, x), showing: rs === "ok" && now - (d.okAt || d.madeAt) <= DAY } : null;
      if (W.length || recap?.state === "waiting") waiting.push({ ...ev, photos: W.map((m) => mOut(m, x)), recap: recap?.state === "waiting" ? recap : null });
      if (L.length || recap?.state === "ok") live.push({ ...ev, photos: L.map((m) => ({ ...mOut(m, x), fresh: (m.at || 0) > now - 14 * DAY })), recap: recap?.state === "ok" ? recap : null }); }
    // the person's own photos on other people's events: theirs to remove, and to show under their name or not
    const mine = I.moments.filter((m) => lc(m.authorEmail) === em && I.events.get(m.eventId)?.ws !== u.ws).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 60).map((m) => { const x = I.events.get(m.eventId); return { ...mOut(m, x), title: x.e.pubTitle || x.e.name || "", date: x.e.date || "", profile: !m.offProfile }; });
    res.json({ host: h?.handle ? { handle: h.handle, name: h.name || "" } : null, hosts: myEvents(u, I).length > 0, guestsAuto: c.guestsAuto, legacy: c.legacy, waiting, live, mine, ringCover: A.ringCover(u.ws), highlights: A.highlightsOf(u.ws), limits: STORY_LIMITS }); });
  app.post("/api/me/stories/settings", small, (req, res) => { const u = me(req, res); if (!u) return; if (typeof req.body?.guestsAuto !== "boolean") return bad(res, "Say on or off."); A.save(u.ws, { guestsAuto: req.body.guestsAuto }); res.json({ ok: true, guestsAuto: req.body.guestsAuto }); });
  // Approve / Not this one: photos by id, and an event's recap
  const decide = (ok) => (req, res) => { const u = me(req, res); if (!u) return; const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 100) : [], rid = String(req.body?.recap || ""); let n = 0;
    for (const id of ids) { const T = momentAt(id); if (!T || !isHost(u, T.x)) continue; T.S.update("moments/" + id, ok ? { storyOk: Date.now(), hidden: false } : { hidden: true, hiddenAt: Date.now() }); n++; }
    if (rid) { if (!ID.test(rid) || workspaceOfEvent(rid) !== u.ws) return bad(res, "No such event.", 404, "not_found"); const d = recapDoc(rid); if (!d) return bad(res, "No recap for this one yet.", 404, "not_found"); store.set(recapPath(rid), ok ? { ...d, okAt: Date.now(), declined: false } : { ...d, declined: true }); n++; }
    if (!n) return bad(res, "Nothing to change.", 404, "not_found"); X.bust(); res.json({ ok: true, changed: n }); };
  app.post("/api/me/stories/approve", small, decide(true)); app.post("/api/me/stories/decline", small, decide(false));
  // one photo: its caption (the host or whoever added it), and whether it shows under the guest's own name
  app.post("/api/me/stories/photo/:id", small, (req, res) => { const u = me(req, res); if (!u) return; const T = momentAt(req.params.id); if (!T) return bad(res, "No such photo.", 404, "not_found"); const author = lc(T.m.authorEmail) === lc(u.email), host = isHost(u, T.x); if (!author && !host) return bad(res, "No such photo.", 404, "not_found");
    const p = {}; if (typeof req.body?.caption === "string") p.caption = cleanText(req.body.caption, STORY_LIMITS.caption); if (author && typeof req.body?.profile === "boolean") p.offProfile = !req.body.profile;
    if (!Object.keys(p).length) return bad(res, "Nothing to change."); T.S.update("moments/" + T.m.id, p); X.bust(); res.json({ ok: true, caption: p.caption ?? T.m.caption ?? "", profile: !(p.offProfile ?? T.m.offProfile) }); });
  // remove: whoever added a photo takes it away for good, anywhere; the host takes it off every surface (hidden, as Hide always has)
  app.delete("/api/me/stories/photo/:id", (req, res) => { const u = me(req, res); if (!u) return; const T = momentAt(req.params.id); if (!T) return bad(res, "No such photo.", 404, "not_found"); const author = lc(T.m.authorEmail) === lc(u.email), host = isHost(u, T.x); if (!author && !host) return bad(res, "No such photo.", 404, "not_found");
    if (author) T.S.delete("moments/" + T.m.id); else T.S.update("moments/" + T.m.id, { hidden: true, hiddenAt: Date.now() }); X.bust(); res.json({ ok: true, deleted: author }); });
  app.post("/api/me/stories/order", small, (req, res) => { const u = me(req, res); if (!u) return; const ev = String(req.body?.eventId || ""), ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter((i) => ID.test(String(i))).slice(0, 200); if (!ID.test(ev) || workspaceOfEvent(ev) !== u.ws) return bad(res, "No such event.", 404, "not_found");
    A.save(u.ws, { order: { ...(A.docOf(u.ws).order || {}), [ev]: ids } }); res.json({ ok: true }); });
  app.post("/api/me/stories/ring", small, (req, res) => { const u = me(req, res); if (!u) return; const id = String(req.body?.id || ""); if (id) { const T = momentAt(id); if (!T || !isHost(u, T.x) || T.m.hidden || T.m.type !== "image") return bad(res, "Pick one of your story's photos.", 404, "not_found"); } A.save(u.ws, { ringCover: id }); res.json({ ok: true, ringCover: id }); });
  // a recap's title line, its quote (one of the real kudos, or none) and its cover
  app.post("/api/me/stories/recap/:eventId", small, (req, res) => { const u = me(req, res); if (!u) return; const ev = String(req.params.eventId || ""); if (!ID.test(ev) || workspaceOfEvent(ev) !== u.ws) return bad(res, "No such event.", 404, "not_found"); const d = recapDoc(ev); if (!d) return bad(res, "No recap for this one yet.", 404, "not_found");
    const I = X.index(), x = I.events.get(ev), b = req.body || {}, p = {};
    if (typeof b.title === "string") p.title = cleanText(b.title, STORY_LIMITS.title);
    if (typeof b.quote === "string") { if (b.quote && b.quote !== "none" && !quotesOf(I, x).some((k) => k.id === b.quote)) return bad(res, "Pick one of the kudos guests left."); p.quote = b.quote; }
    if (typeof b.cover === "string") { if (b.cover) { const T = momentAt(b.cover); if (!T || T.x.id !== ev || T.m.hidden) return bad(res, "Pick one of this event's photos."); } p.cover = b.cover; }
    store.set(recapPath(ev), { ...d, ...p }); X.bust(); res.json({ ok: true, ...p }); });
  // highlights: named sets that outlive the 14 days and the 24 hours. items: "m:<photo id>" or "r:<event id>" from this host's own events
  const okItem = (u, I, it) => { const m = /^(m|r|s):([A-Za-z0-9_-]{1,80})$/.exec(String(it || "")); if (!m) return false; if (m[1] === "s") return !!X.storyOf?.mine(m[2], u.email); /* a story the person made (server/storymake.js) */ if (m[1] === "r") return I.events.get(m[2])?.ws === u.ws && !!recapDoc(m[2]); const T = momentAt(m[2]); return !!T && isHost(u, T.x) && !T.m.hidden; };
  app.post("/api/me/stories/highlights", small, (req, res) => { const u = me(req, res); if (!u) return; const I = X.index(), b = req.body || {}, L = A.highlightsOf(u.ws).slice(), name = cleanText(b.name, STORY_LIMITS.name);
    if (Array.isArray(b.order)) { const by = new Map(L.map((h) => [h.id, h])), next = b.order.map((id) => by.get(id)).filter(Boolean); for (const h of L) if (!next.includes(h)) next.push(h); A.save(u.ws, { highlights: next }); return res.json({ ok: true, highlights: next }); }
    let h = b.id ? L.find((y) => y.id === b.id) : null; if (b.id && !h) return bad(res, "No such highlight.", 404, "not_found");
    if (!h) { if (L.length >= STORY_LIMITS.highlights) return bad(res, `You can keep up to ${STORY_LIMITS.highlights} highlights. Delete one to add another.`, 400, "too_many"); if (!name) return bad(res, "Give it a name, like Supper clubs."); h = { id: crypto.randomBytes(5).toString("hex"), name, cover: "", items: [], at: Date.now() }; L.push(h); }
    if (name) h.name = name;
    if (Array.isArray(b.items)) h.items = [...new Set(b.items.map(String))].filter((it) => okItem(u, I, it)).slice(0, STORY_LIMITS.highlightItems);
    if (typeof b.add === "string" && okItem(u, I, b.add) && !h.items.includes(b.add)) { if (h.items.length >= STORY_LIMITS.highlightItems) return bad(res, "That highlight is full."); h.items.push(b.add); }
    if (typeof b.remove === "string") h.items = h.items.filter((it) => it !== b.remove);
    if (typeof b.cover === "string") { if (b.cover && !(h.items.includes("m:" + b.cover) && momentAt(b.cover)?.m.type === "image")) return bad(res, "Pick a photo that's in this highlight."); h.cover = b.cover; }
    A.save(u.ws, { highlights: L }); res.json({ ok: true, highlight: h, highlights: L }); });
  app.delete("/api/me/stories/highlights/:id", (req, res) => { const u = me(req, res); if (!u) return; const L = A.highlightsOf(u.ws), next = L.filter((h) => h.id !== req.params.id); if (next.length === L.length) return bad(res, "No such highlight.", 404, "not_found"); A.save(u.ws, { highlights: next }); res.json({ ok: true, highlights: next }); });
  /** A host's highlights as story sets, for this viewer (every photo through momentSeen, every recap through its own rules). */
  function highlightsFor(ws, email = "") { const I = X.index(), h = V.hostOf(ws, I); if (!h) return [];
    return A.highlightsOf(ws).map((hl) => { const items = [];
      for (const it of hl.items || []) { const [k, id] = [it.slice(0, 1), it.slice(2)];
        if (k === "s") { const si = X.storyOf?.kept(id, ws, email, I, "h:" + hl.id + ":"); if (si) items.push({ ...si, caption: si.caption || hl.name, cta: si.cta || { label: "See the page", url: `/@${h.handle}` } }); continue; }
        if (k === "m") { const m = I.moments.find((y) => y.id === id), x = m ? I.events.get(m.eventId) : null; if (!m || !x || x.ws !== ws || A.waiting(m, x) || !V.momentSeen(I, m, email)) continue; const o = V.momentOut(m);
          items.push({ id: "h:" + hl.id + ":" + m.id, ev: x.id, type: m.type === "video" ? "video" : "image", url: m.url, ...(o.poster ? { poster: o.poster } : {}), thumb: m.type === "video" ? o.poster || "" : m.url, caption: x.e.pubTitle || x.e.name || "", note: o.caption, by: o.by, at: m.at || 0, past: true, cta: { label: "See the page", url: `/@${h.handle}` } }); }
        else { const x = I.events.get(id), R = x && x.ws === ws ? V.recapOf(I, x, { email, keep: true }) : null; if (R) items.push(...R.items.map((i) => ({ ...i, id: "h:" + hl.id + ":" + i.id }))); } }
      const cv = hl.cover ? items.find((i) => i.id === "h:" + hl.id + ":" + hl.cover) : null;
      return items.length ? { key: "hl:" + hl.id, id: hl.id, name: hl.name, host: h, items, highlight: true, thumb: cv?.url || (items.find((i) => i.thumb) || {}).thumb || (items.find((i) => i.recap?.cover) || {}).recap?.cover || "" } : null; }).filter(Boolean); }
  A.highlightsFor = highlightsFor;
  app.get("/api/public/highlights/:handle", (req, res) => { const ws = C.wsOfHandle(String(req.params.handle || "").toLowerCase().replace(/^@/, "")), u = currentUser(req), email = u && u.ws !== DEFAULT_WS ? lc(u.email) : ""; res.set("Cache-Control", "private, no-store"); res.json({ highlights: ws ? highlightsFor(ws, email) : [] }); });
  // preview as a visitor: exactly what someone signed out gets for this host
  app.get("/api/me/stories/preview", (req, res) => { const u = me(req, res); if (!u) return; const h = C.profileOf(u.ws); res.json({ ring: (h?.handle && V.stories({}).find((s) => s.host?.handle === h.handle && !s.showcase)) || null, highlights: highlightsFor(u.ws, "") }); });
  return A;
}
