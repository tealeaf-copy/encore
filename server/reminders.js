// Deadline reminders by email: each weekday morning, every task owner gets one short note listing their
// overdue tasks and the ones due in the next two days. No Slack, project tool or AI needed.
import { computeTaskStatuses } from "./pm.js";
import { emailConfig, sendEmail } from "./email.js";
import { teamOf } from "./auth.js";
import { DEFAULT_WS, allWorkspaceIds, scopeStore as scoped, getWorkspace } from "./workspaces.js";
import { smsConfig, sendSms } from "./sms.js";

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

const fmt = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

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
    const text = `Good morning ${first},\n\n${lines.join("\n")}\n\nTick them off in Pottery Lab when they're done.${origin ? `\n${origin}/#studio` : ""}\n\nIf something is stuck, mark it blocked and the event lead will see it.\n\nPottery Lab`;
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

// ---------------------------------------------------------------- Potto's nudges for hosts who take brand work ----------
// Potto texts (or emails) a host when a brand is waiting: a request with no quote after 4 hours, again the next
// morning; a quote the brand accepted, with what's still due (deposit, start time, address); and the day before a
// booked event, a short checklist. One message per run, listing everything due. No texts from 9pm to 8am in the
// host's time zone (they wait for the morning). The host turns any of it off on /onboard, and STOP stops texts.

export const QUIET_FROM = 21, QUIET_TO = 8;
const tzOk = (tz) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } };
/** The local hour and date (YYYY-MM-DD) at `now` in a time zone. */
export function localParts(now, tz) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz && tzOk(tz) ? tz : undefined, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return { hour: +p.hour % 24, day: `${p.year}-${p.month}-${p.day}` };
}
export const isQuiet = (now, tz) => { const h = localParts(now, tz).hour; return h >= QUIET_FROM || h < QUIET_TO; };
const addDay = (day, n) => { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const phoneOk = (p) => { const d = String(p || "").replace(/[^\d+]/g, ""); return /^\+?\d{10,15}$/.test(d) ? (d.startsWith("+") ? d : d.length === 10 ? "+1" + d : "+" + d) : ""; };

/** What the host chose on /onboard. Defaults: on, email on, texts on once there's a phone. */
export function pottoSettings(S) { const d = S.get("settings/potto")?.data || {}; return { off: !!d.off, phone: d.phone || "", sms: d.sms !== false && !!d.phone, email: d.email !== false, tz: d.tz && tzOk(d.tz) ? d.tz : "", waiting: d.waiting !== false, accepted: d.accepted !== false, dayBefore: d.dayBefore !== false }; }
export function cleanPottoSettings(b = {}, cur = {}) { const pick = (k, d) => (b[k] != null ? !!b[k] : cur[k] != null ? !!cur[k] : d);
  const phone = b.phone != null ? phoneOk(b.phone) : cur.phone || "";
  return { off: pick("off", false), phone, sms: pick("sms", true) && !!phone, email: pick("email", true), tz: b.tz && tzOk(String(b.tz)) ? String(b.tz).slice(0, 60) : cur.tz || "", waiting: pick("waiting", true), accepted: pick("accepted", true), dayBefore: pick("dayBefore", true), at: Date.now() }; }

const who = (b) => String(b.company || b.name || "A brand").slice(0, 60);
const what = (b) => String(b.experience?.name || (b.kind === "gift" ? "a gift order" : "a booking")).slice(0, 60);
const nice = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "");
const t12 = (hm) => { const m = /^(\d{2}):(\d{2})$/.exec(hm || ""); if (!m) return ""; const h = +m[1], ap = h >= 12 ? "pm" : "am"; return `${h % 12 || 12}${+m[2] ? ":" + m[2] : ""}${ap}`; };

/** The reminders due for one host's requests at `now`. Each is {key, kind, line, detail}. Pure: sends nothing. */
export function pottoDue(S, host, { now = Date.now(), tz = "", settings = pottoSettings(S) } = {}) {
  const out = [], L = localParts(now, tz), tomorrow = addDay(L.day, 1), sent = (k) => S.get("potto/" + k)?.data;
  for (const d of S.list("inquiries")) { const b = d.data || {}; if (!b.id) continue; const st = b.status || "requested";
    if (st === "requested" && settings.waiting && b.at && now - b.at < 14 * 864e5) {
      const k1 = `${b.id}-wait1`, s1 = sent(k1);
      if (!s1 && now - b.at >= 4 * 3600e3) out.push({ key: k1, kind: "waiting", id: b.id, line: `${who(b)} is waiting on a quote for ${what(b)}${b.people ? ` (${b.people} ${b.kind === "gift" ? "sets" : "people"}${b.date ? ", " + nice(b.date) : ""})` : b.date ? ` (${nice(b.date)})` : ""}.` });
      else if (s1 && !sent(`${b.id}-wait2`) && localParts(s1.at, tz).day < L.day && L.hour >= QUIET_TO && L.hour < 12) out.push({ key: `${b.id}-wait2`, kind: "waiting", id: b.id, line: `${who(b)}'s request for ${what(b)} still needs a quote.` });
    }
    if (st === "booked" && settings.accepted && (b.bookedAt || 0) > now - 3 * 864e5 && !sent(`${b.id}-booked`)) {
      const todo = [b.quote?.deposit && !b.depositPaid ? `the deposit${b.quote.deposit ? ` (${String(b.quote.deposit).replace(/^\$?/, "$")})` : ""}` : "", b.kind !== "gift" && !b.time ? "the start time" : "", b.kind !== "gift" && !b.where ? "the address" : "", b.kind === "gift" && !b.personalize ? "the names and artwork" : ""].filter(Boolean);
      out.push({ key: `${b.id}-booked`, kind: "accepted", id: b.id, line: `${who(b)} accepted your quote for ${what(b)}.${todo.length ? ` Still due: ${todo.join(", ")}.` : " Everything's in."}` });
    }
    if (st === "booked" && settings.dayBefore && b.kind !== "gift" && b.date === tomorrow && !sent(`${b.id}-daybefore`)) {
      const x = (host?.experiences || []).find((e) => e.id === b.experience?.id) || {}, setup = (x.runOfShow || []).find((r) => /^-\d/.test(r));
      const check = [b.time ? `Start ${t12(b.time)}${setup ? `, set up from ${setup.replace(/^-(\d+):(\d+)\s*/, (_, h, m) => `${+h ? h + "h" : ""}${+m ? m + "m" : ""} before: `)}` : ""}` : "Confirm the start time", b.where ? `Where: ${String(b.where).slice(0, 80)}` : "Confirm the address", b.people ? `${b.people} people` : "", (x.includes || []).length ? `Pack: ${x.includes.slice(0, 3).join(", ")}` : "", b.name || b.email ? `Contact: ${[b.name, b.email].filter(Boolean).join(", ")}` : ""].filter(Boolean);
      out.push({ key: `${b.id}-daybefore`, kind: "daybefore", id: b.id, line: `Tomorrow: ${what(b)} for ${who(b)}.`, detail: check });
    }
  }
  return out;
}

/** One message for everything due: short enough for a text, with a link to answer. */
export function pottoMessage(items, { link = "", sms = false } = {}) {
  const head = items.length === 1 ? "Potto here." : `Potto here. ${items.length} things need you:`;
  const body = items.map((x, i) => `${items.length > 1 ? `${i + 1}. ` : ""}${x.line}${x.detail?.length ? "\n" + x.detail.map((c) => (sms ? "- " : "• ") + c).join("\n") : ""}`).join("\n");
  const ask = items.some((x) => x.kind === "waiting") ? "Reply with a quote, or pass:" : "Open it:";
  return `${head}\n${body}${link ? `\n${ask} ${link}` : ""}${sms ? "\nReply STOP to stop texts." : ""}`;
}

/** Send what's due, for every host (or `workspaces`). Texts in waking hours, email otherwise or as a fallback. */
export async function runPottoReminders(store, { now = Date.now(), workspaces = null, dryRun = false, origin = process.env.ENCORE_PUBLIC_URL || "" } = {}) {
  const out = { sent: 0, held: 0, hosts: [] };
  for (const ws of workspaces || allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; const W = getWorkspace(ws), host = W?.host; if (!host?.handle) continue;
    const S = scoped(store, ws), set = pottoSettings(S); if (set.off) continue;
    const tz = set.tz || process.env.ENCORE_TZ || "", due = pottoDue(S, host, { now, tz, settings: set }); if (!due.length) continue;
    const req = due.find((x) => x.kind === "waiting"), link = `${origin}/@${host.handle}?bookings=1${req ? "&req=" + req.id : ""}`;
    const sms = set.sms && set.phone ? smsConfig() : null, email = set.email && W.ownerEmail ? emailConfig(ws, false) || emailConfig(DEFAULT_WS, true) : null, quiet = isQuiet(now, tz);
    const row = { ws, handle: host.handle, items: due.map((x) => x.key), channel: "", quiet };
    if (dryRun) { row.preview = pottoMessage(due, { link, sms: !!sms }); row.channel = sms ? (quiet ? "sms (after 8am)" : "sms") : email ? "email" : "none"; out.hosts.push(row); continue; }
    let ok = false;
    if (sms && !quiet) { const r = await sendSms(sms, { to: set.phone, text: pottoMessage(due, { link, sms: true }) }); ok = r.ok; if (ok) row.channel = "sms"; else row.error = r.error; }
    // quiet hours: when texts are the host's channel, everything waits for the morning text. Email-only hosts get email any time.
    if (!ok && sms && quiet) { out.held++; row.channel = "held"; out.hosts.push(row); continue; }
    if (!ok && email) { const subject = due.length === 1 ? due[0].line : `${due.length} things need you on Pottery Lab`; const r = await sendEmail(email, { to: W.ownerEmail, subject, text: pottoMessage(due, { link }) + "\n\nTurn these off any time: " + `${origin}/onboard#reminders`, fromName: "Potto at Pottery Lab" }); ok = r.ok; if (ok) row.channel = "email"; else row.error = r.error; }
    if (ok) { for (const x of due) S.set("potto/" + x.key, { at: now, channel: row.channel }); out.sent++; S.add("outbox", { kind: "potto", to: [row.channel === "sms" ? set.phone : W.ownerEmail], subject: due.map((x) => x.line).join(" ").slice(0, 200), at: now, status: "sent" }); }
    out.hosts.push(row);
  }
  return out;
}

/** Check every hour. Returns {stop}. */
export function schedulePottoReminders(store, opts = {}) {
  const tick = () => runPottoReminders(store, opts).catch((e) => console.warn("[potto reminders]", e?.message || e));
  const t = setInterval(tick, 3600e3); t.unref?.(); const first = setTimeout(tick, 90e3); first.unref?.();
  return { stop: () => { clearInterval(t); clearTimeout(first); }, run: tick };
}
