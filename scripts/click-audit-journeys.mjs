// The key journeys for scripts/click-audit.mjs, end to end in a phone-sized browser, with assertions. Each one is a
// person's real job: a new visitor planning a dinner, a guest replying, a host running the night, a drop seller, a brand
// booking a host, Find people, the Library and sign-in. A rapid double tap on a button that creates something must
// create one record, never two. Every step also fails on a script error, a console error or a failed request.
import { scopeStore, getDbUser } from "../server/workspaces.js";
import { fakeOutbox } from "../server/email.js";

const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function journeySteps(H) {
  const { journey, must, vis, noErrors, journeyCtx, api, base, S, B, LT, store, dismissAuto } = H;
  const rsvps = (ws, eventId) => scopeStore(store, ws).list("rsvps").map((d) => ({ id: d.id, ...d.data })).filter((r) => r.eventId === eventId);
  const events = (ws) => scopeStore(store, ws).list("events").map((d) => ({ id: d.id, ...d.data }));
  const bbreqs = () => store.list("system").filter((d) => String(d.id).startsWith("bbreq-")).map((d) => d.data);
  const otpFor = async (email) => { for (let i = 0; i < 40; i++) { const m = [...fakeOutbox].reverse().find((x) => String(x.to).toLowerCase() === email && /\b\d{6}\b/.test(x.text || x.subject || "")); if (m) return /\b(\d{6})\b/.exec(m.text || m.subject)[1]; await wait(150); } throw new Error("no sign-in code email for " + email); };
  // a double tap, the way a thumb does it: two taps 40ms apart
  const doubleTap = async (page, loc) => { await loc.evaluate((n) => n.scrollIntoView({ block: "center" })); await wait(250); const b = await loc.boundingBox(); must(b, "the button isn't on screen"); const x = b.x + b.width / 2, y = b.y + b.height / 2; await page.touchscreen.tap(x, y); await wait(40); await page.touchscreen.tap(x, y).catch(() => {}); };

  // 1. a new visitor plans a dinner at /start, signs up with an invite code, publishes and shares
  await journey("1. plan a dinner at /start, sign up with an invite code, publish, share", async (step) => {
    process.env.ENCORE_INVITE_ONLY = "1"; process.env.ENCORE_FOUNDER_CODES = "AUDITCODE";
    const { ctx, page, sink } = await journeyCtx("out");
    try {
      await step("open /start", async () => { await page.goto(base + "/start", { waitUntil: "load" }); await page.waitForLoadState("networkidle").catch(() => {}); must(await vis(page, "#f [name=title], #f input").count(), "no plan form"); });
      await step("fill in the dinner", async () => { await page.locator("#f [name=title]").fill("Audit dinner for four"); await page.locator("#f [name=place]").fill("My place, Greenpoint"); await vis(page, "#more").click(); await page.waitForTimeout(500); must((await page.locator("#seatsOut").textContent()).trim() === "5", "the seat count didn't go up"); });
      await step("save asks to make an account", async () => { await vis(page, "#save").click(); await page.waitForSelector(".sheet[role=dialog]", { timeout: 4000 }); await page.keyboard.press("Escape"); await page.waitForTimeout(300); const still = await page.locator(".sheet[role=dialog]").count(); if (still) { await vis(page, "#spNo").click(); throw new Error("Esc doesn't close the save sheet on /start"); } });
      await step("Create my account carries the plan to sign-up", async () => { await vis(page, "#save").click(); await page.waitForSelector(".sheet[role=dialog]"); await Promise.all([page.waitForURL(/\/signup/), vis(page, ".sheet .btn.pri").click()]); must(/next=/.test(page.url()), "the sign-up link has no next"); });
      const email = "new.visitor.audit@example.com";
      // main's sign-in: one "Email or phone number" field, the 6-digit code, then the invite code and the name are asked after
      await step("join with an email code", async () => { await page.waitForSelector("#idIn", { state: "visible", timeout: 6000 }); await page.locator("#idIn").fill(email); await vis(page, "#idGo").click(); await page.waitForSelector("#otpIn", { state: "visible", timeout: 6000 });
        const code = await otpFor(email); await page.locator("#otpIn").fill(code); await page.waitForTimeout(300); const go = vis(page, "#otpGo"); if (await go.count() && await page.locator("#otpIn").isVisible()) await go.click().catch(() => {}); });
      await step("enter the invite code, asked after the code", async () => { await page.waitForSelector("#codeIn", { state: "visible", timeout: 6000 }); await page.locator("#codeIn").fill("AUDITCODE"); await vis(page, "#codeGo").click(); await page.waitForSelector("#nameIn", { state: "visible", timeout: 6000 }).catch(() => {}); must(await page.locator("#nameIn").isVisible(), "the code was refused: " + (await page.locator("#codeErr").textContent())); });
      await step("say your name", async () => { await page.locator("#nameIn").fill("Vera Visitor"); await Promise.all([page.waitForURL((u) => !/\/signup|\/login/.test(u.pathname), { timeout: 10000 }), vis(page, "#nameGo").click()]); });
      await step("back on /start the dinner is saved and out", async () => { await page.waitForURL(/\/start/, { timeout: 8000 }).catch(() => {}); must(/\/start/.test(page.url()), "after sign-up the visitor landed on " + page.url().slice(base.length) + ", not back on their dinner"); await page.waitForSelector("#done:not([hidden])", { timeout: 8000 }); must(/\/e\//.test(await page.locator("#link").inputValue()), "no invite link"); });
      await step("exactly one event, published", async () => { const ws = getDbUser(email)?.ws; const L = ws ? events(ws).filter((e) => /Audit dinner/.test(e.name || "")) : []; must(L.length === 1, `${L.length} events made`); must(L[0].published, "not published"); });
      await step("share: copy the link", async () => { await vis(page, "#copy").click(); await page.waitForTimeout(300); must(/Copied/.test(await page.locator("#copy").textContent()), "Copy didn't say Copied"); const sh = page.locator("#share"); if (await sh.isVisible()) { await sh.click(); await page.waitForTimeout(200); must(await page.evaluate(() => window.__audit.shared > 0), "Share didn't open the share sheet"); } });
      await noErrors(sink, "journey 1");
    } finally { process.env.ENCORE_INVITE_ONLY = "0"; delete process.env.ENCORE_FOUNDER_CODES; await ctx.close(); }
  });

  // 2. a guest gets the /e link, replies, adds to calendar, opens the chat, changes the reply in the Plans peek, invites a friend
  await journey("2. guest: reply on /e, calendar, group chat, change in the Plans peek, invite a friend", async (step) => {
    const { ctx, page, sink } = await journeyCtx("newguest"), ws = S.host.ws;
    try {
      await step("open the invite", async () => { await page.goto(base + `/e/${S.open}`, { waitUntil: "load" }); await page.waitForSelector("#f", { timeout: 6000 }); });
      await step("reply I'm in with a double tap: one reply", async () => { const n0 = rsvps(ws, S.open).filter((r) => r.email === S.newGuest.email).length; await page.locator("#nm").fill("Nia New"); const ct = page.locator("#ct"); if (!(await ct.inputValue())) await ct.fill(S.newGuest.email);
        await page.locator('input[name="r"][value="going"]').check({ force: true }); await page.locator("#send").scrollIntoViewIfNeeded(); await doubleTap(page, page.locator("#send")); await page.waitForSelector("#tk", { state: "attached", timeout: 8000 }).catch(async () => { throw new Error("no ticket after replying: " + ((await page.locator("#er").textContent().catch(() => "")) || (await page.locator("body").innerText()).slice(0, 200).replace(/\s+/g, " "))); }); await page.waitForTimeout(800);
        const n1 = rsvps(ws, S.open).filter((r) => r.email === S.newGuest.email).length; must(n1 - n0 === 1, `${n1 - n0} replies made by a double tap`); must(/You're in/.test(await page.locator("#tk h2").textContent()), "no You're in"); });
      await step("add to calendar", async () => { /* a sheet now (public/slots.js): Apple, Google, Outlook or the file; Esc closes it */ await vis(page, "#cal").click(); await page.waitForSelector(".sl-cal", { timeout: 4000 }); const h = await page.locator(".sl-calopt").nth(1).getAttribute("href"); must(/\/cal\/google/.test(h || ""), "Add to calendar has no Google option"); await page.keyboard.press("Escape"); await page.waitForTimeout(200); must(!(await page.locator(".sl-cal").count()), "Esc didn't close the calendar sheet"); });
      await step("open the group chat", async () => { const ch = vis(page, "#tk a.btn.main"); await ch.evaluate((n) => n.scrollIntoView({ block: "center" })); await page.waitForTimeout(600); await Promise.all([page.waitForURL(/\/chats\//, { timeout: 8000 }), ch.click()]); await page.waitForLoadState("networkidle").catch(() => {}); must(await page.locator("textarea, [contenteditable], input[type=text]").filter({ visible: true }).count(), "the chat has no box to write in"); });
      await step("change the reply in the Plans peek", async () => { await page.goto(base + "/plans", { waitUntil: "load" }); await page.waitForLoadState("networkidle").catch(() => {}); const row = vis(page, `[data-peek="${S.open}"]`); must(await row.count(), "Dumpling night isn't on Plans"); await row.click();
        await page.waitForSelector('.pk-seg [data-pk-set="maybe"]', { timeout: 6000 }); await vis(page, '.pk-seg [data-pk-set="maybe"]').click(); await page.waitForTimeout(900); const r = rsvps(ws, S.open).find((x) => x.email === S.newGuest.email); must(r?.response === "maybe", "the reply is still " + r?.response);
        await vis(page, '.pk-seg [data-pk-set="going"]').click(); await page.waitForTimeout(900); must(rsvps(ws, S.open).find((x) => x.email === S.newGuest.email)?.response === "going", "back to I'm in didn't stick"); });
      await step("invite a friend from the peek", async () => { const inv = vis(page, "[data-pk-invite], [data-pk-share]"); must(await inv.count(), "no Invite friends in the peek"); await inv.click(); await page.waitForTimeout(900); const sheets = await page.evaluate(() => window.__overlays().length); must(sheets >= 1 || (await page.evaluate(() => window.__audit.shared)) > 0, "Invite friends opened nothing"); });
      await noErrors(sink, "journey 2");
    } finally { await ctx.close(); }
  });

  // 3. a host lets someone in from the Inbox, checks people in and sends the thank-you recap
  await journey("3. host: let in from the Inbox, check in, send the thank-you", async (step) => {
    const { ctx, page, sink } = await journeyCtx("host"), ws = S.host.ws;
    try {
      await step("someone asks to join", async () => { const doc = await (await fetch(base + "/api/db/doc?path=events/" + S.ask, { headers: { "x-encore-guest": "1" } })).json(); const r = await fetch(base + "/api/db/collection?path=rsvps", { method: "POST", headers: { "content-type": "application/json", "x-encore-guest": "1", "x-encore-key": "kj3askkim01", "x-encore-workspace": doc.workspace }, body: JSON.stringify({ eventId: S.ask, response: "requested", name: "Kim Ask", email: "kim.ask.audit@example.com", code: "CKIMAS", createdAt: Date.now() }) }); must(r.ok, "the ask didn't go in"); });
      await step("Let in from the Inbox", async () => { await page.goto(base + "/inbox", { waitUntil: "load" }); await page.waitForLoadState("networkidle").catch(() => {}); const row = page.locator("li").filter({ hasText: "Kim" }).filter({ has: page.locator('[data-d="in"]') }).first(); must(await row.count(), "no Let in for Kim on the Inbox"); await row.locator('[data-d="in"]').click(); await page.waitForTimeout(1000); const r = rsvps(ws, S.ask).find((x) => x.email === "kim.ask.audit@example.com"); must(r?.response === "going", "Kim is still " + r?.response); });
      await step("a guest replies to tonight's supper", async () => { const doc = await (await fetch(base + "/api/db/doc?path=events/" + S.today, { headers: { "x-encore-guest": "1" } })).json(); await fetch(base + "/api/db/collection?path=rsvps", { method: "POST", headers: { "content-type": "application/json", "x-encore-guest": "1", "x-encore-key": "kj3tonight01", "x-encore-workspace": doc.workspace }, body: JSON.stringify({ eventId: S.today, response: "going", name: "Rae Tonight", email: "rae.audit@example.com", code: "CNIGHT", createdAt: Date.now() }) }); });
      await step("open tonight's event and its check-in", async () => { await page.goto(base + `/?app=1&open=${S.today}#studio`, { waitUntil: "load" }); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(1200); const tab = page.getByRole("tab", { name: /^Invite/ }).or(page.locator("button,a").filter({ hasText: /^Invite$/ })).filter({ visible: true }).first(); if (await tab.count()) await tab.click(); await page.waitForSelector("[data-here]", { timeout: 8000 }); });
      await step("check Rae in (a double tap counts once)", async () => { const b = vis(page, "[data-here]"); await doubleTap(page, b); await page.waitForTimeout(1200); const r = rsvps(ws, S.today).find((x) => x.email === "rae.audit@example.com"); must(r && r.checkedInAt, "Rae isn't checked in after a double tap: " + JSON.stringify(r).slice(0, 200)); });
      await step("send the thank-you", async () => { const t = vis(page, "[data-thanks]"); must(await t.count(), "no Send thank-you"); const n0 = fakeOutbox.length; await t.click(); await page.waitForTimeout(1500); must(/Thank-you sent/.test(await page.locator("body").innerText()), "no Thank-you sent line"); must(fakeOutbox.length > n0, "no thank-you email went out"); });
      await noErrors(sink, "journey 3");
    } finally { await ctx.close(); }
  });

  // 4. a drop seller creates a drop, takes a pre-order and sees the pickup in Plans
  await journey("4. seller: create a drop, take a pre-order, the pickup shows in Plans", async (step) => {
    const { ctx, page, sink } = await journeyCtx("seller"), ws = S.seller.ws; let id = "";
    try {
      await step("+ then Drop opens the drop setup", async () => { await page.goto(base + "/feed", { waitUntil: "load" }); await page.waitForLoadState("networkidle").catch(() => {}); await dismissAuto(page); await vis(page, '[aria-label="Create"]').click(); await page.waitForTimeout(500); const d = page.locator('[data-k="drop"], button, a').filter({ hasText: /^\s*(A )?drop\b|Sell|Order ahead/i }).filter({ visible: true }).first(); must(await d.count(), "no Drop in the + sheet"); await d.click(); await page.waitForSelector("#dpZone, [data-n]", { timeout: 8000 }); });
      // the setup is four steps (public/drop.js): photos (Next with or without), what's for sale, pickup, last details
      await step("fill the drop in four steps", async () => { if (await page.locator("#dpZone").count()) { await vis(page, "#dpNext").click(); await page.waitForSelector("[data-n]", { timeout: 5000 }); }
        await page.locator("[data-n]").first().fill("Coconut buns"); await page.locator("[data-p]").first().fill("6"); await vis(page, "#dpNext").click(); await page.waitForTimeout(400);
        if (await page.locator("#dpArea").count()) { await page.locator("#dpArea").fill("Sunset Park"); await page.locator("#dpAddr").fill("5 Audit St"); } await vis(page, "#dpNext").click(); await page.waitForTimeout(400);
        if (await page.locator("#dpTitle").count()) await page.locator("#dpTitle").fill("Buns on Sunday");
        const n0 = events(ws).filter((e) => e.drop).length; await doubleTap(page, vis(page, "#dpNext")); await page.waitForTimeout(1500); const L = events(ws).filter((e) => e.drop); must(L.length - n0 === 1, `${L.length - n0} drops made by a double tap`); id = L.find((e) => /Buns on Sunday/.test(e.name || e.pubTitle || ""))?.id || ""; must(id, "the new drop isn't there"); });
      const g = await journeyCtx("guest");
      try {
        await step("a guest pre-orders on the drop page", async () => { await g.page.goto(base + `/e/${id}`, { waitUntil: "load" }); await g.page.waitForSelector("#dgF, #f", { state: "attached", timeout: 6000 }) /* a drop is its order page (public/droppage.js) */.catch(async () => { throw new Error(`no order form on /e/${id}: ` + (await g.page.locator("body").innerText()).slice(0, 300).replace(/\s+/g, " ")); }); await vis(g.page, '[aria-label^="One more"]').click();
          await g.page.locator("#oNm").fill("Sam Ortiz"); const ct = g.page.locator("#oCt"); if (!(await ct.inputValue())) await ct.fill(S.guest.email); await doubleTap(g.page, vis(g.page, "#oGo")); await g.page.waitForSelector("#tk", { state: "attached", timeout: 8000 }).catch(async () => { throw new Error("no order confirmation: " + (await g.page.locator("#oEr").textContent().catch(() => "?"))); }); await g.page.waitForTimeout(600); must(rsvps(ws, id).length === 1, `${rsvps(ws, id).length} orders from a double tap`); });
        await step("the pickup shows in the guest's Plans", async () => { await g.page.goto(base + "/plans", { waitUntil: "load" }); await g.page.waitForLoadState("networkidle").catch(() => {}); must(await g.page.locator(`[data-peek="${id}"], a[href*="${id}"]`).count(), "the drop isn't on Plans"); });
        await noErrors(g.sink, "journey 4 guest");
      } finally { await g.ctx.close(); }
      await step("the seller's Plans shows the drop", async () => { await page.goto(base + "/plans", { waitUntil: "load" }); await page.waitForLoadState("networkidle").catch(() => {}); must(await page.locator(`[data-peek="${id}"], a[href*="${id}"]`).count(), "the seller's drop isn't on Plans"); });
      await noErrors(sink, "journey 4");
    } finally { await ctx.close(); }
  });

  // 5. a brand quick-books a host, agrees the brief, invites guests, runs check-in, views the report and books again
  await journey("5. brand: quick book, brief, invite, check-in, report, book again", async (step) => {
    const { ctx, page, sink } = await journeyCtx("brand"); let rid = "";
    try {
      await step("quick book shows hosts", async () => { await page.goto(base + "/teams/discover", { waitUntil: "load" }); await page.waitForSelector("#tpQf", { timeout: 8000 }); await page.locator('#tpQf [name=date]').fill(day(30)); await page.locator('#tpQf [name=people]').fill("12"); await vis(page, "#tpGo").click(); await page.waitForSelector("[data-book]", { timeout: 8000 }); });
      await step("Book this, send the request (a double tap sends one)", async () => { await vis(page, "[data-book]").click(); await page.waitForSelector("#tpBf", { timeout: 5000 }); const n0 = bbreqs().length; const sub = vis(page, "#tpBf [type=submit]"); await sub.scrollIntoViewIfNeeded(); await doubleTap(page, sub); await page.waitForURL(/\/teams\/bookings\//, { timeout: 8000 }); await page.waitForTimeout(600); must(bbreqs().length - n0 === 1, `${bbreqs().length - n0} requests from a double tap`); rid = /\/teams\/bookings\/([^?/#]+)/.exec(page.url())[1]; });
      const R = () => store.get("system/bbreq-" + rid)?.data;
      const host = B.hosts.find((h) => h.handle === R()?.handle);
      await step("the host accepts and agrees the brief, the deposit is paid", async () => { must(host, "no host for the request"); let r = await api("POST", `/api/bb/requests/${rid}/pay`, {}, B.owner.c); r = await api("POST", `/api/bb/host/requests/${rid}`, { action: "accept" }, host.c); must(r.status === 200, "accept: " + JSON.stringify(r.j).slice(0, 120)); r = await api("POST", `/api/bb/host/events/${rid}/brief`, {}, host.c); must(r.status === 200, "host brief: " + JSON.stringify(r.j).slice(0, 120)); });
      await step("the booking page says the brief is agreed", async () => { await page.goto(base + `/teams/bookings/${rid}`, { waitUntil: "load" }); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(800); must(/agreed|both agreed|Agreed/i.test(await page.locator("body").innerText()), "no agreed brief on the booking page"); });
      const campOf = () => { const r = R() || {}; return r.campaign || r.campaignId || store.list("system").find((d) => String(d.id).startsWith("camp-") && JSON.stringify(d.data.bookings || []).includes(rid))?.data?.id || ""; };
      await step("invite a guest on the campaign (a double tap adds one)", async () => { const c = campOf(); must(c, "the booking has no campaign to invite from: " + JSON.stringify(Object.keys(R() || {})));
        await page.goto(base + `/teams/campaigns/${c}/invite`, { waitUntil: "load" }); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(600); await vis(page, "#addG").click(); await page.waitForSelector("#gf", { timeout: 5000 });
        await page.locator("#gf [name=name]").fill("Ines Audit"); await page.locator("#gf [name=email]").fill("ines.audit@example.com"); await doubleTap(page, vis(page, "#gf [type=submit], #gf button:not([type=button])")); await page.waitForTimeout(1200);
        const G = (store.get("system/camp-" + c)?.data?.guests || []).filter((g) => g.email === "ines.audit@example.com"); must(G.length === 1, `${G.length} guests added by a double tap`); });
      await step("run check-in on the campaign (a double tap checks in once)", async () => { const C1 = B.campaigns.C1; { /* the taps before the journeys may have checked everyone in: start the door fresh */ const k = "system/camp-" + C1, D = store.get(k).data; D.guests.forEach((g) => { if (g.status === "yes") g.checkedIn = false; }); store.set(k, D); } await page.goto(base + `/teams/campaigns/${C1}/run`, { waitUntil: "load" }); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(600);
        let b = vis(page, '[data-in][aria-pressed="false"]'); for (const r of await page.locator("[data-run]").all()) { if (await b.count()) break; await r.click().catch(() => {}); await page.waitForTimeout(500); b = vis(page, '[data-in][aria-pressed="false"]'); } /* the event with people to check in */ must(await b.count(), "no one to check in on Run"); const gid = await b.getAttribute("data-in"); await doubleTap(page, page.locator(`[data-in="${gid}"]`).first()); await page.waitForTimeout(1500);
        const g = (store.get("system/camp-" + C1)?.data?.guests || []).find((x) => x.id === gid); must(g?.checkedIn, "the guest isn't checked in after a double tap"); });
      await step("the report opens", async () => { await page.goto(base + `/teams/campaigns/${B.campaigns.C1}/report`, { waitUntil: "load" }); await page.waitForLoadState("networkidle").catch(() => {}); must((await page.locator("body").innerText()).length > 400, "the report is empty"); });
      await step("book again starts from the last one", async () => { await page.goto(base + `/teams/discover?again=${B.bookings.b1}`, { waitUntil: "load" }); await page.waitForSelector("[data-book]", { timeout: 8000 }); must(/again/i.test(await page.locator("#tpQbT").textContent()), "the quick book doesn't say again"); });
      await noErrors(sink, "journey 5");
    } finally { await ctx.close(); }
  });

  // 6. Find people: follow someone, and join a fan club
  await journey("6. Find people: follow, join a fan club", async (step) => {
    const { ctx, page, sink } = await journeyCtx("newguest");
    try {
      await step("follow a host on Find people", async () => { await page.goto(base + "/people", { waitUntil: "load" }); await page.waitForLoadState("networkidle").catch(() => {}); const t = page.locator("button").filter({ hasText: /^Hosts/ }).filter({ visible: true }).first(); if (await t.count()) await t.click(); await page.waitForTimeout(800); const f0 = vis(page, "[data-f][aria-pressed=false]"); must(await f0.count(), "nobody to follow"); const fid = await f0.getAttribute("data-f"), f = page.locator(`[data-f="${fid}"]`).filter({ visible: true }).first(); await f.click(); await page.waitForTimeout(800); must((await f.getAttribute("aria-pressed")) === "true", "Follow didn't stick"); });
      await step("join the fan club on the host page", async () => { await page.goto(base + `/@${S.handle}`, { waitUntil: "load" }); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(800); const j = vis(page, "#club [data-join]"); /* the card from public/fanclub.js */ must(await j.count(), "the host page has no way to join the fan club"); await j.click(); await page.waitForTimeout(1000);
        const r = await api("GET", `/api/public/club/${S.handle}`, null, S.newGuest.cookie); must(r.j.member || r.j.club?.member || r.j.you?.member, "not a member after Join: " + JSON.stringify(r.j).slice(0, 160)); });
      await noErrors(sink, "journey 6");
    } finally { await ctx.close(); }
  });

  // 7. Library: save to a list, then share it
  await journey("7. Library: save to a list, share it", async (step) => {
    const { ctx, page, sink } = await journeyCtx("guest");
    try {
      await step("Save to list on an event", async () => { await page.goto(base + `/e/${S.open}`, { waitUntil: "load" }); await page.waitForLoadState("networkidle").catch(() => {}); let b = vis(page, "[data-pl-savelist]"); if (!(await b.count())) { await page.goto(base + `/g#rsvp-${S.open}`, { waitUntil: "load" }); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(800); b = vis(page, "[data-pl-savelist]"); } must(await b.count(), "no Save to list"); await b.click(); await page.waitForTimeout(800); must(await page.evaluate(() => window.__overlays().length), "the save sheet didn't open"); });
      await step("make a new list with it", async () => { const inp = page.locator(".psl-new input").filter({ visible: true }).first(); must(await inp.count(), "no New list in the sheet"); await inp.fill("Audit picks"); await inp.press("Enter"); await page.waitForTimeout(1000);
        const L = (await api("GET", "/api/me/library", null, S.guest.cookie)).j; const l = (L.lists || []).find((x) => x.name === "Audit picks" || x.title === "Audit picks"); must(l, "the list wasn't made"); must((l.count || l.items?.length || 0) >= 1, "the event isn't in the list"); });
      await step("share the list from the Library", async () => { await page.goto(base + "/library", { waitUntil: "load" }); await page.waitForLoadState("networkidle").catch(() => {}); const l = page.locator("a, button").filter({ hasText: "Audit picks" }).filter({ visible: true }).first(); must(await l.count(), "the list isn't in the Library"); await l.click(); await page.waitForTimeout(900);
        const sh = vis(page, "#shareBtn"); must(await sh.count(), "no Share on the list"); await sh.click(); await page.waitForSelector("[data-sh=link]", { timeout: 5000 }); await vis(page, "[data-sh=link]").click(); await page.waitForSelector("#shLink", { timeout: 5000 }); must(/\/l\//.test(await page.locator("#shLink").inputValue()), "no share link"); await vis(page, "#shCopy").click(); await page.waitForTimeout(400); must(/Copied/.test(await page.locator("#shCopy").textContent()), "Copy in the share sheet did nothing"); const go = vis(page, "#shShare"); if (await go.count()) { must(!(await go.isDisabled()), "Share is still greyed out with a link"); await go.click(); await page.waitForTimeout(300); must((await page.evaluate(() => window.__audit.shared)) > 0, "Share in the sheet did nothing"); } });
      await noErrors(sink, "journey 7");
    } finally { await ctx.close(); }
  });

  // 8. Sign in with an email code, sign out, sign back in
  await journey("8. sign in with an email code, sign out, sign back in", async (step) => {
    const { ctx, page, sink } = await journeyCtx("out"), email = S.guest.email;
    const signIn = async () => { await page.goto(base + "/login", { waitUntil: "load" }); await page.waitForSelector("#idIn", { state: "visible" }); await page.locator("#idIn").fill(email); fakeOutbox.length = 0; /* Send a new code waits 30 seconds on this page, so read the first one */ await vis(page, "#idGo").click(); await page.waitForSelector("#otpIn", { state: "visible", timeout: 6000 }); const code = await otpFor(email);
      await Promise.all([page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 10000 }), page.locator("#otpIn").fill(code)]); await page.waitForLoadState("networkidle").catch(() => {}); const me = await page.evaluate(() => fetch("/api/me").then((r) => r.json())); must(me?.email === email || me?.user?.email === email, "not signed in as " + email); };
    try {
      await step("sign in with an email code", signIn);
      await step("sign out from Settings", async () => { await page.goto(base + "/settings", { waitUntil: "load" }); await page.waitForLoadState("networkidle").catch(() => {}); const o = page.locator("button, a").filter({ hasText: /^Sign out|^Log out/i }).filter({ visible: true }).first(); must(await o.count(), "no Sign out in Settings"); await o.scrollIntoViewIfNeeded(); await Promise.all([page.waitForURL((u) => !/\/settings/.test(u.pathname), { timeout: 8000 }).catch(() => {}), o.click()]); await page.waitForTimeout(800); const me = await page.evaluate(() => fetch("/api/me").then((r) => (r.ok ? r.json() : null)).catch(() => null)); must(!me?.email && !me?.user?.email, "still signed in after Sign out"); });
      await step("sign back in", signIn);
      await noErrors(sink, "journey 8");
    } finally { await ctx.close(); }
  });
}
