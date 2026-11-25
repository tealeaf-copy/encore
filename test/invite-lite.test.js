// The light invite (/e/<id>) is a reply page on its own: it posts what the full invite posts, to the same endpoint, so
// Ask to join, spots and the waitlist all apply. Ask to join events reply here too instead of loading the whole app.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";

let srv;
const J = { "content-type": "application/json" };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const html = fs.readFileSync(new URL("../public/invite.html", import.meta.url), "utf8");
before(async () => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "lite-secret"; process.env.ENCORE_FAKE_EMAIL = "1"; resetLoginLimits(); srv = await startServer(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv.close(); });

// what the light page does: read the event as a guest, then POST the reply with its guest key and workspace
async function liteReply(eventId, key, { name, contact = "", resp = "going", dietary = "" }) {
  const doc = await (await fetch(srv.base + "/api/db/doc?path=" + encodeURIComponent("events/" + eventId), { headers: { "x-encore-guest": "1" } })).json();
  const e = doc.data, ws = doc.workspace, ask = !!e.approvalRequired;
  const email = contact && (/@/.test(contact) || !/\d{6,}/.test(contact.replace(/[^\d]/g, ""))) ? contact : "", phone = !email && contact ? contact.replace(/[^\d+]/g, "") : "";
  const data = { eventId, response: ask && resp !== "no" ? "requested" : resp, name, email, ...(phone ? { phone, contactVia: "sms" } : email ? { contactVia: "email" } : {}), dietary, code: "AB123", createdAt: Date.now(), via: "invite-lite" };
  const r = await fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, "x-encore-guest": "1", "x-encore-key": key, "x-encore-workspace": ws }, body: JSON.stringify(data) });
  return { status: r.status, j: await r.json() };
}

test("the light invite records an Ask to join reply as requested and a plain one as going", async () => {
  const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name: "Maya Chen", email: "maya.lite@example.com", password: "long-password-1", mode: "friends" }) });
  const c = r.headers.get("set-cookie").split(";")[0];
  const put = (id, d) => fetch(srv.base + "/api/db/doc?path=events/" + id, { method: "PUT", headers: { ...J, cookie: c }, body: JSON.stringify(d) });
  await put("lask1", { kind: "social", casual: true, name: "Dumpling supper", date: day(6), published: true, approvalRequired: true, headcount: 10 });
  await put("lopen1", { kind: "social", casual: true, name: "Wheel night", date: day(6), published: true, headcount: 10 });

  const a = await liteReply("lask1", "lite-key-a", { name: "Priya", contact: "priya@example.com", dietary: "No pork" });
  assert.equal(a.status, 200); assert.equal(a.j.response, "requested", "Ask to join is a request until the host lets them in");
  // a plain "going" on an Ask to join event is still a request (the server decides, not the page)
  const g = await fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, "x-encore-guest": "1", "x-encore-key": "lite-key-b", "x-encore-workspace": (await (await fetch(srv.base + "/api/db/doc?path=events/lask1", { headers: { "x-encore-guest": "1" } })).json()).workspace }, body: JSON.stringify({ eventId: "lask1", response: "going", name: "Ben", email: "ben@example.com" }) });
  assert.equal((await g.json()).response, "requested");

  const o = await liteReply("lopen1", "lite-key-c", { name: "Sam", contact: "(415) 555 0101" });
  assert.equal(o.status, 200); assert.equal(o.j.response, "going");
  const saved = (await (await fetch(srv.base + "/api/db/doc?path=rsvps/" + String(o.j.id).split("/").pop(), { headers: { cookie: c } })).json()).data;
  assert.equal(saved.phone, "4155550101"); assert.equal(saved.contactVia, "sms");

  // the page is served compressed
  const p = await fetch(srv.base + "/e/lask1", { headers: { "accept-encoding": "br" }, redirect: "manual" });
  assert.equal(p.status, 200); assert.equal(p.headers.get("content-encoding"), "br");
});

test("the light invite page handles Ask to join itself and hands off only what it can't do", () => {
  assert.doesNotMatch(html, /e\.casual \|\| e\.approvalRequired \|\|/, "Ask to join no longer bounces to the full invite");
  assert.match(html, /e\.approvalRequired && paidOf\(e\)\)\) return go\(\)/, "paid Ask to join still opens the full invite");
  assert.match(html, /"Ask to join"/);
  assert.match(html, /So you hear when \$\{esc\(first\)\} lets you in\./);
  assert.match(html, /ask && !email && !phone/, "an email or phone is required on Ask to join");
  assert.match(html, /asked \? "Asked"/); assert.match(html, /\$\{who\} will tell you here\./);
  assert.match(html, /Open the full invite/);
  assert.doesNotMatch(html, /—/, "no em dashes");
  assert.ok(!fs.existsSync(new URL("../public/e-go.js", import.meta.url)), "no automatic redirect script");
});
