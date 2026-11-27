// CRM sync for campaigns (beta): a small adapter layer for HubSpot and Salesforce, next to the CSV export.
//
// One adapter per CRM. Each one knows its OAuth settings (read from env vars, never stored in the repo), the fields
// a brand can map to, a default mapping, and how to turn mapped records into that CRM's request body. Nothing here
// talks to the network by itself: sync() takes a transport, so tests and development use fakeTransport() and the
// server only uses fetch when the brand has connected and ENCORE_FAKE_CRM is off.
//
// Rules kept here and tested (test/brand-panel.test.js):
//   - consent only: a guest goes to the CRM only when they said yes to sharing their details with this brand
//   - never feedback: survey answers, quotes, "would go again" and connections never leave Pottery Lab
//   - a dry run shows exactly what would be sent (counts, the first rows and the request body) and sends nothing
//
// Setup is in docs/crm-sync.md. Until it has been run against live accounts this is marked "beta" in the product.
import crypto from "node:crypto";
import { contactUpsertBody } from "./integrations/hubspot.js";

const lc = (s) => String(s || "").trim().toLowerCase();
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const isoDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

/** What a brand can send, from its own records. Feedback fields are left out on purpose. */
export const SOURCE_FIELDS = [
  { k: "email", label: "Email" }, { k: "firstName", label: "First name" }, { k: "lastName", label: "Last name" }, { k: "company", label: "Company" },
  { k: "title", label: "Title" }, { k: "campaign", label: "Campaign" }, { k: "event", label: "Event" }, { k: "eventDate", label: "Event date" },
  { k: "host", label: "Host" }, { k: "reply", label: "Reply" }, { k: "attended", label: "Attended" }, { k: "seat", label: "Seat from" },
  { k: "followUp", label: "Follow-up" }, { k: "consentAt", label: "Consent given" },
];
const NEVER = ["said", "again", "quoteOk", "survey", "useful", "back", "before", "after", "connections"];

export const PROVIDERS = {
  hubspot: {
    id: "hubspot", label: "HubSpot", beta: true, object: "Contacts",
    env: { clientId: "HUBSPOT_CLIENT_ID", clientSecret: "HUBSPOT_CLIENT_SECRET", redirect: "HUBSPOT_REDIRECT_URI" },
    authorize: "https://app.hubspot.com/oauth/authorize", token: "https://api.hubapi.com/oauth/v1/token", scopes: ["crm.objects.contacts.write", "crm.objects.contacts.read"],
    fields: ["email", "firstname", "lastname", "company", "jobtitle", "pottery_lab_campaign", "pottery_lab_event", "pottery_lab_event_date", "pottery_lab_host", "pottery_lab_reply", "pottery_lab_attended", "pottery_lab_seat", "pottery_lab_follow_up", "pottery_lab_consent_date"],
    defaults: { email: "email", firstName: "firstname", lastName: "lastname", company: "company", title: "jobtitle", campaign: "pottery_lab_campaign", event: "pottery_lab_event", eventDate: "pottery_lab_event_date", attended: "pottery_lab_attended" },
    required: ["email"],
  },
  salesforce: {
    id: "salesforce", label: "Salesforce", beta: true, object: "Leads",
    env: { clientId: "SF_CLIENT_ID", clientSecret: "SF_CLIENT_SECRET", redirect: "SF_REDIRECT_URI", login: "SF_LOGIN_URL" },
    authorize: "/services/oauth2/authorize", token: "/services/oauth2/token", scopes: ["api", "refresh_token"],
    fields: ["Email", "FirstName", "LastName", "Company", "Title", "LeadSource", "Pottery_Lab_Campaign__c", "Pottery_Lab_Event__c", "Pottery_Lab_Event_Date__c", "Pottery_Lab_Host__c", "Pottery_Lab_Reply__c", "Pottery_Lab_Attended__c", "Pottery_Lab_Seat__c", "Pottery_Lab_Follow_Up__c", "Pottery_Lab_Consent_Date__c"],
    defaults: { email: "Email", firstName: "FirstName", lastName: "LastName", company: "Company", title: "Title", campaign: "Pottery_Lab_Campaign__c", event: "Pottery_Lab_Event__c", eventDate: "Pottery_Lab_Event_Date__c", attended: "Pottery_Lab_Attended__c" },
    required: ["email", "lastName", "company"],
  },
};

/** Is this CRM set up on this server? Which env vars are missing, and the URL that starts OAuth. */
export function configFor(id, env = process.env) {
  const P = PROVIDERS[id]; if (!P) return null;
  const v = Object.fromEntries(Object.entries(P.env).map(([k, name]) => [k, String(env[name] || "")]));
  const missing = Object.entries(P.env).filter(([k]) => k !== "login" && !v[k]).map(([, name]) => name);
  const fake = env.ENCORE_FAKE_CRM === "1";
  const base = id === "salesforce" ? (v.login || "https://login.salesforce.com").replace(/\/$/, "") : "";
  const authorizeUrl = (state) => { if (missing.length && !fake) return ""; const u = new URL(id === "salesforce" ? base + P.authorize : P.authorize);
    u.searchParams.set("client_id", v.clientId || "fake-client"); u.searchParams.set("redirect_uri", v.redirect || "/api/crm/" + id + "/callback"); u.searchParams.set("response_type", "code"); u.searchParams.set("scope", P.scopes.join(" ")); u.searchParams.set("state", state); return u.toString(); };
  return { id, label: P.label, beta: P.beta, configured: !missing.length, fake, missing, authorizeUrl, tokenUrl: id === "salesforce" ? base + P.token : P.token, clientId: v.clientId, clientSecret: v.clientSecret, redirect: v.redirect };
}

/** A mapping the brand saved, checked against the CRM's fields; anything unknown falls back to the default. */
export function cleanMapping(id, m = {}) {
  const P = PROVIDERS[id]; if (!P) return {};
  const out = {};
  for (const f of SOURCE_FIELDS) { const to = m[f.k]; if (to === "" || to === null) { if (!P.required.includes(f.k)) out[f.k] = ""; continue; } if (typeof to === "string" && (P.fields.includes(to) || /^[A-Za-z][A-Za-z0-9_]{1,60}$/.test(to))) out[f.k] = to; else if (P.defaults[f.k] && to === undefined) out[f.k] = P.defaults[f.k]; }
  for (const k of P.required) if (!out[k]) out[k] = P.defaults[k];
  return out;
}

const split = (name) => { const p = clean(name, 120).split(" ").filter(Boolean); return { firstName: p[0] || "", lastName: p.slice(1).join(" ") || "" }; };
/** The brand's guests as plain records, consent only, never feedback. */
export function recordsOf(c, events = {}) {
  const out = [], skipped = { noConsent: 0, noEmail: 0 };
  for (const g of c.guests || []) {
    if (g.status === "asked") continue;
    if (g.consent?.share !== true) { skipped.noConsent++; continue; }
    if (!g.email) { skipped.noEmail++; continue; }
    const E = events[g.event] || {}, n = split(g.name);
    out.push({ email: lc(g.email), ...n, company: clean(g.company, 120), title: clean(g.title, 120), campaign: clean(c.title, 120), event: clean(E.name, 120), eventDate: E.date || "", host: clean(E.host, 120),
      reply: { yes: "Yes", no: "No" }[g.status] || "", attended: g.checkedIn ? "Yes" : "No", seat: "Brand invited", followUp: { sent: "Followed up", meeting: "Meeting booked" }[g.followUp] || "", consentAt: g.consent.at ? isoDay(g.consent.at) : "" });
  }
  return { records: out, skipped };
}
/** Apply a mapping: CRM field name -> value. Fields with no value are left out. */
export function mapRecord(r, mapping) { const o = {}; for (const [k, to] of Object.entries(mapping)) { if (!to || NEVER.includes(k)) continue; const v = r[k]; if (v != null && v !== "") o[to] = String(v); } return o; }

/** The request each CRM would get. HubSpot: a contacts batch upsert by email. Salesforce: a composite Lead upsert. */
export function requestsFor(id, mapped) {
  if (id === "hubspot") {
    const inputs = mapped.map((p) => ({ idProperty: "email", id: p.email, properties: p }));
    // the same shape as the HubSpot tool's contact upsert (server/integrations/hubspot.js), in batches of 100
    const out = []; for (let i = 0; i < inputs.length; i += 100) out.push({ method: "POST", path: "/crm/v3/objects/contacts/batch/upsert", body: { inputs: inputs.slice(i, i + 100) } });
    return out;
  }
  if (id === "salesforce") { const out = []; for (let i = 0; i < mapped.length; i += 200) out.push({ method: "PATCH", path: "/services/data/v60.0/composite/sobjects/Lead/Email", body: { allOrNone: false, records: mapped.slice(i, i + 200).map((p) => ({ attributes: { type: "Lead" }, LeadSource: "Pottery Lab", ...p })) } }); return out; }
  return [];
}
export { contactUpsertBody };

/** What a sync would send, sending nothing. */
export function dryRun(id, c, events, mapping) {
  const P = PROVIDERS[id]; if (!P) return null;
  const M = cleanMapping(id, mapping), { records, skipped } = recordsOf(c, events), mapped = records.map((r) => mapRecord(r, M));
  const missingRequired = P.required.filter((k) => !M[k]).length ? P.required : [];
  const incomplete = mapped.filter((p) => P.required.some((k) => !p[M[k]])).length;
  return { provider: id, label: P.label, beta: true, mapping: M, wouldSend: mapped.length, skipped: { ...skipped, incomplete }, sample: mapped.slice(0, 5), requests: requestsFor(id, mapped).map((r) => ({ ...r, body: { ...r.body, ...(r.body.inputs ? { inputs: r.body.inputs.slice(0, 3) } : {}), ...(r.body.records ? { records: r.body.records.slice(0, 3) } : {}) } })), batches: requestsFor(id, mapped).length, missingRequired,
    note: `Only guests who said yes to sharing their details with you. Feedback, survey answers and connections never leave Pottery Lab. ${skipped.noConsent} without consent ${skipped.noConsent === 1 ? "is" : "are"} left out.` };
}

/** Send for real, through a transport: (req) => Promise<{ status, json }>. Returns what was sent and any errors. */
export async function sync(id, c, events, mapping, { transport, token = "" } = {}) {
  if (!transport) throw new Error("No transport");
  const M = cleanMapping(id, mapping), { records, skipped } = recordsOf(c, events), mapped = records.map((r) => mapRecord(r, M)).filter((p) => PROVIDERS[id].required.every((k) => p[M[k]]));
  const sent = [], errors = [];
  for (const r of requestsFor(id, mapped)) { try { const out = await transport({ ...r, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }); if (out.status >= 400) errors.push({ status: out.status, message: out.json?.message || "The CRM said no" }); else sent.push(r.body.inputs?.length || r.body.records?.length || 0); } catch (e) { errors.push({ status: 0, message: String(e?.message || e) }); } }
  return { provider: id, sent: sent.reduce((a, n) => a + n, 0), batches: sent.length, errors, skipped, at: Date.now() };
}

/** A transport that answers like the CRM and remembers every call. For tests and ENCORE_FAKE_CRM=1. */
export function fakeTransport({ fail = 0 } = {}) {
  const calls = [];
  const fn = async (req) => { calls.push(req); if (fail && calls.length <= fail) return { status: 500, json: { message: "fake failure" } };
    const n = req.body?.inputs?.length || req.body?.records?.length || 0; return { status: 200, json: req.body?.inputs ? { status: "COMPLETE", results: req.body.inputs.map((x, i) => ({ id: String(1000 + i), properties: x.properties })) } : Array.from({ length: n }, (_, i) => ({ id: "00Q" + i, success: true })) }; };
  return { calls, fn };
}
/** The live transport: fetch against the CRM's API host. Only used when connected and not faked. */
export const fetchTransport = (id, instance = "") => async (req) => { const base = id === "hubspot" ? "https://api.hubapi.com" : instance.replace(/\/$/, ""); const r = await fetch(base + req.path, { method: req.method, headers: req.headers, body: JSON.stringify(req.body) }); let json = null; try { json = await r.json(); } catch {} return { status: r.status, json }; };
export const stateToken = () => crypto.randomBytes(12).toString("hex");
