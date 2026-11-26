// Tools for people who host a lot: the hype man (broadcast to the right people, then a report on who's in and when they're
// free), polls so hosts don't do everything alone, tips and words of affirmation, a portfolio brands can hire from,
// followers-first booking for ticketed dinners, and page views.
import crypto from "node:crypto";
import { scopeStore, getWorkspace, allWorkspaceIds, workspaceOfEvent, DEFAULT_WS } from "./workspaces.js";
import { emailConfig, sendEmail } from "./email.js";
import { lanesOf } from "./social.js";
import { getDbUser } from "./workspaces.js";
import { trustFrom, isExampleEmail } from "./recognition.js";
import { goalFit, placeFit, metroOf, METRO_NAMES, perPerson, isFlat, priceText, TEAM_GOALS, AUDIENCE_WORD } from "./search.js";
import { categoryOf } from "./market.js";

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
    for (const d of store.listPrefix("system", "ws-")) { const w = d.data; if (w?.kind !== "workspace" || w.id === u.ws || !w.ownerEmail) continue; const em = lc(w.ownerEmail), h = C.profileOf(w.id) || {};
      const alerts = X.alertsOf(em), P = X.eventProfile(em), why = [];
      const theirCity = lc(h.city || alerts.find((a) => a.homeCity || a.city)?.homeCity || alerts.find((a) => a.city)?.city || "");
      const sameCity = city && theirCity && (theirCity.includes(city) || city.includes(theirCity));
      const likes = lanes.filter((l) => P.loves.some((x) => x.kind === l) || alerts.some((a) => (a.lanes || []).includes(l)) || (h.tags || []).some((t) => lanesOf(t).includes(l)));
      const bio = words(`${h.bio || ""} ${(h.tags || []).join(" ")}`), fit = want.filter((w2) => bio.includes(w2));
      let score = 0; if (sameCity) { score += 2; why.push(`in ${h.city || ev.city}`); } if (likes.length) { score += 2; why.push(`likes ${likes[0]}`); } if (fit.length) { score += 1.5; why.push(`"${fit[0]}"`); } if (followers.has(em)) { score += 2; why.push("follows you"); } if (friends.has(em)) { score += 1.5; why.push("your friend"); }
      if (city && theirCity && !sameCity) continue; if (city && !sameCity && !followers.has(em) && !friends.has(em)) continue; if (score < 2) continue;
      out.push({ email: em, name: X.person(em).name, handle: h.handle, why: why.slice(0, 3), score, top: P.top ? { emoji: P.top.emoji, name: P.top.name } : null });
    }
    for (const f of C.followersOf(u.ws)) if (f.email && !out.some((o) => o.email === lc(f.email)) && !(city && (() => { const w2 = X.userOf(f.email); const c2 = lc(w2 ? C.profileOf(w2.ws)?.city : ""); return c2 && !c2.includes(city) && !city.includes(c2); })())) out.push({ email: lc(f.email), name: f.name, why: ["follows you"], score: 2, follower: true });
    return out.sort((a, b) => b.score - a.score).slice(0, 300);
  }
  app.get("/api/host/audience/:eventId", (req, res) => { const u = me(req, res); if (!u) return; const ev = evOf(u, req.params.eventId); if (!ev) return bad(res, "No such event.", 404, "not_found");
    const A = audienceFor(u, ev).filter((a) => String(a.email || "").toLowerCase() !== String(u.email || "").toLowerCase() && String(a.name || "").trim().toLowerCase() !== String(u.name || "").trim().toLowerCase() && String(a.name || "").trim().toLowerCase().split(/\s+/)[0] !== String(u.name || "").trim().toLowerCase().split(/\s+/)[0]); res.json({ count: A.length, sample: A.slice(0, 8).map((a) => ({ name: first(a.name) || "Someone", why: a.why, top: a.top })) }); });
  app.post("/api/host/broadcast", small, async (req, res) => { const u = me(req, res); if (!u) return; const id = clean(req.body?.eventId, 80), S = scopeStore(store, u.ws), ev = S.get("events/" + id)?.data; if (!ev) return bad(res, "No such event.", 404, "not_found");
    if (!ev.audienceWho && !ev.discoverable) return bad(res, "Say who it's for first, so Potto only tells people it suits.");
    const A = audienceFor(u, ev), host = C.profileOf(u.ws), title = ev.pubTitle || ev.name, link = `${publicOrigin(req)}/g#rsvp-${id}`, cfg = emailConfig(u.ws, false) || emailConfig(DEFAULT_WS, true); let emailed = 0;
    for (const a of A) { const fresh = X.notify(a.email, { kind: "invite", key: `bc-${id}`, text: `${host?.name || first(u.name)} is ${ev.stage === "interest" ? "seeing who's in for" : "hosting"} ${title}${ev.audienceWho ? `, for ${ev.audienceWho}` : ""}. ${ev.approvalRequired ? "Ask to join" : "Tap to say I'm in"}.`, link: `/g#rsvp-${id}`, eventId: id });
      if (fresh && cfg && a.follower && X.canEmail(a.email)) { const r = await sendEmail(cfg, { list: "guest", origin: publicOrigin(req), to: a.email, subject: `${host?.name || first(u.name)}: ${title}`, text: `${title}${ev.audienceWho ? `\nFor: ${ev.audienceWho}` : ""}${ev.date ? `\nWhen: ${ev.date}` : ""}\n\n${ev.approvalRequired ? "Request a spot" : "Say yes"}: ${link}\n\nYou follow ${host?.name || "this host"} on Pottery Lab.`, fromName: host?.name || u.name }).catch(() => ({})); if (r.ok) emailed++; } }
    S.set("broadcasts/" + id, { eventId: id, at: Date.now(), reached: A.length, emailed });
    S.add("audit", { eventId: id, what: `Potto shared it with ${A.length} people it suits`, kind: "growth", at: Date.now() });
    res.json({ ok: true, reached: A.length, emailed }); });

  // ---- Potto calls it: when enough people are in and the host allowed it, lock the best date and tell everyone ----
  X.autoGo = async (ws, id, origin = process.env.ENCORE_PUBLIC_URL || "") => { const S = scopeStore(store, ws), ev = S.get("events/" + id)?.data; if (!ev || ev.stage !== "interest" || !ev.autoGo) return false;
    const R = S.list("rsvps").map((d) => d.data).filter((r) => r.eventId === id && r.interest === "in"), goal = +ev.interestGoal || Math.max(4, Math.round((+ev.headcount || 8) * 0.6)); if (R.length < goal) return false;
    const opts = ev.dateOptions || [], best = opts.map((o) => [o, R.filter((r) => (r.dates || []).includes(o)).length]).sort((a, b) => b[1] - a[1])[0];
    S.set("events/" + id, { ...ev, stage: "", ...(best?.[1] ? { date: best[0] } : {}), autoWentAt: Date.now(), updatedAt: Date.now() });
    const W = getWorkspace(ws), name = X.person(W?.ownerEmail).name; await X.itsOn?.({ ws, id, hostName: name, origin });
    X.notify(W?.ownerEmail, { kind: "itson", key: "auto-" + id, text: `🎉 ${goal} guests are in, so ${ev.pubTitle || ev.name} is on${best?.[1] ? ` for ${best[0]}` : ""}. Everyone's been told.`, link: "/#studio", eventId: id }); X.bust(); return true; };
  // ---- the hype report: who's in, when they're free, who to nudge ----
  app.get("/api/host/hype/:eventId", async (req, res) => { const u = me(req, res); if (!u) return; const id = clean(req.params.eventId, 80), S = scopeStore(store, u.ws), ev = S.get("events/" + id)?.data; if (!ev) return bad(res, "No such event.", 404, "not_found");
    const R = S.list("rsvps").map((d) => ({ id: d.id, ...d.data })).filter((r) => r.eventId === id), followers = new Set(C.followersOf(u.ws).map((f) => lc(f.email))), friends = new Set(X.friendsOf(u.email).map((f) => f.email)), I = X.index();
    const people = R.map((r) => { const em = lc(r.email), P = em ? X.eventProfile(em) : null, past = em ? (I.att.get(em) || []).filter((a) => a.ws === u.ws && a.eventId !== id).length : 0;
      return { rid: r.id, name: r.name || "Someone", response: r.response, interest: r.interest || (r.response === "going" ? "in" : r.response === "maybe" ? "maybe" : r.response === "requested" ? "requested" : "no"), dates: r.dates || [], answers: r.answers || [], at: r.createdAt || 0,
        follower: followers.has(em), friend: friends.has(em), regular: past >= 2, past, newFace: !past, top: P?.top ? { emoji: P.top.emoji, name: P.top.name } : null, traits: (P?.traits || []).slice(0, 2).map((t) => t.emoji + " " + t.name.replace("The ", "")) }; });
    if (ev.autoGo && ev.stage === "interest") { try { if (await X.autoGo(u.ws, id, publicOrigin(req))) return res.json({ autoWent: true }); } catch {} }
    const opts = ev.dateOptions || [], dates = opts.map((o) => ({ date: o, yes: people.filter((p) => p.interest !== "no" && p.dates.includes(o)).length, names: people.filter((p) => p.interest !== "no" && p.dates.includes(o)).map((p) => first(p.name)) }));
    const st = S.get("stats/" + id)?.data || { views: 0 }, bc = S.get("broadcasts/" + id)?.data, inN = people.filter((p) => p.interest === "in" || p.response === "going").length, asked = people.filter((p) => p.response === "requested").length, goal = +ev.interestGoal || Math.max(4, Math.round((+ev.headcount || 8) * 0.6));
    res.json({ goal, in: inN, asked, maybe: people.filter((p) => p.interest === "maybe").length, views: st.views || 0, viewsToday: (st.byDay || {})[today()] || 0, reached: bc?.reached || 0, people: people.sort((a, b) => (a.interest === "in" ? 0 : 1) - (b.interest === "in" ? 0 : 1) || a.at - b.at), dates, bestDate: dates.slice().sort((a, b) => b.yes - a.yes)[0] || null,
      newFaces: people.filter((p) => p.newFace && p.interest !== "no").length, regulars: people.filter((p) => p.regular).length }); });

  // ---- polls: "who can bring chairs?", "which date?" ----
  app.post("/api/host/poll", small, (req, res) => { const u = me(req, res); if (!u) return; const b = req.body || {}, id = clean(b.eventId, 80), S = scopeStore(store, u.ws); if (!S.get("events/" + id)) return bad(res, "No such event.", 404, "not_found");
    const q = clean(b.q, 200), options = (Array.isArray(b.options) ? b.options : []).map((o) => clean(o, 80)).filter(Boolean).slice(0, 8); if (!q || options.length < 1) return bad(res, "Ask a question and give at least one option.");
    const r = S.add("chat", { eventId: id, by: first(u.name) || "Host", role: "host", kind: "poll", text: q, poll: { options, multi: b.multi !== false, help: !!b.help, votes: {} }, private: false, at: Date.now() }); res.json({ ok: true, id: r.id }); });
  app.post("/api/public/poll/:msgId/vote", small, (req, res) => { if (limited(req, 60)) return bad(res, "Slow down.", 429, "rate_limited"); const b = req.body || {}, P = X.rsvpProof(clean(b.eventId, 80), b.rid, b.code); if (!P || P.r.response !== "going") return bad(res, "Polls are for guests who are in.", 403, "not_granted");
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

  // ---- a guest's own status, so an approval shows up on their page ----
  app.get("/api/public/rsvp-status/:eventId", (req, res) => { const P = X.rsvpProof(clean(req.params.eventId, 80), req.query.rid, req.query.code); if (!P) return res.status(404).json({ code: "not_found", message: "No such reply." }); res.json({ response: P.r.response, paid: !!P.r.paid, paidClaim: !!P.r.paidClaim, decidedAt: P.r.decidedAt || null, slot: P.r.slot || "" }); });
  // ---- "your 4th with Claire" ----
  app.get("/api/public/regular/:eventId", (req, res) => { const P = X.rsvpProof(clean(req.params.eventId, 80), req.query.rid, req.query.code); if (!P || !P.r.email) return res.json({ count: 0 });
    const L = (X.index().att.get(lc(P.r.email)) || []).filter((a) => a.ws === P.ws); res.json({ count: L.length + (L.some((a) => a.eventId === P.r.eventId) ? 0 : 1) }); });
  // ---- portfolio and hiring: brands find hosts ----
  app.get("/api/public/hosts", (req, res) => { const city = lc(req.query.city), kind = lc(req.query.kind), out = [];
    for (const ws of allWorkspaceIds()) { const h = C.profileOf(ws); if (!h?.handle || !h.forHire) continue; const S = X.hostStrengths(ws); if (city && !lc(`${h.city} ${h.hood}`).includes(city)) continue; if (kind && !S.kinds.some((k) => k.kind === kind)) continue;
      out.push({ handle: h.handle, name: h.name, emoji: h.emoji, color: h.theme?.accent || h.color, avatarArt: h.theme?.avatarArt || "", city: h.city, services: h.services || "", experiences: (h.experiences || []).slice(0, 3).map((x) => ({ name: x.name, price: x.price, min: x.min, max: x.max, emoji: x.emoji })), events: S.events, guests: S.guests, returning: S.returning, kudos: S.kudosCount, kinds: S.kinds.slice(0, 3), quote: S.kudos.find((k) => k.love)?.love || "", followers: C.followersOf(ws).length }); }
    out.sort((a, b) => b.kudos * 2 + b.guests + b.returning * 2 - (a.kudos * 2 + a.guests + a.returning * 2)); res.json({ hosts: out.slice(0, 60) }); });
  app.post("/api/public/inquiry/:handle", small, async (req, res) => { if (limited(req, 6)) return bad(res, "Too many messages from here. Try later.", 429, "rate_limited"); const ws = C.wsOfHandle(req.params.handle), h = ws && C.profileOf(ws); if (!h?.forHire) return bad(res, "This host isn't taking work through Pottery Lab right now.", 404, "not_found");
    const b = req.body || {}, email = lc(clean(b.email, 200)); if (!EMAIL_OK(email)) return bad(res, "Add an email so they can reply."); const msg = clean(b.message, 1500); if (msg.length < 10) return bad(res, "Say a little about what you have in mind.");
    const exp = (h.experiences || []).find((x) => x.id === b.experienceId), people = Math.max(0, Math.min(5000, Math.round(+b.people || 0)));
    const inq = { id: crypto.randomBytes(6).toString("hex"), name: clean(b.name, 80), company: clean(b.company, 120), email, message: msg, when: clean(b.when, 80), budget: clean(b.budget, 80), people, experience: exp ? { id: exp.id, name: exp.name } : null, at: Date.now() };
    scopeStore(store, ws).add("inquiries", inq); const W = getWorkspace(ws); X.notify(W?.ownerEmail, { kind: "inquiry", text: `💼 ${inq.company || inq.name || "Someone"} sent a request for ${exp ? `"${exp.name}"` : "you"}${people ? ` for ${people}` : ""}${inq.when ? `, ${inq.when}` : ""}: "${msg.slice(0, 80)}"`, link: "/feed", eventId: "" });
    const cfg = emailConfig(ws, false) || emailConfig(DEFAULT_WS, true); if (cfg && W?.ownerEmail) await sendEmail(cfg, { to: W.ownerEmail, replyTo: email, subject: `New request from ${inq.company || inq.name || email}`, text: `${inq.name}${inq.company ? ` (${inq.company})` : ""} found you on Pottery Lab.\n\n${msg}\n\nWhen: ${inq.when || "-"}\nBudget: ${inq.budget || "-"}\n\nReply to this email to answer them.` }).catch(() => {});
    res.json({ ok: true }); });
  mountTrust(app, { store, small, me, bad, limited, C, X });
  app.get("/api/host/inquiries", (req, res) => { const u = me(req, res); if (!u) return; res.json({ inquiries: scopeStore(store, u.ws).list("inquiries").map((d) => d.data).sort((a, b) => b.at - a.at) }); });
}


// ---------------------------------------------------------------------------------------------------------------
// Proof a host adds themselves (labelled "Added by the host" / "Self-reported" wherever it shows):
// past corporate events, social accounts with follower counts, and the insurance certificate with its expiry.
const COMPANY_SIZES = ["1-50", "51-200", "201-1,000", "1,000+"];
const SOCIALS = ["instagram", "tiktok", "strava", "linkedin"];
const BLOB = /^\/_blob\/[A-Za-z0-9]{20}$/, ISO = /^20\d\d-\d\d-\d\d$/;
export function cleanProof(p = {}, cur = {}) {
  const int = (v, max) => Math.max(0, Math.min(max, Math.round(+String(v ?? "").replace(/[^\d.]/g, "") || 0)));
  const pastEvents = Array.isArray(p.pastEvents) ? p.pastEvents.slice(0, 8).map((x) => ({ companyType: clean(x?.companyType, 60), companySize: COMPANY_SIZES.includes(x?.companySize) ? x.companySize : "", format: clean(x?.format, 80), headcount: int(x?.headcount, 5000), when: clean(x?.when, 30), city: clean(x?.city, 60) })).filter((x) => x.companyType || x.format) : cur.pastEvents || [];
  const socials = Array.isArray(p.socials) ? p.socials.slice(0, 6).map((x) => { const platform = lc(x?.platform), handle = clean(x?.handle, 60).replace(/^@/, "").replace(/^https?:\/\/(www\.)?[^/]+\//i, "").replace(/[^A-Za-z0-9._-]/g, ""); const was = (cur.socials || []).find((y) => y.platform === platform && y.handle === handle);
    return { platform, handle, followers: int(x?.followers, 1e9), ...(was?.verifiedAt ? { verifiedAt: was.verifiedAt } : {}) }; }).filter((x, i, A) => SOCIALS.includes(x.platform) && x.handle && A.findIndex((y) => y.platform === x.platform) === i) : cur.socials || [];
  const c = p.coi !== undefined ? p.coi || {} : cur.coi || {};
  const coi = { url: BLOB.test(c.url || "") ? c.url : "", expires: ISO.test(c.expires || "") ? c.expires : "" };
  return { pastEvents, socials, coi };
}
// one host, one card: the same person signed up twice ("Tram" and "Tram's Matcha Table" in Brooklyn), or test accounts that share a name
const normName = (s) => lc(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
const personOf = (name, person) => lc(person) || (normName(name).match(/^([a-z0-9]+)'s\b/) || [])[1] || "";
export function sameHost(a, b) { const ma = metroOf(a.city) >= 0 ? metroOf(a.city) : metroOf(a.hood), mb = metroOf(b.city) >= 0 ? metroOf(b.city) : metroOf(b.hood);
  const place = ma >= 0 || mb >= 0 ? ma === mb : lc(a.city) === lc(b.city); if (!place) return false;
  const na = normName(a.name), nb = normName(b.name); if (na && na === nb) return true;
  const pa = personOf(a.name, a.person), pb = personOf(b.name, b.person);
  // "Tram" and "Tram's Matcha Table": the same person, one of them named just by their first name
  return !!(pa && pa === pb && (na === pa || nb === pb)); }

function mountTrust(app, { store, small, me, bad, limited, C, X }) {
  const S0 = (ws) => scopeStore(store, ws);
  const proofOf = (ws) => S0(ws).get("hostproof/main")?.data || {};
  const bookingsOf = (ws) => S0(ws).list("inquiries").map((d) => d.data || {}).map((b) => ({ company: b.company || "", status: b.status || "", date: b.date || "", experience: b.experience?.name || "", people: b.people || 0 }));
  X.bookingsOf = (ws) => bookingsOf(ws).filter((b) => ["booked", "done"].includes(b.status)).length;
  const exampleWs = (ws) => isExampleEmail(getWorkspace(ws)?.ownerEmail);
  const personWs = (ws) => first(getDbUser(getWorkspace(ws)?.ownerEmail || "")?.name || "");
  function trustOf(ws) { const h = C.profileOf(ws) || {}; let S = {}; try { S = X.hostStrengths(ws); } catch {}
    let sb = []; try { sb = S0(ws).list("scrapbook").map((d) => d.data || {}); } catch {}
    const R = X.recognition?.of(h.handle);
    return trustFrom({ S, h, example: exampleWs(ws), bookings: bookingsOf(ws), proof: proofOf(ws), scrapbook: sb, badges: R?.badges || [], followers: C.followersOf(ws).length, person: personWs(ws) }); }
  X.trustOf = trustOf;
  const lite = (T) => ({ example: T.example, guests: T.guests, returned: T.returned, again: T.again, kudos: T.kudos, events: T.events, bookings: T.bookings, lines: T.lines, badges: T.badges, workedWith: T.workedWith.slice(0, 3), testimonial: T.testimonials[0] || null, insurance: T.insurance, isNewHere: T.isNewHere, newLine: T.newLine, socials: T.socials, pastCorporate: T.pastCorporate.slice(0, 3) });

  // ---- the host edits their own proof ----
  app.get("/api/host/proof", (req, res) => { const u = me(req, res); if (!u) return; res.json({ proof: { pastEvents: [], socials: [], coi: { url: "", expires: "" }, ...proofOf(u.ws) }, sizes: COMPANY_SIZES, platforms: SOCIALS }); });
  app.post("/api/host/proof", small, (req, res) => { const u = me(req, res); if (!u) return; if (!C.profileOf(u.ws)?.handle) return bad(res, "Set up your page first.");
    const next = cleanProof(req.body || {}, proofOf(u.ws)); S0(u.ws).set("hostproof/main", { ...next, updatedAt: Date.now() }); res.json({ ok: true, proof: next }); });

  // ---- one source of truth for a host's numbers and proof ----
  app.get("/api/public/host/:handle/trust", (req, res) => { const ws = C.wsOfHandle(lc(req.params.handle)); if (!ws || !C.profileOf(ws)) return res.status(404).json({ code: "not_found", message: "No host by that name." });
    res.set("Cache-Control", "public, max-age=60").json(trustOf(ws)); });
  app.get("/api/public/hosts/trust", (req, res) => { const out = {}; for (const hd of String(req.query.handles || "").split(",").map((x) => lc(x)).filter(Boolean).slice(0, 60)) { const ws = C.wsOfHandle(hd); if (ws && C.profileOf(ws)) out[hd] = lite(trustOf(ws)); } res.json({ hosts: out }); });

  // ---- every bookable host once, with their options inside; examples in their own list ----
  function bookable() { const L = [], requests = [];
    for (const ws of allWorkspaceIds()) { const h = C.profileOf(ws); if (!h?.handle) continue;
      // real hosts open to brand work who wrote what they do but haven't priced a package yet: "Request a date" cards
      if (!(h.experiences || []).length) { if (h.forHire && !exampleWs(ws) && String(h.services || "").trim().length >= 3 && String(h.name || "").trim().length >= 3 && lc(h.name) !== h.handle) { const T = trustOf(ws); requests.push({ ws, h, T, person: personWs(ws), example: false, weight: T.kudos * 2 + T.guests + T.events * 2 }); } continue; }
      if (exampleWs(ws) && process.env.ENCORE_HIDE_DEMO === "1") continue;
      // only hosts who said they're open to paid work (the same rule /api/public/book enforces), the moment they say so
      if (!h.forHire && !exampleWs(ws)) continue;
      // finished listings only: a real name and options that say what they are (no half-made test pages)
      const exps = h.experiences.filter((e) => String(e.desc || "").trim().length >= 10 || (e.includes || []).length), named = String(h.name || "").trim().length >= 3 && lc(h.name) !== h.handle;
      if (!exps.length || !named) continue;
      const T = trustOf(ws); L.push({ ws, h: { ...h, experiences: exps }, T, person: personWs(ws), example: T.example, weight: T.bookings * 5 + T.kudos * 2 + T.guests + T.events * 2 + T.scrapbook + (T.insurance.onFile ? 2 : 0) + (h.experiences || []).length * 0.1 }); }
    L.sort((a, b) => b.weight - a.weight); const keep = [], aliases = {};
    for (const x of L) { const twin = keep.find((k) => k.example === x.example && sameHost({ name: k.h.name, city: k.h.city, hood: k.h.hood, person: k.person }, { name: x.h.name, city: x.h.city, hood: x.h.hood, person: x.person })); if (twin) aliases[x.h.handle] = twin.h.handle; else keep.push(x); }
    requests.sort((a, b) => b.weight - a.weight);
    return { list: keep, aliases, requests: requests.filter((x) => !keep.some((k) => !k.example && sameHost({ name: k.h.name, city: k.h.city, hood: k.h.hood, person: k.person }, { name: x.h.name, city: x.h.city, hood: x.h.hood, person: x.person }))) }; }
  X.bookable = bookable;
  const optionOf = (ws, x) => ({ id: x.id, name: x.name, desc: x.desc || "", emoji: x.emoji || "", photo: x.photo || "", includes: x.includes || [], min: x.min, max: x.max, price: priceText(x.price), perHead: perPerson(priceText(x.price)), flat: isFlat(priceText(x.price)), instant: !!x.instant, length: x.length || "", category: categoryOf(x), travels: !!x.travels, seated: x.seated || 0, standing: x.standing || 0, hybrid: x.hybrid || "", openDates: C.openDatesOf(ws, x) });
  const cardOfHost = ({ ws, h, T, person }, options) => ({ handle: h.handle, name: h.name, person, city: h.city || "", hood: h.hood || "", accent: h.theme?.accent || h.color || "", avatarArt: h.theme?.avatarArt || "", avatarUrl: h.theme?.avatarUrl || "", emoji: h.emoji || "", tagline: h.tagline || "", respondsIn: h.respondsIn || "", terms: h.terms || "", invoices: !!h.invoices, gallery: (h.gallery || []).slice(0, 6), example: T.example, trust: lite(T), options });
  /** "Run club activations, group runs for 10 to 60. Weekdays." -> "Run club activations": the first clause, at most 60 chars. */
  const headlineOf = (s) => { let t = String(s || "").split(/[.;,:\n–—!?]|\s-\s|\(/)[0].replace(/\s+/g, " ").trim(); if (t.length > 60) t = t.slice(0, 60).replace(/\s+\S*$/, ""); return t ? t[0].toUpperCase() + t.slice(1) : ""; };
  app.get("/api/public/hosts/book", (req, res) => { const cat = lc(req.query.category), city = clean(req.query.city, 60), people = Math.max(0, Math.min(5000, +req.query.people || 0)); const { list, aliases, requests } = bookable(), real = [], examples = [];
    for (const x of list) { if (city && placeFit(city, x.h) === "away") continue;
      const opts = x.h.experiences.filter((e) => !e.service || !cat).map((e) => optionOf(x.ws, e)).filter((o) => (!cat || o.category === cat) && (!people || (people >= (o.min || 1) * 0.7 && people <= (o.max || 9999) * 1.2)));
      if (!opts.length) continue; (x.example ? examples : real).push(cardOfHost(x, opts)); }
    // after every host with a priced package: hosts who take brand work on request (no price shown, quoted per request)
    for (const x of requests) { if (city && placeFit(city, x.h) === "away") continue; const services = clean(x.h.services, 400), category = categoryOf({ name: services, desc: x.h.tagline || "" }) || "";
      if (cat && category !== cat) continue;
      // the card's headline is what they do (their services, first clause); "Request a date" is only the button
      real.push({ ...cardOfHost(x, [{ id: "", name: headlineOf(services) || clean(x.h.tagline, 60) || "Brand events", desc: services, emoji: x.h.emoji || "", photo: "", includes: [], min: 0, max: 0, price: "Quoted on request", perHead: 0, flat: false, instant: false, length: "", category, travels: false, request: true, openDates: [] }]), request: true, services }); }
    res.json({ hosts: real, examples, aliases, total: real.length }); });

  // ---- /teams: the goal decides what wins; stays in the city; real hosts only as matches ----
  app.get("/api/public/teams/match", (req, res) => { if (limited(req, 120)) return bad(res, "Slow down.", 429, "rate_limited"); res.json(teamMatch(req.query || {})); });
  function teamMatch(q) {
    const city = clean(q.city, 60), n = Math.max(0, Math.min(5000, +q.people || 0)), goal = TEAM_GOALS[q.goal] ? String(q.goal) : "bonding", crowd = clean(q.crowd, 20), G = TEAM_GOALS[goal];
    const { list } = bookable(), out = [], ex = []; let cityHosts = 0;
    for (const x of list) { const where = placeFit(city, x.h); if (where === "away") continue; if (!x.example) cityHosts++;
      let best = null; for (const e of x.h.experiences) { const f = goalFit(goal, e, n); if (!f) continue; if (!best || f.score > best.f.score) best = { e, f }; } if (!best || best.f.score < 1) continue; // a poor fit for the goal isn't a match
      // the neighbourhood counts too: "Flushing" puts a Flushing host above one elsewhere in Queens
      const hood = lc(city), hoodHit = !!hood && (lc(x.h.hood) === hood || lc(x.h.hood).includes(hood) || lc(x.h.city) === hood);
      const T = x.T, why = [...best.f.why]; let score = best.f.score + (where === "here" ? 4 : 0) + (hoodHit ? 2 : 0);
      if (T.bookings) { score += Math.min(3, T.bookings); } if (T.guests) score += Math.min(2, T.guests / 15); if (T.again?.pct != null) score += T.again.pct / 40; if (T.workedWith.length) score += 1; if (T.insurance.onFile) score += 0.5;
      let types = []; try { types = C.resonance(x.ws).types || []; } catch {}
      if (crowd) { const t = types.find((y) => y.type === crowd); if (t && t.share >= 15) { score += t.share / 20; why.push(`Popular with ${t.label}`); } }
      const e = best.e, pp = perPerson(e.price), est = pp && n ? (isFlat(e.price) ? { flat: true, perPerson: Math.round(pp / n), total: pp } : { perPerson: pp, total: Math.round(pp * n) }) : null;
      const r = { score, where, example: x.example, host: { person: x.person, handle: x.h.handle, name: x.h.name, emoji: x.h.emoji, color: x.h.theme?.accent || x.h.color, avatarArt: x.h.theme?.avatarArt || "", city: x.h.city, hood: x.h.hood, terms: x.h.terms || "", backupPlan: x.h.backupPlan || "", invoices: !!x.h.invoices, respondsIn: x.h.respondsIn || "" },
        experience: { id: e.id, name: e.name, desc: e.desc, emoji: e.emoji, min: e.min, max: e.max, length: e.length, travels: e.travels, category: categoryOf(e), price: e.price, allIn: e.allIn || "", instant: !!e.instant, runOfShow: e.runOfShow || [], includes: e.includes || [], branding: e.branding || "", access: e.access || "", dietary: e.dietary || "", hybrid: e.hybrid || "", setup: e.setup || "", seated: e.seated || 0, standing: e.standing || 0, av: e.av || "", owner: e.owner || "", openDates: C.openDatesOf(x.ws, e) },
        estimate: est, trust: lite(T), types, why: why.slice(0, 3) };
      (x.example ? ex : out).push(r); }
    out.sort((a, b) => b.score - a.score); ex.sort((a, b) => b.score - a.score);
    const results = out.slice(0, 3);
    return { goal, goalLabel: G.label, audience: AUDIENCE_WORD[G.audience], audienceKind: G.audience, results, available: out.length, examples: results.length < 3 ? ex.slice(0, 3 - results.length) : [], cityHosts, recruit: results.length < 3,
      cities: coverage(list), guarantee: "If your host can't make it, we find a replacement or refund you." }; }
  // a team vote on exactly the shortlist the organizer saw (real hosts only, never examples). Read and voted on through
  // /api/public/teams/saved/:id (server/community.js), which keeps the same stored shape.
  app.post("/api/public/teams/vote", small, (req, res) => { if (limited(req, 20)) return bad(res, "Slow down.", 429, "rate_limited"); const b = req.body || {}, q0 = b.query || {};
    const q = { city: clean(q0.city, 60), people: Math.max(0, Math.min(5000, +q0.people || 0)), goal: clean(q0.goal, 20), crowd: clean(q0.crowd, 20) }, M = teamMatch(q), want = Array.isArray(b.ids) ? b.ids.map((x) => clean(x, 40)) : [];
    const results = (want.length ? M.results.filter((r) => want.includes(r.experience.id)) : M.results).filter((r) => !r.example);
    if (!results.length) return bad(res, "Nothing to share yet.");
    const id = crypto.randomBytes(5).toString("hex"), by = clean(b.by, 60);
    if (b.team?.id) { const tp = "system/bteam-" + clean(b.team.id, 24), TT = store.get(tp)?.data; if (TT && TT.key === b.team.k) { TT.votes = [{ id, title: `${M.goalLabel || "Team event"}${q.people ? ` · ${q.people} guests` : ""}${q.city ? " · " + q.city : ""}`, by, at: Date.now() }, ...(TT.votes || [])].slice(0, 20); store.set(tp, TT); } }
    store.set("system/short-" + id, { kind: "shortlist", id, query: { ...q, goal: M.goal }, by, results, votes: {}, at: Date.now() }); res.json({ ok: true, id, url: `/teams/s/${id}` }); });
  function coverage(list) { const m = new Map(); for (const x of list) { if (x.example || !x.h.city) continue; const mi = metroOf(x.h.city) >= 0 ? metroOf(x.h.city) : metroOf(x.h.hood), k = mi >= 0 ? METRO_NAMES[mi] : x.h.city.trim(); m.set(k, (m.get(k) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]).map(([city, hosts]) => ({ city, hosts })); }
  // series form: host coverage per city before anyone submits, with a hybrid / remote kit fallback where there's no host
  app.get("/api/public/teams/series-coverage", (req, res) => { const L = String(req.query.cities || "").split(/[,;\n]/).map((c) => clean(c, 60)).filter(Boolean).slice(0, 12), { list } = bookable(), real = list.filter((x) => !x.example);
    const kits = []; for (const x of real) for (const e of x.h.experiences) if (e.hybrid && !/^not hybrid/i.test(e.hybrid) && /kit|mail|ship/i.test(e.hybrid)) kits.push({ host: x.h.name, handle: x.h.handle, name: e.name, price: e.price || "", perHead: perPerson(e.price) });
    kits.sort((a, b) => (a.perHead || 1e9) - (b.perHead || 1e9));
    res.json({ cities: L.map((c) => { const here = real.filter((x) => placeFit(c, x.h) !== "away"); return { city: c, hosts: here.length, names: here.slice(0, 3).map((x) => x.h.name), kit: here.length ? null : kits[0] ? { name: kits[0].name, host: kits[0].host, handle: kits[0].handle, price: kits[0].price || "quoted" } : { name: "Hybrid / remote kit", price: "quoted" } }; }) }); });
}
