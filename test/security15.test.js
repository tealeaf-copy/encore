// Launch review security: email verification (draft yes, share an invite or report no, until the link is tapped), admins
// need a confirmed email, the shared founder code is limited per IP and per day and logged, the session cookie doesn't
// carry the email (old cookies still work and are swapped), and mass reports from new or unconfirmed accounts queue for
// a person instead of hiding something.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits, legacyCookieForTest } from "../server/auth.js";
import { fakeOutbox } from "../server/email.js";
import { isAdmin } from "../server/metrics.js";
import { getDbUser, putDbUser } from "../server/workspaces.js";

let srv;
const J = { "content-type": "application/json" };
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "sec15-secret-0123456789abcdef", ENCORE_FAKE_EMAIL: "1", ENCORE_VERIFY_EMAIL: "1", ENCORE_ADMIN_EMAILS: "boss.s15@example.com", ENCORE_SIGNUP_PER_HOUR: "500" };
before(async () => { Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer(); });
after(async () => { for (const k of [...Object.keys(ENV), "ENCORE_FOUNDER_CODES", "ENCORE_FOUNDER_PER_IP"]) delete process.env[k]; await srv.close(); });
const post = (p, body, cookie, h = {}) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}), ...h }, body: JSON.stringify(body) });
const put = (p, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + p, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const ck = (r) => (r.headers.getSetCookie?.() || [r.headers.get("set-cookie")]).map((c) => String(c).split(";")[0]).find((c) => c.startsWith("encore_auth=")) || "";
async function signup(name, email, extra = {}) { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends", ...extra }); return { r, cookie: ck(r), j: await r.json() }; }
const linkFor = (email) => { const m = [...fakeOutbox].reverse().find((x) => String(x.to).includes(email) && /Confirm your email/.test(x.subject)); return m && (m.text.match(/https?:\/\/\S+\/verify\?t=\S+/) || [])[0]; };

test("a new account confirms its email before it can share an invite or report; drafts are fine", async () => {
  const { cookie } = await signup("Vee New", "vee.s15@example.com");
  assert.equal((await (await fetch(srv.base + "/api/me", { headers: { cookie } })).json()).emailVerified, false);
  const ev = { name: "Soup night", casual: true, date: "2030-02-02", startTime: "19:00" };
  assert.equal((await put("events/s15a", ev, cookie)).status, 200, "a draft saves");
  const pub = await put("events/s15a", { ...ev, published: true, discoverable: true }, cookie); assert.equal(pub.status, 403); assert.equal((await pub.json()).code, "verify_email");
  assert.equal((await post("/api/report", { type: "event", target: "event:s15a", reason: "spam" }, cookie)).status, 403, "no reports yet");
  const link = linkFor("vee.s15@example.com"); assert.ok(link, "the link was emailed");
  const v = await fetch(link.replace(/^https?:\/\/[^/]+/, srv.base), { redirect: "manual" }); assert.equal(v.status, 302); assert.match(v.headers.get("location"), /verified=1/);
  assert.equal((await (await fetch(srv.base + "/api/me", { headers: { cookie } })).json()).emailVerified, true);
  assert.equal((await put("events/s15a", { ...ev, published: true, discoverable: true }, cookie)).status, 200, "now it shares");
  assert.equal((await fetch(link.replace(/^https?:\/\/[^/]+/, srv.base), { redirect: "manual" })).headers.get("location"), "/settings?verify=expired", "a link works once");
  assert.equal((await post("/api/me/verify", {}, cookie)).status, 200);
});

test("an admin needs a confirmed email", async () => {
  await signup("Boss", "boss.s15@example.com");
  assert.equal(isAdmin("boss.s15@example.com"), false, "on the list, but not confirmed");
  await fetch(linkFor("boss.s15@example.com").replace(/^https?:\/\/[^/]+/, srv.base), { redirect: "manual" });
  assert.equal(isAdmin("boss.s15@example.com"), true);
});

test("the shared founder code stays reusable, but per IP per day, and each use is logged", async () => {
  process.env.ENCORE_FOUNDER_CODES = "oink oink"; process.env.ENCORE_FOUNDER_PER_IP = "2";
  try {
    for (const n of [1, 2]) assert.equal((await signup("Fo " + n, `fo${n}.s15@example.com`, { code: "OINK-OINK" })).r.status, 200, "use " + n);
    const third = await signup("Fo 3", "fo3.s15@example.com", { code: "oink oink" }); assert.equal(third.r.status, 429); assert.match(third.j.message, /used a lot today/);
    const day = new Date().toISOString().slice(0, 10), log = srv.store.get("system/founder-" + day).data.uses;
    assert.deepEqual(log.map((x) => x.email), ["fo1.s15@example.com", "fo2.s15@example.com"]); assert.ok(log.every((x) => x.ip && !x.ip.includes(".")), "the IP is kept as a hash");
  } finally { delete process.env.ENCORE_FOUNDER_CODES; delete process.env.ENCORE_FOUNDER_PER_IP; }
});

test("the session cookie doesn't carry the email; old cookies keep working and get swapped", async () => {
  const { cookie, j } = await signup("Cookie Person", "cookie.s15@example.com");
  assert.match(cookie, /^encore_auth=v2\./); assert.doesNotMatch(decodeURIComponent(cookie), /cookie\.s15|@/);
  const old = "encore_auth=" + encodeURIComponent(legacyCookieForTest("cookie.s15@example.com", j.workspace.id));
  const r = await fetch(srv.base + "/api/me", { headers: { cookie: old } }); assert.equal((await r.json()).email, "cookie.s15@example.com", "the old cookie still signs in");
  const fresh = ck(r); assert.match(fresh, /^encore_auth=v2\./, "and is swapped for a v2 one");
  assert.equal((await (await fetch(srv.base + "/api/me", { headers: { cookie: fresh } })).json()).email, "cookie.s15@example.com");
  await post("/api/logout", {}, fresh); assert.equal((await (await fetch(srv.base + "/api/me", { headers: { cookie: fresh } })).json()).email, undefined, "sign out ends it");
  assert.equal((await (await fetch(srv.base + "/api/me", { headers: { cookie: "encore_auth=v2." + j.workspace.id + "." + "a".repeat(32) + ".bad" } })).json()).email, undefined, "a made-up v2 cookie is nobody");
});

test("mass reports: new or unconfirmed accounts queue for a person; trusted ones hide it and the host hears", async () => {
  process.env.ENCORE_VERIFY_EMAIL = "0"; // these accounts start confirmed; age is what's tested
  try {
    const host = await signup("Hal Host", "hal.s15@example.com");
    assert.equal((await put("events/s15ev", { name: "Rooftop", casual: true, date: "2030-03-03", published: true, discoverable: true }, host.cookie)).status, 200);
    const fresh = []; for (const n of [1, 2, 3]) fresh.push((await signup("Throw " + n, `throw${n}.s15@example.com`)).cookie);
    for (const c of fresh) assert.equal((await post("/api/report", { type: "event", target: "event:s15ev", reason: "spam" }, c)).status, 200);
    const admin = ck(await post("/api/login", { email: "boss.s15@example.com", password: "long-password-1" }));
    const st = async () => (await (await fetch(srv.base + "/api/admin/reports?status=all", { headers: { cookie: admin } })).json()).reports.filter((r) => r.target === "event:s15ev");
    assert.ok((await st()).every((r) => !r.hidden && !r.trusted), "three new accounts can't hide an event; their reports wait for a person");
    // three confirmed accounts older than 7 days
    const old = []; for (const n of [1, 2, 3]) { const e = `old${n}.s15@example.com`, s = await signup("Old " + n, e); putDbUser({ ...getDbUser(e), createdAt: Date.now() - 30 * 864e5, emailVerified: true }); old.push(s.cookie); }
    for (const c of old) assert.equal((await post("/api/report", { type: "event", target: "event:s15ev", reason: "spam" }, c)).status, 200);
    const R = await st(); assert.equal(R.filter((r) => r.trusted).length, 3); assert.ok(R.some((r) => r.hidden), "hidden after three trusted reports");
    const inbox = await (await fetch(srv.base + "/api/me/inbox", { headers: { cookie: host.cookie } })).json();
    assert.match(JSON.stringify(inbox), /hidden after several reports/, "the host hears");
  } finally { process.env.ENCORE_VERIFY_EMAIL = "1"; }
});
