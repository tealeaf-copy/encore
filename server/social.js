// The social layer for hosting with friends: friends, a feed with stories, alerts ("tell me about runs within 5 miles"),
// an inbox, kudos after each get-together, event profiles (what kind of guest and host someone is), the group chat,
// guests messaging the host (running late, give my slot away) and photos from the day.
import crypto from "node:crypto";
import express from "express";
import { complete, isFake, parseJsonLoose } from "./ai.js";
import { scopeStore, getWorkspace, allWorkspaceIds, workspaceOfEvent, DEFAULT_WS, getDbUser } from "./workspaces.js";
import { emailConfig, sendEmail } from "./email.js";
import { smsConfig, sendSms, useSmsStop } from "./sms.js";

const hash = (s) => crypto.createHash("sha256").update(String(s || "").trim().toLowerCase()).digest("hex").slice(0, 24);
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").trim().slice(0, n);
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const lc = (s) => String(s || "").trim().toLowerCase();
const DAY = 864e5;
const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
const niceDate = (d) => { const t = /^\d{4}-\d{2}-\d{2}$/.test(String(d || "")) ? new Date(d + "T12:00:00") : null; return t && !isNaN(t) ? t.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : String(d || ""); };
const PHONE_OK = (p) => /^\+?[0-9 ()-]{7,20}$/.test(String(p || "").trim());

// What an event is "about", for alerts, Discover and profiles.
export const LANES = { run: ["run", "5k", "10k", "jog", "trot", "marathon"], hike: ["hike", "trail", "walk"], bike: ["bike", "cycle", "ride"], cook: ["cook", "dinner", "tasting", "dishes", "supper", "dinner party"], potluck: ["potluck"], games: ["game", "board game"], movie: ["movie", "film"], concert: ["concert", "gig", "show", "festival"], cafe: ["cafe", "café", "coffee", "matcha", "tea"], bake: ["bake", "cake", "giveaway", "cookie", "bread"], picnic: ["picnic", "bbq", "cookout"], book: ["book"], club: ["club", "meetup"] };
/** Answers as a list of {q, a}, whether stored as {questionId: value} or (older RSVPs) as [{q, a}]. */
export function ansList(ans, qs = []) { if (Array.isArray(ans)) return ans.filter((a) => a && a.a); if (!ans || typeof ans !== "object") return [];
  return Object.entries(ans).map(([id, v]) => ({ q: (qs || []).find((x) => x.id === id)?.q || "", a: Array.isArray(v) ? v.join(", ") : v === true ? "Yes" : v === false ? "No" : String(v ?? "") })).filter((x) => x.a); }
export function lanesOf(text) { const t = lc(text), L = Object.entries(LANES).filter(([, w]) => w.some((x) => t.includes(x))).map(([k]) => k); return L.length > 1 ? L.filter((k) => k !== "club") : L; }
const miles = (a, b) => { const R = 3958.8, r = (x) => (x * Math.PI) / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng), h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

/** "notify me whenever there's a run event happening within 5 miles away from me that is public" → a rule. */
export function parseAlert(text) {
  const t = lc(text), lanes = lanesOf(t), m = t.match(/(\d+(?:\.\d+)?)\s*(mi|mile|miles|km|kilomet(?:er|re)s?)\b/);
  const radiusMi = m ? (/^k/.test(m[2]) ? +m[1] * 0.621 : +m[1]) : /near me|nearby|close/.test(t) ? 5 : null;
  const free = /\bfree\b/.test(t), weekend = /weekend|saturday|sunday/.test(t) ? (/saturday/.test(t) && !/sunday/.test(t) ? "sat" : /sunday/.test(t) && !/saturday/.test(t) ? "sun" : "weekend") : "";
  const city = (String(text).match(/\bin ([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?)/) || [])[1] || "";
  const parts = [lanes.length ? lanes.join(" or ") + " events" : "any event", radiusMi ? `within ${Math.round(radiusMi * 10) / 10} miles` : city ? `in ${city}` : "near you", free ? "that are free" : "", weekend ? `on ${weekend === "sat" ? "Saturdays" : weekend === "sun" ? "Sundays" : "weekends"}` : "", "and open to the public"].filter(Boolean);
  return { lanes, radiusMi, city, free, weekend, publicOnly: true, summary: parts.join(", ").replace(/, and open/, " and open") };
}
export function alertMatches(a, ev, evGeo) {
  if (!ev?.discoverable || ev.unlisted) return false; // private events never reach strangers' alerts
  const lanes = lanesOf(`${ev.activity || ""} ${ev.pubTitle || ""} ${ev.name || ""}`);
  if (a.lanes?.length && !a.lanes.some((l) => lanes.includes(l))) return false;
  if (a.free && !(ev.free || !ev.price)) return false;
  if (a.weekend && ev.date) { const d = new Date(ev.date + "T12:00:00").getDay(); if (a.weekend === "sat" ? d !== 6 : a.weekend === "sun" ? d !== 0 : d !== 0 && d !== 6) return false; }
  if (a.radiusMi && a.lat != null && evGeo?.lat != null) return miles(a, evGeo) <= a.radiusMi;
  const city = lc(a.city || a.homeCity); if (city) return lc(ev.city).includes(city) || lc(ev.hood).includes(city);
  return !a.radiusMi; // a distance rule needs a location on both sides
}

export const newcomerEmoji = () => "🌱";
// ---- spots: one count used everywhere (the seat check, the waitlist, previews) ----
/** The most people one reply can bring: the guest plus the plus-ones the host allows (one by default), at most 6. */
export const partyMax = (ev) => Math.max(2, Math.min(6, 1 + (Math.floor(+ev?.plusOnes) || 0)));
/** How many spots one reply (or host-marked guest) holds: a party of three holds three. */
export const seatsOf = (r, ev) => Math.max(1, Math.min(ev ? partyMax(ev) : 6, Math.floor(+r?.party) || (+r?.plusOnes > 0 ? 1 + Math.floor(+r.plusOnes) : r?.plusOne ? 2 : 1)));
export const replyKey = (x) => lc(x?.email || x?.name || (x?.phone ? "tel:" + String(x.phone).replace(/[^\d+]/g, "") : ""));
/** Spots held at an event: host-marked guests plus the latest reply from each person, counted once each.
 *  skip: a reply id to leave out (the reply being changed); skipKey: that person's email or name. */
export function seatsTaken(ev, docs, { skip = null, skipKey = "" } = {}) {
  const G = ev?.guests || [], held = new Map(), attended = new Set(G.filter((g) => g.status === "Attended").map(replyKey).filter(Boolean));
  for (const g of G) if (g.status === "Going" || g.status === "Attended") { const k = replyKey(g); if (k) held.set(k, seatsOf(g, ev)); }
  for (const d of docs) { if (d.id === skip) continue; const r = d.data || {}, k = replyKey(r) || "id:" + d.id;
    if (r.response === "going") held.set(k, seatsOf(r, ev)); else if (["no", "waitlist", "declined"].includes(r.response) && !attended.has(k)) held.delete(k); }
  if (skipKey) held.delete(lc(skipKey));
  return [...held.values()].reduce((a, b) => a + b, 0);
}
/** The waitlist in order: who joined it first goes in first. */
export const waitlistOf = (docs) => docs.filter((d) => d.data?.response === "waitlist").sort((a, b) => (a.data.waitAt || a.data.changedAt || a.data.createdAt || 0) - (b.data.waitAt || b.data.changedAt || b.data.createdAt || 0));
/** A reply's place on the waitlist (1 = next in), or 0 when it isn't on it. */
export const waitlistPos = (docs, id) => waitlistOf(docs).findIndex((d) => d.id === id) + 1;
// ---- attendee and host traits ----
export const TRAITS = {
  host: { name: "The Planner", emoji: "🏡", line: "Usually the one who makes it happen." },
  spark: { name: "The Spark", emoji: "⚡", line: "Brings the energy. Things get louder when they arrive." },
  chill: { name: "The Chill One", emoji: "🧘", line: "Easy company. Happy on the couch or the trail." },
  filler: { name: "The Seat Filler", emoji: "🪑", line: "Says yes at the last minute when a spot opens up. Every host's favourite." },
  early: { name: "The Early Bird", emoji: "🐣", line: "Says yes first. Their yes gets everyone else moving." },
  connector: { name: "The Connector", emoji: "🔗", line: "Never comes alone. Brings the friend who needed this." },
  contributor: { name: "The Contributor", emoji: "🧺", line: "Brings snacks, a dish, a speaker, the folding table." },
  helper: { name: "The Helper", emoji: "🙌", line: "Stays to wash up and stack the chairs." },
  regular: { name: "The Regular", emoji: "🫶", line: "Keeps coming back." },
  cheerleader: { name: "The Cheerleader", emoji: "📣", line: "Always the first to send kudos afterwards." },
};
export const KUDOS_TAGS = [["food", "🍜", "Amazing food"], ["welcome", "🤗", "Felt welcome"], ["vibe", "✨", "Great vibe"], ["organized", "📋", "So well organized"], ["met", "👋", "Met new people"], ["fun", "😂", "So much fun"], ["spot", "📍", "Great spot"], ["again", "🔁", "Would go again"]];
// ---- verified kudos: how we know the reviewer was a guest ----
// "guest_list": the reply was I'm in and the host marked them as there (checked in at the door, tapped Came, or Attended
// on the guest list). "rsvp": an I'm-in reply, nothing more. null: the reply wasn't I'm in (a Maybe who left kudos), so
// we claim nothing. Kudos written before this existed have no reply to read when it's gone: they count as "rsvp".
export const VERIFIED_LABEL = { guest_list: "Came, on the guest list", rsvp: "Replied I'm in" };
export function kudosVerified(S, k) {
  if (!k || !S) return null;
  const r = k.rid ? S.get("rsvps/" + String(k.rid).replace(/[^A-Za-z0-9_-]/g, ""))?.data : null, ev = k.eventId ? S.get("events/" + k.eventId)?.data || {} : {};
  const key = replyKey(r || k), row = key ? (ev.guests || []).find((g) => replyKey(g) === key) : null, onList = /Attended/.test(row?.status || "");
  if (!r) return onList ? "guest_list" : "rsvp";
  const came = r.noShow !== true && (r.noShow === false || !!r.checkedInAt || onList);
  if (came && (r.response === "going" || onList)) return "guest_list";
  return r.response === "going" ? "rsvp" : null;
}
/** The label, worked out again on read (the host may have marked who came since), and saved back when it changed. */
export function withVerified(S, id, k) {
  if (!k || typeof k !== "object") return k; let v = null; try { v = kudosVerified(S, k); } catch { return k; }
  if (k.verified !== v && id) { try { S.update("kudos/" + id, { verified: v }); } catch {} }
  return { ...k, verified: v };
}
export const VIBE_TAGS = [["spark", "⚡", "Energy"], ["chill", "🧘", "Easy company"], ["helper", "🙌", "Helped out"], ["welcome", "🤗", "Welcoming"], ["contributor", "🧺", "Brought a treat"]];

export function makeSocial(store, { C, saveBlob }) {
  useSmsStop((num) => !!store.get("system/smsstop-" + hash(num)));
  const sys = (k) => store.get("system/" + k)?.data;
  const put = (k, v) => store.set("system/" + k, v);
  const userOf = (email) => getDbUser(lc(email));
  const handleOf = (email) => { const u = userOf(email); return u ? C.profileOf(u.ws)?.handle || null : null; };
  // ---- people: who a member is, by email ----
  function person(email) { const u = userOf(email); const p = u ? C.profileOf(u.ws) : null; return { email: lc(email), name: u?.name || p?.name || "", handle: p?.handle || null, emoji: p?.emoji || "🙂", color: p?.color || "#E26D8E", ws: u?.ws || null }; }
  function ensureProfile(u) {
    const cur = C.profileOf(u.ws); if (cur?.handle) return cur;
    // brands don't get a host page just by opening the feed (it flipped their menus to the host's)
    if (getWorkspace(u.ws)?.personal === false) return null;
    const base = (first(u.name) || "host").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "").slice(0, 20) || "host";
    for (let i = 0; i < 30; i++) { const h = i ? `${base}-${Math.floor(Math.random() * 900 + 100)}` : base; if (h.length < 2) continue; const r = C.setProfile(u.ws, { handle: h, name: u.name }); if (r.host) return r.host; }
    return null;
  }
  // ---- friends (one-way, like following a person; mutual shows as "friends") ----
  const fKey = (email) => "friends-" + hash(email);
  const friendsOf = (email) => sys(fKey(email))?.list || [];
  function addFriend(email, other) { const L = friendsOf(email).filter((x) => x.email !== lc(other)); L.unshift({ email: lc(other), at: Date.now() }); put(fKey(email), { kind: "friends", email: lc(email), list: L.slice(0, 2000) }); notify(other, { kind: "friend", text: `${first(person(email).name) || "Someone"} added you as a friend`, from: lc(email), link: handleOf(email) ? `/h/${handleOf(email)}` : "/feed" }); }
  function dropFriend(email, other) { put(fKey(email), { kind: "friends", email: lc(email), list: friendsOf(email).filter((x) => x.email !== lc(other)) }); }
  // ---- inbox ----
  const iKey = (email) => "inbox-" + hash(email);
  function notify(email, n) { if (!email) return; const L = sys(iKey(email))?.list || []; if (n.key && L.some((x) => x.key === n.key)) return false; L.unshift({ id: crypto.randomBytes(6).toString("hex"), at: Date.now(), read: false, ...n }); put(iKey(email), { kind: "inbox", email: lc(email), list: L.slice(0, 200) }); return true; }
  const inbox = (email) => sys(iKey(email))?.list || [];
  const prefs = (email) => sys("prefs-" + hash(email)) || { emails: true };
  const canEmail = (email) => prefs(email).emails !== false;
  function markRead(email) { const L = inbox(email).map((x) => ({ ...x, read: true })); put(iKey(email), { kind: "inbox", email: lc(email), list: L }); }
  // ---- everything that happened, across workspaces (cached briefly) ----
  let cache = null;
  function index() {
    if (cache && Date.now() - cache.at < 15_000) return cache;
    const events = new Map(), att = new Map(), moments = [], kudos = [], vibes = [];
    const addAtt = (email, rec) => { const k = lc(email); if (!k) return; if (!att.has(k)) att.set(k, []); const L = att.get(k); if (!L.some((x) => x.eventId === rec.eventId)) L.push(rec); else Object.assign(L.find((x) => x.eventId === rec.eventId), rec); };
    for (const ws of allWorkspaceIds()) {
      if (ws === DEFAULT_WS) continue; const S = scopeStore(store, ws), W = getWorkspace(ws);
      for (const d of S.list("events")) { const e = d.data; if (!e || e.example) continue; events.set(d.id, { id: d.id, ws, e, owner: W?.ownerEmail || "" });
        for (const g of e.guests || []) if (g.email && /Going|Attended/.test(g.status || "")) addAtt(g.email, { eventId: d.id, ws, name: g.name, at: Date.parse(e.date || "") || 0, slot: g.slot, plusOne: g.plusOne }); }
      const R = S.list("rsvps").map((d) => ({ id: d.id, ...d.data }));
      const byEv = new Map(); for (const r of R) { if (!byEv.has(r.eventId)) byEv.set(r.eventId, []); byEv.get(r.eventId).push(r); }
      for (const [eid, rs] of byEv) { const ev = events.get(eid)?.e; if (!ev) continue; rs.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); const firstAt = rs.find((r) => r.response === "going")?.createdAt || 0, evAt = Date.parse((ev.date || "") + "T" + (ev.startTime || "12:00")) || 0;
        rs.forEach((r, i) => { if (!r.email || r.response !== "going") return; addAtt(r.email, { eventId: eid, ws, name: r.name, at: Date.parse(ev.date || "") || r.createdAt || 0, early: i < 3 || r.createdAt - firstAt < DAY, last: !!evAt && evAt - (r.createdAt || 0) > 0 && evAt - (r.createdAt || 0) < 2 * DAY, filler: !!r.promotedAt, plusOne: !!r.plusOne, slot: r.slot || "", rsvpAt: r.createdAt }); }); }
      for (const d of S.list("moments")) moments.push({ id: d.id, ws, ...d.data });
      for (const d of S.list("kudos")) kudos.push({ id: d.id, ws, ...withVerified(S, d.id, d.data) }); // verified: worked out on read (see kudosVerified)
      for (const d of S.list("vibes")) vibes.push({ id: d.id, ws, ...d.data });
    }
    cache = { at: Date.now(), events, att, moments, kudos, vibes };
    return cache;
  }
  const bust = () => { cache = null; };
  const isPublic = (e) => !!e?.discoverable;
  const evCard = (x) => { const e = x.e, h = C.profileOf(x.ws); return { id: x.id, title: e.pubTitle || e.name, date: e.date || "", startTime: e.startTime || "", city: e.city || "", hood: e.hood || "", activity: e.activity || "", emoji: e.emoji || "", free: e.free || !e.price, price: e.price || "", public: isPublic(e), host: h?.handle ? { handle: h.handle, name: h.name, emoji: h.emoji, color: h.color } : null }; };
  // ---- the feed ----
  function feed(email) {
    const I = index(), me = lc(email), F = friendsOf(me).map((x) => x.email), people = new Map([me, ...F].map((e) => [e, person(e)]));
    const myEvents = new Set((I.att.get(me) || []).map((a) => a.eventId)); for (const [id, x] of I.events) if (lc(x.owner) === me) myEvents.add(id);
    const canSee = (id) => { const x = I.events.get(id); return x && (isPublic(x.e) || myEvents.has(id)); };
    const items = [], now = Date.now(), recent = now - 45 * DAY;
    for (const f of F) {
      const p = people.get(f);
      for (const a of I.att.get(f) || []) { if (a.at < recent || a.at > now || !canSee(a.eventId)) continue; items.push({ kind: "went", at: a.at, who: p, event: evCard(I.events.get(a.eventId)) }); }
      for (const [id, x] of I.events) if (lc(x.owner) === f && isPublic(x.e) && (x.e.date || "") >= today()) items.push({ kind: "hosting", at: x.e.updatedAt || x.e.createdAt || now, who: p, event: evCard(x) });
    }
    const momentsSeen = I.moments.filter((m) => (F.includes(lc(m.authorEmail)) || lc(m.authorEmail) === me || myEvents.has(m.eventId)) && canSee(m.eventId) && m.at > now - 30 * DAY).sort((a, b) => b.at - a.at);
    for (const m of momentsSeen) if (lc(m.authorEmail) !== me) items.push({ kind: "moment", at: m.at, who: (() => { const p = people.get(lc(m.authorEmail)) || person(m.authorEmail); return p?.name ? p : { ...(p || {}), name: m.authorName || "A guest" }; })(), media: { url: m.url, type: m.type }, caption: m.caption || "", event: evCard(I.events.get(m.eventId)) });
    for (const k of I.kudos) if (F.includes(lc(k.email)) && k.love && canSee(k.eventId) && k.at > recent) items.push({ kind: "kudos", at: k.at, who: people.get(lc(k.email)), love: k.love, tags: k.tags || [], event: evCard(I.events.get(k.eventId)) });
    const followedWs = []; for (const x of new Set([...I.events.values()].map((v) => v.ws))) if (C.followersOf(x).some((f) => f.email === me)) followedWs.push(x);
    for (const w of followedWs) { const hp = C.profileOf(w), hostP = { name: hp?.name || "", handle: hp?.handle, emoji: hp?.emoji || "🎉", color: hp?.color, email: getWorkspace(w)?.ownerEmail || "" };
      for (const x of I.events.values()) { if (x.ws !== w || !isPublic(x.e)) continue; if (F.includes(lc(x.owner))) continue;
        if ((x.e.date || "9") >= today()) items.push({ kind: "hosting", at: x.e.updatedAt || x.e.createdAt || now, who: hostP, event: evCard(x) });
        else if (Date.parse(x.e.date) > recent) { const K = I.kudos.filter((k) => k.eventId === x.id && k.love), n = [...I.att.values()].filter((L) => L.some((a) => a.eventId === x.id)).length; items.push({ kind: "recap", at: Date.parse(x.e.date) + 20 * 3600e3, who: hostP, event: evCard(x), count: n, love: K[0]?.love || "", kudos: K.length }); } } }
    items.sort((a, b) => b.at - a.at);
    // stories: one ring per friend (and you) with photos from the last week
    const ring = new Map(), ringName = new Map(); for (const m of momentsSeen.filter((m) => m.at > now - 7 * DAY)) { const k = lc(m.authorEmail); if (!ring.has(k)) ring.set(k, []); if (m.authorName) ringName.set(k, m.authorName); ring.get(k).push({ url: m.url, type: m.type, caption: m.caption || "", at: m.at, event: evCard(I.events.get(m.eventId)) }); }
    const stories = [...ring].map(([e, L]) => ({ who: (() => { const p = people.get(e) || person(e); return p?.name ? p : { ...(p || {}), name: ringName.get(e) || "A guest" }; })(), items: L.sort((a, b) => a.at - b.at), mine: e === me })).sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || b.items.at(-1).at - a.items.at(-1).at);
    // people you've been to things with, who aren't friends yet
    const coAtt = new Map(); for (const id of myEvents) { for (const [em, L] of I.att) if (em !== me && !F.includes(em) && L.some((a) => a.eventId === id) && userOf(em)) coAtt.set(em, (coAtt.get(em) || 0) + 1); const ow = lc(I.events.get(id)?.owner); if (ow && ow !== me && !F.includes(ow) && userOf(ow)) coAtt.set(ow, (coAtt.get(ow) || 0) + 1); }
    const suggestions = [...coAtt].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([e, n]) => ({ ...person(e), together: n }));
    const upcoming = [...I.events.values()].filter((x) => isPublic(x.e) && (x.e.date || "") >= today()).sort((a, b) => String(a.e.date).localeCompare(String(b.e.date))).slice(0, 20).map((x) => ({ ...evCard(x), friendsGoing: F.filter((f) => (I.att.get(f) || []).some((a) => a.eventId === x.id)).map((f) => first(people.get(f)?.name)).filter(Boolean) }));
    const mine = [...myEvents].map((id) => I.events.get(id)).filter((x) => x && (x.e.date || "") <= today() && (x.e.date || "") >= today(now - 21 * DAY)).sort((a, b) => String(b.e.date).localeCompare(String(a.e.date))).slice(0, 8).map(evCard);
    const pub = (p) => (p ? { name: p.name, handle: p.handle, emoji: p.emoji, color: p.color, key: Buffer.from(lc(p.email)).toString("base64url"), ...(p.together ? { together: p.together } : {}), ...(p.mutual != null ? { mutual: p.mutual } : {}) } : p);
    return { following: followedWs.map((w) => C.profileOf(w)?.handle).filter(Boolean), me: pub(person(me)), mine, friends: F.map((e) => pub({ ...people.get(e), mutual: friendsOf(e).some((x) => x.email === me) })), stories: stories.map((x) => ({ ...x, who: pub(x.who) })), items: items.slice(0, 80).map((x) => ({ ...x, who: pub(x.who) })), suggestions: suggestions.map(pub), upcoming, unread: inbox(me).filter((x) => !x.read).length };
  }
  // ---- event profile: what kind of guest and host someone is ----
  function eventProfile(email) {
    const I = index(), me = lc(email), A = (I.att.get(me) || []).filter((a) => a.at <= Date.now() + DAY), hosted = [...I.events.values()].filter((x) => lc(x.owner) === me && x.e.casual && (x.e.date || "9") <= today());
    const given = I.kudos.filter((k) => lc(k.email) === me), vibes = I.vibes.filter((v) => lc(v.email) === me), vibeN = (t) => vibes.filter((v) => (v.tags || []).includes(t)).length;
    const self = sys("selfprof-" + hash(me))?.answers || {};
    const n = A.length || 0, rate = (x) => (n ? x / n : 0);
    const S = {
      host: hosted.length * 2 + (self.host === "often" ? 2 : self.host === "sometimes" ? 1 : 0),
      spark: vibeN("spark") * 2 + (self.room === "spark" ? 2 : 0),
      chill: vibeN("chill") * 2 + (self.room === "chill" ? 2 : 0),
      filler: A.filter((a) => a.last || a.filler).length * 1.5 + (self.rsvp === "last" ? 2 : 0),
      early: A.filter((a) => a.early).length + (self.rsvp === "first" ? 2 : 0),
      connector: A.filter((a) => a.plusOne).length * 1.5 + (self.bring === "friend" ? 2 : 0),
      contributor: A.filter((a) => a.slot).length * 1.5 + vibeN("contributor") * 2 + (self.bring === "food" ? 2 : 0),
      helper: vibeN("helper") * 2 + (self.room === "helper" ? 2 : 0),
      regular: Math.max(0, n - 2),
      cheerleader: given.length,
    };
    const ranked = Object.entries(S).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]), max = ranked[0]?.[1] || 1;
    const traits = ranked.slice(0, 5).map(([k, v]) => ({ key: k, ...TRAITS[k], strength: Math.round((v / max) * 100), why: why(k) }));
    function why(k) { const obs = { host: hosted.length, spark: vibeN("spark"), chill: vibeN("chill"), filler: A.filter((a) => a.last || a.filler).length, early: A.filter((a) => a.early).length, connector: A.filter((a) => a.plusOne).length, contributor: A.filter((a) => a.slot).length + vibeN("contributor"), helper: vibeN("helper") }[k]; if (obs === 0) return "How they describe themselves. It firms up as they go to things."; return { host: `Hosted ${hosted.length} event${hosted.length === 1 ? "" : "s"}`, spark: `${vibeN("spark")} host${vibeN("spark") === 1 ? "" : "s"} said they brought energy`, chill: `${vibeN("chill")} host${vibeN("chill") === 1 ? "" : "s"} called them easy company`, filler: `Said yes in the last 48 hours ${A.filter((a) => a.last || a.filler).length} time${A.filter((a) => a.last || a.filler).length === 1 ? "" : "s"}`, early: `Among the first yeses ${A.filter((a) => a.early).length} time${A.filter((a) => a.early).length === 1 ? "" : "s"}`, connector: `Brought a friend ${A.filter((a) => a.plusOne).length} time${A.filter((a) => a.plusOne).length === 1 ? "" : "s"}`, contributor: `Brought something ${A.filter((a) => a.slot).length + vibeN("contributor")} time${A.filter((a) => a.slot).length + vibeN("contributor") === 1 ? "" : "s"}`, helper: `${vibeN("helper")} host${vibeN("helper") === 1 ? "" : "s"} said they helped out`, regular: `Went to ${n} events`, cheerleader: `Sent kudos ${given.length} time${given.length === 1 ? "" : "s"}` }[k] ; }
    const kinds = {}; for (const a of A) for (const l of lanesOf(`${I.events.get(a.eventId)?.e.activity || ""} ${I.events.get(a.eventId)?.e.name || ""}`)) kinds[l] = (kinds[l] || 0) + 1;
    return { attended: n, hosted: hosted.length, kudosGiven: given.length, traits, top: traits[0] || null, loves: Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => ({ kind: k, n: v })), self, built: !!Object.keys(self).length };
  }
  // ---- a host's strengths: what they host, what people say, the vibe ----
  function hostStrengths(ws, { year } = {}) {
    const inYear = (d) => !year || String(d || "").startsWith(String(year));
    const I = index(), ev = [...I.events.values()].filter((x) => x.ws === ws && x.e.date && x.e.date <= today() && x.e.stage !== "interest" && inYear(x.e.date)), K = I.kudos.filter((k) => k.ws === ws && (!year || new Date(k.at || 0).getFullYear() === +year)).sort((a, b) => b.at - a.at);
    const kinds = {}; for (const x of ev) for (const l of lanesOf(`${x.e.activity || ""} ${x.e.name || ""}`)) kinds[l] = (kinds[l] || 0) + 1;
    const tags = {}; for (const k of K) for (const t of k.tags || []) tags[t] = (tags[t] || 0) + 1;
    const pastIds = new Set(ev.map((x) => x.id)), guests = new Set(); for (const [em, L] of I.att) if (L.some((a) => a.ws === ws && pastIds.has(a.eventId))) guests.add(em);
    const returning = [...guests].filter((em) => (I.att.get(em) || []).filter((a) => a.ws === ws && pastIds.has(a.eventId)).length > 1).length;
    const tagList = Object.entries(tags).sort((a, b) => b[1] - a[1]).map(([t, n]) => { const T = KUDOS_TAGS.find((x) => x[0] === t); return { tag: t, emoji: T?.[1] || "✨", label: T?.[2] || t, n }; });
    const vibe = tagList.slice(0, 3).map((t) => t.label.toLowerCase());
    const tippers = K.filter((k) => k.tipped).length, hostedN = ev.filter((x) => x.e.casual && x.e.date && x.e.date <= today()).length;
    return { dates: ev.map((x) => x.e.date).sort(), tippers, events: hostedN, kinds: Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([kind, n]) => ({ kind, n })), tags: tagList, vibe, guests: guests.size, returning, kudosCount: K.length,
      // "would go again": of the guests who left feedback (tags, words or a comparison), how many said so; one definition for every page
      againYes: K.filter((k) => (k.tags || []).includes("again") || k.compare === "better").length, againOf: K.filter((k) => (k.tags || []).length || k.love || k.compare).length,
      kudos: K.filter((k) => k.love || (k.tags || []).length).slice(0, 30).map((k) => ({ name: first(k.name) || "A guest", love: String(k.love || "").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "…").replace(/\(?(?:\+?\d[\s().-]*){7,}\d/g, "…"), tags: k.tags || [], at: k.at, verified: k.verified || null, verifiedLabel: VERIFIED_LABEL[k.verified] || "", event: I.events.get(k.eventId)?.e?.pubTitle || I.events.get(k.eventId)?.e?.name || "" })),
      moments: I.moments.filter((m) => m.ws === ws && isPublic(I.events.get(m.eventId)?.e)).sort((a, b) => b.at - a.at).slice(0, 12).map((m) => ({ url: m.url, type: m.type, caption: m.caption || "" })) };
  }
  // ---- turnout a host can show a sponsor or venue: totals only, never names ----
  function turnoutOf(ws) {
    const S = scopeStore(store, ws), R = S.list("rsvps").map((d) => d.data || {}), past = S.list("events").map((d) => ({ id: d.id.split("/").pop(), e: d.data || {} })).filter((x) => x.e.casual && !x.e.example && x.e.date && x.e.date <= today() && x.e.stage !== "interest");
    let said = 0, came = 0, walkIns = 0, doorEvents = 0, saidAtDoor = 0, showedAtDoor = 0; const seen = new Map();
    for (const { id, e } of past) { const rs = R.filter((r) => r.eventId === id), walk = (x) => x.walkIn || x.source === "Walk-in", going = rs.filter((r) => r.response === "going"), G = (e.guests || []).filter((g) => /Going|Attended/.test(g.status || ""));
      // the same person can be both an RSVP and a row on the guest list (RSVPs are copied there): count them once
      // the same definition the host sees: a host's tap wins, then the door list, and only events where either was used count toward show rate
      const door = going.some((r) => r.checkedInAt) || G.some((g) => /Attended/.test(g.status || "") && !walk(g)), tapped = going.some((r) => r.noShow === true || r.noShow === false);
      const isIn = (x) => (x.noShow === true ? false : x.noShow === false ? true : door ? !!x.checkedInAt || /Attended/.test(x.status || "") : true), people = new Map();
      for (const x of [...going, ...G]) { const key = String(x.email || x.phone || x.name || "").trim().toLowerCase() || Math.random().toString(36); const cur = people.get(key) || { in: false, rsvp: false, walk: false }; const v = isIn(x); people.set(key, { in: x.response ? (cur.rsvp ? cur.in || v : v) : cur.rsvp ? cur.in : cur.in || v, rsvp: cur.rsvp || !!x.response, walk: cur.walk || walk(x) }); }
      const P = [...people.values()], yes = P.filter((x) => !x.walk), w = P.filter((x) => x.walk).length;
      said += yes.length; const showed = yes.filter((x) => x.in).length;
      if ((door || tapped) && (showed || w)) { doorEvents++; came += showed + w; saidAtDoor += yes.length; showedAtDoor += showed; walkIns += w; }
      for (const k of new Set([...going.map((r) => r.email || r.phone || r.name), ...G.map((g) => g.email || g.phone || g.name)].map((who) => String(who || "").trim().toLowerCase()).filter(Boolean))) seen.set(k, (seen.get(k) || 0) + 1); }
    let people = seen.size, returning = [...seen.values()].filter((n) => n > 1).length;
    try { const H = hostStrengths(ws); if (H && H.guests) { people = H.guests; returning = H.returning || 0; } } catch {}
    return { events: past.length, saidYes: said, people, returning, returnRate: people ? Math.round((100 * returning) / people) : null, doorEvents, checkedIn: showedAtDoor, came, walkIns, showRate: saidAtDoor ? Math.round((100 * showedAtDoor) / saidAtDoor) : null, avgPerEvent: past.length ? Math.round(said / past.length) : 0 };
  }
  // ---- guests prove who they are with the RSVP id and code they got back ----
  function rsvpProof(eventId, rid, code) {
    const ws = workspaceOfEvent(String(eventId || "")); if (!ws || !rid) return null;
    const S = scopeStore(store, ws), r = S.get("rsvps/" + String(rid).replace(/[^A-Za-z0-9_-]/g, ""))?.data;
    if (!r || r.eventId !== eventId || String(r.code || "") !== String(code || "")) return null;
    return { ws, S, r, rid: String(rid), ev: S.get("events/" + eventId)?.data };
  }
  // ---- alerts ----
  const aKey = (email) => "alerts-" + hash(email);
  const alertsOf = (email) => sys(aKey(email))?.list || [];
  function saveAlerts(email, L) { put(aKey(email), { kind: "alerts", email: lc(email), list: L }); }
  function allAlerts() { return store.list("system").map((d) => d.data).filter((x) => x?.kind === "alerts").flatMap((x) => (x.list || []).map((a) => ({ ...a, email: x.email }))); }
  async function onEventChange(ws, id, origin = "") {
    const S = scopeStore(store, ws), e = S.get("events/" + id)?.data; bust(); if (!e || e.example || !e.discoverable || (e.date || "") < today()) return 0;
    const W = getWorkspace(ws); let n = 0;
    for (const a of allAlerts()) { if (lc(a.email) === lc(W?.ownerEmail)) continue; if (!alertMatches(a, e, e.geo)) continue;
      const host = C.profileOf(ws), title = e.pubTitle || e.name;
      if (notify(a.email, { kind: "alert", key: `alert-${a.id}-${id}`, text: `New: ${title}${host?.name ? ` by ${host.name}` : ""}${e.date ? `, ${niceDate(e.date)}` : ""}. You asked for "${a.summary}".`, link: `/g#rsvp-${id}`, eventId: id })) { n++;
        const cfg = canEmail(a.email) && emailConfig(DEFAULT_WS, true); if (cfg) sendEmail(cfg, { to: a.email, subject: `Something you'd like: ${title}`, text: `${title}${e.date ? ` on ${niceDate(e.date)}` : ""}${e.city ? ` in ${e.city}` : ""}.\n\nAre you in? ${origin}/g#rsvp-${id}\n\nYou asked Pottery Lab: "${a.text}". Change your alerts at ${origin}/feed` }).catch(() => {}); } }
    return n;
  }
  // ---- the hourly job: kudos nudges, prep alerts, pickup texts ----
  async function runJobs(now = Date.now(), origin = process.env.ENCORE_PUBLIC_URL || "") {
    const out = { kudosAsks: 0, prepAlerts: 0, texts: 0 }, I = index(), sms = smsConfig();
    for (const x of I.events.values()) if (x.e.stage === "interest" && x.e.autoGo) { try { if (await X.autoGo?.(x.ws, x.id, origin)) out.autoGo = (out.autoGo || 0) + 1; } catch {} }
    for (const x of I.events.values()) {
      const e = x.e; if (!e.casual || !e.date) continue; const S = scopeStore(store, x.ws), done = (k) => !!S.get("jobs/" + k), mark = (k) => S.set("jobs/" + k, { at: now });
      const endAt = Date.parse(`${e.date}T${/^\d{2}:\d{2}$/.test(e.endTime || "") ? e.endTime : /^\d{2}:\d{2}$/.test(e.startTime || "") ? String(Math.min(23, +e.startTime.slice(0, 2) + 3)).padStart(2, "0") + e.startTime.slice(2) : "21:00"}:00`), hoursAfter = (now - endAt) / 3600e3;
      const daysSince = Math.floor((now - Date.parse(e.date + "T12:00:00")) / DAY), title = e.pubTitle || e.name, host = C.profileOf(x.ws), hostName = first(host?.name || person(x.owner).name) || "your host";
      // the day after: ask guests for kudos
      if (((hoursAfter >= 1.5) || daysSince >= 1) && daysSince <= 3 && !done("kudos-" + x.id)) {
        mark("kudos-" + x.id);
        for (const [em, L] of I.att) { if (!L.some((a) => a.eventId === x.id)) continue; out.kudosAsks++;
          notify(em, { kind: "kudos", key: "kudos-" + x.id, text: `How was ${title}? Send ${hostName} some kudos.`, link: `/g#rsvp-${x.id}`, eventId: x.id });
          // the text or email asking for kudos is sent once per guest by the kudos ask job (server/kudosask.js), with a one-tap link
        }
        notify(x.owner, { kind: "after", key: "after-" + x.id, text: `${title} is done. Say thanks while it's fresh.`, link: `/?app=1&open=${encodeURIComponent(x.id)}&step=7#studio`, eventId: x.id });
      }
      // prep alerts for the host (the shopping and baking checklist)
      for (const t of e.prep || []) { if (t.done || !t.due) continue; const dd = Math.round((Date.parse(t.due + "T09:00:00") - now) / DAY); if (dd > 0 || dd < -2) continue; const k = "prep-" + x.id + "-" + hash(t.text + t.due); if (done(k)) continue; mark(k); out.prepAlerts++;
        notify(x.owner, { kind: "prep", text: `${dd < 0 ? "Overdue" : "Due today"}: ${t.text} (${title})`, link: `/?app=1&open=${encodeURIComponent(x.id)}#studio`, eventId: x.id });
        const cfg = emailConfig(x.ws, false) || emailConfig(DEFAULT_WS, true); if (cfg) sendEmail(cfg, { to: x.owner, subject: `${dd < 0 ? "Overdue" : "Due today"}: ${t.text}`, text: `For ${title}${e.date ? ` on ${niceDate(e.date)}` : ""}:\n\n☐ ${t.text}\n\nTick it off in Pottery Lab: ${origin}/?app=1&open=${encodeURIComponent(x.id)}#studio` }).catch(() => {}); }
      // the day before: remind everyone who said yes, by email and text, once (hosts can switch it off per event)
      { const startAt = Date.parse(`${e.date}T${/^\d{2}:\d{2}$/.test(e.startTime || "") ? e.startTime : "18:00"}:00`), hrs = (startAt - now) / 3600e3, hr = (() => { try { return e.tz ? +new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: e.tz }).format(now) : 12; } catch { return 12; } })();
        if (e.autoRemind !== false && (e.published || e.discoverable) && hrs >= 20 && hrs <= 27 && hr >= 9 && hr < 21 && !done("remind-" + x.id)) { mark("remind-" + x.id);
          const cfg = emailConfig(x.ws, false) || emailConfig(DEFAULT_WS, true), when = `${new Date(e.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}${e.startTime ? " at " + new Date("2000-01-01T" + e.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : ""}`, where = e.meetPoint || e.venueName || "", link = `${origin}/g#rsvp-${x.id}`;
          let sent = 0; const seen = new Set();
          for (const d of S.list("rsvps")) { const r = d.data || {}; if (r.eventId !== x.id || r.response !== "going") continue; const who = lc(r.email || r.phone || d.id); if (seen.has(who)) continue; seen.add(who); let got = false;
            if (cfg && r.email && canEmail(r.email)) { sendEmail(cfg, { to: r.email, subject: `Tomorrow: ${title}`, text: `Hi ${first(r.name) || "there"},\n\nSee you ${when}${where ? ` at ${where}` : ""} for ${title}.${(e.bring || []).length ? `\nBring: ${e.bring.join(", ")}.` : ""}\n\nPlans changed? Tap Can't go so ${hostName} knows: ${link}` }).catch(() => {}); got = true; }
            if (sms && PHONE_OK(r.phone) && r.smsOk !== false) { const ok = await sendSms(sms, { to: r.phone, text: `Hi ${first(r.name) || "there"}. Tomorrow: ${title}, ${when}${where ? ` at ${where}` : ""}. Can't go? ${link} Reply STOP to opt out.` }); if (ok.ok) { out.texts++; got = true; } }
            if (got) sent++; }
          out.reminders = (out.reminders || 0) + sent; if (sent) notify(x.owner, { kind: "reminded", key: "remind-" + x.id, text: `Reminded ${sent} ${sent === 1 ? "guest" : "guests"} about ${title}.`, link: `/?app=1&open=${encodeURIComponent(x.id)}#studio`, eventId: x.id }); } }
      // giveaways: text each pickup window an hour before
      if (sms && /giveaway/.test(e.activity || "") && e.date === today(now)) for (const d of S.list("rsvps")) { const r = d.data; if (r.eventId !== x.id || r.response !== "going" || !PHONE_OK(r.phone) || !r.slot) continue;
        const start = Date.parse(`${e.date}T${String(r.slot).match(/\d{1,2}:\d{2}/)?.[0]?.padStart(5, "0") || "00:00"}:00`), k = "sms-" + d.id; if (!(start - now <= 3600e3 && start - now > 0) || done(k)) continue; mark(k);
        const ok = await sendSms(sms, { to: r.phone, text: `Hi ${first(r.name)}. Your ${title} pickup is ${r.slot} at ${e.meetPoint || "the usual spot"}. Running late or can't go? ${origin}/g#rsvp-${x.id}` }); if (ok.ok) out.texts++; }
    }
    return out;
  }
  // a year in get-togethers, for guests and hosts
  function recap(email, year = new Date().getFullYear()) {
    const I = index(), me = lc(email), inYear = (t) => new Date(t).getFullYear() === year, A = (I.att.get(me) || []).filter((a) => a.at && inYear(a.at) && a.at <= Date.now() + DAY);
    const hosts = {}; for (const a of A) { const h = C.profileOf(a.ws)?.name || "a friend"; hosts[h] = (hosts[h] || 0) + 1; }
    const kinds = {}; for (const a of A) for (const l of lanesOf(`${I.events.get(a.eventId)?.e.activity || ""} ${I.events.get(a.eventId)?.e.name || ""}`)) kinds[l] = (kinds[l] || 0) + 1;
    const hosted = [...I.events.values()].filter((x) => lc(x.owner) === me && x.e.casual && x.e.date && inYear(Date.parse(x.e.date)) && x.e.date <= today()), myWs = userOf(me)?.ws;
    const guests = new Set(); for (const [em, L] of I.att) if (L.some((a) => a.ws === myWs && hosted.some((h) => h.id === a.eventId))) guests.add(em);
    const K = I.kudos.filter((k) => k.ws === myWs && inYear(k.at));
    const topHost = Object.entries(hosts).sort((a, b) => b[1] - a[1])[0];
    return { year, went: A.length, hosts: Object.keys(hosts).length, topHost: topHost ? { name: topHost[0], n: topHost[1] } : null, topKind: Object.entries(kinds).sort((a, b) => b[1] - a[1])[0]?.[0] || "", hosted: hosted.length, guests: guests.size, kudos: K.length, tips: K.filter((k) => k.tipped).length, kudosGiven: I.kudos.filter((k) => lc(k.email) === me && inYear(k.at)).length };
  }
  // ---- the second-host loop: a guest who sent kudos follows or says I'm in to a different host within 30 days ----
  // One row per (giver, other host, follow or rsvp), kept in the scope of the host who got the kudos, with hashes only:
  // never the guest's email or the other host's workspace. GET /api/admin/loop-stats counts them for that host.
  function loopTouch(email, toWs, kind, now = Date.now()) {
    const em = lc(email); if (!em || !toWs || !["follow", "rsvp"].includes(kind)) return 0; let n = 0;
    const from = new Map(); for (const k of index().kudos) if (lc(k.email) === em && k.ws !== toWs && k.at && now - k.at >= 0 && now - k.at <= 30 * DAY && (!from.has(k.ws) || from.get(k.ws).at < k.at)) from.set(k.ws, k);
    for (const [ws, k] of from) { const S = scopeStore(store, ws), id = `${hash(em)}-${hash("ws:" + toWs)}-${kind}`; if (S.get("kudosloop/" + id)) continue;
      S.set("kudosloop/" + id, { giver: hash(em), to: hash("ws:" + toWs), kind, kudosAt: k.at, at: now, days: Math.floor((now - k.at) / DAY) }); n++; }
    return n;
  }
  return { loopTouch, recap, prefs, canEmail, person, ensureProfile, friendsOf, addFriend, dropFriend, notify, inbox, markRead, feed, eventProfile, hostStrengths, turnoutOf, rsvpProof, alertsOf, saveAlerts, onEventChange, runJobs, bust, index, saveBlob, userOf };
}

export function mountSocial(app, { store, small, currentUser, publicOrigin, C, X, raw }) {
  const hits = new Map(); const limited = (req, n = 30) => { const k = (req.ip || "?") + req.path.split("/").slice(0, 4).join("/"), now = Date.now(); let h = hits.get(k); if (!h || now - h.start > 3600_000) { h = { n: 0, start: now }; hits.set(k, h); } return ++h.n > n; };
  const me = (req, res) => { const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) { res.status(401).json({ code: "unauthenticated", message: "Sign in first." }); return null; } return u; };
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  // feed, friends, people
  // your own posts (text, a photo, a link) show up for you and your friends
  const postsKey = (em) => "posts-" + hash(lc(em)), postsOf = (em) => store.get("system/" + postsKey(em))?.data?.list || [];
  const cleanLink = (u) => { const x = String(u || "").trim().slice(0, 500); return /^https:\/\/[^\s<>"]+$/i.test(x) ? x : ""; };
  app.get("/api/me/feed", (req, res) => { const u = me(req, res); if (!u) return; X.ensureProfile(u); const F = X.feed(u.email), em = lc(u.email);
    const authors = [em, ...X.friendsOf(em).map((f) => lc(f.email))], pub = (p) => ({ name: p.name, handle: p.handle, emoji: p.emoji, color: p.color });
    const cheerNames = (L) => (L || []).map((c) => (X.person(c).name || "").split(/\s+/)[0]).filter(Boolean);
    const posts = authors.flatMap((a) => postsOf(a).map((p) => ({ kind: "post", at: p.at, id: p.id, author: Buffer.from(a).toString("base64url"), who: pub(X.person(a)), mine: a === em, text: p.text || "", link: p.link || "", cheers: cheerNames(p.cheers), cheered: (p.cheers || []).includes(em), ...(p.photo ? { media: { type: "image", url: p.photo } } : {}) })));
    // leaderboards (server/leaderboard.js): one "This week in <city>" card, moments from hosts you follow, your own standing
    let lb = []; try { lb = app.locals.leaderboardFeed?.(u, F) || []; } catch {}
    F.items = [...posts, ...lb, ...(F.items || [])].sort((a, b) => (b.at || 0) - (a.at || 0)); res.json(F); });
  app.post("/api/me/posts", small, (req, res) => { const u = me(req, res); if (!u) return; if (limited(req, 30)) return bad(res, "Slow down.", 429, "rate_limited"); const b = req.body || {};
    const text = clean(b.text, 1000), link = cleanLink(b.link), photo = /^\/(_blob|assets)\/[A-Za-z0-9._-]+$/.test(String(b.photo || "")) ? String(b.photo) : "";
    if (b.link && !link) return bad(res, "Links must start with https://"); if (!text && !link && !photo) return bad(res, "Write something, or add a photo or link.");
    const em = lc(u.email), L = postsOf(em); const p = { id: crypto.randomBytes(8).toString("hex"), text, link, photo, at: Date.now() }; L.unshift(p);
    store.set("system/" + postsKey(em), { kind: "posts", list: L.slice(0, 200) }); res.json({ ok: true, post: p }); });
  // cheer a friend's post (or undo): names, not a like count
  app.post("/api/me/posts/:author/:id/cheer", small, (req, res) => { const u = me(req, res); if (!u) return; let a = ""; try { a = Buffer.from(String(req.params.author), "base64url").toString().toLowerCase(); } catch {} const em = lc(u.email);
    if (a !== em && !X.friendsOf(em).some((f) => lc(f.email) === a)) return bad(res, "You can cheer friends' posts.", 403, "not_granted");
    const L = postsOf(a), p = L.find((x) => x.id === req.params.id); if (!p) return bad(res, "No such post.", 404, "not_found"); const C2 = new Set(p.cheers || []); if (C2.has(em)) C2.delete(em); else C2.add(em); p.cheers = [...C2];
    store.set("system/" + postsKey(a), { kind: "posts", list: L }); res.json({ ok: true, cheered: C2.has(em), count: C2.size }); });
  app.delete("/api/me/posts/:id", (req, res) => { const u = me(req, res); if (!u) return; const em = lc(u.email); store.set("system/" + postsKey(em), { kind: "posts", list: postsOf(em).filter((p) => p.id !== req.params.id) }); res.json({ ok: true }); });
  app.post("/api/me/posts/photo", raw, async (req, res) => { const u = me(req, res); if (!u) return; if (limited(req, 30)) return bad(res, "Slow down.", 429, "rate_limited"); const ct = String(req.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!/^image\/(jpeg|png|webp|gif)$/.test(ct)) return bad(res, "Photos only (JPEG, PNG, WebP, GIF).", 415, "unsupported_type"); const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0); if (!body.length) return bad(res, "Empty upload.");
    const meta = await X.saveBlob(body, ct, u.ws); res.json({ url: meta.url }); });
  // the right-hand column: hosts to follow, people you may know, your past group chats
  app.get("/api/me/sidebar", (req, res) => { const u = me(req, res); if (!u) return; const em = lc(u.email), I = X.index(), F = new Set(X.friendsOf(em).map((f) => lc(f.email)));
    const followed = new Set(); try { for (const ws of allWorkspaceIds()) if ((C.followersOf?.(ws) || []).some((f) => lc(f.email) === em)) followed.add(ws); } catch {}
    let hosts = []; try { hosts = (C.discover?.().hosts || []).filter((h) => h.handle && !followed.has(C.wsOfHandle?.(h.handle)) && h.handle !== C.profileOf(u.ws)?.handle).slice(0, 4).map((h) => ({ handle: h.handle, name: h.name, emoji: h.emoji, color: h.theme?.accent || h.color, city: [h.hood, h.city].filter(Boolean).join(", "), followers: h.followers || 0, upcoming: h.upcoming || 0 })); } catch {}
    // a host's own guests count too, not only events they went to
    const ownEv = [...I.events.values()].filter((x) => x.ws === u.ws || lc(x.owner) === em).sort((a, b) => String(b.e.date || "").localeCompare(String(a.e.date || "")));
    const mineEv = new Set([...(I.att.get(em) || []).map((a) => a.eventId), ...ownEv.map((x) => x.id)]), co = new Map();
    for (const [other, L] of I.att) { if (other === em || F.has(other)) continue; const n = L.filter((a) => mineEv.has(a.eventId)).length; if (n) co.set(other, (co.get(other) || 0) + n); }
    for (const f of F) for (const ff of X.friendsOf(f)) { const o = lc(ff.email); if (o !== em && !F.has(o) && !co.has(o)) co.set(o, 0.5); }
    const people = [...co.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([o, n]) => { const p = X.person(o); return { key: Buffer.from(o).toString("base64url"), name: p.name || "Someone", emoji: p.emoji, color: p.color, why: n >= 1 ? `${Math.floor(n)} event${Math.floor(n) === 1 ? "" : "s"} together` : "Friend of a friend" }; }).filter((p) => p.name !== "Someone");
    const chats = []; for (const a of [...(I.att.get(em) || []).slice().sort((x, y) => (y.at || 0) - (x.at || 0)), ...ownEv.map((x) => ({ eventId: x.id }))]) { if (chats.length >= 6 || chats.some((c) => c.id === a.eventId)) continue; const x = I.events.get(a.eventId); if (!x) continue;
      let last = null; try { last = scopeStore(store, x.ws).list("chat").map((d) => d.data).filter((m) => m.eventId === a.eventId && !m.private && m.text).sort((p, q) => (q.at || 0) - (p.at || 0))[0]; } catch {}
      chats.push({ id: a.eventId, title: x.e.pubTitle || x.e.name || "Event", date: x.e.date || "", last: last ? `${String(last.name || "").split(" ")[0] || "Someone"}: ${clean(last.text, 80)}` : "", at: last?.at || 0 }); }
    res.json({ hosts, people, chats, hosted: ownEv.some((x) => x.e.date && x.e.date < today() && !x.e.example) }); });
  app.get("/api/people", (req, res) => { const u = me(req, res); if (!u) return; const q = lc(req.query.q).replace(/^@/, ""); if (q.length < 2) return res.json({ people: [] });
    const out = []; for (const d of store.list("system")) { const w = d.data; if (w?.kind !== "workspace") continue; const h = C.profileOf(w.id); const p = X.person(w.ownerEmail); if (lc(w.ownerEmail) === lc(u.email)) continue; if ((h?.handle || "").includes(q) || lc(p.name).includes(q) || lc(w.ownerEmail) === q) out.push({ name: p.name, handle: h?.handle || null, emoji: h?.emoji || "🙂", color: h?.color, city: h?.city || "", email: lc(w.ownerEmail) === q ? lc(w.ownerEmail) : undefined, key: Buffer.from(lc(w.ownerEmail)).toString("base64url") }); if (out.length >= 12) break; }
    res.json({ people: out }); });
  const emailFromKey = (k) => { try { return Buffer.from(String(k || ""), "base64url").toString(); } catch { return ""; } };
  app.post("/api/me/friends", small, (req, res) => { const u = me(req, res); if (!u) return; const b = req.body || {}; let email = b.key ? emailFromKey(b.key) : ""; if (!email && b.eventId && b.pkey) { try { const ws2 = workspaceOfEvent(clean(b.eventId, 80)); const R = ws2 ? scopeStore(store, ws2).list("rsvps").map((d) => d.data || {}).filter((r) => r.eventId === b.eventId) : []; const mine = R.some((r) => lc(r.email) === lc(u.email) && r.response === "going"); const hit = R.find((r) => r.email && hash(lc(r.email)) === String(b.pkey)); if (mine && hit) email = lc(hit.email); } catch {} } if (!email && b.handle) { const ws = C.wsOfHandle(String(b.handle).replace(/^@/, "")); email = ws ? getWorkspace(ws)?.ownerEmail : ""; }
    if (!email || !X.userOf(email)) return bad(res, "No member by that name.", 404, "not_found"); if (lc(email) === lc(u.email)) return bad(res, "That's you!"); X.addFriend(u.email, email); res.json({ ok: true, friend: X.person(email) }); });
  app.delete("/api/me/friends/:key", (req, res) => { const u = me(req, res); if (!u) return; X.dropFriend(u.email, emailFromKey(req.params.key)); res.json({ ok: true }); });
  // inbox
  app.get("/api/me/inbox", (req, res) => { const u = me(req, res); if (!u) return; res.json({ items: X.inbox(u.email).slice(0, 60) }); });
  app.post("/api/me/inbox/read", small, (req, res) => { const u = me(req, res); if (!u) return; X.markRead(u.email); res.json({ ok: true }); });
  // alerts in plain words
  app.get("/api/me/alerts", (req, res) => { const u = me(req, res); if (!u) return; res.json({ alerts: X.alertsOf(u.email) }); });
  app.post("/api/me/alerts", small, (req, res) => { const u = me(req, res); if (!u) return; const b = req.body || {}, text = clean(b.text, 300); if (text.length < 4) return bad(res, "Tell Potto what you'd like to hear about.");
    const rule = parseAlert(text), geo = Number.isFinite(+b.lat) && Number.isFinite(+b.lng) && b.lat !== null && b.lng !== null && b.lat !== "" ? { lat: Math.round(+b.lat * 100) / 100, lng: Math.round(+b.lng * 100) / 100 } : {};
    if (rule.radiusMi && geo.lat == null && !rule.city && !clean(b.city, 60)) return bad(res, "Potto needs your location for a distance. Allow location, or say a city (\"in Austin\").", 400, "need_location");
    const L = X.alertsOf(u.email); if (L.length >= 20) return bad(res, "You have 20 alerts. Delete one first.");
    const a = { id: crypto.randomBytes(6).toString("hex"), text, ...rule, ...geo, homeCity: clean(b.city, 60), at: Date.now() }; X.saveAlerts(u.email, [a, ...L]);
    // tell them right away about anything already coming up
    const I = X.index(), matches = [...I.events.values()].filter((x) => (x.e.date || "") >= today() && alertMatches(a, x.e, x.e.geo)).slice(0, 5).map((x) => ({ id: x.id, title: x.e.pubTitle || x.e.name, date: x.e.date }));
    res.json({ ok: true, alert: a, matches }); });
  app.delete("/api/me/alerts/:id", (req, res) => { const u = me(req, res); if (!u) return; X.saveAlerts(u.email, X.alertsOf(u.email).filter((a) => a.id !== req.params.id)); res.json({ ok: true }); });
  // event profile
  app.get("/api/me/recap", (req, res) => { const u = me(req, res); if (!u) return; res.json(X.recap(u.email)); });
  app.get("/api/me/prefs", (req, res) => { const u = me(req, res); if (!u) return; res.json(X.prefs(u.email)); });
  app.post("/api/me/prefs", small, (req, res) => { const u = me(req, res); if (!u) return; const p = { kind: "prefs", emails: req.body?.emails !== false, at: Date.now() }; store.set("system/prefs-" + hash(u.email), p); res.json(p); });
  // "Priya and 2 friends are going" for a signed-in member looking at an invite
  app.get("/api/me/mutuals/:eventId", (req, res) => { const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) return res.json({ friends: [] }); const id = clean(req.params.eventId, 80), I = X.index(), F = X.friendsOf(u.email).map((f) => f.email);
    const ws = workspaceOfEvent(id), following = !!ws && C.followersOf(ws).some((x) => x.email === String(u.email).toLowerCase());
    res.json({ following, friends: F.filter((f) => (I.att.get(f) || []).some((a) => a.eventId === id)).map((f) => ({ name: first(X.person(f).name), emoji: X.person(f).emoji })) }); });
  app.get("/api/me/profile", (req, res) => { const u = me(req, res); if (!u) return; X.ensureProfile(u); res.json({ person: X.person(u.email), profile: X.eventProfile(u.email) }); });
  app.post("/api/me/profile/self", small, (req, res) => { const u = me(req, res); if (!u) return; const b = req.body || {}, A = {};
    for (const [k, ok] of [["host", ["often", "sometimes", "rarely"]], ["rsvp", ["first", "planner", "last"]], ["room", ["spark", "chill", "helper"]], ["bring", ["food", "friend", "self"]]]) if (ok.includes(b[k])) A[k] = b[k];
    store.set("system/selfprof-" + hash(u.email), { kind: "selfprof", answers: A, at: Date.now() }); X.bust(); res.json({ ok: true, profile: X.eventProfile(u.email) }); });
  // a person's or host's public profile extras
  app.get("/api/public/profile/:handle", (req, res) => { const ws = C.wsOfHandle(req.params.handle); const W = ws && getWorkspace(ws); if (!W) return bad(res, "No one by that name.", 404, "not_found");
    const P = X.eventProfile(W.ownerEmail); res.json({ strengths: X.hostStrengths(ws), profile: { attended: P.attended, hosted: P.hosted, traits: P.traits, loves: P.loves } }); });
  // kudos from guests (proved by their RSVP), vibes from hosts
  app.post("/api/public/kudos", small, (req, res) => { if (limited(req, 20)) return bad(res, "Slow down.", 429, "rate_limited"); const b = req.body || {}, P = (X.kudosProof || X.rsvpProof)(clean(b.eventId, 80), b.rid, b.code); // kudos nudges: the group link's kudos-only code works here too
    if (!P) return bad(res, "Kudos come from guests who replied. Open the link from your invite on the phone you used.", 403, "not_granted");
    if ((P.ev?.date || "9") > today()) return bad(res, "Kudos open once it's happened.");
    const tags = (Array.isArray(b.tags) ? b.tags : []).filter((t) => KUDOS_TAGS.some((k) => k[0] === t)).slice(0, 8), love = clean(b.love, 500), improve = clean(b.improve, 500); if (!tags.length && !love && !improve && !["better", "same", "less"].includes(b.compare)) return bad(res, "Tap one of the chips or write a line first.");
    if (!tags.length && !love) return bad(res, "Pick at least one thing you liked.");
    P.S.set("kudos/" + P.rid, { eventId: P.r.eventId, rid: P.rid, name: P.r.name || "", email: lc(P.r.email), tags, love, improve, verified: kudosVerified(P.S, { eventId: P.r.eventId, rid: P.rid }), via: b.via === "ask" ? "ask" : "page", ...(["better", "same", "less"].includes(b.compare) ? { compare: b.compare } : {}), ...(P.S.get("kudos/" + P.rid)?.data?.tipped ? { tipped: true, tip: P.S.get("kudos/" + P.rid).data.tip } : {}), at: Date.now() }); X.bust();
    const W = getWorkspace(P.ws); X.notify(W?.ownerEmail, { kind: "kudos-in", text: `💌 ${first(P.r.name) || "A guest"} sent kudos for ${P.ev?.pubTitle || P.ev?.name}${love ? `: "${love.slice(0, 80)}"` : ""}`, link: `/?app=1&open=${encodeURIComponent(P.r.eventId)}#studio`, eventId: P.r.eventId });
    const h = C.profileOf(P.ws); res.json({ ok: true, host: h?.handle ? { handle: h.handle, name: h.name } : null }); });
  app.get("/api/host/kudos/:eventId", (req, res) => { const u = me(req, res); if (!u) return; const S = scopeStore(store, u.ws), id = clean(req.params.eventId, 80); const kudos = S.list("kudos").filter((d) => d.data?.eventId === id).map((d) => withVerified(S, d.id, d.data)).sort((a, b) => b.at - a.at);
    // "Kudos asked of N guests · M sent": N from the ask job's log, M every kudos with words or chips for this event
    const asked = S.list("kudosasks").filter((d) => d.data?.eventId === id && !d.data.kind && ["sms", "email"].includes(d.data.channel)).length; // the same count as askStats in server/kudosask.js (first asks only; nudges have a kind)
    res.json({ kudos, ask: { asked, sent: kudos.filter((k) => k.love || (k.tags || []).length).length }, vibes: S.list("vibes").map((d) => d.data).filter((v) => v.eventId === id) }); });
  app.post("/api/host/vibes", small, (req, res) => { const u = me(req, res); if (!u) return; const b = req.body || {}, S = scopeStore(store, u.ws), id = clean(b.eventId, 80); if (!S.get("events/" + id)) return bad(res, "No such event.", 404, "not_found");
    const email = lc(clean(b.email, 200)), tags = (Array.isArray(b.tags) ? b.tags : []).filter((t) => VIBE_TAGS.some((k) => k[0] === t)); if (!email) return bad(res, "Which guest?");
    S.set("vibes/" + id + "--" + hash(email), { eventId: id, email, tags, at: Date.now() }); X.bust(); if (tags.length) X.notify(email, { kind: "vibe", key: `vibe-${id}-${tags.join()}`, text: `${first(u.name)} gave you ${tags.length === 1 ? "a badge" : "badges"} for ${S.get("events/" + id).data.pubTitle || S.get("events/" + id).data.name}: ${tags.map((t) => VIBE_TAGS.find((k) => k[0] === t)[2]).join(", ")}`, link: "/feed" }); res.json({ ok: true }); });
  // the event FAQ: guests ask and upvote; the host answers and publishes. Only published answers are public.
  const faqOf = (S, id) => S.list("faq").map((d) => ({ key: d.id, ...d.data })).filter((q) => q.eventId === id);
  const faqView = (q) => ({ id: q.key, q: q.q, a: q.a || "", votes: q.votes || 0, by: q.by || "", host: !!q.fromHost, at: q.at });
  app.get("/api/public/faq/:eventId", (req, res) => { const id = clean(req.params.eventId, 80), ws = workspaceOfEvent(id); if (!ws) return bad(res, "No such event.", 404, "not_found"); const L = faqOf(scopeStore(store, ws), id);
    res.json({ published: L.filter((q) => q.status === "published").sort((a, b) => (b.votes || 0) - (a.votes || 0) || a.at - b.at).map(faqView), waiting: L.filter((q) => q.status === "pending").length }); });
  app.post("/api/public/faq/:eventId", small, (req, res) => { if (limited(req, 8)) return bad(res, "That's a lot of questions. Try again in a bit.", 429, "rate_limited"); const id = clean(req.params.eventId, 80), ws = workspaceOfEvent(id); if (ws && process.env.ENCORE_ALLOW_DEMO_WRITES !== "1" && /@demo\.encore$/i.test(getWorkspace(ws)?.ownerEmail || "")) return bad(res, "This is an example event, so nobody will answer. Host your own to try it.", 403, "example"); if (!ws) return bad(res, "No such event.", 404, "not_found");
    const q = clean(req.body?.q, 300); if (q.length < 5) return bad(res, "Add a few more words."); const S = scopeStore(store, ws), ev = S.get("events/" + id)?.data;
    const dup = faqOf(S, id).find((x) => lc(x.q) === lc(q)); if (dup) return res.json({ ok: true, duplicate: true });
    S.add("faq", { eventId: id, q, by: clean(req.body?.name, 40).split(/\s+/)[0] || "", votes: 1, status: "pending", at: Date.now() });
    const owner = getWorkspace(ws)?.ownerEmail; if (owner) X.notify(owner, { kind: "faq", key: "faq-" + id + "-" + hash(q), text: `❓ New question on ${ev?.pubTitle || ev?.name || "your event"}: "${q.slice(0, 80)}"`, link: `/g#rsvp-${id}`, eventId: id });
    res.json({ ok: true }); });
  app.post("/api/public/faq/:eventId/:qid/vote", small, (req, res) => { if (limited(req, 30)) return bad(res, "Slow down.", 429, "rate_limited"); const id = clean(req.params.eventId, 80), ws = workspaceOfEvent(id); if (!ws) return bad(res, "No such event.", 404, "not_found");
    const S = scopeStore(store, ws), k = clean(req.params.qid, 60), d = S.get("faq/" + k)?.data; if (!d || d.eventId !== id) return bad(res, "No such question.", 404, "not_found"); S.update("faq/" + k, { votes: (d.votes || 0) + 1 }); res.json({ ok: true, votes: (d.votes || 0) + 1 }); });
  app.get("/api/host/faq/:eventId", (req, res) => { const u = me(req, res); if (!u) return; const id = clean(req.params.eventId, 80), S = scopeStore(store, u.ws); if (!S.get("events/" + id)) return bad(res, "No such event.", 404, "not_found");
    res.json({ questions: faqOf(S, id).sort((a, b) => (a.status === "pending" ? -1 : 1) - (b.status === "pending" ? -1 : 1) || (b.votes || 0) - (a.votes || 0)).map((q) => ({ ...faqView(q), status: q.status })) }); });
  app.post("/api/host/faq/:eventId", small, (req, res) => { const u = me(req, res); if (!u) return; const id = clean(req.params.eventId, 80), S = scopeStore(store, u.ws); if (!S.get("events/" + id)) return bad(res, "No such event.", 404, "not_found"); const b = req.body || {};
    if (b.id) { const k = clean(b.id, 60), d = S.get("faq/" + k)?.data; if (!d || d.eventId !== id) return bad(res, "No such question.", 404, "not_found"); if (b.remove) { S.delete("faq/" + k); return res.json({ ok: true }); }
      S.update("faq/" + k, { ...(b.q != null ? { q: clean(b.q, 300) } : {}), ...(b.a != null ? { a: clean(b.a, 800) } : {}), status: ["published", "hidden", "pending"].includes(b.status) ? b.status : d.status, answeredAt: Date.now() }); return res.json({ ok: true }); }
    const q = clean(b.q, 300); if (q.length < 5) return bad(res, "Add the question."); S.add("faq", { eventId: id, q, a: clean(b.a, 800), votes: 0, status: b.a ? "published" : "pending", fromHost: true, at: Date.now() }); res.json({ ok: true }); });
  // who's coming, on the event's public page: people who said yes and chose to be shown, with their archetype and one fun fact
  app.get("/api/public/attendees/:eventId", (req, res) => { const id = clean(req.params.eventId, 80), ws = workspaceOfEvent(id); if (!ws) return bad(res, "No such event.", 404, "not_found");
    const S = scopeStore(store, ws), ev = S.get("events/" + id)?.data; if (!ev || ev.example) return bad(res, "No such event.", 404, "not_found"); if (ev.hideGuests) return res.json({ attendees: [], count: 0, hidden: true });
    const short = (n) => { const w = String(n || "").trim().split(/\s+/).filter(Boolean); return w.length ? w[0] + (w[1] ? " " + w[1][0].toUpperCase() + "." : "") : "Guest"; }, seen = new Set(), out = []; let total = 0;
    const R0 = S.list("rsvps").map((d) => d.data || {}).filter((r) => r.eventId === id), past = !!ev.date && ev.date < today(), door = past && (R0.some((r) => r.checkedInAt) || (ev.guests || []).some((g) => /Attended/.test(g.status || "")));
    const arche = (email, gt) => { if (TRAITS[gt] && gt !== "early") return { name: TRAITS[gt].name, emoji: TRAITS[gt].emoji }; try { const P2 = email ? X.eventProfile(email) : null; if (P2?.top && (P2.attended || 0) >= 2) return { name: P2.top.name, emoji: P2.top.emoji }; } catch {} const q = TRAITS[gt]; if (q) return { name: q.name, emoji: q.emoji }; return { name: "New to Pottery Lab", emoji: newcomerEmoji(email || gt || "") }; };
    for (const d of S.list("rsvps")) { const r = d.data || {}; const yes = (r.response === "going" || (ev.stage === "interest" && r.interest === "in")) && !r.noShow && (!door || !!r.checkedInAt); if (r.eventId !== id || !yes) continue; const k = lc(r.email || (r.phone ? "tel:" + String(r.phone).replace(/[^\d+]/g, "") : "") || d.id); if (seen.has(k)) continue; seen.add(k); total += seatsOf(r, ev); if (r.showMe === false) continue;
      out.push({ name: short(r.name), archetype: arche(lc(r.email) || lc("name:" + (r.name || d.id)), r.guestType), fact: clean(r.funFact, 120), emoji: r.emoji || "", you: d.id === String(req.query.rid || ""), plus: !!r.plusOne, ...(r.email || r.phone ? { key: hash(lc(r.email || "tel:" + String(r.phone).replace(/[^\d+]/g, ""))) } : {}) }); }
    const names = new Set(out.map((o) => lc(o.name))); const replied = new Set(R0.flatMap((r) => [lc(r.email || ""), r.phone ? "tel:" + String(r.phone).replace(/[^\d+]/g, "") : "", lc(r.name || ""), r.name ? lc(short(r.name)) : ""]).filter(Boolean)); const gone = new Set(S.list("rsvps").map((d) => d.data || {}).filter((r) => r.eventId === id && r.noShow).flatMap((r) => [lc(r.email || ""), lc(short(r.name)), lc(r.name || "")]).filter(Boolean)); for (const g of ev.guests || []) { if (gone.has(lc(g.email || "")) || gone.has(lc(g.name || "")) || gone.has(lc(short(g.name)))) continue; if (g.source !== "Walk-in" && (replied.has(lc(g.email || "")) || (g.phone && replied.has("tel:" + String(g.phone).replace(/[^\d+]/g, ""))) || replied.has(lc(g.name || "")) || replied.has(lc(short(g.name))))) continue; if (!/^(Going|Attended)$/.test(g.status || "") || (door && g.status !== "Attended")) continue; if (g.source === "Walk-in") { total++; continue; } const k = lc(g.email || (g.phone ? "tel:" + String(g.phone).replace(/[^\d+]/g, "") : "") || g.name); if (!k || seen.has(k) || names.has(lc(short(g.name)))) continue; seen.add(k); total++; out.push({ name: short(g.name), archetype: arche(lc(g.email)), fact: "" }); }
    // spots left as a new guest would get them: none while anyone is waiting (the waitlist goes first)
    const RD = S.list("rsvps").filter((d) => d.data?.eventId === id), waiting = waitlistOf(RD).length, seats = +ev.headcount || 0, left = seats && ev.autoWait !== false ? (waiting ? 0 : Math.max(0, seats - seatsTaken(ev, RD))) : null;
    res.json({ attendees: out.slice(0, 40), count: total, seats, checked: !!door, waiting, ...(left != null ? { left } : {}) }); });
  // a guest's card, opened from Who's coming: only for people who chose to be shown, never their email
  app.get("/api/public/person/:eventId/:key", (req, res) => { const id = clean(req.params.eventId, 80), key = clean(req.params.key, 40), ws = workspaceOfEvent(id); if (!ws) return bad(res, "No such event.", 404, "not_found");
    const S = scopeStore(store, ws), ev = S.get("events/" + id)?.data; if (!ev || ev.example || ev.hideGuests) return bad(res, "Not shown.", 404, "not_found");
    const pk = (r) => (r.email ? lc(r.email) : r.phone ? "tel:" + String(r.phone).replace(/[^\d+]/g, "") : ""); const d = S.list("rsvps").find((x) => x.data?.eventId === id && pk(x.data) && hash(pk(x.data)) === key && x.data.showMe !== false); if (!d) return bad(res, "Not shown.", 404, "not_found");
    const r = d.data, em = lc(r.email), w = String(r.name || "").trim().split(/\s+/).filter(Boolean), name = w.length ? w[0] + (w[1] ? " " + w[1][0].toUpperCase() + "." : "") : "Guest";
    let P = {}; try { P = X.eventProfile(em) || {}; } catch {}
    const quizT = r.guestType !== "early" && TRAITS[r.guestType]; const top = quizT ? { ...quizT, quiz: true } : P.top && (P.attended || 0) >= 2 ? { name: P.top.name, emoji: P.top.emoji, line: P.top.line } : { name: "New to Pottery Lab", emoji: newcomerEmoji(em || lc("name:" + (r.name || d.id))), line: "" };
    const pp = X.person(em), prof = pp?.ws ? C.profileOf(pp.ws) : null, SOC = /instagram|tiktok|x\.com|twitter|threads|linkedin|strava|substack|youtube|bsky|facebook/i;
    const socials = (prof?.links || []).filter((l) => l?.url && SOC.test(l.url)).slice(0, 4).map((l) => ({ label: clean(l.label, 30) || new URL(l.url).hostname.replace(/^www\./, ""), url: l.url }));
    const I = X.index(), kud = I.kudos.filter((k) => em && lc(k.email) === em && k.love).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 2).map((k) => ({ love: "", event: I.events.get(k.eventId)?.e?.pubTitle || I.events.get(k.eventId)?.e?.name || "" })); // what someone wrote in kudos is for the host only
    const LANE = { move: "moving (runs, hikes, walks)", make: "making and tasting things", gather: "long dinners and good conversation", discover: "trying new places", cook: "cooking and eating together" };
    const loves = (P.loves || []).map((l) => LANE[l.kind] || l.kind).slice(0, 2);
    let mutual = []; const u = currentUser(req); if (em && u?.email && lc(u.email) !== em) { const mine = new Set(X.friendsOf(u.email).map((f) => lc(f.email))); mutual = X.friendsOf(em).filter((f) => mine.has(lc(f.email))).map((f) => (X.person(f.email)?.name || "").split(/\s+/)[0]).filter(Boolean); }
    const first = w[0] || "They", n = Math.max(P.attended || 0, ev.date && ev.date < new Date().toISOString().slice(0, 10) && r.response === "going" ? 1 : 0);
    const take = [top.name !== "New to Pottery Lab" ? `${first} is ${/^the /i.test(top.name) ? top.name.replace(/^The /, /^The [AEIOU]/i.test(top.name) ? "an " : "a ") : top.name}${n ? `, with ${n} event${n === 1 ? "" : "s"} on Pottery Lab` : ""}.` : (ev?.date && ev.date < new Date().toISOString().slice(0, 10) ? `This was ${first}'s first Pottery Lab event.` : `It's ${first}'s first Pottery Lab event too. Say hi.`), loves.length && n >= 2 ? `Usually found at ${loves.join(" and ")}.` : "", P.hosted ? `Has hosted ${P.hosted} too.` : "", r.funFact ? `Their fun fact: “${clean(r.funFact, 120).replace(/[.!]$/, "")}.”` : ""].filter(Boolean).join(" ");
    res.json({ name, emoji: r.emoji || top.emoji, archetype: top, traits: (P.traits || []).slice(0, 3).map((t) => ({ name: t.name, emoji: t.emoji })), fact: clean(r.funFact, 160), attended: n, hosted: P.hosted || 0, kudos: kud, socials, mutual: { count: mutual.length, names: mutual.slice(0, 3) }, signedIn: !!u?.email, take, page: prof?.handle && pp?.ws ? "/@" + prof.handle : "" }); });
  // ---- Potto's read on the room: what the guests share, where they differ, and questions worth asking the whole table ----
  app.get("/api/host/room/:eventId", async (req, res) => { const u = me(req, res); if (!u) return; const S = scopeStore(store, u.ws), id = clean(req.params.eventId, 80), ev = S.get("events/" + id)?.data; if (!ev) return bad(res, "No such event.", 404, "not_found");
    const seen = new Set(), G = [], I0 = X.index(), priorOf = (em) => (em ? (I0.att.get(lc(em)) || []).filter((a) => a.eventId !== id && (I0.events.get(a.eventId)?.e?.date || "9") < today()).length : 0);
    for (const d of S.list("rsvps")) { const r = d.data || {}; if (r.eventId !== id || !["going", "requested", "maybe"].includes(r.response)) continue; const k = lc(r.email || r.phone || r.name || d.id); if (seen.has(k)) continue; seen.add(k);
      let P = {}; try { P = r.email ? X.eventProfile(lc(r.email)) || {} : {}; } catch {} const prior = priorOf(r.email);
      G.push({ name: first(r.name) || "A guest", response: r.response, arche: (r.guestType !== "early" && TRAITS[r.guestType]?.name) || (prior >= 2 && P.top?.name) || "New to Pottery Lab", archeKey: (r.guestType !== "early" && TRAITS[r.guestType] && r.guestType) || (prior >= 2 && P.top?.key) || "new", loves: prior ? (P.loves || []).map((l) => l.kind) : [], attended: prior, fact: clean(r.funFact, 140), answers: ansList(r.answers, ev.questions).map((a) => `${clean(a.q, 80)}${a.q ? ": " : ""}${clean(a.a, 140)}`), note: clean(r.access, 120) }); }
    if (!G.length) return res.json({ guests: 0, empty: true });
    // what's true without AI
    const count = (arr) => arr.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {});
    const arch = Object.entries(count(G.map((g) => g.arche))).sort((a, b) => b[1] - a[1]), lanes = Object.entries(count(G.flatMap((g) => g.loves))).sort((a, b) => b[1] - a[1]);
    const LANE = { move: "moving: runs, hikes, rides", make: "making and tasting things", gather: "long dinners and good talk", discover: "trying new places", run: "running", hike: "hiking", bike: "riding", cook: "cooking and eating together", potluck: "potlucks", games: "game nights", movie: "movie nights", concert: "live music", cafe: "coffee and tea", bake: "baking", picnic: "picnics", book: "books", club: "clubs and meetups" };
    const firstTimers = G.filter((g) => !g.attended).map((g) => g.name), regulars = G.filter((g) => g.attended >= 3).map((g) => g.name), facts = G.filter((g, i, A) => g.fact && A.findIndex((h) => lc(h.fact) === lc(g.fact)) === i);
    const common = [], differ = [], prompts = [], pairs = [];
    if (lanes[0] && lanes[0][1] >= 2 && !(ev.date && ev.date < new Date().toISOString().slice(0, 10)) && G.some((g) => g.attended > 0)) { const lab = LANE[lanes[0][0]]; if (lab) common.push(`${lanes[0][1]} of them love ${lab}.`); }
    if (G.length >= 2 && firstTimers.length === G.length) common.push("Everyone's new. Start with names and one good thing from the week.");
    if (firstTimers.length && firstTimers.length < G.length) common.push(`${firstTimers.slice(0, 3).join(", ")} ${firstTimers.length === 1 ? "is" : "are"} new. Put them next to someone who's been before.`);
    if (regulars.length) differ.push(`${regulars.slice(0, 2).join(" and ")} ${regulars.length === 1 ? "has" : "have"} been to 3 or more. Ask them to welcome the new faces.`);
    { const typed = G.filter((g) => g.arche !== "New to Pottery Lab"); for (let i = 0; i < typed.length && pairs.length < 2; i++) for (let j = i + 1; j < typed.length; j++) if (typed[i].arche !== typed[j].arche) { pairs.push(`Seat ${typed[i].name} next to ${typed[j].name}.`); break; } }
    if (facts.length >= 2) { prompts.push(`Fun-fact roulette: read one fun fact out loud, everyone guesses whose it is.`); if (pairs.length < 2) pairs.push(`Ask ${facts[0].name} about "${facts[0].fact}", then ${facts[1].name} about "${facts[1].fact}". Those two will get talking.`); }
    prompts.push("What's something you changed your mind about this year?", "What's the best thing you've eaten (or made) recently, and who were you with?", "If this group took a trip together, where would we go and who'd plan it?"); { const words = (q) => new Set(String(q || "").toLowerCase().match(/[a-z]{4,}/g) || []); const hw = words(ev.askQ); if (hw.size) for (let i = prompts.length - 1; i >= 0; i--) { const w = words(prompts[i]); let n = 0; for (const x of w) if (hw.has(x)) n++; if (n >= 2) prompts.splice(i, 1); } }
    let out = { guests: G.length, going: G.filter((g) => g.response === "going").length, common, differ, prompts: prompts.slice(0, 4), pairs, source: "pip" };
    // sharper with Claude, when it's switched on
    if (!isFake() && G.length >= 2) { try {
      const brief = G.map((g, i) => `${i + 1}. ${g.name} (${g.arche}${g.loves.length ? ", into " + g.loves.join("/") : ""}${g.attended ? `, ${g.attended} get-togethers` : ", new"})${g.fact ? ` fun fact: ${g.fact}` : ""}${g.answers.length ? ` | ${g.answers.join(" | ")}` : ""}`).join("\n");
      const r = await complete({ prompt: `You help a host of a small get-together for friends ("${ev.pubTitle || ev.name}") understand who's coming.${ev.askQ ? ` The host already asks everyone: "${ev.askQ}" — do not repeat that question.` : ""} Guests (first names only; this is private to the host):\n${brief}\n\nReturn JSON only: {"common":[2-3 short observations of what they share],"differ":[1-2 where their perspectives differ in a fun, kind way],"prompts":[4 provocative but warm questions to ask the whole table that would spark debate given these specific people],"pairs":[1-2 "X and Y should talk about Z" suggestions]}. Be specific to these people, playful, never mean, no stereotypes about protected traits. Under 25 words each.`, effort: "low" });
      const j = parseJsonLoose(r.text); if (j && Array.isArray(j.prompts)) out = { ...out, common: (j.common || out.common).slice(0, 3), differ: (j.differ || out.differ).slice(0, 2), prompts: j.prompts.slice(0, 4), pairs: (j.pairs || out.pairs).slice(0, 2), source: "ai" };
    } catch {} }
    res.json(out); });
  // ---- Invite these first: who, from your own history, says yes early and pulls everyone else in ----
  app.get("/api/host/first-yes", (req, res) => { const u = me(req, res); if (!u) return; const S = scopeStore(store, u.ws), id = clean(req.query.eventId, 80), today = new Date().toISOString().slice(0, 10);
    const events = new Map(S.list("events").map((d) => [d.id, d.data || {}])), R = S.list("rsvps").map((d) => ({ id: d.id, ...(d.data || {}) })).filter((r) => r.eventId && events.has(r.eventId) && !events.get(r.eventId).example);
    const already = new Set(R.filter((r) => r.eventId === id).map((r) => lc(r.email || r.phone || r.name)));
    const byEv = new Map(); for (const r of R) { if (!byEv.has(r.eventId)) byEv.set(r.eventId, []); byEv.get(r.eventId).push(r); }
    const P = new Map(), key = (r) => lc(r.email || r.phone || "");
    const bump = (r, f, n = 1) => { const k2 = key(r); if (!k2) return; if (!P.has(k2)) P.set(k2, { name: r.name || "", email: r.email || "", phone: r.phone || "", yes: 0, came: 0, early: 0, no: 0, kudos: 0, events: 0, follows: false }); const x = P.get(k2); if (r.name && !x.name) x.name = r.name; if (r.phone && !x.phone) x.phone = r.phone; x[f] += n; };
    for (const [eid, L] of byEv) { const ev = events.get(eid), past = !!ev.date && ev.date < today; L.sort((a, b) => (a.createdAt || a.at || 0) - (b.createdAt || b.at || 0));
      L.forEach((r, i) => { bump(r, "events"); if (r.response === "going" || r.interest === "in") { bump(r, "yes"); if (i < 3) bump(r, "early"); if (past && !r.noShow) bump(r, "came"); else if (past && r.noShow) bump(r, "no"); } else if (r.response === "no") bump(r, "no"); }); }
    for (const d of S.list("kudos")) { const kd = d.data || {}; if (kd.email) bump({ email: kd.email, name: kd.name }, "kudos"); }
    try { for (const f of C.followersOf(u.ws)) { const k2 = lc(f.email || f.phone || ""); if (!k2) continue; if (P.has(k2)) P.get(k2).follows = true; else P.set(k2, { name: f.name || "", email: f.email, phone: f.phone || "", yes: 0, came: 0, early: 0, no: 0, kudos: 0, events: 0, follows: true }); } } catch {}
    const L = [...P.entries()].filter(([k2]) => !already.has(k2)).map(([k2, x]) => { const score = x.early * 3 + x.came * 3 + x.yes * 2 + x.kudos + (x.follows ? 1 : 0) - x.no;
      const why = [x.early ? (x.early === 1 ? "said yes early once" : `said yes early ${x.early} times`) : "", x.came ? `came to ${x.came}` : "", x.kudos ? "sent kudos" : "", x.follows && !x.events ? "follows you" : ""].filter(Boolean);
      return { name: x.name || (x.email ? x.email.split("@")[0] : "A friend"), email: x.email, phone: x.phone, score, why: why.length ? why.join(" · ") : "follows you", early: x.early >= 1 }; }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
    res.json({ people: L, history: R.length }); });
  // ---- RSVP by text: the host texts the invite; guests reply YES, MAYBE or NO (SMS or WhatsApp through the same number) ----
  const normPhone = (p) => { const raw = String(p || "").replace(/^whatsapp:/i, ""), d = raw.replace(/[^\d+]/g, ""); return d.startsWith("+") ? d : d.length === 10 ? "+1" + d : d.length === 11 && d.startsWith("1") ? "+" + d : d ? "+" + d : ""; };
  const prettyTime = (t) => { const m = String(t || "").match(/^(\d{1,2}):(\d{2})/); if (!m) return ""; let h = +m[1]; const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return `${h}:${m[2]}${ap}`; };
  const whenOf = (e) => [e.date ? new Date(e.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "", prettyTime(e.startTime)].filter(Boolean).join(" at ");
  app.post("/api/host/text-invites", small, async (req, res) => { const u = me(req, res); if (!u) return; if (limited(req, 10)) return bad(res, "Slow down.", 429, "rate_limited");
    const S = scopeStore(store, u.ws), id = clean(req.body?.eventId, 80), ev = S.get("events/" + id)?.data; if (!ev) return bad(res, "No such event.", 404, "not_found");
    const phones = [...new Set((Array.isArray(req.body?.phones) ? req.body.phones : String(req.body?.phones || "").split(/[,\n;]+/)).map(normPhone).filter((p) => /^\+\d{7,16}$/.test(p)))].slice(0, 40);
    if (!phones.length) return bad(res, "Add at least one phone number.");
    const cfg = smsConfig(), title = ev.pubTitle || ev.name || "an event", host = first(u.name) || "Your friend", link = `${publicOrigin(req)}/g#rsvp-${id}`, out = [];
    const text = `${host} invited you to ${title}${whenOf(ev) ? `, ${whenOf(ev)}` : ""}${ev.meetPoint ? ` (${ev.meetPoint})` : ""}. Reply YES, MAYBE or NO. Details: ${link}`;
    for (const ph of phones) { S.set("textinvites/" + hash(ph + id), { phone: ph, eventId: id, at: Date.now(), by: u.email }); const r = cfg ? await sendSms(cfg, { to: ph, text }) : { ok: false }; out.push({ phone: ph, sent: !!r.ok }); }
    res.json({ ok: true, sent: out.filter((x) => x.sent).length, total: out.length, texting: !!cfg, text, results: out }); });
  // Twilio posts replies here (SMS and WhatsApp use the same format; WhatsApp numbers arrive as "whatsapp:+1...")
  function twilioValid(req) { const tok = process.env.ENCORE_TWILIO_TOKEN; if (!tok) return process.env.ENCORE_FAKE_SMS === "1"; const sig = req.get("x-twilio-signature") || "", url = `${publicOrigin(req)}${req.originalUrl}`, params = req.body || {};
    const data = url + Object.keys(params).sort().map((k) => k + params[k]).join(""); const want = crypto.createHmac("sha1", tok).update(data).digest("base64"); try { return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want)); } catch { return false; } }
  const twiml = (res, msg) => res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?><Response>${msg ? `<Message>${String(msg).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c])}</Message>` : ""}</Response>`);
  app.post("/api/public/sms/inbound", express.urlencoded({ extended: false, limit: "20kb" }), (req, res) => { if (!twilioValid(req)) return res.status(403).send("forbidden");
    const from = normPhone(req.body?.From), body = String(req.body?.Body || "").trim(), word = body.toLowerCase().replace(/[^a-z' ]/g, " ").trim().split(/\s+/)[0] || "", today = new Date().toISOString().slice(0, 10);
    if (!from) return twiml(res, "");
    if (/^(stop|unsubscribe|cancel|end|quit|stopall)$/.test(word)) { store.set("system/smsstop-" + hash(from), { phone: from, at: Date.now() }); return twiml(res, ""); }
    if (/^(start|unstop|yes)$/.test(word) && store.get("system/smsstop-" + hash(from))) { store.delete("system/smsstop-" + hash(from)); return twiml(res, "You're opted back in to texts from Pottery Lab. Reply STOP to opt out."); }
    // the most recent upcoming invite or RSVP for this number
    let best = null; for (const ws of allWorkspaceIds()) { const S = scopeStore(store, ws); for (const d of [...S.list("textinvites"), ...S.list("rsvps")]) { const x = d.data || {}; if (normPhone(x.phone) !== from) continue; const ev = S.get("events/" + x.eventId)?.data; if (!ev || (ev.date && ev.date < today)) continue; const at = x.changedAt || x.at || 0; if (!best || at > best.at) best = { ws, S, ev, eventId: x.eventId, at }; } }
    if (!best) return twiml(res, "Hi! This is Pottery Lab. We couldn't find an invite for this number. Open the link your host sent to reply.");
    const { S, ev, eventId } = best, title = ev.pubTitle || ev.name || "the event", link = `${publicOrigin(req)}/g#rsvp-${eventId}`;
    const mine = S.list("rsvps").find((d) => d.data?.eventId === eventId && normPhone(d.data?.phone) === from);
    // the invite text says "I'm in, Maybe or Can't go": accept those phrases, not just one-word replies
    const phrase = body.toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim();
    const resp = /^(i'?m in|i am in|count me in|im in)\b/.test(phrase) || /^(yes|y|yep|yeah|yup|in|going|sure|ok|okay|absolutely|totally)$/.test(word) || /^(👍|✅|🙌)/u.test(body) ? "going" : /^(can'?t go|cannot go|can not go|can'?t make it)\b/.test(phrase) ? "no" : /^(maybe|m|perhaps|possibly|prob|probably)$/.test(word) ? "maybe" : /^(no|n|nope|out|cant|can't|sorry|pass)$/.test(word) ? "no" : null;
    if (!resp) { // a name, after they said yes
      if (mine && /^Guest/.test(mine.data.name || "") && body.length >= 2 && body.length <= 40) { S.update("rsvps/" + mine.id, { name: clean(body, 60), changedAt: Date.now() }); return twiml(res, `Thanks, ${first(body)}! You're in for ${title}. Who's coming and the group chat: ${link}`); }
      return twiml(res, `Reply YES, MAYBE or NO for ${title}${whenOf(ev) ? ` (${whenOf(ev)})` : ""}. Details: ${link}`); }
    const want = resp === "going" && ev.approvalRequired ? "requested" : resp; const going = S.list("rsvps").filter((d) => d.data?.eventId === eventId && d.data?.response === "going").length, cap = +ev.headcount || 0;
    const final = want === "going" && cap && going >= cap && !(mine?.data?.response === "going") ? "waitlist" : want;
    let rid = mine?.id, code = mine?.data?.code; const name = mine?.data?.name || `Guest ${from.slice(-4)}`;
    if (mine) S.update("rsvps/" + rid, { response: final, changedAt: Date.now(), via: "text" }); else { code = crypto.randomBytes(6).toString("hex"); const r0 = S.add("rsvps", { eventId, name, phone: from, response: final, code, via: from.length ? "text" : "", at: Date.now(), changedAt: Date.now(), showMe: true }); rid = r0.id; }
    try { X.bust(); } catch {}
    const pass = `${publicOrigin(req)}/g?r=${encodeURIComponent(rid)}.${encodeURIComponent(code)}#rsvp-${eventId}`, askName = /^Guest/.test(name) ? " Reply with your name so your host knows it's you." : "";
    const msg = final === "going" ? `You're in for ${title}${whenOf(ev) ? `, ${whenOf(ev)}` : ""}. Who's coming and the group chat: ${pass}${askName}` : final === "requested" ? `Asked. ${first(C.profileOf(best.ws)?.name || "") || "Your host"} will let you know. ${pass}${askName}` : final === "waitlist" ? `It's full right now, so you're on the waitlist. If a spot opens, it's yours. ${pass}` : final === "maybe" ? `Marked you as maybe. Reply I'm in any time. ${pass}` : `No worries, we'll tell your host. Reply YES if plans change.`;
    return twiml(res, msg); });
  // "Keep me posted" on the RSVP form: a guest (no account needed) follows the host, proved by their RSVP code
  app.post("/api/public/keep-posted", small, (req, res) => { if (limited(req, 20)) return bad(res, "Slow down.", 429, "rate_limited"); const b = req.body || {}, P = X.rsvpProof(clean(b.eventId, 80), b.rid, b.code); if (!P) return bad(res, "RSVP first.", 403, "not_granted");
    const email = lc(P.r.email || ""); const phone = clean(P.r.phone || "", 24); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && phone.replace(/\D/g, "").length < 7) return res.json({ ok: false, reason: "no_contact" });
    const isNew = C.follow(P.ws, { email: /@/.test(email) ? email : "", name: clean(P.r.name, 80), via: "rsvp", phone }); res.json({ ok: true, isNew, followers: C.followersOf(P.ws).length }); });
  // the exact address, for guests who are in
  app.get("/api/public/address/:eventId", (req, res) => { const P = X.rsvpProof(clean(req.params.eventId, 80), req.query.rid, req.query.code); if (!P || P.r.response !== "going" || !P.ev) return res.json({ ok: false });
    // guests read "Mina's place", never the host's own "my place" (as on the invite itself)
    const hn = first(getDbUser(getWorkspace(P.ws)?.ownerEmail || "")?.name || ""), mine = (x) => String(x || "").replace(/\b(my|our) (place|apartment|flat|house|home)\b/gi, (m, w, pl) => (hn ? `${hn}'s ${pl.toLowerCase()}` : `the host's ${pl.toLowerCase()}`));
    res.json({ ok: true, meetPoint: mine(P.ev.meetPoint), venueName: mine(P.ev.venueName), venueAddr: mine(P.ev.venueAddr) }); });
  // your RSVP follows your account: open an invite on any device, signed in, and it knows your answer
  app.get("/api/me/rsvp/:eventId", (req, res) => { const u = currentUser(req); if (!u?.email) return res.json({ rsvp: null }); const id = clean(req.params.eventId, 80), ws = workspaceOfEvent(id); if (!ws) return res.json({ rsvp: null });
    const d = scopeStore(store, ws).list("rsvps").filter((x) => x.data?.eventId === id && lc(x.data?.email) === lc(u.email)).sort((a, b) => (b.data.changedAt || b.data.at || 0) - (a.data.changedAt || a.data.at || 0))[0];
    res.json({ rsvp: d ? { rid: d.id, code: d.data.code, response: d.data.response, name: d.data.name, interest: d.data.interest || "" } : null }); });
  // everything you've said yes to or asked for, from any device
  app.get("/api/me/plans", (req, res) => { const u = currentUser(req); if (!u?.email) return res.json({ plans: [] }); const em = lc(u.email), out = [];
    for (const ws of allWorkspaceIds()) { const S = scopeStore(store, ws); for (const d of S.list("rsvps")) { const r = d.data || {}; if (lc(r.email) !== em || !r.eventId) continue; const card = C.cardOf ? C.cardOf(r.eventId) : null; const ev = S.get("events/" + r.eventId)?.data; if (!ev) continue;
      out.push({ id: r.eventId, rid: d.id, code: r.code, response: r.response, interest: r.interest || "", title: ev.pubTitle || ev.name, date: ev.date || "", startTime: ev.startTime || "", city: ev.city || "", emoji: ev.emoji || card?.emoji || "", stage: ev.stage || "" }); } }
    out.sort((a, b) => String(a.date || "9").localeCompare(String(b.date || "9"))); res.json({ plans: out }); });
  // a guest adds a fun fact, or hides themselves from the guest list
  app.post("/api/public/rsvp-extra/:eventId", small, (req, res) => { const b = req.body || {}, P = X.rsvpProof(clean(req.params.eventId, 80), b.rid, b.code); if (!P) return bad(res, "No such reply.", 404, "not_found");
    const patch = {}; if (b.funFact != null) patch.funFact = clean(b.funFact, 120); if (b.showMe != null) patch.showMe = !!b.showMe; if (b.answer != null) { patch.answer = clean(b.answer, 200); patch.answeredAt = Date.now(); } if (b.emoji != null) patch.emoji = [...String(b.emoji)].slice(0, 2).join("").slice(0, 8);
    // change what you're bringing: one of the host's list items that nobody else going has claimed, or nothing
    if (b.slot != null) { const want = clean(b.slot, 120), L = P.ev?.slots || []; if (want && !L.includes(want)) return bad(res, "That isn't on the bring list.");
      const mine = String(b.rid).replace(/[^A-Za-z0-9_-]/g, ""); if (want && P.S.list("rsvps").some((d) => !String(d.id).endsWith(mine) && d.data?.eventId === P.r.eventId && d.data?.response === "going" && d.data?.slot === want)) return bad(res, "Someone already has that one. Pick another?", 409, "conflict");
      patch.slot = want; patch.changedAt = Date.now(); } P.S.update("rsvps/" + String(b.rid).replace(/[^A-Za-z0-9_-]/g, ""), patch); res.json({ ok: true }); });
  // ---- Keep in touch after the night: two guests who both went become friends on Pottery Lab (no account needed; it's keyed by email) ----
  app.post("/api/public/keep-in-touch", small, (req, res) => { if (limited(req, 30)) return bad(res, "Slow down.", 429, "rate_limited"); const b = req.body || {}, id = clean(b.eventId, 80), P = X.rsvpProof(id, b.rid, b.code);
    if (!P || P.r.response !== "going") return bad(res, "Only people who went can do this.", 403, "not_granted"); let mine = lc(P.r.email || ""); const given = lc(clean(b.email, 200)); if (!mine && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(given)) { mine = given; try { P.S.update("rsvps/" + String(b.rid).replace(/[^A-Za-z0-9_-]/g, ""), { email: given }); } catch {} } if (!mine && P.r.phone) mine = "tel:" + String(P.r.phone).replace(/[^\d+]/g, ""); if (!mine) return res.json({ ok: false, reason: "need_email", message: "Add your email so you can find each other again." });
    const pk = (r) => (r.email ? lc(r.email) : r.phone ? "tel:" + String(r.phone).replace(/[^\d+]/g, "") : ""); const other = P.S.list("rsvps").map((d) => d.data || {}).find((r) => r.eventId === id && r.response === "going" && pk(r) && hash(pk(r)) === String(b.pkey || ""));
    const otherKey = other ? pk(other) : ""; let back = false; if (!otherKey) return res.json({ ok: false, reason: "no_contact", message: "Couldn't find them. Say hi in person next time." });
    try { X.addFriend(mine, otherKey); back = X.friendsOf(otherKey).some((f) => lc(f.email) === mine); if (other.email) X.notify(lc(other.email), { kind: "friend", key: `kit-${id}-${hash(mine)}`, text: `${first(P.r.name) || "Someone"} from ${P.ev?.pubTitle || P.ev?.name || "the event"} wants to keep in touch 👋`, link: "/feed", eventId: id }); } catch {}
    res.json({ ok: true, mutual: !!back }); });
  // ---- One question at the door (Priya Parker's priming): answers stay sealed until the day of the event ----
  const answersOf = (S, id) => S.list("rsvps").map((d) => ({ id: d.id, ...(d.data || {}) })).filter((r) => r.eventId === id && r.response === "going" && r.answer).map((r) => ({ name: first(r.name) || "A guest", answer: r.answer }));
  const opened = (e) => !!e?.date && e.date <= new Date().toISOString().slice(0, 10);
  app.get("/api/host/answers", (req, res) => { const u = me(req, res); if (!u) return; const S = scopeStore(store, u.ws), id = clean(req.query.eventId, 80), e = S.get("events/" + id)?.data; if (!e) return bad(res, "No such event.", 404, "not_found");
    const A = answersOf(S, id), open = opened(e); res.json({ question: e.askQ || "", count: A.length, open, answers: open ? A : [] }); });
  app.get("/api/public/answers/:eventId", (req, res) => { const P = X.rsvpProof(clean(req.params.eventId, 80), req.query.rid, req.query.code); if (!P || P.r.response !== "going") return bad(res, "Reply I'm in to see the answers.", 403, "not_granted");
    const e = P.S.get("events/" + req.params.eventId)?.data, A = answersOf(P.S, req.params.eventId); if (!opened(e)) return res.json({ question: e?.askQ || "", count: A.length, open: false, answers: [] });
    res.json({ question: e.askQ || "", count: A.length, open: true, answers: A.sort(() => Math.random() - 0.5) }); });
  // who's going: for guests who are going (approved, on approval events), first names and an initial only
  app.get("/api/public/going/:eventId", (req, res) => { const P = X.rsvpProof(req.params.eventId, req.query.rid, req.query.code); if (!P || P.r.response !== "going") return bad(res, P?.r.response === "requested" ? "You'll see who's coming once the host lets you in." : "Reply I'm in to see who's coming.", 403, "not_granted");
    const id = P.r.eventId, short = (n) => { const w = String(n || "").trim().split(/\s+/).filter(Boolean); return w.length ? w[0] + (w[1] ? " " + w[1][0].toUpperCase() + "." : "") : "Guest"; }, seen = new Set(), out = [];
    for (const d of P.S.list("rsvps")) { const r = d.data || {}; if (r.eventId !== id || r.response !== "going") continue; const k = lc(r.email || (r.phone ? "tel:" + String(r.phone).replace(/[^\d+]/g, "") : "") || d.id); if (seen.has(k)) continue; seen.add(k); out.push({ name: short(r.name), you: d.id === P.rid, plus: !!r.plusOne }); }
    for (const g of P.ev?.guests || []) { if (!/^(Going|Attended)$/.test(g.status || "")) continue; const k = lc(g.email || g.name); if (!k || seen.has(k)) continue; seen.add(k); out.push({ name: short(g.name), you: false }); }
    const total = out.length + out.filter((x) => x.plus).length, seats = +P.ev?.headcount || 0;
    res.json({ going: out, count: total, seats, left: seats ? Math.max(0, seats - total) : null }); });
  // the group chat: guests who RSVP'd (or are interested) and the host; giveaway messages are private to the host
  const chatList = (S, eventId, viewerRid) => S.list("chat").map((d) => ({ id: d.id, ...d.data })).filter((m) => m.eventId === eventId && (!m.private || m.rid === viewerRid || viewerRid === "host")).sort((a, b) => a.at - b.at).slice(-200).map(({ rid, email, ...m }) => ({ ...m, mine: viewerRid !== "host" && rid === viewerRid, ...(m.poll ? { poll: { ...m.poll, votes: Object.fromEntries(Object.entries(m.poll.votes || {}).map(([o, L]) => [o, L.map((v) => v.name)])), myVotes: Object.entries(m.poll.votes || {}).filter(([, L]) => L.some((v) => v.rid === viewerRid)).map(([o]) => o) } } : {}) }));
  app.get("/api/public/chat/:eventId", (req, res) => { const P = X.rsvpProof(req.params.eventId, req.query.rid, req.query.code); if (!P || P.r.response !== "going") return bad(res, P?.r.response === "requested" ? "Chat opens once the host says yes." : "Chat opens once you're in.", 403, "not_granted"); res.json({ messages: chatList(P.S, P.r.eventId, P.rid), getThere: P.ev?.getThere || [], private: /giveaway/.test(P.ev?.activity || "") }); });
  app.post("/api/public/chat/:eventId", small, (req, res) => { if (limited(req, 60)) return bad(res, "Slow down.", 429, "rate_limited"); const b = req.body || {}, P = X.rsvpProof(req.params.eventId, b.rid, b.code); if (!P || P.r.response !== "going") return bad(res, "Chat opens once you're in.", 403, "not_granted");
    const kind = ["late", "release", "text"].includes(b.kind) ? b.kind : "text", text = clean(b.text, 600), give = /giveaway/.test(P.ev?.activity || "");
    if (kind === "text" && !text) return bad(res, "Say something first.");
    const body = kind === "late" ? `Running late${text ? `: ${text}` : ""}` : kind === "release" ? `Can't go. Please give my ${give ? "slice" : "spot"} to someone else.${text ? ` ${text}` : ""}` : text;
    P.S.add("chat", { eventId: P.r.eventId, rid: P.rid, by: first(P.r.name) || "Guest", role: "guest", kind, text: body, private: give || kind !== "text", at: Date.now() });
    if (kind === "release") { P.S.set("rsvps/" + P.rid, { ...P.r, response: "no", releasedAt: Date.now(), changedAt: Date.now() }); }
    const W = getWorkspace(P.ws); X.notify(W?.ownerEmail, { kind: "msg", text: `💬 ${first(P.r.name)}${P.ev?.pubTitle || P.ev?.name ? ` in ${P.ev.pubTitle || P.ev.name}` : ""}: ${body.slice(0, 120)}`, link: `/?app=1&open=${encodeURIComponent(P.r.eventId)}#studio`, eventId: P.r.eventId });
    res.json({ ok: true, released: kind === "release" }); });
  app.get("/api/host/chat/:eventId", (req, res) => { const u = me(req, res); if (!u) return; const S = scopeStore(store, u.ws), id = clean(req.params.eventId, 80); if (!S.get("events/" + id)) return bad(res, "No such event.", 404, "not_found");
    const R = S.list("rsvps").map((d) => ({ id: d.id, ...d.data })).filter((r) => r.eventId === id); res.json({ messages: chatList(S, id, "host"), phones: R.filter((r) => r.response === "going" && r.phone).map((r) => ({ name: r.name, phone: r.phone, slot: r.slot || "" })), sms: !!smsConfig() }); });
  app.post("/api/host/chat/:eventId", small, async (req, res) => { const u = me(req, res); if (!u) return; const S = scopeStore(store, u.ws), id = clean(req.params.eventId, 80), ev = S.get("events/" + id)?.data; if (!ev) return bad(res, "No such event.", 404, "not_found");
    const text = clean(req.body?.text, 600); if (!text) return bad(res, "Say something first."); S.add("chat", { eventId: id, by: first(u.name) || "Host", role: "host", text, private: false, pinned: !!req.body?.pinned, at: Date.now() });
    let texted = 0; const hr = new Date().getHours(); if (req.body?.sms && smsConfig() && (hr >= 21 || hr < 8) && !req.body?.anyway) return res.status(409).json({ code: "quiet_hours", message: "It's late, so I held the text. Tap again to send anyway." });
    if (req.body?.sms && smsConfig()) { const slot = clean(req.body?.slot, 40); for (const d of S.list("rsvps")) { const r = d.data; if (r.eventId === id && r.response === "going" && PHONE_OK(r.phone) && (!slot || r.slot === slot)) { const ok = await sendSms(smsConfig(), { to: r.phone, text: `${first(u.name)} (${ev.pubTitle || ev.name}): ${text}` }); if (ok.ok) texted++; } } }
    res.json({ ok: true, texted }); });
  // interest check → it's on: tell everyone who said they were in or maybe
  // interest check → it's on: tell everyone who said they were in or maybe (the host's button, or Potto on its own)
  async function itsOn({ ws, id, hostName, origin }) { const S = scopeStore(store, ws), ev = S.get("events/" + id)?.data; if (!ev) return null; const u = { name: hostName, ws };
    const R = S.list("rsvps").map((d) => ({ ...d.data, _id: d.id })).filter((r) => r.eventId === id && ["in", "maybe"].includes(r.interest)), link = `${origin}/g#rsvp-${id}`, title = ev.pubTitle || ev.name, when = ev.date ? new Date(ev.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }) : "soon";
    const cfg = emailConfig(u.ws, false) || emailConfig(DEFAULT_WS, true), sms = smsConfig(); let told = 0, texted = 0, confirmed = 0;
    // people who said "I'm in" for the date that won are in: no second tap needed. Maybes, and people who picked other dates, are asked to lock in.
    for (const r of R) { const fits = r.interest === "in" && (!(r.dates || []).length || !ev.date || (r.dates || []).includes(ev.date)); r._in = fits && r.response !== "going"; if (fits && r.response !== "going" && r.response !== "requested") { S.update("rsvps/" + r._id, { response: ev.approvalRequired ? "requested" : "going", changedAt: Date.now(), autoConfirmed: true }); if (!ev.approvalRequired) confirmed++; } }
    for (const r of R) { let ok = false; if (r.email && cfg) { const e1 = await sendEmail(cfg, { to: r.email, subject: `It's on: ${title}, ${when}`, text: r._in && !ev.approvalRequired ? `Hi ${first(r.name) || "there"},\n\nEnough of you were in, so ${title} is happening on ${when}. You're in.\n\nThe group chat and the getting-there plan are here: ${link}\n\nPlans changed? Tap Can't go on that page so someone else can have your spot.` : `Hi ${first(r.name) || "there"},\n\nEnough of you were in, so ${title} is happening on ${when}.\n\nAre you in? ${link}\n\nThe group chat and the getting-there plan are on that page once you're in.`, fromName: u.name }).catch(() => ({})); ok = !!e1.ok; }
      if (sms && PHONE_OK(r.phone)) { const t = await sendSms(sms, { to: r.phone, text: r._in && !ev.approvalRequired ? `It's on! ${title}, ${when}. You're in: ${link}` : `It's on! ${title}, ${when}. Are you in? ${link}` }); if (t.ok) { texted++; ok = true; } } if (r.email) X.notify(r.email, { kind: "itson", key: "itson-" + id, text: r._in && !ev.approvalRequired ? `It's on: ${title}, ${when}. You're in.` : `It's on: ${title}, ${when}. Are you in?`, link: `/g#rsvp-${id}`, eventId: id }); if (ok || r.email) told++; }
    S.add("chat", { eventId: id, by: first(u.name) || "Host", role: "host", text: `It's on: ${when}! ${confirmed ? `${confirmed} already in. ` : ""}Not sure yet? Tap I'm in on the invite.`, private: false, pinned: true, at: Date.now() });
    return { ok: true, told, texted, interested: R.length, confirmed }; }
  X.itsOn = itsOn;
  app.post("/api/host/its-on", small, async (req, res) => { const u = me(req, res); if (!u) return; const id = clean(req.body?.eventId, 80); if (!scopeStore(store, u.ws).get("events/" + id)) return bad(res, "No such event.", 404, "not_found");
    res.json(await itsOn({ ws: u.ws, id, hostName: u.name, origin: publicOrigin(req) })); });
  // the photo wall after an event: only for people who went (proved by their RSVP code) and the host
  app.get("/api/public/moments/:eventId", (req, res) => { const id = clean(req.params.eventId, 80), ws = workspaceOfEvent(id); if (!ws) return bad(res, "No such event.", 404, "not_found");
    const P = X.rsvpProof(id, req.query.rid, req.query.code), u = currentUser(req), isHost = u && u.ws === ws; if (!isHost && !(P && P.r.response === "going")) return res.json({ moments: [], locked: true });
    const L = scopeStore(store, ws).list("moments").map((d) => d.data).filter((m) => m && m.eventId === id).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 60).map((m) => ({ url: m.url, type: m.type, caption: m.caption || "", by: first(m.authorName) || "" }));
    res.json({ moments: L }); });
  // photos and short videos from the day: the host, or a guest who said yes
  app.post("/api/moments", raw, async (req, res) => { if (limited(req, 40)) return bad(res, "Slow down.", 429, "rate_limited"); const id = clean(req.query.eventId, 80), ct = String(req.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!/^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|quicktime))$/.test(ct)) return bad(res, "Photos (JPEG, PNG, WebP) or short videos (MP4, WebM, MOV).", 415, "unsupported_type");
    let ws = null, email = "", name = ""; const u = currentUser(req), P = X.rsvpProof(id, req.query.rid, req.query.code);
    if (P && P.r.response === "going") { ws = P.ws; email = lc(P.r.email); name = P.r.name; } else if (u && u.ws !== DEFAULT_WS && workspaceOfEvent(id) === u.ws) { ws = u.ws; email = lc(u.email); name = u.name; }
    else if (u) { const I = X.index(); if ((I.att.get(lc(u.email)) || []).some((a) => a.eventId === id)) { ws = workspaceOfEvent(id); email = lc(u.email); name = u.name; } }
    if (!ws) return bad(res, "Only the host and people who went can add photos.", 403, "not_granted");
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0); if (!body.length) return bad(res, "Empty upload.");
    const meta = await X.saveBlob(body, ct, ws); { const I = X.index(), evT = I.events.get(id)?.e; for (const [em, L] of I.att) if (em !== email && L.some((a) => a.eventId === id)) X.notify(em, { kind: "photos", key: `ph-${id}-${new Date().toISOString().slice(0, 13)}`, text: `📸 New photos from ${evT?.pubTitle || evT?.name || "your event"}${name ? `, from ${first(name)}` : ""}`, link: `/g#rsvp-${id}`, eventId: id }); }
    scopeStore(store, ws).add("moments", { eventId: id, authorEmail: email, authorName: name, url: meta.url, type: ct.startsWith("video") ? "video" : "image", caption: clean(req.query.caption, 200), at: Date.now() }); X.bust();
    res.json({ ok: true, url: meta.url }); });
}
