// Tools for people who host a lot: the hype man (broadcast to the right people, then a report on who's in and when they're
// free), polls so hosts don't do everything alone, tips and words of affirmation, a portfolio brands can hire from,
// followers-first booking for ticketed dinners, and page views.
import crypto from "node:crypto";
import { scopeStore, getWorkspace, allWorkspaceIds, workspaceOfEvent, DEFAULT_WS } from "./workspaces.js";
import { emailConfig, sendEmail } from "./email.js";
import { lanesOf } from "./social.js";

const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").trim().slice(0, n);
const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const EMAIL_OK = (e) => /^[^\s@"<>()[\],;:]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(e || "");
const today = () => new Date().toISOString().slice(0, 10);
const STOP = new Set(["club", "people", "members", "member", "friends", "would", "like", "love", "anyone", "every", "with", "their", "who'd", "group", "events", "event", "about", "into", "from", "that", "this", "your", "they"]);
const words = (s) => lc(s).split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !STOP.has(w));

/** Whether a follower is inside a ticketed event's followers-first window. */
export function earlyAccessBlocks(ev, isFollower, now = Date.now()) {
  if (!ev?.earlyUntil) return false; const until = Date.parse(ev.earlyUntil); return Number.isFinite(until) && until > now && !isFollower;
}

export function mountHosts(app, { store, small, currentUser, publicOrigin, C, X }) {
  const hits = new Map(); const limited = (req, n = 30) => { const k = (req.ip || "?") + req.path.split("/").slice(0, 4).join("/"), now = Date.now(); let h = hits.get(k); if (!h || now - h.start > 3600_000) { h = { n: 0, start: now }; hits.set(k, h); } return ++h.n > n; };
  const me = (req, res) => { const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) { res.status(401).json({ code: "unauthenticated", message: "Sign in first." }); return null; } return u; };
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const evOf = (u, id) => scopeStore(store, u.ws).get("events/" + clean(id, 80))?.data;

  // ---- page views (the hype report counts reach) ----
  app.post("/api/public/view/:eventId", (req, res) => { if (limited(req, 120)) return res.json({ ok: true }); const ws = workspaceOfEvent(clean(req.params.eventId, 80)); if (!ws) return res.json({ ok: true });
    const S = scopeStore(store, ws), k = "stats/" + clean(req.params.eventId, 80), cur = S.get(k)?.data || { views: 0, byDay: {} }, d = today(); cur.views++; cur.byDay[d] = (cur.byDay[d] || 0) + 1; S.set(k, cur); res.json({ ok: true }); });

  // ---- broadcast: tell the people this is for ----
  function audienceFor(u, ev) {
    const lanes = lanesOf(`${ev.activity || ""} ${ev.name || ""} ${ev.pubTitle || ""}`), city = lc(ev.city || C.profileOf(u.ws)?.city), want = words(ev.audienceWho || ""), I = X.index(), out = [];
    const followers = new Set(C.followersOf(u.ws).map((f) => lc(f.email))), friends = new Set(X.friendsOf(u.email).map((f) => f.email));
    for (const d of store.list("system")) { const w = d.data; if (w?.kind !== "workspace" || w.id === u.ws || !w.ownerEmail) continue; const em = lc(w.ownerEmail), h = C.profileOf(w.id) || {};
      const alerts = X.alertsOf(em), P = X.eventProfile(em), why = [];
      const theirCity = lc(h.city || alerts.find((a) => a.homeCity || a.city)?.homeCity || alerts.find((a) => a.city)?.city || "");
      const sameCity = city && theirCity && (theirCity.includes(city) || city.includes(theirCity));
      const likes = lanes.filter((l) => P.loves.some((x) => x.kind === l) || alerts.some((a) => (a.lanes || []).includes(l)) || (h.tags || []).some((t) => lanesOf(t).includes(l)));
      const bio = words(`${h.bio || ""} ${(h.tags || []).join(" ")}`), fit = want.filter((w2) => bio.includes(w2));
      let score = 0; if (sameCity) { score += 2; why.push(`in ${h.city || ev.city}`); } if (likes.length) { score += 2; why.push(`likes ${likes[0]}`); } if (fit.length) { score += 1.5; why.push(`"${fit[0]}"`); } if (followers.has(em)) { score += 2; why.push("follows you"); } if (friends.has(em)) { score += 1.5; why.push("your friend"); }
      if (city && !sameCity && !followers.has(em) && !friends.has(em)) continue; if (score < 2) continue;
      out.push({ email: em, name: X.person(em).name, handle: h.handle, why: why.slice(0, 3), score, top: P.top ? { emoji: P.top.emoji, name: P.top.name } : null });
    }
    for (const f of C.followersOf(u.ws)) if (!out.some((o) => o.email === lc(f.email))) out.push({ email: lc(f.email), name: f.name, why: ["follows you"], score: 2, follower: true });
    return out.sort((a, b) => b.score - a.score).slice(0, 300);
  }
  app.get("/api/host/audience/:eventId", (req, res) => { const u = me(req, res); if (!u) return; const ev = evOf(u, req.params.eventId); if (!ev) return bad(res, "No such event.", 404, "not_found");
    const A = audienceFor(u, ev); res.json({ count: A.length, sample: A.slice(0, 8).map((a) => ({ name: first(a.name) || "Someone", why: a.why, top: a.top })) }); });
  app.post("/api/host/broadcast", small, async (req, res) => { const u = me(req, res); if (!u) return; const id = clean(req.body?.eventId, 80), S = scopeStore(store, u.ws), ev = S.get("events/" + id)?.data; if (!ev) return bad(res, "No such event.", 404, "not_found");
    if (!ev.audienceWho && !ev.discoverable) return bad(res, "Say who it's for first, so Pip only tells people it suits.");
    const A = audienceFor(u, ev), host = C.profileOf(u.ws), title = ev.pubTitle || ev.name, link = `${publicOrigin(req)}/g#rsvp-${id}`, cfg = emailConfig(u.ws, false) || emailConfig(DEFAULT_WS, true); let emailed = 0;
    for (const a of A) { const fresh = X.notify(a.email, { kind: "invite", key: `bc-${id}`, text: `${host?.name || first(u.name)} is ${ev.stage === "interest" ? "seeing who's in for" : "hosting"} ${title}${ev.audienceWho ? `, for ${ev.audienceWho}` : ""}. ${ev.approvalRequired ? "Request a spot" : "Tap to say yes"}.`, link: `/g#rsvp-${id}`, eventId: id });
      if (fresh && cfg && a.follower && X.canEmail(a.email)) { const r = await sendEmail(cfg, { to: a.email, subject: `${host?.name || first(u.name)}: ${title}`, text: `${title}${ev.audienceWho ? `\nFor: ${ev.audienceWho}` : ""}${ev.date ? `\nWhen: ${ev.date}` : ""}\n\n${ev.approvalRequired ? "Request a spot" : "Say yes"}: ${link}\n\nYou follow ${host?.name || "this host"} on Encore.`, fromName: host?.name || u.name }).catch(() => ({})); if (r.ok) emailed++; } }
    S.set("broadcasts/" + id, { eventId: id, at: Date.now(), reached: A.length, emailed });
    S.add("audit", { eventId: id, what: `Pip shared it with ${A.length} people it suits`, kind: "growth", at: Date.now() });
    res.json({ ok: true, reached: A.length, emailed }); });

  // ---- the hype report: who's in, when they're free, who to nudge ----
  app.get("/api/host/hype/:eventId", (req, res) => { const u = me(req, res); if (!u) return; const id = clean(req.params.eventId, 80), S = scopeStore(store, u.ws), ev = S.get("events/" + id)?.data; if (!ev) return bad(res, "No such event.", 404, "not_found");
    const R = S.list("rsvps").map((d) => ({ id: d.id, ...d.data })).filter((r) => r.eventId === id), followers = new Set(C.followersOf(u.ws).map((f) => lc(f.email))), friends = new Set(X.friendsOf(u.email).map((f) => f.email)), I = X.index();
    const people = R.map((r) => { const em = lc(r.email), P = em ? X.eventProfile(em) : null, past = em ? (I.att.get(em) || []).filter((a) => a.ws === u.ws && a.eventId !== id).length : 0;
      return { rid: r.id, name: r.name || "Someone", response: r.response, interest: r.interest || (r.response === "going" ? "in" : r.response === "maybe" ? "maybe" : r.response === "requested" ? "requested" : "no"), dates: r.dates || [], answers: r.answers || [], at: r.createdAt || 0,
        follower: followers.has(em), friend: friends.has(em), regular: past >= 2, past, newFace: !past, top: P?.top ? { emoji: P.top.emoji, name: P.top.name } : null, traits: (P?.traits || []).slice(0, 2).map((t) => t.emoji + " " + t.name.replace("The ", "")) }; });
    const opts = ev.dateOptions || [], dates = opts.map((o) => ({ date: o, yes: people.filter((p) => p.interest !== "no" && p.dates.includes(o)).length, names: people.filter((p) => p.interest !== "no" && p.dates.includes(o)).map((p) => first(p.name)) }));
    const st = S.get("stats/" + id)?.data || { views: 0 }, bc = S.get("broadcasts/" + id)?.data, inN = people.filter((p) => ["in", "requested"].includes(p.interest) || p.response === "going").length, goal = +ev.interestGoal || Math.max(4, Math.round((+ev.headcount || 8) * 0.6));
    res.json({ goal, in: inN, maybe: people.filter((p) => p.interest === "maybe").length, views: st.views || 0, viewsToday: (st.byDay || {})[today()] || 0, reached: bc?.reached || 0, people: people.sort((a, b) => (a.interest === "in" ? 0 : 1) - (b.interest === "in" ? 0 : 1) || a.at - b.at), dates, bestDate: dates.slice().sort((a, b) => b.yes - a.yes)[0] || null,
      newFaces: people.filter((p) => p.newFace && p.interest !== "no").length, regulars: people.filter((p) => p.regular).length }); });

  // ---- polls: "who can bring chairs?", "which date?" ----
  app.post("/api/host/poll", small, (req, res) => { const u = me(req, res); if (!u) return; const b = req.body || {}, id = clean(b.eventId, 80), S = scopeStore(store, u.ws); if (!S.get("events/" + id)) return bad(res, "No such event.", 404, "not_found");
    const q = clean(b.q, 200), options = (Array.isArray(b.options) ? b.options : []).map((o) => clean(o, 80)).filter(Boolean).slice(0, 8); if (!q || options.length < 1) return bad(res, "Ask a question and give at least one option.");
    const r = S.add("chat", { eventId: id, by: first(u.name) || "Host", role: "host", kind: "poll", text: q, poll: { options, multi: b.multi !== false, help: !!b.help, votes: {} }, private: false, at: Date.now() }); res.json({ ok: true, id: r.id }); });
  app.post("/api/public/poll/:msgId/vote", small, (req, res) => { if (limited(req, 60)) return bad(res, "Slow down.", 429, "rate_limited"); const b = req.body || {}, P = X.rsvpProof(clean(b.eventId, 80), b.rid, b.code); if (!P || P.r.response !== "going") return bad(res, "Polls are for people who said yes.", 403, "not_granted");
    const path = "chat/" + clean(req.params.msgId, 40), m = P.S.get(path)?.data; if (!m?.poll || m.eventId !== P.r.eventId) return bad(res, "No such poll.", 404, "not_found");
    const opt = clean(b.option, 80); if (!m.poll.options.includes(opt)) return bad(res, "Not an option.");
    const V = m.poll.votes || {}; for (const o of m.poll.options) { V[o] = (V[o] || []).filter((x) => x.rid !== P.rid); } if (b.on !== false) { if (!m.poll.multi) for (const o of m.poll.options) V[o] = (V[o] || []).filter((x) => x.rid !== P.rid); V[opt] = [...(V[opt] || []), { rid: P.rid, name: first(P.r.name) || "Guest" }]; }
    if (m.poll.multi && b.keep) for (const o of b.keep) if (m.poll.options.includes(o) && o !== opt && !(V[o] || []).some((x) => x.rid === P.rid)) V[o] = [...(V[o] || []), { rid: P.rid, name: first(P.r.name) || "Guest" }];
    P.S.update(path, { poll: { ...m.poll, votes: V } });
    if (m.poll.help && b.on !== false) { const W = getWorkspace(P.ws); X.notify(W?.ownerEmail, { kind: "help", text: `${first(P.r.name)} can help: ${opt}`, link: "/#studio", eventId: P.r.eventId }); }
    res.json({ ok: true }); });

  // ---- tips and words of affirmation ----
  app.post("/api/public/tipped", small, (req, res) => { if (limited(req, 30)) return bad(res, "Slow down.", 429, "rate_limited"); const b = req.body || {}, P = X.rsvpProof(clean(b.eventId, 80), b.rid, b.code); if (!P) return bad(res, "Open this from your invite.", 403, "not_granted");
    const amount = Math.max(0, Math.min(500, Math.round(+b.amount || 0))), path = "kudos/" + P.rid, cur = P.S.get(path)?.data;
    P.S.set(path, { ...(cur || { eventId: P.r.eventId, rid: P.rid, name: P.r.name || "", email: lc(P.r.email), tags: [], love: "", at: Date.now() }), tipped: true, tip: amount, tipAt: Date.now() }); X.bust();
    const W = getWorkspace(P.ws); X.notify(W?.ownerEmail, { kind: "tip", text: `💛 ${first(P.r.name) || "A guest"} sent you a tip${amount ? ` ($${amount})` : ""} for ${P.ev?.pubTitle || P.ev?.name}`, link: "/#studio", eventId: P.r.eventId });
    res.json({ ok: true }); });

  // ---- "your 4th with Claire" ----
  app.get("/api/public/regular/:eventId", (req, res) => { const P = X.rsvpProof(clean(req.params.eventId, 80), req.query.rid, req.query.code); if (!P || !P.r.email) return res.json({ count: 0 });
    const L = (X.index().att.get(lc(P.r.email)) || []).filter((a) => a.ws === P.ws); res.json({ count: L.length + (L.some((a) => a.eventId === P.r.eventId) ? 0 : P.r.response === "going" ? 1 : 0) }); });
  // ---- portfolio and hiring: brands find hosts ----
  app.get("/api/public/hosts", (req, res) => { const city = lc(req.query.city), kind = lc(req.query.kind), out = [];
    for (const ws of allWorkspaceIds()) { const h = C.profileOf(ws); if (!h?.handle || !h.forHire) continue; const S = X.hostStrengths(ws); if (city && !lc(`${h.city} ${h.hood}`).includes(city)) continue; if (kind && !S.kinds.some((k) => k.kind === kind)) continue;
      out.push({ handle: h.handle, name: h.name, emoji: h.emoji, color: h.color, city: h.city, services: h.services || "", events: S.events, guests: S.guests, returning: S.returning, kudos: S.kudosCount, kinds: S.kinds.slice(0, 3), quote: S.kudos.find((k) => k.love)?.love || "", followers: C.followersOf(ws).length }); }
    out.sort((a, b) => b.kudos * 2 + b.guests + b.returning * 2 - (a.kudos * 2 + a.guests + a.returning * 2)); res.json({ hosts: out.slice(0, 60) }); });
  app.post("/api/public/inquiry/:handle", small, async (req, res) => { if (limited(req, 6)) return bad(res, "Too many messages from here. Try later.", 429, "rate_limited"); const ws = C.wsOfHandle(req.params.handle), h = ws && C.profileOf(ws); if (!h?.forHire) return bad(res, "This host isn't taking work through Encore right now.", 404, "not_found");
    const b = req.body || {}, email = lc(clean(b.email, 200)); if (!EMAIL_OK(email)) return bad(res, "Add an email so they can reply."); const msg = clean(b.message, 1500); if (msg.length < 10) return bad(res, "Say a little about what you have in mind.");
    const inq = { id: crypto.randomBytes(6).toString("hex"), name: clean(b.name, 80), company: clean(b.company, 120), email, message: msg, when: clean(b.when, 80), budget: clean(b.budget, 80), at: Date.now() };
    scopeStore(store, ws).add("inquiries", inq); const W = getWorkspace(ws); X.notify(W?.ownerEmail, { kind: "inquiry", text: `💼 ${inq.company || inq.name || "Someone"} wants to work with you: "${msg.slice(0, 90)}"`, link: "/feed", eventId: "" });
    const cfg = emailConfig(ws, false) || emailConfig(DEFAULT_WS, true); if (cfg && W?.ownerEmail) await sendEmail(cfg, { to: W.ownerEmail, replyTo: email, subject: `Work inquiry from ${inq.company || inq.name || email}`, text: `${inq.name}${inq.company ? ` (${inq.company})` : ""} found you on Encore.\n\n${msg}\n\nWhen: ${inq.when || "-"}\nBudget: ${inq.budget || "-"}\n\nReply to this email to answer them.` }).catch(() => {});
    res.json({ ok: true }); });
  app.get("/api/host/inquiries", (req, res) => { const u = me(req, res); if (!u) return; res.json({ inquiries: scopeStore(store, u.ws).list("inquiries").map((d) => d.data).sort((a, b) => b.at - a.at) }); });
}
