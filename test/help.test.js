import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { fakeOutbox } from "../server/email.js";
import { fakeTexts } from "../server/sms.js";
import { scopeStore } from "../server/workspaces.js";
import { offlineAnswer, parseGuide, loadGuide } from "../server/help.js";

let srv;
const J = { "content-type": "application/json" };
const req = (method, path, body, cookie) => fetch(srv.base + path, { method, headers: { ...J, ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
const host = async (name, email, handle) => { const r = await req("POST", "/api/signup", { name, email, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200); const c = cookieOf(r); if (handle) assert.equal((await req("POST", "/api/host/profile", { handle, name }, c)).status, 200); return c; };
const ENV = ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_ADMIN_EMAILS", "ENCORE_SUPPORT_EMAIL", "ENCORE_SUPPORT_SMS", "ENCORE_FAKE_EMAIL", "ENCORE_FAKE_SMS"];

before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "help-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; process.env.ENCORE_ADMIN_EMAILS = "team@pottery.example, other@pottery.example";
  for (const k of ["ENCORE_SUPPORT_EMAIL", "ENCORE_SUPPORT_SMS", "ENCORE_FAKE_EMAIL", "ENCORE_FAKE_SMS"]) delete process.env[k]; resetLoginLimits(); });
after(async () => { for (const k of ENV) delete process.env[k]; await srv.close(); });

test("help guide: every section has words to match and no em dashes", () => {
  const G = loadGuide(); assert.ok(G.sections.length >= 25, "the guide covers the product");
  for (const s of G.sections) { assert.ok(s.keywords.length, `${s.title} has keywords`); assert.ok(s.body.length > 20, `${s.title} has an answer`); }
  assert.ok(!/—/.test(G.md), "no em dashes in the guide");
  assert.deepEqual(parseGuide("## A\nKeywords: x, y z\nLine one. [Go](/go)\n[Two](/two)").map((s) => [s.title, s.keywords, s.body, s.links.length]), [["A", ["x", "y z"], "Line one. Go", 2]]);
  for (const [q, title] of [["How do I share my invite?", "Sharing your invite"], ["How do guests pay?", "How guests pay"], ["I don't have a host code", "Host codes and invite-only"], ["It says my email is already in use", "Email already in use"], ["My reset email didn't come", "Reset email didn't arrive"], ["What are the password rules?", "Password rules"], ["How do I change my page look?", "Change my page look"], ["How do I add past events?", "Past events and the scrapbook"]])
    assert.equal(offlineAnswer(q).section, title, q);
  const none = offlineAnswer("what's the weather on mars");
  assert.equal(none.section, null); assert.equal(none.suggestHuman, true); assert.match(none.answer, /I'm not sure/);
});

test("ask: anyone can ask from any page (launch), answers from the guide offline, and is rate limited per person", async () => {
  // signed out on the app or a public page (a guest on an invite, a brand on /teams): it answers, with no account context
  assert.equal((await req("POST", "/api/help/ask", { message: "How do I share my invite?", page: "/?app=1#studio" })).status, 200, "signed out, on the app");
  assert.equal((await req("POST", "/api/help/ask", { message: "How do I share my invite?", page: "/discover" })).status, 200, "signed out, on a public page");
  assert.doesNotMatch(srv.app.locals.help.lastPrompt, /"handle"|"event"/, "no account context");
  const c = await host("Ana Ask", "ana@example.com", "ana-asks");
  const r = await req("POST", "/api/help/ask", { message: "How do I share my invite?", page: "/?app=1#studio", history: [{ role: "host", text: "hi" }] }, c);
  assert.equal(r.status, 200); const j = await r.json();
  assert.equal(j.mode, "guide", "no key: the guide answers"); assert.equal(j.section, "Sharing your invite"); assert.match(j.answer, /Copy invite/);
  assert.equal(j.confidence, "high"); assert.ok(j.actions.some((a) => a.href === "#do:share"), "one tap to the share sheet");
  assert.ok(!j.actions.some((a) => a.href === "#person"), "a sure answer doesn't push a person (the sheet's footer always has one)");
  const unsure = await (await req("POST", "/api/help/ask", { message: "what's the weather on mars", page: "/" }, c)).json();
  assert.ok(unsure.actions.some((a) => a.label === "Talk to a person" && a.href === "#person"), "an I don't know offers a person"); assert.equal(unsure.suggestHuman, true);
  assert.equal(typeof j.suggestHuman, "boolean"); assert.ok(!/—/.test(j.answer));
  for (let i = 2; i < 30; i++) assert.equal((await req("POST", "/api/help/ask", { message: "How do guests pay?", page: "/" }, c)).status, 200, `ask ${i + 1}`);
  const lim = await req("POST", "/api/help/ask", { message: "How do guests pay?", page: "/" }, c);
  assert.equal(lim.status, 429, "31st ask in an hour"); assert.equal((await lim.json()).suggestHuman, true);
  // someone else still can
  const c2 = await host("Ben Ask", "ben@example.com");
  assert.equal((await req("POST", "/api/help/ask", { message: "How do guests pay?", page: "/" }, c2)).status, 200);
  assert.equal((await req("POST", "/api/help/ask", { message: "", page: "/" }, c2)).status, 400);
});

test("ask, signed out: works on the signup page, with no account context, 10 an hour per IP", async () => {
  const r = await req("POST", "/api/help/ask", { message: "I don't have a host code. How do I get one?", page: "/signup?mode=friends", eventId: "anything" });
  assert.equal(r.status, 200); const j = await r.json(); assert.equal(j.section, "Host codes and invite-only"); assert.match(j.answer, /host code/i);
  assert.match(srv.app.locals.help.lastPrompt, /"signedIn":false/); assert.doesNotMatch(srv.app.locals.help.lastPrompt, /"handle"|"event"/, "no account context");
  assert.equal((await req("POST", "/api/help/ask", { message: "hi", page: "/login", website: "http://spam" })).status, 400, "the honeypot blocks");
  // the two signed-out asks in the test before count too: 10 an hour from this IP in all
  for (let i = 3; i < 10; i++) assert.equal((await req("POST", "/api/help/ask", { message: "Password rules?", page: i % 2 ? "/login" : "/forgot" })).status, 200, `ask ${i + 1}`);
  assert.equal((await req("POST", "/api/help/ask", { message: "Password rules?", page: "/signup" })).status, 429, "11th from this IP");
});

test("ask: the model prompt has the host's light context and never a guest's details", async () => {
  const c = await host("Cleo Context", "cleo@example.com", "cleo-cooks");
  const ws = (await (await req("GET", "/api/me", null, c)).json()).workspace.id, S = scopeStore(srv.store, ws);
  S.set("events/helpev1", { name: "Dumpling night", pubTitle: "Dumpling night", date: "2099-05-01", casual: true, published: true, approvalRequired: true, price: "$20", venueAddr: "12 Elm St apt 4B",
    guests: [{ name: "Gina Guestly", email: "gina@guest.example", phone: "+15557654321", notes: "allergic to shrimp" }] });
  S.set("rsvps/r1", { eventId: "helpev1", name: "Rory Replier", email: "rory@guest.example", phone: "+15551112222", response: "going", dietary: "vegan" });
  const r = await req("POST", "/api/help/ask", { message: "How do guests pay?", page: "/?app=1#studio", eventId: "helpev1" }, c); assert.equal(r.status, 200);
  const p = srv.app.locals.help.lastPrompt;
  assert.match(p, /"handle":"cleo-cooks"/); assert.match(p, /"title":"Dumpling night"/); assert.match(p, /"status":"shared"/); assert.match(p, /"page":"\/\?app=1#studio"/); assert.match(p, /"pageMissing":\[/);
  assert.match(p, /<guide>[\s\S]*## Sharing your invite[\s\S]*<\/guide>/, "the guide is the knowledge");
  for (const secret of ["Gina", "gina@guest.example", "5557654321", "shrimp", "Rory", "rory@guest.example", "5551112222", "vegan", "Elm St"]) assert.ok(!p.includes(secret), `no ${secret} in the prompt`);
  // an event in someone else's workspace isn't read
  const c2 = await host("Dev Other", "dev@example.com");
  await req("POST", "/api/help/ask", { message: "How do guests pay?", page: "/", eventId: "helpev1" }, c2);
  assert.ok(!srv.app.locals.help.lastPrompt.includes("\"title\":\"Dumpling night\""));
});

test("ticket: stores the context, emails the team when set up (texts only when urgent), and is honest when not", async () => {
  const c = await host("Tess Ticket", "tess@example.com", "tess-runs");
  const ws = (await (await req("GET", "/api/me", null, c)).json()).workspace.id; scopeStore(srv.store, ws).set("events/helpev2", { name: "Sunday run", date: "2099-06-01", casual: true });
  // nothing set up: still stored, still an honest answer
  let r = await req("POST", "/api/help/ticket", { message: "My invite won't copy", page: "/?app=1#studio", eventId: "helpev2", browser: "TestBrowser 1.0 · 390x844", transcript: [{ role: "host", text: "copy?" }, { role: "potto", text: "Tap Copy invite." }] }, c);
  assert.equal(r.status, 200); let j = await r.json(); assert.equal(j.expect, "A person replies within a day, here and by email.");
  let t = srv.store.get("system/support-" + j.id).data;
  assert.equal(t.status, "open"); assert.equal(t.email, "tess@example.com"); assert.equal(t.handle, "tess-runs"); assert.equal(t.signedIn, true);
  assert.equal(t.context.page, "/?app=1#studio"); assert.equal(t.context.eventId, "helpev2"); assert.equal(t.context.eventTitle, "Sunday run"); assert.equal(t.context.browser, "TestBrowser 1.0 · 390x844");
  assert.equal(t.context.app.version, "0.1.0"); assert.equal(t.transcript.length, 2); assert.deepEqual(t.notified, { email: false, sms: 0 });
  // email and texts set up
  process.env.ENCORE_FAKE_EMAIL = "1"; process.env.ENCORE_FAKE_SMS = "1"; process.env.ENCORE_SUPPORT_EMAIL = "team@pottery.example, help@pottery.example"; process.env.ENCORE_SUPPORT_SMS = "+15550001111";
  const before = fakeOutbox.length, texts = fakeTexts.length;
  r = await req("POST", "/api/help/ticket", { message: "Guests can't see my address", page: "/@tess-runs", phone: "+1 555 222 3333", screenshot: "/_blob/AAAAAAAAAAAAAAAAAAAA" }, c); j = await r.json(); assert.equal(r.status, 200);
  const mail = fakeOutbox.slice(before).find((m) => m.to.includes("team@pottery.example"));
  assert.ok(mail, "the team got an email"); assert.deepEqual(mail.to, ["team@pottery.example", "help@pottery.example"]); assert.equal(mail.replyTo, "tess@example.com");
  assert.match(mail.text, /Guests can't see my address/); assert.match(mail.text, new RegExp(`/support#t-${j.id}`)); assert.match(mail.text, /Page: \/@tess-runs/);
  assert.equal(fakeTexts.length, texts, "a normal ticket is emailed, not texted (launch: texts are for event-day tickets)");
  t = srv.store.get("system/support-" + j.id).data; assert.equal(t.phone, "+1 555 222 3333"); assert.equal(t.screenshot, "/_blob/AAAAAAAAAAAAAAAAAAAA"); assert.deepEqual(t.notified, { email: true, sms: 0 });
  // the host sees it under Your conversations
  const mine = await (await req("GET", "/api/help/tickets", null, c)).json(); assert.equal(mine.tickets.length, 2); assert.equal(mine.admin, false);
  assert.equal((await req("POST", "/api/help/ticket", { message: "" }, c)).status, 400, "needs a message");
});

test("ticket, signed out: needs an email, the honeypot blocks, and it lands with no account", async () => {
  assert.equal((await req("POST", "/api/help/ticket", { message: "I can't get past signup", page: "/signup", website: "http://spam.example" })).status, 400, "honeypot");
  assert.equal((await req("POST", "/api/help/ticket", { message: "I can't get past signup", page: "/signup", email: "nope", website: "http://spam.example" })).status, 400);
  const n0 = srv.store.list("system").filter((d) => d.data?.kind === "support").length;
  const no = await req("POST", "/api/help/ticket", { message: "I can't get past signup", page: "/signup" }); assert.equal(no.status, 400); assert.match((await no.json()).message, /email/i);
  const r = await req("POST", "/api/help/ticket", { message: "It says my email is already in use but I never signed up", email: "Sam@Example.com", name: "Sam", topic: "email_taken", page: "/signup?mode=friends" });
  assert.equal(r.status, 200); const j = await r.json(); assert.match(j.expect, /sam@example\.com/);
  const t = srv.store.get("system/support-" + j.id).data; assert.equal(t.signedIn, false); assert.equal(t.ws, null); assert.equal(t.topic, "email_taken"); assert.equal(t.email, "sam@example.com"); assert.equal(t.context.page, "/signup?mode=friends");
  assert.equal(srv.store.list("system").filter((d) => d.data?.kind === "support").length, n0 + 1, "the honeypot ones were never stored");
  assert.equal((await req("GET", "/api/help/tickets")).status, 401);
});

test("/support: 404 for everyone but admins; admins list, reply and set status; the host hears in the app, by email and in the panel", async () => {
  const hostC = await host("Hana Host", "hana@example.com", "hana-hikes"), admin = await host("Team Member", "team@pottery.example");
  const tk = await (await req("POST", "/api/help/ticket", { message: "How do I change my handle?", page: "/@hana-hikes" }, hostC)).json();
  for (const c of [undefined, hostC]) {
    assert.equal((await req("GET", "/support", null, c)).status, 404, "the page");
    assert.equal((await req("GET", "/api/support/tickets", null, c)).status, 404, "the list");
    assert.equal((await req("POST", `/api/support/tickets/${tk.id}`, { reply: "hi" }, c)).status, 404, "replying");
  }
  const page = await req("GET", "/support", null, admin); assert.equal(page.status, 200); assert.match(await page.text(), /Help inbox/);
  const L = await (await req("GET", "/api/support/tickets", null, admin)).json();
  const row = L.tickets.find((t) => t.id === tk.id); assert.ok(row); assert.equal(row.context.page, "/@hana-hikes"); assert.ok(L.counts.open >= 1);
  assert.equal((await (await req("GET", "/api/help/tickets", null, admin)).json()).admin, true);
  // the reply
  process.env.ENCORE_FAKE_EMAIL = "1"; process.env.ENCORE_SUPPORT_EMAIL = "team@pottery.example"; const before = fakeOutbox.length;
  const rep = await req("POST", `/api/support/tickets/${tk.id}`, { reply: "I've changed it to hana-hikes-nyc for you." }, admin); assert.equal(rep.status, 200);
  const rj = await rep.json(); assert.equal(rj.ticket.status, "waiting"); assert.deepEqual(rj.notified, { inbox: true, email: true });
  const inbox = (await (await req("GET", "/api/me/inbox", null, hostC)).json()).items; const n = inbox.find((x) => x.kind === "support");
  assert.ok(n, "an in-app notification"); assert.match(n.text, /changed it to hana-hikes-nyc/); assert.equal(n.link, "/?app=1&help=1");
  const mail = fakeOutbox.slice(before).find((m) => m.to.includes("hana@example.com")); assert.ok(mail, "an email"); assert.match(mail.text, /changed it to hana-hikes-nyc/); assert.equal(mail.replyTo, "team@pottery.example");
  const mine = (await (await req("GET", "/api/help/tickets", null, hostC)).json()).tickets[0];
  assert.equal(mine.status, "waiting"); assert.deepEqual(mine.thread.map((m) => m.by), ["host", "team"]); assert.equal(mine.thread[1].name, "Pottery Lab"); assert.equal(mine.thread[1].email, undefined, "no team emails to hosts");
  // the host answers back, and it opens again; the team solves it
  const back = await req("POST", `/api/help/tickets/${tk.id}`, { text: "Thank you!" }, hostC); assert.equal((await back.json()).ticket.status, "open");
  assert.equal((await req("POST", `/api/help/tickets/${tk.id}`, { text: "not mine" }, admin)).status, 404, "only the host's own");
  const solved = await (await req("POST", `/api/support/tickets/${tk.id}`, { status: "solved" }, admin)).json(); assert.equal(solved.ticket.status, "solved");
  assert.equal((await (await req("GET", "/api/support/tickets?status=solved", null, admin)).json()).tickets.some((t) => t.id === tk.id), true);
});
