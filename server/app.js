// Express app for Encore. createApp() is used by server/index.js and the tests.
import express from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { parsePath, httpError, randomId } from "./db.js";
import { runToolLoop, toCapError, aiMode } from "./ai.js";
import { configured, findServer, callTool } from "./integrations/index.js";
import { runPm } from "./pm.js";
import { authEnabled, isAuthed, loginHandler, loginPage, logoutHandler, currentUser, users } from "./auth.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const PAGE_FILE = path.join(ROOT, "index.html");
const PUBLIC_DIR = path.join(ROOT, "public");
const TOOL_TIMEOUT_MS = 120_000;

const HEAD = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style><script src="/shim.js"></script></head><body>';
const TAIL = "</body></html>";

const GUEST_COLLECTIONS = new Set(["rsvps", "feedback", "interest", "nominations", "wall"]);
// Guest-writable docs that a guest may change after creating: only with the same browser key (x-encore-key).
const OWNED = new Set(["rsvps", "wall"]);
// What a guest link may see of an event. Guests never get emails, notes, money, deals or internal tracking.
const GUEST_GUEST_FIELDS = ["name", "title", "company", "status", "owner", "optIn", "why"];
const INTERNAL = ["opps", "holdoutOpps", "meetLog", "holdout", "lift", "log", "oppLog", "approvals", "commits", "hoursB", "hours", "hourRate", "rubric", "answers", "actualSpend", "baseline", "baselineId", "scoutRejects", "crmSyncedAt", "pmReport", "pmSent", "blocked", "signals", "intel", "spark", "strategy", "debrief", "metrics", "btId"];
export function eventMoney(e) {
  const P = e.produce?.budget || [], cost = P.reduce((a, b) => a + (+b.amount || 0), 0) || +e.budget || 0;
  const committed = (e.commits || []).filter((c) => c.status === "Signed" || c.status === "Paid").reduce((a, c) => a + (+c.amount || 0), 0);
  return { cost, committed, currency: e.currency || "USD" };
}
export function publicEvent(data, view) {
  const e = { ...data };
  for (const k of INTERNAL) delete e[k];
  e.guests = (data.guests || []).map((g) => Object.fromEntries(GUEST_GUEST_FIELDS.filter((k) => g[k] != null).map((k) => [k, g[k]])));
  if (e.scout?.contacts) e.scout = { ...e.scout, contacts: e.scout.contacts.map((c) => ({ name: c.name, title: c.title, company: c.company, owner: c.owner, why: c.why, relationship: c.relationship })) };
  if (view !== "plan") { delete e.budget; delete e.pitch; if (e.produce) e.produce = { runOfShow: e.produce.runOfShow || [] }; }
  return e;
}
// Single documents guests may read: any event (RSVP, survey, plan, nomination links) plus the public roadmap and brand.
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
    if (req.method === "PUT" || req.method === "PATCH") return segs.length === 2 && GUEST_COLLECTIONS.has(segs[0]);
  }
  if (route === "/api/db/collection" && req.method === "POST") return segs.length === 1 && GUEST_COLLECTIONS.has(segs[0]);
  // The guest wall only holds what guests chose to show (name, role, photo, topic), so anyone with the link may read it.
  if (route === "/api/db/collection" && req.method === "GET") return p === "wall";
  return false;
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
  const app = express();
  const assetsDir = path.join(dataDir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  const runs = new Map(); // runId -> { pending: Map<toolUseId, resolve> }

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  // ---------- public, ungated ----------
  app.get("/api/health", (req, res) => {
    res.json({ ok: true, ai: aiMode(), integrations: configured().map((s) => s.server), auth: authEnabled() });
  });
  app.get("/login", (req, res) => res.type("html").send(loginPage()));
  app.post("/api/login", express.urlencoded({ extended: false, limit: "10kb" }), express.json({ limit: "10kb" }), loginHandler);
  app.post("/api/logout", logoutHandler);

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
  app.get("/", (req, res, next) => (isAuthed(req) ? sendPage(req, res, next) : res.type("html").send(loginPage())));
  app.get("/_blob/:id", async (req, res, next) => {
    const id = req.params.id;
    if (!/^[A-Za-z0-9]{20}$/.test(id)) return res.status(404).end();
    try {
      const meta = JSON.parse(await fsp.readFile(path.join(assetsDir, id + ".json"), "utf8"));
      res.set({ "Content-Type": meta.contentType || "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
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

  // ---------- who's signed in; append-only audit log ----------
  app.get("/api/me", (req, res) => {
    const u = currentUser(req);
    res.json(u ? { name: u.name, email: u.email, roles: u.roles, verified: true } : { verified: false, teamConfigured: users().length > 0 });
  });
  // The audit log can only be appended to, and the server stamps who and when.
  const AUDIT = /^(audit|approvals|aeactions|system)(\/|$)/;
  app.use("/api/db", (req, res, next) => {
    if (req.method !== "GET" && AUDIT.test(String(req.query.path || ""))) return res.status(403).json({ code: "not_granted", message: "The audit log is append-only. Use /api/audit." });
    next();
  });
  app.post("/api/audit", json, (req, res) => {
    const u = currentUser(req), b = req.body || {};
    const eventId = String(b.eventId || "").slice(0, 80), what = String(b.what || "").trim().slice(0, 500);
    if (!what) return res.status(400).json({ code: "invalid", message: "what is required" });
    res.json(store.add("audit", { eventId, what, who: u?.name || "Unverified user", email: u?.email || null, verified: !!u, at: Date.now() }));
  });
  // Plan approvals are recorded by the server: it checks the signed-in person's roles,
  // keeps the approval in a collection the data API can't write, and logs it.
  app.post("/api/approve", json, (req, res) => {
    const u = currentUser(req), b = req.body || {};
    const eventId = String(b.eventId || "").slice(0, 80), role = String(b.role || "").trim().slice(0, 80);
    if (!eventId || !role) return res.status(400).json({ code: "invalid", message: "eventId and role are required" });
    if (users().length && !u) return res.status(401).json({ code: "not_granted", message: "Sign in as a team member to approve." });
    if (u && !u.roles.some((r) => r.toLowerCase() === role.toLowerCase())) return res.status(403).json({ code: "not_granted", message: `${u.name} doesn't have the "${role}" role.` });
    const ev = /^[A-Za-z0-9_-]+$/.test(eventId) ? store.get("events/" + eventId) : null;
    if (!ev) return res.status(404).json({ code: "not_found", message: "Save the event before approving it." });
    const path = "approvals/" + eventId, cur = store.get(path)?.data || { eventId, roles: {} }, money = eventMoney(ev.data);
    const approval = { by: u?.name || "Unverified user", email: u?.email || null, verified: !!u, at: Date.now(), cost: money.cost, committed: money.committed, currency: money.currency };
    if (b.withdraw) delete cur.roles[role]; else cur.roles[role] = approval;
    store.set(path, cur);
    store.add("audit", { eventId, what: `${String(ev.data.name || eventId).slice(0, 120)}: ${b.withdraw ? "withdrew approval" : `approved the plan at ${money.currency} ${approval.cost.toLocaleString("en-US")} planned, ${money.currency} ${approval.committed.toLocaleString("en-US")} committed`} as ${role}`, who: approval.by, email: approval.email, verified: approval.verified, at: approval.at });
    res.json({ ok: true, approval, roles: cur.roles });
  });
  // When a saved event's cost or commitments move more than 5% from what was approved, the server clears the approvals.
  function afterEventWrite(p) {
    const m = /^events\/([A-Za-z0-9_-]+)$/.exec(p); if (!m) return;
    const ap = store.get("approvals/" + m[1]); if (!ap || !Object.keys(ap.data.roles || {}).length) return;
    const ev = store.get(p); if (!ev) return;
    const now = eventMoney(ev.data), moved = (a, b) => Math.abs(a - b) > Math.max(500, b * 0.05);
    const stale = Object.entries(ap.data.roles).filter(([, a]) => moved(now.cost, a.cost || 0) || moved(now.committed, a.committed || 0));
    if (!stale.length) return;
    for (const [r] of stale) delete ap.data.roles[r];
    store.set("approvals/" + m[1], ap.data);
    store.add("audit", { eventId: m[1], what: `${ev.data.name || m[1]}: approvals reset (${stale.map(([r]) => r).join(", ")}): the plan is now ${now.currency} ${now.cost.toLocaleString("en-US")} with ${now.currency} ${now.committed.toLocaleString("en-US")} committed`, who: "Encore server", email: null, verified: true, at: Date.now() });
  }
  app.get("/api/approvals", (req, res) => {
    const id = String(req.query.eventId || "").replace(/[^A-Za-z0-9_-]/g, "_");
    res.json({ roles: store.get("approvals/" + id)?.data?.roles || {} });
  });
  app.get("/api/audit", (req, res) => {
    const id = String(req.query.eventId || "");
    res.json({ entries: store.list("audit").map((d) => d.data).filter((e) => !id || e.eventId === id).sort((a, b) => b.at - a.at).slice(0, 500) });
  });

  // ---------- AE follow-up pages: signed per-AE links ----------
  const aeSlug = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "ae";
  const secret = () => { let s0 = store.get("system/secret")?.data?.v; if (!s0) { s0 = randomBytes(32).toString("hex"); store.set("system/secret", { v: s0 }); } return process.env.SESSION_SECRET || s0; };
  const aeToken = (eventId, slug) => createHmac("sha256", secret()).update(`ae:${eventId}:${slug}`).digest("hex").slice(0, 32);
  const aeOk = (eventId, slug, token) => { const a = Buffer.from(aeToken(eventId, slug)), b2 = Buffer.from(String(token || "")); return a.length === b2.length && timingSafeEqual(a, b2); };
  app.get("/api/aelink", (req, res) => {
    if (req.guest) return res.status(401).json({ code: "not_granted" });
    const eventId = String(req.query.eventId || ""), slug = aeSlug(req.query.ae);
    res.json({ token: aeToken(eventId, slug), slug });
  });
  app.get("/api/aepage", (req, res) => {
    const eventId = String(req.query.eventId || ""), slug = String(req.query.ae || "");
    if (!aeOk(eventId, slug, req.query.t)) return res.status(403).json({ code: "not_granted", message: "This link isn't valid. Ask marketing for a new one." });
    const ev = /^[A-Za-z0-9_-]+$/.test(eventId) ? store.get("events/" + eventId) : null; if (!ev) return res.status(404).json({ code: "not_found" });
    const mine = (ev.data.guests || []).filter((g) => aeSlug(g.owner) === slug).map((g) => ({ name: g.name, title: g.title, company: g.company, status: g.status, owner: g.owner, note: g.note, nextStep: g.nextStep, gift: g.gift, giftStatus: g.giftStatus, fuDraft: g.fuDraft, fuState: g.fuState, nsDoneAt: g.nsDoneAt, nudge: g.nudge, nudgeOkAt: g.nudgeOkAt }));
    const actions = store.list("aeactions").map((d) => d.data).filter((a) => a.eventId === eventId && a.aeSlug === slug);
    res.json({ event: { id: eventId, name: ev.data.name, brand: ev.data.brand, date: ev.data.date, copy: ev.data.copy ? { title: ev.data.copy.title } : null, audience: ev.data.audience, guests: mine, goingCount: (ev.data.guests || []).filter((g) => g.status === "Going" || g.status === "Attended").length }, actions });
  });
  app.post("/api/aeaction", json, (req, res) => {
    const b = req.body || {}, eventId = String(b.eventId || ""), slug = String(b.ae || "");
    if (!aeOk(eventId, slug, b.t)) return res.status(403).json({ code: "not_granted", message: "This link isn't valid." });
    const ev = /^[A-Za-z0-9_-]+$/.test(eventId) ? store.get("events/" + eventId) : null; if (!ev) return res.status(404).json({ code: "not_found" });
    const g = (ev.data.guests || []).find((x) => x.name === b.guest);
    if (!g || aeSlug(g.owner) !== slug) return res.status(403).json({ code: "not_granted", message: "That guest isn't one of yours." });
    const action = String(b.action || ""); if (!["approve", "sent", "done", "note", "nudge"].includes(action)) return res.status(400).json({ code: "invalid" });
    const rec = { eventId, guest: g.name, ae: g.owner, aeSlug: slug, action, at: Date.now(), ...(b.draft ? { draft: String(b.draft).slice(0, 8000) } : {}), ...(b.note ? { note: String(b.note).slice(0, 4000) } : {}), ...(b.nudge ? { nudge: String(b.nudge).slice(0, 4000) } : {}) };
    store.add("aeactions", rec);
    res.json({ ok: true, action: rec });
  });

  // ---------- db ----------
  app.get("/api/db/doc", (req, res) => {
    const p = String(req.query.path || ""), doc = store.get(p);
    let data = doc?.data;
    if (doc && req.guest && p.startsWith("events/")) data = publicEvent(data, String(req.get("x-encore-view") || ""));
    res.json(doc ? { exists: true, id: doc.id, data, updated: doc.updated } : { exists: false, id: p.split("/").pop() });
  });
  const guestKey = (req) => String(req.get("x-encore-key") || "").slice(0, 64);
  const ownedWrite = (req, res) => {
    if (!req.guest) return true;
    const p = String(req.query.path || ""), cur = store.get(p), k = guestKey(req);
    if (!k) { res.status(403).json({ code: "not_granted", message: "Missing guest key." }); return false; }
    if (cur && cur.data?._k !== k) { res.status(403).json({ code: "not_granted", message: "You can only change your own response." }); return false; }
    req.body = { ...(req.body || {}), _k: k };
    return true;
  };
  app.put("/api/db/doc", json, (req, res) => { if (!ownedWrite(req, res)) return; const r = store.set(String(req.query.path || ""), req.body); afterEventWrite(String(req.query.path || "")); res.json(r); });
  app.patch("/api/db/doc", json, (req, res) => { if (!ownedWrite(req, res)) return; const r = store.update(String(req.query.path || ""), req.body); afterEventWrite(String(req.query.path || "")); res.json(r); });
  app.delete("/api/db/doc", (req, res) => res.json(store.delete(String(req.query.path || ""))));
  app.get("/api/db/collection", (req, res) => {
    let docs = store.list(String(req.query.path || ""));
    if (req.guest) docs = docs.map((d) => { const { _k, ...data } = d.data || {}; return { ...d, data }; });
    res.json({ docs });
  });
  app.post("/api/db/collection", json, (req, res) => {
    const p = String(req.query.path || "");
    const body = req.guest && OWNED.has(p) ? { ...(req.body || {}), _k: guestKey(req) } : req.body;
    res.json(store.add(p, body));
  });
  app.get("/api/db/events", (req, res) => {
    const send = sseStart(res);
    const onChange = (e) => send(e);
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
    const contentType = String(req.get("content-type") || "application/octet-stream").slice(0, 200);
    await fsp.writeFile(path.join(assetsDir, id), body);
    const meta = { id, url: "/_blob/" + id, sizeBytes: body.length, contentType, createdAt: Date.now() };
    await fsp.writeFile(path.join(assetsDir, id + ".json"), JSON.stringify(meta));
    res.json(meta);
  });
  app.get("/api/assets", async (req, res) => {
    const files = (await fsp.readdir(assetsDir)).filter((f) => f.endsWith(".json"));
    const assets = [];
    for (const f of files) { try { assets.push(JSON.parse(await fsp.readFile(path.join(assetsDir, f), "utf8"))); } catch {} }
    assets.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    res.json({ assets });
  });
  app.delete("/api/assets/:id", async (req, res) => {
    const id = req.params.id;
    if (!/^[A-Za-z0-9]{20}$/.test(id)) throw httpError(404, "not_found", "No such asset.");
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
  app.get("/api/mcp/tools", (req, res) => {
    let servers = configured();
    if (req.query.server) servers = [findServer(String(req.query.server))];
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
    res.json(await callTool(String(server || ""), String(tool || ""), input));
  });

  // ---------- pm ----------
  app.post("/api/pm/run", json, async (req, res) => {
    res.json(await runPm(store, req.body?.now ? { now: Number(req.body.now) } : {}));
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
