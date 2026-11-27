// Kudos on a host's page (public/kudoswall.js, server hostStrengths): the section's structure in each state (none,
// one or two, many), the carousel done with CSS scroll snap and proper carousel semantics, tokens only, and the
// privacy rules on the data (first names, "A guest", the event and month only for events on the page).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";

const PUB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const SRC = fs.readFileSync(path.join(PUB, "kudoswall.js"), "utf8"), HOST = fs.readFileSync(path.join(PUB, "host.html"), "utf8");
const CSS = SRC.slice(SRC.indexOf("const CSS = `"), SRC.indexOf("`;", SRC.indexOf("const CSS = `")));
function load() { const styles = []; const doc = { getElementById: () => null, createElement: () => ({}), head: { appendChild: (x) => styles.push(x) }, documentElement: {} };
  const ctx = { window: {}, document: doc }; vm.runInNewContext(SRC, ctx); return { K: ctx.window.EncoreKudos, styles }; }
const k = (i, o = {}) => ({ name: ["Priya", "Marcus", "Jo", "Lena", "Tom", "Aisha", "Sam"][i % 7], love: i % 3 === 0 ? "Came alone, left with six new friends and a recipe for chili oil. The table felt like a family that had been waiting for me, and I am going back." : "Best soup of my life.", tags: ["food", "again"], at: Date.UTC(2026, 9, 10 + i), event: "Harvest supper", month: "2026-10", ...o });
const S = (n, o = {}) => ({ kudos: Array.from({ length: n }, (_, i) => k(i)), kudosShown: n, kudosEvents: 2, tags: [{ tag: "food", label: "Amazing food", n: Math.min(n, 6) }, { tag: "again", label: "Would go again", n: Math.min(n, 5) }, { tag: "welcome", label: "Felt welcome", n: 1 }], ...o });

test("kudos: many is a scroll-snap carousel with real carousel semantics, a count and a summary from real data", () => {
  const { K, styles } = load(); assert.equal(styles.length, 1, "its own styles, added once");
  const h = K.html(S(12, { kudos: [...S(11).kudos, k(11, { love: "", tags: ["food", "welcome"] }), ] }));
  assert.match(h, /^<section class="kd s-kudos is-row" id="kudos" aria-labelledby="kdH" data-n="12">/, "the section keeps .s-kudos, so the host's 'hide kudos' setting still hides it");
  assert.match(h, /<h2 class="sec" id="kdH">Kudos <span class="kd-n">12<\/span><\/h2>/);
  assert.match(h, /<p class="kd-sum">From guests at 2 events · latest Oct 2026<\/p>/);
  assert.match(h, /<ul class="kd-tags" aria-label="What guests mention most"><li>Amazing food <b>6 of 12<\/b><\/li><li>Would go again <b>5 of 12<\/b><\/li><\/ul>/, "top tags with counts; a tag only one guest picked is left out");
  assert.match(h, /<div class="kd-list" id="kdList" role="region" aria-roledescription="carousel" aria-label="Kudos from guests" tabindex="0">/);
  assert.equal((h.match(/role="group" aria-roledescription="slide" aria-label="\d+ of 12"/g) || []).length, 12, "every card is a labelled slide");
  assert.match(h, /aria-label="1 of 12"/); assert.match(h, /aria-label="12 of 12"/);
  assert.match(h, /<button type="button" class="kd-nav" data-dir="-1" aria-controls="kdList" aria-label="Previous kudos">/);
  assert.match(h, /<button type="button" class="kd-nav" data-dir="1" aria-controls="kdList" aria-label="Next kudos">/);
  assert.match(h, /<button type="button" class="kd-all" aria-expanded="false" aria-controls="kdList">See all<\/button>/);
  assert.match(h, /<p class="kd-sr" aria-live="polite"><\/p>/, "button moves are announced");
  // the card: quote first (in the card's first <p>, which the report menu reads), then the guest, then event and month in mono
  assert.match(h, /<figure class="kq kd-card"[^>]*><div class="kd-body"><blockquote class="kd-qw"><p class="kd-q" id="kdq0">Came alone/);
  assert.match(h, /<figcaption class="kd-by"><span class="kd-av" aria-hidden="true">P<\/span><span class="kd-who"><b>Priya<\/b><small title="Oct 2026 · Harvest supper">Oct 2026 · Harvest supper<\/small><\/span><button type="button" class="kd-more" aria-expanded="false" aria-controls="kdq0" data-off>More<\/button>/);
  assert.match(h, /class="kq kd-card is-short"/, "a short quote reads as a pull quote");
  // words first, the tag-only kudos last, with its tags in words and no report-able <p>
  assert.match(h, /aria-label="12 of 12"><div class="kd-body"><div class="kd-tagsonly">Amazing food, felt welcome<\/div>/);
  assert.ok(!/autoplay|setInterval/.test(SRC), "no auto-play");
  assert.match(SRC, /\{ ArrowRight: \[step\(\), true\], ArrowLeft: \[-step\(\), true\], Home: \[0, false\], End: \[list\.scrollWidth, false\] \}/, "the row takes arrow keys, Home and End");
});

test("kudos: the first three come from different nights, and guests who came back count from 3", () => {
  const { K } = load();
  const L = [k(0, { love: "A1", event: "Big night" }), k(1, { love: "A2", event: "Big night" }), k(2, { love: "A3", event: "Big night" }), k(3, { love: "B1", event: "Quiet supper" }), k(4, { love: "C1", event: "Picnic" })];
  const h = K.html(S(5, { kudos: L, returning: 4 }));
  assert.deepEqual([...h.matchAll(/<p class="kd-q" id="kdq\d+">([^<]+)</g)].map((m) => m[1]), ["A1", "B1", "C1", "A2", "A3"], "newest from each night first, then the rest by date");
  assert.match(h, /<p class="kd-sum">From guests at 2 events · 4 came back · latest Oct 2026<\/p>/);
  assert.ok(!/came back/.test(K.html(S(5, { returning: 2 }))), "2 reads as weak, so it isn't shown");
});

test("kudos: the carousel CSS is scroll snap with a peek, buttons only with a mouse, tokens only", () => {
  assert.match(CSS, /\.kd\.is-row:not\(\.is-all\) \.kd-list\{grid-template-columns:none;grid-auto-flow:column;grid-auto-columns:min\(84%,320px\);overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x mandatory;/, "cards a fixed share of the row, so the next one peeks");
  assert.match(CSS, /scroll-snap-align:start/); assert.match(CSS, /\.kd\.is-all \.kd-list\{align-items:start\}/, "in the full grid a short note is a short card");
  assert.match(CSS, /\.kd-nav\{display:none;width:44px;height:44px;/); assert.match(CSS, /@media \(hover:hover\) and \(pointer:fine\) and \(min-width:761px\)\{\.kd\.is-row:not\(\.is-all\):not\(\.fits\) \.kd-nav\{display:grid\}\}/);
  assert.match(CSS, /-webkit-line-clamp:var\(--kd-lines,6\)/); assert.match(CSS, /\.kd-card\{--kd-lines:5\}/); assert.match(CSS, /\.kd-card\.has-photo\{--kd-lines:3\}/);
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(CSS), "no hard-coded colours: a host's brand kit flows through the tokens");
  assert.ok(!/font-family:\s*["A-Z]/.test(CSS) && !/var\(--(pl-font-display|sys-display)/.test(CSS), "faces from tokens, never the display face");
  for (const m of CSS.matchAll(/font:\s*\d+\s+(\d+)px[^;}]*var\(--sys-sans\)/g)) assert.ok(+m[1] >= 12, "no tiny text");
  assert.match(CSS, /\.kd-more\{flex:none;min-height:44px;min-width:44px;/); assert.match(CSS, /\.kd-all\{min-height:44px;/);
  assert.ok(!/—/.test(SRC), "no em dashes");
});

test("kudos: one or two are just the cards; none is nothing for a visitor and a nudge for the host", () => {
  const { K } = load();
  const few = K.html(S(2));
  assert.match(few, /^<section class="kd s-kudos kd-few"/); assert.match(few, /<h2 class="sec" id="kdH">Kudos<\/h2>/, "no count for one or two");
  assert.ok(!/carousel|aria-roledescription|kd-nav|kd-all|kd-sum|kd-tags/.test(few), "no carousel, no buttons, no summary");
  assert.equal((few.match(/<figure class="kq kd-card/g) || []).length, 2);
  assert.equal(K.html(S(0)), "", "a visitor sees nothing, so a new host isn't shown as 'no kudos'");
  assert.equal(K.html({}), "");
  const own = K.html(S(0), { owner: true, pastId: "ev 1" });
  assert.match(own, /<section class="kd kd-empty s-kudos" id="kudos"/); assert.match(own, /No kudos yet\. Guests who were in can send them after an event, and they show here\./);
  assert.match(own, /<a class="kd-ask" href="\/\?app=1&amp;open=ev%201#studio">Ask past guests<\/a>/);
  assert.match(K.html(S(0), { owner: true }), /Kudos from guests show here after your first event\.<\/p><\/section>$/, "no past event: no ask");
  // a photo goes on top, with its size so the card never jumps; no name is "A guest", with a drawn mark, not an initial
  const ph = K.html(S(1, { kudos: [k(1, { name: "", photo: { url: "/_blob/abc", w: 800, h: 600 } })] }));
  assert.match(ph, /<figure class="kq kd-card has-photo is-short"><img class="kd-ph" src="\/_blob\/abc" alt="Photo from Harvest supper, by A guest" loading="lazy" decoding="async" width="800" height="600"><div class="kd-body">/);
  assert.match(ph, /<span class="kd-av" aria-hidden="true"><svg [^>]*>.*<\/svg><\/span><span class="kd-who"><b>A guest<\/b>/);
  assert.ok(!K.html(S(1, { kudos: [k(1, { love: "<img src=x onerror=alert(1)>" })] })).includes("<img src=x"), "guests' words are escaped");
});

test("kudos: host.html draws the section in the page's first pass, from its own file", () => {
  assert.match(HOST, /<script src="\/kudoswall\.js"><\/script>/);
  assert.match(HOST, /const profP = fetch\("\/api\/public\/profile\/" \+ encodeURIComponent\(handle\)\)/, "asked for alongside the page");
  assert.match(HOST, /Promise\.allSettled\(\[\.\.\.Object\.values\(side\), profP\]\)/, "and waited for with the rest, so it is there before the first paint");
  assert.match(HOST, /window\.EncoreKudos\?\.mount\(S, \{ owner: isOwner, pastId: d\.past\?\.\[0\]\?\.id \|\| "", at: ex \}\)/);
  assert.ok(!/What guests say|more-kudos|vibe-line/.test(HOST), "the old list is gone");
  assert.match(HOST, /<main id="m" data-calm="host" style="min-height:100vh">/, "the footer starts below the fold, so it is not pushed down on load");
});

let srv;
before(async () => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "kw-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; resetLoginLimits(); srv = await startServer(); });
after(async () => { for (const x of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR"]) delete process.env[x]; await srv?.close(); });

test("kudos data: first names, 'A guest', the event and month only for events on the page, the guest's own photo", async () => {
  const J = { "content-type": "application/json" }, day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name: "Ana Host", email: "ana.kw@example.com", password: "long-password-1", mode: "friends" }) });
  const j = await r.json(), cookie = r.headers.get("set-cookie").split(";")[0], ws = j.workspace.id;
  assert.equal((await fetch(srv.base + "/api/host/profile", { method: "POST", headers: { ...J, cookie }, body: JSON.stringify({ handle: "ana-kw", name: "Ana's Table" }) })).status, 200);
  const ev = (o) => ({ kind: "social", casual: true, activity: "dinner", startTime: "19:00", published: true, ...o });
  srv.store.set(`ws/${ws}/events/kwOpen`, ev({ name: "Harvest supper", date: day(-40), discoverable: true }));
  srv.store.set(`ws/${ws}/events/kwPriv`, ev({ name: "Mia's birthday at home", date: day(-20), discoverable: false }));
  const at = Date.now();
  srv.store.set(`ws/${ws}/kudos/r1`, { eventId: "kwOpen", rid: "r1", name: "Priya Shah", email: "p@example.com", tags: ["food"], love: "Came alone, left with friends.", at: at - 3 });
  srv.store.set(`ws/${ws}/kudos/r2`, { eventId: "kwPriv", rid: "r2", name: "Jo Kim", email: "j@example.com", tags: ["fun"], love: "So much laughing.", at: at - 2 });
  srv.store.set(`ws/${ws}/kudos/r3`, { eventId: "kwOpen", rid: "r3", name: "Former guest", email: "", tags: ["again"], love: "", deletedAccount: true, at: at - 1 });
  srv.store.set(`ws/${ws}/kudos/r4`, { eventId: "kwOpen", rid: "r4", name: "Sam", email: "s@example.com", tags: [], love: "", improve: "Start later", at });
  srv.store.set(`ws/${ws}/moments/m1`, { eventId: "kwOpen", authorEmail: "p@example.com", authorName: "Priya Shah", url: "/_blob/kwphoto", type: "image", w: 800, h: 600, at });
  srv.store.set(`ws/${ws}/moments/m2`, { eventId: "kwOpen", authorEmail: "p@example.com", authorName: "Priya Shah", url: "/_blob/kwhidden", type: "image", hidden: true, at: at + 1 });
  const P = (await (await fetch(srv.base + "/api/public/profile/ana-kw")).json()).strengths;
  assert.equal(P.kudosShown, 3, "kudos with words or tags; a private note alone isn't shown"); assert.equal(P.kudosEvents, 2);
  const by = Object.fromEntries(P.kudos.map((x) => [x.love || x.tags.join(), x]));
  const pr = by["Came alone, left with friends."];
  assert.equal(pr.name, "Priya"); assert.equal(pr.event, "Harvest supper"); assert.equal(pr.month, day(-40).slice(0, 7));
  assert.deepEqual(pr.photo, { url: "/_blob/kwphoto", w: 800, h: 600 }, "her own photo from that night, never a hidden one");
  const jo = by["So much laughing."];
  assert.equal(jo.name, "Jo"); assert.equal(jo.event, "", "a private event's name stays off the page"); assert.equal(jo.month, ""); assert.equal(jo.photo, undefined);
  assert.equal(by.again.name, "A guest", "a deleted account is 'A guest', not 'Former'");
  const all = JSON.stringify(P); for (const s of ["Shah", "Kim", "p@example.com", "Start later", "birthday"]) assert.ok(!all.includes(s), `${s} stays private`);
});
