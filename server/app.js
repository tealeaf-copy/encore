// Express app for Encore. createApp() is used by server/index.js and the tests.
import express from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { parsePath, httpError, randomId } from "./db.js";
import { runToolLoop, toCapError, aiMode } from "./ai.js";
import { configured, configuredFor, callTool, withCrm } from "./integrations/index.js";
import { clientCredentialsToken } from "./integrations/salesforce.js";
import { gongOrigin, gongAuth } from "./integrations/gong.js";
import { makeCommunity, mountCommunity, inviteOnly } from "./community.js";
import { makeSocial, mountSocial } from "./social.js";
import { mountHosts, earlyAccessBlocks } from "./hosts.js";
import { mountShop } from "./shop.js";
import { mountMarket } from "./market.js";
import { mountBrand, startResearch } from "./brand.js";
import { mountChecks } from "./checks.js";
import { mountCollabs } from "./collabs.js";
import { buildEstimateScript } from "./estimate.js";
import { configureSso, getSso, removeSso, publicSso, redirectUriFor, ssoForEmail, startSso, readState, finishSso, ensureSsoMember } from "./sso.js";
import { runPm } from "./pm.js";
import { emailConfig, publicEmailConfig, sendEmail, verifyEmailKey, EMAIL_SERVICES, EMAIL_RE } from "./email.js";
import { runReminders } from "./reminders.js";
import { mountMcp } from "./mcp.js";
import { authEnabled, isAuthed, loginHandler, loginPage, logoutHandler, currentUser, users, useAuthStore, approverRoles, approverRolesConfigured, APPROVER_LIKE, hasPersonalPassword, teamOf, sessionWorkspace, startSession, emailTaken, hashPassword, startPasswordReset, finishPasswordReset, startSession as startSessionFor } from "./auth.js";
import { exportWorkspace, deleteWorkspace } from "./workspaces.js";
import { DEFAULT_WS, scopeStore, scopeChange, signupEnabled, getWorkspace, createWorkspace, updateWorkspace, trialState, putDbUser, getDbUser, membersOf, createInvite, getInvite, useInvite, createMcpToken, findMcpToken, listMcpTokens, revokeMcpToken, workspaceOfEvent, claimEvent, PLANS, allWorkspaceIds,
  CONNECTION_PROVIDERS, saveConnection, deleteConnection, listConnections, connectionTokens, saveContact, listContacts } from "./workspaces.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const PAGE_FILE = path.join(ROOT, "index.html");
const PUBLIC_DIR = path.join(ROOT, "public");
const TOOL_TIMEOUT_MS = 120_000;

const HEAD = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style><script src="/shim.js"></script><script src="/avatars.js"></script><script src="/account.js"></script></head><body>';
const TAIL = "</body></html>";

// Nominations come from AEs, who sign in; they are not guest-writable.
const GUEST_COLLECTIONS = new Set(["rsvps", "feedback", "interest", "wall"]);
// Guest-writable docs that a guest may change after creating: only with the same browser key (x-encore-key).
const OWNED = new Set(["rsvps", "wall"]);
// What a guest link may see of an event's guest list: only people who opted in and are going, and only
// their name, title and company. Guests never get emails, owners, notes, money, deals or internal tracking.
const GUEST_GUEST_FIELDS = ["name", "title", "company"];
/** Stable per-guest id for invite tokens: guest.id, else email lowercased, else name lowercased. */
export const guestKeyOf = (g) => String(g?.id || String(g?.email || "").trim().toLowerCase() || String(g?.name || "").trim().toLowerCase());
const shownToGuests = (g) => !!g?.optIn && (g.status === "Going" || g.status === "Attended");
// What the guest wall shows to other guests: what each guest chose to show when they RSVP'd.
const WALL_FIELDS = ["eventId", "name", "title", "company", "status", "learn", "linkedin", "photo", "createdAt", "updatedAt"];
// What any visitor may see of the brand profile: the visual identity and public voice, nothing internal
// (budgets, target accounts, call notes, playbooks, knowledge, strategy...).
export const PUBLIC_BRAND_FIELDS = ["name", "company", "logo", "colors", "palette", "fonts", "fontFiles", "voiceLine", "voice", "tone", "tagline", "oneLiner", "adjectives", "website"];
export const publicBrand = (data) => Object.fromEntries(PUBLIC_BRAND_FIELDS.filter((k) => data?.[k] != null).map((k) => [k, data[k]]));
// Values a guest may give their own RSVP / wall entry. ("no" and "requested" are what the RSVP page sends
// for "Can't make it" and approval-required events.)
const GUEST_RSVP_RESPONSES = new Set(["going", "maybe", "declined", "no", "requested"]);
const GUEST_WALL_STATUSES = new Set(["going", "maybe", "hidden", "cancelled"]);
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
function cleanUtm(u) {
  if (typeof u === "string") return u.slice(0, 300);
  if (!u || typeof u !== "object" || Array.isArray(u)) return null;
  const o = {};
  for (const k of UTM_KEYS) { const v = u[k] ?? u[k.slice(4)]; if (v != null && v !== "") o[k] = String(v).slice(0, 200); }
  return Object.keys(o).length ? o : null;
}
// Uploads: only these types are stored; everything is served sandboxed, and only images (not SVG),
// video and PDF are shown inline.
const UPLOAD_OK = (t) => (/^image\/[a-z0-9.+-]+$/.test(t) || /^video\/[a-z0-9.+-]+$/.test(t) || ["application/pdf", "text/csv", "text/plain", "text/markdown", "application/json"].includes(t));
const INLINE_OK = (t) => (/^image\//.test(t) && t !== "image/svg+xml") || /^video\//.test(t) || t === "application/pdf";
const EMAIL_OK = (e) => typeof e === "string" && e.length <= 200 && /^[^\s@"<>()[\],;:]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(e);
const BLOB_CSP = "default-src 'none'; img-src 'self'; media-src 'self'; sandbox";
/** Roles that must approve this event's plan: ENCORE_APPROVER_ROLES, else every team role, else the plan's leads. */
export function requiredApprovers(ev, ws = DEFAULT_WS) {
  const roles = approverRoles(ws);
  if (roles.length) return roles;
  const T = ev?.produce?.team || [];
  const a = [...new Set(T.filter((m) => /lead|sponsor|exec|vp|head|director|owner/i.test(m?.role || "")).map((m) => String(m.role)))];
  return a.length ? a : ["Event lead", "Your manager"];
}
// Allowlist: only these event fields ever reach a guest link.
const PUBLIC_FIELDS = ["bookingId", "tentative", "hideHostFollow", "forCompany", "why", "askQ", "houseRules", "name", "brand", "date", "city", "headcount", "kind", "format", "copy", "cover", "brandColors", "brandMode", "coverPhoto", "unlisted", "playlistUrl", "hideGuests", "launchQs", "approvalRequired", "venuePick", "plusOnes", "objective", "chatham", "noPhotos", "noWall", "discreet", "dress", "pubTitle", "startTime", "endTime", "tz", "venueName", "venueAddr", "hostName", "theme", "effect", "titleFont", "rsvpWords", "noMaybe", "showWho", "autoWait", "openRsvp", "casual", "meetPoint", "routeUrl", "bring", "slots", "chatUrl", "chipIn", "payUrl", "repeat", "carpool", "activity", "discoverable", "price", "ticketUrl", "pickup", "allergens", "emoji", "hood", "free", "stage", "interestGoal", "dateOptions", "getThere", "geo", "askPhone", "ticketNote", "audienceWho", "earlyUntil", "courses", "dinnerTheme", "autoGo"];
export function eventMoney(e) {
  const P = e.produce?.budget || [], cost = P.reduce((a, b) => a + (+b.amount || 0), 0) || +e.budget || 0;
  const committed = (e.commits || []).filter((c) => c.status === "Signed" || c.status === "Paid").reduce((a, c) => a + (+c.amount || 0), 0);
  return { cost, committed, currency: e.currency || "USD" };
}
export function publicEvent(data, view) {
  const e = Object.fromEntries(PUBLIC_FIELDS.filter((k) => data[k] != null).map((k) => [k, data[k]]));
  e.guests = data.noWall ? [] : (data.guests || []).filter(shownToGuests).map((g) => Object.fromEntries(GUEST_GUEST_FIELDS.filter((k) => g[k] != null).map((k) => [k, g[k]])));
  if (data.launch) e.launch = { platform: data.launch.platform, url: data.launch.url, qsOnRsvp: data.launch.qsOnRsvp };
  const v = data.venues?.venues?.[data.venuePick ?? 0];
  if (v) { e.venues = { venues: [{ name: v.name, address: v.address, area: v.area, photo: v.photo }] }; e.venuePick = 0; }
  // Nomination pages (target accounts, AE owners) are for signed-in team members only: guests never get scout output, whatever view they claim.
  if (view === "plan") { for (const k of ["budget", "currency", "pitch", "produce", "goal", "concept", "audience", "dist", "mods"]) if (data[k] != null) e[k] = data[k]; }
  // casual get-togethers: the exact address only goes to people who are in (GET /api/public/address/:id with their RSVP code).
  // When the host approves each guest, the meeting point waits for the yes too; the page shows the neighbourhood.
  if (data.casual && view !== "plan") { if (e.venueAddr) { delete e.venueAddr; e.addrHidden = true; }
    if (data.approvalRequired) { if (e.meetPoint || e.venueName || e.venues) e.addrHidden = true; delete e.meetPoint; delete e.venueName; delete e.venues; } }
  return e;
}
// Single documents guests may read: any event (RSVP, survey, plan, nomination links) plus the public roadmap and brand.
// The public roadmap: only items the team left public (the page's publicItems rule), and only the fields the roadmap shows.
// No budgets, territories, owners or private items.
const CANVAS_ITEM_FIELDS = ["name", "audience", "quarter", "format", "city", "date", "concept", "size"];
export const publicCanvasItem = (i) => !!i && typeof i === "object" && i.public !== false && i.private !== true && i.audience !== "employees" && !["private", "internal", "employees"].includes(String(i.visibility || "").toLowerCase());
export function publicCanvas(data) {
  return { ...(data?.company != null ? { company: data.company } : {}), ...(data?.example ? { example: true } : {}),
    items: (Array.isArray(data?.items) ? data.items : []).filter(publicCanvasItem).map((i) => Object.fromEntries(CANVAS_ITEM_FIELDS.filter((k) => i[k] != null).map((k) => [k, i[k]]))) };
}
const GUEST_READABLE = (segs) => (segs.length === 2 && segs[0] === "events") || ["canvas/main", "brands/main"].includes(segs.join("/"));

/** Is this request allowed without a login, as a guest RSVP/survey visitor? */
function guestAllowed(req) {
  if (req.get("x-encore-guest") !== "1") return false;
  const p = String(req.query.path || "");
  const segs = p.split("/");
  const route = req.baseUrl + req.path; // the gate is mounted on /api
  if (route === "/api/db/doc") {
    if (req.method === "GET") return GUEST_READABLE(segs);
    if ((req.method === "PUT" || req.method === "PATCH") && segs.length === 2 && OWNED.has(segs[0])) return true; // ownership checked in the handler
    // An AE's nomination link (#nominate-<event>-<ae>~<token>): the signed AE token is checked in the handler.
    if ((req.method === "PUT" || req.method === "PATCH") && segs.length === 2 && segs[0] === "nominations" && req.get("x-encore-token")) return true;
    if (req.method === "PUT" || req.method === "PATCH") return segs.length === 2 && GUEST_COLLECTIONS.has(segs[0]);
  }
  // Conference nominations from a signed workspace link (#confnom~ws-<ws>~<token>): the token is checked in the handler.
  if (route === "/api/db/collection" && p === "conferences" && (req.method === "POST" || req.method === "GET") && req.get("x-encore-token")) return true;
  if (route === "/api/db/collection" && req.method === "POST") return segs.length === 1 && GUEST_COLLECTIONS.has(segs[0]);
  // The guest wall only holds what guests chose to show (name, role, photo, topic), so anyone with the link may read it.
  if (route === "/api/db/collection" && req.method === "GET") return p === "wall";
  return false;
}

/** The workspace a guest request is for: from the event id in the path, query or body; else x-encore-workspace (brand, roadmap). */
function guestWorkspace(req) {
  const segs = String(req.query.path || "").split("/"), b = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  let ev = null;
  if (segs[0] === "events" && segs.length === 2) ev = segs[1];
  else if (req.query.eventId) ev = req.query.eventId;
  else if (b.eventId) ev = b.eventId;
  else if (segs.length === 2 && segs[1].includes("--")) ev = segs[1].split("--")[0];
  if (ev) return workspaceOfEvent(String(ev));
  const h = String(req.get("x-encore-workspace") || req.query.ws || "");
  return /^[A-Za-z0-9]{20}$/.test(h) && getWorkspace(h) ? h : DEFAULT_WS;
}

function sseStart(res) {
  res.status(200);
  res.set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  const send = (obj) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`); };
  const beat = setInterval(() => { if (!res.writableEnded) res.write(": ping\n\n"); }, 25_000);
  res.on("close", () => clearInterval(beat));
  return send;
}

export function createApp({ store, dataDir }) {
  const C = makeCommunity(store);
  const assetsDirFor = () => assetsDir;
  const X = makeSocial(store, { C, saveBlob: async (body, contentType, ws) => { const id = randomId(), meta = { id, url: "/_blob/" + id, sizeBytes: body.length, contentType, createdAt: Date.now(), ws }; await fsp.writeFile(path.join(assetsDirFor(), id), body); await fsp.writeFile(path.join(assetsDirFor(), id + ".json"), JSON.stringify(meta)); return meta; } });
  // Every request works in one workspace's slice of the store (see server/workspaces.js).
  // Signed-in people: their own workspace. Guests: the workspace of the event their link is for.
  const S = (req) => { if (req.ws == null) req.ws = req.guest ? guestWorkspace(req) : sessionWorkspace(req); return scopeStore(store, req.ws); };
  const app = express();
  const assetsDir = path.join(dataDir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  const runs = new Map(); // runId -> { pending: Map<toolUseId, resolve> }
  useAuthStore(store);

  app.disable("x-powered-by");
  // Only trust X-Forwarded-For when told to (ENCORE_TRUST_PROXY=1 behind one proxy, a hop count, or an Express trust value
  // such as "loopback"); otherwise anyone could pick their own IP and dodge the login limit.
  const tp = String(process.env.ENCORE_TRUST_PROXY || "").trim();
  app.set("trust proxy", !tp || /^(0|false|off|no)$/i.test(tp) ? false : /^\d+$/.test(tp) ? Number(tp) : /^true$/i.test(tp) ? true : tp);

  // ---------- public, ungated ----------
  // address search for place fields: OpenStreetMap's Photon (no key), cached; set ENCORE_PLACES_URL to use another Photon-compatible server, or "off"
  const placeCache = new Map();
  app.get("/api/places", async (req, res) => { const q = String(req.query.q || "").trim().slice(0, 120); if (q.length < 3) return res.json({ places: [] });
    const base = process.env.ENCORE_PLACES_URL || "https://photon.komoot.io/api/"; if (base === "off") return res.json({ places: [], off: true });
    const lat = Number(req.query.lat), lng = Number(req.query.lng), key = q.toLowerCase() + "|" + (Number.isFinite(lat) ? lat.toFixed(1) + "," + lng.toFixed(1) : "");
    const hit = placeCache.get(key); if (hit && Date.now() - hit.at < 864e5) return res.json({ places: hit.places });
    try { const u = new URL(base); u.searchParams.set("q", q); u.searchParams.set("limit", "6"); u.searchParams.set("lang", "en"); if (Number.isFinite(lat) && Number.isFinite(lng)) { u.searchParams.set("lat", String(lat)); u.searchParams.set("lon", String(lng)); }
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 3500); const r = await fetch(u, { signal: ctl.signal, headers: { "User-Agent": "Encore (event invites)" } }); clearTimeout(t); if (!r.ok) throw new Error("places " + r.status);
      const j = await r.json(); const places = (j.features || []).map((f) => { const p = f.properties || {}, c = f.geometry?.coordinates || []; const street = [p.housenumber, p.street].filter(Boolean).join(" "), city = p.city || p.town || p.village || p.district || p.county || "", name = p.name && p.name !== p.street ? p.name : "";
        const label = [name, street, city, p.state && p.country === "United States" ? p.state : "", p.country].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(", ");
        return { label, name: name || street || city, street, city, hood: p.district || p.locality || "", postcode: p.postcode || "", country: p.country || "", lat: c[1], lng: c[0], kind: p.osm_value || "" }; }).filter((x) => x.label);
      if (placeCache.size > 2000) placeCache.clear(); placeCache.set(key, { at: Date.now(), places }); res.json({ places }); }
    catch { res.json({ places: [], unavailable: true }); } });
  app.get("/api/health", (req, res) => {
    res.json({ ok: true, ai: aiMode(), integrations: configured().map((s) => s.server), auth: authEnabled() });
  });
  app.get("/login", (req, res) => res.type("html").send(loginPage()));
  // ---- forgot password: always the same answer, so nobody learns which emails have accounts ----
  const resetHits = new Map(); const resetLimited = (k, n) => { const now = Date.now(), h = (resetHits.get(k) || []).filter((t) => now - t < 3600e3); h.push(now); resetHits.set(k, h); return h.length > n; };
  app.post("/api/password/forgot", express.json({ limit: "4kb" }), async (req, res) => { const email = String(req.body?.email || "").trim().toLowerCase();
    if (resetLimited("ip:" + (req.ip || "?"), 10) || (email && resetLimited("em:" + email, 3))) return res.status(429).json({ code: "rate_limited", message: "Too many reset requests. Try again in an hour." });
    const r = EMAIL_RE.test(email) ? startPasswordReset(email) : null;
    if (r) { const cfg = emailConfig(r.user.ws, false) || emailConfig(DEFAULT_WS, true); const link = `${originOf(req)}/reset?token=${r.token}`;
      if (cfg) await sendEmail(cfg, { to: r.user.email, subject: "Reset your Encore password", text: `Hi ${String(r.user.name || "").split(" ")[0] || "there"},\n\nSomeone (hopefully you) asked to reset the password for this Encore account. Choose a new one here:\n\n${link}\n\nThe link works once and expires in an hour. If you didn't ask, ignore this email; your password stays the same.` }).catch(() => {}); }
    res.json({ ok: true, message: "If that email has an Encore account, a reset link is on its way. It expires in an hour." }); });
  app.post("/api/password/reset", express.json({ limit: "4kb" }), (req, res) => { if (resetLimited("rs:" + (req.ip || "?"), 20)) return res.status(429).json({ code: "rate_limited", message: "Too many tries. Try again later." });
    const u = finishPasswordReset(req.body?.token, req.body?.password); if (typeof u === "string") return res.status(400).json({ code: "invalid", message: u });
    startSessionFor(req, res, u.email, u.ws); res.json({ ok: true }); });
  app.get(["/forgot", "/reset"], (req, res) => sendStatic(res, "reset.html", "<p>Reset page missing.</p>"));
  app.post("/api/login", express.urlencoded({ extended: false, limit: "10kb" }), express.json({ limit: "10kb" }), loginHandler);
  app.post("/api/logout", logoutHandler);

  // ---------- self-serve sign-up (ENCORE_SIGNUP=1) ----------
  const signupHits = new Map(); // ip -> { n, start }: 5 sign-ups / joins per IP per hour
  const signupLimited = (req) => {
    const k = req.ip || "?", now = Date.now(); let h = signupHits.get(k);
    if (!h || now - h.start > 3600_000) { h = { n: 0, start: now }; signupHits.set(k, h); }
    return ++h.n > Number(process.env.ENCORE_SIGNUP_PER_HOUR || 5);
  };
  const small = express.json({ limit: "10kb" });
  const pwOk = (p) => typeof p === "string" && p.length >= 10 && p.length <= 200;
  app.post("/api/signup", small, (req, res) => {
    if (!signupEnabled()) return res.status(404).json({ code: "not_found", message: "Sign-up is off on this server." });
    if (signupLimited(req)) return res.status(429).json({ code: "rate_limited", message: "Too many sign-ups from here. Try again later." });
    const b = req.body || {}, name = String(b.name || "").trim().slice(0, 120), email = String(b.email || "").trim().toLowerCase(), personal = b.mode === "friends" || !String(b.company || "").trim();
    const company = String(b.company || "").trim().slice(0, 120) || `${name.split(/\s+/)[0]}'s gatherings`, ref = /^[A-Za-z0-9_-]{1,80}$/.test(String(b.ref || "")) ? String(b.ref) : "";
    if (!name) return res.status(400).json({ code: "invalid", message: "Your name is required." });
    if (!EMAIL_OK(email)) return res.status(400).json({ code: "invalid", message: "Give a valid email." });
    if (!pwOk(b.password)) return res.status(400).json({ code: "invalid", message: "Use a password of at least 10 characters." });
    if (emailTaken(email)) return res.status(409).json({ code: "conflict", message: "That email already has an Encore account. Sign in instead." });
    // Invite-only: everyone after the first member needs a code from someone already here.
    const code = String(b.code || "").trim().toUpperCase().slice(0, 20), needCode = inviteOnly() && (allWorkspaceIds().length > 1 || String(process.env.ENCORE_FOUNDER_CODES || "").trim() !== "");
    let codeCheck = null; const regHandle = String(b.regularOf || "").trim().slice(0, 60), regWs = regHandle && !code ? C.wsOfHandle(regHandle) : null, regular = !!(regWs && personal);
    if ((needCode && !regular) || code) { codeCheck = C.checkCode(code); if ((needCode || code) && !codeCheck.ok) return res.status(403).json({ code: "invite_required", message: code ? codeCheck.message : "Encore is invite-only for now. Ask a member for a code, or join the waitlist." }); }
    const W = createWorkspace({ company, ownerEmail: email, personal, ref });
    if (codeCheck?.ok && codeCheck.c) { C.useCode(code, { ws: W.id, email, name }); try { X.addFriend(email, codeCheck.c.ownerEmail); X.addFriend(codeCheck.c.ownerEmail, email); } catch {} }
    if (regular) { updateWorkspace(W.id, { regularOnly: !!needCode, regularOf: regHandle }); try { C.follow(regWs, { email, name, via: "signup", tastes: [] }); scopeStore(store, regWs).add("audit", { eventId: "", what: `${name.split(/\s+/)[0]} joined your regulars`, kind: "growth", at: Date.now() }); } catch {} }
    if (!regular || !needCode) C.issueCodes({ ws: W.id, email, name });
    { const city = String(b.city || "").trim().slice(0, 60); if (city) { try { const W2 = getWorkspace(W.id); updateWorkspace(W.id, { city, host: { ...(W2?.host || {}), city: W2?.host?.city || city } }); } catch {} } }
    if (personal) { try { X.ensureProfile({ ws: W.id, name, email }); } catch {} }
    // A brand's first minute: Encore starts researching the company while they look around.
    else { try { startResearch(W.id, { company, website: String(b.website || "").trim().slice(0, 200), by: email }); } catch (e) { console.warn("[brand] start failed", e?.message); } }
    // Word of mouth: count who came to Encore from a guest page, on the event's own workspace.
    if (ref) { const host = workspaceOfEvent(ref); if (host) { try { scopeStore(store, host).add("audit", { eventId: ref, what: `${name.split(/\s+/)[0]} started hosting with Encore from this event's page`, kind: "growth", at: Date.now() }); } catch {} } }
    putDbUser({ kind: "user", ws: W.id, name, email, roles: ["Event lead"], owner: true, pw: hashPassword(b.password), createdAt: Date.now() });
    scopeStore(store, W.id).add("audit", { eventId: "", what: `${company} workspace created`, kind: "team", who: name, email, verified: true, at: Date.now() });
    startSession(req, res, email, W.id);
    // ?template=…&plan=… from the landing page ride along to the app's welcome screen.
    const q = new URLSearchParams({ welcome: "1" });
    for (const k of ["template", "plan"]) { const v = String(b[k] ?? "").trim(); if (/^[A-Za-z0-9_-]{1,60}$/.test(v)) q.set(k, v); }
    if (q.get("plan") && PLANS.includes(q.get("plan"))) updateWorkspace(W.id, { interestedIn: q.get("plan") });
    res.json({ ok: true, workspace: { id: W.id, company: W.company, plan: W.plan, trialEndsAt: W.trialEndsAt }, redirect: "/?" + q.toString() });
  });
  app.post("/api/join", small, (req, res) => {
    if (signupLimited(req)) return res.status(429).json({ code: "rate_limited", message: "Too many tries from here. Try again later." });
    const b = req.body || {}, inv = getInvite(b.token), name = String(b.name || "").trim().slice(0, 120);
    if (!inv || inv.usedAt || inv.expiresAt < Date.now() || !getWorkspace(inv.ws)) return res.status(410).json({ code: "invite_invalid", message: "This invite link has expired or was already used. Ask for a new one." });
    if (!name) return res.status(400).json({ code: "invalid", message: "Your name is required." });
    if (!pwOk(b.password)) return res.status(400).json({ code: "invalid", message: "Use a password of at least 10 characters." });
    if (emailTaken(inv.email)) return res.status(409).json({ code: "conflict", message: "That email already has an Encore account." });
    useInvite(inv);
    putDbUser({ kind: "user", ws: inv.ws, name, email: inv.email, roles: [inv.role], ...(inv.defaultRole ? { defaultRole: true } : {}), owner: false, pw: hashPassword(b.password), createdAt: Date.now(), invitedBy: inv.by });
    scopeStore(store, inv.ws).add("audit", { eventId: "", what: `${name} joined as ${inv.role}`, kind: "team", who: name, email: inv.email, verified: true, at: Date.now() });
    startSession(req, res, inv.email, inv.ws);
    res.json({ ok: true, email: inv.email, redirect: "/?welcome=1" });
  });
  // Contact / security-review inbox, open to signed-out visitors.
  const contactHits = new Map();
  app.post("/api/contact", small, (req, res) => {
    const k = req.ip || "?", now = Date.now(); let h = contactHits.get(k);
    if (!h || now - h.start > 3600_000) { h = { n: 0, start: now }; contactHits.set(k, h); }
    if (++h.n > Number(process.env.ENCORE_CONTACT_PER_HOUR || 5)) return res.status(429).json({ code: "rate_limited", message: "Too many messages from here. Try again later." });
    const b = req.body || {}, kind = String(b.kind || ""), email = String(b.email || "").trim().toLowerCase();
    if (!["talk", "security", "billing"].includes(kind)) return res.status(400).json({ code: "invalid", message: "kind must be talk, security or billing" });
    if (!EMAIL_OK(email)) return res.status(400).json({ code: "invalid", message: "Give a valid email so we can reply." });
    const message = String(b.message || "").trim().slice(0, 5000);
    if (!message) return res.status(400).json({ code: "invalid", message: "Add a message." });
    const u = authEnabled() ? currentUser(req) : null;
    const rec = { msgKind: kind, name: String(b.name || "").trim().slice(0, 120), email, company: String(b.company || "").trim().slice(0, 120), message, at: now, ...(u ? { ws: u.ws, from: u.email } : {}) };
    const id = saveContact(rec);
    console.log(`[contact] ${kind} from ${rec.name || "?"} <${email}>${rec.company ? ` (${rec.company})` : ""}${u ? ` ws=${u.ws}` : ""}: ${message.slice(0, 200).replace(/\s+/g, " ")}`);
    res.json({ ok: true, id });
  });
  // ---------- single sign-on (OIDC) ----------
  const SSO_COOKIE = "encore_sso";
  const esc = (x) => String(x).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ssoPage = (inner) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in with SSO · Encore</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px system-ui,sans-serif;background:#f4f7ff;color:#1b2340}form,.box{background:#fff;padding:28px;border-radius:16px;box-shadow:0 6px 30px rgba(30,50,120,.12);width:min(320px,calc(100vw - 32px));box-sizing:border-box}h1{margin:0 0 16px;font-size:22px}input,button{width:100%;box-sizing:border-box;font:inherit;padding:10px 12px;border-radius:10px}input{border:1px solid #cfd6ea;margin-bottom:12px}button{border:0;background:#3355ff;color:#fff;font-weight:600;cursor:pointer}p{margin:0 0 12px;font-size:13px}.err{color:#b3261e}a{display:block;margin-top:14px;text-align:center;color:#3355ff;font-size:13px;text-decoration:none}</style></head><body>${inner}</body></html>`;
  const ssoForm = (msg = "") => ssoPage(`<form method="get" action="/sso/start"><h1>Sign in with SSO</h1>${msg ? `<p class="err">${esc(msg)}</p>` : ""}<input type="email" name="email" placeholder="Work email" autocomplete="email" autofocus required><button type="submit">Continue</button><a href="/login">Sign in with a password instead</a></form>`);
  app.get("/sso/start", (req, res) => {
    res.set("Cache-Control", "no-store");
    const email = String(req.query.email || "").trim().toLowerCase();
    if (!email) return res.type("html").send(ssoForm());
    if (!EMAIL_OK(email)) return res.status(400).type("html").send(ssoForm("Enter your work email."));
    const cfg = ssoForEmail(email);
    if (!cfg) return res.status(404).type("html").send(ssoForm(`Single sign-on isn't set up for @${email.split("@")[1]}. Sign in with your password instead.`));
    const { url, cookie } = startSso(cfg, email, redirectUriFor(req));
    res.setHeader("Set-Cookie", `${SSO_COOKIE}=${cookie}; Path=/sso; HttpOnly; SameSite=Lax; Max-Age=600${req.secure ? "; Secure" : ""}`);
    res.redirect(302, url);
  });
  app.get("/sso/callback", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const clear = `${SSO_COOKIE}=; Path=/sso; HttpOnly; SameSite=Lax; Max-Age=0`;
    const cookie = String(req.headers.cookie || "").split(";").map((x) => x.trim()).find((x) => x.startsWith(SSO_COOKIE + "="))?.slice(SSO_COOKIE.length + 1);
    try {
      if (req.query.error) throw Object.assign(new Error(`The identity provider said: ${String(req.query.error_description || req.query.error).slice(0, 200)}`), { code: "sso_failed" });
      const who = await finishSso(readState(cookie), { code: req.query.code, returnedState: String(req.query.state || "") });
      const u = ensureSsoMember(who, (e) => users().some((x) => x.email === e));
      scopeStore(store, who.ws).add("audit", { eventId: "", what: `${u.name} signed in with SSO`, kind: "team", who: u.name, email: u.email, verified: true, at: Date.now() });
      startSession(req, res, u.email, who.ws);
      res.append("Set-Cookie", clear);
      res.redirect(302, "/");
    } catch (e) {
      if (!e.code) console.error("[sso]", e);
      else console.warn(`[sso] sign-in failed: ${e.message}`);
      res.append("Set-Cookie", clear);
      res.status(e.status && e.status < 500 ? e.status : 400).type("html").send(ssoPage(`<div class="box"><h1>Single sign-on didn't work</h1><p class="err">${esc(e.code ? e.message : "Something went wrong.")}</p><a href="/sso/start">Try again</a><a href="/login">Sign in with a password</a></div>`));
    }
  });

  // Static pages for signed-out visitors. The guest-link redirect is added to them, so #rsvp-… links keep working.
  const GUEST_REDIRECT = `<script>if (/^#(rsvp-|survey-|nominate-|plan-|roadmap|guests-|approve-|signoff-|confnom)/.test(location.hash)) location.replace("/g" + location.search + location.hash);</script>`;
  const sendStatic = async (res, file, fallback) => {
    let html; try { html = await fsp.readFile(path.join(PUBLIC_DIR, file), "utf8"); } catch { html = fallback; }
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + GUEST_REDIRECT) : GUEST_REDIRECT + html;
    res.set("Cache-Control", "no-store").type("html").send(html);
  };
  app.get("/signup", (req, res) => (signupEnabled() ? sendStatic(res, "signup.html", loginPage()) : res.redirect(302, "/login")));
  app.get("/join", (req, res) => (req.query.code && !req.query.token ? res.redirect(302, "/signup?code=" + encodeURIComponent(String(req.query.code).slice(0, 20))) : sendStatic(res, "join.html", loginPage())));
  app.get("/work", (req, res) => sendStatic(res, "landing.html", "<p>Page missing.</p>"));
  app.get("/discover", (req, res) => sendStatic(res, "discover.html", "<p>Discover page missing.</p>"));
  app.get("/plans", (req, res) => sendStatic(res, "plans.html", "<p>Plans page missing.</p>"));
  app.get("/quiz", (req, res) => sendStatic(res, "quiz.html", "<p>Quiz page missing.</p>"));
  app.get("/teams", (req, res) => sendStatic(res, "teams.html", "<p>Teams page missing.</p>"));
  app.get("/gifts", (req, res) => sendStatic(res, "gifts.html", "<p>Gifts page missing.</p>"));
  app.get("/teams/s/:id", (req, res) => sendStatic(res, "shortlist.html", "<p>Shortlist page missing.</p>"));
  app.get(["/team", "/team/:id"], (req, res) => sendStatic(res, "team.html", "<p>Team page missing.</p>"));
  app.get("/results", (req, res) => sendStatic(res, "results.html", "<p>Results page missing.</p>"));
  app.get("/vendor", (req, res) => sendStatic(res, "vendor.html", "<p>Vendor page missing.</p>"));
  app.get("/requests", (req, res) => sendStatic(res, "requests.html", "<p>Requests page missing.</p>"));
  app.get("/check/:id", (req, res) => sendStatic(res, "check.html", "<p>Check page missing.</p>"));
  app.get("/h/:handle", (req, res) => sendStatic(res, "host.html", "<p>Host page missing.</p>"));
  // Every host's storefront: encore.example/@claire-runs
  app.get(/^\/@([a-z0-9][a-z0-9-]{1,29})$/, async (req, res) => { const ws = C.wsOfHandle(req.params[0]), h = ws && C.profileOf(ws);
    try { let html = await fsp.readFile(path.join(PUBLIC_DIR, "host.html"), "utf8"); if (h) { const e = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); const desc = h.tagline || h.bio || `${h.name} on Encore`; const shop = h.shop?.open && h.shop.items?.length ? ` Order ${h.shop.items.map((x) => x.name).slice(0, 2).join(" and ")}.` : "";
        html = html.replace("<title>Host · Encore</title>", `<title>${e(h.name)} · Encore</title><meta name="description" content="${e(desc + shop)}"><meta property="og:title" content="${e(h.name)}"><meta property="og:description" content="${e(desc + shop)}"><meta property="og:type" content="profile"><meta property="og:url" content="${e(originOf(req))}/@${e(h.handle)}"><meta name="twitter:card" content="summary">`); }
      res.set("Cache-Control", "no-store").type("html").send(html); } catch { res.status(404).send("<p>Host page missing.</p>"); } });
  app.get("/method", (req, res) => sendStatic(res, "method.html", "<p>Method page missing.</p>"));
  app.get("/pricing", (req, res) => sendStatic(res, "pricing.html", "<p>Pricing page missing.</p>"));
  // The homepage demo runs the app's own planner, read from the current index.html.
  let estimateJs = null, estimateAt = 0;
  app.get("/estimate.js", async (req, res) => {
    try { const st = await fsp.stat(PAGE_FILE); if (!estimateJs || st.mtimeMs !== estimateAt) { estimateJs = buildEstimateScript(PAGE_FILE); estimateAt = st.mtimeMs; } res.type("application/javascript").set("Cache-Control", "public, max-age=300").send(estimateJs); }
    catch (e) { res.status(500).type("application/javascript").send("/* estimate unavailable */"); }
  });
  app.get("/security", (req, res) => sendStatic(res, "security.html", "<p>Security page missing.</p>"));

  const sendPage = async (req, res, next) => {
    try {
      const file = await fsp.readFile(PAGE_FILE, "utf8"); // read per request: the page is edited live
      res.set("Cache-Control", "no-store").type("html").send(HEAD + file + TAIL);
    } catch (err) { next(err); }
  };
  // Guest links (#rsvp-ID, #survey-ID) are hashes the server never sees. The login
  // page forwards them to /g, which serves the same page without a login; the
  // data endpoints still only allow the guest operations listed in guestAllowed().
  app.get("/g", sendPage);
  // A no-login demo: the page without the shim runs on its built-in sample data and saves nothing here.
  app.get("/demo", async (req, res, next) => {
    try {
      const file = await fsp.readFile(PAGE_FILE, "utf8");
      res.set("Cache-Control", "no-store").type("html").send(HEAD.replace('<script src="/shim.js"></script>', "") + file + TAIL);
    } catch (err) { next(err); }
  });
  app.get("/", (req, res, next) => (isAuthed(req) ? (getWorkspace(sessionWorkspace(req))?.regularOnly && !req.query.app ? res.redirect(302, "/plans") : sendPage(req, res, next)) : signupEnabled() ? sendStatic(res, "home.html", loginPage()) : res.type("html").send(loginPage())));
  app.get("/_blob/:id", async (req, res, next) => {
    const id = req.params.id;
    if (!/^[A-Za-z0-9]{20}$/.test(id)) return res.status(404).end();
    try {
      const meta = JSON.parse(await fsp.readFile(path.join(assetsDir, id + ".json"), "utf8"));
      const type = String(meta.contentType || "").split(";")[0].trim().toLowerCase();
      // Files stored before uploads were restricted may have any type: those are served as plain downloads.
      res.set({ "Content-Type": UPLOAD_OK(type) ? meta.contentType : "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": BLOB_CSP, "Cross-Origin-Resource-Policy": "same-origin" });
      if (!INLINE_OK(type)) res.set("Content-Disposition", "attachment");
      res.sendFile(path.join(assetsDir, id), (err) => err && next(err));
    } catch { res.status(404).end(); }
  });
  app.use(express.static(PUBLIC_DIR, { index: false }));

  // ---------- community: invite codes, host pages, followers, discover (public parts check nothing; member parts check the session) ----------
  mountCommunity(app, { store, small, currentUser, ownerOnly: (req, res) => ownerOnly(req, res), publicOrigin: (req) => originOf(req), C });
  app.locals.social = X;
  mountSocial(app, { store, small, currentUser, publicOrigin: (req) => originOf(req), C, X, raw: express.raw({ type: () => true, limit: `${Number(process.env.ASSET_MAX_MB || 15)}mb` }) });
  mountHosts(app, { store, small, currentUser, publicOrigin: (req) => originOf(req), C, X });
  mountShop(app, { store, small, currentUser, publicOrigin: (req) => originOf(req), C, X });
  mountMarket(app, { store, small, currentUser, publicOrigin: (req) => originOf(req), C, X });
  mountBrand(app, { small, currentUser });
  mountCollabs(app, { store, small, currentUser, C, X });
  mountChecks(app, { store, small, currentUser, publicOrigin: (req) => originOf(req) });
  app.get("/vendor/jspdf.umd.min.js", (req, res) => res.set("Cache-Control", "public, max-age=604800").sendFile(path.join(ROOT, "node_modules", "jspdf", "dist", "jspdf.umd.min.js")));
  app.get("/booking/:id", (req, res) => sendStatic(res, "booking.html", "<p>Booking page missing.</p>"));
  app.get("/hosts", (req, res) => sendStatic(res, "hosts.html", "<p>Hosts page missing.</p>"));
  app.get("/feed", (req, res) => (isAuthed(req) ? sendStatic(res, "feed.html", "<p>Feed page missing.</p>") : res.redirect(302, "/login")));

  // ---------- gate ----------
  app.use("/api", (req, res, next) => {
    // A signed-in member opening someone else's guest link is a guest there (their own workspace doesn't have the event).
    if (req.get("x-encore-guest") === "1" && guestAllowed(req)) { const segs = String(req.query.path || "").split("/"), evId = segs[0] === "events" ? segs[1] : (req.body?.eventId || req.query.eventId || "");
      const owner = evId ? workspaceOfEvent(String(evId)) : null; if (!evId || !isAuthed(req) || owner !== sessionWorkspace(req)) { req.guest = true; return next(); } }
    if (isAuthed(req)) return next();
    if (guestAllowed(req)) { req.guest = true; return next(); }
    if (/^\/aeaction$|^\/aepage$|^\/signoff\/(view|decide)$/.test(req.path)) { req.guest = true; return next(); } // checked by signed token
    res.status(401).json({ code: "not_granted", message: "Sign in first." });
  });

  const json = express.json({ limit: "2mb" });
  // Trials: everything works for 14 days; after that, changes stop (402) and reading still works.
  const TRIAL_FREE = new Set(["/upgrade", "/workspace"]);
  app.use("/api", (req, res, next) => {
    if (req.guest || req.method === "GET" || req.method === "HEAD" || TRIAL_FREE.has(req.path)) return next();
    const ws = sessionWorkspace(req);
    if (ws !== DEFAULT_WS && !trialState(getWorkspace(ws)).writable) return res.status(402).json({ code: "trial_ended", message: "Your free trial has ended, so changes are paused. Upgrade to keep editing; everything is still here to read." });
    next();
  });

  // ---------- workspace: team, invites, MCP tokens, plan ----------
  const ownerOnly = (req, res) => {
    const u = currentUser(req);
    if (!u || u.ws === DEFAULT_WS) { res.status(403).json({ code: "not_granted", message: u ? "This team is set up with ENCORE_USERS on the server." : "Sign in first." }); return null; }
    if (!u.owner) { res.status(403).json({ code: "not_granted", message: "Only the workspace owner can do that." }); return null; }
    return u;
  };
  app.get("/api/workspace", (req, res) => {
    const ws = sessionWorkspace(req), W = getWorkspace(ws), T = trialState(W);
    res.json({ id: ws, company: W?.company || "", personal: W?.plan === "friends", plan: W?.plan || "self-hosted", trialEndsAt: W?.trialEndsAt || null, daysLeft: T.daysLeft, trial: T.trial, trialEnded: T.trialEnded,
      handle: W?.host?.handle || "", city: W?.host?.city || W?.city || "", regularOnly: !!W?.regularOnly, writable: T.writable, upgradeRequest: W?.upgradeRequest || null,
      approverRoles: approverRoles(ws), approverRolesSet: ws === DEFAULT_WS ? null : W?.approverRoles || [],
      members: teamOf(ws).map((m) => ({ name: m.name, email: m.email, roles: m.roles || [], ...(m.owner ? { owner: true } : {}) })),
      limits: { features: "all", members: null, events: null, writes: T.writable } }); // no feature gates during the trial
  });
  app.post("/api/invite", json, (req, res) => {
    const u = ownerOnly(req, res); if (!u) return;
    const email = String(req.body?.email || "").trim().toLowerCase(), given = String(req.body?.role ?? "").trim().slice(0, 80), role = given || "Team member";
    if (!EMAIL_OK(email)) return res.status(400).json({ code: "invalid", message: "Give a valid email." });
    if (emailTaken(email)) return res.status(409).json({ code: "conflict", message: "That person already has an Encore account." });
    // An empty role becomes "Team member" for display, flagged so it never counts as an approver role.
    const { token, expiresAt } = createInvite({ ws: u.ws, email, role, defaultRole: !given, by: u.email });
    S(req).add("audit", { eventId: "", what: `invited ${email} as ${role}`, kind: "team", who: u.name, email: u.email, verified: true, at: Date.now() });
    res.json({ link: "/join#" + token, token, email, role, expiresAt, approverRole: !!given && APPROVER_LIKE.test(given) });
  });
  // Approvers: the owner can name the roles whose approval a plan needs, and change members' roles.
  const cleanRoles = (v) => { const seen = new Set(); return (Array.isArray(v) ? v : []).map((r) => String(r ?? "").trim().slice(0, 80)).filter((r) => r && !seen.has(r.toLowerCase()) && seen.add(r.toLowerCase())).slice(0, 20); };
  app.post("/api/workspace/approvers", json, (req, res) => {
    const u = ownerOnly(req, res); if (!u) return;
    if (!Array.isArray(req.body?.roles)) return res.status(400).json({ code: "invalid", message: "roles must be a list (empty clears it)" });
    const roles = cleanRoles(req.body.roles);
    updateWorkspace(u.ws, { approverRoles: roles });
    S(req).add("audit", { eventId: "", what: roles.length ? `set approver roles: ${roles.join(", ")}` : "cleared approver roles", kind: "team", who: u.name, email: u.email, verified: true, at: Date.now() });
    res.json({ ok: true, approverRolesSet: roles, approverRoles: approverRoles(u.ws) });
  });
  app.patch("/api/members/:email", json, (req, res) => {
    const u = ownerOnly(req, res); if (!u) return;
    const email = String(req.params.email || "").trim().toLowerCase(), m = getDbUser(email);
    if (!m || m.ws !== u.ws) return res.status(404).json({ code: "not_found", message: "No such member in your workspace." });
    if (!Array.isArray(req.body?.roles)) return res.status(400).json({ code: "invalid", message: "roles must be a list" });
    const roles = cleanRoles(req.body.roles);
    const { defaultRole, ...rest } = m;
    putDbUser({ ...rest, roles });
    S(req).add("audit", { eventId: "", what: `${m.name}'s roles: ${roles.join(", ") || "none"}`, kind: "team", who: u.name, email: u.email, verified: true, at: Date.now() });
    res.json({ ok: true, member: { name: m.name, email: m.email, roles, ...(m.owner ? { owner: true } : {}) }, approverRoles: approverRoles(u.ws) });
  });
  app.post("/api/mcptoken", json, (req, res) => {
    const u = ownerOnly(req, res); if (!u) return;
    const name = String(req.body?.name || u.name).slice(0, 120);
    const token = createMcpToken({ ws: u.ws, name, email: req.body?.email ? String(req.body.email).toLowerCase().slice(0, 200) : u.email });
    S(req).add("audit", { eventId: "", what: `created an MCP token for ${name}`, kind: "team", who: u.name, email: u.email, verified: true, at: Date.now() });
    res.json({ token, name, note: "Shown once. Use it as Authorization: Bearer <token> on /mcp." });
  });
  app.post("/api/upgrade", json, (req, res) => {
    const u = ownerOnly(req, res); if (!u) return;
    const plan = String(req.body?.plan || "");
    if (!PLANS.includes(plan)) return res.status(400).json({ code: "invalid", message: `plan must be ${PLANS.join(" or ")}` });
    // Billing isn't wired: this records the request; an operator sets plan to "team"/"program" once paid (team, growth or program).
    const W = updateWorkspace(u.ws, { plan: "pending_" + plan, upgradeRequest: { plan, by: u.email, at: Date.now() } });
    S(req).add("audit", { eventId: "", what: `asked to upgrade to ${plan}`, kind: "team", who: u.name, email: u.email, verified: true, at: Date.now() });
    res.json({ ok: true, plan: W.plan, upgradeRequest: W.upgradeRequest, ...trialState(W) });
  });

  // Who may manage a workspace's connections: a sign-up workspace's owner; in the default workspace, any signed-in
  // ENCORE_USERS person (or anyone signed in with the shared password when there's no team list).
  const adminOf = (req, res) => {
    const u = currentUser(req), ws = sessionWorkspace(req);
    if (ws !== DEFAULT_WS) { if (u?.owner) return { u, ws }; res.status(403).json({ code: "not_granted", message: "Only the workspace owner can do that." }); return null; }
    if (u || !teamOf(DEFAULT_WS).length) return { u, ws };
    res.status(403).json({ code: "not_granted", message: "Sign in as a team member." }); return null;
  };
  // SSO settings (owner only). The client secret is stored encrypted and never returned.
  app.get("/api/sso", (req, res) => { const u = ownerOnly(req, res); if (!u) return; res.json(publicSso(getSso(u.ws), redirectUriFor(req))); });
  app.post("/api/sso", json, async (req, res) => {
    const u = ownerOnly(req, res); if (!u) return;
    try {
      const cfg = await configureSso(u.ws, req.body || {}, u.email);
      S(req).add("audit", { eventId: "", what: `set up single sign-on for @${cfg.domain} (${cfg.issuer})${cfg.enforce ? ", enforced" : ""}`, kind: "team", who: u.name, email: u.email, verified: true, at: Date.now() });
      res.json({ ok: true, ...publicSso(cfg, redirectUriFor(req)) });
    } catch (e) { res.status(e.status || 400).json({ code: e.code || "invalid", message: e.message }); }
  });
  app.delete("/api/sso", (req, res) => {
    const u = ownerOnly(req, res); if (!u) return;
    const removed = removeSso(u.ws);
    if (removed) S(req).add("audit", { eventId: "", what: "turned off single sign-on", kind: "team", who: u.name, email: u.email, verified: true, at: Date.now() });
    res.json({ ok: true, removed });
  });
  app.get("/api/mcptoken", (req, res) => {
    const u = ownerOnly(req, res); if (!u) return;
    res.json({ tokens: listMcpTokens(u.ws) });
  });
  app.delete("/api/mcptoken/:id", (req, res) => {
    const u = ownerOnly(req, res); if (!u) return;
    if (!revokeMcpToken(u.ws, req.params.id)) return res.status(404).json({ code: "not_found", message: "No such token." });
    S(req).add("audit", { eventId: "", what: "revoked an MCP token", kind: "team", who: u.name, email: u.email, verified: true, at: Date.now() });
    res.json({ ok: true, revoked: req.params.id });
  });

  // ---------- CRM connections (a workspace's own provider tokens) ----------
  /** https://<anything>.my.salesforce.com or *.force.com only, so a connection can't point the server elsewhere. */
  const salesforceOrigin = (v) => {
    let u; try { u = new URL(String(v || "")); } catch { return null; }
    if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
    const h = u.hostname.toLowerCase();
    if (!/^[a-z0-9.-]+$/.test(h) || !(h.endsWith(".salesforce.com") || h.endsWith(".force.com"))) return null;
    return "https://" + h;
  };
  app.post("/api/connections", json, async (req, res, next) => {
    if (req.body?.provider !== "salesforce") return next();
    const a = adminOf(req, res); if (!a) return;
    const b = req.body, inst = salesforceOrigin(b.instanceUrl), clientId = String(b.clientId || "").trim(), clientSecret = String(b.clientSecret || "").trim();
    if (!inst) return res.status(400).json({ code: "invalid", message: "instanceUrl must be your https://<domain>.my.salesforce.com (or .force.com) address." });
    if (!clientId || !clientSecret || clientId.length > 500 || clientSecret.length > 500) return res.status(400).json({ code: "invalid", message: "clientId and clientSecret are required." });
    // Exchange the client credentials, then make one cheap read with the token.
    let token;
    try { token = (await clientCredentialsToken(inst, clientId, clientSecret)).token; }
    catch (e) { return res.status(e.status && e.status < 500 ? 400 : 502).json({ code: e.status && e.status < 500 ? "invalid_token" : "upstream_error", message: e.message }); }
    let r;
    try { r = await fetch(`${inst}/services/data/v60.0/limits`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(10_000) }); }
    catch { return res.status(502).json({ code: "upstream_error", message: "Couldn't reach Salesforce to check the connection." }); }
    if (r.status === 401 || r.status === 403) return res.status(400).json({ code: "invalid_token", message: "Salesforce issued a token but refused a read with it. Check the connected app's run-as user and its permissions." });
    if (!r.ok) return res.status(502).json({ code: "upstream_error", message: `Salesforce answered ${r.status} when checking the connection.` });
    // Only the credentials are kept (encrypted); access tokens are fetched again when they expire.
    saveConnection(a.ws, "salesforce", JSON.stringify({ instanceUrl: inst, clientId, clientSecret }), a.u?.email || "team", { instanceUrl: inst });
    S(req).add("audit", { eventId: "", what: `connected Salesforce (${inst})`, kind: "team", who: a.u?.name || "Team", email: a.u?.email || null, verified: !!a.u, at: Date.now() });
    res.json({ ok: true, connection: listConnections(a.ws).find((c) => c.provider === "salesforce") });
  });
  // Slack, Linear and Gong: each checked with one cheap call before anything is stored.
  const check = async (url, init) => {
    try { const r = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, ok: r.ok, json: j }; }
    catch { return null; }
  };
  const VERIFY = {
    email: async (b) => {
      const service = String(b.service || "").trim().toLowerCase(), key = String(b.key || b.token || "").trim(), from = String(b.from || "").trim().toLowerCase(), fromName = String(b.fromName || "").replace(/[<>"\r\n]/g, "").trim().slice(0, 80);
      if (!EMAIL_SERVICES[service]) return { error: [400, "invalid", "Choose Resend, Postmark or SendGrid."] };
      if (!key || key.length > 400) return { error: [400, "invalid", "Paste the API key."] };
      if (!EMAIL_RE.test(from)) return { error: [400, "invalid", "Add the address emails come from, on a domain you've verified with the service."] };
      const v = await verifyEmailKey(service, key);
      if (!v.ok) return { error: [v.status, v.code || "invalid", v.message] };
      return { secret: JSON.stringify({ service, key, from, fromName }), meta: { service, from } };
    },
    slack: async (b) => {
      const token = String(b.token || "").trim(), channel = String(b.channel || "").trim().slice(0, 80);
      if (!/^xox[bp]-[A-Za-z0-9-]{10,300}$/.test(token)) return { error: [400, "invalid", "token must be a Slack bot token (xoxb-…)."] };
      const r = await check("https://slack.com/api/auth.test", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" } });
      if (!r) return { error: [502, "upstream_error", "Couldn't reach Slack to check the token."] };
      if (!r.ok || !r.json?.ok) return { error: [400, "invalid_token", `Slack didn't accept that token (${r.json?.error || "HTTP " + r.status}).`] };
      return { secret: token, meta: { team: r.json.team || null, ...(channel ? { channel } : {}) } };
    },
    linear: async (b) => {
      const token = String(b.token || "").trim(), teamId = String(b.teamId || "").trim().slice(0, 80);
      if (!token || token.length > 300) return { error: [400, "invalid", "token is required"] };
      const gql = (query) => check("https://api.linear.app/graphql", { method: "POST", headers: { Authorization: token, "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
      const r = await gql("{ viewer { id } }");
      if (!r) return { error: [502, "upstream_error", "Couldn't reach Linear to check the key."] };
      if (!r.ok || r.json?.errors?.length || !r.json?.data?.viewer?.id) return { error: [400, "invalid_token", "Linear didn't accept that API key."] };
      let team = teamId ? { id: teamId } : null;
      if (!team) { const t = await gql("{ teams(first: 1) { nodes { id name } } }"); team = t?.json?.data?.teams?.nodes?.[0] || null; } // issues go to the first team unless one is given
      return { secret: token, meta: team ? { teamId: team.id, ...(team.name ? { teamName: team.name } : {}) } : {} };
    },
    gong: async (b) => {
      const key = String(b.accessKey || "").trim(), sec = String(b.accessKeySecret || "").trim(), base = gongOrigin(b.baseUrl);
      if (!base) return { error: [400, "invalid", "baseUrl must be an https://….gong.io address."] };
      if (!key || !sec || key.length > 300 || sec.length > 500) return { error: [400, "invalid", "accessKey and accessKeySecret are required."] };
      const r = await check(`${base}/v2/users?limit=1`, { headers: { Authorization: gongAuth(key, sec), Accept: "application/json" } });
      if (!r) return { error: [502, "upstream_error", "Couldn't reach Gong to check the keys."] };
      if (r.status === 401 || r.status === 403) return { error: [400, "invalid_token", "Gong didn't accept those keys."] };
      if (!r.ok) return { error: [502, "upstream_error", `Gong answered ${r.status} when checking the keys.`] };
      return { secret: JSON.stringify({ accessKey: key, accessKeySecret: sec, baseUrl: base }), meta: { baseUrl: base } };
    },
  };
  app.post("/api/connections", json, async (req, res, next) => {
    const provider = String(req.body?.provider || ""), verify = VERIFY[provider];
    if (!verify) return next();
    const a = adminOf(req, res); if (!a) return;
    const v = await verify(req.body);
    if (v.error) { const [status, code, message] = v.error; return res.status(status).json({ code, message }); }
    saveConnection(a.ws, provider, v.secret, a.u?.email || "team", v.meta);
    S(req).add("audit", { eventId: "", what: `connected ${CHECKS[provider].name}`, kind: "team", who: a.u?.name || "Team", email: a.u?.email || null, verified: !!a.u, at: Date.now() });
    res.json({ ok: true, connection: listConnections(a.ws).find((c) => c.provider === provider) });
  });
  const CHECKS = { email: { name: "Email sending" }, salesforce: { name: "Salesforce" }, slack: { name: "Slack" }, linear: { name: "Linear" }, gong: { name: "Gong" }, hubspot: { url: "https://api.hubapi.com/crm/v3/objects/companies?limit=1", name: "HubSpot" }, attio: { url: "https://api.attio.com/v2/self", name: "Attio" } };
  // ---------- Your data: export and delete (GDPR) ----------
  app.get("/api/workspace/export", (req, res) => {
    const a = adminOf(req, res); if (!a) return;
    if (a.ws === DEFAULT_WS) return res.status(409).json({ code: "not_available", message: "Export the default workspace from the server's database instead." });
    const out = exportWorkspace(a.ws);
    S(req).add("audit", { eventId: "", what: "exported the workspace's data", kind: "team", who: a.u?.name || "Team", email: a.u?.email || null, verified: !!a.u, at: Date.now() });
    res.setHeader("Content-Disposition", `attachment; filename="encore-${a.ws}-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(out);
  });
  app.post("/api/workspace/delete", json, (req, res) => {
    const a = adminOf(req, res); if (!a) return;
    if (a.ws === DEFAULT_WS) return res.status(409).json({ code: "not_available", message: "The default workspace can't be deleted from the app." });
    const W = getWorkspace(a.ws), want = String(W?.company || "").trim().toLowerCase();
    if (!want || String(req.body?.confirm || "").trim().toLowerCase() !== want) return res.status(400).json({ code: "confirm", message: `Type the company name (${W?.company || ""}) to confirm.` });
    const n = deleteWorkspace(a.ws);
    res.setHeader("Set-Cookie", "encore_auth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    res.json({ ok: true, deleted: n });
  });
  app.get("/api/connections", (req, res) => { const a = adminOf(req, res); if (!a) return; res.json({ connections: listConnections(a.ws) }); });
  app.post("/api/connections", json, async (req, res) => {
    const a = adminOf(req, res); if (!a) return;
    const provider = String(req.body?.provider || ""), token = String(req.body?.token || "").trim();
    if (!CONNECTION_PROVIDERS.includes(provider)) return res.status(400).json({ code: "invalid", message: `provider must be ${CONNECTION_PROVIDERS.join(" or ")}` });
    if (!token || token.length > 500) return res.status(400).json({ code: "invalid", message: "token is required" });
    // A cheap read proves the token works before it's stored.
    let r;
    try { r = await fetch(CHECKS[provider].url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(10_000) }); }
    catch { return res.status(502).json({ code: "upstream_error", message: `Couldn't reach ${CHECKS[provider].name} to check the token.` }); }
    if (r.status === 401 || r.status === 403) return res.status(400).json({ code: "invalid_token", message: `${CHECKS[provider].name} didn't accept that token. Check it and its scopes.` });
    if (!r.ok) return res.status(502).json({ code: "upstream_error", message: `${CHECKS[provider].name} answered ${r.status} when checking the token.` });
    const by = a.u?.email || "team";
    saveConnection(a.ws, provider, token, by);
    S(req).add("audit", { eventId: "", what: `connected ${CHECKS[provider].name}`, kind: "team", who: a.u?.name || "Team", email: a.u?.email || null, verified: !!a.u, at: Date.now() });
    res.json({ ok: true, connection: listConnections(a.ws).find((c) => c.provider === provider) });
  });
  app.delete("/api/connections/:provider", (req, res) => {
    const a = adminOf(req, res); if (!a) return;
    const provider = req.params.provider;
    if (!CONNECTION_PROVIDERS.includes(provider)) return res.status(404).json({ code: "not_found" });
    const removed = deleteConnection(a.ws, provider);
    if (removed) S(req).add("audit", { eventId: "", what: `disconnected ${CHECKS[provider].name}`, kind: "team", who: a.u?.name || "Team", email: a.u?.email || null, verified: !!a.u, at: Date.now() });
    res.json({ ok: true, removed });
  });
  // The contact inbox is for this server's operator: the default workspace's team.
  app.get("/api/contact", (req, res) => {
    if (sessionWorkspace(req) !== DEFAULT_WS || (!currentUser(req) && teamOf(DEFAULT_WS).length) || req.guest) return res.status(403).json({ code: "not_granted" });
    res.json({ messages: listContacts().slice(0, 500) });
  });

  mountMcp(app, { scoped: (ws) => scopeStore(store, ws), afterEventWrite, json, findToken: findMcpToken, writable: (ws) => trialState(getWorkspace(ws)).writable, claimEvent });

  // ---------- who's signed in; append-only audit log ----------
  app.get("/api/me", (req, res) => {
    const u = currentUser(req), ws = sessionWorkspace(req), W = getWorkspace(ws), T = trialState(W);
    const teamRoles = [...new Set(teamOf(ws).flatMap((x) => x.roles || []))];
    const workspace = { id: ws, company: W?.company || "", plan: W?.plan || "self-hosted", trial: T.trial, trialEnded: T.trialEnded, daysLeft: T.daysLeft };
    res.json(u ? { name: u.name, email: u.email, roles: u.roles, teamRoles, approverRoles: approverRoles(ws), owner: !!u.owner, workspace, verified: true } : { verified: false, teamConfigured: teamOf(ws).length > 0 });
  });
  // The audit log can only be appended to, and the server stamps who and when.
  const AUDIT = /^(faq|followers|kudos|vibes|chat|moments|jobs|inquiries|stats|broadcasts|orders|audit|approvals|aeactions|system|signoffs|outbox|crmwrites|reminders|settings|checks|checkReplies)(\/|$)/;
  app.use("/api/db", (req, res, next) => {
    // "system" holds accounts and secrets, "ws" holds other workspaces' data: never reachable through the data API.
    if (/^(system|ws)(\/|$)/.test(String(req.query.path || ""))) return res.status(403).json({ code: "not_granted" });
    if (req.method !== "GET" && AUDIT.test(String(req.query.path || ""))) return res.status(403).json({ code: "not_granted", message: "The audit log is append-only. Use /api/audit." });
    next();
  });
  app.post("/api/audit", json, (req, res) => {
    const u = currentUser(req), b = req.body || {};
    const eventId = String(b.eventId || "").slice(0, 80), what = String(b.what || "").trim().slice(0, 500);
    if (!what) return res.status(400).json({ code: "invalid", message: "what is required" });
    res.json(S(req).add("audit", { eventId, what, kind: "note", who: u?.name || "Unverified user", email: u?.email || null, verified: !!u, at: Date.now() }));
  });
  // Plan approvals are recorded by the server: it checks the signed-in person's roles,
  // keeps the approval in a collection the data API can't write, and logs it.
  app.post("/api/approve", json, (req, res) => {
    const u = currentUser(req), b = req.body || {};
    const eventId = String(b.eventId || "").slice(0, 80), role = String(b.role || "").trim().slice(0, 80);
    if (!eventId || !role) return res.status(400).json({ code: "invalid", message: "eventId and role are required" });
    const ws = sessionWorkspace(req);
    if (teamOf(ws).length && !u) return res.status(401).json({ code: "not_granted", message: "Sign in as a team member to approve." });
    if (u && !u.roles.some((r) => r.toLowerCase() === role.toLowerCase())) return res.status(403).json({ code: "not_granted", message: `${u.name} doesn't have the "${role}" role.` });
    if (u && authEnabled() && !hasPersonalPassword(u)) return res.status(403).json({ code: "not_granted", message: `${u.name} signs in with the team password, so can't approve as a named person. Give them a personal password.` });
    const ev = /^[A-Za-z0-9_-]+$/.test(eventId) ? S(req).get("events/" + eventId) : null;
    if (!ev) return res.status(404).json({ code: "not_found", message: "Save the event before approving it." });
    // Record the configured spelling of the role, matched case-insensitively.
    const required = requiredApprovers(ev.data, ws), configured = required.find((r) => r.toLowerCase() === role.toLowerCase());
    if (approverRolesConfigured(ws) && !configured) return res.status(403).json({ code: "not_granted", message: `"${role}" isn't an approver role. Approvers: ${required.join(", ")}.` });
    const canonical = configured || (u ? u.roles.find((r) => r.toLowerCase() === role.toLowerCase()) : role);
    const path = "approvals/" + eventId, cur = S(req).get(path)?.data || { eventId, roles: {} }, money = eventMoney(ev.data);
    const approval = { by: u?.name || "Unverified user", email: u?.email || null, verified: !!u, at: Date.now(), cost: money.cost, committed: money.committed, currency: money.currency };
    // Separation of duties (ENCORE_ONE_APPROVAL_PER_PERSON=1): one person can't fill two approver roles on the same event.
    if (!b.withdraw && process.env.ENCORE_ONE_APPROVAL_PER_PERSON === "1") {
      const same = Object.entries(cur.roles).find(([r, a]) => r !== canonical && (approval.email ? a.email === approval.email : a.by === approval.by));
      if (same) return res.status(409).json({ code: "conflict", message: `${approval.by} already approved this plan as ${same[0]}. Each approver role needs a different person.` });
    }
    if (b.withdraw) delete cur.roles[canonical]; else cur.roles[canonical] = approval;
    S(req).set(path, cur);
    S(req).add("audit", { eventId, what: `${String(ev.data.name || eventId).slice(0, 120)}: ${b.withdraw ? "withdrew approval" : `approved the plan at ${money.currency} ${approval.cost.toLocaleString("en-US")} planned, ${money.currency} ${approval.committed.toLocaleString("en-US")} committed`} as ${canonical}`, who: approval.by, email: approval.email, verified: approval.verified, at: approval.at });
    res.json({ ok: true, approval, roles: cur.roles, ...approvalState(ev.data, cur.roles, ws) });
  });
  // When a saved event's cost or commitments move more than 5% from what was approved, the server clears the approvals.
  function afterEventWrite(st, p) {
    const m = /^events\/([A-Za-z0-9_-]+)$/.exec(p); if (!m) return;
    if (st.ws && st.ws !== DEFAULT_WS) X.onEventChange(st.ws, m[1], process.env.ENCORE_PUBLIC_URL || "").catch(() => {});
    const so = st.get("signoffs/" + m[1]), evN = st.get(p);
    if (so && evN) { const nowM = eventMoney(evN.data); let changed = false;
      for (const r of so.data.requests || []) if (r.status === "approved" && Math.abs(nowM.cost - (r.decidedCost ?? r.cost)) > Math.max(500, (r.decidedCost ?? r.cost) * 0.05)) { r.status = "stale"; r.staleAt = Date.now(); r.staleCost = nowM.cost; changed = true; }
      if (changed) { st.set("signoffs/" + m[1], so.data); st.add("audit", { eventId: m[1], what: `${evN.data.name || m[1]}: sign-off needs renewing; the plan is now ${nowM.currency} ${nowM.cost.toLocaleString("en-US")}`, who: "Encore server", email: null, verified: true, at: Date.now() }); } }
    const ap = st.get("approvals/" + m[1]); if (!ap || !Object.keys(ap.data.roles || {}).length) return;
    const ev = st.get(p); if (!ev) return;
    const now = eventMoney(ev.data), moved = (a, b) => Math.abs(a - b) > Math.max(500, b * 0.05);
    const stale = Object.entries(ap.data.roles).filter(([, a]) => (a.currency || "USD") !== now.currency || moved(now.cost, a.cost || 0) || moved(now.committed, a.committed || 0));
    if (!stale.length) return;
    for (const [r] of stale) delete ap.data.roles[r];
    st.set("approvals/" + m[1], ap.data);
    st.add("audit", { eventId: m[1], what: `${ev.data.name || m[1]}: approvals reset (${stale.map(([r]) => r).join(", ")}): the plan is now ${now.currency} ${now.cost.toLocaleString("en-US")} with ${now.currency} ${now.committed.toLocaleString("en-US")} committed`, who: "Encore server", email: null, verified: true, at: Date.now() });
  }
  // The server decides whether a plan is fully approved: every required role has a current approval.
  function approvalState(evData, roles, ws) {
    const required = requiredApprovers(evData, ws), have = new Set(Object.keys(roles || {}).map((r) => r.toLowerCase()));
    return { required, fullyApproved: required.length > 0 && required.every((r) => have.has(r.toLowerCase())) };
  }
  app.get("/api/approvals", (req, res) => {
    const id = String(req.query.eventId || "").replace(/[^A-Za-z0-9_-]/g, "_");
    const roles = S(req).get("approvals/" + id)?.data?.roles || {};
    res.json({ roles, ...approvalState(S(req).get("events/" + id)?.data, roles, req.ws) });
  });
  app.get("/api/audit", (req, res) => {
    const id = String(req.query.eventId || "");
    // MCP reads are logged (kind "read") but left out of the decision log unless asked for with ?reads=1.
    const reads = req.query.reads === "1";
    res.json({ entries: S(req).list("audit").map((d) => d.data).filter((e) => (!id || e.eventId === id) && (reads || e.kind !== "read")).sort((a, b) => b.at - a.at).slice(0, 500) });
  });

  // ---------- AE follow-up pages: signed per-AE links ----------
  const aeSlug = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "ae";
  const secret = () => { let s0 = store.get("system/secret")?.data?.v; if (!s0) { s0 = randomBytes(32).toString("hex"); store.set("system/secret", { v: s0 }); } return process.env.SESSION_SECRET || s0; };
  // Signed links name the workspace too (except the default one, so its old links keep working), and are only
  // handed out for events in the asker's own workspace.
  const tag = (ws) => (!ws || ws === DEFAULT_WS ? "" : ws + ":");
  const hmac32 = (msg) => createHmac("sha256", secret()).update(msg).digest("hex").slice(0, 32);
  const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b || "")); return x.length === y.length && timingSafeEqual(x, y); };
  const aeToken = (ws, eventId, slug) => hmac32(`ae:${tag(ws)}${eventId}:${slug}`);
  const signedOk = (ws, kind, id, token) => eq(hmac32(`${kind}:${tag(ws)}${id}`), token);
  const ownEvent = (req, res, id) => {
    if (req.guest) { res.status(401).json({ code: "not_granted" }); return false; }
    if (!/^[A-Za-z0-9_-]+$/.test(id)) { res.status(400).json({ code: "invalid", message: "eventId is required" }); return false; }
    if (workspaceOfEvent(id) !== sessionWorkspace(req)) { res.status(404).json({ code: "not_found", message: "No such event in your workspace." }); return false; }
    return true;
  };
  app.get("/api/plantoken", (req, res) => {
    const id = String(req.query.eventId || "");
    if (!ownEvent(req, res, id)) return;
    res.json({ token: hmac32(`plan:${tag(sessionWorkspace(req))}${id}`) });
  });
  // Signed personal invites: a token per (event, guest) lets that guest's RSVP page greet them by name.
  const inviteToken = (ws, eventId, key) => hmac32(`${tag(ws)}${eventId}|${key}`);
  app.post("/api/invitetoken", json, (req, res) => {
    const b = req.body || {}, eventId = String(b.eventId || ""), ws = sessionWorkspace(req);
    if (!ownEvent(req, res, eventId)) return;
    if (Array.isArray(b.guestKeys)) {
      const tokens = {};
      for (const k of b.guestKeys.slice(0, 2000)) { const key = String(k ?? ""); if (key) tokens[key] = inviteToken(ws, eventId, key); }
      return res.json({ tokens });
    }
    const key = String(b.guestKey ?? "");
    if (!key) return res.status(400).json({ code: "invalid", message: "guestKey or guestKeys is required" });
    res.json({ token: inviteToken(ws, eventId, key) });
  });
  /** The guest an "x-encore-invite: <encodeURIComponent(guestKey)>~<token>" header names, if it verifies. */
  function invitedGuest(req, eventId, data) {
    const h = String(req.get("x-encore-invite") || ""), i = h.lastIndexOf("~");
    if (i < 1) return null;
    let key; try { key = decodeURIComponent(h.slice(0, i)); } catch { return null; }
    if (!eq(inviteToken(req.ws, eventId, key), h.slice(i + 1))) return null;
    return (data.guests || []).find((g) => guestKeyOf(g) === key) || null;
  }
  const aeOk = (ws, eventId, slug, token) => eq(aeToken(ws, eventId, slug), token);
  /** On a nominate view with a signed AE token: which AE it is (found among the event's owners, or x-encore-ae) and up to
   * 12 of their own people (event guests and scout contacts they own), name/title/company only. */
  function nominatingAe(req, eventId, data) {
    const t = req.get("x-encore-token"); if (!t) return null;
    const owners = [req.get("x-encore-ae"), ...(data.guests || []).map((g) => g.owner), ...(data.scout?.contacts || []).map((c) => c.owner)].filter(Boolean);
    const slug = [...new Set(owners.map(aeSlug))].find((s0) => aeOk(req.ws, eventId, s0, t));
    if (!slug) return null;
    const seen = new Set(), suggest = [];
    for (const p of [...(data.guests || []), ...(data.scout?.contacts || [])]) {
      if (!p?.name || !p.owner || aeSlug(p.owner) !== slug) continue;
      const k = (p.name + "|" + (p.company || "")).toLowerCase(); if (seen.has(k)) continue; seen.add(k);
      suggest.push({ name: String(p.name), title: String(p.title || ""), company: String(p.company || "") });
      if (suggest.length >= 12) break;
    }
    return { slug, suggest };
  }
  app.get("/api/aelink", (req, res) => {
    const eventId = String(req.query.eventId || ""), slug = aeSlug(req.query.ae);
    if (!ownEvent(req, res, eventId)) return;
    res.json({ token: aeToken(sessionWorkspace(req), eventId, slug), slug });
  });
  app.get("/api/aepage", (req, res) => {
    const eventId = String(req.query.eventId || ""), slug = String(req.query.ae || "");
    req.ws = workspaceOfEvent(eventId); // AE links work signed in or not: the event decides the workspace
    if (!aeOk(req.ws, eventId, slug, req.query.t)) return res.status(403).json({ code: "not_granted", message: "This link isn't valid. Ask marketing for a new one." });
    const ev = /^[A-Za-z0-9_-]+$/.test(eventId) ? S(req).get("events/" + eventId) : null; if (!ev) return res.status(404).json({ code: "not_found" });
    const all = ev.data.guests || [], mine = all.filter((g) => aeSlug(g.owner) === slug).map((g) => ({ gi: all.indexOf(g), ikey: guestKeyOf(g), itok: inviteToken(req.ws, eventId, guestKeyOf(g)), name: g.name, title: g.title, company: g.company, status: g.status, owner: g.owner, note: g.note, nextStep: g.nextStep, gift: g.gift, giftStatus: g.giftStatus, fuDraft: g.fuDraft, fuState: g.fuState, nsDoneAt: g.nsDoneAt, nudge: g.nudge, nudgeOkAt: g.nudgeOkAt }));
    const actions = S(req).list("aeactions").map((d) => d.data).filter((a) => a.eventId === eventId && a.aeSlug === slug);
    res.json({ event: { id: eventId, name: ev.data.name, brand: ev.data.brand, date: ev.data.date, copy: ev.data.copy ? { title: ev.data.copy.title } : null, audience: ev.data.audience, guests: mine, goingCount: (ev.data.guests || []).filter((g) => g.status === "Going" || g.status === "Attended").length }, actions });
  });
  app.post("/api/aeaction", json, (req, res) => {
    const b = req.body || {}, eventId = String(b.eventId || ""), slug = String(b.ae || "");
    req.ws = workspaceOfEvent(eventId);
    if (!aeOk(req.ws, eventId, slug, b.t)) return res.status(403).json({ code: "not_granted", message: "This link isn't valid." });
    const ev = /^[A-Za-z0-9_-]+$/.test(eventId) ? S(req).get("events/" + eventId) : null; if (!ev) return res.status(404).json({ code: "not_found" });
    const same = (ev.data.guests || []).filter((x) => x.name === b.guest && aeSlug(x.owner) === slug && (!b.company || x.company === b.company));
    if (same.length > 1) return res.status(409).json({ code: "conflict", message: "Two of your guests share that name; include the company." });
    const g = same[0];
    if (!g) return res.status(403).json({ code: "not_granted", message: "That guest isn't one of yours." });
    const action = String(b.action || ""); if (!["approve", "sent", "done", "note", "nudge", "roe"].includes(action)) return res.status(400).json({ code: "invalid" });
    const rec = { eventId, guest: g.name, ae: g.owner, aeSlug: slug, action, at: Date.now(), ...(b.draft ? { draft: String(b.draft).slice(0, 8000) } : {}), ...(b.note ? { note: String(b.note).slice(0, 4000) } : {}), ...(b.nudge ? { nudge: String(b.nudge).slice(0, 4000) } : {}) };
    S(req).add("aeactions", rec);
    res.json({ ok: true, action: rec });
  });

  // ---------- Email from Encore ----------
  const originOf = (req) => process.env.ENCORE_PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
  /** Send as the signed-in person (reply-to them), log it in the outbox and the audit log. */
  async function mailFrom(req, { to, cc, subject, text, eventId = "", kind = "email" }) {
    const ws = sessionWorkspace(req), cfg = emailConfig(ws, ws === DEFAULT_WS), u = currentUser(req);
    if (!cfg) return { ok: false, code: "email_off", error: "Email isn't set up. Connect a sending service in Setup." };
    const hour = Date.now() - 36e5, recent = S(req).list("outbox").filter((d) => d.data?.at > hour).length;
    if (recent >= +(process.env.ENCORE_EMAIL_PER_HOUR || 300)) return { ok: false, code: "rate_limited", error: "Hourly email limit reached. Try again later." };
    const r = await sendEmail(cfg, { to, cc, subject, text, replyTo: u?.email, fromName: u?.name ? `${u.name}${getWorkspace(ws)?.company ? " at " + getWorkspace(ws).company : ""}` : "" });
    const rec = { kind, eventId, to: [].concat(to), subject: String(subject || "").slice(0, 200), by: u?.email || null, at: Date.now(), status: r.ok ? "sent" : "failed", error: r.error || null, providerId: r.id || null };
    S(req).add("outbox", rec);
    if (r.ok) S(req).add("audit", { eventId, what: `emailed ${[].concat(to).join(", ")}: "${rec.subject}"`, kind: "email", who: u?.name || "Team", email: u?.email || null, verified: !!u, at: rec.at });
    return r;
  }
  app.get("/api/email/status", (req, res) => { const ws = sessionWorkspace(req); res.json(publicEmailConfig(emailConfig(ws, ws === DEFAULT_WS))); });
  app.post("/api/email/send", json, async (req, res) => {
    if (req.guest) return res.status(403).json({ code: "not_granted" });
    const b = req.body || {}, to = [].concat(b.to || []).map((x) => String(x).trim()).filter(Boolean);
    if (!to.length || to.length > 5 || !to.every((x) => EMAIL_RE.test(x))) return res.status(400).json({ code: "invalid", message: "Add one to five valid email addresses." });
    if (!String(b.subject || "").trim() || !String(b.text || "").trim()) return res.status(400).json({ code: "invalid", message: "Subject and message are required." });
    const eventId = String(b.eventId || "").slice(0, 80);
    if (eventId && !/^[A-Za-z0-9_-]+$/.test(eventId)) return res.status(400).json({ code: "invalid" });
    const r = await mailFrom(req, { to, cc: b.cc, subject: b.subject, text: b.text, eventId, kind: String(b.kind || "email").slice(0, 40) });
    if (!r.ok) return res.status(r.code === "email_off" ? 409 : r.code === "rate_limited" ? 429 : 502).json({ code: r.code || "send_failed", message: r.error });
    res.json({ ok: true, id: r.id });
  });
  app.get("/api/email/outbox", (req, res) => {
    if (req.guest) return res.status(403).json({ code: "not_granted" });
    const id = String(req.query.eventId || "");
    res.json({ messages: S(req).list("outbox").map((d) => d.data).filter((m) => !id || m.eventId === id).sort((a, b) => b.at - a.at).slice(0, 200) });
  });
  // ---------- Deadline reminders (email, weekday mornings) ----------
  app.get("/api/reminders", async (req, res) => {
    if (req.guest) return res.status(403).json({ code: "not_granted" });
    const st = S(req), ws = sessionWorkspace(req), on = st.get("settings/reminders")?.data?.on !== false;
    const preview = await runReminders(st, { dryRun: true, origin: originOf(req) });
    res.json({ on, email: publicEmailConfig(emailConfig(ws, ws === DEFAULT_WS)), schedule: process.env.PM_CRON === "off" ? null : (process.env.PM_CRON || "0 8 * * 1-5") + " " + (process.env.PM_TZ || "America/Chicago"), people: preview.people.map(({ preview: text, ...p }) => ({ ...p, text })), skipped: preview.skipped.slice(0, 20) });
  });
  app.post("/api/reminders", json, async (req, res) => {
    const a = adminOf(req, res); if (!a) return;
    if (typeof req.body?.on === "boolean") { S(req).set("settings/reminders", { on: req.body.on, by: a.u?.email || "team", at: Date.now() }); S(req).add("audit", { eventId: "", what: `${req.body.on ? "turned on" : "turned off"} deadline reminder emails`, kind: "team", who: a.u?.name || "Team", email: a.u?.email || null, verified: !!a.u, at: Date.now() }); }
    if (req.body?.sendNow) return res.json(await runReminders(S(req), { origin: originOf(req), ...(req.body.now ? { now: Number(req.body.now) } : {}) }));
    res.json({ ok: true, on: S(req).get("settings/reminders")?.data?.on !== false });
  });
  // ---------- CRM writes: RevOps only, or queued for RevOps to approve ----------
  const CRM_WRITES = new Set(["upsert_event_attendees", "log_followups", "rollup_account_spend"]);
  const isRevOps = (u) => !!u && (u.roles || []).some((r) => /^(rev\s?ops|revenue operations|crm admin|sales ?ops)$/i.test(String(r).trim()));
  const canWriteCrm = (req) => isRevOps(currentUser(req)) || (!authEnabled() && sessionWorkspace(req) === DEFAULT_WS && !teamOf(DEFAULT_WS).length);
  const crmSummary = (tool, input) => tool === "upsert_event_attendees" ? `add ${(input?.members || []).length} attendees to the "${input?.eventName || "event"}" campaign`
    : tool === "log_followups" ? `log ${(input?.items || []).length} follow-up next steps for ${input?.eventName || "an event"}`
    : `write event spend onto ${(input?.accounts || []).length} accounts`;
  app.get("/api/crmwrites", (req, res) => {
    if (req.guest) return res.status(403).json({ code: "not_granted" });
    res.json({ canApprove: canWriteCrm(req), requests: S(req).list("crmwrites").map((d) => ({ id: d.id, ...d.data, input: undefined, rows: d.data.rows })).sort((a, b) => b.at - a.at).slice(0, 100) });
  });
  app.post("/api/crmwrites/:id", json, async (req, res) => {
    if (!canWriteCrm(req)) return res.status(403).json({ code: "not_granted", message: "Only RevOps can approve CRM writes." });
    const path = "crmwrites/" + String(req.params.id).replace(/[^A-Za-z0-9_-]/g, ""), cur = S(req).get(path);
    if (!cur) return res.status(404).json({ code: "not_found" });
    if (cur.data.status !== "pending") return res.status(409).json({ code: "conflict", message: "Already decided." });
    const u = currentUser(req), decision = req.body?.decision === "approve" ? "approved" : req.body?.decision === "reject" ? "rejected" : null;
    if (!decision) return res.status(400).json({ code: "invalid" });
    const rec = { ...cur.data, status: decision, decidedBy: u?.name || "RevOps", decidedByEmail: u?.email || null, decidedAt: Date.now(), note: String(req.body?.note || "").slice(0, 500) };
    let result = null;
    if (decision === "approved") {
      const ws = sessionWorkspace(req);
      if (!serversFor(req).some((x) => x.server === rec.server)) return res.status(409).json({ code: "server_not_connected", message: "The CRM isn't connected any more." });
      try { result = await withCrm(connectionTokens(ws), ws === DEFAULT_WS, () => callTool(rec.server, rec.tool, rec.input, serversFor(req))); rec.result = "written"; }
      catch (e) { rec.status = "failed"; rec.result = String(e?.message || e?.code || "failed").slice(0, 300); }
    }
    S(req).set(path, rec);
    S(req).add("audit", { eventId: rec.eventId || "", what: `${rec.decidedBy} ${rec.status === "approved" ? "approved" : rec.status} a CRM write: ${rec.summary}${rec.note ? ` ("${rec.note}")` : ""}`, kind: "crm", who: rec.decidedBy, email: rec.decidedByEmail, verified: !!u, at: rec.decidedAt });
    res.json({ ok: rec.status !== "failed", request: { id: req.params.id, ...rec, input: undefined }, result });
  });

  // ---------- Sign-off requests: a signed, no-login link for the person who says yes to the budget ----------
  const soToken = (ws, eventId, rid, email) => hmac32(`so:${tag(ws)}${eventId}:${rid}:${String(email).toLowerCase()}`);
  const soClean = (r) => ({ id: r.id, name: r.name, email: r.email, requestedBy: r.requestedBy, at: r.at, status: r.status, staleCost: r.staleCost || null, decidedAt: r.decidedAt || null, comment: r.comment || "", cost: r.cost, currency: r.currency, remindedAt: r.remindedAt || null });
  app.post("/api/signoff/request", json, async (req, res) => {
    const u = currentUser(req), b = req.body || {}, eventId = String(b.eventId || ""), ws = sessionWorkspace(req);
    if (!ownEvent(req, res, eventId)) return;
    const email = String(b.email || "").trim().toLowerCase().slice(0, 200), name = String(b.name || "").trim().slice(0, 120) || email.split("@")[0];
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ code: "invalid", message: "Add the approver's work email." });
    if (u?.email && u.email.toLowerCase() === email) return res.status(409).json({ code: "self_approval", message: "You can't sign off your own plan. Ask your manager or budget owner." });
    const ev = S(req).get("events/" + eventId); if (!ev) return res.status(404).json({ code: "not_found", message: "Save the event first." });
    const money = eventMoney(ev.data), path = "signoffs/" + eventId, cur = S(req).get(path)?.data || { eventId, requests: [] };
    const r = { id: randomBytes(5).toString("hex"), email, name, note: String(b.note || "").slice(0, 1000), requestedBy: u?.name || "Event lead", requestedByEmail: u?.email || null, at: Date.now(), status: "pending", cost: money.cost, committed: money.committed, currency: money.currency };
    cur.requests = [r, ...cur.requests.filter((x) => !(x.email === email && x.status === "pending"))].slice(0, 20);
    S(req).set(path, cur);
    S(req).add("audit", { eventId, what: `${String(ev.data.name || eventId).slice(0, 120)}: asked ${name} <${email}> to sign off ${money.currency} ${money.cost.toLocaleString("en-US")}`, who: r.requestedBy, email: r.requestedByEmail, verified: !!u, at: r.at });
    const token = soToken(ws, eventId, r.id, email);
    const emailed = b.message ? await mailFrom(req, { to: email, subject: `Sign-off: ${ev.data.name || "event plan"}`, text: String(b.message).replace("{{link}}", `${originOf(req)}/g#signoff-${eventId}-${r.id}~${token}`), eventId, kind: "signoff" }) : null;
    res.json({ request: soClean(r), token, ws: ws === DEFAULT_WS ? null : ws, emailed: !!emailed?.ok, emailError: emailed && !emailed.ok ? emailed.error : undefined });
  });
  app.post("/api/signoff/remind", json, async (req, res) => {
    const b = req.body || {}, eventId = String(b.eventId || ""), ws = sessionWorkspace(req);
    if (!ownEvent(req, res, eventId)) return;
    const path = "signoffs/" + eventId, cur = S(req).get(path)?.data; const r = cur?.requests?.find((x) => x.id === b.id && x.status === "pending");
    if (!r) return res.status(404).json({ code: "not_found" });
    r.remindedAt = Date.now(); S(req).set(path, cur);
    const token = soToken(ws, eventId, r.id, r.email), ev = S(req).get("events/" + eventId);
    const emailed = b.message ? await mailFrom(req, { to: r.email, subject: `Reminder: sign-off for ${ev?.data?.name || "the event plan"}`, text: String(b.message).replace("{{link}}", `${originOf(req)}/g#signoff-${eventId}-${r.id}~${token}`), eventId, kind: "signoff-reminder" }) : null;
    res.json({ request: soClean(r), token, emailed: !!emailed?.ok, emailError: emailed && !emailed.ok ? emailed.error : undefined });
  });
  app.get("/api/signoff", (req, res) => {
    const eventId = String(req.query.eventId || ""); if (!ownEvent(req, res, eventId)) return;
    res.json({ requests: (S(req).get("signoffs/" + eventId)?.data?.requests || []).map(soClean) });
  });
  const soFind = (req, eventId, rid, t) => {
    req.ws = workspaceOfEvent(eventId);
    const cur = /^[A-Za-z0-9_-]+$/.test(eventId) ? S(req).get("signoffs/" + eventId)?.data : null, r = cur?.requests?.find((x) => x.id === rid);
    if (!r || !eq(soToken(req.ws, eventId, rid, r.email), t)) return null;
    return { cur, r };
  };
  app.get("/api/signoff/view", (req, res) => {
    const eventId = String(req.query.eventId || ""), f = soFind(req, eventId, String(req.query.rid || ""), req.query.t);
    if (!f) return res.status(403).json({ code: "not_granted", message: "This sign-off link isn't valid. Ask for a new one." });
    const ev = S(req).get("events/" + eventId); if (!ev) return res.status(404).json({ code: "not_found" });
    const d = ev.data, money = eventMoney(d);
    res.json({ request: { ...soClean(f.r), note: f.r.note || "" }, now: money, event: { name: d.name, kind: d.kind, date: d.date, city: d.city, headcount: d.headcount, budget: d.budget, currency: d.currency, goal: d.goal, audience: d.audience, concept: String(d.concept || "").slice(0, 600), pitch: d.pitch ? { summary: d.pitch.oneLiner || d.pitch.summary, why: d.pitch.whyNow || d.pitch.why, ask: d.pitch.ask, outcomes: (d.pitch.outcomes || []).slice(0, 4), risks: (d.pitch.risks || []).slice(0, 4), impact: d.pitch.impact || null } : null, pubTitle: d.pubTitle, startTime: d.startTime, venueName: d.venueName, guestCount: (d.guests || []).length, tierA: (d.guests || []).filter((g) => g.tier === "A").map((g) => g.company).filter(Boolean).filter((c, i, a) => a.indexOf(c) === i).slice(0, 12), lines: (d.produce?.budget || []).slice(0, 14).map((l) => ({ label: l.line || l.item || l.label || "", amount: +l.amount || 0 })) } });
  });
  app.post("/api/signoff/decide", json, async (req, res) => {
    const b = req.body || {}, eventId = String(b.eventId || ""), f = soFind(req, eventId, String(b.rid || ""), b.t);
    if (!f) return res.status(403).json({ code: "not_granted", message: "This sign-off link isn't valid." });
    const decision = String(b.decision || ""); if (!["approved", "changes", "declined"].includes(decision)) return res.status(400).json({ code: "invalid" });
    if (f.r.status !== "pending") return res.status(409).json({ code: "conflict", message: "This request already has an answer." });
    const ev = S(req).get("events/" + eventId); if (!ev) return res.status(404).json({ code: "not_found" });
    const money = eventMoney(ev.data);
    Object.assign(f.r, { status: decision, decidedAt: Date.now(), comment: String(b.comment || "").slice(0, 2000), decidedCost: money.cost });
    S(req).set("signoffs/" + eventId, f.cur);
    const verb = { approved: "signed off", changes: "asked for changes to", declined: "declined" }[decision];
    S(req).add("audit", { eventId, what: `${String(ev.data.name || eventId).slice(0, 120)}: ${f.r.name} ${verb} the plan at ${money.currency} ${money.cost.toLocaleString("en-US")}${f.r.comment ? `: "${f.r.comment.slice(0, 200)}"` : ""}`, who: f.r.name, email: f.r.email, verified: true, via: "signed link", at: f.r.decidedAt });
    const cfgM = emailConfig(req.ws, req.ws === DEFAULT_WS), toR = f.cur.requests.find((x) => x.id === f.r.id)?.requestedByEmail;
    if (cfgM && toR) {
      const word = { approved: "approved", changes: "asked for changes to", declined: "declined" }[decision];
      const m = await sendEmail(cfgM, { to: toR, replyTo: f.r.email, subject: `${f.r.name} ${word} ${ev.data.name || "the plan"}`, text: `${f.r.name} ${word} the plan for ${ev.data.name || "your event"} at ${money.currency} ${money.cost.toLocaleString("en-US")}.${f.r.comment ? `\n\n"${f.r.comment}"` : ""}\n\nIt's in the event's decision log.` });
      S(req).add("outbox", { kind: "signoff-answer", eventId, to: [toR], subject: `${f.r.name} ${word} the plan`, at: Date.now(), status: m.ok ? "sent" : "failed", error: m.error || null });
    }
    res.json({ ok: true, request: soClean(f.r) });
  });

  // ---------- db ----------
  app.get("/api/db/doc", (req, res) => {
    const p = String(req.query.path || ""), doc = S(req).get(p);
    const where = req.guest ? { workspace: req.ws } : {}; // lets a guest page ask for the same workspace's brand and roadmap
    let data = doc?.data;
    if (doc && req.guest && p.startsWith("events/")) {
      const view = String(req.get("x-encore-view") || "");
      // Plan links are signed: an unsigned or forged plan view gets nothing.
      if (view === "plan" && !signedOk(req.ws, "plan", doc.id, req.get("x-encore-token"))) return res.status(403).json({ code: "not_granted", message: "This plan link isn't valid. Ask the event owner for a new one." });
      const invited = invitedGuest(req, doc.id, doc.data);
      const nom = view === "nominate" ? nominatingAe(req, doc.id, doc.data) : null;
      data = publicEvent(data, view);
      // guests read "Mina's place", never the host's own "my place"
      if (doc.data.casual && view !== "plan") { try { const hn = String(getDbUser(getWorkspace(req.ws)?.ownerEmail || "")?.name || "").trim().split(/\s+/)[0]; const fix = (x) => (typeof x === "string" ? x.replace(/\b(my|our) (place|apartment|flat|house|home)\b/gi, (m, w, pl) => (hn ? `${hn}'s ${pl.toLowerCase()}` : `the host's ${pl.toLowerCase()}`)) : x); for (const k of ["meetPoint", "venueName", "name", "pubTitle"]) if (data[k]) data[k] = fix(data[k]); } catch {} }
      // Get-togethers: which bring-list items or pickup windows are already taken (no names), so guests don't double up.
      if (doc.data.casual && !/giveaway/.test(doc.data.activity || "") && Array.isArray(doc.data.slots) && doc.data.slots.length) { const taken = new Set([...(doc.data.guests || []).map((g) => g.slot), ...S(req).list("rsvps").filter((d) => d.data?.eventId === doc.id && d.data.response === "going").map((d) => d.data.slot)].filter(Boolean)); data.claimed = doc.data.slots.filter((x) => taken.has(x)); }
      if (nom) { data.nomFor = nom.slug; data.nomSuggest = nom.suggest; }
      if (invited) {
        const first = (x) => String(x || "").trim().split(/\s+/)[0] || "";
        data.me = { name: invited.name || "", title: invited.title || "", company: invited.company || "", email: invited.email || "", owner: first(invited.owner) };
        // Their latest reply, so reopening the invitation shows it instead of a blank form.
        const inv = String(req.get("x-encore-invite") || "").split("~")[0], em = String(invited.email || "").trim().toLowerCase();
        const mine = S(req).list("rsvps").filter((d) => d.data?.eventId === doc.id && ((inv && d.data._inv === inv) || (em && String(d.data.email || "").trim().toLowerCase() === em))).sort((x, y) => (y.data.changedAt || y.data.createdAt || 0) - (x.data.changedAt || x.data.createdAt || 0))[0];
        const hostSt = { Going: "going", Attended: "going", Declined: "no", Maybe: "maybe", Waitlist: "waitlist", Requested: "requested" }[invited.status];
        const resp = mine?.data?.response || hostSt;
        if (resp) data.me.response = resp;
        if (mine) for (const k of ["dietary", "access", "plusOne"]) if (mine.data[k] != null) data.me[k] = mine.data[k];
        data.hosts = [...new Set((doc.data.guests || []).filter(shownToGuests).map((g) => first(g.owner)).filter(Boolean))];
      }
    }
    if (doc && req.guest && p === "brands/main") data = publicBrand(data);
    if (doc && req.guest && p === "canvas/main") data = publicCanvas(data);
    res.json(doc ? { exists: true, id: doc.id, data, updated: doc.updated, ...where } : { exists: false, id: p.split("/").pop(), ...where });
  });
  const guestKey = (req) => String(req.get("x-encore-key") || "").slice(0, 64);
  // Saves carry the version they started from; a stale save gets 409 instead of overwriting someone else's change.
  const versionOk = (req, res) => {
    const p = String(req.query.path || "");
    if (!/^events\//.test(p) || req.guest) return true;
    const m = /^events\/([^/]+)$/.exec(p);
    if (m && !claimEvent(m[1], sessionWorkspace(req))) { res.status(409).json({ code: "conflict", message: "That event id is already used. Save it under a new id." }); return false; }
    const base = req.body?._base; if (req.body) { delete req.body._base; delete req.body.approvals; }
    const cur = S(req).get(p);
    // A save that doesn't say which version it started from can't overwrite a versioned event.
    if (base == null && cur && cur.data?.updatedAt) { res.status(409).json({ code: "conflict", message: "This save didn't say which version of the event it started from. Reload the event, then save again." }); return false; }
    if (base != null && cur && cur.data?.updatedAt && cur.data.updatedAt !== base) { res.status(409).json({ code: "conflict", message: "Someone else changed this event since you opened it. Reload to see their changes, then save again." }); return false; }
    return true;
  };
  // Guest RSVPs and wall entries: the server stamps the source and only takes the statuses a guest may choose.
  const guestShape = (req, res, collection) => {
    if (!req.guest) return true;
    const b = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    if (collection === "rsvps") {
      for (const k of ["response", "status"]) if (b[k] != null && !GUEST_RSVP_RESPONSES.has(String(b[k]).toLowerCase())) { res.status(400).json({ code: "invalid", message: "An RSVP can only be going, maybe or declined." }); return false; }
      const utm = cleanUtm(b.utm); delete b.utm;
      // Ticketed dinners can open to followers first: everyone else waits until the window closes.
      if (String(b.response || "").toLowerCase() !== "no" && b.eventId) { const ws0 = workspaceOfEvent(String(b.eventId)), ev0 = ws0 && scopeStore(store, ws0).get("events/" + String(b.eventId))?.data;
        if (ev0 && earlyAccessBlocks(ev0, C.followersOf(ws0).some((f) => f.email === String(b.email || "").trim().toLowerCase()))) { res.status(403).json({ code: "early_access", message: `Followers get first dibs until ${new Date(ev0.earlyUntil).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}. Follow the host with this email to book now, or come back then.` }); return false; } }
      req.body = { ...b, source: "guest", ...(utm ? { utm } : {}) };
    }
    if (collection === "wall" && b.status != null && !GUEST_WALL_STATUSES.has(String(b.status))) { res.status(400).json({ code: "invalid", message: "Not a wall status." }); return false; }
    return true;
  };
  /** For a guest write to nominations/<eventId>--<aeSlug>: the AE token must verify for that event and AE. */
  const nominationOk = (req, res) => {
    const id = String(req.query.path || "").split("/")[1] || "", i = id.lastIndexOf("--");
    const eventId = i > 0 ? id.slice(0, i) : "", slug = i > 0 ? id.slice(i + 2) : "";
    req.ws = workspaceOfEvent(eventId);
    if (!eventId || !slug || !S(req).get("events/" + eventId) || !aeOk(req.ws, eventId, slug, req.get("x-encore-token"))) { res.status(401).json({ code: "not_granted", message: "This nomination link isn't valid. Ask marketing for a new one." }); return false; }
    const b = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    req.body = { ...b, eventId, ae: slug, source: "ae-link", at: Date.now() }; // the link decides whose nominations these are
    return true;
  };
  const ownedWrite = (req, res) => {
    if (!req.guest) return true;
    if (String(req.query.path || "").startsWith("nominations/")) return nominationOk(req, res);
    if (!guestShape(req, res, String(req.query.path || "").split("/")[0])) return false;
    const p = String(req.query.path || ""), cur = S(req).get(p), k = guestKey(req);
    if (!k) { res.status(403).json({ code: "not_granted", message: "Missing guest key." }); return false; }
    if (cur && cur.data?._k !== k) { res.status(403).json({ code: "not_granted", message: "You can only change your own response." }); return false; }
    req.body = { ...(req.body || {}), _k: k };
    return true;
  };
  app.put("/api/db/doc", json, (req, res) => { if (!ownedWrite(req, res) || !versionOk(req, res)) return; const r = S(req).set(String(req.query.path || ""), req.body); afterEventWrite(S(req), String(req.query.path || "")); res.json(r); });
  app.patch("/api/db/doc", json, (req, res) => { if (!ownedWrite(req, res) || !versionOk(req, res)) return; const r = S(req).update(String(req.query.path || ""), req.body); afterEventWrite(S(req), String(req.query.path || "")); res.json(r); });
  app.delete("/api/db/doc", (req, res) => res.json(S(req).delete(String(req.query.path || ""))));
  // ---------- conference nominations by link (sales and execs, no login) ----------
  const confnomToken = (ws) => hmac32("confnom|" + ws);
  app.get("/api/confnomlink", (req, res) => {
    if (req.guest) return res.status(401).json({ code: "not_granted" });
    const ws = sessionWorkspace(req), token = confnomToken(ws);
    res.json({ token, ws, link: `/g#confnom~ws-${ws}~${token}` });
  });
  /** A guest conference request: the workspace from x-encore-workspace, proven by the link's token. */
  const confnomGuest = (req, res) => {
    const ws = String(req.get("x-encore-workspace") || "");
    if (!(ws === DEFAULT_WS || (/^[A-Za-z0-9]{20}$/.test(ws) && getWorkspace(ws))) || !eq(confnomToken(ws), req.get("x-encore-token"))) { res.status(401).json({ code: "not_granted", message: "This nomination link isn't valid. Ask for a new one." }); return false; }
    req.ws = ws;
    return true;
  };
  const confHits = new Map();
  const cleanConference = (b) => {
    const str = (v, n) => String(v ?? "").trim().slice(0, n);
    const list = (v, n, each) => (Array.isArray(v) ? v : []).map((x) => str(x, each)).filter(Boolean).slice(0, n);
    const url = str(b.url, 500), date = str(b.date, 10);
    return { name: str(b.name, 200), url: /^https?:\/\//i.test(url) ? url : "", date: /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date + "T00:00:00Z")) && new Date(date + "T00:00:00Z").toISOString().slice(0, 10) === date ? date : "",
      city: str(b.city, 120), why: str(b.why, 2000), accounts: list(b.accounts, 50, 120), nominatedBy: list(b.nominatedBy, 10, 120), stage: "nominated", votes: {}, createdAt: Date.now(), source: "link" };
  };
  app.get("/api/db/collection", (req, res, next) => {
    if (!(req.guest && String(req.query.path || "") === "conferences")) return next();
    if (!confnomGuest(req, res)) return;
    // Enough to show "already on the list", nothing more.
    res.json({ docs: S(req).list("conferences").map((d) => ({ id: d.id, data: { name: d.data.name || "", date: d.data.date || "", city: d.data.city || "", stage: d.data.stage || "" } })) });
  });
  app.post("/api/db/collection", json, (req, res, next) => {
    if (!(req.guest && String(req.query.path || "") === "conferences")) return next();
    if (!confnomGuest(req, res)) return;
    const k = req.ip || "?", now = Date.now(); let h = confHits.get(k);
    if (!h || now - h.start > 3600_000) { h = { n: 0, start: now }; confHits.set(k, h); }
    if (++h.n > Number(process.env.ENCORE_CONFNOM_PER_HOUR || 20)) return res.status(429).json({ code: "rate_limited", message: "Too many nominations from here. Try again later." });
    const doc = cleanConference(req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {});
    if (!doc.name) return res.status(400).json({ code: "invalid", message: "Name the conference." });
    res.json(S(req).add("conferences", doc));
  });
  app.get("/api/db/collection", (req, res) => {
    let docs = S(req).list(String(req.query.path || ""));
    if (req.guest) {
      const ev = String(req.query.eventId || "");
      if (!ev) return res.status(400).json({ code: "invalid", message: "eventId is required" });
      // Only the wall is guest-readable (see guestAllowed): people going or maybe who chose to be shown, and only what they chose to show.
      docs = docs.filter((d) => d.data?.eventId === ev && ["going", "maybe"].includes(d.data.status || "going"))
        .map((d) => ({ id: d.id, updated: d.updated, data: Object.fromEntries(WALL_FIELDS.filter((k) => d.data[k] != null).map((k) => [k, d.data[k]])) }));
    }
    res.json({ docs });
  });
  /** Seats are enforced here, not in the guest's browser: a yes past the seat count becomes a waitlist place.
   * One reply per guest: the same email (or the same personal link) updates the earlier reply. */
  function rsvpPolicy(req, body) {
    const eventId = String(body?.eventId || ""); if (!/^[A-Za-z0-9_-]+$/.test(eventId)) return { body };
    const ev = S(req).get("events/" + eventId)?.data; if (!ev) return { body };
    const all = S(req).list("rsvps").filter((d) => d.data?.eventId === eventId), em = String(body.email || "").trim().toLowerCase(), inv = String(req.get("x-encore-invite") || "").split("~")[0];
    const prior = all.find((d) => (em && String(d.data.email || "").trim().toLowerCase() === em) || (inv && d.data._inv === inv));
    const G = ev.guests || [], seen = new Set(G.flatMap((g) => [String(g.email || "").toLowerCase(), String(g.name || "").toLowerCase()]).filter(Boolean));
    // Everyone holding a seat, counted once: host-marked guests plus the latest yes from each RSVP, whether or not the host has opened the app since.
    const keyOf = (x) => String(x.email || x.name || "").trim().toLowerCase(), held = new Set(G.filter((g) => g.status === "Going" || g.status === "Attended").map(keyOf).filter(Boolean));
    for (const d of all) { if (d === prior) continue; const k = keyOf(d.data); if (!k) continue; if (d.data.response === "going") held.add(k); else if (["no", "waitlist"].includes(d.data.response) && !G.some((g) => keyOf(g) === k && g.status === "Attended")) held.delete(k); }
    const going = held.size - (held.has(em) ? 1 : 0);
    const meAlready = G.some((g) => (g.status === "Going" || g.status === "Attended") && ((em && String(g.email || "").toLowerCase() === em)));
    const out = { ...body, ...(inv ? { _inv: inv } : {}) };
    if (out.response === "going" && +ev.headcount > 0 && ev.autoWait !== false && !meAlready && going >= +ev.headcount) out.response = "waitlist";
    return { body: out, prior };
  }
  // A seat freed by a decline goes to the first person on the waitlist, who is told by email when email is on.
  async function promoteWaitlist(req, eventId) {
    const ev = S(req).get("events/" + eventId)?.data; if (!ev || ev.autoWait === false || !(+ev.headcount > 0)) return null;
    const all = S(req).list("rsvps").filter((d) => d.data?.eventId === eventId), G = ev.guests || [];
    const keyOf = (x) => String(x.email || x.name || "").trim().toLowerCase(), held = new Set(G.filter((g) => g.status === "Going" || g.status === "Attended").map(keyOf).filter(Boolean));
    for (const d of all) { const k = keyOf(d.data); if (!k) continue; if (d.data.response === "going") held.add(k); else if (["no", "waitlist"].includes(d.data.response) && !G.some((g) => keyOf(g) === k && g.status === "Attended")) held.delete(k); }
    if (held.size >= +ev.headcount) return null;
    const next = all.filter((d) => d.data.response === "waitlist").sort((a, b) => (a.data.changedAt || a.data.createdAt || 0) - (b.data.changedAt || b.data.createdAt || 0))[0];
    if (!next) return null;
    S(req).set("rsvps/" + next.id, { ...next.data, response: "going", promotedAt: Date.now(), changedAt: Date.now() });
    const to = String(next.data.email || "").trim(), title = ev.pubTitle || ev.copy?.title || "the event";
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { try { await mailFrom(req, { to, subject: `A seat opened up: ${title}`, text: `Hi ${String(next.data.name || "").split(" ")[0] || "there"},\n\nGood news: a seat opened up and it's yours. You're now confirmed for ${title}${ev.date ? " on " + ev.date : ""}.\n\nIf you can no longer make it, reply to this email or use your invitation link to let us know, so we can offer the seat to someone else.\n`, eventId, kind: "waitlist" }); } catch {} }
    return next.id;
  }
  app.post("/api/db/collection", json, async (req, res) => {
    const p = String(req.query.path || "");
    if (req.guest && OWNED.has(p) && !guestKey(req)) return res.status(403).json({ code: "not_granted", message: "Missing guest key." });
    if (!guestShape(req, res, p)) return;
    let body = req.guest && OWNED.has(p) ? { ...(req.body || {}), _k: guestKey(req) } : req.body;
    if (p === "rsvps") { const pol = rsvpPolicy(req, body); body = pol.body;
      if (pol.prior) { const freed = pol.prior.data.response === "going" && body.response !== "going"; S(req).set("rsvps/" + pol.prior.id, { ...pol.prior.data, ...body, _k: pol.prior.data._k || body._k, changedAt: Date.now() }); const promoted = freed ? await promoteWaitlist(req, String(body.eventId || "")) : null; return res.json({ id: pol.prior.id, path: "rsvps/" + pol.prior.id, response: body.response, merged: true, ...(promoted ? { promoted: true } : {}) }); }
      const r0 = S(req).add(p, body); return res.json({ ...r0, response: body.response }); }
    const r = S(req).add(p, body);
    if (p === "events" && !req.guest) claimEvent(r.id, req.ws);
    res.json(r);
  });
  app.get("/api/db/events", (req, res) => {
    const send = sseStart(res);
    const ws = sessionWorkspace(req), onChange = (e) => { const x = scopeChange(e, ws); if (x) send(x); };
    store.events.on("change", onChange);
    res.write("retry: 2000\n\n");
    send({ type: "ready" });
    res.on("close", () => store.events.off("change", onChange));
  });

  // ---------- assets ----------
  const maxAsset = `${Number(process.env.ASSET_MAX_MB || 15)}mb`;
  app.post("/api/assets", express.raw({ type: () => true, limit: maxAsset }), async (req, res) => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!body.length) throw httpError(400, "empty", "Upload body is empty.");
    const id = randomId();
    const contentType = String(req.get("content-type") || "").slice(0, 200), base = contentType.split(";")[0].trim().toLowerCase();
    if (!UPLOAD_OK(base)) throw httpError(415, "unsupported_type", "Upload images, video, PDF, or CSV/text/Markdown/JSON files.");
    await fsp.writeFile(path.join(assetsDir, id), body);
    const meta = { id, url: "/_blob/" + id, sizeBytes: body.length, contentType, createdAt: Date.now(), ws: sessionWorkspace(req) };
    await fsp.writeFile(path.join(assetsDir, id + ".json"), JSON.stringify(meta));
    res.json(meta);
  });
  app.get("/api/assets", async (req, res) => {
    const files = (await fsp.readdir(assetsDir)).filter((f) => f.endsWith(".json"));
    const assets = [];
    const ws = sessionWorkspace(req);
    for (const f of files) { try { const m = JSON.parse(await fsp.readFile(path.join(assetsDir, f), "utf8")); if ((m.ws || DEFAULT_WS) === ws) assets.push(m); } catch {} }
    assets.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    res.json({ assets });
  });
  app.delete("/api/assets/:id", async (req, res) => {
    const id = req.params.id;
    if (!/^[A-Za-z0-9]{20}$/.test(id)) throw httpError(404, "not_found", "No such asset.");
    let meta = null; try { meta = JSON.parse(await fsp.readFile(path.join(assetsDir, id + ".json"), "utf8")); } catch {}
    if (!meta || (meta.ws || DEFAULT_WS) !== sessionWorkspace(req)) throw httpError(404, "not_found", "No such asset.");
    await fsp.rm(path.join(assetsDir, id), { force: true });
    await fsp.rm(path.join(assetsDir, id + ".json"), { force: true });
    res.json({ deleted: true });
  });

  // ---------- ai (sample) ----------
  app.post("/api/ai", json, async (req, res) => {
    const { input, modelTier, tools: rawTools } = req.body || {};
    const tools = (Array.isArray(rawTools) ? rawTools : [])
      .filter((t) => t && typeof t.name === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(t.name))
      .map((t) => ({ name: t.name, description: String(t.description || ""), inputSchema: t.inputSchema }));
    const runId = randomUUID();
    const run = { pending: new Map() };
    runs.set(runId, run);
    const abort = new AbortController();
    const send = sseStart(res);
    let finished = false;
    res.on("close", () => {
      if (finished) return;
      abort.abort();
      for (const resolve of run.pending.values()) resolve({ content: "The page closed before the tool finished.", is_error: true });
      run.pending.clear();
    });
    send({ type: "run", runId });

    const callToolInBrowser = ({ id, name, input: toolInput }) => new Promise((resolve) => {
      if (abort.signal.aborted) return resolve({ content: "Client disconnected.", is_error: true });
      const timer = setTimeout(() => {
        run.pending.delete(id);
        resolve({ content: `Tool ${name} timed out after ${TOOL_TIMEOUT_MS / 1000}s.`, is_error: true });
      }, TOOL_TIMEOUT_MS);
      run.pending.set(id, (r) => { clearTimeout(timer); run.pending.delete(id); resolve(r); });
      send({ type: "tool_call", id, name, input: toolInput ?? {} });
    });

    try {
      const text = await runToolLoop({ input, modelTier, tools, emit: send, callTool: callToolInBrowser, signal: abort.signal });
      send({ type: "done", text });
    } catch (err) {
      const e = toCapError(err);
      if (e.code !== "aborted") console.warn(`[ai] run failed: ${e.code}: ${e.message}`);
      send({ type: "error", ...e });
    } finally {
      finished = true;
      runs.delete(runId);
      res.end();
    }
  });
  app.post("/api/ai/:runId/tool-result", json, (req, res) => {
    const run = runs.get(req.params.runId);
    const { id, content, is_error } = req.body || {};
    const resolve = run?.pending.get(id);
    if (!resolve) return res.status(404).json({ code: "not_found", message: "No pending tool call with that id." });
    resolve({ content: typeof content === "string" ? content : JSON.stringify(content ?? ""), is_error: !!is_error });
    res.json({ ok: true });
  });

  // ---------- mcp ----------
  // Server integrations (Slack, Linear, CRMs) run on this deployment's own keys, so only the default workspace
  // gets them; sign-up workspaces get web search only.
  // A workspace that connected its own HubSpot token gets the HubSpot tools, running on that token.
  const serversFor = (req) => { const ws = sessionWorkspace(req); return configuredFor({ isDefault: ws === DEFAULT_WS, connected: connectionTokens(ws) }); };
  app.get("/api/mcp/tools", (req, res) => {
    let servers = serversFor(req);
    if (req.query.server) { const one = servers.find((x) => x.server === String(req.query.server)); if (!one) throw { code: "server_not_connected", message: `"${req.query.server}" is not connected on this server.` }; servers = [one]; }
    res.json({
      servers: servers.map((s) => ({
        server: s.server,
        authStatus: "connected",
        tools: s.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      })),
    });
  });
  app.post("/api/mcp/call", json, async (req, res) => {
    const { server, tool, input } = req.body || {};
    if (!serversFor(req).some((x) => x.server === String(server || ""))) throw { code: "server_not_connected", message: `"${server}" is not connected on this server.` };
    const ws = sessionWorkspace(req);
    if (CRM_WRITES.has(String(tool || "")) && !canWriteCrm(req)) {
      const u = currentUser(req), summary = crmSummary(String(tool), input), rows = (input?.members || input?.items || input?.accounts || []).slice(0, 200).map((x) => [x.email, x.name, x.company, x.subject, x.status].filter(Boolean).join(" · ").slice(0, 160));
      const doc = S(req).add("crmwrites", { server: String(server), tool: String(tool), input, summary, rows, eventId: String(req.body?.eventId || input?.eventId || "").slice(0, 80), requestedBy: u?.name || "Team", requestedByEmail: u?.email || null, at: Date.now(), status: "pending" });
      S(req).add("audit", { eventId: "", what: `asked RevOps to approve a CRM write: ${summary}`, kind: "crm", who: u?.name || "Team", email: u?.email || null, verified: !!u, at: Date.now() });
      return res.json({ queued: true, id: doc?.id || null, message: `Sent to RevOps for approval: ${summary}. Nothing is written to the CRM until they approve.` });
    }
    const out = await withCrm(connectionTokens(ws), ws === DEFAULT_WS, () => callTool(String(server || ""), String(tool || ""), input, serversFor(req)));
    if (CRM_WRITES.has(String(tool || ""))) { const u = currentUser(req); S(req).add("audit", { eventId: "", what: `wrote to the CRM: ${crmSummary(String(tool), input)}`, kind: "crm", who: u?.name || "Team", email: u?.email || null, verified: !!u, at: Date.now() }); }
    res.json(out);
  });

  // ---------- pm ----------
  app.post("/api/pm/run", json, async (req, res) => {
    res.json(await runPm(S(req), req.body?.now ? { now: Number(req.body.now) } : {}));
  });

  // ---------- errors ----------
  app.use("/api", (req, res) => res.status(404).json({ code: "not_found", message: "No such endpoint." }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (res.headersSent) return res.end();
    if (err?.type === "entity.too.large") return res.status(413).json({ code: "too_large", message: "Request body is too large." });
    if (err?.type === "entity.parse.failed") return res.status(400).json({ code: "bad_json", message: "Body is not valid JSON." });
    const code = err?.code || "server_error";
    const status = err?.status || (code === "server_not_connected" || code === "tool_not_found" ? 404 : code === "tool_error" ? 502 : 500);
    if (status >= 500 && code === "server_error") console.error("[http]", err);
    res.status(status).json({ code, message: String(err?.message || "Something went wrong.") });
  });

  return app;
}

// Exported for tests.
export { parsePath };
