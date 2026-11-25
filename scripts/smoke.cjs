// Browser smoke test for the core flow, against a running server (local or a preview, never production):
//   node scripts/smoke.cjs http://localhost:4998
// Needs Playwright with Chromium (npx playwright install chromium) and a server with ENCORE_SIGNUP=1.
// Signs up a host, plans an event from one sentence, publishes it to their page, RSVPs as a guest on a phone,
// reloads as that guest, and checks the host page lists the event. Fails on any page error or failed request.
const { chromium, devices } = require("playwright");
const B = String(process.argv[2] || "http://localhost:4998").replace(/\/$/, "");
if (/onrender\.com|encore\.app|potterylab\.ai/.test(B)) { console.error("Refusing to run against production."); process.exit(2); }
const J = { "content-type": "application/json" }, sfx = Date.now().toString(36), problems = [];
const watch = (page, who) => { page.on("pageerror", (e) => problems.push(`${who} page error: ${e.message.slice(0, 160)}`));
  page.on("response", (r) => { const u = r.url(); if (r.status() < 400 || !u.startsWith(B) || /\/api\/(me|workspace|brand)\b/.test(u)) return;
    // a connected tool (web search) failing upstream is reported as 502 by design; it depends on that service, not on Pottery Lab
    if (r.status() === 502 && /\/api\/mcp\/call/.test(u)) { console.log(`  note: ${who} tool call 502 (upstream service unavailable)`); return; }
    problems.push(`${who} ${r.status()} ${u.replace(B, "")}`); }); };
const step = (name, ok) => { console.log(`${ok ? "✓" : "✗"} ${name}`); if (!ok) problems.push("failed: " + name); };
(async () => {
  const su = await fetch(B + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name: "Smoke Host", email: `smoke.${sfx}@example.com`, password: "smoke-password-1", mode: "friends" }) });
  step("host signs up", su.ok); if (!su.ok) return finish();
  const ck = su.headers.get("set-cookie").split(";")[0], handle = "smoke-" + sfx;
  step("host page created", (await fetch(B + "/api/host/profile", { method: "POST", headers: { ...J, cookie: ck }, body: JSON.stringify({ handle, name: "Smoke Supper Club", city: "New York" }) })).ok);
  const b = await chromium.launch(); const host = await b.newContext({ viewport: { width: 1280, height: 900 } }); const [n, v] = ck.split("="); await host.addCookies([{ name: n, value: v, url: B }]);
  const p = await host.newPage(); watch(p, "host");
  await p.goto(B + "/#studio"); await p.waitForSelector("#ceIn", { timeout: 15000 }); await p.fill("#ceIn", "Taco night Saturday at 7, meet at Dolores Park"); await p.click("#ceGo"); await p.waitForTimeout(3500);
  const id = await p.evaluate(async () => { draft.questions = [{ id: "q1", q: "what are you bringing?", type: "short" }, { id: "q2", q: "how many sets?", type: "number", min: 1, max: 6 }]; draft.published = true; draft.discoverable = true; draft.unlisted = true; await saveEvent(true); return draft.id; });
  step("event planned and published", !!id);
  const g = await b.newContext({ ...devices["iPhone 13"] }); const gp = await g.newPage(); watch(gp, "guest");
  await gp.goto(`${B}/g#rsvp-${id}`); await gp.waitForSelector("#g-name", { timeout: 20000 }); step("guest sees the invite", true);
  await gp.fill("#g-name", "Smoke Guest");
  // the host's own questions, answered through the card a guest sees
  await gp.waitForSelector("#tfBox .tf-a input", { timeout: 10000 }); await gp.fill("#tfBox .tf-a input", "salsa verde"); await gp.click("#tfBox [data-next]");
  await gp.click('#tfBox [data-st="1"]'); await gp.click("#tfBox [data-next]"); await gp.waitForTimeout(300);
  await gp.click("#g-send"); await gp.waitForTimeout(2500);
  step("guest RSVPs", await gp.evaluate(() => !!document.querySelector("#view-guest .ticket")));
  const rs = await (await fetch(B + "/api/db/collection?path=rsvps", { headers: { cookie: ck } })).json(), mine = (rs.docs || rs.items || rs).map((d) => d.data || d).find((r) => r.name === "Smoke Guest");
  step("the guest's answers reach the host", mine?.answers?.q1 === "salsa verde" && +mine?.answers?.q2 === 2);
  // and they're in the host's guest-list export (the RSVP is also copied onto the guest list; one row, with answers)
  await p.waitForTimeout(2500); const csv = await p.evaluate(() => { const d = allEvents.find((e) => e.id === draft.id) || draft; return csvOf(guestRows(d), (d.questions || []).filter((x) => x.q)); });
  step("the guest-list export has their answers, once", (csv.match(/Smoke Guest/g) || []).length === 1 && /salsa verde/.test(csv));
  // the light invite at /e/<id> (what share links open): a second guest says yes there, and the host gets it
  const g2 = await b.newContext({ ...devices["iPhone 13"] }); const lp = await g2.newPage(); watch(lp, "lite guest");
  await lp.goto(`${B}/e/${id}`); await lp.waitForSelector("#nm", { timeout: 15000 }); await lp.fill("#nm", "Lite Guest");
  await lp.waitForSelector("#qs .tf-a input", { timeout: 8000 }); await lp.fill("#qs .tf-a input", "tortilla chips"); await lp.click("#qs [data-next]"); await lp.click('#qs [data-st="1"]'); await lp.click("#qs [data-next]");
  await lp.click("#send"); await lp.waitForSelector("#tk", { timeout: 10000 });
  const rs2 = await (await fetch(B + "/api/db/collection?path=rsvps", { headers: { cookie: ck } })).json(), lite = (rs2.docs || rs2.items || rs2).map((d) => d.data || d).find((r) => r.name === "Lite Guest");
  step("a guest RSVPs on the light invite, answers included", lite?.response === "going" && lite?.answers?.q1 === "tortilla chips");
  await gp.reload(); await gp.waitForTimeout(5000); step("returning guest keeps their ticket", await gp.evaluate(() => !!document.querySelector("#view-guest .ticket")));
  const hp = await (await fetch(`${B}/api/public/host/${handle}`)).json(); step("host page lists the event", (hp.upcoming || []).some((e) => e.id === id));
  await b.close(); finish();
})().catch((e) => { problems.push("crashed: " + e.message); finish(); });
function finish() { if (problems.length) { console.error("\n" + problems.join("\n")); process.exit(1); } console.log("\nSmoke test passed."); }
