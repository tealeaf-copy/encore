// One post is one card (public/feedvisual.js FEED CARD block, public/feed.html postCard): every kind of post sits in
// the same container, nothing inside a card looks like the gap between two posts, an event post with its action row
// fits a phone screen, the action buttons are one row of equals, the comment box waits closed until Comment is
// tapped, nothing sits under the tab bar or the "+", a drop never draws the party scene, and covers do not push the
// page around while they load.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { fixtures, STORY_PROMPT, photoSvg } from "./feed-card-fixtures.js";

let srv, cookie;
before(async () => { Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "feed-card-secret-0123456789abcdef", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_SMS: "1", ENCORE_FAKE_PUSH: "1", ENCORE_SIGNUP_PER_HOUR: "500", ENCORE_FEED_PER_IP_HOUR: "100000" }); srv = await startServer();
  const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Card Reader", email: "card.fc@example.com", password: "long-password-1", mode: "friends" }) });
  assert.equal(r.status, 200); cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "); });
after(async () => { await srv?.close(); });

test("a drop with no photo draws food or a stall, never the party scene", () => {
  const box = { window: {}, document: undefined }; vm.runInNewContext(fs.readFileSync(new URL("../public/eventart.js", import.meta.url), "utf8"), box);
  const EA = box.window.EventArt, FOOD = ["bake", "cook", "dumpling", "taco", "coffee", "tea", "wine", "dinner", "brunch", "potluck", "market"];
  for (const e of [{ title: "Pandan", drop: true }, { title: "Pandan", preorder: true }, { title: "Party mix", drop: true }, { title: "Friday box", drop: true, orderItems: [{ name: "Chiffon slice" }] },
    { title: "Birthday party box", drop: true, orderItems: [{ name: "Kimchi jar" }] }, { title: "Small batch", orderItems: [{ name: "Jar no. 4" }] }, { title: "Weekend drop", drop: true }]) {
    const kinds = EA.kindsOf(e), s = EA.spec({ ...e, id: "x1" });
    assert.notEqual(kinds[0], "party", JSON.stringify(e)); assert.ok(FOOD.includes(kinds[0]), `${e.title}: ${kinds[0]}`); assert.ok(FOOD.includes(s.kind), `${e.title} spec: ${s.kind}`); }
  // an event that is not a drop keeps its own picture
  assert.equal(EA.kindsOf({ title: "Evening 5k" })[0], "run");
});

const open = async (pw, browser, { w, h, phone, out = false }) => {
  const ctx = await browser.newContext({ ...(phone ? pw.devices["iPhone 13"] : {}), viewport: { width: w, height: h }, serviceWorkers: "block" });
  if (!out) await ctx.addCookies(cookie.split("; ").map((c) => { const [k, ...v] = c.split("="); return { name: k, value: v.join("="), url: srv.base }; }));
  await ctx.addInitScript(() => { try { localStorage.setItem("encore.place", JSON.stringify({ city: "New York", source: "manual", at: Date.now() })); localStorage.setItem("encore.city", "New York"); sessionStorage.setItem("encore.feedCity", "1"); } catch {}
    window.__cls = 0; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__cls += e.value; })).observe({ type: "layout-shift", buffered: true }); } catch {} });
  const page = await ctx.newPage(), errs = [], bad = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); }); page.on("pageerror", (e) => errs.push("pageerror " + String(e.message).slice(0, 200)));
  page.on("response", (r) => { if (r.status() >= 400) bad.push(r.status() + " " + r.url().replace(srv.base, "")); });
  await page.route(out ? "**/api/public/feed*" : "**/api/me/feed*", async (route) => { const r = await route.fetch(), j = await r.json(); j.blend = { ...(j.blend || {}), items: fixtures(), me: j.blend?.me || { i: "C", c: "#29489A" } }; await route.fulfill({ response: r, json: j }); });
  await page.route("**/api/me/story-prompt*", (route) => route.fulfill({ json: STORY_PROMPT }));
  await page.route("**/api/inspiration/track", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/feed/social*", (route) => route.fulfill({ json: { items: {} } }));
  // covers arrive late, as they do on a phone
  await page.route("**/_blob/fixphoto*", async (route) => { const i = +route.request().url().slice(-12); await new Promise((r) => setTimeout(r, 350)); await route.fulfill({ contentType: "image/svg+xml", body: photoSvg(i) }); });
  await page.route("**/_blob/abcdefghijklmnopqrst", (route) => route.fulfill({ contentType: "image/svg+xml", body: photoSvg(4) }));
  await page.goto(srv.base + "/feed", { waitUntil: "networkidle" }); await page.waitForSelector(".fb-stream .fb-card"); await page.waitForTimeout(900);
  return { ctx, page, errs, bad };
};

test("on a phone: every kind is one card, compact, with one row of equal actions and a closed comment box", async (t) => {
  let pw; try { pw = createRequire(import.meta.url)("playwright"); } catch { return t.skip("playwright is not installed"); }
  let browser; try { browser = await pw.chromium.launch(); } catch { return t.skip("no Chromium here"); }
  try {
    const { ctx, page, errs, bad } = await open(pw, browser, { w: 390, h: 844, phone: true });
    const R = await page.evaluate(() => { const px = (v) => parseFloat(v) || 0, cards = [...document.querySelectorAll(".fb-stream>*")], out = { cards: [], rules: [], acts: [], fonts: {}, gaps: [] };
      const tabs = document.querySelector(".es-tabs")?.getBoundingClientRect();
      cards.forEach((c, i) => { const s = getComputedStyle(c), r = c.getBoundingClientRect();
        out.cards.push({ kind: c.dataset.kind || "?", id: c.dataset.fvId || "", ok: c.matches(".fb-card,.fv-post"), h: Math.round(r.height), toActs: Math.round((c.querySelector(".fb-acts")?.getBoundingClientRect().bottom ?? r.bottom) - r.top), w: Math.round(r.width), bg: s.backgroundColor, bw: s.borderTopWidth + s.borderBottomWidth + s.borderLeftWidth + s.borderRightWidth, bs: s.borderTopStyle, bc: s.borderTopColor, rad: s.borderTopLeftRadius, pad: s.paddingLeft });
        if (i) out.gaps.push(Math.round(r.top - cards[i - 1].getBoundingClientRect().bottom));
        // a rule inside the card: a top or bottom line (or an hr) nearly as wide as the card, with no sides
        for (const el of c.querySelectorAll("*")) { const e = getComputedStyle(el), b = el.getBoundingClientRect(); if (!b.width || e.display === "none") continue;
          const line = (px(e.borderTopWidth) > 0 && e.borderTopStyle !== "none") !== (px(e.borderBottomWidth) > 0 && e.borderBottomStyle !== "none") || el.tagName === "HR";
          if (line && !px(e.borderLeftWidth) && b.width >= r.width * 0.8) out.rules.push((c.dataset.kind || "post") + " " + (el.className || el.tagName)); }
        const A = [...c.querySelectorAll(".fb-acts .fb-act")].map((a) => { const e = getComputedStyle(a), b = a.getBoundingClientRect(); return [Math.round(b.height), Math.round(b.width), e.fontFamily, e.fontSize, e.fontWeight, e.backgroundColor, e.borderTopWidth, e.borderRadius].join("|"); });
        if (A.length) out.acts.push({ kind: c.dataset.kind || "post", A }); });
      const fam = (sel) => [...new Set([...document.querySelectorAll(sel)].map((el) => { const e = getComputedStyle(el); return [e.fontFamily.split(",")[0].replace(/"/g, ""), e.fontSize, e.fontWeight].join(" "); }))];
      out.fonts = { host: fam(".fb-stream .fb-host b"), meta: fam(".fb-stream .fb-host small"), title: fam(".fb-stream .fb-ev .fb-title"), facts: fam(".fb-stream .fb-meta"), act: fam(".fb-stream .fb-act"), comment: fam(".fb-stream .fb-c p"), time: fam(".fb-stream .fb-c .fb-at"), cta: fam(".fb-stream .fb-cta") };
      out.primaries = cards.map((c) => c.querySelectorAll(".fb-cta").length);
      out.box = [...document.querySelectorAll(".fb-stream form.fb-add")].map((f) => getComputedStyle(f).display);
      out.clamped = [...document.querySelectorAll(".fb-ev .fb-title")].filter((h) => h.scrollHeight > h.clientHeight + 1).map((h) => !!h.querySelector("a[href]"));
      out.tabsTop = tabs ? Math.round(tabs.top) : null; out.cls = window.__cls; out.overflowX = document.documentElement.scrollWidth > innerWidth;
      out.sticky = [...document.querySelectorAll(".fb-stream *")].filter((e) => ["sticky", "fixed"].includes(getComputedStyle(e).position)).length;
      return out; });
    // every kind of post: one container, the same surface, edge, corners and padding
    const kinds = new Set(R.cards.map((c) => c.kind));
    for (const k of ["event", "recap", "milestone", "club", "post", "poll", "follow", "ideas", "inspire", "list", "row"]) assert.ok(kinds.has(k), "the feed drew a " + k + " card");
    for (const c of R.cards) { assert.ok(c.ok, c.kind + " is a card"); assert.equal(c.w, 358, c.kind + " fills the column"); }
    for (const p of ["bg", "bw", "bs", "bc", "rad", "pad"]) assert.equal(new Set(R.cards.map((c) => c[p])).size, 1, "every card has the same " + p + ": " + [...new Set(R.cards.map((c) => c.kind + "=" + c[p]))].join(", "));
    assert.notEqual(R.cards[0].bg, "rgba(0, 0, 0, 0)"); assert.equal(R.cards[0].bw, "1px1px1px1px"); assert.ok(parseFloat(R.cards[0].rad) >= 4);
    for (const g of R.gaps) assert.ok(g >= 12 && g <= 16, "12 to 16px between cards, got " + g);
    assert.deepEqual(R.rules, [], "no rule inside a card that reads as the gap between two posts");
    assert.equal(R.sticky, 0, "nothing in a post sticks to the top of the screen");
    // compact: an event post down to its action row fits a 390x664 screen above the 80px tab bar; with its two latest
    // comments, each with Reply under it (public/feedvisual.js, the replies block), it stays within 75% of a 390x844 screen
    const ev = R.cards.filter((c) => c.kind === "event"); assert.equal(ev.length, 4);
    for (const c of ev) { assert.ok(c.h <= 844 * 0.75, `${c.id} is ${c.h}px, over 75% of the screen`); assert.ok(c.toActs <= 664 - 80, `${c.id}: header to action row is ${c.toActs}px, more than a short screen shows`); }
    for (const c of ev.filter((x) => x.id !== "evphoto")) assert.ok(c.h <= 844 * 0.6, `${c.id} without comments is ${c.h}px`);
    assert.ok(R.primaries.every((n) => n <= 1), "one primary button a card");
    // the action row: one row of equals (same height, width, type and quiet style), 44px tall
    for (const { kind, A } of R.acts) { assert.equal(new Set(A).size, 1, kind + ": action buttons differ: " + A.join("  ")); assert.ok(+A[0].split("|")[0] >= 44, kind + " actions are 44px tall"); }
    assert.equal(new Set(R.acts.map((a) => a.A[0].split("|").slice(2).join("|"))).size, 1, "the action row is the same on every kind");
    // type roles: one face, size and weight each; facts are Plex Sans, never monospace
    for (const [role, v] of Object.entries(R.fonts)) { assert.equal(v.length, 1, role + " has one style: " + v.join(" / ")); assert.match(v[0], /^IBM Plex Sans /, role + " is Plex Sans: " + v[0]); }
    assert.match(R.fonts.title[0], / 20px 600$/); assert.match(R.fonts.facts[0], / 14px 400$/);
    assert.ok(R.clamped.every(Boolean), "a clamped title links to the page with the full title");
    // the comment box: closed until Comment is tapped; the first tap opens it with the cursor in it
    assert.ok(R.box.length >= 6 && R.box.every((d) => d === "none"), "comment boxes start closed");
    const card = page.locator(".fb-ev").first(); await card.locator("[data-fb-comment]").scrollIntoViewIfNeeded(); await card.locator("[data-fb-comment]").tap(); await page.waitForTimeout(500);
    const O = await card.evaluate((c) => { const f = c.querySelector("form.fb-add"); return { d: getComputedStyle(f).display, focus: document.activeElement === f.querySelector("textarea"), fun: [...f.querySelectorAll(".fx-b")].map((b) => getComputedStyle(b).display), others: [...document.querySelectorAll(".fb-stream form.fb-add")].filter((x) => x !== f && getComputedStyle(x).display !== "none").length }; });
    assert.notEqual(O.d, "none"); assert.ok(O.focus, "the cursor is in the box after one tap"); assert.ok(O.fun.length && O.fun.every((d) => d !== "none"), "emoji and GIF show once you are in the box"); assert.equal(O.others, 0);
    // Reply under a previewed comment: the reply box opens right there, on screen, with the cursor in it, in the same
    // type as the comments; the card's own comment box is not needed for it
    const P = await page.evaluate(() => { const c = document.querySelector(".fb-ev"), rb = [...c.querySelectorAll(".fb-cm [data-fb-reply]")], f = (el) => { const e = getComputedStyle(el); return [e.fontFamily.split(",")[0].replace(/"/g, ""), e.fontSize, e.fontWeight].join(" "); };
      return { n: rb.length, h: rb.map((b) => Math.round(b.getBoundingClientRect().height)), font: rb.map(f), act: f(c.querySelector(".fb-act")) }; });
    assert.equal(P.n, 2, "Reply under each previewed comment"); assert.ok(P.h.every((h) => h >= 44), "Reply is a 44px target"); assert.ok(P.font.every((x) => x === P.act), "Reply reads like the action labels: " + P.font[0] + " / " + P.act);
    const card2 = page.locator('.fb-card[data-fv-id="rc1"]'), rp = card2.locator(".fb-cm [data-fb-reply]").first(); await rp.scrollIntoViewIfNeeded(); await rp.tap(); await page.waitForSelector("form.rb"); await page.waitForTimeout(450);
    const Q = await card2.evaluate((c) => { const f = c.querySelector("form.rb"), ta = f?.querySelector("textarea"), b = f?.getBoundingClientRect(), tabs = document.querySelector(".es-tabs").getBoundingClientRect(), own = c.querySelector("form.fb-add");
      return { inLi: !!f?.closest("li.fb-c"), shown: !!b && b.height > 0 && getComputedStyle(f).display !== "none", focus: document.activeElement === ta, top: b?.top, bottom: b?.bottom, tabs: tabs.top, own: getComputedStyle(own).display, font: getComputedStyle(ta).fontFamily.split(",")[0].replace(/"/g, "") }; });
    assert.ok(Q.inLi && Q.shown, "the reply box is open under its comment"); assert.ok(Q.focus, "the cursor is in the reply box after one tap"); assert.ok(Q.top >= 0 && Q.bottom <= Q.tabs, `the reply box is on screen above the tab bar (${Math.round(Q.top)} to ${Math.round(Q.bottom)} of ${Q.tabs})`);
    assert.equal(Q.own, "none", "the card's own comment box stays closed while you reply"); assert.equal(Q.font, "IBM Plex Sans");
    await card2.locator("form.rb [data-rb-x]").tap(); assert.equal(await page.locator("form.rb").count(), 0);
    // nothing under the tab bar: scrolled to the end, the last card ends above it; no control of a post sits under the "+"
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(400);
    const E = await page.evaluate(() => { const last = [...document.querySelectorAll(".fb-stream>*")].pop().getBoundingClientRect(), tabs = document.querySelector(".es-tabs").getBoundingClientRect(), f = document.querySelector(".pc-fab"), fr = f?.getBoundingClientRect(), fs = f && getComputedStyle(f);
      return { last: last.bottom, tabs: tabs.top, fabInTabs: !f || fs.display === "none" || fs.opacity === "0" || fs.pointerEvents === "none" || fr.top >= tabs.top - 60 }; });
    assert.ok(E.last <= E.tabs, "the last card ends above the tab bar"); assert.ok(E.fabInTabs);
    assert.ok(R.cls < 0.05, "covers keep their space while they load (CLS " + R.cls + ")"); assert.equal(R.overflowX, false);
    assert.deepEqual(errs, []); assert.deepEqual(bad, []);
    await ctx.close();
  } finally { await browser.close(); }
});

test("on a wide screen: one 600px column, and the + never sits on a control of a post", async (t) => {
  let pw; try { pw = createRequire(import.meta.url)("playwright"); } catch { return t.skip("playwright is not installed"); }
  let browser; try { browser = await pw.chromium.launch(); } catch { return t.skip("no Chromium here"); }
  try {
    // signed out on a phone the "+" floats above the tab bar, so that view is checked too
    for (const [w, out] of [[1280, false], [900, false], [390, true]]) {
      const { ctx, page, errs, bad } = await open(pw, browser, { w, h: 800, out, phone: w < 700 });
      const C = await page.evaluate(() => { const cards = [...document.querySelectorAll(".fb-stream>*")].map((c) => c.getBoundingClientRect()), rail = document.querySelector("#rail,.fv-rail")?.getBoundingClientRect(); return { ws: [...new Set(cards.map((r) => Math.round(r.width)))], lefts: [...new Set(cards.map((r) => Math.round(r.left)))], rail: rail ? Math.round(rail.left) : null, cls: window.__cls, overflowX: document.documentElement.scrollWidth > innerWidth }; });
      assert.equal(C.ws.length, 1, "one column width at " + w); assert.ok(w < 700 ? C.ws[0] === 358 : C.ws[0] >= 560 && C.ws[0] <= 600, "the column is 560 to 600px at " + w + ": " + C.ws[0]); assert.equal(C.lefts.length, 1);
      assert.ok(C.cls < 0.05, "CLS " + C.cls); assert.equal(C.overflowX, false);
      // bring each control of a post level with the "+": where they would meet, the "+" has stepped aside
      const hits = await page.evaluate(async () => { const f = document.querySelector(".pc-fab"), out = []; if (!f) return out;
        for (const el of document.querySelectorAll(".fb-stream :is(.fb-act,.fb-follow-in,.fb-cta,[data-fb-follow],.fb-fc button)")) { const r0 = el.getBoundingClientRect(); if (!r0.width) continue; const fr0 = f.getBoundingClientRect();
          scrollBy(0, r0.top + r0.height / 2 - (fr0.top + fr0.height / 2)); await new Promise((r) => setTimeout(r, 160));
          const r = el.getBoundingClientRect(), fr = f.getBoundingClientRect(), s = getComputedStyle(f), meet = r.left < fr.right && r.right > fr.left && r.top < fr.bottom && r.bottom > fr.top;
          if (meet && !(s.opacity === "0" || s.pointerEvents === "none" || s.display === "none")) out.push((el.className || el.tagName) + " @" + Math.round(r.left)); }
        return out; });
      assert.deepEqual(hits, [], "the + covers a control at " + w);
      assert.deepEqual(errs, []); assert.deepEqual(bad, []);
      await ctx.close();
    }
  } finally { await browser.close(); }
});
