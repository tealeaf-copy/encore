// Inspiration cards in the feed (server/inspiration.js, server/moments.json, server/spotnotes.js, public/inspire.js):
// holiday date rules and lead windows over several years, regional filtering, the sensitivity rules, the three spot
// sources and their labels, editorial expiry and admin-only changes, the frequency caps, the "Plan this" pre-fill into
// the create canvas, dismissals that stay, PostHog counts, and a browser check at 390 and 1280 near Friendsgiving.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { MOMENTS, dateOf, occurrence, regionOK, whereOf, checkMoment, momentCard, slotsFor, place, capDay, makeInspiration, planDate, easterOf, LABEL, EVERY, PER_DAY } from "../server/inspiration.js";
import { cleanSpot, liveSpot, makeSpotNotes, SPOT_DAYS } from "../server/spotnotes.js";
import { _setFetch, _reset, _queue } from "../server/posthog.js";

const SHOTS = process.env.INSPIRATION_SHOTS || path.join(os.tmpdir(), "inspiration-shots");
const T = (d) => Date.parse(d + "T15:00:00Z");
const M = (id) => MOMENTS.find((m) => m.id === id);
const mem = () => { const D = new Map(); return { get: (k) => (D.has(k) ? { data: D.get(k) } : null), set: (k, v) => D.set(k, v), listPrefix: () => [] }; };
const heads = (L) => L.map((c) => c.head);

// ---------- the calendar ----------
test("date rules: Thanksgiving, Friendsgiving, Easter, the Super Bowl, Mother's Day, Pride and table dates across years", () => {
  const want = {
    thanksgiving: ["2025-11-27", "2026-11-26", "2027-11-25", "2028-11-23"], friendsgiving: ["2025-11-22", "2026-11-21", "2027-11-20", "2028-11-18"],
    easter: ["2025-04-20", "2026-04-05", "2027-03-28", "2028-04-16"], "super-bowl": ["2025-02-09", "2026-02-08", "2027-02-14", "2028-02-13"],
    "mothers-day": ["2025-05-11", "2026-05-10", "2027-05-09", "2028-05-14"], "fathers-day": ["2025-06-15", "2026-06-21", "2027-06-20", "2028-06-18"],
    pride: ["2025-06-29", "2026-06-28", "2027-06-27", "2028-06-25"], "lunar-new-year": ["2025-01-29", "2026-02-17", "2027-02-06", "2028-01-26"],
    "canadian-thanksgiving": ["2025-10-13", "2026-10-12", "2027-10-11", "2028-10-09"], "july-4": ["2025-07-04", "2026-07-04", "2027-07-04", "2028-07-04"],
  };
  for (const [id, L] of Object.entries(want)) L.forEach((d, i) => assert.equal(dateOf(M(id), 2025 + i), d, `${id} ${2025 + i}`));
  assert.equal(easterOf(2030), "2030-04-21"); assert.equal(dateOf(M("world-cup-final"), 2027), "", "a table without the year has no date");
  // Friendsgiving is always the Saturday before Thanksgiving
  for (let y = 2025; y <= 2032; y++) { const d = dateOf(M("friendsgiving"), y); assert.equal(new Date(d + "T00:00:00Z").getUTCDay(), 6, d); }
  // a Saturday near the date for "Plan this"
  assert.equal(planDate("2026-12-25", "saturday-before"), "2026-12-19"); assert.equal(planDate("2026-10-31", "saturday-before"), "2026-10-31");
  assert.equal(planDate("2027-02-06", "saturday-near"), "2027-02-06"); assert.equal(planDate("2026-02-17", "saturday-near"), "2026-02-14"); assert.equal(planDate("2026-02-18", "saturday-after"), "2026-02-21");
});

test("lead windows: shown 1 to 4 weeks before, never after, and across the new year", () => {
  const F = M("friendsgiving"); // Nov 21 2026, lead 7 to 28 days
  assert.equal(occurrence(F, T("2026-10-23")), null, "29 days before: not yet"); assert.deepEqual(occurrence(F, T("2026-10-24")), { date: "2026-11-21", days: 28 });
  assert.deepEqual(occurrence(F, T("2026-11-14")), { date: "2026-11-21", days: 7 }); assert.equal(occurrence(F, T("2026-11-15")), null, "under a week: too late to nudge");
  assert.equal(occurrence(F, T("2027-10-23")).date, "2027-11-20");
  // late December reaches into next year's moments; early January still sees nothing of last year's
  assert.equal(occurrence(M("lunar-new-year"), T("2027-01-15")).date, "2027-02-06"); assert.equal(occurrence(M("lunar-new-year"), T("2027-12-30")).date, "2028-01-26");
  assert.equal(occurrence(M("new-years-eve"), T("2026-12-10")).days, 21); assert.equal(occurrence(M("new-years-eve"), T("2027-01-02")), null);
  // Ramadan runs a while: iftars are suggested from three weeks before into its first days
  assert.ok(occurrence(M("ramadan-iftar"), T("2026-02-25"))); assert.equal(occurrence(M("ramadan-iftar"), T("2026-03-05")), null);
  for (const m of MOMENTS) assert.ok(m.lead[1] >= 7 && m.lead[1] <= 28, m.id);
  // the card's words
  const c = momentCard(F, occurrence(F, T("2026-11-01")), { now: T("2026-11-01") });
  assert.equal(c.head, "Friendsgiving is in 3 weeks"); assert.equal(c.idea, "Host a potluck"); assert.equal(c.label, "On the calendar");
  assert.deepEqual(c.plan, { kind: "potluck", title: "Friendsgiving potluck", date: "2026-11-21", city: "" }); assert.equal(c.cover, "turkey");
  assert.equal(momentCard(F, occurrence(F, T("2026-11-01")), { now: T("2026-11-01"), interests: ["baking"] }).idea, "Host a pie swap", "interests pick the idea");
});

test("regions: US holidays in US cities, Canada's own Thanksgiving, hemispheres, cherry blossoms by city, and no city", () => {
  const I = makeInspiration({ store: mem() }), on = (city, d) => heads(I.candidates({ city }, T(d)));
  assert.ok(on("Brooklyn", "2026-11-01").includes("Friendsgiving is in 3 weeks"), "Brooklyn is New York");
  assert.ok(!on("London", "2026-11-01").some((h) => /Thanksgiving|Friendsgiving/.test(h))); assert.ok(on("London", "2026-10-10").includes("Halloween is in 3 weeks"));
  assert.ok(on("Toronto", "2026-09-28").includes("Thanksgiving is in 2 weeks")); assert.ok(!on("Chicago", "2026-09-28").some((h) => /Thanksgiving/.test(h)));
  assert.ok(!on("Paris", "2026-06-25").some((h) => /July/.test(h))); assert.ok(on("Austin", "2026-06-14").some((h) => /Fourth of July/.test(h)));
  assert.ok(on("Seattle", "2026-06-05").some((h) => /longest day/.test(h))); assert.ok(!on("Sydney", "2026-06-05").some((h) => /longest day/.test(h)), "no June solstice nudge in the south");
  assert.ok(on("Washington", "2026-03-10").some((h) => /Cherry blossoms/.test(h))); assert.ok(!on("Chicago", "2026-03-10").some((h) => /Cherry blossoms/.test(h)));
  assert.ok(!on("Miami", "2026-09-25").some((h) => /Leaf season/.test(h))); assert.ok(on("Boston", "2026-09-25").some((h) => /Leaf season/.test(h)));
  // no city: only moments for everywhere, nothing tied to a country or a city
  assert.equal(regionOK(M("thanksgiving"), null), false); assert.equal(regionOK(M("hanukkah"), null), true);
  assert.deepEqual(whereOf("Brooklyn"), { city: "New York", country: "US", north: true }); assert.equal(whereOf("Atlantis"), null);
});

test("sensitivity: plain words, no stereotypes, religious observances framed for those who celebrate and never as parties", () => {
  for (const m of MOMENTS) assert.deepEqual(checkMoment(m), [], m.id);
  const R = MOMENTS.filter((m) => m.type === "religious"); assert.ok(R.length >= 7);
  for (const m of R) for (const i of m.ideas) { assert.match(i.cta, /^If you/, m.id); assert.doesNotMatch(`${i.title} ${i.cta} ${i.line}`, /part(y|ies)|theme|costume|drinks|cocktail/i, m.id); }
  assert.ok(M("ramadan-iftar").ideas.every((i) => /iftar/i.test(i.title)), "Ramadan is iftars");
  assert.ok(checkMoment({ ...M("ramadan-iftar"), ideas: [{ title: "Ramadan party", cta: "If you're fasting, host a Ramadan party", line: "Fun.", kind: "drinks" }, M("ramadan-iftar").ideas[0]] }).includes("party words on a religious observance"));
  assert.ok(checkMoment({ ...M("st-patricks"), ideas: [{ title: "Leprechaun bar crawl", cta: "Host it", line: "Kiss me I'm Irish.", kind: "drinks" }, M("st-patricks").ideas[0]] }).includes("stereotype"));
  assert.ok(checkMoment({ ...M("diwali"), ideas: M("diwali").ideas.map((i) => ({ ...i, cta: "Host a Diwali dinner" })) }).some((e) => /If you celebrate/.test(e)), "never assumes everyone celebrates");
  const list = ["Thanksgiving", "Friendsgiving", "Hanukkah", "Christmas", "New Year's Eve", "Lunar New Year", "Valentine's Day", "Galentine's Day", "St Patrick's Day", "Easter", "Holi", "Diwali", "Ramadan", "Eid al-Fitr", "Mother's Day", "Father's Day", "Pride", "The Fourth of July", "The summer solstice", "Back to school", "Halloween", "Picnic season", "Fall foliage", "Cherry blossoms", "The Super Bowl"];
  for (const n of list) assert.ok(MOMENTS.some((m) => m.name === n), n);
  for (const f of ["server/moments.json", "server/inspiration.js", "server/spotnotes.js", "public/inspire.js"]) assert.ok(!/\u2014/.test(fs.readFileSync(f, "utf8")), `${f}: no em dashes`);
  assert.ok(!/\p{Extended_Pictographic}/u.test(fs.readFileSync("public/inspire.js", "utf8")), "no emoji in chrome");
});

// ---------- spots ----------
test("spots: new on Pottery Lab from real public events, the team's notes, a provider's flags, each with its own label", () => {
  const store = mem(), app = { locals: {} }, I0 = makeInspiration({ store, app }), now = T("2026-11-01");
  const ev = (id, e) => [id, { id, ws: "w1", e: { discoverable: true, published: true, placePublic: true, city: "Brooklyn", ...e } }];
  const I = { events: new Map([
    ev("a", { venueName: "Kettl Matcha Bar", hood: "Greenpoint", date: "2026-10-20", activity: "tea tasting" }), ev("b", { venueName: "Kettl Matcha Bar", hood: "Greenpoint", date: "2026-10-28" }),
    ev("c", { venueName: "Old Roastery Cafe", hood: "Bushwick", date: "2026-03-01" }), ev("c2", { venueName: "Old Roastery Cafe", date: "2026-10-30" }), // first event long ago: not new
    ev("d", { venueName: "Nina's apartment", date: "2026-10-25", activity: "dinner" }), // a home, never a public place
    ev("e", { venueName: "Hidden Bakery", date: "2026-10-25", placePublic: false }), // the host didn't mark the place public
    ev("f", { venueName: "Sun Bakery", date: "2026-10-26", city: "Chicago" }), // another city
    ev("g", { venueName: "Private Bakery", date: "2026-10-26", private: true }), ev("h", { venueName: "Mystery Hall", date: "2026-10-26" }), // no category we can tell: skipped
  ]) };
  const publicOK = (x) => !x.e.private && x.e.discoverable;
  const N = I0.newHere(I, publicOK, whereOf("Brooklyn"), now); assert.equal(N.length, 1, JSON.stringify(N));
  assert.equal(N[0].label, "New on Pottery Lab"); assert.equal(N[0].head, "Kettl Matcha Bar in Greenpoint"); assert.equal(N[0].idea, "Plan a matcha morning"); assert.match(N[0].line, /^2 public events here on Pottery Lab since Oct 20\./);
  assert.deepEqual(N[0].plan, { kind: "brunch", title: "Matcha morning at Kettl Matcha Bar", place: "Kettl Matcha Bar", hood: "Greenpoint", city: "New York" });
  assert.ok(!/opened|trendy|hot/i.test(JSON.stringify(N)), "it never claims the place is new or trendy, only new here");
  // the team's notes
  assert.ok(I0.spots.add({ name: "Cha Cha Tea", hood: "Williamsburg", city: "Brooklyn", category: "matcha", line: "A small counter for whisked matcha and tea sweets.", source: "https://example.com/new-spots" }, now).note);
  // a provider with flags, and one without (ignored)
  app.locals.placeSuggest = { newSpots: () => [{ name: "Fern", hood: "Fort Greene", category: "dinner", flag: "hot_and_new", source: "Yelp", url: "https://www.yelp.com/biz/fern" }, { name: "Plain Diner", category: "dinner", source: "Yelp" }] };
  const L = I0.candidates({ city: "Brooklyn", I, publicOK }, now), S = L.filter((c) => c.type === "spot");
  assert.deepEqual(S.map((c) => c.label), ["New on Pottery Lab", "Spotted by the Pottery Lab team", "Hot and new on Yelp"]);
  const team = S[1]; assert.equal(team.head, "New matcha spot in Williamsburg"); assert.equal(team.idea, "Plan a matcha morning"); assert.equal(team.link.href, "https://example.com/new-spots");
  assert.equal(S[2].head, "New dinner spot in Fort Greene"); assert.equal(S[2].plan.place, "Fern"); assert.ok(!S.some((c) => /Plain Diner/.test(c.head + c.line)), "no flag, no claim");
  // moments and spots take turns
  assert.equal(L[0].source, "calendar"); assert.equal(L[1].type, "spot");
  // no places at all without a city
  assert.ok(!I0.candidates({ I, publicOK }, now).some((c) => c.type === "spot"));
});

test("editorial spot notes: plain, sourced, a city we know, gone after about 60 days or when retired", () => {
  const now = T("2026-11-01");
  assert.match(cleanSpot({ name: "X", city: "Brooklyn", category: "coffee", line: "A tiny window for espresso.", source: "https://a.example" }, now).error, /name/);
  assert.match(cleanSpot({ name: "Bean", city: "Atlantis", category: "coffee", line: "A tiny window for espresso.", source: "https://a.example" }, now).error, /city/);
  assert.match(cleanSpot({ name: "Bean", city: "Brooklyn", category: "bar", line: "A tiny window for espresso.", source: "https://a.example" }, now).error, /category/);
  assert.match(cleanSpot({ name: "Bean", city: "Brooklyn", category: "coffee", line: "A tiny window for espresso.", source: "http://a.example" }, now).error, /https/);
  assert.match(cleanSpot({ name: "Bean", city: "Brooklyn", category: "coffee", line: "Rated 4.8 stars by 900 reviews.", source: "https://a.example" }, now).error, /counts/);
  const { note } = cleanSpot({ name: "Bean", city: "Brooklyn", category: "coffee", line: "A tiny window for espresso.", source: "https://a.example", added: "2026-11-01" }, now);
  assert.equal(note.type, "spot"); assert.equal(note.city, "New York"); assert.equal(note.expires, "2026-12-31"); assert.equal(SPOT_DAYS, 60);
  assert.ok(liveSpot(note, T("2026-12-30"))); assert.ok(!liveSpot(note, T("2027-01-02")), "expired"); assert.ok(!liveSpot({ ...note, retired: true }, now));
  assert.equal(cleanSpot({ ...note, expires: "2027-06-01" }, now).note.expires, "2027-01-30", "at most 90 days");
  const S = makeSpotNotes(mem()); assert.ok(S.add(note, now).note); assert.ok(S.add(note, now).error, "no duplicates"); assert.equal(S.active(now, "New York").length, 1); assert.equal(S.active(now, "Chicago").length, 0);
  assert.ok(S.retire(note.id).ok); assert.equal(S.active(now).length, 0);
});

// ---------- the rhythm ----------
test("frequency: one card per 8 feed items, two different ones a day, never beside the ideas deck", () => {
  assert.equal(EVERY, 8); assert.equal(PER_DAY, 2);
  assert.deepEqual(slotsFor(2), [2]); assert.deepEqual(slotsFor(10), [3]); assert.deepEqual(slotsFor(11), [3, 11]); assert.deepEqual(slotsFor(20), [3, 11, 19]); assert.deepEqual(slotsFor(0), []);
  const items = Array.from({ length: 20 }, (_, i) => ({ kind: i === 3 ? "ideas" : "event", key: "e" + i })), cards = ["a", "b", "c", "d"].map((id) => ({ kind: "inspire", id, type: "holiday" }));
  const out = place(items, cards), at = out.map((x, i) => (x.kind === "inspire" ? i : -1)).filter((i) => i >= 0);
  assert.equal(at.length, 3); for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] - 1 >= EVERY - 1, "at least 7 other cards between two");
  for (const i of at) { assert.notEqual(out[i - 1]?.kind, "ideas"); assert.notEqual(out[i + 1]?.kind, "ideas"); }
  assert.deepEqual(capDay(cards, []).map((c) => c.id), ["a", "b"]); assert.deepEqual(capDay(cards, ["c"]).map((c) => c.id), ["a", "c"]); assert.deepEqual(capDay(cards, ["a", "b"]).map((c) => c.id), ["a", "b"]);
  // per person: seen twice today, a third new card waits until tomorrow; a dismissed one never comes back
  const store = mem(), I = makeInspiration({ store }), now = T("2026-11-01"), stream = Array.from({ length: 24 }, (_, i) => ({ kind: "event", key: "e" + i }));
  const ids = (who) => I.weave(stream, { email: who, city: "Brooklyn" }, now).filter((x) => x.kind === "inspire").map((x) => x.id);
  const first = ids("p@x.test"); assert.ok(first.length >= 1 && first.length <= 2, JSON.stringify(first));
  const all = I.candidates({ city: "Brooklyn" }, now).map((c) => c.id); assert.ok(all.length >= 3, "enough moments around early November to test the cap: " + all);
  I.seen("u:p@x.test", all[1], now); I.seen("u:p@x.test", all[2], now); assert.deepEqual(ids("p@x.test"), [all[1], all[2]]);
  I.dismiss("u:p@x.test", all[1]); assert.deepEqual(ids("p@x.test"), [all[2]]);
  assert.ok(!ids("p@x.test").includes(all[0]), "two seen today already (one since dismissed): a third waits for tomorrow");
  const left = I.candidates({ city: "Brooklyn" }, T("2026-11-02")).filter((c) => c.id !== all[1]).length;
  assert.equal(I.weave(stream, { email: "p@x.test", city: "Brooklyn" }, T("2026-11-02")).filter((x) => x.kind === "inspire").length, Math.min(2, left), "a new day, a new cap");
  // signed out with no city: the city prompt, nothing else
  const out2 = I.weave(stream, {}, now).filter((x) => x.kind === "inspire"); assert.deepEqual(out2.map((x) => x.type), ["city"]);
});

// ---------- through the server ----------
let srv; const U = {};
const J = { "content-type": "application/json" };
const post = (p, body, cookie) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body || {}) });
const get = (p, cookie) => fetch(srv.base + p, { headers: cookie ? { cookie } : {} });
const put = (p, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + p, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const cookies = (r, prev = "") => { const C = new Map(prev.split("; ").filter(Boolean).map((x) => [x.split("=")[0], x])); for (const c of r.headers.getSetCookie()) { const kv = c.split(";")[0]; C.set(kv.split("=")[0], kv); } return [...C.values()].join("; "); };
const join = async (who, name) => { const email = `${who}.in@example.com`, r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }), b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); U[who] = { cookie: cookies(r), ws: b.workspace.id, email }; };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const insp = (B) => (B?.items || []).filter((x) => x.kind === "inspire");

before(async () => {
  srv = await startServer();
  Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "inspire-secret-0123456789", ENCORE_SIGNUP_PER_HOUR: "500", ENCORE_FAKE_EMAIL: "1", ENCORE_ADMIN_EMAILS: "boss.in@example.com", ENCORE_INSPIRATION_TODAY: "2026-11-01" }); resetLoginLimits();
  for (const [w, n] of [["ana", "Ana Ruiz"], ["ben", "Ben Ode"], ["boss", "Boss Admin"], ["vic", "Vic Viewer"]]) await join(w, n);
  for (const [w, h, hood] of [["ana", "ana-in", "Greenpoint"], ["ben", "ben-in", "Williamsburg"]]) assert.ok((await post("/api/host/profile", { handle: h, name: h === "ana-in" ? "Ana's Table" : "Ben Runs", city: "Brooklyn", hood, tagline: "Small and calm." }, U[w].cookie)).ok);
  const ev = (w, id, d) => put("events/" + id, { kind: "social", casual: true, city: "Brooklyn", hood: "Greenpoint", discoverable: true, published: true, headcount: 8, ...d }, U[w].cookie);
  // a dozen upcoming public events, so the stream is long enough for its rhythm
  for (let i = 0; i < 7; i++) assert.equal((await ev("ana", "inA" + i, { name: ["Supper club", "Dumpling night", "Board game night", "Pasta night", "Book club", "Sourdough class", "Mahjong night"][i], activity: "supper", date: day(2 + i) })).status, 200);
  for (let i = 0; i < 6; i++) assert.equal((await ev("ben", "inB" + i, { name: ["Saturday 5k", "Sunrise run", "Track night", "Long run", "Bagel run", "Park loop"][i], activity: "run", hood: "Williamsburg", date: day(3 + i) })).status, 200);
  // a public place first used here three weeks before the pinned day: new on Pottery Lab
  assert.equal((await ev("ana", "inK0", { name: "Matcha tasting", activity: "matcha", venueName: "Kettl Matcha Bar", placePublic: true, date: "2026-10-12" })).status, 200);
  srv.app.locals.social?.bust?.(); srv.app.locals.trends?.bust?.();
});
after(async () => { delete process.env.ENCORE_INSPIRATION_TODAY; delete process.env.ENCORE_POSTHOG_KEY; _reset(); await srv?.close(); });

test("the feed: a card near Friendsgiving signed in and out, the city prompt without a city, admin-only spot notes", async () => {
  const pub = await (await get("/api/public/feed?city=Brooklyn")).json(), P = insp(pub.blend);
  assert.ok(P.length >= 1 && P.length <= 2, JSON.stringify(P)); assert.equal(P[0].head, "Friendsgiving is in 3 weeks"); assert.equal(P[0].idea, "Host a potluck");
  const at = pub.blend.items.findIndex((x) => x.kind === "inspire"); assert.equal(at, 3, "the first one after three cards");
  const none = insp((await (await get("/api/public/feed")).json()).blend); assert.deepEqual(none.map((x) => x.type), ["city"], "signed out, no city: a city prompt");
  const me = await (await get("/api/me/feed?city=Brooklyn", U.vic.cookie)).json(), mine = insp(me.blend); assert.ok(mine.length >= 1, "signed in: the city comes from their page or interests or the query");
  const r = await (await get("/api/me/inspiration?city=Brooklyn", U.vic.cookie)).json(); assert.ok(r.cards.some((c) => c.label === "New on Pottery Lab" && c.head === "Kettl Matcha Bar in Greenpoint"), JSON.stringify(r.cards.map((c) => c.head)));
  assert.equal(r.today, "2026-11-01");
  // spot notes: 404 for everyone but admins
  const note = { name: "Cha Cha Tea", hood: "Williamsburg", city: "Brooklyn", category: "matcha", line: "A small counter for whisked matcha and tea sweets.", source: "https://example.com/new-spots" };
  assert.equal((await get("/api/admin/spot-notes")).status, 404); assert.equal((await get("/api/admin/spot-notes", U.vic.cookie)).status, 404); assert.equal((await post("/api/admin/spot-notes", note, U.vic.cookie)).status, 404);
  const a = await post("/api/admin/spot-notes", note, U.boss.cookie); assert.equal(a.status, 200); const id = (await a.json()).note.id;
  assert.equal((await post("/api/admin/spot-notes", { ...note, source: "" }, U.boss.cookie)).status, 400);
  const L = await (await get("/api/admin/spot-notes", U.boss.cookie)).json(); assert.ok(L.notes.find((n) => n.id === id).active); assert.equal(L.days, 60);
  assert.ok((await (await get("/api/me/inspiration?city=Brooklyn", U.vic.cookie)).json()).cards.length >= 1);
  const all = makeInspiration({ store: srv.store }).candidates({ city: "Brooklyn" }); assert.ok(all.some((c) => c.label === LABEL.team && c.head === "New matcha spot in Williamsburg"));
  assert.equal((await post(`/api/admin/spot-notes/${id}/retire`, {}, U.vic.cookie)).status, 404); assert.equal((await post(`/api/admin/spot-notes/${id}/retire`, {}, U.boss.cookie)).status, 200);
  assert.ok(!(await (await get("/api/admin/spot-notes", U.boss.cookie)).json()).notes.find((n) => n.id === id).active);
});

test("dismiss stays dismissed (signed in and per device), and shown, tapped, planned and dismissed are counted without personal data", async () => {
  process.env.ENCORE_POSTHOG_KEY = "phc_testkey12345678"; _reset(); _setFetch(async () => ({ ok: true, status: 200 }));
  const c0 = insp((await (await get("/api/me/feed?city=Brooklyn", U.ben.cookie)).json()).blend)[0]; assert.ok(c0, "a card for Ben");
  assert.equal((await post("/api/inspiration/track", { id: c0.id, action: "shown" }, U.ben.cookie)).status, 200);
  assert.equal((await post("/api/inspiration/track", { id: c0.id, action: "tapped" }, U.ben.cookie)).status, 200);
  assert.equal((await post("/api/inspiration/track", { id: c0.id, action: "dismissed" }, U.ben.cookie)).status, 200);
  assert.equal((await post("/api/inspiration/track", { id: "m:not-a-thing:2026", action: "shown" })).status, 400); assert.equal((await post("/api/inspiration/track", { id: c0.id, action: "loved" })).status, 400);
  assert.ok(!insp((await (await get("/api/me/feed?city=Brooklyn", U.ben.cookie)).json()).blend).some((x) => x.id === c0.id), "gone for Ben");
  assert.ok(insp((await (await get("/api/me/feed?city=Brooklyn", U.vic.cookie)).json()).blend).some((x) => x.id === c0.id), "still there for Vic");
  // a device, signed out
  const dev = "devInspire0001";
  const d0 = insp((await (await get("/api/public/feed?city=Brooklyn&device=" + dev)).json()).blend)[0];
  await post("/api/inspiration/track", { id: d0.id, action: "dismissed", device: dev });
  assert.ok(!insp((await (await get("/api/public/feed?city=Brooklyn&device=" + dev)).json()).blend).some((x) => x.id === d0.id), "gone for this device");
  assert.ok(insp((await (await get("/api/public/feed?city=Brooklyn")).json()).blend).some((x) => x.id === d0.id), "not for others");
  // planned: an event saved from Plan this carries inspiredBy
  assert.equal((await put("events/inPlan0", { kind: "social", name: "Friendsgiving potluck", planKind: "potluck", date: "2026-11-21", city: "New York", inspiredBy: "m:friendsgiving:2026" }, U.vic.cookie)).status, 200);
  const Q = _queue().filter((e) => e.event.startsWith("inspiration_")), names = Q.map((e) => e.event);
  for (const n of ["inspiration_shown", "inspiration_tapped", "inspiration_dismissed", "inspiration_planned"]) assert.ok(names.includes(n), n);
  const pl = Q.find((e) => e.event === "inspiration_planned").properties; assert.equal(pl.via, "calendar"); assert.equal(pl.kind, "holiday"); assert.equal(pl.goal, "friendsgiving"); assert.equal(pl.region, "New York");
  const sh = Q.find((e) => e.event === "inspiration_shown").properties; assert.ok(sh.via && sh.kind && sh.goal);
  assert.ok(!/@|example\.com|Ben|Vic/.test(JSON.stringify(Q)), "no names or emails");
  delete process.env.ENCORE_POSTHOG_KEY; _reset();
});

test("browser: the card at 390 and 1280 near Friendsgiving, Plan this fills the create canvas, Not for me stays hidden", { timeout: 240_000 }, async (t) => {
  let chromium, devices; try { ({ chromium, devices } = createRequire(import.meta.url)("playwright")); } catch { return t.skip("playwright is not installed"); }
  let browser; try { browser = await chromium.launch(); } catch { return t.skip("no Chromium here"); }
  fs.mkdirSync(SHOTS, { recursive: true });
  try {
    for (const [name, opts] of [["390", { ...devices["iPhone 13"] }], ["1280", { viewport: { width: 1280, height: 900 } }]]) {
      for (const who of ["out", "in"]) {
        const ctx = await browser.newContext({ ...opts, reducedMotion: "reduce" }), page = await ctx.newPage(), errs = [];
        page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); }); page.on("pageerror", (e) => errs.push(String(e)));
        await ctx.addInitScript(() => { try { localStorage.setItem("encore.place", JSON.stringify({ city: "Brooklyn", source: "manual" })); localStorage.setItem("encore.city", "Brooklyn"); } catch {} });
        if (who === "in") await ctx.addCookies(U.vic.cookie.split("; ").map((kv) => ({ name: kv.split("=")[0], value: kv.slice(kv.indexOf("=") + 1), url: srv.base })).concat([{ name: "encore_in", value: "1", url: srv.base }]));
        await page.goto(srv.base + "/feed", { waitUntil: "networkidle" });
        const card = page.locator(".fb-insp").first(); await card.waitFor({ timeout: 15000 }); await card.scrollIntoViewIfNeeded();
        assert.match(await card.innerText(), /Friendsgiving is in 3 weeks/); assert.match(await card.innerText(), /On the calendar/);
        const box = await card.boundingBox(), vw = page.viewportSize().width; assert.ok(box.x >= 0 && box.x + box.width <= vw + 1, "inside the screen");
        for (const b of await card.locator(".ins-go,.ins-no").all()) { const r = await b.boundingBox(); assert.ok(r.height >= 44 && r.width >= 44, "44px taps"); }
        const [g, n] = await Promise.all([card.locator(".ins-go").boundingBox(), card.locator(".ins-no").boundingBox()]); assert.equal(Math.round(g.height), Math.round(n.height), "the two buttons share a height");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "no sideways scroll");
        const font = await card.locator(".ins-h").evaluate((el) => getComputedStyle(el).fontFamily); assert.match(font, /Plex Sans/);
        await page.waitForTimeout(400); await card.screenshot({ path: path.join(SHOTS, `card-${name}-${who}.png`) }); await page.screenshot({ path: path.join(SHOTS, `feed-${name}-${who}.png`) });
        if (who === "in" && name === "390") {
          // Plan this: one tap to the create canvas, filled in
          await card.locator(".ins-go").click(); await page.waitForURL(/app=1/, { timeout: 15000 });
          try { await page.locator("#cv").waitFor({ timeout: 20000 }); } catch (e) { await page.screenshot({ path: path.join(SHOTS, `plan-fail-${name}.png`) }); console.log(page.url(), errs); throw e; } await page.waitForTimeout(600);
          const title = await page.locator("#cvTitle").inputValue().catch(() => ""); assert.equal(title, "Friendsgiving potluck");
          assert.doesNotMatch(page.url(), /insp=|ititle=/, "the link tidies itself");
          await page.screenshot({ path: path.join(SHOTS, `plan-${name}.png`), fullPage: true }); const txt = await page.locator("#cv").innerText(); assert.match(txt, /Nov 21|November 21|21 Nov/, "the date near the holiday");
          await page.goto(srv.base + "/feed", { waitUntil: "networkidle" }); await page.locator(".fb-insp").first().waitFor({ timeout: 15000 });
          // the "New on Pottery Lab" card, as the same renderer draws it, for a look
          const spotHtml = await page.evaluate(async () => { const j = await (await fetch("/api/me/inspiration?city=Brooklyn")).json(); const c = j.cards.find((x) => x.type === "spot"); return c ? window.PLInspire.card(c) : ""; });
          assert.match(spotHtml, /New on Pottery Lab/); assert.match(spotHtml, /Kettl Matcha Bar in Greenpoint/);
          await page.evaluate((h) => { const d = document.createElement("div"); d.id = "spotShot"; d.className = "fb-stream"; d.style.cssText = "padding:0 16px;max-width:640px;margin:0 auto"; d.innerHTML = h; document.body.prepend(d); window.scrollTo(0, 0); }, spotHtml);
          await page.locator("#spotShot .fb-insp").screenshot({ path: path.join(SHOTS, `spot-${name}.png`) }); await page.evaluate(() => document.getElementById("spotShot").remove());
        }
        if (who === "out") {
          const id = await card.getAttribute("data-ins"); await card.locator(".ins-no").click(); assert.equal(await page.locator(`[data-ins="${id}"]`).count(), 0, "gone at once");
          await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(800); assert.equal(await page.locator(`[data-ins="${id}"]`).count(), 0, "still gone after a reload");
        }
        assert.deepEqual(errs.filter((e) => !/favicon|net::ERR|Failed to load resource/.test(e)), [], "console clean");
        await ctx.close();
      }
    }
    // signed out, no city: the city prompt
    const ctx = await browser.newContext({ ...devices["iPhone 13"], reducedMotion: "reduce" }), page = await ctx.newPage();
    await page.goto(srv.base + "/feed", { waitUntil: "networkidle" }); const c = page.locator(".fb-insp").first(); await c.waitFor({ timeout: 15000 }); await c.scrollIntoViewIfNeeded();
    assert.match(await c.innerText(), /Where are you hosting\?/); await c.screenshot({ path: path.join(SHOTS, "city-prompt-390.png") }); await ctx.close();
  } finally { await browser.close(); }
});
