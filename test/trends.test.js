// Potto's idea engine (server/trends.js, server/trendnotes.js, public/trendideas.js): scoring with decay and
// smoothing, the minimum sample, what never counts (examples, private, members-only), no individual data in any
// answer, trend notes that expire and are admin-only to change, the three source labels, light personalisation with
// no repeats, every place Potto now proposes ideas, and a browser check at 390 of the canvas ideas and the Home card.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { decay, smooth, scoreGroup, groupsOf, priors, publicView, formatOf, countsPublicly, FORMATS, SOURCE, makeTrends } from "../server/trends.js";
import { SEED_NOTES, NOTE_DAYS, fresh, cleanNote, makeTrendNotes, seasonOf } from "../server/trendnotes.js";
import { openStore } from "../server/db.js";
import { pottoReply } from "../server/pottorules.js";
import { readIntent } from "../server/pottotext.js";

const SHOTS = process.env.TRENDS_SHOTS || path.join(os.tmpdir(), "trends-shots"); // screenshots from the browser check
let srv;
const J = { "content-type": "application/json" };
const post = (p, body, cookie) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body || {}) });
const get = (p, cookie) => fetch(srv.base + p, { headers: cookie ? { cookie } : {} });
const put = (p, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + p, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const U = {};
const cookies = (r, prev = "") => { const M = new Map(prev.split("; ").filter(Boolean).map((x) => [x.split("=")[0], x])); for (const c of r.headers.getSetCookie()) { const kv = c.split(";")[0]; M.set(kv.split("=")[0], kv); } return [...M.values()].join("; "); };
const join = async (who, name) => { const email = `${who}.tr@example.com`, r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }), b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); U[who] = { cookie: cookies(r), ws: b.workspace.id, email }; };
const ev = (w, id, d) => put("events/" + id, { kind: "social", casual: true, city: "Brooklyn", hood: "Greenpoint", discoverable: true, published: true, headcount: 8, ...d }, U[w].cookie);
// n guests going, k of them leaving "would go again" kudos
function guests(w, eventId, n, k = 0, tag = "g", { again = k, shared = false } = {}) { for (let i = 0; i < n; i++) { const em = (shared ? `${tag}${i}@guest.test` : `${tag}${i}.${eventId}@guest.test`).toLowerCase();
  srv.store.set(`ws/${U[w].ws}/rsvps/${eventId}r${i}`, { eventId, email: em, name: "Guest " + i, response: "going", createdAt: Date.now() - 5 * 864e5, code: "C" + i });
  if (i < k) srv.store.set(`ws/${U[w].ws}/kudos/${eventId}k${i}`, { eventId, email: em, name: "Guest " + i, tags: i < again ? ["again", "food"] : ["food"], at: Date.now() - 864e5 }); } }
const PRIVATE_WORDS = /@|guest\.test|Guest \d|trSup|trRun|trMj|trGame|trEx|\bws-|"ws"|"id"|email/;

before(async () => {
  srv = await startServer();
  Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "trends-secret-0123456789", ENCORE_SIGNUP_PER_HOUR: "500", ENCORE_FAKE_EMAIL: "1", ENCORE_ADMIN_EMAILS: "boss.tr@example.com" }); resetLoginLimits();
  for (const [w, n] of [["ana", "Ana Ruiz"], ["ben", "Ben Ode"], ["cai", "Cai Lin"], ["dee", "Dee Moss"], ["eli", "Eli Fox"], ["fay", "Fay Hart"], ["gus", "Gus Kim"], ["boss", "Boss Admin"], ["vic", "Vic Viewer"]]) await join(w, n);
  for (const [w, h] of [["ana", "ana-tr"], ["ben", "ben-tr"], ["cai", "cai-tr"], ["dee", "dee-tr"], ["eli", "eli-tr"], ["fay", "fay-tr"], ["gus", "gus-tr"]])
    assert.ok((await post("/api/host/profile", { handle: h, name: h, city: "Brooklyn", hood: "Greenpoint", tagline: "Small." }, U[w].cookie)).ok);
  // supper clubs: 4 hosts, 6 guests each, 5 of 6 would go again, all this month
  for (const [i, w] of ["ana", "ben", "cai", "dee"].entries()) { assert.equal((await ev(w, "trSup" + i, { name: "Greenpoint Supper Club", activity: "supper", date: day(-3 - i * 4) })).status, 200); guests(w, "trSup" + i, 6, 5, "g", { again: 4 }); }
  // runs: 3 hosts, 6 guests each, no kudos
  for (const [i, w] of ["ana", "eli", "fay"].entries()) { await ev(w, "trRun" + i, { name: "Saturday 5k, coffee after", activity: "run", date: day(-6 - i * 3), headcount: 12 }); guests(w, "trRun" + i, 6, 0, "r"); }
  // mahjong: big, but private, members-only or an example, so it never counts
  await ev("ben", "trMj0", { name: "Mahjong night", activity: "games", date: day(-5), private: true, discoverable: false }); guests("ben", "trMj0", 12, 10, "m");
  await ev("cai", "trMj1", { name: "Mahjong night", activity: "games", date: day(-5), membersOnly: true }); guests("cai", "trMj1", 12, 10, "m");
  await ev("eli", "trMj2", { name: "Mahjong night", activity: "games", date: day(-5), example: true }); guests("eli", "trMj2", 12, 10, "m");
  await ev("gus", "trMj3", { name: "Mahjong night", activity: "games", date: day(-5), friendsOnly: true }); guests("gus", "trMj3", 12, 10, "m");
  // game nights: 40 guests but only 2 hosts, below the minimum
  await ev("fay", "trGame0", { name: "Board game night", activity: "games", date: day(-4), headcount: 30 }); guests("fay", "trGame0", 20, 18, "x");
  await ev("gus", "trGame1", { name: "Board game night", activity: "games", date: day(-8), headcount: 30 }); guests("gus", "trGame1", 20, 18, "y");
  // Gus's own run last week, to compare: lots of repeat guests (the same people as his earlier run)
  await ev("gus", "trRunG0", { name: "Saturday 5k, coffee after", activity: "run", date: day(-40), headcount: 12 }); guests("gus", "trRunG0", 6, 0, "rg", { shared: true });
  await ev("gus", "trRunG1", { name: "Saturday 5k, coffee after", activity: "run", date: day(-2), headcount: 12 }); guests("gus", "trRunG1", 6, 0, "rg", { shared: true });
  // one trend note dated today, so the editorial tier is there whenever this runs (the shipped seed expires by itself)
  srv.store.set("system/trendnotes", { kind: "trendnotes", retired: [], added: [{ id: "n-testmj", name: "Mahjong night", line: "Learn-to-play tables next to tables for regulars.", where: "social media", seasons: ["any"], cities: [], added: day(0), format: "mahjong", say: "A mahjong night for 8 Friday at 7" }] });
  srv.app.locals.social.bust(); srv.app.locals.trends.bust();
});
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_ADMIN_EMAILS", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv.close(); });

// ---------- the maths ----------
test("decay: full weight for 30 days, half at 90, a quarter at 150; smoothing pulls small samples to the prior", () => {
  assert.equal(decay(0), 1); assert.equal(decay(30), 1); assert.equal(decay(-5), 1); assert.equal(decay(90), 0.5); assert.equal(decay(150), 0.25); assert.ok(decay(365) < 0.03);
  assert.equal(smooth(0, 0, 0.6, 10), 0.6, "no answers: the prior");
  assert.ok(Math.abs(smooth(2, 2, 0.6, 10) - 0.667) < 0.01, "2 of 2 is not 100%");
  assert.ok(smooth(190, 200, 0.6, 10) > 0.92, "many answers decide");
});
const rec = (o) => ({ ws: "w", format: "supper-club", type: "dinner", city: "Brooklyn", hood: "", age: 10, past: true, dow: 6, season: "autumn", guests: 8, fill: 1, waitlist: 0, againYes: 6, againOf: 7, saves: 1, vouches: 0, buzz: 1, follows: 0, repeat: 2, ...o });
test("scoring: recent beats old, steady beats one viral night, and the sample gate holds", () => {
  const recent = [1, 2, 3, 4].map((i) => rec({ ws: "w" + i, format: "supper-club", age: 10 })), old = [1, 2, 3, 4].map((i) => rec({ ws: "o" + i, format: "potluck", age: 200 }));
  const P = priors([...recent, ...old]), G = Object.fromEntries(groupsOf([...recent, ...old], "city").map((g) => [g.format, g]));
  assert.ok(scoreGroup(G["supper-club"], P) > scoreGroup(G.potluck, P), "the same nights, but recent ones count more");
  // a viral night: one event of 200 with 3 kudos, all "again", plus two tiny ones; against a steady format
  const viral = [rec({ ws: "v1", format: "game-night", guests: 200, againYes: 3, againOf: 3, fill: 1, repeat: 0 }), rec({ ws: "v2", format: "game-night", guests: 2, againYes: 0, againOf: 0, fill: 0.25, repeat: 0 }), rec({ ws: "v3", format: "game-night", guests: 2, againYes: 0, againOf: 0, fill: 0.25, repeat: 0 })];
  const steady = [1, 2, 3, 4, 5, 6].map((i) => rec({ ws: "s" + (i % 4), format: "book-club", guests: 9, againYes: 7, againOf: 8, fill: 0.9, repeat: 3 }));
  const P2 = priors([...viral, ...steady]), G2 = Object.fromEntries(groupsOf([...viral, ...steady], "city").map((g) => [g.format, g]));
  assert.ok(scoreGroup(G2["book-club"], P2) > scoreGroup(G2["game-night"], P2), "one viral night doesn't dominate");
  assert.equal(groupsOf([...viral, ...steady], "city").find((g) => g.format === "game-night").wGuests, 40 + 2 + 2, "one event's guests are capped");
  // the gate: 2 hosts never trend, however many guests; 3 hosts with 14 guests don't either
  const two = [rec({ ws: "a", guests: 50 }), rec({ ws: "b", guests: 50 })], thin = [rec({ ws: "a", guests: 5 }), rec({ ws: "b", guests: 5 }), rec({ ws: "c", guests: 4 })];
  assert.equal(publicView(groupsOf(two, "city")[0], priors(two)), null); assert.equal(publicView(groupsOf(thin, "city")[0], priors(thin)), null);
  const ok = [rec({ ws: "a", guests: 5 }), rec({ ws: "b", guests: 5 }), rec({ ws: "c", guests: 5 })], v = publicView(groupsOf(ok, "city")[0], priors(ok));
  assert.equal(v.hosts, 3); assert.equal(v.guests, 15); assert.match(v.reason, /^Supper clubs in Brooklyn: 3 hosts, \d+% would go again this month$/); assert.match(v.sourceLine, /^Loved here: 15 guests, \d+% would go again$/);
  assert.equal(formatOf({ name: "Saturday 5k, coffee after" }), "run-coffee"); assert.equal(formatOf({ name: "Wheel night", activity: "pottery" }), "pottery-class"); assert.ok(FORMATS.length >= 25);
});
test("what never counts: private, friends-only, members-only, unlisted, examples, samples, previews, cancelled", () => {
  const base = { discoverable: true, date: "2026-11-01" }; assert.equal(countsPublicly(base), true);
  for (const x of [{ private: true }, { friendsOnly: true }, { visibility: "friends" }, { membersOnly: true }, { unlisted: true }, { example: true }, { sample: true }, { preview: true }, { cancelled: true }, { discoverable: false }]) assert.equal(countsPublicly({ ...base, ...x }), false, JSON.stringify(x));
  assert.equal(countsPublicly(base, true), false, "a fan club's members-only event");
});

// ---------- the API ----------
test("GET /api/public/trends: aggregates with plain reasons, the gate, exclusions, and nothing about anyone", async () => {
  const r = await get("/api/public/trends?city=Brooklyn"); assert.equal(r.status, 200); const t = await r.text(), j = JSON.parse(t);
  const F = j.ideas.map((x) => x.format); assert.ok(F.includes("supper-club"), t); assert.ok(F.includes("run-coffee"), t);
  assert.ok(!F.includes("mahjong"), "private, members-only, friends-only and example events never count"); assert.ok(!F.includes("game-night"), "two hosts is below the minimum");
  const sup = j.ideas.find((x) => x.format === "supper-club"); assert.equal(sup.hosts, 4); assert.equal(sup.guests, 24); assert.equal(sup.again, 80);
  assert.match(sup.reason, /^Supper clubs in Brooklyn: 4 hosts, 80% would go again this month$/); assert.equal(sup.sourceLine, "Loved here: 24 guests, 80% would go again"); assert.equal(sup.source, "platform");
  assert.doesNotMatch(t, PRIVATE_WORDS, "only aggregate counts leave the server"); assert.match(r.headers.get("cache-control"), /public/);
  for (const x of j.ideas) assert.deepEqual(Object.keys(x).sort(), ["again", "bestDay", "city", "events", "fill", "format", "guests", "hood", "hosts", "label", "period", "reason", "source", "sourceLine", "title", "type"]);
  const typed = await (await get("/api/public/trends?city=Brooklyn&type=active")).json(); assert.deepEqual(typed.ideas.map((x) => x.format), ["run-coffee"]);
  assert.equal((await (await get("/api/public/trends?city=Nowhere")).json()).ideas.length, 0);
  // the cache: a new event doesn't show until the hour is up (or the cache is cleared)
  await ev("ana", "trSupNew", { name: "Supper club", activity: "supper", date: day(-1) }); guests("ana", "trSupNew", 6, 6);
  assert.equal((await (await get("/api/public/trends?city=Brooklyn")).json()).ideas.find((x) => x.format === "supper-club").guests, 24, "cached");
  srv.app.locals.social.bust(); srv.app.locals.trends.bust(); assert.equal((await (await get("/api/public/trends?city=Brooklyn")).json()).ideas.find((x) => x.format === "supper-club").guests, 30);
});

// ---------- trend notes ----------
test("trend notes: 15 to 20 seeds in general terms, expiry after about 120 days, and admin-only changes", async () => {
  assert.ok(SEED_NOTES.length >= 15 && SEED_NOTES.length <= 20); assert.equal(NOTE_DAYS, 120);
  for (const n of SEED_NOTES) { assert.ok(n.name && n.line && n.where && n.seasons.length && n.added, n.id); assert.doesNotMatch(`${n.name} ${n.line} ${n.say}`, /\d+\s*%|percent|\u2014|partiful|tiktok|instagram|eventbrite/i, n.id); }
  const n0 = { ...SEED_NOTES[0], added: "2026-01-01" }; assert.equal(fresh(n0, Date.parse("2026-04-30")), true); assert.equal(fresh(n0, Date.parse("2026-05-02")), false, "older than 120 days drops out");
  const S = openStore(":memory:"), N = makeTrendNotes(S); assert.equal(N.active(Date.parse("2026-11-27")).length, SEED_NOTES.length); assert.equal(N.active(Date.parse("2027-06-01")).length, 0, "the whole seed expires by itself");
  assert.match(cleanNote({ name: "Big thing", line: "Up 300% on every app this week" }).error, /general/); assert.ok(cleanNote({ name: "Soup swap", line: "Two pots and bread for the cold months.", seasons: "winter" }).note);
  // admin routes: 404 for everyone else, signed out or in
  assert.equal((await get("/api/admin/trend-notes")).status, 404); assert.equal((await get("/api/admin/trend-notes", U.vic.cookie)).status, 404);
  assert.equal((await post("/api/admin/trend-notes", { name: "Soup swap", line: "Two pots and bread for the cold months." }, U.vic.cookie)).status, 404);
  const a = await post("/api/admin/trend-notes", { name: "Soup swap", line: "Two pots and bread for the cold months.", seasons: "autumn,winter", where: "social media" }, U.boss.cookie); assert.equal(a.status, 200); const id = (await a.json()).note.id;
  const L = await (await get("/api/admin/trend-notes", U.boss.cookie)).json(); assert.ok(L.notes.some((n) => n.id === id && n.active));
  assert.equal((await post(`/api/admin/trend-notes/${id}/retire`, {}, U.vic.cookie)).status, 404); assert.equal((await post(`/api/admin/trend-notes/${id}/retire`, {}, U.boss.cookie)).status, 200);
  assert.ok(!(await (await get("/api/admin/trend-notes", U.boss.cookie)).json()).notes.find((n) => n.id === id).active, "retired");
  assert.equal((await post("/api/admin/trend-notes", { name: "x", line: "y" }, U.boss.cookie)).status, 400);
});

// ---------- suggestions: ranking, labels, personalisation ----------
test("suggestions: platform first, then trend notes, then Potto, each with its own label", async () => {
  const r = await (await get("/api/public/ideas/suggest?city=Brooklyn&n=5")).json(); assert.equal(r.ideas.length, 5); assert.equal(r.more, true);
  assert.equal(r.ideas[0].source, "platform"); assert.match(r.ideas[0].sourceLine, /^Loved here: \d+ guests/);
  const order = { platform: 0, editorial: 1, potto: 2 }; for (let i = 1; i < r.ideas.length; i++) assert.ok(order[r.ideas[i].source] >= order[r.ideas[i - 1].source], "ranked by source");
  const all = []; for (let off = 0; off < 40; off += 5) { const p = await (await get(`/api/public/ideas/suggest?city=Brooklyn&n=5&offset=${off}`)).json(); all.push(...p.ideas); if (!p.more) break; }
  for (const x of all) assert.equal(x.sourceLine, x.source === "platform" ? x.sourceLine : SOURCE[x.source], x.title);
  assert.ok(all.some((x) => x.source === "editorial" && x.sourceLine === "Trending on social")); assert.ok(all.some((x) => x.source === "potto" && x.sourceLine === "An idea from Potto"));
  assert.ok(!all.some((x) => x.source !== "platform" && /\d+ guests|would go again/.test(x.sourceLine)), "never presented as measured");
  assert.equal(new Set(all.map((x) => x.format).filter(Boolean)).size, all.filter((x) => x.format).length, "one idea per format");
  // elsewhere: no platform data for the city, so notes lead
  const far = await (await get("/api/public/ideas/suggest?city=Nowhere&n=3")).json(); assert.ok(far.ideas.every((x) => x.source !== "platform" || /Loved on Pottery Lab/.test(x.sourceLine)));
  assert.equal((await (await get("/api/public/ideas/suggest?n=9")).json()).ideas.length, 5, "never more than 5 at a time");
});
test("personalisation: interests lift an idea a little, and what they just did never repeats", () => {
  const T = srv.app.locals.trends;
  const plain = T.suggest({ city: "Nowhere", n: 5 }).ideas, crafty = T.suggest({ city: "Nowhere", n: 5, interests: ["pottery", "crafts"] }).ideas;
  const pos = (L, f) => { const i = L.findIndex((x) => x.format === f); return i < 0 ? 99 : i; };
  assert.ok(pos(crafty, "craft-night") <= pos(plain, "craft-night"), "a crafty person sees craft nights sooner");
  assert.equal(crafty[0].source, plain[0].source, "lightly: the source order stays");
  const B = T.suggest({ city: "Brooklyn", n: 5, recent: ["run-coffee"] }).ideas; assert.ok(!B.some((x) => x.format === "run-coffee"), "no run right after a run");
  // Gus just hosted a run: his own suggestions skip runs
  const G = T.personOf({ email: U.gus.email, ws: U.gus.ws }); assert.ok(G.recent.includes("run-coffee")); assert.equal(G.city, "Brooklyn");
  assert.ok(!T.suggest({ ...G, n: 5 }).ideas.some((x) => x.format === "run-coffee"));
});
test("the Home card: top formats near the host with reasons, and how their run compared, only with enough data", async () => {
  assert.equal((await get("/api/me/trends/home")).status, 401);
  const j = await (await get("/api/me/trends/home", U.gus.cookie)).json(); assert.equal(j.city, "Brooklyn"); assert.ok(j.top.length >= 2 && j.top.length <= 3);
  assert.match(j.top[0].reason, /in Brooklyn: \d+ hosts/); assert.doesNotMatch(JSON.stringify(j), PRIVATE_WORDS);
  assert.deepEqual(j.compare, ["Your run had more repeat guests than most runs in Brooklyn this month"]);
  // with a higher bar, no comparison at all
  process.env.ENCORE_TRENDS_MIN_HOSTS = "9"; srv.app.locals.trends.bust(); const k = await (await get("/api/me/trends/home", U.gus.cookie)).json(); delete process.env.ENCORE_TRENDS_MIN_HOSTS; srv.app.locals.trends.bust();
  assert.deepEqual(k.compare, []); assert.deepEqual(k.top, []);
});

// ---------- where Potto uses it ----------
test("Potto uses it: chat, text, the ideas row, the swipe deck, the feed card, Watching, the canvas, /start and Home", async () => {
  // Ask Potto: the context carries labelled ideas, and the plain rules answer with them
  const ctx = { today: day(0), me: { host: true }, ideas: srv.app.locals.trends.forPotto({ email: U.vic.email, ws: U.vic.ws }) };
  const a = pottoReply("what should I host?", ctx, { mode: "offline" }); assert.equal(a.intent, "ideas"); assert.match(a.answer, /Loved (here|on Pottery Lab): \d+ guests/); assert.match(a.answer, /\((Trending on social|An idea from Potto)\)/);
  const r = await post("/api/potto/ask", { message: "Any ideas for what to host next?" }, U.vic.cookie); const b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); assert.match(b.answer, /Loved here|Trending on social|An idea from Potto/);
  assert.match(srv.app.locals.potto.lastPrompt, /"ideas":\[/); assert.match(srv.app.locals.potto.lastPrompt, /Only ideas with source "platform" are measured/);
  // Potto by text
  assert.equal(readIntent("what should I host?", { today: day(0) }).intent, "ideas"); assert.equal(readIntent("any ideas to host this weekend", { today: day(0) }).intent, "ideas");
  const T = srv.app.locals.pottoText; assert.ok(T?.ideasText, "the text intent's answer"); const txt = T.ideasText({ email: U.gus.email, ws: U.gus.ws, name: "Gus Kim" }).text; assert.match(txt, /Loved here|Trending on social|An idea from Potto/); assert.ok(txt.length <= 600);
  // "Ideas to try" (public/ideasnudge.js) and the swipe deck carry the labels too
  const lb = await (await get("/api/public/ideas/labels?city=Brooklyn&titles=" + encodeURIComponent("Supper club for 8|Mahjong night|Sunrise hike"))).json();
  assert.deepEqual(lb.labels.map((x) => x.source), ["platform", "editorial", "potto"]); assert.match(lb.labels[0].sourceLine, /^Loved here: \d+ guests/);
  const tr = await (await get("/api/public/ideas/try?n=4&city=Brooklyn")).json(); assert.ok(tr.ideas.every((x) => /^idea-/.test(x.id) && x.sourceLine), JSON.stringify(tr));
  const dk = await (await get("/api/public/deck?city=Brooklyn")).json(); const ideaCards = dk.cards.filter((c) => c.kind === "idea"); assert.ok(ideaCards.length && ideaCards.every((c) => c.sourceLine), "deck ideas are labelled");
  // the feed's ideas card says where its ideas come from
  const fd = await (await get("/api/public/feed?city=Brooklyn")).json(); const card = (fd.blend?.items || []).find((x) => x.kind === "ideas"); assert.ok(card?.sourceLine && card.head, JSON.stringify(card));
  const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
  assert.match(read("public/feedvisual.js"), /x\.head \|\| "Small formats people loved"/); assert.match(read("public/swipedeck.js"), /c\.sourceLine \|\| "An idea to try"/);
  assert.match(read("public/feed.html"), /\/api\/public\/trends\?n=2&city=/); assert.match(read("public/canvas.js"), /PLTrendIdeas\?\.mount/); assert.match(read("public/start.html"), /PLTrendIdeas/);
  assert.match(read("index.html"), /<script src="\/trendideas\.js" defer><\/script>/); assert.match(read("public/trendideas.js"), /suggestFor/); assert.match(read("public/canvas.js"), /extra: root\.PLTrendIdeas\?\.bank\?\.\(\)/, "the autocomplete bank takes Potto's ideas");
  // house rules on the new files: no em dashes
  for (const f of ["server/trends.js", "server/trendnotes.js", "public/trendideas.js"]) { const t = read(f); assert.doesNotMatch(t, /\u2014/, f + ": no em dashes"); }
  const idx = read("index.html"); assert.match(idx.slice(idx.lastIndexOf("<script")), /comewith\.js/, "the Come with me? loader stays the last script");
});

// ---------- the browser ----------
test("browser at 390: the canvas shows labelled ideas, Use this fills the title, and Home shows What's working near you", { timeout: 120000 }, async (t) => {
  let chromium; try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch { return t.skip("playwright is not installed"); }
  let browser; try { browser = await chromium.launch(); } catch { return t.skip("no Chromium here"); }
  fs.mkdirSync(SHOTS, { recursive: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
    await ctx.addCookies(U.gus.cookie.split("; ").map((kv) => { const i = kv.indexOf("="); return { name: kv.slice(0, i), value: kv.slice(i + 1), url: srv.base }; }));
    await ctx.addInitScript(() => { try { localStorage.setItem("encore.city", "Brooklyn"); } catch {} });
    const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(srv.base + "/?app=1#programs", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ptiHome .pti", { timeout: 20000 });
    await page.waitForSelector("#ideaLib .pti-s", { timeout: 20000 }).catch(() => {}); const shelf = await page.$$eval("#ideaLib [data-casualidea]", (L) => L.map((c) => c.querySelector(".pti-s")?.textContent || ""));
    assert.ok(shelf.length === 0 || shelf.every((t) => /^(Loved here: \d+ guests|Trending on social|An idea from Potto)/.test(t)), "Home's idea shelf carries source lines: " + shelf.join(" | "));
    const home = await page.$eval("#ptiHome", (el) => el.innerText); assert.match(home, /What's working near you/); assert.match(home, /in Brooklyn: \d+ hosts/); assert.match(home, /more repeat guests than most runs in Brooklyn/);
    const tap = await page.$eval("#ptiHome .pti-use", (b) => { const r = b.getBoundingClientRect(); return [r.width, r.height]; }); assert.ok(tap[0] >= 44 && tap[1] >= 44, "44px targets");
    await page.evaluate(() => document.querySelectorAll(".hl-sheet-bg").forEach((x) => x.remove()));
    await page.$eval("#ptiHome", (el) => el.scrollIntoView({ block: "center" })); await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, "home-card-390.png") });
    await page.evaluate(() => window.EventCanvas.open({ mode: "new" }));
    await page.waitForSelector("#cvIdeasD:not([hidden])", { timeout: 20000 }); assert.equal(await page.$eval("#cvIdeasD", (d) => d.open), false, "ideas start closed, so the invite is first"); await page.click("#cvIdeasD > summary");
    await page.waitForSelector("#cvIdeas .pti-use", { timeout: 20000 });
    await page.waitForFunction(() => (window.PLTrendIdeas?.bank?.() || []).length > 0, null, { timeout: 10000 }); // the autocomplete bank has them too
    assert.ok(await page.evaluate(() => window.PLTrendIdeas.bank().every((x) => x.t && x.hint)), "each bank idea carries its source as the hint");
    const txt = await page.$eval("#cvIdeas", (el) => el.innerText); assert.match(txt, /Loved here: \d+ guests/); assert.match(txt, /Trending on social|An idea from Potto/);
    const font = await page.$eval("#cvIdeas .pti-t b", (b) => getComputedStyle(b).fontFamily); assert.match(font, /Plex/i);
    const radius = await page.$eval("#cvIdeas .pti", (b) => getComputedStyle(b).borderRadius); assert.equal(radius, "6px");
    const [fg, bg] = await page.$eval("#cvIdeas .pti-use", (b) => [getComputedStyle(b).color, getComputedStyle(b).backgroundColor]); assert.equal(fg, "rgb(255, 255, 255)", "white on ink blue"); assert.notEqual(bg, fg);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert.ok(over <= 1, "no sideways scroll");
    const calm = () => page.evaluate(() => document.querySelectorAll(".hl-sheet-bg").forEach((x) => x.remove())); // the host loop's celebration sheet, not ours
    await calm(); await page.$eval("#cvIdeas", (el) => el.scrollIntoView({ block: "start" })); await page.waitForTimeout(300); await calm();
    await page.screenshot({ path: path.join(SHOTS, "canvas-ideas-390.png") });
    await calm(); await page.click("#cvIdeas [data-pti-more]"); await page.waitForFunction(() => document.querySelector("#cvIdeas [data-pti-more]") && !document.querySelector("#cvIdeas [data-pti-more]").disabled);
    await calm(); await page.click("#cvIdeas .pti-use"); await page.waitForTimeout(400); await calm();
    const title = await page.$eval("#cvTitle", (el) => el.value); assert.ok(title.length > 2, "Use this fills the title");
    await page.screenshot({ path: path.join(SHOTS, "canvas-after-pick-390.png") });
    assert.deepEqual(errs, []);
  } finally { await browser.close(); }
});
