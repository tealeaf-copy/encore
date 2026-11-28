// Availability polls in the feed (server/feedpoll.js, public/feedpoll.js): a host asks "When works for you?" with 2
// to 5 times, people who follow them tap what works (and undo), the host sees who picked what, and the event the host
// makes from the winner turns the card into "It's on" and tells the people who picked it. Blocks, limits and the
// phone walk (ask from the "+", answer as a second person, make the event as the host) are checked here too.
// POLL_SHOTS=1 also saves phone screenshots under .shots/poll/.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { cleanOptions, whenLabel, POLL_Q } from "../server/feedpoll.js";

let srv;
const J = { "content-type": "application/json" };
const post = (p, body, cookie) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body || {}) });
const get = (p, cookie) => fetch(srv.base + p, { headers: cookie ? { cookie } : {} });
const del = (p, cookie) => fetch(srv.base + p, { method: "DELETE", headers: cookie ? { cookie } : {} });
const put = (p, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + p, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const key = (em) => Buffer.from(em).toString("base64url");
const U = {};
const cookies = (r) => r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const join = async (who, name) => { const email = `${who}.fp@example.com`, r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }), b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); U[who] = { cookie: cookies(r), ws: b.workspace.id, email }; };
const feedOf = async (who) => { srv.app.locals.social.bust(); const r = await get("/api/me/feed", U[who].cookie); assert.equal(r.status, 200); return (await r.json()).blend; };
const pollIn = (B, id) => B.items.find((x) => x.kind === "poll" && x.id === id);
const ask = async (who, body) => { const r = await post("/api/feed/polls", body, who ? U[who].cookie : ""); return { status: r.status, ...(await r.json()) }; };
const vote = async (who, id, option, on = true) => { const r = await post(`/api/feed/polls/${id}/vote`, { option, on }, who ? U[who].cookie : ""); return { status: r.status, ...(await r.json()) }; };
const read = async (who, id) => { const r = await get(`/api/feed/polls/${id}`, who ? U[who].cookie : ""); return { status: r.status, ...(await r.json()) }; };
const inbox = (email) => srv.store.get("system/inbox-" + crypto.createHash("sha256").update(email).digest("hex").slice(0, 24))?.data?.list || [];
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "feed-poll-secret-0123456789abcdef", ENCORE_SIGNUP_PER_HOUR: "500", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_SMS: "1", ENCORE_FAKE_PUSH: "1", ENCORE_FEED_PER_IP_HOUR: "100000",
  ENCORE_FEED_POLLS_PER_HOUR: "500", ENCORE_FEED_POLLS_PER_IP_HOUR: "2000", ENCORE_FEED_POLL_VOTES_PER_HOUR: "500", ENCORE_FEED_POLL_VOTES_PER_IP_HOUR: "2000", ENCORE_FEED_KUDOS_PER_HOUR: "500", ENCORE_FEED_KUDOS_PER_IP_HOUR: "2000", ENCORE_FEED_COMMENTS_PER_HOUR: "500", ENCORE_FEED_COMMENTS_PER_IP_HOUR: "2000" };
const OPTS = () => [{ date: day(9), time: "" }, { date: day(5), time: "19:00" }, { date: day(6), time: "18:30" }];
let pid = "";

before(async () => {
  Object.assign(process.env, ENV); srv = await startServer(); resetLoginLimits();
  for (const [w, n] of [["hana", "Hana Sato"], ["finn", "Finn Byrne"], ["pia", "Pia Costa"], ["sol", "Sol Reyes"], ["bo", "Bo Lind"], ["wes", "Wes Tran"]]) await join(w, n);
  // Finn, Pia and Bo follow Hana (she is in their friends); Sol and Wes don't. Hana blocked Bo.
  for (const w of ["finn", "pia", "bo"]) assert.ok((await post("/api/me/friends", { key: key(U.hana.email) }, U[w].cookie)).ok);
  assert.ok((await post("/api/me/blocks", { kind: "person", key: key(U.bo.email), name: "Bo" }, U.hana.cookie)).ok);
  srv.app.locals.social.bust();
});
beforeEach(() => { Object.assign(process.env, ENV); resetLoginLimits(); });
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

test("the options: two to five real dates from today to a year out, an optional time, doubles dropped, kept in order", () => {
  assert.equal(typeof cleanOptions([{ date: day(3) }]), "string", "one option is not a poll");
  assert.equal(typeof cleanOptions([1, 2, 3, 4, 5, 6].map((n) => ({ date: day(n) }))), "string", "six is too many");
  assert.match(cleanOptions([{ date: day(-3) }, { date: day(3) }]), /already passed/);
  assert.match(cleanOptions([{ date: day(3) }, { date: day(400) }]), /within the next year/);
  assert.match(cleanOptions([{ date: "2027-02-31" }, { date: day(3) }]), /doesn't look right/);
  assert.match(cleanOptions([{ date: day(3), time: "25:00" }, { date: day(4) }]), /times doesn't look right/);
  assert.equal(typeof cleanOptions([{ date: day(3), time: "19:00" }, { date: day(3), time: "19:00" }]), "string", "the same time twice is one option");
  assert.equal(typeof cleanOptions("soon"), "string");
  const L = cleanOptions([{ date: day(9) }, { date: day(5), time: "19:00" }, { date: day(5), time: "12:00" }, { date: day(5), time: "19:00" }, {}]);
  assert.deepEqual(L.map((o) => [o.id, o.date, o.time]), [["a", day(5), "12:00"], ["b", day(5), "19:00"], ["c", day(9), ""]]);
  assert.equal(whenLabel("2026-12-05", "19:00"), "Sat, Dec 5 at 7pm"); assert.equal(whenLabel("2026-12-05", "18:30"), "Sat, Dec 5 at 6:30pm"); assert.equal(whenLabel("2026-12-05", ""), "Sat, Dec 5");
});

test("asking: signed in only, checked on the server, and the host gets the card back", async () => {
  assert.equal((await ask("", { options: OPTS() })).status, 401);
  for (const [body, why] of [[{ options: [{ date: day(3) }] }, "one option"], [{ options: [1, 2, 3, 4, 5, 6].map((n) => ({ date: day(n) })) }, "six options"], [{ options: [{ date: day(-2) }, { date: day(2) }] }, "a past date"],
    [{ options: [{ date: day(2) }, { date: day(500) }] }, "over a year out"], [{ options: OPTS(), q: "x".repeat(81) }, "a long question"], [{ options: OPTS(), title: "y".repeat(61) }, "a long title"],
    [{ options: OPTS(), closes: "tomorrow" }, "a closing day that is not a date"], [{ options: OPTS(), title: "call me 415 555 0199" }, "a phone number"], [{}, "nothing"]]) {
    const r = await ask("hana", body); assert.equal(r.status, 400, why + ": " + JSON.stringify(r)); assert.ok(r.message && !/undefined/.test(r.message), why); }
  const r = await ask("hana", { q: "", title: "Dumpling night", options: OPTS() }); assert.equal(r.status, 200, JSON.stringify(r));
  const P = r.poll; pid = P.id; assert.match(pid, /^[a-f0-9]{24}$/);
  assert.equal(P.kind, "poll"); assert.equal(P.q, POLL_Q); assert.equal(P.title, "Dumpling night"); assert.equal(P.mine, true); assert.equal(P.open, true); assert.equal(P.host.name, "Hana Sato");
  assert.deepEqual(P.options.map((o) => [o.id, o.date, o.time, o.count]), [["a", day(5), "19:00", 0], ["b", day(6), "18:30", 0], ["c", day(9), "", 0]]);
  assert.equal(P.closes, day(9), "it closes after the last option's date unless the host picks a day"); assert.equal(P.kudos.target, "q:" + pid); assert.equal(P.share.url, "/feed?poll=" + pid);
  const early = await ask("hana", { options: OPTS(), closes: day(2) }); assert.equal(early.poll.closes, day(2)); assert.equal((await del(`/api/feed/polls/${early.poll.id}`, U.hana.cookie)).status, 200);
  assert.equal((await read("hana", early.poll.id)).status, 404);
});

test("who sees it: the host and the people who follow them in the feed, anyone with the link, never someone blocked", async () => {
  assert.ok(pollIn(await feedOf("hana"), pid), "the host sees their own poll"); const f = pollIn(await feedOf("finn"), pid); assert.ok(f, "a follower sees it");
  assert.equal(f.mine, false); assert.equal(f.options[0].names, undefined, "only the host gets names"); assert.equal((await feedOf("finn")).items[0].id, pid, "an open poll you haven't answered leads the feed");
  assert.equal(pollIn(await feedOf("sol"), pid), undefined, "someone who doesn't follow the host has no card in their feed");
  assert.equal(pollIn(await feedOf("bo"), pid), undefined, "a blocked follower has no card");
  assert.equal((await read("bo", pid)).status, 404, "and can't open the link"); assert.equal((await vote("bo", pid, "a")).status, 404, "or vote");
  assert.equal((await post("/api/feed/kudos", { target: "q:" + pid }, U.bo.cookie)).status, 404); assert.equal((await post("/api/feed/comments", { target: "q:" + pid, text: "hi" }, U.bo.cookie)).status, 404);
  // the link works signed out (to look) and for someone the host sent it to
  const out = await read("", pid); assert.equal(out.status, 200); assert.equal(out.signedIn, false); assert.equal(out.poll.title, "Dumpling night"); assert.equal(out.poll.me, undefined);
  assert.equal((await vote("", pid, "a")).status, 401, "signed out, a tap is asked to sign in");
  assert.equal((await read("sol", pid)).status, 200); assert.equal((await read("", "0".repeat(24))).status, 404); assert.equal((await read("", "nope")).status, 404);
  const pub = await (await get("/api/public/feed")).json(); assert.equal(pub.blend.items.some((x) => x.kind === "poll"), false, "the signed-out feed carries no polls");
});

test("answering: one tap each, tap again to undo, counts and faces add up, and the host hears once", async () => {
  let j = await vote("finn", pid, "a"); assert.equal(j.status, 200); assert.deepEqual(j.poll.options.map((o) => [o.count, o.mine]), [[1, true], [0, false], [0, false]]); assert.equal(j.poll.voters, 1); assert.equal(j.poll.lead, "a");
  assert.equal(j.poll.options[0].faces[0].me, 1);
  j = await vote("finn", pid, "c"); assert.deepEqual(j.poll.options.map((o) => o.count), [1, 0, 1]); assert.equal(j.poll.voters, 1, "two picks, one person");
  j = await vote("finn", pid, "c"); assert.deepEqual(j.poll.options.map((o) => o.count), [1, 0, 1], "the same tap twice counts once");
  j = await vote("finn", pid, "c", false); assert.deepEqual(j.poll.options.map((o) => [o.count, o.mine]), [[1, true], [0, false], [0, false]], "undo");
  assert.equal((await vote("finn", pid, "z")).status, 400); assert.equal((await vote("finn", pid, "")).status, 400);
  j = await vote("pia", pid, "a"); j = await vote("pia", pid, "b"); assert.deepEqual(j.poll.options.map((o) => [o.count, o.mine]), [[2, true], [1, true], [0, false]]); assert.equal(j.poll.voters, 2);
  assert.equal(j.poll.options[0].faces.length, 2); assert.deepEqual(j.poll.options[0].faces[0], { i: "P", c: j.poll.options[0].faces[0].c, me: 1 }, "your own face first");
  j = await vote("sol", pid, "b"); assert.equal(j.status, 200, "someone with the link can answer too");
  // the host: counts and who picked what
  const H = (await read("hana", pid)).poll; assert.deepEqual(H.options.map((o) => [o.count, o.names]), [[2, ["Finn", "Pia"]], [2, ["Pia", "Sol"]], [0, []]]); assert.equal(H.voters, 3); assert.equal(H.lead, "a", "a tie goes to the earlier time");
  // the feed says the same after a reload, and an answered poll no longer has to lead
  const F = pollIn(await feedOf("finn"), pid); assert.deepEqual(F.options.map((o) => [o.count, o.mine]), [[2, true], [2, false], [0, false]]);
  // one note for the host, folded: not one per vote
  const N = inbox(U.hana.email).filter((n) => n.kind === "poll"); assert.equal(N.length, 1, JSON.stringify(N)); assert.equal(N[0].title, "Sol, Pia and 1 other answered when works for Dumpling night"); assert.equal(N[0].link, "/feed?poll=" + pid);
  assert.equal(inbox(U.finn.email).filter((n) => n.kind === "poll").length, 0);
  // once the host has read it, later answers don't bring another
  const p = "system/inbox-" + crypto.createHash("sha256").update(U.hana.email).digest("hex").slice(0, 24), d = srv.store.get(p).data; srv.store.set(p, { ...d, list: d.list.map((n) => ({ ...n, read: true })) });
  assert.equal((await vote("wes", pid, "c")).status, 200); assert.equal(inbox(U.hana.email).filter((n) => n.kind === "poll").length, 1); assert.equal((await vote("wes", pid, "c", false)).status, 200);
  // someone the viewer blocked is left out of what they see
  assert.ok((await post("/api/me/blocks", { kind: "person", key: key(U.sol.email), name: "Sol" }, U.finn.cookie)).ok);
  assert.deepEqual((await read("finn", pid)).poll.options.map((o) => o.count), [2, 1, 0]);
  assert.ok((await del("/api/me/blocks?target=" + encodeURIComponent("person:" + key(U.sol.email)), U.finn.cookie)).ok);
});

test("kudos and comments work on a poll like on any card", async () => {
  let r = await post("/api/feed/kudos", { target: "q:" + pid }, U.finn.cookie), j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j)); assert.equal(j.count, 1); assert.equal(j.line, "You gave kudos");
  r = await post("/api/feed/comments", { target: "q:" + pid, text: "Can we do the 6th a bit later?" }, U.pia.cookie); assert.equal(r.status, 200);
  const F = pollIn(await feedOf("finn"), pid); assert.equal(F.kudos.count, 1); assert.equal(F.comments.count, 1); assert.equal(F.comments.last[0].text, "Can we do the 6th a bit later?");
  const N = inbox(U.hana.email).find((n) => n.kind === "comment"); assert.ok(N, "the host hears about the comment"); assert.equal(N.link, "/feed?poll=" + pid);
  assert.equal((await post("/api/feed/kudos", { target: "q:" + "0".repeat(24) }, U.finn.cookie)).status, 404);
});

test("only the host closes; a closed poll keeps its answers and takes no more", async () => {
  const P = (await ask("hana", { title: "Soup swap", options: OPTS() })).poll; assert.equal((await vote("finn", P.id, "b")).status, 200);
  for (const w of ["finn", "sol"]) assert.equal((await post(`/api/feed/polls/${P.id}/close`, {}, U[w].cookie)).status, 403, w + " can't close it");
  assert.equal((await post(`/api/feed/polls/${P.id}/close`, {}, "")).status, 401); assert.equal((await del(`/api/feed/polls/${P.id}`, U.finn.cookie)).status, 403);
  const r = await post(`/api/feed/polls/${P.id}/close`, {}, U.hana.cookie), j = await r.json(); assert.equal(r.status, 200); assert.equal(j.poll.open, false); assert.equal(j.poll.options[1].count, 1);
  const v = await vote("pia", P.id, "a"); assert.equal(v.status, 409); assert.equal(v.code, "closed"); assert.equal(v.poll.options[0].count, 0);
  assert.equal(pollIn(await feedOf("finn"), P.id).open, false, "it stays in the feed, closed");
  // a poll whose closing day has passed is closed without anyone tapping
  const Q = (await ask("hana", { title: "Old one", options: OPTS() })).poll, path = "system/feedpoll-" + Q.id; srv.store.set(path, { ...srv.store.get(path).data, closes: day(-3) });
  assert.equal((await read("finn", Q.id)).poll.open, false); assert.equal((await vote("finn", Q.id, "a")).status, 409);
  assert.equal((await del(`/api/feed/polls/${Q.id}`, U.hana.cookie)).status, 200); assert.equal((await del(`/api/feed/polls/${P.id}`, U.hana.cookie)).status, 200);
});

test("the host makes the event: the card reads It's on, the people who picked that time hear once, nobody is replied for", async () => {
  // not the host: an event that names someone else's poll changes nothing
  assert.equal((await put("events/fpSol", { name: "Not mine", kind: "social", casual: true, date: day(5), published: true, fromPoll: pid + ".a" }, U.sol.cookie)).status, 200);
  assert.equal((await read("hana", pid)).poll.event, undefined);
  // a draft with no date yet doesn't count either
  assert.equal((await put("events/fpEv", { name: "Dumpling night", kind: "social", casual: true, date: "", published: false, fromPoll: pid + ".a" }, U.hana.cookie)).status, 200);
  assert.equal((await read("hana", pid)).poll.event, undefined);
  assert.equal((await put("events/fpEv", { name: "Dumpling night", kind: "social", casual: true, city: "Brooklyn", date: day(5), startTime: "19:00", published: true, discoverable: true, fromPoll: pid + ".a" }, U.hana.cookie)).status, 200);
  srv.app.locals.social.bust();
  const H = (await read("hana", pid)).poll; assert.deepEqual(H.event, { id: "fpEv", url: "/e/fpEv", title: "Dumpling night", date: day(5), time: "19:00" }); assert.equal(H.picked, "a"); assert.equal(H.open, false);
  assert.equal((await vote("finn", pid, "b")).status, 409);
  // Finn and Pia picked that time: one note each, with the link. Sol picked another time; the host gets none.
  for (const w of ["finn", "pia"]) { const N = inbox(U[w].email).filter((n) => n.kind === "itson"); assert.equal(N.length, 1, w); assert.equal(N[0].link, "/e/fpEv"); assert.equal(N[0].title, `It's on: Dumpling night, ${whenLabel(day(5), "19:00")}`); assert.match(N[0].preview, /Hana picked a time you said works/); }
  for (const w of ["sol", "hana", "bo"]) assert.equal(inbox(U[w].email).filter((n) => n.kind === "itson").length, 0, w);
  // saving the event again tells nobody twice, and nobody was replied for
  assert.equal((await put("events/fpEv", { name: "Dumpling night", kind: "social", casual: true, city: "Brooklyn", date: day(5), startTime: "19:30", published: true, discoverable: true, fromPoll: pid + ".a" }, U.hana.cookie)).status, 200);
  srv.app.locals.social.bust();
  assert.equal(inbox(U.finn.email).filter((n) => n.kind === "itson").length, 1); assert.equal((await read("finn", pid)).poll.event.time, "19:30", "the card follows the event's own time");
  assert.deepEqual(srv.store.list(`ws/${U.hana.ws}/rsvps`).filter((d) => d.data?.eventId === "fpEv"), [], "no reply was made for anyone");
  assert.equal(pollIn(await feedOf("pia"), pid).event.url, "/e/fpEv");
});

test("writes are rate limited per person", async () => {
  process.env.ENCORE_FEED_POLLS_PER_HOUR = "2"; const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await ask("wes", { options: OPTS() })).status); assert.deepEqual(codes, [200, 200, 429, 429]);
  process.env.ENCORE_FEED_POLLS_PER_HOUR = "500"; const P = (await ask("hana", { title: "Limits", options: OPTS() })).poll;
  await join("zed", "Zed Okoro"); process.env.ENCORE_FEED_POLL_VOTES_PER_HOUR = "3"; const v = [];
  for (let i = 0; i < 5; i++) v.push((await vote("bo", P.id, "a")).status); assert.deepEqual(v, [404, 404, 404, 404, 404], "blocked comes first");
  for (let i = 0; i < 5; i++) v.push((await vote("zed", P.id, "a", i % 2 === 0)).status); assert.deepEqual(v.slice(5), [200, 200, 200, 429, 429]);
  process.env.ENCORE_FEED_POLL_VOTES_PER_HOUR = "500"; process.env.ENCORE_FEED_POLL_VOTES_PER_IP_HOUR = "1"; assert.equal((await vote("pia", P.id, "a")).status, 429);
  Object.assign(process.env, ENV); assert.equal((await del(`/api/feed/polls/${P.id}`, U.hana.cookie)).status, 200);
});

test("the copy keeps to the house words", () => {
  const src = fs.readFileSync(new URL("../public/feedpoll.js", import.meta.url), "utf8") + fs.readFileSync(new URL("../server/feedpoll.js", import.meta.url), "utf8");
  assert.ok(!/—/.test(src), "no em dashes"); for (const w of ["elevate", "curated", "seamless", "unlock", "marketplace", "magical", "attendees", "seats", "per person", "publish"]) assert.ok(!new RegExp("\\b" + w + "\\b", "i").test(src), "never says " + w);
  assert.ok(!/countdown|#[cC]0392[bB]|\bred\b/.test(src), "no countdowns, no red");
});

// ---------- the phone walk ----------
const SHOTS = process.env.POLL_SHOTS ? new URL("../.shots/poll/", import.meta.url) : null;
// a card is shot with the page scrolled so it starts just under the top bar: the screen as a person sees it
const shot = async (page, name, loc) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); const f = new URL(name + ".png", SHOTS).pathname;
  if (loc) { await loc.evaluate((el) => { const top = [...document.querySelectorAll("header,.es-top,.tabs")].filter((x) => ["fixed", "sticky"].includes(getComputedStyle(x).position)).reduce((m, x) => Math.max(m, x.getBoundingClientRect().bottom), 0); scrollTo(0, scrollY + el.getBoundingClientRect().top - top - 12); }); await page.waitForTimeout(350); }
  await page.screenshot({ path: f }); };
test("on a phone: ask from the +, answer as a second person, make the event as the host", async (t) => {
  let pw; try { pw = createRequire(import.meta.url)("playwright"); } catch { return t.skip("playwright is not installed"); }
  let browser; try { browser = await pw.chromium.launch(); } catch { return t.skip("no Chromium here"); }
  await join("ivy", "Ivy Moreno"); await join("jo", "Jo Aldana"); await join("kai", "Kai Brandt");
  for (const w of ["jo", "kai"]) assert.ok((await post("/api/me/friends", { key: key(U.ivy.email) }, U[w].cookie)).ok);
  srv.app.locals.social.bust();
  const errsAll = [];
  const open = async (who) => { const ctx = await browser.newContext({ ...pw.devices["iPhone 13"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: "block" });
    if (who) await ctx.addCookies(U[who].cookie.split("; ").map((c) => { const [k, ...v] = c.split("="); return { name: k, value: v.join("="), url: srv.base }; }));
    await ctx.addInitScript(() => { try { localStorage.setItem("encore.place", JSON.stringify({ city: "New York", source: "manual", at: Date.now() })); localStorage.setItem("encore.city", "New York"); sessionStorage.setItem("encore.feedCity", "1"); } catch {} });
    const page = await ctx.newPage(); page.on("pageerror", (e) => errsAll.push((who || "out") + " pageerror " + String(e.message).slice(0, 200)));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) errsAll.push((who || "out") + " " + m.text().slice(0, 200)); });
    return { ctx, page }; };
  try {
    // ---- the host asks, from the "+" ----
    const H = await open("ivy"); await H.page.goto(srv.base + "/feed", { waitUntil: "networkidle" }); await H.page.waitForSelector(".pc-fab");
    // the "+" steps out of the way of a card's own controls (public/feed.html), so find a spot where it is there to tap
    await H.page.evaluate(async () => { const f = document.querySelector(".pc-fab"), free = () => { const r = f.getBoundingClientRect(); return !f.classList.contains("fb-dodge") && !f.classList.contains("away") && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest(".pc-fab") === f; };
      scrollTo(0, 500); for (let i = 0; i < 40 && !free(); i++) { scrollBy(0, -24); await new Promise((r) => setTimeout(r, 120)); } });
    await H.page.locator(".pc-fab").tap(); await H.page.locator('[data-tile="poll"]').tap(); await H.page.waitForSelector(".fp-sheet #fpQ");
    assert.equal(await H.page.locator('[data-tile="poll"]').count() ? await H.page.locator(".pc-scrim.on").count() : 0, 0, "the + sheet steps aside");
    assert.equal(await H.page.locator("#fpQ").inputValue(), "When works for you?"); assert.equal(await H.page.locator("[data-go]").isDisabled(), true, "nothing to ask until there are two times");
    await H.page.locator("#fpT").fill("Dumpling night");
    const chips = H.page.locator(".fp-chip"); assert.equal(await chips.count(), 9, "two weekends and five weeknights");
    await chips.nth(0).tap(); assert.equal(await H.page.locator("[data-go]").isDisabled(), true); await chips.nth(1).tap(); await chips.nth(4).tap();
    assert.equal(await H.page.locator(".fp-row").count(), 3); assert.equal(await H.page.locator("[data-go]").isDisabled(), false);
    const form = await H.page.evaluate(() => { const px = (el) => parseFloat(getComputedStyle(el).fontSize), r = (s) => document.querySelector(s).getBoundingClientRect();
      return { chipH: Math.min(...[...document.querySelectorAll(".fp-chip")].map((c) => c.getBoundingClientRect().height)), go: r("[data-go]").height, goR: getComputedStyle(document.querySelector("[data-go]")).borderRadius, h: px(document.querySelector(".fp-h")), q: px(document.querySelector("#fpQ")),
        inView: r("[data-go]").bottom <= innerHeight && r(".fp-sheet").top >= 0, overflowX: document.querySelector(".fp-form").scrollWidth > document.querySelector(".fp-form").clientWidth, small: [...document.querySelectorAll(".fp-sheet input")].filter((i) => px(i) < 16).length }; });
    assert.ok(form.chipH >= 44 && form.go >= 52, "pills are easy to tap"); assert.match(form.goR, /^999px|^26px/); assert.ok(form.h >= 24 && form.q >= 20, "big type " + JSON.stringify(form)); assert.ok(form.inView, "Ask stays on screen"); assert.equal(form.overflowX, false); assert.equal(form.small, 0, "inputs don't zoom the page on a phone");
    await H.page.waitForTimeout(350); await shot(H.page, "1-create-form");
    await H.page.locator("[data-go]").tap(); await H.page.waitForSelector(".fb-stream .fp-card"); await H.page.waitForTimeout(500);
    const id = await H.page.locator(".fp-card").first().getAttribute("data-fp"); assert.match(id, /^[a-f0-9]{24}$/);
    assert.equal(await H.page.locator(".fp-sheet").count(), 0); assert.equal(await H.page.locator(`[data-fp="${id}"] .fp-pick`).count(), 3, "the host gets Pick this date on each time");

    // ---- a follower answers ----
    const G = await open("jo"); await G.page.goto(srv.base + "/feed", { waitUntil: "networkidle" }); await G.page.waitForSelector(`[data-fp="${id}"]`); await G.page.waitForTimeout(700);
    const card = G.page.locator(`[data-fp="${id}"]`); await card.scrollIntoViewIfNeeded();
    const look = await card.evaluate((c) => { const s = getComputedStyle(c), all = [...document.querySelectorAll(".fb-stream>.fb-card")], other = all.find((x) => x !== c), o = other && getComputedStyle(other), f = (el) => { const e = getComputedStyle(el); return [e.fontFamily.split(",")[0].replace(/"/g, ""), e.fontSize, e.fontWeight].join(" "); };
      const rows = [...c.querySelectorAll("button.fp-opt")].map((b) => b.getBoundingClientRect());
      return { w: Math.round(c.getBoundingClientRect().width), same: !other || ["backgroundColor", "borderTopWidth", "borderTopColor", "borderTopLeftRadius", "paddingLeft"].every((k) => s[k] === o[k]), rows: rows.map((r) => [Math.round(r.width), Math.round(r.height)]), inner: Math.round(c.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight)),
        host: f(c.querySelector(".fb-host b")), meta: f(c.querySelector(".fb-meta")), title: f(c.querySelector(".fb-title")), acts: [...c.querySelectorAll(".fb-acts .fb-act")].map((a) => Math.round(a.getBoundingClientRect().height) + "|" + Math.round(a.getBoundingClientRect().width) + "|" + f(a)),
        txt: c.innerText, timers: c.querySelectorAll("time,[data-countdown]").length, overflowX: document.documentElement.scrollWidth > innerWidth }; });
    assert.equal(look.w, 358, "the card fills the column like every other card"); assert.ok(look.same, "the same surface, edge, corners and padding as the other cards");
    assert.equal(look.rows.length, 3); for (const [w, h] of look.rows) { assert.equal(w, look.inner, "an option is a full-width row"); assert.ok(h >= 44, "an option is a 44px target"); }
    assert.equal(look.host, "IBM Plex Sans 15px 600"); assert.equal(look.meta, "IBM Plex Sans 14px 400"); assert.equal(look.title, "IBM Plex Sans 18px 600");
    assert.equal(look.acts.length, 3, "kudos, comment and share"); assert.equal(new Set(look.acts).size, 1, "one row of equal actions"); assert.ok(+look.acts[0].split("|")[0] >= 44);
    assert.match(look.txt, /Ivy Moreno/); assert.match(look.txt, /Dumpling night/); assert.match(look.txt, /When works for you\?/); assert.match(look.txt, /Tap every time that works for you\./); assert.equal(look.timers, 0); assert.equal(look.overflowX, false);
    assert.equal(await card.locator(".fp-pick,[data-fp-close]").count(), 0, "a guest gets no host controls");
    await shot(G.page, "2-guest-before", card);
    const o1 = card.locator("button.fp-opt").nth(0), o2 = card.locator("button.fp-opt").nth(1);
    await o1.tap(); assert.equal(await card.locator("button.fp-opt").nth(0).getAttribute("aria-pressed"), "true", "the tap shows at once"); await o2.tap(); await G.page.waitForTimeout(500);
    assert.deepEqual(await card.locator("button.fp-opt").evaluateAll((L) => L.map((b) => [b.getAttribute("aria-pressed"), b.querySelector(".fp-n").textContent])), [["true", "1"], ["true", "1"], ["false", ""]]);
    assert.match(await card.locator(".fp-hint").innerText(), /You picked 2/);
    await shot(G.page, "3-guest-after", card);
    assert.deepEqual((await read("jo", id)).poll.options.map((o) => o.mine), [true, true, false], "the server has both picks");
    await card.locator("button.fp-opt").nth(1).tap(); await G.page.waitForTimeout(400); assert.deepEqual((await read("jo", id)).poll.options.map((o) => o.mine), [true, false, false], "tap again to undo");
    // a tap that doesn't save goes back, and says so
    await G.page.route("**/api/feed/polls/*/vote", (route) => route.abort()); await card.locator("button.fp-opt").nth(2).tap(); await G.page.waitForTimeout(500);
    assert.equal(await card.locator("button.fp-opt").nth(2).getAttribute("aria-pressed"), "false", "a failed tap is put back"); assert.match(await card.locator("[data-fp-msg]").innerText(), /didn't save/);
    assert.equal(await card.locator("button.fp-opt").nth(0).getAttribute("aria-pressed"), "true", "the earlier pick stays"); await G.page.unroute("**/api/feed/polls/*/vote");
    // kudos on the card works like on any other
    await card.locator("[data-fb-kudos]").tap(); await G.page.waitForTimeout(400); assert.equal(await card.locator("[data-fb-kudos]").getAttribute("aria-pressed"), "true");
    await G.ctx.close();
    assert.equal((await vote("kai", id, "a")).status, 200); assert.equal((await vote("kai", id, "c")).status, 200);

    // ---- signed out: the link shows the poll, a tap asks you to sign in ----
    const O = await open(""); await O.page.goto(srv.base + "/feed?poll=" + id, { waitUntil: "networkidle" }); await O.page.waitForSelector(`[data-fp="${id}"]`); await O.page.waitForTimeout(600);
    const oc = O.page.locator(`[data-fp="${id}"]`); assert.match(await oc.innerText(), /Dumpling night/); await oc.locator("button.fp-opt").first().tap(); await O.page.waitForSelector(".fp-sheet");
    assert.match(await O.page.locator(".fp-sheet").innerText(), /Sign in to say when you're free/); assert.match(await O.page.locator(".fp-sheet a").first().getAttribute("href"), /^\/login\?next=%2Ffeed%3Fpoll%3D/);
    assert.equal(await oc.locator("button.fp-opt").first().getAttribute("aria-pressed"), "false"); await O.ctx.close();

    // ---- the host sees who picked what, then picks the date ----
    await H.page.goto(srv.base + "/feed", { waitUntil: "networkidle" }); await H.page.waitForSelector(`[data-fp="${id}"]`); await H.page.waitForTimeout(700);
    const hc = H.page.locator(`[data-fp="${id}"]`); await hc.scrollIntoViewIfNeeded();
    assert.deepEqual(await hc.locator(".fp-res").evaluateAll((L) => L.map((r) => [r.querySelector(".fp-n").textContent, r.querySelector(".fp-names").textContent])), [["2", "Jo, Kai"], ["", "No one yet"], ["1", "Kai"]]);
    assert.match(await hc.locator(".fp-foot").innerText(), /2 people answered/); assert.equal(await hc.locator("[data-fp-close]").count(), 1);
    const picks = await hc.locator(".fp-pick").evaluateAll((L) => L.map((a) => Math.round(a.getBoundingClientRect().height))); assert.ok(picks.every((h) => h >= 44), "Pick this date is a 44px target");
    await shot(H.page, "4-host-results", hc);
    assert.deepEqual(inbox(U.ivy.email).filter((n) => n.kind === "poll").map((n) => n.title), ["Kai and Jo answered when works for Dumpling night"]);
    const want = (await read("ivy", id)).poll.options[0];
    await Promise.all([H.page.waitForURL(/\?app=1/), hc.locator(".fp-pick").first().tap()]);
    await H.page.waitForSelector("#cv #cvTitle", { timeout: 30000 }); await H.page.waitForTimeout(800);
    assert.equal(await H.page.locator("#cvTitle").inputValue(), "Dumpling night", "the editor opens with the title");
    assert.equal(await H.page.locator(".ds-go#dsStart").count(), 0, "straight to the editor, no chooser on the way");
    assert.doesNotMatch(H.page.url(), /poll=/, "the link is cleaned up once it is read");
    await H.page.locator("[data-cv=save]").first().tap();
    let made = null; for (let i = 0; i < 40 && !made; i++) { await H.page.waitForTimeout(300); made = (await read("ivy", id)).poll.event || null; }
    assert.ok(made, "saving the event turns the poll into It's on"); assert.equal(made.title, "Dumpling night"); assert.equal(made.date, want.date); assert.equal(made.time, want.time);
    // the two who picked that time hear, once
    for (const w of ["jo", "kai"]) { const N = inbox(U[w].email).filter((n) => n.kind === "itson"); assert.equal(N.length, 1, w); assert.equal(N[0].link, made.url); }
    assert.deepEqual(srv.store.list(`ws/${U.ivy.ws}/rsvps`).filter((d) => d.data?.eventId === made.id), [], "nobody was replied for");
    // ---- the card after ----
    const K = await open("kai"); await K.page.goto(srv.base + "/feed", { waitUntil: "networkidle" }); await K.page.waitForSelector(`[data-fp="${id}"]`); await K.page.waitForTimeout(700);
    const kc = K.page.locator(`[data-fp="${id}"]`); await kc.scrollIntoViewIfNeeded();
    assert.match(await kc.locator(".fp-on").innerText(), /^It's on: /); assert.equal(await kc.locator(".fp-on a").getAttribute("href"), made.url); assert.equal(await kc.locator("button.fp-opt").count(), 0, "no more taps");
    assert.equal(await kc.locator(".fb-cta").count(), 1); assert.equal(await kc.locator(".fb-cta").innerText(), "See the invite");
    await shot(K.page, "5-after-converting", kc); await K.ctx.close(); await H.ctx.close();
    assert.deepEqual(errsAll, []);
  } finally { await browser.close(); }
});
