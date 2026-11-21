// Encore as an MCP server, so a field marketer can run their events from Claude.
// Add it in Claude as a custom connector: URL https://<your-encore>/mcp, header Authorization: Bearer <ENCORE_MCP_TOKEN>.
// Speaks JSON-RPC 2.0 over HTTP POST (MCP streamable HTTP, JSON responses).
import { timingSafeEqual } from "node:crypto";
import { eventMoney } from "./app.js";

const FX = { USD: 1, EUR: 1.08, GBP: 1.27, CAD: 0.73, AUD: 0.66, SGD: 0.74, JPY: 0.0067, INR: 0.012, CHF: 1.13, SEK: 0.095 };
const usd = (v, c) => Math.round((+v || 0) * (FX[String(c || "USD").toUpperCase()] ?? 1));
const KINDS = ["dinner", "conference", "owned", "summit", "webinar", "launch", "roadshow", "experience"];
const OBJECTIVES = ["pipeline", "expansion", "awareness", "mixed"];
const str = (description) => ({ type: "string", description });
const num = (description) => ({ type: "number", description });

const TOOLS = [
  { name: "list_events", description: "List Encore events with date, city, type, registrations vs seats and planned cost (USD). Use this first to find an event id.", inputSchema: { type: "object", properties: { status: str("Optional: idea, planning, live or done") } } },
  { name: "get_event", description: "One event's details: facts, guest counts by status, the next tasks due, approvals and what's still missing.", inputSchema: { type: "object", properties: { id: str("Event id") }, required: ["id"] } },
  { name: "create_event", description: "Create a new event. Encore's studio fills in the plan, page, guests and follow-up from here.", inputSchema: { type: "object", properties: { name: str("Event name"), kind: { type: "string", enum: KINDS }, objective: { type: "string", enum: OBJECTIVES }, city: str("City or Online"), date: str("YYYY-MM-DD"), headcount: num("Seats"), budget: num("Budget in the event's currency"), currency: str("USD, EUR, GBP…"), concept: str("The experience in 1-2 sentences"), goal: str("The goal in one sentence"), audience_roles: { type: "array", items: { type: "string" } } }, required: ["name"] } },
  { name: "update_event", description: "Change an event's details. Pass only the fields that change.", inputSchema: { type: "object", properties: { id: str("Event id"), name: str(""), city: str(""), date: str("YYYY-MM-DD"), headcount: num(""), budget: num(""), currency: str(""), concept: str(""), goal: str(""), status: str("idea, planning, live or done") }, required: ["id"] } },
  { name: "add_guests", description: "Add people to an event's guest list (skips names already on it).", inputSchema: { type: "object", properties: { id: str("Event id"), guests: { type: "array", items: { type: "object", properties: { name: str(""), title: str(""), company: str(""), email: str(""), owner: str("AE or CSM who owns the relationship"), tier: str("A, B or C") }, required: ["name"] } } }, required: ["id", "guests"] } },
  { name: "guest_list", description: "The guest list with status, owner and tier, plus who hasn't replied yet (grouped by owner, for chasing).", inputSchema: { type: "object", properties: { id: str("Event id") }, required: ["id"] } },
  { name: "followups_due", description: "Attendees whose follow-up or next step isn't done yet, grouped by owner, with what they said.", inputSchema: { type: "object", properties: { id: str("Event id") }, required: ["id"] } },
  { name: "pipeline_report", description: "The 90-day report in fixed buckets: created after the event, existing deals with attendees, meetings with no deal yet. Company-name-only matches are listed separately and not counted until confirmed.", inputSchema: { type: "object", properties: { id: str("Event id") }, required: ["id"] } },
  { name: "launch_kit", description: "Everything needed to publish the event page on Luma, Partiful, Eventbrite, Sequel or a website: title, date, location, description, registration questions.", inputSchema: { type: "object", properties: { id: str("Event id") }, required: ["id"] } },
  { name: "program_summary", description: "Totals across every event in USD: planned, committed (signed vendors), spent, new pipeline and pipeline per dollar for finished events.", inputSchema: { type: "object", properties: {} } },
];

function summarize(id, e) {
  const g = e.guests || [], by = (s) => g.filter((x) => x.status === s).length, m = eventMoney(e);
  return { id, name: e.name, kind: e.kind || "dinner", objective: e.objective || "pipeline", status: e.status || "planning", date: e.date || null, city: e.city || null,
    seats: +e.headcount || 0, registered: by("Going") + by("Attended"), plannedCost: m.cost, currency: m.currency, plannedCostUSD: usd(m.cost, m.currency) };
}
const text = (obj) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] });

export function mountMcp(app, { store, afterEventWrite, json }) {
  const token = () => process.env.ENCORE_MCP_TOKEN || "";
  const authed = (req) => { const t = token(), got = String(req.get("authorization") || "").replace(/^Bearer\s+/i, ""); if (!t || !got) return false; const a = Buffer.from(t), b = Buffer.from(got); return a.length === b.length && timingSafeEqual(a, b); };
  const getEv = (id) => { if (!/^[A-Za-z0-9_-]+$/.test(String(id || ""))) throw new Error("Unknown event id"); const d = store.get("events/" + id); if (!d) throw new Error("No event with id " + id); return d.data; };
  const save = (id, e) => { e.updatedAt = Date.now(); store.set("events/" + id, e); afterEventWrite?.("events/" + id); };

  const run = {
    list_events: ({ status }) => store.list("events").filter((d) => !d.data.example && (!status || (d.data.status || "planning") === status)).map((d) => summarize(d.id, d.data)),
    get_event: ({ id }) => {
      const e = getEv(id), g = e.guests || [], counts = {}; g.forEach((x) => { counts[x.status || "Not invited"] = (counts[x.status || "Not invited"] || 0) + 1; });
      const ev = e.date ? new Date(e.date + "T12:00:00") : null, done = new Set(e.tasksDone || []);
      const next = (e.produce?.tasks || []).map((t, i) => ({ ...t, i, due: ev ? new Date(ev.getTime() + t.days * 864e5).toISOString().slice(0, 10) : null })).filter((t) => !done.has(t.i)).sort((a, b) => a.days - b.days).slice(0, 5).map((t) => ({ task: t.task, owner: t.owner, due: t.due }));
      const missing = [!e.date && "date", !(e.venues?.venues?.length) && e.kind !== "webinar" && "venue", !e.produce && "production plan", !g.length && "guest list", !e.launchCopy && !e.copy && "event page copy"].filter(Boolean);
      const ap = store.get("approvals/" + id)?.data?.roles || {};
      return { ...summarize(id, e), concept: e.concept || "", goal: e.goal || "", guests: counts, nextTasks: next, approvals: Object.entries(ap).map(([role, a]) => ({ role, by: a.by, at: new Date(a.at).toISOString() })), missing, studio: "Open the event in Encore to run its agents." };
    },
    create_event: (a) => {
      const id = "ev" + Date.now().toString(36);
      const e = { name: String(a.name).slice(0, 120), kind: KINDS.includes(a.kind) ? a.kind : "dinner", objective: OBJECTIVES.includes(a.objective) ? a.objective : "pipeline", city: a.city || "", date: /^\d{4}-\d{2}-\d{2}$/.test(a.date || "") ? a.date : "", headcount: +a.headcount || 20, budget: +a.budget || 0, currency: String(a.currency || "USD").toUpperCase().slice(0, 3), concept: a.concept || "", goal: a.goal || "",
        audience: { roles: Array.isArray(a.audience_roles) ? a.audience_roles.slice(0, 10) : [], industries: [], seniority: "" }, guests: [], status: "planning", createdAt: Date.now(), createdVia: "Claude" };
      save(id, e); return { id, ...summarize(id, e) };
    },
    update_event: (a) => {
      const e = getEv(a.id);
      for (const k of ["name", "city", "concept", "goal", "status"]) if (a[k] != null) e[k] = String(a[k]);
      if (a.date != null) { if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date)) throw new Error("date must be YYYY-MM-DD"); e.date = a.date; }
      for (const k of ["headcount", "budget"]) if (a[k] != null) e[k] = +a[k] || 0;
      if (a.currency) e.currency = String(a.currency).toUpperCase().slice(0, 3);
      save(a.id, e); return summarize(a.id, e);
    },
    add_guests: ({ id, guests }) => {
      const e = getEv(id); e.guests = e.guests || []; let added = 0;
      for (const g of (guests || []).slice(0, 500)) { if (!g?.name || e.guests.some((x) => x.name === g.name && (x.company || "") === (g.company || ""))) continue; e.guests.push({ name: g.name, title: g.title || "", company: g.company || "", email: g.email || "", owner: g.owner || "", tier: (g.tier || "B").toUpperCase().slice(0, 1), status: "Not invited", outcome: "None yet", value: 0, source: "Added from Claude" }); added++; }
      save(id, e); return { added, total: e.guests.length };
    },
    guest_list: ({ id }) => {
      const e = getEv(id), g = e.guests || [], waiting = {};
      g.filter((x) => x.status === "Invited").forEach((x) => { (waiting[x.owner || "Unassigned"] = waiting[x.owner || "Unassigned"] || []).push(`${x.name} (${x.company || ""})`); });
      return { guests: g.map((x) => ({ name: x.name, title: x.title, company: x.company, status: x.status || "Not invited", owner: x.owner || "", tier: x.tier || "" })), waitingOnReplyByOwner: waiting };
    },
    followups_due: ({ id }) => {
      const e = getEv(id), by = {};
      (e.guests || []).filter((x) => x.status === "Attended" && !x.nsDoneAt).forEach((x) => { (by[x.owner || "Unassigned"] = by[x.owner || "Unassigned"] || []).push({ name: x.name, company: x.company, said: x.note || "", nextStep: x.nextStep || "Book a meeting", followUp: x.fuState || "Not started" }); });
      return { byOwner: by, rule: "Follow up within 24 hours of the event, starting from what they said." };
    },
    pipeline_report: ({ id }) => {
      const e = getEv(id), O = e.opps || [], sure = (o) => o.match === "contact" || o.confirmedBy, sum = (b) => O.filter((o) => o.bucket === b && sure(o)).reduce((a, o) => a + (+o.amount || 0), 0);
      return { createdAfterEvent: sum("created"), existingDealsWithAttendees: sum("existing"), lowerConfidenceCompanyOnly: O.filter((o) => !sure(o)).map((o) => ({ account: o.account, amount: o.amount })), deals: O.length,
        caveat: "Pipeline connected to attendees, not proof the event caused it. Use the holdout test for lift.", note: O.length ? "" : "No deals imported yet. Import opportunities or pull them from the CRM in Encore's Measure step." };
    },
    launch_kit: ({ id }) => {
      const e = getEv(id), L = e.launchCopy || {}, C = e.copy || {}, v = e.venues?.venues?.[e.venuePick ?? 0];
      return { title: L.title || C.title || e.name, summary: L.summary || C.tagline || "", date: e.date || null, location: v ? `${v.name}${v.address ? ", " + v.address : ""}` : e.city || "", description: L.description || C.description || e.concept || "",
        registrationQuestions: (e.launchQs?.questions || []).map((q) => q.q), capacity: +e.headcount || 0, approvalRequired: !!e.approvalRequired, platforms: ["Luma", "Partiful", "Eventbrite", "Sequel", "Your website"] };
    },
    program_summary: () => {
      const rows = store.list("events").filter((d) => !d.data.example).map((d) => { const m = eventMoney(d.data), O = d.data.opps || []; return { done: d.data.status === "done", planned: usd(m.cost, m.currency), committed: usd(m.committed, m.currency), spent: usd(+d.data.actualSpend || 0, m.currency), pipe: O.filter((o) => o.bucket === "created").reduce((a, o) => a + (+o.amount || 0), 0) }; });
      const s = (k, f = () => true) => rows.filter(f).reduce((a, r) => a + r[k], 0), dSpent = s("spent", (r) => r.done), dPipe = s("pipe", (r) => r.done);
      return { events: rows.length, plannedUSD: s("planned"), committedUSD: s("committed"), spentUSD: s("spent"), newPipelineFinishedUSD: dPipe, pipelinePerDollarFinished: dSpent ? +(dPipe / dSpent).toFixed(2) : null };
    },
  };

  app.post("/mcp", json, (req, res, next) => {
    if (!token()) return res.status(404).json({ error: "MCP is off. Set ENCORE_MCP_TOKEN to turn it on." });
    if (!authed(req)) return res.status(401).json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } });
    next();
  }, (req, res) => {
    const msg = req.body || {}, reply = (result) => res.json({ jsonrpc: "2.0", id: msg.id ?? null, result }), fail = (code, message) => res.json({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
    if (msg.id === undefined) return res.status(202).end(); // notifications
    try {
      if (msg.method === "initialize") return reply({ protocolVersion: msg.params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "encore", version: "1.0.0" }, instructions: "Encore plans and measures B2B events. Start with list_events or program_summary. Never share guests' emails, ARR or notes outside the team." });
      if (msg.method === "ping") return reply({});
      if (msg.method === "tools/list") return reply({ tools: TOOLS });
      if (msg.method === "tools/call") {
        const name = msg.params?.name, fn = run[name];
        if (!fn) return fail(-32602, `Unknown tool ${name}`);
        try { return reply(text(fn(msg.params?.arguments || {}))); } catch (e) { return reply({ ...text(String(e.message || e)), isError: true }); }
      }
      return fail(-32601, `Method not found: ${msg.method}`);
    } catch (e) { return fail(-32603, String(e.message || e)); }
  });
}
