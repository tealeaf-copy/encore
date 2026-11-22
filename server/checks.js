// "Would you come?" checks: before a brand commits budget, it sends a one-question page to the people it wants in
// the room (customers, prospects, creators, or through its sales reps). Replies are tallied for the event owner,
// with reasons in the guests' own words, so the go / tweak / rethink call is made on real signal.
import crypto from "node:crypto";
import { scopeStore, workspaceOfEvent, getWorkspace, DEFAULT_WS } from "./workspaces.js";

const clean = (v, n = 300) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const EMAIL_OK = (e) => /^[^\s@"<>()[\],;:]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(e || "");
const ID_OK = (id) => /^[A-Za-z0-9_-]{1,200}$/.test(String(id || ""));
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/** Tally replies into the numbers and words a field marketer needs for a go/no-go call. */
export function tally(replies) {
  const R = replies.filter((r) => ["yes", "maybe", "no"].includes(r.answer)), n = R.length, c = (a) => R.filter((r) => r.answer === a).length;
  const yes = c("yes"), maybe = c("maybe"), no = c("no"), dates = {}, roles = {};
  for (const r of R) { for (const d of r.dates || []) dates[d] = (dates[d] || 0) + (r.answer === "no" ? 0 : 1); if (r.role) roles[r.role] = (roles[r.role] || 0) + 1; }
  const score = n ? Math.round(((yes + maybe * 0.4) / n) * 100) : 0;
  const verdict = n < 5 ? { k: "early", label: "Too early to call", line: `${n} ${n === 1 ? "reply" : "replies"} so far. Aim for 8 to 10 before deciding.` }
    : score >= 55 ? { k: "go", label: "Green light", line: `${yes} of ${n} said they'd come. That's strong for an invite that hasn't gone out yet.` }
    : score >= 35 ? { k: "tweak", label: "Promising, tweak it", line: "Interest is there but not a must. Read what people said would make it a yes." }
    : { k: "rethink", label: "Rethink it", line: "Most people wouldn't come as described. Their reasons below point to what to change." };
  const quotes = (k) => R.filter((r) => r[k]).map((r) => ({ text: r[k], who: [r.role, r.company].filter(Boolean).join(", "), answer: r.answer })).slice(-12).reverse();
  return { n, yes, maybe, no, score, verdict, dates: Object.entries(dates).sort((a, b) => b[1] - a[1]).map(([date, votes]) => ({ date, votes })), roles: Object.entries(roles).sort((a, b) => b[1] - a[1]).map(([role, count]) => ({ role, count })), why: quotes("why"), must: quotes("must"), stop: quotes("stop") };
}

export function mountChecks(app, { store, small, currentUser }) {
  const me = (req, res) => { const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) { res.status(401).json({ code: "unauthenticated", message: "Sign in first." }); return null; } return u; };
  const hits = new Map(); const limited = (req, n) => { const k = req.ip || "?", now = Date.now(); const h = (hits.get(k) || []).filter((t) => now - t < 3600e3); h.push(now); hits.set(k, h); return h.length > n; };
  const view = (c) => ({ title: c.title, pitch: c.pitch, question: c.question, dates: c.dates || [], city: c.city || "", brand: c.brand || "", open: c.open !== false, asks: c.asks || {} });

  // the owner opens (or updates) the check for an event
  app.post("/api/check/:id", small, (req, res) => { const u = me(req, res); if (!u) return; const id = String(req.params.id); if (!ID_OK(id)) return res.status(400).json({ code: "invalid", message: "Bad event id." });
    const S = scopeStore(store, u.ws), ev = S.get("events/" + id)?.data; if (!ev) return res.status(404).json({ code: "not_found", message: "Save the event first." });
    const cur = S.get("checks/" + id)?.data || {}, b = req.body || {};
    const c = { ...cur, eventId: id, title: clean(b.title || cur.title || ev.name, 120), pitch: clean(b.pitch ?? cur.pitch ?? ev.concept ?? "", 700), question: clean(b.question || cur.question || "Would you come to this?", 160),
      dates: (Array.isArray(b.dates) ? b.dates : cur.dates || []).map((d) => clean(d, 40)).filter(Boolean).slice(0, 4), city: clean(b.city ?? cur.city ?? ev.city ?? "", 80), brand: clean(getWorkspace(u.ws)?.company || "", 120),
      asks: { must: b.asks?.must ?? cur.asks?.must ?? true, stop: b.asks?.stop ?? cur.asks?.stop ?? true }, open: b.open ?? cur.open ?? true, token: cur.token || crypto.randomBytes(9).toString("base64url"), createdAt: cur.createdAt || Date.now(), updatedAt: Date.now(), by: u.email };
    S.set("checks/" + id, c); res.json({ check: c, link: `/check/${encodeURIComponent(id)}?t=${c.token}` }); });
  app.get("/api/check/:id", (req, res) => { const u = me(req, res); if (!u) return; const id = String(req.params.id), S = scopeStore(store, u.ws), c = S.get("checks/" + id)?.data;
    if (!c) return res.json({ check: null }); const R = S.list("checkReplies").map((d) => d.data).filter((r) => r.eventId === id);
    res.json({ check: c, link: `/check/${encodeURIComponent(id)}?t=${c.token}`, tally: tally(R), replies: R.sort((a, b) => b.at - a.at).slice(0, 200).map((r) => ({ answer: r.answer, name: r.name, role: r.role, company: r.company, why: r.why, must: r.must, stop: r.stop, dates: r.dates, at: r.at, via: r.via })) }); });

  // every check in the workspace, tallied: feeds Pip's list and "what your audience is telling you"
  app.get("/api/checks", (req, res) => { const u = me(req, res); if (!u) return; const S = scopeStore(store, u.ws), R = S.list("checkReplies").map((d) => d.data);
    res.json({ checks: S.list("checks").map((d) => d.data).filter(Boolean).map((c) => ({ eventId: c.eventId, title: c.title, createdAt: c.createdAt, link: `/check/${encodeURIComponent(c.eventId)}?t=${c.token}`, tally: tally(R.filter((r) => r.eventId === c.eventId)) })) }); });

  // the public page
  const open = (req, res) => { const id = String(req.params.id); if (!ID_OK(id)) { res.status(404).json({ code: "not_found", message: "This link isn't valid." }); return null; } const ws = workspaceOfEvent(id);
    const S = ws && ws !== DEFAULT_WS ? scopeStore(store, ws) : null, c = S?.get("checks/" + id)?.data; const t = String(req.query.t || req.body?.t || "");
    if (!c || !t || !same(t, c.token)) { res.status(404).json({ code: "not_found", message: "This link isn't valid." }); return null; } return { S, c, id }; };
  app.get("/api/public/check/:id", (req, res) => { const o = open(req, res); if (!o) return; res.json({ check: view(o.c) }); });
  app.post("/api/public/check/:id", small, (req, res) => { if (limited(req, 30)) return res.status(429).json({ code: "rate_limited", message: "Too many replies from here." }); const o = open(req, res); if (!o) return;
    if (o.c.open === false) return res.status(409).json({ code: "closed", message: "This check has closed. Thanks for looking." });
    const b = req.body || {}, answer = ["yes", "maybe", "no"].includes(b.answer) ? b.answer : ""; if (!answer) return res.status(400).json({ code: "invalid", message: "Pick an answer." });
    const email = clean(b.email, 200).toLowerCase(); if (email && !EMAIL_OK(email)) return res.status(400).json({ code: "invalid", message: "That email doesn't look right." });
    const r = { eventId: o.id, answer, dates: (Array.isArray(b.dates) ? b.dates : []).map((d) => clean(d, 40)).filter((d) => (o.c.dates || []).includes(d)), why: clean(b.why, 400), must: clean(b.must, 400), stop: clean(b.stop, 400), name: clean(b.name, 80), role: clean(b.role, 80), company: clean(b.company, 120), email, notify: !!b.notify && !!email, via: clean(b.via, 40), at: Date.now() };
    // one reply per email: a second one replaces the first
    const prev = email ? o.S.list("checkReplies").find((d) => d.data.eventId === o.id && d.data.email === email) : null;
    if (prev) o.S.update("checkReplies/" + prev.id, r); else o.S.add("checkReplies", r);
    res.json({ ok: true }); });
}
