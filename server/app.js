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
import { runPm } from "./pm.js";
import { mountMcp } from "./mcp.js";
import { authEnabled, isAuthed, loginHandler, loginPage, logoutHandler, currentUser, useAuthStore, approverRoles, approverRolesConfigured, APPROVER_LIKE, hasPersonalPassword, teamOf, sessionWorkspace, startSession, emailTaken, hashPassword } from "./auth.js";
import { DEFAULT_WS, scopeStore, scopeChange, signupEnabled, getWorkspace, createWorkspace, updateWorkspace, trialState, putDbUser, getDbUser, membersOf, createInvite, getInvite, useInvite, createMcpToken, findMcpToken, listMcpTokens, revokeMcpToken, workspaceOfEvent, claimEvent, PLANS,
  CONNECTION_PROVIDERS, saveConnection, deleteConnection, listConnections, connectionTokens, saveContact, listContacts } from "./workspaces.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const PAGE_FILE = path.join(ROOT, "index.html");
const PUBLIC_DIR = path.join(ROOT, "public");
const TOOL_TIMEOUT_MS = 120_000;

const HEAD = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style><script src="/shim.js"></script></head><body>';
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
export const PUBLIC_BRAND_FIELDS = ["name", "company", "logo", "colors", "palette", "fonts", "voice", "tone", "tagline", "oneLiner", "adjectives", "website"];
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
const PUBLIC_FIELDS = ["name", "brand", "date", "city", "headcount", "kind", "format", "copy", "cover", "brandColors", "launchQs", "approvalRequired", "venuePick", "plusOnes", "objective"];
export function eventMoney(e) {
  const P = e.produce?.budget || [], cost = P.reduce((a, b) => a + (+b.amount || 0), 0) || +e.budget || 0;
  const committed = (e.commits || []).filter((c) => c.status === "Signed" || c.status === "Paid").reduce((a, c) => a + (+c.amount || 0), 0);
  return { cost, committed, currency: e.currency || "USD" };
}
export function publicEvent(data, view) {
  const e = Object.fromEntries(PUBLIC_FIELDS.filter((k) => data[k] != null).map((k) => [k, data[k]]));
  e.guests = (data.guests || []).filter(shownToGuests).map((g) => Object.fromEntries(GUEST_GUEST_FIELDS.filter((k) => g[k] != null).map((k) => [k, g[k]])));
  if (data.launch) e.launch = { platform: data.launch.platform, url: data.launch.url, qsOnRsvp: data.launch.qsOnRsvp };
  const v = data.venues?.venues?.[data.venuePick ?? 0];
  if (v) { e.venues = { venues: [{ name: v.name, address: v.address, area: v.area, photo: v.photo }] }; e.venuePick = 0; }
  // Nomination pages (target accounts, AE owners) are for signed-in team members only: guests never get scout output, whatever view they claim.
  if (view === "plan") { for (const k of ["budget", "currency", "pitch", "produce", "goal", "concept", "audience", "dist", "mods"]) if (data[k] != null) e[k] = data[k]; }
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
  app.get("/api/health", (req, res) => {
    res.json({ ok: true, ai: aiMode(), integrations: configured().map((s) => s.server), auth: authEnabled() });
  });
  app.get("/login", (req, res) => res.type("html").send(loginPage()));
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
    const b = req.body || {}, name = String(b.name || "").trim().slice(0, 120), email = String(b.email || "").trim().toLowerCase(), company = String(b.company || "").trim().slice(0, 120);
    if (!name || !company) return res.status(400).json({ code: "invalid", message: "Name and company are required." });
    if (!EMAIL_OK(email)) return res.status(400).json({ code: "invalid", message: "Give a valid work email." });
    if (!pwOk(b.password)) return res.status(400).json({ code: "invalid", message: "Use a password of at least 10 characters." });
    if (emailTaken(email)) return res.status(409).json({ code: "conflict", message: "That email already has an Encore account. Sign in instead." });
    const W = createWorkspace({ company, ownerEmail: email });
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
  // Static pages for signed-out visitors. The guest-link redirect is added to them, so #rsvp-… links keep working.
  const GUEST_REDIRECT = `<script>if (/^#(rsvp-|survey-|nominate-|plan-|roadmap|guests-|approve-)/.test(location.hash)) location.replace("/g" + location.search + location.hash);</script>`;
  const sendStatic = async (res, file, fallback) => {
    let html; try { html = await fsp.readFile(path.join(PUBLIC_DIR, file), "utf8"); } catch { html = fallback; }
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + GUEST_REDIRECT) : GUEST_REDIRECT + html;
    res.set("Cache-Control", "no-store").type("html").send(html);
  };
  app.get("/signup", (req, res) => (signupEnabled() ? sendStatic(res, "signup.html", loginPage()) : res.redirect(302, "/login")));
  app.get("/join", (req, res) => sendStatic(res, "join.html", loginPage()));
  app.get("/method", (req, res) => sendStatic(res, "method.html", "<p>Method page missing.</p>"));
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
  app.get("/", (req, res, next) => (isAuthed(req) ? sendPage(req, res, next) : signupEnabled() ? sendStatic(res, "landing.html", loginPage()) : res.type("html").send(loginPage())));
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

  // ---------- gate ----------
  app.use("/api", (req, res, next) => {
    if (isAuthed(req)) return next();
    if (guestAllowed(req)) { req.guest = true; return next(); }
    if (/^\/aeaction$|^\/aepage$/.test(req.path)) { req.guest = true; return next(); } // checked by signed token
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
    res.json({ id: ws, company: W?.company || "", plan: W?.plan || "self-hosted", trialEndsAt: W?.trialEndsAt || null, daysLeft: T.daysLeft, trial: T.trial, trialEnded: T.trialEnded,
      writable: T.writable, upgradeRequest: W?.upgradeRequest || null,
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
    // Billing isn't wired: this records the request; an operator sets plan to "team"/"program" once paid.
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
  const CHECKS = { hubspot: { url: "https://api.hubapi.com/crm/v3/objects/companies?limit=1", name: "HubSpot" }, attio: { url: "https://api.attio.com/v2/self", name: "Attio" } };
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
  const AUDIT = /^(audit|approvals|aeactions|system)(\/|$)/;
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
    const mine = (ev.data.guests || []).filter((g) => aeSlug(g.owner) === slug).map((g) => ({ name: g.name, title: g.title, company: g.company, status: g.status, owner: g.owner, note: g.note, nextStep: g.nextStep, gift: g.gift, giftStatus: g.giftStatus, fuDraft: g.fuDraft, fuState: g.fuState, nsDoneAt: g.nsDoneAt, nudge: g.nudge, nudgeOkAt: g.nudgeOkAt }));
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
      if (nom) { data.nomFor = nom.slug; data.nomSuggest = nom.suggest; }
      if (invited) {
        const first = (x) => String(x || "").trim().split(/\s+/)[0] || "";
        data.me = { name: invited.name || "", title: invited.title || "", company: invited.company || "", email: invited.email || "", owner: first(invited.owner) };
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
  app.post("/api/db/collection", json, (req, res) => {
    const p = String(req.query.path || "");
    if (req.guest && OWNED.has(p) && !guestKey(req)) return res.status(403).json({ code: "not_granted", message: "Missing guest key." });
    if (!guestShape(req, res, p)) return;
    const body = req.guest && OWNED.has(p) ? { ...(req.body || {}), _k: guestKey(req) } : req.body;
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
    res.json(await withCrm(connectionTokens(ws), ws === DEFAULT_WS, () => callTool(String(server || ""), String(tool || ""), input, serversFor(req))));
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
