// Potto fills in the reply form from what you told us before. Only ever your own things: your account (name, email,
// phone and the reply details you saved in Settings), your own past replies (by your account's email, or for a signed-out
// guest by the reply proofs this browser holds, the way /api/chats reads them) and the answers you gave to the same or a
// similar question before (matched by a stable key: dietary, plus-one, t-shirt size, a song, Instagram, phone; else the
// question's own words). Never anyone else's, and never for the event's own host (their Guest view stays empty).
//   GET|POST /api/me/reply-defaults?eventId=...  { proofs: [{ id, rid, code }] } -> { on, fields: [{ field, value, source, sensitive }] }
//     private, no-store; only the fields that event's form asks for; nothing when "Fill in my replies" is off.
//   GET  /api/me/reply-details   -> { on, profile, answers }: what Potto remembers (Settings, "Saved reply details")
//   POST /api/me/reply-details   { on } | { forget: "name"|"phone"|"email"|"dietary"|"access"|"answer:<key>" } |
//                                { save: [{ q, type, a }] } | { decline: [keys] } (after a reply: "Save these for next time?")
// Stored on the account: rsvpProfile (server/community.js, shared with the reply form's "Save my details"), replyFill
// (false = off; on by default), replyAnswers ({ key: { q, a, at } }) and replyDeclined ([keys]).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { scopeStore, allWorkspaceIds, workspaceOfEvent, DEFAULT_WS, getDbUser, putDbUser } from "./workspaces.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ID = /^[A-Za-z0-9_-]{2,80}$/;
const lc = (s) => String(s ?? "").trim().toLowerCase();
const clean = (s, n) => String(s ?? "").replace(/[<>]/g, "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
// the reply form asks "Anything you don't eat?" exactly when public/questions.js says so: one rule for both
let Q = null; try { const window = {}; vm.runInNewContext(fs.readFileSync(path.join(here, "../public/questions.js"), "utf8"), { window, document: undefined, console }); Q = window.Questions; } catch (e) { console.warn("[replyfill]", e?.message); }
export const askDiet = (ev) => !!Q?.askDiet?.(ev);

/** A question's stable key and whether it's health-like: public/questions.js, so the page and the server agree. */
export const keyOf = (text, type = "") => Q?.keyOf?.(text, type) || "";
export const sensitive = (key, text = "") => !!Q?.sensitive?.(key, text);

const month = (ms) => { const d = new Date(ms || 0); return isNaN(d) || !ms ? "" : d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }); };
const titleOf = (ev) => clean(ev?.pubTitle || ev?.name, 80) || "an event";
const answerText = (v) => (Array.isArray(v) ? v.map((x) => String(x)).join(", ") : v == null ? "" : String(v)).trim().slice(0, 300);

export function mountReplyFill(app, { store, small, currentUser, X }) {
  const me = (req) => { try { const u = currentUser(req); return u && u.ws !== DEFAULT_WS ? u : null; } catch { return null; } };
  const limits = new Map(); const limited = (k, n = 120) => { const now = Date.now(), L = (limits.get(k) || []).filter((t) => now - t < 3600e3); L.push(now); limits.set(k, L); if (limits.size > 5000) limits.clear(); return L.length > n; };

  /** Your own replies, newest first: by your account's email, and the replies this browser can prove. */
  function ownReplies(email, proofs) { const out = new Map(), at = (r) => r.changedAt || r.at || r.createdAt || 0;
    const keep = (ws, id, r) => { if (!ID.test(id)) return; const cur = out.get(id); if (!cur || at(r) >= at(cur.r)) out.set(id, { ws, id, r }); };
    if (email) { const em = lc(email); for (const w of allWorkspaceIds()) for (const d of scopeStore(store, w).list("rsvps")) { const r = d.data || {}; if (lc(r.email) === em && r.eventId) keep(w, r.eventId, r); } }
    for (const p of (Array.isArray(proofs) ? proofs : []).slice(0, 80)) { const id = String(p?.id || p?.eventId || ""); if (!ID.test(id)) continue; const P = X.rsvpProof?.(id, String(p.rid || "").slice(0, 80), String(p.code || "").slice(0, 40)); if (P) keep(P.ws, id, P.r); }
    return [...out.values()].sort((a, b) => at(b.r) - at(a.r)); }

  /** What the person told us before, by key: { key: { value, source } }. Saved details win over past replies. */
  function remembered(u, rec, proofs, skipEventId, local = null) { const R = {}, put = (k, value, source) => { value = answerText(value); if (k && value && !R[k]) R[k] = { value, source }; };
    const P = rec?.rsvpProfile || (local?.profile && typeof local.profile === "object" ? local.profile : {}), from = "from your saved details";
    // a signed-out guest's own details, kept on their own device ("Save my details on this phone", "Save these for next time?")
    if (!rec && local?.answers && typeof local.answers === "object") for (const [k, v] of Object.entries(local.answers).slice(0, 30)) if (/^[a-z]{2,12}$|^q:/.test(k)) R[k] = R[k] || (answerText(v?.a) ? { value: answerText(v.a).slice(0, 300), source: from } : undefined);
    for (const k of Object.keys(R)) if (!R[k]) delete R[k];
    put("name", P.name, from); put("email", P.email, from); put("phone", P.phone, from); put("dietary", P.dietary, from); put("access", P.access, from); if (P.dietary && P.severe) R.severe = { value: "yes", source: from };
    for (const [k, v] of Object.entries(rec?.replyAnswers || {})) put(k, v?.a, from);
    if (u) { put("name", rec?.name || u.name, "from your account"); put("email", u.email, "from your account"); }
    for (const x of ownReplies(u?.email || "", proofs)) { if (x.id === skipEventId) continue; const ev = scopeStore(store, x.ws).get("events/" + x.id)?.data || {}, r = x.r, src = `from your reply to ${titleOf(ev)}${month(r.changedAt || r.at || r.createdAt) ? " in " + month(r.changedAt || r.at || r.createdAt) : ""}`;
      put("name", r.name, src); put("email", r.email, src); put("phone", r.phone, src); put("dietary", r.dietary, src); if (r.dietary && r.severe && !R.severe) R.severe = { value: "yes", source: src }; put("access", r.access, src);
      const byId = new Map((Array.isArray(ev.questions) ? ev.questions : []).map((q) => [q.id, q]));
      if (Array.isArray(r.answers)) for (const a of r.answers) put(keyOf(a.q), a.a, src);
      else if (r.answers && typeof r.answers === "object") for (const [qid, v] of Object.entries(r.answers)) { const q = byId.get(qid); if (q) put(keyOf(q.q, q.type), v, src); } }
    return R; }

  /** Only what this event's reply form asks for. */
  function defaultsFor(ev, R) { const F = [], add = (field, k, text = "") => { if (R[k]) F.push({ field, value: R[k].value, source: R[k].source, sensitive: sensitive(k, text) }); };
    add("name", "name"); add("email", "email"); add("phone", "phone");
    if (askDiet(ev)) { add("dietary", "dietary"); add("severe", "severe"); }
    add("access", "access");
    for (const q of Array.isArray(ev.questions) ? ev.questions : []) { if (!q?.id || !String(q.q || "").trim()) continue; const k = keyOf(q.q, q.type); if (!R[k]) continue;
      let v = R[k].value; if (/choice|yesno/.test(q.type || "")) { const opts = (q.options?.length ? q.options : q.type === "yesno" ? ["Yes", "No"] : []); const hit = opts.find((o) => lc(o) === lc(v)); if (!hit) continue; v = hit; }
      else if (q.type === "multi") { const opts = q.options || [], hit = v.split(/,\s*/).map((x) => opts.find((o) => lc(o) === lc(x))).filter(Boolean); if (!hit.length) continue; v = hit; }
      else if (q.type === "number") { const n = Math.round(+v); if (!Number.isFinite(n)) continue; v = n; }
      else if (/emoji|time/.test(q.type || "")) { const hit = (q.options || []).find((o) => lc(o) === lc(v)); if (!hit) continue; v = hit; }
      F.push({ field: "q:" + q.id, key: k, value: v, source: R[k].source, sensitive: sensitive(k, q.q) }); }
    return F; }

  app.all("/api/me/reply-defaults", small, (req, res) => { res.set("Cache-Control", "private, no-store");
    if (req.method !== "GET" && req.method !== "POST") return res.status(405).end();
    if (limited("d:" + (req.ip || "?"))) return res.status(429).json({ code: "rate_limited", message: "Slow down." });
    const id = String(req.query.eventId || req.body?.eventId || ""), none = (on = true) => res.json({ on, fields: [] });
    if (!ID.test(id) || id === "_preview") return none();
    const ws = workspaceOfEvent(id), ev = ws ? scopeStore(store, ws).get("events/" + id)?.data : null; if (!ev || ev.example) return none();
    const u = me(req), rec = u ? getDbUser(u.email) : null;
    if (rec?.replyFill === false) return none(false);
    if (u && u.ws === ws) return none(); // the host looking at their own invite: an empty form, never their own details mixed in
    const proofs = req.method === "POST" ? req.body?.proofs : [], local = req.method === "POST" && req.body?.local && typeof req.body.local === "object" ? req.body.local : null;
    if (!u && !(Array.isArray(proofs) && proofs.length) && !local?.profile && !local?.answers) return none();
    res.json({ on: true, fields: defaultsFor(ev, remembered(u, rec, proofs, id, local)) }); });

  const mine = (req, res) => { const u = me(req); if (!u) { res.status(401).json({ code: "unauthenticated", message: "Sign in first." }); return null; } const rec = getDbUser(u.email); if (!rec) { res.status(404).json({ code: "not_found", message: "No account." }); return null; } return { u, rec }; };
  const view = (rec) => ({ on: rec.replyFill !== false, profile: rec.rsvpProfile || null, answers: Object.entries(rec.replyAnswers || {}).map(([key, v]) => ({ key, q: v.q || "", a: v.a || "" })), declined: rec.replyDeclined || [] });
  app.get("/api/me/reply-details", (req, res) => { res.set("Cache-Control", "private, no-store"); const M = mine(req, res); if (!M) return; res.json(view(M.rec)); });
  app.post("/api/me/reply-details", small, (req, res) => { res.set("Cache-Control", "private, no-store"); const M = mine(req, res); if (!M) return; const b = req.body || {}; let rec = { ...M.rec };
    if (typeof b.on === "boolean") rec.replyFill = b.on;
    if (typeof b.forget === "string") { const f = b.forget; if (f.startsWith("answer:")) { const A = { ...(rec.replyAnswers || {}) }; delete A[f.slice(7)]; rec.replyAnswers = A; }
      else if (["name", "phone", "email", "dietary", "access"].includes(f)) { const P = { ...(rec.rsvpProfile || {}) }; P[f] = ""; if (f === "dietary") P.severe = false; if (f === "phone" && P.contactVia !== "email") P.contactVia = P.email ? "email" : ""; P.updatedAt = Date.now(); rec.rsvpProfile = P; }
      else return res.status(400).json({ code: "invalid", message: "Nothing by that name to forget." }); }
    if (Array.isArray(b.save)) { const A = { ...(rec.replyAnswers || {}) };
      for (const x of b.save.slice(0, 15)) { const k = x?.key && /^[a-z]{2,12}$/.test(x.key) ? x.key : keyOf(x?.q, x?.type); const a = clean(answerText(x?.a), 300); if (!k || !a || k === "name" || k === "email") continue;
        if (k === "dietary" || k === "access" || k === "phone") { const P = { ...(rec.rsvpProfile || {}) }; P[k] = clean(a, k === "phone" ? 30 : 200); P.updatedAt = Date.now(); rec.rsvpProfile = P; continue; }
        A[k] = { q: clean(x.q, 140), a, at: Date.now() }; }
      const keys = Object.keys(A); if (keys.length > 30) keys.sort((p, q) => (A[p].at || 0) - (A[q].at || 0)).slice(0, keys.length - 30).forEach((k) => delete A[k]); rec.replyAnswers = A; }
    if (Array.isArray(b.decline)) rec.replyDeclined = [...new Set([...(rec.replyDeclined || []), ...b.decline.map((k) => clean(k, 130)).filter(Boolean)])].slice(-60);
    putDbUser(rec); res.json({ ok: true, ...view(rec) }); });
  return { keyOf, remembered, defaultsFor };
}
