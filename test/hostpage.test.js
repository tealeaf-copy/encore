import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";

let srv;
const J = { "content-type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const put = (path, body, cookie) => fetch(srv.base + path, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "hostpage-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR"]) delete process.env[k]; await srv.close(); });

test("A published event shows on the host's own page even when it's kept off Discover; drafts and link-only events don't", async () => {
  const c = cookieOf(await post("/api/signup", { name: "Claire Nguyen", email: "claire.hp@example.com", password: "long-password-1", mode: "friends" }));
  await post("/api/host/profile", { handle: "claire-hp", name: "Claire's Run Crew", city: "New York" }, c);
  const day = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10), base = { kind: "social", casual: true, date: day, startTime: "18:00", city: "New York", activity: "run club" };
  await put("/api/db/doc?path=events/trot", { ...base, name: "Turkey Trot", published: true, discoverable: true, unlisted: true }, c);
  await put("/api/db/doc?path=events/open", { ...base, name: "Open run", published: true, discoverable: true }, c);
  await put("/api/db/doc?path=events/linkonly", { ...base, name: "Friends only", published: true, discoverable: false }, c);
  await put("/api/db/doc?path=events/draft", { ...base, name: "Draft run" }, c);
  const page = await (await fetch(srv.base + "/api/public/host/claire-hp")).json(), names = page.upcoming.map((e) => e.title).sort();
  assert.deepEqual(names, ["Open run", "Turkey Trot"], "published events are on the page; link-only and drafts are not");
  const disc = JSON.stringify(await (await fetch(srv.base + "/api/public/discover")).json());
  assert.ok(disc.includes("Open run"), "listed events are on Discover"); assert.ok(!disc.includes("Turkey Trot"), "kept off Discover");
});

test("A host can change their name; events that showed the old name follow", async () => {
  const c = cookieOf(await post("/api/signup", { name: "Claire Kim", email: "claire.nm@example.com", password: "long-password-1", mode: "friends" }));
  await put("/api/db/doc?path=events/r1", { kind: "social", casual: true, name: "Run", hostName: "Claire Kim" }, c);
  await put("/api/db/doc?path=events/r2", { kind: "social", casual: true, name: "Co-hosted run", hostName: "Claire and Eric" }, c);
  assert.equal((await post("/api/me/name", { name: "C" }, c)).status, 400);
  assert.equal((await post("/api/me/name", { name: "Claire Nguyen" })).status, 401, "signed out can't");
  const j = await (await post("/api/me/name", { name: "Claire Nguyen" }, c)).json(); assert.equal(j.events, 1);
  assert.equal((await (await fetch(srv.base + "/api/me/name", { headers: { cookie: c } })).json()).name, "Claire Nguyen");
  const ev = async (id) => (await (await fetch(srv.base + "/api/db/doc?path=events/" + id, { headers: { cookie: c } })).json()).data.hostName;
  assert.equal(await ev("r1"), "Claire Nguyen"); assert.equal(await ev("r2"), "Claire and Eric");
});

test("Public host data never includes invoicing details (legal name, tax ID, business address)", async () => {
  const c = cookieOf(await post("/api/signup", { name: "Ivy Inv", email: "ivy.inv@example.com", password: "long-password-1", mode: "friends" }));
  await post("/api/host/profile", { handle: "ivy-inv", name: "Ivy's Studio", city: "New York", legalName: "Ivy Studio LLC", taxId: "12-3456789", bizAddress: "1 Main St, Brooklyn" }, c);
  const mine = await (await fetch(srv.base + "/api/host/profile", { headers: { cookie: c } })).json(); assert.equal(mine.host.taxId, "12-3456789", "the owner still sees them");
  for (const u of ["/api/public/host/ivy-inv", "/api/public/discover"]) { const t = await (await fetch(srv.base + u)).text(); assert.ok(!/12-3456789|Ivy Studio LLC|1 Main St/.test(t), u + " leaks invoicing details"); }
});

test("Portraits keep a chosen skin tone and hair colour; anything else is refused", async () => {
  const c = cookieOf(await post("/api/signup", { name: "Yan", email: "yan.av@example.com", password: "long-password-1", mode: "friends" }));
  await post("/api/host/profile", { handle: "yan-av", name: "Yan Drawing", city: "New York", theme: { avatarArt: "braids~4~1" } }, c);
  const art = async () => (await (await fetch(srv.base + "/api/public/host/yan-av")).json()).host.theme.avatarArt;
  assert.equal(await art(), "braids~4~1");
  for (const bad of ["braids~9~0", "dragon", "hijab~1~1~1~9", "braids~1~1~1~1~1~1~1", "<svg>"]) { await post("/api/host/profile", { handle: "yan-av", name: "Yan Drawing", theme: { avatarArt: bad } }, c); assert.equal(await art(), "braids~4~1", bad + " is not saved"); }
  await post("/api/host/profile", { handle: "yan-av", name: "Yan Drawing", theme: { avatarArt: "hijab" } }, c); assert.equal(await art(), "hijab");
  await post("/api/host/profile", { handle: "yan-av", name: "Yan Drawing", theme: { avatarArt: "afro~5~0~3~2~2~4" } }, c); assert.equal(await art(), "afro~5~0~3~2~2~4", "eyes, nose, mouth and extras are kept");
});

test("Real hosts who haven't signed up yet show as read-only showcase pages until they claim them", async () => {
  const page = await (await fetch(srv.base + "/api/public/host/atbo")).json();
  assert.equal(page.host.showcase, true); assert.equal(page.host.name, "Atelier Bò"); assert.match(page.host.claim, /preset=atelier-bo/);
  const disc = await (await fetch(srv.base + "/api/public/discover")).json(); assert.ok(disc.hosts.some((h) => h.handle === "atbo" && h.showcase));
});

test("Guests can change what they're bringing, but not take an item someone else has", async () => {
  const c = cookieOf(await post("/api/signup", { name: "Pat Potluck", email: "pat.bring@example.com", password: "long-password-1", mode: "friends" }));
  const day = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  await put("/api/db/doc?path=events/potl", { kind: "social", casual: true, name: "Potluck", activity: "potluck", date: day, published: true, slots: ["Pie", "Drinks"] }, c);
  await put("/api/db/doc?path=rsvps/r1", { eventId: "potl", name: "Ana Lopez", response: "going", code: "c1", slot: "Pie" }, c);
  await put("/api/db/doc?path=rsvps/r2", { eventId: "potl", name: "Cy Park", response: "going", code: "c2" }, c);
  const extra = (b) => post("/api/public/rsvp-extra/potl", b);
  assert.equal((await extra({ rid: "r2", code: "c2", slot: "Pie" })).status, 409, "Pie is Ana's");
  assert.equal((await extra({ rid: "r2", code: "c2", slot: "Cake" })).status, 400, "not on the list");
  assert.equal((await extra({ rid: "r2", code: "wrong", slot: "Drinks" })).status, 404, "needs the reply's code");
  assert.equal((await extra({ rid: "r2", code: "c2", slot: "Drinks" })).status, 200);
  const host = await (await fetch(srv.base + "/api/public/event-host/potl")).json();
  assert.deepEqual(host.bring.map((x) => `${x.slot}:${x.who}`).sort(), ["Drinks:Cy", "Pie:Ana"]);
  const st = await (await fetch(srv.base + "/api/public/rsvp-status/potl?rid=r2&code=c2")).json(); assert.equal(st.slot, "Drinks");
});
