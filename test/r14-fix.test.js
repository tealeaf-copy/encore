// Review round 14 fixes: calendar descriptions never carry the host's brief, series only where they are real and public,
// the one-line reply follows the reply rules, channel posts carry no links, slots and quiet guests on closed events, the
// "Ask me about" scrub, and the client pieces (the /g episode number, quiet controls, dark looks).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore } from "../server/workspaces.js";
import { episodeMap } from "../server/episodes.js";
import { scrubAsk } from "../server/slots.js";
import { vevent, chatSafe, chatName, publicCopy, openEvent } from "../server/hooksout.js";

let srv, host, ws;
const J = { "Content-Type": "application/json" };
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "r14-fix-secret", ENCORE_SIGNUP_PER_HOUR: "100", ENCORE_FAKE_EMAIL: "1", ENCORE_DIRECTORY_CACHE_MS: "0" };
const post = (path, body, h = {}) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...h }, body: JSON.stringify(body) });
const put = (path, body) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { ...J, cookie: host }, body: JSON.stringify(body) });
const patch = (path, body) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PATCH", headers: { ...J, cookie: host }, body: JSON.stringify(body) });
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const S = () => scopeStore(srv.store, ws);
const guest = async (eventId, name, key, response = "going", extra = {}) => { const r = await post("/api/db/collection?path=rsvps", { eventId, name, email: key + "@t.example", response, code: "C" + key, showMe: true, createdAt: Date.now(), ...extra }, { "x-encore-guest": "1", "x-encore-key": "k-" + key.padEnd(10, "x") }); assert.equal(r.status, 200, await r.clone().text()); return (await r.json()).id; };
const get = async (path) => { const r = await fetch(srv.base + path); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, j, t }; };
const reply = async (id, rid, code, response) => { const r = await post("/api/public/reply/" + id, { rid, code, response }); return { status: r.status, j: await r.json() }; };
const base = { casual: true, tz: "UTC", startTime: "19:00", endTime: "22:00", city: "Brooklyn", hood: "Gowanus", headcount: 6, published: true, discoverable: true };

before(async () => {
  Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer();
  const r = await post("/api/signup", { name: "Ada Byte", email: "ada.r14fix@example.com", password: "long-password-1", mode: "friends" }); host = r.headers.get("set-cookie").split(";")[0];
  assert.ok((await post("/api/host/profile", { handle: "ada-r14", name: "Ada's Nights", city: "Brooklyn", hood: "Gowanus" }, { cookie: host })).ok);
  ws = srv.store.get("system/handle-ada-r14").data.ws;
});
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

test("1. calendar DESCRIPTION: the public copy, never the planning brief; none on a closed event", async () => {
  const ev = { date: "2026-12-03", startTime: "19:00", tz: "UTC", concept: "Internal: budget $2k, Sam is on probation", copy: { description: "Bring a [laptop](https://x.example)" } };
  const L = vevent({ id: "e1", ev, title: "Hack night", url: "https://p.example/e/e1", host: "Ada", now: 0 }).join("\n");
  assert.match(L, /DESCRIPTION:Bring a laptop\\nHosted by Ada/); assert.ok(!L.includes("probation") && !L.includes("budget"), "never the concept");
  assert.equal(publicCopy({ concept: "secret" }), "", "no public copy, no description text");
  for (const closed of [{ private: true }, { friendsOnly: true }, { approvalRequired: true }]) assert.ok(!vevent({ id: "e1", ev: { ...ev, ...closed }, title: "x", url: "https://p.example/e/e1", host: "Ada", now: 0 }).some((l) => l.startsWith("DESCRIPTION")), JSON.stringify(closed));
  assert.ok((await put("events/cal1", { ...base, name: "Open table", date: day(4), concept: "VIPs only, my code is 4471", pubDesc: "Soup and bread." })).ok);
  const H = (await get("/@ada-r14.ics")).t; assert.match(H, /DESCRIPTION:Soup and bread\./); assert.ok(!H.includes("4471"));
  assert.ok((await put("events/cal2", { ...base, name: "Secret supper", date: day(5), private: true, discoverable: false, concept: "the code is 4471" })).ok);
  const P = (await get("/e/cal2.ics")).t; assert.ok(!/DESCRIPTION/.test(P) && !P.includes("4471"));
});

test("2. series: no false series from a generic title; 3+ close dates join; the host's Yes and No win", () => {
  const ev = (id, name, date, x = {}) => ({ id, data: { name, date, published: true, ...x } });
  let M = episodeMap([ev("d1", "Dinner", "2026-07-01"), ev("d2", "Dinner", "2026-11-01")]); assert.equal(M.size, 0, "two dinners four months apart");
  M = episodeMap([ev("d1", "Dinner", "2026-07-01"), ev("d2", "Dinner", "2026-07-08"), ev("d3", "Dinner", "2026-07-15")]); assert.equal(M.size, 0, "a generic title never joins on dates alone");
  M = episodeMap([ev("d1", "Dinner", "2026-07-01", { repeat: "weekly" }), ev("d2", "Dinner", "2026-07-08")]); assert.equal(M.get("d2")?.n, 2, "repeat joins");
  M = episodeMap([ev("b1", "Birthday party", "2025-11-01"), ev("b2", "Birthday Party", "2026-11-01")]); assert.equal(M.size, 0);
  M = episodeMap([ev("h1", "Hack night", "2026-01-01"), ev("h2", "Hack night", "2026-01-08")]); assert.equal(M.size, 0, "two dates aren't a series yet");
  M = episodeMap([ev("h1", "Hack night", "2026-01-01"), ev("h2", "Hack night", "2026-01-30"), ev("h3", "Hack night", "2026-03-10")]); assert.equal(M.get("h3")?.n, 3, "gaps of 45 days or less");
  M = episodeMap([ev("h1", "Hack night", "2026-01-01"), ev("h2", "Hack night", "2026-03-01"), ev("h3", "Hack night", "2026-05-01")]); assert.equal(M.size, 0, "gaps over 45 days");
  M = episodeMap([ev("h1", "Hack night", "2026-01-01"), ev("h2", "Hack night", "2026-01-08"), ev("h3", "Hack night", "2026-01-15", { series: false })]); assert.equal(M.size, 0, "No overrides");
  M = episodeMap([ev("d1", "Dinner", "2026-07-01"), ev("d2", "Dinner", "2026-11-01", { series: true })]); assert.equal(M.get("d2")?.n, 2, "Yes forces it");
  M = episodeMap([ev("c1", "Supper club", "2026-07-01"), ev("c2", "Renamed", "2026-11-01", { seriesId: "c1" })]); assert.equal(M.get("c2")?.n, 2, "a repeat chain always joins");
});

test("2b. the host's Is this a series? is a whitelisted true/false/null field", async () => {
  assert.ok((await put("events/ser1", { ...base, name: "Dinner", date: day(30), series: "yes" })).ok); assert.equal(S().get("events/ser1").data.series, true);
  assert.ok((await patch("events/ser1", { series: "maybe?" })).ok); assert.equal(S().get("events/ser1").data.series, null);
  const js = fs.readFileSync(new URL("../public/slots.js", import.meta.url), "utf8"); assert.match(js, /Is this a series\?/); assert.match(js, /data-ser="\$\{k\}"/);
});

test("3. public numbering counts only published, non-private dates; the host's view counts them all", async () => {
  for (const [id, x] of [["pn1", {}], ["pn2", { private: true, discoverable: false }], ["pn3", {}], ["pn4", { published: false, discoverable: false, name: "Pub quiz at Ada's flat 4B" }], ["pn5", {}]])
    assert.ok((await put("events/" + id, { ...base, name: "Pub quiz", date: day([-21, -14, -7, 1, 7][["pn1", "pn2", "pn3", "pn4", "pn5"].indexOf(id)]), seriesId: id === "pn1" ? undefined : "pn1", ...x })).ok);
  const E = (await get("/api/public/episode/pn5")).j; assert.equal(E.episode, 3); assert.equal(E.of, 3); assert.equal(E.series, "Pub quiz", "a draft never sets the title");
  assert.equal((await get("/api/public/episode/pn2")).j.episode, null, "a private date has no public number");
  const H = await (await fetch(srv.base + "/api/host/series/pn5", { headers: { cookie: host } })).json(); assert.equal(H.episode.n, 5, "the host sees private numbering");
});

test("4. the one-line reply: past and cancelled refused, No Maybe applied, a let-in guest stays in, no mail on a cancelled event", async () => {
  assert.ok((await put("events/cr1", { ...base, name: "Past jam", date: day(3) })).ok); const p = await guest("cr1", "Pa St", "cr1", "no");
  assert.ok((await patch("events/cr1", { date: day(-3) })).ok); let r = await reply("cr1", p, "Ccr1", "in"); assert.equal(r.status, 409); assert.match(r.j.message, /already happened/);
  assert.ok((await put("events/cr2", { ...base, name: "Canc jam", date: day(5) })).ok); const c = await guest("cr2", "Ca Nc", "cr2", "no");
  assert.ok((await patch("events/cr2", { cancelled: true })).ok); r = await reply("cr2", c, "Ccr2", "in"); assert.equal(r.status, 409); assert.match(r.j.message, /cancelled/);
  assert.equal(S().get("rsvps/" + c).data.response, "no"); assert.ok(!S().get("rsvps/" + c).data.confirmMailAt, "no You're in mail");
  assert.ok((await put("events/cr3", { ...base, name: "No maybe jam", date: day(9), noMaybe: true })).ok); const m = await guest("cr3", "No Mo", "cr3");
  r = await reply("cr3", m, "Ccr3", "maybe"); assert.equal(r.status, 400); assert.match(r.j.message, /yes or no/); assert.equal(S().get("rsvps/" + m).data.response, "going");
  assert.ok((await put("events/cr4", { ...base, name: "Ask table", date: day(6), approvalRequired: true })).ok); const a = await guest("cr4", "Ask Al", "cr4");
  assert.equal(S().get("rsvps/" + a).data.response, "requested"); assert.ok((await patch("rsvps/" + a, { response: "going" })).ok);
  assert.equal((await reply("cr4", a, "Ccr4", "no")).j.response, "no"); assert.equal((await reply("cr4", a, "Ccr4", "in")).j.response, "going", "let in once, in again");
});

test("5. channel posts: names only when they look like a first name; no markdown or links anywhere", () => {
  for (const [n, want] of [["Maya Chen", "Maya"], ["[Claim_Nitro](https://evil.example/x)", ""], ["https://evil.example/free", ""], ["@everyone", ""], ["evil.com", ""], ["Anne-Marie", "Anne-Marie"], ["Zoë", "Zoë"]]) assert.equal(chatName(n), want, n);
  const t = chatSafe("Hack night #4 [win](https://evil.example) www.evil.com bit.ly/x **now**", "discord"); assert.ok(!/https?:|www\.|bit\.ly|\*|\[|\]/.test(t), t); assert.match(t, /Hack night #4/);
});

test("6. channels need a listed event; one event's .ics needs a published one; a guest's own place reads like the address endpoint", async () => {
  assert.equal(openEvent({ published: true, discoverable: false }), false, "link-only stays out of channels"); assert.equal(openEvent({ published: true, discoverable: true }), true);
  assert.ok((await put("events/ic1", { ...base, name: "Draft", date: day(9), published: false, discoverable: false })).ok); assert.equal((await get("/e/ic1.ics")).status, 404);
  assert.ok((await put("events/ic2", { ...base, name: "At mine", date: day(9), venueName: "My apartment", venueAddr: "214 Bedford Ave 3R" })).ok); const g = await guest("ic2", "Gina Go", "ic2");
  assert.match((await get(`/e/ic2.ics?rid=${g}&code=Cic2`)).t, /LOCATION:Ada's apartment\\, 214 Bedford Ave 3R/);
});

test("7. slots: on a private event only guests who are in vote; on Ask to join the poll says to wait for the host", async () => {
  assert.ok((await put("events/sl1", { ...base, name: "Priv LAN", date: day(6), private: true, discoverable: false, lineup: { kind: "poll", options: ["Halo", "Quake"] } })).ok);
  const m = await guest("sl1", "May Be", "sl1", "maybe"); const r = await post("/api/public/lineup/sl1/vote", { rid: m, code: "Csl1", option: 1 }); assert.equal(r.status, 409);
  assert.ok((await put("events/sl2", { ...base, name: "Board games", date: day(6), approvalRequired: true, lineup: { kind: "poll", options: ["Root", "Catan"] } })).ok);
  const q = await guest("sl2", "Pat Pend", "sl2"); assert.match((await (await post("/api/public/lineup/sl2/vote", { rid: q, code: "Csl2", option: 0 })).json()).message, /lets you in/);
  globalThis.window ??= globalThis; await import("../public/slots.js");
  const html = globalThis.window.Slots.lineupHTML({ kind: "poll", title: "Pick", options: [{ i: 0, label: "Root", votes: 0 }], votes: 0, canAct: false, past: false }, null, { ask: true, host: "Ada" });
  assert.match(html, /Vote once Ada lets you in\./);
});

test("8. the changelog: no champion or count on a hidden-names event, no 0 came", async () => {
  for (const [id, d, x] of [["ch1", -21, {}], ["ch2", -14, { chatham: true, lineup: { kind: "bracket", size: 4 } }], ["ch3", -7, {}]]) assert.ok((await put("events/" + id, { ...base, name: "Smash night", date: day(d), ...x })).ok);
  S().set("lineup/ch2", { eventId: "ch2", champion: "nobody", entrants: [], winners: {} });
  const s = (await get("/api/public/host/ada-r14/series")).j.series.find((x) => x.root === "ch1"); assert.ok(s);
  const e2 = s.entries.find((e) => e.id === "ch2"); assert.equal(e2.came, null); assert.equal(e2.champion, undefined);
  assert.equal(s.entries.find((e) => e.id === "ch1").came, null, "0 came reads as nothing");
  assert.match(fs.readFileSync(new URL("../public/series.js", import.meta.url), "utf8"), /e\.came > 0/);
});

test("9. Ask me about: a clause with a way to reach someone goes whole; Discord tags and spelled-out emails too", () => {
  assert.equal(scrubAsk("Zig, email me at zed@x.io, retro consoles"), "Zig, retro consoles");
  assert.equal(scrubAsk("rust, find me on disc0rd ann#1234 or t.me/ann or ann at gmail dot com, 555 123 4567"), "rust");
  assert.equal(scrubAsk("Forth, discord ann_42"), "Forth"); assert.equal(scrubAsk("ann#1234, cats"), "cats"); assert.equal(scrubAsk("zed at proton dot me"), "");
  assert.equal(scrubAsk("Discord bots, Rust"), "Discord bots, Rust", "talking about Discord is fine");
});

test("10. /g puts the episode number on its real title node", () => {
  const js = fs.readFileSync(new URL("../public/series.js", import.meta.url), "utf8");
  assert.match(js, /\$\('#view-guest \.invite \[role="heading"\]\[aria-level="1"\]'\)/);
});

test("11. dark looks: slot, quiet and curl cards and More from Ada follow the look's tokens; the rail lets a dark page show", () => {
  const css = fs.readFileSync(new URL("../public/slots.css", import.meta.url), "utf8"), la = fs.readFileSync(new URL("../public/looks-app.js", import.meta.url), "utf8");
  assert.match(css, /body\.lk-on :is\(\.sl-card,\.sl-quietform\)\{--sl-bg:var\(--lk-card/); assert.match(css, /--sl-ink:var\(--lk-card-ink/); assert.match(css, /--sl-line:var\(--lk-line/);
  assert.match(css, /:is\(\.sl-in,#slAsk\)\{background:color-mix\(in srgb,var\(--sl-ink\) 5%,var\(--sl-bg\)\)/, "the demo input matches its card");
  assert.match(la, /\.ev2-chat \.ev2-more\{background:var\(--lk-card\)/); assert.match(la, /lk-dark \.es-rail\{background:transparent/);
});

test("12. quiet controls: the placeholder follows the night, the block sits after name and email, the field has a border", () => {
  const SL = globalThis.window?.Slots; assert.ok(SL);
  assert.equal(SL.askHint({ kind: "dinner" }), "Favorite dish, a recent trip"); assert.equal(SL.askHint({ activity: "board games" }), "Favorite game, what you're learning"); assert.equal(SL.askHint({ name: "Hack night" }), "What you're building");
  const js = fs.readFileSync(new URL("../public/slots.js", import.meta.url), "utf8"); assert.match(js, /em\?\.closest\("\.row"\) \|\| em\?\.closest\("label"\)/); assert.match(js, /f\.querySelector\("#ct"\)\?\.closest\("label"\)/);
  assert.match(fs.readFileSync(new URL("../public/slots.css", import.meta.url), "utf8"), /#slAsk\{[^}]*border:1\.5px solid var\(--sl-field\)/);
});
