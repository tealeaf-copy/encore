// Sign in and join, without a password: Sign in with Apple, Google (OpenID Connect), a passkey (WebAuthn) or a 6-digit
// code by email (with a magic link in the same email). Password sign-in (/api/login) keeps working for current users.
// One screen for /login and /signup: public/signin.html. See docs/sign-in-setup.md for the keys.
//
// Invite-only (ENCORE_INVITE_ONLY=1): a new person enters their invite code first (POST /api/auth/join). The code is
// checked with the same rules as /api/signup and held server-side (system/join-<hash>), behind a signed cookie that
// lasts 30 minutes. An OAuth start copies it into the OAuth state record, so the round trip to Apple or Google keeps it.
// Accounts are made by the same createAccount as /api/signup (server/app.js): the per-IP limit, the code check, the
// founder-code gate, vouches and logs are shared, not copied.
//
// Identities: system/ident-<provider>-<hash of the provider's subject>. A sign-in finds the identity first; else a
// verified email that matches an account links to it; else it's a new account (which needs an invite when invite-only).
// Apple private-relay addresses are just emails: they make their own account unless they match one.
//
// Safety: OAuth state and nonce on every flow, PKCE for Google, id_token signatures checked against the provider's JWKS
// with iss, aud, exp and nonce. A browser-binding cookie ties the callback to the browser that started it. Email codes
// expire in 10 minutes and allow 5 tries; sends are rate limited and always answer the same. Sessions are the usual
// v2 cookie (startSession). Account deletion removes identities and passkeys and revokes the Apple token.
//
// ENCORE_FAKE_OAUTH=1 (never with NODE_ENV=production) turns on test versions of Apple and Google that sign real
// id_tokens with a local key, so the same verification code runs in tests and demos.
import crypto from "node:crypto";
import express from "express";
import { currentUser, startSession, users } from "./auth.js";
import { DEFAULT_WS, getDbUser, putDbUser, signupEnabled } from "./workspaces.js";
import { ssoForEmail } from "./sso.js";
import { emailConfig, sendEmail } from "./email.js";

const env = process.env;
// WebAuthn (@simplewebauthn/server), loaded on the first passkey request so the server starts as fast as before
let webauthn = null; const WA = () => (webauthn ||= import("@simplewebauthn/server"));
const lc = (s) => String(s || "").trim().toLowerCase();
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const h40 = (s) => sha(s).slice(0, 40);
const b64u = (b) => Buffer.from(b).toString("base64url");
const MIN = 60e3;
const EMAIL_OK = (e) => typeof e === "string" && e.length <= 200 && /^[^\s@"<>()[\],;:]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(e);
const SAFE_NEXT = (n) => (/^\/(?!\/)[^\s\\]*$/.test(String(n || "")) && String(n).length < 300 ? String(n) : "");
const PROCESS_SECRET = crypto.randomBytes(32).toString("hex");
const secret = () => env.SESSION_SECRET || env.APP_PASSWORD || PROCESS_SECRET;
const hmac = (s) => crypto.createHmac("sha256", secret()).update("pl-signin:" + s).digest("base64url");
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// ---------- config: a button shows only when its provider is set up ----------
export const fakeOAuth = () => env.ENCORE_FAKE_OAUTH === "1" && env.NODE_ENV !== "production";
/** Google sign-in: ENCORE_GOOGLE_CLIENT_ID/SECRET, else the GOOGLE_CLIENT_ID/SECRET the calendar and Gmail use. */
export function googleConfig() {
  const id = env.ENCORE_GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID, sec = env.ENCORE_GOOGLE_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET;
  const native = [env.ENCORE_GOOGLE_IOS_CLIENT_ID, env.ENCORE_GOOGLE_ANDROID_CLIENT_ID].map((x) => String(x || "").trim()).filter(Boolean);
  if (id && sec) return { id, secret: sec, native, authorize: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", jwks: "https://www.googleapis.com/oauth2/v3/certs", iss: ["https://accounts.google.com", "accounts.google.com"] };
  return fakeOAuth() ? { fake: true, id: "fake-google-client", native: ["fake-google-ios"], iss: [FAKE_ISS + "google"] } : null;
}
/** The .p8 key as PEM: pasted whole, with \n escapes, or base64 of the file. */
function pemOf(k) {
  let s = String(k || "").trim(); if (!s) return "";
  if (!s.includes("BEGIN")) { try { const d = Buffer.from(s, "base64").toString("utf8"); if (d.includes("BEGIN")) s = d; } catch {} }
  return s.replace(/\\n/g, "\n");
}
/** Sign in with Apple: ENCORE_APPLE_SERVICES_ID, ENCORE_APPLE_TEAM_ID, ENCORE_APPLE_KEY_ID, ENCORE_APPLE_PRIVATE_KEY. */
export function appleConfig() {
  const servicesId = String(env.ENCORE_APPLE_SERVICES_ID || "").trim(), team = String(env.ENCORE_APPLE_TEAM_ID || "").trim(), keyId = String(env.ENCORE_APPLE_KEY_ID || "").trim(), key = pemOf(env.ENCORE_APPLE_PRIVATE_KEY);
  const bundleId = String(env.ENCORE_IOS_BUNDLE_ID || "").trim() || "com.potterylab.app";
  if (servicesId && team && keyId && key) return { servicesId, team, keyId, key, bundleId, authorize: "https://appleid.apple.com/auth/authorize", token: "https://appleid.apple.com/auth/token", revoke: "https://appleid.apple.com/auth/revoke", jwks: "https://appleid.apple.com/auth/keys", iss: ["https://appleid.apple.com"] };
  return fakeOAuth() ? { fake: true, servicesId: "fake.apple.services", bundleId: "fake.apple.bundle", iss: [FAKE_ISS + "apple"] } : null;
}
const emailOn = () => !!emailConfig(DEFAULT_WS, true);
/** The app's URL scheme (Info.plist CFBundleURLSchemes): a sign-in in the browser sheet returns to the app on it. */
const appScheme = () => (/^[a-z][a-z0-9+.-]{1,30}$/.test(String(env.ENCORE_APP_SCHEME || "")) ? env.ENCORE_APP_SCHEME : "potterylab");

// ---------- id_tokens ----------
const FAKE_ISS = "https://fake-oauth.potterylab.test/";
let fakeKey = null; // generated on first use: the test providers' signing key
function fakeKeys() { if (!fakeKey) { const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }); fakeKey = { privateKey, jwk: { ...publicKey.export({ format: "jwk" }), kid: "fake-1", alg: "RS256", use: "sig" } }; } return fakeKey; }
/** A signed RS256 JWT (the test providers' id_tokens; also used by tests with their own key). */
export function signJwt(claims, privateKey, kid) {
  const head = b64u(JSON.stringify({ alg: "RS256", kid, typ: "JWT" })), body = b64u(JSON.stringify(claims));
  return `${head}.${body}.${crypto.sign("RSA-SHA256", Buffer.from(head + "." + body), privateKey).toString("base64url")}`;
}
const tokenError = (message) => Object.assign(new Error(message), { code: "bad_token" });
/**
 * Check an OpenID Connect id_token: an RS256 signature by a key in `jwks`, an issuer in `iss`, an audience in `aud`,
 * not expired, and (when given) the nonce: equal to it, or to its SHA-256 (what the native Apple sheet sends).
 * Returns the claims, or throws.
 */
export function verifyIdToken(token, { jwks, iss, aud, nonce, now = Date.now() }) {
  const parts = String(token || "").split("."); if (parts.length !== 3) throw tokenError("Not a JWT.");
  let head, claims; try { head = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); } catch { throw tokenError("Unreadable token."); }
  if (head.alg !== "RS256") throw tokenError("Unexpected algorithm.");
  const jwk = (jwks?.keys || []).find((k) => k.kid === head.kid && k.kty === "RSA"); if (!jwk) throw tokenError("Unknown signing key.");
  const key = crypto.createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" });
  if (!crypto.verify("RSA-SHA256", Buffer.from(parts[0] + "." + parts[1]), key, Buffer.from(parts[2], "base64url"))) throw tokenError("Bad signature.");
  if (![].concat(iss).includes(claims.iss)) throw tokenError("Wrong issuer.");
  const auds = [].concat(aud).filter(Boolean); if (![].concat(claims.aud).some((a) => auds.includes(a))) throw tokenError("Wrong audience.");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < now - MIN) throw tokenError("Expired token.");
  if (typeof claims.iat === "number" && claims.iat * 1000 > now + 5 * MIN) throw tokenError("Token from the future.");
  if (nonce != null && !(typeof claims.nonce === "string" && (same(claims.nonce, nonce) || same(claims.nonce, sha(nonce))))) throw tokenError("Wrong nonce.");
  if (!claims.sub) throw tokenError("No subject.");
  return claims;
}
const jwksCache = new Map();
/** Tests: use these JWKS for a provider's URL instead of fetching it. */
export const jwksOverride = new Map();
async function jwksFor(cfg, fetchFn, fresh = false) {
  if (cfg.fake) return { keys: [fakeKeys().jwk] };
  if (jwksOverride.has(cfg.jwks)) return jwksOverride.get(cfg.jwks);
  const hit = jwksCache.get(cfg.jwks); if (hit && !fresh && Date.now() - hit.at < 3600e3) return hit.keys;
  const r = await fetchFn(cfg.jwks, { signal: AbortSignal.timeout(8000) }); if (!r.ok) throw tokenError("Couldn't load the provider's keys.");
  const keys = await r.json(); jwksCache.set(cfg.jwks, { at: Date.now(), keys }); return keys;
}
async function checkToken(cfg, token, opts, fetchFn) {
  try { return verifyIdToken(token, { jwks: await jwksFor(cfg, fetchFn), iss: cfg.iss, ...opts }); }
  catch (e) { if (e.message !== "Unknown signing key." || cfg.fake) throw e; return verifyIdToken(token, { jwks: await jwksFor(cfg, fetchFn, true), iss: cfg.iss, ...opts }); } // keys rotate
}
/** Apple's client secret: an ES256 JWT signed with the .p8 key, good for 5 minutes. */
export function appleClientSecret(cfg, clientId = cfg.servicesId, now = Date.now()) {
  const head = b64u(JSON.stringify({ alg: "ES256", kid: cfg.keyId })), iat = Math.floor(now / 1000);
  const body = b64u(JSON.stringify({ iss: cfg.team, iat, exp: iat + 300, aud: "https://appleid.apple.com", sub: clientId }));
  return `${head}.${body}.${crypto.sign("sha256", Buffer.from(head + "." + body), { key: cfg.key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

// ---------- the Apple refresh token, kept only to revoke it when the account is deleted ----------
const tokKey = () => crypto.createHash("sha256").update("pl-apple-token:" + secret()).digest();
function seal(s) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", tokKey(), iv), out = Buffer.concat([c.update(String(s), "utf8"), c.final()]); return b64u(Buffer.concat([iv, c.getAuthTag(), out])); }
function unseal(s) { try { const b = Buffer.from(String(s), "base64url"), d = crypto.createDecipheriv("aes-256-gcm", tokKey(), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"); } catch { return ""; } }

// ---------- identities and passkeys (system docs, which the data API can't read) ----------
const identPath = (provider, sub) => `system/ident-${provider}-${h40(provider + ":" + sub)}`;
const pkPath = (credId) => "system/pk-" + h40(credId);
export function identitiesOf(store, email) { const e = lc(email); return store.listPrefix("system", "ident-").map((d) => ({ path: "system/" + d.id, ...d.data })).filter((x) => x.email === e); }
export function passkeysOf(store, email) { const e = lc(email); return store.listPrefix("system", "pk-").map((d) => ({ path: "system/" + d.id, ...d.data })).filter((x) => x.email === e); }
/** Fake revocations, for tests and demos. */
export const fakeRevocations = [];
/**
 * Account deletion: revoke the Apple token (App Store guideline 5.1.1(v) asks for it), then remove every identity and
 * passkey for this email. Returns { identities, passkeys, revoked }.
 */
export async function removeSignIns(store, email, { fetchFn = globalThis.fetch } = {}) {
  const out = { identities: 0, passkeys: 0, revoked: 0 };
  for (const id of identitiesOf(store, email)) {
    if (id.provider === "apple" && id.appleToken) {
      const token = unseal(id.appleToken), cfg = appleConfig(), clientId = id.appleClient || cfg?.servicesId;
      if (token && cfg?.fake) { fakeRevocations.push({ token, clientId }); out.revoked++; }
      else if (token && cfg) { try { const r = await fetchFn(cfg.revoke, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: appleClientSecret(cfg, clientId), token, token_type_hint: "refresh_token" }), signal: AbortSignal.timeout(10000) }); if (r.ok) out.revoked++; else console.warn("[signin] apple revoke failed", r.status); } catch (e) { console.warn("[signin] apple revoke failed", e?.message); } }
    }
    store.delete(id.path); out.identities++;
  }
  for (const pk of passkeysOf(store, email)) { store.delete(pk.path); out.passkeys++; }
  return out;
}

// ---------- small helpers ----------
function readCookie(req, name) { for (const part of String(req.headers.cookie || "").split(";")) { const i = part.indexOf("="); if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim()); } return ""; }
const cookieOut = (req, name, value, maxAge, { path = "/", sameSite = "Lax" } = {}) => `${name}=${value}; Path=${path}; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${req.secure || sameSite === "None" ? "; Secure" : ""}`;
function makeLimiter() { const hits = new Map(); return (key, n, windowMs) => { const now = Date.now(), L = (hits.get(key) || []).filter((t) => now - t < windowMs); L.push(now); hits.set(key, L); if (hits.size > 20000) hits.clear(); return L.length > n; }; }
const ipOf = (req) => String(req.ip || req.socket?.remoteAddress || "?");
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const maskEmail = (e) => String(e).replace(/^(.).*@/, "$1***@");
const deviceOf = (ua = "") => /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android phone" : /Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows PC" : /CrOS/.test(ua) ? "Chromebook" : /Linux/.test(ua) ? "Linux computer" : "this device";

export const NO_INVITE = "You'll need an invite to join for now. Ask a friend who hosts, or join the waitlist.";

export function mountSignin(app, { store, createAccount, needInvite, checkCode, publicOrigin, sendStatic, fetchFn = (...a) => globalThis.fetch(...a) }) {
  const json = express.json({ limit: "16kb" }), form = express.urlencoded({ extended: false, limit: "16kb" });
  const limited = makeLimiter();
  const tooMany = (res, message = "Too many tries. Take a breather and try again later.") => res.status(429).json({ code: "rate_limited", message });
  const put = (p, data, ttl) => store.set(p, { ...data, exp: Date.now() + ttl });
  const take = (p, keep = false) => { const d = store.get(p)?.data; if (!d) return null; if (!keep) store.delete(p); if (d.exp && d.exp < Date.now()) { if (keep) store.delete(p); return null; } return d; };
  const origin = (req) => String(publicOrigin(req)).replace(/\/+$/, "");
  // short-lived records (codes, states, challenges) that were never used: swept every hour
  const SHORT = ["join-", "oauth-", "otp-", "otplink-", "pend-", "nonce-", "carry-", "handoff-", "pkchal-", "pkauth-"];
  const sweep = (now = Date.now()) => { let n = 0; for (const pre of SHORT) for (const d of store.listPrefix("system", pre)) if (d.data?.exp && d.data.exp < now) { store.delete("system/" + d.id); n++; } return n; };
  if (!env.NODE_TEST_CONTEXT) { const t = setInterval(() => { try { sweep(); } catch {} }, 3600e3); t.unref?.(); }

  // ---- the invite held between steps: a server-side record behind a signed cookie ----
  const JOIN = "pl_join", JOIN_TTL = 30 * MIN;
  const joinPath = (id) => "system/join-" + h40(id);
  function heldJoin(req) {
    const [id, sig] = readCookie(req, JOIN).split("."); if (!id || !sig || !same(sig, hmac("join:" + id))) return null;
    return take(joinPath(id), true);
  }
  function holdJoin(req, res, data) {
    const id = crypto.randomBytes(18).toString("base64url"); put(joinPath(id), data, JOIN_TTL);
    res.append("Set-Cookie", cookieOut(req, JOIN, `${id}.${hmac("join:" + id)}`, JOIN_TTL / 1000));
  }
  const clearJoin = (req, res) => res.append("Set-Cookie", cookieOut(req, JOIN, "", 0));
  const cleanJoin = (b = {}) => { const o = {}; for (const k of ["ref", "regularOf", "template", "plan"]) { const v = String(b[k] ?? "").trim(); if (/^[A-Za-z0-9_@.-]{1,80}$/.test(v)) o[k] = v; } return o; };

  // ---- who an email belongs to ----
  function accountFor(email) {
    const e = lc(email); if (!e) return null;
    const u = getDbUser(e); if (u?.kind === "user" || u?.ws) return { email: u.email, ws: u.ws, name: u.name };
    const t = users().find((x) => x.email === e); return t ? { email: t.email, ws: DEFAULT_WS, name: t.name } : null;
  }
  function ssoBlock(acct) { if (!acct || acct.ws === DEFAULT_WS) return null; const s = ssoForEmail(acct.email); return s && s.enforce && s.ws === acct.ws && s.configuredBy !== acct.email ? "/sso/start?email=" + encodeURIComponent(acct.email) : null; }
  function linkIdentity(acctEmail, idn) {
    const p = identPath(idn.provider, idn.sub), cur = store.get(p)?.data || {};
    store.set(p, { kind: "identity", provider: idn.provider, sub: idn.sub, email: lc(acctEmail), idEmail: lc(idn.email), privateRelay: !!idn.privateRelay, createdAt: cur.createdAt || Date.now(), lastUsedAt: Date.now(),
      ...(idn.appleToken ? { appleToken: seal(idn.appleToken), appleClient: idn.appleClient } : cur.appleToken ? { appleToken: cur.appleToken, appleClient: cur.appleClient } : {}) });
  }
  function markVerified(email) { const u = getDbUser(lc(email)); if (u && u.emailVerified === false) putDbUser({ ...u, emailVerified: true, verifiedAt: Date.now() }); }

  /**
   * The one place a proven identity becomes a session. idn: { provider, sub, email, emailVerified, name, privateRelay,
   * appleToken }. ctx: { join, next, native }. Returns { ok, redirect } | { need: "invite" | "name" } | { error, message }.
   */
  function finish(req, res, idn, ctx = {}) {
    const join = ctx.join || {}, next = SAFE_NEXT(ctx.next);
    const signIn = (acct, isNew, redirect) => {
      const sso = ssoBlock(acct); if (sso) return { error: "sso_required", message: "Your company uses single sign-on. Sign in with SSO instead.", sso };
      if (idn.provider !== "passkey") linkIdentity(acct.email, idn); if (idn.emailVerified && lc(idn.email) === lc(acct.email)) markVerified(acct.email);
      const to = redirect || next || "/";
      if (ctx.native) { const t = crypto.randomBytes(24).toString("base64url"); put("system/handoff-" + h40(t), { email: acct.email, ws: acct.ws, to }, 2 * MIN); clearJoin(req, res); return { ok: true, redirect: `${appScheme()}://auth/app?t=${t}`, isNew }; } // the browser sheet hands back to the app
      startSession(req, res, acct.email, acct.ws); clearJoin(req, res);
      console.log(`[signin] ${idn.provider} ${isNew ? "joined" : "signed in"}: ${maskEmail(acct.email)}`);
      return { ok: true, redirect: to, isNew };
    };
    // 0. a passkey names its account itself
    if (idn.account) { const acct = accountFor(idn.account); return acct ? signIn(acct, false) : { error: "no_account", message: "We couldn't find that account." }; }
    // 1. an identity we know
    const known = store.get(identPath(idn.provider, idn.sub))?.data;
    if (known) { const acct = accountFor(known.email); if (acct) return signIn(acct, false); store.delete(identPath(idn.provider, idn.sub)); }
    const email = lc(idn.email);
    // 2. a verified email that has an account: link and sign in (no invite needed)
    if (email && idn.emailVerified) { const acct = accountFor(email); if (acct) return signIn(acct, false); }
    // 3. a new account
    if (!signupEnabled()) return { error: "no_account", message: "We couldn't find an account for that. Try another way to sign in." };
    if (!email || !idn.emailVerified || !EMAIL_OK(email)) return { error: "no_email", message: "We couldn't confirm an email address with that sign-in. Try another way." };
    if (needInvite() && !join.code && !join.ref && !join.regularOf) return { need: "invite", message: NO_INVITE };
    const name = String(idn.name || "").trim().slice(0, 120);
    if (!name) { const id = crypto.randomBytes(18).toString("base64url"); put("system/pend-" + h40(id), { idn: { ...idn, appleToken: idn.appleToken ? seal(idn.appleToken) : "" }, ctx: { join, next, native: !!ctx.native } }, 15 * MIN); res.append("Set-Cookie", cookieOut(req, "pl_pend", `${id}.${hmac("pend:" + id)}`, 15 * 60)); return { need: "name" }; }
    const r = createAccount(req, { name, email, mode: "friends", ...join }, { password: null, verified: true, via: idn.provider });
    if (r.error) { if (r.error.body?.code === "invite_required") { clearJoin(req, res); return { need: "invite", message: join.code ? r.error.body.message : NO_INVITE }; } return { error: r.error.body?.code || "failed", message: r.error.body?.message || "Couldn't make your account. Try again.", status: r.error.status }; }
    return signIn({ email: r.email, ws: r.W.id }, true, r.redirect);
  }
  // JSON answer for the in-page flows
  const answer = (res, out) => out.ok ? res.json({ ok: true, redirect: out.redirect, isNew: !!out.isNew }) : out.need ? res.json({ ok: false, need: out.need, message: out.message || "" }) : res.status(out.status || (out.error === "sso_required" ? 401 : 400)).json({ code: out.error, message: out.message, ...(out.sso ? { sso: out.sso } : {}) });
  // redirect answer for the OAuth callbacks
  const land = (res, out) => res.redirect(303, out.ok ? out.redirect : out.need === "invite" ? "/signup?why=invite" : out.need === "name" ? "/signup?step=name" : out.sso ? out.sso : "/login?error=oauth&why=" + encodeURIComponent(out.error || "failed"));

  // ---------- config and the invite code ----------
  app.get("/api/auth/config", (req, res) => {
    const g = googleConfig(), a = appleConfig(), held = heldJoin(req);
    res.set("Cache-Control", "no-store").json({ signup: signupEnabled(), inviteOnly: signupEnabled() && needInvite(), providers: { apple: !!a, google: !!g, email: emailOn(), passkey: true, password: true }, fake: fakeOAuth(),
      held: held ? { code: !!held.code, from: held.from || "", vouch: !!(held.ref || held.regularOf) } : null, native: { google: g ? { webClientId: g.id } : null, apple: a ? { servicesId: a.servicesId } : null } });
  });
  app.post("/api/auth/join", json, (req, res) => {
    if (limited("join:" + ipOf(req), 30, 60 * MIN)) return tooMany(res);
    const b = req.body || {}, extra = cleanJoin(b);
    // typed on a phone: "57yd v9lp" or "57YDV9LP" is the code 57YD-V9LP
    let code = String(b.code || "").trim().toUpperCase().slice(0, 20); const flat = code.replace(/[^A-Z0-9]/g, "");
    if (code && !checkCode(code).ok && flat.length === 8 && checkCode(flat.slice(0, 4) + "-" + flat.slice(4)).ok) code = flat.slice(0, 4) + "-" + flat.slice(4);
    if (!code && !Object.keys(extra).length) return res.status(400).json({ code: "invalid", message: "Add your invite code." });
    let from = "";
    if (code) { const r = checkCode(code); if (!r.ok) { console.log(`[signin] invite code refused from ${sha(ipOf(req)).slice(0, 8)}`); return res.status(403).json({ code: "invite_invalid", message: r.message }); } from = firstName(r.c?.ownerName); }
    holdJoin(req, res, { ...(code ? { code } : {}), ...extra, from });
    res.json({ ok: true, from });
  });
  app.post("/api/auth/join/clear", (req, res) => { clearJoin(req, res); res.json({ ok: true }); });
  // the app opens the web sign-in in a browser sheet, which doesn't share its cookies: a one-time token carries the invite
  app.post("/api/auth/carry", (req, res) => { if (limited("carry:" + ipOf(req), 30, 15 * MIN)) return tooMany(res); const t = crypto.randomBytes(18).toString("base64url"), h = heldJoin(req);
    put("system/carry-" + h40(t), { join: h ? { ...cleanJoin(h), ...(h.code ? { code: h.code } : {}) } : null }, 5 * MIN); res.set("Cache-Control", "no-store").json({ t }); });

  // ---------- OAuth: Apple and Google on the web ----------
  const BIND = "pl_oauth";
  const redirectUri = (req, provider) => `${origin(req)}/auth/${provider}/callback`;
  function startOAuth(provider) {
    return (req, res) => {
      res.set("Cache-Control", "no-store");
      const cfg = provider === "google" ? googleConfig() : appleConfig(); if (!cfg) return res.redirect(303, "/login");
      if (limited("oauth:" + ipOf(req), 60, 15 * MIN)) return res.redirect(303, "/login?error=3");
      const state = crypto.randomBytes(24).toString("base64url"), nonce = crypto.randomBytes(24).toString("base64url"), bind = crypto.randomBytes(24).toString("base64url");
      const verifier = provider === "google" ? crypto.randomBytes(48).toString("base64url") : "";
      const carried = req.query.carry ? take("system/carry-" + h40(String(req.query.carry))) : null; // from the app's web view, which has its own cookies
      const held = carried?.join || heldJoin(req) || {}, join = cleanJoin(held); if (held.code) join.code = held.code;
      put("system/oauth-" + h40(state), { provider, nonce, verifier, bind: sha(bind), join, next: SAFE_NEXT(req.query.next), native: req.query.native === "1" }, 10 * MIN);
      // Apple answers with a cross-site form POST, which carries only SameSite=None cookies
      res.append("Set-Cookie", cookieOut(req, BIND, bind, 600, { path: "/auth", sameSite: provider === "apple" && (req.secure || /^https:/.test(origin(req))) ? "None" : "Lax" }));
      const redirect_uri = redirectUri(req, provider);
      if (cfg.fake) return res.redirect(302, `/auth/fake/${provider}?` + new URLSearchParams({ state, nonce, redirect_uri, ...(verifier ? { code_challenge: b64u(crypto.createHash("sha256").update(verifier).digest()), code_challenge_method: "S256" } : {}) }));
      const q = provider === "google"
        ? { client_id: cfg.id, redirect_uri, response_type: "code", scope: "openid email profile", state, nonce, code_challenge: b64u(crypto.createHash("sha256").update(verifier).digest()), code_challenge_method: "S256", prompt: "select_account" }
        : { client_id: cfg.servicesId, redirect_uri, response_type: "code", scope: "name email", response_mode: "form_post", state, nonce };
      res.redirect(302, cfg.authorize + "?" + new URLSearchParams(q));
    };
  }
  async function exchange(provider, cfg, req, code, st) {
    if (cfg.fake) { const f = fakeCodes.get(String(code)); fakeCodes.delete(String(code)); if (!f || f.exp < Date.now() || f.provider !== provider) throw tokenError("Bad code.");
      if (f.challenge && f.challenge !== b64u(crypto.createHash("sha256").update(st.verifier || "").digest())) throw tokenError("PKCE check failed.");
      return { id_token: f.idToken, ...(provider === "apple" ? { refresh_token: "fake-refresh-" + f.claims.sub } : {}) }; }
    const body = provider === "google"
      ? { code, client_id: cfg.id, client_secret: cfg.secret, redirect_uri: redirectUri(req, provider), grant_type: "authorization_code", code_verifier: st.verifier }
      : { code, client_id: cfg.servicesId, client_secret: appleClientSecret(cfg), redirect_uri: redirectUri(req, provider), grant_type: "authorization_code" };
    const r = await fetchFn(cfg.token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body), signal: AbortSignal.timeout(10000) });
    const j = await r.json().catch(() => ({})); if (!r.ok || !j.id_token) throw tokenError("The token exchange failed.");
    return j;
  }
  const identOf = (provider, claims, extra = {}) => ({ provider, sub: String(claims.sub), email: lc(claims.email), emailVerified: claims.email_verified === true || claims.email_verified === "true", privateRelay: claims.is_private_email === true || claims.is_private_email === "true" || /@privaterelay\.appleid\.com$/i.test(String(claims.email || "")), name: String(claims.name || "").trim(), ...extra });
  function callback(provider) {
    return async (req, res) => {
      res.set("Cache-Control", "no-store");
      const q = { ...req.query, ...(req.body || {}) }, cfg = provider === "google" ? googleConfig() : appleConfig();
      const unbind = () => res.append("Set-Cookie", cookieOut(req, BIND, "", 0, { path: "/auth" }));
      const st = q.state ? take("system/oauth-" + h40(String(q.state))) : null;
      if (!cfg || !st || st.provider !== provider) return unbind(), res.redirect(303, "/login?error=oauth&why=expired");
      if (!same(sha(readCookie(req, BIND)), st.bind)) return res.redirect(303, "/login?error=oauth&why=expired"); // a different browser than the one that started
      if (q.error) return unbind(), res.redirect(303, st.join?.code ? "/signup" : "/login");
      try {
        const tok = await exchange(provider, cfg, req, String(q.code || ""), st);
        const claims = await checkToken(cfg, tok.id_token, { aud: provider === "google" ? cfg.id : cfg.servicesId, nonce: st.nonce }, fetchFn);
        let name = String(claims.name || "").trim();
        if (provider === "apple" && !name && q.user) { try { const u = typeof q.user === "string" ? JSON.parse(q.user) : q.user; name = [u?.name?.firstName, u?.name?.lastName].filter(Boolean).join(" ").trim(); } catch {} } // Apple sends the name once, on the first sign-in
        const idn = identOf(provider, claims, { name, ...(provider === "apple" && tok.refresh_token ? { appleToken: tok.refresh_token, appleClient: cfg.servicesId } : {}) });
        const out = finish(req, res, idn, st); unbind(); land(res, out);
      } catch (e) { console.warn(`[signin] ${provider} sign-in failed: ${e.message}`); unbind(); res.redirect(303, "/login?error=oauth&why=failed"); }
    };
  }
  app.get("/auth/google/start", startOAuth("google"));
  app.get("/auth/apple/start", startOAuth("apple"));
  app.get("/auth/google/callback", callback("google"));
  app.get("/auth/apple/callback", callback("apple"));
  app.post("/auth/apple/callback", form, callback("apple"));

  // ---- native: the app's own Sign in with Apple and Google sheets hand us an id_token ----
  app.get("/api/auth/nonce", (req, res) => { if (limited("nonce:" + ipOf(req), 60, 15 * MIN)) return tooMany(res); const n = crypto.randomBytes(24).toString("base64url"); put("system/nonce-" + h40(n), { ok: 1 }, 10 * MIN); res.set("Cache-Control", "no-store").json({ nonce: n }); });
  async function nativeSignIn(provider, req, res) {
    if (limited("native:" + ipOf(req), 30, 15 * MIN)) return tooMany(res);
    const cfg = provider === "google" ? googleConfig() : appleConfig(), b = req.body || {}; if (!cfg) return res.status(404).json({ code: "not_configured", message: "That sign-in isn't set up yet." });
    const nonce = String(b.nonce || ""); if (!nonce || !take("system/nonce-" + h40(nonce))) return res.status(400).json({ code: "expired", message: "That took too long. Try again." });
    try {
      const aud = provider === "google" ? [cfg.id, ...(cfg.native || [])] : [cfg.bundleId, cfg.servicesId];
      const claims = await checkToken(cfg, String(b.idToken || ""), { aud, nonce }, fetchFn);
      let appleToken = "";
      if (provider === "apple" && b.authorizationCode && !cfg.fake) { try { const r = await fetchFn(cfg.token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: String(b.authorizationCode), client_id: cfg.bundleId, client_secret: appleClientSecret(cfg, cfg.bundleId), grant_type: "authorization_code" }), signal: AbortSignal.timeout(10000) }); const j = await r.json().catch(() => ({})); appleToken = j.refresh_token || ""; } catch {} }
      if (provider === "apple" && cfg.fake && b.authorizationCode) appleToken = "fake-refresh-" + claims.sub;
      const name = String(claims.name || [b.givenName, b.familyName].filter(Boolean).join(" ")).trim().slice(0, 120);
      answer(res, finish(req, res, identOf(provider, claims, { name, ...(appleToken ? { appleToken, appleClient: cfg.bundleId } : {}) }), { join: (() => { const h = heldJoin(req) || {}; return { ...cleanJoin(h), ...(h.code ? { code: h.code } : {}) }; })(), next: b.next }));
    } catch (e) { console.warn(`[signin] native ${provider} failed: ${e.message}`); res.status(401).json({ code: "bad_token", message: "That sign-in didn't work. Try again." }); }
  }
  app.post("/api/auth/google/native", json, (req, res) => nativeSignIn("google", req, res));
  app.post("/api/auth/apple/native", json, (req, res) => nativeSignIn("apple", req, res));
  // the web flow opened from the app ends on a universal link: the app opens /auth/app?t=…, which signs in its own web view
  app.get("/auth/app", (req, res) => { res.set("Cache-Control", "no-store"); const d = take("system/handoff-" + h40(String(req.query.t || ""))); if (!d) return res.redirect(303, "/login?error=oauth&why=expired");
    startSession(req, res, d.email, d.ws); res.redirect(303, SAFE_NEXT(d.to) || "/"); });

  // ---- the test providers (ENCORE_FAKE_OAUTH=1) ----
  const fakeCodes = new Map();
  const fakePage = (provider, q, msg = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test sign-in</title><link rel="stylesheet" href="/system.css"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--pl-page);font:16px var(--sys-sans);color:var(--pl-ink)}form{width:min(360px,calc(100vw - 32px));background:#fff;border:1px solid var(--pl-line);border-radius:16px;padding:24px;box-sizing:border-box}h1{font:400 26px var(--sys-display);margin:0 0 4px}p{color:var(--pl-soft);margin:0 0 16px;font-size:14px}label{display:block;font-weight:600;font-size:14px;margin-bottom:12px}input{display:block;width:100%;box-sizing:border-box;min-height:48px;margin-top:6px;border:1px solid var(--pl-line-strong);border-radius:10px;padding:0 12px;font:16px inherit}button{width:100%;min-height:48px;border:0;border-radius:999px;background:var(--pl-accent);color:#fff;font:600 16px inherit;cursor:pointer}.chk{display:flex;gap:8px;align-items:center;font-weight:400}.chk input{width:auto;min-height:0;margin:0}</style></head><body>
<form method="post" action="/auth/fake/${provider}"><h1>Test ${provider === "apple" ? "Apple" : "Google"}</h1><p>This server uses a test sign-in. No real account is used.${msg ? " " + msg : ""}</p>
${Object.entries(q).map(([k, v]) => `<input type="hidden" name="${k}" value="${String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])}">`).join("")}
<label>Email<input name="email" type="email" required autofocus></label><label>Name<input name="name" autocomplete="off"></label><label class="chk"><input type="checkbox" name="verified" value="1" checked>Email is verified</label><button>Continue</button></form></body></html>`;
  app.get("/auth/fake/:provider", (req, res) => { if (!fakeOAuth() || !["google", "apple"].includes(req.params.provider)) return res.status(404).send("Not found");
    const q = {}; for (const k of ["state", "nonce", "redirect_uri", "code_challenge", "code_challenge_method"]) if (req.query[k]) q[k] = String(req.query[k]); res.type("html").send(fakePage(req.params.provider, q)); });
  app.post("/auth/fake/:provider", form, (req, res) => {
    const provider = req.params.provider; if (!fakeOAuth() || !["google", "apple"].includes(provider)) return res.status(404).send("Not found");
    const b = req.body || {}, email = lc(b.email), cfg = provider === "google" ? googleConfig() : appleConfig();
    if (!EMAIL_OK(email)) return res.status(400).type("html").send(fakePage(provider, b, "Add an email."));
    const now = Math.floor(Date.now() / 1000), claims = { iss: cfg.iss[0], aud: provider === "google" ? cfg.id : cfg.servicesId, sub: (provider === "apple" ? "001." : "1") + sha(provider + email).slice(0, 20), email, email_verified: b.verified === "1", iat: now, exp: now + 600, nonce: String(b.nonce || ""), ...(provider === "google" && b.name ? { name: String(b.name) } : {}), ...(/@privaterelay\.appleid\.com$/.test(email) ? { is_private_email: true } : {}) };
    const code = crypto.randomBytes(16).toString("hex"); fakeCodes.set(code, { provider, claims, idToken: signJwt(claims, fakeKeys().privateKey, "fake-1"), challenge: String(b.code_challenge || ""), exp: Date.now() + 5 * MIN });
    const back = String(b.redirect_uri || ""); if (!back.startsWith(origin(req) + "/auth/" + provider + "/callback")) return res.status(400).send("Bad redirect");
    const user = provider === "apple" && b.name ? { user: JSON.stringify({ name: { firstName: String(b.name).split(" ")[0], lastName: String(b.name).split(" ").slice(1).join(" ") }, email }) } : {};
    res.redirect(303, back + "?" + new URLSearchParams({ code, state: String(b.state || ""), ...user }));
  });
  /** Tests: a fake provider's id_token for these claims (native flows). */
  app.locals.fakeIdToken = (provider, claims) => { const cfg = provider === "google" ? googleConfig() : appleConfig(), now = Math.floor(Date.now() / 1000); return signJwt({ iss: cfg.iss[0], aud: provider === "google" ? cfg.id : cfg.servicesId, iat: now, exp: now + 600, ...claims }, fakeKeys().privateKey, "fake-1"); };

  // ---------- email: a 6-digit code, and a magic link in the same email ----------
  const OTP_TTL = 10 * MIN, OTP_TRIES = 5;
  const otpPath = (email) => "system/otp-" + h40("otp:" + lc(email)), linkPath = (t) => "system/otplink-" + h40(t);
  const codeHash = (salt, code) => sha(salt + ":" + code);
  app.post("/api/auth/email/start", json, async (req, res) => {
    const email = lc(req.body?.email).slice(0, 200);
    if (!EMAIL_OK(email)) return res.status(400).json({ code: "invalid", message: "That email doesn't look right." });
    if (limited("otp-ip:" + ipOf(req), 20, 60 * MIN) || limited("otp-em:" + email, 5, 60 * MIN)) return tooMany(res, "We've sent a few codes already. Check your inbox, or try again in a bit.");
    const cfg = emailConfig(DEFAULT_WS, true); if (!cfg) return res.status(503).json({ code: "email_off", message: "We can't send email right now. Try another way to sign in." });
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, "0"), salt = crypto.randomBytes(8).toString("hex"), link = crypto.randomBytes(24).toString("base64url");
    const old = store.get(otpPath(email))?.data; if (old?.link) store.delete(linkPath(old.link));
    const held = heldJoin(req) || {}, join = { ...cleanJoin(held), ...(held.code ? { code: held.code } : {}) };
    put(otpPath(email), { email, salt, hash: codeHash(salt, code), tries: 0, link: h40(link), join, next: SAFE_NEXT(req.body?.next) }, OTP_TTL);
    put(linkPath(h40(link)), { email }, OTP_TTL);
    const url = `${origin(req)}/auth/email?t=${link}`;
    if (cfg.service === "fake") console.log(`[signin] email code for ${email}: ${code} ${url}`); // demos: the code shows in the server log
    // the same work and the same answer for every address, so nobody learns which emails have accounts
    sendEmail(cfg, { to: email, subject: `${code} is your Pottery Lab code`, text: `Your Pottery Lab code is ${code}\n\nIt works for 10 minutes. Or tap this link to continue:\n${url}\n\nIf you didn't ask for this, you can ignore this email. Nobody can sign in without the code.` }).then((x) => { if (x && x.ok === false) console.warn("[signin] email code failed", x.error || ""); }).catch((e) => console.warn("[signin] email code failed", e?.message));
    res.json({ ok: true, message: `We sent a code to ${email}.` });
  });
  function checkOtp(req, email, code) {
    const p = otpPath(email), d = store.get(p)?.data;
    if (!d || d.exp < Date.now()) { if (d) store.delete(p); return { error: "expired", message: "That code has expired. Get a new one." }; }
    if (!/^\d{6}$/.test(code) || !same(codeHash(d.salt, code), d.hash)) {
      const tries = (d.tries || 0) + 1;
      if (tries >= OTP_TRIES) { store.delete(p); store.delete(linkPath(d.link)); return { error: "too_many", message: "That's too many tries for this code. Get a new one." }; }
      store.set(p, { ...d, tries }); return { error: "wrong", message: `That code isn't right. ${OTP_TRIES - tries} ${OTP_TRIES - tries === 1 ? "try" : "tries"} left.` };
    }
    store.delete(p); store.delete(linkPath(d.link)); return { ok: true, rec: d };
  }
  const emailIdent = (email) => ({ provider: "email", sub: lc(email), email: lc(email), emailVerified: true, name: "" });
  const joinNow = (req, rec) => { const h = heldJoin(req); return h ? { ...cleanJoin(h), ...(h.code ? { code: h.code } : {}) } : rec.join || {}; };
  app.post("/api/auth/email/verify", json, (req, res) => {
    if (limited("otpv-ip:" + ipOf(req), 30, 15 * MIN)) return tooMany(res);
    const email = lc(req.body?.email), code = String(req.body?.code || "").replace(/\D/g, "");
    const r = checkOtp(req, email, code); if (!r.ok) return res.status(r.error === "too_many" ? 429 : 400).json({ code: r.error, message: r.message });
    answer(res, finish(req, res, emailIdent(email), { join: joinNow(req, r.rec), next: r.rec.next }));
  });
  // the magic link: a page with one button, so a mail scanner that opens links doesn't use it up
  app.get("/auth/email", (req, res) => { res.set("Cache-Control", "no-store"); sendStatic(res, "signin.html"); });
  app.post("/api/auth/email/link", json, (req, res) => {
    if (limited("otpv-ip:" + ipOf(req), 30, 15 * MIN)) return tooMany(res);
    const t = String(req.body?.t || ""), l = take(linkPath(h40(t))); if (!l) return res.status(400).json({ code: "expired", message: "This link has expired. Get a new code." });
    const p = otpPath(l.email), d = take(p); if (!d || d.link !== h40(t)) return res.status(400).json({ code: "expired", message: "This link has expired. Get a new code." });
    answer(res, finish(req, res, emailIdent(l.email), { join: joinNow(req, d), next: d.next }));
  });

  // ---------- a name, for a new account whose sign-in didn't bring one ----------
  app.get("/api/auth/pending", (req, res) => { const [id, sig] = readCookie(req, "pl_pend").split("."); const d = id && sig && same(sig, hmac("pend:" + id)) ? take("system/pend-" + h40(id), true) : null;
    res.set("Cache-Control", "no-store").json(d ? { pending: true, email: d.idn.email, provider: d.idn.provider } : { pending: false }); });
  app.post("/api/auth/finish", json, (req, res) => {
    const [id, sig] = readCookie(req, "pl_pend").split("."); const d = id && sig && same(sig, hmac("pend:" + id)) ? take("system/pend-" + h40(id), true) : null;
    if (!d) return res.status(400).json({ code: "expired", message: "That took too long. Start again." });
    const name = String(req.body?.name || "").replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, 80); if (name.length < 1) return res.status(400).json({ code: "invalid", message: "Add your name." });
    const out = finish(req, res, { ...d.idn, appleToken: d.idn.appleToken ? unseal(d.idn.appleToken) : "", name }, d.ctx);
    if (out.ok || out.need === "invite") { store.delete("system/pend-" + h40(id)); res.append("Set-Cookie", cookieOut(req, "pl_pend", "", 0)); }
    answer(res, out);
  });

  // ---------- passkeys ----------
  const rpID = (req) => String(env.ENCORE_PASSKEY_RP_ID || (() => { try { return env.ENCORE_PUBLIC_URL ? new URL(env.ENCORE_PUBLIC_URL).hostname : ""; } catch { return ""; } })() || req.hostname);
  const origins = (req) => [origin(req), ...String(env.ENCORE_PASSKEY_ORIGINS || "").split(",").map((x) => x.trim()).filter(Boolean)];
  const me = (req, res) => { const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) { res.status(401).json({ code: "unauthenticated", message: "Sign in first." }); return null; } return u; };
  app.post("/api/passkeys/register/options", json, async (req, res) => {
    const u = me(req, res); if (!u) return; if (limited("pkreg:" + u.email, 20, 60 * MIN)) return tooMany(res);
    let rec = getDbUser(u.email); if (!rec) return res.status(404).json({ code: "not_found", message: "No account." });
    if (!rec.webauthnId) { rec = { ...rec, webauthnId: crypto.randomBytes(16).toString("base64url") }; putDbUser(rec); }
    const opts = await (await WA()).generateRegistrationOptions({ rpName: "Pottery Lab", rpID: rpID(req), userName: u.email, userDisplayName: rec.name || u.email, userID: Buffer.from(rec.webauthnId, "base64url"), attestationType: "none",
      excludeCredentials: passkeysOf(store, u.email).map((p) => ({ id: p.credId, transports: p.transports })), authenticatorSelection: { residentKey: "required", userVerification: "preferred" }, supportedAlgorithmIDs: [-7, -257] });
    put("system/pkchal-" + h40(u.email), { challenge: opts.challenge }, 5 * MIN);
    res.set("Cache-Control", "no-store").json(opts);
  });
  app.post("/api/passkeys/register/verify", json, async (req, res) => {
    const u = me(req, res); if (!u) return; const ch = take("system/pkchal-" + h40(u.email)); if (!ch) return res.status(400).json({ code: "expired", message: "That took too long. Try again." });
    try {
      const v = await (await WA()).verifyRegistrationResponse({ response: req.body?.response, expectedChallenge: ch.challenge, expectedOrigin: origins(req), expectedRPID: rpID(req), requireUserVerification: false });
      if (!v.verified) throw new Error("not verified");
      const c = v.registrationInfo.credential, device = deviceOf(String(req.headers["user-agent"] || ""));
      if (store.get(pkPath(c.id))) return res.status(409).json({ code: "conflict", message: "That passkey is already added." });
      store.set(pkPath(c.id), { kind: "passkey", email: u.email, credId: c.id, publicKey: b64u(c.publicKey), counter: c.counter || 0, transports: c.transports || req.body?.response?.response?.transports || [], backedUp: !!v.registrationInfo.credentialBackedUp, name: `Passkey on ${device}`, createdAt: Date.now() });
      console.log(`[signin] passkey added for ${maskEmail(u.email)}`);
      res.json({ ok: true, passkeys: listPasskeys(u.email) });
    } catch (e) { console.warn("[signin] passkey register failed:", e.message); res.status(400).json({ code: "invalid", message: "That passkey didn't save. Try again." }); }
  });
  const listPasskeys = (email) => passkeysOf(store, email).sort((a, b) => a.createdAt - b.createdAt).map((p) => ({ id: h40(p.credId).slice(0, 16), name: p.name, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt || null, synced: !!p.backedUp }));
  app.get("/api/passkeys", (req, res) => { const u = me(req, res); if (!u) return;
    const ids = identitiesOf(store, u.email).filter((x) => x.provider !== "passkey").map((x) => ({ provider: x.provider, email: x.idEmail || x.email, privateRelay: !!x.privateRelay, lastUsedAt: x.lastUsedAt || null }));
    res.set("Cache-Control", "private, no-store").json({ passkeys: listPasskeys(u.email), identities: ids, password: !!/^scrypt\$/.test(String(getDbUser(u.email)?.pw || "")) }); });
  app.delete("/api/passkeys/:id", (req, res) => { const u = me(req, res); if (!u) return; const p = passkeysOf(store, u.email).find((x) => h40(x.credId).slice(0, 16) === String(req.params.id)); if (!p) return res.status(404).json({ code: "not_found", message: "No such passkey." });
    store.delete(p.path); res.json({ ok: true, passkeys: listPasskeys(u.email) }); });
  app.post("/api/auth/passkey/options", json, async (req, res) => {
    if (limited("pkauth:" + ipOf(req), 60, 15 * MIN)) return tooMany(res);
    const opts = await (await WA()).generateAuthenticationOptions({ rpID: rpID(req), userVerification: "preferred", allowCredentials: [] });
    put("system/pkauth-" + h40(opts.challenge), { ok: 1 }, 5 * MIN);
    res.set("Cache-Control", "no-store").json(opts);
  });
  app.post("/api/auth/passkey/verify", json, async (req, res) => {
    if (limited("pkauthv:" + ipOf(req), 30, 15 * MIN)) return tooMany(res);
    const resp = req.body?.response, fail = () => res.status(401).json({ code: "not_granted", message: "That passkey didn't work here. Try another way." });
    let challenge = ""; try { challenge = JSON.parse(Buffer.from(String(resp?.response?.clientDataJSON || ""), "base64url").toString("utf8")).challenge || ""; } catch {}
    if (!challenge || !take("system/pkauth-" + h40(challenge))) return res.status(400).json({ code: "expired", message: "That took too long. Try again." });
    const p = resp?.id ? store.get(pkPath(String(resp.id)))?.data : null; if (!p) return fail();
    try {
      const v = await (await WA()).verifyAuthenticationResponse({ response: resp, expectedChallenge: challenge, expectedOrigin: origins(req), expectedRPID: rpID(req), credential: { id: p.credId, publicKey: Buffer.from(p.publicKey, "base64url"), counter: p.counter || 0, transports: p.transports }, requireUserVerification: false });
      if (!v.verified) return fail();
      const acct = accountFor(p.email); if (!acct) { store.delete(pkPath(p.credId)); return fail(); }
      store.set(pkPath(p.credId), { ...p, counter: v.authenticationInfo.newCounter, lastUsedAt: Date.now() });
      answer(res, finish(req, res, { provider: "passkey", sub: p.credId, account: acct.email, email: acct.email, emailVerified: false, name: "" }, { next: req.body?.next }));
    } catch (e) { console.warn("[signin] passkey sign-in failed:", e.message); fail(); }
  });

  // ---------- the pages ----------
  const page = (req, res) => sendStatic(res, "signin.html");
  return { page };
}
