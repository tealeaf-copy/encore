// The social layer out in the open on feed cards (server/feedblend.js, server/feedcomments.js, public/feedvisual.js,
// public/post.html): the feed carries up to five kudos faces and the latest three comments, signed out sees them on
// public cards only, the post page (/post/...) opens for whoever may see the card, replies reach the people in the
// thread, blocks hide kudos and comments, the "Show my name on kudos and comments" setting is kept, and the signed-out
// feed is fresh after a kudos or a comment.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { postPath, targetOfPost } from "../server/feedcomments.js";

let srv;
const J = { "content-type": "application/json" };
const post = (p, body, cookie) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body || {}) });
const get = (p, cookie) => fetch(srv.base + p, { headers: cookie ? { cookie } : {} });
const put = (p, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + p, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const key = (em) => Buffer.from(em).toString("base64url");
const U = {};
const cookies = (r) => r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const join = async (who, name) => { const email = `${who}.fs@example.com`, r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }), b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); U[who] = { cookie: cookies(r), ws: b.workspace.id, email }; };
const feedOf = async (who) => { srv.app.locals.social.bust(); const r = await get("/api/me/feed", U[who].cookie); assert.equal(r.status, 200); return (await r.json()).blend; };
const pubFeed = async () => (await (await get("/api/public/feed")).json()).blend;
const cardIn = (B, target) => [...B.items, ...B.items.filter((x) => x.kind === "row").flatMap((r) => r.items)].find((x) => x.kudos?.target === target);
const kudos = async (who, target) => { const r = await post("/api/feed/kudos", { target }, U[who].cookie); return { status: r.status, ...(await r.json()) }; };
const say = async (who, target, text, re) => { const r = await post("/api/feed/comments", { target, text, ...(re ? { re } : {}) }, who ? U[who].cookie : ""); return { status: r.status, ...(await r.json()) }; };
const inbox = async (who) => (await (await get("/api/me/inbox", U[who].cookie)).json()).items.filter((n) => n.kind === "comment");
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "fs-secret", ENCORE_SIGNUP_PER_HOUR: "500", ENCORE_FAKE_EMAIL: "1", ENCORE_FEED_KUDOS_PER_HOUR: "500", ENCORE_FEED_KUDOS_PER_IP_HOUR: "2000", ENCORE_FEED_COMMENTS_PER_HOUR: "500", ENCORE_FEED_COMMENTS_PER_IP_HOUR: "2000" };
const PEOPLE = [["rosa", "Rosa Lind"], ["maya", "Maya Okafor"], ["jun", "Jun Park"], ["ana", "Ana Ruiz"], ["noor", "Noor Haddad"], ["sam", "Sam Idris"], ["kit", "Kit Alvarez"], ["leo", "Leo Brandt"], ["ivy", "Ivy Chen"]];

before(async () => {
  srv = await startServer(); Object.assign(process.env, ENV); resetLoginLimits();
  for (const [w, n] of PEOPLE) await join(w, n);
  assert.ok((await post("/api/host/profile", { handle: "meeple-fs", name: "Meeple House", city: "Brooklyn", hood: "Prospect Heights", tagline: "Board games for grown ups." }, U.rosa.cookie)).ok);
  const ev = (id, d) => put("events/" + id, { kind: "social", casual: true, city: "Brooklyn", discoverable: true, published: true, ...d }, U.rosa.cookie);
  assert.equal((await ev("fsGame", { name: "Board game night", activity: "board games", date: day(3) })).status, 200);
  await ev("fsChess", { name: "Chess in the park", activity: "chess", date: day(5) });
  await ev("fsPriv", { name: "Private dinner", activity: "dinner", date: day(4), private: true, discoverable: false });
  // a fan club with a members-only night; Ana is a member
  assert.ok((await post("/api/host/club", { on: true, name: "Meeple Regulars" }, U.rosa.cookie)).ok);
  assert.ok((await post("/api/me/club/meeple-fs/join", {}, U.ana.cookie)).ok);
  await ev("fsMembers", { name: "Members' game night", activity: "board games", date: day(6) });
  assert.ok((await post("/api/host/club/events/fsMembers", { visibility: "members" }, U.rosa.cookie)).ok);
  srv.app.locals.social.bust();
});
beforeEach(() => { Object.assign(process.env, ENV); resetLoginLimits(); });
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

test("The feed carries the count, up to five kudos faces and the latest three comments with their time", async () => {
  for (const w of ["maya", "jun", "ana", "noor", "sam", "kit", "leo", "ivy"]) assert.equal((await kudos(w, "e:fsGame")).status, 200);
  for (const [w, t] of [["maya", "Saving a seat for Wingspan."], ["jun", "Fine to come alone?"], ["rosa", "Of course."], ["ana", "Bringing pretzels."]]) assert.equal((await say(w, "e:fsGame", t)).status, 200);
  const k = cardIn(await feedOf("jun"), "e:fsGame").kudos;
  assert.equal(k.count, 8); assert.equal(k.mine, true); assert.equal(k.faces.length, 5, "five faces at most"); assert.equal(k.faces[0].me, 1, "yours first");
  assert.ok(k.faces.every((f) => f.g || /^[A-Z]$/.test(f.i)), "an initial or a plain face"); assert.match(k.line, /^You, \w+ and 6 others gave kudos$/);
  const c = cardIn(await feedOf("jun"), "e:fsGame").comments;
  assert.equal(c.count, 4); assert.deepEqual(c.last.map((x) => x.text), ["Fine to come alone?", "Of course.", "Bringing pretzels."], "the latest three, oldest of them first");
  assert.ok(c.last.every((x) => x.id && x.at > 0 && x.face), "each with an id, a time and a face"); assert.equal(c.last[0].mine, true); assert.equal(c.last[1].host, true, "the host's comment is marked");
  assert.ok(!JSON.stringify(c).includes("@example.com"), "no emails");
});

test("Signed out: public cards show the counts, faces and comments; members-only and private cards stay hidden", async () => {
  const B = await pubFeed(), card = cardIn(B, "e:fsGame");
  assert.equal(card.kudos.count, 8); assert.equal(card.kudos.faces.length, 5); assert.equal(card.kudos.mine, false); assert.match(card.kudos.line, /^\w+, \w+ and 6 others gave kudos$/);
  assert.equal(card.comments.count, 4); assert.equal(card.comments.last.length, 3);
  assert.equal(cardIn(B, "e:fsMembers"), undefined); assert.equal(cardIn(B, "e:fsPriv"), undefined);
  const S = await (await get("/api/feed/social?targets=" + encodeURIComponent("e:fsGame,e:fsMembers,e:fsPriv"))).json();
  assert.deepEqual(Object.keys(S.items), ["e:fsGame"]); assert.equal(S.items["e:fsGame"].kudos.faces.length, 5);
  // a member sees the members-only card, its kudos and comments
  assert.equal((await say("ana", "e:fsMembers", "Bringing Azul.")).status, 200);
  assert.equal(cardIn(await feedOf("ana"), "e:fsMembers").comments.last[0].text, "Bringing Azul.");
});

test("The post page: 200 signed out for a public card, 404 for private and members-only, the whole thread and the kudos list", async () => {
  assert.equal(postPath("e:fsGame"), "/post/e/fsGame"); assert.equal(postPath("club.meeple-fs|abc"), "/post/c/meeple-fs/abc"); assert.equal(postPath("nope"), ""); assert.equal(targetOfPost("c", "Meeple-FS", "abc"), "club.meeple-fs|abc");
  let r = await get("/post/e/fsGame"); assert.equal(r.status, 200); let html = await r.text();
  assert.match(html, /<title>Board game night \| Pottery Lab<\/title>/); assert.match(html, /<script id="postData" type="application\/json">\{/); assert.match(html, /Sign in to comment|feedcomments\.js/);
  const data = JSON.parse(/<script id="postData" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.equal(data.target, "e:fsGame"); assert.equal(data.canPost, false); assert.equal(data.item.kind, "event"); assert.equal(data.count, 4); assert.equal(data.comments.length, 4);
  assert.equal(data.kudos.count, 8); assert.equal(data.kudos.people.length, 8, "everyone who gave kudos, not five"); assert.ok(!html.includes("@example.com"), "no emails on the page");
  for (const p of ["/post/e/fsPriv", "/post/e/fsMembers", "/post/e/nope", "/post/x/fsGame", "/post/c/meeple-fs/nope"]) assert.equal((await get(p)).status, 404, p);
  assert.equal((await get("/post/e/fsMembers", U.noor.cookie)).status, 404, "not a member"); assert.equal((await get("/post/e/fsMembers", U.ana.cookie)).status, 200, "a member");
  assert.equal((await get("/post/e/fsMembers", U.rosa.cookie)).status, 200, "the host");
  // signed in: the API answers the same, with your own face for the box
  const j = await (await get("/api/feed/post?target=e:fsGame", U.jun.cookie)).json(); assert.equal(j.canPost, true); assert.equal(j.me.me, 1); assert.equal(j.kudos.people[0].mine, true);
  assert.equal((await get("/api/feed/post?target=e:fsPriv", U.jun.cookie)).status, 404);
  // the post page has the group chat as a quiet link, and no em dashes
  const page = fs.readFileSync(new URL("../public/post.html", import.meta.url), "utf8"); assert.match(page, /Open the group chat/); assert.ok(!/—/.test(page));
});

test("A comment from the card shows in the payload at once, for the writer and for everyone else", async () => {
  const a = await say("sam", "e:fsChess", "Is there a board for beginners?"); assert.equal(a.status, 200);
  assert.equal(a.summary.count, 1); assert.equal(a.summary.last[0].text, "Is there a board for beginners?"); assert.equal(a.summary.last[0].mine, true);
  assert.equal(cardIn(await feedOf("sam"), "e:fsChess").comments.last.at(-1).text, "Is there a board for beginners?");
  assert.equal(cardIn(await pubFeed(), "e:fsChess").comments.last.at(-1).text, "Is there a board for beginners?", "the signed-out feed is rebuilt after a comment");
  // kudos: the same, and the cache headers say so
  await kudos("leo", "e:fsChess"); const r = await get("/api/public/feed"); assert.match(r.headers.get("cache-control"), /max-age=60/);
  assert.equal(cardIn((await r.json()).blend, "e:fsChess").kudos.count, 1, "the signed-out copy is fresh after a kudos");
  assert.match((await get("/api/feed/social?targets=e:fsChess")).headers.get("cache-control"), /no-store/);
  // the service worker drops its saved feed after a kudos or a comment goes through
  const sw = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"); assert.match(sw, /\\\/api\\\/feed\\\/\(kudos\|comments\)/); assert.match(sw, /dropFeed/);
});

test("Replies: one level, the person answered and the others in that thread hear once an hour, never about their own", async () => {
  const m = await say("maya", "e:fsChess", "Who's bringing clocks?"); const r1 = await say("jun", "e:fsChess", "I have two.", m.comment.id);
  assert.equal(r1.status, 200); assert.equal(r1.comment.re, m.comment.id);
  let M = await inbox("maya"); assert.equal(M.filter((n) => /replied to your comment/.test(n.text)).length, 1); assert.match(M.find((n) => /replied/.test(n.text)).text, /^Jun replied to your comment on Chess in the park: "I have two\."/);
  assert.match(M.find((n) => /replied/.test(n.text)).link, /^\/post\/e\/fsChess#c-/);
  assert.equal((await inbox("jun")).filter((n) => /replied/.test(n.text)).length, 0, "not for your own reply");
  // a reply to a reply joins the first comment's replies; Jun hears "also replied", Maya's note is batched
  const r2 = await say("noor", "e:fsChess", "I'll bring one too.", r1.comment.id); assert.equal(r2.comment.re, m.comment.id);
  assert.match((await inbox("jun")).find((n) => /replied/.test(n.text))?.text || "", /^Noor also replied on Chess in the park/);
  assert.equal((await inbox("maya")).filter((n) => /replied/.test(n.text)).length, 1, "one note per thread an hour");
  // the host hears about the comment once, and not twice when a reply was to the host
  assert.ok((await inbox("rosa")).some((n) => /commented on Chess in the park/.test(n.text)));
  // a reply to a comment that isn't there
  assert.equal((await say("jun", "e:fsChess", "hello", "nope")).status, 404);
  // mutes: Kit muted the host in the Inbox, so a reply to Kit is quiet
  const k = await say("kit", "e:fsGame", "Any Catan?"); const h = crypto.createHash("sha256").update(U.kit.email).digest("hex").slice(0, 24);
  srv.store.set("system/inboxprefs-" + h, { kind: "inboxprefs", email: U.kit.email, mutedHosts: [{ handle: "meeple-fs", name: "Meeple House", at: Date.now() }], offTypes: [] });
  await say("leo", "e:fsGame", "Two copies.", k.comment.id); assert.equal((await inbox("kit")).filter((n) => /replied/.test(n.text)).length, 0, "muted");
  // blocks: Ivy blocked Sam, so Sam's reply to Ivy is quiet
  const i = await say("ivy", "e:fsGame", "Bringing snacks."); assert.ok((await post("/api/me/blocks", { kind: "person", key: key(U.sam.email), name: "Sam" }, U.ivy.cookie)).ok);
  await say("sam", "e:fsGame", "Thanks!", i.comment.id); assert.equal((await inbox("ivy")).filter((n) => /replied/.test(n.text)).length, 0, "blocked");
  // the post page groups them: the thread carries re on each reply
  const T = await (await get("/api/feed/comments?target=e:fsChess", U.jun.cookie)).json(); assert.deepEqual(T.comments.filter((c) => c.re).map((c) => c.text), ["I have two.", "I'll bring one too."]);
});

test("Blocks: a blocked person's kudos and comments are gone for the person who blocked them, nobody else", async () => {
  await say("leo", "e:fsGame", "See you there.");
  assert.ok((await post("/api/me/blocks", { kind: "person", key: key(U.leo.email), name: "Leo" }, U.noor.cookie)).ok);
  const mine = cardIn(await feedOf("noor"), "e:fsGame"), theirs = cardIn(await feedOf("jun"), "e:fsGame");
  assert.equal(mine.kudos.count, theirs.kudos.count - 1, "Leo's kudos isn't counted for Noor"); assert.ok(!mine.kudos.names.includes("Leo"));
  const T = await (await get("/api/feed/comments?target=e:fsGame", U.noor.cookie)).json(); assert.ok(!T.comments.some((c) => c.name === "Leo"));
  const P = await (await get("/api/feed/post?target=e:fsGame", U.noor.cookie)).json(); assert.ok(!P.kudos.people.some((p) => p.name === "Leo"));
  assert.ok((await (await get("/api/feed/post?target=e:fsGame", U.jun.cookie)).json()).kudos.people.some((p) => p.name === "Leo"), "everyone else still sees Leo");
});

test("Show my name on kudos and comments: Everyone (the default), People I follow, Only hosts", async () => {
  assert.equal((await (await get("/api/me/prefs", U.noor.cookie)).json()).socialName, "everyone");
  assert.equal((await post("/api/me/prefs", { socialName: "nobody" }, U.noor.cookie)).status, 400);
  const pr = await (await post("/api/me/prefs", { socialName: "hosts" }, U.noor.cookie)).json(); assert.equal(pr.socialName, "hosts"); assert.equal(pr.emails, true, "the other settings keep their values");
  await say("noor", "e:fsGame", "Only the host knows it's me.");
  const pick = (L) => L.find((c) => c.text === "Only the host knows it's me.");
  // signed out and another guest: "A guest", a plain face, no key to block by (it is the email in base64)
  const out = pick((await (await get("/api/feed/comments?target=e:fsGame")).json()).comments); assert.equal(out.name, "A guest"); assert.equal(out.guest, true); assert.deepEqual(out.face, { g: 1 }); assert.equal(out.key, undefined);
  assert.equal(pick((await (await get("/api/feed/comments?target=e:fsGame", U.jun.cookie)).json()).comments).name, "A guest");
  assert.ok(!JSON.stringify(await pubFeed()).includes("Noor"), "never named on the signed-out feed");
  assert.ok(cardIn(await pubFeed(), "e:fsGame").kudos.faces.some((f) => f.g), "Noor's kudos face is a plain one");
  // the host and Noor herself see the name
  assert.equal(pick((await (await get("/api/feed/comments?target=e:fsGame", U.rosa.cookie)).json()).comments).name, "Noor");
  assert.equal(pick((await (await get("/api/feed/comments?target=e:fsGame", U.noor.cookie)).json()).comments).mine, true);
  // People I follow: Noor follows Sam, so Sam sees her name and Jun doesn't
  await post("/api/me/friends", { key: key(U.sam.email) }, U.noor.cookie); await post("/api/me/prefs", { socialName: "follow" }, U.noor.cookie);
  assert.equal(pick((await (await get("/api/feed/comments?target=e:fsGame", U.sam.cookie)).json()).comments).name, "Noor");
  assert.equal(pick((await (await get("/api/feed/comments?target=e:fsGame", U.jun.cookie)).json()).comments).name, "A guest");
  // back to Everyone
  await post("/api/me/prefs", { socialName: "everyone" }, U.noor.cookie); assert.equal(pick((await (await get("/api/feed/comments?target=e:fsGame")).json()).comments).name, "Noor");
  assert.match(fs.readFileSync(new URL("../public/settings.html", import.meta.url), "utf8"), /Show my name on kudos and comments[\s\S]*Everyone[\s\S]*People I follow[\s\S]*Only hosts/);
});

test("The card: faces, the latest comments, the comment box and the post page link; signed out a way to sign in", () => {
  const src = fs.readFileSync(new URL("../public/feedvisual.js", import.meta.url), "utf8");
  // the renderer is checked in test/feed-kudos-comments.test.js; here: what the card promises
  assert.match(src, /<label class="fb-sr" for="\$\{id\}">Add a comment<\/label><textarea/); assert.match(src, /aria-pressed="\$\{!!k\.mine\}"/);
  assert.match(src, /Sign in to add a comment/); assert.match(src, /View all \$\{n\} comments/); assert.match(src, /role", "status"\); el\.setAttribute\("aria-live", "polite"\)/);
  assert.ok(!/—/.test(src), "no em dashes");
});
