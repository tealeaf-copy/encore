// The "Change photo" sheet's server side (server/photos.js): uploads are PNG, JPEG or WebP by their bytes, within size
// limits, signed-in owners only; recent uploads are your own; only your own photos go on your event, page cover or
// profile picture; crops keep their original and focal point; the sheet itself is one shared script.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { imageSize, cleanFocus, templatesFor } from "../server/photos.js";

let srv, A, B;
const J = { "content-type": "application/json" };
// a real PNG of w×h (one flat colour)
function png(w, h) { const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  const rows = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rows.set([201, 74, 48], y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]); }
const up = (cookie, body, q = "for=cover", type = "image/png") => fetch(`${srv.base}/api/photos?${q}`, { method: "POST", headers: { "content-type": type, ...(cookie ? { cookie } : {}) }, body });
const post = (p, body, cookie) => fetch(srv.base + p, { method: "POST", headers: { ...J, cookie }, body: JSON.stringify(body) });
async function join(name, email, handle) { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); const cookie = r.headers.get("set-cookie").split(";")[0]; if (handle) await post("/api/host/profile", { handle, name, city: "Brooklyn" }, cookie); return { cookie, ws: (await r.json()).workspace.id }; }
before(async () => { Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "photos-secret-0123456789abcdef", ENCORE_FAKE_EMAIL: "1" }); resetLoginLimits(); srv = await startServer();
  A = await join("Ada Photo", "ada.photo@example.com", "ada-photo"); B = await join("Bo Photo", "bo.photo@example.com", "bo-photo"); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv.close(); });

test("sizes come from the file header, focal points are whole percents", () => {
  assert.deepEqual(imageSize(png(120, 80)), { w: 120, h: 80 });
  assert.equal(imageSize(Buffer.from("GIF89a....")), null);
  assert.deepEqual(cleanFocus({ x: 12.6, y: 140 }), { x: 13, y: 100 }); assert.deepEqual(cleanFocus(null), { x: 50, y: 50 });
  assert.ok(templatesFor("avatar").every((t) => t.kind === "portrait")); assert.ok(templatesFor("page").every((t) => t.color)); assert.ok(templatesFor("cover").length >= 12);
});

test("uploads: PNG, JPEG or WebP by their bytes, within limits, signed in only", async () => {
  assert.equal((await up("", png(100, 100))).status, 401, "signed out");
  const ok = await up(A.cookie, png(200, 120)), j = await ok.json(); assert.equal(ok.status, 200); assert.match(j.url, /^\/_blob\/[A-Za-z0-9]{20}$/); assert.equal(j.w, 200); assert.equal(j.contentType, "image/png");
  assert.equal((await up(A.cookie, Buffer.from("GIF89a" + "x".repeat(100)), "for=cover", "image/gif")).status, 415, "no GIFs");
  assert.equal((await up(A.cookie, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "for=avatar", "image/png")).status, 415, "an SVG claiming PNG is refused");
  assert.equal((await up(A.cookie, png(20, 20))).status, 400, "too small");
  const big = Buffer.concat([png(100, 100), Buffer.alloc(5 * 1048576 + 10)]); assert.equal((await up(A.cookie, big, "for=avatar")).status, 413, "a profile picture over 5 MB");
  assert.equal((await up(A.cookie, Buffer.alloc(0))).status, 400, "empty");
  // the blob is served as an image, sandboxed
  const r = await fetch(srv.base + j.url); assert.equal(r.headers.get("content-type"), "image/png"); assert.equal(r.headers.get("x-content-type-options"), "nosniff");
});

test("recent uploads are your own, crops left out", async () => {
  const orig = (await (await up(A.cookie, png(300, 200))).json()).url;
  const crop = (await (await up(A.cookie, png(160, 90), `for=cover&crop=1&source=${encodeURIComponent(orig)}&fx=20&fy=70`)).json()).url;
  const mine = (await (await fetch(srv.base + "/api/photos/recent", { headers: { cookie: A.cookie } })).json()).photos.map((p) => p.url);
  assert.ok(mine.includes(orig)); assert.ok(!mine.includes(crop), "crops aren't listed");
  const theirs = (await (await fetch(srv.base + "/api/photos/recent", { headers: { cookie: B.cookie } })).json()).photos.map((p) => p.url);
  assert.ok(!theirs.includes(orig), "Bo doesn't see Ada's uploads");
});

test("only your own photos go on your profile picture, page cover and event", async () => {
  const mineA = (await (await up(A.cookie, png(400, 400), "for=avatar")).json()).url, mineB = (await (await up(B.cookie, png(400, 400), "for=avatar")).json()).url;
  let r = await post("/api/photos/use", { for: "avatar", url: mineA, source: mineA, focus: { x: 30, y: 40 } }, A.cookie); assert.equal(r.status, 200, await r.clone().text());
  const j = await r.json(); assert.equal(j.avatar.url, mineA); assert.deepEqual(j.avatar.focus, { x: 30, y: 40 });
  assert.equal((await (await fetch(srv.base + "/api/public/host/ada-photo")).json()).host?.theme?.avatarUrl ?? mineA, mineA);
  assert.equal((await post("/api/photos/use", { for: "avatar", url: mineB }, A.cookie)).status, 403, "Bo's photo can't be Ada's picture");
  // the page save can't sneak someone else's upload in either
  await post("/api/host/profile", { handle: "ada-photo", name: "Ada Photo", theme: { avatarUrl: mineB, coverUrl: mineB } }, A.cookie);
  const prof = (await (await fetch(srv.base + "/api/host/profile", { headers: { cookie: A.cookie } })).json()).host;
  assert.equal(prof.theme.avatarUrl, mineA); assert.notEqual(prof.theme.coverUrl, mineB);
  // page cover, then a template, then remove
  const wide = (await (await up(A.cookie, png(900, 300), "for=page")).json()).url;
  assert.equal((await (await post("/api/photos/use", { for: "page", url: wide, focus: { x: 50, y: 20 } }, A.cookie)).json()).page.url, wide);
  assert.equal((await (await post("/api/photos/use", { for: "page", template: "dusk" }, A.cookie)).json()).page.wash, "dusk");
  assert.equal((await (await post("/api/photos/use", { for: "page" }, A.cookie)).json()).page.url, "");
  assert.equal((await post("/api/photos/use", { for: "page", template: "<script>" }, A.cookie)).status, 400);
  // an event cover
  await fetch(srv.base + "/api/db/doc?path=events/phEv1", { method: "PUT", headers: { ...J, cookie: A.cookie }, body: JSON.stringify({ name: "Photo night", date: "2030-01-05", casual: true }) });
  const cov = (await (await up(A.cookie, png(320, 180))).json()).url;
  assert.equal((await (await post("/api/photos/use", { for: "cover", eventId: "phEv1", url: cov, focus: { x: 10, y: 90 } }, A.cookie)).json()).coverPhoto, cov);
  assert.equal((await post("/api/photos/use", { for: "cover", eventId: "phEv1", url: mineB }, A.cookie)).status, 403);
  assert.equal((await post("/api/photos/use", { for: "cover", eventId: "nope", url: cov }, A.cookie)).status, 404);
  // writing the event doc straight can't put Bo's photo on it either: the old cover stays
  await fetch(srv.base + "/api/db/doc?path=events/phEv1", { method: "PATCH", headers: { ...J, cookie: A.cookie }, body: JSON.stringify({ coverPhoto: mineB }) });
  const ev = (await (await fetch(srv.base + "/api/db/doc?path=events/phEv1", { headers: { cookie: A.cookie } })).json()).data;
  assert.equal(ev.coverPhoto, cov); assert.deepEqual(ev.coverFocus, { x: 10, y: 90 });
});

test("one shared sheet: upload, recent uploads, templates and remove, with drag to reposition and a square crop", () => {
  const js = fs.readFileSync(new URL("../public/photosheet.js", import.meta.url), "utf8");
  for (const s of ["Upload a photo", "Your recent uploads", "Templates", "Remove photo", "/api/photos/recent", "/api/photos/use", "/api/public/photos/templates", "pointerdown"]) assert.ok(js.includes(s), s);
  assert.match(js, /avatar:\s*\{[^}]*aspect:\s*1\b/, "the profile picture is square");
  assert.match(js, /window\.PhotoSheet\s*=/);
  assert.doesNotMatch(js, /—/, "no em dashes");
});
