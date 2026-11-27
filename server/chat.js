// Group chats: every event has one. The host and co-hosts are in it; each guest is in it once they're in (I'm in, or
// let in on Ask to join). Built on the event's "chat" collection that the invite's chat card and the host's
// "Message your guests" panel already use (server/social.js), so old messages show here too.
//
// Who can read and write (accessOf):
//   host, co-hosts .................. read and write, pin, remove a guest
//   I'm in (going) .................. read and write
//   Maybe ........................... read only when the host turns it on (ev.chatMaybeRead), else nothing
//   Asked, waitlist ................. nothing yet ("You'll be in the chat once Ada lets you in")
//   Can't go, after being in ........ read only; their messages stay
//   removed by the host ............. nothing; their messages stay
// Guests without an account prove themselves with their reply (rid + code, like every other guest endpoint, or the
// signed reply link from an email). Signed-in people see every chat they're in at /chats.
//
// Privacy: guests see first names and initials (the host's own avatar if they set one), never emails or phones.
// Emails and phone numbers typed by guests are hidden on the way in (the same rule as photo captions); the host's
// aren't (they're the guests' contact already), and the composer warns them that everyone will see it.
// Notifications: one bell item per chat every few hours; a push to the iOS and Android apps (server/push.js) for each new
// message, at most one per chat per PUSH_GAP, never in quiet hours, never while the person has Pottery Lab open (they get
// the in-app pop-up, public/chatnav.js); and at most one email digest per chat per DIGEST_GAP, only for messages still
// unread after DIGEST_DELAY. Muted chats get none of these. GET/POST /api/me/unread is the cheap count every page polls.
import crypto from "node:crypto";
import { scopeStore, getWorkspace, allWorkspaceIds, workspaceOfEvent, DEFAULT_WS, getDbUser } from "./workspaces.js";
import { momentKind, momentMaxBytes, sniffedAs } from "./feedvisual.js";
import { seatsOf } from "./social.js";
import { isQuiet } from "./reminders.js";
import { eventTz } from "./tz.js";
import { typeOf } from "./eventtypes.js"; // the type tag on each chat row

const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, n);
const h24 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 24);
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const MEDIA_OK = (u) => /^\/_blob\/[A-Za-z0-9]{20}$/.test(u || "") || /^\/presets\/[a-z0-9-]{1,60}\.(jpg|webp|png)$/.test(u || "");
const HEX = /^#[0-9a-f]{6}$/i;

export const REACTIONS = ["❤️", "😂", "👍", "😮", "🙌", "🔥"];
export const DIGEST_GAP = 4 * 3600e3; // at most one email per chat per person in this window
export const DIGEST_DELAY = 15 * 60e3; // only for messages still unread this long after they were sent
export const BELL_WINDOW = 3 * 3600e3; // one bell item per chat in this window
export const PUSH_GAP = 120e3; // at most one push per chat per person in this window
export const MSG_PER_MIN = 20, MSG_PER_HOUR = 300, PHOTO_PER_HOUR = 20, MAX_TEXT = 1000;
const EMAIL_IN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, PHONE_IN = /\(?(?:\+?\d[\s().-]*){7,}\d/g;

/** A guest's message with emails and phone numbers taken out (the host's stays as typed). */
export function scrubContact(t) { return String(t || "").replace(EMAIL_IN, "(email hidden)").replace(PHONE_IN, "(number hidden)"); }
/** Whether text holds an email or phone number (for the composer's warning and tests). */
export const hasContact = (t) => { EMAIL_IN.lastIndex = 0; PHONE_IN.lastIndex = 0; const s = String(t || ""); const r = EMAIL_IN.test(s) || PHONE_IN.test(s); EMAIL_IN.lastIndex = 0; PHONE_IN.lastIndex = 0; return r; };

/** What someone can do in an event's chat. role: "host" | "cohost" | "guest" | null; rsvp: their reply; state: their chat member doc. */
export function accessOf({ role, rsvp, ev, state } = {}) {
  if (role === "host" || role === "cohost") return { read: true, write: true, why: role };
  if (!rsvp) return { read: false, write: false, why: "not_member" };
  if (state?.removed) return { read: false, write: false, why: "removed" };
  const r = rsvp.response === "declined" ? "no" : rsvp.response;
  if (r === "going") return { read: true, write: true, why: "in" };
  if (r === "maybe") return ev?.chatMaybeRead ? { read: true, write: false, why: "maybe" } : { read: false, write: false, why: "maybe" };
  if (r === "requested") return { read: false, write: false, why: "asked" };
  if (r === "waitlist") return { read: false, write: false, why: "waitlist" };
  if (r === "no") return state?.joinedAt ? { read: true, write: false, why: "cant_go" } : { read: false, write: false, why: "cant_go" };
  return { read: false, write: false, why: "not_member" };
}
const WHY = (host) => ({ maybe: `The chat is for guests who are in. Tap I'm in to join it.`, asked: `You'll be in the chat once ${host} lets you in.`, waitlist: `You're on the waitlist. If a spot opens, you're in the chat too.`,
  cant_go: `You said Can't go, so you can read the chat but not send.`, removed: `${host} took you out of this chat.`, not_member: `This chat is for the host and guests who are in.` });

/** The day and time the way Pottery Lab writes them: "Sat, Dec 12 · 7pm". */
export function whenLine(ev) { if (ev?.drop && globalThis.PLPickup) return globalThis.PLPickup.line(ev); /* a drop: its pickup windows (public/pickup.js) */ const d = /^\d{4}-\d{2}-\d{2}$/.test(ev?.date || "") ? new Date(ev.date + "T12:00:00Z") : null;
  const day = d ? d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "";
  return [day, clock(ev?.startTime)].filter(Boolean).join(" · "); }
export function clock(t) { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "")); if (!m) return ""; let h = +m[1]; const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return `${h}${m[2] !== "00" ? ":" + m[2] : ""}${ap}`; }

export function mountChat(app, { store, small, currentUser, C, X, mail = null, publicOrigin = () => "", replyToken = null, raw = null, jobs = !process.env.NODE_TEST_CONTEXT }) {
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  // ---- rate limits: per person per chat, in memory ----
  const hits = new Map();
  const over = (k, n, ms) => { const now = Date.now(); let h = hits.get(k); if (!h || now - h.start > ms) { h = { n: 0, start: now }; hits.set(k, h); } if (hits.size > 50000) hits.clear(); return ++h.n > n; };
  const typing = new Map(); // eventId|mk -> { at, name }
  const pushedAt = new Map();
  const seenAt = new Map(), ACTIVE_MS = 100e3; // email -> when a visible tab last checked in (/api/me/unread, an open chat)
  // ---- people ----
  const ownerOf = (ws) => lc(getWorkspace(ws)?.ownerEmail || "");
  const hostName = (ws) => { const p = C?.profileOf?.(ws), o = ownerOf(ws); return first(p?.name || (o ? getDbUser(o)?.name : "") || "") || "Your host"; };
  const hostAvatar = (ws) => { const t = C?.profileOf?.(ws)?.theme || {}; return MEDIA_OK(t.avatarUrl) ? { url: t.avatarUrl } : typeof t.avatarArt === "string" && /^[a-z0-9~-]{1,40}$/i.test(t.avatarArt) ? { art: t.avatarArt } : null; };
  const accentOf = (ws) => { const p = C?.profileOf?.(ws); const a = p?.theme?.accent || p?.color || ""; return HEX.test(a) ? a : ""; };
  const cohostEmails = (ev) => (Array.isArray(ev?.cohosts) ? ev.cohosts : []).map((c) => lc(c?.handle).replace(/^@/, "")).filter((h) => /^[a-z0-9][a-z0-9-]{1,29}$/.test(h)).map((h) => { const w = C?.wsOfHandle?.(h); return w ? ownerOf(w) : ""; }).filter(Boolean);
  const pub = (mk) => h24("who|" + mk).slice(0, 12); // a sender's public id: never their reply id or email
  const memberPath = (eventId, mk) => "chatmembers/" + h24(eventId + "|" + mk);
  const stateOf = (S, eventId, mk) => S.get(memberPath(eventId, mk))?.data || null;
  const setState = (S, eventId, mk, patch) => { const p = memberPath(eventId, mk), cur = S.get(p)?.data || { eventId, mk }; const next = { ...cur, ...patch, eventId, mk }; S.set(p, next); return next; };

  /** Who is asking about this event's chat: the host (signed in to its workspace), a co-host, or a guest by reply. */
  function resolve(req, eventId, q = {}) {
    if (!ID.test(String(eventId || ""))) return null;
    const V = String(eventId).startsWith("club-") ? app.locals.fanclub?.chatEvent?.(eventId) : null; // a fan club's chat has no event behind it (server/fanclub.js)
    const ws = V ? V.ws : workspaceOfEvent(eventId); if (!ws || ws === DEFAULT_WS) return null;
    const S = scopeStore(store, ws), ev = V ? V.ev : S.get("events/" + eventId)?.data; if (!ev || ev.example) return null;
    let u = null; try { u = currentUser(req); } catch {} if (u && (u.ws === DEFAULT_WS || !u.email)) u = null;
    const base = { ws, S, ev, eventId };
    if (u && u.ws === ws) return { ...base, role: "host", mk: "u:" + lc(u.email), name: first(u.name) || hostName(ws), email: lc(u.email), u };
    if (u && cohostEmails(ev).includes(lc(u.email))) return { ...base, role: "cohost", mk: "u:" + lc(u.email), name: first(u.name) || "Co-host", email: lc(u.email), u };
    if (V) return u && app.locals.fanclub.isMember(ws, u.email) ? { ...base, role: "guest", rid: "", r: { response: "going", name: u.name, email: lc(u.email) }, mk: "u:" + lc(u.email), name: first(u.name) || "Member", email: lc(u.email), u } : { ...base, role: null, u };
    let rid = "", r = null; const qr = String(q.rid || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
    if (qr) { const d = S.get("rsvps/" + qr)?.data; if (d && d.eventId === eventId) { const codeOk = q.code && String(d.code || "") === String(q.code);
        let tOk = false; if (!codeOk && q.t && replyToken) { const want = replyToken(ws, qr), got = String(q.t); tOk = want.length === got.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got)); }
        if (codeOk || tOk) { rid = qr; r = d; } } }
    if (!r && u) { const rank = { going: 0, no: 1, declined: 1, maybe: 2, requested: 3, waitlist: 4 };
      const mine = S.list("rsvps").filter((d) => d.data?.eventId === eventId && lc(d.data.email) === lc(u.email)).sort((a, b) => (rank[a.data.response] ?? 9) - (rank[b.data.response] ?? 9))[0];
      if (mine) { rid = mine.id; r = mine.data; } }
    if (!r) return { ...base, role: null, u };
    return { ...base, role: "guest", rid, r, mk: "r:" + rid, name: first(r.name) || "Guest", email: lc(r.email), u };
  }
  const access = (W) => { if (!W) return { read: false, write: false, why: "not_member" }; const st = W.mk ? stateOf(W.S, W.eventId, W.mk) : null; return { ...accessOf({ role: W.role, rsvp: W.r, ev: W.ev, state: st }), state: st }; };

  /** Everyone in an event's chat (first names only), with what they can do. */
  function members(S, ws, eventId, ev) {
    const out = [], seen = new Set(), add = (m) => { if (seen.has(m.mk)) return; seen.add(m.mk); out.push(m); };
    const o = ownerOf(ws); if (o) add({ mk: "u:" + o, name: hostName(ws), role: "host", email: o, avatar: hostAvatar(ws) });
    for (const e of cohostEmails(ev)) add({ mk: "u:" + e, name: first(getDbUser(e)?.name) || "Co-host", role: "cohost", email: e });
    if (ev?.clubChat) for (const m of app.locals.fanclub?.chatMembers?.(ws) || []) { const mk = "u:" + lc(m.email); add({ mk, name: first(m.name) || "Member", role: "guest", email: lc(m.email), write: true, state: stateOf(S, eventId, mk) }); }
    for (const d of S.list("rsvps")) { const r = d.data; if (!r || r.eventId !== eventId) continue; const mk = "r:" + d.id, st = stateOf(S, eventId, mk), a = accessOf({ role: "guest", rsvp: r, ev, state: st });
      if (a.read) add({ mk, name: first(r.name) || "Guest", role: "guest", email: lc(r.email), write: a.write, state: st, rsvp: r }); }
    return out;
  }
  const inCount = (S, eventId, ev) => S.list("rsvps").filter((d) => d.data?.eventId === eventId && d.data.response === "going").reduce((n, d) => n + seatsOf(d.data, ev), 0);
  const tint = (mk) => ["#F6D7A7", "#FBD3CB", "#CDEBD5", "#C4DEFF", "#E2D6F7", "#FCCBA6", "#F2E3B3"][parseInt(h24(mk).slice(0, 4), 16) % 7];

  // ---- messages ----
  const legacyMk = (m, ws) => m.mk || (m.rid ? "r:" + m.rid : m.role === "host" ? "u:" + ownerOf(ws) : "");
  function rawMessages(S, eventId) { return S.list("chat").map((d) => ({ id: d.id, ...d.data })).filter((m) => m.eventId === eventId).sort((a, b) => (a.at || 0) - (b.at || 0)); }
  function visible(m, W, blocked) { const mk = legacyMk(m, W.ws); if (m.private && !(W.role === "host" || W.role === "cohost" || mk === W.mk)) return false; if (m.kind === "poll") return true; if (blocked?.includes(mk) && m.role !== "host") return false; return true; }
  function outMsg(m, W) { const mk = legacyMk(m, W.ws), R = m.reactions || {};
    return { id: m.id, who: m.role === "system" ? "" : pub(mk), by: m.role === "system" ? "" : first(m.by) || "Guest", role: m.role || "guest", kind: m.kind === "photo" ? "photo" : m.role === "system" ? "system" : m.kind === "poll" ? "poll" : "text",
      text: m.removedAt ? "" : String(m.text || ""), ...(m.removedAt ? { removed: true } : {}), ...(m.photo && MEDIA_OK(m.photo.url) && !m.removedAt ? { photo: { url: m.photo.url, ...(m.photo.w && m.photo.h ? { w: m.photo.w, h: m.photo.h } : {}) } } : {}),
      ...(m.replyTo ? { replyTo: { id: m.replyTo.id, by: first(m.replyTo.by), text: String(m.replyTo.text || "").slice(0, 120) } } : {}),
      reactions: Object.fromEntries(Object.entries(R).filter(([e, L]) => REACTIONS.includes(e) && L?.length).map(([e, L]) => [e, { n: L.length, mine: L.includes(W.mk) }])),
      ...(m.role === "system" && m.sys ? { sys: String(m.sys).slice(0, 20) } : {}), ...(m.pinned ? { pinned: true } : {}), ...(m.private ? { private: true } : {}), mine: !!W.mk && mk === W.mk, at: m.at || 0 }; }
  const hostish = (W) => W.role === "host" || W.role === "cohost";

  function thread(W, A, { since = 0 } = {}) {
    const { S, ws, eventId, ev } = W, blocked = A.state?.blocked || [];
    const all = rawMessages(S, eventId).filter((m) => visible(m, W, blocked)), msgs = all.slice(-300).map((m) => outMsg(m, W));
    const M = members(S, ws, eventId, ev), now = Date.now();
    const typingNames = M.filter((m) => m.mk !== W.mk && (typing.get(eventId + "|" + m.mk)?.at || 0) > now - 6000).map((m) => m.name).slice(0, 3);
    // read state: who has read up to my last message
    const myLast = [...msgs].reverse().find((m) => m.mine); let seen = null;
    if (myLast) { const by = M.filter((m) => m.mk !== W.mk && (m.state?.readAt || (m.mk.startsWith("u:") ? stateOf(S, eventId, m.mk)?.readAt : 0) || 0) >= myLast.at).map((m) => m.name); seen = { id: myLast.id, n: by.length, names: by.slice(0, 3) }; }
    const pins = msgs.filter((m) => m.pinned && !m.removed).slice(-3);
    const cover = MEDIA_OK(ev.coverPhoto) ? ev.coverPhoto : "";
    const readAt = A.state?.readAt || 0;
    return { event: { id: eventId, title: ev.pubTitle || ev.name || "Event", date: ev.date || "", startTime: ev.startTime || "", when: whenLine(ev), cover, art: { name: ev.pubTitle || ev.name || "", activity: ev.activity || "", coverArt: ev.coverArt && typeof ev.coverArt === "object" ? { kind: String(ev.coverArt.kind || "").slice(0, 40), tone: String(ev.coverArt.tone || "").slice(0, 20) } : null },
        inCount: inCount(S, eventId, ev), host: hostName(ws), url: ev.clubUrl || `/g#rsvp-${encodeURIComponent(eventId)}`, ...(ev.clubChat ? { club: true } : {}), cancelled: !!ev.cancelled, past: !!ev.date && ev.date < new Date(now - 864e5).toISOString().slice(0, 10), accent: accentOf(ws) },
      me: { who: W.mk ? pub(W.mk) : "", name: W.name || "", role: W.role, canWrite: !!A.write && !ev.cancelled, canPin: hostish(W), readOnly: A.write ? "" : WHY(hostName(ws))[A.why] || "", muted: !!A.state?.muted, ...(hostish(W) ? { maybeRead: !!ev.chatMaybeRead } : {}) },
      members: M.map((m) => ({ who: pub(m.mk), name: m.name, role: m.role, tint: tint(m.mk), ...(m.avatar ? { avatar: m.avatar } : {}), ...(hostish(W) && m.role === "guest" ? { canRemove: true } : {}), ...(m.write === false ? { readOnly: true } : {}) })),
      messages: since ? msgs.filter((m) => m.at > since) : msgs, pins, typing: typingNames, seen, unreadFrom: readAt, reactions: REACTIONS };
  }
  const versionOf = (T) => h24(JSON.stringify([T.messages, T.pins, T.seen, T.me, T.members.length, T.event.title, T.event.when]));

  // ---- posting ----
  function post(W, { text = "", kind = "text", photo = null, replyTo = null, role = null, sys = "", pinned = false, at = Date.now() } = {}) {
    const doc = { eventId: W.eventId, mk: W.mk || "", ...(W.rid ? { rid: W.rid } : {}), by: W.name || "", role: role || W.role || "guest", kind, text, ...(photo ? { photo } : {}), ...(replyTo ? { replyTo } : {}), ...(sys ? { sys } : {}), private: false, pinned: !!pinned, reactions: {}, at };
    const r = W.S.add("chat", doc); return { id: r.id, ...doc };
  }
  /** A line from Pottery Lab in the chat ("Ada let Jo in."). The same kind within two minutes replaces the last one. */
  function system(S, eventId, text, sys = "note") {
    const last = rawMessages(S, eventId).slice(-1)[0];
    if (last && last.role === "system" && last.sys === sys && Date.now() - (last.at || 0) < 120e3 && ["moved", "address"].includes(sys)) { S.update("chat/" + last.id, { text, at: Date.now() }); return; }
    S.add("chat", { eventId, mk: "", by: "", role: "system", kind: "system", sys, text: clean(text, 300), private: false, at: Date.now() });
  }
  // after a message: the bell (one per chat every few hours), and a push when the bridge is there
  function fanOut(W, m) { try {
    const { S, ws, eventId, ev } = W, title = ev.pubTitle || ev.name || "your event", M = members(S, ws, eventId, ev), now = Date.now(), quiet = isQuiet(now, eventTz(ev));
    const line = m.kind === "photo" ? `${m.by} sent a photo` : `${m.by}: ${String(m.text).replace(/\s+/g, " ").slice(0, 90)}`;
    for (const p of M) { if (p.mk === W.mk || !p.email) continue; const st = p.state || stateOf(S, eventId, p.mk); if (st?.muted || st?.removed || st?.blocked?.includes(W.mk)) continue;
      X?.notify?.(p.email, { kind: "chat", key: `chat-${eventId}-${Math.floor(now / BELL_WINDOW)}`, text: `💬 ${title}. ${line}`, link: `/chats/${encodeURIComponent(eventId)}`, eventId });
      // a push to their phone (server/push.js, "Replies and messages" in Settings): not in quiet hours, not while they have
      // Pottery Lab open (they get the in-app pop-up instead), at most one per chat every PUSH_GAP
      const P = app.locals.appstore?.push || app.locals.push, pk = eventId + "|" + p.mk;
      if (typeof P?.send === "function" && !quiet && X?.prefs?.(p.email)?.push !== false && now - (seenAt.get(lc(p.email)) || 0) > ACTIVE_MS && now - (pushedAt.get(pk) || 0) > PUSH_GAP) { pushedAt.set(pk, now); if (pushedAt.size > 50000) pushedAt.clear();
        try { Promise.resolve(P.send(p.email, { title: `${m.by || "Someone"} in ${title}`, body: m.kind === "photo" ? "Sent a photo" : String(m.text).replace(/\s+/g, " ").slice(0, 140), link: `/chats/${encodeURIComponent(eventId)}`, kind: "chat", thread: "chat-" + eventId })).catch(() => {}); } catch {} } }
  } catch (e) { console.warn("[chat] fan out", e?.message); } }

  // ---- routes ----
  const proofOf = (req) => ({ ...(req.query || {}), ...(req.body && typeof req.body === "object" ? req.body : {}) });
  const gate = (req, res, { write = false } = {}) => { const id = String(req.params.eventId || ""); const W = resolve(req, id, proofOf(req)); if (!W) { bad(res, "No such chat.", 404, "not_found"); return null; }
    const A = access(W); if (!A.read || (write && !A.write)) { bad(res, WHY(hostName(W.ws))[A.why] || "This chat is for the host and guests who are in.", 403, A.why === "not_member" ? "not_member" : "not_granted"); return null; }
    if (write && process.env.ENCORE_ALLOW_DEMO_WRITES !== "1" && /@demo\.encore$/i.test(ownerOf(W.ws))) { bad(res, "This is an example host, so nothing is sent.", 403, "example"); return null; }
    if (write && W.ev.cancelled) { bad(res, "This event was cancelled, so the chat is closed.", 403, "closed"); return null; }
    return { W, A }; };
  const markRead = (W, at = Date.now()) => { if (W.mk) setState(W.S, W.eventId, W.mk, { readAt: at, ...(W.role === "guest" && !stateOf(W.S, W.eventId, W.mk)?.joinedAt && W.r?.response === "going" ? { joinedAt: Date.now() } : {}) }); };
  const limitedMsg = (W, res) => { if (over("m1|" + W.eventId + "|" + W.mk, MSG_PER_MIN, 60e3) || over("mh|" + W.eventId + "|" + W.mk, MSG_PER_HOUR, 3600e3)) { bad(res, "Slow down a little. Try again in a minute.", 429, "rate_limited"); return true; } return false; };

  app.get("/api/chats/:eventId", (req, res) => { const G = gate(req, res); if (!G) return; const { W, A } = G; if (W.u) sawYou(req);
    const readBefore = A.state?.readAt || 0; if (req.query.read === "1") { markRead(W); A.state = stateOf(W.S, W.eventId, W.mk); }
    const T = { ...thread(W, A), unreadFrom: readBefore }, v = versionOf(T); res.set("Cache-Control", "private, no-store");
    if (req.query.v && req.query.v === v) return res.json({ same: true, v, typing: T.typing, seen: T.seen });
    // a guest who opened it from an emailed link gets their code, so this browser remembers them
    const extra = W.role === "guest" && req.query.t && W.r?.code ? { proof: { rid: W.rid, code: W.r.code, response: W.r.response, name: W.r.name || "" } } : {};
    res.json({ ...T, v, ...extra }); });

  app.post("/api/chats/:eventId/messages", small, (req, res) => { const G = gate(req, res, { write: true }); if (!G) return; const { W } = G; if (limitedMsg(W, res)) return;
    let text = clean(req.body?.text, MAX_TEXT); if (!text) return bad(res, "Say something first.");
    if (!hostish(W)) text = scrubContact(text);
    let replyTo = null; const rt = String(req.body?.replyTo || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
    if (rt) { const o = W.S.get("chat/" + rt)?.data; if (o && o.eventId === W.eventId && visible({ id: rt, ...o }, W, [])) replyTo = { id: rt, by: first(o.by) || (o.role === "system" ? "Pottery Lab" : "Guest"), text: o.kind === "photo" ? "Photo" : String(o.text || "").slice(0, 120) }; }
    const m = post(W, { text, replyTo }); typing.delete(W.eventId + "|" + W.mk); markRead(W, m.at); fanOut(W, m);
    res.json({ ok: true, message: outMsg(m, W) }); });

  const photoBody = raw || ((req, res, next) => next());
  app.post("/api/chats/:eventId/photo", photoBody, async (req, res) => { const G = gate(req, res, { write: true }); if (!G) return; const { W } = G;
    if (over("ph|" + W.eventId + "|" + W.mk, PHOTO_PER_HOUR, 3600e3)) return bad(res, "That's a lot of photos for now. Try again later.", 429, "rate_limited"); if (limitedMsg(W, res)) return;
    const ct = String(req.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (momentKind(ct) !== "image") return bad(res, "Photos only: JPEG, PNG, WebP or GIF.", 415, "unsupported_type");
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0); if (!body.length) return bad(res, "Empty upload.");
    const max = momentMaxBytes("image"); if (body.length > max) return bad(res, `Photos can be up to ${Math.round((max / 1048576) * 10) / 10} MB.`, 413, "too_large");
    const real = sniffedAs(ct, body); if (!real) return bad(res, "That file isn't a photo we can show. Try a JPEG, PNG, WebP or GIF.", 415, "unsupported_type");
    if (typeof X?.saveBlob !== "function") return bad(res, "Photos aren't set up here.", 503, "unavailable");
    const meta = await X.saveBlob(body, real, W.ws), w = Math.floor(+req.query.w || 0), h = Math.floor(+req.query.h || 0);
    const m = post(W, { kind: "photo", text: hostish(W) ? clean(req.query.caption, 300) : scrubContact(clean(req.query.caption, 300)), photo: { url: meta.url, ...(w > 0 && h > 0 && w <= 20000 && h <= 20000 ? { w, h } : {}) } });
    markRead(W, m.at); fanOut(W, m); res.json({ ok: true, message: outMsg(m, W) }); });

  app.post("/api/chats/:eventId/react", small, (req, res) => { const G = gate(req, res, { write: true }); if (!G) return; const { W } = G;
    if (over("re|" + W.eventId + "|" + W.mk, 120, 60e3)) return bad(res, "Slow down a little.", 429, "rate_limited");
    const e = String(req.body?.emoji || ""), id = String(req.body?.id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40); if (!REACTIONS.includes(e)) return bad(res, "Pick one of the reactions.");
    const p = "chat/" + id, m = W.S.get(p)?.data; if (!m || m.eventId !== W.eventId || !visible({ id, ...m }, W, [])) return bad(res, "No such message.", 404, "not_found");
    const R = { ...(m.reactions || {}) }; for (const k of Object.keys(R)) R[k] = (R[k] || []).filter((x) => x !== W.mk); // one reaction per person, like a tapback
    if (req.body?.on !== false) R[e] = [...(R[e] || []), W.mk]; for (const k of Object.keys(R)) if (!R[k].length) delete R[k];
    W.S.update(p, { reactions: R }); res.json({ ok: true, message: outMsg({ id, ...m, reactions: R }, W) }); });

  app.post("/api/chats/:eventId/read", small, (req, res) => { const G = gate(req, res); if (!G) return; markRead(G.W); res.json({ ok: true }); });
  app.post("/api/chats/:eventId/typing", small, (req, res) => { const G = gate(req, res, { write: true }); if (!G) return; const { W } = G; if (req.body?.on === false) typing.delete(W.eventId + "|" + W.mk); else typing.set(W.eventId + "|" + W.mk, { at: Date.now() }); if (typing.size > 20000) typing.clear(); res.json({ ok: true }); });
  app.post("/api/chats/:eventId/mute", small, (req, res) => { const G = gate(req, res); if (!G) return; const st = setState(G.W.S, G.W.eventId, G.W.mk, { muted: req.body?.on !== false }); res.json({ ok: true, muted: !!st.muted }); });
  app.post("/api/chats/:eventId/pin", small, (req, res) => { const G = gate(req, res, { write: true }); if (!G) return; const { W } = G; if (!hostish(W)) return bad(res, "Only the host can pin.", 403, "host_only");
    const id = String(req.body?.id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40), m = W.S.get("chat/" + id)?.data; if (!m || m.eventId !== W.eventId || m.private) return bad(res, "No such message.", 404, "not_found");
    W.S.update("chat/" + id, { pinned: req.body?.on !== false, pinnedAt: Date.now() }); if (req.body?.on !== false) system(W.S, W.eventId, `${W.name} pinned a message.`, "pin"); res.json({ ok: true }); });
  // the sender takes back their own message (the host can take back any): "Message removed" stays in its place
  app.post("/api/chats/:eventId/unsend", small, (req, res) => { const G = gate(req, res); if (!G) return; const { W } = G;
    const id = String(req.body?.id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40), m = W.S.get("chat/" + id)?.data; if (!m || m.eventId !== W.eventId || m.role === "system") return bad(res, "No such message.", 404, "not_found");
    if (legacyMk(m, W.ws) !== W.mk && !hostish(W)) return bad(res, "You can only remove your own messages.", 403, "not_yours");
    W.S.update("chat/" + id, { removedAt: Date.now(), removedBy: W.mk, pinned: false }); res.json({ ok: true }); });
  // the host takes a guest out of the chat (their messages stay); putting them back is the same call with on:false
  app.post("/api/chats/:eventId/remove", small, (req, res) => { const G = gate(req, res, { write: true }); if (!G) return; const { W } = G; if (!hostish(W)) return bad(res, "Only the host can do that.", 403, "host_only");
    const who = String(req.body?.who || ""), all = W.S.list("rsvps").filter((d) => d.data?.eventId === W.eventId), t = all.find((d) => pub("r:" + d.id) === who); if (!t) return bad(res, "No such guest.", 404, "not_found");
    setState(W.S, W.eventId, "r:" + t.id, { removed: req.body?.on !== false, removedAt: Date.now() }); typing.delete(W.eventId + "|r:" + t.id); res.json({ ok: true }); });
  app.post("/api/chats/:eventId/settings", small, (req, res) => { const G = gate(req, res, { write: true }); if (!G) return; const { W } = G; if (!hostish(W)) return bad(res, "Only the host can do that.", 403, "host_only");
    if (typeof req.body?.maybeRead === "boolean") W.S.update("events/" + W.eventId, { chatMaybeRead: req.body.maybeRead }); res.json({ ok: true, maybeRead: !!W.S.get("events/" + W.eventId)?.data?.chatMaybeRead }); });
  // report a message (the host hears, and the App Store safety hook if it's there); block hides someone's messages for you
  app.post("/api/chats/:eventId/report", small, async (req, res) => { const G = gate(req, res); if (!G) return; const { W } = G; if (over("rp|" + W.mk, 20, 3600e3)) return bad(res, "Thanks. We have your reports.", 429, "rate_limited");
    const id = String(req.body?.id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40), m = W.S.get("chat/" + id)?.data; if (!m || m.eventId !== W.eventId) return bad(res, "No such message.", 404, "not_found");
    const reason = clean(req.body?.reason, 200), rep = { eventId: W.eventId, msgId: id, by: W.mk, about: legacyMk(m, W.ws), reason, text: String(m.text || "").slice(0, 400), at: Date.now() };
    W.S.add("chatreports", rep); const o = ownerOf(W.ws); if (o && legacyMk(m, W.ws) !== "u:" + o) X?.notify?.(o, { kind: "report", text: `Someone reported a message in ${W.ev.pubTitle || W.ev.name || "your chat"}.`, link: `/chats/${encodeURIComponent(W.eventId)}`, eventId: W.eventId });
    try { await app.locals.safety?.report?.({ kind: "chat", ws: W.ws, ...rep }); } catch {}
    if (req.body?.block) { const st = stateOf(W.S, W.eventId, W.mk) || {}; setState(W.S, W.eventId, W.mk, { blocked: [...new Set([...(st.blocked || []), legacyMk(m, W.ws)])].slice(-200) }); }
    res.json({ ok: true }); });
  app.post("/api/chats/:eventId/block", small, (req, res) => { const G = gate(req, res); if (!G) return; const { W } = G;
    const who = String(req.body?.who || ""), M = members(W.S, W.ws, W.eventId, W.ev), t = M.find((m) => pub(m.mk) === who); if (!t || t.mk === W.mk) return bad(res, "No such person.", 404, "not_found"); if (t.role !== "guest") return bad(res, "You can't block the host. Leave the chat or mute it instead.", 400, "host");
    const st = stateOf(W.S, W.eventId, W.mk) || {}, L = new Set(st.blocked || []); if (req.body?.on === false) L.delete(t.mk); else L.add(t.mk); setState(W.S, W.eventId, W.mk, { blocked: [...L].slice(-200) });
    try { app.locals.safety?.block?.({ kind: "chat", ws: W.ws, eventId: W.eventId, by: W.mk, about: t.mk, on: req.body?.on !== false }); } catch {} res.json({ ok: true }); });

  // ---- the inbox: every chat you're in. Signed in: your events and replies; and any reply proofs this browser holds ----
  const userOf = (req) => { let u = null; try { u = currentUser(req); } catch {} return u && u.ws !== DEFAULT_WS && u.email ? u : null; };
  /** Every chat this request could be in: a signed-in person's events, replies, co-hosting and fan clubs, plus the reply proofs this browser holds. */
  function chatIds(u, proofs = []) {
    const ids = new Map(); // eventId -> proof
    if (u) { for (const d of scopeStore(store, u.ws).list("events")) { const e = d.data; if (!e || e.example || e.sample || !(e.published || e.discoverable || e.date)) continue; ids.set(d.id, {}); }
      try { for (const id of app.locals.fanclub?.chatIdsFor?.(u.email) || []) ids.set(id, {}); } catch {} // fan club chats (server/fanclub.js)
      try { const I = X.index(); for (const a of I.att.get(lc(u.email)) || []) ids.set(a.eventId, {}); for (const x of I.events.values()) if (cohostEmails(x.e).includes(lc(u.email))) ids.set(x.id, {});
      } catch {} }
    for (const p of (Array.isArray(proofs) ? proofs : []).slice(0, 60)) { const id = String(p?.eventId || ""); if (ID.test(id) && !ids.get(id)?.rid) ids.set(id, { rid: String(p.rid || ""), code: String(p.code || "") }); }
    return ids;
  }
  const draftNobodySaw = (W) => W.role === "host" && !W.ev.published && !W.ev.discoverable && !W.S.list("rsvps").some((d) => d.data?.eventId === W.eventId);
  function inbox(req, proofs = []) {
    const u = userOf(req), ids = chatIds(u, proofs);
    const out = [], today = new Date().toISOString().slice(0, 10), byWs = new Map();
    for (const [eventId, q] of ids) { const W = resolve(req, eventId, q); if (!W || !W.role) continue; const A = access(W);
      if (!A.read) { if (["asked", "waitlist", "maybe"].includes(A.why) && W.role === "guest") out.push({ id: eventId, title: W.ev.pubTitle || W.ev.name || "Event", date: W.ev.date || "", when: whenLine(W.ev), locked: A.why, lockedLine: WHY(hostName(W.ws))[A.why], art: { name: W.ev.pubTitle || W.ev.name || "", activity: W.ev.activity || "" }, cover: MEDIA_OK(W.ev.coverPhoto) ? W.ev.coverPhoto : "", upcoming: !W.ev.date || W.ev.date >= today, at: W.r?.changedAt || W.r?.createdAt || 0, unread: 0 }); continue; }
      if (draftNobodySaw(W)) continue; // a draft nobody has seen yet has no one to chat with
      if (!byWs.has(W.ws)) byWs.set(W.ws, scopeStore(store, W.ws).list("chat").map((d) => ({ id: d.id, ...d.data })));
      const blocked = A.state?.blocked || [], L = byWs.get(W.ws).filter((m) => m.eventId === eventId && visible(m, W, blocked)).sort((a, b) => (a.at || 0) - (b.at || 0));
      const last = L[L.length - 1], readAt = A.state?.readAt || 0, unread = L.filter((m) => m.at > readAt && legacyMk(m, W.ws) !== W.mk && m.role !== "system" && !m.removedAt).length;
      const M = members(W.S, W.ws, eventId, W.ev);
      out.push({ id: eventId, etype: typeOf(W.ev), title: W.ev.pubTitle || W.ev.name || "Event", date: W.ev.date || "", startTime: W.ev.startTime || "", when: whenLine(W.ev), cover: MEDIA_OK(W.ev.coverPhoto) ? W.ev.coverPhoto : "",
        art: { name: W.ev.pubTitle || W.ev.name || "", activity: W.ev.activity || "", coverArt: W.ev.coverArt && typeof W.ev.coverArt === "object" ? { kind: String(W.ev.coverArt.kind || "").slice(0, 40), tone: String(W.ev.coverArt.tone || "").slice(0, 20) } : null },
        faces: M.filter((m) => m.mk !== W.mk).slice(0, 3).map((m) => ({ name: m.name, tint: tint(m.mk), ...(m.avatar ? { avatar: m.avatar } : {}) })), n: M.length, inCount: inCount(W.S, eventId, W.ev),
        last: last ? { by: last.role === "system" ? "" : legacyMk(last, W.ws) === W.mk ? "You" : first(last.by) || "Guest", text: last.removedAt ? "Message removed" : last.kind === "photo" ? "Sent a photo" : String(last.text || "").replace(/\s+/g, " ").slice(0, 90), at: last.at || 0, system: last.role === "system" } : null,
        at: last?.at || 0, unread: A.state?.muted ? 0 : unread, unreadMuted: A.state?.muted ? unread : 0, muted: !!A.state?.muted, role: W.role, readOnly: !A.write, upcoming: !W.ev.date || W.ev.date >= today, cancelled: !!W.ev.cancelled,
      }); }
    const up = out.filter((c) => c.upcoming).sort((a, b) => (a.date || "9").localeCompare(b.date || "9") || b.at - a.at), past = out.filter((c) => !c.upcoming).sort((a, b) => b.at - a.at || String(b.date).localeCompare(String(a.date)));
    return { chats: [...up, ...past], unread: out.filter((c) => c.unread > 0).length, messages: out.reduce((n, c) => n + (c.unread || 0), 0), signedIn: !!u };
  }
  app.post("/api/chats", small, (req, res) => { res.set("Cache-Control", "private, no-store"); res.json(inbox(req, req.body?.proofs)); });
  app.get("/api/chats", (req, res) => { res.set("Cache-Control", "private, no-store"); res.json(inbox(req, [])); });
  // ---- the counts every page polls (public/chatnav.js): no chat list, no members, no faces ----
  /** { chats, messages, latest } for this request: chats with something new, unread messages, and the newest unread
   * message (for the in-app pop-up). Muted chats count for nothing; the sender's own messages and Pottery Lab's lines never count. */
  function counts(req, proofs = []) {
    const u = userOf(req), ids = chatIds(u, proofs), byWs = new Map(); let chats = 0, messages = 0, latest = null;
    for (const [eventId, q] of ids) { const W = resolve(req, eventId, q); if (!W || !W.role) continue; const A = access(W);
      if (!A.read || A.state?.muted || draftNobodySaw(W)) continue;
      if (!byWs.has(W.ws)) { const M = new Map(); for (const d of scopeStore(store, W.ws).list("chat")) { const m = d.data; if (!m?.eventId || m.role === "system" || m.removedAt) continue; if (!M.has(m.eventId)) M.set(m.eventId, []); M.get(m.eventId).push({ id: d.id, ...m }); } byWs.set(W.ws, M); }
      const readAt = A.state?.readAt || 0, blocked = A.state?.blocked || []; let n = 0;
      for (const m of byWs.get(W.ws).get(eventId) || []) { if ((m.at || 0) <= readAt || legacyMk(m, W.ws) === W.mk || !visible(m, W, blocked)) continue; n++;
        if (!latest || m.at > latest.at) latest = { chat: eventId, title: W.ev.pubTitle || W.ev.name || "Event", by: first(m.by) || "Someone", text: m.kind === "photo" ? "" : String(m.text || "").replace(/\s+/g, " ").slice(0, 140), photo: m.kind === "photo", at: m.at || 0 }; }
      if (n) { chats++; messages += n; } }
    return { chats, messages, latest, signedIn: !!u };
  }
  // someone with a visible tab polls every 45 seconds or so: a chat message that arrives then is a pop-up, not a push
  const sawYou = (req) => { const u = userOf(req); if (u) { seenAt.set(lc(u.email), Date.now()); if (seenAt.size > 50000) seenAt.clear(); } };
  const unreadRoute = (req, res) => { res.set({ "Cache-Control": "private, no-store", Vary: "Cookie" });
    const u = userOf(req), who = u ? "u:" + lc(u.email) : "ip:" + (req.ip || "");
    if (over("ur|" + who, 120, 60e3)) return res.set("Retry-After", "30").status(429).json({ code: "rate_limited", message: "Too many checks. Try again in a moment." });
    const B = counts(req, req.method === "POST" ? req.body?.proofs : []); let inboxN = 0;
    if (u) { sawYou(req); try { inboxN = +app.locals.inbox?.make?.().unread(u) || 0; } catch {} }
    const popups = u ? X?.prefs?.(u.email)?.chatPopups !== false : true;
    res.json({ chats: B.chats, messages: B.messages, inbox: inboxN, popups, ...(popups && B.latest ? { latest: B.latest } : {}) }); };
  app.get("/api/me/unread", unreadRoute);
  app.post("/api/me/unread", small, unreadRoute);
  app.post("/api/chats/badge", small, (req, res) => { const B = counts(req, req.body?.proofs); res.set("Cache-Control", "private, no-store").json({ unread: B.chats, messages: B.messages }); });

  // ---- hooks from replies and event edits (server/app.js) ----
  /** After a reply changes: guests who are in join the chat; the host letting someone in, a friend coming with a friend,
   * the waitlist moving up and a Can't go show as one quiet line. */
  function onRsvp(req, ws, rid, before, after) { try {
    const eventId = String(after?.eventId || before?.eventId || ""); if (!ID.test(eventId)) return; const S = scopeStore(store, ws), ev = S.get("events/" + eventId)?.data; if (!ev || ev.example) return;
    const was = before?.response || "", now = after?.response || "", mk = "r:" + rid, who = first(after?.name || before?.name) || "A guest";
    if (now !== was && (after?.email || before?.email)) { try { X?.bust?.(); } catch {} } // the inbox (X.index) sees the new reply straight away
    if (now === "going" && was !== "going") { setState(S, eventId, mk, { joinedAt: Date.now(), removed: stateOf(S, eventId, mk)?.removed || false });
      let u = null; try { u = currentUser(req); } catch {}
      const friend = after?.withOf ? first(S.get("rsvps/" + String(after.withOf).replace(/[^A-Za-z0-9_-]/g, ""))?.data?.name) : "";
      if (!req.guest && ["requested", "waitlist", "maybe", "declined", "no"].includes(was) && was) system(S, eventId, `${first(u?.name) || hostName(ws)} let ${who} in.`, "letin");
      else if (friend) system(S, eventId, `${who} is coming with ${friend}.`, "with");
      else if (after?.promotedAt && was === "waitlist") system(S, eventId, `A spot opened up. ${who} is in.`, "promoted");
      else system(S, eventId, `${who} is in.`, "joined"); }
    else if (was === "going" && (now === "no" || now === "declined" || !after)) system(S, eventId, `${who} can't go now.`, "left");
  } catch (e) { console.warn("[chat] rsvp", e?.message); } }
  /** After the host edits an event: a new time or day, a new place, a cancellation. */
  function onEventEdit(req, ws, eventId, before, after) { try {
    if (!before || !after || !ID.test(eventId) || after.example || after.sample) return; const S = scopeStore(store, ws); if (!S.list("rsvps").some((d) => d.data?.eventId === eventId && d.data.response === "going")) return;
    let u = null; try { u = currentUser(req); } catch {} const by = first(u?.name) || hostName(ws);
    if (after.cancelled && !before.cancelled) { system(S, eventId, `${by} cancelled the event.`, "cancelled"); return; }
    const dayCh = before.date && after.date && before.date !== after.date, timeCh = before.startTime && after.startTime && before.startTime !== after.startTime;
    if (dayCh) system(S, eventId, `${by} moved it to ${whenLine(after)}.`, "moved"); else if (timeCh) system(S, eventId, `${by} moved it to ${clock(after.startTime)}.`, "moved");
    const addr = (e) => [e.venueAddr, e.meetPoint, e.venueName].map((x) => String(x || "").trim()).join("|");
    if (addr(after) !== addr(before) && String(after.venueAddr || after.meetPoint || "").trim()) system(S, eventId, before.venueAddr || before.meetPoint ? `${by} changed the address. It's on the invite.` : `${by} shared the address with guests. It's on the invite.`, "address");
  } catch (e) { console.warn("[chat] edit", e?.message); } }

  // ---- the email digest: at most one per chat per person every DIGEST_GAP, only for what's still unread ----
  async function runDigest(now = Date.now(), origin = process.env.ENCORE_PUBLIC_URL || "") {
    let sent = 0;
    for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; const S = scopeStore(store, ws), msgs = S.list("chat").map((d) => ({ id: d.id, ...d.data })).filter((m) => (m.at || 0) > now - 2 * 864e5 && m.role !== "system" && !m.private && !m.removedAt);
      const byEv = new Map(); for (const m of msgs) { if (!byEv.has(m.eventId)) byEv.set(m.eventId, []); byEv.get(m.eventId).push(m); }
      for (const [eventId, L] of byEv) { const ev = S.get("events/" + eventId)?.data; if (!ev || ev.example || ev.cancelled) continue; if (isQuiet(now, eventTz(ev))) continue;
        const title = ev.pubTitle || ev.name || "your event";
        for (const p of members(S, ws, eventId, ev)) { if (!p.email || !/@/.test(p.email)) continue; const st = stateOf(S, eventId, p.mk) || {};
          if (st.muted || st.removed) continue; if (X?.canEmail && !X.canEmail(p.email)) continue; if (X?.prefs?.(p.email)?.chatEmails === false) continue;
          if (now - (st.lastEmailAt || 0) < DIGEST_GAP) continue;
          const since = Math.max(st.readAt || 0, st.lastEmailAt || 0), U = L.filter((m) => m.at > since && legacyMk(m, ws) !== p.mk && !(st.blocked || []).includes(legacyMk(m, ws))).sort((a, b) => a.at - b.at);
          if (!U.length || U[0].at > now - DIGEST_DELAY) continue;
          const lines = U.slice(-3).map((m) => `${first(m.by) || "Someone"}: ${m.kind === "photo" ? "sent a photo" : String(m.text || "").replace(/\s+/g, " ").slice(0, 140)}`);
          const link = p.mk.startsWith("r:") && replyToken ? `${origin}/chats/${encodeURIComponent(eventId)}#reply=${encodeURIComponent(p.mk.slice(2))}.${replyToken(ws, p.mk.slice(2))}` : `${origin}/chats/${encodeURIComponent(eventId)}`;
          const n = U.length, text = `Hi ${p.name || "there"},\n\n${n === 1 ? "There's a new message" : `There are ${n} new messages`} in the ${title} group chat.\n\n${lines.join("\n")}${n > 3 ? `\n…and ${n - 3} more.` : ""}\n\nReply in the chat: ${link}\n\nYou get at most one of these every few hours for each chat. Mute the chat to stop them.\n`;
          setState(S, eventId, p.mk, { lastEmailAt: now }); // set first: a slow or failed send never turns into a second email
          try { const r = mail ? await mail(ws, { to: p.email, subject: `${n} new in ${title}`, text, eventId, kind: "chatdigest", list: "guest", origin }) : { ok: false }; if (r?.ok) sent++; } catch {} } } }
    return { sent };
  }
  if (jobs) { const tick = () => runDigest().catch((e) => console.warn("[chat] digest", e?.message)); const t = setInterval(tick, 20 * 60e3); t.unref?.(); }

  const api = { resolve, accessOf, members: (ws, eventId) => { const S = scopeStore(store, ws); return members(S, ws, eventId, S.get("events/" + eventId)?.data || {}); }, onRsvp, onEventEdit, runDigest, system, inbox, REACTIONS, typing };
  app.locals.chat = api;
  return api;
}
