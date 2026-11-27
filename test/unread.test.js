// Unread messages on every page (server/chat.js GET/POST /api/me/unread, public/chatnav.js, public/shell.js): the counts
// for the signed-in person and for a guest by the reply proofs their browser holds, muted chats left out, nobody else's
// counts ever, the "Message pop-ups" switch, pushes for new chat messages (not while you're active, not for muted chats),
// and the nav wiring: badges in the tab bar and the rail, one task on the shared poller, no timer of its own.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { fakeOutbox, clearFakeOutbox } from "../server/push.js";

let srv, host;
const J = { "content-type": "application/json" };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
// a time zone where it's daytime now, so pushes aren't held for quiet hours
const TZ = ["America/New_York", "Europe/London", "Asia/Tokyo", "America/Los_Angeles", "Asia/Kolkata", "Australia/Sydney", "Europe/Berlin", "America/Sao_Paulo"]
  .find((z) => { const h = +new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: z }).format(new Date()); return h >= 10 && h < 19; }) || "America/New_York";
async function signup(name, email) { const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name, email, password: "long-password-1", mode: "friends" }) }); return r.headers.get("set-cookie").split(";")[0]; }
before(async () => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "unread-secret-0123456789abcdef"; process.env.ENCORE_FAKE_EMAIL = "1"; process.env.ENCORE_FAKE_PUSH = "1"; resetLoginLimits(); srv = await startServer();
  host = await signup("Maya Host", "maya.unread@example.com"); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_FAKE_EMAIL", "ENCORE_FAKE_PUSH"]) delete process.env[k]; await srv.close(); });

const put = (id, d, cookie = host) => fetch(srv.base + "/api/db/doc?path=events/" + id, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(d) });
async function reply(eventId, key, { name, email = "", cookie = "" } = {}) {
  const doc = await (await fetch(srv.base + "/api/db/doc?path=" + encodeURIComponent("events/" + eventId), { headers: { "x-encore-guest": "1" } })).json();
  const code = "C" + key.slice(-5).toUpperCase(), data = { eventId, response: "going", name, email, code, createdAt: Date.now(), via: "invite-lite" };
  const r = await fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, "x-encore-guest": "1", "x-encore-key": key, "x-encore-workspace": doc.workspace, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(data) });
  const j = await r.json(); return { rid: String(j.id || "").split("/").pop(), code };
}
const say = (id, g, text) => fetch(`${srv.base}/api/chats/${id}/messages`, { method: "POST", headers: { ...J, ...(g?.cookie ? { cookie: g.cookie } : {}) }, body: JSON.stringify({ ...(g?.rid ? { rid: g.rid, code: g.code } : {}), text }) });
const act = (id, path, g, body = {}) => fetch(`${srv.base}/api/chats/${id}/${path}`, { method: "POST", headers: { ...J, ...(g?.cookie ? { cookie: g.cookie } : {}) }, body: JSON.stringify({ ...(g?.rid ? { rid: g.rid, code: g.code } : {}), ...body }) });
const unread = async (cookie, proofs) => { const r = proofs ? await fetch(srv.base + "/api/me/unread", { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ proofs }) }) : await fetch(srv.base + "/api/me/unread", { headers: cookie ? { cookie } : {} }); return { r, j: await r.json() }; };

let kim, ana, bo;
test("signed in: chats with something new, unread messages, the bell's count and the newest message; private and uncached", async () => {
  kim = await signup("Kim Lee", "kim.unread@example.com"); bo = await signup("Bo Other", "bo.unread@example.com");
  await put("unr1", { kind: "social", casual: true, name: "Dumpling night", date: day(3), startTime: "19:00", published: true, headcount: 10, tz: TZ });
  await put("unr2", { kind: "social", casual: true, name: "Run club", date: day(5), startTime: "08:00", published: true, headcount: 10, tz: TZ });
  await reply("unr1", "key-kim-u0001", { name: "Kim Lee", email: "kim.unread@example.com", cookie: kim });
  await reply("unr2", "key-kim-u0002", { name: "Kim Lee", email: "kim.unread@example.com", cookie: kim });
  let { r, j } = await unread(kim); assert.equal(r.status, 200); assert.match(r.headers.get("cache-control"), /private/); assert.match(r.headers.get("cache-control"), /no-store/);
  assert.equal(j.chats, 0); assert.equal(j.messages, 0); assert.equal(j.latest, undefined, "nothing new: no pop-up");
  await say("unr1", { cookie: host }, "Who has a steamer?"); await say("unr1", { cookie: host }, "I can bring the vinegar"); await say("unr2", { cookie: host }, "Meet at the gate");
  ({ j } = await unread(kim)); assert.equal(j.chats, 2); assert.equal(j.messages, 3); assert.equal(typeof j.inbox, "number"); assert.equal(j.popups, true);
  assert.equal(j.latest.chat, "unr2"); assert.equal(j.latest.by, "Maya"); assert.equal(j.latest.title, "Run club"); assert.equal(j.latest.text, "Meet at the gate");
  const bell = await (await fetch(srv.base + "/api/inbox/badge", { headers: { cookie: kim } })).json(); assert.equal(j.inbox, bell.unread, "the bell's count matches the Inbox");
  // the same numbers as the full chat list, without loading it
  const B = await (await fetch(srv.base + "/api/chats", { headers: { cookie: kim } })).json(); assert.equal(B.unread, j.chats); assert.equal(B.messages, j.messages);
  // your own messages never count; reading a chat clears it
  await say("unr1", { cookie: kim }, "I have one"); await (await fetch(srv.base + "/api/chats/unr1?read=1", { headers: { cookie: kim } })).json();
  ({ j } = await unread(kim)); assert.equal(j.chats, 1); assert.equal(j.messages, 1);
  // the host doesn't count their own messages, but sees Kim's
  ({ j } = await unread(host)); assert.equal(j.messages, 1); assert.equal(j.latest.by, "Kim"); assert.equal(j.latest.chat, "unr1");
});

test("muted chats don't count, don't pop up and don't push", async () => {
  await act("unr2", "mute", { cookie: kim }, { on: true });
  let { j } = await unread(kim); assert.equal(j.chats, 0); assert.equal(j.messages, 0); assert.equal(j.latest, undefined);
  await say("unr2", { cookie: host }, "Bring water"); ({ j } = await unread(kim)); assert.equal(j.chats, 0, "a new message in a muted chat stays quiet");
  await act("unr2", "mute", { cookie: kim }, { on: false }); ({ j } = await unread(kim)); assert.equal(j.chats, 1); assert.equal(j.messages, 2);
});

test("a guest without an account counts by the reply proofs their browser holds, and only those", async () => {
  ana = await reply("unr1", "key-ana-u0001", { name: "Ana" });
  await say("unr1", { cookie: host }, "Doors at 7");
  let { j } = await unread("", [{ eventId: "unr1", rid: ana.rid, code: ana.code }]); assert.equal(j.chats, 1); assert.ok(j.messages >= 1); assert.equal(j.inbox, 0); assert.equal(j.latest.chat, "unr1");
  ({ j } = await unread("", [{ eventId: "unr1", rid: ana.rid, code: "WRONG" }])); assert.equal(j.chats, 0, "a wrong code is nobody"); assert.equal(j.latest, undefined);
  ({ j } = await unread("", [{ eventId: "unr2", rid: ana.rid, code: ana.code }])); assert.equal(j.chats, 0, "a proof only opens its own event");
  ({ j } = await unread("")); assert.deepEqual([j.chats, j.messages, j.inbox], [0, 0, 0], "signed out with nothing: zeros, no error");
});

test("privacy: another person's counts never leak", async () => {
  let { j } = await unread(bo); assert.equal(j.chats, 0); assert.equal(j.messages, 0); assert.equal(j.latest, undefined, "Bo is in none of these chats");
  // Bo can't borrow Kim's chats with a made-up proof or a query string
  ({ j } = await unread(bo, [{ eventId: "unr1", rid: "nope", code: "nope" }])); assert.equal(j.chats, 0);
  const r = await fetch(srv.base + "/api/me/unread?email=kim.unread@example.com", { headers: { cookie: bo } }); assert.equal((await r.json()).chats, 0);
  // and the answer never carries an email, a reply id or a code
  const K = JSON.stringify((await unread(kim)).j); assert.ok(!/@|rid|code/.test(K), K);
  assert.equal((await unread(kim)).r.headers.get("vary"), "Cookie");
});

test("Message pop-ups off: the counts stay, the newest message isn't sent", async () => {
  const p = await (await fetch(srv.base + "/api/me/prefs", { method: "POST", headers: { ...J, cookie: kim }, body: JSON.stringify({ chatPopups: false }) })).json(); assert.equal(p.chatPopups, false);
  assert.equal((await (await fetch(srv.base + "/api/me/prefs", { headers: { cookie: kim } })).json()).chatPopups, false);
  let { j } = await unread(kim); assert.equal(j.popups, false); assert.equal(j.latest, undefined); assert.ok(j.chats >= 1);
  await fetch(srv.base + "/api/me/prefs", { method: "POST", headers: { ...J, cookie: kim }, body: JSON.stringify({ emails: true }) });
  ({ j } = await unread(kim)); assert.equal(j.popups, false, "another switch leaves it as it was");
  await fetch(srv.base + "/api/me/prefs", { method: "POST", headers: { ...J, cookie: kim }, body: JSON.stringify({ chatPopups: true }) }); ({ j } = await unread(kim)); assert.equal(j.popups, true); assert.ok(j.latest);
});

test("a new chat message pushes to the phone when the person isn't using Pottery Lab, never for a muted chat", async () => {
  const dana = await signup("Dana Park", "dana.unread@example.com");
  await put("unr3", { kind: "social", casual: true, name: "Pasta class", date: day(4), startTime: "18:00", published: true, headcount: 10, tz: TZ });
  await reply("unr3", "key-dana-u001", { name: "Dana Park", email: "dana.unread@example.com", cookie: dana });
  assert.equal((await fetch(srv.base + "/api/me/push/devices", { method: "POST", headers: { ...J, cookie: dana }, body: JSON.stringify({ token: "fake-device-token-0123456789-dana", platform: "ios" }) })).status, 200);
  clearFakeOutbox(); await say("unr3", { cookie: host }, "Aprons on hooks by the door"); await new Promise((r) => setTimeout(r, 80));
  const P = fakeOutbox().filter((p) => p.to === "dana.unread@example.com");
  assert.equal(P.length, 1, "one push, not a second one for the bell item: " + JSON.stringify(P));
  assert.equal(P[0].title, "Maya in Pasta class"); assert.equal(P[0].body, "Aprons on hooks by the door"); assert.equal(P[0].link, "/chats/unr3"); assert.equal(P[0].kind, "chat");
  // while Dana has the app open (a recent unread check), the pop-up does the job: no push
  await unread(dana); clearFakeOutbox(); await new Promise((r) => setTimeout(r, 10)); await say("unr3", { cookie: host }, "Second one");
  await new Promise((r) => setTimeout(r, 80)); assert.equal(fakeOutbox().filter((p) => p.to === "dana.unread@example.com").length, 0, "active: no push");
  // muted: never
  const ed = await signup("Ed Muted", "ed.unread@example.com"); await reply("unr3", "key-ed-u00001", { name: "Ed Muted", email: "ed.unread@example.com", cookie: ed });
  await fetch(srv.base + "/api/me/push/devices", { method: "POST", headers: { ...J, cookie: ed }, body: JSON.stringify({ token: "fake-device-token-0123456789-ed00", platform: "android" }) });
  await act("unr3", "mute", { cookie: ed }, { on: true }); clearFakeOutbox(); await say("unr3", { cookie: host }, "Third");
  await new Promise((r) => setTimeout(r, 80)); assert.equal(fakeOutbox().filter((p) => p.to === "ed.unread@example.com").length, 0, "muted: no push");
  // turning off "Replies and messages" in Settings stops chat pushes too
  const fay = await signup("Fay Off", "fay.unread@example.com"); await reply("unr3", "key-fay-u0001", { name: "Fay Off", email: "fay.unread@example.com", cookie: fay });
  await fetch(srv.base + "/api/me/push/devices", { method: "POST", headers: { ...J, cookie: fay }, body: JSON.stringify({ token: "fake-device-token-0123456789-fay0", platform: "ios" }) });
  await fetch(srv.base + "/api/me/push/prefs", { method: "POST", headers: { ...J, cookie: fay }, body: JSON.stringify({ replies: false }) });
  clearFakeOutbox(); await say("unr3", { cookie: host }, "Fourth"); await new Promise((r) => setTimeout(r, 80));
  assert.equal(fakeOutbox().filter((p) => p.to === "fay.unread@example.com").length, 0, "push settings respected");
});

test("rate-limit friendly: a burst gets a calm 429 with Retry-After, never a crash", async () => {
  const gus = await signup("Gus Burst", "gus.unread@example.com"); let last;
  for (let i = 0; i < 125; i++) last = await fetch(srv.base + "/api/me/unread", { headers: { cookie: gus } });
  assert.equal(last.status, 429); assert.equal(last.headers.get("retry-after"), "30"); assert.equal((await last.json()).code, "rate_limited");
});

test("the nav: a Chats badge on the tab bar and the rail, one task on the shared poller, no timer of its own", () => {
  const shell = read("public/shell.js"), nav = read("public/chatnav.js"), potto = read("public/potto.js");
  assert.match(shell, /<b>Chats<\/b><span class="es-tn" data-chats-badge aria-hidden="true" hidden><\/span>/, "tab bar");
  assert.match(shell, /item\("\/chats", ICON\.chat, "Chats", `<span class="es-n" data-chats-badge aria-hidden="true" hidden><\/span>`\)/, "rail");
  assert.match(shell, /\.es-rail \.es-n\{[^}]*background:var\(--pl-accent/, "ink-blue chip, not red");
  assert.match(nav, /\.es-tabs a \.es-tn[^{]*\{position:absolute/, "on the icon, so nothing shifts");
  assert.match(nav, /aria-label", n \? `Chats, \$\{cap\(n\)\} unread` : "Chats"/); assert.match(nav, /k > 99 \? "99\+"/);
  assert.match(nav, /window\.PLPoll\.every\("unread", check/); assert.match(nav, /\/api\/me\/unread/);
  assert.ok(!/setInterval|setTimeout\(poll/.test(nav), "no timer loop of its own");
  assert.match(nav, /addEventListener\("focus", soon\)/); assert.match(nav, /addEventListener\("visibilitychange", soon\)/); assert.match(nav, /addEventListener\("pageshow"/);
  assert.ok(!/document\.title/.test(nav), "the (3) in the title stays on the Chats page"); assert.match(read("public/chat.js"), /document\.title = \(n \? `\(\$\{n\}\) ` : ""\) \+ "Chats/);
  assert.match(potto, /if \(window\.PLChatNav \|\| window\.__plChatNavLoad\) \{[^}]*kick/, "the bell rides on the same check");
  // the pop-up: 6 seconds, once a chat a minute, never for the open chat, reduced motion, the off switch
  assert.match(nav, /setTimeout\(go, 6000\)/); assert.match(nav, /now - \(seen\[L\.chat\] \|\| 0\) < 60e3/); assert.match(nav, /openId\(\) === L\.chat/);
  assert.match(nav, /prefers-reduced-motion:reduce\)\{\.pl-mt\{animation:none\}/); assert.match(nav, /pl\.msgPopups/);
  assert.match(nav, /`<b>\$\{esc\(who\)\}:<\/b> \$\{esc\(L\.text\)\}`/, "Maya in Dumpling night: I can bring the vinegar");
});

test("Settings has the Message pop-ups switch; the Chats list and thread mark what's new", () => {
  const s = read("public/settings.html");
  assert.match(s, /<span>Message pop-ups<small>[^<]+<\/small><\/span><input type="checkbox" class="sw" id="msgPopups" aria-label="Message pop-ups"/);
  assert.match(s, /send\("\/api\/me\/prefs", \{ chatPopups: e\.target\.checked \}\)/);
  const css = read("public/chat.css"); assert.match(css, /\.ch-row\.unread \.ch-rtop::before\{[^}]*border-radius:50%;background:var\(--pl-accent\)/); assert.match(css, /\.ch-row\.unread \.ch-rname\{font-weight:700/);
  assert.match(read("public/chat.js"), /class="ch-new" role="separator" aria-label="New messages"><span>New messages<\/span>/);
  for (const f of ["public/chatnav.js", "public/settings.html", "public/chat.css", "public/sw.js"]) assert.ok(!/—/.test(read(f)), f + " has no em dashes");
});
