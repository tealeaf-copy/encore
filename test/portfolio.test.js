// Past events (the scrapbook as a host's portfolio): reading event pages from any site, link safety, privacy,
// the preview → add flow, prepared pages' past events, and a claimed page starting with them. No live network.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { startServer } from "./helpers.js";
import { parseEvents, safeUrl, isPrivateIp, extractLinks, guardedLookup, safeFetch, safePlace, scrubAddress, useFetcher } from "../server/scrapbook.js";

const FX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "scrapbook");
const fx = (f) => fs.readFileSync(path.join(FX, f), "utf8");

test("Partiful: title, local date, neighborhood only, no street address, apartment or headcount", () => {
  const [e, ...rest] = parseEvents(fx("partiful.html"), "https://partiful.com/e/abc");
  assert.equal(rest.length, 0);
  assert.equal(e.title, "Dumpling Night - 2/8", "the site name comes off the title");
  assert.equal(e.date, "2025-02-08", "00:30Z on the 9th is the evening of the 8th in New York");
  assert.equal(e.place, "Williamsburg, Brooklyn");
  assert.match(e.image, /^https:\/\/partiful\.imgix\.net\//); assert.ok(!e.image.includes("&amp;"));
  assert.match(e.about, /300 dumplings/);
  for (const bad of [/Bedford/, /Apt/i, /apartment/i, /46/]) assert.doesNotMatch(JSON.stringify(e), bad);
});

test("Luma and Eventbrite: schema.org events, venue and city kept, street addresses dropped", () => {
  const [l] = parseEvents(fx("luma.html"), "https://lu.ma/sunrise");
  assert.deepEqual([l.title, l.date, l.place], ["Sunrise Run Club", "2025-05-03", "Crissy Field, San Francisco, CA"]);
  assert.equal(l.image, "https://images.lumacdn.com/event-covers/run.png");
  const [b] = parseEvents(fx("eventbrite.html"), "https://www.eventbrite.com/e/matcha-123");
  assert.deepEqual([b.title, b.date, b.place], ["Matcha Workshop", "2024-11-16", "New York, NY"]);
  assert.doesNotMatch(b.about, /250 Grand|Suite/);
});

test("A company's events page with many past events gives one card each, with their own links", () => {
  const L = parseEvents(fx("company-events.html"), "https://littlekiln.example.com/past");
  assert.deepEqual(L.map((e) => e.title), ["Wheel Night", "Glaze & Wine", "Kiln Q&A"]);
  assert.equal(L[0].url, "https://littlekiln.example.com/events/wheel-night"); assert.equal(L[0].image, "https://littlekiln.example.com/img/wheel.jpg");
  assert.equal(L[0].place, "Little Kiln Studio, Oakland, CA"); assert.equal(L[1].date, "2025-08-02"); assert.equal(L[2].place, "Online");
});

test("Open Graph, then the page title, when a page has no event data", () => {
  const [o] = parseEvents(fx("og-only.html"), "https://supper.example.org/spring");
  assert.deepEqual([o.title, o.about, o.image, o.date], ["Supper at Sixteenth: Spring Menu", "Six courses, one long table.", "https://supper.example.org/covers/spring.jpg", ""]);
  assert.equal(parseEvents(fx("title-only.html"), "https://x.example.com/")[0].title, "Board Game Night");
  assert.deepEqual(parseEvents("<html><body>nothing</body></html>"), []);
});

test("Places and descriptions never carry a street address or a home", () => {
  assert.equal(safePlace("27th and 6th apartment, 777 6th Ave, New York, NY 10001"), "New York, NY");
  assert.equal(safePlace("My apartment, Queens"), "Queens");
  assert.equal(safePlace("The Smiling Pizza, Park Slope"), "The Smiling Pizza, Park Slope");
  assert.doesNotMatch(scrubAddress("Details:\n⏰Wed, July 15\n📍777 6th Avenue, Apt 15J"), /777|15J|Avenue/);
  assert.equal(scrubAddress("Bring 2 friends and 3 snacks."), "Bring 2 friends and 3 snacks.");
});

test("Links: found in any text, https only, never a private or local address", () => {
  assert.deepEqual(extractLinks("hey potto here are mine: partiful.com/e/abc123, and https://lu.ma/xyz. Also http://www.eventbrite.com/e/9 (last spring) and https://lu.ma/xyz again"),
    ["https://partiful.com/e/abc123", "https://lu.ma/xyz", "https://www.eventbrite.com/e/9"]);
  assert.equal(safeUrl("http://example.com/a").href, "https://example.com/a", "http is upgraded");
  for (const bad of ["https://localhost/x", "https://127.0.0.1/", "https://10.0.0.5/", "https://169.254.169.254/latest/meta-data", "https://[::1]/", "https://[fd00::1]/", "https://metadata.google.internal/",
    "https://printer.local/", "https://user:pw@example.com/", "https://example.com:8443/", "ftp://example.com/", "javascript:alert(1)", "https://0x7f000001/", "https://2130706433/"]) assert.equal(safeUrl(bad), null, bad);
  for (const ip of ["10.1.2.3", "172.20.0.1", "192.168.1.1", "127.0.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "::ffff:a9fe:a9fe"]) assert.ok(isPrivateIp(ip), ip);
  for (const ip of ["93.184.216.34", "1.1.1.1", "2606:4700::1111"]) assert.equal(isPrivateIp(ip), false, ip);
});

test("The connection's DNS lookup refuses a name that resolves to a private address", async () => {
  const look = (addrs) => new Promise((res) => guardedLookup((h, o, cb) => cb(null, addrs))("x.example.com", { all: true }, (err, a) => res(err ? err.code : a)));
  assert.equal(await look([{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }]), "EPRIVATE");
  assert.equal(await look([{ address: "169.254.169.254", family: 4 }]), "EPRIVATE");
  assert.deepEqual(await look([{ address: "93.184.216.34", family: 4 }]), [{ address: "93.184.216.34", family: 4 }]);
});

test("Fetching: checks every redirect, at most 5, HTML only, size cap", async () => {
  const page = (status, headers, body = "") => ({ status, headers, body: Readable.from([Buffer.from(body)]) });
  const seen = [];
  const routes = { "https://a.example.com/": page(302, { location: "https://b.example.com/x" }), "https://b.example.com/x": page(200, { "content-type": "text/html; charset=utf-8" }, "<title>ok</title>") };
  const get = async (x) => { seen.push(x.href); return routes[x.href] || page(404, {}); };
  const r = await safeFetch("http://a.example.com/", { get });
  assert.equal(r.buf.toString(), "<title>ok</title>"); assert.equal(r.finalUrl, "https://b.example.com/x"); assert.deepEqual(seen, ["https://a.example.com/", "https://b.example.com/x"]);
  // a redirect to a private address is refused before any request goes there
  const hits = []; assert.equal(await safeFetch("https://c.example.com/", { get: async (x) => { hits.push(x.href); return page(301, { location: "http://169.254.169.254/latest" }); } }), null); assert.deepEqual(hits, ["https://c.example.com/"]);
  let n = 0; assert.equal(await safeFetch("https://loop.example.com/0", { get: async () => page(302, { location: `https://loop.example.com/${++n}` }) }), null); assert.equal(n, 6, "the first request plus 5 redirects");
  assert.equal(await safeFetch("https://d.example.com/", { get: async () => page(200, { "content-type": "application/pdf" }, "%PDF") }), null, "HTML only");
  assert.equal(await safeFetch("https://e.example.com/", { limit: 10, get: async () => page(200, { "content-type": "text/html" }, "x".repeat(50)) }), null, "size cap");
  assert.equal(await safeFetch("https://f.example.com/", { timeout: 30, get: (x, { signal }) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted")))) }), null, "timeout");
});

let srv;
const J = { "content-type": "application/json" };
before(async () => { srv = await startServer(); process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "portfolio-secret"; });
after(async () => { useFetcher(null); delete process.env.ENCORE_SIGNUP; delete process.env.SESSION_SECRET; await srv.close(); });
const signup = async (email, handle, extra = {}) => { const su = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name: "Test Host", email, password: "long-password-1", mode: "friends" }) });
  const c = su.headers.get("set-cookie").split(";")[0], H = { ...J, cookie: c }; const p = await fetch(srv.base + "/api/host/profile", { method: "POST", headers: H, body: JSON.stringify({ handle, name: "Test Host Page", ...extra }) }); assert.equal(p.status, 200); return H; };

test("Potto's drop-links flow: preview drafts from mixed text, nothing saved until the host adds them", async () => {
  const pages = { "https://partiful.com/e/abc": fx("partiful.html"), "https://littlekiln.example.com/past": fx("company-events.html") };
  useFetcher(async (u, o) => (o?.kind === "image" ? null : pages[u] ? { buf: Buffer.from(pages[u]), type: "text/html", finalUrl: u } : null));
  const H = await signup("potto.links@example.com", "potto-links");
  assert.equal((await fetch(srv.base + "/api/host/scrapbook/preview", { method: "POST", headers: J, body: JSON.stringify({ text: "https://partiful.com/e/abc" }) })).status, 401);
  assert.equal((await fetch(srv.base + "/api/host/scrapbook/preview", { method: "POST", headers: H, body: JSON.stringify({ text: "no links here" }) })).status, 400);
  const p = await (await fetch(srv.base + "/api/host/scrapbook/preview", { method: "POST", headers: H, body: JSON.stringify({ text: "my events: partiful.com/e/abc and https://littlekiln.example.com/past, also https://127.0.0.1/admin and https://gone.example.com/e" }) })).json();
  assert.deepEqual(p.drafts.map((d) => d.title), ["Dumpling Night - 2/8", "Wheel Night", "Glaze & Wine", "Kiln Q&A"]);
  assert.equal(p.drafts[0].source, "Partiful"); assert.equal(p.drafts[1].source, "Web"); assert.equal(p.drafts[1].site, "littlekiln.example.com"); assert.equal(p.drafts[0].place, "Williamsburg, Brooklyn");
  assert.equal(p.skipped.length, 1, "the private address never even counts as a link; the dead page is skipped"); assert.match(p.skipped[0].why, /Couldn't read/);
  assert.equal((await (await fetch(srv.base + "/api/host/scrapbook", { headers: H })).json()).items.length, 0, "a preview saves nothing");
  const kept = [{ ...p.drafts[0], title: "Dumpling Night", place: "Mai's apartment, 41 Bedford Ave, Williamsburg", guests: 999 }, p.drafts[2]];
  const a = await (await fetch(srv.base + "/api/host/scrapbook/add", { method: "POST", headers: H, body: JSON.stringify({ drafts: kept }) })).json();
  assert.equal(a.added.length, 2);
  const pub = (await (await fetch(srv.base + "/api/public/host/potto-links/scrapbook")).json()).items;
  assert.deepEqual(pub.map((x) => [x.title, x.place, x.guests, x.source]), [["Glaze & Wine", "Little Kiln Studio, Oakland, CA", 0, "Web"], ["Dumpling Night", "Williamsburg", 0, "Partiful"]]);
  assert.equal(pub[1].link, "https://partiful.com/e/abc");
  const again = await (await fetch(srv.base + "/api/host/scrapbook/preview", { method: "POST", headers: H, body: JSON.stringify({ links: ["https://partiful.com/e/abc"] }) })).json();
  assert.equal(again.drafts.length, 0); assert.match(again.skipped[0].why, /Already/);
  useFetcher(null);
});

test("Prepared pages show their past events; claiming one brings them into the real scrapbook once", async () => {
  const sc = await (await fetch(srv.base + "/api/public/host/atbo")).json();
  assert.equal(sc.host.showcase, true); const L = sc.host.scrapbook;
  assert.ok(L.length >= 2); const apt = L.find((x) => /Design your life/.test(x.title));
  assert.deepEqual([apt.date, apt.place, apt.source, apt.link, apt.cover], ["2026-07-15", "Chelsea, New York", "Partiful", "https://partiful.com/e/j6ooihgpqGYhHFCI7zAw", "/presets/atelier-bo-apt-cafe-club.jpg"]);
  assert.doesNotMatch(JSON.stringify(L), /777|6th Ave|apartment|Apt 15/i, "no street address or home on a prepared page");
  assert.ok(fs.statSync(path.join(FX, "..", "..", "..", "public", apt.cover)).size < 300_000);
  // claim it the way signup does: the whole preset goes to the profile
  const P = JSON.parse(fs.readFileSync(path.join(FX, "..", "..", "..", "public", "presets", "atelier-bo.json"), "utf8"));
  const H = await signup("atbo.claim@example.com", P.handle, P);
  const mine = (await (await fetch(srv.base + "/api/public/host/atbo/scrapbook")).json()).items;
  assert.deepEqual(mine.map((x) => x.title), L.map((x) => x.title));
  assert.equal(mine[0].cover, L[0].cover); assert.ok(mine.every((x) => x.link && x.source === "Partiful" && x.guests === 0));
  await fetch(srv.base + "/api/host/scrapbook/" + mine[0].id, { method: "DELETE", headers: H });
  assert.equal((await (await fetch(srv.base + "/api/host/scrapbook", { headers: H })).json()).items.length, mine.length - 1, "a removed one doesn't come back");
});
