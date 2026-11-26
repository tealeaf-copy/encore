// Plans (server/plans.js, public/timeline.js, public/addcal.js): the timeline groups your own plans by day in the right
// time zone, each kind with its status, multi-day plans as one block, a Now marker, calendar dots, itineraries the host
// lays out (checked, stored, shown to guests who are in), add to calendar (.ics with a reminder, Google and Outlook
// links) and a private feed of your plans that you can reset. Never someone else's plans, never an address you can't see.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore, claimEvent } from "../server/workspaces.js";
import { localDay } from "../server/hooks.js";
import { kindOf, statusOf, itemOf, cleanItinerary, itineraryFor, itineraryDays, typeChip, slotStart, slotDay, bringLine, timeIn, withAlarm, multiDay, placeOf } from "../server/plans.js";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
function load(files, extra = {}) { const ctx = { window: {}, URLSearchParams, Intl, Date, Math, JSON, encodeURIComponent, location: { origin: "https://pl.test", pathname: "/plans" }, addEventListener() {}, document: { cookie: "" }, localStorage: { getItem: () => null }, ...extra };
  vm.createContext(ctx); for (const f of files) vm.runInContext(read(f), ctx); return ctx.window; }
const plain = (x) => JSON.parse(JSON.stringify(x)); // values from the page scripts, compared as plain data
const W = load(["public/timeline.js", "public/addcal.js"]), T = W.PLTimeline, AC = W.PLAddCal;

let srv, mina, ivy, zoe; const J = { "Content-Type": "application/json" };
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "plans-secret", ENCORE_FAKE_EMAIL: "1", ENCORE_SIGNUP_PER_HOUR: "100" };
const post = (p, b, h = {}) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...h }, body: JSON.stringify(b) });
const get = (p, h = {}) => fetch(srv.base + p, { headers: h });
async function join(name, email, handle) { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200); const c = r.headers.get("set-cookie").split(";")[0];
  await post("/api/host/profile", { name, handle, city: "Brooklyn", hood: "Greenpoint" }, { cookie: c }); return { cookie: c, ws: srv.store.get("system/handle-" + handle).data.ws, email }; }
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const ev = (w, id, e) => { claimEvent(id, w); scopeStore(srv.store, w).set("events/" + id, { id, published: true, discoverable: true, city: "Brooklyn", tz: "America/New_York", createdAt: Date.now(), ...e }); };
const rs = (w, rid, r) => scopeStore(srv.store, w).set("rsvps/" + rid, { code: "K" + rid, createdAt: Date.now(), ...r });
const ADDR = "88 Noble St, Apt 3";

before(async () => { Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer();
  mina = await join("Mina Cho", "mina.plans@example.com", "mina-plans"); ivy = await join("Ivy Lane", "ivy.plans@example.com", "ivy-plans"); zoe = await join("Zoe Ray", "zoe.plans@example.com", "zoe-plans");
  ev(mina.ws, "pPotluck", { name: "Friendsgiving potluck", date: day(2), startTime: "17:00", hood: "Greenpoint", venueName: "Mina's place", venueAddr: ADDR, slots: ["Pumpkin pie", "Ice"] });
  rs(mina.ws, "pr1", { eventId: "pPotluck", email: ivy.email, name: "Ivy", response: "going", slot: "Pumpkin pie" });
  rs(mina.ws, "pr2", { eventId: "pPotluck", email: zoe.email, name: "Zoe", response: "going" });
  ev(mina.ws, "pWine", { name: "Wine night", date: day(3), startTime: "18:30", hood: "Williamsburg", venueName: "Back room", venueAddr: ADDR, headcount: 4 });
  rs(mina.ws, "pw0", { eventId: "pWine", email: "first@example.com", response: "waitlist", waitAt: 1 }); rs(mina.ws, "pw1", { eventId: "pWine", email: ivy.email, response: "waitlist", waitAt: 2 });
  ev(mina.ws, "pCabin", { name: "Cabin weekend", date: day(8), endDate: day(10), startTime: "16:00", hood: "Phoenicia", venueName: "Esopus Cabins", venueAddr: "5 Creek Rd",
    itinerary: [{ day: day(8), time: "16:00", kind: "checkin", title: "Check in", sub: "Keys at 5 Creek Rd" }, { day: day(9), time: "19:00", kind: "meal", title: "Dinner" }] });
  rs(mina.ws, "pr3", { eventId: "pCabin", email: ivy.email, response: "going" });
  ev(ivy.ws, "pMine", { name: "Records and dumplings", date: day(4), startTime: "19:00", hood: "Greenpoint" });
  for (let i = 0; i < 3; i++) rs(ivy.ws, "pg" + i, { eventId: "pMine", email: `g${i}@x.com`, name: "G" + i, response: "going" });
  ev(zoe.ws, "pZoe", { name: "Zoe's secret dinner", date: day(5), startTime: "20:00", discoverable: false, published: false });
  ev(zoe.ws, "pClosed", { name: "Closed tasting", date: day(6), discoverable: false });
  srv.store.set("system/plsave-" + crypto.createHash("sha256").update(ivy.email).digest("hex").slice(0, 24), { items: [{ kind: "event", ref: "pClosed" }] });
});
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

test("days: an item's day is its own date where it happens (localDay in its time zone); Today and Tomorrow labels", () => {
  // 11:30pm in New York on Dec 5 is already Dec 6 in UTC: it stays on Dec 5
  const it = itemOf({ id: "x", ev: { date: "2026-12-05", startTime: "23:30", tz: "America/New_York" }, kind: "going", status: "Going" });
  assert.equal(it.date, "2026-12-05"); assert.equal(new Date(it.startMs).toISOString(), "2026-12-06T04:30:00.000Z");
  const la = itemOf({ id: "y", ev: { date: "2026-12-05", startTime: "21:00", tz: "America/Los_Angeles" }, kind: "going", status: "Going" }); assert.equal(la.date, "2026-12-05");
  // the page's localDay is the server's
  for (const [ms, tz] of [[Date.parse("2026-11-30T04:00:00Z"), "America/Los_Angeles"], [Date.parse("2026-11-30T04:00:00Z"), "Australia/Sydney"], [Date.parse("2026-06-01T23:59:00Z"), "Europe/London"]]) assert.equal(T.localDay(ms, tz), localDay(ms, tz));
  assert.deepEqual([T.dayLabel("2026-12-05", "2026-12-05").kicker, T.dayLabel("2026-12-06", "2026-12-05").kicker, T.dayLabel("2026-12-07", "2026-12-05").kicker], ["Today", "Tomorrow", ""]);
  assert.equal(T.dayLabel("2026-12-05", "").text, "Sat · Dec 5");
  const G = T.groupByDay([{ title: "B", date: "2026-12-06", startMs: 2 }, { title: "A", date: "2026-12-05", startMs: 5 }, { title: "C", date: "2026-12-05", startMs: 1 }, { title: "D", date: "2026-12-05", allDay: true, startMs: 0 }, { title: "no date" }], { today: "2026-12-05" });
  assert.deepEqual(plain(G).map((g) => [g.date, g.label.kicker, g.items.map((i) => i.title).join("")]), [["2026-12-05", "Today", "DCA"], ["2026-12-06", "Tomorrow", "B"]]);
});

test("kinds and statuses: going, hosting, pickup, class, waitlist and asks, saved, to-dos", () => {
  assert.equal(kindOf({}, { response: "going" }), "going"); assert.equal(kindOf({}, null, { hosting: true }), "hosting");
  assert.equal(kindOf({ drop: true }, { response: "going" }), "pickup"); assert.equal(kindOf({ series: true }, { response: "going" }), "class");
  assert.equal(kindOf({}, { response: "waitlist" }), "waitlist"); assert.equal(kindOf({}, { response: "requested" }), "waitlist"); assert.equal(kindOf({}, null, { saved: true }), "saved");
  assert.equal(statusOf("hosting", { published: true }, null, { going: 12 }), "Hosting · 12 in"); assert.equal(statusOf("hosting", { published: true }, null, { going: 3, asking: 2 }), "Hosting · 3 in · 2 asking");
  assert.equal(statusOf("hosting", {}, null), "Draft"); assert.equal(statusOf("hosting", { published: true, drop: true }, null, { orders: 1 }), "Pickup window · 1 order");
  assert.equal(statusOf("waitlist", {}, { response: "waitlist" }, { pos: 2 }), "Waitlist #2"); assert.equal(statusOf("waitlist", {}, { response: "requested" }, { hostFirst: "Mina" }), "Asked · waiting on Mina");
  assert.equal(statusOf("pickup", {}, { pickupLabel: "10-11", code: "abc123x" }), "Pickup 10am to 11am · #ABC123");
  assert.equal(statusOf("going", {}, { response: "going" }), "Going"); assert.equal(statusOf("class", {}, { response: "going" }, { episode: { n: 3, total: 6 } }), "Class 3 of 6");
  assert.equal(statusOf("going", { price: "$20" }, { response: "going", paidClaim: true }, { hostFirst: "Ada" }), "Going · Paid? Ada will confirm");
  assert.equal(statusOf("going", { price: "$20", ticketNote: "x" }, { response: "going" }), "Going · Pay $20 at the door");
  assert.equal(bringLine("Pumpkin pie"), "Bring pumpkin pie"); assert.equal(bringLine("A dessert"), "Bring a dessert"); assert.equal(bringLine("IPA"), "Bring IPA");
  assert.equal(slotStart("Sat 9 to 10am"), "09:00"); assert.equal(slotStart("2-3pm"), "14:00"); assert.equal(slotDay("Sat 9 to 10am", "2026-11-26"), "2026-11-28");
  assert.equal(typeChip({ name: "Cabin trip", date: "2026-12-04", endDate: "2026-12-06" }), "Weekend away"); assert.equal(typeChip({ kind: "summit", date: "2026-12-04" }), "Summit"); assert.equal(typeChip({ name: "Supper at Mina's" }), "Supper club"); assert.equal(typeChip({ typeLabel: "Retreat" }), "Retreat");
});

test("the timeline from the server: my own plans in order, with to-dos, hosting, waitlist place, a multi-day span and no addresses", async () => {
  const j = await (await post("/api/plans/timeline", { tz: "America/New_York" }, { cookie: ivy.cookie })).json();
  const rows = j.items.map((i) => [i.kind, i.title, i.status]);
  assert.deepEqual(rows, [["todo", "Bring pumpkin pie", "For Friendsgiving potluck"], ["going", "Friendsgiving potluck", "Going"], ["waitlist", "Wine night", "Waitlist #2"], ["todo", "Add the address", "3 people are in"], ["hosting", "Records and dumplings", "Hosting · 3 in"], ["going", "Cabin weekend", "Going"]]);
  const P = j.items.find((i) => i.eventId === "pPotluck" && i.kind === "going"); assert.equal(P.place, "Mina's place, Greenpoint", "a guest who is in sees the venue's name");
  const Wn = j.items.find((i) => i.kind === "waitlist"); assert.equal(Wn.place, "Williamsburg, Brooklyn", "on the waitlist: the area only"); assert.ok(!/Back room/.test(JSON.stringify(Wn)));
  const C = j.items.find((i) => i.eventId === "pCabin"); assert.equal(C.endDate, day(10)); assert.equal(C.itinerary.length, 2); assert.equal(C.href, "/plans/pCabin");
  assert.equal(j.today, localDay(Date.now(), "America/New_York"));
  assert.ok(!JSON.stringify(j).includes("88 Noble"), "no street address on the timeline");
});

test("privacy: only your own plans; a reply proof must match; someone else's events, replies and private saves never show", async () => {
  const z = await (await post("/api/plans/timeline", {}, { cookie: zoe.cookie })).json();
  assert.deepEqual(z.items.map((i) => i.eventId).sort(), ["pClosed", "pPotluck", "pZoe"].sort(), "Zoe sees her reply and her own events, nothing of Ivy's");
  const out = await (await post("/api/plans/timeline", { proofs: [{ id: "pPotluck", rid: "pr1", code: "wrong" }, { id: "pCabin", rid: "pr3", code: "Kpr3" }] })).json();
  assert.deepEqual(out.items.map((i) => i.eventId), ["pCabin"], "signed out: only the proof that matches"); assert.equal(out.signedIn, false);
  const iv = await (await post("/api/plans/timeline", { saved: ["pZoe"] }, { cookie: ivy.cookie })).json();
  assert.ok(!iv.items.some((i) => ["pZoe", "pClosed"].includes(i.eventId)), "a private event you saved or someone else's draft never shows");
  assert.ok(!iv.items.some((i) => i.title === "Zoe's secret dinner"));
});

test("multi-day spans and the Now marker", () => {
  const span = { title: "Cabin", date: "2026-12-04", endDate: "2026-12-06", startMs: 1, endMs: 9e15, itinerary: [{ day: "2026-12-05", title: "Dinner", time: "19:00" }] };
  // on its first day it sits there; while it's on, it sits on today
  assert.equal(T.groupByDay([span], { today: "2026-12-01" })[0].date, "2026-12-04"); assert.equal(T.groupByDay([span], { today: "2026-12-05" })[0].date, "2026-12-05");
  assert.deepEqual(plain(T.spanDays(span)).map((d) => [d.date, d.n, d.items.length]), [["2026-12-04", 1, 0], ["2026-12-05", 2, 1], ["2026-12-06", 3, 0]]);
  const html = T.timelineHtml([span], { today: "2026-12-01", now: 0 }); assert.match(html, /class="tl-span/); assert.match(html, /Dec 4 to 6 · 3 days/); assert.equal((html.match(/class="tl-nday/g) || []).length, 3);
  // the marker goes after what has started; past rows today are dimmed; a live row says Now itself
  const now = 1000, rows = [{ allDay: true, startMs: 0 }, { startMs: 100, endMs: 200 }, { startMs: 900, endMs: 1500 }, { startMs: 2000, endMs: 3000 }];
  assert.equal(T.nowIndex(rows, now), 3); assert.equal(T.nowIndex([], now), 0); assert.equal(T.isPast(rows[1], now), true); assert.equal(T.isLive(rows[2], now), true); assert.equal(T.isLive(rows[0], now), false);
  const day0 = [{ key: "a", kind: "going", title: "Early", date: "2026-12-01", time: "09:00", startMs: 100, endMs: 200 }, { key: "b", kind: "going", title: "Later", date: "2026-12-01", time: "19:00", startMs: 2000, endMs: 3000 }];
  const h = T.timelineHtml(day0, { today: "2026-12-01", now }); assert.ok(h.indexOf("tl-now") > h.indexOf("Early") && h.indexOf("tl-now") < h.indexOf("Later")); assert.match(h, /tl-row k-going is-past/);
  const live = T.timelineHtml([{ ...day0[1], startMs: 500, endMs: 3000 }], { today: "2026-12-01", now }); assert.doesNotMatch(live, /tl-now/); assert.match(live, /is-live/);
  assert.match(T.timelineHtml(day0, { today: "2026-11-30", now }), /Nothing else today/, "no plans today: the marker still says where you are");
});

test("calendar dots: one per kind a day has, spans on every day, to-dos ride on their event", () => {
  const D = plain(T.calendarDots([{ kind: "going", date: "2026-12-05" }, { kind: "hosting", date: "2026-12-05" }, { kind: "going", date: "2026-12-05" }, { kind: "todo", date: "2026-12-06" }, { kind: "class", date: "2026-11-30", endDate: "2026-12-02" }, { kind: "saved", date: "2027-01-02" }], "2026-12"));
  assert.deepEqual(D, { "2026-12-05": ["hosting", "going"], "2026-12-01": ["class"], "2026-12-02": ["class"] });
  const cells = T.monthCells("2026-12"); assert.equal(cells.length, 35); assert.equal(cells[0].date, "2026-11-29"); assert.equal(cells.filter((c) => c.inMonth).length, 31);
  const html = T.calendarHtml("2026-12", D, { today: "2026-12-01", selected: "2026-12-05" }); assert.match(html, /aria-label="Saturday, December 5: Hosting, Going"/); assert.match(html, /<i class="dot k-hosting"><\/i><i class="dot k-going"><\/i>/);
});

test("itineraries: checked against the event's dates, stored by the host only, shown to guests who are in or when public, addresses kept back", async () => {
  const E = { date: "2026-12-04", endDate: "2026-12-06", venueAddr: "5 Creek Rd", hood: "Phoenicia" };
  assert.deepEqual(cleanItinerary([{ day: 2, time: "7pm", title: "Dinner" }, { day: "2026-12-04", time: "16:00", title: "Check in" }, { title: "" }], E).items,
    [{ day: "2026-12-04", time: "16:00", kind: "checkin", title: "Check in", sub: "" }, { day: "2026-12-05", time: "19:00", kind: "meal", title: "Dinner", sub: "" }]);
  assert.equal(cleanItinerary([{ day: 4, title: "Brunch" }], E).error, "Brunch: pick a day from 1 to 3.");
  assert.equal(cleanItinerary([{ day: "2026-12-09", title: "Brunch" }], E).error, "Brunch: pick a day from Fri, Dec 4 to Sun, Dec 6.");
  assert.equal(cleanItinerary([{ time: "25pm", title: "Late" }], E).error, "Late: use a time like 4pm or 16:00.");
  assert.equal(cleanItinerary([{ sub: "no title" }], E).error, 'Item 1 needs a title, like "Check in".'); assert.equal(cleanItinerary("x", E).error, "The plan should be a list.");
  assert.equal(cleanItinerary(Array.from({ length: 41 }, () => ({ title: "x" })), E).error, "Keep it to 40 things or fewer."); assert.equal(timeIn("4:30 pm"), "16:30"); assert.equal(timeIn("13pm"), null);
  assert.equal(cleanItinerary([{ title: "<b>Hi</b> \u2014 there" }], E).items[0].title, "Hi, there", "no tags, no em dashes");
  const scrub = itineraryFor({ ...E, itinerary: [{ day: 1, title: "Meet at 5 Creek Rd", sub: "Apt at 12 Java St" }] }); assert.equal(scrub[0].title, "Meet at Phoenicia"); assert.equal(scrub[0].sub, "Apt at Phoenicia");
  assert.equal(itineraryFor({ ...E, itinerary: [{ day: 1, title: "Meet at 5 Creek Rd" }] }, { exact: true })[0].title, "Meet at 5 Creek Rd");
  assert.deepEqual(itineraryDays(E, []).map((d) => d.n), [1, 2, 3]); assert.equal(multiDay(E), true); assert.equal(placeOf({ venueName: "12 Java St", hood: "Greenpoint" }, { exact: true }), "Greenpoint");
  // the host saves it; anyone else can't
  const items = [{ day: 1, time: "4pm", kind: "checkin", title: "Check in", sub: "Keys at 5 Creek Rd" }, { day: 3, time: "10am", title: "Check out" }];
  assert.equal((await post("/api/host/events/pCabin/itinerary", { itinerary: items }, { cookie: ivy.cookie })).status, 404, "not your event");
  assert.equal((await post("/api/host/events/pCabin/itinerary", { itinerary: items })).status, 401);
  const bad = await post("/api/host/events/pCabin/itinerary", { itinerary: [{ day: 9, title: "Swim" }] }, { cookie: mina.cookie }); assert.equal(bad.status, 400); assert.match((await bad.json()).message, /pick a day from 1 to 3/);
  const ok = await (await post("/api/host/events/pCabin/itinerary", { itinerary: items, public: false }, { cookie: mina.cookie })).json(); assert.equal(ok.itinerary.length, 2); assert.equal(ok.itinerary[1].kind, "checkout");
  assert.equal(scopeStore(srv.store, mina.ws).get("events/pCabin").data.itinerary[0].time, "16:00");
  // who sees it
  const as = async (h, q = "") => (await (await get("/api/public/plan/pCabin" + q, h)).json()).plan;
  const anon = await as({}); assert.equal(anon.locked, true); assert.deepEqual(anon.days, []); assert.equal(anon.chip, "Weekend away"); assert.equal(anon.place, "Phoenicia, Brooklyn");
  const guest = await as({ cookie: ivy.cookie }); assert.equal(guest.locked, false); assert.equal(guest.days[0].items[0].sub, "Keys at 5 Creek Rd"); assert.equal(guest.status, "Going");
  const byProof = await as({}, "?rid=pr3&code=Kpr3"); assert.equal(byProof.locked, false);
  const host = await as({ cookie: mina.cookie }); assert.equal(host.isHost, true); assert.equal(host.editable, true); assert.match(host.status, /^Hosting · 1 in/);
  await post("/api/host/events/pCabin/itinerary", { itinerary: items, public: true }, { cookie: mina.cookie });
  const pub = await as({ cookie: zoe.cookie }); assert.equal(pub.locked, false); assert.equal(pub.days[0].items[0].sub, "Keys at Phoenicia, Brooklyn", "public: the address is kept back");
  assert.equal((await get("/api/public/plan/pZoe")).status, 404, "a draft has no plan page for others");
  // rendering: the same row style, a day per day
  const html = T.itineraryHtml(guest.days, { today: "" }); assert.match(html, /<span class="tl-dk">Day 1<\/span>/); assert.match(html, /tl-irow k-i-checkin/); assert.match(html, /Nothing planned yet/);
  assert.match(T.coverHtml(guest), /<span class="pc-chip">Weekend away<\/span>/); assert.match(T.coverHtml(guest), /aria-label="Back to your plans"/);
  assert.equal((await get("/plans/pCabin")).status, 200); assert.match(await (await get("/plans/pCabin")).text(), /plan\.html|Getting the plan/);
});

test("add to calendar: the .ics has the time in UTC, the place you may see, the link and a reminder 2 hours before; Google and Outlook links", async () => {
  const g = await (await get("/plans/ics/pPotluck.ics", { cookie: ivy.cookie })).text();
  const [y, m, d] = day(2).split("-"); assert.match(g, /BEGIN:VCALENDAR/); assert.match(g, /SUMMARY:Friendsgiving potluck/);
  assert.match(g, new RegExp(`DTSTART:${y}${m}${d}T2[12]0000Z`), "5pm in New York, in UTC"); assert.match(g, /TRIGGER:-PT120M/); assert.match(g, /BEGIN:VALARM[\s\S]*END:VALARM\r\nEND:VEVENT/);
  assert.match(g, /LOCATION:Mina's place\\, 88 Noble St\\, Apt 3/, "a guest who is in gets the address"); assert.match(g, /URL:http:\/\/127\.0\.0\.1:\d+\/e\/pPotluck/);
  const w = await (await get("/plans/ics/pWine.ics", { cookie: ivy.cookie })).text(); assert.match(w, /LOCATION:Williamsburg\\, Brooklyn/); assert.doesNotMatch(w, /Noble|Back room/, "the waitlist gets the area");
  assert.equal((await get("/plans/ics/pZoe.ics", { cookie: ivy.cookie })).status, 404, "a draft that isn't yours");
  const c = await (await get("/plans/ics/pCabin.ics?itinerary=1", { cookie: ivy.cookie })).text(); const [y2, m2, d2] = day(8).split("-"), [y3, m3, d3] = day(11).split("-");
  assert.match(c, new RegExp(`DTSTART;VALUE=DATE:${y2}${m2}${d2}`)); assert.match(c, new RegExp(`DTEND;VALUE=DATE:${y3}${m3}${d3}`), "a trip is one all-day span"); assert.equal((c.match(/BEGIN:VEVENT/g) || []).length, 3, "plus each part of the plan");
  assert.match(c, /SUMMARY:Check in · Cabin weekend/);
  assert.deepEqual(withAlarm(["BEGIN:VEVENT", "END:VEVENT"], 30), ["BEGIN:VEVENT", "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Reminder", "TRIGGER:-PT30M", "END:VALARM", "END:VEVENT"]);
  const it = { eventId: "e1", title: "Supper & songs", date: "2026-12-05", startMs: Date.parse("2026-12-06T00:00:00Z"), endMs: Date.parse("2026-12-06T03:00:00Z"), tz: "America/New_York", place: "Greenpoint" };
  const gu = new URL(AC.google(it, "https://pl.test")); assert.equal(gu.origin + gu.pathname, "https://calendar.google.com/calendar/render");
  assert.equal(gu.searchParams.get("dates"), "20261206T000000Z/20261206T030000Z"); assert.equal(gu.searchParams.get("text"), "Supper & songs"); assert.equal(gu.searchParams.get("ctz"), "America/New_York"); assert.equal(gu.searchParams.get("details"), "https://pl.test/e/e1"); assert.equal(gu.searchParams.get("location"), "Greenpoint");
  const ou = new URL(AC.outlook(it, "https://pl.test")); assert.equal(ou.origin + ou.pathname, "https://outlook.live.com/calendar/0/deeplink/compose"); assert.equal(ou.searchParams.get("startdt"), "2026-12-06T00:00:00.000Z"); assert.equal(ou.searchParams.get("subject"), "Supper & songs"); assert.equal(ou.searchParams.get("rru"), "addevent");
  const all = new URL(AC.google({ ...it, allDay: true, endDate: "2026-12-07" }, "https://pl.test")); assert.equal(all.searchParams.get("dates"), "20261205/20261208");
  assert.equal(new URL(AC.outlook({ ...it, allDay: true }, "https://pl.test")).searchParams.get("allday"), "true");
  assert.equal(AC.ics(it), "/plans/ics/e1.ics");
  // a row offers it; the native app hands .ics links to the phone's calendar (public/native.js)
  assert.match(T.rowHtml({ ...it, kind: "going", key: "going:e1" }, { cal: true }), /data-addcal="going:e1"/); assert.doesNotMatch(T.rowHtml({ ...it, kind: "todo", key: "t" }, { cal: true }), /data-addcal/);
  assert.match(read("public/native.js"), /\\\.ics\(\\\?\|\$\)/);
});

test("sync all my plans: a private feed per person, only their plans, addresses as they may see them, and a reset", async () => {
  assert.equal((await get("/api/me/plans/feed")).status, 401);
  const f = await (await get("/api/me/plans/feed", { cookie: ivy.cookie })).json(); assert.match(f.webcal, /^webcal:\/\/127\.0\.0\.1:\d+\/plans\/feed\/[A-Za-z0-9_-]{24}\.ics$/); assert.equal(f.https.replace(/^http:/, "webcal:"), f.webcal);
  assert.equal((await (await get("/api/me/plans/feed", { cookie: ivy.cookie })).json()).https, f.https, "the same link each time");
  const z = await (await get("/api/me/plans/feed", { cookie: zoe.cookie })).json(); assert.notEqual(z.https, f.https);
  const body = await (await fetch(f.https)).text();
  assert.match(body, /X-WR-CALNAME:Your plans on Pottery Lab/); assert.match(body, /SUMMARY:Friendsgiving potluck/); assert.match(body, /SUMMARY:Records and dumplings/); assert.match(body, /SUMMARY:Cabin weekend/); assert.match(body, /TRIGGER:-PT120M/);
  assert.doesNotMatch(body, /Wine night/, "not the waitlist"); assert.doesNotMatch(body, /secret dinner/, "not someone else's");
  assert.match(body, /LOCATION:Mina's place\\, 88 Noble St/, "in: the address, as on your own .ics");
  assert.doesNotMatch(await (await fetch(z.https)).text(), /Records and dumplings|Cabin weekend/);
  assert.equal((await fetch(f.https.replace(/\/feed\/[^.]+/, "/feed/" + "A".repeat(24)))).status, 404, "a made-up link is nothing");
  const r = await (await post("/api/me/plans/feed/reset", {}, { cookie: ivy.cookie })).json(); assert.equal(r.ok, true); assert.notEqual(r.https, f.https);
  assert.equal((await fetch(f.https)).status, 404, "the old link stops working"); assert.equal((await fetch(r.https)).status, 200);
  assert.equal((await post("/api/me/plans/feed/reset", {})).status, 401);
  assert.match(read("public/settings.html"), /PLAddCal\.sync\(document\.getElementById\("calSync"\), \{ settings: true \}\)/, "Reset link lives in Settings");
});

test("the pages: Plans leads with the timeline, a calendar toggle, the empty state, Past; the invite shows the plan", () => {
  const p = read("public/plans.html"); assert.match(p, /data-view="timeline" aria-selected="true"/); assert.match(p, />Calendar</); assert.match(p, /Something this weekend\?/); assert.match(p, /href="\/plans\?past=1">Past plans/);
  assert.match(p, /\/timeline\.js/); assert.match(p, /PLAddCal\?\.sync/);
  const inv = read("public/invite.html"); assert.match(inv, /\/planhook\.js/); assert.ok(inv.length < 40000);
  for (const f of ["public/plans.html", "public/plan.html", "public/timeline.js", "public/addcal.js", "public/planhook.js", "public/timeline.css", "server/plans.js"]) assert.doesNotMatch(read(f), /—/, f + " has an em dash");
  assert.doesNotMatch(read("public/timeline.css"), /#[0-9a-f]{3,6}\b/i, "colours come from the brand tokens");
});
