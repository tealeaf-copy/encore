import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";

let srv;
const J = { "Content-Type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const put = (path, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });

before(async () => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "card-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; resetLoginLimits(); srv = await startServer(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR"]) delete process.env[k]; await srv.close(); });

test("Public event cards never show where a private or ask-to-join event meets", async () => {
  const r = await post("/api/signup", { name: "Ada Host", email: "ada.card@example.com", password: "long-password-1", mode: "friends" });
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const base = { name: "Book supper", date: "2099-05-01", startTime: "19:00", city: "Brooklyn" };
  assert.ok((await put("events/askjoin1", { ...base, meetPoint: "1012 Sterling Pl, apt 3R", approvalRequired: true, discoverable: true }, cookie)).ok);
  assert.ok((await put("events/linkonly1", { ...base, meetPoint: "1012 Sterling Pl, apt 3R", discoverable: false }, cookie)).ok);
  assert.ok((await put("events/openrun1", { ...base, name: "Park run", meetPoint: "Grand Army Plaza gate", discoverable: true }, cookie)).ok);
  const cards = (await (await fetch(srv.base + "/api/public/cards?ids=askjoin1,linkonly1,openrun1")).json());
  const L = Object.values(cards.cards || {});
  const by = Object.fromEntries(L.filter(Boolean).map((c) => [c.id, c]));
  assert.equal(by.askjoin1?.meetPoint, undefined, "ask-to-join hides the address");
  assert.equal(by.linkonly1?.meetPoint, undefined, "link-only hides the address");
  assert.equal(by.openrun1?.meetPoint, "Grand Army Plaza gate", "open, listed events keep their public meet point");
});
