// The host app's own logic for panel 1: money words, repeats that keep the weekday pattern,
// and Potto keeping the host's words. These run the code straight out of index.html.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const cut = (from, to) => { const a = html.indexOf(from); assert.ok(a > 0, "missing " + from); const b = html.indexOf(to, a); assert.ok(b > a, "missing " + to); return html.slice(a, b); };
const src = [
  "function priceTxt", "// ---------- one event name",
  "nextDate=function", "// ---------- Potto keeps the host's words",
  "const P1_MON", "{ const _qsP1=quickStart",
];
function load(today = "2026-11-25") {
  const ctx = { window: {}, allEvents: [], console, nextDate: null };
  ctx.localISO = (t) => { const x = t ? new Date(t) : new Date(today + "T12:00:00"); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
  vm.createContext(ctx);
  let code = ""; for (let i = 0; i < src.length; i += 2) code += cut(src[i], src[i + 1]) + "\n";
  // the page runs these as top-level declarations; expose them on the context
  vm.runInContext(code + "\nthis.priceTxt=priceTxt; this.normPrice=normPrice; this.nextRealDate=nextRealDate; this.nextFreshDate=nextFreshDate; this.p1Fix=p1Fix; this.p1Dates=p1Dates;", ctx);
  return ctx;
}

test("price words: $X a person, at the door, pay what you like", () => {
  const c = load();
  assert.equal(c.priceTxt({ price: "$85" }), "$85 a person");
  assert.equal(c.priceTxt({ price: "$10", ticketNote: "at the door" }), "$10 at the door");
  assert.equal(c.priceTxt({ price: "chip" }), "Pay what you like");
  assert.equal(c.priceTxt({ price: "" }), "");
  assert.equal(c.normPrice("90"), "$90");
  assert.equal(c.normPrice("free"), "");
  assert.equal(c.normPrice("pay what you like"), "chip");
});

test("every month keeps the weekday pattern", () => {
  const c = load();
  assert.equal(c.nextDate({ date: "2026-12-03", repeat: "monthly" }), "2027-01-07"); // first Thursday stays first Thursday
  assert.equal(c.nextDate({ date: "2026-12-12", repeat: "monthly" }), "2027-01-09"); // second Saturday
  assert.equal(c.nextDate({ date: "2026-12-31", repeat: "monthly" }), "2027-01-28"); // last Thursday
  assert.equal(c.nextDate({ date: "2026-11-18", repeat: "weekly" }), "2026-11-25");
  assert.equal(c.nextDate({ date: "2026-11-18", repeat: "biweekly" }), "2026-12-02");
});

test("the next one is the real next one", () => {
  const c = load("2026-11-25");
  c.allEvents.push({ id: "b", name: "Wednesday Night 5K", date: "2026-12-09", parentId: "a" });
  const run = { id: "a", name: "Wednesday Night 5K", date: "2026-11-18", repeat: "weekly" };
  assert.equal(c.nextRealDate(run), "2026-12-09"); // the one already planned, not Nov 25
  assert.equal(c.nextFreshDate(run), "2026-12-16"); // a new copy goes after it
  assert.equal(c.nextRealDate({ id: "x", name: "Solo", date: "2026-10-01", repeat: "weekly" }) >= "2026-11-25", true);
});

test("Potto keeps the host's words", () => {
  const c = load();
  const d = (o = {}) => ({ name: "", pubTitle: "", date: "", startTime: "", headcount: 12, ...o });
  let x = d({ name: "Dec 12 2-4:30pm wheel throwing class", pubTitle: "Dec 12 2-4:30pm wheel throwing class", startTime: "16:30", meetPoint: "Mud", venueName: "Mud" });
  c.p1Fix("Saturday Dec 12 2-4:30pm wheel throwing class for 8 at Mud & Wheel, $65", x);
  assert.equal(x.startTime, "14:00"); assert.equal(x.endTime, "16:30");
  assert.equal(x.pubTitle, "Wheel throwing class"); assert.equal(x.price, "$65"); assert.equal(x.meetPoint, "Mud & Wheel");

  x = d({ city: "Bushwick.", headcount: 12, date: "2026-12-03" });
  c.p1Fix("Monthly drop-in improv night. First Thursday at 7:30pm at a black box in Bushwick. $10 at the door. I want to see if at least 12 people would come before I book the room.", x);
  assert.equal(x.city, "Bushwick"); assert.equal(x.price, "$10"); assert.equal(x.ticketNote, "at the door");
  assert.equal(x.interestGoal, 12); assert.equal(x.headcount, 0); assert.equal(x.stage, "interest"); assert.equal(x.repeat, "monthly");

  x = d({ date: "2026-12-05" });
  c.p1Fix("Friendsgiving potluck at my apartment, not sure if Dec 5 or 12 or 13, want friends to vote", x);
  assert.equal(x.stage, "interest"); assert.deepEqual([...x.dateOptions], ["2026-12-05", "2026-12-12", "2026-12-13"]); assert.equal(x.date, "");

  x = d({ name: "Free weekly 5K run every", pubTitle: "Free weekly 5K run every" });
  c.p1Fix("Free weekly 5K run every Wednesday at 7pm from Maria Hernandez Park", x);
  assert.equal(x.pubTitle, "Free weekly 5K run"); assert.equal(x.repeat, "weekly"); assert.equal(x.price, undefined);

  x = d({ city: "Williamsburg. Everyone" });
  c.p1Fix("Dumpling night at my place in Williamsburg. Everyone folds, I steam. Tonight 7pm", x);
  assert.equal(x.city, "Williamsburg"); assert.equal(x.date, c.localISO());

  x = d({ budget: 250 });
  c.p1Fix("Team dinner, $250 budget", x);
  assert.equal(x.price, undefined);
});
