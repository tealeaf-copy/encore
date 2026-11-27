// Event effects (public/effects.js): the server keeps only listed effect ids and a Subtle / Lively level, older ids keep
// working, the canvas's Effect tray applies a choice at once and puts back what was there on Cancel, the guest invites
// draw the stored effect at the stored level, and people who prefer less motion get a still frame.
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

test("the server keeps listed effects and a lively level only; older ids still pass", () => {
  for (const fx of ["confetti", "streamers", "balloons", "bulbs", "dice", "petals", "snow", "leaves", "rain", "steam", "bubbles", "stars", "twinkle", "sparkles", "paper"]) assert.deepEqual(cleanLook({ effect: fx }), { effect: fx }, fx);
  for (const fx of ["velvet", "lanterns", "scanlines", "pixels", "jarwall"]) assert.deepEqual(cleanLook({ effect: fx }), { effect: fx }, "old id " + fx);
  for (const fx of ["fireworks", "<script>", "Confetti", "", 7, null]) assert.deepEqual(cleanLook({ effect: fx }), {}, String(fx));
  assert.deepEqual(cleanLook({ effect: "petals", effectLevel: "lively" }), { effect: "petals", effectLevel: "lively" });
  assert.deepEqual(cleanLook({ effect: "petals", effectLevel: "subtle" }), { effect: "petals" }, "subtle is the default, not stored");
  assert.deepEqual(cleanLook({ effect: "petals", effectLevel: "wild" }), { effect: "petals" });
  assert.deepEqual(cleanLook({ effect: "none", effectLevel: "lively" }), { effect: "none" }, "no level without an effect");
  assert.deepEqual(cleanLook({ effectLevel: "lively" }), {});
  assert.deepEqual(withCleanLook({ name: "x", look: { effect: "steam", effectLevel: "lively", extra: 1 } }), { name: "x", look: { effect: "steam", effectLevel: "lively" } });
  assert.deepEqual(LOOK.effectLevels, ["subtle", "lively"]);
});

test("one list: effects.js draws every id the server allows, the canvas offers 15 in four groups, calm counts", () => {
  const FX = load(["effects.js"]).EncoreEffects;
  assert.deepEqual([...FX.IDS, ...FX.LEGACY].sort(), [...LOOK.effects].sort(), "drawn here or by looks.js effect()");
  const require = createRequire(import.meta.url); require("../public/sections.js"); require("../public/canvas.js"); const C = globalThis.EventCanvas;
  const offered = C.EFFECTS.map((x) => x[0]);
  assert.equal(offered[0], "none"); assert.equal(offered.length - 1, 15, "fifteen effects and None");
  for (const k of offered) assert.ok(LOOK.effects.includes(k), k);
  assert.deepEqual(C.FX_GROUPS, ["Quiet", "Party", "Seasonal", "Food and drink"]); for (const x of C.EFFECTS) assert.ok(C.FX_GROUPS.includes(x[3]), x[0]);
  for (const x of C.EFFECTS) assert.doesNotMatch(x[1] + x[2], /\u2014/, "no em dashes");
  assert.equal(C.effectOf({ look: { effect: "lanterns" } }), "lanterns", "an old effect stays as it is"); assert.equal(C.effectName({ look: { effect: "lanterns" } }), "Lanterns");
  assert.equal(C.effectOf({ look: { effect: "lava" } }), "none"); assert.equal(C.effectName({ look: { effect: "bulbs" } }), "String lights");
  assert.equal(C.effectLevel({ look: { effect: "snow", effectLevel: "lively" } }), "lively"); assert.equal(C.effectLevel({ look: { effectLevel: "lively" } }), "subtle");
  for (const id of FX.IDS) for (const [w, h] of [[390, 844], [1280, 800], [2560, 1440]]) for (const lv of FX.LEVELS) assert.ok(FX.countFor(id, w, h, lv) <= 40, id);
  assert.ok(FX.countFor("confetti", 1280, 800, "lively") > FX.countFor("confetti", 1280, 800, "subtle"), "lively has more");
  assert.ok(FX.countFor("snow", 390, 844) < FX.countFor("snow", 1280, 800), "fewer on a phone");
  const src = read("public/effects.js");
  assert.match(src, /requestAnimationFrame/); assert.match(src, /visibilitychange/); assert.match(src, /IntersectionObserver/); assert.match(src, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(src, /shadowBlur/, "glows are stamped sprites"); assert.doesNotMatch(src.replace(/xmlns=.http:\/\/www\.w3\.org\/2000\/svg./g, ""), /https?:\/\//, "no outside assets");
  assert.ok(read("public/invite.html").length < 40000, "the light invite stays under 40,000 characters");
  assert.doesNotMatch(read("public/invite.html"), /effects\.js/, "loaded by looks.js only when an event has an effect");
});

let srv;
before(async () => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "effects-test-secret-0123"; process.env.ENCORE_FAKE_EMAIL = "1"; resetLoginLimits(); srv = await startServer(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv?.close(); });
function playwright() { const require = createRequire(import.meta.url); try { return require("playwright"); } catch {} try { return require(path.join(process.execPath, "../../lib/node_modules/playwright")); } catch { return null; } }

test("in a browser: guests see the stored effect, a still frame with less motion, and the canvas tray applies and reverts", async (t) => {
  const pw = playwright(); if (!pw) return t.skip("no playwright"); let br; try { br = await pw.chromium.launch(); } catch { return t.skip("no browser"); }
  const J = { "content-type": "application/json" }, day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name: "Rosa Diaz", email: "rosa.fx@example.com", password: "long-password-1", mode: "friends" }) }), c = r.headers.get("set-cookie").split(";")[0];
  const put = (id, look) => fetch(srv.base + "/api/db/doc?path=events/" + id, { method: "PUT", headers: { ...J, cookie: c }, body: JSON.stringify({ kind: "social", casual: true, published: true, name: "Supper club", activity: "dinner", hostName: "Rosa", date: day(4), startTime: "19:00", venueName: "My place", headcount: 8, look }) });
  assert.equal((await put("fxpetals", { effect: "petals", effectLevel: "lively", palette: ["#F3E8E6", "#3A2A30", "#8C5A55"] })).status, 200);
  assert.equal((await put("fxbogus", { effect: "disco", effectLevel: "lively" })).status, 200);
  try {
    // the guest invites draw what was saved, at the saved level, over the page and never in the way of a tap
    const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.route(/fonts\.(googleapis|gstatic)\.com/, (x) => x.abort());
    for (const url of ["/e/fxpetals", "/g#rsvp-fxpetals"]) { await p.goto(srv.base + url, { waitUntil: "load" }); await p.waitForFunction(() => document.querySelector(".fxe-layer canvas"), null, { timeout: 8000 });
      const m = await p.evaluate(() => { const L = document.querySelector(".fxe-layer"); return { id: L.dataset.effect, level: L.dataset.level, pe: getComputedStyle(L).pointerEvents, hidden: L.getAttribute("aria-hidden"), run: window.EncoreEffects.running() }; });
      assert.deepEqual(m, { id: "petals", level: "lively", pe: "none", hidden: "true", run: 1 }, url); }
    await p.goto(srv.base + "/e/fxbogus", { waitUntil: "load" }); await p.waitForTimeout(1200);
    assert.equal(await p.evaluate(() => !!document.querySelector(".fxe-layer")), false, "an effect off the list was dropped on save");
    assert.deepEqual(errs, []); await ctx.close();

    // less motion: drawn once and left still
    const rm = await br.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" }); const q = await rm.newPage();
    await q.goto(srv.base + "/e/fxpetals", { waitUntil: "load" }); await q.waitForFunction(() => document.querySelector(".fxe-layer canvas"), null, { timeout: 8000 }); await q.waitForTimeout(300);
    const snap = () => q.evaluate(() => document.querySelector(".fxe-layer canvas").toDataURL());
    const a = await snap(); await q.waitForTimeout(700); const b = await snap();
    assert.equal(a, b, "a still frame"); assert.ok(a.length > 3000, "with something drawn on it"); assert.equal(await q.evaluate(() => window.EncoreEffects.running()), 0, "no animation loop");
    await rm.close();

    // the canvas: tap an effect and it is on the page at once; Cancel puts back what was there; Done keeps it
    const hc = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const [k, ...v] = c.split("="); await hc.addCookies([{ name: k, value: v.join("="), url: srv.base }]);
    const h = await hc.newPage(); await h.route(/fonts\.(googleapis|gstatic)\.com/, (x) => x.abort());
    await h.goto(srv.base + "/?app=1", { waitUntil: "load" }); await h.waitForFunction(() => window.EventCanvas?.open, null, { timeout: 15000 });
    await h.waitForTimeout(1500); await h.evaluate(() => document.querySelectorAll(".hl-sheet-bg").forEach((x) => x.remove())); // a first-event note from the host loop
    await h.evaluate(() => window.EventCanvas.open({ mode: "new" })); await h.waitForSelector("#cv .cv-dock [data-cv=effect]");
    const dock = (x) => h.getAttribute(`#cv .cv-dock [data-cv=${x}]`, "aria-label"), layer = () => h.evaluate(() => document.querySelector("#cvScroll > .fxe-layer")?.dataset.effect || "");
    assert.equal(await dock("effect"), "Effect: None"); assert.equal(await dock("look"), "Look: House");
    await h.click("#cv .cv-dock [data-cv=effect]"); await h.waitForSelector(".cv-sh.cv-tray [data-fx=steam]");
    const tray = await h.evaluate(() => { const t = document.querySelector(".cv-sh.cv-tray").getBoundingClientRect(); return { h: t.height, modal: document.querySelector(".cv-sh.cv-tray").getAttribute("aria-modal") }; });
    assert.ok(tray.h <= 844 * 0.4, "about a third of the phone: " + tray.h); assert.equal(tray.modal, "false", "the invite behind stays live");
    await h.waitForFunction(() => document.querySelectorAll(".cv-tray canvas[data-fxt]").length >= 15, null, { timeout: 8000 });
    await h.click(".cv-sh.cv-tray [data-fx=steam]"); await h.waitForFunction(() => document.querySelector("#cvScroll > .fxe-layer"), null, { timeout: 8000 });
    assert.equal(await layer(), "steam", "on the canvas before any Save"); assert.equal(await dock("effect"), "Effect: Steam");
    await h.click(".cv-sh.cv-tray [data-lvl=lively]"); await h.waitForTimeout(100); assert.equal(await h.evaluate(() => document.querySelector("#cvScroll > .fxe-layer")?.dataset.level), "lively");
    await h.click(".cv-sh.cv-tray [data-x]"); await h.waitForTimeout(200);
    assert.equal(await layer(), "", "Cancel puts back no effect"); assert.equal(await dock("effect"), "Effect: None"); assert.equal(await h.evaluate(() => !!document.querySelector(".cv-tray")), false);
    assert.equal(await h.evaluate(() => JSON.stringify(window.EventCanvas.state().W.look || {})), "{}");
    await h.click("#cv .cv-dock [data-cv=effect]"); await h.click(".cv-sh.cv-tray [data-fx=bulbs]"); await h.click(".cv-sh.cv-tray [data-done]"); await h.waitForTimeout(200);
    assert.equal(await layer(), "bulbs", "Done keeps it"); assert.equal(await dock("effect"), "Effect: String lights");
    // Look: the same tray, the same revert
    await h.click("#cv .cv-dock [data-cv=look]"); await h.click('.cv-sh.cv-tray [data-pal="0"]'); await h.waitForTimeout(100);
    assert.equal(await dock("look"), "Look: Sage"); assert.equal(await h.evaluate(() => window.EventCanvas.state().W.look.palette[0]), "#DCE3D2");
    await h.keyboard.press("Escape"); await h.waitForTimeout(150);
    assert.equal(await dock("look"), "Look: House", "Escape is Cancel"); assert.deepEqual(plain(await h.evaluate(() => window.EventCanvas.state().W.look)), { effect: "bulbs" });
    await hc.close();
  } finally { await br.close(); }
});
