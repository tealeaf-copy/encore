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
  // the calendar end: the host's end time, next day when it runs past midnight
  assert.match(html, /endT < t/);
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
  assert.match(home, /<section id="feedSec">/);
  assert.match(home, /fi-sk/);
});
