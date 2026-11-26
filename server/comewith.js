// "Come with me?": a guest who replied I'm in (or a signed-in person going, from a feed card) makes a link for one
// friend: /i/<event>?with=<token>. The invite then opens with "Mia wants you to come to Salsa Sunday" and Mia's face.
//
// Holding: on an ordinary event the friend's spot is held for 48 hours. The hold lives on the inviter's own reply
// (rsvps/<rid>.withHolds), so it counts toward the cap everywhere seats are counted (heldOf in server/social.js), and
// stops counting when it runs out, when the friend replies (their own reply takes the spot), or when the inviter is out.
// Pairs and groups (headUnit, groupSize): the inviter's reply already holds the whole pair, so the friend joins it
// (pairOf) and takes no new spot. Ask to join events keep asking: the link holds nothing and lets no one in.
//
// Tokens: 18 random bytes; only a hash is stored. The friend's page reads the link once
// (GET /api/public/come-with/:eventId/:token), which sets a cookie for that event, so the reply it sends is matched
// to the hold on the server. Together: "Mia and Jo are in" on Who's coming and feed cards (togetherOf).
import crypto from "node:crypto";
import { scopeStore, workspaceOfEvent, DEFAULT_WS } from "./workspaces.js";

export const HOLD_MS = 48 * 3600e3;
export const MAX_HOLDS = 3; // open holds on one reply at a time
const ID_OK = /^[A-Za-z0-9_-]{2,80}$/, TOKEN_OK = /^[A-Za-z0-9_-]{20,40}$/;
const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const today = () => new Date().toISOString().slice(0, 10);
export const tokenHash = (t) => crypto.createHash("sha256").update("cwm:" + String(t || "")).digest("hex").slice(0, 32);
export const newToken = () => crypto.randomBytes(18).toString("base64url");
/** A pair or group event: one reply books the whole unit, so a friend joins it instead of taking a spot. */
export const unitEvent = (ev) => ev?.headUnit === "pairs" || ev?.headUnit === "groups" || Math.floor(+ev?.groupSize) > 1;
export const unitSize = (ev) => { const g = Math.floor(+ev?.groupSize) || 0; return g > 1 ? Math.min(50, g) : unitEvent(ev) ? 2 : 1; };
/** Spots a reply holds for friends it invited: open, unexpired holds on an ordinary event where its sender is in. */
export function holdsOf(r, ev, now = Date.now()) {
  if (!r || r.response !== "going" || !ev || ev.preorder || ev.approvalRequired || unitEvent(ev)) return 0;
  return (Array.isArray(r.withHolds) ? r.withHolds : []).filter((h) => h && !h.by && +h.exp > now).length;
}
/** The cookie the friend's browser carries for one event: plw_<eventId>=<token>. */
export const cookieName = (eventId) => "plw_" + eventId;
export function tokenFromCookie(req, eventId) {
  if (!ID_OK.test(String(eventId || ""))) return "";
  const m = String(req.headers?.cookie || "").match(new RegExp("(?:^|;\\s*)" + cookieName(eventId) + "=([A-Za-z0-9_-]{20,40})"));
  return m ? m[1] : "";
}
/** The reply that made this token and its hold, or null. */
export function findHold(S, eventId, token) {
  if (!TOKEN_OK.test(String(token || ""))) return null; const h = tokenHash(token);
  for (const d of S.list("rsvps")) { const r = d.data || {}; if (r.eventId !== eventId || !Array.isArray(r.withHolds)) continue;
    const x = r.withHolds.find((y) => y && y.h === h); if (x) return { inviter: d, hold: x }; }
  return null;
}
/**
 * What a friend's reply gets from the link this browser carries, worked out at reply time (rsvpPolicy in server/app.js):
 * { withOf, withH, pairOf?, credit } or null. credit is the held spot their reply may fill (1 or 0).
 */
export function friendTerms(req, S, ev, eventId, selfId = null, now = Date.now()) {
  const tok = tokenFromCookie(req, eventId); if (!tok || !ev) return null;
  return termsOf(S, ev, findHold(S, eventId, tok), eventId, selfId, now);
}
/** The hold a link made, by the hash of its token (what an "I'm in if" record keeps from the friend's browser). */
export function findHoldByHash(S, eventId, h) {
  if (!/^[0-9a-f]{32}$/.test(String(h || ""))) return null;
  for (const d of S.list("rsvps")) { const r = d.data || {}; if (r.eventId !== eventId || !Array.isArray(r.withHolds)) continue;
    const x = r.withHolds.find((y) => y && y.h === h); if (x) return { inviter: d, hold: x }; }
  return null;
}
/** review round 13: the same terms for a reply the server makes later ("I'm in if Mia is" settling), from the stored hash. */
export const friendTermsByHash = (S, ev, eventId, h, selfId = null, now = Date.now()) => (ev ? termsOf(S, ev, findHoldByHash(S, eventId, h), eventId, selfId, now) : null);
function termsOf(S, ev, F, eventId, selfId, now) {
  if (!F) return null; const { inviter, hold } = F, ir = inviter.data || {};
  if (inviter.id === selfId || ir.response !== "going") return null; // never your own link; the inviter has to be in
  if (hold.by && hold.by !== selfId) return null; // someone else already used it
  if (unitEvent(ev)) { const joined = S.list("rsvps").filter((d) => d.id !== selfId && d.data?.pairOf === inviter.id && d.data?.response === "going").length;
    return joined < unitSize(ev) - 1 ? { withOf: inviter.id, withH: hold.h, pairOf: inviter.id, credit: 0 } : { withOf: inviter.id, withH: hold.h, credit: 0 }; }
  const open = !hold.by && +hold.exp > now && !ev.approvalRequired && !ev.preorder;
  return { withOf: inviter.id, withH: hold.h, credit: open ? 1 : 0 };
}
/** After a reply is saved: a friend's I'm in uses up the hold (their own reply holds the spot now). */
export function claimHold(S, rid, after) {
  if (!after?.withOf || after.response !== "going" || !ID_OK.test(String(after.withOf))) return false;
  const inv = S.get("rsvps/" + after.withOf)?.data; if (!inv || !Array.isArray(inv.withHolds)) return false;
  const tok = after._withH; let done = false;
  const L = inv.withHolds.map((h) => { if (done || h.by) return h; if (tok ? h.h === tok : true) { done = true; return { ...h, by: rid, at2: Date.now() }; } return h; });
  if (!done) return false; S.update("rsvps/" + after.withOf, { withHolds: L }); return true;
}
/** Who came together: [{ line: "Mia and Jo are in", people: [{ name, emoji }] }], from replies made through a link. */
export function togetherOf(docs, ev, eventId, { short = first } = {}) {
  if (!ev || ev.hideGuests) return [];
  const yes = (r) => r && r.eventId === eventId && r.response === "going" && !r.noShow && r.showMe !== false;
  const byId = new Map(docs.map((d) => [d.id, d.data || {}])), groups = new Map();
  for (const d of docs) { const r = d.data || {}; if (!yes(r) || !r.withOf || !yes(byId.get(r.withOf))) continue;
    if (!groups.has(r.withOf)) groups.set(r.withOf, [byId.get(r.withOf)]); groups.get(r.withOf).push(r); }
  const face = (r) => ({ name: short(r.name) || "Guest", emoji: r.emoji && !/^(🙂|🎉)$/.test(r.emoji) ? r.emoji : "" });
  return [...groups.values()].slice(0, 6).map((G) => { const P = G.slice(0, 5).map(face), N = P.map((p) => p.name);
    return { line: N.length === 2 ? `${N[0]} and ${N[1]} are in` : `${N.slice(0, -1).join(", ")} and ${N[N.length - 1]} are in`, count: P.length, people: P }; });
}

export function mountComeWith(app, { store, small, currentUser, X }) {
  const hits = new Map(), limited = (k, n, ms = 3600e3) => { const now = Date.now(); if (hits.size > 50_000) hits.clear(); let h = hits.get(k); if (!h || now - h.start > ms) { h = { n: 0, start: now }; hits.set(k, h); } return ++h.n > n; };
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const titleOf = (ev) => String(ev?.pubTitle || ev?.name || "").trim().slice(0, 120) || "this";
  const faceOf = (r) => { let p = null; try { p = r.email ? X.person(lc(r.email)) : null; } catch {} const em = [r.emoji, p?.emoji].find((x) => x && !/^(🙂|🎉)$/.test(x)) || "";
    return { name: first(r.name) || first(p?.name) || "A friend", emoji: em, color: p?.color || "" }; };
  // make a link from one reply (the guest's proof, or the signed-in person's own reply)
  function make(req, res, ws, S, d, ev, eventId) {
    const r = d.data || {}, now = Date.now();
    if (!ev || ev.example || ev.cancelled) return bad(res, "That event isn't here any more.", 404, "not_found");
    if (ev.date && ev.date < today()) return bad(res, "This one already happened.", 409, "past");
    if (r.response !== "going") return bad(res, "Reply I'm in first, then invite friends.", 409, "reply_first");
    if (limited("ip:" + (req.ip || "?"), +(process.env.ENCORE_CWM_PER_HOUR || 20)) || limited("r:" + d.id, 10, 864e5)) return bad(res, "That's a lot of links. Try again later.", 429, "rate_limited");
    const unit = unitEvent(ev), L = (Array.isArray(r.withHolds) ? r.withHolds : []).filter((h) => h && (h.by || (unit ? true : +h.exp > now)));
    let keep = L;
    if (unit) { const joined = L.filter((h) => h.by), unused = L.filter((h) => !h.by), room = unitSize(ev) - 1;
      if (joined.length >= room) return bad(res, unitSize(ev) > 2 ? "Your group is full." : "Your pair is full.", 409, "unit_full");
      const spare = room - joined.length - 1; keep = [...joined, ...(spare > 0 ? unused.slice(-spare) : [])]; } // a new link replaces an unused one once the pair or group has no other place
    else if (L.filter((h) => !h.by).length >= MAX_HOLDS) return bad(res, `You're holding ${MAX_HOLDS} spots already. They free up in 48 hours.`, 429, "too_many");
    const token = newToken(), hold = { h: tokenHash(token), at: now, exp: now + HOLD_MS, ...(unit ? { pair: true } : {}) };
    S.update("rsvps/" + d.id, { withHolds: [...keep, hold].slice(-12) });
    const hold48 = !unit && !ev.approvalRequired && !ev.preorder;
    res.json({ ok: true, token, url: `/i/${encodeURIComponent(eventId)}?with=${token}`, title: titleOf(ev), name: first(r.name), held: hold48 ? { until: hold.exp } : null, pair: unit, ask: !!ev.approvalRequired }); }
  app.post("/api/public/come-with", small, (req, res) => { const b = req.body || {}, P = X.rsvpProof(String(b.eventId || "").slice(0, 80), String(b.rid || "").slice(0, 60), String(b.code || "").slice(0, 40));
    if (!P) return bad(res, "Open your invite on the phone you replied from.", 403, "not_granted");
    make(req, res, P.ws, P.S, { id: P.rid, data: P.r }, P.ev, String(b.eventId)); });
  app.post("/api/me/come-with", small, (req, res) => { const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) return bad(res, "Sign in first.", 401, "unauthenticated");
    const id = String(req.body?.eventId || ""); if (!ID_OK.test(id)) return bad(res, "No such event.", 404, "not_found"); const ws = workspaceOfEvent(id); if (!ws) return bad(res, "No such event.", 404, "not_found");
    const S = scopeStore(store, ws), ev = S.get("events/" + id)?.data, em = lc(u.email);
    const d = S.list("rsvps").filter((x) => x.data?.eventId === id && lc(x.data.email) === em).sort((a, b) => (b.data.changedAt || b.data.createdAt || 0) - (a.data.changedAt || a.data.createdAt || 0))[0];
    if (!d) return bad(res, "Reply I'm in first, then invite friends.", 409, "reply_first");
    make(req, res, ws, S, d, ev, id); });
  // the friend's page reads the link: who sent it, and whether a spot is held. It also sets the cookie the reply carries.
  app.get("/api/public/come-with/:eventId/:token", (req, res) => { const id = String(req.params.eventId || ""), tok = String(req.params.token || "");
    res.set("Cache-Control", "private, no-store");
    if (limited("read:" + (req.ip || "?"), 120)) return bad(res, "Slow down.", 429, "rate_limited");
    if (!ID_OK.test(id) || !TOKEN_OK.test(tok)) return res.json({ ok: false });
    const ws = workspaceOfEvent(id); if (!ws) return res.json({ ok: false }); const S = scopeStore(store, ws), ev = S.get("events/" + id)?.data;
    const F = ev && !ev.example ? findHold(S, id, tok) : null; if (!F || F.inviter.data?.response !== "going") return res.json({ ok: false });
    const now = Date.now(), h = F.hold, unit = unitEvent(ev), used = !!h.by, open = !used && !unit && +h.exp > now && !ev.approvalRequired && !ev.preorder;
    res.append("Set-Cookie", `${cookieName(id)}=${tok}; Path=/; Max-Age=${Math.round(HOLD_MS / 1000)}; HttpOnly; SameSite=Lax${req.secure ? "; Secure" : ""}`);
    res.json({ ok: true, from: faceOf(F.inviter.data), title: titleOf(ev), held: open ? { until: h.exp } : null, pair: unit && !used, used, ask: !!ev.approvalRequired }); });
}
