// ---- reviews ----
// Written reviews, built on kudos (server/social.js): kudos stay the quick tap, a review is the guest's own words. One
// review per person per event, drop or booking, kept in the host's own `reviews` collection next to their kudos.
//
// Rules, in one place:
// - Who may write: someone who went to the event (replied I'm in, was let in, or was checked in, and wasn't marked a
//   no-show), someone whose order from a drop was picked up, or whoever booked an experience with the host once it
//   happened. Signed in, or as a guest with their reply's own id and code (the proof the kudos page uses; the group
//   kudos link's code works too), or the booking page's link for a booking. Never the host or their team on their own
//   things, never on a cancelled event, an example page or a "would you come?" check, and not between two people
//   where either blocked the other.
// - Stars: a 1 to 5 rating is part of a review of something people pay for: a drop, a booked experience, or an event
//   with a price above $0 (the invite's own rule: a price that isn't "free", "$0" or a chip-in). It is required there.
//   Free events, friends' plans and trips take words only; a rating sent for one is ignored. A review keeps what it
//   was written with if the price changes later: a rating stays, an unrated one stays unrated.
// - Words: up to 1,200 characters of their own, at least 20 when there are any. Optional beside a rating, required
//   without one. They go through the same cleaning as kudos: control characters out, links taken out, the strong
//   language filter (server/safety.js textProblem), and emails and phone numbers hidden when shown. Up to 3 photos,
//   which are the guest's own moments from that event (POST /api/moments), so they follow the moment rules.
//   Nothing here writes a review for anyone: the form offers two questions to start from and that is all.
// - Editing: the author can change or delete theirs at any time. The host can't change a word.
// - Who sees one: anyone, for events that aren't private or friends-only. A private or friends-only event's reviews
//   show only to the people who were there (the host and guests who were in), never on a public page, feed or
//   story, and their ratings count toward no public average. Photos follow the moment rules (momentSeen).
// - The host: one short public reply per review, up to 3 pinned to the top of their page, and Hide, which takes a
//   review off every public page. A hidden review stays visible to its author and the host, is put in the team's
//   queue at /moderation, and its rating still counts toward the average. A review the team removed counts nowhere.
// - Averages: "4.8 · 12 reviews" only from 3 rated reviews up, one decimal; below that the reviews show on their own.
// - Reports go through POST /api/report (type "review", the words' hash as the target), like kudos.
//
// Docs: ws/<host>/reviews/<e|b>-<subject id>-<hash of the author>.
import crypto from "node:crypto";
import { scopeStore, getWorkspace, allWorkspaceIds, workspaceOfEvent, membersOf, getDbUser, DEFAULT_WS } from "./workspaces.js";
import { makeSafety, textProblem, textHash, keyOf } from "./safety.js";
import { isAdmin } from "./metrics.js";
import { partnerWsOf } from "./collab.js";
import { kudosVerified, VERIFIED_LABEL } from "./social.js";

export const REVIEW_MIN = 20, REVIEW_MAX = 1200, REPLY_MAX = 400, PIN_MAX = 3, PHOTO_MAX = 3, AVG_MIN = 3, WRITES_PER_HOUR = 20;
export const PROMPTS = ["What was it like?", "What would you tell a friend?"];
const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const sha = (s, n = 16) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, n);
const safeId = (s) => String(s || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);
const closed = (e) => !!e && (e.private === true || e.friendsOnly === true || e.visibility === "private" || e.visibility === "friends");
const isDemo = (ws) => /@demo\.encore$/i.test(getWorkspace(ws)?.ownerEmail || "");
/** Does this event charge guests? The invite's rule (public/invite.html paidOf): a price that isn't free, $0 or a chip-in. */
export const paidEvent = (e) => !!e && e.free !== true && !!e.price && e.price !== "chip" && !/^(free|\$?0+(\.0+)?)$/i.test(String(e.price).trim()) && /[1-9]/.test(String(e.price));
/** A review's words, cleaned the way they are stored: no control characters, links out, tidy spacing. */
export function cleanText(v, n = REVIEW_MAX) {
  return String(v ?? "").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").replace(/<[^>]{0,200}>/g, " ")
    .replace(/\b(?:https?:\/\/|www\.)[^\s]+/gi, " ").replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|app|ly|me|gg|link|shop|xyz)\b(?:\/[^\s]*)?/gi, " ")
    .replace(/[ \t]{2,}/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/ +([.,!?])/g, "$1").trim().slice(0, n).trim();
}
/** Emails and phone numbers hidden, as kudos are shown. */
export const noContact = (t) => String(t || "").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "…").replace(/\(?(?:\+?\d[\s().-]*){7,}\d/g, "…");
/** A short quote from a review: whole sentences that fit, else whole words and an ellipsis. */
export function excerpt(t, n = 220) {
  const s = String(t || "").replace(/\s+/g, " ").trim(); if (s.length <= n) return s;
  const cut = s.slice(0, n + 1), end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (end >= 40) return cut.slice(0, end + 1);
  return cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : n).replace(/[,;:.\s]+$/, "") + "…";
}
/** { avg, n } from 3 rated reviews up, one decimal; else null. */
export function average(L) { const R = L.map((r) => +r.rating).filter((x) => x >= 1 && x <= 5); return R.length >= AVG_MIN ? { avg: Math.round((R.reduce((a, b) => a + b, 0) / R.length) * 10) / 10, n: R.length } : null; }

export function makeReviews(store, { C, X, V = () => null }) {
  const SF = makeSafety(store);
  // every review, read once per change
  let cache = null;
  try { store.events?.on?.("change", (e) => { if (/(^|\/)reviews\/[^/]+$/.test(String(e?.path || ""))) cache = null; }); } catch {}
  function all() { if (cache && Date.now() - cache.at < 15_000) return cache.list; const list = [];
    for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; for (const d of scopeStore(store, ws).list("reviews")) if (d.data && typeof d.data === "object" && d.data.authorKey) list.push({ ...d.data, id: d.id, ws }); }
    cache = { at: Date.now(), list }; return list; }
  const bust = () => { cache = null; SF.bust(); try { X.bust?.(); } catch {} };
  const ownerOf = (ws) => lc(getWorkspace(ws)?.ownerEmail || "");
  const isHostOf = (ws, email, ev = null) => { const em = lc(email); if (!em) return false; if (em === ownerOf(ws)) return true;
    try { if (membersOf(ws).some((m) => lc(m.email) === em)) return true; } catch {}
    try { for (const w of ev ? partnerWsOf(ev, ws) : []) if (lc(getWorkspace(w)?.ownerEmail) === em) return true; } catch {}
    return false; };
  const blocked = (ws, email) => { const em = lc(email), own = ownerOf(ws); if (!em || !own) return false; const h = lc(C.profileOf(ws)?.handle || "");
    return SF.blocksOf(own).some((b) => b.target === "person:" + keyOf(em)) || SF.blocksOf(em).some((b) => b.target === "person:" + keyOf(own) || (h && b.target === "host:" + h)); };
  /** Taken down by the team (a report that was upheld, or three trusted reports): gone everywhere, counts nowhere. */
  const removed = (r) => (!!r.text && SF.isHidden("text:" + textHash(noContact(r.text)))) || (!!r.email && SF.isHidden("person:" + keyOf(r.email))) || (!!r.id && SF.isHidden("other:review-" + r.id));
  const eventOf = (id) => { const ws = workspaceOfEvent(String(id || "")); if (!ws || ws === DEFAULT_WS) return null; const S = scopeStore(store, ws), ev = S.get("events/" + id)?.data; return ev ? { ws, S, ev, id: String(id) } : null; };
  const bookingToken = (id) => crypto.createHmac("sha256", String(process.env.SESSION_SECRET || "encore-bookings")).update("booking:" + id).digest("hex").slice(0, 24); // the booking page's own link (server/market.js)
  const bookingOf = (id) => { if (!id) return null; for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; const S = scopeStore(store, ws), d = S.list("inquiries").find((x) => x.data?.id === id); if (d) return { ws, S, b: d.data }; } return null; };
  const titleOf = (ev) => String(ev?.pubTitle || ev?.name || "").trim().slice(0, 120);
  const hostName = (ws) => { const h = C.profileOf(ws) || {}; return first(getDbUser(ownerOf(ws))?.name) || first(h.name) || ""; };
  const orderDone = (ev, r) => (r.orderLines || []).length > 0 && r.response === "going" && r.orderStatus !== "cancelled" && (r.orderStatus === "picked" || !!r.checkedInAt || (ISO.test(ev.endDate || ev.date || "") && (ev.endDate || ev.date) < today()));
  const went = (ev, r) => r.noShow !== true && (r.response === "going" || !!r.checkedInAt);

  /**
   * Who is asking, for one subject ("event:<id>" or "booking:<id>"): { ok, ws, S, kind, sid, rated, author: { key,
   * email, name, rid }, title, ev|b } or { ok: false, status, code, message }. proof: { rid, code, t }; u: the user.
   */
  function standing(subject, proof = {}, u = null) {
    const m = /^(event|booking):([A-Za-z0-9_-]{2,80})$/.exec(String(subject || "")), no = (message, status = 403, code = "not_granted") => ({ ok: false, status, code, message });
    if (!m) return no("Which event is this about?", 400, "invalid");
    if (m[1] === "booking") { const B = bookingOf(m[2]); if (!B || (B.b.kind && B.b.kind !== "booking")) return no("No such booking.", 404, "not_found"); // experiences only, not gift orders
      const b = B.b, byLink = !!proof.t && String(proof.t) === bookingToken(m[2]), email = byLink ? lc(b.email) : u && lc(u.email) === lc(b.email) ? lc(u.email) : "";
      const base = { ws: B.ws, S: B.S, kind: "booking", sid: m[2], rated: true, b, title: String(b.experience?.name || "").slice(0, 120) || "an experience" };
      if (isDemo(B.ws) || b.demo || b.example) return { ...base, ...no("This is an example page, so it doesn't take reviews.") };
      if (u && (u.ws === B.ws || isHostOf(B.ws, u.email))) return { ...base, ...no("You can't review your own experience.") };
      if (!byLink && !email) return { ...base, ...no(u ? "Only the person who booked this can review it." : "Sign in, or open the link from your booking email.", u ? 403 : 401, u ? "not_granted" : "unauthenticated") };
      const happened = b.status === "done" || (b.status === "booked" && ISO.test(b.date || "") && b.date < today());
      if (!happened) return { ...base, ...no(["declined", "cancelled"].includes(b.status) ? "This booking didn't go ahead, so there's nothing to review." : "Reviews open once it's happened.", 409, "not_yet") };
      if (blocked(B.ws, email)) return { ...base, ...no("You can't review this host.") };
      return { ok: true, ...base, author: { key: email || "bk:" + m[2], email, name: String(b.name || u?.name || "").slice(0, 80), rid: "" } }; }
    const E = eventOf(m[2]); if (!E) return no("No such event.", 404, "not_found");
    const { ws, S, ev } = E, base = { ws, S, kind: ev.drop ? "drop" : "event", sid: m[2], rated: !!ev.drop || paidEvent(ev), ev, title: titleOf(ev) || "the event" };
    if (ev.example || ev.sample || isDemo(ws)) return { ...base, ...no("This is an example page, so it doesn't take reviews.") };
    if (ev.cancelled) return { ...base, ...no("This was cancelled, so there's nothing to review.", 409, "cancelled") };
    if (ev.stage === "interest") return { ...base, ...no("This hasn't happened yet.", 409, "not_yet") };
    if (u && (u.ws === ws || isHostOf(ws, u.email, ev))) return { ...base, ...no(ev.drop ? "You can't review your own drop." : "You can't review your own event.") };
    // the reply behind the proof, or the signed-in person's own reply or guest-list row
    let r = null, rid = "", viaGroup = false, row = null;
    if (proof.rid) { const a = [m[2], safeId(proof.rid), String(proof.code || "").slice(0, 40)], P = X.kudosProof?.(...a) || X.rsvpProof(...a); if (P && P.r) { r = P.r; rid = safeId(P.rid); viaGroup = !!P.viaGroup; } }
    if (!r && u) { const em = lc(u.email), mine = S.list("rsvps").filter((d) => d.data?.eventId === m[2] && lc(d.data.email) === em).sort((a, b) => (went(ev, b.data) - went(ev, a.data)) || (b.data.changedAt || b.data.createdAt || 0) - (a.data.changedAt || a.data.createdAt || 0))[0];
      if (mine) { r = mine.data; rid = mine.id; } else row = (ev.guests || []).find((g) => lc(g.email) === em && /Going|Attended/.test(g.status || "") && !/no.?show/i.test(g.status || "")) || null; }
    if (!r && !row) { const known = !!u || !!proof.rid; return { ...base, ...no(u ? (ev.drop ? "Reviews are for people who ordered." : "Reviews are for guests who went.") : proof.rid ? "This link isn't working. Open the one from your text or email." : "Sign in, or open this from the phone you replied on.", known ? 403 : 401, known ? "not_granted" : "unauthenticated") }; }
    const email = lc(r ? r.email : row.email);
    if (email && isHostOf(ws, email, ev)) return { ...base, ...no(ev.drop ? "You can't review your own drop." : "You can't review your own event.") };
    if (ev.drop) { if (!r || !orderDone(ev, r)) return { ...base, ...no(r && (r.orderLines || []).length && r.response === "going" ? "Reviews open once you've picked up your order." : "Reviews are for people who ordered.", 409, "not_yet") }; }
    else { if (r && !went(ev, r)) return { ...base, ...no(r.response === "requested" ? "Reviews are for guests the host let in." : "Reviews are for guests who went.") };
      if (!ISO.test(ev.date || "") || ev.date > today()) return { ...base, ...no("Reviews open once it's happened.", 409, "not_yet") }; }
    if (blocked(ws, email)) return { ...base, ...no("You can't review this host.") };
    return { ok: true, ...base, author: { key: email || "rid:" + rid, email, name: String((r ? r.name : row.name) || u?.name || "").slice(0, 80), rid, viaGroup } };
  }
  const idFor = (st) => `${st.kind === "booking" ? "b" : "e"}-${safeId(st.sid)}-${sha(st.author.key, 12)}`;
  const mineOf = (st) => (st?.ok ? st.S.get("reviews/" + idFor(st))?.data || null : null);
  /** Does this person's review of this thing carry stars? As it was written, once there is one. */
  const ratedFor = (st, prior = mineOf(st)) => (prior ? !!prior.rating : !!st.rated);

  // ---------- who sees what ----------
  const subjectEvent = (r) => (r.eventId ? eventOf(r.eventId)?.ev || null : null);
  const openTo = (r, ev) => (r.kind === "booking" ? true : !!ev && !closed(ev) && !ev.cancelled && !ev.example);
  /** May this review show on a public page (anyone, signed out)? */
  const isPublic = (r, ev = subjectEvent(r)) => !r.hidden && !removed(r) && openTo(r, ev);
  /** Does its rating count toward a public average? Hidden ones do; private events' and removed ones don't. */
  const counts = (r, ev = subjectEvent(r)) => !!r.rating && !removed(r) && openTo(r, ev);
  /** viewer: { email, host (the workspace they run), keys: Set of author keys they proved, there: (eventId) => bool } */
  function seenBy(r, viewer, ev = subjectEvent(r)) {
    if (viewer.host && viewer.host === r.ws) return true;
    if (viewer.keys?.has(r.authorKey)) return true;
    if (removed(r) || r.hidden) return false;
    if (openTo(r, ev)) return true;
    return r.kind !== "booking" && !!ev && !ev.cancelled && !!viewer.there?.(r.eventId);
  }
  /** One review as pages get it. Never the email, the reply id or the author key. */
  function out(r, viewer = {}, ev = subjectEvent(r)) {
    const mine = !!viewer.keys?.has(r.authorKey), host = !!viewer.host && viewer.host === r.ws, I = X.index(), FV = V();
    const listed = r.kind === "booking" ? true : !!ev && !!ev.discoverable && !ev.cancelled; // an event's name only where the event is on the host's page, as kudos do
    const photos = (r.photos || []).map((u) => I.moments.find((m) => m.ws === r.ws && m.url === u && m.eventId === r.eventId && m.type === "image")).filter((m) => m && (mine || host || FV?.momentSeen?.(I, m, viewer.email || "") || (!m.hidden && !!viewer.there?.(r.eventId)))).slice(0, PHOTO_MAX).map((m) => ({ url: m.url, ...(m.w && m.h ? { w: m.w, h: m.h } : {}) }));
    const month = r.kind === "event" && ev && /^\d{4}-\d{2}/.test(ev.date || "") ? ev.date.slice(0, 7) : new Date(r.at || Date.now()).toISOString().slice(0, 7);
    const h = C.profileOf(r.ws) || {};
    return { id: r.id, review: true, kind: r.kind, name: (!r.deletedAccount && first(r.name)) || "A guest", love: noContact(r.text), ...(r.rating ? { rating: r.rating } : {}), at: r.at, ...(r.editedAt ? { edited: true } : {}),
      event: listed || mine || host ? (r.kind === "booking" ? r.title : titleOf(ev)) || "" : "", what: r.kind === "drop" ? "Ordered" : r.kind === "booking" ? "Booked" : "Came to", month,
      tags: r.tags || [], verified: r.verified || null, verifiedLabel: VERIFIED_LABEL[r.verified] || "", ...(photos.length ? { photos } : {}),
      ...(r.reply?.text ? { reply: { text: noContact(r.reply.text), at: r.reply.at, name: first(h.name) || hostName(r.ws) || "The host" } } : {}),
      ...(r.pinnedAt && !r.hidden ? { pinned: true } : {}), ...(mine ? { mine: true, subject: (r.kind === "booking" ? "booking:" : "event:") + (r.bookingId || r.eventId) } : {}), ...((mine || host) && r.hidden ? { hidden: true } : {}), ...(host ? { own: true } : {}), ...(!openTo(r, ev) ? { private: true } : {}) };
  }
  /** Pinned first (newest pin first), then newest. */
  const pinOf = (r) => (r.pinnedAt && !r.hidden ? r.pinnedAt : 0);
  const order = (a, b) => !!pinOf(b) - !!pinOf(a) || pinOf(b) - pinOf(a) || (b.at || 0) - (a.at || 0);
  const anyone = { email: "", host: "", keys: new Set(), there: () => false };
  /** The viewer of a request: who they are, which replies they proved, where they were. */
  function viewerOf(u, proofs = [], booking = null) {
    const email = u ? lc(u.email) : "", keys = new Set(), thereIds = new Set();
    if (email) keys.add(email);
    for (const p of (Array.isArray(proofs) ? proofs : []).slice(0, 80)) { const id = safeId(p?.id || p?.eventId), rid = safeId(p?.rid); if (!id || !rid) continue;
      const a = [id, rid, String(p.code || "").slice(0, 40)], P = X.kudosProof?.(...a) || X.rsvpProof(...a); if (!P?.r) continue;
      keys.add(lc(P.r.email) || "rid:" + rid); if (went(P.ev || {}, P.r)) thereIds.add(id); }
    if (booking?.t && booking.id) { const B = bookingOf(safeId(booking.id)); if (B && String(booking.t) === bookingToken(safeId(booking.id))) keys.add(lc(B.b.email) || "bk:" + safeId(booking.id)); }
    return { email, host: u && u.ws && u.ws !== DEFAULT_WS ? u.ws : "", keys, there: (id) => thereIds.has(id) || (!!email && !!V()?.wasThere?.(X.index(), id, email)) };
  }
  /** A host's reviews for one viewer, with what the numbers say. scope: { eventId } | { expId } | { bookingId } | {}. */
  function listFor(ws, viewer = anyone, scope = {}) {
    const L = all().filter((r) => r.ws === ws && (!scope.eventId || r.eventId === scope.eventId) && (!scope.expId || r.expId === scope.expId) && (!scope.bookingId || r.bookingId === scope.bookingId));
    const evs = new Map(), evOf = (r) => { if (!r.eventId) return null; if (!evs.has(r.eventId)) evs.set(r.eventId, subjectEvent(r)); return evs.get(r.eventId); };
    const seen = L.filter((r) => seenBy(r, viewer, evOf(r))).sort(order), pub = L.filter((r) => isPublic(r, evOf(r)));
    return { reviews: seen.map((r) => out(r, viewer, evOf(r))), count: pub.length, rating: average(L.filter((r) => counts(r, evOf(r)))) };
  }
  const canPhoto = (st) => st.kind !== "booking" && !!st.author?.rid && !st.ev?.noPhotos && ISO.test(st.ev?.date || "") && st.ev.date <= today();
  /** What the form needs for one subject this person may review. */
  function formOf(st) { const mine = mineOf(st), h = C.profileOf(st.ws) || {}, priv = st.kind !== "booking" && closed(st.ev);
    return { can: true, subject: (st.kind === "booking" ? "booking:" : "event:") + st.sid, kind: st.kind, title: st.title, what: st.kind === "drop" ? "Ordered" : st.kind === "booking" ? "Booked" : "Came to", date: st.ev?.date || st.b?.date || "",
      host: hostName(st.ws) || first(h.name) || "", handle: h.handle || "", private: priv, rated: ratedFor(st, mine), canPhoto: canPhoto(st), prompts: PROMPTS, limits: { min: REVIEW_MIN, max: REVIEW_MAX, photos: PHOTO_MAX }, where: whereLine(st),
      ...(st.author.rid && !st.author.viaGroup ? {} : {}), mine: mine ? { ...(mine.rating ? { rating: mine.rating } : {}), text: mine.text, photos: mine.photos || [], hidden: !!mine.hidden } : null }; }
  const whereLine = (st) => { const h = hostName(st.ws) || "the host"; return st.kind !== "booking" && closed(st.ev) ? `Only ${h} and the guests who were there can see it.` : st.kind === "booking" ? `It shows on ${h}'s page with your first name.` : `It shows on ${h}'s page and on ${st.kind === "drop" ? "the drop's" : "the event's"} page, with your first name.`; };
  /** What this person could review with this host, the ones without a review first: the form's data for each. */
  function writable(ws, u, proofs = []) {
    const outL = [], seen = new Set(), add = (subject, proof) => { if (seen.has(subject)) return; const st = standing(subject, proof, u); if (!st.ok || st.ws !== ws) return; seen.add(subject);
      outL.push({ ...formOf(st), ...(proof.rid ? { rid: proof.rid, code: proof.code } : {}) }); };
    for (const p of (Array.isArray(proofs) ? proofs : []).slice(0, 80)) { const id = safeId(p?.id || p?.eventId); if (id && workspaceOfEvent(id) === ws) add("event:" + id, { rid: safeId(p.rid), code: String(p.code || "").slice(0, 40) }); }
    if (u && u.email) { const em = lc(u.email), S = scopeStore(store, ws);
      for (const d of S.list("rsvps")) if (lc(d.data?.email) === em && d.data.eventId) add("event:" + d.data.eventId, {});
      for (const d of S.list("events")) if ((d.data?.guests || []).some((g) => lc(g.email) === em)) add("event:" + d.id, {});
      for (const d of S.list("inquiries")) if (lc(d.data?.email) === em && d.data.id) add("booking:" + d.data.id, {}); }
    return outL.sort((a, b) => !!a.mine - !!b.mine || String(b.date).localeCompare(String(a.date))).slice(0, 20);
  }

  // ---------- writing ----------
  function save(st, { rating, text, photos }) {
    const id = idFor(st), prior = st.S.get("reviews/" + id)?.data || null, rated = ratedFor(st, prior), A = st.author;
    let n = 0; if (rated) { n = +rating; if (!Number.isInteger(n) || n < 1 || n > 5 || rating === "" || rating == null || typeof rating === "boolean") return { error: "Pick a rating, 1 to 5 stars.", code: "rating" }; }
    if (String(text ?? "").replace(/\s+/g, " ").trim().length > REVIEW_MAX + 50) return { error: `Reviews can be up to ${REVIEW_MAX.toLocaleString("en-US")} characters.`, code: "too_long" };
    const words = cleanText(text);
    if (!words && !rated) return { error: "Write a few words first.", code: "too_short" };
    if (words && words.length < REVIEW_MIN) return { error: rated ? `Say a little more (at least ${REVIEW_MIN} characters), or leave the words out.` : `Say a little more (at least ${REVIEW_MIN} characters).`, code: "too_short" };
    const p = textProblem(words, { contact: true }); if (p) return { error: p.code === "contact_info" ? "Keep phone numbers and emails out of reviews." : p.message, code: p.code };
    let ph = []; if (st.kind !== "booking") { const M = st.S.list("moments").map((d) => d.data).filter((m) => m && m.eventId === st.sid && m.type === "image" && !m.hidden && ((A.email && lc(m.authorEmail) === A.email) || (A.rid && m.authorKey === "rid:" + A.rid)));
      ph = [...new Set((Array.isArray(photos) ? photos : []).map(String))].filter((u) => M.some((m) => m.url === u)).slice(0, PHOTO_MAX); }
    const K = A.rid ? st.S.get("kudos/" + A.rid)?.data : null, now = Date.now();
    let verified = null; try { verified = st.kind === "booking" ? null : kudosVerified(st.S, { eventId: st.sid, rid: A.rid, viaGroup: !!A.viaGroup, email: A.email, name: A.name }); } catch {}
    const { rating: _old, ...keep } = prior || {};
    const doc = { ...keep, kind: st.kind, ...(st.kind === "booking" ? { bookingId: st.sid, expId: String(st.b.experience?.id || ""), title: st.title } : { eventId: st.sid }), authorKey: A.key, rid: A.rid || "", email: A.email || "", name: A.name || prior?.name || "",
      ...(rated ? { rating: n } : {}), text: words, photos: ph, tags: (K?.tags || []).slice(0, 8), verified, at: prior?.at || now, ...(prior ? { editedAt: now } : {}) };
    st.S.set("reviews/" + id, doc);
    if (K && !K.reviewed) { try { st.S.update("kudos/" + A.rid, { reviewed: true }); } catch {} }
    bust();
    if (!prior) { const h = C.profileOf(st.ws), who = first(A.name) || "A guest";
      try { X.notify(ownerOf(st.ws), { kind: "review-in", key: "review-" + id, text: `${who} wrote a review of ${st.title}${rated ? `: ${n} ${n === 1 ? "star" : "stars"}` : ""}${words ? `${rated ? "." : ":"} "${excerpt(noContact(words), 80)}"` : ""}`, link: h?.handle ? `/@${h.handle}#kudos` : "/feed", ...(st.kind === "booking" ? {} : { eventId: st.sid }) }); } catch {} }
    return { ok: true, id, created: !prior, doc: { ...doc, id, ws: st.ws } };
  }
  function remove(st) { const id = idFor(st), prior = st.S.get("reviews/" + id)?.data; if (!prior) return false; st.S.delete("reviews/" + id);
    if (st.author.rid && st.S.get("kudos/" + st.author.rid)?.data?.reviewed) { try { st.S.update("kudos/" + st.author.rid, { reviewed: false }); } catch {} }
    closeFlag(id); bust(); return true; }
  // ---------- the host's three controls ----------
  const flagId = (id) => "rvh" + sha("review-hide:" + id, 14);
  function closeFlag(id) { const p = "system/report-" + flagId(id), d = store.get(p)?.data; if (d && d.status === "open") store.set(p, { ...d, status: "dismissed", resolvedAt: Date.now() }); }
  function hostAct(ws, id, by, b = {}) {
    const rid2 = safeId(id), S = scopeStore(store, ws), p = "reviews/" + rid2, r = S.get(p)?.data; if (!r || !rid2) return { error: "No such review.", status: 404, code: "not_found" };
    if (typeof b.reply === "string") { if (String(b.reply).trim().length > REPLY_MAX) return { error: `Replies can be up to ${REPLY_MAX} characters.`, code: "too_long" }; const t = cleanText(b.reply, REPLY_MAX);
      if (!t) { const { reply, ...rest } = r; S.set(p, rest); bust(); return { ok: true }; }
      if (t.length < 2) return { error: "Say a little more." }; const tp = textProblem(t, { contact: true }); if (tp) return { error: tp.code === "contact_info" ? "Keep phone numbers and emails out of public replies." : tp.message, code: tp.code };
      S.set(p, { ...r, reply: { text: t, at: r.reply?.at || Date.now(), ...(r.reply ? { editedAt: Date.now() } : {}) } }); bust(); return { ok: true }; }
    if (typeof b.pin === "boolean") { if (b.pin) { if (r.hidden) return { error: "Show this review on your page first, then pin it.", status: 409, code: "conflict" };
        const n = S.list("reviews").filter((d) => d.data?.pinnedAt && !d.data.hidden && d.id !== rid2).length; if (n >= PIN_MAX) return { error: `You can pin up to ${PIN_MAX}. Unpin one first.`, status: 409, code: "pin_limit" };
        S.set(p, { ...r, pinnedAt: Date.now() }); } else { const { pinnedAt, ...rest } = r; S.set(p, rest); }
      bust(); return { ok: true }; }
    if (typeof b.hide === "boolean") {
      if (b.hide) { const { pinnedAt, ...rest } = r; S.set(p, { ...rest, hidden: true, hiddenAt: Date.now() });
        // marked for the team: one line in the queue at /moderation, so a fair review isn't quietly buried
        const h = C.profileOf(ws)?.handle; store.set("system/report-" + flagId(rid2), { kind: "report", id: flagId(rid2), type: "review", target: "other:review-" + rid2, reason: "other", note: `The host hid this review from their page${r.rating ? ` (${r.rating} of 5 stars)` : ""}.`, text: noContact(r.text).slice(0, 2000), name: first(r.name), url: h ? `/@${h}` : "", from: lc(by), who: "host:" + sha(ws), at: Date.now(), status: "open", hostHide: true, trusted: false });
      } else { const { hidden, hiddenAt, ...rest } = r; S.set(p, rest); closeFlag(rid2); }
      bust(); return { ok: true }; }
    return { error: "Nothing to change.", status: 400 };
  }

  // ---------- into the pages that already show kudos ----------
  /** hostStrengths with reviews: what anyone may see, the count and the average. */
  function intoStrengths(ws, S0) { if (!S0 || typeof S0 !== "object") return S0; let L; try { L = listFor(ws, anyone); } catch { return S0; }
    return { ...S0, reviews: L.reviews.slice(0, 30), reviewCount: L.count, rating: L.rating }; }
  /** The quote on a past event's card and recap story: a review with words, the best rated and longest first. */
  function quoteFor(x, email = "") { try { const em = lc(email), viewer = { ...anyone, email: em, keys: new Set(), there: (id) => !!em && !!V()?.wasThere?.(X.index(), id, em) };
      const L = all().filter((r) => r.ws === x.ws && r.eventId === x.id && r.text && (!r.rating || r.rating >= 4) && !r.hidden && seenBy(r, viewer, x.e)).sort((a, b) => (b.rating || 4) - (a.rating || 4) || b.text.length - a.text.length);
      const r = L[0]; return r ? { text: excerpt(noContact(r.text), 220), name: first(r.name) || "A guest", verifiedLabel: VERIFIED_LABEL[r.verified] || "", ...(r.rating ? { rating: r.rating } : {}), review: true } : null; } catch { return null; } }
  const summaryOf = (ws, scope = {}) => { try { const L = listFor(ws, anyone, scope); return { count: L.count, rating: L.rating }; } catch { return { count: 0, rating: null }; } };
  return { all, standing, mineOf, idFor, formOf, save, remove, hostAct, listFor, writable, viewerOf, out, intoStrengths, quoteFor, summaryOf, isPublic, counts, removed, canPhoto, bookingToken, hostName, bust, anyone, eventOf, bookingOf, whereLine };
}

export function mountReviews(app, { store, small, currentUser, C, X }) {
  const R = makeReviews(store, { C, X, V: () => app.locals.feedVisual });
  app.locals.reviews = R;
  // kudos and reviews travel together: every page that reads a host's strengths gets the reviews with them
  const base = X.hostStrengths; X.hostStrengths = (ws, o) => { const S0 = base(ws, o); return o?.year ? S0 : R.intoStrengths(ws, S0); };
  // the hosts directory card: a count, and the average once 3 are rated, for real hosts with real reviews only
  const discover0 = C.discover; if (typeof discover0 === "function") C.discover = (...a) => { const d = discover0(...a); if (!d || !Array.isArray(d.hosts) || !R.all().length) return d;
    return { ...d, hosts: d.hosts.map((h) => { if (!h?.handle || h.showcase || h.sample) return h; const ws = C.wsOfHandle(h.handle), s = ws ? R.summaryOf(ws) : null; return s && (s.count || s.rating) ? { ...h, reviews: Math.max(s.count, s.rating?.n || 0), ...(s.rating ? { rating: s.rating } : {}) } : h; }) }; };
  X.reviewQuote = (x, email) => R.quoteFor(x, email);
  X.reviewSummary = (ws, scope) => R.summaryOf(ws, scope);
  const user = (req) => { try { const u = currentUser(req); return u && u.email ? u : null; } catch { return null; } };
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const hits = new Map(); const limited = (req, n, k0 = "w") => { const k = k0 + (req.ip || "?"), now = Date.now(); let h = hits.get(k); if (!h || now - h.start > 3600e3) { h = { n: 0, start: now }; hits.set(k, h); } if (hits.size > 20000) hits.clear(); return ++h.n > n; };
  R.resetLimits = () => hits.clear();
  const perHour = () => { const n = Math.floor(+process.env.ENCORE_REVIEWS_PER_IP_HOUR); return n > 0 ? n : WRITES_PER_HOUR; }; // writes, edits and deletes from one place
  const proofOf = (o = {}) => ({ rid: String(o.rid || "").slice(0, 80), code: String(o.code || "").slice(0, 40), t: String(o.t || "").slice(0, 60) });

  // may I write one, and what did I write? (the form's own data)
  app.get("/api/public/reviews/form", (req, res) => { res.set("Cache-Control", "private, no-store"); if (limited(req, 600, "r")) return bad(res, "Slow down.", 429, "rate_limited");
    const st = R.standing(req.query.subject, proofOf(req.query), user(req)); if (!st.ok) return res.json({ can: false, code: st.code, message: st.message, title: st.title || "" });
    res.json(R.formOf(st)); });
  // write or change mine
  app.post("/api/public/reviews", small, (req, res) => { res.set("Cache-Control", "private, no-store"); if (limited(req, perHour())) return bad(res, "That's a lot of reviews in an hour. Try again later.", 429, "rate_limited");
    const b = req.body || {}, u = user(req), st = R.standing(b.subject, proofOf(b), u); if (!st.ok) return bad(res, st.message, st.status, st.code);
    const x = R.save(st, { rating: b.rating, text: b.text, photos: b.photos }); if (x.error) return bad(res, x.error, 400, x.code || "invalid");
    const v = R.viewerOf(u); v.keys.add(st.author.key); res.json({ ok: true, created: x.created, review: R.out(x.doc, v), where: R.whereLine(st) }); });
  app.post("/api/public/reviews/delete", small, (req, res) => { if (limited(req, perHour())) return bad(res, "Slow down.", 429, "rate_limited");
    const b = req.body || {}, st = R.standing(b.subject, proofOf(b), user(req)); if (!st.ok) return bad(res, st.message, st.status, st.code);
    if (!R.remove(st)) return bad(res, "No review to delete.", 404, "not_found"); res.json({ ok: true }); });
  // read: one host's page, one event or drop, one experience, or one booking. Reply proofs ride in the body, never the URL.
  app.post("/api/public/reviews/view", small, (req, res) => { res.set("Cache-Control", "private, no-store"); if (limited(req, 900, "r")) return bad(res, "Slow down.", 429, "rate_limited");
    const q = req.body || {}, u = user(req), proofs = Array.isArray(q.proofs) ? q.proofs : []; let ws = "", scope = {}, write = null, booking = null;
    if (q.event) { const E = R.eventOf(String(q.event).slice(0, 80)); if (!E) return bad(res, "No such event.", 404, "not_found"); ws = E.ws; scope = { eventId: E.id };
      const p = proofs.find((x) => String(x?.id || x?.eventId) === E.id) || {}, st = R.standing("event:" + E.id, proofOf(p), u); if (st.ok) write = { ...R.formOf(st), ...(p.rid ? { rid: String(p.rid), code: String(p.code || "") } : {}) }; }
    else if (q.booking) { const B = R.bookingOf(String(q.booking).slice(0, 40)); if (!B) return bad(res, "No such booking.", 404, "not_found"); ws = B.ws; scope = { bookingId: B.b.id }; booking = { id: B.b.id, t: q.t };
      const st = R.standing("booking:" + B.b.id, proofOf({ t: q.t }), u); if (st.ok) write = { ...R.formOf(st), ...(q.t ? { t: String(q.t) } : {}) }; else if (!(u && u.ws === ws) && String(q.t || "") !== R.bookingToken(B.b.id)) return bad(res, "This link isn't working.", 403, "not_granted"); }
    else { ws = C.wsOfHandle(String(q.host || "").toLowerCase().slice(0, 40)); if (!ws || !C.profileOf(ws)) return bad(res, "No host by that name.", 404, "not_found"); if (q.exp) scope = { expId: String(q.exp).slice(0, 80) }; }
    const viewer = R.viewerOf(u, proofs, booking), L = R.listFor(ws, viewer, scope), owner = !!u && u.ws === ws;
    res.json({ ...L, owner, ...(write ? { write } : {}), ...(!q.event && !q.booking && !owner ? { writable: R.writable(ws, u, proofs) } : {}), pinMax: PIN_MAX }); });
  // the host: reply, pin, hide
  app.post("/api/host/reviews/:id", small, (req, res) => { const u = user(req); if (!u || !u.ws || u.ws === DEFAULT_WS) return bad(res, "Sign in first.", 401, "unauthenticated"); if (limited(req, 120, "h")) return bad(res, "Slow down.", 429, "rate_limited");
    const x = R.hostAct(u.ws, req.params.id, u.email, req.body || {}); if (x.error) return bad(res, x.error, x.status || 400, x.code || "invalid");
    const r = R.all().find((y) => y.ws === u.ws && y.id === String(req.params.id)); res.json({ ok: true, review: r ? R.out(r, R.viewerOf(u)) : null, ...R.summaryOf(u.ws) }); });
  // the team: reviews hosts hid, newest first
  app.get("/api/admin/reviews/hidden", (req, res) => { const u = user(req); if (!u || !isAdmin(u.email)) return bad(res, "Not found.", 404, "not_found"); res.set("Cache-Control", "private, no-store");
    res.json({ reviews: R.all().filter((r) => r.hidden).sort((a, b) => (b.hiddenAt || 0) - (a.hiddenAt || 0)).slice(0, 200).map((r) => ({ id: r.id, host: C.profileOf(r.ws)?.handle || "", rating: r.rating || null, text: noContact(r.text), name: first(r.name), at: r.at, hiddenAt: r.hiddenAt || 0, removed: R.removed(r) })) }); });
  return R;
}
// ---- end reviews ----
