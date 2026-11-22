import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";

let srv;
const J = { "content-type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (path, cookie) => fetch(srv.base + path, { headers: cookie ? { cookie } : {} });
const put = (path, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
const join = async (name, email) => { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); const b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); return { cookie: cookieOf(r), ws: b.workspace.id }; };
const guest = (ws, body) => fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, "x-encore-guest": "1", "x-encore-key": "k" + Math.random().toString(36).slice(2), "x-encore-workspace": ws }, body: JSON.stringify({ createdAt: Date.now(), ...body }) });
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "hosts-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; process.env.ENCORE_FAKE_EMAIL = "1"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv.close(); });

test("Claire: broadcast to the people it suits, a hype report, approval before the chat, polls for help, tips, and brands hiring her", async () => {
  const claire = await join("Claire Kim", "claire@example.com"), dev = await join("Dev Rao", "dev@example.com"), ana = await join("Ana Diaz", "ana@example.com");
  // Dev lives in New York and wants hikes; Ana is in Sydney
  assert.equal((await post("/api/me/alerts", { text: "hikes on weekends in New York", city: "New York" }, dev.cookie)).status, 200);
  assert.equal((await post("/api/host/profile", { city: "New York", tags: ["running", "hiking"] }, dev.cookie)).status, 200);
  assert.equal((await post("/api/host/profile", { city: "Sydney" }, ana.cookie)).status, 200);
  const ev = { name: "Upstate hike", activity: "hike", kind: "social", casual: true, city: "New York", stage: "interest", dateOptions: [day(10), day(11)], interestGoal: 3, audienceWho: "Run club members who like hiking", approvalRequired: true };
  assert.equal((await put("events/hike1", ev, claire.cookie)).status, 200);
  const aud = await (await get("/api/host/audience/hike1", claire.cookie)).json();
  assert.equal(aud.count, 1, JSON.stringify(aud)); assert.equal(aud.sample[0].name, "Dev");
  const bc = await (await post("/api/host/broadcast", { eventId: "hike1" }, claire.cookie)).json();
  assert.equal(bc.reached, 1);
  assert.ok((await (await get("/api/me/inbox", dev.cookie)).json()).items.some((n) => n.kind === "invite" && /Upstate hike/.test(n.text)));
  assert.ok(!(await (await get("/api/me/inbox", ana.cookie)).json()).items.some((n) => n.kind === "invite"), "Sydney isn't told about a New York hike");
  // interest comes in; the page is viewed
  await post("/api/public/view/hike1", {}); await post("/api/public/view/hike1", {});
  const r1 = await (await guest(claire.ws, { eventId: "hike1", name: "Dev Rao", email: "dev@example.com", response: "maybe", interest: "in", dates: [day(10)], code: "DR1" })).json();
  await guest(claire.ws, { eventId: "hike1", name: "Sam Lee", email: "sam@example.com", response: "maybe", interest: "maybe", dates: [day(10), day(11)], code: "SL1" });
  const hype = await (await get("/api/host/hype/hike1", claire.cookie)).json();
  assert.equal(hype.views, 2); assert.equal(hype.in, 1); assert.equal(hype.maybe, 1); assert.equal(hype.bestDate.date, day(10)); assert.equal(hype.bestDate.yes, 2); assert.equal(hype.reached, 1);
  // a requested spot can't see the chat until Claire approves
  const req1 = await (await guest(claire.ws, { eventId: "hike1", name: "Kim Ho", email: "kim@example.com", response: "requested", code: "KH1" })).json();
  assert.equal((await get(`/api/public/chat/hike1?rid=${req1.id}&code=KH1`)).status, 403);
  const cur = (await (await get("/api/db/doc?path=rsvps/" + req1.id, claire.cookie)).json());
  assert.equal((await fetch(srv.base + "/api/db/doc?path=rsvps/" + req1.id, { method: "PATCH", headers: { ...J, cookie: claire.cookie }, body: JSON.stringify({ response: "going" }) })).status, 200, JSON.stringify(cur));
  assert.equal((await get(`/api/public/chat/hike1?rid=${req1.id}&code=KH1`)).status, 200, "approved, so they're in the chat");
  // a poll for help
  const poll = await (await post("/api/host/poll", { eventId: "hike1", q: "Who can help?", options: ["Drive a car", "Bring snacks"], help: true }, claire.cookie)).json();
  assert.equal((await post(`/api/public/poll/${poll.id}/vote`, { eventId: "hike1", rid: req1.id, code: "KH1", option: "Drive a car" })).status, 200);
  assert.equal((await post(`/api/public/poll/${poll.id}/vote`, { eventId: "hike1", rid: r1.id, code: "DR1", option: "Drive a car" })).status, 403, "maybes can't vote");
  const chat = await (await get(`/api/public/chat/hike1?rid=${req1.id}&code=KH1`)).json();
  const pm = chat.messages.find((m) => m.poll); assert.deepEqual(pm.poll.votes["Drive a car"], ["Kim"]); assert.deepEqual(pm.poll.myVotes, ["Drive a car"]); assert.ok(!JSON.stringify(chat).includes(req1.id), "no guest ids leak");
  assert.ok((await (await get("/api/me/inbox", claire.cookie)).json()).items.some((n) => n.kind === "help"));
  // tips after the day
  assert.equal((await post("/api/public/tipped", { eventId: "hike1", rid: req1.id, code: "KH1", amount: 10 })).status, 200);
  assert.ok((await (await get("/api/me/inbox", claire.cookie)).json()).items.some((n) => n.kind === "tip" && /\$10/.test(n.text)));
  // brands find Claire and send an inquiry
  assert.equal((await post("/api/host/profile", { forHire: true, city: "New York", services: "Run club activations, group hikes, supper clubs", venmo: "@claire-runs" }, claire.cookie)).status, 200);
  const dir = await (await get("/api/public/hosts?city=new york")).json();
  assert.equal(dir.hosts.length, 1); assert.equal(dir.hosts[0].name, "Claire Kim");
  const handle = dir.hosts[0].handle;
  assert.equal((await post("/api/public/inquiry/" + handle, { name: "Jo", company: "Trail Co", email: "jo@trail.example", message: "We'd love you to host a launch run for our new shoe." })).status, 200);
  assert.equal((await post("/api/public/inquiry/" + handle, { email: "bad", message: "hi" })).status, 400);
  const inq = await (await get("/api/host/inquiries", claire.cookie)).json(); assert.equal(inq.inquiries[0].company, "Trail Co");
  const eh = await (await get("/api/public/event-host/hike1")).json(); assert.equal(eh.host.venmo, "claire-runs");
});

test("Eric: followers get first dibs on a ticketed dinner", async () => {
  const eric = await join("Eric Tan", "eric@example.com");
  const handle = (await (await get("/api/host/profile", eric.cookie)).json()).host.handle;
  assert.equal((await put("events/omakase1", { name: "Omakase at home", activity: "cooking night", kind: "social", casual: true, date: day(14), headcount: 12, price: "$65", earlyUntil: new Date(Date.now() + 2 * 864e5).toISOString(), courses: ["Hamachi crudo", "Miso black cod"] }, eric.cookie)).status, 200);
  const stranger = await guest(eric.ws, { eventId: "omakase1", name: "Pat", email: "pat@example.com", response: "going", code: "P1" });
  assert.equal(stranger.status, 403); assert.equal((await stranger.json()).code, "early_access");
  assert.equal((await post("/api/public/follow", { handle, email: "pat@example.com", name: "Pat" })).status, 200);
  assert.equal((await guest(eric.ws, { eventId: "omakase1", name: "Pat", email: "pat@example.com", response: "going", code: "P1" })).status, 200, "followers can book");
  const pub = await (await fetch(srv.base + "/api/db/doc?path=events/omakase1", { headers: { "x-encore-guest": "1" } })).json();
  assert.deepEqual(pub.data.courses, ["Hamachi crudo", "Miso black cod"]); assert.ok(pub.data.earlyUntil);
});

test("Storefronts: curated theme with guardrails, https-only links, the /@handle URL, and signed-in members can open guest links", async () => {
  const jo = await join("Jo Park", "jo@example.com"), kim = await join("Kim Ho", "kim2@example.com");
  const ok = await (await post("/api/host/profile", { handle: "jo-bakes", theme: { accent: "#3E9C6E", font: "playful", bg: "night", cover: "dots", buttons: "square", avatarUrl: "javascript:alert(1)" }, links: [{ label: "Instagram", url: "https://instagram.com/jobakes" }], tagline: "Bread on Sundays", sections: { kudos: false } }, jo.cookie)).json();
  assert.equal(ok.host.theme.accent, "#3E9C6E"); assert.equal(ok.host.theme.font, "playful"); assert.equal(ok.host.theme.avatarUrl, "", "only uploaded photos"); assert.equal(ok.host.sections.kudos, false); assert.equal(ok.host.tagline, "Bread on Sundays");
  const off = await (await post("/api/host/profile", { theme: { accent: "#123456", font: "comic-sans" } }, jo.cookie)).json();
  assert.equal(off.host.theme.accent, "#3E9C6E", "colours outside the set are ignored"); assert.equal(off.host.theme.font, "playful");
  assert.equal((await post("/api/host/profile", { links: [{ label: "x", url: "http://bad.example" }] }, jo.cookie)).status, 400);
  assert.equal((await get("/@jo-bakes")).status, 200);
  // a signed-in member opening someone else's invite is a guest there
  assert.equal((await put("events/bread1", { name: "Sourdough Sunday", activity: "bake", kind: "social", casual: true, date: day(5) }, jo.cookie)).status, 200);
  const r = await fetch(srv.base + "/api/db/doc?path=events/bread1", { headers: { cookie: kim.cookie, "x-encore-guest": "1" } });
  assert.equal(r.status, 200); assert.equal((await r.json()).data.name, "Sourdough Sunday");
});
