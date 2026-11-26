// Review round 16: Save to list on event pages, host pages and collection cards; "This is a public spot" in the editor
// and the New flow; the + sheet's way into the Host library and ideas; the line pin on /g; Potto's nudges in the Inbox.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
let srv;
const J = { "Content-Type": "application/json" };
before(async () => { Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "review16-secret", ENCORE_SIGNUP_PER_HOUR: "200", ENCORE_FAKE_EMAIL: "1" }); srv = await startServer(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv?.close?.(); });

test("Save to list: one data-pl-savelist button on event pages, host pages and collection cards, opened by save.js", () => {
  const save = read("public/save.js");
  assert.match(save, /function listButton\(item/, "save.js draws the Save to list button");
  assert.match(save, /closest\?\.\("\[data-pl-savelist\]"\)/, "save.js opens the sheet for any [data-pl-savelist] before savelist.js loads");
  assert.match(save, /if \(window\.PLSaveList\) return; const b = e\.target\.closest/, "and steps aside once savelist.js handles its own clicks");
  assert.match(read("public/friendsgoing.js"), /listButton\?\.\(\{ kind: "event", ref: id/, "the event page's Save row has Save to list");
  const shop = read("public/storeshop.js");
  assert.match(shop, /dataset\.plSavelist = JSON\.stringify\(\{ kind: "host", ref: h\.handle/, "the host page has Save to list next to Share");
  assert.match(shop, /t\.src = "\/save\.js"/, "and loads save.js on the first tap so the toast shows");
  const coll = read("public/collections.js");
  assert.match(coll, /class="plk-sl" data-pl-savelist=/, "each collection event card has a Save to list button");
  assert.match(coll, /\.plk-card \.plk-sl\{[^}]*z-index:2[^}]*width:44px;height:44px/, "above the card's link, 44px to tap");
  assert.ok(read("public/invite.html").length < 40000, "the invite stays under 40,000 characters");
});

test("Save to list takes a host from their page: the sheet adds them to a new list", async () => {
  const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name: "Lia List", email: "lia.r16@example.com", password: "long-password-1", mode: "friends" }) });
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  const h = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name: "Ren Host", email: "ren.r16@example.com", password: "long-password-1", mode: "friends" }) });
  const hc = (h.headers.get("set-cookie") || "").split(";")[0];
  assert.equal((await fetch(srv.base + "/api/host/profile", { method: "POST", headers: { ...J, cookie: hc }, body: JSON.stringify({ handle: "ren-r16", name: "Ren's Table", city: "Brooklyn" }) })).status, 200);
  const sh = await (await fetch(srv.base + "/api/me/library/sheet?kind=host&ref=ren-r16", { headers: { cookie } })).json();
  assert.ok(Array.isArray(sh.lists));
  const s = await fetch(srv.base + "/api/me/library/sheet", { method: "POST", headers: { ...J, cookie }, body: JSON.stringify({ item: { kind: "host", ref: "ren-r16", title: "Ren's Table" }, lists: [], newName: "Dinners to try" }) });
  const j = await s.json(); assert.equal(s.status, 200, JSON.stringify(j));
  assert.ok(j.lists.some((l) => l.name === "Dinners to try" && l.has), "the host is on the new list");
});

test("A public spot: the editor's Where sheet and the New flow both set placePublic, and only when ticked", () => {
  const cv = read("public/canvas.js");
  assert.match(cv, /sw\("cvPub", W\.placePublic === true, "This is a public spot"/, "a switch in the Where sheet");
  assert.match(cv, /if \(pub\) W\.placePublic = true; else delete W\.placePublic;/);
  const ix = read("index.html");
  assert.match(ix, /id="wzPub"[^>]*\$\{d\.placePublic===true\?" checked":""\}/, "a checkbox in the New flow's place step");
  assert.match(ix, /if\(pubB\.checked\) d\.placePublic=true; else delete d\.placePublic/);
  assert.doesNotMatch(cv + ix, /This is a public spot[^"]*—/, "no em dashes");
});

test("The + sheet leads to the Host library and ideas to host for anyone who can start an event", () => {
  const c = read("public/composer.js");
  assert.match(c, /T\.includes\("event"\) \? `<nav class="pc-reuse"/);
  assert.match(c, /href="\/library\/host" data-reuse="library"/); assert.match(c, /href="\/ideas" data-reuse="ideas"/);
  assert.match(c, /Your templates, past events, menus and guest lists/);
});

test("/g: the address row uses the line pin and lock, never an emoji", () => {
  const ix = read("index.html");
  assert.doesNotMatch(ix, /row\.innerHTML=`<span>📍<\/span>/); assert.doesNotMatch(ix, /row\.innerHTML=`<span>🔒<\/span>/);
  assert.match(ix, /row\.innerHTML=`<span class="ev2-ic" aria-hidden="true"><svg viewBox="0 0 24 24"[^`]*<circle cx="12" cy="9\.8"/, "the pin");
  assert.match(ix, /\.ev2-addr \.ev2-ic\{/);
});

test("The host path links each node to its written guide", () => {
  const p = read("public/path.html");
  assert.match(p, /Read the guide/); assert.match(p, /\/\^\\\/guides\\\/\[a-z0-9-\]\+\$\/\.test\(n\.guideHref/);
  assert.match(read("server/hostloop.js"), /import \{ GUIDES \} from "\.\/guides\.js"/);
  assert.match(read("server/hostloop.js"), /inboxNotify\(X, em, \{ kind: "nudge"/, "nudges go through the Inbox's notify()");
});

test("Brand bookings: the account rollup counts what's booked and spent this year, who came, the hosts and who booked", async () => {
  const { rollupOf } = await import("../server/brandbook.js");
  const r = (o) => ({ status: "booked", price: { totalCents: 100000 }, headcount: 10, host: { name: "Bo", handle: "bo" }, contactName: "Maya", ...o });
  const R = rollupOf([r({ id: "a", date: "2026-03-02", status: "done" }), r({ id: "b", date: "2026-12-10" }), r({ id: "c", date: "2026-12-01", host: { name: "Hoa", handle: "hoa" }, contactName: "Ken" }),
    r({ id: "d", date: "2025-05-01", status: "done" }), r({ id: "e", status: "requested", date: "2026-12-20" }), r({ id: "f", status: "declined", date: "2026-12-21" })], "2026-11-26");
  assert.equal(R.events, 3, "booked or done this year"); assert.equal(R.spentCents, 300000); assert.equal(R.guests, 20, "people at events that happened");
  assert.equal(R.upcoming, 2); assert.equal(R.next.id, "c", "the soonest booked one"); assert.equal(R.open, 1);
  assert.deepEqual(R.hosts.map((h) => [h.handle, h.n]), [["bo", 3], ["hoa", 1]]); assert.deepEqual(R.bookers.map((b) => b.name), ["Maya", "Ken"]);
  assert.equal(rollupOf([], "2026-11-26").events, 0);
  assert.match(read("public/team-bookings.html"), /const R = d\.rollup/); assert.match(read("server/brandbook.js"), /rollup: rollupOf\(V\)/);
});

test("Team bookings setup: four short steps, every step kept in the page so Save reads them all", () => {
  const h = read("public/host-teams.html");
  assert.match(h, /const STEPS = \[\["pkgs", "Packages"\], \["about", "About you"\], \["policy", "Cancellation"\], \["live", "Go live"\]\]/);
  for (const k of ["pkgs", "about", "policy", "live"]) assert.match(h, new RegExp(`<div data-step="${k}"`));
  assert.match(h, /el\.hidden = el\.dataset\.step !== STEPS\[step\]\[0\]/, "steps hide, never unmount");
  assert.match(h, /Still to add: /, "Go live says what's missing");
});
