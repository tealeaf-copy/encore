// Review round 11, the server review: system-doc reads by prefix, the feed built once per index (and cached signed out),
// guest notes kept small and real, pre-orders and pairs booked whole and paid for in full, vouching only for proven
// emails, the event's own time zone for the morning-after jobs, shop stock held for a while then released, a chat
// "release" moving the waitlist, salted attendee keys, and the directory's 400s.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { openStore } from "../server/db.js";
import { scopeStore, allWorkspaceIds, membersOf } from "../server/workspaces.js";
import { seatsOf, partyUnit, partyRound, dueCents } from "../server/social.js";
import { eventTz, zonedMs, hourIn } from "../server/tz.js";
import { dropWindow } from "../server/photodrop.js";
import { askWindow } from "../server/kudosask.js";
import { fakeOutbox } from "../server/email.js";

let srv, host, ws;
const J = { "Content-Type": "application/json" };
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const post = (path, body, h = {}) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...h }, body: JSON.stringify(body) });
const getJ = async (path, h = {}) => { const r = await fetch(srv.base + path, { headers: h }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
const put = (id, d, extra = {}) => fetch(srv.base + "/api/db/doc?path=events/" + id, { method: "PUT", headers: { ...J, cookie: host, ...extra }, body: JSON.stringify(d) });
const guestHdr = (key) => ({ "x-encore-guest": "1", "x-encore-key": key, "x-encore-workspace": ws });
const reply = (body, key = "rs-key-" + Math.random().toString(36).slice(2)) => post("/api/db/collection?path=rsvps", { response: "going", createdAt: Date.now(), ...body }, guestHdr(key));
const S = () => scopeStore(srv.store, ws);
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "r11s-secret", ENCORE_FAKE_EMAIL: "1", ENCORE_SIGNUP_PER_HOUR: "100", ENCORE_DIRECTORY_CACHE_MS: "0", ENCORE_PUBLIC_URL: "https://pl.example" };
const base = { kind: "social", casual: true, city: "Brooklyn", hood: "Park Slope", published: true, startTime: "19:00" };

before(async () => {
  Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer();
  const r = await post("/api/signup", { name: "Mo Reyes", email: "mo.r11s@example.com", password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200);
  host = r.headers.get("set-cookie").split(";")[0];
  assert.ok((await post("/api/host/profile", { name: "Mo Reyes", city: "Brooklyn", hood: "Park Slope", handle: "mo-r11s", emoji: "🍜", tagline: "Suppers for the block.", bio: "I cook for twelve." }, { cookie: host })).ok);
  ws = srv.store.get("system/handle-mo-r11s").data.ws;
});
after(async () => { for (const k of [...Object.keys(ENV), "ENCORE_FEED_PER_IP_HOUR", "ENCORE_ORDER_ITEMS_PER_IP_HOUR", "ENCORE_NOTE_PER_HOUR"]) delete process.env[k]; await srv.close(); });

test("1. system docs are read by id prefix: workspaces, members and the rest never load every inbox", () => {
  const st = openStore(":memory:");
  st.set("system/ws-aaa", { kind: "workspace", id: "aaa" }); st.set("system/ws-bbb", { kind: "workspace", id: "bbb" });
  st.set("system/inbox-x", { kind: "workspace", id: "not-me" }); st.set("system/wsx-1", { kind: "workspace", id: "nope" }); st.set("system/ws-aaa/notes/n1", { kind: "workspace", id: "child" });
  assert.deepEqual(st.listPrefix("system", "ws-").map((d) => d.id), ["ws-aaa", "ws-bbb"], "only system/ws-*, not other ids or child collections");
  assert.deepEqual(st.listPrefix("system", "").length, st.list("system").length, "an empty prefix is the whole collection");
  st.close();
  // the real helpers, on the server's store
  assert.ok(allWorkspaceIds().includes(ws)); assert.deepEqual(membersOf(ws).map((u) => u.email), ["mo.r11s@example.com"]);
  for (const f of ["server/workspaces.js", "server/social.js", "server/hooks.js", "server/help.js", "server/community.js", "server/collabs.js", "server/hosts.js"]) assert.doesNotMatch(read(f).replace(/^.*deleteWorkspace[\s\S]*?\n}\n/m, ""), /\.list\("system"\)/, f);
});

test("2. the feed: photos, kudos and who came per event (built once), cached signed out until something changes, rate limited", async () => {
  assert.ok((await put("rsFeedPast", { ...base, name: "Last week's supper", date: day(-3), discoverable: true })).ok);
  assert.ok((await put("rsFeedSoon", { ...base, name: "Next supper", date: day(6), discoverable: true, headcount: 12 })).ok);
  for (const [id, em] of [["rf1", "ann.r11s@example.com"], ["rf2", "ben.r11s@example.com"]]) S().set("rsvps/" + id, { eventId: "rsFeedPast", name: em.split(".")[0], email: em, response: "going", createdAt: Date.now() - 5 * 864e5 });
  S().set("moments/rsM1", { eventId: "rsFeedPast", authorEmail: "ann.r11s@example.com", authorName: "Ann", url: "/_blob/AAAAAAAAAAAAAAAAAAA1", type: "image", at: Date.now() - 2 * 864e5 });
  srv.app.locals.social.bust();
  const V = srv.app.locals.feedVisual, real = V.sections; let built = 0; V.sections = (...a) => { built++; return real(...a); };
  try {
    let f = (await getJ("/api/public/feed")).j, c = f.past.find((x) => x.id === "rsFeedPast");
    assert.ok(c, "the past card"); assert.equal(c.came, 2); assert.equal(c.photos.length, 1); assert.ok(f.upcoming.some((x) => x.id === "rsFeedSoon"));
    await getJ("/api/public/feed"); await getJ("/api/public/feed?device=dev-abcdefgh"); assert.equal(built, 1, "signed out: built once, then served from the cache");
    // a new photo is a write the feed shows: the cache lets go
    S().set("moments/rsM2", { eventId: "rsFeedPast", authorEmail: "ben.r11s@example.com", authorName: "Ben", url: "/_blob/AAAAAAAAAAAAAAAAAAA2", type: "image", at: Date.now() - 864e5 }); srv.app.locals.social.bust();
    f = (await getJ("/api/public/feed")).j; assert.equal(f.past.find((x) => x.id === "rsFeedPast").photos.length, 2); assert.equal(built, 2);
    const d1 = (await getJ("/api/public/deck?city=Brooklyn")).j, d2 = (await getJ("/api/public/deck?city=Brooklyn")).j; assert.deepEqual(d1, d2); assert.ok(d1.cards.some((x) => x.ref === "rsFeedSoon"));
  } finally { V.sections = real; }
  assert.match(read("server/feedvisual.js"), /const pastK = pastX\.map[\s\S]*\.slice\(0, 12\)\.map\(\(k\) => card\(/, "only 12 past cards are built");
  process.env.ENCORE_FEED_PER_IP_HOUR = "60"; let last = 200; for (let i = 0; i < 70 && last !== 429; i++) last = (await fetch(srv.base + "/api/public/feed?city=x")).status;
  assert.equal(last, 429, "the public feed is rate limited per IP"); delete process.env.ENCORE_FEED_PER_IP_HOUR;
});

test("3. guest feedback and invite requests: a real event, known fields only, 4 KB, a few an hour", async () => {
  assert.ok((await put("rsFb", { ...base, name: "Survey supper", date: day(-1) })).ok);
  const fb = (b, key = "fb-key-1") => post("/api/db/collection?path=feedback", b, guestHdr(key));
  assert.equal((await fb({ eventId: "nope-not-here", rating: 5 })).status, 404, "unknown event");
  assert.equal((await fb({ rating: 5 })).status, 404, "no event at all");
  assert.equal((await fb({ eventId: "rsFb", comment: "x".repeat(5000) })).status, 413, "over 4 KB");
  const r = await fb({ eventId: "rsFb", rating: 9, comment: "<b>Lovely</b> night", wouldReturn: true, highlights: ["food", { x: 1 }], evil: "y", _k: "z", source: "organizer", createdAt: 1 }); assert.equal(r.status, 200);
  const doc = S().get("feedback/" + (await r.json()).id).data;
  assert.deepEqual(Object.keys(doc).sort(), ["comment", "createdAt", "eventId", "highlights", "rating", "source", "wouldReturn"]); assert.equal(doc.source, "guest"); assert.ok(doc.createdAt > 1);
  assert.match(doc.comment, /Lovely/); assert.doesNotMatch(doc.comment, /<b>/, "tags stripped"); assert.deepEqual(doc.highlights, ["food"]);
  const iq = await post("/api/db/collection?path=interest", { item: "Spring supper series", name: "Lee", email: "lee@example.com", junk: "x".repeat(200) }, { ...guestHdr("fb-key-2"), "x-encore-workspace": ws }); assert.equal(iq.status, 200);
  assert.equal(S().get("interest/" + (await iq.json()).id).data.junk, undefined);
  assert.equal((await post("/api/db/collection?path=interest", { name: "No item" }, guestHdr("fb-key-2"))).status, 400);
  process.env.ENCORE_NOTE_PER_HOUR = "3"; let st = 200; for (let i = 0; i < 5; i++) st = (await fb({ eventId: "rsFb", rating: 4 })).status;
  assert.equal(st, 429, "one address, one event: a few an hour"); delete process.env.ENCORE_NOTE_PER_HOUR;
});

test("4. a pre-order with a menu needs an order, never waits in line, and never moves up from one", async () => {
  assert.ok((await put("rsPre", { ...base, name: "Bun pre-order", date: day(8), discoverable: true, preorder: true, headcount: 3, orderItems: [{ name: "Pork bun", price: 4 }] })).ok);
  let r = await reply({ eventId: "rsPre", name: "P0", email: "p0.r11s@example.com" }); assert.equal(r.status, 400); let j = await r.json(); assert.equal(j.message, "Pick something first."); assert.equal(j.code, "invalid_order");
  r = await reply({ eventId: "rsPre", name: "P1", email: "p1.r11s@example.com", orderQty: [{ i: 0, qty: 3 }] }); assert.equal(r.status, 200);
  r = await reply({ eventId: "rsPre", name: "P2", email: "p2.r11s@example.com", orderQty: [{ i: 0, qty: 1 }] }); assert.equal(r.status, 409); j = await r.json(); assert.equal(j.message, "Sold out."); assert.equal(j.left, 0);
  assert.ok(!S().list("rsvps").some((d) => d.data.eventId === "rsPre" && d.data.response === "waitlist"), "never waitlisted");
  // an old waitlisted order (from before this rule) stays put when the host adds room
  S().set("rsvps/rsPreW", { eventId: "rsPre", name: "Old", email: "old.r11s@example.com", response: "waitlist", waitAt: Date.now() - 1000, order: "2 × Pork bun", orderLines: [{ name: "Pork bun", qty: 2, price: 4 }] });
  const ev = S().get("events/rsPre").data; assert.ok((await put("rsPre", { ...ev, headcount: 10 })).ok);
  assert.equal(S().get("rsvps/rsPreW").data.response, "waitlist");
});

test("5 and 6. pairs book whole (1 becomes 2, partyCut), pay what the party owes, and spots_left counts pairs", async () => {
  const pairs = { groupSize: 2, groupPrice: 40, price: "$40" };
  assert.equal(partyUnit(pairs), 2); assert.equal(partyUnit({ ...pairs, priceUnit: "each" }), 1, "$20 each or $70 for 4 still sells singles");
  assert.equal(seatsOf({ response: "going", party: 1 }, pairs), 2); assert.equal(seatsOf({ party: 1 }, pairs), 1, "a host's own guest row counts as typed");
  assert.equal(partyRound(3, { groupSize: 4 }), 4); assert.equal(partyRound(5, { groupSize: 2, plusOnes: 5 }), 6); assert.equal(partyRound(9, { groupSize: 2, plusOnes: 5 }), 6, "down to the most whole pairs a reply holds");
  assert.equal(dueCents({ price: "$45", plusOnes: 2 }, { response: "going", party: 3 }), 13500, "per person × spots");
  assert.equal(dueCents(pairs, { response: "going", party: 1 }), 4000, "one pair");
  assert.equal(dueCents({ price: "$20", priceUnit: "each", groupSize: 4, groupPrice: 70, plusOnes: 5 }, { response: "going", party: 5 }), 9000, "a group of 4 and one single");
  assert.equal(dueCents({ price: "$20", priceUnit: "each", groupSize: 4, groupPrice: 70 }, { response: "going", party: 3 }), 6000);
  assert.ok((await put("rsPairs", { ...base, name: "Pasta for two", date: day(9), discoverable: true, headcount: 12, headUnit: "pairs", ticketNote: "Cash at the door", ...pairs })).ok);
  const e0 = fakeOutbox.length;
  const r = await reply({ eventId: "rsPairs", name: "Kai Lee", email: "kai.r11s@example.com", party: 1 }); assert.equal(r.status, 200); const j = await r.json();
  assert.equal(j.party, 2); assert.equal(j.partyCut, true, "told the party changed");
  const m = fakeOutbox.slice(e0).find((x) => x.to.includes("kai.r11s@example.com")); assert.ok(m); assert.match(m.text, /Pay \$40 at the door\./);
  assert.ok((await put("rsTrio", { ...base, name: "Dumplings", date: day(9), headcount: 10, plusOnes: 2, price: "$15", ticketNote: "Venmo at the door" })).ok);
  const e1 = fakeOutbox.length; assert.equal((await reply({ eventId: "rsTrio", name: "Ivy", email: "ivy.r11s@example.com", party: 3 })).status, 200);
  assert.match(fakeOutbox.slice(e1).find((x) => x.to.includes("ivy.r11s@example.com")).text, /Pay \$45 at the door\./, "$15 × 3");
  const ev = (await getJ("/api/v1/events?host=mo-r11s&limit=100")).j.data.find((e) => e.id === "rsPairs");
  assert.equal(ev.spot_unit, "group"); assert.equal(ev.group_size, 2); assert.equal(ev.spots_left, 5, "12 people is 6 pairs, one booked");
  assert.match(read("public/invite.html"), /: dueOf\(e, data\.party\)[\s\S]*payLinkOf\(pay, amtP/); assert.ok(read("public/invite.html").length < 40000);
});

test("7. vouching needs a proven email, and a link sent before the email changed proves nothing", async () => {
  assert.ok((await put("rsVouch", { ...base, name: "Vouch supper", date: day(4) })).ok);
  const e0 = fakeOutbox.length, r = await reply({ eventId: "rsVouch", name: "Zoe", email: "zoe.r11s@example.com" }, "rs-key-zoe"), rid = (await r.json()).id;
  const lk = fakeOutbox.slice(e0).map((m) => m.text.match(/#reply=([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)/)).find(Boolean); assert.ok(lk); assert.equal(lk[1], rid);
  assert.equal(S().get("rsvps/" + rid).data.emailProvenAt, undefined, "a reply alone proves nothing");
  // she changes the email on her reply, then opens the old link: the new address isn't proven by it
  assert.equal((await fetch(srv.base + "/api/db/doc?path=rsvps/" + rid, { method: "PATCH", headers: { ...J, ...guestHdr("rs-key-zoe") }, body: JSON.stringify({ email: "zoe2.r11s@example.com" }) })).status, 200);
  assert.equal((await post("/api/public/reply/claim", { eventId: "rsVouch", rid, t: lk[2] }, { "x-encore-key": "rs-key-zoe" })).status, 200);
  assert.equal(S().get("rsvps/" + rid).data.emailProvenAt, undefined);
  S().update("rsvps/" + rid, { email: "zoe.r11s@example.com", emailChangedAt: 0 });
  assert.equal((await post("/api/public/reply/claim", { eventId: "rsVouch", rid, t: lk[2] }, { "x-encore-key": "rs-key-zoe" })).status, 200);
  assert.equal(S().get("rsvps/" + rid).data.emailProven, "zoe.r11s@example.com");
  assert.match(read("server/app.js"), /const proven = \(r\) => !!r\?\.emailProvenAt/);
});

test("8. the morning-after jobs and the day-before reminder run on the event's time zone", async () => {
  assert.equal(eventTz({ city: "Brooklyn" }), "America/New_York"); assert.equal(eventTz({ tz: "Europe/London", city: "Brooklyn" }), "Europe/London");
  assert.equal(eventTz({ city: "Nowhere" }, "Australia/Sydney"), "Australia/Sydney", "else the host's"); assert.equal(eventTz({ tz: "Mars/Base", city: "Nowhere" }), process.env.ENCORE_TZ || "");
  assert.equal(zonedMs("2026-12-12", "19:00", "America/New_York"), Date.UTC(2026, 11, 13, 0, 0)); assert.equal(zonedMs("2026-07-01", "09:30", "Europe/London"), Date.UTC(2026, 6, 1, 8, 30));
  assert.equal(hourIn("Australia/Sydney", Date.UTC(2026, 11, 12, 22, 0)), 9);
  // 10pm UTC on the 12th is 9am on the 13th in Sydney: the morning after a Sydney supper, not yet anywhere in the US
  const at = Date.UTC(2026, 11, 12, 22, 0), syd = { date: "2026-12-12", city: "Sydney" }, ny = { date: "2026-12-12", city: "Brooklyn" };
  assert.equal(dropWindow(syd, at), true); assert.equal(askWindow(syd, at), true);
  assert.equal(dropWindow(ny, at), false); assert.equal(askWindow(ny, at), false);
  assert.match(read("server/social.js"), /zonedMs\(e\.date, [\s\S]{0,90}, zt\), hrs = \(startAt - now\) \/ 3600e3, hr = zt \? hourIn\(zt, now\)/, "the day-before reminder's start time is where the event is");
  // a tz field on an event is kept only when it's real; a new event can take the browser's from x-encore-tz
  assert.ok((await put("rsTz1", { ...base, name: "tz 1", date: day(3), tz: "Mars/Base" })).ok); assert.equal(S().get("events/rsTz1").data.tz, undefined);
  assert.ok((await put("rsTz2", { ...base, name: "tz 2", date: day(3) }, { "x-encore-tz": "America/Chicago" })).ok); assert.equal(S().get("events/rsTz2").data.tz, "America/Chicago");
  assert.ok((await put("rsTz2", { ...base, name: "tz 2 again", date: day(3) })).ok); assert.equal(S().get("events/rsTz2").data.tz, "America/Chicago", "kept on a save without it");
});

test("9. the shop: unpaid orders hold stock for a while, one open order a person, items capped per address, Sold out.", async () => {
  const r = await (await post("/api/host/profile", { shop: { open: true, title: "Buns", slots: ["Sat 10–12"], payUrl: "https://venmo.com/mo-r11s", items: [{ name: "Pork bun", cents: 400, stock: 2, max: 6 }] } }, { cookie: host })).json();
  const id = r.host.shop.items[0].id, order = (name, email, qty = 1, extra = {}) => post("/api/public/order/mo-r11s", { name, email, slot: "Sat 10–12", items: [{ id, qty }], ...extra });
  assert.equal((await order("Amy", "amy.r11s@example.com", 2)).status, 200);
  const so = await order("Bea", "bea.r11s@example.com"); assert.equal(so.status, 409); assert.equal((await so.json()).message, "Sold out. No Pork bun left.");
  // a day later, nobody paid: the buns go back on sale, and the host's list says so
  const O = scopeStore(srv.store, ws).list("orders").find((d) => d.data.email === "amy.r11s@example.com"); scopeStore(srv.store, ws).update("orders/" + O.id, { at: Date.now() - 25 * 3600e3 });
  assert.equal((await getJ("/api/public/shop/mo-r11s")).j.shop.items[0].left, 2);
  assert.equal((await order("Bea", "bea.r11s@example.com")).status, 200);
  assert.equal((await getJ("/api/host/orders", { cookie: host })).j.orders.find((o) => o.email === "amy.r11s@example.com").released, true);
  const dup = await order("Bea again", "bea.r11s@example.com"); assert.equal(dup.status, 409); assert.equal((await dup.json()).code, "order_exists");
  process.env.ENCORE_ORDER_ITEMS_PER_IP_HOUR = "3"; const cap = await order("Cy", "cy.r11s@example.com"); assert.equal(cap.status, 429); delete process.env.ENCORE_ORDER_ITEMS_PER_IP_HOUR;
});

test("10. giving a spot away in the chat moves the waitlist up and tells the host they'd said they paid; so does Can't go", async () => {
  assert.ok((await put("rsRel", { ...base, name: "Tiny supper", date: day(5), headcount: 1, price: "$30" })).ok);
  S().set("rsvps/rsRelA", { eventId: "rsRel", name: "Al Ng", email: "al.r11s@example.com", response: "going", code: "ALC", paidClaim: true, createdAt: Date.now() - 5000 });
  S().set("rsvps/rsRelB", { eventId: "rsRel", name: "Bo Wu", email: "bo.r11s@example.com", response: "waitlist", code: "BOC", waitAt: Date.now() - 4000, createdAt: Date.now() - 4000 });
  const r = await post("/api/public/chat/rsRel", { rid: "rsRelA", code: "ALC", kind: "release" }); assert.equal(r.status, 200); const j = await r.json(); assert.equal(j.released, true); assert.equal(j.promoted, true);
  assert.equal(S().get("rsvps/rsRelA").data.response, "no"); assert.equal(S().get("rsvps/rsRelB").data.response, "going");
  const inbox = (await getJ("/api/me/inbox", { cookie: host })).j.items; assert.ok(inbox.some((n) => /Al in Tiny supper: Can't go\..*They said they paid\./.test(n.text)), JSON.stringify(inbox.slice(0, 3)));
  // Can't go from a paid guest, from their own invite
  const pr = await reply({ eventId: "rsTrio", name: "Pat Paid", email: "pat.r11s@example.com" }, "rs-key-pat"), pid = (await pr.json()).id; S().update("rsvps/" + pid, { paid: true });
  assert.equal((await fetch(srv.base + "/api/db/doc?path=rsvps/" + pid, { method: "PATCH", headers: { ...J, ...guestHdr("rs-key-pat") }, body: JSON.stringify({ response: "no" }) })).status, 200);
  assert.ok((await getJ("/api/me/inbox", { cookie: host })).j.items.some((n) => /Pat can't go to Dumplings now\..*They had paid\./.test(n.text)));
});

test("11. attendee keys are salted per event: not sha256(email), different on each event, and still open the guest's card", async () => {
  for (const id of ["rsK1", "rsK2"]) { assert.ok((await put(id, { ...base, name: "Key supper " + id, date: day(7), discoverable: true })).ok); S().set(`rsvps/${id}-g`, { eventId: id, name: "Gia Moss", email: "gia.r11s@example.com", response: "going", createdAt: Date.now() }); }
  const k1 = (await getJ("/api/public/attendees/rsK1")).j.attendees.find((a) => a.name === "Gia M.").key, k2 = (await getJ("/api/public/attendees/rsK2")).j.attendees.find((a) => a.name === "Gia M.").key;
  assert.ok(k1 && k2); assert.notEqual(k1, k2, "not the same across events");
  assert.notEqual(k1, createHash("sha256").update("gia.r11s@example.com").digest("hex").slice(0, 24), "not the bare email hash");
  assert.equal((await getJ(`/api/public/person/rsK1/${k1}`)).status, 200); assert.equal((await getJ(`/api/public/person/rsK1/${k2}`)).status, 404, "another event's key doesn't open it");
});

test("12. the directory: bad or stale cursors and limits over 100 are 400s (documented), new event fields, and JSON-only MCP", async () => {
  let r = await getJ("/api/v1/events?cursor=not-a-cursor"); assert.equal(r.status, 400); assert.equal(r.j.code, "invalid_cursor");
  r = await getJ("/api/v1/events?cursor=" + Buffer.from("o:99999").toString("base64url")); assert.equal(r.status, 400); assert.equal(r.j.code, "invalid_cursor", "past the end: the list changed");
  r = await getJ("/api/v1/reviews?host=mo-r11s&cursor=zz"); assert.equal(r.status, 400);
  r = await getJ("/api/v1/events?limit=101"); assert.equal(r.status, 400); assert.match(r.j.message, /1 to 100/);
  assert.equal((await getJ("/api/v1/events?limit=100")).status, 200);
  const doc = (await getJ("/api/v1/openapi.json")).j; for (const p of ["/api/v1/events", "/api/v1/hosts", "/api/v1/reviews"]) assert.ok(doc.paths[p].get.responses[400], p);
  assert.ok(doc.components.schemas.Event.properties.spot_unit && doc.components.schemas.Event.properties.orders_open && doc.components.schemas.Event.properties.order_by_date && doc.components.schemas.Event.properties.group_size);
  const pre = (await getJ("/api/v1/events?host=mo-r11s&limit=100")).j.data.find((e) => e.id === "rsPre");
  assert.ok(pre, "the pre-order is listed"); assert.equal(pre.spot_unit, "item"); assert.equal(pre.orders_open, true); assert.equal(pre.order_by_date, null);
  const t = await fetch(srv.base + "/mcp/public", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
  assert.equal(t.status, 400); assert.equal((await t.json()).error.code, -32700);
  const m = await (await post("/mcp/public", { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search_events", arguments: { cursor: "zz" } } })).json(); assert.equal(m.error.code, -32602);
  const m2 = await (await post("/mcp/public", { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_events", arguments: { limit: 500 } } })).json(); assert.equal(m2.error.code, -32602);
});

test("lower priority: a photo drop email held back by the hourly cap (or failed) is tried again an hour later, once", async () => {
  const past = day(-1), next = new Date(Date.parse(past + "T12:00:00Z") + 864e5).toISOString().slice(0, 10), at = zonedMs(next, "10:00", "America/New_York");
  assert.ok((await put("rsDrop", { ...base, name: "Photo supper", date: past })).ok);
  S().set("rsvps/rsDropG", { eventId: "rsDrop", name: "Dee", email: "dee.r11s@example.com", response: "going", code: "DEE1", createdAt: Date.now() - 3 * 864e5 });
  for (const d of S().list("outbox")) S().delete("outbox/" + d.id);
  S().add("outbox", { kind: "confirm", to: ["x@example.com"], subject: "x", at, status: "sent" });
  process.env.ENCORE_EMAIL_PER_HOUR = "1";
  try {
    const PD = srv.app.locals.photoDrops, e0 = fakeOutbox.length, mine = () => fakeOutbox.slice(e0).filter((m) => m.to.includes("dee.r11s@example.com")).length;
    await PD.run({ now: at, origin: "https://pl.example", workspaces: [ws] });
    assert.equal(mine(), 0, "the cap holds it back"); assert.equal(S().get("photodrops/rsDrop--rsDropG").data.error, "rate_limited");
    await PD.run({ now: at + 10 * 60e3, origin: "https://pl.example", workspaces: [ws] }); assert.equal(mine(), 0, "not again within the hour");
    await PD.run({ now: at + 3600e3 + 1, origin: "https://pl.example", workspaces: [ws] }); assert.equal(mine(), 1, "sent on the next try");
    const rec = S().get("photodrops/rsDrop--rsDropG").data; assert.equal(rec.tries, 2); assert.equal(rec.error, undefined);
    await PD.run({ now: at + 2 * 3600e3 + 2, origin: "https://pl.example", workspaces: [ws] }); assert.equal(mine(), 1, "and never twice");
  } finally { delete process.env.ENCORE_EMAIL_PER_HOUR; }
});
