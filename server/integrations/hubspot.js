// HubSpot: CRM search, event attendee sync (contacts + marketing event states)
// and event pipeline (deals associated with attendees). Private app token.
import { chunk, errText, validateMembers, validateWindow, validateFollowups, validateVerify, validateRollup, MEMBERS_SCHEMA, PIPELINE_SCHEMA, FOLLOWUPS_SCHEMA, VERIFY_SCHEMA, ROLLUP_SCHEMA } from "./crm-common.js";

import { crmToken } from "./context.js";

const API = "https://api.hubapi.com";
const OBJECT_TYPES = ["contacts", "companies", "deals"];
// Our member status -> HubSpot marketing event subscriber states to record.
// Invited has no HubSpot state: the contact is upserted only.
const STATES = { Registered: ["register"], Attended: ["register", "attend"], Declined: ["cancel"], Invited: [] };
export const EXTERNAL_ACCOUNT_ID = "encore";

function fail(message) { return { code: "tool_error", message: `HubSpot: ${message}` }; }

async function hs(method, path, body, { allow = [] } = {}) {
  // The caller's workspace connection when there is one (see context.js), else this server's HUBSPOT_TOKEN.
  const token = crmToken("hubspot", process.env.HUBSPOT_TOKEN);
  if (!token) throw fail("not connected");
  const init = { method, headers: { Authorization: `Bearer ${token}` } };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let res;
  try { res = await fetch(API + path, init); } catch (e) { throw fail(`can't reach api.hubapi.com (${errText(e)})`); }
  let json = null;
  try { json = await res.json(); } catch {}
  if (!res.ok && !allow.includes(res.status)) {
    const err = fail(json?.message || `${method} ${path.split("?")[0]} HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return { status: res.status, json };
}

export function slug(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}
export function externalEventId(eventName, eventDate) { return `${slug(eventName) || "event"}-${eventDate}`; }

async function searchCrmObjects(input) {
  const objectType = input?.objectType;
  if (!OBJECT_TYPES.includes(objectType)) throw fail(`objectType must be one of ${OBJECT_TYPES.join(", ")}`);
  const limit = Math.max(1, Math.min(50, Math.floor(+input.limit || 10)));
  const filters = (Array.isArray(input.filters) ? input.filters : []).map((f) => {
    if (!f?.propertyName || !f?.operator) throw fail("each filter needs propertyName and operator");
    const out = { propertyName: String(f.propertyName), operator: String(f.operator) };
    if (Array.isArray(f.value)) out.values = f.value.map(String);
    else if (f.value !== undefined && f.value !== null) out.value = String(f.value);
    return out;
  });
  const body = { limit };
  if (filters.length) body.filterGroups = [{ filters }];
  if (input.query) body.query = String(input.query);
  if (Array.isArray(input.properties) && input.properties.length) body.properties = input.properties.map(String);
  const { json } = await hs("POST", `/crm/v3/objects/${objectType}/search`, body);
  return {
    total: json?.total ?? 0,
    results: (json?.results || []).map((r) => ({ id: r.id, ...(r.properties || {}) })),
  };
}

/** The body for POST /crm/v3/objects/contacts/batch/upsert. */
export function contactUpsertBody(members) {
  return {
    inputs: members.map((m) => {
      const properties = { email: m.email };
      if (m.firstName) properties.firstname = String(m.firstName);
      if (m.lastName) properties.lastname = String(m.lastName);
      if (m.company) properties.company = String(m.company);
      if (m.title) properties.jobtitle = String(m.title);
      return { idProperty: "email", id: m.email, properties };
    }),
  };
}

/** Group member emails by the subscriber state(s) their status maps to. */
export function statesByMember(members) {
  const out = { register: [], attend: [], cancel: [] };
  for (const m of members) for (const s of STATES[m.status] || []) out[s].push(m.email);
  return out;
}

async function recordStates(extId, state, emails, at) {
  const q = `?externalAccountId=${EXTERNAL_ACCOUNT_ID}`;
  const body = { inputs: emails.map((email) => ({ email, interactionDateTime: at })) };
  const ev = encodeURIComponent(extId);
  // Documented v3 endpoint; HubSpot has announced it is being replaced by
  // attendance/.../email-create, so fall back to that if it is gone.
  const r = await hs("POST", `/marketing/v3/marketing-events/events/${ev}/${state}/email-upsert${q}`, body, { allow: [404, 410] });
  if (r.status === 404 || r.status === 410) {
    await hs("POST", `/marketing/v3/marketing-events/attendance/${ev}/${state}/email-create${q}`, body);
  }
}

async function upsertEventAttendees(input) {
  const { eventName, eventDate, members } = validateMembers(input, "HubSpot");
  const errors = [];
  let contactsUpserted = 0;
  for (const part of chunk(members, 100)) {
    try {
      const { json } = await hs("POST", "/crm/v3/objects/contacts/batch/upsert", contactUpsertBody(part));
      contactsUpserted += json?.results?.length ?? 0;
      for (const e of json?.errors || []) errors.push(`contacts: ${e.message || e.category || "error"}`);
    } catch (e) { errors.push(`contacts: ${errText(e)}`); }
  }

  const extId = externalEventId(eventName, eventDate);
  const start = new Date(eventDate + "T12:00:00Z").toISOString();
  let eventId = null;
  try {
    const { json } = await hs("PUT", `/marketing/v3/marketing-events/events/${encodeURIComponent(extId)}`, {
      externalAccountId: EXTERNAL_ACCOUNT_ID,
      externalEventId: extId,
      eventName,
      eventOrganizer: process.env.HUBSPOT_EVENT_ORGANIZER || "Encore",
      eventType: "Field event",
      startDateTime: start,
      customProperties: [],
    });
    eventId = json?.objectId || json?.id || extId;
  } catch (e) { errors.push(`marketing event: ${errText(e)}`); }

  let statusesRecorded = 0;
  if (eventId) {
    const groups = statesByMember(members);
    const now = Date.now(), eventAt = Date.parse(start);
    for (const state of ["register", "attend", "cancel"]) {
      for (const part of chunk(groups[state], 100)) {
        try {
          await recordStates(extId, state, part, state === "attend" ? eventAt : now);
          statusesRecorded += part.length;
        } catch (e) { errors.push(`${state}: ${errText(e)}`); }
      }
    }
  }
  return { contactsUpserted, eventId, externalEventId: extId, statusesRecorded, errors };
}

async function eventPipeline(input) {
  const { emails, inWindow } = validateWindow(input, "HubSpot");
  if (!emails.length) return [];
  const contacts = [];
  for (const part of chunk(emails, 100)) {
    const { json } = await hs("POST", "/crm/v3/objects/contacts/batch/read", {
      idProperty: "email", inputs: part.map((id) => ({ id })), properties: ["email", "company"],
    });
    contacts.push(...(json?.results || []));
  }
  const byId = new Map(contacts.map((c) => [String(c.id), c.properties || {}]));
  const dealContact = new Map();
  for (const part of chunk([...byId.keys()], 1000)) {
    const { json } = await hs("POST", "/crm/v4/associations/contacts/deals/batch/read", { inputs: part.map((id) => ({ id })) });
    for (const r of json?.results || []) {
      for (const t of r.to || []) {
        const dealId = String(t.toObjectId);
        if (!dealContact.has(dealId)) dealContact.set(dealId, String(r.from?.id));
      }
    }
  }
  const deals = [];
  for (const part of chunk([...dealContact.keys()], 100)) {
    const { json } = await hs("POST", "/crm/v3/objects/deals/batch/read", {
      inputs: part.map((id) => ({ id })),
      properties: ["dealname", "amount", "dealstage", "createdate", "hs_lastmodifieddate", "hs_v2_date_entered_current_stage"],
    });
    deals.push(...(json?.results || []));
  }
  const out = [];
  for (const d of deals) {
    const p = d.properties || {};
    const lastStageChange = p.hs_v2_date_entered_current_stage || p.hs_lastmodifieddate || "";
    if (!inWindow(p.createdate) && !inWindow(lastStageChange)) continue;
    const c = byId.get(dealContact.get(String(d.id))) || {};
    out.push({
      dealId: String(d.id), name: p.dealname || "", amount: +p.amount || 0, stage: p.dealstage || "",
      createdate: p.createdate || "", lastStageChange, contactEmail: c.email || "", company: c.company || "",
    });
  }
  return out;
}

// HubSpot-defined association type ids: task -> contact, note -> contact.
const TASK_TO_CONTACT = 204, NOTE_TO_CONTACT = 202;

async function logFollowups(input) {
  const { eventName, items } = validateFollowups(input, "HubSpot");
  const errors = [], ids = new Map();
  for (const part of chunk(items, 100)) {
    try {
      const { json } = await hs("POST", "/crm/v3/objects/contacts/batch/read", { idProperty: "email", properties: ["email"], inputs: part.map((i) => ({ id: i.email })) }, { allow: [207] });
      for (const c of json?.results || []) ids.set(String(c.properties?.email || "").toLowerCase(), c.id);
    } catch (e) { errors.push(`contacts: ${errText(e)}`); }
  }
  let tasksCreated = 0, notesCreated = 0, skipped = 0;
  const missing = items.filter((i) => !ids.has(i.email)).map((i) => i.email);
  for (const it of items) {
    const id = ids.get(it.email); if (!id) continue;
    const due = new Date((it.dueDate || new Date().toISOString().slice(0, 10)) + "T17:00:00Z").toISOString();
    const subject = `${it.subject} (${eventName})`.slice(0, 250);
    // Safe to repeat: skip if this contact already has a task with the same subject.
    try {
      const { json } = await hs("POST", "/crm/v3/objects/tasks/search", { filterGroups: [{ filters: [{ propertyName: "associations.contact", operator: "EQ", value: id }, { propertyName: "hs_task_subject", operator: "EQ", value: subject }] }], limit: 1 });
      if ((json?.total || json?.results?.length || 0) > 0) { skipped++; continue; }
    } catch (e) { errors.push(`task check ${it.email}: ${errText(e)}`); continue; }
    try {
      await hs("POST", "/crm/v3/objects/tasks", {
        properties: { hs_timestamp: due, hs_task_subject: `${it.subject} (${eventName})`.slice(0, 250), hs_task_body: it.body, hs_task_status: "NOT_STARTED", hs_task_priority: "HIGH" },
        associations: [{ to: { id }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: TASK_TO_CONTACT }] }],
      });
      tasksCreated++;
    } catch (e) { errors.push(`task ${it.email}: ${errText(e)}`); }
    if (it.gift || it.giftCost) {
      try {
        await hs("POST", "/crm/v3/objects/notes", {
          properties: { hs_timestamp: new Date().toISOString(), hs_note_body: `Gift from ${eventName}: ${it.gift || "gift"}${it.giftCost ? ` ($${it.giftCost})` : ""}` },
          associations: [{ to: { id }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: NOTE_TO_CONTACT }] }],
        });
        notesCreated++;
      } catch (e) { errors.push(`note ${it.email}: ${errText(e)}`); }
    }
  }
  // Reportable fields on the contact, so RevOps can report spend per contact and account in HubSpot itself.
  const fieldErrors = [];
  const props = [["encore_last_event", "Encore: last event", "string", "text"], ["encore_gift_cost", "Encore: gift landed cost", "number", "number"], ["encore_gift_status", "Encore: gift status", "string", "text"], ["encore_event_cost_per_head", "Encore: event cost per head", "number", "number"]];
  for (const [name, label, type, fieldType] of props) {
    try { await hs("POST", "/crm/v3/properties/contacts", { name, label, type, fieldType, groupName: "contactinformation" }, { allow: [409] }); }
    catch (e) { fieldErrors.push(`property ${name}: ${errText(e)}`); }
  }
  const updates = items.filter((i) => ids.has(i.email)).map((i) => ({ id: ids.get(i.email), properties: {
    encore_last_event: eventName, ...(i.giftCost ? { encore_gift_cost: String(i.giftCost) } : {}), ...(i.giftStatus ? { encore_gift_status: i.giftStatus } : {}), ...(i.eventCostPerHead ? { encore_event_cost_per_head: String(i.eventCostPerHead) } : {}) } }));
  for (const part of chunk(updates, 100)) {
    try { await hs("POST", "/crm/v3/objects/contacts/batch/update", { inputs: part }); } catch (e) { fieldErrors.push(`contact fields: ${errText(e)}`); }
  }
  const written = items.filter((i) => ids.has(i.email)).map((i) => ({ email: i.email, recordType: "contact", id: ids.get(i.email) }));
  return { tasksCreated, notesCreated, skipped, missing, written, fieldErrors, errors };
}

// Did a meeting actually happen? Meetings associated with each contact since a date.
async function verifyActivity(input) {
  const { emails, since } = validateVerify(input, "HubSpot");
  const ids = new Map(), from = Date.parse(since + "T00:00:00Z");
  for (const part of chunk(emails, 100)) {
    const { json } = await hs("POST", "/crm/v3/objects/contacts/batch/read", { idProperty: "email", properties: ["email"], inputs: part.map((e) => ({ id: e })) }, { allow: [207] });
    for (const c of json?.results || []) ids.set(String(c.properties?.email || "").toLowerCase(), c.id);
  }
  const results = [];
  for (const email of emails) {
    const id = ids.get(email);
    if (!id) { results.push({ email, found: false, meetings: 0 }); continue; }
    const { json } = await hs("POST", "/crm/v3/objects/meetings/search", { filterGroups: [{ filters: [{ propertyName: "associations.contact", operator: "EQ", value: id }, { propertyName: "hs_timestamp", operator: "GTE", value: String(from) }] }], properties: ["hs_timestamp", "hs_meeting_title"], limit: 20 });
    const rows = json?.results || [];
    results.push({ email, found: true, meetings: rows.length, lastAt: rows.map((r) => r.properties?.hs_timestamp).filter(Boolean).sort().pop() || null });
  }
  return { results };
}

// Account-level spend, so RevOps can report event spend next to pipeline on the company record.
async function rollupAccountSpend(input) {
  const { accounts } = validateRollup(input, "HubSpot");
  const errors = [], missing = [], inputs = [];
  for (const [name, label] of [["encore_event_spend", "Encore: event spend (USD)"], ["encore_gift_spend", "Encore: gift spend, landed (USD)"], ["encore_events_attended", "Encore: events attended"]]) {
    try { await hs("POST", "/crm/v3/properties/companies", { name, label, type: "number", fieldType: "number", groupName: "companyinformation" }, { allow: [409] }); }
    catch (e) { errors.push(`property ${name}: ${errText(e)}`); }
  }
  for (const a of accounts) {
    try {
      const filters = a.domain ? [{ propertyName: "domain", operator: "EQ", value: a.domain }] : [{ propertyName: "name", operator: "EQ", value: a.name }];
      const { json } = await hs("POST", "/crm/v3/objects/companies/search", { filterGroups: [{ filters }], properties: ["name", "domain"], limit: 2 });
      const rows = json?.results || [];
      if (!rows.length) { missing.push(a.name); continue; }
      if (rows.length > 1) errors.push(`${a.name}: more than one company matched; updated the first`);
      inputs.push({ id: rows[0].id, properties: { encore_event_spend: String(a.spend), encore_gift_spend: String(a.gifts), encore_events_attended: String(a.events) } });
    } catch (e) { errors.push(`${a.name}: ${errText(e)}`); }
  }
  let updated = 0;
  for (const part of chunk(inputs, 100)) {
    try { const { json } = await hs("POST", "/crm/v3/objects/companies/batch/update", { inputs: part }); updated += json?.results?.length ?? part.length; }
    catch (e) { errors.push(`update: ${errText(e)}`); }
  }
  return { updated, missing, errors };
}

/** force: list the tools even without HUBSPOT_TOKEN (a workspace brings its own token). */
export default function hubspot({ force = false } = {}) {
  if (!force && !process.env.HUBSPOT_TOKEN) return null;
  return {
    server: "HubSpot",
    tools: [
      {
        name: "search_crm_objects",
        description: "Search HubSpot CRM contacts, companies or deals by text query and/or property filters.",
        inputSchema: {
          type: "object",
          properties: {
            objectType: { type: "string", enum: OBJECT_TYPES },
            query: { type: "string", description: "Free-text search" },
            filters: {
              type: "array",
              items: {
                type: "object",
                properties: { propertyName: { type: "string" }, operator: { type: "string", description: "EQ, NEQ, GT, LT, CONTAINS_TOKEN, IN, ..." }, value: {} },
                required: ["propertyName", "operator"],
              },
            },
            properties: { type: "array", items: { type: "string" } },
            limit: { type: "number", description: "max 50" },
          },
          required: ["objectType"],
        },
        run: searchCrmObjects,
      },
      {
        name: "upsert_event_attendees",
        description: "Upsert event guests as HubSpot contacts (by email), create or update the marketing event, and record registered/attended/cancelled states.",
        inputSchema: MEMBERS_SCHEMA,
        run: upsertEventAttendees,
      },
      {
        name: "event_pipeline",
        description: "Deals associated with these contacts that were created or changed stage in the date window.",
        inputSchema: PIPELINE_SCHEMA,
        run: eventPipeline,
      },
      {
        name: "log_followups",
        description: "Create a HubSpot task on each attendee's contact for their AE-approved next step, plus a note recording any gift and its cost.",
        inputSchema: FOLLOWUPS_SCHEMA,
        run: logFollowups,
      },
      {
        name: "verify_activity",
        description: "For each email, count meetings logged on the HubSpot contact since a date, so 'next step happened' is checked against the CRM.",
        inputSchema: VERIFY_SCHEMA,
        run: verifyActivity,
      },
      {
        name: "rollup_account_spend",
        description: "Write total event spend, landed gift spend and events attended onto each HubSpot company (by domain, else name).",
        inputSchema: ROLLUP_SCHEMA,
        run: rollupAccountSpend,
      },
    ],
  };
}
