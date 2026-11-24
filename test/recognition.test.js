import { test } from "node:test";
import assert from "node:assert/strict";
import { streakOf, badgesFor } from "../server/recognition.js";

const NOW = "2026-11-24"; // a Tuesday
const weeksAgo = (n, dow = 0) => new Date(Date.parse(NOW) - (n * 7 + dow) * 864e5).toISOString().slice(0, 10);

test("A weekly streak counts weeks in a row and survives until the current week is over", () => {
  assert.equal(streakOf([weeksAgo(0), weeksAgo(1), weeksAgo(2), weeksAgo(3)], NOW), 4);
  assert.equal(streakOf([weeksAgo(1), weeksAgo(2), weeksAgo(3)], NOW), 3, "nothing yet this week, last week still counts");
  assert.equal(streakOf([weeksAgo(2), weeksAgo(3)], NOW), 0, "a missed week ends it");
  assert.equal(streakOf([weeksAgo(0), weeksAgo(2)], NOW), 1, "a gap breaks the run");
  assert.equal(streakOf(["2026-12-05"], NOW), 0, "future events don't count");
});

test("Monthly streaks reward hosts who gather once a month", () => {
  const b = badgesFor({ dates: ["2026-09-12", "2026-10-10", "2026-11-07"], guests: 9 }, NOW);
  assert.ok(b.badges.some((x) => x.id === "streak" && x.label === "3 months in a row"));
});

test("Super host needs regular hosting, real guests and people coming back, recently", () => {
  const dates = [1, 3, 5, 7, 9].map((n) => weeksAgo(n));
  assert.ok(badgesFor({ dates, guests: 20, returning: 8 }, NOW).isSuper);
  assert.ok(!badgesFor({ dates, guests: 20, returning: 1 }, NOW).isSuper, "few come back and no kudos");
  assert.ok(badgesFor({ dates, guests: 20, returning: 1, kudos: 6 }, NOW).isSuper, "kudos can stand in for returners");
  assert.ok(!badgesFor({ dates: dates.map((d) => "2025" + d.slice(4)), guests: 20, returning: 8 }, NOW).isSuper, "not active lately");
});

test("New hosts and milestones", () => {
  const b = badgesFor({ dates: [weeksAgo(1)], guests: 12, createdAt: Date.now() - 10 * 864e5 }, NOW);
  assert.ok(b.isNew); assert.ok(b.badges.some((x) => x.id === "m-guests" && x.n === 10));
  assert.ok(!badgesFor({ dates: [], guests: 0, createdAt: Date.now() - 400 * 864e5 }, NOW).isNew);
  assert.ok(!badgesFor({ dates: [], guests: 0, createdAt: Date.now() - 2 * 864e5 }, NOW).isNew, "signing up alone is not hosting");
  assert.ok(badgesFor({ dates: Array.from({ length: 11 }, (_, i) => weeksAgo(i + 1)), guests: 30 }, NOW).badges.some((x) => x.label === "10+ gatherings"));
});
