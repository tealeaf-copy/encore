// Potto reads the host's sentence: the day, the time, the repeat, a course, a class pass, the spots and the title.
// This runs parseEventText straight out of index.html (the first version, the friends-host pass, the series pass
// and the last "Potto reads" pass), with today fixed at Wed Nov 25 2026 so the dates don't move.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const cut = (from, to) => { const a = html.indexOf(from); assert.ok(a > 0, "missing " + from); const b = html.indexOf(to, a); assert.ok(b > a, "missing " + to); return html.slice(a, b); };

function load(today = "2026-11-25T10:00:00") {
  const ctx = { window: { __wsPersonal: true }, console };
  vm.createContext(ctx);
  // a fixed today: new Date() and Date.now() say `today`, any other date works as usual
  vm.runInContext(`{ const R=Date, T=new R(${JSON.stringify(today)}).getTime(); Date=class extends R{ constructor(...a){ a.length?super(...a):super(T) } static now(){ return T } } }`, ctx);
  const code = [
    cut("function parseMoney", "function cloneForReuse"),
    cut("const CONF_CAL=", "function quickStart("),
    cut("const WEEKDAYS=", "{ const _qs4=quickStart"),
    cut("// ---------- series: words", "// ---------- series: wiring"),
    cut("{ const _peSr=parseEventText", "{ const _qsSr=quickStart"),
    cut("// ---------- Potto reads: words", "{ const _qsZ=quickStart"),
  ].join("\n");
  vm.runInContext(code + "\nthis.parseEventText=parseEventText; this.prRead=prRead; this.prTitle=prTitle; this.seriesEvery=seriesEvery;", ctx);
  return ctx;
}

const c = load();
const KEYS = ["title", "weekday", "date", "startTime", "endTime", "repeat", "sessions", "price", "passPrice", "passCount", "headcount", "preorder", "label"];
// input -> what must come out. `headcount: undefined` means it must not be set; `not` lists values a key must not have.
const CASES = [
  ["Hike Sat 7am", { weekday: "saturday", date: "2026-11-28", startTime: "07:00", title: "Hike", repeat: undefined }],
  ["Run club Sun 8am", { weekday: "sunday", date: "2026-11-29", startTime: "08:00", title: "Run club" }],
  ["Bake sale Sat 9am", { weekday: "saturday", date: "2026-11-28", startTime: "09:00", title: "Bake sale" }],
  // short days, with on/this/next and a plural s
  ["Yoga mon 6pm", { weekday: "monday", date: "2026-11-30", startTime: "18:00", title: "Yoga" }],
  ["Trivia on Tue 7pm", { weekday: "tuesday", date: "2026-12-01", title: "Trivia" }],
  ["Trivia tues 7pm", { weekday: "tuesday", date: "2026-12-01", title: "Trivia" }],
  ["Pottery Wed 6pm", { weekday: "wednesday", date: "2026-12-02", title: "Pottery" }],
  ["Jam this thu 8pm", { weekday: "thursday", date: "2026-11-26", title: "Jam", repeat: undefined }],
  ["Jam Thur 8pm", { weekday: "thursday", date: "2026-11-26", title: "Jam" }],
  ["Jam thurs 8pm", { weekday: "thursday", date: "2026-11-26", title: "Jam" }],
  ["Movie night Fri 8pm", { weekday: "friday", date: "2026-11-27", title: "Movie night" }],
  ["Picnic next Sat 1pm", { weekday: "saturday", date: "2026-12-05", title: "Picnic", repeat: undefined }],
  ["Coffee walk Sats 9am", { weekday: "saturday", repeat: "weekly", title: "Coffee walk" }],
  ["Swim Mons 7am", { weekday: "monday", repeat: "weekly", title: "Swim" }],
  ["Fun in the sun 3pm", { weekday: undefined, date: undefined }],
  // a weekly class with a pass
  ["Beginner salsa class Tuesdays 7pm, $20 a class or $70 for 4, 16 spots", { repeat: "weekly", weekday: "tuesday", date: "2026-12-01", startTime: "19:00", price: "$20", passPrice: 70, passCount: 4, headcount: 16, title: "Beginner salsa class", sessions: undefined }],
  ["Ceramics Wednesdays 6pm, $70 for 4 people", { repeat: "weekly", passPrice: undefined, headcount: 4 }],
  ["Tasting $20 a class or $70 for 4 people", { passPrice: undefined, price: "$20" }],
  ["Dinner for two Sat, $70 for 4", { passPrice: undefined }],
  // courses
  ["8 week pottery wheel course, $320 for all 8, 6 spots", { sessions: 8, repeat: "weekly", label: "workshop", price: "$320", headcount: 6, title: "8 week pottery wheel course" }],
  ["6 Wednesdays from Jan 6, 7pm, $180", { sessions: 6, weekday: "wednesday", date: "2027-01-06", repeat: "weekly", startTime: "19:00", price: "$180", headcount: undefined }],
  ["4 sessions, Thursdays 6pm, $100", { sessions: 4, repeat: "weekly", weekday: "thursday", date: "2026-11-26", startTime: "18:00", price: "$100", headcount: undefined }],
  ["Watercolor basics, $150 for all 5, Mondays 6pm", { sessions: 5, repeat: "weekly", weekday: "monday", price: "$150", headcount: undefined, title: "Watercolor basics" }],
  ["Knife skills 4 sessions, Thursdays 6pm, $100, 4 spots", { sessions: 4, headcount: 4 }],
  // monthly on a weekday pattern, the way the series code keeps it (repeat monthly + a date on that pattern)
  ["Book club first Sunday of the month 4pm", { repeat: "monthly", weekday: "sunday", date: "2026-12-06", startTime: "16:00", title: "Book club" }],
  ["Wine night last Friday of the month 7pm", { repeat: "monthly", weekday: "friday", date: "2026-11-27", title: "Wine night" }],
  ["Clothes swap second Saturday of each month 11am", { repeat: "monthly", weekday: "saturday", date: "2026-12-12", title: "Clothes swap" }],
  // a pre-order pop-up keeps its whole list in the title, and has an end time
  ["Pre-order pop-up: sourdough loaves and cardamom buns, pickup Sat 10am to 1pm, $12 each", { title: "Pre-order pop-up: sourdough loaves and cardamom buns", weekday: "saturday", date: "2026-11-28", startTime: "10:00", endTime: "13:00", preorder: true, price: "$12" }],
  ["Big summer potluck picnic with lawn games and a watermelon eating contest Sat 2pm", { title: "Big summer potluck picnic with lawn games", startTime: "14:00" }],
  // what already worked keeps working
  ["Sat Dec 12 2pm, $45, 10 spots", { weekday: "saturday", date: "2026-12-12", startTime: "14:00", price: "$45", headcount: 10, repeat: undefined }],
  ["Dumpling supper at my place Sat 7pm, $30 a person, 10 people", { weekday: "saturday", date: "2026-11-28", startTime: "19:00", price: "$30", headcount: 10, title: "Dumpling supper" }],
  ["6-week improv course, Wednesdays 7pm starting Jan 6, $180, 12 spots", { sessions: 6, repeat: "weekly", weekday: "wednesday", date: "2027-01-06", startTime: "19:00", price: "$180", headcount: 12, title: "6-week improv course" }],
  ["Weekly salsa class for beginners, every Tuesday 7pm, $20 a class or $70 for a 4-week pass, 16 spots", { repeat: "weekly", weekday: "tuesday", date: "2026-12-01", startTime: "19:00", price: "$20", passPrice: 70, passCount: 4, headcount: 16, sessions: undefined, title: "Weekly salsa class for beginners" }],
  ["Ceramics jam every other Thursday 7pm", { repeat: "biweekly", weekday: "thursday", date: "2026-11-26", title: "Ceramics jam" }],
  ["Run every Tuesday 6am", { repeat: "weekly", weekday: "tuesday", startTime: "06:00" }],
  ["Wheel throwing class 10 seats Sat 2-4:30pm", { headcount: 10, startTime: "14:00", endTime: "16:30" }],
  ["Sunday run in Prospect Park 8am", { title: "Sunday run", weekday: "sunday" }],
  ["Taco night at my place Saturday at 7, bring a topping", { title: "Taco night", weekday: "saturday", date: "2026-11-28" }],
];

for (const [input, want] of CASES) {
  test(`reads: ${input}`, () => {
    const o = JSON.parse(JSON.stringify(c.parseEventText(input)));
    for (const [k, v] of Object.entries(want)) assert.deepEqual(o[k], v, `${k} for "${input}": got ${JSON.stringify(o[k])}, all: ${JSON.stringify(Object.fromEntries(KEYS.map((x) => [x, o[x]])))}`);
  });
}

test("a monthly date reads back as the same rule in the series words", () => {
  const say = (t) => { const o = c.parseEventText(t); return c.seriesEvery({ date: o.date, repeat: o.repeat }); };
  assert.equal(say("Book club first Sunday of the month 4pm"), "the first Sunday of each month");
  assert.equal(say("Wine night last Friday of the month 7pm"), "the last Friday of each month");
  assert.equal(say("Clothes swap second Saturday of each month 11am"), "the second Saturday of each month");
});

test("the first Sunday is this month's when it's still ahead", () => {
  const early = load("2026-11-01T08:00:00");
  assert.equal(early.parseEventText("Book club first Sunday of the month 4pm").date, "2026-11-01");
  const late = load("2026-12-07T08:00:00");
  assert.equal(late.parseEventText("Book club first Sunday of the month 4pm").date, "2027-01-03");
});

test("a long title stops at a word, never mid-word", () => {
  const t = c.prTitle("Neighbourhood repair cafe and community tool library open afternoon Sat 2pm");
  assert.ok(t.length <= 60, t); assert.ok("Neighbourhood repair cafe and community tool library open afternoon".startsWith(t), t);
});
