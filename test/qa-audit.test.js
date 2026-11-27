// Regressions from the click-everything audit (scripts/click-audit.mjs, docs/qa-audit.md): each test pins one glitch a
// person hit by tapping through the app, so it can't come back quietly.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";

let srv, host, seller;
const J = { "content-type": "application/json" };
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "qa-audit-secret-0123456789", ENCORE_FAKE_EMAIL: "1", ENCORE_SIGNUP_PER_HOUR: "200" };
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const post = (p, body, cookie) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const join = async (name, email) => { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200); return r.headers.get("set-cookie").split(";")[0]; };

before(async () => { Object.assign(process.env, ENV); srv = await startServer(); host = await join("Mai Pham", "mai.qa@example.com"); seller = await join("Bo Tran", "bo.qa@example.com");
  assert.ok((await post("/api/host/profile", { handle: "bo-qa", name: "Bo Bakes", city: "Brooklyn", hood: "Sunset Park", tagline: "Pandan on Saturdays." }, seller)).ok); });
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

test("pages sent straight from a route (brand, admin) get the app head: the page-fade opt-in, its quiet handler and netguard", async () => {
  // a move into a brand page found no fade opt-in there and threw "Transition was aborted" as an unhandled rejection
  for (const p of ["/teams/discover", "/teams/home"]) { const h = await (await fetch(srv.base + p)).text();
    assert.match(h, /@view-transition\{navigation:auto\}/, p); assert.match(h, /\/netguard\.js/, p); assert.match(h, /addEventListener\("pagereveal"/, p);
    assert.equal(h.match(/rel="manifest"/g).length, 1, p + " gets the tags once"); }
});

test("the light invite opts in to the page fade too, and stays under 40,000 characters", async () => {
  await fetch(srv.base + "/api/db/doc?path=events/qaInv", { method: "PUT", headers: { ...J, cookie: host }, body: JSON.stringify({ name: "Dumpling night", date: "2031-05-02", startTime: "19:00", published: true, city: "Brooklyn" }) });
  const h = await (await fetch(srv.base + "/e/qaInv")).text(); assert.match(h, /\(prefers-reduced-motion:no-preference\)\{@view-transition\{navigation:auto\}\}/); assert.ok(h.length < 40000, String(h.length));
  assert.ok(read("public/invite.html").length < 40000);
});

test("a drop that takes orders any time shows on its seller's Plans on the next pickup day", async () => {
  const d = await (await post("/api/host/drops", { title: "Buns on Sunday", items: [{ name: "Coconut bun", price: "6" }], slots: ["Sun 9 to 10am"], area: "Sunset Park", always: true, pay: "pickup" }, seller)).json(); assert.ok(d.id);
  const T = await (await post("/api/plans/timeline", { proofs: [] }, seller)).json(), it = (T.items || []).find((i) => i.eventId === d.id);
  assert.ok(it, "the drop is on Plans: " + JSON.stringify((T.items || []).map((i) => i.eventId)));
  assert.match(it.date || "", /^\d{4}-\d{2}-\d{2}$/); assert.equal(new Date(it.date + "T12:00:00Z").getUTCDay(), 0, "on a Sunday");
});

test("the host page has a way to join the fan club (the join notice links to /@handle#club)", () => {
  // main's card (public/fanclub.js, mounted by the host page) is the way in: join, leave, and the #club anchor
  const h = read("public/host.html"), c = read("public/fanclub.js"); assert.match(h, /<script src="\/fanclub\.js"><\/script>/); assert.match(h, /EncoreClub\?\.mount\(h, d\)/);
  assert.match(c, /id = "club"/); assert.match(c, /\/api\/me\/club\//); assert.match(c, /Join, it's free/); assert.match(c, /Leave the club/);
});

test("check-in at the door counts a double tap once (host planner and brand campaigns)", () => {
  assert.match(read("public/invite-plan.js"), /\[data-here\][\s\S]{0,80}if \(b\.dataset\.saving \|\| Date\.now\(\) - \(\+b\.dataset\.at \|\| 0\) < 700\) return;/);
  assert.match(read("public/invite-plan.js"), /b\.dataset\.saving = "1"; try \{ await dbPatch\("rsvps\/"/);
  assert.match(read("public/teams-campaigns.html"), /\[data-in\][\s\S]{0,80}if \(b\.dataset\.saving \|\| Date\.now\(\) - \(\+b\.dataset\.at \|\| 0\) < 700\) return;/);
});

test("sheets: /start's save sheet closes on Esc, and an aria-modal sheet keeps Tab inside", () => {
  assert.match(read("public/start.html"), /onKey = \(e\) => \{ if \(e\.key === "Escape"\) close\(\); \}/);
  assert.match(read("public/start.html"), /next=%2Fstart%3Fsave%3D1/);
  assert.match(read("public/netguard.js"), /aria-modal="true"[\s\S]{0,600}e\.key !== "Tab"|e\.key !== "Tab"[\s\S]{0,600}aria-modal="true"/);
});

test("feed card headers: the report button's hit area stays around the button, not over the host link", () => {
  assert.match(read("public/feedvisual.js"), /\.fb-lead \.sf-more\{position:relative;/); assert.doesNotMatch(read("public/feedvisual.js"), /\.fb-lead \.sf-more\{position:static/);
});

test("the full invite: Open in app opens the event in the app, and a reply made on another phone changes with its code", () => {
  const h = read("index.html"); assert.doesNotMatch(h, /onclick="try\{localStorage\.setItem\('encore-open',\$\{JSON\.stringify\(JSON\.stringify/); assert.match(h, /href="\/\?app=1&open=\$\{encodeURIComponent\(id\)\}#studio">Manage/);
  assert.match(h, /if\(M\.rid&&M\.code\)\{[^}]*fetch\("\/api\/public\/reply\/"/);
  assert.match(read("public/comewith.js"), /if \(tk && !onTk && now - at < 500\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); return; \}/, "the second tap of a double tap on Send doesn't reach the ticket");
});

test("phone tap targets: brand links and text buttons, footers, the share sheet's dots, inbox rows reach 44px", () => {
  assert.match(read("public/brandbook.css"), /@media \(max-width:860px\)\{[\s\S]*body\.bb \.bb-link\{min-height:44px/, "main's version of the brand pages' 44px targets");
  assert.match(read("public/system.css"), /footer a:not\(\[class\]\)\{min-width:44px/);
  assert.match(read("public/sharekit.js"), /\.plsh-dots button\{width:44px;height:44px;/);
  assert.match(read("public/inbox.html"), /\.ib-b\{min-height:44px;/); assert.match(read("public/inbox.html"), /\.ib-more\{width:44px;height:44px;/);
  assert.match(read("public/brandbook.css"), /\.bb-cal button\.d\.open\{cursor:pointer\}/, "a date you can't pick doesn't look tappable");
});

test("first paint holds the space: the feed's stories row for everyone, Discover's shelves", () => {
  const f = read("public/feed.html"); assert.match(f, /\.rail-wait:empty\{min-height:\d+px/); assert.match(f, /else \{ const r = document\.getElementById\("rail"\); r\.classList\.add\("rail-wait"\);/, "signed out too (main's version)");
  // Coming up waits unseen for the shelves' answer, so it is drawn once in its place (main's version)
  assert.match(read("public/discover.html"), /body\.dc-wait #evSec,body\.dc-wait #forYou\{visibility:hidden\}/);
  // Discover reserves room only for the shelves the last visit really had (public/collections.js), never a fixed block
  assert.doesNotMatch(read("public/discover.html"), /#plShelves:empty\{min-height/); assert.match(read("public/collections.js"), /!el\.children\.length && seen > 0\) \{ el\.classList\.add\("plk-shelves"\)/);
});

test("no flash of the wrong page: the studio waits for the workspace, brand pages hold the top bar's space", () => {
  const h = read("index.html"); assert.match(h, /localStorage\.getItem\("pl\.wsPersonal"\)/); assert.match(h, /html\.hv-wait #view-studio\{display:none!important\}/);
  assert.match(read("public/brandbook.css"), /body\.bb\[data-top\]:not\(:has\(> \.bb-top\)\)\{padding-top:57px\}/);
  for (const f of ["brand-discover", "teams-home", "teams-campaigns", "team-bookings", "experience", "checkout"]) assert.match(read(`public/${f}.html`), /<body class="bb[^"]*" data-top>/, f);
  assert.match(read("public/comewith.js"), /id === "_preview" \|\| tgAsked === id\) return;/, "the canvas preview doesn't ask for replies");
});

test("desktop: Discover's shelves fit the page (the fifth card was cut off and out of reach), the feed holds its wide column", () => {
  assert.match(read("public/collections.js"), /\.plk-shelves\{display:grid;grid-template-columns:minmax\(0,1fr\);/);
  assert.match(read("public/feed.html"), /body\.pre-feed \.fgrid\{grid-template-columns:minmax\(0,960px\)!important\}/, "main's version: the wide column before the feed is drawn");
  assert.match(read("public/netguard.js"), /scrollbarGutter = "stable"/);
});

test("sheets close on Esc and give focus back: collabs, follow and account sheets, and any aria-modal sheet", () => {
  assert.equal((read("public/collab.js").match(/if \(e\.key === "Escape"\) close\(\)/g) || []).length, 2);
  assert.equal((read("public/account.js").match(/onKey = \(e\) => \{ if \(e\.key === "Escape"\)/g) || []).length, 3);
  assert.match(read("public/netguard.js"), /let t = back\?\.isConnected && back\.getClientRects\(\)\.length \? back :/); assert.match(read("public/netguard.js"), /t\?\.focus\(\{ preventScroll: true \}\)/);
});
