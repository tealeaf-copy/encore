// Tables (review round 11): the plan up front (first 30 minutes, group size, comfort notes, who's in, last time), "I'm in
// if Sam is", open tables, "Same table next time?", second-RSVP rate, the roster export, the directory fields, the reader
// for what hosts type, the playbook and the again page (server/tables.js, public/tables.js).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore } from "../server/workspaces.js";
import { fakeOutbox } from "../server/email.js";
import { tableOf, sizeText, nameMatches, suggestTables, endLocal, sameTableWindow, rosterCsv } from "../server/tables.js";
await import("../public/tables.js");
const TB = globalThis.Tables;

let srv, host, ws;
const J = { "Content-Type": "application/json" };
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "tables-secret", ENCORE_SIGNUP_PER_HOUR: "100", ENCORE_FAKE_EMAIL: "1", ENCORE_DIRECTORY_CACHE_MS: "0" };
const post = (path, body, h = {}) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...h }, body: JSON.stringify(body) });
const put = (path, body) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { ...J, cookie: host }, body: JSON.stringify(body) });
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const S = () => scopeStore(srv.store, ws);
const guest = async (eventId, name, key, response = "going", extra = {}) => { const r = await post("/api/db/collection?path=rsvps", { eventId, name, email: key + "@t.example", response, code: "C" + key, showMe: true, createdAt: Date.now(), ...extra }, { "x-encore-guest": "1", "x-encore-key": "k-" + key.padEnd(10, "x") }); assert.equal(r.status, 200, await r.clone().text()); return (await r.json()).id; };
const byHost = async (eventId, name, key, extra = {}) => (await (await post("/api/db/collection?path=rsvps", { eventId, name, email: key + "@t.example", response: "going", code: "H" + key, createdAt: Date.now(), ...extra }, { cookie: host })).json()).id;
const table = async (id, rid, code) => (await fetch(`${srv.base}/api/public/table/${id}${rid ? `?rid=${rid}&code=${code}` : ""}`)).json();
const inboxOf = (email) => (srv.store.list("system").map((d) => d.data).find((x) => x?.kind === "inbox" && x.email === email)?.list || []);
const base = { casual: true, tz: "UTC", startTime: "19:00", endTime: "22:00", city: "Brooklyn", hood: "Gowanus", activity: "game night", headcount: 12, published: true };

before(async () => {
  Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer();
  const r = await post("/api/signup", { name: "Mina Park", email: "mina.tables@example.com", password: "long-password-1", mode: "friends" }); host = r.headers.get("set-cookie").split(";")[0];
  assert.ok((await post("/api/host/profile", { handle: "mina-tables", name: "Mina's Table", tagline: "Board games for quiet people.", city: "Brooklyn", hood: "Gowanus", emoji: "🎲" }, { cookie: host })).ok);
  ws = srv.store.get("system/handle-mina-tables").data.ws;
  const plan = { first30: "We teach Root, then play", sizeMin: 6, sizeMax: 12, comfort: ["solo", "quiet", "bogus", "solo"], noise: "low", agenda: ["7:00 Teach", "7:30 Play"], cohosts: [{ name: "Jo Kim", handle: "jo-tables" }, { name: "" }] };
  assert.ok((await put("events/tbPast", { ...base, name: "Root night", date: day(-7), repeat: "weekly", autoNext: false, ...plan })).ok);
  assert.ok((await put("events/tbNow", { ...base, name: "Root night", date: day(5), repeat: "weekly", seriesId: "tbPast", discoverable: true, ...plan })).ok);
  assert.ok((await put("events/tbHidden", { ...base, name: "Quiet thing", date: day(6), hideGuests: true, first30: "Tea" })).ok);
  assert.ok((await put("events/tbPrivate", { ...base, name: "Friends only", date: day(6), private: true, first30: "Tea" })).ok);
});
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

test("pure: the plan is cleaned, names match the way people type them, tables balance and keep friends together", () => {
  const T = tableOf({ first30: " We teach <b>Root</b> ", sizeMin: 12, sizeMax: 6, comfort: ["solo", "x", "solo", "leave"], noise: "loud", cohosts: ["Jo", { name: "Sam", handle: "@Sam!" }], openTable: { on: true, size: 99, questions: [{ q: "Play?", options: ["A", "B"] }, { q: "One option", options: ["A"] }] } });
  assert.equal(T.first30, "We teach Root", "plain text, no markup");
  assert.deepEqual(T.size, { min: 6, max: 12 }, "a reversed range is put right"); assert.equal(sizeText(T.size), "6 to 12"); assert.equal(sizeText({ min: 8, max: 8 }), "about 8");
  assert.deepEqual(T.comfort, ["solo", "leave"]); assert.equal(T.noise, "", "unknown noise level dropped");
  assert.deepEqual(T.cohosts, [{ name: "Jo", handle: "" }, { name: "Sam", handle: "sam" }]);
  assert.equal(T.open.size, 8); assert.equal(T.open.questions.length, 1, "a question needs two choices");
  assert.ok(nameMatches({ name: "Sam Ortiz" }, "sam")); assert.ok(nameMatches({ name: "Sam Ortiz" }, "Sam O.")); assert.ok(nameMatches({ name: "Sam Ortiz" }, "sam ortiz"));
  assert.ok(!nameMatches({ name: "Samantha Lee" }, "Sam")); assert.ok(!nameMatches({ name: "Sam Ortiz" }, "Sam L")); assert.ok(nameMatches({ name: "X", email: "s@x.io" }, "S@x.io"));
  const G = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((rid, i) => ({ rid, answers: { q1: i % 2 ? "Strategy" : "Party" }, with: rid === "i" ? "a" : null }));
  const t = suggestTables(G, 4); assert.equal(t.flat().length, 9); assert.equal(new Set(t.flat()).size, 9); assert.ok(Math.max(...t.map((x) => x.length)) - Math.min(...t.map((x) => x.length)) <= 1, JSON.stringify(t));
  assert.ok(t.some((x) => x.includes("a") && x.includes("i")), "a friend who came in with someone sits with them");
  assert.deepEqual(suggestTables([], 4), []);
  assert.equal(endLocal({ date: "2026-11-20", startTime: "19:00" }), "2026-11-20T22:00", "3 hours after the start when there's no end");
  assert.equal(endLocal({ date: "2026-11-20", startTime: "22:00", endTime: "01:00" }), "2026-11-21T01:00", "past midnight");
  const ev = { date: "2026-11-20", tz: "America/New_York", startTime: "19:00", endTime: "22:00" };
  assert.equal(sameTableWindow(ev, Date.parse("2026-11-21T03:30:00Z")), false, "10:30pm there: too soon, and too late in the evening");
  assert.equal(sameTableWindow(ev, Date.parse("2026-11-21T14:00:00Z")), true, "9am there the next morning");
  assert.equal(sameTableWindow(ev, Date.parse("2026-11-22T14:00:00Z")), false, "more than a day later");
  assert.ok(rosterCsv([{ name: "=HYPERLINK(1)", email: "a@b.c", emails_ok: true }]).includes("'=HYPERLINK(1)"), "no spreadsheet formulas");
});

test("the reader: first 30 minutes, group size, comfort notes, open table and co-hosts from what the host types", () => {
  const o = TB.read("Root night thursday 7pm at Twenty Sided Store, first 30 min: we teach Root, then play, come solo welcome, 6 to 12 people, no speeches, quiet corner");
  assert.equal(o.first30, "We teach Root, then play"); assert.equal(o.sizeMin, 6); assert.equal(o.sizeMax, 12); assert.deepEqual(o.comfort, ["solo", "quiet", "nospeech"]);
  const o2 = TB.read("board game night every wed 7-10pm, first 30 minutes we teach Wingspan. beginners welcome, leave anytime, noise: low");
  assert.equal(o2.first30, "We teach Wingspan"); assert.deepEqual(o2.comfort, ["beginner", "leave"]); assert.equal(o2.noise, "low");
  assert.equal(TB.read("Saturday build sprint 10am, the first half hour is demos and coffee; come alone friendly").first30, "Demos and coffee");
  const o3 = TB.read("open table, tables of 4, sat 2pm at Brooklyn Strategist, co-hosted with Jo and Sam, host roundtable");
  assert.deepEqual(o3.openTable, { on: true, size: 4, questions: [] }); assert.deepEqual(o3.cohosts, [{ name: "Jo" }, { name: "Sam" }]); assert.equal(o3.hostRoundtable, true);
  assert.deepEqual(Object.keys(TB.read("Dumpling night for 8 friday 7pm")), ["strip"], "nothing found, nothing set");
  const d = { pubTitle: "Root night", venueName: "Twenty Sided Store, come solo welcome", bring: ["come solo welcome", "snacks"] }; TB.apply(d, "first 30 min: we teach Root. come solo welcome");
  assert.equal(d.first30, "We teach Root"); assert.equal(d.venueName, "Twenty Sided Store"); assert.deepEqual(d.bring, ["snacks"]); assert.deepEqual(d.comfort, ["solo"]);
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.ok(/Tables \(review round 11\)[\s\S]*_qsTb=quickStart[\s\S]*end Tables \(review round 11\)/.test(html), "index.html wires the reader into quickStart in its own block");
});

test("guests see the plan, a few first names, last time, and co-hosts; hidden and private events keep names to themselves", async () => {
  await byHost("tbPast", "Ada Lovelace", "ada"); await byHost("tbPast", "Lin Chen", "lin"); await byHost("tbPast", "Wes Okafor", "wes");
  await guest("tbNow", "Ada Lovelace", "ada"); await guest("tbNow", "Lin Chen", "lin", "going", { showMe: false }); await guest("tbNow", "Noor Haddad", "noor");
  const T = await table("tbNow");
  assert.equal(T.first30, "We teach Root, then play"); assert.equal(T.sizeText, "6 to 12"); assert.deepEqual(T.comfort.map((c) => c.label), ["Come alone friendly", "Quiet corner"]);
  assert.deepEqual(T.noise, { k: "low", label: "Low noise" }); assert.equal(T.start, "19:00"); assert.equal(T.end, "22:00");
  assert.deepEqual(T.names.sort(), ["Ada", "Noor"], "first names only, and only people who chose to show"); assert.equal(T.count, 3);
  assert.equal(T.last.date, day(-7)); assert.equal(T.last.count, 3); assert.deepEqual(T.last.back.sort(), ["Ada", "Lin"]);
  assert.deepEqual(T.hosts, ["Mina", "Jo"], "co-hosts share the credit"); assert.ok(!JSON.stringify(T).includes("@t.example"), "never an email");
  await guest("tbHidden", "Ada Lovelace", "ada"); assert.deepEqual((await table("tbHidden")).names, [], "the host hides who's going");
  await guest("tbPrivate", "Ada Lovelace", "ada", "going"); const rid = await guest("tbPrivate", "Bo Bell", "bo", "maybe");
  assert.deepEqual((await table("tbPrivate")).names, [], "private: strangers see no names");
  assert.deepEqual((await table("tbPrivate", rid, "Cbo")).names, [], "nor do guests who aren't in");
  const ada = S().list("rsvps").find((d) => d.data.eventId === "tbPrivate" && d.data.name === "Ada Lovelace");
  assert.deepEqual((await table("tbPrivate", ada.id, "Cada")).names, ["Ada"], "guests who are in do");
});

test("I'm in if Sam is: a Maybe turns into I'm in when Sam replies, and Sam is never told", async () => {
  assert.ok((await put("events/tbIf", { ...base, name: "Wingspan night", date: day(4), headcount: 3 })).ok);
  // a first reply, made here
  const r = await post("/api/public/table/tbIf/ifwith", { name: "Sam", me: "Kai Moreno", email: "kai@t.example" }, { "x-encore-key": "k-kaixxxxxxxx" }); const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j)); assert.equal(j.state, "waiting"); assert.equal(j.response, "maybe"); assert.ok(j.rid && j.code);
  assert.equal((await post("/api/public/table/tbIf/ifwith", { name: "Sam", me: "Kai Moreno", email: "kai@t.example" }, { "x-encore-key": "k-otherdevice" })).status, 409, "the same email from another device can't");
  assert.equal((await post("/api/public/table/tbIf/ifwith", { rid: j.rid, code: j.code, name: "Kai" })).status, 400, "not yourself");
  assert.equal((await table("tbIf", j.rid, j.code)).me.ifWith, "Sam");
  // someone else named Samantha doesn't count
  await guest("tbIf", "Samantha Lee", "samantha");
  assert.equal(S().get("rsvps/" + j.rid).data.response, "maybe");
  // Sam replies I'm in
  await guest("tbIf", "Sam Ortiz", "sam"); await new Promise((res) => setTimeout(res, 150));
  assert.equal(S().get("rsvps/" + j.rid).data.response, "going", "Kai is in now");
  const T = await table("tbIf", j.rid, j.code); assert.equal(T.me.metWith, "Sam"); assert.equal(T.me.ifWith, "");
  assert.ok(inboxOf("kai@t.example").some((n) => n.kind === "ifwith" && /Sam is in, so you're in/.test(n.text)));
  assert.ok(!inboxOf("sam@t.example").some((n) => /Kai/.test(n.text || "")), "Sam sees nothing about it");
  assert.ok(fakeOutbox.some((m) => m.to.includes("kai@t.example") && /You're in: Wingspan night/.test(m.subject)));
  // the event is full now (3 spots): the next one lands on the waitlist
  const L = await (await post("/api/public/table/tbIf/ifwith", { name: "Kai", me: "Lea Park", email: "lea@t.example" }, { "x-encore-key": "k-leaxxxxxxxx" })).json();
  assert.equal(L.state, "waitlist", JSON.stringify(L)); assert.equal(S().get("rsvps/" + L.rid).data.response, "waitlist");
  // an event where the host lets guests in: it becomes an ask, never a yes
  assert.ok((await put("events/tbIfAsk", { ...base, name: "Ask night", date: day(4), approvalRequired: true })).ok);
  const A = await (await post("/api/public/table/tbIfAsk/ifwith", { name: "Ada", me: "Rae Ito", email: "rae@t.example" }, { "x-encore-key": "k-raexxxxxxxx" })).json();
  await byHost("tbIfAsk", "Ada Lovelace", "ada"); await new Promise((res) => setTimeout(res, 150));
  assert.equal(S().get("rsvps/" + A.rid).data.response, "requested");
  // the host sees who's waiting on whom
  const H = await (await fetch(srv.base + "/api/host/table/tbIf", { headers: { cookie: host } })).json();
  assert.deepEqual(H.ifWith.map((x) => [x.guest, x.name, x.state]).sort(), [["Kai Moreno", "Sam", "in"], ["Lea Park", "Kai", "in"]]);
  assert.equal((await fetch(srv.base + "/api/host/table/tbIf")).status, 403, "the host's view needs the host");
});

test("open table: guests answer, the host sees suggested tables and confirms, guests see their table", async () => {
  assert.ok((await put("events/tbOpen", { ...base, name: "Open table", date: day(3), openTable: { on: true, size: 4, questions: [{ q: "What do you play?", options: ["Strategy", "Party"] }, { q: "Competitive?", options: ["Chill", "Very"] }] } })).ok);
  const P = [["Ada Lovelace", "ada", "Strategy", "Very"], ["Lin Chen", "lin", "Party", "Chill"], ["Sam Ortiz", "sam", "Strategy", "Very"], ["Noor Haddad", "noor", "Party", "Chill"], ["Bea Lund", "bea", "Strategy", "Chill"], ["Ivo Marsh", "ivo", "Party", "Very"], ["Una Reyes", "una", "Party", "Chill"], ["Theo Park", "theo", "Strategy", "Very"]];
  const rid = {}; for (const [n, k, a, b] of P) { rid[k] = await guest("tbOpen", n, k); const r = await post("/api/public/table/tbOpen/taste", { rid: rid[k], code: "C" + k, answers: { q1: a, q2: b, q3: "x" } }); assert.deepEqual((await r.json()).answers, { q1: a, q2: b }); }
  assert.equal((await post("/api/public/table/tbOpen/taste", { rid: rid.ada, code: "wrong", answers: {} })).status, 403);
  assert.equal((await table("tbOpen", rid.ada, "Cada")).me.table, null, "no table before the host confirms");
  const H = await (await fetch(srv.base + "/api/host/table/tbOpen", { headers: { cookie: host } })).json();
  assert.equal(H.tables.length, 2); assert.deepEqual(H.tables.map((t) => t.length), [4, 4]);
  const tAda = H.tables.find((t) => t.some((g) => g.rid === rid.ada)); assert.ok(tAda.some((g) => g.rid === rid.sam || g.rid === rid.theo), "like answers sit together");
  const c = await (await post("/api/host/table/tbOpen/tables", { tables: H.tables.map((t) => t.map((g) => g.rid)).concat([["nope"]]), confirm: true }, { cookie: host })).json();
  assert.equal(c.confirmed, true); assert.equal(c.told, 8);
  const mine = (await table("tbOpen", rid.ada, "Cada")).me.table; assert.equal(mine.n, H.tables.indexOf(tAda) + 1); assert.equal(mine.with.length, 3); assert.ok(!mine.with.includes("Ada"));
  assert.ok(inboxOf("ada@t.example").some((n) => n.kind === "table" && /You're at table \d with /.test(n.text)));
  const n0 = fakeOutbox.length; await post("/api/host/table/tbOpen/tables", { tables: H.tables.map((t) => t.map((g) => g.rid)), confirm: true }, { cookie: host });
  assert.equal(fakeOutbox.length, n0, "confirming the same tables again sends nothing new");
});

test("Same table next time?: once per guest within a day, one tap replies I'm in to the next date, or holds the spot until it's made", async () => {
  assert.ok((await put("events/tbSt1", { ...base, name: "Build sprint", date: day(-1), repeat: "weekly", autoNext: false })).ok);
  const a = await byHost("tbSt1", "Ada Lovelace", "ada"), w = await byHost("tbSt1", "Wes Okafor", "wes", { noShow: true }); await byHost("tbSt1", "Bo Bell", "bo", { response: "no" });
  const run = (now) => srv.app.locals.tables.runSameTable({ now, workspaces: [ws], origin: "https://pl.example" });
  assert.equal((await run(Date.parse(day(-1) + "T22:30:00Z"))).asked, 0, "not right after it ends");
  const r1 = await run(Date.parse(day(0) + "T10:00:00Z")); assert.equal(r1.asked, 1, JSON.stringify(r1)); assert.equal(r1.emailed, 1);
  assert.equal((await run(Date.parse(day(0) + "T11:00:00Z"))).asked, 0, "once, ever");
  const m = fakeOutbox.filter((x) => x.to.includes("ada@t.example") && /Same table next time\? Build sprint/.test(x.subject)); assert.equal(m.length, 1);
  assert.match(m[0].text, /https:\/\/pl\.example\/again\/tbSt1\?rid=/); assert.match(m[0].text, /hasn't set the next date yet/); assert.ok(!/—/.test(m[0].text));
  assert.ok(!S().get("sametable/tbSt1--" + w), "no-shows aren't asked");
  // no next date yet: the tap holds the spot
  const page = await (await fetch(`${srv.base}/api/public/again/tbSt1?rid=${a}&code=Hada`)).json(); assert.equal(page.next, null); assert.equal(page.name, "Ada");
  const t1 = await (await post("/api/public/again/tbSt1", { rid: a, code: "Hada" })).json(); assert.equal(t1.state, "pledged");
  assert.equal((await post("/api/public/again/tbSt1", { rid: a, code: "nope" })).status, 403);
  // the host makes the next date: the job replies for her
  assert.ok((await put("events/tbSt2", { ...base, name: "Build sprint", date: day(6), repeat: "weekly", seriesId: "tbSt1" })).ok);
  const r2 = await run(Date.parse(day(0) + "T12:00:00Z")); assert.equal(r2.converted, 1);
  const mineNext = S().list("rsvps").find((d) => d.data.eventId === "tbSt2" && d.data.email === "ada@t.example"); assert.equal(mineNext.data.response, "going"); assert.equal(mineNext.data.via, "again");
  assert.equal((await run(Date.parse(day(0) + "T13:00:00Z"))).converted, 0, "once");
  // tapping again now: already in
  const t2 = await (await post("/api/public/again/tbSt1", { rid: a, code: "Hada" })).json(); assert.equal(t2.state, "already"); assert.equal(t2.next.id, "tbSt2");
  assert.equal(S().list("rsvps").filter((d) => d.data.eventId === "tbSt2").length, 1, "no second reply");
  const H = await (await fetch(srv.base + "/api/host/table/tbSt1", { headers: { cookie: host } })).json(); assert.deepEqual(H.sameTable, { asked: 1, tapped: 1 });
  assert.equal((await fetch(srv.base + "/again/tbSt1?rid=x&code=y")).status, 200);
});

test("second-RSVP rate counts people who came and replied I'm in again, per host and per series", async () => {
  const M = await (await fetch(srv.base + "/api/host/second-rsvp", { headers: { cookie: host } })).json();
  const root = M.series.find((s) => s.id === "tbPast"); assert.ok(root, JSON.stringify(M.series));
  assert.deepEqual([root.came, root.again, root.rate], [3, 2, 67], "Ada and Lin came back of Ada, Lin and Wes");
  const st = M.series.find((s) => s.id === "tbSt1"); assert.deepEqual([st.came, st.again, st.rate], [1, 1, 100]);
  assert.deepEqual([M.came, M.again, M.rate], [3, 2, 67], "across the host: the same three people who have a past date");
  assert.equal((await fetch(srv.base + "/api/host/second-rsvp")).status, 403);
});

test("the roster is the host's: CSV and JSON with consent fields, owner only", async () => {
  await guest("tbNow", "Una Reyes", "una", "going", { phone: "+1 555 0100", smsOk: false, showMe: false });
  const csv = await (await fetch(srv.base + "/api/host/roster.csv?series=tbNow", { headers: { cookie: host } })).text();
  const [head, ...rows] = csv.trim().split("\r\n"); assert.equal(head, "name,email,phone,times_in,first_date,last_date,events,emails_ok,texts_ok,shown_to_guests,follows_you");
  const ada = rows.find((r) => r.startsWith("Ada Lovelace")); assert.match(ada, /,2,/, "two dates in the series"); assert.ok(!rows.some((r) => r.startsWith("Rae")), "other events aren't in this series' roster");
  const J2 = await (await fetch(srv.base + "/api/host/roster.json?series=tbNow", { headers: { cookie: host } })).json();
  assert.equal(J2.group, "Root night"); assert.deepEqual(J2.hosts, ["Mina", "Jo"]); assert.ok(J2.consent.emails_ok);
  const una = J2.people.find((p) => p.name === "Una Reyes"); assert.deepEqual([una.texts_ok, una.shown_to_guests, una.emails_ok], [false, false, true]);
  const all = await (await fetch(srv.base + "/api/host/roster.json", { headers: { cookie: host } })).json(); assert.ok(all.people.some((p) => p.name === "Kai Moreno"));
  assert.equal((await fetch(srv.base + "/api/host/roster.csv")).status, 403);
});

test("the directory, llms.txt and OpenAPI carry what guests can expect; the playbook, roundtables and the light invite", async () => {
  const e = (await (await fetch(srv.base + "/api/v1/events/tbNow")).json()).data; assert.ok(e, "listed");
  assert.equal(e.first_30, "We teach Root, then play"); assert.deepEqual(e.group_size_expected, { min: 6, max: 12 }); assert.deepEqual(e.comfort, ["solo", "quiet"]);
  assert.deepEqual(e.comfort_labels, ["Come alone friendly", "Quiet corner", "Low noise"]); assert.equal(e.noise, "low"); assert.equal(e.open_table, false);
  assert.deepEqual(e.cohosts, [{ handle: "", name: "Jo Kim", url: "" }], "a co-host without a page"); assert.ok(!JSON.stringify(e).includes("Ada"), "never who's in");
  const llms = await (await fetch(srv.base + "/llms.txt")).text(); assert.match(llms, /first_30/); assert.match(llms, /group_size_expected/);
  const oa = await (await fetch(srv.base + "/api/v1/openapi.json")).json(); assert.ok(oa.components.schemas.Event.properties.first_30); assert.ok(oa.components.schemas.Event.properties.comfort);
  const pb = await (await fetch(srv.base + "/playbook")).text(); assert.match(pb, /First-timers/); assert.match(pb, /No-shows/); assert.match(pb, /Uneven tables/); assert.ok(!/—/.test(pb), "no em dashes");
  for (const w of [/\bseats?\b/i, /attendees/i, /curated|seamless|effortless|magical/i]) assert.ok(!w.test(pb.replace(/<[^>]+>/g, " ")), String(w));
  assert.deepEqual((await (await fetch(srv.base + "/api/public/roundtables")).json()).roundtables, []);
  assert.ok((await put("events/tbRound", { ...base, name: "Host roundtable", date: day(9), hostRoundtable: true, first30: "Each host shares one thing that worked" })).ok);
  const rt = (await (await fetch(srv.base + "/api/public/roundtables")).json()).roundtables; assert.equal(rt.length, 1); assert.equal(rt[0].host.handle, "mina-tables");
  const inv = fs.readFileSync(new URL("../public/invite.html", import.meta.url), "utf8"); assert.ok(inv.length < 40000); assert.match(inv, /<script src="\/tables\.js" defer><\/script>/);
  const help = fs.readFileSync(new URL("../docs/help.md", import.meta.url), "utf8"); assert.match(help, /\/playbook/);
});
