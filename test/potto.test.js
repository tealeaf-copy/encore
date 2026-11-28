// Ask Potto (server/potto.js, server/pottorules.js): a context built for the person asking and nobody else, fake-AI
// replies through the model path, one-tap actions only on the host's own events, links only to real pages, support
// questions handed to the help guide, limits per hour and per day, a plain mode without a key, and history you can delete.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { pottoReply, daysOf, isSupport, pickEvent } from "../server/pottorules.js";
import { buildAction, allowedLinks, ACTION_URL, estimateTokens, suggestFor, missingOf } from "../server/potto.js";
import { fakeText } from "../server/ai.js";

let srv;
const J = { "content-type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body || {}) });
const getJ = async (path, cookie) => (await fetch(srv.base + path, { headers: cookie ? { cookie } : {} })).json();
const put = (path, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
let n = 0;
const person = async (name) => { const email = `${name.toLowerCase().replace(/\W+/g, "")}${++n}@example.com`; const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); const b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); return { cookie: cookieOf(r), ws: b.workspace.id, email, name }; };
const host = async (name, handle) => { const h = await person(name); const r = await post("/api/host/profile", { handle, name, city: "New York", bio: "Dinners at home.", emoji: "🍵" }, h.cookie); assert.equal(r.status, 200, await r.text()); return { ...h, handle }; };
const guestRsvp = (ws, body, cookie) => fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, "x-encore-guest": "1", "x-encore-key": "k" + Math.random().toString(36).slice(2), "x-encore-workspace": ws, ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ createdAt: Date.now(), ...body }) });
const day = (k) => new Date(Date.now() + k * 864e5).toISOString().slice(0, 10);
const WD = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const wdOf = (iso) => WD[new Date(iso + "T12:00:00Z").getUTCDay()];
const ask = (who, message, extra = {}) => post("/api/potto/ask", { message, tz: "UTC", ...extra }, who.cookie);
const askJ = async (who, message, extra) => { const r = await ask(who, message, extra); const j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j)); return j; };

let bo, sam, lu, hid, cy, out;
before(async () => {
  srv = await startServer();
  process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "potto-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "500"; process.env.ENCORE_FAKE_EMAIL = "1";
  bo = await host("Bo Tran", "bo-potto"); sam = await person("Sam Diaz"); lu = await person("Lu Chen"); hid = await person("Hana Quiet"); cy = await host("Cy Park", "cy-potto"); out = await person("Oli Out");
  // Bo's game night in 3 days: Sam, Lu and Hana are in (Hana keeps her name private); Rae was invited and hasn't replied
  assert.equal((await put("events/pgame1", { name: "Board game night", kind: "social", casual: true, date: day(3), startTime: "19:00", city: "New York", hood: "Astoria", meetPoint: "12 Secret St, Apt 4", discoverable: true, published: true, headcount: 8,
    guests: [{ name: "Rae Lin", email: "rae@example.com", status: "Invited" }] }, bo.cookie)).status, 200);
  for (const [p, extra] of [[sam, {}], [lu, { phone: "+15551234567", dietary: "no shellfish please", note: "my private note" }], [hid, { showMe: false }]]) {
    const r = await guestRsvp(bo.ws, { eventId: "pgame1", name: p.name, email: p.email, response: "going", code: "C" + p.name.length, ...extra }, p.cookie); assert.equal(r.status, 200, await r.text()); }
  // Cy's private supper (link only) and a public tea
  await put("events/psecret", { name: "Secret supper", kind: "social", casual: true, date: day(2), city: "New York", discoverable: false, published: true, headcount: 6 }, cy.cookie);
  await put("events/ptea", { name: "Cozy tea and cards", kind: "social", casual: true, date: day(4), startTime: "15:00", city: "New York", hood: "Greenpoint", discoverable: true, published: true, headcount: 6, tags: ["tea"] }, cy.cookie);
  await guestRsvp(cy.ws, { eventId: "psecret", name: "Zed Secret", email: "zed@example.com", response: "going", code: "Z1" });
  srv.app.locals.social.bust();
});
beforeEach(() => { resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL", "ENCORE_POTTO_PER_HOUR", "ENCORE_POTTO_TOKENS_PER_DAY"]) delete process.env[k]; await srv.close(); });

test("a guest's context: their plans, who else is in, public events, and nobody's private data", async () => {
  const j = await askJ(sam, "Who's going to board game night?");
  assert.equal(j.mode, "fake");
  assert.match(j.answer, /Lu/); assert.doesNotMatch(j.answer, /Hana/, "Hana keeps her name private");
  assert.deepEqual(j.links, [{ label: "Board game night", href: "/g#rsvp-pgame1" }]);
  const prompt = srv.app.locals.potto.lastPrompt;
  assert.match(prompt, /^POTTO-ASK/);
  for (const secret of [lu.email, sam.email, hid.email, bo.email, "rae@example.com", "zed@example.com", "+15551234567", "no shellfish", "my private note", "12 Secret St", "Secret supper", "Zed", "Rae"]) assert.ok(!prompt.includes(secret), `the prompt leaks ${secret}`);
  assert.match(prompt, /Cozy tea and cards/, "public events are there");
  assert.match(prompt, /"names":\["Lu"\]/, "first names of others who are in, for an event Sam is in");
});

test("someone who isn't in sees a count, not names", async () => {
  const j = await askJ(out, "Who's going to board game night?");
  assert.doesNotMatch(j.answer, /Lu|Sam/); assert.doesNotMatch(srv.app.locals.potto.lastPrompt, /"Lu"|"Sam"/);
});

test("a host's context has their own guests' first names, and nothing of another host's private event", async () => {
  const j = await askJ(bo, "Who hasn't replied to game night?");
  assert.match(j.answer, /Rae/); assert.equal(j.links[0].href, "/?app=1&open=pgame1&step=6#studio", "links to the guest list");
  const prompt = srv.app.locals.potto.lastPrompt;
  for (const secret of ["rae@example.com", lu.email, "+15551234567", "no shellfish", "my private note", "12 Secret St", "Secret supper", "Zed"]) assert.ok(!prompt.includes(secret), `the prompt leaks ${secret}`);
  const g = await askJ(bo, "Who's coming to game night?"); assert.match(g.answer, /Sam/); assert.match(g.answer, /Hana/, "the host sees their own guest list");
});

test("a host asks for a reminder: a draft and a one-tap action on an existing endpoint, sent only when they tap it", async () => {
  const wd = wdOf(day(3));
  const j = await askJ(bo, `Draft a reminder for ${wd[0].toUpperCase() + wd.slice(1)}`);
  assert.match(j.answer, /Board game night/); assert.match(j.answer, /group chat/);
  assert.equal(j.actions.length, 1); const a = j.actions[0];
  assert.equal(a.url, "/api/chats/pgame1/messages"); assert.equal(a.method, "POST"); assert.match(a.confirm, /^Send this to the 3 guests in the Board game night chat\?$/); assert.ok(a.body.text.length > 20);
  assert.match(a.url, ACTION_URL);
  // nothing went out yet
  let chat = await getJ("/api/chats/pgame1", bo.cookie); assert.ok(!(chat.messages || []).some((m) => m.text === a.body.text));
  const r = await post(a.url, a.body, bo.cookie); assert.equal(r.status, 200, await r.text());
  chat = await getJ("/api/chats/pgame1", bo.cookie); assert.ok(chat.messages.some((m) => m.text === a.body.text), "the reminder is in the chat");
  // a guest asking the same gets no action
  const g = await askJ(sam, `Draft a reminder for ${wd}`); assert.equal(g.actions.length, 0);
});

test("fill my open spots and ideas for a winter supper club", async () => {
  const f = await askJ(bo, "Fill my empty spots for game night");
  assert.match(f.answer, /5 open spots/); assert.equal(f.actions[0]?.url, "/api/host/broadcast");
  const i = await askJ(bo, "Ideas for a winter supper club"); assert.match(i.answer, /soup|hot pot|fondue/i); assert.ok(i.links.some((l) => l.href === "/ideas"));
  const w = await askJ(sam, "What's on that's cozy and small?"); assert.match(w.answer, /Cozy tea and cards/); assert.ok(w.links.some((l) => l.href === "/e/ptea"));
});

test("actions and links are checked on the server: only your own events, only real pages", () => {
  const ctx = { today: day(0), me: { host: true, followers: 2 }, myEvents: [{ id: "mine1", title: "Mine", date: day(2), going: 2, open: 3, discoverable: false, link: "/?app=1&open=mine1#studio" }], plans: [], public: [{ id: "pub1", link: "/e/pub1" }] };
  assert.equal(buildAction(ctx, { type: "remind", eventId: "theirs", text: "Hi" }), null, "not someone else's event");
  assert.equal(buildAction(ctx, { type: "delete", eventId: "mine1" }), null, "not an action we don't offer");
  assert.equal(buildAction({ ...ctx, me: { host: false } }, { type: "remind", eventId: "mine1", text: "Hi" }), null, "guests get no host actions");
  assert.equal(buildAction(ctx, { type: "remind", eventId: "mine1", text: "Hi all" }).url, "/api/chats/mine1/messages");
  assert.equal(buildAction(ctx, { type: "broadcast", eventId: "mine1" }).url, "/api/host/announce", "not discoverable: followers instead");
  assert.deepEqual(allowedLinks(ctx, [{ label: "Bad", href: "https://evil.example" }, { label: "Made up", href: "/e/nope" }, { label: "Pub", href: "/e/pub1" }, { label: "Plans", href: "/plans" }, { label: "JS", href: "javascript:alert(1)" }]),
    [{ label: "Pub", href: "/e/pub1" }, { label: "Plans", href: "/plans" }]);
});

test("rules: days, picking the event, support questions", () => {
  const thu = "2026-11-26"; // a Thursday
  assert.deepEqual(daysOf("what's on this weekend", thu), { from: "2026-11-27", to: "2026-11-29" });
  assert.deepEqual(daysOf("friday's game night", thu), { from: "2026-11-27", to: "2026-11-27" });
  assert.deepEqual(daysOf("tonight", thu), { from: thu, to: thu });
  assert.deepEqual(daysOf("this weekend", "2026-11-28"), { from: "2026-11-28", to: "2026-11-29" }, "on Saturday the weekend starts today");
  const L = [{ id: "a", title: "Supper club", date: "2026-11-28" }, { id: "b", title: "Game night", date: "2026-11-27" }];
  assert.equal(pickEvent(L, "Who's going to Friday's game night?", thu).id, "b");
  assert.equal(pickEvent(L, "reminder for Saturday", thu).id, "a");
  assert.equal(pickEvent(L, "reminder for Monday", thu), null, "nothing that day");
  assert.ok(isSupport("How do I change my password?")); assert.ok(isSupport("I want to talk to a person")); assert.ok(!isSupport("How do I fill my empty spots?"));
  assert.equal(pottoReply("Ideas for a winter supper club", {}, { mode: "offline" }).needsAi, true);
  const fake = JSON.parse(fakeText(`POTTO-ASK\n<context>\n${JSON.stringify({ today: thu, public: [] })}\n</context>\n<question>\nIdeas for a winter supper club\n</question>`));
  assert.match(fake.answer, /soup/i, "fake mode answers through server/ai.js");
  assert.equal(estimateTokens("abcd", "abcdefgh"), 3);
});

test("support questions go to the help guide, and the answer is kept in the thread", async () => {
  const j = await askJ(sam, "How do I change my password?"); assert.equal(j.route, "help"); assert.ok(j.threadId);
  const h = await (await post("/api/help/ask", { message: "How do I change my password?", page: "/inbox" }, sam.cookie)).json(); assert.ok(h.answer);
  assert.equal((await post("/api/potto/note", { threadId: j.threadId, answer: h.answer, links: [{ label: "Settings", href: "/settings" }, { label: "Bad", href: "https://x.example" }] }, sam.cookie)).status, 200);
  const t = (await getJ("/api/potto/threads/" + j.threadId, sam.cookie)).thread; assert.equal(t.turns.length, 2); assert.equal(t.turns[1].help, true); assert.deepEqual(t.turns[1].links, [{ label: "Settings", href: "/settings" }]);
});

test("rate limit per hour and a token cap per day, after which Potto keeps to plain answers", async () => {
  process.env.ENCORE_POTTO_PER_HOUR = "3"; const p = await person("Rate Ray");
  for (let i = 0; i < 3; i++) assert.equal((await ask(p, "What's on this weekend?")).status, 200);
  const r = await ask(p, "What's on this weekend?"); assert.equal(r.status, 429); assert.equal((await r.json()).code, "rate_limited");
  delete process.env.ENCORE_POTTO_PER_HOUR;
  process.env.ENCORE_POTTO_TOKENS_PER_DAY = "1"; const q = await person("Token Tia");
  let j = await askJ(q, "Ideas for a winter supper club"); assert.equal(j.mode, "fake"); assert.match(j.answer, /soup/i);
  j = await askJ(q, "Ideas for a winter supper club"); assert.equal(j.mode, "offline"); assert.match(j.note, /today's AI allowance/); assert.doesNotMatch(j.answer, /soup/i);
  const s = await getJ("/api/potto/status", q.cookie); assert.equal(s.left, 0);
  const use = srv.store.get("system/pottouse-" + crypto.createHash("sha256").update(q.email).digest("hex").slice(0, 24)).data; assert.ok(use.tokens > 1); assert.equal(use.email, q.email);
  delete process.env.ENCORE_POTTO_TOKENS_PER_DAY;
  assert.equal((await post("/api/potto/ask", { message: "hi" })).status, 401, "signed out: no Potto");
});

test("no AI key: search, who's going and help still work, and Potto says what isn't available", async () => {
  const keep = { fake: process.env.ENCORE_FAKE_AI, key: process.env.ANTHROPIC_API_KEY, tok: process.env.ANTHROPIC_AUTH_TOKEN };
  process.env.ENCORE_FAKE_AI = "0"; delete process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_AUTH_TOKEN;
  try {
    const s = await getJ("/api/potto/status", sam.cookie); assert.equal(s.ai, "missing_key"); assert.equal(s.can.search, true); assert.equal(s.can.drafting, false); assert.match(s.unavailable, /AI isn't set up/);
    let j = await askJ(sam, "Who's going to board game night?"); assert.equal(j.mode, "offline"); assert.match(j.answer, /Lu/);
    j = await askJ(sam, "Ideas for a winter supper club"); assert.match(j.answer, /AI isn't set up/); assert.ok(j.links.some((l) => l.href === "/ideas"));
    j = await askJ(bo, "Draft a reminder for game night"); assert.match(j.answer, /plain template/); assert.equal(j.actions[0].url, "/api/chats/pgame1/messages", "a template still sends, once confirmed");
  } finally { process.env.ENCORE_FAKE_AI = keep.fake; if (keep.key) process.env.ANTHROPIC_API_KEY = keep.key; if (keep.tok) process.env.ANTHROPIC_AUTH_TOKEN = keep.tok; }
});

test("history: listed, opened, deleted one at a time or all, and gone with the account", async () => {
  const p = await person("Hist Ivy");
  const a = await askJ(p, "What's on this weekend?"); const b = await askJ(p, "Anything cozy?", { threadId: a.threadId }); assert.equal(b.threadId, a.threadId, "same chat");
  const c = await askJ(p, "Ideas for a winter supper club");
  let L = (await getJ("/api/potto/threads", p.cookie)).threads; assert.equal(L.length, 2); assert.equal(L[0].id, c.threadId, "newest first");
  const t = (await getJ("/api/potto/threads/" + a.threadId, p.cookie)).thread; assert.equal(t.turns.length, 4); assert.equal(t.title, "What's on this weekend?");
  assert.equal((await fetch(srv.base + "/api/potto/threads/" + a.threadId, { headers: { cookie: sam.cookie } })).status, 404, "someone else's chat isn't there");
  assert.equal((await (await fetch(srv.base + "/api/potto/threads/" + a.threadId, { method: "DELETE", headers: { cookie: p.cookie } })).json()).removed, 1);
  L = (await getJ("/api/potto/threads", p.cookie)).threads; assert.deepEqual(L.map((x) => x.id), [c.threadId]);
  await askJ(p, "One more");
  assert.equal((await (await fetch(srv.base + "/api/potto/threads", { method: "DELETE", headers: { cookie: p.cookie } })).json()).removed, 2);
  assert.equal((await getJ("/api/potto/threads", p.cookie)).threads.length, 0);
  // account deletion
  const d = await person("Gone Gus"); await askJ(d, "What's on this weekend?");
  const k = "system/potto-" + crypto.createHash("sha256").update(d.email).digest("hex").slice(0, 24), u = "system/pottouse-" + crypto.createHash("sha256").update(d.email).digest("hex").slice(0, 24);
  assert.ok(srv.store.get(k)); assert.ok(srv.store.get(u));
  const r = await post("/api/me/delete", { confirm: "DELETE", when: "now" }, d.cookie); assert.equal(r.status, 200, await r.text());
  assert.equal(srv.store.get(k), null, "history is removed with the account"); assert.equal(srv.store.get(u), null, "and the usage count");
});

// ---- QA round 4: Potto as a co-host when someone is stuck (what's missing, no date, no place, the day before, after) ----
test("stuck while planning: Potto says what the invite still needs, how friends pick a date, and never names a venue", () => {
  const T = "2026-11-28", ev = (o) => ({ id: "e1", title: "Dumpling night", date: "2026-12-04", time: "19:00", where: "Bed-Stuy, Brooklyn", spots: 8, going: 1, open: 7, maybe: 1, maybeNames: ["Lee"], goingNames: ["Sam"], noReply: ["Rae"], missing: [], shared: true, link: "/?app=1&open=e1#studio", guestsLink: "/?app=1&open=e1&step=6#studio", chatLink: "/chats/e1", pageLink: "/e/e1", ...o });
  const draft = { id: "d1", title: "Draft supper", missing: ["a date", "a place", "a few words on what to expect"], shared: false, link: "/?app=1&open=d1#studio" };
  const mk = (o = {}) => ({ today: T, me: { host: true, first: "Mai" }, myEvents: [], plans: [], public: [], ...o });
  const R = (q, ctx, mode = "fake") => pottoReply(q, ctx, { mode });
  // what a draft still needs, by name; "Draft supper" is a title, not a request to draft a thank-you
  let r = R("What's missing from Draft supper?", mk({ drafts: [draft] }));
  assert.equal(r.intent, "missing"); assert.match(r.answer, /Draft supper still needs a date, a place and a few words on what to expect\./); assert.deepEqual(r.links, [{ label: "Draft supper", href: draft.link }]); assert.doesNotMatch(r.answer, /Thanks for coming/);
  r = R("Is Draft supper ready to share?", mk({ drafts: [draft] })); assert.equal(r.intent, "missing");
  r = R("Is my invite ready to share?", mk({ myEvents: [ev({ shared: false })] })); assert.match(r.answer, /has a date, a place and a description\. It isn't shared yet/);
  r = R("What do I still need to add?", mk({ myEvents: [ev({ missing: ["a place"] })] })); assert.match(r.answer, /Dumpling night still needs a place\. Guests can already open it/);
  r = R("What's missing?", mk()); assert.match(r.answer, /haven't started an event yet/); assert.equal(r.links[0].href, "/?app=1&new=1#studio");
  // no date: friends vote, in the editor
  for (const q of ["Can you poll my friends for a date?", "find a time that works", "Which day is best for a dinner?", "Can I share without a date?", "I don't know what date works for everyone"]) { r = R(q, mk()); assert.equal(r.intent, "date", q); assert.match(r.answer, /Ask friends first\. Add up to three dates/); assert.equal(r.links[0].href, "/?app=1&new=1#studio"); }
  r = R("Which date works for everyone?", mk({ drafts: [draft] })); assert.match(r.answer, /Open Draft supper, tap the date/); assert.equal(r.links[0].href, draft.link);
  // no place: where the picks are, and no invented venue
  for (const q of ["Suggest a place near me", "Where should I host a dinner for 8?", "Find a restaurant for a birthday in Brooklyn", "What's a good bar for 10 people?", "Add a place to my event", "I don't have space at home, where can we go?"]) { r = R(q, mk(), "offline"); assert.equal(r.intent, "place", q); assert.match(r.answer, /I won't guess a venue/); assert.ok(!r.needsAi); }
  // someone with nothing coming up isn't told about reminders they can't send
  r = R("What time should I tell people?", mk()); assert.doesNotMatch(r.answer, /draft reminders/); assert.match(r.answer, /What are you planning\?/); assert.equal(r.links[0].label, "New event");
  r = R("I'm new, where do I start?", mk()); assert.equal(r.intent, "start");
  r = R("What's easy to host on a weeknight?", mk()); assert.equal(r.intent, "ideas");
  // shared, few replies; the day before; after
  const C = mk({ myEvents: [ev()] });
  assert.match(R("Who said maybe?", C).answer, /^Lee said Maybe to Dumpling night\.$/);
  assert.match(R("How many spots are left for Dumpling night?", C).answer, /7 of 8 spots open\. 1 in\./);
  r = R("Only one person replied, what do I do?", C); assert.equal(r.intent, "fill"); assert.match(r.answer, /7 open spots/);
  r = R("Message everyone who's in", C); assert.deepEqual(r.links, [{ label: "Group chat", href: "/chats/e1" }]);
  r = R("What do I need to prep for Dumpling night?", C); assert.equal(r.intent, "prep"); assert.match(r.answer, /Dumpling night is Fri, Dec 4 · 7pm in Bed-Stuy\. 1 in, 1 maybe, 1 yet to reply\./);
  r = R("Should I ask guests to bring something?", C); assert.equal(r.intent, "bring"); assert.match(r.answer, /What to bring/);
  r = R("How did Last week's supper go?", mk({ myEvents: [ev({ id: "p1", title: "Last week's supper", date: "2026-11-23", pageLink: "/e/p1" }), ev()] })); assert.equal(r.intent, "after"); assert.match(r.answer, /Last week's supper was Mon, Nov 23\. 1 guest was in\./); assert.deepEqual(r.links, [{ label: "Last week's supper", href: "/e/p1" }]);
  // a guest asking about a plan gets the invite's facts and the area, never the street
  const G = { today: T, me: { host: true, first: "Sam" }, myEvents: [], public: [], plans: [{ id: "e1", title: "Dumpling night", date: "2026-12-04", time: "19:00", where: "Bed-Stuy, Brooklyn", host: "Mai", going: 2, names: [], link: "/g#rsvp-e1", chatLink: "/chats/e1" }] };
  assert.equal(R("Where is Dumpling night?", G).answer, "Dumpling night is Fri, Dec 4 · 7pm, in Bed-Stuy, Brooklyn. The exact spot is on your invite.");
  assert.match(R("What time does it start?", G).answer, /Fri, Dec 4 · 7pm/);
  assert.match(R("I can't make it anymore", G).answer, /tap Can't go/);
  assert.match(R("Can I bring a friend?", G).answer, /That's up to Mai/);
  assert.deepEqual(R("Message the host", G).links[0], { label: "Group chat", href: "/chats/e1" });
  assert.match(R("What should I bring to Dumpling night?", G).answer, /Anything Mai asked for is on the invite/);
  assert.equal(R("What's on this weekend?", G).intent, "search"); // still a search
});

test("the sheet opens with three questions about this person's own events, and each one has a real answer", async () => {
  assert.deepEqual(missingOf({}), ["a date", "a place", "a few words on what to expect"]); assert.deepEqual(missingOf({ date: "2026-12-04", meetPoint: "Home", why: "Dumplings." }), []);
  assert.deepEqual(missingOf({ stage: "interest", dateOptions: ["2026-12-04"], venueName: "Lilia" }), ["a few words on what to expect"]);
  assert.deepEqual(suggestFor({ today: "2026-11-28", myEvents: [], plans: [] }).suggest, ["What should I host?", "Which date works for everyone?", "Where could I host it?"]);
  // nothing going on: how to start, never a made-up event
  const nu = await person("Nora New"); let s = await getJ("/api/potto/status", nu.cookie);
  assert.deepEqual(s.suggest, ["What should I host?", "Which date works for everyone?", "Where could I host it?"]); assert.equal(s.here, null);
  for (const q of s.suggest) { const j = await askJ(nu, q); assert.doesNotMatch(j.answer, /draft reminders/, q); assert.ok(j.links.length, q); }
  // a host with a dateless draft and a shared event: the draft first, then the event; on the event's screen, that event
  const h = await host("Dee Stuck", "dee-stuck");
  await put("events/sdraft", { name: "Clothes swap", kind: "social", casual: true }, h.cookie);
  await put("events/sopen", { name: "Soup night", kind: "social", casual: true, date: day(5), startTime: "19:00", city: "New York", meetPoint: "My place", why: "Soup.", published: true, headcount: 6, guests: [{ name: "Rae Lin", email: "rae2@example.com", status: "Invited" }] }, h.cookie);
  s = await getJ("/api/potto/status", h.cookie); assert.equal(s.suggest.length, 3); assert.equal(s.suggest[0], "What's missing from Clothes swap?"); assert.ok(s.suggest.includes("Who hasn't replied to Soup night?"));
  let j = await askJ(h, s.suggest[0]); assert.match(j.answer, /Clothes swap still needs a date, a place and a few words on what to expect/); assert.deepEqual(j.links, [{ label: "Clothes swap", href: "/?app=1&open=sdraft#studio" }]);
  j = await askJ(h, "Who hasn't replied to Soup night?"); assert.match(j.answer, /One person hasn't replied to Soup night: Rae/);
  s = await getJ("/api/potto/status?eventId=sopen", h.cookie); assert.deepEqual(s.here, { eventId: "sopen", title: "Soup night" }); assert.equal(s.suggest[0], "Who hasn't replied to Soup night?"); assert.ok(s.suggest.includes("Fill the open spots for Soup night"));
  s = await getJ("/api/potto/status?eventId=not-mine", h.cookie); assert.equal(s.here, null);
  // the sheet uses them, and no longer offers questions about events that may not exist
  const src = (await import("node:fs")).readFileSync(new URL("../public/potto.js", import.meta.url), "utf8");
  assert.match(src, /st\.suggest\.slice\(0, 3\)/); assert.match(src, /chips\(\); \} if \(!S\.turns\.length && S\.view === "chat"\) view\("chat"\)/, "the sheet redraws once it knows what to offer"); assert.match(src, /HostEvent\?\.draft\?\.\(\)/, "the event open in the app counts as the one on screen"); assert.doesNotMatch(src, /Friday's game night|Draft a reminder for Saturday/);
});
