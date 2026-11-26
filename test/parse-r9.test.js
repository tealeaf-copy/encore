// Review round 9 (no AI): the host prompts from the round 9 review, read by the regex reader straight out of index.html,
// with today fixed at Wed Nov 25 2026. Titles keep "5k"/"10k"; pre-orders get their items, cap and order deadline (never
// the event's date); "Café" stays whole; courses said in weeks; pairs and groups counted as such; budgets are cost notes.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const cut = (from, to) => { const a = html.indexOf(from); assert.ok(a > 0, "missing " + from); const b = html.indexOf(to, a); assert.ok(b > a, "missing " + to); return html.slice(a, b); };
const ctx = { window: { __wsPersonal: true }, console };
vm.createContext(ctx);
vm.runInContext(`{ const R=Date, T=new R("2026-11-25T10:00:00").getTime(); Date=class extends R{ constructor(...a){ a.length?super(...a):super(T) } static now(){ return T } } }`, ctx);
vm.runInContext([
  cut("function parseMoney", "function cloneForReuse"),
  cut("const CONF_CAL=", "function quickStart("),
  cut("const WEEKDAYS=", "{ const _qs4=quickStart"),
  cut("// ---------- series: words", "// ---------- series: wiring"),
  cut("{ const _peSr=parseEventText", "{ const _qsSr=quickStart"),
  cut("// ---------- Potto reads: words", "{ const _qsZ=quickStart"),
  cut("// ---------- Potto reads with the model: words", "// ---------- Potto reads with the model: wiring"),
].join("\n") + "\nObject.assign(this,{parseEventText,prRead,prAiMerge,PR_AI_KEYS});", ctx);
const plain = (v) => JSON.parse(JSON.stringify(v));
// what parseEventText (o) and prRead (p) must say. `undefined` means not set.
const CASES = [
  // 1. titles keep the distance when it's part of the name
  ["Couch to 5k group starting jan 5, tuesdays and thursdays 7am, 9 weeks, Prospect Park Picnic House, free", { title: "Couch to 5k group", date: "2027-01-05", repeat: "weekly", weekdays: ["tuesday", "thursday"], repeatUntil: "2027-03-04", free: true }],
  ["saturday morning 5k at prospect park 8am, all paces", { title: "Saturday morning 5k", startTime: "08:00" }],
  ["sunday 8:30am 10k from the boathouse in central park every week, 9-10 min pace, bagels after", { title: "Sunday 10k", repeat: "weekly", startTime: "08:30", meetPoint: "The Boathouse" }],
  ["Long run 10k Sat 7am at Prospect Park", { title: "Long run" }],
  ["🏃‍♀️ saturday morning 5k, weekly, 8am at lady bird lake boardwalk, all levels, free", { title: "Saturday morning 5k", repeat: "weekly", free: true }],
  // 2. pre-orders: the cap, the order deadline, the items
  ["holiday cookie boxes!! order by dec 15, pickup dec 20 between 11 and 2 at my place in bed-stuy, $35/box, 30 boxes", { title: "Holiday cookie boxes", date: "2026-12-20", startTime: "11:00", endTime: "14:00", preorder: true, headcount: 30, orderBy: "Dec 15", orderByDate: "2026-12-15", items: [{ name: "Cookie box", price: 35 }] }],
  ["sourdough pre-orders for pickup Saturday Dec 12 10am-1pm at my stoop in Park Slope, country loaf $12, focaccia $9, max 20 loaves, order by Thursday", { date: "2026-12-12", headcount: 20, orderBy: "Thursday", orderByDate: "2026-12-10", items: [{ name: "Country loaf", price: 12 }, { name: "Focaccia", price: 9 }] }],
  ["croissant saturday — plain $4.50, almond $5.50, pain au chocolat $5 — pickup 9-11am dec 12 at Café Kestrel, limit 60", { preorder: true, headcount: 60, date: "2026-12-12", startTime: "09:00", endTime: "11:00", venueName: "Café Kestrel", items: [{ name: "Plain", price: 4.5 }, { name: "Almond", price: 5.5 }, { name: "Pain au chocolat", price: 5 }] }],
  ["king cake preorder jan 6, $40 whole or $25 half, pickup 4-7pm at my house in mid city, 25 cakes", { preorder: true, headcount: 25, items: [{ name: "Whole king cake", price: 40 }, { name: "Half king cake", price: 25 }] }],
  ["🍪 cookie box pre-orders, pickup Dec 19 noon to 3pm at Sunny's Cafe in Red Hook, box of 12 $30, 40 boxes max", { headcount: 40, items: [{ name: "Box of 12", price: 30 }] }],
  ["pie preorders for thanksgiving week: apple $28 pecan $32, pick up wed 12/23 between 4 and 7pm at Bakeshop on 5th Ave", { title: "Pie preorders for thanksgiving week", date: "2026-12-23", startTime: "16:00", items: [{ name: "Apple", price: 28 }, { name: "Pecan", price: 32 }] }],
  ["babka drop: chocolate or cinnamon, $18 each, 2 for $32, pickup sunday dec 13 10am-12pm prospect lefferts", { preorder: true, date: "2026-12-13", hood: "Prospect Lefferts", items: [{ name: "Babka", price: 18 }, { name: "2 babka", price: 32 }] }],
  ["birthday cake orders open for december, 8 inch $65, 6 inch $45, pickup by appointment at my kitchen in astoria", { title: "Birthday cake orders", preorder: true, headcount: undefined, items: [{ name: "8 inch", price: 65 }, { name: "6 inch", price: 45 }] }],
  ["focaccia friday!! preorder by wed, pickup fri dec 11 5-7pm at my apartment in park slope, $14 a slab, only 15", { date: "2026-12-11", orderBy: "Wednesday", orderByDate: "2026-12-09", headcount: 15, items: [{ name: "Focaccia slab", price: 14 }] }],
  ["bagel drop this saturday 8am-10am, pick up at my stoop in fort greene, everything bagels $3 or dozen $30, preorder only", { items: [{ name: "Everything bagels", price: 3 }, { name: "Dozen", price: 30 }] }],
  // not a pre-order
  ["chef's table for 6 at my place thurs dec 17 7:30, 7 courses, $95pp, wine pairing +$30, approve only", { preorder: undefined, price: "$95", headcount: 6 }],
  ["Pickup soccer Sat 10am-12pm at McCarren Park", { preorder: undefined }],
  // 3. places: letters past ASCII, and not "the end", a cookbook or a carpool
  ["improv 101 starts mon jan 11, 8 weeks, 7-9:30pm, $295, max 16, Lincoln Square, show at the end", { title: "Improv 101", venueName: "Lincoln Square", meetPoint: "Lincoln Square", sessions: 8, repeat: "weekly", date: "2027-01-11", headcount: 16, label: "class" }],
  ["cookbook club! jan 17 6pm potluck, everyone cooks from Ottolenghi Simple, my place in irvington, 10 max", { meetPoint: undefined, venueName: undefined, hood: "Irvington", headcount: 10 }],
  ["2 day raku firing weekend jan 23-24 10am-4pm upstate (Kingston), $300, 8 people, carpool from bk", { title: "2 day raku firing weekend", meetPoint: undefined, headcount: 8, date: "2027-01-23" }],
  // 4. courses in weeks; weeks and hours are never spots
  ["Intro to Wheel — 5 wks — Sundays 1-3pm — from Jan 10 — $275 — 6 students — Gowanus studio", { sessions: 5, repeat: "weekly", headcount: 6, date: "2027-01-10", price: "$275" }],
  ["West coast swing beginner series 4 weeks mondays 7:30pm starts jan 4, $80, Glendale, partner not required", { title: "West coast swing beginner series", sessions: 4, repeat: "weekly", date: "2027-01-04", headcount: undefined }],
  ["Improv for anxiety — 6 wks — thursdays 6pm — $210 or sliding scale — Wicker Park — 10 spots", { sessions: 6, repeat: "weekly", headcount: 10 }],
  ["one-off yes-and workshop for teams sat dec 12 11am, 2 hrs, $40, The Annoyance", { headcount: undefined, startTime: "11:00", endTime: "13:00", price: "$40" }],
  ["8 week level 1 improv mondays 7-10pm starting jan 4 at iO theater, $350 for the whole course, 14 spots", { sessions: 8, price: "$350", priceUnit: undefined, headcount: 14 }],
  // 5. ask to join
  ["tamales + mezcal night saturday after next 8pm east williamsburg $40, cap at 14, request access", { title: "Tamales + mezcal night", date: "2026-12-05", startTime: "20:00", headcount: 14, approvalRequired: true, hood: "East Williamsburg" }],
  ["ok so thinking a lil dinner party, sat the 19th, 8ish, my place (clinton hill), maybe 8-10 ppl, $50 to cover food, i'll let ppl in", { title: "Dinner party", date: "2026-12-19", startTime: "20:00", hood: "Clinton Hill", headcount: 10, approvalRequired: true }],
  // 6. improv: the name isn't the price; a course price with a drop-in
  ["drop-in improv jam every sunday 3pm at the Second City training center, $10 suggested, all levels", { title: "Drop-in improv jam", price: "$10", repeat: "weekly" }],
  ["longform improv 6 week course tuesdays 7pm starting feb 2 at Logan Square Improv, $200 or $40 per class drop-in", { sessions: 6, price: "$200", dropIn: 40, priceUnit: undefined }],
  // 7. pairs and groups; wheels and students are spots
  ["couples matcha workshop fri dec 11 7pm, $60 per couple, 6 couples, ur own whisk to take home, williamsburg", { headcount: 12, headUnit: "pairs", groupPrice: 60, groupSize: 2 }],
  ["pottery date night friday dec 18 7pm at Mud Room on Atlantic Ave, $90 for 2, 8 couples", { headcount: 16, headUnit: "pairs" }],
  ["tea ceremony for 4 at my place, fri dec 18 6:30pm, $120 for the group of 4, 3 groups", { title: "Tea ceremony", groupPrice: 120, groupSize: 4, headcount: 12, headUnit: "groups", groupCount: 3, price: "$120" }],
  ["wheel throwing intro, 4 sessions on saturdays 10am, starts jan 9, $200 for the series, 6 wheels, at my studio in gowanus", { headcount: 6, sessions: 4 }],
  ["8-week wheel throwing course Wednesdays 7-9pm at Studio 5 on Bleecker starting Jan 6, $320 for all 8 or $45 drop-in, 8 wheels max", { headcount: 8, sessions: 8, price: "$320", dropIn: 45 }],
  // 8. budgets and "bring $30" are cost notes; a crawl has no pickup times
  ["BBQ pilgrimage dec 19, 4 joints, all day, $60 meat budget, meet at Franklin BBQ 10am, 6 seats in my car", { price: undefined, costNote: "$60 meat budget", headcount: 6, startTime: "10:00" }],
  ["night market crawl queens fri 7pm, cash only bring $30, Queens Night Market entrance, all welcome", { price: undefined, costNote: "Bring $30 in cash", noSlots: true, preorder: undefined }],
  ["waterfall hike sun dec 13, carpool leaves silver lake 7:30am, trailhead Switzer Falls 8:45, 4 mi, $10 gas money", { price: undefined, costNote: "$10 gas money" }],
  // 9. dates
  ["classics club tuesdays 7pm, every two weeks, we're doing Middlemarch in 6 parts starting jan 5, Multnomah library", { repeat: "biweekly", date: "2027-01-05", sessions: undefined }],
  ["poetry reading circle sundays 3pm biweekly at my place in sellwood, bring a poem to share", { title: "Poetry reading circle", repeat: "biweekly" }],
  ["Brunch on the 3rd at 11am", { date: "2026-12-03", startTime: "11:00" }],
  // a place on its own between commas or dashes
  ["Improv for anxiety — 6 wks — thursdays 6pm — $210 or sliding scale — Wicker Park — 10 spots", { venueName: "Wicker Park" }],
  ["harold team practice every wed 8pm, $15 per person to split the room, logan square", { meetPoint: "Logan Square" }],
  ["classics club tuesdays 7pm, every two weeks, we're doing Middlemarch in 6 parts starting jan 5, Multnomah library", { venueName: "Multnomah library" }],
  ["night hike every other friday 7pm, Runyon Canyon, 3 miles, headlamps, max 25", { venueName: "Runyon Canyon", headcount: 25 }],
  ["SUPPER CLUB #4 — jan 9 7pm — lebanese mezze — $60 — 12 seats — DM to join — prospect heights", { venueName: "Prospect Heights", headcount: 12 }],
  ["kintsugi repair night thurs dec 10 7pm, bring a broken mug, $65 materials included, 10 seats, my studio greenpoint", { venueName: undefined }],
  ["Hike Sat 7am, dogs welcome, all levels", { venueName: undefined, meetPoint: undefined }],
  ["new years day hike jan 1 10am, Griffith Park, meet at the Greek Theatre lot, 5mi, mimosas after (bring cups)", { meetPoint: "the Greek Theatre lot" }],
  // review round 11: a place's number stays with it; teams and tables book like groups; a club keeps its distance
  ["wheel class thurs 7pm at Studio 5, $40, 6 spots", { venueName: "Studio 5", headcount: 6 }],
  ["oyster night fri 7pm at Pier 17, $50", { venueName: "Pier 17", title: "Oyster night" }],
  ["trivia night $100 per team of 8, 5 teams, thurs dec 10 8pm at Pete's Tavern", { title: "Trivia night", groupPrice: 100, groupSize: 8, headcount: 40, headUnit: "groups", groupCount: 5, price: "$100" }],
  ["supper club sat dec 12 7pm, 4 tables of 4, $200 per table", { title: "Supper club", groupPrice: 200, groupSize: 4, headcount: 16, headUnit: "groups", groupCount: 4 }],
  ["Run club 5k every saturday 8am at McCarren Park", { title: "Run club 5k", repeat: "weekly" }],
  // ages aren't a time, a cap or a course length; 40+ isn't a cap
  ["improv for kids 8-12 saturdays 10am at the Y", { title: "Improv for kids 8-12", startTime: "10:00", endTime: undefined, sessions: undefined }],
  ["Hip hop for 40+ beginners thursdays 7pm, $20", { headcount: undefined, startTime: "19:00" }],
  // the other dates of a short series aren't the title; "then dance til 11" is the end
  ["bachata bootcamp 3 saturdays jan 9 16 23 2pm $90", { title: "Bachata bootcamp", sessions: 3, date: "2027-01-09" }],
  ["salsa lesson 8-8:45 then dance til 11 fri dec 11 at Copa", { startTime: "20:00", endTime: "23:00" }],
  // never a meeting point after "then" or "beers at"; a book isn't the place, a neighborhood is the hood
  ["hike sat 8am at Bear Mountain, then meet at Joe's Diner for pancakes", { venueName: "Bear Mountain", meetPoint: "Bear Mountain" }],
  ["trivia thurs 8pm then beers at Sweet Afton", { venueName: undefined, meetPoint: undefined }],
  ["book club sun 3pm, we're reading The Overstory, Clinton Hill", { venueName: undefined, hood: "Clinton Hill" }],
];
for (const [input, want] of CASES) {
  test(`round 9 reads: ${input}`, () => {
    const o = plain(ctx.parseEventText(input)), p = plain(ctx.prRead(input));
    for (const [k, v] of Object.entries(want)) {
      const got = ["items", "orderBy", "orderByDate", "noSlots", "repeatUntil"].includes(k) ? p[k] : o[k];
      assert.deepEqual(got, v, `${k} for "${input}": got ${JSON.stringify(got)}`);
    }
  });
}

test("round 9: ask to join, in more of the ways hosts say it", () => {
  for (const t of ["Dinner Sat 7pm, approve only", "Tasting Fri 8pm, request access", "Supper Sat 7pm, i'll let ppl in", "Party Sat, I let people in"]) assert.equal(ctx.parseEventText(t).approvalRequired, true, t);
  assert.equal(ctx.parseEventText("Dinner Sat 7pm, everyone welcome, let's go").approvalRequired, undefined);
});

test("round 9: the model's read keeps the pairs count", () => {
  const text = "couples matcha workshop fri dec 11 7pm, $60 per couple, 6 couples";
  const ans = { ...Object.fromEntries(ctx.PR_AI_KEYS.map((k) => [k, null])), headcount: 12 };
  const { M } = ctx.prAiMerge(ctx.prRead(text), ans, text, { today: "2026-11-25" });
  assert.equal(M.headcount, 12); assert.equal(M.headUnit, "pairs");
});

test("round 9: the draft gets the pre-order cap and deadline, pairs and no pickup times for a crawl", () => {
  const w = cut("// round 9 (no AI):", "// the model's read, laid over");
  assert.match(w, /d\.headcount=\+p\.headcount/); assert.match(w, /d\.orderBy=p\.orderBy/); assert.match(w, /d\.headUnit=p\.headUnit/); assert.match(w, /p\.noSlots/);
});
