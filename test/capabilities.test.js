import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";

let srv;
const J = { "Content-Type": "application/json" };
const realFetch = globalThis.fetch;
let calls = [];
// Provider calls (email services, HubSpot) are mocked; requests to the test server go through.
const mock = (handler) => { globalThis.fetch = async (url, init = {}) => { const u = String(url); if (u.startsWith(srv.base)) return realFetch(url, init); calls.push({ url: u, init }); return handler(u, init); }; };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (path, cookie) => fetch(srv.base + path, { headers: cookie ? { cookie } : {} });
const put = (path, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
async function signup(company, email, name) {
  const r = await post("/api/signup", { name: name || company + " Owner", email, company, password: "long-password-1" });
  return { cookie: cookieOf(r), ws: (await r.json()).workspace.id };
}
async function member(owner, email, name, role) {
  const { token } = await (await post("/api/invite", { email, role }, owner.cookie)).json();
  return cookieOf(await post("/api/join", { token, name, password: "member-password-1" }));
}

before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "cap-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; delete process.env.ENCORE_FAKE_EMAIL; resetLoginLimits(); calls = []; });
afterEach(() => { globalThis.fetch = realFetch; });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv.close(); });

test("email: each workspace connects its own sending key; it's checked, encrypted, and used to send from Encore", async () => {
  const A = await signup("Mailco", "ria@mailco.com", "Ria Shah");
  assert.equal((await (await get("/api/email/status", A.cookie)).json()).enabled, false);
  assert.equal((await post("/api/email/send", { to: "x@y.com", subject: "Hi", text: "Hello" }, A.cookie)).status, 409, "not set up yet");
  mock((u, init) => (init.headers?.Authorization === "Bearer re_good" ? reply(200, { data: [] }) : reply(401, { message: "bad key" })));
  const bad = await post("/api/connections", { provider: "email", service: "resend", key: "re_bad", from: "events@mailco.com" }, A.cookie);
  assert.equal(bad.status, 400); assert.equal((await bad.json()).code, "invalid_token");
  assert.equal((await post("/api/connections", { provider: "email", service: "carrier-pigeon", key: "x", from: "events@mailco.com" }, A.cookie)).status, 400);
  assert.equal((await post("/api/connections", { provider: "email", service: "resend", key: "re_good", from: "not-an-email" }, A.cookie)).status, 400);
  const ok = await post("/api/connections", { provider: "email", service: "resend", key: "re_good", from: "events@mailco.com" }, A.cookie);
  assert.equal(ok.status, 200);
  assert.equal(JSON.stringify(await (await get("/api/connections", A.cookie)).json()).includes("re_good"), false, "key never served");
  assert.deepEqual(await (await get("/api/email/status", A.cookie)).json(), { enabled: true, service: "resend", from: "events@mailco.com" });
  // a teammate who isn't the owner can't change the connection
  const sam = await member(A, "sam@mailco.com", "Sam Lee", "AE");
  assert.equal((await post("/api/connections", { provider: "email", service: "resend", key: "re_x", from: "a@mailco.com" }, sam)).status, 403);
  calls = []; mock(() => reply(200, { id: "msg_1" }));
  const s = await post("/api/email/send", { to: "dana@client.com", subject: "Your seat", text: "Hello Dana", eventId: "ev1", kind: "invite" }, A.cookie);
  assert.equal(s.status, 200);
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.deepEqual(sent.to, ["dana@client.com"]); assert.equal(sent.reply_to, "ria@mailco.com"); assert.equal(sent.from, "Ria Shah at Mailco <events@mailco.com>");
  const box = (await (await get("/api/email/outbox?eventId=ev1", A.cookie)).json()).messages;
  assert.equal(box[0].status, "sent"); assert.equal(box[0].kind, "invite");
  assert.equal((await put("outbox/forged", { status: "sent" }, A.cookie)).status, 403, "outbox is server-written only");
  assert.equal((await post("/api/email/send", { to: "bad", subject: "x", text: "y" }, A.cookie)).status, 400);
  assert.equal((await post("/api/email/send", { to: ["a@b.co", "c@d.co", "e@f.co", "g@h.co", "i@j.co", "k@l.co"], subject: "x", text: "y" }, A.cookie)).status, 400);
  // provider failure is reported and logged
  mock(() => reply(422, { message: "domain not verified" }));
  const f = await post("/api/email/send", { to: "dana@client.com", subject: "x", text: "y" }, A.cookie);
  assert.equal(f.status, 502); assert.match((await f.json()).message, /domain not verified/);
});

test("sign-off requests are emailed from Encore with the signed link when email is set up", async () => {
  process.env.ENCORE_FAKE_EMAIL = "1";
  const { fakeOutbox } = await import("../server/email.js"); fakeOutbox.length = 0;
  const A = await signup("Signmail", "lead@signmail.com", "Lee Lead");
  await put("events/evM", { name: "CFO dinner", produce: { budget: [{ line: "Food", amount: 9000 }] }, updatedAt: 1 }, A.cookie);
  const r = await (await post("/api/signoff/request", { eventId: "evM", email: "dana@signmail.com", name: "Dana", message: "Please sign off: {{link}}" }, A.cookie)).json();
  assert.equal(r.emailed, true);
  assert.equal(fakeOutbox.length, 1); assert.deepEqual(fakeOutbox[0].to, ["dana@signmail.com"]);
  assert.ok(fakeOutbox[0].text.includes(`/g#signoff-evM-${r.request.id}~${r.token}`));
  const rm = await (await post("/api/signoff/remind", { eventId: "evM", id: r.request.id, message: "Reminder: {{link}}" }, A.cookie)).json();
  assert.equal(rm.emailed, true); assert.equal(fakeOutbox.length, 2); assert.match(fakeOutbox[1].subject, /^Reminder/);
});

test("deadline reminders: one email per owner for late and soon tasks, once a day, no Slack or AI", async () => {
  process.env.ENCORE_FAKE_EMAIL = "1";
  const { fakeOutbox } = await import("../server/email.js"); fakeOutbox.length = 0;
  const A = await signup("Remco", "ria@remco.com", "Ria Shah");
  const ae = await member(A, "sam@remco.com", "Sam Lee", "AE");
  const date = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  await put("events/evR", { name: "CIO dinner", date, owner: "Ria Shah", produce: { tasks: [{ days: -10, task: "Hold the venue", owner: "Event lead" }, { days: -4, task: "AE nominations in", owner: "Account execs" }, { days: -30, task: "Done already", owner: "Event lead" }, { days: -2, task: "Final headcount", owner: "Event lead" }, { days: -9, task: "Ghost task", owner: "Nobody" }] }, tasksDone: [2], updatedAt: 1 }, A.cookie);
  const pv = await (await get("/api/reminders", A.cookie)).json();
  assert.equal(pv.on, true);
  const byEmail = Object.fromEntries(pv.people.map((p) => [p.email, p]));
  assert.equal(byEmail["ria@remco.com"].count, 1, "venue is late; headcount is 3 days out so not yet");
  assert.match(byEmail["ria@remco.com"].text, /\d days late: Hold the venue/);
  assert.equal(byEmail["sam@remco.com"].count, 1); assert.match(byEmail["sam@remco.com"].text, /Due .*: AE nominations in/);
  assert.ok(pv.skipped.some((x) => /Ghost task/.test(x)));
  assert.equal(fakeOutbox.length, 0, "preview sends nothing");
  assert.equal((await post("/api/reminders", { sendNow: true }, ae)).status, 403, "only the owner runs or changes reminders");
  const run = await (await post("/api/reminders", { sendNow: true }, A.cookie)).json();
  assert.equal(run.sent, 2); assert.equal(fakeOutbox.length, 2);
  const again = await (await post("/api/reminders", { sendNow: true }, A.cookie)).json();
  assert.equal(again.sent, 0, "once a day"); assert.equal(fakeOutbox.length, 2);
  await post("/api/reminders", { on: false }, A.cookie);
  assert.equal((await (await post("/api/reminders", { sendNow: true, now: Date.now() + 864e5 }, A.cookie)).json()).off, true);
});

test("CRM writes: reads are open; writes need RevOps or go to RevOps for approval", async () => {
  const A = await signup("Crmco", "ria@crmco.com", "Ria Shah");
  mock(() => reply(200, { results: [] }));
  assert.equal((await post("/api/connections", { provider: "hubspot", token: "hs-good" }, A.cookie)).status, 200);
  const rev = await member(A, "omar@crmco.com", "Omar Ali", "RevOps");
  const input = { eventName: "CFO dinner", items: [{ email: "dana@client.com", subject: "Book a call" }] };
  // reads go straight through
  calls = []; mock(() => reply(200, { total: 0, results: [] }));
  assert.equal((await post("/api/mcp/call", { server: "HubSpot", tool: "search_crm_objects", input: { objectType: "companies" } }, A.cookie)).status, 200);
  assert.equal(calls.length, 1);
  // a marketer's write is queued, nothing reaches HubSpot
  calls = [];
  const q = await (await post("/api/mcp/call", { server: "HubSpot", tool: "log_followups", input }, A.cookie)).json();
  assert.equal(q.queued, true); assert.match(q.message, /RevOps/); assert.equal(calls.length, 0);
  const list = await (await get("/api/crmwrites", A.cookie)).json();
  assert.equal(list.canApprove, false); assert.equal(list.requests[0].status, "pending"); assert.match(list.requests[0].summary, /log 1 follow-up/);
  assert.equal(list.requests[0].input, undefined, "payload isn't echoed back");
  assert.equal((await post(`/api/crmwrites/${list.requests[0].id}`, { decision: "approve" }, A.cookie)).status, 403, "the marketer can't approve their own write");
  assert.equal((await put(`crmwrites/${list.requests[0].id}`, { status: "approved" }, A.cookie)).status, 403, "queue is server-written only");
  // RevOps approves: now it's written
  calls = []; mock(() => reply(200, { results: [] }));
  const ap = await post(`/api/crmwrites/${list.requests[0].id}`, { decision: "approve", note: "Looks clean" }, rev);
  assert.equal(ap.status, 200); assert.equal((await ap.json()).request.status, "approved");
  assert.ok(calls.length >= 1 && calls.every((c) => c.url.startsWith("https://api.hubapi.com")));
  assert.equal((await post(`/api/crmwrites/${list.requests[0].id}`, { decision: "reject" }, rev)).status, 409);
  // RevOps writes directly
  calls = [];
  const direct = await post("/api/mcp/call", { server: "HubSpot", tool: "log_followups", input }, rev);
  assert.equal(direct.status, 200); assert.equal((await direct.json()).queued, undefined); assert.ok(calls.length >= 1);
  const audit = (await (await get("/api/audit", A.cookie)).json()).entries.map((e) => e.what);
  assert.ok(audit.some((w) => /asked RevOps to approve a CRM write/.test(w)));
  assert.ok(audit.some((w) => /Omar Ali approved a CRM write.*Looks clean/.test(w)));
  assert.ok(audit.some((w) => /wrote to the CRM/.test(w)));
});

test("your data: the owner can export everything (no secrets) and delete the workspace", async () => {
  const A = await signup("Dataco", "own@dataco.com", "Dee Owner");
  const sam = await member(A, "sam@dataco.com", "Sam Lee", "AE");
  await put("events/evD", { name: "Dinner", guests: [{ name: "Ana", email: "ana@x.com" }], updatedAt: 1 }, A.cookie);
  assert.equal((await get("/api/workspace/export", sam)).status, 403, "only the owner");
  const ex = await (await get("/api/workspace/export", A.cookie)).json();
  assert.ok(ex.docs.some((d) => d.path === "events/evD" && d.data.guests[0].email === "ana@x.com"));
  assert.equal(JSON.stringify(ex).includes("passwordHash"), false);
  assert.ok(ex.members.some((m) => m.email === "sam@dataco.com"));
  assert.equal((await post("/api/workspace/delete", { confirm: "wrong" }, A.cookie)).status, 400);
  const del = await post("/api/workspace/delete", { confirm: "dataco" }, A.cookie);
  assert.equal(del.status, 200);
  assert.ok(!srv.store.get(`ws/${A.ws}/events/evD`), "event gone");
  assert.equal(srv.store.list("system").filter((d) => d.data?.ws === A.ws).length, 0, "members, tokens and connections gone");
  assert.notEqual((await get("/api/workspace", A.cookie)).status, 200, "old session no longer works");
});

test("RSVPs: seats are enforced on the server and each guest has one reply", async () => {
  const A = await signup("Seatco", "own@seatco.com", "Sia Owner");
  await put("events/evC", { name: "Dinner", headcount: 2, guests: [{ name: "Gia", email: "gia@x.com", status: "Going" }], updatedAt: 1 }, A.cookie);
  const g = (body) => fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, "x-encore-guest": "1", "x-encore-key": "k" + Math.random().toString(36).slice(2), "x-encore-workspace": A.ws }, body: JSON.stringify({ eventId: "evC", ...body }) });
  const r1 = await (await g({ name: "Ann", email: "ann@x.com", response: "going" })).json();
  assert.equal(r1.response, "going");
  const r2 = await (await g({ name: "Ben", email: "ben@x.com", response: "going" })).json();
  assert.equal(r2.response, "waitlist", "table of 2 is full (Gia + Ann)");
  const r3 = await (await g({ name: "Ann", email: "ANN@x.com", response: "no" })).json();
  assert.equal(r3.id, r1.id, "same guest updates the same reply"); assert.equal(r3.merged, true);
  const all = srv.store.list(`ws/${A.ws}/rsvps`).map((d) => d.data).filter((d) => d.eventId === "evC");
  assert.deepEqual(all.map((d) => `${d.name}=${d.response}`).sort(), ["Ann=no", "Ben=waitlist"]);
});

test("RSVPs: invited guests who say yes before the host opens the app still fill seats", async () => {
  const A = await signup("Seat2co", "own@seat2.com", "Sia Owner");
  await put("events/evS2", { name: "Dinner", headcount: 2, guests: [{ name: "Ana", email: "ana@x.com", status: "Invited" }, { name: "Bo", email: "bo@x.com", status: "Invited" }, { name: "Cy", email: "cy@x.com", status: "Invited" }], updatedAt: 1 }, A.cookie);
  const g = (body) => fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, "x-encore-guest": "1", "x-encore-key": "k" + Math.random().toString(36).slice(2), "x-encore-workspace": A.ws }, body: JSON.stringify({ eventId: "evS2", ...body }) });
  assert.equal((await (await g({ name: "Ana", email: "ana@x.com", response: "going" })).json()).response, "going");
  assert.equal((await (await g({ name: "Bo", email: "bo@x.com", response: "going" })).json()).response, "going");
  assert.equal((await (await g({ name: "Cy", email: "cy@x.com", response: "going" })).json()).response, "waitlist", "third yes for two seats");
  assert.equal((await (await g({ name: "Ana", email: "ana@x.com", response: "no" })).json()).merged, true);
  assert.equal((await (await g({ name: "Dee", email: "dee@x.com", response: "going" })).json()).response, "going", "Ana's seat freed up");
});
