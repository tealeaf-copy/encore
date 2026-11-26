// The library (server/library.js): old saves and boards still read the same, smart lists fill themselves, your own lists
// (create, edit, limits), share modes and what a shared link never shows, friends adding to a shared list, the
// save-to-list sheet, "Copy as a new event" from the host library, and account deletion taking it all away.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore } from "../server/workspaces.js";
import { LIMITS } from "../server/library.js";

let srv;
const J = { "Content-Type": "application/json" };
const req = (method, path, body, cookie) => fetch(srv.base + path, { method, headers: { ...J, ...(cookie ? { cookie } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const post = async (path, body, cookie) => (await req("POST", path, body, cookie)).json();
const del = async (path, cookie) => (await req("DELETE", path, undefined, cookie)).json();
const put = (path, body, cookie) => req("PUT", "/api/db/doc?path=" + path, body, cookie);
const get = async (path, cookie, status = 200) => { const r = await fetch(srv.base + path, { headers: cookie ? { cookie } : {} }); assert.equal(r.status, status, path); return r.json(); };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const wsOf = (handle) => srv.store.get("system/handle-" + handle).data.ws;
const X = () => srv.app.locals.social, Lib = () => srv.app.locals.library;
let n = 0;
async function account(name, email) { const r = await req("POST", "/api/signup", { name, email, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200, "signup " + email); return r.headers.get("set-cookie").split(";")[0]; }
async function host(email, handle, name) { const c = await account(name, email); const p = await post("/api/host/profile", { handle, name, tagline: "Small suppers.", emoji: "🍜", city: "Brooklyn", hood: "Bed-Stuy" }, c); assert.ok(p.ok, "profile"); return c; }
const rsvp = (handle, eventId, r) => scopeStore(srv.store, wsOf(handle)).set("rsvps/lr" + ++n, { eventId, response: "going", createdAt: Date.now(), ...r });

let ada, ben, cy, dee, hostC;
before(async () => {
  Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "library-secret", ENCORE_SIGNUP_PER_HOUR: "200", ENCORE_DIRECTORY_CACHE_MS: "0", ENCORE_FAKE_EMAIL: "1" }); resetLoginLimits();
  srv = await startServer();
  hostC = await host("mo.lib@example.com", "mo-supper", "Mo Rivera");
  const up = { startTime: "19:00", city: "Brooklyn", hood: "Bed-Stuy", headcount: 10, discoverable: true };
  assert.ok((await put("events/lbSup", { ...up, date: day(8), name: "Winter dumplings", activity: "dinner", coverPhoto: "/presets/atelier-bo-apt-cafe-club.jpg" }, hostC)).ok);
  assert.ok((await put("events/lbSecret", { ...up, date: day(9), name: "SECRET-LINK-ONLY birthday", discoverable: false, published: true }, hostC)).ok);
  assert.ok((await put("events/lbPast", { ...up, date: day(-10), name: "Autumn soup night", activity: "dinner", courses: ["Squash soup", "Rye bread", "Pear cake"], playlistUrl: "https://open.spotify.com/playlist/abc123", coverPhoto: "/presets/atelier-bo-banh-bo-popup.jpg",
    guests: [{ name: "Gil Guest", email: "gil.lib@example.com", status: "Attended" }, { name: "Nope Person", email: "nope.lib@example.com", status: "Declined" }] }, hostC)).ok);
  rsvp("mo-supper", "lbPast", { name: "Ada Lovel", email: "ada.lib@example.com" });
  rsvp("mo-supper", "lbSup", { name: "Ada Lovel", email: "ada.lib@example.com" });
  ada = await account("Ada Lovel", "ada.lib@example.com");
  ben = await account("Ben Okafor", "ben.lib@example.com");
  cy = await account("Cy Stranger", "cy.lib@example.com");
  dee = await account("Dee Gone", "dee.lib@example.com");
  await post("/api/public/follow", { handle: "mo-supper" }, ada); X().bust();
});
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_DIRECTORY_CACHE_MS", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv.close(); });

test("old saves and boards read the same, and every board is a list with the same id", async () => {
  await post("/api/me/saves", { kind: "event", ref: "lbSup", title: "Winter dumplings" }, ada);
  await post("/api/me/saves", { kind: "host", ref: "mo-supper" }, ada);
  const B = await post("/api/me/boards", { name: "Birthday ideas" }, ada); assert.ok(B.ok);
  await post("/api/me/saves", { kind: "idea", ref: "idea-saturday-run-club", board: B.board.id }, ada);
  const before = await get("/api/me/saves", ada);
  const Lb = await get("/api/me/library", ada);
  const list = Lb.lists.find((l) => l.id === B.board.id); assert.ok(list, "the board is a list"); assert.equal(list.name, "Birthday ideas"); assert.equal(list.count, 1); assert.equal(list.share, "private");
  assert.deepEqual(await get("/api/me/saves", ada), before, "reading the library leaves saves and boards as they were");
  // add to the board's list here: the save record isn't touched, the list shows both
  assert.ok((await post(`/api/me/library/lists/${B.board.id}/items`, { kind: "event", ref: "lbSup" }, ada)).added);
  assert.equal((await get("/api/me/library/lists/" + B.board.id, ada)).count, 2);
  assert.deepEqual((await get("/api/me/saves", ada)).items.map((i) => [i.ref, i.board]), before.items.map((i) => [i.ref, i.board]));
  // rename here renames the board; a board made on the old page shows up
  await post("/api/me/library/lists/" + B.board.id, { name: "Birthday plans" }, ada);
  assert.equal((await get("/api/me/saves", ada)).boards.find((b) => b.id === B.board.id).name, "Birthday plans");
  const B2 = await post("/api/me/boards", { name: "Later" }, ada);
  assert.ok((await get("/api/me/library", ada)).lists.some((l) => l.id === B2.board.id && l.name === "Later"));
  // taking the idea out of the board's list takes it off the board, and the save stays
  await del(`/api/me/library/lists/${B.board.id}/items?kind=idea&ref=idea-saturday-run-club`, ada);
  const S = await get("/api/me/saves", ada); assert.equal(S.items.find((i) => i.ref === "idea-saturday-run-club").board, "");
  // deleting the list deletes the board, never the saves
  await del("/api/me/library/lists/" + B2.board.id, ada);
  assert.ok(!(await get("/api/me/saves", ada)).boards.some((b) => b.id === B2.board.id)); assert.equal((await get("/api/me/saves", ada)).items.length, 3);
  // /saved still opens, now as the library
  for (const p of ["/saved", "/library", "/library/host"]) { const r = await fetch(srv.base + p); assert.equal(r.status, 200, p); assert.match(await r.text(), /Your library/); }
});

test("smart lists fill themselves: going, saved, hosts you follow, fan clubs, went; pinned by default", async () => {
  const Lb = await get("/api/me/library", ada);
  assert.deepEqual(Lb.smart.map((s) => s.id), ["going", "saved", "hosts", "clubs", "went"]);
  assert.ok(Lb.smart.every((s) => s.pinned), "pinned by default");
  const going = await get("/api/me/library/lists/going", ada); assert.deepEqual(going.items.map((i) => i.ref), ["lbSup"]);
  const went = await get("/api/me/library/lists/went", ada); assert.deepEqual(went.items.map((i) => i.ref), ["lbPast"]); assert.equal(went.items[0].status, "past");
  assert.equal((await get("/api/me/library/lists/saved", ada)).count, 3);
  assert.deepEqual((await get("/api/me/library/lists/hosts", ada)).items.map((i) => i.ref), ["mo-supper"]);
  assert.deepEqual((await get("/api/me/library/lists/clubs", ada)).items, []);
  // the club fills in once Ada joins
  await post("/api/host/club", { on: true }, hostC); await post("/api/me/club/mo-supper/join", {}, ada);
  assert.deepEqual((await get("/api/me/library/lists/clubs", ada)).items.map((i) => [i.kind, i.ref]), [["club", "mo-supper"]]);
  // the chips' items: each thing once, with where it lives; the past one is marked past
  const L2 = await get("/api/me/library", ada), sup = L2.items.filter((i) => i.ref === "lbSup");
  assert.equal(sup.length, 1); assert.ok(sup[0].in.includes("Going") && sup[0].in.includes("Saved")); assert.equal(L2.items.find((i) => i.ref === "lbPast").past, true);
  // unpin one, pin a list
  await post("/api/me/library/pins", { key: "smart:went", on: false }, ada);
  assert.equal((await get("/api/me/library", ada)).smart.find((s) => s.id === "went").pinned, false);
  assert.equal((await get("/api/me/library", "", 401)).code, "unauthenticated");
});

test("lists: create, edit, delete, private by default, with limits and a rate limit", async () => {
  const r = await post("/api/me/library/lists", { name: "  Cozy winter spots ", note: "For when it snows" }, ben);
  assert.equal(r.list.name, "Cozy winter spots"); assert.equal(r.list.share, "private"); assert.equal(r.list.token, ""); assert.equal(r.list.note, "For when it snows");
  assert.equal((await req("POST", "/api/me/library/lists", { name: "   " }, ben)).status, 400);
  assert.equal((await req("POST", "/api/me/library/lists", { name: "x" })).status, 401, "signed out");
  const id = r.list.id;
  assert.ok((await post(`/api/me/library/lists/${id}/items`, { kind: "event", ref: "lbSup", title: "Winter dumplings" }, ben)).added);
  assert.ok((await post(`/api/me/library/lists/${id}/items`, { kind: "event", ref: "lbSup" }, ben)).already, "no doubles");
  assert.ok((await post(`/api/me/library/lists/${id}/items`, { kind: "place", ref: "cafe-moto", title: "Cafe Moto", line: "Williamsburg" }, ben)).added);
  assert.equal((await req("POST", `/api/me/library/lists/${id}/items`, { kind: "event", ref: "../../x" }, ben)).status, 400);
  assert.equal((await req("POST", `/api/me/library/lists/${id}/items`, { kind: "nope", ref: "abc" }, ben)).status, 400);
  assert.equal((await req("POST", `/api/me/library/lists/${id}/items`, { kind: "event", ref: "lbSup" }, cy)).status, 404, "someone else's list");
  const L = await get("/api/me/library/lists/" + id, ben); assert.equal(L.count, 2); assert.equal(L.type, "Mixed"); assert.equal(L.covers.length, 2);
  assert.equal(L.items.find((i) => i.kind === "event").img, "/presets/atelier-bo-apt-cafe-club.jpg", "the cover comes from the event");
  await post("/api/me/library/lists/" + id, { name: "Cozy spots", note: "" }, ben);
  assert.equal((await get("/api/me/library/lists/" + id, ben)).name, "Cozy spots");
  // an outside picture never sticks
  const P = await post("/api/me/library/lists", { name: "Pics" }, ben); await post(`/api/me/library/lists/${P.list.id}/items`, { kind: "place", ref: "pixel", title: "P", img: "https://tracker.example/p.gif" }, ben);
  assert.equal((await get("/api/me/library/lists/" + P.list.id, ben)).items[0].img, "");
  assert.ok((await del("/api/me/library/lists/" + P.list.id, ben)).ok); assert.equal((await req("GET", "/api/me/library/lists/" + P.list.id, undefined, ben)).status, 404);
  // the caps, straight on the module
  const em = "cap.lib@example.com"; for (let i = 0; i < LIMITS.lists; i++) assert.ok(Lib().createList(em, { name: "L" + i }).list);
  assert.equal(Lib().createList(em, { name: "one more" }).code, "limit");
  const big = Lib().raw(em).lists[0]; for (let i = 0; i < LIMITS.items; i++) assert.ok(Lib().addItem(em, big.id, { kind: "place", ref: "p" + i, title: "P" }).ok);
  assert.equal(Lib().addItem(em, big.id, { kind: "place", ref: "pover", title: "P" }).code, "limit");
  // the hourly rate limit on making lists
  const c = await account("Rae Rate", "rae.lib@example.com"); let status = 200;
  for (let i = 0; i <= LIMITS.createPerHour && status === 200; i++) status = (await req("POST", "/api/me/library/lists", { name: "R" + i }, c)).status;
  assert.equal(status, 429);
});

test("share modes: a link is read only and shows only public things and first names; private kills the link", async () => {
  const r = await post("/api/me/library/lists", { name: "Date night ideas", note: "Somewhere quiet" }, ada), id = r.list.id;
  for (const it of [{ kind: "event", ref: "lbSup" }, { kind: "event", ref: "lbSecret", title: "SECRET-LINK-ONLY birthday" }, { kind: "host", ref: "mo-supper" }, { kind: "idea", ref: "idea-saturday-run-club" }]) await post(`/api/me/library/lists/${id}/items`, it, ada);
  const S = await post("/api/me/library/lists/" + id, { share: "link" }, ada); assert.equal(S.list.share, "link"); assert.match(S.list.link, /^\/l\/[A-Za-z0-9_-]{24}$/);
  const token = S.list.link.slice(3); assert.equal(S.list.items, undefined, "the update answer doesn't echo raw items");
  const V = await get("/api/public/lists/" + token); // signed out
  assert.equal(V.name, "Date night ideas"); assert.equal(V.by, "Ada"); assert.equal(V.mode, "link"); assert.equal(V.canAdd, false); assert.equal(V.isOwner, false); assert.equal(V.id, undefined);
  assert.deepEqual(V.items.map((i) => i.ref).sort(), ["idea-saturday-run-club", "lbSup", "mo-supper"], "the link-only event stays out");
  const txt = JSON.stringify(V); for (const bad of ["SECRET", "lib@example.com", "Lovel", "Rivera", "\"by\":\"ada", "token"]) assert.ok(!txt.includes(bad), bad);
  assert.equal(V.items.find((i) => i.ref === "lbSup").host, "Mo", "the host by first name");
  assert.equal((await req("POST", `/api/public/lists/${token}/items`, { kind: "event", ref: "lbSup" }, ben)).status, 403, "a link is read only");
  assert.equal((await fetch(srv.base + "/l/" + token)).status, 200);
  // guessing doesn't work
  for (const t of ["x", "A".repeat(24), token.slice(0, 23) + (token.at(-1) === "A" ? "B" : "A")]) assert.equal((await fetch(srv.base + "/api/public/lists/" + t)).status, 404);
  // the token is random and stored as a hash
  assert.ok(!JSON.stringify(srv.store.dumpPrefix("system/pllibtok-")).includes(token), "the token is stored as a hash");
  // back to private: the old link is dead; sharing again makes a new link
  await post("/api/me/library/lists/" + id, { share: "private" }, ada); assert.equal((await fetch(srv.base + "/api/public/lists/" + token)).status, 404);
  const S2 = await post("/api/me/library/lists/" + id, { share: "link" }, ada); assert.notEqual(S2.list.link, S.list.link);
  const S3 = await post("/api/me/library/lists/" + id, { rotate: true }, ada); assert.notEqual(S3.list.link, S2.list.link); assert.equal((await fetch(srv.base + "/api/public" + S2.list.link.replace("/l/", "/lists/"))).status, 404);
  // a members-only event never shows on a shared list
  scopeStore(srv.store, wsOf("mo-supper")).set("clubevents/lbSup", { only: true }); X().bust();
  assert.ok(!(await get("/api/public" + S3.list.link.replace("/l/", "/lists/"))).items.some((i) => i.ref === "lbSup"));
  scopeStore(srv.store, wsOf("mo-supper")).delete("clubevents/lbSup");
});

test("shared with friends: friends open it from their library and add to it; others can't", async () => {
  X().addFriend("ada.lib@example.com", "ben.lib@example.com");
  const r = await post("/api/me/library/lists", { name: "To host someday", share: "friends" }, ada), id = r.list.id, token = r.list.token;
  assert.match(token, /^[A-Za-z0-9_-]{24}$/);
  await post(`/api/me/library/lists/${id}/items`, { kind: "idea", ref: "idea-saturday-run-club" }, ada);
  // Ben (Ada's friend) sees it under Shared with you, can open and add
  const BL = await get("/api/me/library", ben); const sh = BL.shared.find((s) => s.token === token); assert.ok(sh); assert.equal(sh.by, "Ada"); assert.equal(sh.count, 1);
  const V = await get("/api/public/lists/" + token, ben); assert.equal(V.canAdd, true); assert.equal(V.mode, "friends");
  assert.ok((await post(`/api/public/lists/${token}/items`, { kind: "event", ref: "lbSup", title: "Winter dumplings" }, ben)).added);
  const owner = await get("/api/me/library/lists/" + id, ada); assert.equal(owner.items.find((i) => i.ref === "lbSup").addedBy, "Ben"); assert.deepEqual(owner.contributors, ["Ben"]);
  const V2 = await get("/api/public/lists/" + token, ben); assert.equal(V2.items.find((i) => i.ref === "lbSup").addedBy, "Ben"); assert.ok(!JSON.stringify(V2).includes("@example.com"));
  // Cy isn't a friend: no view, no add, and it isn't in Cy's library
  assert.equal((await get("/api/public/lists/" + token, cy, 403)).code, "friends_only");
  assert.equal((await get("/api/public/lists/" + token, "", 403)).by, "Ada");
  assert.equal((await req("POST", `/api/public/lists/${token}/items`, { kind: "event", ref: "lbPast" }, cy)).status, 403);
  assert.ok(!(await get("/api/me/library", cy)).shared.length);
  // Ben can take out what he added, not Ada's
  assert.equal((await req("DELETE", `/api/public/lists/${token}/items?kind=idea&ref=idea-saturday-run-club`, undefined, ben)).status, 403);
  assert.ok((await del(`/api/public/lists/${token}/items?kind=event&ref=lbSup`, ben)).removed);
  // friend adds are rate limited
  let status = 200; for (let i = 0; i <= LIMITS.friendAddsPerHour && status === 200; i++) status = (await req("POST", `/api/public/lists/${token}/items`, { kind: "place", ref: "spot-" + i, title: "Spot" }, ben)).status;
  assert.ok(status === 429 || status === 400);
});

test("the save-to-list sheet: Saved first, your lists, friends' lists, the last one used, and + New list", async () => {
  const c = await account("Sam Sheet", "sam.lib@example.com");
  const A = await post("/api/me/library/lists", { name: "Cozy winter spots" }, c), B = await post("/api/me/library/lists", { name: "Date night ideas" }, c);
  let Sh = await get("/api/me/library/sheet?kind=event&ref=lbSup", c); assert.equal(Sh.saved, false); assert.equal(Sh.canSave, true); assert.equal(Sh.last, ""); assert.equal(Sh.lists.length, 2);
  // pick one list and save: it becomes the last used, and comes first next time
  const R = await post("/api/me/library/sheet", { item: { kind: "event", ref: "lbSup", title: "Winter dumplings" }, lists: [B.list.id], saved: true }, c);
  assert.deepEqual(R.added, [B.list.id]); assert.equal(R.saved, true); assert.equal(R.last, B.list.id);
  assert.ok((await get("/api/me/saves", c)).items.some((i) => i.ref === "lbSup"), "Saved in the sheet is the heart");
  Sh = await get("/api/me/library/sheet?kind=host&ref=mo-supper", c); assert.equal(Sh.last, B.list.id); assert.equal(Sh.lists[0].id, B.list.id, "last used first");
  assert.equal(Sh.lists.find((l) => l.id === A.list.id).has, false);
  // a new list from the sheet, and moving out of one
  const N = await post("/api/me/library/sheet", { item: { kind: "event", ref: "lbSup" }, lists: [], newName: "To host someday", saved: true }, c);
  assert.ok(N.created && N.created.name === "To host someday"); assert.deepEqual(N.removed, [B.list.id]); assert.equal(N.last, N.created.id);
  assert.equal(N.lists.find((l) => l.id === N.created.id).has, true);
  // a friend's shared list shows in the sheet and takes adds
  X().addFriend("ada.lib@example.com", "sam.lib@example.com");
  const F = await post("/api/me/library/lists", { name: "Group dinner", share: "friends" }, ada);
  Sh = await get("/api/me/library/sheet?kind=event&ref=lbPast", c); const fs1 = Sh.shared.find((x) => x.name === "Group dinner"); assert.ok(fs1); assert.match(fs1.id, /^t:/);
  const R2 = await post("/api/me/library/sheet", { item: { kind: "event", ref: "lbPast" }, lists: [fs1.id] }, c); assert.ok(R2.added.includes(fs1.id));
  assert.equal((await get("/api/me/library/lists/" + F.list.id, ada)).items[0].addedBy, "Sam");
  assert.equal((await req("POST", "/api/me/library/sheet", { item: { kind: "event", ref: "<script>" }, lists: [] }, c)).status, 400);
  assert.equal((await req("GET", "/api/me/library/sheet?kind=event&ref=lbSup")).status, 401);
});

test("host library: past events, menus, playlists, covers, guest lists and templates; Copy as a new event", async () => {
  assert.equal((await get("/api/me/library", hostC)).isHost, true); assert.equal((await get("/api/me/library", ben)).isHost, false, "a guest sees no Host library row");
  const H = await get("/api/host/library", hostC);
  assert.deepEqual(H.past.map((e) => e.id), ["lbPast"]); assert.equal(H.past[0].guests, 2, "Gil came, Ada replied going");
  assert.deepEqual(H.menus[0].lines, ["Squash soup", "Rye bread", "Pear cake"]);
  assert.equal(H.playlists[0].url, "https://open.spotify.com/playlist/abc123"); assert.equal(H.playlists[0].host, "open.spotify.com");
  assert.ok(H.covers.some((c) => c.img === "/presets/atelier-bo-banh-bo-popup.jpg"));
  assert.equal(H.guests[0].count, 2); assert.deepEqual(H.guests[0].names.sort(), ["Ada", "Gil"]); assert.ok(!JSON.stringify(H).includes("@example.com"), "no emails in the library view");
  // Copy as a new event: same title and menu, no date, unpublished, no guests, opens in the create flow
  const C1 = await post("/api/host/library/start", { from: "event", id: "lbPast" }, hostC); assert.match(C1.open, /^\/\?app=1&open=.+#studio$/);
  const ev = scopeStore(srv.store, wsOf("mo-supper")).get("events/" + C1.id).data;
  assert.equal(ev.name, "Autumn soup night"); assert.deepEqual(ev.courses, ["Squash soup", "Rye bread", "Pear cake"]); assert.equal(ev.date, ""); assert.equal(ev.published, false); assert.deepEqual(ev.guests, []); assert.equal(ev.discoverable, undefined);
  // a guest list starts a new event with those people, not invited yet; the one who said no stays off
  const G = await post("/api/host/library/start", { from: "guests", id: "lbPast" }, hostC); const g = scopeStore(srv.store, wsOf("mo-supper")).get("events/" + G.id).data.guests;
  assert.deepEqual(g.map((x) => x.email).sort(), ["ada.lib@example.com", "gil.lib@example.com"]); assert.ok(g.every((x) => x.status === "Not invited"));
  // menu, playlist and cover each start a draft carrying just that
  assert.deepEqual(scopeStore(srv.store, wsOf("mo-supper")).get("events/" + (await post("/api/host/library/start", { from: "menu", id: "lbPast" }, hostC)).id).data.courses.length, 3);
  assert.equal(scopeStore(srv.store, wsOf("mo-supper")).get("events/" + (await post("/api/host/library/start", { from: "playlist", id: "lbPast" }, hostC)).id).data.playlistUrl, "https://open.spotify.com/playlist/abc123");
  // save as a template, start from it, delete it
  const T = await post("/api/host/library/templates", { eventId: "lbSup", name: "Dumpling night" }, hostC); assert.equal(T.template.title, "Dumpling night");
  assert.equal((await get("/api/host/library", hostC)).templates[0].title, "Dumpling night");
  const fromT = await post("/api/host/library/start", { from: "template", id: T.template.id }, hostC); assert.equal(scopeStore(srv.store, wsOf("mo-supper")).get("events/" + fromT.id).data.name, "Winter dumplings");
  assert.ok((await del("/api/host/library/templates/" + T.template.id, hostC)).ok);
  // only your own events; guests aren't hosts
  assert.ok([403, 404].includes((await req("POST", "/api/host/library/start", { from: "event", id: "lbPast" }, ben)).status), "someone else's event");
  const other = await req("GET", "/api/host/library", undefined, ben); if (other.status === 200) assert.ok(!JSON.stringify(await other.json()).includes("lbPast"), "only your own workspace"); else assert.equal(other.status, 403);
  assert.equal((await req("POST", "/api/host/library/start", { from: "nothing", id: "lbPast" }, hostC)).status, 400);
});

test("deleting an account takes its lists, share links and what it added to friends' lists", async () => {
  X().addFriend("ada.lib@example.com", "dee.lib@example.com");
  const own = await post("/api/me/library/lists", { name: "Dee's spots", share: "link" }, dee);
  const F = await post("/api/me/library/lists", { name: "Dee helps", share: "friends" }, ada);
  assert.ok((await post(`/api/public/lists/${F.list.token}/items`, { kind: "event", ref: "lbSup" }, dee)).added);
  const r = await req("POST", "/api/me/delete", { confirm: "DELETE", when: "now" }, dee); assert.equal(r.status, 200);
  assert.equal((await fetch(srv.base + "/api/public/lists/" + own.list.token)).status, 404, "the share link is gone");
  const left = JSON.stringify(srv.store.dumpPrefix("system/pllib")); assert.ok(!left.includes("dee.lib@example.com"), "no trace of Dee in any library doc");
  assert.equal((await get("/api/me/library/lists/" + F.list.id, ada)).count, 0, "what Dee added is gone from Ada's list");
});

test("pages: the library, the sheet and the Me sheet", () => {
  const html = fs.readFileSync(new URL("../public/library.html", import.meta.url), "utf8"), sheet = fs.readFileSync(new URL("../public/savelist.js", import.meta.url), "utf8"), save = fs.readFileSync(new URL("../public/save.js", import.meta.url), "utf8");
  for (const s of ["Your library", "Events", "Hosts", "Clubs", "Ideas", "Places", "Past", "Recents", "A to Z", "Date added", "Host library", "Start from this", "Copy as a new event"]) assert.ok(html.includes(s), s);
  assert.ok(!/\u2014/.test(html + sheet), "no em dashes");
  assert.match(sheet, /Save to list/); assert.match(sheet, /New list/);
  assert.match(save, /PLSaveList/, "the heart's toast opens the list sheet");
  assert.match(fs.readFileSync(new URL("../public/chatnav.js", import.meta.url), "utf8"), /row\("\/library", "Library"/);
});
