// Series: a class that repeats, a multi-week course and a class pass. Guests see that it repeats, what the
// course or pass costs, and get a calendar entry that repeats. These run the code straight out of index.html
// and public/invite.html, and check the guest link carries the fields.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { startServer } from "./helpers.js";
import { publicEvent } from "../server/app.js";
import { resetLoginLimits } from "../server/auth.js";

const read = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
const cut = (src, from, to) => { const a = src.indexOf(from); assert.ok(a > 0, "missing " + from); const b = src.indexOf(to, a); assert.ok(b > a, "missing " + to); return src.slice(a, b); };

function app() {
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(cut(read("../index.html"), "// ---------- series: words", "// ---------- series: wiring") + "\nthis.seriesParse=seriesParse; this.seriesEvery=seriesEvery; this.seriesSpan=seriesSpan; this.seriesPrice=seriesPrice; this.seriesRRule=seriesRRule; this.seriesIcs=seriesIcs;", ctx);
  return ctx;
}
function lite() {
  const ctx = { HHMM: /^\d{2}:\d{2}$/ }; vm.createContext(ctx);
  // invite.html's own clock: "7pm", "7:30am"
  vm.runInContext(`const clock = (t) => HHMM.test(t || "") ? new Date("2000-01-01T" + t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/:00(?=\\s)/, "").replace(/\\s([AP]M)$/, (_, x) => x.toLowerCase()) : "";\n`
    + cut(read("../public/invite.html"), "// ---------- series: a class", "// ---------- end series helpers") + "\nthis.srWhen=srWhen; this.srPrice=srPrice; this.srRRule=srRRule;", ctx);
  return ctx;
}
const plain = (o) => JSON.parse(JSON.stringify(o));

test("the one-line start reads a course, sessions and a pass", () => {
  const c = app();
  assert.deepEqual(plain(c.seriesParse("6-week improv course, Wednesdays 7pm starting Jan 6, $180, 12 spots")), { sessions: 6, repeat: "weekly", course: true });
  assert.deepEqual(plain(c.seriesParse("Weekly salsa class for beginners, every Tuesday 7pm, $20 a class or $70 for a 4-week pass, 16 spots")), { passPrice: 70, passCount: 4 });
  assert.deepEqual(plain(c.seriesParse("Hip hop basics, 8 sessions, Mondays 6pm, $160")), { sessions: 8, repeat: "weekly", course: true });
  assert.deepEqual(plain(c.seriesParse("Contemporary class Thursdays, $25 drop-in or $70 for 4 classes")), { passPrice: 70, passCount: 4 });
  assert.deepEqual(plain(c.seriesParse("Bachata Fridays, $18 a class, 5-class pass for $80")), { passPrice: 80, passCount: 5 });
  assert.equal(c.seriesParse("Ceramics, $70 for 4 sessions").sessions, undefined, "a pass for 4 sessions is not a 4-session course");
  assert.equal(c.seriesParse("Improv, 4-week class pass for $90").sessions, undefined, "a 4-week pass is not a 4-week course");
  assert.deepEqual(plain(c.seriesParse("Taco night Saturday at 7")), {});
});

test("guests read the repeat, the course dates and the money in plain words", () => {
  const c = app();
  const salsa = { date: "2026-12-01", startTime: "19:00", repeat: "weekly", price: "$20", passPrice: 70, passCount: 4 };
  const improv = { date: "2027-01-06", startTime: "19:00", repeat: "weekly", sessions: 6, price: "$180" };
  assert.equal(c.seriesEvery(salsa), "every Tuesday");
  assert.equal(c.seriesEvery(salsa, true), "Every Tue");
  assert.equal(c.seriesEvery({ date: "2026-12-01", repeat: "biweekly" }), "every other Tuesday");
  assert.equal(c.seriesEvery({ date: "2026-12-03", repeat: "monthly" }), "the first Thursday of each month");
  assert.equal(c.seriesEvery({ date: "2026-12-31", repeat: "monthly" }, true), "Last Thu of each month");
  assert.equal(c.seriesEvery({ date: "2026-12-01" }), "", "a one-off says nothing");
  assert.equal(c.seriesSpan(improv), "6 Wednesdays, Jan 6 to Feb 10");
  assert.equal(c.seriesPrice(improv), "$180 for all 6");
  assert.equal(c.seriesPrice(salsa), "$20 a class, or $70 for 4");
  assert.equal(c.seriesPrice({ passPrice: 70, passCount: 4 }), "$70 for 4 classes");
  assert.equal(c.seriesPrice({ price: "$20" }), "", "a one-off keeps $X a person");
});

test("the calendar entry repeats: weekly, monthly on the same weekday, and a course stops after N", () => {
  const c = app();
  assert.equal(c.seriesRRule({ date: "2026-12-01", repeat: "weekly" }), "RRULE:FREQ=WEEKLY");
  assert.equal(c.seriesRRule({ date: "2026-12-01", repeat: "biweekly" }), "RRULE:FREQ=WEEKLY;INTERVAL=2");
  assert.equal(c.seriesRRule({ date: "2026-12-03", repeat: "monthly" }), "RRULE:FREQ=MONTHLY;BYDAY=1TH");
  assert.equal(c.seriesRRule({ date: "2026-12-31", repeat: "monthly" }), "RRULE:FREQ=MONTHLY;BYDAY=-1TH");
  assert.equal(c.seriesRRule({ date: "2027-01-06", repeat: "weekly", sessions: 6 }), "RRULE:FREQ=WEEKLY;COUNT=6");
  assert.equal(c.seriesRRule({ date: "2027-01-06" }), "");
  const ics = ["BEGIN:VEVENT", "DTSTART:20270106T190000", "SUMMARY:Improv", "END:VEVENT"].join("\r\n");
  assert.equal(c.seriesIcs(ics, { date: "2027-01-06", sessions: 6 }), ["BEGIN:VEVENT", "DTSTART:20270106T190000", "RRULE:FREQ=WEEKLY;COUNT=6", "SUMMARY:Improv", "END:VEVENT"].join("\r\n"));
  assert.equal(c.seriesIcs(c.seriesIcs(ics, { date: "2027-01-06", repeat: "weekly" }), { date: "2027-01-06", repeat: "weekly" }).match(/RRULE/g).length, 1, "added once");
});

test("the light invite says the same: Every Tue · 7pm, the course dates, the money, the repeat", () => {
  const c = lite();
  assert.equal(c.srWhen({ date: "2026-12-01", startTime: "19:00", repeat: "weekly" }), "Every Tue · 7pm");
  assert.equal(c.srWhen({ date: "2027-01-06", startTime: "19:00", endTime: "21:00", repeat: "weekly", sessions: 6 }), "6 Wednesdays, Jan 6 to Feb 10 · 7pm to 9pm");
  assert.equal(c.srWhen({ date: "2026-12-01", startTime: "19:00" }), "");
  assert.equal(c.srPrice({ price: "$180", sessions: 6 }), "$180 for all 6");
  assert.equal(c.srPrice({ price: "$20", passPrice: 70, passCount: 4 }), "$20 a class, or $70 for 4");
  assert.equal(c.srRRule({ date: "2027-01-06", sessions: 6 }), "RRULE:FREQ=WEEKLY;COUNT=6");
  assert.equal(c.srRRule({ date: "2026-12-03", repeat: "monthly" }), "RRULE:FREQ=MONTHLY;BYDAY=1TH");
});

test("the guest link carries sessions and the pass", () => {
  const e = publicEvent({ name: "Improv", repeat: "weekly", sessions: 6, passPrice: 70, passCount: 4, budget: 900 });
  assert.equal(e.repeat, "weekly"); assert.equal(e.sessions, 6); assert.equal(e.passPrice, 70); assert.equal(e.passCount, 4);
  assert.equal(e.budget, undefined, "still an allowlist");
});

let srv;
before(async () => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "series-secret"; resetLoginLimits(); srv = await startServer(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET"]) delete process.env[k]; await srv.close(); });

test("a course saved by the host reaches the guest with its sessions and pass", async () => {
  const J = { "content-type": "application/json" };
  const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name: "Rosa Diaz", email: "rosa.series@example.com", password: "long-password-1", mode: "friends" }) });
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const p = await fetch(srv.base + "/api/db/doc?path=events/improv6", { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify({ kind: "social", casual: true, activity: "workshop", name: "6-week improv course", date: "2027-01-06", startTime: "19:00", repeat: "weekly", sessions: 6, price: "$180", passPrice: 70, passCount: 4, published: true, headcount: 12 }) });
  assert.equal(p.status, 200);
  const g = await (await fetch(srv.base + "/api/db/doc?path=events/improv6", { headers: { "x-encore-guest": "1" } })).json();
  assert.equal(g.data.sessions, 6); assert.equal(g.data.repeat, "weekly"); assert.equal(g.data.passPrice, 70); assert.equal(g.data.passCount, 4);
});
