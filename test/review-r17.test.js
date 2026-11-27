// Review round 17 (docs/review-scorecard.md): what a cold guest reads on a first invite, and the editor's place in history.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { publicEvent } from "../server/app.js";
import { draftToEvent } from "../server/hostloop.js";

const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");

test("a dinner at home still says which neighbourhood, and never the home itself", () => {
  const e = publicEvent({ name: "Dumplings", casual: true, venueName: "My place, Greenpoint", city: "Brooklyn" });
  assert.equal(e.venueName, undefined, "the home stays private"); assert.equal(e.addrHidden, true); assert.equal(e.hood, "Greenpoint");
  const a = publicEvent({ name: "Dumplings", casual: true, venueName: "My apartment, 214 Bedford Ave" });
  assert.equal(a.hood, undefined, "a street address is never kept as the area"); assert.equal(a.addrHidden, true);
  const h = publicEvent({ name: "Dumplings", casual: true, venueName: "Our place, Greenpoint", hood: "Williamsburg" });
  assert.equal(h.hood, "Williamsburg", "the host's own neighbourhood wins");
  const c = publicEvent({ name: "Dumplings", casual: true, venueName: "My place, Brooklyn", city: "Brooklyn" });
  assert.equal(c.hood, undefined, "the city isn't repeated as the area");
  assert.equal(publicEvent({ name: "Dinner", casual: true, venueName: "Lilia" }).venueName, "Lilia", "a restaurant still shows");
});

test("the invite says the address comes later even when there's no area to show", () => {
  const html = read("public/invite.html");
  assert.match(html, /e\.addrHidden \? `<div class="muted">\$\{G\.pin\}<span id="addrNote">Address when you're in<\/span>/);
  assert.ok(html.length < 40000, "the light invite stays under 40,000 characters");
});

test("the line a host writes for guests on /start shows on the invite", () => {
  const e = draftToEvent({ title: "Dumpling night", note: "Bring something to drink." }, { now: "2026-11-27" });
  assert.equal(e.why, "Bring something to drink."); assert.equal(publicEvent({ ...e }).why, "Bring something to drink.");
  assert.equal(draftToEvent({ title: "Dumpling night" }, { now: "2026-11-27" }).why, undefined);
});

test("the event editor is a step in history: Back closes it", () => {
  const js = read("public/canvas.js");
  assert.match(js, /history\.pushState\(\{ \.\.\.\(history\.state \|\| \{\}\), cv: 1 \}/); assert.match(js, /addEventListener\("popstate"/);
  assert.match(js, /function build\(\) \{ document\.body\.classList\.add\("cv-open"\); histIn\(\);/);
});

test("Home puts what you're hosting under the composer, and the loader stays the last script", () => {
  const html = read("index.html");
  assert.match(html, /pl-hosting-first/);
  assert.match(html.slice(html.lastIndexOf("<script>")), /Come with me\?/, "the \"Come with me?\" loader is the last script");
});
