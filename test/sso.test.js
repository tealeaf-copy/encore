import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { generateKeyPairSync, sign as cryptoSign, createHash } from "node:crypto";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { privateAddress, checkUrl, _resetJwksCache } from "../server/sso.js";

// A local OpenID provider: discovery, JWKS, authorize (records the request) and token.
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const idp = { claims: {}, alg: "RS256", signWith: null, lastAuth: null, lastToken: null, codes: new Map(), authMethods: ["client_secret_post"] };
let IDP, idpServer, srv, owner;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function idToken(claims, alg = idp.alg) {
  const header = { alg, kid: alg === "RS256" ? "rsa1" : "ec1", typ: "JWT" }, data = b64(header) + "." + b64(claims);
  const key = idp.signWith || (alg === "RS256" ? rsa.privateKey : ec.privateKey);
  const sig = alg === "RS256" ? cryptoSign("sha256", Buffer.from(data), key) : cryptoSign("sha256", Buffer.from(data), { key, dsaEncoding: "ieee-p1363" });
  return data + "." + sig.toString("base64url");
}
before(async () => {
  const a = express();
  a.use(express.urlencoded({ extended: false }));
  a.get("/.well-known/openid-configuration", (req, res) => res.json({ issuer: IDP, authorization_endpoint: IDP + "/authorize", token_endpoint: IDP + "/token", jwks_uri: IDP + "/jwks", token_endpoint_auth_methods_supported: idp.authMethods }));
  a.get("/bad/.well-known/openid-configuration", (req, res) => res.json({ issuer: IDP + "/bad", authorization_endpoint: IDP + "/authorize" }));
  a.get("/jwks", (req, res) => res.json({ keys: [{ ...rsa.publicKey.export({ format: "jwk" }), kid: "rsa1", use: "sig", alg: "RS256" }, { ...ec.publicKey.export({ format: "jwk" }), kid: "ec1", use: "sig" }] }));
  a.get("/authorize", (req, res) => { idp.lastAuth = req.query; const code = "code-" + Math.random().toString(36).slice(2); idp.codes.set(code, req.query); res.redirect(`${req.query.redirect_uri}?code=${code}&state=${req.query.state}`); });
  a.post("/token", (req, res) => {
    idp.lastToken = { body: req.body, auth: req.get("authorization") };
    const q = idp.codes.get(req.body.code);
    const secretOk = req.body.client_secret === "idp-secret" || req.get("authorization") === "Basic " + Buffer.from("encore-app:idp-secret").toString("base64");
    if (!q || !secretOk) return res.status(400).json({ error: "invalid_grant" });
    if (createHash("sha256").update(req.body.code_verifier || "").digest("base64url") !== q.code_challenge) return res.status(400).json({ error: "invalid_grant", error_description: "PKCE failed" });
    const now = Math.floor(Date.now() / 1000);
    res.json({ id_token: idToken({ iss: IDP, aud: "encore-app", sub: "u1", exp: now + 300, iat: now, nonce: q.nonce, email: q.login_hint, email_verified: true, name: "Pat Ito", ...idp.claims }), access_token: "at" });
  });
  idpServer = await new Promise((r) => { const s = a.listen(0, "127.0.0.1", () => r(s)); });
  IDP = `http://127.0.0.1:${idpServer.address().port}`;
  srv = await startServer();
});
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_SSO_ALLOW_LOCAL"]) delete process.env[k]; idpServer.closeAllConnections?.(); await new Promise((r) => idpServer.close(r)); await srv.close(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "sso-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; process.env.ENCORE_SSO_ALLOW_LOCAL = "1"; resetLoginLimits(); idp.claims = {}; idp.alg = "RS256"; idp.signWith = null; idp.authMethods = ["client_secret_post"]; _resetJwksCache(); });

const J = { "Content-Type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (path, cookie) => fetch(srv.base + path, { headers: cookie ? { cookie } : {}, redirect: "manual" });
const cookieOf = (r, name) => (r.headers.getSetCookie?.() || [r.headers.get("set-cookie")]).map((c) => c.split(";")[0]).find((c) => c.startsWith(name + "="));
/** Run the whole browser flow for an email; returns the final callback response. */
async function ssoLogin(email) {
  const start = await get("/sso/start?email=" + encodeURIComponent(email));
  if (start.status !== 302) return start;
  const state = cookieOf(start, "encore_sso");
  const auth = await fetch(start.headers.get("location"), { redirect: "manual" }); // the IdP "signs the user in" and redirects back
  const cb = new URL(auth.headers.get("location"));
  return fetch(srv.base + cb.pathname + cb.search, { headers: { cookie: state }, redirect: "manual" });
}
const configure = (body, cookie = owner.cookie) => post("/api/sso", { issuer: IDP, clientId: "encore-app", clientSecret: "idp-secret", domain: "acme.com", ...body }, cookie);

test("owner sets up SSO: discovery is checked, the secret is stored encrypted", async () => {
  const r = await post("/api/signup", { name: "Olga Owner", email: "olga@acme.com", company: "Acme", password: "owner-password" });
  owner = { cookie: cookieOf(r, "encore_auth"), ws: (await r.json()).workspace.id };
  assert.deepEqual(await (await get("/api/sso", owner.cookie)).json(), { configured: false, redirectUri: srv.base + "/sso/callback" });
  assert.equal((await configure({ domain: "gmail.com" })).status, 400, "public mail domains can't be claimed");
  assert.equal((await configure({ domain: "other.com" })).status, 400, "only the owner's own domain");
  assert.equal((await configure({ issuer: IDP + "/bad" })).status, 400, "discovery must have token_endpoint and jwks_uri");
  assert.equal((await configure({ clientSecret: "" })).status, 400);
  const ok = await configure({ enforce: false });
  assert.equal(ok.status, 200, await ok.clone().text());
  const view = await (await get("/api/sso", owner.cookie)).json();
  assert.deepEqual(view, { configured: true, issuer: IDP, domain: "acme.com", enforce: false, configuredBy: "olga@acme.com", redirectUri: srv.base + "/sso/callback" });
  assert.equal(JSON.stringify(srv.store.get(`system/sso-${owner.ws}`).data).includes("idp-secret"), false);
  assert.equal((await get(`/api/db/doc?path=system/sso-${owner.ws}`, owner.cookie)).status, 403);
  // another workspace can't take the domain
  const r2 = await post("/api/signup", { name: "Eve", email: "eve@acme.com", company: "Acme Shadow", password: "eve-password-1" });
  assert.equal((await configure({}, cookieOf(r2, "encore_auth"))).status, 409);
});

test("SSO sign-in: PKCE + state + nonce, verified ID token, member created on first login", async () => {
  const start = await get("/sso/start?email=pat@acme.com");
  assert.equal(start.status, 302);
  const loc = new URL(start.headers.get("location"));
  assert.equal(loc.origin + loc.pathname, IDP + "/authorize");
  for (const k of ["state", "nonce", "code_challenge"]) assert.ok(loc.searchParams.get(k), k);
  assert.equal(loc.searchParams.get("code_challenge_method"), "S256");
  assert.equal(loc.searchParams.get("redirect_uri"), srv.base + "/sso/callback");
  assert.equal(loc.searchParams.get("scope"), "openid email profile");
  assert.match(start.headers.get("set-cookie"), /encore_sso=.*HttpOnly.*Max-Age=600/);
  const cb = await ssoLogin("pat@acme.com");
  assert.equal(cb.status, 302, await cb.clone().text());
  assert.equal(cb.headers.get("location"), "/");
  assert.ok(idp.lastToken.body.code_verifier, "PKCE verifier sent");
  const sess = cookieOf(cb, "encore_auth");
  const me = await (await get("/api/me", sess)).json();
  assert.equal(me.email, "pat@acme.com");
  assert.equal(me.name, "Pat Ito");
  assert.deepEqual(me.roles, ["Team member"]);
  assert.equal(me.workspace.id, owner.ws);
  assert.equal((await post("/api/login", { email: "pat@acme.com", password: "anything-at-all" })).status, 401, "SSO-only accounts have no password");
  // second login: same member
  const again = await ssoLogin("pat@acme.com");
  assert.equal(again.status, 302);
  assert.equal((await (await get("/api/workspace", owner.cookie)).json()).members.filter((m) => m.email === "pat@acme.com").length, 1);
  // ES256 tokens and client_secret_basic work too
  idp.alg = "ES256"; idp.authMethods = ["client_secret_basic"];
  await configure({});
  const es = await ssoLogin("pat@acme.com");
  assert.equal(es.status, 302);
  assert.match(idp.lastToken.auth, /^Basic /);
  assert.equal(idp.lastToken.body.client_secret, undefined);
});

test("SSO rejects bad tokens and mismatched requests", async () => {
  const fails = async (setup, why) => { setup(); const r = await ssoLogin("kim@acme.com"); assert.equal(r.status >= 400, true, why); assert.equal(cookieOf(r, "encore_auth"), undefined, why); idp.claims = {}; idp.signWith = null; _resetJwksCache(); return r; };
  await fails(() => { idp.signWith = other.privateKey; }, "signature from an unknown key");
  await fails(() => { idp.claims = { iss: "https://evil.example" }; }, "wrong issuer");
  await fails(() => { idp.claims = { aud: "someone-else" }; }, "wrong audience");
  await fails(() => { idp.claims = { exp: Math.floor(Date.now() / 1000) - 3600 }; }, "expired");
  await fails(() => { idp.claims = { nonce: "replayed" }; }, "nonce mismatch");
  await fails(() => { idp.claims = { email_verified: false }; }, "unverified email");
  const r = await fails(() => { idp.claims = { email: "kim@evil.com" }; }, "email outside the domain");
  assert.match(await r.text(), /for @acme\.com addresses/);
  // email_verified omitted but the domain matches: accepted
  idp.claims = { email_verified: undefined };
  assert.equal((await ssoLogin("lee@acme.com")).status, 302);
  idp.claims = {};
  // state mismatch / no cookie
  const start = await get("/sso/start?email=kim@acme.com");
  const auth = await fetch(start.headers.get("location"), { redirect: "manual" });
  const cb = new URL(auth.headers.get("location"));
  assert.equal((await fetch(srv.base + cb.pathname + cb.search, { redirect: "manual" })).status, 400, "no state cookie");
  cb.searchParams.set("state", "forged");
  assert.equal((await fetch(srv.base + cb.pathname + cb.search, { headers: { cookie: cookieOf(start, "encore_sso") }, redirect: "manual" })).status, 400, "state mismatch");
  assert.equal((await fetch(srv.base + "/sso/callback?error=access_denied", { redirect: "manual" })).status, 400);
  // unknown domain
  assert.equal((await get("/sso/start?email=x@unknown.com")).status, 404);
  assert.match(await (await get("/sso/start")).text(), /Work email/);
});

test("enforced SSO turns off password sign-in for the domain, except the owner's break-glass", async () => {
  await post("/api/invite", { email: "sam@acme.com", role: "CFO" }, owner.cookie).then(async (r) => { const { token } = await r.json(); await post("/api/join", { token, name: "Sam", password: "sam-password-1" }); });
  assert.equal((await post("/api/login", { email: "sam@acme.com", password: "sam-password-1" })).status, 200, "not enforced yet");
  await configure({ enforce: true });
  const r = await post("/api/login", { email: "sam@acme.com", password: "sam-password-1" });
  assert.equal(r.status, 401);
  const j = await r.json();
  assert.equal(j.code, "sso_required");
  assert.equal(j.sso, "/sso/start?email=sam%40acme.com");
  const form = await fetch(srv.base + "/api/login", { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "email=sam%40acme.com&password=sam-password-1" });
  assert.equal(form.headers.get("location"), "/login?error=4");
  assert.equal((await post("/api/login", { email: "olga@acme.com", password: "owner-password" })).status, 200, "the owner who set it up keeps a password");
  assert.equal((await ssoLogin("sam@acme.com")).status, 302, "SSO still works for Sam");
  assert.match(await (await get("/login")).text(), /href="\/sso\/start"/);
  // members can't change SSO; owner can turn it off
  const sam = cookieOf(await ssoLogin("sam@acme.com"), "encore_auth");
  assert.equal((await get("/api/sso", sam)).status, 403);
  assert.equal((await (await fetch(srv.base + "/api/sso", { method: "DELETE", headers: { cookie: owner.cookie } })).json()).removed, true);
  assert.equal((await post("/api/login", { email: "sam@acme.com", password: "sam-password-1" })).status, 200);
  assert.equal((await get("/sso/start?email=sam@acme.com")).status, 404);
});

test("IdP URLs must be https and public", async () => {
  delete process.env.ENCORE_SSO_ALLOW_LOCAL;
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) assert.equal(privateAddress(ip), true, ip);
  for (const ip of ["8.8.8.8", "140.82.112.3", "2606:4700::1111"]) assert.equal(privateAddress(ip), false, ip);
  await assert.rejects(checkUrl("http://login.example.com"), /https/);
  await assert.rejects(checkUrl("https://169.254.169.254/latest"), /private/);
  await assert.rejects(checkUrl("https://user:pw@login.example.com"), /credentials/);
  const r = await configure({ issuer: IDP });
  assert.equal(r.status, 400, "a local http issuer is refused without the test switch");
});
