// Story and feed buttons go to the most direct place to act: an event's light invite (/e/<id>), a team experience's own
// page with its request form (/x/<handle>/<id>), or "I'm interested" on a preview host's thing. Follow is the only
// button that opens a host page. Interest is stored per handle, never emailed to the preview host, and the people who
// asked get one email when someone takes the handle.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { fakeOutbox } from "../server/email.js";

let srv;
const J = { "content-type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (path, cookie) => fetch(srv.base + path, { headers: cookie ? { cookie } : {}, redirect: "manual" });
const put = (path, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const join = async (name, email) => { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); const b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); return { cookie: cookieOf(r), ws: b.workspace.id }; };
const wait = async (f, ms = 2000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = f(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); } return f(); };
const S = {};

before(async () => {
  srv = await startServer();
  Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "cta-secret", ENCORE_SIGNUP_PER_HOUR: "200", ENCORE_FAKE_EMAIL: "1", ENCORE_INTEREST_PER_IP_HOUR: "100", ENCORE_ADMIN_EMAILS: "boss.cta@example.com" }); resetLoginLimits();
  const base = { kind: "social", casual: true, city: "Brooklyn", activity: "dinner", discoverable: true };
  // Mai: a past supper with a next date, and upcoming ones of every kind
  S.mai = await join("Mai Pham", "mai.cta@example.com");
  assert.ok((await post("/api/host/profile", { handle: "mai-cta", name: "Mai's supper club", city: "Brooklyn" }, S.mai.cookie)).ok);
  for (const [id, x] of [["ctaPast", { name: "Dumpling supper", date: day(-3) }], ["ctaNext", { name: "Dumpling supper", date: day(9) }], ["ctaAsk", { name: "Ask supper", date: day(6), approvalRequired: true }],
    ["ctaPre", { name: "Cake pre-order", date: day(4), preorder: true }], ["ctaIdea", { name: "Picnic, anyone?", date: day(12), stage: "interest" }]])
    assert.equal((await put("events/" + id, { ...base, ...x }, S.mai.cookie)).status, 200);
  // Bo takes team requests: a past event and nothing next
  S.bo = await join("Bo Tran", "bo.cta@example.com");
  const pb = await (await post("/api/host/profile", { handle: "bo-cta", name: "Bo's kitchen", city: "Brooklyn", forHire: true, respondsIn: "2 days", experiences: [{ name: "Dumpling class for your team", price: "$60", min: 8, max: 30, length: "2 hours", includes: ["Aprons", "All the dough"], runOfShow: ["Fold", "Steam", "Eat"] }] }, S.bo.cookie)).json();
  S.boExp = pb.host.experiences[0].id; assert.ok(S.boExp);
  assert.equal((await put("events/ctaBoPast", { ...base, name: "Bo's dumpling night", date: day(-5) }, S.bo.cookie)).status, 200);
  // Lu: a past event, nothing next, nothing to book
  S.lu = await join("Lu Ng", "lu.cta@example.com");
  assert.ok((await post("/api/host/profile", { handle: "lu-cta", name: "Lu's walks", city: "Brooklyn" }, S.lu.cookie)).ok);
  assert.equal((await put("events/ctaLuPast", { ...base, name: "Lu's park walk", date: day(-6), activity: "walk" }, S.lu.cookie)).status, 200);
  srv.app.locals.social.bust();
});
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL", "ENCORE_INTEREST_PER_IP_HOUR", "ENCORE_ADMIN_EMAILS"]) delete process.env[k]; await srv.close(); });

test("CTA per story type: events go to /e with the right word, past events to the next date, a booking, or Follow", async () => {
  const F = await (await get("/api/public/feed")).json(), items = F.stories.flatMap((s) => s.items), it = (id) => items.find((i) => i.id === id);
  assert.deepEqual(it("f:ctaNext").cta, { label: "I'm in", url: "/e/ctaNext" });
  assert.deepEqual(it("f:ctaAsk").cta, { label: "Ask to join", url: "/e/ctaAsk" });
  assert.deepEqual(F.upcoming.find((c) => c.id === "ctaPre").cta, { label: "Order", url: "/e/ctaPre" }, "a pre-order (three upcoming per ring, so its card)");
  assert.deepEqual(it("f:ctaIdea").cta, { label: "I'd go", url: "/e/ctaIdea" });
  for (const i of items) { assert.notEqual(i.cta.label, "See page"); assert.notEqual(i.cta.label, "See invite"); if (i.cta.label !== "Follow") assert.doesNotMatch(i.cta.url, /^\/@/, JSON.stringify(i)); }
  // prepared (preview) pages fill a quiet feed: every item is "I'm interested", on that thing's own page
  const sc = F.stories.filter((s) => s.showcase); assert.ok(sc.length, "preview rings");
  for (const s of sc) for (const i of s.items) { assert.equal(i.cta.label, "I'm interested"); assert.match(i.cta.url, /^\/x\/[a-z0-9-]+\/(x\d|g\d|any|shop\/\d)/); }
  const tram = sc.find((s) => s.host.handle === "tram"); assert.ok(tram?.items.some((i) => i.cta.url === "/x/tram/x0"), "Tram's matcha workshop");
  // feed cards carry the same buttons
  const past = (id) => F.past.find((c) => c.id === id);
  assert.deepEqual(past("ctaPast").cta, { label: "I'm in", url: "/e/ctaNext" }, "the same supper's next date");
  assert.deepEqual(past("ctaBoPast").cta, { label: "Book for your team", url: "/x/bo-cta/" + S.boExp });
  assert.deepEqual(past("ctaLuPast").cta, { label: "Follow", url: "/@lu-cta", follow: "lu-cta" });
  assert.deepEqual(F.upcoming.find((c) => c.id === "ctaAsk").cta, { label: "Ask to join", url: "/e/ctaAsk" });
  for (const S0 of F.showcase) { assert.equal(S0.cta.label, "I'm interested"); for (const x of S0.experiences) assert.match(x.url, /^\/x\//); }
  // the feed's own buttons: one per card, "See invite" and "See page" gone
  const fv = await (await fetch(srv.base + "/feedvisual.js")).text();
  assert.doesNotMatch(fv, />See invite</); assert.doesNotMatch(fv, /">See page<\/a>/); assert.match(fv, /ctaBtn\(ctaOf\(e\)\)/);
});

test("A real host's experience page: Book for your team, prefilled, sends the request; OG meta", async () => {
  const r = await get("/x/bo-cta/" + S.boExp); assert.equal(r.status, 200); const h = await r.text();
  assert.match(h, /<h2 id="act">Book for your team<\/h2>/); assert.match(h, /Dumpling class for your team/); assert.match(h, /<meta property="og:title" content="Dumpling class for your team · Bo&#39;s kitchen">/);
  assert.match(h, /og:image" content="http:\/\/127\.0\.0\.1:\d+\/og\/[a-z]+\.png"/); assert.match(h, /Run of show/); assert.match(h, /Aprons/); assert.match(h, /name="people" type="number" min="8"/);
  assert.match(h, new RegExp(`EX=${JSON.stringify(S.boExp)}`)); assert.match(h, new RegExp(`/@bo-cta\\?exp=${S.boExp}#book`));
  const b = await post("/api/public/book/bo-cta", { experienceId: S.boExp, name: "Ana", email: "ana.cta@acme.com", company: "Acme", date: day(30), people: 12, when: "a Friday", message: "" }); assert.equal(b.status, 200, await b.clone().text());
  assert.equal((await get("/x/bo-cta/nope")).status, 302, "an unknown id on a real page goes to the page"); assert.equal((await get("/x/nobody-here/x0")).status, 404);
});

test("Preview pages: I'm interested is stored, validated, scrubbed, capped by rate, and never emailed to the host", async () => {
  const pg = await (await get("/x/tram/x0")).text();
  assert.match(pg, /<h2 id="act">I'm interested<\/h2>/); assert.match(pg, /Tram isn't taking requests on Pottery Lab yet\. Leave your email and we'll tell you when you can book\./); assert.doesNotMatch(pg, /—/);
  assert.equal((await get("/x/tram/shop/0")).status, 200, "a preview shop item has its own page"); assert.match(await (await get("/x/tram/shop/0")).text(), /How many/);
  const out0 = fakeOutbox.length;
  const ok = await post("/api/public/interest/tram", { item: "x0", name: "Ana Diaz", email: "Ana.CTA@acme.com", size: 14, note: "Our offsite. Call me at 415 555 0101 or ana@acme.com" }); assert.equal(ok.status, 200, await ok.clone().text());
  assert.equal((await ok.json()).first, "Tram");
  assert.equal((await post("/api/public/interest/tram", { item: "x0", name: "Ana Diaz", email: "ana.cta@acme.com", size: 16 })).status, 200, "asking again updates");
  assert.equal((await post("/api/public/interest/tram", { item: "shop:0", name: "Jo", email: "jo.cta@example.com" })).status, 200);
  const d = srv.store.get("system/interest-tram").data; assert.equal(d.list.length, 2); const a = d.list.find((x) => x.email === "ana.cta@acme.com");
  assert.equal(a.size, 16); assert.equal(a.title, "Matcha workshop for your team"); assert.doesNotMatch(JSON.stringify(d.list), /415 555|ana@acme\.com/);
  for (const [body, code] of [[{ item: "x0", name: "", email: "a@b.co" }, 400], [{ item: "x0", name: "A", email: "nope" }, 400], [{ item: "x9", name: "A", email: "a@b.co" }, 404], [{ item: "x0", name: "A", email: "a@b.co", size: "lots" }, 400]])
    assert.equal((await post("/api/public/interest/tram", body)).status, code, JSON.stringify(body));
  assert.equal((await post("/api/public/interest/nobody-here", { item: "x0", name: "A", email: "a@b.co" })).status, 404);
  assert.equal((await post("/api/public/interest/bo-cta", { item: S.boExp, name: "A", email: "a@b.co" })).status, 409, "a real host takes requests, not interest");
  assert.equal(fakeOutbox.length, out0, "nobody is emailed: not the preview host, not the person who asked");
  // admins list it; nobody else can
  const boss = await join("Boss", "boss.cta@example.com"); const L = await (await get("/api/admin/interest", boss.cookie)).json();
  assert.equal(L.handles.find((x) => x.handle === "tram").count, 2); assert.equal((await get("/api/admin/interest", S.mai.cookie)).status, 404); assert.equal((await get("/admin/interest")).status, 404);
  assert.match(await (await get("/admin/interest", boss.cookie)).text(), /Matcha workshop for your team/);
  // rate limit: per address, per hour
  process.env.ENCORE_INTEREST_PER_IP_HOUR = "2"; assert.equal((await post("/api/public/interest/tram", { item: "x1", name: "Z", email: "z@b.co" })).status, 429); process.env.ENCORE_INTEREST_PER_IP_HOUR = "100";
});

test("When a host takes the handle: each person who asked hears once, when that thing can be booked or ordered, and the host sees who asked", async () => {
  const out0 = fakeOutbox.length, mine = () => fakeOutbox.slice(out0);
  const tram = await join("Tram Le", "tram.cta@example.com");
  // the page is claimed, but nothing on it takes requests yet: nobody is told
  await post("/api/host/profile", { handle: "tram", name: "Tram", city: "Brooklyn" }, tram.cookie); await new Promise((r) => setTimeout(r, 150)); assert.equal(mine().length, 0);
  const p = await (await post("/api/host/profile", { forHire: true, experiences: [{ name: "Matcha workshop for your team", price: "$45", min: 6, max: 20 }] }, tram.cookie)).json();
  const id = p.host.experiences[0].id;
  const ana = await wait(() => mine().find((m) => m.to.includes("ana.cta@acme.com"))); assert.ok(ana, "Ana asked about the workshop");
  assert.match(ana.subject, /^Tram is on Pottery Lab now$/); assert.match(ana.text, new RegExp(`/x/tram/${id}`)); assert.doesNotMatch(ana.text, /—/); assert.match(ana.text, /only email/);
  assert.ok(!mine().some((m) => m.to.includes("jo.cta@example.com")), "Jo asked about a shop item: the shop isn't open yet");
  assert.ok(!mine().some((m) => m.to.includes("tram.cta@example.com")), "the host isn't emailed");
  let H = await (await get("/api/host/interest", tram.cookie)).json(); assert.equal(H.total, 2); assert.equal(H.told, false);
  assert.ok(H.items.some((x) => x.line === "1 person asked about Matcha workshop for your team" && x.url === `/x/tram/${id}`), JSON.stringify(H.items));
  // the shop opens with the same item: Jo hears, with its order page
  const sp = await (await post("/api/host/profile", { shop: { open: true, title: "This week's bake", slots: ["Saturday 10am"], items: [{ name: "Bánh patê sô (box of 4)", cents: 2000, stock: 12 }] } }, tram.cookie)).json();
  const sid = sp.host.shop.items[0].id;
  const jo = await wait(() => mine().find((m) => m.to.includes("jo.cta@example.com"))); assert.ok(jo); assert.match(jo.text, new RegExp(`/x/tram/shop/${sid}`));
  // once only: another save sends nothing new
  const n = mine().length; await post("/api/host/profile", { tagline: "Matcha for teams." }, tram.cookie); await new Promise((r) => setTimeout(r, 150)); assert.equal(mine().length, n); assert.equal(n, 2);
  H = await (await get("/api/host/interest", tram.cookie)).json(); assert.equal(H.told, true);
  assert.equal((await (await get("/api/host/interest", S.mai.cookie)).json()).total, 0, "other hosts see nothing");
  // the preview links now open the real things, and interest is closed
  const r = await get("/x/tram/x0"); assert.equal(r.status, 302); assert.equal(r.headers.get("location"), `/x/tram/${id}`);
  assert.equal((await get("/x/tram/shop/0")).headers.get("location"), `/x/tram/shop/${sid}`);
  assert.equal((await post("/api/public/interest/tram", { item: "x0", name: "A", email: "a@b.co" })).status, 404, "x0 was the preview's id");
  assert.match(await (await get(`/x/tram/${id}`)).text(), /Book for your team/);
  assert.match(await (await get(`/x/tram/shop/${sid}`)).text(), /<h2 id="act">Order<\/h2>/);
  const o = await post("/api/public/order/tram", { name: "Jo", email: "jo.cta@example.com", slot: "Saturday 10am", items: [{ id: sid, qty: 2 }] }); assert.equal(o.status, 200, await o.clone().text());
});
