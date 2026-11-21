// Express app for Encore. createApp() is used by server/index.js and the tests.
import express from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
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

const GUEST_COLLECTIONS = new Set(["rsvps", "feedback", "interest", "nominations", "wall", "aeactions"]);
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
    if (isAuthed(req) || guestAllowed(req)) return next();
    res.status(401).json({ code: "not_granted", message: "Sign in first." });
  });

  const json = express.json({ limit: "2mb" });

  // ---------- who's signed in; append-only audit log ----------
  app.get("/api/me", (req, res) => {
    const u = currentUser(req);
    res.json(u ? { name: u.name, email: u.email, roles: u.roles, verified: true } : { verified: false, teamConfigured: users().length > 0 });
  });
  // The audit log can only be appended to, and the server stamps who and when.
  const AUDIT = /^audit(\/|$)/;
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
  app.get("/api/audit", (req, res) => {
    const id = String(req.query.eventId || "");
    res.json({ entries: store.list("audit").map((d) => d.data).filter((e) => !id || e.eventId === id).sort((a, b) => b.at - a.at).slice(0, 500) });
  });

  // ---------- db ----------
  app.get("/api/db/doc", (req, res) => {
    const doc = store.get(String(req.query.path || ""));
    res.json(doc ? { exists: true, id: doc.id, data: doc.data, updated: doc.updated } : { exists: false, id: String(req.query.path).split("/").pop() });
  });
  app.put("/api/db/doc", json, (req, res) => res.json(store.set(String(req.query.path || ""), req.body)));
  app.patch("/api/db/doc", json, (req, res) => res.json(store.update(String(req.query.path || ""), req.body)));
  app.delete("/api/db/doc", (req, res) => res.json(store.delete(String(req.query.path || ""))));
  app.get("/api/db/collection", (req, res) => res.json({ docs: store.list(String(req.query.path || "")) }));
  app.post("/api/db/collection", json, (req, res) => res.json(store.add(String(req.query.path || ""), req.body)));
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
