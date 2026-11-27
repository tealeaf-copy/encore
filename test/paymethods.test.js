// Get paid (server/paymethods.js, public/paymethods.js): Venmo, PayPal, Cash App, an other pay link and a note on a
// person's own profile. Cleaning pasted links, the allow-list, saving, an event using them by default and turning some
// off, the guest's buttons (only the chosen ones, with the amount and a note), and nobody else seeing them.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { cleanHandle, cleanPayLink, cleanPay, deepLink, profileUrl, eventMethods, asksMoney, sameAsLink } from "../server/paymethods.js";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const B = (() => { const m = { exports: {} }; vm.runInNewContext(read("public/paymethods.js"), { module: m, URL }); return m.exports; })();
const J = { "content-type": "application/json" };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
let srv, host, guestCookie;

before(async () => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "pay-secret-0123456789abcdef"; process.env.ENCORE_FAKE_EMAIL = "1"; resetLoginLimits(); srv = await startServer();
  const sign = async (name, email) => (await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name, email, password: "long-password-1", mode: "friends" }) })).headers.get("set-cookie").split(";")[0];
  host = await sign("Maya Lee", "maya.pay@example.com"); guestCookie = await sign("Sam Park", "sam.pay@example.com");
  assert.equal((await fetch(srv.base + "/api/host/profile", { method: "POST", headers: { ...J, cookie: host }, body: JSON.stringify({ handle: "maya-pay", name: "Maya Lee" }) })).status, 200); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv.close(); });

const put = (id, d) => fetch(srv.base + "/api/db/doc?path=events/" + id, { method: "PUT", headers: { ...J, cookie: host }, body: JSON.stringify(d) });
const savePay = (body, cookie = host) => fetch(srv.base + "/api/me/pay", { method: "POST", headers: { ...J, cookie }, body: JSON.stringify(body) });
async function reply(eventId, key, { name, email = "", resp = "going", party } = {}) {
  const doc = await (await fetch(srv.base + "/api/db/doc?path=" + encodeURIComponent("events/" + eventId), { headers: { "x-encore-guest": "1" } })).json(), code = "P" + key.slice(-5).toUpperCase();
  const data = { eventId, response: resp, name, email, code, createdAt: Date.now(), via: "invite-lite", ...(party ? { party } : {}) };
  const r = await fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, "x-encore-guest": "1", "x-encore-key": key, "x-encore-workspace": doc.workspace }, body: JSON.stringify(data) });
  const j = await r.json(); return { j, rid: String(j.id || "").split("/").pop(), code };
}
const payFor = async (id, rid, code) => (await fetch(`${srv.base}/api/public/pay/${id}?rid=${encodeURIComponent(rid || "")}&code=${encodeURIComponent(code || "")}`)).json();

test("pasted links and @names become handles, for each app, the same in the server and the browser", () => {
  const cases = [
    ["venmo", "https://venmo.com/u/Maya-Lee", "Maya-Lee"], ["venmo", "https://account.venmo.com/u/maya_lee", "maya_lee"], ["venmo", "venmo.com/mayalee?txn=pay", "mayalee"], ["venmo", "@maya-lee", "maya-lee"], ["venmo", "  maya lee ", "mayalee"],
    ["paypal", "https://paypal.me/MayaLee", "MayaLee"], ["paypal", "https://www.paypal.me/mayalee/25", "mayalee"], ["paypal", "https://www.paypal.com/paypalme/mayalee", "mayalee"], ["paypal", "paypal.me/mayalee", "mayalee"], ["paypal", "@mayalee", "mayalee"],
    ["cashapp", "https://cash.app/$MayaLee", "MayaLee"], ["cashapp", "cash.app/$maya/20", "maya"], ["cashapp", "$maya", "maya"], ["cashapp", "maya", "maya"],
    ["venmo", "", ""], ["venmo", "https://evil.example.com/u/maya", null], ["venmo", "<script>", null], ["venmo", "a", null], ["venmo", "x".repeat(31), null],
    ["paypal", "https://paypal.com/send?to=x", null], ["paypal", "x".repeat(21), null], ["cashapp", "$12345", null], ["cashapp", "javascript:alert(1)", null],
  ];
  for (const [k, input, want] of cases) { assert.equal(cleanHandle(k, input), want, `${k} ${input}`); assert.equal(B.clean(k, input), want, `browser ${k} ${input}`); }
});

test("the other pay link: https only, known payment hosts only", () => {
  const ok = ["https://buy.stripe.com/test_abc123", "buy.stripe.com/abc", "https://square.link/u/abc", "https://checkout.square.site/merchant/x", "https://paypal.me/maya", "https://cash.app/$maya", "https://venmo.com/u/maya"];
  for (const u of ok) { assert.match(cleanPayLink(u), /^https:\/\//, u); assert.equal(B.cleanLink(u), cleanPayLink(u), u); }
  const no = ["http://buy.stripe.com/abc", "https://evil.com/buy.stripe.com", "https://buy.stripe.com.evil.com/x", "https://user:pw@buy.stripe.com/x", "javascript:alert(1)", "https://buy.stripe.com:8443/x", "https://buy.stripe.com/a b", "data:text/html,hi", "https://stripe.com.evil.io"];
  for (const u of no) { assert.equal(cleanPayLink(u), null, u); assert.equal(B.cleanLink(u), null, "browser " + u); }
  assert.equal(cleanPayLink(""), "");
  const P = cleanPay({ venmo: "@maya", link: "https://evil.com/x" }); assert.equal(P.field, "link"); assert.match(P.error, /https:\/\//);
  assert.equal(cleanPay({ cashapp: "https://cash.app/$" }).field, "cashapp");
  assert.equal(cleanPay({ note: "Zelle: <b>maya@example.com</b>" }).pay.note, "Zelle: bmaya@example.com/b", "the note is text only");
});

test("deep links carry the amount and the note where the app takes them", () => {
  for (const L of [deepLink, B.deep]) {
    assert.equal(L("venmo", "maya-lee", 4000, "Sam · Supper club"), "https://venmo.com/maya-lee?txn=pay&amount=40&note=Sam%20%C2%B7%20Supper%20club");
    assert.equal(L("paypal", "mayalee", 2550), "https://paypal.me/mayalee/25.50");
    assert.equal(L("cashapp", "maya", 1200), "https://cash.app/$maya/12");
    assert.equal(L("cashapp", "maya", 0), "https://cash.app/$maya", "no amount, just the page");
    assert.equal(L("venmo", "maya", 0, ""), "https://venmo.com/maya?txn=pay");
    assert.equal(L("venmo", "", 100), "");
  }
  assert.equal(profileUrl("venmo", "maya"), "https://venmo.com/u/maya"); assert.equal(B.profileUrl("paypal", "maya"), "https://paypal.me/maya"); assert.equal(profileUrl("cashapp", "maya"), "https://cash.app/$maya");
  const pay = { venmo: "maya", paypal: "mayalee", cashapp: "", link: "https://buy.stripe.com/x", note: "Zelle too" };
  assert.deepEqual(eventMethods(pay, {}), ["venmo", "paypal", "link", "note"], "every method by default");
  assert.deepEqual(eventMethods(pay, { payHide: ["paypal", "note"] }), ["venmo", "link"]);
  assert.equal(asksMoney({ price: "$20" }), true); assert.equal(asksMoney({ price: "" }), false); assert.equal(asksMoney({ price: "Free" }), false); assert.equal(asksMoney({ chipIn: true }), true);
  assert.equal(asksMoney({ drop: true, preorder: true, ticketNote: "Pay at pickup" }), false, "pay at pickup shows no apps"); assert.equal(asksMoney({ price: "$20", ticketNote: "at the door" }), false);
  assert.equal(sameAsLink(pay, "https://venmo.com/u/Maya"), "venmo"); assert.equal(sameAsLink(pay, "https://buy.stripe.com/x"), "link"); assert.equal(sameAsLink(pay, "https://venmo.com/u/other"), "");
});

test("Get paid saves on the person's profile and loads back, for hosts and guests; bad handles are refused", async () => {
  assert.equal((await fetch(srv.base + "/api/me/pay")).status, 401, "signed out: nothing");
  const e0 = await (await fetch(srv.base + "/api/me/pay", { headers: { cookie: host } })).json(); assert.equal(e0.has, false);
  const bad = await savePay({ venmo: "https://evil.com/u/x" }); assert.equal(bad.status, 400); assert.equal((await bad.json()).field, "venmo");
  const badL = await savePay({ link: "https://my-shop.example.com/pay" }); assert.equal(badL.status, 400);
  const r = await savePay({ venmo: "https://venmo.com/u/maya-lee", paypal: "paypal.me/mayalee", cashapp: "$mayalee", link: "buy.stripe.com/test_1", note: "Zelle: maya@example.com" }); assert.equal(r.status, 200);
  const j = await (await fetch(srv.base + "/api/me/pay", { headers: { cookie: host } })).json();
  assert.deepEqual({ venmo: j.pay.venmo, paypal: j.pay.paypal, cashapp: j.pay.cashapp, link: j.pay.link, note: j.pay.note }, { venmo: "maya-lee", paypal: "mayalee", cashapp: "mayalee", link: "https://buy.stripe.com/test_1", note: "Zelle: maya@example.com" });
  assert.equal(j.has, true);
  // a guest can set theirs too (splitting costs)
  assert.equal((await savePay({ venmo: "@sam-park" }, guestCookie)).status, 200);
  assert.equal((await (await fetch(srv.base + "/api/me/pay", { headers: { cookie: guestCookie } })).json()).pay.venmo, "sam-park");
  // a field left out keeps its value; an empty one clears it
  await savePay({ cashapp: "" }); const k = (await (await fetch(srv.base + "/api/me/pay", { headers: { cookie: host } })).json()).pay; assert.equal(k.cashapp, ""); assert.equal(k.venmo, "maya-lee");
  await savePay({ cashapp: "$mayalee" });
  // the settings page, the editor and the guest pages load the one small script; the light invite stays under its cap
  assert.match(read("public/settings.html"), /id="getpaid"[\s\S]*\/paymethods\.js/); assert.match(read("public/invite.html"), /more\("\/paymethods\.js"\)/); assert.ok(read("public/invite.html").length < 40000);
  const idx = read("index.html"), scripts = [...idx.matchAll(/<script\b/g)].length; assert.match(idx, /<script src="\/paymethods\.js" defer><\/script>/); assert.ok(idx.lastIndexOf("/paymethods.js") < idx.lastIndexOf('"Come with me?"'), "the Come with me? loader stays last"); assert.ok(scripts > 1);
  assert.match(read("public/canvas.js"), /PayMethods\.editor\(/); assert.match(read("public/drop.js"), /P\.dropRow\(/);
});

test("an event uses the profile's methods; it can turn some off; guests who are in see only those, with their amount", async () => {
  await put("paysup", { kind: "social", casual: true, name: "Supper club", date: day(6), startTime: "19:00", price: "$20", published: true, discoverable: true, headcount: 10, payHide: ["paypal"] });
  const sam = await reply("paysup", "key-sam-00001", { name: "Sam Park", email: "sam@example.com", party: 2 }); assert.equal(sam.j.response, "going");
  const P = await payFor("paysup", sam.rid, sam.code); assert.equal(P.ok, true); assert.equal(P.cents, 4000, "two spots at $20"); assert.equal(P.host, "Maya");
  assert.deepEqual(P.methods.map((m) => m.k), ["venmo", "cashapp", "link"], "PayPal is off for this event");
  const V = P.methods.find((m) => m.k === "venmo"); assert.equal(V.href, "https://venmo.com/maya-lee?txn=pay&amount=40&note=Sam%20%C2%B7%20Supper%20club"); assert.equal(V.label, "Venmo"); assert.equal(V.handle, "maya-lee");
  assert.equal(P.methods.find((m) => m.k === "cashapp").href, "https://cash.app/$mayalee/40"); assert.equal(P.methods.find((m) => m.k === "link").href, "https://buy.stripe.com/test_1");
  assert.equal(P.text, "Zelle: maya@example.com");
  // turned back on: PayPal comes back without retyping
  await put("paysup", { kind: "social", casual: true, name: "Supper club", date: day(6), startTime: "19:00", price: "$20", published: true, discoverable: true, headcount: 10, payHide: ["note", "link"] });
  const P2 = await payFor("paysup", sam.rid, sam.code); assert.deepEqual(P2.methods.map((m) => m.k), ["venmo", "paypal", "cashapp"]); assert.equal(P2.text, ""); assert.equal(P2.methods.find((m) => m.k === "paypal").href, "https://paypal.me/mayalee/40");
  // the event's own pay link already is Venmo: the invite's Pay button covers it, so it isn't shown twice
  await put("paylink", { kind: "social", casual: true, name: "Pasta night", date: day(7), price: "$15", ticketUrl: "https://venmo.com/u/maya-lee", published: true, headcount: 10 });
  const a = await reply("paylink", "key-ana-00001", { name: "Ana", email: "ana@example.com" }); const PL = await payFor("paylink", a.rid, a.code);
  assert.equal(PL.hasLink, true); assert.ok(!PL.methods.some((m) => m.k === "venmo")); assert.ok(PL.methods.some((m) => m.k === "paypal"));
  // "I paid" from those buttons is a claim on their own reply
  assert.equal((await fetch(srv.base + "/api/public/pay/paysup/claim", { method: "POST", headers: J, body: JSON.stringify({ rid: sam.rid, code: "WRONG" }) })).status, 403);
  assert.equal((await fetch(srv.base + "/api/public/pay/paysup/claim", { method: "POST", headers: J, body: JSON.stringify({ rid: sam.rid, code: sam.code }) })).status, 200);
  assert.equal((await payFor("paysup", sam.rid, sam.code)).claimed, true);
});

test("pay handles never reach people who aren't in, or free and pay-in-person events", async () => {
  const going = await reply("paysup", "key-lee-00001", { name: "Lee", email: "lee@example.com" });
  assert.deepEqual(await payFor("paysup", "", ""), { ok: false }, "no reply");
  assert.deepEqual(await payFor("paysup", going.rid, "WRONG"), { ok: false }, "someone else's reply id");
  assert.deepEqual(await payFor("nosuch", going.rid, going.code), { ok: false });
  const maybe = await reply("paysup", "key-kai-00001", { name: "Kai", email: "kai@example.com", resp: "maybe" }); assert.deepEqual(await payFor("paysup", maybe.rid, maybe.code), { ok: false }, "a Maybe isn't in");
  await put("payfree", { kind: "social", casual: true, name: "Picnic", date: day(5), published: true, discoverable: true });
  const f = await reply("payfree", "key-fre-00001", { name: "Fran", email: "fran@example.com" }); assert.deepEqual(await payFor("payfree", f.rid, f.code), { ok: false }, "a free event asks for nothing");
  await put("paydoor", { kind: "social", casual: true, name: "Jazz", date: day(5), price: "$10", ticketNote: "at the door", published: true });
  const d = await reply("paydoor", "key-dor-00001", { name: "Dee", email: "dee@example.com" }); assert.deepEqual(await payFor("paydoor", d.rid, d.code), { ok: false }, "pay at the door: no apps");
  // the public pages: the event doc, its host card, the host page and Discover carry no Get paid handle
  const pub = [await (await fetch(srv.base + "/api/db/doc?path=events/paysup", { headers: { "x-encore-guest": "1" } })).text(), await (await fetch(srv.base + "/api/public/event-host/paysup")).text(), await (await fetch(srv.base + "/api/public/host/maya-pay")).text(), await (await fetch(srv.base + "/e/paysup")).text(), await (await fetch(srv.base + "/api/public/feed")).text()].join("\n");
  for (const h of ["maya-lee", "mayalee", "buy.stripe.com/test_1", "Zelle"]) assert.ok(!pub.includes(h), "public pages never show " + h);
});

test("Home asks for a way to pay when an event has a price and there is none", async () => {
  const sign = async (name, email) => (await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name, email, password: "long-password-1", mode: "friends" }) })).headers.get("set-cookie").split(";")[0];
  const c = await sign("Rae Kim", "rae.pay@example.com");
  await fetch(srv.base + "/api/db/doc?path=events/raepaid", { method: "PUT", headers: { ...J, cookie: c }, body: JSON.stringify({ kind: "social", casual: true, name: "Dumpling class", date: day(9), price: "$35", published: true }) });
  const j = await (await fetch(srv.base + "/api/me/pay", { headers: { cookie: c } })).json(); assert.equal(j.need?.eventId, "raepaid"); assert.equal(j.need.title, "Dumpling class");
  assert.equal((await savePay({ paypal: "raekim" }, c)).status, 200);
  assert.equal((await (await fetch(srv.base + "/api/me/pay", { headers: { cookie: c } })).json()).need, null, "gone once there's a way to pay");
  assert.match(read("public/nudges.js"), /Add how you get paid/);
});

test("Get paid copy: plain words, no em dashes, no promises about fees", () => {
  const src = read("public/paymethods.js") + read("server/paymethods.js");
  assert.ok(!src.includes("\u2014"), "no em dashes"); assert.match(src, /Pottery Lab doesn't hold the money/); assert.ok(!/\bfee|guarantee|protected\b/i.test(src.replace(/\/\/.*$/gm, "")));
});
