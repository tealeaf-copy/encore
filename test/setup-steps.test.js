// The guided setups (public/dropsetup.js, public/dropsetup.css): the "What are you making?" chooser, the first-time
// tutorial on drops, the drop setup's four steps, "Something to book" and editing a drop. Every screen has a big
// headline, one grey line, one visual, and one full-width button at the bottom that never covers a control. The
// visual shows an example marked "Example" until the host adds their own, toggles change both the demonstration and
// what is saved, and the tutorial shows once a person (kept on the server).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";

const J = { "Content-Type": "application/json" };
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
let srv, maya, noor, tmp;
const post = (p, b, h = {}) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...h }, body: JSON.stringify(b) });
const getJ = async (p, h = {}) => (await fetch(srv.base + p, { headers: h })).json();
const join = async (name, email, handle) => { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200); const c = r.headers.get("set-cookie").split(";")[0];
  assert.ok((await post("/api/host/profile", { name, handle, city: "New York", hood: "Greenpoint", tagline: "Pandan everything", bio: "I bake on weekends." }, { cookie: c })).ok); return c; };
// a small real PNG (one colour), so the checked upload takes it
const png = (rgb) => { const W = 400, H = 300, raw = Buffer.alloc((W * 3 + 1) * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) raw.set(rgb, y * (W * 3 + 1) + 1 + x * 3);
  const crc = (b) => { let c, n = ~0; for (const x of b) { c = (n ^ x) & 255; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; n = (n >>> 8) ^ c; } return ~n >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4), c = Buffer.alloc(4), td = Buffer.concat([Buffer.from(t), d]); l.writeUInt32BE(d.length); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const hd = Buffer.alloc(13); hd.writeUInt32BE(W, 0); hd.writeUInt32BE(H, 4); hd.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", hd), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]); };

const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "setupsteps-secret-01234", ENCORE_FAKE_EMAIL: "1", ENCORE_SIGNUP_PER_HOUR: "100" };
before(async () => { Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer(); maya = await join("Maya Tan", "maya.steps@example.com", "maya-steps"); noor = await join("Noor Ali", "noor.steps@example.com", "noor-steps");
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "steps-")); fs.writeFileSync(path.join(tmp, "a.png"), png([157, 178, 116])); fs.writeFileSync(path.join(tmp, "b.png"), png([244, 211, 111])); });
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; fs.rmSync(tmp, { recursive: true, force: true }); await srv.close(); });

test("the tutorial is offered before a first drop, once a person, and the setups load only when asked for", async () => {
  assert.equal((await getJ("/api/host/drops", { cookie: noor })).tour, true, "no drop yet, not seen");
  assert.equal((await post("/api/host/drop-tour", {}, { cookie: noor })).status, 200); assert.equal((await getJ("/api/host/drops", { cookie: noor })).tour, false, "seen is kept on the server");
  assert.equal((await getJ("/api/host/drops", { cookie: maya })).tour, true, "another person still gets it"); assert.equal((await post("/api/host/drop-tour", {})).status, 401);
  const dp = read("public/drop.js"), ds = read("public/dropsetup.js"), css = read("public/dropsetup.css"), idx = read("index.html");
  assert.doesNotMatch(idx, /dropsetup\.(js|css)/, "the app shell doesn't carry the setups"); assert.match(dp, /for \(const src of \["\/pickup\.js", "\/eventart\.js", "\/dropsetup\.js"\]\)/); assert.match(dp, /get\("drops"\) === "how"/);
  assert.match(read("docs/help.md"), /\[How drops work\]\(\/\?app=1&drops=how\)/);
  // the copy: no em dashes, none of the words we don't use, "batch" never without its meaning
  for (const [f, t] of [["dropsetup.js", ds], ["dropsetup.css", css]]) { assert.doesNotMatch(t, /—/, f); assert.doesNotMatch(t, /\b(elevate|curated|seamless|unlock|marketplace|magical)\b/i, f); assert.doesNotMatch(t, /\b(claude|gpt|gemini|sonnet|opus|haiku)\b/i, f); }
  assert.match(ds, /A batch is how many you're making this time\./); assert.doesNotMatch(ds, /this batch/);
  // motion is opt-in, and the bottom button is a sibling of the scroll area, never a layer over it
  assert.match(css, /@media \(prefers-reduced-motion:no-preference\)\{[\s\S]*ds-pane\.ds-fwd\{animation:ds-f \.16s/); assert.doesNotMatch(css.split("@media (prefers-reduced-motion:no-preference)")[0], /animation:/);
  // class names stay our own: the app shell styles a bare ".f" as a bold 13px label, which once made every explanation here bold
  assert.doesNotMatch(ds, /classList\.add\([^)]*"[a-z]"\)/); assert.doesNotMatch(css, /\.ds-pane\.[a-z]\{/);
  assert.match(css, /\.ds-ft\{flex:none;/); assert.doesNotMatch(css, /\.ds-ft\{[^}]*position:(sticky|fixed|absolute)/);
});

for (const [W, H] of [[390, 844], [390, 664]]) test(`in a browser at ${W}x${H}: the chooser, the tutorial, four steps, live, edit and something to book`, async (t) => {
  const req = createRequire(import.meta.url); let pw; try { pw = req("playwright"); } catch { return t.skip("no playwright"); }
  let br; try { br = await pw.chromium.launch(); } catch { return t.skip("no browser"); }
  const cookie = H === 844 ? maya : await join("Lan Pham", "lan.steps@example.com", "lan-steps");
  try {
    const ctx = await br.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: pw.devices["iPhone 13"].userAgent });
    const [k, ...v] = cookie.split("="); await ctx.addCookies([{ name: k, value: v.join("="), url: srv.base }]); await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (x) => x.fulfill({ status: 200, body: "" }));
    const p = await ctx.newPage(), errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); }); p.on("response", (r) => { if (r.status() >= 400) errs.push(r.status() + " " + r.url()); });
    await p.goto(srv.base + "/?app=1", { waitUntil: "load" }); await p.waitForFunction(() => window.EncoreDrop);
    assert.equal(await p.locator('script[src^="/dropsetup.js"]').count(), 0, "not loaded until asked for");
    /** One screen: a headline of 28px or more, a grey line, one visual, one full-width primary below the scroll area, and every control can be scrolled clear of it. */
    const screen = async (name, { visual = true, head = true } = {}) => { await p.waitForTimeout(260);
      const r = await p.evaluate(async () => { const d = document.querySelector("#dpSheet .ds"), sc = d.querySelector(".ds-scroll"), ft = d.querySelector(".ds-ft"), go = [...ft.querySelectorAll(".ds-go")], h = d.querySelector(".ds-h"), sub = d.querySelector(".ds-sub");
        const box = (e) => e.getBoundingClientRect(), S = box(sc), F = box(ft), G = go[0] && box(go[0]), out = [];
        const ctl = [...sc.querySelectorAll("button,input:not(.ds-vh),select,textarea,summary,a")].filter((e) => e.offsetParent && !e.closest("details:not([open]) > :not(summary)"));
        for (const e of ctl) { e.scrollIntoView({ block: "nearest" }); const b = box(e), tag = e.id || e.className || e.tagName; if (b.bottom > box(sc).bottom + 1 || b.top < box(sc).top - 1) out.push("hidden: " + tag);
          const vis = e.type === "date" ? e.parentNode : e; const vb = box(vis); if (vb.height < 43.5 && !e.closest(".ds-ph")) out.push(`short (${vb.height}): ${tag}`); if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName) && e.type !== "date" && parseFloat(getComputedStyle(e).fontSize) < 16) out.push("small text: " + tag); }
        sc.scrollTop = 1e6; await new Promise((r) => setTimeout(r, 30)); const last = ctl[ctl.length - 1], lastOk = !last || box(last).bottom <= box(sc).bottom + 1; sc.scrollTop = 0;
        return { hPx: h ? parseFloat(getComputedStyle(h).fontSize) : 0, hText: h?.textContent || "", sub: sub?.textContent || "", subPx: sub ? parseFloat(getComputedStyle(sub).fontSize) : 0, vis: d.querySelectorAll(".ds-vis").length, primaries: go.length, goW: G?.width || 0, goH: G?.height || 0, dW: box(d).width, scBottom: S.bottom, ftTop: F.top, ftBottom: F.bottom, vh: innerHeight, out, lastOk,
          fonts: [...d.querySelectorAll(".ds-h,.ds-sub,.ds-note,.ds-help,.ds-say,.ds-made,.ds-hint,.ds-f small,.ds-ph .s,.ds-f>span:first-child,.ds-go,input:not([type=file]):not([type=date]),select,textarea")].filter((e) => e.offsetParent && (e.textContent.trim() || e.matches("input,select,textarea"))).map((e) => { const c = getComputedStyle(e), k = e.matches(".ds-h") ? "h" : e.matches(".ds-go") ? "go" : e.matches(".ds-f>span:first-child") ? "label" : e.matches("input,select,textarea") ? "field" : "body"; return [k, c.fontFamily.split(",")[0].replace(/"/g, ""), parseFloat(c.fontSize), +c.fontWeight, e.textContent.trim().slice(0, 24)]; })
            .filter(([k, fam, px, w]) => fam !== "IBM Plex Sans" || (k === "h" ? px < 28 || w !== 600 : k === "go" ? px !== 18 || w !== 600 : k === "label" ? px !== 15 || w !== 600 : k === "field" ? px !== 16 || w !== 400 : w !== 400 || px < 13 || px > 17)),
          mock: (() => { const ph = d.querySelector(".ds-vis .ds-ph"), v = d.querySelector(".ds-vis"); if (!ph) return 0; return Math.max(0, Math.round(box(ph).bottom - box(v).bottom), ...[...ph.querySelectorAll("*")].filter((e) => e.offsetParent).map((e) => Math.round(box(e).bottom - box(ph).bottom))); })(),
          sideways: document.documentElement.scrollWidth - innerWidth, wide: sc.scrollWidth - sc.clientWidth, cut: [...d.querySelectorAll(".ds-h,.ds-sub,.ds-go,.ds-sec,.ds-f>span,.ds-tog button,.ds-tabs button")].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim()) }; });
      if (head) { assert.ok(r.hPx >= 28, `${name}: the headline is ${r.hPx}px`); assert.ok(r.hText.length > 5, name + ": a headline"); assert.ok(r.sub.length > 20 && r.subPx >= 16, name + ": a grey line under it"); }
      if (visual) { assert.equal(r.vis, 1, name + ": one visual"); assert.equal(r.mock, 0, name + ": the visual's card is whole, nothing cut off inside it"); }
      assert.deepEqual(r.fonts, [], name + ": headings are the only heading-weight text; explanations are the regular body face");
      assert.equal(r.primaries, 1, name + ": one primary"); assert.ok(r.goW >= r.dW - 34 && r.goH >= 52, `${name}: the primary is full width and tall (${r.goW} of ${r.dW}, ${r.goH})`);
      assert.ok(r.scBottom <= r.ftTop + 0.5, name + ": the scroll area ends above the button"); assert.ok(r.ftBottom <= r.vh + 0.5, name + ": the button is on screen");
      assert.deepEqual(r.out, [], name + ": every control scrolls clear, is 44px and reads at 16px"); assert.ok(r.lastOk, name + ": the last control scrolls fully into view");
      assert.equal(r.sideways, 0, name + ": no sideways scroll"); assert.equal(r.wide, 0, name + ": nothing wider than the screen"); assert.deepEqual(r.cut, [], name + ": no cut-off text"); return r; };
    const visText = () => p.locator("#dsVis").innerText();

    // ---- the chooser: one screen, three choices one tap each, a different demo for each, one Start ----
    // from here on nothing may jump: shifts are counted from the moment a setup opens (the app's own first paint is test/perf-robustness's)
    await p.waitForTimeout(600); await p.evaluate(() => { window.__shift = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__shift.push([+e.value.toFixed(4), (e.sources || []).map((x) => x.node?.className || x.node?.nodeName || "?").join(",")]); }).observe({ type: "layout-shift" }); });
    await p.evaluate(() => window.EncoreDrop.choose({ event: () => (window.__ev = 1) })); await p.waitForSelector("#dsStart");
    await screen("chooser"); assert.equal(await p.locator("#dpSheet [data-kind]").count(), 3); const demos = new Set();
    for (const [kind, re, go] of [["event", /Dumpling night[\s\S]*I'm in[\s\S]*Lan is in/, "Start an event"], ["drop", /Pandan this Saturday[\s\S]*Pandan cake[\s\S]*Order · \$36/, "Start a drop"], ["book", /Pottery class for your team[\s\S]*\$55 a person[\s\S]*Acme Design asks for a date[\s\S]*You quote \$660/, "Start something to book"]]) {
      await p.tap(`#dpSheet [data-kind="${kind}"]`); assert.equal(await p.locator(`#dpSheet [data-kind="${kind}"]`).getAttribute("aria-checked"), "true"); const tx = await visText(); assert.match(tx, re, kind); demos.add(tx);
      assert.equal(await p.locator("#dsStart").innerText(), go); assert.ok((await p.locator("#dsKind").innerText()).length > 30, "one plain sentence"); assert.match(await p.locator("#dsLike").innerText(), /^Like: \S/, "and a real example"); }
    assert.equal(demos.size, 3, "a different demo for each"); await p.waitForTimeout(500); assert.ok(await p.locator("#dsStart").isVisible(), "nothing moved on by itself");
    // ---- A drop, the first time: the tutorial, four cards ----
    await p.tap('#dpSheet [data-kind="drop"]'); await p.tap("#dsStart"); await p.waitForSelector("#dsSkip");
    const heads = [];
    for (let i = 1; i <= 4; i++) { const r = await screen("tutorial " + i); heads.push(r.hText); assert.match(await p.locator(".ds-dash").getAttribute("aria-label"), new RegExp(`${i} of 4`)); assert.match(await visText(), /Example/);
      if (i === 2) { assert.match(r.sub, /A batch is how many you're making this time/); await p.tap("[data-tord]"); assert.match(await visText(), /5 left of 6/); }
      if (i === 3) { await p.tap('[data-tpick="1"]'); assert.match(await visText(), /12 Kent St, Apt 3[\s\S]*the day before/); }
      if (i === 4) { assert.match(await visText(), /Pay \$36/); await p.tap('#dpSheet [data-tog="pickup"]'); assert.match(await visText(), /Pay \$36 at pickup/); }
      if (i === 2) { await p.tap("#dpBack"); await p.waitForFunction(() => /Sell what/.test(document.querySelector(".ds-h")?.textContent || "")); await p.tap("#dsNext"); }
      await p.tap("#dsNext"); }
    assert.deepEqual(heads, ["Sell whatyou make", "Set yourbatch", "Pickup timesyou choose", "Get paidyour way"]);
    // ---- step 1: the example, then their photos ----
    await p.waitForSelector("#dpZone"); assert.equal((await getJ("/api/host/drops", { cookie })).tour, false, "seen once the tutorial is done");
    let r = await screen("step 1"); assert.equal(r.hText, "Show what you're making"); assert.match(await p.locator("#dpBack").getAttribute("aria-label"), /Close/);
    assert.match(await visText(), /Example: a baker[\s\S]*Pandan cake[\s\S]*\$18/); await p.tap("#dsExN"); assert.match(await visText(), /Example: a potter[\s\S]*Speckled mug/);
    assert.equal(await p.locator("#dpZone").innerText(), "Add photos"); assert.equal(await p.locator("#dpNext").innerText(), "Skip for now"); assert.ok(await p.locator("#dsHow").isVisible(), "How drops work is one tap away");
    await p.setInputFiles("#dpZoneIn", [path.join(tmp, "a.png"), path.join(tmp, "b.png")]); await p.waitForSelector(".ds-made");
    assert.doesNotMatch(await visText(), /Example/, "their photos replace the example"); assert.equal(await p.locator("#dsVis .ds-tile img").count(), 2); assert.equal(await p.locator("#dpNext").innerText(), "Next: name and price"); await screen("step 1 with photos");
    // ---- step 2: one item a photo, names and prices land on the visual, batch explained where it's asked ----
    await p.tap("#dpNext"); await p.waitForSelector("[data-n]"); r = await screen("step 2"); assert.equal(r.hText, "What's for sale?"); assert.match(r.sub, /how many you're making this time/);
    assert.equal(await p.locator(".dp-item").count(), 2); assert.match(await p.locator("#dsBody").innerText(), /We made one item for each photo\./); assert.equal(await p.locator(".dp-item .ds-shot img").count(), 2);
    assert.match(await p.locator(".dp-item").first().innerText(), /First item[\s\S]*Replace[\s\S]*Remove[\s\S]*Name[\s\S]*Price[\s\S]*How many are you making\?[\s\S]*Leave empty for no limit\. We stop orders when they're gone\./);
    await p.fill("[data-n]", "Pandan honeycomb cake"); await p.fill("[data-p]", "18.00"); await p.locator("[data-p]").first().blur(); assert.equal(await p.locator("[data-p]").first().inputValue(), "18"); assert.equal(await p.locator("[data-p]").first().getAttribute("inputmode"), "decimal");
    await p.waitForFunction(() => /Pandan honeycomb cake[\s\S]*\$18/.test(document.querySelector("#dsVis")?.innerText || "")); assert.equal(await p.locator(".dp-item [data-ih]").first().innerText(), "Pandan honeycomb cake");
    { const a = await p.locator(".dp-item").first().locator("[data-p]").evaluate((e) => e.closest(".ds-money").getBoundingClientRect()), b = await p.locator(".dp-item").first().locator("[data-s]").evaluate((e) => e.getBoundingClientRect()); assert.ok(Math.abs(a.top - b.top) < 1 && Math.abs(a.height - b.height) < 1 && a.height >= 48, "price and how many sit on one line, 48px"); assert.ok(a.right <= b.left - 8, "and don't touch"); }
    await p.tap("#dpNext"); assert.match(await p.locator("#dpErr").innerText(), /Give this item a name\./);
    await p.locator("[data-n]").nth(1).fill("Kaya toast box"); await p.locator("[data-p]").nth(1).fill("9.5"); await p.locator("[data-p]").nth(1).blur(); assert.equal(await p.locator("[data-p]").nth(1).inputValue(), "9.50"); await p.locator("[data-s]").first().fill("12");
    await p.tap('[data-mv="1:-1"]'); assert.equal(await p.locator(".dp-item [data-ih]").first().innerText(), "Kaya toast box"); assert.match(await p.locator(".ds-undo").innerText(), /Moved Kaya toast box up\.\s*Undo/); await p.tap("#dsUndo"); assert.equal(await p.locator(".dp-item [data-ih]").first().innerText(), "Pandan honeycomb cake");
    await p.tap('[data-rm="1"]'); assert.equal(await p.locator(".dp-item").count(), 1); await p.tap("#dsUndo"); assert.equal(await p.locator(".dp-item").count(), 2); assert.equal(await p.locator("[data-s]").first().inputValue(), "12");
    await p.locator("[data-s]").first().dispatchEvent("change"); assert.match(await visText(), /Pandan honeycomb cake\s*12 of 12 left\s*\$18[\s\S]*Kaya toast box\s*\$9\.50/, "the visual shows the name, the batch as guests see it, and the price");
    await screen("step 2 filled"); assert.equal(await p.locator("#dpNext").innerText(), "Next: pickup times");
    // ---- step 3: on a date or every week; the app's date and time words; the neighbourhood lands on the visual ----
    await p.tap("#dpNext"); await p.waitForSelector("#dpArea"); r = await screen("step 3"); assert.equal(r.hText, "When do they pick up?");
    assert.match(await visText(), /Example[\s\S]*Pick a pickup time[\s\S]*Greenpoint[\s\S]*Sat, \w{3} \d+ · 9 to 10am/); assert.match(await p.locator(".ds-date b").first().innerText(), /^Sat, \w{3} \d+$/); assert.equal(await p.locator("[data-wa] option:checked").innerText(), "9am");
    { const hs = await p.locator(".dp-wrow .ds-date, .dp-wrow select").evaluateAll((L) => L.map((e) => e.getBoundingClientRect().height)); assert.deepEqual([...new Set(hs)], [48], "date and time fields are one fixed height"); }
    await p.tap('#dpSheet [data-tog="weekly"]'); assert.match(await visText(), /Saturdays · 9 to 10am/); assert.equal(await p.locator("[data-wd]").count(), 1); await p.tap('#dpSheet [data-tog="date"]'); assert.match(await visText(), /Sat, \w{3} \d+ · 9 to 10am/);
    await p.tap("#dpAddWin"); assert.equal(await p.locator(".dp-wrow").count(), 2); await p.fill("#dpArea", "Sunset Park"); await p.fill("#dpAddr", "5 Audit St");
    await p.waitForFunction(() => /Sunset Park/.test(document.querySelector("#dsVis")?.innerText || "") && !/Example/.test(document.querySelector("#dsVis")?.innerText || "")); await p.tap('[data-vchip="1"]'); assert.match(await p.locator("#dsSay").innerText(), /10 to 11am gets your exact spot the day before/);
    await screen("step 3 filled"); assert.equal(await p.locator("#dpNext").innerText(), "Next: getting paid");
    // ---- step 4: the toggle changes the demonstration and what is saved ----
    await p.tap("#dpNext"); await p.waitForSelector("#dpPayM"); r = await screen("step 4"); assert.equal(r.hText, "How do people pay?");
    assert.match(await visText(), /2 × Pandan honeycomb cake[\s\S]*\$36[\s\S]*Pay \$36/); await p.tap("[data-vpay]"); assert.match(await visText(), /Paid\. Thanks!/);
    await p.tap('#dpSheet [data-tog="pickup"]'); assert.match(await visText(), /Pay \$36 at pickup/); assert.match(await p.locator("#dsSay").innerText(), /Cash or a tap when they collect/); assert.ok(await p.locator("#dpPayM").isHidden());
    await p.tap('#dpSheet [data-tog="either"]'); assert.match(await visText(), /Pay \$36[\s\S]*I'll pay at pickup/); assert.equal(await p.locator('#dpSheet [data-tog="either"]').getAttribute("aria-checked"), "true");
    await p.tap("details.ds-more > summary"); await p.fill("#dpTitle", "Pandan this Saturday"); await screen("step 4 with more options"); assert.equal(await p.locator("#dpNext").innerText(), "Open for orders");
    await p.waitForTimeout(300); const shifts = await p.evaluate(() => window.__shift), cls = shifts.reduce((a, x) => a + x[0], 0); assert.ok(cls < 0.05, "the screens hold still: " + cls + " " + JSON.stringify(shifts));
    await p.tap("#dpNext"); await p.waitForFunction(() => /Your drop is live/.test(document.querySelector("#dpSheet .ds-h")?.textContent || ""));
    r = await screen("live"); assert.equal(await p.locator("#dpShare").innerText(), "Share my drop"); assert.match(await visText(), /What guests see[\s\S]*Pandan this Saturday[\s\S]*Pandan honeycomb cake[\s\S]*\$18/);
    const D = (await getJ("/api/host/drops", { cookie })).drops; assert.equal(D.length, 1); const d = D[0];
    assert.equal(d.pay, "either", "the toggle's choice is what was saved"); assert.equal(d.title, "Pandan this Saturday"); assert.equal(d.area, "Sunset Park"); assert.equal(d.address, "5 Audit St"); assert.equal(d.always, false); assert.equal(d.windows.length, 2);
    assert.deepEqual(d.items.map((x) => [x.name, x.price, x.stock, x.photos.length]), [["Pandan honeycomb cake", 18, 12, 1], ["Kaya toast box", 9.5, 0, 1]]);
    // ---- a second drop goes straight to step 1, and How drops work brings the tutorial back ----
    await p.keyboard.press("Escape"); await p.evaluate(() => window.EncoreDrop.setup({})); await p.waitForSelector("#dpZone"); assert.equal(await p.locator("#dsSkip").count(), 0, "no tutorial the second time");
    await p.tap("#dsHow"); await p.waitForSelector("#dsSkip"); assert.match(await p.locator(".ds-h").innerText(), /Sell what/); await p.tap("#dsSkip"); await p.waitForSelector("#dpZone"); assert.equal(await p.locator(".ds-h").innerText(), "Show what you're making");
    await p.tap("#dpNext"); await p.waitForSelector("[data-n]"); assert.match(await visText(), /Example: a baker/, "no items yet: the example"); await p.fill("[data-n]", "Coconut buns"); await p.waitForFunction(() => /Coconut buns/.test(document.querySelector("#dsVis")?.innerText || "") && !/Example/.test(document.querySelector("#dsVis")?.innerText || ""));
    await p.tap("#dpBack"); await p.waitForSelector("#dpZone"); await p.tap("#dpBack"); await p.waitForSelector("#dpSheet", { state: "detached" });
    // ---- editing: compact, steps as tabs, Save is the primary; the weekly toggle is saved ----
    await p.evaluate((x) => window.EncoreDrop.setup({ drop: x }), d); await p.waitForSelector("#dpSave"); r = await screen("edit photos", { visual: false, head: false });
    assert.equal(await p.locator("#dpSheet .ds-h, #dpSheet .ds-sub, #dpSheet .ds-vis, #dpSheet .ds-potto").count(), 0, "no teaching copy when editing"); assert.equal(await p.locator("#dpSheet .ds-go").innerText(), "Save"); assert.deepEqual(await p.locator('#dpSheet [role="tab"]').allInnerTexts(), ["Photos", "Items", "Pickup", "Payment"]);
    await p.tap('[data-tab="2"]'); await p.waitForSelector("[data-n]"); assert.equal(await p.locator("[data-n]").first().inputValue(), "Pandan honeycomb cake"); await screen("edit items", { visual: false, head: false });
    await p.tap('[data-tab="3"]'); await p.waitForSelector("#dpArea"); await screen("edit pickup", { visual: false, head: false }); await p.tap('#dpSheet [data-tog="weekly"]'); assert.equal(await p.locator("[data-wd]").count(), 2);
    await p.tap('[data-tab="4"]'); await p.waitForSelector("#dpTitle"); await screen("edit payment", { visual: false, head: false }); await p.tap('#dpSheet [data-tog="pickup"]'); assert.equal(await p.locator("#dpSheet .ds-go").innerText(), "Save");
    await p.tap("#dpSave"); await p.waitForSelector("#dpSheet", { state: "detached" }); const d2 = (await getJ("/api/host/drops", { cookie })).drops[0]; assert.equal(d2.pay, "pickup"); assert.equal(d2.always, true, "every week was saved"); assert.equal(d2.items.length, 2);
    // ---- something to book: two steps in the same format ----
    await p.evaluate(() => window.EncoreDrop.bookable({})); await p.waitForSelector("#bkName"); r = await screen("book 1"); assert.equal(r.hText, "What can teams book?"); assert.match(await visText(), /Example[\s\S]*Pottery class for your team/);
    await p.tap("#bkNext"); assert.match(await p.locator("#dpErr").innerText(), /Say what it is\./); await p.fill("#bkName", "Dumpling class"); await p.fill("#bkPrice", "40"); await p.waitForFunction(() => /Dumpling class[\s\S]*From \$40 a person/.test(document.querySelector("#dsVis")?.innerText || "") && !/Example/.test(document.querySelector("#dsVis")?.innerText || ""));
    await p.tap("#bkNext"); await p.waitForSelector("#bkMin"); r = await screen("book 2"); assert.match(await visText(), /A team of[\s\S]*12[\s\S]*Your quote starts at \$480/); await p.tap('[data-team="1"]'); assert.match(await visText(), /13[\s\S]*\$520/);
    assert.equal(await p.locator("#bkSave").innerText(), "Add it to my page"); await p.tap("#bkSave"); await p.waitForSelector("#dpSheet", { state: "detached" });
    const X = (await getJ("/api/host/profile", { cookie })).host.experiences; assert.equal(X.length, 1); assert.equal(X[0].name, "Dumpling class"); assert.equal(String(X[0].price), "40"); assert.equal(X[0].min, 8); assert.equal(X[0].max, 20);
    assert.deepEqual(errs.filter((e) => !/favicon|net::ERR/.test(e)), [], "console clean, no failed requests");
    await ctx.close();
  } finally { await br.close(); }
});

test("at 1280 with reduced motion: a centred card, keyboard reachable, the visuals still say what they mean", async (t) => {
  const req = createRequire(import.meta.url); let pw; try { pw = req("playwright"); } catch { return t.skip("no playwright"); }
  let br; try { br = await pw.chromium.launch(); } catch { return t.skip("no browser"); }
  try { const ctx = await br.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" }); const [k, ...v] = noor.split("="); await ctx.addCookies([{ name: k, value: v.join("="), url: srv.base }]); await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (x) => x.fulfill({ status: 200, body: "" }));
    const p = await ctx.newPage(); await p.goto(srv.base + "/?app=1", { waitUntil: "load" }); await p.waitForFunction(() => window.EncoreDrop);
    await p.evaluate(() => window.EncoreDrop.choose({})); await p.waitForSelector("#dsStart");
    const b = await p.locator("#dpSheet .ds").boundingBox(); assert.ok(b.width <= 520 && b.x > 300 && b.y >= 0 && b.y + b.height <= 800, "a centred card that fits");
    assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector("#dpSheet .ds-pane")).animationName), "none"); assert.match(await p.locator("#dsVis").innerText(), /Dumpling night[\s\S]*Lan is in[\s\S]*4 more are in/, "still, and all there");
    assert.equal(await p.evaluate(() => [...document.querySelectorAll("#dsVis .ds-seq > *")].every((e) => getComputedStyle(e).opacity === "1")), true);
    // the keyboard: arrows move the choice, Tab reaches Start, Enter starts, Escape closes
    await p.focus('#dpSheet [data-tog="event"]'); await p.keyboard.press("ArrowRight"); await p.waitForFunction(() => document.activeElement?.dataset?.tog === "drop"); assert.match(await p.locator("#dsVis").innerText(), /Pandan this Saturday/);
    const ring = await p.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle + " " + s.outlineWidth; }); assert.match(ring, /solid 3px/, "a visible focus ring");
    await p.keyboard.press("Tab"); assert.equal(await p.evaluate(() => document.activeElement?.id), "dsStart"); await p.keyboard.press("Enter"); await p.waitForSelector("#dpZone"); // Noor has seen the tutorial
    assert.equal(await p.locator("#dpSheet [role=dialog]").getAttribute("aria-label"), "Set up a drop"); for (const sel of ["#dpZoneIn", "#dpCamIn"]) assert.ok(await p.locator(sel).getAttribute("aria-label"));
    await p.click("#dpNext"); await p.waitForSelector("[data-n]"); const unl = await p.evaluate(() => [...document.querySelectorAll("#dpSheet input:not([type=file]),#dpSheet select,#dpSheet textarea")].filter((e) => !e.labels?.length && !e.getAttribute("aria-label")).length); assert.equal(unl, 0, "every field is labelled");
    assert.equal(await p.evaluate(() => [...document.querySelectorAll("#dpSheet button")].filter((e) => e.offsetParent && !(e.textContent.trim() || e.getAttribute("aria-label"))).length), 0, "every button has a name");
    await p.keyboard.press("Escape"); await p.waitForSelector("#dpSheet", { state: "detached" }); await ctx.close();
  } finally { await br.close(); }
});
