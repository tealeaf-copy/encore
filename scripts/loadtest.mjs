// A basic load test: N people at once (default 50), each looping through the feed, an invite and a reply, against a
// local seeded server (scripts/perf-world.mjs) in this process. Prints requests, errors and p50/p95/p99 per step.
// Run: node scripts/loadtest.mjs [--users 50] [--seconds 20] [--url http://host:port --cookie 'encore_auth=...' --event id]
// Every reply uses a new guest key and email, so the replies are real writes (one SQLite write each), with an
// Idempotency-Key, and each one is sent twice to check the second is a replay, not a second reply.
import { startWorld } from "./perf-world.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const USERS = +arg("--users", 50), SECONDS = +arg("--seconds", 20);
let W = null, base = arg("--url", ""), cookie = arg("--cookie", ""), eventId = arg("--event", "");
// all the load comes from one address here, so the per-address reply limit (a 429 by design) is lifted for the local run
if (!base) { Object.assign(process.env, { ENCORE_RSVP_IP_PER_HOUR: "1000000", ENCORE_RSVP_PER_HOUR: "1000000" }); W = await startWorld(); base = W.base; cookie = W.S.host.cookie; eventId = W.S.open; }
const ws = (await (await fetch(`${base}/api/db/doc?path=events/${eventId}`, { headers: { "x-encore-guest": "1" } })).json()).workspace;

const steps = {
  "feed page": () => ({ url: "/feed", headers: { cookie } }),
  "feed data (signed in)": () => ({ url: "/api/me/feed", headers: { cookie } }),
  "feed data (public)": () => ({ url: "/api/public/feed" }),
  "invite page": () => ({ url: `/e/${eventId}` }),
  "invite host": () => ({ url: `/api/public/event-host/${eventId}` }),
  "reply": (u, i) => { const key = `kload${u}x${i}x${Date.now().toString(36)}`.slice(0, 32), code = "L" + String(u * 1000 + i).padStart(5, "0");
    return { url: "/api/db/collection?path=rsvps", method: "POST", twice: true, headers: { "content-type": "application/json", "x-encore-guest": "1", "x-encore-key": key, "x-encore-workspace": ws, "Idempotency-Key": `rsvp-${code}-${key}` },
      body: JSON.stringify({ eventId, response: "maybe", name: `Load Guest ${u}-${i}`, email: `load.${u}.${i}.${Date.now()}@example.com`, code, createdAt: Date.now(), via: "invite-lite" }) }; },
};
const T = Object.fromEntries(Object.keys(steps).map((k) => [k, { ms: [], errors: 0, codes: {} }]));
let replays = 0, replayMismatch = 0;
const end = Date.now() + SECONDS * 1000;
async function one(name, r) {
  const t0 = performance.now(); let res, body = "";
  try { res = await fetch(base + r.url, { method: r.method || "GET", headers: { "accept-encoding": "br, gzip", ...(r.headers || {}) }, body: r.body }); body = await res.text(); }
  catch (e) { T[name].errors++; T[name].codes[e.code || "network"] = (T[name].codes[e.code || "network"] || 0) + 1; return null; }
  const ms = performance.now() - t0; T[name].ms.push(ms); T[name].codes[res.status] = (T[name].codes[res.status] || 0) + 1;
  if (res.status >= 400) T[name].errors++;
  return { res, body };
}
async function user(u) {
  for (let i = 0; Date.now() < end; i++) for (const [name, mk] of Object.entries(steps)) {
    const r = mk(u, i), a = await one(name, r);
    if (r.twice && a?.res.ok) { const b = await one(name, r); if (b) { if (b.res.headers.get("idempotent-replay") === "true") replays++; if (b.body !== a.body) replayMismatch++; } }
  }
}
const t0 = Date.now();
await Promise.all(Array.from({ length: USERS }, (_, u) => user(u)));
const secs = (Date.now() - t0) / 1000;
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0; };
const rows = Object.entries(T).map(([k, v]) => ({ step: k, requests: v.ms.length, errors: v.errors, p50: Math.round(pct(v.ms, 50)), p95: Math.round(pct(v.ms, 95)), p99: Math.round(pct(v.ms, 99)), max: Math.round(Math.max(0, ...v.ms)), codes: v.codes }));
const total = rows.reduce((a, r) => a + r.requests, 0), errs = rows.reduce((a, r) => a + r.errors, 0);
console.log(`${USERS} users for ${secs.toFixed(1)}s: ${total} requests (${Math.round(total / secs)}/s), ${errs} errors, ${replays} idempotent replays (${replayMismatch} that differed)`);
console.log("| Step | Requests | Errors | p50 ms | p95 ms | p99 ms | max ms |\n|---|---|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.step} | ${r.requests} | ${r.errors} | ${r.p50} | ${r.p95} | ${r.p99} | ${r.max} |`);
for (const r of rows) if (r.errors) console.log("  " + r.step + " status codes: " + JSON.stringify(r.codes));
W?.close();
process.exit(errs || replayMismatch ? 1 : 0);
