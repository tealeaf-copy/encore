// Campaigns (server/campaigns.js): budget math, roles and permissions, the spend approval on top of the brandbook
// rule, guest lists with consent, the CRM export (consent only, no feedback), rollups, the guest's own link and the
// report. The world is invented (test/brand-intel-seed.js).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { seedBrandIntel } from "./brand-intel-seed.js";
import { budgetOf, overBudget, campaignRole, can, rollup, exportCsv, parseCsv, cleanGuest, themesOf, reportHtml } from "../server/campaigns.js";

let srv, S;
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "campaigns-secret-0123456789", ENCORE_SIGNUP_PER_HOUR: "1000", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_SMS: "1", ENCORE_INSIGHTS_CACHE_MS: "0" };
const J = { "content-type": "application/json" };
const req = (method, p, body, cookie) => fetch(srv.base + p, { method, headers: { ...J, ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
const get = (p, c) => req("GET", p, null, c), post = (p, b, c) => req("POST", p, b, c), patch = (p, b, c) => req("PATCH", p, b, c);
const ok = async (r) => { const t = await r.text(); assert.ok(r.ok, `${r.status} ${t}`); return JSON.parse(t); };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const weekday = (n) => { for (let i = n; i < n + 10; i++) { const d = day(i), w = new Date(d + "T12:00:00Z").getUTCDay(); if (w >= 1 && w <= 5) return d; } };
before(async () => { Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer(); S = await seedBrandIntel(srv.base, srv.store); });
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

const R = (id, status, total, paid = 0, extra = {}) => ({ id, status, pkgName: id, price: { totalCents: total }, payments: paid ? [{ state: "charged", cents: paid }] : [], date: day(10), ...extra });

test("budget: committed, spent, pending and remaining add up; cancelled money kept by the host still counts", () => {
  const c = { budgetCents: 1000000, costs: [{ id: "x", label: "Notebooks", cents: 50000, paid: true }, { id: "y", label: "Photos", cents: 30000, paid: false }] };
  const L = [R("a", "booked", 300000, 75000), R("b", "accepted", 200000), R("c", "requested", 150000), R("d", "approval", 100000), R("e", "cancelled", 400000, 100000, { refund: { cents: 60000 } }), R("f", "declined", 500000)];
  const B = budgetOf(c, L);
  assert.equal(B.committedCents, 300000 + 200000 + 40000 + 50000 + 30000, "booked + accepted + what the host kept + other costs");
  assert.equal(B.spentCents, 75000 + 40000 + 50000, "charged, less refunds, plus paid costs");
  assert.equal(B.pendingCents, 250000, "requested and waiting on approval");
  assert.equal(B.remainingCents, 1000000 - B.committedCents); assert.equal(B.afterPendingCents, B.remainingCents - 250000);
  assert.equal(B.usedPct, 62); assert.equal(B.over, false);
  // a past booked event is done, and still committed
  assert.equal(budgetOf({ budgetCents: 1 }, [R("g", "booked", 5000, 0, { date: day(-3) })]).committedCents, 5000);
  // over budget: committed + pending + the new one
  assert.equal(overBudget(c, L, 100000), null);
  assert.match(overBudget(c, L, 200000).rule, /^Over the campaign budget by \$700$/);
  assert.equal(overBudget({ budgetCents: 0 }, L, 1e9), null, "no budget, no budget rule");
  assert.equal(budgetOf({ budgetCents: 100 }, [R("h", "booked", 500)]).over, true);
});

test("roles: owner, editor, viewer, and nobody outside the team", () => {
  const c = { ws: "w1", ownerEmail: "o@x.example", team: { "v@x.example": "viewer", "e@x.example": "editor" }, memberRole: "viewer" };
  assert.equal(campaignRole(c, { email: "o@x.example", ws: "w1" }), "owner");
  assert.equal(campaignRole(c, { email: "boss@x.example", ws: "w1", wsOwner: true }), "owner", "the workspace owner owns every campaign");
  assert.equal(campaignRole(c, { email: "e@x.example", ws: "w1" }), "editor");
  assert.equal(campaignRole(c, { email: "new@x.example", ws: "w1" }), "viewer", "everyone else gets the campaign's default");
  assert.equal(campaignRole(c, { email: "o@x.example", ws: "w2" }), null, "another workspace sees nothing");
  assert.ok(can("viewer", "view") && !can("viewer", "plan") && !can("viewer", "book") && !can("viewer", "export") && !can("viewer", "checkin"));
  assert.ok(can("editor", "book") && can("editor", "guests") && can("editor", "export") && !can("editor", "roles") && !can("editor", "delete") && !can("editor", "approve"));
  assert.ok(can("owner", "roles") && can("owner", "delete") && can("owner", "approve"));
});

test("permissions over HTTP: viewers read only, editors can't change roles, other brands get a 404", async () => {
  const id = S.campaigns.C1, V = S.viewer.c, E = S.editor.c, O = S.owner.c;
  const v = await ok(await get(`/api/campaigns/${id}`, V)); assert.equal(v.campaign.role, "viewer"); assert.equal(v.campaign.can.plan, false);
  assert.equal((await patch(`/api/campaigns/${id}`, { title: "Mine now" }, V)).status, 403);
  assert.equal((await post(`/api/campaigns/${id}/guests`, { name: "Ana", email: "ana@a.example" }, V)).status, 403);
  assert.equal((await get(`/api/campaigns/${id}/export.csv`, V)).status, 403, "viewers can't export");
  assert.equal((await post(`/api/campaigns/${id}/costs`, { label: "Cake", amount: 50 }, V)).status, 403);
  const g = v.campaign.guests.find((x) => x.event); assert.equal((await patch(`/api/campaigns/${id}/guests/${g.id}`, { checkedIn: true }, V)).status, 403, "viewers can't check people in");
  assert.equal((await patch(`/api/campaigns/${id}`, { goal: "Sharper goal." }, E)).status, 200, "editors plan");
  assert.equal((await post(`/api/campaigns/${id}/team`, { email: S.viewer.email, role: "editor" }, E)).status, 403, "only owners change roles");
  assert.equal((await patch(`/api/campaigns/${id}`, { memberRole: "editor" }, E)).status, 403);
  assert.equal((await req("DELETE", `/api/campaigns/${id}`, null, E)).status, 403);
  // an outsider brand, and a host
  const other = (await post("/api/signup", { name: "Rui Tan", email: "rui@otherbrand.example", password: "long-password-1", mode: "work", company: "Other Brand" })).headers.get("set-cookie").split(";")[0];
  assert.equal((await get(`/api/campaigns/${id}`, other)).status, 404); assert.equal((await get(`/teams/campaigns/${id}/report`, other)).status, 404);
  assert.equal((await get("/api/campaigns", S.hosts[0].c)).status, 403);
  // owners change roles; the role sticks
  await ok(await post(`/api/campaigns/${id}/team`, { email: S.viewer.email, role: "editor" }, O));
  assert.equal((await ok(await get(`/api/campaigns/${id}`, V))).campaign.role, "editor");
  await ok(await post(`/api/campaigns/${id}/team`, { email: S.viewer.email, role: "viewer" }, O));
  assert.equal((await post(`/api/campaigns/${id}/team`, { email: "stranger@x.example", role: "editor" }, O)).status, 400, "only people on the team");
});

test("spend: a booking past the campaign budget waits for an owner's OK, through the existing request to book", async () => {
  const c = await ok(await post("/api/campaigns", { title: "Tight one", budget: 1500, cities: ["New York"] }, S.owner.c)); const id = c.id;
  await ok(await post(`/api/campaigns/${id}/team`, { email: S.viewer.email, role: "viewer" }, S.owner.c));
  const H = S.hosts.find((h) => h.handle === "wheel-and-kiln");
  // a viewer can't book for the campaign at all
  const rv = await post("/api/bb/requests", { handle: H.handle, pkg: H.pkgId, headcount: 8, date: weekday(30), campaign: id }, S.viewer.c); assert.equal(rv.status, 403);
  // an editor, inside the budget: goes straight to the host (no team rule), and joins the campaign
  const r1 = await ok(await post("/api/bb/requests", { handle: H.handle, pkg: H.pkgId, headcount: 8, date: weekday(30), campaign: id }, S.editor.c)); assert.equal(r1.status, "requested");
  let C = (await ok(await get(`/api/campaigns/${id}`, S.owner.c))).campaign; assert.deepEqual(C.bookings.map((b) => b.id), [r1.id]); assert.equal(C.budget.pendingCents, 85000);
  // the next one goes past $1,500: it waits on the campaign's owner
  const r2 = await ok(await post("/api/bb/requests", { handle: H.handle, pkg: H.pkgId, headcount: 10, date: weekday(34), campaign: id }, S.editor.c));
  assert.equal(r2.status, "approval"); assert.match(r2.request.approval.rule, /Over the campaign budget by \$200/); assert.deepEqual(r2.request.approval.approvers, [S.owner.email]);
  assert.equal((await post(`/api/bb/requests/${r2.id}/approve`, { ok: true }, S.editor.c)).status, 403, "an editor can't approve it");
  const ap = await ok(await post(`/api/bb/requests/${r2.id}/approve`, { ok: true }, S.owner.c)); assert.equal(ap.request.status, "requested");
  // other costs past the budget: only an owner can add them
  assert.equal((await post(`/api/campaigns/${id}/costs`, { label: "Photographer", amount: 900 }, S.editor.c)).status, 403);
  await ok(await post(`/api/campaigns/${id}/costs`, { label: "Photographer", amount: 900 }, S.owner.c));
  C = (await ok(await get(`/api/campaigns/${id}`, S.owner.c))).campaign; assert.equal(C.budget.over, false); assert.ok(C.budget.afterPendingCents < 0);
  // the team's own rule still applies on top: "always" sends even an in-budget request for approval
  await ok(await post("/api/bb/brand/rules", { approval: "always", approvers: S.owner.email }, S.owner.c));
  const c2 = await ok(await post("/api/campaigns", { title: "Roomy one", budget: 50000 }, S.owner.c));
  const r3 = await ok(await post("/api/bb/requests", { handle: H.handle, pkg: H.pkgId, headcount: 8, date: weekday(40), campaign: c2.id }, S.editor.c)); assert.equal(r3.status, "approval"); assert.equal(r3.request.approval.rule, "Every booking");
  await ok(await post("/api/bb/brand/rules", { approval: "off" }, S.owner.c));
});

test("CSV: import reads headers and consent; the CRM export has only people who agreed, and none of their feedback", async () => {
  const rows = parseCsv('First Name,Last Name,Work Email,Company,Job Title,Opted In\r\nJo,Park,jo@lark.example,"Lark, Inc.",Staff engineer,yes\nSam,Lee,sam@lark.example,Lark,EM,no\n\n"=cmd",X,bad,=SUM(A1),,\n');
  assert.equal(rows.length, 3); assert.deepEqual(rows[0], { name: "Jo Park", email: "jo@lark.example", company: "Lark, Inc.", title: "Staff engineer", consent: "yes" });
  assert.equal(cleanGuest(rows[0], { source: "csv" }).consent.share, true); assert.equal(cleanGuest(rows[1], { source: "csv" }).consent.share, false); assert.equal(cleanGuest(rows[2]).email, "", "a bad email is dropped");
  const c = { title: "T", guests: [{ ...cleanGuest(rows[0], { source: "csv" }), event: "e1", status: "yes", checkedIn: true, again: false, said: "Too loud, honestly", followUp: "meeting" }, { ...cleanGuest(rows[1], { source: "csv" }), event: "e1", status: "yes", checkedIn: true }, { ...cleanGuest({ name: "=HYPERLINK(1)", email: "x@y.example", consent: true }), event: "e1" }] };
  const out = exportCsv(c, { e1: { name: "Game night", date: "2026-12-14", host: "Dice and Dumplings" } });
  assert.match(out, /^Name,Email,Company,Title,Campaign,Event,Event date,Host,Invited,Reply,Attended,Follow-up,Consent given,Consent source\r\n/);
  assert.match(out, /Jo Park,jo@lark\.example,"Lark, Inc\.",Staff engineer,T,Game night,2026-12-14,Dice and Dumplings,,Yes,Yes,Meeting booked,\d{4}-\d\d-\d\d,Imported with consent/);
  assert.doesNotMatch(out, /sam@lark/, "no consent, not exported"); assert.doesNotMatch(out, /Too loud|again/i, "feedback never goes out with a name");
  assert.match(out, /"'=HYPERLINK\(1\)"/, "spreadsheet formulas are defused");
  // over HTTP: import, then export as an editor
  const id = S.campaigns.C2, ev = (await ok(await get(`/api/campaigns/${id}`, S.owner.c))).campaign.bookings[0].id;
  const imp = await ok(await post(`/api/campaigns/${id}/guests/import`, { csv: "name,email,company,consent\nLina Ortiz,lina@co.example,Co,yes\nMo Haas,mo@co.example,Co,\nLina Ortiz,lina@co.example,Co,yes\n", event: ev }, S.editor.c));
  assert.equal(imp.added, 2); assert.equal(imp.skipped, 1, "the same person twice on one event is skipped");
  const csv = await (await get(`/api/campaigns/${id}/export.csv`, S.editor.c)).text();
  assert.match(csv, /lina@co\.example/); assert.doesNotMatch(csv, /mo@co\.example/);
  const all = await (await get(`/api/campaigns/${S.campaigns.C1}/export.csv`, S.owner.c)).text(), C1 = (await ok(await get(`/api/campaigns/${S.campaigns.C1}`, S.owner.c))).campaign;
  assert.equal(all.trim().split("\r\n").length - 1, C1.guests.filter((g) => g.consent.share && g.email && !g.limited).length);
});

test("rollups: per event and for the campaign, with feedback only at 10+ answers", () => {
  const g = (o) => ({ ...cleanGuest({ name: "N", email: Math.random() + "@x.example" }), ...o });
  const reqs = [R("e1", "booked", 120000, 30000, { date: day(-5) }), R("e2", "booked", 60000, 15000, { date: day(-3) }), R("e3", "booked", 90000, 0, { date: day(20) })];
  const guests = [];
  for (let i = 0; i < 14; i++) guests.push(g({ event: "e1", status: i < 12 ? "yes" : "no", invitedAt: 1, checkedIn: i < 10, again: i < 10 ? i < 9 : null, said: i < 10 ? "Met great people at the table" : "", followUp: i < 3 ? "meeting" : i < 5 ? "sent" : "none" }));
  for (let i = 0; i < 6; i++) guests.push(g({ event: "e2", status: "yes", invitedAt: 1, checkedIn: i < 4, again: i < 4 ? true : null }));
  for (let i = 0; i < 8; i++) guests.push(g({ event: "e3", status: i < 3 ? "yes" : "invited", invitedAt: 1 }));
  guests.push(g({ event: "e3", status: "asked" }));
  const c = { budgetCents: 500000, bookings: ["e1", "e2", "e3"], guests, costs: [{ id: "k", label: "Cards", cents: 10000, event: "e1", paid: true }], kpis: { attendees: 40, meetings: 10, againPct: 85 } };
  const X = rollup(c, reqs), [a, b, d] = X.events;
  assert.equal(a.invited, 14); assert.equal(a.replied, 14); assert.equal(a.yes, 12); assert.equal(a.attended, 10); assert.equal(a.showPct, 83); assert.equal(a.againPct, 90, "10 answers: shown");
  assert.equal(a.costCents, 130000, "the booking and the cost marked for it"); assert.equal(a.costPerAttendeeCents, 13000); assert.equal(a.meetings, 3); assert.equal(a.followUps, 5);
  assert.equal(b.againPct, null, "4 answers: hidden"); assert.equal(b.againAnswered, 4); assert.equal(b.costPerAttendeeCents, 15000);
  assert.equal(d.attended, 0); assert.equal(d.showPct, null, "not happened yet"); assert.equal(d.costPerAttendeeCents, null); assert.equal(d.invited, 8, "asked to join isn't invited");
  const T = X.totals; assert.equal(T.attended, 14); assert.equal(T.showPct, 78, "14 of 18 yeses at events that happened"); assert.equal(T.againPct, 93); assert.equal(T.events, 3); assert.equal(T.eventsDone, 2);
  assert.equal(T.costPerAttendeeCents, Math.round((130000 + 60000) / 14));
  assert.equal(X.kpis.find((k) => k.k === "attendees").pct, 35); assert.equal(X.kpis.find((k) => k.k === "again").have, 93);
  assert.equal(T.themes.shown, true); assert.equal(T.themes.themes[0].k, "people"); assert.equal(T.quotes.length, 0, "no one said we could quote them");
  assert.equal(themesOf(["Great people", "Nice"]).shown, false, "under 10 answers, no themes");
  // the report names no guests
  const html = reportHtml({ title: "Q", goal: "", cities: [] }, X, { company: "Fernwood Labs" }); assert.doesNotMatch(html, /@/); assert.match(html, /Would go again/); assert.doesNotMatch(html, /\u2014/);
});

test("the guest's own link: reply, choose to share, and feedback after; sign-ups who don't share stay first-name only", async () => {
  const id = S.campaigns.C1, C = (await ok(await get(`/api/campaigns/${id}`, S.owner.c))).campaign, ev = C.bookings.find((b) => b.status === "booked" && b.date >= day(0)).id;
  // a sign-up from the public page, without sharing
  assert.equal((await get(`/cg/${id}/join`)).status, 200);
  const pub = await ok(await get(`/api/cg/${id}`)); assert.ok(pub.events.length >= 1); assert.doesNotMatch(JSON.stringify(pub), /@|address/i);
  await ok(await post(`/api/cg/${id}/join`, { name: "Wes Arden", email: "wes@quiet.example", company: "Quiet Co", event: ev, consent: false }));
  let G = (await ok(await get(`/api/campaigns/${id}`, S.owner.c))).campaign.guests.find((g) => g.name === "Wes");
  assert.ok(G, "shown by first name"); assert.equal(G.email, "w•••@quiet.example"); assert.equal(G.company, ""); assert.equal(G.limited, true); assert.equal(G.status, "asked");
  // the team lets them in and sends the invite; the guest replies through their own link and chooses to share
  await ok(await patch(`/api/campaigns/${id}/guests/${G.id}`, { status: "added" }, S.editor.c));
  const sent = await ok(await post(`/api/campaigns/${id}/invites`, { event: ev }, S.editor.c)); const link = sent.links.find((l) => l.name === "Wes").link; const path = new URL(link).pathname;
  assert.equal((await get(path)).status, 200);
  const api = path.replace("/cg/", "/api/cg/"); const mine = await ok(await get(api)); assert.equal(mine.company, "Fernwood Labs"); assert.equal(mine.status, "invited"); assert.equal(mine.consent, false);
  await ok(await post(api, { reply: "yes", consent: true }));
  G = (await ok(await get(`/api/campaigns/${id}`, S.owner.c))).campaign.guests.find((g) => g.email === "wes@quiet.example");
  assert.equal(G.name, "Wes Arden", "they chose to share"); assert.equal(G.status, "yes"); assert.equal(G.consent.via, "rsvp");
  assert.match(await (await get(`/api/campaigns/${id}/export.csv`, S.owner.c)).text(), /wes@quiet\.example/);
  assert.equal((await get(`/api/cg/${id}/r/notatoken`)).status, 404);
});

test("the report: members and people with the link only, and the link can be turned off", async () => {
  const id = S.campaigns.C1;
  assert.equal((await get(`/teams/campaigns/${id}/report`)).status, 404);
  const html = await (await get(`/teams/campaigns/${id}/report`, S.viewer.c)).text(); assert.match(html, /Campaign report/); assert.doesNotMatch(html, /@/);
  assert.equal((await post(`/api/campaigns/${id}/report-link`, {}, S.viewer.c)).status, 403);
  const { url } = await ok(await post(`/api/campaigns/${id}/report-link`, {}, S.editor.c)); assert.equal((await get(url)).status, 200);
  assert.equal((await get(url.replace(/k=\w+/, "k=wrong"))).status, 404);
  await ok(await post(`/api/campaigns/${id}/report-link`, { off: true }, S.owner.c)); assert.equal((await get(url)).status, 404);
  // the pages answer, and the brand nav leads with Home, Discover hosts, Campaigns, Insights, Bookings
  for (const p of ["/teams/home", "/teams/campaigns", `/teams/campaigns/${id}/run`, "/teams/insights"]) assert.equal((await get(p, S.owner.c)).status, 200, p);
  const home = await ok(await get("/api/teams/home", S.owner.c)); assert.equal(home.company, "Fernwood Labs"); assert.ok(home.active.length >= 1 && home.upcoming.length >= 1 && home.resonates.kinds.length >= 1);
  const fs = await import("node:fs"); const bb = fs.readFileSync(new URL("../public/brandbook.js", import.meta.url), "utf8"), nav = fs.readFileSync(new URL("../public/nav.js", import.meta.url), "utf8");
  assert.match(bb, /\["\/teams\/home", "home", "Home", "home"\], \["\/teams\/discover", "all", "Discover hosts", "discover"\], \["\/teams\/campaigns", "flag", "Campaigns", "campaigns"\], \["\/teams\/insights", "spark", "Insights", "insights"\], \["\/teams\/bookings", "cal", "Bookings", "bookings"\]/);
  assert.match(nav, /\["\/teams\/home", "Home"\], \["\/teams\/discover", "Discover hosts"\], \["\/teams\/campaigns", "Campaigns"\], \["\/teams\/insights", "Insights"\], \["\/teams\/bookings", "Bookings"\]/);
  // the old brand pages still answer, linked from Home
  for (const p of ["/requests", "/gifts", "/hosts/book", "/teams", "/teams/list", "/teams/bookings"]) assert.equal((await get(p, S.owner.c)).status, 200, p);
});
