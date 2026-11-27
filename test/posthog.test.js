// PostHog (server/posthog.js, public/plcount.js): off unless configured, consent before any browser script, only
// allow-listed properties, hashed ids, tokens stripped from URLs, and the CSP opened to PostHog only when set up.
// No network: PostHog's fetch is stubbed; the browser loader runs in a vm with a tiny fake DOM.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { startServer } from "./helpers.js";
import * as PH from "../server/posthog.js";

const KEY = "phc_TestProjectKey0123456789abcdef";
const sent = []; let fail = null;
PH._setFetch(async (url, opts) => { if (fail) throw fail; sent.push({ url, body: JSON.parse(opts.body) }); return { ok: true, status: 200 }; });
const on = () => Object.assign(process.env, { ENCORE_POSTHOG_KEY: KEY });
const off = () => { for (const k of ["ENCORE_POSTHOG_KEY", "ENCORE_POSTHOG_HOST", "ENCORE_POSTHOG_REPLAY"]) delete process.env[k]; };
const cookieOf = (r) => (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).filter((c) => /^encore_(auth|in)=/.test(c)).join("; ");
let n = 0;
async function signup(base) { n++; const r = await fetch(base + "/api/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Ana Diaz", email: `ana.ph${n}@example.com`, password: "long-password-1", mode: "friends" }) });
  assert.equal(r.status, 200); return { cookie: cookieOf(r), email: `ana.ph${n}@example.com` }; }

before(() => { off(); Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "ph-secret-0123456789", ENCORE_SIGNUP_PER_HOUR: "100" }); });
after(() => { off(); for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_ADMIN_EMAILS"]) delete process.env[k]; PH._reset(); });

test("With no key: no script tag, no PostHog in the CSP, nothing queued or sent", async () => {
  off(); PH._reset(); sent.length = 0;
  const srv = await startServer();
  try {
    const r = await fetch(srv.base + "/privacy"), html = await r.text();
    assert.equal(r.status, 200); assert.ok(!html.includes("plcount.js"), "no loader tag"); assert.ok(!/posthog\.com/i.test(html), "no PostHog host on the page");
    assert.ok(!/posthog/.test(r.headers.get("content-security-policy") || ""), "CSP unchanged");
    const me = await signup(srv.base);
    assert.deepEqual(await (await fetch(srv.base + "/api/me/analytics", { headers: { cookie: me.cookie } })).json(), { configured: false, on: false, id: null });
    assert.equal(PH.capture("event_published", { ws: "abc" }), false);
    assert.equal(PH._queue().length, 0); await PH.flush(); assert.equal(sent.length, 0);
    assert.equal(PH.status().connected, false);
  } finally { await srv.close(); }
});

test("CSP and page tag include the PostHog host only when configured (US default, EU, bad values ignored)", () => {
  const csp = "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self'";
  assert.equal(PH.cspWith(csp, {}), csp);
  const us = PH.cspWith(csp, { ENCORE_POSTHOG_KEY: KEY });
  assert.match(us, /script-src 'self' https:\/\/us\.i\.posthog\.com https:\/\/us-assets\.i\.posthog\.com/); assert.match(us, /connect-src 'self' https:\/\/us\.i\.posthog\.com/); assert.match(us, /img-src 'self'$/);
  const eu = PH.cspWith(csp, { ENCORE_POSTHOG_KEY: KEY, ENCORE_POSTHOG_HOST: "https://eu.i.posthog.com/" });
  assert.ok(eu.includes("https://eu.i.posthog.com https://eu-assets.i.posthog.com") && !eu.includes("us.i."));
  assert.match(PH.cspWith(csp, { ENCORE_POSTHOG_KEY: KEY, ENCORE_POSTHOG_REPLAY: "1" }), /worker-src 'self' blob:/);
  assert.equal(PH.cspWith(csp, { ENCORE_POSTHOG_KEY: "phx_personal_secret_key_123" }), csp, "a personal key is never used");
  assert.equal(PH.cspWith(csp, { ENCORE_POSTHOG_KEY: KEY, ENCORE_POSTHOG_HOST: "http://evil.example" }), csp, "plain http is refused");
  const page = "<html><head><title>x</title></head><body></body></html>";
  assert.equal(PH.analyticsTag(page, {}), page);
  const tagged = PH.analyticsTag(page, { ENCORE_POSTHOG_KEY: KEY });
  assert.match(tagged, /<script src="\/plcount\.js" data-k="phc_[^"]+" data-h="https:\/\/us\.i\.posthog\.com" data-a="https:\/\/us-assets\.i\.posthog\.com" defer><\/script><\/head>/);
  assert.equal(PH.analyticsTag(tagged, { ENCORE_POSTHOG_KEY: KEY }), tagged, "added once");
});

test("With a key: pages carry the loader and the CSP host; server events are batched, hashed and allow-listed", async () => {
  on(); PH._reset(); sent.length = 0; process.env.ENCORE_ADMIN_EMAILS = "";
  const srv = await startServer();
  try {
    const r = await fetch(srv.base + "/privacy"), html = await r.text();
    assert.match(html, /<script src="\/plcount\.js(\?v=[^"]+)?" data-k="phc_/); assert.match(r.headers.get("content-security-policy"), /connect-src [^;]*https:\/\/us\.i\.posthog\.com/);
    assert.equal((html.match(/plcount\.js/g) || []).length, 1, "one tag");
    const me = await signup(srv.base);
    const A = await (await fetch(srv.base + "/api/me/analytics", { headers: { cookie: me.cookie } })).json();
    assert.equal(A.configured, true); assert.equal(A.on, true); assert.match(A.id, /^[0-9a-f]{16}$/);
    // a published event: kind and city only, never the title
    const ev = await fetch(srv.base + "/api/db/collection?path=events", { method: "POST", headers: { "content-type": "application/json", cookie: me.cookie }, body: JSON.stringify({ name: "Secret birthday for Bea", published: true, kind: "dinner", city: "Lisbon", date: "2099-01-01" }) });
    assert.equal(ev.status, 200);
    const Q = PH._queue(), names = Q.map((e) => e.event);
    for (const e of ["signup", "signup_completed", "first_event_created", "event_published"]) assert.ok(names.includes(e), e + " queued: " + names);
    for (const e of Q) { assert.equal(e.distinct_id, A.id, "browser and server share the hashed id"); assert.equal(e.properties.$ip, null); assert.equal(e.properties.$geoip_disable, true); }
    const pub = Q.find((e) => e.event === "event_published").properties;
    assert.deepEqual({ kind: pub.kind, region: pub.region, plan: pub.plan }, { kind: "dinner", region: "Lisbon", plan: "friends" });
    const text = JSON.stringify(Q); for (const bad of [me.email, "Ana", "Diaz", "Secret", "Bea"]) assert.ok(!text.includes(bad), bad);
    await PH.flush();
    assert.equal(sent.length, 1); assert.equal(sent[0].url, "https://us.i.posthog.com/batch/"); assert.equal(sent[0].body.api_key, KEY); assert.equal(sent[0].body.batch.length, Q.length);
    assert.equal(PH._queue().length, 0);
    // the admin line: connected, when, and never the key
    process.env.ENCORE_ADMIN_EMAILS = me.email;
    const st = await (await fetch(srv.base + "/api/admin/analytics", { headers: { cookie: me.cookie } })).json();
    assert.equal(st.connected, true); assert.ok(st.lastSentAt > 0); assert.ok(!JSON.stringify(st).includes("phc_"));
    process.env.ENCORE_ADMIN_EMAILS = "";
    assert.equal((await fetch(srv.base + "/api/admin/analytics", { headers: { cookie: me.cookie } })).status, 404);
    // Settings off: nothing more for this workspace, server or browser
    const o = await fetch(srv.base + "/api/me/analytics", { method: "POST", headers: { "content-type": "application/json", cookie: me.cookie }, body: JSON.stringify({ on: false }) });
    assert.equal(o.status, 200);
    assert.equal((await (await fetch(srv.base + "/api/me/analytics", { headers: { cookie: me.cookie } })).json()).on, false);
    const before0 = PH._queue().length;
    await fetch(srv.base + "/api/db/collection?path=events", { method: "POST", headers: { "content-type": "application/json", cookie: me.cookie }, body: JSON.stringify({ name: "Another", published: true, kind: "dinner" }) });
    assert.equal(PH._queue().length, before0, "opted out");
  } finally { await srv.close(); off(); }
});

test("Sign-in method and route events (a follow, a quick book search) carry only words and counts", async () => {
  on(); PH._reset();
  const srv = await startServer();
  try {
    const me = await signup(srv.base); PH._reset();
    const r = await fetch(srv.base + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: me.email, password: "long-password-1" }) });
    assert.equal(r.status, 200);
    const s = PH._queue().find((e) => e.event === "signed_in"); assert.ok(s, "signed_in queued"); assert.equal(s.properties.method, "password"); assert.match(s.distinct_id, /^[0-9a-f]{16}$/);
    const q = await fetch(srv.base + "/api/teams/quick?people=12&goal=customer&city=Lisbon", { headers: { cookie: me.cookie } });
    if (q.status === 200) { const e = PH._queue().find((x) => x.event === "brand_quickbook_searched"); assert.ok(e); assert.equal(e.properties.guests, 12); assert.equal(typeof e.properties.results, "number"); }
    assert.ok(!JSON.stringify(PH._queue()).includes(me.email));
  } finally { await srv.close(); PH._reset(); off(); }
});

test("Fuzz: emails, phones, names and free text in props never reach a payload", async () => {
  on(); PH._reset(); sent.length = 0;
  const bad = ["ana@example.com", "+1 415 555 0100", "4155550100", "Ana Diaz", "12 Rua Augusta, Lisbon", "I can't eat nuts", "rsvp-AbC123xyz", "code=QWERTY99", "tok_9f8e7d6c5b4a"];
  const keys = ["step", "kind", "plan", "answer", "method", "via", "exp", "variant", "goal", "count", "guests", "results", "code", "first", "region", "email", "name", "phone", "text", "title", "address", "url", "$current_url", "distinct_id", "ws"];
  let i = 0;
  for (const v of bad) for (let j = 0; j < 4; j++) { const p = {}; for (const k of keys) p[k] = bad[(i++ + keys.indexOf(k)) % bad.length]; p.ws = "wsFuzz" + j; PH.capture(["reply_received", "comment_posted", "chat_message_sent", "follow"][j], p); }
  PH.capture("not_an_event", { kind: "x" });
  const Q = PH._queue(); assert.equal(Q.length, bad.length * 4, "unknown events are dropped");
  await PH.flush(); await PH.flush();
  const text = JSON.stringify(sent.map((s) => s.body.batch)) + JSON.stringify(PH._queue());
  for (const b of bad) assert.ok(!text.includes(b), "leaked: " + b);
  for (const w of ["wsFuzz0", "@", "5550100"]) assert.ok(!text.includes(w), "leaked: " + w);
  for (const e of sent.flatMap((s) => s.body.batch)) { assert.match(e.distinct_id, /^[0-9a-f]{16}$/); for (const k of Object.keys(e.properties)) assert.ok(["source", "$lib", "$ip", "$geoip_disable", "plan", "region"].includes(k) || /^(step|kind|plan|answer|method|via|exp|variant|goal|count|guests|results|code|first|signed_in|private|paid)$/.test(k), k); }
  // a known city is allowed; a street address or a person's name isn't
  assert.equal(PH.cleanProps({ region: "São Paulo" }).region, "São Paulo"); assert.equal(PH.cleanProps({ region: "Brooklyn" }).region, "New York");
  for (const r of ["12 Rua Augusta", "Ana Diaz", "ana@example.com"]) assert.equal(PH.cleanProps({ region: r }).region, undefined, r);
  assert.deepEqual(PH.cleanProps({ answer: "going", method: "passkey", count: 3, first: true, private: "yes" }), { answer: "going", method: "passkey", count: 3, first: true });
});

test("Sender: flushes at 50, one batch in flight, a failure is dropped without retry and never throws", async () => {
  on(); PH._reset(); sent.length = 0;
  for (let i = 0; i < 49; i++) PH.capture("follow", { ws: "wsBatch", kind: "host" });
  assert.equal(sent.length, 0, "not yet");
  PH.capture("follow", { ws: "wsBatch", kind: "host" });
  await PH.flush(); assert.equal(sent.length, 1); assert.equal(sent[0].body.batch.length, 50);
  fail = new Error("offline"); PH.capture("follow", { ws: "wsBatch" });
  assert.equal(await PH.flush(), false); assert.equal(PH._queue().length, 0, "dropped, not requeued"); assert.match(PH.status().lastError, /reach/);
  fail = null; assert.equal(await PH.flush(), false, "nothing left to send"); assert.equal(sent.length, 1);
  // anonymous: a random id and no person profile
  PH.capture("follow", { kind: "host" }); const a = PH._queue()[0]; assert.match(a.distinct_id, /^anon-/); assert.equal(a.properties.$process_person_profile, false);
  assert.equal(PH.distinctId("wsBatch"), PH.distinctId("wsBatch")); assert.notEqual(PH.distinctId("wsBatch"), "wsBatch"); assert.match(PH.distinctId("ana@example.com"), /^[0-9a-f]{16}$/);
  PH._reset();
});

test("Experiment rows go to PostHog through addSink with the variant as a feature property", async () => {
  on(); PH._reset();
  const { track, unitHash } = await import("../server/experiments.js");
  const srv = await startServer();
  try { track("xp", { exp: "first-win-copy", variant: "plan", kind: "exposure", unit: "wsXp1", email: "x@example.com" });
    const e = PH._queue().find((x) => x.event === "xp_exposure"); assert.ok(e);
    assert.equal(e.distinct_id, unitHash("wsXp1")); assert.equal(e.distinct_id, PH.distinctId("wsXp1"), "joins the host's id");
    assert.equal(e.properties["$feature/first-win-copy"], "plan"); assert.ok(!JSON.stringify(e).includes("example.com"));
  } finally { await srv.close(); PH._reset(); off(); }
});

// ---- the browser loader, in a vm with a tiny DOM
function browser({ store = {}, dnt = false, gpc = false, cookie = "", href = "https://potterylab.test/e/ABCDEFGHIJ0123456789?rid=r1&code=XYZ#rsvp-abc" } = {}) {
  const els = [];
  const mk = (tag) => { const el = { tagName: tag, children: [], dataset: {}, attrs: {}, style: {}, setAttribute(k, v) { this.attrs[k] = v; }, remove() { this.removed = true; },
    appendChild(c) { this.children.push(c); els.push(c); return c; }, set innerHTML(h) { this._html = h; this._btn = { ".ok": { onclick: null }, ".no": { onclick: null } }; }, get innerHTML() { return this._html; },
    querySelector(s) { return this._btn?.[s]; }, parentNode: null }; return el; };
  const head = mk("head"), body = mk("body"), first = mk("script"); first.parentNode = { insertBefore: (n) => els.push(n) };
  const tag = mk("script"); tag.dataset = { k: KEY, h: "https://us.i.posthog.com", a: "https://us-assets.i.posthog.com" };
  const url = new URL(href);
  const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const document = { currentScript: tag, body, head, cookie, createElement: mk, getElementById: (id) => els.find((e) => e.id === id && !e.removed) || null, querySelector: () => tag, getElementsByTagName: () => [first], addEventListener() {} };
  const idle = [];
  const win = { URL, document, localStorage: ls, navigator: { doNotTrack: dnt ? "1" : null, globalPrivacyControl: gpc }, location: url, setTimeout: (f) => idle.push(f), fetch: async () => ({ ok: true, json: async () => ({ on: true, id: "0123456789abcdef" }) }) };
  win.window = win; win.requestIdleCallback = undefined;
  vm.runInNewContext(fs.readFileSync(new URL("../public/plcount.js", import.meta.url), "utf8"), win);
  idle.splice(0).forEach((f) => f());
  return { win, els, store, notice: () => els.find((e) => e.id === "plc" && !e.removed), phScript: () => els.find((e) => /\/static\/array\.js$/.test(e.src || "")) };
}

test("Loader: nothing from PostHog before consent; OK loads it, No thanks never does; DNT and GPC show nothing", () => {
  const B = browser();
  assert.ok(B.notice(), "the notice shows on a first visit"); assert.equal(B.phScript(), undefined, "no PostHog script before consent"); assert.equal(B.win.posthog, undefined);
  B.notice()._btn[".ok"].onclick();
  assert.equal(B.store["pl-count"], "yes"); assert.equal(B.notice(), undefined, "notice gone");
  assert.equal(B.phScript().src, "https://us-assets.i.posthog.com/static/array.js");
  const [key, cfg] = B.win.posthog._i[0];
  assert.equal(key, KEY);
  assert.equal(cfg.autocapture, false); assert.equal(cfg.mask_all_text, true); assert.equal(cfg.mask_all_element_attributes, true); assert.equal(cfg.disable_session_recording, true);
  assert.equal(cfg.person_profiles, "identified_only"); assert.equal(cfg.persistence, "localStorage"); assert.equal(cfg.respect_dnt, true); assert.ok(cfg.capture_pageview);
  const N = browser(); N.notice()._btn[".no"].onclick(); assert.equal(N.store["pl-count"], "no"); assert.equal(N.phScript(), undefined); assert.equal(N.win.posthog, undefined);
  const again = browser({ store: { "pl-count": "no" } }); assert.equal(again.notice(), undefined); assert.equal(again.phScript(), undefined);
  for (const o of [{ dnt: true }, { gpc: true }, { dnt: true, store: { "pl-count": "yes" } }]) { const D = browser(o); assert.equal(D.notice(), undefined); assert.equal(D.phScript(), undefined); }
  const yes = browser({ store: { "pl-count": "yes" } }); assert.equal(yes.notice(), undefined); assert.ok(yes.phScript(), "an earlier OK loads it straight away");
});

test("Loader: tokens, queries and hashes are stripped; titles, campaign params and other events are dropped", () => {
  const { win } = browser({ store: { "pl-count": "no" } }), P = win.PLCount;
  const cases = { "/e/ABCDEFGHIJ0123456789": "/e/ABCDEFGHIJ0123456789", "/reconfirm/abcDEF123456": "/reconfirm/:token", "/survey/x1y2z3": "/survey/:token", "/l/AbCdEfGhIjKlMnOpQrStUvWx": "/l/:token",
    "/k/abc": "/k/:token", "/p/zz9": "/p/:token", "/plans/feed/abcdef": "/plans/feed/:token", "/unsubscribe/ana@example.com": "/unsubscribe/:token", "/@ana-cooks": "/@ana-cooks", "/g": "/g", "/": "/",
    "/chats/ABCDEFGHIJ0123456789": "/chats/ABCDEFGHIJ0123456789", "/x/AbCdEfGhIjKlMnOpQrStUvWxYz": "/x/:token", "/privacy.html": "/privacy.html" };
  for (const [a, b] of Object.entries(cases)) assert.equal(P.cleanPath(a), b, a);
  assert.equal(P.cleanUrl("https://potterylab.test/g?rid=r1&code=XYZ#rsvp-abc"), "https://potterylab.test/g");
  assert.equal(P.cleanUrl("https://elsewhere.example/some/path?q=ana@example.com"), "https://elsewhere.example");
  const ev = P.beforeSend({ event: "$pageview", properties: { $current_url: "https://potterylab.test/e/ABCDEFGHIJ0123456789?rid=r1&code=XYZ#rsvp-abc", $pathname: "/reconfirm/tok123", $referrer: "https://mail.example/inbox?u=ana@example.com", title: "Secret birthday for Bea", utm_source: "mail", gclid: "x", $initial_utm_source: "y", $browser: "Chrome", note: "ana@example.com" },
    $set_once: { $initial_current_url: "https://potterylab.test/g?token=abc#rsvp-1", $initial_utm_campaign: "z" } });
  assert.equal(ev.properties.$current_url, "https://potterylab.test/e/ABCDEFGHIJ0123456789"); assert.equal(ev.properties.$pathname, "/reconfirm/:token"); assert.equal(ev.properties.$referrer, "https://mail.example");
  for (const k of ["title", "utm_source", "gclid", "$initial_utm_source", "note"]) assert.ok(!(k in ev.properties), k);
  assert.equal(ev.properties.$browser, "Chrome"); assert.equal(ev.properties.$ip, null); assert.equal(ev.$set_once.$initial_current_url, "https://potterylab.test/g"); assert.ok(!("$initial_utm_campaign" in ev.$set_once));
  const text = JSON.stringify(ev); for (const b of ["rid=", "code=", "rsvp-", "ana@", "Secret", "tok123"]) assert.ok(!text.includes(b), b);
  for (const e of ["$autocapture", "$pageleave", "$rageclick", "$snapshot", "custom"]) assert.equal(P.beforeSend({ event: e, properties: {} }), null, e);
});

test("Loader: signed in, it identifies with the server's hash once consent is given, never an email", async () => {
  const B = browser({ store: { "pl-count": "yes" }, cookie: "encore_in=1" });
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  assert.ok(B.phScript()); const cfg = B.win.posthog._i[0][1]; const calls = [];
  const ph = { register: () => {}, identify: (id) => calls.push(id), reset: () => calls.push("reset") }; cfg.loaded(ph);
  assert.deepEqual(calls, ["0123456789abcdef"]); assert.equal(B.store["pl-count-id"], "0123456789abcdef");
});
