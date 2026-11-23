// The social layer for hosting with friends: friends, a feed with stories, alerts ("tell me about runs within 5 miles"),
// an inbox, kudos after each get-together, event profiles (what kind of guest and host someone is), the group chat,
// guests messaging the host (running late, give my slot away) and photos from the day.
import crypto from "node:crypto";
import express from "express";
import { scopeStore, getWorkspace, allWorkspaceIds, workspaceOfEvent, DEFAULT_WS, getDbUser } from "./workspaces.js";
import { emailConfig, sendEmail } from "./email.js";
import { smsConfig, sendSms } from "./sms.js";

const hash = (s) => crypto.createHash("sha256").update(String(s || "").trim().toLowerCase()).digest("hex").slice(0, 24);
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").trim().slice(0, n);
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const lc = (s) => String(s || "").trim().toLowerCase();
const DAY = 864e5;
const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
const PHONE_OK = (p) => /^\+?[0-9 ()-]{7,20}$/.test(String(p || "").trim());

// What an event is "about", for alerts, Discover and profiles.
export const LANES = { run: ["run", "5k", "jog"], hike: ["hike", "trail", "walk"], bike: ["bike", "cycle", "ride"], cook: ["cook", "dinner", "tasting", "dishes", "supper", "dinner party"], potluck: ["potluck"], games: ["game", "board game"], movie: ["movie", "film"], concert: ["concert", "gig", "show", "festival"], cafe: ["cafe", "café", "coffee", "matcha", "tea"], bake: ["bake", "cake", "giveaway", "cookie", "bread"], picnic: ["picnic", "bbq", "cookout"], book: ["book"], club: ["club", "meetup"] };
export function lanesOf(text) { const t = lc(text), L = Object.entries(LANES).filter(([, w]) => w.some((x) => t.includes(x))).map(([k]) => k); return L.length > 1 ? L.filter((k) => k !== "club") : L; }
const miles = (a, b) => { const R = 3958.8, r = (x) => (x * Math.PI) / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng), h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

/** "notify me whenever there's a run event happening within 5 miles away from me that is public" → a rule. */
export function parseAlert(text) {
  const t = lc(text), lanes = lanesOf(t), m = t.match(/(\d+(?:\.\d+)?)\s*(mi|mile|miles|km|kilomet(?:er|re)s?)\b/);
  const radiusMi = m ? (/^k/.test(m[2]) ? +m[1] * 0.621 : +m[1]) : /near me|nearby|close/.test(t) ? 5 : null;
  const free = /\bfree\b/.test(t), weekend = /weekend|saturday|sunday/.test(t) ? (/saturday/.test(t) && !/sunday/.test(t) ? "sat" : /sunday/.test(t) && !/saturday/.test(t) ? "sun" : "weekend") : "";
  const city = (String(text).match(/\bin ([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?)/) || [])[1] || "";
  const parts = [lanes.length ? lanes.join(" or ") + " events" : "any get-together", radiusMi ? `within ${Math.round(radiusMi * 10) / 10} miles` : city ? `in ${city}` : "near you", free ? "that are free" : "", weekend ? `on ${weekend === "sat" ? "Saturdays" : weekend === "sun" ? "Sundays" : "weekends"}` : "", "and open to the public"].filter(Boolean);
  return { lanes, radiusMi, city, free, weekend, publicOnly: true, summary: parts.join(", ").replace(/, and open/, " and open") };
}
export function alertMatches(a, ev, evGeo) {
  if (!ev?.discoverable) return false;
  const lanes = lanesOf(`${ev.activity || ""} ${ev.pubTitle || ""} ${ev.name || ""}`);
  if (a.lanes?.length && !a.lanes.some((l) => lanes.includes(l))) return false;
  if (a.free && !(ev.free || !ev.price)) return false;
  if (a.weekend && ev.date) { const d = new Date(ev.date + "T12:00:00").getDay(); if (a.weekend === "sat" ? d !== 6 : a.weekend === "sun" ? d !== 0 : d !== 0 && d !== 6) return false; }
  if (a.radiusMi && a.lat != null && evGeo?.lat != null) return miles(a, evGeo) <= a.radiusMi;
  const city = lc(a.city || a.homeCity); if (city) return lc(ev.city).includes(city) || lc(ev.hood).includes(city);
  return !a.radiusMi; // a distance rule needs a location on both sides
}

// ---- attendee and host traits ----
export const TRAITS = {
  host: { name: "The Host", emoji: "🏡", line: "Usually the one who makes it happen." },
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
export const VIBE_TAGS = [["spark", "⚡", "Brought energy"], ["chill", "🧘", "Easy company"], ["helper", "🙌", "Helped out"], ["welcome", "🤗", "Welcomed people"], ["contributor", "🧺", "Brought something great"]];

export function makeSocial(store, { C, saveBlob }) {
  const sys = (k) => store.get("system/" + k)?.data;
  const put = (k, v) => store.set("system/" + k, v);
  const userOf = (email) => getDbUser(lc(email));
  const handleOf = (email) => { const u = userOf(email); return u ? C.profileOf(u.ws)?.handle || null : null; };
  // ---- people: who a member is, by email ----
  function person(email) { const u = userOf(email); const p = u ? C.profileOf(u.ws) : null; return { email: lc(email), name: u?.name || p?.name || "", handle: p?.handle || null, emoji: p?.emoji || "🙂", color: p?.color || "#E26D8E", ws: u?.ws || null }; }
  function ensureProfile(u) {
    const cur = C.profileOf(u.ws); if (cur?.handle) return cur;
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
      for (const d of S.list("kudos")) kudos.push({ id: d.id, ws, ...d.data });
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
    for (const m of momentsSeen) if (lc(m.authorEmail) !== me) items.push({ kind: "moment", at: m.at, who: people.get(lc(m.authorEmail)) || person(m.authorEmail), media: { url: m.url, type: m.type }, caption: m.caption || "", event: evCard(I.events.get(m.eventId)) });
    for (const k of I.kudos) if (F.includes(lc(k.email)) && k.love && canSee(k.eventId) && k.at > recent) items.push({ kind: "kudos", at: k.at, who: people.get(lc(k.email)), love: k.love, tags: k.tags || [], event: evCard(I.events.get(k.eventId)) });
    const followedWs = []; for (const x of new Set([...I.events.values()].map((v) => v.ws))) if (C.followersOf(x).some((f) => f.email === me)) followedWs.push(x);
    for (const w of followedWs) { const hp = C.profileOf(w), hostP = { name: hp?.name || "", handle: hp?.handle, emoji: hp?.emoji || "🎉", color: hp?.color, email: getWorkspace(w)?.ownerEmail || "" };
      for (const x of I.events.values()) { if (x.ws !== w || !isPublic(x.e)) continue; if (F.includes(lc(x.owner))) continue;
        if ((x.e.date || "9") >= today()) items.push({ kind: "hosting", at: x.e.updatedAt || x.e.createdAt || now, who: hostP, event: evCard(x) });
        else if (Date.parse(x.e.date) > recent) { const K = I.kudos.filter((k) => k.eventId === x.id && k.love), n = [...I.att.values()].filter((L) => L.some((a) => a.eventId === x.id)).length; items.push({ kind: "recap", at: Date.parse(x.e.date) + 20 * 3600e3, who: hostP, event: evCard(x), count: n, love: K[0]?.love || "", kudos: K.length }); } } }
    items.sort((a, b) => b.at - a.at);
    // stories: one ring per friend (and you) with photos from the last week
    const ring = new Map(); for (const m of momentsSeen.filter((m) => m.at > now - 7 * DAY)) { const k = lc(m.authorEmail); if (!ring.has(k)) ring.set(k, []); ring.get(k).push({ url: m.url, type: m.type, caption: m.caption || "", at: m.at, event: evCard(I.events.get(m.eventId)) }); }
    const stories = [...ring].map(([e, L]) => ({ who: people.get(e) || person(e), items: L.sort((a, b) => a.at - b.at), mine: e === me })).sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || b.items.at(-1).at - a.items.at(-1).at);
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
    function why(k) { const obs = { host: hosted.length, spark: vibeN("spark"), chill: vibeN("chill"), filler: A.filter((a) => a.last || a.filler).length, early: A.filter((a) => a.early).length, connector: A.filter((a) => a.plusOne).length, contributor: A.filter((a) => a.slot).length + vibeN("contributor"), helper: vibeN("helper") }[k]; if (obs === 0) return "How they describe themselves. It firms up as they go to things."; return { host: `Hosted ${hosted.length} get-together${hosted.length === 1 ? "" : "s"}`, spark: `${vibeN("spark")} host${vibeN("spark") === 1 ? "" : "s"} said they brought energy`, chill: `${vibeN("chill")} host${vibeN("chill") === 1 ? "" : "s"} called them easy company`, filler: `Said yes in the last 48 hours ${A.filter((a) => a.last || a.filler).length} time${A.filter((a) => a.last || a.filler).length === 1 ? "" : "s"}`, early: `Among the first yeses ${A.filter((a) => a.early).length} time${A.filter((a) => a.early).length === 1 ? "" : "s"}`, connector: `Brought a friend ${A.filter((a) => a.plusOne).length} time${A.filter((a) => a.plusOne).length === 1 ? "" : "s"}`, contributor: `Brought something ${A.filter((a) => a.slot).length + vibeN("contributor")} time${A.filter((a) => a.slot).length + vibeN("contributor") === 1 ? "" : "s"}`, helper: `${vibeN("helper")} host${vibeN("helper") === 1 ? "" : "s"} said they helped out`, regular: `Went to ${n} get-togethers`, cheerleader: `Sent kudos ${given.length} time${given.length === 1 ? "" : "s"}` }[k] ; }
    const kinds = {}; for (const a of A) for (const l of lanesOf(`${I.events.get(a.eventId)?.e.activity || ""} ${I.events.get(a.eventId)?.e.name || ""}`)) kinds[l] = (kinds[l] || 0) + 1;
    return { attended: n, hosted: hosted.length, kudosGiven: given.length, traits, top: traits[0] || null, loves: Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => ({ kind: k, n: v })), self, built: !!Object.keys(self).length };
  }
  // ---- a host's strengths: what they host, what people say, the vibe ----
  function hostStrengths(ws) {
    const I = index(), ev = [...I.events.values()].filter((x) => x.ws === ws && x.e.date && x.e.date <= today() && x.e.stage !== "interest"), K = I.kudos.filter((k) => k.ws === ws).sort((a, b) => b.at - a.at);
    const kinds = {}; for (const x of ev) for (const l of lanesOf(`${x.e.activity || ""} ${x.e.name || ""}`)) kinds[l] = (kinds[l] || 0) + 1;
    const tags = {}; for (const k of K) for (const t of k.tags || []) tags[t] = (tags[t] || 0) + 1;
    const guests = new Set(); for (const [em, L] of I.att) if (L.some((a) => a.ws === ws)) guests.add(em);
    const returning = [...guests].filter((em) => (I.att.get(em) || []).filter((a) => a.ws === ws).length > 1).length;
    const tagList = Object.entries(tags).sort((a, b) => b[1] - a[1]).map(([t, n]) => { const T = KUDOS_TAGS.find((x) => x[0] === t); return { tag: t, emoji: T?.[1] || "✨", label: T?.[2] || t, n }; });
    const vibe = tagList.slice(0, 3).map((t) => t.label.toLowerCase());
    const tippers = K.filter((k) => k.tipped).length, hostedN = ev.filter((x) => x.e.casual && x.e.date && x.e.date <= today()).length;
    return { tippers, events: hostedN, kinds: Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([kind, n]) => ({ kind, n })), tags: tagList, vibe, guests: guests.size, returning, kudosCount: K.length,
      kudos: K.filter((k) => k.love || (k.tags || []).length).slice(0, 30).map((k) => ({ name: first(k.name) || "A guest", love: k.love || "", tags: k.tags || [], at: k.at, event: I.events.get(k.eventId)?.e?.pubTitle || I.events.get(k.eventId)?.e?.name || "" })),
      moments: I.moments.filter((m) => m.ws === ws && isPublic(I.events.get(m.eventId)?.e)).sort((a, b) => b.at - a.at).slice(0, 12).map((m) => ({ url: m.url, type: m.type, caption: m.caption || "" })) };
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
      if (notify(a.email, { kind: "alert", key: `alert-${a.id}-${id}`, text: `${title}${host?.name ? ` by ${host.name}` : ""}${e.date ? `, ${e.date}` : ""}. Matches "${a.summary}"`, link: `/g#rsvp-${id}`, eventId: id })) { n++;
        const cfg = canEmail(a.email) && emailConfig(DEFAULT_WS, true); if (cfg) sendEmail(cfg, { to: a.email, subject: `Something you'd like: ${title}`, text: `${title}${e.date ? ` on ${e.date}` : ""}${e.city ? ` in ${e.city}` : ""}.\n\nSay yes here: ${origin}/g#rsvp-${id}\n\nYou asked Encore: "${a.text}". Change your alerts at ${origin}/feed` }).catch(() => {}); } }
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
        mark("kudos-" + x.id); const cfg = emailConfig(x.ws, false) || emailConfig(DEFAULT_WS, true);
        for (const [em, L] of I.att) { if (!L.some((a) => a.eventId === x.id)) continue; out.kudosAsks++;
          notify(em, { kind: "kudos", key: "kudos-" + x.id, text: `How was ${title}? Send ${hostName} some kudos.`, link: `/g#rsvp-${x.id}`, eventId: x.id });
          if (cfg && canEmail(em)) sendEmail(cfg, { to: em, subject: `How was ${title}?`, text: `Hi ${first(L.find((a) => a.eventId === x.id)?.name) || "there"},\n\n${hostName} put ${title} together. Hosts rarely hear what landed, so two taps of kudos means a lot: ${origin}/g#rsvp-${x.id}\n\nYou can also tell them one thing for next time. Only they see that.`, fromName: host?.name || "" }).catch(() => {}); }
        notify(x.owner, { kind: "after", key: "after-" + x.id, text: `You hosted ${title}! Kudos are coming in. Upload a photo or two while it's fresh.`, link: "/#studio", eventId: x.id });
      }
      // prep alerts for the host (the shopping and baking checklist)
      for (const t of e.prep || []) { if (t.done || !t.due) continue; const dd = Math.round((Date.parse(t.due + "T09:00:00") - now) / DAY); if (dd > 0 || dd < -2) continue; const k = "prep-" + x.id + "-" + hash(t.text + t.due); if (done(k)) continue; mark(k); out.prepAlerts++;
        notify(x.owner, { kind: "prep", text: `${dd < 0 ? "Overdue" : "Today"} for ${title}: ${t.text}`, link: "/#studio", eventId: x.id });
        const cfg = emailConfig(x.ws, false) || emailConfig(DEFAULT_WS, true); if (cfg) sendEmail(cfg, { to: x.owner, subject: `${dd < 0 ? "Overdue" : "Today"}: ${t.text}`, text: `For ${title}${e.date ? ` on ${e.date}` : ""}:\n\n☐ ${t.text}\n\nTick it off in Encore: ${origin}/#studio` }).catch(() => {}); }
      // giveaways: text each pickup window an hour before
      if (sms && /giveaway/.test(e.activity || "") && e.date === today(now)) for (const d of S.list("rsvps")) { const r = d.data; if (r.eventId !== x.id || r.response !== "going" || !PHONE_OK(r.phone) || !r.slot) continue;
        const start = Date.parse(`${e.date}T${String(r.slot).match(/\d{1,2}:\d{2}/)?.[0]?.padStart(5, "0") || "00:00"}:00`), k = "sms-" + d.id; if (!(start - now <= 3600e3 && start - now > 0) || done(k)) continue; mark(k);
        const ok = await sendSms(sms, { to: r.phone, text: `Hi ${first(r.name)}! Your ${title} pickup is ${r.slot} at ${e.meetPoint || "the usual spot"}. Running late or can't come? ${origin}/g#rsvp-${x.id}` }); if (ok.ok) out.texts++; }
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
  return { recap, prefs, canEmail, person, ensureProfile, friendsOf, addFriend, dropFriend, notify, inbox, markRead, feed, eventProfile, hostStrengths, rsvpProof, alertsOf, saveAlerts, onEventChange, runJobs, bust, index, saveBlob, userOf };
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
    F.items = [...posts, ...(F.items || [])].sort((a, b) => (b.at || 0) - (a.at || 0)); res.json(F); });
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
    const mineEv = new Set((I.att.get(em) || []).map((a) => a.eventId)), co = new Map();
    for (const [other, L] of I.att) { if (other === em || F.has(other)) continue; const n = L.filter((a) => mineEv.has(a.eventId)).length; if (n) co.set(other, (co.get(other) || 0) + n); }
    for (const f of F) for (const ff of X.friendsOf(f)) { const o = lc(ff.email); if (o !== em && !F.has(o) && !co.has(o)) co.set(o, 0.5); }
    const people = [...co.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([o, n]) => { const p = X.person(o); return { key: Buffer.from(o).toString("base64url"), name: p.name || "Someone", emoji: p.emoji, color: p.color, why: n >= 1 ? `${Math.floor(n)} get-together${Math.floor(n) === 1 ? "" : "s"} together` : "Friend of a friend" }; }).filter((p) => p.name !== "Someone");
    const chats = []; for (const a of (I.att.get(em) || []).slice().sort((x, y) => (y.at || 0) - (x.at || 0))) { if (chats.length >= 6 || chats.some((c) => c.id === a.eventId)) continue; const x = I.events.get(a.eventId); if (!x) continue;
      let last = null; try { last = scopeStore(store, x.ws).list("chat").map((d) => d.data).filter((m) => m.eventId === a.eventId && !m.private && m.text).sort((p, q) => (q.at || 0) - (p.at || 0))[0]; } catch {}
      chats.push({ id: a.eventId, title: x.e.pubTitle || x.e.name || "Get-together", date: x.e.date || "", last: last ? `${String(last.name || "").split(" ")[0] || "Someone"}: ${clean(last.text, 80)}` : "", at: last?.at || 0 }); }
    res.json({ hosts, people, chats }); });
  app.get("/api/people", (req, res) => { const u = me(req, res); if (!u) return; const q = lc(req.query.q).replace(/^@/, ""); if (q.length < 2) return res.json({ people: [] });
    const out = []; for (const d of store.list("system")) { const w = d.data; if (w?.kind !== "workspace") continue; const h = C.profileOf(w.id); const p = X.person(w.ownerEmail); if (lc(w.ownerEmail) === lc(u.email)) continue; if ((h?.handle || "").includes(q) || lc(p.name).includes(q) || lc(w.ownerEmail) === q) out.push({ name: p.name, handle: h?.handle || null, emoji: h?.emoji || "🙂", color: h?.color, city: h?.city || "", email: lc(w.ownerEmail) === q ? lc(w.ownerEmail) : undefined, key: Buffer.from(lc(w.ownerEmail)).toString("base64url") }); if (out.length >= 12) break; }
    res.json({ people: out }); });
  const emailFromKey = (k) => { try { return Buffer.from(String(k || ""), "base64url").toString(); } catch { return ""; } };
  app.post("/api/me/friends", small, (req, res) => { const u = me(req, res); if (!u) return; const b = req.body || {}; let email = b.key ? emailFromKey(b.key) : ""; if (!email && b.handle) { const ws = C.wsOfHandle(String(b.handle).replace(/^@/, "")); email = ws ? getWorkspace(ws)?.ownerEmail : ""; }
    if (!email || !X.userOf(email)) return bad(res, "No member by that name.", 404, "not_found"); if (lc(email) === lc(u.email)) return bad(res, "That's you!"); X.addFriend(u.email, email); res.json({ ok: true, friend: X.person(email) }); });
  app.delete("/api/me/friends/:key", (req, res) => { const u = me(req, res); if (!u) return; X.dropFriend(u.email, emailFromKey(req.params.key)); res.json({ ok: true }); });
  // inbox
  app.get("/api/me/inbox", (req, res) => { const u = me(req, res); if (!u) return; res.json({ items: X.inbox(u.email).slice(0, 60) }); });
  app.post("/api/me/inbox/read", small, (req, res) => { const u = me(req, res); if (!u) return; X.markRead(u.email); res.json({ ok: true }); });
  // alerts in plain words
  app.get("/api/me/alerts", (req, res) => { const u = me(req, res); if (!u) return; res.json({ alerts: X.alertsOf(u.email) }); });
  app.post("/api/me/alerts", small, (req, res) => { const u = me(req, res); if (!u) return; const b = req.body || {}, text = clean(b.text, 300); if (text.length < 4) return bad(res, "Tell Pip what you'd like to hear about.");
    const rule = parseAlert(text), geo = Number.isFinite(+b.lat) && Number.isFinite(+b.lng) && b.lat !== null && b.lng !== null && b.lat !== "" ? { lat: Math.round(+b.lat * 100) / 100, lng: Math.round(+b.lng * 100) / 100 } : {};
    if (rule.radiusMi && geo.lat == null && !rule.city && !clean(b.city, 60)) return bad(res, "Pip needs your location for a distance. Allow location, or say a city (\"in Austin\").", 400, "need_location");
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
  app.post("/api/public/kudos", small, (req, res) => { if (limited(req, 20)) return bad(res, "Slow down.", 429, "rate_limited"); const b = req.body || {}, P = X.rsvpProof(clean(b.eventId, 80), b.rid, b.code);
    if (!P) return bad(res, "Kudos come from people who RSVP'd. Open the link from your invite on the phone you used.", 403, "not_granted");
    if ((P.ev?.date || "9") > today()) return bad(res, "Kudos open once it's happened.");
    const tags = (Array.isArray(b.tags) ? b.tags : []).filter((t) => KUDOS_TAGS.some((k) => k[0] === t)).slice(0, 8), love = clean(b.love, 500), improve = clean(b.improve, 500);
    if (!tags.length && !love) return bad(res, "Pick at least one thing you liked.");
    P.S.set("kudos/" + P.rid, { eventId: P.r.eventId, rid: P.rid, name: P.r.name || "", email: lc(P.r.email), tags, love, improve, ...(["better", "same", "less"].includes(b.compare) ? { compare: b.compare } : {}), ...(P.S.get("kudos/" + P.rid)?.data?.tipped ? { tipped: true, tip: P.S.get("kudos/" + P.rid).data.tip } : {}), at: Date.now() }); X.bust();
    const W = getWorkspace(P.ws); X.notify(W?.ownerEmail, { kind: "kudos-in", text: `${first(P.r.name) || "A guest"} sent kudos for ${P.ev?.pubTitle || P.ev?.name}${love ? `: "${love.slice(0, 80)}"` : ""} ${tags.map((t) => KUDOS_TAGS.find((k) => k[0] === t)[1]).join("")}`, link: "/#studio", eventId: P.r.eventId });
    const h = C.profileOf(P.ws); res.json({ ok: true, host: h?.handle ? { handle: h.handle, name: h.name } : null }); });
  app.get("/api/host/kudos/:eventId", (req, res) => { const u = me(req, res); if (!u) return; const S = scopeStore(store, u.ws), id = clean(req.params.eventId, 80); res.json({ kudos: S.list("kudos").map((d) => d.data).filter((k) => k.eventId === id).sort((a, b) => b.at - a.at), vibes: S.list("vibes").map((d) => d.data).filter((v) => v.eventId === id) }); });
  app.post("/api/host/vibes", small, (req, res) => { const u = me(req, res); if (!u) return; const b = req.body || {}, S = scopeStore(store, u.ws), id = clean(b.eventId, 80); if (!S.get("events/" + id)) return bad(res, "No such event.", 404, "not_found");
    const email = lc(clean(b.email, 200)), tags = (Array.isArray(b.tags) ? b.tags : []).filter((t) => VIBE_TAGS.some((k) => k[0] === t)); if (!email) return bad(res, "Which guest?");
    S.set("vibes/" + id + "--" + hash(email), { eventId: id, email, tags, at: Date.now() }); X.bust(); if (tags.length) X.notify(email, { kind: "vibe", key: `vibe-${id}-${tags.join()}`, text: `${first(u.name)} says you ${tags.map((t) => VIBE_TAGS.find((k) => k[0] === t)[2].toLowerCase()).join(" and ")} at ${S.get("events/" + id).data.pubTitle || S.get("events/" + id).data.name} ${tags.map((t) => VIBE_TAGS.find((k) => k[0] === t)[1]).join("")}`, link: "/feed" }); res.json({ ok: true }); });
  // the event FAQ: guests ask and upvote; the host answers and publishes. Only published answers are public.
  const faqOf = (S, id) => S.list("faq").map((d) => ({ key: d.id, ...d.data })).filter((q) => q.eventId === id);
  const faqView = (q) => ({ id: q.key, q: q.q, a: q.a || "", votes: q.votes || 0, by: q.by || "", host: !!q.fromHost, at: q.at });
  app.get("/api/public/faq/:eventId", (req, res) => { const id = clean(req.params.eventId, 80), ws = workspaceOfEvent(id); if (!ws) return bad(res, "No such event.", 404, "not_found"); const L = faqOf(scopeStore(store, ws), id);
    res.json({ published: L.filter((q) => q.status === "published").sort((a, b) => (b.votes || 0) - (a.votes || 0) || a.at - b.at).map(faqView), waiting: L.filter((q) => q.status === "pending").length }); });
  app.post("/api/public/faq/:eventId", small, (req, res) => { if (limited(req, 8)) return bad(res, "That's a lot of questions. Try again in a bit.", 429, "rate_limited"); const id = clean(req.params.eventId, 80), ws = workspaceOfEvent(id); if (!ws) return bad(res, "No such event.", 404, "not_found");
    const q = clean(req.body?.q, 300); if (q.length < 5) return bad(res, "Ask a whole question."); const S = scopeStore(store, ws), ev = S.get("events/" + id)?.data;
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
    const arche = (email) => { try { const t = email ? X.eventProfile(email)?.top : null; return t ? { name: t.name, emoji: t.emoji } : { name: "The Explorer", emoji: "🧭" }; } catch { return { name: "The Explorer", emoji: "🧭" }; } };
    for (const d of S.list("rsvps")) { const r = d.data || {}; const yes = r.response === "going" || (ev.stage === "interest" && r.interest === "in"); if (r.eventId !== id || !yes) continue; const k = lc(r.email || r.name || d.id); if (seen.has(k)) continue; seen.add(k); total += 1 + (r.plusOne ? 1 : 0); if (r.showMe === false) continue;
      out.push({ name: short(r.name), archetype: arche(lc(r.email)), fact: clean(r.funFact, 120), emoji: r.emoji || "", you: d.id === String(req.query.rid || ""), plus: !!r.plusOne, ...(r.email ? { key: hash(lc(r.email)) } : {}) }); }
    for (const g of ev.guests || []) { if (!/^(Going|Attended)$/.test(g.status || "")) continue; const k = lc(g.email || g.name); if (!k || seen.has(k)) continue; seen.add(k); total++; out.push({ name: short(g.name), archetype: arche(lc(g.email)), fact: "" }); }
    res.json({ attendees: out.slice(0, 40), count: total, seats: +ev.headcount || 0 }); });
  // a guest's card, opened from Who's coming: only for people who chose to be shown, never their email
  app.get("/api/public/person/:eventId/:key", (req, res) => { const id = clean(req.params.eventId, 80), key = clean(req.params.key, 40), ws = workspaceOfEvent(id); if (!ws) return bad(res, "No such event.", 404, "not_found");
    const S = scopeStore(store, ws), ev = S.get("events/" + id)?.data; if (!ev || ev.example || ev.hideGuests) return bad(res, "Not shown.", 404, "not_found");
    const d = S.list("rsvps").find((x) => x.data?.eventId === id && x.data?.email && hash(lc(x.data.email)) === key && x.data.showMe !== false); if (!d) return bad(res, "Not shown.", 404, "not_found");
    const r = d.data, em = lc(r.email), w = String(r.name || "").trim().split(/\s+/).filter(Boolean), name = w.length ? w[0] + (w[1] ? " " + w[1][0].toUpperCase() + "." : "") : "Guest";
    let P = {}; try { P = X.eventProfile(em) || {}; } catch {}
    const top = P.top ? { name: P.top.name, emoji: P.top.emoji, line: P.top.line } : { name: "The Explorer", emoji: "🧭", line: "Tries anything once. New neighborhood, new crowd." };
    const pp = X.person(em), prof = pp?.ws ? C.profileOf(pp.ws) : null, SOC = /instagram|tiktok|x\.com|twitter|threads|linkedin|strava|substack|youtube|bsky|facebook/i;
    const socials = (prof?.links || []).filter((l) => l?.url && SOC.test(l.url)).slice(0, 4).map((l) => ({ label: clean(l.label, 30) || new URL(l.url).hostname.replace(/^www\./, ""), url: l.url }));
    const I = X.index(), kud = I.kudos.filter((k) => lc(k.email) === em && k.love).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 2).map((k) => ({ love: clean(k.love, 160), event: I.events.get(k.eventId)?.e?.pubTitle || I.events.get(k.eventId)?.e?.name || "" }));
    const LANE = { move: "moving (runs, hikes, walks)", make: "making and tasting things", gather: "long dinners and good conversation", discover: "trying new places" };
    const loves = (P.loves || []).map((l) => LANE[l.kind] || l.kind).slice(0, 2);
    let mutual = []; const u = currentUser(req); if (u?.email && lc(u.email) !== em) { const mine = new Set(X.friendsOf(u.email).map((f) => lc(f.email))); mutual = X.friendsOf(em).filter((f) => mine.has(lc(f.email))).map((f) => (X.person(f.email)?.name || "").split(/\s+/)[0]).filter(Boolean); }
    const first = w[0] || "They", n = P.attended || 0;
    const take = [`${first} is ${/^the /i.test(top.name) ? top.name.replace(/^The /, /^The [AEIOU]/i.test(top.name) ? "an " : "a ") : top.name}${n ? `, with ${n} get-together${n === 1 ? "" : "s"} on Encore` : ", new to Encore"}.`, loves.length ? `Usually found at ${loves.join(" and ")}.` : "", P.hosted ? `Has hosted ${P.hosted} too.` : "", r.funFact ? `Fun fact: ${clean(r.funFact, 120)}` : ""].filter(Boolean).join(" ");
    res.json({ name, emoji: r.emoji || top.emoji, archetype: top, traits: (P.traits || []).slice(0, 3).map((t) => ({ name: t.name, emoji: t.emoji })), fact: clean(r.funFact, 160), attended: n, hosted: P.hosted || 0, kudos: kud, socials, mutual: { count: mutual.length, names: mutual.slice(0, 3) }, signedIn: !!u?.email, take, page: prof?.handle && pp?.ws ? "/@" + prof.handle : "" }); });
  // ---- RSVP by text: the host texts the invite; guests reply YES, MAYBE or NO (SMS or WhatsApp through the same number) ----
  const normPhone = (p) => { const raw = String(p || "").replace(/^whatsapp:/i, ""), d = raw.replace(/[^\d+]/g, ""); return d.startsWith("+") ? d : d.length === 10 ? "+1" + d : d.length === 11 && d.startsWith("1") ? "+" + d : d ? "+" + d : ""; };
  const prettyTime = (t) => { const m = String(t || "").match(/^(\d{1,2}):(\d{2})/); if (!m) return ""; let h = +m[1]; const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return `${h}:${m[2]}${ap}`; };
  const whenOf = (e) => [e.date ? new Date(e.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "", prettyTime(e.startTime)].filter(Boolean).join(" at ");
  app.post("/api/host/text-invites", small, async (req, res) => { const u = me(req, res); if (!u) return; if (limited(req, 10)) return bad(res, "Slow down.", 429, "rate_limited");
    const S = scopeStore(store, u.ws), id = clean(req.body?.eventId, 80), ev = S.get("events/" + id)?.data; if (!ev) return bad(res, "No such event.", 404, "not_found");
    const phones = [...new Set((Array.isArray(req.body?.phones) ? req.body.phones : String(req.body?.phones || "").split(/[,\n;]+/)).map(normPhone).filter((p) => /^\+\d{7,16}$/.test(p)))].slice(0, 40);
    if (!phones.length) return bad(res, "Add at least one phone number.");
    const cfg = smsConfig(), title = ev.pubTitle || ev.name || "a get-together", host = first(u.name) || "Your friend", link = `${publicOrigin(req)}/g#rsvp-${id}`, out = [];
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
    if (/^(stop|unsubscribe|cancel|end|quit)$/.test(word)) { store.set("system/smsstop-" + hash(from), { phone: from, at: Date.now() }); return twiml(res, ""); }
    // the most recent upcoming invite or RSVP for this number
    let best = null; for (const ws of allWorkspaceIds()) { const S = scopeStore(store, ws); for (const d of [...S.list("textinvites"), ...S.list("rsvps")]) { const x = d.data || {}; if (normPhone(x.phone) !== from) continue; const ev = S.get("events/" + x.eventId)?.data; if (!ev || (ev.date && ev.date < today)) continue; const at = x.changedAt || x.at || 0; if (!best || at > best.at) best = { ws, S, ev, eventId: x.eventId, at }; } }
    if (!best) return twiml(res, "Hi! This is Encore. We couldn't find an invite for this number. Open the link your host sent to RSVP.");
    const { S, ev, eventId } = best, title = ev.pubTitle || ev.name || "the get-together", link = `${publicOrigin(req)}/g#rsvp-${eventId}`;
    const mine = S.list("rsvps").find((d) => d.data?.eventId === eventId && normPhone(d.data?.phone) === from);
    const resp = /^(yes|y|yep|yeah|yup|in|going|sure|ok|okay|absolutely|totally)$/.test(word) || /^(👍|✅|🙌)/u.test(body) ? "going" : /^(maybe|m|perhaps|possibly|prob|probably)$/.test(word) ? "maybe" : /^(no|n|nope|out|cant|can't|sorry|pass)$/.test(word) ? "no" : null;
    if (!resp) { // a name, after they said yes
      if (mine && /^Guest/.test(mine.data.name || "") && body.length >= 2 && body.length <= 40) { S.update("rsvps/" + mine.id, { name: clean(body, 60), changedAt: Date.now() }); return twiml(res, `Thanks, ${first(body)}! You're on the list for ${title}. Who's coming and the group chat: ${link}`); }
      return twiml(res, `Reply YES, MAYBE or NO for ${title}${whenOf(ev) ? ` (${whenOf(ev)})` : ""}. Details: ${link}`); }
    const want = resp === "going" && ev.approvalRequired ? "requested" : resp; const going = S.list("rsvps").filter((d) => d.data?.eventId === eventId && d.data?.response === "going").length, cap = +ev.headcount || 0;
    const final = want === "going" && cap && going >= cap && !(mine?.data?.response === "going") ? "waitlist" : want;
    let rid = mine?.id, code = mine?.data?.code; const name = mine?.data?.name || `Guest ${from.slice(-4)}`;
    if (mine) S.update("rsvps/" + rid, { response: final, changedAt: Date.now(), via: "text" }); else { code = crypto.randomBytes(6).toString("hex"); const r0 = S.add("rsvps", { eventId, name, phone: from, response: final, code, via: from.length ? "text" : "", at: Date.now(), changedAt: Date.now(), showMe: true }); rid = r0.id; }
    try { X.bust(); } catch {}
    const pass = `${publicOrigin(req)}/g?r=${encodeURIComponent(rid)}.${encodeURIComponent(code)}#rsvp-${eventId}`, askName = /^Guest/.test(name) ? " Reply with your name so your host knows it's you." : "";
    const msg = final === "going" ? `You're in for ${title}${whenOf(ev) ? `, ${whenOf(ev)}` : ""}! 🎉 See who's coming and join the group chat: ${pass}${askName}` : final === "requested" ? `Got it! Your host approves each spot and will text you soon. ${pass}${askName}` : final === "waitlist" ? `It's full right now, so you're on the waitlist. We'll text you if a spot opens. ${pass}` : final === "maybe" ? `Marked you as maybe. Reply YES any time to grab a spot. ${pass}` : `No worries, we'll tell your host. Reply YES if plans change.`;
    return twiml(res, msg); });
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
    const patch = {}; if (b.funFact != null) patch.funFact = clean(b.funFact, 120); if (b.showMe != null) patch.showMe = !!b.showMe; if (b.emoji != null) patch.emoji = [...String(b.emoji)].slice(0, 2).join("").slice(0, 8); P.S.update("rsvps/" + String(b.rid).replace(/[^A-Za-z0-9_-]/g, ""), patch); res.json({ ok: true }); });
  // who's going: for guests who are going (approved, on approval events), first names and an initial only
  app.get("/api/public/going/:eventId", (req, res) => { const P = X.rsvpProof(req.params.eventId, req.query.rid, req.query.code); if (!P || P.r.response !== "going") return bad(res, P?.r.response === "requested" ? "You'll see who's going once the host approves you." : "Say yes to see who's going.", 403, "not_granted");
    const id = P.r.eventId, short = (n) => { const w = String(n || "").trim().split(/\s+/).filter(Boolean); return w.length ? w[0] + (w[1] ? " " + w[1][0].toUpperCase() + "." : "") : "Guest"; }, seen = new Set(), out = [];
    for (const d of P.S.list("rsvps")) { const r = d.data || {}; if (r.eventId !== id || r.response !== "going") continue; const k = lc(r.email || r.name || d.id); if (seen.has(k)) continue; seen.add(k); out.push({ name: short(r.name), you: d.id === P.rid, plus: !!r.plusOne }); }
    for (const g of P.ev?.guests || []) { if (!/^(Going|Attended)$/.test(g.status || "")) continue; const k = lc(g.email || g.name); if (!k || seen.has(k)) continue; seen.add(k); out.push({ name: short(g.name), you: false }); }
    const total = out.length + out.filter((x) => x.plus).length, seats = +P.ev?.headcount || 0;
    res.json({ going: out, count: total, seats, left: seats ? Math.max(0, seats - total) : null }); });
  // the group chat: guests who RSVP'd (or are interested) and the host; giveaway messages are private to the host
  const chatList = (S, eventId, viewerRid) => S.list("chat").map((d) => ({ id: d.id, ...d.data })).filter((m) => m.eventId === eventId && (!m.private || m.rid === viewerRid || viewerRid === "host")).sort((a, b) => a.at - b.at).slice(-200).map(({ rid, email, ...m }) => ({ ...m, mine: viewerRid !== "host" && rid === viewerRid, ...(m.poll ? { poll: { ...m.poll, votes: Object.fromEntries(Object.entries(m.poll.votes || {}).map(([o, L]) => [o, L.map((v) => v.name)])), myVotes: Object.entries(m.poll.votes || {}).filter(([, L]) => L.some((v) => v.rid === viewerRid)).map(([o]) => o) } } : {}) }));
  app.get("/api/public/chat/:eventId", (req, res) => { const P = X.rsvpProof(req.params.eventId, req.query.rid, req.query.code); if (!P || P.r.response !== "going") return bad(res, P?.r.response === "requested" ? "The chat opens once the host approves you." : "The chat opens once you've said yes.", 403, "not_granted"); res.json({ messages: chatList(P.S, P.r.eventId, P.rid), getThere: P.ev?.getThere || [], private: /giveaway/.test(P.ev?.activity || "") }); });
  app.post("/api/public/chat/:eventId", small, (req, res) => { if (limited(req, 60)) return bad(res, "Slow down.", 429, "rate_limited"); const b = req.body || {}, P = X.rsvpProof(req.params.eventId, b.rid, b.code); if (!P || P.r.response !== "going") return bad(res, "The chat opens once you've said yes.", 403, "not_granted");
    const kind = ["late", "release", "text"].includes(b.kind) ? b.kind : "text", text = clean(b.text, 600), give = /giveaway/.test(P.ev?.activity || "");
    if (kind === "text" && !text) return bad(res, "Say something first.");
    const body = kind === "late" ? `Running late${text ? `: ${text}` : ""}` : kind === "release" ? `Can't make it. Please give my ${give ? "slice" : "spot"} to someone else.${text ? ` ${text}` : ""}` : text;
    P.S.add("chat", { eventId: P.r.eventId, rid: P.rid, by: first(P.r.name) || "Guest", role: "guest", kind, text: body, private: give || kind !== "text", at: Date.now() });
    if (kind === "release") { P.S.set("rsvps/" + P.rid, { ...P.r, response: "no", releasedAt: Date.now(), changedAt: Date.now() }); }
    const W = getWorkspace(P.ws); X.notify(W?.ownerEmail, { kind: "msg", text: `${first(P.r.name)}: ${body.slice(0, 120)}`, link: "/#studio", eventId: P.r.eventId });
    res.json({ ok: true, released: kind === "release" }); });
  app.get("/api/host/chat/:eventId", (req, res) => { const u = me(req, res); if (!u) return; const S = scopeStore(store, u.ws), id = clean(req.params.eventId, 80); if (!S.get("events/" + id)) return bad(res, "No such event.", 404, "not_found");
    const R = S.list("rsvps").map((d) => ({ id: d.id, ...d.data })).filter((r) => r.eventId === id); res.json({ messages: chatList(S, id, "host"), phones: R.filter((r) => r.response === "going" && r.phone).map((r) => ({ name: r.name, phone: r.phone, slot: r.slot || "" })), sms: !!smsConfig() }); });
  app.post("/api/host/chat/:eventId", small, async (req, res) => { const u = me(req, res); if (!u) return; const S = scopeStore(store, u.ws), id = clean(req.params.eventId, 80), ev = S.get("events/" + id)?.data; if (!ev) return bad(res, "No such event.", 404, "not_found");
    const text = clean(req.body?.text, 600); if (!text) return bad(res, "Say something first."); S.add("chat", { eventId: id, by: first(u.name) || "Host", role: "host", text, private: false, pinned: !!req.body?.pinned, at: Date.now() });
    let texted = 0; const hr = new Date().getHours(); if (req.body?.sms && smsConfig() && (hr >= 21 || hr < 8) && !req.body?.anyway) return res.status(409).json({ code: "quiet_hours", message: "It's late, so Pip held the text. Send it in the morning, or tap again to send anyway." });
    if (req.body?.sms && smsConfig()) { const slot = clean(req.body?.slot, 40); for (const d of S.list("rsvps")) { const r = d.data; if (r.eventId === id && r.response === "going" && PHONE_OK(r.phone) && (!slot || r.slot === slot)) { const ok = await sendSms(smsConfig(), { to: r.phone, text: `${first(u.name)} (${ev.pubTitle || ev.name}): ${text}` }); if (ok.ok) texted++; } } }
    res.json({ ok: true, texted }); });
  // interest check → it's on: tell everyone who said they were in or maybe
  // interest check → it's on: tell everyone who said they were in or maybe (the host's button, or Pip on its own)
  async function itsOn({ ws, id, hostName, origin }) { const S = scopeStore(store, ws), ev = S.get("events/" + id)?.data; if (!ev) return null; const u = { name: hostName, ws };
    const R = S.list("rsvps").map((d) => ({ ...d.data, _id: d.id })).filter((r) => r.eventId === id && ["in", "maybe"].includes(r.interest)), link = `${origin}/g#rsvp-${id}`, title = ev.pubTitle || ev.name, when = ev.date ? new Date(ev.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }) : "soon";
    const cfg = emailConfig(u.ws, false) || emailConfig(DEFAULT_WS, true), sms = smsConfig(); let told = 0, texted = 0, confirmed = 0;
    // people who said "I'm in" for the date that won are in: no second tap needed. Maybes, and people who picked other dates, are asked to lock in.
    for (const r of R) { const fits = r.interest === "in" && (!(r.dates || []).length || !ev.date || (r.dates || []).includes(ev.date)); r._in = fits && r.response !== "going"; if (fits && r.response !== "going" && r.response !== "requested") { S.update("rsvps/" + r._id, { response: ev.approvalRequired ? "requested" : "going", changedAt: Date.now(), autoConfirmed: true }); if (!ev.approvalRequired) confirmed++; } }
    for (const r of R) { let ok = false; if (r.email && cfg) { const e1 = await sendEmail(cfg, { to: r.email, subject: `It's on: ${title}, ${when}`, text: r._in && !ev.approvalRequired ? `Hi ${first(r.name) || "there"},\n\nEnough of you were in, so ${title} is happening on ${when}. You said you're in, so you're on the list.\n\nThe group chat and the getting-there plan are here: ${link}\n\nCan't make it after all? Say so on that page so someone else can have your spot.` : `Hi ${first(r.name) || "there"},\n\nEnough of you were in, so ${title} is happening on ${when}.\n\nLock in your spot: ${link}\n\nThe group chat and the getting-there plan are on that page once you say yes.`, fromName: u.name }).catch(() => ({})); ok = !!e1.ok; }
      if (sms && PHONE_OK(r.phone)) { const t = await sendSms(sms, { to: r.phone, text: r._in && !ev.approvalRequired ? `It's on! ${title}, ${when}. You're on the list: ${link}` : `It's on! ${title}, ${when}. Lock in your spot: ${link}` }); if (t.ok) { texted++; ok = true; } } if (r.email) X.notify(r.email, { kind: "itson", key: "itson-" + id, text: r._in && !ev.approvalRequired ? `It's on: ${title}, ${when}. You're on the list.` : `It's on: ${title}, ${when}. Lock in your spot.`, link: `/g#rsvp-${id}`, eventId: id }); if (ok || r.email) told++; }
    S.add("chat", { eventId: id, by: first(u.name) || "Host", role: "host", text: `It's on: ${when}! ${confirmed ? `${confirmed} ${confirmed === 1 ? "person is" : "people are"} already on the list. ` : ""}Not sure yet? Say yes on the invite to lock in your spot.`, private: false, pinned: true, at: Date.now() });
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
    const meta = await X.saveBlob(body, ct, ws); { const I = X.index(), evT = I.events.get(id)?.e; for (const [em, L] of I.att) if (em !== email && L.some((a) => a.eventId === id)) X.notify(em, { kind: "photos", key: `ph-${id}-${new Date().toISOString().slice(0, 13)}`, text: `📸 New photos from ${evT?.pubTitle || evT?.name || "your get-together"}${name ? `, from ${first(name)}` : ""}`, link: `/g#rsvp-${id}`, eventId: id }); }
    scopeStore(store, ws).add("moments", { eventId: id, authorEmail: email, authorName: name, url: meta.url, type: ct.startsWith("video") ? "video" : "image", caption: clean(req.query.caption, 200), at: Date.now() }); X.bust();
    res.json({ ok: true, url: meta.url }); });
}
