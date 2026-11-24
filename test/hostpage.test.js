import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";

let srv;
const J = { "content-type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const put = (path, body, cookie) => fetch(srv.base + path, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "hostpage-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR"]) delete process.env[k]; await srv.close(); });

test("A published event shows on the host's own page even when it's kept off Discover; drafts and link-only events don't", async () => {
  const c = cookieOf(await post("/api/signup", { name: "Claire Nguyen", email: "claire.hp@example.com", password: "long-password-1", mode: "friends" }));
  await post("/api/host/profile", { handle: "claire-hp", name: "Claire's Run Crew", city: "New York" }, c);
  const day = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10), base = { kind: "social", casual: true, date: day, startTime: "18:00", city: "New York", activity: "run club" };
  await put("/api/db/doc?path=events/trot", { ...base, name: "Turkey Trot", published: true, discoverable: true, unlisted: true }, c);
  await put("/api/db/doc?path=events/open", { ...base, name: "Open run", published: true, discoverable: true }, c);
  await put("/api/db/doc?path=events/linkonly", { ...base, name: "Friends only", published: true, discoverable: false }, c);
  await put("/api/db/doc?path=events/draft", { ...base, name: "Draft run" }, c);
  const page = await (await fetch(srv.base + "/api/public/host/claire-hp")).json(), names = page.upcoming.map((e) => e.title).sort();
  assert.deepEqual(names, ["Open run", "Turkey Trot"], "published events are on the page; link-only and drafts are not");
  const disc = JSON.stringify(await (await fetch(srv.base + "/api/public/discover")).json());
  assert.ok(disc.includes("Open run"), "listed events are on Discover"); assert.ok(!disc.includes("Turkey Trot"), "kept off Discover");
});
