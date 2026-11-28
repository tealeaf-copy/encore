// Event effects (public/effects.js): the server keeps only listed effect ids and a Subtle / Lively level, removed ids are
// saved and drawn as the effect that replaced them, older vibe ids keep working, the canvas's Effect tray applies a choice
// at once and puts back what was there on Cancel, and the guest invites draw the stored effect at the stored level.
// An effect lives in the cover: never over the title, the words, a button, a field, the logo or the host-only panel.
// Something shows within 300ms, less motion gets a still frame, and nothing is drawn while the page is hidden.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { LOOK, cleanLook, withCleanLook } from "../server/looks.js";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const plain = (v) => JSON.parse(JSON.stringify(v));
const load = (files) => { const window = { devicePixelRatio: 1 }; const ctx = { window, console, document: undefined };
  for (const f of files) vm.runInNewContext(read("public/" + f), ctx); return window; };
const KEPT = ["paper", "twinkle", "bulbs", "sparkles", "confetti", "dice", "petals", "snow", "leaves", "rain", "steam", "bubbles"];
const GONE = { stars: "sparkles", streamers: "confetti", balloons: "confetti" };

test("the server keeps listed effects and a lively level only; removed ids are saved as the one that replaced them; older ids still pass", () => {
  for (const fx of KEPT) assert.deepEqual(cleanLook({ effect: fx }), { effect: fx }, fx);
  for (const [old, now] of Object.entries(GONE)) { assert.deepEqual(cleanLook({ effect: old }), { effect: now }, old + " is saved as " + now); assert.ok(!LOOK.effects.includes(old), old + " is off the list"); assert.ok(LOOK.effects.includes(now)); }
  assert.deepEqual(cleanLook({ effect: "balloons", effectLevel: "lively" }), { effect: "confetti", effectLevel: "lively" });
  assert.deepEqual(plain(LOOK.effectAlias), GONE);
  for (const fx of ["velvet", "lanterns", "scanlines", "pixels", "jarwall"]) assert.deepEqual(cleanLook({ effect: fx }), { effect: fx }, "old id " + fx);
  for (const fx of ["fireworks", "<script>", "Confetti", "", 7, null, "constructor", "__proto__", ["stars"]]) assert.deepEqual(cleanLook({ effect: fx }), {}, String(fx));
  assert.deepEqual(cleanLook({ effect: "petals", effectLevel: "lively" }), { effect: "petals", effectLevel: "lively" });
  assert.deepEqual(cleanLook({ effect: "petals", effectLevel: "subtle" }), { effect: "petals" }, "subtle is the default, not stored");
  assert.deepEqual(cleanLook({ effect: "petals", effectLevel: "wild" }), { effect: "petals" });
  assert.deepEqual(cleanLook({ effect: "none", effectLevel: "lively" }), { effect: "none" }, "no level without an effect");
  assert.deepEqual(cleanLook({ effectLevel: "lively" }), {});
  assert.deepEqual(withCleanLook({ name: "x", look: { effect: "steam", effectLevel: "lively", extra: 1 } }), { name: "x", look: { effect: "steam", effectLevel: "lively" } });
  assert.deepEqual(LOOK.effectLevels, ["subtle", "lively"]);
});

test("one list: effects.js draws every id the server allows, the canvas offers 12 in four groups and no removed one, calm counts", () => {
  const FX = load(["effects.js"]).EncoreEffects;
  assert.deepEqual([...FX.IDS, ...FX.LEGACY].sort(), [...LOOK.effects].sort(), "drawn here or by looks.js effect()");
  assert.deepEqual([...FX.IDS].sort(), ["none", ...KEPT].sort()); assert.deepEqual(plain(FX.ALIAS), GONE, "the same map as the server");
  for (const [old, now] of Object.entries(GONE)) assert.equal(FX.idOf(old), now); assert.equal(FX.idOf("petals"), "petals"); assert.equal(FX.idOf(undefined), "none");
  const require = createRequire(import.meta.url); require("../public/sections.js"); require("../public/canvas.js"); const C = globalThis.EventCanvas;
  const offered = C.EFFECTS.map((x) => x[0]);
  assert.equal(offered[0], "none"); assert.deepEqual(offered.slice(1).sort(), [...KEPT].sort(), "twelve effects and None, each one drawn");
  for (const k of offered) assert.ok(LOOK.effects.includes(k), k);
  assert.deepEqual(C.FX_GROUPS, ["Quiet", "Party", "Seasonal", "Food and drink"]); for (const x of C.EFFECTS) assert.ok(C.FX_GROUPS.includes(x[3]), x[0]);
  for (const x of C.EFFECTS) { assert.doesNotMatch(x[1] + x[2], /—|–/, "no dashes"); assert.ok(x[2].length > 8 && x[2].length < 70, "a short line that says what it does: " + x[0]); }
  assert.equal(C.effectName({ look: { effect: "twinkle" } }), "Candlelight"); assert.match(C.EFFECTS.find((x) => x[0] === "twinkle")[2], /cover/i, "says where the light is");
  assert.equal(C.effectOf({ look: { effect: "lanterns" } }), "lanterns", "an old vibe effect stays as it is"); assert.equal(C.effectName({ look: { effect: "lanterns" } }), "Lanterns");
  for (const [old, now] of Object.entries(GONE)) assert.equal(C.effectOf({ look: { effect: old } }), now, "an event with " + old + " shows " + now);
  assert.equal(C.effectName({ look: { effect: "stars" } }), "Sparkles"); assert.equal(C.effectLevel({ look: { effect: "balloons", effectLevel: "lively" } }), "lively");
  assert.equal(C.effectOf({ look: { effect: "lava" } }), "none"); assert.equal(C.effectName({ look: { effect: "bulbs" } }), "String lights");
  assert.equal(C.effectLevel({ look: { effect: "snow", effectLevel: "lively" } }), "lively"); assert.equal(C.effectLevel({ look: { effectLevel: "lively" } }), "subtle");
  // looks.js (Make it yours) offers the same ids, so no chip is a dead one
  const LKsrc = read("public/looks.js"); for (const old of Object.keys(GONE)) assert.doesNotMatch(LKsrc.slice(0, LKsrc.indexOf("const FONTS")), new RegExp('"' + old + '"'), "looks.js does not offer " + old);
  for (const id of FX.IDS) for (const [w, h] of [[358, 224], [568, 355], [390, 844], [2560, 1440]]) for (const lv of FX.LEVELS) assert.ok(FX.countFor(id, w, h, lv) <= 56, id);
  assert.ok(FX.countFor("petals", 568, 355, "lively") > FX.countFor("petals", 568, 355, "subtle"), "lively has more");
  assert.ok(FX.countFor("snow", 358, 224) < FX.countFor("snow", 568, 355), "fewer in a phone's cover");
  assert.equal(FX.countFor("stars", 568, 355), FX.countFor("sparkles", 568, 355), "a removed id counts as its replacement");
  const src = read("public/effects.js");
  assert.match(src, /requestAnimationFrame/); assert.match(src, /visibilitychange/); assert.match(src, /IntersectionObserver/); assert.match(src, /prefers-reduced-motion: reduce/); assert.match(src, /prefers-reduced-transparency: reduce/);
  assert.doesNotMatch(src, /shadowBlur|\.filter\s*=/, "glows are stamped sprites, no blur per frame"); assert.doesNotMatch(src.replace(/xmlns=.http:\/\/www\.w3\.org\/2000\/svg./g, ""), /https?:\/\//, "no outside assets");
  assert.ok(Buffer.byteLength(src) < 33000, "effects.js stays lean: " + Buffer.byteLength(src));
  assert.ok(read("public/invite.html").length < 40000, "the light invite stays under 40,000 characters");
  assert.doesNotMatch(read("public/invite.html"), /effects\.js/, "loaded by looks.js only when an event has an effect");
});

let srv;
before(async () => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "effects-test-secret-0123"; process.env.ENCORE_FAKE_EMAIL = "1"; resetLoginLimits(); srv = await startServer(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv?.close(); });
function playwright() { const require = createRequire(import.meta.url); try { return require("playwright"); } catch {} try { return require(path.join(process.execPath, "../../lib/node_modules/playwright")); } catch { return null; } }
const J = { "content-type": "application/json" }, day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
let cookie = "";
async function host() { if (cookie) return cookie; const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name: "Rosa Diaz", email: "rosa.fx@example.com", password: "long-password-1", mode: "friends" }) }); return (cookie = r.headers.get("set-cookie").split(";")[0]); }
const put = async (id, look) => fetch(srv.base + "/api/db/doc?path=events/" + id, { method: "PUT", headers: { ...J, cookie: await host() }, body: JSON.stringify({ kind: "social", casual: true, published: true, name: "Supper club", activity: "dinner", hostName: "Rosa", date: day(4), startTime: "19:00", venueName: "My place", headcount: 8, why: "Bring a bottle and an appetite. We eat at eight, and the door is open from seven.", look }) });

// in the page: how many pixels the effect's canvas has painted, and every place an effect layer overlaps something it must not
const painted = () => { const c = document.querySelector(".fxe-layer canvas"); if (!c || !c.width) return 0; const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 8) n++; return n; };
const overlaps = (sel) => { const out = [], layers = [...document.querySelectorAll(".fxe-layer:not(.fxe-back)")].map((L) => [L, L.getBoundingClientRect()]).filter(([, r]) => r.width > 0);
  // hit-test with the layers made tappable for a moment: a hit-test follows the layer's real shape (its cut-outs around words on the cover)
  for (const [L] of layers) L.style.pointerEvents = "auto"; const hit = (L, x, y) => document.elementsFromPoint(x, y).includes(L);
  for (const el of document.querySelectorAll(sel)) { if (el.closest(".fxe-layer")) continue; const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2 || getComputedStyle(el).visibility === "hidden") continue;
    // sample points: the middle, and a little in from each corner
    const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 2, r.top + 2], [r.right - 2, r.top + 2], [r.left + 2, r.bottom - 2], [r.right - 2, r.bottom - 2]];
    for (const [L] of layers) { if (!pts.some(([x, y]) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight && hit(L, x, y))) continue;
      // a control that sits in the cover (the canvas's Cover button) is fine when it is stacked above the layer on a solid ground
      const cs = getComputedStyle(el), solid = /rgba?\((\d+), (\d+), (\d+)(?:, (0?\.9\d*|1))?\)/.test(cs.backgroundColor) && cs.backgroundColor !== "rgba(0, 0, 0, 0)";
      if (L.parentElement.contains(el) && +cs.zIndex > +getComputedStyle(L).zIndex && solid) continue;
      out.push((el.id || el.className || el.tagName) + " under " + L.className); } }
  for (const [L] of layers) L.style.pointerEvents = ""; return out; };
const TEXT = "h1, h2, h3, p, li, label, small, button, a[href], input, select, textarea, .brand, .kicker, .facts, .why";

test("in a browser: guests see the stored effect in the cover, a removed id draws its replacement, less motion is a still frame, and the canvas tray applies and reverts", async (t) => {
  const pw = playwright(); if (!pw) return t.skip("no playwright"); let br; try { br = await pw.chromium.launch(); } catch { return t.skip("no browser"); }
  const c = await host();
  assert.equal((await put("fxpetals", { effect: "petals", effectLevel: "lively", palette: ["#F3E8E6", "#3A2A30", "#8C5A55"] })).status, 200);
  assert.equal((await put("fxbogus", { effect: "disco", effectLevel: "lively" })).status, 200);
  assert.equal((await put("fxstars", { effect: "stars" })).status, 200);
  assert.equal((await (await fetch(srv.base + "/api/db/doc?path=events/fxstars", { headers: { "x-encore-guest": "1" } })).json()).data.look.effect, "sparkles", "stars is saved as sparkles");
  try {
    // the guest invites draw what was saved, at the saved level, inside the cover and never in the way of a tap
    const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.route(/fonts\.(googleapis|gstatic)\.com/, (x) => x.abort());
    for (const url of ["/e/fxpetals", "/g#rsvp-fxpetals"]) { await p.goto(srv.base + url, { waitUntil: "load" }); await p.waitForFunction(() => document.querySelector(".fxe-layer canvas")?.width > 1, null, { timeout: 8000 });
      const m = await p.evaluate(() => { const L = document.querySelector(".fxe-layer"), cov = L.parentElement, a = L.getBoundingClientRect(), b = cov.getBoundingClientRect(); return { id: L.dataset.effect, level: L.dataset.level, pe: getComputedStyle(L).pointerEvents, hidden: L.getAttribute("aria-hidden"), run: window.EncoreEffects.running(), inCover: cov.matches("#m .cov, .gxcover"), fits: a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1 && a.width > 100, layers: document.querySelectorAll(".fxe-layer").length }; });
      assert.deepEqual(m, { id: "petals", level: "lively", pe: "none", hidden: "true", run: 1, inCover: true, fits: true, layers: 1 }, url);
      await p.waitForTimeout(url[1] === "g" ? 1600 : 400); /* the full invite opens behind a short splash of its own */ assert.ok(await p.evaluate(painted) > 20, url + " petals are drawn"); assert.deepEqual(await p.evaluate(overlaps, TEXT), [], url + " nothing over words or controls"); }
    await p.goto(srv.base + "/e/fxbogus", { waitUntil: "load" }); await p.waitForTimeout(1200);
    assert.equal(await p.evaluate(() => !!document.querySelector(".fxe-layer")), false, "an effect off the list was dropped on save");
    await p.goto(srv.base + "/e/fxstars", { waitUntil: "load" }); await p.waitForFunction(() => document.querySelector(".fxe-layer canvas"), null, { timeout: 8000 });
    assert.equal(await p.evaluate(() => document.querySelector(".fxe-layer").dataset.effect), "sparkles", "an event that had stars draws sparkles");
    assert.deepEqual(errs, []); await ctx.close();

    // less motion: drawn once and left still; confetti, which is all motion, is left out
    const rm = await br.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" }); const q = await rm.newPage();
    await q.goto(srv.base + "/e/fxpetals", { waitUntil: "load" }); await q.waitForFunction(() => document.querySelector(".fxe-layer canvas")?.width > 1, null, { timeout: 8000 }); await q.waitForTimeout(300);
    const snap = () => q.evaluate(() => document.querySelector(".fxe-layer canvas").toDataURL());
    const a = await snap(); await q.waitForTimeout(700); const b = await snap();
    assert.equal(a, b, "a still frame"); assert.ok(a.length > 3000, "with something drawn on it"); assert.equal(await q.evaluate(() => window.EncoreEffects.running()), 0, "no animation loop");
    for (const id of ["confetti", "rain"]) { await q.evaluate((id) => { window.EncoreEffects.again(document.body); window.EncoreEffects.mount(document.body, { effect: id }); }, id); await q.waitForTimeout(200); assert.equal(await q.evaluate(() => document.querySelectorAll(".fxe-layer").length), 0, id + " is left out for less motion"); }
    await q.evaluate(() => { window.EncoreEffects.again(document.body); window.EncoreEffects.mount(document.body, { effect: "twinkle" }); }); await q.waitForTimeout(300);
    assert.equal(await q.evaluate(() => getComputedStyle(document.querySelector(".fxe-back")).animationName), "none", "the glow behind the page holds still"); const g1 = await snap(); await q.waitForTimeout(500); assert.equal(g1, await snap(), "candlelight holds still");
    await rm.close();

    // the canvas: tap an effect and it is in the cover at once; Cancel puts back what was there; Done keeps it
    const hc = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const [k, ...v] = c.split("="); await hc.addCookies([{ name: k, value: v.join("="), url: srv.base }]);
    const h = await hc.newPage(); await h.route(/fonts\.(googleapis|gstatic)\.com/, (x) => x.abort());
    await h.goto(srv.base + "/?app=1", { waitUntil: "load" }); await h.waitForFunction(() => window.EventCanvas?.open, null, { timeout: 15000 });
    await h.waitForTimeout(1500); await h.evaluate(() => document.querySelectorAll(".hl-sheet-bg").forEach((x) => x.remove())); // a first-event note from the host loop
    await h.evaluate(() => window.EventCanvas.open({ mode: "new" })); await h.waitForSelector("#cv .cv-dock [data-cv=effect]");
    const dock = (x) => h.getAttribute(`#cv .cv-dock [data-cv=${x}]`, "aria-label"), layer = () => h.evaluate(() => document.querySelector("#cv .fxe-layer")?.dataset.effect || "");
    assert.equal(await dock("effect"), "Effect: None"); assert.equal(await dock("look"), "Look: House");
    await h.click("#cv .cv-dock [data-cv=effect]"); await h.waitForSelector(".cv-sh.cv-tray [data-fx=steam]");
    const tray = await h.evaluate(() => { const t = document.querySelector(".cv-sh.cv-tray").getBoundingClientRect(); return { h: t.height, modal: document.querySelector(".cv-sh.cv-tray").getAttribute("aria-modal"), tiles: [...document.querySelectorAll(".cv-tray [data-fx]")].map((b) => b.dataset.fx) }; });
    assert.ok(tray.h <= 844 * 0.4, "about a third of the phone: " + tray.h); assert.equal(tray.modal, "false", "the invite behind stays live");
    assert.deepEqual(tray.tiles.sort(), ["none", ...KEPT].sort(), "no removed effect is offered");
    // every tile is a live picture: each canvas has something on it within half a second
    await h.waitForFunction(() => document.querySelectorAll(".cv-tray canvas[data-fxt]").length >= 13 && window.EncoreEffects, null, { timeout: 8000 }); await h.waitForTimeout(500);
    const blank = await h.evaluate(() => [...document.querySelectorAll(".cv-tray canvas[data-fxt]")].filter((c) => c.dataset.fxt !== "none").filter((c) => { if (!c.width) return true; const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return false; return true; }).map((c) => c.dataset.fxt));
    assert.deepEqual(blank, [], "a moving picture on every tile");
    await h.click(".cv-sh.cv-tray [data-fx=steam]"); await h.waitForFunction(() => document.querySelector("#cvCover > .fxe-layer canvas")?.width > 1, null, { timeout: 8000 });
    assert.equal(await layer(), "steam", "in the cover before any Save"); assert.equal(await dock("effect"), "Effect: Steam");
    assert.ok(await h.evaluate(() => { const a = document.querySelector("#cvCover").getBoundingClientRect(), b = document.querySelector("#cvScroll").getBoundingClientRect(); return a.top >= b.top - 2 && a.top < b.bottom; }), "the cover is brought into view above the tray");
    await h.click(".cv-sh.cv-tray [data-lvl=lively]"); await h.waitForTimeout(100); assert.equal(await h.evaluate(() => document.querySelector("#cv .fxe-layer")?.dataset.level), "lively");
    await h.click(".cv-sh.cv-tray [data-x]"); await h.waitForTimeout(200);
    assert.equal(await layer(), "", "Cancel puts back no effect"); assert.equal(await dock("effect"), "Effect: None"); assert.equal(await h.evaluate(() => !!document.querySelector(".cv-tray")), false);
    assert.equal(await h.evaluate(() => JSON.stringify(window.EventCanvas.state().W.look || {})), "{}");
    await h.click("#cv .cv-dock [data-cv=effect]"); await h.click(".cv-sh.cv-tray [data-fx=bulbs]"); await h.click(".cv-sh.cv-tray [data-done]"); await h.waitForTimeout(200);
    assert.equal(await layer(), "bulbs", "Done keeps it"); assert.equal(await dock("effect"), "Effect: String lights");
    // in the editor an effect is only in the cover: never over the editor's own words and buttons, never over the host-only panel
    const ed = await h.evaluate(() => { const L = [...document.querySelectorAll("#cv .fxe-layer")]; const hp = document.querySelector("#cv .cv-host"), cs = getComputedStyle(hp); return { n: L.length, inCover: L.every((x) => x.parentElement.id === "cvCover"), back: !!document.querySelector(".fxe-back"), bg: cs.backgroundColor, img: cs.backgroundImage, tag: hp.querySelector(".cv-tag").textContent.trim() }; });
    assert.equal(ed.n, 1); assert.ok(ed.inCover, "the layer is inside the cover"); assert.equal(ed.back, false, "no layer behind the editor"); assert.equal(ed.tag, "Only you see this part");
    assert.match(ed.bg, /^rgb\(\d+, \d+, \d+\)$/, "the host-only panel sits on a solid surface: " + ed.bg); assert.equal(ed.img, "none");
    for (const y of [0, 0.5, 1]) { await h.evaluate((y) => { const sc = document.querySelector("#cvScroll"); sc.scrollTop = (sc.scrollHeight - sc.clientHeight) * y; }, y); await h.waitForTimeout(120);
      assert.deepEqual(await h.evaluate(overlaps, "#cv h1, #cv h2, #cv h3, #cv p, #cv label, #cv small, #cv button, #cv a[href], #cv input, #cv select, #cv textarea, #cv .cv-host, #cv .cv-host *, #cv .cv-tag, #cv .cv-reply"), [], "scrolled " + y); }
    // confetti in the editor stays in the cover too, and is gone when it has played
    await h.evaluate(() => { const sc = document.querySelector("#cvScroll"); sc.scrollTop = 0; }); await h.click("#cv .cv-dock [data-cv=effect]"); await h.click(".cv-sh.cv-tray [data-fx=confetti]"); await h.waitForTimeout(250);
    assert.deepEqual(await h.evaluate(() => [...document.querySelectorAll(".fxe-layer")].map((L) => L.parentElement.id)), ["cvCover"], "confetti pops inside the cover"); await h.waitForTimeout(2600);
    assert.equal(await h.evaluate(() => document.querySelectorAll(".fxe-layer").length), 0, "and is gone in under 2.5 seconds"); await h.click(".cv-sh.cv-tray [data-x]"); await h.waitForTimeout(200);
    // Look: the same tray, the same revert
    await h.click("#cv .cv-dock [data-cv=look]"); await h.click('.cv-sh.cv-tray [data-pal="0"]'); await h.waitForTimeout(100);
    assert.equal(await dock("look"), "Look: Sage"); assert.equal(await h.evaluate(() => window.EventCanvas.state().W.look.palette[0]), "#DCE3D2");
    await h.keyboard.press("Escape"); await h.waitForTimeout(150);
    assert.equal(await dock("look"), "Look: House", "Escape is Cancel"); assert.deepEqual(plain(await h.evaluate(() => window.EventCanvas.state().W.look)), { effect: "bulbs" });
    await hc.close();
  } finally { await br.close(); }
});

test("in a browser: every effect shows within 300ms, stays off the words and controls, and pauses when hidden or off screen", async (t) => {
  const pw = playwright(); if (!pw) return t.skip("no playwright"); let br; try { br = await pw.chromium.launch(); } catch { return t.skip("no browser"); }
  assert.equal((await put("fxplain", {})).status, 200);
  try {
    for (const [w, hgt] of [[390, 844], [1280, 800]]) {
      const ctx = await br.newContext({ viewport: { width: w, height: hgt }, isMobile: w < 500, hasTouch: w < 500 }); const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
      await p.route(/fonts\.(googleapis|gstatic)\.com/, (x) => x.abort());
      await p.goto(srv.base + "/e/fxplain", { waitUntil: "load" }); await p.waitForSelector("#m .cov"); await p.addScriptTag({ url: "/effects.js" }); await p.waitForFunction(() => window.EncoreEffects); await p.waitForTimeout(300);
      for (const id of [...KEPT, ...Object.keys(GONE)]) { const now = GONE[id] || id;
        const at = await p.evaluate((id) => { window.EncoreEffects.again(document.body); const t0 = performance.now(); window.EncoreEffects.mount(document.body, { effect: id }); return t0; }, id);
        await p.waitForFunction((at) => performance.now() - at >= 280, at); const px = await p.evaluate(painted), m = await p.evaluate((at) => { const L = [...document.querySelectorAll(".fxe-layer")]; return { ms: performance.now() - at, ids: [...new Set(L.map((x) => x.dataset.effect))], grain: L.some((x) => getComputedStyle(x).backgroundImage !== "none"),
          back: L.filter((x) => x.classList.contains("fxe-back")).map((x) => ({ z: getComputedStyle(x).zIndex, canvas: !!x.querySelector("canvas"), pe: getComputedStyle(x).pointerEvents })), vp: L.filter((x) => x.classList.contains("fxe-vp")).length }; }, at); m.px = px;
        assert.deepEqual(m.ids, [now], id + " draws " + now); assert.ok(m.ms < 420, "checked early: " + m.ms);
        assert.ok(now === "paper" ? m.grain : m.px > 12, `${id} at ${w}px shows something by 300ms (${m.px} painted)`);
        // the only layer allowed across the page is confetti's, for one moment; candlelight and paper tint the background layer, behind everything, with no shapes on it
        assert.equal(m.vp, now === "confetti" ? 1 : 0, id); for (const b of m.back) assert.deepEqual(b, { z: "-1", canvas: false, pe: "none" }, id + " background layer"); assert.equal(m.back.length, now === "twinkle" || now === "paper" ? 1 : 0, id);
        if (now !== "confetti") assert.deepEqual(await p.evaluate(overlaps, TEXT), [], `${id} at ${w}px is over nothing but the cover`);
        else { await p.waitForFunction((at) => performance.now() - at >= 2500, at); assert.equal(await p.evaluate(() => document.querySelectorAll(".fxe-layer").length), 0, "confetti has cleared the page in 2.5 seconds"); assert.equal(await p.evaluate(() => window.EncoreEffects.running()), 0); } }
      assert.deepEqual(errs, []);
      if (w === 390) {
        // hidden: no frames are drawn until the page is back
        await p.evaluate(() => { window.EncoreEffects.again(document.body); window.EncoreEffects.mount(document.body, { effect: "snow" }); }); await p.waitForTimeout(400);
        const frames = () => p.evaluate(() => window.EncoreEffects.stats().frames), f0 = await frames(); await p.waitForTimeout(300); const f1 = await frames(); assert.ok(f1 > f0 + 3, "drawing while in view: " + (f1 - f0));
        await p.evaluate(() => { Object.defineProperty(document, "hidden", { get: () => true, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); }); await p.waitForTimeout(100);
        const h0 = await frames(); await p.waitForTimeout(400); assert.equal(await frames(), h0, "no frames while hidden");
        await p.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); }); await p.waitForTimeout(300); assert.ok(await frames() > h0 + 3, "and it picks up again");
        // off screen: scrolled past the cover, the drawing stops
        await p.evaluate(() => { document.body.style.minHeight = "3000px"; scrollTo(0, 1600); }); await p.waitForTimeout(400); const o0 = await frames(); await p.waitForTimeout(400); assert.equal(await frames(), o0, "no frames while the cover is off screen");
        await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(400); assert.ok(await frames() > o0 + 3, "back in view, it draws again");
        // it settles: after about 8 seconds the motion is quieter than when it opened
        await p.evaluate(() => { window.EncoreEffects.again(document.body); window.EncoreEffects.mount(document.body, { effect: "petals" }); }); await p.waitForTimeout(600); const q0 = await p.evaluate(() => window.EncoreEffects.peek()[0]);
        assert.equal(q0.q, 1); assert.ok(q0.boost > 1, "a quick start"); await p.waitForTimeout(11500); const q1 = await p.evaluate(() => window.EncoreEffects.peek()[0]); assert.ok(q1.q < 0.6 && q1.boost === 1, "quieter after 8 seconds: " + JSON.stringify(q1));
      }
      await ctx.close(); }
  } finally { await br.close(); }
});
