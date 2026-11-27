// Push notifications for the iOS and Android apps.
// - A device registry per person: system/pushdev-<hash> { email, devices: [{ token, platform: ios|android, env, app, at }] }
// - Sending: APNs with token auth (a .p8 key, HTTP/2) and FCM HTTP v1 (a service account), both from env; nothing is
//   sent when neither is set. ENCORE_FAKE_PUSH=1 records pushes in memory instead (tests and demos), like ENCORE_FAKE_EMAIL.
// - What gets pushed: every new item in someone's bell (server/social.js notify), read off the store's change events,
//   so replies, "you're in", reminders, "a spot opened up" and new photos all push without touching their senders.
//   People choose per kind in /settings (system/pushprefs-<hash>); quiet hours are the phone's own Focus. A bell item
//   marked nopush (an alert with its phone switch off) stays in the bell.
//
// APNs env: ENCORE_APNS_KEY (the .p8 contents, or base64 of it), ENCORE_APNS_KEY_ID, ENCORE_APPLE_TEAM_ID,
//   ENCORE_IOS_BUNDLE_ID (the topic), ENCORE_APNS_ENV=production|sandbox (sandbox for Xcode builds, production for
//   TestFlight and the App Store; a device token says which in its registration, see platform env)
// FCM env: ENCORE_FCM_PROJECT_ID, ENCORE_FCM_CLIENT_EMAIL, ENCORE_FCM_PRIVATE_KEY (from the service account JSON)
import crypto from "node:crypto";
import http2 from "node:http2";
import { DEFAULT_WS } from "./workspaces.js";
import { inDemo, isDemoEmail } from "./democtx.js";

const lc = (s) => String(s || "").trim().toLowerCase();
const hash = (s) => crypto.createHash("sha256").update(lc(s)).digest("hex").slice(0, 24);
const devPath = (em) => "system/pushdev-" + hash(em), prefPath = (em) => "system/pushprefs-" + hash(em), logPath = (em) => "system/pushlog-" + hash(em);
const b64url = (b) => Buffer.from(b).toString("base64url");
const pem = (v) => { const s = String(v || "").trim().replace(/\\n/g, "\n"); if (!s) return ""; return s.includes("BEGIN") ? s : Buffer.from(s, "base64").toString("utf8"); };

// What people can turn off, and which bell kinds belong to each (anything else counts as "replies").
export const PUSH_KINDS = {
  replies: { label: "Replies and messages", kinds: ["reply", "msg", "faq", "inquiry", "booked", "order", "help", "support"] },
  in: { label: "You're in, and event updates", kinds: ["letin", "itson", "invite", "ifwith", "table", "sametable"] },
  spots: { label: "A spot opened up", kinds: ["waitlist", "drop"] },
  reminders: { label: "Reminders", kinds: ["prep", "kudos", "after", "reminded", "saved", "alert", "digest", "nudge"] },
  photos: { label: "New photos", kinds: ["photos"] },
  people: { label: "Friends and kudos", kinds: ["friend", "vibe", "kudos-in", "tip"] },
};
export const groupOf = (kind) => Object.keys(PUSH_KINDS).find((g) => PUSH_KINDS[g].kinds.includes(kind)) || "replies";

// ---------- providers ----------
export function pushConfig(env = process.env) {
  if (env.ENCORE_FAKE_PUSH === "1") return { fake: true, apns: true, fcm: true };
  const apnsKey = pem(env.ENCORE_APNS_KEY), fcmKey = pem(env.ENCORE_FCM_PRIVATE_KEY);
  const apns = apnsKey && env.ENCORE_APNS_KEY_ID && env.ENCORE_APPLE_TEAM_ID ? { key: apnsKey, keyId: env.ENCORE_APNS_KEY_ID, team: env.ENCORE_APPLE_TEAM_ID, topic: env.ENCORE_IOS_BUNDLE_ID || "com.potterylab.app", env: env.ENCORE_APNS_ENV === "sandbox" ? "sandbox" : "production" } : null;
  const fcm = fcmKey && env.ENCORE_FCM_PROJECT_ID && env.ENCORE_FCM_CLIENT_EMAIL ? { key: fcmKey, project: env.ENCORE_FCM_PROJECT_ID, email: env.ENCORE_FCM_CLIENT_EMAIL } : null;
  return { fake: false, apns, fcm };
}
const outbox = [];
/** Pushes recorded in fake mode (newest last). */
export const fakeOutbox = () => outbox;
export const clearFakeOutbox = () => { outbox.length = 0; };

let apnsJwt = null;
function apnsToken(c) { // reused for 50 minutes (Apple wants a new one at most every 20 minutes and at least every hour)
  if (apnsJwt && apnsJwt.keyId === c.keyId && Date.now() - apnsJwt.at < 50 * 60e3) return apnsJwt.t;
  const head = b64url(JSON.stringify({ alg: "ES256", kid: c.keyId })), body = b64url(JSON.stringify({ iss: c.team, iat: Math.floor(Date.now() / 1000) }));
  const sig = crypto.sign("sha256", Buffer.from(head + "." + body), { key: c.key, dsaEncoding: "ieee-p1363" });
  apnsJwt = { keyId: c.keyId, at: Date.now(), t: `${head}.${body}.${b64url(sig)}` }; return apnsJwt.t;
}
function apnsSend(c, dev, msg) {
  const host = (dev.env || c.env) === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  const payload = JSON.stringify({ aps: { alert: { title: msg.title, body: msg.body }, sound: "default", "thread-id": msg.thread || msg.kind || "pl", ...(msg.badge != null ? { badge: msg.badge } : {}) }, link: msg.link || "/feed", kind: msg.kind || "" });
  return new Promise((resolve) => {
    let client; try { client = http2.connect(host); } catch (e) { return resolve({ ok: false, error: e.message }); }
    client.on("error", (e) => resolve({ ok: false, error: e.message }));
    const req = client.request({ ":method": "POST", ":path": "/3/device/" + dev.token, authorization: "bearer " + apnsToken(c), "apns-topic": c.topic, "apns-push-type": "alert", "apns-priority": "10", "content-type": "application/json" });
    let status = 0, data = ""; req.setTimeout(10_000, () => { req.close(); resolve({ ok: false, error: "timeout" }); });
    req.on("response", (h) => { status = h[":status"]; }); req.on("data", (d) => { data += d; });
    req.on("end", () => { client.close(); let reason = ""; try { reason = JSON.parse(data || "{}").reason || ""; } catch {} resolve({ ok: status === 200, status, reason, gone: status === 410 || /BadDeviceToken|Unregistered|DeviceTokenNotForTopic/.test(reason) }); });
    req.end(payload);
  });
}
let fcmAccess = null;
async function fcmToken(c) {
  if (fcmAccess && fcmAccess.exp > Date.now() + 60e3) return fcmAccess.t;
  const now = Math.floor(Date.now() / 1000), head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })), body = b64url(JSON.stringify({ iss: c.email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const jwt = `${head}.${body}.${b64url(crypto.sign("sha256", Buffer.from(head + "." + body), c.key))}`;
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }), signal: AbortSignal.timeout(10_000) });
  const j = await r.json(); if (!r.ok || !j.access_token) throw new Error("FCM auth failed: " + (j.error || r.status));
  fcmAccess = { t: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 }; return fcmAccess.t;
}
async function fcmSend(c, dev, msg) {
  try {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${c.project}/messages:send`, { method: "POST", headers: { authorization: "Bearer " + (await fcmToken(c)), "content-type": "application/json" }, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ message: { token: dev.token, notification: { title: msg.title, body: msg.body }, data: { link: msg.link || "/feed", kind: msg.kind || "" }, android: { notification: { tag: msg.thread || msg.kind || "pl", color: "#29489A" } } } }) });
    const j = await r.json().catch(() => ({})), code = j?.error?.details?.find?.((d) => d.errorCode)?.errorCode || j?.error?.status || "";
    return { ok: r.ok, status: r.status, reason: code, gone: r.status === 404 || code === "UNREGISTERED" || (r.status === 400 && code === "INVALID_ARGUMENT") };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ---------- registry, prefs, sending ----------
export function makePush(store, env = process.env) {
  const devicesOf = (em) => store.get(devPath(em))?.data?.devices || [];
  function register(em, { token, platform, env: apsEnv, app }) {
    token = String(token || "").trim(); platform = String(platform || "").toLowerCase();
    if (!["ios", "android"].includes(platform)) return { error: "platform must be ios or android" };
    if (!/^[A-Za-z0-9:_\-.]{20,4096}$/.test(token)) return { error: "That doesn't look like a device token." };
    // one person per device: a token someone else registered moves to this person (a shared or handed-down phone)
    const owner = store.get("system/pushtok-" + hash(token))?.data?.email; if (owner && owner !== lc(em)) unregister(owner, token);
    const L = devicesOf(em).filter((d) => d.token !== token); L.unshift({ token, platform, ...(apsEnv === "sandbox" || apsEnv === "production" ? { env: apsEnv } : {}), app: String(app || "").slice(0, 40), at: Date.now() });
    store.set(devPath(em), { kind: "pushdev", email: lc(em), devices: L.slice(0, 10) }); store.set("system/pushtok-" + hash(token), { kind: "pushtok", email: lc(em) });
    return { ok: true, devices: L.length };
  }
  function unregister(em, token) { const L = devicesOf(em), next = L.filter((d) => d.token !== token); if (next.length !== L.length) store.set(devPath(em), { kind: "pushdev", email: lc(em), devices: next }); store.delete("system/pushtok-" + hash(token)); return L.length - next.length; }
  function forget(em) { for (const d of devicesOf(em)) store.delete("system/pushtok-" + hash(d.token)); for (const p of [devPath(em), prefPath(em), logPath(em)]) store.delete(p); }
  const prefs = (em) => { const p = store.get(prefPath(em))?.data || {}; const out = { on: p.on !== false }; for (const g of Object.keys(PUSH_KINDS)) out[g] = p[g] !== false; return out; };
  function setPrefs(em, b) { const cur = prefs(em), next = { kind: "pushprefs", email: lc(em), on: b.on != null ? !!b.on : cur.on }; for (const g of Object.keys(PUSH_KINDS)) next[g] = b[g] != null ? !!b[g] : cur[g]; store.set(prefPath(em), next); return prefs(em); }
  const wants = (em, kind) => { const p = prefs(em); return p.on && p[groupOf(kind)] !== false; };

  /** Send to all of someone's devices. msg: { title, body, link, kind }. Respects their push settings. */
  async function send(em, msg, { force = false } = {}) {
    if (inDemo() || isDemoEmail(em)) return { sent: 0, skipped: true, demo: true }; // the marketer demo pushes nothing
    const C = pushConfig(env), devs = devicesOf(em);
    if (!devs.length || (!force && !wants(em, msg.kind))) return { sent: 0, skipped: true };
    const m = { title: String(msg.title || "Pottery Lab").slice(0, 120), body: String(msg.body || "").slice(0, 300), link: /^\/[^/]/.test(msg.link || "") || msg.link === "/" ? msg.link : "/feed", kind: msg.kind || "", thread: msg.thread };
    let sent = 0;
    for (const d of devs) {
      let r;
      if (C.fake) { outbox.push({ to: lc(em), token: d.token, platform: d.platform, ...m, at: Date.now() }); r = { ok: true }; }
      else if (d.platform === "ios" && C.apns) r = await apnsSend(C.apns, d, m);
      else if (d.platform === "android" && C.fcm) r = await fcmSend(C.fcm, d, m);
      else continue;
      if (r.ok) sent++; else if (r.gone) unregister(em, d.token); else console.warn("[push]", d.platform, r.status || "", r.reason || r.error || "");
    }
    return { sent };
  }

  // the bell -> push: when someone's inbox gets new unread items, push the newest (at most 3 at once)
  const titleFor = (n) => ({ reply: "New reply", msg: "New message", letin: "You're in", waitlist: "A spot opened up", photos: "New photos", prep: "Reminder", kudos: "How was it?", friend: "New friend", itson: "It's on", alert: "Something new near you", nudge: "Potto" })[n.kind] || "Pottery Lab";
  const strip = (s) => String(s || "").replace(/^[\p{Extended_Pictographic}️\s]+/u, "");
  async function fromInbox(path) {
    const d = store.get(path)?.data; if (!d?.email || !Array.isArray(d.list)) return;
    const em = lc(d.email); if (!devicesOf(em).length) return;
    // chat messages push themselves (server/chat.js: who said what, and not while the person has the app open), so
    // their bell item doesn't push a second time
    const last = store.get(logPath(em))?.data?.lastAt || 0, fresh = d.list.filter((n) => !n.read && (n.at || 0) > last && n.kind !== "chat").sort((a, b) => a.at - b.at);
    if (!fresh.length) return;
    store.set(logPath(em), { kind: "pushlog", email: em, lastAt: Math.max(...fresh.map((n) => n.at || 0)) });
    const unread = d.list.filter((n) => !n.read).length;
    for (const n of fresh.slice(-3)) if (!n.nopush) await send(em, { title: titleFor(n), body: strip(n.text), link: n.link, kind: n.kind, badge: unread, thread: n.eventId || n.kind });
  }
  let watching = false;
  function watch() {
    if (watching || !store.events) return; watching = true;
    store.events.on("change", (e) => { const p = String(e?.path || ""); if (!/^system\/inbox-[a-f0-9]+$/.test(p)) return; setImmediate(() => fromInbox(p).catch((err) => console.warn("[push]", err.message))); });
  }
  return { register, unregister, forget, devicesOf, prefs, setPrefs, wants, send, fromInbox, watch, config: () => pushConfig(env) };
}

export function mountPush(app, { store, small, currentUser }) {
  const P = makePush(store); P.watch();
  const me = (req, res) => { const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) { res.status(401).json({ code: "unauthenticated", message: "Sign in first." }); return null; } return u; };
  app.get("/api/me/push", (req, res) => { const u = me(req, res); if (!u) return; const C = P.config(); res.set("Cache-Control", "private, no-store");
    res.json({ prefs: P.prefs(u.email), kinds: Object.fromEntries(Object.entries(PUSH_KINDS).map(([k, v]) => [k, v.label])), devices: P.devicesOf(u.email).map((d) => ({ platform: d.platform, at: d.at, app: d.app, id: hash(d.token).slice(0, 8) })), configured: { ios: !!C.apns, android: !!C.fcm } }); });
  app.post("/api/me/push/devices", small, (req, res) => { const u = me(req, res); if (!u) return; const r = P.register(u.email, req.body || {}); if (r.error) return res.status(400).json({ code: "invalid", message: r.error }); res.json(r); });
  app.delete("/api/me/push/devices/:token", (req, res) => { const u = me(req, res); if (!u) return; res.json({ ok: true, removed: P.unregister(u.email, String(req.params.token || "")) }); });
  app.post("/api/me/push/prefs", small, (req, res) => { const u = me(req, res); if (!u) return; res.json({ ok: true, prefs: P.setPrefs(u.email, req.body || {}) }); });
  app.post("/api/me/push/test", small, async (req, res) => { const u = me(req, res); if (!u) return; res.json(await P.send(u.email, { title: "Pottery Lab", body: "Pushes are on. I'll tap you when something happens.", link: "/settings", kind: "help" }, { force: true })); });
  return P;
}
