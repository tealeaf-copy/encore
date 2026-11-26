// The peek on Plans (server/plans.js GET /api/plans/peek/:id and POST /api/plans/peek/:id/reply, public/peek.js):
// what each viewer may see (the area, the venue or the address by their reply; no other guest's contact), changing a
// reply right there through the invite's own write (only your own reply), paid spots and asks to join staying on the
// event page, leaving the waitlist, and the host's own view.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore, claimEvent } from "../server/workspaces.js";
import { replyRule, whenLine, replyState, scrubberOf } from "../server/plans.js";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
let srv, mina, ivy, zoe; const J = { "Content-Type": "application/json" };
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "peek-secret", ENCORE_FAKE_EMAIL: "1", ENCORE_SIGNUP_PER_HOUR: "100" };
const post = (p, b, h = {}) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...h }, body: JSON.stringify(b) });
const get = (p, h = {}) => fetch(srv.base + p, { headers: h });
async function join(name, email, handle) { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200); const c = r.headers.get("set-cookie").split(";")[0];
  await post("/api/host/profile", { name, handle, city: "Brooklyn", hood: "Greenpoint" }, { cookie: c }); return { cookie: c, ws: srv.store.get("system/handle-" + handle).data.ws, email }; }
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const ev = (w, id, e) => { claimEvent(id, w); scopeStore(srv.store, w).set("events/" + id, { id, published: true, discoverable: true, city: "Brooklyn", tz: "America/New_York", createdAt: Date.now(), ...e }); };
const rs = (w, rid, r) => scopeStore(srv.store, w).set("rsvps/" + rid, { code: "K" + rid, _k: "key-" + rid, createdAt: Date.now(), ...r });
const resp = (rid) => scopeStore(srv.store, mina.ws).get("rsvps/" + rid).data.response;
const peek = async (id, h = {}, q = "") => { const r = await get(`/api/plans/peek/${id}${q}`, h); return r.ok ? (await r.json()).peek : r.status; };
const ADDR = "88 Noble St, Apt 3";

before(async () => { Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer();
  mina = await join("Mina Cho", "mina.peek@example.com", "mina-peek"); ivy = await join("Ivy Lane", "ivy.peek@example.com", "ivy-peek"); zoe = await join("Zoe Ray", "zoe.peek@example.com", "zoe-peek");
  ev(mina.ws, "kDinner", { name: "Dumpling night", date: day(3), startTime: "19:00", hood: "Greenpoint", venueName: "Mina's place", venueAddr: ADDR, headcount: 10, casual: true,
    pubDesc: "We fold, we steam, we eat. Bring a friend if you like. Ring the bell at 88 Noble St when you get here. Shoes off at the door, slippers are there." });
  rs(mina.ws, "dIvy", { eventId: "kDinner", email: ivy.email, name: "Ivy Lane", phone: "+15550001111", response: "going" });
  rs(mina.ws, "dZoe", { eventId: "kDinner", email: zoe.email, name: "Zoe Ray", response: "maybe" });
  rs(mina.ws, "dSam", { eventId: "kDinner", email: "sam.secret@example.com", name: "Sam Lee", phone: "+15550002222", response: "going", dietary: "Shellfish allergy" });
  rs(mina.ws, "dHid", { eventId: "kDinner", email: "hidden@example.com", name: "Hidden Person", response: "going", showMe: false });
  ev(mina.ws, "kFull", { name: "Tiny tasting", date: day(4), startTime: "18:00", hood: "Greenpoint", venueName: "The back room", headcount: 1 });
  rs(mina.ws, "fIn", { eventId: "kFull", email: "in@example.com", name: "Al", response: "going" });
  rs(mina.ws, "fW1", { eventId: "kFull", email: "first@example.com", name: "Bea", response: "waitlist", waitAt: 1 });
  rs(mina.ws, "fIvy", { eventId: "kFull", email: ivy.email, name: "Ivy Lane", response: "waitlist", waitAt: 2 });
  rs(mina.ws, "fW3", { eventId: "kFull", email: "third@example.com", name: "Cy", response: "waitlist", waitAt: 3 });
  ev(mina.ws, "kPaid", { name: "Pasta class", date: day(5), startTime: "18:30", hood: "Greenpoint", price: "$25" });
  rs(mina.ws, "pIvy", { eventId: "kPaid", email: ivy.email, name: "Ivy Lane", response: "maybe" });
  ev(mina.ws, "kPaidIn", { name: "Bread class", date: day(6), startTime: "10:00", hood: "Greenpoint", price: "$30" });
  rs(mina.ws, "piIvy", { eventId: "kPaidIn", email: ivy.email, name: "Ivy Lane", response: "going", paid: true });
  ev(mina.ws, "kAsk", { name: "Supper by invite", date: day(7), startTime: "20:00", hood: "Greenpoint", venueName: "Mina's place", venueAddr: ADDR, approvalRequired: true, casual: true });
  rs(mina.ws, "aIvy", { eventId: "kAsk", email: ivy.email, name: "Ivy Lane", response: "maybe" });
  rs(mina.ws, "aAsk", { eventId: "kAsk", email: "asker@example.com", name: "Dee Asker", response: "requested" });
  ev(mina.ws, "kOld", { name: "Last week's walk", date: day(-5), startTime: "09:00", hood: "Greenpoint" });
  rs(mina.ws, "oIvy", { eventId: "kOld", email: ivy.email, name: "Ivy Lane", response: "going" });
  ev(zoe.ws, "kDraft", { name: "Zoe's draft", date: day(9), published: false, discoverable: false });
});
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

test("peek privacy: the venue and the address for people who are in, the area for everyone else, no other guest's contact", async () => {
  const inn = await peek("kDinner", { cookie: ivy.cookie });
  assert.equal(inn.role, "guest"); assert.equal(inn.reply.state, "going"); assert.equal(inn.place, "Mina's place, Greenpoint"); assert.equal(inn.locked, false);
  assert.equal(inn.address, ADDR, "in: the street address, as the event page gives it"); assert.match(inn.desc, /88 Noble St/);
  assert.equal(inn.when, whenLine({ date: day(3), startTime: "19:00" })); assert.match(inn.when, /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2} · 7pm$/);
  assert.deepEqual(inn.who.names.map((n) => n.name).sort(), ["Ivy", "Sam"], "first names only, and someone who hid themselves stays hidden");
  assert.equal(inn.who.names.find((n) => n.name === "Ivy").you, true); assert.equal(inn.who.count, 3, "the count still counts everyone who is in");
  assert.equal(inn.host.name, "Mina Cho"); assert.equal(inn.host.href, "/@mina-peek"); assert.equal(inn.href, "/e/kDinner"); assert.equal(inn.actions.chat, "/chats/kDinner"); assert.equal(inn.actions.invite, true);
  const maybe = await peek("kDinner", { cookie: zoe.cookie });
  assert.equal(maybe.reply.state, "maybe"); assert.equal(maybe.place, "Greenpoint, Brooklyn"); assert.equal(maybe.locked, true); assert.equal(maybe.address, "");
  assert.deepEqual(maybe.who.names, [], "not in: no names, only the faces the invite shows"); assert.ok(maybe.who.faces.length >= 1); assert.equal(maybe.actions.chat, ""); assert.equal(maybe.actions.invite, false);
  assert.doesNotMatch(maybe.desc, /88 Noble/, "the address in the description is the area for people who aren't in");
  const anon = await peek("kDinner"); assert.equal(anon.role, "visitor"); assert.equal(anon.locked, true); assert.equal(anon.reply.state, "");
  const wrong = await peek("kDinner", {}, "?rid=dSam&code=nope"); assert.equal(wrong.role, "visitor", "a proof that doesn't match is nobody");
  const sam = await peek("kDinner", {}, "?rid=dSam&code=KdSam"); assert.equal(sam.reply.state, "going"); assert.equal(sam.address, ADDR);
  for (const p of [inn, maybe, anon, sam]) { const s = JSON.stringify(p);
    for (const x of ["sam.secret@", "hidden@", "+1555", "Shellfish", "Hidden", "KdSam", "key-", "Lee", "Lane"]) assert.ok(!s.includes(x), `no ${x} in a peek`); }
  for (const p of [maybe, anon, wrong]) { const s = JSON.stringify(p); assert.ok(!s.includes("Mina's place") && !s.includes("Noble"), "the area only"); }
  // the waitlist and an ask see the area too; drafts and link-only events with no reply are nothing
  const wl = await peek("kFull", { cookie: ivy.cookie }); assert.equal(wl.place, "Greenpoint, Brooklyn"); assert.ok(!JSON.stringify(wl).includes("back room"));
  assert.equal(await peek("kDraft", { cookie: ivy.cookie }), 404); assert.equal(await peek("kDraft"), 404); assert.equal((await peek("kDraft", { cookie: zoe.cookie })).role, "host");
  assert.equal(await peek("nope-id"), 404);
  assert.equal(scrubberOf({ venueAddr: ADDR, hood: "Greenpoint" })("Meet at 88 Noble St, Apt 3"), "Meet at Greenpoint");
});

test("peek replies: in, maybe, can't go through the invite's own write, the row follows, and only your own reply", async () => {
  const say = (b, h = {}) => post("/api/plans/peek/kDinner/reply", b, h);
  // signed in: your account's reply
  let r = await say({ response: "maybe" }, { cookie: ivy.cookie }); assert.equal(r.status, 200); let j = await r.json();
  assert.equal(j.response, "maybe"); assert.equal(resp("dIvy"), "maybe"); assert.equal(j.peek.reply.state, "maybe"); assert.equal(j.peek.locked, true, "not in any more: the area again");
  assert.equal(j.items[0].status, "Maybe", "the timeline row's new status comes back"); assert.equal(j.items[0].eventId, "kDinner");
  assert.equal((await peek("kDinner", { cookie: ivy.cookie })).reply.state, "maybe", "a fresh peek, not the cached one");
  j = await (await say({ response: "no" }, { cookie: ivy.cookie })).json(); assert.equal(resp("dIvy"), "no"); assert.deepEqual(j.items, [], "Can't go: off the timeline");
  const tl = await (await post("/api/plans/timeline", {}, { cookie: ivy.cookie })).json(); assert.ok(!tl.items.some((i) => i.eventId === "kDinner"));
  j = await (await say({ response: "in" }, { cookie: ivy.cookie })).json(); assert.equal(resp("dIvy"), "going"); assert.equal(j.items[0].status, "Going"); assert.equal(j.peek.address, ADDR);
  // the reply this browser holds, signed out
  r = await say({ response: "maybe", rid: "dSam", code: "KdSam" }); assert.equal(r.status, 200); assert.equal(resp("dSam"), "maybe");
  // never someone else's: a wrong code, someone else's id, no proof and no account
  r = await say({ response: "no", rid: "dSam", code: "guess" }, { cookie: zoe.cookie }); assert.equal(r.status, 404); assert.equal(resp("dSam"), "maybe");
  r = await say({ response: "no", rid: "dIvy", code: "KdSam" }); assert.equal(r.status, 404); assert.equal(resp("dIvy"), "going");
  r = await say({ response: "no" }); assert.equal(r.status, 401); assert.equal(resp("dIvy"), "going");
  r = await say({ response: "no" }, { cookie: zoe.cookie }); assert.equal(r.status, 200); assert.equal(resp("dZoe"), "no", "Zoe's account changes Zoe's reply"); assert.equal(resp("dIvy"), "going");
  assert.equal((await say({ response: "later" }, { cookie: ivy.cookie })).status, 400);
  assert.equal((await post("/api/plans/peek/kOld/reply", { response: "no" }, { cookie: ivy.cookie })).status, 409, "over: replies are closed");
  assert.equal((await peek("kOld", { cookie: ivy.cookie })).reply.closed, "This one already happened.");
  assert.equal((await say({ response: "going" }, { cookie: mina.cookie })).status, 409, "the host has no reply to change");
  assert.deepEqual([replyState({ response: "declined" }), replyState({ response: "going" }), replyState(null)], ["no", "going", ""]);
});

test("peek guardrails: a paid spot and an ask to join finish on the event page; the reply stays as it was", async () => {
  const P = await peek("kPaid", { cookie: ivy.cookie }); const a = Object.fromEntries(P.reply.answers.map((x) => [x.value, x]));
  assert.match(a.going.page, /This one is \$25\. Pay on the event page/); assert.equal(a.going.pay, true); assert.equal(a.no.page, undefined);
  let r = await post("/api/plans/peek/kPaid/reply", { response: "in" }, { cookie: ivy.cookie }); assert.equal(r.status, 409); let j = await r.json();
  assert.equal(j.code, "needs_page"); assert.equal(j.href, "/e/kPaid"); assert.equal(j.pay, true); assert.equal(resp("pIvy"), "maybe");
  assert.equal((await post("/api/plans/peek/kPaid/reply", { response: "no" }, { cookie: ivy.cookie })).status, 200, "saying no to a paid one is fine"); assert.equal(resp("pIvy"), "no");
  r = await post("/api/plans/peek/kPaidIn/reply", { response: "maybe" }, { cookie: ivy.cookie }); assert.equal(r.status, 409); assert.match((await r.json()).message, /You paid for this one/); assert.equal(resp("piIvy"), "going");
  const A = await peek("kAsk", { cookie: ivy.cookie }); assert.match(A.reply.answers.find((x) => x.value === "going").page, /Mina lets each guest in\. Ask to join on the event page\./);
  r = await post("/api/plans/peek/kAsk/reply", { response: "going" }, { cookie: ivy.cookie }); j = await r.json(); assert.equal(r.status, 409); assert.equal(j.ask, true); assert.equal(resp("aIvy"), "maybe");
  assert.equal(A.locked, true); assert.ok(!JSON.stringify(A).includes("Noble"));
  // let in once: a later I'm in stays in, right from the peek
  scopeStore(srv.store, mina.ws).update("rsvps/aIvy", { letInAt: Date.now() });
  r = await post("/api/plans/peek/kAsk/reply", { response: "going" }, { cookie: ivy.cookie }); assert.equal(r.status, 200); assert.equal(resp("aIvy"), "going");
  // the rule on its own
  assert.equal(replyRule({ date: day(2) }, { response: "maybe" }, "going").page, "Change your reply on the event page.", "a reply the invite never keyed");
  assert.match(replyRule({ date: day(2), preorder: true }, { response: "maybe", _k: "k" }, "going").page, /order/);
  assert.equal(replyRule({ date: day(2), price: "$10", ticketNote: "Cash at the door" }, { response: "maybe", _k: "k" }, "going").ok, true, "pay at the door: no step online");
  assert.match(replyRule({ date: day(2), kind: "dinner" }, { response: "going", _k: "k" }, "maybe", { host: "Mina" }).error, /yes or no/);
  assert.equal(replyRule({ date: day(2), cancelled: true }, { response: "going" }, "no").closed, "This one was cancelled, so replies are closed.");
});

test("peek waitlist: your place in line, and Leave waitlist frees it", async () => {
  const W = await peek("kFull", { cookie: ivy.cookie }); assert.equal(W.reply.state, "waitlist"); assert.equal(W.reply.pos, 2); assert.equal(W.reply.status, "Waitlist #2");
  const r = await post("/api/plans/peek/kFull/reply", { response: "no" }, { cookie: ivy.cookie }); assert.equal(r.status, 200); const j = await r.json();
  assert.equal(resp("fIvy"), "no"); assert.equal(j.peek.reply.state, "no"); assert.deepEqual(j.items, []);
  assert.equal(resp("fW3"), "waitlist"); const all = scopeStore(srv.store, mina.ws).list("rsvps").filter((d) => d.data.eventId === "kFull" && d.data.response === "waitlist").map((d) => d.id).sort(); assert.deepEqual(all, ["fW1", "fW3"]);
  const host = await peek("kFull", { cookie: mina.cookie }); assert.equal(host.manage.waiting, 2);
});

test("host peek: manage, share, who's in and replies to approve; the host sees their own address", async () => {
  const H = await peek("kAsk", { cookie: mina.cookie });
  assert.equal(H.role, "host"); assert.equal(H.reply, null); assert.equal(H.manage.href, "/?app=1&open=kAsk#studio"); assert.equal(H.manage.share, true);
  assert.equal(H.manage.going, 1); assert.equal(H.manage.asking, 1); assert.equal(H.manage.approve, "/inbox"); assert.equal(H.address, ADDR); assert.equal(H.locked, false); assert.equal(H.actions.chat, "/chats/kAsk");
  assert.deepEqual(H.who.names.map((n) => n.name), ["Ivy"]); assert.ok(!JSON.stringify(H).includes("asker@"));
  const D = await peek("kDraft", { cookie: zoe.cookie }); assert.equal(D.manage.draft, true); assert.equal(D.manage.share, false); assert.equal(D.actions.calendar, false);
  const res = await get("/api/plans/peek/kAsk", { cookie: mina.cookie }); assert.match(res.headers.get("cache-control"), /private/);
});

test("the page: rows are real links that open the peek, the sheet's parts, brand tokens and plain copy", () => {
  const ctx = { window: {}, document: { cookie: "", addEventListener() {}, querySelector: () => null }, addEventListener() {}, localStorage: { getItem: () => null }, Intl, Date, JSON, Math, encodeURIComponent };
  vm.createContext(ctx); vm.runInContext(read("public/timeline.js"), ctx); vm.runInContext(read("public/peek.js"), ctx); const T = ctx.window.PLTimeline, K = ctx.window.PLPeek;
  const row = T.rowHtml({ key: "going:e1", kind: "going", eventId: "e1", title: "Dumplings", date: "2026-12-05", time: "19:00", href: "/e/e1" });
  assert.match(row, /<a class="tl-a" href="\/e\/e1" data-peek="e1">/, "a real link, with the peek on a plain tap");
  const base = { id: "e1", title: "Dumplings", href: "/e/e1", invite: "/e/e1", when: "Fri, Dec 5 · 7pm", place: "Greenpoint, Brooklyn", locked: true, host: { name: "Mina Cho", first: "Mina", href: "/@mina" }, desc: "Fold and steam.", who: { count: 4, names: [], faces: [] }, actions: { calendar: true } };
  const g = K.html({ ...base, role: "guest", reply: { state: "maybe", answers: [{ value: "going", label: "I'm in" }, { value: "maybe", label: "Maybe" }, { value: "no", label: "Can't go" }] } });
  assert.match(g, /<button type="button" data-pk-set="maybe" aria-pressed="true">Maybe<\/button>/); assert.match(g, />I&#39;m in</); assert.match(g, />Can&#39;t go</);
  assert.match(g, /address when you're in/); assert.match(g, /href="\/@mina"/); assert.match(g, /class="pk-title" id="pkTitle">Dumplings/); assert.match(g, /pk-btn pk-pri" href="\/e\/e1"/); assert.match(g, /Open event page/); assert.match(g, /Add to calendar/);
  const w = K.html({ ...base, role: "guest", reply: { state: "waitlist", pos: 2, answers: [] } }); assert.match(w, /You&#39;re #2 on the waitlist|You're #2 on the waitlist/); assert.match(w, />Leave waitlist</);
  const h = K.html({ ...base, role: "host", locked: false, manage: { href: "/?app=1&open=e1#studio", going: 12, asking: 2, waiting: 0, share: true, approve: "/inbox" }, actions: { calendar: true, chat: "/chats/e1" } });
  assert.match(h, /Manage event/); assert.match(h, /Share invite/); assert.match(h, /<b>12<\/b> in/); assert.match(h, /Review 2 replies to approve/); assert.match(h, /Open group chat/); assert.doesNotMatch(h, /address when/);
  const p = read("public/plans.html"); assert.match(p, /\/peek\.js/); assert.match(p, /\/peek\.css/); assert.match(p, /PLPeek\?\.attach\(\$\("ppMain"\)/);
  const js = read("public/peek.js"); assert.match(js, /pushState/); assert.match(js, /popstate/); assert.match(js, /"Escape"/); assert.match(js, /touchstart/); assert.match(js, /e\.metaKey \|\| e\.ctrlKey/);
  assert.match(js, /pressed\(was\)/, "a refused change goes back"); assert.match(js, /aria-modal="true"/);
  for (const f of ["public/peek.js", "public/peek.css", "server/plans.js", "test/plans-peek.test.js"]) assert.ok(!read(f).includes(String.fromCharCode(0x2014)), f + " has an em dash");
  assert.doesNotMatch(read("public/peek.css"), /#[0-9a-f]{3,6}\b/i, "colours come from the brand tokens");
});
