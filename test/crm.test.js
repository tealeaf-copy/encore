import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { callTool, configured } from "../server/integrations/index.js";
import { _resetTokenCache } from "../server/integrations/salesforce.js";

const ENV = ["HUBSPOT_TOKEN", "SF_INSTANCE_URL", "SF_ACCESS_TOKEN", "SF_CLIENT_ID", "SF_CLIENT_SECRET", "SF_API_VERSION", "SLACK_BOT_TOKEN", "SLACK_WEBHOOK_URL", "LINEAR_API_KEY", "LINEAR_TEAM_ID"];
const realFetch = globalThis.fetch;
let calls;

/** Mock fetch with a router: (url: URL, init, body) -> [status, json] | json. */
function mockFetch(route) {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    let body = init.body;
    try { body = JSON.parse(init.body); } catch {}
    calls.push({ url: u, method: init.method || "GET", headers: init.headers || {}, body });
    let r = await route(u, init, body);
    if (!Array.isArray(r)) r = [200, r];
    const [status, json] = r;
    return new Response(json === undefined ? null : JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
  };
}

beforeEach(() => { for (const k of ENV) delete process.env[k]; _resetTokenCache(); });
afterEach(() => { globalThis.fetch = realFetch; });

const servers = () => configured().map((s) => s.server);

test("CRM integrations are not listed without their env vars", () => {
  assert.ok(!servers().includes("HubSpot"));
  assert.ok(!servers().includes("Salesforce - Beta"));
  process.env.SF_INSTANCE_URL = "https://acme.my.salesforce.com";
  assert.ok(!servers().includes("Salesforce - Beta"), "instance alone is not enough");
  process.env.SF_CLIENT_ID = "id";
  assert.ok(!servers().includes("Salesforce - Beta"), "client id without secret is not enough");
  process.env.SF_CLIENT_SECRET = "secret";
  assert.ok(servers().includes("Salesforce - Beta"));
  delete process.env.SF_CLIENT_ID; delete process.env.SF_CLIENT_SECRET;
  process.env.SF_ACCESS_TOKEN = "tok";
  assert.ok(servers().includes("Salesforce - Beta"));
  process.env.HUBSPOT_TOKEN = "test";
  const hs = configured().find((s) => s.server === "HubSpot");
  assert.deepEqual(hs.tools.map((t) => t.name), ["search_crm_objects", "upsert_event_attendees", "event_pipeline", "log_followups", "verify_activity", "rollup_account_spend"]);
  const sf = configured().find((s) => s.server === "Salesforce - Beta");
  assert.deepEqual(sf.tools.map((t) => t.name), ["dispatch_readonly", "upsert_event_attendees", "event_pipeline", "log_followups", "verify_activity", "rollup_account_spend"]);
});

test("HubSpot search sends the CRM v3 search body with a bearer token", async () => {
  process.env.HUBSPOT_TOKEN = "test-token";
  mockFetch(() => ({ total: 1, results: [{ id: "101", properties: { name: "Copperleaf", domain: "copperleaf.com" }, createdAt: "x" }] }));
  const r = await callTool("HubSpot", "search_crm_objects", {
    objectType: "companies", query: "Copperleaf", limit: 500,
    filters: [{ propertyName: "domain", operator: "EQ", value: "copperleaf.com" }], properties: ["name", "domain"],
  });
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.method, "POST");
  assert.equal(c.url.href, "https://api.hubapi.com/crm/v3/objects/companies/search");
  assert.equal(c.headers.Authorization, "Bearer test-token");
  assert.deepEqual(c.body, {
    limit: 50, query: "Copperleaf", properties: ["name", "domain"],
    filterGroups: [{ filters: [{ propertyName: "domain", operator: "EQ", value: "copperleaf.com" }] }],
  });
  assert.deepEqual(r.payload, { total: 1, results: [{ id: "101", name: "Copperleaf", domain: "copperleaf.com" }] });
  await assert.rejects(callTool("HubSpot", "search_crm_objects", { objectType: "tickets" }), (e) => e.code === "tool_error");
});

test("HubSpot upsert: batch contacts by email, upsert the event, record states", async () => {
  process.env.HUBSPOT_TOKEN = "test-token";
  mockFetch((u, init, body) => {
    if (u.pathname === "/crm/v3/objects/contacts/batch/upsert") return { results: body.inputs.map((x, i) => ({ id: String(i + 1) })) };
    if (u.pathname.startsWith("/marketing/v3/marketing-events/events/") && init.method === "PUT") return { objectId: "9001" };
    if (u.pathname.endsWith("/email-upsert")) return [204, undefined];
    return [404, { message: "unexpected" }];
  });
  const members = [
    { email: "Ana@Copperleaf.com", firstName: "Ana", lastName: "Ruiz", company: "Copperleaf", title: "CIO", status: "Attended" },
    { email: "ben@x.com", firstName: "Ben", lastName: "Li", company: "X", title: "VP", status: "Registered" },
    { email: "cy@y.com", firstName: "Cy", lastName: "", company: "Y", title: "", status: "Declined" },
    { email: "di@z.com", firstName: "Di", company: "Z", status: "Invited" },
    { email: "", firstName: "No email", status: "Invited" },
  ];
  const r = await callTool("HubSpot", "upsert_event_attendees", { eventName: "Chicago Supper Club", eventDate: "2026-12-10", members });
  const up = calls.find((c) => c.url.pathname === "/crm/v3/objects/contacts/batch/upsert");
  assert.equal(up.body.inputs.length, 4);
  assert.ok(up.body.inputs.every((x) => x.idProperty === "email"));
  assert.deepEqual(up.body.inputs[0], { idProperty: "email", id: "ana@copperleaf.com", properties: { email: "ana@copperleaf.com", firstname: "Ana", lastname: "Ruiz", company: "Copperleaf", jobtitle: "CIO" } });

  const ev = calls.find((c) => c.method === "PUT");
  assert.equal(ev.url.pathname, "/marketing/v3/marketing-events/events/chicago-supper-club-2026-12-10");
  assert.equal(ev.body.externalEventId, "chicago-supper-club-2026-12-10");
  assert.equal(ev.body.externalAccountId, "encore");
  assert.equal(ev.body.eventName, "Chicago Supper Club");

  const states = Object.fromEntries(calls.filter((c) => c.url.pathname.endsWith("/email-upsert")).map((c) => {
    assert.equal(c.url.searchParams.get("externalAccountId"), "encore");
    return [c.url.pathname.split("/").at(-2), c.body.inputs.map((x) => x.email)];
  }));
  assert.deepEqual(states, { register: ["ana@copperleaf.com", "ben@x.com"], attend: ["ana@copperleaf.com"], cancel: ["cy@y.com"] });
  assert.deepEqual(r.payload, { contactsUpserted: 4, eventId: "9001", externalEventId: "chicago-supper-club-2026-12-10", statusesRecorded: 4, errors: [] });
});

test("HubSpot event_pipeline keeps deals created or moved in the window", async () => {
  process.env.HUBSPOT_TOKEN = "test-token";
  mockFetch((u) => {
    if (u.pathname === "/crm/v3/objects/contacts/batch/read") return { results: [{ id: "1", properties: { email: "ana@copperleaf.com", company: "Copperleaf" } }] };
    if (u.pathname === "/crm/v4/associations/contacts/deals/batch/read") return { results: [{ from: { id: "1" }, to: [{ toObjectId: 11 }, { toObjectId: 12 }, { toObjectId: 13 }] }] };
    if (u.pathname === "/crm/v3/objects/deals/batch/read") return { results: [
      { id: "11", properties: { dealname: "New", amount: "50000", dealstage: "qualifiedtobuy", createdate: "2026-12-20T10:00:00Z", hs_lastmodifieddate: "2026-12-21T10:00:00Z" } },
      { id: "12", properties: { dealname: "Old, moved", amount: "20000", dealstage: "closedwon", createdate: "2026-01-01T10:00:00Z", hs_lastmodifieddate: "2027-01-05T10:00:00Z" } },
      { id: "13", properties: { dealname: "Stale", amount: "9000", dealstage: "appointmentscheduled", createdate: "2026-01-01T10:00:00Z", hs_lastmodifieddate: "2026-06-01T10:00:00Z" } },
    ] };
    return [404, {}];
  });
  const r = await callTool("HubSpot", "event_pipeline", { emails: ["Ana@copperleaf.com"], since: "2026-12-10", until: "2027-03-10" });
  assert.deepEqual(r.payload.map((d) => d.dealId), ["11", "12"]);
  assert.deepEqual(r.payload[0], { dealId: "11", name: "New", amount: 50000, stage: "qualifiedtobuy", createdate: "2026-12-20T10:00:00Z", lastStageChange: "2026-12-21T10:00:00Z", contactEmail: "ana@copperleaf.com", company: "Copperleaf" });
  const read = calls.find((c) => c.url.pathname === "/crm/v3/objects/contacts/batch/read");
  assert.equal(read.body.idProperty, "email");
});

test("Salesforce rejects anything but a single SELECT", async () => {
  process.env.SF_INSTANCE_URL = "https://acme.my.salesforce.com";
  process.env.SF_ACCESS_TOKEN = "tok";
  mockFetch(() => ({ totalSize: 1, done: true, records: [{ attributes: { type: "Account" }, Id: "001", Name: "A;B", Owner: { attributes: {}, Name: "Kim" } }] }));
  for (const soql of ["DELETE FROM Account", "UPDATE Account SET Name='x'", "SELECT Id FROM Account; DELETE FROM Account", "  ", "insert into x"]) {
    await assert.rejects(callTool("Salesforce - Beta", "dispatch_readonly", { soql }), (e) => e.code === "tool_error" && /SELECT/.test(e.message), soql);
  }
  assert.equal(calls.length, 0);
  const r = await callTool("Salesforce - Beta", "dispatch_readonly", { soql: "SELECT Id, Name, Owner.Name FROM Account WHERE Name = 'A;B';" });
  assert.deepEqual(r.payload, { totalSize: 1, records: [{ Id: "001", Name: "A;B", Owner: { Name: "Kim" } }] });
  assert.equal(calls[0].url.pathname, "/services/data/v61.0/query");
  assert.equal(calls[0].url.searchParams.get("q"), "SELECT Id, Name, Owner.Name FROM Account WHERE Name = 'A;B'");
  assert.equal(calls[0].headers.Authorization, "Bearer tok");
});

test("Salesforce client-credentials token is fetched once and reused", async () => {
  process.env.SF_INSTANCE_URL = "https://acme.my.salesforce.com/";
  process.env.SF_CLIENT_ID = "cid";
  process.env.SF_CLIENT_SECRET = "csecret";
  process.env.SF_API_VERSION = "v62.0";
  mockFetch((u, init) => {
    if (u.pathname === "/services/oauth2/token") return { access_token: "minted", instance_url: "https://acme.my.salesforce.com", token_type: "Bearer", issued_at: String(Date.now()) };
    return { totalSize: 0, done: true, records: [] };
  });
  await callTool("Salesforce - Beta", "dispatch_readonly", { soql: "SELECT Id FROM Account" });
  await callTool("Salesforce - Beta", "dispatch_readonly", { soql: "SELECT Id FROM Contact" });
  const tok = calls.filter((c) => c.url.pathname === "/services/oauth2/token");
  assert.equal(tok.length, 1);
  assert.equal(tok[0].method, "POST");
  const form = new URLSearchParams(tok[0].body);
  assert.equal(form.get("grant_type"), "client_credentials");
  assert.equal(form.get("client_id"), "cid");
  assert.equal(form.get("client_secret"), "csecret");
  const q = calls.filter((c) => c.url.pathname === "/services/data/v62.0/query");
  assert.equal(q.length, 2);
  assert.ok(q.every((c) => c.headers.Authorization === "Bearer minted"));
});

test("Salesforce upsert: campaign, missing statuses, new leads and members", async () => {
  process.env.SF_INSTANCE_URL = "https://acme.my.salesforce.com";
  process.env.SF_ACCESS_TOKEN = "tok";
  mockFetch((u, init, body) => {
    const q = u.searchParams.get("q") || "";
    if (/FROM Campaign WHERE/.test(q)) return { records: [] };
    if (u.pathname.endsWith("/sobjects/Campaign")) return [201, { id: "701C", success: true }];
    if (/FROM CampaignMemberStatus/.test(q)) return { records: [{ Id: "s1", Label: "Sent", SortOrder: 1 }, { Id: "s2", Label: "Attended", SortOrder: 2 }] };
    if (/FROM Contact WHERE/.test(q)) return { records: [{ attributes: {}, Id: "003A", Email: "ana@copperleaf.com", AccountId: "001A", Account: { Name: "Copperleaf" } }] };
    if (/FROM Lead WHERE/.test(q)) return { records: [] };
    if (/FROM CampaignMember WHERE/.test(q)) return { records: [] };
    if (u.pathname.endsWith("/composite/sobjects")) return [200, body.records.map((r, i) => ({ id: `${r.attributes.type}-${i}`, success: true, errors: [] }))];
    return [404, [{ message: "unexpected " + u.pathname }]];
  });
  const r = await callTool("Salesforce - Beta", "upsert_event_attendees", { eventName: "Chicago Supper Club", eventDate: "2026-12-10", members: [
    { email: "ana@copperleaf.com", firstName: "Ana", lastName: "Ruiz", company: "Copperleaf", title: "CIO", status: "Attended" },
    { email: "ben@x.com", firstName: "Ben", lastName: "Li", company: "X", title: "VP", status: "Registered" },
  ] });
  const camp = calls.find((c) => c.url.pathname.endsWith("/sobjects/Campaign"));
  assert.deepEqual(camp.body, { Name: "Event: Chicago Supper Club", StartDate: "2026-12-10", Type: "Event", IsActive: true });
  const colls = calls.filter((c) => c.url.pathname.endsWith("/composite/sobjects"));
  const statuses = colls[0].body.records;
  assert.deepEqual(statuses.map((s) => s.Label), ["Invited", "Registered", "Declined"]);
  assert.deepEqual(statuses.map((s) => s.SortOrder), [3, 4, 5]);
  assert.ok(statuses.every((s) => s.CampaignId === "701C"));
  const lead = colls[1].body.records;
  assert.deepEqual(lead, [{ attributes: { type: "Lead" }, Email: "ben@x.com", FirstName: "Ben", LastName: "Li", Company: "X", Title: "VP", LeadSource: "Event" }]);
  const cms = colls[2].body.records;
  assert.deepEqual(cms.map((m) => [m.ContactId || m.LeadId, m.Status]), [["003A", "Attended"], ["Lead-0", "Registered"]]);
  assert.deepEqual(r.payload, { campaignId: "701C", membersUpserted: 2, leadsCreated: 1, errors: [] });
});

test("Salesforce event_pipeline filters to the window and flags campaign-sourced", async () => {
  process.env.SF_INSTANCE_URL = "https://acme.my.salesforce.com";
  process.env.SF_ACCESS_TOKEN = "tok";
  const opps = [
    { Id: "006A", Name: "New", Amount: 50000, StageName: "Qualification", CreatedDate: "2026-12-20T10:00:00.000+0000", LastStageChangeDate: null, CampaignId: "701C", AccountId: "001A", Account: { Name: "Copperleaf" } },
    { Id: "006B", Name: "Moved", Amount: 20000, StageName: "Closed Won", CreatedDate: "2026-01-01T10:00:00.000+0000", LastStageChangeDate: "2027-01-05T10:00:00.000+0000", CampaignId: null, AccountId: "001A", Account: { Name: "Copperleaf" } },
    { Id: "006C", Name: "After window", Amount: 9000, StageName: "Prospecting", CreatedDate: "2027-04-01T10:00:00.000+0000", LastStageChangeDate: null, CampaignId: null, AccountId: "001A", Account: { Name: "Copperleaf" } },
  ];
  mockFetch((u) => {
    const q = u.searchParams.get("q") || "";
    if (/FROM Contact WHERE/.test(q)) return { records: [{ Id: "003A", Email: "Ana@Copperleaf.com", AccountId: "001A", Account: { Name: "Copperleaf" } }] };
    if (/FROM Lead WHERE/.test(q)) return { records: [] };
    if (/FROM OpportunityContactRole/.test(q)) return { records: [{ OpportunityId: "006B", ContactId: "003A" }] };
    if (/FROM Campaign WHERE/.test(q)) return { records: [{ Id: "701C" }] };
    if (/FROM Opportunity WHERE/.test(q)) return { records: opps.map((o) => ({ attributes: { type: "Opportunity" }, ...o })) };
    return [404, [{ message: "unexpected" }]];
  });
  const r = await callTool("Salesforce - Beta", "event_pipeline", { emails: ["ana@copperleaf.com"], since: "2026-12-10", until: "2027-03-10", eventName: "Chicago Supper Club" });
  assert.deepEqual(r.payload.map((d) => [d.dealId, d.campaignSourced, d.contactEmail, d.company]), [
    ["006A", true, "ana@copperleaf.com", "Copperleaf"],
    ["006B", false, "ana@copperleaf.com", "Copperleaf"],
  ]);
  const oq = calls.map((c) => c.url.searchParams.get("q") || "").filter((q) => /FROM Opportunity WHERE/.test(q));
  assert.ok(oq.some((q) => q.includes("AccountId IN ('001A')")));
  assert.ok(oq.some((q) => q.includes("Id IN ('006B')")));
  assert.ok(oq.some((q) => q.includes("CampaignId = '701C'")));
});

test("HubSpot log_followups creates a task per known contact and a note for gifts", async () => {
  process.env.HUBSPOT_TOKEN = "test-token";
  mockFetch((u) => {
    if (u.pathname === "/crm/v3/objects/contacts/batch/read") return [207, { results: [{ id: "1", properties: { email: "ana@acme.com" } }] }];
    if (u.pathname === "/crm/v3/objects/tasks/search") return { total: 0, results: [] };
    if (u.pathname === "/crm/v3/objects/tasks") return { id: "t1" };
    if (u.pathname === "/crm/v3/objects/notes") return { id: "n1" };
    if (u.pathname === "/crm/v3/properties/contacts") return [409, { message: "exists" }];
    if (u.pathname === "/crm/v3/objects/contacts/batch/update") return { results: [] };
    return [404, {}];
  });
  const r = await callTool("HubSpot", "log_followups", { eventName: "Creator Kitchen", items: [
    { email: "Ana@acme.com", subject: "Book a meeting", body: "Wants the template", dueDate: "2027-02-19", gift: "Cookbook", giftCost: 40 },
    { email: "nobody@x.com", subject: "Nurture" },
    { email: "ana@acme.com", subject: "duplicate is dropped" },
  ] });
  assert.deepEqual(r.payload, { tasksCreated: 1, notesCreated: 1, skipped: 0, missing: ["nobody@x.com"], written: [{ email: "ana@acme.com", recordType: "contact", id: "1" }], fieldErrors: [], errors: [] });
  const upd = calls.find((c) => c.url.pathname === "/crm/v3/objects/contacts/batch/update");
  assert.deepEqual(upd.body.inputs[0], { id: "1", properties: { encore_last_event: "Creator Kitchen", encore_gift_cost: "40" } });
  const task = calls.find((c) => c.url.pathname === "/crm/v3/objects/tasks");
  assert.equal(task.body.properties.hs_task_subject, "Book a meeting (Creator Kitchen)");
  assert.equal(task.body.properties.hs_timestamp, "2027-02-19T17:00:00.000Z");
  assert.equal(task.body.associations[0].to.id, "1");
  await assert.rejects(callTool("HubSpot", "log_followups", { eventName: "X", items: [{ email: "a@b.com", subject: "s", dueDate: "tomorrow" }] }), (e) => /dueDate/.test(e.message));
});

test("Salesforce log_followups creates Tasks on Contacts or Leads", async () => {
  process.env.SF_INSTANCE_URL = "https://acme.my.salesforce.com";
  process.env.SF_ACCESS_TOKEN = "tok";
  mockFetch((u, init, body) => {
    if (u.pathname.endsWith("/query")) {
      const q = u.searchParams.get("q");
      if (/FROM Contact/.test(q)) return { totalSize: 1, done: true, records: [{ Id: "003A", Email: "ana@acme.com" }] };
      if (/FROM Lead/.test(q)) return { totalSize: 1, done: true, records: [{ Id: "00QB", Email: "ben@b.com" }] };
      if (/FROM Task/.test(q)) return { totalSize: 0, done: true, records: [] };
    }
    if (u.pathname.endsWith("/composite/sobjects") && init.method === "PATCH") return [200, body.records.map(() => ({ success: false, errors: [{ message: "No such column 'Encore_Gift_Cost__c' on sobject of type Contact" }] }))];
    if (u.pathname.endsWith("/composite/sobjects")) return [200, body.records.map(() => ({ success: true }))];
    return [404, {}];
  });
  const r = await callTool("Salesforce - Beta", "log_followups", { eventName: "Creator Kitchen", items: [
    { email: "ana@acme.com", subject: "Book a meeting", gift: "Apron", giftCost: 30 }, { email: "ben@b.com", subject: "Renewal: at risk", dueDate: "2027-02-20" }, { email: "zed@z.com", subject: "Nurture" } ] });
  assert.equal(r.payload.tasksCreated, 2);
  assert.deepEqual(r.payload.missing, ["zed@z.com"]);
  assert.deepEqual(r.payload.written, [{ email: "ana@acme.com", recordType: "contact", id: "003A" }, { email: "ben@b.com", recordType: "lead", id: "00QB" }]);
  assert.match(r.payload.fieldErrors[0], /add the Encore_Gift_Cost__c/);
  const post = calls.find((c) => c.url.pathname.endsWith("/composite/sobjects") && c.method === "POST");
  assert.deepEqual(post.body.records.map((x) => x.WhoId), ["003A", "00QB"]);
  assert.match(post.body.records[0].Description, /Gift: Apron \(\$30\)/);
  assert.equal(post.body.records[1].ActivityDate, "2027-02-20");
});

test("verify_activity counts meetings logged since the event", async () => {
  process.env.HUBSPOT_TOKEN = "test-token";
  mockFetch((u, init, body) => {
    if (u.pathname === "/crm/v3/objects/contacts/batch/read") return [207, { results: [{ id: "1", properties: { email: "ana@acme.com" } }] }];
    if (u.pathname === "/crm/v3/objects/meetings/search") return { results: [{ properties: { hs_timestamp: "2027-02-22T15:00:00Z" } }] };
    return [404, {}];
  });
  let r = await callTool("HubSpot", "verify_activity", { emails: ["ana@acme.com", "x@y.com"], since: "2027-02-18" });
  assert.deepEqual(r.payload.results, [{ email: "ana@acme.com", found: true, meetings: 1, lastAt: "2027-02-22T15:00:00Z" }, { email: "x@y.com", found: false, meetings: 0 }]);
  const search = calls.find((c) => c.url.pathname === "/crm/v3/objects/meetings/search");
  assert.equal(search.body.filterGroups[0].filters[0].propertyName, "associations.contact");
  delete process.env.HUBSPOT_TOKEN;
  process.env.SF_INSTANCE_URL = "https://acme.my.salesforce.com"; process.env.SF_ACCESS_TOKEN = "tok";
  mockFetch((u) => {
    const q = u.searchParams.get("q") || "";
    if (/FROM Contact/.test(q)) return { totalSize: 1, done: true, records: [{ Id: "003A", Email: "ana@acme.com" }] };
    if (/FROM Lead/.test(q)) return { totalSize: 0, done: true, records: [] };
    if (/FROM Event/.test(q)) return { totalSize: 2, done: true, records: [{ WhoId: "003A", ActivityDate: "2027-02-20" }, { WhoId: "003A", ActivityDate: "2027-02-25" }] };
    return [404, {}];
  });
  r = await callTool("Salesforce - Beta", "verify_activity", { emails: ["ana@acme.com"], since: "2027-02-18" });
  assert.deepEqual(r.payload.results, [{ email: "ana@acme.com", found: true, meetings: 2, lastAt: "2027-02-25" }]);
});

test("log_followups is safe to repeat: existing tasks are skipped", async () => {
  process.env.HUBSPOT_TOKEN = "test-token";
  mockFetch((u) => {
    if (u.pathname === "/crm/v3/objects/contacts/batch/read") return [207, { results: [{ id: "1", properties: { email: "ana@acme.com" } }] }];
    if (u.pathname === "/crm/v3/objects/tasks/search") return { total: 1, results: [{ id: "t0" }] };
    if (u.pathname === "/crm/v3/properties/contacts") return [409, {}];
    if (u.pathname === "/crm/v3/objects/contacts/batch/update") return { results: [] };
    return [404, {}];
  });
  const r = await callTool("HubSpot", "log_followups", { eventName: "Kitchen", items: [{ email: "ana@acme.com", subject: "Book a meeting" }] });
  assert.equal(r.payload.tasksCreated, 0);
  assert.equal(r.payload.skipped, 1);
  assert.ok(!calls.some((c) => c.url.pathname === "/crm/v3/objects/tasks"), "no new task");
  delete process.env.HUBSPOT_TOKEN;
  process.env.SF_INSTANCE_URL = "https://acme.my.salesforce.com"; process.env.SF_ACCESS_TOKEN = "tok";
  mockFetch((u, init) => {
    const q = u.searchParams.get("q") || "";
    if (/FROM Contact/.test(q)) return { totalSize: 1, done: true, records: [{ Id: "003A", Email: "ana@acme.com" }] };
    if (/FROM Lead/.test(q)) return { totalSize: 0, done: true, records: [] };
    if (/FROM Task/.test(q)) return { totalSize: 1, done: true, records: [{ WhoId: "003A", Subject: "Book a meeting (Kitchen)" }] };
    if (u.pathname.endsWith("/composite/sobjects")) return [200, []];
    return [404, {}];
  });
  const s2 = await callTool("Salesforce - Beta", "log_followups", { eventName: "Kitchen", items: [{ email: "ana@acme.com", subject: "Book a meeting" }] });
  assert.equal(s2.payload.tasksCreated, 0);
  assert.equal(s2.payload.skipped, 1);
});

test("rollup_account_spend writes account totals to the CRM", async () => {
  process.env.HUBSPOT_TOKEN = "test-token";
  mockFetch((u, init, body) => {
    if (u.pathname === "/crm/v3/properties/companies") return [409, {}];
    if (u.pathname === "/crm/v3/objects/companies/search") return body.filterGroups[0].filters[0].value === "acme.com" ? { results: [{ id: "c1" }] } : { results: [] };
    if (u.pathname === "/crm/v3/objects/companies/batch/update") return { results: body.inputs };
    return [404, {}];
  });
  const r = await callTool("HubSpot", "rollup_account_spend", { accounts: [{ name: "Acme", domain: "acme.com", spend: 1234.4, gifts: 80, events: 2 }, { name: "Nowhere", spend: 10 }] });
  assert.deepEqual(r.payload, { updated: 1, missing: ["Nowhere"], errors: [] });
  const upd = calls.find((c) => c.url.pathname === "/crm/v3/objects/companies/batch/update");
  assert.deepEqual(upd.body.inputs[0], { id: "c1", properties: { encore_event_spend: "1234", encore_gift_spend: "80", encore_events_attended: "2" } });
  delete process.env.HUBSPOT_TOKEN;
  process.env.SF_INSTANCE_URL = "https://acme.my.salesforce.com"; process.env.SF_ACCESS_TOKEN = "tok";
  mockFetch((u, init, body) => {
    const q = u.searchParams.get("q") || "";
    if (/FROM Account/.test(q)) return { totalSize: 1, done: true, records: [{ Id: "001A", Name: "Acme" }] };
    if (u.pathname.endsWith("/composite/sobjects")) return [200, body.records.map(() => ({ success: true }))];
    return [404, {}];
  });
  const s2 = await callTool("Salesforce - Beta", "rollup_account_spend", { accounts: [{ name: "Acme", spend: 500, gifts: 40, events: 1 }] });
  assert.deepEqual(s2.payload, { updated: 1, missing: [], errors: [] });
  const patchCall = calls.find((c) => c.url.pathname.endsWith("/composite/sobjects"));
  assert.equal(patchCall.body.records[0].Encore_Event_Spend__c, 500);
});
