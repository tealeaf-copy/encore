// Help, the support side (owner report: "Help chatbot is very glitchy, can't close the window"):
// - the handoff carries the context instead of a transcript dumped in the message box, and the reply time is promised
// - Did this help? after an answer and How did we do? after a solved conversation are stored and counted for the team
// - every way to close the sheet works (X, Esc, the backdrop, swipe down), in a real browser when one is installed
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";

let srv;
const J = { "content-type": "application/json" };
const req = (method, path, body, cookie) => fetch(srv.base + path, { method, headers: { ...J, ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
const host = async (name, email) => { const r = await req("POST", "/api/signup", { name, email, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200); return cookieOf(r); };
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "help-support-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; process.env.ENCORE_ADMIN_EMAILS = "lead@pottery.example"; delete process.env.ENCORE_SUPPORT_REPLY_HOURS; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_ADMIN_EMAILS", "ENCORE_SUPPORT_REPLY_HOURS"]) delete process.env[k]; await srv.close(); });

test("handoff: the chat goes along as context, the message can be empty, the device is in words, and the reply time comes from the env", async () => {
  const c = await host("Hana Handoff", "hana-handoff@example.com");
  assert.deepEqual(await (await req("GET", "/api/help/info")).json(), { replyHours: 24, replyWithin: "within a day", expect: "A person replies within a day, here and by email." });
  process.env.ENCORE_SUPPORT_REPLY_HOURS = "4"; assert.equal((await (await req("GET", "/api/help/info")).json()).replyWithin, "within 4 hours");
  const transcript = [{ role: "host", text: "How do I share my invite?" }, { role: "potto", text: "Tap Copy invite.", section: "Sharing your invite", rated: "down" }];
  const r = await req("POST", "/api/help/ticket", { message: "", page: "/?app=1#studio", browser: `${IPHONE} · 390x664`, transcript }, c);
  assert.equal(r.status, 200); const j = await r.json();
  assert.equal(j.expect, "A person replies within 4 hours, here and by email."); assert.equal(j.ticket.status, "open", "the host's own view comes back to show in the chat");
  const t = srv.store.get("system/support-" + j.id).data;
  assert.equal(t.message, "How do I share my invite?", "no message: the last question stands in, nobody types it twice");
  assert.doesNotMatch(t.message, /Potto:|Me:/, "never a transcript dumped in the message");
  assert.equal(t.context.device, "iPhone · Safari 17.4"); assert.equal(t.transcript.length, 2); assert.equal(t.transcript[1].section, "Sharing your invite"); assert.equal(t.transcript[1].rated, "down");
  // without a chat a message is still needed
  assert.equal((await req("POST", "/api/help/ticket", { message: "", page: "/" }, c)).status, 400);
  // the admin inbox shows the context: the chat open, the answer's section and rating, the device
  const page = read("server/help.js"); assert.match(page, /d\.open=true; d\.append\(el\("summary",null,"Chat with Potto before this/); assert.match(page, /add\("Device",x\.device\)/); assert.match(page, /" · from "\+m\.section/);
  // the widget never prefills the message box with the chat
  const w = read("public/help.js"); assert.doesNotMatch(w, /Here's what I asked Potto/); assert.match(w, /We'll include/); assert.match(w, /Your chat with Potto \(/);
});

test("CSAT: Did this help? is stored per answer, How did we do? only once solved, and the team sees both in the metrics", async () => {
  const c = await host("Cleo Csat", "cleo-csat@example.com"), lead = await host("Lead", "lead@pottery.example");
  assert.equal((await req("POST", "/api/help/rate", { value: "up", section: "Sharing your invite", question: "How do I share my invite?", page: "/" })).status, 401, "signed out, away from onboarding");
  assert.equal((await req("POST", "/api/help/rate", { value: "meh", page: "/" }, c)).status, 400);
  for (const [value, section] of [["up", "Sharing your invite"], ["up", "How guests pay"], ["down", "Cancelling an event"]]) assert.equal((await req("POST", "/api/help/rate", { value, section, question: "q", page: "/" }, c)).status, 200);
  const rates = srv.store.listPrefix("system", "helprate-").map((d) => d.data); assert.equal(rates.length, 3); assert.ok(rates.every((r) => r.kind === "helprate" && r.at));
  // a question Potto can't answer is kept, so the guide can grow
  await req("POST", "/api/help/ask", { message: "can I host on the moon", page: "/" }, c);
  assert.ok(srv.store.listPrefix("system", "helpgap-").some((d) => d.data.q === "can I host on the moon"));
  // a conversation: no rating until it's solved
  const tk = await (await req("POST", "/api/help/ticket", { message: "My invite won't copy", page: "/" }, c)).json();
  assert.equal((await req("POST", `/api/help/tickets/${tk.id}/rate`, { value: "up" }, c)).status, 400, "not solved yet");
  await req("POST", `/api/support/tickets/${tk.id}`, { reply: "Fixed it on our side.", status: "solved" }, lead);
  const other = await host("Not Mine", "not-mine@example.com");
  assert.equal((await req("POST", `/api/help/tickets/${tk.id}/rate`, { value: "up" }, other)).status, 404, "only the host's own");
  const rr = await req("POST", `/api/help/tickets/${tk.id}/rate`, { value: "up" }, c); assert.equal(rr.status, 200); assert.equal((await rr.json()).ticket.csat, "up");
  assert.equal(srv.store.get("system/support-" + tk.id).data.csat.value, "up");
  // the numbers, for admins only
  assert.equal((await req("GET", "/api/support/metrics", null, c)).status, 404);
  const m = await (await req("GET", "/api/support/metrics", null, lead)).json();
  assert.equal(m.answers.rated, 3); assert.equal(m.answers.helpful, 67); assert.deepEqual(m.answers.worst.map((w) => w.section), ["Cancelling an event"]);
  assert.equal(m.tickets.csatRated, 1); assert.equal(m.tickets.csat, 100); assert.ok(m.tickets.medianFirstReplyHours >= 0); assert.equal(m.tickets.promiseHours, 24);
  assert.ok(m.gaps.recent.some((g) => g.q === "can I host on the moon"));
  assert.match(read("server/help.js"), /fetch\("\/api\/support\/metrics"/, "the inbox page shows them");
});

test("close: each X is bound by its own selector (the old bug), and the sheet follows the mobile sheet rules", () => {
  const w = read("public/help.js");
  assert.doesNotMatch(w, /\$\("\.eh-x"\)\.onclick/, "a bare .eh-x found the nudge's X first, so the sheet's X never closed it");
  assert.match(w, /panel\(\)\.querySelector\("\.eh-head \.eh-x"\)\.addEventListener\("click"/);
  assert.match(w, /scrim\(\)\.addEventListener\("click", \(\) => close\(\)\)/, "tapping the backdrop closes");
  assert.match(w, /e\.key === "Escape"\) \{ e\.preventDefault\(\); e\.stopImmediatePropagation\(\); close\(\)/, "Esc closes, before the page's own handlers");
  assert.match(w, /swipe\(\$\("\.eh-grab"\)\); swipe\(\$\("\.eh-head"\)\)/, "swipe down on the handle or header");
  assert.match(w, /\.eh-x\{[^}]*width:44px;height:44px/, "a 44px X");
  assert.match(w, /height:min\(85dvh,/, "at most 85dvh on a phone"); assert.match(w, /env\(safe-area-inset-bottom/); assert.match(w, /overscroll-behavior:contain/);
  assert.match(w, /el\.inert = true/, "the page behind is inert"); assert.match(w, /b\.style\.position = "fixed"; b\.style\.top = -y/, "and pinned, so iOS doesn't scroll it");
  assert.match(w, /e\.key === "Tab"/, "focus stays in the sheet"); assert.match(w, /back\.focus\(/, "and goes back on close");
  assert.match(w, /aria-modal="true"/); assert.doesNotMatch(w, /4px 4px 0 #1F1A17/, "no sticker shadow (UI tokens)"); assert.ok(!/—/.test(w));
  // the app's one-tap actions exist, and the Come with me loader is still the last script block
  const app = read("index.html"); assert.match(app, /window\.__helpDo=\(\(\)=>\{/);
  const blocks = [...app.matchAll(/<script>([\s\S]*?)<\/script>/g)]; assert.match(blocks.at(-1)[1], /Come with me\?/);
});

// A real browser when this machine has one (Playwright is installed globally here; elsewhere this test skips).
const pw = (() => { for (const p of ["playwright", "/opt/node22/lib/node_modules/playwright"]) { try { return createRequire(import.meta.url)(p); } catch {} } return null; })();
test("close, in a browser on an iPhone 13: X, Esc, the backdrop and swipe down; focus goes back and the page isn't scrolled", { skip: !pw && "Playwright isn't installed", timeout: 90e3 }, async () => {
  let browser; try { browser = await pw.chromium.launch(); } catch (e) { return; } // no browser binary: nothing to drive
  try {
    const ctx = await browser.newContext({ ...pw.devices["iPhone 13"], baseURL: srv.base }), page = await ctx.newPage();
    await page.goto("/login");
    assert.equal(await page.evaluate(async () => (await fetch("/api/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Ivy Phone", email: "ivy-phone@example.com", password: "long-password-1", mode: "friends" }) })).status), 200);
    await page.goto("/plans"); await page.waitForFunction(() => window.EncoreHelp?.open && document.querySelector(".es-tabs [data-me]"), null, { timeout: 15e3 });
    const S = (src) => page.evaluate((src) => new Function("root", src)(document.getElementById("encoreHelp").shadowRoot), src);
    const isOpen = () => S(`return !root.querySelector(".eh-panel").hidden`);
    // UX loop: on a phone with the tab bar, help lives in the Me sheet (no button floating over the page). Its Help row
    // opens Ask Potto (public/potto.js), the one entry for questions and help; the help panel opens from there.
    await page.waitForFunction(() => window.PLPotto, null, { timeout: 15e3 });
    await page.locator(".es-tabs [data-me]").tap(); await page.locator("#plMe .plme-help").tap(); await page.waitForSelector("#ptSheet"); await page.keyboard.press("Escape"); await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => !!document.getElementById("ptSheet")), false, "Esc closes Potto");
    const openIt = async () => { await page.evaluate(() => { document.querySelector(".es-tabs [data-me]").focus(); window.EncoreHelp.open(); }); await page.waitForTimeout(300); assert.equal(await isOpen(), true); };
    await openIt();
    const g = await S(`const p=root.querySelector(".eh-panel").getBoundingClientRect(), x=root.querySelector(".eh-head .eh-x").getBoundingClientRect(); return { h:p.height, bottom:p.bottom, vh:innerHeight, xw:x.width, xh:x.height }`);
    assert.ok(g.xw >= 44 && g.xh >= 44, "X is 44px"); assert.ok(g.h <= g.vh * 0.851, "85dvh at most"); assert.ok(Math.abs(g.bottom - g.vh) < 2, "on the bottom");
    await page.locator("#encoreHelp .eh-head .eh-x").tap(); await page.waitForTimeout(200); assert.equal(await isOpen(), false, "the X closes it");
    assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute("data-me")), true, "focus back on the Me tab");
    await openIt(); await page.keyboard.press("Escape"); await page.waitForTimeout(150); assert.equal(await isOpen(), false, "Esc");
    await openIt(); await page.touchscreen.tap(20, 20); await page.waitForTimeout(200); assert.equal(await isOpen(), false, "the backdrop");
    await openIt(); const r = await S(`const r=root.querySelector(".eh-grab").getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}`), cdp = await ctx.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: r.x, y: r.y, id: 1 }] });
    for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: r.x, y: r.y + i * 30, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await page.waitForTimeout(450); assert.equal(await isOpen(), false, "swipe down");
    assert.equal(await page.evaluate(() => [...document.body.children].filter((e) => e.inert).length), 0, "nothing left inert");
  } finally { await browser.close(); }
});

test("deflection: asks, answers and handoffs are counted for the team; a signed-in host gets a receipt with a reference", async () => {
  const { fakeOutbox } = await import("../server/email.js");
  const c = await host("Rae Receipt", "rae-receipt@example.com"), lead = cookieOf(await req("POST", "/api/login", { email: "lead@pottery.example", password: "long-password-1" }));
  const before = (await (await req("GET", "/api/support/metrics", null, lead)).json()).asks;
  for (const q of ["How do I share my invite?", "How do guests pay?", "what's the weather on mars"]) await req("POST", "/api/help/ask", { message: q, page: "/" }, c);
  process.env.ENCORE_FAKE_EMAIL = "1"; const n0 = fakeOutbox.length;
  const tk = await (await req("POST", "/api/help/ticket", { message: "Need a hand with my pay link", page: "/" }, c)).json();
  assert.match(tk.ref, /^[0-9A-F]{6}$/); const receipt = fakeOutbox.slice(n0).find((m) => m.to === "rae-receipt@example.com" || (Array.isArray(m.to) && m.to.includes("rae-receipt@example.com")));
  assert.ok(receipt, "a receipt"); assert.match(receipt.subject, new RegExp(`ref ${tk.ref}`)); assert.match(receipt.text, /A person replies within a day/);
  // someone signed out typed an email into a form: no mail goes to it (the form can't be used to send mail to strangers)
  const n1 = fakeOutbox.length; await req("POST", "/api/help/ticket", { message: "Where is my invite?", email: "someone-else@example.com", page: "/plans" });
  assert.ok(!fakeOutbox.slice(n1).some((m) => JSON.stringify(m.to).includes("someone-else@example.com")));
  delete process.env.ENCORE_FAKE_EMAIL;
  const m = (await (await req("GET", "/api/support/metrics", null, lead)).json()).asks;
  assert.equal(m.total - before.total, 3); assert.equal(m.answered - before.answered, 2); assert.equal(m.unsure - before.unsure, 1); assert.equal(m.handoffs - before.handoffs, 2); assert.ok(m.answeredRate > 0);
});

test("a guest on Plans who isn't signed in can ask; someone upset gets a person right away; the team gets a one-line summary", async () => {
  const r = await req("POST", "/api/help/ask", { message: "I can't find my invite", page: "/plans" }); assert.equal(r.status, 200);
  const j = await r.json(); assert.equal(j.section, "Finding an invite you got"); assert.ok(j.actions.some((a) => a.href === "/plans"));
  assert.doesNotMatch(srv.app.locals.help.lastPrompt, /"handle"|"event"/, "no account context signed out");
  assert.equal((await req("POST", "/api/help/ask", { message: "I can't find my invite", page: "/discover" })).status, 401, "only Plans and the onboarding pages");
  assert.match(read("public/shell.js"), /location\.pathname === "\/plans"\)/, "shell.js loads help on Plans for everyone");
  const c = await host("Uma Upset", "uma-upset@example.com");
  const up = await (await req("POST", "/api/help/ask", { message: "my invite link is broken and guests can't open it", page: "/" }, c)).json();
  assert.equal(up.suggestHuman, true); assert.ok(up.actions.some((a) => a.href === "#person"), "a person, offered in the answer"); assert.match(up.answer, /^Sorry it's been a pain\./);
  const tk = await (await req("POST", "/api/help/ticket", { message: "", page: "/", browser: IPHONE, transcript: [{ role: "host", text: "How do I share my invite?" }, { role: "potto", text: "Tap Copy invite.", section: "Sharing your invite", rated: "down" }] }, c)).json();
  assert.equal(srv.store.get("system/support-" + tk.id).data.summary, `Asked Potto "How do I share my invite?". Potto answered from "Sharing your invite", rated not helpful. iPhone · Safari 17.4.`);
});
