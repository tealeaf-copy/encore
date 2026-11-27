// Paid host memberships (server/memberships.js): who can start one (5 events that really happened, never an example),
// tiers ($5, $10, $20 a month, a bounded yearly price), Stripe Connect + Billing through a stubbed Stripe (no network):
// the host's Express account, prices on that account, Checkout on that account, the Customer Portal, signed webhooks
// handled once; priority access enforced inside replies and orders (and not bypassed by typing a member's email), held
// member seats released when it opens to everyone, blocked members cancelled at the period's end, nothing to buy in the
// native app, and everything off without Stripe settings.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore, updateWorkspace, getWorkspace } from "../server/workspaces.js";
import { keyFor, idOf } from "../server/people.js";
import { cleanTiers, stripeConfig, setStripeFetch, signStripe, verifyStripe, formOf, perkLines, fmtWhen } from "../server/memberships.js";

let srv;
const J = { "content-type": "application/json" };
const APP_UA = "Mozilla/5.0 (iPhone) PotteryLabApp/1.0";
const post = (path, body, cookie, extra = {}) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}), ...extra }, body: JSON.stringify(body || {}) });
const getJ = async (path, cookie, extra = {}) => (await fetch(srv.base + path, { headers: { ...(cookie ? { cookie } : {}), ...extra } })).json();
const put = (path, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
let n = 0;
const person = async (name) => { const email = `${name.toLowerCase().replace(/\W+/g, "")}${++n}@example.com`; const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); const b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); return { cookie: cookieOf(r), ws: b.workspace.id, email, name }; };
const host = async (name, handle) => { const h = await person(name); const r = await post("/api/host/profile", { handle, name, city: "New York", bio: "Dinners at home." }, h.cookie); assert.equal(r.status, 200, await r.text()); return { ...h, handle }; };
const guestRsvp = (ws, body, cookie) => fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, "x-encore-guest": "1", "x-encore-key": "k" + Math.random().toString(36).slice(2), "x-encore-workspace": ws, ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ createdAt: Date.now(), code: "C" + Math.random().toString(36).slice(2, 8), ...body }) });
const day = (k) => new Date(Date.now() + k * 864e5).toISOString().slice(0, 10);
/** k past events that really happened (a guest said I'm in), plus ones that never count. */
function seedPast(ws, k, { prefix = "p" } = {}) {
  const S = scopeStore(srv.store, ws);
  for (let i = 0; i < k; i++) { S.set(`events/${prefix}${i}`, { name: "Supper " + i, casual: true, date: day(-10 - i), published: true }); S.set(`rsvps/${prefix}r${i}`, { eventId: `${prefix}${i}`, name: "Guest", email: `g${i}@example.com`, response: "going" }); }
}
function seedNoise(ws) {
  const S = scopeStore(srv.store, ws);
  S.set("events/nz-empty", { name: "Nobody came", date: day(-3) });
  S.set("events/nz-cancel", { name: "Cancelled", date: day(-4), cancelled: true }); S.set("rsvps/nz-c", { eventId: "nz-cancel", response: "going", email: "a@example.com" });
  S.set("events/nz-example", { name: "Example", date: day(-5), example: true }); S.set("rsvps/nz-e", { eventId: "nz-example", response: "going", email: "a@example.com" });
  S.set("events/nz-future", { name: "Soon", date: day(5) }); S.set("rsvps/nz-f", { eventId: "nz-future", response: "going", email: "a@example.com" });
  S.set("events/nz-maybe", { name: "Only maybes", date: day(-6) }); S.set("rsvps/nz-m", { eventId: "nz-maybe", response: "maybe", email: "a@example.com" });
  S.set("events/nz-door", { name: "Door list", date: day(-7), guests: [{ name: "Walk-in", status: "Attended" }] });
}

// ---- a pretend Stripe ----
let calls = [], ids = 0, acctReady = true;
function fakeStripe(url, init) {
  const u = new URL(url), path = u.pathname.replace(/^\/v1\//, ""), method = init.method, acct = init.headers["Stripe-Account"] || "";
  assert.equal(u.host, "api.stripe.com"); assert.match(init.headers.Authorization, /^Bearer sk_test_/);
  calls.push({ method, path, params: Object.fromEntries(new URLSearchParams(init.body || u.search)), account: acct, idem: init.headers["Idempotency-Key"] || "" });
  const id = (p) => `${p}_${++ids}`; let body = {};
  if (path === "accounts" && method === "POST") body = { id: id("acct"), charges_enabled: false, details_submitted: false };
  else if (/^accounts\/[^/]+$/.test(path)) body = { id: path.split("/")[1], charges_enabled: acctReady, details_submitted: acctReady };
  else if (/login_links$/.test(path)) body = { url: "https://connect.stripe.com/express/login" };
  else if (path === "account_links") body = { url: "https://connect.stripe.com/setup/e/onboard" };
  else if (path === "products") body = { id: id("prod") };
  else if (path === "prices") body = { id: id("price") };
  else if (/^(prices|products)\//.test(path)) body = { id: path.split("/")[1] };
  else if (path.startsWith("billing_portal/configurations")) body = { id: "bpc_1" };
  else if (path === "checkout/sessions") { const i = id("cs"); body = { id: i, url: "https://checkout.stripe.com/c/pay/" + i }; }
  else if (path === "billing_portal/sessions") body = { url: "https://billing.stripe.com/p/session/abc" };
  else if (path.startsWith("subscriptions/")) body = { id: path.split("/")[1], cancel_at_period_end: true };
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
}
const STRIPE = { STRIPE_SECRET_KEY: "sk_test_abc123456789", STRIPE_WEBHOOK_SECRET: "whsec_testsecret123456" };
const stripeOn = () => Object.assign(process.env, STRIPE);
const stripeOff = () => { for (const k of [...Object.keys(STRIPE), "ENCORE_MEMBERSHIP_FEE_BPS"]) delete process.env[k]; };
let evN = 0;
const hook = (type, object, account, { created = Math.floor(Date.now() / 1000) + evN, id = "evt_" + (++evN) + "x" + Math.random().toString(36).slice(2, 8), secret = STRIPE.STRIPE_WEBHOOK_SECRET, sig = null } = {}) => {
  const body = JSON.stringify({ id, type, account, created, data: { object } });
  return fetch(srv.base + "/api/stripe/webhook", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": sig || signStripe(body, secret) }, body }).then(async (r) => ({ status: r.status, body: await r.json(), id }));
};
const sub = (o) => ({ id: "sub_1", object: "subscription", status: "active", customer: "cus_1", cancel_at_period_end: false, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, items: { data: [{ price: { id: o.price, unit_amount: o.amount, recurring: { interval: o.interval || "month" } } }] }, metadata: { pl_member: o.key, pl_ws: o.ws, pl_tier: o.tier, pl_email: o.email }, ...o.extra });

const TIERS = [{ monthly: 5, name: "Regular", line: "First dibs.", perks: { early: true, earlyHours: 24, badge: true } }, { monthly: 20, name: "Patron", line: "First in line.", yearly: 200, perks: { early: true, earlyHours: 72, seats: true, only: true, badge: true, note: true } }];
/** An eligible host with Stripe connected and memberships open. */
async function openHost(name, handle) {
  const h = await host(name, handle); seedPast(h.ws, 5);
  let r = await post("/api/host/membership/connect", {}, h.cookie); assert.equal(r.status, 200, await r.text());
  const v = await getJ("/api/host/membership?refresh=1", h.cookie); assert.equal(v.account.chargesEnabled, true);
  r = await post("/api/host/membership", { tiers: TIERS, open: true }, h.cookie); const j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j)); assert.equal(j.membership.on, true);
  const M = srv.app.locals.memberships, c = M.config(h.ws); return { ...h, acct: c.account, prices: c.prices };
}
/** Sign someone up through the stubbed Checkout and a webhook. */
async function joinAs(h, p, tier = "t20", interval = "month", subId = "sub_" + p.email.replace(/\W/g, "")) {
  const r = await post(`/api/me/membership/${h.handle}/checkout`, { tier, interval }, p.cookie); assert.equal(r.status, 200, await r.text());
  const M = srv.app.locals.memberships, key = M.mKey(p.email), price = M.config(h.ws).prices[tier][interval];
  const w = await hook("customer.subscription.created", sub({ key, ws: h.ws, tier, email: p.email, price: price.id, amount: price.amount, interval, extra: { id: subId, customer: "cus_" + subId } }), h.acct); assert.equal(w.status, 200, JSON.stringify(w.body));
  return { key, subId };
}

before(async () => { srv = await startServer(); setStripeFetch(fakeStripe); });
beforeEach(() => { Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "member-secret", ENCORE_SIGNUP_PER_HOUR: "500", ENCORE_FAKE_EMAIL: "1" }); stripeOn(); delete process.env.ENCORE_MEMBERSHIP_FEE_BPS; resetLoginLimits(); calls = []; acctReady = true; });
after(async () => { setStripeFetch(null); stripeOff(); for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL", "ENCORE_ADMIN_EMAILS"]) delete process.env[k]; await srv.close(); });

test("tiers: $5, $10 or $20 a month, up to three, a bounded yearly price, higher tiers in first", () => {
  let r = cleanTiers([{ monthly: 10 }]); assert.equal(r.tiers[0].name, "Friend of the house"); assert.equal(r.tiers[0].yearly, 100, "10x monthly to start"); assert.equal(r.tiers[0].rank, 2);
  assert.match(cleanTiers([{ monthly: 7 }]).error, /\$5, \$10 or \$20/);
  assert.match(cleanTiers([{ monthly: 15 }]).error, /\$5, \$10 or \$20/);
  assert.match(cleanTiers([{ monthly: 5 }, { monthly: 5 }]).error, /own price/);
  assert.match(cleanTiers([{ monthly: 5 }, { monthly: 10 }, { monthly: 20 }, { monthly: 5 }]).error, /Up to 3/);
  assert.match(cleanTiers([]).error, /at least one/);
  assert.match(cleanTiers([{ monthly: 5, yearly: 29 }]).error, /\$30 to \$60/, "under 6x monthly");
  assert.match(cleanTiers([{ monthly: 20, yearly: 241 }]).error, /\$120 to \$240/, "over 12x monthly");
  assert.equal(cleanTiers([{ monthly: 20, yearly: "$199.50" }]).tiers[0].yearly, 199.5);
  r = cleanTiers([{ monthly: 20, perks: { early: true, earlyHours: 24 } }, { monthly: 5, perks: { early: true, earlyHours: 48 } }]); assert.match(r.error, /Higher tiers get in first/);
  r = cleanTiers([{ monthly: 20, name: "Patron", perks: { early: true, earlyHours: 999 } }]); assert.equal(r.tiers[0].perks.earlyHours, 24, "an hours value off the list falls back");
  r = cleanTiers(TIERS); assert.deepEqual(r.tiers.map((t) => t.id), ["t5", "t20"]); assert.deepEqual(perkLines(r.tiers[1], "Bo"), ["Book 3 days before everyone else", "Seats held for members at each event", "Members-only events", "A member badge on your page", "A monthly note from Bo"]);
  assert.match(fmtWhen(Date.UTC(2026, 10, 27, 15, 0), { tz: "America/New_York" }), /^on Fri at 10am$/);
});

test("Stripe helpers: form encoding and the webhook signature", () => {
  assert.equal(decodeURIComponent(formOf({ a: { b: 1 }, c: [{ d: "x" }], e: ["y"], f: null }).toString()), "a[b]=1&c[0][d]=x&e[0]=y");
  const body = '{"id":"evt_1"}', h = signStripe(body, "whsec_abc");
  assert.equal(verifyStripe(Buffer.from(body), h, "whsec_abc").ok, true);
  assert.equal(verifyStripe(Buffer.from(body + " "), h, "whsec_abc").reason, "bad_signature");
  assert.equal(verifyStripe(Buffer.from(body), h, "whsec_other").reason, "bad_signature");
  assert.equal(verifyStripe(Buffer.from(body), signStripe(body, "whsec_abc", Math.floor(Date.now() / 1000) - 3600), "whsec_abc").reason, "too_old");
  assert.equal(verifyStripe(Buffer.from(body), "", "whsec_abc").reason, "no_signature");
  assert.equal(stripeConfig({}).on, false); assert.deepEqual(stripeConfig({}).missing, ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]);
  assert.equal(stripeConfig({ STRIPE_SECRET_KEY: "sk_test_abc123456789" }).on, false, "a key without a webhook secret is not enough");
  assert.equal(stripeConfig({ ...STRIPE, ENCORE_MEMBERSHIP_FEE_BPS: "250" }).feeBps, 250); assert.equal(stripeConfig({ ...STRIPE, ENCORE_MEMBERSHIP_FEE_BPS: "-5" }).feeBps, 0);
});

test("eligibility: 4 real events is not enough, the 5th is; empty, cancelled, example and future events never count", async () => {
  const bo = await host("Bo Tran", "bo-elig"); seedPast(bo.ws, 4); seedNoise(bo.ws);
  let v = await getJ("/api/host/membership", bo.cookie); assert.equal(v.eligibility.count, 5, "4 suppers and the door list");
  scopeStore(srv.store, bo.ws).delete("events/nz-door");
  v = await getJ("/api/host/membership", bo.cookie); assert.equal(v.eligibility.count, 4); assert.equal(v.eligibility.need, 1); assert.equal(v.eligibility.eligible, false);
  let r = await post("/api/host/membership", { tiers: TIERS }, bo.cookie); assert.equal(r.status, 403); const j = await r.json(); assert.equal(j.code, "not_eligible"); assert.match(j.message, /^1 more event and you can start a membership/);
  assert.equal((await post("/api/host/membership/connect", {}, bo.cookie)).status, 403);
  const page = await getJ("/api/public/host/bo-elig", bo.cookie); assert.equal(page.membership.host.need, 1, "the host page knows the progress");
  seedPast(bo.ws, 1, { prefix: "five" });
  v = await getJ("/api/host/membership", bo.cookie); assert.equal(v.eligibility.count, 5); assert.equal(v.eligibility.eligible, true);
  r = await post("/api/host/membership", { tiers: TIERS }, bo.cookie); const jd = await r.json(); assert.equal(r.status, 200, JSON.stringify(jd));
  assert.equal(jd.membership.on, false, "saved as a draft until Stripe is connected");
  r = await post("/api/host/membership", { tiers: TIERS, open: true }, bo.cookie); assert.equal(r.status, 409); assert.equal((await r.json()).code, "no_account");
  // somebody else's page never shows the host's progress
  const sam = await person("Sam Diaz"); assert.equal((await getJ("/api/public/host/bo-elig", sam.cookie)).membership.host, undefined);
});

test("examples and preview pages never qualify", async () => {
  const ex = await host("Ex Ample", "ex-elig"), M = srv.app.locals.memberships; seedPast(ex.ws, 8);
  assert.equal(M.eligibility(ex.ws).eligible, true);
  const was = getWorkspace(ex.ws).ownerEmail; updateWorkspace(ex.ws, { ownerEmail: "ex@demo.encore" });
  try { assert.equal(M.eligibility(ex.ws).count, 0, "an example host"); } finally { updateWorkspace(ex.ws, { ownerEmail: was }); }
  const S = scopeStore(srv.store, ex.ws); for (const d of S.list("events")) S.update("events/" + d.id, { example: true });
  assert.equal(M.eligibility(ex.ws).count, 0, "example events");
  // a preview page (public/presets) has no workspace behind it: nothing to count, no membership card, nothing to buy
  const pv = await getJ("/api/public/host/anhdraws"); assert.ok(pv.host?.showcase, "a preview page"); assert.equal(pv.membership, undefined);
  assert.equal(M.eligibility(null).eligible, false);
  const pm = await fetch(srv.base + "/api/public/membership/anhdraws"); assert.equal(pm.status, 404);
});

test("everything is off without Stripe settings: hosts read why, the owner sees a checklist", async () => {
  stripeOff(); process.env.ENCORE_ADMIN_EMAILS = "";
  const bo = await host("Bo Off", "bo-off"); seedPast(bo.ws, 5); const sam = await person("Sam Off");
  const v = await getJ("/api/host/membership", bo.cookie); assert.equal(v.payments.on, false); assert.equal(v.payments.checklist, undefined, "a host isn't shown the owner's checklist");
  let r = await post("/api/host/membership", { tiers: TIERS }, bo.cookie); assert.equal(r.status, 409); assert.equal((await r.json()).message, "Memberships need payments set up. We'll let you know when they're on.");
  assert.equal((await post("/api/host/membership/connect", {}, bo.cookie)).status, 409);
  r = await post("/api/me/membership/bo-off/checkout", { tier: "t5", interval: "month" }, sam.cookie); assert.equal(r.status, 409);
  assert.equal((await hook("customer.subscription.created", { id: "sub_x" }, "acct_x")).status, 404, "no webhook endpoint at all");
  const page = await getJ("/api/public/host/bo-off", sam.cookie); assert.equal(page.membership.on, false); assert.equal(page.membership.payments, false);
  assert.equal((await fetch(srv.base + "/api/admin/memberships", { headers: { cookie: bo.cookie } })).status, 404);
  process.env.ENCORE_ADMIN_EMAILS = bo.email;
  const a = await getJ("/api/admin/memberships", bo.cookie); assert.equal(a.on, false); assert.ok(a.checklist.find((x) => x.id === "key" && x.ok === false)); assert.match(a.webhook, /\/api\/stripe\/webhook$/);
  const v2 = await getJ("/api/host/membership", bo.cookie); assert.ok(Array.isArray(v2.payments.checklist), "the owner sees the checklist on their own card");
  assert.equal(calls.length, 0, "nothing reached Stripe");
  delete process.env.ENCORE_ADMIN_EMAILS;
});

test("Connect, prices on the host's account, Checkout on that account with the right price, the portal", async () => {
  const bo = await openHost("Bo Tran", "bo-pay"), sam = await person("Sam Diaz");
  const acctCall = calls.find((c) => c.path === "accounts" && c.method === "POST"); assert.equal(acctCall.params.type, "express"); assert.equal(acctCall.params["capabilities[transfers][requested]"], "true"); assert.equal(acctCall.account, "", "made by the platform");
  assert.ok(calls.some((c) => c.path === "account_links" && c.params.account === bo.acct && c.params.type === "account_onboarding"));
  const prices = calls.filter((c) => c.path === "prices"); assert.equal(prices.length, 4, "a monthly and a yearly price per tier");
  assert.ok(prices.every((c) => c.account === bo.acct), "every price lives on the host's own account");
  assert.deepEqual(prices.map((c) => [c.params.unit_amount, c.params["recurring[interval]"]]).sort(), [["20000", "year"], ["2000", "month"], ["500", "month"], ["5000", "year"]].sort());
  const portal = calls.find((c) => c.path === "billing_portal/configurations"); assert.equal(portal.account, bo.acct); assert.equal(portal.params["features[subscription_cancel][mode]"], "at_period_end", "cancelling keeps access until the period ends");
  // Checkout
  calls = []; let r = await post("/api/me/membership/bo-pay/checkout", { tier: "t20", interval: "year" }, sam.cookie); let j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j)); assert.match(j.url, /^https:\/\/checkout\.stripe\.com\//);
  const co = calls.find((c) => c.path === "checkout/sessions"); assert.equal(co.account, bo.acct, "on the connected account");
  assert.equal(co.params.mode, "subscription"); assert.equal(co.params["line_items[0][price]"], bo.prices.t20.year.id); assert.equal(co.params.customer_email, sam.email);
  assert.equal(co.params["subscription_data[metadata][pl_tier]"], "t20"); assert.equal(co.params["subscription_data[application_fee_percent]"], undefined, "no fee at launch"); assert.ok(co.idem);
  assert.ok(!Object.keys(co.params).some((k) => /card|number|cvc/i.test(k)), "no card data passes through here");
  process.env.ENCORE_MEMBERSHIP_FEE_BPS = "250"; calls = [];
  r = await post("/api/me/membership/bo-pay/checkout", { tier: "t5", interval: "month" }, sam.cookie); assert.equal(r.status, 200);
  const co2 = calls.find((c) => c.path === "checkout/sessions"); assert.equal(co2.params["line_items[0][price]"], bo.prices.t5.month.id); assert.equal(co2.params["subscription_data[application_fee_percent]"], "2.50");
  assert.equal((await post("/api/me/membership/bo-pay/checkout", { tier: "t10", interval: "month" }, sam.cookie)).status, 400, "a tier the host doesn't offer");
  assert.equal((await post("/api/me/membership/bo-pay/checkout", { tier: "t5", interval: "week" }, sam.cookie)).status, 400);
  assert.equal((await post("/api/me/membership/bo-pay/checkout", { tier: "t5", interval: "month" }, bo.cookie)).status, 400, "not your own");
  assert.equal((await post("/api/me/membership/bo-pay/checkout", { tier: "t5", interval: "month" })).status, 401);
  // a member opens the portal on the host's account
  await joinAs(bo, sam, "t20", "year", "sub_sam");
  calls = []; r = await post("/api/me/membership/bo-pay/portal", {}, sam.cookie); j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j)); assert.match(j.url, /billing\.stripe\.com/);
  const ps = calls.find((c) => c.path === "billing_portal/sessions"); assert.equal(ps.account, bo.acct); assert.equal(ps.params.customer, "cus_sub_sam"); assert.equal(ps.params.configuration, "bpc_1");
  assert.equal((await post("/api/me/membership/bo-pay/checkout", { tier: "t5", interval: "month" }, sam.cookie)).status, 409, "already a member: change it in Manage");
  // the host's payouts link
  r = await post("/api/host/membership/dashboard", {}, bo.cookie); assert.match((await r.json()).url, /connect\.stripe\.com\/express/);
  // the host sees them, with revenue
  const v = await getJ("/api/host/membership", bo.cookie); assert.equal(v.stats.members, 1); assert.equal(v.stats.mrr, 16.67); assert.equal(v.members[0].tier, "Patron"); assert.equal(v.members[0].interval, "year"); assert.match(v.members[0].status, /^Renews /);
  // changing a price makes a new one and archives the old
  calls = []; r = await post("/api/host/membership", { tiers: [TIERS[0], { ...TIERS[1], yearly: 220 }] }, bo.cookie); assert.equal(r.status, 200);
  assert.equal(calls.filter((c) => c.path === "prices").length, 1); assert.ok(calls.some((c) => c.path === "prices/" + bo.prices.t20.year.id && c.params.active === "false"));
});

test("webhooks: the signature is checked, each event is handled once, and subscriptions move through their states", async () => {
  const bo = await openHost("Bo Hook", "bo-hook"), ana = await person("Ana Lee"), M = srv.app.locals.memberships, key = M.mKey(ana.email), price = bo.prices.t5.month;
  await post("/api/me/membership/bo-hook/checkout", { tier: "t5", interval: "month" }, ana.cookie);
  const base = { key, ws: bo.ws, tier: "t5", email: ana.email, price: price.id, amount: 500, extra: { id: "sub_ana", customer: "cus_ana" } };
  let w = await hook("customer.subscription.created", sub(base), bo.acct, { sig: "t=1,v1=deadbeef" }); assert.equal(w.status, 400); assert.equal(w.body.code, "bad_signature");
  w = await hook("customer.subscription.created", sub(base), bo.acct, { secret: "whsec_wrongsecret999" }); assert.equal(w.status, 400);
  assert.equal(M.rankOf(bo.ws, ana.email), 0, "nothing changed");
  w = await hook("checkout.session.completed", { id: "cs_1", mode: "subscription", client_reference_id: key, customer: "cus_ana", subscription: "sub_ana" }, bo.acct); assert.equal(w.body.checkout, true);
  assert.equal(M.rankOf(bo.ws, ana.email), 0, "paid for, but not active until the subscription says so");
  const t0 = Math.floor(Date.now() / 1000) + 100;
  w = await hook("customer.subscription.created", sub(base), bo.acct, { created: t0, id: "evt_once1" }); assert.equal(w.body.status, "active"); assert.equal(M.rankOf(bo.ws, ana.email), 1);
  w = await hook("customer.subscription.created", sub(base), bo.acct, { created: t0, id: "evt_once1" }); assert.equal(w.body.duplicate, true, "the same event twice is handled once");
  assert.ok(srv.app.locals.fanclub.isMember(bo.ws, ana.email), "a paying member is in the fan club too (chat, notes)");
  const page = await getJ("/api/public/host/bo-hook", ana.cookie); assert.equal(page.membership.me.name, "Regular"); assert.ok(page.membership.me.perks.length);
  // an older event arriving late doesn't undo a newer one
  w = await hook("customer.subscription.updated", sub({ ...base, extra: { ...base.extra, cancel_at_period_end: true } }), bo.acct, { created: t0 + 10 }); assert.equal(M.memberOf(bo.ws, ana.email).cancelAtPeriodEnd, true);
  w = await hook("customer.subscription.updated", sub(base), bo.acct, { created: t0 + 5 }); assert.equal(w.body.stale, true); assert.equal(M.memberOf(bo.ws, ana.email).cancelAtPeriodEnd, true);
  assert.equal(M.rankOf(bo.ws, ana.email), 1, "cancelling keeps access until the period ends");
  assert.match((await getJ("/api/host/membership", bo.cookie)).members[0].status, /^Ends /);
  // a payment fails: past due still has access, and the member hears
  w = await hook("invoice.payment_failed", { id: "in_1", subscription: "sub_ana", customer: "cus_ana" }, bo.acct); assert.equal(w.body.paymentFailed, true);
  w = await hook("customer.subscription.updated", sub({ ...base, extra: { ...base.extra, status: "past_due" } }), bo.acct, { created: t0 + 20 }); assert.equal(M.rankOf(bo.ws, ana.email), 1);
  const inbox = (await getJ("/api/me/inbox", ana.cookie)).items; assert.ok(inbox.some((x) => /didn't go through/.test(x.text)), "told to update the card");
  // they cancelled before the period ended: access stays until then
  w = await hook("customer.subscription.deleted", sub({ ...base, extra: { ...base.extra, status: "canceled", ended_at: Math.floor(Date.now() / 1000), cancellation_details: { reason: "cancellation_requested" } } }), bo.acct, { created: t0 + 30 });
  assert.equal(M.memberOf(bo.ws, ana.email).status, "canceled"); assert.equal(M.rankOf(bo.ws, ana.email), 1, "grace until the paid period ends");
  // unpaid and ended: no access
  w = await hook("customer.subscription.deleted", sub({ ...base, extra: { ...base.extra, status: "canceled", current_period_end: Math.floor(Date.now() / 1000) - 10, ended_at: Math.floor(Date.now() / 1000), cancellation_details: { reason: "payment_failed" } } }), bo.acct, { created: t0 + 40 });
  assert.equal(M.rankOf(bo.ws, ana.email), 0);
  // events for an account that isn't a host here are ignored
  w = await hook("customer.subscription.created", sub(base), "acct_stranger"); assert.equal(w.body.ignored, "unknown_account");
  // the host's account finishing onboarding is picked up
  w = await hook("account.updated", { id: bo.acct, charges_enabled: false, details_submitted: true }, bo.acct); assert.equal(M.config(bo.ws).chargesEnabled, false);
});

test("priority access on replies: tier by tier, not by typing a member's email, waitlist for everyone else, then open", async () => {
  const bo = await openHost("Bo Window", "bo-win"), pat = await person("Pat Ron"), reg = await person("Rey Gular"), out = await person("Otto Side"), M = srv.app.locals.memberships;
  await joinAs(bo, pat, "t20"); await joinAs(bo, reg, "t5");
  assert.equal((await put("events/win1", { name: "Pork and chive night", kind: "social", casual: true, date: day(10), startTime: "19:00", city: "New York", headcount: 10, discoverable: true, published: true }, bo.cookie)).status, 200);
  const W = M.windowOf(bo.ws, "win1"); assert.ok(W, "publishing opened the window"); assert.ok(W.publicAt > Date.now() + 71 * 3600e3, "the top tier's 72 hours");
  assert.ok(W.opens[3] <= Date.now(), "Patrons are in now"); assert.ok(W.opens[1] > Date.now() + 47 * 3600e3, "Regulars 24 hours before the public");
  // the member hears, a muted one doesn't
  assert.ok((await getJ("/api/me/inbox", pat.cookie)).items.some((x) => /Patron early access is open/.test(x.text)));
  assert.ok(!(await getJ("/api/me/inbox", reg.cookie)).items.some((x) => /early access is open/i.test(x.text)), "not yet: their window hasn't opened");
  let r = await guestRsvp(bo.ws, { eventId: "win1", name: "Otto", email: out.email, response: "going" }, out.cookie); let j = await r.json();
  assert.equal(r.status, 403); assert.equal(j.code, "members_window"); assert.match(j.message, /^Opens to everyone on \w{3} at \d/); assert.equal(j.canWait, true); assert.ok(j.publicAt > Date.now());
  r = await guestRsvp(bo.ws, { eventId: "win1", name: "Otto", email: pat.email, response: "going" }, out.cookie); assert.equal(r.status, 403, "typing a Patron's email doesn't make you one");
  r = await guestRsvp(bo.ws, { eventId: "win1", name: "Anon", email: pat.email, response: "going" }); assert.equal(r.status, 403, "signed out with a Patron's email: still no");
  r = await guestRsvp(bo.ws, { eventId: "win1", name: "Rey", email: reg.email, response: "going" }, reg.cookie); j = await r.json(); assert.equal(r.status, 403); assert.match(j.message, /^Your early access opens on/);
  r = await guestRsvp(bo.ws, { eventId: "win1", name: "Pat", email: pat.email, response: "going" }, pat.cookie); j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j)); assert.equal(j.response, "going");
  // the fan club gate steps aside (server/fanclub.js rsvpGate) and the light invite says it plainly
  assert.equal(srv.app.locals.fanclub.rsvpGate(bo.ws, "win1", [out.email]), null);
  const line = await getJ("/api/public/seats/win1", out.cookie); assert.equal(line.can, false); assert.equal(line.wait, true); assert.match(line.line, /^Opens to everyone on/);
  assert.match((await getJ("/api/public/seats/win1", pat.cookie)).line, /^Patron early access is open/);
  // join the waitlist: it waits until the window ends, even with seats free
  r = await guestRsvp(bo.ws, { eventId: "win1", name: "Otto", email: out.email, response: "going", joinWait: true }, out.cookie); j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j)); assert.equal(j.response, "waitlist");
  const KEY = "kmaybe" + Date.now();
  r = await fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, "x-encore-guest": "1", "x-encore-key": KEY, "x-encore-workspace": bo.ws }, body: JSON.stringify({ eventId: "win1", name: "Patty", email: "plus@example.com", response: "maybe", code: "MAYBE1" }) });
  assert.equal(r.status, 200, "Maybe holds no seat, so anyone can say it"); const mid = String((await r.json()).id || "").split("/").pop();
  r = await fetch(srv.base + "/api/db/doc?path=rsvps/" + mid, { method: "PUT", headers: { ...J, "x-encore-guest": "1", "x-encore-key": KEY, "x-encore-workspace": bo.ws }, body: JSON.stringify({ eventId: "win1", name: "Patty", email: "plus@example.com", response: "going" }) });
  assert.equal(r.status, 403, "changing a Maybe to I'm in goes through the same check");
  const otto = () => scopeStore(srv.store, bo.ws).list("rsvps").find((d) => d.data.eventId === "win1" && d.data.email === out.email)?.data;
  assert.equal(otto().response, "waitlist"); assert.ok(otto().memberWait > Date.now());
  // Regulars' turn
  M.setEvent(bo.ws, "win1", { publicAt: Date.now() + 12 * 3600e3 });
  await M.runJobs(); assert.ok((await getJ("/api/me/inbox", reg.cookie)).items.some((x) => /Regular early access is open/.test(x.text)), "Regulars hear when theirs opens");
  r = await guestRsvp(bo.ws, { eventId: "win1", name: "Rey", email: reg.email, response: "going" }, reg.cookie); assert.equal(r.status, 200);
  assert.equal(otto().response, "waitlist", "still waiting while members book");
  // it opens to everyone: the waitlist moves up, and anyone can reply
  M.setEvent(bo.ws, "win1", { publicAt: Date.now() - 1000 });
  const jobs = await M.runJobs(); assert.ok(jobs.released >= 1); assert.equal(otto().response, "going", "the person who waited got the spot");
  const late = await person("Lou Late"); r = await guestRsvp(bo.ws, { eventId: "win1", name: "Lou", email: late.email, response: "going" }, late.cookie); assert.equal(r.status, 200);
  assert.equal(srv.app.locals.fanclub.rsvpGate(bo.ws, "win1", [late.email]), null);
});

test("priority access on orders, members-only events and a personal invite", async () => {
  const bo = await openHost("Bo Drop", "bo-drop"), pat = await person("Pat Drop"), out = await person("Otto Drop"), M = srv.app.locals.memberships;
  await joinAs(bo, pat, "t20");
  assert.equal((await put("events/drop1", { name: "Pandan cake drop", kind: "social", casual: true, date: day(9), city: "New York", preorder: true, drop: true, headcount: 20, items: [{ name: "Cake", price: 30 }], discoverable: true, published: true }, bo.cookie)).status, 200);
  assert.ok(M.windowOf(bo.ws, "drop1"));
  let r = await guestRsvp(bo.ws, { eventId: "drop1", name: "Otto", email: out.email, response: "going", orderQty: { Cake: 1 } }, out.cookie); let j = await r.json();
  assert.equal(r.status, 403, JSON.stringify(j)); assert.equal(j.code, "members_window"); assert.equal(j.canWait, false, "orders don't wait in line");
  r = await guestRsvp(bo.ws, { eventId: "drop1", name: "Otto", email: out.email, response: "going", orderQty: { Cake: 1 }, joinWait: true }, out.cookie); assert.equal(r.status, 403, "no waitlist for an order");
  r = await guestRsvp(bo.ws, { eventId: "drop1", name: "Pat", email: pat.email, response: "going", orderQty: { Cake: 1 } }, pat.cookie); j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j));
  // members only
  assert.equal((await put("events/only1", { name: "Test kitchen", kind: "social", casual: true, date: day(12), city: "New York", headcount: 8, published: true }, bo.cookie)).status, 200);
  r = await post("/api/host/membership/events/only1", { only: true }, bo.cookie); assert.equal(r.status, 200, await r.text());
  r = await guestRsvp(bo.ws, { eventId: "only1", name: "Otto", email: out.email, response: "going" }, out.cookie); j = await r.json(); assert.equal(r.status, 403); assert.equal(j.code, "members_only");
  const read = await fetch(srv.base + "/api/db/doc?path=events/only1", { headers: { "x-encore-guest": "1", cookie: out.cookie } }); assert.equal(read.status, 403, "hidden from non-members");
  r = await guestRsvp(bo.ws, { eventId: "only1", name: "Pat", email: pat.email, response: "going" }, pat.cookie); assert.equal(r.status, 200);
  // someone the host invited personally skips the wait
  assert.equal((await put("events/inv1", { name: "Supper for a few", kind: "social", casual: true, date: day(11), city: "New York", headcount: 8, published: true }, bo.cookie)).status, 200);
  const friend = await person("Fran Invited"); scopeStore(srv.store, bo.ws).set("invplans/inv1", { people: { [idOf(keyFor(friend.email))]: { invitedAt: Date.now() } } });
  r = await guestRsvp(bo.ws, { eventId: "inv1", name: "Otto", email: out.email, response: "going" }, out.cookie); assert.equal(r.status, 403);
  r = await guestRsvp(bo.ws, { eventId: "inv1", name: "Fran", email: friend.email, response: "going" }, friend.cookie); assert.equal(r.status, 200, await r.text());
  // the host can turn the window off for one event
  r = await post("/api/host/membership/events/drop1", { on: false }, bo.cookie); assert.equal(r.status, 200);
  r = await guestRsvp(bo.ws, { eventId: "drop1", name: "Otto", email: out.email, response: "going", orderQty: { Cake: 1 } }, out.cookie); assert.equal(r.status, 200, await r.text());
});

test("held member seats: only the right tier takes them, never past capacity, and they go to everyone when it opens", async () => {
  const bo = await openHost("Bo Seats", "bo-seat"), pat = await person("Pat Seat"), reg = await person("Reg Seat"), reg2 = await person("Reg Two"), M = srv.app.locals.memberships, Z = srv.app.locals.seats;
  await joinAs(bo, pat, "t20"); await joinAs(bo, reg, "t5"); await joinAs(bo, reg2, "t5");
  assert.equal((await put("events/seat1", { name: "Six seats", kind: "social", casual: true, date: day(14), city: "New York", headcount: 3, published: true, discoverable: true }, bo.cookie)).status, 200);
  let r = await post("/api/host/membership/events/seat1", { seats: 5 }, bo.cookie); let j = await r.json(); assert.equal(r.status, 400); assert.equal(j.code, "over_capacity"); assert.match(j.message, /up to 3 seats/);
  r = await post("/api/host/membership/events/seat1", { seats: 2, publicAt: Date.now() + 3600e3 }, bo.cookie); j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j)); assert.equal(j.event.seats, 2);
  const blk = Z.cfgOf(bo.ws, "seat1").blocks.find((b) => b.kind === "member"); assert.equal(blk.n, 2); assert.equal(blk.minRank, 3, "held for the tier with the seats perk"); assert.equal(blk.releaseAt, M.windowOf(bo.ws, "seat1").publicAt);
  // a host editing their seat blocks can't drop the members' block by accident
  Z.setCfg(bo.ws, "seat1", { blocks: [{ kind: "everyone", n: 1 }] }); assert.ok(Z.cfgOf(bo.ws, "seat1").blocks.some((b) => b.kind === "member"));
  Z.setCfg(bo.ws, "seat1", { blocks: [] });
  // Regulars are open (24h before a public open 1h away) but can't take the Patrons' seats
  r = await guestRsvp(bo.ws, { eventId: "seat1", name: "Reg", email: reg.email, response: "going" }, reg.cookie); j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j)); assert.equal(j.response, "going", "the one open seat");
  r = await guestRsvp(bo.ws, { eventId: "seat1", name: "Reg2", email: reg2.email, response: "going" }, reg2.cookie); j = await r.json(); assert.equal(j.response, "waitlist", "the other two are held for Patrons");
  r = await guestRsvp(bo.ws, { eventId: "seat1", name: "Pat", email: pat.email, response: "going" }, pat.cookie); j = await r.json(); assert.equal(j.response, "going");
  const rs = scopeStore(srv.store, bo.ws).list("rsvps").filter((d) => d.data.eventId === "seat1"); assert.equal(rs.find((d) => d.data.email === pat.email).data.seatBlock, "members");
  // opening to everyone releases the unclaimed held seat, and the waitlist moves up into it
  scopeStore(srv.store, bo.ws).update("memberevents/seat1", { publicAt: Date.now() - 1000 }); M.syncSeats(bo.ws, "seat1");
  const st = Z.summary(bo.ws, "seat1", scopeStore(srv.store, bo.ws).get("events/seat1").data); const mb = st.blocks.find((b) => b.kind === "member"); assert.equal(mb.released, true); assert.equal(mb.cap, 1, "only the claimed seat stays held");
  await M.runJobs();
  assert.equal(scopeStore(srv.store, bo.ws).list("rsvps").find((d) => d.data.email === reg2.email).data.response, "going", "the released seat went to the next in line");
});

test("a member the host blocks loses access now and stops paying at the period's end", async () => {
  const bo = await openHost("Bo Block", "bo-mblock"), ana = await person("Ana Block"), M = srv.app.locals.memberships;
  const { subId } = await joinAs(bo, ana, "t20"); assert.equal(M.rankOf(bo.ws, ana.email), 3);
  assert.equal((await post("/api/me/blocks", { kind: "person", key: Buffer.from(ana.email).toString("base64url") }, bo.cookie)).status, 200);
  assert.equal(M.rankOf(bo.ws, ana.email), 0, "no perks from the moment they're blocked");
  calls = []; const r = await M.runJobs(); assert.ok(r.cancelled >= 1);
  const c = calls.find((x) => x.path === "subscriptions/" + subId); assert.ok(c, "Stripe was told"); assert.equal(c.account, bo.acct); assert.equal(c.params.cancel_at_period_end, "true", "cancelled at the period's end, never refunded by us");
  const m = M.memberOf(bo.ws, ana.email); assert.ok(m.removedAt); assert.equal(m.cancelAtPeriodEnd, true);
  assert.equal((await post("/api/me/membership/bo-mblock/checkout", { tier: "t5", interval: "month" }, ana.cookie)).status, 403, "can't sign up again");
  calls = []; await M.runJobs(); assert.equal(calls.filter((x) => x.path.startsWith("subscriptions/")).length, 0, "only once");
  // the host removing a member does the same
  const sam = await person("Sam Remove"); const j2 = await joinAs(bo, sam, "t5");
  calls = []; const rr = await post(`/api/host/membership/members/${j2.key}/remove`, {}, bo.cookie); assert.equal(rr.status, 200);
  assert.equal(M.rankOf(bo.ws, sam.email), 0); assert.ok(calls.some((x) => x.path === "subscriptions/" + j2.subId));
  assert.ok(!srv.app.locals.fanclub.isMember(bo.ws, sam.email), "out of the club too");
});

test("the native app never gets the purchase path: no prices, no Checkout, a link to the web", async () => {
  const bo = await openHost("Bo App", "bo-app"), sam = await person("Sam App");
  const web = await getJ("/api/public/host/bo-app", sam.cookie); assert.equal(web.membership.on, true); assert.equal(web.membership.webOnly, false); assert.equal(web.membership.tiers[1].monthly, 20);
  const app = await getJ("/api/public/host/bo-app", sam.cookie, { "user-agent": APP_UA }); assert.equal(app.membership.webOnly, true); assert.ok(app.membership.tiers.length, "tiers and perks are described");
  assert.ok(app.membership.tiers.every((t) => t.monthly == null && t.yearly == null), "no prices in the app"); assert.match(app.membership.joinUrl, /\/@bo-app#membership$/);
  calls = []; let r = await post("/api/me/membership/bo-app/checkout", { tier: "t5", interval: "month" }, sam.cookie, { "user-agent": APP_UA }); assert.equal(r.status, 403); assert.equal((await r.json()).code, "web_only");
  r = await post("/api/me/membership/bo-app/checkout", { tier: "t5", interval: "month" }, sam.cookie, { "x-encore-native": "1" }); assert.equal(r.status, 403);
  assert.equal(calls.length, 0, "nothing reached Stripe");
  assert.equal((await post("/api/me/membership/bo-app/portal", {}, sam.cookie, { "user-agent": APP_UA })).status, 403);
});

test("the host writes members a note: it reaches the right tiers, not muted members", async () => {
  const bo = await openHost("Bo Note", "bo-note"), pat = await person("Pat Note"), reg = await person("Reg Note"), mute = await person("Mute Note");
  await joinAs(bo, pat, "t20"); await joinAs(bo, reg, "t5"); await joinAs(bo, mute, "t20");
  await post("/api/me/club/bo-note/settings", { muted: true }, mute.cookie);
  const r = await post("/api/host/membership/note", { text: "Next month: pork and chive. Patrons pick the date.", minRank: 3 }, bo.cookie); const j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j)); assert.equal(j.sent, 1);
  assert.ok((await getJ("/api/me/inbox", pat.cookie)).items.some((x) => /pork and chive/.test(x.text)));
  assert.ok(!(await getJ("/api/me/inbox", reg.cookie)).items.some((x) => /pork and chive/.test(x.text)), "a lower tier isn't sent it");
  assert.ok(!(await getJ("/api/me/inbox", mute.cookie)).items.some((x) => /pork and chive/.test(x.text)), "muted");
  const page = await getJ("/api/public/host/bo-note", pat.cookie); assert.match(page.membership.me.notes[0].text, /pork and chive/);
  // the badge perk: the tier's name on the member's own page, when they show the club badge
  await post("/api/me/club/bo-note/settings", { showBadge: true }, pat.cookie);
  assert.equal(srv.app.locals.fanclub.clubMemberships(pat.email).find((c) => c.handle === "bo-note").tier, "Patron");
});
