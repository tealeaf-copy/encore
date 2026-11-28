// Potto nudges the people who haven't replied (and, with the same machinery, the maybes).
//
// Who can be nudged: only people the host invited to this event through Pottery Lab and who haven't replied:
//   - people on the invite plan who were sent the invite (server/invites.js: invplans/<event>.people with invitedAt)
//   - guests on the event's own list marked Invited, with an email or a phone (the host's guest list, index.html)
//   - numbers the host texted the invite to (server/social.js: textinvites)
// Never someone who only opened the link, never someone who replied (I'm in, Maybe, Can't go, asked to join, waitlist).
// Left out without a word: people who blocked the host (or the host blocked) and people who muted the host. Left out
// and named to the host, who already sees it in People: unsubscribed from emails, emails turned off, replied STOP,
// texts turned off on their reply. "Message the maybes" uses the same list rules with Maybe replies as the recipients.
// An event shared only as a link has no known recipients: the host gets a message to paste, and can post it to the
// group chat for the guests already in. Nothing is sent from here for it.
//
// Nothing is ever sent without the host's tap: POST /api/host/nudge/:id/send needs { confirm: true }, from the confirm
// sheet (public/pottonudge.js) that Ask Potto, the event overview and the proactive line all open.
//
// The message: "Hi Sam, Maya here. <the host's line> One tap to reply: <Sam's own invite link>". The host can edit the
// line; it is cleaned like other text, and links in it are dropped so the only link is the invite. Email goes out as a
// guest email (unsubscribe header and footer, server/email.js); a text ends with "Reply STOP to opt out." (server/sms.js
// also refuses numbers on the stop list).
//
// Limits (LIMITS, nudgesPerDay): at most 2 nudges per person per event, at least 3 days apart (the invite plan's own
// reminders count: both live in the plan's reminders), none within 2 hours of the start or after it, and at most
// ENCORE_NUDGES_PER_DAY messages per host a day (default 50). From 9pm to 9am where the event is, nudges wait for 9am
// (runDue, every few minutes outside tests) and the host is told so. Whoever replied in the meantime is dropped.
//
// The record: system/nudge-<hash of workspace and event> { ws, eventId, people: { <person id>: { name, keys, ch, at: [ms],
// queued } }, sends, queue, dismissedAt }. The overview shows "Nudged Tue" beside the person and Potto answers "who did I
// nudge?" from it. system/nudgeuse-<hash of workspace> { day, n } counts the day's sends.
//
// The proactive line ("5 people haven't replied to Dumpling night. Want me to nudge them?") shows on the overview and
// Home when: the invite went out at least 48 hours ago, or the event is within 72 hours, whichever comes first; at
// least 2 people can be nudged; no nudge went out in the last 3 days; and the host didn't dismiss it in the last 3 days.
import crypto from "node:crypto";
import { scopeStore, getWorkspace, DEFAULT_WS } from "./workspaces.js";
import { emailConfig, sendEmail, isUnsubscribed, EMAIL_RE } from "./email.js";
import { smsConfig, sendSms, smsStopped } from "./sms.js";
import { keyFor, idOf, isBrandWs } from "./people.js";
import { eventTz, zonedMs, hourIn, tzOk } from "./tz.js";
import { textProblem } from "./safety.js";
import { pickEvent, pottoReply } from "./pottorules.js";
import { pottoSettings } from "./reminders.js";

const HOUR = 3600e3, DAY = 864e5;
export const LIMITS = { perPerson: 2, gapMs: 3 * DAY, nearMs: 2 * HOUR, quiet: [21, 9], afterInviteMs: 48 * HOUR, beforeEventMs: 72 * HOUR, minToSuggest: 2, bodyMax: 300 };
export const nudgesPerDay = () => { const n = Number(process.env.ENCORE_NUDGES_PER_DAY ?? 50); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 50; };
const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => { const w = String(n || "").trim().split(/\s+/)[0] || ""; return /@/.test(w) ? "" : w; };
const h24 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 24);
const ID = /^[A-Za-z0-9_-]{1,80}$/, ISO = /^\d{4}-\d{2}-\d{2}$/;
const digits = (p) => String(p || "").replace(/[^\d+]/g, "");
const b64u = (t) => Buffer.from(String(t), "utf8").toString("base64url");
const list = (L) => (L.length <= 1 ? L.join("") : L.length === 2 ? L.join(" and ") : `${L.slice(0, -1).join(", ")} and ${L[L.length - 1]}`);
const people = (n) => (n === 1 ? "1 person" : `${n} people`);
const niceDay = (iso) => (ISO.test(iso || "") ? new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "");
const clock12 = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); if (!m) return ""; const h = +m[1] % 12 || 12; return `${h}${m[2] === "00" ? "" : ":" + m[2]}${+m[1] < 12 ? "am" : "pm"}`; };
/** "Sat, Dec 5 at 7pm" */
export const whenLine = (ev) => [niceDay(ev?.date), clock12(ev?.startTime)].filter(Boolean).join(" at ");
const titleOf = (ev) => String(ev?.pubTitle || ev?.name || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80) || "my event";
/** When the event starts, in ms, where it is (noon when it has no time; 0 with no date). */
export function startOf(ev, tz = "") { if (!ISO.test(ev?.date || "")) return 0; const t = /^\d{2}:\d{2}$/.test(ev.startTime || "") ? ev.startTime : "12:00"; const ms = zonedMs(ev.date, t, tz); return Number.isFinite(ms) ? ms : 0; }
/** The weekday a nudge went ("Tue"), or the date once it's a week old. */
export function dayLabel(ms, now, tz = "") { const o = tz && tzOk(tz) ? { timeZone: tz } : {}; return new Date(ms).toLocaleDateString("en-US", now - ms < 6 * DAY ? { weekday: "short", ...o } : { month: "short", day: "numeric", ...o }); }
const inQuiet = (ms, tz) => { const h = hourIn(tz, ms), [a, b] = LIMITS.quiet; return h >= a || h < b; };
/** The next 9am there, from a moment inside quiet hours. */
export function nextMorning(ms, tz) { let t = Math.floor(ms / HOUR) * HOUR + HOUR; for (let i = 0; i < 30; i++, t += HOUR) if (hourIn(tz, t) === LIMITS.quiet[1]) return t; return ms + 12 * HOUR; }

/** The host's line, cleaned: no control characters, no em dashes, no links (the invite link is added for each person). */
export function cleanBody(v) {
  return String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s*—\s*/g, ", ")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ").replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|app|ly|me|link|xyz|info|dev|page|site|gg|to)\b(?:\/\S*)?/gi, " ")
    .replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, LIMITS.bodyMax);
}
/** The line Potto suggests. */
export function defaultBody(who, ev) { const t = titleOf(ev), w = whenLine(ev); return who === "maybe" ? `Still a maybe for ${t}${w ? ` on ${w}` : ""}? A yes or a no both help me plan.` : `Are you in for ${t}${w ? ` on ${w}` : ""}?`; }
/** The whole message one person gets. */
export function compose({ name = "", host = "", body = "", link = "" }) { const hi = [name ? `Hi ${name},` : "Hi,", host ? `${host} here.` : ""].filter(Boolean).join(" "); return `${hi} ${body} One tap to reply: ${link}`.replace(/\s+/g, " ").trim(); }
export const STOP_TAIL = " Reply STOP to opt out.";

// what the host asked Potto for
const NOREPLY = /\b(has ?n'?t|have ?n'?t|has not|have not|not|never|yet to|didn'?t|did not)\b[^.?!]{0,30}\b(repl|respond|answer|rsvp|got back|said)|\bnon[- ]?(repl|respond)|\bno[- ]repl|\bstragglers\b|\b(quiet|silent) ones\b/i;
const VERB = /\b(nudg(e|ing)|chase|ping|poke|prod|follow(ing)?[- ]?up|remind|re-?send|message|text|email|write to|check in with)\b/i;
export const isNudgeAsk = (m) => (VERB.test(m) && NOREPLY.test(m)) || /\bnudge\b[^.?!]*\b(them|people|everyone|everybody|guests|friends|the rest|invitees)\b/i.test(m) || /^\s*(yes|ok|okay|sure|please)?[,.! ]*(please )?nudge( them)?( please)?[.!]?\s*$/i.test(m);
export const isMaybeAsk = (m) => /\b(nudg(e|ing)|chase|ping|poke|message|text|email|write to|remind|check in with|follow(ing)?[- ]?up)\b[^.?!]*\bmaybes?\b/i.test(m);
export const isWhoNudged = (m) => /\bwho\b[^.?!]*\b(did|have|has)\b[^.?!]*\bnudged?\b|\bwho (got|was|were|has been|have been) nudged\b|\b(did|have) (i|you|we)\b[^.?!]*\bnudged?\b[^.?!]*\b(anyone|anybody|already|yet)\b|\bwhen did (i|you|we) (last )?nudge\b/i.test(m);
export const isRemindIn = (m) => /\bremind\b[^.?!]*\b(everyone|everybody|people|guests|all|those|the ones)\b[^.?!]*\b(who|that)('?s| is| are| said)? ?(i'?m )?(in|going|coming|yes)\b/i.test(m);

export function makeNudges({ store, C, X, I, F, inviteToken = null, clock: clock0 = () => Date.now() }) {
  let clock = clock0;
  const S0 = (ws) => scopeStore(store, ws);
  const recPath = (ws, id) => "system/nudge-" + h24(ws + "|" + id), usePath = (ws) => "system/nudgeuse-" + h24("ws|" + ws);
  const rec = (ws, id) => { const d = store.get(recPath(ws, id))?.data || {}; return { kind: "nudge", ws, eventId: id, people: d.people && typeof d.people === "object" ? d.people : {}, sends: Array.isArray(d.sends) ? d.sends : [], queue: Array.isArray(d.queue) ? d.queue : [], dismissedAt: +d.dismissedAt || 0 }; };
  const saveRec = (ws, id, r) => store.set(recPath(ws, id), { ...r, sends: r.sends.slice(-40), updatedAt: clock() });
  const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
  const usedToday = (ws) => { const u = store.get(usePath(ws))?.data; return u && u.day === dayKey(clock()) ? +u.n || 0 : 0; };
  const spend = (ws) => store.set(usePath(ws), { kind: "nudgeuse", ws, day: dayKey(clock()), n: usedToday(ws) + 1 });
  const capLeft = (ws) => Math.max(0, nudgesPerDay() - usedToday(ws));
  const eventOf = (ws, id) => (ID.test(String(id || "")) ? S0(ws).get("events/" + id)?.data || null : null);
  const tzOf = (ws, ev) => { let h = ""; try { h = pottoSettings(S0(ws)).tz; } catch {} return eventTz(ev, h); };
  const hostName = (ws, u) => first(u?.name) || first(C?.profileOf?.(ws)?.name) || "";
  const mutedHost = (ws, email) => { try { const h = lc(C?.profileOf?.(ws)?.handle); if (!h || !email) return false; const M = store.get("system/inboxprefs-" + h24(lc(email)))?.data?.mutedHosts || []; return M.some((m) => lc(m?.handle || m) === h); } catch { return false; } };

  /** Why this event can't be nudged right now, or "". */
  function gate(ws, ev, t = clock()) {
    if (!ev || ev.example || ev.sample) return "I can't find that event.";
    if (ev.cancelled) return "That one was cancelled, so there's nothing to nudge.";
    if (!(ev.published || ev.discoverable)) return "This invite isn't shared yet. Share it first, then I can nudge.";
    const s = startOf(ev, tzOf(ws, ev)); if (!s) return "";
    if (t >= s) return "It has already started, so it's too late to nudge.";
    if (t > s - LIMITS.nearMs) return "It starts in under 2 hours, so I won't nudge anyone now.";
    return "";
  }

  /** Everyone the host invited here who hasn't replied (or, for "maybe", who said Maybe). One entry per person. */
  function candidates(ws, id, who = "noreply") {
    const ev = eventOf(ws, id); if (!ev) return null; const S = S0(ws);
    const R = S.list("rsvps").map((d) => ({ rid: d.id, ...(d.data || {}) })).filter((r) => r.eventId === id && !r.deletedAccount);
    const replied = new Set(); for (const r of R) { if (r.email) replied.add(lc(r.email)); if (r.phone) replied.add("tel:" + digits(r.phone)); if (r.name) replied.add("n:" + lc(r.name)); }
    const hasReply = (c) => (c.email && replied.has(lc(c.email))) || (c.phone && replied.has("tel:" + digits(c.phone))) || (c.full && replied.has("n:" + lc(c.full)));
    const out = new Map(), add = (c) => { const key = keyFor(c.email, c.phone); const pid = key ? idOf(key) : c.pid; if (!pid || out.has(pid)) return; out.set(pid, { ...c, pid, email: EMAIL_RE.test(lc(c.email)) && !/\.invalid$/i.test(c.email) ? lc(c.email) : "", phone: /^\+?\d{7,16}$/.test(digits(c.phone)) ? digits(c.phone) : "" }); };
    let rows = []; try { rows = I?.rowsOf?.(ws, id)?.rows || []; } catch {}
    const planLink = (pid) => { try { return `/api/public/inv/${I.tokenOf(ws, id, pid)}`; } catch { return ""; } };
    if (who === "maybe") {
      const inPlan = new Set(rows.filter((x) => x.planned).map((x) => x.p.id)), seen = new Set();
      for (const r of R.sort((a, b) => (b.changedAt || b.createdAt || 0) - (a.changedAt || a.createdAt || 0))) { const key = keyFor(r.email, r.phone), k2 = key || "n:" + lc(r.name); if (seen.has(k2)) continue; seen.add(k2); if (r.response !== "maybe") continue;
        const pid = key ? idOf(key) : "r" + h24(r.rid); add({ pid, full: r.name || "", email: r.email, phone: r.phone, smsOk: r.smsOk, link: inPlan.has(pid) ? planLink(pid) : `/g#rsvp-${id}`, at: r.changedAt || r.createdAt || 0, source: "reply", reminders: rows.find((x) => x.p.id === pid)?.entry?.reminders || [] }); }
      return { ev, list: [...out.values()], rows };
    }
    for (const x of rows) { if (!x.planned || !x.entry?.invitedAt || x.r || !["invited", "seen"].includes(x.status)) continue; const c = { full: x.p.fullName || x.p.name || "", email: x.p.email, phone: x.p.phone, consent: x.p.consent?.status || "", link: planLink(x.p.id), at: x.entry.invitedAt, source: "plan", reminders: x.entry.reminders || [] }; if (!hasReply(c)) add(c); }
    (ev.guests || []).forEach((g, i) => { if (!g || !(/^invited$/i.test(String(g.status || "").trim()) || (g.invitedAt && !g.status))) return; const c = { full: g.name || "", email: g.email, phone: g.phone, at: +g.invitedAt || +g.addedAt || 0, source: "list", reminders: [] }; if (!keyFor(c.email, c.phone) || hasReply(c)) return;
      const gk = g.id ? String(g.id) : lc(g.email) || lc(g.name); let tok = ""; try { tok = inviteToken ? inviteToken(ws, id, gk) : ""; } catch {}
      add({ ...c, link: `/#rsvp-${id}.g${i}${tok && gk ? `.i-${b64u(gk)}~${tok}` : ""}` }); });
    for (const d of S.list("textinvites")) { const x = d.data || {}; if (x.eventId !== id || !x.phone) continue; const c = { full: "", email: "", phone: x.phone, at: +x.at || 0, source: "text", reminders: [], link: `/g#rsvp-${id}` }; if (!hasReply(c)) add(c); }
    return { ev, list: [...out.values()], rows };
  }

  /** Sort the candidates into who gets it, who is skipped (with a reason the host may see) and who is left out silently. */
  function sortOut(ws, id, who = "noreply", { t = clock(), ignoreQueue = false } = {}) {
    const X0 = candidates(ws, id, who); if (!X0) return null; const { ev } = X0, r = rec(ws, id), tz = tzOf(ws, ev);
    const mail = emailConfig(ws, false) || emailConfig(DEFAULT_WS, true), sms = smsConfig(), brand = isBrandWs(ws);
    const ok = [], skipped = [];
    for (const c of X0.list) {
      const name = c.full ? String(c.full).trim() : c.phone ? `Number ending ${c.phone.slice(-4)}` : "Someone", fn = first(c.full);
      const base = { pid: c.pid, name, first: fn, email: c.email, phone: c.phone, link: c.link, at: c.at, source: c.source };
      // privacy first: these people are never listed
      let hidden = false; try { hidden = (!!c.email && !!F?.blocked?.(ws, c.email)) || mutedHost(ws, c.email); } catch {} if (hidden) continue;
      const P = r.people[c.pid] || {}, times = [...new Set([...(P.at || []), ...(c.reminders || [])].map(Number).filter(Boolean))].sort((a, b) => a - b), last = times[times.length - 1] || 0;
      const row = { ...base, nudges: times.length, last };
      const skip = (why) => skipped.push({ ...row, why });
      if (c.email && isUnsubscribed(c.email)) { skip("unsubscribed from emails"); continue; }
      if (c.email && X?.canEmail && X.canEmail(c.email) === false) { skip("emails are off"); continue; }
      if (c.phone && smsStopped(c.phone)) { skip("replied STOP to texts"); continue; }
      if (c.email && brand && !["in", "activity"].includes(c.consent || (who === "maybe" ? "activity" : ""))) { skip("hasn't opted in to your emails"); continue; }
      let channel = "";
      if (c.email && mail) channel = "email"; else if (c.phone && c.smsOk === false) { skip("texts are off"); continue; } else if (c.phone && sms) channel = "text";
      if (!channel) { skip(!c.email && !c.phone ? "no email or phone" : c.email && !c.phone ? "email isn't set up here" : c.phone && !c.email ? "texting isn't set up here" : "no way to reach them here"); continue; }
      row.channel = channel;
      if (P.queued && !ignoreQueue) { skip(`a nudge is already waiting for ${clock12(String(hourIn(tz, P.queued)).padStart(2, "0") + ":00")}`); continue; }
      if (times.length >= LIMITS.perPerson) { skip("already nudged twice"); continue; }
      if (last && t - last < LIMITS.gapMs) { skip(`nudged ${dayLabel(last, t, tz)}, next from ${dayLabel(last + LIMITS.gapMs, t, tz)}`); continue; }
      ok.push(row);
    }
    const byName = (a, b) => a.name.localeCompare(b.name); ok.sort(byName); skipped.sort(byName); // a steady order, so the sheet and the report read the same each time
    return { ev, tz, ok, skipped, known: X0.list.length, rec: r };
  }

  const groupChat = (ws, id) => { try { const R = S0(ws).list("rsvps").map((d) => d.data || {}).filter((r) => r.eventId === id && r.response === "going"); return R.length; } catch { return 0; } };

  /** What the confirm sheet shows. Names and a channel word, never an address or a number. */
  function preview(ws, id, u, { who = "noreply", origin = "", body = "" } = {}) {
    const X0 = sortOut(ws, id, who); if (!X0) return null; const { ev, tz, ok, skipped } = X0, t = clock(), host = hostName(ws, u), title = titleOf(ev);
    const line = cleanBody(body) || defaultBody(who, ev), g = gate(ws, ev, t), quiet = inQuiet(t, tz);
    const linkOnly = who === "noreply" && !X0.known, going = groupChat(ws, id), pub = `${origin}/e/${encodeURIComponent(id)}`;
    const o = { event: { id, title, when: whenLine(ev) }, who, host, body: line, bodyMax: LIMITS.bodyMax, gate: g, count: ok.length,
      people: ok.map((p) => ({ id: p.pid, name: p.name, channel: p.channel, by: p.channel === "email" ? "by email" : "by text", nudged: p.nudges, last: p.last ? dayLabel(p.last, t, tz) : "" })),
      skipped: skipped.map((p) => ({ name: p.name, why: p.why })), linkOnly, cap: { left: capLeft(ws), perDay: nudgesPerDay() },
      quiet: quiet && !g ? { at: "9am" } : null, limits: { perPerson: LIMITS.perPerson, gapDays: LIMITS.gapMs / DAY } };
    if (ok.length) { const p = ok[0]; o.sample = { name: p.name, pre: [p.first ? `Hi ${p.first},` : "Hi,", host ? `${host} here.` : ""].filter(Boolean).join(" "), post: `One tap to reply: ${origin}${p.link}`, text: compose({ name: p.first, host, body: line, link: origin + p.link }) + (p.channel === "text" ? STOP_TAIL : "") }; o.channels = { email: ok.filter((x) => x.channel === "email").length, text: ok.filter((x) => x.channel === "text").length }; }
    if (linkOnly || !ok.length) o.paste = { text: `Hi all${host ? `, ${host} here` : ""}. ${who === "maybe" ? line : `Are you in for ${title}${whenLine(ev) ? ` on ${whenLine(ev)}` : ""}?`} One tap to reply: ${pub}`, link: pub, chat: going && !g ? { going, url: `/api/chats/${encodeURIComponent(id)}/messages` } : null };
    return o;
  }

  async function deliver(ws, id, ev, p, { who, body, origin, host }) {
    const title = titleOf(ev), text = compose({ name: p.first, host, body, link: origin + p.link });
    if (p.channel === "email") { const cfg = emailConfig(ws, false) || emailConfig(DEFAULT_WS, true); if (!cfg) return { ok: false, why: "email isn't set up here" };
      const r = await sendEmail(cfg, { list: "guest", origin, to: p.email, fromName: C?.profileOf?.(ws)?.name || host || "", subject: who === "maybe" ? `Still a maybe for ${title}?` : `Are you in for ${title}?`, text: text + "\n" });
      return r.ok ? { ok: true } : { ok: false, why: r.code === "unsubscribed" ? "unsubscribed from emails" : "the email didn't go through" }; }
    const r = await sendSms(smsConfig(), { to: p.phone, text: text + STOP_TAIL });
    return r.ok ? { ok: true } : { ok: false, why: r.stopped ? "replied STOP to texts" : "the text didn't go through" };
  }
  function mark(ws, id, p, t, r) { const P = r.people[p.pid] || { at: [] }; r.people[p.pid] = { ...P, name: p.name, keys: [p.email, lc(p.name)].filter(Boolean), ch: p.channel, at: [...(P.at || []), t] }; delete r.people[p.pid].queued;
    if (p.source === "plan") { try { const pl = I.plan(ws, id); if (pl.people[p.pid]) { pl.people[p.pid].reminders = [...(pl.people[p.pid].reminders || []), t]; I.save(ws, id, pl); } } catch {} } }

  /** What happened, in Potto's words. Only what really went out is called sent. */
  function reportOf({ sent, queued, held, skipped, who }) {
    const out = [], names = (L) => (L.length <= 3 ? list(L.map((x) => first(x.name) || x.name)) : String(L.length));
    if (sent.length) out.push(`Sent to ${names(sent)}.`);
    if (queued.length) out.push(`It's after 9pm where your guests are, so ${queued.length === 1 ? `the nudge to ${first(queued[0].name) || queued[0].name} goes` : `${sent.length ? "the other " : ""}${queued.length} nudges go`} out at 9am.`);
    if (!sent.length && !queued.length) out.push(skipped.length || held.length ? "I didn't send anything." : who === "maybe" ? "No one said Maybe, so there was no one to message." : "There was no one to nudge.");
    if (skipped.length === 1) { const s = skipped[0], n = first(s.name) || s.name; out.push(/^(emails|texts) are off$/.test(s.why) ? `${n} has ${s.why.replace(" are", "")}, so I skipped them.` : `I skipped ${n} (${s.why}).`); }
    else if (skipped.length) out.push(`I skipped ${list(skipped.slice(0, 6).map((s) => `${first(s.name) || s.name} (${s.why})`))}${skipped.length > 6 ? ` and ${skipped.length - 6} more` : ""}.`);
    if (held.length) out.push(`You've reached today's limit of ${nudgesPerDay()} nudges, so ${held.length === 1 ? `${first(held[0].name) || held[0].name} is` : `${held.length} are`} still waiting. Ask me again tomorrow.`);
    return out.join(" ");
  }

  /** Send (or, in quiet hours, queue) the nudge the host confirmed. */
  async function send(ws, id, u, { who = "noreply", body = "", origin = "" } = {}) {
    const X0 = sortOut(ws, id, who); if (!X0) return { error: "No such event.", status: 404 }; const { ev, tz, ok, skipped } = X0, t = clock();
    const g = gate(ws, ev, t); if (g) return { error: g, status: 409, code: "too_late" };
    const line = cleanBody(body) || defaultBody(who, ev); const bad = textProblem(line); if (bad) return { error: bad.message, status: 400, code: bad.code };
    if (line.length < 3) return { error: "Write a line first.", status: 400 };
    const host = hostName(ws, u), quiet = inQuiet(t, tz), due = quiet ? nextMorning(t, tz) : 0, r = X0.rec, sent = [], queued = [], held = [], failed = [];
    for (const p of ok) {
      if (capLeft(ws) <= 0) { held.push(p); continue; }
      if (quiet) { r.queue.push({ pid: p.pid, who, body: line, origin, host, due, by: lc(u?.email) }); r.people[p.pid] = { ...(r.people[p.pid] || { at: [] }), name: p.name, keys: [p.email, lc(p.name)].filter(Boolean), ch: p.channel, queued: due }; spend(ws); queued.push(p); continue; }
      const d = await deliver(ws, id, ev, p, { who, body: line, origin, host });
      if (d.ok) { mark(ws, id, p, t, r); spend(ws); sent.push(p); } else failed.push({ ...p, why: d.why }); }
    if (sent.length || queued.length) { r.sends.push({ at: t, who, n: sent.length, queued: queued.length, by: lc(u?.email) }); try { S0(ws).add("outbox", { kind: "nudge", eventId: id, to: [`${sent.length + queued.length} ${sent.length + queued.length === 1 ? "guest" : "guests"}`], subject: line.slice(0, 200), at: t, status: queued.length && !sent.length ? "queued" : "sent" }); } catch {} }
    saveRec(ws, id, r);
    const all = [...skipped, ...failed];
    return { ok: true, sent: sent.length, queued: queued.length, held: held.length, skipped: all.map((s) => ({ name: s.name, why: s.why })), queuedFor: due || 0, report: reportOf({ sent, queued, held, skipped: all, who }) };
  }

  /** Queued nudges whose morning has come. People who replied since, or who can't be nudged any more, are dropped. */
  async function runDue(t = clock()) { let out = 0, docs = []; try { docs = store.listPrefix("system", "nudge-"); } catch { return { sent: 0 }; }
    for (const d of docs) { const x = d.data || {}; if (x.kind !== "nudge" || !Array.isArray(x.queue) || !x.queue.some((q) => q.due <= t)) continue; const { ws, eventId: id } = x, ev = eventOf(ws, id), r = rec(ws, id);
      const due = r.queue.filter((q) => q.due <= t); r.queue = r.queue.filter((q) => q.due > t);
      for (const q of due) { if (r.people[q.pid]) delete r.people[q.pid].queued; }
      saveRec(ws, id, r); if (!ev || gate(ws, ev, t)) continue;
      for (const who of [...new Set(due.map((q) => q.who))]) { const X0 = sortOut(ws, id, who, { t }); if (!X0) continue; const r2 = X0.rec;
        for (const q of due.filter((z) => z.who === who)) { const p = X0.ok.find((z) => z.pid === q.pid); if (!p) continue; const dv = await deliver(ws, id, ev, p, { who, body: q.body, origin: q.origin || process.env.ENCORE_PUBLIC_URL || "", host: q.host }); if (dv.ok) { mark(ws, id, p, t, r2); out++; } }
        saveRec(ws, id, r2); } }
    return { sent: out }; }

  /** For the overview: how many are waiting, who was nudged and when, and the proactive line if it's time. */
  function state(ws, id, { t = clock() } = {}) {
    const X0 = sortOut(ws, id, "noreply", { t }); if (!X0) return null; const { ev, tz, ok, skipped, rec: r } = X0, g = gate(ws, ev, t);
    const cur = new Set([...ok, ...skipped].map((p) => p.pid));
    const nudged = Object.entries(r.people).filter(([, P]) => (P.at || []).length || P.queued).map(([pid, P]) => { const last = (P.at || [])[(P.at || []).length - 1] || 0; return { id: pid, name: P.name || "", keys: P.keys || [], n: (P.at || []).length, waiting: cur.has(pid), label: P.queued && !last ? "Nudge goes at 9am" : `Nudged ${dayLabel(last, t, tz)}` }; });
    for (const p of [...ok, ...skipped]) if (p.nudges && !nudged.some((n) => n.id === p.pid)) nudged.push({ id: p.pid, name: p.name, keys: [p.email, lc(p.name)].filter(Boolean), n: p.nudges, waiting: true, label: `Nudged ${dayLabel(p.last, t, tz)}` });
    return { eventId: id, waiting: ok.length + skipped.length, can: g ? 0 : ok.length, gate: g, linkOnly: !X0.known, nudged, suggest: suggestOf(ws, id, { t, X0 }) };
  }
  function suggestOf(ws, id, { t = clock(), X0 = null } = {}) {
    X0 = X0 || sortOut(ws, id, "noreply", { t }); if (!X0) return null; const { ev, tz, ok, skipped, rec: r } = X0;
    if (gate(ws, ev, t) || ok.length < LIMITS.minToSuggest || !ISO.test(ev.date || "")) return null;
    if (r.dismissedAt && t - r.dismissedAt < LIMITS.gapMs) return null;
    const lastSend = Math.max(0, ...r.sends.map((s) => +s.at || 0), ...Object.values(r.people).flatMap((P) => [...(P.at || []), P.queued || 0]), ...ok.map((p) => p.last || 0)); if (lastSend && t - lastSend < LIMITS.gapMs) return null;
    const start = startOf(ev, tz), known = ok.map((p) => p.at).filter(Boolean), sentAt = known.length ? Math.min(...known) : 0;
    const aged = (sentAt && t - sentAt >= LIMITS.afterInviteMs) || (start && t >= start - LIMITS.beforeEventMs); if (!aged) return null;
    // the count is everyone still to reply (the overview says the same number); the sheet then shows who gets it and who doesn't
    const title = titleOf(ev), n = ok.length + skipped.length; return { eventId: id, title, n, can: ok.length, line: `${people(n)} haven't replied to ${title}. Want me to nudge them?` };
  }
  const upcoming = (ws, t = clock()) => { const today = new Date(t - DAY).toISOString().slice(0, 10); try { return S0(ws).list("events").map((d) => ({ id: d.id, e: d.data || {} })).filter(({ e }) => !e.example && !e.sample && !e.cancelled && ISO.test(e.date || "") && e.date >= today && (e.published || e.discoverable)).sort((a, b) => a.e.date.localeCompare(b.e.date)).slice(0, 12); } catch { return []; } };
  /** One line at a time: the soonest event that needs it. */
  function suggestTop(ws, { t = clock() } = {}) { for (const { id } of upcoming(ws, t)) { try { const s = suggestOf(ws, id, { t }); if (s) return s; } catch {} } return null; }
  function dismiss(ws, id) { const r = rec(ws, id); r.dismissedAt = clock(); saveRec(ws, id, r); return { ok: true }; }

  /** Potto's context gains the people on the invite plan who haven't replied, and who was nudged (first names only). */
  function enrich(u, ctx) { try { const t = clock(); for (const e of ctx.myEvents || []) { if (e.date < ctx.today) continue; const X0 = sortOut(u.ws, e.id, "noreply", { t }); if (!X0) continue;
      const names = [...X0.ok, ...X0.skipped].map((p) => first(p.name)).filter(Boolean); e.noReply = [...new Set([...(e.noReply || []), ...names])].slice(0, 40); e.canNudge = gate(u.ws, X0.ev, t) ? 0 : X0.ok.length;
      const N = Object.values(X0.rec.people).filter((P) => (P.at || []).length).map((P) => ({ name: first(P.name), day: dayLabel(P.at[P.at.length - 1], t, X0.tz) })).filter((x) => x.name); if (N.length) e.nudged = N.slice(0, 40); } } catch {} return ctx; }

  /** Ask Potto: the nudge asks, answered here from the lists above. Returns null for anything else. */
  function pottoAnswer(u, message, ctx, { origin = "" } = {}) {
    const m = String(message || ""), mine = (ctx?.myEvents || []).filter((e) => e.date >= ctx.today);
    const whoN = isWhoNudged(m), maybe = !whoN && isMaybeAsk(m), nudge = !whoN && !maybe && isNudgeAsk(m), remindIn = !whoN && !maybe && !nudge && isRemindIn(m);
    if (!whoN && !maybe && !nudge && !remindIn) return null;
    if (!mine.length) return { answer: "You have no upcoming events right now, so there's no one to nudge.", links: [{ label: "New event", href: "/?app=1&new=1#studio" }] };
    if (remindIn) { const reply = pottoReply(m, ctx, { mode: "fake" }); if (reply?.intent !== "remind") return null; const ev = reply.action ? eventOf(u.ws, reply.action.eventId) : null;
      if (ev && ev.autoRemind !== false && reply.action) reply.answer += " Everyone who's in also gets my reminder the day before, so you don't have to."; return { reply }; }
    // the event: the one attached or named, else the soonest with someone to nudge
    const named = pickEvent(mine.filter((e) => e.id === ctx.attached || String(e.title || "").toLowerCase().split(/[^a-z0-9]+/).some((w) => w.length > 3 && m.toLowerCase().includes(w))), m, ctx.today, ctx.attached);
    const want = maybe ? "maybe" : "noreply", has = (e) => { try { const X0 = sortOut(u.ws, e.id, want); return !!X0 && X0.ok.length > 0; } catch { return false; } };
    const hasRec = (e) => Object.values(rec(u.ws, e.id).people).some((P) => (P.at || []).length || P.queued);
    const e = named || (whoN ? mine.find(hasRec) : mine.find(has)) || mine[0], links = [{ label: "Guest list", href: e.guestsLink }];
    if (whoN) { const r = rec(u.ws, e.id), t = clock(), tz = tzOf(u.ws, eventOf(u.ws, e.id)), X0 = sortOut(u.ws, e.id, "noreply"), still = new Set((X0 ? [...X0.ok, ...X0.skipped] : []).map((p) => p.pid));
      const L = Object.entries(r.people).filter(([, P]) => (P.at || []).length || P.queued).map(([pid, P]) => ({ pid, name: first(P.name) || P.name || "Someone", last: (P.at || [])[(P.at || []).length - 1] || 0, n: (P.at || []).length, queued: P.queued || 0, ch: P.ch }));
      for (const p of X0 ? [...X0.ok, ...X0.skipped] : []) if (p.nudges && !L.some((x) => x.pid === p.pid)) L.push({ pid: p.pid, name: first(p.name) || p.name, last: p.last, n: p.nudges, queued: 0, ch: p.channel });
      if (!L.length) return { answer: `You haven't nudged anyone about ${e.title} yet.`, links };
      const bits = L.slice(0, 12).map((x) => `${x.name} (${x.last ? `${dayLabel(x.last, t, tz)}${x.n > 1 ? ", twice" : ""}` : "goes at 9am"})`), back = L.filter((x) => x.last && !still.has(x.pid)).map((x) => x.name);
      return { answer: `For ${e.title} you nudged ${list(bits)}${L.length > 12 ? ` and ${L.length - 12} more` : ""}.${back.length ? ` ${list(back.slice(0, 6))} ${back.length === 1 ? "has" : "have"} replied since.` : ""}`, links }; }
    const P = preview(u.ws, e.id, u, { who: want, origin }); if (!P) return null;
    const action = { id: `nudge-${want}-${e.id}`, type: "nudge", eventId: e.id, who: want, label: "Check and send" };
    const skippedLine = P.skipped.length ? ` I'd skip ${list(P.skipped.slice(0, 5).map((s) => `${first(s.name) || s.name} (${s.why})`))}${P.skipped.length > 5 ? ` and ${P.skipped.length - 5} more` : ""}.` : "";
    if (P.gate) return { answer: P.gate, links };
    if (P.count) { const names = P.people.slice(0, 8).map((p) => `${first(p.name) || p.name} ${p.by}`);
      return { answer: `${maybe ? `${people(P.count)} said Maybe to ${e.title}` : `I can nudge ${people(P.count)} about ${e.title}`}: ${list(names)}${P.count > 8 ? ` and ${P.count - 8} more` : ""}.${skippedLine} Here's the message. Nothing goes out until you tap Send.${P.quiet ? " It's late where they are, so it would go at 9am." : ""}`, links, actions: [action] }; }
    if (P.linkOnly) return { answer: `You shared ${e.title} as a link, so I can't see who has it and I can't message them myself. Here's a nudge to paste where you shared it${P.paste?.chat ? ", or post it to the group chat for the guests already in" : ""}:\n\n"${P.paste.text}"`, links, actions: [{ ...action, label: "Copy or share it" }] };
    if (maybe) return { answer: P.skipped.length ? `No one I can message right now.${skippedLine}` : `No one said Maybe to ${e.title}.`, links };
    return { answer: P.skipped.length ? `No one I can nudge about ${e.title} right now.${skippedLine}` : `Everyone you invited to ${e.title} has replied.`, links };
  }

  return { gate, candidates, sortOut, preview, send, runDue, state, suggestOf, suggestTop, dismiss, enrich, pottoAnswer, rec, capLeft, setClock: (fn) => { clock = fn || clock0; } };
}

export function mountPottoNudge(app, { store, small, currentUser, C, X, publicOrigin = () => "" }) {
  const N = makeNudges({ store, C, X, I: app.locals.invites, F: app.locals.fanclub, inviteToken: (...a) => app.locals.inviteTokenOf?.(...a) || "" });
  app.locals.pottoNudge = N;
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const origin = (req) => { try { return publicOrigin(req) || ""; } catch { return ""; } };
  const host = (req, res) => { let u = null; try { u = currentUser(req); } catch {} if (!u || !u.email || !u.ws || u.ws === DEFAULT_WS) { bad(res, "Sign in first.", 401, "unauthenticated"); return null; } res.set("Cache-Control", "private, no-store");
    if ("id" in req.params) { const id = String(req.params.id || ""); const ev = ID.test(id) ? scopeStore(store, u.ws).get("events/" + id)?.data : null; if (!ev || ev.example) { bad(res, "No such event.", 404, "not_found"); return null; } return { u, ws: u.ws, id }; } return { u, ws: u.ws }; };
  const whoOf = (v) => (v === "maybe" ? "maybe" : "noreply");
  app.get("/api/host/nudge/suggest", (req, res) => { const H = host(req, res); if (!H) return; let s = null; try { s = N.suggestTop(H.ws); } catch {} res.json({ suggest: s }); });
  app.get("/api/host/nudge/:id/state", (req, res) => { const H = host(req, res); if (!H) return; res.json(N.state(H.ws, H.id) || { waiting: 0, can: 0, nudged: [], suggest: null }); });
  app.get("/api/host/nudge/:id", (req, res) => { const H = host(req, res); if (!H) return; res.json(N.preview(H.ws, H.id, H.u, { who: whoOf(req.query.who), origin: origin(req) })); });
  app.post("/api/host/nudge/:id/send", small, async (req, res) => { const H = host(req, res); if (!H) return; const b = req.body || {};
    if (b.confirm !== true) return bad(res, "Check who gets it and the message, then tap Send.", 400, "confirm_required");
    const r = await N.send(H.ws, H.id, H.u, { who: whoOf(b.who), body: typeof b.body === "string" ? b.body : "", origin: origin(req) }); if (r.error) return bad(res, r.error, r.status, r.code);
    res.json({ ...r, state: N.state(H.ws, H.id) }); });
  app.post("/api/host/nudge/:id/dismiss", small, (req, res) => { const H = host(req, res); if (!H) return; res.json(N.dismiss(H.ws, H.id)); });
  if (!process.env.NODE_TEST_CONTEXT) { const t = setInterval(() => N.runDue().catch((e) => console.warn("[nudges]", e?.message)), 5 * 60e3); t.unref?.(); }
  return N;
}
