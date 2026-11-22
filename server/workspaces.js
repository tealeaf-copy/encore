// Workspaces for self-serve sign-up (ENCORE_SIGNUP=1). Each workspace's data lives under
// "ws/<id>/..." in the same store; the env-configured team is workspace "default" and keeps
// the plain paths, so existing installs see no change. Accounts, invites, MCP tokens and the
// event -> workspace index live in "system/" docs, which the data API can't read or write.
import { createHash, randomBytes } from "node:crypto";
import { randomId } from "./db.js";

export const DEFAULT_WS = "default";
export const TRIAL_DAYS = 14;
export const PLANS = ["team", "program"];
let raw = null;
export function useWorkspaceStore(s) { raw = s; }
export const signupEnabled = () => process.env.ENCORE_SIGNUP === "1";
const sha = (x) => createHash("sha256").update(String(x)).digest("hex");
const need = () => { if (!raw) throw new Error("workspace store not set"); return raw; };

/** A store whose paths are relative to one workspace. The default workspace is the store itself. */
export function scopeStore(store, ws) {
  if (!ws || ws === DEFAULT_WS) return store;
  const pre = `ws/${ws}/`, strip = (p) => (p.startsWith(pre) ? p.slice(pre.length) : p);
  return {
    events: store.events, ws, prefix: pre,
    get: (p) => store.get(pre + p),
    set: (p, d) => store.set(pre + p, d),
    update: (p, d) => store.update(pre + p, d),
    delete: (p) => store.delete(pre + p),
    add: (c, d) => { const r = store.add(pre + c, d); return { ...r, path: strip(r.path) }; },
    list: (c) => store.list(pre + c),
    close: () => {},
  };
}
/** A change event from the raw store as seen from inside a workspace, or null when it isn't that workspace's. */
export function scopeChange(e, ws) {
  const p = String(e?.path || "");
  if (!ws || ws === DEFAULT_WS) return /^(ws|system)(\/|$)/.test(p) ? null : e;
  const pre = `ws/${ws}/`;
  if (!p.startsWith(pre)) return null;
  return { ...e, path: p.slice(pre.length), parent: String(e.parent || "").startsWith(pre) ? e.parent.slice(pre.length) : String(e.parent || "").replace(`ws/${ws}`, "") };
}

// ---------- workspaces ----------
export function getWorkspace(id) {
  if (!id || id === DEFAULT_WS) return { id: DEFAULT_WS, company: "", plan: "self-hosted", trialEndsAt: null, createdAt: null };
  if (!/^[A-Za-z0-9]{20}$/.test(id)) return null;
  return need().get("system/ws-" + id)?.data || null;
}
export function createWorkspace({ company, ownerEmail, now = Date.now() }) {
  const ws = { kind: "workspace", id: randomId(), company: String(company).slice(0, 120), plan: "trial", trialEndsAt: now + TRIAL_DAYS * 864e5, createdAt: now, ownerEmail };
  need().set("system/ws-" + ws.id, ws);
  return ws;
}
/** Every workspace id, the default one first (for the daily job). */
export function allWorkspaceIds() {
  return [DEFAULT_WS, ...need().list("system").map((d) => d.data).filter((w) => w?.kind === "workspace").map((w) => w.id)];
}
export function updateWorkspace(id, patch) { return need().update("system/ws-" + id, patch).data; }
const PAID = new Set(PLANS);
/** Trial and plan state. Writes stop when a trial has ended and no paid plan is active (a pending upgrade doesn't unlock). */
export function trialState(ws, now = Date.now()) {
  if (!ws || ws.id === DEFAULT_WS) return { trial: false, trialEnded: false, daysLeft: null, writable: true };
  const trial = !PAID.has(ws.plan), ended = trial && !!ws.trialEndsAt && now >= ws.trialEndsAt;
  return { trial, trialEnded: ended, daysLeft: trial && ws.trialEndsAt ? Math.max(0, Math.ceil((ws.trialEndsAt - now) / 864e5)) : null, writable: !ended };
}

// ---------- accounts stored in the db (sign-up and invites) ----------
const userPath = (email) => "system/u-" + sha(String(email).trim().toLowerCase()).slice(0, 40);
export function getDbUser(email) { return email ? need().get(userPath(email))?.data || null : null; }
export function putDbUser(u) { need().set(userPath(u.email), u); return u; }
export function membersOf(ws) {
  return need().list("system").map((d) => d.data).filter((u) => u && u.kind === "user" && u.ws === ws).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

// ---------- invites: one-time join tokens, stored hashed ----------
export const INVITE_DAYS = 7;
export function createInvite({ ws, email, role, by, now = Date.now() }) {
  const token = randomBytes(24).toString("hex");
  need().set("system/inv-" + sha(token).slice(0, 40), { kind: "invite", ws, email, role, by, createdAt: now, expiresAt: now + INVITE_DAYS * 864e5, usedAt: null });
  return { token, expiresAt: now + INVITE_DAYS * 864e5 };
}
export function getInvite(token) {
  if (!/^[a-f0-9]{48}$/.test(String(token || ""))) return null;
  const d = need().get("system/inv-" + sha(token).slice(0, 40));
  return d ? { path: "system/inv-" + sha(token).slice(0, 40), ...d.data } : null;
}
export function useInvite(inv) { need().update(inv.path, { usedAt: Date.now() }); }

// ---------- per-workspace MCP tokens, stored hashed ----------
export function createMcpToken({ ws, name, email, now = Date.now() }) {
  const token = randomBytes(30).toString("base64url").slice(0, 40);
  need().set("system/mcp-" + sha(token).slice(0, 40), { kind: "mcptoken", ws, name, email, createdAt: now });
  return token;
}
export function findMcpToken(token) {
  if (!raw || !token) return null;
  return raw.get("system/mcp-" + sha(token).slice(0, 40))?.data || null;
}

// ---------- event id -> workspace, so guest links find the right workspace ----------
const evxPath = (id) => "system/evx-" + id;
/** The workspace an event id belongs to. Events from before workspaces belong to the default one. */
export function workspaceOfEvent(id) {
  if (!raw || !/^[A-Za-z0-9_-]{1,200}$/.test(String(id || ""))) return DEFAULT_WS;
  return raw.get(evxPath(id))?.data?.ws || DEFAULT_WS;
}
/** Claim an event id for a workspace. False when another workspace already owns it. */
export function claimEvent(id, ws) {
  const cur = raw.get(evxPath(id))?.data?.ws;
  if (cur) return cur === ws;
  // An unindexed event already in the default workspace's plain paths belongs to it.
  if (ws !== DEFAULT_WS && raw.get("events/" + id)) return false;
  raw.set(evxPath(id), { ws, at: Date.now() });
  return true;
}
