// The Inbox (/inbox): one calm list of everything that happened for you, opened by the bell.
//
// It reads the bell that already exists (server/social.js notify, stored in system/inbox-<hash>), so every sender in the
// app (replies, ask to join, you're in, new events from hosts you follow, members-first openings, chat, kudos,
// reminders, a spot opening up) shows here without changing. Each item is shaped on read: a type and the filters it
// belongs to, an actor with a small avatar (the host's or person's picture; a glyph for notes from Pottery Lab), one
// bold line with the actor and the thing, an optional preview line, a short date and the exact place it opens.
// Similar rows in the same time group fold into one ("Priya, Jun and 10 others replied I'm in to Dumpling Night",
// "New events from Maya's Table and 7 others") with an avatar stack and the rows inside (foldRows). A host's update or
// a recap is a post-style row (style: "post", with a thumbnail when there's a photo). Each row has a gutter glyph.
//
// Routes (signed in, your own items only; nothing takes an email or another person's id):
// - GET  /inbox                      the page (public/inbox.html)
// - GET  /api/inbox?tz=&filter=      { groups: [{ key, label, items }], unread, counts: { all, needs, events, people, chats } }
// - GET  /api/inbox/badge            { unread } for the bell and tab badges (polled lightly by public/potto.js)
// - POST /api/inbox/read             { ids: [...] } or { all: true }; { unread: false, ids } marks unread again
// - POST /api/inbox/archive          { ids: [...] } (swipe to archive on a phone); { undo: true } brings them back
// - POST /api/inbox/mute             { id } mutes the host behind a row (and turns their follow bell off); { undo, handle }
// - POST /api/inbox/kind             { id } or { type } turns a kind off in the Inbox; { type, on: true } turns it back on
//   Both live in system/inboxprefs-<hash> and come back in GET /api/inbox as prefs, so the filter menu can undo them.
// - POST /api/inbox/decide           { id, decision: "in" | "not" }: Let in / Not this time on an ask-to-join, for the
//   host whose event it is. It writes the reply the same way the guest list does and runs the same after-reply steps
//   (the guest hears they're in, the waitlist moves up), through the afterRsvp hook app.js passes in.
//
// Privacy: blocked people and hosts (server/safety.js) drop out of your Inbox, and chat items for a chat you muted
// since. No email, phone or reply id of anyone else is ever in a response; avatars are a picture URL or drawn-art key.
//
// For other features: call notify() below to add an item. It is the one helper to use for new kinds (the invite
// planner's approvals, for example), so the Inbox can show the actor, a preview and the right action:
//
//   import { notify } from "./inbox.js";
//   notify(X, hostEmail, { kind: "ask", key: `rsvp-${rid}-requested`, actor: { name: "Maya Chen", email: guestEmail },
//     title: "Maya asked to join Dumpling Night", preview: "\"I'll bring chili oil\"", link: "/?app=1&open=ev1#studio",
//     eventId: "ev1", needs: { type: "approve", rid } });
//
// `X` is the social layer (app.locals.social). The item still pushes and lands under the bell like any other.
// `actor.email` is stored for blocks and the avatar, and is never sent to a browser. `needs.type: "approve"` with a
// reply id gets inline Let in / Not this time for the event's host.
import crypto from "node:crypto";
import { scopeStore, workspaceOfEvent, getDbUser, DEFAULT_WS } from "./workspaces.js";
import { keyOf } from "./safety.js";
import { tzOk } from "./tz.js";

const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const hash = (s) => crypto.createHash("sha256").update(lc(s)).digest("hex").slice(0, 24); // the same key as server/social.js
const h24 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 24); // server/chat.js member keys
const DAY = 864e5;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const MEDIA_OK = (u) => /^(\/_blob\/[A-Za-z0-9_-]{6,80}|https:\/\/[^\s"<>()]+)$/.test(String(u || ""));
const ART_OK = (a) => typeof a === "string" && /^[a-z0-9~-]{1,40}$/i.test(a);

// ---------- what each bell kind is ----------
// type: what the row is. Filters: needs (something waits on you), events, people, chats.
// glyph: the small line icon in the row's left gutter, so the kind reads at a glance (public/inbox.html draws them)
export const TYPES = {
  reply: { filters: ["people"], glyph: "check", label: "Replies" },
  approval: { filters: ["needs", "people"], glyph: "hand", label: "Ask to join" },
  event: { filters: ["events"], glyph: "bell", label: "New events from hosts you follow" },
  members: { filters: ["events"], glyph: "bell", label: "Fan club openings" },
  post: { filters: ["events"], glyph: "spark", label: "Host updates and recaps" },
  mention: { filters: ["needs", "chats"], glyph: "chat", label: "Mentions" },
  chat: { filters: ["chats"], glyph: "chat", label: "Chat messages" },
  kudos: { filters: ["people"], glyph: "heart", label: "Kudos" },
  reminder: { filters: ["events"], glyph: "clock", label: "Reminders" },
  spot: { filters: ["events"], glyph: "ticket", label: "Spots opening" },
  people: { filters: ["people"], glyph: "person", label: "Follows and friends" },
  note: { filters: [], glyph: "info", label: "Notes from Pottery Lab" },
};
export const FILTERS = [
  { key: "all", label: "All" },
  { key: "needs", label: "Needs you" },
  { key: "events", label: "Events" },
  { key: "people", label: "People" },
  { key: "chats", label: "Chats" },
];
const KIND_TYPE = {
  reply: "reply", ifwith: "reply", ask: "approval", approval: "approval",
  follow: "event", drop: "event", alert: "event", invite: "event", itson: "event", digest: "event",
  "kudos-in": "kudos", vibe: "kudos", tip: "kudos", kudos: "reminder",
  prep: "reminder", after: "reminder", reminded: "reminder", saved: "reminder", sametable: "reminder", reminder: "reminder",
  waitlist: "spot", letin: "spot", release: "spot", spot: "spot", post: "post",
  friend: "people", follower: "people",
  chat: "chat", msg: "chat", mention: "mention", photos: "chat",
  support: "note", report: "note", inquiry: "note", booked: "note", order: "note", help: "note", faq: "note", table: "note",
};
// kinds whose actor is the event's host
const HOST_ACTOR = new Set(["follow", "club", "drop", "invite", "letin", "waitlist", "alert", "itson", "kudos", "sametable", "photos", "release", "spot"]);
// kinds from Pottery Lab itself: a quiet glyph, no face
const SYSTEM = new Set(["prep", "reminded", "saved", "digest", "support", "report", "help", "table", "reminder"]);

/** The type of a stored bell item. A chat line that @-mentions you is a mention; a club item is members-first or a join. */
export function typeOf(n, me = {}) {
  const k = String(n?.kind || "");
  if (n?.type && TYPES[n.type]) return n.type;
  if (k === "club") return /^join-/.test(String(n.key || "")) ? "people" : /^cpost-/.test(String(n.key || "")) ? "post" : "members";
  if (k === "photos" || k === "after" || k === "recap") return "post";
  if (k === "chat" && mentions(n.text, me.name)) return "mention";
  if (k === "ask" && n.needs?.type === "approve") return "approval";
  return KIND_TYPE[k] || "note";
}
/** "@Maya" or "@maya" for the first name of the person reading. */
export function mentions(text, name) { const f = first(name); if (!f || f.length < 2) return false; return new RegExp(`(^|[^\\w])@${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(String(text || "")); }

// leading emoji and symbols the older bell lines start with ("🎉 ", "💬 ")
const stripLead = (t) => String(t || "").replace(/^[\s\p{Extended_Pictographic}\u200d\ufe0f\u2600-\u27bf]+/u, "").trim();
const noDot = (t) => String(t || "").replace(/\.\s*$/, "");

/** One bold line and an optional preview from a stored item. Replies read "Maya replied I'm in to Dumpling Night". */
export function linesOf(n, { title = "", type = "" } = {}) {
  if (n.title) return { line: clean(n.title, 160), preview: clean(n.preview, 200) };
  const t = stripLead(n.text), k = String(n.kind || "");
  let m;
  if (k === "reply" || k === "ifwith") {
    if ((m = /^(.+?) is in for (.+?)\.$/.exec(t))) return { line: `${m[1]} replied I'm in to ${m[2]}`, preview: "", verb: "I'm in", obj: m[2] };
    if ((m = /^(.+?) said Maybe to (.+?)\.$/.exec(t))) return { line: `${m[1]} replied Maybe to ${m[2]}`, preview: "", verb: "Maybe", obj: m[2] };
    if ((m = /^(.+?) can't go to (.+?)( now)?\.\s*(.*)$/.exec(t))) return { line: `${m[1]} replied Can't go to ${m[2]}`, preview: clean(m[4], 200), verb: "Can't go", obj: m[2] };
    if ((m = /^(.+?) ordered (.+) \((.+)\)\.$/.exec(t))) return { line: `${m[1]} replied I'm in to ${m[3]}`, preview: `Ordered ${m[2]}` };
  }
  if (k === "chat" || k === "mention") {
    const rest = title && t.startsWith(title + ". ") ? t.slice(title.length + 2) : (t.split(/\.\s/).slice(1).join(". ") || t);
    const c = /^([^:]{1,40}): (.*)$/.exec(rest), who = c ? c[1] : /^(.{1,40}) sent a photo$/.exec(rest)?.[1] || "";
    const where = title || "your chat";
    if (who) return { line: `${who} ${k === "mention" || type === "mention" ? "mentioned you" : "wrote"} in ${where}`, preview: c ? clean(c[2], 200) : "Sent a photo" };
    return { line: `New in ${where}`, preview: clean(rest, 200) };
  }
  if (k === "msg" && (m = /^(.+?) in (.+?): (.*)$/s.exec(t))) return { line: `${m[1]} messaged you about ${m[2]}`, preview: clean(m[3], 200) };
  if ((k === "kudos-in" || k === "faq") && (m = /^(.+?): "(.+?)"?$/s.exec(t))) return { line: noDot(m[1]), preview: clean(m[2].replace(/"$/, ""), 200) };
  if (["prep", "support", "tip"].includes(k) && (m = /^(.+?): (.+)$/s.exec(t))) return { line: noDot(m[1]), preview: clean(m[2].replace(/^"|"$/g, ""), 200) };
  if (k === "club" && (m = /^(.+?) first: (.+?)\. (.+)$/.exec(t))) return { line: `Your ${m[1]} spots open now`, preview: `${m[2]}. ${m[3]}` };
  // "Kit followed you. They'll hear first about your next event": the first sentence is the line, the rest the preview
  if ((m = /^(.{12,}?[a-z0-9)])\. (\S.*)$/s.exec(t)) && !n.preview) return { line: clean(m[1], 160), preview: clean(noDot(m[2]), 200) };
  return { line: clean(noDot(t), 160), preview: clean(n.preview, 200) };
}
/** The person a line starts with ("Kit followed you", "Lena sent kudos"), or "". */
export function nameAtStart(text) { const t = stripLead(text); const m = /^([A-Z][\p{L}'-]{0,30})(?: [A-Z][\p{L}'-]{0,30})? (?:followed|sent|added|joined|gave|is in|said|can't|asked|wants|moved|ordered|replied|can help)\b/u.exec(t); return m && m[1] !== "Someone" ? m[1] : ""; }

// ---------- time ----------
const dayIn = (t, tz) => new Intl.DateTimeFormat("en-CA", { ...(tz ? { timeZone: tz } : {}), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
const dayNum = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY;
/** today | week | older, on the reader's own calendar. */
export function groupKey(at, now = Date.now(), tz = "") {
  const z = tzOk(tz) ? tz : "", a = dayNum(dayIn(at || 0, z)), b = dayNum(dayIn(now, z));
  if (a >= b) return "today";
  return b - a < 7 ? "week" : "older";
}
export const GROUPS = [{ key: "today", label: "Today" }, { key: "week", label: "This week" }, { key: "older", label: "Older" }];
/** "now", "7m", "2h", "9h" in the last day; "Nov 3" before that. */
export function shortWhen(at, now = Date.now(), tz = "") {
  const z = tzOk(tz) ? tz : "", m = Math.max(0, Math.round((now - at) / 60000));
  if (m < 24 * 60) return m < 1 ? "now" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`;
  return new Intl.DateTimeFormat("en-US", { ...(z ? { timeZone: z } : {}), month: "short", day: "numeric" }).format(new Date(at));
}

/** Items into Today / This week / Older, newest first inside each, empty groups left out. */
export function groupItems(items, now = Date.now(), tz = "") {
  const sorted = [...items].sort((a, b) => (b.at || 0) - (a.at || 0));
  return GROUPS.map((g) => ({ ...g, items: sorted.filter((x) => groupKey(x.at, now, tz) === g.key) })).filter((g) => g.items.length);
}

// ---------- similar rows, collapsed ----------
/** "Priya", "Priya and Jun", "Priya, Jun and Ana", "Priya, Jun and 10 others". */
export function namesLine(names) { const N = [...new Set(names.filter(Boolean))]; if (N.length <= 1) return N[0] || "Someone"; if (N.length === 2) return `${N[0]} and ${N[1]}`; if (N.length === 3) return `${N[0]}, ${N[1]} and ${N[2]}`; return `${N[0]}, ${N[1]} and ${N.length - 2} others`; }
/** Which rows fold together, and how the folded row reads. Approvals and mentions never fold: each one needs you. */
export function clusterOf(x) {
  const c = x._c || {};
  if (x.type === "reply" && c.verb && x.eventId) return { key: `reply|${c.verb}|${x.eventId}`, line: (N) => `${namesLine(N)} replied ${c.verb} to ${c.obj}` };
  if (x.type === "event" && ["follow", "drop", "invite", "alert"].includes(x.kind)) return { key: "event|new", lead: (N) => { const H = [...new Set(N)]; return H.length === 1 ? H[0] : `${H[0]} and ${H.length - 1} ${H.length === 2 ? "other" : "others"}`; }, line: (N) => { const H = [...new Set(N)]; return H.length === 1 ? `${H[0]} posted ${N.length} new events` : `New events from ${H[0]} and ${H.length - 1} ${H.length === 2 ? "other" : "others"}`; } };
  if (x.kind === "follower") return { key: "follower", line: (N) => `${namesLine(N)} followed you` };
  if (x.kind === "friend") return { key: "friend", line: (N) => `${namesLine(N)} added you as a friend` };
  if (x.type === "kudos" && x.kind === "kudos-in" && x.eventId) return { key: `kudos|${x.eventId}`, line: (N) => `${namesLine(N)} sent kudos for ${c.obj || "your event"}` };
  if (x.type === "chat" && x.eventId) return { key: `chat|${x.eventId}`, line: (N) => `${namesLine(N)} wrote in ${c.obj || "your chat"}` };
  return null;
}
/** Fold similar rows in one time group (2 or more) into one row with an avatar stack and the rows inside. */
export function foldRows(items) {
  const out = [], seen = new Map();
  for (const x of items) { const c = clusterOf(x); if (!c) { out.push(x); continue; }
    if (!seen.has(c.key)) { const g = { c, rows: [] }; seen.set(c.key, g); out.push(g); } seen.get(c.key).rows.push(x); }
  return out.map((g) => { if (!g.rows) return g; if (g.rows.length === 1) return g.rows[0]; const R = g.rows, N = R.map((x) => x.actor?.name).filter(Boolean);
    const faces = []; for (const x of R) if (x.actor && !faces.some((f) => f.name === x.actor.name)) faces.push(x.actor); 
    return { id: "g-" + h24(g.c.key + "|" + R.map((x) => x.id).join(",")).slice(0, 12), group: true, kind: R[0].kind, type: R[0].type, glyph: R[0].glyph, filters: R[0].filters, at: R[0].at, read: R.every((x) => x.read), unread: R.filter((x) => !x.read).length,
      count: R.length, faces: faces.slice(0, 3), actor: R[0].actor, line: g.c.line(N), lead: (g.c.lead || namesLine)(N), preview: "", link: R[0].link, ids: R.map((x) => x.id), items: R }; });
}

// ---------- the helper other features call ----------
/**
 * Add an item to someone's Inbox (and bell, push and badge). Returns false when an item with the same key is there.
 * n: { kind, key?, actor?: { name, email?, handle? }, title?, preview?, text?, link, eventId?, needs?: { type, rid } }
 */
export function notify(X, email, n = {}) {
  if (!X?.notify || !email) return false;
  const actor = n.actor ? { name: clean(n.actor.name, 80), ...(n.actor.email ? { email: lc(n.actor.email) } : {}), ...(n.actor.handle ? { handle: lc(n.actor.handle) } : {}) } : undefined;
  const title = clean(n.title, 160), preview = clean(n.preview, 200);
  const item = { kind: clean(n.kind || "note", 30), ...(n.key ? { key: clean(n.key, 120) } : {}), text: clean(n.text || (preview ? `${title}: ${preview}` : title), 300), ...(title ? { title } : {}), ...(preview ? { preview } : {}),
    link: safeLink(n.link) || "/inbox", ...(n.eventId ? { eventId: clean(n.eventId, 80) } : {}), ...(actor ? { actor, ...(actor.email ? { from: actor.email } : {}) } : {}),
    ...(n.type && TYPES[n.type] ? { type: n.type } : {}), ...(n.needs?.type ? { needs: { type: clean(n.needs.type, 20), ...(n.needs.rid ? { rid: clean(n.needs.rid, 80) } : {}) } } : {}) };
  return X.notify(lc(email), item);
}
/** Links stay inside the app: a path, never another site or a script. */
export function safeLink(l) { const s = String(l || "").trim(); return /^\/(?!\/)[^\s<>"'\\]*$/.test(s) ? s.slice(0, 400) : ""; }

// ---------- reading the stored list ----------
const listPath = (email) => "system/inbox-" + hash(email);

/** What a person turned off in their Inbox: { offTypes }. Read by the host's reply summary (server/replydigest.js). */
export const inboxPrefsOf = (store, email) => { const d = store.get("system/inboxprefs-" + hash(email))?.data || {}; return { offTypes: Array.isArray(d.offTypes) ? d.offTypes.filter((t) => TYPES[t]) : [] }; };

export function makeInbox({ store, C, X, safety }) {
  const items = (email) => store.get(listPath(email))?.data?.list || [];
  // what the reader turned off from a row's menu: hosts muted here, and kinds they don't want in the Inbox
  const prefsPath = (email) => "system/inboxprefs-" + hash(email);
  const prefsOf = (email) => { const d = store.get(prefsPath(email))?.data || {}; return { mutedHosts: Array.isArray(d.mutedHosts) ? d.mutedHosts : [], offTypes: Array.isArray(d.offTypes) ? d.offTypes.filter((t) => TYPES[t]) : [] }; };
  const savePrefs = (email, p) => store.set(prefsPath(email), { kind: "inboxprefs", email: lc(email), mutedHosts: p.mutedHosts.slice(0, 200), offTypes: p.offTypes });
  const save = (email, L) => store.set(listPath(email), { kind: "inbox", email: lc(email), list: L });
  const evOf = (eventId) => { if (!ID.test(String(eventId || ""))) return null; const ws = workspaceOfEvent(eventId); if (!ws || ws === DEFAULT_WS) return null; const ev = scopeStore(store, ws).get("events/" + eventId)?.data; return ev ? { ws, ev } : null; };
  const avatarOfWs = (ws) => { const t = C?.profileOf?.(ws)?.theme || {}; return MEDIA_OK(t.avatarUrl) ? { url: t.avatarUrl } : ART_OK(t.avatarArt) ? { art: t.avatarArt } : null; };
  const personOf = (email) => { const u = getDbUser(lc(email)); if (!u) return null; const p = C?.profileOf?.(u.ws); return { name: first(u.name || p?.name), handle: p?.handle || "", avatar: u.ws ? avatarOfWs(u.ws) : null }; };
  const ridOf = (n) => n.needs?.rid || /^(?:rsvp|promo)-([A-Za-z0-9_-]+?)(?:-(?:going|maybe|no|declined|requested|waitlist))?$/.exec(String(n.key || ""))?.[1] || "";

  /** Who the item is from: { name, avatar, glyph, email (server only), handle (server only) }. */
  function actorOf(n, E, type, myWs = "") {
    const k = String(n.kind || "");
    if (n.actor?.name || n.actor?.email) { const p = n.actor.email ? personOf(n.actor.email) : null; return { name: n.actor.name || p?.name || "Someone", avatar: p?.avatar || null, email: n.actor.email || "", handle: n.actor.handle || p?.handle || "" }; }
    if (n.from) { const p = personOf(n.from); return { name: p?.name || "Someone", avatar: p?.avatar || null, email: lc(n.from), handle: p?.handle || "" }; }
    const rid = ridOf(n);
    if (rid && E && (k === "reply" || k === "ask" || k === "approval")) { const r = scopeStore(store, E.ws).get("rsvps/" + rid)?.data; if (r) { const p = r.email ? personOf(r.email) : null; return { name: first(r.name) || "Someone", avatar: p?.avatar || null, email: lc(r.email), handle: p?.handle || "" }; } }
    const ownEv = !!E && !!myWs && E.ws === myWs, said0 = nameAtStart(n.text);
    if (ownEv && said0) { const R = scopeStore(store, E.ws).list("rsvps").map((d) => d.data).filter((r) => r && r.eventId === n.eventId && first(r.name) === said0 && r.email); const ems = [...new Set(R.map((r) => lc(r.email)))]; const em = ems.length === 1 ? ems[0] : ""; return { name: said0, avatar: em ? personOf(em)?.avatar || null : null, email: em, handle: "" }; }
    if (E && !ownEv && (HOST_ACTOR.has(k) || type === "members" || type === "event" || type === "spot")) { const h = C?.profileOf?.(E.ws); if (h?.handle) return { name: h.name || h.handle, avatar: avatarOfWs(E.ws), email: "", handle: h.handle }; }
    const LH = !E && /^\/@([a-z0-9][a-z0-9-]{1,29})\b/.exec(String(n.link || ""))?.[1];
    if (LH && (HOST_ACTOR.has(k) || type === "post" || type === "members")) { const w = C?.wsOfHandle?.(LH), h = w ? C.profileOf(w) : null; if (h?.handle) return { name: h.name || h.handle, avatar: avatarOfWs(w), email: "", handle: h.handle }; }
    if (SYSTEM.has(k) || type === "note" || type === "reminder") return { name: "Pottery Lab", avatar: null, glyph: TYPES[type]?.glyph || "note", email: "", handle: "" };
    const said = nameAtStart(n.text);
    if (said && ["follower", "kudos-in", "tip", "club", "help", "friend", "vibe"].includes(k)) { let av = null, em = "";
      if (E) { const R = scopeStore(store, E.ws).list("rsvps").map((d) => d.data).filter((r) => r && r.eventId === n.eventId && first(r.name) === said && r.email); const ems = [...new Set(R.map((r) => lc(r.email)))]; if (ems.length === 1) { em = ems[0]; av = personOf(em)?.avatar || null; } }
      return { name: said, avatar: av, email: em, handle: "" }; }
    if (k === "chat" || k === "mention" || k === "msg") { const who = /^([^:]{1,40}):/.exec(stripLead(n.text).split(/\.\s/).slice(1).join(". "))?.[1] || /^(\S+) in /.exec(stripLead(n.text))?.[1] || ""; return { name: who || "Someone", avatar: null, email: "", handle: "" }; }
    return { name: "Pottery Lab", avatar: null, glyph: TYPES[type]?.glyph || "note", email: "", handle: "" };
  }
  function blockedSet(email) { const T = new Set(); try { for (const b of safety?.blocksOf?.(email) || []) T.add(b.target); for (const t of safety?.hiddenSet?.() || []) T.add(t); } catch {} return T; }
  function chatMuted(email, E, eventId) { try { return !!scopeStore(store, E.ws).get("chatmembers/" + h24(eventId + "|u:" + lc(email)))?.data?.muted; } catch { return false; } }
  function approvalState(n, E, me) {
    const rid = ridOf(n); if (!rid || !E) return null;
    const own = getDbUser(lc(me.email))?.ws === E.ws; if (!own) return null; // only the event's own host gets the buttons
    const r = scopeStore(store, E.ws).get("rsvps/" + rid)?.data; if (!r || r.eventId !== n.eventId) return { type: "approve", state: "gone" };
    return { type: "approve", state: r.response === "requested" ? "pending" : r.response === "going" ? "in" : ["no", "declined"].includes(r.response) ? "not" : "gone" };
  }

  /** One stored item, shaped for the page. Returns null when it should not show (blocked, muted, archived). */
  function shape(n, me, ctx) {
    if (!n || n.archived && !ctx.withArchived) return null;
    const E = n.eventId ? (ctx.ev.has(n.eventId) ? ctx.ev.get(n.eventId) : (ctx.ev.set(n.eventId, evOf(n.eventId)), ctx.ev.get(n.eventId))) : null;
    const type = typeOf(n, me), A = actorOf(n, E, type, ctx.myWs), T = ctx.blocked;
    if (A.email && T.has("person:" + keyOf(A.email))) return null;
    if (A.handle && T.has("host:" + lc(A.handle))) return null;
    const hostH = E ? C?.profileOf?.(E.ws)?.handle : ""; if (hostH && T.has("host:" + lc(hostH)) && lc(hostH) !== lc(ctx.myHandle)) return null;
    if ((type === "chat" || type === "mention") && E && n.eventId && chatMuted(me.email, E, n.eventId)) return null;
    const hostHandle = lc(A.handle || hostH || ""), P = ctx.prefs;
    if (hostHandle && hostHandle !== lc(ctx.myHandle) && P.mutedHosts.some((m) => m.handle === hostHandle)) return null;
    const title = E ? E.ev.pubTitle || E.ev.name || "" : "";
    let { line, preview, verb, obj } = linesOf(n, { title, type });
    if (/^Someone\b/.test(line) && A.name && A.name !== "Someone" && A.name !== "Pottery Lab") line = line.replace(/^Someone/, A.name);
    let needs = null; if (n.kind === "ask" || n.needs?.type === "approve") needs = approvalState(n, E, me) || null;
    let ty = type; if (ty === "approval" && needs && needs.state !== "pending") ty = "reply"; else if (n.kind === "ask" && needs?.state === "pending") ty = "approval";
    if (ty !== "approval" && P.offTypes.includes(ty)) return null;
    const filters = [...(TYPES[ty]?.filters || [])]; if (n.kind === "faq" || (n.kind === "support" && !n.read)) filters.push("needs");
    // a host's update or a recap reads like a post: "Recent post from Maya's Table", a two-line preview, a thumbnail
    let style = "", thumb = "";
    if (ty === "post") { style = "post"; if (!n.title) { const pm = /^[^:]{1,80}: (.+)$/s.exec(stripLead(n.text)); if (pm) { preview = clean(pm[1], 200); line = `Recent post from ${A.name}`; } }
      const cp = /^cpost-([A-Za-z0-9_-]{1,40})$/.exec(String(n.key || ""))?.[1], w = A.handle ? C?.wsOfHandle?.(A.handle) : null; if (cp && w) { const ph = scopeStore(store, w).get("clubposts/" + cp)?.data?.photo; if (MEDIA_OK(ph)) thumb = ph; } }
    if (!thumb && E && ["event", "members", "post"].includes(ty) && MEDIA_OK(E.ev.coverPhoto)) thumb = E.ev.coverPhoto;
    // the host a row's menu can mute: whoever runs the event or page it's about, never a guest replying to yours
    const evHost = E && E.ws !== ctx.myWs ? C?.profileOf?.(E.ws) : null;
    const host = evHost?.handle ? { handle: lc(evHost.handle), name: evHost.name || evHost.handle } : !E && A.handle && lc(A.handle) !== lc(ctx.myHandle) && ["post", "members", "event"].includes(ty) ? { handle: lc(A.handle), name: A.name } : null;
    return { id: String(n.id), kind: String(n.kind || ""), type: ty, glyph: TYPES[ty]?.glyph || "info", filters, at: +n.at || 0, read: !!n.read, archived: !!n.archived,
      actor: { name: A.name, ...(A.avatar ? { avatar: A.avatar } : {}), ...(A.glyph ? { glyph: A.glyph } : {}) },
      line, preview, link: deepLink(n, ty, E), ...(style ? { style } : {}), ...(thumb ? { thumb } : {}), ...(host ? { host } : {}), ...(needs ? { needs } : {}), ...(n.eventId ? { eventId: String(n.eventId) } : {}),
      _c: { verb, obj: obj || title } };
  }
  /** The exact place a row opens. */
  function deepLink(n, type, E) {
    const own = safeLink(n.link), id = n.eventId && ID.test(n.eventId) ? encodeURIComponent(n.eventId) : "";
    if ((type === "chat" || type === "mention") && id) return own.startsWith("/chats/") ? own : `/chats/${id}`;
    if (type === "approval" && id) return `/?app=1&open=${id}&step=6#studio`;
    if (own && own !== "/inbox") return own;
    if (id && E) return E.ev.discoverable ? `/e/${id}` : `/g#rsvp-${id}`;
    return "/inbox";
  }
  /** Everything for the page: grouped, with counts per filter and the unread count. */
  function build(me, { tz = "", filter = "all", now = Date.now() } = {}) {
    const myWs = getDbUser(lc(me.email))?.ws || "", ctx = { ev: new Map(), blocked: blockedSet(me.email), myWs, myHandle: C?.profileOf?.(myWs)?.handle || "", prefs: prefsOf(me.email) };
    const all = items(me.email).map((n) => shape(n, me, ctx)).filter(Boolean);
    const counts = Object.fromEntries(FILTERS.map((f) => [f.key, f.key === "all" ? all.length : all.filter((x) => x.filters.includes(f.key)).length]));
    counts.needs = all.filter((x) => x.filters.includes("needs") && (x.type !== "approval" || x.needs?.state === "pending")).length;
    const F = FILTERS.some((f) => f.key === filter) ? filter : "all";
    const shown = F === "all" ? all : all.filter((x) => x.filters.includes(F));
    const out = (x) => { const { _c, ...y } = x; y.when = shortWhen(x.at, now, tz); if (y.items) y.items = y.items.map(out); return y; };
    const groups = groupItems(shown, now, tz).map((g) => ({ ...g, items: foldRows(g.items).map(out) }));
    const u = getDbUser(lc(me.email)), av = myWs ? avatarOfWs(myWs) : null;
    return { groups, filter: F, filters: FILTERS, counts, unread: all.filter((x) => !x.read).length, prefs: { mutedHosts: ctx.prefs.mutedHosts, offTypes: ctx.prefs.offTypes.map((t) => ({ type: t, label: TYPES[t]?.label || t })) },
      me: { name: first(u?.name || me.name), ...(av ? { avatar: av } : {}) } };
  }
  function unread(me) { const myWs = getDbUser(lc(me.email))?.ws || "", ctx = { ev: new Map(), blocked: blockedSet(me.email), myWs, myHandle: C?.profileOf?.(myWs)?.handle || "", prefs: prefsOf(me.email) }; return items(me.email).filter((n) => !n.read && !n.archived).map((n) => shape(n, me, ctx)).filter(Boolean).length; }
  function mark(email, ids, patch) { const want = ids === true ? null : new Set((ids || []).map(String)); let n = 0; const L = items(email).map((x) => { if (want && !want.has(String(x.id))) return x; n++; return { ...x, ...patch }; }); if (n) save(email, L); return n; }
  const find = (email, id) => items(email).find((x) => String(x.id) === String(id)) || null;
  /** The host behind one of your items ({ handle, name, ws, type }), for Mute this host and Turn off this kind. */
  function rowInfo(me, id) { const n = find(me.email, id); if (!n) return null; const myWs = getDbUser(lc(me.email))?.ws || "";
    const x = shape(n, me, { ev: new Map(), blocked: new Set(), myWs, myHandle: C?.profileOf?.(myWs)?.handle || "", prefs: { mutedHosts: [], offTypes: [] }, withArchived: true });
    return x ? { type: x.type, host: x.host ? { ...x.host, ws: C?.wsOfHandle?.(x.host.handle) || "" } : null } : null; }
  return { items, build, unread, mark, find, shape, evOf, ridOf, approvalState, prefsOf, savePrefs, rowInfo };
}

// ---------- routes ----------
export function mountInbox(app, { store, small, currentUser, C, X, sendStatic, afterRsvp }) {
  const safety = () => app.locals.appstore?.safety || null;
  const I = () => makeInbox({ store, C, X, safety: safety() });
  const me = (req, res) => { let u = null; try { u = currentUser(req); } catch {} if (!u || !u.email || u.ws === DEFAULT_WS) { res.status(401).json({ code: "unauthenticated", message: "Sign in to see your Inbox." }); return null; } res.set("Cache-Control", "private, no-store"); return u; };
  const ids = (b) => (Array.isArray(b?.ids) ? b.ids : []).map((x) => String(x).replace(/[^a-f0-9]/gi, "").slice(0, 24)).filter(Boolean).slice(0, 200);
  const hits = new Map(); const over = (k, n, ms) => { const t = Date.now(); let h = hits.get(k); if (!h || t - h.at > ms) { h = { at: t, n: 0 }; hits.set(k, h); } if (hits.size > 20000) hits.clear(); return ++h.n > n; };

  app.get("/inbox", (req, res) => sendStatic(res, "inbox.html", "<p>Inbox page missing.</p>"));
  app.get("/api/inbox", (req, res) => { const u = me(req, res); if (!u) return; const tz = String(req.query.tz || "").slice(0, 60);
    res.json(I().build(u, { tz: tzOk(tz) ? tz : "", filter: String(req.query.filter || "all") })); });
  app.get("/api/inbox/badge", (req, res) => { const u = me(req, res); if (!u) return; res.json({ unread: I().unread(u) }); });
  app.post("/api/inbox/read", small, (req, res) => { const u = me(req, res); if (!u) return; const b = req.body || {};
    const n = I().mark(u.email, b.all === true ? true : ids(b), { read: b.unread !== true }); res.json({ ok: true, changed: n, unread: I().unread(u) }); });
  app.post("/api/inbox/archive", small, (req, res) => { const u = me(req, res); if (!u) return; const b = req.body || {};
    const n = I().mark(u.email, ids(b), b.undo === true ? { archived: false } : { archived: true, read: true }); res.json({ ok: true, changed: n, unread: I().unread(u) }); });
  // a row's menu: Mute this host (their rows leave, and the follow bell turns off), Turn off this kind, and undo for both
  app.post("/api/inbox/mute", small, (req, res) => { const u = me(req, res); if (!u) return; const M = I(), b = req.body || {}, p = M.prefsOf(u.email);
    if (b.undo) { const h = lc(b.handle); p.mutedHosts = p.mutedHosts.filter((m) => m.handle !== h); M.savePrefs(u.email, p); return res.json({ ok: true, prefs: p, unread: M.unread(u) }); }
    const info = M.rowInfo(u, String(b.id || "")); if (!info?.host) return res.status(400).json({ code: "invalid", message: "There's no host to mute on that one." });
    if (!p.mutedHosts.some((m) => m.handle === info.host.handle)) p.mutedHosts.unshift({ handle: info.host.handle, name: clean(info.host.name, 80), at: Date.now() }); M.savePrefs(u.email, p);
    let bell = false; try { const F = app.locals.fanclub; if (info.host.ws && F?.followerDoc?.(info.host.ws, lc(u.email))) { F.setFollow(info.host.ws, u.email, { notify: false }); bell = true; } } catch {}
    res.json({ ok: true, muted: { handle: info.host.handle, name: info.host.name }, bellOff: bell, unread: M.unread(u) }); });
  app.post("/api/inbox/kind", small, (req, res) => { const u = me(req, res); if (!u) return; const M = I(), b = req.body || {}, p = M.prefsOf(u.email);
    const type = b.id ? M.rowInfo(u, String(b.id))?.type : String(b.type || ""); if (!TYPES[type] || type === "approval") return res.status(400).json({ code: "invalid", message: "That kind can't be turned off here." });
    p.offTypes = b.on === true ? p.offTypes.filter((t) => t !== type) : [...new Set([...p.offTypes, type])]; M.savePrefs(u.email, p);
    res.json({ ok: true, type, label: TYPES[type].label, on: b.on === true, unread: M.unread(u) }); });
  app.post("/api/inbox/decide", small, async (req, res) => { const u = me(req, res); if (!u) return; const b = req.body || {}, M = I();
    if (over("dec|" + lc(u.email), 120, 3600e3)) return res.status(429).json({ code: "rate_limited", message: "That's a lot at once. Try again in a bit." });
    const n = M.find(u.email, String(b.id || "")); if (!n) return res.status(404).json({ code: "not_found", message: "That isn't in your Inbox." });
    const decision = b.decision === "in" ? "in" : b.decision === "not" ? "not" : ""; if (!decision) return res.status(400).json({ code: "invalid", message: "Let in or Not this time?" });
    const E = M.evOf(n.eventId), st = M.approvalState(n, E, u);
    if (!st) return res.status(403).json({ code: "not_granted", message: "Only the host can do that." });
    if (st.state !== "pending") return res.json({ ok: true, needs: st, already: true });
    const rid = M.ridOf(n), S = scopeStore(store, E.ws), before = S.get("rsvps/" + rid)?.data;
    const patch = decision === "in" ? { response: "going", decidedAt: Date.now(), letInAt: before.letInAt || Date.now() } : { response: "no", decidedAt: Date.now() };
    const after = S.update("rsvps/" + rid, patch).data;
    try { req.guest = false; await afterRsvp?.(req, E.ws, rid, before, after); } catch (e) { console.warn("[inbox] after decide", e?.message); }
    try { X?.bust?.(); } catch {}
    M.mark(u.email, [n.id], { read: true });
    res.json({ ok: true, needs: { type: "approve", state: decision === "in" ? "in" : "not" }, name: first(before.name) || "They", unread: M.unread(u) }); });
  return { make: I };
}
