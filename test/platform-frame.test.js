// The platform frame (docs/brand-kit.md): on shared surfaces the platform owns the frame and the host brings a cover,
// a title, a face and one accent. No kit font on feed or story cards; a missing or tiny cover falls back to our art.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");

test("platform frame: story and feed cards carry the host's accent, never a kit font", () => {
  const bk = read("public/brandkit.js"), css = read("public/brandkit.css"), fv = read("public/feedvisual.js");
  const story = bk.match(/function storyStyle\(h\) \{[^\n]*\}/)[0];
  assert.doesNotMatch(story, /--kit-display|--kit-body|--kit-dw|font/i, "storyStyle has no family or weight");
  assert.match(story, /--kit-accent:/, "the accent is allowed");
  assert.match(fv, /storyStyle\(e\.host\)/);
  for (const rule of css.match(/\.kit-story[^{]*\{[^}]*\}/g) || []) assert.doesNotMatch(rule, /font-family|--kit-display/, rule);
  // run it: a kit with a display face gives the card only accent variables
  const ctx = { window: {}, document: undefined }; ctx.window.EncoreColor = undefined; vm.createContext(ctx);
  vm.runInContext(read("public/color.js"), ctx); vm.runInContext(read("public/brandkit.js"), ctx);
  const K = ctx.window.EncoreBrandKit || ctx.EncoreBrandKit;
  if (K?.storyStyle) { const s = K.storyStyle({ brandKit: { ...K.STARTERS.supper, starter: "supper" } }); assert.match(s, /--kit-accent:#/); assert.doesNotMatch(s, /Playfair|--kit-display/); }
});

test("platform frame: a missing or tiny cover gets our drawn cover, a good one keeps the 4:5 crop", () => {
  const fv = read("public/feedvisual.js");
  const coverOK = vm.runInNewContext("(" + fv.match(/const coverOK = (\(e\) => [^;]*);/)[1] + ")");
  assert.equal(coverOK({ cover: "/_blob/abc", look: { coverW: 320, coverH: 400 } }), false, "under 600px wide: our art");
  assert.equal(coverOK({ cover: "" }), false, "no cover: our art");
  assert.equal(coverOK({ cover: "/_blob/abc", look: { coverW: 1080, coverH: 1350 } }), true);
  const fails = vm.runInNewContext("(" + fv.match(/function coverFails\(img\) \{[\s\S]*?catch \{ return false; \} \}/)[0] + ")", { document: { createElement: () => { throw new Error("no canvas"); } }, Math });
  assert.equal(fails({ naturalWidth: 400 }), true, "a photo that loads under 600px is swapped at runtime");
  assert.equal(fails({ naturalWidth: 1200 }), false, "an unreadable photo is kept");
  assert.match(fv, /data-fv-q src=[^>]*object-fit:cover;object-position:/, "the feed card is a fixed crop, never a letterboxed poster");
  assert.match(fv, /<h3 class="fv-title"><a [^>]*>\$\{esc\(e\.title\)\}<\/a><\/h3>/, "the title is ours, under the picture");
});

test("platform frame: the brand kit editor previews the host's card in the feed between two plain ones", () => {
  const ed = read("public/brandkit-editor.js");
  assert.match(ed, /Preview in feed/); assert.match(ed, /class="bk-feedpv kit-off"/);
  assert.equal((ed.match(/fc\(false,/g) || []).length, 2, "two neutral sample cards"); assert.match(ed, /fc\(true,/);
});
