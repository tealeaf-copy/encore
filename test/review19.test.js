// Review round 19 (docs/review-scorecard.md): what the walk fixed in the pages themselves. The behaviour tests live
// next to their features: test/reply-digest.test.js, test/fanclub.test.js, test/feed-kudos-comments.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const app = read("index.html");

test("Discover: the events wait unseen until the shelves above them have answered, so nothing jumps on a cold first load", () => {
  const d = read("public/discover.html");
  assert.match(d, /body\.dc-wait #evSec,body\.dc-wait #forYou\{visibility:hidden\}/);
  assert.match(d, /drawAll\(\); shelvesIn\.then\(ready\)/); assert.match(d, /setTimeout\(\(\) => \{ mo\.disconnect\(\); done\(\); \}, 2500\)/, "never more than 2.5 seconds");
});

test("The map: when the map library can't load, a wide screen keeps the list where it was", () => {
  const m = read("public/map.html");
  assert.match(m, /@media \(max-width:899\.98px\)\{\s*body\.nomap\{overflow:auto\}\s*\.nomap #stage\{position:static;height:auto\}/, "the list becomes the page on phones only");
  assert.match(m, /\.nomap #stage::after\{content:"The map didn't load\./); assert.match(m, /\.cats\[data-wait\]\{min-height:67px/); assert.match(m, /id="cats"[^>]*data-wait/);
});

test("Home: sign-off requests wait for the workspace answer and never fire on a host's own Home", () => {
  assert.match(app, /const miss=!window\.__wsKnown\|\|window\.__wsPersonal\?\[\]/);
  assert.match(app, /const first=!window\.__wsKnown; window\.__wsKnown=1;/);
  assert.match(read("test/brand-intel-seed.js"), /claimEvent\(id, H\.ws\)/, "the brand world's events are indexed like real ones");
});

test("Home: the cards under the composer are held from before the first paint and drawn once", () => {
  assert.match(app, /html\.pl-presettle #view-programs>#qsPanel~\*\{visibility:hidden\}/); assert.match(app, /classList\.add\("pl-presettle"\)/);
  assert.match(app, /v\.classList\.add\("pl-settling"\); const H=document\.documentElement; H\.classList\.remove\("pl-presettle"\)/, "handed over in one step, no gap");
  assert.match(app, /if\(document\.getElementById\("view-programs"\)\) watch\(\); else document\.addEventListener\("DOMContentLoaded",watch\)/);
  assert.match(app, /if\(!H\.classList\.contains\("ws-wait"\)\) return go\(\)/, "the settle clock starts when Home is on screen");
});

test("Home at tablet widths: one breakpoint with every other page (tab bar to 860px, side menu from 861px), and the tab bar sits above the Ask Potto fade", () => {
  assert.doesNotMatch(app, /@media \(max-width:700px\)/); assert.doesNotMatch(app, /@media \(min-width:701px\)/); assert.doesNotMatch(app, /min-width:1000px/);
  assert.match(app, /@media \(min-width:861px\)\{\n\s*header\.top\{position:fixed!important;left:0;top:0;bottom:0;width:224px/);
  assert.match(app, /background:var\(--surface\)!important;z-index:56/); assert.match(read("public/potto.js"), /\.pt-dock\{position:fixed;[^}]*z-index:55/, "the fade this clears");
  assert.match(app, /body\.pt-has-dock:not\(\.es-has-rail\):not\(\.guestmode\) \.pt-dock\{left:224px\}/);
});

test("On the kit: the app's own corners are 6px, and platform chrome carries no emoji", () => {
  assert.doesNotMatch(app, /border-radius:(9|1\d|2\d|30|34)px(?=[;}"'`!])/, "host looks use their own tokens; the app's chrome is on 6px");
  for (const f of ["public/gifts.html", "public/giftplan.html", "public/moderation.html", "public/composer.js", "public/interests.js", "public/feedcomments.js", "public/fanclub.js"]) assert.doesNotMatch(read(f), /border-radius:(1\d|2\d)px/, f);
  const recap = read("public/recap.html"); assert.match(recap, /<h1>\$\{esc\(h\.name\)\}<\/h1>/); assert.doesNotMatch(recap, /t\.emoji|b\.emoji|linear-gradient|Fraunces/); assert.match(recap, /\.card\{[^}]*border-radius:var\(--pl-r-md,6px\)/);
  const host = read("public/host.html"); assert.doesNotMatch(host, /\$\{em\} \$\{esc\(label\)\}|\$\{b\.emoji\} |✨ \$\{new Date|🌱 Rising|🏆 \$\{|🔒 Only you|💛 /u);
  assert.doesNotMatch(app, /aria-pressed="false">\$\{em\} \$\{esc\(l\)\}/, "kudos chips are words"); assert.doesNotMatch(app, /🫶 Your/u);
  assert.doesNotMatch(read("public/kudos.html"), /📷|🔁/u); assert.doesNotMatch(read("public/photos.html"), /📸|🌍|🔒/u); assert.doesNotMatch(read("public/gifts.html"), /✍️|📦/u);
  assert.match(read("public/feedvisual.js"), /h\.emoji && h\.emoji !== "🎉" \? h\.emoji : String\(h\.name/u, "a host's own emoji stays; the stock one becomes an initial");
});

test("index.html opens with a map of its sections, and the Come with me loader is still its last script", () => {
  assert.match(app.slice(0, 4000), /A MAP OF THIS FILE/); assert.match(app.slice(0, 4000), /the\s+LAST definition wins/);
  for (const marker of ["Operations: programs home", "Guest-facing pages", "Hosting with friends", "Home settles once", "one top heading per screen", "__wsPersonal"]) assert.ok(app.indexOf(marker, 4000) > 0, "the map names a real part: " + marker);
  const last = app.slice(app.lastIndexOf("<script")); assert.match(last, /comewith/i);
  assert.doesNotMatch(app, /function ideaMap\(|function supEditorHTML\(/, "the two functions nothing called are gone");
});

test("A signed-out guest's invite has a top heading: the title is announced as level 1 while no h1 is drawn", () => {
  assert.match(app, /lk\.setAttribute\("role","heading"\); lk\.setAttribute\("aria-level","1"\)/);
});
