import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Hosts approve "asking to join" guests from the Guests step. The approve box is spliced in
// front of the "Add names" fold, so the splice must match that tag whatever attributes it has.
test("the approve box, paid list and guest notes find the Add names fold", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const base = html.match(/<details class="wc-add"[^>]*>/);
  assert.ok(base, "the Guests step still has an Add names fold");
  assert.ok(!html.includes(`h.replace('<details class="wc-add">'`), "no exact-string splice that breaks when the tag changes");
  const splices = html.match(/h\.replace\(\/<details class="wc-add"\[\^>\]\*>\//g) || [];
  assert.ok(splices.length >= 3, "approve box, paid list and guest notes all splice with a tolerant match");
  const re = /<details class="wc-add"[^>]*>/;
  const out = base[0].replace(re, (m) => `<div class="wc-reqs"><button data-wcok="r1">Let in</button></div>` + m);
  assert.match(out, /data-wcok="r1"/);
  assert.match(html, /data-wcok="\$\{esc\(r\.id\)\}">Let in<\/button>/, "approve button is labelled Let in");
});
