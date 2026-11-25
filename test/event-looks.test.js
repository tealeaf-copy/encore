// Per-event looks ("Make it yours"): the server keeps only allow-listed values, guests get the look on /e/:id,
// the colour helpers pick readable ink, and a portrait flyer shows whole by default.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { cleanLook, withCleanLook, fitOf, LOOK } from "../server/looks.js";

// the browser scripts, run with a bare window
function browser() { const window = { devicePixelRatio: 1 }; const ctx = { window, console };
  for (const f of ["color.js", "looks.js", "storefront.js"]) vm.runInNewContext(fs.readFileSync(new URL("../public/" + f, import.meta.url), "utf8"), Object.assign(ctx, { document: undefined, localStorage: {} }));
  return { C: window.EncoreColor, LK: window.EncoreLooks, S: window.EncoreStore }; }
const plain = (v) => JSON.parse(JSON.stringify(v)); // values from the vm, compared as plain data

test("sanitizing: bad hex and unknown values are dropped, good ones kept", () => {
  const o = cleanLook({ palette: ["#a9c3a4", "red", "#12345", "#1F1A17;", "#C94A30", "#FFFFFF"], effect: "lava", titleFont: "Comic Sans", buttonEmoji: "💣", buttonLabel: "Buy now", vibe: "rave", coverFit: "stretch", extra: "<script>", lights: "yes" });
  assert.deepEqual(o, { palette: ["#A9C3A4", "#C94A30", "#FFFFFF"] }, "only hex colours survive, upper-cased, three at most");
  const k = cleanLook({ palette: ["#6E0F1F"], effect: "velvet", titleFont: "serif", buttonEmoji: "🏺", buttonLabel: "Save my spot", vibe: "velvet", lights: true, coverFit: "banner", coverW: 800, coverH: 1200 });
  assert.deepEqual(k, { palette: ["#6E0F1F"], effect: "velvet", titleFont: "serif", buttonEmoji: "🏺", buttonLabel: "Save my spot", vibe: "velvet", lights: true, coverW: 800, coverH: 1200, coverFit: "banner" });
  assert.equal(cleanLook("snow"), null); assert.equal(cleanLook([1, 2]), null);
  // the update callout: one short plain line, with a time
  const u = cleanLook({ update: { text: "Moved to <b>The Progress</b>\nthis year " + "x".repeat(100), at: "soon" } });
  assert.ok(u.update.text.length <= 80 && !/[<>\n]/.test(u.update.text)); assert.ok(Number.isInteger(u.update.at) && Math.abs(u.update.at - Date.now()) < 5000);
  assert.equal(cleanLook({ update: { text: "   " } }).update, undefined, "an empty update isn't kept");
  // dotted keys can't slip past the check
  assert.deepEqual(withCleanLook({ name: "x", "look.effect": "lava", look: { effect: "snow" } }), { name: "x", look: { effect: "snow" } });
  assert.deepEqual(withCleanLook({ name: "y" }), { name: "y" });
});

test("a portrait flyer shows whole by default; a wide one is a banner unless the host picks", () => {
  assert.equal(fitOf({ coverW: 1080, coverH: 1350 }), "poster");
  assert.equal(fitOf({ coverW: 1600, coverH: 900 }), "banner");
  assert.equal(fitOf({ coverW: 1200, coverH: 1200, coverFit: "poster" }), "poster");
  assert.equal(fitOf({ coverW: 800, coverH: 1200, coverFit: "banner" }), "banner");
  assert.equal(fitOf({}), "banner");
  assert.equal(cleanLook({ coverW: 1080, coverH: 1350 }).coverFit, "poster", "saved as a poster when tall");
  const { LK } = browser();
  for (const L of [{ coverW: 1080, coverH: 1350 }, { coverW: 1600, coverH: 900 }, { coverW: 800, coverH: 1200, coverFit: "banner" }, {}]) assert.equal(LK.fitOf(L), fitOf(L), "the page and the server agree");
  const img = LK.coverHTML({ coverPhoto: "/_blob/abcdefghij0123456789", name: "Jazz night", look: { coverW: 1080, coverH: 1350 } });
  assert.match(img, /width="1080" height="1350"/, "size reserved, so nothing jumps"); assert.match(img, /alt="Flyer for Jazz night"/);
  assert.equal(LK.coverHTML({ coverPhoto: "javascript:alert(1)" }), "");
});

test("the contrast helper picks readable ink and a button that passes", () => {
  const { C, LK } = browser();
  for (const dom of ["#A9C3A4", "#EFE2C6", "#C4DDF3", "#6E0F1F", "#F4E9EC", "#2A1B14", "#FFE08A", "#5A0F1E", "#1F4D36", "#FF00FF", "#777777"]) {
    for (const acc of [[], ["#F2C46D"], ["#FFFFFF"], ["#1F1A17"], ["#E26D8E"]]) {
      const T = C.pageFrom(dom, acc);
      assert.ok(C.worst(T.ink, [T.top, T.bot]) >= 4.5, `ink on ${dom}`);
      assert.ok(C.worst(T.soft, [T.top, T.bot]) >= 4.5, `soft text on ${dom}`);
      assert.ok(C.worst(T.btn, [T.top, T.bot]) >= 3, `button stands out on ${dom} with ${acc}`);
      assert.ok(C.contrast(T.onBtn, T.btn) >= 4.5, `button text on ${dom} with ${acc}`);
      assert.ok(C.contrast(T.cardInk, T.card) >= 4.5, `card text on ${dom}`);
    } }
  assert.equal(C.pageFrom("#6E0F1F").dark, true, "a deep red gets a dark page"); assert.equal(C.pageFrom("#C4DDF3").dark, false, "icy blue stays light");
  assert.equal(C.inkFor(["#FFFFFF"]) !== "#FFFFFF", true); assert.ok(C.contrast(C.inkFor(["#111111"]), "#111111") >= 4.5);
  // a contrasting page for a dark flyer is dark too (forest green gets a wine red)
  const cp = C.contrastPage("#1F4D36"); assert.ok(C.lum(cp) < 0.2); const h = C.hsl(cp)[0]; assert.ok(h > 300 || h < 20, "a red, not another green");
  // the host pages use the same helpers
  const { S } = browser(); assert.ok(S && S.FONTS, "storefront.js still loads beside color.js");
  // every vibe passes the guardrail as well
  for (const v of Object.values(LK.VIBES)) { const T = LK.colors(v.look); assert.ok(C.worst(T.ink, [T.top, T.bot]) >= 4.5); }
});

test("a palette from pixels: the dominant colour and two accents, not the white paper or black type", () => {
  const { C } = browser(); const px = [], put = (hex, n) => { const [r, g, b] = C.rgb(hex); for (let i = 0; i < n; i++) px.push(r, g, b, 255); };
  put("#FFFFFF", 4000); put("#111111", 2000); put("#93B38D", 3000); put("#F2D36B", 600); put("#E26D8E", 300); put("#95B58F", 400);
  const p = C.paletteFromPixels(new Uint8ClampedArray(px));
  assert.equal(p.length, 3); assert.ok(C.contrast(p[0], "#93B38D") < 1.1, "sage is dominant: " + p[0]);
  assert.ok(p.slice(1).some((c) => C.contrast(c, "#F2D36B") < 1.1) && p.slice(1).some((c) => C.contrast(c, "#E26D8E") < 1.1), "the yellow and the pink are the accents: " + p);
  assert.deepEqual(plain(C.paletteFromPixels(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]))), [], "nothing but paper and ink: no palette");
});

test("the page offers what the server keeps, and the reply button keeps Ask to join", () => {
  const { LK, S } = browser();
  assert.deepEqual(plain(LK.EFFECTS.map(([k]) => k)), LOOK.effects); assert.deepEqual(plain(Object.keys(LK.FONTS)), LOOK.titleFonts);
  assert.deepEqual(plain(LK.LABELS), LOOK.buttonLabels); assert.deepEqual(plain(LK.EMOJI), LOOK.buttonEmoji); assert.deepEqual(plain(Object.keys(LK.VIBES)), LOOK.vibes);
  assert.equal(LK.EMOJI.length, 24);
  for (const [k, v] of Object.entries(LK.VIBES)) assert.deepEqual(cleanLook(plain({ ...v.look, vibe: k })), plain({ ...v.look, vibe: k }), `${k} saves as it is`);
  // Flower shop is the host page's Flower shop look
  assert.equal(LK.VIBES.flower.look.palette[0], S.BGS[S.LOOKS.florist.set.bg].bg.toUpperCase()); assert.equal(LK.VIBES.flower.look.palette[1], S.LOOKS.florist.set.accent);
  assert.equal(LK.buttonText({ look: { buttonEmoji: "🎷", buttonLabel: "Count me in" } }), "🎷 Count me in");
  assert.equal(LK.buttonText({ approvalRequired: true, look: { buttonEmoji: "🌿", buttonLabel: "Join" } }), "🌿 Ask to join");
  assert.equal(LK.buttonText({}, "I'm in"), "I'm in");
  // Surprise me suits the event
  for (let i = 0; i < 20; i++) { assert.ok(["winter", "velvet"].includes(LK.surprise({ name: "Holiday benefit" }).vibe)); assert.equal(LK.surprise({ name: "Pottery workshop", approvalRequired: true }).buttonLabel, "Ask to join"); }
  assert.ok(["jazz", "garden"].includes(LK.surprise({ name: "Zine workshop" }).vibe));
});

let srv;
before(async () => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "looks-secret"; resetLoginLimits(); srv = await startServer(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET"]) delete process.env[k]; await srv.close(); });

test("the event save path cleans the look, and guests get it on the public event", async () => {
  const J = { "content-type": "application/json" }, day = new Date(Date.now() + 8 * 864e5).toISOString().slice(0, 10);
  const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name: "Rae Okafor", email: "rae.looks@example.com", password: "long-password-1", mode: "friends" }) });
  const c = r.headers.get("set-cookie").split(";")[0];
  const put = await fetch(srv.base + "/api/db/doc?path=events/looks1", { method: "PUT", headers: { ...J, cookie: c }, body: JSON.stringify({ kind: "social", casual: true, name: "Jazz night", date: day, published: true,
    look: { palette: ["#EFE2C6", "#zzz", "#1F1A17"], effect: "disco", titleFont: "bold", buttonEmoji: "🎷", buttonLabel: "I'm in", coverW: 1080, coverH: 1350, secret: "x" } }) });
  assert.equal(put.status, 200);
  const pub = await (await fetch(srv.base + "/api/db/doc?path=events/looks1", { headers: { "x-encore-guest": "1" } })).json();
  assert.deepEqual(pub.data.look, { palette: ["#EFE2C6", "#1F1A17"], titleFont: "bold", buttonEmoji: "🎷", buttonLabel: "I'm in", coverW: 1080, coverH: 1350, coverFit: "poster" });
  // a patch is checked too
  await fetch(srv.base + "/api/db/doc?path=events/looks1", { method: "PATCH", headers: { ...J, cookie: c }, body: JSON.stringify({ look: { effect: "snow", palette: ["javascript:1"] }, "look.effect": "lava" }) });
  const pub2 = await (await fetch(srv.base + "/api/db/doc?path=events/looks1", { headers: { "x-encore-guest": "1" } })).json();
  assert.deepEqual(pub2.data.look, { effect: "snow" });
  // a new event posted to the collection is cleaned the same way
  const post = await fetch(srv.base + "/api/db/collection?path=events", { method: "POST", headers: { ...J, cookie: c }, body: JSON.stringify({ kind: "social", casual: true, name: "Market", date: day, look: { effect: "twinkle", lights: true, update: { text: "Moved to The Progress", at: Date.now() - 1000 }, palette: ["#5a0f1e"] } }) });
  const pj = await post.json(), id = String(pj.id || pj.doc?.id || "").split("/").pop();
  const pub3 = await (await fetch(srv.base + "/api/db/doc?path=events/" + id, { headers: { "x-encore-guest": "1" } })).json();
  assert.equal(pub3.data.look.effect, "twinkle"); assert.equal(pub3.data.look.lights, true); assert.equal(pub3.data.look.update.text, "Moved to The Progress"); assert.deepEqual(pub3.data.look.palette, ["#5A0F1E"]);
  // the light invite loads the helpers and draws the look
  const html = await (await fetch(srv.base + "/e/looks1")).text();
  assert.match(html, /src="\/color\.js"/); assert.match(html, /src="\/looks\.js"/); assert.match(html, /LK\.apply\(document\.body, e\)/);
});

test("host pages: the house paper and headings only for the default look", () => {
  const css = fs.readFileSync(new URL("../public/playful.css", import.meta.url), "utf8"), sf = fs.readFileSync(new URL("../public/storefront.js", import.meta.url), "utf8");
  assert.match(css, /body:where\(:not\(\.store\),\.pl-house-bg\)\{background-color:var\(--p-paper\)!important/);
  assert.match(css, /:where\(body:not\(\.store\),body\.pl-house-font\) h1,/);
  assert.ok(!/(^|\n)h1,h2,h3,\.brand/.test(css), "no unscoped Fredoka headings left");
  assert.match(sf, /classList\.toggle\("pl-house-bg", t\.bg === DEF\.bg\)/); assert.match(sf, /classList\.toggle\("pl-house-font", t\.font === DEF\.font\)/);
});
