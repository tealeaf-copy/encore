// Launch: support for everyone (public/report.js, public/help.js, server/help.js), the client error reporter
// (server/errors.js), /admin/launch, invite code batches and the status line (server/launch.js), and the checklist
// (docs/launch-checklist.md).
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { fakeTexts } from "../server/sms.js";
import { scrub, cleanStack } from "../server/errors.js";
import { launchChecks } from "../server/launch.js";

let srv;
const J = { "content-type": "application/json" };
const req = (method, p, body, cookie, headers = {}) => fetch(srv.base + p, { method, headers: { ...J, ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
const signup = async (name, email, extra = {}) => { const r = await req("POST", "/api/signup", { name, email, password: "long-password-1", mode: "friends", ...extra }); assert.equal(r.status, 200, `${email}: ${r.status}`); return cookieOf(r); };
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const SECRETS = { SESSION_SECRET: "launch-session-secret-0123456789abcdef-XYZ", ENCORE_EMAIL_KEY: "re_live_secretkey_9f8e7d", STRIPE_SECRET_KEY: "sk_test_supersecret_abc123", ENCORE_TWILIO_TOKEN: "twilio-token-secret-777", ANTHROPIC_API_KEY: "sk-ant-secret-launch-555" };
const ENV = ["ENCORE_SIGNUP", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_ADMIN_EMAILS", "ENCORE_SUPPORT_EMAIL", "ENCORE_SUPPORT_SMS", "ENCORE_FAKE_SMS", "ENCORE_FAKE_EMAIL", "ENCORE_INVITE_ONLY", "ENCORE_EMAIL_FROM", ...Object.keys(SECRETS)];
let admin;

before(async () => { srv = await startServer(); process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = SECRETS.SESSION_SECRET; process.env.ENCORE_SIGNUP_PER_HOUR = "200"; process.env.ENCORE_ADMIN_EMAILS = "owner@pottery.example"; admin = await signup("Olive Owner", "owner@pottery.example"); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = SECRETS.SESSION_SECRET; process.env.ENCORE_SIGNUP_PER_HOUR = "200"; process.env.ENCORE_ADMIN_EMAILS = "owner@pottery.example"; resetLoginLimits(); });
after(async () => { for (const k of ENV) delete process.env[k]; await srv.close(); });

test("help is on every page for everyone: the loader is in every head, the links are in the nav, invites, chats, error pages and footers", async () => {
  const h = await signup("Ivy Invite", "ivy-invite@example.com");
  assert.equal((await req("PUT", "/api/db/doc?path=events/supinv1", { kind: "social", casual: true, name: "Clay night", date: "2099-12-12", startTime: "19:00", city: "Brooklyn", published: true }, h)).status, 200);
  for (const p of ["/g", "/chats", "/teams", "/teams/home", "/teams/discover", "/e/supinv1", "/login", "/signup", "/plans", "/discover", "/help", "/no-such-page"]) {
    const html = await (await req("GET", p, null, null, { accept: "text/html" })).text();
    assert.match(html, /<script src="\/report\.js(\?v=[\w-]+)?" defer><\/script>/, `${p} loads public/report.js`);
    if (!/^\/(login|signup)$/.test(p)) assert.doesNotMatch(html.replace(/<script src="\/report\.js[^>]*><\/script>/, ""), /<script[^>]+src="\/help\.js/, `${p} doesn't load help.js up front (sign-in and sign-up keep their floating button)`);
  }
  const inv = await (await req("GET", "/e/supinv1")).text(); assert.ok(inv.length < 40000, `the light invite stays under 40,000 (${inv.length})`); assert.ok(read("public/invite.html").length < 40000);
  assert.match(read("public/invite.html"), /<a href="\/help" data-help="guest">Help<\/a><\/footer>/, "the invite's footer");
  assert.match(read("index.html"), /Made with Pottery Lab"\} · <a href="\/help" data-help="guest">Help<\/a>/, "the full invite (/g)");
  assert.match(read("public/chat.js"), /data-help="\$\{T\.me\.role === "guest" \? "guest" : "host"\}">\$\{G\.help \|\| G\.open\}Get help<\/a>/, "the chat's details sheet, not a button over the messages");
  assert.match(read("public/shell.js"), /`<a href="\/help" class="es-out es-set" data-help>Help<\/a>`/, "the rail, signed out");
  assert.doesNotMatch(read("public/shell.js"), /__encoreHelpLoad/, "the shell no longer loads help.js on every page");
  assert.match(read("public/404.html"), /<a href="\/help" data-help[^>]*>Get help<\/a> <small><!--REF--><\/small>/); assert.match(read("public/offline.html"), /href="\/help" data-help/);
  const r = read("public/report.js"); assert.match(r, /window\.__ehLazy = 1/); assert.match(r, /if \(!window\.EncoreHelp\) window\.EncoreHelp = window\.PLHelp = stub/); assert.match(r, /went wrong/);
  const w = read("public/help.js"); assert.match(w, /const LAZY = !!window\.__ehLazy/); assert.match(w, /if \(!LAZY && \(GUEST/);
  for (const f of ["public/report.js", "public/help.html", "docs/launch-checklist.md", "server/launch.js", "server/errors.js"]) assert.ok(!/—/.test(read(f)), `${f}: no em dashes`);
  // a server error gives a ref, and the error page links to help with it
  const page = await (await req("GET", "/help")).text(); assert.match(page, /How can we help\?/); assert.match(page, /data-help-urgent/);
});

test("signed out, help answers from any page; a ticket needs an email or a phone, gets a key, and the reply comes back to it", async () => {
  const a = await req("POST", "/api/help/ask", { message: "How do I reply to an invite?", page: "/e/supinv1" }); assert.equal(a.status, 200); assert.equal((await a.json()).section, "Replying to an invite");
  const none = await req("POST", "/api/help/ticket", { message: "The address isn't showing", page: "/e/supinv1", role: "guest" }); assert.equal(none.status, 400); assert.match((await none.json()).message, /email or phone/);
  assert.equal((await req("POST", "/api/help/ticket", { message: "The address isn't showing", contact: "not a thing" })).status, 400);
  const byPhone = await (await req("POST", "/api/help/ticket", { message: "The address isn't showing", contact: "+1 555 010 2020", page: "/e/supinv1", eventId: "supinv1", role: "guest", errorIds: ["abc12345", "bad id!"], app: "a1b2c3" })).json();
  const t = srv.store.get("system/support-" + byPhone.id).data;
  assert.equal(t.phone, "+1 555 010 2020"); assert.equal(t.email, ""); assert.equal(t.role, "guest"); assert.equal(t.context.eventId, "supinv1"); assert.deepEqual(t.context.errorIds, ["abc12345"]); assert.equal(t.context.client, "a1b2c3"); assert.match(byPhone.expect, /by text/);
  assert.match(byPhone.key, /^[a-f0-9]{32}$/, "the device keeps a key to read the reply");
  // the key reads it, nothing else does
  assert.equal((await req("GET", `/api/help/t/${byPhone.id}?k=${"0".repeat(32)}`)).status, 404);
  assert.equal((await req("GET", `/api/help/t/${byPhone.id}`)).status, 404);
  const mine = await (await req("GET", `/api/help/t/${byPhone.id}?k=${byPhone.key}`)).json(); assert.equal(mine.ticket.thread.length, 1); assert.equal(mine.ticket.key, undefined);
  // the owner replies by text (they only left a phone), and it shows in their chat
  process.env.ENCORE_FAKE_SMS = "1"; const n0 = fakeTexts.length;
  const rep = await (await req("POST", `/api/support/tickets/${byPhone.id}`, { reply: "It shows once you tap I'm in." }, admin)).json(); assert.equal(rep.notified.sms, true);
  assert.ok(fakeTexts.slice(n0).some((x) => x.to.replace(/\D/g, "").endsWith("5550102020") && /tap I'm in/.test(x.text)));
  const after1 = await (await req("GET", `/api/help/t/${byPhone.id}?k=${byPhone.key}`)).json(); assert.deepEqual(after1.ticket.thread.map((m) => m.by), ["host", "team"]);
  const back = await req("POST", `/api/help/t/${byPhone.id}`, { k: byPhone.key, text: "Got it, thanks" }); assert.equal(back.status, 200); assert.equal((await back.json()).ticket.status, "open");
  const byEmail = await (await req("POST", "/api/help/ticket", { message: "Can I bring a friend?", contact: "Gia@Example.com" })).json(); assert.equal(srv.store.get("system/support-" + byEmail.id).data.email, "gia@example.com");
  delete process.env.ENCORE_FAKE_SMS;
});

test("My event is today: flagged urgent, first on /support, texted to ENCORE_SUPPORT_SMS at once, and rate limited", async () => {
  process.env.ENCORE_FAKE_SMS = "1"; process.env.ENCORE_FAKE_EMAIL = "1"; process.env.ENCORE_SUPPORT_EMAIL = "help@pottery.example"; process.env.ENCORE_SUPPORT_SMS = "+15550009999";
  const h = await signup("Uri Urgent", "uri-urgent@example.com"), n0 = fakeTexts.length;
  const normal = await (await req("POST", "/api/help/ticket", { message: "How do I change my handle?", page: "/" }, h)).json(); assert.equal(normal.texted, false);
  assert.equal(fakeTexts.length, n0, "a normal ticket isn't texted when the support email is set");
  const u1 = await (await req("POST", "/api/help/ticket", { message: "Guests can't open the invite and we start in an hour", page: "/?app=1", urgent: true }, h)).json();
  assert.equal(u1.urgent, true); assert.equal(u1.texted, true); assert.match(u1.expect, /^We've texted the team\./);
  const tx = fakeTexts.slice(n0); assert.equal(tx.length, 1); assert.equal(tx[0].to, "+15550009999"); assert.match(tx[0].text, /^URGENT, event today\./);
  assert.equal(srv.store.get("system/support-" + u1.id).data.urgent, true);
  const u2 = await (await req("POST", "/api/help/ticket", { message: "Still broken, guests at the door", urgent: true }, h)).json(); assert.equal(u2.texted, true);
  const u3 = await (await req("POST", "/api/help/ticket", { message: "Again, still broken", urgent: true }, h)).json();
  assert.equal(u3.texted, false, "a third urgent text in an hour from one person is held back"); assert.ok(srv.store.get("system/support-" + u3.id).data.urgent, "but it's still stored, urgent");
  // the inbox: urgent open ones first
  const L = await (await req("GET", "/api/support/tickets", null, admin)).json();
  assert.equal(L.tickets[0].urgent, true); assert.ok(L.urgent >= 3); assert.equal(L.setup.supportEmail, true); assert.equal(L.tickets.some((t) => "key" in t), false, "a signed-out person's key never shows");
  for (const k of ["ENCORE_FAKE_SMS", "ENCORE_FAKE_EMAIL", "ENCORE_SUPPORT_EMAIL", "ENCORE_SUPPORT_SMS"]) delete process.env[k];
  // no support email: a red setup line, tickets still stored and listed
  const L2 = await (await req("GET", "/api/support/tickets", null, admin)).json(); assert.equal(L2.setup.supportEmail, false); assert.ok(L2.tickets.length >= 3);
  assert.match(await (await req("GET", "/support", null, admin)).text(), /ENCORE_SUPPORT_EMAIL isn't set, so nobody is emailed/);
});

test("error reports: compact, scrubbed of anything personal, rate limited, and only admins read them", async () => {
  assert.equal(scrub("Failed for jo@example.com at +1 (555) 123-4567 with token abcdefghijklmnopqrstuvwxyz123456"), "Failed for [email] at [number] with token [id]");
  assert.deepEqual(cleanStack("TypeError: x\n    at draw (https://potterylab.com/feed.js?v=abc:12:5)\n    at go (https://potterylab.com/app.js:1:2)"), ["at draw (/feed.js:12:5)", "at go (/app.js:1:2)"]);
  const ip = { "x-forwarded-for": "203.0.113.9" };
  const r = await req("POST", "/api/errors", { id: "err0001a", kind: "error", message: "Cannot read properties of undefined (reading 'name') for sam@example.com", stack: "TypeError: x\n    at draw (http://127.0.0.1/feed.js?token=SECRET123:4:9)", page: "/e/supinv1?code=SECRETCODE#rsvp", app: "abc123" }, null, ip);
  assert.equal(r.status, 204);
  const E = await (await req("GET", "/api/admin/errors", null, admin)).json(), e = E.errors.find((x) => x.ids.includes("err0001a"));
  assert.ok(e); assert.equal(e.page, "/e/supinv1"); assert.match(e.message, /\[email\]/); assert.ok(!JSON.stringify(e).includes("sam@example.com")); assert.ok(!JSON.stringify(e).includes("SECRET"), "no query strings");
  assert.equal((await req("POST", "/api/errors", { id: "bad id", message: "x" })).status, 400);
  // the same problem again is counted, not stored twice
  await req("POST", "/api/errors", { id: "err0001b", kind: "error", message: "Cannot read properties of undefined (reading 'name') for sam@example.com", stack: "TypeError: x\n    at draw (http://127.0.0.1/feed.js?token=SECRET123:4:9)", page: "/e/supinv1" }, null, ip);
  const e2 = (await (await req("GET", "/api/admin/errors", null, admin)).json()).errors.find((x) => x.ids.includes("err0001a")); assert.equal(e2.n, 2); assert.ok(e2.ids.includes("err0001b"));
  // 10 per IP per 10 minutes (the two above count): the rest are dropped
  let codes = []; for (let i = 0; i < 12; i++) codes.push((await req("POST", "/api/errors", { id: "flood" + String(i).padStart(3, "0"), message: "boom " + i, page: "/" }, null, ip)).status);
  assert.ok(codes.includes(429), "rate limited"); assert.equal(codes.filter((c) => c === 204).length, 8);
  for (const c of [undefined, await signup("Nia Nosy", "nia-nosy@example.com")]) assert.equal((await req("GET", "/api/admin/errors", null, c)).status, 404);
  // the page sends no user content: its report has the message, the top of the stack, the path and the version, nothing else
  const rep = read("public/report.js"); assert.match(rep, /JSON\.stringify\(\{ id, kind, message: m, stack: st, page: P, app: APP/); assert.match(rep, /if \(sent\+\+ < 5\)/);
});

test("/admin/launch and /support: admins only, and never a secret value", async () => {
  Object.assign(process.env, SECRETS, { ENCORE_EMAIL_FROM: "events@pottery.example", ENCORE_SUPPORT_SMS: "+15550001234" });
  const host = await signup("Hal Host", "hal-host@example.com");
  for (const c of [undefined, host]) { for (const p of ["/admin/launch", "/support", "/api/admin/launch", "/api/admin/codes", "/api/support/tickets"]) assert.equal((await req("GET", p, null, c)).status, 404, `${p} for ${c ? "a host" : "someone signed out"}`);
    assert.equal((await req("POST", "/api/admin/codes", { role: "host", n: 2 }, c)).status, 404); assert.equal((await req("POST", "/api/admin/incident", { on: true, message: "Hacked" }, c)).status, 404); }
  const page = await req("GET", "/admin/launch", null, admin); assert.equal(page.status, 200); const html = await page.text(); assert.match(html, /Launch checklist/);
  const J1 = await (await req("GET", "/api/admin/launch", null, admin)).json(), support = await (await req("GET", "/support", null, admin)).text(), tickets = JSON.stringify(await (await req("GET", "/api/support/tickets", null, admin)).json());
  for (const [k, v] of Object.entries(SECRETS)) for (const [what, s] of [["page", html], ["json", JSON.stringify(J1)], ["support", support], ["tickets", tickets]]) assert.ok(!s.includes(v), `${k} never shows on ${what}`);
  const by = Object.fromEntries(J1.checks.map((c) => [c.id, c]));
  assert.equal(by.session_secret.status, "green"); assert.equal(by.stripe.status, "amber", "a test key is test mode"); assert.equal(by.public_url.status, "red"); assert.equal(by.trust_proxy.status, "red"); assert.equal(by.support_email.status, "red");
  assert.equal(by.no_fakes.status, "red", "the test switches are on in tests");
  assert.deepEqual(J1.goal.goal, { hosts: 10, events: 10, registrants: 100, brands: 10 }); assert.equal(typeof J1.goal.events.happened, "number");
  // a half-set sign-in provider is red, a full one green (pure)
  const c2 = launchChecks({ ENCORE_APPLE_SERVICES_ID: "x", ENCORE_GOOGLE_CLIENT_ID: "a", ENCORE_GOOGLE_CLIENT_SECRET: "b", ENCORE_PUBLIC_URL: "https://potterylab.com", ENCORE_TRUST_PROXY: "1" });
  const by2 = Object.fromEntries(c2.map((c) => [c.id, c])); assert.equal(by2.apple.status, "red"); assert.equal(by2.google.status, "green"); assert.equal(by2.public_url.status, "green"); assert.equal(by2.trust_proxy.status, "green");
  for (const k of Object.keys(SECRETS)) if (k !== "SESSION_SECRET") delete process.env[k]; delete process.env.ENCORE_SUPPORT_SMS; delete process.env.ENCORE_EMAIL_FROM; process.env.SESSION_SECRET = SECRETS.SESSION_SECRET;
});

test("the goal counts real hosts, events that happened, registrants and brand accounts", async () => {
  const h = await signup("Gwen Goal", "gwen-goal@example.com");
  assert.equal((await req("POST", "/api/host/profile", { handle: "gwen-goal", name: "Gwen" }, h)).status, 200);
  assert.equal((await req("PUT", "/api/db/doc?path=events/goalpast1", { kind: "social", casual: true, name: "Past supper", date: "2020-01-05", published: true }, h)).status, 200);
  assert.equal((await req("PUT", "/api/db/doc?path=rsvps/goalr1", { eventId: "goalpast1", name: "Rae", email: "rae-goal@example.com", response: "going" }, h)).status, 200);
  assert.equal((await req("PUT", "/api/db/doc?path=rsvps/goalr2", { eventId: "goalpast1", name: "Sol", email: "sol-goal@example.com", response: "no" }, h)).status, 200);
  await signup("Bea Brand", "bea-brand@acme-goal.example", { mode: "work", company: "Acme Goal" });
  const G = (await (await req("GET", "/api/admin/launch", null, admin)).json()).goal;
  assert.ok(G.hosts >= 1); assert.ok(G.events.created >= 1); assert.ok(G.events.happened >= 1); assert.ok(G.registrants >= 1); assert.ok(G.brands >= 1);
});

test("invite code batches by role: made from the admin, single use, counted, with sign-up links; a brand's link opens the work form", async () => {
  process.env.ENCORE_INVITE_ONLY = "1";
  assert.equal((await req("POST", "/api/admin/codes", { role: "chef", n: 2 }, admin)).status, 400);
  assert.equal((await req("POST", "/api/admin/codes", { role: "host", n: 500 }, admin)).status, 400);
  const H = (await (await req("POST", "/api/admin/codes", { role: "host", n: 3, label: "December hosts" }, admin)).json()).batch;
  const B = (await (await req("POST", "/api/admin/codes", { role: "brand", n: 2, label: "December brands" }, admin)).json()).batch;
  assert.equal(H.n, 3); assert.equal(H.used, 0); assert.equal(H.role, "host"); assert.equal(B.role, "brand");
  const csv = await (await req("GET", `/api/admin/codes/${B.id}.csv`, null, admin)).text(), rows = csv.trim().split("\n");
  assert.equal(rows[0], "code,role,sign-up link,used,used by"); assert.equal(rows.length, 3); assert.match(rows[1], /\/signup\?mode=work&code=[A-Z2-9]{4}-[A-Z2-9]{4},,$/);
  const hostCsv = await (await req("GET", `/api/admin/codes/${H.id}.csv`, null, admin)).text(), code = hostCsv.split("\n")[1].split(",")[0]; assert.match(hostCsv, /mode=friends&code=/);
  // invite-only: no code, no account; the batch code works once
  assert.equal((await req("POST", "/api/signup", { name: "Nobody", email: "nobody-code@example.com", password: "long-password-1", mode: "friends" })).status, 403);
  await signup("Cora Cohort", "cora-cohort@example.com", { code });
  assert.equal((await req("POST", "/api/signup", { name: "Twice", email: "twice-code@example.com", password: "long-password-1", mode: "friends", code })).status, 403, "single use");
  const L = (await (await req("GET", "/api/admin/codes", null, admin)).json()).batches, h2 = L.find((b) => b.id === H.id); assert.equal(h2.used, 1); assert.ok(h2.lastUsedAt > 0);
  assert.match(await (await req("GET", `/api/admin/codes/${H.id}.csv`, null, admin)).text(), new RegExp(`${code},host,[^,]+,\\d{4}-\\d{2}-\\d{2},Cora Cohort`));
  // the work form keeps a brand's code (public/signup.html)
  assert.match(read("public/signup.html"), /set\(q\.get\("mode"\) === "work" \? "work" : "friends"\)/);
  // documented for the owner
  assert.match(read("docs/launch-checklist.md"), /Invite codes for the cohort/);
  delete process.env.ENCORE_INVITE_ONLY;
});

test("the status line: an admin posts it, everyone reads it, and clears it", async () => {
  assert.deepEqual(await (await req("GET", "/api/status")).json(), { incident: null });
  assert.equal((await req("POST", "/api/admin/incident", { on: true, message: "" }, admin)).status, 400);
  assert.equal((await req("POST", "/api/admin/incident", { on: true, message: "Texts are slow right now — email works." }, admin)).status, 200);
  const s = await (await req("GET", "/api/status")).json(); assert.equal(s.incident.message, "Texts are slow right now, email works.");
  assert.equal((await req("POST", "/api/admin/incident", { on: false }, admin)).status, 200); assert.deepEqual(await (await req("GET", "/api/status")).json(), { incident: null });
});

test("a server error has a ref, lands in the error log, and its page links to help with it", async () => {
  // the middleware the app ends with (server/perf.js), with the app's hook into the error log
  const { errorMiddleware } = await import("../server/perf.js"); const { noteServerError, errorLog } = await import("../server/errors.js");
  let ref = ""; const mw = errorMiddleware({ page: () => read("public/404.html"), log: () => {}, onError: (e) => { ref = e.ref; noteServerError(srv.store, e); } });
  const out = {}; const res = { headersSent: false, status(c) { out.status = c; return this; }, set() { return this; }, type() { return this; }, json(j) { out.json = j; return this; }, send(b) { out.body = b; return this; } };
  mw(new Error("kaboom for kim@example.com"), { path: "/api/x", originalUrl: "/api/x?token=1", method: "GET", accepts: () => "json" }, res, () => {});
  assert.equal(out.status, 500); assert.match(out.json.ref, /^[a-f0-9]{8}$/); assert.equal(out.json.ref, ref);
  const e = errorLog(srv.store).find((x) => x.serverRef === ref || x.ids.includes(ref)); assert.ok(e); assert.equal(e.kind, "server"); assert.ok(!JSON.stringify(e).includes("kim@example.com"));
  mw(new Error("page boom"), { path: "/x", originalUrl: "/x", method: "GET", accepts: () => "html" }, res, () => {});
  assert.match(out.body, /href="\/help\?err=[a-f0-9]{8}"/); assert.match(out.body, /Ref [a-f0-9]{8}/);
});

test("every setting the server reads is in docs/launch-checklist.md, with what it does", () => {
  const names = new Set(), walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(js|mjs|cjs)$/.test(f.name)) for (const m of fs.readFileSync(p, "utf8").matchAll(/(?:process\.env|\benv)(?:\.([A-Z][A-Z0-9_]{2,})|\[["']([A-Z][A-Z0-9_]{2,})["']\])/g)) names.add(m[1] || m[2]); } };
  walk(new URL("../server", import.meta.url).pathname);
  const doc = read("docs/launch-checklist.md"), missing = [...names].filter((n) => !new RegExp("`" + n + "`").test(doc)).sort();
  assert.ok(names.size > 100, `found ${names.size} settings`); assert.deepEqual(missing, [], "add these to docs/launch-checklist.md");
  for (const must of ["ENCORE_PUBLIC_URL", "ENCORE_TRUST_PROXY", "ENCORE_INVITE_ONLY", "ENCORE_SUPPORT_EMAIL", "ENCORE_SUPPORT_SMS", "ENCORE_SUPPORT_REPLY_HOURS", "ENCORE_ADMIN_EMAILS", "ENCORE_EMAIL_KEY", "ENCORE_EMAIL_FROM", "ENCORE_POSTHOG_KEY", "ENCORE_POSTHOG_HOST", "STRIPE_SECRET_KEY", "INSTAGRAM_APP_ID", "GIPHY_API_KEY"]) assert.match(doc, new RegExp("`" + must + "`"), must);
  assert.match(doc, /How to restore/); assert.match(doc, /\/admin\/launch/); assert.ok(!/—/.test(doc));
});

// A real browser when this machine has one: help.js isn't loaded until the tap, then opens for someone signed out
const pw = (() => { for (const p of ["playwright", "/opt/node22/lib/node_modules/playwright"]) { try { return createRequire(import.meta.url)(p); } catch {} } return null; })();
test("in a browser, signed out: Help on an invite, /g, /chats and /teams loads help.js on the tap and shows questions for who you are", { skip: !pw && "Playwright isn't installed", timeout: 120e3 }, async () => {
  let browser; try { browser = await pw.chromium.launch(); } catch { return; }
  try {
    const ctx = await browser.newContext({ ...pw.devices["iPhone 13"], baseURL: srv.base, serviceWorkers: "block" }), page = await ctx.newPage(), errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message)));
    const chips = () => page.evaluate(() => [...(document.getElementById("encoreHelp")?.shadowRoot?.querySelectorAll(".eh-chips button") || [])].map((b) => b.textContent));
    const isOpen = () => page.evaluate(() => { const p = document.getElementById("encoreHelp")?.shadowRoot?.querySelector(".eh-panel"); return !!p && !p.hidden; });
    const helpLoaded = () => page.evaluate(() => !!document.querySelector('script[src^="/help.js"]'));
    for (const [p, sel, want] of [["/e/supinv1", "footer [data-help]:visible", "Reply to an invite"], ["/teams", "[data-help]:visible", "Book a host"], ["/g#rsvp-supinv1", "", "Reply to an invite"], ["/chats", "", "Reply to an invite"]]) {
      await page.goto(p); await page.waitForLoadState("load"); await page.waitForFunction(() => window.PLHelp && window.PLReport, null, { timeout: 10e3 });
      assert.equal(await helpLoaded(), false, `${p}: help.js isn't loaded before the tap`);
      // a footer link comes once the page has drawn
      if (sel) { const l = page.locator(sel).first(); await l.waitFor({ timeout: 20e3 }); await l.click(); } else await page.evaluate(() => window.PLHelp.open());
      await page.waitForFunction(() => { const p = document.getElementById("encoreHelp")?.shadowRoot?.querySelector(".eh-panel"); return p && !p.hidden; }, null, { timeout: 10e3 });
      assert.equal(await isOpen(), true, `${p}: the sheet is open`); assert.ok((await chips()).includes(want), `${p}: ${want} (${(await chips()).join(", ")})`);
      const foot = await page.evaluate(() => { const r = document.getElementById("encoreHelp").shadowRoot; return { human: !!r.querySelector(".eh-human")?.getClientRects().length, promise: r.querySelector(".eh-promise")?.textContent, urgent: !!r.querySelector(".eh-urgent") }; });
      assert.ok(foot.human && foot.urgent, `${p}: Talk to a person and My event is today`); assert.match(foot.promise, /We reply within 24 hours, usually sooner\./);
      await page.keyboard.press("Escape");
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
