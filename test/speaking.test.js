// Speaking engagements in the scrapbook: talks, keynotes, webinars, podcasts, fireside chats, panels and workshops a host
// taught. Their lines are cleaned like the others (https links only, addresses scrubbed), the public page and the
// directory carry them, links to a video or an episode become talk drafts, and Potto sorts them into "Speaking".
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { mediaOf, importable, parseMedia, httpsLink, isTalk, suggestSections, useFetcher, ROLES, FORMATS } from "../server/scrapbook.js";
import { showcasePast } from "../server/community.js";

test("Talk formats and speaking roles are offered", () => {
  for (const f of ["talk", "keynote", "webinar", "podcast", "fireside", "panel", "workshop"]) assert.ok(FORMATS.includes(f), f);
  for (const r of ["Speaker", "Keynote speaker", "Panelist", "Moderator", "Guest", "Host"]) assert.ok(ROLES.includes(r), r);
  assert.ok(isTalk({ format: "Keynote" })); assert.ok(isTalk({ format: "workshop", role: "Speaker" }), "a workshop they taught");
  assert.ok(!isTalk({ format: "workshop", role: "Hosted" })); assert.ok(!isTalk({ format: "dinner" }));
});

test("Recording and slides links: https only, public hosts, nothing else", () => {
  assert.equal(httpsLink("https://www.youtube.com/watch?v=abc123"), "https://www.youtube.com/watch?v=abc123");
  for (const bad of ["http://www.youtube.com/watch?v=abc", "javascript:alert(1)", "https://localhost/x", "https://10.0.0.1/slides", "https://user:pw@example.com/x", "youtube.com/watch?v=1", ""]) assert.equal(httpsLink(bad), "", bad);
});

test("Video and podcast links are known, over https only", () => {
  assert.deepEqual(mediaOf("https://www.youtube.com/watch?v=abc"), { format: "webinar", site: "YouTube" });
  assert.deepEqual(mediaOf("https://youtu.be/abc"), { format: "webinar", site: "YouTube" });
  assert.deepEqual(mediaOf("https://vimeo.com/12345"), { format: "webinar", site: "Vimeo" });
  assert.deepEqual(mediaOf("https://open.spotify.com/episode/xyz"), { format: "podcast", site: "Spotify" });
  assert.deepEqual(mediaOf("https://podcasts.apple.com/us/podcast/ep/id1?i=2"), { format: "podcast", site: "Apple Podcasts" });
  assert.deepEqual(mediaOf("https://us02web.zoom.us/rec/share/abc"), { format: "webinar", site: "Zoom" });
  assert.equal(mediaOf("https://open.spotify.com/track/xyz"), null, "a song isn't a talk");
  assert.equal(mediaOf("http://www.youtube.com/watch?v=abc"), null); assert.equal(mediaOf("https://youtube.com.evil.io/x"), null);
  assert.ok(importable("https://www.youtube.com/watch?v=abc")); assert.equal(importable("http://vimeo.com/1"), null);
  const m = parseMedia(`<title>Hosting for strangers - YouTube</title><meta property="og:title" content="Hosting for strangers &amp; friends"><meta itemprop="uploadDate" content="2025-05-02T07:00:00-07:00"><meta property="og:description" content="A talk at Hosts Summit">`, "https://www.youtube.com/watch?v=abc");
  assert.equal(m.title, "Hosting for strangers & friends"); assert.equal(m.date, "2025-05-02"); assert.match(m.about, /Hosts Summit/);
  assert.equal(parseMedia(`<meta property="og:title" content="Episode 12">`).date, "", "no date on the page, no date");
});

test("Showcase pages clean a talk's lines the same way", () => {
  const [x] = showcasePast([{ title: "Keynote", date: "2025-03-01", format: "keynote", topic: "Dinners at 12 Main St, apt 4", organizer: "Hosts Summit", audience: 999999, recording: "http://youtube.com/watch?v=1", slides: "https://example.com/deck" }]);
  assert.equal(x.organizer, "Hosts Summit"); assert.equal(x.audience, 100000); assert.equal(x.recording, ""); assert.equal(x.slides, "https://example.com/deck");
  assert.ok(!/Main St|apt 4/.test(x.topic), "no address in the topic");
});

test("Sort my events puts talks in a Speaking section", () => {
  const L = [{ id: "t1", title: "Hosting for strangers", date: "2025-05-02", format: "talk" }, { id: "t2", title: "The supper club podcast", date: "2025-02-01" },
    { id: "t3", title: "Pasta workshop", date: "2025-01-10", format: "workshop", role: "Speaker" }, { id: "d1", title: "Supper club", date: "2025-01-01" }];
  const { sections } = suggestSections(L, []), sp = sections.find((s) => s.name === "Speaking");
  assert.ok(sp); assert.deepEqual(sp.items.sort(), ["t1", "t2", "t3"]); assert.ok(!sp.items.includes("d1"));
});

let srv, cookie;
const J = { "Content-Type": "application/json" };
const post = (path, body, c = cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(c ? { cookie: c } : {}) }, body: JSON.stringify(body) });
const get = async (path) => { const r = await fetch(srv.base + path); assert.equal(r.status, 200, path); return r.json(); };
before(async () => {
  process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "talk-secret"; process.env.ENCORE_DIRECTORY_CACHE_MS = "0";
  srv = await startServer();
  const r = await post("/api/signup", { name: "Lena Ruiz", email: "lena.talk@example.com", password: "long-password-1", mode: "friends" }, "");
  cookie = r.headers.get("set-cookie").split(";")[0];
  assert.ok((await post("/api/host/profile", { handle: "lena-talks", name: "Lena's Table", tagline: "Supper clubs and talks about them.", city: "Brooklyn", hood: "Greenpoint", emoji: "🍝" })).ok);
});
after(async () => { useFetcher(null); for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_DIRECTORY_CACHE_MS"]) delete process.env[k]; await srv.close(); });

test("A talk by hand: fields cleaned, shown on the public page, and in the directory as speaking", async () => {
  const add = await (await post("/api/host/scrapbook/import", { item: { title: "Hosting for strangers", date: "2025-05-02", format: "Keynote", role: "Keynote speaker", topic: "Why small dinners beat big parties", organizer: "Hosts Summit 2025", audience: "350", recording: "http://www.youtube.com/watch?v=abc", slides: "https://speakerdeck.com/lena/hosting" } })).json();
  assert.equal(add.added.length, 1); const t = add.added[0];
  assert.equal(t.recording, "", "a non-https recording is dropped"); assert.equal(t.slides, "https://speakerdeck.com/lena/hosting"); assert.equal(t.audience, 350); assert.equal(t.format, "keynote");
  // fix the recording, and an over-long topic is refused
  assert.equal((await fetch(srv.base + "/api/host/scrapbook/" + t.id, { method: "PATCH", headers: { ...J, cookie }, body: JSON.stringify({ topic: "x".repeat(141) }) })).status, 400);
  const ed = await (await fetch(srv.base + "/api/host/scrapbook/" + t.id, { method: "PATCH", headers: { ...J, cookie }, body: JSON.stringify({ recording: "https://www.youtube.com/watch?v=abc" }) })).json();
  assert.equal(ed.item.recording, "https://www.youtube.com/watch?v=abc");
  await post("/api/host/scrapbook/import", { item: { title: "Episode 12: the dinner party", date: "2025-02-01", format: "podcast", role: "Guest", organizer: "Table Talk", recording: "https://open.spotify.com/episode/xyz" } });
  await post("/api/host/scrapbook/import", { item: { title: "Pierogi night", date: "2025-01-10", format: "dinner", guests: 12 } });

  const pub = await get("/api/public/host/lena-talks/scrapbook"), k = pub.items.find((x) => x.title === "Hosting for strangers");
  assert.deepEqual({ topic: k.topic, organizer: k.organizer, audience: k.audience, recording: k.recording, slides: k.slides, role: k.role, format: k.format },
    { topic: "Why small dinners beat big parties", organizer: "Hosts Summit 2025", audience: 350, recording: "https://www.youtube.com/watch?v=abc", slides: "https://speakerdeck.com/lena/hosting", role: "Keynote speaker", format: "keynote" });
  assert.equal(pub.items.find((x) => x.title === "Pierogi night").topic, "", "every item has the fields, empty when not set");

  const sp = await get("/api/v1/events?status=past&type=speaking&host=lena-talks");
  assert.deepEqual(sp.data.map((e) => e.title).sort(), ["Episode 12: the dinner party", "Hosting for strangers"]);
  const e = sp.data.find((x) => x.title === "Hosting for strangers");
  assert.equal(e.format, "keynote"); assert.deepEqual(e.speaking, { role: "Keynote speaker", topic: "Why small dinners beat big parties", organizer: "Hosts Summit 2025", audience: 350, recording: "https://www.youtube.com/watch?v=abc", slides: "https://speakerdeck.com/lena/hosting" });
  assert.equal(e.reviews.count, 0, "talks have no reviews yet; none are made up"); assert.deepEqual(e.reviews.items, []);
  assert.equal(sp.data.find((x) => x.format === "podcast").speaking.audience, null, "no audience typed, none shown");
  assert.deepEqual((await get("/api/v1/events?status=past&format=talk&host=lena-talks")).data.map((x) => x.id).sort(), sp.data.map((x) => x.id).sort(), "format=talk matches every speaking format");
  const din = (await get("/api/v1/events?status=past&host=lena-talks")).data.find((x) => x.title === "Pierogi night"); assert.equal(din.speaking, null);
  assert.equal((await get("/api/v1/events?status=past&q=small+dinners")).data[0].title, "Hosting for strangers", "the topic is searchable (both words match it, so it comes first)");
  const F = await get("/api/v1/formats"); assert.ok(F.types.speaking >= 2); assert.ok(F.formats.find((f) => f.format === "keynote")); assert.ok(F.formats.find((f) => f.format === "podcast"));
  // the public MCP server
  const rpc = await (await post("/mcp/public", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_events", arguments: { format: "talk", status: "past" } } }, "")).json();
  const out = JSON.parse(rpc.result.content[0].text); assert.equal(out.total, 2); assert.ok(out.data.every((x) => x.speaking));
  const tools = (await (await post("/mcp/public", { jsonrpc: "2.0", id: 2, method: "tools/list" }, "")).json()).result.tools;
  assert.match(tools.find((x) => x.name === "search_events").description, /speaking/i);
  const spec = await get("/api/v1/openapi.json"); assert.ok(spec.components.schemas.Speaking); assert.ok(spec.paths["/api/v1/events"].get.parameters.some((p) => p.name === "type"));
  const llms = await (await fetch(srv.base + "/llms.txt")).text(); assert.match(llms, /type=speaking/); assert.ok(!/—/.test(llms));
});

test("Dropping a video or podcast link makes a talk draft, even when the page can't be read", async () => {
  const pages = { "https://www.youtube.com/watch?v=talk1": `<title>x - YouTube</title><meta property="og:title" content="Supper clubs 101"><meta itemprop="datePublished" content="2024-11-08">` };
  useFetcher(async (url, o) => (o?.kind === "html" && pages[url] ? { buf: Buffer.from(pages[url]), type: "text/html", finalUrl: url } : null));
  const r = await (await post("/api/host/scrapbook/preview", { text: "My talk https://www.youtube.com/watch?v=talk1 and the episode https://open.spotify.com/episode/ep9 and http://localhost/x" })).json();
  const [v, p] = r.drafts;
  assert.equal(r.drafts.length, 2);
  assert.deepEqual({ title: v.title, date: v.date, format: v.format, recording: v.recording, link: v.link }, { title: "Supper clubs 101", date: "2024-11-08", format: "webinar", recording: "https://www.youtube.com/watch?v=talk1", link: "" });
  assert.deepEqual({ title: p.title, format: p.format, recording: p.recording, unread: p.unread }, { title: "", format: "podcast", recording: "https://open.spotify.com/episode/ep9", unread: true }, "the link is kept as the recording");
  const add = await (await post("/api/host/scrapbook/add", { drafts: [v, { ...p, title: "Table Talk, episode 9" }] })).json();
  assert.equal(add.added.length, 2); assert.equal(add.added[1].recording, "https://open.spotify.com/episode/ep9"); assert.equal(add.added[1].format, "podcast");
  const again = await (await post("/api/host/scrapbook/preview", { text: "https://www.youtube.com/watch?v=talk1" })).json();
  assert.equal(again.drafts.length, 0); assert.equal(again.skipped[0].why, "Already in your scrapbook.");
});
