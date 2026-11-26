// Fan clubs and the follow graph (server/fanclub.js): follow and unfollow with a bell, a club turned on and off, join
// and leave, members-only events non-members can't read, the members-first window, host posts that reach members only,
// private lists, blocks both ways, rate limits, and no paid tiers inside the native app.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { getDbUser, putDbUser } from "../server/workspaces.js";
import { defaultClubName, stripPaid, isNativeReq, POST_PER_HOUR, JOIN_PER_HOUR } from "../server/fanclub.js";

let srv;
const J = { "content-type": "application/json" };
const APP_UA = "Mozilla/5.0 (iPhone) PotteryLabApp/1.0";
const post = (path, body, cookie, extra = {}) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}), ...extra }, body: JSON.stringify(body || {}) });
const get = (path, cookie, extra = {}) => fetch(srv.base + path, { headers: { ...(cookie ? { cookie } : {}), ...extra } });
const getJ = async (path, cookie, extra) => (await get(path, cookie, extra)).json();
const put = (path, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
let n = 0;
const person = async (name) => { const email = `${name.toLowerCase().replace(/\W+/g, "")}${++n}@example.com`; const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); const b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); return { cookie: cookieOf(r), ws: b.workspace.id, email, name }; };
const host = async (name, handle) => { const h = await person(name); const r = await post("/api/host/profile", { handle, name, city: "New York", bio: "Dinners at home." }, h.cookie); assert.equal(r.status, 200, await r.text()); return { ...h, handle }; };
const guestRsvp = (ws, body, cookie) => fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, "x-encore-guest": "1", "x-encore-key": "k" + Math.random().toString(36).slice(2), "x-encore-workspace": ws, ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ createdAt: Date.now(), ...body }) });
const guestRead = (id, cookie) => fetch(srv.base + "/api/db/doc?path=events/" + id, { headers: { "x-encore-guest": "1", ...(cookie ? { cookie } : {}) } });
const day = (k) => new Date(Date.now() + k * 864e5).toISOString().slice(0, 10);
const clubOn = (h, b = {}) => post("/api/host/club", { on: true, ...b }, h.cookie);

before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "club-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "500"; process.env.ENCORE_FAKE_EMAIL = "1"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv.close(); });

test("the default club name says whose regulars they are", () => {
  assert.equal(defaultClubName("Bo's Omecasa"), "Bo's Regulars");
  assert.equal(defaultClubName("Claire"), "Claire's Regulars");
  assert.equal(defaultClubName("James"), "James' Regulars");
});

test("follow and unfollow with one tap, the bell turns notices off, and the host page knows", async () => {
  const bo = await host("Bo Tran", "bo-follow"), sam = await person("Sam Diaz");
  let r = await post("/api/me/following/bo-follow", { on: true }, sam.cookie); let j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j)); assert.equal(j.following, true); assert.equal(j.notify, true); assert.equal(j.followers, 1);
  let page = await getJ("/api/public/host/bo-follow", sam.cookie); assert.equal(page.viewer.following, true); assert.equal(page.followers, 1);
  j = await (await post("/api/me/following/bo-follow", { notify: false }, sam.cookie)).json(); assert.equal(j.notify, false, "the bell is off");
  const mine = await getJ("/api/me/following", sam.cookie); assert.equal(mine.hosts[0].handle, "bo-follow"); assert.equal(mine.hosts[0].notify, false);
  j = await (await post("/api/me/following/bo-follow", { on: false }, sam.cookie)).json(); assert.equal(j.following, false); assert.equal(j.followers, 0);
  page = await getJ("/api/public/host/bo-follow", sam.cookie); assert.equal(page.viewer.following, false);
  assert.equal((await post("/api/me/following/bo-follow", { on: true })).status, 401, "following takes an account");
  assert.equal((await post("/api/me/following/bo-follow", { on: true }, bo.cookie)).status, 400, "not your own page");
});

test("a host turns the club on and off; members join, leave and come back", async () => {
  const bo = await host("Bo Tran", "bo-club"), ana = await person("Ana Lee");
  assert.equal((await post("/api/me/club/bo-club/join", {}, ana.cookie)).status, 404, "no club yet");
  let r = await clubOn(bo, { pitch: "First dibs on every dinner.", perks: ["Early access", "Members-only dinners"] }); let j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j)); assert.equal(j.club.name, "Bo's Regulars"); assert.equal(j.club.earlyHours, 24);
  let page = await getJ("/api/public/host/bo-club"); assert.equal(page.club.on, true); assert.equal(page.club.members, 0); assert.equal(page.club.pitch, "First dibs on every dinner.");
  j = await (await post("/api/me/club/bo-club/join", {}, ana.cookie)).json(); assert.equal(j.member, true); assert.equal(j.members, 1); assert.ok(j.chatId.startsWith("club-"));
  page = await getJ("/api/public/host/bo-club", ana.cookie); assert.equal(page.viewer.member, true); assert.ok(page.viewer.since > 0); assert.equal(page.viewer.following, true, "joining follows too");
  assert.ok((await getJ("/api/me/following", ana.cookie)).clubs.some((c) => c.handle === "bo-club" && c.club === "Bo's Regulars"));
  j = await (await post("/api/me/club/bo-club/leave", {}, ana.cookie)).json(); assert.equal(j.member, false); assert.equal(j.members, 0);
  assert.equal((await post("/api/me/club/bo-club/join", {}, ana.cookie)).status, 200, "members can come back");
  // off: nobody's a member while it's off, and the page says there's no club
  await post("/api/host/club", { on: false }, bo.cookie);
  page = await getJ("/api/public/host/bo-club", ana.cookie); assert.equal(page.club.on, false); assert.equal(page.viewer.member, false);
  assert.equal((await post("/api/me/club/bo-club/join", {}, ana.cookie)).status, 404);
  await clubOn(bo); assert.equal((await getJ("/api/public/host/bo-club", ana.cookie)).viewer.member, true, "turning it back on keeps members");
  // the host can remove a member; they can't rejoin on their own
  const H = await getJ("/api/host/club", bo.cookie); assert.equal(H.members.length, 1); assert.equal(H.members[0].name, "Ana"); assert.ok(!("email" in H.members[0]), "first names only");
  assert.equal((await post(`/api/host/club/members/${H.members[0].id}/remove`, {}, bo.cookie)).status, 200);
  const again = await post("/api/me/club/bo-club/join", {}, ana.cookie); assert.equal(again.status, 403); assert.equal((await again.json()).code, "removed");
});

test("a members-only event: non-members can't read or book it, members can; it stays off Discover", async () => {
  const bo = await host("Bo Tran", "bo-only"), mem = await person("Mia Park"), out = await person("Oli Chen");
  await clubOn(bo); await post("/api/me/club/bo-only/join", {}, mem.cookie);
  assert.equal((await put("events/clubdin1", { name: "Regulars supper", kind: "social", casual: true, date: day(9), city: "New York", discoverable: true, published: true, headcount: 8 }, bo.cookie)).status, 200);
  let r = await post("/api/host/club/events/clubdin1", { visibility: "members" }, bo.cookie); assert.equal(r.status, 200, await r.text());
  r = await guestRead("clubdin1"); assert.equal(r.status, 403); assert.equal((await r.json()).code, "club_only");
  r = await guestRead("clubdin1", out.cookie); assert.equal(r.status, 403, "signed in but not a member");
  r = await guestRead("clubdin1", mem.cookie); assert.equal(r.status, 200); const doc = await r.json(); assert.equal(doc.data.club.only, true);
  r = await guestRsvp(bo.ws, { eventId: "clubdin1", name: "Oli", email: out.email, response: "going", code: "O1" }, out.cookie); assert.equal(r.status, 403); assert.equal((await r.json()).code, "club_only");
  r = await guestRsvp(bo.ws, { eventId: "clubdin1", name: "Mia", email: mem.email, response: "going", code: "M1" }, mem.cookie); assert.equal(r.status, 200, await r.text());
  // the public page and Discover never list it; members see it in clubEvents
  const pub = await getJ("/api/public/host/bo-only", out.cookie); assert.ok(!pub.upcoming.some((e) => e.id === "clubdin1")); assert.ok(!pub.clubEvents);
  const mine = await getJ("/api/public/host/bo-only", mem.cookie); assert.ok(mine.clubEvents.some((e) => e.id === "clubdin1"));
  assert.ok(!(await getJ("/api/public/discover")).events.some((e) => e.id === "clubdin1"));
  // a later save from the editor that turns Discover back on is undone while it's members only
  await put("events/clubdin1", { name: "Regulars supper", kind: "social", casual: true, date: day(9), city: "New York", discoverable: true, published: true, headcount: 8 }, bo.cookie);
  assert.ok(!(await getJ("/api/public/discover")).events.some((e) => e.id === "clubdin1"));
  // the share preview doesn't say what it is
  const html = await (await get("/e/clubdin1")).text(); assert.match(html, /A members-only event/); assert.doesNotMatch(html, /Regulars supper/);
});

test("early access: members book inside the window, everyone else waits; followers hear when it opens", async () => {
  const bo = await host("Bo Tran", "bo-early"), mem = await person("Mia Park"), fan = await person("Fay Ng");
  await clubOn(bo, { earlyHours: 48 }); await post("/api/me/club/bo-early/join", {}, mem.cookie); await post("/api/me/following/bo-early", { on: true }, fan.cookie);
  assert.equal((await put("events/early1", { name: "Pandan cake drop", kind: "social", casual: true, date: day(6), city: "New York", discoverable: true, published: true }, bo.cookie)).status, 200);
  const H = await getJ("/api/host/club", bo.cookie), e = H.events.find((x) => x.id === "early1"); assert.equal(e.visibility, "early"); assert.ok(e.earlyUntil > Date.now() + 47 * 3600e3);
  let r = await guestRsvp(bo.ws, { eventId: "early1", name: "Fay", email: fan.email, response: "going", code: "F1" }, fan.cookie); assert.equal(r.status, 403); assert.equal((await r.json()).code, "club_early");
  r = await guestRsvp(bo.ws, { eventId: "early1", name: "Mia", email: mem.email, response: "going", code: "M1" }, mem.cookie); assert.equal(r.status, 200, await r.text());
  const card = (await getJ("/api/public/host/bo-early")).upcoming.find((x) => x.id === "early1"); assert.ok(card.clubEarlyUntil > Date.now(), "the card says members-first");
  const F = srv.app.locals.fanclub;
  // the window closes: followers hear, once
  const jobs = await F.runJobs(Date.now() + 49 * 3600e3); assert.equal(jobs.told, 1, "the follower who isn't a member");
  assert.equal((await F.runJobs(Date.now() + 50 * 3600e3)).told, 0, "only once");
  // the host can open it to everyone right away
  assert.equal((await post("/api/host/club/events/early1", { visibility: "everyone" }, bo.cookie)).status, 200);
  r = await guestRsvp(bo.ws, { eventId: "early1", name: "Fay", email: fan.email, response: "going", code: "F2" }, fan.cookie); assert.equal(r.status, 200);
});

test("host posts reach members only; reports hide them; the feed carries them for members", async () => {
  const bo = await host("Bo Tran", "bo-posts"), mem = await person("Mia Park"), out = await person("Oli Chen");
  assert.equal((await post("/api/host/club/posts", { text: "New drop Friday" }, bo.cookie)).status, 400, "club off: no posts");
  await clubOn(bo); await post("/api/me/club/bo-posts/join", {}, mem.cookie);
  let r = await post("/api/host/club/posts", { text: "New drop Friday. Menu draft below, vote?" }, bo.cookie); const p = (await r.json()).post; assert.equal(r.status, 200); assert.ok(p.id);
  assert.equal((await post("/api/host/club/posts", { text: "This is shit" }, bo.cookie)).status, 400, "the language filter");
  const m = await getJ("/api/public/club/bo-posts", mem.cookie); assert.equal(m.posts[0].text, "New drop Friday. Menu draft below, vote?");
  const o = await getJ("/api/public/club/bo-posts", out.cookie); assert.ok(!("posts" in o) || typeof o.posts !== "object", "non-members get no posts"); assert.equal(o.club.posts, 1, "only a count");
  const anon = await getJ("/api/public/club/bo-posts"); assert.ok(!Array.isArray(anon.posts));
  const feed = await getJ("/api/me/feed", mem.cookie); assert.ok(feed.items.some((x) => x.clubPost && x.id === p.id), "in the member's feed");
  const feedOut = await getJ("/api/me/feed", out.cookie); assert.ok(!feedOut.items.some((x) => x.clubPost));
  // a heart from the feed's Cheer button
  let h = await (await post(`/api/me/posts/club.bo-posts/${p.id}/cheer`, {}, mem.cookie)).json(); assert.equal(h.cheered, true);
  assert.equal((await post(`/api/me/posts/club.bo-posts/${p.id}/cheer`, {}, out.cookie)).status, 403);
  // three reports from established accounts hide it for everyone (server/verify.js trustedReporter)
  const rae = await person("Rae Kim"); for (const w of [mem, out, rae]) putDbUser({ ...getDbUser(w.email), createdAt: Date.now() - 30 * 864e5, emailVerified: true });
  for (const who of [mem, out, rae]) assert.equal((await post("/api/report", { type: "post", target: m.posts[0].report, reason: "spam" }, who.cookie)).status, 200);
  assert.equal((await getJ("/api/public/club/bo-posts", mem.cookie)).posts.length, 0);
});

test("lists are private: only the host sees members and followers; everyone else sees counts", async () => {
  const bo = await host("Bo Tran", "bo-priv"), mem = await person("Mia Park"), out = await person("Oli Chen");
  await clubOn(bo); await post("/api/me/club/bo-priv/join", {}, mem.cookie);
  for (const c of [out.cookie, mem.cookie, undefined]) { const j = await (await get("/api/host/club", c)).json(); assert.ok(!(j.members || []).some((x) => x.name === "Mia"), "only the host sees members"); }
  const pub = JSON.stringify(await getJ("/api/public/host/bo-priv", out.cookie)) + JSON.stringify(await getJ("/api/public/club/bo-priv", out.cookie));
  assert.doesNotMatch(pub, new RegExp(mem.email)); assert.doesNotMatch(pub, /Mia/);
  const csv = await get("/api/host/club/members.csv", bo.cookie); assert.equal(csv.status, 200); const t = await csv.text(); assert.match(t, /"Mia"/); assert.doesNotMatch(t, /@example\.com/);
  assert.doesNotMatch(await (await get("/api/host/club/members.csv", mem.cookie)).text(), /Mia/, "a member's export is their own club's");
  // a member's badge shows on their own page only once they opt in
  const mh = await post("/api/host/profile", { handle: "mia-page", name: "Mia Park", city: "New York" }, mem.cookie); assert.equal(mh.status, 200);
  assert.equal((await getJ("/api/public/badges/mia-page")).clubs.length, 0);
  await post("/api/me/club/bo-priv/settings", { showBadge: true }, mem.cookie);
  const b = (await getJ("/api/public/badges/mia-page")).clubs; assert.equal(b[0].club, "Bo's Regulars"); assert.ok(b[0].since > 0);
});

test("blocks count both ways: no follow, no join, no posts", async () => {
  const bo = await host("Bo Tran", "bo-block"), a = await person("Ann Ho"), b = await person("Ben Wu");
  await clubOn(bo); await post("/api/me/club/bo-block/join", {}, a.cookie); await post("/api/host/club/posts", { text: "Hello regulars" }, bo.cookie);
  // the member blocks the host
  assert.equal((await post("/api/me/blocks", { kind: "host", handle: "bo-block" }, a.cookie)).status, 200);
  assert.equal((await post("/api/me/club/bo-block/join", {}, a.cookie)).status, 403);
  assert.equal((await post("/api/me/following/bo-block", { on: true }, a.cookie)).status, 403);
  assert.ok(!Array.isArray((await getJ("/api/public/club/bo-block", a.cookie)).posts));
  // the host blocks a person
  const key = Buffer.from(b.email).toString("base64url");
  assert.equal((await post("/api/me/blocks", { kind: "person", key }, bo.cookie)).status, 200);
  const j = await post("/api/me/club/bo-block/join", {}, b.cookie); assert.equal(j.status, 403); assert.equal((await j.json()).code, "blocked");
  assert.equal((await post("/api/public/follow", { handle: "bo-block" }, b.cookie)).status, 403, "the old follow endpoint too");
  assert.equal((await getJ("/api/host/club", bo.cookie)).members.length, 0, "the blocked member is gone from the host's list");
});

test("rate limits on joins and posts", async () => {
  const bo = await host("Bo Tran", "bo-rate"), a = await person("Ann Ho");
  await clubOn(bo); const S = [];
  for (let i = 0; i < JOIN_PER_HOUR + 1; i++) { S.push((await post("/api/me/club/bo-rate/join", {}, a.cookie)).status); await post("/api/me/club/bo-rate/leave", {}, a.cookie); }
  assert.equal(S.filter((x) => x === 200).length, JOIN_PER_HOUR); assert.equal(S.at(-1), 429);
  for (let i = 0; i < POST_PER_HOUR; i++) assert.equal((await post("/api/host/club/posts", { text: "Update " + i }, bo.cookie)).status, 200);
  assert.equal((await post("/api/host/club/posts", { text: "One more" }, bo.cookie)).status, 429);
});

test("free at launch: no paid tiers, pledges or tip links inside the native app", async () => {
  const bo = await host("Bo Tran", "bo-paid");
  const r = await post("/api/host/profile", { support: { on: true, monthly: 5, yearly: 50, founding: 120 }, venmo: "bo-cooks", fanclubUrl: "https://patreon.com/bo" }, bo.cookie); assert.equal(r.status, 200, await r.text());
  const web = await getJ("/api/public/host/bo-paid"); assert.equal(web.paidHidden, undefined);
  const app = await getJ("/api/public/host/bo-paid", undefined, { "user-agent": APP_UA });
  assert.equal(app.paidHidden, true); assert.equal(app.host.support.on, false); assert.equal(app.host.support.monthly, 0); assert.equal(app.host.venmo, ""); assert.equal(app.host.fanclubUrl, "");
  const pl = await post("/api/public/pledge", { handle: "bo-paid", tier: "monthly", email: "x@example.com" }, undefined, { "user-agent": APP_UA }); assert.equal(pl.status, 403); assert.equal((await pl.json()).code, "web_only");
  // joining a club is free everywhere, app included
  await clubOn(bo); const a = await person("Ann Ho"); assert.equal((await post("/api/me/club/bo-paid/join", {}, a.cookie, { "user-agent": APP_UA })).status, 200);
  assert.equal(isNativeReq({ get: (k) => (k === "user-agent" ? APP_UA : "") }), true);
  assert.equal(stripPaid({ host: { support: { on: true, monthly: 9 } } }).host.support.monthly, 0);
  assert.match(fs.readFileSync(new URL("../docs/help.md", import.meta.url), "utf8"), /free at launch/i);
});

test("the members' chat: members and the host are in it, others aren't", async () => {
  const bo = await host("Bo Tran", "bo-chat"), mem = await person("Mia Park"), out = await person("Oli Chen");
  await clubOn(bo); const j = await (await post("/api/me/club/bo-chat/join", {}, mem.cookie)).json();
  let r = await post(`/api/chats/${j.chatId}/messages`, { text: "Hi all, first time here" }, mem.cookie); assert.equal(r.status, 200, await r.text());
  r = await get(`/api/chats/${j.chatId}`, bo.cookie); const t = await r.json(); assert.equal(r.status, 200); assert.ok(t.messages.some((m) => m.text === "Hi all, first time here")); assert.equal(t.event.title, "Bo's Regulars");
  assert.equal((await get(`/api/chats/${j.chatId}`, out.cookie)).status, 403);
  assert.ok((await getJ("/api/chats", mem.cookie)).chats.some((c) => c.id === j.chatId), "in the member's inbox");
  await post("/api/me/club/bo-chat/leave", {}, mem.cookie); assert.equal((await get(`/api/chats/${j.chatId}`, mem.cookie)).status, 403, "leaving the club leaves the chat");
});
