// The event audit's core checks, at string level (scripts/event-audit.mjs runs the same states in a browser): every
// event page has the host line with the host's page and Follow (the shared data-pl-follow markup), never Follow on your
// own event; Report on the invites beside main's Help link; a cancelled event says so to guests instead of asking for a reply; a
// signed-in guest who replied elsewhere gets their reply back on the light invite; the group chat on a plan page only
// for people who are in; the address stays hidden until you're in.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { publicEvent } from "../server/app.js";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const J = { "Content-Type": "application/json" }, ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "audit-secret-0123456789", ENCORE_FAKE_EMAIL: "1", ENCORE_SIGNUP_PER_HOUR: "100" };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
let srv, mai, sam, nia;
const post = (p, b, c) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...(c ? { cookie: c } : {}) }, body: JSON.stringify(b) });
const put = (p, b, c) => fetch(srv.base + "/api/db/doc?path=" + p, { method: "PUT", headers: { ...J, cookie: c }, body: JSON.stringify(b) });
const patch = (p, b, c) => fetch(srv.base + "/api/db/doc?path=" + p, { method: "PATCH", headers: { ...J, cookie: c }, body: JSON.stringify(b) });
const guestDoc = async (id, c) => (await (await fetch(srv.base + "/api/db/doc?path=events/" + id, { headers: { "x-encore-guest": "1", ...(c ? { cookie: c } : {}) } })).json()).data;
async function join(name, email) { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200); const j = await r.json(); return { cookie: r.headers.get("set-cookie").split(";")[0], ws: j.workspace.id, email, name }; }
async function reply(id, who, ws) { const r = await fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, "x-encore-guest": "1", "x-encore-key": "k" + Math.random().toString(36).slice(2), "x-encore-workspace": ws, ...(who.cookie ? { cookie: who.cookie } : {}) },
  body: JSON.stringify({ eventId: id, response: "going", name: who.name, email: who.email, code: "C" + Math.random().toString(36).slice(2, 8), createdAt: Date.now() }) }); assert.ok(r.ok, await r.clone().text()); return String((await r.json()).id).split("/").pop(); }
const ev = (o) => ({ kind: "social", casual: true, activity: "dinner", city: "Brooklyn", hood: "Bed-Stuy", startTime: "19:00", headcount: 8, published: true, discoverable: true, date: day(6), ...o });
const SECRET = "41 Hidden Lane, Apt 3";

before(async () => { Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer();
  mai = await join("Mai Pham", "mai.audit@example.com"); sam = await join("Sam Ortiz", "sam.audit@example.com"); nia = await join("Nia Brooks", "nia.audit@example.com");
  await post("/api/host/profile", { handle: "mai-audit", name: "Mai's Supper Club", city: "Brooklyn", experiences: [{ id: "dumpling1", name: "Private dumpling night", desc: "A dumpling night for your team.", emoji: "🥟", min: 6, max: 14, price: "$65 a person", length: "2 hours", category: "food" }] }, mai.cookie);
  await put("events/eaOpen", ev({ name: "Pasta at the library", meetPoint: "Sunset Park Library" }), mai.cookie);
  await put("events/eaHome", ev({ name: "Supper at my place", meetPoint: "Mai's place", venueAddr: SECRET }), mai.cookie);
  await put("events/eaGone", ev({ name: "Cancelled picnic" }), mai.cookie); await patch("events/eaGone", { cancelled: true }, mai.cookie);
  await reply("eaOpen", sam, mai.ws); });
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

test("guests can tell a cancelled event and an example; the address waits until they're in", async () => {
  assert.equal((await guestDoc("eaGone")).cancelled, true, "the invite needs to know, or it asks for a reply the server then refuses");
  assert.equal(publicEvent({ name: "x", example: true, casual: true }).example, true);
  const home = await guestDoc("eaHome"); assert.equal(home.addrHidden, true); assert.ok(!JSON.stringify(home).includes(SECRET));
  const open = await guestDoc("eaOpen"); assert.ok(!("cancelled" in open), "nothing added to an event that isn't cancelled");
});

test("the light invite: the host line with Follow, Report and Share, the reply back from your account, a cancelled event to the full invite", async () => {
  const L = read("public/invite.html"); assert.ok(L.length < 40000, "the light invite stays under its cap: " + L.length);
  assert.match(L, /<script src="\/event-extras\.js" defer><\/script>/); assert.match(L, /const h = self\.__H = H\.host \|\| \{\}/, "the host, for the host line");
  const A = read("server/app.js"); assert.match(A, /if \(!ev\.drop && \(ev\.cancelled \|\| \(app\.locals\.fanclub\?\.visibility\?\.\(ws, id\) === "early" && !app\.locals\.memberships\?\.handles\?\.\(ws, id\)\)\)\) return res\.redirect\(302, to\);/, "cancelled, or a fan club's members first: the full invite, which says so; a drop and a paid members window stay");
  let g = await fetch(srv.base + "/e/eaGone", { redirect: "manual" }); assert.equal(g.status, 302); assert.equal(g.headers.get("location"), "/g#rsvp-eaGone");
  // the parts the light invite has no room for: drawn by public/event-extras.js
  const X = read("public/event-extras.js");
  assert.match(X, /<div class="hrow"|d\.className = "hrow"/); assert.match(X, /<a href="\/@\$\{esc\(h\.handle\)\}"><span class="hav">/, "the host's face and name open their page");
  assert.match(X, /\$\{PREVIEW \? "" : `<button type="button" class="plf-btn" data-pl-follow="\$\{esc\(h\.handle\)\}" data-name="\$\{esc\(name\)\}" aria-pressed="false">Follow<\/button>`\}/, "Follow, the shared markup; not in the host's own canvas preview");
  assert.match(X, /insertAdjacentHTML\("beforeend", `<a href="#" data-lz="report">Report<\/a>`\)/); assert.doesNotMatch(X, /data-lz="help"/, "Help is main's footer link, not a second one");
  assert.equal((L.match(/>Help<\/a>/g) || []).length, 1, "one Help link in the footer"); assert.match(L, /<a href="\/help" data-help="guest">Help<\/a>/); assert.match(X, /b\.dataset\.lz = "share"/); assert.match(X, /new MutationObserver\(place\)/);
  // signed in, a reply made elsewhere is put where the invite looks for it, only for that person and never cached
  let r = await fetch(srv.base + "/e/eaOpen", { headers: { cookie: sam.cookie } }), html = await r.text();
  assert.match(html, /localStorage\.getItem\(k\)\|\|localStorage\.setItem\(k,/); assert.match(html, /\\"response\\":\\"going\\"/); assert.match(r.headers.get("cache-control"), /private, no-store/);
  for (const c of [nia.cookie, null]) { r = await fetch(srv.base + "/e/eaOpen", { headers: c ? { cookie: c } : {} }); html = await r.text(); assert.doesNotMatch(html, /encore-rsvp-eaOpen/); assert.match(r.headers.get("cache-control"), /public/); }
});

test("the full invite: host line and Follow (not on your own event), Report, a cancelled event closes the reply", () => {
  const I = read("index.html"), i = I.indexOf("the event audit (scripts/event-audit.mjs) on the full invite"); assert.ok(i > 0);
  const B = I.slice(i, I.indexOf("</script>", i));
  assert.match(B, /\$\{own\?"":`<button type="button" class="plf-btn" data-pl-follow="\$\{esc\(h\.handle\)\}"/, "no Follow on your own event");
  assert.match(B, /p\.innerHTML=`<a href="#" data-lz="report">Report<\/a>`/); assert.doesNotMatch(B, /data-lz="help"/, "Help is the invite's own footer link");
  assert.match(B, /for\(const src of \["\/follow\.js","\/event-extras\.js"\]\)/, "main's shared Follow");
  // members first: a paid members window speaks through server/memberships.js (its guestLine, the light invite's line too), not a second rule
  assert.match(B, /CL\.paid&&P===undefined\)\{ ML\[e\.id\]=null; fetch\("\/api\/public\/seats\/"/); assert.match(B, /early=open&&\(CL\.paid\?!!\(P&&P\.on&&P\.can===false&&P\.line\):!CL\.member\)/);
  assert.match(read("server/fanclub.js"), /\.\.\.\(v\.byMembership \? \{ paid: true \} : \{\}\)/); assert.doesNotMatch(B, /first dibs/i);
  assert.match(B, /html body\.g-cancelled #view-guest#view-guest#view-guest :is\(#gForm,#gTopCta,#statusPill,\[data-addcal\]\),html body\.g-cancelled :is\(#gBar,\.g-bar,\.prb\)/, "no reply form, reply bar or calendar on a cancelled event (above slots.css)"); assert.match(B, /Members first until/);
  assert.match(B, /cancelled this one/); assert.match(B, /Replies are closed\./);
  assert.doesNotMatch(B, /\u2014/, "no em dashes");
  const scripts = [...I.matchAll(/<script[\s>]/g)].map((m) => m.index), last = I.slice(scripts[scripts.length - 1]);
  assert.match(last, /"Come with me\?" on the full invite/, "the Come with me? loader stays the last script");
});

test("the shared Follow: every event surface loads main's public/follow.js, and its styles and the friends-going row's both load", () => {
  assert.ok(!fs.existsSync(new URL("../public/follow-fallback.js", import.meta.url)), "the temporary fallback is gone");
  for (const f of ["public/plan.html", "public/plans.html", "public/chats.html", "public/experience.html"]) { const h = read(f); assert.match(h, /<script src="\/follow\.js" defer><\/script>/, f); assert.doesNotMatch(h, /follow-(fallback|shim)/, f); }
  assert.match(read("server/interest.js"), /<script src="\/follow\.js" defer><\/script>/); assert.match(read("public/event-extras.js"), /load\("\/follow\.js"\)/);
  // public/friendsgoing.js used the style id plfCss too, so whichever loaded second drew no styles
  const F = read("public/follow.js"), G = read("public/friendsgoing.js");
  assert.match(F, /s\.id = "plfCss"/); assert.match(G, /s\.id = "plfgCss"/); assert.doesNotMatch(G, /"plfCss"/);
});

test("the Plans peek: Follow beside the host for a guest, none for the host", () => {
  const ctx = { window: {}, document: { cookie: "", addEventListener() {}, querySelector: () => null }, addEventListener() {}, localStorage: { getItem: () => null }, Intl, Date, JSON, Math, encodeURIComponent };
  vm.createContext(ctx); vm.runInContext(read("public/timeline.js"), ctx); vm.runInContext(read("public/peek.js"), ctx); const K = ctx.window.PLPeek;
  const base = { id: "e1", title: "Dumplings", href: "/e/e1", invite: "/e/e1", when: "Fri", place: "Greenpoint", host: { name: "Mina Cho", first: "Mina", handle: "mina", href: "/@mina" }, who: { count: 1, names: [], faces: [] }, actions: {} };
  const g = K.html({ ...base, role: "guest", reply: { state: "going", answers: [{ value: "going", label: "I'm in" }] } });
  assert.match(g, /<div class="pk-hrow"><a class="pk-host" href="\/@mina">/); assert.match(g, /data-pl-follow="mina"/);
  const h = K.html({ ...base, role: "host", manage: { going: 1, asking: 0, waiting: 0, href: "/x" } }); assert.doesNotMatch(h, /data-pl-follow/);
});

test("plan pages: the host's page and Follow, the group chat only for people who are in", async () => {
  const p = read("public/plan.html"); assert.match(p, /class="pv-host"/); assert.match(p, /P\.isHost \? "" : `<button type="button" class="plf-btn" data-pl-follow=/); assert.match(p, /\/follow\.js/); assert.match(p, /Change reply/);
  const S = await (await fetch(srv.base + "/api/public/plan/eaOpen", { headers: { cookie: sam.cookie } })).json(), N = await (await fetch(srv.base + "/api/public/plan/eaOpen", { headers: { cookie: nia.cookie } })).json();
  const P = S.plan || S, Q = N.plan || N;
  assert.equal(P.chat, "/chats/eaOpen"); assert.equal(Q.chat, ""); assert.ok(Array.isArray(P.days) && P.locked === false, "the plan itself still comes through"); assert.equal(P.host.handle, "mai-audit");
});

test("chats: the details sheet names the host with their page and Follow; experiences link the host, Follow and Share", async () => {
  const t = await (await fetch(srv.base + "/api/chats/eaOpen", { headers: { cookie: sam.cookie } })).json(); assert.equal(t.event.hostHandle, "mai-audit");
  const c = read("public/chat.js"); assert.match(c, /class="ch-hrow"><a href="\/@\$\{encodeURIComponent\(T\.event\.hostHandle\)\}"/); assert.match(c, /\$\{host \? "" : `<button type="button" class="plf-btn" data-pl-follow=/);
  const x = await (await fetch(srv.base + "/x/mai-audit/dumpling1")).text();
  assert.match(x, /Hosted by <a href="\/@mai-audit">/); assert.match(x, /data-pl-follow="mai-audit"/); assert.match(x, /id="share"/); assert.match(x, /\/follow\.js/);
});
