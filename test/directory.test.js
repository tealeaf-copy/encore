import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore } from "../server/workspaces.js";

let srv;
const J = { "Content-Type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const put = (path, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const get = async (path) => { const r = await fetch(srv.base + path); assert.equal(r.status, 200, path); return r.json(); };
const mcp = async (body) => (await post("/mcp/public", body)).json();
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const wsOf = (handle) => srv.store.get("system/handle-" + handle).data.ws;

async function host(email, handle, name, extra = {}) {
  const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" });
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const p = await post("/api/host/profile", { handle, name, tagline: "Small dinners for new friends.", city: "Brooklyn", hood: "Bed-Stuy", emoji: "🍜", ...extra }, cookie);
  assert.ok(p.ok, "profile saved");
  return cookie;
}

before(async () => {
  process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "dir-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; process.env.ENCORE_DIRECTORY_CACHE_MS = "0"; resetLoginLimits();
  srv = await startServer();
  // host 1: open, ask-to-join, link-only, unlisted, an example, a past event with kudos, and an imported scrapbook event
  const a = await host("ada.dir@example.com", "ada-dir", "Ada's Table");
  const up = { date: day(20), startTime: "19:00", city: "Brooklyn", hood: "Bed-Stuy", headcount: 12 };
  assert.ok((await put("events/dirOpen1", { ...up, name: "Dumpling supper", activity: "dinner", price: "$20", ticketUrl: "https://venmo.com/u/ada-secret-pay", meetPoint: "Grand Army Plaza gate", discoverable: true, tags: ["dumplings"] }, a)).ok);
  assert.ok((await put("events/dirAsk1", { ...up, date: day(21), name: "Book supper", meetPoint: "1012 Sterling Pl, apt 3R", approvalRequired: true, discoverable: true }, a)).ok);
  assert.ok((await put("events/dirLink1", { ...up, date: day(22), name: "Secret birthday", meetPoint: "1012 Sterling Pl, apt 3R", discoverable: false, published: true }, a)).ok);
  assert.ok((await put("events/dirUnl1", { ...up, date: day(23), name: "Unlisted brunch", discoverable: true, unlisted: true }, a)).ok);
  assert.ok((await put("events/dirEx1", { ...up, date: day(24), name: "Example party", discoverable: true, example: true }, a)).ok);
  assert.ok((await put("events/dirRun1", { ...up, date: day(30), startTime: "08:30", name: "Prospect Park 5k", activity: "run", free: true, discoverable: true }, a)).ok);
  assert.ok((await put("events/dirPast1", { ...up, date: day(-10), name: "Pierogi night", activity: "dinner", discoverable: true }, a)).ok);
  assert.ok((await put("events/dirPast2", { ...up, date: day(-40), name: "Quiet tea", discoverable: true }, a)).ok);
  const r = await (await post("/api/host/scrapbook/import", { rows: [{ title: "Lunar New Year potluck", date: "2025-02-08", place: "Queens, New York", guests: 22 }] }, a)).json();
  assert.equal(r.added.length, 1);
  const S = scopeStore(srv.store, wsOf("ada-dir"));
  const k = (id, name, extra) => S.set("kudos/" + id, { eventId: "dirPast1", rid: id, name, email: id + "@guest.example.com", improve: "PRIVATE-IMPROVE-NOTE", compare: "better", at: Date.now() - 1000, ...extra });
  k("r1", "Mina Park", { tags: ["food", "again"], love: "The pierogi were perfect" });
  k("r2", "Jo Lee", { tags: ["welcome", "again"], love: "" });
  k("r3", "Sam Ortiz", { tags: ["food"], love: "Met so many people" });
  k("r4", "", { tags: ["vibe"], love: "Cozy", compare: undefined });
  // host 2: kudos hidden on their page
  const b = await host("bo.dir@example.com", "bo-dir", "Bo's Bakes", { sections: { kudos: false } });
  assert.ok((await put("events/dirBoPast", { ...up, date: day(-5), name: "Bread class", activity: "workshop", discoverable: true }, b)).ok);
  scopeStore(srv.store, wsOf("bo-dir")).set("kudos/b1", { eventId: "dirBoPast", rid: "b1", name: "Kim", email: "kim@guest.example.com", tags: ["food"], love: "HIDDEN-KUDOS-TEXT", at: Date.now() });
  // host 3: left the directory (past events and reviews out; upcoming still follow discoverable)
  const c = await host("cy.dir@example.com", "cy-dir", "Cy Hikes", { directory: false });
  assert.ok((await put("events/dirCyPast", { ...up, date: day(-5), name: "Cy past hike", activity: "hike", discoverable: true }, c)).ok);
  assert.ok((await put("events/dirCyUp", { ...up, date: day(15), name: "Cy sunrise hike", activity: "hike", discoverable: true }, c)).ok);
});
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_DIRECTORY_CACHE_MS"]) delete process.env[k]; await srv.close(); });

test("Upcoming events are exactly what Discover lists", async () => {
  const D = await get("/api/public/discover"), want = D.events.filter((e) => !e.sample).map((e) => e.id).sort();
  const got = (await get("/api/v1/events?limit=100")).data.map((e) => e.id).sort();
  assert.deepEqual(got, want);
  for (const id of ["dirOpen1", "dirAsk1", "dirRun1", "dirCyUp"]) assert.ok(got.includes(id), id);
  for (const id of ["dirLink1", "dirUnl1", "dirEx1", "dirPast1"]) assert.ok(!got.includes(id), id + " stays out");
});

test("One record shape, with the public price, time, place and links", async () => {
  const e = (await get("/api/v1/events/dirOpen1")).data;
  assert.equal(e.status, "upcoming"); assert.equal(e.start, day(20)); assert.equal(e.time, "7pm"); assert.equal(e.city, "Brooklyn"); assert.equal(e.area, "Bed-Stuy");
  assert.equal(e.format, "dinner"); assert.equal(e.price, "$20 a person"); assert.equal(e.spots_left, 12, "a public headcount of 12 and no replies yet: 12 spots left"); assert.equal(e.source, "hosted"); assert.equal(e.example, false);
  assert.deepEqual(e.host, { handle: "ada-dir", name: "Ada's Table", url: srv.base + "/@ada-dir" }); assert.equal(e.url, srv.base + "/e/dirOpen1"); assert.deepEqual(e.tags, ["dumplings"]);
  for (const k of ["id", "title", "status", "start", "time", "city", "area", "format", "tags", "price", "spots_left", "host", "url", "source", "original_link", "companies", "cover", "example", "reviews"]) assert.ok(k in e, k);
  assert.equal((await get("/api/v1/events/dirRun1")).data.price, "Free");
  assert.equal((await get("/api/v1/events/dirRun1")).data.format, "run");
  const sb = (await get("/api/v1/events?status=past&host=ada-dir")).data.find((x) => x.source === "scrapbook");
  assert.equal(sb.title, "Lunar New Year potluck"); assert.equal(sb.city, "New York"); assert.equal(sb.area, "Queens"); assert.equal(sb.url, srv.base + "/@ada-dir#scrapbook");
  assert.deepEqual(sb.reviews, { count: 0, would_go_again_pct: null, top_tags: [], items: [] }, "imported events have no reviews");
  assert.equal((await fetch(srv.base + "/api/v1/events/nope")).status, 404);
});

test("Privacy: no address, no link-only event, no pay link, no guest details", async () => {
  const all = JSON.stringify(await get("/api/v1/events?status=all&limit=100&include_examples=1"));
  const csv = await (await fetch(srv.base + "/api/v1/events.csv?status=all&include_examples=1")).text();
  const page = await (await fetch(srv.base + "/events")).text();
  const hostRec = JSON.stringify(await get("/api/v1/hosts/ada-dir")), revs = JSON.stringify(await get("/api/v1/reviews?host=ada-dir&limit=100"));
  for (const blob of [all, csv, page, hostRec, revs]) {
    assert.ok(!/Sterling/.test(blob), "the ask-to-join address never shows");
    assert.ok(!/Grand Army Plaza/.test(blob), "meet points never show");
    assert.ok(!/Secret birthday|dirLink1/.test(blob), "link-only events never show");
    assert.ok(!/venmo|ada-secret-pay/i.test(blob), "no pay links");
    assert.ok(!/@guest\.example\.com|PRIVATE-IMPROVE-NOTE|"compare"|"improve"|"rid"/.test(blob), "no guest emails or private feedback");
    assert.ok(!/Park|Ortiz|\bLee\b/.test(blob.replace(/Prospect Park/g, "")), "first names only");
    assert.ok(!/ada\.dir@example\.com/.test(blob));
  }
  const ask = (await get("/api/v1/events/dirAsk1")).data;
  assert.equal(ask.ask_to_join, true); assert.ok(!("meetPoint" in ask));
});

test("Filters: q, city, format, status, dates, host; and pagination", async () => {
  assert.deepEqual((await get("/api/v1/events?q=dumpling")).data.map((e) => e.id), ["dirOpen1"]);
  assert.ok((await get("/api/v1/events?city=bed-stuy")).data.every((e) => /bed-stuy/i.test(e.area + e.city)));
  assert.deepEqual((await get("/api/v1/events?format=run")).data.map((e) => e.id), ["dirRun1"]);
  assert.deepEqual((await get(`/api/v1/events?from=${day(25)}&to=${day(35)}&host=ada-dir`)).data.map((e) => e.id), ["dirRun1"]);
  const past = (await get("/api/v1/events?status=past&host=ada-dir")).data;
  assert.ok(past.every((e) => e.status === "past")); assert.deepEqual(past.map((e) => e.title), ["Pierogi night", "Quiet tea", "Lunar New Year potluck"], "newest first");
  assert.ok((await get("/api/v1/events?include_examples=1")).data.every((e) => e.id !== "dirEx1"), "an example event (e.example) never shows");
  const p1 = await get("/api/v1/events?status=all&limit=2"); assert.equal(p1.data.length, 2); assert.ok(p1.total > 2); assert.ok(p1.next_cursor);
  const p2 = await get("/api/v1/events?status=all&limit=2&cursor=" + p1.next_cursor);
  assert.ok(!p2.data.some((e) => p1.data.some((x) => x.id === e.id)), "pages don't overlap");
  assert.equal((await get("/api/v1/events?limit=1000&status=all")).data.length, Math.min(100, p1.total), "at most 100 a page");
  const F = await get("/api/v1/formats"); assert.ok(F.formats.find((f) => f.format === "dinner").count >= 2); assert.ok(F.cities.find((c) => c.city === "Brooklyn"));
});

test("Reviews: first names, loved lines, chips and counts; never the private parts", async () => {
  const e = (await get("/api/v1/events/dirPast1")).data, R = e.reviews;
  assert.equal(R.count, 4); assert.equal(R.items.length, 4);
  assert.equal(R.would_go_again_pct, 75, "3 of 4 said they'd go again (the again chip or 'better than most')");
  assert.deepEqual(R.top_tags[0], { tag: "food", label: "Amazing food", count: 2 });
  assert.deepEqual(R.items.map((k) => k.name).sort(), ["A guest", "Jo", "Mina", "Sam"]);
  assert.ok(R.items.find((k) => k.name === "Mina").tags.includes("Would go again"));
  for (const k of R.items) assert.deepEqual(Object.keys(k).sort(), ["at", "name", "tags", "text", "verified", "verified_label"]);
  for (const k of R.items) assert.equal(k.verified, "rsvp", "older kudos with no reply on file read as Replied I'm in");
  assert.equal((await get("/api/v1/events/dirPast2")).data.reviews.count, 0, "no kudos, a count of 0");
  const H = (await get("/api/v1/hosts/ada-dir")).data; assert.equal(H.reviews.count, 4); assert.equal(H.reviews.would_go_again_pct, 75); assert.ok(H.events.length >= 5);
  const L = await get("/api/v1/reviews?host=ada-dir"); assert.equal(L.total, 4); assert.equal(L.data[0].event.id, "dirPast1");
  assert.equal((await get("/api/v1/reviews?event=dirPast1&q=perfect")).total, 1);
});

test("A page with kudos hidden shows no reviews; directory:false takes past events out", async () => {
  const bo = (await get("/api/v1/events/dirBoPast")).data; assert.equal(bo.reviews.count, 0);
  assert.equal((await get("/api/v1/hosts/bo-dir")).data.reviews.count, 0); assert.equal((await get("/api/v1/reviews?host=bo-dir")).total, 0);
  assert.ok(!JSON.stringify(await get("/api/v1/events?status=all&limit=100")).includes("HIDDEN-KUDOS-TEXT"));
  const cy = (await get("/api/v1/events?status=all&host=cy-dir")).data.map((e) => e.id);
  assert.deepEqual(cy, ["dirCyUp"], "upcoming follows discoverable; past events are out");
  assert.equal((await fetch(srv.base + "/api/v1/events/dirCyPast")).status, 404);
});

test("Hosts: public cards only", async () => {
  const L = await get("/api/v1/hosts?city=brooklyn"); const ada = L.data.find((h) => h.handle === "ada-dir");
  assert.ok(ada); assert.ok(ada.upcoming_count >= 3);
  const blob = JSON.stringify(L);
  for (const k of ["venmo", "paypal", "cashapp", "legalName", "taxId", "bizAddress", "supportUrl", "email"]) assert.ok(!blob.includes(`"${k}"`), k);
  assert.equal((await fetch(srv.base + "/api/v1/hosts/nobody-here")).status, 404);
});

test("API: CORS open, cached, OpenAPI is valid JSON, CSV has a header", async () => {
  const r = await fetch(srv.base + "/api/v1/events"); assert.equal(r.headers.get("access-control-allow-origin"), "*"); assert.match(r.headers.get("cache-control"), /max-age=60/);
  const o = await fetch(srv.base + "/api/v1/events", { method: "OPTIONS" }); assert.equal(o.status, 204); assert.equal(o.headers.get("access-control-allow-origin"), "*");
  const spec = JSON.parse(await (await fetch(srv.base + "/api/v1/openapi.json")).text());
  assert.equal(spec.openapi, "3.1.0");
  for (const p of ["/api/v1/events", "/api/v1/events/{id}", "/api/v1/events.csv", "/api/v1/hosts", "/api/v1/hosts/{handle}", "/api/v1/formats", "/api/v1/reviews"]) assert.ok(spec.paths[p], p);
  const c = await fetch(srv.base + "/api/v1/events.csv?status=all"); assert.match(c.headers.get("content-type"), /text\/csv/);
  const lines = (await c.text()).trim().split(/\r\n/);
  assert.equal(lines[0], "id,title,status,start,time,city,area,format,tags,price,spots_left,host_handle,host_name,host_url,url,source,original_link,companies,cover,example,review_count,would_go_again_pct,when,repeat,sessions,pass_price,pass_count");
  assert.ok(lines.length > 3);
  const llms = await (await fetch(srv.base + "/llms.txt")).text(); assert.match(llms, /\/mcp\/public/); assert.match(llms, /openapi\.json/); assert.ok(!/—/.test(llms), "no em dashes");
  const page = await (await fetch(srv.base + "/events")).text();
  const ld = JSON.parse(page.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  assert.ok(ld.some((x) => x["@type"] === "Event" && x.name === "Dumpling supper" && x.startDate === day(20) + "T19:00" && x.location.address.addressLocality === "Brooklyn"));
  assert.match(page, /Agents and builders/);
});

test("Public MCP: initialize, tools/list, tools/call search_events and get_reviews, batches", async () => {
  const init = await mcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(init.result.serverInfo.name, "pottery-lab-directory");
  assert.deepEqual((await mcp({ jsonrpc: "2.0", id: 2, method: "ping" })).result, {});
  const tools = (await mcp({ jsonrpc: "2.0", id: 3, method: "tools/list" })).result.tools.map((t) => t.name);
  assert.deepEqual(tools, ["search_events", "get_event", "list_hosts", "get_host", "list_formats", "get_reviews", "get_leaderboard"]);
  const s = await mcp({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "search_events", arguments: { q: "dumpling" } } });
  const out = JSON.parse(s.result.content[0].text); assert.equal(out.total, 1); assert.equal(out.data[0].id, "dirOpen1");
  const rv = JSON.parse((await mcp({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_reviews", arguments: { event_id: "dirPast1" } } })).result.content[0].text);
  assert.equal(rv.total, 4); assert.ok(!JSON.stringify(rv).includes("PRIVATE-IMPROVE-NOTE"));
  const bad = await mcp({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "create_event", arguments: {} } }); assert.equal(bad.error.code, -32602, "read-only: no write tools");
  const batch = await mcp([{ jsonrpc: "2.0", id: 7, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "get_event", arguments: { id: "dirLink1" } } }]);
  assert.equal(batch.length, 2); assert.equal(batch[1].result.isError, true, "link-only events aren't there");
  assert.equal((await post("/mcp/public", { jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  const priv = await post("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }); assert.equal(priv.status, 401, "the private MCP still needs a token");
});

test("Reviews never show an email or phone number a guest typed", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("../server/directory.js", import.meta.url), "utf8");
  const m = src.match(/const noContact = (\(t\) => [^\n]+);/); assert.ok(m, "noContact exists");
  const noContact = eval(m[1]);
  assert.equal(noContact("Email me at ana@example.com or call (415) 555-0101!"), "Email me at … or call …!");
  assert.equal(noContact("Came with 2 friends, 10/10"), "Came with 2 friends, 10/10");
});
