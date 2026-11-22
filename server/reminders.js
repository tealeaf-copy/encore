// Deadline reminders by email: each weekday morning, every task owner gets one short note listing their
// overdue tasks and the ones due in the next two days. No Slack, project tool or AI needed.
import { computeTaskStatuses } from "./pm.js";
import { emailConfig, sendEmail } from "./email.js";
import { teamOf } from "./auth.js";
import { DEFAULT_WS } from "./workspaces.js";

const norm = (s) => String(s || "").trim().toLowerCase();
const ROLE_ALIASES = { "account execs": ["ae", "account exec", "account executive", "sales"], "aes": ["ae", "account exec", "account executive"], "sales lead": ["sales lead", "sales manager", "vp sales", "cro"], "event lead": ["event lead", "field marketer", "field marketing", "events"], "exec sponsor": ["exec sponsor", "sponsor", "cmo", "vp marketing"] };

/** Who should hear about a task owned by `owner` (a person's name or a role), given the team. */
export function recipientsFor(owner, team, ev) {
  const o = norm(owner); if (!o) return [];
  const byName = team.filter((m) => norm(m.name) === o || norm(m.email) === o || norm(m.name).split(" ")[0] === o);
  if (byName.length) return byName;
  const want = [o, ...(ROLE_ALIASES[o] || [])];
  const byRole = team.filter((m) => (m.roles || []).some((r) => want.includes(norm(r))));
  if (byRole.length) return byRole;
  if (o === "event lead" || o === "you") { const lead = team.find((m) => norm(m.name) === norm(ev.owner)) || team.find((m) => m.owner); return lead ? [lead] : []; }
  return [];
}

const fmt = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Work out (and, unless dryRun, send) today's reminders for one workspace store. */
export async function runReminders(store, { now = Date.now(), dryRun = false, origin = process.env.ENCORE_PUBLIC_URL || "" } = {}) {
  const ws = store.ws || DEFAULT_WS, out = { ws, people: [], sent: 0, skipped: [] };
  const settings = store.get("settings/reminders")?.data; if (settings && settings.on === false) return { ...out, off: true };
  const cfg = emailConfig(ws, ws === DEFAULT_WS); if (!cfg && !dryRun) return { ...out, skipped: ["Email isn't set up."] };
  const team = teamOf(ws).filter((m) => m.email), day = new Date(now).toISOString().slice(0, 10), by = new Map();
  for (const doc of store.list("events")) {
    const ev = doc.data; if (!ev || ev.example || !ev.date || !(ev.produce?.tasks || []).length) continue;
    if (new Date(ev.date + "T23:59:59") < new Date(now - 30 * 864e5)) continue; // long finished
    for (const t of computeTaskStatuses(ev, now)) {
      if (!["overdue", "blocked"].includes(t.st) && !(t.days != null && t.days >= 0 && t.days <= 2 && t.st !== "done")) continue;
      const to = recipientsFor(t.owner, team, ev);
      if (!to.length) { out.skipped.push(`"${t.task}" (${t.owner || "no owner"}) on ${ev.name}: no teammate with that name or role.`); continue; }
      for (const m of to) { const k = norm(m.email); if (!by.has(k)) by.set(k, { m, items: [] }); by.get(k).items.push({ ev, t }); }
    }
  }
  for (const [k, { m, items }] of by) {
    items.sort((a, b) => (a.t.days ?? 0) - (b.t.days ?? 0));
    const first = String(m.name || "").split(" ")[0] || "there";
    const lines = items.map(({ ev, t }) => `• ${t.st === "blocked" ? "Blocked" : t.days < 0 ? `${-t.days} day${t.days === -1 ? "" : "s"} late` : t.days === 0 ? "Due today" : `Due ${fmt(t.due)}`}: ${t.task} (${ev.name}${ev.date ? ", " + fmt(ev.date) : ""})`);
    const subject = `${items.length} event task${items.length === 1 ? "" : "s"} need${items.length === 1 ? "s" : ""} you${items.some((x) => x.t.days < 0) ? " (some late)" : ""}`;
    const text = `Good morning ${first},\n\n${lines.join("\n")}\n\nTick them off in Encore when they're done.${origin ? `\n${origin}/#studio` : ""}\n\nIf something is stuck, mark it blocked and the event lead will see it.\n\nEncore`;
    const person = { email: m.email, name: m.name, count: items.length, subject };
    const key = `reminders/${day}-${k.replace(/[^a-z0-9]/g, "_")}`;
    if (!dryRun) {
      if (store.get(key)) { person.already = true; out.people.push(person); continue; }
      const r = await sendEmail(cfg, { to: m.email, subject, text });
      store.set(key, { day, email: m.email, count: items.length, ok: r.ok, error: r.error || null, at: Date.now() });
      store.add("outbox", { kind: "reminder", to: [m.email], subject, at: Date.now(), status: r.ok ? "sent" : "failed", error: r.error || null });
      if (r.ok) out.sent++; person.ok = r.ok; if (!r.ok) person.error = r.error;
    } else person.preview = text;
    out.people.push(person);
  }
  return out;
}
