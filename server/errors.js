// Problems seen without anyone having to report them.
//
// public/report.js (on every page) catches a script error or an unhandled rejection and posts a compact report:
//   POST /api/errors { id, kind: "error" | "rejection" | "toast", message, stack, page, app, serverRef? }
// The server keeps the last MAX reports, grouped by what went wrong (the same message and top frame count once, with a
// count and the last few ids), in one system doc (system/errlog). A server error (a 500, server/perf.js) lands in the
// same log with its ref, so an error id shown in a "Something went wrong" toast or a help ticket can be matched.
//
// What a report never holds: names, emails, phone numbers, long tokens, query strings or anything a person typed.
// Messages and stacks are scrubbed again here (scrub), the page is its path only, and the device is a few words.
// Rate limits: 10 reports per IP per 10 minutes, 300 an hour for everyone; past that a report is dropped (429).
//
// GET /api/admin/errors: the log, for ENCORE_ADMIN_EMAILS only (404 for everyone else). /admin/launch shows it.
import crypto from "node:crypto";
import { deviceOf } from "./help.js";

const KEY = "system/errlog", MAX = 200, MIN = 60e3;
export const ERR_ID = /^[a-z0-9]{6,16}$/;
export const KINDS = ["error", "rejection", "toast", "server"];

/** A line of text with anything personal taken out: emails, phone numbers, long tokens and ids, query strings, quoted text. */
export function scrub(s, n = 240) {
  return String(s ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[^\s@"'<>()]+@[^\s@"'<>()]+\.[a-z]{2,}/gi, "[email]")
    .replace(/(https?:\/\/[^\s)?#]*)[?#][^\s)]*/gi, "$1")
    .replace(/\?[^\s:)]*(?=[:\s)]|$)/g, "")
    .replace(/(["'`“‘])[^"'`”’]{24,}\1/g, "$1…$1")
    .replace(/\+?\d[\d ().-]{7,}\d/g, "[number]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[id]")
    .replace(/\s+/g, " ").trim().slice(0, n);
}
/** The top frames of a stack, each without its origin or query: "at draw (/feed.js:12:5)". */
export function cleanStack(st, lines = 4) {
  return String(st ?? "").split(/\n/).map((l) => l.trim()).filter((l) => /^at\s|@|\.js:\d+/.test(l)).slice(0, lines)
    .map((l) => scrub(l.replace(/(?:https?|chrome-extension|moz-extension|safari-web-extension):\/\/[^/\s)]+/gi, ""), 200)).filter(Boolean);
}
const cleanPage = (p) => { const s = String(p ?? "").split(/[?#]/)[0].slice(0, 120); return /^\/[A-Za-z0-9_\-./@~%]*$/.test(s) ? s.replace(/\/[A-Za-z0-9_-]{12,}/g, "/:id") : ""; };
const noise = (m, st) => /^Script error\.?$/i.test(m) && !st.length || /ResizeObserver loop|AbortError|The user aborted|Transition was (skipped|aborted)|view transition|Failed to fetch|Load failed|NetworkError|network error|cancelled|Non-Error promise rejection captured/i.test(m) || st.some((l) => /extension:/.test(l));

export function errorLog(store) { try { return store.get(KEY)?.data?.items || []; } catch { return []; } }

/** Add one report (already cleaned) to the log; the same problem is counted, not stored twice. Returns the entry. */
export function addReport(store, r, now = Date.now()) {
  const items = errorLog(store), fp = crypto.createHash("sha1").update([r.kind, r.message, r.stack[0] || ""].join("|")).digest("hex").slice(0, 12);
  let e = items.find((x) => x.fp === fp);
  if (e) { e.n = (e.n || 1) + 1; e.last = now; e.page = r.page || e.page; e.ids = [...new Set([r.id, ...(e.ids || [])])].slice(0, 8); if (r.serverRef) e.serverRef = r.serverRef; e.device = r.device || e.device; e.app = r.app || e.app; }
  else { e = { fp, kind: r.kind, message: r.message, stack: r.stack, page: r.page, n: 1, first: now, last: now, ids: [r.id], device: r.device, app: r.app, signedIn: !!r.signedIn, ...(r.serverRef ? { serverRef: r.serverRef } : {}) }; items.unshift(e); }
  items.sort((a, b) => b.last - a.last); store.set(KEY, { kind: "errlog", items: items.slice(0, MAX) }); return e;
}
/** The entry an error id belongs to (a ticket carries ids; the team sees what they were). */
export const findError = (store, id) => errorLog(store).find((e) => (e.ids || []).includes(id) || e.serverRef === id) || null;

/** A server error (a 500) for the log: the request's method and path, the error's message and top frames, its ref. */
export function noteServerError(store, { ref, method, path, err }) {
  try { addReport(store, { id: ERR_ID.test(ref || "") ? ref : crypto.randomBytes(4).toString("hex"), kind: "server", message: scrub(`${method || ""} ${cleanPage(path) || path || ""}: ${err?.message || err || "error"}`, 240), stack: cleanStack(err?.stack, 4), page: cleanPage(path), device: "server", app: "" }); } catch {}
}

export function mountErrors(app, { store, express, currentUser, isAdmin }) {
  const body = express.json({ limit: "8kb", type: ["application/json", "text/plain"] });
  const hits = new Map(); let all = [];
  const limited = (ip, now = Date.now()) => { all = all.filter((t) => now - t < 60 * MIN); const h = (hits.get(ip) || []).filter((t) => now - t < 10 * MIN);
    if (h.length >= 10 || all.length >= 300) { hits.set(ip, h); return true; } h.push(now); hits.set(ip, h); all.push(now); if (hits.size > 5000) hits.clear(); return false; };
  const me = (req) => { try { return currentUser(req); } catch { return null; } };
  app.post("/api/errors", body, (req, res) => {
    let b = req.body; if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } } b = b || {};
    const id = String(b.id || ""), kind = KINDS.includes(b.kind) && b.kind !== "server" ? b.kind : "error";
    if (!ERR_ID.test(id)) return res.status(400).json({ code: "invalid", message: "No error id." });
    const message = scrub(b.message, 240), stack = cleanStack(b.stack); if (!message || noise(message, stack)) return res.status(204).end();
    if (limited(req.ip || "?")) return res.status(429).json({ code: "rate_limited", message: "Got enough of those for now." });
    addReport(store, { id, kind, message, stack, page: cleanPage(b.page), device: deviceOf(req.get("user-agent")), app: scrub(b.app, 24), signedIn: !!me(req), serverRef: ERR_ID.test(String(b.serverRef || "")) ? String(b.serverRef) : "" });
    res.status(204).end();
  });
  app.get("/api/admin/errors", (req, res) => { const u = me(req); if (!u || !isAdmin(u.email)) return res.status(404).json({ code: "not_found", message: "Not found." });
    res.set("Cache-Control", "private, no-store").json({ errors: errorLog(store).slice(0, 100) }); });
}
