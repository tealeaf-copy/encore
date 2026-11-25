// Spots, the waitlist, guest replies from any browser, saves from two devices, and the bell.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { fakeOutbox } from "../server/email.js";

let srv;
const J = { "content-type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const put = (path, body, cookie) => fetch(srv.base + path, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const patch = (path, body, cookie) => fetch(srv.base + path, { method: "PATCH", headers: { ...J, cookie }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "spots-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; process.env.ENCORE_FAKE_EMAIL = "1"; delete process.env.ENCORE_RSVP_PER_HOUR; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL", "ENCORE_RSVP_PER_HOUR"]) delete process.env[k]; await srv.close(); });

let n = 0;
async function host(tag) {
  const r = await post("/api/signup", { name: `Host ${tag}`, email: `host.${tag}.${++n}@example.com`, password: "long-password-1", mode: "friends" });
  const c = cookieOf(r), ws = (await r.json()).workspace.id;
  return { c, ws, G: { ...J, "x-encore-guest": "1", "x-encore-workspace": ws } };
}
const reply = (H, key, body) => fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...H.G, "x-encore-key": key }, body: JSON.stringify(body) });
const doc = async (H, id) => (await (await fetch(srv.base + "/api/db/doc?path=rsvps/" + id, { headers: { cookie: H.c } })).json()).data;
const rid = (j) => String(j.id).split("/").pop();
const inbox = async (cookie) => (await (await fetch(srv.base + "/api/me/inbox", { headers: { cookie } })).json()).items || [];

test("Spots count people: a party of three holds three spots, and party size can't pass what the host allows", async () => {
  const H = await host("party");
  await put("/api/db/doc?path=events/pt1", { kind: "social", casual: true, name: "Dumpling night", date: day(5), published: true, headcount: 4, plusOnes: 2 }, H.c);
  const a = await (await reply(H, "pa", { eventId: "pt1", name: "Ann", email: "ann.pt@ex.com", response: "going", party: 3 })).json();
  assert.equal(a.response, "going");
  const b = await (await reply(H, "pb", { eventId: "pt1", name: "Ben", email: "ben.pt@ex.com", response: "going", party: 3 })).json();
  assert.equal(b.response, "waitlist", "3 + 3 is more than 4 spots");
  assert.equal(b.waitlistPos, 1);
  const c = await (await reply(H, "pc", { eventId: "pt1", name: "Cat", email: "cat.pt@ex.com", response: "going", party: 9 })).json();
  assert.equal((await doc(H, rid(c))).party, 3, "a party is at most 1 + the plus-ones allowed");
  // the light invite's counts: spots left are 0 while anyone waits
  const A = await (await fetch(srv.base + "/api/public/attendees/pt1")).json();
  assert.equal(A.count, 3); assert.equal(A.waiting, 2); assert.equal(A.left, 0);
});

test("A spot freed by Can't go on the full invite (PATCH) goes to the waitlist, and a new guest can't jump the line", async () => {
  const H = await host("wl");
  await put("/api/db/doc?path=events/wl1", { kind: "social", casual: true, name: "Pottery class", pubTitle: "Wheel night", date: day(6), published: true, headcount: 2 }, H.c);
  const ann = await (await reply(H, "wa", { eventId: "wl1", name: "Ann", email: "ann.wl@ex.com", response: "going" })).json();
  await reply(H, "wb", { eventId: "wl1", name: "Ben", email: "ben.wl@ex.com", response: "going" });
  const cat = await (await reply(H, "wc", { eventId: "wl1", name: "Cat Lee", email: "cat.wl@ex.com", response: "going" })).json();
  const dan = await (await reply(H, "wd", { eventId: "wl1", name: "Dan", email: "dan.wl@ex.com", response: "going" })).json();
  assert.equal(cat.response, "waitlist"); assert.equal(dan.waitlistPos, 2);
  const mails = fakeOutbox.length;
  // Ann taps Plans changed? → Can't go (the full invite sends a PATCH)
  const r = await (await fetch(srv.base + "/api/db/doc?path=rsvps/" + rid(ann), { method: "PATCH", headers: { ...H.G, "x-encore-key": "wa" }, body: JSON.stringify({ response: "no", changedAt: Date.now(), eventId: "wl1" }) })).json();
  assert.equal(r.response, "no"); assert.equal(r.promoted, true);
  assert.equal((await doc(H, rid(cat))).response, "going", "first on the waitlist is in");
  const m = fakeOutbox.slice(mails).find((x) => String(x.to).includes("cat.wl@ex.com"));
  assert.ok(m, "Cat is emailed"); assert.equal(m.subject, "A spot opened up: Wheel night", "the real title, not 'the event'");
  assert.match(m.text, /\/e\/wl1#reply=/, "with a link to her own reply");
  // a stranger now: Dan is still waiting, so the newcomer joins the line behind him
  const eve = await (await reply(H, "we", { eventId: "wl1", name: "Eve", email: "eve.wl@ex.com", response: "going" })).json();
  assert.equal(eve.response, "waitlist"); assert.equal(eve.waitlistPos, 2);
  // where Eve stands, by her id and code
  await fetch(srv.base + "/api/db/doc?path=rsvps/" + rid(eve), { method: "PATCH", headers: { ...H.G, "x-encore-key": "we" }, body: JSON.stringify({ code: "EV123" }) });
  const st = await (await fetch(srv.base + `/api/public/reply/wl1?rid=${rid(eve)}&code=EV123`)).json();
  assert.equal(st.response, "waitlist"); assert.equal(st.waitlistPos, 2); assert.equal(st.left, 0);
  // the host's bell heard about the replies and the move up
  const bell = (await inbox(H.c)).map((x) => x.text).join("\n");
  assert.match(bell, /Ann is in for Wheel night/); assert.match(bell, /Ann can't go to Wheel night now/); assert.match(bell, /Cat moved up from the waitlist/);
});

test("Host decline, host delete and a bigger cap all move the waitlist up", async () => {
  const H = await host("cap");
  await put("/api/db/doc?path=events/cp1", { kind: "social", casual: true, name: "Run", date: day(4), published: true, headcount: 1, updatedAt: 100 }, H.c);
  const a = await (await reply(H, "ca", { eventId: "cp1", name: "Ana", email: "ana.cp@ex.com", response: "going" })).json();
  const b = await (await reply(H, "cb", { eventId: "cp1", name: "Bo", email: "bo.cp@ex.com", response: "going" })).json();
  const c = await (await reply(H, "cc", { eventId: "cp1", name: "Cy", email: "cy.cp@ex.com", response: "going" })).json();
  const d = await (await reply(H, "cd", { eventId: "cp1", name: "Di", email: "di.cp@ex.com", response: "going" })).json();
  assert.deepEqual([b.response, c.response, d.response], ["waitlist", "waitlist", "waitlist"]);
  await patch("/api/db/doc?path=rsvps/" + rid(a), { response: "no", decidedAt: Date.now() }, H.c);
  assert.equal((await doc(H, rid(b))).response, "going", "the host saying no to Ana opens her spot for Bo");
  await fetch(srv.base + "/api/db/doc?path=rsvps/" + rid(b), { method: "DELETE", headers: { cookie: H.c } });
  assert.equal((await doc(H, rid(c))).response, "going", "removing Bo lets Cy in");
  const ev = (await (await fetch(srv.base + "/api/db/doc?path=events/cp1", { headers: { cookie: H.c } })).json()).data;
  const r = await (await put("/api/db/doc?path=events/cp1", { ...ev, headcount: 40, _base: ev.updatedAt, updatedAt: ev.updatedAt + 1 }, H.c)).json();
  assert.deepEqual(r.promoted, [rid(d)]); assert.equal((await doc(H, rid(d))).response, "going", "raising the cap lets Di in");
});

test("Guest replies: rate limit per address, a size cap, and only the fields a reply form sends", async () => {
  const H = await host("abuse");
  await put("/api/db/doc?path=events/ab1", { kind: "social", casual: true, name: "Picnic", date: day(3), published: true, headcount: 50 }, H.c);
  const big = await reply(H, "ab0", { eventId: "ab1", name: "Big", response: "going", junk: "x".repeat(100_000) });
  assert.equal(big.status, 413);
  const j = await (await reply(H, "ab1", { eventId: "ab1", name: "Real Guest", email: "real.ab@ex.com", response: "going", party: 1, dietary: "Vegetarian", junk: "zzz", paid: true, checkedInAt: 5, _keys: ["evil"] })).json();
  const d = await doc(H, rid(j));
  assert.equal(d.name, "Real Guest"); assert.equal(d.dietary, "Vegetarian");
  for (const k of ["junk", "paid", "checkedInAt"]) assert.equal(d[k], undefined, k + " is dropped");
  assert.equal(d._keys, undefined);
  // a guest can't mark themselves paid or move their reply to another event later
  await fetch(srv.base + "/api/db/doc?path=rsvps/" + rid(j), { method: "PATCH", headers: { ...H.G, "x-encore-key": "ab1" }, body: JSON.stringify({ paid: true, eventId: "other", noShow: false }) });
  const d2 = await doc(H, rid(j)); assert.equal(d2.paid, undefined); assert.equal(d2.eventId, "ab1");
  // the host's paid tick survives the guest's own whole-reply save
  await patch("/api/db/doc?path=rsvps/" + rid(j), { paid: true }, H.c);
  await fetch(srv.base + "/api/db/doc?path=rsvps/" + rid(j), { method: "PUT", headers: { ...H.G, "x-encore-key": "ab1" }, body: JSON.stringify({ eventId: "ab1", name: "Real Guest", response: "going", dietary: "Vegan" }) });
  const d3 = await doc(H, rid(j)); assert.equal(d3.paid, true); assert.equal(d3.dietary, "Vegan");
  process.env.ENCORE_RSVP_PER_HOUR = "3";
  await put("/api/db/doc?path=events/ab2", { kind: "social", casual: true, name: "Picnic 2", date: day(3), published: true }, H.c);
  const codes = []; for (let i = 0; i < 4; i++) codes.push((await reply(H, "fl" + i, { eventId: "ab2", name: "Flood " + i, response: "going" })).status);
  assert.deepEqual(codes, [200, 200, 200, 429]);
});

test("Two devices: a stale save is merged field by field, a real clash says what changed, and _fields writes only those", async () => {
  const H = await host("dev");
  const v1 = { kind: "social", casual: true, name: "Supper", why: "Old note", date: day(9), updatedAt: 1000 };
  await put("/api/db/doc?path=events/dv1", v1, H.c);
  // the phone changes the description
  assert.equal((await put("/api/db/doc?path=events/dv1", { ...v1, why: "New note from the phone", _base: 1000, updatedAt: 2000 }, H.c)).status, 200);
  // the laptop, still on version 1000, changes the name and saves its whole draft
  const r = await put("/api/db/doc?path=events/dv1", { ...v1, name: "Sunday supper", _base: 1000, updatedAt: 3000 }, H.c), j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.merged, true); assert.deepEqual(j.theirs, ["why"], "says what the other device changed");
  const cur = (await (await fetch(srv.base + "/api/db/doc?path=events/dv1", { headers: { cookie: H.c } })).json()).data;
  assert.equal(cur.name, "Sunday supper"); assert.equal(cur.why, "New note from the phone", "the phone's change is kept");
  // both change the name: a conflict, with the current version so the page can show it
  const c = await put("/api/db/doc?path=events/dv1", { ...v1, name: "Laptop name", _base: 1000, updatedAt: 4000 }, H.c), cj = await c.json();
  assert.equal(c.status, 409); assert.deepEqual(cj.conflicts, ["name"]); assert.equal(cj.current.name, "Sunday supper");
  // a save that names its fields writes only those, even from a stale draft with a fresh _base
  const r2 = await put("/api/db/doc?path=events/dv1", { ...v1, date: day(10), _fields: ["date"], _base: cur.updatedAt, updatedAt: cur.updatedAt + 5 }, H.c);
  assert.equal(r2.status, 200);
  const cur2 = (await (await fetch(srv.base + "/api/db/doc?path=events/dv1", { headers: { cookie: H.c } })).json()).data;
  assert.equal(cur2.date, day(10)); assert.equal(cur2.why, "New note from the phone"); assert.equal(cur2.name, "Sunday supper");
  assert.equal(cur2._fields, undefined);
});

test("Ask to join rings the host's bell and email; Let in emails the guest; followers ring the bell", async () => {
  const H = await host("ask");
  await post("/api/host/profile", { handle: "askhost" + n, name: "Ruth's Book Supper", city: "Brooklyn" }, H.c);
  await put("/api/db/doc?path=events/as1", { kind: "social", casual: true, name: "Book supper", date: day(8), published: true, approvalRequired: true, headcount: 10 }, H.c);
  const mails = fakeOutbox.length;
  const q = await (await reply(H, "aq", { eventId: "as1", name: "Ada Park", email: "ada.as@ex.com", response: "going" })).json();
  assert.equal(q.response, "requested");
  const bell = (await inbox(H.c)).map((x) => x.text).join("\n"); assert.match(bell, /Ada asked to join Book supper/);
  assert.ok(fakeOutbox.slice(mails).some((m) => /Ada asked to join Book supper/.test(m.subject)), "the host gets an email");
  // a guest who was only asking can't turn it into a yes by changing their reply
  await fetch(srv.base + "/api/db/doc?path=rsvps/" + rid(q), { method: "PATCH", headers: { ...H.G, "x-encore-key": "aq" }, body: JSON.stringify({ response: "maybe" }) });
  await fetch(srv.base + "/api/db/doc?path=rsvps/" + rid(q), { method: "PATCH", headers: { ...H.G, "x-encore-key": "aq" }, body: JSON.stringify({ response: "going" }) });
  assert.equal((await doc(H, rid(q))).response, "requested");
  const m0 = fakeOutbox.length, r = await (await patch("/api/db/doc?path=rsvps/" + rid(q), { response: "going", decidedAt: Date.now() }, H.c)).json();
  assert.equal(r.letIn.emailed, true);
  const m = fakeOutbox.slice(m0).find((x) => String(x.to).includes("ada.as@ex.com")); assert.equal(m.subject, "You're in: Book supper"); assert.match(m.text, /let you in/);
  // once let in, changing her mind back and forth doesn't need asking again
  await fetch(srv.base + "/api/db/doc?path=rsvps/" + rid(q), { method: "PATCH", headers: { ...H.G, "x-encore-key": "aq" }, body: JSON.stringify({ response: "no" }) });
  await fetch(srv.base + "/api/db/doc?path=rsvps/" + rid(q), { method: "PATCH", headers: { ...H.G, "x-encore-key": "aq" }, body: JSON.stringify({ response: "going" }) });
  assert.equal((await doc(H, rid(q))).response, "going");
  await post("/api/public/follow", { handle: "askhost" + n, email: "fan.as@ex.com", name: "Fran Fan" });
  assert.match((await inbox(H.c)).map((x) => x.text).join("\n"), /Fran followed you/);
});

test("Locked out on another browser: the guest gets a link by email, and the link lets this browser change the reply", async () => {
  const H = await host("link");
  await put("/api/db/doc?path=events/lk1", { kind: "social", casual: true, name: "Hike", pubTitle: "Breakneck Ridge", date: day(7), published: true }, H.c);
  const a = await (await reply(H, "phone-key-1", { eventId: "lk1", name: "Sam Lee", email: "sam.lk@ex.com", response: "going" })).json();
  const m0 = fakeOutbox.length, r = await reply(H, "laptop-key-2", { eventId: "lk1", name: "Sam Lee", email: "sam.lk@ex.com", response: "no" }), j = await r.json();
  assert.equal(r.status, 409); assert.equal(j.emailed, true); assert.match(j.message, /We sent you a link/);
  const m = fakeOutbox.slice(m0).find((x) => String(x.to).includes("sam.lk@ex.com")); assert.equal(m.subject, "Your reply: Breakneck Ridge");
  const [, id, t] = /#reply=([A-Za-z0-9_-]+)\.([a-f0-9]+)/.exec(m.text);
  assert.equal(id, rid(a));
  const claim = (key, tok) => fetch(srv.base + "/api/public/reply/claim", { method: "POST", headers: { ...J, "x-encore-key": key }, body: JSON.stringify({ eventId: "lk1", rid: id, t: tok }) });
  assert.equal((await claim("laptop-key-2", "0".repeat(32))).status, 404, "a made-up link does nothing");
  const c = await (await claim("laptop-key-2", t)).json(); assert.equal(c.ok, true); assert.equal(c.response, "going"); assert.equal(c.name, "Sam Lee");
  const p = await fetch(srv.base + "/api/db/doc?path=rsvps/" + id, { method: "PATCH", headers: { ...H.G, "x-encore-key": "laptop-key-2" }, body: JSON.stringify({ response: "no" }) });
  assert.equal(p.status, 200); assert.equal((await doc(H, id)).response, "no");
  assert.equal((await fetch(srv.base + "/api/db/doc?path=rsvps/" + id, { method: "PATCH", headers: { ...H.G, "x-encore-key": "phone-key-1" }, body: JSON.stringify({ response: "going" }) })).status, 200, "the first device still works");
  assert.equal((await fetch(srv.base + "/api/db/doc?path=rsvps/" + id, { method: "PATCH", headers: { ...H.G, "x-encore-key": "someone-else" }, body: JSON.stringify({ response: "no" }) })).status, 403);
  // asking for the link directly answers the same whether or not that email replied
  const L1 = await (await post("/api/public/reply/link", { eventId: "lk1", email: "sam.lk@ex.com" })).json(), L2 = await (await post("/api/public/reply/link", { eventId: "lk1", email: "nobody.lk@ex.com" })).json();
  assert.equal(L1.message, L2.message); assert.equal(L1.emailOn, true);
});

test("Link-only events join the scrapbook after they happen (no place, no way in); upcoming ones show only to their host", async () => {
  const H = await host("priv"), handle = "privhost" + n;
  await post("/api/host/profile", { handle, name: "Jo's Dinners", city: "Brooklyn", tagline: "Small dinners", theme: { avatarArt: "chef" } }, H.c);
  await put("/api/db/doc?path=events/pv1", { kind: "social", casual: true, name: "Jo's 30th", date: day(-10), published: true, discoverable: false, meetPoint: "12 Secret St", venueAddr: "12 Secret St, Apt 3", guests: [{ name: "Rosa Diaz", status: "Going" }] }, H.c);
  await put("/api/db/doc?path=events/pv2", { kind: "social", casual: true, name: "Book club", date: day(10), published: true, discoverable: false }, H.c);
  await put("/api/db/doc?path=events/pv3", { kind: "social", casual: true, name: "Never shared", date: day(-5) }, H.c);
  await put("/api/db/doc?path=events/pv4", { kind: "social", casual: true, name: "Kept off", date: day(-4), published: true, discoverable: false, scrapbook: false }, H.c);
  const pub = await (await fetch(srv.base + "/api/public/host/" + handle)).json(), s = JSON.stringify(pub);
  assert.deepEqual(pub.past.map((e) => e.title), ["Jo's 30th"]);
  assert.equal(pub.past[0].private, true); assert.notEqual(pub.past[0].id, "pv1", "no event id that opens the invite");
  assert.ok(!/Secret St|Rosa/.test(s), "never the place or who came");
  assert.equal(pub.upcoming.length, 0, "strangers don't see upcoming link-only events");
  const own = await (await fetch(srv.base + "/api/public/host/" + handle, { headers: { cookie: H.c } })).json();
  assert.equal(own.own, true); assert.deepEqual(own.upcoming.map((e) => [e.title, e.onlyYou]), [["Book club", true]]);
});

test("At share time the host can ask one event's Discover status, with the line to show", async () => {
  const H = await host("disc"), handle = "dischost" + n;
  await post("/api/host/profile", { handle, name: "Kevin Eats", city: "Queens" }, H.c);
  await put("/api/db/doc?path=events/ds1", { kind: "social", casual: true, name: "Food crawl", date: day(12), published: true, discoverable: true }, H.c);
  const s = await (await fetch(srv.base + "/api/host/discover-status?eventId=ds1", { headers: { cookie: H.c } })).json();
  assert.equal(s.event.onPage, true); assert.equal(s.event.onDiscover, false);
  assert.match(s.event.line, /Discover lists it once your page has a line about you and a face or photo/);
  await post("/api/host/profile", { handle, name: "Kevin Eats", city: "Queens", tagline: "Eating my way through Queens", theme: { avatarArt: "chef" } }, H.c);
  const s2 = await (await fetch(srv.base + "/api/host/discover-status?eventId=ds1", { headers: { cookie: H.c } })).json();
  assert.equal(s2.event.onDiscover, true); assert.equal(s2.event.line, "Live · On your page and Discover");
});

test("The address a guest gets after they're in reads the host's name, not their own \"my place\"", async () => {
  const H = await host("addr");
  await put("/api/db/doc?path=events/ad1", { kind: "social", casual: true, name: "Dumplings", date: day(5), published: true, venueName: "My place", venueAddr: "12 Oak St" }, H.c);
  const a = await (await reply(H, "ad-a", { eventId: "ad1", name: "Ann", response: "going", code: "AD123" })).json();
  const r = await (await fetch(srv.base + `/api/public/address/ad1?rid=${rid(a)}&code=AD123`)).json();
  assert.equal(r.ok, true); assert.equal(r.venueName, "Host's place"); assert.equal(r.venueAddr, "12 Oak St");
});
