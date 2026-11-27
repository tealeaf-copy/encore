// ---- the host's reply summary: one calm email per event every few hours, never one per reply ----
// The first yes on an event emails the host at once (server/app.js afterRsvp). Every reply after it lands in the bell,
// and here: note() keeps who replied since the last email, and run() sends one short summary per event.
//
// The rules, in one place:
// - At most one email per event every GAP (4 hours). The first-yes email counts as one.
// - A summary waits DELAY (30 minutes) after the first new reply, so a burst of replies lands together.
// - Never at night (the event's own time zone, the same quiet hours as reminders).
// - Only what the host hasn't seen: a reply already read in the bell is dropped from the summary.
// - One line per guest, their latest answer only. A guest who said yes and then can't shows as can't.
// - Off when the host turned off Emails or "Reply summaries" in Settings, or turned Replies off in the Inbox.
// - Never to a placeholder address (.invalid), never for an example or cancelled event, or one that's over.
// Each summary is logged in the workspace outbox like any other email (kind "replydigest").
import { scopeStore, getWorkspace, allWorkspaceIds, DEFAULT_WS } from "./workspaces.js";
import { isQuiet } from "./reminders.js";
import { eventTz } from "./tz.js";

export const REPLY_DIGEST_GAP = Math.max(1, +process.env.ENCORE_REPLY_DIGEST_GAP_HOURS || 4) * 3600e3;
export const REPLY_DIGEST_DELAY = 30 * 60e3;
const ID = /^[A-Za-z0-9_-]{1,80}$/, MAX_NAMES = 12;
const clean = (s, n) => String(s ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const GROUPS = [["going", "I'm in"], ["maybe", "Maybe"], ["no", "Can't go"], ["waitlist", "On the waitlist"], ["order", "Ordered"]];
const stateOf = (r) => (r === "declined" ? "no" : r);
const today = (now) => new Date(now).toISOString().slice(0, 10);
const whenOf = (ev) => (/^\d{4}-\d{2}-\d{2}$/.test(ev?.date || "") ? new Date(ev.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "");

/** The plain text and the simple HTML of one summary. Pure, so the words are easy to test. */
export function digestCopy({ title, when = "", items = [], totals = {}, link, settings }) {
  const n = items.length, by = (k) => items.filter((x) => x.state === k);
  const names = (L) => { const N = L.slice(0, MAX_NAMES).map((x) => x.name + (x.plus ? ` +${x.plus}` : "") + (x.order ? ` (${x.order})` : "")); return N.join(", ") + (L.length > MAX_NAMES ? ` and ${L.length - MAX_NAMES} more` : ""); };
  const rows = GROUPS.map(([k, label]) => [label, by(k)]).filter(([, L]) => L.length);
  const sum = [totals.going ? `${totals.going} in` : "", totals.maybe ? `${totals.maybe} maybe` : "", totals.no ? `${totals.no} can't go` : ""].filter(Boolean).join(", ");
  const subject = n === 1 ? `${items[0].name} ${{ going: "is in for", maybe: "said maybe to", no: "can't go to", waitlist: "joined the waitlist for", order: "ordered from" }[items[0].state] || "replied to"} ${title}` : `${n} new replies for ${title}`;
  const head = `${n === 1 ? "One new reply" : `${n} new replies`} for ${title}${when ? ` (${when})` : ""}.`;
  const foot = "You get at most one of these every few hours for each event, never one per reply.";
  const text = `${head}\n\n${rows.map(([label, L]) => `${label} (${L.length}): ${names(L)}`).join("\n")}\n${sum ? `\nSo far: ${sum}.\n` : ""}\nSee the guest list: ${link}\n\n${foot} Turn them off in Settings: ${settings}\n`;
  const html = `<!doctype html><html><body style="margin:0;background:#EFEBE2"><div style="max-width:560px;margin:0 auto;background:#FBF8F1;border-top:4px solid #29489A;font:16px/1.5 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1B1D1C"><div style="padding:24px 24px 8px">` +
    `<p style="margin:0 0 16px;font-size:18px;font-weight:600">${esc(head)}</p>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 16px">${rows.map(([label, L]) => `<tr><td style="padding:10px 12px 10px 0;border-top:1px solid #DDD6C8;vertical-align:top;white-space:nowrap;color:#5A5F5C;font-size:14px">${esc(label)} (${L.length})</td><td style="padding:10px 0;border-top:1px solid #DDD6C8">${esc(names(L))}</td></tr>`).join("")}</table>` +
    (sum ? `<p style="margin:0 0 20px;color:#5A5F5C">So far: ${esc(sum)}.</p>` : "") +
    `<p style="margin:0 0 24px"><a href="${esc(link)}" style="display:inline-block;background:#29489A;color:#FFFFFF;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:6px">See the guest list</a></p>` +
    `<p style="margin:0 0 16px;font-size:13px;color:#5A5F5C">${esc(foot)} <a href="${esc(settings)}" style="color:#29489A">Turn them off in Settings</a>.</p></div></div></body></html>`;
  return { subject, text, html };
}

export function makeReplyDigest({ store, X, mail, inboxPrefs = null }) {
  const S = (ws) => scopeStore(store, ws), path = (eventId) => "replydigest/" + eventId;
  const doc = (ws, eventId) => S(ws).get(path(eventId))?.data || { pending: [], lastSentAt: 0 };
  const save = (ws, eventId, d) => S(ws).set(path(eventId), { kind: "replydigest", eventId, pending: (d.pending || []).slice(-200), lastSentAt: d.lastSentAt || 0, ...(d.origin ? { origin: d.origin } : {}) });
  /** Is the summary on for this host? The Emails switch, the Reply summaries switch, and Replies in the Inbox. */
  const wants = (email) => { const p = X.prefs(email) || {}; if (p.emails === false || p.replyDigest === false) return false; try { if ((inboxPrefs?.(email)?.offTypes || []).includes("reply")) return false; } catch {} return true; };
  /** A guest's reply changed. Kept until the next summary. */
  function note(ws, eventId, { rid, name, state, was = "", plus = 0, order = "", origin = "", at = Date.now() } = {}) {
    if (!ws || ws === DEFAULT_WS || !ID.test(String(eventId || "")) || !ID.test(String(rid || ""))) return false; const st = stateOf(state);
    if (!GROUPS.some(([k]) => k === st)) return false;
    const d = doc(ws, eventId), prev = d.pending.find((x) => x.rid === rid), rest = d.pending.filter((x) => x.rid !== rid);
    // back where they started within one window (yes, then no, then yes again): nothing to tell
    const first = prev ? prev.was : stateOf(was);
    const pending = first === st && !order ? rest : [...rest, { rid, name: clean(name, 40) || "Someone", state: st, was: first, ...(plus > 0 ? { plus: Math.min(20, Math.floor(plus)) } : {}), ...(order ? { order: clean(order, 80) } : {}), at: prev ? prev.at : at, key: `rsvp-${rid}-${state}` }];
    save(ws, eventId, { ...d, pending, ...(origin ? { origin: clean(origin, 200) } : {}) }); return true;
  }
  /** An email about this event just went to the host (the first yes): the next summary waits a full gap. */
  function sent(ws, eventId, at = Date.now()) { if (!ws || !ID.test(String(eventId || ""))) return; const d = doc(ws, eventId); save(ws, eventId, { ...d, lastSentAt: at }); }
  const clear = (ws, eventId) => { const d = doc(ws, eventId); if (d.pending.length) save(ws, eventId, { ...d, pending: [] }); };

  async function run(now = Date.now(), origin = process.env.ENCORE_PUBLIC_URL || "") {
    let n = 0;
    for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; const St = S(ws), owner = String(getWorkspace(ws)?.ownerEmail || "").toLowerCase();
      for (const row of St.list("replydigest")) { const d = row.data || {}, eventId = d.eventId || row.id; if (!(d.pending || []).length) continue;
        const ev = St.get("events/" + eventId)?.data;
        if (!ev || ev.example || ev.cancelled || (ev.date && ev.date < today(now - 864e5)) || !owner || /\.invalid$/i.test(owner) || !wants(owner)) { clear(ws, eventId); continue; }
        // what the host already read in the bell is not news
        const read = new Set((X.inbox(owner) || []).filter((x) => x.read && x.key).map((x) => x.key)), P = d.pending.filter((x) => !read.has(x.key));
        if (!P.length) { clear(ws, eventId); continue; }
        if (now - (d.lastSentAt || 0) < REPLY_DIGEST_GAP) continue;
        if (Math.min(...P.map((x) => x.at)) > now - REPLY_DIGEST_DELAY) continue;
        if (isQuiet(now, eventTz(ev))) continue;
        const R = St.list("rsvps").map((x) => x.data).filter((r) => r && r.eventId === eventId), heads = (k) => R.filter((r) => stateOf(r.response) === k).reduce((a, r) => a + 1 + Math.max(0, Math.min(20, +r.plusOne || 0)), 0);
        const base = String(origin || d.origin || "").replace(/\/$/, ""), title = clean(ev.pubTitle || ev.name, 80) || "your event";
        const C = digestCopy({ title, when: whenOf(ev), items: P.map((x) => (x.order ? { ...x, state: "order" } : x)), totals: { going: heads("going"), maybe: heads("maybe"), no: heads("no") }, link: `${base}/?app=1&open=${encodeURIComponent(eventId)}#studio`, settings: `${base}/settings#notify` });
        save(ws, eventId, { ...d, pending: [], lastSentAt: now }); // set first: a slow or failed send never turns into a second email
        try { const r = await mail(ws, { to: owner, subject: C.subject, text: C.text, html: C.html, eventId, kind: "replydigest", origin: base }); if (r?.ok) n++; } catch {} } }
    return { sent: n };
  }
  return { note, sent, run, wants, pendingOf: (ws, eventId) => doc(ws, eventId).pending };
}
