// Brand proposals (server/proposals.js, server/proposaldoc.js, server/proposaltemplates.js, public/proposals.html):
// filled in from real data only, the new-host framing, labels, pricing math and the deposit, token access and noindex,
// the PDFs with the signature on every page, accept / question / decline wired into team bookings, and privacy.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore, getDbUser } from "../server/workspaces.js";
import { priceTier, readiness, rewriteLocal, parseAddOnPrice, bookingPrice } from "../server/proposals.js";
import { TEMPLATES, guessTemplate } from "../server/proposaltemplates.js";
import { pdfText } from "../server/proposaldoc.js";

let srv;
const J = { "content-type": "application/json" };
const req = (method, p, body, cookie) => fetch(srv.base + p, { method, headers: { ...J, ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
const post = (p, body, cookie) => req("POST", p, body, cookie), get = (p, cookie) => req("GET", p, null, cookie);
const ok = async (r) => { const t = await r.text(); assert.ok(r.ok, `${r.status} ${t.slice(0, 300)}`); return JSON.parse(t); };
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const weekdayAfter = (n) => { for (let i = n; i < n + 10; i++) { const d = day(i), w = new Date(d + "T12:00:00Z").getUTCDay(); if (w >= 1 && w <= 5) return d; } };
async function signup(name, email, extra = {}) { const r = await post("/api/signup", { name, email, password: "long-password-1", ...extra }); assert.ok(r.ok, await r.clone().text()); return cookieOf(r); }
async function makeHost(handle, name, email, person = "Ada Lane") {
  const c = await signup(person, email, { mode: "friends" });
  await ok(await post("/api/host/profile", { handle, name, city: "New York", hood: "Greenpoint", forHire: true, bio: "I cook long dinners for people who like to talk." }, c));
  const S = await ok(await post("/api/bb/host/setup", { on: true, policy: "standard", area: "Greenpoint", city: "New York", address: "12 Quiet Street, Apt 3", phone: "+1 718 555 0100", story: "I cook for people I like.", since: 2019,
    packages: [{ name: "Supper club for your team", story: "Six courses at a long table.", moods: ["client"], perPersonCents: 12000, minimumCents: 120000, minGuests: 6, maxGuests: 20, leadDays: 7, includes: ["Ingredients", "Service"], weekdays: [1, 2, 3, 4, 5], time: "evening", depositPct: 25 }] }, c));
  return { c, pkg: S.setup.packages[0], ws: getDbUser(email).ws };
}
const brandOf = (n, e, co) => signup(n, e, { mode: "work", company: co });
async function requestFrom(brand, handle, pkg, extra = {}) { return ok(await post("/api/bb/requests", { handle, pkg, date: weekdayAfter(30), headcount: 12, diets: ["vegetarian"], occasion: "Customer thank-you night", notes: "Warm, not salesy. Call me on 917 555 0199", ...extra }, brand)); }

before(async () => { srv = await startServer(); });
beforeEach(() => { Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "proposals-secret-0123456789", ENCORE_SIGNUP_PER_HOUR: "500", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_SMS: "1" }); resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_SMS", "ENCORE_TEAM_FEE_BPS"]) delete process.env[k]; await srv.close(); });

test("pricing: per person, per unit, minimums, add-ons in and out of the total, the fee in dollars, deposit and schedule", () => {
  const t = { name: "Better", unit: "person", cents: 12500, minimumCents: 150000, addOns: [{ name: "Wine pairing", cents: 4500, per: "person", on: true }, { name: "Photographer", cents: 45000, per: "flat", on: false }] };
  const P = priceTier(t, 16, { depositPct: 25, feeBps: 0 });
  assert.equal(P.subtotalCents, 12500 * 16 + 4500 * 16); assert.equal(P.totalCents, 272000); assert.equal(P.depositCents, 68000); assert.equal(P.balanceCents, 204000);
  assert.equal(P.lines.reduce((a, l) => a + l.cents, 0), P.totalCents, "the lines add up to the total");
  assert.deepEqual(P.optional.map((o) => o.name), ["Photographer"], "add-ons that are off show as optional, not in the total");
  assert.deepEqual(P.schedule.map((s) => s.cents), [68000, 204000]); assert.equal(P.schedule[0].when, "When you accept");
  const small = priceTier(t, 6, { depositPct: 50, feeBps: 0 }); assert.equal(small.lines.find((l) => l.k === "minimum").cents, 150000 - 75000); assert.equal(small.depositCents, Math.round(small.totalCents / 2));
  const hour = priceTier({ unit: "hour", cents: 22000, minUnits: 3 }, 80, { feeBps: 0 }); assert.equal(hour.units, 3); assert.equal(hour.totalCents, 66000, "an hourly package is priced on its hours, not the guests");
  const table = priceTier({ unit: "table", cents: 14000, perUnitGuests: 8 }, 20, { feeBps: 0 }); assert.equal(table.units, 3);
  const pkg = priceTier({ unit: "package", cents: 300000, line: "The whole studio" }, 40, { feeBps: 0 }); assert.equal(pkg.totalCents, 300000);
  const fee = priceTier(t, 16, { depositPct: 25, feeBps: 500 }); assert.equal(fee.feeCents, Math.round(272000 * 0.05)); assert.ok(fee.lines.every((l) => !/%/.test(l.label)), "never a fee percentage");
  const B = bookingPrice(t, 16, { depositPct: 25, feeBps: 0 }); assert.equal(B.totalCents, 272000); assert.equal(B.depositCents, 68000); assert.equal(B.lines[0].k, "people");
  assert.deepEqual(parseAddOnPrice("$65 a person"), { cents: 6500, per: "person" }); assert.deepEqual(parseAddOnPrice("From $900"), { cents: 90000, per: "flat" });
});

test("templates: six starting points for the kinds of hosts brands book, each with three concepts and Good, Better, Best", () => {
  assert.deepEqual(TEMPLATES.map((t) => t.id), ["dinner", "workshop", "wellness", "popup", "active", "services"]);
  for (const t of TEMPLATES) { assert.equal(t.concepts.length, 3, t.id); assert.deepEqual(t.tiers.map((x) => x.name), ["Good", "Better", "Best"]); assert.ok(t.ros.length >= 4 && t.timeline.length >= 4 && t.examples.length, t.id); }
  assert.equal(guessTemplate("Omakase counter for 12"), "dinner"); assert.equal(guessTemplate("Matcha workshop"), "workshop"); assert.equal(guessTemplate("Sunrise yoga"), "wellness"); assert.equal(guessTemplate("Espresso cart"), "popup"); assert.equal(guessTemplate("5k run club"), "active"); assert.equal(guessTemplate("Photo booth"), "services");
  const words = JSON.stringify(TEMPLATES); assert.doesNotMatch(words, /—/); assert.doesNotMatch(words, /\b(attendees|curated|seamless|elevate|unlock|per person)\b/i);
});

test("Potto offline: shorter is shorter, warmer is warmer, and neither adds a number", () => {
  const t = "We will cook five courses for your team. Every dietary need is planned for. We really do care about the room. Service and clean-up are included.";
  const s = rewriteLocal(t, "shorter"), w = rewriteLocal(t, "warmer"); assert.ok(s.length < t.length); assert.ok(w.includes("We'll")); assert.doesNotMatch(s + w, /\d{2,}/);
  assert.equal(pdfText("“Hi” — it’s… ok"), "\"Hi\" - it's... ok");
});

test("a first-time host: filled in from the request, the First brand partnership framing, offline work labelled, never an invented number", async () => {
  const H = await makeHost("fresh-table", "Fresh Table", "fresh@host.example"), brand = await brandOf("Dana Reyes", "dana@fernlight.example", "Fernlight");
  const R = await requestFrom(brand, "fresh-table", H.pkg.id);
  const { id } = await ok(await post("/api/proposals", { requestId: R.id }, H.c));
  assert.equal((await ok(await post("/api/proposals", { requestId: R.id }, H.c))).id, id, "one proposal a request");
  let D = await ok(await get(`/api/proposals/${id}`, H.c)); const P = D.proposal;
  assert.equal(P.brand.name, "Fernlight"); assert.equal(P.brand.headcount, 12); assert.equal(P.brand.contact, "Dana"); assert.equal(P.brand.occasion, "Customer thank-you night");
  assert.match(P.brand.brief, /vegetarian/); assert.doesNotMatch(P.brand.brief, /917|555/, "the brief keeps the request's hidden numbers hidden");
  assert.equal(P.template, "dinner"); assert.equal(P.sections.pricing.tiers[1].cents, 12000, "the Better package is the host's own package price");
  assert.match(P.sections.about.text, /Fresh Table/); assert.match(P.sections.about.text, /long dinners/, "the about paragraph is drafted from the page bio");
  assert.equal(D.proof.isNew, true); assert.deepEqual(D.proof.stats, []); assert.match(D.tips.proof, /No numbers here yet/);
  assert.match(D.html, /First brand partnership/); assert.doesNotMatch(D.html, /events hosted|guests welcomed|would go again/, "no stats for a new host");
  assert.equal(D.readiness.items.find((i) => i.k === "proof").done, false);
  D = await ok(await req("PUT", `/api/proposals/${id}`, { sections: { proof: { offline: [{ what: "Supper for a design studio launch", when: "Spring 2025", people: "40 guests" }] } } }, H.c));
  assert.match(D.html, /Host-provided/); assert.match(D.html, /Not checked by Pottery Lab/); assert.equal(D.readiness.items.find((i) => i.k === "proof").done, true);
  assert.doesNotMatch(D.html, /Verified by Pottery Lab/, "nothing is marked verified when there's nothing from the platform");
  assert.ok(D.guide.own && /Your own prices/.test(D.guide.own.text)); assert.match(D.guide.start.text, /An estimate, not platform data/); assert.equal(D.guide.peers, null, "similar hosts need 3 or more real hosts");
  // the host can't type a number into the proof: unknown fields are dropped
  D = await ok(await req("PUT", `/api/proposals/${id}`, { sections: { proof: { stats: [{ n: "500", label: "events hosted" }] } } }, H.c)); assert.doesNotMatch(D.html, /500/);
});

test("an experienced host: real numbers marked Verified, kudos with first names only as the guest allows, private events and emails never shown", async () => {
  const H = await makeHost("long-table", "Long Table", "long@host.example", "Ines Marlow"), S = scopeStore(srv.store, H.ws);
  const jordan = await signup("Jordan Hale", "jordan@guest.example", { mode: "friends" }); await ok(await post("/api/me/prefs", { socialName: "hosts" }, jordan));
  const guests = ["maya@guest.example", "jordan@guest.example", "kit@guest.example", "lee@guest.example", "sam@guest.example"];
  for (let i = 0; i < 5; i++) { S.set(`events/lt${i}`, { kind: "social", casual: true, name: `Long table night ${i + 1}`, date: day(-10 - i * 14), startTime: "19:00", city: "New York", published: true, discoverable: true });
    guests.forEach((g, j) => { if (i < 2 || j < 3) S.set(`rsvps/lt${i}g${j}`, { eventId: `lt${i}`, email: g, name: g.split("@")[0], response: "going", createdAt: Date.now() - 864e5 * (20 + i) }); }); }
  S.set("events/ltsecret", { kind: "social", casual: true, name: "Secret supper for the Okafor family", date: day(-3), startTime: "19:00", published: true, discoverable: false });
  S.set("kudos/k1", { eventId: "lt0", rid: "lt0g0", name: "Maya Lopez", email: "maya@guest.example", tags: ["again"], love: "The best night out I have had all year, honestly.", at: Date.now() - 5e8 });
  S.set("kudos/k2", { eventId: "lt1", rid: "lt1g1", name: "Jordan Hale", email: "jordan@guest.example", tags: ["again"], love: "I met three people I still text. Lovely food too.", at: Date.now() - 4e8 });
  S.set("kudos/k3", { eventId: "ltsecret", rid: "s1", name: "Kit Okafor", email: "kit@guest.example", tags: ["again"], love: "Thank you for my mum's birthday dinner, it was perfect.", at: Date.now() - 1e8 });
  srv.app.locals.social.bust();
  const brand = await brandOf("Ola Nowak", "ola@fernlight2.example", "Fernlight North"), R = await requestFrom(brand, "long-table", H.pkg.id);
  const { id } = await ok(await post("/api/proposals", { requestId: R.id }, H.c)); const D = await ok(await get(`/api/proposals/${id}`, H.c));
  const K = Object.fromEntries(D.proof.stats.map((s) => [s.k, s.n]));
  assert.equal(D.proof.isNew, false); assert.equal(K.events, "6"); assert.equal(K.guests, "5"); assert.ok(K.again); assert.equal(K.repeat, "5", "guests who came to more than one");
  assert.match(D.html, /Verified by Pottery Lab/); assert.match(D.tips.proof, /Brands love a number/);
  const names = D.proof.quotes.map((q) => q.name); assert.deepEqual(names.sort(), ["A guest", "Maya"], "first name only, and Jordan's setting hides theirs");
  const all = JSON.stringify(D.proof) + D.html; assert.doesNotMatch(all, /Lopez|Hale|Okafor|Secret supper|@guest\.example|mum's birthday/, "no last names, private events or emails");
  const sent = await ok(await post(`/api/proposals/${id}/send`, {}, H.c));
  const pdf = Buffer.from(await (await get(`${sent.path}/pdf`)).arrayBuffer()).toString("latin1"); assert.doesNotMatch(pdf, /Lopez|Okafor|@guest\.example/);
  assert.match(pdf, /VERIFIED BY POTTERY LAB/);
});

test("sending: an unguessable link, noindex, the reply in the request thread, the brand page, the PDFs with the signature on every page and the card", async () => {
  const H = await makeHost("send-table", "Send Table", "send@host.example"), brand = await brandOf("Rae Kim", "rae@fernlight3.example", "Fernlight Three"), R = await requestFrom(brand, "send-table", H.pkg.id);
  const { id } = await ok(await post("/api/proposals", { requestId: R.id }, H.c));
  assert.equal((await ok(await get(`/api/proposals/${id}`, H.c))).url, "", "no link before sending");
  assert.ok([404, 409].includes((await get(`/api/proposals/${id}`, brand)).status), "a draft is the host's only");
  const s = await ok(await post(`/api/proposals/${id}/send`, { note: "Thanks for thinking of me." }, H.c)); const tok = s.path.split("/").pop();
  assert.ok(tok.length >= 24 && /^[A-Za-z0-9_-]+$/.test(tok)); assert.equal(s.posted, true);
  const thread = (await ok(await get(`/api/bb/requests/${R.id}`, brand))).request; assert.ok(thread.messages.some((m) => m.from === "host" && m.text.includes(s.path) && /Thanks for thinking of me/.test(m.text)));
  assert.ok(thread.respondedAt > 0, "a proposal counts as a reply");
  assert.equal((await ok(await get(`/api/proposals/for-request/${R.id}`, brand))).proposals[0].url, s.path, "the brand's booking page finds it");
  const page = await get(s.path); const html = await page.text();
  assert.equal(page.status, 200); assert.match(page.headers.get("x-robots-tag"), /noindex/); assert.match(html, /<meta name="robots" content="noindex, nofollow">/); assert.match(page.headers.get("cache-control"), /no-store/);
  assert.match(html, /Powered by Pottery Lab/); assert.match(html, /Booked and paid through Pottery Lab/); assert.match(html, /href="[^"]*\/@send-table"/, "the signature links to the host's page");
  assert.match(html, /og:image" content="[^"]*\/og\.png"/); assert.match(html, /Accept and pay the deposit/); assert.match(html, /Ask a question/); assert.match(html, /Decline/);
  assert.match(html, /Estimate/); assert.match(html, /not legal advice/);
  assert.equal((await get(`/p-brand/${"A".repeat(24)}`)).status, 404); assert.equal((await get(`/p-brand/${tok.slice(0, -1)}x`)).status, 404); assert.equal((await get("/p-brand/short")).status, 404);
  for (const q of ["", "?pages=one"]) { const r = await get(`${s.path}/pdf${q}`), b = Buffer.from(await r.arrayBuffer()), t = b.toString("latin1");
    assert.equal(r.headers.get("content-type"), "application/pdf"); assert.ok(t.startsWith("%PDF")); const pages = (t.match(/\/Type \/Page\b/g) || []).length;
    assert.ok(q ? pages === 1 : pages >= 2, `pages ${pages}`);
    assert.equal((t.match(/\(Powered by Pottery Lab\) Tj/g) || []).length, pages, "the signature on every page"); assert.equal((t.match(/\(Booked and paid through Pottery Lab\) Tj/g) || []).length, pages); }
  const og = await get(`${s.path}/og.png`); assert.equal(og.headers.get("content-type"), "image/png"); assert.ok(Buffer.from(await og.arrayBuffer()).length > 1000);
  // views: counts only, the host's own look doesn't count
  await get(s.path, H.c); const L = await ok(await get("/api/proposals", H.c)); const mine = L.proposals.find((p) => p.id === id); assert.equal(mine.views, 1); assert.equal(typeof mine.answers, "object");
  assert.doesNotMatch(JSON.stringify(L), /rae@|Rae Kim/, "the host's list holds counts, not who looked");
  assert.match(fs.readFileSync(new URL("../public/proposals.css", import.meta.url), "utf8"), /@media print\{[\s\S]*\.pp-printfoot\{display:flex[^}]*position:fixed/, "Save as PDF repeats the signature footer too");
});

test("the brand answers: accept goes into the booking and deposit path, a question into the thread, decline is counted; strangers can't", async () => {
  const H = await makeHost("answer-table", "Answer Table", "answer@host.example"), brand = await brandOf("Lu Park", "lu@fernlight4.example", "Fernlight Four"), other = await brandOf("Bo Chan", "bo@other.example", "Other Co");
  const R = await requestFrom(brand, "answer-table", H.pkg.id); const { id } = await ok(await post("/api/proposals", { requestId: R.id }, H.c));
  await ok(await req("PUT", `/api/proposals/${id}`, { sections: { plan: { guests: 16 }, pricing: { depositPct: 50 } } }, H.c));
  const s = await ok(await post(`/api/proposals/${id}/send`, {}, H.c)), tok = s.path.split("/").pop(), A = `/api/p-brand/${tok}/respond`;
  const anon = await post(A, { action: "accept", tier: 1 }); assert.equal(anon.status, 401); assert.match((await anon.json()).login, /^\/login\?next=/);
  assert.equal((await post(A, { action: "accept", tier: 1 }, other)).status, 403, "another team can't accept");
  assert.equal((await post(A, { action: "accept" }, H.c)).status, 403, "the host can't answer their own");
  await ok(await post(A, { action: "question", text: "Can we do a Thursday instead? Email me at lu@fernlight4.example" }, brand));
  let r = (await ok(await get(`/api/bb/requests/${R.id}`, brand))).request; const q = r.messages.at(-1); assert.equal(q.from, "brand"); assert.match(q.text, /Thursday/); assert.doesNotMatch(q.text, /lu@fernlight4/, "contact details stay hidden before booking");
  const acc = await ok(await post(A, { action: "accept", tier: 1 }, brand)); assert.equal(acc.url, `/teams/bookings/${R.id}`);
  r = (await ok(await get(`/api/bb/requests/${R.id}`, brand))).request; const want = priceTier({ unit: "person", cents: 12000, minimumCents: 120000 }, 16, { depositPct: 50, feeBps: 0 });
  assert.equal(r.status, "accepted"); assert.equal(r.price.totalCents, want.totalCents); assert.equal(r.deposit.cents, want.depositCents); assert.equal(r.headcount, 16); assert.ok(r.history.some((h) => /accepted the proposal \(Better\)/.test(h.what)));
  const paid = await ok(await post(`/api/bb/requests/${R.id}/pay`, {}, brand)); assert.equal(paid.request.status, "booked", "the deposit books it, the usual way");
  const L = (await ok(await get("/api/proposals", H.c))).proposals.find((p) => p.id === id); assert.equal(L.status, "accepted"); assert.equal(L.answers.accept, 1); assert.equal(L.answers.question, 1); assert.equal(L.answer.tier, "Better");
  assert.equal((await post(A, { action: "decline" }, brand)).status, 409, "an accepted proposal can't be declined");
  assert.match(await (await get(s.path, brand)).text(), /Accepted: Better/);
  // a pitch with no request: decline needs no account and is counted; accept makes a team booking
  const p2 = await ok(await post("/api/proposals", { template: "workshop", brand: { name: "Fernlight", headcount: 10 } }, H.c)); const s2 = await ok(await post(`/api/proposals/${p2.id}/send`, {}, H.c));
  assert.equal(s2.posted, false); assert.ok((await ok(await post(`/api/p-brand/${s2.path.split("/").pop()}/respond`, { action: "decline" }))).ok);
  assert.equal((await ok(await get("/api/proposals", H.c))).proposals.find((p) => p.id === p2.id).answers.decline, 1);
  const p3 = await ok(await post("/api/proposals", { template: "popup", brand: { name: "Fernlight", headcount: 60 } }, H.c)); const s3 = await ok(await post(`/api/proposals/${p3.id}/send`, {}, H.c));
  const a3 = await ok(await post(`/api/p-brand/${s3.path.split("/").pop()}/respond`, { action: "accept", tier: 0 }, other)); const r3 = (await ok(await get(a3.url.replace("/teams/bookings/", "/api/bb/requests/"), other))).request;
  assert.equal(r3.status, "accepted"); assert.equal(r3.price.totalCents, 2 * 22000, "the Good coffee cart: two hours at $220"); assert.equal(r3.company, "Other Co");
  const hostSide = (await ok(await get("/api/bb/host/requests", H.c))).requests.find((x) => x.id === r3.id); assert.ok(hostSide, "the host sees the new booking in Team requests");
});

test("examples: from the example hosts, labelled Example on the page, the PDF and the card, never Verified and never answerable", async () => {
  const T = (await ok(await get("/api/proposals/templates"))).templates; assert.equal(T.length, 6); assert.ok(T.every((t) => t.example.startsWith("/proposals/example/")));
  for (const t of T) { const r = await get(t.example), h = await r.text(); assert.equal(r.status, 200, t.id); assert.match(h, /<b>Example<\/b> This is an example proposal/); assert.match(h, /Fernlight/); assert.doesNotMatch(h, /Verified by Pottery Lab/); assert.doesNotMatch(h, /Counted from real events/, "an example never claims real numbers"); assert.match(h, /noindex/); assert.doesNotMatch(h, /data-act="accept"/, "an example can't be accepted"); }
  const pdf = Buffer.from(await (await get("/proposals/example/dinner/pdf")).arrayBuffer()).toString("latin1"); const pages = (pdf.match(/\/Type \/Page\b/g) || []).length;
  assert.equal((pdf.match(/Booked and paid through Pottery Lab · Example\) Tj/g) || []).length, pages, "every page footer says Example");
  assert.equal((await get("/proposals/example/nope")).status, 404);
});

test("readiness: photo, price, cancellation and contact on the checklist, with a meter", () => {
  const base = { brand: { name: "Fernlight" }, sections: { about: { photo: "" }, idea: { concepts: [{ name: "X" }] }, proof: { offline: [] }, pricing: { tiers: [{ cents: 1000 }] }, terms: { policy: "standard" }, next: { question: true } } };
  const R = readiness(base, { proof: { isNew: true, stats: [] } }); assert.deepEqual(R.items.map((i) => i.k), ["brand", "photo", "idea", "proof", "price", "cancel", "contact"]);
  assert.equal(R.items.find((i) => i.k === "photo").done, false); assert.equal(R.pct, Math.round((5 / 7) * 100));
  assert.equal(readiness({ ...base, sections: { ...base.sections, pricing: { tiers: [{ cents: 0 }] } } }).items.find((i) => i.k === "price").done, false);
});

test("the builder and hooks: steps with a live preview, Potto tips and rewrites, the request view links, no em dashes or model names", async () => {
  const H = await makeHost("page-table", "Page Table", "page@host.example");
  const r = await get("/proposals", H.c); assert.equal(r.status, 200); const html = await r.text();
  for (const s of ["Who it's for", "About you", "Proof", "The idea", "The plan", "Pricing", "Timeline and terms", "Send", "Live preview", "Make it shorter", "Make it warmer", "Ready to send"]) assert.ok(html.includes(s), s);
  const { id } = await ok(await post("/api/proposals", { template: "wellness", brand: { name: "Fernlight" } }, H.c));
  const rw = await ok(await post("/api/proposals/rewrite", { text: "We will run a calm hour for your team. It is gentle and anyone can come along to it.", how: "warmer" }, H.c)); assert.match(rw.text, /We'll/); assert.equal(rw.by, "rules");
  const c = await ok(await post(`/api/proposals/${id}/potto`, { what: "concepts" }, H.c)); assert.equal(c.concepts.length, 3); assert.ok(c.concepts.every((x) => x.name && !/\{brand\}/.test(x.line + x.brand)));
  assert.match(fs.readFileSync(new URL("../public/host-teams.html", import.meta.url), "utf8"), /\/proposals\/new\?request=\$\{r\.id\}/);
  assert.match(fs.readFileSync(new URL("../public/team-bookings.html", import.meta.url), "utf8"), /\/api\/proposals\/for-request\//);
  for (const f of ["server/proposals.js", "server/proposaldoc.js", "server/proposaltemplates.js", "public/proposals.html", "public/proposals.css"]) { const s = fs.readFileSync(new URL("../" + f, import.meta.url), "utf8"); assert.doesNotMatch(s, /—/, f); assert.doesNotMatch(s, /claude|opus|sonnet|haiku|gpt/i, f); }
  assert.equal((await get("/api/proposals")).status, 401);
});
