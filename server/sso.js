// Single sign-on per workspace with OpenID Connect (Okta, Google Workspace, Microsoft Entra, OneLogin...).
// Authorization-code flow with PKCE (S256), state and nonce; the ID token is verified against the IdP's JWKS
// (RS256 / ES256) with node:crypto. Config lives encrypted in system/sso-<ws>; system/ssodom-<domain> maps an
// email domain to its workspace.
import { createHash, randomBytes, createPublicKey, verify as cryptoVerify } from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { encryptSecret, decryptSecret, getDbUser, putDbUser } from "./workspaces.js";

let raw = null;
export function useSsoStore(s) { raw = s; }
const need = () => { if (!raw) throw new Error("sso store not set"); return raw; };
const b64url = (buf) => Buffer.from(buf).toString("base64url");
const fail = (code, message, status = 400) => Object.assign(new Error(message), { code, status });

// Consumer mail domains can't be claimed: SSO would send everyone on them to one company's IdP.
const PUBLIC_DOMAINS = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.net", "yandex.com", "mail.com", "zoho.com", "hey.com", "fastmail.com"]);
export const domainOf = (email) => String(email || "").trim().toLowerCase().split("@")[1] || "";
const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

// ---------- outbound requests to the IdP: https only, never private or metadata addresses ----------
// Tests run a local IdP over http on 127.0.0.1: ENCORE_SSO_ALLOW_LOCAL=1 allows that. Never set it in production.
const allowLocal = () => process.env.ENCORE_SSO_ALLOW_LOCAL === "1";
export function privateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v); if (mapped) return privateAddress(mapped[1]);
  return /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
}
export async function checkUrl(u) {
  let url; try { url = new URL(String(u)); } catch { throw fail("invalid", "Not a valid URL: " + String(u).slice(0, 200)); }
  if (url.username || url.password) throw fail("invalid", "URLs with credentials aren't allowed.");
  if (url.protocol !== "https:" && !(allowLocal() && url.protocol === "http:")) throw fail("invalid", "The identity provider must use https.");
  if (allowLocal()) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => { throw fail("invalid", `Can't resolve ${host}.`); });
  if (!addrs.length || addrs.some((a) => privateAddress(a.address))) throw fail("invalid", `${host} points to a private address.`);
  return url;
}
async function idpFetch(u, init = {}) {
  const url = await checkUrl(u);
  let r;
  try { r = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(10_000) }); } catch { throw fail("upstream_error", `Couldn't reach ${url.host}.`, 502); }
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, ok: r.ok, json: j };
}

// ---------- config ----------
const cfgPath = (ws) => "system/sso-" + ws, domPath = (d) => "system/ssodom-" + d;
export function getSso(ws) { return need().get(cfgPath(ws))?.data || null; }
export function ssoForDomain(domain) { const d = raw?.get(domPath(domain))?.data; return d ? getSso(d.ws) : null; }
export const ssoForEmail = (email) => (raw ? ssoForDomain(domainOf(email)) : null);
/** Validate and store a workspace's SSO settings. by: the owner configuring it (kept as the password break-glass). */
export async function configureSso(ws, { issuer, clientId, clientSecret, domain, enforce }, by) {
  issuer = String(issuer || "").trim().replace(/\/+$/, ""); domain = String(domain || "").trim().toLowerCase();
  clientId = String(clientId || "").trim(); clientSecret = String(clientSecret || "").trim();
  if (!issuer || !clientId || !clientSecret || clientId.length > 500 || clientSecret.length > 2000) throw fail("invalid", "issuer, clientId and clientSecret are required.");
  if (!DOMAIN_RE.test(domain)) throw fail("invalid", "domain must be your company's email domain, like acme.com.");
  if (PUBLIC_DOMAINS.has(domain)) throw fail("invalid", `${domain} is a public email domain and can't use SSO.`);
  if (domainOf(by) !== domain) throw fail("invalid", `You can only set up SSO for your own email domain (${domainOf(by) || "none"}).`);
  const other = raw.get(domPath(domain))?.data;
  if (other && other.ws !== ws) throw fail("conflict", `${domain} already uses single sign-on with another Pottery Lab workspace.`, 409);
  const d = await idpFetch(issuer + "/.well-known/openid-configuration", { headers: { Accept: "application/json" } });
  if (!d.ok || !d.json) throw fail("invalid", `${issuer}/.well-known/openid-configuration didn't return a discovery document (HTTP ${d.status}).`);
  const disc = d.json;
  for (const k of ["authorization_endpoint", "token_endpoint", "jwks_uri"]) { if (typeof disc[k] !== "string") throw fail("invalid", `The discovery document has no ${k}.`); await checkUrl(disc[k]); }
  if (String(disc.issuer || "").replace(/\/+$/, "") !== issuer) throw fail("invalid", `The discovery document is for issuer ${disc.issuer}, not ${issuer}.`);
  const prev = getSso(ws);
  if (prev && prev.domain !== domain) need().delete(domPath(prev.domain));
  const cfg = { kind: "sso", ws, issuer: disc.issuer, clientId, secret: encryptSecret(clientSecret), domain, enforce: !!enforce, configuredBy: String(by).toLowerCase(), at: Date.now(),
    discovery: { authorization_endpoint: disc.authorization_endpoint, token_endpoint: disc.token_endpoint, jwks_uri: disc.jwks_uri, auth_methods: disc.token_endpoint_auth_methods_supported || null } };
  need().set(cfgPath(ws), cfg); need().set(domPath(domain), { ws });
  return cfg;
}
export function removeSso(ws) { const c = getSso(ws); if (!c) return false; need().delete(cfgPath(ws)); need().delete(domPath(c.domain)); return true; }
export const publicSso = (c, redirectUri) => (c ? { configured: true, issuer: c.issuer, domain: c.domain, enforce: !!c.enforce, configuredBy: c.configuredBy, redirectUri } : { configured: false, redirectUri });

// ---------- the browser flow ----------
export const redirectUriFor = (req) => `${String(process.env.ENCORE_PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "")}/sso/callback`;
/** Start: returns { url, cookie } — the IdP URL to redirect to, and the encrypted state cookie value. */
export function startSso(cfg, email, redirectUri) {
  const state = b64url(randomBytes(24)), nonce = b64url(randomBytes(24)), verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const u = new URL(cfg.discovery.authorization_endpoint);
  Object.entries({ response_type: "code", client_id: cfg.clientId, redirect_uri: redirectUri, scope: "openid email profile", state, nonce, code_challenge: challenge, code_challenge_method: "S256", login_hint: email }).forEach(([k, v]) => u.searchParams.set(k, v));
  const cookie = b64url(JSON.stringify(encryptSecret(JSON.stringify({ ws: cfg.ws, state, nonce, verifier, redirectUri, exp: Date.now() + 10 * 60_000 }))));
  return { url: u.toString(), cookie };
}
export function readState(cookieValue) {
  try { const s = JSON.parse(decryptSecret(JSON.parse(Buffer.from(String(cookieValue), "base64url").toString("utf8")))); return s && s.exp > Date.now() ? s : null; } catch { return null; }
}

const jwksCache = new Map(); // uri -> { keys, at }
async function jwks(uri, force = false) {
  const hit = jwksCache.get(uri);
  if (!force && hit && Date.now() - hit.at < 10 * 60_000) return hit.keys;
  const r = await idpFetch(uri, { headers: { Accept: "application/json" } });
  if (!r.ok || !Array.isArray(r.json?.keys)) throw fail("sso_failed", "Couldn't load the identity provider's signing keys.", 502);
  jwksCache.set(uri, { keys: r.json.keys, at: Date.now() });
  return r.json.keys;
}
export function _resetJwksCache() { jwksCache.clear(); }
/** Verify a compact JWS (RS256 / ES256) against a JWKS URI; returns the claims. */
export async function verifyIdToken(token, cfg) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw fail("sso_failed", "The ID token is malformed.");
  let header, claims;
  try { header = JSON.parse(Buffer.from(parts[0], "base64url")); claims = JSON.parse(Buffer.from(parts[1], "base64url")); } catch { throw fail("sso_failed", "The ID token is malformed."); }
  if (!["RS256", "ES256"].includes(header.alg)) throw fail("sso_failed", `Unsupported ID token algorithm ${header.alg}.`);
  const pick = (keys) => keys.filter((k) => (!header.kid || k.kid === header.kid) && (!k.use || k.use === "sig") && (header.alg === "RS256" ? k.kty === "RSA" : k.kty === "EC" && k.crv === "P-256"));
  let cand = pick(await jwks(cfg.discovery.jwks_uri));
  if (!cand.length) cand = pick(await jwks(cfg.discovery.jwks_uri, true)); // keys rotated
  const data = Buffer.from(parts[0] + "." + parts[1]), sig = Buffer.from(parts[2], "base64url");
  const ok = cand.some((jwk) => {
    try { const key = createPublicKey({ key: jwk, format: "jwk" }); return header.alg === "RS256" ? cryptoVerify("sha256", data, key, sig) : cryptoVerify("sha256", data, { key, dsaEncoding: "ieee-p1363" }, sig); } catch { return false; }
  });
  if (!ok) throw fail("sso_failed", "The ID token's signature didn't verify.");
  const now = Math.floor(Date.now() / 1000), aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (String(claims.iss || "").replace(/\/+$/, "") !== String(cfg.issuer).replace(/\/+$/, "")) throw fail("sso_failed", "The ID token is from a different issuer.");
  if (!aud.includes(cfg.clientId)) throw fail("sso_failed", "The ID token isn't for this app.");
  if (aud.length > 1 && claims.azp && claims.azp !== cfg.clientId) throw fail("sso_failed", "The ID token was issued to another app.");
  if (!(+claims.exp > now - 60)) throw fail("sso_failed", "The ID token has expired.");
  if (claims.iat && +claims.iat > now + 300) throw fail("sso_failed", "The ID token is dated in the future.");
  return claims;
}
/** Callback: exchange the code, verify the ID token; returns { ws, email, name }. */
export async function finishSso(state, { code, returnedState }) {
  if (!state) throw fail("sso_failed", "The sign-in took too long or started in another browser. Try again.");
  if (!returnedState || returnedState !== state.state) throw fail("sso_failed", "The sign-in response doesn't match this browser's request.");
  const cfg = getSso(state.ws); if (!cfg) throw fail("sso_failed", "Single sign-on isn't set up for this workspace any more.");
  const secret = decryptSecret(cfg.secret); if (!secret) throw fail("sso_failed", "The SSO settings can't be read (SESSION_SECRET changed?). Ask the owner to set SSO up again.");
  const form = { grant_type: "authorization_code", code: String(code || ""), redirect_uri: state.redirectUri, code_verifier: state.verifier, client_id: cfg.clientId };
  const headers = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  const methods = cfg.discovery.auth_methods;
  if (methods && !methods.includes("client_secret_post") && methods.includes("client_secret_basic")) headers.Authorization = "Basic " + Buffer.from(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(secret)}`).toString("base64");
  else form.client_secret = secret;
  const t = await idpFetch(cfg.discovery.token_endpoint, { method: "POST", headers, body: new URLSearchParams(form).toString() });
  if (!t.ok || !t.json?.id_token) throw fail("sso_failed", `The identity provider refused the sign-in (${t.json?.error_description || t.json?.error || "HTTP " + t.status}).`);
  const claims = await verifyIdToken(t.json.id_token, cfg);
  if (claims.nonce !== state.nonce) throw fail("sso_failed", "The ID token's nonce doesn't match this sign-in.");
  // Entra may put the address in preferred_username / upn instead of email.
  const email = String(claims.email || (String(claims.preferred_username || claims.upn || "").includes("@") ? claims.preferred_username || claims.upn : "")).trim().toLowerCase();
  if (!email) throw fail("sso_failed", "The identity provider didn't share an email address.");
  if (claims.email_verified === false || claims.email_verified === "false") throw fail("sso_failed", "Your email address isn't verified with the identity provider.");
  if (domainOf(email) !== cfg.domain) throw fail("sso_failed", `This workspace's single sign-on is for @${cfg.domain} addresses.`);
  return { ws: cfg.ws, email, name: String(claims.name || [claims.given_name, claims.family_name].filter(Boolean).join(" ") || email).slice(0, 120) };
}
/** First SSO sign-in creates the member (role "Team member", which never counts as an approver role). */
export function ensureSsoMember({ ws, email, name }, envTaken) {
  const u = getDbUser(email);
  if (u) { if (u.ws !== ws) throw fail("conflict", "That email already belongs to another Pottery Lab workspace.", 409); return u; }
  if (envTaken(email)) throw fail("conflict", "That email is already on this server's own team list.", 409);
  return putDbUser({ kind: "user", ws, name, email, roles: ["Team member"], defaultRole: true, owner: false, pw: null, sso: true, createdAt: Date.now() });
}
