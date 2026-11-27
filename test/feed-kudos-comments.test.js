// Kudos counts and comments on feed cards (server/feedblend.js, server/feedcomments.js, public/feedvisual.js,
// public/feedcomments.js): the count adds up across people and survives a reload, every card kind's target is
// accepted, and the comment thread keeps the card's own visibility, the block list, the limits and plain text.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { threadKey, tidy, COMMENT_MAX } from "../server/feedcomments.js";

let srv;
const J = { "content-type": "application/json" };
const post = (p, body, cookie) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body || {}) });
const get = (p, cookie) => fetch(srv.base + p, { headers: cookie ? { cookie } : {} });
const del = (p, cookie) => fetch(srv.base + p, { method: "DELETE", headers: cookie ? { cookie } : {} });
const put = (p, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + p, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const key = (em) => Buffer.from(em).toString("base64url");
const U = {};
const cookies = (r) => r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const join = async (who, name) => { const email = `${who}.kc@example.com`, r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }), b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); U[who] = { cookie: cookies(r), ws: b.workspace.id, email }; };
const feedOf = async (who) => { srv.app.locals.social.bust(); const r = await get("/api/me/feed", U[who].cookie); assert.equal(r.status, 200); return (await r.json()).blend; };
const cardIn = (B, target) => [...B.items, ...B.items.filter((x) => x.kind === "row").flatMap((r) => r.items)].find((x) => x.kudos?.target === target);
const kudos = async (who, target) => { const r = await post("/api/feed/kudos", { target }, U[who].cookie); return { status: r.status, ...(await r.json()) }; };
const say = async (who, target, text) => { const r = await post("/api/feed/comments", { target, text }, who ? U[who].cookie : ""); return { status: r.status, ...(await r.json()) }; };
const thread = async (who, target) => { const r = await get("/api/feed/comments?target=" + encodeURIComponent(target), who ? U[who].cookie : ""); return { status: r.status, ...(await r.json()) }; };
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "kc-secret", ENCORE_SIGNUP_PER_HOUR: "500", ENCORE_FAKE_EMAIL: "1", ENCORE_FEED_KUDOS_PER_HOUR: "500", ENCORE_FEED_KUDOS_PER_IP_HOUR: "2000", ENCORE_FEED_COMMENTS_PER_HOUR: "500", ENCORE_FEED_COMMENTS_PER_IP_HOUR: "2000" };
let clubTarget = "", msTarget = "";

before(async () => {
  srv = await startServer(); Object.assign(process.env, ENV); resetLoginLimits();
  for (const [w, n] of [["theo", "Theo Marsh"], ["kit", "Kit Alvarez"], ["ana", "Ana Ruiz"], ["maya", "Maya Okafor"], ["jun", "Jun Park"], ["noor", "Noor Haddad"], ["sam", "Sam Idris"]]) await join(w, n);
  assert.ok((await post("/api/host/profile", { handle: "crumb-kc", name: "Crumb Theory", city: "Brooklyn", hood: "Fort Greene", tagline: "Small and calm." }, U.theo.cookie)).ok);
  assert.ok((await post("/api/host/profile", { handle: "reads-kc", name: "Slow Reads", city: "Brooklyn", hood: "Park Slope", tagline: "Quiet books." }, U.kit.cookie)).ok);
  const ev = (w, id, d) => put("events/" + id, { kind: "social", casual: true, city: "Brooklyn", discoverable: true, published: true, ...d }, U[w].cookie);
  assert.equal((await ev("theo", "kcUp", { name: "Winter Bread Supper", activity: "supper", date: day(4) })).status, 200);
  await ev("theo", "kcIdea", { name: "Apartment Cafe Morning", activity: "coffee", stage: "interest", date: day(8) }); // an interest check: the button says "I'd go"
  for (const [id, n] of [["kcP1", 30], ["kcP2", 16], ["kcPast", 3]]) await ev("theo", id, { name: "Crumb Supper", activity: "supper", date: day(-n) }); // three past suppers: a milestone, and a recap of the latest
  for (let i = 0; i < 3; i++) srv.store.set(`ws/${U.theo.ws}/moments/kcM${i}`, { eventId: "kcPast", authorEmail: U.theo.email, authorName: "Theo", url: "/_blob/" + String(i).repeat(20), type: "image", at: Date.now() - 864e5 });
  await ev("kit", "kcPrivate", { name: "Private birthday", activity: "dinner", date: day(3), private: true, discoverable: false });
  await ev("kit", "kcOpen", { name: "Slow Reads: Train Dreams", activity: "book club", date: day(9) });
  // Ana was at the past supper, so its group chat is hers to open
  srv.store.set(`ws/${U.theo.ws}/rsvps/kcR1`, { eventId: "kcPast", email: U.ana.email, name: "Ana Ruiz", response: "going", createdAt: Date.now() - 9 * 864e5, code: "CkcR1" });
  for (const [a, b] of [["ana", "maya"]]) { await post("/api/me/friends", { key: key(U[b].email) }, U[a].cookie); await post("/api/me/friends", { key: key(U[a].email) }, U[b].cookie); }
  // a fan club with one post and a members-only event; Ana is a member
  assert.ok((await post("/api/host/club", { on: true, name: "Crumb Regulars" }, U.theo.cookie)).ok);
  assert.ok((await post("/api/me/club/crumb-kc/join", {}, U.ana.cookie)).ok);
  assert.ok((await post("/api/host/club/posts", { text: "Starter is bubbling for Thursday." }, U.theo.cookie)).ok);
  await ev("theo", "kcMembers", { name: "Members' bread night", activity: "supper", date: day(6) });
  assert.ok((await post("/api/host/club/events/kcMembers", { visibility: "members" }, U.theo.cookie)).ok);
  srv.app.locals.social.bust();
});
beforeEach(() => { Object.assign(process.env, ENV); resetLoginLimits(); });
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

test("Kudos add up across three people, read the same after a reload, and a second tap takes one away", async () => {
  let j = await kudos("noor", "e:kcUp"); assert.equal(j.status, 200); assert.deepEqual([j.count, j.mine, j.line], [1, true, "You gave kudos"]);
  j = await kudos("maya", "e:kcUp"); assert.deepEqual([j.count, j.mine, j.line], [2, true, "You and 1 more gave kudos"]);
  j = await kudos("ana", "e:kcUp"); assert.deepEqual([j.count, j.mine], [3, true]); assert.equal(j.line, "You and 2 more gave kudos");
  // a reload: the feed carries the same count, to each person in their own words
  for (const [who, mine, line] of [["ana", true, "You and 2 more gave kudos"], ["noor", true, "You and 2 more gave kudos"], ["jun", false, "3 people gave kudos"]]) {
    const k = cardIn(await feedOf(who), "e:kcUp").kudos; assert.deepEqual([k.count, k.mine, k.line], [3, mine, line], who); }
  // the fresh counts the page asks for after it draws (a saved or minute-old feed never leaves a stale number up)
  let S = await (await get("/api/feed/social?targets=" + encodeURIComponent("e:kcUp,e:kcIdea,e:kcPrivate,nope"), U.jun.cookie)).json();
  assert.equal(S.items["e:kcUp"].kudos.count, 3); assert.equal(S.items["e:kcIdea"].kudos.count, 0); assert.ok(!("e:kcPrivate" in S.items) && !("nope" in S.items));
  // toggling off decrements, for that person only
  j = await kudos("maya", "e:kcUp"); assert.deepEqual([j.count, j.mine], [2, false]);
  let k = cardIn(await feedOf("ana"), "e:kcUp").kudos; assert.deepEqual([k.count, k.mine, k.line], [2, true, "You and 1 more gave kudos"]);
  j = await kudos("maya", "e:kcUp"); assert.deepEqual([j.count, j.mine], [3, true]);
  // a friend is named to their friend; "You" never counts yourself twice
  k = cardIn(await feedOf("ana"), "e:kcUp").kudos; assert.deepEqual(k.names, ["Maya"]);
  await kudos("noor", "e:kcUp"); k = cardIn(await feedOf("ana"), "e:kcUp").kudos; assert.equal(k.line, "You and Maya gave kudos");
  // signed out: the public feed shows the count too, and can't add to it
  const pub = await (await get("/api/public/feed")).json(); assert.equal(cardIn(pub.blend, "e:kcUp").kudos.count, 2); assert.equal(cardIn(pub.blend, "e:kcUp").kudos.mine, false);
  assert.equal((await post("/api/feed/kudos", { target: "e:kcUp" })).status, 401);
  await kudos("jun", "e:kcUp"); const pub2 = await (await get("/api/public/feed")).json(); assert.equal(cardIn(pub2.blend, "e:kcUp").kudos.count, 3, "the signed-out copy is rebuilt when kudos change");
});

test("Every card kind's target is accepted: event, interest check, recap, milestone, club post, members-only event", async () => {
  const B = await feedOf("ana"), kinds = {};
  for (const it of B.items) if (it.kudos?.target) (kinds[it.kind] ||= []).push(it);
  assert.ok(kinds.event?.some((e) => e.id === "kcIdea" && e.cta.label === "I'd go"), "the interest check is in the feed");
  assert.ok(kinds.recap?.some((r) => r.id === "kcPast"), "the recap is in the feed"); assert.ok(kinds.milestone?.length, "the milestone is in the feed"); assert.ok(kinds.club?.length, "the club post is in the feed");
  assert.ok(kinds.event.some((e) => e.id === "kcMembers" && e.members), "the members-only event is in the feed");
  clubTarget = kinds.club[0].kudos.target; msTarget = kinds.milestone[0].kudos.target;
  for (const it of Object.values(kinds).flat()) { const t = it.kudos.target, before = it.kudos.count, on = !it.kudos.mine, next = before + (on ? 1 : -1);
    assert.ok(it.comments && typeof it.comments.count === "number", `${it.kind} carries a comment count`);
    let j = await kudos("ana", t); assert.equal(j.status, 200, `${it.kind} ${t}: ${j.message || ""}`); assert.equal(j.target, t); assert.deepEqual([j.count, j.mine], [next, on], `${it.kind} counts ${on ? "up" : "down"}`);
    assert.equal(cardIn(await feedOf("ana"), t).kudos.count, next, `${it.kind} is right after a reload`);
    j = await kudos("ana", t); assert.deepEqual([j.count, j.mine], [before, !on], `${it.kind} goes back`); }
  // what has no card answers 404, and a club post is for members
  for (const t of ["e:kcPrivate", "r:kcPrivate", "e:nope", "r:kcUp", "e:kcPast", "m:nope", "club.crumb-kc|nope", "x:1", ""]) assert.equal((await kudos("noor", t)).status, 404, t);
  assert.equal((await kudos("noor", "e:kcMembers")).status, 404, "a members-only event is for members");
  assert.equal((await kudos("noor", clubTarget)).status, 404);
  assert.equal((await kudos("theo", clubTarget)).status, 403, "the host sees the post but the heart is the members'");
});

test("Kudos keep their limits", async () => {
  process.env.ENCORE_FEED_KUDOS_PER_HOUR = "3"; let last = 0;
  for (let i = 0; i < 5; i++) last = (await kudos("sam", "e:kcOpen")).status;
  assert.equal(last, 429);
});

test("Comments: add, list, the count and preview in the feed, delete your own, the host deletes any", async () => {
  assert.equal((await thread("noor", "e:kcUp")).count, 0);
  let a = await say("noor", "e:kcUp", "  See you there  "); assert.equal(a.status, 200); assert.equal(a.comment.text, "See you there"); assert.equal(a.comment.name, "Noor"); assert.equal(a.comment.mine, true); assert.equal(a.count, 1);
  const b = await say("maya", "e:kcUp", "Bringing rye."), c = await say("theo", "e:kcUp", "Doors at seven."); assert.equal(c.count, 3);
  // anyone who can see the card can read, signed in or not, oldest first, first names only
  for (const who of ["jun", ""]) { const T = await thread(who, "e:kcUp"); assert.equal(T.status, 200); assert.deepEqual(T.comments.map((x) => x.name + ": " + x.text), ["Noor: See you there", "Maya: Bringing rye.", "Theo: Doors at seven."]); assert.equal(T.canPost, !!who); assert.ok(!JSON.stringify(T).includes("@example.com"), "no emails"); }
  let T = await thread("noor", "e:kcUp"); assert.equal(T.title, "Winter Bread Supper"); assert.equal(T.comments[2].host, true, "the host's comment is marked");
  assert.deepEqual(T.comments.map((x) => x.canDelete), [true, false, false]); assert.ok(T.comments[1].key && !T.comments[0].key, "others carry a key for Report and Block; yours doesn't");
  // the feed: the count and the latest two, signed in and out
  let card = cardIn(await feedOf("jun"), "e:kcUp"); assert.equal(card.comments.count, 3); assert.deepEqual(card.comments.last.map((x) => `${x.name}: ${x.text}`), ["Maya: Bringing rye.", "Theo: Doors at seven."]);
  assert.equal(cardIn(await feedOf("maya"), "e:kcUp").comments.last[0].mine, true);
  assert.equal(cardIn((await (await get("/api/public/feed")).json()).blend, "e:kcUp").comments.count, 3);
  assert.equal((await (await get("/api/feed/social?targets=e:kcUp")).json()).items["e:kcUp"].comments.count, 3);
  // signed out can't write; nobody deletes someone else's; the writer and the host can
  assert.equal((await say("", "e:kcUp", "hi")).status, 401);
  assert.equal((await del(`/api/feed/comments/${b.comment.id}?target=e:kcUp`)).status, 401);
  assert.equal((await del(`/api/feed/comments/${b.comment.id}?target=e:kcUp`, U.noor.cookie)).status, 403);
  assert.equal((await del(`/api/feed/comments/nope?target=e:kcUp`, U.noor.cookie)).status, 404);
  let d = await del(`/api/feed/comments/${a.comment.id}?target=e:kcUp`, U.noor.cookie); assert.equal(d.status, 200); assert.equal((await d.json()).count, 2);
  T = await thread("theo", "e:kcUp"); assert.equal(T.host, true); assert.deepEqual(T.comments.map((x) => x.canDelete), [true, true], "the host may delete any comment on their post");
  d = await del(`/api/feed/comments/${b.comment.id}?target=e:kcUp`, U.theo.cookie); assert.equal(d.status, 200);
  assert.deepEqual((await thread("jun", "e:kcUp")).comments.map((x) => x.text), ["Doors at seven."]);
  assert.equal((await del(`/api/feed/comments/${c.comment.id}?target=e:kcUp`, U.kit.cookie)).status, 403, "another host isn't this post's host");
});

test("Comments work on every card kind, an event keeps one thread before and after its date, and the group chat link is for people in it", async () => {
  for (const t of ["e:kcIdea", "r:kcPast", msTarget, clubTarget, "e:kcMembers"]) { const j = await say("ana", t, "Lovely."); assert.equal(j.status, 200, `${t}: ${j.message || ""}`); assert.equal((await thread("ana", t)).count, 1, t); assert.equal(cardIn(await feedOf("ana"), t).comments.count, 1, t); }
  assert.equal(threadKey("e:abc"), "ev:abc"); assert.equal(threadKey("r:abc"), "ev:abc"); assert.equal(threadKey("m:h-1"), "m:h-1");
  assert.equal((await thread("ana", "e:kcPast")).count, 1, "a link made before the date still opens the thread after it");
  // Ana was there: the sheet offers the group chat next to the comments, never instead of them. Noor wasn't.
  assert.equal((await thread("ana", "r:kcPast")).chat, "/g#rsvp-kcPast"); assert.equal((await thread("noor", "r:kcPast")).chat, ""); assert.equal((await thread("", "r:kcPast")).chat, "");
  assert.equal(cardIn(await feedOf("ana"), "r:kcPast").chat, "/g#rsvp-kcPast");
});

test("Private and members-only cards keep their visibility for reading and writing", async () => {
  for (const who of ["noor", "kit", ""]) { assert.equal((await thread(who, "e:kcPrivate")).status, 404, "a private event has no card, so no thread: " + who); if (who) assert.equal((await say(who, "e:kcPrivate", "hello")).status, 404); }
  // members-only event and club post: members and the host, nobody else
  for (const t of ["e:kcMembers", clubTarget]) {
    for (const who of ["noor", ""]) { assert.equal((await thread(who, t)).status, 404, `${t} ${who}`); assert.equal((await say(who, t, "let me in")).status, who ? 404 : 401); }
    assert.equal((await thread("ana", t)).status, 200); const h = await say("theo", t, "Thanks all."); assert.equal(h.status, 200, "the host can answer on their own members post"); assert.equal(h.comment.host, true); }
  assert.ok(!("e:kcMembers" in (await (await get("/api/feed/social?targets=e:kcMembers", U.noor.cookie)).json()).items));
  assert.equal((await thread("noor", "nonsense")).status, 404); assert.equal((await thread("noor", "")).status, 404);
});

test("The host hears once per card an hour, never about their own comment", async () => {
  const inbox = async () => (await (await get("/api/me/inbox", U.theo.cookie)).json()).items.filter((n) => n.kind === "comment");
  const before0 = (await inbox()).length;
  await say("theo", "e:kcIdea", "Tell me which morning works."); assert.equal((await inbox()).length, before0, "not for the host's own comment");
  await say("jun", "e:kcIdea", "Saturday works for me"); await say("noor", "e:kcIdea", "Same here");
  const L = (await inbox()).filter((n) => /Apartment Cafe Morning/.test(n.text));
  assert.equal(L.length, 1, "batched: one line for the card, not one per comment"); assert.match(L[0].text, /^(Ana|Jun) commented on Apartment Cafe Morning: "/); assert.equal(L[0].link, "/feed?comments=" + encodeURIComponent("e:kcIdea"));
});

test("Blocks and reports: a blocked person's comments are hidden from the blocker; a hidden comment is gone for everyone", async () => {
  const a = await say("sam", "e:kcOpen", "First!"), b = await say("jun", "e:kcOpen", "Reading it this week."); assert.equal(b.count, 2);
  assert.ok((await post("/api/me/blocks", { kind: "person", key: key(U.sam.email), name: "Sam" }, U.noor.cookie)).ok);
  let T = await thread("noor", "e:kcOpen"); assert.deepEqual(T.comments.map((x) => x.text), ["Reading it this week."]); assert.equal(T.count, 1);
  const card = cardIn(await feedOf("noor"), "e:kcOpen"); assert.equal(card.comments.count, 1); assert.ok(!JSON.stringify(card.comments).includes("First!"));
  assert.equal((await thread("jun", "e:kcOpen")).count, 2, "everyone else still sees it");
  // a host who blocked someone isn't told about their comments
  assert.ok((await post("/api/me/blocks", { kind: "person", key: key(U.sam.email), name: "Sam" }, U.kit.cookie)).ok);
  const n0 = (await (await get("/api/me/inbox", U.kit.cookie)).json()).items.filter((n) => n.kind === "comment").length;
  await say("sam", "e:kcIdea", "hello"); await say("sam", "e:kcOpen", "Second!");
  assert.equal((await (await get("/api/me/inbox", U.kit.cookie)).json()).items.filter((n) => n.kind === "comment").length, n0);
  // report: the same queue and rules as other reported things; once the team (or three trusted reports) hides it, it's gone
  const r = await post("/api/report", { type: "comment", target: "comment:" + b.comment.id, reason: "spam", text: b.comment.text }, U.noor.cookie); assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  srv.app.locals.appstore.safety.hide("comment:" + b.comment.id, { by: "test" });
  T = await thread("jun", "e:kcOpen"); assert.ok(!T.comments.some((x) => x.id === b.comment.id), "hidden for everyone, the writer included");
  assert.ok(!JSON.stringify((await (await get("/api/public/feed")).json()).blend).includes("Reading it this week."));
  srv.app.locals.appstore.safety.unhide("comment:" + b.comment.id); assert.ok((await thread("jun", "e:kcOpen")).comments.some((x) => x.id === b.comment.id));
  assert.ok(a.comment.id);
});

test("Length, empty text, strong language, contact details and rate limits", async () => {
  assert.equal(COMMENT_MAX, 500);
  assert.equal((await say("jun", "e:kcOpen", "x".repeat(500))).status, 200, "500 characters fit");
  const long = await say("jun", "e:kcOpen", "x".repeat(501)); assert.equal(long.status, 400); assert.equal(long.code, "too_long");
  for (const t of ["", "   ", "\n\n", null, 42, { a: 1 }]) assert.equal((await say("jun", "e:kcOpen", t)).status, 400, JSON.stringify(t));
  assert.equal((await say("jun", "e:kcOpen", "this is shit")).code, "language");
  assert.equal((await say("jun", "e:kcOpen", "text me on 415 555 0199")).code, "contact_info");
  assert.equal(tidy("  a\u0000b \n\n\n c  "), "a b\nc");
  // per person
  process.env.ENCORE_FEED_COMMENTS_PER_HOUR = "3"; let codes = [];
  for (let i = 0; i < 5; i++) codes.push((await say("kit", "e:kcOpen", "note " + i)).status);
  assert.deepEqual(codes, [200, 200, 200, 429, 429]);
  // per IP (everyone here shares one)
  process.env.ENCORE_FEED_COMMENTS_PER_HOUR = "500"; process.env.ENCORE_FEED_COMMENTS_PER_IP_HOUR = "1";
  assert.equal((await say("ana", "e:kcOpen", "one more")).status, 429);
});

test("Plain text only: markup is kept as words by the server and escaped by the page", async () => {
  const evil = `<img src=x onerror=alert(1)> <b>hi</b> & "quotes"`;
  const j = await say("ana", "e:kcOpen", evil); assert.equal(j.status, 200); assert.equal(j.comment.text, evil, "stored and sent as the words typed, never as markup");
  const card = cardIn(await feedOf("ana"), "e:kcOpen"); assert.equal(card.comments.last.at(-1).text, evil);
  // the feed's own renderer, run on that card: no tag survives
  const win = { addEventListener() {}, matchMedia: () => ({ matches: false }) }, doc = { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, body: { classList: { contains: () => false } }, cookie: "" };
  const ctx = vm.createContext({ window: win, document: doc, localStorage: { getItem: () => null, setItem() {} }, sessionStorage: { getItem: () => null, setItem() {} }, matchMedia: win.matchMedia, location: { pathname: "/feed", search: "", origin: "" }, navigator: {}, console, setTimeout, clearTimeout, URLSearchParams, CSS: { escape: (s) => s } });
  vm.runInContext(fs.readFileSync(new URL("../public/feedvisual.js", import.meta.url), "utf8"), ctx);
  const html = ctx.window.FeedVisual.blendHtml({ items: [{ ...card, kudos: { ...card.kudos, count: 3, line: "<i>x</i>" } }] }, { signedIn: true });
  assert.ok(!/<img src=x|<b>hi<\/b>|<i>x<\/i>/.test(html), "nothing typed becomes a tag"); assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt; &lt;b&gt;hi&lt;/b&gt; &amp; &quot;quotes&quot;"));
  // the card: the count on the Kudos button, a Comment button with its count, the preview and "View all"
  assert.match(html, /data-fb-kudos="e:kcOpen"[^>]*>[\s\S]*?<span>Kudos<\/span><i class="fb-n" data-fb-kn>3<\/i>/);
  assert.match(html, new RegExp(`<button type="button" class="fb-act" data-fb-comment="e:kcOpen"[^>]*>[\\s\\S]*?<span>Comment</span><i class="fb-n" data-fb-cn="e:kcOpen">${card.comments.count}</i>`));
  assert.match(html, new RegExp(`View all ${card.comments.count} comments`));
  // signed out: Comment goes to sign in, and comes back to the feed
  const out = ctx.window.FeedVisual.blendHtml({ items: [card] }, { signedIn: false }); assert.match(out, /<a class="fb-act" href="\/login\?next=%2Ffeed">[\s\S]*?<span>Comment<\/span>/);
  // the sheet escapes every comment it draws, and carries Report and Block for other people's
  const sheet = fs.readFileSync(new URL("../public/feedcomments.js", import.meta.url), "utf8");
  assert.match(sheet, /<p class="fcm-t">\$\{esc\(c\.text\)\}<\/p>/); assert.match(sheet, /<b>\$\{esc\(c\.name \|\| "Someone"\)\}<\/b>/); assert.match(sheet, /data-report="\$\{esc\(JSON\.stringify\(\{ type: "comment", target: "comment:" \+ c\.id/);
  assert.match(sheet, /Open the group chat/); assert.ok(!/—/.test(sheet + fs.readFileSync(new URL("../server/feedcomments.js", import.meta.url), "utf8")), "no em dashes");
});

// review round 19: walked in a browser as a guest and as the host, at 390 and 1280
test("A members-first date is still on its own host's feed, with its kudos and comments", async () => {
  assert.equal((await put("events/kcEarly", { kind: "social", casual: true, city: "Brooklyn", discoverable: true, published: true, name: "Rye Loaf Night", activity: "supper", date: day(5) }, U.theo.cookie)).status, 200);
  assert.ok((await post("/api/host/club/events/kcEarly", { visibility: "early" }, U.theo.cookie)).ok);
  const mine = cardIn(await feedOf("theo"), "e:kcEarly"); assert.ok(mine, "the host sees their own card"); assert.equal(mine.cta.label, "Manage");
  assert.equal(cardIn(await feedOf("sam"), "e:kcEarly"), undefined, "someone outside the club still waits");
  assert.equal((await kudos("sam", "e:kcEarly")).status, 404); assert.equal((await say("theo", "e:kcEarly", "Members get this one first.")).status, 200);
});
test("A comment in the host's Inbox keeps its own full stops: who and where on the line, the words as the preview", async () => {
  const { linesOf } = await import("../server/inbox.js");
  const r = linesOf({ kind: "comment", text: 'Sam commented on Dumpling night: pork and chive: "Bringing my own chilli oil. See you Thursday."' });
  assert.equal(r.line, "Sam commented on Dumpling night: pork and chive"); assert.equal(r.preview, "Bringing my own chilli oil. See you Thursday.");
});
test("Feed cards: a double tap is one kudos, 44px targets and 6px corners on the comment sheet", () => {
  const fv = fs.readFileSync(new URL("../public/feedvisual.js", import.meta.url), "utf8"), fc = fs.readFileSync(new URL("../public/feedcomments.js", import.meta.url), "utf8");
  assert.match(fv, /if \(Date\.now\(\) - \(tapped\.get\(t\) \|\| 0\) < 500\) return;/);
  assert.match(fv, /\.fb-follow-in\{flex:none;min-height:44px;[^}]*border-radius:var\(--pl-r-btn,6px\)/); assert.match(fv, /\.fb-title a\{display:block;padding:6px 0;margin:-6px 0/);
  assert.doesNotMatch(fc, /border-radius:(1\d|2\d)px/, "the sheet, its field and Send are on the kit's 6px"); assert.match(fc, /\.fcm-send\{[^}]*min-height:44px[^}]*border-radius:var\(--pl-r-btn,6px\)/);
});
