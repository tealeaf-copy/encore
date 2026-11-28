// A drop is an order, not an event (server/drops.js, public/droppage.js, public/pickup.js): the guest page is an order
// form with none of the event reply form's questions, every view says when to pick up in the same words (never "Date
// TBD" when a window has a date), an order lands in Plans as a pickup and in the host's Orders by pickup window, the
// exact spot only comes the day before, and a drop is photo first (its cover, up to 4 photos an item, checked uploads).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore } from "../server/workspaces.js";
import { fakeOutbox } from "../server/email.js";
import { cleanDrop, dropEvent, publicDrop, addressOpen } from "../server/drops.js";
import "../public/pickup.js";

const P = globalThis.PLPickup, J = { "Content-Type": "application/json" };
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
let srv, host, ws, other;
const post = (p, b, h = {}) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...h }, body: JSON.stringify(b) });
const getJ = async (p, h = {}) => { const r = await fetch(srv.base + p, { headers: h, redirect: "manual" }); return { status: r.status, text: await r.text(), r }; };
const join = async (name, email, handle) => { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200); const c = r.headers.get("set-cookie").split(";")[0];
  if (handle) assert.ok((await post("/api/host/profile", { name, handle, city: "New York", hood: "Greenpoint", tagline: "Pandan everything", bio: "I bake on weekends." }, { cookie: c })).ok);
  return { cookie: c, ws: handle ? srv.store.get("system/handle-" + handle).data.ws : "" }; };
const guest = (w) => ({ "x-encore-guest": "1", "x-encore-key": "k" + Math.random().toString(36).slice(2), "x-encore-workspace": w });
const order = (w, eventId, body) => post("/api/db/collection?path=rsvps", { eventId, response: "going", name: "Lan Pham", email: "lan.drop@example.com", code: "ABCDEF", createdAt: Date.now(), ...body }, guest(w));
// a real PNG header (100×100) so the upload checks read its size
const png = (n = 64) => { const b = Buffer.alloc(33 + n); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0); b.writeUInt32BE(13, 8); b.write("IHDR", 12, "latin1"); b.writeUInt32BE(100, 16); b.writeUInt32BE(100, 20); b[24] = 8; b[25] = 2; return b; };
const upload = (buf, type, c = host) => fetch(srv.base + "/api/photos?for=item", { method: "POST", headers: { "Content-Type": type, cookie: c }, body: buf });
const DROP = (over = {}) => ({ title: "Pandan this Sunday", items: [{ name: "Pandan honeycomb cake", price: "18", stock: 30 }, { name: "Kaya toast box", price: "9.50", stock: 12 }],
  windows: [{ date: day(9), start: "09:00", end: "10:00" }, { date: day(9), start: "11:00", end: "12:00", cap: 1 }], area: "Greenpoint", address: "12 Kent St, Apt 3", allergens: "Contains egg and coconut", pay: "pickup", ...over });

const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "droporder-secret-0123", ENCORE_FAKE_EMAIL: "1", ENCORE_SIGNUP_PER_HOUR: "100", ENCORE_DIRECTORY_CACHE_MS: "0" };
before(async () => { Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer();
  const a = await join("Madison Lee", "madison.drop@example.com", "madison-drop"); host = a.cookie; ws = a.ws; other = await join("Cy Park", "cy.drop@example.com", "cy-drop"); });
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

test("the pickup words: one helper for every view, never Date TBD when a window has a date", () => {
  assert.equal(P.line({ drop: true, windows: [{ date: "2026-12-06", start: "09:00", end: "10:00" }] }), "Pickup Sun, Dec 6 · 9 to 10am");
  assert.equal(P.line({ drop: true, windows: [{ date: "2026-12-05", start: "09:00", end: "10:00" }, { date: "2026-12-06", start: "11:00", end: "13:00" }] }), "Pickup Sat, Dec 5 or Sun, Dec 6");
  assert.equal(P.line({ drop: true, always: true, slots: ["Sat 9 to 10am", "Sun 9 to 10am"] }), "Pickup Sat or Sun", "a drop saved before windows (the old free-text slots)");
  assert.equal(P.line({ drop: true, date: "2026-12-06", slots: ["9 to 10am"] }), "Pickup Sun, Dec 6 · 9 to 10am", "the old one-day drop: its date and its slot");
  assert.equal(P.label({ day: "Sun", start: "09:00", end: "22:00" }), "Sundays · 9am to 10pm");
  for (const e of [{ drop: true, windows: [{ date: "2026-12-06", start: "09:00" }] }, { drop: true, always: true, slots: ["Sun 9am to 10pm"] }]) assert.doesNotMatch(P.line(e), /TBD|to be picked|No date/i);
  // the root cause: the drop kept its date in the pickup windows while every view read the event's date. Now the event carries the first window's
  const d = cleanDrop(DROP()).drop, ev = dropEvent(d, { name: "Madison Lee" });
  assert.equal(ev.date, day(9)); assert.equal(ev.startTime, "09:00"); assert.equal(ev.endTime, "10:00"); assert.equal(ev.planKind, "drop");
  assert.equal(publicDrop("x", ev, {}).pickup, P.line(ev)); assert.equal(publicDrop("x", ev, { "Pandan honeycomb cake": 18 }).left, "24 of 42 left");
  assert.match(cleanDrop(DROP({ windows: [{ date: "", start: "09:00" }] })).error, /Pick a day/);
  assert.equal(cleanDrop(DROP({ windows: [] })).error, "Add at least one pickup time.");
});

test("the guest page: an order form, never the event reply form (and every link to a drop opens it)", () => {
  const dp = read("public/droppage.js"), inv = read("public/invite.html"), idx = read("index.html");
  for (const t of ["What's for sale", "Pick up", "Your details", "Place order", "So ${esc(first)} can tell you it's ready.", "A note for", "Order placed", "We'll send the exact spot the day before.", "Add to calendar", "Allergens:", 'type="radio" name="slot"', "data-d=\"1\"", "Open for orders"]) assert.ok(dp.includes(t), t);
  for (const t of ["Who's coming", "Coming solo", "Ask me about", "fun fact", "I'll bring", "Send my reply", "Show my name", "Are you in", "I'm in", "plus-one", "Anything you don't eat", "Save my details"]) assert.ok(!dp.includes(t), "no " + t);
  assert.ok(!/—/.test(dp), "no em dashes");
  // branching early: the light invite hands a drop to the order page before any of its own reply form
  assert.match(inv, /if \(e\?\.drop\) return more\("\/pickup\.js", \(\) => more\("\/droppage\.js"/);
  assert.ok(inv.indexOf('more("/droppage.js"') < inv.indexOf("<form id=\"f\""), "the order page is chosen before the reply form is built");
  assert.ok(inv.length < 40000, "invite.html stays under 40,000 characters: " + inv.length);
  // the full invite (/g#rsvp-, the app's #rsvp-) sends a drop to its order page instead of rendering the reply form
  assert.match(idx, /if\(ev\.drop&&kind==="rsvp"\)\{ \/\* a drop is an order page/);
  assert.match(idx.slice(idx.lastIndexOf("<script")), /comewith\.js/, "the Come with me loader is the last script");
  // the add-to-calendar menu is the shared one (public/addcal.js)
  assert.match(dp, /window\.PLAddCal\?\.open\(cal, it\)/);
});

test("order, confirmation, a full window, the exact spot the day before, Plans and the host's Orders", async () => {
  const r = await post("/api/host/drops", DROP(), { cookie: host }); assert.equal(r.status, 200, await r.clone().text()); const { id } = await r.json();
  const pub = JSON.parse((await getJ("/api/public/drop/" + id)).text).drop;
  assert.equal(pub.pickup, `Pickup ${P.day(day(9))} · 9 to 10am or 11am to 12pm`); assert.equal(pub.windows.length, 2); assert.equal(pub.ws, ws); assert.equal(pub.allergens, "Contains egg and coconut");
  assert.ok(!JSON.stringify(pub).includes("12 Kent"), "never the exact spot");
  const late = pub.windows[1].label;
  const o = await order(ws, id, { slot: late, orderQty: [{ i: 0, qty: 2 }, { i: 1, qty: 1 }], orderNote: "Slice one please" }); assert.equal(o.status, 200, await o.clone().text());
  const rid = String((await o.json()).id || "").split("/").pop();
  // the window held one order: it's full now, and says so
  const full = await order(ws, id, { email: "b.drop@example.com", slot: late, orderQty: [{ i: 0, qty: 1 }] }); assert.equal(full.status, 409); assert.match((await full.json()).message, /is full\. Pick another pickup time\./);
  assert.equal(JSON.parse((await getJ("/api/public/drop/" + id)).text).drop.windows[1].full, true);
  const nowin = await order(ws, id, { email: "c.drop@example.com", slot: "", orderQty: [{ i: 0, qty: 1 }] }); assert.equal(nowin.status, 400, "two windows: the order has to pick one");
  // their own order, for the confirmation when they come back
  const back = JSON.parse((await getJ(`/api/public/reply/${id}?rid=${rid}&code=ABCDEF`)).text);
  assert.deepEqual(back.orderLines.map((l) => [l.name, l.qty]), [["Pandan honeycomb cake", 2], ["Kaya toast box", 1]]); assert.equal(back.slot, late); assert.equal(back.orderTotal, 45.5);
  // the exact spot: not yet (pickup is 9 days out), and the email says it comes the day before
  const a = JSON.parse((await getJ(`/api/public/address/${id}?rid=${rid}&code=ABCDEF`)).text); assert.equal(a.ok, false); assert.equal(a.later, true);
  await new Promise((res) => setTimeout(res, 300));
  const mail = fakeOutbox.filter((m) => String(m.to).includes("lan.drop@example.com")).pop(); assert.ok(mail, "an order email");
  assert.match(mail.text, new RegExp(`Pickup: ${P.day(day(9))} · 11am to 12pm in Greenpoint`)); assert.match(mail.text, /We'll send the exact spot the day before\./); assert.ok(!mail.text.includes("12 Kent"));
  assert.ok(addressOpen({ drop: true, windows: [{ date: day(1), start: "09:00" }] }, ""), "the day before: open"); assert.ok(!addressOpen({ drop: true, windows: [{ date: day(5), start: "09:00" }] }, ""));
  // Plans: a pickup on the window they picked, never "Going", and no exact spot yet
  const g = await join("Lan Pham", "lan.drop@example.com", "");
  const T = await (await post("/api/plans/timeline", {}, { cookie: g.cookie })).json(), it = (T.items || []).find((x) => x.eventId === id);
  assert.ok(it, "the order is in Plans: " + JSON.stringify(T).slice(0, 300)); assert.equal(it.kind, "pickup"); assert.equal(it.date, day(9)); assert.equal(it.time, "11:00");
  assert.match(it.status, /^Pickup 11am to 12pm · #ABCDEF$/); assert.ok(!JSON.stringify(it).includes("12 Kent"));
  // the host's Orders: by pickup window, with the note
  const L = JSON.parse((await getJ("/api/host/orders", { cookie: host })).text).orders.filter((x) => x.eventId === id);
  assert.equal(L.length, 1); assert.equal(L[0].slot, late); assert.equal(L[0].note, "Slice one please"); assert.equal(L[0].totalText, "$45.50");
  assert.equal((await post("/api/host/drop-orders/" + L[0].id, { status: "picked" }, { cookie: host })).status, 200);
  assert.equal(JSON.parse((await getJ("/api/host/orders", { cookie: host })).text).orders.find((x) => x.id === L[0].id).status, "picked");
  const ui = read("public/drop.js"); assert.match(ui, /Print pickup list/); assert.match(ui, /data-print=/);
  // the share preview says pickup, not an event date
  const html = (await getJ("/e/" + id)).text; assert.match(html, new RegExp(`og:description" content="Order ahead · Pickup ${P.day(day(9))}`));
});

test("photo first: a drop's cover and item photos, checked uploads, the feed card leads with them", async () => {
  // item photos: PNG, JPEG or WebP by their bytes, 10 MB, signed in
  assert.equal((await upload(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' onload='x'></svg>........"), "image/png")).status, 415, "a renamed SVG is refused");
  assert.equal((await upload(Buffer.concat([png(), Buffer.alloc(10 * 1048576)]), "image/png")).status, 413);
  assert.equal((await fetch(srv.base + "/api/photos?for=item", { method: "POST", headers: { "Content-Type": "image/png" }, body: png() })).status, 401, "signed out");
  const H2 = await join("Ana Ube", "ana.ube@example.com", "ana-ube"); // a host of her own, so her drop leads her feed card
  const U = []; for (let i = 0; i < 6; i++) { const j = await (await upload(png(64 + i), "image/png", H2.cookie)).json(); assert.match(j.url, /^\/_blob\/[A-Za-z0-9]{20}$/); U.push(j.url); }
  const theirs = (await (await upload(png(80), "image/png", other.cookie)).json()).url;
  const r = await post("/api/host/drops", DROP({ title: "Ube rolls on Sunday", coverPhoto: U[0], items: [{ name: "Pandan honeycomb cake", price: "18", stock: 30, photos: [U[1], U[2], U[3], U[4], U[5]] }, { name: "Kaya toast box", price: "9.50", photos: [theirs] }] }), { cookie: H2.cookie });
  assert.equal(r.status, 200, await r.clone().text()); const { id } = await r.json();
  const ev = scopeStore(srv.store, H2.ws).get("events/" + id).data;
  assert.equal(ev.coverPhoto, U[0], "a drop keeps its cover"); assert.deepEqual(ev.orderItems[0].photos, [U[1], U[2], U[3], U[4]], "up to 4 photos an item"); assert.equal(ev.orderItems[0].photo, U[1], "the first is the main one");
  assert.deepEqual(ev.orderItems[1].photos, [], "someone else's upload is dropped");
  const pub = JSON.parse((await getJ("/api/public/drop/" + id)).text).drop; assert.equal(pub.cover, U[0]); assert.equal(pub.items[0].photos.length, 4);
  // someone else's cover is dropped too
  const r2 = await post("/api/host/drops/" + id, { coverPhoto: theirs }, { cookie: H2.cookie }); assert.equal(r2.status, 200); assert.equal(scopeStore(srv.store, H2.ws).get("events/" + id).data.coverPhoto, U[0]);
  // the share image is the cover
  assert.ok((await getJ("/e/" + id)).text.includes(`og:image" content="${srv.base}${U[0]}"`));
  // the feed card: the cover, "Order ahead", the pickup and what's left
  const F = JSON.parse((await getJ("/api/public/feed", { cookie: other.cookie })).text), card = JSON.stringify(F).includes(id) ? (F.blend?.items || F.blend || []).flat?.().find?.((x) => x?.id === id) : null;
  const all = []; const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") { if (x.id === id && x.kind === "event") all.push(x); Object.values(x).forEach(walk); } }; walk(F);
  const c = card || all[0]; assert.ok(c, "the drop is on the feed"); assert.equal(c.cover, U[0]); assert.equal(c.pickup, P.line(ev)); assert.equal(c.left, "30 of 30 left"); assert.equal(c.cta.label, "Order"); assert.equal(c.free, false);
  const fv = read("public/feedvisual.js"); assert.match(fv, /e\.drop && e\.pickup \? meta\(\[e\.pickup, e\.left, price\]\)/); // the tag says Pickup and the button says Order, so the facts line is the pickup and what's left
  // the setup starts with photos, takes the camera, reorders, and opens the shared cover sheet
  const ui = read("public/drop.js") + read("public/dropsetup.js");
  for (const t of ["Show what you're making", "Add photos of what you're making", 'capture="environment"', 'accept="image/*"', "draggable=\"true\"", "PS.open({ for: \"cover\"", "/api/photos?for=item", "Add another time", "Allergens", "Orders close", "drops with photos get more orders"]) assert.ok(ui.includes(t), t);
});

test("in a browser at 390px: a drop made through the setup's API opens as the order page, with no reply form fields", async (t) => {
  const req = createRequire(import.meta.url); let pw; try { pw = req("playwright"); } catch { try { pw = req(path.join(process.execPath, "../../lib/node_modules/playwright")); } catch { return t.skip("no playwright"); } }
  let br; try { br = await pw.chromium.launch(); } catch { return t.skip("no browser"); }
  const { id } = await (await post("/api/host/drops", DROP({ title: "Browser drop" }), { cookie: host })).json();
  try {
    for (const [who, cookie] of [["guest", ""], ["host", host]]) {
      const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      if (cookie) { const [k, ...v] = cookie.split("="); await ctx.addCookies([{ name: k, value: v.join("="), url: srv.base }]); }
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (x) => x.fulfill({ status: 200, body: "" }));
      for (const url of ["/e/" + id, "/g#rsvp-" + id]) {
        const p = await ctx.newPage(); await p.goto(srv.base + url, { waitUntil: "domcontentloaded" }); await p.waitForSelector("#dgF", { timeout: 45000 }).catch(async (e) => { throw new Error(`${who} ${url} -> ${p.url()}: ${(await p.evaluate(() => document.body.innerText).catch(() => "")).slice(0, 300)}`); });
        const txt = await p.evaluate(() => document.body.innerText);
        for (const s of ["What's for sale", "Pandan honeycomb cake", "$18", "Kaya toast box", "Pick up", "Your details", "Order ahead"]) assert.ok(txt.toLowerCase().includes(s.toLowerCase()), `${who} ${url}: ${s}`);
        for (const s of ["Who's coming", "Coming solo", "Ask me about", "fun fact", "I'll bring", "Send my reply", "Show my name", "Date TBD", "I'm in"]) assert.ok(!txt.includes(s), `${who} ${url}: no ${s}`);
        assert.equal(await p.locator('input[name="slot"]').count(), 2); assert.equal(await p.locator(".dg-st").count(), 2);
        if (who === "guest") { await p.click('.dg-it[data-i="0"] [data-d="1"]'); assert.match(await p.locator("#dgTotal").innerText(), /\$18/); assert.equal(await p.locator("#oGo").innerText(), "Place order"); }
        else { assert.ok(await p.locator("#dgOwn").count(), "the host sees their own bar"); assert.ok(await p.locator("#oGo").isDisabled()); }
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, "no sideways scroll");
        await p.close(); }
      await ctx.close(); }
  } finally { await br.close(); }
});
