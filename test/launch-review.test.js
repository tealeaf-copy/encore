// Launch review fixes: privacy and terms pages, consent lines, the guest list import, the RSVP confirmation email,
// guests who become hosts without a code, funnel metrics, and unsubscribe.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { fakeOutbox, unsubToken, readUnsubToken } from "../server/email.js";
import { scopeStore } from "../server/workspaces.js";

let srv, host, ws, admin;
const J = { "content-type": "application/json" };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "launch-review-secret", ENCORE_FAKE_EMAIL: "1", ENCORE_SIGNUP_PER_HOUR: "100", ENCORE_ADMIN_EMAILS: "owner.lr@example.com", ENCORE_LEGAL_NAME: "Pottery Lab Test Co.", ENCORE_PUBLIC_URL: "https://pl.example" };

const post = (path, body, cookie, extra = {}) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}), ...extra }, body: JSON.stringify(body) });
async function signup(name, email, extra = {}) {
  const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends", ...extra });
  return { status: r.status, j: await r.json().catch(() => ({})), cookie: (r.headers.get("set-cookie") || "").split(";")[0] };
}
const putEv = (id, d, cookie = host) => fetch(srv.base + "/api/db/doc?path=events/" + id, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(d) });
async function guestReply(eventId, key, body) {
  const r = await post("/api/db/collection?path=rsvps", { eventId, code: "AB123", createdAt: Date.now(), via: "invite-lite", ...body }, null, { "x-encore-guest": "1", "x-encore-key": key, "x-encore-workspace": ws });
  return { status: r.status, j: await r.json() };
}
const mailsTo = (to, from = 0) => fakeOutbox.slice(from).filter((m) => m.to.includes(to));

before(async () => {
  Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer();
  const h = await signup("Rae Potter", "rae.lr@example.com"); host = h.cookie; ws = h.j.workspace.id;
  assert.ok((await post("/api/host/profile", { handle: "rae-lr", name: "Rae's table", city: "Brooklyn", hood: "Bed-Stuy" }, host)).ok);
  admin = (await signup("Owner", "owner.lr@example.com")).cookie;
  const base = { kind: "social", casual: true, published: true, date: day(5), startTime: "19:00", endTime: "22:00", tz: "America/New_York", city: "Brooklyn", hood: "Bed-Stuy", headcount: 10 };
  assert.ok((await putEv("lrOpen", { ...base, name: "Dumpling night", meetPoint: "My place, 214 Bedford Ave", venueAddr: "214 Bedford Ave, apt 3" })).ok);
  assert.ok((await putEv("lrAsk", { ...base, name: "Quiet supper", approvalRequired: true, meetPoint: "Grand Army Plaza" })).ok);
  assert.ok((await putEv("lrPast", { ...base, name: "Last week's walk", date: day(-3) })).ok);
});
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; process.env.ENCORE_INVITE_ONLY = ""; await srv.close(); });

// ---------- 1 and 2: privacy, terms, consent ----------
test("/privacy and /terms serve 200, say they're drafts in a hidden comment, show a date and the legal name", async () => {
  for (const [p, h1] of [["/privacy", "Privacy Policy"], ["/terms", "Terms"]]) {
    const r = await fetch(srv.base + p); assert.equal(r.status, 200, p); const html = await r.text();
    assert.match(html, /<!-- Draft: review with a lawyer before relying on it/, p);
    assert.match(html, new RegExp(`<h1>${h1}</h1>`)); assert.match(html, /Last updated [A-Z][a-z]{2} \d{1,2}, 20\d\d/);
    assert.match(html, /Pottery Lab Test Co\./, "ENCORE_LEGAL_NAME fills the placeholder"); assert.doesNotMatch(html, /\{\{LEGAL_/);
    assert.doesNotMatch(html, /—/, "no em dashes");
  }
  const priv = await (await fetch(srv.base + "/privacy")).text();
  for (const re of [/Anthropic/, /reply STOP/i, /unsubscribe/i, /13 or older/, /first name/, /\/events directory/, /one cookie to keep you signed in/i]) assert.match(priv, re);
  const terms = await (await fetch(srv.base + "/terms")).text();
  for (const re of [/Venmo, PayPal, Cash App, at the door/, /50% deposit to confirm\. The rest is due 7 days after the event, once everything listed is delivered\./, /Free to cancel up to 7 days before\. Inside 7 days, half the quote\./, /If your host can't make it, we find a replacement or refund you\./, /Acceptable use/, /as is/, /Limit of liability/]) assert.match(terms, re);
});

test("footers link the policies, and sign-up and both reply forms carry the consent line", async () => {
  for (const f of ["public/home.html", "public/host.html", "public/invite.html", "public/landing.html", "public/discover.html"]) { const h = read(f); assert.match(h, /href="\/privacy"/, f); assert.match(h, /href="\/terms"/, f); }
  const su = await (await fetch(srv.base + "/signup")).text();
  assert.match(su, /By creating a page you agree to the <a href="\/terms"[^>]*>Terms<\/a> and <a href="\/privacy"[^>]*>Privacy Policy<\/a>\./);
  const lite = await (await fetch(srv.base + "/e/lrOpen")).text();
  const consent = /By replying you agree to the <a href="\/terms"[^>]*>Terms<\/a> and <a href="\/privacy"[^>]*>Privacy Policy<\/a>\. If you add a phone, you'll get event texts; reply STOP to stop\./;
  assert.match(lite, consent, "the light invite");
  assert.match(read("index.html"), consent, "the full guest form");
});

// ---------- 4: guest list import ----------
test("a guest list with a header and a row missing its phone imports instead of crashing", () => {
  const html = read("index.html"), a = html.indexOf("function parseGuestList("), b = html.indexOf("function csvOf(", a);
  const ctx = {}; vm.createContext(ctx); vm.runInContext(html.slice(a, b) + "\nthis.parse=parseGuestList;", ctx);
  const rows = ctx.parse("name,email,phone\nAna Diaz,ana@example.com,415 555 0101\nBo Chen,bo@example.com\nCy Noshow");
  assert.equal(rows.length, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(rows[1])), { name: "Bo Chen", email: "bo@example.com", phone: "", status: "" });
  assert.equal(rows[0].phone, "4155550101"); assert.equal(rows[2].name, "Cy Noshow");
  assert.match(html, /toast\("Couldn't read that list\. Check the columns\."\)/, "anything else that throws gets a plain message");
});

// ---------- 6 and 10: the confirmation email, with unsubscribe ----------
test("I'm in on an open event sends one You're in email with the date, the area, the reply link, a calendar link and Follow", async () => {
  const e0 = fakeOutbox.length;
  const r = await guestReply("lrOpen", "lr-key-ana", { name: "Ana Diaz", email: "ana.lr@guest.example.com", response: "going" });
  assert.equal(r.status, 200); assert.equal(r.j.response, "going"); assert.equal(r.j.confirmEmailed, true);
  const m = mailsTo("ana.lr@guest.example.com", e0); assert.equal(m.length, 1, "one email");
  assert.equal(m[0].subject, "You're in: Dumpling night");
  assert.match(m[0].text, /^Hi Ana,/); assert.match(m[0].text, /When: [A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2} · 7pm/);
  assert.match(m[0].text, /Where: Bed-Stuy \(the exact address is on your invite\)/);
  assert.doesNotMatch(m[0].text, /214 Bedford|apt 3/, "never the address the invite hides");
  assert.match(m[0].text, /Your invite, to see or change your reply: https:\/\/pl\.example\/e\/lrOpen#reply=/);
  assert.match(m[0].text, /Add to calendar: https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE&text=Dumpling%20night&dates=\d{8}T190000\/\d{8}T220000&ctz=America%2FNew_York/);
  assert.match(m[0].text, /Follow Rae: https:\/\/pl\.example\/@rae-lr/);
  // unsubscribe: a header and a footer link with a signed token for this address
  assert.match(m[0].headers["List-Unsubscribe"], /^<https:\/\/pl\.example\/unsubscribe\?t=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+>$/);
  assert.equal(m[0].headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.match(m[0].text, /Don't want these emails\? Unsubscribe: https:\/\/pl\.example\/unsubscribe\?t=/);
  // the same reply again (same device) sends nothing new
  const e1 = fakeOutbox.length;
  await guestReply("lrOpen", "lr-key-ana", { name: "Ana Diaz", email: "ana.lr@guest.example.com", response: "going" });
  assert.equal(mailsTo("ana.lr@guest.example.com", e1).length, 0, "one per reply");
});

test("Ask to join sends Asked, with the area only; a host's manual add and a guest with no email get none", async () => {
  const e0 = fakeOutbox.length;
  const r = await guestReply("lrAsk", "lr-key-bo", { name: "Bo Chen", email: "bo.lr@guest.example.com", response: "requested" });
  assert.equal(r.j.response, "requested");
  const m = mailsTo("bo.lr@guest.example.com", e0); assert.equal(m.length, 1); assert.equal(m[0].subject, "Asked: Quiet supper");
  assert.match(m[0].text, /You asked to join Quiet supper\. Rae lets each guest in/);
  assert.match(m[0].text, /Where: Bed-Stuy \(the exact address comes once you're in\)/); assert.doesNotMatch(m[0].text, /Grand Army Plaza/, "an Ask to join event keeps its meeting point until they're in");
  // the host adds someone by hand: no confirmation
  const e1 = fakeOutbox.length;
  assert.ok((await post("/api/db/collection?path=rsvps", { eventId: "lrOpen", name: "Cy Host-added", email: "cy.lr@guest.example.com", response: "going", createdAt: Date.now() }, host)).ok);
  assert.equal(mailsTo("cy.lr@guest.example.com", e1).length, 0);
  const n = await guestReply("lrOpen", "lr-key-di", { name: "Di", response: "going" }); assert.equal(n.status, 200); assert.equal(n.j.confirmEmailed, undefined);
});

test("unsubscribe: the page asks first, the POST turns guest mail off for that address, and nothing more is sent", async () => {
  const t = unsubToken("eve.lr@guest.example.com"); assert.equal(readUnsubToken(t), "eve.lr@guest.example.com");
  assert.equal(readUnsubToken(t.replace(/.$/, (c) => (c === "A" ? "B" : "A"))), null, "a changed signature fails");
  assert.equal((await fetch(srv.base + "/unsubscribe?t=bogus.token")).status, 400);
  const page = await (await fetch(srv.base + "/unsubscribe?t=" + t)).text();
  assert.match(page, /Stop these emails\?/); assert.match(page, /<button>Unsubscribe<\/button>/);
  const done = await fetch(srv.base + "/unsubscribe", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "t=" + encodeURIComponent(t) });
  assert.equal(done.status, 200); assert.match(await done.text(), /You(&#39;|')re unsubscribed/);
  const e0 = fakeOutbox.length;
  const r = await guestReply("lrOpen", "lr-key-eve", { name: "Eve", email: "eve.lr@guest.example.com", response: "going" });
  assert.equal(r.j.response, "going"); assert.equal(mailsTo("eve.lr@guest.example.com", e0).length, 0, "no confirmation after unsubscribing");
  // one-click from a mail app (POST to the header's URL) works too, and "Turn them back on" undoes it
  assert.equal((await fetch(srv.base + "/unsubscribe", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "t=" + encodeURIComponent(t) + "&on=1" })).status, 200);
  assert.match(await (await fetch(srv.base + "/unsubscribe?t=" + t)).text(), /Stop these emails\?/);
});

// ---------- 8: guests become hosts without a code ----------
test("invite-only: a guest who was in at the ref event, or sent it kudos, signs up without a code; anyone else still needs one", async () => {
  process.env.ENCORE_INVITE_ONLY = "1";
  try {
    const no = await signup("Stranger", "stranger.lr@example.com", { ref: "lrOpen" });
    assert.equal(no.status, 403); assert.equal(no.j.code, "invite_required");
    const ana = await signup("Ana Diaz", "ana.lr@guest.example.com", { ref: "lrOpen" });
    assert.equal(ana.status, 200, JSON.stringify(ana.j));
    const W = srv.store.get("system/ws-" + ana.j.workspace.id).data;
    assert.deepEqual({ ws: W.vouchedBy.ws, eventId: W.vouchedBy.eventId, via: W.vouchedBy.via, insteadOfCode: W.vouchedBy.insteadOfCode }, { ws, eventId: "lrOpen", via: "reply", insteadOfCode: true });
    assert.ok(scopeStore(srv.store, ana.j.workspace.id).list("audit").some((d) => /Started hosting as a guest of/.test(d.data.what)), "logged in their audit");
    // a reply that was Can't go doesn't vouch
    await guestReply("lrOpen", "lr-key-fy", { name: "Fy", email: "fy.lr@guest.example.com", response: "no" });
    assert.equal((await signup("Fy", "fy.lr@guest.example.com", { ref: "lrOpen" })).status, 403);
    // kudos on the event vouches too
    scopeStore(srv.store, ws).set("kudos/lrK1", { eventId: "lrPast", rid: "lrK1", name: "Gus", email: "gus.lr@guest.example.com", tags: ["food"], at: Date.now() });
    const gus = await signup("Gus", "gus.lr@guest.example.com", { ref: "lrPast" });
    assert.equal(gus.status, 200); assert.equal(srv.store.get("system/ws-" + gus.j.workspace.id).data.vouchedBy.via, "kudos");
  } finally { process.env.ENCORE_INVITE_ONLY = ""; }
});

// ---------- 9: funnel metrics ----------
test("funnel: steps are recorded without personal data, the app can report only share_clicked, and only admins read it", async () => {
  // a new host: sign up, make an event, share it, three guest replies
  const n = await signup("Hal New", "hal.lr@example.com", { ref: "lrOpen" }); const hal = n.cookie, halWs = n.j.workspace.id;
  const ev = { kind: "social", casual: true, published: true, date: day(4), startTime: "18:00", name: "Hal's first", headcount: 10 };
  assert.ok((await putEv("lrHal", ev, hal)).ok);
  assert.equal((await post("/api/track", { name: "share_clicked", eventId: "lrHal" })).status, 401, "signed-in only");
  assert.equal((await post("/api/track", { name: "signup" }, hal)).status, 400, "only whitelisted names");
  assert.equal((await post("/api/track", { name: "share_clicked", eventId: "lrHal" }, hal)).status, 200);
  for (const [i, nm] of ["Ia", "Jo", "Ky"].entries()) { const r = await post("/api/db/collection?path=rsvps", { eventId: "lrHal", name: nm, email: `${nm.toLowerCase()}.lr@guest.example.com`, response: "going", code: "C" + i, createdAt: Date.now() }, null, { "x-encore-guest": "1", "x-encore-key": "lr-hal-" + i, "x-encore-workspace": halWs }); assert.equal(r.status, 200); }
  const rows = srv.store.list("system/metrics/funnel").map((d) => d.data);
  const mine = rows.filter((r) => r.ws === halWs).map((r) => r.name).sort();
  assert.deepEqual(mine, ["first_event_created", "first_reply", "share_clicked", "signup", "three_replies"]);
  assert.deepEqual(rows.find((r) => r.ws === halWs && r.name === "signup"), { ...rows.find((r) => r.ws === halWs && r.name === "signup"), ref: "lrOpen", code: false });
  for (const r of rows) { assert.deepEqual(Object.keys(r).filter((k) => !/^(name|at|ws|eventId|ref|code|via)$/.test(k)), [], "only ids, step names and times"); for (const v of Object.values(r)) assert.doesNotMatch(String(v), /@/, "no emails in metrics"); }
  assert.ok(rows.some((r) => r.name === "guest_became_host" && r.ref === "lrOpen"), "Ana's vouched sign-up");
  // the admin view
  assert.equal((await fetch(srv.base + "/api/admin/funnel")).status, 404);
  assert.equal((await fetch(srv.base + "/api/admin/funnel", { headers: { cookie: hal } })).status, 404, "404, not 403, for a non-admin");
  const f = await (await fetch(srv.base + "/api/admin/funnel", { headers: { cookie: admin } })).json();
  assert.deepEqual(f.order, ["signup", "first_event_created", "share_clicked", "first_reply", "three_replies", "event_done", "kudos_received", "guest_follow", "guest_became_host"]);
  assert.ok(f.steps.signup.all >= 3 && f.steps.signup.last7 === f.steps.signup.all && f.steps.signup.last30 === f.steps.signup.all);
  assert.ok(f.steps.event_done.all >= 1, "an event whose date passed is done");
  assert.ok(f.activation.activated >= 1, JSON.stringify(f.activation)); assert.ok(f.activation.activated < f.activation.hosts, "Rae shared nothing, so she isn't activated");
  // metrics are not reachable through the data API
  assert.equal((await fetch(srv.base + "/api/db/collection?path=" + encodeURIComponent("system/metrics/funnel"), { headers: { cookie: admin } })).status, 403);
});

test("the sign-up limit defaults to 20 an hour per IP, and the docs say why", () => {
  assert.match(read("server/app.js"), /ENCORE_SIGNUP_PER_HOUR \|\| 20\)/);
  assert.match(read("docs/onboarding.md"), /Vercel rewrite[\s\S]*shares one IP|share one IP/);
  assert.match(read("render.yaml"), /sizeGB: 10\b/);
});

test("every kind of guest and follower mail goes through the unsubscribe list", async () => {
  const { sendEmail, setUnsubscribed } = await import("../server/email.js");
  setUnsubscribed("zed.lr@guest.example.com", true);
  const cfg = { service: "fake", from: "events@pl.example" };
  assert.equal((await sendEmail(cfg, { list: "guest", to: "zed.lr@guest.example.com", subject: "Tomorrow: x", text: "hi" })).code, "unsubscribed");
  assert.equal((await sendEmail(cfg, { to: "zed.lr@guest.example.com", subject: "Reset your password", text: "hi" })).ok, true, "account mail isn't guest mail");
  const src = ["server/social.js", "server/community.js", "server/hosts.js", "server/kudosask.js", "server/shop.js", "server/app.js"].map(read).join("\n");
  for (const s of ["Tomorrow", "It's on", "How was", "New from", "You're following", "Something you", "A spot opened up"]) assert.match(src, new RegExp(`list: "guest"[^\\n]{0,80}subject: \`${s}`), s);
});

test("Host your own: the kudos thanks and the You're in screen link to sign-up with the event as ref", () => {
  const k = read("public/kudos.html"), inv = read("public/invite.html");
  assert.match(k, /Your turn\? Hosting friends is free\./); assert.match(k, /\/signup\?mode=friends&amp;ref=\$\{encodeURIComponent\(id\)\}/);
  assert.match(k, /href="\/discover">See what's on/, "an empty More like this points at Discover");
  assert.match(inv, /\$\{yes \? `<p class="yourturn muted" id="yourTurn"><a href="\/signup\?mode=friends&amp;ref=\$\{encodeURIComponent\(eid\)\}">Your turn\? Hosting friends is free\.<\/a>/);
});
