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

export const FOLLOWUPS_SCHEMA = {
  type: "object",
  properties: {
    eventName: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          email: { type: "string" },
          subject: { type: "string", description: "Task subject, e.g. the next step" },
          body: { type: "string", description: "What the guest said, the next step, and the approved follow-up" },
          dueDate: { type: "string", description: "YYYY-MM-DD" },
          giftCost: { type: "number", description: "Landed cost (item + shipping) when known" },
          gift: { type: "string" },
          giftStatus: { type: "string" },
          eventCostPerHead: { type: "number" },
        },
        required: ["email", "subject"],
      },
    },
  },
  required: ["eventName", "items"],
};

/** Validate log_followups input: one item per email, subject and email required, dates checked. */
export function validateFollowups(input, who) {
  const eventName = String(input?.eventName || "").trim();
  if (!eventName) throw bad(who, "eventName is required");
  if (!Array.isArray(input.items)) throw bad(who, "items must be an array");
  const seen = new Set(), items = [];
  for (const it of input.items) {
    const email = String(it?.email || "").trim().toLowerCase();
    const subject = String(it?.subject || "").trim().slice(0, 250);
    if (!email || !subject || seen.has(email)) continue;
    if (it.dueDate && !isDate(it.dueDate)) throw bad(who, `item ${email}: dueDate must be YYYY-MM-DD`);
    seen.add(email);
    items.push({ email, subject, body: String(it.body || "").slice(0, 30000), dueDate: it.dueDate || null, gift: String(it.gift || ""), giftCost: +it.giftCost || 0, giftStatus: String(it.giftStatus || "").slice(0, 40), eventCostPerHead: +it.eventCostPerHead || 0 });
  }
  return { eventName, items };
}

export const VERIFY_SCHEMA = {
  type: "object",
  properties: {
    emails: { type: "array", items: { type: "string" } },
    since: { type: "string", description: "YYYY-MM-DD: count meetings on or after this date" },
  },
  required: ["emails", "since"],
};
export function validateVerify(input, who) {
  if (!Array.isArray(input?.emails)) throw bad(who, "emails must be an array");
  if (!isDate(input.since)) throw bad(who, "since must be YYYY-MM-DD");
  return { emails: [...new Set(input.emails.map((e) => String(e || "").trim().toLowerCase()).filter(Boolean))].slice(0, 500), since: input.since };
}

export const ROLLUP_SCHEMA = {
  type: "object",
  properties: {
    accounts: { type: "array", items: { type: "object", properties: { name: { type: "string" }, domain: { type: "string" }, spend: { type: "number", description: "Total event spend attributed to the account (cost per head share + landed gift cost), USD" }, gifts: { type: "number" }, events: { type: "number" } }, required: ["name", "spend"] } },
  },
  required: ["accounts"],
};
export function validateRollup(input, who) {
  if (!Array.isArray(input?.accounts)) throw bad(who, "accounts must be an array");
  const seen = new Set(), accounts = [];
  for (const a of input.accounts) {
    const name = String(a?.name || "").trim(); if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    accounts.push({ name, domain: String(a.domain || "").trim().toLowerCase().replace(/^www\./, ""), spend: Math.round(+a.spend || 0), gifts: Math.round(+a.gifts || 0), events: Math.round(+a.events || 0) });
  }
  return { accounts: accounts.slice(0, 500) };
}
