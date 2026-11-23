import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

test("every inline script in index.html parses", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(blocks.length > 0);
  blocks.forEach((src, i) => assert.doesNotThrow(() => new vm.Script(src, { filename: `index.html#script${i}` }), `script block ${i} has a syntax error`));
});
