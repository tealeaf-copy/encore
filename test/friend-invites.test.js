// Friend invites by text (server/friendinvites.js): counts, single use, 30 days, take back, the invitee skips the
// invite-code step and becomes friends with the inviter, the waitlist and admin grants.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { fakeOutbox } from "../server/email.js";
import { isFriendCode, statusOf } from "../server/friendinvites.js";

const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "friend-invites-secret-0123456789", ENCORE_SIGNUP_PER_HOUR: "1000", ENCORE_FAKE_EMAIL: "1", ENCORE_INVITE_ONLY: "1", ENCORE_FOUNDER_CODES: "OINKOINK", ENCORE_ADMIN_EMAILS: "admin.fi@example.com", ENCORE_EMAIL_FROM: "hello@potterylab.example" };
let srv, maya; const J = { "content-type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const getJ = async (path, cookie) => (await fetch(srv.base + path, { headers: cookie ? { cookie } : {} })).json();
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
const signup = (name, email, code) => post("/api/signup", { name, email, password: "long-password-1", mode: "friends", ...(code ? { code } : {}) });

before(async () => { Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer();
  const r = await signup("Maya Chen", "maya.fi@example.com", "OINKOINK"); assert.equal(r.status, 200, await r.clone().text()); maya = cookieOf(r);
  const a = await signup("Ada Admin", "admin.fi@example.com", "OINKOINK"); assert.equal(a.status, 200); });
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

test("each member has 5 invites; making one opens a personal message with a single-use link", async () => {
  const D = await getJ("/api/me/invites", maya); assert.equal(D.total, 5); assert.equal(D.left, 5);
  const r = await (await post("/api/me/invites", {}, maya)).json(); assert.ok(isFriendCode(r.code)); assert.equal(r.left, 4, "Invite a friend (4 left)");
  assert.match(r.link, new RegExp(`/join/${r.code}$`)); assert.match(r.message, /^Hey, it's Maya\. I'm on Pottery Lab.*just for you: http/);
  assert.equal((await fetch(srv.base + "/join/" + r.code)).status, 200, "the warm page");
  const P = await getJ(`/api/public/friend-invite/${r.code}?view=1`); assert.equal(P.ok, true); assert.equal(P.from.first, "Maya"); assert.match(P.line, /Maya saved you a spot/); assert.ok(!JSON.stringify(P).includes("maya.fi@example.com"), "never the inviter's email");
  assert.equal(P.signup, `/signup?code=${r.code}`);
});

test("the invitee joins without any other code, becomes friends with the inviter, and the link works once", async () => {
  const { code } = await (await post("/api/me/invites", {}, maya)).json();
  // the sign-in screen holds the code and says who it's from (so it never asks for an invite code)
  const held = await post("/api/auth/join", { code }); const hj = await held.json(); assert.equal(hj.ok, true); assert.equal(hj.from, "Maya");
  const r = await signup("Priya Shah", "priya.fi@example.com", code); assert.equal(r.status, 200, await r.clone().text()); const priya = cookieOf(r);
  const F = srv.app.locals.social; assert.ok(F.friendsOf("priya.fi@example.com").some((x) => x.email === "maya.fi@example.com")); assert.ok(F.friendsOf("maya.fi@example.com").some((x) => x.email === "priya.fi@example.com"), "friends both ways");
  assert.ok(F.inbox("maya.fi@example.com").some((n) => /Priya joined Pottery Lab with your invite/.test(n.text)), "Maya hears");
  const again = await signup("Sam Lee", "sam.fi@example.com", code); assert.equal(again.status, 403); assert.match((await again.json()).message, /already used\. Ask Maya/);
  const D = await getJ("/api/me/invites", maya); assert.equal(D.used, 1); assert.ok(D.invites.some((x) => x.status === "used" && x.usedBy === "Priya"));
  assert.equal((await getJ("/api/me/invites", priya)).left, 5, "the new member gets their own five");
  // without any invite, sign-up is invite-only
  assert.equal((await signup("No Code", "nocode.fi@example.com")).status, 403);
});

test("an invite runs out after 30 days, and can be taken back (which gives it back)", async () => {
  const a = await (await post("/api/me/invites", {}, maya)).json(), left = a.left;
  srv.store.update("system/finv-" + a.code, { exp: Date.now() - 1000 }); assert.equal(statusOf(srv.store.get("system/finv-" + a.code).data), "expired");
  const r = await signup("Late Larry", "larry.fi@example.com", a.code); assert.equal(r.status, 403); assert.match((await r.json()).message, /ran out after 30 days/);
  assert.equal((await getJ("/api/me/invites", maya)).left, left + 1, "an expired invite comes back");
  const b = await (await post("/api/me/invites", {}, maya)).json();
  assert.equal((await fetch(srv.base + "/api/me/invites/" + b.code, { method: "DELETE", headers: { cookie: maya } })).status, 200);
  const r2 = await signup("Revoked Rita", "rita.fi@example.com", b.code); assert.equal(r2.status, 403); assert.match((await r2.json()).message, /taken back/);
  assert.equal((await getJ(`/api/public/friend-invite/${b.code}`)).ok, false);
});

test("counts run out, admins grant more, approve the waitlist, and see conversions", async () => {
  let D = await getJ("/api/me/invites", maya); while (D.left > 0) D = await (await post("/api/me/invites", {}, maya)).json();
  const no = await post("/api/me/invites", {}, maya); assert.equal(no.status, 409); assert.match((await no.json()).message, /used all your invites/);
  const admin = cookieOf(await post("/api/login", { email: "admin.fi@example.com", password: "long-password-1" }));
  assert.equal((await post("/api/admin/invites/grant", { email: "maya.fi@example.com", n: 3 }, maya)).status, 404, "admins only");
  const g = await (await post("/api/admin/invites/grant", { email: "maya.fi@example.com", n: 3 }, admin)).json(); assert.equal(g.left, 3);
  // the waitlist: someone without an invite asks, an admin approves, they get a one-use link and join
  assert.equal((await post("/api/waitlist", { name: "Wen Li", email: "wen.fi@example.com", city: "Brooklyn" })).status, 200);
  const A = await getJ("/api/admin/invites", admin); const w = A.waitlist.find((x) => x.contact === "wen.fi@example.com"); assert.ok(w);
  const ap = await (await post(`/api/admin/waitlist/${w.id}/approve`, {}, admin)).json(); assert.equal(ap.ok, true); assert.match(ap.link, /\/join\/F/);
  assert.equal(ap.sent, "email"); assert.ok(fakeOutbox.some((m) => [].concat(m.to).includes("wen.fi@example.com") && /off the Pottery Lab waitlist/.test(m.subject)), "emailed");
  const code = ap.link.split("/").pop(); assert.equal((await getJ(`/api/public/friend-invite/${code}`)).from, null);
  assert.equal((await signup("Wen Li", "wen.fi@example.com", code)).status, 200);
  assert.equal(srv.app.locals.social.friendsOf("wen.fi@example.com").length, 0, "an admin's invite makes no friendship");
  const S = await getJ("/api/admin/invites", admin); assert.equal(S.used, 2); assert.ok(S.conversion > 0); assert.ok(S.inviters.some((x) => x.email === "maya.fi@example.com" && x.used === 1 && x.extra === 3));
  assert.ok(!S.waitlist.some((x) => x.contact === "wen.fi@example.com"), "off the waitlist");
  assert.equal((await fetch(srv.base + "/admin/invites", { headers: { cookie: admin } })).status, 200);
  assert.equal((await fetch(srv.base + "/admin/invites", { headers: { cookie: maya } })).status, 404);
});
