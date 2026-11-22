import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { cleanProfile } from "../server/brand.js";

let srv;
const J = { "content-type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (path, cookie) => fetch(srv.base + path, { headers: cookie ? { cookie } : {} });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function ready(cookie) { for (let i = 0; i < 40; i++) { const b = (await (await get("/api/brand", cookie)).json()).brand; if (b?.status !== "researching") return b; await wait(100); } throw new Error("research never finished"); }

before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "brand-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; resetLoginLimits(); });
after(async () => { await wait(300); for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR"]) delete process.env[k]; await srv.close(); });

test("a work signup starts brand research; the team's corrections win; friends workspaces don't get one", async () => {
  const r = await post("/api/signup", { name: "Maya Chen", email: "maya@example.com", password: "long-password-1", mode: "work", company: "Fernwood Labs", website: "fernwoodlabs.com" });
  assert.equal(r.status, 200); const cookie = cookieOf(r);
  const b = await ready(cookie);
  assert.equal(b.status, "ready", JSON.stringify(b));
  assert.equal(b.profile.company, "Fernwood Labs");
  assert.ok(b.profile.audience.summary, "a guess at who they sell to");
  assert.ok(b.profile.ideas.length >= 2, "event ideas that fit");
  assert.ok(b.profile.ideas.every((x) => ["food", "dining", "movement", "workshop", "drinks", "culture"].includes(x.category)), "ideas map to host categories");
  assert.ok(b.demo, "without a live model the profile is labelled a sample");
  const e = await (await fetch(srv.base + "/api/brand", { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify({ positioning: "Clinical skincare that feels like a treat.", junk: "dropped" }) })).json();
  assert.equal(e.brand.profile.positioning, "Clinical skincare that feels like a treat.");
  assert.deepEqual(e.brand.edited, ["positioning"]);
  assert.equal((await post("/api/brand/research", { website: "not a website ##" }, cookie)).status, 400);
  // a friends workspace has no brand research
  const f = await post("/api/signup", { name: "Claire Kim", email: "claire@example.com", password: "long-password-1", mode: "friends" });
  const fb = await (await get("/api/brand", cookieOf(f))).json();
  assert.equal(fb.brand, null); assert.equal(fb.personal, true);
  assert.equal((await get("/api/brand")).status, 401);
});

test("cleanProfile keeps known fields, caps lists, drops unsafe source links", () => {
  const p = cleanProfile({ company: "X", ideas: Array.from({ length: 9 }, (_, i) => ({ name: "Idea " + i, category: "nope", people: "40" })), sources: [{ title: "ok", url: "https://example.com" }, { title: "bad", url: "javascript:alert(1)" }], confidence: "very" });
  assert.equal(p.ideas.length, 6); assert.equal(p.ideas[0].category, "culture"); assert.equal(p.ideas[0].people, 40);
  assert.deepEqual(p.sources.map((s) => s.title), ["ok"]); assert.equal(p.confidence, "medium");
});
