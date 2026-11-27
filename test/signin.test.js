// The one sign-in screen (server/signin.js, public/signin.html): Apple, Google, passkeys and email codes, with the
// invite code first for new people when hosting is invite-only.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { fakeOutbox } from "../server/email.js";
import { verifyIdToken, signJwt, appleClientSecret, fakeRevocations } from "../server/signin.js";

const ENV = { ENCORE_SIGNUP: "1", ENCORE_INVITE_ONLY: "1", ENCORE_FOUNDER_CODES: "FOUNDERS1", ENCORE_FOUNDER_PER_IP: "100", ENCORE_FOUNDER_PER_DAY: "100", SESSION_SECRET: "signin-secret-0123456789", ENCORE_SIGNUP_PER_HOUR: "500", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_OAUTH: "1" };
let srv;
before(async () => { Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer(); });
beforeEach(() => { Object.assign(process.env, ENV); });
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

// ---- a tiny cookie jar ----
function jar() {
  const c = new Map();
  const take = (r) => { for (const s of r.headers.getSetCookie?.() || []) { const [kv, ...attrs] = s.split(";"), i = kv.indexOf("="), k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim(); if (!v || /max-age=0\b/i.test(attrs.join(";"))) c.delete(k); else c.set(k, v); } return r; };
  const header = () => [...c].map(([k, v]) => `${k}=${v}`).join("; ");
  return { c, take, header,
    get: (p) => fetch(srv.base + p, { redirect: "manual", headers: { cookie: header() } }).then(take),
    post: (p, body) => fetch(srv.base + p, { method: "POST", redirect: "manual", headers: { cookie: header(), "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }).then(take),
    form: (p, body) => fetch(srv.base + p, { method: "POST", redirect: "manual", headers: { cookie: header(), "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) }).then(take) };
}
const me = async (J) => { const r = await J.get("/api/me"); return r.ok ? r.json() : null; };
/** Walk a fake OAuth round trip: start, the test provider's page, the callback. Returns the callback's redirect. */
async function oauth(J, provider, { email, name = "", verified = true, dropJoinCookie = false, next = "" } = {}) {
  const s = await J.get(`/auth/${provider}/start${next ? "?next=" + encodeURIComponent(next) : ""}`); assert.equal(s.status, 302);
  const u = new URL(s.headers.get("location"), srv.base); assert.equal(u.pathname, `/auth/fake/${provider}`);
  const q = Object.fromEntries(u.searchParams);
  if (provider === "google") { assert.equal(q.code_challenge_method, "S256", "PKCE for Google"); assert.ok(q.code_challenge); }
  assert.ok(q.state && q.nonce, "state and nonce");
  if (dropJoinCookie) J.c.delete("pl_join");
  const a = await J.form(`/auth/fake/${provider}`, { ...q, email, name, ...(verified ? { verified: "1" } : {}) }); assert.equal(a.status, 303);
  const cb = new URL(a.headers.get("location"));
  const done = await J.get(cb.pathname + cb.search); assert.equal(done.status, 303);
  return done.headers.get("location");
}
const lastCode = (email) => { const m = [...fakeOutbox].reverse().find((x) => [].concat(x.to).includes(email)); return m && /code is (\d{6})/.exec(m.text)?.[1]; };
const otpPath = (email) => "system/otp-" + crypto.createHash("sha256").update("otp:" + email).digest("hex").slice(0, 40);
let hostCodeN = 0;
/** A host with a password account (made by /api/signup with the founder code), and one of their invite codes. */
async function host(name = "Maya Host") {
  const J = jar(), email = `host${++hostCodeN}-${Date.now()}@example.com`;
  const r = await J.post("/api/signup", { name, email, password: "a-good-password-1", code: "FOUNDERS1" }); assert.equal(r.status, 200, await r.clone().text());
  const codes = await (await J.get("/api/codes")).json();
  return { J, email, code: codes.codes.find((c) => !c.used).code };
}

test("unconfigured providers are hidden, and their start routes go nowhere", async () => {
  delete process.env.ENCORE_FAKE_OAUTH; delete process.env.ENCORE_FAKE_EMAIL;
  for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "ENCORE_GOOGLE_CLIENT_ID", "ENCORE_APPLE_SERVICES_ID"]) delete process.env[k];
  try {
    let c = await (await fetch(srv.base + "/api/auth/config")).json();
    assert.deepEqual([c.providers.apple, c.providers.google, c.providers.email], [false, false, false]);
    assert.equal(c.providers.passkey, true, "passkeys need no keys");
    assert.equal((await fetch(srv.base + "/auth/apple/start", { redirect: "manual" })).headers.get("location"), "/login");
    // the Google keys the calendar already uses also turn on Google sign-in; Apple needs all four of its settings
    process.env.GOOGLE_CLIENT_ID = "g-id"; process.env.GOOGLE_CLIENT_SECRET = "g-secret"; process.env.ENCORE_APPLE_SERVICES_ID = "com.example.web";
    c = await (await fetch(srv.base + "/api/auth/config")).json();
    assert.equal(c.providers.google, true); assert.equal(c.providers.apple, false, "a Services ID alone isn't enough");
    const s = await fetch(srv.base + "/auth/google/start", { redirect: "manual" }), u = new URL(s.headers.get("location"));
    assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(u.searchParams.get("scope"), "openid email profile", "sign-in asks for these scopes only");
    assert.equal(u.searchParams.get("code_challenge_method"), "S256");
    assert.ok(u.searchParams.get("nonce") && u.searchParams.get("state"));
    // the page reads the config and shows only what's on
    const page = await (await fetch(srv.base + "/login")).text();
    assert.match(page, /class="prov apple" data-p="apple" hidden/); assert.match(page, /\/api\/auth\/config/);
  } finally { for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "ENCORE_APPLE_SERVICES_ID"]) delete process.env[k]; Object.assign(process.env, ENV); }
  const c = await (await fetch(srv.base + "/api/auth/config")).json();
  assert.deepEqual([c.providers.apple, c.providers.google, c.providers.email], [true, true, true], "the test providers");
});

test("a new Google identity needs an invite code; the code survives the OAuth round trip", async () => {
  const H = await host();
  // no code: not created, back to the code step with the kind message
  const J0 = jar(), to0 = await oauth(J0, "google", { email: "nocode@example.com", name: "No Code" });
  assert.equal(to0, "/signup?why=invite"); assert.equal(await me(J0), null);
  const page = await (await fetch(srv.base + "/signup?why=invite")).text(); assert.match(page, /Pottery Lab is invite-only for now\. Enter the code a friend sent you\./); assert.match(page, /No code\? Join the waitlist/);
  // a bad code is refused at the code step
  const J = jar(); assert.equal((await J.post("/api/auth/join", { code: "NOPE-NOPE" })).status, 403);
  const ok = await J.post("/api/auth/join", { code: H.code.toLowerCase().replace("-", " ") }); assert.equal(ok.status, 200); assert.equal((await ok.json()).from, "Maya", "who invited you");
  assert.equal((await (await J.get("/api/auth/config")).json()).held.from, "Maya");
  // the join cookie is gone by the callback (another tab, a cleared cookie): the OAuth state carried the code
  const to = await oauth(J, "google", { email: "Gia@Example.com", name: "Gia Rossi", dropJoinCookie: true });
  assert.match(to, /^\/(feed)?\?welcome=1/);
  const m = await me(J); assert.equal(m.email, "gia@example.com"); assert.equal(m.name, "Gia Rossi"); assert.equal(m.emailVerified, true, "Google proved the email");
  assert.equal((await (await fetch(srv.base + "/api/codes/" + H.code)).json()).valid, false, "the code is used up");
  assert.ok(!(await srv.store.get("system/u-" + crypto.createHash("sha256").update("gia@example.com").digest("hex").slice(0, 40)))?.data?.pw, "no password on a passwordless account");
});

test("an unverified social email never makes or links an account", async () => {
  const J = jar(); await J.post("/api/auth/join", { code: "FOUNDERS1" });
  const to = await oauth(J, "google", { email: "unverified@example.com", name: "U", verified: false });
  assert.equal(to, "/login?error=oauth&why=no_email"); assert.equal(await me(J), null);
});

test("existing accounts skip the code: social sign-in links by verified email, and email codes sign in", async () => {
  const H = await host("Ola Existing");
  // Google with the same, verified email: signed in to the existing account, no invite asked
  const J = jar(), to = await oauth(J, "google", { email: H.email, name: "Someone Else", next: "/settings" });
  assert.equal(to, "/settings", "back where they were headed");
  const m = await me(J); assert.equal(m.email, H.email); assert.equal(m.name, "Ola Existing", "the account keeps its name");
  // Apple with the same email links too: one account, two identities
  const J2 = jar(); await oauth(J2, "apple", { email: H.email, name: "Ola" }); assert.equal((await me(J2)).email, H.email);
  const ids = (await (await J2.get("/api/passkeys")).json()).identities.map((x) => x.provider).sort(); assert.deepEqual(ids, ["apple", "google"]);
  // next time, the Google identity is found by its subject even if the email there changed
  // an email code, no invite
  const J3 = jar(); assert.equal((await J3.post("/api/auth/email/start", { email: H.email })).status, 200);
  const r = await J3.post("/api/auth/email/verify", { email: H.email, code: lastCode(H.email) }); const j = await r.json();
  assert.equal(j.ok, true); assert.equal((await me(J3)).email, H.email);
  // password sign-in still works for this account
  assert.equal((await fetch(srv.base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: H.email, password: "a-good-password-1" }) })).status, 200);
  // Apple's private relay address is its own identity: with no account behind it, it's a new person (who needs a code)
  const J4 = jar(); assert.equal(await oauth(J4, "apple", { email: "x7k2@privaterelay.appleid.com" }), "/signup?why=invite");
});

test("a new email account needs a code, then a name; email codes expire, allow 5 tries and don't tell who has an account", async () => {
  const H = await host();
  // no enumeration: the same answer for an address with an account and one without
  const a = await jar().post("/api/auth/email/start", { email: H.email }), b = await jar().post("/api/auth/email/start", { email: "nobody-here@example.com" });
  assert.equal(a.status, b.status); const [ja, jb] = [await a.json(), await b.json()];
  assert.deepEqual(Object.keys(ja), Object.keys(jb)); assert.equal(ja.ok, true); assert.equal(jb.ok, true);
  assert.equal(ja.message.replace(H.email, "X"), jb.message.replace("nobody-here@example.com", "X"));
  // a new address with no invite: the code works, but no account is made; the code step says so kindly
  const N = jar(), nv = await N.post("/api/auth/email/verify", { email: "nobody-here@example.com", code: lastCode("nobody-here@example.com") });
  const nj = await nv.json(); assert.equal(nj.need, "invite"); assert.match(nj.message, /You'll need an invite to join for now/); assert.equal(await me(N), null);
  // with a code: the email code, then a name, then in
  const J = jar(); await J.post("/api/auth/join", { code: H.code });
  await J.post("/api/auth/email/start", { email: "kai@example.com" });
  const v = await (await J.post("/api/auth/email/verify", { email: "kai@example.com", code: lastCode("kai@example.com") })).json();
  assert.equal(v.need, "name"); assert.equal((await (await J.get("/api/auth/pending")).json()).email, "kai@example.com");
  const f = await (await J.post("/api/auth/finish", { name: "Kai Moana" })).json(); assert.equal(f.ok, true); assert.match(f.redirect, /welcome=1/);
  const m = await me(J); assert.equal(m.name, "Kai Moana"); assert.equal(m.emailVerified, true);
  // a new account that was headed somewhere (a dinner drafted on /start) lands there, not on the welcome screen
  const D = jar(); await D.post("/api/auth/join", { code: (await (await H.J.get("/api/codes")).json()).codes.find((c) => !c.used).code }); await D.post("/api/auth/email/start", { email: "dee@example.com", next: "/start?save=1" });
  await D.post("/api/auth/email/verify", { email: "dee@example.com", code: lastCode("dee@example.com") });
  assert.equal((await (await D.post("/api/auth/finish", { name: "Dee Park" })).json()).redirect, "/start?save=1");
  // 5 tries per code: four wrong, the fifth wrong ends it, and then even the right code fails
  const T = jar(); await T.post("/api/auth/email/start", { email: "tries@example.com" }); const good = lastCode("tries@example.com"), bad = good === "000000" ? "111111" : "000000";
  for (let i = 1; i <= 4; i++) { const r = await T.post("/api/auth/email/verify", { email: "tries@example.com", code: bad }); assert.equal(r.status, 400); assert.match((await r.json()).message, new RegExp(`${5 - i} tr`)); }
  const fifth = await T.post("/api/auth/email/verify", { email: "tries@example.com", code: bad }); assert.equal(fifth.status, 429); assert.equal((await fifth.json()).code, "too_many");
  assert.equal((await T.post("/api/auth/email/verify", { email: "tries@example.com", code: good })).status, 400, "the code is gone");
  // codes expire after 10 minutes
  await T.post("/api/auth/email/start", { email: "late@example.com" }); const rec = srv.store.get(otpPath("late@example.com")).data;
  assert.ok(rec.exp - Date.now() <= 10 * 60e3 && rec.exp - Date.now() > 9 * 60e3, "10 minutes");
  assert.ok(!JSON.stringify(rec).includes(lastCode("late@example.com")), "only a hash is stored");
  srv.store.set(otpPath("late@example.com"), { ...rec, exp: Date.now() - 1 });
  const late = await T.post("/api/auth/email/verify", { email: "late@example.com", code: lastCode("late@example.com") }); assert.equal(late.status, 400); assert.equal((await late.json()).code, "expired");
  // sends are rate limited per address (5 an hour)
  let last; for (let i = 0; i < 6; i++) last = await jar().post("/api/auth/email/start", { email: "spam@example.com" }); assert.equal(last.status, 429);
});

test("the magic link in the email signs in after one tap, once", async () => {
  const H = await host(); const J = jar(); await J.post("/api/auth/email/start", { email: H.email });
  const mail = [...fakeOutbox].reverse().find((x) => [].concat(x.to).includes(H.email)); const link = /(https?:\/\/\S+\/auth\/email\?t=\S+)/.exec(mail.text)[1];
  const u = new URL(link); const pg = await J.get(u.pathname + u.search); assert.equal(pg.status, 200, "a page with a button, so a mail scanner doesn't use the link");
  const r = await (await J.post("/api/auth/email/link", { t: u.searchParams.get("t") })).json(); assert.equal(r.ok, true); assert.equal((await me(J)).email, H.email);
  assert.equal((await jar().post("/api/auth/email/link", { t: u.searchParams.get("t") })).status, 400, "once");
});

test("/join?code= prefills the code step, /login has the password and SSO fallbacks", async () => {
  const H = await host(); const r = await fetch(srv.base + "/join?code=" + H.code, { redirect: "manual" }); assert.equal(r.headers.get("location"), "/signup?code=" + H.code);
  const page = await (await fetch(srv.base + "/signup?code=" + H.code)).text(); assert.match(page, /if \(code\) \{ \$\("codeIn"\)\.value = code\.toUpperCase\(\); show\("start"\); return sendInvite\(code, true\); \}/);
  const login = await (await fetch(srv.base + "/login")).text();
  for (const re of [/Welcome in/, /Sign in or join with your email or phone number\./, /<label for="idIn">Email or phone number<\/label>/, /Continue with Apple/, /Continue with Google/, /Continue with a passkey/, /Use a password instead/, /type="password"/, /href="\/sso\/start"/,/By continuing, you agree to the <a href="\/terms">Terms<\/a> and <a href="\/privacy">Privacy Policy<\/a>\./]) assert.match(login, re);
  assert.doesNotMatch(login, /—/, "no em dashes");
  // brands and prepared storefronts keep the longer form
  assert.match(await (await fetch(srv.base + "/signup?mode=work")).text(), /Start your free trial|\/api\/signup/);
});

// ---------- id_tokens ----------
test("id_token checks: signature against the JWKS, iss, aud, exp and nonce", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }), other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwks = { keys: [{ ...publicKey.export({ format: "jwk" }), kid: "apple-k1", alg: "RS256" }] }, now = Math.floor(Date.now() / 1000);
  const base = { iss: "https://appleid.apple.com", aud: "com.potterylab.web", sub: "001.abc", email: "a@privaterelay.appleid.com", email_verified: "true", iat: now, exp: now + 600, nonce: "n-123" };
  const opts = { jwks, iss: ["https://appleid.apple.com"], aud: "com.potterylab.web", nonce: "n-123" };
  assert.equal(verifyIdToken(signJwt(base, privateKey, "apple-k1"), opts).sub, "001.abc");
  const bad = (claims, o = {}, key = privateKey, kid = "apple-k1") => assert.throws(() => verifyIdToken(signJwt({ ...base, ...claims }, key, kid), { ...opts, ...o }), { code: "bad_token" });
  bad({ aud: "someone.else" }); bad({ iss: "https://evil.example" }); bad({ exp: now - 3600 }); bad({ nonce: "other" }); bad({}, {}, other.privateKey); bad({}, {}, privateKey, "unknown-kid"); bad({ iat: now + 3600 });
  // the native sheet sends the SHA-256 of the nonce
  assert.equal(verifyIdToken(signJwt({ ...base, nonce: crypto.createHash("sha256").update("n-123").digest("hex") }, privateKey, "apple-k1"), opts).sub, "001.abc");
  // alg "none" and a tampered body fail
  const t = signJwt(base, privateKey, "apple-k1").split(".");
  const none = Buffer.from(JSON.stringify({ alg: "none", kid: "apple-k1" })).toString("base64url") + "." + t[1] + ".";
  assert.throws(() => verifyIdToken(none, opts), { code: "bad_token" });
  const forged = t[0] + "." + Buffer.from(JSON.stringify({ ...base, sub: "001.victim" })).toString("base64url") + "." + t[2];
  assert.throws(() => verifyIdToken(forged, opts), { code: "bad_token" });
  // Apple's client secret is an ES256 JWT signed with the .p8 key
  const ec = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const cs = appleClientSecret({ team: "TEAM123456", keyId: "KEY1234567", key: ec.privateKey.export({ type: "pkcs8", format: "pem" }), servicesId: "com.potterylab.web" }).split(".");
  const claims = JSON.parse(Buffer.from(cs[1], "base64url")); assert.deepEqual([claims.iss, claims.sub, claims.aud], ["TEAM123456", "com.potterylab.web", "https://appleid.apple.com"]);
  assert.equal(JSON.parse(Buffer.from(cs[0], "base64url")).kid, "KEY1234567");
  assert.ok(crypto.verify("sha256", Buffer.from(cs[0] + "." + cs[1]), { key: ec.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(cs[2], "base64url")));
});

test("native Sign in with Apple: a one-time nonce, the bundle id as audience", async () => {
  const H = await host(), J = jar();
  const { nonce } = await (await J.get("/api/auth/nonce")).json();
  const tok = srv.app.locals.fakeIdToken("apple", { aud: "fake.apple.bundle", sub: "001.native", email: H.email, email_verified: "true", nonce: crypto.createHash("sha256").update(nonce).digest("hex") });
  const r = await J.post("/api/auth/apple/native", { idToken: tok, nonce, authorizationCode: "c1" }); assert.equal(r.status, 200); assert.equal((await r.json()).ok, true);
  assert.equal((await me(J)).email, H.email);
  assert.equal((await jar().post("/api/auth/apple/native", { idToken: tok, nonce })).status, 400, "a nonce works once");
  const { nonce: n2 } = await (await J.get("/api/auth/nonce")).json();
  const wrongAud = srv.app.locals.fakeIdToken("apple", { aud: "com.other.app", sub: "001.native", email: H.email, email_verified: "true", nonce: n2 });
  assert.equal((await jar().post("/api/auth/apple/native", { idToken: wrongAud, nonce: n2 })).status, 401);
});

// ---------- passkeys: a software authenticator (P-256, "none" attestation) ----------
function cbor(v) {
  const head = (t, n) => (n < 24 ? Buffer.from([(t << 5) | n]) : n < 256 ? Buffer.from([(t << 5) | 24, n]) : Buffer.from([(t << 5) | 25, n >> 8, n & 255]));
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  const e = v instanceof Map ? [...v] : Object.entries(v); return Buffer.concat([head(5, e.length), ...e.flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}
function authenticator(rpId, origin) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }), jwk = publicKey.export({ format: "jwk" });
  const credId = crypto.randomBytes(16), rpHash = crypto.createHash("sha256").update(rpId).digest(), b64 = (b) => Buffer.from(b).toString("base64url");
  let count = 0;
  const cd = (type, challenge) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  return {
    id: b64(credId),
    create(challenge) {
      const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]));
      const len = Buffer.alloc(2); len.writeUInt16BE(credId.length);
      const authData = Buffer.concat([rpHash, Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), len, credId, cose]);
      return { id: b64(credId), rawId: b64(credId), type: "public-key", clientExtensionResults: {}, response: { clientDataJSON: b64(cd("webauthn.create", challenge)), attestationObject: b64(cbor({ fmt: "none", attStmt: {}, authData })), transports: ["internal"] } };
    },
    get(challenge, { counter = ++count } = {}) {
      const c = Buffer.alloc(4); c.writeUInt32BE(counter); const authData = Buffer.concat([rpHash, Buffer.from([0x05]), c]), clientData = cd("webauthn.get", challenge);
      const sig = crypto.sign("sha256", Buffer.concat([authData, crypto.createHash("sha256").update(clientData).digest()]), privateKey);
      return { id: b64(credId), rawId: b64(credId), type: "public-key", clientExtensionResults: {}, response: { clientDataJSON: b64(clientData), authenticatorData: b64(authData), signature: b64(sig) } };
    },
  };
}

test("passkeys: add one in Settings after signing in, then sign in with it; deletion removes identities and passkeys and revokes Apple", async () => {
  // a person who joined with Apple
  const H = await host(), J = jar(); await J.post("/api/auth/join", { code: H.code });
  assert.match(await oauth(J, "apple", { email: "pia@example.com", name: "Pia Lund" }), /welcome=1/);
  assert.equal((await J.post("/api/passkeys/register/options")).status, 200);
  assert.equal((await jar().post("/api/passkeys/register/options")).status, 401, "signed in only");
  // register
  const o = await (await J.post("/api/passkeys/register/options")).json(); assert.equal(o.authenticatorSelection.residentKey, "required");
  const A = authenticator(o.rp.id, srv.base);
  const reg = await J.post("/api/passkeys/register/verify", { response: A.create(o.challenge) }); assert.equal(reg.status, 200, await reg.clone().text());
  const list = (await (await J.get("/api/passkeys")).json()); assert.equal(list.passkeys.length, 1); assert.deepEqual(list.identities.map((x) => x.provider), ["apple"]); assert.equal(list.password, false);
  // a challenge works once
  assert.equal((await J.post("/api/passkeys/register/verify", { response: A.create(o.challenge) })).status, 400);
  // sign in with it, from a fresh browser
  const P = jar(), ao = await (await P.post("/api/auth/passkey/options")).json();
  const v = await P.post("/api/auth/passkey/verify", { response: A.get(ao.challenge) }); assert.equal(v.status, 200, await v.clone().text()); assert.equal((await v.json()).ok, true);
  assert.equal((await me(P)).email, "pia@example.com");
  // a replayed assertion (same challenge) and a counter that went backwards both fail
  assert.equal((await jar().post("/api/auth/passkey/verify", { response: A.get(ao.challenge) })).status, 400);
  const ao2 = await (await jar().post("/api/auth/passkey/options")).json(); assert.equal((await jar().post("/api/auth/passkey/verify", { response: A.get(ao2.challenge, { counter: 1 }) })).status, 401);
  // a passkey nobody registered
  const ao3 = await (await jar().post("/api/auth/passkey/options")).json(), stranger = authenticator(o.rp.id, srv.base);
  assert.equal((await jar().post("/api/auth/passkey/verify", { response: stranger.get(ao3.challenge) })).status, 401);
  // delete the account: identities and passkeys go, the Apple token is revoked
  const before = fakeRevocations.length;
  const d = await (await P.post("/api/me/delete", { confirm: "DELETE", when: "now" })).json(); assert.equal(d.ok, true);
  assert.equal(d.identities, 1); assert.equal(d.passkeys, 1); assert.equal(d.appleRevoked, 1);
  assert.equal(fakeRevocations.length, before + 1); assert.match(fakeRevocations.at(-1).token, /^fake-refresh-001\./);
  for (const p of ["ident-", "pk-"]) assert.equal(srv.store.listPrefix("system", p).filter((x) => x.data?.email === "pia@example.com").length, 0, p);
  const ao4 = await (await jar().post("/api/auth/passkey/options")).json(); assert.equal((await jar().post("/api/auth/passkey/verify", { response: A.get(ao4.challenge) })).status, 401, "the passkey no longer signs in");
  // the same Apple ID again is a new person: it needs an invite
  assert.equal(await oauth(jar(), "apple", { email: "pia@example.com" }), "/signup?why=invite");
});

test("the waitlist takes an email, and is rate limited", async () => {
  const codes = []; for (let i = 0; i < 6; i++) codes.push((await jar().post("/api/waitlist", { email: `wl${i}@example.com`, via: "signin" })).status);
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429]);
  assert.equal((await jar().post("/api/waitlist", { email: "not-an-email" })).status, 429, "still limited");
});
