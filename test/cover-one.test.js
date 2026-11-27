// One cover per event, everywhere (server/cover.js, public/eventart.js spec and thumb): every surface that sends an
// event to draw (the invite, the feed, Discover, Plans, the host page, chats) carries the same cover, the host's photo
// or the same drawing's recipe, and the link preview picks its illustration from that recipe. Events from the New York
// run templates, a trip feeler, a drop with only an item photo, an event with no kind and one with a photo.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { coverOf } from "../server/eventcover.js";

let srv, host, guest; const J = { "content-type": "application/json" };
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "cover-one-secret-0123456789", ENCORE_FAKE_EMAIL: "1", ENCORE_SIGNUP_PER_HOUR: "200", ENCORE_RSVP_PER_HOUR: "500", ENCORE_RSVP_IP_PER_HOUR: "500" };
const cookieOf = (r) => (r.headers.get("set-cookie") || "").split(";")[0];
const post = (p, body, cookie) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = async (p, cookie) => (await fetch(srv.base + p, { headers: cookie ? { cookie } : {} })).json();
const put = (p, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + p, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const join = async (name, email) => { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200); return { cookie: cookieOf(r), email, name }; };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const ev = (o) => ({ kind: "social", casual: true, city: "Brooklyn", hood: "Fort Greene", startTime: "08:00", headcount: 12, published: true, discoverable: true, ...o });
const reply = async (id, key) => { const doc = await (await fetch(srv.base + "/api/db/doc?path=events/" + id, { headers: { "x-encore-guest": "1" } })).json();
  const r = await fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, "x-encore-guest": "1", "x-encore-key": key, "x-encore-workspace": doc.workspace, cookie: guest.cookie }, body: JSON.stringify({ eventId: id, response: "going", name: guest.name, email: guest.email, code: "C" + key.slice(-5).toUpperCase(), createdAt: Date.now(), via: "invite-lite" }) });
  assert.ok(r.ok, "reply " + id + " " + r.status); };

const IDS = {};
before(async () => { Object.assign(process.env, ENV); srv = await startServer(); host = await join("Madison Lee", "madison.cover@example.com"); guest = await join("Sam Ortiz", "sam.cover@example.com");
  assert.ok((await post("/api/host/profile", { handle: "madison-runs", name: "Madison", city: "Brooklyn", hood: "Fort Greene", tagline: "Runs and coffee." }, host.cookie)).ok);
  // the run the owner saw: a run with coffee after, the coffee emoji set, no kind
  assert.ok((await put("events/cvRun01", ev({ name: "Run club, coffee after", activity: "run", emoji: "☕", meetPoint: "Grand Army Plaza", date: day(3) }), host.cookie)).ok); IDS.run = "cvRun01";
  // from the New York run templates (public/runtemplates.js sets coverArt: run with a tone)
  assert.ok((await put("events/cvTpl01", ev({ name: "Easy 5K in Prospect Park", activity: "run", coverArt: { kind: "run", tone: "sky" }, runTpl: "pp-easy-5k", date: day(4) }), host.cookie)).ok); IDS.tpl = "cvTpl01";
  // nothing to go on: no kind, no activity
  assert.ok((await put("events/cvNone1", ev({ name: "Saturday thing", date: day(5) }), host.cookie)).ok); IDS.none = "cvNone1";
  // the host's photo, with its focus point
  assert.ok((await put("events/cvPhot1", ev({ name: "Dumpling night", activity: "dinner", coverPhoto: "https://example.com/dumplings.jpg", coverFocus: { x: 30, y: 70 }, date: day(6) }), host.cookie)).ok); IDS.photo = "cvPhot1";
  // a trip feeler (server/trips.js): no date yet
  const tr = await (await post("/api/host/trips", { say: "Vegas for a 30th, sometime in March" }, host.cookie)).json(); IDS.trip = tr.id;
  const yr = new Date().getFullYear() + 1; assert.ok((await post(`/api/host/trips/${tr.id}/feeler`, { destination: "Las Vegas", weekends: [{ from: `${yr}-03-12`, to: `${yr}-03-14` }], publish: true }, host.cookie)).ok);
  await post("/api/public/follow", { handle: "madison-runs", email: guest.email, name: guest.name }, guest.cookie);
  for (const [k, id] of Object.entries(IDS)) if (k !== "trip") await reply(id, "kcover" + k.padEnd(6, "x"));
});
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

const stored = async (id) => (await (await fetch(srv.base + "/api/db/doc?path=events/" + id, { headers: { cookie: host.cookie } })).json()).data;
const find = (list, id) => (list || []).find((x) => x && (x.id === id || x.eventId === id || x.ref === id || x.ev === id));

test("an event's cover is one source: the photo with its focus, or the drawing's recipe, never an emoji", async () => {
  const run = coverOf(await stored(IDS.run), IDS.run);
  assert.equal(run.art.kind.split("+")[0], "run", "a run with coffee after is a run, not a coffee: " + JSON.stringify(run));
  assert.deepEqual(coverOf(await stored(IDS.tpl), IDS.tpl).art.tone, "sky", "a template's tone stays");
  assert.ok(coverOf(await stored(IDS.none), IDS.none).art.kind, "no kind still draws something");
  assert.deepEqual(coverOf(await stored(IDS.photo), IDS.photo), { photo: "https://example.com/dumplings.jpg", focus: { x: 30, y: 70 } });
  assert.deepEqual(coverOf({ drop: true, orderItems: [{ name: "Bun", photo: "/_blob/abcdefghij1234567890" }] }), { photo: "/_blob/abcdefghij1234567890", focus: null }, "a drop with only an item photo shows it");
});

test("the invite, the feed, Discover, Plans, the host page and chats all send the same cover", async () => {
  const inv = {}, host_ = await get("/api/public/host/madison-runs"), disc = await get("/api/public/discover"), feed = await get("/api/me/feed", guest.cookie),
    plans = await (await post("/api/plans/timeline", { proofs: [] }, guest.cookie)).json(), chats = await get("/api/chats", guest.cookie);
  const feedCards = (feed.items || feed.cards || []).flatMap((x) => [x, x.card, x.event].filter(Boolean));
  for (const [k, id] of Object.entries(IDS)) { const want = coverOf(await stored(id), id); const IH = await get("/api/public/event-host/" + id); inv[k] = IH.coverSpec;
    assert.deepEqual(inv[k], want, `the invite (${k}): ${Object.keys(IH)}`);
    const H = find([...(host_.upcoming || []), ...(host_.events || [])], id); if (H) assert.deepEqual(H.coverSpec, want, `the host page (${k})`);
    const D = find(disc.events, id); if (D) assert.deepEqual(D.coverSpec, want, `Discover (${k})`);
    const F = find(feedCards, id); if (F?.coverSpec) assert.deepEqual(F.coverSpec, want, `the feed (${k})`);
    const P = find(plans.items, id); if (P) assert.deepEqual(P.coverSpec, want, `Plans (${k})`);
    const C = find(chats.chats || chats.items || chats, id); if (C?.coverSpec) assert.deepEqual(C.coverSpec, want, `chats (${k})`);
    if (k !== "trip") { assert.ok(H, `${k} is on the host page`); assert.ok(P, `${k} is on the guest's Plans`); } }
  // (Discover lists hosts with a track record; its cards are the host page's publicCard, checked above when they show)
});

test("the link preview draws the same kind as the cover", async () => {
  const h = await (await fetch(srv.base + "/e/" + IDS.run)).text(), img = (/property="og:image" content="([^"]+)"/.exec(h) || [])[1] || "";
  assert.match(img, /\/og\/run\.png$/, "the run's preview is the run drawing, not coffee: " + img);
});

test("the host's Library (past events, menus, playlists) sends the same cover too", async () => {
  assert.ok((await put("events/cvPast1", ev({ name: "Last month's supper", activity: "dinner", date: day(-20), courses: ["Dumplings", "Greens"] }), host.cookie)).ok);
  const r = await fetch(srv.base + "/api/host/library", { headers: { cookie: host.cookie } }); assert.equal(r.status, 200, "the Library loads");
  const L = await r.json(), cards = Object.values(L).filter(Array.isArray).flat().filter((x) => x && x.id === "cvPast1");
  assert.ok(cards.length, "the past event is in the Library: " + Object.keys(L));
  for (const c of cards) assert.deepEqual(c.coverSpec, coverOf(await stored("cvPast1"), "cvPast1"));
});
