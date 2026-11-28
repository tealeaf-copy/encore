import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { fakeTexts } from "../server/sms.js";
import { fakeOutbox } from "../server/email.js";
import { scopeStore } from "../server/workspaces.js";
import { askWindow } from "../server/kudosask.js";

let srv, host, other, ws, rid = {};
const J = { "Content-Type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const put = (path, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const getJ = async (path, cookie) => { const r = await fetch(srv.base + path, { headers: cookie ? { cookie } : {} }); return { status: r.status, j: await r.json().catch(() => null) }; };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const morning = Date.parse(day(0) + "T15:00:00Z"); // the morning after (event tz is UTC), 3pm
const run = () => srv.app.locals.kudosAsks.run({ now: morning, origin: "https://pl.example" });
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "kudos-ask-secret", ENCORE_SIGNUP_PER_HOUR: "100", ENCORE_FAKE_SMS: "1", ENCORE_FAKE_EMAIL: "1", ENCORE_DIRECTORY_CACHE_MS: "0" };

async function signup(name, email, handle) {
  const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); const cookie = r.headers.get("set-cookie").split(";")[0];
  assert.ok((await post("/api/host/profile", { handle, name, tagline: "Small dinners for new friends.", city: "Brooklyn", hood: "Bed-Stuy", emoji: "🍜" }, cookie)).ok);
  return cookie;
}
before(async () => {
  Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer();
  host = await signup("Rae Potter", "rae.kask@example.com", "rae-kask");
  other = await signup("Lou Baker", "lou.kask@example.com", "lou-kask");
  ws = srv.store.get("system/handle-rae-kask").data.ws;
  const base = { casual: true, date: day(-1), startTime: "18:00", endTime: "21:00", tz: "UTC", published: true, discoverable: true, city: "Brooklyn", hood: "Bed-Stuy", activity: "dinner" };
  assert.ok((await put("events/kaDinner", { ...base, name: "Dumpling night" }, host)).ok);
  assert.ok((await put("events/kaQuiet", { ...base, name: "Quiet supper", autoRemind: false }, host)).ok);
  assert.ok((await put("events/louNext", { ...base, date: day(9), name: "Bread and soup", activity: "dinner" }, other)).ok);
  const add = async (eventId, body) => (await (await post("/api/db/collection?path=rsvps", { eventId, code: "C" + Math.random().toString(36).slice(2, 7), createdAt: Date.now(), ...body }, host)).json()).id;
  rid.ana = await add("kaDinner", { name: "Ana Diaz", phone: "+14155550201", email: "ana.kask@guest.example.com", response: "going" });
  rid.bo = await add("kaDinner", { name: "Bo Chen", email: "bo.kask@guest.example.com", response: "going" });
  rid.cy = await add("kaDinner", { name: "Cy Noshow", phone: "+14155550203", response: "going", noShow: true });
  rid.di = await add("kaDinner", { name: "Di Maybe", phone: "+14155550204", response: "maybe" });
  rid.ed = await add("kaDinner", { name: "Ed Nothing", response: "going" }); // no phone, no email: skipped
  rid.fy = await add("kaQuiet", { name: "Fy Quiet", phone: "+14155550206", response: "going" });
});
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

test("The ask window: the morning after the event ends, for up to 3 days", () => {
  const ev = { date: "2026-03-10", tz: "UTC" };
  assert.equal(askWindow(ev, Date.parse("2026-03-10T23:00:00Z")), false, "not the same night");
  assert.equal(askWindow(ev, Date.parse("2026-03-11T08:00:00Z")), false, "not before 9am");
  assert.equal(askWindow(ev, Date.parse("2026-03-11T09:05:00Z")), true, "the morning after");
  assert.equal(askWindow(ev, Date.parse("2026-03-15T10:00:00Z")), false, "too late");
});

test("Each guest who was in gets exactly one ask, by text if they gave a phone, else email; no-shows, maybes and switched-off events aren't asked", async () => {
  const t0 = fakeTexts.length, e0 = fakeOutbox.length;
  const r1 = await run(); assert.equal(r1.asked, 2, JSON.stringify(r1)); assert.equal(r1.sms, 1); assert.equal(r1.email, 1);
  const texts = fakeTexts.slice(t0), mails = fakeOutbox.slice(e0);
  const ana = texts.find((t) => t.to === "+14155550201"); assert.ok(ana, "Ana gets a text");
  assert.match(ana.text, /^How was Dumpling night at Rae's\? Leave kudos in one tap: https:\/\/pl\.example\/k\/kaDinner\?rid=[A-Za-z0-9_-]+&code=[A-Za-z0-9]+ Got photos\? Add them there too\. Reply STOP to opt out\.$/); // story prompts: photos ride on this text, never one of their own
  assert.equal(texts.length, 1, "one text in all: not Cy (no-show), not Di (maybe), not Fy (reminders off for that event)");
  const bo = mails.find((m) => m.to.includes("bo.kask@guest.example.com")); assert.ok(bo, "Bo has no phone, so an email");
  assert.equal(bo.subject, "How was Dumpling night?"); assert.match(bo.text, /How was Dumpling night at Rae's\? Leave kudos in one tap: https:\/\/pl\.example\/k\/kaDinner\?rid=/);
  assert.ok(!mails.some((m) => m.to.includes("ana.kask@guest.example.com")), "Ana got a text, so no email too");
  // run it again (and again): nothing new
  const r2 = await run(), r3 = await run(); assert.equal(r2.asked, 0); assert.equal(r3.asked, 0);
  assert.equal(fakeTexts.length - t0, 1); assert.equal(fakeOutbox.length - e0, 1);
  // the host's app: "Kudos asked of 2 guests · 0 sent"
  const k = await getJ("/api/host/kudos/kaDinner", host); assert.deepEqual(k.j.ask, { asked: 2, sent: 0 });
});

test("The kudos link proves the guest: the page and Send work with it, and nothing works without it", async () => {
  const text = fakeTexts.find((t) => t.to === "+14155550201").text, u = new URL(text.match(/https:\/\/\S+/)[0]), code = u.searchParams.get("code");
  assert.equal(u.searchParams.get("rid"), rid.ana);
  const page = await fetch(srv.base + u.pathname + u.search); assert.equal(page.status, 200); assert.match(await page.text(), /Leave kudos/); assert.equal(page.headers.get("referrer-policy"), "no-referrer");
  const ok = await getJ(`/api/public/kudos-page/kaDinner?rid=${rid.ana}&code=${code}`);
  assert.equal(ok.status, 200); assert.equal(ok.j.title, "Dumpling night"); assert.equal(ok.j.hostFirst, "Rae"); assert.equal(ok.j.open, true); assert.equal(ok.j.sent, false);
  assert.equal(ok.j.again.label, "Would go again"); assert.ok(ok.j.tags.length >= 6 && !ok.j.tags.some((t) => t.k === "again"));
  assert.ok(!JSON.stringify(ok.j).includes("ana.kask"), "the page never gets the guest's email");
  assert.equal((await getJ(`/api/public/kudos-page/kaDinner?rid=${rid.ana}&code=WRONG`)).status, 403);
  assert.equal((await getJ(`/api/public/kudos-page/kaDinner?rid=${rid.bo}&code=${code}`)).status, 403, "one guest's code doesn't open another's");
  assert.equal((await post("/api/public/kudos", { eventId: "kaDinner", rid: rid.ana, code: "WRONG", tags: ["food"] })).status, 403);
  // the host marks who came: Ana was there
  scopeStore(srv.store, ws).update("rsvps/" + rid.ana, { noShow: false });
  const s = await post("/api/public/kudos", { eventId: "kaDinner", rid: rid.ana, code, tags: ["food", "again"], love: "Best dumplings in Brooklyn", improve: "PRIVATE-IMPROVE", compare: "better", via: "ask" });
  assert.equal(s.status, 200, await s.clone().text());
  assert.equal((await getJ(`/api/public/kudos-page/kaDinner?rid=${rid.ana}&code=${code}`)).j.sent, true);
  const more = await getJ(`/api/public/kudos-more/kaDinner?rid=${rid.ana}&code=${code}`);
  assert.ok(more.j.events.some((e) => e.id === "louNext"), "More like this: a dinner in Brooklyn by another host"); assert.ok(!more.j.events.some((e) => e.id === "kaDinner"));
  assert.ok(more.j.events.length <= 3);
  assert.deepEqual((await getJ("/api/host/kudos/kaDinner", host)).j.ask, { asked: 2, sent: 1 });
});

test("Verified labels: came and on the guest list, replied I'm in, nothing for a maybe", async () => {
  const S = scopeStore(srv.store, ws);
  assert.equal(S.get("kudos/" + rid.ana).data.verified, "guest_list", "stored at write time");
  const boCode = S.get("rsvps/" + rid.bo).data.code;
  assert.equal((await post("/api/public/kudos", { eventId: "kaDinner", rid: rid.bo, code: boCode, tags: ["welcome"] })).status, 200);
  assert.equal(S.get("kudos/" + rid.bo).data.verified, "rsvp");
  const diCode = S.get("rsvps/" + rid.di).data.code;
  assert.equal((await post("/api/public/kudos", { eventId: "kaDinner", rid: rid.di, code: diCode, tags: ["vibe"] })).status, 200);
  assert.equal(S.get("kudos/" + rid.di).data.verified, null, "a Maybe isn't labelled I'm in");
  // older kudos with no label get one when read; checked in at the door counts as came
  S.update("rsvps/" + rid.bo, { checkedInAt: Date.now() }); S.update("kudos/" + rid.bo, { verified: undefined });
  const L = await getJ("/api/v1/reviews?host=rae-kask");
  assert.equal(S.get("kudos/" + rid.bo).data.verified, "guest_list", "backfilled on read");
  const by = Object.fromEntries(L.j.data.map((r) => [r.name, r]));
  assert.equal(by.Ana.verified, "guest_list"); assert.equal(by.Ana.verified_label, "Came, on the guest list");
  assert.equal(by.Bo.verified, "guest_list"); assert.equal(by.Di.verified, null); assert.equal(by.Di.verified_label, "");
  // the host page carries the label too
  const P = await getJ("/api/public/profile/rae-kask"); const ak = P.j.strengths.kudos.find((k) => k.name === "Ana");
  assert.equal(ak.verifiedLabel, "Came, on the guest list");
});

test("Labels in /api/v1 reviews, the MCP get_reviews tool and OpenAPI; never the private fields", async () => {
  const L = (await getJ("/api/v1/reviews?host=rae-kask")).j, E = (await getJ("/api/v1/events/kaDinner")).j.data;
  const m = await (await post("/mcp/public", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_reviews", arguments: { host: "rae-kask" } } })).json();
  const M = JSON.parse(m.result.content[0].text);
  for (const items of [L.data, E.reviews.items, M.data]) { assert.ok(items.length >= 3);
    for (const r of items) { assert.ok("verified" in r && "verified_label" in r); assert.ok(["guest_list", "rsvp", null].includes(r.verified));
      for (const k of ["email", "rid", "improve", "compare", "via"]) assert.ok(!(k in r), k + " never leaves"); } }
  const all = JSON.stringify([L, E, M]);
  for (const s of ["PRIVATE-IMPROVE", "ana.kask@", "bo.kask@", rid.ana, rid.bo]) assert.ok(!all.includes(s), s + " is private");
  const api = (await getJ("/api/v1/openapi.json")).j; assert.ok(api.components.schemas.Review.properties.verified);
  const txt = await (await fetch(srv.base + "/llms.txt")).text(); assert.match(txt, /"verified": "guest_list"/);
});

test("Second-host loop: a kudos giver who follows or says I'm in to another host within 30 days is counted, for the owner only", async () => {
  // Ana sent Rae kudos (above). She follows Lou from Lou's page, and says I'm in to Lou's next event.
  assert.equal((await post("/api/public/follow", { handle: "lou-kask", email: "ana.kask@guest.example.com", name: "Ana Diaz" })).status, 200);
  assert.equal((await post("/api/public/follow", { handle: "lou-kask", email: "ana.kask@guest.example.com", name: "Ana Diaz" })).status, 200);
  await post("/api/db/collection?path=rsvps", { eventId: "louNext", name: "Ana Diaz", email: "ana.kask@guest.example.com", response: "going", code: "ANA01" }, other);
  // following Rae herself isn't a second host
  await post("/api/public/follow", { handle: "rae-kask", email: "ana.kask@guest.example.com", name: "Ana Diaz" });
  const st = await getJ("/api/admin/loop-stats", host);
  assert.equal(st.status, 200); assert.equal(st.j.second_host, 1); assert.equal(st.j.followed_other_host, 1); assert.equal(st.j.replied_im_in_other_host, 1); assert.ok(st.j.kudos_givers >= 2);
  assert.ok(!JSON.stringify(st.j).includes("ana"), "counts, never people");
  assert.equal((await getJ("/api/admin/loop-stats")).status, 403, "signed out");
  assert.equal((await getJ("/api/admin/loop-stats", other)).j.second_host, 0, "each host sees their own guests' count");
});

test("The follow button on the kudos page: the reply proves who's following", async () => {
  const S = scopeStore(srv.store, ws), code = S.get("rsvps/" + rid.bo).data.code;
  assert.equal((await post("/api/public/follow", { handle: "rae-kask", eventId: "kaDinner", rid: rid.bo, code, via: "kudos" })).status, 200);
  assert.ok(S.list("followers").some((d) => d.data.email === "bo.kask@guest.example.com"));
  assert.equal((await post("/api/public/follow", { handle: "rae-kask", eventId: "kaDinner", rid: rid.bo, code: "WRONG" })).status, 401, "a bad code is just no email");
});
