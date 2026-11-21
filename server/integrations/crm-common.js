// Shared input handling for the CRM integrations (HubSpot, Salesforce).
export const STATUSES = ["Invited", "Registered", "Attended", "Declined"];

export const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
export const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z"));
export const errText = (e) => String(e?.message || e);

const bad = (who, message) => ({ code: "tool_error", message: `${who}: ${message}` });

/** Validate upsert_event_attendees input; drops members without email and duplicate emails. */
export function validateMembers(input, who) {
  const eventName = String(input?.eventName || "").trim();
  if (!eventName) throw bad(who, "eventName is required");
  if (!isDate(input.eventDate)) throw bad(who, "eventDate must be YYYY-MM-DD");
  if (!Array.isArray(input.members)) throw bad(who, "members must be an array");
  const seen = new Set(), members = [];
  for (const m of input.members) {
    const email = String(m?.email || "").trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    if (!STATUSES.includes(m.status)) throw bad(who, `member ${email}: status must be one of ${STATUSES.join(", ")}`);
    seen.add(email);
    members.push({ ...m, email });
  }
  return { eventName, eventDate: input.eventDate, members };
}

/** Validate event_pipeline input; returns normalised emails and an inclusive inWindow(dateString) test. */
export function validateWindow(input, who) {
  if (!Array.isArray(input?.emails)) throw bad(who, "emails must be an array");
  if (!isDate(input.since) || !isDate(input.until)) throw bad(who, "since and until must be YYYY-MM-DD");
  const from = Date.parse(input.since + "T00:00:00Z"), to = Date.parse(input.until + "T23:59:59.999Z");
  const emails = [...new Set(input.emails.map((e) => String(e || "").trim().toLowerCase()).filter(Boolean))];
  return { emails, inWindow: (t) => { const x = Date.parse(t); return !isNaN(x) && x >= from && x <= to; } };
}

export const MEMBERS_SCHEMA = {
  type: "object",
  properties: {
    eventName: { type: "string" },
    eventDate: { type: "string", description: "YYYY-MM-DD" },
    members: {
      type: "array",
      items: {
        type: "object",
        properties: {
          email: { type: "string" }, firstName: { type: "string" }, lastName: { type: "string" },
          company: { type: "string" }, title: { type: "string" },
          status: { type: "string", enum: STATUSES },
        },
        required: ["email", "status"],
      },
    },
  },
  required: ["eventName", "eventDate", "members"],
};

export const PIPELINE_SCHEMA = {
  type: "object",
  properties: {
    emails: { type: "array", items: { type: "string" } },
    since: { type: "string", description: "YYYY-MM-DD, inclusive" },
    until: { type: "string", description: "YYYY-MM-DD, inclusive" },
    eventName: { type: "string", description: "Optional: the event, to flag deals sourced by its campaign" },
  },
  required: ["emails", "since", "until"],
};
