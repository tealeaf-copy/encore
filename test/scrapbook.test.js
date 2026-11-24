import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { parseEventPage, importable } from "../server/scrapbook.js";

test("Reads an event page's own description of itself (schema.org and Open Graph)", () => {
  const html = `<html><head><title>x</title><meta property="og:title" content="Fallback title"><meta property="og:image" content="https://images.example-cdn.com/c.jpg">
  <script type="application/ld+json">{"@type":"SocialEvent","name":"Dumpling Night &amp; Friends","startDate":"2025-03-14T19:00:00-04:00","location":{"name":"Mai's apartment","address":{"addressLocality":"Brooklyn","addressRegion":"NY"}},"description":"We fold 300 dumplings"}</script></head></html>`;
  const e = parseEventPage(html);
  assert.equal(e.title, "Dumpling Night &amp; Friends".replace("&amp;", "&amp;")); assert.equal(e.date, "2025-03-14"); assert.equal(e.place, "Mai's apartment"); assert.equal(e.image, "https://images.example-cdn.com/c.jpg");
  const og = parseEventPage(`<meta property="og:title" content="Matcha Morning"><meta property="og:description" content="Whisking in Bushwick">`); assert.equal(og.title, "Matcha Morning"); assert.equal(og.date, "");
});

test("Only Partiful, Luma and Eventbrite links over https are read", () => {
  for (const ok of ["https://partiful.com/e/abc123", "https://lu.ma/xyz", "https://www.eventbrite.com/e/123", "https://www.eventbrite.co.uk/e/1"]) assert.ok(importable(ok), ok);
  for (const bad of ["http://partiful.com/e/a", "https://evil.com/partiful.com", "https://169.254.169.254/latest", "https://partiful.com.evil.io/e", "javascript:alert(1)"]) assert.equal(importable(bad), null, bad);
});

let srv;
const J = { "content-type": "application/json" };
before(async () => { srv = await startServer(); process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "scrap-secret"; });
after(async () => { delete process.env.ENCORE_SIGNUP; delete process.env.SESSION_SECRET; await srv.close(); });
test("Hosts add past gatherings by hand or from a CSV; the scrapbook is public, edits are theirs only", async () => {
  const su = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name: "Mai Tran", email: "mai.scrap@example.com", password: "long-password-1", mode: "friends" }) });
  const c = su.headers.get("set-cookie").split(";")[0], H = { ...J, cookie: c };
  await fetch(srv.base + "/api/host/profile", { method: "POST", headers: H, body: JSON.stringify({ handle: "mai-scrap", name: "Mai's Kitchen" }) });
  const r = await (await fetch(srv.base + "/api/host/scrapbook/import", { method: "POST", headers: H, body: JSON.stringify({ links: ["https://example.com/my-party"], rows: [{ title: "Lunar New Year potluck", date: "Feb 8, 2025", place: "Queens", guests: 22 }], item: { title: "First supper club <b>", date: "2024-10-05", note: "Burned the rice. Nobody minded." } }) })).json();
  assert.equal(r.added.length, 2); assert.equal(r.skipped.length, 1, "a link from another site is skipped");
  const pub = await (await fetch(srv.base + "/api/public/host/mai-scrap/scrapbook")).json();
  assert.deepEqual(pub.items.map((x) => x.title), ["Lunar New Year potluck", "First supper club"]); assert.equal(pub.items[0].date, "2025-02-08"); assert.equal(pub.items[0].guests, 22);
  assert.equal((await fetch(srv.base + "/api/host/scrapbook/import", { method: "POST", headers: J, body: JSON.stringify({ item: { title: "x" } }) })).status, 401);
  const id = pub.items[1].id; await fetch(srv.base + "/api/host/scrapbook/" + id, { method: "POST", headers: H, body: JSON.stringify({ note: "Still the best night", photos: ["/_blob/AAAAAAAAAAAAAAAAAAAA", "https://evil.example/x.jpg"] }) });
  const again = (await (await fetch(srv.base + "/api/public/host/mai-scrap/scrapbook")).json()).items.find((x) => x.id === id);
  assert.equal(again.note, "Still the best night"); assert.deepEqual(again.photos, ["/_blob/AAAAAAAAAAAAAAAAAAAA"], "only uploaded photos are kept");
  await fetch(srv.base + "/api/host/scrapbook/" + id, { method: "DELETE", headers: { cookie: c } });
  assert.equal((await (await fetch(srv.base + "/api/public/host/mai-scrap/scrapbook")).json()).items.length, 1);
});

test("Henly storefront links can be imported too", async () => {
  const { importable, parseEventPage } = await import("../server/scrapbook.js");
  assert.ok(importable("https://www.henly.app/omecasa-2/come-say-hi-and-grab-a-bite-2"));
  assert.equal(importable("http://www.henly.app/x"), null, "https only");
  const p = parseEventPage(`<meta property="og:title" content="come say hi &amp; grab a bite"><meta property="og:image" content="https://cdn.example.com/a.jpg"><meta property="og:description" content="Pandan cake sets, pickup Saturday">`);
  assert.equal(p.title, "come say hi & grab a bite"); assert.match(p.about, /Pandan/);
});
