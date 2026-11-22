import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { fakeOutbox } from "../server/email.js";

let srv;
const J = { "content-type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (path, cookie) => fetch(srv.base + path, { headers: cookie ? { cookie } : {} });
const put = (path, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
const join = async (name, email, code) => { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends", code }); return { r, cookie: r.ok ? cookieOf(r) : null, body: await r.json() }; };

before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.ENCORE_INVITE_ONLY = "1"; process.env.SESSION_SECRET = "com-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; process.env.ENCORE_FAKE_EMAIL = "1"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "ENCORE_INVITE_ONLY", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv.close(); });

test("Invite-only: the first member gets in, then everyone needs a code, and codes work once", async () => {
  assert.equal((await (await get("/api/signup/config")).json()).inviteOnly, true);
  const A = await join("Linh Tran", "linh@example.com");
  assert.equal(A.r.status, 200, JSON.stringify(A.body));
  const codes = (await (await get("/api/codes", A.cookie)).json()).codes;
  assert.equal(codes.length, 5); assert.match(codes[0].link, /\/join\?code=/);
  const nope = await join("Sam Lee", "sam@example.com");
  assert.equal(nope.r.status, 403); assert.equal(nope.body.code, "invite_required");
  const peek = await (await get("/api/codes/" + codes[0].code)).json();
  assert.equal(peek.valid, true); assert.equal(peek.from, "Linh");
  const B = await join("Sam Lee", "sam@example.com", codes[0].code);
  assert.equal(B.r.status, 200, JSON.stringify(B.body));
  const again = await join("Kim Ho", "kim@example.com", codes[0].code);
  assert.equal(again.r.status, 403); assert.match(again.body.message, /already been used/);
  const mine = (await (await get("/api/codes", A.cookie)).json()).codes;
  assert.equal(mine[0].used, true); assert.equal(mine[0].usedBy, "Sam");
  // the redirect from a shared link
  const red = await fetch(srv.base + "/join?code=" + codes[1].code, { redirect: "manual" });
  assert.equal(red.status, 302); assert.match(red.headers.get("location"), /\/signup\?code=/);
});

test("Host pages: a handle, followers without an account, discover, and announcing to followers", async () => {
  // Make a member (codes from the first member in the previous test, or bootstrap).
  let A = await join("Mai Pham", "mai@example.com");
  if (A.r.status !== 200) { const seed = await post("/api/login", { email: "linh@example.com", password: "long-password-1" }); const codes = (await (await get("/api/codes", cookieOf(seed))).json()).codes; A = await join("Mai Pham", "mai@example.com", codes.find((c) => !c.used).code); }
  assert.equal(A.r.status, 200, JSON.stringify(A.body));
  const bad = await post("/api/host/profile", { handle: "No Spaces!" }, A.cookie);
  assert.equal(bad.status, 400);
  const ok = await post("/api/host/profile", { handle: "pandan-mai", name: "Mai's Kitchen", bio: "I bake pandan honeycomb cake and give it away.", city: "San Jose", tags: ["baking", "free food"], emoji: "🍰", supportUrl: "https://ko-fi.com/maibakes" }, A.cookie);
  assert.equal(ok.status, 200, await ok.clone().text()); assert.match((await ok.json()).url, /\/h\/pandan-mai$/);
  const bad2 = await post("/api/host/profile", { handle: "pandan-mai", supportUrl: "javascript:alert(1)" }, A.cookie);
  assert.equal(bad2.status, 400);
  // a discoverable upcoming event and a private one
  const soon = new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10);
  assert.equal((await put("events/pandan1", { name: "Free pandan honeycomb cake", pubTitle: "Free pandan honeycomb cake", date: soon, city: "San Jose", kind: "social", casual: true, activity: "giveaway", discoverable: true, free: true }, A.cookie)).status, 200);
  assert.equal((await put("events/private1", { name: "Family dinner", date: soon, kind: "social", casual: true }, A.cookie)).status, 200);
  const page = await (await get("/api/public/host/pandan-mai")).json();
  assert.equal(page.host.name, "Mai's Kitchen"); assert.equal(page.upcoming.length, 1); assert.equal(page.upcoming[0].title, "Free pandan honeycomb cake");
  assert.equal((await get("/h/pandan-mai")).status, 200);
  // follow, twice (no double count), and bad email
  assert.equal((await post("/api/public/follow", { handle: "pandan-mai", email: "fan@example.com", name: "Fan One", tastes: ["baking"] })).status, 200);
  const f2 = await (await post("/api/public/follow", { handle: "pandan-mai", email: "FAN@example.com", name: "Fan One" })).json();
  assert.equal(f2.followers, 2, "the inviter plus one fan, counted once");
  assert.equal((await post("/api/public/follow", { handle: "pandan-mai", email: "nope" })).status, 400);
  // followers can't be written through the data API
  assert.equal((await put("followers/x", { email: "fake@example.com" }, A.cookie)).status, 403);
  const fl = await (await get("/api/host/followers", A.cookie)).json();
  assert.equal(fl.count, 2); assert.deepEqual(fl.followers.find((f) => f.email === "fan@example.com").tastes, ["baking"]); assert.equal(fl.followers.find((f) => f.email === "linh@example.com").via, "invite");
  const d = await (await get("/api/public/discover")).json();
  assert.ok(d.hosts.some((h) => h.handle === "pandan-mai" && h.followers === 2));
  assert.ok(d.events.some((e) => e.title === "Free pandan honeycomb cake")); assert.ok(!d.events.some((e) => e.title === "Family dinner"));
  const eh = await (await get("/api/public/event-host/pandan1")).json();
  assert.equal(eh.host.handle, "pandan-mai"); assert.equal(eh.followers, 2);
  // announce
  const before = fakeOutbox.length;
  const an = await (await post("/api/host/announce", { eventId: "pandan1" }, A.cookie)).json();
  assert.equal(an.followers, 2); assert.equal(an.emailed, 2);
  assert.match(fakeOutbox.at(-1).subject, /Mai's Kitchen/); assert.equal(fakeOutbox.length, before + 2);
});

test("Waitlist: someone without a code asks, a member sends them one, and they become connected", async () => {
  const r = await post("/api/waitlist", { name: "Alex Kim", email: "alex@example.com", city: "Oakland", wants: "a Sunday hike" });
  assert.equal(r.status, 200);
  assert.equal((await post("/api/waitlist", { email: "bad" })).status, 400);
  const seed = await post("/api/login", { email: "linh@example.com", password: "long-password-1" });
  const cookie = cookieOf(seed);
  const w = (await (await get("/api/waitlist", cookie)).json()).waiting;
  const alex = w.find((x) => x.name === "Alex"); assert.ok(alex); assert.equal(alex.city, "Oakland"); assert.equal(alex.email, undefined, "members don't see waitlist emails");
  const sent = await (await post(`/api/waitlist/${alex.id}/invite`, {}, cookie)).json();
  assert.equal(sent.ok, true); assert.equal(sent.emailed, true);
  const B = await join("Alex Kim", "alex@example.com", sent.code);
  assert.equal(B.r.status, 200, JSON.stringify(B.body));
  assert.ok(!(await (await get("/api/waitlist", cookie)).json()).waiting.some((x) => x.id === alex.id));
});
