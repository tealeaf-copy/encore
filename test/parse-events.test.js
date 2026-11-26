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
    // review round 8: the regex reader's fixes and the model's read (words only; the wiring needs the page)
    cut("// ---------- Potto reads with the model: words", "// ---------- Potto reads with the model: wiring"),
  ].join("\n");
  vm.runInContext(code + "\nthis.parseEventText=parseEventText; this.prRead=prRead; this.prTitle=prTitle; this.seriesEvery=seriesEvery; this.seriesPrice=seriesPrice; this.prIsQuestion=prIsQuestion; this.prAsk=prAsk; this.prClashSay=prClashSay; this.prPrice=prPrice; this.prMatchEvent=prMatchEvent; this.prPopupNoCap=prPopupNoCap; this.prRel=prRel; this.prSlots=prSlots; this.prItems=prItems;", ctx);
  return ctx;
}

const c = load();
const KEYS = ["title", "weekday", "date", "startTime", "endTime", "repeat", "sessions", "price", "free", "priceUnit", "groupPrice", "groupSize", "passPrice", "passCount", "headcount", "preorder", "label", "activity", "dayClash"];
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
  ["Beginner salsa class Tuesdays 7pm, $20 a class or $70 for 4, 16 spots", { label: "class", activity: "class", repeat: "weekly", weekday: "tuesday", date: "2026-12-01", startTime: "19:00", price: "$20", passPrice: 70, passCount: 4, headcount: 16, title: "Beginner salsa class", sessions: undefined }],
  // "$70 for 4 people" is a group price (review round 5), not a pass and not the headcount
  ["Ceramics Wednesdays 6pm, $70 for 4 people", { repeat: "weekly", passPrice: undefined, headcount: undefined, groupPrice: 70, groupSize: 4, price: "$70" }],
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
  ["Pre-order pop-up: sourdough loaves and cardamom buns, pickup Sat 10am to 1pm, $12 each", { title: "Pre-order pop-up: sourdough loaves and cardamom buns", weekday: "saturday", date: "2026-11-28", startTime: "10:00", endTime: "13:00", preorder: true, price: "$12", priceUnit: "each" }],
  ["Big summer potluck picnic with lawn games and a watermelon eating contest Sat 2pm", { title: "Big summer potluck picnic with lawn games", startTime: "14:00" }],
  // what already worked keeps working
  ["Sat Dec 12 2pm, $45, 10 spots", { weekday: "saturday", date: "2026-12-12", startTime: "14:00", price: "$45", headcount: 10, repeat: undefined }],
  ["Dumpling supper at my place Sat 7pm, $30 a person, 10 people", { weekday: "saturday", date: "2026-11-28", startTime: "19:00", price: "$30", headcount: 10, title: "Dumpling supper" }],
  ["6-week improv course, Wednesdays 7pm starting Jan 6, $180, 12 spots", { sessions: 6, repeat: "weekly", weekday: "wednesday", date: "2027-01-06", startTime: "19:00", price: "$180", headcount: 12, title: "6-week improv course" }],
  ["Weekly salsa class for beginners, every Tuesday 7pm, $20 a class or $70 for a 4-week pass, 16 spots", { repeat: "weekly", weekday: "tuesday", date: "2026-12-01", startTime: "19:00", price: "$20", passPrice: 70, passCount: 4, headcount: 16, sessions: undefined, title: "Weekly salsa class for beginners" }],
  ["Ceramics jam every other Thursday 7pm", { repeat: "biweekly", weekday: "thursday", date: "2026-11-26", title: "Ceramics jam" }],
  ["Run every Tuesday 6am", { repeat: "weekly", weekday: "tuesday", startTime: "06:00" }],
  ["Wheel throwing class 10 seats Sat 2-4:30pm", { headcount: 10, startTime: "14:00", endTime: "16:30", label: "workshop" }],
  ["Sunday run in Prospect Park 8am", { title: "Sunday run", weekday: "sunday" }],
  ["Taco night at my place Saturday at 7, bring a topping", { title: "Taco night", weekday: "saturday", date: "2026-11-28", startTime: "19:00" }],
  // review round 5. The weekday and the date disagree: keep the typed date, flag it, and Potto asks
  ["Sunday Dec 7th brunch 11am", { date: "2026-12-07", startTime: "11:00", title: "Brunch", dayClash: { typed: "sunday", date: "2026-12-07", alt: "2026-12-06" } }],
  ["Thursday Jan 8 dinner 7pm", { date: "2027-01-08", startTime: "19:00", title: "Dinner", dayClash: { typed: "thursday", date: "2027-01-08", alt: "2027-01-07" } }],
  ["Sunday Dec 6 brunch 11am", { date: "2026-12-06", dayClash: undefined }],
  // M/D dates, out of the title
  ["Dinner 12/18 7pm", { date: "2026-12-18", startTime: "19:00", title: "Dinner" }],
  ["Cookie swap 12/20 at 2", { date: "2026-12-20", startTime: "14:00", title: "Cookie swap" }],
  // a bare hour: evening for dinner-ish plans and for 5 to 11
  ["dinner dec 10 7:30", { date: "2026-12-10", startTime: "19:30", title: "Dinner" }],
  ["drinks fri 7", { weekday: "friday", date: "2026-11-27", startTime: "19:00", title: "Drinks" }],
  ["Book club sat at 8", { weekday: "saturday", date: "2026-11-28", startTime: "20:00", title: "Book club" }],
  ["Happy hour Thu 6", { weekday: "thursday", startTime: "18:00", title: "Happy hour" }],
  ["Brunch Sun at 11", { startTime: "11:00", title: "Brunch" }],
  // ranges without am/pm, out of the title
  ["Brunch Sat 11-3", { weekday: "saturday", startTime: "11:00", endTime: "15:00", title: "Brunch" }],
  ["Brunch Sat 10:30-12:30", { startTime: "10:30", endTime: "12:30", title: "Brunch" }],
  ["Garden party 2-6 Sun", { startTime: "14:00", endTime: "18:00", title: "Garden party" }],
  ["Dinner party for 6-8 Sat 7pm", { startTime: "19:00", endTime: undefined }],
  ["Holiday market Dec 10-12", { startTime: undefined, date: "2026-12-10" }],
  // money: free, pay what you like, drop-in, each, a group price
  ["Supper club Sat 7pm, $0", { free: true, price: undefined, title: "Supper club" }],
  ["Free yoga in the park Sat 9am", { free: true, price: undefined, title: "Yoga", label: "class" }],
  ["Gluten-free baking class Sat 10am, $30", { free: undefined, price: "$30" }],
  ["Pottery night pay what you want Sat 6pm", { price: "chip", title: "Pottery night", label: "workshop" }],
  ["Movie night, pay what you like, Fri 8pm", { price: "chip", title: "Movie night" }],
  ["Salsa $10 drop in Tue 8pm", { price: "$10", priceUnit: "class", label: "class", title: "Salsa" }],
  ["Yoga Sundays 9am, drop-in $15", { price: "$15", priceUnit: "class", repeat: "weekly" }],
  ["Pre-order cookies, pickup Sat 10am, $4", { price: "$4", priceUnit: "each", preorder: true }],
  ["Bake sale Sat 9am, cookies $3", { price: "$3", priceUnit: "each" }],
  ["Dumpling supper Sat 7pm, $30", { price: "$30", priceUnit: undefined }],
  ["Cooking class $40 for 2 people Sat 6pm", { price: "$40", groupPrice: 40, groupSize: 2, headcount: undefined }],
  ["Date night pasta class, $90 per couple, Fri 7pm", { groupPrice: 90, groupSize: 2 }],
  // titles: filler words, relative days, the schedule-only first clause
  ["hosting a dumpling night tmrw 7pm", { title: "Dumpling night", date: "2026-11-26", startTime: "19:00" }],
  ["Taco night tonight 8pm", { title: "Taco night", date: "2026-11-25" }],
  ["thinking maybe brunch sunday 11am", { title: "Brunch", weekday: "sunday" }],
  ["umm maybe a picnic sat 1pm", { title: "Picnic", date: "2026-11-28", startTime: "13:00" }],
  ["Hosting tomorrow: game night 7pm", { title: "Game night", date: "2026-11-26" }],
  ["6 Wednesdays from Jan 6, Bachata fundamentals, 7pm, $180", { title: "Bachata fundamentals", sessions: 6, date: "2027-01-06", label: "class", price: "$180" }],
  ["Tango lessons 12/18 7-9, $15 drop-in", { title: "Tango lessons", date: "2026-12-18", startTime: "19:00", endTime: "21:00", price: "$15", priceUnit: "class", label: "class" }],
  // classes you teach are a class; make-a-thing sessions stay a workshop
  ["Yoga mon 6pm", { label: "class", activity: "class" }],
  ["Improv for beginners Thursdays 7pm", { label: "class" }],
  ["Spanish conversation class Thursdays 6:30", { label: "class", startTime: "18:30" }],
  ["Guitar lessons Sat 11am", { label: "class" }],
  ["Bread workshop Sat 10am", { label: "workshop" }],
  ["Matcha workshop Sun 2pm", { label: "workshop" }],
  ["Salsa night Fri 9pm", { activity: undefined }],
  // launch review: a hyphenated neighbourhood and a named meeting point are the place, not a cut-off city
  ["Run club in Bed-Stuy Sat 8am", { meetPoint: "Bed-Stuy", hood: "Bed-Stuy", city: undefined, title: "Run club", startTime: "08:00" }],
  ["Coffee walk in Prospect Lefferts-Gardens Sun 9am", { hood: "Prospect Lefferts-Gardens", title: "Coffee walk" }],
  ["Picnic at Grand Army Plaza Sun 1pm", { meetPoint: "Grand Army Plaza", title: "Picnic", weekday: "sunday", startTime: "13:00" }],
  ["Brunch at The Smith Sun 11am", { meetPoint: "The Smith", title: "Brunch" }],
  ["Taco night at my place Saturday at 7", { meetPoint: undefined, title: "Taco night" }],
  ["Dinner at 7 on Sat", { meetPoint: undefined, startTime: "19:00" }],
  // end times stay, and "to noon" leaves nothing in the name
  ["Hike Sat 9 to noon", { startTime: "09:00", endTime: "12:00", title: "Hike" }],
  ["Bake sale pop-up Sat 10am to noon, $5 each", { startTime: "10:00", endTime: "12:00", title: "Bake sale pop-up" }],
  ["Market Sat 10-noon", { startTime: "10:00", endTime: "12:00" }],
  // review round 6: "$20 each or $70 for 4" is a price and a pass (or a group price), never 4 spots
  ["Salsa Tuesdays 7pm, $20 each or $70 for 4", { price: "$20", passPrice: 70, passCount: 4, headcount: undefined, repeat: "weekly", priceUnit: "class" }],
  ["Cookie box pop-up Sat 10am, $20 each or $70 for 4", { price: "$20", groupPrice: 70, groupSize: 4, headcount: undefined, passPrice: undefined, priceUnit: "each" }],
  // a number glued to a name is part of the name
  ["Bachata 101 class Thu 8pm", { title: "Bachata 101 class", headcount: undefined, label: "class" }],
  ["Salsa 2 class Thu 8pm", { headcount: undefined }],
  ["Bachata 101 class Thu 8pm, 12 spots", { headcount: 12 }],
  ["Dinner for 8 Sat 7pm", { headcount: 8 }],
  // an open end: out of the title, and no end time
  ["Salsa social Fri 9pm-late", { title: "Salsa social", startTime: "21:00", endTime: undefined }],
  ["Karaoke Sat 9pm till late", { title: "Karaoke", startTime: "21:00", endTime: undefined }],
  ["Dance party Sat 10pm until late", { title: "Dance party", endTime: undefined }],
  // two weekdays: weekly on both, the series dated from the first
  ["Spanish class Mondays and Wednesdays 7pm, $15", { weekdays: ["monday", "wednesday"], weekday: "monday", date: "2026-11-30", repeat: "weekly", title: "Spanish class", startTime: "19:00" }],
  ["Yoga every Tue & Thu 7am", { weekdays: ["tuesday", "thursday"], repeat: "weekly", title: "Yoga" }],
  ["Hike Sat 7am", { weekdays: undefined }],
  // a group price written as "group of 5"
  ["Pasta class group of 5 for $40 Sat 6pm", { groupPrice: 40, groupSize: 5, title: "Pasta class", headcount: undefined }],
  ["Cooking class $40 for a group of 5 Sat 6pm", { groupPrice: 40, groupSize: 5, title: "Cooking class" }],
  // multi-word places keep every word
  ["Run club at Beacon station Sat 8am", { meetPoint: "Beacon station", title: "Run club" }],
  ["Picnic at Dolores park Sun 1pm", { meetPoint: "Dolores park", title: "Picnic" }],
  // host panel round 6. A course price with a drop-in: the course price is the price, the drop-in its own field
  ["Pottery course $320 for all 8 or $45 drop in, Thursdays 7pm", { price: "$320", dropIn: 45, sessions: 8, priceUnit: undefined }],
  // places typed in lowercase come out of the title, in title case
  ["Salsa drop-in at studio 5 on bleecker Tue 8pm", { title: "Salsa drop-in", venueName: "Studio 5 on Bleecker", meetPoint: "Studio 5 on Bleecker", startTime: "20:00" }],
  ["Book club at powells coffee corner Sun 4pm", { title: "Book club", venueName: "Powells Coffee Corner" }],
  ["Matcha workshop in silver lake Sat 2pm", { title: "Matcha workshop", hood: "Silver Lake" }],
  ["Weekly run club from zilker park Sat 7am", { title: "Weekly run club", meetPoint: "Zilker Park", repeat: "weekly" }],
  ["Sunrise hike rattlesnake ledge sun meet at the trailhead", { title: "Sunrise hike", venueName: "Rattlesnake Ledge", meetPoint: "the trailhead", weekday: "sunday" }],
  ["Supper club 4 strangers Fri 7pm", { title: "Supper club for strangers", headcount: undefined }],
  ["Picnic in the park Sat 1pm", { title: "Picnic", hood: undefined }],
  // a cost note is not a price
  ["Potluck Sat 6pm ~$40 food cost", { costNote: "About $40 food cost", price: undefined, title: "Potluck" }],
  ["Dinner Fri 8pm u pay as u go", { costNote: "Pay as you go", price: undefined, title: "Dinner" }],
  ["Brunch Sun 11am you cover your own", { costNote: "You cover your own", price: undefined, title: "Brunch" }],
  // review round 9: pairs are counted as pairs ("4 pairs", not 8 spots)
  ["Couples cooking class Sat 6pm, 4 pairs max", { headcount: 8, headUnit: "pairs", unitCount: 4 }],
  ["Tango night Fri 9pm, up to 6 couples", { headcount: 12, headUnit: "pairs", unitCount: 6 }],
  // a course start that isn't on the weekday they typed: kept, and Potto asks
  ["Pottery course Thursdays from Jan 8 7pm, 6 sessions", { date: "2027-01-08", sessions: 6, dayClash: { typed: "thursday", date: "2027-01-08", alt: "2027-01-07" } }],
  // review round 7 (host panel). "first Sunday of the month" owns the date and repeat; a book called "Tomorrow and..." is not a day
  ["monthly book club first Sunday of the month 2pm at Powell's Books cafe, January pick is Tomorrow and Tomorrow and Tomorrow, free", { title: "Monthly book club", date: "2026-12-06", weekday: "sunday", repeat: "monthly", startTime: "14:00", meetPoint: "Powell's Books cafe" }],
  ["bookclub tmrw 7pm at Cafe Mogador, reading Tomorrow and Tomorrow and Tomorrow", { date: "2026-11-26", startTime: "19:00", meetPoint: "Cafe Mogador" }],
  ["Tomorrow 7pm dinner", { date: "2026-11-26", title: "Dinner" }],
  // a pre-order: no trailing "for", "at my stoop" is the meet point (not a venue), "in Park Slope" the neighbourhood, the items
  ["sourdough pre-orders for pickup Saturday Dec 12 10am-1pm at my stoop in Park Slope, country loaf $12, focaccia $9, max 20 loaves, order by Thursday", { title: "Sourdough pre-orders", date: "2026-12-12", startTime: "10:00", endTime: "13:00", preorder: true, meetPoint: "My stoop", venueName: undefined, hood: "Park Slope", items: [{ name: "Country loaf", price: 12 }, { name: "Focaccia", price: 9 }] }],
  // hyphenated words stay whole; "in Silver Lake at the ..." is the neighbourhood, never "Class"
  ["salsa drop-in class every Sunday 5pm in Silver Lake at the Ukrainian Culture Center, $20 a class or $70 for a 4-class pass, no partner needed", { title: "Salsa drop-in class", hood: "Silver Lake", meetPoint: "the Ukrainian Culture Center", repeat: "weekly", price: "$20", passPrice: 70, passCount: 4 }],
  // "tacos after at Veracruz" isn't where you meet
  ["weekly run club every Thursday 6:30pm from Zilker Park, 5k easy pace, all paces welcome, tacos after at Veracruz", { title: "Weekly run club", meetPoint: "Zilker Park", venueName: undefined, repeat: "weekly", startTime: "18:30" }],
  // a venue runs through "on <Street>", with a number in its name
  ["8-week wheel throwing course Wednesdays 7-9pm at Studio 5 on Bleecker starting Jan 6, $320 for all 8 or $45 drop-in, 8 wheels max", { venueName: "Studio 5 on Bleecker", meetPoint: "Studio 5 on Bleecker", sessions: 8, price: "$320", dropIn: 45 }],
  ["Brunch at The Smith Sun 11am", { meetPoint: "The Smith" }],
  ["Book club at Cafe Mogador Sat 8", { meetPoint: "Cafe Mogador", startTime: "20:00" }],
  // "$40 for 2," is a group price
  ["matcha tasting workshop for pairs Sunday Dec 13 11am at my apartment in Williamsburg, $40 for 2, 6 pairs max, take home a chasen", { groupPrice: 40, groupSize: 2, price: "$40", headcount: 12, headUnit: "pairs", hood: "Williamsburg" }],
  ["Pasta night Fri 7pm, $60 for 2 max", { groupPrice: 60, groupSize: 2 }],
  ["Salsa Tuesdays 7pm, $20 each or $70 for 4", { groupPrice: undefined, passPrice: 70 }],
  // a plain "Supper club" keeps what makes it this one; menu and BYOB notes go in the description
  ["supper club at my place in Crown Heights next Saturday 7:30pm, 10 seats, $45 a person, ask to join, 5 course Oaxacan menu, BYOB", { title: "Supper club: 5-course Oaxacan menu", notes: "5-course Oaxacan menu. BYOB.", price: "$45", headcount: 10, hood: "Crown Heights" }],
  ["supper club Sat 7pm, Hunan home cooking, BYOB", { title: "Supper club: Hunan home cooking", notes: "Hunan home cooking. BYOB." }],
  ["Dumpling supper at my place Sat 7pm, $30 a person, 10 people", { title: "Dumpling supper", notes: undefined }],
  // review round 8 (no AI): a distance or a count of stops is never spots, a time or a venue; it's kept in the notes
  ["Trail run Sat 7am, 6-8 miles, meet at the Rose Garden", { title: "Trail run", startTime: "07:00", endTime: undefined, headcount: undefined, meetPoint: "the Rose Garden", notes: "6-8 miles." }],
  ["Group run Sun 8am, 3 miles easy pace", { startTime: "08:00", headcount: undefined, notes: "3 miles. Easy pace." }],
  ["Sunrise hike Sat 6am, 6-8 miles, $0, ask to join", { startTime: "06:00", endTime: undefined, headcount: undefined, free: true, approvalRequired: true }],
  ["Long run 10k Sat 7am at Prospect Park", { title: "Long run", meetPoint: "Prospect Park", notes: "10k." }],
  ["Bar crawl Fri 8pm, 4 stops", { headcount: undefined, startTime: "20:00", notes: "4 stops." }],
  ["Thrift crawl Sat 1pm, 5 shops in Bushwick", { headcount: undefined, title: "Thrift crawl" }],
  ["Run club Sat 7am, 5 mi loop", { venueName: undefined, notes: "5 mi loop." }],
  // "$X total", "$X for all", "$X for the (whole) course/series", "$X or $Y per class drop-in"
  ["Pottery course Tuesdays 7pm, $280 total or $50 drop in", { price: "$280", priceUnit: "total", dropIn: 50, headcount: undefined }],
  ["Watercolor series Mondays 6pm, $200 for the whole course", { price: "$200", priceUnit: "total", dropIn: undefined }],
  ["Bread class Sat 10am, $150 for the series", { price: "$150", priceUnit: "total", headcount: undefined }],
  ["Yoga $90 for all or $15 per class drop-in, Thursdays 7am", { price: "$90", priceUnit: "total", dropIn: 15, headcount: undefined, startTime: "07:00" }],
  ["8 week pottery wheel course, $320 for all 8, 6 spots", { price: "$320", priceUnit: undefined, sessions: 8, headcount: 6 }],
  // ask to join, in the ways hosts say it
  ["Supper club Sat 7pm, ask 2 join, 8 seats", { approvalRequired: true, headcount: 8, title: "Supper club" }],
  ["Dinner party Fri 7pm, request to join", { approvalRequired: true }],
  ["Dinner Sat 7pm, I'll pick who comes, 10 seats", { approvalRequired: true, headcount: 10 }],
  ["Tasting Sat 6pm, I choose who comes", { approvalRequired: true }],
  ["Wine night Fri 8pm, approve guests", { approvalRequired: true }],
  ["Wine night Fri 8pm, everyone welcome", { approvalRequired: undefined }],
  // titles: no leading emoji, no price, no filler
  ["🍝 Pasta night Fri 7pm at my place", { title: "Pasta night", emoji: "🍝" }],
  ["$25 dumpling night Sat 7pm", { title: "Dumpling night", price: "$25" }],
  ["Taco night lol Fri 7pm", { title: "Taco night" }],
  // "at the door" is how they pay, never the venue
  ["Jazz night Fri 9pm, $10 at the door", { price: "$10", venueName: undefined, meetPoint: undefined, ticketNote: "at the door" }],
  // the book pick is kept
  ["Book club Sun 4pm at Cafe Mogador, This month: Piranesi", { notes: "This month: Piranesi.", meetPoint: "Cafe Mogador" }],
  ["Book club the last Sunday of each month 3pm, this month: The Overstory", { notes: "This month: The Overstory.", repeat: "monthly", date: "2026-11-29" }],
  // "between 4 and 7pm"
  ["Bake sale Sat between 4 and 7pm", { title: "Bake sale", startTime: "16:00", endTime: "19:00" }],
  ["Board games Sat between 2 and 5", { title: "Board games", startTime: "14:00", endTime: "17:00" }],
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

test("Potto's weekday question names both dates", () => {
  assert.equal(c.prClashSay(c.parseEventText("Sunday Dec 7th brunch 11am").dayClash).text, "Dec 7 is a Monday. Keep Mon, Dec 7, or Sun, Dec 6?");
  const w = c.prClashSay(c.parseEventText("Thursday Jan 8 dinner 7pm").dayClash);
  assert.equal(w.text, "Jan 8 is a Friday. Keep Fri, Jan 8, or Thu, Jan 7?");
  assert.equal(w.keep, "Keep Fri, Jan 8"); assert.equal(w.alt, "Thu, Jan 7");
});

test("two weekdays read back as one rule: Every Mon and Wed, and the calendar repeats on both", () => {
  const o = c.parseEventText("Spanish class Mondays and Wednesdays 7pm, $15");
  assert.equal(c.seriesEvery({ date: o.date, repeat: o.repeat, weekdays: o.weekdays }, true), "Every Mon and Wed");
  assert.equal(c.seriesEvery({ date: o.date, repeat: o.repeat }, true), "Every Mon");
});

test("price words: \$20 each, or \$70 for 4", () => {
  assert.equal(c.prPrice({ price: "$20", priceUnit: "each", groupPrice: 70, groupSize: 4 }), "$20 each, or $70 for 4");
});

test("a course with a drop-in reads both; a price per class is never for all N", () => {
  const o = c.parseEventText("Pottery course $320 for all 8 or $45 drop in, Thursdays 7pm");
  assert.equal(c.seriesPrice({ price: o.price, sessions: o.sessions, dropIn: o.dropIn }), "$320 for all 8, or $45 a class");
  assert.equal(c.seriesPrice({ price: "$45", sessions: 8, priceUnit: "class" }), "$45 a class");
});

test("price words: each, a group, a class", () => {
  assert.equal(c.prPrice({ price: "$12", priceUnit: "each" }), "$12 each");
  assert.equal(c.prPrice({ price: "$40", groupPrice: 40, groupSize: 2 }), "$40 for 2");
  assert.equal(c.prPrice({ price: "$10", priceUnit: "class" }), "$10 a class");
  assert.equal(c.prPrice({ price: "$30" }), "");
  assert.equal(c.prPrice({ price: "chip", priceUnit: "each" }), "");
});

// questions never make an event: they go to Potto's answers. "find/show me" still goes to Discover.
const QUESTIONS = [
  ["who's coming to my supper club?", true, { kind: "who", q: "supper club" }],
  ["Who's coming to my supper club", true, { kind: "who", q: "supper club" }],
  ["who is coming saturday", true, { kind: "who" }],
  ["how many people are coming to dumpling night?", true, { kind: "who", q: "dumpling night" }],
  ["How do people pay?", true, { kind: "pay" }],
  ["can guests pay with venmo", true, { kind: "pay" }],
  ["ideas for my book club", true, { kind: "ideas", q: "book club" }],
  ["Any tips for a potluck?", true, { kind: "ideas", q: "potluck" }],
  ["tips for hosting a game night", true, { kind: "ideas", q: "game night" }],
  ["suggest something for a rainy saturday", true, { kind: "ideas" }],
  ["help", true, { kind: "other" }],
  ["what should I bring to a picnic?", true, { kind: "other" }],
  ["where should I host brunch", true, { kind: "other" }],
  ["is 8 people too many for my flat", true, { kind: "other" }],
  ["Dinner Sat 7pm for 8?", true, { kind: "other" }],
  ["Dumpling night at my place Friday 7pm for 8", false],
  ["Sunday Dec 7th brunch 11am", false],
  ["Hosting a taco night tomorrow", false],
  ["find me a salsa class", false],
  ["show me pottery nights near me", false],
  ["what's on this weekend?", false],
  ["any dinners near me?", false],
  ["Canal walk Sat 10am", false],
];
for (const [t, q, kind] of QUESTIONS) {
  test(`question? ${t}`, () => {
    assert.equal(c.prIsQuestion(t), q);
    if (kind) for (const [k, v] of Object.entries(kind)) assert.equal(c.prAsk(t)[k], v, `${k} for "${t}": ${JSON.stringify(c.prAsk(t))}`);
  });
}

test("who's coming finds the event by a loose name, else the next one", () => {
  const E = [{ id: "a", name: "Sunday supper club", date: "2026-12-06" }, { id: "b", name: "Dumpling night", date: "2026-11-28" }, { id: "c", name: "Old supper club", date: "2026-10-01" }, { id: "x", name: "Sample supper", example: true, date: "2026-12-01" }];
  assert.equal(c.prMatchEvent("supper club", E, "2026-11-25").id, "a");
  assert.equal(c.prMatchEvent("dumpling", E, "2026-11-25").id, "b");
  assert.equal(c.prMatchEvent("", E, "2026-11-25").id, "b");
  assert.equal(c.prMatchEvent("next one", E, "2026-11-25").id, "b");
  assert.equal(c.prMatchEvent("karaoke", E, "2026-11-25"), null);
});

test("review round 7: a capitalised Tomorrow mid-sentence or in quotes is a title, not a day", () => {
  assert.equal(c.prRel("January pick is Tomorrow and Tomorrow and Tomorrow"), "");
  assert.equal(c.prRel('reading "tomorrow, and tomorrow"'), "");
  assert.equal(c.prRel("Tomorrow 7pm dinner"), "tomorrow");
  assert.equal(c.prRel("Hosting tomorrow: game night"), "tomorrow");
  assert.equal(c.prRel("Dinner tonight. Tomorrow we hike"), "today");
});

test("review round 7: pickup windows start at the host's time, an hour each", () => {
  assert.deepEqual([...c.prSlots("10:00", "13:00")], ["10:00–11:00", "11:00–12:00", "12:00–1:00"]);
  assert.deepEqual([...c.prSlots("09:30", "11:00")], ["9:30–10:30", "10:30–11:00"]);
  assert.deepEqual([...c.prSlots("14:00")], ["2:00–3:00", "3:00–4:00", "4:00–5:00"]);
  assert.deepEqual([...c.prSlots("")], []);
  // the pop-up wiring in index.html uses it instead of a fixed 11-to-2
  assert.match(html, /prSlots\(o\.startTime,o\.endTime\)/);
});

test("review round 7: pre-order items and prices", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(c.prItems("bake sale saturday 11-3, banana bread $8, cookies $3, 40 boxes"))), [{ name: "Banana bread", price: 8 }, { name: "Cookies", price: 3 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(c.prItems("Pre-order pop-up: sourdough loaves, pickup Sat 10am, $12 each"))), []);
});

test("a pop-up has no default spot cap unless the host gave a number", () => {
  assert.equal(c.prPopupNoCap("Sourdough pop-up Sat 10am"), true);
  assert.equal(c.prPopupNoCap("Bake sale Sat 9am, $3 each"), true);
  assert.equal(c.prPopupNoCap("Pop-up Sat 10am, 24 loaves"), false, "a batch size is a cap");
  assert.equal(c.prPopupNoCap("Pop-up dinner Sat 7pm, 12 spots"), false);
  assert.equal(c.prPopupNoCap("Dinner Sat 7pm"), false, "not a pop-up");
  assert.equal(c.parseEventText("Sourdough pop-up Sat 10am").headcount, undefined);
});
