// The guest reply form (the light invite's #f in public/invite.html, the full invite's #gForm in index.html), kept short:
// name, how to reach you, the reply, food only when there's food; one name toggle; the severe-allergy box only under a food
// answer; one "Add a little more (optional)" disclosure; one 22px checkbox; "Send my reply" in the brand accent.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");

test("reply form: one disclosure for the optional bits, one name toggle, the allergy box under the food answer", () => {
  const s = read("public/slots.js");
  const q = s.slice(s.indexOf("function quietFormHTML"), s.indexOf("async function syncQuiet"));
  assert.match(q, /<details class="sl-quietform pl-more" id="slQuietForm"/); assert.match(q, /<summary>Add a little more \(optional\)<\/summary>/);
  assert.match(q, /Coming solo<small>We'll say how many others are, never who\.<\/small>/); assert.doesNotMatch(q, /sl-askd/, "no second disclosure inside it");
  const t = s.slice(s.indexOf("function tidyForm"), s.indexOf("function ctxOf"));
  assert.match(t, /details\.g-more, details\.g-fun/, "the full invite's More (optional) bits move into it");
  assert.match(t, /Show my name on Who's coming/); assert.match(t, /wall\.checked = sm\.checked/, "the older toggle follows the one people see");
  assert.match(t, /sv\.hidden = !dt\.value\.trim\(\)/); assert.match(t, /dl\.after\(sv\)/);
  assert.match(t, /btns\.after\(rem\)/, "Save my details is a line under Send"); assert.match(s, /try \{ tidyForm\(\); \}/);
  assert.doesNotMatch(t + q, /—/);
});

test("reply form: hidden stays hidden, a 22px checkbox with a centred tick and a focus ring, Send in the brand accent", () => {
  const css = read("public/slots.css"), sys = read("public/system.css");
  assert.match(css, /html body :is\(#f,#gForm\) \[hidden\]\[hidden\]\{display:none!important\}/);
  assert.match(css, /:is\(#f,#gForm\) input\[type=checkbox\]\{-webkit-appearance:none!important;appearance:none!important;width:22px!important;height:22px!important/);
  assert.match(css, /place-content:center/); assert.match(css, /input\[type=checkbox\]:focus-visible\{outline:2px solid/);
  assert.match(css, /:is\(#f #send,#gForm #g-send\)\{background:var\(--kit-btn,var\(--pl-accent/);
  assert.match(sys, /label\.chip\.chip:not\(\[hidden\]\):has\(> input\[type=checkbox\]\)/, "the row style no longer un-hides hidden boxes");
});

test("reply form: the button says Send my reply on both invites, and the light invite stays small", () => {
  const inv = read("public/invite.html"), spa = read("index.html");
  assert.match(inv, /\(v !== "no" && e\.qStyle\?\.button\?\.trim\(\)\) \|\| "Send my reply"/); assert.ok(inv.length < 40000, "invite.html: " + inv.length);
  assert.match(spa, /id="g-send">Send my reply<\/button>/); assert.match(spa, /full\?"Join waitlist":"Send my reply"/);
});
