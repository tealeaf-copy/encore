// Review round 3, paid spots: a guest may say "I paid" (paidClaim: true) on their own reply and nothing more about money;
// the host still confirms `paid`. The public event read still carries the pay link, so the host copy says so honestly.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";

let srv, cookie, ws;
const J = { "content-type": "application/json" };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const invite = fs.readFileSync(new URL("../public/invite.html", import.meta.url), "utf8");
const spa = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
before(async () => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "paid-secret"; process.env.ENCORE_FAKE_EMAIL = "1"; resetLoginLimits(); srv = await startServer();
  const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name: "Mina Park", email: "mina.paid@example.com", password: "long-password-1", mode: "friends" }) });
  cookie = r.headers.get("set-cookie").split(";")[0];
  const put = (id, d) => fetch(srv.base + "/api/db/doc?path=events/" + id, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(d) });
  await put("paid1", { kind: "social", casual: true, name: "Wheel night", date: day(6), published: true, headcount: 10, price: "$20", ticketUrl: "https://venmo.com/u/mina" });
  await put("paidask1", { kind: "social", casual: true, name: "Glaze club", date: day(6), published: true, headcount: 10, approvalRequired: true, price: "$30", ticketUrl: "https://venmo.com/u/mina" });
  ws = (await (await fetch(srv.base + "/api/db/doc?path=events/paid1", { headers: { "x-encore-guest": "1" } })).json()).workspace; });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv.close(); });

const G = (key) => ({ ...J, "x-encore-guest": "1", "x-encore-key": key, "x-encore-workspace": ws });
const reply = async (key, body) => { const r = await fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: G(key), body: JSON.stringify(body) }); const j = await r.json(); return { status: r.status, id: String(j.id || "").split("/").pop(), j }; };
const patch = (key, id, body) => fetch(srv.base + "/api/db/doc?path=rsvps/" + id, { method: "PATCH", headers: G(key), body: JSON.stringify(body) });
const hostRead = async (id) => (await (await fetch(srv.base + "/api/db/doc?path=rsvps/" + id, { headers: { cookie } })).json()).data;

test("a first reply can't arrive already paid or claiming to have paid", async () => {
  const a = await reply("pk-a", { eventId: "paid1", response: "going", name: "Ana", email: "ana@example.com", code: "AN123", paid: true, paidClaim: true, paidAt: Date.now() });
  assert.equal(a.status, 200);
  const d = await hostRead(a.id);
  assert.equal(d.paid, undefined); assert.equal(d.paidClaim, undefined); assert.equal(d.paidAt, undefined);
});

test("a guest can say I paid on their own reply, and nothing else about money", async () => {
  const a = await reply("pk-b", { eventId: "paid1", response: "going", name: "Ben", email: "ben@example.com", code: "BE123" });
  const r = await patch("pk-b", a.id, { paidClaim: true, paid: true, paidAt: 1, letInAt: 1, checkedIn: true, changedAt: Date.now() });
  assert.equal(r.status, 200);
  const d = await hostRead(a.id);
  assert.equal(d.paidClaim, true); assert.ok(d.paidClaimAt > 0, "the server stamps when");
  for (const k of ["paid", "paidAt", "letInAt", "checkedIn"]) assert.equal(d[k], undefined, k + " stays the host's");
  assert.equal(d.response, "going");
  // only true counts; a string or false is dropped, and a stamp can't be forged
  const b = await reply("pk-c", { eventId: "paid1", response: "going", name: "Cy", email: "cy@example.com", code: "CY123" });
  await patch("pk-c", b.id, { paidClaim: "yes", paidClaimAt: 5 });
  const db = await hostRead(b.id); assert.equal(db.paidClaim, undefined); assert.equal(db.paidClaimAt, undefined);
  // the guest's reply page reads the claim back
  const st = await (await fetch(`${srv.base}/api/public/reply/paid1?rid=${a.id}&code=BE123`)).json();
  assert.equal(st.paidClaim, true); assert.equal(st.paid, false);
  // the host confirms with the existing paid toggle
  const h = await fetch(srv.base + "/api/db/doc?path=rsvps/" + a.id, { method: "PATCH", headers: { ...J, cookie }, body: JSON.stringify({ paid: true, paidAt: Date.now() }) });
  assert.equal(h.status, 200); assert.equal((await hostRead(a.id)).paid, true);
});

test("a guest can't claim to have paid on someone else's reply", async () => {
  const a = await reply("pk-d", { eventId: "paid1", response: "going", name: "Dee", email: "dee@example.com", code: "DE123" });
  const r = await patch("pk-other", a.id, { paidClaim: true });
  assert.equal(r.status, 403);
  assert.equal((await hostRead(a.id)).paidClaim, undefined);
  // nor create a reply through PUT with the claim already on it
  const p = await fetch(srv.base + "/api/db/doc?path=rsvps/fresh123", { method: "PUT", headers: G("pk-e"), body: JSON.stringify({ eventId: "paid1", response: "going", name: "Eve", paidClaim: true }) });
  if (p.status === 200) assert.equal((await hostRead("fresh123")).paidClaim, undefined);
});

test("the public event read still carries the pay link, so the host copy doesn't promise it's hidden", async () => {
  const e = (await (await fetch(srv.base + "/api/db/doc?path=events/paidask1", { headers: { "x-encore-guest": "1" } })).json()).data;
  assert.equal(e.ticketUrl, "https://venmo.com/u/mina", "not stripped: the full and light invites both read it");
  assert.equal(e.payLinkSent, undefined); assert.equal(e.ticketUrlAt, undefined);
  assert.doesNotMatch(spa, /Guests see (it|the link) once they're in/);
  assert.match(spa, /Guests get a Pay button once they're in\. Anyone with the invite can find the link\./);
});

test("the pages ask for a way to reach guests when there's no pay link, and build the Venmo link", () => {
  assert.match(invite, /So \$\{esc\(first\)\} can send you a way to pay\./);
  assert.match(invite, /Add an email or phone, so \$\{first\} can send you a way to pay\./);
  assert.match(invite, /txn=pay&amount=\$\{amt\}&note=/);
  assert.match(invite, /paidClaim: true/);
  assert.match(spa, /So \$\{w\} can send you a way to pay\./);
  assert.match(spa, /How do guests pay\?/);
  assert.match(spa, /Send the pay link to \$\{R\.length\} guest/);
  assert.match(spa, /says paid/);
  for (const t of [invite, spa.slice(spa.indexOf("review round 3: paid spots"))]) assert.doesNotMatch(t, /—/, "no em dashes");
});
