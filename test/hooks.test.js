// Hooks for new people (server/hooks.js): interests, Inspo, saves and boards, reminders, friends going, the digest, the passport.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore } from "../server/workspaces.js";
import { fakeOutbox } from "../server/email.js";
import { weekendOf } from "../server/hooks.js";

let srv;
const J = { "Content-Type": "application/json" };
const req = (method, path, body, cookie) => fetch(srv.base + path, { method, headers: { ...J, ...(cookie ? { cookie } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const post = (path, body, cookie) => req("POST", path, body, cookie);
const put = (path, body, cookie) => req("PUT", "/api/db/doc?path=" + path, body, cookie);
const get = async (path, cookie) => { const r = await fetch(srv.base + path, { headers: cookie ? { cookie } : {} }); assert.equal(r.status, 200, path); return r.json(); };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const wsOf = (handle) => srv.store.get("system/handle-" + handle).data.ws;
const X = () => srv.app.locals.social, H = () => srv.app.locals.hooks;
let n = 0;
async function account(name, email) { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200, "signup " + email); return r.headers.get("set-cookie").split(";")[0]; }
async function host(email, handle, name, extra = {}) { const c = await account(name, email);
  const p = await post("/api/host/profile", { handle, name, tagline: "Small things for new friends.", emoji: "🍜", city: "Brooklyn", hood: "Bed-Stuy", ...extra }, c); assert.ok(p.ok, "profile " + handle); return c; }
const rsvp = (handle, eventId, r) => scopeStore(srv.store, wsOf(handle)).set("rsvps/r" + ++n, { eventId, response: "going", createdAt: Date.now(), ...r });
// the next Thursday from today (today if it is one), at 3pm UTC
const nextThursday = () => { for (let i = 0; i < 7; i++) { const d = day(i); if (new Date(d + "T12:00:00Z").getUTCDay() === 4) return Date.parse(d + "T15:00:00Z"); } };

let runner, supper, viewer;
before(async () => {
  process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "hooks-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "200"; process.env.ENCORE_DIRECTORY_CACHE_MS = "0"; process.env.ENCORE_FAKE_EMAIL = "1"; resetLoginLimits();
  srv = await startServer();
  runner = await host("rae.hooks@example.com", "rae-runs", "Rae's Run Club", { tags: ["run club", "coffee"], tagline: "A no-drop 5K and coffee after." });
  supper = await host("sol.hooks@example.com", "sol-supper", "Sol's Supper Club", { city: "Austin", hood: "East Austin", tags: ["supper club"] });
  const up = { startTime: "08:00", city: "Brooklyn", hood: "Bed-Stuy", headcount: 12, discoverable: true };
  assert.ok((await put("events/hkRun", { ...up, date: day(9), name: "Prospect Park 5k", activity: "run", free: true, coverPhoto: "/presets/atelier-bo-apt-cafe-club.jpg" }, runner)).ok);
  assert.ok((await put("events/hkRunLook", { ...up, date: day(12), name: "Sunset run", activity: "run", look: { palette: ["#A9C3A4", "#3E6B48", "#F2D36B"], effect: "sparkles", titleFont: "rounded", buttonEmoji: "🌿", buttonLabel: "Count me in" } }, runner)).ok);
  assert.ok((await put("events/hkLink", { ...up, date: day(10), name: "SECRET-LINK-ONLY birthday", discoverable: false, published: true, coverPhoto: "/presets/atelier-bo-banh-bo-popup.jpg" }, runner)).ok);
  assert.ok((await put("events/hkUnl", { ...up, date: day(11), name: "UNLISTED-brunch", unlisted: true }, runner)).ok);
  assert.ok((await put("events/hkPast", { ...up, date: day(-6), name: "Bagel run", activity: "run" }, runner)).ok);
  assert.ok((await put("events/hkHidden", { ...up, date: day(13), name: "Quiet run", activity: "run", hideGuests: true }, runner)).ok);
  assert.ok((await put("events/hkSupper", { ...up, city: "Austin", hood: "East Austin", date: day(15), startTime: "19:00", name: "Dumpling supper", activity: "dinner", price: "$45" }, supper)).ok);
  // a guest-only photo on the past run (moments): never public
  scopeStore(srv.store, wsOf("rae-runs")).set("moments/m1", { eventId: "hkPast", authorEmail: "g@example.com", url: "/_blob/MOMENTPRIVATE0000000", type: "image", at: Date.now() });
  // a scrapbook event with photos the host put on their page
  const sb = await (await post("/api/host/scrapbook/add", { drafts: [{ title: "Winter trail run", date: "2025-12-14", place: "Brooklyn, New York", cover: "/_blob/SCRAPBOOKPHOTO000001" }] }, runner)).json();
  assert.equal(sb.added.length, 1, "scrapbook add");
  viewer = await account("Vee Viewer", "vee.hooks@example.com");
});
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_DIRECTORY_CACHE_MS", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv.close(); });

test("Interests are saved on the account and drive host suggestions", async () => {
  assert.equal((await req("PUT", "/api/me/interests", { interests: ["run"] })).status, 401, "signed out: the browser keeps them");
  const r = await (await req("PUT", "/api/me/interests", { interests: ["run", "coffee", "not-a-thing"], city: "Brooklyn" }, viewer)).json();
  assert.deepEqual(r.interests, ["run", "coffee"], "unknown chips dropped"); assert.equal(r.city, "Brooklyn");
  assert.deepEqual((await get("/api/me/interests", viewer)).interests, ["run", "coffee"]);
  const S = await get("/api/public/suggest/hosts?interests=run&city=Brooklyn");
  assert.equal(S.hosts[0].handle, "rae-runs", "the run host in Brooklyn comes first"); assert.equal(S.hosts[0].example, false); assert.match(S.hosts[0].why, /Run clubs/);
  assert.ok(!S.hosts.some((h) => h.handle === "sol-supper"), "an Austin supper club isn't a match for runs in Brooklyn");
  for (const h of S.hosts) if (h.handle !== "rae-runs") assert.equal(h.example, true, "anything else filling in is labelled an example");
  const A = await get("/api/public/suggest/hosts?interests=supper&city=Austin"); assert.equal(A.hosts[0].handle, "sol-supper");
});

test("Inspo shows only public content: listed events, host page photos, ideas", async () => {
  const all = []; let cursor = ""; for (let i = 0; i < 20; i++) { const p = await get(`/api/public/inspo?limit=60&cursor=${cursor}`); all.push(...p.data); if (!p.next_cursor) break; cursor = p.next_cursor; }
  const txt = JSON.stringify(all);
  for (const bad of ["SECRET-LINK-ONLY", "UNLISTED-brunch", "MOMENTPRIVATE", "atelier-bo-banh-bo-popup.jpg\",\"title\":\"SECRET"]) assert.ok(!txt.includes(bad), bad + " stays out");
  assert.ok(!all.some((x) => x.save.ref === "hkLink" || x.save.ref === "hkUnl"));
  const photo = all.find((x) => x.id === "ev-hkRun"); assert.equal(photo.type, "photo"); assert.equal(photo.img, "/presets/atelier-bo-apt-cafe-club.jpg"); assert.equal(photo.real.url, "/e/hkRun"); assert.equal(photo.host.handle, "rae-runs"); assert.ok(photo.tags.includes("run"));
  const flyer = all.find((x) => x.id === "fl-hkRunLook"); assert.equal(flyer.type, "flyer"); assert.deepEqual(flyer.look.palette, ["#A9C3A4", "#3E6B48", "#F2D36B"]);
  assert.ok(all.some((x) => x.type === "photo" && x.img === "/_blob/SCRAPBOOKPHOTO000001" && x.status === "past"), "a scrapbook photo from the host's page");
  const ideas = all.filter((x) => x.type === "idea"); assert.ok(ideas.length >= 20, "the ideas library"); for (const x of ideas) { assert.equal(x.host, null); assert.equal(x.real, null); assert.ok(x.art.kind && x.hostThis.say); }
  assert.ok(ideas.some((x) => x.title === "Saturday Run Club"), "ideas from the app's Steal an idea shelf");
  for (const x of all) for (const k of ["id", "type", "title", "line", "tags", "save", "saves", "example"]) assert.ok(k in x, k);
  // interests rank, a chip filters
  const R = await get("/api/public/inspo?interests=supper&city=Austin&limit=5"); assert.ok(R.data.slice(0, 5).some((x) => x.save.ref === "hkSupper"));
  const T = await get("/api/public/inspo?tag=pottery&limit=60"); assert.ok(T.data.length && T.data.every((x) => x.tags.includes("pottery")));
  assert.equal((await get("/api/public/inspo/item?id=idea-saturday-run-club")).data.title, "Saturday Run Club");
});

test("A visitor's saves come with them when they sign up", async () => {
  const c = await account("Nia New", "nia.hooks@example.com");
  const local = [{ kind: "event", ref: "hkRun", at: Date.now() - 5000 }, { kind: "event", ref: "hkSupper" }, { kind: "idea", ref: "idea-saturday-run-club" }, { kind: "host", ref: "rae-runs" }, { kind: "idea", ref: "idea-supper-club-for-8" }, { kind: "evil", ref: "x" }, { kind: "event", ref: "../../etc" }];
  const m = await (await post("/api/me/saves", { merge: local }, c)).json(); assert.equal(m.merged, 5, "five valid saves came over"); assert.equal(m.total, 5);
  assert.equal((await (await post("/api/me/saves", { merge: local }, c)).json()).merged, 0, "merging twice adds nothing");
  const S = await get("/api/me/saves", c); assert.equal(S.items.length, 5);
  assert.equal(S.items.find((i) => i.ref === "hkRun").title, "Prospect Park 5k", "titles come from the event itself"); assert.equal(S.items.find((i) => i.kind === "host").title, "Rae's Run Club");
  // boards
  const b = await (await post("/api/me/boards", { name: "Spring supper club" }, c)).json(); assert.ok(b.board.id);
  assert.ok((await post("/api/me/saves", { kind: "event", ref: "hkSupper", board: b.board.id }, c)).ok);
  const S2 = await get("/api/me/saves", c); assert.equal(S2.boards[0].count, 1); assert.equal(S2.items.find((i) => i.ref === "hkSupper").board, b.board.id);
  assert.equal((await post("/api/me/saves", { kind: "event", ref: "hkRun" })).status, 401, "signed out: saves live in the browser");
});

test("Save counts are real saves on accounts", async () => {
  const a = await account("Cam Count", "cam.hooks@example.com"), b = await account("Dee Count", "dee.hooks@example.com");
  const before = (await get("/api/public/saves/counts?keys=event:hkRunLook")).counts["event:hkRunLook"] || 0;
  assert.equal((await (await post("/api/me/saves", { kind: "event", ref: "hkRunLook" }, a)).json()).count, before + 1);
  await post("/api/me/saves", { kind: "event", ref: "hkRunLook" }, a); // twice by one person counts once
  await post("/api/me/saves", { kind: "event", ref: "hkRunLook" }, b);
  assert.equal((await get("/api/public/saves/counts?keys=event:hkRunLook,idea:idea-nope")).counts["event:hkRunLook"], before + 2);
  assert.equal((await get("/api/public/inspo/item?id=fl-hkRunLook")).data.saves, before + 2);
  assert.equal((await (await req("DELETE", "/api/me/saves?kind=event&ref=hkRunLook", undefined, b)).json()).count, before + 1);
  assert.deepEqual((await get("/api/public/saves/counts?keys=event:never-saved")).counts, {}, "nothing saved, no number");
});

test("A saved event two days out gets one reminder", async () => {
  const c = await account("Ree Mind", "ree.hooks@example.com");
  assert.ok((await put("events/hkSoon", { date: day(2), startTime: "10:00", city: "Brooklyn", hood: "Bed-Stuy", headcount: 5, discoverable: true, name: "Soon matcha", activity: "matcha" }, runner)).ok);
  rsvp("rae-runs", "hkSoon", { name: "Some One", email: "some.one@example.com", party: 2 });
  await post("/api/me/saves", { kind: "event", ref: "hkSoon" }, c);
  const sent = fakeOutbox.length, r1 = await H().runJobs(Date.now(), srv.base); assert.ok(r1.reminders >= 1);
  const r2 = await H().runJobs(Date.now(), srv.base);
  const inbox = X().inbox("ree.hooks@example.com").filter((x) => x.kind === "saved"); assert.equal(inbox.length, 1, "once");
  assert.match(inbox[0].text, new RegExp(`^Your saved event is ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(day(2) + "T12:00:00Z").getUTCDay()]}: Soon matcha\\. Spots left: 3\\.$`));
  const mails = fakeOutbox.slice(sent).filter((m) => m.to.includes("ree.hooks@example.com")); assert.equal(mails.length, 1, "one email"); assert.match(mails[0].text, /Unsubscribe/, "guest list mail: unsubscribe works");
  assert.equal(r2.reminders, 0);
});

test("Friends going: only people you follow, only on public events, only names already shown", async () => {
  const v = "vee.hooks@example.com"; await account("Ana Ruiz", "ana.hooks@example.com"); await account("Ben Hidden", "ben.hooks@example.com");
  X().addFriend(v, "ana.hooks@example.com"); X().addFriend(v, "ben.hooks@example.com");
  rsvp("rae-runs", "hkRun", { name: "Ana Ruiz", email: "ana.hooks@example.com" });
  rsvp("rae-runs", "hkRun", { name: "Ben Hidden", email: "ben.hooks@example.com", showMe: false });
  rsvp("rae-runs", "hkRun", { name: "Stranger Danger", email: "stranger.hooks@example.com" });
  rsvp("rae-runs", "hkLink", { name: "Ana Ruiz", email: "ana.hooks@example.com" });
  rsvp("rae-runs", "hkHidden", { name: "Ana Ruiz", email: "ana.hooks@example.com" });
  rsvp("rae-runs", "hkUnl", { name: "Ana Ruiz", email: "ana.hooks@example.com" });
  const F = (await get("/api/me/friends-going?ids=hkRun,hkLink,hkHidden,hkUnl", viewer)).events;
  assert.deepEqual(Object.keys(F), ["hkRun"], "link-only, unlisted and hidden guest lists stay out");
  assert.deepEqual(F.hkRun.people.map((p) => p.name), ["Ana"]); assert.equal(F.hkRun.line, "Ana is in");
  assert.ok(!JSON.stringify(F).includes("Ben") && !JSON.stringify(F).includes("Stranger") && !JSON.stringify(F).includes("@"), "no hidden names, strangers or emails");
  assert.deepEqual((await get("/api/me/friends-going?ids=hkRun")).events, {}, "signed out: nothing");
  // following a host counts too: the host's own reply shows
  await post("/api/public/follow", { handle: "sol-supper" }, viewer);
  rsvp("rae-runs", "hkRun", { name: "Sol Ortiz", email: "sol.hooks@example.com" }); rsvp("rae-runs", "hkRun", { name: "Ana Ruiz", email: "ana.hooks@example.com" });
  const F2 = (await get("/api/me/friends-going?ids=hkRun", viewer)).events.hkRun; assert.equal(F2.count, 2); assert.equal(F2.line, "Ana and Sol are in");
});

test("The weekend digest skips when nothing matches, and sends once when something does", async () => {
  const thu = nextThursday(), W = weekendOf(thu); assert.equal(new Date(W.from + "T12:00:00Z").getUTCDay(), 5);
  const c = await account("Dig Est", "dig.hooks@example.com"); await req("PUT", "/api/me/interests", { interests: ["improv"], city: "Reykjavik" }, c);
  const r1 = await H().runJobs(thu, srv.base); assert.ok(r1.skipped >= 1);
  assert.equal(X().inbox("dig.hooks@example.com").filter((x) => x.kind === "digest").length, 0, "nothing matched: nothing sent");
  assert.ok((await put("events/hkImprov", { date: addDay(W.from, 1), startTime: "19:00", city: "Reykjavik", discoverable: true, name: "Improv jam", activity: "improv" }, supper)).ok);
  const sent = fakeOutbox.length; await H().runJobs(thu, srv.base); await H().runJobs(thu, srv.base);
  const D = X().inbox("dig.hooks@example.com").filter((x) => x.kind === "digest"); assert.equal(D.length, 1); assert.match(D[0].text, /^This weekend near you: Improv jam/);
  const mails = fakeOutbox.slice(sent).filter((m) => m.to.includes("dig.hooks@example.com")); assert.equal(mails.length, 1); assert.match(mails[0].text, /Unsubscribe/);
  const wed = thu - 864e5; const before = X().inbox("dig.hooks@example.com").length; await H().runJobs(wed, srv.base); assert.equal(X().inbox("dig.hooks@example.com").length, before, "only Thursday or Friday");
});
const addDay = (d, k) => new Date(Date.parse(d + "T12:00:00Z") + k * 864e5).toISOString().slice(0, 10);

test("Passport: locked until a first reply or kudos, then stamps, hosts and kudos", async () => {
  const c = await account("Pia Pass", "pia.hooks@example.com");
  const P0 = await get("/api/me/passport", c); assert.equal(P0.unlocked, false); assert.deepEqual(P0.stamps, []);
  rsvp("rae-runs", "hkPast", { name: "Pia Pass", email: "pia.hooks@example.com", createdAt: Date.now() - 9 * 864e5 });
  rsvp("rae-runs", "hkRunLook", { name: "Pia Pass", email: "pia.hooks@example.com" });
  scopeStore(srv.store, wsOf("rae-runs")).set("kudos/kp1", { eventId: "hkPast", name: "Pia", email: "pia.hooks@example.com", love: "Great pace", tags: ["fun"], at: Date.now() });
  await post("/api/public/follow", { handle: "rae-runs" }, c); X().bust();
  const P = await get("/api/me/passport", c);
  assert.equal(P.unlocked, true); assert.equal(P.first, "Pia");
  assert.equal(P.stamps.length, 1); const s = P.stamps[0];
  for (const k of ["eventId", "title", "date", "activity", "interests", "host", "public", "url"]) assert.ok(k in s, k);
  assert.equal(s.title, "Bagel run"); assert.equal(s.activity, "run"); assert.equal(s.host.handle, "rae-runs"); assert.equal(s.public, true);
  assert.equal(P.next.length, 1, "the upcoming one is a stamp to come"); assert.deepEqual(P.hosts.map((h) => h.handle), ["rae-runs"]);
  assert.deepEqual(P.counts, { events: 1, coming: 1, hosts: 1, kudos: 1, kinds: 1 });
  assert.equal((await fetch(srv.base + "/api/me/passport")).status, 401);
});

test("The public inspo read is documented; private ones aren't", async () => {
  const O = await get("/api/v1/openapi.json"); assert.ok(O.paths["/api/public/inspo"]); assert.ok(!Object.keys(O.paths).some((p) => p.startsWith("/api/me")));
  const L = await (await fetch(srv.base + "/llms.txt")).text(); assert.match(L, /\/api\/public\/inspo/); assert.ok(!/\/api\/me\//.test(L));
  for (const p of ["/ideas", "/saved"]) assert.equal((await fetch(srv.base + p)).status, 200, p);
});
