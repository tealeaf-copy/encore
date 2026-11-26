// The share sheet (public/sharekit.js) and its QR encoder (public/qr.js): three formats (link card, flyer, QR code), each
// with its own actions; "Invite friends" opens it for guests; the link card it draws becomes the invite's og:image.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { qrMatrix } from "../server/qr.js";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const J = { "content-type": "application/json" };

test("qr.js: level M matches the server's encoder module for module; level H is bigger and stays in range", () => {
  const ctx = { window: {}, TextEncoder }; vm.createContext(ctx); vm.runInContext(read("public/qr.js"), ctx); const Q = ctx.window.PLQR;
  for (const t of ["hello", "https://x.test/e/abc", "https://potterylab.app/i/crumbNext?with=AbCdEfGhIjKlMnOpQrStUv12"]) {
    const a = qrMatrix(t), q = Q.encode(t, "M"); assert.equal(q.size, a.length, t);
    let diff = 0; for (let y = 0; y < a.length; y++) for (let x = 0; x < a.length; x++) if (!!a[y][x] !== !!q.get(x, y)) diff++;
    assert.equal(diff, 0, "same modules for " + t);
    const h = Q.encode(t, "H"); assert.ok(h.size >= q.size, "H needs at least as many modules"); assert.equal(h.size, 17 + 4 * h.version); assert.equal(h.get(-1, 0), false);
  }
  assert.throws(() => Q.encode("x".repeat(3000), "H"));
  const lic = read("public/qr.js").slice(0, 1600); assert.match(lic, /Project Nayuki/); assert.match(lic, /MIT License/); assert.match(lic, /Permission is hereby granted/);
});

test("sharekit.js: a clean global, three formats with their own actions, plain copy", () => {
  const s = read("public/sharekit.js");
  assert.match(s, /window\.ShareKit = window\.PLShare = api/); assert.match(s, /ShareKit\.open\(\{/, "the API is documented at the top");
  for (const t of ["Sending to someone?", "Tap to copy", "Share flyer", "Post to socials or send with the link.", "Scan to reply"]) assert.ok(s.includes(t), t);
  const rows = s.slice(s.indexOf("const ROWS = {"), s.indexOf("let at = -1"));
  const labels = (k) => [...rows.slice(rows.indexOf(k + ": [")).split("]],")[0].matchAll(/\["([A-Z][A-Za-z ]+)", IC\./g)].map((m) => m[1]);
  assert.deepEqual(labels("link"), ["Copy link", "Messages", "Instagram", "WhatsApp", "More"]);
  assert.deepEqual(labels("flyer"), ["Save", "Messages", "Stories", "More"]);
  assert.deepEqual(labels("qr"), ["Save", "Messages", "More"]);
  assert.match(s, /c\.width = 1080; c\.height = 1920/, "the flyer is 1080x1920"); assert.match(s, /c\.width = 1200; c\.height = 630/, "the link card is 1200x630");
  assert.match(s, /ecl: "H"/, "high error correction under the mark"); assert.match(s, /navigator\.share/); assert.match(s, /ArrowRight/); assert.match(s, /scroll-snap-type:x mandatory/);
  // the mark in the middle of the QR is Potto's line mark, the favicon's own path
  const mark = /const MARK = "([^"]+)"/.exec(s)[1]; assert.ok(read("public/favicon.svg").includes(mark.split("M11.1")[1].slice(0, 30)));
  assert.doesNotMatch(s, /—/, "no em dashes"); assert.doesNotMatch(s, /localStorage/, "nothing stored");
});

test("Invite friends replaces Come with me? in what people see", () => {
  const cw = read("public/comewith.js"), fv = read("public/feedvisual.js"), help = read("docs/help.md"), spa = read("index.html");
  assert.match(cw, /<span>Invite friends<\/span>/); assert.match(fv, />Invite friends<\/button>/); assert.match(help, /## Invite friends/);
  assert.match(cw, /hold: j\.held \? "We'll hold a spot for a friend for 48 hours\." /);
  for (const t of [cw.replace(/^\s*\/\/.*$/gm, ""), fv.replace(/^\s*\/\/.*$/gm, "")]) assert.doesNotMatch(t, /Come with me\?/);
  assert.doesNotMatch(spa, />Bring a friend</); assert.match(spa, /window\.ShareKit\.open\(\{ eventId:d\.id/, "the host's Share invite opens the same sheet");
  const blocks = [...spa.matchAll(/<script>([\s\S]*?)<\/script>/g)]; assert.match(blocks.at(-1)[1], /comewith\.js/, "the loader is still the last script");
});

let srv, host;
before(async () => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "sk-secret-0123456789abcdef"; process.env.ENCORE_FAKE_EMAIL = "1"; resetLoginLimits(); srv = await startServer();
  const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name: "Sam Share", email: "sam.sk@example.com", password: "long-password-1", mode: "friends" }) });
  host = r.headers.get("set-cookie").split(";")[0]; });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv.close(); });

test("/e/<id>: the link card the sheet drew is the og:image; anything but our own blob is ignored", async () => {
  const put = (id, d) => fetch(srv.base + "/api/db/doc?path=events/" + id, { method: "PUT", headers: { ...J, cookie: host }, body: JSON.stringify(d) });
  const day = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  assert.ok((await put("skcard", { name: "Wheel night", kind: "social", casual: true, date: day, startTime: "19:00", ogCard: "/_blob/abcdefgh12" })).ok);
  assert.ok((await put("skbad", { name: "Wheel night", kind: "social", casual: true, date: day, startTime: "19:00", ogCard: "https://evil.example/x.png" })).ok);
  const a = await (await fetch(srv.base + "/e/skcard")).text(), b = await (await fetch(srv.base + "/e/skbad")).text();
  assert.match(a, /<meta property="og:image" content="http:\/\/[^"]+\/_blob\/abcdefgh12"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">/);
  assert.doesNotMatch(b, /evil\.example/); assert.ok(a.length < 40000, "the served invite stays under 40,000 characters: " + a.length);
});
