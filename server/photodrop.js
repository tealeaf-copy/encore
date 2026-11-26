// Photo drops: the morning after an event, every guest who replied I'm in (and wasn't marked a no-show) gets one nudge
// to add their photos: an email when email is set up (ENCORE_FAKE_EMAIL records it in tests and demos) and an item in
// their Pottery Lab inbox. The link opens /p/<event>?rid=..&code.. (public/photos.html), which proves who they are the
// same way kudos do (the reply id and its code), and uploads through POST /api/moments (server/social.js), which checks
// the type, size and length, scrubs emails and phone numbers from captions and rate-limits uploads.
//
// Where the photos go follows server/feedvisual.js: open events (on Discover, not Ask to join, photos allowed, not
// private or friends-only) reach the public feed as polaroids with reactions; every other event's photos stay with the
// people who were there.
//
// One drop per guest per event, ever: logged in the host's photodrops collection before it goes out. Runs with the
// kudos asks' hourly job (server/kudosask.js, through server/kudosnudge.js), from 8am to 9pm on the 3 days after.
import crypto from "node:crypto";
import { scopeStore, getWorkspace, allWorkspaceIds, DEFAULT_WS } from "./workspaces.js";
import { emailConfig, sendEmail, EMAIL_RE } from "./email.js";
import { localParts, pottoSettings } from "./reminders.js";
import { eventTz } from "./tz.js";
import { momentsPublic } from "./feedvisual.js";

const DAY = 864e5, ISO = /^\d{4}-\d{2}-\d{2}$/;
export const PHOTO_DROP = { morning: 8, evening: 21, lastDay: 3 };
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const lc = (s) => String(s || "").trim().toLowerCase();
const safe = (rid) => String(rid).replace(/[^A-Za-z0-9_-]/g, "");
const isDemo = (ws) => /@demo\.encore$/i.test(getWorkspace(ws)?.ownerEmail || "");
const endOf = (ev) => (ISO.test(ev?.endDate || "") && ev.endDate >= (ev.date || "") ? ev.endDate : ev?.date || "");

/** The nudge, word for word. */
export const dropLine = (title) => `Add your photos from ${title}`;
export const photoLink = (origin, eventId, rid, code) => `${origin}/p/${encodeURIComponent(eventId)}?rid=${encodeURIComponent(rid)}&code=${encodeURIComponent(code)}`;
/** Is `now` the morning after (8am to 9pm, on any of the 3 days after the event ended, in its time zone)? */
export function dropWindow(ev, now, tz = eventTz(ev)) {
  const end = endOf(ev); if (!ISO.test(end)) return false;
  const L = localParts(now, tz), days = Math.round((Date.parse(L.day + "T12:00:00Z") - Date.parse(end + "T12:00:00Z")) / DAY);
  return days >= 1 && days <= PHOTO_DROP.lastDay && L.hour >= PHOTO_DROP.morning && L.hour < PHOTO_DROP.evening;
}
/** Events that get photo drops: real, happened, photos allowed, the host didn't switch off messages to guests. */
export const droppable = (ev) => !!ev && !ev.example && !ev.cancelled && ev.stage !== "interest" && !ev.noPhotos && ev.autoRemind !== false && ev.photoDrops !== false && ISO.test(ev.date || "");

/** guestsOf(S, eventId): every guest who was in, one per person (server/kudosnudge.js). */
export function makePhotoDrop(store, { C, X, canEmail = () => true, guestsOf }) {
  /** Send the drops that are due, for every host (or `workspaces`). */
  async function run({ now = Date.now(), workspaces = null, origin = process.env.ENCORE_PUBLIC_URL || "", dryRun = false } = {}) {
    const out = { sent: 0, email: 0, inbox: 0, skipped: 0, events: [] };
    for (const ws of workspaces || allWorkspaceIds()) { if (ws === DEFAULT_WS || isDemo(ws)) continue; const S = scopeStore(store, ws);
      // review round 11: the workspace's hourly email cap (ENCORE_EMAIL_PER_HOUR, the same one mailWs keeps) counts these too
      let mailedHour = null; const capped = () => { if (mailedHour == null) mailedHour = S.list("outbox").filter((d) => d.data?.at > now - 36e5 && !["failed", "inbox"].includes(d.data.status)).length; return mailedHour >= +(process.env.ENCORE_EMAIL_PER_HOUR || 300); };
      for (const d of S.list("events")) { const ev = d.data || {}, eventId = d.id; if (!droppable(ev) || !dropWindow(ev, now, eventTz(ev, pottoSettings(S).tz))) continue; // review round 11: where the event is
        const title = clean(ev.pubTitle || ev.name, 120) || "the event", cfg = emailConfig(ws, false) || emailConfig(DEFAULT_WS, true), open = momentsPublic(ev);
        const row = { ws, eventId, sent: 0, skipped: 0 };
        for (const g of guestsOf(S, eventId)) { const key = `photodrops/${eventId}--${safe(g.rid)}`, prev = S.get(key)?.data;
          // once, ever; review round 11: except an email that failed (or waited for the hourly cap), tried again an hour later, 3 tries in all
          if (prev && !(prev.error && (prev.tries || 1) < 3 && now - (prev.at || 0) >= 3600e3)) continue;
          const r = g.r, em = lc(r.email); if (!EMAIL_RE.test(em)) { row.skipped++; continue; } // no email: nowhere to send it (the photo wall is on their invite)
          if (dryRun) { row.preview ||= dropLine(title); row.sent++; continue; }
          let code = String(r.code || ""); if (!code) { code = crypto.randomBytes(5).toString("hex").toUpperCase(); try { S.update("rsvps/" + g.rid, { code }); } catch { continue; } }
          const tries = (prev?.tries || (prev ? 1 : 0)) + 1;
          S.set(key, { eventId, rid: g.rid, at: now, channel: "pending", tries }); // logged first: a crash mid-send never means a second nudge
          const link = photoLink(origin, eventId, g.rid, code), path = link.slice(origin.length);
          const inbox = X?.notify ? X.notify(em, { kind: "photos", key: `pd-${eventId}`, text: `📸 ${dropLine(title)}`, link: path, eventId }) !== false : false;
          let channel = inbox ? "inbox" : "none", error = null;
          if (cfg && canEmail(em) !== false && capped()) error = "rate_limited";
          else if (cfg && canEmail(em) !== false) { const x = await sendEmail(cfg, { list: "guest", origin, to: em, subject: dropLine(title), fromName: C?.profileOf?.(ws)?.name || "",
            text: `Hi ${first(r.name) || "there"},\n\nThanks for coming to ${title}. Got photos? Add them here: ${link}\n\n${open ? "They go on the event's page and in the Pottery Lab feed, where guests can react to them." : "Only people who were there will see them."} Captions never show emails or phone numbers.\n` });
            if (x.ok) { channel = inbox ? "email+inbox" : "email"; mailedHour++; } else error = x.error || "email failed"; }
          S.set(key, { eventId, rid: g.rid, at: now, channel, tries, ...(error ? { error: String(error).slice(0, 200) } : {}) });
          if (channel === "none") { row.skipped++; continue; }
          row.sent++; if (channel.includes("email")) out.email++; if (inbox) out.inbox++;
          S.add("outbox", { kind: "photo-drop", eventId, to: [em], subject: dropLine(title).slice(0, 200), at: now, status: channel.includes("email") ? "sent" : "inbox" }); }
        if (row.sent || row.skipped) { out.events.push(row); out.sent += row.sent; out.skipped += row.skipped; } } }
    return out;
  }
  return { run, dropWindow, droppable, dropLine };
}
