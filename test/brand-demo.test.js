// The marketer demo (server/branddemo.js): it opens signed out, stays sandboxed (no writes outside the demo's own
// docs, no emails, texts or charges, invisible to other brands and to metrics), each path's API calls work on the
// example hosts, and reset and the daily sweep throw a sandbox away.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { fakeOutbox } from "../server/email.js";
import { fakeTexts } from "../server/sms.js";
import { getWorkspace, updateWorkspace } from "../server/workspaces.js";

let srv;
const J = { "content-type": "application/json" };
const post = (p, body, cookie) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (p, cookie) => fetch(srv.base + p, { headers: cookie ? { cookie } : {}, redirect: "manual" });
const ok = async (r) => { const t = await r.text(); assert.ok(r.ok, `${r.status} ${t.slice(0, 300)}`); return JSON.parse(t); };
const cookieOf = (r) => (r.headers.getSetCookie?.() || [r.headers.get("set-cookie")]).map((c) => c.split(";")[0]).filter((c) => /^encore_auth=/.test(c)).join("; ");
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const weekdayAfter = (n) => { for (let i = n; i < n + 10; i++) { const d = day(i), w = new Date(d + "T12:00:00Z").getUTCDay(); if (w >= 2 && w <= 4) return d; } };
async function signup(name, email, extra = {}) { const r = await post("/api/signup", { name, email, password: "long-password-1", ...extra }); assert.ok(r.ok, await r.clone().text()); return r.headers.get("set-cookie").split(";")[0]; }
async function openDemo(q = "", cookie) { const r = await get("/teams/demo" + q, cookie); assert.equal(r.status, 302, await r.clone().text()); return { to: r.headers.get("location"), cookie: cookieOf(r) || cookie }; }
const snapshot = () => new Map(srv.store.dumpPrefix("").map((d) => [d.path, JSON.stringify(d.data)]));

before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "demo-secret-0123456789"; process.env.ENCORE_SIGNUP_PER_HOUR = "200"; process.env.ENCORE_FAKE_EMAIL = "1"; process.env.ENCORE_FAKE_SMS = "1"; process.env.ENCORE_ADMIN_EMAILS = "admin.demo@example.com"; delete process.env.ENCORE_HIDE_DEMO; });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_SMS", "ENCORE_ADMIN_EMAILS"]) delete process.env[k]; await srv.close(); });

test("the demo opens signed out, each path straight from a short link, with a seeded brand account and the guide", async () => {
  for (const [p, re] of [["", /^\/teams\/home\?tour=menu/], ["?path=find", /^\/teams\/discover\?tour=find&.*goal=customer/], ["?path=book", /^\/teams\/home\?tour=book&/], ["?path=gift", /^\/teams\/demo\/gifts\?tour=gift/]]) {
    const D = await openDemo(p); assert.match(D.to, re); assert.ok(D.cookie, "signed in to the sandbox"); }
  const D = await openDemo("?path=book"), S = await ok(await get("/api/teams/demo/state", D.cookie));
  assert.equal(S.company, "Fernlight"); assert.equal(S.team.length, 3); assert.ok(S.campaign && S.past && S.next && S.shortlist);
  const home = await (await get("/teams/home", D.cookie)).text(); assert.match(home, /teams-demo\.js/, "the guide is on the demo's pages");
  const c = await signup("Real Brand", "real.brand@example.com", { mode: "work", company: "Realco" }); assert.doesNotMatch(await (await get("/teams/home", c)).text(), /teams-demo\.js/, "and never on anyone else's");
  // the history is on example hosts, and it tells one story: a past bakery night with a report, a booked coffee pop-up, a campaign in progress
  const R = await ok(await get("/api/bb/requests", D.cookie)); assert.equal(R.requests.length, 2);
  assert.deepEqual(R.requests.map((r) => r.status).sort(), ["booked", "done"]); assert.ok(R.requests.every((r) => ["rise-and-crumb", "phin-and-night"].includes(r.handle)));
  // with brand photography on the brief, the invite says photos are taken and how to opt out
  const cg = await ok(await get(`/api/cg/${S.campaign}`)); assert.match(cg.events.find((e) => e.id === S.next).photos, /photographer.*left out/);
  const O = await ok(await get(`/api/campaigns/${S.campaign}/outcomes`, D.cookie)); const txt = JSON.stringify(O);
  assert.match(txt, /Larkspur Labs/); assert.ok(/"meetings"/.test(txt));
  // a signed-in real person is asked first
  const r = await get("/teams/demo", c); assert.equal(r.status, 200); assert.match(await r.text(), /signs you out/);
});

test("book path: Quick book a customer dinner, the teammate's OK, the host's side, accepted, the guest list; nothing sent or charged", async () => {
  const D = await openDemo("?path=book"), S0 = await ok(await get("/api/teams/demo/state", D.cookie)), mails = fakeOutbox.length, texts = fakeTexts.length, date = weekdayAfter(30);
  const Q = await ok(await get(`/api/teams/quick?date=${date}&people=12&budget=200&city=New%20York&goal=customer`, D.cookie));
  const m = Q.results.find((x) => x.handle === "marlow-table"); assert.ok(m, Q.results.map((x) => x.handle).join(", ")); assert.equal(Q.demo, true); assert.equal(m.approval.needed, true, "over $1,500 needs Priya");
  const brief = { ...Q.brief.defaults, goal: "customer", mix: { brand: 12, host: 0 }, plan: "One table, a question for each course." };
  const j = await ok(await post("/api/bb/requests", { handle: m.handle, pkg: m.pkg, headcount: 12, date, single: true, goal: "customer", brief, via: "quick" }, D.cookie)); assert.equal(j.status, "approval");
  let a = await ok(await post("/api/teams/demo/act", { act: "approve", id: j.id }, D.cookie)); assert.equal(a.status, "requested");
  const H = await ok(await get(`/api/teams/demo/host/${j.id}`, D.cookie)); assert.equal(H.canAccept, true); assert.equal(H.request.statusText, "New request"); assert.equal(H.request.contact, null, "no contact details before booking"); assert.equal(H.brief.goal, "customer");
  a = await ok(await post("/api/teams/demo/act", { act: "accept", id: j.id }, D.cookie)); assert.equal(a.status, "booked"); assert.match(a.campaign, /\/invite$/);
  const R = (await ok(await get(`/api/bb/requests/${j.id}`, D.cookie))).request; assert.equal(R.status, "booked");
  const raw = srv.store.get("system/bbreq-" + j.id).data; assert.equal(raw.demo, true); assert.ok((raw.payments || []).every((p) => ["demo", "fake"].includes(p.provider)), "nothing charged");
  const cid = a.campaign.split("/")[3], C = await ok(await get(`/api/campaigns/${cid}`, D.cookie)); assert.ok(JSON.stringify(C).includes("Ana Ortiz"), "the guest list has people on it");
  // invites in the demo send nothing
  await post(`/api/campaigns/${cid}/invites`, { event: j.id, all: true }, D.cookie);
  assert.equal(fakeOutbox.length, mails, "no emails"); assert.equal(fakeTexts.length, texts, "no texts");
  // the report of the past event
  assert.equal((await get(`/teams/campaigns/${S0.campaign}/measure`, D.cookie)).status, 200);
});

test("find and gift paths work on example data; the demo can't touch a real host", async () => {
  const D = await openDemo("?path=find"), S = await ok(await get("/api/teams/demo/state", D.cookie));
  const X = await ok(await get("/api/bb/x/marlow-table/mtasting?people=12", D.cookie)); assert.equal(X.example.demo, true, "in the demo the example can be walked to the end");
  const L = await ok(await post(`/api/bb/shortlists/${S.shortlist}/items`, { handle: "marlow-table", pkg: "mtasting", people: 12 }, D.cookie)); assert.equal(L.items.length, 2); assert.ok(L.votes["koji-counter/komakase"].n >= 1, "Priya voted");
  assert.equal((await get(`/teams/list/${S.shortlist}/compare`, D.cookie)).status, 200);
  // gifts: recipients, a maker's gift, a note, the plan and cost, sent, the recipient's page
  const G = await ok(await get("/api/teams/demo/gifts", D.cookie)); assert.ok(G.gifts.length >= 4 && G.recipients.length >= 6);
  const to = G.recipients.slice(0, 3).map((r) => r.id), P = await ok(await post("/api/teams/demo/gifts/plan", { gift: "bread", to }, D.cookie));
  assert.equal(P.plan.rows.length, 3); assert.equal(P.plan.totalCents, P.plan.rows.reduce((s, r) => s + r.cents, 0)); assert.ok(P.plan.rows.some((r) => /courier is New York only/.test(r.method)) || G.recipients.slice(0, 3).every((r) => r.city === "New York"));
  assert.equal((await post("/api/teams/demo/gifts", { gift: "bread", to, note: "" }, D.cookie)).status, 400, "a note first");
  const sent = await ok(await post("/api/teams/demo/gifts", { gift: "bread", to, note: "Thank you for coming to the bakery night." }, D.cookie)); assert.match(sent.message, /nothing was ordered, charged or shipped/);
  const V = await ok(await get(sent.view.replace("/teams/demo/gift/", "/api/teams/demo/gift/"), D.cookie)); assert.equal(V.note, "Thank you for coming to the bakery night."); assert.match(V.address, /never sees it/);
  assert.equal((await get(sent.view.replace("/teams/demo/gift/", "/api/teams/demo/gift/"))).status, 404, "the gift link is the demo's own");
  // a real host is out of the demo's reach
  const hc = await signup("Real Host", "real.host.demo@example.com", { mode: "friends" });
  await ok(await post("/api/host/profile", { handle: "real-demo-host", name: "A Real Table", city: "New York", forHire: true }, hc));
  await ok(await post("/api/bb/host/setup", { on: true, city: "New York", area: "Greenpoint", packages: [{ name: "Dinner", story: "A dinner.", perPersonCents: 5000, minGuests: 4, maxGuests: 20, weekdays: [0, 1, 2, 3, 4, 5, 6], leadDays: 1 }] }, hc));
  const pk = (await ok(await get("/api/bb/hostpkgs/real-demo-host"))).packages[0].id;
  const no = await post("/api/bb/requests", { handle: "real-demo-host", pkg: pk, headcount: 8, date: weekdayAfter(10) }, D.cookie); assert.equal(no.status, 403); assert.equal((await no.json()).code, "demo");
  assert.equal((await ok(await get("/api/bb/host/requests", hc))).requests.length, 0, "the real host got nothing");
  const fr = await ok(await post("/api/bb/find-real-host", { handle: "marlow-table", pkg: "mtasting" }, D.cookie)); assert.equal(fr.demo, true, "the demo's find-a-host request isn't sent");
});

test("sandboxed: everything the demo writes is its own, other brands and the admin numbers never see it", async () => {
  const before = snapshot(), mails = fakeOutbox.length;
  const D = await openDemo("?path=book"), S = await ok(await get("/api/teams/demo/state", D.cookie));
  const me = await ok(await get("/api/bb/requests", D.cookie)), ids = new Set(me.requests.map((r) => r.id)), demoWs = srv.store.get("system/bbreq-" + me.requests[0].id).data.brandWs;
  const after = snapshot(), mine = (p, d) => p.startsWith(`ws/${demoWs}/`) || p === `system/ws-${demoWs}` || d?.ws === demoWs || d?.brandWs === demoWs || [...ids].some((id) => p.endsWith(id)) || (d?.kind === "bpsv" && ids.has(d.reqId)) || /^system\/(sess|session|rl|rate)/.test(p);
  const strays = [...after].filter(([p, v]) => before.get(p) !== v && !mine(p, JSON.parse(v))).map(([p]) => p);
  assert.deepEqual(strays, [], "no writes outside the demo's own docs"); assert.equal(fakeOutbox.length, mails, "no emails");
  // other brands and the admin numbers can't see the demo's bookings
  const c = await signup("Other Brand", "other.brand.demo@example.com", { mode: "work", company: "Otherco" }); assert.equal((await ok(await get("/api/bb/requests", c))).requests.length, 0);
  const A = await signup("Ad Min", "admin.demo@example.com", { mode: "work", company: "Pottery Lab" }); const M = JSON.stringify(await ok(await get("/api/admin/brand-metrics", A)));
  for (const id of ids) assert.ok(!M.includes(id), "admin metrics leave the demo out");
});

test("reset and the daily sweep throw a sandbox away, with everything in it", async () => {
  const D = await openDemo("?path=book"), r1 = await ok(await get("/api/bb/requests", D.cookie)), ws1 = srv.store.get("system/bbreq-" + r1.requests[0].id).data.brandWs;
  const R = await openDemo("?path=book&reset=1", D.cookie); assert.notEqual(R.cookie, D.cookie);
  assert.equal(getWorkspace(ws1), null, "the old sandbox is gone"); assert.equal(srv.store.get("system/bbreq-" + r1.requests[0].id), null, "and its bookings");
  const r2 = await ok(await get("/api/bb/requests", R.cookie)); assert.equal(r2.requests.length, 2, "a fresh one, seeded again"); const ws2 = srv.store.get("system/bbreq-" + r2.requests[0].id).data.brandWs;
  updateWorkspace(ws2, { demoAt: Date.now() - 2 * 864e5 }); const n = srv.app.locals.brandDemo.sweep(); assert.ok(n >= 1); assert.equal(getWorkspace(ws2), null, "a day old: swept");
  assert.equal((await get("/api/teams/demo/state", R.cookie)).status, 401);
  process.env.ENCORE_HIDE_DEMO = "1"; assert.equal((await get("/teams/demo")).status, 404, "ENCORE_HIDE_DEMO turns the demo off"); delete process.env.ENCORE_HIDE_DEMO;
});
