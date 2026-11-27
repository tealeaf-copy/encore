// Funnel metrics: how hosts get from sign-up to a first good event, and how guests become hosts.
// Each step is one row in a global collection (system/metrics/funnel, never reachable through the data API) with a
// timestamp, the workspace id and the event id. No names, emails or phones are ever stored here.
// GET /api/admin/funnel (people listed in ENCORE_ADMIN_EMAILS only; 404 for everyone else) reads the counts.
import { scopeStore, allWorkspaceIds, DEFAULT_WS, getDbUser } from "./workspaces.js";
import { captureStep } from "./posthog.js"; // every step also goes to PostHog when it is configured (server/posthog.js)

export const FUNNEL_STEPS = ["signup", "first_event_created", "share_clicked", "first_reply", "three_replies", "event_done", "kudos_received", "guest_follow", "guest_became_host"];
// what a browser may send to POST /api/track (everything else is recorded by the server itself)
export const CLIENT_STEPS = new Set(["share_clicked"]);
const COL = "system/metrics/funnel", ONCE = "system/metrics/once";
const ID_OK = /^[A-Za-z0-9_-]{1,80}$/, DAY = 864e5;
let S = null;
export const useMetricsStore = (store) => { S = store; };

/** Record one funnel step. props: ws, eventId, ref (an event id), code (true when a host code was used), via (a short word).
 * Returns true when recorded. Never throws. */
export function track(name, props = {}, at = Date.now()) {
  if (!S || !FUNNEL_STEPS.includes(name)) return false;
  try {
    const row = { name, at: +at || Date.now() };
    for (const k of ["ws", "eventId", "ref"]) if (props[k] != null && ID_OK.test(String(props[k]))) row[k] = String(props[k]);
    if (props.code != null) row.code = !!props.code;
    if (props.via != null && /^[a-z_-]{1,20}$/.test(String(props.via))) row.via = String(props.via);
    S.add(COL, row); captureStep(name, row); return true;
  } catch { return false; }
}
/** Record a step only the first time for this key (e.g. first_event_created per workspace). */
export function trackOnce(name, key, props = {}, at) {
  if (!S) return false; const k = (name + "-" + key).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 190);
  try { if (S.get(ONCE + "/" + k)) return false; S.set(ONCE + "/" + k, { at: Date.now() }); } catch { return false; }
  return track(name, props, at);
}
export const funnelRows = () => (S ? S.list(COL).map((d) => d.data) : []);
// an admin is on ENCORE_ADMIN_EMAILS and has confirmed that email (an account made by sign-up with that address can't be
// an admin until the link in its inbox is tapped)
export const isAdmin = (email) => { const e = String(email || "").trim().toLowerCase(); return !!e && String(process.env.ENCORE_ADMIN_EMAILS || "").split(/[\s,]+/).map((x) => x.trim().toLowerCase()).filter(Boolean).includes(e) && (() => { try { return getDbUser(e)?.emailVerified !== false; } catch { return true; } })(); };

/** Events whose date has passed get one event_done row, stamped at noon on the event's date. */
export function sweepDone(today = new Date().toISOString().slice(0, 10)) {
  if (!S) return 0; let n = 0;
  for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue;
    for (const d of scopeStore(S, ws).list("events")) { const e = d.data || {};
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || "") || e.date >= today || e.sample || e.example) continue;
      if (trackOnce("event_done", d.id, { ws, eventId: d.id }, Date.parse(e.date + "T12:00:00Z"))) n++; } }
  return n;
}

/** Counts per step (all time, last 7 days, last 30 days) and activation: hosts who, within 7 days of signing up,
 * shared an event and got 3+ replies from guests (not people the host added by hand). */
export function funnel(now = Date.now()) {
  sweepDone(new Date(now).toISOString().slice(0, 10));
  const rows = funnelRows(), steps = {};
  for (const name of FUNNEL_STEPS) { const R = rows.filter((r) => r.name === name); steps[name] = { all: R.length, last7: R.filter((r) => r.at > now - 7 * DAY).length, last30: R.filter((r) => r.at > now - 30 * DAY).length }; }
  const signups = rows.filter((r) => r.name === "signup" && r.ws), shares = rows.filter((r) => r.name === "share_clicked" && r.ws);
  let activated = 0;
  for (const s of signups) { const end = s.at + 7 * DAY;
    if (!shares.some((x) => x.ws === s.ws && x.at >= s.at && x.at <= end)) continue;
    let replies = 0; try { replies = scopeStore(S, s.ws).list("rsvps").filter((d) => d.data?._k && (+d.data.createdAt || d.updated) <= end).length; } catch {}
    if (replies >= 3) activated++; }
  return { steps, order: FUNNEL_STEPS, activation: { hosts: signups.length, activated, rate: signups.length ? Math.round((activated / signups.length) * 1000) / 1000 : 0, rule: "shared an event and got 3+ replies from guests within 7 days of sign-up" }, at: now };
}
