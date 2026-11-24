import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { fakeTexts } from "../server/sms.js";

let srv;
const J = { "content-type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
const form = (path, fields) => fetch(srv.base + path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });

before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "sms-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; process.env.ENCORE_FAKE_SMS = "1"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_SMS"]) delete process.env[k]; await srv.close(); });

test("Texts around an event: a guest's ticket, the organizer's reminder with each guest's own code, the door's nudge, and STOP is respected everywhere", async () => {
  const h = await post("/api/signup", { name: "Sofia Text", email: "sofia.s@example.com", password: "long-password-1", mode: "friends" }); const hc = cookieOf(h);
  const pr = await (await post("/api/host/profile", { handle: "sofia-text", name: "Supper Text", experiences: [{ name: "Dinner", min: 4, max: 30, price: "$185 a person", category: "dining" }] }, hc)).json();
  const day = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  const bk = await (await post("/api/public/book/sofia-text", { name: "Sam", company: "Northwind", email: "sam.s@northwind.example", experienceId: pr.host.experiences[0].id, people: 12, date: day, time: "18:30", when: "soon", where: "Sofia's room", message: "Customer dinner for design partners." })).json();
  const id = bk.id, t = new URL(bk.status).searchParams.get("t");
  const eid = (await (await post(`/api/public/booking/${id}/event`, { t, title: "Northwind partner dinner", address: "3200 16th St" })).json()).link.split("rsvp-")[1];
  const guests = [["Rita", "+14155550101"], ["Omar", "+14155550102"], ["Lena", ""]], rids = [];
  for (const [i, [nm, ph]] of guests.entries()) rids.push((await (await post("/api/db/collection?path=rsvps", { eventId: eid, name: nm, email: `${nm.toLowerCase()}.s@example.com`, phone: ph, response: "going", code: "c" + i }, hc)).json()).id);

  // a guest texts themselves their ticket
  const n0 = fakeTexts.length;
  const tk = await (await fetch(`${srv.base}/api/public/ticket/${eid}?rid=${rids[2]}&code=c2`)).json(); assert.equal(tk.sms, true); assert.equal(tk.hasPhone, false);
  assert.equal((await post(`/api/public/ticket/${eid}/text`, { rid: rids[2], code: "wrong", phone: "+14155550103" })).status, 403);
  assert.equal((await post(`/api/public/ticket/${eid}/text`, { rid: rids[2], code: "c2", phone: "(415) 555-0103" })).status, 200);
  const ticketText = fakeTexts.slice(n0).find((x) => x.to === "+14155550103"); assert.ok(ticketText, "ticket texted"); assert.match(ticketText.text, new RegExp(tk.code)); assert.match(ticketText.text, /3200 16th St/); assert.match(ticketText.text, /STOP/);

  // Omar replies STOP to the Twilio number
  assert.equal((await form("/api/public/sms/inbound", { From: "+14155550102", Body: "STOP" })).status, 200);

  // the organizer's reminder: everyone with a number except Omar, each with their own code
  const n1 = fakeTexts.length;
  const rem = await (await post(`/api/public/booking/${id}/remind`, { t, text: "Doors at 6:15.", anyway: true })).json();
  assert.equal(rem.sent, 2, "Rita and Lena"); assert.equal(rem.stopped, 1, "Omar opted out"); assert.equal(rem.noPhone, 0);
  const sent = fakeTexts.slice(n1); assert.ok(!sent.some((x) => x.to === "+14155550102"), "no text to a STOP number");
  const ritaCode = (await (await fetch(`${srv.base}/api/public/ticket/${eid}?rid=${rids[0]}&code=c0`)).json()).code;
  assert.match(sent.find((x) => x.to === "+14155550101").text, new RegExp(`Hi Rita.*Doors at 6:15.*${ritaCode}`));
  assert.equal((await post(`/api/public/booking/${id}/remind`, { t: "wrong", anyway: true })).status, 403);

  // door: Rita arrives; the nudge goes only to who hasn't
  const door = await (await fetch(`${srv.base}/api/public/booking/${id}/results?t=${t}`)).json(); const dt = new URL(srv.base + door.doorLink).searchParams.get("t");
  await post(`/api/public/booking/${id}/door`, { t: dt, rid: rids[0] });
  const n2 = fakeTexts.length;
  const nd = await (await post(`/api/public/booking/${id}/door/nudge`, { t: dt, text: "Side door, 3rd floor." })).json();
  assert.equal(nd.sent, 1, "only Lena: Rita is in, Omar opted out"); assert.equal(fakeTexts.slice(n2)[0].to, "+14155550103"); assert.match(fakeTexts.slice(n2)[0].text, /Side door/);
  assert.equal((await post(`/api/public/booking/${id}/door/nudge`, { t: dt })).status, 429, "one nudge per ten minutes");

  // START opts back in
  await form("/api/public/sms/inbound", { From: "+14155550102", Body: "START" });
  const n3 = fakeTexts.length; await post(`/api/public/ticket/${eid}/text`, { rid: rids[1], code: "c1" }); assert.ok(fakeTexts.slice(n3).some((x) => x.to === "+14155550102"));
});

test("The Twilio request itself: right account URL, basic auth, From/To/Body, and errors don't throw", async () => {
  const { sendSms } = await import("../server/sms.js");
  const real = globalThis.fetch; let seen = null;
  globalThis.fetch = async (url, init) => { seen = { url: String(url), init }; return new Response(JSON.stringify({ sid: "SM123" }), { status: 201 }); };
  try {
    const ok = await sendSms({ service: "twilio", sid: "ACtest123", token: "secret-token", from: "+14155550000" }, { to: "(415) 555-0199", text: "Hello from Encore" });
    assert.equal(ok.ok, true);
    assert.equal(seen.url, "https://api.twilio.com/2010-04-01/Accounts/ACtest123/Messages.json");
    assert.equal(seen.init.headers.Authorization, "Basic " + Buffer.from("ACtest123:secret-token").toString("base64"));
    const body = new URLSearchParams(String(seen.init.body)); assert.equal(body.get("To"), "+14155550199"); assert.equal(body.get("From"), "+14155550000"); assert.equal(body.get("Body"), "Hello from Encore");
    globalThis.fetch = async () => new Response("{}", { status: 400 });
    const bad = await sendSms({ service: "twilio", sid: "ACtest123", token: "x", from: "+14155550000" }, { to: "+14155550199", text: "hi" }); assert.equal(bad.ok, false); assert.match(bad.error, /400/);
    globalThis.fetch = async () => { throw new Error("network down"); };
    const down = await sendSms({ service: "twilio", sid: "ACtest123", token: "x", from: "+14155550000" }, { to: "+14155550199", text: "hi" }); assert.equal(down.ok, false);
  } finally { globalThis.fetch = real; }
});
