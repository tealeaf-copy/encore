// Pottery Lab as an MCP server, so a field marketer can run their events from Claude.
// Add it in Claude as a custom connector: URL https://<your-encore>/mcp, header Authorization: Bearer <token>.
// Tokens: ENCORE_MCP_TOKENS="Name|email|token,..." (one per person, so the audit log names who) and/or
// a shared ENCORE_MCP_TOKEN. Every write tool call is written to the audit log.
// Speaks JSON-RPC 2.0 over HTTP POST (MCP streamable HTTP, JSON responses, batches allowed).
import { timingSafeEqual } from "node:crypto";
import { eventMoney } from "./app.js";
import { randomId } from "./db.js";

const FX = { USD: 1, EUR: 1.08, GBP: 1.27, CAD: 0.73, AUD: 0.66, SGD: 0.74, JPY: 0.0067, INR: 0.012, CHF: 1.13, SEK: 0.095 };
const usd = (v, c) => Math.round((+v || 0) * (FX[String(c || "USD").toUpperCase()] ?? 1));
export const CURRENCIES = Object.keys(FX);
const KINDS = ["dinner", "conference", "owned", "summit", "webinar", "launch", "roadshow", "experience"];
const OBJECTIVES = ["pipeline", "expansion", "awareness", "mixed"];
const str = (description) => ({ type: "string", description });
const num = (description) => ({ type: "number", description });

const TOOLS = [
  { name: "list_events", description: "List Pottery Lab events with date, city, type, registrations vs seats and planned cost (USD). Use this first to find an event id.", inputSchema: { type: "object", properties: { status: str("Optional: idea, planning, live or done") } } },
  { name: "get_event", description: "One event's details: facts, guest counts by status, the next tasks due, approvals and what's still missing.", inputSchema: { type: "object", properties: { id: str("Event id") }, required: ["id"] } },
  { name: "create_event", description: "Create a new event. Pottery Lab's studio fills in the plan, page, guests and follow-up from here.", inputSchema: { type: "object", properties: { name: str("Event name"), kind: { type: "string", enum: KINDS }, objective: { type: "string", enum: OBJECTIVES }, city: str("City or Online"), date: str("YYYY-MM-DD"), headcount: num("Seats"), budget: num("Budget in the event's currency"), currency: { type: "string", enum: Object.keys(FX) }, concept: str("The experience in 1-2 sentences"), goal: str("The goal in one sentence"), audience_roles: { type: "array", items: { type: "string" } } }, required: ["name"] } },
  { name: "update_event", description: "Change an event's details. Pass only the fields that change.", inputSchema: { type: "object", properties: { id: str("Event id"), name: str(""), city: str(""), date: str("YYYY-MM-DD"), headcount: num(""), budget: num("New total budget. If the plan has budget lines, they are scaled to match."), currency: str(""), concept: str(""), goal: str(""), status: { type: "string", enum: ["idea", "planning", "live", "done"] } }, required: ["id"] } },
  { name: "add_guests", description: "Add people to an event's guest list (skips names already on it).", inputSchema: { type: "object", properties: { id: str("Event id"), guests: { type: "array", items: { type: "object", properties: { name: str("Full name (or give firstName and lastName)"), firstName: str(""), lastName: str(""), title: str(""), company: str(""), email: str(""), owner: str("AE or CSM who owns the relationship"), tier: str("A, B or C; Enterprise/Strategic map to A, Mid-market to B, anything else to C"), arr: { type: ["number", "string"], description: "Account ARR, e.g. 120000, \"120k\" or \"$1.2M\"" }, renewalDate: str("YYYY-MM-DD"), health: str("Account health, e.g. Green, Yellow, Red") } } } }, required: ["id", "guests"] } },
  { name: "guest_list", description: "The guest list with status, owner and tier, plus who hasn't replied yet (grouped by owner, for chasing).", inputSchema: { type: "object", properties: { id: str("Event id") }, required: ["id"] } },
  { name: "followups_due", description: "Guests whose follow-up or next step isn't done yet, grouped by owner, with what they said.", inputSchema: { type: "object", properties: { id: str("Event id") }, required: ["id"] } },
  { name: "pipeline_report", description: "The 90-day report in fixed buckets: created after the event, existing deals with guests, meetings with no deal yet. Company-name-only matches are listed separately and not counted until confirmed.", inputSchema: { type: "object", properties: { id: str("Event id") }, required: ["id"] } },
  { name: "launch_kit", description: "Everything needed to publish the event page on Luma, Partiful, Eventbrite, Sequel or a website: title, date, location, description, registration questions.", inputSchema: { type: "object", properties: { id: str("Event id") }, required: ["id"] } },
  { name: "program_summary", description: "Totals across every event in USD: planned, committed (signed vendors), spent, new pipeline and pipeline per dollar for finished events.", inputSchema: { type: "object", properties: {} } },
];

// A deal counts toward pipeline only when it's tied to an attendee or a person confirmed it (the page's sureOpp).
export const sureOpp = (o) => !!o && (o.match === "contact" || !!o.confirmedBy || !!o.sample);
/** Confirmed deals in a bucket ("created" / "existing"), in USD (each deal's own currency, else USD). */
export const pipeUSD = (e, bucket) => (e.opps || []).filter((o) => o.bucket === bucket && sureOpp(o)).reduce((a, o) => a + usd(o.amount, o.currency), 0);
/** Registered = guests Going or Attended + guest RSVPs saying going (the page's regCount). */
export const regCount = (id, e, rsvps) => (e.guests || []).filter((g) => g.status === "Going" || g.status === "Attended").length + rsvps.filter((r) => r.eventId === id && r.response === "going").length;
// Tokens shorter than this are ignored (and stop the server from starting; see startupProblems in index.js).
export const MIN_MCP_TOKEN = 32;
function summarize(id, e, rsvps = []) {
  const m = eventMoney(e);
  return { id, name: e.name, kind: e.kind || "dinner", objective: e.objective || "pipeline", status: e.status || "planning", date: e.date || null, city: e.city || null,
    seats: +e.headcount || 0, registered: regCount(id, e, rsvps), plannedCost: m.cost, currency: m.currency, plannedCostUSD: usd(m.cost, m.currency) };
}
// ---------- input checks: tools refuse bad input instead of guessing ----------
const bad = (m) => { throw new Error(m); };
export function realDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
const checkDate = (v, what = "date") => { if (!realDate(v)) bad(`${what} must be a real date as YYYY-MM-DD (got ${JSON.stringify(v)})`); return String(v); };
const checkCurrency = (v) => { const c = String(v || "").trim().toUpperCase(); if (!FX[c]) bad(`currency must be one of ${CURRENCIES.join(", ")} (got ${JSON.stringify(v)})`); return c; };
const checkAmount = (v, what) => { const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v; if (typeof n !== "number" || !Number.isFinite(n) || n < 0) bad(`${what} must be a number of 0 or more (got ${JSON.stringify(v)})`); return n; };
/** "120k", "$1.2M", "1,200,000", "€80K", 95000 -> a number; NaN when it can't be read. */
export function parseMoney(v) {
  if (typeof v === "number") return v;
  const t = String(v ?? "").trim().toLowerCase().replace(/[£€$¥,\s]|usd|eur|gbp|arr/g, "");
  if (!t) return 0;
  const m = t.match(/^(\d+(?:\.\d+)?)(k|m|mm|b|bn)?$/);
  return m ? Math.round(+m[1] * ({ k: 1e3, m: 1e6, mm: 1e6, b: 1e9, bn: 1e9 }[m[2]] || 1)) : NaN;
}
export function tierOf(v) {
  const t = String(v || "").trim();
  if (/^[abc]$/i.test(t)) return t.toUpperCase();
  if (/enterprise|strategic|tier\s*1|^1$/i.test(t)) return "A";
  if (/mid[-\s]?market|tier\s*2|^2$/i.test(t)) return "B";
  return "C";
}
const WRITES = new Set(["create_event", "update_event", "add_guests"]);
/** Problems with the MCP token settings that should stop the server from starting. */
export function mcpTokenProblems() {
  const out = [];
  if (process.env.ENCORE_MCP_TOKEN && process.env.ENCORE_MCP_TOKEN.length < MIN_MCP_TOKEN) out.push(`ENCORE_MCP_TOKEN must be at least ${MIN_MCP_TOKEN} characters (try \`openssl rand -hex 32\`).`);
  const short = String(process.env.ENCORE_MCP_TOKENS || "").split(",").map((x) => x.trim()).filter(Boolean).map((x) => x.split("|").map((y) => y.trim())).filter(([n, , t]) => !t || t.length < MIN_MCP_TOKEN).map(([n]) => n || "(no name)");
  if (short.length) out.push(`ENCORE_MCP_TOKENS entries need a token of at least ${MIN_MCP_TOKEN} characters: ${short.join(", ")}.`);
  return out;
}
const MCP_RATE_PER_MIN = () => Number(process.env.ENCORE_MCP_RATE_PER_MIN || 120);

const text = (obj) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] });

/**
 * scoped(ws) -> the store for a workspace; findToken(token) -> a per-workspace token record {ws,name,email};
 * writable(ws) -> false once a trial has ended; claimEvent(id, ws) -> registers a new event id.
 */
export function mountMcp(app, { scoped, afterEventWrite, json, findToken = () => null, writable = () => true, claimEvent = () => true }) {
  // Who each token belongs to. The shared ENCORE_MCP_TOKEN can't name a person.
  const tokens = () => {
    const list = String(process.env.ENCORE_MCP_TOKENS || "").split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
      const [name, email, t] = x.split("|").map((y) => y.trim());
      return { name, email: String(email || "").toLowerCase() || null, token: t, verified: true, ws: "default" };
    }).filter((x) => x.name && x.token && x.token.length >= MIN_MCP_TOKEN);
    if (process.env.ENCORE_MCP_TOKEN && process.env.ENCORE_MCP_TOKEN.length >= MIN_MCP_TOKEN) list.push({ name: "Claude (shared MCP token)", ws: "default", email: null, token: process.env.ENCORE_MCP_TOKEN, verified: false });
    return list;
  };
  const same = (x, y) => { const a = Buffer.from(String(x)), b = Buffer.from(String(y)); return a.length === b.length && timingSafeEqual(a, b); };
  const whoIs = (req) => {
    const got = String(req.get("authorization") || "").replace(/^Bearer\s+/i, ""); if (!got) return null;
    let hit = null; for (const t of tokens()) if (same(t.token, got)) hit = hit || t;
    if (hit) return hit;
    // Tokens a workspace owner created (POST /api/mcptoken), stored hashed.
    const rec = got.length >= MIN_MCP_TOKEN ? findToken(got) : null;
    return rec ? { name: rec.name, email: rec.email || null, verified: true, ws: rec.ws, token: got } : null;
  };
  // Per-token rate limit: ENCORE_MCP_RATE_PER_MIN messages a minute (default 120; each message in a batch counts).
  const hits = new Map(); // token -> { n, start }
  const overLimit = (tok, n) => {
    const now = Date.now(); let h = hits.get(tok);
    if (!h || now - h.start >= 60_000) { h = { n: 0, start: now }; hits.set(tok, h); }
    if (h.n + n > MCP_RATE_PER_MIN()) return Math.ceil((h.start + 60_000 - now) / 1000);
    h.n += n; return 0;
  };
  // Everything below works on one workspace's store.
  const ctxFor = (store, ws) => {
  const readLog = (who, eventId, tool) => store.add("audit", { eventId: String(eventId || ""), what: `read ${tool}`, kind: "read", via: "MCP", who: who?.name || "Claude (MCP)", email: who?.email || null, at: Date.now() });
  const audit = (who, eventId, what) => store.add("audit", { eventId: String(eventId || ""), what: String(what).slice(0, 500), kind: "mcp", via: "MCP", who: who?.name || "Claude (MCP)", email: who?.email || null, verified: !!who?.verified, at: Date.now() });
  const getEv = (id) => { if (!/^[A-Za-z0-9_-]+$/.test(String(id || ""))) throw new Error("Unknown event id"); const d = store.get("events/" + id); if (!d) throw new Error("No event with id " + id); return d.data; };
  const save = (id, e) => { e.updatedAt = Date.now(); store.set("events/" + id, e); afterEventWrite?.(store, "events/" + id); };

  const run = {
    list_events: ({ status }) => { const R = rsvps(); return store.list("events").filter((d) => !d.data.example && (!status || (d.data.status || "planning") === status)).map((d) => summarize(d.id, d.data, R)); },
    get_event: ({ id }) => {
      const e = getEv(id), g = e.guests || [], counts = {}; g.forEach((x) => { counts[x.status || "Not invited"] = (counts[x.status || "Not invited"] || 0) + 1; });
      const ev = e.date ? new Date(e.date + "T12:00:00") : null, done = new Set(e.tasksDone || []);
      const next = (e.produce?.tasks || []).map((t, i) => ({ ...t, i, due: ev ? new Date(ev.getTime() + t.days * 864e5).toISOString().slice(0, 10) : null })).filter((t) => !done.has(t.i)).sort((a, b) => a.days - b.days).slice(0, 5).map((t) => ({ task: t.task, owner: t.owner, due: t.due }));
      const missing = [!e.date && "date", !(e.venues?.venues?.length) && e.kind !== "webinar" && "venue", !e.produce && "production plan", !g.length && "guest list", !e.launchCopy && !e.copy && "event page copy"].filter(Boolean);
      const ap = store.get("approvals/" + id)?.data?.roles || {};
      return { ...summarize(id, e, rsvps()), concept: e.concept || "", goal: e.goal || "", guests: counts, nextTasks: next, approvals: Object.entries(ap).map(([role, a]) => ({ role, by: a.by, at: new Date(a.at).toISOString() })), missing, studio: "Open the event in Pottery Lab to run its agents." };
    },
    create_event: (a) => {
      if (!String(a.name || "").trim()) bad("name is required");
      const date = a.date != null && a.date !== "" ? checkDate(a.date) : "";
      const headcount = a.headcount != null ? checkAmount(a.headcount, "headcount") : 20, budget = a.budget != null ? checkAmount(a.budget, "budget") : 0;
      const currency = a.currency != null && a.currency !== "" ? checkCurrency(a.currency) : "USD";
      let id = randomId(); while (!claimEvent(id, ws)) id = randomId();
      const e = { name: String(a.name).slice(0, 120), kind: KINDS.includes(a.kind) ? a.kind : "dinner", objective: OBJECTIVES.includes(a.objective) ? a.objective : "pipeline", city: String(a.city || ""), date, headcount, budget, currency, concept: String(a.concept || ""), goal: String(a.goal || ""),
        audience: { roles: Array.isArray(a.audience_roles) ? a.audience_roles.slice(0, 10) : [], industries: [], seniority: "" }, guests: [], status: "planning", createdAt: Date.now(), createdVia: "Claude" };
      save(id, e); return { id, ...summarize(id, e) };
    },
    update_event: (a) => {
      const e = getEv(a.id), notes = [];
      // Check everything before changing anything.
      if (a.status != null && !["idea", "planning", "live", "done"].includes(a.status)) bad("status must be idea, planning, live or done");
      const date = a.date != null ? checkDate(a.date) : null;
      const headcount = a.headcount != null ? checkAmount(a.headcount, "headcount") : null, budget = a.budget != null ? checkAmount(a.budget, "budget") : null;
      const currency = a.currency != null ? checkCurrency(a.currency) : null;
      const lines = e.produce?.budget || [], lineSum = lines.reduce((s0, b) => s0 + (+b.amount || 0), 0);
      if (budget != null && lines.length && !lineSum && budget > 0) bad("This plan has budget lines that are all 0, so they can't be scaled. Change the lines in Pottery Lab's Produce step.");
      for (const k of ["name", "city", "concept", "goal", "status"]) if (a[k] != null) e[k] = String(a[k]);
      if (date != null) e.date = date;
      if (headcount != null) e.headcount = headcount;
      if (currency != null) e.currency = currency;
      if (budget != null) {
        e.budget = budget;
        // The planned cost is the sum of the budget lines when there are any, so scale them to the new total.
        if (lines.length && lineSum !== budget) {
          const k = budget / lineSum; let left = budget;
          const scaled = lines.map((b) => ({ ...b, amount: Math.round((+b.amount || 0) * k) }));
          scaled.forEach((b) => { left -= b.amount; });
          const big = scaled.reduce((bi, b, i) => ((+b.amount || 0) > (+scaled[bi].amount || 0) ? i : bi), 0);
          scaled[big].amount += left; // rounding remainder goes on the biggest line, so the lines add up exactly
          e.produce = { ...e.produce, budget: scaled };
          notes.push(`Scaled ${lines.length} budget line${lines.length === 1 ? "" : "s"} from ${lineSum.toLocaleString("en-US")} to ${budget.toLocaleString("en-US")} (x${k.toFixed(3)}).`);
        }
      }
      save(a.id, e); return { ...summarize(a.id, e, rsvps()), ...(notes.length ? { notes } : {}) };
    },
    add_guests: ({ id, guests }) => {
      const e = getEv(id); e.guests = e.guests || []; let added = 0; const skipped = [];
      if (!Array.isArray(guests)) bad("guests must be a list");
      for (const g of guests.slice(0, 500)) {
        const name = String(g?.name || [g?.firstName, g?.lastName].filter(Boolean).join(" ")).trim().slice(0, 120);
        if (!name) { skipped.push({ guest: g, why: "no name" }); continue; }
        const company = String(g.company || "").slice(0, 120);
        if (e.guests.some((x) => x.name === name && (x.company || "") === company)) { skipped.push({ name, why: "already on the list" }); continue; }
        let arr = null;
        if (g.arr != null && g.arr !== "") { arr = parseMoney(g.arr); if (!Number.isFinite(arr) || arr < 0) { skipped.push({ name, why: `couldn't read ARR ${JSON.stringify(g.arr)}` }); continue; } }
        if (g.renewalDate != null && g.renewalDate !== "" && !realDate(g.renewalDate)) { skipped.push({ name, why: `renewalDate must be YYYY-MM-DD (got ${JSON.stringify(g.renewalDate)})` }); continue; }
        e.guests.push({ name, title: String(g.title || "").slice(0, 120), company, email: String(g.email || "").slice(0, 200), owner: String(g.owner || "").slice(0, 120), tier: g.tier ? tierOf(g.tier) : "B",
          ...(arr != null ? { arr } : {}), ...(g.renewalDate ? { renewalDate: String(g.renewalDate) } : {}), ...(g.health ? { health: String(g.health).slice(0, 40) } : {}),
          status: "Not invited", outcome: "None yet", value: 0, source: "Added from Claude" });
        added++;
      }
      if (added) save(id, e);
      return { added, total: e.guests.length, ...(skipped.length ? { skipped } : {}) };
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
      const e = getEv(id), O = e.opps || [];
      return { currency: "USD", createdAfterEvent: pipeUSD(e, "created"), existingDealsWithAttendees: pipeUSD(e, "existing"), lowerConfidenceCompanyOnly: O.filter((o) => !sureOpp(o)).map((o) => ({ account: o.account, amount: o.amount, currency: String(o.currency || "USD").toUpperCase(), amountUSD: usd(o.amount, o.currency) })), deals: O.length, confirmedDeals: O.filter(sureOpp).length,
        caveat: "Pipeline connected to guests, not proof the event caused it. Use the holdout test for lift.", note: O.length ? "" : "No deals imported yet. Import opportunities or pull them from the CRM in Pottery Lab's Measure step." };
    },
    launch_kit: ({ id }) => {
      const e = getEv(id), L = e.launchCopy || {}, C = e.copy || {}, v = e.venues?.venues?.[e.venuePick ?? 0];
      return { title: L.title || C.title || e.name, summary: L.summary || C.tagline || "", date: e.date || null, location: v ? `${v.name}${v.address ? ", " + v.address : ""}` : e.city || "", description: L.description || C.description || e.concept || "",
        registrationQuestions: (e.launchQs?.questions || []).map((q) => q.q), capacity: +e.headcount || 0, approvalRequired: !!e.approvalRequired, platforms: ["Luma", "Partiful", "Eventbrite", "Sequel", "Your website"] };
    },
    program_summary: () => {
      const evs = store.list("events").filter((d) => !d.data.example), parents = new Set(evs.map((d) => d.data.parentId).filter(Boolean));
      // A series master's budget is the sum of its cities: count the cities, not the master too.
      const rows = evs.map((d) => { const m = eventMoney(d.data), master = !!d.data.isSeries && parents.has(d.id); return { done: d.data.status === "done", planned: master ? 0 : usd(m.cost, m.currency), committed: usd(m.committed, m.currency), spent: usd(+d.data.actualSpend || 0, m.currency), pipe: pipeUSD(d.data, "created") }; });
      const s = (k, f = () => true) => rows.filter(f).reduce((a, r) => a + r[k], 0), dSpent = s("spent", (r) => r.done), dPipe = s("pipe", (r) => r.done);
      return { events: rows.length, plannedUSD: s("planned"), committedUSD: s("committed"), spentUSD: s("spent"), newPipelineFinishedUSD: dPipe, pipelinePerDollarFinished: dSpent ? +(dPipe / dSpent).toFixed(2) : null };
    },
  };

  const rsvps = () => store.list("rsvps").map((d) => d.data);
  return { run, readLog, audit, getEv };
  };
  const tokenExists = () => tokens().length > 0;
  /** One JSON-RPC message -> its response object, or null for a notification. */
  function handle(msg, who) {
    const { run, readLog, audit, getEv } = ctxFor(scoped(who.ws), who.ws);
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } };
    if (msg.id === undefined) return null; // notifications
    const reply = (result) => ({ jsonrpc: "2.0", id: msg.id ?? null, result }), fail = (code, message) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
    try {
      if (msg.method === "initialize") return reply({ protocolVersion: msg.params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "encore", version: "1.0.0" }, instructions: "Pottery Lab plans and measures B2B events. Start with list_events or program_summary. Never share guests' emails, ARR or notes outside the team." });
      if (msg.method === "ping") return reply({});
      if (msg.method === "tools/list") return reply({ tools: TOOLS });
      if (msg.method === "tools/call") {
        const name = msg.params?.name, fn = Object.hasOwn(run, name) ? run[name] : null, args = msg.params?.arguments || {};
        if (!fn) return fail(-32602, `Unknown tool ${name}`);
        if (WRITES.has(name) && !writable(who.ws)) return reply({ ...text("This workspace's free trial has ended, so changes are paused. Upgrade in Pottery Lab to keep editing; reading still works."), isError: true });
        try {
          const out = fn(args);
          if (!WRITES.has(name)) readLog(who, args.id, name);
          if (WRITES.has(name)) {
            const id = out?.id || args.id, changed = Object.keys(args).filter((k) => k !== "id" && k !== "guests");
            audit(who, id, name === "create_event" ? `${out.name}: created from Claude` : name === "add_guests" ? `${getEv(id).name || id}: added ${out.added} guest${out.added === 1 ? "" : "s"} from Claude` : `${getEv(id).name || id}: updated from Claude (${changed.join(", ") || "no fields"})${out.notes ? " " + out.notes.join(" ") : ""}`);
          }
          return reply(text(out));
        } catch (e) { return reply({ ...text(String(e.message || e)), isError: true }); }
      }
      return fail(-32601, `Method not found: ${msg.method}`);
    } catch (e) { return fail(-32603, String(e.message || e)); }
  }

  app.post("/mcp", json, (req, res, next) => {
    if (!tokenExists() && process.env.ENCORE_SIGNUP !== "1") return res.status(404).json({ error: "MCP is off. Set ENCORE_MCP_TOKENS or ENCORE_MCP_TOKEN to turn it on." });
    const who = whoIs(req);
    if (!who) return res.status(401).json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } });
    req.mcpWho = who;
    const wait = overLimit(who.token, Array.isArray(req.body) ? Math.max(1, Math.min(req.body.length, 100)) : 1);
    if (wait) { res.set("Retry-After", String(wait)); return res.status(429).json({ jsonrpc: "2.0", id: null, error: { code: -32029, message: `Too many requests. Try again in ${wait}s.` } }); }
    next();
  }, (req, res) => {
    const body = req.body;
    if (Array.isArray(body)) {
      if (!body.length) return res.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Empty batch" } });
      const out = body.slice(0, 100).map((m) => handle(m, req.mcpWho)).filter(Boolean);
      return out.length ? res.json(out) : res.status(202).end();
    }
    const out = handle(body || {}, req.mcpWho);
    return out ? res.json(out) : res.status(202).end();
  });
}
