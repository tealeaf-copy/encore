// Community: invite-only membership, host pages people can follow, a Discover feed, and announcements.
// Hosts build a following (a "fan club") event by event; guests become hosts through invite codes.
import crypto from "node:crypto";
import { cleanShop } from "./shop.js";
import { scopeStore, getWorkspace, updateWorkspace, allWorkspaceIds, workspaceOfEvent, DEFAULT_WS, getDbUser } from "./workspaces.js";
import { emailConfig, sendEmail } from "./email.js";
import { smsConfig, sendSms } from "./sms.js";

export const inviteOnly = () => process.env.ENCORE_INVITE_ONLY === "1";
export const CODES_PER_MEMBER = 10;
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
  avatars: ["", "chef", "runner", "barista", "baker", "glasses", "hiker", "florist", "curls", "bob"],
};
const BLOB_OK = (u) => !u || /^\/_blob\/[A-Za-z0-9]{20}$/.test(u);
const LINK_OK = (u) => /^https:\/\/[^\s<>"]{3,300}$/i.test(u || "");
function cleanTheme(t = {}, cur = {}) { const pick = (k, list) => (list.includes(t[k]) ? t[k] : list.includes(cur[k]) ? cur[k] : list[0]);
  return { accent: pick("accent", STORE.accents), font: pick("font", STORE.fonts), bg: pick("bg", STORE.backgrounds), cover: pick("cover", STORE.covers), buttons: pick("buttons", STORE.buttons), coverUrl: BLOB_OK(t.coverUrl ?? cur.coverUrl) ? t.coverUrl ?? cur.coverUrl ?? "" : cur.coverUrl || "", avatarUrl: BLOB_OK(t.avatarUrl ?? cur.avatarUrl) ? t.avatarUrl ?? cur.avatarUrl ?? "" : cur.avatarUrl || "", avatarArt: STORE.avatars.includes(t.avatarArt) ? t.avatarArt : STORE.avatars.includes(cur.avatarArt) ? cur.avatarArt : "" }; }
function cleanSections(s = {}, cur = {}) { const out = {}; for (const k of ["upcoming", "kudos", "photos", "hire", "tips", "profile", "past"]) out[k] = s[k] != null ? !!s[k] : cur[k] != null ? !!cur[k] : k !== "profile"; return out; }
// Experiences companies can book: "Private omakase for your team, 8 to 14, from $120 a person"
function cleanExperiences(L, cur) { if (!Array.isArray(L)) return cur || []; return L.slice(0, 6).map((x) => ({ id: /^[a-z0-9]{6,12}$/.test(x?.id || "") ? x.id : crypto.randomBytes(4).toString("hex"), name: clean(x?.name, 70), desc: clean(x?.desc, 280), emoji: clean(x?.emoji, 16), min: Math.max(1, Math.min(500, Math.round(+x?.min || 1))), max: Math.max(1, Math.min(1000, Math.round(+x?.max || 20))), price: clean(x?.price, 50), length: clean(x?.length, 40), category: ["food", "dining", "movement", "workshop", "drinks", "culture"].includes(x?.category) ? x.category : "", includes: (Array.isArray(x?.includes) ? x.includes : String(x?.includes || "").split("\n")).map((i) => clean(i, 80)).filter(Boolean).slice(0, 8), photo: /^\/_blob\/[A-Za-z0-9]{20}$/.test(x?.photo || "") ? x.photo : "", travels: !!x?.travels })).filter((x) => x.name); }
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
  // supporter tiers: amounts in whole dollars; 0 hides a tier. Nobody is charged until the host turns on payments.
  function cleanSupport(p, cur) { if (p == null) return cur || null; const n = (v) => Math.max(0, Math.min(999, Math.round(+v || 0))); return { on: !!p.on, monthly: n(p.monthly), yearly: n(p.yearly), founding: n(p.founding), note: clean(p.note, 200) }; }
  // a wishlist of fun things guests can gift the host: name, rough price, an https link and an emoji
  function cleanWish(L, cur) { if (!Array.isArray(L)) return cur || []; return L.slice(0, 8).map((x) => ({ id: clean(x?.id, 16) || Math.random().toString(36).slice(2, 10), name: clean(x?.name, 60), price: clean(x?.price, 12), url: /^https:\/\/[^\s<>"]+$/i.test(String(x?.url || "").trim()) ? String(x.url).trim().slice(0, 400) : "", emoji: clean(x?.emoji, 4) || "🎁" })).filter((x) => x.name); }
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
      support: cleanSupport(p.support, cur.support), wishlist: cleanWish(p.wishlist, cur.wishlist),
      shop: p.shop ? cleanShop(p.shop, cur.shop || {}) : cur.shop || null, experiences: cleanExperiences(p.experiences, cur.experiences),
      gallery: Array.isArray(p.gallery) ? p.gallery.filter((u) => /^\/_blob\/[A-Za-z0-9]{20}$/.test(u)).slice(0, 12) : cur.gallery || [],
      insuranceDoc: p.insuranceDoc != null ? (/^\/_blob\/[A-Za-z0-9]{20}$/.test(p.insuranceDoc) ? p.insuranceDoc : "") : cur.insuranceDoc || "",
      legalName: clean(p.legalName ?? cur.legalName, 100), taxId: clean(p.taxId ?? cur.taxId, 40), bizAddress: clean(p.bizAddress ?? cur.bizAddress, 200),
      gigs: Array.isArray(p.gigs) ? p.gigs.slice(0, 8).map((g) => ({ client: clean(g?.client, 60), what: clean(g?.what, 100), when: clean(g?.when, 30) })).filter((g, i, A) => (g.client || g.what) && A.findIndex((x) => x.client.toLowerCase() === g.client.toLowerCase() && x.what.toLowerCase() === g.what.toLowerCase()) === i) : cur.gigs || [],
      insured: p.insured != null ? !!p.insured : !!cur.insured, respondsIn: clean(p.respondsIn ?? cur.respondsIn, 30), terms: clean(p.terms ?? cur.terms, 400), invoices: p.invoices != null ? !!p.invoices : !!cur.invoices,
      forHire: p.forHire != null ? !!p.forHire : !!cur.forHire, services: clean(p.services ?? cur.services, 400), rateNote: clean(p.rateNote ?? cur.rateNote, 120), updatedAt: Date.now() };
    updateWorkspace(ws, { host }); return { host };
  }
  // ---- followers (the fan club) ----
  function followersOf(ws) { return scopeStore(store, ws).list("followers").map((d) => d.data); }
  function follow(ws, { email, name, via = "page", tastes = [], phone = "" }) {
    const S = scopeStore(store, ws), key = crypto.createHash("sha256").update(String(email || "tel:" + String(phone).replace(/[^\d+]/g, "")).toLowerCase()).digest("hex").slice(0, 24), path = "followers/" + key, cur = S.get(path)?.data;
    S.set(path, { email: String(email).toLowerCase(), name: clean(name, 80) || cur?.name || "", via: cur?.via || via, tastes: [...new Set([...(cur?.tastes || []), ...tastes.map((t) => clean(t, 24))])].slice(0, 10), phone: clean(phone, 24) || cur?.phone || "", ...(cur?.confirmedAt ? { confirmedAt: cur.confirmedAt } : {}), at: cur?.at || Date.now(), updatedAt: Date.now() });
    return !cur;
  }
  // ---- public events and discover ----
  const PUB = ["name", "pubTitle", "date", "startTime", "city", "headcount", "kind", "activity", "casual", "meetPoint", "theme", "price", "free", "tags", "emoji", "audienceWho", "approvalRequired", "stage", "earlyUntil", "courses", "dinnerTheme", "endTime", "hood", "coverPhoto", "unlisted"];
  function publicCard(id, e, host) { const o = Object.fromEntries(PUB.filter((k) => e[k] != null).map((k) => [k, e[k]])); if (!o.city && host?.city) o.city = host.city; if (!o.hood && host?.hood) o.hood = host.hood; if (!o.emoji && host?.emoji) o.emoji = host.emoji; return { id, ...o, title: e.pubTitle || e.name, host: host ? { handle: host.handle, name: host.name, emoji: host.emoji, color: host.theme?.accent || host.color, avatarArt: host.theme?.avatarArt || "", cover: (host.gallery || [])[0] || "" } : null }; }
  function eventsOf(ws, { upcoming = true, discoverableOnly = true } = {}) {
    const today = new Date().toISOString().slice(0, 10), host = profileOf(ws);
    return scopeStore(store, ws).list("events").map((d) => ({ id: d.id, e: d.data })).filter(({ e }) => e && !e.example && (!discoverableOnly || e.discoverable) && (upcoming ? (e.date || "9999") >= today : !!e.date && e.date < today && e.stage !== "interest")).sort((a, b) => String(a.e.date || "9").localeCompare(String(b.e.date || "9"))).map(({ id, e }) => ({ ...publicCard(id, e, host), ...(upcoming ? goingOf(ws, id, e) : {}) }));
  }
  // who's going, for event previews: a count and up to three sketch faces (never names)
  const ARTS = ["florist", "curls", "bob", "chef", "runner", "barista", "baker", "glasses", "hiker"], TINTS = ["#E26D8E", "#E0A030", "#5B7FD6", "#3E9C6E", "#8C62C9"];
const TYPE_NAMES = { host: "Host", spark: "Spark", chill: "Chill One", filler: "Seat Filler", connector: "Connector", contributor: "Contributor", helper: "Helper", regular: "Regular", cheerleader: "Cheerleader" };
  function goingOf(ws, id, e) { try { if (e.hideGuests) return {}; const seen = new Set(), faces = []; let n = 0;
      for (const d of scopeStore(store, ws).list("rsvps")) { const r = d.data || {}; if (r.eventId !== id || !(r.response === "going" || (e.stage === "interest" && r.interest === "in"))) continue; const k = String(r.email || r.name || d.id).toLowerCase(); if (seen.has(k)) continue; seen.add(k); n++;
        if (r.showMe !== false && faces.length < 3) { const h = [...k].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7); faces.push({ art: ARTS[h % ARTS.length], color: TINTS[(h >> 4) % TINTS.length] }); } }
      // the crowd in one line: the two most common guest types (from the quiz), never names
      const T = {}; for (const d of scopeStore(store, ws).list("rsvps")) { const r = d.data || {}; if (r.eventId === id && r.response === "going" && TYPE_NAMES[r.guestType]) T[r.guestType] = (T[r.guestType] || 0) + 1; }
      const crowd = Object.entries(T).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, c]) => (c === 1 ? `a ${TYPE_NAMES[k]}` : `${c} ${TYPE_NAMES[k]}s`));
      return n ? { going: n, faces, ...(crowd.length ? { crowd: crowd.join(" and ") + " going" } : {}) } : {}; } catch { return {}; } }
  function discover() {
    const hosts = [], events = [];
    const hideDemo = process.env.ENCORE_HIDE_DEMO === "1";
    for (const ws of allWorkspaceIds()) { const h = profileOf(ws); if (!h?.handle) continue; const sample = /@demo\.encore$/i.test(getWorkspace(ws)?.ownerEmail || ""); if (sample && hideDemo) continue; const up = eventsOf(ws).map((c) => (sample ? { ...c, sample: true } : c)), n = followersOf(ws).length, past = eventsOf(ws, { upcoming: false }).length; if (!up.length && !past && !(h.shop?.open) && !(h.experiences || []).length) continue;
      hosts.push({ ...h, followers: n, upcoming: up.length, hosted: past, ...(sample ? { sample: true } : {}) }); events.push(...up.filter((c) => !c.unlisted)); }
    hosts.sort((a, b) => (!!a.sample - !!b.sample) || (b.followers + b.hosted * 2 + b.upcoming) - (a.followers + a.hosted * 2 + a.upcoming));
    // one card per host name (people who signed up twice, or test accounts that share a name)
    { const seen = new Set(); for (let i = 0; i < hosts.length; i++) { const k = `${String(hosts[i].name || hosts[i].handle || "").trim().toLowerCase()}|${String(hosts[i].city || "").trim().toLowerCase()}`; if (k && seen.has(k) && !hosts[i].upcoming) { hosts.splice(i, 1); i--; } else seen.add(k); } }
    // no doubles on Discover: one card per host, title and date
    { const seen = new Set(); for (let i = events.length - 1; i >= 0; i--) { const e = events[i], k = `${String(e.host?.name || e.host?.handle || "").toLowerCase()}|${String(e.title || "").toLowerCase()}|${e.date || ""}`; if (seen.has(k)) events.splice(i, 1); else seen.add(k); } }
    // a small, scoped badge: the three most active hosts in each city (events hosted, followers, what's coming), never money
    const byCity = new Map(); for (const h of hosts) { const c = String(h.city || "").trim(); if (!c) continue; const k = c.toLowerCase(); if (!byCity.has(k)) byCity.set(k, []); byCity.get(k).push(h); }
    for (const [, L] of byCity) L.filter((h) => h.followers + h.hosted * 2 + h.upcoming >= 3).slice(0, 3).forEach((h, i) => { h.rising = { rank: i + 1, city: h.city }; });
    // real hosts first; the sample hosts (seeded demo accounts) fill in behind them and are labelled
    events.sort((a, b) => (!!a.sample - !!b.sample) || String(a.date || "9").localeCompare(String(b.date || "9")));
    return { hosts: hosts.slice(0, 80), events: events.slice(0, 60) };
  }
  // ---- waitlist ----
  function addWaitlist(w) { const id = crypto.randomBytes(8).toString("hex"); store.set("system/wait-" + id, { kind: "wait", id, ...w, at: Date.now() }); return id; }
  function waitlist() { return store.list("system").map((d) => d.data).filter((x) => x?.kind === "wait" && !x.invitedAt).sort((a, b) => b.at - a.at); }
  function cardOf(id) { const ws = workspaceOfEvent(id); if (!ws) return null; const d = scopeStore(store, ws).list("events").find((x) => x.id === id); return d?.data && !d.data.example ? publicCard(id, d.data, profileOf(ws)) : null; }
  return { cardOf, issueCodes, codesOf, checkCode, useCode, getCode, wsOfHandle, profileOf, setProfile, followersOf, follow, eventsOf, discover, addWaitlist, waitlist, sys };
}

export function mountCommunity(app, { store, small, json, currentUser, sessionWorkspace, ownerOnly, signupLimited, publicOrigin, C }) {
  const hits = new Map(); const limited = (req, n = 20) => { const k = (req.ip || "?") + req.path, now = Date.now(); let h = hits.get(k); if (!h || now - h.start > 3600_000) { h = { n: 0, start: now }; hits.set(k, h); } return ++h.n > n; };
  const me = (req, res) => { const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) { res.status(401).json({ code: "unauthenticated", message: "Sign in first." }); return null; } return u; };
  app.get("/api/signup/config", (req, res) => res.json({ inviteOnly: inviteOnly() }));
  app.get("/api/codes/:code", (req, res) => { if (limited(req, 60)) return res.status(429).json({ code: "rate_limited", message: "Slow down." }); const r = C.checkCode(req.params.code); const host = r.c ? C.profileOf(r.c.ownerWs) : null; res.json({ valid: r.ok, ...(r.ok ? {} : { message: r.message }), ...(r.c ? { from: first(r.c.ownerName), host: host?.handle ? { handle: host.handle, name: host.name } : null } : {}) }); });
  // a regular who gets a code can start hosting
  app.post("/api/me/unlock", small, (req, res) => { const u = me(req, res); if (!u) return; const code = clean(req.body?.code, 20).toUpperCase(), r = C.checkCode(code); if (!r.ok) return res.status(400).json({ code: "invalid", message: r.message });
    if (r.c) C.useCode(code, { ws: u.ws, email: u.email, name: u.name }); updateWorkspace(u.ws, { regularOnly: false }); C.issueCodes({ ws: u.ws, email: u.email, name: u.name }); res.json({ ok: true }); });
  app.get("/api/codes", (req, res) => { const u = me(req, res); if (!u) return; if (getWorkspace(u.ws)?.regularOnly) return res.json({ codes: [], regularOnly: true }); let L = C.codesOf(u.email); if (L.length < CODES_PER_MEMBER) { C.issueCodes({ ws: u.ws, email: u.email, name: u.name, n: CODES_PER_MEMBER - L.length }); L = C.codesOf(u.email); }
    // hosts earn ten more codes for every get-together that really happened (the date has passed and at least 3 people said yes)
    let earned = 0; try { const S = scopeStore(store, u.ws), today = new Date().toISOString().slice(0, 10), key = "system/hostcodes-" + u.ws, done = new Set(store.get(key)?.data?.events || []), R = S.list("rsvps").map((d) => d.data || {});
      for (const d of S.list("events")) { const e = d.data || {}; if (!e.date || e.date >= today || e.example || done.has(d.id) || !(e.published || e.stage === "interest")) continue; const yes = new Set(R.filter((r) => r.eventId === d.id && r.response === "going").map((r) => String(r.email || r.name || "").toLowerCase())).size; if (yes < 3) continue;
        C.issueCodes({ ws: u.ws, email: u.email, name: u.name, n: CODES_PER_MEMBER }); done.add(d.id); earned += CODES_PER_MEMBER; }
      if (earned) { store.set(key, { kind: "hostcodes", events: [...done] }); L = C.codesOf(u.email); } } catch {}
    const o = publicOrigin(req); res.json({ earned, perEvent: CODES_PER_MEMBER, codes: L.map((c) => ({ code: c.code, used: !!c.usedAt, usedBy: c.usedByName ? first(c.usedByName) : null, link: `${o}/join?code=${c.code}` })) }); });
  app.post("/api/waitlist", small, (req, res) => { if (limited(req, 5)) return res.status(429).json({ code: "rate_limited", message: "Too many requests from here." }); const b = req.body || {}, email = clean(b.email, 200).toLowerCase();
    if (!EMAIL_OK(email)) return res.status(400).json({ code: "invalid", message: "Give a valid email so a host can send you a code." }); C.addWaitlist({ name: clean(b.name, 80), email, city: clean(b.city, 60), wants: clean(b.wants, 140) }); res.json({ ok: true }); });
  // Members see who's waiting (first name, city, what they'd host) and can send one of their codes.
  app.get("/api/waitlist", (req, res) => { const u = me(req, res); if (!u) return; res.json({ waiting: C.waitlist().slice(0, 30).map((w) => ({ id: w.id, name: first(w.name) || "Someone", city: w.city, wants: w.wants, at: w.at })) }); });
  // vouch for a guest: send someone who said yes to your event one of your codes, so they can host without waiting
  app.post("/api/codes/vouch", small, async (req, res) => { const u = me(req, res); if (!u) return; if (limited(req, 30)) return res.status(429).json({ code: "rate_limited", message: "Slow down." });
    const b = req.body || {}, eventId = clean(b.eventId, 80), S = scopeStore(store, u.ws); if (!S.get("events/" + eventId)) return res.status(404).json({ code: "not_found", message: "No such event." });
    const r = S.list("rsvps").map((d) => d.data || {}).find((x) => x.eventId === eventId && x.email && x.email.toLowerCase() === String(b.email || "").toLowerCase() && x.response === "going"); if (!r) return res.status(404).json({ code: "not_found", message: "You can vouch for people who said yes to your event." });
    const to = r.email.toLowerCase(); if (C.codesOf(u.email).some((c) => c.sentTo === to)) return res.json({ ok: true, already: true });
    const free = C.codesOf(u.email).find((c) => !c.usedAt && !c.sentTo); if (!free) return res.status(409).json({ code: "conflict", message: "You've used all your invites. Host another get-together to earn ten more." });
    store.update("system/code-" + free.code, { sentTo: to, sentAt: Date.now(), vouched: true });
    const link = `${publicOrigin(req)}/join?code=${free.code}`, cfg = emailConfig(u.ws, false) || emailConfig(DEFAULT_WS, true); let emailed = false;
    if (cfg) { try { const x = await sendEmail(cfg, { to, subject: `${first(u.name)} thinks you'd be a great host`, text: `Hi ${first(r.name) || "there"},\n\n${first(u.name)} loved having you and sent you one of their Encore invites, so you can host your own get-together whenever you like. No waitlist.\n\nYour code: ${free.code}\nStart here: ${link}\n`, fromName: u.name }); emailed = !!x?.ok; } catch {} }
    res.json({ ok: true, emailed, link }); });
  app.post("/api/waitlist/:id/invite", small, async (req, res) => { const u = me(req, res); if (!u) return; const w = store.get("system/wait-" + req.params.id)?.data; if (!w) return res.status(404).json({ code: "not_found", message: "They've already been invited." });
    const free = C.codesOf(u.email).find((c) => !c.usedAt && !c.sentTo); if (!free) return res.status(409).json({ code: "conflict", message: "You've used all your invites." });
    store.update("system/code-" + free.code, { sentTo: w.email, sentAt: Date.now() }); store.update("system/wait-" + w.id, { invitedAt: Date.now(), invitedBy: u.email });
    const link = `${publicOrigin(req)}/join?code=${free.code}`, cfg = emailConfig(u.ws, u.ws === DEFAULT_WS); let emailed = false;
    if (cfg) { try { const r = await sendEmail(cfg, { to: w.email, subject: `${first(u.name)} invited you to Encore`, text: `Hi ${first(w.name) || "there"},\n\n${first(u.name)} saw you'd like to host ${w.wants || "something"}${w.city ? ` in ${w.city}` : ""} and sent you an invite to Encore.\n\nYour code: ${free.code}\nJoin here: ${link}\n`, fromName: u.name }); emailed = !!r.ok; } catch {} }
    res.json({ ok: true, emailed, link, code: free.code }); });
  // Host page: the owner edits it; anyone can read it.
  app.get("/api/host/profile", (req, res) => { const u = me(req, res); if (!u) return; res.json({ host: C.profileOf(u.ws), followers: C.followersOf(u.ws).length }); });
  app.post("/api/host/profile", small, (req, res) => { const u = ownerOnly(req, res); if (!u) return; if (getWorkspace(u.ws)?.regularOnly) return res.status(403).json({ code: "invite_required", message: "Hosting on Encore is invite-only. Add an invite code to set up your page." }); const r = C.setProfile(u.ws, req.body || {}); if (r.error) return res.status(400).json({ code: "invalid", message: r.error }); res.json({ ok: true, host: r.host, url: `${publicOrigin(req)}/h/${r.host.handle}` }); });
  app.get("/api/host/followers", (req, res) => { const u = me(req, res); if (!u) return; const F = C.followersOf(u.ws); res.json({ count: F.length, followers: F.slice(0, 500).map((f) => ({ name: f.name, email: f.email, via: f.via, tastes: f.tastes, at: f.at })) }); });
  app.get("/api/public/host/:handle", (req, res) => { const ws = C.wsOfHandle(req.params.handle); const h = ws && C.profileOf(ws); if (!h) return res.status(404).json({ code: "not_found", message: "No host by that name." });
    res.json({ person: first(getDbUser(getWorkspace(ws)?.ownerEmail || "")?.name || ""), rising: (C.discover().hosts.find((x) => x.handle === h.handle) || {}).rising || null, host: h, followers: C.followersOf(ws).length, supporters: scopeStore(store, ws).list("pledges").filter((d) => d.data?.tier && d.data.tier !== "none").length, gifted: scopeStore(store, ws).list("gifts").reduce((m, d) => { const k = d.data?.itemId; if (k) m[k] = (m[k] || 0) + 1; return m; }, {}), upcoming: C.eventsOf(ws), past: C.eventsOf(ws, { upcoming: false }).slice(-12).reverse() }); });
  // pledge support: records the tier and follows the host; no card is taken
  app.post("/api/public/pledge", small, (req, res) => { if (limited(req, 20)) return res.status(429).json({ code: "rate_limited", message: "Slow down." }); const b = req.body || {}, ws = C.wsOfHandle(b.handle), h = ws && C.profileOf(ws); if (!h) return res.status(404).json({ code: "not_found", message: "No host by that name." });
    const acct = currentUser(req), email = String(acct?.email || b.email || "").trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ code: "invalid", message: "Add your email so the host knows who you are." });
    const tier = ["monthly", "yearly", "founding", "none"].includes(b.tier) ? b.tier : "none", amount = tier === "none" ? 0 : +(h.support?.[tier] || 0); if (tier !== "none" && !amount) return res.status(400).json({ code: "invalid", message: "That tier isn't offered." });
    const key = crypto.createHash("sha256").update(email).digest("hex").slice(0, 24); scopeStore(store, ws).set("pledges/" + key, { email, name: clean(b.name || acct?.name, 80), tier, amount, at: Date.now() });
    try { C.follow(ws, { email, name: clean(b.name || acct?.name, 80), via: "pledge" }); } catch {}
    res.json({ ok: true, tier, amount, supporters: scopeStore(store, ws).list("pledges").filter((d) => d.data?.tier && d.data.tier !== "none").length }); });
  // someone is gifting a wishlist item: remember it so the host can say thanks (and others see it's taken care of)
  app.post("/api/public/gift", small, (req, res) => { if (limited(req, 20)) return res.status(429).json({ code: "rate_limited", message: "Slow down." }); const b = req.body || {}, ws = C.wsOfHandle(b.handle), h = ws && C.profileOf(ws); if (!h) return res.status(404).json({ code: "not_found", message: "No host by that name." });
    const item = (h.wishlist || []).find((x) => x.id === b.itemId); if (!item) return res.status(404).json({ code: "not_found", message: "That item isn't on the wishlist." }); const acct = currentUser(req);
    scopeStore(store, ws).add("gifts", { itemId: item.id, item: item.name, name: clean(b.name || acct?.name, 80), email: String(acct?.email || b.email || "").toLowerCase().slice(0, 200), note: clean(b.note, 300), at: Date.now() }); res.json({ ok: true, url: item.url }); });
  app.post("/api/public/follow", small, async (req, res) => { if (limited(req, 20)) return res.status(429).json({ code: "rate_limited", message: "Too many follows from here." }); const b = req.body || {}, ws = C.wsOfHandle(b.handle), acct = currentUser(req);
    if (!ws) return res.status(404).json({ code: "not_found", message: "No host by that name." });
    // regulars have accounts: the host knows who they are, and they can leave or come back from any device
    if (!acct || acct.ws === DEFAULT_WS) return res.status(401).json({ code: "account_required", message: "Create a free account to join their regulars." });
    const email = clean(acct.email, 200).toLowerCase(); b.name = b.name || acct.name;
    const phone = /^\+?[0-9 ()-]{7,20}$/.test(String(b.phone || "").trim()) ? String(b.phone).trim() : "", prev = scopeStore(store, ws).list("followers").map((d) => d.data).find((f) => f.email === email);
    const isNew = C.follow(ws, { email, name: b.name, via: clean(b.via, 20) || "page", tastes: Array.isArray(b.tastes) ? b.tastes : [], phone }); if (isNew) scopeStore(store, ws).add("audit", { eventId: clean(b.eventId, 80), what: `${first(b.name) || "Someone"} followed you`, kind: "growth", at: Date.now() });
    const out = { ok: true, followers: C.followersOf(ws).length, emailed: false, texted: false };
    // confirmations: the new regular gets an email and a text; the host hears about it too
    const h = C.profileOf(ws) || {}, hostName = h.name || "your host", page = `${publicOrigin(req)}/@${h.handle || ""}`, cfg = emailConfig(ws, false) || emailConfig(DEFAULT_WS, true), sms = smsConfig(), newPhone = phone && phone !== (prev?.phone || "");
    const tasks = [], first1 = isNew || !prev?.confirmedAt;
    if (first1 && cfg) tasks.push(sendEmail(cfg, { to: email, subject: `You're following ${hostName} on Encore`, text: `Hi ${first(b.name) || "there"},\n\nYou're now one of ${hostName}'s regulars. You'll hear first when they post something new${phone ? ", by email and by text" : ""}.\n\nTheir page: ${page}\n\nChanged your mind? Open their page and tap Following to stop.`, fromName: "Encore" }).then((r) => { out.emailed = !!r?.ok; }).catch(() => {}));
    if ((first1 || newPhone) && phone && sms) tasks.push(sendSms(sms, { to: phone, text: `Encore: you're following ${hostName}. You'll get a text when they post something new. Reply STOP to stop texts.` }).then((r) => { out.texted = !!r?.ok; }).catch(() => {}));
    if (first1) { const owner = (getWorkspace(ws)?.ownerEmail || "").toLowerCase(); if (owner && cfg) tasks.push(sendEmail(cfg, { to: owner, subject: `${first(b.name) || "Someone"} just followed you on Encore`, text: `${b.name || "Someone"} is now one of your regulars. They'll hear first about your next event.\n\nSee everyone who follows you: ${publicOrigin(req)}/`, fromName: "Encore" }).catch(() => {})); }
    await Promise.all(tasks); if (first1) { out.confirmed = true; try { const S = scopeStore(store, ws), k = S.list("followers").find((d) => d.data?.email === email); if (k) S.update("followers/" + k.id, { confirmedAt: Date.now() }); } catch {} } res.json(out); });
  app.get("/api/public/discover", (req, res) => res.json(C.discover()));
  app.get("/api/public/cards", (req, res) => { const ids = String(req.query.ids || "").split(",").map((x) => x.trim()).filter((x) => /^[A-Za-z0-9_-]{1,200}$/.test(x)).slice(0, 20), cards = {};
    for (const id of ids) { const c = C.cardOf(id); if (c) cards[id] = c; }
    res.json({ cards }); });
  // The host of an event, for its guest page (name, handle, follower count).
  app.get("/api/public/event-host/:id", (req, res) => { const ws = workspaceOfEvent(req.params.id); const h = ws && C.profileOf(ws); const W0 = ws && getWorkspace(ws); res.json(h ? { person: first(W0?.ownerEmail ? getDbUser(W0.ownerEmail)?.name || "" : ""), host: { handle: h.handle, name: h.name, emoji: h.emoji, color: h.color, accent: h.theme?.accent || h.color, avatarArt: h.theme?.avatarArt || "", cover: (h.gallery || [])[0] || "", supportUrl: h.supportUrl, fanclubUrl: h.fanclubUrl, fanclubPerks: h.fanclubPerks, venmo: h.venmo, paypal: h.paypal, cashapp: h.cashapp }, followers: C.followersOf(ws).length } : { host: null }); });
  // Announce an event to followers (email when it's set up; otherwise a list to send yourself).
  app.post("/api/host/announce", small, async (req, res) => { const u = ownerOnly(req, res); if (!u) return; const id = clean(req.body?.eventId, 80), ev = scopeStore(store, u.ws).get("events/" + id)?.data; if (!ev) return res.status(404).json({ code: "not_found", message: "No such event." });
    const F = C.followersOf(u.ws), h = C.profileOf(u.ws), cfg = emailConfig(u.ws, u.ws === DEFAULT_WS), link = `${publicOrigin(req)}/g#rsvp-${id}`; let sent = 0;
    if (cfg) for (const f of F.slice(0, 500)) { if (!f.email) continue; try { const r = await sendEmail(cfg, { to: f.email, subject: `New from ${h?.name || u.name}: ${ev.pubTitle || ev.name}`, text: `Hi ${first(f.name) || "there"},\n\n${h?.name || u.name} is hosting ${ev.pubTitle || ev.name}${ev.date ? ` on ${ev.date}` : ""}${ev.city ? ` in ${ev.city}` : ""}.\n\nSay yes here: ${link}\n\nYou're getting this because you follow ${h?.name || "this host"} on Encore.`, fromName: h?.name || u.name }); if (r.ok) sent++; } catch {} }
    scopeStore(store, u.ws).add("audit", { eventId: id, what: `announced to ${F.length} followers${cfg ? ` (${sent} emailed)` : ""}`, kind: "growth", at: Date.now() });
    res.json({ ok: true, followers: F.length, emailed: sent, link }); });
}
