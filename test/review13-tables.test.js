// Review round 13: replies the server makes for a guest ("Same table next time?", "I'm in if Sam is") follow the same rules
// as the guest's own I'm in, tier picks, what hidden guest lists keep hidden, the roster, the plan card's place, pair and
// group prices, one "New" badge, and the small fixes (server/tables.js, server/app.js, public/tables.js, index.html).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore } from "../server/workspaces.js";
import { fakeOutbox } from "../server/email.js";
import { suggestTables, rosterCsv, withLine } from "../server/tables.js";
import { priceOf, groupWords } from "../server/directory.js";
await import("../public/tables.js");
const TB = globalThis.Tables;

let srv, host, ws;
const J = { "Content-Type": "application/json" };
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "r13-tables-secret", ENCORE_SIGNUP_PER_HOUR: "100", ENCORE_FAKE_EMAIL: "1", ENCORE_DIRECTORY_CACHE_MS: "0" };
const post = (path, body, h = {}) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...h }, body: JSON.stringify(body) });
const put = (path, body) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { ...J, cookie: host }, body: JSON.stringify(body) });
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const S = () => scopeStore(srv.store, ws);
const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const guest = (eventId, name, key, response = "going", extra = {}, h = {}) => post("/api/db/collection?path=rsvps", { eventId, name, email: key + "@t.example", response, code: "C" + key, showMe: true, createdAt: Date.now(), ...extra }, { "x-encore-guest": "1", "x-encore-key": "k-" + key.padEnd(10, "x"), ...h });
const byHost = async (eventId, name, key, extra = {}) => (await (await post("/api/db/collection?path=rsvps", { eventId, name, email: key + "@t.example", response: "going", code: "H" + key, createdAt: Date.now(), ...extra }, { cookie: host })).json()).id;
const repliesTo = (id) => S().list("rsvps").filter((d) => d.data?.eventId === id).map((d) => ({ id: d.id, ...d.data }));
const base = { casual: true, tz: "UTC", startTime: "19:00", endTime: "22:00", city: "Brooklyn", hood: "Gowanus", activity: "game night", published: true };
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8"), tablesJs = fs.readFileSync(new URL("../public/tables.js", import.meta.url), "utf8"), invite = fs.readFileSync(new URL("../public/invite.html", import.meta.url), "utf8");

before(async () => {
  Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer();
  const r = await post("/api/signup", { name: "Rae Quinn", email: "rae.r13@example.com", password: "long-password-1", mode: "friends" }); host = r.headers.get("set-cookie").split(";")[0];
  assert.ok((await post("/api/host/profile", { handle: "rae-r13", name: "Rae's Table", tagline: "x", city: "Brooklyn", hood: "Gowanus" }, { cookie: host })).ok);
  ws = srv.store.get("system/handle-rae-r13").data.ws;
});
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

test("1. Same table next time follows the reply rules: ask to join is an ask, a pre-order isn't answered, full is the waitlist, and the confirm email says how to pay", async () => {
  assert.ok((await put("events/r13P", { ...base, name: "Root night", date: day(-1), repeat: "weekly", autoNext: false })).ok);
  assert.ok((await put("events/r13N", { ...base, name: "Root night", date: day(6), repeat: "weekly", seriesId: "r13P", approvalRequired: true })).ok);
  const ada = await byHost("r13P", "Ada Lovelace", "ada13");
  const a = await (await post("/api/public/again/r13P", { rid: ada, code: "Hada13" })).json();
  assert.equal(a.state, "requested", JSON.stringify(a));
  assert.equal(repliesTo("r13N").find((r) => r.name === "Ada Lovelace").response, "requested");
  assert.ok(fakeOutbox.some((m) => m.to.includes("ada13@t.example") && /^Asked: Root night/.test(m.subject)), "the guest's Asked email");
  assert.ok(fakeOutbox.some((m) => m.to.includes("rae.r13@example.com") && /asked to join Root night/.test(m.subject)), "the host hears like any ask");
  // a pre-order: nothing is ordered for them
  assert.ok((await put("events/r13BP", { ...base, name: "Bread drop", date: day(-1), repeat: "weekly", autoNext: false })).ok);
  assert.ok((await put("events/r13BN", { ...base, name: "Bread drop", date: day(6), repeat: "weekly", seriesId: "r13BP", preorder: true, orderItems: [{ name: "Loaf", price: 8 }] })).ok);
  const bo = await byHost("r13BP", "Bo Li", "bo13");
  const b = await (await post("/api/public/again/r13BP", { rid: bo, code: "Hbo13" })).json();
  assert.equal(b.state, "order"); assert.equal(repliesTo("r13BN").length, 0, "no reply made for a pre-order");
  // full: the waitlist; paid: the You're in email has the pay line
  assert.ok((await put("events/r13FP", { ...base, name: "Supper", date: day(-1), repeat: "weekly", autoNext: false })).ok);
  assert.ok((await put("events/r13FN", { ...base, name: "Supper", date: day(6), repeat: "weekly", seriesId: "r13FP", headcount: 1, price: "$30", ticketNote: "Cash at the door" })).ok);
  const cy = await byHost("r13FP", "Cy Ng", "cy13"), di = await byHost("r13FP", "Di Ro", "di13");
  assert.equal((await (await post("/api/public/again/r13FP", { rid: cy, code: "Hcy13" })).json()).state, "in");
  assert.ok(fakeOutbox.some((m) => m.to.includes("cy13@t.example") && /^You're in: Supper/.test(m.subject) && /Pay \$30 at the door\./.test(m.text)), "the normal confirm email, with how to pay");
  assert.equal((await (await post("/api/public/again/r13FP", { rid: di, code: "Hdi13" })).json()).state, "waitlist");
});

test("1. a held spot for a date that wasn't made yet goes through the same rules once it is", async () => {
  assert.ok((await put("events/r13QP", { ...base, name: "Quiz", date: day(-1), repeat: "weekly", autoNext: false })).ok);
  const ed = await byHost("r13QP", "Ed Fox", "ed13");
  assert.equal((await (await post("/api/public/again/r13QP", { rid: ed, code: "Hed13" })).json()).state, "pledged");
  assert.ok((await put("events/r13QN", { ...base, name: "Quiz", date: day(6), repeat: "weekly", seriesId: "r13QP", approvalRequired: true })).ok);
  const out = await srv.app.locals.tables.runSameTable({ workspaces: [ws], origin: "https://pl.example" });
  assert.equal(out.converted, 1); assert.equal(repliesTo("r13QN")[0].response, "requested");
});

test("2. I'm in if: a pre-order stays Maybe and says to order; a Come with me link fills its held spot, never counted twice", async () => {
  assert.ok((await put("events/r13Pre", { ...base, name: "Bake sale", date: day(5), preorder: true, headcount: 10, orderItems: [{ name: "Loaf", price: 8 }] })).ok);
  const m = await (await post("/api/public/table/r13Pre/ifwith", { me: "May Be", email: "may13@t.example", name: "Sam" }, { "x-encore-key": "k-may13xxxxxx" })).json();
  assert.equal((await guest("r13Pre", "Sam Ortiz", "sam13", "going", { orderQty: [{ i: 0, qty: 1 }] })).status, 200); await wait();
  assert.equal(S().get("rsvps/" + m.rid).data.response, "maybe", "nothing ordered for them");
  const T = await (await fetch(`${srv.base}/api/public/table/r13Pre?rid=${m.rid}&code=${m.code}`)).json(); assert.equal(T.me.order, true);
  assert.ok(fakeOutbox.some((x) => x.to.includes("may13@t.example") && /Open your invite to order/.test(x.text)));
  // Come with me: Mia holds a spot for a friend; Jo opens the link and says I'm in if Mia is
  assert.ok((await put("events/r13CW", { ...base, name: "Three seats", date: day(5), headcount: 3 })).ok);
  const mia = await (await guest("r13CW", "Mia Rossi", "mia13")).json();
  const link = await (await post("/api/public/come-with", { eventId: "r13CW", rid: mia.id, code: "Cmia13" })).json(); assert.ok(link.token);
  const rd = await fetch(`${srv.base}/api/public/come-with/r13CW/${link.token}`), ck = (rd.headers.get("set-cookie") || "").split(";")[0];
  const jo = await (await post("/api/public/table/r13CW/ifwith", { me: "Jo Kim", email: "jo13@t.example", name: "Mia" }, { "x-encore-key": "k-jo13xxxxxxx", cookie: ck })).json();
  assert.equal(jo.state, "in"); const J1 = S().get("rsvps/" + jo.rid).data; assert.equal(J1.withOf, mia.id);
  assert.ok(S().get("rsvps/" + mia.id).data.withHolds.every((h) => h.by), "the hold is used up");
  assert.equal((await (await guest("r13CW", "Xan Third", "xan13")).json()).response, "going", "the third seat is still free");
});

test("3. tier picks: party is what was picked, unknown tiers are refused, more than a reply may hold is an error", async () => {
  assert.ok((await put("events/r13T", { ...base, name: "Family supper", date: day(6), headcount: 20, price: "$55", priceTiers: [{ label: "Adults", price: 55 }, { label: "Kids", price: 35 }] })).ok);
  const a = await guest("r13T", "Ann A", "ann13", "going", { party: 1, tiers: [{ label: "Adults", n: 4 }, { label: "Kids", n: 3 }] });
  assert.equal(a.status, 400); assert.equal((await a.json()).message, "Pick up to 6.");
  // launch review: an unknown tier ("Seniors") is an error that names the real ones, not a spot with no amount
  const sx = await guest("r13T", "Sy S", "sy13", "going", { tiers: [{ label: "Seniors", n: 1 }] }); assert.equal(sx.status, 400); assert.equal((await sx.json()).message, "Pick one of: Adults, Kids");
  const b = await (await guest("r13T", "Ben B", "ben13", "going", { party: 5, tiers: [{ label: "adults", n: 2 }] })).json();
  const B = S().get("rsvps/" + b.id).data; assert.deepEqual(B.tiers, [{ label: "Adults", n: 2 }]); assert.equal(B.party, 2, "min(partyMax, picks), not the 5 sent");
  // changing a reply goes through the same rules
  const r = await fetch(srv.base + "/api/db/doc?path=rsvps/" + b.id, { method: "PUT", headers: { ...J, "x-encore-guest": "1", "x-encore-key": "k-ben13xxxxx" }, body: JSON.stringify({ ...B, tiers: [{ label: "Kids", n: 9 }] }) });
  assert.equal(r.status, 400);
});

test("4 and 5. hidden lists stay hidden: no head count, tablemates who hid their name are only counted; taste answers only from guests who are in", async () => {
  assert.ok((await put("events/r13H", { ...base, name: "Discreet", date: day(6), hideGuests: true, discreet: true, headcount: 8, openTable: { on: true, size: 3, questions: [{ q: "A?", options: ["x", "y"] }] } })).ok);
  const al = await (await guest("r13H", "Alice Secret", "ali13", "going", { showMe: false })).json(), bo = await (await guest("r13H", "Bob Secret", "bob13", "going", { showMe: false })).json(), cid = await (await guest("r13H", "Cid Q", "cid13")).json();
  const t0 = await (await fetch(srv.base + "/api/public/table/r13H")).json(); assert.deepEqual([t0.names, t0.count, t0.more], [[], 0, 0]);
  assert.equal((await post("/api/host/table/r13H/tables", { tables: [[al.id, bo.id, cid.id]], confirm: true }, { cookie: host })).status, 200);
  const t = await (await fetch(`${srv.base}/api/public/table/r13H?rid=${cid.id}&code=Ccid13`)).json(); assert.deepEqual(t.me.table, { n: 1, with: [], others: 2 });
  assert.ok(fakeOutbox.some((m) => m.to.includes("cid13@t.example") && /You're at table 1 with 2 others\./.test(m.text)));
  assert.ok(!fakeOutbox.some((m) => /Alice|Bob/.test(m.text) && m.to.includes("cid13@t.example")));
  assert.equal(withLine(["Ada"], 2), "Ada and 2 others"); assert.equal(withLine([], 1), "1 other");
  const may = await (await guest("r13H", "May Q", "may13q", "maybe")).json();
  assert.equal((await post("/api/public/table/r13H/taste", { rid: may.id, code: "Cmay13q", answers: { q1: "x" } })).status, 403);
  assert.equal((await post("/api/public/table/r13H/taste", { rid: cid.id, code: "Ccid13", answers: { q1: "x" } })).status, 200);
});

test("6. the roster: no cancelled events, phone numbers as typed, texts only with a yes to texts, and no-shows", async () => {
  assert.ok((await put("events/r13C", { ...base, name: "Cancelled one", date: day(6), cancelled: true })).ok);
  assert.ok((await put("events/r13R", { ...base, name: "Real one", date: day(6) })).ok);
  await guest("r13C", "Cee Cancel", "cee13", "going", { phone: "+1 555 123 4567" });
  await guest("r13R", "Pho Ne", "pho13", "going", { phone: "+1 (555) 123-4567", smsOk: true });
  await guest("r13R", "Nos Ms", "nos13", "going", { phone: "+15550000000" });
  const csv = await (await fetch(srv.base + "/api/host/roster.csv?series=r13R", { headers: { cookie: host } })).text();
  assert.match(csv.split("\r\n")[0], /times_in,no_shows,/);
  assert.ok(!/Cee Cancel/.test(csv)); assert.ok(csv.includes(",+1 (555) 123-4567,"), csv);
  const J2 = await (await fetch(srv.base + "/api/host/roster.json?series=r13R", { headers: { cookie: host } })).json();
  assert.equal(J2.people.find((p) => p.name === "Pho Ne").texts_ok, true); assert.equal(J2.people.find((p) => p.name === "Nos Ms").texts_ok, false, "a phone alone isn't a yes to texts");
  assert.equal(rosterCsv([{ name: "+HYPERLINK(1)", phone: "+44 20 7946 0958" }]).split("\r\n")[1].split(",").slice(0, 3).join(","), "'+HYPERLINK(1),,+44 20 7946 0958");
  const nid = repliesTo("r13R").find((r) => r.name === "Nos Ms").id; S().update("rsvps/" + nid, { noShow: true });
  const J3 = await (await fetch(srv.base + "/api/host/roster.json?series=r13R", { headers: { cookie: host } })).json(); assert.equal(J3.people.find((p) => p.name === "Nos Ms").no_shows, 1);
});

test("7 and 8. the plan card sits under the title and facts (and under the Come with me banner), leaves out In so far beside a who's-in row, and is redrawn after a reply", () => {
  const T = { first30: "Teach", names: ["Ada"], more: 0, count: 1 };
  assert.match(TB.plan(T), /In so far/); assert.doesNotMatch(TB.plan(T, { noWho: true }), /In so far/);
  assert.match(tablesJs, /\/\^\\\/\[ei\]\\\//, "runs on /i/ (a Come with me link) as well as /e/");
  assert.match(tablesJs, /querySelector\("\.cwm-hello"\)/); assert.doesNotMatch(tablesJs, /cov\.insertAdjacentHTML\("beforebegin"/, "never above the cover");
  assert.match(tablesJs, /old\.dataset\.st !== now/, "redrawn when the reply changes the page");
  assert.match(html, /TB\.plan\(T,\{noWho:true\}\), at=q\("\.invite \.in \.ev2-acts",host\)/);
  assert.match(tablesJs, /iff\.hidden = !det\.open/, "the closed I'm in if panel has no second Your name");
});

test("9. pair and group prices: $40 a pair, $60 for 2, a group price alone is a price", async () => {
  assert.equal(groupWords({ groupPrice: "$40", groupSize: 2, headUnit: "pairs" }), "$40 a pair");
  assert.equal(groupWords({ groupPrice: 60, groupSize: 2 }), "$60 for 2");
  assert.equal(priceOf({ groupPrice: "$40", groupSize: 2, headUnit: "pairs" }), "$40 a pair", "only a group price: not Free, not nothing");
  assert.equal(priceOf({ price: "$40", groupPrice: "$40", groupSize: 2, headUnit: "pairs" }), "$40 a pair");
  assert.match(invite, /a pair`/); assert.match(invite, /e\.free !== true && gpOf\(e\)/, "paidOf counts a group price");
  assert.match(html, /function gGroupWords\(e\)/); assert.match(html, /gGroupWords\(e\)\|\|e\.price\+" a person"/);
  // the pay line on a group price alone
  assert.ok((await put("events/r13GP", { ...base, name: "Salsa pairs", date: day(6), headUnit: "pairs", groupSize: 2, groupPrice: "$40", headcount: 8, ticketNote: "At the door" })).ok);
  await guest("r13GP", "Pia Pair", "pia13", "going", { party: 2 });
  assert.ok(fakeOutbox.some((m) => m.to.includes("pia13@t.example") && /Pay \$40 at the door\./.test(m.text)));
  const pe = await (await fetch(srv.base + "/api/db/doc?path=events/r13GP", { headers: { "x-encore-guest": "1" } })).json();
  assert.equal((pe.data || pe).groupPrice, 40, "pages get the number");
});

test("10. suggested tables start each table with someone who's been before; one New badge (first time with this host)", async () => {
  const G = [{ rid: "n1", back: false }, { rid: "n2", back: false }, { rid: "n3", back: false }, { rid: "n4", back: false }, { rid: "n5", back: false }, { rid: "n6", back: false }, { rid: "b1", back: true }, { rid: "b2", back: true }];
  const T = suggestTables(G, 4); assert.equal(T.length, 2); for (const t of T) assert.ok(t.some((r) => r.startsWith("b")), JSON.stringify(T));
  assert.deepEqual(suggestTables([{ rid: "a" }, { rid: "b" }], 4), [["a", "b"]], "no returning flags: as before");
  assert.ok((await put("events/r13Old", { ...base, name: "Board games", date: day(-10) })).ok); await byHost("r13Old", "Lin Chen", "lin13");
  assert.ok((await put("events/r13New", { ...base, name: "Board games", date: day(8), openTable: { on: true, size: 4, questions: [] } })).ok);
  await guest("r13New", "Lin Chen", "lin13"); await guest("r13New", "Uma Diaz", "uma13");
  const H = await (await fetch(srv.base + "/api/host/table/r13New", { headers: { cookie: host } })).json();
  assert.deepEqual(H.people.map((p) => [p.name, p.new]).sort(), [["Lin Chen", false], ["Uma Diaz", true]]);
  assert.deepEqual(H.tables.flat().map((g) => [g.name, g.new]).sort(), [["Lin Chen", false], ["Uma Diaz", true]]);
  const room = await (await fetch(srv.base + "/api/host/room/r13New", { headers: { cookie: host } })).json();
  assert.ok((room.common || []).some((x) => /^Uma is new\./.test(x)), JSON.stringify(room));
  assert.match(html, /annotateWho=async function/); assert.match(html, /<option value="\$\{j\.tables\.length\}">New table<\/option>/, "the move-to option isn't a second New");
});

test("11 and 12. no raw research error; host stats say one thing once, and no zero headline before anyone is asked", () => {
  assert.doesNotMatch(html, /Research failed/); assert.match(html, /Potto's research is off on this server\./);
  assert.match(html, /SR0&&!\(SR0\.came===H\.came&&SR0\.again===H\.again\)/); assert.doesNotMatch(html, /No asks yet/); assert.match(html, /Who comes back shows here/); // event flow redesign: no "No asks yet" headline
});

test("minor: /api/v1/events rejects filters it doesn't have; Host one like this is 404 for a private event; the pantry floor fades", async () => {
  for (const q of ["tags[]=x", "open_table=maybe", "tags=x"]) { const r = await fetch(srv.base + "/api/v1/events?" + q); assert.equal(r.status, 400, q); assert.match((await r.json()).message, /no ".*" filter/); }
  assert.equal((await fetch(srv.base + "/api/v1/events?format=class")).status, 200);
  assert.ok((await put("events/r13Priv", { ...base, name: "Secret supper", date: day(4) })).ok);
  assert.equal((await fetch(srv.base + "/api/public/like/r13Priv")).status, 404);
  const looks = fs.readFileSync(new URL("../public/looks.js", import.meta.url), "utf8"); assert.match(looks, /\.lk-hex\{background-repeat:repeat;-webkit-mask:linear-gradient/);
  for (const f of ["../server/tables.js", "../public/tables.js", "../public/again.html"]) assert.ok(!/—/.test(fs.readFileSync(new URL(f, import.meta.url), "utf8")), f + ": no em dashes");
});

// a private event's agenda can name the place: only guests who are in (and the host) see it
import { readFileSync as _rf } from "node:fs";
test("a private event's agenda stays with guests who are in", () => {
  assert.match(_rf(new URL("../server/tables.js", import.meta.url), "utf8"), /agenda: closed\(ev\) && !going && !isHost \? \[\] : T\.agenda/);
});
