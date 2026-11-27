// Review round 17 (delight for the people who live in the tools): one shared feedback module (public/fx.js) the host
// loop and the brand pages both use; campaign milestones stamped once when they land; a check-in that answers the tap
// at once; meters that fill once; the campaign report as a one-page issue; and no small serif titles on brand pages or
// the plans timeline.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { reportHtml } from "../server/campaigns.js";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");

test("one feedback module: fx.js has the stamp, the tick and the haptic; the host loop uses it instead of its own", () => {
  const fx = read("public/fx.js"), hl = read("public/hostloop.js");
  for (const k of ["haptic(", "stamp(", "tick(", "ink(", "fill(", "countUp(", "fresh(", "firstInSession("]) assert.ok(fx.includes(k), "fx.js has " + k);
  assert.match(fx, /window\.EncoreNative\?\.haptic\?\.\(kind\)/, "haptics go through the app's bridge");
  assert.match(fx, /prefers-reduced-motion:reduce\)\{.*\.hl-stamp,\.hl-stamp\.inline,\.fx-inked\{animation:none/, "the stamp stands still for people who ask for less motion");
  assert.match(fx, /if \(!L\.length \|\| reduce\(\)/, "meters and counts don't move for them either");
  assert.doesNotMatch(hl, /@keyframes hlStamp/, "the stamp's look lives in one place");
  assert.match(hl, /const fx = window\.PLFx \|\|/, "the host loop reads the shared module");
  for (const f of ["public/start.html", "public/path.html", "public/circles.html", "public/settings.html"]) assert.match(read(f), /<script src="\/fx\.js"( defer)?><\/script><script src="\/hostloop\.js"/, f + " loads fx.js first");
  assert.match(read("index.html"), /add\("\/fx\.js"\); add\("\/hostloop\.js"\)/, "and the app's Home too, in order");
  assert.match(read("index.html"), /t\.async=false/, "dynamic scripts keep their order");
});

test("campaign milestones: first booking, all hosts, report ready, inked once when they land", () => {
  const c = read("public/teams-campaigns.html");
  for (const t of ["First booking confirmed", "All hosts confirmed", "Report ready"]) assert.ok(c.includes(t), t);
  assert.match(c, /fx\.fresh\("miles\." \+ C\.id, done\)/, "only what's new since the last visit is stamped");
  assert.match(c, /data-mrep/, "Report ready opens the report");
  const h = read("public/teams-home.html"); assert.match(h, /milesLine\(c\)/, "Home shows each campaign's latest milestone"); assert.match(h, /c\.confirmed/);
  assert.match(read("server/campaigns.js"), /confirmed: R\.filter\(\(r\) => \["booked", "done"\]\.includes\(statusOf\(r\)\)\)\.length/, "the brief carries the count");
});

test("brand check-in answers the tap at once, then saves; a failed save puts it back", () => {
  const c = read("public/teams-campaigns.html");
  assert.match(c, /const h = paint\(on\); if \(on && fx\) \{ fx\.ink\(b\); fx\.haptic\("medium"\)/, "paint first, with the stamp and a haptic");
  assert.match(c, /catch \(e\) \{ paint\(!on\)/, "undo on failure");
  assert.match(c, /class="ti-arrive"/, "an arrivals meter that fills as people check in");
});

test("brand pages: a skeleton the size of the page, meters that fill once, numbers that count up once", () => {
  for (const f of ["public/teams-campaigns.html", "public/teams-home.html", "public/teams-insights.html"]) { const s = read(f); assert.match(s, /class="ti-skel"/, f); assert.match(s, /<script src="\/fx\.js"><\/script>/, f); assert.doesNotMatch(s, />Loading…</, f + " has no bare Loading line"); }
  assert.match(read("public/teams-home.html"), /fx\.countUp\(main, "home"\)/);
  assert.match(read("public/teams-intel.css"), /\.ti-grid>\*\{min-width:0\}/, "grid columns never push the page sideways at 390");
});

test("the report reads like a one-page issue: masthead, kicker, standfirst, pull numbers, a lead quote only when someone agreed", () => {
  const R = { totals: { events: 3, eventsDone: 2, invited: 40, attended: 30, showPct: 90, againPct: 88, againAnswered: 20, meetings: 6, followUps: 9, costPerAttendeeCents: 9000, yes: 33, themes: { shown: false, themes: [] }, quotes: [{ text: "Best dinner of the year.", name: "Ana" }, { text: "Small and warm.", name: "Bo" }] },
    budget: { budgetCents: 100000, committedCents: 50000, spentCents: 20000, remainingCents: 50000 }, kpis: [{ label: "Guests who came", have: 30, goal: 25, pct: 120 }, { label: "Pipeline meetings", have: 6, goal: 10, pct: 60 }], events: [] };
  const html = reportHtml({ title: "Spring dinners", goal: "Meet builders.", cities: ["New York"] }, R, { company: "Fernwood Labs" });
  assert.match(html, /class="rp-mast"><span class="rp-mname">Field report<\/span>/);
  assert.match(html, /Fernwood Labs · Campaign report · New York/);
  assert.match(html, /<p class="rp-stand">30 guests came to 2 events, and 88% would go again\. 6 pipeline meetings so far\.<\/p>/, "one plain sentence from the totals");
  assert.equal((html.match(/class="rp-pn"/g) || []).length, 3, "three pull numbers");
  assert.match(html, /<figure class="rp-quote"><blockquote>Best dinner of the year\.<\/blockquote><figcaption>Ana, a guest, who said we could quote them by first name/);
  assert.equal((html.match(/class="rp-met"/g) || []).length, 1, "Goal met stamps only the goal that was met");
  assert.doesNotMatch(html, /@|—/);
  const none = reportHtml({ title: "Q", cities: [] }, { ...R, totals: { ...R.totals, quotes: [] } }, {});
  assert.doesNotMatch(none, /rp-quote/, "no quote, no lead quote");
  const css = read("public/teams-intel.css");
  assert.match(css, /\.rp-bar i\{[^}]*animation:rpFill/, "goal bars fill once");
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.rp-bar i,\.rp-met\{animation:none\}\}/);
});

test("no small serif titles: teams-intel.css and timeline.css set the serif only at 24px and up", () => {
  for (const f of ["public/teams-intel.css", "public/timeline.css"]) {
    const css = read(f), bad = [];
    for (const m of css.matchAll(/([^{}]+)\{([^}]*font(?:-family)?:[^};]*(?:--pl-font-serif|--ti-serif|--tl-serif)[^}]*)\}/g)) { const size = (m[2].match(/(\d+(?:\.\d+)?)px/) || [])[1]; if (size && +size < 24) bad.push(m[1].trim() + " " + size); }
    assert.deepEqual(bad, [], f);
  }
});

test("round 5, the plan page reads like a travel notebook: day dividers, time words, up next, a drawn map, what to bring", async () => {
  const { itineraryDays } = await import("../server/plans.js");
  const ev = { date: "2026-12-12", endDate: "2026-12-13", city: "New York", itinerary: [] }, items = [{ day: "2026-12-12", time: "19:30", kind: "meal", title: "Dinner" }, { day: "2026-12-13", time: "", kind: "free", title: "Lazy day" }];
  const D = itineraryDays(ev, items); assert.equal(typeof D[0].items[0].at, "number", "a timed item knows when it starts, for Up next"); assert.equal(D[1].items[0].at, undefined, "an untimed one doesn't");
  const srv = read("server/plans.js"); assert.match(srv, /bring: listOf\(ev\.bring\)\.filter\(\(x\) => !\/\^yourself\$\/i\.test\(x\)\), included: listOf\(ev\.included\)/);
  const P = read("public/plan.html");
  assert.match(P, /class="fn-dn" aria-hidden="true">\$\{String\(d\.n\)\.padStart\(2, "0"\)\}/, "a big day number on each divider");
  assert.match(P, /if \(n === 0\) return p === "evening" \? "Tonight" : `This \$\{p\}`; if \(n === 1\) return `Tomorrow \$\{p\}`/, "Tonight, This morning, Tomorrow morning");
  assert.match(P, /<span class="fn-next">Up next<\/span>/);
  assert.match(P, /class="fn-where" href="\/map/, "a small drawn map of the area, linking to the full map");
  assert.match(P, /A packing list to start from/); assert.match(P, /Ideas, not from \$\{esc\(P\.host\.first \|\| "the host"\)\}/, "a starter list says it isn't the host's");
  assert.match(P, /ls\.set\("pl\.pack\." \+ P\.id/, "ticks stay on this phone");
  assert.match(P, /summit: \{ label: "Summit run of show"/); assert.match(P, /trip: \{ label: "Weekend away"/);
  assert.match(P, /I'll keep it in time order\./, "Potto's line is true: the server sorts the plan by day and time");
  assert.match(srv, /out\.sort\(\(a, b\) => a\.day\.localeCompare\(b\.day\) \|\| \(a\.time \|\| "99"\)\.localeCompare\(b\.time \|\| "99"\)\)/);
  assert.match(P, /class="pv-skel"/); assert.doesNotMatch(P, /—/);
});

test("round 5, the invite planner: kinder words, a board that counts up as replies arrive, a check-in that answers the tap", () => {
  const J = read("public/invite-plan.js"), C = read("public/invite-plan.css");
  assert.doesNotMatch(J, /Replied, never came/); assert.match(J, /p\.replies \? "First time"/);
  assert.match(J, /fx\.fill\(qa\("\.ip-meter \.ip-bar i", el\), "ip\." \+ id\)/, "the meter fills once a visit");
  assert.match(J, /fx\.tick\(b, now\[k\], 500\); if \(now\[k\] > was\)/, "a column that changed counts from what it was");
  assert.match(J, /if \(document\.hidden \|\| !\["status", "after"\]\.includes\(s\.view\) \|\| s\.busy\) return;/, "looks for new replies only while you watch");
  assert.match(J, /const h = paint\(on\); if \(on && fx\) \{ fx\.ink\(b\); fx\.haptic\("medium"\)/);
  assert.match(J, /catch \(e\) \{ paint\(!on\);/, "a failed save puts it back");
  assert.match(J, /Everyone's here\. I'll stop counting\./);
  assert.match(C, /\.ip-here\[aria-pressed="true"\]\{--fx-rot:-3deg;transform:rotate\(-3deg\)/, "Here reads like a stamp");
  assert.match(read("public/contacts.html"), /<script src="\/fx\.js"><\/script>/);
});

test("round 6, game and hack nights: seeding helpers, a bracket that fills seat by seat, a champion stamp, who's first up", async () => {
  const { shuffled, bracketRounds, seedOrder } = await import("../server/slots.js");
  // six players in a bracket of 8: the top two seeds get byes, but wait for the first-round winners before the semis
  const E = seedOrder(8).map((s) => ["A", "B", "C", "D", "E", "F"][s - 1] || null), R0 = bracketRounds(E, {});
  assert.equal(R0[0][0].w, "A", "a real bye moves the top seed on"); assert.equal(R0[1][0].a, "A"); assert.equal(R0[1][0].b, null);
  assert.equal(R0[1][0].w, null, "but A waits for D or E: an unplayed match isn't a bye"); assert.equal(R0[1][0].bye, false); assert.equal(R0[2][0].a, null, "nobody is in the final yet");
  const R1 = bracketRounds(E, { "0-1": "D", "0-3": "C", "1-0": "A", "1-1": "B", "2-0": "B" }); assert.equal(R1[2][0].w, "B", "played out, it has a champion");
  const L = ["a", "b", "c", "d", "e"], S = shuffled(L, () => 0.3); assert.deepEqual([...S].sort(), L, "a shuffle keeps everyone"); assert.deepEqual(L, ["a", "b", "c", "d", "e"], "and leaves the list alone");
  const srv = read("server/slots.js");
  assert.match(srv, /how = \["shuffle", "here"\]\.includes\(b\.order\) \? b\.order : "optin"/, "opt-in order stays the default");
  assert.match(srv, /latestReplies\(S, id\)\.filter\(\(x\) => x\.r\.checkedInAt\)/, "Seed who's here uses check-ins");
  const js = read("public/slots.js"), css = read("public/slots.css");
  for (const t of ["Seed in opt-in order", "Shuffle seeds", "Seed who's here", "Top seeds get the byes."]) assert.ok(js.includes(t), t);
  assert.match(js, /class="sl-seats" role="img" aria-label="\$\{Math\.min\(L\.optedIn, L\.size\)\} of \$\{L\.size\} seats taken"/);
  assert.match(js, /<span class="sl-stamp">Champion<\/span>/); assert.match(js, /<span class="sl-first">First up<\/span>/);
  assert.match(js, /btn\.textContent = path === "claim"/, "a tap says what's happening at once");
  for (const sel of [".sl-card{", ".sl-in{", ".sl-btn{", ".sl-opt{", ".sl-m{", "\n.sl-panel{"]) { const i = css.indexOf(sel), rule = css.slice(i, css.indexOf("}", i)); assert.match(rule, /border-radius:6px/, sel.trim() + " has Field Notes corners"); }
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.sl-seat\.on\{transform:none\}\}/);
  assert.ok(read("public/invite.html").length < 40000, "the invite stays under 40,000 characters");
});

test("round 6, summits: the plan prints for the door", () => {
  const P = read("public/plan.html");
  assert.match(P, /@media print\{body\{background:#fff!important\}\.pc-btn,\.pc-menu,\.pv-acts,\.fn-where,\.it-wrap/);
  assert.match(P, /data-print>Print the plan<\/button>/); assert.match(P, /window\.print\(\)/);
});

test("the app's Home settles once: late cards wait under the quick-start panel and show together, the hint draws with the composer", () => {
  const spa = read("index.html");
  assert.match(spa, /#view-programs\.pl-settling>#qsPanel~\*\{visibility:hidden\}/, "hidden but laid out, so their arrival moves nothing on screen");
  assert.match(spa, /cap=setTimeout\(reveal,2600\)/, "never longer than 2.6 seconds");
  assert.match(spa, /@media \(prefers-reduced-motion:reduce\)\{#view-programs\.pl-settled>#qsPanel~\*\{animation:none\}\}/);
  assert.equal((spa.match(/<p id="plHint"/g) || []).length, 2, "drawn in the composer, with the old insert kept as a fallback");
  assert.match(spa, /if\(!q\("#plHint"\)\) box\.insertAdjacentHTML/);
});
