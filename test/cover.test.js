import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";

let srv;
const J = { "content-type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "cover-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR"]) delete process.env[k]; await srv.close(); });

test("A collab cover made on /covers goes on the booking's guest page, only with the organizer's link", async () => {
  const h = await post("/api/signup", { name: "Linh Cover", email: "linh.c@example.com", password: "long-password-1", mode: "friends" }); const hc = cookieOf(h);
  const pr = await (await post("/api/host/profile", { handle: "second-pour", name: "Second Pour", experiences: [{ name: "Coffee pop-up", min: 10, max: 80, price: "$900 flat", category: "dining" }] }, hc)).json();
  const day = new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10);
  const bk = await (await post("/api/public/book/second-pour", { name: "Ava", company: "Northwind", email: "ava.c@northwind.example", experienceId: pr.host.experiences[0].id, people: 40, date: day, time: "08:00", when: "soon", where: "Valencia St", message: "Launch week coffee pop-up for customers." })).json();
  const id = bk.id, t = new URL(bk.status).searchParams.get("t");
  const up = (tok, body = PNG, ct = "image/png") => fetch(`${srv.base}/api/public/booking/${id}/cover?t=${tok}`, { method: "POST", headers: { "content-type": ct }, body });
  assert.equal((await up(t)).status, 404, "needs a guest page first");
  const eid = (await (await post(`/api/public/booking/${id}/event`, { t, title: "Sip n' Ship" })).json()).link.split("rsvp-")[1];
  const r0 = await (await fetch(`${srv.base}/api/public/booking/${id}/results?t=${t}`)).json();
  assert.equal(r0.brand, "Northwind"); assert.equal(r0.shop, "Second Pour"); assert.equal(r0.evTitle, "Sip n' Ship"); assert.equal(r0.coverPhoto, "");
  assert.equal((await up("wrong")).status, 403);
  assert.equal((await up(t, "<svg/>", "image/svg+xml")).status, 415, "no SVG or other types");
  const ok = await (await up(t)).json(); assert.ok(ok.url.startsWith("/_blob/"));
  const blob = await fetch(srv.base + ok.url); assert.equal(blob.status, 200);
  const r1 = await (await fetch(`${srv.base}/api/public/booking/${id}/results?t=${t}`)).json(); assert.equal(r1.coverPhoto, ok.url);
  const pub = await (await fetch(`${srv.base}/api/db/doc?path=${encodeURIComponent("events/" + eid)}`, { headers: { "x-encore-guest": "1" } })).json();
  assert.equal(pub.data.coverPhoto, ok.url, "guests see the cover");
  assert.equal((await fetch(srv.base + "/covers")).status, 200);
});
