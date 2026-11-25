import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { parseAlert, alertMatches } from "../server/social.js";
import { fakeTexts } from "../server/sms.js";

let srv;
const J = { "content-type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (path, cookie) => fetch(srv.base + path, { headers: cookie ? { cookie } : {} });
const put = (path, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
const join = async (name, email) => { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); const b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); return { cookie: cookieOf(r), ws: b.workspace.id }; };
// one device key per guest (a guest's own phone); replies to events that have already happened are history,
// written straight into the store the way they'd have arrived before the day
const rsvp = async (ws, body) => { const data = { response: "going", createdAt: Date.now(), ...body }, key = "k-" + String(body.email || body.name || Math.random()).toLowerCase();
  const r = await fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, "x-encore-guest": "1", "x-encore-key": key, "x-encore-workspace": ws }, body: JSON.stringify(data) }); const j = await r.json();
  if (r.status === 409 && j.code === "past") { const id = "r" + Math.random().toString(36).slice(2, 12); srv.store.set(`ws/${ws}/rsvps/${id}`, { ...data, _k: key }); return id; }
  assert.equal(r.status, 200, JSON.stringify(j)); return j.id; };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "soc-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; process.env.ENCORE_FAKE_EMAIL = "1"; process.env.ENCORE_FAKE_SMS = "1"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL", "ENCORE_FAKE_SMS"]) delete process.env[k]; await srv.close(); });

test("Alerts in plain words: runs within 5 miles, public only", () => {
  const a = parseAlert("notify me whenever there's a run event happening within 5 miles away from me that is public");
  assert.deepEqual(a.lanes, ["run"]); assert.equal(a.radiusMi, 5); assert.equal(a.publicOnly, true);
  const here = { ...a, lat: 37.76, lng: -122.42 };
  assert.equal(alertMatches(here, { discoverable: true, activity: "run club" }, { lat: 37.78, lng: -122.41 }), true);
  assert.equal(alertMatches(here, { discoverable: true, activity: "run club" }, { lat: 37.33, lng: -121.89 }), false, "San Jose is ~40 miles away");
  assert.equal(alertMatches(here, { discoverable: false, activity: "run club" }, { lat: 37.78, lng: -122.41 }), false, "private events never alert");
  assert.equal(alertMatches(here, { discoverable: true, activity: "hike" }, { lat: 37.78, lng: -122.41 }), false);
  assert.equal(parseAlert("free board game nights in Austin").city, "Austin");
});

test("Friends, feed, stories, alerts, kudos, vibes, event profiles, chat and photos", async () => {
  const mai = await join("Mai Pham", "mai@example.com"), linh = await join("Linh Tran", "linh@example.com"), sam = await join("Sam Lee", "sam@example.com");
  // Mai hosted a public run last week and hosts a hike next week
  assert.equal((await put("events/run1", { name: "Saturday Run Club", activity: "run club", kind: "social", casual: true, discoverable: true, date: day(-3), city: "San Francisco", geo: { lat: 37.77, lng: -122.42 } }, mai.cookie)).status, 200);
  const linhRid = await rsvp(mai.ws, { eventId: "run1", name: "Linh Tran", email: "linh@example.com", code: "LT1", slot: "Coffee", plusOne: true });
  const samRid = await rsvp(mai.ws, { eventId: "run1", name: "Sam Lee", email: "sam@example.com", code: "SL1" });
  // Sam adds Linh as a friend and sees Linh went to the run
  const ppl = await (await get("/api/people?q=linh", sam.cookie)).json();
  assert.equal(ppl.people.length, 1); assert.ok(ppl.people[0].handle, "every member gets a handle");
  assert.equal((await post("/api/me/friends", { key: ppl.people[0].key }, sam.cookie)).status, 200);
  let feed = await (await get("/api/me/feed", sam.cookie)).json();
  assert.ok(feed.items.some((i) => i.kind === "went" && i.who.name === "Linh Tran" && i.event.title === "Saturday Run Club"), JSON.stringify(feed.items));
  assert.ok((await (await get("/api/me/inbox", linh.cookie)).json()).items.some((n) => n.kind === "friend"));
  // a photo from Linh (as a guest, with her RSVP proof) shows as a story for Sam
  const up = await fetch(`${srv.base}/api/moments?eventId=run1&rid=${linhRid}&code=LT1&caption=${encodeURIComponent("Sunrise at the bay")}`, { method: "POST", headers: { "content-type": "image/png" }, body: Buffer.from([137, 80, 78, 71, 1, 2, 3]) });
  assert.equal(up.status, 200, await up.clone().text());
  assert.equal((await fetch(`${srv.base}/api/moments?eventId=run1&rid=${linhRid}&code=WRONG`, { method: "POST", headers: { "content-type": "image/png" }, body: Buffer.from([1]) })).status, 403);
  feed = await (await get("/api/me/feed", sam.cookie)).json();
  assert.equal(feed.stories[0]?.who.name, "Linh Tran"); assert.equal(feed.stories[0].items[0].caption, "Sunrise at the bay");
  // kudos from Linh (proved), not from a stranger
  assert.equal((await post("/api/public/kudos", { eventId: "run1", rid: linhRid, code: "nope", tags: ["vibe"] })).status, 403);
  const k = await post("/api/public/kudos", { eventId: "run1", rid: linhRid, code: "LT1", tags: ["vibe", "welcome"], love: "The no-drop pace group made me feel welcome", improve: "Start 15 minutes later in winter" });
  assert.equal(k.status, 200, await k.clone().text());
  const hk = await (await get("/api/host/kudos/run1", mai.cookie)).json();
  assert.equal(hk.kudos[0].improve, "Start 15 minutes later in winter", "the host sees the private note");
  const handle = (await (await get("/api/host/profile", mai.cookie)).json()).host.handle;
  const pub = await (await get("/api/public/profile/" + handle)).json();
  assert.equal(pub.strengths.kudosCount, 1); assert.equal(pub.strengths.kudos[0].love, "The no-drop pace group made me feel welcome");
  assert.ok(!JSON.stringify(pub).includes("15 minutes later"), "the improvement note stays private");
  assert.equal(pub.strengths.tags[0].label, "Great vibe"); assert.ok(pub.profile.traits.some((t) => t.key === "host"));
  // the host tags Linh's vibe; Linh's profile shows it
  assert.equal((await post("/api/host/vibes", { eventId: "run1", email: "linh@example.com", tags: ["spark"] }, mai.cookie)).status, 200);
  const lp = await (await get("/api/me/profile", linh.cookie)).json();
  const keys = lp.profile.traits.map((t) => t.key); assert.ok(keys.includes("spark") && keys.includes("connector") && keys.includes("contributor") && keys.includes("cheerleader"), keys.join());
  const sp = await (await post("/api/me/profile/self", { host: "often", rsvp: "last", room: "chill" }, sam.cookie)).json();
  assert.equal(sp.profile.top.key, "host");
  // alerts: Sam wants runs within 5 miles; Mai lists a public run nearby, Sam is told
  const al = await (await post("/api/me/alerts", { text: "notify me whenever there's a run event happening within 5 miles away from me that is public", lat: 37.76, lng: -122.43 }, sam.cookie)).json();
  assert.equal(al.alert.radiusMi, 5);
  assert.equal((await post("/api/me/alerts", { text: "runs within 3 miles" }, sam.cookie)).status, 400, "a distance needs a location");
  assert.equal((await put("events/run2", { name: "Sunday Run Club", activity: "run club", kind: "social", casual: true, discoverable: true, date: day(4), city: "San Francisco", geo: { lat: 37.77, lng: -122.42 } }, mai.cookie)).status, 200);
  await new Promise((r) => setTimeout(r, 100));
  assert.ok((await (await get("/api/me/inbox", sam.cookie)).json()).items.some((n) => n.kind === "alert" && n.eventId === "run2"));
  // chat: a giveaway with phone numbers; guests message privately, release their slice
  assert.equal((await put("events/cake1", { name: "Free pandan cake", activity: "giveaway", kind: "social", casual: true, date: day(0), startTime: "10:00", slots: ["10:00–10:30"], meetPoint: "My stoop" }, mai.cookie)).status, 200);
  const g1 = await rsvp(mai.ws, { eventId: "cake1", name: "Ana Diaz", email: "ana@example.com", phone: "+1 415 555 0101", slot: "10:00–10:30", code: "AD1" });
  assert.equal((await get(`/api/public/chat/cake1?rid=${g1}&code=bad`)).status, 403);
  assert.equal((await post("/api/public/chat/cake1", { rid: g1, code: "AD1", kind: "late", text: "10 minutes" })).status, 200);
  const hc = await (await get("/api/host/chat/cake1", mai.cookie)).json();
  assert.match(hc.messages[0].text, /Running late: 10 minutes/); assert.equal(hc.phones[0].phone, "+1 415 555 0101"); assert.equal(hc.sms, true);
  assert.equal((await post("/api/host/chat/cake1", { text: "Table's out!", sms: true, anyway: true }, mai.cookie)).status, 200);
  assert.ok(fakeTexts.some((t) => t.to === "+14155550101" && /Table's out/.test(t.text)));
  const rel = await (await post("/api/public/chat/cake1", { rid: g1, code: "AD1", kind: "release" })).json();
  assert.equal(rel.released, true);
  // the hourly job asks run1's guests for kudos, once
  const j1 = await srv.app.locals.social.runJobs();
  assert.ok(j1.kudosAsks >= 2, JSON.stringify(j1));
  assert.equal((await srv.app.locals.social.runJobs()).kudosAsks, 0, "only once");
  assert.ok((await (await get("/api/me/inbox", sam.cookie)).json()).items.some((n) => n.kind === "kudos" && n.eventId === "run1"));
  void samRid;
});
