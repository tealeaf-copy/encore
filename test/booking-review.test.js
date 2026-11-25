import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { priceLines, STANDARD_CANCEL, DEPOSIT_PCT } from "../server/market.js";

let srv;
const J = { "content-type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (path) => fetch(srv.base + path);
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "review-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR"]) delete process.env[k]; await srv.close(); });

async function host(handle, exp) { const h = await post("/api/signup", { name: "Tram Host", email: `${handle}@example.com`, password: "long-password-1", mode: "friends" }); assert.equal(h.status, 200); const hc = cookieOf(h);
  const pr = await post("/api/host/profile", { forHire: true, handle, name: "Tram's Table", experiences: [exp] }, hc); assert.equal(pr.status, 200); return { hc, x: (await pr.json()).host.experiences[0] }; }

test("Price lines: total is people × price; content the host hasn't priced is 'quoted', never a silent $0", () => {
  const x = { name: "Lunch", price: "$85 a person", contentPrices: { photos: 400 }, usagePrices: { owned6m: 250 }, remoteKit: { price: 30 } };
  let P = priceLines(x, 25, {}); assert.equal(P.total, 2125); assert.equal(P.lines.length, 1); assert.equal(P.deposit, Math.round(2125 * DEPOSIT_PCT / 100));
  P = priceLines(x, 25, { deliverables: ["photos", "reel"], usage: "owned6m", raw: true, remote: 4 });
  assert.deepEqual(P.lines.map((l) => l.amount), [2125, 400, null, 250, null, 120]); assert.equal(P.total, 2125 + 400 + 250 + 120);
  assert.deepEqual(P.unpriced, ["A short recap reel", "Raw files"]);
  assert.equal(priceLines({ name: "Meetup", price: "$2,200 flat" }, 60, {}).total, 2200);
  assert.ok(priceLines({ name: "Lunch", price: "$85 a person" }, 10, { remote: 3 }).unpriced[0].startsWith("Remote kits"));
  assert.match(STANDARD_CANCEL, /7 days/);
});

test("Instant booking at the listed price carries the lines, a 50% deposit, and stays a request when content needs a quote", async () => {
  const { hc, x } = await host("review-instant", { name: "Family-style lunch", min: 10, max: 30, price: "$85 a person", category: "food", instant: true, openDates: [day(10), day(12)], contentPrices: { photos: "$400" } });
  assert.deepEqual(x.contentPrices, { photos: 400 });
  const r = await (await post("/api/public/book/review-instant", { name: "Sam", company: "Northwind", email: "sam@northwind.example", experienceId: x.id, people: 25, date: day(10), when: "soon", scope: { deliverables: ["photos"], usage: "organic30" } })).json();
  assert.equal(r.instant, undefined, "usage isn't priced, so it needs a quote"); assert.ok(r.share.includes("/booking/" + r.id));
  const r2 = await (await post("/api/public/book/review-instant", { name: "Sam", company: "Northwind", email: "sam@northwind.example", experienceId: x.id, people: 25, date: day(12), when: "later" })).json();
  assert.equal(r2.instant, true);
  const t2 = new URL(r2.link).searchParams.get("t"), b2 = (await (await get(`/api/public/booking/${r2.id}?t=${t2}`)).json()).booking;
  assert.equal(b2.status, "booked"); assert.equal(b2.quote.total, "$2,125"); assert.equal(b2.quote.deposit, "$1,063"); assert.equal(b2.quote.balanceDue, "after7"); assert.equal(b2.quote.lines[0].amount, 2125);
  const t = new URL(r.link).searchParams.get("t"), b = (await (await get(`/api/public/booking/${r.id}?t=${t}`)).json()).booking;
  assert.equal(b.status, "requested"); assert.equal(b.estimate.total, 2125 + 400); assert.deepEqual(b.estimate.unpriced, ["Usage: Organic social, 30 days"]);
  // the request form no longer needs an occasion for a booking
  const r3 = await post("/api/public/book/review-instant", { name: "Ana", company: "Acme", email: "ana@acme.example", experienceId: x.id, people: 12, date: day(20) }); assert.equal(r3.status, 200);
  void hc;
});

test("A read-only status link for teammates: status and money, no messages, can't accept or export guests", async () => {
  const { hc, x } = await host("review-share", { name: "Matcha workshop", min: 5, max: 40, price: "$65 a person", category: "drinks", openDates: [day(9)] });
  const r = await (await post("/api/public/book/review-share", { name: "Sam", company: "Northwind", email: "sam@share.example", experienceId: x.id, people: 20, date: day(9), time: "18:00", hold: true, message: "Customer dinner for our Q1 pipeline.",
    crm: { campaignId: "701ABC", system: "salesforce", accounts: "001A\n001B, Northwind Health", opportunityId: "006X", attendeesBack: true }, agency: { client: "Globex", markupPct: "15" } })).json();
  const t = new URL(r.link).searchParams.get("t"), v = new URL(r.share).searchParams.get("t"); assert.notEqual(t, v);
  const full = await (await get(`/api/public/booking/${r.id}?t=${t}`)).json();
  assert.equal(full.access, "full"); assert.ok(full.booking.holdUntil > Date.now()); assert.equal(full.booking.holdAsked, true);
  assert.deepEqual(full.booking.crm.accounts, ["001A", "001B", "Northwind Health"]); assert.equal(full.booking.crm.attendeesBack, true); assert.equal(full.booking.agency.markupPct, 15);
  await post(`/api/public/booking/${r.id}/message`, { t, text: "Can we start at 6?" });
  const view = await (await get(`/api/public/booking/${r.id}?t=${v}`)).json();
  assert.equal(view.access, "view"); assert.equal(view.booking.thread, undefined); assert.equal(view.booking.email, undefined); assert.deepEqual(view.booking.agency, { client: "Globex" }); assert.equal(view.booking.estimate.total, 1300);
  assert.equal((await post(`/api/public/booking/${r.id}/message`, { t: v, text: "hi" })).status, 403);
  assert.equal((await post(`/api/public/booking/${r.id}/accept`, { t: v })).status, 403);
  assert.equal((await get(`/api/public/booking/${r.id}?t=wrong`)).status, 403);
  const res = await (await get(`/api/public/booking/${r.id}/results?t=${v}`)).json(); assert.equal(res.readOnly, true); assert.equal(res.doorLink, "");
  // the host never sees the agency's markup
  const hb = (await (await fetch(srv.base + "/api/host/bookings", { headers: { cookie: hc } })).json()).bookings.find((b) => b.id === r.id); assert.deepEqual(hb.agency, { client: "Globex" });
  // a calendar hold anyone on the team can add
  const ics = await get(`/api/public/booking/${r.id}/calendar.ics?t=${v}`); assert.equal(ics.status, 200); assert.match(ics.headers.get("content-type"), /text\/calendar/);
  const body = await ics.text(); assert.match(body, new RegExp(`DTSTART:${day(9).replace(/-/g, "")}T180000`)); assert.match(body, /STATUS:TENTATIVE/); assert.match(body, /SUMMARY:HOLD: Matcha workshop/);
  // attendee export: full link only, from the guest page's RSVPs and check-ins
  assert.equal((await get(`/api/public/booking/${r.id}/attendees.csv?t=${t}`)).status, 404);
  const ev = await (await post(`/api/public/booking/${r.id}/event`, { t })).json(); const eid = ev.link.split("rsvp-")[1];
  for (const [nm, inn] of [["Rita Ng", true], ["Omar Diaz", false]]) { const id = (await (await post("/api/db/collection?path=rsvps", { eventId: eid, name: nm, email: `${nm.split(" ")[0].toLowerCase()}@globex.example`, company: "Globex", response: "going", code: "c" + nm }, hc)).json()).id; if (inn) await post(`/api/public/booking/${r.id}/door`, { t, rid: id }); }
  assert.equal((await get(`/api/public/booking/${r.id}/attendees.csv?t=${v}`)).status, 403);
  const csv = (await (await get(`/api/public/booking/${r.id}/attendees.csv?t=${t}`)).text()).trim().split("\n");
  assert.equal(csv[0], "name,email,company,checked_in,campaign_id,opportunity_id"); assert.equal(csv.length, 3);
  assert.ok(csv.some((l) => l.startsWith('"Rita Ng","rita@globex.example","Globex","yes","701ABC"'))); assert.ok(csv.some((l) => l.includes('"Omar Diaz"') && l.includes('"no"')));
  // outcomes: meetings, pipeline, content; cost per meeting
  assert.equal((await post(`/api/public/booking/${r.id}/campaign`, { t, campaign: { meetings: 4, pipeline: "$80,000", posts: ["https://www.instagram.com/p/abc", "javascript:alert(1)"], reach: "12,400", saves: 310, promoCode: "MATCHA10", redemptions: 22 } })).status, 200);
  const out = await (await get(`/api/public/booking/${r.id}/results?t=${t}`)).json();
  assert.equal(out.costPerMeeting, 325); assert.deepEqual(out.campaign.posts, ["https://www.instagram.com/p/abc"]); assert.equal(out.campaign.reach, 12400); assert.equal(out.campaign.redemptions, 22);
});

test("Listing opt-in: listOk is saved only when the brand ticks it (default off), and a host's status change reads as a sentence", async () => {
  const { hc, x } = await host("review-listok", { name: "Tea tasting", min: 4, max: 20, price: "$40 a person", category: "drinks" });
  const ask = async (extra, email) => { const r = await (await post("/api/public/book/review-listok", { name: "Ana Lee", company: "Helix", email, experienceId: x.id, people: 8, date: day(20), when: "later", ...extra })).json(); const t = new URL(r.link).searchParams.get("t"); return { r, t, j: await (await get(`/api/public/booking/${r.id}?t=${t}`)).json() }; };
  const yes = await ask({ listOk: true }, "ana@helix.example"), no = await ask({}, "bo@helix.example"), str = await ask({ listOk: "yes" }, "cy@helix.example");
  assert.equal(yes.j.booking.listOk, true);
  assert.equal(no.j.booking.listOk, undefined, "not ticked: never listed");
  assert.equal(str.j.booking.listOk, undefined, "only a real true counts");
  assert.equal(typeof yes.j.emailOn, "boolean"); assert.equal(yes.j.host.person, "Tram");
  assert.equal((await post(`/api/host/bookings/${yes.r.id}`, { status: "done" }, hc)).status, 200);
  const h2 = (await (await get(`/api/public/booking/${yes.r.id}?t=${yes.t}`)).json()).booking.history; assert.equal(h2.at(-1).what, "marked it done");
});
