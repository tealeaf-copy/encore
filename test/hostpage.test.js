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
  await post("/api/host/profile", { handle: "claire-hp", name: "Claire's Run Crew", city: "New York", tagline: "Saturday runs", theme: { avatarArt: "runner" } }, c);
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

test("Signed-in people keep one set of RSVP details on their account", async () => {
  const c = cookieOf(await post("/api/signup", { name: "Vi Tran", email: "vi.prof@example.com", password: "long-password-1", mode: "friends" }));
  assert.equal((await fetch(srv.base + "/api/me/rsvp-profile")).status, 401, "needs an account");
  const save = await post("/api/me/rsvp-profile", { name: "Vi Tran", email: "vi.prof@example.com", dietary: "Vegetarian, Nut allergy", severe: true, access: "<b>step-free</b>", extra: "ignored" }, c);
  assert.equal(save.status, 200);
  const got = (await (await fetch(srv.base + "/api/me/rsvp-profile", { headers: { cookie: c } })).json()).profile;
  assert.equal(got.dietary, "Vegetarian, Nut allergy"); assert.equal(got.severe, true); assert.ok(!("extra" in got)); assert.ok(!/[<>]/.test(got.access));
  await post("/api/me/rsvp-profile", { clear: true }, c);
  assert.equal((await (await fetch(srv.base + "/api/me/rsvp-profile", { headers: { cookie: c } })).json()).profile, null);
});

test("Hosts can recommend other hosts; it shows on both pages", async () => {
  const a = cookieOf(await post("/api/signup", { name: "Mo Okafor", email: "mo.rec@example.com", password: "long-password-1", mode: "friends" }));
  const b = cookieOf(await post("/api/signup", { name: "Kim Lee", email: "kim.rec@example.com", password: "long-password-1", mode: "friends" }));
  await post("/api/host/profile", { handle: "kim-rec", name: "Kim's Kiln", city: "Brooklyn" }, b);
  await post("/api/host/profile", { handle: "mo-rec", name: "Mo's Run Club", city: "Brooklyn", recommends: [{ handle: "@kim-rec", note: "Best <b>pottery</b> night" }, { handle: "mo-rec" }, { handle: "Not A Handle!" }, { handle: "kim-rec" }] }, a);
  const mo = await (await fetch(srv.base + "/api/public/host/mo-rec")).json(), kim = await (await fetch(srv.base + "/api/public/host/kim-rec")).json();
  assert.deepEqual(mo.host.recs.map((x) => x.handle), ["kim-rec"], "no self, no junk, no duplicates");
  assert.ok(!/[<>]/.test(mo.host.recs[0].note));
  assert.deepEqual(kim.host.recBy.map((x) => x.handle), ["mo-rec"]);
});

test("Guests' answers to the host's own questions are saved with the RSVP, cleaned", async () => {
  const r0 = await post("/api/signup", { name: "Ome Host", email: "ome.q@example.com", password: "long-password-1", mode: "friends" });
  const c = cookieOf(r0), ws = (await r0.json()).workspace.id;
  const day = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  const pe = await put("/api/db/doc?path=events/omeq", { kind: "social", casual: true, name: "Pickup", date: day, published: true, questions: [{ id: "q1", q: "how many sets?", type: "number" }] }, c);
  assert.ok(pe.ok, await pe.text());
  const G = { ...J, "x-encore-guest": "1", "x-encore-key": "gkq1", "x-encore-workspace": ws };
  const ev = await (await fetch(srv.base + "/api/db/doc?path=events/omeq", { headers: G })).json();
  assert.equal(ev.data.questions[0].q, "how many sets?", "guests can see the questions");
  const w = await fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: G, body: JSON.stringify({ eventId: "omeq", name: "Vi", response: "going", answers: { q1: 3, q2: "<script>x</script>chạy chứ 🏃", "bad key!": "x", q3: ["a", "b"] } }) });
  assert.ok(w.ok, await w.text());
  const list = await (await fetch(srv.base + "/api/db/collection?path=rsvps", { headers: { cookie: c } })).json();
  const a = (list.docs || list.items || list).find((d) => (d.data || d).name === "Vi");
  const ans = (a.data || a).answers;
  assert.equal(ans.q1, 3); assert.ok(!/</.test(ans.q2) && /chạy chứ/.test(ans.q2)); assert.ok(!("bad key!" in ans)); assert.deepEqual(ans.q3, ["a", "b"]);
});

test("A host's turnout record counts yeses, check-ins and walk-ins as totals, never names", async () => {
  const r0 = await post("/api/signup", { name: "Turn Out", email: "turn.out@example.com", password: "long-password-1", mode: "friends" });
  const c = cookieOf(r0), ws = (await r0.json()).workspace.id;
  assert.ok((await post("/api/host/profile", { handle: "turnout-host", name: "Turn Out", tagline: "Suppers", emoji: "🍲" }, c)).ok);
  const day = new Date().toISOString().slice(0, 10);
  await put("/api/db/doc?path=events/to1", { kind: "social", casual: true, name: "Supper", date: day, published: true, guests: [{ name: "Wally", status: "Attended", source: "Walk-in" }] }, c);
  const G = { ...J, "x-encore-guest": "1", "x-encore-workspace": ws };
  for (const n of ["Ana", "Cy", "Bo"]) assert.ok((await fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...G, "x-encore-key": "tk" + n }, body: JSON.stringify({ eventId: "to1", name: n, email: n + "@ex.com", response: "going" }) })).ok);
  const list = await (await fetch(srv.base + "/api/db/collection?path=rsvps", { headers: { cookie: c } })).json(); const docs = list.docs || list.items || list;
  const ana = docs.find((d) => (d.data || d).name === "Ana"); const aid = String(ana.id).split("/").pop();
  assert.ok((await put("/api/db/doc?path=rsvps/" + aid, { ...(ana.data || ana), checkedInAt: Date.now() }, c)).ok);
  const t = (await (await fetch(srv.base + "/api/public/host/turnout-host/turnout")).json()).turnout;
  assert.equal(t.events, 1); assert.equal(t.saidYes, 3); assert.equal(t.walkIns, 1); assert.equal(t.came, 2); assert.equal(t.showRate, 33);
  assert.ok(!/Ana|Wally/.test(JSON.stringify(t)), "no names");
});
