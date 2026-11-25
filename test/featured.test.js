// Featured events and named sections in the scrapbook: limits and validation on the owner routes, what visitors get
// back (sections in order, never empty ones, the featured order), Potto's "Sort my events" suggestions, and prepared
// pages carrying sections into a claimed scrapbook.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { suggestSections, cleanScrapSections, presetToScrapbook, guessFormat, MAX_FEATURED } from "../server/scrapbook.js";
import { showcasePast, showcaseSections } from "../server/community.js";

// a field marketer's year: a summit, five exec dinners, a four-event program for one company, two meetups, a workshop online
const FIELD = [
  { id: "a1", title: "Customer Summit 2025", date: "2025-09-18", format: "summit", place: "Boston" },
  ...["Jan", "Mar", "May", "Jul", "Nov"].map((m, i) => ({ id: "d" + i, title: `NYC exec dinner: ${m}`, date: `2025-${String(i * 2 + 1).padStart(2, "0")}-10` })),
  { id: "r1", title: "Rutter coffee with finance leads", date: "2024-04-09" }, { id: "r2", title: "Rutter dinner at Carbone", date: "2024-05-21" },
  { id: "r3", title: "Rutter API workshop", date: "2024-06-12" }, { id: "r4", title: "Rutter dinner at Nobu", date: "2024-10-03" },
  { id: "m1", title: "Revenue ops meetup", date: "2025-02-26" }, { id: "m2", title: "Partner happy hour", date: "2025-06-05" },
  { id: "o1", title: "Pipeline workshop (virtual)", date: "2025-04-15", place: "Online" },
];

test("Sort my events: field programs, customer events, exec dinners, community and online, suggestions only", () => {
  const { sections, formats } = suggestSections(FIELD, []);
  const by = Object.fromEntries(sections.map((s) => [s.name, s]));
  assert.deepEqual(sections.map((s) => s.name), ["Customer events", "Executive dinners", "Rutter, 2024", "Partner and community", "Online"]);
  assert.equal(by["Rutter, 2024"].kind, "program"); assert.deepEqual(by["Rutter, 2024"].items, ["r1", "r2", "r3", "r4"], "in date order");
  assert.deepEqual(by["Executive dinners"].items.sort(), ["d0", "d1", "d2", "d3", "d4"], "five dinners in one city are not a program");
  assert.deepEqual(by["Customer events"].items, ["a1"]); assert.deepEqual(by["Online"].items, ["o1"]); assert.deepEqual(by["Partner and community"].items.sort(), ["m1", "m2"]);
  assert.equal(formats.r1, "coffee"); assert.equal(formats.r3, "workshop"); assert.equal(formats.a1, undefined, "a format the host set isn't guessed again");
  assert.ok(sections.every((s) => !s.blurb), "Potto doesn't write the blurbs");
  // a company named on the events makes a program even when the titles don't say it
  const named = suggestSections([1, 2, 3].map((i) => ({ id: "c" + i, title: `Dinner ${i}`, date: `2023-0${i}-01`, company: "Acme" })), []);
  assert.equal(named.sections[0].name, "Acme, 2023"); assert.equal(named.sections[0].kind, "program");
  // events already in a section stay put; a section with the same name takes the new ones
  const again = suggestSections(FIELD.map((x) => (x.id.startsWith("d") ? { ...x, section: "din" } : x)), [{ id: "din", name: "Executive dinners", kind: "list" }, { id: "on", name: "Online", kind: "list" }]);
  assert.ok(!again.sections.some((s) => s.items.some((i) => i.startsWith("d"))));
  assert.deepEqual(again.sections.find((s) => s.name === "Online"), { ...again.sections.find((s) => s.name === "Online"), id: "on", existing: true });
  assert.equal(suggestSections([{ id: "x", title: "Supper club", date: "2025-01-01" }], []).sections[0].name, "Dinners", "no exec words, no 'Executive'");
  assert.equal(guessFormat({ title: "Kiln Q&A", place: "Online" }), "online");
});

test("Sections are cleaned: at most 8, a name each, list or program, in order, unique ids", () => {
  const L = cleanScrapSections([{ id: "b", name: "B", order: 2, kind: "weird" }, { id: "a", name: "A", order: 1, kind: "program", blurb: "x".repeat(300) }, { name: "" }, { id: "a", name: "dup id" }, ...Array(10).fill({ name: "more" })]);
  assert.equal(L.length, 8); assert.deepEqual(L.slice(0, 2).map((s) => [s.id, s.kind, s.order]), [["a", "program", 0], ["b", "list", 1]]);
  assert.equal(L[0].blurb.length, 140); assert.notEqual(L.find((s) => s.name === "dup id").id, "a");
});

test("Prepared pages: past items carry featured, section and the host lines; sections copy over on claim", () => {
  const past = showcasePast([{ title: "Rutter dinner", date: "2024-05-21", featured: true, featuredOrder: 2, section: "rutter-2024", role: "Produced", room: "Dinner at 41 Bedford Ave for 20 CFOs", proof: "Two deals opened", format: "Dinner" }, { title: "Coffee", section: "BAD ID!" }]);
  assert.deepEqual([past[0].featured, past[0].featuredOrder, past[0].section, past[0].role, past[0].format], [true, 2, "rutter-2024", "Produced", "dinner"]);
  assert.doesNotMatch(past[0].room, /41 Bedford/, "no street address in who was there"); assert.equal(past[1].section, "");
  const P = { handle: "x", scrapbook: past, ...showcaseSections({ sections: [{ id: "rutter-2024", name: "Rutter, 2024", kind: "program", blurb: "A year of events for one client" }] }) };
  assert.equal(P.sections, undefined, "the page's show/hide switches aren't confused with scrapbook sections");
  const B = presetToScrapbook(P); assert.deepEqual(B.sections.map((s) => [s.id, s.kind]), [["rutter-2024", "program"]]); assert.equal(B.items[0].section, "rutter-2024");
  assert.deepEqual(showcaseSections({ sections: { past: false } }), {}, "an object is still the show/hide switches");
});

let srv;
const J = { "content-type": "application/json" };
before(async () => { srv = await startServer(); process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "featured-secret"; });
after(async () => { delete process.env.ENCORE_SIGNUP; delete process.env.SESSION_SECRET; await srv.close(); });
const signup = async (email, handle) => { const su = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name: "Field Host", email, password: "long-password-1", mode: "friends" }) });
  const H = { ...J, cookie: su.headers.get("set-cookie").split(";")[0] }; assert.equal((await fetch(srv.base + "/api/host/profile", { method: "POST", headers: H, body: JSON.stringify({ handle, name: "Field Host Page" }) })).status, 200); return H; };
const call = async (H, method, path, body) => { const r = await fetch(srv.base + path, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, j: await r.json().catch(() => ({})) }; };

test("Owner routes: feature up to 6 in order, move to sections, role / room / proof limits, visitors see only filled sections", async () => {
  const H = await signup("field.host@example.com", "field-host");
  const ids = []; for (const x of FIELD) ids.push((await call(H, "POST", "/api/host/scrapbook/import", { item: { ...x, id: undefined, featured: true, section: "zzz", proof: "" } })).j.added[0].id);
  let own = (await call(H, "GET", "/api/host/scrapbook")).j; assert.equal(own.items.length, 13); assert.ok(own.items.every((x) => !x.featured && !x.section), "adding never features or files an event");
  assert.equal(own.limits.featured, 6); assert.equal(own.limits.sections, 8); assert.ok(own.roles.includes("Co-hosted"));
  assert.equal((await call(J, "PATCH", "/api/host/scrapbook/" + ids[0], { featured: true })).status, 401, "signed out");

  // role, room, proof and format: one line each, host-written
  assert.equal((await call(H, "PATCH", "/api/host/scrapbook/" + ids[0], { proof: "x".repeat(141) })).j.code, "too_long");
  assert.equal((await call(H, "PATCH", "/api/host/scrapbook/" + ids[0], { room: "x".repeat(121) })).status, 400);
  assert.equal((await call(H, "PATCH", "/api/host/scrapbook/" + ids[0], { role: "x".repeat(41) })).status, 400);
  const p = await call(H, "PATCH", "/api/host/scrapbook/" + ids[0], { role: "Organized", room: "100+ healthcare leaders at 250 Grand St", proof: "Three customers asked to speak next year", format: "Summit", featured: true });
  assert.equal(p.status, 200); assert.deepEqual([p.j.item.role, p.j.item.format, p.j.item.featured, p.j.item.featuredOrder], ["Organized", "summit", true, 1]); assert.doesNotMatch(p.j.item.room, /250 Grand/);
  for (const id of ids.slice(1, 6)) assert.equal((await call(H, "PATCH", "/api/host/scrapbook/" + id, { featured: true })).status, 200);
  const seventh = await call(H, "PATCH", "/api/host/scrapbook/" + ids[6], { featured: true }); assert.equal(seventh.status, 400); assert.equal(seventh.j.code, "limit");
  assert.equal((await call(H, "PATCH", "/api/host/scrapbook/" + ids[5], { featured: false })).j.item.featured, false);
  // reorder: these five, in this order
  const order = [ids[3], ids[0], ids[1], ids[4], ids[2]];
  assert.equal((await call(H, "PUT", "/api/host/scrapbook-featured", { ids: [...order, ids[5], ids[6]] })).status, 400, "more than 6");
  assert.equal((await call(H, "PUT", "/api/host/scrapbook-featured", { ids: ["ffffffffffff"] })).status, 404);
  assert.deepEqual((await call(H, "PUT", "/api/host/scrapbook-featured", { ids: order })).j.featured, order);

  // sections: validation, then Potto's suggestions applied the way the page does it
  assert.equal((await call(H, "PATCH", "/api/host/scrapbook/" + ids[0], { section: "nope" })).status, 400, "a section has to exist first");
  assert.equal((await call(H, "PUT", "/api/host/scrapbook-sections", { sections: Array(9).fill({ name: "x" }) })).j.code, "limit");
  assert.equal((await call(H, "PUT", "/api/host/scrapbook-sections", { sections: [{ name: "" }] })).status, 400);
  assert.equal((await call(H, "PUT", "/api/host/scrapbook-sections", { sections: [{ name: "x", blurb: "y".repeat(141) }] })).j.code, "too_long");
  assert.equal((await call(H, "PUT", "/api/host/scrapbook-sections", { sections: [{ name: "x", kind: "grid" }] })).status, 400);
  const sug = (await call(H, "GET", "/api/host/scrapbook/suggest")).j; assert.deepEqual(sug.sections.map((s) => s.name), ["Customer events", "Executive dinners", "Rutter, 2024", "Partner and community", "Online"]);
  own = (await call(H, "GET", "/api/host/scrapbook")).j; assert.ok(own.items.every((x) => !x.section), "suggesting changes nothing");
  const empty = { id: "spare1", name: "Booths", kind: "list" };
  const assign = {}; for (const s of sug.sections) for (const i of s.items) assign[i] = s.id;
  const put = await call(H, "PUT", "/api/host/scrapbook-sections", { sections: [...sug.sections.map(({ id, name, blurb, kind }) => ({ id, name, blurb, kind })), empty], assign, formats: sug.formats });
  assert.equal(put.status, 200); assert.equal(put.j.sections.length, 6); const prog = put.j.sections.find((s) => s.kind === "program");
  assert.equal(put.j.items.filter((x) => x.section === prog.id).length, 4); assert.equal(put.j.items.find((x) => /Rutter coffee/.test(x.title)).format, "coffee");
  assert.equal(put.j.items.find((x) => x.title === "Customer Summit 2025").format, "summit", "a format the host set stays");
  // rename the program and give it a line; move one event by hand
  const secs = put.j.sections.map((s) => (s.id === prog.id ? { ...s, name: "Rutter field program, 2024", blurb: "Coffee, dinners and a workshop for Rutter's finance buyers." } : s));
  await call(H, "PUT", "/api/host/scrapbook-sections", { sections: secs });
  const online = put.j.sections.find((s) => s.name === "Online"), mtg = own.items.find((x) => x.title === "Revenue ops meetup");
  assert.equal((await call(H, "PATCH", "/api/host/scrapbook/" + mtg.id, { section: online.id })).j.item.section, online.id);

  // what visitors get: sections in order without the empty one, the featured order, the host's lines
  const pub = (await call({}, "GET", "/api/public/host/field-host/scrapbook")).j;
  assert.deepEqual(pub.sections.map((s) => s.name), ["Customer events", "Executive dinners", "Rutter field program, 2024", "Partner and community", "Online"], "Booths has nothing in it, so it isn't sent");
  assert.deepEqual(pub.featured, order); const summit = pub.items.find((x) => x.id === ids[0]);
  assert.deepEqual([summit.role, summit.proof, summit.format, summit.featured, summit.featuredOrder], ["Organized", "Three customers asked to speak next year", "summit", true, 2]);
  assert.ok(pub.items.every((x) => !x.guests), "no headcount the host didn't type"); assert.ok(pub.items.length <= 200 && MAX_FEATURED === 6);

  // deleting a section leaves its events in the scrapbook, unsectioned
  const left = (await call(H, "PUT", "/api/host/scrapbook-sections", { sections: secs.filter((s) => s.id !== prog.id) })).j;
  assert.equal(left.items.filter((x) => /Rutter/.test(x.title)).every((x) => !x.section), true); assert.equal(left.items.length, 13);
  // a removed event leaves the featured row
  await call(H, "DELETE", "/api/host/scrapbook/" + ids[3]); assert.deepEqual((await call({}, "GET", "/api/public/host/field-host/scrapbook")).j.featured, order.slice(1));
});
