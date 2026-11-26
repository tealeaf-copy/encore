// The host's event page and the create flow (event flow redesign, owner: "creating a new event is still super confusing").
// Runs the page's pure bits straight out of index.html: the stage, the status line in plain words, the one ember button,
// who can see and join as sentences, Potto's milestone lines and the guest list. Plus the page contract: the old planner's
// steps don't draw for friends events, sheets not stacked panels, no numbered circles, no "0 of 0" headlines.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const a = html.indexOf("// ---------- the pure bits"), b = html.indexOf("// ---------- end pure bits", a);
assert.ok(a > 0 && b > a, "the pure bits are in index.html");
const block = html.slice(html.indexOf("The host's event page and the create flow"), html.indexOf("end host event page"));
const TODAY = "2026-11-26";
const ctx = { localISO: () => TODAY, dayDiff: (s) => Math.round((new Date(s + "T00:00:00") - new Date(TODAY + "T00:00:00")) / 864e5), evOver: (d) => !!d.date && d.date < TODAY };
vm.createContext(ctx);
vm.runInContext(html.slice(a, b) + "\nObject.assign(this,{hvStage,hvPeople,hvCounts,hvStatus,hvPrimary,hvAtHome,hvSeeLine,hvJoinLine,hvPotto});", ctx);
const ev = (o = {}) => ({ id: "e1", name: "Cooking night", date: "2026-12-05", startTime: "19:00", meetPoint: "My place", headcount: 6, published: true, discoverable: true, unlisted: true, ...o });
const R = (response, n, o = {}) => ({ id: "r" + n, eventId: "e1", name: ["Van Le", "Sam Ortiz", "Priya Shah", "Dev Rao", "Lena Park", "Ben Cho"][n % 6], response, createdAt: n, ...o });
const view = (d, rs) => { const P = ctx.hvPeople(d, rs), c = ctx.hvCounts(d, P), s = ctx.hvStage(d); const J = (x) => JSON.parse(JSON.stringify(x)); return { P: J(P), c: J(c), s, status: ctx.hvStatus(d, c, s)[0], primary: J(ctx.hvPrimary(d, c, s)), potto: ctx.hvPotto(d, c, s, P) }; };

test("one ember button that changes with the stage", () => {
  assert.deepEqual(view({}, []).primary, ["Start", "create"], "not created yet");
  assert.deepEqual(view(ev({ published: false, discoverable: false }), []).primary, ["Share invite", "publish"], "a draft");
  assert.deepEqual(view(ev({ published: false, discoverable: false, startTime: "" }), []).primary, ["Add the details", "edit"], "a draft with no time asks for it");
  assert.deepEqual(view(ev(), []).primary, ["Share invite", "share"], "shared, nobody in yet");
  assert.deepEqual(view(ev({ venueAddr: "12 Elm St" }), [R("going", 0)]).primary, ["Message guests", "message"], "replies in");
  assert.deepEqual(view(ev(), [R("going", 0)]).primary, ["Add the address", "edit"], "at my place, people in, no address yet: ask for it");
  assert.deepEqual(view(ev({ meetPoint: "Prospect Park" }), [R("going", 0)]).primary, ["Message guests", "message"], "a park needs no address");
  assert.deepEqual(view(ev(), [R("going", 0), R("requested", 1), R("requested", 2)]).primary, ["Review 2 asks", "asks"], "asks come first");
  assert.deepEqual(view(ev({ date: TODAY }), [R("going", 0)]).primary, ["Check in", "door"], "day of");
  assert.deepEqual(view(ev({ date: "2026-11-20" }), [R("going", 0)]).primary, ["Ask for photos", "photos"], "after");
});

test("the status line is plain words, and never a zero as a headline", () => {
  assert.equal(view(ev({ published: false, discoverable: false }), []).status, "Draft. Only you can see it.");
  assert.equal(view(ev(), []).status, "Shared. No replies yet.");
  assert.equal(view(ev(), [R("going", 0), R("going", 1, { plusOne: true }), R("requested", 2), R("waitlist", 3)]).status, "2 in · 3 spots left · 1 asking · 1 waiting");
  assert.equal(view(ev({ headcount: 2 }), [R("going", 0), R("going", 1)]).status, "2 in · full");
  assert.equal(view(ev({ date: TODAY }), [R("going", 0, { checkedInAt: 1 }), R("going", 1)]).status, "Today. 1 of 2 here.");
  assert.equal(view(ev({ date: "2026-11-20" }), [R("going", 0, { checkedInAt: 1 }), R("going", 1)]).status, "Done. 1 came.");
  for (const v of [view(ev(), []), view(ev({ date: "2026-11-20" }), [])]) assert.doesNotMatch(v.status, /\b0 (of|in)\b|none yet/);
});

test("who can see it and who can join, as sentences", () => {
  assert.equal(ctx.hvSeeLine(ev({ published: false, discoverable: false })), "Only you can see it until you share the invite.");
  assert.equal(ctx.hvSeeLine(ev({ discoverable: false })), "Only people with the link can see it.");
  assert.equal(ctx.hvSeeLine(ev()), "It's on your page, so your followers can see it.");
  assert.equal(ctx.hvSeeLine(ev({ unlisted: false })), "It's on your page and on Discover, so new people nearby can find it.");
  assert.equal(ctx.hvJoinLine(ev()), "Guests tap I'm in.");
  assert.equal(ctx.hvJoinLine(ev({ approvalRequired: true, plusOnes: 1, hideGuests: true })), "Guests ask to join, and you let each one in. Each can bring up to 1. The guest list is private.");
});

test("Potto speaks at milestones: the first yes, a full house, the day, the wrap", () => {
  assert.equal(view(ev(), [R("going", 0)]).potto, "Van is in. The first yes is the hardest one.");
  assert.match(view(ev({ headcount: 1 }), [R("going", 0), R("waitlist", 1)]).potto, /^Full house\./);
  assert.match(view(ev({ date: TODAY }), [R("going", 0)]).potto, /^It's today\./);
  assert.match(view(ev({ date: "2026-11-24" }), [R("going", 0)]).potto, /^That's a wrap\./);
  assert.equal(view(ev(), []).potto, "I'll tell you the moment someone replies.");
});

test("one guest list: replies carry the actions, names the host added join once", () => {
  const d = ev({ guests: [{ name: "Van Le", status: "Going", source: "RSVP page" }, { name: "Jo Kim", status: "Going", source: "Added by host" }, { name: "Max", status: "Invited", source: "Imported" }] });
  const { P, c } = view(d, [R("going", 0, { dietary: "No pork", plusOnes: 1 }), R("requested", 1, { answers: [{ q: "Allergies?", a: "Nuts" }] }), R("no", 2)]);
  assert.deepEqual(P.map((p) => [p.name, p.state]), [["Van Le", "in"], ["Sam Ortiz", "ask"], ["Priya Shah", "no"], ["Jo Kim", "in"], ["Max", "invited"]]);
  assert.deepEqual(P[0].notes, ["No pork"]); assert.deepEqual(P[1].notes, ["Nuts"]);
  assert.equal(c.in, 2); assert.equal(c.spots, 3); assert.equal(c.ask, 1); assert.equal(c.left, 3);
});

test("the page contract: a renderer that replaces the old steps for friends events, with sheets and drawn icons", () => {
  // renderStep stops at the event page for friends events; work events and Every setting go on to the old planner
  assert.match(block, /const _rsHv=renderStep; renderStep=function\(\)\{ const h=q\("#hv"\);\n    if\(!want\(\)\)\{ if\(h\) h\.hidden=true; return _rsHv\.apply\(this,arguments\) \}/);
  assert.match(block, /#view-studio:has\(> #hv:not\(\[hidden\]\)\) > :not\(#hv\)\{display:none!important\}/);
  // the create flow and the old share sheet land here
  assert.match(block, /openWizard=function\(at=1,seed=""\)/); assert.match(block, /shareSheet=function\(d\)\{ if\(want\(\)&&d&&isCasual\(d\)\)/);
  // it ends on one calm screen: the invite, one Share button and the way to the event
  assert.match(block, /title:"It's live"/); assert.match(block, /id="hvToEv">Go to your event<\/button><button class="hv-b pri" type="button" id="hvShareGo">/);
  // simple tabs, no numbered circles; the tab bar says Home while managing
  assert.match(block, /\["overview","Overview",""\],\["guests","Guests"/); assert.doesNotMatch(block, /class="n">\d|<span class="n">/);
  assert.match(block, /if\(v==="studio"\)\{ if\(managing\) a\.removeAttribute\("aria-current"\)/);
  // Message guests opens the group chat when it's there
  assert.match(block, /case "message": if\(typeof window\.openChat==="function"&&d\.id\)\{ try\{ window\.openChat\(d\.id\); return \}/);
  // no Markdown copy, no emoji icons, no em dashes, the brand's words
  assert.doesNotMatch(block, /data-sharefmt="md"|"md"\]|Copy as Markdown<\/span>/);
  assert.doesNotMatch(block, /[⚙️✉️📷🎶👗❓💬📊✅]/u); assert.doesNotMatch(block, /—/);
  assert.doesNotMatch(block, /\b(RSVP rate|attendees|Roster CSV|Edit rules)\b/i);
  // the floating help and Potto buttons step aside on this page
  assert.match(block, /body:not\(\.hv-help\):has\(#view-studio:not\(\[hidden\]\) > #hv:not\(\[hidden\]\)\) #encoreHelp\{display:none!important\}/);
});

test("the tables panel: plain words and no zero headlines", () => {
  assert.doesNotMatch(html, /Second-RSVP rate/); assert.doesNotMatch(html, /<b class="tb-none">No asks yet<\/b>/); assert.doesNotMatch(html, /pct=x=>x==null\?"none yet"/);
  assert.match(html, /window\.TablesStudio=\{ editHTML:tbEditHTML, wireEdit:tbWireEdit, hostPanel:tbHostPanel \}/);
  // the "Come with me?" loader stays the last script
  assert.match(html.slice(html.lastIndexOf("<script>")), /comewith\.js/);
});
