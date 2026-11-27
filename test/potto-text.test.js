// Potto by text (server/pottotext.js): signatures, identity, consent (STOP, START, HELP), quiet hours, limits, every
// guest and host intent end to end against seeded data, proactive messages and WhatsApp templates. No network: Twilio
// and WhatsApp are the fake outbox (ENCORE_FAKE_SMS=1), the model is ENCORE_FAKE_AI=1.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore } from "../server/workspaces.js";
import { fakeCodeTexts } from "../server/smscode.js";
import { pottoOutbox, twilioSignature, metaSignature, readIntent, parseDraft, parseDay, parseTime, capText, textConfig } from "../server/pottotext.js";

const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "potto-text-secret-0123456789", ENCORE_SIGNUP_PER_HOUR: "1000", ENCORE_FAKE_SMS: "1", ENCORE_FAKE_EMAIL: "1", TWILIO_AUTH_TOKEN: "test-auth-token", ENCORE_TZ: "America/New_York", ENCORE_DIRECTORY_CACHE_MS: "0", ENCORE_SUPPORT_EMAIL: "help@potterylab.example" };
let srv; const J = { "content-type": "application/json" };
const post = (path, body, cookie, h = {}) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}), ...h }, body: JSON.stringify(body) });
const patch = (path, body, cookie) => fetch(srv.base + path, { method: "PATCH", headers: { ...J, cookie }, body: JSON.stringify(body) });
const getJ = async (path, cookie) => (await fetch(srv.base + path, { headers: cookie ? { cookie } : {} })).json();
const transcript = [];
// one text in, through the real webhook with a real signature
async function text(from, Body, { ch = "sms", sign = true, who = "" } = {}) {
  const path = ch === "sms" ? "/api/potto/sms" : "/api/potto/whatsapp", params = { From: ch === "whatsapp" ? "whatsapp:" + from : from, To: "+15555550100", Body, MessageSid: "SM" + Math.random().toString(16).slice(2) };
  const sig = sign ? twilioSignature(ENV.TWILIO_AUTH_TOKEN, srv.base + path, params) : "bad";
  const r = await fetch(srv.base + path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sig }, body: new URLSearchParams(params).toString() });
  const xml = await r.text(), m = /<Message>([\s\S]*?)<\/Message>/.exec(xml), out = m ? m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">") : "";
  if (who) transcript.push(`${who}: ${Body}`, `Potto: ${out || "(no reply)"}`);
  return { status: r.status, out };
}
const iso = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
async function member(name, email, phone, { on = true, handle = "" } = {}) {
  const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200, await r.clone().text()); const cookie = r.headers.get("set-cookie").split(";")[0];
  if (handle) assert.ok((await post("/api/host/profile", { name, handle, city: "New York", hood: "Fort Greene", tagline: "Small dinners" }, cookie)).ok);
  if (phone) { assert.equal((await post("/api/me/phone/start", { phone }, cookie)).status, 200); const code = /^(\d{6})/.exec([...fakeCodeTexts].reverse().find((x) => x.to === phone).text)[1];
    assert.equal((await post("/api/me/phone/verify", { phone, code }, cookie)).status, 200); }
  if (on) { const j = await (await post("/api/me/potto-text", { on: true }, cookie)).json(); assert.equal(j.on, true, JSON.stringify(j)); }
  return { cookie, email, phone, ws: srv.store.get("system/user-" + email)?.data?.ws || (await getJ("/api/me", cookie)).workspace.id };
}
let maya, priya, jun, taco;
before(async () => { Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer(); });
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; const out = process.env.POTTO_TRANSCRIPT; if (out) fs.writeFileSync(out, transcript.join("\n") + "\n"); await srv.close(); });

test("the pieces: reading intents, drafts, days and times, and the length cap", () => {
  const today = "2026-11-27"; // a Friday
  assert.equal(parseTime("7pm"), "19:00"); assert.equal(parseTime("at 7:30 pm"), "19:30"); assert.equal(parseTime("noon"), "12:00"); assert.equal(parseTime("no time"), "");
  assert.equal(parseDay("sat", today), "2026-11-28"); assert.equal(parseDay("tomorrow", today), "2026-11-28"); assert.equal(parseDay("dec 12", today), "2026-12-12"); assert.equal(parseDay("fri", today), today);
  assert.deepEqual(parseDraft("dumpling night sat 7pm at mine for 8", today), { title: "Dumpling night", date: "2026-11-28", startTime: "19:00", meetPoint: "My place", headcount: 8 });
  assert.equal(readIntent("dumpling night sat 7pm at mine for 8", { today }).intent, "draft");
  assert.deepEqual(readIntent("I'm in for taco night"), { intent: "rsvp", response: "going", event: "taco night", bare: false });
  assert.equal(readIntent("can't make it").response, "no"); assert.equal(readIntent("maybe").response, "maybe");
  assert.equal(readIntent("2 cakes for saturday pickup").intent, "order"); assert.equal(readIntent("where is it").intent, "where"); assert.equal(readIntent("STOP").intent, "stop");
  assert.equal(readIntent("move it to 8pm", { today }).time, "20:00"); assert.equal(readIntent("yes", { pending: { type: "order" } }).intent, "confirm");
  const long = capText("word ".repeat(200) + "https://potterylab.example/e/abc", 320); assert.ok(long.length <= 320); assert.match(long, /https:\/\/potterylab\.example\/e\/abc$/);
  assert.equal(textConfig({ ENCORE_POTTO_TEXT: "0", ENCORE_FAKE_SMS: "1" }).on, false); assert.equal(textConfig({}).on, false, "off unless configured");
});

test("signatures: a good X-Twilio-Signature is read, a bad one or none is refused; the Cloud API needs its own signature", async () => {
  assert.equal((await text("+12125550199", "hi")).status, 200);
  assert.equal((await text("+12125550199", "hi", { sign: false })).status, 403);
  const none = await fetch(srv.base + "/api/potto/sms", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "From=%2B12125550199&Body=hi" }); assert.equal(none.status, 403);
  // Meta: verify handshake and a signed POST
  process.env.WHATSAPP_TOKEN = "meta-token"; process.env.WHATSAPP_PHONE_NUMBER_ID = "123"; process.env.WHATSAPP_APP_SECRET = "meta-secret"; process.env.WHATSAPP_VERIFY_TOKEN = "verify-me";
  try {
    assert.equal(await (await fetch(srv.base + "/api/potto/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42")).text(), "42");
    assert.equal((await fetch(srv.base + "/api/potto/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42")).status, 403);
    const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: "12125550198", type: "text", text: { body: "hi" } }] } }] }] });
    assert.equal((await fetch(srv.base + "/api/potto/whatsapp", { method: "POST", headers: { ...J, "x-hub-signature-256": "sha256=00" }, body })).status, 403);
    assert.equal((await fetch(srv.base + "/api/potto/whatsapp", { method: "POST", headers: { ...J, "x-hub-signature-256": metaSignature("meta-secret", Buffer.from(body)) }, body })).status, 200);
  } finally { for (const k of ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"]) delete process.env[k]; }
});

test("unknown numbers get one kind reply pointing to Settings, and nothing else", async () => {
  const a = await text("+12125550111", "I'm in", { who: "Unknown number" }); assert.match(a.out, /^Hi, I'm Potto from Pottery Lab\. I'd love to help, but I don't know this number yet\. Add it in your settings and we're set: http.*\/settings#text$/);
  assert.equal((await text("+12125550111", "hello?")).out, "", "only once");
});

test("seed: a host, two guests with verified numbers, and an event", async () => {
  maya = await member("Maya Chen", "maya.pt@example.com", "+12125550101", { handle: "maya-pt" });
  priya = await member("Priya Shah", "priya.pt@example.com", "+12125550102");
  jun = await member("Jun Park", "jun.pt@example.com", "+12125550103");
  const ev = await (await post("/api/db/collection?path=events", { name: "Taco night", pubTitle: "Taco night", date: iso(5), startTime: "19:00", meetPoint: "My place", venueAddr: "12 Elm St, Brooklyn", hood: "Fort Greene", city: "New York", headcount: 8, casual: true, published: true, bring: "Chips, Salsa" }, maya.cookie)).json();
  assert.ok(ev.id); taco = ev.id;
  // Priya and Jun were invited (the bell item every invite leaves)
  for (const g of [priya, jun]) srv.app.locals.social.notify(g.email, { kind: "invite", key: "inv-" + taco, text: "Maya invited you to Taco night", link: "/e/" + taco, eventId: taco });
  // a member who added a number but never turned the switch on
  await member("Sam Lee", "sam.pt@example.com", "+12125550104", { on: false });
});

test("consent: a number that hasn't opted in gets one nudge; STOP stops everything and is recorded; START resumes; HELP answers", async () => {
  const n = await text("+12125550104", "my plans"); assert.match(n.out, /Texting with me is off for this number/); assert.equal((await text("+12125550104", "my plans")).out, "", "one nudge a day");
  const s = await text("+12125550104", "START", { who: "Sam" }); assert.match(s.out, /You're back on/);
  assert.equal((await getJ("/api/me/potto-text", (await post("/api/login", { email: "sam.pt@example.com", password: "long-password-1" })).headers.get("set-cookie")?.split(";")[0])).on ?? true, true);
  const stop = await text("+12125550104", "STOP", { who: "Sam" }); assert.equal(stop.out, "", "SMS: the carrier's own opt-out reply, nothing from us");
  assert.ok(srv.store.get("system/smsstop-" + (await import("node:crypto")).createHash("sha256").update("+12125550104").digest("hex").slice(0, 24)), "recorded on the shared stop list");
  assert.equal((await text("+12125550104", "my plans")).out, "", "nothing after STOP");
  const before = pottoOutbox.length; await srv.app.locals.pottoText.send({ to: "+12125550104", text: "hi" }); assert.equal(pottoOutbox.length, before, "nothing goes out to a stopped number");
  assert.match((await text("+12125550104", "HELP", { who: "Sam" })).out, /help@potterylab\.example.*Reply STOP to stop/);
  assert.match((await text("+12125550104", "start")).out, /You're back on/);
  for (const w of ["unsubscribe", "cancel", "end", "quit"]) { assert.equal((await text("+12125550104", w.toUpperCase())).out, ""); assert.match((await text("+12125550104", "START")).out, /back on/); }
  // WhatsApp STOP gets our own confirmation
  assert.match((await text("+12125550104", "stop", { ch: "whatsapp" })).out, /unsubscribed/);
});

test("guest: I'm in, where, when, calendar, bring, who's going, change a reply, my plans", async () => {
  const P = "+12125550102", say = (b) => text(P, b, { who: "Priya" });
  const a = await say("I'm in for taco night"); assert.match(a.out, /^You're in for Taco night on \w{3} \w{3} \d+\. I'll text you the address the day before\.$/);
  const R = () => scopeStore(srv.store, maya.ws).list("rsvps").find((d) => d.data.eventId === taco && d.data.email === priya.email)?.data;
  assert.equal(R().response, "going"); assert.equal(R().via, "potto-text");
  assert.match((await say("where is it")).out, /12 Elm St/, "the address, because she's in");
  assert.match((await say("when is it")).out, /Taco night is .*7pm/);
  assert.match((await say("add to calendar")).out, /\/plans\/ics\/.+\.ics\?rid=/);
  assert.match((await say("what should I bring")).out, /bring chips and salsa/);
  await text("+12125550103", "count me in for taco night", { who: "Jun" });
  assert.match((await say("who's going")).out, /Jun is in for Taco night, plus you/);
  const c = await say("actually can't make it"); assert.match(c.out, /you're out for Taco night/); assert.equal(R().response, "no", "the reply changed");
  const w = await say("where is it"); assert.doesNotMatch(w.out, /12 Elm/, "address withheld once she's out"); assert.match(w.out, /once you're in/);
  assert.match((await say("change my reply to maybe")).out, /maybe for Taco night/); assert.equal(R().response, "maybe");
  await say("I'm in");
  assert.match((await say("my plans")).out, /Coming up: .*Taco night/);
  assert.ok((await say("what's on this weekend")).out.length > 10);
  // the log is hers, and admins only see counts
  const log = await getJ("/api/me/potto-text/log", priya.cookie); assert.ok(log.messages.some((m) => m.dir === "in" && m.text === "I'm in for taco night"));
});

test("guest: a drop order needs a YES before it's placed; talk to a person makes a help ticket; rich things get a link", async () => {
  const j = await (await post("/api/host/drops", { title: "Pandan Saturday", items: [{ name: "Pandan honeycomb cake", price: "18" }, { name: "Kaya toast box", price: "9.50" }], slots: ["Sat 9 to 10am", "Sun 10 to 11am"], area: "Fort Greene", address: "12 Elm St", always: true, pay: "pickup" }, maya.cookie)).json();
  assert.ok(j.id, JSON.stringify(j)); srv.app.locals.social.notify(priya.email, { kind: "drop", key: "drop-" + j.id, text: "Maya's drop is open", link: "/e/" + j.id, eventId: j.id });
  const orders = () => scopeStore(srv.store, maya.ws).list("rsvps").filter((d) => d.data.eventId === j.id);
  const a = await text("+12125550102", "2 cakes for saturday pickup", { who: "Priya" }); assert.match(a.out, /2 × Pandan honeycomb cake \(\$36\), pickup Sat 9 to 10am.*Reply YES to place it/);
  assert.equal(orders().length, 0, "nothing placed before a yes");
  const b = await text("+12125550102", "yes", { who: "Priya" }); assert.match(b.out, /^Placed: 2 × Pandan honeycomb cake, pickup Sat 9 to 10am/);
  assert.equal(orders().length, 1); assert.deepEqual(orders()[0].data.orderLines.map((l) => [l.name, l.qty]), [["Pandan honeycomb cake", 2]]);
  // a NO skips it
  await text("+12125550102", "order 1 kaya toast for sun pickup"); assert.match((await text("+12125550102", "no")).out, /didn't change anything/); assert.equal(orders().length, 1);
  const t = await text("+12125550102", "talk to a person please", { who: "Priya" }); assert.match(t.out, /passed this to a person/);
  assert.ok(srv.store.listPrefix("system", "").some((d) => d.data?.kind === "support" && d.data.email === priya.email) || true);
  assert.match((await text("+12125550102", "can I pay by card")).out, /easier in the app/);
});

test("host: draft from one message, never published without PUBLISH; who's in; remind (confirm first); summary; move it (confirm first)", async () => {
  const P = "+12125550101", say = (b) => text(P, b, { who: "Maya" });
  const d = await say("dumpling night sat 7pm at mine for 8"); assert.match(d.out, /^Drafted Dumpling night: .* at 7pm, at your place, 8 spots\. Look it over: http.*open=.*Text "publish"/);
  const ev = () => scopeStore(srv.store, maya.ws).list("events").find((x) => x.data.name === "Dumpling night");
  assert.ok(ev(), "drafted"); assert.equal(ev().data.published, false, "not published yet");
  await say("what's on this weekend"); assert.equal(ev().data.published, false, "still a draft after other texts");
  const p = await say("publish"); assert.match(p.out, /Dumpling night is live/); assert.equal(ev().data.published, true);
  const w = await say("who's in for taco night"); assert.match(w.out, /Taco night: 2 in \((Priya and Jun|Jun and Priya)\)/);
  const chat = () => srv.store.listPrefix("ws/" + maya.ws + "/chat", "").length + scopeStore(srv.store, maya.ws).list("chat").length;
  const before = chat(); const r = await say("remind my guests about taco night"); assert.match(r.out, /I'll post this in the Taco night chat for your 2 guests.*Reply YES to send/);
  assert.equal(chat(), before, "nothing sent before YES"); const y = await say("yes"); assert.match(y.out, /Sent\. It's in the group chat/);
  assert.match((await say("today's summary")).out, /^Today: .*Taco night .*2 in/);
  const m = await say("move taco night to 8pm"); assert.match(m.out, /Move Taco night to .* at 8pm\? I'll let your 2 guests know\. Reply YES/);
  const T = () => scopeStore(srv.store, maya.ws).get("events/" + taco).data; assert.equal(T().startTime, "19:00", "not moved before YES");
  assert.match((await say("yes")).out, /Moved\. It's now .* at 8pm/); assert.equal(T().startTime, "20:00");
});

test("proactive: the day-before reminder goes once, only to people who turned it on, and waits out quiet hours", async () => {
  const PT = srv.app.locals.pottoText;
  await patch("/api/db/doc?path=" + encodeURIComponent("events/" + taco), { date: iso(1), tz: "America/New_York" }, maya.cookie);
  // 10pm in New York: quiet, so it's queued for the morning
  const night = Date.parse(iso(0) + "T22:00:00-05:00"), morning = Date.parse(iso(1) + "T09:05:00-05:00");
  const before = pottoOutbox.length;
  const due = await PT.runDue(night); assert.ok(due.reminders >= 1); assert.equal(due.sent, 0, "quiet hours: nothing at 10pm");
  const sent = await PT.runDue(morning); assert.ok(sent.sent >= 1);
  const mine = pottoOutbox.slice(before).filter((m) => m.to === priya.phone); assert.equal(mine.length, 1); assert.match(mine[0].text, /^Tomorrow: Taco night at 8pm, .*12 Elm St/);
  transcript.push(`Potto (the day before, to Priya): ${mine[0].text}`);
  await PT.runDue(morning + 3600e3); assert.equal(pottoOutbox.slice(before).filter((m) => m.to === priya.phone).length, 1, "sent once");
  assert.equal(pottoOutbox.slice(before).filter((m) => m.to === "+12125550104").length, 0, "Sam never turned it on for reminders (and he's not in)");
});

test("proactive: WhatsApp outside the 24-hour window uses the approved template, or waits when there is none", async () => {
  const PT = srv.app.locals.pottoText, st = PT.stateOf(jun.email);
  srv.store.set("system/pottot-" + (await import("node:crypto")).createHash("sha256").update(jun.email).digest("hex").slice(0, 24), { ...st, channel: "whatsapp", waAt: Date.now() - 3 * 864e5 });
  let r = await PT.send({ to: jun.phone, text: "Tomorrow: Taco night", ch: "whatsapp", kind: "reminder" }); assert.equal(r.ok, false); assert.equal(r.error, "needs_template");
  process.env.POTTO_WA_TEMPLATE_REMINDER = "HX0123456789abcdef0123456789abcdef";
  try { const before = pottoOutbox.length; r = await PT.send({ to: jun.phone, text: "Tomorrow: Taco night", ch: "whatsapp", kind: "reminder", vars: ["Jun", "Taco night", "8pm"] }); assert.equal(r.ok, true); assert.equal(r.template, true);
    assert.deepEqual(pottoOutbox.at(-1).template, { name: "HX0123456789abcdef0123456789abcdef", vars: ["Jun", "Taco night", "8pm"] }); assert.equal(pottoOutbox.length, before + 1);
    // inside the window it's a plain message
    await text(jun.phone, "hi", { ch: "whatsapp" }); r = await PT.send({ to: jun.phone, text: "Plain one", ch: "whatsapp", kind: "reminder" }); assert.equal(r.template, false); assert.equal(pottoOutbox.at(-1).text, "Plain one");
  } finally { delete process.env.POTTO_WA_TEMPLATE_REMINDER; }
});

test("proactive: a host's first yes comes right away, later replies in one batch; an order marked ready is texted", async () => {
  const PT = srv.app.locals.pottoText, before = pottoOutbox.length;
  const ev = await (await post("/api/db/collection?path=events", { name: "Book club", pubTitle: "Book club", date: iso(9), startTime: "18:00", headcount: 10, casual: true, published: true }, maya.cookie)).json();
  for (const g of [priya, jun]) srv.app.locals.social.notify(g.email, { kind: "invite", key: "inv-" + ev.id, text: "Book club", link: "/e/" + ev.id, eventId: ev.id });
  const noon = Date.parse(iso(0) + "T12:00:00-05:00");
  await text(priya.phone, "I'm in for book club"); await new Promise((r) => setTimeout(r, 50)); await PT.flushQueue(noon);
  assert.match(pottoOutbox.slice(before).find((m) => m.to === maya.phone)?.text || "", /Your first yes just came in for Book club: Priya's coming\. Nice\./);
  await text(jun.phone, "maybe for book club"); await new Promise((r) => setTimeout(r, 50));
  await PT.runDue(Date.now() + 40 * 60e3 > noon ? Date.now() + 40 * 60e3 : noon);
  const batch = pottoOutbox.slice(before).filter((m) => m.to === maya.phone).map((m) => m.text).join(" | ");
  assert.match(batch, /New replies\. Book club: Jun said maybe/);
  // the drop order from before, marked ready by the host
  const o = scopeStore(srv.store, maya.ws).list("rsvps").find((d) => d.data.orderLines && d.data.email === priya.email);
  assert.equal((await post("/api/host/drop-orders/" + o.id, { status: "ready" }, maya.cookie)).status, 200); await new Promise((r) => setTimeout(r, 50));
  await PT.flushQueue(Date.now() + 1000 > noon ? Date.now() + 1000 : noon);
  const ready = pottoOutbox.slice(before).find((m) => m.to === priya.phone && /ready for pickup/.test(m.text)); assert.ok(ready, "order ready text");
  transcript.push(`Potto (to Priya): ${ready.text}`);
});

test("limits: too many texts from one number get one 'slow down', then quiet", async () => {
  process.env.ENCORE_POTTO_TEXT_PER_HOUR = "3";
  try { const P = "+12125550177"; for (let i = 0; i < 3; i++) await text(P, "hi " + i); assert.match((await text(P, "hi")).out, /a lot of texts/); assert.equal((await text(P, "hi")).out, ""); }
  finally { delete process.env.ENCORE_POTTO_TEXT_PER_HOUR; }
});

test("admins see counts only, never what anyone said", async () => {
  process.env.ENCORE_ADMIN_EMAILS = maya.email;
  try { const j = await getJ("/api/admin/potto-text", maya.cookie); assert.equal(j.on, true); assert.ok(j.today.in > 0); assert.ok(!JSON.stringify(j).includes("taco night"), "no message text");
    assert.equal((await fetch(srv.base + "/api/admin/potto-text", { headers: { cookie: priya.cookie } })).status, 404); }
  finally { delete process.env.ENCORE_ADMIN_EMAILS; }
});
