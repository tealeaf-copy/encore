// The events directory, review round 5: series prices and "when" lines (the same words invite.html uses), the class
// format, any-word search, spots left, places, one host line per host on /events, and the public MCP's parse errors
// and structured results.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore } from "../server/workspaces.js";
import { seriesOf, priceOf, splitPlace, queryWords, formatOf, PUBLIC_TOOLS, dateRange } from "../server/directory.js";

let srv;
const J = { "Content-Type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const put = (path, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const get = async (path) => { const r = await fetch(srv.base + path); assert.equal(r.status, 200, path); return r.json(); };
const ev = async (id) => (await get("/api/v1/events/" + id)).data;
const wsOf = (handle) => srv.store.get("system/handle-" + handle).data.ws;
const ymd = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
// the first date on weekday wd (0 = Sunday) at least `min` days out
const next = (wd, min = 10) => { const x = new Date(); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() + min); while (x.getDay() !== wd) x.setDate(x.getDate() + 1); return ymd(x); };
// the first Sunday of a month at least 40 days out
const firstSun = () => { const x = new Date(); x.setHours(12, 0, 0, 0); x.setDate(1); x.setMonth(x.getMonth() + 2); while (x.getDay() !== 0) x.setDate(x.getDate() + 1); return ymd(x); };

// invite.html's own series words, run as is
function invite() {
  const src = fs.readFileSync(new URL("../public/invite.html", import.meta.url), "utf8"), a = src.indexOf("// ---------- series: a class"), b = src.indexOf("// ---------- end series helpers", a);
  assert.ok(a > 0 && b > a, "invite.html has its series helpers");
  const ctx = { HHMM: /^\d{2}:\d{2}$/ }; vm.createContext(ctx);
  vm.runInContext(`const clock = (t) => HHMM.test(t || "") ? new Date("2000-01-01T" + t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/:00(?=\\s)/, "").replace(/\\s([AP]M)$/, (_, x) => x.toLowerCase()) : "";\n`
    + src.slice(a, b) + "\nthis.srWhen=srWhen; this.srPrice=srPrice;", ctx);
  return ctx;
}

async function host(email, handle, name, extra = {}) {
  const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" });
  const cookie = r.headers.get("set-cookie").split(";")[0];
  assert.ok((await post("/api/host/profile", { handle, name, tagline: "Classes and suppers.", city: "Brooklyn", hood: "Bed-Stuy", emoji: "💃", ...extra }, cookie)).ok);
  return cookie;
}
const D = { course: next(3), salsa: next(2), month: firstSun(), bachata: next(5), pop: next(6, 12), wheel: next(4, 14), austin: next(6, 16), home: next(0, 18), chip: next(1, 20) };

before(async () => {
  process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "acc-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; process.env.ENCORE_DIRECTORY_CACHE_MS = "0"; resetLoginLimits();
  srv = await startServer();
  const a = await host("rio.acc@example.com", "rio-acc", "Rio Moves");
  const up = { startTime: "19:00", city: "Brooklyn", hood: "Bed-Stuy", discoverable: true };
  const add = async (id, e) => assert.ok((await put("events/" + id, { ...up, ...e }, a)).ok, id);
  await add("accCourse", { name: "Improv for beginners", date: D.course, activity: "workshop", repeat: "weekly", sessions: 8, price: "$320", headcount: 12 });
  await add("accSalsa", { name: "Salsa for beginners", date: D.salsa, activity: "workshop", repeat: "weekly", price: "$20", passPrice: 70, passCount: 4, headcount: 16 });
  await add("accMonth", { name: "Sunday sound bath", date: D.month, startTime: "", repeat: "monthly", free: true });
  await add("accBachata", { name: "Bachata night", date: D.bachata, price: "$15", headcount: 10, hideGuests: true });
  await add("accPop", { name: "Dumpling pop-up", date: D.pop, activity: "pop-up", price: "$12", preorder: true });
  await add("accWheel", { name: "Pottery wheel night", date: D.wheel, activity: "workshop", price: "$45", headcount: 8 });
  await add("accAustin", { name: "Tacos in Austin", date: D.austin, city: "Austin", hood: undefined, activity: "dinner", price: "$30" });
  await add("accHome", { name: "Supper at home", date: D.home, hood: undefined, activity: "dinner", price: "$30" });
  await add("accChip", { name: "Spanish conversation class", date: D.chip, price: "chip" });
  const S = scopeStore(srv.store, wsOf("rio-acc"));
  S.set("rsvps/w1", { eventId: "accWheel", response: "going", email: "w1@guest.example.com", name: "W One" });
  S.set("rsvps/w2", { eventId: "accWheel", response: "going", email: "w2@guest.example.com", name: "W Two", plusOnes: 1 });
  // kudos from an earlier salsa night: the class keeps its id, so the upcoming one carries them
  S.set("kudos/s1", { eventId: "accSalsa", rid: "s1", name: "Ana Ruiz", email: "ana@guest.example.com", tags: ["fun"], love: "Great teacher", at: Date.now() - 5000 });
  const r = await (await post("/api/host/scrapbook/import", { rows: [{ title: "Harbour picnic", date: "2025-03-01", place: "Sydney, Australia" }, { title: "Road trip supper", date: "2025-04-01", place: "USA" }, { title: "Toronto supper", date: "2025-05-01", place: "Toronto, ON, Canada" }] }, a)).json();
  assert.equal(r.added.length, 3);
});
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_DIRECTORY_CACHE_MS"]) delete process.env[k]; await srv.close(); });

test("series words match invite.html's, case for case", () => {
  const I = invite();
  const cases = [
    { date: "2027-01-06", startTime: "19:00", repeat: "weekly", sessions: 8, price: "$320" },
    { date: "2027-01-06", startTime: "19:00", endTime: "21:30", repeat: "weekly", sessions: 6, price: "$180" },
    { date: "2026-12-01", startTime: "19:00", repeat: "weekly", price: "$20", passPrice: 70, passCount: 4 },
    { date: "2026-12-01", startTime: "07:30", repeat: "biweekly", sessions: 4, price: "120" },
    { date: "2026-12-06", repeat: "monthly" },
    { date: "2026-12-31", startTime: "18:00", repeat: "monthly" },
    { date: "2026-12-01", passPrice: 70, passCount: 4 },
    { date: "2026-12-01", sessions: 6, price: "chip" },
  ];
  for (const c of cases) {
    assert.equal(seriesOf(c).when, I.srWhen(c), JSON.stringify(c));
    const want = I.srPrice(c); if (want) assert.equal(priceOf(c), want, JSON.stringify(c));
  }
  assert.equal(seriesOf(cases[0]).when, "8 Wednesdays, Jan 6 to Feb 24 · 7pm");
  assert.equal(seriesOf(cases[0]).ends, "2027-02-24");
  assert.equal(seriesOf(cases[2]).when, "Every Tue · 7pm");
  assert.equal(seriesOf(cases[4]).when, "First Sun of each month");
  assert.deepEqual(seriesOf(cases[2]).pass, { price: "$70", count: 4 });
  assert.deepEqual(seriesOf({ date: "2026-12-01", price: "$20" }), { repeat: "", sessions: null, ends: "", pass: null, when: "" }, "a one-off has no series");
});

test("prices in words: course, pass, per person, free, chip, each", () => {
  assert.equal(priceOf({ price: "$320", sessions: 8 }), "$320 for all 8");
  assert.equal(priceOf({ price: "$20", passPrice: 70, passCount: 4, repeat: "weekly" }), "$20 a class, or $70 for 4");
  assert.equal(priceOf({ price: "$45" }), "$45 a person");
  assert.equal(priceOf({ price: "45" }), "$45 a person");
  assert.equal(priceOf({ free: true }), "Free");
  assert.equal(priceOf({ price: "chip", sessions: 6 }), "Pay what you like");
  assert.equal(priceOf({ price: "$12", preorder: true }), "$12 each");
  assert.equal(priceOf({ price: "$12", priceUnit: "each" }), "$12 each");
});

test("records carry repeat, sessions, ends, pass and when", async () => {
  const c = await ev("accCourse");
  assert.equal(c.price, "$320 for all 8"); assert.equal(c.repeat, "weekly"); assert.equal(c.sessions, 8); assert.equal(c.pass, null);
  assert.match(c.when, /^8 Wednesdays, [A-Z][a-z]{2} \d{1,2} to [A-Z][a-z]{2} \d{1,2} · 7pm$/); assert.equal(c.ends, seriesOf({ date: D.course, sessions: 8, repeat: "weekly" }).ends);
  assert.equal(c.format, "class", "an improv course is a class, not a workshop");
  const s = await ev("accSalsa");
  assert.equal(s.price, "$20 a class, or $70 for 4"); assert.deepEqual(s.pass, { price: "$70", count: 4 }); assert.equal(s.when, "Every Tue · 7pm"); assert.equal(s.sessions, null); assert.equal(s.ends, "");
  const m = await ev("accMonth"); assert.equal(m.when, "First Sun of each month"); assert.equal(m.repeat, "monthly"); assert.equal(m.price, "Free");
  assert.equal((await ev("accPop")).price, "$12 each");
  assert.equal((await ev("accChip")).price, "Pay what you like");
  const w = await ev("accWheel"); assert.equal(w.price, "$45 a person"); assert.equal(w.when, ""); assert.equal(w.repeat, ""); assert.equal(w.format, "workshop");
});

test("JSON-LD: a course is one Event with a schedule and no per-person offer; a weekly class offers per class", async () => {
  const page = await (await fetch(srv.base + "/events")).text();
  const ld = JSON.parse(page.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  const course = ld.find((x) => x.name === "Improv for beginners");
  assert.equal(course["@type"], "Event"); assert.equal(course.eventSchedule["@type"], "Schedule");
  assert.equal(course.eventSchedule.repeatFrequency, "P1W"); assert.equal(course.eventSchedule.repeatCount, 8); assert.equal(course.eventSchedule.byDay, "https://schema.org/Wednesday");
  assert.equal(course.endDate, (await ev("accCourse")).ends);
  assert.ok(![].concat(course.offers || []).some((o) => o.price === 40 || /person/i.test(o.name || "")), "no per-person offer");
  assert.deepEqual([].concat(course.offers).map((o) => o.price), [320], "one offer: the whole course");
  const salsa = ld.find((x) => x.name === "Salsa for beginners");
  assert.equal(salsa.eventSchedule.repeatFrequency, "P1W"); assert.equal(salsa.eventSchedule.byDay, "https://schema.org/Tuesday"); assert.ok(!("repeatCount" in salsa.eventSchedule));
  assert.deepEqual(salsa.offers.map((o) => [o.price, o.name]), [[20, "One class"], [70, "4-class pass"]]);
  const pop = ld.find((x) => x.name === "Dumpling pop-up"); assert.equal(pop.offers.price, 12);
  const month = ld.find((x) => x.name === "Sunday sound bath"); assert.equal(month.eventSchedule.repeatFrequency, "P1M"); assert.equal(month.eventSchedule.byMonthWeek, 1); assert.equal(month.isAccessibleForFree, true);
});

test("CSV, OpenAPI and llms.txt carry the series fields", async () => {
  const lines = (await (await fetch(srv.base + "/api/v1/events.csv?host=rio-acc")).text()).trim().split(/\r\n/), head = lines[0].split(",");
  for (const c of ["when", "repeat", "sessions", "pass_price", "pass_count"]) assert.ok(head.includes(c), c);
  const row = lines.find((l) => l.startsWith("accSalsa,")); assert.ok(row);
  assert.ok(row.endsWith(",Every Tue · 7pm,weekly,,$70,4"), row);
  const spec = await get("/api/v1/openapi.json"), P = spec.components.schemas.Event.properties;
  for (const k of ["repeat", "sessions", "ends", "pass", "when"]) assert.ok(P[k], k);
  assert.match(JSON.stringify(spec.paths["/api/v1/events"]), /class \(dance, salsa/);
  const llms = await (await fetch(srv.base + "/llms.txt")).text();
  assert.match(llms, /\$320 for all 8/); assert.match(llms, /Every Tue · 7pm/); assert.match(llms, /format=class/); assert.ok(!/—/.test(llms));
});

test("class is its own format: filter, facets, MCP", async () => {
  assert.equal(formatOf({ title: "Salsa for beginners", activity: "workshop" }), "class");
  assert.equal(formatOf({ title: "Bachata night" }), "class");
  assert.equal(formatOf({ title: "Sunrise yoga" }), "class");
  assert.equal(formatOf({ title: "Spanish conversation class" }), "class");
  assert.equal(formatOf({ title: "Piano lessons" }), "class");
  assert.equal(formatOf({ title: "French bistro night", activity: "dinner" }), "dinner", "a language word alone isn't a class");
  assert.equal(formatOf({ title: "Pottery wheel night", activity: "workshop" }), "workshop");
  const ids = (await get("/api/v1/events?format=class&host=rio-acc")).data.map((e) => e.id).sort();
  assert.deepEqual(ids, ["accBachata", "accChip", "accCourse", "accSalsa"]);
  assert.ok(!(await get("/api/v1/events?format=workshop&host=rio-acc")).data.some((e) => e.format === "class"));
  const F = await get("/api/v1/formats?status=upcoming"); assert.ok(F.formats.find((f) => f.format === "class").count >= 4);
  const se = PUBLIC_TOOLS.find((t) => t.name === "search_events").inputSchema.properties.format;
  assert.match(se.description, /class = a class or course/); assert.ok(se.examples.includes("class") && se.examples.includes("workshop"));
  const html = fs.readFileSync(new URL("../public/events.html", import.meta.url), "utf8"); assert.match(html, /<option value="">Any kind<\/option>/); assert.match(html, /class: "🎓"/);
});

test("search: any of the words, best first, filler words dropped", async () => {
  assert.deepEqual(queryWords("Pottery classes this weekend near me"), ["pottery", "class"]);
  assert.deepEqual(queryWords("the a an"), []);
  const dance = (await get("/api/v1/events?q=dance&host=rio-acc")).data.map((e) => e.id);
  for (const id of ["accSalsa", "accBachata"]) assert.ok(dance.includes(id), "dance finds " + id);
  assert.ok(!dance.includes("accAustin"));
  const pc = (await get("/api/v1/events?q=pottery+class&host=rio-acc")).data.map((e) => e.id);
  assert.equal(pc[0], "accWheel", "the pottery event comes first"); assert.ok(pc.includes("accCourse"), "classes match on one word");
  // "this weekend" leaves the words and becomes this weekend's dates (Friday to Sunday), in Brooklyn's time zone
  { const W = dateRange("this weekend", "America/New_York"), L = (await get("/api/v1/events?q=dance+this+weekend&host=rio-acc")).data;
    assert.ok(L.every((e) => e.start >= W.from && e.start <= W.to), JSON.stringify(L.map((e) => e.start)));
    const all = (await get("/api/v1/events?q=dance&host=rio-acc")).data.filter((e) => e.start >= W.from && e.start <= W.to); assert.equal(L.length, all.length); }
  assert.deepEqual((await get("/api/v1/events?q=tacos+austin&host=rio-acc")).data.map((e) => e.id)[0], "accAustin");
  // the MCP tool searches the same way
  const r = await (await post("/mcp/public", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_events", arguments: { q: "dance", host: "rio-acc" } } })).json();
  assert.ok(r.result.structuredContent.data.some((e) => e.id === "accSalsa"));
});

test("spots left: headcount minus who's going, the full headcount with no replies, null when hidden or unset", async () => {
  assert.equal((await ev("accWheel")).spots_left, 5, "8 spots, 3 seats taken (one with a plus-one)");
  assert.equal((await ev("accCourse")).spots_left, 12, "no replies yet: every spot is open");
  assert.equal((await ev("accBachata")).spots_left, null, "the host hides who's going");
  assert.equal((await ev("accPop")).spots_left, null, "no headcount");
});

test("places: no host neighborhood for an event elsewhere; countries aren't cities", async () => {
  const au = await ev("accAustin"); assert.equal(au.city, "Austin"); assert.equal(au.area, "", "Bed-Stuy is the host's, not Austin's");
  const home = await ev("accHome"); assert.equal(home.city, "Brooklyn"); assert.equal(home.area, "Bed-Stuy");
  assert.deepEqual(splitPlace("Sydney, Australia"), { city: "Sydney", area: "" });
  assert.deepEqual(splitPlace("USA"), { city: "", area: "" });
  assert.deepEqual(splitPlace("United States"), { city: "", area: "" });
  assert.deepEqual(splitPlace("Toronto, ON, Canada"), { city: "Toronto, ON", area: "" });
  assert.deepEqual(splitPlace("Chelsea, New York"), { city: "New York", area: "Chelsea" });
  const past = (await get("/api/v1/events?status=past&host=rio-acc")).data, by = (t) => past.find((e) => e.title === t);
  assert.equal(by("Harbour picnic").city, "Sydney"); assert.equal(by("Road trip supper").city, ""); assert.equal(by("Toronto supper").city, "Toronto, ON");
  assert.ok(!(await get("/api/v1/formats?status=all")).cities.some((c) => /^(Australia|USA|Canada)$/.test(c.city)));
});

test("reviews on /events: an upcoming class shows its own; the host line shows once per host", async () => {
  const s = await ev("accSalsa"); assert.equal(s.reviews.count, 1); assert.equal(s.reviews.items[0].name, "Ana");
  const html = fs.readFileSync(new URL("../public/events.html", import.meta.url), "utf8");
  assert.match(html, /!seen\.has\(e\.host\.handle\) && hostRev\[e\.host\.handle\]/, "the host line checks the hosts already shown");
  assert.match(html, /shown\.map\(\(e\) => card\(e, seen\)\)/, "one set of hosts per render");
});

test("public MCP: parse errors, structuredContent and outputSchema", async () => {
  const bad = await fetch(srv.base + "/mcp/public", { method: "POST", headers: J, body: "{not json" });
  assert.deepEqual(await bad.json(), { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  const tools = (await (await post("/mcp/public", { jsonrpc: "2.0", id: 1, method: "tools/list" })).json()).result.tools;
  for (const t of tools) { assert.equal(t.outputSchema?.type, "object", t.name); }
  const r = await (await post("/mcp/public", { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_event", arguments: { id: "accCourse" } } })).json();
  assert.equal(r.result.structuredContent.id, "accCourse"); assert.equal(r.result.structuredContent.price, "$320 for all 8");
  assert.deepEqual(JSON.parse(r.result.content[0].text), r.result.structuredContent, "the text and the structured result agree");
  const f = await (await post("/mcp/public", { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_formats", arguments: {} } })).json();
  for (const k of tools.find((t) => t.name === "list_formats").outputSchema.required) assert.ok(k in f.result.structuredContent, k);
  const miss = await (await post("/mcp/public", { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_event", arguments: { id: "nope" } } })).json();
  assert.equal(miss.result.isError, true); assert.ok(!("structuredContent" in miss.result), "errors are text only");
});
