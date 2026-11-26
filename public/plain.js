// The plain-text power path (review round 13). Pure readers and writers, shared by the app's Home box (index.html),
// the full invite (/g) and the light invite (/e, loaded by public/slots.js):
// - parseIcs: an .ics file or pasted VEVENT (SUMMARY, DTSTART, DTEND, LOCATION, DESCRIPTION, RRULE weekly or monthly).
// - parseText: a Discord message or a Markdown block (headings, **When:** lines, Discord <t:...> timestamps; mentions,
//   custom emoji and markup taken out) into a title, date, time, place and plain text for Potto to read.
// - toMarkdown: an invite as Markdown, to paste into a README, a Discord channel or a wiki.
// - curlLine: the one-line reply for the Terminal look (POST /api/public/reply/:id with the guest's own reply id and code).
(function (root) {
  const pad = (n) => String(n).padStart(2, "0");
  const localISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, localHM = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const isIcs = (t) => /BEGIN:VEVENT/i.test(String(t || "")) && /DTSTART/i.test(String(t || ""));

  // ---------- ICS ----------
  const unesc = (v) => String(v || "").replace(/\\([\\;,nN])/g, (m, c) => (c === "n" || c === "N" ? "\n" : c));
  function parseIcs(text) {
    const lines = String(text || "").replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n"), P = {};
    let inEv = false;
    for (const raw of lines) { const l = raw.trimEnd(); if (/^BEGIN:VEVENT$/i.test(l)) { inEv = true; continue; } if (/^END:VEVENT$/i.test(l)) { if (inEv && P.DTSTART) break; inEv = false; continue; }
      if (!inEv) continue; const m = /^([A-Za-z-]+)((?:;[^:]*)?):(.*)$/.exec(l); if (!m) continue; const k = m[1].toUpperCase(); if (P[k]) continue;
      const params = Object.fromEntries(m[2].split(";").filter(Boolean).map((x) => { const [a, b = ""] = x.split("="); return [a.toUpperCase(), b.replace(/^"|"$/g, "")]; })); P[k] = { v: m[3], params }; }
    if (!P.DTSTART) return null;
    const when = (x) => { if (!x) return null; const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(x.v.trim()); if (!m) return null;
      if (!m[4]) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: "" };
      if (m[7]) { const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])); return { date: localISO(d), time: localHM(d) }; }
      return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}`, tz: x.params.TZID || "" }; };
    const s = when(P.DTSTART), e = when(P.DTEND), rr = P.RRULE ? /FREQ=(WEEKLY|MONTHLY)/i.exec(P.RRULE.v) : null, iv = P.RRULE ? +(/INTERVAL=(\d+)/i.exec(P.RRULE.v) || [])[1] || 1 : 1;
    if (!s) return null;
    const out = { title: unesc(P.SUMMARY?.v).trim().slice(0, 120), date: s.date, startTime: s.time, endTime: e && e.date === s.date ? e.time : e && e.time ? e.time : "", place: unesc(P.LOCATION?.v).trim().slice(0, 200), description: unesc(P.DESCRIPTION?.v).trim().slice(0, 1500) };
    if (rr) out.repeat = rr[1].toUpperCase() === "WEEKLY" ? (iv === 2 ? "biweekly" : "weekly") : "monthly";
    if (s.tz) out.tz = s.tz;
    return out;
  }

  // ---------- Discord and Markdown ----------
  const DT = /<t:(\d{9,11})(?::[tTdDfFR])?>/;
  function cleanMd(t) {
    return String(t || "").replace(/<a?:[A-Za-z0-9_]+:\d+>/g, "").replace(/<(?:@[!&]?|#)\d+>/g, "").replace(/(^|\s):[a-z0-9_+-]{2,30}:(?=\s|$)/g, "$1")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\((?:https?:[^)]*)\)/g, "$1").replace(/```[\s\S]*?```/g, " ").replace(/`([^`]*)`/g, "$1")
      .replace(/\*\*|__|~~|\|\|/g, "").replace(/(^|\s)[*_](\S[^*_\n]*?)[*_](?=\s|$|[.,!?])/g, "$1$2").replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/gm, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }
  const looksMd = (t) => /(^|\n)\s{0,3}(#{1,6}\s|>\s|[-*+]\s)|\*\*[^*]+\*\*|<t:\d{9,11}|<@!?\d+>|<a?:[A-Za-z0-9_]+:\d+>/.test(String(t || ""));
  function parseText(text) {
    const raw = String(text || ""), o = { title: "", date: "", startTime: "", place: "", text: "" };
    const h = /(?:^|\n)\s{0,3}#{1,3}\s+(.+)/.exec(raw); if (h) o.title = cleanMd(h[1]).slice(0, 120);
    const label = (re) => { const m = new RegExp(`(?:^|\\n)\\s*(?:[-*>]\\s*)?\\**(?:${re})\\**\\s*:\\s*\\**\\s*(.+)`, "i").exec(raw); return m ? m[1] : ""; };
    const dt = DT.exec(raw); if (dt) { const d = new Date(+dt[1] * 1000); o.date = localISO(d); o.startTime = localHM(d); }
    const where = label("where|location|place|venue"); if (where) o.place = cleanMd(where.replace(DT, "")).slice(0, 200);
    if (!o.title) { const b = /^\s*\*\*([^*\n]{3,80})\*\*\s*$/m.exec(raw); if (b && !/:\s*$/.test(b[1])) o.title = cleanMd(b[1]); }
    // the readable sentence: Discord timestamps become words Potto reads
    o.text = cleanMd(raw.replace(new RegExp(DT.source, "g"), (m, s) => { const d = new Date(+s * 1000); return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) + " at " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }));
    return o;
  }

  // ---------- out ----------
  const mdEsc = (s) => String(s ?? "").replace(/([\\`*_[\]<>|])/g, "\\$1").replace(/^(\s*)([#>+-])/gm, "$1\\$2");
  const dayOf = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || "") ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "");
  const clock = (t) => { const m = /^(\d{2}):(\d{2})$/.exec(t || ""); if (!m) return ""; let h = +m[1]; const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return `${h}${m[2] === "00" ? "" : ":" + m[2]}${ap}`; };
  /** An invite as Markdown: { title, date, startTime, endTime, area, host, url, concept, spots, episode }. Pure. */
  function toMarkdown(o) {
    const when = [dayOf(o.date), [clock(o.startTime), clock(o.endTime)].filter(Boolean).join(" to ")].filter(Boolean).join(", ");
    const rows = [when && `**When:** ${mdEsc(when)}`, o.area && `**Where:** ${mdEsc(o.area)}`, o.host && `**Host:** ${mdEsc(o.host)}`, o.spots && `**Spots:** ${mdEsc(o.spots)}`].filter(Boolean);
    return [`# ${mdEsc(o.title || "You're invited")}`, "", ...rows, ...(o.concept ? ["", mdEsc(String(o.concept).trim())] : []), ...(o.url ? ["", `[RSVP](${String(o.url).replace(/[()\s]/g, encodeURIComponent)})`] : [])].join("\n") + "\n";
  }
  const shq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
  /** The one-line reply, for a guest's own reply only. Pure. */
  const curlLine = (origin, id, rid, code, resp = "in") => `curl -sX POST ${origin}/api/public/reply/${encodeURIComponent(id)} -H 'Content-Type: application/json' -d ${shq(JSON.stringify({ rid, code, response: resp }))}`;

  root.PlainText = { isIcs, parseIcs, parseText, looksMd, cleanMd, toMarkdown, curlLine, mdEsc };
})(typeof window !== "undefined" ? window : globalThis);
