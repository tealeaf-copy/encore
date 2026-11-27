import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";

let srv;
const J = { "content-type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (path, cookie) => fetch(srv.base + path, { headers: cookie ? { cookie } : {} });
const put = (path, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
const join = async (name, email) => { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); const b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); return { cookie: cookieOf(r), ws: b.workspace.id }; };
const guest = (ws, body) => fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, "x-encore-guest": "1", "x-encore-key": "k" + Math.random().toString(36).slice(2), "x-encore-workspace": ws }, body: JSON.stringify({ createdAt: Date.now(), ...body }) });
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "hosts-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; process.env.ENCORE_FAKE_EMAIL = "1"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv.close(); });

test("Claire: broadcast to the people it suits, a hype report, approval before the chat, polls for help, tips, and brands hiring her", async () => {
  const claire = await join("Claire Kim", "claire@example.com"), dev = await join("Dev Rao", "dev@example.com"), ana = await join("Ana Diaz", "ana@example.com");
  // Dev lives in New York and wants hikes; Ana is in Sydney
  assert.equal((await post("/api/me/alerts", { text: "hikes on weekends in New York", city: "New York" }, dev.cookie)).status, 200);
  assert.equal((await post("/api/host/profile", { city: "New York", tags: ["running", "hiking"] }, dev.cookie)).status, 200);
  assert.equal((await post("/api/host/profile", { city: "Sydney" }, ana.cookie)).status, 200);
  const ev = { name: "Upstate hike", activity: "hike", kind: "social", casual: true, city: "New York", stage: "interest", dateOptions: [day(10), day(11)], interestGoal: 3, audienceWho: "Run club members who like hiking", approvalRequired: true };
  assert.equal((await put("events/hike1", ev, claire.cookie)).status, 200);
  const aud = await (await get("/api/host/audience/hike1", claire.cookie)).json();
  assert.equal(aud.count, 1, JSON.stringify(aud)); assert.equal(aud.sample[0].name, "Dev");
  const bc = await (await post("/api/host/broadcast", { eventId: "hike1" }, claire.cookie)).json();
  assert.equal(bc.reached, 1);
  assert.ok((await (await get("/api/me/inbox", dev.cookie)).json()).items.some((n) => n.kind === "invite" && /Upstate hike/.test(n.text)));
  assert.ok(!(await (await get("/api/me/inbox", ana.cookie)).json()).items.some((n) => n.kind === "invite"), "Sydney isn't told about a New York hike");
  // interest comes in; the page is viewed
  await post("/api/public/view/hike1", {}); await post("/api/public/view/hike1", {});
  const r1 = await (await guest(claire.ws, { eventId: "hike1", name: "Dev Rao", email: "dev@example.com", response: "maybe", interest: "in", dates: [day(10)], code: "DR1" })).json();
  await guest(claire.ws, { eventId: "hike1", name: "Sam Lee", email: "sam@example.com", response: "maybe", interest: "maybe", dates: [day(10), day(11)], code: "SL1" });
  const hype = await (await get("/api/host/hype/hike1", claire.cookie)).json();
  assert.equal(hype.views, 2); assert.equal(hype.in, 1); assert.equal(hype.maybe, 1); assert.equal(hype.bestDate.date, day(10)); assert.equal(hype.bestDate.yes, 2); assert.equal(hype.reached, 1);
  // a requested spot can't see the chat until Claire approves
  const req1 = await (await guest(claire.ws, { eventId: "hike1", name: "Kim Ho", email: "kim@example.com", response: "requested", code: "KH1" })).json();
  assert.equal((await get(`/api/public/chat/hike1?rid=${req1.id}&code=KH1`)).status, 403);
  const cur = (await (await get("/api/db/doc?path=rsvps/" + req1.id, claire.cookie)).json());
  assert.equal((await fetch(srv.base + "/api/db/doc?path=rsvps/" + req1.id, { method: "PATCH", headers: { ...J, cookie: claire.cookie }, body: JSON.stringify({ response: "going" }) })).status, 200, JSON.stringify(cur));
  assert.equal((await get(`/api/public/chat/hike1?rid=${req1.id}&code=KH1`)).status, 200, "approved, so they're in the chat");
  // a poll for help
  const poll = await (await post("/api/host/poll", { eventId: "hike1", q: "Who can help?", options: ["Drive a car", "Bring snacks"], help: true }, claire.cookie)).json();
  assert.equal((await post(`/api/public/poll/${poll.id}/vote`, { eventId: "hike1", rid: req1.id, code: "KH1", option: "Drive a car" })).status, 200);
  assert.equal((await post(`/api/public/poll/${poll.id}/vote`, { eventId: "hike1", rid: r1.id, code: "DR1", option: "Drive a car" })).status, 403, "maybes can't vote");
  const chat = await (await get(`/api/public/chat/hike1?rid=${req1.id}&code=KH1`)).json();
  const pm = chat.messages.find((m) => m.poll); assert.deepEqual(pm.poll.votes["Drive a car"], ["Kim"]); assert.deepEqual(pm.poll.myVotes, ["Drive a car"]); assert.ok(!JSON.stringify(chat).includes(req1.id), "no guest ids leak");
  assert.ok((await (await get("/api/me/inbox", claire.cookie)).json()).items.some((n) => n.kind === "help"));
  // tips after the day
  assert.equal((await post("/api/public/tipped", { eventId: "hike1", rid: req1.id, code: "KH1", amount: 10 })).status, 200);
  assert.ok((await (await get("/api/me/inbox", claire.cookie)).json()).items.some((n) => n.kind === "tip" && /\$10/.test(n.text)));
  // brands find Claire and send an inquiry
  assert.equal((await post("/api/host/profile", { forHire: true, city: "New York", services: "Run club activations, group hikes, supper clubs", venmo: "@claire-runs" }, claire.cookie)).status, 200);
  const dir = await (await get("/api/public/hosts?city=new york")).json();
  assert.equal(dir.hosts.length, 1); assert.equal(dir.hosts[0].name, "Claire Kim");
  const handle = dir.hosts[0].handle;
  assert.equal((await post("/api/public/inquiry/" + handle, { name: "Jo", company: "Trail Co", email: "jo@trail.example", message: "We'd love you to host a launch run for our new shoe." })).status, 200);
  assert.equal((await post("/api/public/inquiry/" + handle, { email: "bad", message: "hi" })).status, 400);
  const inq = await (await get("/api/host/inquiries", claire.cookie)).json(); assert.equal(inq.inquiries[0].company, "Trail Co");
  const eh = await (await get("/api/public/event-host/hike1")).json(); assert.equal(eh.host.venmo, "claire-runs");
});

test("Eric: followers get first dibs on a ticketed dinner", async () => {
  const eric = await join("Eric Tan", "eric@example.com");
  const handle = (await (await get("/api/host/profile", eric.cookie)).json()).host.handle;
  assert.equal((await put("events/omakase1", { name: "Omakase at home", activity: "cooking night", kind: "social", casual: true, date: day(14), headcount: 12, price: "$65", earlyUntil: new Date(Date.now() + 2 * 864e5).toISOString(), courses: ["Hamachi crudo", "Miso black cod"] }, eric.cookie)).status, 200);
  const stranger = await guest(eric.ws, { eventId: "omakase1", name: "Pat", email: "pat@example.com", response: "going", code: "P1" });
  assert.equal(stranger.status, 403); assert.equal((await stranger.json()).code, "early_access");
  assert.equal((await post("/api/public/follow", { handle })).status, 401, "following takes at least an email");
  assert.equal((await post("/api/signup", { name: "Pat Lee", email: "pat@example.com", password: "long-password-1", mode: "friends", regularOf: handle })).status, 200, "joining from Eric's page follows him");
  assert.equal((await guest(eric.ws, { eventId: "omakase1", name: "Pat", email: "pat@example.com", response: "going", code: "P1" })).status, 200, "followers can book");
  const pub = await (await fetch(srv.base + "/api/db/doc?path=events/omakase1", { headers: { "x-encore-guest": "1" } })).json();
  assert.deepEqual(pub.data.courses, ["Hamachi crudo", "Miso black cod"]); assert.ok(pub.data.earlyUntil);
});

test("Storefronts: curated theme with guardrails, https-only links, the /@handle URL, and signed-in members can open guest links", async () => {
  const jo = await join("Jo Park", "jo@example.com"), kim = await join("Kim Ho", "kim2@example.com");
  const ok = await (await post("/api/host/profile", { handle: "jo-bakes", theme: { accent: "#3E9C6E", font: "playful", bg: "night", cover: "dots", buttons: "square", avatarUrl: "javascript:alert(1)" }, links: [{ label: "Instagram", url: "https://instagram.com/jobakes" }], tagline: "Bread on Sundays", sections: { kudos: false } }, jo.cookie)).json();
  assert.equal(ok.host.theme.accent, "#3E9C6E"); assert.equal(ok.host.theme.font, "playful"); assert.equal(ok.host.theme.avatarUrl, "", "only uploaded photos"); assert.equal(ok.host.sections.kudos, false); assert.equal(ok.host.tagline, "Bread on Sundays");
  const off = await (await post("/api/host/profile", { theme: { accent: "#123456", font: "comic-sans" } }, jo.cookie)).json();
  assert.equal(off.host.theme.accent, "#3E9C6E", "colours outside the set are ignored"); assert.equal(off.host.theme.font, "playful");
  assert.equal((await post("/api/host/profile", { links: [{ label: "x", url: "http://bad.example" }] }, jo.cookie)).status, 400);
  assert.equal((await get("/@jo-bakes")).status, 200);
  // a signed-in member opening someone else's invite is a guest there
  assert.equal((await put("events/bread1", { name: "Sourdough Sunday", activity: "bake", kind: "social", casual: true, date: day(5) }, jo.cookie)).status, 200);
  const r = await fetch(srv.base + "/api/db/doc?path=events/bread1", { headers: { cookie: kim.cookie, "x-encore-guest": "1" } });
  assert.equal(r.status, 200); assert.equal((await r.json()).data.name, "Sourdough Sunday");
});

test("Potto calls it: once enough people are in, it locks the most popular date and tells them", async () => {
  const cl = await join("Cleo Ray", "cleo@example.com");
  assert.equal((await put("events/auto1", { name: "Picnic", activity: "picnic", kind: "social", casual: true, stage: "interest", dateOptions: [day(8), day(9)], interestGoal: 2, autoGo: true }, cl.cookie)).status, 200);
  await guest(cl.ws, { eventId: "auto1", name: "A One", email: "a1@example.com", response: "maybe", interest: "in", dates: [day(9)], code: "A1" });
  let h = await (await get("/api/host/hype/auto1", cl.cookie)).json(); assert.equal(h.in, 1);
  await guest(cl.ws, { eventId: "auto1", name: "B Two", email: "b2@example.com", response: "maybe", interest: "in", dates: [day(8), day(9)], code: "B2" });
  h = await (await get("/api/host/hype/auto1", cl.cookie)).json(); assert.equal(h.autoWent, true);
  const ev = (await (await get("/api/db/doc?path=events/auto1", cl.cookie)).json()).data;
  assert.equal(ev.stage, ""); assert.equal(ev.date, day(9));
  assert.ok((await (await get("/api/me/inbox", cl.cookie)).json()).items.some((n) => n.kind === "itson"));
});

test("Eric's shop: pandan cakes to order for pickup, stock limits, orders for Eric; companies book his experiences", async () => {
  const er = await join("Eric Lim", "ericlim@example.com");
  const r = await (await post("/api/host/profile", { handle: "eric-bakes", city: "New York", forHire: true, theme: { avatarArt: "chef" },
    shop: { open: true, title: "Pandan honeycomb cake", where: "Greenpoint, address after you order", slots: ["Sat 10–12", "Sun 10–12"], payUrl: "https://venmo.com/eric", items: [{ name: "Whole cake (8 slices)", cents: 3200, stock: 3, max: 2, emoji: "🍰" }, { name: "Slice", cents: 600, stock: 0, max: 6 }] },
    experiences: [{ name: "Private omakase for your team", desc: "Seven courses at your office or mine", min: 8, max: 14, price: "from $120 a person", length: "3 hours" }] }, er.cookie)).json();
  assert.equal(r.host.theme.avatarArt, "chef"); assert.equal(r.host.shop.items.length, 2); assert.equal(r.host.experiences[0].min, 8);
  const shop = (await (await get("/api/public/shop/eric-bakes")).json()).shop;
  assert.equal(shop.items[0].price, "$32"); assert.equal(shop.items[0].left, 3); assert.equal(shop.items[1].left, null, "no limit");
  const whole = shop.items[0].id;
  assert.equal((await post("/api/public/order/eric-bakes", { name: "Priya", phone: "415 555 0101", slot: "Sat 10–12", items: [{ id: whole, qty: 3 }] })).status, 400, "max 2 per order");
  assert.equal((await post("/api/public/order/eric-bakes", { name: "Priya", phone: "415 555 0101", items: [{ id: whole, qty: 1 }] })).status, 400, "needs a pickup time");
  const o = await (await post("/api/public/order/eric-bakes", { name: "Priya Shah", phone: "415 555 0101", slot: "Sat 10–12", items: [{ id: whole, qty: 2 }, { id: shop.items[1].id, qty: 3 }] })).json();
  assert.equal(o.total, "$82"); assert.match(o.payUrl, /^https:\/\/venmo\.com\/eric\?txn=pay&amount=82&note=.*%23/, "the amount and order number are filled in"); assert.match(o.code, /^[0-9A-F]{4}$/);
  const so = await post("/api/public/order/eric-bakes", { name: "Dev", email: "dev@example.com", slot: "Sun 10–12", items: [{ id: whole, qty: 2 }] });
  assert.equal(so.status, 409, "only 1 left");
  // duplicate lines for the same item are added up, so they can't get around the per-order max or the stock
  const dup = await post("/api/public/order/eric-bakes", { name: "Dup", email: "dup@example.com", slot: "Sun 10–12", items: [{ id: whole, qty: 1 }, { id: whole, qty: 1 }] });
  assert.equal(dup.status, 409, "two lines of 1 still exceed the 1 left");
  assert.equal((await (await get("/api/public/shop/eric-bakes")).json()).shop.items[0].left, 1);
  const L = (await (await get("/api/host/orders", er.cookie)).json()).orders; assert.equal(L.length, 1); assert.equal(L[0].totalText, "$82");
  assert.equal((await post("/api/host/orders/" + L[0].id, { status: "paid" }, er.cookie)).status, 200);
  assert.ok((await (await get("/api/me/inbox", er.cookie)).json()).items.some((n) => n.kind === "order"));
  // a new batch resets the counts
  await post("/api/host/shop/new-drop", {}, er.cookie); assert.equal((await (await get("/api/public/shop/eric-bakes")).json()).shop.items[0].left, 3);
  // companies book an experience
  const dir = await (await get("/api/public/hosts?city=new york")).json(); const me = dir.hosts.find((h) => h.handle === "eric-bakes"); assert.equal(me.experiences[0].name, "Private omakase for your team");
  const expId = r.host.experiences[0].id;
  assert.equal((await post("/api/public/inquiry/eric-bakes", { name: "Jo", company: "Figma", email: "jo@figma.example", experienceId: expId, people: 12, when: "March", message: "Team offsite dinner for our design team." })).status, 200);
  const inq = (await (await get("/api/host/inquiries", er.cookie)).json()).inquiries[0]; assert.equal(inq.experience.name, "Private omakase for your team"); assert.equal(inq.people, 12);
  // link previews
  const html = await (await get("/@eric-bakes")).text(); assert.match(html, /og:title" content="[^"]*"/); assert.match(html, /Order Whole cake/);
  // Discover's "Order from hosts" lists what can be ordered now and links straight to it: the old shop becomes its drop
  const sh = (await (await get("/api/public/shops")).json()).shops.find((s) => s.handle === "eric-bakes");
  assert.ok(sh, "listed"); assert.match(sh.url, /^\/e\/[A-Za-z0-9_-]+$/, "links to the drop, never to a page with nothing to order");
  assert.equal((await get(sh.url)).status, 200); assert.ok(sh.items.some((x) => /^Whole cake/.test(x.name)));
});

test("Brands book experience hosts: browse by category, describe it to Potto, request, get a quote, accept", async () => {
  const cart = await join("Linh Vo", "linh.vo@example.com"), flower = await join("Hoa Tran", "hoa@example.com");
  assert.equal((await post("/api/host/profile", { forHire: true, handle: "banhmi-cart", name: "Bánh Mì Cart", city: "New York", insured: true, respondsIn: "a day", experiences: [{ name: "Bánh mì pop-up cart at your office", desc: "A Vietnamese street-food cart, made to order", category: "food", includes: "Cart and crew\nBánh mì and iced coffee", min: 30, max: 200, price: "from $28 a person", length: "2 hours", travels: true }] }, cart.cookie)).status, 200);
  assert.equal((await post("/api/host/profile", { forHire: true, handle: "hoa-flowers", name: "Hoa Flower Studio", city: "New York", experiences: [{ name: "Bouquet workshop", desc: "Everyone makes a bouquet to take home", category: "workshop", min: 8, max: 40, price: "from $65 a person", length: "90 minutes" }] }, flower.cookie)).status, 200);
  const food = (await (await get("/api/public/experiences?category=food")).json()).experiences; assert.ok(food.some((x) => x.name.startsWith("Bánh mì")) && !food.some((x) => x.name === "Bouquet workshop"));
  assert.ok(food[0].host.insured);
  const m = await (await post("/api/public/match", { brief: "Vietnamese street food for 60 people at our office in New York, about $2,000" })).json();
  assert.equal(m.brief.people, 60); assert.equal(m.brief.budget, 2000); assert.equal(m.matches[0].host.handle, "banhmi-cart", JSON.stringify(m.matches.map((x) => x.name)));
  const m2 = await (await post("/api/public/match", { brief: "a flower workshop for our team of 20" })).json(); assert.equal(m2.matches[0].name, "Bouquet workshop");
  const m3 = await (await post("/api/public/match", { brief: "zzqx florp blarg" })).json(); assert.equal(m3.matches.length, 0, "a brief nothing matches gets the no-match state");
  const m4 = await (await post("/api/public/match", { brief: "a bouquet workshop for 200 people in New York" })).json(); assert.ok(!m4.matches.some((x) => x.name === "Bouquet workshop"), "never offered to a group far bigger than it takes");
  const expId = food.find((x) => x.host.handle === "banhmi-cart").id;
  const r = await (await post("/api/public/book/banhmi-cart", { name: "Dana", company: "Loop", email: "dana@loop.example", experienceId: expId, people: 60, when: "March 12", where: "Our office in SoHo", message: "Lunar New Year lunch for the team, something fun and not catered." })).json();
  assert.ok(r.ok); const [, id, t] = r.link.match(/booking\/([a-f0-9]+)\?t=([a-f0-9]+)/);
  assert.equal((await get(`/api/public/booking/${id}?t=bad`)).status, 403);
  let bk = (await (await get(`/api/public/booking/${id}?t=${t}`)).json()).booking; assert.equal(bk.status, "requested"); assert.equal(bk.email, undefined);
  assert.equal((await post(`/api/public/booking/${id}/accept`, { t })).status, 400, "nothing to accept yet");
  assert.equal((await post(`/api/host/bookings/${id}`, { status: "quoted", quote: { total: "$1,680", includes: "Cart, two cooks, 60 bánh mì, iced coffee", note: "We arrive 30 minutes early" } }, cart.cookie)).status, 200);
  bk = (await (await get(`/api/public/booking/${id}?t=${t}`)).json()).booking; assert.equal(bk.quote.total, "$1,680");
  assert.equal((await post(`/api/public/booking/${id}/accept`, { t })).status, 200);
  const hb = (await (await get("/api/host/bookings", cart.cookie)).json()).bookings[0]; assert.equal(hb.status, "booked");
  assert.ok((await (await get("/api/me/inbox", cart.cookie)).json()).items.some((n) => n.kind === "booked"));
});
