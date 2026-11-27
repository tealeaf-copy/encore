// Walks brand proposals in a real browser (Chromium), at 390 (iPhone 13) and 1280, as a first-time host with little data
// and as an experienced host with lots: from a brand's request to a sent proposal, then the brand opening it and
// accepting, and the PDF pages. Not part of npm test. Run: node scripts/proposals-walk.mjs [--out <dir>]
// Screenshots go to --out (default: a temp folder). Prints one line per problem (console errors, failed requests,
// sideways scroll) and exits 1 if there were any.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { openStore, randomId } from "../server/db.js";
import { createApp } from "../server/app.js";
import { scopeStore, getDbUser } from "../server/workspaces.js";
import { renderCard } from "../server/sharecards.js";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg("--out", fs.mkdtempSync(path.join(os.tmpdir(), "proposals-walk-"))); fs.mkdirSync(OUT, { recursive: true });
Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "walk-secret-0123456789abcdef", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_SMS: "1", ENCORE_FAKE_AI: "1", ENCORE_SIGNUP_PER_HOUR: "500", ENCORE_VERIFY_EMAIL: "0" });
let pw; try { pw = createRequire(import.meta.url)("playwright"); } catch { pw = createRequire(import.meta.url)(path.join(process.execPath, "../../lib/node_modules/playwright")); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proposals-walk-db-")), store = openStore(path.join(dir, "walk.db")), app = createApp({ store, dataDir: dir });
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); }), base = `http://127.0.0.1:${server.address().port}`;
const J = { "content-type": "application/json" }, post = async (p, body, cookie) => { const r = await fetch(base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`${p} ${r.status} ${await r.text()}`); return r; };
const signup = async (name, email, extra) => (await post("/api/signup", { name, email, password: "long-password-1", ...extra })).headers.get("set-cookie").split(";")[0];
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const weekday = (n) => { for (let i = n; i < n + 10; i++) { const d = day(i), w = new Date(d + "T12:00:00Z").getUTCDay(); if (w >= 1 && w <= 5) return d; } };
const problems = [];
// Chromium reports an aborted page-to-page fade when a script navigates away from a team page (public/brandbook.css opts
// into cross-document view transitions) before the fade can start. It is not an error a person sees, so it is counted apart.
const VT = /^Transition was aborted because of invalid state/;

async function host(handle, name, person, { rich }) {
  const email = `${handle}@host.example`, c = await signup(person, email, { mode: "friends" }), ws = getDbUser(email).ws;
  let gallery = [];
  if (rich) { const id = randomId(), png = renderCard({ tone: "peach", title: "", art: "dinner" }, "link"); fs.mkdirSync(path.join(dir, "assets"), { recursive: true }); fs.writeFileSync(path.join(dir, "assets", id), png); fs.writeFileSync(path.join(dir, "assets", id + ".json"), JSON.stringify({ id, url: "/_blob/" + id, sizeBytes: png.length, contentType: "image/png", createdAt: Date.now(), ws })); gallery = ["/_blob/" + id]; }
  await post("/api/host/profile", { handle, name, city: rich ? "Brooklyn" : "Queens", hood: rich ? "Greenpoint" : "Astoria", forHire: true, gallery, bio: rich ? "I'm Ines. I cook long family-style dinners in Greenpoint for people who like to talk, and I've hosted a supper club here since 2019." : "I bake sourdough and run small bread classes from my kitchen." }, c);
  if (rich) await post("/api/host/brandkit", { starter: "supper", fromStarter: true }, c);
  const S = await (await post("/api/bb/host/setup", { on: true, policy: "standard", area: rich ? "Greenpoint" : "Astoria", city: "New York", story: "Small groups, good food.", since: 2019,
    packages: [{ name: rich ? "Family-style supper for your team" : "Sourdough class for your team", story: rich ? "Four courses down one long table." : "Mix, shape and bake a loaf to take home.", moods: [rich ? "client" : "handson"], perPersonCents: rich ? 13500 : 6500, minimumCents: rich ? 150000 : 50000, minGuests: 6, maxGuests: 24, leadDays: 7, includes: rich ? ["Four courses", "Service", "Clean-up"] : ["Flour and starter", "Aprons", "A loaf to take home"], weekdays: [1, 2, 3, 4, 5], time: "evening", depositPct: 25 }] }, c)).json();
  if (rich) { const St = scopeStore(store, ws), G = Array.from({ length: 14 }, (_, i) => `guest${i}@guest.example`);
    for (let i = 0; i < 9; i++) { St.set(`events/w${handle}${i}`, { kind: "social", casual: true, name: ["Long table supper", "Harvest dinner", "Dumpling night", "Winter supper"][i % 4] + ` No. ${i + 1}`, date: day(-12 - i * 20), startTime: "19:00", city: "Brooklyn", published: true, discoverable: true });
      G.forEach((g, j) => { if ((i + j) % 3 !== 0) St.set(`rsvps/w${i}g${j}`, { eventId: `w${handle}${i}`, email: g, name: `Guest ${j}`, response: "going", createdAt: Date.now() - 864e5 * (30 + i) }); }); }
    const K = [["Maya Lopez", "The best night out I've had all year. I came alone and left with four new friends."], ["Jon Ruiz", "Ines makes a room of strangers feel like a family dinner. The food was unreal."], ["Priya Shah", "I'd go again tomorrow. Every course had a story and none of it felt fussy."], ["Leo Park", "So warm, so generous. My vegan plate was the best one at the table."]];
    K.forEach(([n, love], i) => St.set(`kudos/wk${i}`, { eventId: `w${handle}${i}`, rid: `w${i}g1`, name: n, email: G[i + 1], tags: ["again"], love, at: Date.now() - (i + 1) * 864e5 * 10 }));
    for (let i = 0; i < 8; i++) St.set(`kudos/wt${i}`, { eventId: `w${handle}${i % 9}`, rid: `x${i}`, name: `G${i}`, email: G[(i + 5) % 14], tags: i % 4 ? ["again"] : ["food"], at: Date.now() - i * 864e5 * 3 });
    app.locals.social.bust(); }
  return { c, ws, pkg: S.setup.packages[0], handle };
}

const browser = await pw.chromium.launch();
for (const W of [390, 1280]) {
  const brand = await signup("Sam Rivera", `sam${W}@fernlight.example`, { mode: "work", company: "Fernlight" });
  for (const kind of ["new", "rich"]) {
    const H = await host(`${kind === "rich" ? "ines" : "bea"}-${W}`, kind === "rich" ? "Marlow Supper Club" : "Bea's Bread Room", kind === "rich" ? "Ines Marlow" : "Bea Costa", { rich: kind === "rich" });
    await post("/api/bb/requests", { handle: H.handle, pkg: H.pkg.id, date: weekday(30), headcount: kind === "rich" ? 18 : 10, diets: ["vegetarian", "gluten-free"], occasion: "Thank-you night for our first customers", notes: "We want our best customers to meet each other. Warm, not salesy." }, brand);
    const shot = (p, name, full = true) => p.screenshot({ path: path.join(OUT, `${W}-${kind}-${name}.png`), fullPage: full });
    const ctxOpts = W === 390 ? { ...pw.devices["iPhone 13"], serviceWorkers: "block" } : { viewport: { width: 1280, height: 900 }, serviceWorkers: "block" };
    const watch = (p, who) => { p.on("console", (m) => { if (m.type() === "error" && !/favicon|fonts\.g/.test(m.text())) problems.push(`${W} ${kind} ${who} console: ${m.text().slice(0, 160)}`); }); p.on("pageerror", (e) => VT.test(e.message) || problems.push(`${W} ${kind} ${who} error at ${p.url()}: ${e.message}`)); p.on("requestfailed", (r) => { if (r.url().startsWith(base) && !/\.pdf|\/pdf/.test(r.url())) problems.push(`${W} ${kind} ${who} failed: ${r.url()}`); }); };
    const sideways = async (p, where) => { const o = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) problems.push(`${W} ${kind} sideways scroll ${o}px at ${where}`); };
    // ---- the host ----
    const hc = await browser.newContext(ctxOpts); const [k, ...v] = H.c.split("="); await hc.addCookies([{ name: k, value: v.join("="), url: base }]);
    const hp = await hc.newPage(); watch(hp, "host");
    await hp.goto(base + "/host/teams#inbox"); await hp.waitForSelector("text=Send a proposal"); await shot(hp, "01-request-inbox", false);
    await hp.click("text=Send a proposal"); await hp.waitForURL(/\/proposals\/[a-f0-9]+\/edit/); await hp.waitForSelector("#doc .pp-doc"); await sideways(hp, "editor"); await shot(hp, "02-editor-start", W !== 390);
    const step = async (k2, name) => { await hp.click(`#steps [data-go="${k2}"]`); await hp.waitForTimeout(250); await sideways(hp, k2); await shot(hp, name, W !== 390); };
    await step("about", "03-about");
    await step("proof", "04-proof");
    if (kind === "new") { await hp.click("text=Add one"); await hp.fill('[data-p="sections.proof.offline.0.what"]', "Bread classes for a neighbourhood book club"); await hp.fill('[data-p="sections.proof.offline.0.when"]', "2024 and 2025"); await hp.fill('[data-p="sections.proof.offline.0.people"]', "12 at a time"); await hp.waitForTimeout(800); await shot(hp, "04b-proof-offline", W !== 390); }
    await step("idea", "05-idea"); await hp.click("[data-potto=concepts]"); await hp.waitForTimeout(900);
    const ta = hp.locator('[data-p="sections.idea.concepts.0.experience"]'); await hp.locator('[data-rw="sections.idea.concepts.0.experience"][data-how="warmer"]').click(); await hp.waitForTimeout(700); if (!/I'd love/.test(await ta.inputValue())) problems.push(`${W} ${kind} warmer rewrite did not change the text`);
    await step("plan", "06-plan"); await step("pricing", "07-pricing"); await step("terms", "08-terms"); await step("send", "09-send");
    await hp.click("#send"); await hp.waitForSelector(".pb-sent"); await shot(hp, "10-sent", W !== 390);
    const url = await hp.locator("[aria-label='Proposal link']").inputValue();
    if (W === 390) { await hp.click(".pb-jump"); await hp.waitForTimeout(300); await shot(hp, "11-preview-below", false); }
    else await hp.locator("#pv").screenshot({ path: path.join(OUT, `${W}-${kind}-11-preview-beside.png`) });
    // ---- the brand ----
    const bc = await browser.newContext(ctxOpts); const [bk, ...bv] = brand.split("="); await bc.addCookies([{ name: bk, value: bv.join("="), url: base }]);
    const bp = await bc.newPage(); watch(bp, "brand");
    await bp.goto(url.replace(/^https?:\/\/[^/]+/, base)); await bp.waitForSelector(".pp-doc"); await sideways(bp, "brand page"); await shot(bp, "12-brand-page"); await shot(bp, "12b-brand-first-screen", false);
    await bp.click('[data-act="accept"]'); await bp.waitForURL(/\/teams\/bookings\//); await bp.waitForSelector("[data-pay]"); await bp.waitForSelector("#tb-prop"); await shot(bp, "13-accepted-deposit-due", false);
    await bp.click("[data-pay]"); await bp.waitForTimeout(800); await shot(bp, "14-booked", false);
    const st = await bp.evaluate(async (id) => (await (await fetch(`/api/bb/requests/${id}`)).json()).request.status, bp.url().split("/").pop().split("?")[0]); if (st !== "booked") problems.push(`${W} ${kind} after the deposit the booking is ${st}`);
    await hp.goto(base + "/proposals"); await hp.waitForSelector(".pb-row"); await shot(hp, "15-host-list", false);
    // ---- the PDFs, as pages ----
    if (W === 1280) for (const [q, tag] of [["?pages=one", "pdf-one"], ["", "pdf-full"]]) { const b = Buffer.from(await (await fetch(url.replace(/^https?:\/\/[^/]+/, base) + "/pdf" + q)).arrayBuffer()); const f = path.join(OUT, `${kind}-${tag}.pdf`); fs.writeFileSync(f, b); try { execFileSync("pdftoppm", ["-png", "-r", "60", f, path.join(OUT, `${kind}-${tag}`)]); } catch (e) { problems.push("pdftoppm: " + e.message); } }
    await hc.close(); await bc.close();
  }
}
// the example proposal and its PDF
{ const c = await browser.newContext({ ...pw.devices["iPhone 13"], serviceWorkers: "block" }), p = await c.newPage(); await p.goto(base + "/proposals/example/workshop"); await p.screenshot({ path: path.join(OUT, "390-example-workshop.png"), fullPage: true }); await c.close();
  const b = Buffer.from(await (await fetch(base + "/proposals/example/workshop/pdf")).arrayBuffer()), f = path.join(OUT, "example-pdf.pdf"); fs.writeFileSync(f, b); try { execFileSync("pdftoppm", ["-png", "-r", "60", f, path.join(OUT, "example-pdf")]); } catch {} }
await browser.close(); server.close(); store.close();
for (const p of problems) console.log(p);
console.log(`${problems.length} problems. Screenshots in ${OUT}`);
process.exit(problems.length ? 1 : 0);
