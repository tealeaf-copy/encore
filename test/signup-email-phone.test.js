// Sign in and sign up with an email or a phone number (server/signin.js, server/smscode.js, public/signin.html): one
// field, a 6-digit code, then the invite code only for new people while invite-only is on.
// The per-IP send limit is shared by every test here (one process, one IP), so the IP limit test runs last.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startServer } from "./helpers.js";
import { fakeOutbox } from "../server/email.js";
import { fakeCodeTexts, toE164, maskPhone, codeSmsConfig } from "../server/smscode.js";

const ENV = { ENCORE_SIGNUP: "1", ENCORE_INVITE_ONLY: "1", ENCORE_FOUNDER_CODES: "FOUNDERS1", ENCORE_FOUNDER_PER_IP: "100", ENCORE_FOUNDER_PER_DAY: "100", SESSION_SECRET: "phone-secret-0123456789", ENCORE_SIGNUP_PER_HOUR: "500", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_SMS: "1" };
const TWILIO = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM", "ENCORE_TWILIO_SID", "ENCORE_TWILIO_TOKEN", "ENCORE_TWILIO_FROM"];
let srv;
before(async () => { for (const k of TWILIO) delete process.env[k]; Object.assign(process.env, ENV); srv = await startServer(); });
beforeEach(() => { Object.assign(process.env, ENV); });
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

function jar() {
  const c = new Map();
  const take = (r) => { for (const s of r.headers.getSetCookie?.() || []) { const [kv, ...attrs] = s.split(";"), i = kv.indexOf("="), k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim(); if (!v || /max-age=0\b/i.test(attrs.join(";"))) c.delete(k); else c.set(k, v); } return r; };
  const header = () => [...c].map(([k, v]) => `${k}=${v}`).join("; ");
  return { c, get: (p) => fetch(srv.base + p, { redirect: "manual", headers: { cookie: header() } }).then(take),
    post: (p, body) => fetch(srv.base + p, { method: "POST", redirect: "manual", headers: { cookie: header(), "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }).then(take) };
}
const me = async (J) => { const r = await J.get("/api/me"); return r.ok ? r.json() : null; };
const mailCode = (email) => { const m = [...fakeOutbox].reverse().find((x) => [].concat(x.to).includes(email)); return m && /code is (\d{6})/.exec(m.text)?.[1]; };
const textCode = (e164) => { const m = [...fakeCodeTexts].reverse().find((x) => x.to === e164); return m && /^(\d{6}) is your Pottery Lab code/.exec(m.text)?.[1]; };
const otpPath = (key) => "system/otp-" + crypto.createHash("sha256").update("otp:" + key).digest("hex").slice(0, 40);
const wrong = (good) => (good === "000000" ? "111111" : "000000");
let n = 0;
const uniq = (p) => `${p}${++n}-${Date.now()}@example.com`;
const uniqPhone = () => `(415) 555-${String(1000 + (++n % 9000)).padStart(4, "0")}`;
async function host(name = "Maya Host") {
  const J = jar(), email = uniq("host");
  const r = await J.post("/api/signup", { name, email, password: "a-good-password-1", code: "FOUNDERS1" }); assert.equal(r.status, 200, await r.clone().text());
  const codes = await (await J.get("/api/codes")).json();
  return { J, email, code: codes.codes.find((c) => !c.used).code };
}
/** Capture console output while fn runs. */
async function logsOf(fn) { const out = [], keep = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(keep)) console[k] = (...a) => out.push(a.map(String).join(" "));
  try { await fn(); } finally { Object.assign(console, keep); } return out.join("\n"); }

test("phone numbers become E.164, US by default, and logs only ever see a masked number", () => {
  for (const [i, o] of [["(415) 555-0134", "+14155550134"], ["415.555.0134", "+14155550134"], ["1 415 555 0134", "+14155550134"], ["+1 415 555 0134", "+14155550134"], ["+44 20 7946 0958", "+442079460958"], ["0044 20 7946 0958", "+442079460958"]]) assert.equal(toE164(i), o, i);
  for (const bad of ["", "12345", "555-0134", "+1 015 555 0134", "hello", "415555013499999999", "+0 123"]) assert.equal(toE164(bad), "", bad);
  assert.equal(maskPhone("+14155550134"), "+1***34");
});

test("email: a code, a name, and a new person goes straight in when invite-only is off", async () => {
  process.env.ENCORE_INVITE_ONLY = "0";
  const J = jar(), email = uniq("ana");
  const s = await J.post("/api/auth/code/start", { id: email.toUpperCase() }); assert.equal(s.status, 200); const sj = await s.json();
  assert.equal(sj.kind, "email"); assert.equal(sj.to, email);
  const v = await (await J.post("/api/auth/code/verify", { id: email, code: mailCode(email) })).json();
  assert.equal(v.need, "name", "no invite step when invite-only is off");
  assert.equal((await (await J.get("/api/auth/pending")).json()).email, email);
  const f = await (await J.post("/api/auth/finish", { name: "Ana Ruiz" })).json(); assert.equal(f.ok, true); assert.equal(f.redirect, "/feed?welcome=1", "personal accounts land on the feed");
  const m = await me(J); assert.equal(m.email, email); assert.equal(m.name, "Ana Ruiz"); assert.equal(m.emailVerified, true);
});

test("phone: a text code signs up a new person, and the same number signs them in again", async () => {
  process.env.ENCORE_INVITE_ONLY = "0";
  const raw = uniqPhone(), e164 = toE164(raw), J = jar();
  let code;
  const logs = await logsOf(async () => {
    const s = await J.post("/api/auth/code/start", { id: raw }); assert.equal(s.status, 200); const sj = await s.json();
    assert.equal(sj.kind, "phone"); assert.match(sj.to, /^\(415\) 555-\d{4}$/);
    code = textCode(e164); assert.match(code, /^\d{6}$/, "the code went by text");
    assert.match(fakeCodeTexts.at(-1).text, new RegExp(`#${code}$`), "a line the phone can autofill from");
    // typed differently the second time: still the same number
    const v = await (await J.post("/api/auth/code/verify", { id: e164.slice(2), code })).json(); assert.equal(v.need, "name");
    assert.equal((await (await J.get("/api/auth/pending")).json()).phone, sj.to);
    const f = await (await J.post("/api/auth/finish", { name: "Pat Lee" })).json(); assert.equal(f.ok, true); assert.equal(f.redirect, "/feed?welcome=1");
  });
  assert.ok(!logs.includes(e164) && !logs.includes(e164.slice(2)), "the number is never logged in full");
  assert.ok(!logs.includes(code), "the code is never logged");
  const m = await me(J); assert.equal(m.name, "Pat Lee"); assert.equal(m.phone, e164); assert.match(m.email, /@phone\.potterylab\.invalid$/, "a stand-in address that's never mailed");
  // back again with invite-only on: a returning number never sees the invite step
  process.env.ENCORE_INVITE_ONLY = "1";
  const R = jar(); await R.post("/api/auth/code/start", { id: e164 });
  const r = await (await R.post("/api/auth/code/verify", { id: e164, code: textCode(e164) })).json();
  assert.equal(r.ok, true); assert.equal(r.isNew, false); assert.equal((await me(R)).email, m.email);
});

test("returning people skip the invite: by email, and by a phone number added to the account", async () => {
  const H = await host("Ola Existing");
  const J = jar(); assert.equal((await J.post("/api/auth/code/start", { id: H.email, next: "/settings" })).status, 200);
  const v = await (await J.post("/api/auth/code/verify", { id: H.email, code: mailCode(H.email) })).json();
  assert.equal(v.ok, true); assert.equal(v.redirect, "/settings", "?next= is honored"); assert.equal(v.need, undefined);
  // add a phone to the account (signed in), proved by a text code
  const phone = toE164(uniqPhone());
  assert.equal((await jar().post("/api/me/phone/start", { phone })).status, 401, "signed in only");
  assert.equal((await H.J.post("/api/me/phone/start", { phone })).status, 200);
  assert.equal((await H.J.post("/api/me/phone/verify", { phone, code: wrong(textCode(phone)) })).status, 400);
  const ok = await H.J.post("/api/me/phone/verify", { phone, code: textCode(phone) }); assert.equal(ok.status, 200);
  assert.equal((await me(H.J)).phone, phone);
  // now the phone signs in to the same account, with no invite step
  const P = jar(); await P.post("/api/auth/code/start", { id: phone });
  const pv = await (await P.post("/api/auth/code/verify", { id: phone, code: textCode(phone) })).json();
  assert.equal(pv.ok, true); assert.equal(pv.redirect, "/"); assert.equal((await me(P)).email, H.email);
  // the same number can't be put on a second account
  const H2 = await host("Second Host"); assert.equal((await H2.J.post("/api/me/phone/start", { phone })).status, 409);
});

test("invite-only: the invite step comes after the code, only for new people, with a waitlist that saves the email or phone", async () => {
  const H = await host();
  // a new email: proven, then asked for a code
  const J = jar(), email = uniq("new");
  await J.post("/api/auth/code/start", { id: email });
  const v = await (await J.post("/api/auth/code/verify", { id: email, code: mailCode(email) })).json();
  assert.equal(v.need, "invite"); assert.match(v.message, /You'll need an invite to join for now/); assert.equal(await me(J), null, "no account yet");
  const p = await (await J.get("/api/auth/pending")).json(); assert.equal(p.need, "invite"); assert.equal(p.email, email);
  // a wrong code is refused and the sign-in stays held
  assert.equal((await J.post("/api/auth/join", { code: "NOPE-NOPE" })).status, 403);
  assert.equal((await (await J.get("/api/auth/pending")).json()).pending, true);
  // no code: the waitlist keeps the email they just proved, without typing it again
  const w = await (await J.post("/api/auth/waitlist", {})).json(); assert.equal(w.ok, true); assert.equal(w.to, email);
  const rows = srv.store.listPrefix("system", "wait-").map((d) => d.data).filter((x) => x.email === email);
  assert.equal(rows.length, 1); assert.equal(rows[0].proven, true); assert.equal(rows[0].via, "signin");
  await J.post("/api/auth/waitlist", {}); assert.equal(srv.store.listPrefix("system", "wait-").filter((d) => d.data.email === email).length, 1, "once");
  // later a friend's code arrives: the held sign-in carries on to the name step, then in
  const c = await (await J.post("/api/auth/join", { code: H.code })).json(); assert.equal(c.need, "name"); assert.equal(c.from, "Maya");
  const f = await (await J.post("/api/auth/finish", { name: "Noor Ali" })).json(); assert.equal(f.ok, true); assert.equal(f.redirect, "/feed?welcome=1");
  assert.equal((await me(J)).email, email);
  assert.equal((await (await fetch(srv.base + "/api/codes/" + H.code)).json()).valid, false, "the code is used");
  // a new phone number on the waitlist
  const P = jar(), phone = toE164(uniqPhone());
  await P.post("/api/auth/code/start", { id: phone });
  assert.equal((await (await P.post("/api/auth/code/verify", { id: phone, code: textCode(phone) })).json()).need, "invite");
  const pw = await (await P.post("/api/auth/waitlist", { name: "Sam" })).json(); assert.equal(pw.ok, true);
  const prow = srv.store.listPrefix("system", "wait-").map((d) => d.data).find((x) => x.phone === phone); assert.ok(prow, "the phone is saved"); assert.equal(prow.email, ""); assert.equal(prow.name, "Sam");
  // with no sign-in held, the waitlist takes a typed email or phone
  assert.equal((await jar().post("/api/auth/waitlist", { id: "nope" })).status, 400);
});

test("codes expire after 10 minutes and only a hash is stored", async () => {
  const J = jar(), email = uniq("late");
  await J.post("/api/auth/code/start", { id: email });
  const rec = srv.store.get(otpPath(email)).data, code = mailCode(email);
  assert.ok(rec.exp - Date.now() <= 10 * 60e3 && rec.exp - Date.now() > 9 * 60e3, "10 minutes");
  assert.ok(!JSON.stringify(rec).includes(code), "the code itself is never stored"); assert.match(rec.hash, /^[0-9a-f]{64}$/);
  srv.store.set(otpPath(email), { ...rec, exp: Date.now() - 1 });
  const r = await J.post("/api/auth/code/verify", { id: email, code }); assert.equal(r.status, 400); assert.equal((await r.json()).code, "expired");
  // a phone code too
  const phone = toE164(uniqPhone()); await J.post("/api/auth/code/start", { id: phone });
  const pr = srv.store.get(otpPath(phone)).data; assert.ok(!JSON.stringify(pr).includes(textCode(phone)));
  srv.store.set(otpPath(phone), { ...pr, exp: Date.now() - 1 });
  assert.equal((await (await J.post("/api/auth/code/verify", { id: phone, code: textCode(phone) })).json()).code, "expired");
});

test("wrong codes: 5 tries per code, then even the right one fails", async () => {
  const T = jar(), phone = toE164(uniqPhone()); await T.post("/api/auth/code/start", { id: phone }); const good = textCode(phone), bad = wrong(good);
  for (let i = 1; i <= 4; i++) { const r = await T.post("/api/auth/code/verify", { id: phone, code: bad }); assert.equal(r.status, 400); assert.match((await r.json()).message, new RegExp(`${5 - i} tr`)); }
  const fifth = await T.post("/api/auth/code/verify", { id: phone, code: bad }); assert.equal(fifth.status, 429); assert.equal((await fifth.json()).code, "too_many");
  assert.equal((await T.post("/api/auth/code/verify", { id: phone, code: good })).status, 400, "the code is gone");
  assert.equal(await me(T), null);
});

test("SMS not set up: a kind answer that points to email, which still works; Twilio is called with fetch when it is", async () => {
  delete process.env.ENCORE_FAKE_SMS;
  try {
    assert.equal(codeSmsConfig(), null);
    const c = await (await fetch(srv.base + "/api/auth/config")).json(); assert.equal(c.providers.sms, false); assert.equal(c.providers.email, true);
    const r = await jar().post("/api/auth/code/start", { id: uniqPhone() }); assert.equal(r.status, 503);
    const j = await r.json(); assert.equal(j.code, "sms_off"); assert.equal(j.message, "Text sign-in isn't on yet. Use your email instead.");
    const email = uniq("fallback"); assert.equal((await jar().post("/api/auth/code/start", { id: email })).status, 200, "email is one tap away and works");
    // Twilio, with the owner's env vars: one form POST with Basic auth, nothing logged
    Object.assign(process.env, { TWILIO_ACCOUNT_SID: "AC" + "0".repeat(32), TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM: "+14155550100" });
    const real = globalThis.fetch, calls = [];
    globalThis.fetch = (u, o) => String(u).startsWith("https://api.twilio.com/") ? (calls.push({ u: String(u), o }), Promise.resolve(new Response("{}", { status: 201 }))) : real(u, o);
    const phone = toE164(uniqPhone());
    try { const s = await jar().post("/api/auth/code/start", { id: phone }); assert.equal(s.status, 200); } finally { globalThis.fetch = real; }
    assert.equal(calls.length, 1); assert.match(calls[0].u, /\/Accounts\/AC0+\/Messages\.json$/);
    assert.equal(calls[0].o.headers.Authorization, "Basic " + Buffer.from(`AC${"0".repeat(32)}:tok`).toString("base64"));
    const body = new URLSearchParams(calls[0].o.body); assert.equal(body.get("To"), phone); assert.equal(body.get("From"), "+14155550100"); assert.match(body.get("Body"), /^\d{6} is your Pottery Lab code/);
    // Twilio says no: say so, and point to email
    globalThis.fetch = (u, o) => String(u).startsWith("https://api.twilio.com/") ? Promise.resolve(new Response(JSON.stringify({ code: 21211 }), { status: 400 })) : real(u, o);
    try { const s = await jar().post("/api/auth/code/start", { id: uniqPhone() }); assert.equal(s.status, 502); assert.match((await s.json()).message, /use your email instead/); } finally { globalThis.fetch = real; }
  } finally { for (const k of TWILIO) delete process.env[k]; Object.assign(process.env, ENV); }
});

test("the page: one field, the phone keyboard and code autofill, the SMS fallback, Field Notes type, no em dashes", async () => {
  const page = await (await fetch(srv.base + "/login")).text();
  assert.match(page, /<label for="idIn">Email or phone number<\/label>/);
  assert.match(page, /id="idIn"[^>]*inputmode="email"/); assert.match(page, /setAttribute\("inputmode", mode\)/, "switches to the tel keyboard");
  assert.match(page, /id="otpIn"[^>]*inputmode="numeric"[^>]*autocomplete="one-time-code"/);
  assert.match(page, /addEventListener\("paste"/, "a pasted code fills the field");
  assert.match(page, /Text sign-in isn't on yet\. Use your email instead\./); assert.match(page, /id="useEmail"/);
  assert.match(page, /No code\? Join the waitlist/); assert.match(page, /Use a password instead/);
  assert.match(page, /href="\/system\.css/); assert.doesNotMatch(page, /Instrument/, "IBM Plex from system.css");
  assert.doesNotMatch(page, /prefers-color-scheme:\s*dark/, "light only");
  assert.doesNotMatch(page, /—/, "no em dashes");
  // passkey, Google and Apple are secondary, after the field
  assert.ok(page.indexOf('id="idIn"') < page.indexOf('data-p="passkey"') && page.indexOf('data-p="google"') < page.indexOf('data-p="apple"'));
});

test("rate limits: 5 sends an hour per email or number, and a cap per IP", async () => {
  const email = uniq("spam"), statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await jar().post("/api/auth/code/start", { id: email })).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
  const phone = toE164(uniqPhone()), ps = [];
  for (let i = 0; i < 6; i++) ps.push((await jar().post("/api/auth/code/start", { id: phone })).status);
  assert.equal(ps.at(-1), 429); assert.ok(ps.filter((x) => x === 200).length <= 5);
  // per IP: fresh addresses until the IP is over its 20 an hour; then even a new address waits
  let last = 200; for (let i = 0; i < 25 && last === 200; i++) last = (await jar().post("/api/auth/code/start", { id: uniq("ip") })).status;
  assert.equal(last, 429);
  const r = await jar().post("/api/auth/code/start", { id: uniq("fresh") }); assert.equal(r.status, 429); assert.equal((await r.json()).code, "rate_limited");
});
