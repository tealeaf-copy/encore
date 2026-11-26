// Booking experience hosts for teams (server/brandbook.js): the trust badge, the full price, cancellation terms,
// shortlist permissions, request / accept / counter / decline, instant book, contact privacy, two-way reviews,
// the approximate map and invoices.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { priceFor, trustedCheck, TRUSTED, cancellationTerms, refundFor, instantEligible, shortlistRole, slCan, approxArea, reviewsFor, contactFor, invoiceOf, flexLabel, fitsFlex, availabilityFor, qualityScore, photoLead } from "../server/brandbook.js";

let srv;
const J = { "content-type": "application/json" };
const post = (p, body, cookie) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (p, cookie) => fetch(srv.base + p, { headers: cookie ? { cookie } : {} });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
const ok = async (r) => { const t = await r.text(); assert.ok(r.ok, `${r.status} ${t}`); return JSON.parse(t); };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const weekdayAfter = (n) => { for (let i = n; i < n + 10; i++) { const d = day(i), w = new Date(d + "T12:00:00Z").getUTCDay(); if (w >= 1 && w <= 5) return d; } };

async function signup(name, email, extra = {}) { const r = await post("/api/signup", { name, email, password: "long-password-1", ...extra }); assert.ok(r.ok, await r.clone().text()); return cookieOf(r); }
async function makeHost(handle, name, email, pkg = {}, setup = {}) {
  const c = await signup(name, email, { mode: "friends" });
  await ok(await post("/api/host/profile", { handle, name, city: "New York", hood: "Greenpoint", forHire: true }, c));
  const S = await ok(await post("/api/bb/host/setup", { on: true, policy: "standard", area: "Greenpoint", city: "New York", address: "12 Quiet Street, Apt 3", phone: "+1 718 555 0100", story: "I cook for people I like.", since: 2019,
    packages: [{ name: "Supper club for your team", story: "Six courses at a long table.", moods: ["client", "bonding"], perPersonCents: 12000, minimumCents: 120000, minGuests: 6, maxGuests: 14, leadDays: 7, includes: ["Ingredients", "Venue", "Service"], weekdays: [1, 2, 3, 4, 5], time: "evening", taxBps: 0, depositPct: 25, ...pkg }], ...setup }, c));
  return { c, pkg: S.setup.packages[0] };
}

before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "bb-secret-0123456789"; process.env.ENCORE_SIGNUP_PER_HOUR = "200"; process.env.ENCORE_FAKE_EMAIL = "1"; process.env.ENCORE_FAKE_SMS = "1"; process.env.ENCORE_ADMIN_EMAILS = "ops@pl.example"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_SMS", "ENCORE_ADMIN_EMAILS", "ENCORE_TEAM_FEE_BPS"]) delete process.env[k]; await srv.close(); });

test("Total price: per person times headcount, the group minimum, the booking fee and tax, and the deposit", () => {
  const pkg = { perPersonCents: 12000, minimumCents: 120000, includes: ["Ingredients", "Venue", "Service"], depositPct: 25 };
  const P = priceFor(pkg, 12, { feeBps: 0 });
  assert.equal(P.totalCents, 144000); assert.equal(P.summary, "$1,440 total for 12"); assert.equal(P.line, "$1,440 total for 12 · includes ingredients, venue and service");
  assert.equal(P.depositCents, 36000); assert.equal(P.balanceCents, 108000);
  assert.equal(P.lines.find((l) => l.k === "fee").note, "None", "no fee says so up front");
  // under the minimum: the top-up is its own line
  const small = priceFor(pkg, 6, { feeBps: 0 }); assert.equal(small.totalCents, 120000); assert.equal(small.lines.find((l) => l.k === "minimum").cents, 48000);
  // a booking fee and sales tax are lines, in dollars, before paying
  const F = priceFor({ ...pkg, taxBps: 888 }, 12, { feeBps: 500 });
  assert.equal(F.feeCents, 7200); assert.equal(F.taxCents, Math.round(144000 * 0.0888)); assert.equal(F.totalCents, 144000 + 7200 + F.taxCents);
  assert.ok(F.lines.every((l) => !/%/.test(l.label)), "fee lines show dollars, never a percentage");
  assert.equal(F.lines.reduce((a, l) => a + l.cents, 0), F.totalCents, "the lines add up to the total: no surprise fees");
});

test("Cancellation terms are plain words that match the refund", () => {
  const T = cancellationTerms("standard", 25);
  assert.equal(T.short, "Standard: free to cancel up to 14 days before");
  assert.ok(T.lines.some((l) => /14 or more days before: everything back/.test(l)));
  assert.ok(T.lines.some((l) => /If the host cancels, you get everything back/.test(l)));
  assert.match(T.deposit, /25% deposit holds the date/);
  assert.equal(refundFor("standard", 20, 144000, 36000), 144000);
  assert.equal(refundFor("standard", 10, 144000, 36000), 72000);
  assert.equal(refundFor("standard", 3, 144000, 36000), 108000);
  assert.equal(refundFor("flexible", 3, 36000, 36000), 0);
  assert.ok(cancellationTerms("flexible").lines.every((l) => !/\u2014/.test(l)));
});

test("Trusted host: every published criterion has to be met", () => {
  const good = { events: 12, reviews: 5, rating: 4.9, responseHours: 3, responseRate: 1, hostCancels90: 0 };
  assert.equal(trustedCheck(good).trusted, true);
  assert.equal(trustedCheck({ ...good, events: 9 }).trusted, false);
  assert.equal(trustedCheck({ ...good, rating: 4.7 }).trusted, false);
  assert.equal(trustedCheck({ ...good, reviews: 2 }).trusted, false, "a 5.0 from two reviews isn't enough");
  assert.equal(trustedCheck({ ...good, responseHours: 30 }).trusted, false);
  assert.equal(trustedCheck({ ...good, responseRate: 0.5 }).trusted, false);
  assert.equal(trustedCheck({ ...good, hostCancels90: 1 }).trusted, false);
  assert.deepEqual(trustedCheck(good).checks.map((c) => c.k), ["events", "rating", "responds", "cancels"]);
  assert.equal(TRUSTED.events, 10); assert.equal(TRUSTED.rating, 4.8);
  assert.ok(qualityScore(good) > qualityScore({ ...good, hostCancels90: 1 }), "a cancellation lowers the ranking score");
});

test("Instant book: Trusted hosts who opt in, open date, capacity, lead time, no approval pending", () => {
  const pkg = { instant: true, leadDays: 7, minGuests: 6, maxGuests: 14 }, today = "2026-11-26", base = { trusted: true, pkg, date: "2026-12-10", headcount: 10, today };
  assert.equal(instantEligible(base).ok, true);
  assert.equal(instantEligible({ ...base, trusted: false }).ok, false);
  assert.equal(instantEligible({ ...base, pkg: { ...pkg, instant: false } }).ok, false);
  assert.equal(instantEligible({ ...base, date: "2026-11-30" }).ok, false, "inside the lead time");
  assert.equal(instantEligible({ ...base, headcount: 20 }).ok, false);
  assert.equal(instantEligible({ ...base, approvalPending: true }).ok, false);
  assert.equal(instantEligible({ ...base, open: false }).ok, false);
  assert.equal(instantEligible({ ...base, date: "" }).ok, false, "flexible dates need the host");
});

test("Shortlist roles: team members edit, the vote link votes and comments, the view link only reads", () => {
  const sl = { ownerEmail: "dana@fern.example", ws: "W1", links: { vote: "votekey", view: "viewkey" } };
  assert.equal(shortlistRole(sl, { email: "dana@fern.example", ws: "W1" }), "owner");
  assert.equal(shortlistRole(sl, { email: "sam@fern.example", ws: "W1" }), "member");
  assert.equal(shortlistRole(sl, { key: "votekey" }), "voter");
  assert.equal(shortlistRole(sl, { key: "viewkey" }), "viewer");
  assert.equal(shortlistRole(sl, { key: "nope", ws: "W2", email: "x@y.example" }), null);
  assert.ok(slCan("voter", "vote") && slCan("voter", "comment") && !slCan("voter", "add"));
  assert.ok(slCan("viewer", "view") && !slCan("viewer", "vote") && !slCan("viewer", "comment"));
  assert.ok(slCan("member", "add") && !slCan("member", "delete") && slCan("owner", "delete"));
});

test("Map privacy: an approximate area, rounded, never an address", () => {
  const A = approxArea("Greenpoint", "New York");
  assert.equal(A.area, "Greenpoint"); assert.equal(A.approximate, true); assert.ok(A.radiusM >= 800);
  for (const v of [A.lat, A.lng]) assert.ok(Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "two decimals at most");
  assert.ok(!("address" in A));
});

test("Two-way reviews are double blind; the host's review of a brand is never public", () => {
  const past = "2026-01-10", r = { date: past, reviews: { brand: { rating: 5, text: "Lovely night.", at: 1 } } }, now = Date.parse("2026-01-12T12:00:00Z");
  assert.equal(reviewsFor(r, "host", now).theirs, undefined, "the host can't read it before writing theirs");
  assert.equal(reviewsFor(r, "public", now).public, undefined, "not public until both are in or the window ends");
  const both = { ...r, reviews: { ...r.reviews, host: { rating: 4, text: "Kind group, a little late.", at: 2 } } };
  assert.equal(reviewsFor(both, "host", now).theirs.text, "Lovely night.");
  assert.equal(reviewsFor(both, "brand", now).theirs.text, "Kind group, a little late.");
  assert.ok(!JSON.stringify(reviewsFor(both, "public", now)).includes("a little late"), "the host's review of the brand stays private");
  assert.equal(reviewsFor(r, "public", Date.parse("2026-02-01T12:00:00Z")).public.text, "Lovely night.", "after 14 days it shows anyway");
});

test("Contact details stay hidden until the booking is booked", () => {
  const people = { hostName: "Ada", hostEmail: "ada@host.example", hostPhone: "+17185550100" };
  for (const status of ["requested", "countered", "accepted", "declined"]) assert.equal(contactFor({ status, venue: { address: "12 Quiet Street" } }, "brand", people), null);
  const C = contactFor({ status: "booked", venue: { address: "12 Quiet Street" } }, "brand", people); assert.equal(C.email, "ada@host.example"); assert.equal(C.address, "12 Quiet Street");
});

test("Flexible dates and the availability calendar", () => {
  assert.equal(flexLabel({ month: "2027-03", days: "weekday", time: "evening" }), "Any weekday evening in March");
  assert.ok(fitsFlex("2027-03-03", { month: "2027-03", days: "weekday" })); assert.ok(!fitsFlex("2027-03-06", { month: "2027-03", days: "weekday" }));
  const A = availabilityFor({ weekdays: [2, 3, 4], leadDays: 7, closed: ["2026-12-09"] }, "2026-12", { taken: new Set(["2026-12-10"]), today: "2026-11-26" });
  const st = (d) => A.days.find((x) => x.date === d).state;
  assert.equal(st("2026-12-01"), "notice"); assert.equal(st("2026-12-03"), "open"); assert.equal(st("2026-12-05"), "closed"); assert.equal(st("2026-12-09"), "closed"); assert.equal(st("2026-12-10"), "booked");
  assert.equal(photoLead({ photos: [{ w: 600, h: 400 }] }), "drawn", "weak photos get our drawn cover"); assert.equal(photoLead({ photos: [{ w: 1600, h: 1000 }, { w: 2000, h: 1300 }] }), "photos");
});

test("Invoices carry the company, VAT or tax ID, the lines and what's paid", () => {
  const price = priceFor({ perPersonCents: 12000, depositPct: 25 }, 12, { feeBps: 0 });
  const I = invoiceOf({ id: "abcdef123456", createdAt: Date.parse("2026-11-20"), date: "2026-12-10", headcount: 12, pkgName: "Supper club", price, payments: [{ state: "charged", cents: price.depositCents }], billing: { company: "Fernwood Labs", taxId: "GB123456789", address: "1 Mill Lane" }, contactName: "Dana Reyes" }, { hostName: "Ada's Table" });
  assert.equal(I.number, "PL-2026-ABCDEF"); assert.equal(I.buyer.company, "Fernwood Labs"); assert.equal(I.buyer.taxId, "GB123456789");
  assert.equal(I.totalCents, 144000); assert.equal(I.paidCents, 36000); assert.equal(I.dueCents, 108000); assert.equal(I.dueDate, "2026-12-03");
});

test("End to end: request, counter, accept, deposit, contact after booking, decline, approval rule, shortlist links, map, invoice", async () => {
  const H = await makeHost("ada-table", "Ada's Table", "ada@host.example");
  const brand = await signup("Dana Reyes", "dana@fernwood.example", { mode: "work", company: "Fernwood Labs" });
  // public pages: the experience shows the total for the group, the terms, an approximate area, never the address
  const X = await ok(await get(`/api/bb/x/ada-table/${H.pkg.id}?people=12`));
  assert.equal(X.price.summary, "$1,440 total for 12"); assert.equal(X.terms.policy, "standard"); assert.ok(X.terms.lines.length >= 3);
  const pub = JSON.stringify(X) + JSON.stringify(await ok(await get("/api/bb/discover?mood=client"))) + JSON.stringify(await ok(await get("/api/bb/map")));
  assert.ok(!pub.includes("Quiet Street"), "no address anywhere public"); assert.ok(!pub.includes("555"), "no phone anywhere public"); assert.ok(!pub.includes("ada@host.example"), "no email anywhere public");
  assert.ok((await ok(await get("/api/bb/discover?mood=client&people=12"))).results.some((r) => r.handle === "ada-table"));
  assert.ok(!(await ok(await get("/api/bb/discover?mood=under50"))).results.some((r) => r.handle === "ada-table"), "$120 a person isn't under $50");
  // request with an exact date: not Trusted, so it waits for the host
  const date = weekdayAfter(20);
  const R = await ok(await post("/api/bb/requests", { handle: "ada-table", pkg: H.pkg.id, date, headcount: 12, diets: ["vegetarian"], notes: "Reach me at dana@fernwood.example or 917 555 0199" }, brand));
  assert.equal(R.status, "requested"); assert.equal(R.instant, false); assert.match(R.request.notes, /email hidden/); assert.match(R.request.notes, /number hidden/);
  await ok(await post(`/api/bb/requests/${R.id}/pay`, {}, brand)); // deposit held
  // native app: no payments
  const nat = await fetch(srv.base + `/api/bb/requests/${R.id}/pay`, { method: "POST", headers: { ...J, cookie: brand, "user-agent": "Mozilla/5.0 PotteryLabApp/1.0" }, body: "{}" }); assert.equal(nat.status, 403);
  // the host sees no brand email yet, messages hide contact details both ways
  const inbox = await ok(await get("/api/bb/host/requests", H.c)); const mineH = inbox.requests.find((x) => x.id === R.id); assert.ok(mineH); assert.equal(mineH.contact, null); assert.ok(!JSON.stringify(mineH).includes("dana@fernwood.example"));
  const msg = await ok(await post(`/api/bb/requests/${R.id}/messages`, { text: "Text me on 718 555 0100" }, H.c)); assert.equal(msg.hidden, true);
  // counter with a new price, the brand takes it: deposit charged, booked, contact shared
  await ok(await post(`/api/bb/host/requests/${R.id}`, { action: "counter", perPersonCents: 11000, note: "A weeknight price." }, H.c));
  const B0 = await ok(await get(`/api/bb/requests/${R.id}`, brand)); assert.equal(B0.request.status, "countered"); assert.equal(B0.request.counter.totalCents, 132000); assert.equal(B0.request.contact, null);
  const B1 = await ok(await post(`/api/bb/requests/${R.id}/respond`, { accept: true }, brand)); assert.equal(B1.request.status, "booked"); assert.equal(B1.request.price.totalCents, 132000);
  assert.equal(B1.request.contact.email, "ada@host.example"); assert.equal(B1.request.contact.address, "12 Quiet Street, Apt 3");
  assert.ok((await ok(await get("/api/bb/host/requests", H.c))).requests.find((x) => x.id === R.id).contact.email === "dana@fernwood.example");
  assert.equal((await post(`/api/bb/host/requests/${R.id}`, { action: "decline" }, H.c)).status, 409, "an answered request can't be answered again");
  // invoice: billing details, then the HTML invoice; strangers get nothing
  await ok(await post(`/api/bb/requests/${R.id}/billing`, { company: "Fernwood Labs Ltd", taxId: "GB123456789", address: "1 Mill Lane, London" }, brand));
  const inv = await get(`/teams/invoice/${R.id}`, brand); assert.equal(inv.status, 200); const html = await inv.text(); assert.match(html, /Fernwood Labs Ltd/); assert.match(html, /GB123456789/); assert.match(html, /\$1,320/);
  assert.equal((await get(`/teams/invoice/${R.id}`)).status, 404);
  // a flexible request the host accepts on a date in the window; another the host declines (deposit released)
  const month = day(40).slice(0, 7);
  const R2 = await ok(await post("/api/bb/requests", { handle: "ada-table", pkg: H.pkg.id, flex: { month, days: "weekday", time: "evening" }, headcount: 8 }, brand));
  assert.match((await ok(await get(`/api/bb/requests/${R2.id}`, brand))).request.flexText, /^Any weekday evening in /);
  assert.equal((await post(`/api/bb/host/requests/${R2.id}`, { action: "accept" }, H.c)).status, 400, "accepting a flexible request needs a date");
  const wk = [...Array(28).keys()].map((i) => `${month}-${String(i + 1).padStart(2, "0")}`).find((d) => { const w = new Date(d + "T12:00:00Z").getUTCDay(); return w >= 1 && w <= 5 && d > day(8); });
  const A2 = await ok(await post(`/api/bb/host/requests/${R2.id}`, { action: "accept", date: wk }, H.c)); assert.equal(A2.request.status, "accepted"); assert.equal(A2.request.date, wk);
  const R3 = await ok(await post("/api/bb/requests", { handle: "ada-table", pkg: H.pkg.id, date: weekdayAfter(30), headcount: 6 }, brand)); await ok(await post(`/api/bb/requests/${R3.id}/pay`, {}, brand));
  const D3 = await ok(await post(`/api/bb/host/requests/${R3.id}`, { action: "decline", note: "Away that week." }, H.c)); assert.equal(D3.request.status, "declined");
  assert.equal((await ok(await get(`/api/bb/requests/${R3.id}`, brand))).request.deposit.state, "released");
  // another company can't read these
  const other = await signup("Ola Nowak", "ola@other.example", { mode: "work", company: "Other Co" });
  assert.equal((await get(`/api/bb/requests/${R.id}`, other)).status, 404);
  // the brand's approval rule: requests over $1,000 wait for an approver
  await ok(await post("/api/bb/brand/rules", { approval: "over", overCents: 100000, approvers: ["dana@fernwood.example"] }, brand));
  const inv2 = await ok(await post("/api/invite", { email: "sam@fernwood.example", role: "Field marketer" }, brand));
  const sam = cookieOf(await post("/api/join", { token: inv2.token, name: "Sam Lee", password: "long-password-1" }));
  const R4 = await ok(await post("/api/bb/requests", { handle: "ada-table", pkg: H.pkg.id, date: weekdayAfter(45), headcount: 12 }, sam)); assert.equal(R4.status, "approval");
  assert.ok(!(await ok(await get("/api/bb/host/requests", H.c))).requests.some((x) => x.id === R4.id), "the host doesn't see it until the team approves");
  assert.equal((await post(`/api/bb/requests/${R4.id}/approve`, {}, sam)).status, 403);
  assert.equal((await ok(await post(`/api/bb/requests/${R4.id}/approve`, {}, brand))).request.status, "requested");
  // shortlists: the team edits, the vote link votes and comments, the view link reads, strangers see nothing
  const SL = await ok(await post("/api/bb/shortlists", { title: "December team dinner", people: 12, handle: "ada-table", pkg: H.pkg.id }, brand));
  const full = await ok(await get(`/api/bb/shortlists/${SL.id}`, sam)); assert.equal(full.role, "member"); const k = (u) => new URL(srv.base + u).searchParams.get("k");
  const vk = k(full.links.vote), wk2 = k(full.links.view);
  assert.equal((await get(`/api/bb/shortlists/${SL.id}`)).status, 404);
  const asVoter = await ok(await post(`/api/bb/shortlists/${SL.id}/vote?k=${vk}`, { handle: "ada-table", pkg: H.pkg.id, name: "Priya", voter: "v-1" })); assert.equal(asVoter.votes[`ada-table/${H.pkg.id}`].n, 1);
  await ok(await post(`/api/bb/shortlists/${SL.id}/comments?k=${vk}`, { key: `ada-table/${H.pkg.id}`, name: "Priya", text: "Yes please, I'm vegetarian." }));
  assert.equal((await post(`/api/bb/shortlists/${SL.id}/items?k=${vk}`, { handle: "ada-table", pkg: H.pkg.id, remove: true })).status, 403, "voters can't remove options");
  assert.equal((await post(`/api/bb/shortlists/${SL.id}/vote?k=${wk2}`, { handle: "ada-table", pkg: H.pkg.id, name: "Lee", voter: "v-2" })).status, 403, "the view link can't vote");
  const asViewer = await ok(await get(`/api/bb/shortlists/${SL.id}?k=${wk2}`)); assert.equal(asViewer.role, "viewer"); assert.equal(asViewer.links, null, "viewers don't get the share links"); assert.equal(asViewer.comments.length, 1);
  assert.equal((await fetch(srv.base + `/api/bb/shortlists/${SL.id}`, { method: "DELETE", headers: { cookie: sam } })).status, 403, "only the maker deletes");
});

test("Trusted hosts who opt in are booked instantly; ID check goes to manual review", async () => {
  const H = await makeHost("bo-kitchen", "Bo's Kitchen", "bo@host.example", { instant: true, leadDays: 3 });
  const brand = await signup("Kit Moss", "kit@brand.example", { mode: "work", company: "Moss & Co" });
  // not Trusted yet: instant isn't offered even though the host opted in
  const r0 = await ok(await post("/api/bb/requests", { handle: "bo-kitchen", pkg: H.pkg.id, date: weekdayAfter(10), headcount: 8 }, brand)); assert.equal(r0.instant, false); assert.match(r0.instantWhy, /Trusted hosts/);
  // earn it: 10 events with 3+ reviews at 4.8+, quick replies, no cancellations
  const { store } = srv, hostWs = (await ok(await get("/api/workspace", H.c))).id;
  for (let i = 0; i < 10; i++) { const id = "aa" + String(i).padStart(14, "0"); store.set("system/bbreq-" + id, { kind: "bbreq", id, hostWs, handle: "bo-kitchen", pkgId: H.pkg.id, pkgName: "x", brandWs: "B" + (i % 4), company: "Co " + (i % 4), status: "done", date: day(-30 - i), headcount: 8, createdAt: Date.now() - 40 * 864e5, sentAt: Date.now() - 40 * 864e5, respondedAt: Date.now() - 40 * 864e5 + 2 * 3600e3, reviews: i < 4 ? { brand: { rating: 5, text: "Wonderful evening for our team.", at: Date.now() - 20 * 864e5 } } : {}, updatedAt: Date.now() }); }
  // the earlier real request was answered quickly too
  await ok(await post(`/api/bb/host/requests/${r0.id}`, { action: "decline" }, H.c));
  const X = await ok(await get(`/api/bb/x/bo-kitchen/${H.pkg.id}?people=8`)); assert.equal(X.stats.trusted, true, JSON.stringify(X.stats.checks)); assert.equal(X.reviews.brands.length, 4);
  const r1 = await ok(await post("/api/bb/requests", { handle: "bo-kitchen", pkg: H.pkg.id, date: weekdayAfter(12), headcount: 8 }, brand)); assert.equal(r1.instant, true); assert.equal(r1.status, "accepted");
  const paid = await ok(await post(`/api/bb/requests/${r1.id}/pay`, {}, brand)); assert.equal(paid.request.status, "booked");
  // ID check: pending until someone on the team approves it
  await ok(await post("/api/bb/host/verify/id", { legalName: "Bo Tran" }, H.c));
  assert.equal((await ok(await get("/api/bb/host/setup", H.c))).verify.id.state, "pending");
  const ops = await signup("Ops Person", "ops@pl.example", { mode: "work", company: "Pottery Lab" });
  assert.equal((await get("/api/bb/admin/verifications", brand)).status, 404);
  assert.ok((await ok(await get("/api/bb/admin/verifications", ops))).verifications.some((v) => v.handle === "bo-kitchen" && v.state === "pending"));
  await ok(await post("/api/bb/admin/verifications/bo-kitchen", { approve: true }, ops));
  assert.equal((await ok(await get(`/api/bb/x/bo-kitchen/${H.pkg.id}`))).stats.idChecked, true);
  // phone: a code by text
  await ok(await post("/api/bb/host/verify/phone", { phone: "+1 718 555 0101" }, H.c));
  const { fakeTexts } = await import("../server/sms.js"); const code = /(\d{6})/.exec(fakeTexts.at(-1).text)[1];
  assert.equal((await post("/api/bb/host/verify/phone/confirm", { code: "000000" }, H.c)).status, 400);
  await ok(await post("/api/bb/host/verify/phone/confirm", { code }, H.c));
  assert.equal((await ok(await get(`/api/bb/x/bo-kitchen/${H.pkg.id}`))).stats.phoneVerified, true);
  // two-way review through the API: the brand's review is public only once the host has written theirs
  const { store: st } = srv; const R = st.get("system/bbreq-" + r1.id).data; st.set("system/bbreq-" + r1.id, { ...R, date: day(-1) });
  await ok(await post(`/api/bb/requests/${r1.id}/review`, { rating: 5, text: "The team still talks about it." }, brand));
  assert.ok(!(await ok(await get(`/api/bb/x/bo-kitchen/${H.pkg.id}`))).reviews.brands.some((b) => /still talks/.test(b.text)));
  assert.equal((await ok(await get(`/api/bb/requests/${r1.id}`, H.c))).request.reviews.theirs, undefined);
  await ok(await post(`/api/bb/requests/${r1.id}/review`, { rating: 4, text: "Easy group, arrived on time." }, H.c));
  const pub = await ok(await get(`/api/bb/x/bo-kitchen/${H.pkg.id}`)); assert.ok(pub.reviews.brands.some((b) => /still talks/.test(b.text))); assert.ok(!JSON.stringify(pub).includes("arrived on time"));
  assert.match((await ok(await get(`/api/bb/requests/${r1.id}`, brand))).request.reviews.theirs.text, /arrived on time/);
});

test("Pages answer and old brand pages still work", async () => {
  for (const p of ["/teams/discover", "/teams/trusted", "/teams/x/ada-table/abc", "/teams/book/ada-table/abc", "/teams/list/abc", "/teams/list/abc/compare", "/teams/bookings", "/host/teams", "/hosts/book", "/teams", "/requests"]) { const r = await get(p); assert.equal(r.status, 200, p); }
  assert.equal((await get("/admin/hosts")).status, 404);
});

test("A question before booking: nothing held, contact details hidden, the host answers in the thread", async () => {
  const H = await makeHost("lark-kitchen", "Lark Kitchen", "lark@host.example");
  const brand = await signup("Remy Ade", "remy@brand.example", { mode: "work", company: "Remy Co" });
  const q = await ok(await post("/api/bb/questions", { handle: "lark-kitchen", pkg: H.pkg.id, headcount: 10, text: "Can you do nut-free for 10? Call me on 917 555 0123" }, brand));
  const B = (await ok(await get(`/api/bb/requests/${q.id}`, brand))).request;
  assert.equal(B.status, "question"); assert.equal(B.deposit.state, "none"); assert.match(B.messages[0].text, /number hidden/); assert.equal(B.contact, null);
  assert.equal((await post(`/api/bb/requests/${q.id}/pay`, {}, brand)).status, 409, "a question can't take a deposit");
  const inbox = (await ok(await get("/api/bb/host/requests", H.c))).requests.find((r) => r.id === q.id); assert.equal(inbox.statusText, "A question");
  await ok(await post(`/api/bb/requests/${q.id}/messages`, { text: "Yes, nut-free is easy." }, H.c));
  assert.equal((await ok(await get(`/api/bb/requests/${q.id}`, brand))).request.messages.length, 2);
});
