// Review round 7 (host panel): pre-orders get an order form on the light invite, a cost note shows instead of "Free",
// a course's drop-in can be paid for one class, "at the door" says so, weekly regulars get "In again?", the kudos page
// leads with "Would go again", names the place and remembers a follow, and a host with an event coming up isn't told
// to "host your first event".
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore } from "../server/workspaces.js";
import { badgesFor } from "../server/recognition.js";

let srv, host, ws;
const J = { "content-type": "application/json" };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
const post = (path, body, h = {}) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...h }, body: JSON.stringify(body) });
const put = (id, d) => fetch(srv.base + "/api/db/doc?path=events/" + id, { method: "PUT", headers: { ...J, cookie: host }, body: JSON.stringify(d) });
const guestDoc = async (id) => (await (await fetch(srv.base + "/api/db/doc?path=events/" + id, { headers: { "x-encore-guest": "1" } })).json());
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "r7-secret", ENCORE_FAKE_EMAIL: "1", ENCORE_SIGNUP_PER_HOUR: "100" };

before(async () => {
  Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer();
  const r = await post("/api/signup", { name: "Priya Shah", email: "priya.r7@example.com", password: "long-password-1", mode: "friends" }); host = r.headers.get("set-cookie").split(";")[0];
  assert.ok((await post("/api/host/profile", { handle: "crumb-r7", name: "Crumb Theory", city: "Brooklyn" }, { cookie: host })).ok);
  ws = srv.store.get("system/handle-crumb-r7").data.ws;
});
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

test("a pre-order reaches the guest link with its items, and a reply can carry the order", async () => {
  assert.ok((await put("r7bake", { kind: "social", casual: true, name: "Sourdough pre-orders", date: day(5), startTime: "10:00", endTime: "13:00", published: true, preorder: true, activity: "pop-up", meetPoint: "My stoop", hood: "Park Slope", slots: ["10:00–11:00", "11:00–12:00", "12:00–1:00"], orderItems: [{ name: "Country loaf", price: 12 }, { name: "Focaccia", price: 9 }] })).ok);
  const doc = await guestDoc("r7bake");
  assert.equal(doc.data.preorder, true); assert.deepEqual(doc.data.orderItems.map((x) => x.name), ["Country loaf", "Focaccia"]);
  assert.equal(doc.data.meetPoint, "Priya's stoop", "guests read Priya's stoop, never the host's own 'my stoop'");
  const r = await post("/api/db/collection?path=rsvps", { eventId: "r7bake", response: "going", name: "Ben", email: "ben.r7@example.com", orderQty: [{ i: 0, qty: 2 }], slot: "10:00–11:00", code: "AB123" /* review round 8: items and quantities, the server writes the order */, createdAt: Date.now(), via: "invite-order" }, { "x-encore-guest": "1", "x-encore-key": "r7-key-ben", "x-encore-workspace": doc.workspace });
  assert.equal(r.status, 200); const rid = String((await r.json()).id).split("/").pop();
  assert.equal(scopeStore(srv.store, ws).get("rsvps/" + rid).data.order, "2 × Country loaf · pickup 10am to 11am · $24");
});

test("the light invite: pre-orders get the order form, cost notes, at the door, the drop-in, In again and Today", () => {
  const html = read("public/invite.html"), order = read("public/invite-order.js"), rep = read("public/invite-repeat.js");
  assert.ok(html.length < 40000, "still small");
  assert.match(html, /\(\(e\.slots \|\| \[\]\)\.length && !e\.preorder\)/, "a pre-order's pickup windows don't send it to the full invite");
  assert.match(html, /\/invite-order\.js/);
  assert.match(order, /\/api\/public\/order\//, "the shop's order endpoint when the shop is open");
  assert.match(order, /orderQty: lines\.map/, "else a reply with the items and quantities (review round 8)");
  assert.match(order, /data-d="-1"/); assert.match(order, /name="slot"/); assert.match(order, />Order</);
  assert.match(html, /e\.costNote \? `<div class="muted" id="cost">\$\{G\.tag\}/);
  assert.match(html, /e\.ticketNote \? "Pay at the door\." : `You'll pay/);
  assert.match(html, /Pay \$\$\{esc\(\+e\.dropIn\)\} for one class/);
  assert.match(html, /e\.date === ltd \? "Today"/);
  assert.match(rep, /You were in \$\{unit\}\.<\/b> In again\?/);
  assert.doesNotMatch(html + order + rep, /—/, "no em dashes");
});

test("the full invite and the host: cost note, drop-in pay, at the door, Follow Ada, Ask last week's guests", () => {
  const app = read("index.html");
  assert.match(app, /<small>Cost<\/small><b>\$\{esc\(e\.costNote\)\}<\/b>/);
  assert.match(app, /Pay \$\{amt\} for one class/);
  assert.match(app, /pay at the door\.`:`No payment yet/);
  assert.match(app, /Follow \$\{esc\(\/\* review round 7/);
  assert.match(app, /Ask \$\{r7Unit\(d\)\} \$\{G\.length\} guest/);
  assert.match(app, /body:has\(#gStick:not\(\.off\)\) #view-guest\{padding-bottom:96px\}/, "the sticky bar never covers Copy link");
  assert.match(read("public/plans.html"), /Paid\? \$\{hostOf\(cards\[x\.id\]\)\} will confirm/);
  assert.match(read("public/storefront.js"), /e\.costNote \? `<b class="nu-price nu-cost"/);
  assert.match(read("public/community.js"), /free \? \(e\.costNote \|\| "Free"\)/);
});

test("public cards carry the cost note and at-the-door", async () => {
  assert.ok((await put("r7pot", { kind: "social", casual: true, name: "Foodie crawl", date: day(4), published: true, discoverable: true, costNote: "About $40 food cost", hostName: "Priya Shah" })).ok);
  const c = (await (await fetch(srv.base + "/api/public/cards?ids=r7pot")).json()).cards.r7pot;
  assert.equal(c.costNote, "About $40 food cost"); assert.equal(c.hostName, "Priya Shah");
});

test("the kudos page: Would go again first, the place not 'at Marcus's', the follow remembered, the series' next date", async () => {
  // reply while it's coming up, then it happens (replies to a past date are closed)
  const R7 = { kind: "social", casual: true, name: "Weekly run club", repeat: "weekly", published: true, meetPoint: "Prospect Park", startTime: "18:30", hostName: "Priya Shah" };
  assert.ok((await put("r7run1", { ...R7, date: day(2) })).ok);
  const doc = await guestDoc("r7run1");
  const r = await post("/api/db/collection?path=rsvps", { eventId: "r7run1", response: "going", name: "Cleo", email: "cleo.r7@example.com", code: "CL123", createdAt: Date.now() }, { "x-encore-guest": "1", "x-encore-key": "r7-key-cleo", "x-encore-workspace": doc.workspace });
  assert.ok((await put("r7run1", { ...R7, date: day(-1) })).ok);
  const rid = String((await r.json()).id).split("/").pop(), q = `?rid=${rid}&code=CL123`;
  let j = await (await fetch(srv.base + "/api/public/kudos-page/r7run1" + q)).json();
  assert.equal(j.order[0], "again"); assert.equal(j.place, "Prospect Park"); assert.equal(j.following, false);
  assert.ok((await post("/api/public/follow", { handle: "crumb-r7", eventId: "r7run1", rid, code: "CL123", via: "kudos" })).ok);
  j = await (await fetch(srv.base + "/api/public/kudos-page/r7run1" + q)).json();
  assert.ok(j.following, "after a reload the page knows they follow");
  const m = await (await fetch(srv.base + "/api/public/kudos-more/r7run1" + q)).json();
  assert.equal(m.next?.date, day(6), "the next date of the weekly series");
  const kp = read("public/kudos.html");
  assert.ok(kp.indexOf('class="chip again"') < kp.indexOf('id="tags"'), "Would go again renders first");
  assert.match(kp, /`with \$\{j\.hostFirst\}`/); assert.doesNotMatch(kp, /at \$\{j\.hostFirst\}'s/);
});

test("a host with an event coming up isn't told to host their first", () => {
  const now = "2026-11-26";
  assert.match(badgesFor({ dates: [], upcoming: ["2026-12-03"] }, now).next.find((n) => n.id === "first").text, /Your first one is on Thu, Dec 3/);
  assert.equal(badgesFor({ dates: [] }, now).next.find((n) => n.id === "first").text, "Host your first event to start a streak.");
});
