// Team up: hosts hosting together (the About page's "Host together: team up with other hosts").
//
// 1. Opt in. A host turns on "Open to teaming up" in Edit page, with a one-line pitch. Off by default, off any time.
// 2. Find. /hosts has a Team up view: open hosts ranked by the same neighbourhood or city, formats that go together
//    (a run and coffee or a bakery, a supper club and flowers or wine, a workshop and food) and guests in common, shown
//    only as a count ("12 of your guests follow them"). Potto picks 3 good matches and says why, from those facts only.
// 3. Ask. "Team up" on an open host's page (never your own, never to someone who blocked you or you blocked) opens a
//    short form: the idea (Potto drafts 2 or 3 joint ideas, POST /api/teamup/draft, through server/ai.js complete();
//    offline, with ENCORE_FAKE_AI=1 or no key, plain rules that only use what both pages say), dates, who does what,
//    cost and the money split, who it's for and a message. It reaches the other host by bell, email and push (the bell
//    pushes, server/push.js) and opens a private thread at /teamup/<id>. Emails and phone numbers stay out of it.
//    Statuses: sent, seen, replied, accepted, declined ("Not now" and "No thanks" both decline, gently).
// 4. Say yes. One tap makes a draft event in the asking host's planner, pre-filled from the idea, with the other host as
//    co-host (event.cohosts, so both are in the group chat, server/chat.js) and event.teamUp naming both. Either host
//    edits the plan from the thread; both hear about replies; the invite says "Hosted by Maya and Sam" with both faces
//    and Follow (public/sections.js); the event shows on both pages (community.js eventsOf), in both audiences' feeds
//    (social.js feed), kudos and recaps count for both (social.js hostStrengths, kudosask.js hostFirst), and the money
//    split shows in the plan's money view with each host's own Get paid methods (server/paymethods.js).
// 5. Collaborations on host pages (GET /api/public/teamup/:handle) and collab: true with partner names on joint events
//    (community.js publicCard) for the feed.
// 6. Safety: a weekly cap on requests, 30 days before you can ask again after a decline, block and report from the
//    thread (server/safety.js), requests off any time, and host to host only.
//
// Docs: system/teamup-pref-<ws> { open, pitch }, system/teamup-<id> (a request and its thread).
import crypto from "node:crypto";
import { scopeStore, getWorkspace, getDbUser, DEFAULT_WS, claimEvent } from "./workspaces.js";
import { complete, parseJsonLoose } from "./ai.js";
import { formatOf } from "./trends.js";
import { makeSafety } from "./safety.js";
import { emailConfig, sendEmail } from "./email.js";

const lc = (s) => String(s ?? "").trim().toLowerCase();
const clean = (v, n = 300) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, n);
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 864e5;
export const WEEKLY_CAP = () => Math.max(1, +process.env.ENCORE_TEAMUP_WEEKLY || 5);
export const COOLDOWN_DAYS = 30;
export const STATUSES = ["sent", "seen", "replied", "accepted", "declined"];
export const SPLITS = { "50-50": [50, 50], "60-40": [60, 40], "40-60": [40, 60], "70-30": [70, 30], "30-70": [30, 70], free: null, later: null };
export const AUDIENCES = { both: "Both our followers", mine: "My guests", theirs: "Their guests", invite: "Invite only" };
/** Contact details stay out of the thread until both hosts have met on the plan. */
export const hideContact = (t) => String(t || "").replace(/[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/gi, "(contact details hidden)").replace(/(?:\+?\d[\d ().-]{7,}\d)/g, "(contact details hidden)");

// ---- the joint event: what other files ask (pure, no store) ----
/** The hosts on a joint event: [{ handle, name, first, avatarArt, avatarUrl, accent }], two of them, or []. */
export const teamUpHosts = (e) => (Array.isArray(e?.teamUp?.hosts) ? e.teamUp.hosts.filter((h) => h && /^[a-z0-9][a-z0-9-]{1,29}$/.test(String(h.handle || ""))).slice(0, 2) : []);
/** Is this host (by handle) one of the hosts of this joint event? */
export const teamUpHas = (e, handle) => !!handle && teamUpHosts(e).some((h) => h.handle === lc(handle));
/** "Maya and Sam" for a joint event, "" otherwise. */
export const teamUpNames = (e) => { const H = teamUpHosts(e).map((h) => h.first || first(h.name)).filter(Boolean); return H.length === 2 ? `${H[0]} and ${H[1]}` : ""; };
/** The public part of event.teamUp, cleaned (server/app.js publicExtras). */
export function publicTeamUp(t) {
  const hosts = teamUpHosts({ teamUp: t }).map((h) => ({ handle: lc(h.handle), name: clean(h.name, 60), first: clean(h.first || first(h.name), 30), avatarArt: clean(h.avatarArt, 200), avatarUrl: /^(\/_blob\/[A-Za-z0-9_-]{6,80}|https:\/\/[^\s"<>()]+)$/.test(String(h.avatarUrl || "")) ? h.avatarUrl : "", accent: /^#[0-9a-f]{3,8}$/i.test(String(h.accent || "")) ? h.accent : "" }));
  return hosts.length === 2 ? { hosts } : undefined;
}
/** For the feed and cards (community.js publicCard): collab: true and the partner hosts' names. */
export const collabFlag = (e, ownerHandle) => { const H = teamUpHosts(e); if (H.length !== 2) return {}; return { collab: true, partners: H.filter((h) => h.handle !== lc(ownerHandle)).map((h) => ({ handle: h.handle, name: h.name })) }; };

// joint events where a workspace is the partner, not the owner (store-backed; set once mounted)
let STORE = null, WS_OF = () => null;
/** [[ownerWs, eventId]] for every accepted team-up where `ws` is the invited host. */
export function jointRefs(ws) { if (!STORE || !ws) return []; const out = [];
  for (const d of STORE.listPrefix("system", "teamup-")) { const r = d.data; if (r?.kind !== "teamup" || r.status !== "accepted" || !r.eventId) continue;
    if (r.toWs === ws) out.push([r.fromWs, r.eventId]); else if (r.fromWs === ws && r.eventWs && r.eventWs !== ws) out.push([r.eventWs, r.eventId]); }
  return out; }
/** The workspaces of a joint event's partner hosts (everyone but the owner). */
export const partnerWsOf = (e, ownerWs) => teamUpHosts(e).map((h) => WS_OF(h.handle)).filter((w) => w && w !== ownerWs);

// ---- matching ----
const LANES = {
  run: /\b(run|runs|running|runners?|5k|10k|jog|jogging|walk|walks|walking|hike|hikes)\b/,
  coffee: /coffee|matcha|espresso|caf[eé]|\btea\b|latte|roast/,
  bakery: /\bbak(e|es|er|ers|ery|ing)\b|pastr|bread|sourdough|croissant|cookies?\b|donut|bagel/,
  supper: /supper|dinner|tasting menu|chef'?s table|dinner party/,
  flowers: /flowers?|florist|floral|bouquet|ikebana|blooms?/,
  wine: /\bwines?\b|sommelier|natural wine|vino|cocktails?/,
  workshop: /workshop|\bclass(es)?\b|pottery|ceramic|clay|craft|paint|knit|candle|embroider|lesson/,
  food: /supper|dinner|food|cook|kitchen|dumpling|pasta|taco|pizza|brunch|\bbak(e|er|ery|ing)\b|pastr|bread|coffee|matcha|snack|chef/,
};
const NOUN = { run: "runs", coffee: "coffee", bakery: "baking", supper: "supper clubs", flowers: "flowers", wine: "wine", workshop: "workshops", food: "food" };
// formats that go together, and the plain line for each
export const PAIRS = [
  ["run", "coffee", "A run, then coffee"], ["run", "bakery", "A run that ends at the bakery"],
  ["supper", "flowers", "A supper club with flowers on the table"], ["supper", "wine", "A supper club with the wine poured"],
  ["workshop", "food", "A workshop with food after"],
];
/** What a host does, as lanes, from their page and their events' formats (server/trends.js formatOf). */
export function lanesOf(h, events = []) {
  const fm = events.map((e) => formatOf(e)).filter(Boolean).join(" ").replace(/-/g, " ");
  const t = lc([h?.name, h?.tagline, h?.bio, ...(h?.tags || []), ...(h?.experiences || []).map((x) => x?.name), ...events.map((e) => `${e.pubTitle || e.name || e.title || ""} ${e.activity || ""}`), fm].filter(Boolean).join(" "));
  return new Set(Object.keys(LANES).filter((k) => LANES[k].test(t)));
}
/** The formats that fit between two hosts: [{ a, b, line, text }] where a is mine and b is theirs. */
export function complements(mine, theirs) { const out = [];
  for (const [x, y, line] of PAIRS) { if (mine.has(x) && theirs.has(y) && !theirs.has(x)) out.push({ a: x, b: y, line, text: `your ${NOUN[x]} and their ${NOUN[y]}` });
    else if (mine.has(y) && theirs.has(x) && !mine.has(x)) out.push({ a: y, b: x, line, text: `your ${NOUN[y]} and their ${NOUN[x]}` }); }
  return out.slice(0, 2); }
const joinAnd = (L) => (L.length > 2 ? L.slice(0, -1).join(", ") + ", and " + L[L.length - 1] : L.join(" and "));
const cap1 = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** One match: where, what fits and the guests in common, with a score. Only facts both pages say. */
export function matchOf(me, them) {
  const reasons = [], hoodSame = !!me.hood && lc(me.hood) === lc(them.hood) && (!me.city || !them.city || lc(me.city) === lc(them.city)), citySame = !!me.city && lc(me.city) === lc(them.city);
  if (hoodSame) reasons.push({ k: "place", text: `You're both in ${them.hood}` }); else if (citySame) reasons.push({ k: "place", text: `You're both in ${them.city}` });
  const C = complements(me.lanes, them.lanes); for (const c of C) reasons.push({ k: "format", text: cap1(c.text), line: c.line });
  if (them.shared > 0) reasons.push({ k: "audience", text: `${them.shared} of your guests ${them.shared === 1 ? "follows" : "follow"} them` });
  const score = (hoodSame ? 4 : citySame ? 2 : 0) + 3 * C.length + Math.min(them.shared, 10) * 0.5 + (them.shared > 0 ? 1 : 0);
  return { score, reasons, idea: C[0]?.line || "" };
}
/** Potto's line for a pick, from the reasons only: "You're both in Greenpoint, your runs and their coffee, and 4 of your guests follow them." */
export function pickLine(reasons) { const L = reasons.map((r, i) => (i ? r.text[0].toLowerCase() + r.text.slice(1) : r.text)); return L.length ? joinAnd(L) + "." : ""; }

// ---- Potto's joint ideas ----
/** Offline ideas: plain rules over what both pages say, never a new fact. */
export function offlineConcepts(me, them, idea = "") {
  const C = complements(me.lanes, them.lanes), where = them.hood && lc(them.hood) === lc(me.hood) ? them.hood : them.city && lc(them.city) === lc(me.city) ? them.city : "";
  const a = first(me.name) || me.name, b = first(them.name) || them.name, out = [];
  const LINES = { "run|coffee": [`${a}'s run, then coffee with ${b}`, `${a} leads an easy run, ${b} has coffee ready at the end.`], "run|bakery": [`Run to the bakery`, `${a} leads the run, ${b} has something warm out of the oven at the finish.`],
    "supper|flowers": [`Supper with flowers`, `${a} cooks, ${b} makes the table flowers and everyone takes a stem home.`], "supper|wine": [`Supper and a pour`, `${a} cooks the courses, ${b} pours a wine with each.`],
    "workshop|food": [`Make something, then eat`, `A hands-on workshop, then food from the other host to finish.`] };
  for (const c of C) { const key = PAIRS.find((p) => (p[0] === c.a && p[1] === c.b) || (p[0] === c.b && p[1] === c.a)), L = key && LINES[key[0] + "|" + key[1]];
    if (L) out.push({ title: L[0], line: L[1] + (where ? ` In ${where}.` : "") }); }
  const t = clean(idea, 200); if (t) out.unshift({ title: cap1(t.split(/[.!?]/)[0].slice(0, 60)), line: `Your idea, hosted together: ${t.replace(/[.!?]?$/, ".")}` });
  out.push({ title: "Swap a night", line: `${a} hosts one with ${b} as co-host, then ${b} hosts the next one with ${a}. Both lists hear about both.` });
  out.push({ title: "One night, both crowds", line: `One small event for both your guests${where ? ` in ${where}` : ""}, each host bringing what they do best.` });
  const seen = new Set(); return out.filter((x) => { const k = lc(x.title); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 3);
}
export const draftPrompt = (me, them, idea) => `POTTO-TEAMUP
You are Potto, the helper in Pottery Lab. Two hosts want to host one small event together. Suggest 2 or 3 joint ideas.
Use only what is below. Never invent a place, a date, a price, a number of people, a brand or anything else that is not here.
Plain, warm words. No emoji. No dashes. Each title at most 6 words; each line one sentence, at most 25 words, naming who does what.
<host_a>${JSON.stringify({ name: me.name, city: me.city, hood: me.hood, does: [...me.lanes], tagline: me.tagline })}</host_a>
<host_b>${JSON.stringify({ name: them.name, city: them.city, hood: them.hood, does: [...them.lanes], tagline: them.tagline })}</host_b>
<idea>${clean(idea, 400)}</idea>
Reply with only JSON: {"concepts":[{"title":"...","line":"..."}]}`;
/** A model idea passes only if it is short, plain and names nothing the prompt didn't give. */
export function guardConcepts(L, me, them) {
  const known = lc([me.name, them.name, me.city, them.city, me.hood, them.hood, me.tagline, them.tagline].join(" "));
  return (Array.isArray(L) ? L : []).map((c) => ({ title: clean(c?.title, 60).replace(/[\u2014\u2013]/g, ","), line: clean(c?.line, 220).replace(/[\u2014\u2013]/g, ",") })).filter((c) => c.title && c.line && !/\$\s?\d|\d+\s?(people|guests|spots)|\p{Extended_Pictographic}/u.test(c.title + " " + c.line)
    && (c.title + " " + c.line).split(/\s+/).filter((w) => /^[A-Z][a-z]{2,}/.test(w) && !/^(A|An|The|One|Then|Both|Each|After|Before|Your|Their|Everyone|Make|Swap|Supper|Run|Coffee|Bring|Start|End|Finish|With|Host|Hosts)$/.test(w.replace(/[^A-Za-z]/g, ""))).every((w) => known.includes(lc(w.replace(/[^A-Za-z'’-]/g, "").replace(/['’]s$/, ""))))).slice(0, 3);
}

export function mountTeamUp(app, { store, small, currentUser, C, X, sendStatic, publicOrigin = () => "" }) {
  STORE = store; WS_OF = (h) => C.wsOfHandle(lc(h)) || null;
  const SF = makeSafety(store);
  const bad = (res, message, status = 400, code = "invalid", extra = {}) => res.status(status).json({ code, message, ...extra });
  const prefOf = (ws) => ({ open: false, pitch: "", ...(store.get("system/teamup-pref-" + ws)?.data || {}) });
  const ownerOf = (ws) => lc(getWorkspace(ws)?.ownerEmail);
  const isSample = (ws) => /@demo\.encore$/i.test(getWorkspace(ws)?.ownerEmail || "");
  // a host: a page of their own, not a guest-only account, not a brand team, not an example page
  const hostOf = (ws) => { const h = ws && C.profileOf(ws), W = ws && getWorkspace(ws); return h?.handle && W && !W.regularOnly && W.personal !== false && (!W.plan || W.plan === "friends") && !isSample(ws) ? h : null; };
  const card = (ws) => { const h = C.profileOf(ws); if (!h?.handle) return null; const nm = first(getDbUser(ownerOf(ws))?.name);
    return { handle: h.handle, name: h.name || "@" + h.handle, first: nm || first(h.name), city: h.city || "", hood: h.hood || "", avatarArt: h.theme?.avatarArt || "", avatarUrl: /^(\/_blob\/[A-Za-z0-9_-]{6,80}|https:\/\/[^\s"<>()]+)$/.test(h.theme?.avatarUrl || "") ? h.theme.avatarUrl : "", accent: h.theme?.accent || h.color || "", emoji: h.emoji || "" }; };
  const me = (req, res, { host = true } = {}) => { const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) { bad(res, "Sign in to team up.", 401, "unauthenticated"); return null; }
    if (host && !hostOf(u.ws)) { bad(res, "Team up is for hosts. Start your page first.", 403, "host_page_required"); return null; } return u; };
  const blockedBetween = (wsA, wsB) => { const a = C.profileOf(wsA)?.handle, b = C.profileOf(wsB)?.handle;
    return SF.blocksOf(ownerOf(wsA)).some((x) => x.target === "host:" + b) || SF.blocksOf(ownerOf(wsB)).some((x) => x.target === "host:" + a); };
  const all = () => store.listPrefix("system", "teamup-").map((d) => d.data).filter((r) => r?.kind === "teamup");
  const get = (id) => { const r = store.get("system/teamup-" + String(id || "").replace(/[^a-f0-9]/g, "").slice(0, 24))?.data; return r?.kind === "teamup" ? r : null; };
  const put = (r) => { r.updatedAt = Date.now(); store.set("system/teamup-" + r.id, r); return r; };
  const pairOf = (a, b) => all().filter((r) => (r.fromWs === a && r.toWs === b) || (r.fromWs === b && r.toWs === a)).sort((x, y) => y.at - x.at);
  const openReq = (a, b) => pairOf(a, b).find((r) => ["sent", "seen", "replied"].includes(r.status));
  const cooldownUntil = (fromWs, toWs) => { const d = pairOf(fromWs, toWs).find((r) => r.fromWs === fromWs && r.status === "declined"); const until = d ? (d.decidedAt || d.at) + COOLDOWN_DAYS * DAY : 0; return until > Date.now() ? until : 0; };
  const sentThisWeek = (ws) => all().filter((r) => r.fromWs === ws && Date.now() - r.at < 7 * DAY).length;
  const eventsOf = (ws) => { try { return scopeStore(store, ws).list("events").map((d) => d.data).filter((e) => e && !e.example && !e.sample); } catch { return []; } };
  const profile = (ws) => { const h = C.profileOf(ws) || {}; return { name: h.name || "", city: h.city || "", hood: h.hood || "", tagline: h.tagline || "", lanes: lanesOf(h, eventsOf(ws).slice(-30)) }; };
  // my guests: everyone who said I'm in to one of my events (emails, never shown; only the count leaves)
  const guestsOf = (ws) => { const S = new Set(); try { const St = scopeStore(store, ws); for (const d of St.listShared ? St.listShared("rsvps") : St.list("rsvps")) { const r = d.data || {}; if (r.response === "going" && r.email) S.add(lc(r.email)); } } catch {} return S; };
  const sharedCount = (guests, ws) => { if (!guests.size) return 0; let n = 0; for (const f of C.followersOf(ws) || []) if (f?.email && guests.has(lc(f.email)) && lc(f.email) !== ownerOf(ws)) n++; return n; };
  const niceDate = (d) => (ISO.test(d) ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "");
  const mailCfg = () => emailConfig(DEFAULT_WS, true);
  const tell = async (req, toWs, n, { subject, body } = {}) => { const to = ownerOf(toWs); if (!to) return; X?.notify?.(to, { kind: "teamup", ...n });
    const cfg = subject && mailCfg(); if (cfg && (X?.canEmail ? X.canEmail(to) : true)) { try { await sendEmail(cfg, { to, subject, text: `${body}\n\n${publicOrigin(req)}${n.link}\n`, fromName: "Pottery Lab" }); } catch {} } };

  // ---- 1. opt in ----
  app.get("/api/teamup/me", (req, res) => { const u = currentUser(req); res.set("Cache-Control", "private, no-store"); if (!u || u.ws === DEFAULT_WS) return res.json({ signedIn: false, host: false });
    const h = hostOf(u.ws); res.json({ signedIn: true, host: !!h, handle: h?.handle || "", pref: prefOf(u.ws), sentThisWeek: sentThisWeek(u.ws), cap: WEEKLY_CAP(), blocked: SF.blocksOf(lc(u.email)).filter((b) => b.target.startsWith("host:")).map((b) => ({ handle: b.target.slice(5), name: b.name })) }); });
  app.post("/api/teamup/me", small, (req, res) => { const u = me(req, res); if (!u) return; const b = req.body || {}, cur = prefOf(u.ws);
    const next = { kind: "teamup-pref", ws: u.ws, open: b.open != null ? !!b.open : cur.open, pitch: b.pitch != null ? clean(b.pitch, 120) : cur.pitch, at: Date.now() };
    store.set("system/teamup-pref-" + u.ws, next); res.json({ ok: true, pref: { open: next.open, pitch: next.pitch } }); });
  app.post("/api/teamup/unblock", small, (req, res) => { const u = me(req, res, { host: false }); if (!u) return; const h = lc(req.body?.handle).replace(/^@/, ""); res.json({ ok: true, removed: SF.unblock(lc(u.email), "host:" + h) }); });

  // ---- 2. find ----
  app.get("/api/teamup/matches", (req, res) => { res.set("Cache-Control", "private, no-store"); const u = currentUser(req), mine = u && u.ws !== DEFAULT_WS ? hostOf(u.ws) : null;
    const open = store.listPrefix("system", "teamup-pref-").map((d) => d.data).filter((p) => p?.open && p.ws && hostOf(p.ws));
    if (!mine) return res.json({ signedIn: !!(u && u.ws !== DEFAULT_WS), host: false, openCount: open.length, hosts: [], picks: [] });
    const meP = profile(u.ws), guests = guestsOf(u.ws), hosts = [];
    for (const p of open) { if (p.ws === u.ws || blockedBetween(u.ws, p.ws)) continue; const c = card(p.ws); if (!c) continue;
      const them = { ...profile(p.ws), shared: sharedCount(guests, p.ws) }, m = matchOf(meP, them), o = openReq(u.ws, p.ws);
      hosts.push({ ...c, pitch: p.pitch || "", score: m.score, reasons: m.reasons.map((r) => r.text), idea: m.idea, shared: them.shared, pending: o ? { id: o.id, status: o.status, mine: o.fromWs === u.ws } : null, cooldownUntil: cooldownUntil(u.ws, p.ws) || 0 }); }
    hosts.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const picks = hosts.filter((h) => h.score >= 3 && (h.idea || h.shared > 0 || h.score >= 4)).slice(0, 3) /* a good match is more than the same city */.map((h) => ({ handle: h.handle, why: pickLine(h.reasons.map((text) => ({ text }))) }));
    res.json({ signedIn: true, host: true, handle: mine.handle, open: prefOf(u.ws).open, openCount: open.length, hosts: hosts.slice(0, 60), picks }); });

  // ---- 3. ask ----
  // what a visitor's page shows: Team up for another host who is open, nothing for anyone else (blocked people never see it)
  app.get("/api/teamup/with/:handle", (req, res) => { res.set("Cache-Control", "private, no-store"); const ws = C.wsOfHandle(lc(req.params.handle)), h = ws && hostOf(ws), u = currentUser(req), P = ws ? prefOf(ws) : { open: false };
    if (!h || !P.open) return res.json({ show: false });
    if (!u || u.ws === DEFAULT_WS) return res.json({ show: false, signIn: true });
    if (u.ws === ws) return res.json({ show: false, own: true });
    if (!hostOf(u.ws) || blockedBetween(u.ws, ws)) return res.json({ show: false });
    const o = openReq(u.ws, ws), until = cooldownUntil(u.ws, ws), left = Math.max(0, WEEKLY_CAP() - sentThisWeek(u.ws));
    res.json({ show: true, pitch: P.pitch || "", host: card(ws), me: card(u.ws), pending: o ? { id: o.id, status: o.status, mine: o.fromWs === u.ws } : null, cooldownUntil: until, left, cap: WEEKLY_CAP() }); });
  const hits = new Map(); const limited = (k, n) => { const now = Date.now(), L = (hits.get(k) || []).filter((t) => now - t < 3600e3); L.push(now); hits.set(k, L); if (hits.size > 20000) hits.clear(); return L.length > n; };
  app.post("/api/teamup/draft/:handle", small, async (req, res) => { const u = me(req, res); if (!u) return; const ws = C.wsOfHandle(lc(req.params.handle));
    if (!ws || !hostOf(ws) || ws === u.ws || blockedBetween(u.ws, ws)) return bad(res, "No host by that name.", 404, "not_found");
    if (limited("d:" + u.ws, 30)) return bad(res, "That's a lot of ideas this hour. Try again in a bit.", 429, "rate_limited");
    const meP = { ...profile(u.ws), name: card(u.ws).first || card(u.ws).name }, them = { ...profile(ws), name: card(ws).first || card(ws).name }, idea = clean(req.body?.idea, 400);
    let concepts = [], source = "offline";
    try { const r = await complete({ prompt: draftPrompt(meP, them, idea), effort: "low" }); const j = parseJsonLoose(r.text); concepts = guardConcepts(j?.concepts, meP, them); if (concepts.length >= 2) source = "potto"; } catch {}
    if (concepts.length < 2) { concepts = offlineConcepts(meP, them, idea); source = "offline"; }
    res.json({ concepts, source }); });
  app.post("/api/teamup/request/:handle", small, async (req, res) => { const u = me(req, res); if (!u) return; const ws = C.wsOfHandle(lc(req.params.handle)), to = ws && hostOf(ws);
    if (!to) return bad(res, "No host by that name.", 404, "not_found");
    if (ws === u.ws) return bad(res, "That's your own page.");
    if (blockedBetween(u.ws, ws) || !prefOf(ws).open) return bad(res, `${to.name} isn't taking team-up requests right now.`, 403, "closed");
    if (openReq(u.ws, ws)) return bad(res, `You already have a team-up open with ${to.name}. Pick it up in your thread.`, 409, "conflict", { id: openReq(u.ws, ws).id });
    const until = cooldownUntil(u.ws, ws); if (until) return bad(res, `${to.name} said not now. You can ask again from ${niceDate(new Date(until).toISOString().slice(0, 10))}.`, 429, "cooldown", { until });
    if (sentThisWeek(u.ws) >= WEEKLY_CAP()) return bad(res, `That's ${WEEKLY_CAP()} team-up requests this week. You can send more next week.`, 429, "weekly_cap");
    const b = req.body || {}, idea = hideContact(clean(b.idea, 600)), message = hideContact(clean(b.message, 1000));
    if (idea.length < 8) return bad(res, "Say a bit more about the idea.", 400, "invalid", { field: "idea" });
    const dates = (Array.isArray(b.dates) ? b.dates : []).map((d) => String(d || "")).filter((d) => ISO.test(d) && d >= new Date().toISOString().slice(0, 10)).slice(0, 3);
    const split = Object.prototype.hasOwnProperty.call(SPLITS, b.split) ? b.split : "later", audience = AUDIENCES[b.audience] ? b.audience : "both";
    const r = { kind: "teamup", id: crypto.randomBytes(8).toString("hex"), fromWs: u.ws, toWs: ws, from: card(u.ws), to: card(ws), idea, title: clean(b.title, 70), dates, roles: { from: hideContact(clean(b.mine, 200)), to: hideContact(clean(b.theirs, 200)) },
      cost: clean(b.cost, 80), split, audience, status: "sent", at: Date.now(), thread: message ? [{ by: "from", text: message, at: Date.now() }] : [] };
    put(r);
    await tell(req, ws, { key: "tu-" + r.id, text: `${r.from.first || r.from.name} wants to team up: ${(r.title || idea).slice(0, 110)}`, link: `/teamup/${r.id}` }, { subject: `${r.from.name} wants to team up`, body: `${r.from.name} (/@${r.from.handle} on Pottery Lab) would like to host something with you.\n\nThe idea: ${idea}${dates.length ? `\nDates: ${dates.map(niceDate).join(", ")}` : ""}\n\nRead it and reply on Pottery Lab. Your contact details stay hidden.` });
    res.json({ ok: true, id: r.id, left: Math.max(0, WEEKLY_CAP() - sentThisWeek(u.ws)) }); });

  // ---- the thread ----
  const STATUS_LINE = { sent: "Sent", seen: "Seen", replied: "Replied", accepted: "Accepted", declined: "Declined" };
  const money = async (r) => { const sp = SPLITS[r.split]; let pm = null; try { pm = await import("./paymethods.js"); } catch {}
    const methods = (ws) => { if (!pm) return []; const p = pm.payOfWs(ws); return ["venmo", "paypal", "cashapp", "link"].filter((k) => p[k]).map((k) => ({ k, label: pm.PAY_LABEL[k], handle: k === "link" ? "" : p[k], url: k === "link" ? p.link : pm.profileUrl(k, p[k]) })).concat(p.note ? [{ k: "note", label: "Note", handle: p.note, url: "" }] : []); };
    return { cost: r.cost || "", split: r.split, shares: sp ? { from: sp[0], to: sp[1] } : null, splitLine: sp ? `${r.from.first || r.from.name} ${sp[0]}%, ${r.to.first || r.to.name} ${sp[1]}%` : r.split === "free" ? "It's free. No money to split." : "You'll work out the split together.", methods: { from: methods(r.fromWs), to: methods(r.toWs) } }; };
  const eventOf = (r) => { if (!r.eventId) return null; const e = scopeStore(store, r.eventWs || r.fromWs).get("events/" + r.eventId)?.data; if (!e) return null;
    return { id: r.eventId, title: e.pubTitle || e.name || "", date: e.date || "", startTime: e.startTime || "", place: e.venueName || e.meetPoint || "", city: e.city || "", why: e.why || "", live: !!e.published, discoverable: !!e.discoverable, cancelled: !!e.cancelled, ownerHandle: r.from.handle }; };
  const view = async (r, ws) => { const mineIn = r.toWs === ws, other = mineIn ? r.from : r.to, ev = eventOf(r);
    return { id: r.id, incoming: mineIn, other: card(mineIn ? r.fromWs : r.toWs) || other, me: card(ws), status: r.status, statusLine: STATUS_LINE[r.status], declineKind: r.declineKind || "", idea: r.idea, title: r.title, dates: r.dates, datesLine: r.dates.map(niceDate).join(", "), roles: mineIn ? { me: r.roles.to, them: r.roles.from } : { me: r.roles.from, them: r.roles.to },
      cost: r.cost, split: r.split, audience: r.audience, audienceLine: AUDIENCES[r.audience] || "", at: r.at, decidedAt: r.decidedAt || 0, thread: (r.thread || []).map((m) => ({ mine: (m.by === "to") === mineIn, name: m.by === "to" ? r.to.first || r.to.name : r.from.first || r.from.name, text: m.text, at: m.at })),
      event: ev, owner: !mineIn, money: r.status === "accepted" ? await money(r) : null, announced: !!(r.announced || {})[mineIn ? "to" : "from"],
      cooldownUntil: !mineIn && r.status === "declined" ? (r.decidedAt || r.at) + COOLDOWN_DAYS * DAY : 0, editLink: ev && !mineIn ? `/?app=1&open=${encodeURIComponent(ev.id)}#studio` : "", chatLink: ev ? `/chats/${encodeURIComponent(ev.id)}` : "" }; };
  const mineR = (req, res) => { const u = me(req, res, { host: false }); if (!u) return null; const r = get(req.params.id); if (!r || (r.fromWs !== u.ws && r.toWs !== u.ws)) { bad(res, "We can't find that team-up.", 404, "not_found"); return null; } return { u, r }; };
  app.get("/api/teamup/requests", async (req, res) => { const u = me(req, res, { host: false }); if (!u) return; res.set("Cache-Control", "private, no-store");
    const L = all().filter((r) => r.fromWs === u.ws || r.toWs === u.ws).sort((a, b) => (b.updatedAt || b.at) - (a.updatedAt || a.at)), V = []; for (const r of L.slice(0, 60)) V.push(await view(r, u.ws));
    res.json({ incoming: V.filter((v) => v.incoming), sent: V.filter((v) => !v.incoming), pref: prefOf(u.ws) }); });
  app.get("/api/teamup/requests/:id", async (req, res) => { res.set("Cache-Control", "private, no-store"); const u0 = currentUser(req), r0 = get(req.params.id);
    if (u0 && u0.ws !== DEFAULT_WS && (!r0 || (r0.fromWs !== u0.ws && r0.toWs !== u0.ws))) return res.json({ teamup: null, code: "not_found" }); // the page says it plainly; not a failed request
    const M = mineR(req, res); if (!M) return; res.set("Cache-Control", "private, no-store"); const { u, r } = M;
    if (r.toWs === u.ws && r.status === "sent") { r.status = "seen"; r.seenAt = Date.now(); put(r); }
    res.json({ teamup: await view(r, u.ws) }); });
  app.post("/api/teamup/requests/:id", small, async (req, res) => { const M = mineR(req, res); if (!M) return; const { u, r } = M, b = req.body || {}, act = String(b.action || ""), mineIn = r.toWs === u.ws, otherWs = mineIn ? r.fromWs : r.toWs, who = mineIn ? r.to : r.from, whoN = who.first || who.name, link = `/teamup/${r.id}`;
    const live = ["sent", "seen", "replied"].includes(r.status);
    if (act === "message") { if (r.status === "declined") return bad(res, "This one's closed.", 409, "closed"); if (blockedBetween(u.ws, otherWs)) return bad(res, "You can't message this host.", 403, "blocked");
      const text = hideContact(clean(b.text, 1000)); if (!text) return bad(res, "Write a message first.");
      r.thread = [...(r.thread || []), { by: mineIn ? "to" : "from", text, at: Date.now() }].slice(-100); if (mineIn && (r.status === "sent" || r.status === "seen")) r.status = "replied"; put(r);
      await tell(req, otherWs, { key: `tu-${r.id}-${r.thread.length}`, text: `${whoN} on your team-up: ${text.slice(0, 110)}`, link }); }
    else if (act === "accept") { if (!mineIn) return bad(res, "Only the host you asked can say yes.", 403, "forbidden"); if (!live) return bad(res, "This one's already answered.", 409, "conflict");
      r.status = "accepted"; r.decidedAt = Date.now(); r.eventWs = r.fromWs; r.eventId = draftEvent(r); put(r);
      await tell(req, otherWs, { key: `tu-${r.id}-yes`, text: `${whoN} said yes to teaming up. Your draft is ready: ${(r.title || r.idea).slice(0, 80)}`, link }, { subject: `${who.name} said yes to teaming up`, body: `Good news: ${who.name} wants to host it with you. There's a draft event in your planner with both of you as hosts. Plan it together in your thread.` }); }
    else if (act === "notnow" || act === "decline") { if (!mineIn) return bad(res, "Only the host you asked can answer.", 403, "forbidden"); if (!live) return bad(res, "This one's already answered.", 409, "conflict");
      r.status = "declined"; r.declineKind = act === "notnow" ? "notnow" : "nothanks"; r.decidedAt = Date.now(); put(r);
      await tell(req, otherWs, { key: `tu-${r.id}-no`, text: act === "notnow" ? `${whoN} can't do this one right now. Thanks for asking.` : `${whoN} is going to pass on this one. Thanks for asking.`, link }); }
    else if (act === "withdraw") { if (mineIn) return bad(res, "Only the host who asked can take it back.", 403, "forbidden"); if (!live) return bad(res, "This one's already answered.", 409, "conflict"); r.status = "declined"; r.declineKind = "withdrawn"; r.decidedAt = Date.now(); put(r); }
    else if (act === "block") { const oh = card(otherWs); SF.block(lc(u.email), { kind: "host", handle: oh?.handle, name: oh?.name }); if (live) { r.status = "declined"; r.declineKind = "blocked"; r.decidedAt = Date.now(); } put(r); }
    else return bad(res, "Unknown action.");
    res.json({ ok: true, teamup: await view(r, u.ws) }); });

  // ---- 4. the draft event, made on yes ----
  function draftEvent(r) { const S = scopeStore(store, r.fromWs); let id = "tu" + crypto.randomBytes(6).toString("base64url").replace(/[^A-Za-z0-9]/g, "x"); while (!claimEvent(id, r.fromWs)) id = "tu" + crypto.randomBytes(6).toString("hex");
    const A = card(r.fromWs) || r.from, B = card(r.toWs) || r.to, title = r.title || clean(r.idea.split(/[.!?\n]/)[0], 70) || "Hosted together", hosts = [A, B].map((h) => ({ handle: h.handle, name: h.name, first: h.first, avatarArt: h.avatarArt, avatarUrl: h.avatarUrl, accent: h.accent }));
    const roles = [r.roles.from && `${A.first || A.name}: ${r.roles.from}`, r.roles.to && `${B.first || B.name}: ${r.roles.to}`].filter(Boolean).join("\n"), now = Date.now();
    const doc = { id, name: title, pubTitle: title, why: lc(r.idea).replace(/[.!?\s]+$/, "") === lc(title).replace(/[.!?\s]+$/, "") ? "" : r.idea, date: r.dates[0] || "", ...(r.dates.length > 1 ? { dateOptions: r.dates } : {}), city: A.city || B.city || "", cohosts: [{ handle: B.handle, name: B.name }], teamUp: { id: r.id, hosts, split: r.split, cost: r.cost, audience: r.audience },
      ...(roles ? { sections: [{ icon: "people", title: "Who's doing what", body: roles }] } : {}), published: false, discoverable: false, createdAt: now, updatedAt: now, fromTeamUp: r.id };
    if (doc.dateOptions) delete doc.date; // a date poll, not a fixed date
    S.set("events/" + id, doc); return id; }
  // either host edits the joint plan from the thread
  app.post("/api/teamup/requests/:id/event", small, (req, res) => { const M = mineR(req, res); if (!M) return; const { r } = M; if (r.status !== "accepted" || !r.eventId) return bad(res, "Say yes first, then plan it together.", 409, "conflict");
    const S = scopeStore(store, r.eventWs || r.fromWs), cur = S.get("events/" + r.eventId)?.data; if (!cur) return bad(res, "The event isn't there any more.", 404, "not_found");
    const b = req.body || {}, next = { ...cur };
    if (b.title != null) { const t = clean(b.title, 90); if (!t) return bad(res, "Give it a name.", 400, "invalid", { field: "title" }); next.name = t; next.pubTitle = t; }
    if (b.date != null) { const d = String(b.date); if (d && !ISO.test(d)) return bad(res, "Pick a date from the calendar.", 400, "invalid", { field: "date" }); next.date = d; if (d) delete next.dateOptions; }
    if (b.startTime != null) { const t = String(b.startTime); if (t && !/^\d{2}:\d{2}$/.test(t)) return bad(res, "Pick a time.", 400, "invalid", { field: "startTime" }); next.startTime = t; }
    if (b.place != null) next.venueName = clean(b.place, 120);
    if (b.city != null) next.city = clean(b.city, 80);
    if (b.why != null) next.why = clean(b.why, 2000);
    next.updatedAt = Date.now(); S.set("events/" + r.eventId, next); r.updatedAt = Date.now(); put(r);
    res.json({ ok: true, event: eventOf(r) }); });
  // each host tells their own followers once the event is live: both audiences hear about it
  app.post("/api/teamup/requests/:id/announce", small, async (req, res) => { const M = mineR(req, res); if (!M) return; const { u, r } = M, side = r.toWs === u.ws ? "to" : "from", ev = eventOf(r);
    if (!ev || !ev.live) return bad(res, "Share it once the event is live.", 409, "not_live"); if ((r.announced || {})[side]) return res.json({ ok: true, told: 0, already: true });
    const F = (C.followersOf(u.ws) || []).filter((f) => f?.email && f.notify !== false).slice(0, 500), names = teamUpNames(scopeStore(store, r.eventWs || r.fromWs).get("events/" + r.eventId)?.data) || card(u.ws).name, cfg = mailCfg(); let told = 0;
    for (const f of F) { if (X?.notify?.(lc(f.email), { kind: "alert", key: `tu-ann-${r.id}-${side}`, text: `New from ${names}: ${ev.title}${ev.date ? `, ${niceDate(ev.date)}` : ""}.`, link: `/g#rsvp-${ev.id}`, eventId: ev.id }) !== false) told++;
      if (cfg && (X?.canEmail ? X.canEmail(f.email) : true)) { try { await sendEmail(cfg, { list: "guest", origin: publicOrigin(req), to: f.email, subject: `New from ${names}: ${ev.title}`, text: `Hi ${first(f.name) || "there"},\n\n${names} are hosting ${ev.title} together${ev.date ? ` on ${niceDate(ev.date)}` : ""}.\n\nAre you in? ${publicOrigin(req)}/g#rsvp-${ev.id}\n`, fromName: "Pottery Lab" }); } catch {} } }
    r.announced = { ...(r.announced || {}), [side]: Date.now() }; put(r); res.json({ ok: true, told }); });

  // ---- 5. Collaborations on a host page ----
  app.get("/api/public/teamup/:handle", (req, res) => { const ws = C.wsOfHandle(lc(req.params.handle)); if (!ws) return res.json({ collaborations: [] });
    const today = new Date().toISOString().slice(0, 10), by = new Map();
    for (const r of all().filter((x) => x.status === "accepted" && (x.fromWs === ws || x.toWs === ws)).sort((a, b) => (b.decidedAt || 0) - (a.decidedAt || 0))) {
      const ow = r.fromWs === ws ? r.toWs : r.fromWs, c = card(ow); if (!c || blockedBetween(ws, ow)) continue; const e = r.eventId ? scopeStore(store, r.eventWs || r.fromWs).get("events/" + r.eventId)?.data : null;
      const k = c.handle, cur = by.get(k) || { partner: c, events: [] }; if (e && e.discoverable && e.published && !e.cancelled && !e.unlisted) cur.events.push({ id: r.eventId, title: e.pubTitle || e.name || "", date: e.date || "", upcoming: (e.date || "9") >= today }); by.set(k, cur); }
    res.json({ collaborations: [...by.values()].slice(0, 8) }); });

  // ---- the thread page ----
  app.get(["/teamup", "/teamup/:id"], (req, res) => sendStatic(res, "teamup.html", "<p>Team up page missing.</p>"));
  return { prefOf, jointRefs, teamUpHas, partnerWsOf: (e, w) => partnerWsOf(e, w),
    /** both hosts hear about replies on a joint event (server/app.js afterRsvp) */
    onReply(ws, ev, n) { for (const w of partnerWsOf(ev, ws)) { const to = ownerOf(w); if (to && n?.text) X?.notify?.(to, { ...n, key: (n.key || "r") + "-tu", link: ev.fromTeamUp ? `/teamup/${ev.fromTeamUp}` : n.link }); } },
    /** kudos for a joint event reach both hosts (server/social.js) */
    onKudos(ws, ev, n) { this.onReply(ws, ev, n); } };
}
