// The playful surfaces: plush Potto (public/pottoplush.js), the home page's first screen and its code-drawn demo
// (public/home.html), the soft shapes scoped to .pl-fun (public/fun.css), and Potto on the app's Home, the chooser,
// the create canvas and /start. Source checks first; then a browser (skipped without Playwright) for what only shows
// when it runs: the reserved box, a different Potto per seed, stillness under reduced motion, the pause control.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
let srv;
before(async () => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "fun-secret-0123456789abcdef"; srv = await startServer(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET"]) delete process.env[k]; await srv.close(); });

test("the home page's first screen: Potto's box, the tagline and supporting line word for word, two pills, one demo with a labelled pause", () => {
  const home = read("public/home.html");
  assert.match(home, /<span class="fun-potto" id="heroPotto"><\/span>\s*<h1 id="heroH">Your co-host for every plan\.<\/h1>/);
  assert.match(home, /<p class="deck">Potto brainstorms the idea, finds the time that works for everyone, designs the invite, chases the replies and keeps the group going\.<\/p>/);
  const hero = home.slice(home.indexOf('<div class="hero">'), home.indexOf('<section class="sec mid" aria-labelledby="what">'));
  assert.equal((hero.match(/class="fun-pill is-primary"/g) || []).length, 1, "one primary on the first screen");
  assert.match(hero, /<a class="fun-pill is-primary" href="\/start" id="heroGo">Plan with Potto<\/a><a class="fun-pill is-quiet" href="\/feed">Explore what's on<\/a>/);
  assert.match(hero, /<figure class="fun-demo" id="demo" role="group" aria-label="A short demo with no sound\./);
  assert.match(hero, /<button type="button" class="fun-round fd-pause" id="demoPause" aria-label="Play the demo">/, "the still frame offers Play; the page flips it to Pause when the loop starts");
  assert.match(home, /btn\.setAttribute\("aria-label", on \? "Pause the demo" : "Play the demo"\)/);
  assert.match(home, /if \(!calm\) set\(true\)/, "the demo only starts by itself when motion is welcome");
  assert.match(home, /\.fun-demo\.is-paused \*,\.fun-demo\.is-off \*\{animation-play-state:paused!important\}/);
  assert.doesNotMatch(home, /<video|<audio|\.mp4|\.webm/, "drawn in code, no media files");
  assert.match(home, /<body class="home about pl-fun"/); assert.match(home, /href="\/fun\.css"/); assert.match(home, /href="\/system\.css"/);
  // the sections under it keep their words
  for (const t of ["A personal assistant for events.", "One good night takes a week.", "What it does for hosts.", "Good for everyone at the table.", "How we do things here."]) assert.ok(home.includes(t), t);
  assert.doesNotMatch(hero.replace(/<svg[\s\S]*?<\/svg>/g, ""), /—|elevate|curated|seamless|unlock|marketplace|magical/i);
});

test("soft shapes live only inside .pl-fun: every rule in fun.css is scoped, and the tokens are new ones", () => {
  const css = read("public/fun.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /\.pl-fun\{--pl-fun-r:24px;--pl-fun-r-sm:16px;--pl-fun-pill:999px/);
  const flat = css.replace(/@media[^{]*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g, "$1").replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, "");
  const sels = [...flat.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((m) => m[1].split(",")).map((s) => s.trim()).filter(Boolean);
  assert.ok(sels.length > 15);
  for (const s of sels) assert.match(s, /\.pl-fun\b/, `"${s}" is scoped to .pl-fun`);
  assert.doesNotMatch(read("public/system.css"), /--pl-fun-|\.fun-pill/, "the kit itself is unchanged");
  // the kit's corners are still 6px everywhere else
  assert.match(read("public/system.css"), /--pl-r-btn:6px/);
  // the surfaces that opt in
  assert.match(read("index.html"), /<section class="cg pl-fun" id="qsPanel"/); assert.match(read("public/start.html"), /<body class="pl-fun">/);
  assert.match(read("public/dropsetup.js"), /bg\.className = "ds-bg pl-fun"/); assert.match(read("public/canvas.js"), /class="cv-kinds cv-ed pl-fun/);
  for (const f of ["public/home.html", "public/start.html", "public/fun.css"]) assert.doesNotMatch(read(f), /fonts\.googleapis\.com\/css2\?family=(?!IBM\+Plex)/, f + " adds no new webfont");
});

test("plush Potto: eight colourways, ten or more things to wear, an outfit per event type, light and guarded", () => {
  const src = read("public/pottoplush.js");
  assert.ok(src.length < 25000, `the renderer stays light (${src.length})`);
  assert.doesNotMatch(src, /https?:\/\/(?!www\.w3\.org)|<image|url\(["']?(?!#)/, "no outside assets");
  assert.match(src, /feTurbulence/); assert.match(src, /feDisplacementMap/); assert.match(src, /feDiffuseLighting/);
  assert.match(src, /prefers-reduced-transparency: reduce/, "a flat fallback"); assert.match(src, /@media \(prefers-reduced-motion:no-preference\)\{\.plp-b\{animation:plp-bob/, "it only moves when motion is welcome");
  assert.match(src, /IntersectionObserver/, "it rests off screen");
  // run it without a browser: the pure parts
  const store = {}; const win = { location: { search: "" }, localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } } };
  new Function("window", "location", "localStorage", "matchMedia", "document", src)(win, win.location, win.localStorage, () => ({ matches: false }), { getElementById: () => ({}) });
  const P = win.PottoPlush;
  assert.ok(P.COLORS.length >= 8); for (const c of ["clay", "butter", "plum", "sky", "moss", "coral", "cream", "ink"]) assert.ok(P.COLORS.includes(c), c);
  assert.ok(P.WEAR.length >= 10); for (const w of ["glasses", "sunglasses", "bowtie", "partyhat", "chefhat", "headband", "flowercrown", "headphones", "coffee", "scarf", "book", "apron", "flower"]) assert.ok(P.WEAR.includes(w), w);
  assert.deepEqual(P.TYPES.dinner, ["chefhat"]); assert.deepEqual(P.TYPES.run, ["headband"]); assert.deepEqual(P.TYPES.book, ["glasses", "book"]); assert.deepEqual(P.TYPES.drinks, ["bowtie"]);
  assert.deepEqual(P.TYPES.party, ["partyhat"]); assert.deepEqual(P.TYPES.workshop, ["apron", "flower"]); assert.deepEqual(P.TYPES.coffee, ["coffee"]);
  for (const [text, type] of [["Taco night at mine", "dinner"], ["Saturday 5k, coffee after", "run"], ["Book club: the new Rooney", "book"], ["Drinks after work", "drinks"], ["Mai's birthday party", "party"], ["Pottery workshop", "workshop"], ["Coffee, just us", "coffee"], ["", ""]]) assert.equal(P.typeFor(text), type, text);
  // one combination per seed, and plenty of them
  const combos = new Set(Array.from({ length: 200 }, (_, i) => { const c = P.pick(i + 1); return [c.color, c.shape, c.wear.join("+")].join("/"); }));
  assert.ok(combos.size >= 60, `many Pottos (${combos.size})`);
  assert.deepEqual(P.pick(7), P.pick(7), "the same seed is the same Potto");
  assert.ok(P.seed > 0 && store["pl.potto"] === String(P.seed), "this visit's seed is remembered so the next one differs");
  const a = P.svg({ seed: 3, flat: true }), b = P.svg({ seed: 4, flat: true });
  assert.notEqual(a.replace(/plp\d+/g, ""), b.replace(/plp\d+/g, "")); assert.doesNotMatch(a, /<filter/, "flat means no filters"); assert.match(P.svg({ seed: 3, flat: false }), /<filter/);
  assert.match(P.svg({ type: "dinner", flat: true }), /data-wear="chefhat"/);
});

test("the app, the chooser, the canvas and /start: Potto arrives late into a box that is already there, and budgets hold", async () => {
  const app = read("index.html"), cv = read("public/canvas.js"), dp = read("public/drop.js"), st = read("public/start.html"), fh = read("public/funhome.js");
  assert.match(app, /<span class="fun-potto" id="homePotto" aria-hidden="true" style="display:block;width:132px;height:125px;margin:0 auto -6px"><\/span><p class="cg-hi">/, "Home reserves the box inline");
  assert.match(app, /<script src="\/funhome\.js" defer><\/script>/);
  const last = [...app.matchAll(/<script[^>]*>/g)].pop(); assert.ok(app.slice(last.index, last.index + 400).includes("Come with me?"), "the Come with me? loader is still the last script");
  assert.match(fh, /e\.target\?\.id !== "qsText"[\s\S]*m\.set\(\{ type \}\)/, "he dresses for what you type"); assert.match(fh, /renderPrograms = function/, "and comes back when Home is redrawn");
  assert.doesNotMatch(read("public/fun.css").split("---- the top of the app's Home").pop().replace(/[^{}]*::before\{[^}]*\}/g, ""), /font-size|padding|margin|height:|width:/, "what loads late on Home only changes paint");
  const html = await (await fetch(srv.base + "/?app=1")).text(); assert.ok(html.length < 80000, "the app shell budget");
  // the chooser (public/dropsetup.js): three choices, each with its own demo, Potto dressed for the one in hand, in a box that is already there
  const ds = read("public/dropsetup.js"), dc = read("public/dropsetup.css");
  assert.match(ds, /<span class="ds-potto" aria-hidden="true"><span id="dsPotto"><\/span><\/span>/); assert.match(dc, /\.ds-potto\{position:absolute;right:18px;top:-36px;width:64px;height:61px/);
  for (const [k, w] of [["event", '["partyhat"]'], ["drop", '["apron"]'], ["book", '["glasses", "bowtie"]']]) { assert.ok(ds.includes(`${k}: { t: "`) && ds.includes(`wear: ${w}`), k + " is still offered, with its outfit"); assert.match(dp, new RegExp(`\\["${k}", I\\.`)); }
  assert.match(ds, /You can make the others any time\./);
  // the canvas: he peeks over the type card, each chip has an icon, a hop for a title, a date and the first share
  assert.match(cv, /<span class="cv-potto" aria-hidden="true"><span id="cvPotto"><\/span><\/span>/); assert.match(cv, /\$\{kindIcon\(k\.k\)\}\$\{esc\(k\.label\)\}/);
  assert.match(cv, /#cv \.cv-potto\{position:absolute;right:64px;bottom:100%;width:92px;height:56px;overflow:hidden/);
  assert.match(cv, /!F\.title && e\.target\.value\.trim\(\)\) \{ F\.title = true; funReact\("hop"\)/); assert.match(cv, /if \(!F\.date && W\.date\) \{ F\.date = true; funReact\("hop"\)/); assert.match(cv, /if \(first\) \{ funReact\("hop"\);/);
  assert.match(cv, /Need an idea\? See a few from Potto|cv-ideas-d/, "Ideas from Potto stays one line"); assert.match(cv, /one row, More opens the rest/, "types stay one row");
  for (const k of ["dinner", "run", "book", "drinks", "class", "brunch"]) { assert.match(cv, new RegExp(`const FUN_WEAR = \\{[^}]*\\b${k}: "`), k); assert.match(cv, new RegExp(`const KIND_ICON = \\{[\\s\\S]*?\\b${k}: "M`), k + " icon"); }
  // /start
  assert.match(st, /<span class="fun-potto" id="stPotto" aria-hidden="true"><\/span>\s*<span class="eyebrow" id="eyebrow">/); assert.match(st, /window\.PLStartFun\.draw\(t, d\.title, d\.date\)/);
  assert.match(st, /<link rel="stylesheet" href="\/fun\.css"><script src="\/pottoplush\.js" defer><\/script>/, "not blocking");
  for (const f of ["public/pottoplush.js", "public/funhome.js", "public/fun.css", "public/home.html"]) assert.doesNotMatch(read(f), /\b(claude|gpt|gemini|sonnet|opus|haiku)\b/i, f + " names no model");
});

test("in a browser: the box is reserved (no layout shift), seeds differ, reduced motion is still, the demo pauses", async (t) => {
  let chromium; try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch { return t.skip("no playwright"); }
  let br; try { br = await chromium.launch(); } catch { return t.skip("no browser"); }
  try {
    const open = async (path, opts = {}) => { const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", ...opts });
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, body: "" }));
      await ctx.addInitScript(() => { window.__cls = 0; window.__errs = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__cls += e.value; })).observe({ type: "layout-shift", buffered: true }); } catch {} addEventListener("error", (e) => window.__errs.push(String(e.message))); });
      const p = await ctx.newPage(); await p.goto(srv.base + path, { waitUntil: "load" }); await p.waitForSelector("#heroPotto .plp svg, #stPotto .plp svg"); await p.waitForTimeout(500); return p; };
    // a different Potto for a different seed, the same one for the same seed
    const look = async (seed) => { const p = await open("/about?potto=" + seed); const d = await p.evaluate(() => { const e = document.querySelector("#heroPotto .plp"); return [e.dataset.color, e.dataset.shape, e.dataset.wear].join("/"); }); await p.context().close(); return d; };
    const [a, b, c, a2] = [await look(11), await look(12), await look(13), await look(11)];
    assert.equal(a, a2); assert.equal(new Set([a, b, c]).size, 3, `three seeds, three Pottos: ${a} ${b} ${c}`);
    // the first screen
    const p = await open("/about?potto=5");
    const m = await p.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(), box = r("#heroPotto"), h1 = r("#heroH"), a1 = r("#heroGo"), a2 = r(".hero .ctas .is-quiet"), cs = (s) => getComputedStyle(document.querySelector(s));
      return { box: [box.width, box.height], h1: document.querySelector("#heroH").textContent, deck: document.querySelector(".hero .deck").textContent, deckColor: cs(".hero .deck").color, ink: cs("#heroH").color, order: box.bottom <= h1.top + 30 && h1.bottom <= a1.top, sideBySide: Math.abs(a1.top - a2.top) < 2, tap: Math.min(a1.height, a2.height),
        pill: parseFloat(cs("#heroGo").borderRadius) >= a1.height / 2, primary: cs("#heroGo").backgroundColor, demoR: parseFloat(cs("#demo").borderRadius), cls: window.__cls, errs: window.__errs, scroll: document.documentElement.scrollWidth - innerWidth, tint: document.body.dataset.funTint,
        label: document.querySelector("#heroPotto .plp").getAttribute("aria-label"), pause: document.querySelector("#demoPause").getAttribute("aria-label"), playing: document.querySelector("#demo").classList.contains("is-playing"), bob: getComputedStyle(document.querySelector("#heroPotto .plp-b")).animationName }; });
    assert.equal(m.h1, "Your co-host for every plan."); assert.equal(m.deck, "Potto brainstorms the idea, finds the time that works for everyone, designs the invite, chases the replies and keeps the group going.");
    assert.ok(m.box[0] >= 150 && m.box[1] >= 140, "Potto's box has a size before he arrives"); assert.ok(m.order, "Potto, then the headline, then the buttons"); assert.ok(m.sideBySide, "two pills side by side on a phone"); assert.ok(m.tap >= 44);
    assert.ok(m.pill, "pills"); assert.equal(m.primary, "rgb(41, 72, 154)", "ink-blue is still the primary"); assert.notEqual(m.deckColor, m.ink, "the supporting line is grey"); assert.ok(m.demoR >= 24, "a very round demo card");
    assert.ok(m.cls < 0.05, `no layout jump (${m.cls})`); assert.deepEqual(m.errs, []); assert.ok(m.scroll <= 0, "no sideways scroll"); assert.ok(m.tint, "the page takes Potto's colour");
    assert.match(m.label, /Potto/); assert.equal(m.pause, "Pause the demo"); assert.ok(m.playing); assert.equal(m.bob, "plp-bob");
    // the pause control
    await p.click("#demoPause"); assert.equal(await p.getAttribute("#demoPause", "aria-label"), "Play the demo"); assert.ok(await p.evaluate(() => getComputedStyle(document.querySelector(".fd-invite")).animationPlayState === "paused"));
    await p.click("#demoPause"); assert.equal(await p.getAttribute("#demoPause", "aria-label"), "Pause the demo"); assert.ok(await p.evaluate(() => getComputedStyle(document.querySelector(".fd-invite")).animationPlayState === "running"));
    // pills nowhere else: the kit's corners outside .pl-fun
    assert.ok(await p.evaluate(() => [...document.querySelectorAll(".fun-pill,.fun-round")].every((e) => e.closest(".pl-fun"))));
    await p.context().close();
    // less motion: nothing animates, the demo shows its last frame and offers Play
    const q = await open("/about?potto=5", { reducedMotion: "reduce" });
    const s = await q.evaluate(() => ({ moving: document.getAnimations().filter((x) => x.playState === "running" && !/^sk$/.test(x.animationName || "")).map((x) => x.animationName), playing: document.querySelector("#demo").classList.contains("is-playing"), pause: document.querySelector("#demoPause").getAttribute("aria-label"),
      frame: ["fd-typed", "fd-invite", "fd-r.r4", "fd-count"].every((c) => { const e = document.querySelector("." + c), st = getComputedStyle(e); return st.opacity === "1" && e.getBoundingClientRect().width > 0; }), bob: getComputedStyle(document.querySelector("#heroPotto .plp-b")).animationName }));
    assert.deepEqual(s.moving, [], "nothing moves"); assert.equal(s.playing, false); assert.equal(s.pause, "Play the demo"); assert.ok(s.frame, "a complete still frame"); assert.equal(s.bob, "none");
    await q.hover("#heroGo"); assert.equal(await q.evaluate(() => document.querySelector("#heroPotto .plp").className.includes("is-hop")), false, "no hop either");
    await q.context().close();
    // /start: he dresses for the kind you tap
    const st = await open("/start?potto=5"); assert.ok((await st.evaluate(() => window.__cls)) < 0.05, "no jump while Potto arrives"); await st.click(".chip[data-t=run]"); await st.waitForTimeout(300);
    assert.equal(await st.evaluate(() => document.querySelector("#stPotto .plp").dataset.wear), "headband");
    await st.fill("#f [name=title]", "Book club at mine"); await st.waitForTimeout(300); assert.equal(await st.evaluate(() => document.querySelector("#stPotto .plp").dataset.wear), "glasses book");
    assert.deepEqual(await st.evaluate(() => window.__errs), []);
    await st.context().close();
  } finally { await br.close(); }
});
