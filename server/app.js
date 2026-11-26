import crypto from "node:crypto";
import zlib from "node:zlib";
import { drawArt } from "./art.js";
// Express app for Pottery Lab. createApp() is used by server/index.js and the tests.
import express from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { randomUUID, randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { parsePath, httpError, randomId } from "./db.js";
import { runToolLoop, toCapError, aiMode } from "./ai.js";
import { configured, configuredFor, callTool, withCrm } from "./integrations/index.js";
import { clientCredentialsToken } from "./integrations/salesforce.js";
import { gongOrigin, gongAuth } from "./integrations/gong.js";
import { makeCommunity, mountCommunity, inviteOnly } from "./community.js";
import { makeSocial, mountSocial, seatsOf, heldOf, seatsTaken, waitlistOf, waitlistPos, partyUnit, dueCents } from "./social.js";
import { ordersClosed, tzOk } from "./tz.js";
// review round 11: an event keeps a valid IANA time zone only (from its tz field, else the x-encore-tz header the browser may send on create)
const withTz = (body, req, fresh) => { if (!body || typeof body !== "object" || Array.isArray(body)) return body; const o = { ...body };
  if (o.tz != null && !(typeof o.tz === "string" && o.tz.length <= 64 && tzOk(o.tz))) delete o.tz;
  if (fresh && !o.tz) { const h = String(req.get("x-encore-tz") || "").slice(0, 64); if (h && tzOk(h)) o.tz = h; } return o; };
import { smsConfig, sendSms } from "./sms.js";
import { mountHosts, earlyAccessBlocks } from "./hosts.js";
import { mountRecognition } from "./recognition.js";
import { mountScrapbook } from "./scrapbook.js";
import { mountGiftPlan } from "./giftplan.js";
import { mountShop, payLink } from "./shop.js";
import { mountMarket } from "./market.js";
import { mountBrand, startResearch } from "./brand.js";
import { mountChecks } from "./checks.js";
import { mountCollabs } from "./collabs.js";
import { mountOnboard } from "./onboard.js";
import { mountDirectory } from "./directory.js";
import { mountLeaderboard } from "./leaderboard.js";
import { mountFeedVisual } from "./feedvisual.js"; // visual feed: stories, media-first cards, the public feed, moment controls
import { mountKudosAsk } from "./kudosask.js";
import { mountTables } from "./tables.js"; // review round 11: tables (first 30 minutes, I'm in if, open tables, Same table next time, roster)
import { mountRepeats } from "./repeats.js"; // weekly and monthly events make their next date (server/repeats.js)
import { mountHelp } from "./help.js";
import { mountComeWith, friendTerms, claimHold, findHold } from "./comewith.js"; // "Come with me?": a link for one friend, their spot held 48 hours
import { mountHostLike } from "./hostlike.js"; // "Host one like this": a draft from a past event, and how many hosted one after seeing it
import { mountHooks } from "./hooks.js"; // interests, Inspo (/ideas), saves and boards (/saved), passport, friends going, digest
import { withCleanLook } from "./looks.js"; // per-event looks (Make it yours)
import { buildEstimateScript } from "./estimate.js";
import { configureSso, getSso, removeSso, publicSso, redirectUriFor, ssoForEmail, startSso, readState, finishSso, ensureSsoMember } from "./sso.js";
import { runPm } from "./pm.js";
import { emailConfig, publicEmailConfig, sendEmail, verifyEmailKey, EMAIL_SERVICES, EMAIL_RE, useUnsubStore, readUnsubToken, setUnsubscribed, isUnsubscribed } from "./email.js";
import { runReminders } from "./reminders.js";
import { useMetricsStore, track, trackOnce, funnel, isAdmin, CLIENT_STEPS } from "./metrics.js";
import { mountMcp } from "./mcp.js";
import { authEnabled, isAuthed, loginHandler, loginPage, logoutHandler, currentUser, users, useAuthStore, approverRoles, approverRolesConfigured, APPROVER_LIKE, hasPersonalPassword, teamOf, sessionWorkspace, startSession, emailTaken, hashPassword, startPasswordReset, finishPasswordReset, startSession as startSessionFor } from "./auth.js";
import { exportWorkspace, deleteWorkspace } from "./workspaces.js";
import { buildOrder, slotLabel, orderMoney, itemsOf } from "./preorder.js"; // review round 8
import { DEFAULT_WS, scopeStore, scopeChange, signupEnabled, getWorkspace, createWorkspace, updateWorkspace, trialState, putDbUser, getDbUser, membersOf, createInvite, getInvite, useInvite, createMcpToken, findMcpToken, listMcpTokens, revokeMcpToken, workspaceOfEvent, claimEvent, PLANS, allWorkspaceIds,
  CONNECTION_PROVIDERS, saveConnection, deleteConnection, listConnections, connectionTokens, saveContact, listContacts } from "./workspaces.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const PAGE_FILE = path.join(ROOT, "index.html");
const PUBLIC_DIR = path.join(ROOT, "public");
const TOOL_TIMEOUT_MS = 120_000;

const HEAD = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style><script src="/authguard.js"></script><script src="/shim.js"></script><script src="/avatars.js"></script><script src="/account.js"></script></head><body>';
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
// The only fields a guest's reply may carry (what the light and full invites send). Everything else on a reply
// (paid, let in, checked in, promoted, the device keys) is the host's or the server's and is never taken from a guest.
const GUEST_TEXT = { name: 80, title: 120, company: 120, email: 200, phone: 30, guestType: 20, topic: 500, dietary: 500, access: 500, ea: 200, slot: 120, ride: 60, order: 300, code: 12, via: 30, interest: 10, introducedBy: 120, linkedin: 300, eventId: 80, response: 20, status: 20, contactVia: 12 };
const GUEST_FLAGS = ["plusOne", "severe", "showOnWall", "showMe", "smsOk"];
export const GUEST_RSVP_KEYS = new Set([...Object.keys(GUEST_TEXT), ...GUEST_FLAGS, "party", "guestIndex", "createdAt", "changedAt", "photo", "dates", "answers", "utm", "source"]);
// A guest's whole reply, photo included, fits in this many bytes; real replies are a few hundred.
export const GUEST_BODY_MAX = 64 * 1024;
function cleanGuestRsvp(b) {
  const o = {};
  for (const [k, n] of Object.entries(GUEST_TEXT)) if (b[k] != null) o[k] = String(b[k]).replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").trim().slice(0, n);
  if (o.phone != null) o.phone = o.phone.replace(/[^\d+ ()-]/g, "");
  if (o.contactVia != null && !["email", "sms", "whatsapp"].includes(o.contactVia)) delete o.contactVia;
  for (const k of GUEST_FLAGS) if (b[k] != null) o[k] = !!b[k];
  if (b.party != null) o.party = Math.max(1, Math.min(50, Math.floor(+b.party) || 1)); // seatsOf caps it by the event (6, or a bigger group)
  if (b.guestIndex != null && Number.isFinite(+b.guestIndex)) o.guestIndex = Math.max(-1, Math.min(10000, Math.floor(+b.guestIndex)));
  for (const k of ["createdAt", "changedAt"]) if (b[k] != null && Number.isFinite(+b[k])) o[k] = Math.min(+b[k], Date.now() + 864e5);
  if (typeof b.photo === "string" && ((/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(b.photo) && b.photo.length <= 60000) || /^\/_blob\/[A-Za-z0-9]{20}$/.test(b.photo))) o.photo = b.photo;
  if (Array.isArray(b.dates)) o.dates = b.dates.slice(0, 20).map((d) => String(d ?? "").slice(0, 40)).filter(Boolean);
  if (b.answers !== undefined) o.answers = b.answers; // cleaned in guestShape
  if (b.utm !== undefined) o.utm = b.utm;
  // review round 3 (paid spots): "I paid" is the one new thing a guest may say about money, and only as true.
  // It is a claim, never `paid` itself (the host confirms that). ownedWrite keeps it to the guest's own existing reply.
  if (b.paidClaim === true) o.paidClaim = true;
  return o;
}
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
const PUBLIC_FIELDS = ["questions", "qStyle", "bookingId", "tentative", "hideHostFollow", "forCompany", "why", "askQ", "houseRules", "name", "brand", "date", "city", "headcount", "kind", "format", "copy", "cover", "brandColors", "brandMode", "coverPhoto", "coverArt", "unlisted", "playlistUrl", "hideGuests", "launchQs", "approvalRequired", "venuePick", "plusOnes", "objective", "chatham", "noPhotos", "noWall", "discreet", "dress", "pubTitle", "startTime", "endTime", "tz", "venueName", "venueAddr", "hostName", "theme", "effect", "titleFont", "rsvpWords", "noMaybe", "showWho", "autoWait", "openRsvp", "casual", "meetPoint", "routeUrl", "bring", "slots", "chatUrl", "chipIn", "payUrl", "repeat", "carpool", "activity", "discoverable", "price", "ticketUrl", "pickup", "allergens", "emoji", "hood", "free", "stage", "interestGoal", "dateOptions", "getThere", "geo", "askPhone", "ticketNote", "audienceWho", "earlyUntil", "courses", "dinnerTheme", "autoGo"];
// Series: a multi-week course (sessions) and a class pass (passPrice for passCount) reach the guest link too.
PUBLIC_FIELDS.push("sessions", "passPrice", "passCount", "weekdays", "dropIn", "costNote");
// How the price reads: "$12 each" (priceUnit), "$40 for 2" (groupPrice for groupSize).
PUBLIC_FIELDS.push("priceUnit", "groupPrice", "groupSize");
// review round 7: a pre-order's items ("Country loaf $12") for the order form, and the date before this one of a repeat
// (so the light invite can say "You were in last week. In again?")
PUBLIC_FIELDS.push("preorder", "orderItems", "prevId", "seriesId");
// review round 11: when orders close ("Order by Thu"), and pairs and groups counted as such ("6 pairs", "3 groups")
PUBLIC_FIELDS.push("orderBy", "orderByDate", "orderDeadline", "headUnit", "unitCount", "groupCount", "stockUnit");
// ---- per-event looks: the flyer fit, colours, effect, title font and reply button (server/looks.js cleans it on save) ----
PUBLIC_FIELDS.push("look");
export function eventMoney(e) {
  const P = e.produce?.budget || [], cost = P.reduce((a, b) => a + (+b.amount || 0), 0) || +e.budget || 0;
  const committed = (e.commits || []).filter((c) => c.status === "Signed" || c.status === "Paid").reduce((a, c) => a + (+c.amount || 0), 0);
  return { cost, committed, currency: e.currency || "USD" };
}
/** Does this place text give away where someone lives, or a street address? */
export const looksLikeAddress = (t) => { const x = String(t || ""); return /\b\d{1,6}[a-z]?\s+[A-Za-zÀ-ÿ'.-]+(\s+[A-Za-zÀ-ÿ'.-]+){0,3}\s+(st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|pl|place|way|ct|court|ter|terrace|pkwy|parkway|hwy|sq|square)\b\.?/i.test(x) || /\b(apt|apartment|unit|suite|flat|floor)\s*#?\s*\w+|#\s*\d+|\b(my|our)\s+(place|apartment|flat|house|home|backyard|rooftop|loft)\b|['’]s\s+(place|apartment|flat|house|home)\b/i.test(x); };
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
    // a place name that is really a home or a street address ("My apartment, 214 Bedford Ave") is an address too:
    // guests get it after they're in, through the RSVP-checked address endpoint
    for (const k of ["venueName", "meetPoint"]) if (e[k] && looksLikeAddress(e[k])) { delete e[k]; e.addrHidden = true; }
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
  // Moving to a new address (e.g. potterylab.ai): set ENCORE_CANONICAL_HOST and every page visit on any other host
  // (the old onrender address, www.) is sent there permanently, same path and query. API calls are left alone so
  // pages already open keep working; localhost and tests are never redirected.
  app.use((req, res, next) => { const canon = String(process.env.ENCORE_CANONICAL_HOST || "").trim().toLowerCase(), host = String(req.hostname || "").toLowerCase();
    if (!canon || !host || host === canon || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host) || !/^(GET|HEAD)$/.test(req.method) || req.path.startsWith("/api/")) return next();
    res.redirect(301, `https://${canon}${req.originalUrl}`); });
  const CSP_RO = ["default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com data:", "img-src 'self' data: blob: https:", "media-src 'self' blob: https:", "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com", "frame-ancestors 'self'", "base-uri 'self'", "form-action 'self'", "report-uri /api/csp-report"].join("; ");
  // enforced since every page ran clean under report-only; violations are still reported to /api/csp-report
  // (ENCORE_CSP=report puts it back in report-only mode without a deploy of new code)
  app.use((req, res, next) => { if (req.method === "GET" && !/^\/(api|_blob)\//.test(req.path)) res.set(process.env.ENCORE_CSP === "report" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy", CSP_RO); next(); });
  let cspSeen = 0; app.post("/api/csp-report", express.json({ type: () => true, limit: "16kb" }), (req, res) => { if (cspSeen++ < 200) { const r = req.body?.["csp-report"] || req.body || {}; console.warn("[csp]", String(r["violated-directive"] || r.effectiveDirective || "").slice(0, 60), String(r["blocked-uri"] || r.blockedURL || "").slice(0, 120), String(r["document-uri"] || r.documentURL || "").slice(0, 80)); } res.status(204).end(); });
  // A readable "signed in" hint (never the session itself) so pages skip calls that need a session when there isn't one.
  // Kept in step with the real session on every page and API request.
  app.use((req, res, next) => { if (/\.[a-z0-9]{1,5}$/i.test(req.path)) return next(); const hint = /(?:^|;\s*)encore_in=1/.test(req.headers.cookie || ""), authed = authEnabled() ? isAuthed(req) : true;
    if (authed && !hint) res.append("Set-Cookie", `encore_in=1; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${req.secure ? "; Secure" : ""}`); else if (!authed && hint && authEnabled()) res.append("Set-Cookie", "encore_in=; Path=/; SameSite=Lax; Max-Age=0"); next(); });
  const assetsDir = path.join(dataDir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  const runs = new Map(); // runId -> { pending: Map<toolUseId, resolve> }
  useAuthStore(store);
  useMetricsStore(store);
  useUnsubStore(store);

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
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 3500); const r = await fetch(u, { signal: ctl.signal, headers: { "User-Agent": "Pottery Lab (event invites)" } }); clearTimeout(t); if (!r.ok) throw new Error("places " + r.status);
      const j = await r.json(); const places = (j.features || []).map((f) => { const p = f.properties || {}, c = f.geometry?.coordinates || []; const street = [p.housenumber, p.street].filter(Boolean).join(" "), city = p.city || p.town || p.village || p.district || p.county || "", name = p.name && p.name !== p.street ? p.name : "";
        const label = [name, street, city, p.state && p.country === "United States" ? p.state : "", p.country].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(", ");
        return { label, name: name || street || city, street, city, hood: p.district || p.locality || "", postcode: p.postcode || "", country: p.country || "", lat: c[1], lng: c[0], kind: p.osm_value || "" }; }).filter((x) => x.label);
      if (placeCache.size > 2000) placeCache.clear(); placeCache.set(key, { at: Date.now(), places }); res.json({ places }); }
    catch { res.json({ places: [], unavailable: true }); } });
  app.get("/api/health", (req, res) => {
    res.json({ ok: true, ai: aiMode(), integrations: configured().map((s) => s.server), auth: authEnabled() });
  });
  // ---- review round 8: signed in on /login or /signup: say who, with Go to Pottery Lab and Switch account, not the form ----
  const signedInAs = (req) => { if (req.query.switch || req.query.next) return null; const u = currentUser(req); if (!u) return null; return String(getDbUser(u.email)?.name || u.name || u.email || "").trim() || "you"; };
  const signedInPage = (name, back) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Signed in · Pottery Lab</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@600&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F7F1E8;color:#1F1A17;font:16px/1.5 "Instrument Sans",system-ui,sans-serif}main{background:#fff;border:2px solid #1F1A17;border-radius:20px;padding:28px 24px;width:min(380px,calc(100vw - 32px));box-sizing:border-box;text-align:center}h1{font:600 26px/1.2 Fredoka,system-ui,sans-serif;margin:0 0 6px}p{margin:0 0 18px;color:#665A51}.go{display:flex;align-items:center;justify-content:center;min-height:48px;border-radius:999px;background:#C94A30;color:#fff;font:600 17px Fredoka,system-ui,sans-serif;text-decoration:none}.sw{margin-top:12px;min-height:44px;width:100%;border:2px solid #1F1A17;border-radius:999px;background:transparent;font:600 16px Fredoka,system-ui,sans-serif;color:#1F1A17;cursor:pointer}</style></head>
<body><main id="signedIn"><h1>You're signed in</h1><p>You're signed in as <b>${esc(name)}</b>.</p><a class="go" href="/?app=1">Go to Pottery Lab</a><button class="sw" type="button" id="sw">Switch account</button></main>
<script>document.getElementById("sw").onclick=async()=>{ try{ await fetch("/api/logout",{method:"POST"}) }catch{} location.href=${JSON.stringify(back)} };</script></body></html>`;
  app.get("/login", (req, res, next) => { const n = signedInAs(req); if (n) return res.type("html").send(signedInPage(n, "/login")); next(); });
  app.get("/signup", (req, res, next) => { const n = signedInAs(req); if (n) return res.type("html").send(signedInPage(n, "/signup" + (req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : ""))); next(); });
  // ---- end review round 8 signed in ----
  app.get("/login", (req, res) => (isAuthed(req) && !req.query.switch ? res.redirect(302, String(req.query.next || "").startsWith("/") && !String(req.query.next).startsWith("//") ? String(req.query.next) : "/?app=1") : res.type("html").send(loginPage()))); // already signed in: go where you were headed
  // ---- forgot password: always the same answer, so nobody learns which emails have accounts ----
  const resetHits = new Map(); const resetLimited = (k, n) => { const now = Date.now(), h = (resetHits.get(k) || []).filter((t) => now - t < 3600e3); h.push(now); resetHits.set(k, h); return h.length > n; };
  app.post("/api/password/forgot", express.json({ limit: "4kb" }), async (req, res) => { const email = String(req.body?.email || "").trim().toLowerCase();
    if (resetLimited("ip:" + (req.ip || "?"), 10) || (email && resetLimited("em:" + email, 3))) return res.status(429).json({ code: "rate_limited", message: "Too many reset requests. Try again in an hour." });
    // no way to send email at all: say so, instead of promising a link that never comes (same answer for every address)
    if (!emailConfig(DEFAULT_WS, true)) { console.error("password reset: no email service configured (set ENCORE_EMAIL_KEY and ENCORE_EMAIL_FROM)"); return res.status(503).json({ code: "email_off", message: "We can't send reset emails right now. Please try again later." }); }
    const r = EMAIL_RE.test(email) ? startPasswordReset(email) : null;
    if (r) { const cfg = emailConfig(r.user.ws, false) || emailConfig(DEFAULT_WS, true); const link = `${originOf(req)}/reset?token=${r.token}`;
      if (cfg) await sendEmail(cfg, { to: r.user.email, subject: "Reset your Pottery Lab password", text: `Hi ${String(r.user.name || "").split(" ")[0] || "there"},\n\nSomeone (hopefully you) asked to reset the password for this Pottery Lab account. Choose a new one here:\n\n${link}\n\nThe link works once and expires in an hour. If you didn't ask, ignore this email; your password stays the same.` }).then((x) => { if (x && x.ok === false) console.error("password reset email failed", x.error || x.status || ""); }).catch((err) => console.error("password reset email failed", err?.message || err)); }
    res.json({ ok: true, message: "If that email has an account, a link is on its way. It works for an hour." }); });
  app.post("/api/password/reset", express.json({ limit: "4kb" }), (req, res) => { if (resetLimited("rs:" + (req.ip || "?"), 20)) return res.status(429).json({ code: "rate_limited", message: "Too many tries. Try again later." });
    const u = finishPasswordReset(req.body?.token, req.body?.password); if (typeof u === "string") return res.status(400).json({ code: "invalid", message: u });
    startSessionFor(req, res, u.email, u.ws); res.json({ ok: true }); });
  app.get(["/forgot", "/reset"], (req, res) => sendStatic(res, "reset.html", "<p>Reset page missing.</p>"));
  app.post("/api/login", express.urlencoded({ extended: false, limit: "10kb" }), express.json({ limit: "10kb" }), loginHandler);
  app.post("/api/logout", logoutHandler);

  // ---------- self-serve sign-up (ENCORE_SIGNUP=1) ----------
  // ip -> { n, start }: ENCORE_SIGNUP_PER_HOUR sign-ups / joins per IP per hour (default 20: a class or a launch party signing
  // up on one wifi network shares an IP). Behind a Vercel rewrite every visitor shares one IP, see docs/onboarding.md.
  const signupHits = new Map();
  const signupLimited = (req) => {
    const k = req.ip || "?", now = Date.now(); let h = signupHits.get(k);
    if (!h || now - h.start > 3600_000) { h = { n: 0, start: now }; signupHits.set(k, h); }
    return ++h.n > Number(process.env.ENCORE_SIGNUP_PER_HOUR || 20);
  };
  const small = express.json({ limit: "10kb" });
  // Example hosts (demo accounts) show what a page looks like; nothing real can be sent to them or their events:
  // no bookings, orders, messages, questions, pledges, gifts, follows, kudos or RSVP extras. One guard for every such route.
  { const BY_HANDLE = /^\/api\/public\/(book|inquiry|order)\/([^/]+)/, BY_EVENT = /^\/api\/public\/(chat|faq|rsvp-extra|ticket)\/([^/]+)/, BODY = /^\/api\/public\/(pledge|gift|follow|kudos|keep-posted|keep-in-touch|tipped)$/;
    // only while seeding a demo server (scripts/seed-demo.cjs) are example hosts writable
    const isEx = (ws) => process.env.ENCORE_ALLOW_DEMO_WRITES !== "1" && !!ws && /@demo\.encore$/i.test(getWorkspace(ws)?.ownerEmail || "");
    app.post(/^\/api\/public\//, small, (req, res, next) => { try { const p = req.path; let ws = null, m;
        if ((m = BY_HANDLE.exec(p))) ws = C.wsOfHandle(decodeURIComponent(m[2]).toLowerCase());
        else if ((m = BY_EVENT.exec(p))) ws = workspaceOfEvent(decodeURIComponent(m[2]));
        else if (BODY.test(p)) ws = req.body?.handle ? C.wsOfHandle(String(req.body.handle).toLowerCase()) : req.body?.eventId ? workspaceOfEvent(String(req.body.eventId)) : null;
        if (isEx(ws)) return res.status(403).json({ code: "example", message: "This is an example page, so it can't take requests. Make your own page to try it." }); } catch {}
      next(); }); }
  const pwOk = (p) => typeof p === "string" && p.length >= 10 && p.length <= 200;
  app.post("/api/signup", small, (req, res) => {
    if (!signupEnabled()) return res.status(404).json({ code: "not_found", message: "Sign-up is off on this server." });
    if (signupLimited(req)) return res.status(429).json({ code: "rate_limited", message: "Too many sign-ups from here. Try again later." });
    const b = req.body || {}, name = String(b.name || "").trim().slice(0, 120), email = String(b.email || "").trim().toLowerCase(), personal = b.mode === "friends" || (b.mode !== "work" && !String(b.company || "").trim());
    const company = String(b.company || "").trim().slice(0, 120) || `${name.split(/\s+/)[0]}'s ${personal ? "events" : "team"}`, ref = /^[A-Za-z0-9_-]{1,80}$/.test(String(b.ref || "")) ? String(b.ref) : "";
    if (!name) return res.status(400).json({ code: "invalid", message: "Add your name." });
    if (!EMAIL_OK(email)) return res.status(400).json({ code: "invalid", message: "That email doesn't look right." });
    if (!pwOk(b.password)) return res.status(400).json({ code: "invalid", message: "Password needs 10+ characters." });
    if (emailTaken(email)) return res.status(409).json({ code: "conflict", message: "You already have an account. Sign in instead." });
    // Invite-only: everyone after the first member needs a code from someone already here.
    const code = String(b.code || "").trim().toUpperCase().slice(0, 20), needCode = inviteOnly() && (allWorkspaceIds().length > 1 || String(process.env.ENCORE_FOUNDER_CODES || "").trim() !== "");
    let codeCheck = null; const regHandle = String(b.regularOf || "").trim().slice(0, 60), regWs = regHandle && !code ? C.wsOfHandle(regHandle) : null, regular = !!(regWs && personal);
    // A guest of the event they came from (an I'm in reply with this email, or kudos they sent) is vouched for by that
    // event's host: no host code needed, even when hosting is invite-only.
    const vouch = guestVouch(ref, email);
    if ((needCode && !regular && !vouch) || code) { codeCheck = C.checkCode(code); if ((needCode || code) && !codeCheck.ok) return res.status(403).json({ code: "invite_required", message: code ? codeCheck.message : "Hosting is invite-only for now. Ask a host for a host code, or join the waitlist." }); }
    const W = createWorkspace({ company, ownerEmail: email, personal, ref });
    if (codeCheck?.ok && codeCheck.c) { C.useCode(code, { ws: W.id, email, name }); try { X.addFriend(email, codeCheck.c.ownerEmail); X.addFriend(codeCheck.c.ownerEmail, email); } catch {} }
    if (vouch) { try { const by = getWorkspace(vouch.ws), instead = needCode && !codeCheck?.ok;
      updateWorkspace(W.id, { vouchedBy: { ws: vouch.ws, eventId: vouch.eventId, via: vouch.via, at: Date.now(), ...(instead ? { insteadOfCode: true } : {}) } });
      scopeStore(store, W.id).add("audit", { eventId: "", what: `Started hosting as a guest of ${by?.company || "another host"}'s event (${vouch.via === "kudos" ? "sent kudos" : "was in"})`, kind: "growth", at: Date.now() });
      console.log(`[signup] vouch: ws ${W.id} via ${vouch.via} on event ${vouch.eventId} (host ws ${vouch.ws})${instead ? ", instead of a host code" : ""}`); } catch {} }
    if (regular) { updateWorkspace(W.id, { regularOnly: !!needCode && !vouch, regularOf: regHandle }); try { C.follow(regWs, { email, name, via: "signup", tastes: [] }); scopeStore(store, regWs).add("audit", { eventId: "", what: `${name.split(/\s+/)[0]} followed you`, kind: "growth", at: Date.now() }); } catch {} }
    if (!regular || !needCode || vouch) C.issueCodes({ ws: W.id, email, name });
    { const city = String(b.city || "").trim().slice(0, 60); if (city) { try { const W2 = getWorkspace(W.id); updateWorkspace(W.id, { city, host: { ...(W2?.host || {}), city: W2?.host?.city || city } }); } catch {} } }
    if (personal) { try { X.ensureProfile({ ws: W.id, name, email }); } catch {} }
    // A brand's first minute: Pottery Lab starts researching the company while they look around.
    else { try { startResearch(W.id, { company, website: String(b.website || "").trim().slice(0, 200), by: email }); } catch (e) { console.warn("[brand] start failed", e?.message); } }
    // Word of mouth: count who came to Pottery Lab from a guest page, on the event's own workspace.
    if (ref) { const host = workspaceOfEvent(ref); if (host) { try { scopeStore(store, host).add("audit", { eventId: ref, what: `${name.split(/\s+/)[0]} started hosting with Pottery Lab from this event's page`, kind: "growth", at: Date.now() }); } catch {} } }
    putDbUser({ kind: "user", ws: W.id, name, email, roles: ["Event lead"], owner: true, pw: hashPassword(b.password), createdAt: Date.now() });
    scopeStore(store, W.id).add("audit", { eventId: "", what: `${company} workspace created`, kind: "team", who: name, email, verified: true, at: Date.now() });
    startSession(req, res, email, W.id);
    track("signup", { ws: W.id, ref: ref || undefined, code: !!codeCheck?.ok });
    if (vouch) track("guest_became_host", { ws: W.id, ref: vouch.eventId, via: vouch.via });
    // ?template=…&plan=… from the landing page ride along to the app's welcome screen.
    const q = new URLSearchParams({ welcome: "1" });
    for (const k of ["template", "plan"]) { const v = String(b[k] ?? "").trim(); if (/^[A-Za-z0-9_-]{1,60}$/.test(v)) q.set(k, v); }
    if (q.get("plan") && PLANS.includes(q.get("plan"))) updateWorkspace(W.id, { interestedIn: q.get("plan") });
    res.json({ ok: true, workspace: { id: W.id, company: W.company, plan: W.plan, trialEndsAt: W.trialEndsAt }, redirect: "/?" + q.toString() });
  });
  /** Did this email reply I'm in to the event `ref`, or send it kudos? Then that event's host vouches for them.
   * review round 11: only for an address the guest proved is theirs (they opened the link we emailed to it, which stamps
   * emailProvenAt on the reply). Anyone can type someone else's email into an invite, so a bare reply vouches for no one. */
  function guestVouch(ref, email) {
    if (!ref || !email) return null; const ws = workspaceOfEvent(ref); if (!ws || ws === DEFAULT_WS) return null;
    const St = scopeStore(store, ws); if (!St.get("events/" + ref)) return null;
    const same = (d) => d.data?.eventId === ref && String(d.data?.email || "").trim().toLowerCase() === email;
    const proven = (r) => !!r?.emailProvenAt && String(r.emailProven || "").trim().toLowerCase() === email;
    const R = St.list("rsvps").filter((d) => same(d) && proven(d.data));
    if (R.some((d) => d.data.response === "going" || d.data.status === "Attended")) return { ws, eventId: ref, via: "reply" };
    if (R.length && St.list("kudos").some(same)) return { ws, eventId: ref, via: "kudos" };
    return null;
  }
  app.post("/api/join", small, (req, res) => {
    if (signupLimited(req)) return res.status(429).json({ code: "rate_limited", message: "Too many tries from here. Try again later." });
    const b = req.body || {}, inv = getInvite(b.token), name = String(b.name || "").trim().slice(0, 120);
    if (!inv || inv.usedAt || inv.expiresAt < Date.now() || !getWorkspace(inv.ws)) return res.status(410).json({ code: "invite_invalid", message: "This link has expired or was used. Ask your team for a new one." });
    if (!name) return res.status(400).json({ code: "invalid", message: "Add your name." });
    if (!pwOk(b.password)) return res.status(400).json({ code: "invalid", message: "Password needs 10+ characters." });
    if (emailTaken(inv.email)) return res.status(409).json({ code: "conflict", message: "That email already has a Pottery Lab account." });
    useInvite(inv);
    putDbUser({ kind: "user", ws: inv.ws, name, email: inv.email, roles: [inv.role], ...(inv.defaultRole ? { defaultRole: true } : {}), owner: false, pw: hashPassword(b.password), createdAt: Date.now(), invitedBy: inv.by });
    scopeStore(store, inv.ws).add("audit", { eventId: "", what: `${name} joined as ${inv.role}`, kind: "team", who: name, email: inv.email, verified: true, at: Date.now() });
    startSession(req, res, inv.email, inv.ws);
    res.json({ ok: true, email: inv.email, redirect: "/?welcome=1" });
  });
  // ---------- funnel metrics (server/metrics.js) ----------
  // The app reports the few steps only a browser sees (share_clicked). Signed-in hosts only, whitelisted names, rate limited.
  const trackHits = new Map();
  app.post("/api/track", small, (req, res) => {
    const u = currentUser(req), ws = u ? sessionWorkspace(req) : null; if (!u || !ws || ws === DEFAULT_WS) return res.status(401).json({ code: "not_granted", message: "Sign in first." });
    const name = String(req.body?.name || ""); if (!CLIENT_STEPS.has(name)) return res.status(400).json({ code: "invalid", message: "Unknown step." });
    const now = Date.now(), k = ws, h = (trackHits.get(k) || []).filter((t) => now - t < 3600e3); if (h.length >= 60) return res.status(429).json({ code: "rate_limited", message: "Slow down." });
    h.push(now); trackHits.set(k, h); if (trackHits.size > 5000) trackHits.clear();
    const eventId = String(req.body?.eventId || ""), ok = /^[A-Za-z0-9_-]{1,80}$/.test(eventId) && !!scopeStore(store, ws).get("events/" + eventId);
    track(name, { ws, ...(ok ? { eventId } : {}) }); res.json({ ok: true }); });
  // Owner-only: people listed in ENCORE_ADMIN_EMAILS. Everyone else gets a 404, as if the route weren't here.
  app.get("/api/admin/funnel", (req, res) => { const u = currentUser(req); if (!u || !isAdmin(u.email)) return res.status(404).json({ code: "not_found", message: "Not found." }); res.json(funnel()); });
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
  const ssoPage = (inner) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in with SSO · Pottery Lab</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px system-ui,sans-serif;background:#f4f7ff;color:#1b2340}form,.box{background:#fff;padding:28px;border-radius:16px;box-shadow:0 6px 30px rgba(30,50,120,.12);width:min(320px,calc(100vw - 32px));box-sizing:border-box}h1{margin:0 0 16px;font-size:22px}input,button{width:100%;box-sizing:border-box;font:inherit;padding:10px 12px;border-radius:10px}input{border:1px solid #cfd6ea;margin-bottom:12px}button{border:0;background:#3355ff;color:#fff;font-weight:600;cursor:pointer}p{margin:0 0 12px;font-size:13px}.err{color:#b3261e}a{display:block;margin-top:14px;text-align:center;color:#3355ff;font-size:13px;text-decoration:none}.wrap{display:grid;gap:16px;justify-items:center}.brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:18px}</style></head><body><div class="wrap"><div class="brand"><svg viewBox="0 0 28 28" width="24" height="24" aria-hidden="true"><path d="M10.2 3.2h7.6v1.9c0 1.3-1.1 1.9-1.1 3.3 0 1.5 5.6 3.4 5.6 9.4 0 4.6-3.7 7.4-8.3 7.4s-8.3-2.8-8.3-7.4c0-6 5.6-7.9 5.6-9.4 0-1.4-1.1-2-1.1-3.3z" fill="#C4532F" stroke="#1F1A17" stroke-width="1.6" stroke-linejoin="round"/><path d="M7.4 16.7c2 1.3 4.3-.9 6.8.2 2.4 1 4.5-.8 6.6.1" fill="none" stroke="#F2D48F" stroke-width="2.2" stroke-linecap="round"/><path d="M9.6 3.2h8.8" stroke="#1F1A17" stroke-width="1.8" stroke-linecap="round"/></svg>pottery lab</div>${inner}</div></body></html>`;
  const ssoForm = (msg = "") => ssoPage(`<form method="get" action="/sso/start"><h1>Sign in with SSO</h1>${msg ? `<p class="err">${esc(msg)}</p>` : ""}<input type="email" name="email" placeholder="Work email" autocomplete="email" autofocus required><button type="submit">Continue</button><a href="/login">Use a password</a></form>`);
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
    sendText(res.req, res, html);
  };
  app.get("/signup", (req, res) => (signupEnabled() ? sendStatic(res, "signup.html", loginPage()) : res.redirect(302, "/login")));
  app.get("/join", (req, res) => (req.query.code && !req.query.token ? res.redirect(302, "/signup?code=" + encodeURIComponent(String(req.query.code).slice(0, 20))) : sendStatic(res, "join.html", loginPage())));
  app.get("/work", (req, res) => sendStatic(res, "landing.html", "<p>Page missing.</p>"));
  app.get("/discover", (req, res) => sendStatic(res, "discover.html", "<p>Discover page missing.</p>"));
  app.get("/plans", (req, res) => sendStatic(res, "plans.html", "<p>Plans page missing.</p>"));
  app.get("/quiz", (req, res) => sendStatic(res, "quiz.html", "<p>Quiz page missing.</p>"));
  app.get("/teams", (req, res) => sendStatic(res, "teams.html", "<p>Teams page missing.</p>"));
  app.get("/gifts", (req, res) => sendStatic(res, "gifts.html", "<p>Gifts page missing.</p>"));
  app.get("/covers", (req, res) => sendStatic(res, "covers.html", "<p>Covers page missing.</p>"));
  app.get("/teams/s/:id", (req, res) => sendStatic(res, "shortlist.html", "<p>Shortlist page missing.</p>"));
  app.get("/door/:id", (req, res) => sendStatic(res, "door.html", "<p>Door page missing.</p>"));
  app.get(["/team", "/team/:id"], (req, res) => sendStatic(res, "team.html", "<p>Team page missing.</p>"));
  app.get("/results", (req, res) => sendStatic(res, "results.html", "<p>Results page missing.</p>"));
  app.get("/vendor", (req, res) => sendStatic(res, "vendor.html", "<p>Vendor page missing.</p>"));
  app.get("/requests", (req, res) => sendStatic(res, "requests.html", "<p>Requests page missing.</p>"));
  app.get("/check/:id", (req, res) => sendStatic(res, "check.html", "<p>Check page missing.</p>"));
  app.get("/h/:handle", (req, res) => { const h = String(req.params.handle || "").toLowerCase(); if (/^[a-z0-9][a-z0-9-]{1,29}$/.test(h)) return res.redirect(301, "/@" + h + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "")); sendStatic(res, "host.html", "<p>Host page missing.</p>"); });
  // Every host's storefront: encore.example/@claire-runs
  // old or file-name handles that moved (a showcase listed as atelier-bo lives at @atbo)
  const HANDLE_ALIASES = { "atelier-bo": "atbo" };
  app.get(/^\/@([a-z0-9][a-z0-9-]{1,29})$/, (req, res, next) => { const to = HANDLE_ALIASES[req.params[0]]; if (to && !C.wsOfHandle(req.params[0])) return res.redirect(301, "/@" + to); next(); });
  app.get(/^\/@([a-z0-9][a-z0-9-]{1,29})$/, async (req, res) => { const ws = C.wsOfHandle(req.params[0]), h = (ws && C.profileOf(ws)) || C.showcaseOf(req.params[0]);
    try { let html = await fsp.readFile(path.join(PUBLIC_DIR, "host.html"), "utf8"); if (h) { const e = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); const desc = h.tagline || h.bio || `${h.name} on Pottery Lab`; const shop = h.shop?.open && h.shop.items?.length ? ` Order ${h.shop.items.map((x) => x.name).slice(0, 2).join(" and ")}.` : "";
        html = html.replace("<title>Host · Pottery Lab</title>", `<title>${e(h.name)} · Pottery Lab</title><meta name="description" content="${e(desc + shop)}"><meta property="og:title" content="${e(h.name)}"><meta property="og:description" content="${e(desc + shop)}"><meta property="og:type" content="profile"><meta property="og:url" content="${e(originOf(req))}/@${e(h.handle)}"><meta name="twitter:card" content="summary">`); }
      else { res.status(404); html = html.replace("<title>Host · Pottery Lab</title>", `<title>No host by that name · Pottery Lab</title><meta name="robots" content="noindex">`); }
      sendText(req, res, html); } catch { res.status(404).send("<p>Host page missing.</p>"); } });
  // the old measurement-method page described the event-team product; off while the site is about hosts
  app.get("/method", (req, res) => res.redirect(302, "/"));
  // pricing is being reworked for hosts and brands; until then the old page (event-team plans) is off
  app.get("/pricing", (req, res) => res.redirect(302, "/"));
  // The homepage demo runs the app's own planner, read from the current index.html.
  let estimateJs = null, estimateAt = 0;
  app.get("/estimate.js", async (req, res) => {
    try { const st = await fsp.stat(PAGE_FILE); if (!estimateJs || st.mtimeMs !== estimateAt) { estimateJs = buildEstimateScript(PAGE_FILE); estimateAt = st.mtimeMs; } res.type("application/javascript").set("Cache-Control", "public, max-age=300").send(estimateJs); }
    catch (e) { res.status(500).type("application/javascript").send("/* estimate unavailable */"); }
  });
  app.get("/security", (req, res) => sendStatic(res, "security.html", "<p>Security page missing.</p>"));
  // Privacy Policy and Terms (drafts for a lawyer to review). The legal name and address come from ENCORE_LEGAL_NAME and
  // ENCORE_LEGAL_ADDRESS, the same values /api/public/legal gives; without them the pages say "Pottery Lab" and no address.
  const legalPage = (file) => async (req, res) => {
    let html; try { html = await fsp.readFile(path.join(PUBLIC_DIR, file), "utf8"); } catch { return res.status(404).send("<p>Page missing.</p>"); }
    const name = String(process.env.ENCORE_LEGAL_NAME || "").trim() || "Pottery Lab", addr = String(process.env.ENCORE_LEGAL_ADDRESS || "").trim();
    sendText(req, res, html.replaceAll('{{LEGAL_NAME}} ("Pottery Lab", "we")', name !== "Pottery Lab" ? `${esc(name)} ("Pottery Lab", "we")` : 'Pottery Lab ("we")').replaceAll("{{LEGAL_NAME}}", esc(name)).replaceAll("{{LEGAL_ADDRESS}}", addr ? ", " + esc(addr) : "")); };
  // Unsubscribe from guest and follower mail (server/email.js). The emailed link opens a page with one button, so a mail
  // scanner opening the link doesn't unsubscribe anyone; mail apps' one-click unsubscribe POSTs straight here.
  const unsubPage = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Pottery Lab</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><style>body{margin:0;background:#F7F1E8;color:#1F1A17;font:16px/1.55 "Instrument Sans",system-ui,sans-serif}main{max-width:460px;margin:0 auto;padding:56px 16px}h1{font:600 30px/1.15 Fredoka,system-ui,sans-serif;margin:0 0 8px}p{color:#4A403A}button{min-height:44px;border:0;border-radius:999px;padding:12px 22px;font:600 16px system-ui;background:#C94A30;color:#fff;cursor:pointer}button.quiet{background:transparent;color:#A8441F;padding:12px 0}a{color:#A8441F}</style></head><body><main><p><a href="/">pottery lab</a></p><h1>${esc(title)}</h1>${body}</main></body></html>`;
  app.get("/unsubscribe", (req, res) => { const t = String(req.query.t || "").slice(0, 400), email = readUnsubToken(t);
    res.set("Cache-Control", "no-store").set("Referrer-Policy", "no-referrer");
    if (!email) return res.status(400).type("html").send(unsubPage("This link isn't working", "<p>Open the unsubscribe link from your email again.</p>"));
    const off = isUnsubscribed(email);
    res.type("html").send(unsubPage(off ? "You're unsubscribed" : "Stop these emails?", off ? `<p>${esc(email)} won't get event reminders, announcements or kudos asks.</p><form method="post"><input type="hidden" name="t" value="${esc(t)}"><input type="hidden" name="on" value="1"><button class="quiet">Turn them back on</button></form>` : `<p>${esc(email)} will stop getting event reminders, announcements, confirmations and kudos asks from Pottery Lab hosts.</p><form method="post"><input type="hidden" name="t" value="${esc(t)}"><button>Unsubscribe</button></form>`)); });
  app.post("/unsubscribe", express.urlencoded({ extended: false, limit: "4kb" }), (req, res) => { const t = String(req.body?.t || req.query.t || "").slice(0, 400), email = readUnsubToken(t);
    res.set("Cache-Control", "no-store");
    if (!email) return res.status(400).type("html").send(unsubPage("This link isn't working", "<p>Open the unsubscribe link from your email again.</p>"));
    const on = String(req.body?.on || "") === "1"; setUnsubscribed(email, !on);
    res.type("html").send(unsubPage(on ? "Emails are back on" : "You're unsubscribed", on ? `<p>${esc(email)} will get event emails again.</p>` : `<p>${esc(email)} won't get event reminders, announcements or kudos asks. Texts stop when you reply STOP.</p><form method="post"><input type="hidden" name="t" value="${esc(t)}"><input type="hidden" name="on" value="1"><button class="quiet">Undo</button></form>`)); });
  app.get(["/privacy", "/privacy.html"], legalPage("privacy.html"));
  app.get(["/terms", "/terms.html"], legalPage("terms.html"));

  // The app page is the same for everyone (data comes from the API), so build it once per edit of the file, keep it in
  // memory with an ETag, and pre-compress it with brotli at full quality in the background. Browsers revalidate on every
  // visit (no-cache) and get a 304 with no body when nothing changed.
  let pageCache = null, pageBuilding = null;
  // The app's big inline scripts and styles are served as their own files, named by a hash of their content and cached
  // for a year. A guest opening their second invite (or the same one again) downloads only the small page around them,
  // and the browser fetches the scripts in parallel while it draws the invite preview.
  const APP_ASSETS = new Map(), SPLIT_MIN = 8000;
  function splitPage(html) {
    const add = (body, ext) => { const h = crypto.createHash("sha1").update(body).digest("base64url").slice(0, 16), key = `${h}.${ext}`;
      if (!APP_ASSETS.has(key)) { const buf = Buffer.from(body), A = { type: ext === "js" ? "application/javascript; charset=utf-8" : "text/css; charset=utf-8", body: buf, gz: zlib.gzipSync(buf, { level: 9 }), br: null };
        APP_ASSETS.set(key, A); zlib.brotliCompress(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }, (err, out) => { if (!err) A.br = out; }); }
      return key; };
    const scripts = []; // the app scripts, in page order
    // scripts first, exactly as the HTML parser reads them (a script ends at the first </script>), so <style> text inside
    // JavaScript strings is never touched; small scripts stay inline and keep their place
    const kept = [];
    let out = html.replace(/<script>([\s\S]*?)<\/script>/g, (m, code) => { if (code.length < SPLIT_MIN) { kept.push(m); return `\u0000S${kept.length - 1}\u0000`; } const k = add(code, "js"); scripts.push(k); return `<script src="/_app/${k}" fetchpriority="high"></script>`; })
      .replace(/<style>([\s\S]*?)<\/style>/g, (m, css) => (css.length < SPLIT_MIN ? m : `<link rel="stylesheet" href="/_app/${add(css, "css")}">`))
      .replace(/\u0000S(\d+)\u0000/g, (m, i) => kept[+i]);
    // on invite links (/g), web fonts wait until the app has loaded: the RSVP form is usable sooner on a slow phone,
    // and the text swaps to the brand fonts a moment later (they're cached for the next visit)
    out = out.replace(/(<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^"]*")>/, '$1 id="gfonts"><script>if(location.pathname==="/g"){const l=document.getElementById("gfonts");l.media="print";addEventListener("load",()=>{l.media="all"})}</script>');
    return out;
  }
  app.get(/^\/_app\/([A-Za-z0-9_-]{16}\.(?:js|css))$/, (req, res) => { const A = APP_ASSETS.get(req.params[0]); if (!A) return res.status(404).type("text").send("Not found");
    res.set({ "Cache-Control": "public, max-age=31536000, immutable", "Content-Type": A.type, Vary: "Accept-Encoding" }); const ae = req.headers["accept-encoding"] || "";
    if (A.br && /\bbr\b/.test(ae)) return res.set("Content-Encoding", "br").send(A.br); if (/\bgzip\b/.test(ae)) return res.set("Content-Encoding", "gzip").send(A.gz); res.send(A.body); });
  async function builtPage() {
    const st = await fsp.stat(PAGE_FILE); if (pageCache && pageCache.mtime === st.mtimeMs) return pageCache;
    if (pageBuilding) return pageBuilding;
    pageBuilding = (async () => { const html = Buffer.from(process.env.ENCORE_INLINE_APP === "1" ? HEAD + (await fsp.readFile(PAGE_FILE, "utf8")) + TAIL : splitPage(HEAD + (await fsp.readFile(PAGE_FILE, "utf8")) + TAIL)), etag = '"' + crypto.createHash("sha1").update(html).digest("base64url").slice(0, 20) + '"';
      const P = { mtime: st.mtimeMs, html, etag, br: null, gz: zlib.gzipSync(html, { level: 9 }) }; pageCache = P;
      zlib.brotliCompress(html, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: html.length } }, (err, out) => { if (!err && pageCache === P) P.br = out; });
      return P; })().finally(() => { pageBuilding = null; });
    return pageBuilding;
  }
  const sendPage = async (req, res, next) => {
    try {
      const P = await builtPage(); res.set({ "Cache-Control": "private, no-cache", ETag: P.etag, Vary: "Accept-Encoding" }).type("html");
      if (req.headers["if-none-match"] === P.etag) return res.status(304).end();
      if (P.br && /\bbr\b/.test(req.headers["accept-encoding"] || "")) return res.set("Content-Encoding", "br").send(P.br);
      if (/\bgzip\b/.test(req.headers["accept-encoding"] || "")) return res.set("Content-Encoding", "gzip").send(P.gz);
      res.send(P.html);
    } catch (err) { next(err); }
  };
  builtPage().catch(() => {});
  // Guest links (#rsvp-ID, #survey-ID) are hashes the server never sees. The login
  // page forwards them to /g, which serves the same page without a login; the
  // data endpoints still only allow the guest operations listed in guestAllowed().
  app.get("/favicon.ico", (req, res) => res.redirect(301, "/favicon.svg"));
  app.get("/g", sendPage);
  // Without a photo, a share link shows the line-art card for the event's illustration (public/og/<kind>.png, made by
  // scripts/make-og.cjs). The illustration is picked the same way the invite picks its cover, using eventart.js itself.
  let EA = null; try { const sandbox = { window: {}, document: { head: { appendChild() {} }, createElement: () => ({ style: {} }), getElementById: () => null, querySelector: () => null } }; sandbox.window.document = sandbox.document; vm.runInNewContext(fs.readFileSync(path.join(PUBLIC_DIR, "eventart.js"), "utf8"), sandbox); EA = sandbox.window.EventArt || null; } catch {}
  const ogCardFor = (ev, base) => { try { const pick = ev.coverArt && typeof ev.coverArt === "object" && EA?.valid(ev.coverArt.kind) ? String(ev.coverArt.kind).split("+")[0] : EA ? EA.kindOf(ev) : "party"; return fs.existsSync(path.join(PUBLIC_DIR, "og", pick + ".png")) ? `${base}/og/${pick}.png` : `${base}/og/party.png`; } catch { return ""; } };
  // A share link with a preview: /e/<id> tells iMessage, WhatsApp and Instagram the event's title, date and cover,
  // and is the reply page itself (public/invite.html). The part after "#" never reaches a server, so /g links can't preview.
  // "Come with me?" links (/i/<id>?with=<token>) open the same light invite; the preview says who sent it
  app.get(/^\/i\/([A-Za-z0-9_-]{2,80})$/, (req, res, next) => { const id = req.params[0], tok = String(req.query.with || ""), ws = workspaceOfEvent(id);
    try { const St = ws && scopeStore(store, ws), ev = St?.get("events/" + id)?.data, F = ev && findHold(St, id, tok); if (F && F.inviter.data?.response === "going") req.cwOg = `${firstOf(F.inviter.data.name) || "A friend"} wants you to come to ${titleOf(ev)}`; } catch {}
    req.url = "/e/" + id + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""); next(); });
  app.get(/^\/e\/([A-Za-z0-9_-]{2,80})$/, (req, res) => { const id = req.params[0], ws = workspaceOfEvent(id), ev = ws ? scopeStore(store, ws).get("events/" + id)?.data : null, to = "/g#rsvp-" + encodeURIComponent(id);
    const e = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]), base = `${req.protocol}://${req.get("host")}`;
    if (!ev || ev.example) return res.redirect(302, to);
    const h = C.profileOf(ws), title = ev.pubTitle || ev.name || "You're invited", when = ev.date ? new Date(ev.date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "",
      time = /^\d{2}:\d{2}$/.test(ev.startTime || "") ? new Date("2000-01-01T" + ev.startTime + ":00Z").toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }) : "",
      desc = [when && `${when}${time ? " · " + time : ""}`, ev.hood || ev.city || "", h?.name ? `Hosted by ${h.name}` : ""].filter(Boolean).join(" · "),
      img = /^\/_blob\/[A-Za-z0-9_-]{6,80}$/.test(ev.coverPhoto || "") ? base + ev.coverPhoto : /^https:\/\/[^\s"'<>]+$/.test(ev.coverPhoto || "") ? ev.coverPhoto : ogCardFor(ev, base);
    // the invite itself, in a page small enough to open instantly on a phone (public/invite.html); it hands anything
    // it doesn't handle (paid Ask to join, a pay step, slots, polls, work events, past events) to the full invite at /g#rsvp-<id>
    const meta = `<title>${e(title)} · Pottery Lab</title>
<meta property="og:type" content="website"><meta property="og:title" content="${e(req.cwOg || title)}"><meta property="og:description" content="${e(desc || "You're invited.")}"><meta property="og:url" content="${e(base + "/e/" + id)}"><meta property="og:site_name" content="Pottery Lab">${img ? `<meta property="og:image" content="${e(img)}">${/\/og\/[a-z]+\.png$/.test(img) ? `<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">` : ""}<meta name="twitter:card" content="summary_large_image">` : `<meta name="twitter:card" content="summary">`}
<meta name="description" content="${e(desc)}"><link rel="canonical" href="${e(base + "/e/" + id)}">`;
    const page = invitePage();
    if (!page) return res.redirect(302, to);
    // compressed (brotli when the phone takes it, else gzip): the invite is most of what a guest downloads before replying
    sendText(req, res, page.replace("<!--META-->", () => meta), { cache: "public, max-age=120" }); });
  // public/invite.html, read again only when the file changes
  let inviteCache = null;
  function invitePage() { const f = path.join(PUBLIC_DIR, "invite.html");
    try { const m = fs.statSync(f).mtimeMs; if (!inviteCache || inviteCache.m !== m) inviteCache = { m, html: fs.readFileSync(f, "utf8") }; return inviteCache.html; } catch { return ""; } }
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
  // Send text with an ETag (repeat visits get a 304) and brotli when the browser takes it. Compressed bodies are cached
  // by content hash, so a page or script is compressed once per version.
  const brCache = new Map();
  function sendText(req, res, body, { type = "html", cache = "private, no-cache" } = {}) {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body)), etag = '"' + crypto.createHash("sha1").update(buf).digest("base64url").slice(0, 20) + '"';
    res.set({ "Cache-Control": cache, ETag: etag, Vary: "Accept-Encoding" }).type(type);
    if (req.headers["if-none-match"] === etag) return res.status(304).end();
    if (buf.length > 1024 && /\bbr\b/.test(req.headers["accept-encoding"] || "")) { let br = brCache.get(etag);
      if (!br) { br = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: buf.length < 400000 ? 11 : 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }); if (brCache.size > 400) brCache.clear(); brCache.set(etag, br); }
      return res.set("Content-Encoding", "br").send(br); }
    if (buf.length > 1024 && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) { const k = "gz" + etag; let gz = brCache.get(k);
      if (!gz) { gz = zlib.gzipSync(buf, { level: 9 }); if (brCache.size > 400) brCache.clear(); brCache.set(k, gz); }
      return res.set("Content-Encoding", "gzip").send(gz); }
    res.send(buf);
  }
  // scripts, styles, SVG and JSON from public/: compressed, cached for five minutes, then revalidated
  const fileCache = new Map();
  app.use(async (req, res, next) => { if (req.method !== "GET" || !/^\/[A-Za-z0-9_\-./]+\.(js|css|svg|json)$/.test(req.path) || req.path.includes("..")) return next();
    const f = path.join(PUBLIC_DIR, req.path); if (!f.startsWith(PUBLIC_DIR + path.sep)) return next();
    try { const st = await fsp.stat(f); if (!st.isFile()) return next(); let c = fileCache.get(f); if (!c || c.mtime !== st.mtimeMs) { c = { mtime: st.mtimeMs, buf: await fsp.readFile(f) }; fileCache.set(f, c); }
      const type = { js: "application/javascript", css: "text/css", svg: "image/svg+xml", json: "application/json" }[req.path.split(".").pop()];
      return sendText(req, res, c.buf, { type, cache: "public, max-age=300" }); } catch { return next(); } });
  app.use(express.static(PUBLIC_DIR, { index: false }));

  // ---------- community: invite codes, host pages, followers, discover (public parts check nothing; member parts check the session) ----------
  mountCommunity(app, { X, store, small, currentUser, ownerOnly: (req, res) => ownerOnly(req, res), publicOrigin: (req) => originOf(req), C });
  app.locals.social = X;
  mountSocial(app, { store, small, currentUser, publicOrigin: (req) => originOf(req), C, X, afterRsvp: (...a) => afterRsvp(...a), raw: express.raw({ type: () => true, limit: `${Number(process.env.ASSET_MAX_MB || 15)}mb` }) });
  mountFeedVisual(app, { store, small, currentUser, C, X }); // ---- visual feed (server/feedvisual.js) ----
  mountComeWith(app, { store, small, currentUser, X }); // "Come with me?" (server/comewith.js)
  mountHostLike(app, { store, small, currentUser }); // "Host one like this" (server/hostlike.js)
  mountHosts(app, { store, small, currentUser, publicOrigin: (req) => originOf(req), C, X });
  mountRecognition(app, { C, X });
  mountGiftPlan(app, { store, small, discoverHosts: () => C.discover().hosts.filter((h) => h.handle && h.name) });
  app.get(["/gifts/plan", "/gifts/plan/:id"], (req, res) => sendStatic(res, "giftplan.html", "<p>Gift planner missing.</p>"));
  const SB = mountScrapbook(app, { store, small: express.json({ limit: "200kb" }), currentUser, C, saveImage: async (buf, type, ws) => { const id = randomId(); await fsp.writeFile(path.join(assetsDir, id), buf); await fsp.writeFile(path.join(assetsDir, id + ".json"), JSON.stringify({ id, url: "/_blob/" + id, sizeBytes: buf.length, contentType: type, createdAt: Date.now(), ws })); return "/_blob/" + id; } });
  app.get("/recap/:handle", (req, res) => { if (!C.wsOfHandle(String(req.params.handle || "").toLowerCase())) { res.status(404); return sendStatic(res, "404.html", "<p>Page not found.</p>"); } sendStatic(res, "recap.html", "<p>Recap missing.</p>"); });
  mountShop(app, { store, small, currentUser, publicOrigin: (req) => originOf(req), C, X });
  mountMarket(app, { store, small, currentUser, publicOrigin: (req) => originOf(req), C, X });
  mountBrand(app, { small, currentUser });
  mountCollabs(app, { store, small, currentUser, C, X });
  mountOnboard(app, { store, currentUser, C, sendStatic, publicOrigin: (req) => originOf(req) });
  // the events directory: /events, its read-only API (/api/v1) for people and agents, and a public MCP server (/mcp/public)
  mountDirectory(app, { store, small, C, SB, PUBLIC_DIR, sendText, guestRedirect: GUEST_REDIRECT, publicOrigin: (req) => originOf(req) });
  // host leaderboards: /leaderboard, its feed card and moments, and the host page chip (the API is in the directory's /api/v1)
  mountLeaderboard(app, { store, C, X, sendStatic });
  // kudos asked of every guest the morning after, the one-tap kudos page (/k/<event>) and the second-host loop count
  mountKudosAsk(app, { store, small, C, X, ownerOnly: (req, res) => ownerOnly(req, res), sendStatic, publicOrigin: (req) => originOf(req) });
  // ---- repeats: weekly and monthly events make their next date the morning after, and old links show it (server/repeats.js) ----
  mountRepeats(app, { store, C, X, ownerOnly: (req, res) => ownerOnly(req, res), workspaceOfEvent });
  mountTables(app, { store, small, C, X, currentUser, ownerOnly: (req, res) => ownerOnly(req, res), sendStatic, publicOrigin: (req) => originOf(req) }); // review round 11: tables (server/tables.js)
  // ---- end repeats ----
  // help: Potto answers from docs/help.md, a person answers the rest (/api/help/*), and the team inbox (/support, admins only)
  mountHelp(app, { store, express, currentUser, C, X, sendStatic, publicOrigin: (req) => originOf(req) });
  // hooks for new people: "What are you into?", Inspo, saves and boards, the passport, friends going, the weekend digest (server/hooks.js)
  mountHooks(app, { store, currentUser, publicOrigin: (req) => originOf(req), C, X, SB, sendStatic, express });
  // ---------- a guest's own reply, from any phone or browser ----------
  // "Email me my link": sends the link to the address on the reply (never says whether there is one).
  const replyHits = new Map(); const replyLimited = (req, n) => { const k = (req.ip || "?") + req.path, now = Date.now(); let h = replyHits.get(k); if (!h || now - h.start > 3600_000) { h = { n: 0, start: now }; replyHits.set(k, h); } return ++h.n > n; };
  app.post("/api/public/reply/link", small, async (req, res) => { if (replyLimited(req, 10)) return res.status(429).json({ code: "rate_limited", message: "Too many tries. Try again later." });
    const eventId = String(req.body?.eventId || "").slice(0, 80), email = String(req.body?.email || "").trim().toLowerCase(), ws = /^[A-Za-z0-9_-]+$/.test(eventId) ? workspaceOfEvent(eventId) : null;
    if (!ws || !EMAIL_OK(email)) return res.status(400).json({ code: "invalid", message: "Add the email you replied with." });
    const on = emailOn(ws), d = on ? scopeStore(store, ws).list("rsvps").find((x) => x.data?.eventId === eventId && String(x.data.email || "").trim().toLowerCase() === email) : null;
    if (d) await sendReplyLink(req, ws, d.id).catch(() => false);
    res.json({ ok: true, emailOn: on, message: on ? "If you replied with that email, a link is on its way. Open it here to change your reply." : "Email isn't set up for this event. Open the invite on the phone or browser you used, or ask your host." }); });
  // Opening the emailed link: this browser can now see and change the reply (the first device keeps working too).
  app.post("/api/public/reply/claim", small, (req, res) => { if (replyLimited(req, 30)) return res.status(429).json({ code: "rate_limited", message: "Too many tries. Try again later." });
    const eventId = String(req.body?.eventId || "").slice(0, 80), rid = String(req.body?.rid || "").slice(0, 80), t = String(req.body?.t || ""), k = String(req.get("x-encore-key") || "").slice(0, 64);
    const ws = /^[A-Za-z0-9_-]+$/.test(eventId) ? workspaceOfEvent(eventId) : null, St = ws && scopeStore(store, ws), d = St && /^[A-Za-z0-9_-]+$/.test(rid) ? St.get("rsvps/" + rid) : null;
    if (!d || d.data?.eventId !== eventId || !eq(replyToken(ws, rid), t)) return res.status(404).json({ code: "not_found", message: "This link doesn't work any more. Ask for a new one from the invite." });
    if (k.length < 8) return res.status(400).json({ code: "invalid", message: "Missing guest key." });
    const r = d.data; if (r._k !== k && !(r._keys || []).includes(k)) St.update("rsvps/" + rid, { _keys: [...(r._keys || []).filter((x) => x !== k), k].slice(-5) });
    // review round 11: this link was only ever emailed to the address on the reply, so opening it proves that email (guestVouch)
    // (not when the guest changed the email after the link went out: then only a link sent since proves the new one)
    if (EMAIL_OK(String(r.email || "").trim()) && String(r.emailProven || "") !== String(r.email).trim().toLowerCase() && (!r.emailChangedAt || (r.linkSentAt || 0) > r.emailChangedAt)) St.update("rsvps/" + rid, { emailProvenAt: Date.now(), emailProven: String(r.email).trim().toLowerCase() });
    const all = St.list("rsvps").filter((x) => x.data?.eventId === eventId);
    res.json({ ok: true, rid, eventId, code: r.code || "", name: r.name || "", email: r.email || "", response: r.response || "", party: r.party || 1, dietary: r.dietary || "", ...(r.response === "waitlist" ? { waitlistPos: waitlistPos(all, rid), waiting: waitlistOf(all).length } : {}) }); });
  // Where a reply stands, for the guest who holds its id and code: the response and, on the waitlist, their place in line.
  app.get("/api/public/reply/:eventId", (req, res) => { const eventId = String(req.params.eventId || "").slice(0, 80), P = X.rsvpProof(eventId, req.query.rid, req.query.code);
    if (!P) return res.status(404).json({ code: "not_found", message: "No such reply." });
    const all = P.S.list("rsvps").filter((x) => x.data?.eventId === eventId), ev = P.ev || {}, seats = +ev.headcount || 0, waiting = waitlistOf(all).length;
    res.json({ response: P.r.response || "", party: seatsOf(P.r, ev), paid: !!P.r.paid, paidClaim: !!P.r.paidClaim, decidedAt: P.r.decidedAt || null, ...(P.r.response === "waitlist" ? { waitlistPos: waitlistPos(all, P.rid) } : {}), waiting, seats, ...(seats && ev.autoWait !== false ? { left: waiting ? 0 : Math.max(0, seats - seatsTaken(ev, all)) } : {}) }); });
  mountChecks(app, { store, small, currentUser, publicOrigin: (req) => originOf(req) });
  app.get("/vendor/jspdf.umd.min.js", (req, res) => res.set("Cache-Control", "public, max-age=604800").sendFile(path.join(ROOT, "node_modules", "jspdf", "dist", "jspdf.umd.min.js")));
  app.get("/booking/:id", (req, res) => sendStatic(res, "booking.html", "<p>Booking page missing.</p>"));
  app.get("/hosts", (req, res) => sendStatic(res, "hostdir.html", "<p>Hosts page missing.</p>"));
  app.get("/hosts/book", (req, res) => sendStatic(res, "hosts.html", "<p>Hosts page missing.</p>"));
  app.get("/feed", (req, res) => sendStatic(res, "feed.html", "<p>Feed page missing.</p>")); // signed out: a public feed of open events

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
    if (!EMAIL_OK(email)) return res.status(400).json({ code: "invalid", message: "That email doesn't look right." });
    if (emailTaken(email)) return res.status(409).json({ code: "conflict", message: "That person already has a Pottery Lab account." });
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
    // review round 8: crm is true only for a team workspace with a CRM connected (the brand request form's CRM fields)
    const crm = !!u && W?.plan !== "friends" && (listConnections(ws).some((c) => c.connected && ["hubspot", "salesforce", "attio"].includes(c.provider)) || !!(process.env.HUBSPOT_TOKEN || process.env.SF_ACCESS_TOKEN));
    res.json(u ? { name: u.name, email: u.email, roles: u.roles, teamRoles, approverRoles: approverRoles(ws), owner: !!u.owner, workspace, verified: true, ...(crm ? { crm: true } : {}) } : { verified: false, teamConfigured: teamOf(ws).length > 0 });
  });
  // The audit log can only be appended to, and the server stamps who and when.
  const AUDIT = /^(faq|followers|kudos|kudosasks|kudosloop|vibes|chat|moments|jobs|inquiries|stats|broadcasts|orders|audit|approvals|aeactions|system|signoffs|outbox|crmwrites|reminders|settings|checks|checkReplies)(\/|$)/;
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
      if (changed) { st.set("signoffs/" + m[1], so.data); st.add("audit", { eventId: m[1], what: `${evN.data.name || m[1]}: sign-off needs renewing; the plan is now ${nowM.currency} ${nowM.cost.toLocaleString("en-US")}`, who: "Pottery Lab server", email: null, verified: true, at: Date.now() }); } }
    const ap = st.get("approvals/" + m[1]); if (!ap || !Object.keys(ap.data.roles || {}).length) return;
    const ev = st.get(p); if (!ev) return;
    const now = eventMoney(ev.data), moved = (a, b) => Math.abs(a - b) > Math.max(500, b * 0.05);
    const stale = Object.entries(ap.data.roles).filter(([, a]) => (a.currency || "USD") !== now.currency || moved(now.cost, a.cost || 0) || moved(now.committed, a.committed || 0));
    if (!stale.length) return;
    for (const [r] of stale) delete ap.data.roles[r];
    st.set("approvals/" + m[1], ap.data);
    st.add("audit", { eventId: m[1], what: `${ev.data.name || m[1]}: approvals reset (${stale.map(([r]) => r).join(", ")}): the plan is now ${now.currency} ${now.cost.toLocaleString("en-US")} with ${now.currency} ${now.committed.toLocaleString("en-US")} committed`, who: "Pottery Lab server", email: null, verified: true, at: Date.now() });
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

  // ---------- Email from Pottery Lab ----------
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
      if (!serversFor(req).some((x) => x.server === rec.server)) return res.status(404).json({ code: "server_not_connected", message: "The CRM isn't connected any more." });
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
      if (doc.data.casual && view !== "plan") { try { const hn = String(getDbUser(getWorkspace(req.ws)?.ownerEmail || "")?.name || "").trim().split(/\s+/)[0]; const fix = (x) => (typeof x === "string" ? x.replace(/\b(my|our) (place|apartment|flat|house|home|stoop|porch|backyard|yard|garden|rooftop|kitchen|studio|driveway)\b/gi, (m, w, pl) => (hn ? `${hn}'s ${pl.toLowerCase()}` : `the host's ${pl.toLowerCase()}`)) : x); for (const k of ["meetPoint", "venueName", "name", "pubTitle"]) if (data[k]) data[k] = fix(data[k]); } catch {} }
      // Get-togethers: which bring-list items or pickup windows are already taken (no names), so guests don't double up.
      if (doc.data.casual && !doc.data.preorder /* review 8: pickup times are shared */ && !/giveaway/.test(doc.data.activity || "") && Array.isArray(doc.data.slots) && doc.data.slots.length) { const taken = new Set([...(doc.data.guests || []).map((g) => g.slot), ...S(req).list("rsvps").filter((d) => d.data?.eventId === doc.id && d.data.response === "going").map((d) => d.data.slot)].filter(Boolean)); data.claimed = doc.data.slots.filter((x) => taken.has(x)); }
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
    if (doc && req.guest && /^events\/[^/]+$/.test(p) && isExampleWs(req.ws)) data = { ...data, sample: true };
    if (doc && req.guest && p === "canvas/main") data = publicCanvas(data);
    res.json(doc ? { exists: true, id: doc.id, data, updated: doc.updated, ...where } : { exists: false, id: p.split("/").pop(), ...where });
  });
  const guestKey = (req) => String(req.get("x-encore-key") || "").slice(0, 64);
  // ---------- two devices, one event ----------
  // Saves carry the version they started from (_base). The server keeps the last few versions of each event, so a save
  // that started from an older version is merged field by field: what only you changed is saved, what only the other
  // device changed is kept, and only a field both changed differently is a conflict (409, with what changed).
  // A save may also name the fields it changed (_fields): then only those are written, whatever else the draft holds.
  const stable = (v) => JSON.stringify(v === undefined ? null : v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((kk) => [kk, x[kk]])) : x));
  const same = (a, b) => stable(a) === stable(b);
  const histPath = (p) => "evhist/" + p.split("/")[1];
  function rememberVersion(St, p, data) {
    if (!data?.updatedAt || !/^events\/[^/]+$/.test(p)) return;
    try { const L0 = St.get(histPath(p))?.data?.versions || []; if (L0.some((v) => v.v === data.updatedAt)) return;
      let L = [...L0, { v: data.updatedAt, data }].slice(-6); while (L.length > 1 && JSON.stringify(L).length > 1_500_000) L = L.slice(1);
      St.set(histPath(p), { versions: L }); } catch {}
  }
  const versionAt = (St, p, v) => (St.get(histPath(p))?.data?.versions || []).find((x) => x.v === v)?.data || null;
  // worked out by each device on its own (the stage label) or only ever added to (the activity log): never a conflict
  const SOFT_FIELDS = new Set(["status", "log", "updatedAt", "createdAt", "example"]);
  const CONFLICT_MSG = "This event changed on another device while you edited the same part. Reload to see their version, then make your change again.";
  const versionOk = (req, res) => {
    const p = String(req.query.path || "");
    if (!/^events\//.test(p) || req.guest) return true;
    const m = /^events\/([^/]+)$/.exec(p);
    if (m && !claimEvent(m[1], sessionWorkspace(req))) { res.status(409).json({ code: "conflict", message: "That event id is already used. Save it under a new id." }); return false; }
    const base = req.body?._base, F = Array.isArray(req.body?._fields) ? req.body._fields.filter((k) => typeof k === "string" && /^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(k) && !SOFT_FIELDS.has(k)).slice(0, 300) : null;
    if (req.body) { delete req.body._base; delete req.body._fields; delete req.body.approvals; }
    const cur = S(req).get(p);
    if (!m || !cur || !cur.data?.updatedAt) return true;
    const mine = req.body && typeof req.body === "object" ? req.body : {}, theirs = cur.data;
    const fields = req.method === "PATCH" ? Object.keys(mine).filter((k) => !SOFT_FIELDS.has(k)) : F;
    if (base === theirs.updatedAt && !(fields && req.method === "PUT")) return true; // up to date: save as sent
    // A save that doesn't say which version it started from can't overwrite a versioned event.
    if (base == null) { res.status(409).json({ code: "conflict", message: "This save didn't say which version of the event it started from. Reload the event, then save again.", current: theirs, updatedAt: theirs.updatedAt }); return false; }
    const was = base === theirs.updatedAt ? theirs : versionAt(S(req), p, base);
    if (!fields && !was) { res.status(409).json({ code: "conflict", message: "Someone else changed this event since you opened it. Reload to see their changes, then save again.", changed: Object.keys({ ...mine, ...theirs }).filter((k) => !SOFT_FIELDS.has(k) && !same(mine[k], theirs[k])), current: theirs, updatedAt: theirs.updatedAt }); return false; }
    const out = { ...theirs }, conflicts = [], kept = [];
    if (fields) {
      for (const k of fields) { if (was && !same(theirs[k], was[k]) && !same(theirs[k], mine[k])) { conflicts.push(k); continue; } if (k in mine) out[k] = mine[k]; else if (req.method === "PUT") delete out[k]; }
      if (was) for (const k of Object.keys({ ...theirs, ...was })) if (!fields.includes(k) && !SOFT_FIELDS.has(k) && !same(theirs[k], was[k])) kept.push(k);
    } else {
      for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs), ...Object.keys(was)])) { if (SOFT_FIELDS.has(k)) continue;
        const a = mine[k], t = theirs[k], b0 = was[k];
        if (same(a, t)) continue;
        if (same(a, b0)) { kept.push(k); continue; } // only the other device changed it: keep theirs
        if (same(t, b0)) { if (k in mine) out[k] = a; else delete out[k]; continue; } // only you changed it
        conflicts.push(k); }
    }
    if (conflicts.length) { res.status(409).json({ code: "conflict", message: CONFLICT_MSG, conflicts, changed: kept, current: theirs, updatedAt: theirs.updatedAt }); return false; }
    for (const k of ["status", "example"]) if (k in mine) out[k] = mine[k];
    if (Array.isArray(mine.log) || Array.isArray(theirs.log)) { const seen = new Set((theirs.log || []).map(stable)); out.log = [...(theirs.log || []), ...(mine.log || []).filter((x) => !seen.has(stable(x)))].slice(-500); }
    out.updatedAt = Math.max(+mine.updatedAt || Date.now(), (+theirs.updatedAt || 0) + 1);
    req.body = out; if (base !== theirs.updatedAt || kept.length) req.merged = { merged: true, theirs: kept, updatedAt: out.updatedAt };
    return true;
  };
  // Guest RSVPs and wall entries: the server stamps the source and only takes the statuses a guest may choose.
  // ---- review round 11: guest survey answers (feedback) and roadmap invite requests (interest) ----
  // Small (4 KB), only the fields the survey and request forms send, for a real event (or a roadmap item), and a few an hour
  // from one address per event, so a guest link can't be used to fill the store.
  const noteHits = new Map(), GUEST_NOTE_MAX = 4 * 1024;
  const noteStr = (v, n) => String(v ?? "").replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
  const noteNum = (v, lo, hi) => (typeof v === "number" && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined);
  const NOTE_FIELDS = {
    feedback: { rating: (v) => noteNum(v, 0, 10), nps: (v) => noteNum(v, 0, 10), highlights: (v) => (Array.isArray(v) ? v.slice(0, 12).filter((x) => typeof x === "string").map((x) => noteStr(x, 80)).filter(Boolean) : undefined),
      role: (v) => noteStr(v, 120), wouldReturn: (v) => (typeof v === "boolean" ? v : undefined), gotValue: (v) => (typeof v === "boolean" ? v : undefined), referral: (v) => noteStr(v, 200),
      referralNameOk: (v) => (typeof v === "boolean" ? v : undefined), comment: (v) => noteStr(v, 1500), lift: (v) => noteStr(v, 40), nextIdea: (v) => noteStr(v, 500) },
    interest: { item: (v) => noteStr(v, 160), name: (v) => noteStr(v, 120), email: (v) => noteStr(v, 200), company: (v) => noteStr(v, 120), title: (v) => noteStr(v, 120) },
  };
  function guestNote(req, res, collection, b) {
    if (Buffer.byteLength(JSON.stringify(b)) > GUEST_NOTE_MAX) { res.status(413).json({ code: "too_large", message: "That's too much to send. Try a shorter note." }); return false; }
    const eventId = String(b.eventId || "");
    if (collection === "feedback" || eventId) { if (!/^[A-Za-z0-9_-]{1,80}$/.test(eventId) || !S(req).get("events/" + eventId)) { res.status(404).json({ code: "not_found", message: "That event isn't here any more." }); return false; } }
    const o = {}; for (const [k, f] of Object.entries(NOTE_FIELDS[collection])) { if (b[k] == null) continue; const v = f(b[k]); if (v !== undefined && v !== "") o[k] = v; }
    if (collection === "interest" && !o.item) { res.status(400).json({ code: "invalid", message: "Pick what you'd like an invite to." }); return false; }
    const now = Date.now(), ip = req.ip || "?"; if (noteHits.size > 50_000) noteHits.clear();
    const hit = (k, n) => { let h = noteHits.get(k); if (!h || now - h.start > 3600_000) { h = { n: 0, start: now }; noteHits.set(k, h); } return ++h.n > n; };
    const a = hit(`${collection}|${ip}|${eventId || o.item}`, +(process.env.ENCORE_NOTE_PER_HOUR || 10)), z = hit(`${collection}|${ip}`, +(process.env.ENCORE_NOTE_IP_PER_HOUR || 60));
    if (a || z) { res.status(429).json({ code: "rate_limited", message: "Lots of answers from here at once. Try again in a few minutes." }); return false; }
    req.body = { ...o, ...(eventId ? { eventId } : {}), source: "guest", createdAt: now };
    return true;
  }
  // ---- end review round 11 guest notes ----
  const guestShape = (req, res, collection) => {
    if (!req.guest) return true;
    let b = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    if (GUEST_COLLECTIONS.has(collection) && Buffer.byteLength(JSON.stringify(b)) > GUEST_BODY_MAX) { res.status(413).json({ code: "too_large", message: "That's too much to send. Try a smaller photo or a shorter note." }); return false; }
    if (collection === "feedback" || collection === "interest") return guestNote(req, res, collection, b); // review round 11
    if (collection === "rsvps") {
      const raw0 = b; b = cleanGuestRsvp(b);
      // ---- review round 8: a pre-order is rebuilt here from the event's own items and prices (server/preorder.js) ----
      { const pth = String(req.query.path || ""), cur0 = /^rsvps\/[A-Za-z0-9_-]+$/.test(pth) ? S(req).get(pth)?.data : null, eid0 = String(b.eventId || cur0?.eventId || "");
        const evO = /^[A-Za-z0-9_-]{1,80}$/.test(eid0) ? (S(req).get("events/" + eid0)?.data || null) : null;
        delete b.order;
        // review round 11: past the order-by date (where the event is), new orders and changes are closed; Can't go still works
        if (evO && ordersClosed(evO) && String(b.response || "").toLowerCase() !== "no" && (raw0.orderQty != null || raw0.order != null || String(b.response || "").toLowerCase() === "going")) {
          res.status(409).json({ code: "orders_closed", message: evO.orderBy ? `Orders closed. The last day to order was ${evO.orderBy}.` : "Orders closed." }); return false; }
        if (evO?.preorder && (raw0.orderQty != null || raw0.order != null)) { const O = buildOrder(evO, { orderQty: raw0.orderQty, order: raw0.order, slot: b.slot });
          if (O.error) { res.status(400).json({ code: "invalid_order", message: O.error }); return false; }
          if (O.order) { b.order = O.order; if (O.orderLines) { b.orderLines = O.orderLines; b.orderTotal = O.orderTotal; } } }
        else if (evO?.preorder && cur0?.order && req.method === "PUT") b.order = cur0.order; }
      // ---- end review round 8 pre-orders ----
      for (const k of ["response", "status"]) if (b[k] != null && !GUEST_RSVP_RESPONSES.has(String(b[k]).toLowerCase())) { res.status(400).json({ code: "invalid", message: "Pick I'm in, Maybe or Can't go." }); return false; }
      const utm = cleanUtm(b.utm); delete b.utm;
      // Ticketed dinners can open to followers first: everyone else waits until the window closes.
      if (String(b.response || "").toLowerCase() !== "no" && b.eventId) { const ws0 = workspaceOfEvent(String(b.eventId)), ev0 = ws0 && scopeStore(store, ws0).get("events/" + String(b.eventId))?.data;
        if (ev0 && earlyAccessBlocks(ev0, C.followersOf(ws0).some((f) => f.email === String(b.email || "").trim().toLowerCase()))) { res.status(403).json({ code: "early_access", message: `Followers get first dibs until ${new Date(ev0.earlyUntil).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}. Follow the host with this email to book now, or come back then.` }); return false; } }
      // answers to the host's own questions: a few short values, plain text only
      if (Array.isArray(b.answers) && b.answers.every((x) => x && typeof x === "object" && "a" in x)) { b.answers = b.answers.slice(0, 15).map((x) => ({ q: String(x.q ?? "").replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 140), a: String(x.a ?? "").replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 500) })).filter((x) => x.a); }
      else if (b.answers != null) { const A = {}; if (b.answers && typeof b.answers === "object") for (const [k, v] of Object.entries(b.answers).slice(0, 15)) { if (!/^[a-z0-9]{1,12}$/i.test(k)) continue; const one = (x) => String(x ?? "").replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 500); A[k] = Array.isArray(v) ? v.slice(0, 10).map(one).filter(Boolean) : typeof v === "number" ? Math.max(-1e6, Math.min(1e6, v)) : one(v); } b.answers = A; }
      // review round 3 (paid spots): a first reply can't arrive already claiming to have paid
      if (req.method === "POST") delete b.paidClaim;
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
  // example hosts (demo accounts) show what a page can look like; their events can't take real RSVPs, orders or messages
  const isExampleWs = (ws) => /@demo\.encore$/i.test(getWorkspace(ws)?.ownerEmail || "");
  const exampleWrite = (req, res) => { if (!req.guest || process.env.ENCORE_ALLOW_DEMO_WRITES === "1") return false; S(req); if (!isExampleWs(req.ws)) return false; res.status(403).json({ code: "example", message: "This is an example event, so it can't take replies. Start your own page to try it." }); return true; };
  const ownedWrite = (req, res) => {
    if (!req.guest) return true;
    if (exampleWrite(req, res)) return false;
    if (String(req.query.path || "").startsWith("nominations/")) return nominationOk(req, res);
    const col = String(req.query.path || "").split("/")[0];
    if (!guestShape(req, res, col)) return false;
    const p = String(req.query.path || ""), cur = S(req).get(p), k = guestKey(req);
    if (!k) { res.status(403).json({ code: "not_granted", message: "Missing guest key." }); return false; }
    if (cur && !keyOk(cur.data, k)) { res.status(403).json({ code: "not_granted", message: "You can only change your own response." }); return false; }
    const b = { ...(req.body || {}) }; delete b._k; delete b._keys;
    if (col === "rsvps") {
      // review round 3 (paid spots): "I paid" only on the guest's own reply that is already there; the server stamps when
      if (!cur) delete b.paidClaim; else if (b.paidClaim === true && !cur.data.paidClaim) b.paidClaimAt = Date.now(); else if (cur.data.paidClaimAt) b.paidClaimAt = cur.data.paidClaimAt;
      if (cur && b.email != null && String(b.email).trim().toLowerCase() !== String(cur.data.email || "").trim().toLowerCase()) b.emailChangedAt = Date.now(); // review round 11: see the reply link claim
      if (cur) { b.eventId = cur.data.eventId; if (req.method === "PUT") for (const [kk, v] of Object.entries(cur.data)) if (!GUEST_RSVP_KEYS.has(kk) && !(kk in b)) b[kk] = v; }
      else { const eid = String(b.eventId || ""); if (!/^[A-Za-z0-9_-]{1,80}$/.test(eid) || !S(req).get("events/" + eid)) { res.status(404).json({ code: "not_found", message: "That event isn't here any more." }); return false; }
        if (rsvpLimited(req, eid)) { res.status(429).json({ code: "rate_limited", message: "Lots of replies from here at once. Try again in a few minutes." }); return false; } }
    }
    req.body = { ...b, _k: cur?.data?._k || k, ...(Array.isArray(cur?.data?._keys) ? { _keys: cur.data._keys } : {}) };
    return true;
  };
  // the device that sent a reply, or one the guest added from the "change my reply" email link
  const keyOk = (d, k) => !!k && (d?._k === k || (Array.isArray(d?._keys) && d._keys.includes(k)));
  const rsvpHits = new Map();
  /** Guest replies from one address: a few dozen an hour per event (a team on one office network), more across events. */
  function rsvpLimited(req, eventId) {
    const now = Date.now(), per = +(process.env.ENCORE_RSVP_PER_HOUR || 40), ip = req.ip || "?"; if (rsvpHits.size > 50_000) rsvpHits.clear();
    const hit = (k, n) => { let h = rsvpHits.get(k); if (!h || now - h.start > 3600_000) { h = { n: 0, start: now }; rsvpHits.set(k, h); } return ++h.n > n; };
    const a = hit(ip + "|" + eventId, per), b = hit(ip, +(process.env.ENCORE_RSVP_IP_PER_HOUR || 150)); return a || b;
  }
  // A guest changing their own reply goes through the same rules as a first reply: a full event puts a new "I'm in"
  // on the waitlist, and an event where the host lets people in keeps it as "asked" until the host does.
  function guardGuestReply(req, path, body) {
    if (!req.guest || !/^rsvps\/[A-Za-z0-9_-]+$/.test(path) || !body) return body;
    if (body.response !== "going" && body.party == null && body.plusOne == null && body.orderLines == null) return body;
    const cur = S(req).get(path)?.data || {}, pol = rsvpPolicy(req, { ...cur, ...body, eventId: cur.eventId || body.eventId }, path.split("/")[1]);
    if (pol.error) throw httpError(pol.status || 409, pol.code || "sold_out", pol.error);
    const o = pol.body; if (!o.eventId) return body;
    return { ...body, ...(body.response != null || o.response !== cur.response ? { response: o.response } : {}), ...(o.party != null ? { party: o.party } : {}), ...(o.waitAt ? { waitAt: o.waitAt } : {}), ...(o.partyCut ? { partyCut: true } : {}) };
  }
  // one path for every change to a document: the waitlist moves up when a spot opens, people hear what they need to,
  // and an event remembers its last few versions (for merging saves from two devices)
  async function writeDoc(req, res, how) {
    if (!ownedWrite(req, res) || !versionOk(req, res)) return;
    const p = String(req.query.path || ""), St = S(req), before = St.get(p)?.data || null, isEv = /^events\/[^/]+$/.test(p), isR = /^rsvps\/[A-Za-z0-9_-]+$/.test(p);
    req.body = guardGuestReply(req, p, req.body);
    if (isEv) { req.body = withTz(withCleanLook(req.body), req, !before); if (how === "put" && before?.tz && req.body && typeof req.body === "object" && !("tz" in req.body)) req.body = { ...req.body, tz: before.tz }; } // per-event looks: allow-listed values only; a real time zone, kept
    // the host letting someone in is remembered, so a later change of mind doesn't need asking again
    if (isR && !req.guest && req.body?.response === "going" && before && before.response !== "going") req.body = { ...req.body, letInAt: before.letInAt || Date.now() };
    if (isEv && !req.guest && before) rememberVersion(St, p, before);
    const r = how === "put" ? St.set(p, req.body) : St.update(p, req.body), after = how === "put" ? req.body : r.data;
    afterEventWrite(St, p);
    if (isEv && !req.guest && !before && !after?.sample && !after?.example && req.ws && req.ws !== DEFAULT_WS) trackOnce("first_event_created", req.ws, { ws: req.ws, eventId: p.split("/")[1] });
    const extra = {};
    if (isEv && !req.guest) { rememberVersion(St, p, after); if (req.merged) Object.assign(extra, req.merged, { data: after });
      if (before && (before.headcount !== after.headcount || before.autoWait !== after.autoWait || before.plusOnes !== after.plusOnes || !same(before.guests || [], after.guests || []))) { try { const pr = await promoteWaitlist(req, req.ws, p.split("/")[1]); if (pr.length) extra.promoted = pr; } catch {} } }
    if (isR) { try { Object.assign(extra, await afterRsvp(req, req.ws, p.split("/")[1], before, after)); } catch (e) { console.warn("afterRsvp", e?.message); } }
    res.json({ ...r, ...extra });
  }
  app.put("/api/db/doc", json, (req, res) => writeDoc(req, res, "put"));
  app.patch("/api/db/doc", json, (req, res) => writeDoc(req, res, "patch"));
  app.delete("/api/db/doc", async (req, res) => { const p = String(req.query.path || ""), u = currentUser(req);
    if (/^events\//.test(p) && authEnabled() && u && !((u.owner || (u.roles || []).some((r) => /event lead|admin|owner/i.test(r))))) return res.status(403).json({ code: "not_granted", message: "Only the workspace owner or an event lead can delete an event." });
    const before = /^rsvps\/[A-Za-z0-9_-]+$/.test(p) ? S(req).get(p)?.data : null;
    const r = S(req).delete(p); afterEventWrite(S(req), p); if (/^events\/[^/]+$/.test(p)) S(req).delete(histPath(p));
    if (before?.eventId) { try { await afterRsvp(req, req.ws, p.split("/")[1], before, null); } catch {} }
    res.json(r); });
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
  /** Spots are enforced here, not in the guest's browser: a yes past the spots left becomes a waitlist place, and
   * while anyone is waiting a new yes joins the line behind them. Spots count people: a party of three holds three.
   * One reply per guest: the same email (or the same personal link) updates the earlier reply. selfId: the reply being changed. */
  function rsvpPolicy(req, body, selfId = null) {
    const eventId = String(body?.eventId || ""); if (!/^[A-Za-z0-9_-]+$/.test(eventId)) return { body };
    const ev = S(req).get("events/" + eventId)?.data; if (!ev) return { body };
    const all = S(req).list("rsvps").filter((d) => d.data?.eventId === eventId), em = String(body.email || "").trim().toLowerCase(), inv = String(req.get("x-encore-invite") || "").split("~")[0];
    const prior = selfId ? all.find((d) => d.id === selfId) : all.find((d) => (em && String(d.data.email || "").trim().toLowerCase() === em) || (inv && d.data._inv === inv));
    const G = ev.guests || [], pr = prior?.data || {};
    const meAlready = G.some((g) => (g.status === "Going" || g.status === "Attended") && ((em && String(g.email || "").toLowerCase() === em)));
    const out = { ...body, ...(inv ? { _inv: inv } : {}) };
    // "Come with me?" (server/comewith.js): a friend's reply through the link fills the spot held for them, or joins the pair
    const cw = req.guest && !pr.withOf ? friendTerms(req, S(req), ev, eventId, prior?.id || null) : null;
    // review round 11: a pairs or group-only booking comes in whole groups (1 becomes 2 for pairs), and says so when it changed
    if (!cw?.pairOf && (out.party != null || out.plusOne != null || (partyUnit(ev) > 1 && out.response === "going"))) { const asked = Math.floor(+out.party) || 0; out.party = seatsOf({ ...out, response: out.response || "going" }, ev); if (partyUnit(ev) > 1 && asked && asked !== out.party) out.partyCut = true; }
    if (cw) { out.withOf = cw.withOf; out._withH = cw.withH; if (cw.pairOf) { out.pairOf = cw.pairOf; delete out.party; } }
    // ask-to-join: a guest's yes is a request until the host lets them in (once let in, they can change their mind back)
    if (req.guest && ev.approvalRequired && out.response === "going" && pr.response !== "going" && !pr.letInAt) out.response = "requested";
    // a pre-order's cap counts what's ordered (max 20 loaves), and a full one says how many are left instead of a waitlist.
    // review round 11: with a menu, I'm in needs an order, and a pre-order never goes on the waitlist.
    if (ev.preorder && req.guest && out.response === "going") {
      const lines = Array.isArray(out.orderLines) && out.orderLines.length;
      if (!lines && itemsOf(ev).some((x) => x.name)) return { body: out, prior, error: "Pick something first.", status: 400, code: "invalid_order" };
      if (+ev.headcount > 0) { const cap = +ev.headcount, taken = seatsTaken(ev, all, { skip: prior?.id, skipKey: em }), mine = heldOf(out, ev);
        if (taken + mine > cap) { const left = Math.max(0, cap - taken); return { body: out, prior, error: left ? `Only ${left} left. Pick fewer.` : "Sold out.", left }; } }
      return { body: out, prior };
    }
    if (out.response === "going" && +ev.headcount > 0 && ev.autoWait !== false && !meAlready && !out.pairOf) {
      const cap = +ev.headcount, taken = seatsTaken(ev, all, { skip: prior?.id, skipKey: em }) - (cw?.credit || 0), mine = seatsOf(out, ev);
      if (pr.response === "going") { const u = partyUnit(ev), room = Math.max(seatsOf(pr, ev), cap - taken); if (mine > room) { out.party = Math.max(u, Math.floor(room / u) * u); out.partyCut = true; } } // already in: keeps their spots (whole groups)
      else if (taken + mine > cap || (!cw?.credit && waitlistOf(all.filter((d) => d.id !== prior?.id)).length)) out.response = "waitlist";
    }
    if (out.response === "waitlist") out.waitAt = pr.response === "waitlist" && pr.waitAt ? pr.waitAt : Date.now();
    return { body: out, prior };
  }
  const titleOf = (ev) => String(ev?.pubTitle || ev?.name || ev?.copy?.title || "").trim() || "your event";
  const firstOf = (n) => String(n || "").trim().split(/\s+/)[0] || "";
  const whenOf = (ev) => (/^\d{4}-\d{2}-\d{2}$/.test(ev?.date || "") ? new Date(ev.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "") + (/^\d{2}:\d{2}$/.test(ev?.startTime || "") ? " · " + new Date("2000-01-01T" + ev.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(":00", "").replace(" ", "").toLowerCase() : "");
  const hostFirstOf = (ws, ev) => firstOf(ev?.hostName) || firstOf(getDbUser(getWorkspace(ws)?.ownerEmail || "")?.name) || firstOf(C.profileOf(ws)?.name) || "Your host";
  const emailOn = (ws) => !!(emailConfig(ws, ws === DEFAULT_WS) || emailConfig(DEFAULT_WS, true));
  /** Email on behalf of a workspace when no one is signed in (a guest's reply moved something): logged in its outbox. */
  async function mailWs(ws, { to, subject, text, eventId = "", kind = "email", fromName = "", list, origin }) {
    const cfg = emailConfig(ws, ws === DEFAULT_WS) || emailConfig(DEFAULT_WS, true); if (!cfg) return { ok: false, code: "email_off" };
    const St = scopeStore(store, ws), hour = Date.now() - 36e5;
    if (St.list("outbox").filter((d) => d.data?.at > hour).length >= +(process.env.ENCORE_EMAIL_PER_HOUR || 300)) return { ok: false, code: "rate_limited" };
    const r = await sendEmail(cfg, { to, subject, text, fromName, list, origin });
    if (r.code === "unsubscribed") return r; // nothing was sent, so nothing to log
    St.add("outbox", { kind, eventId, to: [].concat(to), subject: String(subject || "").slice(0, 200), by: null, at: Date.now(), status: r.ok ? "sent" : "failed", error: r.error || null, providerId: r.id || null });
    return r;
  }
  // a link that opens a guest's own reply on any phone or browser: the reply id plus a signature only the server can make
  const replyToken = (ws, rid) => hmac32("reply:" + tag(ws) + rid);
  const replyLink = (req, ws, eventId, rid) => `${originOf(req)}/e/${encodeURIComponent(eventId)}#reply=${encodeURIComponent(rid)}.${replyToken(ws, rid)}`;
  /** Email a guest the link to their own reply (only to the address on the reply, at most every 10 minutes). */
  async function sendReplyLink(req, ws, rid) {
    const St = scopeStore(store, ws), r = St.get("rsvps/" + rid)?.data, to = String(r?.email || "").trim(); if (!r || !EMAIL_OK(to) || !emailOn(ws)) return false;
    if (r.linkSentAt && Date.now() - r.linkSentAt < 10 * 60e3) return true;
    const ev = St.get("events/" + r.eventId)?.data || {}, title = titleOf(ev), when = whenOf(ev);
    const m = await mailWs(ws, { to, subject: `Your reply: ${title}`, text: `Hi ${firstOf(r.name) || "there"},\n\nHere's the link to your reply for ${title}${when ? ` (${when})` : ""}. Open it on the phone or browser you're using now to see or change it:\n${replyLink(req, ws, r.eventId, rid)}\n\nDidn't ask for this? You can ignore it. Your reply stays as it is.\n`, eventId: r.eventId, kind: "reply-link", fromName: hostFirstOf(ws, ev) });
    if (m.ok) { try { St.update("rsvps/" + rid, { linkSentAt: Date.now() }); } catch {} }
    return !!m.ok;
  }
  /** Spots freed by any path (a guest's Can't go, the host saying Not this time, a bigger cap) go to the waitlist in order:
   * the first group that fits gets in, and is told by email (when email is on) and in their bell. */
  async function promoteWaitlist(req, ws, eventId) {
    const St = scopeStore(store, ws), ev = St.get("events/" + eventId)?.data; if (!ev || ev.preorder || ev.autoWait === false || !(+ev.headcount > 0)) return []; // review round 11: a pre-order never waits in line, so none move up
    const done = [];
    for (let i = 0; i < 100; i++) {
      const all = St.list("rsvps").filter((d) => d.data?.eventId === eventId), free = +ev.headcount - seatsTaken(ev, all); if (free <= 0) break;
      // ask-to-join events: only people the host already let in move up on their own; the host decides the rest
      const next = waitlistOf(all).find((d) => heldOf(d.data, ev) <= free && (!ev.approvalRequired || d.data.letInAt)); if (!next) break;
      St.set("rsvps/" + next.id, { ...next.data, response: "going", promotedAt: Date.now(), changedAt: Date.now() }); done.push(next);
    }
    const title = titleOf(ev), when = whenOf(ev), owner = getWorkspace(ws)?.ownerEmail || "";
    for (const d of done) { const r = d.data, to = String(r.email || "").trim(), name = firstOf(r.name) || "there";
      if (EMAIL_OK(to)) { X.notify(to.toLowerCase(), { kind: "waitlist", key: "in-" + d.id, text: `🎉 A spot opened up. You're in for ${title}.`, link: `/g#rsvp-${eventId}`, eventId });
        if (X.canEmail(to)) { try { await mailWs(ws, { list: "guest", origin: originOf(req), to, subject: `A spot opened up: ${title}`, text: `Hi ${name},\n\nGood news: a spot opened up and it's yours. You're in for ${title}${when ? ` (${when})` : ""}.\n\nYour invite, with the details: ${replyLink(req, ws, eventId, d.id)}\n\nPlans changed? Open it and tap Can't go, so someone else can have the spot.\n`, eventId, kind: "waitlist", fromName: hostFirstOf(ws, ev) }); } catch {} } }
      if (owner) X.notify(owner, { kind: "reply", key: "promo-" + d.id, text: `${firstOf(r.name) || "Someone"} moved up from the waitlist for ${title}.`, link: `/?app=1&open=${encodeURIComponent(eventId)}#studio`, eventId }); }
    return done.map((d) => d.id);
  }
  /** Google Calendar link for an event (the host's end time, else three hours after the start; like the invite's button). */
  function calendarLink(ev, where, details) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ev?.date || "")) return "";
    const d = ev.date.replace(/-/g, ""), hm = (x) => (/^\d{2}:\d{2}$/.test(x || "") ? x.replace(":", "") + "00" : ""), t = hm(ev.startTime);
    let dates = `${d}/${d}`;
    if (t) { let end = hm(ev.endTime); if (!end || end === t) end = String((+t.slice(0, 2) + 3) % 24).padStart(2, "0") + t.slice(2);
      const next = () => { const x = new Date(ev.date + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10).replace(/-/g, ""); };
      dates = `${d}T${t}/${end < t ? next() : d}T${end}`; }
    const tz = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+$/.test(ev.tz || "") ? `&ctz=${encodeURIComponent(ev.tz)}` : "";
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(titleOf(ev))}&dates=${dates}${tz}&location=${encodeURIComponent(where || "")}&details=${encodeURIComponent(details || "")}`;
  }
  // ---- paid events: the "You're in" and let-in emails say how to pay (review round 6) ----
  // With a price and a pay link: "Pay $45 here: <link with the amount and a note>" (payLink in server/shop.js, the same
  // as the invite's Pay button) and "Already paid? Open your invite and tap I paid: <link>". At the door: "Pay $45 at the
  // door." With neither: "<Host> will send you a way to pay." Free and pay-what-you-like events get nothing.
  function payLines(ev, r, host, link) {
    const p = String(ev?.price || "").trim(); if (!p || p === "chip" || /^(free|\$?0)$/i.test(p)) return [];
    // review round 11: what this reply owes: the price a person × its spots, or the group price × its groups (dueCents, server/social.js)
    const cents = dueCents(ev, r); if (!(cents > 0)) return [];
    const amt = "$" + (cents / 100).toFixed(cents % 100 ? 2 : 0), url = /^https:\/\/[^\s"'<>]+$/.test(String(ev.ticketUrl || "").trim()) ? String(ev.ticketUrl).trim() : "";
    if (url) return ["", `Pay ${amt} here: ${payLink(url, cents, [String(r?.name || "").trim(), titleOf(ev)].filter(Boolean).join(" · "))}`, `Already paid? Open your invite and tap I paid: ${link}`];
    if (ev.ticketNote) return ["", `Pay ${amt} at the door.`];
    return ["", `${host === "Your host" ? "Your host" : host} will send you a way to pay.`];
  }
  // ---- end paid events ----
  /** A guest's own reply, confirmed by email: "You're in" for I'm in on an open event, "Asked" for Ask to join on an event
   * where the host lets each guest in. Once per reply, only to the email on it, only when email is set up and the address
   * hasn't opted out. The place is only what the guest's own invite already shows (never an address it hides). */
  async function confirmReply(req, ws, id, ev, was, r) {
    const kind = r.response === "going" && !ev.approvalRequired ? "in" : r.response === "requested" && ev.approvalRequired ? "asked" : "";
    if (!kind || was === r.response || r.confirmMailAt) return false;
    const to = String(r.email || "").trim(); if (!EMAIL_OK(to) || !emailOn(ws) || !X.canEmail(to) || isUnsubscribed(to)) return false;
    const St = scopeStore(store, ws); try { St.update("rsvps/" + id, { confirmMailAt: Date.now() }); } catch { return false; } // marked first: never twice
    const pe = publicEvent(ev), title = titleOf(ev), host = hostFirstOf(ws, ev), when = whenOf(ev), origin = originOf(req), link = replyLink(req, ws, r.eventId, id);
    const where = [pe.meetPoint || pe.venueName, pe.venueAddr, pe.hood || pe.city].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(", ");
    const handle = C.profileOf(ws)?.handle, cal = calendarLink(ev, where, `${origin}/e/${encodeURIComponent(r.eventId)}`);
    // ---- review round 8: a pre-order's email is the order: items, total, pickup time, how to pay ----
    if (kind === "in" && ev.preorder && r.order) {
      const L = Array.isArray(r.orderLines) ? r.orderLines : [], cents = Math.round((+r.orderTotal || 0) * 100), url = /^https:\/\/[^\s"'<>]+$/.test(String(ev.ticketUrl || "").trim()) ? String(ev.ticketUrl).trim() : "";
      const O = [`Hi ${firstOf(r.name) || "there"},`, "", `${host === "Your host" ? "Your host" : host} has your order for ${title}.`, ""];
      if (L.length) O.push(...L.map((x) => `${x.qty} × ${x.name}${+x.price > 0 ? ` (${orderMoney(x.price * x.qty)})` : ""}`)); else O.push(String(r.order).split(" · ")[0]);
      if (cents) O.push(`Total: ${orderMoney(cents / 100)}`);
      O.push("");
      if (r.slot) O.push(`Pickup: ${slotLabel(r.slot)}${when ? `, ${when.split(" · ")[0]}` : ""}`); else if (when) O.push(`Pickup: ${when}`);
      if (where) O.push(`Where: ${where}${pe.addrHidden ? " (the exact address is on your invite)" : ""}`);
      if (cents && url) O.push("", `Pay ${orderMoney(cents / 100)} here: ${payLink(url, cents, [String(r.name || "").trim(), title].filter(Boolean).join(" · "))}`);
      else if (cents && ev.ticketNote) O.push("", `Pay ${orderMoney(cents / 100)} at pickup.`);
      O.push("", `Your order, to see or change it: ${link}`, "", "Plans changed? Open it and tap Can't go, so the batch isn't wasted.");
      const m = await mailWs(ws, { list: "guest", origin, to, subject: `Your order: ${title}`, text: O.join("\n") + "\n", eventId: r.eventId, kind: "confirm", fromName: host === "Your host" ? "" : host });
      return !!m.ok; }
    // ---- end review round 8 order email ----
    const lines = [`Hi ${firstOf(r.name) || "there"},`, "", kind === "in" ? `You're in for ${title}.` : `You asked to join ${title}. ${host === "Your host" ? "Your host lets" : host + " lets"} each guest in, and you'll get an email when you're in.`, ""];
    if (when) lines.push(`When: ${when}`);
    if (where) lines.push(`Where: ${where}${pe.addrHidden ? (kind === "in" ? " (the exact address is on your invite)" : " (the exact address comes once you're in)") : ""}`);
    lines.push("", `Your invite, to see or change your reply: ${link}`);
    if (cal) lines.push(`Add to calendar: ${cal}`);
    if (kind === "in") lines.push(...payLines(ev, r, host, link)); // paid events: how to pay
    if (handle && !ev.hideHostFollow) lines.push(`Follow ${host === "Your host" ? "your host" : host}: ${origin}/@${encodeURIComponent(handle)}`);
    if (kind === "in") lines.push("", "Plans changed? Open your invite and tap Can't go, so someone else can have the spot.");
    const m = await mailWs(ws, { list: "guest", origin, to, subject: `${kind === "in" ? "You're in" : "Asked"}: ${title}`, text: lines.join("\n") + "\n", eventId: r.eventId, kind: "confirm", fromName: host === "Your host" ? "" : host });
    return !!m.ok;
  }
  /** After a reply changes: move the waitlist up, tell the host about guests' replies, tell a guest the host let them in.
   * Returns what the reply's sender should know: where it landed and, on the waitlist, their place in line. */
  async function afterRsvp(req, ws, id, before, after) {
    const St = scopeStore(store, ws), eventId = String(after?.eventId || before?.eventId || ""), ev = /^[A-Za-z0-9_-]+$/.test(eventId) ? St.get("events/" + eventId)?.data : null; if (!ev) return {};
    const was = before?.response || "", now = after?.response || "", title = titleOf(ev), owner = getWorkspace(ws)?.ownerEmail || "", who = firstOf(after?.name || before?.name) || "Someone", studio = `/?app=1&open=${encodeURIComponent(eventId)}#studio`;
    if (now === "going" && was !== "going" && after?.withOf) { try { claimHold(St, id, after); } catch {} } // the friend's own reply holds the spot now
    const promoted = await promoteWaitlist(req, ws, eventId);
    // the second-host loop: a guest who sent another host kudos in the last 30 days says I'm in here (server/social.js)
    if (now === "going" && was !== "going" && after?.email) { try { X.loopTouch(after.email, ws, "rsvp"); } catch {} }
    // the host's bell: every guest reply, and an email when someone asks to join
    if (req.guest && after && now && now !== was && owner) {
      const line = { going: `🎉 ${who} is in for ${title}.`, maybe: `${who} said Maybe to ${title}.`, no: was === "going" ? `${who} can't go to ${title} now. Their spot opened up.${after.paid ? " They had paid." : after.paidClaim ? " They said they paid." : ""}` : `${who} can't go to ${title}.`, waitlist: `${who} joined the waitlist for ${title}.`, requested: `🙋 ${who} asked to join ${title}.` }[now === "declined" ? "no" : now];
      // review round 7: a pre-order reply says what they ordered
      if (line) X.notify(owner, { kind: now === "requested" ? "ask" : "reply", key: `rsvp-${id}-${now}`, text: now === "going" && after.order ? `🛍 ${who} ordered ${String(after.order).slice(0, 160)} (${title}).` : line, link: studio, eventId });
      if (now === "requested" && X.canEmail(owner)) { try { await mailWs(ws, { to: owner, subject: `${who} asked to join ${title}`, text: `${String(after.name || who).slice(0, 80)} asked to join ${title}${whenOf(ev) ? ` (${whenOf(ev)})` : ""}.\n\nLet in or Not this time: ${originOf(req)}${studio}\n`, eventId, kind: "ask" }); } catch {} }
    }
    // the host let someone in: tell the guest by email, text and their bell
    let letIn = null;
    if (!req.guest && after && now === "going" && was && was !== "going" && ["requested", "waitlist", "maybe", "declined", "no"].includes(was)) {
      const to = String(after.email || "").trim(), host = hostFirstOf(ws, ev), when = whenOf(ev), link = replyLink(req, ws, eventId, id); letIn = { emailed: false, texted: false };
      if (EMAIL_OK(to)) { X.notify(to.toLowerCase(), { kind: "letin", key: "letin-" + id, text: `🎉 ${host} let you in to ${title}.`, link: `/g#rsvp-${eventId}`, eventId });
        if (X.canEmail(to)) { try { letIn.emailed = !!(await mailWs(ws, { list: "guest", origin: originOf(req), to, subject: `You're in: ${title}`, text: `Hi ${firstOf(after.name) || "there"},\n\n${host} let you in. You're in for ${title}${when ? ` (${when})` : ""}.\n\nYour invite, with the address and details: ${link}\n${payLines(ev, after, host, link).map((x) => x + "\n").join("")}\nPlans changed? Open it and tap Can't go, so someone else can have the spot.\n`, eventId, kind: "letin", fromName: host })).ok; } catch {} } }
      const sms = smsConfig(); if (!letIn.emailed && sms && after.phone && after.smsOk !== false) { try { letIn.texted = !!(await sendSms(sms, { to: after.phone, text: `${host} let you in to ${title}${when ? `, ${when}` : ""}. Details: ${link} Reply STOP to opt out.` })).ok; } catch {} }
    }
    const fin = St.get("rsvps/" + id)?.data, all = St.list("rsvps").filter((d) => d.data?.eventId === eventId);
    // funnel: a host's first reply from a guest, and an event's third (people the host added by hand don't count)
    if (req.guest && after && !before && ws !== DEFAULT_WS) { trackOnce("first_reply", ws, { ws, eventId }); if (all.filter((d) => d.data?._k).length >= 3) trackOnce("three_replies", eventId, { ws, eventId }); }
    // the guest's own confirmation email, once per reply (never for a reply the host added by hand)
    let confirmed = false; if (req.guest && fin) { try { confirmed = await confirmReply(req, ws, id, ev, was, fin); } catch (e) { console.warn("[confirm]", e?.message); } }
    return { ...(confirmed ? { confirmEmailed: true } : {}), ...(fin ? { response: fin.response } : {}), ...(fin?.response === "waitlist" ? { waitlistPos: waitlistPos(all, id), waiting: waitlistOf(all).length } : {}), ...(fin?.partyCut ? { party: fin.party, partyCut: true } : {}), ...(promoted.length ? { promoted: true, promotedIds: promoted } : {}), ...(letIn ? { letIn } : {}) };
  }
  app.post("/api/db/collection", json, async (req, res) => {
    const p = String(req.query.path || "");
    if (exampleWrite(req, res)) return;
    if (req.guest && OWNED.has(p) && !guestKey(req)) return res.status(403).json({ code: "not_granted", message: "Missing guest key." });
    if (!guestShape(req, res, p)) return;
    let body = req.guest && OWNED.has(p) ? { ...(req.body || {}), _k: guestKey(req) } : req.body;
    if (p === "events") body = withTz(withCleanLook(body), req, true); // per-event looks: allow-listed values only; a real time zone
    if (p === "rsvps") { if (req.guest && body && typeof body.response === "string") body = { ...body, response: body.response.toLowerCase() };
      // guests reply only to real events, once the event is over replies are closed, and one address can't flood an event
      if (req.guest) { const eidG = String(body?.eventId || ""), evG = /^[A-Za-z0-9_-]+$/.test(eidG) ? S(req).get("events/" + eidG)?.data : null;
        if (!evG) return res.status(404).json({ code: "not_found", message: "That event isn't here any more." });
        if (evG.date && evG.date < new Date(Date.now() - 14 * 3600e3).toISOString().slice(0, 10)) return res.status(409).json({ code: "past", message: "This one has already happened, so replies are closed." });
        if (rsvpLimited(req, eidG)) return res.status(429).json({ code: "rate_limited", message: "Lots of replies from here at once. Try again in a few minutes." }); }
      const pol = rsvpPolicy(req, body); if (pol.error) return res.status(pol.status || 409).json({ code: pol.code || "sold_out", message: pol.error, ...(pol.left != null ? { left: pol.left } : {}) }); body = pol.body;
      // the same email from another device can't overwrite someone's reply: only a device that sent it or opened the emailed
      // link (its guest key), a verified personal invite, or the host can change it. Anyone else gets the link sent to that email.
      if (pol.prior && req.guest) { const sameDevice = keyOk(pol.prior.data, guestKey(req)), viaInvite = !!pol.prior.data._inv && String(req.get("x-encore-invite") || "").split("~")[0] === pol.prior.data._inv && /^[A-Za-z0-9_-]+$/.test(String(body.eventId || "")) && !!invitedGuest(req, String(body.eventId), S(req).get("events/" + String(body.eventId))?.data || {});
        if (!sameDevice && !viaInvite) { const emailed = await sendReplyLink(req, req.ws, pol.prior.id).catch(() => false), host = hostFirstOf(req.ws, S(req).get("events/" + String(body.eventId))?.data);
          return res.status(409).json({ code: "rsvp_exists", emailed, message: emailed ? "You already replied with this email. We sent you a link: open it here to change your reply." : `You already replied with this email. To change it, open the invite on the phone or browser you used, or ask ${host === "Your host" ? "your host" : host}.` }); } }
      // never blank out what a guest already told the host
      if (pol.prior) for (const k of ["name", "email", "phone", "dietary", "access"]) if (!String(body[k] ?? "").trim() && pol.prior.data[k]) delete body[k];
      if (pol.prior && body.answers && typeof body.answers === "object" && !Array.isArray(body.answers) && !Object.keys(body.answers).length && pol.prior.data.answers) delete body.answers;
      if (pol.prior) { const before = pol.prior.data, next = { ...before, ...body, _k: before._k || body._k, ...(Array.isArray(before._keys) ? { _keys: before._keys } : {}), changedAt: Date.now() };
        S(req).set("rsvps/" + pol.prior.id, next); const a = await afterRsvp(req, req.ws, pol.prior.id, before, next).catch(() => ({}));
        return res.json({ id: pol.prior.id, path: "rsvps/" + pol.prior.id, merged: true, ...a, response: a.response || next.response }); }
      const r0 = S(req).add(p, body), a = await afterRsvp(req, req.ws, r0.id, null, body).catch(() => ({})); return res.json({ ...r0, ...a, response: a.response || body.response }); }
    const r = S(req).add(p, body);
    if (p === "events" && !req.guest) { claimEvent(r.id, req.ws); if (!body?.sample && !body?.example && req.ws && req.ws !== DEFAULT_WS) trackOnce("first_event_created", req.ws, { ws: req.ws, eventId: r.id }); }
    // a guest's reply says where it landed (a full event puts "going" on the waitlist)
    res.json(p === "rsvps" && body?.response ? { ...r, response: body.response } : r);
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
  // draw-your-own covers: one short prompt in, a cleaned SVG out (see server/art.js); 20 drawings a day per workspace
  const artHits = new Map();
  app.post("/api/art/draw", json, async (req, res) => {
    const ws = sessionWorkspace(req), day = new Date().toISOString().slice(0, 10), k = ws + "|" + day, used = artHits.get(k) || 0;
    const prompt = String(req.body?.prompt || "").trim(); if (prompt.length < 3) return res.status(400).json({ code: "invalid", message: "Describe what to draw, e.g. a turkey in running shoes." });
    if (used >= 20) return res.status(429).json({ code: "rate_limited", message: "That's 20 drawings today. Pick one of them, or try again tomorrow." });
    artHits.set(k, used + 1); if (artHits.size > 5000) artHits.clear();
    try { const svg = await drawArt(prompt, String(req.body?.accent || "")); if (!svg) return res.status(502).json({ code: "upstream_error", message: "That drawing didn't come out. Try describing it a little differently." }); res.json({ svg, left: 19 - used }); }
    catch (e) { const c = toCapError(e); res.status(c.code === "missing_key" ? 503 : 502).json({ code: c.code || "upstream_error", message: c.message || "Couldn't draw that right now." }); }
  });
  // Potto's event read (index.html, "Potto reads with the model"): one short call per sentence a host drafts from.
  // Signed-in hosts only (the /api gate above lets no guest through); ENCORE_AI_READS_PER_HOUR per workspace (default
  // 120), then a 429 and the page keeps its own regex reading.
  const aiReadHits = new Map();
  const aiReadLimited = (req) => { const k = sessionWorkspace(req), now = Date.now(), h = (aiReadHits.get(k) || []).filter((t) => now - t < 3600e3);
    if (h.length >= +(process.env.ENCORE_AI_READS_PER_HOUR || 120)) { aiReadHits.set(k, h); return true; }
    h.push(now); aiReadHits.set(k, h); if (aiReadHits.size > 5000) aiReadHits.clear(); return false; };
  app.post("/api/ai", json, async (req, res) => {
    const { input, modelTier, tools: rawTools } = req.body || {};
    // every AI call counts toward one hourly cap per workspace (guests by IP); event reads also have their own cap, a size limit and no tools
    { const k = "all:" + (req.guest ? "ip:" + (req.ip || "?") : sessionWorkspace(req)), now = Date.now(), h = (aiReadHits.get(k) || []).filter((t) => now - t < 3600e3);
      if (h.length >= +(process.env.ENCORE_AI_PER_HOUR || 300)) { aiReadHits.set(k, h); return res.status(429).json({ code: "rate_limited", message: "That's a lot of AI for one hour. Try again in a bit." }); } h.push(now); aiReadHits.set(k, h); }
    if (String(req.body?.purpose || "").toLowerCase() === "event_read") {
      if (req.guest) return res.status(401).json({ code: "not_granted", message: "Sign in first." });
      if (aiReadLimited(req)) return res.status(429).json({ code: "rate_limited", message: "Potto has read a lot of plans this hour. Try again in a bit." });
      if (JSON.stringify(input ?? "").length > 8000 || (Array.isArray(rawTools) && rawTools.length)) return res.status(400).json({ code: "too_big", message: "That's too long for Potto to read at once." });
    }
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
    if (!serversFor(req).some((x) => x.server === String(server || ""))) return res.status(404).json({ code: "server_not_connected", message: `"${server}" is not connected on this server.` });
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
  // any other page that doesn't exist: a friendly page with a way back, not a bare "Cannot GET"
  app.use((req, res, next) => { if (req.method !== "GET" && req.method !== "HEAD") return next(); res.status(404); sendStatic(res, "404.html", "<p>Page not found.</p>"); });
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
