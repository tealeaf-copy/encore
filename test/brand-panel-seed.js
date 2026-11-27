// On top of the brand Insights world (test/brand-intel-seed.js): briefs, host-sourced seats, surveys, connections,
// target accounts, follow-up tasks, a pilot, and a second invented brand whose past events give the pooled outcome
// recommendations enough events to clear the privacy floor. Tests and screenshots only, always in a temp store.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { seedBrandIntel } from "./brand-intel-seed.js";

const J = { "content-type": "application/json" };
async function call(base, method, p, body, cookie) { const r = await fetch(base + p, { method, headers: { ...J, ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); assert.ok(r.ok, `${method} ${p}: ${r.status} ${t.slice(0, 300)}`); return t ? JSON.parse(t) : {}; }
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const weekdayAfter = (n) => { for (let i = n; i < n + 14; i++) { const d = day(i), w = new Date(d + "T12:00:00Z").getUTCDay(); if (w >= 1 && w <= 5) return d; } return day(n); };
const tok = () => crypto.randomBytes(12).toString("hex");
function rng(seed = 5) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

export async function seedBrandPanel(base, store, opts = {}) {
  const S = await seedBrandIntel(base, store, opts), R = rng(23), O = S.owner.c;
  const evKey = (id) => "system/bpev-" + id, get = (id) => store.get(evKey(id))?.data;
  const write = (id, f) => { const cur = get(id) || { kind: "bpev", reqId: id, brief: null, owner: null, changes: [], confirm: null, hostSeats: [], survey: { tokens: {}, responses: {} }, connections: [], timeline: [] }; f(cur); cur.updatedAt = Date.now(); store.set(evKey(id), cur); };
  // briefs on Fernwood's campaign events, agreed by both sides
  const B = S.bookings, briefs = { b1: ["customer", "roundtable", 12, 4], b2: ["customer", "roundtable", 14, 4], b3: ["community", "competition", 16, 8], b4: ["workshop", "class", 10, 2], b7: ["customer", "introductions", 14, 0], b8: ["customer", "roundtable", 12, 0] };
  for (const [k, [goal, together, brand, host]] of Object.entries(briefs)) { await call(base, "POST", `/api/teams/events/${B[k]}/brief`, { goal, together, mix: { brand, host }, plan: together === "roundtable" ? "Three tables of six, one question for each course." : "", photos: "consent", followup: "consented" }, O);
    const H = S.hosts.find((h) => h.handle === store.get("system/bbreq-" + B[k]).data.handle); if (!["b5", "b6"].includes(k)) await call(base, "POST", `/api/bb/host/events/${B[k]}/brief`, {}, H.c).catch(() => {}); }
  // host-sourced seats and the survey on the two past campaign dinners
  const C1 = store.get("system/camp-" + S.campaigns.C1).data;
  for (const k of ["b1", "b2"]) { const id = B[k], hostSeats = [];
    for (let i = 0; i < 4; i++) { const p = S.people[(k === "b1" ? 3 : 40) + i]; hostSeats.push({ id: crypto.randomBytes(4).toString("hex"), name: p.name, email: p.email, follower: i < 3, returning: i === 0, checkedIn: i < 3, at: Date.now() }); }
    write(id, (ev) => { ev.hostSeats = hostSeats; ev.confirm = { capacity: store.get("system/bbreq-" + id).data.headcount, hostSeats: 4, note: "", at: Date.now() - 30 * 864e5 };
      const T = ev.survey.tokens, A = ev.survey.responses, mine = C1.guests.filter((g) => g.event === id && g.checkedIn);
      mine.forEach((g, i) => { const t = tok(); T[t] = { side: "brand", gid: g.id, cid: C1.id, first: g.name.split(" ")[0], email: g.email }; store.set("system/bpsv-" + t, { kind: "bpsv", reqId: id });
        if (i % 4 !== 3) A[t] = { useful: R() < 0.7, back: R() < 0.85, before: 3, after: 4, said: "", quoteOk: false, matchOk: false, company: "", contactOk: R() < 0.4, followHost: R() < 0.3, nextOk: R() < 0.35, listed: R() < 0.6, contact: "", at: Date.now() }; });
      hostSeats.filter((s) => s.checkedIn).forEach((s, i) => { const t = tok(); T[t] = { side: "host", sid: s.id, first: s.name.split(" ")[0], email: s.email }; store.set("system/bpsv-" + t, { kind: "bpsv", reqId: id });
        A[t] = { useful: true, back: true, before: null, after: null, said: i === 0 ? "I came with the host's crowd and left with two people I'll call next week." : "", quoteOk: i === 0, matchOk: i < 2, company: i === 0 ? "Larkspur Systems" : i === 1 ? "Northpine Data" : "", contactOk: i === 0, followHost: true, nextOk: true, listed: true, contact: "", at: Date.now() }; });
      const listed = Object.keys(A).filter((t) => A[t].listed); for (let i = 0; i + 1 < listed.length; i += 2) ev.connections.push({ id: crypto.randomBytes(4).toString("hex"), a: listed[i], b: listed[i + 1], aYes: true, bYes: i % 4 === 0 ? true : null, at: Date.now() }); }); }
  // target accounts, tasks, a meeting and an opportunity, a pilot
  await call(base, "POST", `/api/campaigns/${S.campaigns.C1}/targets`, { targets: ["Larkspur Systems", "Tidewater Labs", "Brightline Cloud", "Quarry Data", "Halcyon Systems", "Northpine Data", "Kestrel Labs", "Juniper Cloud", "Waypoint Data", "Orchard Systems", "Beacon Cloud", "Fieldstone Labs"] }, O);
  await call(base, "POST", `/api/campaigns/${S.campaigns.C1}/tasks`, { title: "Send the roundtable notes to everyone who asked", team: "content", owner: S.editor.email, due: day(3), event: B.b1 }, O);
  await call(base, "POST", `/api/campaigns/${S.campaigns.C1}/tasks`, { title: "Book a demo with Larkspur's platform team", team: "sales", owner: S.owner.email, due: day(-2), status: "done", result: "useful", event: B.b1 }, O);
  await call(base, "POST", `/api/campaigns/${S.campaigns.C1}/outcomes`, { kind: "meeting", account: "Larkspur Systems", event: B.b1 }, O);
  await call(base, "POST", `/api/campaigns/${S.campaigns.C1}/outcomes`, { kind: "opportunity", account: "Larkspur Systems", amount: 48000, event: B.b1 }, O);
  await call(base, "POST", `/api/campaigns/${S.campaigns.C1}/pilot`, { label: "Our agency process last spring", baseline: { planningHours: 22, approvalSteps: 5, attendance: 31, daysToList: 12 }, ours: { planningHours: 6 } }, O);
  await call(base, "POST", `/api/campaigns/${S.campaigns.C1}/invite-from`, { name: "Maya Lindqvist", title: "Head of field marketing", note: "We're keeping it small: twelve engineers, one long table, no slides. I'd love you to come." }, O);
  { const c = store.get("system/camp-" + S.campaigns.C1).data, d1 = store.get("system/bbreq-" + B.b1).data.date; c.firstListAt = Date.parse(d1 + "T12:00:00Z") + 2 * 864e5; store.set("system/camp-" + c.id, c); } // the list went to sales two days after the first dinner
  // setup time on the campaign's bookings, falling on repeats
  [[B.b1, 1260], [B.b2, 540], [B.b3, 300], [B.b4, 240]].forEach(([id, sec]) => write(id, (ev) => { ev.setupSec = sec; }));
  // ---- a second invented brand, Juniper Health, with past dinners, roundtables and game nights and their surveys ----
  const jb = await fetch(base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name: "Ola Brennan", email: "ola@juniper.example", password: "long-password-1", mode: "work", company: "Juniper Health", city: "New York" }) });
  const JC = jb.headers.get("set-cookie").split(";")[0], pool = S.people.filter((p) => p.city === "New York" && p.include);
  const plan = [["long-table", "roundtable", 6, 0.8], ["dice-and-dumplings", "competition", 4, 0.55], ["corner-cellar", "introductions", 3, 0.6], ["wheel-and-kiln", "class", 2, 0.5]];
  let pi = 0;
  for (const [handle, together, n, rate] of plan) { const H = S.hosts.find((h) => h.handle === handle);
    for (let k = 0; k < n; k++) { const j = await call(base, "POST", "/api/bb/requests", { handle, pkg: H.pkgId, headcount: H.pkg.minGuests + 2, date: weekdayAfter(12 + k * 3), company: "Juniper Health", brief: { goal: together === "class" ? "workshop" : together === "competition" ? "team" : "customer", together, mix: { brand: H.pkg.minGuests, host: 2 } }, setupSec: 600 - k * 90 }, JC);
      await call(base, "POST", `/api/bb/requests/${j.id}/pay`, {}, JC); await call(base, "POST", `/api/bb/host/requests/${j.id}`, { action: "accept" }, H.c);
      const key = "system/bbreq-" + j.id, r = store.get(key).data; r.date = day(-20 - k * 25 - pi * 3); store.set(key, r);
      write(j.id, (ev) => { for (let i = 0; i < 6; i++) { const p = pool[(pi * 7 + k * 6 + i) % pool.length], t = tok(); ev.survey.tokens[t] = { side: "host", sid: "s" + i, first: p.name.split(" ")[0], email: p.email }; store.set("system/bpsv-" + t, { kind: "bpsv", reqId: j.id });
        ev.survey.responses[t] = { useful: R() < rate, back: R() < 0.8, before: null, after: null, said: "", quoteOk: false, matchOk: false, company: "", contactOk: false, followHost: R() < 0.4, nextOk: R() < 0.4, listed: false, contact: "", at: Date.now() }; } }); }
    pi++; }
  return { ...S, juniper: { c: JC } };
}
