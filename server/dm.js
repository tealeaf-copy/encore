// Direct messages: one person to one person, inside Chats (/chats/dm/<id>; public/chat.js draws them with the event
// chats, public/dmstart.js starts one from a host page, a guest card, a friend row or a share sheet).
//
// Who can message whom without asking (free):
//   - someone who added you as a friend can be messaged by you; friends who added each other, both ways
//   - people who follow each other (a page follow or a friend add, in both directions)
//   - people who are or were at the same event: its host, co-hosts and guests who were in
//   - a host and anyone who replied to one of their events or ordered from one of their drops (any reply)
//   - both hosts of an accepted team-up (server/collab.js)
// Everyone else is a request: the first message lands under Requests, the sender can send one message and no photos
// or cards until it is accepted, links stay plain text, and a request never shows "Seen". The person asked can
// Accept, Delete (the sender is not told) or Block. "Who can message me" (system/dmprefs-<hash>) decides who may send
// a request at all: everyone | common (something in common: the default for an account that has never hosted) |
// follow (people I follow) | none. Hosts default to everyone. People on the free list can always write.
// Blocks (server/safety.js, either direction) close a thread for both and hide it from the person who blocked.
// A brand account writing to a host is sent to the booking request thread (server/brandbook.js): one place, not two.
//
// Privacy: only the two people in a thread can read it or its photos (a third person gets a 404 for both). Photos are
// saved as private blobs (meta.dm), which /_blob never serves; GET /api/dm/:id/media/:blob checks the thread first.
// No email or phone is in any response: a thread id is an HMAC of the two emails, a person id an HMAC of one.
// A report (POST /api/report, type "message", target "dm:<thread>[:<message>]") copies the last messages into the
// moderation queue; the team then reads that copy and the reported photos, nothing else.
//
// Docs: system/dm-<tid> (the thread: who, state, the last line, each side's read time, unread count, mute, clear),
// system/dmm-<tid>-<mid> (one message), system/dmidx-<hash of email> (a person's thread ids), system/dmprefs-<hash>.
// Notifications: one bell item (and so one push, server/push.js) per conversation per unread streak; later messages
// change its words. Muted conversations send nothing. Email: one for a new request, and one for a conversation left
// unread for DM_EMAIL_AFTER, at most one a day per conversation. Never by SMS (server/pottotext.js ignores "dm").
import crypto from "node:crypto";
import { getDbUser, getWorkspace, scopeStore, DEFAULT_WS } from "./workspaces.js";
import { momentKind, momentMaxBytes, sniffedAs } from "./feedvisual.js";
import { textProblem, keyOf } from "./safety.js";
import { notify } from "./inbox.js";
import { whenLine } from "./chat.js";
import { isBrandWs } from "./people.js";
import { emailConfig, sendEmail } from "./email.js";

const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, n);
const hash = (s) => crypto.createHash("sha256").update(lc(s)).digest("hex").slice(0, 24); // the same key as server/social.js
const TID = /^[a-f0-9]{24}$/, MID = /^[a-f0-9]{16}$/, BLOB = /^[A-Za-z0-9]{20}$/, ID = /^[A-Za-z0-9_-]{1,80}$/, HANDLE = /^[a-z0-9][a-z0-9-]{1,29}$/;
const MEDIA_OK = (u) => /^\/_blob\/[A-Za-z0-9]{20}$/.test(u || "") || /^\/presets\/[a-z0-9-]{1,60}\.(jpg|webp|png)$/.test(u || "");
const HOUR = 3600e3, DAY = 864e5;

export const DM_REACTIONS = ["❤️", "😂", "👍", "😮", "🙌", "🔥"];
export const DM_MAX_TEXT = 2000;
export const DM_WHO = ["everyone", "common", "follow", "none"];
export const DM_EMAIL_AFTER = 6 * HOUR;
const num = (v, d) => { const n = Math.floor(+v); return Number.isFinite(n) && n > 0 ? n : d; };
/** Per person: messages an hour, photos an hour, new conversations a day, and requests to people they don't know a day. */
export const dmLimits = (env = process.env) => ({ perHour: num(env.ENCORE_DM_PER_HOUR, 200), photosPerHour: num(env.ENCORE_DM_PHOTOS_PER_HOUR, 30), newPerDay: num(env.ENCORE_DM_NEW_PER_DAY, 30), requestsPerDay: num(env.ENCORE_DM_REQUESTS_PER_DAY, 8) });

export function mountDM(app, { store, small, raw = null, currentUser, C, X, blobs = null, publicOrigin = () => "", isAdmin = () => false, jobs = !process.env.NODE_TEST_CONTEXT }) {
  const bad = (res, message, status = 400, code = "invalid", more = {}) => res.status(status).json({ code, message, ...more });
  const sys = (k) => store.get("system/" + k)?.data || null;
  let secret = ""; const sec = () => process.env.SESSION_SECRET || secret || (secret = sys("secret")?.v || (() => { const v = crypto.randomBytes(32).toString("hex"); store.set("system/secret", { v }); return v; })());
  const mac = (s, n = 24) => crypto.createHmac("sha256", sec()).update(s).digest("hex").slice(0, n);
  const tidOf = (a, b) => mac("dm|" + [lc(a), lc(b)].sort().join("|"));
  const pidOf = (email) => mac("dmp|" + lc(email), 20); // a person in people search: opaque, never their email
  const attKey = (eventId, email) => mac(`attendee:${eventId}|${lc(email)}`); // the guest card's key (server/social.js)
  const safety = () => app.locals.appstore?.safety || null, V = () => app.locals.feedVisual || null, SM = () => app.locals.storyMake || null;
  const me = (req, res) => { res.set("Cache-Control", "private, no-store"); let u = null; try { u = currentUser(req); } catch {} if (!u || u.ws === DEFAULT_WS || !u.email) { bad(res, "Sign in first.", 401, "unauthenticated"); return null; } return u; };

  // ---------- people ----------
  const ownerOf = (ws) => lc(getWorkspace(ws)?.ownerEmail || "");
  const isBrand = (ws) => isBrandWs(ws) && getWorkspace(ws)?.plan !== "self-hosted" && !C.profileOf(ws)?.handle; // a team account (server/people.js), not a host who also has a paid plan
  const avatarOf = (ws) => { const t = (ws && C.profileOf(ws)?.theme) || {}; return MEDIA_OK(t.avatarUrl) ? { url: t.avatarUrl } : typeof t.avatarArt === "string" && /^[a-z0-9~-]{1,40}$/i.test(t.avatarArt) ? { art: t.avatarArt } : null; };
  const tint = (k) => ["#F6D7A7", "#FBD3CB", "#CDEBD5", "#C4DEFF", "#E2D6F7", "#FCCBA6", "#F2E3B3"][parseInt(String(k).slice(0, 4), 16) % 7];
  /** What the other side sees of a person: a name, their page if they have one, a face. Never an email. */
  function face(email) { const em = lc(email), u = em ? getDbUser(em) : null; if (!u || u.deleteAt) return { name: "Deleted account", gone: true, tint: "#E9E2D8" };
    const p = u.ws ? C.profileOf(u.ws) : null, own = !!p?.handle && ownerOf(u.ws) === em, av = own ? avatarOf(u.ws) : null;
    return { name: clean(u.name || p?.name, 80) || "Someone", ...(own ? { handle: p.handle } : {}), ...(av ? { avatar: av } : {}), tint: tint(hash(em)) }; }
  const blockedBy = (a, b) => { try { const T = new Set((safety()?.blocksOf(a) || []).map((x) => x.target)), h = X.person(b).handle; return T.has("person:" + keyOf(b)) || (!!h && T.has("host:" + lc(h))); } catch { return false; } };
  const blockedEither = (a, b) => blockedBy(a, b) || blockedBy(b, a);

  // ---------- who may message whom ----------
  const friended = (a, b) => X.friendsOf(a).some((f) => lc(f.email) === lc(b)); // a added b
  /** a follows b: a added b as a friend, or follows b's page. */
  const follows = (a, b) => { if (friended(a, b)) return true; const ws = getDbUser(lc(b))?.ws; try { return !!ws && ws !== DEFAULT_WS && !!C.profileOf(ws)?.handle && C.followersOf(ws).some((f) => lc(f.email) === lc(a)); } catch { return false; } };
  const cohostsOf = (e) => (Array.isArray(e?.cohosts) ? e.cohosts : []).map((c) => lc(c?.handle).replace(/^@/, "")).filter((h) => HANDLE.test(h)).map((h) => { const w = C.wsOfHandle(h); return w ? ownerOf(w) : ""; }).filter(Boolean);
  /** Every event a person hosts, co-hosts or was in for: Map eventId -> host workspace. */
  function eventsOf(email, I) { const em = lc(email), out = new Map(); for (const a of I.att.get(em) || []) out.set(a.eventId, a.ws);
    for (const x of I.events.values()) if (lc(x.owner) === em || (x.e.cohosts?.length && cohostsOf(x.e).includes(em))) out.set(x.id, x.ws); return out; }
  const repliedTo = (host, guest) => { const ws = getDbUser(lc(host))?.ws; if (!ws || ws === DEFAULT_WS || isBrand(ws)) return false; try { return scopeStore(store, ws).list("rsvps").some((d) => lc(d.data?.email) === lc(guest)); } catch { return false; } };
  const teamedUp = (a, b) => { const wa = getDbUser(lc(a))?.ws, wb = getDbUser(lc(b))?.ws; if (!wa || !wb || wa === wb) return false; try { return store.listPrefix("system", "teamup-").some((d) => d.data?.kind === "teamup" && d.data.status === "accepted" && ((d.data.fromWs === wa && d.data.toWs === wb) || (d.data.fromWs === wb && d.data.toWs === wa))); } catch { return false; } };
  /** Why `from` may write to `to` without asking, or "" when it has to be a request. */
  function freeWhy(from, to, I = X.index()) { const a = lc(from), b = lc(to);
    if (friended(b, a)) return "friend"; if (follows(a, b) && follows(b, a)) return "mutual";
    const A = eventsOf(a, I), B = eventsOf(b, I); for (const id of A.keys()) if (B.has(id)) return "event";
    if (repliedTo(a, b) || repliedTo(b, a)) return "guest"; if (teamedUp(a, b)) return "teamup"; return ""; }
  /** Something in common, for an account that only takes requests from people it has a tie to. */
  function common(from, to, I = X.index()) { const a = lc(from), b = lc(to); if (follows(a, b) || follows(b, a)) return true;
    const fa = new Set(X.friendsOf(a).map((f) => lc(f.email))); if (X.friendsOf(b).some((f) => fa.has(lc(f.email)))) return true;
    const A = new Set(eventsOf(a, I).values()); for (const ws of eventsOf(b, I).values()) if (A.has(ws)) return true; return false; }
  const prefPath = (email) => "system/dmprefs-" + hash(email);
  const hostsThings = (email, I = X.index()) => { const ws = getDbUser(lc(email))?.ws; if (!ws || !C.profileOf(ws)?.handle) return false; for (const x of I.events.values()) if (x.ws === ws) return true; return false; };
  /** { who, default, host } for a person's "Who can message me". */
  function whoOf(email, I = X.index()) { const host = hostsThings(email, I), def = host ? "everyone" : "common", w = store.get(prefPath(email))?.data?.who; return { who: DM_WHO.includes(w) ? w : def, default: def, host }; }
  /** May `from` write to `to`? { ok: "free" | "request", why } or { ok: false, code, message, link? }. */
  function may(from, to, { story = false } = {}) { const a = lc(from), b = lc(to), ub = getDbUser(b), ua = getDbUser(a), no = (code, message, more = {}) => ({ ok: false, code, message, ...more });
    if (!a || !ua) return no("unauthenticated", "Sign in first."); if (!b || !ub || ub.deleteAt || ub.ws === DEFAULT_WS) return no("not_found", "That person isn't on Pottery Lab any more."); if (a === b) return no("self", "That's you.");
    if (blockedEither(a, b)) return no("closed", "You can't message this person.");
    if (process.env.ENCORE_ALLOW_DEMO_WRITES !== "1" && /@demo\.encore$/i.test(b)) return no("example", "This is an example host, so nothing is sent.");
    const hb = C.profileOf(ub.ws)?.handle; if (isBrand(ua.ws) && hb && ownerOf(ub.ws) === b) return no("use_booking", "Teams message a host from a booking request, so dates and details stay in one place.", { link: "/teams/bookings" });
    const I = X.index(), why = freeWhy(a, b, I); if (why) return { ok: "free", why };
    const w = whoOf(b, I).who, nm = first(ub.name) || "They";
    if (w === "none") return no("not_open", `${nm} isn't taking messages from new people.`);
    if (w === "follow" && !follows(b, a)) return no("not_open", `${nm} only takes messages from people they follow and their guests.`);
    if (w === "common" && !story && !common(a, b, I)) return no("not_open", `${nm} only takes messages from people they have something in common with. Follow them or go to the same event first.`);
    return { ok: "request", why: "" }; }

  // ---------- threads ----------
  const tPath = (tid) => "system/dm-" + tid, mPath = (tid, mid) => `system/dmm-${tid}-${mid}`, iPath = (email) => "system/dmidx-" + hash(email);
  const getT = (tid) => { if (!TID.test(String(tid || ""))) return null; const d = sys("dm-" + tid); return d?.kind === "dm" ? d : null; };
  const putT = (T) => store.set(tPath(T.id), T);
  const idsOf = (email) => sys("dmidx-" + hash(email))?.list || [];
  const index = (email, tid) => { const L = idsOf(email); if (L.includes(tid)) return; store.set(iPath(email), { kind: "dmidx", email: lc(email), list: [tid, ...L].slice(0, 3000) }); };
  const sideOf = (T, email) => { const em = lc(email); return em && (lc(T.a) === em || lc(T.b) === em) ? em : ""; };
  const peerOf = (T, email) => (lc(T.a) === lc(email) ? lc(T.b) : lc(T.a));
  const stOf = (T, email) => T.m?.[hash(email)] || {};
  const setSt = (T, email, patch) => { T.m = { ...(T.m || {}), [hash(email)]: { ...stOf(T, email), ...patch } }; };
  const msgsOf = (tid) => store.listPrefix("system", `dmm-${tid}-`).map((d) => d.data).filter((m) => m?.kind === "dmm").sort((a, b) => (a.at || 0) - (b.at || 0));
  /** The thread between two people, made on first open. It shows in the other person's list once it has a message. */
  function ensure(a, b) { const tid = tidOf(a, b); let T = getT(tid); if (!T) { const [x, y] = [lc(a), lc(b)].sort(); T = { kind: "dm", id: tid, a: x, b: y, by: "", state: "new", createdAt: Date.now(), lastAt: 0, n: 0, m: {} }; putT(T); } index(a, tid); return T; }
  /** A request turns into an open thread by itself once the two have a tie (they followed each other, went to the same event). */
  function settle(T) { if (!T.a || !T.b) return T; if ((T.state === "request" || T.state === "declined") && T.by && freeWhy(T.by, peerOf(T, T.by))) { T.state = "open"; T.acceptedAt = Date.now(); putT(T); } return T; }
  /** How this thread reads for one side: open | request_in | request_out | new | closed. */
  function viewState(T, email) { const em = lc(email), peer = peerOf(T, em); if (!peer || !getDbUser(peer) || getDbUser(peer).deleteAt) return { state: "closed", why: "gone" };
    if (blockedBy(em, peer)) return { state: "closed", why: "you_blocked" }; if (blockedBy(peer, em)) return { state: "closed", why: "closed" };
    if (T.state === "open") return { state: "open" }; if (T.state === "new") return { state: "new" };
    return lc(T.by) === em ? { state: "request_out" } : T.state === "declined" ? { state: "new" } /* a request you deleted: writing to them starts over, from your side */ : { state: "request_in" }; }

  // ---------- cards: an event, a drop, a host page or a story, sent into a thread ----------
  const coverOfEv = (e) => (MEDIA_OK(e.coverPhoto) ? e.coverPhoto : e.drop ? (e.orderItems || []).find((x) => MEDIA_OK(x?.photo))?.photo || "" : "");
  /** Check a card as it is sent. Returns the stored form { type, id } or null. */
  function cardIn(c, from, to) { const type = String(c?.type || ""), id = String(c?.id || ""), I = X.index();
    if (type === "event" || type === "drop") { const x = ID.test(id) ? I.events.get(id) : null; if (!x || x.e.example) return null; const there = (em) => !!V()?.wasThere?.(I, id, lc(em));
      if (!(V()?.cardPublic?.(x.e) || (there(from) && there(to)))) return null; return { type: x.e.drop ? "drop" : "event", id }; }
    if (type === "host") { const h = lc(id).replace(/^@/, ""); if (!HANDLE.test(h) || !C.wsOfHandle(h)) return null; if (safety()?.isHidden?.("host:" + h)) return null; return { type: "host", id: h }; }
    if (type === "story") { const st = SM()?.get(id); if (!st || !SM().canSee(st, lc(from))) return null; return { type: "story", id: st.id }; }
    return null; }
  /** A card as one person sees it now. A story that ran out, or that they may not see, reads "Story no longer available". */
  function cardOut(c, viewer, { bare = false } = {}) { if (!c) return null; const I = X.index();
    if (c.type === "event" || c.type === "drop") { const x = I.events.get(c.id), e = x?.e; if (!e || !(V()?.cardPublic?.(e) || V()?.wasThere?.(I, c.id, lc(viewer)))) return { type: c.type, gone: true, title: c.type === "drop" ? "This drop isn't available" : "This event isn't available" };
      const img = bare ? "" : coverOfEv(e); return { type: c.type, title: clean(e.pubTitle || e.name, 120) || "An event", sub: [e.cancelled ? "Cancelled" : whenLine(e), clean(e.hood || e.city, 60)].filter(Boolean).join(" · "), by: clean(C.profileOf(x.ws)?.name, 80), ...(img ? { img } : {}), url: e.discoverable ? `/e/${encodeURIComponent(c.id)}` : `/g#rsvp-${encodeURIComponent(c.id)}` }; }
    if (c.type === "host") { const ws = C.wsOfHandle(c.id), h = ws ? C.profileOf(ws) : null; if (!h?.handle || safety()?.isHidden?.("host:" + lc(h.handle))) return { type: "host", gone: true, title: "This page isn't available" };
      const av = bare ? null : avatarOf(ws); return { type: "host", title: clean(h.name, 80) || "@" + h.handle, sub: clean(h.tagline || [h.hood, h.city].filter(Boolean).join(", ") || "@" + h.handle, 120), ...(av?.url ? { img: av.url } : {}), url: "/@" + encodeURIComponent(h.handle) }; }
    if (c.type === "story") { const st = SM()?.get(c.id), live = !!st && SM().live(st) && SM().canSee(st, lc(viewer)); if (!live) return { type: "story", gone: true, title: "Story no longer available" };
      const own = lc(st.author) === lc(viewer), img = bare ? "" : MEDIA_OK(st.poster) ? st.poster : st.type === "image" && MEDIA_OK(st.url) ? st.url : "";
      return { type: "story", title: own ? "Your story" : `${first(st.authorName) || "Their"}${first(st.authorName) ? "'s" : ""} story`, sub: "Tap to open it", ...(img ? { img } : {}), url: `/feed?st=${st.id}` }; }
    return null; }
  /** A Pottery Lab link in a message becomes its card: /e/<id>, /g#rsvp-<id>, /@handle. */
  function cardFromText(text) { const t = String(text || ""); let m = /(?:^|[\s(])(?:https?:\/\/[^\s/]+)?\/(?:e\/|g#rsvp-)([A-Za-z0-9_-]{1,80})(?=$|[\s).,!?])/.exec(t); if (m) return { type: "event", id: m[1] };
    m = /(?:^|[\s(])(?:https?:\/\/[^\s/]+)?\/@([a-z0-9][a-z0-9-]{1,29})(?=$|[\s).,!?])/i.exec(t); return m ? { type: "host", id: lc(m[1]) } : null; }

  // ---------- messages out ----------
  const noteText = (m, mine) => { const n = m.note || {}; if (n.t === "react") return mine ? `You reacted ${n.emoji} to their story` : `Reacted ${n.emoji} to your story`;
    if (n.t === "answer") return `${mine ? "You answered" : "Answered"} "${clean(n.prompt, 80)}": ${clean(n.text, 300)}`; return clean(m.text, 300); };
  function outMsg(m, viewer, T, vs) { const mine = lc(m.from) === lc(viewer), k = hash(viewer), R = m.reactions || {}, hold = vs.state === "request_in" && !mine; // an unaccepted request: words only
    const base = { id: m.id, who: mine ? "me" : "them", by: first(face(m.from).name) || "Someone", role: "guest", mine, at: m.at || 0, reactions: Object.fromEntries(Object.entries(R).filter(([e, L]) => DM_REACTIONS.includes(e) && L?.length).map(([e, L]) => [e, { n: L.length, mine: L.includes(k) }])) };
    if (m.removedAt) return { ...base, kind: "text", text: "", removed: true, reactions: {} };
    if (m.mkind === "note") return { ...base, kind: "note", text: noteText(m, mine), ...(m.card ? { card: cardOut(m.card, viewer, { bare: true }) } : {}) };
    const card = m.card ? cardOut(m.card, viewer, { bare: hold }) : null;
    return { ...base, kind: m.mkind === "photo" ? "photo" : "text", text: String(m.text || ""),
      ...(m.mkind === "photo" && m.photo?.id ? (hold ? { held: "photo" } : { photo: { url: `/api/dm/${T.id}/media/${m.photo.id}`, ...(m.photo.w && m.photo.h ? { w: m.photo.w, h: m.photo.h } : {}) } }) : {}),
      ...(card ? { card: { ...card, ...(m.card.reply ? { reply: true } : {}) } } : {}),
      ...(m.replyTo ? { replyTo: { id: m.replyTo.id, by: clean(m.replyTo.by, 40), text: String(m.replyTo.text || "").slice(0, 120) } } : {}) }; }
  const lineOf = (m) => (m.removedAt ? "Message removed" : m.mkind === "photo" ? "Sent a photo" : m.mkind === "note" ? noteText(m, false) : m.card && !m.text ? ({ event: "Shared an event", drop: "Shared a drop", host: "Shared a page", story: "Shared a story" })[m.card.type] || "Shared something" : String(m.text || "").replace(/\s+/g, " ").slice(0, 90));
  const typing = new Map(); // tid|hash -> at
  const WHY = { gone: "This person deleted their account.", you_blocked: "You blocked this person. Unblock them in Settings to write again.", closed: "You can't send messages in this conversation." };
  function thread(T, email) { const em = lc(email), peer = peerOf(T, em), vs = viewState(T, em), st = stOf(T, em), cleared = st.clearedAt || 0, P = face(peer), M = face(em);
    const msgs = msgsOf(T.id).filter((m) => (m.at || 0) > cleared).slice(-300).map((m) => outMsg(m, em, T, vs)), open = vs.state === "open";
    const myLast = [...msgs].reverse().find((m) => m.mine && m.kind !== "note"), peerRead = stOf(T, peer).readAt || 0;
    const seen = open && myLast && peerRead >= myLast.at ? { id: myLast.id, n: 1, names: [first(P.name)] } : null;
    const sentOne = vs.state === "request_out" && msgsOf(T.id).some((m) => lc(m.from) === em && !m.removedAt), canWrite = open || vs.state === "new" || (vs.state === "request_out" && !sentOne);
    const fresh = vs.state === "new" ? may(em, peer) : null, pn = first(P.name) || "They";
    const readOnly = canWrite && !(fresh && !fresh.ok) ? "" : vs.state === "closed" ? WHY[vs.why] || WHY.closed : vs.state === "request_out" ? `You can send more once ${pn} accepts.` : vs.state === "request_in" ? "" : fresh?.message || WHY.closed;
    return { dm: true, id: T.id, state: vs.state, ...(vs.why ? { why: vs.why } : {}), plain: vs.state === "request_in" || vs.state === "request_out", ...(fresh?.ok === "request" ? { request: true } : {}), ...(fresh && !fresh.ok && fresh.link ? { link: fresh.link } : {}),
      event: { id: "dm/" + T.id, title: P.name, when: P.handle ? "@" + P.handle : "", url: P.handle ? "/@" + encodeURIComponent(P.handle) : "", host: first(P.name), accent: "" },
      peer: { name: P.name, first: pn, ...(P.handle ? { handle: P.handle } : {}), ...(P.avatar ? { avatar: P.avatar } : {}), tint: P.tint, ...(P.gone ? { gone: true } : {}) },
      me: { who: "me", name: first(M.name), role: "dm", canWrite: canWrite && !(fresh && !fresh.ok), readOnly, muted: !!st.muted },
      members: [{ who: "me", name: first(M.name), role: "guest", tint: M.tint, ...(M.avatar ? { avatar: M.avatar } : {}) }, { who: "them", name: pn, role: "guest", tint: P.tint, ...(P.avatar ? { avatar: P.avatar } : {}) }],
      messages: msgs, pins: [], typing: open && (typing.get(T.id + "|" + hash(peer)) || 0) > Date.now() - 6000 ? [pn] : [], seen, unreadFrom: st.readAt || 0, reactions: DM_REACTIONS, limits: { text: DM_MAX_TEXT } }; }
  const versionOf = (V0) => hash(JSON.stringify([V0.messages, V0.seen, V0.me, V0.state, V0.peer]));

  // ---------- the bell, push and email ----------
  /** One bell item per conversation per unread streak: a later message changes its words instead of adding a row. */
  function tell(T, from, to, m) { try { const st = stOf(T, to); if (st.muted || blockedEither(from, to)) return; const F = face(from), n = st.unread || 1, req = T.state === "request";
    const key = `dm-${T.id}-${st.unreadAt || 0}`, title = req ? `${F.name} wants to send you a message` : n > 1 ? `${n} new messages from ${F.name}` : `${F.name} sent you a message`;
    const preview = req ? "" : lineOf(m), link = req ? "/chats/dm/requests" : `/chats/dm/${T.id}`;
    if (notify(X, to, { kind: "dm", type: "chat", key, actor: { name: F.name, email: lc(from) }, title, preview, text: preview ? `${F.name}: ${preview}` : title, link }) !== false) { if (req) mailRequest(T, from, to).catch(() => {}); return; }
    const p = "system/inbox-" + hash(to), d = store.get(p)?.data, it = d?.list?.find((i) => i.key === key); if (it && !it.read) { Object.assign(it, { title, preview, text: preview ? `${F.name}: ${preview}` : title }); store.set(p, d); }
  } catch (e) { console.warn("[dm] tell", e?.message); } }
  /** Reading a conversation reads its bell items too. */
  function untell(T, email) { try { const p = "system/inbox-" + hash(email), d = store.get(p)?.data; if (!d?.list?.some((i) => !i.read && String(i.key || "").startsWith(`dm-${T.id}-`))) return; for (const i of d.list) if (String(i.key || "").startsWith(`dm-${T.id}-`)) i.read = true; store.set(p, d); } catch {} }
  const canMail = (email) => /@/.test(email) && !/@demo\.encore$/i.test(email) && X.canEmail?.(email) !== false && X.prefs?.(email)?.chatEmails !== false;
  async function mail(to, subject, text) { const cfg = emailConfig(DEFAULT_WS, true); if (!cfg || !canMail(to)) return { ok: false }; try { return await sendEmail(cfg, { to, subject, text, list: "guest" }); } catch { return { ok: false }; } }
  const originNow = () => String(process.env.ENCORE_PUBLIC_URL || "").replace(/\/$/, "");
  async function mailRequest(T, from, to) { const F = face(from), nm = first(getDbUser(lc(to))?.name) || "there";
    return mail(to, `${F.name} wants to send you a message`, `Hi ${nm},\n\n${F.name} sent you a message request on Pottery Lab. You can read it first, then accept, delete or block. They can't send more, and they won't know you've seen it, until you accept.\n\nSee the request: ${originNow()}/chats/dm/requests\n\nTo stop these, turn off chat emails in Settings, or change who can message you.\n`); }
  /** One email for a conversation left unread for DM_EMAIL_AFTER, at most one a day per conversation. */
  async function runDigest(now = Date.now()) { let sent = 0;
    for (const d of store.listPrefix("system", "dm-")) { const T = d.data; if (T?.kind !== "dm" || T.state !== "open" || !T.last || now - (T.lastAt || 0) > 3 * DAY) continue;
      for (const em of [lc(T.a), lc(T.b)]) { const st = stOf(T, em), peer = peerOf(T, em); if (!em || !peer || !st.unread || st.muted || blockedEither(em, peer)) continue;
        if (now - (st.unreadAt || T.lastAt) < DM_EMAIL_AFTER || now - (st.mailAt || 0) < DAY) continue; const F = face(peer);
        setSt(T, em, { mailAt: now }); putT(T); // set first: a slow or failed send never turns into a second email
        const r = await mail(em, `${st.unread === 1 ? "A message" : `${st.unread} messages`} from ${F.name}`, `Hi ${first(getDbUser(em)?.name) || "there"},\n\n${F.name} sent you ${st.unread === 1 ? "a message" : `${st.unread} messages`} on Pottery Lab that you haven't read yet.\n\nRead and reply: ${originNow()}/chats/dm/${T.id}\n\nYou get at most one of these a day for each conversation. Mute the conversation to stop them.\n`); if (r?.ok) sent++; } }
    return { sent }; }
  if (jobs) { const t = setInterval(() => runDigest().catch((e) => console.warn("[dm] digest", e?.message)), HOUR); t.unref?.(); }

  // ---------- sending ----------
  const hits = new Map(); const over = (k, n, ms) => { const now = Date.now(); let h = hits.get(k); if (!h || now - h.start > ms) { h = { n: 0, start: now }; hits.set(k, h); } if (hits.size > 50000) hits.clear(); return ++h.n > n; };
  const startedToday = (email, kind) => idsOf(email).map(getT).filter((T) => T && lc(T.by) === lc(email) && (T.startedAt || 0) > Date.now() - DAY && (!kind || T.asked)).length;
  /** Put one message in a thread. Returns { ok, message, thread } or { error: { status, code, message } }. */
  function send(from, T, { text = "", photo = null, card = null, replyTo = null, story = false } = {}) { const a = lc(from), b = peerOf(T, a), err = (message, status = 403, code = "not_allowed", more = {}) => ({ error: { status, code, message, ...more } }); settle(T);
    const vs = viewState(T, a), L = dmLimits(); if (vs.state === "closed") return err(WHY[vs.why] || WHY.closed, 403, "closed");
    let asking = false;
    if (vs.state === "new") { const ok = may(a, b, { story }); if (!ok.ok) return err(ok.message, ok.code === "use_booking" ? 409 : 403, ok.code, ok.link ? { link: ok.link } : {});
      if (startedToday(a) >= L.newPerDay) return err("That's a lot of new conversations for one day. Try again tomorrow.", 429, "rate_limited");
      asking = ok.ok === "request"; if (asking && startedToday(a, "asked") >= L.requestsPerDay) return err("You've sent a few requests today. Try again tomorrow.", 429, "rate_limited"); }
    else if (vs.state === "request_out") { if (msgsOf(T.id).some((m) => lc(m.from) === a && !m.removedAt)) return err(`You can send more once ${first(face(b).name) || "this person"} accepts.`, 403, "request_pending"); asking = true; }
    else if (vs.state === "request_in") return err("Accept the request first, then you can reply.", 403, "accept_first");
    if (over("h|" + a, L.perHour, HOUR)) return err("Slow down a little. Try again in a while.", 429, "rate_limited");
    text = clean(text, DM_MAX_TEXT);
    if (asking) { if (photo) return err("You can send photos once they accept.", 403, "request_pending"); if (card && !card.reply) card = null; const p = textProblem(text, { contact: true }); if (p) return err(p.code === "contact_info" ? "Keep phone numbers and emails out of a first message. You can share them once they accept." : p.message, 400, p.code); }
    if (!text && !photo && !card) return err("Say something first.", 400, "invalid");
    if (!asking && !card && text) { const c = cardFromText(text); if (c) card = cardIn(c, a, b); }
    const now = Math.max(Date.now(), (T.lastAt || 0) + 1), id = crypto.randomBytes(8).toString("hex");
    const m = { kind: "dmm", tid: T.id, id, from: a, mkind: photo ? "photo" : "text", text, ...(photo ? { photo } : {}), ...(card ? { card } : {}), ...(replyTo ? { replyTo } : {}), reactions: {}, at: now };
    store.set(mPath(T.id, id), m);
    if (vs.state === "new") { T.by = a; T.startedAt = now; T.state = asking ? "request" : "open"; if (asking) T.asked = true; else T.acceptedAt = now; }
    T.lastAt = now; T.n = (T.n || 0) + 1; T.last = { k: hash(a), text: lineOf(m), at: now };
    const ps = stOf(T, b); setSt(T, b, { unread: (ps.unread || 0) + 1, unreadAt: ps.unread ? ps.unreadAt || now : now }); setSt(T, a, { readAt: now, unread: 0 });
    putT(T); index(a, T.id); index(b, T.id); typing.delete(T.id + "|" + hash(a)); tell(T, a, b, m);
    return { ok: true, message: m, thread: T }; }

  // ---------- story replies, reactions and answers (server/storymake.js calls these) ----------
  /** A reply to a story is the first (or next) message in the DM, quoting the story. false when it can't be a DM. */
  function storyReply(st, u, text) { try { const a = lc(u.email), b = lc(st.author); if (!a || !b || a === b) return false; const had = getT(tidOf(a, b)), ok = !had || had.state === "new" ? may(a, b, { story: true }) : { ok: true }; if (!ok.ok) return { error: { status: 403, code: ok.code, message: ok.message } };
    const T = ensure(a, b), r = send(a, T, { text, card: { type: "story", id: st.id, reply: true }, story: true }); return r.ok ? { id: T.id, request: T.state === "request" } : { error: r.error }; } catch (e) { console.warn("[dm] story reply", e?.message); return false; } }
  /** A reaction or a question answer shows as one small row, only where the two already talk or may without asking. */
  function storyNote(st, u, note) { try { const a = lc(u.email), b = lc(st.author); if (!a || !b || a === b || blockedEither(a, b)) return false; let T = getT(tidOf(a, b));
    if (!T || T.state !== "open") { if (!freeWhy(a, b)) return false; T = ensure(a, b); if (T.state !== "open") { T.state = "open"; T.by = T.by || a; T.acceptedAt = Date.now(); } }
    const mid = mac(`note|${st.id}|${a}|${note.t}|${note.sticker || ""}`, 16), p = mPath(T.id, mid), had = store.get(p)?.data;
    if (note.off) { if (had) store.delete(p); return true; }
    const now = Math.max(Date.now(), (T.lastAt || 0) + 1), m = { kind: "dmm", tid: T.id, id: mid, from: a, mkind: "note", note: { t: note.t, ...(note.emoji ? { emoji: note.emoji } : {}), ...(note.prompt ? { prompt: clean(note.prompt, 80) } : {}), ...(note.text ? { text: clean(note.text, 300) } : {}) }, card: { type: "story", id: st.id }, reactions: {}, at: had?.at || now, text: "" };
    store.set(p, m); if (!had) { T.lastAt = now; T.n = (T.n || 0) + 1; T.last = { k: hash(a), text: lineOf(m), own: noteText(m, true), at: now }; } putT(T); index(a, T.id); index(b, T.id); return true; } catch (e) { console.warn("[dm] story note", e?.message); return false; } }

  // ---------- the list, the counts ----------
  function rows(email) { const em = lc(email), out = [], requests = [];
    for (const tid of idsOf(em)) { const T0 = getT(tid); if (!T0 || !sideOf(T0, em) || !T0.last) continue; const T = settle(T0), st = stOf(T, em), peer = peerOf(T, em), vs = viewState(T, em);
      if ((T.lastAt || 0) <= (st.clearedAt || 0)) continue; if (vs.why === "you_blocked" || vs.state === "new") continue;
      const P = face(peer), mineLast = T.last.k === hash(em), unread = vs.state === "open" || vs.state === "request_in" ? st.unread || 0 : 0;
      const row = { id: "dm/" + T.id, dm: true, title: P.name, ...(P.handle ? { handle: P.handle } : {}), face: { name: P.name, tint: P.tint, ...(P.avatar ? { avatar: P.avatar } : {}) },
        last: { by: mineLast && !T.last.own ? "You" : "", text: vs.state === "request_in" ? String(T.last.text || "").replace(/https?:\/\/\S+/g, "(link)") : mineLast && T.last.own ? T.last.own : T.last.text, at: T.last.at }, at: T.lastAt || 0, unread: st.muted ? 0 : unread, unreadMuted: st.muted ? unread : 0, muted: !!st.muted, state: vs.state, ...(vs.state === "closed" ? { readOnly: true } : {}) };
      (vs.state === "request_in" ? requests : out).push(row); }
    out.sort((x, y) => y.at - x.at); requests.sort((x, y) => y.at - x.at); return { dms: out, requests }; }
  /** Places that keep their own thread, so Chats can point at them: booking requests and team-ups. */
  function links(u) { const out = []; try { const B = store.listPrefix("system", "bbreq-").map((d) => d.data).filter((r) => r?.kind === "bbreq" && !r.demo), mineH = B.filter((r) => r.hostWs === u.ws && r.status !== "approval").length, mineB = B.filter((r) => r.brandWs === u.ws).length;
      if (mineH) out.push({ label: "Booking requests", sub: "Messages with teams stay with each booking", href: "/host/teams", n: mineH });
      if (mineB) out.push({ label: "Team bookings", sub: "Messages with hosts stay with each booking", href: "/teams/bookings", n: mineB });
      const TU = store.listPrefix("system", "teamup-").filter((d) => d.data?.kind === "teamup" && (d.data.fromWs === u.ws || d.data.toWs === u.ws)).length; if (TU) out.push({ label: "Team ups", sub: "Plans with other hosts, each in its own thread", href: "/teamup", n: TU }); } catch {} return out; }
  /** { chats, messages, latest, requests } for the tab badge and the pop-up: requests count on their own, never in the badge. */
  function counts(email) { const R = rows(email); let chats = 0, messages = 0, latest = null;
    for (const r of R.dms) { if (!r.unread) continue; chats++; messages += r.unread; if (!latest || r.last.at > latest.at) latest = { chat: r.id, dm: true, title: "", by: r.title, text: r.last.text === "Sent a photo" ? "" : r.last.text, photo: r.last.text === "Sent a photo", at: r.last.at }; }
    return { chats, messages, latest, requests: R.requests.length }; }

  // ---------- routes ----------
  /** The thread behind a request, for one of its two people; anyone else gets the same 404 as a thread that isn't there. */
  const gate = (req, res) => { const u = me(req, res); if (!u) return null; const T0 = getT(req.params.id); if (!T0 || !sideOf(T0, u.email)) { bad(res, "This conversation isn't here.", 404, "not_found"); return null; } return { u, T: settle(T0), em: lc(u.email) }; };
  const fail = (res, e) => bad(res, e.message, e.status || 400, e.code || "invalid", e.link ? { link: e.link } : {});
  const markRead = (T, em) => { const vs = viewState(T, em); if (vs.state !== "open") return; const st = stOf(T, em); if (!st.unread && (st.readAt || 0) >= (T.lastAt || 0)) return; setSt(T, em, { readAt: Date.now(), unread: 0, unreadAt: 0 }); putT(T); untell(T, em); };

  /** Who a request names: a friend key, a handle, a guest card (event + key), a person id from search, a story's author. */
  function resolve(u, b = {}) { const em = lc(u.email);
    if (typeof b.key === "string" && b.key) { try { const e = lc(Buffer.from(b.key, "base64url").toString()); if (/^[^@\s]+@[^@\s]+$/.test(e)) return e; } catch {} }
    if (b.handle) { const ws = C.wsOfHandle(lc(b.handle).replace(/^@/, "")); if (ws) return ownerOf(ws); }
    if (b.eventId && b.pkey && ID.test(String(b.eventId))) { const I = X.index(), x = I.events.get(String(b.eventId)); if (x && V()?.wasThere?.(I, x.id, em)) { for (const [e, L] of I.att) if (L.some((a) => a.eventId === x.id) && attKey(x.id, e) === String(b.pkey)) return e; } }
    if (b.pid) { const hit = people(u, "", 400).find((p) => p.pid === String(b.pid)); if (hit) return hit._e; }
    if (b.story) { const st = SM()?.get(String(b.story)); if (st && SM().canSee(st, em)) return lc(st.author); }
    return ""; }
  /** People you may message without asking, newest ties first, for "New message". */
  function people(u, q = "", limit = 30) { const em = lc(u.email), I = X.index(), seen = new Map(), add = (e, why) => { e = lc(e); if (!e || e === em || seen.has(e)) return; const ue = getDbUser(e); if (!ue || ue.deleteAt || blockedEither(em, e) || /@demo\.encore$/i.test(e)) return; seen.set(e, why); };
    for (const tid of idsOf(em)) { const T = getT(tid); if (T?.state === "open") add(peerOf(T, em), "You've talked before"); }
    for (const f of X.friendsOf(em)) if (friended(f.email, em)) add(f.email, "Friends");
    try { for (const d of store.listPrefix("system", "friends-")) if (d.data?.kind === "friends" && (d.data.list || []).some((f) => lc(f.email) === em)) add(d.data.email, friended(em, d.data.email) ? "Friends" : "Added you"); } catch {}
    const mine = eventsOf(em, I); for (const [id] of mine) { const x = I.events.get(id); if (!x) continue; const title = clean(x.e.pubTitle || x.e.name, 60) || "an event"; add(x.owner, `Host of ${title}`); for (const [e, L] of I.att) if (L.some((a) => a.eventId === id)) add(e, `Also at ${title}`); if (seen.size > 600) break; }
    const ws = getDbUser(em)?.ws; if (ws && C.profileOf(ws)?.handle && !isBrand(ws)) { try { for (const d of scopeStore(store, ws).list("rsvps")) if (d.data?.email) add(d.data.email, "Replied to your event"); for (const f of C.followersOf(ws)) if (follows(em, f.email)) add(f.email, "You follow each other"); } catch {} }
    try { if (ws) for (const d of store.listPrefix("system", "teamup-")) { const r = d.data; if (r?.kind === "teamup" && r.status === "accepted" && (r.fromWs === ws || r.toWs === ws)) add(ownerOf(r.fromWs === ws ? r.toWs : r.fromWs), "You teamed up"); } } catch {}
    const t = lc(q).replace(/^@/, ""); let out = [...seen].map(([e, why]) => { const F = face(e); return { pid: pidOf(e), name: F.name, ...(F.handle ? { handle: F.handle } : {}), ...(F.avatar ? { avatar: F.avatar } : {}), tint: F.tint, why, _e: e }; });
    if (t) out = out.filter((p) => lc(p.name).includes(t) || lc(p.handle || "").includes(t)); return out.slice(0, limit); }

  app.get("/api/dm/people", (req, res) => { const u = me(req, res); if (!u) return; if (over("pp|" + lc(u.email), 240, HOUR)) return bad(res, "Slow down a little.", 429, "rate_limited");
    res.json({ people: people(u, clean(req.query.q, 40)).map(({ _e, ...p }) => p) }); });
  app.post("/api/dm/open", small, (req, res) => { const u = me(req, res); if (!u) return; if (over("op|" + lc(u.email), 300, HOUR)) return bad(res, "Slow down a little.", 429, "rate_limited");
    const to = resolve(u, req.body || {}); if (!to || !getDbUser(to)) return bad(res, "We couldn't find that person.", 404, "not_found"); const had = getT(tidOf(u.email, to));
    if (!had || had.state === "new") { const ok = may(u.email, to, { story: !!req.body?.story }); if (!ok.ok) return bad(res, ok.message, ok.code === "use_booking" ? 409 : ok.code === "not_found" ? 404 : 403, ok.code, ok.link ? { link: ok.link } : {}); }
    const T = ensure(u.email, to); res.json({ ok: true, id: T.id, url: "/chats/dm/" + T.id, state: viewState(T, u.email).state, name: face(to).name }); });
  app.get("/api/dm/settings", (req, res) => { const u = me(req, res); if (!u) return; const W = whoOf(u.email); res.json({ ...W, options: W.host ? ["everyone", "follow", "none"] : DM_WHO }); });
  app.post("/api/dm/settings", small, (req, res) => { const u = me(req, res); if (!u) return; const w = String(req.body?.who || ""); if (!DM_WHO.includes(w)) return bad(res, "Pick who can message you.");
    store.set(prefPath(u.email), { kind: "dmprefs", email: lc(u.email), who: w, at: Date.now() }); res.json({ ok: true, ...whoOf(u.email) }); });
  app.get("/api/dm", (req, res) => { const u = me(req, res); if (!u) return; res.json({ ...rows(u.email), links: links(u) }); });
  /** Things you can drop into a thread as a card: your events and drops, your page and pages you follow, your live stories. */
  app.get("/api/dm/shareables", (req, res) => { const u = me(req, res); if (!u) return; const em = lc(u.email), I = X.index(), t = new Date(Date.now() - DAY).toISOString().slice(0, 10), q = lc(clean(req.query.q, 40)), out = [];
    for (const [id] of eventsOf(em, I)) { const x = I.events.get(id); if (!x || x.e.example || x.e.cancelled || (x.e.date || "9") < t) continue; const c = cardOut({ type: x.e.drop ? "drop" : "event", id }, em); if (c && !c.gone) out.push({ ...c, id, _d: x.e.date || "9" }); }
    out.sort((a, b) => a._d.localeCompare(b._d)); const pages = [], hs = new Set(); const addH = (h) => { h = lc(h); if (!h || hs.has(h)) return; hs.add(h); const c = cardOut({ type: "host", id: h }, em); if (c && !c.gone) pages.push({ ...c, id: h }); };
    addH(C.profileOf(u.ws)?.handle); for (const [, ws] of eventsOf(em, I)) addH(C.profileOf(ws)?.handle);
    const stories = (SM()?.all() || []).filter((s) => lc(s.author) === em && SM().live(s)).slice(-6).map((s) => ({ ...cardOut({ type: "story", id: s.id }, em), id: s.id }));
    const all = [...out.slice(0, 20).map(({ _d, ...c }) => c), ...pages.slice(0, 12), ...stories].filter((c) => !q || lc(c.title).includes(q)); res.json({ items: all }); });
  /** Send a card to someone straight from a share sheet: { to: { pid | key | handle }, card: { type, id }, text? }. */
  app.post("/api/dm/share", small, (req, res) => { const u = me(req, res); if (!u) return; const to = resolve(u, req.body?.to || {}); if (!to || !getDbUser(to)) return bad(res, "We couldn't find that person.", 404, "not_found");
    const card = cardIn(req.body?.card, u.email, to); if (!card) return bad(res, "That can't be shared with them.", 400, "not_shareable"); const T = settle(ensure(u.email, to));
    if (viewState(T, u.email).state !== "open" && !(viewState(T, u.email).state === "new" && may(u.email, to).ok === "free")) return bad(res, "You can share things once you two are talking. Send a message first.", 403, "request_pending");
    const r = send(u.email, T, { text: clean(req.body?.text, 500), card }); if (r.error) return fail(res, r.error); res.json({ ok: true, id: T.id, url: "/chats/dm/" + T.id, name: face(to).name }); });

  app.get("/api/dm/:id", (req, res) => { const G = gate(req, res); if (!G) return; const { T, em } = G;
    const before = stOf(T, em).readAt || 0; if (req.query.read === "1") markRead(T, em);
    const out = { ...thread(T, em), unreadFrom: before }, v = versionOf(out); if (req.query.v && req.query.v === v) return res.json({ same: true, v, typing: out.typing, seen: out.seen }); res.json({ ...out, v }); });
  app.post("/api/dm/:id/messages", small, (req, res) => { const G = gate(req, res); if (!G) return; const { T, em } = G, b = req.body || {};
    let replyTo = null; const rt = String(b.replyTo || ""); if (MID.test(rt)) { const o = store.get(mPath(T.id, rt))?.data; if (o && !o.removedAt && (o.at || 0) > (stOf(T, em).clearedAt || 0)) replyTo = { id: rt, by: first(face(o.from).name), text: o.mkind === "photo" ? "Photo" : o.mkind === "note" ? noteText(o, lc(o.from) === em) : ((t) => (t.length > 120 ? t.slice(0, 119).trimEnd() + "…" : t))(String(o.text || lineOf(o))) }; } // a cut quote says so; tapping it jumps to the whole message
    let card = null; if (b.card) { card = cardIn(b.card, em, peerOf(T, em)); if (!card) return bad(res, "That can't be shared here.", 400, "not_shareable"); }
    const r = send(em, T, { text: b.text, card, replyTo }); if (r.error) return fail(res, r.error); res.json({ ok: true, message: outMsg(r.message, em, r.thread, viewState(r.thread, em)), state: viewState(r.thread, em).state }); });
  const photoBody = raw || ((req, res, next) => next());
  app.post("/api/dm/:id/photo", photoBody, async (req, res) => { const G = gate(req, res); if (!G) return; const { T, em, u } = G;
    const vs = viewState(T, em); if (vs.state !== "open" && !(vs.state === "new" && may(em, peerOf(T, em)).ok === "free")) return bad(res, vs.state === "closed" ? WHY[vs.why] || WHY.closed : "You can send photos once they accept.", 403, vs.state === "closed" ? "closed" : "request_pending");
    if (over("ph|" + em, dmLimits().photosPerHour, HOUR)) return bad(res, "That's a lot of photos for now. Try again later.", 429, "rate_limited");
    const ct = String(req.get("content-type") || "").split(";")[0].trim().toLowerCase(); if (momentKind(ct) !== "image") return bad(res, "Photos only: JPEG, PNG, WebP or GIF.", 415, "unsupported_type");
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0); if (!body.length) return bad(res, "Empty upload.");
    const max = momentMaxBytes("image"); if (body.length > max) return bad(res, `Photos can be up to ${Math.round((max / 1048576) * 10) / 10} MB.`, 413, "too_large");
    const real = sniffedAs(ct, body); if (!real) return bad(res, "That file isn't a photo we can show. Try a JPEG, PNG, WebP or GIF.", 415, "unsupported_type");
    if (typeof blobs?.save !== "function") return bad(res, "Photos aren't set up here.", 503, "unavailable");
    const meta = await blobs.save(body, real, u.ws, { dm: T.id }), w = Math.floor(+req.query.w || 0), h = Math.floor(+req.query.h || 0);
    const r = send(em, T, { text: clean(req.query.caption, 300), photo: { id: meta.id, ...(w > 0 && h > 0 && w <= 20000 && h <= 20000 ? { w, h } : {}) } });
    if (r.error) { try { await blobs.remove?.([meta.id]); } catch {} return fail(res, r.error); } res.json({ ok: true, message: outMsg(r.message, em, r.thread, viewState(r.thread, em)) }); });
  /** A photo in a thread: its two people, and the team when the thread has an open report. Anyone else: 404. */
  app.get("/api/dm/:id/media/:blob", async (req, res) => { res.set("Cache-Control", "private, no-store"); let u = null; try { u = currentUser(req); } catch {} const T = getT(req.params.id), id = String(req.params.blob || "");
    const mod = !!u && isAdmin(u.email) && !!T && (safety()?.reports?.() || []).some((r) => String(r.target || "").startsWith("dm:" + T.id));
    if (!u || !T || !BLOB.test(id) || !(sideOf(T, u.email) || mod)) return res.status(404).end(); const B = await blobs?.read?.(id); if (!B || B.meta?.dm !== T.id) return res.status(404).end();
    if (!mod) { const vs = viewState(T, u.email), m = msgsOf(T.id).find((x) => x.photo?.id === id); if (!m || m.removedAt || (m.at || 0) <= (stOf(T, u.email).clearedAt || 0) || (vs.state === "request_in" && lc(m.from) !== lc(u.email))) return res.status(404).end(); }
    res.set({ "Content-Type": B.meta.contentType, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cross-Origin-Resource-Policy": "same-origin" }); res.sendFile(B.path, (err) => { if (err && !res.headersSent) res.status(404).end(); }); });
  const withMsg = (req, res, G) => { const id = String(req.body?.id || ""), m = MID.test(id) ? store.get(mPath(G.T.id, id))?.data : null; if (!m || m.removedAt || (m.at || 0) <= (stOf(G.T, G.em).clearedAt || 0)) { bad(res, "No such message.", 404, "not_found"); return null; } return m; };
  app.post("/api/dm/:id/react", small, (req, res) => { const G = gate(req, res); if (!G) return; const { T, em } = G; if (viewState(T, em).state !== "open") return bad(res, "You can react once you two are talking.", 403, "not_open");
    if (over("re|" + em, 240, 60e3 * 10)) return bad(res, "Slow down a little.", 429, "rate_limited"); const e = String(req.body?.emoji || ""); if (!DM_REACTIONS.includes(e)) return bad(res, "Pick one of the reactions.");
    const m = withMsg(req, res, G); if (!m) return; const k = hash(em), R = { ...(m.reactions || {}) }; for (const x of Object.keys(R)) R[x] = (R[x] || []).filter((y) => y !== k); // one reaction per person, like a tapback
    if (req.body?.on !== false) R[e] = [...(R[e] || []), k]; for (const x of Object.keys(R)) if (!R[x].length) delete R[x];
    store.update(mPath(T.id, m.id), { reactions: R }); res.json({ ok: true, message: outMsg({ ...m, reactions: R }, em, T, viewState(T, em)) }); });
  app.post("/api/dm/:id/unsend", small, (req, res) => { const G = gate(req, res); if (!G) return; const { T, em } = G, m = withMsg(req, res, G); if (!m) return; if (lc(m.from) !== em) return bad(res, "You can only unsend your own messages.", 403, "not_yours");
    store.set(mPath(T.id, m.id), { kind: "dmm", tid: T.id, id: m.id, from: m.from, mkind: "text", text: "", reactions: {}, at: m.at, removedAt: Date.now() }); if (m.photo?.id) Promise.resolve(blobs?.remove?.([m.photo.id])).catch(() => {});
    const L = msgsOf(T.id), peer = peerOf(T, em), pr = stOf(T, peer).readAt || 0, last = L[L.length - 1]; if (last) T.last = { k: hash(last.from), text: lineOf(last), at: last.at };
    const un = L.filter((x) => lc(x.from) === em && !x.removedAt && x.mkind !== "note" && x.at > pr).length; setSt(T, peer, { unread: un }); putT(T); if (!un) untell(T, peer); res.json({ ok: true }); });
  app.post("/api/dm/:id/read", small, (req, res) => { const G = gate(req, res); if (!G) return; markRead(G.T, G.em); res.json({ ok: true }); });
  app.post("/api/dm/:id/typing", small, (req, res) => { const G = gate(req, res); if (!G) return; const k = G.T.id + "|" + hash(G.em); if (req.body?.on === false || viewState(G.T, G.em).state !== "open") typing.delete(k); else typing.set(k, Date.now()); if (typing.size > 20000) typing.clear(); res.json({ ok: true }); });
  app.post("/api/dm/:id/mute", small, (req, res) => { const G = gate(req, res); if (!G) return; setSt(G.T, G.em, { muted: req.body?.on !== false }); putT(G.T); res.json({ ok: true, muted: !!stOf(G.T, G.em).muted }); });
  app.post("/api/dm/:id/accept", small, (req, res) => { const G = gate(req, res); if (!G) return; const { T, em } = G; if (viewState(T, em).state !== "request_in") return bad(res, "There's no request to accept here.", 409, "conflict");
    T.state = "open"; T.acceptedAt = Date.now(); setSt(T, em, { readAt: Date.now(), unread: 0, unreadAt: 0 }); putT(T); untell(T, em); res.json({ ok: true, state: "open" }); });
  /** Delete a conversation for yourself: it leaves your list and its earlier messages stay gone for you. A request you delete is declined, quietly. */
  app.post("/api/dm/:id/delete", small, (req, res) => { const G = gate(req, res); if (!G) return; const { T, em } = G; if (viewState(T, em).state === "request_in") T.state = "declined";
    setSt(T, em, { clearedAt: Date.now(), unread: 0, unreadAt: 0 }); putT(T); untell(T, em); res.json({ ok: true }); });
  app.post("/api/dm/:id/block", small, (req, res) => { const G = gate(req, res); if (!G) return; const { T, em, u } = G, peer = peerOf(T, em), S = safety(); if (!S || !peer) return bad(res, "Couldn't block just now.", 503, "unavailable");
    if (req.body?.on === false) { S.unblock(u.email, "person:" + keyOf(peer)); return res.json({ ok: true, blocked: false }); }
    const r = S.block(u.email, { kind: "person", key: keyOf(peer), name: face(peer).name }); if (r.error) return bad(res, r.error); try { X.dropFriend(em, peer); X.dropFriend(peer, em); X.bust?.(); } catch {}
    if (T.state === "request" && lc(T.by) === peer) T.state = "declined"; setSt(T, em, { unread: 0, unreadAt: 0 }); putT(T); untell(T, em); res.json({ ok: true, blocked: true }); });

  // ---------- for the moderation queue (server/safety.js POST /api/report) ----------
  /** What a report on "dm:<tid>[:<mid>]" carries: the last messages as the reporter saw them, who it is about. null unless the reporter is in the thread. */
  function reportContext(email, target) { const m = /^dm:([a-f0-9]{24})(?::([a-f0-9]{16}))?$/.exec(String(target || "")); if (!m) return null; const T = getT(m[1]), em = lc(email); if (!T || !sideOf(T, em)) return null;
    const peer = peerOf(T, em), cleared = stOf(T, em).clearedAt || 0, all = msgsOf(T.id).filter((x) => (x.at || 0) > cleared && !x.removedAt), i = m[2] ? all.findIndex((x) => x.id === m[2]) : all.length - 1; if (m[2] && i < 0) return null;
    const pick = all.slice(Math.max(0, i - 14), i + 6), F = face(peer);
    return { tid: T.id, name: F.name, about: peer ? "person:" + keyOf(peer) : "", text: m[2] ? String(all[i].text || lineOf(all[i])).slice(0, 2000) : "", url: "",
      messages: pick.map((x) => ({ id: x.id, by: lc(x.from) === em ? "Reporter" : F.name, text: String(x.text || "").slice(0, 2000) || lineOf(x), kind: x.mkind, ...(x.photo?.id ? { photo: `/api/dm/${T.id}/media/${x.photo.id}` } : {}), at: x.at, ...(x.id === m[2] ? { reported: true } : {}) })) }; }
  /** The team hides a reported message: it reads "Message removed" for both. */
  function modRemove(target, hidden) { const m = /^dm:([a-f0-9]{24}):([a-f0-9]{16})$/.exec(String(target || "")); if (!m) return false; const p = mPath(m[1], m[2]), d = store.get(p)?.data; if (!d) return false; if (hidden && !d.removedAt) store.update(p, { removedAt: Date.now(), modHidden: true }); else if (!hidden && d.modHidden) store.update(p, { removedAt: null, modHidden: false }); return true; }

  // ---------- account deletion (server/account.js) ----------
  /** Everything a person wrote goes, with its photos; the other side keeps their own messages in a closed thread. Returns blob ids to delete. */
  function forget(email) { const em = lc(email), files = []; let n = 0;
    for (const tid of idsOf(em)) { const T = getT(tid); if (!T || !sideOf(T, em)) continue; for (const m of msgsOf(tid)) if (lc(m.from) === em) { if (m.photo?.id) files.push(m.photo.id); store.delete(mPath(tid, m.id)); n++; }
      const peer = peerOf(T, em), rest = msgsOf(tid), last = rest[rest.length - 1]; if (!rest.length) { store.delete(tPath(tid)); if (peer) { const L = idsOf(peer).filter((x) => x !== tid); store.set(iPath(peer), { kind: "dmidx", email: peer, list: L }); } continue; }
      const { [hash(em)]: gone, ...keep } = T.m || {}; store.set(tPath(tid), { ...T, [lc(T.a) === em ? "a" : "b"]: "", by: lc(T.by) === em ? "" : T.by, m: { ...keep, ...(peer ? { [hash(peer)]: { ...(keep[hash(peer)] || {}), unread: 0 } } : {}) }, last: { k: hash(last.from), text: lineOf(last), at: last.at } }); }
    store.delete(iPath(em)); store.delete(prefPath(em)); return { messages: n, files }; }

  const api = { may, freeWhy, common, whoOf, rows, counts, links, thread, send, ensure, getT, tidOf, storyReply, storyNote, reportContext, modRemove, forget, runDigest, people, resetLimits: () => hits.clear(), msgsOf };
  app.locals.dm = api; X.dm = api;
  return api;
}
