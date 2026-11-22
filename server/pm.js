// Daily project-manager job: looks at every live event's production plan,
// asks Claude for short nudges, posts them to Slack, and records a report.
import cron from "node-cron";
import { complete, parseJsonLoose, aiMode } from "./ai.js";
import { configured, callTool } from "./integrations/index.js";

const DAY = 864e5;

/**
 * Pure task-status computation, identical to the page's taskStatus():
 * due = event date (noon) + t.days days; days left = ceil((due - now) / 1 day).
 * done if index in tasksDone; blocked if data.blocked has that index; overdue if
 * due is past; soon if due within 3 days; else later.
 */
export function computeTaskStatuses(data, now = Date.now()) {
  const tasks = data?.produce?.tasks || [];
  const done = Array.isArray(data?.tasksDone) ? data.tasksDone : [];
  const blocked = data?.blocked && typeof data.blocked === "object" ? data.blocked : {};
  const nowMs = now instanceof Date ? now.getTime() : now;
  const ev = data?.date ? new Date(data.date + "T12:00:00") : null;
  return tasks.map((t, i) => {
    const due = ev ? new Date(ev.getTime() + (+t.days || 0) * DAY) : null;
    const days = due ? Math.ceil((due - nowMs) / DAY) : null;
    const st = done.includes(i) ? "done"
      : blocked[i] != null ? "blocked"
      : days != null && days < 0 ? "overdue"
      : days != null && days <= 3 ? "soon"
      : "later";
    return { ...t, i, due: due ? due.toISOString().slice(0, 10) : null, days, st };
  });
}

function buildPrompt(ev, flagged) {
  const lines = flagged.map((t) =>
    `- [${t.st}] "${t.task || t.name || "Task " + (t.i + 1)}" owner: ${t.owner || "unassigned"}, due ${t.due}` +
    (t.days != null ? (t.days < 0 ? ` (${-t.days} days late)` : ` (in ${t.days} days)`) : "") +
    (t.st === "blocked" && ev.blocked?.[t.i] ? `, blocked by: ${ev.blocked[t.i]}` : ""));
  return `You are the project manager for a B2B field marketing event. Be plain, warm and brief. No jargon.
Event: ${ev.name || "Untitled event"} on ${ev.date}${ev.city ? " in " + ev.city : ""}.
These production tasks need attention today:
${lines.join("\n")}

Write one short nudge per owner who has overdue, blocked, or soon-due tasks. Name the tasks and dates. Offer help for blocked ones.
List the main risks to the event and a practical fix for each.
If the event lead must decide something (budget, scope, a blocked dependency), say what in askYou; otherwise leave it empty.
Reply with only JSON: {"nudges":[{"to":"owner name","message":"max 45 words"}],"risks":[{"risk":"short","fix":"short"}],"askYou":"what the event lead must decide, or empty"}`;
}

/** Run the PM pass once. `now` is injectable for tests. Returns a summary. */
export async function runPm(store, { now = Date.now(), log = console.log } = {}) {
  const summary = { events: 0, flaggedEvents: 0, nudges: 0, posted: 0, notifications: 0, errors: [] };
  if (aiMode() === "missing_key") {
    log("[pm] skipped: no ANTHROPIC_API_KEY (set ENCORE_FAKE_AI=1 for a demo run)");
    return { ...summary, skipped: "missing_key" };
  }
  // This server's Slack belongs to the default workspace; other workspaces' nudges aren't posted there.
  const slackOn = (!store.ws || store.ws === "default") && configured().some((s) => s.server === "Slack");
  for (const { id, data } of store.list("events")) {
    if (!data?.produce?.tasks?.length || !data.date || data.status === "done") continue;
    summary.events++;
    const flagged = computeTaskStatuses(data, now).filter((t) => t.st === "overdue" || t.st === "blocked" || t.st === "soon");
    if (!flagged.length) continue;
    summary.flaggedEvents++;
    try {
      const { text } = await complete({ prompt: buildPrompt(data, flagged), effort: "low" });
      const out = parseJsonLoose(text);
      const nudges = (Array.isArray(out.nudges) ? out.nudges : []).filter((n) => n && n.message);
      const risks = Array.isArray(out.risks) ? out.risks : [];
      const askYou = typeof out.askYou === "string" ? out.askYou.trim() : "";
      for (const n of nudges) {
        n.posted = false;
        if (!slackOn) continue;
        try {
          await callTool("Slack", "slack_send_message", { text: `${n.to ? n.to + ": " : ""}${n.message}` });
          n.posted = true;
          summary.posted++;
        } catch (err) {
          n.postError = String(err?.message || err);
        }
      }
      summary.nudges += nudges.length;
      const ranAt = Date.now();
      store.update(`events/${id}`, {
        pmReport: { nudges, risks, askYou, slack: slackOn, flagged: flagged.map((t) => ({ i: t.i, st: t.st, due: t.due })) },
        pmRanAt: ranAt,
      });
      if (askYou) {
        store.add("notifications", { eventId: id, title: `Decision needed: ${data.name || "your event"}`, body: askYou, createdAt: ranAt });
        summary.notifications++;
      }
    } catch (err) {
      summary.errors.push({ eventId: id, message: String(err?.message || err) });
    }
  }
  log(`[pm] ${summary.events} active events, ${summary.flaggedEvents} need attention, ${summary.nudges} nudges (${summary.posted} posted to Slack), ${summary.notifications} notifications, ${summary.errors.length} errors`);
  return summary;
}

/** stores: optional () => [store, ...] to run over several workspaces; defaults to [store]. */
export function schedulePm(store, { stores } = {}) {
  const expr = process.env.PM_CRON || "0 8 * * 1-5";
  const timezone = process.env.PM_TZ || "America/Chicago";
  if (process.env.PM_CRON === "off") return null;
  if (!cron.validate(expr)) {
    console.warn(`[pm] invalid PM_CRON "${expr}"; daily job disabled`);
    return null;
  }
  const task = cron.schedule(expr, async () => {
    for (const st of stores ? stores() : [store]) await runPm(st).catch((e) => console.error("[pm] run failed:", e?.message || e));
  }, { timezone });
  console.log(`[pm] scheduled "${expr}" (${timezone})`);
  return task;
}
