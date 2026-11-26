// Discord and Slack, natively (review round 13).
//
// - Unfurls: /e and /i links already carry og: tags (server/app.js). `unfurlOf` adds what chat apps read: the episode in
//   the title, "3 spots left" in the description, Slack's two label rows (When, Spots left), a theme
//   colour for Discord's embed and an oEmbed link (GET /oembed, type "link"). Never on a private or friends-only event
//   past the title the page itself already shows.
// - A webhook per host (Discord or Slack incoming webhook): https only, the exact hosts discord.com, discordapp.com and
//   hooks.slack.com with their own webhook path shapes, the URL rebuilt from its parts, no redirects followed, a short
//   timeout. It posts "Maya is in for Hack night #14" (a first name only, and none on a hidden-guests event or for a guest
//   who hid themselves), "2 spots left" when an event gets down to its last three, and a reminder the day before. Open
//   events only: nothing about a private, friends-only or Ask to join event ever goes to a channel. Each post is logged
//   (`hookslog/...`) before it goes out, so it goes once.
// - Calendars: /@handle.ics (webcal) with the host's open events, and /e/<id>.ics for one event. RFC 5545 text escaping,
//   75-octet line folding, CRLF, UTC times. The place is the area only (neighborhood, city); the exact address goes in a
//   guest's own .ics only when their reply proof (rid + code) says they're in.
import { scopeStore, allWorkspaceIds, getWorkspace, workspaceOfEvent, DEFAULT_WS } from "./workspaces.js";
import { seatsTaken, seatsOf, guestPlace } from "./social.js";
import { eventTz, zonedMs, todayIn, hourIn } from "./tz.js";
import { episodeOf } from "./episodes.js";
import { latestReplies } from "./tables.js";

const ID = /^[A-Za-z0-9_-]{2,80}$/, ISO = /^\d{4}-\d{2}-\d{2}$/, HHMM = /^\d{2}:\d{2}$/;
const clean = (v, n = 200) => String(v ?? "").replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const first = (n) => { const w = String(n || "").trim().split(/\s+/)[0] || ""; return w ? w[0].toUpperCase() + w.slice(1) : ""; };
const closed = (e) => !!e && (e.private === true || e.friendsOnly === true || e.visibility === "private" || e.visibility === "friends");
const hiddenNames = (ev) => !!(ev?.hideGuests || ev?.noWall || ev?.discreet || ev?.chatham);
/** Open enough to talk about in a channel or a public calendar. */
export const openEvent = (e) => !!e && !e.example && !e.sample && !e.cancelled && !closed(e) && !e.approvalRequired && e.stage !== "interest" && !!e.discoverable && e.published !== false;
/** Details are gated: private, friends-only or Ask to join. Their calendar entry carries no description (review round 14). */
const gated = (e) => closed(e) || !!e?.approvalRequired;
/** The invite's public words (pubDesc, or the page copy's description or tagline), never the host's planning brief (`concept`). Pure. */
export const publicCopy = (ev) => { const C = ev?.copy, c = typeof C === "string" ? C : C && typeof C === "object" ? C.description || C.tagline || "" : ""; return clean(String(ev?.pubDesc || c || "").replace(/\]\([^)]*\)/g, "]").replace(/[\[\]*_~`#>]/g, ""), 400); };
const isDemo = (ws) => /@demo\.encore$/i.test(getWorkspace(ws)?.ownerEmail || "");
const titleOf = (store, id, ev, ws) => { const t = String(ev?.pubTitle || ev?.name || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "the event", x = episodeOf(store, id, ws); return x && !/#\d+\s*$/.test(t) ? `${t} #${x.n}` : t; };
const dayOf = (d) => (ISO.test(d || "") ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "");
const clock = (t) => { const m = /^(\d{2}):(\d{2})$/.exec(t || ""); if (!m) return ""; let h = +m[1]; const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return `${h}${m[2] === "00" ? "" : ":" + m[2]}${ap}`; };
const areaOf = (ev) => [clean(ev?.hood, 60), clean(String(ev?.city || "").split(",")[0], 60)].filter((x, i, a) => x && a.indexOf(x) === i).join(", ");
/** Spots left, or null with no cap or when the host hides who's going. */
export function spotsLeft(S, id, ev) { if (!(+ev?.headcount > 0) || ev.hideGuests) return null; const all = S.list("rsvps").filter((d) => d.data?.eventId === id); return Math.max(0, Math.floor(+ev.headcount - seatsTaken(ev, all))); }

// ---------- webhooks ----------
/** A Discord or Slack incoming webhook, rebuilt from its parts, or null. Pure. */
export function webhookOf(raw) {
  let u; try { u = new URL(String(raw || "").trim()); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443") || u.search || u.hash) return null;
  const h = u.hostname.toLowerCase();
  if ((h === "discord.com" || h === "discordapp.com") && /^\/api\/webhooks\/\d{5,25}\/[A-Za-z0-9_-]{20,120}$/.test(u.pathname)) return { kind: "discord", url: `https://${h}${u.pathname}` };
  if (h === "hooks.slack.com" && /^\/services\/[A-Z0-9]{6,20}\/[A-Z0-9]{6,20}\/[A-Za-z0-9]{12,48}$/.test(u.pathname)) return { kind: "slack", url: `https://${h}${u.pathname}` };
  return null;
}
const masked = (W) => (W ? W.url.replace(/\/[^/]+$/, "/" + "•".repeat(6)) : "");
/** A first name a channel may show ("Maya", "Anne-Marie", "D'Arcy"), or "" for anything else: links, markup, handles. Pure. */
export const chatName = (n) => { const f = first(n); return /^[\p{L}][\p{L}'. -]{0,23}$/u.test(f) && !/\.\p{L}/u.test(f) ? f : ""; };
/** Words for a channel: no markup, no links, no pings; the only link is ours, added after. Pure. */
export const chatSafe = (s, kind) => { const t = clean(String(s ?? "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\b(?:https?:\/\/|www\.)\S+/gi, "").replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|gg|co|me|xyz|app|dev|ly|link|site|ru|cn|tk)\b(?:\/\S*)?/gi, ""), 300).replace(/[*_~`|>\\[\]]/g, "").replace(/(^|\s)#+\s/g, "$1").replace(/@(everyone|here|channel)/gi, "$1").replace(/\s+([.,!?])/g, "$1").replace(/\s+/g, " ").trim(); return kind === "slack" ? t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : t; };
export const payloadOf = (kind, text, link) => (kind === "slack" ? { text: link ? `${text} <${link}|Open the invite>` : text } : { content: link ? `${text}\n${link}` : text, username: "Pottery Lab", allowed_mentions: { parse: [] } });

// ---------- calendars ----------
/** RFC 5545 TEXT: backslash, semicolon, comma and newlines escaped. Pure. */
export const icsText = (s) => String(s ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
/** Lines folded at 75 octets (never inside a UTF-8 character), CRLF between them. Pure. */
export function icsFold(line) {
  const out = []; let cur = "", bytes = 0, lim = 75;
  for (const ch of line) { const b = Buffer.byteLength(ch); if (bytes + b > lim) { out.push(cur); cur = " "; bytes = 1; lim = 75; } cur += ch; bytes += b; }
  out.push(cur); return out.join("\r\n");
}
const utcStamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
/** One VEVENT. Pure apart from the time zone maths. */
export function vevent({ id, ev, title, url, location = "", host = "", now = Date.now() }) {
  if (!ISO.test(ev?.date || "")) return [];
  const tz = eventTz(ev), st = HHMM.test(ev.startTime || "") ? ev.startTime : "", en = HHMM.test(ev.endTime || "") ? ev.endTime : "", L = [];
  L.push("BEGIN:VEVENT", `UID:${id}@potterylab`, `DTSTAMP:${utcStamp(now)}`);
  if (st) { const s = zonedMs(ev.date, st, tz); let endDay = ISO.test(ev.endDate || "") && ev.endDate >= ev.date ? ev.endDate : ev.date; let e = en ? zonedMs(endDay, en, tz) : s + 3 * 3600e3; if (e <= s) e += 864e5;
    if (Number.isFinite(s)) L.push(`DTSTART:${utcStamp(s)}`, `DTEND:${utcStamp(e)}`); }
  else { const d = ev.date.replace(/-/g, ""), nx = new Date(Date.parse((ISO.test(ev.endDate || "") && ev.endDate > ev.date ? ev.endDate : ev.date) + "T12:00:00Z") + 864e5).toISOString().slice(0, 10).replace(/-/g, ""); L.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${nx}`); }
  L.push(`SUMMARY:${icsText(title)}`); if (location) L.push(`LOCATION:${icsText(location)}`);
  // the public copy, the host and the link; no DESCRIPTION at all on a private, friends-only or Ask to join event
  const desc = gated(ev) ? "" : [publicCopy(ev), host ? `Hosted by ${host}` : "", url].filter(Boolean).join("\n"); if (desc) L.push(`DESCRIPTION:${icsText(desc)}`);
  if (url && /^https?:\/\/[^\s"<>]+$/.test(url)) L.push(`URL:${url}`);
  L.push("END:VEVENT"); return L;
}
export const calendar = (name, events) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Pottery Lab//Events//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icsText(name)}`, ...events.flat(), "END:VCALENDAR"].map(icsFold).join("\r\n") + "\r\n";

// ---------- unfurls ----------
const ea = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
/** What /e/<id> adds for chat apps: { title, spots, meta }. */
export function unfurlOf(store, ws, id, ev, base) {
  const title = titleOf(store, id, ev, ws), open = !closed(ev) && !ev.approvalRequired, left = open ? spotsLeft(scopeStore(store, ws), id, ev) : null, when = [dayOf(ev.date), clock(ev.startTime)].filter(Boolean).join(" · ");
  const spots = left == null ? "" : left === 0 ? "Full, waitlist open" : `${left} spot${left === 1 ? "" : "s"} left`;
  const meta = [`<meta name="theme-color" content="#C4532F">`,
    when ? `<meta name="twitter:label1" content="When"><meta name="twitter:data1" content="${ea(when)}">` : "", spots ? `<meta name="twitter:label2" content="Spots"><meta name="twitter:data2" content="${ea(spots)}">` : "",
    `<link rel="alternate" type="application/json+oembed" href="${ea(base)}/oembed?url=${encodeURIComponent(base + "/e/" + id)}&amp;format=json" title="${ea(title)}">`, `<link rel="alternate" type="text/calendar" href="${ea(base)}/e/${encodeURIComponent(id)}.ics" title="Add to calendar">`].join("");
  return { title, spots, meta };
}

export function mountHooksOut(app, { store, small, C, ownerOnly, publicOrigin, post = null, jobs = !process.env.NODE_TEST_CONTEXT }) {
  const hits = new Map(), limited = (k, n) => { const now = Date.now(); if (hits.size > 20000) hits.clear(); let h = hits.get(k); if (!h || now - h.start > 3600e3) { h = { n: 0, start: now }; hits.set(k, h); } return ++h.n > n; };
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const sent = [], fake = !!process.env.NODE_TEST_CONTEXT || process.env.ENCORE_FAKE_WEBHOOK === "1";
  const deliver = post || (async (W, body) => { if (fake) { sent.push({ kind: W.kind, url: W.url, body }); if (sent.length > 200) sent.shift(); return true; }
    try { const r = await fetch(W.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(5000) }); return r.ok; } catch { return false; } });
  const cfgOf = (ws) => { const d = scopeStore(store, ws).get("hooksout/main")?.data; const W = d?.url ? webhookOf(d.url) : null; return W ? { ...W, on: { joins: d.on?.joins !== false, spots: d.on?.spots !== false, reminders: d.on?.reminders !== false }, origin: d.origin || "" } : null; };
  /** Post once: the log is written first, so a retry or a second server never posts it twice. */
  async function once(ws, key, text, link) { const W = cfgOf(ws); if (!W) return false; const S = scopeStore(store, ws), log = "hookslog/" + key.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 120); if (S.get(log)) return false;
    S.set(log, { at: Date.now(), text: clean(text, 200) }); return deliver(W, payloadOf(W.kind, chatSafe(text, W.kind), link)); }
  const linkOf = (W, id) => (W?.origin ? `${W.origin}/e/${encodeURIComponent(id)}` : "");

  // ---- a reply changed: "Maya is in", and "2 spots left" ----
  async function onReply(ws, rid) {
    if (!ws || ws === DEFAULT_WS || isDemo(ws)) return; const W = cfgOf(ws); if (!W) return; const S = scopeStore(store, ws), r = S.get("rsvps/" + rid)?.data; if (!r?.eventId || r.response !== "going") return;
    const id = r.eventId, ev = S.get("events/" + id)?.data; if (!openEvent(ev) || (ev.date && ev.date < todayIn(eventTz(ev)))) return; const t = titleOf(store, id, ev, ws), link = linkOf(W, id);
    if (W.on.joins) { const nm = !hiddenNames(ev) && r.showMe !== false ? chatName(r.name) : ""; await once(ws, `in-${rid}`, nm ? `${nm} is in for ${t}.` : `One more is in for ${t}.`, link); }
    const left = spotsLeft(S, id, ev); if (W.on.spots && left != null && left >= 1 && left <= 3) await once(ws, `spots-${id}-${left}`, `${left} spot${left === 1 ? "" : "s"} left for ${t}.`, link);
  }
  store.events?.on?.("change", (e) => { const m = /^ws\/([^/]+)\/rsvps\/([A-Za-z0-9_-]+)$/.exec(String(e?.path || "")); if (!m) return; setImmediate(() => { onReply(m[1], m[2]).catch(() => {}); }); });

  // ---- the day before ----
  async function runReminders({ now = Date.now(), workspaces = null } = {}) { let n = 0;
    for (const ws of workspaces || allWorkspaceIds()) { if (ws === DEFAULT_WS || isDemo(ws)) continue; const W = cfgOf(ws); if (!W?.on.reminders) continue; const S = scopeStore(store, ws);
      for (const d of S.list("events")) { const ev = d.data; if (!openEvent(ev) || !ISO.test(ev.date || "")) continue; const tz = eventTz(ev), today = todayIn(tz, now), tomorrow = new Date(Date.parse(today + "T12:00:00Z") + 864e5).toISOString().slice(0, 10);
        if (ev.date !== tomorrow || hourIn(tz, now) < 9) continue; const t = titleOf(store, d.id, ev, ws), going = latestReplies(S, d.id).filter((x) => x.r.response === "going").reduce((a, x) => a + seatsOf(x.r, ev), 0), left = spotsLeft(S, d.id, ev);
        const line = [`Tomorrow: ${t}`, clock(ev.startTime), areaOf(ev)].filter(Boolean).join(", ") + "." + (ev.hideGuests ? "" : ` ${going} in${left ? `, ${left} spot${left === 1 ? "" : "s"} left` : ""}.`);
        if (await once(ws, `rem-${d.id}-${ev.date}`, line, linkOf(W, d.id))) n++; } }
    return n; }

  // ---- the host's settings ----
  app.get("/api/host/webhook", (req, res) => { const u = ownerOnly(req, res); if (!u) return; const W = cfgOf(u.ws); res.set("Cache-Control", "private, no-store").json(W ? { on: true, kind: W.kind, url: masked(W), events: W.on } : { on: false }); });
  app.put("/api/host/webhook", small, (req, res) => { const u = ownerOnly(req, res); if (!u) return; const b = req.body || {}, S = scopeStore(store, u.ws);
    if (!b.url) { S.delete?.("hooksout/main"); if (S.get("hooksout/main")) S.set("hooksout/main", {}); return res.json({ on: false }); }
    const W = webhookOf(b.url); if (!W) return bad(res, "Paste a Discord or Slack incoming webhook URL (https://discord.com/api/webhooks/... or https://hooks.slack.com/services/...).");
    const on = { joins: b.events?.joins !== false, spots: b.events?.spots !== false, reminders: b.events?.reminders !== false };
    S.set("hooksout/main", { url: W.url, kind: W.kind, on, origin: publicOrigin(req), at: Date.now() }); res.json({ on: true, kind: W.kind, url: masked(W), events: on }); });
  app.post("/api/host/webhook/test", small, async (req, res) => { const u = ownerOnly(req, res); if (!u) return; if (limited("t:" + u.ws, 10)) return bad(res, "That's a lot of tests. Try again later.", 429, "rate_limited");
    const W = cfgOf(u.ws); if (!W) return bad(res, "Add a webhook first."); const h = C.profileOf?.(u.ws), ok = await deliver(W, payloadOf(W.kind, chatSafe(`Pottery Lab is connected${h?.name ? ` for ${h.name}` : ""}. New guests, last spots and day-before reminders will show up here.`, W.kind), ""));
    res.json({ ok: !!ok }); });

  // ---- oEmbed (Discord and Slack read og: tags; this is for everything else) ----
  app.get("/oembed", (req, res) => { if (limited("o:" + (req.ip || "?"), 600)) return bad(res, "Slow down.", 429, "rate_limited"); let u; try { u = new URL(String(req.query.url || "")); } catch { return bad(res, "Missing url.", 404, "not_found"); }
    const m = /^\/[ei]\/([A-Za-z0-9_-]{2,80})$/.exec(u.pathname), id = m?.[1], ws = id ? workspaceOfEvent(id) : null, ev = ws ? scopeStore(store, ws).get("events/" + id)?.data : null;
    if (!ev || ev.example) return bad(res, "No such event.", 404, "not_found"); const base = publicOrigin(req), h = C.profileOf?.(ws), U = unfurlOf(store, ws, id, ev, base), open = !closed(ev);
    res.set("Cache-Control", "public, max-age=120").json({ version: "1.0", type: "link", title: U.title, provider_name: "Pottery Lab", provider_url: base, ...(open && h?.name ? { author_name: clean(h.name, 80), author_url: `${base}/@${h.handle}` } : {}),
      ...(open ? { description: [dayOf(ev.date), clock(ev.startTime), areaOf(ev), U.spots].filter(Boolean).join(" · ") } : {}), cache_age: 120 }); });

  // ---- calendars ----
  const sendIcs = (res, name, body) => res.set({ "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "public, max-age=300", "Content-Disposition": `inline; filename="${name.replace(/[^a-z0-9-]/gi, "-").slice(0, 60) || "events"}.ics"` }).send(body);
  app.get(/^\/@([a-z0-9][a-z0-9-]{1,29})\.ics$/, (req, res) => { if (limited("c:" + (req.ip || "?"), 300)) return res.status(429).type("text").send("Slow down.");
    const handle = req.params[0], ws = C.wsOfHandle?.(handle), h = ws && C.profileOf?.(ws); if (!h) return res.status(404).type("text").send("No host by that name.");
    const base = publicOrigin(req), since = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10), S = scopeStore(store, ws);
    const E = isDemo(ws) ? [] : S.list("events").filter((d) => ID.test(d.id) && openEvent(d.data) && !!d.data.discoverable && ISO.test(d.data.date || "") && d.data.date >= since).sort((a, b) => a.data.date.localeCompare(b.data.date)).slice(0, 200);
    sendIcs(res, handle, calendar(`${clean(h.name, 80)} on Pottery Lab`, E.map((d) => vevent({ id: d.id, ev: d.data, title: titleOf(store, d.id, d.data, ws), url: `${base}/e/${encodeURIComponent(d.id)}`, location: areaOf(d.data), host: clean(h.name, 80) })))); });
  app.get(/^\/e\/([A-Za-z0-9_-]{2,80})\.ics$/, (req, res) => { if (limited("c:" + (req.ip || "?"), 300)) return res.status(429).type("text").send("Slow down.");
    const id = req.params[0], ws = workspaceOfEvent(id), S = ws && scopeStore(store, ws), ev = S?.get("events/" + id)?.data; if (!ev || ev.example || ev.cancelled || !(ev.published || ev.discoverable)) return res.status(404).type("text").send("No such event.");
    const P = req.query.rid ? app.locals.social?.rsvpProof?.(id, String(req.query.rid).slice(0, 80), String(req.query.code || "").slice(0, 40)) : null, going = P?.r?.response === "going";
    const say = going ? guestPlace(ws) : null, exact = going ? [clean(say(ev.meetPoint || ev.venueName), 120), clean(say(ev.venueAddr), 200)].filter(Boolean).join(", ") : "", base = publicOrigin(req), h = C.profileOf?.(ws);
    if (going) res.set("Cache-Control", "private, no-store");
    const body = calendar(clean(ev.pubTitle || ev.name, 80) || "Event", [vevent({ id, ev, title: titleOf(store, id, ev, ws), url: `${base}/e/${encodeURIComponent(id)}`, location: exact || areaOf(ev), host: closed(ev) ? "" : clean(h?.name, 80) })]);
    res.set({ "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `inline; filename="event.ics"`, ...(going ? {} : { "Cache-Control": "public, max-age=300" }) }).send(body); });

  if (jobs) { const tick = () => runReminders().catch((e) => console.warn("[hooksout]", e?.message || e)); const t = setInterval(tick, 3600e3); t.unref?.(); app.locals.hooksJob = { stop: () => clearInterval(t), run: tick }; }
  app.locals.hooksout = { sent, runReminders, onReply, cfgOf };
  return app.locals.hooksout;
}
