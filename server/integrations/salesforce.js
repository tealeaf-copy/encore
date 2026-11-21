// Salesforce: read-only SOQL, event attendee sync (Campaign + CampaignMembers,
// Leads for unknown emails) and event pipeline (Opportunities). REST API with
// either a ready access token or the OAuth 2.0 client-credentials flow.
import { chunk, errText, validateMembers, validateWindow, MEMBERS_SCHEMA, PIPELINE_SCHEMA, validateFollowups, validateVerify, FOLLOWUPS_SCHEMA, VERIFY_SCHEMA } from "./crm-common.js";

const STATUS_LABELS = ["Invited", "Registered", "Attended", "Declined"];
const RESPONDED = new Set(["Registered", "Attended"]);
// Salesforce's token response has no expires_in; the lifetime is the org's
// session timeout. Refresh well inside the shortest default (15 min is the min).
const DEFAULT_TTL_MS = 10 * 60 * 1000;

function fail(message) { return { code: "tool_error", message: `Salesforce: ${message}` }; }
const instance = () => String(process.env.SF_INSTANCE_URL || "").replace(/\/+$/, "");
const version = () => process.env.SF_API_VERSION || "v61.0";

let cached = null; // { key, token, exp }
export function _resetTokenCache() { cached = null; }

async function getToken({ fresh = false } = {}) {
  if (process.env.SF_ACCESS_TOKEN) return process.env.SF_ACCESS_TOKEN;
  const key = `${instance()}|${process.env.SF_CLIENT_ID}`;
  if (!fresh && cached && cached.key === key && cached.exp > Date.now()) return cached.token;
  let res;
  try { res = await fetch(`${instance()}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: process.env.SF_CLIENT_ID, client_secret: process.env.SF_CLIENT_SECRET }).toString(),
  }); } catch (e) { throw fail(`can't reach ${instance()} (${errText(e)})`); }
  let json = null;
  try { json = await res.json(); } catch {}
  if (!res.ok || !json?.access_token) throw fail(`token request failed: ${json?.error_description || json?.error || `HTTP ${res.status}`}`);
  const ttl = +json.expires_in > 0 ? json.expires_in * 1000 - 60000 : DEFAULT_TTL_MS;
  cached = { key, token: json.access_token, exp: Date.now() + ttl };
  return cached.token;
}

async function sf(method, path, body, retried = false) {
  const url = path.startsWith("/services/") ? instance() + path : `${instance()}/services/data/${version()}${path}`;
  const init = { method, headers: { Authorization: `Bearer ${await getToken()}`, Accept: "application/json" } };
  if (body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(url, init); } catch (e) { throw fail(`can't reach ${instance()} (${errText(e)})`); }
  if (res.status === 401 && !retried && !process.env.SF_ACCESS_TOKEN) { cached = null; return sf(method, path, body, true); }
  if (res.status === 204) return null;
  let json = null;
  try { json = await res.json(); } catch {}
  if (!res.ok) {
    const msg = Array.isArray(json) ? json.map((e) => e.message).join("; ") : json?.message;
    throw fail(msg || `${method} ${path.split("?")[0]} HTTP ${res.status}`);
  }
  return json;
}

/** Remove Salesforce's `attributes` blocks, including on related records. */
export function strip(v) {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (k !== "attributes") o[k] = strip(x);
    if (Array.isArray(v.records)) return strip(v.records); // nested sub-query results
    return o;
  }
  return v;
}

/** Allow only a single SELECT statement (optionally with one trailing semicolon). */
export function checkSoql(soql) {
  let q = String(soql || "").trim().replace(/;\s*$/, "");
  const noStrings = q.replace(/'(?:\\.|[^'\\])*'/g, "''");
  if (!/^select\s/i.test(q) || noStrings.includes(";")) throw fail("only a single SELECT statement is allowed");
  return q;
}

const lit = (s) => `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const inList = (arr) => `(${arr.map(lit).join(",")})`;

async function query(soql, maxPages = 20) {
  let r = await sf("GET", `/query?q=${encodeURIComponent(soql)}`);
  const out = [...(r.records || [])];
  for (let i = 1; r.nextRecordsUrl && i < maxPages; i++) {
    r = await sf("GET", r.nextRecordsUrl);
    out.push(...(r.records || []));
  }
  return strip(out);
}

async function dispatchReadonly(input) {
  const q = checkSoql(input?.soql);
  const records = await query(q);
  return { totalSize: records.length, records };
}

/** sObject Collections create/update, 200 per call; returns the per-record results. */
async function collection(method, records) {
  const results = [];
  for (const part of chunk(records, 200)) {
    const r = await sf(method, "/composite/sobjects", { allOrNone: false, records: part });
    results.push(...(r || []));
  }
  return results;
}
const collErrors = (r) => (r.errors || []).map((e) => e.message).join("; ") || "failed";

async function findCampaign(eventName) {
  const name = `Event: ${eventName}`.slice(0, 80);
  const [c] = await query(`SELECT Id FROM Campaign WHERE Name = ${lit(name)} ORDER BY CreatedDate DESC LIMIT 1`);
  return { name, id: c?.Id || null };
}

async function lookupPeople(emails) {
  const contacts = new Map(), leads = new Map();
  for (const part of chunk(emails, 200)) {
    for (const c of await query(`SELECT Id, Email, AccountId, Account.Name FROM Contact WHERE Email IN ${inList(part)}`)) {
      const e = String(c.Email || "").toLowerCase();
      if (!contacts.has(e)) contacts.set(e, c);
    }
  }
  const rest = emails.filter((e) => !contacts.has(e));
  for (const part of chunk(rest, 200)) {
    for (const l of await query(`SELECT Id, Email FROM Lead WHERE Email IN ${inList(part)} AND IsConverted = false`)) {
      const e = String(l.Email || "").toLowerCase();
      if (!leads.has(e)) leads.set(e, l);
    }
  }
  return { contacts, leads };
}

async function logFollowups(input) {
  const { eventName, items } = validateFollowups(input, "Salesforce");
  const { contacts, leads } = await lookupPeople(items.map((i) => i.email));
  const errors = [], missing = [], records = [];
  for (const it of items) {
    const who = contacts.get(it.email) || leads.get(it.email);
    if (!who) { missing.push(it.email); continue; }
    const desc = [it.body, it.gift || it.giftCost ? `Gift: ${it.gift || "gift"}${it.giftCost ? ` ($${it.giftCost})` : ""}` : ""].filter(Boolean).join("\n\n");
    records.push({ attributes: { type: "Task" }, WhoId: who.Id, Subject: `${it.subject} (${eventName})`.slice(0, 255), Description: desc.slice(0, 32000), ActivityDate: it.dueDate || new Date().toISOString().slice(0, 10), Status: "Not Started", Priority: "High" });
  }
  let tasksCreated = 0;
  if (records.length) {
    const res = await collection("POST", records);
    res.forEach((r, i) => { if (r.success) tasksCreated++; else errors.push(`task ${records[i].WhoId}: ${collErrors(r)}`); });
  }
  // Reportable fields, if the org has them: Encore_Gift_Cost__c, Encore_Gift_Status__c, Encore_Last_Event__c on Contact.
  const fieldErrors = [], ups = [];
  for (const it of items) {
    const c = contacts.get(it.email); if (!c) continue;
    ups.push({ attributes: { type: "Contact" }, Id: c.Id, Encore_Last_Event__c: eventName.slice(0, 255), ...(it.giftCost ? { Encore_Gift_Cost__c: it.giftCost } : {}), ...(it.giftStatus ? { Encore_Gift_Status__c: it.giftStatus } : {}) });
  }
  if (ups.length) {
    try {
      const res = await collection("PATCH", ups);
      const bad = res.filter((r) => !r.success);
      if (bad.length) fieldErrors.push(/INVALID_FIELD|No such column/i.test(collErrors(bad[0])) ? "add the Encore_Gift_Cost__c, Encore_Gift_Status__c and Encore_Last_Event__c fields on Contact to report spend in Salesforce" : collErrors(bad[0]));
    } catch (e) { fieldErrors.push(errText(e)); }
  }
  const written = items.map((i) => { const c = contacts.get(i.email), l = leads.get(i.email); return c ? { email: i.email, recordType: "contact", id: c.Id } : l ? { email: i.email, recordType: "lead", id: l.Id } : null; }).filter(Boolean);
  return { tasksCreated, missing, written, fieldErrors, errors };
}

async function verifyActivity(input) {
  const { emails, since } = validateVerify(input, "Salesforce");
  const { contacts, leads } = await lookupPeople(emails);
  const who = new Map([...contacts, ...leads].map(([e, r]) => [r.Id, e])), ids = [...who.keys()];
  const counts = new Map();
  for (const part of chunk(ids, 200)) {
    for (const ev of await query(`SELECT WhoId, ActivityDate FROM Event WHERE WhoId IN ${inList(part)} AND ActivityDate >= ${since}`)) {
      const e = who.get(ev.WhoId), c = counts.get(e) || { n: 0, last: null };
      c.n++; if (!c.last || ev.ActivityDate > c.last) c.last = ev.ActivityDate; counts.set(e, c);
    }
  }
  return { results: emails.map((email) => ({ email, found: contacts.has(email) || leads.has(email), meetings: counts.get(email)?.n || 0, lastAt: counts.get(email)?.last || null })) };
}

async function upsertEventAttendees(input) {
  const { eventName, eventDate, members } = validateMembers(input, "Salesforce");
  const errors = [];
  let { id: campaignId, name } = await findCampaign(eventName);
  if (!campaignId) {
    const r = await sf("POST", "/sobjects/Campaign", { Name: name, StartDate: eventDate, Type: "Event", IsActive: true });
    campaignId = r.id;
  }

  const have = await query(`SELECT Id, Label, SortOrder FROM CampaignMemberStatus WHERE CampaignId = ${lit(campaignId)}`);
  const labels = new Set(have.map((s) => s.Label));
  let sort = Math.max(0, ...have.map((s) => +s.SortOrder || 0));
  const missing = STATUS_LABELS.filter((l) => !labels.has(l)).map((Label) => ({
    attributes: { type: "CampaignMemberStatus" }, CampaignId: campaignId, Label, HasResponded: RESPONDED.has(Label), SortOrder: ++sort,
  }));
  if (missing.length) {
    try {
      (await collection("POST", missing)).forEach((r, i) => { if (!r.success) errors.push(`status ${missing[i].Label}: ${collErrors(r)}`); });
    } catch (e) { errors.push(`statuses: ${errText(e)}`); }
  }

  const { contacts, leads } = await lookupPeople(members.map((m) => m.email));
  const newLeads = members.filter((m) => !contacts.has(m.email) && !leads.has(m.email));
  let leadsCreated = 0;
  if (newLeads.length) {
    const recs = newLeads.map((m) => ({
      attributes: { type: "Lead" }, Email: m.email,
      FirstName: m.firstName || undefined,
      LastName: m.lastName || m.firstName || m.email.split("@")[0],
      Company: m.company || "Unknown", Title: m.title || undefined, LeadSource: "Event",
    }));
    (await collection("POST", recs)).forEach((r, i) => {
      if (r.success) { leads.set(newLeads[i].email, { Id: r.id }); leadsCreated++; }
      else errors.push(`lead ${newLeads[i].email}: ${collErrors(r)}`);
    });
  }

  const existing = await query(`SELECT Id, ContactId, LeadId FROM CampaignMember WHERE CampaignId = ${lit(campaignId)}`);
  const byPerson = new Map(existing.map((cm) => [cm.ContactId || cm.LeadId, cm.Id]));
  const creates = [], updates = [], createFor = [], updateFor = [];
  for (const m of members) {
    const c = contacts.get(m.email), l = leads.get(m.email);
    if (!c && !l) continue;
    const pid = c?.Id || l.Id, cmId = byPerson.get(pid);
    if (cmId) { updates.push({ attributes: { type: "CampaignMember" }, Id: cmId, Status: m.status }); updateFor.push(m.email); }
    else { creates.push({ attributes: { type: "CampaignMember" }, CampaignId: campaignId, ...(c ? { ContactId: c.Id } : { LeadId: l.Id }), Status: m.status }); createFor.push(m.email); }
  }
  let membersUpserted = 0;
  const tally = (results, who) => results.forEach((r, i) => { if (r.success) membersUpserted++; else errors.push(`member ${who[i]}: ${collErrors(r)}`); });
  if (creates.length) tally(await collection("POST", creates), createFor);
  if (updates.length) tally(await collection("PATCH", updates), updateFor);
  return { campaignId, membersUpserted, leadsCreated, errors };
}

async function eventPipeline(input) {
  const { emails, inWindow } = validateWindow(input, "Salesforce");
  if (!emails.length) return [];
  const { contacts } = await lookupPeople(emails);
  const contactIds = [...contacts.values()].map((c) => c.Id);
  const emailByContact = new Map([...contacts].map(([e, c]) => [c.Id, e]));
  const emailByAccount = new Map();
  for (const [e, c] of contacts) if (c.AccountId && !emailByAccount.has(c.AccountId)) emailByAccount.set(c.AccountId, e);
  const accountIds = [...emailByAccount.keys()];

  const roleEmail = new Map(); // OpportunityId -> contact email
  for (const part of chunk(contactIds, 200)) {
    for (const r of await query(`SELECT OpportunityId, ContactId FROM OpportunityContactRole WHERE ContactId IN ${inList(part)}`)) {
      if (!roleEmail.has(r.OpportunityId)) roleEmail.set(r.OpportunityId, emailByContact.get(r.ContactId));
    }
  }
  const campaignId = input.campaignId || (input.eventName ? (await findCampaign(String(input.eventName))).id : null);

  const since = `${input.since}T00:00:00Z`;
  const fields = "Id, Name, Amount, StageName, CreatedDate, LastStageChangeDate, CampaignId, AccountId, Account.Name";
  const seen = new Map();
  const run = async (where) => {
    for (const o of await query(`SELECT ${fields} FROM Opportunity WHERE (${where}) AND (CreatedDate >= ${since} OR LastModifiedDate >= ${since})`)) seen.set(o.Id, o);
  };
  for (const part of chunk(accountIds, 200)) await run(`AccountId IN ${inList(part)}`);
  for (const part of chunk([...roleEmail.keys()], 200)) await run(`Id IN ${inList(part)}`);
  if (campaignId) await run(`CampaignId = ${lit(campaignId)}`);

  const out = [];
  for (const o of seen.values()) {
    if (!inWindow(o.CreatedDate) && !inWindow(o.LastStageChangeDate)) continue;
    out.push({
      dealId: o.Id, name: o.Name || "", amount: +o.Amount || 0, stage: o.StageName || "",
      createdate: o.CreatedDate || "", lastStageChange: o.LastStageChangeDate || "",
      contactEmail: roleEmail.get(o.Id) || emailByAccount.get(o.AccountId) || "",
      company: o.Account?.Name || "",
      ...(campaignId ? { campaignSourced: o.CampaignId === campaignId } : {}),
    });
  }
  return out;
}

export default function salesforce() {
  if (!process.env.SF_INSTANCE_URL) return null;
  if (!process.env.SF_ACCESS_TOKEN && !(process.env.SF_CLIENT_ID && process.env.SF_CLIENT_SECRET)) return null;
  return {
    server: "Salesforce - Beta",
    tools: [
      {
        name: "dispatch_readonly",
        description: "Run a read-only SOQL SELECT query against Salesforce (accounts, contacts, opportunities, campaigns, activity).",
        inputSchema: { type: "object", properties: { soql: { type: "string", description: "A single SOQL SELECT statement" } }, required: ["soql"] },
        run: dispatchReadonly,
      },
      {
        name: "upsert_event_attendees",
        description: "Find or create the event's Campaign, match guests to Contacts or Leads by email (creating Leads), and upsert CampaignMembers with their status.",
        inputSchema: MEMBERS_SCHEMA,
        run: upsertEventAttendees,
      },
      {
        name: "event_pipeline",
        description: "Opportunities on these contacts' accounts or contact roles, created or changed stage in the date window.",
        inputSchema: PIPELINE_SCHEMA,
        run: eventPipeline,
      },
      {
        name: "log_followups",
        description: "Create a Salesforce Task on each attendee's Contact or Lead for their AE-approved next step, with any gift and its cost in the description.",
        inputSchema: FOLLOWUPS_SCHEMA,
        run: logFollowups,
      },
      {
        name: "verify_activity",
        description: "For each email, count Salesforce Events (meetings) on the Contact or Lead since a date, so 'next step happened' is checked against the CRM.",
        inputSchema: VERIFY_SCHEMA,
        run: verifyActivity,
      },
    ],
  };
}
