import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { keywordRank, cardOf } from "../server/search.js";

const hosts = [
  { handle: "kiln", name: "Little Kiln", city: "Brooklyn", tagline: "Pottery nights for beginners", tags: ["ceramics"], experiences: [{ name: "Wheel class for your team", min: 6, max: 20, price: "$65 a person" }] },
  { handle: "phin", name: "Phin Bar", city: "Manhattan", tagline: "Vietnamese coffee at your launch", tags: ["coffee"] },
  { handle: "run", name: "Run Crew", city: "New York", tagline: "Saturday 5Ks", tags: ["running"] },
];

test("Plain-language search finds hosts by what they do, including everyday synonyms", () => {
  assert.equal(keywordRank("a ceramics class for my team", hosts)[0].handle, "kiln");
  assert.equal(keywordRank("someone to serve espresso and lattes", hosts)[0].handle, "phin", "coffee words match a coffee host");
  assert.deepEqual(keywordRank("the and for", hosts), [], "filler words alone match nothing");
});

test("Only public fields go to the model", () => {
  const c = cardOf({ ...hosts[0], legalName: "Secret LLC", taxId: "12-345", ownerEmail: "a@b.c" });
  assert.ok(!JSON.stringify(c).match(/Secret|12-345|a@b\.c/));
});

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.close(); });
test("The search endpoint answers in plain language and only with real hosts", async () => {
  const j = await (await fetch(srv.base + "/api/public/hosts/search?q=" + encodeURIComponent("something sweet with pandan for our office"))).json();
  assert.ok(j.matches.length >= 1); assert.equal(j.matches[0].handle, "atbo"); assert.ok(j.matches[0].why);
  const short = await (await fetch(srv.base + "/api/public/hosts/search?q=a")).json(); assert.deepEqual(short.matches, []);
});
