// Review round 8: pre-orders rebuilt on the server (items and quantities, never free text or prices), the order email,
// host search that reads bios and talks, MCP arguments checked, kudos chips that fit the event, the at-the-event kudos
// code, signed-in /login and /signup, and copy fixes.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore } from "../server/workspaces.js";
import { fakeOutbox } from "../server/email.js";
import { buildOrder, slotLabel } from "../server/preorder.js";
import { kudosTagsFor, kudosKindOf } from "../server/social.js";
import { leaderboardCategory } from "../server/directory.js";

let srv, host, ws;
const J = { "Content-Type": "application/json" };
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const post = (path, body, h = {}) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...h }, body: JSON.stringify(body) });
const put = (id, d, cookie = host) => fetch(srv.base + "/api/db/doc?path=events/" + id, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(d) });
const guestHdr = (key) => ({ "x-encore-guest": "1", "x-encore-key": key, "x-encore-workspace": ws });
const reply = (body, key = "r8-key-" + Math.random().toString(36).slice(2)) => post("/api/db/collection?path=rsvps", { response: "going", createdAt: Date.now(), code: "R8" + Math.random().toString(36).slice(2, 6).toUpperCase(), ...body }, guestHdr(key));
const rpc = async (name, args) => (await post("/mcp/public", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, ...(args !== undefined ? { arguments: args } : {}) } })).json();
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "r8-secret", ENCORE_FAKE_EMAIL: "1", ENCORE_SIGNUP_PER_HOUR: "100", ENCORE_DIRECTORY_CACHE_MS: "0", ENCORE_KUDOS_GROUP_PER_IP: "1000", ENCORE_KUDOS_GROUP_PER_EVENT: "1000" };

async function signup(name, email, extra = {}) {
  const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200, "signup " + email);
  const c = r.headers.get("set-cookie").split(";")[0];
  if (extra.handle) assert.ok((await post("/api/host/profile", { name, city: "Brooklyn", hood: "Bed-Stuy", emoji: "🍞", tagline: "Small things for new friends.", ...extra }, { cookie: c })).ok);
  return c;
}

before(async () => {
  Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer();
  host = await signup("Priya Shah", "priya.r8@example.com", { handle: "crumb-r8" });
  ws = srv.store.get("system/handle-crumb-r8").data.ws;
  assert.ok((await put("r8bake", { kind: "social", casual: true, name: "Sourdough pre-orders", date: day(5), startTime: "10:00", published: true, preorder: true, ticketUrl: "https://venmo.com/u/priya", slots: ["10:00–11:00", "11:00–12:00"], orderItems: [{ name: "Country loaf", price: 12 }, { name: "Focaccia", price: 9 }] })).ok);
  assert.ok((await put("r8party", { kind: "social", casual: true, name: "Game night", date: day(5), published: true })).ok);
});
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

test("pre-orders: the server writes the order and total from the event's items; bad quantities are refused", async () => {
  const St = scopeStore(srv.store, ws);
  // a good order: items and quantities in, the order line, lines and total out
  const m0 = fakeOutbox.length;
  let r = await reply({ eventId: "r8bake", name: "Ben Ito", email: "ben.r8@example.com", slot: "10:00–11:00", orderQty: [{ i: 0, qty: 2 }, { i: 1, qty: 1 }], order: "100 × free bread · $0" });
  assert.equal(r.status, 200); const rid = String((await r.json()).id).split("/").pop(), d = St.get("rsvps/" + rid).data;
  assert.equal(d.order, "2 × Country loaf, 1 × Focaccia · pickup 10am to 11am · $33", "built from the menu, not the text the guest sent");
  assert.equal(d.orderTotal, 33); assert.deepEqual(d.orderLines.map((x) => [x.name, x.qty, x.price]), [["Country loaf", 2, 12], ["Focaccia", 1, 9]]);
  // the confirmation email is the order
  const mail = fakeOutbox.slice(m0).find((x) => String(x.to).includes("ben.r8@example.com"));
  assert.ok(mail, "an order email went out"); assert.equal(mail.subject, "Your order: Sourdough pre-orders");
  assert.match(mail.text, /2 × Country loaf/); assert.match(mail.text, /Total: \$33/); assert.match(mail.text, /Pickup: 10am to 11am/); assert.match(mail.text, /Pay \$33 here: https:\/\/venmo\.com\/priya\?txn=pay&amount=33/);
  assert.doesNotMatch(mail.text, /You're in/);
  // negative, absurd, fractional and off-menu quantities are refused
  for (const orderQty of [[{ i: 0, qty: -2 }], [{ i: 0, qty: 9999 }], [{ i: 0, qty: 1.5 }], [{ i: 7, qty: 1 }], [{ i: 0, qty: 0 }], "lots"]) {
    r = await reply({ eventId: "r8bake", name: "Cy", email: "cy.r8@example.com", orderQty });
    assert.equal(r.status, 400, JSON.stringify(orderQty)); assert.equal((await r.json()).code, "invalid_order"); }
  // free text without quantities is dropped on a pre-order with a menu, and an order never lands on an event that isn't one
  // review round 11: so I'm in with only free text is "Pick something first." (a pre-order with a menu needs an order)
  r = await reply({ eventId: "r8bake", name: "Di", email: "di.r8@example.com", order: "20 × Country loaf · $1" }); assert.equal(r.status, 400); assert.equal((await r.json()).message, "Pick something first.");
  r = await reply({ eventId: "r8bake", name: "Di", email: "di.r8@example.com", order: "20 × Country loaf · $1", response: "maybe" }); assert.equal(r.status, 200);
  assert.equal(St.get("rsvps/" + String((await r.json()).id).split("/").pop()).data.order, undefined);
  r = await reply({ eventId: "r8party", name: "Ed", email: "ed.r8@example.com", order: "2 × Country loaf" }); assert.equal(r.status, 200);
  assert.equal(St.get("rsvps/" + String((await r.json()).id).split("/").pop()).data.order, undefined);
  // the pure helpers
  assert.equal(slotLabel("12:00–1:00"), "12pm to 1pm"); assert.equal(slotLabel("11-1pm"), "11am to 1pm"); assert.equal(slotLabel("18:00-19:30"), "6pm to 7:30pm");
  assert.deepEqual(buildOrder({ preorder: false }, { orderQty: [{ i: 0, qty: 1 }] }), {});
  // the guest's page sends items and quantities, and reads pickup times the brand's way
  const order = read("public/invite-order.js"); assert.match(order, /orderQty: lines\.map\(\(x\) => \(\{ i: x\.i, qty: qty\[x\.id\] \}\)\)/); assert.match(order, /esc\(slotLabel\(x\)\)/);
});

test("a baker's pre-order: How do guests pay?, Guests order for pickup, outline list buttons, no Where is it? with a neighborhood", () => {
  const app = read("index.html");
  assert.match(app, /if\(!\(rr3Paid\(d\)\|\|r8PricedOrder\(d\)\)\|\|d\.ticketUrl\|\|d\.ticketNote\) return;/);
  assert.match(app, /t:"How do guests pay\?",w:"Add a pay link, or say they pay at pickup\.",acts:\[\["Add pay link",\(\)=>window\.openPayEdit\?\.\(\)\]\]/);
  assert.match(app, /d\?\.preorder\?"Guests order for pickup\."/);
  assert.match(app, /<button class="btn sm ghost pb-act" type="button" data-pbact=/);
  assert.match(app, /const r8W=d\.meetPoint\|\|d\.venueName\|\|d\.hood\|\|d\.city/);
  assert.doesNotMatch(app, /"Where is it\?",w:!d\.startTime\?"Guests need to know when\.":"",acts:\[\[!d\.startTime&&!\(d\.meetPoint\|\|d\.venueName\)/);
});

test("host search reads bios, talk topics, services and package names; speaker finds talks", async () => {
  await signup("Sam Rivera", "sam.r8@example.com", { handle: "sam-r8", bio: "I teach sourdough to beginners.", forHire: true, services: "Bread workshops for teams", experiences: [{ name: "Keynote on community", desc: "Keynote on community", min: 20, max: 300, price: "2000 flat" }] });
  const L = async (q) => (await (await fetch(srv.base + "/api/v1/hosts?q=" + encodeURIComponent(q))).json()).data.map((h) => h.handle);
  assert.ok((await L("sourdough beginners")).includes("sam-r8"), "the bio");
  assert.ok((await L("bread workshops")).includes("sam-r8"), "services");
  assert.ok((await L("keynote")).includes("sam-r8"), "a package name");
  assert.ok((await L("speaker")).includes("sam-r8"), "speaker means talks and keynotes");
  assert.ok(!(await L("speaker")).includes("crumb-r8"));
});

test("MCP: arguments must be an object, booleans boolean, leaderboard categories known (dining is supper)", async () => {
  for (const args of [[1, 2], "city=Brooklyn", 5]) assert.equal((await rpc("list_hosts", args)).error?.code, -32602, JSON.stringify(args));
  assert.equal((await rpc("find_hosts", { include_examples: "yes" })).error?.code, -32602);
  assert.ok((await rpc("find_hosts", { include_examples: "false" })).result, "\"false\" is fine");
  assert.ok((await rpc("search_events", { include_examples: true })).result);
  assert.equal((await rpc("find_hosts", { verified_only: 3 })).error?.code, -32602);
  const bad = await rpc("get_leaderboard", { category: "wizardry" }); assert.equal(bad.error?.code, -32602); assert.match(bad.error.message, /supper, movement/);
  const dining = await rpc("get_leaderboard", { category: "dining" }); assert.ok(dining.result && !dining.result.isError, JSON.stringify(dining));
  assert.equal(JSON.parse(dining.result.content[0].text).data.category, "supper");
  assert.equal(leaderboardCategory("Runs"), "movement"); assert.equal(leaderboardCategory("talk"), "talks"); assert.equal(leaderboardCategory("nope"), "");
  assert.equal((await fetch(srv.base + "/api/v1/hosts/find?verified_only=maybe")).status, 400);
});

test("kudos chips fit the event: food only for food, pace and route for runs, learned for classes; Would go again first", async () => {
  const ids = (ev) => kudosTagsFor(ev).map((x) => x[0]);
  assert.deepEqual(ids({ activity: "run", name: "Weekly run club" }).slice(0, 3), ["again", "pace", "route"]);
  assert.ok(!ids({ name: "Sunday hike" }).includes("food"));
  assert.deepEqual(ids({ name: "Wheel throwing course" }).slice(0, 3), ["again", "learned", "teacher"]);
  assert.equal(ids({ name: "Supper club" })[1], "food"); assert.equal(kudosKindOf({ name: "Game night" }), "other"); assert.ok(!ids({ name: "Game night" }).includes("food"));
  // the kudos page gets the run's chips
  assert.ok((await put("r8run", { kind: "social", casual: true, name: "Weekly run club", activity: "run", date: day(2), published: true })).ok);
  const r = await reply({ eventId: "r8party", name: "Fay", email: "fay.r8@example.com" }); assert.equal(r.status, 200);
  const rr = await reply({ eventId: "r8run", name: "Gus", email: "gus.r8@example.com", code: "GUS12" }); const rid = String((await rr.json()).id).split("/").pop();
  assert.ok((await put("r8run", { kind: "social", casual: true, name: "Weekly run club", activity: "run", date: day(-1), published: true })).ok); // then it happens
  const j = await (await fetch(srv.base + `/api/public/kudos-page/r8run?rid=${rid}&code=GUS12`)).json();
  assert.deepEqual(j.order.slice(0, 3), ["again", "pace", "route"]); assert.ok(!j.tags.some((t) => t.k === "food"));
  // a run's tag is accepted and stored by its id
  assert.equal((await post("/api/public/kudos", { eventId: "r8run", rid, code: "GUS12", tags: ["again", "pace"] })).status, 200);
  assert.deepEqual(scopeStore(srv.store, ws).get("kudos/" + rid).data.tags, ["again", "pace"]);
  assert.match(read("index.html"), /<div class="ktags">\$\{r8KudosFor\(e\)\.map/);
});

test("group kudos at the event: the 4-digit code on the host's phone skips the email; a wrong code answers the same either way", async () => {
  assert.ok((await put("r8here", { kind: "social", casual: true, name: "Dumpling night", activity: "dinner", date: day(0), startTime: "00:00", endTime: "23:59", tz: "UTC", published: true })).ok);
  const add = async (body) => String((await (await post("/api/db/collection?path=rsvps", { eventId: "r8here", response: "going", code: "H" + Math.random().toString(36).slice(2, 6), createdAt: Date.now(), ...body }, { cookie: host })).json()).id).split("/").pop();
  const ana = await add({ name: "Ana Diaz", email: "ana.here@example.com" });
  const sheet = await (await fetch(srv.base + "/api/host/kudos-nudge/r8here", { headers: { cookie: host } })).json(), g = new URL(sheet.group.link).searchParams.get("g");
  const at = await (await fetch(srv.base + "/api/host/kudos-nudge/r8here/at", { headers: { cookie: host } })).json();
  assert.equal(at.live, true); assert.match(at.code, /^\d{4}$/); assert.ok(at.expiresAt > Date.now());
  assert.equal((await fetch(srv.base + "/api/host/kudos-nudge/r8here/at")).status === 200, false, "only the host sees the code");
  assert.equal((await (await fetch(srv.base + `/api/public/kudos-group/r8here?g=${g}`)).json()).here, true);
  const wrong = String((+at.code + 1) % 10000).padStart(4, "0"), send = (contact, code) => post("/api/public/kudos-group/r8here", { g, contact, at: code });
  const a = await send("ana.here@example.com", wrong), b = await send("nobody.here@example.com", wrong);
  assert.equal(a.status, 400); assert.equal(b.status, 400); assert.deepEqual(await a.json(), await b.json(), "a wrong code says the same thing, match or not");
  const ok = await (await send("ana.here@example.com", at.code)).json();
  assert.match(ok.next, new RegExp(`^/k/r8here\\?rid=${ana}&code=gk_`)); const code = new URL(srv.base + ok.next).searchParams.get("code");
  assert.equal((await fetch(srv.base + `/api/public/kudos-page/r8here?rid=${ana}&code=${code}`)).status, 200, "the kudos page opens");
  assert.equal((await send("nobody.here@example.com", at.code)).status, 404);
  // not around the event: no code, and a code is refused
  assert.ok((await put("r8later", { kind: "social", casual: true, name: "Later night", date: day(9), tz: "UTC", published: true })).ok);
  assert.equal((await (await fetch(srv.base + "/api/host/kudos-nudge/r8later/at", { headers: { cookie: host } })).json()).live, false);
  const kh = read("public/kudos.html"); assert.match(kh, /q\.get\("here"\) === "1"/); assert.match(kh, /id="gat"/);
  assert.match(read("index.html"), /At the event\? Guests type this code/);
});

test("signed in on /login or /signup: who you are, Go to Pottery Lab and Switch account, not the form", async () => {
  for (const p of ["/login", "/signup"]) { const h = await (await fetch(srv.base + p, { headers: { cookie: host } })).text();
    assert.match(h, /You're signed in as <b>Priya Shah<\/b>/); assert.match(h, />Go to Pottery Lab</); assert.match(h, />Switch account</); assert.doesNotMatch(h, /type="password"/); }
  assert.match(await (await fetch(srv.base + "/login")).text(), /type="password"/, "signed out still gets the form");
  assert.equal((await fetch(srv.base + "/login?next=/plans", { headers: { cookie: host }, redirect: "manual" })).status, 302, "a deep link still goes where it was headed");
});

test("copy and small UI: In again only, CRM fields hidden, speaker sublines, insurance, Coming up once, shop items, collabs, help link, words", async () => {
  const rep = read("public/invite-repeat.js"); assert.match(rep, /f\.hidden = true/); assert.match(rep, />Change my details</);
  const shop = read("public/storeshop.js");
  assert.match(shop, /<fieldset class="bf-crm" hidden>/); assert.match(shop, /if \(!j\?\.crm\) return;/);
  assert.match(shop, /const subOf = /); assert.match(shop, /\.shop \.si-b b\{font:600 16px\/1\.3 var\(--body/); // item names in the page's body face (UX pass) assert.match(shop, /<span class="si-sep" aria-hidden="true">·<\/span><span class="si-sr">, <\/span>/);
  assert.match(read("public/hosts.html"), /const subOf = /);
  assert.doesNotMatch(read("server/recognition.js"), /No insurance certificate on file/);
  const ins = read("public/inspo.js"); assert.doesNotMatch(ins, /"Coming up" : "Past"/); assert.match(ins, /x\.type === "art" && x\.status !== "upcoming" \? "Past"/);
  assert.match(read("public/plans.html"), /if \(!n && \/\(\?:\^\|;\\s\*\)encore_in=1\/\.test\(document\.cookie\)/);
  assert.match(read("public/requests.html"), /signedIn \? J\("\/api\/collabs"\) : null/);
  assert.match(read("public/help.js"), /window\.EncoreHelp = window\.PLHelp = \{ open, close/);
  const app = read("index.html"); assert.match(app, /b\.className="linkbtn wiz-help"; b\.textContent="Need a hand\?"/);
  assert.match(app, /They were in early last time\./);
  for (const f of ["server/social.js", "server/app.js", "index.html", "public/kudos.html"]) assert.doesNotMatch(read(f), /said yes early/i, f);
  // a casual host's /api/me says nothing about a CRM
  assert.equal((await (await fetch(srv.base + "/api/me", { headers: { cookie: host } })).json()).crm, undefined);
});

test("no made-up city: conferences match whole words, the browser's city backs up the host page's, no sample New York", () => {
  const app = read("index.html");
  assert.match(app, /function confFromText\(t\)\{[^\n]*new RegExp\("\(\^\|\[\^a-z0-9\]\)"/, "RSA isn't inside conversational");
  assert.match(app, /window\.__homeCity=W\.city\|\|br\|\|""/);
  assert.doesNotMatch(read("server/brand.js"), /cities: \["New York"\]/);
});
