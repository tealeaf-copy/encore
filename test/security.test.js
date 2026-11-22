import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer } from "./helpers.js";
import { hashPassword, resetLoginLimits, startupProblems } from "../server/auth.js";

let srv;
const MAYA = hashPassword("maya-pw"), SAM = hashPassword("sam-pw");
const TEAM = `Maya Chen|maya@acme.com|Event lead+Account execs|${MAYA};Sam Lee|sam@acme.com|Exec sponsor|${SAM}`;
before(async () => { srv = await startServer(); });
beforeEach(() => {
  process.env.APP_PASSWORD = "team-pass"; process.env.SESSION_SECRET = "test-secret"; process.env.ENCORE_USERS = TEAM;
  delete process.env.ENCORE_APPROVER_ROLES; resetLoginLimits();
});
after(async () => { for (const k of ["APP_PASSWORD", "SESSION_SECRET", "ENCORE_USERS", "ENCORE_APPROVER_ROLES"]) delete process.env[k]; await srv.close(); });

const J = { "Content-Type": "application/json" };
const G = { "x-encore-guest": "1", "x-encore-key": "guest-key-1", ...J };
const login = (body) => fetch(srv.base + "/api/login", { method: "POST", headers: J, body: JSON.stringify(body) });
const signIn = async (email = "maya@acme.com", password = "maya-pw") => { const r = await login({ email, password }); assert.equal(r.status, 200); return r.headers.get("set-cookie").split(";")[0]; };

test("guests only see the public brand fields", async () => {
  srv.store.set("brands/main", { company: "Acme", logo: "data:image/png;base64,AAA", colors: ["#123456", "#abcdef"], fonts: ["Fraunces"], voice: { adjectives: ["warm"] }, tagline: "Hi",
    program: { annual: 400000 }, accounts: [{ name: "Big Co", arr: 900000 }], notes: "call notes", playbooks: [{ x: 1 }], knowledge: { crm: "x" }, kdocs: {}, strategy: "s", audience: { titles: ["CMO"] } });
  const g = await fetch(srv.base + "/api/db/doc?path=brands/main", { headers: G }).then((r) => r.json());
  assert.equal(g.data.company, "Acme");
  assert.deepEqual(g.data.colors, ["#123456", "#abcdef"]);
  assert.ok(g.data.logo && g.data.fonts && g.data.voice && g.data.tagline);
  for (const k of ["program", "budget", "accounts", "notes", "playbooks", "knowledge", "kdocs", "strategy", "audience"]) assert.equal(k in g.data, false, `guest sees ${k}`);
  const cookie = await signIn();
  const full = await fetch(srv.base + "/api/db/doc?path=brands/main", { headers: { cookie } }).then((r) => r.json());
  assert.equal(full.data.program.annual, 400000, "the team still sees everything");
});

test("uploads: only safe types, served sandboxed with nosniff", async () => {
  const cookie = await signIn();
  const up = (type, body = "x") => fetch(srv.base + "/api/assets", { method: "POST", headers: { cookie, "Content-Type": type }, body });
  assert.equal((await up("text/html", "<script>alert(1)</script>")).status, 415);
  assert.equal((await up("application/xhtml+xml")).status, 415);
  assert.equal((await up("application/octet-stream")).status, 415);
  const png = await (await up("image/png", "PNG")).json();
  let r = await fetch(srv.base + png.url);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("content-security-policy"), "default-src 'none'; img-src 'self'; media-src 'self'; sandbox");
  assert.equal(r.headers.get("content-disposition"), null, "images show inline");
  const svg = await (await up("image/svg+xml", "<svg onload='alert(1)'/>")).json();
  r = await fetch(srv.base + svg.url);
  assert.equal(r.headers.get("content-disposition"), "attachment", "SVG is downloaded, not rendered");
  assert.match(r.headers.get("content-security-policy"), /sandbox/);
  const csv = await (await up("text/csv; charset=utf-8", "a,b")).json();
  assert.equal((await fetch(srv.base + csv.url)).headers.get("content-disposition"), "attachment");
  // A file stored before the restriction is served as a sandboxed download.
  const dir = path.join(srv.dir, "assets");
  fs.writeFileSync(path.join(dir, "OLDOLDOLDOLDOLDOLD00"), "<script>alert(1)</script>");
  fs.writeFileSync(path.join(dir, "OLDOLDOLDOLDOLDOLD00.json"), JSON.stringify({ id: "OLDOLDOLDOLDOLDOLD00", contentType: "text/html" }));
  r = await fetch(srv.base + "/_blob/OLDOLDOLDOLDOLDOLD00");
  assert.equal(r.headers.get("content-type"), "application/octet-stream");
  assert.equal(r.headers.get("content-disposition"), "attachment");
});

test("login is rate limited per IP and email", async () => {
  for (let i = 0; i < 10; i++) assert.equal((await login({ email: "sam@acme.com", password: "guess" + i })).status, 401);
  const blocked = await login({ email: "sam@acme.com", password: "sam-pw" });
  assert.equal(blocked.status, 429, "even the right password waits out the window");
  assert.ok(+blocked.headers.get("retry-after") > 0);
  assert.equal((await login({ email: "maya@acme.com", password: "maya-pw" })).status, 200, "other accounts aren't locked");
  const form = await fetch(srv.base + "/api/login", { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "email=sam%40acme.com&password=x" });
  assert.equal(form.headers.get("location"), "/login?error=3");
});

test("logout revokes the session on the server", async () => {
  const a = await signIn(), b = await signIn();
  assert.equal((await fetch(srv.base + "/api/me", { headers: { cookie: a } })).status, 200);
  assert.equal((await fetch(srv.base + "/api/logout", { method: "POST", headers: { cookie: a } })).status, 200);
  assert.equal((await fetch(srv.base + "/api/me", { headers: { cookie: a } })).status, 401, "a kept copy of the cookie stops working");
  assert.equal((await fetch(srv.base + "/api/me", { headers: { cookie: b } })).status, 200, "other sessions keep working");
  // shared-password mode too
  delete process.env.ENCORE_USERS;
  const r = await login({ password: "team-pass" }), c = r.headers.get("set-cookie").split(";")[0];
  assert.equal((await fetch(srv.base + "/api/db/collection?path=events", { headers: { cookie: c } })).status, 200);
  await fetch(srv.base + "/api/logout", { method: "POST", headers: { cookie: c } });
  assert.equal((await fetch(srv.base + "/api/db/collection?path=events", { headers: { cookie: c } })).status, 401);
  assert.equal((await fetch(srv.base + "/api/db/collection?path=system", { headers: { cookie: await (async () => { const x = await login({ password: "team-pass" }); return x.headers.get("set-cookie").split(";")[0]; })() } })).status, 403, "revocations aren't readable through the data API");
});

test("approvers without a personal password stop the server from starting", () => {
  process.env.ENCORE_USERS = `Maya Chen|maya@acme.com|Event lead|${MAYA};Sam Lee|sam@acme.com|Exec sponsor`;
  assert.match(startupProblems()[0], /Sam Lee <sam@acme.com>/);
  process.env.ENCORE_APPROVER_ROLES = "Event lead";
  assert.deepEqual(startupProblems(), [], "Sam isn't an approver once approver roles are set");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "encore-start-"));
  try {
    const r = spawnSync(process.execPath, ["server/index.js"], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8", timeout: 10000,
      env: { ...process.env, ENCORE_APPROVER_ROLES: "", ENCORE_USERS: process.env.ENCORE_USERS, SESSION_SECRET: "s", APP_PASSWORD: "p", DATA_DIR: dir, PORT: "0", HOST: "127.0.0.1" } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Refusing to start: .*Sam Lee/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("approvers: configured roles, server decides fully approved, no cap at 4", async () => {
  const maya = await signIn(), sam = await signIn("sam@acme.com", "sam-pw");
  const put = (p, body) => fetch(srv.base + "/api/db/doc?path=" + p, { method: "PUT", headers: { cookie: maya, ...J }, body: JSON.stringify(body) });
  const approve = (cookie, role) => fetch(srv.base + "/api/approve", { method: "POST", headers: { cookie, ...J }, body: JSON.stringify({ eventId: "evA", role }) });
  const state = () => fetch(srv.base + "/api/approvals?eventId=evA", { headers: { cookie: maya } }).then((r) => r.json());
  await put("events/evA", { name: "A", budget: 1000 });
  let s = await state();
  assert.deepEqual(s.required, ["Event lead", "Account execs", "Exec sponsor"]);
  assert.equal(s.fullyApproved, false);
  process.env.ENCORE_APPROVER_ROLES = "Event lead, Exec sponsor";
  assert.equal((await approve(maya, "account execs")).status, 403, "not an approver role");
  assert.equal((await approve(maya, "EVENT LEAD")).status, 200);
  s = await state();
  assert.deepEqual(s.required, ["Event lead", "Exec sponsor"]);
  assert.deepEqual(Object.keys(s.roles), ["Event lead"], "stored under the configured spelling");
  assert.equal(s.fullyApproved, false);
  const last = await (await approve(sam, "exec sponsor")).json();
  assert.equal(last.fullyApproved, true);
  assert.equal((await state()).fullyApproved, true);
  const log = await fetch(srv.base + "/api/audit?eventId=evA", { headers: { cookie: maya } }).then((r) => r.json());
  assert.match(log.entries[0].what, /as Exec sponsor$/);
  assert.match(log.entries[1].what, /as Event lead$/);
  const me = await fetch(srv.base + "/api/me", { headers: { cookie: maya } }).then((r) => r.json());
  assert.deepEqual(me.approverRoles, ["Event lead", "Exec sponsor"]);
  // Without ENCORE_APPROVER_ROLES every team role is required, even past 4.
  delete process.env.ENCORE_APPROVER_ROLES;
  process.env.ENCORE_USERS = `Maya Chen|maya@acme.com|R1+R2+R3|${MAYA};Sam Lee|sam@acme.com|R4+R5+R6|${SAM}`;
  assert.deepEqual((await state()).required, ["R1", "R2", "R3", "R4", "R5", "R6"]);
});

test("named people without a personal password can't approve", async () => {
  process.env.ENCORE_USERS = `Maya Chen|maya@acme.com|Event lead`;
  srv.store.set("events/evN", { name: "N" });
  const cookie = await signIn("maya@acme.com", "team-pass");
  const r = await fetch(srv.base + "/api/approve", { method: "POST", headers: { cookie, ...J }, body: JSON.stringify({ eventId: "evN", role: "Event lead" }) });
  assert.equal(r.status, 403);
});

test("guest wall, RSVPs and nominations", async () => {
  const cookie = await signIn();
  srv.store.set("events/evW", { name: "W", updatedAt: 5 });
  srv.store.set("wall/evW--a", { eventId: "evW", name: "Ana", title: "VP", company: "Acme", status: "going", owner: "Sam", email: "ana@acme.com", photo: "", learn: "x" });
  srv.store.set("wall/evW--b", { eventId: "evW", name: "Bo", status: "hidden" });
  srv.store.set("wall/evW--c", { eventId: "evW", name: "Cy", status: "maybe" });
  const wall = await fetch(srv.base + "/api/db/collection?path=wall&eventId=evW", { headers: G }).then((r) => r.json());
  assert.deepEqual(wall.docs.map((d) => d.data.name).sort(), ["Ana", "Cy"], "only people going or maybe who opted in; hidden entries stay hidden");
  assert.equal(wall.docs[0].data.owner, undefined);
  assert.equal(wall.docs[0].data.email, undefined);
  assert.equal((await fetch(srv.base + "/api/db/collection?path=rsvps&eventId=evW", { headers: G })).status, 401, "guests can't list RSVPs");

  // RSVPs from guests are stamped and limited to the answers a guest can give
  let r = await fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: G, body: JSON.stringify({ eventId: "evW", name: "Dee", response: "going", source: "VIP list", utm: { utm_source: "linkedin", utm_campaign: "q1", junk: "x" } }) });
  assert.equal(r.status, 200);
  const saved = srv.store.get("rsvps/" + (await r.json()).id).data;
  assert.equal(saved.source, "guest");
  assert.deepEqual(saved.utm, { utm_source: "linkedin", utm_campaign: "q1" });
  r = await fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: G, body: JSON.stringify({ eventId: "evW", name: "Eve", response: "approved" }) });
  assert.equal(r.status, 400);
  r = await fetch(srv.base + "/api/db/doc?path=rsvps/evW--u9", { method: "PUT", headers: G, body: JSON.stringify({ eventId: "evW", name: "Fay", response: "maybe" }) });
  assert.equal(r.status, 200);
  r = await fetch(srv.base + "/api/db/doc?path=rsvps/evW--u9", { method: "PATCH", headers: G, body: JSON.stringify({ status: "Attended" }) });
  assert.equal(r.status, 400, "a guest can't mark themselves attended");
  r = await fetch(srv.base + "/api/db/doc?path=wall/evW--f", { method: "PUT", headers: G, body: JSON.stringify({ eventId: "evW", name: "Fay", status: "vip" }) });
  assert.equal(r.status, 400);
  r = await fetch(srv.base + "/api/db/doc?path=rsvps/evW--t1", { method: "PUT", headers: { cookie, ...J }, body: JSON.stringify({ eventId: "evW", name: "Gil", response: "approved", source: "Team" }) });
  assert.equal(r.status, 200, "the team can set any status");
  assert.equal(srv.store.get("rsvps/evW--t1").data.source, "Team");

  // nominations need a signed-in AE
  r = await fetch(srv.base + "/api/db/doc?path=nominations/evW--sam-lee", { method: "PUT", headers: G, body: JSON.stringify({ eventId: "evW", picks: [] }) });
  assert.equal(r.status, 401);
  r = await fetch(srv.base + "/api/db/collection?path=nominations", { method: "POST", headers: G, body: "{}" });
  assert.equal(r.status, 401);
  r = await fetch(srv.base + "/api/db/doc?path=nominations/evW--sam-lee", { method: "PUT", headers: { cookie, ...J }, body: JSON.stringify({ eventId: "evW", picks: [] }) });
  assert.equal(r.status, 200);
});

test("event saves without _base can't overwrite a versioned event", async () => {
  const cookie = await signIn(), H = { cookie, ...J };
  srv.store.set("events/evV", { name: "V", updatedAt: 7 });
  let r = await fetch(srv.base + "/api/db/doc?path=events/evV", { method: "PUT", headers: H, body: JSON.stringify({ name: "V2", updatedAt: 8 }) });
  assert.equal(r.status, 409);
  r = await fetch(srv.base + "/api/db/doc?path=events/evV", { method: "PATCH", headers: H, body: JSON.stringify({ name: "V2" }) });
  assert.equal(r.status, 409);
  r = await fetch(srv.base + "/api/db/doc?path=events/evV", { method: "PUT", headers: H, body: JSON.stringify({ name: "V2", _base: 7, updatedAt: 8 }) });
  assert.equal(r.status, 200);
  assert.equal(srv.store.get("events/evV").data._base, undefined, "_base isn't stored");
  r = await fetch(srv.base + "/api/db/doc?path=events/evNew", { method: "PUT", headers: H, body: JSON.stringify({ name: "New", updatedAt: 1 }) });
  assert.equal(r.status, 200, "a new event needs no _base");
});

test("signed personal invites greet just that guest", async () => {
  const cookie = await signIn(), H = { cookie, ...J };
  srv.store.set("events/evI", { name: "I", guests: [
    { name: "Ana Diaz", title: "VP", company: "Acme", email: "Ana@Acme.com", owner: "Sam Lee", status: "Invited", note: "secret", arr: 9 },
    { id: "g2", name: "Bo Chan", title: "CMO", company: "Beta", email: "bo@beta.com", owner: "Kim Park", status: "Going", optIn: true },
    { name: "Cy Ng", company: "Gamma", owner: "Sam Lee", status: "Going", optIn: true },
    { name: "Dé Ørn", company: "Delta", owner: "Lee Wu", status: "Going" } ] });
  assert.equal((await fetch(srv.base + "/api/invitetoken", { method: "POST", headers: G, body: JSON.stringify({ eventId: "evI", guestKey: "ana@acme.com" }) })).status, 401, "guests can't mint invite tokens");
  const { token } = await fetch(srv.base + "/api/invitetoken", { method: "POST", headers: H, body: JSON.stringify({ eventId: "evI", guestKey: "ana@acme.com" }) }).then((r) => r.json());
  assert.match(token, /^[a-f0-9]{32}$/);
  const { tokens } = await fetch(srv.base + "/api/invitetoken", { method: "POST", headers: H, body: JSON.stringify({ eventId: "evI", guestKeys: ["ana@acme.com", "g2", "dé ørn"] }) }).then((r) => r.json());
  assert.equal(tokens["ana@acme.com"], token);
  const get = (invite) => fetch(srv.base + "/api/db/doc?path=events/evI", { headers: { ...G, "x-encore-view": "rsvp", ...(invite ? { "x-encore-invite": invite } : {}) } }).then((r) => r.json());
  let d = (await get(`${encodeURIComponent("ana@acme.com")}~${token}`)).data;
  assert.deepEqual(d.me, { name: "Ana Diaz", title: "VP", company: "Acme", email: "Ana@Acme.com", owner: "Sam" });
  assert.deepEqual(d.hosts, ["Kim", "Sam"], "first names of owners of opted-in going guests");
  assert.deepEqual(d.guests.map((g) => g.name), ["Bo Chan", "Cy Ng"], "the guest list itself is unchanged");
  d = (await get(`g2~${tokens.g2}`)).data;
  assert.equal(d.me.name, "Bo Chan", "guest.id wins over email");
  d = (await get(`${encodeURIComponent("dé ørn")}~${tokens["dé ørn"]}`)).data;
  assert.equal(d.me.name, "Dé Ørn", "name keys are URI-encoded in the header");
  for (const bad of [null, `ana@acme.com~${"0".repeat(32)}`, `g2~${token}`, `ana@acme.com`, `~${token}`]) {
    d = (await get(bad)).data;
    assert.equal(d.me, undefined, `no me for ${bad}`);
    assert.equal(d.hosts, undefined);
  }
  const other = await fetch(srv.base + "/api/invitetoken", { method: "POST", headers: H, body: JSON.stringify({ eventId: "evOther", guestKey: "ana@acme.com" }) }).then((r) => r.json());
  assert.notEqual(other.token, token, "tokens are per event");
});
