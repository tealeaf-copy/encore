import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { STORE } from "../server/community.js";

// storefront.js is a browser script: run it with a bare window and read what it exports
function store() { const window = {}; vm.runInNewContext(fs.readFileSync(new URL("../public/storefront.js", import.meta.url), "utf8"), { window, document: {}, localStorage: {}, console }); const S = window.EncoreStore, plain = (v) => JSON.parse(JSON.stringify(v)); return { ...S, LOOKS: plain(S.LOOKS), ACCENTS: plain(S.ACCENTS), bandItems: (h) => plain(S.bandItems(h)) }; }
const preset = () => JSON.parse(fs.readFileSync(new URL("../public/presets/sweetpea-sorrel.json", import.meta.url), "utf8"));

test("the Flower shop example preset loads, is listed as a showcase and is marked as an example", () => {
  const P = preset(), list = JSON.parse(fs.readFileSync(new URL("../public/presets/showcase.json", import.meta.url), "utf8"));
  assert.ok(list.includes("sweetpea-sorrel")); assert.equal(P.handle, "sweetpea-sorrel"); assert.equal(P.example, true);
  assert.ok(P.experiences.length >= 2 && P.past.length >= 2 && P.past.length <= 3);
});

test("the Flower shop look uses valid keys, in the page and on the server", () => {
  const S = store(), L = S.LOOKS.florist.set, t = preset().theme;
  assert.deepEqual({ accent: t.accent, font: t.font, bg: t.bg, cover: t.cover, buttons: t.buttons }, L, "the preset wears the look");
  assert.ok(S.FONTS[L.font] && S.BGS[L.bg] && S.COVERS[L.cover] && S.BUTTONS[L.buttons] && S.ACCENTS.includes(L.accent));
  assert.ok(STORE.fonts.includes(L.font) && STORE.backgrounds.includes(L.bg) && STORE.covers.includes(L.cover) && STORE.buttons.includes(L.buttons) && STORE.accents.includes(L.accent), "the server keeps it when saved");
  for (const v of Object.values(S.LOOKS.default.set)) assert.ok(v);
  assert.ok(S.FLORAL.test(S.floralText(preset())), "a flower shop gets the suggestion");
  assert.ok(!S.FLORAL.test(S.floralText({ name: "Saturday Run Club", tagline: "5k, coffee after" })), "a run club doesn't");
});

test("the services band only lists what the host wrote", () => {
  const S = store(), P = preset();
  assert.deepEqual(S.bandItems(P), ["Wedding & event flowers", "Bouquets", "Workshops"]);
  // a sentence isn't a list: the band falls back to their experiences and shop items by name
  const h = { services: "We do flowers for weddings and a lot more, just ask.", experiences: [{ name: "Bouquet class" }], shop: { items: [{ name: "Peony bunch" }] } };
  assert.deepEqual(S.bandItems(h), ["Bouquet class", "Peony bunch"]);
  const own = new Set([...P.services.split("|").map((x) => x.trim()), ...P.experiences.map((x) => x.name), ...P.shop.items.map((x) => x.name)]);
  for (const x of S.bandItems(P)) assert.ok(own.has(x), x);
  assert.deepEqual(S.bandItems({ name: "Bloom Room" }), [], "nothing to list: no band");
  assert.equal(S.badgeLine(P), "Flower shop & studio");
  assert.equal(S.badgeLine({ tagline: "Bouquets and floral workshops in Queens" }), "Bouquets and floral workshops");
});
