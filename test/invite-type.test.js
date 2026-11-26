// The guest invite in Field Notes (the light invite /e and the full invite /g): one type scale as tokens, a sturdy title
// face whatever the look or brand kit, the body at 17/27 in ink, a linen page, and nothing hidden under the sticky bar.
// A look or kit may change only the accent, the cover art and the title face (IBM Plex Serif 600 or IBM Plex Sans 600).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const plain = (v) => JSON.parse(JSON.stringify(v));
function browser(path) { const window = {}; const ctx = { window, console, ...(path ? { location: { pathname: path } } : {}) };
  for (const f of ["color.js", "brandkit.js", "looks.js"]) vm.runInNewContext(read("public/" + f), Object.assign(ctx, { document: undefined }));
  return { C: window.EncoreColor, K: window.EncoreBrandKit, LK: window.EncoreLooks }; }
const STURDY = ["IBM Plex Serif", "IBM Plex Sans"];
const LINEN = "#EFEBE2", SURFACE = "#FAF8F3", INK = "#1B1D1C";

test("one type scale for the invite, as tokens in system.css", () => {
  const sys = read("public/system.css");
  for (const re of [/--inv-kicker:500 12px\/16px var\(--pl-font-mono\);--inv-kicker-track:\.06em/, /--inv-title-face:var\(--pl-font-serif\);--inv-title-size:32px;--inv-title-lh:36px/,
    /--inv-when:600 18px\/24px var\(--pl-font-text\)/, /--inv-place:400 16px\/22px var\(--pl-font-text\)/, /--inv-body:400 17px\/27px var\(--pl-font-text\);--inv-measure:60ch/,
    /--inv-meta:400 14px\/20px var\(--pl-font-text\)/, /--inv-label:600 15px\/20px var\(--pl-font-text\)/, /--inv-btn:600 16px\/20px var\(--pl-font-text\)/,
    /--inv-bar-date:600 16px\/20px var\(--pl-font-text\);--inv-bar-sub:400 13px\/18px var\(--pl-font-text\)/, /--inv-field-h:48px/, /--inv-gap-field:16px;--inv-gap-help:4px/,
    /@media \(min-width:861px\)\{:root\{--inv-title-size:40px;--inv-title-lh:44px\}\}/]) assert.match(sys, re);
  const css = read("public/slots.css");
  assert.match(css, /:is\(html body #m#m>\.why,html body #view-guest#view-guest\.ev2 \.in>\.pp-why\)\{[^}]*font:var\(--inv-body\)!important;color:var\(--pl-ink\)!important/, "the body is 17/27 in ink on both invites");
  assert.match(css, /font-family:var\(--lk-title,var\(--inv-title-face\)\)!important;font-weight:600!important;font-size:var\(--inv-title-size\)!important;line-height:var\(--inv-title-lh\)!important/);
  assert.match(css, /html body #m#m\{[^}]*padding:[^;]*calc\(var\(--inv-bar-h\) \+ var\(--inv-safe-b\) \+ 32px\)/, "the light invite ends above the sticky bar and the safe area");
  assert.match(css, /html body #view-guest#view-guest\.ev2\{padding-bottom:calc\(var\(--inv-bar-h\) \+ var\(--inv-safe-b\) \+ 24px\)!important\}/, "so does the full invite");
  assert.match(css, /html body #gBar\.g-bar b\{font:var\(--inv-bar-date\)!important/); assert.match(css, /html body #gBar\.g-bar small\{font:var\(--inv-bar-sub\)!important/);
  assert.match(read("public/replybar.js"), /font:var\(--inv-bar-date/);
  for (const f of ["public/slots.css", "public/replybar.js", "public/invite.html", "public/looks.js", "public/brandkit.js"]) assert.doesNotMatch(read(f), /—/, f + ": no em dashes");
  assert.ok(read("public/invite.html").length < 40000);
});

test("looks: every title font reads as a sturdy face, the page stays linen and the accent passes AA", () => {
  const { C, LK } = browser();
  for (const k of Object.keys(LK.FONTS)) assert.ok(STURDY.includes(LK.titleFace(k).family), k + " -> " + LK.titleFace(k).family);
  assert.equal(LK.sturdyOf("script"), "serif", "a script title is a serif"); assert.equal(LK.sturdyOf("pixel"), "sans"); assert.equal(LK.sturdyOf("serif"), "serif"); assert.equal(LK.sturdyOf("nonsense"), "serif");
  const palettes = [...Object.values(LK.VIBES).map((v) => v.look.palette), ["#1E1A17", "#C9A227"], ["#F4E9EC", "#E26D8E"], ["#FFE08A", "#FFD400"]];
  for (const p of palettes) { const T = LK.fieldNotes(LK.colors({ palette: p }));
    assert.equal(T.top, LINEN); assert.equal(T.bot, LINEN); assert.equal(T.ink, INK); assert.equal(T.card, SURFACE);
    assert.ok(C.contrast(T.onBtn, T.btn) >= 4.5, "button text " + p); assert.ok(C.worst(T.btn, [LINEN, SURFACE]) >= 3, "button edge " + p);
    assert.ok(C.worst(T.link, [LINEN, SURFACE]) >= 4.5, "accent text " + p);
    assert.ok(C.contrast(T.cover, SURFACE) < 1.25, "at most a very light tint on the cover frame " + p); }
  const src = read("public/looks.js"), apply = src.slice(src.indexOf("function apply("), src.indexOf("// ---------- the cover"));
  assert.doesNotMatch(apply, /classList\.add\("lk-(page|root)"\)|stops\.push\(effect\(/, "no page tint, gradient or effect over the page");
  assert.match(src, /\.lk-on\{--lk-title:var\(--inv-title-face,inherit\)\}/, "a look without a font still titles in the serif");
});

test("brand kits on the invite: a sturdy title, Plex Sans for the rest, linen, 6px corners; elsewhere the kit is unchanged", () => {
  const inv = browser("/e/abc123"), app = browser("/@someone");
  assert.equal(inv.K.onInvite(), true); assert.equal(browser("/g").K.onInvite(), true); assert.equal(app.K.onInvite(), false);
  for (const [k, S] of Object.entries(inv.K.STARTERS)) { const kit = inv.K.starter(k), v = plain(inv.K.vars(kit)), C = inv.C;
    assert.ok(STURDY.some((f) => v["--kit-display"].startsWith(`"${f}"`)), k + " title: " + v["--kit-display"]);
    assert.match(v["--kit-body"], /^"IBM Plex Sans"/, k + " body"); assert.equal(v["--kit-page"], LINEN); assert.equal(v["--kit-surface"], SURFACE); assert.equal(v["--kit-ink"], INK);
    for (const r of ["--kit-r-card", "--kit-r-btn", "--kit-r-field", "--kit-r-chip"]) assert.equal(v[r], "6px", k + " " + r);
    assert.ok(C.contrast(v["--kit-on-btn"], v["--kit-btn"]) >= 4.5, k + " button"); assert.ok(C.worst(v["--kit-accent-text"], [LINEN, SURFACE]) >= 4.5, k + " accent text");
    assert.doesNotMatch(plain(inv.K.classes(kit)).join(" "), /kit-thin|kit-soft|kit-btn-outline/, k);
    if (S.pair !== "house") assert.equal(plain(inv.K.vars(kit))["--kit-accent"], plain(app.K.vars(kit))["--kit-accent"], k + " keeps its accent"); }
  assert.match(plain(inv.K.vars(inv.K.starter("florist")))["--kit-display"], /^"IBM Plex Serif"/, "the thin Cormorant pair reads as Plex Serif");
  assert.match(plain(app.K.vars(app.K.starter("florist")))["--kit-display"], /Cormorant Garamond/, "the host's own page keeps its pair");
  assert.match(plain(inv.K.vars(inv.K.starter("market")))["--kit-display"], /^"IBM Plex Sans"/, "a black display face reads as Plex Sans 600");
});

test("no repeated words from our side: the full invite's form doesn't repeat the Bring list, and the sticky bar says the date like the page", () => {
  const idx = read("index.html");
  assert.match(idx, /bring=\[\]; \/\* the invite's own Bring row already says what to bring/);
  assert.match(idx, /toLocaleDateString\("en-US",\{weekday:"short",month:"short",day:"numeric"\}\):"", t\?/, "the bar's date is en-US like the page, not the phone's locale");
  assert.match(idx, /<span class="ev2-when-time">\$\{st\?esc\(st\+\(en\?` to \$\{en\}`:""\)\)/, "7pm to 10pm, as on the light invite");
  assert.match(idx, /You're the host<\/span>/); assert.match(idx, /Open in app<\/a>/); assert.match(idx, /encore-gebar-off-/, "the host line can be put away");
  assert.doesNotMatch(idx, /You're the host\. Tap anything outlined to edit it\.<\/span><a class="btn sm ghost"/);
  assert.match(idx, /isCasual\(e\)\?"Show my name to other guests":"Show my name and company to other guests"/, "company only for work events");
  // the event copy under the host's words stays hidden when it only repeats their sentences
  const sl = read("public/slots.js"), src = sl.slice(sl.indexOf("const sents ="), sl.indexOf("function tidyForm"));
  const sents = vm.runInNewContext(src.slice(0, src.indexOf("\n")) + "; sents");
  const W = new Set(sents("Bring whatever you're building. Quiet tables.  Fast wifi!")); assert.deepEqual(plain(sents("Quiet tables. fast wifi!")).filter((x) => !W.has(x)), [], "the same sentences, any case or spacing");
  assert.ok(!W.has(sents("Quiet tables and a slow loop.")[0]), "a different sentence is kept");
  assert.match(sl, /try \{ tidyTicket\(\); tidyWords\(\); \}/);
});

let srv;
before(async () => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "invite-type-secret-0123"; process.env.ENCORE_FAKE_EMAIL = "1"; resetLoginLimits(); srv = await startServer(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv?.close(); });

test("in a browser at 390px: sturdy title, 17px ink body, linen page, the bar's date, nothing under the bar, one Add to calendar after replying", async (t) => {
  let chromium; try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch { return t.skip("no playwright"); }
  let br; try { br = await chromium.launch(); } catch { return t.skip("no browser"); }
  const J = { "content-type": "application/json" }, day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name: "Madison Reyes", email: "madison.it@example.com", password: "long-password-1", mode: "friends" }) }), c = r.headers.get("set-cookie").split(";")[0];
  const post = (p, b) => fetch(srv.base + p, { method: "POST", headers: { ...J, cookie: c }, body: JSON.stringify(b) });
  assert.equal((await post("/api/host/profile", { handle: "madison-it", name: "Madison Reyes" })).status, 200); assert.equal((await post("/api/host/brandkit", { starter: "florist", fromStarter: true })).status, 200);
  // a thin-serif kit and a script look with a pink page: both must read as Field Notes
  await fetch(srv.base + "/api/db/doc?path=events/ithack", { method: "PUT", headers: { ...J, cookie: c }, body: JSON.stringify({ kind: "social", casual: true, published: true, name: "Hack night", activity: "hack night", hostName: "Madison", date: day(2), startTime: "19:00", venueName: "The Reading Room", hood: "Mission", headcount: 15, why: "Bring whatever you're building, or nothing at all. Fast wifi, good coffee, and a short round of demos at nine for anyone who wants one.\n\nWe keep the music low and the tables long. Newcomers welcome: say hi at the door and we'll find you a seat near someone building something like yours.\n\nWe wrap up at ten.", bring: ["Your laptop"], look: { palette: ["#F4E9EC", "#1F3D30", "#A85A55"], titleFont: "script", vibe: "flower", effect: "petals" } }) });
  try {
    for (const url of ["/e/ithack", "/g#rsvp-ithack"]) {
      const p = await br.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "en-GB" }); await p.route(/fonts\.(googleapis|gstatic)\.com/, (x) => x.abort());
      await p.goto(srv.base + url, { waitUntil: "load" }); await p.waitForTimeout(2500);
      const m = await p.evaluate(() => { const cs = (s) => { const el = document.querySelector(s); if (!el) return null; const c = getComputedStyle(el); return { ff: c.fontFamily.split(",")[0].replace(/"/g, "").trim(), fs: c.fontSize, lh: c.lineHeight, fw: c.fontWeight, color: c.color }; };
        return { title: cs("h1.lk-title, #view-guest .invite .in > h3"), body: cs("#m .why, #view-guest .pp-why"), page: getComputedStyle(document.body).backgroundColor, root: getComputedStyle(document.documentElement).backgroundImage,
          fx: !!document.querySelector("[class*=lk-fx-]"), kicker: cs("#m .kicker, #view-guest #hostHello"), kickerText: document.querySelector("#m .kicker, #view-guest #hostHello")?.textContent.trim() }; });
      assert.ok(STURDY.includes(m.title.ff), url + " title face: " + m.title.ff); assert.equal(m.title.fw, "600"); assert.equal(m.title.fs, "32px", url); assert.equal(m.title.lh, "36px", url);
      assert.equal(m.body.fs, "17px", url + " body size"); assert.equal(m.body.lh, "27px", url); assert.equal(m.body.color, "rgb(27, 29, 28)", url + " body in ink"); assert.equal(m.body.ff, "IBM Plex Sans", url);
      assert.equal(m.page, "rgb(239, 235, 226)", url + " linen page"); assert.equal(m.root, "none", url + " no gradient"); assert.equal(m.fx, false, url + " no page effect");
      assert.equal(m.kicker.fs, "12px", url + " kicker"); assert.match(m.kickerText, /Madison is hosting · Hack night/, url);
      // the sticky bar: the date in the page's words, and the last control clears it
      await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(800);
      const bar = await p.evaluate(() => { const b = document.querySelector(".prb.on, #gBar:not(.hide)"); return b ? { text: b.textContent.trim(), h: b.getBoundingClientRect().height } : null; });
      assert.ok(bar, url + " the bar shows"); assert.match(bar.text, /^(Today|[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}) · 7pm/, url + " bar date: " + bar.text); assert.doesNotMatch(bar.text, /\d{1,2} [A-Z][a-z]{2} ·/, "not the phone's locale");
      await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await p.waitForTimeout(600);
      const clear = await p.evaluate(() => { const b = document.querySelector(".prb.on, #gBar:not(.hide)"), top = b ? b.getBoundingClientRect().top : innerHeight;
        return [...document.querySelectorAll("#m a.btn, #m button, #m .sl-btn, #view-guest .btn, #view-guest button, #view-guest .chip")].filter((x) => x.offsetParent && x.getBoundingClientRect().height).every((x) => x.getBoundingClientRect().bottom <= top + 0.5 || x.getBoundingClientRect().top >= innerHeight); });
      assert.ok(clear, url + ": no button sits under the sticky bar");
      // the reply form: 48px fields, a 15px label, the helper right under it and before the field
      const f = await p.evaluate(() => { const i = document.querySelector("#ct, #g-email"), l = i.closest("label"), h = l.querySelector("small, .note"), hb = h.getBoundingClientRect(), ib = i.getBoundingClientRect();
        return { h: ib.height, label: getComputedStyle(l).fontSize, helperAbove: hb.bottom <= ib.top, gap: Math.round(ib.top - hb.bottom) }; });
      assert.equal(f.h, 48, url + " field height"); assert.equal(f.label, "15px"); assert.ok(f.helperAbove, url + " helper before the field");
      // reply, with a double tap on Send: one reply goes out
      let posts = 0; p.on("request", (q) => { if (q.method() === "POST" && /collection\?path=rsvps/.test(q.url())) posts++; });
      await p.fill("#nm, #g-name", "Ana Ruiz"); await p.fill("#ct, #g-email", `ana.${url.length}@example.com`);
      await p.evaluate(() => { const s = document.querySelector("#send, #g-send"); s.click(); s.click(); }); await p.waitForTimeout(3000);
      assert.equal(posts, 1, url + ": one reply for a double tap");
      await p.evaluate(() => [...document.querySelectorAll("button,a")].find((x) => /^Not now$/.test(x.textContent.trim()) && x.offsetParent)?.click()); await p.waitForTimeout(900);
      const cal = await p.evaluate(() => [...document.querySelectorAll("a,button")].filter((x) => x.offsetParent && /^\s*(Add to calendar|Remind me)\s*$/.test(x.textContent)).length);
      assert.equal(cal, 1, url + ": one Add to calendar after replying");
      if (url.startsWith("/g")) { const g = await p.evaluate(() => ({ chg: [...document.querySelectorAll(".gchange .chips")].some((x) => x.offsetParent), out: !!document.querySelector(".pl-out")?.offsetParent, wall: document.querySelector("#g-unwall")?.closest("label")?.textContent.trim() || "" }));
        assert.equal(g.chg, false, "Plans changed is a quiet link, not a row of chips"); assert.equal(g.out, true); if (g.wall) assert.equal(g.wall, "Show my name to other guests"); }
      await p.close(); }
  } finally { await br.close(); }
});
