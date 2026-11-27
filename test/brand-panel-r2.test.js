// The brand panel, round 2 (server/brandpanel2.js): one test or more for each item the panel asked for. The world is
// invented (test/brand-panel-seed.js), with a booking fee on so repeat-pair pricing shows.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { seedBrandPanel } from "./brand-panel-seed.js";
import { getDbUser, scopeStore } from "../server/workspaces.js";
import { idOf, keyFor } from "../server/people.js";
import { editBrief, briefLines, briefDefaults, cleanAnswer } from "../server/brandpanel.js";
import { pickReplacements, guestChangeNote, recoveryMoney, drillSummary, cleanOrgDefaults, inherited, domainOf, inviteHoldFor, abmState, tasksForOwner, withCustomFee, revisionsOf, cleanPrep,
  followUpSpeed, openPair, pairPost, pairNudgeDue, pairStats, TIERS, tierOf, tierNarrative, HYPE, cleanPrefs, groupsFor, prefAggregate, feedbackFor, editNextTime, nextTimeAgreed, cleanRule, evaluateRule,
  TAKEAWAY_PROMPT, liftRecs, FORMATS, formatOf, againPlan, keepList, repeatFeeBps, feeLine, followersCsv, crossoverShare, durability, BARS, cleanFounding, foundingRow } from "../server/brandpanel2.js";

let srv, S;
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "brand-panel-r2-secret-0123456789", ENCORE_SIGNUP_PER_HOUR: "1000", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_SMS: "1", ENCORE_INSIGHTS_CACHE_MS: "0", ENCORE_ADMIN_EMAILS: "ada@pl-admin.example", ENCORE_TEAM_FEE_BPS: "800" };
const J = { "content-type": "application/json" };
const req = (method, p, body, cookie) => fetch(srv.base + p, { method, headers: { ...J, ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
const get = (p, c) => req("GET", p, null, c), post = (p, b, c) => req("POST", p, b, c);
const ok = async (r) => { const t = await r.text(); assert.ok(r.ok, `${r.status} ${t.slice(0, 400)}`); return t.startsWith("{") ? JSON.parse(t) : t; };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const weekday = (n) => { for (let i = n; i < n + 10; i++) { const d = day(i), w = new Date(d + "T12:00:00Z").getUTCDay(); if (w >= 1 && w <= 5) return d; } };
const DAY = 864e5;
const R = (id) => srv.store.get("system/bbreq-" + id).data, EV = (id) => srv.store.get("system/bpev-" + id)?.data, CAMP = (id) => srv.store.get("system/camp-" + id).data;
const putEv = (id, f) => { const e = EV(id) || { kind: "bpev", reqId: id, brief: null, changes: [], hostSeats: [], survey: { tokens: {}, responses: {} }, connections: [], timeline: [] }; f(e); srv.store.set("system/bpev-" + id, e); };
const host = (h) => S.hosts.find((x) => x.handle === h);
async function signup(name, email, company) { const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name, email, password: "long-password-1", mode: company ? "work" : "friends", company, city: "New York" }) }); assert.ok(r.ok); return r.headers.get("set-cookie").split(";")[0]; }
async function book(handle, headcount, date, cookie, extra = {}) { const H = host(handle); return ok(await post("/api/bb/requests", { handle, pkg: H.pkgId, headcount, date, company: extra.company || "Fernwood Labs", ...extra }, cookie)); }
async function accept(id, handle, cookie) { await ok(await post(`/api/bb/requests/${id}/pay`, {}, cookie)); await ok(await post(`/api/bb/host/requests/${id}`, { action: "accept" }, host(handle).c)); }
const addFollower = (ws, email, name, via = "page") => scopeStore(srv.store, ws).set("followers/" + crypto.createHash("sha256").update(email).digest("hex").slice(0, 24), { email, name, via, tastes: [], at: Date.now() });
const inbox = async (c) => (await ok(await get("/api/me/inbox", c))).items;

before(async () => { Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer(); S = await seedBrandPanel(srv.base, srv.store); });
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

// ---------------------------------------------------------------------------------------------------------------
// 1. Morning-of cancellation recovery
test("1. replacements: same city, the group fits, open in the window, inside the price band, and each says what differs", () => {
  const base = { handle: "a", city: "New York", area: "Greenpoint", date: day(3), headcount: 12, perPersonCents: 10000, totalCents: 120000, moods: ["client"], maxGuests: 20 };
  const X = (h, o = {}) => ({ handle: h, pkg: "p", name: h, host: h, city: "New York", area: "Greenpoint", minGuests: 6, maxGuests: 20, perPersonCents: 10000, totalCents: 120000, dateState: "open", altDate: "", moods: ["client"], quality: 50, ...o });
  const P = pickReplacements([X("a"), X("b"), X("c", { dateState: "closed", altDate: day(5), totalCents: 132000, perPersonCents: 11000, area: "Bushwick" }), X("d", { city: "San Francisco" }), X("e", { maxGuests: 10 }), X("f", { perPersonCents: 20000 }), X("g", { dateState: "closed", altDate: day(12) }), X("h", { moods: ["handson"] })], base);
  assert.deepEqual(P.options.map((o) => o.handle).sort(), ["b", "c", "h"], "not the cancelled host, not another city, too small, out of band or out of the window");
  const c = P.options.find((o) => o.handle === "c"); assert.ok(c.differs.some((d) => /instead of/.test(d)) && c.differs.some((d) => /\$120 more/.test(d)) && c.differs.some((d) => /Bushwick/.test(d)));
  assert.match(P.options.find((o) => o.handle === "b").differs[0], /Nothing major/); assert.equal(P.thin, false);
  const thin = pickReplacements([X("b")], base); assert.equal(thin.thin, true); assert.match(thin.line, /Only one comparable host/);
  assert.match(pickReplacements([], base).line, /No comparable host is open/);
  const N = guestChangeNote({ company: "Fernwood Labs", oldName: "Supper club", newName: "Wine night", newHost: "Margo", date: day(3), from: "Maya" }); assert.match(N.subject, /^Change of plan, same evening/); assert.match(N.text, /^Change of plan, same evening\./); assert.ok(!/\u2014/.test(N.text));
  assert.equal(recoveryMoney({ payments: [{ state: "charged", cents: 30000 }] }, "credit").cents, 30000); assert.match(recoveryMoney({}, "refund").line, /Nothing was paid/);
  assert.equal(drillSummary([{ startedAt: 0, finishedAt: 90e3 }]).last, 1.5);
});

test("1. a host cancels close to the date: one owner hears, 3 comparable hosts, one-tap rebook keeps the brief, a drafted note, refund or credit", async () => {
  for (const h of ["corner-cellar", "wheel-and-kiln"]) { const S2 = scopeStore(srv.store, host(h).ws), st = S2.get("teambook/setup").data; st.packages = st.packages.map((p) => ({ ...p, leadDays: 1 })); S2.set("teambook/setup", st); } // two hosts take short notice
  const date = weekday(3), j = await book("long-table", 12, date, S.owner.c, { single: true, goal: "customer", brief: { goal: "customer", together: "roundtable", mix: { brand: 12, host: 0 }, plan: "Three tables, a question per course." } });
  await accept(j.id, "long-table", S.owner.c);
  await ok(await post(`/api/teams/events/${j.id}/owner`, { email: S.editor.email }, S.owner.c)); // Sam owns this one
  const before = (await inbox(S.owner.c)).length;
  await ok(await post(`/api/bb/requests/${j.id}/cancel`, {}, host("long-table").c));
  const ev = EV(j.id); assert.equal(ev.recovery.state, "open"); assert.equal(ev.recovery.close, true); assert.equal(ev.recovery.owner, S.editor.email);
  assert.ok((await inbox(S.editor.c)).some((n) => /comparable hosts/.test(n.text)), "the owner is alerted");
  assert.ok(!(await inbox(S.owner.c)).slice(0, (await inbox(S.owner.c)).length - before).some((n) => /comparable hosts/.test(n.text)), "only the one owner gets the recovery alert");
  const V = await ok(await get(`/api/teams/events/${j.id}/recovery`, S.owner.c));
  assert.ok(V.options.length >= 1 && V.options.length <= 3); assert.ok(V.options.every((o) => o.handle !== "long-table" && o.differs.length && o.priceLine));
  assert.equal(V.thin, V.options.length < 3); assert.ok(V.line); if (V.thin) assert.match(V.line, /comparable hosts? (is|are) open in that window|No comparable host/); assert.match(V.note.text, /^Change of plan/); assert.equal(V.money.choice, "refund"); assert.ok(V.money.cents > 0);
  const M = await ok(await post(`/api/teams/events/${j.id}/recovery/money`, { choice: "credit" }, S.owner.c)); assert.equal(M.money.choice, "credit");
  const x = V.options[0], RB = await ok(await post(`/api/teams/events/${j.id}/recovery/rebook`, { handle: x.handle, pkg: x.pkg }, S.owner.c));
  const nr = R(RB.id), nev = EV(RB.id); assert.equal(nr.handle, x.handle); assert.equal(nev.recoveryOf, j.id); assert.equal(nev.brief.together, "roundtable"); assert.equal(nev.brief.plan, "Three tables, a question per course.");
  assert.equal(nr.credit.cents, M.money.cents, "the credit carries over"); assert.equal(EV(j.id).recovery.state, "rebooked"); assert.ok(EV(j.id).recovery.minutes != null); assert.ok(RB.priceLine);
  assert.equal((await post(`/api/teams/events/${j.id}/recovery/rebook`, { handle: x.handle, pkg: x.pkg }, S.owner.c)).status, 409, "once");
  const msg = await ok(await post(`/api/teams/events/${j.id}/recovery/message`, {}, S.owner.c)); assert.equal(typeof msg.guests, "number");
  assert.equal((await get(`/api/teams/events/${j.id}/recovery`, S.juniper.c)).status, 404);
});

test("1. Run the drill: pilot mode only, nothing cancelled, the time to recover recorded", async () => {
  const id = S.bookings.b3, before = R(id).status;
  const st = await ok(await post(`/api/teams/events/${id}/drill`, { step: "start" }, S.owner.c)); assert.equal(st.drill, true); assert.ok(Array.isArray(st.options)); assert.ok(st.line);
  await ok(await post(`/api/teams/events/${id}/drill`, { step: "money", choice: "credit" }, S.owner.c));
  const fin = await ok(await post(`/api/teams/events/${id}/drill`, { step: "finish", handle: st.options[0]?.handle }, S.owner.c));
  assert.equal(fin.summary.runs, 1); assert.ok(fin.summary.last >= 0); assert.equal(fin.drill.money, "credit"); assert.equal(R(id).status, before, "the real booking is untouched");
  const more = await ok(await get(`/api/teams/events/${id}/more`, S.owner.c)); assert.equal(more.drills.runs, 1); assert.equal(more.pilot, true);
  const c7 = S.bookings.b7; assert.equal((await post(`/api/teams/events/${c7}/drill`, { step: "start" }, S.owner.c)).status, 409, "no pilot on that campaign");
});

// ---------------------------------------------------------------------------------------------------------------
// 2. Org-level settings
test("2. a second team at the same company books under the shared approval rule, brand rules and invoicing", async () => {
  assert.equal(domainOf("a@fernwood.example"), "fernwood.example"); assert.equal(domainOf("a@gmail.com"), "");
  const D = cleanOrgDefaults({ rules: { approval: "over", overCents: 100000, approvers: "maya@fernwood.example" } }); assert.deepEqual(D.rules.approvers, ["maya@fernwood.example"]);
  assert.equal(inherited({ name: "F", defaults: D }, {}).rulesFrom, "company"); assert.equal(inherited({ name: "F", defaults: D }, { rules: { approval: "off" } }).rulesFrom, "team");
  const org = await ok(await post("/api/teams/company", { name: "Fernwood Labs", defaults: { rules: { approval: "over", overCents: 100000, approvers: [S.owner.email] }, brand: { photos: "host", room: { staffCap: 1, competitors: ["Acme Rival"] } }, invoicing: { company: "Fernwood Labs Inc", po: "PO-77" } } }, S.owner.c));
  assert.equal(org.org.teams.length, 1); assert.ok(org.org.code);
  const G = await signup("Lee Moreno", "lee@fernwood.example", "Fernwood Growth");
  const look = await ok(await get("/api/teams/company", G)); assert.equal(look.suggest.name, "Fernwood Labs");
  const J2 = await ok(await post("/api/teams/company/join", { id: look.suggest.id }, G)); assert.equal(J2.org.teams.length, 2); assert.equal(J2.org.mine.rulesFrom, "company");
  assert.equal((await post("/api/teams/company/join", { id: look.suggest.id }, S.juniper.c)).status, 403, "another company's domain needs the code");
  const j = await book("long-table", 12, weekday(50), G, { company: "Fernwood Growth", goal: "customer" });
  assert.equal(j.status, "approval", "over $1,000 needs the company approver"); const r = R(j.id); assert.deepEqual(r.approval.approvers, [S.owner.email]);
  assert.equal(r.billing.po, "PO-77"); assert.equal(r.billing.company, "Fernwood Labs Inc"); const ev = EV(j.id); assert.equal(ev.brief.photos, "host"); assert.deepEqual(ev.brief.room.competitors, ["Acme Rival"]); assert.equal(ev.brief.room.staffCap, 1);
  const page = await get("/teams/company"); assert.equal(page.status, 200);
});

// ---------------------------------------------------------------------------------------------------------------
// 3. Approval handoff roles. 14. Room rules keep competitors out.
test("3 and 14. account dinners: marketer picks, account owners approve their customers, the host approves the mix, owners see their own follow-ups", async () => {
  const C1 = S.campaigns.C1, b3 = S.bookings.b3;
  await ok(await post(`/api/campaigns/${C1}/guests`, { event: b3, guests: [{ name: "Hal One", email: "hal1@halcyon.example", company: "Halcyon" }, { name: "Kes Two", email: "kes2@kestrel.example", company: "Kestrel" }, { name: "Ace Rival", email: "ace@acmerival.example", company: "Acme Rival" }, { name: "Plain Guest", email: "plain@other.example", company: "Otherco" }] }, S.owner.c));
  assert.equal((await post(`/api/campaigns/${C1}/abm`, { accounts: [{ account: "Halcyon", owner: "nobody@x.example" }] }, S.owner.c)).status, 400, "owners are on the team");
  const A = await ok(await post(`/api/campaigns/${C1}/abm`, { accounts: [{ account: "Halcyon", owner: S.editor.email }, { account: "Kestrel", owner: S.owner.email }], budget: 20000 }, S.owner.c));
  assert.equal(A.stage, "owners"); assert.equal(A.budgetCents, 2000000);
  await ok(await post(`/api/teams/events/${b3}/brief`, { room: { competitors: "Acme Rival", staffCap: 2, asGuest: true, noPitch: true } }, S.owner.c));
  let inv = await ok(await post(`/api/campaigns/${C1}/invites`, { event: b3 }, S.owner.c));
  const why = (n) => inv.held.find((h) => h.name === n)?.why || "";
  assert.match(why("Hal"), /Waiting on Sam/); assert.match(why("Kes"), /Waiting on Maya/); assert.match(why("Ace"), /room rules/); assert.equal(why("Plain"), "", "a plain guest goes out");
  const hal = CAMP(C1).guests.find((g) => g.email === "hal1@halcyon.example");
  assert.equal((await post(`/api/campaigns/${C1}/abm/approve`, { guests: [hal.id] }, S.owner.c)).status, 403, "Maya doesn't own Halcyon");
  await ok(await post(`/api/campaigns/${C1}/abm/approve`, { guests: [hal.id] }, S.editor.c));
  inv = await ok(await post(`/api/campaigns/${C1}/invites`, { event: b3 }, S.owner.c)); assert.match(why("Hal"), /host to approve the mix/);
  const hm = await ok(await get(`/api/bb/host/events/${b3}/more`, host("dice-and-dumplings").c)); assert.ok(hm.mix.proposed.some((m) => m.company === "Halcyon")); assert.ok(!JSON.stringify(hm.mix).includes("@"), "the host sees companies and counts, no emails");
  await ok(await post(`/api/bb/host/events/${b3}/mix`, { yes: true }, host("dice-and-dumplings").c));
  inv = await ok(await post(`/api/campaigns/${C1}/invites`, { event: b3 }, S.owner.c)); assert.equal(why("Hal"), ""); assert.ok(CAMP(C1).guests.find((g) => g.id === hal.id).invitedAt);
  assert.ok(why("Ace"), "the competitor still waits");
  const kes = CAMP(C1).guests.find((g) => g.email === "kes2@kestrel.example");
  await ok(await post(`/api/campaigns/${C1}/tasks`, { title: "Follow up with Hal", team: "sales", owner: S.editor.email, event: b3, guest: hal.id }, S.owner.c));
  { const c = CAMP(C1); c.tasks.find((t) => t.title === "Follow up with Hal").guest = hal.id; c.tasks.push({ id: "tk1", title: "Follow up with Kes", team: "sales", owner: S.owner.email, due: day(3), status: "open", result: "", event: b3, guest: kes.id, at: Date.now(), doneAt: 0 }); srv.store.set("system/camp-" + C1, c); }
  const sam = await ok(await get(`/api/campaigns/${C1}/abm`, S.editor.c)); assert.deepEqual(sam.myTasks.map((t) => t.title), ["Follow up with Hal"]); assert.ok(sam.myGuests.every((g) => g.company === "Halcyon"));
  assert.deepEqual(tasksForOwner(CAMP(C1), S.owner.email).map((t) => t.title), ["Follow up with Kes"]);
  assert.equal(inviteHoldFor({ abm: { accounts: [] } }, { company: "Acme Rival" }, { brief: { room: { competitors: ["Acme Rival Inc"] } } }).length > 0, true);
  assert.equal(abmState({ abm: { accounts: [] } }).stage, "accounts");
});

test("14. room rules are standard brief fields and show in the brief", () => {
  const b = briefDefaults("customer", 12); assert.equal(b.room.staffCap, 2); assert.equal(b.room.noPitch, true); assert.equal(b.room.asGuest, true);
  const E = editBrief(null, { goal: "customer", room: { staffCap: 1, competitors: ["Rival Co", "Rival Co", "Other"], asGuest: true, noPitch: true } }, { headcount: 12 });
  assert.deepEqual(E.brief.room.competitors, ["Rival Co", "Other"]); const L = briefLines(E.brief).find((l) => l.startsWith("Room rules"));
  assert.match(L, /Brand staff in the room: 1 at most/); assert.match(L, /Kept out: guests from Rival Co, Other/); assert.match(L, /as a guest, not a presenter/); assert.match(L, /No pitch/);
  const E2 = editBrief(E.brief, { room: { noPitch: false } }, { side: "host", headcount: 12 }); assert.equal(E2.changed, true); assert.equal(E2.brief.v, 2, "a room-rule change asks the other side again");
});

// ---------------------------------------------------------------------------------------------------------------
// 4. Transparent pricing on the approval page
test("4. the approval page: standard price, custom work and prep hours as separate lines; prep logged; unpaid revisions flagged", async () => {
  const j = await book("wheel-and-kiln", 10, weekday(45), S.owner.c, { goal: "workshop", single: true }), W = host("wheel-and-kiln");
  await ok(await post(`/api/bb/host/events/${j.id}/brief`, {}, W.c)); // the host agrees
  await ok(await post(`/api/teams/events/${j.id}/brief`, { plan: "Mugs, then glaze." }, S.owner.c)); await ok(await post(`/api/teams/events/${j.id}/brief`, { plan: "Bowls, then glaze." }, S.owner.c));
  let m = await ok(await get(`/api/teams/events/${j.id}/more`, S.owner.c)); assert.equal(m.pricing.revisions.flag, true); assert.match(m.pricing.revisions.line, /without a custom-work fee/);
  const total0 = R(j.id).price.totalCents;
  const p = await ok(await post(`/api/bb/host/events/${j.id}/prep`, { customFee: 150, customNote: "Glaze test tiles with their logo", prepHours: 5, log: { hours: 2, note: "Tiles" } }, W.c));
  assert.equal(p.prep.prepHours, 5); assert.equal(p.prep.logged[0].hours, 2); assert.equal(R(j.id).price.totalCents, total0 + 15000, "the custom fee is in the total"); assert.ok(R(j.id).price.lines.some((l) => l.k === "custom" && l.cents === 15000));
  m = await ok(await get(`/api/teams/events/${j.id}/more`, S.owner.c)); const L = m.pricing.lines;
  assert.deepEqual(L.map((l) => l.k), ["standard", "custom", "fee", "tax"]); assert.equal(L.reduce((a, l) => a + l.cents, 0), R(j.id).price.totalCents, "the lines add up to the total"); assert.equal(m.pricing.prepHours, 5); assert.equal(m.pricing.loggedHours, 2); assert.equal(m.pricing.revisions.flag, false, "a custom fee covers them");
  assert.equal(withCustomFee({ lines: [{ k: "people", cents: 100 }, { k: "fee", cents: 8 }], depositPct: 25, headcount: 1 }, 50).totalCents, 158);
  assert.equal(revisionsOf({ prep: { revisions: [{ paid: false }, { paid: false }] } }).flag, true); assert.equal(cleanPrep({ prepHours: 3.3 }).prepHours, 3.5);
  const b3 = S.bookings.b3; assert.equal((await post(`/api/bb/host/events/${b3}/prep`, { customFee: 300 }, host("dice-and-dumplings").c)).status, 409, "after the deposit it's a change request");
});

// ---------------------------------------------------------------------------------------------------------------
// 5. Follow-up speed
test("5. follow-up speed: target-account follow-ups done within 7 days, per account owner, customer dinners and brand seats only", () => {
  const ev = { id: "e1", goal: "customer", date: day(-20) }, other = { id: "e2", goal: "team", date: day(-20) }, d0 = Date.parse(day(-20) + "T12:00:00Z");
  const c = { targets: ["Larkspur Systems"], guests: [{ id: "g1", company: "Larkspur Systems" }, { id: "g2", company: "Larkspur" }, { id: "g3", company: "Larkspur Systems" }],
    tasks: [{ team: "sales", owner: "sam@x", status: "done", doneAt: d0 + 3 * DAY, event: "e1", guest: "g1" }, { team: "sales", owner: "sam@x", status: "done", doneAt: d0 + 12 * DAY, event: "e1", guest: "g3" }, { team: "sales", owner: "maya@x", status: "open", event: "e1", guest: "g1" },
      { team: "sales", owner: "sam@x", status: "done", doneAt: d0 + DAY, event: "e2", guest: "g1" }, { team: "sales", owner: "sam@x", status: "done", doneAt: d0 + DAY, event: "e1", guest: "s-host" }, { team: "sales", owner: "sam@x", status: "done", doneAt: d0 + DAY, event: "e1", guest: "g2" }] };
  const F = followUpSpeed(c, [ev, other], { names: { "sam@x": "Sam" } });
  const sam = F.rows.find((r) => r.owner === "sam@x"); assert.equal(sam.n, 1); assert.equal(sam.of, 2); assert.equal(sam.name, "Sam");
  assert.equal(F.rows.find((r) => r.owner === "maya@x").of, 1); assert.equal(F.total.text, "1 of 3"); assert.match(F.scope, /Host-sourced guests are left out/);
  const fresh = followUpSpeed({ ...c, tasks: [{ team: "sales", owner: "a", status: "open", event: "e3", guest: "g1" }] }, [{ id: "e3", goal: "customer", date: day(-2) }]); assert.equal(fresh.total.of, 0, "inside its 7 days, not counted yet");
});

// ---------------------------------------------------------------------------------------------------------------
// 6. Matched guests' next step
test("6. a mutual connection opens a light thread, a nudge at a week, and the report counts who met again", async () => {
  const id = S.bookings.b1, ev = EV(id), T = Object.entries(ev.survey.tokens).filter(([, x]) => x.side === "brand").map(([t]) => t), a = T[0], b = T[1];
  await ok(await post(`/api/survey/${a}`, { listed: true }, null)); await ok(await post(`/api/survey/${b}`, { listed: true }, null));
  putEv(id, (e) => { e.connections = e.connections.filter((c) => !([c.a, c.b].includes(a) && [c.a, c.b].includes(b))); e.pairs = []; });
  await ok(await post(`/api/survey/${a}/connect`, { to: b }, null)); assert.equal((EV(id).pairs || []).length, 0, "one yes isn't enough");
  const mu = await ok(await post(`/api/survey/${b}/connect`, { to: a, answer: true }, null)); assert.equal(mu.mutual, true); assert.equal(EV(id).pairs.length, 1);
  let A = await ok(await get(`/api/survey/${a}/pairs`)); assert.equal(A.pairs.length, 1); const pid = A.pairs[0].id;
  await ok(await post(`/api/survey/${a}/pairs/${pid}`, { text: "Coffee next week?" })); const B = await ok(await post(`/api/survey/${b}/pairs/${pid}`, { text: "Yes, Thursday." }));
  assert.equal(B.pairs[0].messages.length, 2); assert.equal(B.pairs[0].messages[1].mine, true);
  const other = T[2]; assert.equal((await post(`/api/survey/${other}/pairs/${pid}`, { text: "hi" })).status, 404, "only the pair");
  const n = await srv.app.locals.brandPanel2.runPairNudges(Date.now() + 8 * DAY); assert.ok(n >= 1); A = await ok(await get(`/api/survey/${a}/pairs`)); assert.ok(A.pairs[0].messages.some((m) => m.system && /two weeks/.test(m.text)));
  await ok(await post(`/api/survey/${a}/pairs/${pid}`, { met: true }));
  const M = await ok(await get(`/api/teams/events/${id}/more`, S.owner.c)); assert.equal(M.pairs.opened, 1); assert.equal(M.pairs.met.text, "1 of 1"); assert.equal(M.pairs.talked.n, 1);
  const p = openPair({}, "x", "y", 0); assert.equal(pairNudgeDue(p, 8 * DAY), true); assert.equal(pairNudgeDue(p, 15 * DAY), false); assert.equal(pairPost(p, "z", "hi").error, "Not your thread.");
  assert.equal(pairStats([]).met.text, "0 of 0");
});

// ---------------------------------------------------------------------------------------------------------------
// 7. Event tiers
test("7. tiers: a definition, the workflow depth, suggested team hours and a forwardable paragraph with denominators and no hype", async () => {
  assert.equal(tierOf({ events: 1, headcount: 12 }).tier, 1); assert.equal(tierOf({ events: 3 }).tier, 2); assert.equal(tierOf({ events: 1, headcount: 40 }).tier, 2); assert.equal(tierOf({ events: 2, cities: 2 }).tier, 3); assert.equal(tierOf({ events: 8 }).tier, 3);
  for (const t of Object.values(TIERS)) { assert.ok(t.definition && t.depth.length >= 4 && t.teamHours > 0); }
  assert.ok(TIERS[1].depth.length < TIERS[3].depth.length && TIERS[1].teamHours < TIERS[3].teamHours);
  const M = await ok(await get(`/api/campaigns/${S.campaigns.C1}/more`, S.owner.c)); assert.equal(M.tier.tier, 3, "New York and San Francisco");
  assert.ok(!HYPE.test(M.narrative), M.narrative); assert.match(M.narrative, / of /); assert.match(M.narrative, /Suggested team time for this tier is 60 hours/); assert.ok(!/\u2014/.test(M.narrative));
  assert.ok(!HYPE.test(tierNarrative({ company: "X", tier: TIERS[1], events: [] })));
});

// ---------------------------------------------------------------------------------------------------------------
// 8. RSVP preference question
test("8. the optional RSVP question: the host sees answers to shape small groups, the brand only aggregates past the floor", async () => {
  const C1 = S.campaigns.C1, b3 = S.bookings.b3, g = CAMP(C1).guests.find((x) => x.event === b3 && x.status === "invited" && x.token);
  const G0 = await ok(await get(`/api/cg/${C1}/r/${g.token}`)); assert.match(G0.prefs.part, /Which part/); assert.equal(G0.prefs.mine, null);
  await ok(await post(`/api/cg/${C1}/r/${g.token}`, { reply: "yes", part: "talk", intros: "yes" })); assert.equal(CAMP(C1).guests.find((x) => x.id === g.id).prefs.part, "talk");
  await ok(await post(`/api/cg/${C1}/r/${g.token}`, { part: "bogus" })); assert.equal(CAMP(C1).guests.find((x) => x.id === g.id).prefs.part, "talk", "unknown answers don't stick");
  const H = await ok(await get(`/api/bb/host/events/${b3}/more`, host("dice-and-dumplings").c)); assert.ok(H.groups.groups.some((x) => x.people.some((p) => p.first === g.name.split(" ")[0] && p.part === "The conversation")));
  const B = await ok(await get(`/api/teams/events/${b3}/more`, S.owner.c)); assert.equal(B.prefs.shown, false); assert.ok(!JSON.stringify(B.prefs).includes(g.name.split(" ")[0]), "no names for the brand");
  const many = Array.from({ length: 12 }, (_, i) => ({ name: "P" + i, event: "e" + (i % 3), prefs: { part: i < 8 ? "talk" : i < 10 ? "food" : "activity", intros: "yes" } }));
  const Ag = prefAggregate(many); assert.equal(Ag.shown, true); assert.equal(Ag.parts.find((p) => p.id === "talk").n, 8); assert.equal(Ag.parts.find((p) => p.id === "food").n, null, "under 3 is hidden");
  assert.equal(prefAggregate(many.slice(0, 9)).shown, false); assert.equal(prefAggregate(many.map((x) => ({ ...x, event: "e0" }))).shown, false, "3 events at least");
  assert.equal(cleanPrefs({}), null); assert.equal(groupsFor([{ name: "A B", prefs: { part: "talk", intros: "yes" } }]).groups.length, 1);
});

// ---------------------------------------------------------------------------------------------------------------
// 9. Feedback first to the host; 11. the open prompt
test("9 and 11. the host reads the comments first, the brand gets its customers' summary after, and two changes for next time carry over", async () => {
  const id = S.bookings.b1, ev = EV(id), t = Object.entries(ev.survey.tokens).find(([, x]) => x.side === "brand")[0];
  await ok(await post(`/api/survey/${t}`, { takeaway: "Two teams are solving the same queue problem; we're comparing notes." }));
  assert.equal(EV(id).survey.responses[t].takeaway, "Two teams are solving the same queue problem; we're comparing notes.");
  const recent = { survey: ev.survey, feedback: {} }; assert.equal(feedbackFor(recent, "brand", { date: day(-1) }).ready, false, "the brand waits"); assert.equal(feedbackFor(recent, "brand", { date: day(-1) }).quotes.length, 0);
  const H = await ok(await get(`/api/bb/host/events/${id}/more`, host("long-table").c)); assert.ok(H.feedback.comments.some((c) => /queue problem/.test(c.takeaway))); assert.ok(EV(id).feedback.hostSeenAt);
  assert.equal(feedbackFor({ ...recent, feedback: { hostSeenAt: Date.now() } }, "brand", { date: day(-1) }).ready, true, "opens once the host has read it");
  const B = await ok(await get(`/api/teams/events/${id}/more`, S.owner.c)); assert.equal(B.feedback.ready, true); assert.ok(!("comments" in B.feedback)); assert.match(B.feedback.respondents.text, /of/); assert.equal(B.prompt, TAKEAWAY_PROMPT);
  assert.equal(TAKEAWAY_PROMPT, "What did you take away?"); assert.equal(cleanAnswer({ takeaway: "x".repeat(900) }).takeaway.length, 600);
  await ok(await post(`/api/teams/events/${id}/brief`, { prompt: "Say our product is great" }, S.owner.c)); assert.equal((await ok(await get(`/api/survey/${t}/pairs`))).prompt, "What did you take away?", "a brand can't script the prompt");
  assert.match(fs.readFileSync(new URL("../public/teams-survey.html", import.meta.url), "utf8"), /What did you take away\?/);
  // two changes for next time
  assert.equal((await post(`/api/teams/events/${id}/next-time`, { items: ["Only one"] }, S.owner.c)).status, 400);
  await ok(await post(`/api/teams/events/${id}/next-time`, { items: ["Start 30 minutes earlier", "Seat sales at different tables"] }, S.owner.c));
  const N = await ok(await post(`/api/bb/host/events/${id}/next-time`, {}, host("long-table").c)); assert.equal(N.agreed, true);
  assert.equal(nextTimeAgreed(editNextTime(N.nextTime, { items: ["A", "B"] }, "brand", "m").next), false, "a new pair needs the other side again");
  const j = await book("long-table", 12, weekday(70), S.owner.c, { againOf: id, single: true }); assert.deepEqual(EV(j.id).lastTime.items, ["Start 30 minutes earlier", "Seat sales at different tables"]); assert.equal(EV(j.id).lastTime.agreed, true);
  const HM = await ok(await get(`/api/bb/host/events/${j.id}/more`, host("long-table").c)).catch(() => null); // not accepted yet: the host still sees it on the request
  assert.ok(HM === null || HM.lastTime);
});

// ---------------------------------------------------------------------------------------------------------------
// 10. The rebooking rule; 19. design-partner auto-rebook
test("10. the rebooking rule is set before invites go out and the report evaluates it", async () => {
  assert.equal(cleanRule({ metric: "targetsAttended", useful: "x" }).error, "Name the target accounts."); assert.equal(cleanRule({ metric: "meetings", atLeast: 2 }).error, "Say what a useful introduction means for you.");
  const E = { status: "done", targets: { attended: ["larkspur systems"] }, survey: { useful: { n: 4, of: 6 } }, meetings: 2, connections: { mutual: 1 } };
  assert.equal(evaluateRule(cleanRule({ metric: "targetsAttended", accounts: "Larkspur Systems, Tidewater", atLeast: 1, useful: "an intro to a buyer" }).rule, E).state, "met");
  assert.equal(evaluateRule(cleanRule({ metric: "meetings", atLeast: 3, useful: "a demo" }).rule, E).state, "missed"); assert.match(evaluateRule(cleanRule({ metric: "meetings", atLeast: 3, useful: "a demo" }).rule, E).line, /Not met: 2, against 3/);
  assert.equal(evaluateRule(cleanRule({ metric: "usefulPct", atLeast: 50, useful: "x" }).rule, E).state, "met"); assert.equal(evaluateRule(cleanRule({ metric: "usefulPct", atLeast: 50, useful: "x" }).rule, { ...E, survey: { useful: { n: 1, of: 2 } } }).state, "waiting", "5 answers first");
  assert.equal(evaluateRule(cleanRule({ metric: "meetings", atLeast: 1, useful: "x" }).rule, { ...E, status: "booked" }).state, "waiting");
  const j = await book("corner-cellar", 12, weekday(55), S.owner.c, { goal: "customer", single: true }); await accept(j.id, "corner-cellar", S.owner.c);
  const rr = await ok(await post(`/api/teams/events/${j.id}/rule`, { metric: "targetsAttended", accounts: ["Larkspur Systems"], atLeast: 1, useful: "A platform lead meets our solutions engineer" }, S.owner.c)); assert.match(rr.line, /^Book again if 1 or more named target accounts came/);
  const c = CAMP(R(j.id).campaignId); await ok(await post(`/api/campaigns/${c.id}/guests`, { event: j.id, guests: [{ name: "Ivy Lane", email: "ivy@lane.example", company: "Lane" }] }, S.owner.c)); await ok(await post(`/api/campaigns/${c.id}/invites`, { event: j.id }, S.owner.c));
  assert.equal((await post(`/api/teams/events/${j.id}/rule`, { metric: "meetings", atLeast: 9, useful: "x" }, S.owner.c)).status, 409, "fixed once invites are out");
  const more = await ok(await get(`/api/teams/events/${j.id}/more`, S.owner.c)); assert.equal(more.ruleResult.state, "waiting"); assert.equal(more.ruleLocked, true);
});

test("19. design-partner auto-rebook: pre-signed, it triggers when the brief's rule is met", async () => {
  const id = S.bookings.b1; assert.equal((await post(`/api/teams/events/${id}/auto-rebook`, { headcount: 14 }, S.owner.c)).status, 409, "needs a rule");
  putEv(id, (e) => { e.rule = cleanRule({ metric: "targetsAttended", accounts: ["Larkspur Systems", "Northpine Data"], atLeast: 1, useful: "A platform lead meets our engineers" }).rule; });
  const before = srv.store.listPrefix("system", "bbreq-").length;
  const a = await ok(await post(`/api/teams/events/${id}/auto-rebook`, { headcount: 14 }, S.owner.c)); assert.equal(a.autoRebook.headcount, 14); assert.equal(a.autoRebook.triggered, "");
  const M = await ok(await get(`/api/teams/events/${id}/more`, S.owner.c)); assert.equal(M.ruleResult.state, "met", M.ruleResult.line);
  const trig = EV(id).autoRebook.triggered; assert.ok(trig, "the second booking went out"); assert.equal(srv.store.listPrefix("system", "bbreq-").length, before + 1);
  const r2 = R(trig); assert.equal(r2.handle, "long-table"); assert.equal(r2.headcount, 14); assert.equal(EV(trig).autoFrom, id); assert.equal(EV(trig).again.from, id);
  await ok(await get(`/api/teams/events/${id}/more`, S.owner.c)); assert.equal(srv.store.listPrefix("system", "bbreq-").length, before + 1, "only once");
});

// ---------------------------------------------------------------------------------------------------------------
// 12. Lift vs a comparison
test("12. recommendations as lift against a comparison, with both denominators and each outcome's source", async () => {
  const cell = (format, events, respondents, useful, meetings = 0) => ({ format, events, people: respondents, respondents, useful, meetings, attended: respondents });
  const L = liftRecs([cell("roundtable", 14, 120, 60, 14), cell("standard", 9, 80, 20, 4), cell("class", 2, 20, 10)], { audience: "engineering leaders", city: "NYC" });
  const u = L.items.find((x) => x.metric === "useful"); assert.equal(u.text, "For engineering leaders in NYC, roundtables: 2.0× the useful-connection rate of standard dinners (14 events vs 9 events)"); assert.equal(u.source, "Guest survey"); assert.equal(u.a.text, "60 of 120"); assert.equal(u.b.text, "20 of 80");
  const m = L.items.find((x) => x.metric === "meetings"); assert.equal(m.source, "CRM record"); assert.match(m.text, /meetings per event/);
  assert.ok(!L.items.some((x) => x.format === "class"), "under the floor: 2 events");
  assert.equal(liftRecs([cell("roundtable", 14, 120, 60), cell("standard", 2, 80, 20)]).items.length, 0, "the comparison needs the floor too");
  const H = await ok(await get("/api/teams/recommendations/lift?city=New%20York", S.juniper.c)); assert.ok(H.items.length >= 1); assert.ok(H.items.every((x) => x.events >= 3 && x.againstEvents >= 3 && /events vs \d+ events/.test(x.text) && x.source));
  assert.equal((await get("/api/teams/recommendations/lift")).status, 401);
});

// ---------------------------------------------------------------------------------------------------------------
// 13. Format library
test("13. the format library: 10 to 15 formats, each with a run of show, size, what guests do and room rules; the host proposes their version", async () => {
  assert.ok(FORMATS.length >= 10 && FORMATS.length <= 15); for (const f of FORMATS) { assert.ok(f.ros.length >= 3 && f.size[0] < f.size[1] && f.what && f.rules.length && f.occasion && f.together); assert.ok(!/\u2014/.test(JSON.stringify(f))); }
  for (const n of ["A cooking competition instead of a class", "Craft night with an expert", "Roundtable dinner", "Walk and talk"]) assert.ok(FORMATS.some((f) => f.name === n), n);
  const all = await ok(await get("/api/teams/formats")); assert.equal(all.formats.length, FORMATS.length); const cust = await ok(await get("/api/teams/formats?goal=customer")); assert.ok(cust.formats.every((f) => f.occasion === "customer"));
  assert.equal((await get("/teams/formats")).status, 200);
  const b4 = S.bookings.b4; const p = await ok(await post(`/api/teams/events/${b4}/format`, { id: "craft-expert" }, S.owner.c)); assert.equal(p.format.id, "craft-expert"); assert.equal(EV(b4).brief.together, formatOf("craft-expert").together);
  assert.equal((await post(`/api/teams/events/${b4}/format`, { agree: true }, S.owner.c)).status, 409);
  const hv = await ok(await post(`/api/bb/host/events/${b4}/format`, { plan: "Slab plates with a glaze bar", ros: [{ at: "18:00", what: "Arrive" }, { at: "18:15", what: "Slab plates" }] }, host("hayes-clay").c)); assert.equal(hv.format.hostVersion.ros.length, 2);
  const ag = await ok(await post(`/api/teams/events/${b4}/format`, { agree: true }, S.owner.c)); assert.ok(ag.format.agreedAt);
});

// ---------------------------------------------------------------------------------------------------------------
// 15. Book again pulls in the guest layer; 16. repeat-pair pricing
test("15. Book again holds seats for returning guests, seats matched pairs together, sends the host's invite to followers, and says what you keep", async () => {
  const id = S.bookings.b2, ev = EV(id), plan = againPlan(ev, CAMP(S.campaigns.C1).guests.filter((g) => g.event === id));
  assert.ok(plan.held.length >= 1); assert.ok(plan.held.every((h) => h.first !== undefined));
  const K = keepList(plan, { repeat: true, firstFeeCents: 1000, thisFeeCents: 500 }); assert.deepEqual(K.map((k) => k.k), ["returning", "pairs", "protection", "replacement", "report", "fee"]); assert.match(K.find((k) => k.k === "replacement").line, /^If your host can't make it, we find a replacement or refund you\.$/);
  const P = await ok(await get(`/api/teams/again/${id}`, S.owner.c)); assert.equal(P.held, plan.held.length); assert.ok(P.keep.find((k) => k.k === "returning").line.includes("held"));
  const j = await book("mission-table", 18, weekday(60), S.owner.c, { againOf: id, single: true, city: "San Francisco" }); await accept(j.id, "mission-table", S.owner.c);
  const nev = EV(j.id); assert.equal(nev.again.held.length, plan.held.length); assert.equal(nev.again.followers, true);
  const H = await ok(await get(`/api/bb/host/events/${j.id}/more`, host("mission-table").c)); assert.equal(H.again.held, plan.held.length); assert.equal(H.again.followers, true);
  const fi = await ok(await post(`/api/bb/host/events/${j.id}/followers-invite`, {}, host("mission-table").c)); assert.equal(typeof fi.followers, "number"); assert.equal((await post(`/api/bb/host/events/${j.id}/followers-invite`, {}, host("mission-table").c)).status, 409, "once");
  const B = await ok(await get(`/api/teams/events/${j.id}/more`, S.owner.c)); assert.equal(B.again.held, plan.held.length);
  await ok(await post("/api/teams/signal", { what: "book-again", ref: id }, S.owner.c));
});

test("16. repeat-pair pricing: half the platform fee on repeat bookings between the same brand and host, configurable, shown to both sides", async () => {
  assert.equal(repeatFeeBps(800, true, 50), 400); assert.equal(repeatFeeBps(800, false, 50), 800); assert.equal(repeatFeeBps(800, true, 25), 200);
  assert.match(feeLine({ repeat: true, firstCents: 1000, thisCents: 500 }).line, /half the \$10 a first booking pays/); assert.match(feeLine({ repeat: false, firstCents: 1000 }).line, /fee on the next booking is half/); assert.ok(!/%/.test(feeLine({ repeat: true, firstCents: 1000, thisCents: 500 }).line), "never a percentage");
  const Jw = getDbUser("ola@juniper.example").ws, L = srv.store.listPrefix("system", "bbreq-").map((d) => d.data).filter((r) => r.brandWs === Jw && r.handle === "long-table").sort((a, b) => a.createdAt - b.createdAt);
  assert.ok(L.length >= 2); assert.equal(L[0].price.feeCents, Math.round(L[0].price.subtotalCents * 0.08)); assert.equal(L[1].price.feeCents, Math.round(L[1].price.subtotalCents * 0.04), "the repeat pays half");
  const B = await ok(await get(`/api/teams/events/${L[1].id}/more`, S.juniper.c)); assert.equal(B.fee.repeat, true); assert.match(B.fee.line, /half/);
  const H = await ok(await get(`/api/bb/host/events/${L[1].id}/more`, host("long-table").c)); assert.equal(H.fee.repeat, true);
  const q = await ok(await get(`/api/bb/price/long-table/${host("long-table").pkgId}?people=12`, S.juniper.c)), q0 = await ok(await get(`/api/bb/price/long-table/${host("long-table").pkgId}?people=12`));
  assert.equal(q.price.feeCents * 2, q0.price.feeCents, "the price a repeat brand sees before booking");
  process.env.ENCORE_REPEAT_FEE_PCT = "100"; const q2 = await ok(await get(`/api/bb/price/long-table/${host("long-table").pkgId}?people=12`, S.juniper.c)); delete process.env.ENCORE_REPEAT_FEE_PCT; assert.equal(q2.price.feeCents, q0.price.feeCents, "configurable");
});

// ---------------------------------------------------------------------------------------------------------------
// 17. Followers portable; cross-host discovery
test("17. followers export to CSV on the host's consent basis, cross-host discovery is opt in, and crossover follows are tracked", async () => {
  const csv = followersCsv([{ name: "=HYPERLINK(1)", email: "a@x.example", at: Date.now(), via: "page" }, { name: "B", email: "b@x.example", via: "crossover" }, { name: "No email", email: "" }]);
  const rows = csv.trim().split("\r\n"); assert.equal(rows.length, 3); assert.match(rows[0], /Consent basis/); assert.match(rows[1], /^"'=HYPERLINK/); assert.match(rows[2], /Met you through another host's event/);
  assert.equal(crossoverShare([{ via: "crossover", at: 5 }, { via: "page", at: 5 }, { via: "page", at: 1 }], { since: 2 }).text, "1 of 2");
  const D = host("dice-and-dumplings"); addFollower(D.ws, "fan1@fans.example", "Fan One"); addFollower(D.ws, "gone@fans.example", "Gone");
  scopeStore(srv.store, D.ws).set("contactsoff/" + idOf(keyFor("gone@fans.example", "")), { at: Date.now() });
  const out = await get("/api/bb/host/followers.csv", D.c); assert.equal(out.status, 200); assert.match(out.headers.get("content-type"), /text\/csv/); const text = await out.text();
  assert.match(text.split("\r\n")[0], /^"Name","Email"/); assert.match(text, /fan1@fans\.example/); assert.ok(!text.includes("gone@fans.example"), "someone who asked to be forgotten stays out"); assert.match(text, /Followed you on Pottery Lab/);
  assert.equal((await get("/api/bb/host/followers.csv", S.owner.c)).status, 409, "a brand without a host page has no followers to export");
  // opt in on another similar host's survey (corner-cellar's Juniper events), then dice-and-dumplings invites them
  const Jw = getDbUser("ola@juniper.example").ws, cc = srv.store.listPrefix("system", "bbreq-").map((d) => d.data).find((r) => r.brandWs === Jw && r.handle === "corner-cellar");
  putEv(cc.id, (e) => { for (const [t, a] of Object.entries(e.survey.responses)) { a.similarOk = true; a.useful = true; } });
  const d0 = await ok(await get("/api/bb/host/discovery", D.c)); assert.ok(d0.pool >= 1); assert.match(d0.basis, /Only guests who ticked/);
  putEv(cc.id, (e) => { for (const a of Object.values(e.survey.responses)) a.similarOk = false; }); assert.equal((await ok(await get("/api/bb/host/discovery", D.c))).pool, 0, "no opt in, no invite");
  putEv(cc.id, (e) => { for (const a of Object.values(e.survey.responses)) a.similarOk = true; });
  const inv = await ok(await post("/api/bb/host/discovery/invite", { note: "Game nights every other Friday." }, D.c)); assert.ok(inv.invited >= 1);
  const xd = srv.store.listPrefix("system", "bpxd-").map((d) => d.data).find((x) => x.hostWs === D.ws), em = xd.emails[0], e = crypto.createHmac("sha256", xd.id).update(em).digest("hex").slice(0, 16);
  assert.equal((await post(`/api/xo/${xd.id}/follow`, { e: "bad" })).status, 403); await ok(await post(`/api/xo/${xd.id}/follow`, { e, name: "Crossed" }));
  const d1 = await ok(await get("/api/bb/host/discovery", D.c)); assert.equal(d1.followedBack, 1); assert.ok(d1.share.n >= 1, "new followers who first met them at another host's event");
  assert.equal((await get(`/xo/${xd.id}`)).status, 200); assert.equal((await ok(await get(`/api/xo/${xd.id}`))).handle, "dice-and-dumplings");
  assert.equal(cleanAnswer({ similarOk: true }).similarOk, true); assert.equal(cleanAnswer({}).similarOk, false, "off until ticked");
});

// ---------------------------------------------------------------------------------------------------------------
// 18. Durability metrics
test("18. durability: bars by occasion and launch cohort, design partners apart, and every metric with its bar, value, denominator and pass or fail", async () => {
  const mk = (id, brandWs, hostWs, date, goal) => ({ id, brandWs, hostWs, date, status: "booked", createdAt: Date.parse(date), goal });
  const reqs = [mk("a1", "B1", "H1", day(-200), "customer"), mk("a2", "B1", "H1", day(-150), "customer"), mk("b1", "B2", "H1", day(-200), "customer"), mk("c1", "B3", "H2", day(-200), "customer"), mk("c2", "B3", "H3", day(-180), "customer"), mk("d1", "DP", "H2", day(-200), "customer"), mk("d2", "DP", "H2", day(-190), "customer"), mk("t1", "B4", "H1", day(-100), "team")];
  const evs = { a1: { brief: { goal: "customer" }, attendedEmails: ["x@a", "y@a", "z@a"] }, a2: { brief: { goal: "customer" }, attendedEmails: ["x@a", "q@a"] }, b1: { brief: { goal: "customer" } }, c1: { brief: { goal: "customer" } }, c2: { brief: { goal: "customer" } }, d1: { brief: { goal: "customer" } }, d2: { brief: { goal: "customer" } }, t1: { brief: { goal: "team" } } };
  const attendance = [{ email: "x@a", hostWs: "H1", date: day(-200) }, { email: "x@a", hostWs: "H2", date: day(-150) }, { email: "y@a", hostWs: "H1", date: day(-200) }];
  const D = durability(reqs, { evOf: (id) => evs[id], attendance, signals: { B4: [{ what: "book-again", at: Date.now() - 90 * DAY }] }, offPlatform: { H1: 1 }, designPartners: new Set(["DP"]) });
  const cust = D.occasions.find((x) => x.key === "customer90"); assert.equal(cust.of, 3, "design partners apart"); assert.equal(cust.n, 2); assert.equal(cust.bar, 40); assert.equal(cust.pass, true); assert.equal(cust.text, "2 of 3");
  assert.equal(D.partners.find((x) => x.key === "customer90").text, "1 of 1"); assert.equal(D.partnerBrands, 1);
  assert.equal(D.occasions.find((x) => x.key === "teamLeading60").n, 1); assert.equal(D.occasions.find((x) => x.key === "team365").pass, null, "too early to call: the first team event was 100 days ago");
  const more = Object.fromEntries(D.more.map((x) => [x.key, x])); assert.equal(more.secondSeats.text, "1 of 2"); assert.equal(more.secondSeats.pass, true); assert.equal(more.differentHost.text, "1 of 3"); assert.equal(more.multiHost90.text, "1 of 2"); assert.equal(more.onPlatform.text, "2 of 3");
  assert.ok(more.firstCohort120.of >= 1); assert.ok(D.cohorts.length >= 1 && D.cohorts.every((c) => c.cohort && c.brands >= 1)); assert.equal(D.cohorts.reduce((a, c) => a + c.partners, 0), 1);
  for (const m of [...D.occasions, ...D.more]) { assert.ok("bar" in m && "value" in m && "of" in m && "pass" in m); }
  assert.equal(BARS.multiHost90, 15); assert.equal(BARS.firstCohort120, 60);
  const admin = await signup("Ada Admin", "ada@pl-admin.example"); const A = await ok(await get("/api/admin/brand-durability", admin)); assert.equal(A.occasions.length, 4); assert.equal(A.more.length, 5); assert.ok(A.cohorts.length >= 1);
  assert.equal((await get("/api/admin/brand-durability", S.owner.c)).status, 404); S.admin = admin;
});

// ---------------------------------------------------------------------------------------------------------------
// 19. Pre-launch evidence tools
test("19. founding hosts: signed dates, a paid pilot flag, earnings per hour against their own events, follower seats, and the crossover test", async () => {
  const LT = host("long-table"), WK = host("wheel-and-kiln"), admin = S.admin || await signup("Ada Admin", "ada@pl-admin.example");
  assert.equal((await get("/founding-hosts")).status, 200); assert.equal((await get("/admin/founding-hosts", LT.c)).status, 404);
  const F = await ok(await post("/api/bb/host/founding", { dates: [day(30), day(60), "nope"], publicEarnings: 1800, publicHours: 12, sendNext: "yes", offPlatform: 1 }, LT.c)); assert.deepEqual(F.founding.dates, [day(30), day(60)]); assert.ok(F.founding.signedAt); assert.equal(F.founding.publicEarningsCents, 180000);
  for (const [ws, flag] of [[LT.ws, "foundingHost"], [WK.ws, "foundingHost"], [LT.ws, "paidPilot"], [getDbUser("ola@juniper.example").ws, "designPartner"]]) await ok(await post("/api/admin/brand-flags", { ws, flag }, admin));
  const A = await ok(await get("/api/admin/founding", admin)), row = A.hosts.find((h) => h.handle === "long-table"); assert.equal(row.paidPilot, true); assert.equal(row.sendNext, "yes"); assert.equal(row.publicPerHourCents, 15000); assert.ok(row.teamPerHourCents > 0); assert.ok(row.followerSeats.text);
  assert.ok(A.brands.find((b) => b.company === "Juniper Health").designPartner);
  assert.equal(foundingRow({ F: cleanFounding({ publicEarnings: 100, publicHours: 2 }), teamNetCents: 20000, teamHours: 2 }).ratio, 2);
  // the crossover test: long-table invites its followers to wheel-and-kiln
  assert.equal((await post("/api/bb/host/crossover-test", { to: "dice-and-dumplings" }, LT.c)).status, 403, "between founding hosts");
  addFollower(LT.ws, "regular1@fans.example", "Reg One"); addFollower(LT.ws, "regular2@fans.example", "Reg Two");
  const before = srv.store.listPrefix("system", "bpxo-").length; const X = await ok(await post("/api/bb/host/crossover-test", { to: "wheel-and-kiln" }, LT.c)); assert.ok(X.invited >= 1); assert.equal(srv.store.listPrefix("system", "bpxo-").length, before + 1);
  const xo = srv.store.listPrefix("system", "bpxo-").map((d) => d.data).find((x) => x.id === X.id); addFollower(WK.ws, "regular1@fans.example", "Reg One", "page");
  const A2 = await ok(await get("/api/admin/founding", admin)); const T = A2.tests.find((x) => x.id === X.id); assert.ok(T); assert.equal(T.of, xo.emails.length); assert.equal(T.n, 1, "one regular crossed over");
});
