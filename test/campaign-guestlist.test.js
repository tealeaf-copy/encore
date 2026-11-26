// Campaigns and the invite planner as one guest list (review 16): a booked campaign event gets its own invite page in
// the brand's workspace, its guests go into People (with their consent) and onto that event's plan, sends go through
// the plan for people who agreed and the campaign's own link for everyone else, replies on the invite page come back
// to the campaign, the plan's nudge reaches people who haven't replied, and each event has a run of show in its own
// time zone. The world is invented (test/brand-intel-seed.js).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { seedBrandIntel } from "./brand-intel-seed.js";
import { defaultRunOfShow, cleanRunOfShow, statusFromRsvp } from "../server/campaigns.js";
import { scopeStore } from "../server/workspaces.js";
import fs from "node:fs";

let srv, S;
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "campaign-guestlist-0123456789", ENCORE_SIGNUP_PER_HOUR: "1000", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_SMS: "1", ENCORE_INSIGHTS_CACHE_MS: "0" };
const J = { "content-type": "application/json" };
const req = (method, p, body, cookie, h = {}) => fetch(srv.base + p, { method, headers: { ...J, ...(cookie ? { cookie } : {}), ...h }, body: body ? JSON.stringify(body) : undefined });
const ok = async (r) => { const t = await r.text(); assert.ok(r.ok, `${r.status} ${t.slice(0, 300)}`); return JSON.parse(t); };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
before(async () => { Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer(); S = await seedBrandIntel(srv.base, srv.store, { guests: 40 }); });
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

test("run of show: a first draft from the start time, cleaned and in order; replies map to the campaign's words", () => {
  const D = defaultRunOfShow("19:00"); assert.equal(D[0].at, "18:00"); assert.equal(D[2].at, "19:00"); assert.ok(D.every((x) => x.what));
  assert.equal(defaultRunOfShow("00:30")[0].at, "23:30", "wraps around midnight");
  assert.deepEqual(cleanRunOfShow([{ at: "20:00", what: "Dessert" }, { at: "18:30", what: "Doors" }, { at: "25:00", what: "Odd time" }, { at: "19:00", what: "" }]).map((x) => x.at), ["18:30", "20:00", ""]);
  assert.equal(statusFromRsvp({ response: "going" }), "yes"); assert.equal(statusFromRsvp({ response: "no" }), "no"); assert.equal(statusFromRsvp({ response: "waitlist" }), "waitlist"); assert.equal(statusFromRsvp(null), "");
});

test("one guest list: a booked event gets an invite page, People and a plan; sends, replies and nudges flow both ways", async () => {
  const O = S.owner.c, id = S.campaigns.C1;
  let C = (await ok(await req("GET", `/api/campaigns/${id}`, null, O))).campaign;
  const ev = C.bookings.find((b) => b.status === "booked" && b.date >= day(0)); assert.ok(ev, "an upcoming booked event");
  const pending = C.bookings.find((b) => ["requested", "approval", "countered"].includes(b.status));
  if (pending) assert.equal((await req("POST", `/api/campaigns/${id}/events/${pending.id}/plan`, {}, O)).status, 409, "not before the host accepts");
  // two new guests on that event: one agreed to hear from the brand, one didn't
  await ok(await req("POST", `/api/campaigns/${id}/guests`, { guests: [{ name: "Ada Yes", email: "ada.yes@guest.example", company: "Acme", consent: true }, { name: "Ben Maybe", email: "ben.maybe@guest.example" }], event: ev.id }, O));
  const P = await ok(await req("POST", `/api/campaigns/${id}/events/${ev.id}/plan`, {}, O));
  assert.match(P.eventId, /^cg/); assert.equal(P.board, `/contacts/event/${P.eventId}`); assert.equal(P.invite, `/e/${P.eventId}`);
  const ws = S.brandWs, E = scopeStore(srv.store, ws).get("events/" + P.eventId).data;
  assert.equal(E.bookingId, ev.id); assert.equal(E.campaignId, id); assert.equal(E.headcount, ev.headcount); assert.equal(E.discoverable, false); assert.equal(E.autoRemind, true, "the day-before reminder is on");
  assert.ok(E.date === ev.date && /^\d{2}:\d{2}$/.test(E.startTime));
  assert.ok(E.tz === "" || /\//.test(E.tz), "a city's time zone when we know it");
  assert.equal((await req("GET", `/e/${P.eventId}`)).status, 200, "the invite page opens");
  // People: the brand's book has both, with consent only for the one who agreed; the plan has both
  const book = (await ok(await req("GET", "/api/contacts?q=guest.example", null, O))).people || [];
  const ada = book.find((p) => p.email === "ada.yes@guest.example"), ben = book.find((p) => p.email === "ben.maybe@guest.example");
  assert.ok(ada && ben, "both in People"); assert.equal(ada.consent?.status, "in"); assert.notEqual(ben.consent?.status, "in");
  const plan = (await ok(await req("GET", `/api/plan/${P.eventId}`, null, O)));
  assert.ok(JSON.stringify(plan).includes(ada.id) && JSON.stringify(plan).includes(ben.id), "both on the plan");
  // what the campaign already knew (sent, yes, no, checked in) shows on the board: replies on the event, sends on the plan
  const before = C.guests.filter((g) => g.event === ev.id), R0 = scopeStore(srv.store, ws).list("rsvps").map((d) => d.data).filter((r) => r.eventId === P.eventId && r.via === "campaign");
  assert.equal(R0.filter((r) => r.response === "going").length, before.filter((g) => g.status === "yes" || g.checkedIn).length, "every yes is a reply on the event");
  assert.equal(R0.filter((r) => r.response === "no").length, before.filter((g) => g.status === "no" && !g.checkedIn).length);
  const pl0 = scopeStore(srv.store, ws).get("invplans/" + P.eventId).data.people;
  assert.equal(Object.values(pl0).filter((e) => e.invitedAt).length, before.filter((g) => g.email && ["invited", "yes", "no", "waitlist"].includes(g.status)).length, "sent ones show as sent");
  assert.ok(book.every((p) => !(p.tags || []).some((t) => t.length > 30)), "the campaign tag fits");
  // send: Ada through the plan, Ben with the campaign's own link (it asks him for consent)
  const sent = await ok(await req("POST", `/api/campaigns/${id}/invites`, { event: ev.id }, O));
  assert.ok(sent.viaPlan >= 1, "Ada's invite went through the plan"); assert.ok(sent.links.some((l) => l.name === "Ben"), "Ben gets the campaign link");
  // Ada says yes on the event's own page; the campaign reads it back
  const doc = await (await req("GET", "/api/db/doc?path=events/" + P.eventId, null, null, { "x-encore-guest": "1" })).json();
  const r = await req("POST", "/api/db/collection?path=rsvps", { eventId: P.eventId, response: "going", name: "Ada Yes", email: "ada.yes@guest.example", code: "CADA01", createdAt: Date.now(), via: "invite-lite" }, null, { "x-encore-guest": "1", "x-encore-key": "kadayesguest1", "x-encore-workspace": doc.workspace });
  assert.equal(r.status, 200, await r.text());
  C = (await ok(await req("GET", `/api/campaigns/${id}`, null, O))).campaign;
  assert.equal(C.guests.find((g) => g.email === "ada.yes@guest.example").status, "yes", "the reply came back to the campaign");
  assert.equal(C.guestEvents[ev.id].id, P.eventId);
  // a nudge for people invited who haven't replied goes through the plan's reminder
  const n = await ok(await req("POST", `/api/campaigns/${id}/events/${ev.id}/remind`, {}, O)); assert.ok(n.ok);
  // the run of show: a default from the start time, then the team's own
  assert.ok(C.ros[ev.id].length >= 4);
  C = (await ok(await req("POST", `/api/campaigns/${id}/ros`, { event: ev.id, items: [{ at: "18:30", what: "Doors" }, { at: "18:00", what: "Team arrives" }] }, O))).campaign;
  assert.deepEqual(C.ros[ev.id].map((x) => x.what), ["Team arrives", "Doors"]);
  assert.equal((await req("POST", `/api/campaigns/${id}/ros`, { event: ev.id, items: [] }, S.viewer.c)).status, 403, "viewers read only");
});

test("the campaign's Invite and Run tabs: set up the guest list, the status board, a nudge, the run of show in local time", () => {
  const h = fs.readFileSync(new URL("../public/teams-campaigns.html", import.meta.url), "utf8");
  for (const x of ['id="mkPlan"', "Open the status board", 'id="nudge"', 'id="rosEd"', 'id="rosSend"', "const tzName = (tz)", "waitlist: \"Waitlist\""]) assert.ok(h.includes(x), x);
  assert.match(h, /\/api\/campaigns\/\$\{C\.id\}\/events\/\$\{evSel\}\/plan/); assert.match(h, /\/api\/campaigns\/\$\{C\.id\}\/ros/);
  assert.doesNotMatch(h, /—/, "no em dashes");
});
