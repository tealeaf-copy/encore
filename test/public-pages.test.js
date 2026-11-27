import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");

// The fast invite (/e/<id>) is what WhatsApp, Messages and Copy invite share, so it carries the event's real details.
test("the fast invite shows end time, bring list, route, rides, chat and price", () => {
  const html = read("public/invite.html");
  assert.match(html, /e\.endTime/, "end time on the invite and in Add to calendar");
  assert.match(html, /bringOf\(e\)/, "what to bring");
  assert.match(html, /e\.routeUrl/, "trail or map link");
  assert.match(html, /e\.carpool[\s\S]*I need a ride/, "rides picker");
  assert.match(html, /ride \} : \{\}/, "the ride choice is sent with the reply");
  assert.match(html, /Join the group chat/, "group chat link after a yes");
  assert.match(html, /a person/, "price");
  assert.doesNotMatch(html, /\(e\.price && e\.price !== "chip"\) \|\| e\.stage/, "paid spots no longer bounce to the full invite");
  // a guest stepping out hears it went through, not the rejection copy
  assert.match(html, /You're out/);
  assert.match(html, /Thanks for telling \$\{who\}/);
  assert.doesNotMatch(html, /No spot this time/);
  assert.match(html, /You're #\$\{place\} on the waitlist/, "waitlist place when the server gives one");
  // the calendar is the server's .ics (server/hooksout.js calTimes: the host's end time, next day when it runs past midnight)
  assert.match(html, /cal\.href = `\/e\/\$\{encodeURIComponent\(eid\)\}\.ics\?rid=/);
});

test("a friend's invite never shows the brands link", () => {
  assert.match(read("public/shell.js"), /isG \? "" : item\("\/hosts\/book", ICON\.brief, "For brands"\)/);
  assert.match(read("public/nav.js"), /\(g\$\|e\\\/\)/);
});

test("the public scrapbook speaks to visitors, not as if they were the host", () => {
  const js = read("public/scrapbook.js");
  assert.match(js, /mine \? \(all\.length \? "Your scrapbook\. Every event you've hosted/);
  assert.match(js, /<h2>Past events<\/h2>/); assert.match(js, /: first \? `From \$\{esc\(poss\(first\)\)\} scrapbook\.`/, "visitors read whose scrapbook it is");
  assert.doesNotMatch(js, /font-style:italic/);
});

test("brand fonts: the Field Notes faces, no Fraunces or italic headings on pages we own", () => {
  for (const f of ["public/signup.html", "public/join.html", "public/404.html", "public/home.html", "public/discover.html", "public/collab.js", "public/account.js"]) assert.doesNotMatch(read(f), /Fraunces/, f);
  assert.match(read("public/signup.html"), /family=IBM\+Plex\+Sans:wght@400;500;600/); assert.doesNotMatch(read("public/signup.html"), /Instrument/); assert.doesNotMatch(read("public/signup.html"), /Fredoka/);
});

test("the owner's page: no Follow form for yourself, private plans only for you", () => {
  const html = read("public/host.html");
  assert.match(html, /body\.is-owner #follow,body\.is-owner #topFollow\{display:none!important\}/);
  assert.match(html, /if \(isOwner\) \{[\s\S]*Only you see this/);
});

test("signup saves the club or group name as the page name", () => {
  const html = read("public/signup.html");
  assert.match(html, /JSON\.stringify\(\{ name: club, \.\.\.extra \}\)/);
});

test("Discover and the homepage reserve space for late sections", () => {
  assert.match(read("public/discover.html"), /<body class="dc-wait">/);
  const home = read("public/home.html");
  assert.match(home, /<section [^>]*id="feedSec"/);
  assert.match(home, /fi-sk/);
});

// /about tells why Pottery Lab exists (docs/about-story.md): the host first, then guests, then brands, in the house voice.
test("/about: the host's story, four host pillars, three readers, three community rules, the tagline word for word, and plain words", () => {
  const home = read("public/home.html"), text = home.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "");
  assert.match(home, /<span class="kick">Why we exist<\/span>\s*<h1>You're the one who always makes the plan\.<\/h1>/);
  // one primary action, worded for a first event; signed in (encore_in) it reads Plan an event
  assert.equal((home.match(/href="\/start" data-plan>Plan your first event<\/a>/g) || []).length, 3, "hero, hosts card and close");
  assert.doesNotMatch(text, /Plan a dinner/);
  assert.match(home, /encore_in=1[^\n]*\[data-plan\][^\n]*"Plan an event"/);
  const shell = read("public/shell.js"); // the shell says the same thing: the signed-out tab and the "New here?" line
  assert.match(shell, /<span class="nl-full">Plan your first event<\/span>/); assert.match(shell, /Why we exist<\/a> · <a href="\/start">Plan your first event<\/a>/); assert.doesNotMatch(shell, /Plan a dinner/);
  // community rules: trust first, then safety, then made for you, and only what the product does
  const rules = [...text.matchAll(/<li><p><b>([^<]+)<\/b>/g)].map((m) => m[1]);
  assert.deepEqual(rules, ["Trust and quality over quantity.", "Safety first.", "Made for you."]);
  assert.match(text, /<span class="kick">05 · Community rules<\/span>/);
  assert.match(text, /private unless you list them[^<]*only guests who are in get the exact address[^<]*report or block[^<]*within 24 hours/);
  assert.match(text, /No ads\. We don't sell ads or your guest list\./);
  assert.equal((home.match(/<li><div><span class="n">0\d · /g) || []).length, 4, "four host pillars");
  assert.match(home, /<span class="kick">03 · For hosts<\/span>\s*<h2 id="changes">What it does for hosts\.<\/h2>/);
  const order = ["For hosts", "For guests", "For brands"].map((k) => text.indexOf(`<span class="kick">${k}</span>`));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], "hosts, then guests, then brands");
  assert.match(text, /Host memorable experiences, with your fav people\.<\/p><p>We've been the planner\. This is the tool we wished we had\./);
  assert.match(text, /where you go to explore, discover and plan out your in-person events and experiences with the people you love/, "the guest line");
  assert.match(text, /<b>Insights:<\/b>[^<]*at least 10 people and 3 events/, "insights name their privacy thresholds (server/insights.js K)");
  for (const h of ["/start", "/feed", "/teams/discover"]) assert.match(text, new RegExp(`<section class="sec end"[\\s\\S]*href="${h}"`), `the close links ${h}`);
  assert.doesNotMatch(text.replace(/<!doctype[^>]*>/i, ""), /—|!|seamless|effortless|unlock|elevate|curated|magical|marketplace|empower|attendees|\bseats\b|per person|journey|ecosystem|game-changer|vibrant|community-driven|we believe/i);
  assert.match(home, /<meta name="description" content="[^"]*host[^"]*">/);
  assert.match(home, /<meta property="og:title" content="You're the one who always makes the plan/);
  assert.match(home, /<title>About Pottery Lab · For the one who always makes the plan<\/title>/);
});

test("host pages keep their full width when a series loads the invite stylesheet", () => {
  const css = read("public/slots.css");
  assert.match(css, /html body #m#m:not\(\[data-calm="host"\]\)\{max-width:600px/);
  assert.match(read("public/host.html"), /<main id="m" data-calm="host"/);
});

test("a fresh page starts at the top: the guard ships with the loader, the shell and the brand pages", () => {
  for (const f of ["public/calm.js", "public/shell.js", "public/brandbook.js"]) { const s = read(f);
    assert.match(s, /nav\.type !== "navigate" \|\| location\.hash/, f + " leaves back, reload and #links alone");
    assert.match(s, /if \(!touched && [^;]*scrollTo\(0, 0\)/, f + " never moves a reader who has touched the page"); }
});

test("the cover sheet can draw a cover from words: the create canvas offers it and keeps the drawing as the event's cover", () => {
  const ps = read("public/photosheet.js"), cv = read("public/canvas.js");
  assert.match(ps, /Describe it and Potto draws it/); assert.match(ps, /fetch\("\/api\/art\/draw"/); assert.match(ps, /save\(\{ drawn: \{ svg: d\.svg, prompt: d\.prompt \} \}\)/);
  assert.match(ps, /opts\.draw && opts\.onChange/, "only where the caller can keep a drawing");
  assert.match(cv, /templates, draw,/); assert.match(cv, /c\.drawn\) Object\.assign\(W, \{ coverPhoto: "", coverSource: "", coverFocus: null, coverArt: \{ kind: "custom", svg: c\.drawn\.svg/);
});

test("Chats are split into Hosting and Going, coming dates first, past ones folded, with a switch when you have both", () => {
  const js = read("public/chat.js"), css = read("public/chat.css");
  assert.match(js, /group\("Hosting", H/); assert.match(js, /H\.length \? "Going" : "Your events"/); assert.match(js, /<details class="ch-past"/); assert.match(js, /data-chseg="\$\{k\}"/);
  assert.match(css, /\.ch-grp,\.ch-past\{display:block!important/, "groups stack, never sit side by side");
});
