// Potto's guide covers every core flow: each canonical question (and a few ways people actually say it) finds the
// section that answers it, with a grounded answer and a one-tap action where the step is something Potto can do.
// The owner's report: "How do I share my invite?" got "my guide doesn't cover it". Also: the guide ships with the app.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { offlineAnswer, loadGuide, matchSections, lookupAnswer, replyWithin, deviceOf, words } from "../server/help.js";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");

// [question, the section that answers it, a word the answer must carry, the one-tap action it should offer]
export const CANON = [
  ["How do I make an event?", "Creating your first event", /New event/, "#do:new"],
  ["How do I share my invite?", "Sharing your invite", /Copy invite/, "#do:share"],
  ["Where is the share sheet?", "Sharing your invite", /share sheet/, "#do:share"],
  ["how do i send the invite to my friends", "Sharing your invite", /Copy invite/, "#do:share"],
  ["How do I post my invite in Discord?", "Discord, Slack and Markdown", /Discord/, "#do:share"],
  ["Can I copy my invite as Markdown?", "Discord, Slack and Markdown", /Markdown/],
  ["What is the /e link?", "Your invite link", /\/e\//, "#do:copy"],
  ["How do I edit my event?", "Editing your event", /Edit details/],
  ["I need to change the date of my event", "Editing your event", /Edit details/],
  ["How do I cancel my event?", "Cancelling an event", /no Cancel button yet/, "#person"],
  ["How does ask to join work?", "Ask to join or open", /Let in/, "#do:guests"],
  ["How do guests pay?", "How guests pay", /payment link/],
  ["A guest says they paid. What do I do?", "I paid", /says paid/, "#do:guests"],
  ["Can I have different prices for adults and kids?", "Price tiers", /Different prices\?/],
  ["How do I sell spots in pairs?", "Pairs and groups", /a pair/],
  ["How do pre-orders work?", "The shop and pre-orders", /order-by day/],
  ["How do I set up my shop?", "The shop and pre-orders", /🛍 Shop/],
  ["Why can't people order from a preview page?", "Pages that aren't claimed yet", /hasn't joined/],
  ["How does Invite friends work?", "Invite friends", /48 hours/],
  ["How does I'm in if a friend is work?", "I'm in if a friend is", /never told/],
  ["How do open tables work?", "Open tables", /tables of about 4/, "#do:guests"],
  ["What is Same table next time?", "Same table next time", /Same table next time\?/],
  ["How do episode numbers work?", "Series and episode numbers", /#14/],
  ["How do I add a demo queue?", "Slots: demos, polls and brackets", /Lightning demo queue/],
  ["Can guests say they're coming alone?", "Quiet guests and coming solo", /Coming solo/],
  ["How do I add stickers?", "Event looks and stickers", /Stickers/],
  ["How do I change my page layout?", "Host page layouts", /Shop window/],
  ["How do kudos work?", "Kudos and reviews", /kudos/],
  ["How do guests add photos?", "Photo drops and photos from the day", /photos/],
  ["How do I export my guest list?", "Roster export", /Roster CSV/, "#do:guests"],
  ["How do I connect a Discord webhook?", "Discord and Slack webhooks", /webhook/],
  ["Is there a calendar feed of my events?", "Calendar feeds", /webcal/],
  ["How do I change my password?", "Your account", /Forgot your password/],
  ["Who sees my guests' emails?", "Privacy", /only for you/],
  ["How do I delete my account?", "Deleting your account or an event", /Settings > Delete account\. Right away, or scheduled with a grace period/, "/settings#delete"],
  ["How do I change my profile picture?", "Photos: covers and your profile picture", /Change photo/, "/settings"],
  ["How do I add a cover photo?", "Photos: covers and your profile picture", /Upload a photo/],
  ["How do I message my guests?", "Group chats", /group chat/, "/chats"],
  ["I don't have a host code. How do I get one?", "Host codes and invite-only", /host code/],
  ["I can't find my invite", "Finding an invite you got", /Plans/, "/plans"],
  ["How do I change my reply?", "Changing your reply", /I'm in, Maybe or Can't go/],
  ["How do weekly events work?", "Weekly, monthly and courses", /Every week/],
];

test("guide coverage: every core flow has a grounded answer, with its one-tap action", () => {
  const G = loadGuide(), titles = new Set(G.sections.map((s) => s.title));
  for (const [q, title, must, act] of CANON) {
    assert.ok(titles.has(title), `the guide has "${title}"`);
    const a = offlineAnswer(q);
    assert.equal(a.section, title, `"${q}" finds ${title} (got ${a.section})`);
    assert.match(a.answer, must, `"${q}" is answered from the guide`);
    assert.doesNotMatch(a.answer, /not sure|doesn't cover|don't know/i, `"${q}" isn't an I don't know`);
    if (act) assert.ok(a.actions.some((x) => x.href === act), `"${q}" offers ${act}`);
    assert.ok(!/—/.test(a.answer));
  }
  // the owner's exact question is a confident answer, not a handoff
  const share = offlineAnswer("How do I share my invite?"); assert.equal(share.confidence, "high"); assert.equal(share.suggestHuman, false);
  // only true I don't knows
  for (const q of ["what's the weather on mars", "who won the world cup", "can I host on the moon"]) { const a = offlineAnswer(q); assert.equal(a.section, null, q); assert.match(a.answer, /not sure/); assert.ok(a.actions.some((x) => x.href === "#person")); }
});

test("retrieval: synonyms and word forms find the same answer; every section is reachable by its own questions", () => {
  assert.deepEqual(words("RSVPs"), ["reply"]); assert.deepEqual(words("attendees"), ["guest"]); assert.equal(words("cancelled")[0], "cancel");
  assert.equal(offlineAnswer("where do I see my RSVPs").section, "Guest replies");
  assert.equal(offlineAnswer("how can attendees pay me").section, "How guests pay");
  assert.equal(offlineAnswer("need to call off saturday's dinner").section, "Cancelling an event");
  const G = loadGuide();
  for (const s of G.sections) { assert.ok(s.keywords.length, `${s.title} has keywords`); assert.ok(s.questions.length, `${s.title} says what it answers`);
    for (const q of s.questions) assert.equal(matchSections(q)[0]?.s.title, s.title, `"${q}" finds ${s.title}`); }
  // app actions in the guide are ones the app can run
  for (const s of G.sections) for (const l of s.links) assert.match(l.href, /^(\/|#person$|#urgent$|#do:(share|copy|preview|guests|open|new)$)/, `${s.title}: ${l.href}`);
});

test("event lookup: the host's own event in counts, never names; reply time and device in words", () => {
  const ctx = { event: { id: "ev1", title: "Dumpling night", status: "shared", date: "2099-05-01", going: 3, asked: 1, maybe: 0, spots: 8 } };
  const a = lookupAnswer(ctx, "How many people are coming?");
  assert.match(a.answer, /^Dumpling night \(.+\) is shared\. 3 are in, 1 asked to join, 5 spots left\.$/); assert.ok(a.actions.some((x) => x.href === "/?app=1&open=ev1&step=6#studio"));
  assert.equal(lookupAnswer(ctx, "How do I share my invite?"), null, "not every question is a lookup");
  assert.equal(lookupAnswer({}, "how many are coming"), null);
  assert.equal(replyWithin(24), "within a day"); assert.equal(replyWithin(4), "within 4 hours"); assert.equal(replyWithin(48), "within 2 days"); assert.equal(replyWithin(1), "within an hour");
  assert.equal(deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"), "iPhone · Safari 17.4");
});

test("the guide ships with the app: the Docker image copies docs/help.md, and an empty guide never reaches the model", () => {
  assert.match(read("Dockerfile"), /COPY docs\/help\.md \.\/docs\/help\.md/);
  assert.match(read("server/help.js"), /aiMode\(\) === "live" && G\.sections\.length/);
});
