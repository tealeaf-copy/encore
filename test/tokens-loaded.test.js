// A page that styles itself with the kit's tokens must load them. /k/ (the kudos page), /photos and /moderation used
// var(--pl-*) without public/system.css, so on a cold load every colour, border and button fill was empty.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("every page in public/ that uses the kit's tokens loads them (system.css, authguard.js, or its own :root)", () => {
  const dir = new URL("../public/", import.meta.url), bad = [];
  for (const f of fs.readdirSync(dir)) { if (!f.endsWith(".html")) continue; const s = fs.readFileSync(new URL(f, dir), "utf8");
    if (/var\(--pl-/.test(s) && !/href="\/system\.css"|authguard\.js|--pl-page:/.test(s)) bad.push(f); }
  assert.deepEqual(bad, []);
});
