// Review round 13, for engineers, gamers and the people who run their nights: episode numbers and the series changelog
// (server/episodes.js, server/series.js), slots on the invite and quiet guests (server/slots.js), Discord/Slack unfurls,
// webhooks and .ics feeds (server/hooksout.js), the one-line reply (POST /api/public/reply/:id) and the plain-text power
// path (public/plain.js).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore } from "../server/workspaces.js";
import { episodeMap, baseTitle } from "../server/episodes.js";
import { lineupOf, scrubAsk, seedOrder, bracketRounds } from "../server/slots.js";
import { webhookOf, icsText, icsFold, calendar, vevent, chatSafe, payloadOf } from "../server/hooksout.js";
await import("../public/plain.js");
const PL = globalThis.PlainText;

let srv, host, ws;
const J = { "Content-Type": "application/json" };
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "r13-secret", ENCORE_SIGNUP_PER_HOUR: "100", ENCORE_FAKE_EMAIL: "1", ENCORE_DIRECTORY_CACHE_MS: "0" };
const post = (path, body, h = {}) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...h }, body: JSON.stringify(body) });
const put = (path, body) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { ...J, cookie: host }, body: JSON.stringify(body) });
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const S = () => scopeStore(srv.store, ws);
const guest = async (eventId, name, key, response = "going", extra = {}) => { const r = await post("/api/db/collection?path=rsvps", { eventId, name, email: key + "@t.example", response, code: "C" + key, showMe: true, createdAt: Date.now(), ...extra }, { "x-encore-guest": "1", "x-encore-key": "k-" + key.padEnd(10, "x") }); assert.equal(r.status, 200, await r.clone().text()); return (await r.json()).id; };
const get = async (path, h = {}) => { const r = await fetch(srv.base + path, { headers: h }); return { status: r.status, j: await r.json().catch(() => null), r }; };
const tick = () => new Promise((r) => setTimeout(r, 30));
const base = { casual: true, tz: "UTC", startTime: "19:00", endTime: "22:00", city: "Brooklyn", hood: "Gowanus", activity: "hack night", headcount: 6, published: true, discoverable: true };

before(async () => {
  Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer();
  const r = await post("/api/signup", { name: "Ada Byte", email: "ada.r13@example.com", password: "long-password-1", mode: "friends" }); host = r.headers.get("set-cookie").split(";")[0];
  assert.ok((await post("/api/host/profile", { handle: "ada-hacks", name: "Ada's Hack Night", tagline: "Build, demo, go home.", city: "Brooklyn", hood: "Gowanus", emoji: "💻" }, { cookie: host })).ok);
  ws = srv.store.get("system/handle-ada-hacks").data.ws;
  assert.ok((await put("events/hn1", { ...base, name: "Hack night", date: day(-21), changelog: { demos: ["A tiny Forth", "LED matrix"], games: [] } })).ok);
  assert.ok((await put("events/hn2", { ...base, name: "Hack Night #2", date: day(-14), lineup: { kind: "poll", options: ["Factorio", "Tetris"] } })).ok);
  assert.ok((await put("events/hn3", { ...base, name: "Hack night", date: day(-7), private: true, discoverable: false })).ok);
  assert.ok((await put("events/hn4", { ...base, name: "Hack night", date: day(3), lineup: { kind: "demos", slots: 2, minutes: 5 }, firstTimerNote: "First time? Sit at the window table, Jo will say hi." })).ok);
  assert.ok((await put("events/solo1", { ...base, name: "Pottery basics", date: day(4) })).ok);
  assert.ok((await put("events/priv", { ...base, name: "Friends LAN", date: day(5), private: true, discoverable: false, lineup: { kind: "bracket", size: 4 } })).ok);
  assert.ok((await put("events/brk", { ...base, name: "Smash bracket", date: day(6), headcount: 20, lineup: { kind: "bracket", size: 4 } })).ok);
});
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

test("pure: series join by repeat chain or by the same name, numbered from the first; markers come off the title", () => {
  assert.equal(baseTitle("Hack Night #13"), "Hack Night"); assert.equal(baseTitle("hack night ep. 14"), "hack night"); assert.equal(baseTitle("Root night"), "Root night");
  const M = episodeMap([{ id: "a1", data: { name: "Hack night", date: "2026-01-01" } }, { id: "a2", data: { name: "Hack Night #2", date: "2026-01-08" } }, { id: "b1", data: { name: "Renamed", date: "2026-01-15", seriesId: "a1" } },
    { id: "c1", data: { name: "One off", date: "2026-01-02" } }, { id: "d1", data: { name: "Weekly", date: "2026-01-03", repeat: "weekly", episodeBase: 9 } }, { id: "x", data: { name: "Hack night", date: "2026-01-04", example: true } }]);
  assert.deepEqual(["a1", "a2", "b1"].map((k) => M.get(k).n), [1, 2, 3]); assert.equal(M.get("a1").total, 3); assert.equal(M.has("c1"), false, "a one-off isn't a series"); assert.equal(M.get("d1").n, 10, "the host's own count before"); assert.equal(M.has("x"), false);
});

test("episodes: on the invite, on cards and in the directory; the changelog leaves private episodes out", async () => {
  const E = await get("/api/public/episode/hn4"); assert.equal(E.j.episode, 4); assert.equal(E.j.label, "Hack night #4"); assert.match(E.j.changelog, /^\/@ada-hacks#series-hn1$/);
  assert.equal((await get("/api/public/episode/solo1")).j.episode, null);
  const N = await get("/api/public/episodes?ids=hn4,hn3,solo1"); assert.deepEqual(N.j.episodes, { hn4: 4 }, "private and one-off events give nothing");
  const D = await get("/api/v1/events?q=hack"); const rec = (D.j.data || []).find((e) => e.id === "hn4"); assert.ok(rec, JSON.stringify(D.j).slice(0, 300)); assert.equal(rec.episode, 4);
  for (const [n, k] of [["Lin Ko", "lin1"], ["Sam Ortiz", "sam1"]]) assert.equal((await post("/api/db/collection?path=rsvps", { eventId: "hn1", name: n, email: k + "@t.example", response: "going", code: "H" + k }, { cookie: host })).status, 200);
  S().add("moments", { eventId: "hn1", url: "/_blob/AAAAAAAAAAAAAAAAAAAA", type: "photo", at: 1 }); S().add("moments", { eventId: "hn1", url: "javascript:alert(1)", type: "photo", at: 2 });
  const C = await get("/api/public/host/ada-hacks/series"); const s = C.j.series.find((x) => x.root === "hn1"); assert.ok(s, JSON.stringify(C.j));
  assert.deepEqual(s.entries.map((x) => x.n), [2, 1], "past episodes on the page, newest first; the private #3 is left out");
  const e1 = s.entries.find((x) => x.n === 1); assert.equal(e1.came, 2); assert.deepEqual(e1.demos, ["A tiny Forth", "LED matrix"]); assert.deepEqual(e1.photos, ["/_blob/AAAAAAAAAAAAAAAAAAAA"], "only stored photos");
  assert.equal(s.next.n, 4); assert.equal(s.forks, 0); assert.ok(!JSON.stringify(C.j).includes("Lin"), "no names in the changelog");
  const notes = await post("/api/host/series/hn2/notes", { demos: "Rust TUI, <b>x</b>", games: ["Factorio"], note: "Power cut at 9" }, { cookie: host }); assert.equal(notes.status, 200);
  assert.deepEqual((await notes.json()).notes, { demos: ["Rust TUI", "x"], games: ["Factorio"], note: "Power cut at 9" });
  assert.equal((await post("/api/host/series/hn2/notes", { demos: "x" })).status, 403, "the host only");
  // forks: a second host shares a draft forked from an episode
  const r2 = await post("/api/signup", { name: "Bo Fork", email: "bo.r13@example.com", password: "long-password-1", mode: "friends" }), bo = r2.headers.get("set-cookie").split(";")[0];
  assert.ok((await fetch(srv.base + "/api/db/doc?path=events/boHack", { method: "PUT", headers: { ...J, cookie: bo }, body: JSON.stringify({ ...base, name: "Hack night Oakland", date: day(10) }) })).ok);
  assert.equal((await post("/api/me/like/hn2/started", { draftId: "boHack" }, { cookie: bo })).status, 200);
  assert.equal((await get("/api/public/host/ada-hacks/series")).j.series.find((x) => x.root === "hn1").forks, 1);
});

test("slots: a demo queue guests claim with their reply proof; the host reorders and removes", async () => {
  const a = await guest("hn4", "Maya Chen", "maya4"), b = await guest("hn4", "Kit Ray", "kit4"), c = await guest("hn4", "Lee Park", "lee4"), m = await guest("hn4", "Mo Maybe", "mo4", "maybe");
  assert.equal((await post("/api/public/lineup/hn4/claim", { rid: a, code: "Cnope", title: "x" })).status, 403, "the code has to match");
  assert.equal((await post("/api/public/lineup/hn4/claim", { rid: m, code: "Cmo4", title: "x" })).status, 409, "Maybe can't take a slot");
  let r = await post("/api/public/lineup/hn4/claim", { rid: a, code: "Cmaya4", title: "<img src=x onerror=alert(1)>A Forth in 200 lines" }); assert.equal(r.status, 200);
  let L = (await r.json()).lineup; assert.equal(L.queue[0].title, "A Forth in 200 lines"); assert.equal(L.queue[0].who, "Maya"); assert.equal(L.queue[0].mine, true); assert.equal(L.open, 1);
  assert.equal((await post("/api/public/lineup/hn4/claim", { rid: b, code: "Ckit4", title: "WASM synth" })).status, 200);
  assert.equal((await post("/api/public/lineup/hn4/claim", { rid: c, code: "Clee4", title: "Too late" })).status, 409, "two slots, both taken");
  const pub = (await get("/api/public/lineup/hn4")).j.lineup; assert.equal(pub.queue.length, 2); assert.ok(!JSON.stringify(pub).includes("rid"), "no reply ids for strangers"); assert.ok(!JSON.stringify(pub).includes("@"), "no emails");
  r = await post("/api/host/lineup/hn4", { action: "reorder", order: [b, a] }, { cookie: host }); assert.deepEqual((await r.json()).lineup.queue.map((x) => x.title), ["WASM synth", "A Forth in 200 lines"]);
  r = await post("/api/host/lineup/hn4", { action: "remove", rid: b }, { cookie: host }); assert.equal((await r.json()).lineup.open, 1);
  assert.equal((await post("/api/public/lineup/hn4/claim", { rid: c, code: "Clee4", title: "Now there's room" })).status, 200);
  assert.equal((await post("/api/host/lineup/hn4", { action: "remove", rid: a })).status, 403, "the host only");
});

test("slots: a game poll, one vote per reply; a bracket seeded from guests who opted in; private events stay private", async () => {
  // poll on a past event is closed; make one upcoming
  assert.ok((await put("events/poll1", { ...base, name: "Game night", date: day(2), lineup: { kind: "poll", options: ["Root", "Catan", "Root", ""] } })).ok);
  assert.deepEqual(lineupOf({ lineup: { kind: "poll", options: ["Root", "Catan", "Root", ""] } }).options, ["Root", "Catan"]);
  const a = await guest("poll1", "Ann", "ann1"), b = await guest("poll1", "Ben", "ben1", "maybe");
  await post("/api/public/lineup/poll1/vote", { rid: a, code: "Cann1", option: 0 }); await post("/api/public/lineup/poll1/vote", { rid: a, code: "Cann1", option: 1 });
  const r = await post("/api/public/lineup/poll1/vote", { rid: b, code: "Cben1", option: 1 }); const L = (await r.json()).lineup;
  assert.deepEqual(L.options.map((o) => o.votes), [0, 2], "a changed vote counts once"); assert.equal(L.myVote, 1);
  assert.equal((await post("/api/public/lineup/poll1/vote", { rid: a, code: "Cann1", option: 7 })).status, 409);
  // bracket
  const ids = []; for (const n of ["Pat", "Quin", "Rae"]) ids.push(await guest("brk", n + " X", "b" + n));
  for (const [i, id] of ids.entries()) assert.equal((await post("/api/public/lineup/brk/optin", { rid: id, code: "Cb" + ["Pat", "Quin", "Rae"][i] })).status, 200);
  let H = await (await post("/api/host/lineup/brk", { action: "seed" }, { cookie: host })).json(); assert.equal(H.lineup.rounds[0].length, 2); assert.ok(H.lineup.rounds[0][0].bye, "the top seed gets the bye");
  const m1 = H.lineup.rounds[0][1]; H = await (await post("/api/host/lineup/brk", { action: "winner", round: 0, match: 1, rid: m1.rb }, { cookie: host })).json();
  const f = H.lineup.rounds[1][0]; H = await (await post("/api/host/lineup/brk", { action: "winner", round: 1, match: 0, rid: f.ra }, { cookie: host })).json(); assert.equal(H.lineup.champion, "Pat X");
  assert.equal((await get("/api/public/lineup/brk")).j.lineup.champion, "Pat", "first names for guests");
  assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]); assert.equal(bracketRounds(["a", null, "b", "c"], { "0-1": "c" })[1][0].a, "a");
  // a private event: nothing for strangers, the block for guests who are in
  assert.deepEqual((await get("/api/public/lineup/priv")).j.lineup, { kind: "bracket", title: "Bracket", locked: true });
  const p = await guest("priv", "Vee Insider", "vee1"); assert.equal((await get(`/api/public/lineup/priv?rid=${p}&code=Cvee1`)).j.lineup.locked, undefined);
});

test("quiet guests: coming solo is a count, Ask me about is scrubbed and only for guests who are in, the first-timer note only for solo guests", async () => {
  assert.equal(scrubAsk("Rust, mail me a@b.co or +1 (555) 123-4567, see https://x.io @handle"), "Rust, mail me or , see");
  const a = await guest("solo1", "Una Solo", "una1"), b = await guest("solo1", "Vic Solo", "vic1"), c = await guest("solo1", "Wes Pair", "wes1");
  for (const [rid, code] of [[a, "Cuna1"], [b, "Cvic1"]]) assert.equal((await post("/api/public/quiet/solo1", { rid, code, solo: true, askMe: "keyboards, call 555 123 4567" })).status, 200);
  assert.equal((await get("/api/public/quiet/solo1")).j.solo, 2, "a stranger sees a count");
  const me = (await get(`/api/public/quiet/solo1?rid=${a}&code=Cuna1`)).j; assert.equal(me.solo, 1, "others"); assert.equal(me.me.askMe, "keyboards, call");
  assert.deepEqual(me.askMe.map((x) => x.name).sort(), ["Una", "Vic"]); assert.ok(!JSON.stringify(me).includes("Solo"), "first names only"); assert.equal(me.firstTimer, "");
  assert.equal((await get("/api/public/quiet/solo1")).j.askMe.length, 0, "strangers don't see the lines");
  await post("/api/public/quiet/hn4", { rid: (await guest("hn4", "Zed First", "zed4")), code: "Czed4", solo: true });
  const z = S().list("rsvps").find((d) => d.data.name === "Zed First"); assert.match((await get(`/api/public/quiet/hn4?rid=${z.id}&code=Czed4`)).j.firstTimer, /window table/);
  assert.equal((await get(`/api/public/quiet/solo1?rid=${c}&code=Cwes1`)).j.firstTimer, "");
  // a later guest PUT keeps the server's fields
  assert.equal(S().get("rsvps/" + a).data.solo, true);
});

test("webhooks: only Discord and Slack webhook URLs, posts once with first names, nothing about private events", async () => {
  for (const bad of ["http://discord.com/api/webhooks/12345/abcdefghijklmnopqrstuvwxyz", "https://discord.com.evil.io/api/webhooks/12345/abcdefghijklmnopqrstuvwxyz", "https://user:pw@discord.com/api/webhooks/12345/abcdefghijklmnopqrstuvwxyz",
    "https://discord.com:8443/api/webhooks/12345/abcdefghijklmnopqrstuvwxyz", "https://discord.com/api/webhooks/12345/abcdefghijklmnopqrstuvwxyz?wait=1", "https://169.254.169.254/latest", "https://hooks.slack.com/../services/T0/B0/x", "https://discord.com/api/users/@me", "javascript:alert(1)"]) assert.equal(webhookOf(bad), null, bad);
  assert.deepEqual(webhookOf("https://DISCORD.com/api/webhooks/123456/abcdefghijklmnopqrstuvwxyz"), { kind: "discord", url: "https://discord.com/api/webhooks/123456/abcdefghijklmnopqrstuvwxyz" });
  assert.equal(webhookOf("https://hooks.slack.com/services/T0001ABCD/B0001ABCD/abcdefghijklmnop1234").kind, "slack");
  assert.equal(chatSafe("@everyone <b>hi</b> **x**", "slack"), "everyone hi x"); assert.deepEqual(payloadOf("discord", "x", "").allowed_mentions, { parse: [] });
  assert.equal((await fetch(srv.base + "/api/host/webhook", { method: "PUT", headers: { ...J, cookie: host }, body: JSON.stringify({ url: "https://example.com/hook" }) })).status, 400);
  const r = await fetch(srv.base + "/api/host/webhook", { method: "PUT", headers: { ...J, cookie: host }, body: JSON.stringify({ url: "https://discord.com/api/webhooks/123456/abcdefghijklmnopqrstuvwxyz" }) }); assert.equal(r.status, 200);
  const W = await r.json(); assert.ok(!W.url.includes("abcdefghij"), "the token isn't sent back"); const sent = srv.app.locals.hooksout.sent; sent.length = 0;
  assert.ok((await put("events/hk1", { ...base, name: "Demo night", date: day(8), headcount: 4 })).ok);
  await guest("hk1", "Maya Lopez", "mayah"); await tick(); await guest("hk1", "Ivy Hidden", "ivyh", "going", { showMe: false }); await tick();
  const texts = () => sent.map((x) => x.body.content.split("\n")[0]);
  assert.ok(texts().includes("Maya is in for Demo night."), JSON.stringify(texts())); assert.ok(texts().includes("One more is in for Demo night."), "a guest who hid themselves isn't named");
  assert.ok(texts().includes("2 spots left for Demo night."), JSON.stringify(texts())); assert.ok(!JSON.stringify(sent).includes("Lopez") && !JSON.stringify(sent).includes("@t.example"), "first names only");
  const n = sent.length; await post("/api/public/reply/hk1", {}); await tick(); assert.equal(sent.length, n);
  await guest("priv", "Pia Private", "piap"); await tick(); assert.ok(!texts().some((t) => /Friends LAN|Pia/.test(t)), "private events stay out of channels");
  // day before
  assert.ok((await put("events/hk2", { ...base, name: "Hack night", date: day(1) })).ok);
  const k = await srv.app.locals.hooksout.runReminders({ now: Date.parse(day(0) + "T15:00:00Z"), workspaces: [ws] }); assert.equal(k, 1);
  assert.match(texts().at(-1), /^Tomorrow: Hack night #\d+, 7pm, Gowanus, Brooklyn\. 0 in, 6 spots left\.$/);
  assert.equal(await srv.app.locals.hooksout.runReminders({ now: Date.parse(day(0) + "T16:00:00Z"), workspaces: [ws] }), 0, "once");
});

test("calendars: per host (open events only) and per event, escaped and folded per RFC 5545; the address only for a guest who's in", async () => {
  assert.equal(icsText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
  const long = "DESCRIPTION:" + "é".repeat(80), f = icsFold(long); assert.ok(f.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)); assert.equal(f.split("\r\n").map((l, i) => (i ? l.slice(1) : l)).join(""), long);
  const one = calendar("x", [vevent({ id: "e1", ev: { date: "2026-12-03", startTime: "19:00", endTime: "01:00", tz: "America/New_York", concept: "Bring a laptop; or don't, ok" }, title: "Hack, night", url: "https://p.example/e/e1", now: 0 })]);
  assert.match(one, /DTSTART:20261204T000000Z\r\nDTEND:20261204T060000Z/); assert.match(one, /SUMMARY:Hack\\, night/); assert.ok(one.endsWith("END:VCALENDAR\r\n")); assert.ok(!/[^\r]\n/.test(one), "CRLF only");
  const H = await fetch(srv.base + "/@ada-hacks.ics"); assert.equal(H.status, 200); assert.match(H.headers.get("content-type"), /text\/calendar/); const ht = await H.text();
  assert.match(ht, /SUMMARY:Hack night #4/); assert.ok(!ht.includes("Friends LAN") && !ht.includes("UID:hn3@"), "no private events"); assert.match(ht, /LOCATION:Gowanus\\, Brooklyn/);
  assert.ok((await put("events/addr", { ...base, name: "Secret spot", date: day(9), venueName: "Unit 4", venueAddr: "12 Hidden St" })).ok);
  assert.ok(!(await (await fetch(srv.base + "/e/addr.ics")).text()).includes("Hidden St"), "the address isn't public");
  const g = await guest("addr", "Tia In", "tia1"); assert.ok((await (await fetch(srv.base + `/e/addr.ics?rid=${g}&code=Ctia1`)).text()).includes("12 Hidden St"), "a guest who's in gets it");
  assert.equal((await fetch(srv.base + "/@nobody-here.ics")).status, 404);
});

test("unfurls and oEmbed: episode in the title, spots left, Slack labels; private events say no more than the title", async () => {
  const h = await (await fetch(srv.base + "/e/hn4")).text(), n = (await get("/api/public/episode/hn4")).j.episode;
  assert.ok(h.includes(`<meta property="og:title" content="Hack night #${n}">`), "the episode in the title"); assert.match(h, /spots? left/); assert.match(h, /twitter:label1" content="When"/); assert.match(h, /application\/json\+oembed/);
  const o = await get("/oembed?url=" + encodeURIComponent(srv.base + "/e/hn4")); assert.equal(o.j.type, "link"); assert.equal(o.j.title, `Hack night #${n}`); assert.equal(o.j.author_name, "Ada's Hack Night");
  const p = await get("/oembed?url=" + encodeURIComponent(srv.base + "/e/priv")); assert.equal(p.j.author_name, undefined); assert.equal(p.j.description, undefined);
  assert.ok(!(await (await fetch(srv.base + "/e/priv")).text()).includes("twitter:label2"), "no spots on a private event");
  assert.equal((await get("/oembed?url=" + encodeURIComponent("https://x.example/nope"))).status, 404);
});

test("one-line reply: rid and code change only that reply, through the usual write; nothing about anyone else comes back", async () => {
  const a = await guest("hn4", "Curl User", "curl1", "maybe");
  assert.equal((await post("/api/public/reply/hn4", { rid: a, code: "Cwrong", response: "in" })).status, 404);
  assert.equal((await post("/api/public/reply/hn4", { rid: a, code: "Ccurl1", response: "dance" })).status, 400);
  let r = await post("/api/public/reply/hn4", { rid: a, code: "Ccurl1", response: "in" }); const j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j)); assert.equal(j.response, "going");
  assert.deepEqual(Object.keys(j).sort(), ["ok", "response"]); assert.equal(S().get("rsvps/" + a).data.response, "going");
  r = await post("/api/public/reply/hn4", { rid: a, code: "Ccurl1", response: "no" }); assert.equal((await r.json()).response, "no");
});

test("plain text: ICS, Discord and Markdown make a draft; an invite copies as Markdown", () => {
  const ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Hack night\\, Gowanus\r\nDTSTART;TZID=America/New_York:20261203T190000\r\nDTEND;TZID=America/New_York:20261203T220000\r\nLOCATION:Unit 4\\, 12 Bond St\r\nDESCRIPTION:Bring a lapt\r\n op.\\nPizza.\r\nRRULE:FREQ=WEEKLY;BYDAY=TH\r\nEND:VEVENT\r\nEND:VCALENDAR";
  const d = PL.parseIcs(ics); assert.deepEqual({ ...d }, { title: "Hack night, Gowanus", date: "2026-12-03", startTime: "19:00", endTime: "22:00", place: "Unit 4, 12 Bond St", description: "Bring a laptop.\nPizza.", repeat: "weekly", tz: "America/New_York" });
  assert.equal(PL.parseIcs("BEGIN:VEVENT\nDTSTART:20261203T230000Z\nRRULE:FREQ=MONTHLY\nSUMMARY:x\nEND:VEVENT").repeat, "monthly");
  const m = PL.parseText("## LAN party\n**When:** <t:1796320800:F>\n**Where:** Gowanus, Brooklyn\n> bring your own rig <@123456> :joystick:");
  assert.equal(m.title, "LAN party"); const t0 = new Date(1796320800e3); assert.equal(m.date, `${t0.getFullYear()}-${String(t0.getMonth() + 1).padStart(2, "0")}-${String(t0.getDate()).padStart(2, "0")}`); assert.match(m.startTime, /^\d{2}:\d{2}$/); assert.equal(m.place, "Gowanus, Brooklyn"); assert.ok(!/<@|:joystick:/.test(m.text));
  const md = PL.toMarkdown({ title: "Hack night #4", date: "2026-12-03", startTime: "19:00", endTime: "22:00", area: "Gowanus", host: "Ada", url: "https://p.example/e/hn4", concept: "Build *stuff*", spots: "3 spots left" });
  assert.match(md, /^# Hack night #4\n/); assert.match(md, /\*\*When:\*\* Thu, Dec 3, 7pm to 10pm/); assert.match(md, /Build \\\*stuff\\\*/); assert.match(md, /\[RSVP\]\(https:\/\/p\.example\/e\/hn4\)/);
  assert.equal(PL.curlLine("https://p.example", "hn4", "r1", "C'1", "in"), `curl -sX POST https://p.example/api/public/reply/hn4 -H 'Content-Type: application/json' -d '{"rid":"r1","code":"C'\\''1","response":"in"}'`);
});

test("the light invite stays small and loads slots with one tag; the app's loader stays last", () => {
  const inv = fs.readFileSync(new URL("../public/invite.html", import.meta.url), "utf8"); assert.ok(inv.length < 40000, String(inv.length)); assert.equal((inv.match(/\/slots\.js/g) || []).length, 1);
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8"), scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  assert.match(scripts.at(-1)[1], /Come with me/); assert.ok(html.includes("/slots.js"));
});
