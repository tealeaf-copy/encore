// The one-thing page (/x/<handle>/<id> and /x/<handle>/shop/<n>, server/interest.js): a calm, photo-first page in the
// Field Notes kit. Checked here for every preview host and every kind, and for a real host's thing:
// - the host's own photo leads when there is one (Atelier Bò's pop-up photo), with a credit line; the drawn cover only
//   when there is none, and never with a kind label ("Market", "Hangout")
// - no emoji in the h1; Hosted by links to the host page; a facts table; one primary action
// - nothing that makes a phone page wider than the screen: every field at 16px or more (iOS zooms in on a smaller one,
//   and that zoom is what left the thanks state cut off at the right), no fixed widths, grid columns that can shrink
// - the thanks state is compact and has a next step (more from the host, similar hosts)
// - team size only on a team thing; gifts and shop items ask How many
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";

let srv; const S = {};
const J = { "content-type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const page = async (p) => { const r = await fetch(srv.base + p, { redirect: "manual" }); assert.equal(r.status, 200, p); return r.text(); };
const EMOJI = /\p{Extended_Pictographic}/u;
const h1Of = (h) => (h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || "";
const PRESETS = JSON.parse(fs.readFileSync(new URL("../public/presets/showcase.json", import.meta.url), "utf8"));

before(async () => {
  srv = await startServer();
  Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "xpage-secret", ENCORE_SIGNUP_PER_HOUR: "200", ENCORE_FAKE_EMAIL: "1", ENCORE_INTEREST_PER_IP_HOUR: "100" }); resetLoginLimits();
  const r = await post("/api/signup", { name: "Bo Tran", email: "bo.xpage@example.com", password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200);
  S.cookie = r.headers.get("set-cookie").split(";")[0];
  const p = await (await post("/api/host/profile", { handle: "bo-xpage", name: "Bo's kitchen", city: "Brooklyn", hood: "Bed-Stuy", forHire: true, experiences: [
    { name: "Dumpling class for your team", desc: "We fold, we steam, we eat.", emoji: "🥟", price: "$60", min: 8, max: 30, length: "2 hours", category: "food", includes: ["Aprons"], dietary: "Veggie fillings on request." },
    { name: "Supper at our table", desc: "A long table, family style.", emoji: "🍜", price: "$80", min: 2, max: 10, length: "3 hours", category: "dining" }],
    shop: { open: true, where: "Bed-Stuy", items: [{ id: "crisp01", name: "Chili crisp", desc: "Small batch.", emoji: "🌶️", cents: 1200, stock: 10, max: 4 }] } }, S.cookie)).json();
  S.team = p.host.experiences[0].id; S.supper = p.host.experiences[1].id;
});
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL", "ENCORE_INTEREST_PER_IP_HOUR"]) delete process.env[k]; await srv.close(); });

// every page this file renders for the preview hosts: each experience, gift and shop item, and "anything from them"
function previewPaths() { const out = [];
  for (const f of PRESETS) { const P = JSON.parse(fs.readFileSync(new URL(`../public/presets/${f}.json`, import.meta.url), "utf8")), h = P.handle || f;
    (P.experiences || []).forEach((_, i) => out.push(`/x/${h}/x${i}`)); (P.gifts || []).forEach((_, i) => out.push(`/x/${h}/g${i}`)); (P.shop?.items || []).forEach((_, i) => out.push(`/x/${h}/shop/${i}`)); out.push(`/x/${h}/any`); }
  return out; }

function looksRight(h, p) {
  const h1 = h1Of(h); assert.ok(h1, p + ": an h1"); assert.doesNotMatch(h1, EMOJI, p + ": no emoji in the h1");
  assert.match(h, /<p class="by">[\s\S]*?Hosted by <a href="\/@[a-z0-9-]+">/, p + ": Hosted by links to the host page");
  assert.doesNotMatch(h, /class="ea-label"/, p + ": no kind label on a drawn cover");
  assert.doesNotMatch(h, /—/, p + ": no em dashes");
  // the iOS zoom: every field (input, select, textarea) is 16px or more
  const field = h.match(/\.f input,\.f select,\.f textarea\{font:\d+ (\d+)px/); assert.ok(field && +field[1] >= 16, p + ": fields at 16px or more, so iOS doesn't zoom in");
  assert.doesNotMatch(h, /grid-template-columns:1fr 1fr/, p + ": two-up fields can shrink (minmax(0,1fr))");
  assert.doesNotMatch(h, /[^-]width:\s*\d{3,}px/, p + ": no fixed widths");
  assert.match(h, /<header class="top"><a class="brand" href="\/"[^>]*><img src="\/favicon\.svg"/, p + ": the mark in a quiet header");
  assert.match(h, /data-help-open>Help<\/a>/, p + ": a Help link");
  assert.match(h, /<section class="act" id="request"/, p + ": the request card");
}

test("every preview host's page, every kind: no emoji h1, host line, no overflow-prone markup, the preview banner", async () => {
  const paths = previewPaths(); assert.ok(paths.length > 20, paths.length);
  for (const p of paths) { const h = await page(p); looksRight(h, p);
    if (!/sweetpea-sorrel/.test(p)) assert.match(h, /Preview, not on Pottery Lab yet/, p);
    assert.match(h, /<h2 id="act">I'm interested<\/h2>/, p); assert.match(h, /<a class="go" href="#request">I'm interested<\/a>/, p + ": one primary in the action row");
    assert.doesNotMatch(h, /href="\/@[a-z0-9-]+#follow"/, p + ": no Follow for a host who hasn't joined"); }
});

test("the host's real photo leads when there is one; the drawn cover only when there isn't", async () => {
  const bo = await page("/x/atbo/x0");
  assert.match(bo, /<div class="ph"><img src="\/presets\/atelier-bo-banh-bo-popup\.jpg"/, "Atelier Bò's pop-up photo");
  assert.match(bo, /<figcaption>Photo: Atelier Bò<\/figcaption>/); assert.match(bo, /og:image" content="[^"]*\/presets\/atelier-bo-banh-bo-popup\.jpg"/);
  assert.doesNotMatch(bo, /<div class="ea-cover/, "no drawn cover over a real photo"); assert.match(bo, /aspect-ratio:4\/5/, "a fixed ratio, so nothing shifts when it loads");
  assert.match(await page("/x/atbo/x1"), /<div class="ph"><img src="\/presets\/atelier-bo-/, "the host's photo for their other thing too");
  assert.match(await page("/x/tuongvan/any"), /<div class="ph"><img src="\/presets\//, "a page with only past events uses their photo");
  const tram = await page("/x/tram/x0"); assert.match(tram, /<div class="ph art"><div class="ea-cover/, "no photo: the drawn cover"); assert.doesNotMatch(tram, /<figcaption>/);
});

test("the facts table, the right fields for the kind, What's included as a section, the footer link", async () => {
  const bo = await page("/x/atbo/x0");
  assert.match(bo, /<dl class="facts"><dt>Price<\/dt><dd>\$5 suggested<\/dd><dt>Group size<\/dt><dd>Up to 46<\/dd><dt>Length<\/dt><dd>3 hours<\/dd><dt>Where<\/dt><dd>NoMad, New York<\/dd><\/dl>/);
  assert.match(bo, /<h2 class="sh" id="inc">What's included<\/h2><ul class="items">/); assert.match(bo, /Allergies and diets:/, "a food thing has the diets line");
  assert.match(bo, /<h2 class="sh" id="good">Good to know<\/h2>/); assert.doesNotMatch(bo, /name="size"/, "a pop-up isn't a team thing: no team size");
  assert.match(bo, /<a href="\/@atbo">See Atelier Bò's page<\/a>/); assert.doesNotMatch(bo, /class="foot"[^>]*>[\s\S]{0,40}inline-flex/);
  assert.match(await page("/x/tram/x0"), /<span>Team size <small>optional<\/small><\/span><input name="size"/, "a team workshop asks team size");
  assert.match(await page("/x/le-phin/g0"), /<span>How many <small>optional<\/small><\/span>/, "a gift asks how many");
  assert.match(await page("/x/le-phin/g0"), /You can personalize/);
  assert.match(await page("/x/tram/shop/0"), /<span>How many <small>optional<\/small><\/span>/, "a shop item asks how many");
});

test("the thanks state is compact and has a next step", async () => {
  const h = await page("/x/atbo/x0");
  assert.match(h, /done\("<h2>You're on the list<\/h2><p class=lead>/); assert.match(h, /We'll email you once, when "\+esc\(NM\)\+" joins\./);
  assert.match(h, /See more from "\+esc\(NM\)/); assert.match(h, /Explore similar hosts/); assert.match(h, /SIM="\/hosts\?category=food"/);
  const ok = await post("/api/public/interest/atbo", { item: "x0", name: "Tuongvan Le", email: "tv.xpage@example.com" }); assert.equal(ok.status, 200);
});

test("a real host's thing: Book for your team on a team thing, Request a date otherwise, Follow, an order page", async () => {
  const t = await page("/x/bo-xpage/" + S.team); looksRight(t, "team");
  assert.match(t, /<h2 id="act">Book for your team<\/h2>/); assert.match(t, /Work email/); assert.match(t, /name="company"/);
  assert.match(t, /<a class="btn2" href="\/@bo-xpage#follow">/, "Follow the host"); assert.doesNotMatch(t, /Preview, not on Pottery Lab yet/);
  assert.match(t, /Veggie fillings on request\./); assert.doesNotMatch(h1Of(t), EMOJI);
  const s = await page("/x/bo-xpage/" + S.supper); looksRight(s, "supper");
  assert.match(s, /<h2 id="act">Request a date<\/h2>/); assert.doesNotMatch(s, /name="company"/, "no company field on a supper");
  const o = await page("/x/bo-xpage/shop/crisp01"); looksRight(o, "shop"); assert.match(o, /<h2 id="act">Order<\/h2>/); assert.match(o, /<dt>Where<\/dt><dd>Bed-Stuy<\/dd>/);
});
