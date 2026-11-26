// Kudos, asked of every guest: the morning after an event ends, each guest who replied I'm in (and wasn't marked a
// no-show) gets one message, by text when they gave a phone and texting is set up, else by email when that is set up,
// else nothing. The link opens /k/<event>?rid=..&code=.. (public/kudos.html), which proves who they are the same way
// POST /api/public/kudos does: the reply id and the code they got back when they replied.
//
// One ask per guest per event, ever: every ask is logged in the host's kudosasks collection before it goes out, so a
// second run (or a restart) never sends it again. Hosts can't pick who is asked. They can switch off guest messages for
// an event with the reminder switch (autoRemind: false), and guests who replied STOP or turned off emails are skipped.
// Hourly, like Potto's reminders (server/reminders.js).
import crypto from "node:crypto";
import { scopeStore, getWorkspace, allWorkspaceIds, DEFAULT_WS, getDbUser } from "./workspaces.js";
import { emailConfig, sendEmail, EMAIL_RE } from "./email.js";
import { smsConfig, sendSms } from "./sms.js";
import { localParts } from "./reminders.js";
import { KUDOS_TAGS, kudosTagsFor, replyKey } from "./social.js";
import { mountKudosNudge } from "./kudosnudge.js";
import { nextFor } from "./repeats.js"; // review round 7: "Nothing like it coming up" shows the series' next date // kudos nudges: the host's sheet, the group link, Send for me, the reminder

const DAY = 864e5, MORNING = 9, EVENING = 21, LAST_DAY = 3;
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const PHONE_OK = (p) => /^\+?[0-9 ()-]{7,20}$/.test(String(p || "").trim());
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isDemo = (ws) => /@demo\.encore$/i.test(getWorkspace(ws)?.ownerEmail || "");
const askId = (eventId, rid) => `${eventId}--${String(rid).replace(/[^A-Za-z0-9_-]/g, "")}`;

/** The host's first name as guests know it (the same order the invite uses). */
export function hostFirst(C, ws, ev) { return first(ev?.hostName) || first(getDbUser(getWorkspace(ws)?.ownerEmail || "")?.name) || first(C?.profileOf?.(ws)?.name) || ""; }
/** The one line every guest gets. */
export function askLine(title, host, link) { return host ? `How was ${title} at ${host}'s? Leave kudos in one tap: ${link}` : `How was ${title}? Leave kudos in one tap: ${link}`; }
export const kudosLink = (origin, eventId, rid, code) => `${origin}/k/${encodeURIComponent(eventId)}?rid=${encodeURIComponent(rid)}&code=${encodeURIComponent(code)}`;

/** Is `now` the morning after the event ended (from 9am that day, for up to 3 days if the server was asleep)? */
export function askWindow(ev, now, tz = ev?.tz || process.env.ENCORE_TZ || "") {
  const end = ISO.test(ev?.endDate || "") && ev.endDate >= (ev.date || "") ? ev.endDate : ev?.date; if (!ISO.test(end || "")) return false;
  const L = localParts(now, tz), days = Math.round((Date.parse(L.day + "T12:00:00Z") - Date.parse(end + "T12:00:00Z")) / DAY);
  return days >= 1 && days <= LAST_DAY && L.hour >= MORNING && L.hour < EVENING;
}

/** Who gets asked for one event: replied I'm in, not marked no-show, one per person, not already sent kudos. Pure. */
export function eligibleGuests(S, eventId) {
  const seen = new Set(), out = [];
  const docs = S.list("rsvps").filter((d) => d.data?.eventId === eventId).sort((a, b) => (b.data.changedAt || b.data.createdAt || 0) - (a.data.changedAt || a.data.createdAt || 0));
  for (const d of docs) { const r = d.data, k = replyKey(r) || "id:" + d.id; if (seen.has(k)) continue; seen.add(k);
    if (r.response !== "going" || r.noShow === true || r.walkIn) continue;
    const K = S.get("kudos/" + d.id)?.data; if (K && (K.love || (K.tags || []).length)) continue;
    out.push({ rid: d.id, r }); }
  return out;
}

/** Send the asks that are due, for every host (or `workspaces`). Returns what happened, per event. */
export async function runKudosAsks(store, { now = Date.now(), workspaces = null, origin = process.env.ENCORE_PUBLIC_URL || "", C = null, canEmail = () => true, dryRun = false } = {}) {
  const out = { asked: 0, sms: 0, email: 0, skipped: 0, events: [] }, sms = smsConfig();
  for (const ws of workspaces || allWorkspaceIds()) { if (ws === DEFAULT_WS || isDemo(ws)) continue; const S = scopeStore(store, ws);
    for (const d of S.list("events")) { const ev = d.data || {}, eventId = d.id;
      if (ev.example || !ev.casual || ev.stage === "interest" || ev.cancelled) continue;
      if (ev.autoRemind === false) continue; // the host's per-event switch for messages to guests
      if (!askWindow(ev, now)) continue;
      const title = clean(ev.pubTitle || ev.name, 120) || "the event", host = hostFirst(C, ws, ev), email = emailConfig(ws, false) || emailConfig(DEFAULT_WS, true);
      const row = { ws, eventId, asked: 0, sms: 0, email: 0, skipped: 0 };
      for (const { rid, r } of eligibleGuests(S, eventId)) {
        const key = "kudosasks/" + askId(eventId, rid); if (S.get(key)) continue; // one ask per guest per event, ever
        let code = String(r.code || ""); if (!code && !dryRun) { code = crypto.randomBytes(5).toString("hex").toUpperCase(); try { S.update("rsvps/" + rid, { code }); } catch { continue; } }
        const link = kudosLink(origin, eventId, rid, code), line = askLine(title, host, link);
        const bySms = !!sms && PHONE_OK(r.phone) && r.smsOk !== false, em = String(r.email || "").trim().toLowerCase(), byEmail = !!email && EMAIL_RE.test(em) && canEmail(em) !== false;
        if (dryRun) { row.preview = row.preview || line; if (bySms || byEmail) row.asked++; else row.skipped++; continue; }
        S.set(key, { eventId, rid, at: now, channel: "pending" }); // logged first: a crash mid-send never means a second ask
        let channel = "none", error = null;
        if (bySms) { const x = await sendSms(sms, { to: r.phone, text: `${line} Reply STOP to opt out.` }); if (x.ok) channel = "sms"; else error = x.error || "text failed"; }
        if (channel === "none" && byEmail) { const x = await sendEmail(email, { list: "guest", origin, to: em, subject: `How was ${title}?`, text: `Hi ${first(r.name) || "there"},\n\n${line}\n`, fromName: C?.profileOf?.(ws)?.name || "" }); if (x.ok) channel = "email"; else error = x.error || "email failed"; }
        S.set(key, { eventId, rid, at: now, channel, ...(error && channel === "none" ? { error: String(error).slice(0, 200) } : {}) });
        if (channel === "none") { row.skipped++; continue; }
        row.asked++; row[channel]++; S.add("outbox", { kind: "kudos-ask", eventId, to: [channel === "sms" ? r.phone : em], subject: line.slice(0, 200), at: now, status: "sent" });
      }
      if (row.asked || row.skipped) { out.events.push(row); out.asked += row.asked; out.sms += row.sms; out.email += row.email; out.skipped += row.skipped; }
    }
  }
  return out;
}

/** Check every hour, like Potto's reminders. Returns {stop, run}. */
export function scheduleKudosAsks(store, opts = {}) {
  const tick = () => runKudosAsks(store, opts).catch((e) => console.warn("[kudos asks]", e?.message || e))
    .then(() => opts.after?.()).catch((e) => console.warn("[kudos reminders]", e?.message || e)); // kudos nudges: the reminder 3 days later
  const t = setInterval(tick, 3600e3); t.unref?.(); const firstRun = setTimeout(tick, 120e3); firstRun.unref?.();
  return { stop: () => { clearInterval(t); clearTimeout(firstRun); }, run: tick };
}

/** For the host's app: "Kudos asked of N guests · M sent". */
export function askStats(S, eventId) {
  const asked = S.list("kudosasks").filter((d) => d.data?.eventId === eventId && !d.data.kind && ["sms", "email"].includes(d.data.channel)).length; // first asks only (nudges have a kind)
  const sent = S.list("kudos").filter((d) => d.data?.eventId === eventId && (d.data.love || (d.data.tags || []).length)).length;
  return { asked, sent };
}

/** The second-host loop, for one host: of the guests who sent them kudos, how many followed or said I'm in to a different
 *  host within 30 days. Counts only. */
export function loopStats(S) {
  const givers = new Set(S.list("kudos").map((d) => String(d.data?.email || "").trim().toLowerCase()).filter(Boolean));
  const L = S.list("kudosloop").map((d) => d.data || {}), uniq = (f) => new Set(L.filter(f).map((x) => x.giver)).size;
  return { window_days: 30, kudos_givers: givers.size, second_host: uniq(() => true), followed_other_host: uniq((x) => x.kind === "follow"), replied_im_in_other_host: uniq((x) => x.kind === "rsvp"), events: L.length };
}

export function mountKudosAsk(app, { store, small, C, X, ownerOnly, sendStatic, publicOrigin, jobs = !process.env.NODE_TEST_CONTEXT }) {
  const hits = new Map(); const limited = (req, n) => { const k = (req.ip || "?") + req.path.split("/").slice(0, 4).join("/"), now = Date.now(); let h = hits.get(k); if (!h || now - h.start > 3600_000) { h = { n: 0, start: now }; hits.set(k, h); } return ++h.n > n; };
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const proofOf = (req) => (X.kudosProof || X.rsvpProof)(clean(req.params.eventId, 80), clean(req.query.rid, 80), clean(req.query.code, 40)); // kudos nudges: or the group link's kudos-only code
  const run = (o = {}) => runKudosAsks(store, { C, canEmail: (e) => X.canEmail(e), ...o });
  app.locals.kudosAsks = { run, askStats, loopStats };

  // the one-tap kudos page. rid and code ride in the query, so the page sends no referrer.
  app.get(/^\/k\/([A-Za-z0-9_-]{2,80})$/, (req, res) => { res.set("Referrer-Policy", "no-referrer"); sendStatic(res, "kudos.html", "<p>Kudos page missing.</p>"); });
  app.get("/api/public/kudos-page/:eventId", (req, res) => { if (limited(req, 120)) return bad(res, "Slow down.", 429, "rate_limited"); res.set("Cache-Control", "private, no-store");
    const P = proofOf(req); if (!P || !P.ev) return bad(res, "This link isn't working. Open the one from your text or email.", 403, "not_granted");
    const h = C.profileOf(P.ws), K = P.S.get("kudos/" + P.rid)?.data, today = new Date().toISOString().slice(0, 10);
    // review round 7: the subtitle names the place ("at Prospect Park"), never "at Marcus's"; "my place" stays private.
    // "Would go again" comes first (order), and the page knows if they already follow the host.
    const pl = clean(P.ev.venueName || P.ev.meetPoint, 80), place = pl && !/^(?:my|our)\b|['’]s\s+(?:place|apartment|flat|house|home)\b/i.test(pl) ? pl : "";
    const em = String(P.r.email || "").trim().toLowerCase(), F = em && h?.handle ? (C.followersOf(P.ws) || []).find((f) => String(f.email || "").toLowerCase() === em) : null;
    res.json({ title: clean(P.ev.pubTitle || P.ev.name, 120), date: ISO.test(P.ev.date || "") ? P.ev.date : "", hostFirst: hostFirst(C, P.ws, P.ev), host: h?.handle ? { handle: h.handle, name: clean(h.name, 60) } : null, place,
      name: P.viaGroup ? "" : first(P.r.name), open: !P.ev.date || P.ev.date <= today, sent: !!(K && (K.love || (K.tags || []).length)), tags: kudosTagsFor(P.ev).filter(([k]) => k !== "again").map(([k, emoji, label]) => ({ k, emoji, label })) /* review round 8: chips fit the event */, again: { k: "again", emoji: "🔁", label: "Would go again" },
      order: ["again", ...kudosTagsFor(P.ev).filter(([k]) => k !== "again").map(([k]) => k)], following: F ? (F.pending ? "pending" : true) : false,
      canFollow: !!(h?.handle && P.r.email) }); });
  app.get("/api/public/kudos-more/:eventId", (req, res) => { if (limited(req, 120)) return bad(res, "Slow down.", 429, "rate_limited");
    const P = proofOf(req); if (!P || !P.ev) return bad(res, "This link isn't working.", 403, "not_granted");
    const Dir = app.locals.directory; if (!Dir?.similar) return res.json({ events: [], next: nextOf(P) }); const h = C.profileOf(P.ws);
    // review round 6: the same city first; other places only when nothing like it is coming up there
    try { const city = String(P.ev.city || h?.city || "").split(",")[0].trim().toLowerCase(), L = Dir.similar(publicOrigin(req), { eventId: P.r.eventId, activity: P.ev.activity || "", title: P.ev.pubTitle || P.ev.name || "", city: P.ev.city || h?.city || "", host: h?.handle || "", limit: 12 });
      const here = city ? L.filter((e) => `${e.city || ""} ${e.area || ""}`.toLowerCase().includes(city)) : [];
      res.json({ events: (here.length ? here : L).slice(0, 3), next: nextOf(P) }); } catch { res.json({ events: [], next: nextOf(P) }); } });
  // review round 7: the next date of this event's series, when there is one ({ id, date, startTime } or null)
  function nextOf(P) { try { const today = localParts(Date.now(), P.ev.tz || process.env.ENCORE_TZ || "").day, n = nextFor(P.S, P.r.eventId, P.ev, today); return n?.date ? { id: n.same ? P.r.eventId : n.id || null, date: n.date, startTime: n.startTime || P.ev.startTime || "", course: !!n.course } : null; } catch { return null; } }

  // the second-host loop, for the host who got the kudos (owner of the workspace only; counts, never people)
  app.get("/api/admin/loop-stats", (req, res) => { const u = ownerOnly(req, res); if (!u) return; res.set("Cache-Control", "private, no-store"); res.json(loopStats(scopeStore(store, u.ws))); });

  // ---- kudos nudges (server/kudosnudge.js) ----
  const nudge = mountKudosNudge(app, { store, small, C, X, ownerOnly, publicOrigin, hostFirst: (ws, ev) => hostFirst(C, ws, ev) });
  // ---- end kudos nudges ----
  if (jobs) app.locals.kudosAskJob = scheduleKudosAsks(store, { C, canEmail: (e) => X.canEmail(e), origin: process.env.ENCORE_PUBLIC_URL || "", after: () => nudge.runFollowUps({ origin: process.env.ENCORE_PUBLIC_URL || "" }) });
}
