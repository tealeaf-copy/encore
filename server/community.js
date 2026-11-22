// Community: invite-only membership, host pages people can follow, a Discover feed, and announcements.
// Hosts build a following (a "fan club") event by event; guests become hosts through invite codes.
import crypto from "node:crypto";
import { cleanShop } from "./shop.js";
import { scopeStore, getWorkspace, updateWorkspace, allWorkspaceIds, workspaceOfEvent, DEFAULT_WS, getDbUser } from "./workspaces.js";
import { emailConfig, sendEmail } from "./email.js";

export const inviteOnly = () => process.env.ENCORE_INVITE_ONLY === "1";
export const CODES_PER_MEMBER = 5;
const EMAIL_OK = (e) => typeof e === "string" && e.length <= 200 && /^[^\s@"<>()[\],;:]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(e);
const HANDLE_OK = (h) => /^[a-z0-9][a-z0-9-]{1,29}$/.test(h) && !/^(api|g|h|join|signup|login|discover|method|security|pricing|demo|admin|encore)$/.test(h);
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const URL_OK = (u) => !u || /^https:\/\/[^\s<>"]{3,300}$/i.test(u);
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
// Storefront choices: curated, so every page looks good and stays readable.
export const STORE = {
  accents: ["#E26D8E", "#C2553A", "#E0A030", "#3E9C6E", "#2F7A8A", "#5B7FD6", "#8C62C9", "#2B211C"],
  fonts: ["classic", "editorial", "modern", "playful", "handmade", "bold"],
  backgrounds: ["cream", "white", "blush", "sage", "night"],
  covers: ["wash", "sunrise", "dusk", "dots", "waves", "confetti", "plain"],
  buttons: ["round", "soft", "square"],
  avatars: ["", "chef", "runner", "barista", "baker", "glasses", "hiker"],
};
const BLOB_OK = (u) => !u || /^\/_blob\/[A-Za-z0-9]{20}$/.test(u);
const LINK_OK = (u) => /^https:\/\/[^\s<>"]{3,300}$/i.test(u || "");
function cleanTheme(t = {}, cur = {}) { const pick = (k, list) => (list.includes(t[k]) ? t[k] : list.includes(cur[k]) ? cur[k] : list[0]);
  return { accent: pick("accent", STORE.accents), font: pick("font", STORE.fonts), bg: pick("bg", STORE.backgrounds), cover: pick("cover", STORE.covers), buttons: pick("buttons", STORE.buttons), coverUrl: BLOB_OK(t.coverUrl ?? cur.coverUrl) ? t.coverUrl ?? cur.coverUrl ?? "" : cur.coverUrl || "", avatarUrl: BLOB_OK(t.avatarUrl ?? cur.avatarUrl) ? t.avatarUrl ?? cur.avatarUrl ?? "" : cur.avatarUrl || "", avatarArt: STORE.avatars.includes(t.avatarArt) ? t.avatarArt : STORE.avatars.includes(cur.avatarArt) ? cur.avatarArt : "" }; }
function cleanSections(s = {}, cur = {}) { const out = {}; for (const k of ["upcoming", "kudos", "photos", "hire", "tips", "profile", "past"]) out[k] = s[k] != null ? !!s[k] : cur[k] != null ? !!cur[k] : k !== "profile"; return out; }
// Experiences companies can book: "Private omakase for your team, 8 to 14, from $120 a person"
function cleanExperiences(L, cur) { if (!Array.isArray(L)) return cur || []; return L.slice(0, 6).map((x) => ({ id: /^[a-z0-9]{6,12}$/.test(x?.id || "") ? x.id : crypto.randomBytes(4).toString("hex"), name: clean(x?.name, 70), desc: clean(x?.desc, 280), emoji: clean(x?.emoji, 4), min: Math.max(1, Math.min(500, Math.round(+x?.min || 1))), max: Math.max(1, Math.min(1000, Math.round(+x?.max || 20))), price: clean(x?.price, 50), length: clean(x?.length, 40) })).filter((x) => x.name); }
function cleanLinks(L, cur) { if (!Array.isArray(L)) return cur || []; return L.slice(0, 4).map((x) => ({ label: clean(x?.label, 24), url: clean(x?.url, 300) })).filter((x) => x.label && LINK_OK(x.url)); }

function newCode() { const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = ""; const b = crypto.randomBytes(8); for (const x of b) s += A[x % A.length]; return s.slice(0, 4) + "-" + s.slice(4, 8); }

export function makeCommunity(store) {
  const sys = scopeStore(store, DEFAULT_WS); // codes, waitlist and handles live in the shared system area
  const codePath = (c) => "system/code-" + String(c).toUpperCase().replace(/[^A-Z0-9-]/g, "");
  const getCode = (c) => (c ? store.get(codePath(c))?.data || null : null);
  function issueCodes({ ws, email, name, n = CODES_PER_MEMBER }) {
    const out = []; for (let i = 0; i < n; i++) { const code = newCode(); store.set(codePath(code), { kind: "code", code, ownerWs: ws, ownerEmail: email, ownerName: name, createdAt: Date.now() }); out.push(code); }
    return out;
  }
  function codesOf(email) { return store.list("system").map((d) => d.data).filter((c) => c?.kind === "code" && c.ownerEmail === email).sort((a, b) => a.createdAt - b.createdAt); }
  function checkCode(code) {
    const founders = String(process.env.ENCORE_FOUNDER_CODES || "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
    if (code && founders.includes(String(code).toUpperCase())) return { ok: true, founder: true };
    const c = getCode(code); if (!c) return { ok: false, message: "That invite code doesn't exist. Check it with the person who sent it." };
    if (c.usedAt) return { ok: false, message: "That invite code has already been used. Ask for another one." };
    return { ok: true, c };
  }
  function useCode(code, { ws, email, name }) {
    const c = getCode(code); if (!c) return null;
    store.update(codePath(code), { usedAt: Date.now(), usedByEmail: email, usedByName: name, usedByWs: ws });
    // The two people are connected: each follows the other's host page.
    try { follow(c.ownerWs, { email, name, via: "invite" }); const inviter = getWorkspace(c.ownerWs); follow(ws, { email: c.ownerEmail, name: c.ownerName, via: "invite" }); scopeStore(store, c.ownerWs).add("audit", { eventId: "", what: `${first(name)} joined Encore with your invite code`, kind: "growth", at: Date.now() }); return inviter; } catch { return null; }
  }
  // ---- host pages ----
  const handlePath = (h) => "system/handle-" + h;
  function wsOfHandle(h) { return store.get(handlePath(String(h || "").toLowerCase()))?.data?.ws || null; }
  function profileOf(ws) { const W = getWorkspace(ws); return W?.host || null; }
  function setProfile(ws, p) {
    const W = getWorkspace(ws), cur = W?.host || {}, h = clean(p.handle ?? cur.handle, 30).toLowerCase();
    if (!HANDLE_OK(h)) return { error: "Pick a handle of 2–30 lowercase letters, numbers or dashes." };
    const owner = wsOfHandle(h); if (owner && owner !== ws) return { error: "That handle is taken. Try another." };
    for (const k of ["supportUrl", "fanclubUrl"]) if (!URL_OK(p[k] ?? cur[k])) return { error: "Links must start with https://" };
    if (Array.isArray(p.links) && p.links.some((x) => x?.url && !LINK_OK(String(x.url).trim()))) return { error: "Links must start with https://" };
    if (cur.handle && cur.handle !== h) store.delete(handlePath(cur.handle));
    store.set(handlePath(h), { ws });
    const host = { handle: h, name: clean(p.name ?? cur.name, 60), bio: clean(p.bio ?? cur.bio, 400), city: clean(p.city ?? cur.city, 60), hood: clean(p.hood ?? cur.hood, 60), tags: (Array.isArray(p.tags) ? p.tags : cur.tags || []).map((t) => clean(t, 24)).filter(Boolean).slice(0, 8), emoji: clean(p.emoji ?? cur.emoji ?? "🎉", 4), color: /^#[0-9a-f]{6}$/i.test(p.color || "") ? p.color : cur.color || "#E26D8E", supportUrl: clean(p.supportUrl ?? cur.supportUrl, 300), fanclubUrl: clean(p.fanclubUrl ?? cur.fanclubUrl, 300), fanclubPerks: clean(p.fanclubPerks ?? cur.fanclubPerks, 200),
      venmo: clean(p.venmo ?? cur.venmo, 40).replace(/^@/, "").replace(/[^A-Za-z0-9_-]/g, ""), paypal: clean(p.paypal ?? cur.paypal, 40).replace(/[^A-Za-z0-9_-]/g, ""), cashapp: clean(p.cashapp ?? cur.cashapp, 40).replace(/^\$/, "").replace(/[^A-Za-z0-9_-]/g, ""),
      theme: cleanTheme(p.theme || {}, cur.theme || {}), sections: cleanSections(p.sections || {}, cur.sections || {}), links: cleanLinks(p.links, cur.links), tagline: clean(p.tagline ?? cur.tagline, 90),
      shop: p.shop ? cleanShop(p.shop, cur.shop || {}) : cur.shop || null, experiences: cleanExperiences(p.experiences, cur.experiences),
      forHire: p.forHire != null ? !!p.forHire : !!cur.forHire, services: clean(p.services ?? cur.services, 400), rateNote: clean(p.rateNote ?? cur.rateNote, 120), updatedAt: Date.now() };
    updateWorkspace(ws, { host }); return { host };
  }
  // ---- followers (the fan club) ----
  function followersOf(ws) { return scopeStore(store, ws).list("followers").map((d) => d.data); }
  function follow(ws, { email, name, via = "page", tastes = [] }) {
    const S = scopeStore(store, ws), key = crypto.createHash("sha256").update(String(email).toLowerCase()).digest("hex").slice(0, 24), path = "followers/" + key, cur = S.get(path)?.data;
    S.set(path, { email: String(email).toLowerCase(), name: clean(name, 80) || cur?.name || "", via: cur?.via || via, tastes: [...new Set([...(cur?.tastes || []), ...tastes.map((t) => clean(t, 24))])].slice(0, 10), at: cur?.at || Date.now(), updatedAt: Date.now() });
    return !cur;
  }
  // ---- public events and discover ----
  const PUB = ["name", "pubTitle", "date", "startTime", "city", "headcount", "kind", "activity", "casual", "meetPoint", "theme", "price", "free", "tags", "emoji", "audienceWho", "approvalRequired", "stage", "earlyUntil", "courses", "dinnerTheme", "endTime", "hood"];
  function publicCard(id, e, host) { const o = Object.fromEntries(PUB.filter((k) => e[k] != null).map((k) => [k, e[k]])); return { id, ...o, title: e.pubTitle || e.name, host: host ? { handle: host.handle, name: host.name, emoji: host.emoji, color: host.color } : null }; }
  function eventsOf(ws, { upcoming = true, discoverableOnly = true } = {}) {
    const today = new Date().toISOString().slice(0, 10), host = profileOf(ws);
    return scopeStore(store, ws).list("events").map((d) => ({ id: d.id, e: d.data })).filter(({ e }) => e && !e.example && (!discoverableOnly || e.discoverable) && (upcoming ? (e.date || "9999") >= today : !!e.date && e.date < today && e.stage !== "interest")).sort((a, b) => String(a.e.date || "9").localeCompare(String(b.e.date || "9"))).map(({ id, e }) => publicCard(id, e, host));
  }
  function discover() {
    const hosts = [], events = [];
    for (const ws of allWorkspaceIds()) { const h = profileOf(ws); if (!h?.handle) continue; const up = eventsOf(ws), n = followersOf(ws).length, past = eventsOf(ws, { upcoming: false }).length;
      hosts.push({ ...h, followers: n, upcoming: up.length, hosted: past }); events.push(...up); }
    hosts.sort((a, b) => (b.followers + b.hosted * 2 + b.upcoming) - (a.followers + a.hosted * 2 + a.upcoming));
    events.sort((a, b) => String(a.date || "9").localeCompare(String(b.date || "9")));
    return { hosts: hosts.slice(0, 24), events: events.slice(0, 60) };
  }
  // ---- waitlist ----
  function addWaitlist(w) { const id = crypto.randomBytes(8).toString("hex"); store.set("system/wait-" + id, { kind: "wait", id, ...w, at: Date.now() }); return id; }
  function waitlist() { return store.list("system").map((d) => d.data).filter((x) => x?.kind === "wait" && !x.invitedAt).sort((a, b) => b.at - a.at); }
  return { issueCodes, codesOf, checkCode, useCode, getCode, wsOfHandle, profileOf, setProfile, followersOf, follow, eventsOf, discover, addWaitlist, waitlist, sys };
}

export function mountCommunity(app, { store, small, json, currentUser, sessionWorkspace, ownerOnly, signupLimited, publicOrigin, C }) {
  const hits = new Map(); const limited = (req, n = 20) => { const k = (req.ip || "?") + req.path, now = Date.now(); let h = hits.get(k); if (!h || now - h.start > 3600_000) { h = { n: 0, start: now }; hits.set(k, h); } return ++h.n > n; };
  const me = (req, res) => { const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) { res.status(401).json({ code: "unauthenticated", message: "Sign in first." }); return null; } return u; };
  app.get("/api/signup/config", (req, res) => res.json({ inviteOnly: inviteOnly() }));
  app.get("/api/codes/:code", (req, res) => { if (limited(req, 60)) return res.status(429).json({ code: "rate_limited", message: "Slow down." }); const r = C.checkCode(req.params.code); const host = r.c ? C.profileOf(r.c.ownerWs) : null; res.json({ valid: r.ok, ...(r.ok ? {} : { message: r.message }), ...(r.c ? { from: first(r.c.ownerName), host: host?.handle ? { handle: host.handle, name: host.name } : null } : {}) }); });
  app.get("/api/codes", (req, res) => { const u = me(req, res); if (!u) return; let L = C.codesOf(u.email); if (!L.length) { C.issueCodes({ ws: u.ws, email: u.email, name: u.name }); L = C.codesOf(u.email); }
    const o = publicOrigin(req); res.json({ codes: L.map((c) => ({ code: c.code, used: !!c.usedAt, usedBy: c.usedByName ? first(c.usedByName) : null, link: `${o}/join?code=${c.code}` })) }); });
  app.post("/api/waitlist", small, (req, res) => { if (limited(req, 5)) return res.status(429).json({ code: "rate_limited", message: "Too many requests from here." }); const b = req.body || {}, email = clean(b.email, 200).toLowerCase();
    if (!EMAIL_OK(email)) return res.status(400).json({ code: "invalid", message: "Give a valid email so a host can send you a code." }); C.addWaitlist({ name: clean(b.name, 80), email, city: clean(b.city, 60), wants: clean(b.wants, 140) }); res.json({ ok: true }); });
  // Members see who's waiting (first name, city, what they'd host) and can send one of their codes.
  app.get("/api/waitlist", (req, res) => { const u = me(req, res); if (!u) return; res.json({ waiting: C.waitlist().slice(0, 30).map((w) => ({ id: w.id, name: first(w.name) || "Someone", city: w.city, wants: w.wants, at: w.at })) }); });
  app.post("/api/waitlist/:id/invite", small, async (req, res) => { const u = me(req, res); if (!u) return; const w = store.get("system/wait-" + req.params.id)?.data; if (!w) return res.status(404).json({ code: "not_found", message: "They've already been invited." });
    const free = C.codesOf(u.email).find((c) => !c.usedAt && !c.sentTo); if (!free) return res.status(409).json({ code: "conflict", message: "You've used all your invites." });
    store.update("system/code-" + free.code, { sentTo: w.email, sentAt: Date.now() }); store.update("system/wait-" + w.id, { invitedAt: Date.now(), invitedBy: u.email });
    const link = `${publicOrigin(req)}/join?code=${free.code}`, cfg = emailConfig(u.ws, u.ws === DEFAULT_WS); let emailed = false;
    if (cfg) { try { const r = await sendEmail(cfg, { to: w.email, subject: `${first(u.name)} invited you to Encore`, text: `Hi ${first(w.name) || "there"},\n\n${first(u.name)} saw you'd like to host ${w.wants || "something"}${w.city ? ` in ${w.city}` : ""} and sent you an invite to Encore.\n\nYour code: ${free.code}\nJoin here: ${link}\n`, fromName: u.name }); emailed = !!r.ok; } catch {} }
    res.json({ ok: true, emailed, link, code: free.code }); });
  // Host page: the owner edits it; anyone can read it.
  app.get("/api/host/profile", (req, res) => { const u = me(req, res); if (!u) return; res.json({ host: C.profileOf(u.ws), followers: C.followersOf(u.ws).length }); });
  app.post("/api/host/profile", small, (req, res) => { const u = ownerOnly(req, res); if (!u) return; const r = C.setProfile(u.ws, req.body || {}); if (r.error) return res.status(400).json({ code: "invalid", message: r.error }); res.json({ ok: true, host: r.host, url: `${publicOrigin(req)}/h/${r.host.handle}` }); });
  app.get("/api/host/followers", (req, res) => { const u = me(req, res); if (!u) return; const F = C.followersOf(u.ws); res.json({ count: F.length, followers: F.slice(0, 500).map((f) => ({ name: f.name, email: f.email, via: f.via, tastes: f.tastes, at: f.at })) }); });
  app.get("/api/public/host/:handle", (req, res) => { const ws = C.wsOfHandle(req.params.handle); const h = ws && C.profileOf(ws); if (!h) return res.status(404).json({ code: "not_found", message: "No host by that name." });
    res.json({ person: first(getDbUser(getWorkspace(ws)?.ownerEmail || "")?.name || ""), host: h, followers: C.followersOf(ws).length, upcoming: C.eventsOf(ws), past: C.eventsOf(ws, { upcoming: false }).slice(-12).reverse() }); });
  app.post("/api/public/follow", small, (req, res) => { if (limited(req, 20)) return res.status(429).json({ code: "rate_limited", message: "Too many follows from here." }); const b = req.body || {}, ws = C.wsOfHandle(b.handle), email = clean(b.email, 200).toLowerCase();
    if (!ws) return res.status(404).json({ code: "not_found", message: "No host by that name." }); if (!EMAIL_OK(email)) return res.status(400).json({ code: "invalid", message: "Add your email so the host can tell you about the next one." });
    const isNew = C.follow(ws, { email, name: b.name, via: clean(b.via, 20) || "page", tastes: Array.isArray(b.tastes) ? b.tastes : [] }); if (isNew) scopeStore(store, ws).add("audit", { eventId: clean(b.eventId, 80), what: `${first(b.name) || "Someone"} followed you`, kind: "growth", at: Date.now() });
    res.json({ ok: true, followers: C.followersOf(ws).length }); });
  app.get("/api/public/discover", (req, res) => res.json(C.discover()));
  // The host of an event, for its guest page (name, handle, follower count).
  app.get("/api/public/event-host/:id", (req, res) => { const ws = workspaceOfEvent(req.params.id); const h = ws && C.profileOf(ws); const W0 = ws && getWorkspace(ws); res.json(h ? { person: first(W0?.ownerEmail ? getDbUser(W0.ownerEmail)?.name || "" : ""), host: { handle: h.handle, name: h.name, emoji: h.emoji, color: h.color, supportUrl: h.supportUrl, fanclubUrl: h.fanclubUrl, fanclubPerks: h.fanclubPerks, venmo: h.venmo, paypal: h.paypal, cashapp: h.cashapp }, followers: C.followersOf(ws).length } : { host: null }); });
  // Announce an event to followers (email when it's set up; otherwise a list to send yourself).
  app.post("/api/host/announce", small, async (req, res) => { const u = ownerOnly(req, res); if (!u) return; const id = clean(req.body?.eventId, 80), ev = scopeStore(store, u.ws).get("events/" + id)?.data; if (!ev) return res.status(404).json({ code: "not_found", message: "No such event." });
    const F = C.followersOf(u.ws), h = C.profileOf(u.ws), cfg = emailConfig(u.ws, u.ws === DEFAULT_WS), link = `${publicOrigin(req)}/g#rsvp-${id}`; let sent = 0;
    if (cfg) for (const f of F.slice(0, 500)) { try { const r = await sendEmail(cfg, { to: f.email, subject: `New from ${h?.name || u.name}: ${ev.pubTitle || ev.name}`, text: `Hi ${first(f.name) || "there"},\n\n${h?.name || u.name} is hosting ${ev.pubTitle || ev.name}${ev.date ? ` on ${ev.date}` : ""}${ev.city ? ` in ${ev.city}` : ""}.\n\nSay yes here: ${link}\n\nYou're getting this because you follow ${h?.name || "this host"} on Encore.`, fromName: h?.name || u.name }); if (r.ok) sent++; } catch {} }
    scopeStore(store, u.ws).add("audit", { eventId: id, what: `announced to ${F.length} followers${cfg ? ` (${sent} emailed)` : ""}`, kind: "growth", at: Date.now() });
    res.json({ ok: true, followers: F.length, emailed: sent, link }); });
}
