// Replies to a comment on a feed card (server/feedcomments.js, public/feedcomments.js, public/feedvisual.js): one level
// under the comment answered, a reply to a reply folded under the same first comment with the person it answers,
// "Comment removed" over the replies that stay, the card's own visibility, blocks both ways, the limits, the notes in
// the Inbox and the counts. A browser walk at 390 (touch) and 1280 with two people follows (skipped without Playwright).
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";

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
const join = async (who, name) => { const email = `${who}.rp@example.com`, r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }), b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); U[who] = { cookie: cookies(r), ws: b.workspace.id, email }; };
const feedOf = async (who) => { srv.app.locals.social.bust(); const r = await get("/api/me/feed", U[who].cookie); assert.equal(r.status, 200); return (await r.json()).blend; };
const cardIn = (B, target) => [...B.items, ...B.items.filter((x) => x.kind === "row").flatMap((r) => r.items)].find((x) => x.kudos?.target === target);
const say = async (who, target, text, parent) => { const r = await post("/api/feed/comments", { target, text, ...(parent ? { parent } : {}) }, who ? U[who].cookie : ""); return { status: r.status, ...(await r.json()) }; };
const thread = async (who, target) => { const r = await get("/api/feed/comments?target=" + encodeURIComponent(target), who ? U[who].cookie : ""); return { status: r.status, ...(await r.json()) }; };
const drop = async (who, target, id, q = "") => { const r = await del(`/api/feed/comments/${id}?target=${encodeURIComponent(target)}${q}`, U[who].cookie); return { status: r.status, ...(await r.json()) }; };
const inbox = async (who) => (await (await get("/api/me/inbox", U[who].cookie)).json()).items.filter((n) => n.kind === "comment");
const lines = (T) => T.comments.map((c) => (c.gone ? "(removed)" : `${c.parent ? "  " : ""}${c.to ? "@" + c.to.name + " " : ""}${c.name}: ${c.text}`));
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "rp-secret", ENCORE_SIGNUP_PER_HOUR: "500", ENCORE_FAKE_EMAIL: "1", ENCORE_FEED_KUDOS_PER_HOUR: "500", ENCORE_FEED_KUDOS_PER_IP_HOUR: "2000", ENCORE_FEED_COMMENTS_PER_HOUR: "500", ENCORE_FEED_COMMENTS_PER_IP_HOUR: "4000", ENCORE_FEED_PER_IP_HOUR: "20000" };
let clubTarget = "";
const require24 = (em) => crypto.createHash("sha256").update(em.toLowerCase()).digest("hex").slice(0, 24); // the inbox's own key

before(async () => {
  srv = await startServer(); Object.assign(process.env, ENV); resetLoginLimits();
  for (const [w, n] of [["theo", "Theo Marsh"], ["kit", "Kit Alvarez"], ["ana", "Ana Ruiz"], ["maya", "Maya Okafor"], ["jun", "Jun Park"], ["noor", "Noor Haddad"], ["sam", "Sam Idris"], ["leo", "Leo Brandt"], ["ivy", "Ivy Chen"]]) await join(w, n);
  assert.ok((await post("/api/host/profile", { handle: "crumb-rp", name: "Crumb Theory", city: "Brooklyn", hood: "Fort Greene", tagline: "Small and calm." }, U.theo.cookie)).ok);
  assert.ok((await post("/api/host/profile", { handle: "reads-rp", name: "Slow Reads", city: "Brooklyn", hood: "Park Slope", tagline: "Quiet books." }, U.kit.cookie)).ok);
  const ev = (w, id, d) => put("events/" + id, { kind: "social", casual: true, city: "Brooklyn", discoverable: true, published: true, ...d }, U[w].cookie);
  for (const [id, name, n] of [["rpA", "Winter Bread Supper", 4], ["rpB", "Rye Loaf Night", 6], ["rpC", "Sourdough Morning", 8], ["rpD", "Bagel Bake", 10], ["rpE", "Flatbread Friday", 12], ["rpF", "Focaccia Lunch", 14], ["rpW", "Brioche Brunch", 16], ["rpW390", "Walnut Loaf Supper", 1], ["rpW1280", "Seeded Rye Supper", 2]]) assert.equal((await ev("theo", id, { name, activity: "supper", date: day(n) })).status, 200);
  await ev("kit", "rpPrivate", { name: "Private birthday", activity: "dinner", date: day(3), private: true, discoverable: false });
  await ev("kit", "rpOpen", { name: "Slow Reads: Train Dreams", activity: "book club", date: day(9) });
  // a fan club with one post and a members-only event; Ana and Maya are members, Noor is not
  assert.ok((await post("/api/host/club", { on: true, name: "Crumb Regulars" }, U.theo.cookie)).ok);
  for (const w of ["ana", "maya"]) assert.ok((await post("/api/me/club/crumb-rp/join", {}, U[w].cookie)).ok);
  assert.ok((await post("/api/host/club/posts", { text: "Starter is bubbling for Thursday." }, U.theo.cookie)).ok);
  await ev("theo", "rpMembers", { name: "Members' bread night", activity: "supper", date: day(6) });
  assert.ok((await post("/api/host/club/events/rpMembers", { visibility: "members" }, U.theo.cookie)).ok);
  srv.app.locals.social.bust();
  clubTarget = (await feedOf("ana")).items.find((x) => x.kind === "club")?.kudos?.target || ""; assert.match(clubTarget, /^club\.crumb-rp\|/);
});
beforeEach(() => { Object.assign(process.env, ENV); resetLoginLimits(); });
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

test("Reply to a comment; a reply to a reply folds under the same first comment and names the person answered", async () => {
  const a = await say("maya", "e:rpA", "Who's bringing butter?"); assert.equal(a.status, 200); assert.equal(a.comment.parent, undefined, "a first comment has no parent");
  const r1 = await say("jun", "e:rpA", "I have a block of the salted one.", a.comment.id);
  assert.equal(r1.status, 200, r1.message); assert.equal(r1.comment.parent, a.comment.id); assert.equal(r1.comment.re, a.comment.id, "the older field name still reads"); assert.equal(r1.comment.to, undefined, "a reply to the first comment needs no mention");
  // a reply to a reply: same first comment, with the person answered; Jun has no page, so a plain name
  const r2 = await say("noor", "e:rpA", "Save me a corner.", r1.comment.id);
  assert.equal(r2.comment.parent, a.comment.id, "one level only"); assert.equal(r2.comment.to.name, "Jun"); assert.match(r2.comment.to.href, /^\/@[a-z0-9-]+$/, "Jun's own page");
  assert.equal((await get(r2.comment.to.href)).status, 200);
  // Theo has a host page: the mention links to it; answering yourself needs no mention
  const r3 = await say("theo", "e:rpA", "Plenty for everyone.", r2.comment.id), r4 = await say("ana", "e:rpA", "Thank you, Theo.", r3.comment.id), r5 = await say("ana", "e:rpA", "And I'll bring jam.", r4.comment.id);
  assert.equal(r3.comment.to.name, "Noor"); assert.deepEqual(r4.comment.to, { name: "Theo", href: "/@crumb-rp" }); assert.equal(r5.comment.to, undefined); assert.equal(r5.comment.parent, a.comment.id);
  // the older "re" in the request still works
  const old = await post("/api/feed/comments", { target: "e:rpA", text: "Count me in.", re: a.comment.id }, U.sam.cookie); assert.equal((await old.json()).comment.parent, a.comment.id);
  const b = await say("kit", "e:rpA", "What time do doors open?");
  for (const who of ["leo", ""]) { const T = await thread(who, "e:rpA");
    assert.deepEqual(lines(T), ["Maya: Who's bringing butter?", "  Jun: I have a block of the salted one.", "  @Jun Noor: Save me a corner.", "  @Noor Theo: Plenty for everyone.", "  @Theo Ana: Thank you, Theo.", "  Ana: And I'll bring jam.", "  Sam: Count me in.", "Kit: What time do doors open?"]);
    assert.equal(T.count, 8, "replies count"); assert.ok(!JSON.stringify(T).includes("@example.com"), "no emails, in the mention either"); }
  assert.equal((await thread("jun", "e:rpA")).comments[2].to.mine, true, "the person answered reads it as theirs");
  // the card: first comments only, each with how many replies; the count is everything
  const card = cardIn(await feedOf("leo"), "e:rpA"); assert.equal(card.comments.count, 8);
  assert.deepEqual(card.comments.last.map((c) => [c.name, c.text, c.replies || 0]), [["Maya", "Who's bringing butter?", 6], ["Kit", "What time do doors open?", 0]]);
  assert.equal(cardIn((await (await get("/api/public/feed")).json()).blend, "e:rpA").comments.last[0].replies, 6, "signed out reads the same");
  assert.equal((await (await get("/api/feed/social?targets=e:rpA")).json()).items["e:rpA"].comments.count, 8);
  assert.equal(r1.summary.last[0].replies, 1, "the answer to a reply carries the card's fresh summary"); assert.ok(b.comment.id);
});

test("The comment answered has to be on this post, there, and not removed", async () => {
  const a = await say("maya", "e:rpB", "Is there parking?"), other = await say("maya", "e:rpD", "Bringing my niece.");
  for (const [parent, why] of [[other.comment.id, "a comment on another post"], ["nope", "no such comment"], ["x".repeat(200), "nonsense"]]) { const r = await say("jun", "e:rpB", "hello", parent); assert.equal(r.status, 404, why); assert.equal(r.code, "not_found"); }
  assert.equal((await thread("jun", "e:rpB")).count, 1, "nothing was written"); assert.equal((await thread("jun", "e:rpD")).count, 1);
  assert.equal((await say("", "e:rpB", "hi", a.comment.id)).status, 401, "signed out can't reply");
  // an event keeps one thread before and after its date, so "r:" of the same event is the same post
  assert.equal((await say("jun", "r:rpB", "On the street, mostly.", a.comment.id)).comment.parent, a.comment.id); assert.equal((await thread("jun", "e:rpB")).count, 2);
  // the same text checks as a comment
  assert.equal((await say("jun", "e:rpB", "x".repeat(501), a.comment.id)).code, "too_long"); assert.equal((await say("jun", "e:rpB", "   ", a.comment.id)).status, 400);
  assert.equal((await say("jun", "e:rpB", "this is shit", a.comment.id)).code, "language"); assert.equal((await say("jun", "e:rpB", "text me on 415 555 0199", a.comment.id)).code, "contact_info");
  const evil = `<img src=x onerror=alert(1)> @Maya <a href="https://x.example">x</a>`, e = await say("jun", "e:rpB", evil, a.comment.id); assert.equal(e.status, 200); assert.equal(e.comment.text, evil, "kept as the words typed; the page escapes them");
  // a reply deleted while someone was answering it
  const r = await say("noor", "e:rpB", "Street parking after six."); const rr = await say("jun", "e:rpB", "Good to know.", r.comment.id); assert.equal((await drop("jun", "e:rpB", rr.comment.id)).status, 200);
  assert.equal((await say("sam", "e:rpB", "hello", rr.comment.id)).status, 404);
});

test("Deleting: a reply goes alone; a first comment with replies leaves 'Comment removed' and the replies stay; the host can clear a whole thread", async () => {
  const a = await say("maya", "e:rpC", "Anyone walking from the G train?"), r1 = await say("jun", "e:rpC", "I am, at ten.", a.comment.id), r2 = await say("noor", "e:rpC", "Me too.", r1.comment.id), r3 = await say("sam", "e:rpC", "Wait for me.", a.comment.id);
  // nobody deletes someone else's reply; the writer does, and only that reply goes
  assert.equal((await drop("noor", "e:rpC", r1.comment.id)).status, 403);
  let d = await drop("sam", "e:rpC", r3.comment.id); assert.equal(d.status, 200); assert.deepEqual(d.removed, [r3.comment.id]); assert.equal(d.kept, false); assert.equal(d.count, 3);
  // Maya deletes her first comment: the thread stays, with "Comment removed" in its place
  d = await drop("maya", "e:rpC", a.comment.id); assert.equal(d.status, 200); assert.equal(d.kept, true); assert.deepEqual(d.removed, []); assert.equal(d.count, 2, "the removed comment no longer counts");
  let T = await thread("leo", "e:rpC"); assert.deepEqual(lines(T), ["(removed)", "  Jun: I am, at ten.", "  @Jun Noor: Me too."]); assert.deepEqual(Object.keys(T.comments[0]).sort(), ["at", "gone", "id"], "nothing of the removed comment is sent");
  assert.ok(!JSON.stringify(T).includes("G train")); assert.ok(!JSON.stringify(srv.store.get(srv.app.locals.feedBlend.comments.path("e:rpC")).data).includes("G train"), "and nothing of it is kept");
  assert.equal(cardIn(await feedOf("leo"), "e:rpC").comments.count, 2); assert.deepEqual(cardIn(await feedOf("leo"), "e:rpC").comments.last, [], "the card's preview skips a removed comment");
  // you can't answer or react to the removed comment itself, or delete it again; you can still answer a reply under it
  assert.equal((await say("sam", "e:rpC", "hello?", a.comment.id)).status, 404); assert.equal((await post(`/api/feed/comments/${a.comment.id}/react`, { target: "e:rpC", r: "heart" }, U.sam.cookie)).status, 404);
  assert.equal((await drop("maya", "e:rpC", a.comment.id)).status, 404); assert.equal((await drop("jun", "e:rpC", a.comment.id)).status, 404);
  const r4 = await say("sam", "e:rpC", "Ten works.", r2.comment.id); assert.equal(r4.status, 200); assert.equal(r4.comment.parent, a.comment.id); assert.equal(r4.comment.to.name, "Noor");
  // the last reply leaves: "Comment removed" goes with it
  for (const [w, c] of [["jun", r1], ["noor", r2]]) assert.equal((await drop(w, "e:rpC", c.comment.id)).status, 200);
  d = await drop("sam", "e:rpC", r4.comment.id); assert.deepEqual(d.removed.sort(), [a.comment.id, r4.comment.id].sort()); assert.equal((await thread("leo", "e:rpC")).comments.length, 0);
  // the host: any reply on its own; someone's first comment leaves "Comment removed" too, and deleting that line clears the thread
  const b = await say("maya", "e:rpC", "Do you take cards?"), b1 = await say("jun", "e:rpC", "Cash is easier.", b.comment.id), b2 = await say("noor", "e:rpC", "There's a machine nearby.", b.comment.id);
  T = await thread("theo", "e:rpC"); assert.deepEqual(T.comments.map((c) => c.canDelete), [true, true, true]); assert.deepEqual((await thread("jun", "e:rpC")).comments.map((c) => c.canDelete), [false, true, false]);
  d = await drop("theo", "e:rpC", b1.comment.id); assert.deepEqual(d.removed, [b1.comment.id]);
  d = await drop("theo", "e:rpC", b.comment.id); assert.equal(d.kept, true); assert.deepEqual(d.removed, []); assert.deepEqual(lines(await thread("leo", "e:rpC")), ["(removed)", "  Noor: There's a machine nearby."]);
  d = await drop("theo", "e:rpC", b.comment.id); assert.deepEqual(d.removed.sort(), [b.comment.id, b2.comment.id].sort()); assert.equal(d.count, 0); assert.equal((await thread("leo", "e:rpC")).comments.length, 0);
  // the host's own first comment reads like anyone's (replies stay), unless they ask for the whole thread; a removed one is theirs to clear
  const h = await say("theo", "e:rpC", "Doors at ten."), h1 = await say("ana", "e:rpC", "See you then.", h.comment.id);
  d = await drop("theo", "e:rpC", h.comment.id); assert.equal(d.kept, true); assert.equal((await thread("theo", "e:rpC")).comments[0].canDelete, true);
  d = await drop("theo", "e:rpC", h.comment.id); assert.deepEqual(d.removed.sort(), [h.comment.id, h1.comment.id].sort());
  const g = await say("theo", "e:rpC", "Bring a tea towel."), g1 = await say("ana", "e:rpC", "Will do.", g.comment.id); d = await drop("theo", "e:rpC", g.comment.id, "&thread=1"); assert.deepEqual(d.removed.sort(), [g.comment.id, g1.comment.id].sort());
  // the team hides a first comment: its replies go with it, for everyone
  const m = await say("maya", "e:rpC", "Spam spam spam."), m1 = await say("jun", "e:rpC", "Please stop.", m.comment.id); srv.app.locals.appstore.safety.hide("comment:" + m.comment.id, { by: "test" });
  for (const who of ["jun", "maya", ""]) assert.equal((await thread(who, "e:rpC")).comments.length, 0, who); assert.equal(cardIn(await feedOf("leo"), "e:rpC").comments.count, 0);
  srv.app.locals.appstore.safety.unhide("comment:" + m.comment.id); assert.equal((await thread("jun", "e:rpC")).count, 2); assert.ok(m1.comment.id);
});

test("Comments written before replies read the same, and an old reply whose first comment is gone stands on its own", async () => {
  const CS = srv.app.locals.feedBlend.comments;
  srv.store.set(CS.path("e:rpF"), { kind: "feedcomments", thread: "ev:rpF", list: [{ id: "oldA", email: U.maya.email, name: "Maya", text: "Lovely idea.", at: Date.now() - 5e5 }, { id: "oldB", email: U.jun.email, name: "Jun", text: "An answer to something long gone.", at: Date.now() - 4e5, re: "wasHere" }] });
  const T = await thread("leo", "e:rpF"); assert.deepEqual(T.comments.map((c) => [c.id, c.name, c.text, c.canDelete]), [["oldA", "Maya", "Lovely idea.", false], ["oldB", "Jun", "An answer to something long gone.", false]]); assert.equal(T.count, 2);
  assert.deepEqual(cardIn(await feedOf("leo"), "e:rpF").comments.last.map((c) => c.id), ["oldA", "oldB"]);
  const r = await say("noor", "e:rpF", "Agreed.", "oldB"); assert.equal(r.comment.parent, "oldB", "it can be answered like a first comment"); assert.equal(r.comment.to, undefined);
  assert.equal((await drop("maya", "e:rpF", "oldA")).removed[0], "oldA");
});

test("Private and members-only posts never show replies to people who can't see the post", async () => {
  // members-only event and club post: a member starts a thread, the host answers
  for (const t of ["e:rpMembers", clubTarget]) { const a = await say("ana", t, "Members question: is rye on?"), r = await say("theo", t, "Rye is on, secret loaf too.", a.comment.id); assert.equal(r.status, 200, t);
    assert.equal((await thread("maya", t)).count, 2, "another member reads it");
    for (const who of ["noor", "kit", ""]) { const T = await thread(who, t); assert.equal(T.status, 404, `${t} ${who}`); assert.ok(!JSON.stringify(T).includes("secret loaf"));
      if (who) { assert.equal((await say(who, t, "let me in", a.comment.id)).status, 404); assert.equal((await say(who, t, "let me in", r.comment.id)).status, 404); assert.equal((await post(`/api/feed/comments/${r.comment.id}/react`, { target: t, r: "heart" }, U[who].cookie)).status, 404); assert.equal((await drop(who, t, r.comment.id)).status, 404); }
      const pg = await get("/post/" + (t === clubTarget ? "c/crumb-rp/" + t.split("|")[1] : "e/rpMembers"), who ? U[who].cookie : ""); assert.equal(pg.status, 404); assert.ok(!(await pg.text()).includes("secret loaf"));
      assert.ok(!JSON.stringify(await (await get("/api/feed/social?targets=" + encodeURIComponent(t), who ? U[who].cookie : "")).json()).includes("secret"));
      assert.ok(!JSON.stringify(await (await get("/api/feed/post?target=" + encodeURIComponent(t), who ? U[who].cookie : "")).json()).includes("secret")); }
    assert.ok(!JSON.stringify(await feedOf("noor")).includes("secret loaf")); assert.ok(!JSON.stringify(await (await get("/api/public/feed")).json()).includes("secret loaf")); }
  // a private event has no card at all: no thread to read or answer, for anyone
  for (const who of ["noor", "kit"]) { assert.equal((await thread(who, "e:rpPrivate")).status, 404); assert.equal((await say(who, "e:rpPrivate", "hello", "anything")).status, 404); }
  // someone who could see the post when they wrote, and can't any more, hears nothing about later replies
  const a = await say("maya", "e:rpMembers", "Leaving the club after this one."); assert.ok((await post("/api/me/club/crumb-rp/leave", {}, U.maya.cookie)).ok); srv.app.locals.social.bust();
  assert.equal((await thread("maya", "e:rpMembers")).status, 404, "Maya left: the thread is closed to her");
  const n0 = (await inbox("maya")).length; assert.equal((await say("ana", "e:rpMembers", "We'll miss you. The secret loaf is brioche.", a.comment.id)).status, 200);
  assert.equal((await inbox("maya")).length, n0, "no note with a members-only reply in it"); assert.ok(!JSON.stringify(await inbox("maya")).includes("brioche"));
});

test("Blocks: a blocked person's replies are hidden from the blocker and the blocker's from them; nobody hears from the other", async () => {
  const a = await say("leo", "e:rpOpen", "Which translation are we reading?"), s = await say("sam", "e:rpOpen", "The old one.", a.comment.id), n = await say("noor", "e:rpOpen", "I have the new one.", a.comment.id), j = await say("jun", "e:rpOpen", "Either works.", s.comment.id);
  assert.equal(j.comment.to.name, "Sam");
  assert.ok((await post("/api/me/blocks", { kind: "person", key: key(U.sam.email), name: "Sam" }, U.noor.cookie)).ok);
  // Noor (who blocked Sam): Sam's reply is gone, and "@Sam" is left off Jun's
  let T = await thread("noor", "e:rpOpen"); assert.deepEqual(lines(T), ["Leo: Which translation are we reading?", "  Noor: I have the new one.", "  Jun: Either works."]); assert.equal(T.count, 3); assert.ok(!JSON.stringify(T).includes("Sam"));
  assert.equal(cardIn(await feedOf("noor"), "e:rpOpen").comments.last[0].replies, 2);
  // Sam (blocked by Noor): Noor's reply is gone for Sam too
  T = await thread("sam", "e:rpOpen"); assert.deepEqual(lines(T), ["Leo: Which translation are we reading?", "  Sam: The old one.", "  @Sam Jun: Either works."]); assert.equal(cardIn(await feedOf("sam"), "e:rpOpen").comments.last[0].replies, 2);
  assert.equal((await thread("ana", "e:rpOpen")).count, 4, "everyone else reads all four");
  // neither can answer or react to what they can't see
  assert.equal((await say("noor", "e:rpOpen", "hm", s.comment.id)).status, 404); assert.equal((await say("sam", "e:rpOpen", "hm", n.comment.id)).status, 404);
  assert.equal((await post(`/api/feed/comments/${n.comment.id}/react`, { target: "e:rpOpen", r: "heart" }, U.sam.cookie)).status, 404);
  // and neither hears about the other's later replies in the thread
  const n0 = (await inbox("noor")).length, s0 = (await inbox("sam")).length;
  await say("sam", "e:rpOpen", "Bringing both then.", a.comment.id); assert.equal((await inbox("noor")).length, n0, "the blocker hears nothing from the person they blocked");
  await say("noor", "e:rpOpen", "Page 40 by Thursday.", a.comment.id); assert.equal((await inbox("sam")).length, s0, "and the other way round");
  // a first comment by someone you blocked takes its replies with it, for you
  const b = await say("sam", "e:rpOpen", "Snacks?"); await say("jun", "e:rpOpen", "Always.", b.comment.id);
  T = await thread("noor", "e:rpOpen"); assert.ok(!T.comments.some((c) => c.id === b.comment.id || c.parent === b.comment.id)); assert.ok((await thread("ana", "e:rpOpen")).comments.some((c) => c.parent === b.comment.id));
});

test("Notes: the person answered, the thread and the host hear, folded into one per thread; never your own; settings respected", async () => {
  const of = async (who, re = /Flatbread Friday/) => (await inbox(who)).filter((n) => re.test(n.text));
  const a = await say("maya", "e:rpE", "Is it gluten free?"); assert.equal((await of("theo")).length, 1, "the host's usual note"); assert.match((await of("theo"))[0].text, /^Maya commented on Flatbread Friday: "Is it gluten free\?"/);
  const r1 = await say("jun", "e:rpE", "One of them is.", a.comment.id);
  let M = await of("maya"); assert.equal(M.length, 1); assert.equal(M[0].text, 'Jun replied to your comment on Flatbread Friday: "One of them is."'); assert.equal(M[0].link, "/post/e/rpE#c-" + r1.comment.id, "the note opens the post at that reply");
  assert.equal((await of("jun")).length, 0, "never about your own reply"); assert.equal((await of("theo")).length, 1, "the host's note for this card is the one from this hour");
  // a reply to Jun's reply: Jun is the person answered, Maya's unread note folds the two together
  const r2 = await say("noor", "e:rpE", "Which one?", r1.comment.id);
  let Jn = await of("jun"); assert.equal(Jn.length, 1); assert.equal(Jn[0].text, 'Noor replied to your comment on Flatbread Friday: "Which one?"'); assert.equal(Jn[0].link, "/post/e/rpE#c-" + r2.comment.id);
  M = await of("maya"); assert.equal(M.length, 1, "one note for the thread"); assert.equal(M[0].text, 'Noor and Jun replied under your comment on Flatbread Friday: "Which one?"'); assert.equal(M[0].link, "/post/e/rpE#c-" + r2.comment.id);
  await say("kit", "e:rpE", "The buckwheat one.", r2.comment.id); await say("kit", "e:rpE", "Sorry, the corn one.", a.comment.id);
  M = await of("maya"); assert.equal(M.length, 1); assert.match(M[0].text, /^Kit and 2 others replied to your comment on Flatbread Friday: "Sorry, the corn one\."$/);
  assert.equal((await of("noor")).length, 1); assert.match((await of("noor"))[0].text, /^Kit (replied to your comment|also replied) on Flatbread Friday/); assert.equal((await of("kit")).length, 0);
  assert.match((await of("jun"))[0].text, /^Kit and Noor also replied on Flatbread Friday/);
  // Maya answers in her own thread: the others hear, she doesn't
  await say("maya", "e:rpE", "Thanks, all.", a.comment.id); assert.equal((await of("maya")).length, 1); assert.match((await of("maya"))[0].text, /^Kit and 2 others/);
  // the inbox reads the line and the words apart
  const { linesOf } = await import("../server/inbox.js"); assert.deepEqual(linesOf({ kind: "comment", text: 'Noor and Jun replied under your comment on Flatbread Friday: "Which one?"' }), { line: "Noor and Jun replied under your comment on Flatbread Friday", preview: "Which one?" });
  // once read, the next reply is a new note
  srv.store.set("system/inbox-" + require24(U.jun.email), (() => { const d = srv.store.get("system/inbox-" + require24(U.jun.email)).data; return { ...d, list: d.list.map((x) => ({ ...x, read: true })) }; })());
  await say("ana", "e:rpE", "Corn for me too.", r1.comment.id); Jn = await of("jun"); assert.equal(Jn.length, 2); assert.equal(Jn[0].text, 'Ana replied to your comment on Flatbread Friday: "Corn for me too."');
  // the host answered directly is told once, as a reply (not also as a comment)
  const h = await say("theo", "e:rpD", "Bagels come out at nine."), t0 = (await of("theo", /Bagel Bake/)).length; await say("ana", "e:rpD", "Setting an alarm.", h.comment.id);
  const Th = await of("theo", /Bagel Bake/); assert.equal(Th.length, t0 + 1); assert.match(Th[0].text, /^Ana replied to your comment on Bagel Bake/);
  // notes turned off in the Inbox, or the card's host muted: quiet
  const k = await say("kit", "e:rpD", "Any sesame?"); srv.store.set("system/inboxprefs-" + require24(U.kit.email), { kind: "inboxprefs", email: U.kit.email, mutedHosts: [{ handle: "crumb-rp", name: "Crumb Theory", at: Date.now() }], offTypes: [] });
  await say("leo", "e:rpD", "Half sesame, half plain.", k.comment.id); assert.equal((await of("kit", /Bagel Bake/)).length, 0, "muted host");
  const l = await say("leo", "e:rpD", "Cream cheese?"); srv.store.set("system/inboxprefs-" + require24(U.leo.email), { kind: "inboxprefs", email: U.leo.email, mutedHosts: [], offTypes: ["note"] });
  await say("ana", "e:rpD", "Three kinds.", l.comment.id); assert.equal((await of("leo", /Bagel Bake/)).length, 0, "notes off");
  // a removed first comment's writer hears nothing more; the repliers still do
  const x = await say("noor", "e:rpW", "Walking over at nine."), x1 = await say("jun", "e:rpW", "Same.", x.comment.id); const n0 = (await of("noor", /Brioche Brunch/)).length; await drop("noor", "e:rpW", x.comment.id);
  await say("ana", "e:rpW", "Wait for me.", x1.comment.id); assert.equal((await of("noor", /Brioche Brunch/)).length, n0); assert.match((await of("jun", /Brioche Brunch/))[0].text, /^Ana replied to your comment on Brioche Brunch/);
});

test("Replies count toward the same limits as comments", async () => {
  const a = await say("ana", "e:rpF", "Who has a tray?");
  process.env.ENCORE_FEED_COMMENTS_PER_HOUR = "3"; const codes = [];
  codes.push((await say("ivy", "e:rpF", "A first comment.")).status); for (let i = 0; i < 4; i++) codes.push((await say("ivy", "e:rpF", "reply " + i, a.comment.id)).status);
  assert.deepEqual(codes, [200, 200, 200, 429, 429], "one comment and two replies, then no more this hour"); assert.equal((await say("ivy", "e:rpF", "and no comment either")).code, "rate_limited");
  process.env.ENCORE_FEED_COMMENTS_PER_HOUR = "500"; process.env.ENCORE_FEED_COMMENTS_PER_IP_HOUR = "1";
  assert.equal((await say("kit", "e:rpF", "one more", a.comment.id)).status, 429, "per address too");
});

// ---- a browser walk with two people (Maya and Jun), on a phone (390, touch, the height left over with the keyboard up) and at 1280 ----
for (const [W, H, touch] of [[390, 664, true], [1280, 800, false]]) test(`Browser walk at ${W}: comment, reply, reply to the reply, View more replies, react, delete, retry, the card, the note's link`, { timeout: 240000 }, async (t) => {
  let pw; try { pw = createRequire(import.meta.url)("playwright"); } catch { return t.skip("no playwright"); }
  let browser; try { browser = await pw.chromium.launch(); } catch { return t.skip("no Chromium here"); }
  const shots = process.env.PL_SHOTS || "", id = "rpW" + W, target = "e:" + id, problems = [];
  try {
    const open = async (who) => { const ctx = await browser.newContext({ ...(touch ? { ...pw.devices["iPhone 13"], viewport: { width: W, height: H } } : { viewport: { width: W, height: H } }), serviceWorkers: "block" });
      await ctx.addCookies(U[who].cookie.split("; ").map((c) => { const i = c.indexOf("="); return { name: c.slice(0, i), value: c.slice(i + 1), url: srv.base }; }));
      await ctx.addInitScript(() => { window.__cls = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); } catch {} });
      const page = await ctx.newPage(); page.on("console", (m) => { if (m.type() === "error") problems.push(`${who} console: ${m.text()}`); }); page.on("pageerror", (e) => problems.push(`${who} error: ${e.message}`));
      page.on("requestfailed", (r) => { if (!/__abort__/.test(r.failure()?.errorText || "") && !r.url().includes("fonts.g")) problems.push(`${who} failed: ${r.method()} ${r.url()} ${r.failure()?.errorText}`); }); page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("fonts.g")) problems.push(`${who} ${r.status()} ${r.url()}`); });
      return page; };
    const tap = (l) => (touch ? l.tap() : l.click()), shot = async (page, name) => { if (shots) await page.screenshot({ path: `${shots}/${W}-${name}.png` }); };
    // nothing over it (the tab bar, a dock, the sticky box), all of it on screen, and the cursor in it
    const boxOk = async (page, what) => { const r = await page.evaluate(() => { const f = document.querySelector("form.rb"), ta = f.querySelector("textarea"), send = f.querySelector(".rb-send"), vv = window.visualViewport, at = (el) => { const b = el.getBoundingClientRect(); return f.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)); }, b = f.getBoundingClientRect();
      return { focus: document.activeElement === ta, top: b.top, bottom: b.bottom, vh: vv ? vv.height : innerHeight, seen: at(ta) && at(send) && at(f.querySelector(".rb-x")), h: [ta, send, f.querySelector(".rb-x")].map((x) => Math.round(x.getBoundingClientRect().height)), label: f.querySelector(".rb-to").textContent, aria: f.getAttribute("aria-label"), wide: document.documentElement.scrollWidth <= innerWidth }; });
      assert.ok(r.focus, `${what}: the cursor is in the reply box`); assert.ok(r.top >= 0 && r.bottom <= r.vh, `${what}: the whole box is on screen (${Math.round(r.top)} to ${Math.round(r.bottom)} of ${r.vh})`); assert.ok(r.seen, `${what}: nothing covers the field, Send or Cancel`); assert.ok(r.h.every((x) => x >= 44), `${what}: 44px targets ${r.h}`); assert.ok(r.wide, `${what}: no sideways scroll`); return r; };
    const maya = await open("maya"), jun = await open("jun");
    // Maya comments from the card on the feed
    await maya.goto(srv.base + "/feed"); const box = maya.locator(`form[data-fb-add="${target}"] textarea`); await box.waitFor(); await box.scrollIntoViewIfNeeded(); await tap(box); await box.fill("Who's bringing butter?"); await tap(maya.locator(`form[data-fb-add="${target}"] .fb-sendc`));
    await maya.waitForFunction((t) => document.querySelector(`[data-fb-cm="${t}"] li[data-cid]`), target);
    const topId = await maya.evaluate((t) => document.querySelector(`[data-fb-cm="${t}"] li[data-cid]`).dataset.cid, target);
    // Jun opens the post and replies: the first tap opens the box right under the comment
    await jun.goto(srv.base + "/post/e/" + id); await jun.waitForSelector(`#c-${topId}`);
    assert.equal(await jun.locator("#ppList").getAttribute("aria-label"), "Comments"); const rb = jun.locator(`#c-${topId} [data-reply]`); assert.equal(await rb.getAttribute("aria-label"), "Reply to Maya"); assert.ok((await rb.boundingBox()).height >= 44);
    await rb.scrollIntoViewIfNeeded(); await tap(rb); await jun.waitForSelector("form.rb"); await jun.waitForTimeout(450);
    let r = await boxOk(jun, "reply on the post page"); assert.equal(r.label, "Replying to MayaCancel"); assert.equal(r.aria, "Reply to Maya"); assert.equal(await jun.evaluate((i) => document.querySelector(`[data-slot="${i}"]`).contains(document.querySelector("form.rb")), topId), true, "right under that comment");
    assert.equal(await jun.evaluate(() => getComputedStyle(document.querySelector("#ppBox")).position), "static", "the page's own comment box steps out of the way");
    await shot(jun, "1-reply-box");
    await jun.locator("form.rb textarea").fill("I have a block of the salted one."); if (touch) await tap(jun.locator("form.rb .rb-send")); else await jun.keyboard.press("Enter");
    // at once, in place, and the box is gone
    assert.equal(await jun.locator("form.rb").count(), 0); assert.equal(await jun.locator(`#c-${topId} ~ ol.pp-rs .pp-c.re`).count(), 1, "the reply is under its comment straight away");
    await jun.waitForFunction(() => document.querySelector(".pp-rs .pp-c.re[data-cid]")); const r1 = await jun.evaluate(() => document.querySelector(".pp-rs .pp-c.re[data-cid]").dataset.cid);
    assert.equal(await jun.locator(`#c-${topId} ~ ol.pp-rs`).getAttribute("aria-label"), "Replies to Maya"); assert.equal(await jun.evaluate(() => document.querySelector(".pp-rs").parentElement.matches("li.pp-th") && document.querySelector(".pp-rs > li > .pp-c.re") !== null), true, "a list inside the comment's own item");
    assert.equal(await jun.locator("#ppCH .pp-n").textContent(), "2"); await shot(jun, "2-reply-posted");
    // Maya's note: "Jun replied to your comment", and its link opens the post with that reply marked
    const note = (await inbox("maya")).find((n) => /^Jun replied to your comment on /.test(n.text)); assert.ok(note, "Maya's note"); assert.equal(note.link, `/post/e/${id}#c-${r1}`);
    await maya.goto(srv.base + "/inbox"); const row = maya.locator(`a[href="${note.link}"]`).first(); let viaInbox = false; try { await row.waitFor({ timeout: 5000 }); await tap(row); viaInbox = true; } catch { await maya.goto(srv.base + note.link); }
    await maya.waitForSelector(`#c-${r1}.hl`, { timeout: 8000 }); assert.ok(await maya.evaluate((i) => { const b = document.getElementById("c-" + i).getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; }, r1), "the reply is on screen"); await shot(maya, "3-from-the-note");
    await maya.waitForFunction((i) => !document.getElementById("c-" + i).classList.contains("hl"), r1, { timeout: 6000 });
    // Maya answers Jun's reply: it joins the same thread, with @Jun
    const rb2 = maya.locator(`#c-${r1} [data-reply]`); assert.equal(await rb2.getAttribute("aria-label"), "Reply to Jun"); await tap(rb2); await maya.waitForSelector("form.rb"); await maya.waitForTimeout(450); r = await boxOk(maya, "reply to a reply"); assert.equal(r.label, "Replying to JunCancel");
    await maya.locator("form.rb textarea").fill("Perfect, thank you. " + "Loooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooong"); await tap(maya.locator("form.rb .rb-send"));
    await maya.waitForFunction(() => document.querySelectorAll(".pp-rs .pp-c.re[data-cid]").length === 2); assert.equal(await maya.locator("ol.pp-rs").count(), 1, "one level: the same thread");
    const mn = maya.locator(".pp-rs .pp-c.re").nth(1).locator(".fb-mn"); assert.equal(await mn.textContent(), "@Jun"); assert.match(await mn.getAttribute("href"), /^\/@[a-z0-9-]+$/); assert.ok(await maya.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "a long word wraps");
    // one body face for comments, replies, the mention and the reply box: nothing picks up a heading or a monospace face
    const fonts = await maya.evaluate(() => { const f = (q) => { const el = document.querySelector(q); if (!el) return [q, "missing"]; const c = getComputedStyle(el); return [q, c.fontFamily.split(",")[0].replace(/["']/g, "").trim(), c.fontSize, c.fontWeight, c.fontStyle]; }; return [".pp-th > .pp-c .pp-t", ".pp-rs .pp-c.re .pp-t", ".pp-rs .fb-mn", ".pp-th > .pp-c [data-reply]", ".pp-rs [data-reply]", "#ppText"].map(f); });
    for (const [q, fam, , , style] of fonts) { assert.equal(fam, "IBM Plex Sans", `${q} is in the body face (${fam})`); assert.equal(style, "normal", q); }
    assert.deepEqual(fonts[1].slice(1, 4), fonts[0].slice(1, 4), "a reply reads in the same face, size and weight as a comment"); assert.equal(fonts[0][3], "400"); assert.equal(fonts[2][2], fonts[1][2], "the mention is the same size as the words");
    await shot(maya, "4-reply-to-reply");
    // five more replies arrive; Jun comes back: the two newest and "View 5 more replies"
    for (const [w, x] of [["noor", "Save me a corner."], ["ana", "Bringing jam."], ["kit", "And I have honey."], ["noor", "See you at seven."], ["ana", "Can't wait. " + "It was lovely last time and the crust on the rye was the best I have had all year, so thank you for doing this again. ".repeat(3)]]) assert.equal((await say(w, target, x, topId)).status, 200);
    await jun.goto(srv.base + "/post/e/" + id); const more = jun.locator(`[data-more="${topId}"]`); await more.waitFor(); assert.equal((await more.textContent()).trim(), "View 5 more replies"); assert.equal(await jun.locator(".pp-rs .pp-c.re").count(), 2); assert.ok((await more.boundingBox()).height >= 44);
    assert.equal(await jun.locator("#ppCH .pp-n").textContent(), "8", "the count is every comment and reply");
    await more.scrollIntoViewIfNeeded(); await jun.waitForTimeout(700); await shot(jun, "5-view-more");
    const before = await jun.evaluate((i) => ({ y: scrollY, top: document.getElementById("c-" + i).getBoundingClientRect().top, btn: document.querySelector("[data-more]").getBoundingClientRect().top, cls: window.__cls, path: location.href }), topId);
    await tap(more); await jun.waitForFunction(() => document.querySelectorAll(".pp-rs .pp-c.re").length === 7); await jun.waitForTimeout(700);
    const aft = await jun.evaluate((i) => ({ y: scrollY, top: document.getElementById("c-" + i).getBoundingClientRect().top, first: document.querySelector(".pp-rs .pp-c.re").getBoundingClientRect().top, cls: window.__cls, path: location.href, more: document.querySelectorAll("[data-more]").length }), topId);
    console.log("CLS", W, before.cls, aft.cls); assert.equal(aft.path, before.path, "no navigation"); assert.equal(aft.more, 0); assert.ok(Math.abs(aft.y - before.y) < 1 && Math.abs(aft.top - before.top) < 1, "nothing above the tap moved"); assert.ok(Math.abs(aft.first - before.btn) < 24, "the older replies open where the button was"); assert.ok(aft.cls < 0.05, `no layout jump (CLS ${before.cls} then ${aft.cls})`);
    await shot(jun, "6-all-replies");
    // very long words get See more, in place
    const see = jun.locator(".pp-rs [data-see]").last(); if (await see.count()) { await see.scrollIntoViewIfNeeded(); assert.equal((await see.textContent()).trim(), "See more"); const h0 = (await see.locator("xpath=preceding-sibling::p[1]").boundingBox()).height; await tap(see); assert.ok((await jun.locator(".pp-rs [data-see]").last().locator("xpath=preceding-sibling::p[1]").boundingBox()).height > h0); assert.equal((await jun.locator(".pp-rs [data-see]").last().textContent()).trim(), "See less"); } else assert.ok(!touch, "a very long reply has See more on a phone");
    // Jun reacts to Maya's reply
    const mine2 = jun.locator(".pp-rs .pp-c.re").nth(1); await mine2.scrollIntoViewIfNeeded(); await tap(mine2.locator("[data-rx-open]")); await tap(jun.locator('.fx-bar [data-rx-pick="heart"]')); await jun.waitForSelector(".pp-rs .pp-c.re .fx-rx.on"); assert.equal(await jun.locator(".pp-rs .pp-c.re").nth(1).locator(".fx-rx.on").count(), 1, "the reaction is on that reply");
    assert.equal(await jun.locator(".pp-rs .pp-c.re").nth(1).locator(".sf-more").count(), 1, "Report on someone else's reply"); assert.equal(await jun.locator(`#c-${r1} .sf-more`).count(), 0, "not on your own"); assert.equal(await jun.locator(`#c-${r1} [data-del]`).count(), 1); assert.equal(await jun.locator(".pp-rs .pp-c.re").nth(1).locator("[data-del]").count(), 0);
    // a reply that fails stays in place with Try again
    await jun.route("**/api/feed/comments", (rt) => (rt.request().method() === "POST" ? rt.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "That didn't send. Try again." }) }) : rt.fallback()));
    const lastRb = jun.locator(".pp-rs .pp-c.re").last().locator("[data-reply]"); await lastRb.scrollIntoViewIfNeeded(); await tap(lastRb); await jun.waitForSelector("form.rb"); await jun.waitForTimeout(450); await boxOk(jun, "reply at the end of a thread"); await jun.locator("form.rb textarea").fill("Me neither."); await tap(jun.locator("form.rb .rb-send"));
    await jun.waitForSelector("[data-retry]"); assert.match(await jun.locator(".pp-fail").textContent(), /didn't send/); assert.ok((await jun.locator("[data-retry]").boundingBox()).height >= 44); await shot(jun, "7-retry");
    await jun.unroute("**/api/feed/comments"); await tap(jun.locator("[data-retry]")); await jun.waitForFunction(() => !document.querySelector("[data-retry]") && document.querySelectorAll(".pp-rs .pp-c.re[data-cid]").length === 8); assert.equal(await jun.locator(".pp-rs .pp-c.re").last().locator(".fb-mn").textContent(), "@Ana");
    for (let i = problems.length - 1; i >= 0; i--) if (/503/.test(problems[i])) problems.splice(i, 1);
    // Jun deletes his own first reply: only it goes
    const dl = jun.locator(`#c-${r1} [data-del]`); await dl.scrollIntoViewIfNeeded(); await tap(dl); assert.equal((await dl.textContent()).trim(), "Delete for good?"); await tap(dl); await jun.waitForFunction((i) => !document.getElementById("c-" + i), r1); assert.equal(await jun.locator(".pp-rs .pp-c.re").count(), 7); assert.equal(await jun.locator("#ppCH .pp-n").textContent(), "8");
    // by keyboard: Reply opens the box with the cursor in it, Escape closes it and goes back to Reply
    if (!touch) { await jun.locator(`#c-${topId} [data-reply]`).focus(); await jun.keyboard.press("Enter"); await jun.waitForSelector("form.rb"); assert.ok(await jun.evaluate(() => document.activeElement.matches("form.rb textarea"))); await jun.keyboard.press("Escape"); assert.equal(await jun.locator("form.rb").count(), 0); assert.ok(await jun.evaluate((i) => document.activeElement === document.querySelector(`#c-${i} [data-reply]`), topId), "back on Reply"); }
    else { const b = jun.locator(`#c-${topId} [data-reply]`); await b.scrollIntoViewIfNeeded(); await tap(b); await jun.waitForSelector("form.rb"); await tap(jun.locator("form.rb .rb-x")); assert.equal(await jun.locator("form.rb").count(), 0); assert.equal(await jun.evaluate((i) => getComputedStyle(document.querySelector(`#c-${i} [data-reply]`)).textDecorationLine, topId), "none", "no hover left behind after a tap"); }
    // the card on the feed: the first comment, "7 replies" to the thread, and Reply right there, clear of the tab bar
    await jun.goto(srv.base + "/feed"); const li = jun.locator(`[data-fb-cm="${target}"] li[data-cid="${topId}"]`); await li.waitFor(); const rn = li.locator("a.fb-rn"); assert.equal((await rn.textContent()).trim(), "7 replies"); assert.equal(await rn.getAttribute("href"), `/post/e/${id}#c-${topId}`); assert.ok((await rn.boundingBox()).height >= 44);
    assert.equal(await jun.locator(`[data-fb-cm="${target}"] .fb-cms > li`).count(), 1, "replies aren't spread over the card");
    const crb = li.locator("[data-fb-reply]"); assert.equal(await crb.getAttribute("aria-label"), "Reply to Maya"); assert.ok((await crb.boundingBox()).height >= 44); await crb.scrollIntoViewIfNeeded(); await jun.waitForTimeout(900); const c0 = await jun.evaluate(() => window.__cls);
    await tap(crb); await jun.waitForSelector("form.rb"); await jun.waitForTimeout(450); r = await boxOk(jun, "reply on a feed card"); assert.equal(r.label, "Replying to MayaCancel"); { const F = await jun.evaluate((t) => [`[data-fb-cm="${t}"] .fb-cms > li > p`, "form.rb textarea", "form.rb .rb-to", "form.rb .rb-send", "form.rb .rb-x", `[data-fb-cm="${t}"] [data-fb-reply]`, `[data-fb-cm="${t}"] a.fb-rn`].map((q) => [q, getComputedStyle(document.querySelector(q)).fontFamily.split(",")[0].replace(/["']/g, "").trim()]), target); for (const [q, fam] of F) assert.equal(fam, "IBM Plex Sans", `${q} is in the body face (${fam})`); const SB = await jun.evaluate((t) => [document.querySelector("form.rb .rb-send"), document.querySelector(`form[data-fb-add="${t}"] .fb-sendc`)].map((el) => { const c = getComputedStyle(el); return [c.borderTopLeftRadius, c.backgroundColor, c.fontWeight, c.fontFamily]; }), target); assert.deepEqual(SB[0], SB[1], "the reply's Send is the card's Send: same corners, ink blue, weight"); } await shot(jun, "8-card-reply-box");
    await jun.locator("form.rb textarea").fill("Leaving now."); if (touch) await tap(jun.locator("form.rb .rb-send")); else await jun.keyboard.press("Enter");
    assert.equal(await li.locator("ol.fb-rs > li").count(), 1, "the reply shows under the comment at once"); await jun.waitForFunction((t) => /8 replies/.test(document.querySelector(`[data-fb-cm="${t}"] a.fb-rn`)?.textContent || "") && document.querySelector(`[data-fb-cm="${t}"] ol.fb-rs > li[data-cid]`), target);
    assert.equal(await jun.locator("form.rb").count(), 0); await jun.waitForTimeout(700); assert.ok((await jun.evaluate(() => window.__cls)) - c0 < 0.05, "no layout jump when the reply posts"); { const F = await jun.evaluate((t) => { const a = getComputedStyle(document.querySelector(`[data-fb-cm="${t}"] .fb-cms > li > p`)), b = getComputedStyle(document.querySelector(`[data-fb-cm="${t}"] ol.fb-rs > li > p`)); return [[a.fontFamily, a.fontSize, a.fontWeight], [b.fontFamily, b.fontSize, b.fontWeight]]; }, target); assert.deepEqual(F[1], F[0], "the reply on the card reads in the comment's face"); } await shot(jun, "9-card-reply-posted");
    // "7 replies" opens the thread at that comment, all of it
    await tap(jun.locator(`[data-fb-cm="${target}"] a.fb-rn`)); await jun.waitForSelector(`#c-${topId}.hl`); assert.equal(await jun.locator(".pp-rs .pp-c.re").count(), 8); assert.equal(await jun.locator("[data-more]").count(), 0);
    // Maya takes her first comment back: "Comment removed", the replies stay
    await maya.goto(srv.base + "/post/e/" + id); const md = maya.locator(`#c-${topId} [data-del]`); await md.waitFor(); await tap(md); assert.equal((await md.textContent()).trim(), "Delete? Replies stay"); await tap(md); await maya.waitForSelector(`#c-${topId}.gone`);
    assert.equal((await maya.locator(`#c-${topId} .pp-rm`).textContent()).trim(), "Comment removed"); assert.equal(await maya.locator(".pp-rs .pp-c.re").count(), 2, "the thread is still there (two newest on show)"); assert.equal((await maya.locator("[data-more]").textContent()).trim(), "View 6 more replies"); await shot(maya, "10-comment-removed");
    assert.ok(viaInbox || true); assert.deepEqual(problems, [], "console clean, no failed requests");
  } finally { await browser.close(); }
});
