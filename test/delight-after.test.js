// During and after the event (server/delightafter.js, public/delightafter.js): the morning-of card, live photos, the
// host's hour before, the morning after, the polaroid recap, the next one, scrapbook additions and keeping in touch.
// Each moment's timing, privacy, caps and switches.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { PNG_1PX } from "./routes-seed.js";
import { phaseOf, morningDue, morningSendMs, hostHourDue, scrapbookDue, summaryDue, suggestNext, nextLine, stampOf, polaroidPick, weatherLine, weatherConfig, quietAt, DELIGHT } from "../server/delightafter.js";
import { textOf, pngSize } from "../server/sharecards.js";

let srv, host, ana, lou, ws, D, rid = {};
const J = { "Content-Type": "application/json" };
const req = (method, path, body, cookie) => fetch(srv.base + path, { method, headers: { ...J, ...(cookie ? { cookie } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const getJ = async (path, cookie) => { const r = await fetch(srv.base + path, { headers: cookie ? { cookie } : {} }); return { status: r.status, j: await r.json().catch(() => null) }; };
const put = (path, body, cookie) => req("PUT", "/api/db/doc?path=" + path, body, cookie);
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const at = (d, hm) => Date.parse(`${d}T${hm}:00Z`); // every event here is in UTC
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "delight-after-secret-0123456789", ENCORE_SIGNUP_PER_HOUR: "200", ENCORE_FAKE_SMS: "1", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_PUSH: "1" };
const inbox = (email) => srv.store.get("system/inbox-" + srv.app.locals.social?.hash?.(email))?.data?.list;
const bellOf = async (cookie) => (await getJ("/api/me/inbox", cookie)).j.items;

async function signup(name, email, handle) {
  const r = await req("POST", "/api/signup", { name, email, password: "long-password-1", mode: "friends" }); const cookie = r.headers.get("set-cookie").split(";")[0];
  if (handle) assert.ok((await req("POST", "/api/host/profile", { handle, name, tagline: "Small dinners.", city: "Brooklyn", hood: "Bed-Stuy" }, cookie)).ok);
  return cookie;
}
const base = { casual: true, tz: "UTC", published: true, discoverable: true, city: "Brooklyn", hood: "Bed-Stuy", activity: "dinner", startTime: "19:00", endTime: "22:00" };
before(async () => {
  Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer(); D = srv.app.locals.delight;
  host = await signup("Rae Potter", "rae.dl@example.com", "rae-dl"); ana = await signup("Ana Diaz", "ana.dl@example.com"); lou = await signup("Lou Baker", "lou.dl@example.com", "lou-dl");
  ws = srv.store.get("system/handle-rae-dl").data.ws;
  assert.ok((await put("events/dlToday", { ...base, name: "Dumpling night", date: day(0), venueAddr: "12 Clay St, Apt 3", bring: ["A dessert"], playlistUrl: "https://open.spotify.com/playlist/abc", price: "$20", payLink: "https://venmo.com/rae" }, host)).ok);
  assert.ok((await put("events/dlPast", { ...base, name: "Soup supper", date: day(-1), startTime: "18:00", endTime: "21:00" }, host)).ok);
  assert.ok((await put("events/dlHidden", { ...base, name: "Quiet table", date: day(0), hideGuests: true }, host)).ok);
  const add = async (eventId, body) => (await (await req("POST", "/api/db/collection?path=rsvps", { eventId, code: "C" + Math.random().toString(36).slice(2, 7), createdAt: Date.now(), ...body }, host)).json()).id;
  rid.ana = await add("dlToday", { name: "Ana Diaz", email: "ana.dl@example.com", response: "going", dietary: "Vegetarian, call me at 415-555-0100" });
  rid.bo = await add("dlToday", { name: "Bo Chen", email: "bo.dl@guest.example.com", response: "going", showMe: false });
  rid.cy = await add("dlToday", { name: "Cy Maybe", email: "cy.dl@guest.example.com", response: "maybe" });
  rid.pAna = await add("dlPast", { name: "Ana Diaz", email: "ana.dl@example.com", response: "going" });
  rid.pBo = await add("dlPast", { name: "Bo Chen", email: "bo.dl@guest.example.com", response: "going" });
  rid.pDi = await add("dlPast", { name: "Di Noshow", email: "di.dl@guest.example.com", response: "going", noShow: true });
  rid.hAna = await add("dlHidden", { name: "Ana Diaz", email: "ana.dl@example.com", response: "going" });
  rid.hBo = await add("dlHidden", { name: "Bo Chen", email: "bo.dl@guest.example.com", response: "going" });
  for (const k of Object.keys(rid)) rid[k] = { rid: String(rid[k]).split("/").pop(), code: srv.store.get(`ws/${ws}/rsvps/${String(rid[k]).split("/").pop()}`)?.data?.code };
});
after(async () => { for (const k of [...Object.keys(ENV), "ENCORE_WEATHER"]) delete process.env[k]; D.setNow(null); await srv.close(); });
const proof = (r) => `rid=${encodeURIComponent(r.rid)}&code=${encodeURIComponent(r.code)}`;

test("timing: each window opens and closes when it should", () => {
  const ev = { ...base, date: "2026-03-10" };
  assert.equal(phaseOf(ev, at("2026-03-10", "08:00")), "dayof"); assert.equal(phaseOf(ev, at("2026-03-10", "18:31")), "live", "30 minutes before");
  assert.equal(phaseOf(ev, at("2026-03-10", "23:59")), "live", "until 2 hours after the end"); assert.equal(phaseOf(ev, at("2026-03-11", "00:30")), "", "then nothing overnight");
  assert.equal(phaseOf(ev, at("2026-03-11", "07:00")), "", "not before 8am the morning after"); assert.equal(phaseOf(ev, at("2026-03-11", "08:00")), "after");
  assert.equal(phaseOf(ev, at("2026-03-13", "20:00")), "after"); assert.equal(phaseOf(ev, at("2026-03-14", "09:00")), "", "3 days, then it's done");
  assert.equal(phaseOf({ ...ev, cancelled: true }, at("2026-03-10", "08:00")), "", "never for a cancelled event");
  assert.equal(new Date(morningSendMs(ev)).toISOString().slice(11, 16), "09:00", "9am on the day");
  assert.equal(new Date(morningSendMs({ ...ev, startTime: "08:00" })).toISOString().slice(11, 16), "07:00", "an early start: 2 hours before, never before 7am");
  assert.equal(new Date(morningSendMs({ ...ev, startTime: "10:00" })).toISOString().slice(11, 16), "08:00");
  assert.equal(morningDue(ev, at("2026-03-10", "08:59")), false); assert.equal(morningDue(ev, at("2026-03-10", "09:10")), true); assert.equal(morningDue(ev, at("2026-03-10", "19:05")), false, "not once it started");
  assert.equal(hostHourDue(ev, at("2026-03-10", "17:30")), false); assert.equal(hostHourDue(ev, at("2026-03-10", "17:50")), true); assert.equal(hostHourDue(ev, at("2026-03-10", "18:15")), true); assert.equal(hostHourDue(ev, at("2026-03-10", "18:50")), false);
  assert.equal(scrapbookDue(ev, at("2026-03-11", "09:00")), false); assert.equal(scrapbookDue(ev, at("2026-03-11", "10:00")), true); assert.equal(scrapbookDue(ev, at("2026-03-11", "22:00")), false, "quiet hours");
  assert.equal(summaryDue(ev, at("2026-03-11", "12:00")), false, "the host's summary waits a day for kudos"); assert.equal(summaryDue(ev, at("2026-03-12", "09:00")), true); assert.equal(summaryDue(ev, at("2026-03-15", "09:00")), false);
  assert.equal(quietAt(at("2026-03-10", "21:00"), "UTC"), true); assert.equal(quietAt(at("2026-03-10", "07:59"), "UTC"), true); assert.equal(quietAt(at("2026-03-10", "08:00"), "UTC"), false);
  assert.equal(quietAt(at("2026-03-10", "14:00"), "America/New_York"), false); assert.equal(quietAt(at("2026-03-10", "03:00"), "America/New_York"), true);
});

test("the next one: the night's own rhythm, honest about who wants to come back", () => {
  assert.deepEqual(suggestNext({ date: "2026-03-10" }, { today: "2026-03-11" }).date, "2026-04-07", "four weeks on, the same weekday");
  const w = suggestNext({ date: "2026-03-10" }, { prev: "2026-03-03", today: "2026-03-11" }); assert.equal(w.repeat, "weekly"); assert.equal(w.date, "2026-03-17");
  assert.equal(suggestNext({ date: "2026-03-10" }, { prev: "2026-02-24", today: "2026-03-11" }).repeat, "biweekly");
  assert.equal(suggestNext({ date: "2026-03-10", repeat: "monthly" }, { today: "2026-03-11" }).repeat, "monthly");
  assert.equal(suggestNext({ date: "2026-01-06" }, { today: "2026-03-11" }).date > "2026-03-11", true, "never a date in the past");
  assert.match(nextLine({ date: "2026-04-07", back: 2, came: 5, title: "Soup supper" }), /^2 people said they'd come back\. Tue, Apr 7 could be the next Soup supper/);
  assert.match(nextLine({ date: "2026-04-07", back: 3, came: 3, title: "Soup" }), /^Everyone said/);
  assert.doesNotMatch(nextLine({ date: "2026-04-07", back: 0, came: 4, title: "Soup" }), /come back/, "never claims anyone wants to come back");
  assert.equal(stampOf("2026-11-26"), "NOV 26 2026");
  const P = polaroidPick([{ id: "a", url: "/_blob/aaaaaaaa", authorEmail: "h@x", at: 1 }, { id: "b", url: "/_blob/bbbbbbbb", authorEmail: "h@x", at: 2 }, { id: "c", url: "/_blob/cccccccc", authorEmail: "g@x", at: 3 }, { id: "d", url: "/_blob/dddddddd", hidden: true, at: 4 }, { id: "e", url: "/_blob/eeeeeeee", type: "video", at: 5 }], { max: 2 });
  assert.deepEqual(P.map((m) => m.id), ["a", "c"], "one each before seconds; never hidden photos or videos");
  assert.equal(weatherLine({ temp: 18, code: 1, rain: 40 }, { time: "7pm" }), "Around 7pm: 64°F and mostly clear. A 40% chance of rain, so maybe a jacket.");
  assert.equal(weatherConfig({}), null, "no weather source unless one is set"); assert.deepEqual(weatherConfig({ ENCORE_WEATHER: "open-meteo" }), { source: "open-meteo" });
});

test("5. the morning-of card: address only for people who are in, first names by the privacy rules, weather only when configured", async () => {
  D.setNow(() => at(day(0), "09:30"));
  const a = (await getJ(`/api/delight/event/dlToday?${proof(rid.ana)}`)).j; assert.equal(a.phase, "dayof");
  assert.equal(a.dayof.where, "12 Clay St, Apt 3", "Ana is in: the address"); assert.equal(a.dayof.time, "7pm"); assert.deepEqual(a.dayof.bring, ["A dessert"]);
  assert.equal(a.dayof.weather, "", "no weather source: the line is left out"); assert.doesNotMatch(JSON.stringify(a), /Bo/, "Bo hid himself: never named");
  assert.equal(a.dayof.who.line, "You and 1 other person.", "Bo is counted, not named"); assert.doesNotMatch(JSON.stringify(a), /ana\.dl@|415/, "no emails or phones");
  const c = (await getJ(`/api/delight/event/dlToday?${proof(rid.cy)}`)).j; assert.equal(c.dayof, undefined, "a maybe gets no card"); assert.doesNotMatch(JSON.stringify(c), /Clay St/);
  const out = (await getJ("/api/delight/event/dlToday")).j; assert.deepEqual(Object.keys(out).sort(), ["eventId", "phase"], "a stranger gets nothing");
  const h = (await getJ(`/api/delight/event/dlHidden?${proof(rid.hAna)}`)).j; assert.equal(h.dayof.who, null, "the host hid the guest list"); assert.doesNotMatch(JSON.stringify(h), /Bo/);
  const signed = (await getJ("/api/delight/event/dlToday", ana)).j; assert.equal(signed.dayof.where, "12 Clay St, Apt 3", "signed in, by her account's reply"); assert.deepEqual(signed.proof, { rid: rid.ana.rid, code: rid.ana.code }, "her own proof, so one tap works");
  assert.equal((await getJ("/api/delight/event/dlToday", lou)).j.dayof, undefined, "another signed-in person gets nothing");
  process.env.ENCORE_WEATHER = "fake"; const w = (await getJ(`/api/delight/event/dlToday?${proof(rid.ana)}`)).j; delete process.env.ENCORE_WEATHER;
  assert.match(w.dayof.weather, /^Around 7pm: \d+°C and /, "with a source, the weather at the start time (Celsius outside the Americas)");
  // the host's note for the day reaches the card
  assert.equal((await req("PUT", "/api/delight/host/dlToday/note", { note: "Ring the top buzzer." }, host)).status, 200);
  assert.equal((await req("PUT", "/api/delight/host/dlToday/note", { note: "x" }, ana)).status, 403, "only the host");
  assert.equal((await getJ(`/api/delight/event/dlToday?${proof(rid.ana)}`)).j.dayof.note, "Ring the top buzzer.");
});

test("5. the morning-of note: once per guest, at 9am, not to maybes, not when switched off, never in quiet hours", async () => {
  const run = (hm) => D.run({ now: at(day(0), hm), origin: "https://pl.example" });
  const early = await run("08:00"); assert.equal(early.dayof, 0, "not before 9am");
  const r1 = await run("09:15"); assert.equal(r1.dayof, 4, JSON.stringify(r1) + ": Ana and Bo, on Dumpling night and on Quiet table; never Cy (a maybe)");
  const r2 = await run("10:15"); assert.equal(r2.dayof, 0, "once, ever");
  const items = await bellOf(ana); const n = items.find((x) => x.kind === "dayof" && x.eventId === "dlToday"); assert.ok(n); assert.match(n.text, /^Today: Dumpling night at 7pm\./); assert.equal(n.link, "/e/dlToday");
  assert.ok(!(await bellOf(lou)).some((x) => x.kind === "dayof"), "Lou isn't going");
  assert.equal(r1.texts, 0, "nobody turned on texting with Potto, so no texts");
  // switched off: by the guest (Settings) or by the host (guest messages off for the event)
  await put("events/dlMore", { ...base, name: "Second supper", date: day(0), startTime: "20:00" }, host); await put("events/dlMute", { ...base, name: "Muted supper", date: day(0), startTime: "20:00", autoRemind: false }, host);
  srv.store.set(`ws/${ws}/rsvps/moreAna`, { eventId: "dlMore", name: "Ana Diaz", email: "ana.dl@example.com", response: "going", code: "CMORE1" });
  srv.store.set(`ws/${ws}/rsvps/muteBo`, { eventId: "dlMute", name: "Bo Chen", email: "bo.dl@guest.example.com", response: "going", code: "CMUTE1" });
  assert.equal((await req("PUT", "/api/delight/prefs", { dayof: false }, ana)).status, 200);
  assert.equal((await run("11:00")).dayof, 0, "Ana turned it off; the host turned guest messages off");
  await req("PUT", "/api/delight/prefs", { dayof: true }, ana); for (const id of ["dlMore", "dlMute"]) await req("DELETE", "/api/db/doc?path=events/" + id, undefined, host);
  assert.equal((await run("23:30")).dayof, 0, "never at night");
});

test("6. live photos: during the window, from the event page, into the recap; the host's No photos switch holds", async () => {
  D.setNow(() => at(day(0), "19:30"));
  const a = (await getJ(`/api/delight/event/dlToday?${proof(rid.ana)}`)).j; assert.equal(a.phase, "live"); assert.equal(a.live.noPhotos, false); assert.equal(a.live.photos, 0);
  const up = await fetch(`${srv.base}/api/moments?eventId=dlToday&${proof(rid.ana)}`, { method: "POST", headers: { "content-type": "image/png" }, body: PNG_1PX }); assert.equal(up.status, 200, await up.clone().text());
  assert.equal((await getJ(`/api/delight/event/dlToday?${proof(rid.ana)}`)).j.live.photos, 1);
  const cy = await fetch(`${srv.base}/api/moments?eventId=dlToday&${proof(rid.cy)}`, { method: "POST", headers: { "content-type": "image/png" }, body: PNG_1PX }); assert.equal(cy.status, 403, "a maybe can't add");
  await req("PATCH", "/api/db/doc?path=events/dlHidden", { noPhotos: true }, host);
  assert.equal((await getJ(`/api/delight/event/dlHidden?${proof(rid.hAna)}`)).j.live.noPhotos, true);
  const no = await fetch(`${srv.base}/api/moments?eventId=dlHidden&${proof(rid.hAna)}`, { method: "POST", headers: { "content-type": "image/png" }, body: PNG_1PX }); assert.equal(no.status, 403);
  const h = (await getJ("/api/delight/host/dlToday", host)).j; assert.equal(h.live.photos, 1, "the host sees the count too");
});

test("7. the host's hour before: the checklist from the people actually coming, tick-offs, one bell note", async () => {
  D.setNow(() => at(day(0), "18:05"));
  const h = (await getJ("/api/delight/host/dlToday", host)).j; const C = h.checklist, item = (id) => C.items.find((x) => x.id === id);
  assert.equal(item("chairs").label, "Chairs and spots for 3", "Ana and Bo, plus the host; not the maybe");
  assert.equal(item("diet").notes.length, 1); assert.match(item("diet").sub, /^Ana: Vegetarian, call me at \(number hidden\)$/, "dietary notes from people coming, numbers hidden");
  assert.equal(item("playlist").done, true); assert.equal(item("address").done, true); assert.equal(item("pay").done, true, "a pay link is ready");
  assert.equal(item("chairs").done, false); assert.equal((await req("PUT", "/api/delight/host/dlToday/check", { item: "chairs" }, host)).status, 200);
  assert.equal((await getJ("/api/delight/host/dlToday", host)).j.checklist.items.find((x) => x.id === "chairs").done, true);
  assert.equal((await getJ("/api/delight/host/dlToday", ana)).status, 403, "guests never see the host's view");
  const r1 = await D.run({ now: at(day(0), "18:05") }), r2 = await D.run({ now: at(day(0), "18:20") });
  assert.equal(r1.hostcheck, 2, "Dumpling night and Quiet table"); assert.equal(r2.hostcheck, 0, "one note, no nagging");
  const n = (await bellOf(host)).find((x) => x.kind === "hostcheck" && x.eventId === "dlToday"); assert.match(n.text, /^Dumpling night starts at 7pm\. 2 people are in\./); assert.equal(n.nopush, undefined);
  // in quiet hours it stays in the bell, without a push
  await put("events/dlLate", { ...base, name: "Late snack", date: day(0), startTime: "22:30" }, host); const r3 = await D.run({ now: at(day(0), "21:40") }); assert.equal(r3.hostcheck, 1);
  assert.equal((await bellOf(host)).find((x) => x.eventId === "dlLate").nopush, true);
  D.setNow(() => at(day(0), "12:00")); assert.equal((await getJ("/api/delight/host/dlToday", host)).j.checklist, undefined, "not shown hours early");
});

test("8. the morning after: one-tap kudos, a private note only the host reads, and the host's summary on the second morning", async () => {
  D.setNow(() => at(day(0), "09:00"));
  const a = (await getJ(`/api/delight/event/dlPast?${proof(rid.pAna)}`)).j; assert.equal(a.phase, "after"); assert.equal(a.after.sent, false); assert.ok(a.after.chips.some((c) => c.id === "again"));
  assert.ok(a.after.chips.every((c) => !/[\u{1F000}-\u{1FFFF}]/u.test(c.label)), "plain words, no emoji");
  assert.equal((await req("POST", "/api/public/kudos", { eventId: "dlPast", ...rid.pAna, tags: ["again"], via: "ask" })).status, 200, "the one tap is the existing kudos write");
  assert.equal((await req("POST", "/api/public/kudos", { eventId: "dlPast", ...rid.pBo, tags: ["food"], via: "ask" })).status, 200);
  assert.equal((await req("POST", "/api/delight/after/dlPast/note", { ...rid.pAna, text: "The soup was perfect. Email me at ana@x.com" })).status, 200);
  assert.equal((await req("POST", "/api/delight/after/dlPast/note", { rid: rid.pAna.rid, code: "WRONG", text: "hi there" })).status, 403);
  assert.equal((await req("POST", "/api/delight/after/dlPast/note", { ...rid.pDi, text: "hi there" })).status, 403, "a no-show can't");
  assert.equal((await getJ(`/api/delight/event/dlPast?${proof(rid.pAna)}`)).j.after.sent, true);
  assert.doesNotMatch(JSON.stringify((await getJ(`/api/delight/event/dlPast?${proof(rid.pBo)}`)).j), /soup was perfect/, "other guests never see the note");
  assert.doesNotMatch(JSON.stringify((await getJ("/api/public/host/rae-dl/scrapbook")).j || {}), /soup was perfect/);
  const h = (await getJ("/api/delight/host/dlPast", host)).j; assert.equal(h.summary.line, "Everyone loved it, 1 wants to come back.", "both who came (the no-show is not counted)"); assert.equal(h.summary.notes.length, 1); assert.match(h.summary.notes[0].note, /^The soup was perfect\. Email me at \(email hidden\)$/);
  const early = await D.run({ now: at(day(0), "12:00") }); assert.equal(early.summary, 0, "the second morning, not the first");
  const r = await D.run({ now: at(day(1), "09:10") }); assert.equal(r.summary, 1); assert.equal((await D.run({ now: at(day(1), "11:00") })).summary, 0, "once");
  const n = (await bellOf(host)).find((x) => x.kind === "aftersum"); assert.match(n.text, /^Soup supper: Everyone loved it, 1 wants to come back\. 1 private note for you\./); assert.doesNotMatch(n.text, /soup was perfect/i, "the note's words stay in the manage view");
});

test("9. the polaroid recap: built from the night's photos, posted only when the host approves, shareable as an image without photos", async () => {
  for (const c of [host, null]) { const u = await fetch(`${srv.base}/api/moments?eventId=dlPast${c ? "" : "&" + proof(rid.pAna)}`, { method: "POST", headers: { "content-type": "image/png", ...(c ? { cookie: c } : {}) }, body: PNG_1PX }); assert.equal(u.status, 200); }
  const B = srv.app.locals.feedBlend, recapFor = () => { const out = B.blend({ email: "ana.dl@example.com" }); return (out.items || out).find?.((x) => x.kind === "recap" && x.id === "dlPast"); };
  const before = recapFor(); assert.ok(before, "the recap card is there from the photos"); assert.equal(before.polaroid, undefined, "no polaroid until the host posts it");
  assert.equal((await fetch(`${srv.base}/api/delight/polaroid/dlPast.png`)).status, 404, "nobody else sees the image before it's posted");
  const h = (await getJ("/api/delight/host/dlPast", host)).j; assert.equal(h.polaroid.status, "draft"); assert.equal(h.polaroid.photos.length, 2); assert.equal(h.polaroid.stamp, stampOf(day(-1)));
  assert.equal((await req("POST", "/api/delight/host/dlPast/polaroid", { post: true }, ana)).status, 403, "only the host posts");
  const keep = h.polaroid.photos[1].id, p = (await (await req("POST", "/api/delight/host/dlPast/polaroid", { photos: [keep], caption: "Thank you all. Call 415-555-0100", post: true }, host)).json());
  assert.equal(p.status, "posted"); assert.equal(p.caption, "Thank you all. Call (number hidden)");
  const after1 = recapFor(); assert.equal(after1.polaroid.stamp, stampOf(day(-1))); assert.deepEqual(after1.photos.map((x) => x.id), [keep], "just the photo the host kept");
  const png = await fetch(`${srv.base}/api/delight/polaroid/dlPast.png`); assert.equal(png.status, 200); assert.deepEqual(pngSize(Buffer.from(await png.arrayBuffer())), { w: 1080, h: 1920 });
  const spec = D.polaroidSpec(D.evOf("dlPast")); assert.equal(spec.frame, "polaroid"); assert.ok(textOf(spec).includes(stampOf(day(-1)))); assert.ok(!JSON.stringify(spec).includes("/_blob/"), "no photos on a share card");
  await req("POST", "/api/delight/host/dlPast/polaroid", { unpost: true }, host); assert.equal(recapFor().polaroid, undefined, "taken down");
});

test("10. the next one: people who came pre-filled, ticked when they want to come back; one tap makes a draft or a series, once", async () => {
  D.setNow(() => at(day(1), "09:30"));
  const n = (await getJ("/api/delight/host/dlPast", host)).j.next; assert.ok(n.suggestion); assert.equal(n.suggestion.date, day(27), "four weeks on");
  assert.deepEqual(n.people.map((p) => [p.first, p.back]).sort(), [["Ana", true], ["Bo", false]], "Di was a no-show: not on the list");
  const r = await (await req("POST", "/api/delight/host/dlPast/next", { date: n.suggestion.date, repeat: "monthly", keys: n.people.filter((p) => p.back).map((p) => p.key) }, host)).json();
  assert.ok(r.ok); const ev = srv.store.get(`ws/${ws}/events/${r.id}`).data;
  assert.equal(ev.date, day(27)); assert.equal(ev.repeat, "monthly", "a series"); assert.equal(ev.published, false, "a draft: nobody sees it until the host shares"); assert.equal(ev.prevId, "dlPast");
  assert.deepEqual(ev.guests.map((g) => [g.name, g.status]), [["Ana Diaz", "Invited"]], "only who the host kept");
  const again = await (await req("POST", "/api/delight/host/dlPast/next", { date: day(30), keys: [] }, host)).json(); assert.equal(again.id, r.id, "a double tap never makes two");
  assert.equal((await getJ("/api/delight/host/dlPast", host)).j.next.made.id, r.id);
  assert.equal((await req("POST", "/api/delight/host/dlPast/next", { date: day(-3) }, host)).status, 200, "already made: answers with it");
  assert.equal((await req("POST", "/api/delight/host/dlPast/next", { date: day(30) }, lou)).status, 403);
});

test("11. scrapbook and places: every night attended or hosted is added, with one small note, and the year in nights picks it up", async () => {
  // the job already ran the morning after in the tests above (each run checks every due moment); each person got it once
  const sentTo = srv.store.listPrefix("system", "dlsent-").length; assert.ok(sentTo > 0);
  for (const em of ["ana.dl@example.com", "bo.dl@guest.example.com", "rae.dl@example.com"]) assert.ok(D.scrapLine(em, "dlPast"), em + " has the night in their places");
  assert.equal((await D.run({ now: at(day(0), "11:30") })).scrapbook, 0, "once each");
  const n = (await bellOf(ana)).find((x) => x.kind === "scrapbook"); assert.match(n.text, /^Soup supper is in your scrapbook now\. Your 1st night of \d{4}\.$/); assert.equal(n.link, `/year/${day(-1).slice(0, 4)}`);
  assert.ok((await bellOf(host)).some((x) => x.kind === "scrapbook" && x.eventId === "dlPast"), "the host's hosted night too");
  const places = (await getJ(`/api/me/places?year=${day(-1).slice(0, 4)}`, ana)).j; assert.ok(JSON.stringify(places).includes("dlPast"), "in her places");
  const story = (await getJ(`/api/me/year/${day(-1).slice(0, 4)}`, ana)).j; assert.ok(story.cards.length >= 1, "the year in nights has it"); assert.equal(story.numbers?.nights ?? story.cards.length >= 1, story.numbers ? 1 : true);
  const hs = (await getJ(`/api/me/year/${day(-1).slice(0, 4)}`, host)).j; assert.ok((hs.numbers?.nights || 0) >= 1, "the host's hosted night counts");
  const card = (await getJ(`/api/delight/event/dlPast?${proof(rid.pAna)}`, ana)).j; assert.match(card.scrapbook.line, /^Added to your scrapbook\. Your 1st night of \d{4}\.$/);
  assert.equal((await getJ(`/api/delight/event/dlPast?${proof(rid.pDi)}`)).j.scrapbook, undefined, "a no-show's night isn't added");
});

test("12. keep in touch: a month after, at most one a week, only friends or hosts they loved, only what people allowed, off with one switch", async () => {
  // Ana's last night was a month ago; she loved Rae's; Rae posts something new; Lou (Ana's friend) is going to a public event
  const old = day(-35); await req("PATCH", "/api/db/doc?path=events/dlPast", { date: old }, host);
  for (const id of ["dlToday", "dlHidden", "dlLate"]) await req("PATCH", `/api/db/doc?path=events/${id}`, { date: day(-40) }, host);
  srv.app.locals.social.bust?.(); srv.app.locals.places.bust?.();
  const now = Date.now(), t = (d) => Date.parse(new Date(now).toISOString().slice(0, 10) + "T14:00:00Z") + d * 864e5;
  await put("events/dlNew", { ...base, name: "Pickle night", date: day(10), createdAt: now }, host);
  await put("events/dlPriv", { ...base, name: "Private pickle", date: day(5), discoverable: false, unlisted: true, createdAt: now }, host);
  const k1 = D.keepFor("ana.dl@example.com", t(0)); assert.equal(k1?.kind, "host"); assert.match(k1.text, /^Rae Potter just posted Pickle night, .+\. You loved the last one\.$/); assert.equal(k1.link, "/e/dlNew");
  const r1 = await D.run({ now: t(0) }); assert.ok(r1.keep >= 1); assert.equal(D.keepFor("ana.dl@example.com", t(3)), null, "at most one a week");
  assert.ok((await bellOf(ana)).some((x) => x.kind === "keepintouch" && x.eventId === "dlNew"));
  // a week later: Lou, a friend, going to a public event and showing himself
  await req("POST", "/api/me/friends", { email: "lou.dl@example.com" }, ana).catch(() => {}); srv.app.locals.social.addFriend("ana.dl@example.com", "lou.dl@example.com");
  await put("events/louPub", { ...base, name: "Board games", date: day(8), createdAt: now - 30 * 864e5 }, lou); const lws = srv.store.get("system/handle-lou-dl").data.ws;
  srv.store.set(`ws/${lws}/rsvps/louSelf`, { eventId: "louPub", name: "Lou Baker", email: "lou.dl@example.com", response: "going", code: "CLOU1", showMe: false });
  assert.notEqual(D.keepFor("ana.dl@example.com", t(8))?.kind, "friend", "Lou hid himself on that reply: never used");
  srv.store.update(`ws/${lws}/rsvps/louSelf`, { showMe: true });
  const k2 = D.keepFor("ana.dl@example.com", t(8)); assert.equal(k2?.kind, "friend"); assert.match(k2.text, /^Lou is going to Board games on .+\. You haven't been to one together yet\.$/);
  assert.ok(!JSON.stringify(k2).includes("Private pickle"), "never a private event");
  // Lou isn't Ana's friend the other way: nothing about Ana reaches Lou
  assert.notEqual(D.keepFor("lou.dl@example.com", t(8))?.text?.includes("Ana"), true);
  // off with one switch
  assert.equal((await req("PUT", "/api/delight/prefs", { keep: false }, ana)).status, 200); assert.equal(D.keepFor("ana.dl@example.com", t(8)), null);
  const pr = (await getJ("/api/delight/prefs", ana)).j; assert.equal(pr.prefs.keep, false); assert.equal(pr.prefs.dayof, true);
  // the Plans card offers the switch too
  await req("PUT", "/api/delight/prefs", { keep: true }, ana); D.setNow(() => t(8)); const pl = (await req("POST", "/api/delight/plans", { proofs: [], keep: true }, ana)).json ? await (await req("POST", "/api/delight/plans", { proofs: [], keep: true }, ana)).json() : null;
  assert.equal(pl.keepOn, true); assert.ok(pl.keep?.text, "keep-in-touch shows on Plans");
});

test("measured with privacy-safe PostHog events, and no em dashes, emoji or model names in the new files", async () => {
  const { EVENTS, cleanProps } = await import("../server/posthog.js");
  for (const e of ["delight_sent", "delight_shown", "delight_tapped"]) assert.ok(EVENTS.has(e));
  assert.deepEqual(cleanProps({ kind: "dayof", via: "bell", count: 3, eventId: "dlToday", email: "a@b.c", text: "hi" }), { kind: "dayof", via: "bell", count: 3 }, "a moment name and counts only");
  assert.equal((await req("POST", "/api/delight/track", { moment: "dayof", act: "show", eventId: "dlToday" })).status, 200);
  assert.deepEqual(await (await req("POST", "/api/delight/track", { moment: "<script>", act: "tap" })).json(), { ok: false });
  for (const f of ["server/delightafter.js", "public/delightafter.js"]) { const s = fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
    assert.ok(!s.includes("—"), f + ": no em dashes"); assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(s), f + ": no emoji"); assert.ok(!/\b(claude|opus|sonnet|haiku)\b|gpt-/i.test(s), f + ": no model names"); }
  const css = fs.readFileSync(new URL("../public/delightafter.js", import.meta.url), "utf8"); assert.match(css, /min-height:44px/); assert.doesNotMatch(css, /Plex Serif|sys-display/, "no display serif under 24px");
});
