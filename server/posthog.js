// Product analytics with PostHog, privacy first and off unless configured (docs/analytics.md).
//
// - Config is env only: ENCORE_POSTHOG_KEY (the project key, phc_..., public by design), ENCORE_POSTHOG_HOST (default
//   https://us.i.posthog.com) and ENCORE_POSTHOG_REPLAY=1 for masked session replay. No key: nothing loads, nothing is sent.
// - Server events (capture): every funnel step (server/metrics.js), every experiment row (server/experiments.js addSink)
//   and the moments listed in EVENTS. They are queued and sent to `${host}/batch/` every 10 seconds or 50 events, with a
//   5 second timeout. A failed batch is dropped, never retried in a loop, and nothing here blocks a request or throws.
// - distinct_id is a salted hash of the workspace id (the same one the browser identifies with, from /api/me/analytics),
//   never an email. Anonymous actions get a random id and no person profile.
// - Properties come from an allow-list of short words, counts and booleans. Names, emails, phones, addresses, free text,
//   titles, codes and tokens never get in: anything else is dropped before it is queued.
// - The browser side (public/plcount.js) only loads after consent, and only on pages this server sends (analyticsTag).
import crypto from "node:crypto";
import express from "express";
import { DEFAULT_WS, getWorkspace } from "./workspaces.js";
import { cityCentre } from "./geo.js";

const DEFAULT_HOST = "https://us.i.posthog.com";
const KEY_OK = /^phc_[A-Za-z0-9_-]{8,100}$/;
const ID_OK = /^[A-Za-z0-9_-]{1,80}$/;
const HASH_OK = /^[0-9a-f]{16}$/;
export const FLUSH_MS = 10_000, BATCH_MAX = 50, QUEUE_MAX = 1000, TIMEOUT_MS = 5000;

/** The config from env, or null when PostHog is off. Never holds anything but the public project key. */
export function config(env = process.env) {
  const key = String(env.ENCORE_POSTHOG_KEY || "").trim(); if (!KEY_OK.test(key)) return null;
  let host = DEFAULT_HOST; const raw = String(env.ENCORE_POSTHOG_HOST || "").trim();
  if (raw) { try { const u = new URL(raw); if (u.protocol !== "https:" && !/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) return null; host = u.origin; } catch { return null; } }
  return { key, host, replay: env.ENCORE_POSTHOG_REPLAY === "1" };
}
/** Where PostHog's browser script comes from: us.i.posthog.com serves it from us-assets.i.posthog.com. */
export const assetsHost = (host) => { try { const u = new URL(host); if (u.hostname.endsWith(".i.posthog.com")) u.hostname = u.hostname.replace(/\.i\.posthog\.com$/, "-assets.i.posthog.com"); return u.origin; } catch { return host; } };

// ---------------------------------------------------------------- ids
const salt = () => process.env.ENCORE_ANALYTICS_SALT || process.env.SESSION_SECRET || "pottery-lab-xp";
/** The salted hash a workspace (or account) is known by. Same function as experiments' unitHash when no
 * ENCORE_ANALYTICS_SALT is set, so experiment rows join the host they belong to. */
export const distinctId = (unit) => crypto.createHmac("sha256", salt()).update(String(unit)).digest("hex").slice(0, 16);

// ---------------------------------------------------------------- what may be sent
export const FUNNEL = ["signup", "first_event_created", "share_clicked", "first_reply", "three_replies", "event_done", "kudos_received", "guest_follow", "guest_became_host"];
export const EVENTS = new Set([...FUNNEL, "xp_exposure", "xp_conversion", "event_published", "reply_received", "kudos_given", "comment_posted", "chat_message_sent", "follow", "fanclub_joined",
  "drop_order_placed", "brand_quickbook_searched", "brand_request_sent", "signed_in", "signup_completed",
  "delight_sent", "delight_shown", "delight_tapped"]); // delight after: each moment by name (server/delightafter.js)
const WORD = /^[a-z][a-z0-9_-]{0,39}$/i;
const ENUMS = {
  step: new Set(FUNNEL),
  plan: new Set(["friends", "work"]),
  answer: new Set(["going", "maybe", "no", "waitlist", "requested"]),
  method: new Set(["email_code", "phone_code", "email_link", "passkey", "google", "apple", "password", "sso"]),
};
const WORDS = ["kind", "via", "exp", "variant", "goal"]; // short plain words (an event kind, a variant name)
const COUNTS = ["count", "guests", "results"];
const BOOLS = ["code", "first", "signed_in", "private", "paid"];
const word = (v) => { const s = String(v ?? ""); return WORD.test(s) && !/@/.test(s) && (s.match(/\d/g) || []).length <= 3 ? s.toLowerCase() : null; }; // a token or a phone has more digits than any word
/** City-level at most, and only a city we know (server/geo.js), by its own name: a name or a street never passes. */
const region = (v) => { const s = String(v ?? "").trim(); if (!s || s.length > 40 || !/^\p{L}[\p{L} .'-]*$/u.test(s)) return null; try { return cityCentre(s)?.name || null; } catch { return null; } };
/** Keep only allow-listed keys with values of the right shape. Everything else is dropped. */
export function cleanProps(p = {}) {
  const out = {}; if (!p || typeof p !== "object") return out;
  for (const [k, S] of Object.entries(ENUMS)) if (p[k] != null && S.has(String(p[k]))) out[k] = String(p[k]);
  for (const k of WORDS) if (p[k] != null) { const w = word(p[k]); if (w) out[k] = w; }
  for (const k of COUNTS) if (p[k] != null && Number.isFinite(+p[k]) && +p[k] >= 0 && +p[k] <= 100000 && typeof p[k] !== "boolean") out[k] = Math.round(+p[k]);
  for (const k of BOOLS) if (typeof p[k] === "boolean") out[k] = p[k];
  if (p.region != null) { const r = region(p.region); if (r) out.region = r; }
  if (out.exp && out.variant) out["$feature/" + out.exp] = out.variant;
  return out;
}
const planOf = (ws) => { try { const W = getWorkspace(ws); return W?.plan === "friends" ? "friends" : W?.plan ? "work" : null; } catch { return null; } };

// ---------------------------------------------------------------- queue and sender
let S = null, fetchImpl = (...a) => globalThis.fetch(...a), timer = null, inflight = null;
const queue = [];
const stats = { sent: 0, dropped: 0, lastSentAt: 0, lastError: "" };
export const useAnalyticsStore = (store) => { S = store; try { const st = S?.get("system/analytics-status")?.data; if (st?.lastSentAt && !stats.lastSentAt) stats.lastSentAt = st.lastSentAt; } catch {} };
/** Tests: stub fetch, empty the queue. */
export const _setFetch = (f) => { fetchImpl = f; };
export const _reset = () => { queue.length = 0; inflight = null; if (timer) { clearInterval(timer); timer = null; } Object.assign(stats, { sent: 0, dropped: 0, lastSentAt: 0, lastError: "" }); };
export const _queue = () => queue.map((e) => JSON.parse(JSON.stringify(e)));

const offPath = (did) => "system/analytics-off-" + did;
/** Someone turned usage counts off in Settings: nothing more is sent for them, server or browser. */
export const optedOut = (did) => { try { return !!S?.get(offPath(did)); } catch { return false; } };
export const setOptOut = (did, off) => { if (!S || !HASH_OK.test(did)) return; try { if (off) S.set(offPath(did), { at: Date.now() }); else S.delete?.(offPath(did)); } catch {} };

/**
 * Queue one event. props: ws (whose event it is, hashed), or distinctId (an already salted 16-hex hash), plus the
 * allow-listed properties. Returns true when queued. Never throws.
 */
export function capture(event, props = {}, at = Date.now()) {
  try {
    const C = config(); if (!C || !EVENTS.has(event)) return false;
    const ws = props?.ws != null && ID_OK.test(String(props.ws)) && props.ws !== DEFAULT_WS ? String(props.ws) : "";
    let did = HASH_OK.test(String(props?.distinctId || "")) ? String(props.distinctId) : ws ? distinctId(ws) : "";
    if (did && optedOut(did)) return false;
    const properties = { ...cleanProps(props), source: "server", $lib: "pottery-lab-server", $ip: null, $geoip_disable: true };
    if (ws && !properties.plan) { const p = planOf(ws); if (p) properties.plan = p; }
    if (!did) { did = "anon-" + crypto.randomUUID(); properties.$process_person_profile = false; }
    queue.push({ event, distinct_id: did, properties, timestamp: new Date(+at || Date.now()).toISOString() });
    while (queue.length > QUEUE_MAX) { queue.shift(); stats.dropped++; }
    if (queue.length >= BATCH_MAX) flush(); else if (!timer) { timer = setInterval(() => { flush(); }, FLUSH_MS); timer.unref?.(); }
    return true;
  } catch { return false; }
}
/** A funnel step from server/metrics.js track (sign-up also counts as signup_completed, with how they joined). */
export function captureStep(name, row = {}) {
  if (!FUNNEL.includes(name)) return false;
  const ok = capture(name, { ws: row.ws, step: name, code: typeof row.code === "boolean" ? row.code : undefined, via: row.via }, row.at);
  if (ok && name === "signup") capture("signup_completed", { ws: row.ws, method: row.via === "google" || row.via === "apple" || row.via === "passkey" ? row.via : row.via === "phone" ? "phone_code" : row.via === "email" ? "email_code" : "password", code: typeof row.code === "boolean" ? row.code : undefined }, row.at);
  return ok;
}
/** One batch to PostHog. Resolves when done; never rejects. One batch in flight at a time. */
export function flush() {
  if (inflight) return inflight;
  const C = config(); if (!C || !queue.length) return Promise.resolve(false);
  const batch = queue.splice(0, BATCH_MAX);
  inflight = (async () => {
    try {
      const r = await fetchImpl(C.host + "/batch/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: C.key, batch }), signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (r && r.ok) { stats.sent += batch.length; stats.lastSentAt = Date.now(); stats.lastError = ""; try { S?.set("system/analytics-status", { lastSentAt: stats.lastSentAt }); } catch {} return true; }
      stats.lastError = "PostHog answered " + (r?.status || "?"); stats.dropped += batch.length; return false;
    } catch (e) { stats.lastError = e?.name === "TimeoutError" || e?.name === "AbortError" ? "timed out" : "could not reach PostHog"; stats.dropped += batch.length; return false; }
    finally { inflight = null; if (!queue.length && timer) { clearInterval(timer); timer = null; } else if (queue.length && !timer) { timer = setInterval(() => { flush(); }, FLUSH_MS); timer.unref?.(); } }
  })();
  return inflight;
}
/** For the admin page: connected or not, and when the last batch went. Never the key. */
export function status() {
  const C = config();
  return { connected: !!C, host: C ? new URL(C.host).hostname : "", replay: !!C?.replay, lastSentAt: stats.lastSentAt || null, lastError: stats.lastError || "", sent: stats.sent, dropped: stats.dropped, queued: queue.length };
}

// ---------------------------------------------------------------- pages
/** The page's CSP with the PostHog hosts added to script-src and connect-src, only when configured. */
export function cspWith(csp, env = process.env) {
  const C = config(env); if (!C) return csp;
  const add = [...new Set([C.host, assetsHost(C.host)])].join(" ");
  let out = String(csp).split(/;\s*/).map((d) => (/^(script-src|connect-src)\s/.test(d) ? d + " " + add : d));
  if (C.replay && !out.some((d) => /^worker-src\s/.test(d))) out.push("worker-src 'self' blob:");
  return out.join("; ");
}
const attr = (s) => String(s).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
/** Add the loader (public/plcount.js) to a page's head, once, only when configured. */
export function analyticsTag(html, env = process.env) {
  const s = String(html), C = config(env); if (!C || s.includes("/plcount.js")) return s;
  const i = s.search(/<\/head>/i); if (i < 0) return s;
  return s.slice(0, i) + `<script src="/plcount.js" data-k="${attr(C.key)}" data-h="${attr(C.host)}" data-a="${attr(assetsHost(C.host))}"${C.replay ? ' data-r="1"' : ""} defer></script>` + s.slice(i);
}

// ---------------------------------------------------------------- routes
/** Server events for routes that end well (2xx). Only counts and words from the request, never its text. */
const ROUTES = [
  ["POST", /^\/api\/public\/kudos$/, "kudos_given", (b) => ({ kind: "guest", count: Array.isArray(b.tags) ? b.tags.length : undefined })],
  ["POST", /^\/api\/public\/kudos-group\/[^/]+$/, "kudos_given", () => ({ kind: "group" })],
  ["POST", /^\/api\/feed\/kudos$/, "kudos_given", () => ({ kind: "feed" })],
  ["POST", /^\/api\/feed\/comments$/, "comment_posted", () => ({ kind: "feed" })],
  ["POST", /^\/api\/bb\/shortlists\/[^/]+\/comments$/, "comment_posted", () => ({ kind: "shortlist" })],
  ["POST", /^\/api\/chats\/[^/]+\/messages$/, "chat_message_sent", () => ({ kind: "text" })],
  ["POST", /^\/api\/chats\/[^/]+\/photo$/, "chat_message_sent", () => ({ kind: "photo" })],
  ["POST", /^\/api\/(public\/follow|me\/following\/[^/]+|xo\/[^/]+\/follow)$/, "follow", (b) => (b.on === false ? null : { kind: "host" })],
  ["POST", /^\/api\/me\/club\/[^/]+\/join$/, "fanclub_joined", () => ({})],
  ["POST", /^\/api\/bb\/requests$/, "brand_request_sent", (b) => ({ guests: b.people ?? b.headcount })],
];

export function mountPosthog(app, { store, currentUser, isAdmin = () => false, addSink = null }) {
  useAnalyticsStore(store);
  if (addSink && !mountPosthog.sink) { mountPosthog.sink = true;
    addSink((row) => { if (row?.name !== "xp" || !config()) return; capture(row.kind === "conversion" ? "xp_conversion" : "xp_exposure", { distinctId: row.u, exp: row.exp, variant: row.variant, goal: row.goal }, row.at); }); }
  const user = (req) => { try { return currentUser(req); } catch { return null; } };
  app.use((req, res, next) => {
    if (!config()) return next();
    const R = ROUTES.find(([m, re]) => m === req.method && re.test(req.path)); if (!R) return next();
    res.on("finish", () => { try {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      const p = R[3](req.body && typeof req.body === "object" ? req.body : {}, req.query || {}); if (!p) return;
      const u = user(req), ws = u?.ws && u.ws !== DEFAULT_WS ? u.ws : "";
      capture(R[2], { ...p, ws, signed_in: !!ws });
    } catch {} });
    next();
  });
  // the browser asks who it is (a hash, never an email) and whether usage counts are on
  app.get("/api/me/analytics", (req, res) => { res.set("Cache-Control", "private, no-store"); const C = config(), u = user(req), ws = u?.ws && u.ws !== DEFAULT_WS ? u.ws : "";
    if (!C) return res.json({ configured: false, on: false, id: null });
    const id = ws ? distinctId(ws) : null; res.json({ configured: true, on: !(id && optedOut(id)), id }); });
  app.post("/api/me/analytics", express.json({ limit: "2kb" }), (req, res) => { const u = user(req), ws = u?.ws && u.ws !== DEFAULT_WS ? u.ws : ""; if (!ws) return res.status(401).json({ code: "unauthenticated", message: "Sign in first." });
    const on = req.body?.on !== false; setOptOut(distinctId(ws), !on); res.json({ ok: true, on }); });
  app.get("/api/admin/analytics", (req, res) => { const u = user(req); if (!u || !isAdmin(u.email)) return res.status(404).json({ code: "not_found", message: "Not found." }); res.set("Cache-Control", "private, no-store").json(status()); });
}
