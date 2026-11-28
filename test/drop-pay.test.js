// Paying for a drop before pickup (server/droppay.js, public/droppage.js, public/drop.js): a drop that asks to pay
// ahead shows a pay step after Place order with the maker's own Get paid buttons and the amount filled in, then I paid
// (a claim the maker confirms); "I'll pay at pickup" where the maker allows it; a calm Not paid yet line until it's
// paid, on the order page and in Plans; at most 3 reminders an order, never in quiet hours, none once paid, claimed,
// chosen for pickup or cancelled; the maker's Orders shows Paid, Claimed and Not paid with totals per pickup window,
// Mark paid, a rate-limited Remind unpaid, a pickup checklist, and a nudge to add a way to get paid. Pottery Lab never
// holds the money, and the copy never says it does.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore } from "../server/workspaces.js";
import { fakeOutbox } from "../server/email.js";
import { cleanDrop, dropEvent, publicDrop } from "../server/drops.js";
import { payModeOf, payStateOf, dueReminder, reminderText, PAY_REMIND } from "../server/droppay.js";
import { asksMoney } from "../server/paymethods.js";
import "../public/pickup.js";

const P = globalThis.PLPickup, J = { "Content-Type": "application/json" };
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const SHOTS = process.env.DROP_PAY_SHOTS || ""; // a folder for the 390px screenshots, when set
// a time zone where it's midday right now, so a test never lands in quiet hours (Etc/GMT signs are reversed)
const noonTz = () => { let off = 12 - new Date().getUTCHours(); if (off > 14) off -= 24; if (off < -12) off += 24; return off === 0 ? "UTC" : `Etc/GMT${off > 0 ? "-" : "+"}${Math.abs(off)}`; };
let srv, maya, mayaWs, noor, noorWs;
const post = (p, b, h = {}) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...h }, body: JSON.stringify(b) });
const getJ = async (p, h = {}) => (await fetch(srv.base + p, { headers: h })).json();
const join = async (name, email, handle) => { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200); const c = r.headers.get("set-cookie").split(";")[0];
  if (handle) assert.ok((await post("/api/host/profile", { name, handle, city: "New York", hood: "Greenpoint", tagline: "Pandan everything", bio: "I bake on weekends." }, { cookie: c })).ok);
  return { cookie: c, ws: handle ? srv.store.get("system/handle-" + handle).data.ws : "" }; };
const guest = (w) => ({ "x-encore-guest": "1", "x-encore-key": "k" + Math.random().toString(36).slice(2), "x-encore-workspace": w });
let n = 0;
const order = async (w, eventId, body = {}) => { const code = "PAY" + String(++n).padStart(3, "0"), h = guest(w);
  const r = await post("/api/db/collection?path=rsvps", { eventId, response: "going", name: "Lan Pham", email: `lan${n}.pay@example.com`, code, createdAt: Date.now(), orderQty: [{ i: 0, qty: 2 }], slot: P.label(ev(w, eventId).windows[0]), ...body }, h);
  assert.equal(r.status, 200, await r.clone().text()); return { rid: String((await r.json()).id || "").split("/").pop(), code, key: h["x-encore-key"], email: body.email || `lan${n}.pay@example.com` }; };
const DROP = (over = {}) => ({ title: "Pandan cake", items: [{ name: "Pandan honeycomb cake", price: "18", stock: 40 }, { name: "Kaya toast box", price: "9.50" }],
  windows: [{ date: day(9), start: "09:00", end: "10:00" }, { date: day(9), start: "11:00", end: "12:00" }], area: "Greenpoint", address: "12 Kent St, Apt 3", pay: "ahead", ...over });
const mkDrop = async (cookie, over) => { const r = await post("/api/host/drops", DROP(over), { cookie }); assert.equal(r.status, 200, await r.clone().text()); return (await r.json()).id; };
const ev = (w, id) => scopeStore(srv.store, w).get("events/" + id).data;
const rsvp = (w, rid) => scopeStore(srv.store, w).get("rsvps/" + rid).data;
const payOf = (id, o) => getJ(`/api/public/pay/${id}?rid=${encodeURIComponent(o.rid)}&code=${encodeURIComponent(o.code)}`);

const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "droppay-secret-0123456", ENCORE_FAKE_EMAIL: "1", ENCORE_SIGNUP_PER_HOUR: "100", ENCORE_DIRECTORY_CACHE_MS: "0", ENCORE_RSVP_PER_HOUR: "500", ENCORE_RSVP_IP_PER_HOUR: "1000" };
before(async () => { Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer();
  const a = await join("Maya Tan", "maya.droppay@example.com", "maya-droppay"); maya = a.cookie; mayaWs = a.ws;
  assert.equal((await post("/api/me/pay", { venmo: "maya-bakes", cashapp: "mayabakes" }, { cookie: maya })).status, 200);
  const b = await join("Noor Ali", "noor.droppay@example.com", "noor-droppay"); noor = b.cookie; noorWs = b.ws; });
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

test("how a drop takes money: pay ahead, ahead or at pickup, at pickup only; free orders skip it all", () => {
  for (const [pay, mode, asks] of [["ahead", "ahead", true], ["either", "either", true], ["pickup", "pickup", false]]) {
    const d = cleanDrop(DROP({ pay })).drop, e = dropEvent(d, { name: "Maya Tan" });
    assert.equal(payModeOf(e), mode); assert.equal(asksMoney(e), asks, pay); assert.equal(publicDrop("x", e, {}).payAhead, asks); assert.equal(publicDrop("x", e, {}).payAtPickup, pay !== "ahead"); }
  // a drop made before pay modes: a pay link meant paying ahead, none meant at pickup
  assert.equal(payModeOf({ drop: true, ticketUrl: "https://venmo.com/u/maya" }), "ahead"); assert.equal(payModeOf({ drop: true, ticketNote: "Pay at pickup" }), "pickup");
  assert.equal(cleanDrop(DROP({ pay: "ahead", payUrl: "http://x.example" })).error, "Payment links start with https://. Or leave it empty to use your Get paid methods.");
  assert.equal(cleanDrop(DROP({ pay: "ahead" })).drop.payUrl, "", "pay ahead needs no link: the Get paid methods are the buttons");
  const E = { drop: true, payMode: "ahead" }, line = (qty, x = {}) => ({ response: "going", orderLines: [{ name: "Pandan cake", qty, price: 18 }], orderTotal: 18 * qty, ...x });
  assert.equal(payStateOf(E, line(2)).state, "unpaid"); assert.equal(payStateOf(E, line(2)).amount, "$36");
  assert.equal(payStateOf(E, { response: "going", orderLines: [{ name: "Free sample", qty: 1, price: 0 }], orderTotal: 0 }).state, "free", "nothing to pay: no pay step, no reminders");
  assert.equal(payStateOf({ drop: true, payMode: "pickup" }, line(2)).state, "pickup");
  assert.equal(payStateOf({ drop: true, payMode: "either" }, line(2, { payChoice: "pickup" })).state, "pickup");
  assert.equal(payStateOf(E, line(2, { payChoice: "pickup" })).state, "unpaid", "pay at pickup is a choice only where the maker allows it");
  assert.equal(payStateOf(E, line(2, { paidClaim: true, paidClaimCents: 3600 })).state, "claimed");
  assert.equal(payStateOf(E, line(2, { paid: true, paidCents: 3600, paidClaim: true })).state, "paid");
  assert.equal(payStateOf(E, line(2, { response: "no" })).state, "cancelled"); assert.equal(payStateOf(E, line(2, { orderStatus: "cancelled" })).state, "cancelled");
  // more items after a claim: the claim was for $36, the order is $54 now, so it's Not paid yet again, for the whole amount (no part payments)
  const grown = payStateOf(E, line(3, { paidClaim: true, paidClaimCents: 3600 })); assert.equal(grown.state, "unpaid"); assert.equal(grown.amount, "$54"); assert.equal(grown.changed, true);
});

test("reminders: placed, the day before, the morning of; never in quiet hours; at most 3; none once paid, claimed or cancelled", () => {
  const W = { id: "w1", date: "2026-12-12", start: "09:00", end: "10:00" }, E = { drop: true, payMode: "either", pubTitle: "pandan cake", windows: [W], tz: "UTC" }, at = (d, h, m = 0) => Date.UTC(2026, 11, d, h, m);
  const R = (x = {}) => ({ response: "going", slot: P.label(W), orderLines: [{ name: "Pandan honeycomb cake", qty: 2, price: 18 }], orderTotal: 36, orderAt: at(5, 15), payReminders: [], ...x });
  assert.equal(dueReminder(E, R(), at(5, 15, 10), "UTC"), "", "not right after ordering: the pay step is still on their screen");
  assert.equal(dueReminder(E, R(), at(5, 15, 31), "UTC"), "placed");
  const placed = [{ k: "placed", at: at(5, 15, 31) }];
  assert.equal(dueReminder(E, R({ payReminders: placed }), at(7, 12), "UTC"), "", "nothing more until the day before");
  assert.equal(dueReminder(E, R({ payReminders: placed }), at(11, 3), "UTC"), "", "quiet hours: 9pm to 8am where the drop is");
  assert.equal(dueReminder(E, R({ payReminders: placed }), at(11, 22), "UTC"), "", "quiet hours, the evening side");
  assert.equal(dueReminder(E, R({ payReminders: placed }), at(11, 10), "UTC"), "eve");
  const eve = [...placed, { k: "eve", at: at(11, 10) }];
  assert.equal(dueReminder(E, R({ payReminders: eve }), at(11, 13), "UTC"), "", "one a day");
  assert.equal(dueReminder(E, R({ payReminders: eve }), at(12, 7), "UTC"), "", "the morning starts at 8");
  assert.equal(dueReminder(E, R({ payReminders: eve }), at(12, 8, 15), "UTC"), "morning");
  assert.equal(dueReminder(E, R({ payReminders: eve }), at(12, 9, 5), "UTC"), "", "pickup has begun: they pay there");
  assert.equal(dueReminder(E, R({ payReminders: [...eve, { k: "host", at: at(11, 14) }] }), at(12, 8, 15), "UTC"), "", `never more than ${PAY_REMIND.max} an order (the maker's Remind unpaid counts)`);
  // ordered the day before: not while the pay step is on their screen, then the day-before one is that day's one; the morning still comes
  const late = R({ orderAt: at(11, 9) });
  assert.equal(dueReminder(E, late, at(11, 9, 10), "UTC"), ""); assert.equal(dueReminder(E, late, at(11, 9, 40), "UTC"), "eve");
  assert.equal(dueReminder(E, { ...late, payReminders: [{ k: "eve", at: at(11, 9, 40) }] }, at(11, 15), "UTC"), "");
  assert.equal(dueReminder(E, { ...late, payReminders: [{ k: "eve", at: at(11, 9, 40) }] }, at(12, 8, 10), "UTC"), "morning");
  // a time zone: 8:15am in New York is 13:15 UTC
  assert.equal(dueReminder({ ...E, tz: "America/New_York" }, R({ payReminders: eve }), at(12, 12), "America/New_York"), "", "7am in New York");
  assert.equal(dueReminder({ ...E, tz: "America/New_York" }, R({ payReminders: eve }), at(12, 13, 15), "America/New_York"), "morning");
  for (const [why, r, e2] of [["paid", R({ paid: true, paidCents: 3600 }), E], ["claimed", R({ paidClaim: true }), E], ["paying at pickup", R({ payChoice: "pickup" }), E], ["cancelled", R({ response: "no" }), E],
    ["a cancelled drop", R(), { ...E, cancelled: true }], ["pay at pickup only", R(), { ...E, payMode: "pickup" }], ["free", R({ orderLines: [{ name: "Sample", qty: 1, price: 0 }], orderTotal: 0 }), E]])
    assert.equal(dueReminder(e2, r, at(11, 10), "UTC"), "", "none when " + why);
  // the words
  assert.equal(reminderText("eve", { title: "pandan cake", host: "Maya", amount: "$36", span: P.span(W) }), "Your pandan cake pickup is tomorrow, 9 to 10am. You haven't paid yet: Pay Maya $36.");
  assert.equal(reminderText("morning", { title: "pandan cake", host: "Maya", amount: "$36", span: P.span(W) }), "Your pandan cake pickup is today, 9 to 10am. Not paid yet: Pay Maya $36.");
  assert.equal(reminderText("placed", { title: "pandan cake", host: "Maya", amount: "$36" }), "Your pandan cake order is in. Not paid yet: Pay Maya $36 before pickup.");
  for (const k of ["placed", "eve", "morning", "host"]) assert.doesNotMatch(reminderText(k, { title: "x", host: "Maya", amount: "$36", span: "9 to 10am", pickupDay: "Sat, Dec 12" }), /—|fee|guarantee|hold/i);
});

test("the pay step: a priced drop gives the maker's buttons with the amount, I paid records a claim, pay at pickup is a choice only where allowed", async () => {
  const id = await mkDrop(maya, { pay: "either" }), o = await order(mayaWs, id);
  const j = await payOf(id, o);
  assert.equal(j.ok, true); assert.equal(j.state, "unpaid"); assert.equal(j.cents, 3600); assert.equal(j.host, "Maya"); assert.equal(j.pickupOk, true);
  assert.deepEqual(j.methods.map((m) => m.k), ["venmo", "cashapp"]); assert.match(j.methods[0].href, /^https:\/\/venmo\.com\/maya-bakes\?txn=pay&amount=36&note=Lan%20%C2%B7%20Pandan%20cake$/); assert.equal(j.methods[1].href, "https://cash.app/$mayabakes/36");
  assert.equal((await payOf(id, { ...o, code: "WRONG" })).ok, false, "only with the order's own code");
  // I'll pay at pickup, then change their mind
  let c = await (await post("/api/public/drop-pay/" + id, { rid: o.rid, code: o.code, choice: "pickup" })).json(); assert.equal(c.state, "pickup");
  assert.equal((await payOf(id, o)).state, "pickup");
  c = await (await post("/api/public/drop-pay/" + id, { rid: o.rid, code: o.code, choice: "ahead" })).json(); assert.equal(c.state, "unpaid");
  assert.equal((await post("/api/public/drop-pay/" + id, { rid: o.rid, code: "NOPE", choice: "pickup" })).status, 403);
  // I paid: a claim for the whole order; the maker still confirms
  assert.equal((await post(`/api/public/pay/${id}/claim`, { rid: o.rid, code: o.code })).status, 200);
  assert.equal(rsvp(mayaWs, o.rid).paidClaimCents, 3600); const after = await payOf(id, o); assert.equal(after.state, "claimed"); assert.equal(after.claimed, true);
  // a drop that only takes pay ahead refuses the pickup choice; a pay-at-pickup-only drop has no pay step at all
  const ahead = await mkDrop(maya, { title: "Kaya ahead" }), o2 = await order(mayaWs, ahead);
  const no = await post("/api/public/drop-pay/" + ahead, { rid: o2.rid, code: o2.code, choice: "pickup" }); assert.equal(no.status, 409); assert.match((await no.json()).message, /asks to pay ahead/);
  const atPickup = await mkDrop(maya, { title: "Pay at pickup", pay: "pickup" }), o3 = await order(mayaWs, atPickup);
  assert.equal((await payOf(atPickup, o3)).ok, false, "pay at pickup only: no pay step");
  // the order email carries the pay step, straight to the order (no account needed)
  await new Promise((r) => setTimeout(r, 300));
  const m = fakeOutbox.filter((x) => String(x.to).includes(o2.email)).pop(); assert.ok(m, "an order email");
  assert.match(m.text, new RegExp(`Not paid yet\\. Pay Maya \\$36 before pickup: http://127\\.0\\.0\\.1:\\d+/e/${ahead}\\?pay=1#reply=${o2.rid}\\.[A-Za-z0-9_-]+`));
  assert.match(m.text, /Pottery Lab doesn't hold the money\./);
  const m3 = fakeOutbox.filter((x) => String(x.to).includes(o3.email)).pop(); assert.doesNotMatch(m3.text, /Not paid yet/); assert.match(m3.text, /Pay \$36 at pickup\./);
  // the page's words
  const dp = read("public/droppage.js");
  for (const t of ["${amt} now`}</h3>", "I paid ${amt}", "I'll pay at pickup (cash or card)", "will tell you how to pay.", "Not paid yet</b> · ${amt}", "Pay now</a>", "Paid · thanks", "Waiting for ${esc(first)} to confirm.", "Pottery Lab doesn't hold the money.", "?pay=1"]) assert.ok(dp.includes(t), t);
  assert.doesNotMatch(dp, /—/); assert.doesNotMatch(dp, /\bfees?\b|guarantee/i);
});

test("the unpaid line in Plans, and changing the quantity changes the amount", async () => {
  const id = await mkDrop(maya, { title: "Plans drop" }), g = await join("Lan Pham", "lan.plans.pay@example.com", "");
  const o = await order(mayaWs, id, { email: "lan.plans.pay@example.com" });
  const T = await (await post("/api/plans/timeline", {}, { cookie: g.cookie })).json(), it = (T.items || []).find((x) => x.eventId === id);
  assert.ok(it, "in Plans"); assert.match(it.status, /^Pickup 9 to 10am · #PAY\d{3} · Not paid yet · \$36$/); assert.deepEqual(it.pay, { state: "unpaid", amount: "$36", host: "Maya", href: `/e/${id}?pay=1` });
  const pl = read("public/plans.html"); assert.ok(pl.includes("Not paid yet · ${esc(i.pay.amount)}")); assert.ok(pl.includes(">Pay now</a>")); assert.ok(pl.includes("Paid · thanks"));
  // they claim, then add one more: the claim was for $36, so it's Not paid yet again, at $54
  assert.equal((await post(`/api/public/pay/${id}/claim`, { rid: o.rid, code: o.code })).status, 200);
  let t2 = (await (await post("/api/plans/timeline", {}, { cookie: g.cookie })).json()).items.find((x) => x.eventId === id); assert.match(t2.status, /Paid · waiting for Maya to confirm$/); assert.equal(t2.pay.state, "claimed");
  const r = await fetch(srv.base + "/api/db/doc?path=" + encodeURIComponent("rsvps/" + o.rid), { method: "PATCH", headers: { ...J, "x-encore-guest": "1", "x-encore-key": o.key, "x-encore-workspace": mayaWs }, body: JSON.stringify({ orderQty: [{ i: 0, qty: 3 }], slot: P.label(ev(mayaWs, id).windows[0]) }) });
  assert.equal(r.status, 200, await r.clone().text());
  const j = await payOf(id, o); assert.equal(j.cents, 5400); assert.equal(j.state, "unpaid"); assert.equal(j.changed, true); assert.match(j.methods[0].href, /amount=54/);
  t2 = (await (await post("/api/plans/timeline", {}, { cookie: g.cookie })).json()).items.find((x) => x.eventId === id); assert.match(t2.status, /Not paid yet · \$54$/);
  // claiming again covers the new amount
  assert.equal((await post(`/api/public/pay/${id}/claim`, { rid: o.rid, code: o.code })).status, 200); assert.equal((await payOf(id, o)).state, "claimed"); assert.equal(rsvp(mayaWs, o.rid).paidClaimCents, 5400);
});

test("the reminder job: the bell, email and a Potto text for unpaid orders only, capped, stopped by paying or cancelling", async () => {
  // a maker of her own, so the job sees only these orders
  const M = await join("Maya Rivera", "maya.remind@example.com", "maya-remind"), mayaWs = M.ws; assert.equal((await post("/api/me/pay", { venmo: "maya-rivera" }, { cookie: M.cookie })).status, 200);
  const DP = srv.app.locals.dropPay, id = await mkDrop(M.cookie, { title: "pandan cake" }); scopeStore(srv.store, mayaWs).update("events/" + id, { tz: noonTz() });
  const a = await order(mayaWs, id), b = await order(mayaWs, id), c = await order(mayaWs, id), d = await order(mayaWs, id);
  // a turned on Potto by text; b pays; c cancels; d chooses nothing and gets the reminders
  srv.store.set("system/pottot-" + (await import("node:crypto")).createHash("sha256").update(a.email).digest("hex").slice(0, 24), { kind: "pottot", email: a.email, on: true, phone: "+15555550123", onAt: Date.now() });
  assert.equal((await post(`/api/public/pay/${id}/claim`, { rid: b.rid, code: b.code })).status, 200);
  assert.equal((await post("/api/public/reply/" + id, { response: "no", rid: c.rid, code: c.code })).status, 200);
  const soon = Date.now() + 31 * 60e3;
  const r1 = await DP.runReminders(soon, "https://potterylab.test", [mayaWs]); assert.equal(r1.sent, 2, "a and d: placed");
  for (const o of [a, d]) { const r = rsvp(mayaWs, o.rid); assert.equal(r.payReminders.length, 1); assert.equal(r.payReminders[0].k, "placed");
    const bell = srv.app.locals.social.inbox(o.email).find((x) => x.kind === "payremind"); assert.ok(bell, "the bell"); assert.equal(bell.text, "Your pandan cake order is in. Not paid yet: Pay Maya $36 before pickup."); assert.equal(bell.link, `/e/${id}?pay=1`); }
  for (const o of [b, c]) { assert.ok(!(rsvp(mayaWs, o.rid).payReminders || []).length, "none for a claimed or cancelled order"); assert.ok(!srv.app.locals.social.inbox(o.email).some((x) => x.kind === "payremind")); }
  const q = srv.store.listPrefix("system", "pottotq-").map((x) => x.data).filter((x) => x.email === a.email); assert.equal(q.length, 1, "a text for the one who turned on Potto by text");
  assert.match(q[0].text, new RegExp(`^Your pandan cake order is in\\. Not paid yet: Pay Maya \\$36 before pickup\\. https://potterylab\\.test/e/${id}\\?pay=1#reply=`));
  assert.equal((await DP.runReminders(soon + 60e3, "", [mayaWs])).sent, 0, "once");
  // the day before pickup (9 days out): eve, by email with the pay link, then never more than 3
  const eveAt = Date.parse(day(8) + "T12:00:00Z"); scopeStore(srv.store, mayaWs).update("events/" + id, { tz: "UTC" });
  const before0 = fakeOutbox.length; assert.equal((await DP.runReminders(eveAt, "https://potterylab.test", [mayaWs])).sent, 2);
  const mail = fakeOutbox.slice(before0).find((m) => String(m.to).includes(d.email)); assert.ok(mail, "the day-before email");
  assert.match(mail.subject, /^Pickup tomorrow: pandan cake\. Not paid yet$/); assert.match(mail.text, /Your pandan cake pickup is tomorrow, 9 to 10am\. You haven't paid yet: Pay Maya \$36\./); assert.match(mail.text, /Pay Maya \$36: https:\/\/potterylab\.test\/e\/.+\?pay=1#reply=/);
  assert.match(mail.text, /Pottery Lab doesn't hold the money\./);
  // Mark paid stops a's reminders; d gets the morning one
  const Lh = (await getJ("/api/host/orders", { cookie: M.cookie })).orders.filter((x) => x.eventId === id), la = Lh.find((x) => x.id === a.rid);
  assert.equal((await post(`/api/host/drop-orders/${a.rid}/paid`, { paid: true }, { cookie: M.cookie })).status, 200); assert.equal(rsvp(mayaWs, a.rid).paidCents, 3600); assert.ok(la);
  assert.equal((await DP.runReminders(Date.parse(day(9) + "T08:20:00Z"), "", [mayaWs])).sent, 1); assert.deepEqual(rsvp(mayaWs, d.rid).payReminders.map((x) => x.k), ["placed", "eve", "morning"]);
  assert.equal(rsvp(mayaWs, a.rid).payReminders.length, 2, "paid: no morning one");
  assert.equal((await DP.runReminders(Date.parse(day(9) + "T08:50:00Z"), "", [mayaWs])).sent, 0, "3 is the most");
  // the bell's kind pushes under Reminders, which people can turn off in Settings
  assert.match(read("server/push.js"), /reminders: \{ label: "Reminders", kinds: \[[^\]]*"payremind"/);
});

test("the maker's Orders: Paid, Claimed, Not paid with totals per window, Mark paid, Remind unpaid once every 12 hours, the checklist and the Get paid nudge", async () => {
  const id = await mkDrop(maya, { title: "Window drop" }); scopeStore(srv.store, mayaWs).update("events/" + id, { tz: noonTz() });
  const W = ev(mayaWs, id).windows.map((w) => P.label(w));
  const a = await order(mayaWs, id, { slot: W[0] }), b = await order(mayaWs, id, { slot: W[0] }), c = await order(mayaWs, id, { slot: W[0], orderQty: [{ i: 0, qty: 1 }] }), x = await order(mayaWs, id, { slot: W[1] });
  assert.equal((await post(`/api/public/pay/${id}/claim`, { rid: b.rid, code: b.code })).status, 200);
  assert.equal((await post(`/api/host/drop-orders/${a.rid}/paid`, {}, { cookie: maya })).status, 200, "Mark paid, for cash at pickup");
  let L = (await getJ("/api/host/orders", { cookie: maya })).orders.filter((o) => o.eventId === id);
  const by = (o) => L.find((y) => y.id === o.rid); assert.deepEqual([by(a).pay, by(b).pay, by(c).pay, by(x).pay], ["paid", "claimed", "unpaid", "unpaid"]); assert.equal(by(a).payAhead, true);
  // Undo paid takes it back; Confirm paid on a claim marks it paid
  assert.equal((await (await post(`/api/host/drop-orders/${a.rid}/paid`, { paid: false }, { cookie: maya })).json()).pay, "unpaid");
  assert.equal((await (await post(`/api/host/drop-orders/${a.rid}/paid`, { paid: true }, { cookie: maya })).json()).pay, "paid");
  assert.equal((await post(`/api/host/drop-orders/${a.rid}/paid`, { paid: true }, { cookie: noor })).status, 404, "only the maker");
  // Remind unpaid: c and x, then not again for 12 hours
  const r1 = await post(`/api/host/drops/${id}/remind-unpaid`, {}, { cookie: maya }); assert.equal(r1.status, 200, await r1.clone().text()); const j1 = await r1.json(); assert.equal(j1.unpaid, 2); assert.equal(j1.sent, 2);
  assert.equal(rsvp(mayaWs, c.rid).payReminders[0].k, "host"); assert.ok(!(rsvp(mayaWs, b.rid).payReminders || []).length, "not the one who said I paid");
  assert.match(srv.app.locals.social.inbox(c.email).find((y) => y.kind === "payremind").text, /^A note from Maya: your Window drop order \(\$18\) isn't paid yet\. You can pay ahead before pickup /);
  const r2 = await post(`/api/host/drops/${id}/remind-unpaid`, {}, { cookie: maya }); assert.equal(r2.status, 429); assert.match((await r2.json()).message, /You reminded them already\. You can again in 12 hours\./);
  assert.equal((await post(`/api/host/drops/${id}/remind-unpaid`, {}, { cookie: noor })).status, 404);
  // quiet hours where the buyers are: not now
  const DP = srv.app.locals.dropPay, late = Date.UTC(2026, 11, 1, 23); scopeStore(srv.store, mayaWs).update("events/" + id, { remindUnpaidAt: 0, tz: "UTC" });
  assert.equal((await DP.remindUnpaid(mayaWs, id, late)).code, "quiet");
  // a pay-at-pickup-only drop: nothing to remind
  const pk = await mkDrop(maya, { title: "At pickup only", pay: "pickup" }); assert.equal((await post(`/api/host/drops/${pk}/remind-unpaid`, {}, { cookie: maya })).status, 400);
  // the Orders sheet's words: per-window totals, the badges, the buttons, the checklist
  const ui = read("public/drop.js");
  for (const t of ["${cents$(got)} of ${cents$(all)} paid", "Not paid", "Claimed · they said they paid", "Mark paid", "Confirm paid", "Undo paid", "Remind unpaid (", "Once every 12 hours.", "Pickup checklist", "to pick up", "data-ckp", "Buyers can't pay you ahead yet.", "Add how you get paid"]) assert.ok(ui.includes(t), t);
  assert.doesNotMatch(ui.slice(ui.indexOf("const PAYW"), ui.indexOf("async function inbox")), /—|\bfees?\b|guarantee/i);
  // the nudge: Noor asks to be paid ahead with no way to get paid
  assert.equal((await getJ("/api/host/drops", { cookie: noor })).getPaid, false); assert.equal((await getJ("/api/host/drops", { cookie: maya })).getPaid, true);
  const nid = await mkDrop(noor, { title: "Noor's buns" }), on = await order(noorWs, nid), nj = await payOf(nid, on);
  assert.equal(nj.ok, true); assert.deepEqual(nj.methods, []); assert.equal(nj.text, "", "no buttons: the page says Noor will tell them how to pay");
  const need = await getJ("/api/me/pay", { cookie: noor }); assert.equal(need.has, false); assert.equal(need.need?.drop, true, "Home's Get paid card names the drop");
  assert.match(read("public/paymethods.js"), /Add Venmo, PayPal or Cash App so buyers can pay you ahead\./);
  assert.ok(read("public/dropsetup.js").includes('[["ahead", "Pay ahead"], ["either", "Either"], ["pickup", "At pickup"]]'), "the setup offers pay ahead, either, and at pickup");
});

test("in a browser at 390px: order, the pay step, the unpaid line, I paid, and the maker's Orders", async (t) => {
  const req = createRequire(import.meta.url); let pw; try { pw = req("playwright"); } catch { return t.skip("no playwright"); }
  let br; try { br = await pw.chromium.launch(); } catch { return t.skip("no browser"); }
  const id = await mkDrop(maya, { title: "Pandan cake for Sunday", pay: "either" }), shot = async (p, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name), fullPage: false }); } };
  const opts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" };
  try {
    const ctx = await br.newContext(opts); await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (x) => x.fulfill({ status: 200, body: "" }));
    const p = await ctx.newPage(), errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    await p.goto(srv.base + "/e/" + id, { waitUntil: "domcontentloaded" }); await p.waitForSelector("#dgF", { timeout: 45000 });
    assert.match(await p.locator("#dgPay").innerText(), /ahead once your order is in, or at pickup/);
    await p.tap('.dg-it[data-i="0"] [data-d="1"]'); await p.tap('.dg-it[data-i="0"] [data-d="1"]'); assert.equal(await p.locator("#dgTotal").innerText(), "$36");
    await p.fill("#oNm", "Lan Pham"); await p.fill("#oCt", "lan.browser.pay@example.com");
    await p.locator("#oGo").scrollIntoViewIfNeeded(); await shot(p, "1-order-390.png");
    await p.tap("#oGo"); await p.waitForSelector("#dgPayStep h3", { timeout: 20000 });
    assert.equal(await p.locator("#dgPayH").innerText(), "Pay Maya $36 now");
    const pm = p.locator("#dgPayStep .dg-pm"); assert.equal(await pm.count(), 2); assert.match(await pm.first().getAttribute("href"), /venmo\.com\/maya-bakes\?txn=pay&amount=36/); assert.match(await pm.first().innerText(), /Venmo[\s\S]*@maya-bakes[\s\S]*\$36/);
    assert.equal(await p.locator("#dgPickup").innerText(), "I'll pay at pickup (cash or card)"); assert.equal(await p.locator("#dgPaid").innerText(), "I paid $36");
    assert.ok(!(await p.locator("#cal.pri").count()), "one primary: the first pay button, not Add to calendar");
    for (const sel of ["#dgPayStep .dg-pm", "#dgPaid", "#dgPickup"]) for (const bx of await p.locator(sel).evaluateAll((L) => L.map((e) => e.getBoundingClientRect().height))) assert.ok(bx >= 44, sel + " is 44px: " + bx);
    await p.locator("#dgPayStep").scrollIntoViewIfNeeded(); await shot(p, "2-pay-step-390.png");
    // back later: the calm line under the title, and the step from a reminder link
    await p.goto(srv.base + "/e/" + id + "?pay=1", { waitUntil: "domcontentloaded" }); await p.waitForSelector("#dgDue a", { timeout: 20000 });
    assert.match(await p.locator("#dgDue").innerText(), /Not paid yet · \$36\s*Pay now/);
    const cls = await p.evaluate(() => new Promise((res) => { let s = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) s += e.value; }).observe({ type: "layout-shift", buffered: true }); setTimeout(() => res(s), 800); }));
    assert.ok(cls < 0.05, "the page holds still: " + cls);
    await p.evaluate(() => scrollTo(0, 0)); await shot(p, "3-unpaid-banner-390.png");
    await p.tap("#dgPaid"); await p.waitForFunction(() => /Paid · thanks/.test(document.querySelector("#dgPayH")?.textContent || ""));
    assert.match(await p.locator("#dgDue").innerText(), /Paid · thanks\. Waiting for Maya to confirm\./);
    await p.locator("#dgPayStep").scrollIntoViewIfNeeded(); await shot(p, "4-paid-claimed-390.png");
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, "no sideways scroll");
    assert.deepEqual(errs.filter((e) => !/favicon|net::ERR/.test(e)), [], "console clean");
    await ctx.close();
    // a second order not paid, then the maker's Orders
    await order(mayaWs, id, { name: "Sam Ortiz", email: "sam.browser.pay@example.com", slot: P.label(ev(mayaWs, id).windows[1]), orderQty: [{ i: 0, qty: 1 }, { i: 1, qty: 2 }] });
    const hc = await br.newContext(opts); const [k, ...v] = maya.split("="); await hc.addCookies([{ name: k, value: v.join("="), url: srv.base }]); await hc.route(/^https?:\/\/(?!127\.0\.0\.1)/, (x) => x.fulfill({ status: 200, body: "" }));
    const h = await hc.newPage(); await h.goto(srv.base + "/e/" + id, { waitUntil: "domcontentloaded" }); await h.waitForSelector('[data-own="orders"]', { timeout: 45000 }); await h.tap('[data-own="orders"]');
    await h.waitForSelector("#dpSheet .dp-pay", { timeout: 20000 });
    const txt = await h.locator("#dpSheet").innerText();
    assert.match(txt, /Paid: \$0 of \$73 paid · \$36 claimed\./); assert.match(txt, /Claimed · they said they paid/); assert.match(txt, /Not paid/); assert.match(txt, /Remind unpaid \(1\)/);
    await shot(h, "5-host-orders-390.png");
    await h.locator("#dpSheet [data-mp]").first().tap(); await h.waitForFunction(() => /\$36 of \$73 paid/.test(document.querySelector("#dpSheet")?.innerText || ""));
    await h.locator("#dpSheet [data-ckl]").first().tap(); await h.waitForSelector("#dpSheet .dp-ck", { timeout: 10000 });
    assert.match(await h.locator("#dpSheet").innerText(), /Pickup checklist[\s\S]*Not paid/); await shot(h, "6-pickup-checklist-390.png");
    for (const bx of await h.locator("#dpSheet button").evaluateAll((L) => L.filter((e) => e.offsetParent).map((e) => [e.textContent.trim(), e.getBoundingClientRect().height]))) assert.ok(bx[1] >= 44, `${bx[0]} is 44px: ${bx[1]}`);
    assert.equal(await h.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
    await hc.close();
  } finally { await br.close(); }
});
