import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { cleanPlan, samplePlan, prompt, parseGroups, parseRoster, subjectOf, readBody, planFromInput, crmRows, toCsv, mergeResearched, complianceOf } from "../server/giftplan.js";

const n = (v) => +String(v).replace(/[^\d.]/g, "");
const SAAS = /\b(pipeline|account executives?|AE|opportunit(y|ies)|API|trial|seats?|design partners?)\b/;
const textOf = (p) => JSON.stringify(p);

test("A plan keeps only the shape we use, with safe links", () => {
  const p = cleanPlan({ company: "Exa", moment: { title: "Snapshot", sources: [{ title: "x", url: "javascript:alert(1)" }, { title: "Launch post", url: "https://exa.ai/blog/snapshot" }] }, gifts: [{ name: "Polaroid <b>kit</b>", perPerson: "$110", extra: "drop me" }], evil: 1 });
  assert.deepEqual(p.moment.sources.map((s) => s.url), ["https://exa.ai/blog/snapshot"]); assert.equal(p.gifts[0].name, "Polaroid kit"); assert.ok(!("evil" in p)); assert.ok(!("extra" in p.gifts[0]));
  const c = cleanPlan({ audience: { segments: [{ who: "<b>Press</b>", send: "everyone!" }] } }); assert.equal(c.audience.segments[0].send, "all"); assert.equal(c.audience.segments[0].who, "Press");
});

test("Free-text audiences become groups with counts; the product phrase reads like a sentence", () => {
  assert.deepEqual(parseGroups("40 champions, 12 journalists + 4 analysts under embargo, 15 design partners").map((g) => [g.count, g.role]), [[40, "champion"], [12, "press"], [4, "analyst"], [15, "designPartner"]]);
  assert.deepEqual(parseGroups("60 wholesale cafés").map((g) => [g.label, g.count, g.role]), [["Wholesale cafés", 60, "buyer"]]);
  assert.deepEqual(parseGroups("40 new hires").map((g) => g.role), ["newHire"]);
  assert.deepEqual(parseGroups("design partners and investors").map((g) => g.role), ["designPartner", "investor"]);
  assert.equal(parseGroups("VP Finance and RevOps at 8 accounts")[0].count, 0, "a count of accounts is not a head count");
  assert.equal(subjectOf("We just launched Snapshot"), "Snapshot");
  assert.equal(subjectOf("launching data governance module"), "our data governance module");
});

test("The planner honours head count, groups and the per-person cap, and never invents groups", () => {
  const p = planFromInput(readBody({ company: "Ridgeway", moment: "Launching Ledger Sync", kind: "b2b", audience: "40 champions, 12 journalists + 4 analysts under embargo, 15 design partners", people: "70", budget: "$120", date: "2027-03-10" }));
  assert.deepEqual(p.audience.segments.map((s) => [s.who, s.count]), [["Champions", "40"], ["Journalists", "12"], ["Analysts under embargo", "4"], ["Design partners", "15"]]);
  assert.ok(!p.audience.segments.some((s) => /investor/i.test(s.who)), "no investors unless asked");
  assert.ok(p.audience.reconcile.some((x) => /71.*70/.test(x)), "says how 71 named vs 70 was reconciled");
  for (const g of p.gifts) { assert.ok(g.cost.allIn <= 120, g.name); assert.equal(g.cost.allIn, g.cost.gift + g.cost.maker + g.cost.shipping); }
  const press = p.audience.segments.find((s) => s.role === "press"), pressLine = p.playbook.budgetLines.find((x) => x.segment === press.who);
  assert.ok(n(pressLine.giftCost) + n(pressLine.makerFee) <= 25, "press gifts stay under $25 in value");
  // card prices match the budget table
  for (const L of p.playbook.budgetLines) assert.ok(p.gifts.some((g) => g.name === L.gift && g.cost.allIn === n(L.each)), L.segment);
  const sum = p.playbook.budgetLines.reduce((a, x) => a + n(x.total), 0); assert.ok(Math.abs(sum - n(p.playbook.budget.total.split(" for ")[0])) < 2);
  assert.equal(p.playbook.budget.fee, "", "no fee line until a fee exists (FEE_LINE is off)"); assert.doesNotMatch(textOf(p), /\d+\s?%\s*(service )?fee/i);
  // real dates, no stale seasons or template leftovers
  assert.match(p.playbook.timeline[0].when, /Jan|Feb/, "dated from the launch, early enough to book the longest-lead maker"); assert.doesNotMatch(textOf(p), /\bQ[1-4]\b|by June|📸|API key|on one task/);
  assert.ok(/\n\n/.test(p.playbook.message.email), "the email keeps its line breaks");
});

test("When nothing fits the cap, the plan says so instead of breaking it", () => {
  const p = planFromInput(readBody({ company: "Tiny", moment: "Thanking our customers", kind: "customers", audience: "30 customers", budget: "$10" }));
  assert.ok(p.playbook.risks.some((r) => /nothing handmade fits/i.test(r)));
});

test("Non-software audiences never see SaaS words, and get their own playbook language", () => {
  const cafes = planFromInput(readBody({ company: "Lantern Coffee", moment: "Thanking our wholesale cafés for a great year", audience: "60 wholesale cafés", people: "60", budget: "$55", dealSize: "$1,200" }));
  assert.equal(cafes.kind, "retail"); assert.equal(cafes.audience.segments.length, 1); assert.equal(cafes.audience.segments[0].count, "60");
  assert.doesNotMatch(textOf(cafes), SAAS); assert.match(cafes.playbook.finance.expect, /reorder/); assert.ok(!cafes.gifts.some((g) => /coffee/i.test(g.name)), "no coffee for a coffee roaster");
  const hires = planFromInput(readBody({ company: "Orbit", moment: "Remote new-hire welcome", audience: "40 new hires", people: "40", budget: "$60", date: "2027-01-11" }));
  assert.equal(hires.kind, "employees"); assert.equal(hires.playbook.brief.name, "Team brief"); assert.doesNotMatch(textOf(hires), SAAS); assert.match(hires.playbook.prove.holdout, /^None\./);
  assert.ok(hires.gifts.every((g) => g.cost.allIn <= 60));
  const talks = planFromInput(readBody({ company: "Patchwork", moment: "Thank-you to the speakers at Patchwork Conf", kind: "community", audience: "18 speakers, 6 co-organizers", budget: "$50", date: "2020-01-01" }));
  assert.deepEqual(talks.audience.segments.map((s) => s.role), ["speaker", "organizer"]); assert.doesNotMatch(textOf(talks), SAAS);
  assert.ok(!talks.playbook.risks.some((r) => /has passed/.test(r)), "community gifts are planned from today, after the event");
  const dtc = planFromInput(readBody({ company: "Brightwater", moment: "We're launching our yuzu sparkling tea can", audience: "30 creators, 20 retail buyers, 10 journalists", people: "60", budget: "$40" }));
  assert.equal(dtc.kind, "creators"); assert.doesNotMatch(textOf(dtc), SAAS); assert.ok(dtc.gifts.every((g) => g.cost.allIn <= 40));
  assert.ok(dtc.playbook.message.notes.every((x) => /^[A-Z]/.test(x.note)), "notes start with a capital");
});

test("Compliance flags public-sector, healthcare and regulated-finance rows; the CRM sheet has one row per pasted row", () => {
  assert.ok(complianceOf({ account: "State of Ohio Dept of Revenue" })); assert.ok(complianceOf({ account: "Acme", email: "x@tax.ohio.gov" })); assert.ok(complianceOf({ account: "Mercy Hospital" })); assert.ok(complianceOf({ account: "First Federal Bank" })); assert.equal(complianceOf({ account: "Globex" }), null);
  const csvIn = "account,contact,email,role,tier,stage,owner\nGlobex,Ada,ada@globex.com,VP Finance,1,Evaluation,Sam\nState of Ohio Dept of Revenue,Tom,tom@tax.ohio.gov,Controller,2,,Priya\nInitech,Raj,raj@initech.com,Head of Data,1,,Sam";
  assert.deepEqual(parseRoster(csvIn).map((r) => [r.account, r.contact, r.tier, r.owner]), [["Globex", "Ada", "1", "Sam"], ["State of Ohio Dept of Revenue", "Tom", "2", "Priya"], ["Initech", "Raj", "1", "Sam"]]);
  assert.deepEqual(parseRoster(["Globex", "Initech", "Globex"]).map((r) => r.account), ["Globex", "Initech"]);
  const input = readBody({ company: "Ridgeway", moment: "Launching Ledger Sync", kind: "b2b", audience: "20 champions", budget: "$100", accounts: csvIn.split("\n"), protect: "Globex" });
  const p = planFromInput(input, "seed"), rows = crmRows(p, input, "seed");
  assert.equal(rows.length, 3); const ohio = rows.find((r) => /Ohio/.test(r.Company));
  assert.equal(ohio.Group, "Note only"); assert.equal(ohio.Gift, "Note only, no gift"); assert.equal(ohio["Approved Cost"], "0"); assert.match(ohio.Reason, /Public sector/);
  assert.equal(rows.find((r) => r.Company === "Globex").Group, "Gift"); assert.match(p.playbook.compliance.line, /public sector/i);
  const csv = toCsv(rows); for (const col of ["Meeting Booked", "Opp Created", "Opp Amount", "Campaign Member Status", "HubSpot List", "Contact", "Approved Cost"]) assert.ok(csv.split("\r\n")[0].includes(col), col);
  // a small list gets no holdout, said plainly; the follow-up names the gift that group actually got
  assert.match(p.playbook.prove.holdout, /^None\..*30 or more/); assert.equal(p.playbook.prove.useHoldout, false);
  const champ = p.playbook.brief.sections.find((s) => s.who === "Champions"); assert.ok(champ.script.includes(p.audience.segments[0].gift.includes("mug") ? "mug" : "the"), champ.script);
});

test("A big enough list gets a stratified holdout that never touches strategic accounts", () => {
  const lines = ["account,tier", ...Array.from({ length: 50 }, (_, i) => `Co${i},${i % 2 ? "1" : "2"}`)];
  const input = readBody({ company: "Acme", moment: "Launching Lens", kind: "b2b", accounts: lines, protect: "Co1\nCo2\nCo3" }), p = planFromInput(input, "s1"), rows = crmRows(p, input, "s1");
  assert.equal(p.playbook.prove.useHoldout, true); const held = rows.filter((r) => r.Group === "Comparison group");
  assert.ok(held.length >= 8 && held.length <= 11, String(held.length)); assert.ok(!held.some((r) => ["Co1", "Co2", "Co3"].includes(r.Company)));
  assert.ok(held.some((r) => r.Tier === "1") && held.some((r) => r.Tier === "2"), "stratified by tier"); assert.ok(held.every((r) => r["Approved Cost"] === "0"));
  assert.equal(p.playbook.prove.held, held.length, "the plan and the sheet hold back the same accounts");
});

test("The deal size sets the pipeline target instead of a fixed multiple of spend", () => {
  const p = planFromInput(readBody({ company: "Ledgerline", moment: "Launching Close", kind: "b2b", audience: "60 VP Finance", budget: "$100", dealSize: "$40,000" }));
  assert.match(p.playbook.prove.target, /\$\d[\d,]* in pipeline from about \d+ meetings/); assert.doesNotMatch(p.playbook.prove.target, /3x/);
  assert.match(p.playbook.finance.expect, /\$40,000 average deal/);
});

test("The researched path keeps the marketer's numbers and drops off-brief words", () => {
  const input = readBody({ company: "Lantern Coffee", moment: "Thanking our wholesale cafés", audience: "60 wholesale cafés", budget: "$55" });
  const ai = cleanPlan({ company: "Lantern", moment: { what: "Lantern supplies 60 cafés." }, theme: { name: "Pour it forward", idea: "Cups for the counter." }, gifts: [{ name: "Glazed cup pair", perPerson: "$90", tieIn: "For the counter" }], playbook: { message: { subject: "Thank you", email: "Hi,\n\nThanks.\n\n— Lantern", social: "Our pipeline of cafés, thank you" }, risks: ["Q4 books up"] } });
  const p = mergeResearched(input, ai, "x"); assert.equal(p.source, "researched"); assert.equal(p.gifts[0].name, "Glazed cup pair"); assert.ok(p.gifts[0].cost.allIn <= 55);
  assert.doesNotMatch(textOf(p), /\bQ4\b|pipeline/); assert.equal(p.audience.segments[0].count, "60");
  const t = prompt(input); assert.match(t, /web search/i); assert.match(t, /Wholesale cafés \(60/); assert.match(t, /never use pipeline/);
});

test("The offline example follows the theme", () => {
  assert.match(samplePlan({ company: "Exa", moment: "launched Snapshot" }).gifts[0].name, /camera/i);
});

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.close(); });
const wait = async (id) => { let d; for (let i = 0; i < 40; i++) { d = await (await fetch(srv.base + "/api/public/giftplan/" + id)).json(); if (d.status !== "working") break; await new Promise((x) => setTimeout(x, 100)); } return d; };
test("Anyone can ask for a plan; it comes back straight away, labelled as a draft, at a shareable link", async () => {
  const bad = await fetch(srv.base + "/api/public/giftplan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ company: "E" }) }); assert.equal(bad.status, 400);
  const r = await (await fetch(srv.base + "/api/public/giftplan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ company: "Exa", moment: "We just launched Snapshot", people: "150" }) })).json();
  const d = await wait(r.id);
  assert.equal(d.status, "ready"); assert.equal(d.plan.source, "draft"); assert.ok(d.draft); assert.ok(d.plan.gifts.length >= 1); assert.ok(d.plan.playbook.timeline.length >= 3); assert.ok(Array.isArray(d.plan.gifts[0].makers));
  assert.equal(d.plan.audience.segments.reduce((a, s) => a + n(s.count), 0), 150);
  assert.equal((await fetch(srv.base + "/api/public/giftplan/ffffffffffffffff")).status, 404);
  assert.equal((await fetch(srv.base + "/gifts/plan/" + r.id)).status, 200);
  const ex = await (await fetch(srv.base + "/api/public/giftplan/example")).json(); assert.equal(ex.plan.source, "example"); assert.ok(ex.crm.split("\r\n").length > 5);
});

test("Never 'try again in an hour': past the research limit the planner still answers with a draft", async () => {
  for (let i = 0; i < 9; i++) { const r = await fetch(srv.base + "/api/public/giftplan", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.7.7.7" }, body: JSON.stringify({ company: "Acme", moment: "Holiday thank-you", audience: "20 customers" }) }); assert.equal(r.status, 200); }
});

test("A target-account list stays with the marketer who made the plan; a shared link shows only the count", async () => {
  const r = await (await fetch(srv.base + "/api/public/giftplan", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.9" }, body: JSON.stringify({ company: "Acme", moment: "We launched Lens", tier: "Feature launch", accounts: ["Globex", "Initech", "Globex", "<b>Umbrella</b>"] }) })).json();
  assert.ok(r.key, "the creator gets a private key");
  const d = await wait(r.id);
  assert.equal(d.input.accounts, undefined); assert.equal(d.input.contacts, undefined); assert.equal(d.input.accountCount, 3); assert.equal(d.input.tier, "Feature launch");
  assert.doesNotMatch(d.crm, /Globex/, "the shared sheet has template rows only");
  const mine = await (await fetch(srv.base + "/api/public/giftplan/" + r.id + "?k=" + r.key)).json();
  assert.deepEqual(mine.input.accounts, ["Globex", "Initech", "Umbrella"]); assert.match(mine.crm, /Globex/); assert.equal(mine.crm.trim().split("\r\n").length, 4);
  assert.ok(mine.plan.playbook.prove.cfo, "a summary for finance");
});

test("A welcome for two groups of new staff: welcome notes, no public-sector gate, ships before it arrives", () => {
  const p = planFromInput(readBody({ company: "Orbit Labs", moment: "Welcoming our January hires", kind: "employees", audience: "30 engineers, 10 sales", budget: "$45", date: "2027-01-11" }));
  assert.equal(p.kind, "employees"); assert.match(p.playbook.goal, /^Every one of the 40 people feels welcome/);
  assert.ok(p.playbook.message.notes.every((x) => /^Welcome to Orbit Labs/.test(x.note)), "welcome notes, not thank-you notes");
  assert.ok(!p.playbook.approvals.some((a) => /public-sector/.test(a.gate)), "employees aren't public-sector recipients");
  const T = p.playbook.timeline, ship = T.findIndex((t) => t.step === "Makers ship"), arrive = T.findIndex((t) => t.step === "Gifts arrive at home");
  assert.ok(ship >= 0 && arrive > ship, "gifts arrive after they ship");
});

test("No date: the timeline uses its own offsets (never '999 days'), and a late date gets one short warning", () => {
  for (const kind of ["employees", "b2b", "press"]) {
    const p = planFromInput(readBody({ company: "Orbit Labs", moment: "Remote new-hire welcome", kind, audience: "40 new hires", budget: "$60" }));
    for (const t of p.playbook.timeline) assert.doesNotMatch(t.when, /\b\d{3,} days\b/, `${kind}: ${t.when}`);
  }
  const soon = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10), q = planFromInput(readBody({ company: "Exa", moment: "Launching Snapshot", kind: "b2b", audience: "40 customers", budget: "$60", date: soon }));
  assert.ok(q.timing?.late); assert.match(q.timing.text, /is too soon for handmade\.$/); assert.doesNotMatch(q.timing.text, /needed ordering/);
  // a late new-hire welcome: the hint says the earliest date is after day one without repeating it, and there's no "plan for that date"
  const w = planFromInput(readBody({ company: "Orbit Labs", moment: "Remote new-hire welcome", kind: "employees", audience: "40 new hires", budget: "$60", date: soon }));
  assert.ok(w.timing?.afterStart); assert.equal(w.timing.hint, "That's after their start date. Send a card before day one and the gift after.");
  assert.doesNotMatch(JSON.stringify(q.playbook.finance), /\beach\b/); assert.doesNotMatch(q.playbook.finance.measure, /Rates assumed/);
});
