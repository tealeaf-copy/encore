// Written reviews (server/reviews.js, public/reviews.js): who can and can't write one, one per person, stars only on
// things people pay for, edit and delete, who sees a private event's reviews, the host's reply, pin and hide, reports,
// the rate limit, averages, and a walk in a real browser at 390 and 1280.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore } from "../server/workspaces.js";
import { makeSafety, textHash } from "../server/safety.js";
import { cleanText, excerpt, average, paidEvent, noContact, REVIEW_MAX, PIN_MAX, WRITES_PER_HOUR } from "../server/reviews.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let srv, host, other, priya, ws, S, R, rid = {}, code = {};
const J = { "Content-Type": "application/json" };
const post = async (p, body, cookie) => { const r = await fetch(srv.base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }); return { status: r.status, j: await r.json().catch(() => null) }; };
const put = (p, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + p, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const getJ = async (p, cookie) => { const r = await fetch(srv.base + p, { headers: cookie ? { cookie } : {} }); return { status: r.status, j: await r.json().catch(() => null) }; };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "reviews-secret", ENCORE_SIGNUP_PER_HOUR: "100", ENCORE_FAKE_SMS: "1", ENCORE_FAKE_EMAIL: "1", ENCORE_DIRECTORY_CACHE_MS: "0", ENCORE_ADMIN_EMAILS: "admin.rv@example.com" };
const WORDS = "Came alone and left with six new friends. The broth was the best I have had this year.";
const as = (who, ev = "rvFree") => ({ subject: "event:" + ev, rid: rid[who], code: code[who] });
const write = (who, ev, extra, cookie) => post("/api/public/reviews", { ...as(who, ev), ...extra }, cookie);
const view = (q, cookie) => post("/api/public/reviews/view", q, cookie);

async function signup(name, email, handle) {
  const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name, email, password: "long-password-1", mode: "friends" }) }); const cookie = r.headers.get("set-cookie").split(";")[0];
  if (handle) assert.ok((await post("/api/host/profile", { handle, name, tagline: "Small dinners for new friends.", city: "Brooklyn", hood: "Bed-Stuy", emoji: "🍜", forHire: true, services: "Supper clubs and pasta classes for teams" }, cookie)).status === 200);
  return cookie;
}
before(async () => {
  Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer(); R = srv.app.locals.reviews;
  host = await signup("Maya Okafor", "maya.rv@example.com", "maya-rv");
  other = await signup("Lou Baker", "lou.rv@example.com", "lou-rv");
  priya = await signup("Priya Shah", "priya.rv@example.com", "");
  ws = srv.store.get("system/handle-maya-rv").data.ws; S = scopeStore(srv.store, ws);
  const base = { casual: true, date: day(-2), startTime: "18:00", endTime: "21:00", tz: "UTC", published: true, discoverable: true, city: "Brooklyn", hood: "Bed-Stuy", activity: "dinner" };
  for (const [id, e] of Object.entries({ rvFree: { name: "Harvest supper", free: true }, rvPaid: { name: "Pasta night", price: "$45" }, rvPriv: { name: "Family table", price: "$30", private: true, discoverable: false },
    rvGone: { name: "Rained out picnic", cancelled: true }, rvSoon: { name: "Next supper", date: day(5) }, rvEx: { name: "Example supper", example: true }, rvCheck: { name: "Would you come?", stage: "interest" },
    rvDrop: { name: "Sourdough drop", drop: true, preorder: true, date: "", orderItems: [{ id: "loaf", name: "Country loaf", price: 12 }] } }))
    assert.ok((await put("events/" + id, { ...base, ...e }, host)).ok, id);
  const add = async (who, eventId, body) => { code[who] = "C" + who.toUpperCase() + "9Z"; rid[who] = (await (await fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, cookie: host }, body: JSON.stringify({ eventId, code: code[who], createdAt: Date.now(), ...body }) })).json()).id; };
  await add("ana", "rvFree", { name: "Ana Diaz", email: "ana.rv@guest.example.com", response: "going" });
  await add("bo", "rvFree", { name: "Bo Chen", response: "going", checkedInAt: Date.now() });
  await add("cy", "rvFree", { name: "Cy Noshow", response: "going", noShow: true });
  await add("di", "rvFree", { name: "Di Maybe", response: "maybe" });
  await add("priya", "rvFree", { name: "Priya Shah", email: "priya.rv@example.com", response: "going" });
  await add("me", "rvFree", { name: "Maya Okafor", email: "maya.rv@example.com", response: "going" }); // the host on her own guest list
  for (const [i, w] of ["p1", "p2", "p3", "p4"].entries()) await add(w, "rvPaid", { name: ["Tom Reed", "Lena Park", "Sam Osei", "Jo Kim"][i], email: `${w}.rv@guest.example.com`, response: "going" });
  await add("v1", "rvPriv", { name: "Vik Rao", email: "vik.rv@guest.example.com", response: "going" });
  await add("v2", "rvPriv", { name: "Wren Li", response: "going" });
  await add("g1", "rvGone", { name: "Gus Hall", response: "going" });
  await add("s1", "rvSoon", { name: "Sol Vega", response: "going" });
  await add("e1", "rvEx", { name: "Eve Example", response: "going" });
  await add("c1", "rvCheck", { name: "Cal Check", response: "going" });
  await add("d1", "rvDrop", { name: "Dee Buyer", email: "dee.rv@guest.example.com", response: "going", orderLines: [{ id: "loaf", name: "Country loaf", qty: 2, price: 12 }], orderStatus: "picked", checkedInAt: Date.now() });
  await add("d2", "rvDrop", { name: "Ned Waiting", response: "going", orderLines: [{ id: "loaf", name: "Country loaf", qty: 1, price: 12 }] });
  S.add("inquiries", { id: "bkdone1", kind: "booking", name: "Tess Morgan", email: "tess.rv@brand.example.com", company: "Larkfield", status: "done", date: day(-10), experience: { id: "x1", name: "Pasta class for teams" } });
  S.add("inquiries", { id: "bkopen1", kind: "booking", name: "Uma Bell", email: "uma.rv@brand.example.com", status: "requested", experience: { id: "x1", name: "Pasta class for teams" } });
});
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });
beforeEach(() => R.resetLimits()); // the write limit has its own test

test("words are cleaned the way kudos are: links out, contact details hidden, a quote is whole sentences", () => {
  assert.equal(cleanText("Loved it. See https://spam.example/x and www.spam.example and buy at cheap-pills.com/now thanks"), "Loved it. See and and buy at thanks");
  assert.equal(cleanText("a\u0000b <b>bold</b>\n\n\n\nnext"), "a b bold\n\nnext");
  assert.equal(cleanText("x".repeat(REVIEW_MAX + 50)).length, REVIEW_MAX);
  assert.equal(noContact("Call me on (415) 555-0101 or mail ana@example.com"), "Call me on … or mail …");
  assert.equal(excerpt("Short and whole."), "Short and whole.");
  const q = excerpt("The night started slow and then the whole table was singing. I did not expect to stay until midnight but nobody wanted to leave at all. " + "More words here. ".repeat(20), 220);
  assert.ok(q.length <= 220 && /[.!?…]$/.test(q), "ends on a sentence, never mid-word");
  assert.deepEqual(average([{ rating: 5 }, { rating: 4 }]), null, "no average under 3 rated reviews");
  assert.deepEqual(average([{ rating: 5 }, { rating: 4 }, { rating: 5 }, {}]), { avg: 4.7, n: 3 });
  assert.equal(paidEvent({ price: "$45" }), true); assert.equal(paidEvent({ price: "45" }), true);
  for (const e of [{ price: "" }, { price: "free" }, { price: "$0" }, { price: "0.00" }, { price: "chip" }, { price: "$45", free: true }, {}]) assert.equal(paidEvent(e), false, JSON.stringify(e));
});

test("who can write: a guest who went, by their reply's own code or signed in. Nobody else", async () => {
  // no proof, a wrong code, another guest's code
  assert.equal((await post("/api/public/reviews", { subject: "event:rvFree", text: WORDS })).status, 401);
  assert.equal((await post("/api/public/reviews", { subject: "event:rvFree", rid: rid.ana, code: "WRONG", text: WORDS })).status, 403);
  assert.equal((await post("/api/public/reviews", { subject: "event:rvFree", rid: rid.ana, code: code.bo, text: WORDS })).status, 403);
  // a no-show and a maybe didn't go
  for (const who of ["cy", "di"]) { const r = await write(who, "rvFree", { text: WORDS }); assert.equal(r.status, 403, who); assert.match(r.j.message, /guests who went/); }
  // cancelled, not yet, an example page, a "would you come?" check
  assert.equal((await write("g1", "rvGone", { text: WORDS })).j.code, "cancelled");
  assert.equal((await write("s1", "rvSoon", { text: WORDS })).j.code, "not_yet");
  assert.match((await write("e1", "rvEx", { text: WORDS })).j.message, /example page/);
  assert.equal((await write("c1", "rvCheck", { text: WORDS })).j.code, "not_yet");
  // never the host: signed in, or through a reply of their own on their own event
  const h = await post("/api/public/reviews", { subject: "event:rvFree", text: WORDS }, host); assert.equal(h.status, 403); assert.match(h.j.message, /your own event/);
  assert.equal((await write("me", "rvFree", { text: WORDS })).status, 403, "the host's own reply is no way in");
  // a signed-in stranger who wasn't there
  assert.equal((await post("/api/public/reviews", { subject: "event:rvFree", text: WORDS }, other)).status, 403);
  assert.equal(S.list("reviews").length, 0, "nothing was written");
  // a guest who went, with their code; checked in at the door counts too
  const a = await write("ana", "rvFree", { text: WORDS }); assert.equal(a.status, 200, JSON.stringify(a.j)); assert.equal(a.j.created, true);
  assert.equal(a.j.review.name, "Ana"); assert.equal(a.j.review.mine, true); assert.match(a.j.where, /shows on Maya's page and on the event's page, with your first name/);
  assert.equal((await write("bo", "rvFree", { text: "Checked in at the door and stayed for hours." })).status, 200);
  // signed in, matched by the email on their reply: no code needed
  const p = await post("/api/public/reviews", { subject: "event:rvFree", text: "Signed in and still remembered. A lovely long table." }, priya); assert.equal(p.status, 200, JSON.stringify(p.j));
  assert.ok(!JSON.stringify([a.j, p.j]).includes("@"), "no email leaves");
});

test("one review per person per event: writing again edits it, signed in or by code; the author can delete it", async () => {
  const n0 = S.list("reviews").length;
  const again = await write("ana", "rvFree", { text: WORDS + " Going back next month." }); assert.equal(again.status, 200); assert.equal(again.j.created, false); assert.equal(again.j.review.edited, true);
  assert.equal(S.list("reviews").length, n0, "still one");
  // Priya's code and Priya's session are the same person
  const byCode = await write("priya", "rvFree", { text: "Edited from my phone with the reply link. Same review." }); assert.equal(byCode.j.created, false);
  assert.equal(S.list("reviews").filter((d) => d.data.email === "priya.rv@example.com").length, 1);
  // the form knows what they wrote
  const f = await getJ(`/api/public/reviews/form?subject=event:rvFree&rid=${rid.ana}&code=${code.ana}`); assert.equal(f.j.can, true); assert.equal(f.j.rated, false); assert.match(f.j.mine.text, /Going back next month/);
  assert.deepEqual(f.j.prompts, ["What was it like?", "What would you tell a friend?"]);
  assert.equal((await getJ(`/api/public/reviews/form?subject=event:rvFree&rid=${rid.cy}&code=${code.cy}`)).j.can, false);
  // delete: only theirs, and it's gone
  assert.equal((await post("/api/public/reviews/delete", { subject: "event:rvFree" }, other)).status, 403);
  assert.equal((await post("/api/public/reviews/delete", as("bo"))).status, 200);
  assert.equal(S.list("reviews").length, n0 - 1); assert.equal((await post("/api/public/reviews/delete", as("bo"))).status, 404);
});

test("a free event takes words only: a rating sent with it is ignored, and words are required", async () => {
  const r = await write("bo", "rvFree", { rating: 5, text: "Back again. The second bowl was even better than the first." }); assert.equal(r.status, 200);
  assert.ok(!("rating" in r.j.review), "stars are ignored on a free event"); assert.ok(!("rating" in S.list("reviews").find((d) => d.data.rid === rid.bo).data));
  assert.equal((await write("bo", "rvFree", { text: "" })).j.code, "too_short"); assert.equal((await write("bo", "rvFree", { text: "Too short." })).j.code, "too_short");
  assert.equal((await write("bo", "rvFree", { text: "y".repeat(REVIEW_MAX + 80) })).j.code, "too_long");
  // the filter: strong language and contact details are refused, links are taken out
  assert.equal((await write("bo", "rvFree", { text: "What a shit show, honestly the worst." })).j.code, "language");
  assert.equal((await write("bo", "rvFree", { text: "Loved it, text me on 415 555 0101 for the recipe." })).j.code, "contact_info");
  const l = await write("bo", "rvFree", { text: "Great night, photos at https://example.org/album if you want." }); assert.equal(l.status, 200); assert.equal(l.j.review.love, "Great night, photos at if you want.");
});

test("stars are part of a paid review: required, 1 to 5 only, and words are optional beside them", async () => {
  const f = await getJ(`/api/public/reviews/form?subject=event:rvPaid&rid=${rid.p1}&code=${code.p1}`); assert.equal(f.j.rated, true);
  for (const bad of [undefined, null, "", 0, 6, 3.5, "five", true, -1]) { const r = await write("p1", "rvPaid", { rating: bad, text: WORDS }); assert.equal(r.status, 400, String(bad)); assert.equal(r.j.code, "rating"); }
  const only = await write("p1", "rvPaid", { rating: 5 }); assert.equal(only.status, 200, "a rating on its own is fine"); assert.equal(only.j.review.rating, 5); assert.equal(only.j.review.love, "");
  assert.equal((await write("p2", "rvPaid", { rating: 4, text: "Short." })).j.code, "too_short", "words, when there are some, are at least 20 characters");
  assert.equal((await write("p2", "rvPaid", { rating: 4, text: "Worth every dollar. The ragu took two days and you could tell." })).status, 200);
  // a drop: only a picked-up order, and it carries stars
  const w = await write("d2", "rvDrop", { rating: 5, text: WORDS }); assert.equal(w.status, 409); assert.match(w.j.message, /picked up your order/);
  assert.equal((await write("d1", "rvDrop", { text: WORDS })).j.code, "rating");
  const d = await write("d1", "rvDrop", { rating: 5, text: "Still warm when I picked it up. The crust sings." }); assert.equal(d.status, 200); assert.equal(d.j.review.kind, "drop"); assert.equal(d.j.review.what, "Ordered");
  // a booked experience, once it happened: the booking page's link, or the booker signed in
  const t = R.bookingToken("bkdone1");
  assert.equal((await post("/api/public/reviews", { subject: "booking:bkdone1", t: "nope", rating: 5 })).status, 401);
  assert.equal((await post("/api/public/reviews", { subject: "booking:bkopen1", t: R.bookingToken("bkopen1"), rating: 5 })).j.code, "not_yet");
  assert.equal((await post("/api/public/reviews", { subject: "booking:bkdone1", t, rating: 5, text: WORDS }, host)).status, 403, "the host can't use the link on their own experience");
  const b = await post("/api/public/reviews", { subject: "booking:bkdone1", t, rating: 4, text: "Our team still talks about the pasta. Maya ran the room with ease." }); assert.equal(b.status, 200, JSON.stringify(b.j));
  assert.equal(b.j.review.what, "Booked"); assert.equal(b.j.review.event, "Pasta class for teams");
});

test("averages: only from 3 rated reviews, one decimal; free events never count; an edit moves it; each thing needs its own 3", async () => {
  const hostSum = R.summaryOf(ws); assert.deepEqual(hostSum.rating, { avg: 4.5, n: 4 }, "5, 4, 5 and 4");
  assert.equal(R.summaryOf(ws, { eventId: "rvPaid" }).rating, null, "the paid event has 2");
  assert.equal((await write("p3", "rvPaid", { rating: 3, text: "Good food, a little cramped at the long table though." })).status, 200);
  assert.deepEqual(R.summaryOf(ws, { eventId: "rvPaid" }).rating, { avg: 4, n: 3 });
  const E = await view({ event: "rvPaid" }); assert.deepEqual(E.j.rating, { avg: 4, n: 3 }); assert.equal(E.j.count, 3);
  assert.equal((await view({ event: "rvFree" })).j.rating, null, "a free event's reviews carry no stars, so no average"); assert.ok((await view({ event: "rvFree" })).j.count >= 3);
  // an edit changes the average
  assert.equal((await write("p3", "rvPaid", { rating: 5, text: "Good food, a little cramped at the long table though." })).status, 200);
  assert.deepEqual(R.summaryOf(ws, { eventId: "rvPaid" }).rating, { avg: 4.7, n: 3 });
  assert.deepEqual(R.summaryOf(ws).rating, { avg: 4.6, n: 5 });
  // if the price changes later, each review stays as it was written
  S.update("events/rvPaid", { price: "", free: true }); S.update("events/rvFree", { price: "$20", free: false }); R.bust();
  const keep = await write("p1", "rvPaid", { rating: 4 }); assert.equal(keep.status, 200); assert.equal(keep.j.review.rating, 4, "a rated review keeps its stars");
  assert.equal((await write("p1", "rvPaid", { text: WORDS })).j.code, "rating", "and still needs them");
  const un = await write("ana", "rvFree", { rating: 1, text: WORDS }); assert.equal(un.status, 200); assert.ok(!("rating" in un.j.review), "an unrated one stays unrated");
  assert.equal((await write("p4", "rvPaid", { text: "Wrote this after it went free, so there are no stars." })).status, 200, "a new review of a now-free event has no stars");
  S.update("events/rvPaid", { price: "$45", free: false }); S.update("events/rvFree", { price: "", free: true }); R.bust();
  assert.equal((await write("p1", "rvPaid", { rating: 5 })).status, 200);
});

test("a private event's reviews show only to the people who were there, and count toward no public average", async () => {
  const before0 = R.summaryOf(ws);
  const v = await write("v1", "rvPriv", { rating: 1, text: "Private dinner, honest words that are for the table only." }); assert.equal(v.status, 200); assert.match(v.j.where, /Only Maya and the guests who were there can see it/);
  assert.deepEqual(R.summaryOf(ws), before0, "not in the count, not in the average");
  const pub = JSON.stringify([(await getJ("/api/public/profile/maya-rv")).j, (await view({ host: "maya-rv" })).j, (await view({ event: "rvPriv" })).j, (await view({ host: "maya-rv" }, other)).j]);
  assert.ok(!pub.includes("for the table only"), "never on a public page, signed in or not");
  // another guest who was there, the author and the host see it
  const there = await view({ event: "rvPriv", proofs: [{ id: "rvPriv", rid: rid.v2, code: code.v2 }] }); assert.equal(there.j.reviews.length, 1); assert.ok(!there.j.reviews[0].mine);
  const mine = await view({ event: "rvPriv", proofs: [{ id: "rvPriv", rid: rid.v1, code: code.v1 }] }); assert.equal(mine.j.reviews[0].mine, true);
  assert.equal((await view({ event: "rvPriv" }, host)).j.reviews.length, 1);
  assert.equal((await view({ event: "rvPriv", proofs: [{ id: "rvPriv", rid: rid.v2, code: "WRONG" }] })).j.reviews.length, 0);
  // the feed's quote for that event: only for someone who was there
  assert.equal(R.quoteFor({ ws, id: "rvPriv", e: S.get("events/rvPriv").data }, ""), null);
});

test("the host: one reply, up to 3 pinned on top, and Hide, which the author still sees and the team is told about", async () => {
  const L0 = (await view({ host: "maya-rv" }, host)).j; assert.equal(L0.owner, true); assert.ok(L0.reviews.every((r) => r.own && !r.mine));
  const byName = (L, n) => L.reviews.find((r) => r.name === n), ana = byName(L0, "Ana"), tom = byName(L0, "Tom"), lena = byName(L0, "Lena"), sam = byName(L0, "Sam"), dee = byName(L0, "Dee");
  // only the host of that page
  assert.equal((await post("/api/host/reviews/" + ana.id, { reply: "Thanks!" })).status, 401);
  assert.equal((await post("/api/host/reviews/" + ana.id, { reply: "Thanks!" }, other)).status, 404, "another host has no such review");
  // reply: short, public, cleaned like everything else; one per review (saving again replaces it)
  assert.equal((await post("/api/host/reviews/" + ana.id, { reply: "x".repeat(401) }, host)).j.code, "too_long");
  assert.equal((await post("/api/host/reviews/" + ana.id, { reply: "Call me on 415 555 0101" }, host)).j.code, "contact_info");
  const r1 = await post("/api/host/reviews/" + ana.id, { reply: "Thank you, Ana. Come back in spring." }, host); assert.equal(r1.status, 200); assert.equal(r1.j.review.reply.text, "Thank you, Ana. Come back in spring."); assert.equal(r1.j.review.reply.name, "Maya");
  await post("/api/host/reviews/" + ana.id, { reply: "Thank you, Ana. The spring menu is up." }, host);
  const pubAna = byName((await view({ host: "maya-rv" })).j, "Ana"); assert.equal(pubAna.reply.text, "Thank you, Ana. The spring menu is up."); assert.equal(pubAna.love, ana.love, "the host can't change a word of the review");
  // pin: up to 3, on top, newest pin first
  for (const r of [tom, lena, sam]) assert.equal((await post("/api/host/reviews/" + r.id, { pin: true }, host)).status, 200);
  const four = await post("/api/host/reviews/" + dee.id, { pin: true }, host); assert.equal(four.status, 409); assert.equal(four.j.code, "pin_limit"); assert.match(four.j.message, new RegExp(`pin up to ${PIN_MAX}`));
  let pub = (await view({ host: "maya-rv" })).j; assert.deepEqual(pub.reviews.slice(0, 3).map((r) => r.name), ["Sam", "Lena", "Tom"]); assert.ok(pub.reviews.slice(0, 3).every((r) => r.pinned));
  assert.equal((await post("/api/host/reviews/" + tom.id, { pin: false }, host)).status, 200);
  assert.equal((await post("/api/host/reviews/" + dee.id, { pin: true }, host)).status, 200);
  // hide: off every public page, still there for the author and the host, and the team hears
  const sum0 = R.summaryOf(ws);
  assert.equal((await post("/api/host/reviews/" + sam.id, { hide: true }, host)).status, 200);
  pub = (await view({ host: "maya-rv" })).j; assert.ok(!byName(pub, "Sam")); assert.equal(pub.count, sum0.count - 1);
  assert.ok(!JSON.stringify((await getJ("/api/public/profile/maya-rv")).j).includes("a little cramped"));
  assert.deepEqual(R.summaryOf(ws).rating, sum0.rating, "a hidden review's rating still counts: hiding can't lift the score");
  const hv = byName((await view({ host: "maya-rv" }, host)).j, "Sam"); assert.equal(hv.hidden, true); assert.ok(!hv.pinned, "hiding unpins it");
  const av = (await view({ event: "rvPaid", proofs: [{ id: "rvPaid", rid: rid.p3, code: code.p3 }] })).j.reviews.find((r) => r.mine); assert.equal(av.hidden, true, "the author still sees theirs, marked");
  assert.equal((await post("/api/host/reviews/" + sam.id, { pin: true }, host)).status, 409, "a hidden review can't be pinned");
  // marked for the team
  const admin = await signup("Ada Admin", "admin.rv@example.com", "");
  const hid = await getJ("/api/admin/reviews/hidden", admin); assert.equal(hid.j.reviews.length, 1); assert.equal(hid.j.reviews[0].host, "maya-rv"); assert.equal(hid.j.reviews[0].rating, 5);
  assert.equal((await getJ("/api/admin/reviews/hidden", host)).status, 404);
  const q = await getJ("/api/admin/reports", admin); const flag = q.j.reports.find((x) => x.hostHide); assert.ok(flag, "in the moderation queue"); assert.match(flag.note, /The host hid this review from their page \(5 of 5 stars\)/);
  // show it again: back on the page, the flag closes
  assert.equal((await post("/api/host/reviews/" + sam.id, { hide: false }, host)).status, 200);
  assert.ok(byName((await view({ host: "maya-rv" })).j, "Sam")); assert.ok(!(await getJ("/api/admin/reports", admin)).j.reports.some((x) => x.hostHide));
});

test("the host's bell rings once for a new review, not for an edit", async () => {
  const inbox = srv.app.locals.social.inbox("maya.rv@example.com").filter((n) => n.kind === "review-in");
  const ana = inbox.filter((n) => /^Ana wrote a review of Harvest supper/.test(n.text)); assert.equal(ana.length, 1, "edits don't ring again");
  assert.ok(inbox.some((n) => /^Tom wrote a review of Pasta night: 5 stars/.test(n.text))); assert.ok(inbox.every((n) => n.link === "/@maya-rv#kudos"));
});

test("report and removal: a review the team took down is gone everywhere and counts nowhere; blocked people can't review", async () => {
  const pub = (await view({ host: "maya-rv" })).j, lena = pub.reviews.find((r) => r.name === "Lena");
  // the report itself goes through /api/report, by the words, like kudos
  const rep = await post("/api/report", { type: "review", text: lena.love, reason: "fake", name: "Lena" }); assert.equal(rep.status, 200);
  const sum0 = R.summaryOf(ws);
  makeSafety(srv.store).hide("text:" + textHash(lena.love), { by: "admin.rv@example.com" }); R.bust();
  const after1 = (await view({ host: "maya-rv" })).j; assert.ok(!after1.reviews.some((r) => r.name === "Lena")); assert.equal(after1.count, sum0.count - 1);
  assert.equal(R.summaryOf(ws).rating.n, sum0.rating.n - 1, "a removed review's rating doesn't count");
  makeSafety(srv.store).unhide("text:" + textHash(lena.love)); R.bust();
  // blocks, either way round
  const key = Buffer.from("p4.rv@guest.example.com").toString("base64url");
  assert.equal((await post("/api/me/blocks", { kind: "person", key, name: "Jo" }, host)).status, 200);
  const b = await write("p4", "rvPaid", { text: "Trying to edit after being blocked by the host." }); assert.equal(b.status, 403); assert.match(b.j.message, /can't review this host/);
  assert.equal((await fetch(srv.base + "/api/me/blocks?target=" + encodeURIComponent("person:" + key), { method: "DELETE", headers: { cookie: host } })).status, 200);
  assert.equal((await post("/api/me/blocks", { kind: "host", handle: "maya-rv" }, priya)).status, 200);
  assert.equal((await post("/api/public/reviews", { subject: "event:rvFree", text: "I blocked this host and should not be able to review." }, priya)).status, 403);
  assert.equal((await fetch(srv.base + "/api/me/blocks?target=" + encodeURIComponent("host:maya-rv"), { method: "DELETE", headers: { cookie: priya } })).status, 200);
});

test("where they show: the host page's data, the hire view and directory card, and the feed's quote", async () => {
  const P = (await getJ("/api/public/profile/maya-rv")).j.strengths;
  assert.ok(P.reviews.length >= 6); assert.equal(P.reviewCount, P.reviews.length); assert.ok(P.rating && P.rating.n >= 3);
  const r = P.reviews.find((x) => x.name === "Ana"); assert.equal(r.review, true); assert.equal(r.event, "Harvest supper"); assert.equal(r.what, "Came to"); assert.match(r.month, /^\d{4}-\d{2}$/); assert.equal(r.verifiedLabel, "Replied I'm in");
  for (const k of ["email", "rid", "authorKey", "mine", "own", "hidden"]) assert.ok(!(k in r), k + " never leaves on a public page");
  assert.ok(P.reviews.find((x) => x.pinned), "pinned ones are marked"); assert.ok(P.reviews[0].pinned, "and come first");
  // kudos from someone who also wrote a review: one card, not two
  assert.equal((await post("/api/public/kudos", { eventId: "rvFree", rid: rid.ana, code: code.ana, tags: ["food", "again"], love: "Best broth in Brooklyn" })).status, 200);
  assert.equal((await write("ana", "rvFree", { text: WORDS })).status, 200);
  const P2 = (await getJ("/api/public/profile/maya-rv")).j.strengths; assert.ok(!P2.kudos.some((k) => k.name === "Ana"), "her kudos note gives way to her review"); assert.deepEqual(P2.reviews.find((x) => x.name === "Ana").tags, ["food", "again"]);
  // the hire view and the directory card: "4.x · N reviews", real numbers only
  const T = (await getJ("/api/public/host/maya-rv/trust")).j; assert.equal(T.reviews, P2.reviewCount); assert.deepEqual(T.rating, P2.rating);
  assert.equal(T.lines.find((l) => l.k === "reviews").text, `${P2.rating.avg.toFixed(1)} · ${P2.reviewCount} reviews`);
  assert.ok(T.testimonials[0].review, "reviews lead the testimonials"); assert.equal(T.testimonials[0].label, "Review from a guest on Pottery Lab");
  const lou = (await getJ("/api/public/host/lou-rv/trust")).j; assert.equal(lou.reviews, 0); assert.ok(!lou.lines.some((l) => l.k === "reviews"), "no reviews, no line");
  const D = (await getJ("/api/public/hosts")).j.hosts.find((h) => h.handle === "maya-rv"); assert.equal(D.reviews, P2.reviewCount); assert.deepEqual(D.rating, P2.rating);
  assert.match(fs.readFileSync(path.join(ROOT, "public/hosts.html"), "utf8"), /\["reviews", "bookings", "returned", "again", "guests"\]/);
  // the feed: a past event's quote is a review now, scrubbed and cut on a sentence
  const X = srv.app.locals.social, I = X.index(), c = srv.app.locals.feedVisual.card(I, I.events.get("rvPaid"), {}); assert.equal(c.quote.review, true); assert.ok(c.quote.rating >= 4); assert.ok(c.quote.text.length <= 220);
  // what a person may still review with this host: the ones without a review first
  const W = (await view({ host: "maya-rv", proofs: [{ id: "rvPaid", rid: rid.p4, code: code.p4 }] })).j.writable; assert.equal(W.length, 1); assert.equal(W[0].subject, "event:rvPaid"); assert.equal(W[0].title, "Pasta night"); assert.ok(W[0].mine);
  assert.deepEqual((await view({ host: "maya-rv" })).j.writable, []); assert.ok(!("writable" in (await view({ host: "maya-rv" }, host)).j), "the host has nothing to write on their own page");
});

test("rate limit: a burst of writes from one place is stopped", async () => {
  R.resetLimits(); let last;
  for (let i = 0; i <= WRITES_PER_HOUR; i++) last = await write("bo", "rvFree", { text: `Writing number ${i} of the same review again.` });
  assert.equal(last.status, 429); assert.equal(last.j.code, "rate_limited"); R.resetLimits();
});

test("the pages carry their hooks, small and marked, and the budgets hold", () => {
  const rd = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
  assert.match(rd("public/host.html"), /<script src="\/kudoswall\.js"><\/script><script src="\/reviews\.js"><\/script>/);
  assert.match(rd("public/kudos.html"), /<script src="\/reviews\.js" defer><\/script>/); assert.match(rd("public/booking.html"), /EncoreReviews\.block\(b, \{ booking: id, t \}/); assert.match(rd("public/droppage.js"), /EncoreReviews\?\.block\(b, \{ event: id \}/);
  const idx = rd("index.html"); assert.match(idx, /add\("\/reviews\.js"\)/); assert.ok(idx.lastIndexOf("<script>") === idx.lastIndexOf("<script>\n// ---- \"Come with me?\""), "the Come with me loader is still the last script");
  assert.ok(!/reviews\.js/.test(rd("public/invite.html")), "the light invite doesn't load it"); assert.ok(rd("public/invite.html").length < 40000);
  const src = rd("public/reviews.js"), css = src.slice(src.indexOf("const CSS = `"), src.indexOf("`;", src.indexOf("const CSS = `")));
  assert.ok(!/font-family:\s*["A-Z]/.test(css) && !/var\(--(pl-font-display|sys-display|sys-serif)/.test(css), "IBM Plex through the tokens, no display face");
  assert.match(src, /role="img" aria-label="\$\{n\} out of 5 stars"/); assert.match(src, /aria-label="\$\{SAY\[i\]\}"/); assert.ok(!/[★⭐☆]/u.test(src), "stars are drawn, not emoji");
  assert.match(src, /Its star rating still counts toward your average/);
  assert.ok(!/—/.test(src + rd("server/reviews.js")), "no em dashes");
});
