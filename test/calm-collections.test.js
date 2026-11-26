// The calm loader (public/calm.js), collections (server/collections.js), host guides (server/guides.js) and your stats
// (server/stats.js): the loader's delay and still frame, who may sit on a shelf, guide progress, stats and their privacy.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { eligible, hostEligible, buildCollections, DEFS, MIN_REAL, loadOverrides } from "../server/collections.js";
import { GUIDES, progressOf, nextStepOf, linkOf } from "../server/guides.js";
import { guestStats, hostStats, publicOnly, cleanShow } from "../server/stats.js";

const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
const DAY = 864e5, iso = (t) => new Date(t).toISOString().slice(0, 10);
// a fixed Wednesday in late November, so "this weekend" and "winter" are known
const NOW = Date.parse("2026-11-25T15:00:00Z"), d = (n) => iso(NOW + n * DAY);
const ev = (id, { host: hh = "bo", ...o } = {}) => ({ id, title: o.title || id, status: "upcoming", start: o.start || d(3), time: o.time || "7pm", _start: o._start || "19:00", city: o.city || "New York", area: o.area || "", format: o.format || "other", tags: o.tags || [], comfort: o.comfort || [], comfort_labels: [], host: { handle: hh, name: "Bo" }, url: "/e/" + id, ...o });

// ---------------------------------------------------------------- the loader
test("the loader waits 300ms before it shows, so a fast load never flashes, and fades out softly", () => {
  const js = read("public/calm.js");
  assert.match(js, /const DELAY = 300\b/, "the delay is about 300ms");
  assert.match(js, /timer = setTimeout\(put, wait\)/, "the loader is put in only when the timer fires");
  assert.match(js, /clearTimeout\(timer\)/, "a wait that ends first cancels it, so nothing shows");
  assert.match(js, /wait = Math\.max\(0, delay - \(performance\.now\(\) - start\)\)/, "the delay counts from when the wait started");
  assert.match(js, /since: first \? 0 : null/, "on page load, the delay counts from the navigation, not from when this file ran");
  assert.match(js, /transition:opacity \$\{FADE\}ms ease/, "it fades in and out");
  assert.match(js, /fadeOver\(r, n\)/, "when the content lands, the loader fades over it instead of blinking away");
  for (const line of ["Setting the table…", "Warming up the feed…", "Finding your people…", "Opening the invite…"]) assert.ok(js.includes(line), line);
  assert.match(js, /role="status" aria-live="polite"/, "screen readers hear the line once, politely");
});

test("people who ask for less motion get a still frame: nothing turns, nothing fades", () => {
  const js = read("public/calm.js");
  assert.match(js, /@media \(prefers-reduced-motion:reduce\)\{\.plc,\.plc-fade\{transition:none\}\.plc \*\{animation:none!important\}/);
  assert.match(js, /if \(still\(\)\) node\.classList\.add\("on"\)/, "the still frame shows at once, with no fade-in");
  assert.match(js, /if \(!still\(\)\) fadeOver/, "and leaves without a fade");
  assert.match(js, /document\.startViewTransition && !still\(\)/, "in-page view changes skip the fade too");
  const craft = read("public/craft.css");
  assert.match(craft, /@view-transition\{navigation:auto\}/, "page-to-page fades where the browser has them");
  assert.match(craft, /@media \(prefers-reduced-motion:reduce\)\{@view-transition\{navigation:none\}\}/);
});

test("the main surfaces wait with the calm loader instead of a blank page or a spinner", () => {
  const hooks = { "public/feed.html": 'data-calm="feed"', "public/host.html": 'data-calm="host"', "public/invite.html": 'data-calm="invite"', "public/chats.html": 'data-calm="chats"', "public/discover.html": 'data-calm="discover"', "public/settings.html": 'data-calm="settings"', "public/collections.html": 'data-calm="collection"', "public/guides.html": 'data-calm="guide"', "public/stats.html": 'data-calm="stats"' };
  for (const [f, h] of Object.entries(hooks)) { const s = read(f); assert.ok(s.includes(h), f + " has its hook"); assert.match(s, /<script src="\/calm\.js"><\/script>/, f + " loads the loader before its own script"); }
  assert.match(read("public/authguard.js"), /s\.src = "\/calm\.js"/, "every other page gets it through authguard.js");
  assert.match(read("public/host.html"), /<p class="empty"[^>]*data-calm-wait>Loading…<\/p>/, "the old Loading… line is the wait marker, hidden by the loader");
  assert.ok(read("public/invite.html").length < 40000, "the light invite stays under its cap");
});

test("new files read plainly: no em dashes, no exclamation marks in copy", () => {
  for (const f of ["public/calm.js", "public/collections.js", "public/collections.html", "public/guides.js", "public/guides.html", "public/stats.js", "public/stats.html", "server/collections.js", "server/collections.json", "server/guides.js", "server/stats.js"]) {
    const s = read(f); assert.ok(!s.includes("—"), f + " has no em dash"); }
  for (const g of GUIDES) for (const t of [g.title, g.intro, g.short, ...g.steps.flatMap((s) => [s.title, s.body, s.label])]) assert.ok(!/!/.test(t), t);
});

// ---------------------------------------------------------------- collections
test("a shelf never shows private, unlisted, members-only, past, example or preview events", () => {
  const today = d(0);
  assert.equal(eligible(ev("ok"), {}, today), true);
  assert.equal(eligible(ev("p", { private: true }), {}, today), false, "private");
  assert.equal(eligible(ev("u", { unlisted: true }), {}, today), false, "unlisted");
  assert.equal(eligible(ev("m", { visibility: "members" }), {}, today), false, "members only");
  assert.equal(eligible(ev("x", { example: true }), {}, today), false, "an example event");
  assert.equal(eligible(ev("old", { start: d(-2) }), {}, today), false, "already happened");
  assert.equal(eligible(ev("past", { status: "past" }), {}, today), false);
  assert.equal(eligible(ev("pv"), { prepared: true }, today), false, "a preview page for a business that hasn't joined");
  assert.equal(eligible(ev("sm"), { example: true }, today), false, "a sample host");
  assert.equal(hostEligible({ handle: "a" }), true); assert.equal(hostEligible({ handle: "a", prepared: true }), false); assert.equal(hostEligible({ handle: "a", example: true }), false);
  const hosts = new Map([["preview-co", { handle: "preview-co", prepared: true }], ["bo", { handle: "bo" }]]);
  const L = buildCollections({ now: NOW, hosts, events: [ev("bg", { title: "Board game night" }), ev("bgp", { title: "Board game night", private: true }), ev("bgv", { title: "Board game night", host: "preview-co" }), ev("bgm", { title: "Board game night", visibility: "members" })] });
  assert.deepEqual(L.find((c) => c.id === "quiet-nerdy").events.map((e) => e.id), ["bg"]);
  for (const c of L) for (const e of c.events) assert.ok(!["bgp", "bgv", "bgm"].includes(e.id), `${e.id} is not on ${c.id}`);
});

test("shelves fill from tags, format, comfort notes, time and place", () => {
  const events = [
    ev("games", { title: "Catan and cocoa", tags: ["board games"], start: d(10) }),
    ev("hack", { title: "Thursday hack night", start: d(8), _start: "18:30" }),
    ev("books", { title: "Slow reading", format: "book club", start: d(12) }),
    ev("solo", { title: "Pottery for one", comfort: ["solo"], start: d(4) }),
    ev("dinner", { title: "Dumplings at home", format: "dinner", start: d(6) }),
    ev("sat", { title: "Morning walk", start: d(3), city: "Brooklyn", _start: "09:00" }),
    ev("satla", { title: "Taco crawl", start: d(4), city: "Los Angeles", _start: "12:00" }),
  ];
  const L = buildCollections({ now: NOW, events, city: "Brooklyn", tz: "America/New_York" }), by = (id) => L.find((c) => c.id === id);
  assert.deepEqual(by("quiet-nerdy").events.map((e) => e.id).sort(), ["books", "games", "hack"]);
  assert.ok(by("solo").events.some((e) => e.id === "solo"), "come alone friendly");
  assert.ok(by("eat-around").events.some((e) => e.id === "dinner") && by("eat-around").events.some((e) => e.id === "satla"));
  assert.deepEqual(by("weekend").events.map((e) => e.id), ["sat"], "this weekend, in your city");
  assert.equal(by("weekend").title, "This weekend near you");
  assert.equal(buildCollections({ now: NOW, events }).find((c) => c.id === "weekend").title, "This weekend", "no city: just this weekend");
  assert.ok(by("cozy-winter").events.some((e) => e.id === "games"), "an evening in late November is a cozy winter night");
  assert.ok(!by("cozy-winter").events.some((e) => e.id === "sat"), "a 9am walk isn't");
  // summer: the winter shelf sleeps
  assert.ok(!buildCollections({ now: Date.parse("2026-07-01T12:00:00Z"), events: [ev("g", { start: "2026-07-03" })] }).some((c) => c.id === "cozy-winter"));
});

test("thin shelves add ideas to host, clearly ideas; Most-loved hosts needs real would-go-again", () => {
  const L = buildCollections({ now: NOW, events: [ev("games", { title: "Board games" })], loved: [
    { handle: "bo", name: "Bo", againYes: 9, againOf: 10 }, { handle: "few", name: "Few", againYes: 2, againOf: 2 }, { handle: "meh", name: "Meh", againYes: 5, againOf: 10 }, { handle: "pv", name: "Preview", againYes: 10, againOf: 10, prepared: true }] });
  const nerdy = L.find((c) => c.id === "quiet-nerdy");
  assert.equal(nerdy.events.length, 1); assert.ok(nerdy.ideas.length > 0 && nerdy.ideas.length <= MIN_REAL - 1, "a few ideas, never more than make it four");
  assert.ok(nerdy.ideas.every((x) => x.id.startsWith("idea-")), "ideas are ideas, not events");
  const loved = L.find((c) => c.id === "loved-hosts");
  assert.deepEqual(loved.hosts.map((h) => h.handle), ["bo"], "3+ answers and 80%+ would go again; previews never");
  assert.equal(loved.hosts[0].again.text, "90% of 10 guests would go again");
});

test("the editorial file pins, leaves out, retitles and switches off shelves", () => {
  const O = { order: ["solo"], hidden: ["eat-around"], collections: { "quiet-nerdy": { pin: ["late"], exclude: ["noisy"], title: "Low volume" } } };
  const L = buildCollections({ now: NOW, overrides: O, events: [ev("early", { title: "Board games", start: d(2) }), ev("late", { title: "Chess club", start: d(20) }), ev("noisy", { title: "Trivia", start: d(1) })] });
  assert.equal(L[0].id, "solo", "order"); assert.ok(!L.some((c) => c.id === "eat-around"), "hidden");
  const q = L.find((c) => c.id === "quiet-nerdy"); assert.equal(q.title, "Low volume"); assert.deepEqual(q.events.map((e) => e.id), ["late", "early"]);
  const pinnedPrivate = buildCollections({ now: NOW, overrides: { collections: { "quiet-nerdy": { pin: ["sec"] } } }, events: [ev("sec", { title: "Secret", private: true })] });
  assert.equal(pinnedPrivate.find((c) => c.id === "quiet-nerdy").events.length, 0, "a pin never makes a private event public");
  const F = loadOverrides(); assert.ok(Array.isArray(F.order) && F.collections, "the shipped file reads");
  for (const id of F.order) assert.ok(DEFS.some((x) => x.id === id), id);
});

// ---------------------------------------------------------------- guides
test("guide progress: steps tick from real activity or by hand, and Home shows the next one", () => {
  const g = GUIDES.find((x) => x.id === "first-supper"); assert.equal(g.steps.length, 5);
  let p = progressOf(g, {}); assert.equal(p.done, 0); assert.equal(p.next.id, "event");
  p = progressOf(g, { events: 1, brandKit: true, shared: true }); assert.equal(p.done, 3); assert.equal(p.next.id, "guests"); assert.equal(p.steps[0].by, "auto");
  p = progressOf(g, { events: 1, brandKit: true, shared: true }, { "first-supper.guests": 1 }); assert.equal(p.done, 4); assert.equal(p.steps[3].by, "hand"); assert.equal(p.next.id, "kudos");
  p = progressOf(g, { events: 1, brandKit: true, shared: true, going: 3, kudos: 2 }); assert.ok(p.complete); assert.equal(p.next, null);
  const all = GUIDES.map((x) => progressOf(x, {}));
  assert.equal(nextStepOf(all, {}, { pastEvents: 0 }).guide.id, "first-supper", "a first-time host starts at the start");
  assert.equal(nextStepOf(all, {}, { pastEvents: 3 }).guide.id, "grow-regulars", "a host who has hosted grows regulars");
  assert.equal(nextStepOf(all, { "run-drop": 5, "game-night": 9 }, {}).guide.id, "game-night", "the guide started last leads");
  assert.equal(nextStepOf(GUIDES.map((x) => ({ ...progressOf(x, {}), complete: true })), {}, {}), null, "all done: no card");
  assert.equal(linkOf("{page}?edit=1", { handle: "bo" }), "/@bo?edit=1"); assert.equal(linkOf("{page}#kudos", {}), "/?app=1#programs", "no page yet: Home");
  assert.equal(linkOf("{event}", { eventId: "e1" }), "/e/e1?share=1"); assert.equal(linkOf("{event}", {}), "/?app=1&new=1#studio");
  for (const x of GUIDES) for (const s of x.steps) assert.ok(s.href && s.label && s.body, `${x.id}.${s.id} links to a real feature`);
});

// ---------------------------------------------------------------- stats (pure)
test("guest stats: real numbers only, zeros left out, a gentle monthly streak", () => {
  assert.deepEqual(guestStats({ now: NOW }), [], "nothing yet: nothing shown (the page shows an encouraging line)");
  const went = [{ eventId: "a", date: "2026-09-12", title: "Board game night", city: "New York", hood: "Williamsburg" }, { eventId: "b", date: "2026-10-03", title: "Supper club", city: "New York", hood: "Bushwick" },
    { eventId: "c", date: "2026-11-20", title: "Supper at Bo's", city: "New York", hood: "Bushwick" }, { eventId: "d", date: "2026-12-20", title: "Later", city: "Boston" }, { eventId: "a", date: "2026-09-12", title: "dupe" }];
  const S = guestStats({ went, following: [{ handle: "bo" }, { handle: "hoa" }], clubs: [{ club: "Bo's Regulars" }], given: [{ tags: ["again"] }, { tags: ["food"] }, { compare: "better" }], now: NOW }), by = (k) => S.find((x) => x.key === k);
  assert.equal(by("events").n, 3, "past events only, each once"); assert.equal(by("hosts").n, 2);
  assert.equal(by("places").n, 2); assert.equal(by("places").detail, "Williamsburg, Bushwick");
  assert.equal(by("again").n, 2); assert.equal(by("streak").n, 3); assert.equal(by("streak").line, "3 months in a row out with your people");
  assert.match(by("kinds").value, /Supper clubs/); assert.equal(by("clubs").n, 1);
  assert.ok(!guestStats({ went: [went[2]], now: NOW }).some((x) => x.key === "streak"), "one month isn't a streak yet");
  assert.ok(!S.some((x) => x.n === 0), "no zeros");
});

test("host stats: events, guests, regulars, would-go-again (counts under 10 answers) and a hosting streak", () => {
  assert.deepEqual(hostStats({}, { now: NOW }), []);
  const H = hostStats({ dates: ["2026-09-10", "2026-10-08", "2026-11-12", "2026-12-10"], guests: 24, returning: 7, againYes: 5, againOf: 6 }, { now: NOW, repeats: ["monthly"] }), by = (k) => H.find((x) => x.key === k);
  assert.equal(by("hosted").n, 3, "only nights that happened"); assert.equal(by("welcomed").n, 24); assert.equal(by("regulars").n, 7);
  assert.equal(by("againPct").line, "5 of 6 guests would go again"); assert.equal(by("againPct").pct, false);
  assert.equal(by("hostStreak").line, "Hosted 3 months in a row");
  assert.equal(hostStats({ dates: ["2026-11-01"], againYes: 18, againOf: 20 }, { now: NOW }).find((x) => x.key === "againPct").line, "90% of 20 guests would go again");
});

test("stats privacy: only picked, known keys go public", () => {
  const S = [{ key: "events", n: 3 }, { key: "places", n: 2 }, { key: "welcomed", n: 9 }];
  assert.deepEqual(publicOnly(S, []), [], "private by default");
  assert.deepEqual(publicOnly(S, ["places"]).map((x) => x.key), ["places"]);
  assert.deepEqual(cleanShow(["events", "email", "events", "__proto__", "regulars"]), ["events", "regulars"]);
});

// ---------------------------------------------------------------- through the server
let srv;
const J = { "content-type": "application/json" };
const post = (p, body, cookie, method = "POST") => fetch(srv.base + p, { method, headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body || {}) });
const getJ = async (p, cookie) => { const r = await fetch(srv.base + p, { headers: cookie ? { cookie } : {} }); return { status: r.status, body: await r.json().catch(() => null) }; };
const put = (path, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
let n = 0;
const person = async (name) => { const email = `${name.toLowerCase().replace(/\W+/g, "")}${++n}@example.com`; const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); const b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); return { cookie: cookieOf(r), ws: b.workspace.id, email, name }; };
const host = async (name, handle, o = {}) => { const h = await person(name); const r = await post("/api/host/profile", { handle, name, city: "New York", bio: "Small nights at home, for people who like a quiet table.", emoji: "🎲", ...o }, h.cookie); assert.equal(r.status, 200, await r.text()); return { ...h, handle }; };
const rsvp = (cookie, body) => fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, cookie }, body: JSON.stringify({ createdAt: Date.now(), response: "going", ...body }) }).then((r) => r.json());
const day = (k) => iso(Date.now() + k * DAY);

before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "calm-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "500"; process.env.ENCORE_FAKE_EMAIL = "1"; process.env.ENCORE_DIRECTORY_CACHE_MS = "0"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL", "ENCORE_DIRECTORY_CACHE_MS"]) delete process.env[k]; await srv.close(); });

test("collections through the API: public events land on shelves, private ones never do", async () => {
  const bo = await host("Bo Tran", "bo-shelf");
  assert.equal((await put("events/shelfgames", { name: "Board game night", pubTitle: "Board game night", kind: "social", casual: true, date: day(5), startTime: "19:00", city: "New York", discoverable: true, published: true, headcount: 8 }, bo.cookie)).status, 200);
  assert.equal((await put("events/shelfsecret", { name: "Secret board game night", pubTitle: "Secret board game night", kind: "social", casual: true, date: day(6), startTime: "19:00", city: "New York", discoverable: false, published: true, headcount: 8 }, bo.cookie)).status, 200);
  const { status, body } = await getJ("/api/public/collections");
  assert.equal(status, 200);
  const q = body.collections.find((c) => c.id === "quiet-nerdy"); assert.ok(q, JSON.stringify(body.collections.map((c) => c.id)));
  assert.ok(q.events.some((e) => e.id === "shelfgames")); assert.ok(!JSON.stringify(body).includes("shelfsecret"), "the private event is nowhere");
  const one = await getJ("/api/public/collections/quiet-nerdy"); assert.equal(one.status, 200); assert.ok(one.body.collection.intro); assert.ok(one.body.others.length >= 3);
  assert.equal((await getJ("/api/public/collections/nope")).status, 404);
  assert.equal((await fetch(srv.base + "/c/quiet-nerdy")).status, 200); assert.equal((await fetch(srv.base + "/c/nope")).status, 404);
  assert.match(await (await fetch(srv.base + "/discover")).text(), /id="plShelves"/, "Discover has its shelves");
});

test("guides through the API: per host, ticked by what they did, by hand where nothing tells us", async () => {
  assert.equal((await getJ("/api/host/guides")).status, 401);
  const h = await host("Ana Lee", "ana-guide"), other = await host("Oli Chen", "oli-guide");
  let v = (await getJ("/api/host/guides", h.cookie)).body; assert.equal(v.next.guide.id, "first-supper"); assert.equal(v.next.step.id, "event"); assert.equal(v.next.step.href, "/?app=1&new=1#studio");
  await put("events/anadinner", { name: "Supper at Ana's", kind: "social", casual: true, date: day(9), city: "New York", published: true }, h.cookie);
  v = (await getJ("/api/host/guides", h.cookie)).body; const fs1 = v.guides.find((g) => g.id === "first-supper");
  assert.equal(fs1.steps[0].done, true); assert.equal(fs1.steps[0].by, "auto"); assert.equal(fs1.steps[2].done, true, "a published event counts as shared");
  assert.equal(v.next.step.id, "look"); assert.equal(v.next.step.href, "/@ana-guide?edit=1");
  const r = await post("/api/host/guides/first-supper/steps/look", { done: true }, h.cookie); assert.equal(r.status, 200);
  v = (await getJ("/api/host/guides", h.cookie)).body; assert.equal(v.next.step.id, "guests"); assert.equal(v.guides.find((g) => g.id === "first-supper").done, 3);
  await post("/api/host/guides/first-supper/steps/look", { done: false }, h.cookie);
  assert.equal((await getJ("/api/host/guides", h.cookie)).body.next.step.id, "look", "and undone");
  assert.equal((await getJ("/api/host/guides", other.cookie)).body.next.step.id, "event", "progress is per host");
  await post("/api/host/guides/run-drop/start", {}, h.cookie); assert.equal((await getJ("/api/host/guides", h.cookie)).body.next.guide.id, "run-drop", "the guide you opened leads");
  assert.equal((await post("/api/host/guides/nope/start", {}, h.cookie)).status, 404);
  assert.equal((await post("/api/host/guides/first-supper/steps/nope", {}, h.cookie)).status, 404);
  assert.equal((await fetch(srv.base + "/guides/first-supper")).status, 200);
  assert.match(read("index.html"), /<script src="\/guides\.js" defer><\/script>/, "Home loads the next-step card");
});

test("stats through the API: yours to see, private until you pick, and only what you picked goes public", async () => {
  assert.equal((await getJ("/api/me/stats")).status, 401);
  const bo = await host("Bo Tran", "bo-stats"), sam = await person("Sam Diaz");
  await put("events/bostats1", { name: "Board game night", kind: "social", casual: true, date: day(-20), city: "New York", hood: "Bushwick", discoverable: true, published: true }, bo.cookie);
  await put("events/bostats2", { name: "Supper club", kind: "social", casual: true, date: day(-3), city: "New York", hood: "Ridgewood", discoverable: true, published: true }, bo.cookie);
  await rsvp(bo.cookie, { eventId: "bostats1", name: "Sam Diaz", email: sam.email, code: "S1" });
  const r2 = await rsvp(bo.cookie, { eventId: "bostats2", name: "Sam Diaz", email: sam.email, code: "S2" });
  await post("/api/me/following/bo-stats", { on: true }, sam.cookie);
  let me = (await getJ("/api/me/stats", sam.cookie)).body, by = (k) => me.guest.find((x) => x.key === k);
  assert.equal(by("events").n, 2); assert.equal(by("hosts").n, 1); assert.equal(by("places").n, 2); assert.deepEqual(me.show, [], "private by default");
  const hs = (await getJ("/api/me/stats", bo.cookie)).body; assert.equal(hs.host.find((x) => x.key === "hosted").n, 2); assert.equal(hs.host.find((x) => x.key === "welcomed").n, 1);
  // How was it? the supper three days ago, with Sam's own reply proof, until Sam leaves kudos
  let ci = (await getJ("/api/me/checkins", sam.cookie)).body.checkins; assert.equal(ci.length, 1); assert.equal(ci[0].eventId, "bostats2");
  assert.equal(ci[0].link, `/k/bostats2?rid=${encodeURIComponent(r2.id)}&code=S2`);
  const k = await post("/api/public/kudos", { eventId: "bostats2", rid: r2.id, code: "S2", tags: ["again"], love: "Lovely table." }); assert.equal(k.status, 200, await k.text());
  ci = (await getJ("/api/me/checkins", sam.cookie)).body.checkins; assert.equal(ci.length, 0, "kudos left: no more asking");
  // public: nothing until Bo picks
  assert.deepEqual((await getJ("/api/public/host/bo-stats/stats")).body.stats, []);
  const s = await post("/api/me/stats/show", { show: ["hosted", "email", "welcomed"] }, bo.cookie, "PUT"); assert.deepEqual((await s.json()).show, ["hosted", "welcomed"]);
  const pub = (await getJ("/api/public/host/bo-stats/stats")).body.stats; assert.deepEqual(pub.map((x) => x.key).sort(), ["hosted", "welcomed"]);
  assert.ok(!JSON.stringify(pub).includes("@"), "no emails");
  assert.match(read("public/chatnav.js"), /row\("\/me", "Your stats"/, "the Me sheet has Your stats");
  assert.match(read("public/host.html"), /<script src="\/stats\.js" defer><\/script>/);
});
