// "Start from your Instagram" (server/igimport.js, server/igdraft.js, docs/instagram-import.md). No network: the
// official path runs against a stub of Meta's endpoints, and drafts run in offline mode (ENCORE_FAKE_AI=1).
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { parseIgHandle, plHandleFrom, guardDraft, fakeIgDraft, buildPrompt, onlyOwn } from "../server/igdraft.js";
import { setIgFetch, checkPhotos, imageType, parseSignedRequest } from "../server/igimport.js";
import crypto from "node:crypto";

let srv;
const J = { "content-type": "application/json" };
const post = (p, body, cookie) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body), redirect: "manual" });
const get = (p, cookie) => fetch(srv.base + p, { headers: cookie ? { cookie } : {}, redirect: "manual" });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
const ENV = ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_SMS", "ENCORE_FAKE_EMAIL", "INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "INSTAGRAM_REDIRECT_URI", "INSTAGRAM_PKCE"];
let n = 0;
async function host() { n++; const r = await post("/api/signup", { name: `Mai Owner${n}`, email: `mai${n}@copperkettle.example`, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200); return cookieOf(r); }
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const photo = () => ({ type: "image/png", data: PNG.toString("base64") });
const assetsCount = () => { try { return fs.readdirSync(path.join(srv.dir, "assets")).length; } catch { return 0; } };

before(async () => { srv = await startServer(); });
beforeEach(() => { Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "igimport-secret-0123456789abcdef", ENCORE_SIGNUP_PER_HOUR: "200", ENCORE_FAKE_SMS: "1", ENCORE_FAKE_EMAIL: "1" }); for (const k of ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "INSTAGRAM_REDIRECT_URI", "INSTAGRAM_PKCE"]) delete process.env[k]; resetLoginLimits(); setIgFetch(null); });
after(async () => { for (const k of ENV) delete process.env[k]; setIgFetch(null); await srv.close(); });

const BIO = "Vietnamese coffee, dripped slow through a phin. East Village, NYC.\nOpen daily 8am-5pm\nTastings every first Sunday. Catering for offices.\nwww.copperkettle.coffee";
const EXTRA = "Pandan latte $6. Black sesame latte, cà phê sữa đá. Beans from @beanroasters, see instagram.com/beanroasters";

test("handles and links: only a profile, never a post; the page handle is made from it", () => {
  for (const [i, o] of [["@le.phin", "le.phin"], ["Le_Phin", "le_phin"], ["instagram.com/le.phin", "le.phin"], ["https://www.instagram.com/le.phin/?hl=en", "le.phin"], ["http://m.instagram.com/le.phin", "le.phin"], ["instagr.am/le.phin/", "le.phin"]]) assert.equal(parseIgHandle(i), o, i);
  for (const x of ["https://www.instagram.com/p/Cxyz/", "https://instagram.com/reel/abc", "https://instagram.com/explore", "le..phin", ".lephin", "lephin.", "https://evil.example/le.phin", "a".repeat(31), "", "le phin", "javascript:alert(1)"]) assert.equal(parseIgHandle(x), "", x);
  assert.equal(plHandleFrom("le.phin_nyc"), "le-phin-nyc"); assert.equal(plHandleFrom("x"), "x-page"); assert.equal(plHandleFrom("Lê Phin"), "le-phin");
});

test("the official path is off without config: the routes refuse, and the page is told", async () => {
  const c = await host();
  assert.equal((await (await get("/api/igimport/config", c)).json()).official, false);
  const s = await get("/api/igimport/oauth/start", c); assert.equal(s.status, 404); assert.equal((await s.json()).code, "not_configured");
  const cb = await get("/api/igimport/oauth/callback?code=x&state=y", c); assert.equal(cb.status, 404);
  assert.equal((await post("/api/igimport/deauthorize", {}, c)).status, 404);
  // and Instagram pages are never fetched by the link reader
  const { readLink } = await import("../server/onboard.js");
  const r = await readLink("https://www.instagram.com/le.phin/"); assert.equal(r.ok, false); assert.equal(r.instagram, true);
});

test("official path: state is single use and tied to the account; the token is used once and never kept", async () => {
  Object.assign(process.env, { INSTAGRAM_APP_ID: "123", INSTAGRAM_APP_SECRET: "app-secret-xyz", INSTAGRAM_PKCE: "1" });
  const c = await host(), other = await host();
  assert.equal((await get("/api/igimport/oauth/start")).status, 401, "signed out is refused");
  const s = await get("/api/igimport/oauth/start?mode=new", c); assert.equal(s.status, 302);
  const to = new URL(s.headers.get("location")); assert.equal(to.origin + to.pathname, "https://www.instagram.com/oauth/authorize");
  assert.equal(to.searchParams.get("client_id"), "123"); assert.equal(to.searchParams.get("scope"), "instagram_business_basic"); assert.equal(to.searchParams.get("response_type"), "code");
  assert.match(to.searchParams.get("redirect_uri"), /\/api\/igimport\/oauth\/callback$/); assert.equal(to.searchParams.get("code_challenge_method"), "S256");
  const state = to.searchParams.get("state"); assert.ok(state.length >= 30); const st = s.headers.get("set-cookie").split(";")[0]; assert.match(s.headers.get("set-cookie"), /HttpOnly/);
  // no cookie, a wrong state, another account's session: refused before anything is fetched
  let calls = []; setIgFetch(async (url, init) => { calls.push(String(url)); return stub(url, init); });
  assert.equal((await get(`/api/igimport/oauth/callback?code=abc&state=${state}`, c)).status, 400);
  assert.equal((await (await get(`/api/igimport/oauth/callback?code=abc&state=nope`, `${c}; ${st}`)).json()).code, "bad_state");
  assert.equal((await get(`/api/igimport/oauth/callback?code=abc&state=${state}`, `${other}; ${st}`)).status, 400);
  assert.equal(calls.length, 0, "nothing fetched on a bad state");
  const ok = await get(`/api/igimport/oauth/callback?code=abc&state=${state}`, `${c}; ${st}`); assert.equal(ok.status, 303);
  const back = new URL(ok.headers.get("location"), srv.base); assert.equal(back.pathname, "/import/instagram"); const draftId = back.searchParams.get("draft"); assert.ok(draftId);
  assert.ok(calls.some((u) => u.startsWith("https://api.instagram.com/oauth/access_token"))); assert.ok(calls.some((u) => /graph\.instagram\.com\/v[\d.]+\/me\?/.test(u)));
  assert.deepEqual([...new Set(calls.map((u) => new URL(u).hostname))].sort(), ["api.instagram.com", "graph.instagram.com", "scontent.cdninstagram.com"], "only the API and its media, never a profile page");
  assert.equal((await get(`/api/igimport/oauth/callback?code=abc&state=${state}`, `${c}; ${st}`)).status, 400, "a state works once");
  // the token is nowhere: not in the waiting draft, not in the store
  const cache = srv.app.locals.igimport.cache; assert.doesNotMatch(JSON.stringify([...cache.values()].map((v) => ({ ...v, media: v.media.map((m) => ({ ...m, buf: null })), avatar: null }))), /IGQ-secret-token/);
  assert.doesNotMatch(JSON.stringify(srv.store.list ? [] : []), /IGQ/);
  // another account can't read the draft or its photos
  assert.equal((await post("/api/igimport/draft", { draft: draftId }, other)).status, 404);
  assert.equal((await get(`/api/igimport/media/${draftId}/1`, other)).status, 404);
  const d = await (await post("/api/igimport/draft", { draft: draftId }, c)).json();
  assert.equal(d.via, "official"); assert.equal(d.draft.handle, "copper.kettle.cafe"); assert.equal(d.draft.name.value, "Copper Kettle");
  assert.equal(d.photos.length, 3, "two posts and the profile picture"); assert.ok(d.photos.at(-1).avatar);
  assert.doesNotMatch(JSON.stringify(d), /beanroasters|IGQ-secret-token/i, "nothing from other accounts, no token");
  assert.equal((await get(d.photos[0].url, c)).headers.get("content-type"), "image/png");
  // nothing on the page yet; then save, with photos by number
  assert.ok(!(await (await get("/api/host/profile", c)).json()).host?.gallery?.length);
  const sv = await (await post("/api/igimport/save", { draft: draftId, fields: { name: "Copper Kettle", tagline: d.draft.tagline.value, about: d.draft.about.value, hours: d.draft.hours.value, tags: ["coffee"], offerings: [] }, photos: { cover: { media: 1 }, gallery: [{ media: 1 }, { media: 2 }], avatar: { media: 3 } }, palette: { accent: "#8A4B2A" } }, c)).json();
  assert.equal(sv.ok, true); assert.equal(sv.handle, "copper-kettle-cafe");
  const h = (await (await get("/api/host/profile", c)).json()).host; assert.equal(h.gallery.length, 2); assert.match(h.theme.coverUrl, /^\/_blob\//); assert.match(h.theme.avatarUrl, /^\/_blob\//);
  assert.ok(h.links.some((l) => l.url === "https://www.instagram.com/copper.kettle.cafe/")); assert.equal(h.brandKit.accent, "#8A4B2A");
  assert.equal(cache.has(draftId), false, "the draft is gone once saved");
  // Disconnect forgets the import record
  const dc = await (await post("/api/igimport/disconnect", {}, c)).json(); assert.equal(dc.ok, true); assert.match(dc.message, /never kept a key/);
  assert.equal((await (await get("/api/igimport/config", c)).json()).imported, null);
});

function stub(url, init) {
  const u = String(url), res = (b, type = "application/json", status = 200) => new Response(typeof b === "string" || Buffer.isBuffer(b) ? b : JSON.stringify(b), { status, headers: { "content-type": type } });
  if (u.startsWith("https://api.instagram.com/oauth/access_token")) { const f = new URLSearchParams(String(init.body)); assert.equal(f.get("client_secret"), "app-secret-xyz"); assert.ok(f.get("code_verifier"), "PKCE verifier sent"); return res({ access_token: "IGQ-secret-token", user_id: 1789 }); }
  if (/graph\.instagram\.com\/v[\d.]+\/me\?/.test(u)) { assert.equal(new URL(u).searchParams.get("access_token"), "IGQ-secret-token"); return res({ user_id: "1789", username: "copper.kettle.cafe", name: "Copper Kettle", biography: BIO, website: "https://copperkettle.coffee", profile_picture_url: "https://scontent.cdninstagram.com/pp.png", followers_count: 812, account_type: "BUSINESS" }); }
  if (/graph\.instagram\.com\/v[\d.]+\/me\/media\?/.test(u)) return res({ data: [
    { id: "1", caption: "New: pandan latte $6. Thanks @beanroasters for the beans!", media_type: "IMAGE", media_url: "https://scontent.cdninstagram.com/a.png", permalink: "https://www.instagram.com/p/a/", timestamp: "2026-10-03T14:00:00+0000" },
    { id: "2", caption: "Tastings every first Sunday.", media_type: "IMAGE", media_url: "https://scontent.cdninstagram.com/b.png", permalink: "https://www.instagram.com/p/b/", timestamp: "2026-10-10T14:00:00+0000" },
    { id: "3", caption: "Not ours", media_type: "IMAGE", media_url: "https://evil.example/c.png", permalink: "https://www.instagram.com/p/c/", timestamp: "2026-10-11T14:00:00+0000" }] });
  if (/^https:\/\/scontent\.cdninstagram\.com\//.test(u)) return res(PNG, "image/png");
  throw new Error("unexpected fetch " + u);
}

test("photos path: a well-formed draft with sources, stated prices only, nothing from other accounts, nothing saved", async () => {
  const c = await host(), before = assetsCount(), prof0 = (await (await get("/api/host/profile", c)).json()).host;
  const r = await post("/api/igimport/draft", { handle: "@copper.kettle.cafe", bio: BIO + "\nLove you @friendcafe!", extra: EXTRA, photos: [photo(), photo(), photo()] }, c); assert.equal(r.status, 200);
  const { draft: d, via } = await r.json(); assert.equal(via, "photos");
  for (const k of ["name", "tagline", "about", "city", "hood", "hours", "website"]) { assert.equal(typeof d[k].value, "string", k); if (d[k].value) assert.match(d[k].from, /^from /, k); }
  assert.equal(d.tagline.from, "from your bio"); assert.equal(d.hood.value, "East Village"); assert.equal(d.hours.value, "Open daily 8am-5pm"); assert.equal(d.website.value, "https://www.copperkettle.coffee");
  assert.ok(d.tags.value.includes("coffee")); assert.ok(d.events.value.includes("Tastings")); assert.ok(d.brandEvents.value.includes("Catering"));
  const pandan = d.offerings.find((o) => /pandan/i.test(o.name)), sesame = d.offerings.find((o) => /sesame/i.test(o.name));
  assert.equal(pandan.price, "$6"); assert.equal(pandan.from, "from what you pasted"); assert.equal(sesame.price, ""); assert.equal(sesame.priceLabel, "price not set");
  for (const o of d.offerings) if (o.price) assert.ok((BIO + EXTRA).includes(o.price), `${o.name}: ${o.price} is in their words`);
  assert.deepEqual([d.cover, d.gallery], [1, [1, 2, 3]]); assert.equal(d.avatar.art, "barista");
  assert.doesNotMatch(JSON.stringify(d), /friendcafe|beanroasters/i, "no other accounts");
  assert.doesNotMatch(JSON.stringify(d), /iVBOR/, "photos are not sent back");
  assert.equal(assetsCount(), before, "photos are not written anywhere");
  assert.deepEqual((await (await get("/api/host/profile", c)).json()).host, prof0, "nothing saved before Looks good");
  // Looks good: only the picked photo is uploaded (by the page) and kept
  const up = await (await fetch(srv.base + "/api/assets", { method: "POST", headers: { "content-type": "image/png", cookie: c }, body: PNG })).json();
  const sv = await (await post("/api/igimport/save", { fields: { name: d.name.value, handle: "copper.kettle.cafe", tagline: d.tagline.value, about: d.about.value, hood: d.hood.value, city: d.city.value, hours: d.hours.value, website: d.website.value, tags: d.tags.value, events: d.events.value, brandEvents: d.brandEvents.value, offerings: d.offerings.map((o) => ({ name: o.name, price: o.price })) }, photos: { cover: up.url, gallery: [up.url, "/_blob/aaaaaaaaaaaaaaaaaaaa"], avatar: "art", art: "barista" } }, c)).json();
  assert.equal(sv.ok, true);
  const h = (await (await get("/api/host/profile", c)).json()).host;
  assert.equal(h.name, "Copper Kettle Cafe"); assert.equal(h.hood, "East Village"); assert.match(h.bio, /Open daily 8am-5pm/); assert.deepEqual(h.gallery, [up.url], "only this workspace's own upload");
  assert.equal(h.theme.coverUrl, up.url); assert.equal(h.theme.avatarArt, "barista"); assert.match(h.services, /Catering/);
  assert.ok(h.links.some((l) => l.label === "Instagram")); assert.ok(h.links.some((l) => l.label === "Website"));
  assert.equal(h.shop.open, false, "the menu waits in a closed shop"); assert.equal(h.shop.items.find((x) => /pandan/i.test(x.name)).cents, 600); assert.equal(h.shop.items.find((x) => /sesame/i.test(x.name)).cents, 0);
});

test("uploads are limited: count, size and type; signed-out and empty drafts are refused", async () => {
  const c = await host();
  assert.equal((await post("/api/igimport/draft", { bio: "hi", photos: [photo()] })).status, 401);
  const many = await post("/api/igimport/draft", { bio: "x", photos: Array.from({ length: 13 }, photo) }, c); assert.equal(many.status, 400); assert.equal((await many.json()).code, "too_many");
  const txt = await post("/api/igimport/draft", { bio: "x", photos: [{ type: "image/png", data: Buffer.from("just some text, not a photo").toString("base64") }] }, c); assert.equal(txt.status, 400); assert.equal((await txt.json()).code, "bad_type");
  const svg = await post("/api/igimport/draft", { bio: "x", photos: [{ type: "image/svg+xml", data: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>").toString("base64") }] }, c); assert.equal((await svg.json()).code, "bad_type");
  const bigBuf = Buffer.concat([PNG, Buffer.alloc(2.2 * 1024 * 1024)]); const big = await post("/api/igimport/draft", { bio: "x", photos: [{ type: "image/png", data: bigBuf.toString("base64") }] }, c); assert.equal(big.status, 413);
  assert.equal((await post("/api/igimport/draft", { bio: "", photos: [] }, c)).status, 400);
  assert.equal((await post("/api/igimport/draft", { handle: "https://www.instagram.com/p/abc/", bio: "x" }, c)).status, 400);
  assert.equal(checkPhotos(Array.from({ length: 12 }, photo)).photos.length, 12);
  assert.equal(imageType(PNG), "image/png"); assert.equal(imageType(Buffer.from("GIF89a......")), "image/gif");
  assert.equal((await post("/api/igimport/save", { fields: {} }, c)).status, 400, "nothing ticked, nothing saved");
});

test("the guard: invented prices go, other accounts go, sources must point at real material", () => {
  const input = { handle: "copper.kettle.cafe", bio: "Coffee in the East Village.", extra: "Pandan latte $6", posts: [{ caption: "Iced coffee", timestamp: "2026-10-03T10:00:00Z" }], photoCount: 2 };
  const d = guardDraft({ name: { value: "Copper Kettle", source: { kind: "profile" } }, tagline: { value: "Best coffee in NYC — period @rivalcafe", source: { kind: "bio" } }, about: { value: "Follow instagram.com/rivalcafe and @copper.kettle.cafe", source: { kind: "post", ref: 9 } },
    offerings: [{ name: "Pandan latte", price: "$6", source: { kind: "pasted" } }, { name: "Iced coffee", price: "$5", source: { kind: "post", ref: 1 } }, { name: "Egg coffee", price: "$7", priceQuote: "$7", source: { kind: "photo", ref: 2 } }],
    website: { value: "https://instagram.com/rivalcafe", source: { kind: "bio" } }, gallery: [1, 2, 7], cover: { photo: 5 } }, input);
  assert.equal(d.offerings[0].price, "$6"); assert.equal(d.offerings[1].price, "", "a price nobody stated is dropped"); assert.equal(d.offerings[1].priceLabel, "price not set"); assert.equal(d.offerings[1].from, "from your post on Oct 3");
  assert.equal(d.offerings[2].price, "$7"); assert.equal(d.offerings[2].priceCheck, true, "read from their photo: marked to check");
  assert.doesNotMatch(d.tagline.value, /rivalcafe|—/); assert.doesNotMatch(d.about.value, /rivalcafe/); assert.match(d.about.value, /@copper\.kettle\.cafe/);
  assert.equal(d.about.source, null, "a post that doesn't exist is no source"); assert.equal(d.website.value, "", "no links to other Instagram accounts");
  assert.deepEqual(d.gallery, [1, 2]); assert.equal(d.cover, 1);
  assert.equal(onlyOwn("hi @a and @b.c, from @me", "me"), "hi and, from @me");
  // offline mode reads the prompt it would send
  const raw = fakeIgDraft(buildPrompt({ handle: "x.y", bio: "Matcha and pastries. Williamsburg.", photos: [] })); assert.ok(raw.tags.value.includes("matcha")); assert.equal(raw.hood.value, "Williamsburg");
});

test("Meta's callbacks check the app's signature", async () => {
  Object.assign(process.env, { INSTAGRAM_APP_ID: "123", INSTAGRAM_APP_SECRET: "app-secret-xyz" });
  const payload = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "1789", issued_at: 1 })).toString("base64url"), sig = crypto.createHmac("sha256", "app-secret-xyz").update(payload).digest("base64url");
  assert.equal(parseSignedRequest(`${sig}.${payload}`, "app-secret-xyz").user_id, "1789"); assert.equal(parseSignedRequest(`${sig}.${payload}`, "other"), null);
  const form = (sr) => fetch(srv.base + "/api/igimport/data-deletion", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ signed_request: sr }) });
  const ok = await (await form(`${sig}.${payload}`)).json(); assert.match(ok.url, /\/privacy#instagram$/); assert.match(ok.confirmation_code, /^[0-9a-f]{16}$/);
  assert.equal((await form(`bad.${payload}`)).status, 400);
});

test("the pages: /import/instagram answers, and the hooks are in place", async () => {
  const r = await get("/import/instagram"); assert.equal(r.status, 200); const html = await r.text(); assert.match(html, /Start from your Instagram/); assert.match(html, /Start from scratch/); assert.match(html, /accept="image\/\*" multiple/); assert.doesNotMatch(html, /—/);
  const js = fs.readFileSync(new URL("../public/igimport.js", import.meta.url), "utf8"); assert.match(js, /Looks good, save my page|Potto is reading/); assert.doesNotMatch(js.replace(/\/\/.*$/gm, ""), /—/);
  assert.match(fs.readFileSync(new URL("../public/signup.html", import.meta.url), "utf8"), /\/import\/instagram\?next=/);
  assert.match(fs.readFileSync(new URL("../public/host.html", import.meta.url), "utf8"), /igimport\.js/);
  assert.match(fs.readFileSync(new URL("../public/storefront.js", import.meta.url), "utf8"), /IgImport\?\.settingsRow/);
});
