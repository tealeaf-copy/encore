// People: one address book per host or brand, built from what really happened, so nobody needs a spreadsheet to work
// out who to invite. Everyone who replied to, came to, was let in to, joined the fan club of, followed, supported or
// gave kudos to this workspace is here, with no import. A brand can still paste emails or upload a CSV once (with a
// dedupe preview), and any list exports to CSV for a CRM.
//
// What we keep, in the host's workspace only:
//   contacts/<id>      the host's own notes, tags, company fields, consent and anything imported (id = hash of the key)
//   contactsoff/<id>   a person asked this host to forget them: the book skips them, even though their replies stay
//   peoplelists/<id>   saved smart lists: a name and a few filter chips
//   peopleaccess/main  brand team roles: who can see contacts (manage, view, none)
// Everything else (attendance, replies, follows) is worked out on read from rsvps, events, followers, clubmembers,
// kudos and pledges, so it is never stale and never copied.
//
// Privacy: the book is only readable by the workspace (and, for a brand, by team members with a role that allows it).
// Emails are shown to "manage" only; "view" sees first names, tags and counts. Blocks either way take someone out of
// the book. Unsubscribes (server/email.js) and a brand's consent record are shown and honoured by every send. A guest
// sees what each host holds about them, and can delete it, at GET/DELETE /api/me/held.
import crypto from "node:crypto";
import { scopeStore, getWorkspace, allWorkspaceIds, DEFAULT_WS, getDbUser, membersOf } from "./workspaces.js";
import { isUnsubscribed, EMAIL_RE } from "./email.js";

export const lc = (s) => String(s || "").trim().toLowerCase();
export const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
export const h24 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 24);
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, n);
const line1 = (v, n) => clean(v, n).replace(/\s+/g, " ");
const DAY = 864e5;
const telKey = (p) => { const d = String(p || "").replace(/[^\d+]/g, ""); return d.length >= 7 ? "tel:" + d : ""; };
export const keyFor = (email, phone) => (EMAIL_RE.test(lc(email)) ? lc(email) : telKey(phone));
export const idOf = (key) => h24("person|" + key);
const dateMs = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || "")) ? Date.parse(d + "T12:00:00Z") : 0);
export const maskEmail = (e) => { const [a, b] = String(e || "").split("@"); return a && b ? `${a[0]}***@${b}` : ""; };

export const TAGS_SUGGESTED = ["VIP", "Customer", "Press", "Regular", "Friend", "Partner", "Speaker"];
export const TAG_MAX = 12, NOTE_MAX = 600, IMPORT_MAX = 5000;
export const ROLES = ["manage", "view", "none"];
export const TIER_LABEL = { monthly: "Monthly supporters", yearly: "Yearly supporters", founding: "Founding supporters" };

/** Is this a brand workspace (a team, not someone hosting friends)? */
export const isBrandWs = (ws) => { const W = getWorkspace(ws); return !!W && ws !== DEFAULT_WS && (W.personal === false || (!!W.plan && W.plan !== "friends")); };

// ---------------- smart list chips ----------------
// A chip is { k, v?, n?, not? }. Chips in one list all have to match (AND). Plain-language labels below.
export const CHIP_KINDS = ["came", "again", "club", "follower", "city", "tag", "maybeLast", "repliedNeverCame", "noShow", "new", "supporter", "company", "optin", "notInvited", "lapsed", "recent", "q", "imported", "plusOnes"];
export function chipLabel(c = {}) {
  const v = String(c.v ?? ""), n = +c.n || 0, not = !!c.not;
  const L = {
    came: () => (not ? `Came fewer than ${n || 2} times` : `Came ${n || 2}+ times`),
    again: () => (not ? "Didn't say would go again" : "Would go again"),
    club: () => (not ? "Not in the fan club" : "Fan club"),
    follower: () => (not ? "Not following" : "Followers"),
    city: () => `${not ? "Not in" : "In"} ${v || "a city"}`,
    tag: () => (not ? `Not ${v}` : v || "Tagged"),
    maybeLast: () => (not ? "Didn't say maybe last time" : "Said maybe last time"),
    repliedNeverCame: () => (not ? "Has come before" : "Never came but replied"),
    noShow: () => (not ? "No no-shows" : "No-shows"),
    new: () => (not ? "Has come before" : "Never came"),
    supporter: () => (not ? "Not a supporter" : v ? TIER_LABEL[v] || "Supporters" : "Supporters"),
    company: () => `${not ? "Not at" : "At"} ${v || "a company"}`,
    optin: () => (not ? "No email opt-in" : "Opted in to email"),
    notInvited: () => (not ? "Already invited" : "Not invited yet"),
    lapsed: () => `Came before, not in ${n || 90} days`,
    recent: () => `Seen in the last ${n || 30} days`,
    q: () => `Matches "${v}"`,
    imported: () => (not ? "Not imported" : "Imported"),
    plusOnes: () => (not ? "Comes alone" : "Brings a plus-one"),
  };
  return (L[c.k] || (() => String(c.k || "")))();
}
export function cleanChips(chips) {
  return (Array.isArray(chips) ? chips : []).slice(0, 8).map((c) => ({ k: String(c?.k || ""), ...(c?.v != null && c.v !== "" ? { v: line1(c.v, 60) } : {}), ...(+c?.n > 0 ? { n: Math.min(999, Math.floor(+c.n)) } : {}), ...(c?.not ? { not: true } : {}) }))
    .filter((c) => CHIP_KINDS.includes(c.k));
}
/** Does person p match one chip? ctx: { now, invited: Set of person ids already in this event's plan } */
export function chipMatch(p, c, ctx = {}) {
  const t = ctx.now || Date.now(), v = lc(c.v), n = +c.n || 0;
  const hit = (() => { switch (c.k) {
    case "came": return p.attended >= (n || 2);
    case "again": return !!p.again;
    case "club": return !!p.club;
    case "follower": return !!p.follower;
    case "city": return !!v && lc(p.city).includes(v);
    case "tag": return !!v && (p.tags || []).some((x) => lc(x) === v);
    case "maybeLast": return p.lastReply?.response === "maybe";
    case "repliedNeverCame": return p.replies > 0 && !p.attended;
    case "noShow": return p.noShows > 0;
    case "new": return !p.attended;
    case "supporter": return v ? p.tier === v : !!p.tier;
    case "company": return !!v && lc(p.company).includes(v);
    case "optin": return p.consent?.status === "in" && !p.unsubscribed;
    case "notInvited": return !(ctx.invited && ctx.invited.has(p.id));
    case "lapsed": return p.attended > 0 && p.lastSeen && t - p.lastSeen > (n || 90) * DAY;
    case "recent": return !!p.lastSeen && t - p.lastSeen <= (n || 30) * DAY;
    case "q": return !!v && [p.name, p.fullName, p.company, p.city, ...(p.tags || [])].some((x) => lc(x).includes(v)) || (!!v && !!ctx.withEmail && lc(p.email).includes(v));
    case "imported": return !!p.imported;
    case "plusOnes": return p.plusOnes > 0;
    default: return false; } })();
  return c.not ? !hit : hit;
}
export const matchAll = (p, chips, ctx) => (chips || []).every((c) => chipMatch(p, c, ctx));

/** The lists every host gets, before saving any of their own. Cities come from the book (the most common one). */
export function builtinLists(people, { brand = false } = {}) {
  const cities = new Map(); for (const p of people) if (p.city && p.follower) cities.set(p.city, (cities.get(p.city) || 0) + 1);
  const topCity = [...cities.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  const L = [
    ["regulars", "Came 2+ times", [{ k: "came", n: 2 }]],
    ["again", "Would go again", [{ k: "again" }]],
    ["club", "Fan club", [{ k: "club" }]],
    ...(topCity ? [["city", `Followers in ${topCity}`, [{ k: "follower" }, { k: "city", v: topCity }]]] : []),
    ["vip", "VIP", [{ k: "tag", v: "VIP" }]],
    ["maybe", "Said maybe last time", [{ k: "maybeLast" }]],
    ["nevercame", "Never came but replied", [{ k: "repliedNeverCame" }]],
    ["noshows", "No-shows", [{ k: "noShow" }]],
    ...(brand ? [["customers", "Customers", [{ k: "tag", v: "Customer" }]], ["optin", "Opted in to email", [{ k: "optin" }]], ["lapsed", "Came before, not in 90 days", [{ k: "lapsed", n: 90 }]]] : []),
  ];
  return L.map(([id, name, chips]) => ({ id: "b-" + id, name, chips, builtin: true }));
}

// ---------------- expected yes ----------------
/** How likely this person is to say I'm in, from their own past replies here, with a gentle start for new ties.
 * (yes + a·base) / (asked + a), where asked counts their replies and invites they never answered. */
export function replyRate(p) {
  const base = p.again ? 0.75 : p.club ? 0.7 : p.attended > 0 ? 0.65 : p.follower ? 0.4 : p.imported ? 0.3 : 0.45, a = 2;
  const asked = (p.replies || 0) + (p.unanswered || 0), r = ((p.yes || 0) + a * base) / (asked + a);
  return Math.max(0.05, Math.min(0.95, r));
}
/** "expect ~15 yes": the sum of each person's reply rate. */
export const expectedYes = (people) => Math.round(people.reduce((s, p) => s + replyRate(p), 0));

// ---------------- CSV ----------------
export function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false; const s = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) { const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === "," || ch === "\t" || ch === ";") { row.push(cell); cell = ""; } else if (ch === "\n" || ch === "\r") { if (ch === "\r" && s[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; } else cell += ch; }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean));
}
export const csvCell = (s) => `"${String(s ?? "").replace(/"/g, '""').replace(/^[=+\-@\t\r]/, "'$&")}"`;
/** Pasted emails ("Ada <ada@x.com>, bo@y.com") or a CSV with a header row, as rows of { email, name, company, title, city, tags, optin }. */
export function readImport(text) {
  const raw = String(text || "").slice(0, 2_000_000), rows = parseCsv(raw), out = [], bad = [];
  const head = rows[0]?.map(lc) || [], hasHead = head.some((h) => /^(work |primary )?e-?mail( address)?$/.test(h)) && !head.some((h) => h.includes("@"));
  if (hasHead) {
    const col = (re) => head.findIndex((h) => re.test(h)), ix = { email: col(/e-?mail/), name: col(/^(full )?name$|^name/), firstN: col(/first/), lastN: col(/last/), company: col(/company|account|organi[sz]ation/), title: col(/title|role|job/), city: col(/city|location/), tags: col(/tag|segment|label/), optin: col(/opt|consent|subscri|marketing/) };
    for (const r of rows.slice(1)) { const g = (k) => (ix[k] >= 0 ? r[ix[k]] || "" : "");
      const email = lc(g("email")); if (!EMAIL_RE.test(email)) { if (r.some(Boolean)) bad.push(r.join(", ").slice(0, 80)); continue; }
      const name = line1(g("name") || [g("firstN"), g("lastN")].filter(Boolean).join(" "), 80);
      const o = lc(g("optin")); out.push({ email, name, company: line1(g("company"), 80), title: line1(g("title"), 80), city: line1(g("city"), 60), tags: g("tags").split(/[|;/]/).map((x) => line1(x, 30)).filter(Boolean).slice(0, 6), optin: /^(y|yes|true|1|opted in|in|subscribed)$/.test(o) ? "in" : /^(n|no|false|0|out|unsubscribed|opted out)$/.test(o) ? "out" : "" }); }
  } else {
    for (const m of raw.split(/[\n,;]+/)) { const s = m.trim(); if (!s) continue; const em = (s.match(/[^\s<>",;]+@[^\s<>",;]+\.[^\s<>",;]{2,}/) || [])[0];
      if (!em || !EMAIL_RE.test(lc(em))) { bad.push(s.slice(0, 80)); continue; }
      const name = line1(s.replace(em, "").replace(/[<>"()]/g, " "), 80); out.push({ email: lc(em), name, company: "", title: "", city: "", tags: [], optin: "" }); }
  }
  return { rows: out.slice(0, IMPORT_MAX), bad: bad.slice(0, 50), over: out.length > IMPORT_MAX };
}

// ---------------- the book ----------------
export function makePeople({ store, C, F = null, now: clock = () => Date.now() }) {
  const S0 = (ws) => scopeStore(store, ws);
  const owner = (ws) => lc(getWorkspace(ws)?.ownerEmail);
  const blocked = (ws, email) => { try { return !!email && !!F?.blocked?.(ws, email); } catch { return false; } };
  const cache = new Map(); // ws -> the book, for the rest of this tick: one request reads it a few times

  function build(ws, { fresh = false } = {}) {
    const t = clock(); const c = cache.get(ws); if (!fresh && c) return c.people;
    const S = S0(ws), today = new Date(t).toISOString().slice(0, 10), own = owner(ws), M = new Map();
    const off = new Set(S.list("contactsoff").map((d) => d.id));
    const get = (key, name = "") => { if (!key) return null; let p = M.get(key); if (!p) { p = { key, id: idOf(key), email: key.includes("@") ? key : "", phone: key.startsWith("tel:") ? key.slice(4) : "", fullName: "", name: "", via: new Set(), attended: 0, came: [], replies: 0, yes: 0, maybe: 0, no: 0, noShows: 0, plusOnes: 0, lastSeen: 0, firstSeen: 0, again: false, kudos: 0, club: false, follower: false, tier: "", tags: [], notes: "", company: "", title: "", city: "", imported: false, unanswered: 0, lastReply: null, waitlisted: 0, letIn: 0, sharedFull: false }; M.set(key, p); }
      if (name && !p.fullName) p.fullName = line1(name, 80); return p; };
    const seen = (p, at) => { if (at) { p.lastSeen = Math.max(p.lastSeen, at); p.firstSeen = p.firstSeen ? Math.min(p.firstSeen, at) : at; } };
    const events = new Map(S.list("events").map((d) => [d.id, d.data || {}]).filter(([, e]) => !e.example && !e.sample));
    const R = S.list("rsvps").map((d) => ({ id: d.id, ...(d.data || {}) })).filter((r) => events.has(r.eventId) && !r.deletedAccount);
    const door = new Set(R.filter((r) => r.checkedInAt).map((r) => r.eventId));
    // replies, newest last, so "last reply" is the latest event
    R.sort((a, b) => (dateMs(events.get(a.eventId)?.date) || a.createdAt || 0) - (dateMs(events.get(b.eventId)?.date) || b.createdAt || 0));
    const counted = new Set();
    for (const r of R) { const key = keyFor(r.email, r.phone); if (!key || key === own) continue; const ev = events.get(r.eventId), p = get(key, r.name); if (/\s/.test(String(r.name || "").trim())) p.sharedFull = true;
      const ck = key + "|" + r.eventId; if (counted.has(ck)) continue; counted.add(ck);
      const past = !!ev.date && ev.date < today, resp = r.response;
      if (["going", "maybe", "no", "declined", "requested", "waitlist"].includes(resp)) { p.replies++; p.via.add("replied"); p.lastReply = { eventId: r.eventId, response: resp === "declined" ? "no" : resp, at: dateMs(ev.date) || r.createdAt || 0 }; }
      if (resp === "going") p.yes++; else if (resp === "maybe") p.maybe++; else if (resp === "no" || resp === "declined") p.no++;
      if (resp === "waitlist") { p.waitlisted++; p.via.add("waitlist"); }
      if (r.letInAt) { p.letIn++; p.via.add("let_in"); }
      if (resp === "going" && past) { const came = r.noShow !== true && (!door.has(r.eventId) || !!r.checkedInAt || r.noShow === false);
        if (came) { p.attended++; p.came.push(r.eventId); p.via.add("came"); seen(p, dateMs(ev.date)); } else p.noShows++; }
      else seen(p, r.changedAt || r.createdAt || 0);
      const extra = Math.max(0, (Math.floor(+r.party) || 0) - 1, Math.floor(+r.plusOnes) || 0, r.plusOne ? 1 : 0); if (extra && resp === "going") p.plusOnes += extra; }
    // a host's own guest list on each event (brands keep company and title here)
    for (const [eid, ev] of events) for (const g of ev.guests || []) { const key = keyFor(g.email, g.phone); if (!key || key === own) continue; const ck = key + "|" + eid; const p = get(key, g.name); if (g.company && !p.company) p.company = line1(g.company, 80); if (g.title && !p.title) p.title = line1(g.title, 80); if (g.name && /\s/.test(g.name.trim())) p.sharedFull = true;
      if (counted.has(ck)) continue; const st = String(g.status || ""); if (st === "Not invited" || !st) { p.via.add("listed"); continue; } counted.add(ck);
      if (/Attended/.test(st)) { p.attended++; p.came.push(eid); p.yes++; p.replies++; p.via.add("came"); seen(p, dateMs(ev.date)); }
      else if (st === "No-show") { p.noShows++; p.yes++; p.replies++; }
      else if (st === "Going") { p.yes++; p.replies++; p.via.add("replied"); }
      else if (st === "Maybe") { p.maybe++; p.replies++; p.via.add("replied"); p.lastReply = { eventId: eid, response: "maybe", at: dateMs(ev.date) }; }
      else if (st === "Declined") { p.no++; p.replies++; p.via.add("replied"); }
      else if (st === "Invited") { p.unanswered++; p.via.add("invited"); } }
    // follows, the fan club, supporters, kudos
    for (const d of S.list("followers")) { const f = d.data || {}; if (f.pending) continue; const key = keyFor(f.email, f.phone); if (!key || key === own) continue; const p = get(key, f.name); p.follower = true; p.via.add("follower"); p.followerAt = f.at || 0; seen(p, f.at || 0); if (!p.city && f.city) p.city = line1(f.city, 60); }
    for (const d of S.list("clubmembers")) { const m = d.data || {}; if (m.leftAt || m.removedAt) continue; const key = keyFor(m.email); if (!key || key === own) continue; const p = get(key, m.name); p.club = true; p.via.add("club"); p.clubSince = m.joinedAt || 0; }
    for (const d of S.list("pledges")) { const x = d.data || {}; if (!x.tier || x.tier === "none") continue; const key = keyFor(x.email); if (!key || key === own) continue; const p = get(key, x.name); p.tier = x.tier; p.via.add("supporter"); }
    for (const d of S.list("kudos")) { const k = d.data || {}; const key = keyFor(k.email); if (!key || key === own || !events.has(k.eventId)) continue; const p = get(key, k.name); p.kudos++; p.via.add("kudos"); if ((k.tags || []).includes("again") || k.compare === "better") p.again = true; }
    // what the host added: notes, tags, company fields, consent, people they imported
    for (const d of S.list("contacts")) { const x = d.data || {}; const key = x.key || keyFor(x.email, x.phone); if (!key || key === own) continue; const p = get(key, x.name);
      if (x.imported) { p.imported = true; p.via.add("imported"); p.sharedFull = true; }
      for (const k of ["company", "title", "city", "notes"]) if (x[k]) p[k] = x[k];
      if (x.name && x.imported) p.fullName = x.name; if (Array.isArray(x.tags)) p.tags = x.tags; if (x.consent) p.consent = x.consent; if (x.importedAt) seen(p, 0); p.stored = true; }
    // the city a guest put on their own account, when the host has none
    const out = [];
    for (const p of M.values()) {
      if (off.has(p.id) || (p.email && blocked(ws, p.email))) continue;
      if (!p.city && p.email) { try { const u = getDbUser(p.email); if (u?.city) p.city = line1(u.city, 60); } catch {} }
      p.name = p.sharedFull ? p.fullName : first(p.fullName) || (p.email ? p.email.split("@")[0] : "Guest");
      p.unsubscribed = !!p.email && isUnsubscribed(p.email);
      p.consent = p.unsubscribed ? { status: "out", source: "unsubscribed", at: p.consent?.at || 0 } : p.consent || { status: p.via.size && [...p.via].some((v) => v !== "imported") ? "activity" : "unknown", source: [...p.via][0] || "" };
      p.via = [...p.via]; p.rate = Math.round(replyRate(p) * 100) / 100;
      out.push(p); }
    out.sort((a, b) => b.attended - a.attended || b.lastSeen - a.lastSeen || a.name.localeCompare(b.name));
    cache.set(ws, { at: t, people: out }); setImmediate(() => cache.delete(ws)); // one synchronous request reuses it; the next one rebuilds
    return out;
  }
  const bust = (ws) => cache.delete(ws);
  const byId = (ws, id) => build(ws).find((p) => p.id === id) || null;
  const byKey = (ws, key) => build(ws).find((p) => p.key === lc(key)) || null;

  // ---- what the host writes ----
  const cPath = (id) => "contacts/" + id;
  function edit(ws, id, b = {}) {
    const p = byId(ws, id); if (!p) return { error: "No one by that id.", status: 404 };
    const cur = S0(ws).get(cPath(id))?.data || {};
    const next = { ...cur, key: p.key, email: p.email || cur.email || "", phone: p.phone || "", name: cur.name || p.fullName || "" };
    if (b.tags != null) next.tags = [...new Set((Array.isArray(b.tags) ? b.tags : []).map((x) => line1(x, 30)).filter(Boolean))].slice(0, TAG_MAX);
    if (b.notes != null) next.notes = clean(b.notes, NOTE_MAX);
    for (const k of ["company", "title", "city"]) if (b[k] != null) next[k] = line1(b[k], k === "city" ? 60 : 80);
    if (b.consent != null) { const st = ["in", "out", "unknown"].includes(b.consent?.status) ? b.consent.status : "unknown"; next.consent = { status: st, source: line1(b.consent?.source || "Set by the host", 60), at: clock() }; }
    next.updatedAt = clock(); S0(ws).set(cPath(id), next); bust(ws); return { person: byId(ws, id) };
  }
  /** Rows from readImport against the book: who is new, who is already here (and would get fields filled in), duplicates in the paste. */
  function importPreview(ws, rows) {
    const have = new Map(build(ws).map((p) => [p.key, p])), seen = new Set(), add = [], update = [], dupes = [], own = owner(ws);
    for (const r of rows) { const k = lc(r.email); if (!k || k === own) continue; if (seen.has(k)) { dupes.push(k); continue; } seen.add(k);
      const p = have.get(k); if (p) update.push({ id: p.id, name: p.name, email: k, fills: ["company", "title", "city"].filter((f) => r[f] && !p[f]), tags: r.tags || [] }); else add.push({ email: k, name: r.name || "", company: r.company || "" }); }
    return { add, update, dupes: dupes.length, total: rows.length };
  }
  function importRows(ws, rows, { source = "Import", consent = "" } = {}) {
    const pre = importPreview(ws, rows), have = new Map(build(ws).map((p) => [p.key, p])), seen = new Set(); let added = 0, updated = 0;
    for (const r of rows) { const k = lc(r.email); if (!k || k === owner(ws) || seen.has(k)) continue; seen.add(k); const id = idOf(k), cur = S0(ws).get(cPath(id))?.data || {}, p = have.get(k);
      const st = r.optin || consent || ""; const next = { ...cur, key: k, email: k, name: cur.name || r.name || "", imported: cur.imported || !p, importedAt: cur.importedAt || clock(), source: cur.source || line1(source, 60) };
      for (const f of ["company", "title", "city"]) if (r[f] && !cur[f] && !(p && p[f])) next[f] = r[f];
      if (r.tags?.length) next.tags = [...new Set([...(cur.tags || []), ...r.tags])].slice(0, TAG_MAX);
      if (st && !(cur.consent?.status === "out")) next.consent = { status: st === "in" ? "in" : st === "out" ? "out" : "unknown", source: line1(source, 60), at: clock() };
      S0(ws).set(cPath(id), next); if (p) updated++; else added++; }
    bust(ws); return { added, updated, dupes: pre.dupes };
  }

  // ---- saved lists ----
  function lists(ws) { const P = build(ws), saved = S0(ws).list("peoplelists").map((d) => ({ id: d.id, ...(d.data || {}), chips: cleanChips(d.data?.chips) })).sort((a, b) => (a.at || 0) - (b.at || 0));
    return [...builtinLists(P, { brand: isBrandWs(ws) }), ...saved].map((l) => ({ ...l, count: P.filter((p) => matchAll(p, l.chips)).length, labels: l.chips.map(chipLabel) })); }
  function saveList(ws, { id, name, chips }) { const ch = cleanChips(chips); if (!ch.length) return { error: "Pick at least one filter." }; const nm = line1(name, 60) || ch.map(chipLabel).join(", ").slice(0, 60);
    if (id && /^[A-Za-z0-9_-]{1,40}$/.test(id) && S0(ws).get("peoplelists/" + id)) { S0(ws).update("peoplelists/" + id, { name: nm, chips: ch }); return { id }; }
    if (S0(ws).list("peoplelists").length >= 50) return { error: "That's 50 lists. Delete one first." };
    const r = S0(ws).add("peoplelists", { name: nm, chips: ch, at: clock() }); return { id: r.id }; }
  const listChips = (ws, id) => (lists(ws).find((l) => l.id === id) || {}).chips || null;

  // ---- team roles (brands) ----
  function access(ws, email) { const em = lc(email); if (!em) return "none"; if (em === owner(ws)) return "manage";
    const A = S0(ws).get("peopleaccess/main")?.data?.members || {}; const set = A[h24(em)];
    if (ROLES.includes(set)) return set; if (!isBrandWs(ws)) return "manage"; // someone hosting with friends shares the book with their co-hosts
    return "view"; }
  function setAccess(ws, email, role) { if (!ROLES.includes(role)) return { error: "Pick manage, view or none." }; const em = lc(email); if (em === owner(ws)) return { error: "The owner always manages contacts." };
    if (!membersOf(ws).some((m) => lc(m.email) === em)) return { error: "They aren't on your team.", status: 404 };
    const cur = S0(ws).get("peopleaccess/main")?.data || { members: {} }; S0(ws).set("peopleaccess/main", { members: { ...cur.members, [h24(em)]: role }, updatedAt: clock() }); return { ok: true }; }
  const team = (ws) => membersOf(ws).map((m) => ({ name: m.name || "", email: m.email, roles: m.roles || [], owner: lc(m.email) === owner(ws), access: access(ws, m.email) }));

  // ---- a guest's own view: what each host holds about them ----
  function heldAbout(email) { const em = lc(email), out = []; if (!em) return out;
    for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; let p = null; try { p = build(ws).find((x) => x.key === em); } catch {} if (!p) continue; const h = C?.profileOf?.(ws) || {}, W = getWorkspace(ws) || {};
      out.push({ ws: h24("held|" + ws).slice(0, 16), host: h.name || W.company || "A host", handle: h.handle || "", via: p.via, attended: p.attended, replies: p.replies, noShows: p.noShows, lastSeen: p.lastSeen, tags: p.tags, notes: p.notes, company: p.company, title: p.title, city: p.city, consent: p.consent?.status || "", imported: p.imported }); }
    return out; }
  /** Forget me: the host's notes, tags and imports go, and the book skips this person from now on. */
  function forget(email, wsToken) { const em = lc(email); let n = 0;
    for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; if (wsToken && h24("held|" + ws).slice(0, 16) !== wsToken) continue; const id = idOf(em), S = S0(ws);
      let had = false; try { had = !!S.get(cPath(id)) || build(ws).some((x) => x.key === em); } catch {} if (!had) continue;
      S.delete(cPath(id)); S.set("contactsoff/" + id, { at: clock() }); bust(ws); n++; }
    return n; }

  return { build, bust, byId, byKey, edit, importPreview, importRows, lists, saveList, listChips, access, setAccess, team, heldAbout, forget, owner, S0 };
}

/** A person as a team member with this role may see them. Only "manage" sees emails and phones. */
export function view(p, role, { full = false } = {}) {
  const em = role === "manage";
  return { id: p.id, name: p.name, email: em ? p.email : p.email ? maskEmail(p.email) : "", hasEmail: !!p.email, phone: em ? p.phone : "", via: p.via, attended: p.attended, replies: p.replies, yes: p.yes, maybe: p.maybe, no: p.no, noShows: p.noShows, plusOnes: p.plusOnes,
    lastSeen: p.lastSeen, again: p.again, kudos: p.kudos, club: p.club, follower: p.follower, tier: p.tier, tags: p.tags, notes: em || full ? p.notes : "", company: p.company, title: p.title, city: p.city, imported: p.imported,
    consent: p.consent, unsubscribed: p.unsubscribed, rate: p.rate, lastReply: p.lastReply ? { response: p.lastReply.response, eventId: p.lastReply.eventId } : null };
}

export function mountPeople(app, { store, small, big = small, currentUser, C, sendStatic = null }) {
  const P = makePeople({ store, C, F: app.locals.fanclub || null });
  app.locals.people = P;
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const who = (req, res, need = "view") => { let u = null; try { u = currentUser(req); } catch {} if (!u || !u.ws || u.ws === DEFAULT_WS || !u.email) { bad(res, "Sign in to see your people.", 401, "unauthenticated"); return null; }
    const role = P.access(u.ws, u.email); const rank = { none: 0, view: 1, manage: 2 };
    if (rank[role] < rank[need]) { bad(res, role === "none" ? "Your team hasn't shared contacts with you." : "Ask the owner for manage access to do that.", 403, "not_granted"); return null; }
    res.set("Cache-Control", "private, no-store"); return { u, ws: u.ws, role }; };
  const hits = new Map(); const over = (k, n, ms = 3600e3) => { const t = Date.now(); let h = hits.get(k); if (!h || t - h.start > ms) { h = { n: 0, start: t }; hits.set(k, h); } if (hits.size > 20000) hits.clear(); return ++h.n > n; };
  const chipsOf = (req) => { const q = req.query || {}; if (q.list) return P.listChips(req.ws0, String(q.list)); try { return cleanChips(JSON.parse(String(q.chips || "[]"))); } catch { return []; } };

  if (sendStatic) app.get(["/contacts", "/contacts/event/:id"], (req, res) => sendStatic(res, "contacts.html", "<p>Contacts page missing.</p>"));

  // the book: everyone, or one list; with the built-in and saved lists, live counts and suggestions
  app.get("/api/contacts", (req, res) => { const A = who(req, res); if (!A) return; req.ws0 = A.ws;
    const all = P.build(A.ws, { fresh: true }), chips = chipsOf(req) || [], q = String(req.query.q || "").trim();
    const L = all.filter((p) => matchAll(p, chips) && (!q || chipMatch(p, { k: "q", v: q }, { withEmail: A.role === "manage" })));
    const h = C.profileOf(A.ws) || {}, W = getWorkspace(A.ws) || {}, brand = isBrandWs(A.ws);
    res.json({ total: all.length, count: L.length, people: L.slice(0, req.query.limit != null ? Math.max(0, Math.min(2000, +req.query.limit || 0)) : 2000).map((p) => view(p, A.role)), lists: P.lists(A.ws), chips: chips.map((c) => ({ ...c, label: chipLabel(c) })),
      tags: [...new Set([...TAGS_SUGGESTED, ...all.flatMap((p) => p.tags)])].slice(0, 40), cities: [...new Set(all.map((p) => p.city).filter(Boolean))].slice(0, 30),
      suggestions: app.locals.invites?.suggestions?.(A.ws) || [], role: A.role, brand, me: { name: first(A.u.name), handle: h.handle || "", host: h.name || W.company || "" } }); });
  app.get("/api/contacts/:id", (req, res) => { const A = who(req, res); if (!A) return; const p = P.byId(A.ws, String(req.params.id)); if (!p) return bad(res, "No one by that id.", 404, "not_found");
    const S = P.S0(A.ws), evs = new Map(S.list("events").map((d) => [d.id, d.data || {}]));
    const history = S.list("rsvps").map((d) => d.data || {}).filter((r) => keyFor(r.email, r.phone) === p.key && evs.has(r.eventId)).map((r) => { const e = evs.get(r.eventId); return { eventId: r.eventId, title: e.pubTitle || e.name || "An event", date: e.date || "", response: r.response, came: p.came.includes(r.eventId), noShow: r.noShow === true, party: Math.max(1, +r.party || 1) }; }).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    res.json({ person: view(p, A.role, { full: A.role === "manage" }), history, clubSince: p.clubSince || 0, followerAt: p.followerAt || 0 }); });
  app.post("/api/contacts/:id", small, (req, res) => { const A = who(req, res, "manage"); if (!A) return; const r = P.edit(A.ws, String(req.params.id), req.body || {}); if (r.error) return bad(res, r.error, r.status || 400); res.json({ ok: true, person: view(r.person, A.role) }); });
  // tag several at once ("Tag 6 as VIP")
  app.post("/api/contacts-bulk/tag", small, (req, res) => { const A = who(req, res, "manage"); if (!A) return; const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).slice(0, 2000).map(String), tag = line1(req.body?.tag, 30), on = req.body?.on !== false; if (!tag) return bad(res, "Name the tag.");
    let n = 0; for (const id of ids) { const p = P.byId(A.ws, id); if (!p) continue; const T = new Set(p.tags); if (on) T.add(tag); else T.delete(tag); P.edit(A.ws, id, { tags: [...T] }); n++; } res.json({ ok: true, n }); });

  // saved lists
  app.post("/api/contacts-lists", small, (req, res) => { const A = who(req, res, "manage"); if (!A) return; const r = P.saveList(A.ws, req.body || {}); if (r.error) return bad(res, r.error); res.json({ ok: true, id: r.id, lists: P.lists(A.ws) }); });
  app.delete("/api/contacts-lists/:id", (req, res) => { const A = who(req, res, "manage"); if (!A) return; const id = String(req.params.id); if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return bad(res, "No such list.", 404); P.S0(A.ws).delete("peoplelists/" + id); res.json({ ok: true, lists: P.lists(A.ws) }); });
  // count only, for chips as they're picked
  app.get("/api/contacts-count", (req, res) => { const A = who(req, res); if (!A) return; req.ws0 = A.ws; const chips = chipsOf(req) || []; res.json({ count: P.build(A.ws).filter((p) => matchAll(p, chips)).length, labels: chips.map(chipLabel) }); });

  // optional import: preview first (dedupe), then add. Never required.
  app.post("/api/contacts-import/preview", big, (req, res) => { const A = who(req, res, "manage"); if (!A) return;
    const R = readImport(req.body?.text); res.json({ ...P.importPreview(A.ws, R.rows), bad: R.bad, over: R.over }); });
  app.post("/api/contacts-import", big, (req, res) => { const A = who(req, res, "manage"); if (!A) return; if (over("imp|" + A.ws, 20)) return bad(res, "That's a lot of imports for one hour.", 429, "rate_limited");
    const R = readImport(req.body?.text); if (!R.rows.length) return bad(res, "We couldn't find any emails in that.");
    const consent = ["in", "unknown"].includes(req.body?.consent) ? req.body.consent : "";
    const r = P.importRows(A.ws, R.rows, { source: line1(req.body?.source, 60) || "Import", consent }); res.json({ ok: true, ...r }); });

  // export: everyone or one list, for a CRM (manage only)
  app.get("/api/contacts-export.csv", (req, res) => { const A = who(req, res, "manage"); if (!A) return; req.ws0 = A.ws; const chips = chipsOf(req) || [];
    if (over("exp|" + A.ws, 60)) return bad(res, "That's a lot of exports for one hour.", 429, "rate_limited");
    const L = P.build(A.ws).filter((p) => matchAll(p, chips)), d = (t) => (t ? new Date(t).toISOString().slice(0, 10) : "");
    const rows = [["Email", "Phone", "First name", "Last name", "Company", "Title", "City", "Tags", "Connected by", "Events attended", "Last seen", "Would go again", "No-shows", "Plus-ones", "Fan club", "Email opt-in", "Opt-in source", "Opt-in date", "Unsubscribed", "Notes"],
      ...L.map((p) => { const [fn, ...ln] = String(p.fullName || p.name).split(/\s+/); return [p.email, p.phone, fn || "", ln.join(" "), p.company, p.title, p.city, p.tags.join("; "), p.via.join("; "), p.attended, d(p.lastSeen), p.again ? "yes" : "", p.noShows, p.plusOnes, p.club ? "yes" : "", p.consent?.status === "in" ? "yes" : p.consent?.status === "out" ? "no" : "", p.consent?.source || "", d(p.consent?.at), p.unsubscribed ? "yes" : "", p.notes]; })];
    const name = (String(req.query.name || "people").replace(/[^A-Za-z0-9 _-]/g, "").trim().replace(/\s+/g, "-") || "people").slice(0, 40);
    res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"` }).send(rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n"); });

  // brand team roles
  app.get("/api/contacts-team", (req, res) => { const A = who(req, res); if (!A) return; res.json({ brand: isBrandWs(A.ws), role: A.role, team: A.role === "manage" ? P.team(A.ws) : [] }); });
  app.post("/api/contacts-team", small, (req, res) => { const A = who(req, res, "manage"); if (!A) return; if (lc(A.u.email) !== P.owner(A.ws)) return bad(res, "Only the owner changes who can see contacts.", 403, "not_granted");
    const r = P.setAccess(A.ws, req.body?.email, String(req.body?.access || "")); if (r.error) return bad(res, r.error, r.status || 400); res.json({ ok: true, team: P.team(A.ws) }); });

  // a guest: what hosts hold about me, and forget me
  app.get("/api/me/held", (req, res) => { let u = null; try { u = currentUser(req); } catch {} if (!u?.email) return bad(res, "Sign in first.", 401, "unauthenticated"); res.set("Cache-Control", "private, no-store"); res.json({ hosts: P.heldAbout(u.email) }); });
  app.delete(["/api/me/held", "/api/me/held/:token"], (req, res) => { let u = null; try { u = currentUser(req); } catch {} if (!u?.email) return bad(res, "Sign in first.", 401, "unauthenticated"); const n = P.forget(u.email, req.params.token ? String(req.params.token) : ""); res.json({ ok: true, hosts: n }); });
  return P;
}
