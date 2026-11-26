// Brand kits: one font pairing, palette, corners, buttons, cover style, logo and voice per host (server/brandkit.js,
// public/brandkit.js). The kit is cleaned against a whitelist, its colours pass AA, event looks inherit its fonts unless
// the host overrides them, existing hosts get a kit from their page theme, and a page never mixes more than two families.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { BK, PAIRS, STARTERS, cleanKit, kitOf, migrateKit, suggestKit, emailBrand, emailHtml, brandKitHead, cleanVoice } from "../server/brandkit.js";
import { cleanLook } from "../server/looks.js";
import { fakeOutbox } from "../server/email.js";

const plain = (v) => JSON.parse(JSON.stringify(v));
const pub = (f) => fs.readFileSync(new URL("../public/" + f, import.meta.url), "utf8");
// the browser scripts with a bare window (no document): the same code the pages run
function browser() { const window = {}; const ctx = { window, console };
  for (const f of ["color.js", "brandkit.js", "looks.js"]) vm.runInNewContext(pub(f), Object.assign(ctx, { document: undefined }));
  return { C: window.EncoreColor, K: window.EncoreBrandKit }; }

import { resetLoginLimits } from "../server/auth.js";
let srv; before(async () => { process.env.ENCORE_FAKE_EMAIL = "1"; srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "brandkit-secret-0123456789"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv.close(); });
const J = { "Content-Type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
async function host(name, email, handle, extra = {}) { const r0 = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); const c = cookieOf(r0), ws = (await r0.json()).workspace.id;
  const r = await post("/api/host/profile", { handle, name, ...extra }, c); assert.equal(r.status, 200, await r.clone().text()); return { c, ws }; }

test("the curated set: 6 to 8 pairings, each a display face and a body face, and 6 to 8 starter kits that use them", () => {
  const P = Object.entries(PAIRS), S = Object.entries(STARTERS);
  assert.ok(P.length >= 6 && P.length <= 8, "6 to 8 pairings"); assert.ok(S.length >= 6 && S.length <= 8, "6 to 8 starters");
  for (const [k, p] of P) { assert.ok(p.display && p.body && p.display !== p.body, k + ": two different faces"); assert.match(p.q, /^[A-Za-z0-9+:;@.&=,]+$/, k + ": a Google Fonts query"); }
  for (const need of ["house", "terminal", "arcade", "pantry"]) assert.ok(PAIRS[need], need + " pairing");
  assert.equal(PAIRS.house.display, "Instrument Serif"); assert.equal(PAIRS.house.body, "Instrument Sans", "the house pair is the current brand");
  assert.match(PAIRS.terminal.display, /Mono/, "a mono accent for the Terminal crowd"); assert.match(PAIRS.pantry.display, /Slab/, "a slab pair"); assert.equal(PAIRS.arcade.display, "Silkscreen", "a pixel pair");
  for (const [k, s] of S) assert.ok(PAIRS[s.pair] && s.label && s.vibe, k + ": a pairing, a name and a vibe");
  assert.equal(STARTERS.house.page, "#F4F0E8"); assert.equal(STARTERS.house.accent, "#9A4128", "the house kit is Bone and Clay");
});

test("cleaning: unknown keys dropped, values whitelisted, hex normalised, the logo from the blob store, the voice line plain", () => {
  const k = plain(cleanKit({ pair: "comic-sans", page: "#fbf6ef", surface: "white", ink: "#2b211c", accent: "#e0a030", accent2: "nope", corners: "round", buttons: "ghost", cover: "video",
    logo: "https://evil.example/x.png", voice: "Twelve seats — seven courses <b>and</b>\ncake " + "x".repeat(120), evil: "<script>", style: "x" }, null));
  assert.deepEqual(Object.keys(k).sort(), ["accent", "accent2", "at", "corners", "cover", "buttons", "ink", "logo", "page", "pair", "starter", "surface", "v", "voice"].sort());
  assert.equal(k.pair, "house", "an unknown pairing falls back"); assert.equal(k.page, "#FBF6EF"); assert.equal(k.accent, "#E0A030"); assert.equal(k.surface, STARTERS.house.surface, "a bad colour falls back");
  assert.equal(k.corners, "soft"); assert.equal(k.buttons, "pill"); assert.equal(k.cover, "lineart"); assert.equal(k.logo, "", "only /_blob/ logos");
  assert.ok(k.voice.length <= 80 && !/[<>\n—]/.test(k.voice) && k.voice.startsWith("Twelve seats, seven courses"), "no markup, newlines or em dashes");
  assert.equal(cleanVoice("Saturdays — cake – coffee"), "Saturdays, cake, coffee");
  assert.equal(plain(cleanKit({ logo: "/_blob/AbCdEfGhIjKlMnOpQrSt" }, null)).logo, "/_blob/AbCdEfGhIjKlMnOpQrSt");
  // a starter taken whole, and a partial edit keeps the rest of the current kit
  const t = plain(cleanKit({ starter: "terminal", fromStarter: true }, null)); assert.equal(t.pair, "terminal"); assert.equal(t.starter, "terminal"); assert.equal(t.buttons, "outline");
  const e = plain(cleanKit({ accent: "#2F5FD0" }, t)); assert.equal(e.pair, "terminal"); assert.equal(e.accent, "#2F5FD0"); assert.equal(e.buttons, "outline");
  assert.equal(cleanKit("supper", t), t, "not an object: nothing changes"); assert.equal(cleanKit(["x"], null), null);
});

test("AA: every starter, and any colours a host types, read at 4.5:1 (text, quiet text, button text, accent text) and buttons stand out at 3:1", () => {
  const all = (k) => BK.checks(k).every((c) => c.ok);
  for (const [id, s] of Object.entries(STARTERS)) assert.ok(all(s), id + ": " + JSON.stringify(plain(BK.checks(s))));
  // hostile picks: light ink on a light page, a pale accent, a dark page (kept light: dark moods belong to event looks)
  const bad = [{ pair: "supper", page: "#FFFFFF", surface: "#FFFFFF", ink: "#EEEEEE", accent: "#FFF3B0" }, { pair: "house", page: "#111111", surface: "#222222", ink: "#333333", accent: "#0A0A0A" }, { pair: "studio", page: "#FFE08A", surface: "#FFE08A", ink: "#FFD000", accent: "#FFD000", accent2: "#FFFFFF" }];
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647); const hx = () => "#" + Math.floor(rnd() * 0xffffff).toString(16).padStart(6, "0").toUpperCase();
  for (let i = 0; i < 300; i++) bad.push({ pair: "house", page: hx(), surface: hx(), ink: hx(), accent: hx(), accent2: hx() });
  for (const raw of bad) { const k = plain(cleanKit(raw, null)); assert.ok(all(k), JSON.stringify(raw) + " -> " + JSON.stringify(plain(BK.checks(k)))); assert.ok(BK.derive(k).page && BK.derive(k).ink); }
  // a kit's stored ink is the readable one, so what's saved is what's drawn
  const k = plain(cleanKit({ page: "#FFFFFF", surface: "#FFFFFF", ink: "#DDDDDD" }, null)); assert.notEqual(k.ink, "#DDDDDD");
});

test("the browser and the server agree: same pairings, starters and variables", () => {
  const { K } = browser();
  assert.deepEqual(Object.keys(K.PAIRS), Object.keys(PAIRS)); assert.deepEqual(plain(K.STARTERS), plain(STARTERS));
  const v = plain(K.vars(STARTERS.supper)); for (const n of ["--kit-display", "--kit-body", "--kit-page", "--kit-surface", "--kit-ink", "--kit-accent", "--kit-btn", "--kit-on-btn", "--kit-r-card", "--kit-r-btn"]) assert.ok(v[n], n);
  assert.match(v["--kit-display"], /Playfair Display/); assert.match(v["--kit-body"], /Lato/);
  assert.equal(plain(K.vars({ ...STARTERS.supper, corners: "crisp" }))["--kit-r-btn"], "8px"); assert.equal(plain(K.vars(STARTERS.house))["--kit-r-btn"], "12px");
});

test("event looks inherit the kit: fonts from the kit unless the event overrides; no look draws from the kit; older looks keep theirs", () => {
  const { K } = browser(); const supper = STARTERS.supper, house = STARTERS.house;
  // a look saved since kits (kit: 1) with a vibe's font: the kit's display face wins
  const vibe = { kit: 1, palette: ["#0E1411", "#7CF29A", "#F2B84B"], titleFont: "mono", vibe: "terminal" };
  assert.equal(plain(K.lookFor(vibe, supper)).titleFont, undefined); assert.equal(K.ownFont(vibe), false);
  // the host picked a font for this event: it wins (until "Use my brand")
  const own = { ...vibe, ownFont: true }; assert.equal(plain(K.lookFor(own, supper)).titleFont, "mono"); assert.equal(K.ownFont(own), true);
  // a look from before kits keeps its font
  const legacy = { palette: ["#6E0F1F"], titleFont: "serif" }; assert.equal(plain(K.lookFor(legacy, supper)).titleFont, "serif"); assert.equal(K.ownFont(legacy), true);
  // a new event with no look: the kit's colours (and its card deck covers); the house kit changes nothing
  const n = plain(K.lookFor({}, { ...supper, cover: "deck" })); assert.equal(n.kit, 1); assert.equal(n.palette.length, 3); assert.equal(n.coverStyle, "deck"); assert.equal(n.titleFont, undefined);
  assert.deepEqual(plain(K.lookFor({}, house)), {}, "the house kit leaves an event as it is");
  // the server keeps the markers, and only valid ones
  assert.deepEqual(cleanLook({ titleFont: "mono", kit: 1, ownFont: true }), { titleFont: "mono", kit: 1, ownFont: true });
  assert.deepEqual(cleanLook({ kit: "yes", ownFont: "true", effect: "snow" }), { effect: "snow" });
  assert.deepEqual(cleanLook({ kit: 1, ownFont: true }), { kit: 1 }, "ownFont without a font means nothing");
  // looks-app: "Use my brand" is the reset, and an explicit font pick sets ownFont
  const app = pub("looks-app.js"); assert.match(app, /Use my brand/); assert.match(app, /ownFont: b\.dataset\.font \? true : undefined/);
});

test("migration: an existing host's kit comes from their page theme and font, so nothing jumps; the house default is the current brand", () => {
  assert.deepEqual(plain(kitOf({ theme: {} })).pair, "house"); assert.equal(plain(kitOf({ theme: {} })).page, STARTERS.house.page, "an untouched page is the house brand");
  const bo = plain(kitOf({ theme: { accent: "#E0A030", font: "editorial", bg: "night", buttons: "square" } }));
  assert.equal(bo.pair, "supper", "editorial is the serif pair (Playfair Display + Lato)"); assert.equal(bo.accent, "#E0A030"); assert.equal(bo.corners, "crisp"); assert.equal(bo.from, "theme");
  const fl = plain(kitOf({ theme: { accent: "#1F3D30", font: "florist", bg: "petal" } })); assert.equal(fl.pair, "florist"); assert.equal(fl.page, "#F4E9EC");
  assert.equal(plain(kitOf({ theme: { font: "modern", bg: "white", accent: "#3E9C6E" } })).pair, "studio");
  assert.equal(plain(kitOf({ theme: { font: "classic", bg: "sage", accent: "#3E9C6E" } })).pair, "house", "classic has always drawn as the house face");
  // an untouched page wears its latest event's look (as public/storefront.js does), so its kit matches
  assert.equal(plain(kitOf({ theme: {} }, [{ look: { vibe: "terminal" } }])).pair, "studio");
  assert.equal(plain(kitOf({ theme: { font: "editorial" } }, [{ look: { vibe: "terminal" } }])).pair, "supper", "a page that picked a theme keeps it");
  // a saved kit wins
  const saved = plain(cleanKit({ starter: "arcade", fromStarter: true }, null)); assert.equal(plain(kitOf({ theme: { font: "editorial" }, brandKit: saved })).pair, "arcade");
  assert.equal(migrateKit({ theme: { font: "bold" } }).pair, "market");
});

test("suggestions for new hosts: from their first event's look, else what they host", () => {
  assert.equal(suggestKit({}, [{ look: { vibe: "terminal" }, title: "Hack night" }]).starter, "terminal");
  assert.equal(suggestKit({}, [{ activity: "hack night", title: "Build club" }]).starter, "terminal");
  assert.equal(suggestKit({}, [{ title: "Friendsgiving potluck" }]).starter, "pantry");
  assert.equal(suggestKit({}, [{ title: "Board game night" }]).starter, "arcade");
  assert.equal(suggestKit({ tags: ["flowers"] }, []).starter, "florist");
  assert.equal(suggestKit({}, []).starter, "house");
  assert.match(suggestKit({}, [{ activity: "dinner" }]).why, /dinners/);
});

test("two families at most: every element in the body face, display and titles in the display face, prices and chips in the body face", () => {
  const css = pub("brandkit.css");
  assert.match(css, /html\.kit-on body :where\(\*:not\([^)]*\)\)\{font-family:var\(--kit-body\)!important\}/, "the body face everywhere");
  assert.match(css, /html\.kit-on body :where\(h1,h2,[^)]*\.nu-title[^)]*\)[^{]*\{font-family:var\(--kit-display\)!important/, "the display face for display and titles");
  // small headings read in the body face at 600, never the display face
  assert.match(css, /html\.kit-on body :where\(h3\)[^{]*\{font-family:var\(--kit-body\)!important;font-weight:600!important/, "h3 in the body face");
  // the only families a kit page names are the kit's own two
  const fams = new Set([...css.matchAll(/font(?:-family)?:[^;}]*/g)].map((m) => m[0]).filter((d) => !/var\(--kit-/.test(d) && /"[A-Z]/.test(d) && !/Instrument Sans|Fredoka/.test(d)));
  assert.deepEqual([...fams], [], "no third family hard-coded for kit pages");
  // the Next up card: menu and price in the body face, chips calm, the Example only badge in the token style
  for (const [sel, want] of [[".nu-menu li", /var\(--kit-body\)/], [".nu-price", /var\(--kit-body\)/], [".nu-meta span", /var\(--kit-body\)/], [".ex-off", /var\(--kit-r-btn\)/]]) {
    const rule = css.split("\n").find((l) => l.includes(sel) && want.test(l)); assert.ok(rule, sel); }
  assert.doesNotMatch(css.split("\n").find((l) => l.includes(".nu-price{")), /--kit-display/, "the price is never the display face");
});

test("the kit is set once per page: host page, /g, the light invite, story cards and /x pages all load it", () => {
  assert.match(pub("host.html"), /<script src="\/brandkit\.js"><\/script><script src="\/storefront\.js">/);
  assert.match(pub("storefront.js"), /BK\.storeTokens\(\)/, "the storefront's variables point at the kit");
  assert.match(pub("looks.js"), /BK\.eventFor\(e, el/); assert.match(pub("looks.js"), /BK\.after\(el, e\)/);
  assert.match(pub("feedvisual.js"), /EncoreBrandKit\?\.storyStyle\(e\.host\)/, "story cards: face and accent only"); assert.match(pub("invite.html"), /BK\?\.use\(h\.kit\)/, "the light invite wears its host's kit");
  const idx = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8"); assert.match(idx, /<script src="\/brandkit\.js"><\/script>/); assert.match(idx, /EncoreBrandKit\?\.use\(j\.host\.kit\)/);
  assert.ok(pub("invite.html").length < 40000, "the light invite stays under its cap");
  const head = brandKitHead({ theme: { font: "editorial", accent: "#E0A030" } });
  assert.match(head, /fonts\.googleapis\.com\/css2\?family=Playfair\+Display/); assert.match(head, /<style>html\{--kit-display:"Playfair Display"/); assert.match(head, /window\.__encoreKit=\{/); assert.doesNotMatch(head, /<\/script><script>alert/);
});

test("the API: a host reads, is suggested and saves a kit; it's on their page, events, invite and story cards; logos are checked", async () => {
  const { c, ws } = await host("Kai Moreno", "kai.bk@example.com", "kai-builds", { tagline: "Hack nights" });
  await fetch(srv.base + "/api/db/doc?path=events/bkhack", { method: "PUT", headers: { ...J, cookie: c }, body: JSON.stringify({ name: "Hack night", pubTitle: "Hack night", activity: "hack night", kind: "social", casual: true, date: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10), discoverable: true }) });
  let j = await (await fetch(srv.base + "/api/host/brandkit", { headers: { cookie: c } })).json();
  assert.equal(j.saved, false); assert.equal(j.kit.pair, "house", "nothing picked yet: the house kit"); assert.equal(j.suggest.starter, "terminal", "a hack night suggests Terminal");
  assert.ok([401, 403].includes((await fetch(srv.base + "/api/host/brandkit")).status), "sign in first");
  // one tap
  let r = await post("/api/host/brandkit", { starter: "terminal", fromStarter: true }, c); j = await r.json(); assert.equal(r.status, 200); assert.equal(j.kit.pair, "terminal"); assert.equal(j.saved, true);
  // Make it yours: a voice line becomes the tagline too, no em dashes
  r = await post("/api/host/brandkit", { accent: "#2F5FD0", voice: "Ship one small thing — every other Thursday", evil: 1 }, c); j = await r.json();
  assert.equal(j.kit.accent, "#2F5FD0"); assert.equal(j.kit.pair, "terminal"); assert.equal(j.kit.voice, "Ship one small thing, every other Thursday"); assert.equal(j.kit.evil, undefined);
  const pubHost = await (await fetch(srv.base + "/api/public/host/kai-builds")).json(); assert.equal(pubHost.host.kit.pair, "terminal"); assert.equal(pubHost.host.tagline, "Ship one small thing, every other Thursday");
  const eh = await (await fetch(srv.base + "/api/public/event-host/bkhack")).json(); assert.equal(eh.host.kit.pair, "terminal", "event pages get the kit");
  const inv = await (await fetch(srv.base + "/e/bkhack")).text(); assert.match(inv, /<script src="\/brandkit\.js"><\/script>/); assert.ok(inv.length < 40000, "the light invite stays small with a kit: " + inv.length);
  // other profile saves keep the kit
  await post("/api/host/profile", { bio: "Bring a laptop." }, c); assert.equal((await (await fetch(srv.base + "/api/host/brandkit", { headers: { cookie: c } })).json()).kit.pair, "terminal");
  // logos: an image this workspace uploaded, not svg, not someone else's, not a made-up id
  const png = Buffer.from("89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA63F8CFC0F01F0005000201E2B3D2A60000000049454E44AE426082", "hex");
  const up = await (await fetch(srv.base + "/api/assets", { method: "POST", headers: { "Content-Type": "image/png", cookie: c }, body: png })).json();
  r = await post("/api/host/brandkit", { logo: up.url }, c); assert.equal(r.status, 200); assert.equal((await r.json()).kit.logo, up.url);
  const svg = await (await fetch(srv.base + "/api/assets", { method: "POST", headers: { "Content-Type": "image/svg+xml", cookie: c }, body: "<svg xmlns='http://www.w3.org/2000/svg'/>" })).json();
  if (svg.url) assert.equal((await post("/api/host/brandkit", { logo: svg.url }, c)).status, 400, "no svg logos");
  assert.equal((await post("/api/host/brandkit", { logo: "/_blob/AAAAAAAAAAAAAAAAAAAA" }, c)).status, 400, "a logo that isn't there");
  const other = await host("Bea Baker", "bea.bk@example.com", "bea-bakes");
  assert.equal((await post("/api/host/brandkit", { logo: up.url }, other.c)).status, 400, "someone else's upload");
  // reset: back to the kit from the page theme
  r = await post("/api/host/brandkit", { reset: true }, c); j = await r.json(); assert.equal(j.saved, false);
  void ws;
});

test("guest emails wear the host's accent and logo; the text stays the same", async () => {
  const b = emailBrand({ name: "Bo's Omecasa", handle: "bo", brandKit: plain(cleanKit({ starter: "supper", fromStarter: true, logo: "/_blob/AbCdEfGhIjKlMnOpQrSt" }, null)) });
  assert.equal(b.name, "Bo's Omecasa"); assert.match(b.accent, /^#[0-9A-F]{6}$/); assert.equal(b.logo, "/_blob/AbCdEfGhIjKlMnOpQrSt");
  const { C } = browser(); assert.ok(C.contrast(b.accent, "#FFFFFF") >= 4.5, "the accent reads on white");
  const h = emailHtml("Hi Ana,\n\nSee you Sat. <script>x</script>\nhttps://example.com/g#rsvp-1", b, "https://pottery.example");
  assert.match(h, new RegExp("border-top:4px solid " + b.accent)); assert.match(h, /<img src="https:\/\/pottery\.example\/_blob\/AbCdEfGhIjKlMnOpQrSt"/); assert.match(h, /&lt;script&gt;/); assert.doesNotMatch(h, /<script>/);
  assert.match(h, /<a href="https:\/\/example\.com\/g#rsvp-1"/);
  // a follow confirmation goes out with HTML in the host's colours
  const { c } = await host("Ana Host", "ana.bk@example.com", "ana-hosts"); await post("/api/host/brandkit", { starter: "pantry", fromStarter: true }, c);
  const n0 = fakeOutbox.length; await post("/api/public/follow", { handle: "ana-hosts", email: "guest.bk@example.com", name: "Gus" });
  const m = fakeOutbox.slice(n0).find((x) => x.to.includes("guest.bk@example.com"));
  assert.ok(m, "a follow confirmation"); { assert.ok(m.html, "an HTML part"); assert.match(m.html, /border-top:4px solid #/); assert.match(m.text, /following/i); }
});

// Rendered check (Playwright, when it's installed): the host page and the light invite each use at most two font families,
// and they're the kit's two. Skipped where there's no browser.
test("rendered: a host page and its invite use at most two families, the kit's; the Next up card uses kit roles", async (t) => {
  let chromium; try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch { return t.skip("no playwright"); }
  let br; try { br = await chromium.launch(); } catch { return t.skip("no browser"); }
  try {
    const { c } = await host("Bo Test", "bo.render@example.com", "bo-render", { theme: { accent: "#E0A030", font: "editorial", bg: "cream", buttons: "square" } });
    await fetch(srv.base + "/api/db/doc?path=events/bkdin", { method: "PUT", headers: { ...J, cookie: c }, body: JSON.stringify({ name: "Omakase at home", pubTitle: "Omakase at home: Autumn in Kyoto", dinnerTheme: "Autumn in Kyoto", activity: "cooking night", kind: "social", casual: true, date: new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10), startTime: "19:00", headcount: 12, price: "$65", discoverable: true, courses: ["Hamachi, yuzu kosho, shiso", "Miso black cod", "Hojicha panna cotta"] }) });
    const p = await br.newPage({ viewport: { width: 390, height: 844 } }); await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const families = () => p.evaluate(() => { const S = new Set(), w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) { const tx = w.currentNode, el = tx.parentElement; if (!tx.textContent.trim() || !el || el.closest("svg,script,style,[hidden],.kit-off")) continue; const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
        if (/^[\p{Extended_Pictographic}\s‍️·|•]+$/u.test(tx.textContent)) continue; S.add(getComputedStyle(el).fontFamily.split(",")[0].replace(/["']/g, "").trim()); } return [...S]; });
    for (const url of ["/@bo-render", "/e/bkdin"]) { await p.goto(srv.base + url, { waitUntil: "load" }); await p.waitForTimeout(1500);
      const F = await families(); assert.ok(F.length <= 2, url + ": " + F.join(", ")); for (const f of F) assert.ok(["Playfair Display", "Lato"].includes(f), url + ": " + f); }
    // the Next up card: the title in the display face; chips, the menu and the price in the body face, the menu at body size
    await p.goto(srv.base + "/@bo-render", { waitUntil: "load" }); await p.waitForSelector("#nextUp .nu-menu li", { timeout: 8000 });
    const nu = await p.evaluate(() => Object.fromEntries([".nu-title", ".nu-menu li", ".nu-price", ".nu-meta span"].map((s) => [s, getComputedStyle(document.querySelector("#nextUp " + s)).fontFamily.split(",")[0].replace(/"/g, "")])));
    assert.deepEqual(nu, { ".nu-title": "Playfair Display", ".nu-menu li": "Lato", ".nu-price": "Lato", ".nu-meta span": "Lato" });
    assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector("#nextUp .nu-menu li")).fontSize), "16px");
  } finally { await br.close(); }
});

test("reading guardrails: body text at 16px or more, the body face never a script or thin face, thin display faces only at 24px and up", () => {
  const css = pub("brandkit.css");
  assert.match(css, /html\.kit-on body\{font-size:max\(var\(--kit-fs-body\),var\(--kit-body-min,16px\)\)\}/);
  assert.match(css, /html\.kit-thin\{--kit-fs-title:max\([^;]*,24px\)\}/);
  assert.equal(BK.GUARD.bodyMin, 16);
  for (const [k, P] of Object.entries(BK.PAIRS)) { assert.ok(BK.bodyOk(P), `${k}: ${P.body} is a sturdy text face`);
    const v = BK.vars({ ...BK.starter(k) }); assert.equal(v["--kit-body-min"], "16px"); assert.equal(v["--kit-display-min"], P.thin ? "24px" : "20px", k); }
  for (const f of ["Dancing Script", "Pacifico Script", "Raleway Thin", "Silkscreen", "IBM Plex Mono", "Archivo Black"]) assert.ok(!BK.bodyOk({ body: f }), `${f} is never body text`);
  // a script, thin or display-only body is refused on save: the kit keeps its pairing
  assert.equal(BK.PAIRS.house.thin, true); assert.equal(BK.PAIRS.florist.thin, true);
  // every starter kit: text, quiet text, button label and accent text at AA; the button edge at 3:1
  for (const k of Object.keys(BK.STARTERS)) for (const c of BK.checks(BK.starter(k))) assert.ok(c.ok, `${k} ${c.label} ${c.ratio}`);
});
