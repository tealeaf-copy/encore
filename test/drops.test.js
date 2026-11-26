// Drops (server/drops.js): the shop became "a drop", a pre-order event. Items added in setup show to guests, a price is
// required, the exact pickup address only reaches people who ordered, an old shop converts once and keeps its orders,
// old /x/<handle>/shop links open the drop, and the cover photo upload is checked and used for the share preview.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore, updateWorkspace, getWorkspace } from "../server/workspaces.js";
import { fakeOutbox } from "../server/email.js";
import { cleanDrop, shopToDrop } from "../server/drops.js";
import { sniffImage } from "../server/cover.js";

let srv, host, ws, other;
const J = { "Content-Type": "application/json" };
const ADDR = "777 6th Ave, Apt 15J";
const post = (path, body, h = {}) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...h }, body: JSON.stringify(body) });
const getJ = async (path, h = {}) => { const r = await fetch(srv.base + path, { headers: h, redirect: "manual" }); return { status: r.status, r, text: await r.text() }; };
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "drops-secret", ENCORE_FAKE_EMAIL: "1", ENCORE_SIGNUP_PER_HOUR: "100", ENCORE_DIRECTORY_CACHE_MS: "0" };
const join = async (name, email, handle) => { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200); const c = r.headers.get("set-cookie").split(";")[0];
  assert.ok((await post("/api/host/profile", { name, handle, city: "New York", hood: "Midtown", tagline: "Pandan everything", bio: "I bake on Saturdays." }, { cookie: c })).ok); return { cookie: c, ws: srv.store.get("system/handle-" + handle).data.ws }; };
const PANDAN = { title: "Pandan this Saturday", items: [{ name: "Pandan honeycomb cake", price: "18" }, { name: "Kaya toast box", price: "9.50", stock: 2 }], slots: ["Sat 9 to 10am"], area: "Midtown", address: ADDR, always: true, pay: "pickup" };
const guestHdr = (w) => ({ "x-encore-guest": "1", "x-encore-key": "k" + Math.random().toString(36).slice(2), "x-encore-workspace": w });
const order = (w, eventId, body) => post("/api/db/collection?path=rsvps", { eventId, response: "going", name: "Lan", email: "lan@example.com", code: "ABCDEF", createdAt: Date.now(), ...body }, guestHdr(w));

before(async () => { Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer();
  const a = await join("Bo Tran", "bo.drops@example.com", "bo-drops"); host = a.cookie; ws = a.ws; other = await join("Cy Park", "cy.drops@example.com", "cy-drops"); });
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

test("a price is required: an item without one is refused with its name, never saved as $0", async () => {
  assert.equal(cleanDrop({ ...PANDAN, items: [{ name: "Pandan", price: "" }] }).error, "Add a price for Pandan.");
  assert.match(cleanDrop({ ...PANDAN, items: [{ name: "Pandan", price: "free" }] }).error, /Check the price for Pandan/);
  assert.equal(cleanDrop({ ...PANDAN, items: [] }).error, "Add at least one thing to sell, with a price.");
  assert.equal(cleanDrop({ ...PANDAN, slots: [] }).error, "Add at least one pickup time.");
  const r = await post("/api/host/drops", { ...PANDAN, items: [{ name: "Pandan", price: "" }] }, { cookie: host }); assert.equal(r.status, 400); assert.equal((await r.json()).message, "Add a price for Pandan.");
  // empty rows the host never filled are skipped, not errors
  assert.equal(cleanDrop({ ...PANDAN, items: [{ name: "Pandan", price: 4 }, { name: "", price: "" }] }).drop.items.length, 1);
});

test("regression: items added in setup show to guests, signed out and as the owner, and old shop links open the drop", async () => {
  const r = await post("/api/host/drops", PANDAN, { cookie: host }); assert.equal(r.status, 200); const j = await r.json(); assert.ok(j.id);
  for (const h of [{}, { cookie: host }]) { const p = JSON.parse((await getJ("/api/public/drops/bo-drops", h)).text);
    assert.deepEqual(p.drops[0].items.map((x) => [x.name, x.priceText, x.left]), [["Pandan honeycomb cake", "$18", null], ["Kaya toast box", "$9.50", 2]]); }
  const one = JSON.parse((await getJ("/api/public/drop/" + j.id)).text).drop; assert.equal(one.items.length, 2); assert.equal(one.area, "Midtown");
  // it's an event under the hood: a pre-order guests reply to
  const ev = scopeStore(srv.store, ws).get("events/" + j.id).data; assert.equal(ev.preorder, true); assert.equal(ev.drop, true); assert.equal(ev.orderItems[1].price, 9.5);
  const x = await getJ("/x/bo-drops/shop/0"); assert.equal(x.status, 302); assert.equal(x.r.headers.get("location"), "/e/" + j.id);
  // the old shop endpoint points to the drop once a shop has become one (below); a host with no shop gets nothing
  assert.equal(JSON.parse((await getJ("/api/public/shop/bo-drops")).text).shop, null);
});

test("privacy: the exact pickup address never reaches a public page, the feed, /x pages or the API; buyers get it", async () => {
  const j = await (await post("/api/host/drops", { ...PANDAN, title: "Private test" }, { cookie: host })).json();
  // the old shop's address too (a host saved one before drops existed)
  const W = getWorkspace(ws); updateWorkspace(ws, { host: { ...W.host, shop: { open: true, title: "Old", items: [], slots: [], where: "Midtown", address: ADDR } } });
  for (const p of ["/api/public/host/bo-drops", "/api/public/drops/bo-drops", "/api/public/drop/" + j.id, "/api/public/discover", "/api/public/feed", "/@bo-drops", "/e/" + j.id, "/x/bo-drops/shop/0", "/api/public/shop/bo-drops", "/api/public/shops"]) {
    const t = (await getJ(p)).text; assert.ok(!t.includes("777 6th"), p + " shows the address"); }
  const g = await fetch(srv.base + "/api/db/doc?path=events/" + j.id, { headers: guestHdr(ws) }); assert.ok(!(await g.text()).includes("777 6th"), "the guest's copy of the event");
  // someone who ordered: their reply carries the order, the address endpoint gives it, the email says it
  const before0 = fakeOutbox.length;
  const o = await order(ws, j.id, { orderQty: [{ i: 0, qty: 1 }] }); assert.equal(o.status, 200, await o.clone().text()); const oj = await o.json(); const rid = String(oj.id || oj.doc?.id || "").split("/").pop();
  const a = JSON.parse((await getJ(`/api/public/address/${j.id}?rid=${rid}&code=ABCDEF`)).text); assert.equal(a.venueAddr, ADDR);
  const nope = JSON.parse((await getJ(`/api/public/address/${j.id}?rid=${rid}&code=WRONG`)).text); assert.equal(nope.ok, false);
  await new Promise((r) => setTimeout(r, 300));
  const mail = fakeOutbox.slice(before0).find((m) => String(m.to).includes("lan@example.com")); assert.ok(mail, "an order email: " + JSON.stringify(fakeOutbox.slice(before0).map((m) => [m.to, m.subject]))); assert.match(mail.text, /Pickup address: 777 6th Ave, Apt 15J/); assert.match(mail.text, /1 × Pandan honeycomb cake/);
});

test("stock and orders: what's left this batch holds, the host sees the order in one inbox, a new batch clears the counts", async () => {
  const j = await (await post("/api/host/drops", { ...PANDAN, title: "Stock test" }, { cookie: host })).json();
  assert.equal((await order(ws, j.id, { email: "a@example.com", orderQty: [{ i: 1, qty: 2 }] })).status, 200);
  const r = await order(ws, j.id, { email: "b@example.com", orderQty: [{ i: 1, qty: 1 }] }); assert.equal(r.status, 409); assert.equal((await r.json()).message, "Sold out. No Kaya toast box left.");
  const inbox = JSON.parse((await getJ("/api/host/orders", { cookie: host })).text).orders.filter((o) => o.eventId === j.id); assert.equal(inbox.length, 1); assert.equal(inbox[0].totalText, "$19"); assert.equal(inbox[0].src, "drop");
  assert.equal((await post("/api/host/drop-orders/" + inbox[0].id, { status: "paid" }, { cookie: host })).status, 200);
  assert.equal(JSON.parse((await getJ("/api/host/orders", { cookie: host })).text).orders.find((o) => o.id === inbox[0].id).status, "paid");
  const nb = await (await post(`/api/host/drops/${j.id}/new-batch`, { tell: false }, { cookie: host })).json(); assert.equal(nb.id, j.id);
  assert.equal(JSON.parse((await getJ("/api/public/drop/" + j.id)).text).drop.items[1].left, 2, "counts start again, items kept");
  assert.equal((await order(ws, j.id, { email: "b@example.com", orderQty: [{ i: 1, qty: 1 }] })).status, 200);
  // paused: no new orders
  assert.equal((await post("/api/host/drops/" + j.id, { open: false }, { cookie: host })).status, 200);
  const p = await order(ws, j.id, { email: "c@example.com", orderQty: [{ i: 0, qty: 1 }] }); assert.equal(p.status, 409);
});

test("migration: an old shop becomes an always-available drop once, and its orders stay readable", async () => {
  const W = getWorkspace(other.ws); updateWorkspace(other.ws, { host: { ...W.host, shop: { open: true, title: "Cy's beans", note: "Roasted Friday", where: "Midtown", address: ADDR, slots: ["Sat 10-11"], payUrl: "https://venmo.com/cy", dropId: "abc123", items: [{ id: "aaaaaaaa", name: "Beans 250g", cents: 1600, stock: 10, max: 4 }] } } });
  scopeStore(srv.store, other.ws).add("orders", { code: "AB12", dropId: "abc123", name: "Dee", email: "dee@example.com", lines: [{ id: "aaaaaaaa", name: "Beans 250g", qty: 1, cents: 1600 }], total: 1600, status: "new", at: Date.now() });
  const d = JSON.parse((await getJ("/api/host/drops", { cookie: other.cookie })).text).drops; assert.equal(d.length, 1);
  assert.deepEqual([d[0].title, d[0].always, d[0].items[0].price, d[0].items[0].stock, d[0].area, d[0].address, d[0].pay, d[0].open], ["Cy's beans", true, 16, 10, "Midtown", ADDR, "link", true]);
  assert.equal(shopToDrop(srv.store, null, other.ws), "", "only once");
  assert.equal(JSON.parse((await getJ("/api/host/drops", { cookie: other.cookie })).text).drops.length, 1);
  const inbox = JSON.parse((await getJ("/api/host/orders", { cookie: other.cookie })).text).orders; assert.ok(inbox.some((o) => o.src === "shop" && o.code === "AB12"), "the old order is still there");
  const pub = JSON.parse((await getJ("/api/public/shop/cy-drops")).text); assert.equal(pub.shop, null); assert.equal(pub.drop.id, d[0].id);
  const x = await getJ("/x/cy-drops/shop/0"); assert.equal(x.r.headers.get("location"), "/e/" + d[0].id);
  // a later save through the old shop form never converts it again
  assert.ok((await post("/api/host/profile", { shop: { open: true, items: [{ name: "Beans", cents: 1600 }] } }, { cookie: other.cookie })).ok);
  assert.equal(JSON.parse((await getJ("/api/host/drops", { cookie: other.cookie })).text).drops.length, 1);
});

test("cover photo: PNG, JPEG or WebP by their bytes, 8 MB at most, the owner's own; used as the share image", async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
  assert.equal(sniffImage(png), "image/png"); assert.equal(sniffImage(Buffer.from("<svg onload=alert(1)>............")), "");
  const up = (body, type, q = "", c = host) => fetch(srv.base + "/api/host/cover" + q, { method: "POST", headers: { "Content-Type": type, cookie: c }, body });
  assert.equal((await up(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>....."), "image/png")).status, 415, "a renamed SVG is refused");
  assert.equal((await up(Buffer.concat([png, Buffer.alloc(8 * 1024 * 1024)]), "image/png")).status, 413);
  assert.equal((await fetch(srv.base + "/api/host/cover", { method: "POST", headers: { "Content-Type": "image/png" }, body: png })).status, 401, "signed out");
  const ok = await (await up(png, "image/png", "?x=30&y=70")).json(); assert.match(ok.coverUrl, /^\/_blob\/[A-Za-z0-9]{20}$/); assert.equal(ok.coverPos, "30% 70%");
  assert.equal((await post("/api/host/cover/position", { x: 55, y: 20 }, { cookie: host })).status, 200);
  assert.equal(getWorkspace(ws).host.theme.coverPos, "55% 20%");
  const html = (await getJ("/@bo-drops")).text; assert.ok(html.includes(`<meta property="og:image" content="${srv.base}${ok.coverUrl}">`) || html.includes(`${ok.coverUrl}">`), "og:image"); assert.match(html, /summary_large_image/);
  // another host can't wear this upload as their cover through the profile form
  await post("/api/host/profile", { theme: { coverUrl: ok.coverUrl } }, { cookie: other.cookie }); assert.notEqual(getWorkspace(other.ws).host.theme.coverUrl, ok.coverUrl);
  // a page with no photo: the calm cover is the default, and no og:image is made up
  assert.equal(getWorkspace(other.ws).host.theme.cover, "calm"); assert.ok(!(await getJ("/@cy-drops")).text.includes("og:image"));
  assert.equal((await fetch(srv.base + "/api/host/cover", { method: "DELETE", headers: { cookie: host } })).status, 200); assert.equal(getWorkspace(ws).host.theme.coverUrl, "");
});
