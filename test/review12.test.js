// Review round 12: readable text on every look (the light invite /i and the full one /g), the text reader (a one-date
// "third thurs of dec", the weekday that doesn't match, the place and the address, the main kind of event), the share
// formats, quiet controls with drawn glyphs, taste defaults by kind, streaks in the host's rhythm, and the host code field.
//
// The contrast check is static, not a browser run: for every look (none, and every vibe in public/looks.js, Terminal,
// Pixel, Night out, Velvet and Winter included) it takes the colours public/color.js gives the page (ink, soft, the card
// and the button) and checks each text colour against the background it sits on, plus the fixed component colours a
// look can't change (the door code chip, the chat card on /g). A Playwright audit of every text node did the same check
// in a browser for this round; this test keeps the colour pairs and the CSS that sets them from drifting.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { badgesFor, rhythmOf, longestMonths } from "../server/recognition.js";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const html = read("index.html"), invite = read("public/invite.html"), inviteCss = read("public/invite.css");
function browser() { const window = { devicePixelRatio: 1 }; const ctx = { window, console };
  for (const f of ["color.js", "looks.js", "eventart.js"]) vm.runInNewContext(read("public/" + f), Object.assign(ctx, { document: undefined, localStorage: {} }));
  return { C: window.EncoreColor, LK: window.EncoreLooks, EA: window.EventArt }; }
// a colour mixed the way CSS color-mix(in srgb, a p%, b) does
const mix = (a, b, p) => { const h = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16)), A = h(a), B = h(b); return "#" + A.map((v, i) => Math.round(v * p + B[i] * (1 - p)).toString(16).padStart(2, "0")).join(""); };

test("every look: each text colour on /i and /g passes AA against what it sits on (static colour pairs)", () => {
  const { C, LK } = browser(); const AA = 4.5, ok = (fg, bg, what) => { const r = C.contrast(fg, bg); assert.ok(r >= AA, `${what}: ${fg} on ${bg} is ${r.toFixed(2)}`); };
  // the fixed components first: the door code chip sets its own ink (it was the look's ink on butter: 1.1 on a dark look)
  assert.match(inviteCss, /\.ticket \.code\{[^}]*background:var\(--pl-sand\);color:var\(--pl-ink\)/); ok("#1D1B18", "#E3D7BE", "door code");
  // the chat card on /g is white whatever the look: ink text and a smoke note, reset over the look's light ink
  assert.match(html, /html body\.lk-on \.gchat\.gchat :is\(b,h3,h4,p,span,label,li,[^)]*\)\{color:var\(--pl-ink\)!important\}/);
  assert.match(html, /html body\.lk-on \.gchat\.gchat :is\(small,\.note,\.eyebrow,\.gc-m small\)\{color:var\(--pl-soft\)!important\}/);
  ok("#1D1B18", "#FFFFFF", "chat card ink"); ok("#5D564E", "#FFFFFF", "chat card note"); ok("#8E3B24", "#FFFFFF", "chat card link");
  // the repeat line and "Plans changed?" use the look's soft colour (they were ink brown on a dark page)
  assert.match(html, /#view-guest \.sr-every\{color:var\(--lk-soft\)!important;opacity:1!important\}/); assert.match(html, /#view-guest \.gchange>\.eyebrow\{color:var\(--lk-soft\)!important\}/);
  const looks = Object.entries(LK.VIBES); assert.ok(looks.length >= 10); for (const k of ["terminal", "pixel", "night", "velvet", "winter"]) assert.ok(LK.VIBES[k], k);
  for (const [k, v] of looks) { const p = v.look.palette, T = C.pageFrom(p[0], p.slice(1));
    for (const bg of [T.top, T.bot]) { ok(T.ink, bg, `${k} ink`); ok(T.soft, bg, `${k} soft (repeat line, Plans changed?, muted lines)`); }
    ok(T.onBtn, T.btn, `${k} button`); ok(T.cardInk, T.card, `${k} card text (form, ticket)`); ok(mix(T.cardInk, T.card, 0.74), T.card, `${k} muted text on the card`); }
  // no look: the house colours
  ok("#1D1B18", "#F4F0E8", "ink on paper"); ok("#5D564E", "#F4F0E8", "smoke on paper");
});

test("the invite meta and the ticket: drawn glyphs, the door code right under its label, Come with me after it", () => {
  assert.ok(invite.length < 40000, "under the 40,000-character cap: " + invite.length);
  for (const em of ["📍", "👥", "💵", "🗓️"]) assert.ok(!invite.includes(em), "no " + em + " in the invite meta");
  assert.match(invite, /G = \{ pin: gl\(/); assert.match(invite, /id="spots">\$\{G\.people\}<span>/);
  assert.match(invite, /<p class="muted" style="margin:0">Show this at the door<\/p><div class="code">/);
  const cw = read("public/comewith.js"); assert.match(cw, /const bt = \$\("\.btns", at\), h = \$\("h2", at\); if \(bt\) bt\.before\(box\)/);
  assert.ok(!/👯/.test(cw), "a drawn glyph, not 👯"); assert.ok(!/box-shadow:2px 2px 0|rotate\(-1deg\)/.test(cw), "no offset shadow or tilt on Come with me");
  // the default host face is initials on a tint, not 🎉
  assert.match(invite, /h\.emoji && h\.emoji !== "🎉" \? esc\(h\.emoji\) : `<span class="ini">/);
  // food is the point only when it's what the event is
  const fo = vm.runInNewContext(invite.match(/const FOODY = [^\n]*\n[^\n]*\n  const MAINNF[^\n]*\n  const foodyOf[^\n]*/)[0] + "; foodyOf");
  assert.equal(fo({ name: "GDQ watch party", activity: "watch party", concept: "snacks potluck" }), false); assert.equal(fo({ name: "Supper club", concept: "" }), true); assert.equal(fo({ name: "Hangout", concept: "potluck dinner" }), true);
});

test("quiet controls: no offset sticker shadows or tilts on buttons, chips and banners", () => {
  const files = { "public/save.js": [".pls-btn", ".pls-toast", ".pls-menu"], "public/friendsgoing.js": [".plf-pill"], "public/nudges.js": [".pln", ".pln-go"], "public/swipedeck.js": [".sd-x", ".sd-btn", ".sd-go", ".sd-card", ".sd-badge"], "public/comewith.js": [".cwm-btn", ".cwm-hello"] };
  for (const [f, sels] of Object.entries(files)) { const s = read(f);
    for (const sel of sels) { const rules = [...s.matchAll(new RegExp(sel.replace(".", "\\.") + "(?:[:\\[][^{]*)?\\{([^}]*)\\}", "g"))].map((m) => m[1]).join(";");
      assert.ok(!/box-shadow:\s*-?\d+px -?\d+px 0/.test(rules), `${f} ${sel}: no offset shadow`); assert.ok(!/rotate\(/.test(rules), `${f} ${sel}: no tilt`); } }
  const sf = read("public/storefront.js"); assert.ok(!/✏️ Edit page/.test(sf)); assert.ok(!/\$\{L\.em\}/.test(sf), "layout tiles are drawn glyphs"); assert.match(sf, /const LAYG = \{ classic: GL\(/);
  assert.ok(!/box-shadow:2px 2px 0 #1F1A17/.test(sf.match(/\.av-nudge\{[^}]*\}/)[0]), "Add a photo: no offset shadow");
  assert.ok(!read("public/host.html").includes('content:"✏️"')); assert.ok(!html.includes('"📸 Instagram story"')); assert.ok(!/PIP_SND\.muted\?"🔇":"🔊"/.test(html));
  assert.ok(!read("public/looks-app.js").includes("🎲 Surprise me"));
});

test("share sheet: Discord and Slack get Markdown, Signal plain words, no Copy as Markdown, and the story on its own row", () => {
  const code = html.match(/\/\/ the invite as each app likes it[\s\S]*?\nconst SHARE_COPY=[^\n]*/)[0];
  const ctx = { fmtDate: (d) => "Sat, Dec 6", clock12: () => "2pm", sharePlace: (d) => d.meetPoint, priceTxt: (d) => (d.price ? d.price + " a person" : ""), inviteLink: (d) => "https://x.test/e/" + d.id, inviteText: (d) => `${d.pubTitle}, Sat, Dec 6. Are you in? https://x.test/e/${d.id}`, shareLinks: () => ({ url: "" }) };
  vm.runInNewContext(code + ";this.F=shareFormats;this.C=SHARE_COPY", ctx);
  const F = ctx.F({ id: "ev1", pubTitle: "Open table board games", date: "2026-12-06", startTime: "14:00", meetPoint: "Brooklyn Strategist", price: "$5" });
  assert.equal(F.discord, "**Open table board games**\nSat, Dec 6 · 2pm · Brooklyn Strategist · $5 a person\nAre you in? https://x.test/e/ev1");
  assert.equal(F.slack, "*Open table board games*\nSat, Dec 6 · 2pm · Brooklyn Strategist · $5 a person\nAre you in? https://x.test/e/ev1");
  assert.ok(!/\*/.test(F.signal));
  // event flow redesign: the owner found "Copy as Markdown" unnecessary, so the share sheet has Discord, Slack and Signal
  assert.equal(F.md, undefined); assert.deepEqual(Object.keys(ctx.C), ["discord", "slack", "signal"]);
  assert.match(html, /b\.className="btn sm ig-btn ig-row"; b\.innerHTML=`\$\{SHARE_ICONS\.story\}<span>Instagram story<\/span>`/); assert.match(html, /row\.after\(b\) \} \}/);
});

test("taste defaults: vibes in the order that suits the kind, and Surprise me leans the same way", () => {
  const { LK, EA } = browser(), first = (e) => LK.vibeOrder(e)[0];
  assert.equal(first({ name: "Hack night #14" }), "terminal"); assert.equal(first({ name: "Open table board games" }), "cards"); assert.equal(first({ name: "GDQ watch party" }), "pixel");
  assert.equal(first({ name: "Supper club for ops/CoS folks", concept: "for ops folks" }), "night", "the name says food: not Terminal for 'ops'");
  assert.equal(LK.vibeOrder({}).length, Object.keys(LK.VIBES).length);
  for (let i = 0; i < 40; i++) { assert.notEqual(LK.surprise({ name: "Open table board games", concept: "Cascadia, Azul, Codenames" }).vibe, "terminal"); assert.ok(["terminal", "pixel"].includes(LK.surprise({ name: "Hack night" }).vibe)); }
  // covers: a laptop for a hack night (not dice for "loud keyboards"), a controller for a LAN, a screen for a watch party
  assert.equal(EA.kindOf({ title: "Hack night #14", why: "pizza from Arizmendi" }), "laptop"); assert.equal(EA.kindOf({ title: "LAN party" }), "controller"); assert.equal(EA.kindOf({ title: "GDQ watch party" }), "screen");
  assert.ok(!EA.kindsOf({ title: "Quiet tables, loud keyboards" }).includes("games")); assert.equal(EA.kindOf({ title: "Board game night" }), "games");
  for (const k of ["laptop", "controller", "screen"]) assert.match(EA.drawing(k, "#000"), /^<svg /);
  // Home ideas lead with what this crowd hosts
  assert.match(html, /FRIEND_IDEAS\.splice\(0,FRIEND_IDEAS\.length,\["Hack night",[^\]]*\],\["Board game night",[^\]]*\],\["LAN or watch party",[^\]]*\],\["Supper club",[^\]]*\],\["Book or paper club"/);
});

test("the reader: the main kind over side mentions, the place, the address and a neighbourhood that isn't the city", () => {
  const blk = html.match(/\/\/ ---- review round 12: Potto reads the main thing[\s\S]*?\nwindow\.r12Main=r12Main;/)[0];
  const ctx = {}; vm.runInNewContext(blk.replace("window.r12Main=r12Main;", "this.r12Main=r12Main;"), Object.assign(ctx, { window: {} }));
  assert.equal(ctx.r12Main("GDQ watch party", "GDQ watch party!! snacks potluck").act, "watch party");
  assert.equal(ctx.r12Main("Hack night #14", "pizza from Arizmendi").act, "hack night"); assert.equal(ctx.r12Main("Open table board games", "").act, "game night");
  assert.equal(ctx.r12Main("Supper club for ops/CoS folks", "a game night after"), null, "food in the name is the point");
  // "third thurs of dec" is one date: the repeat words need "of the month", "monthly" or "every month"
  const re = html.match(/else if\((\/\\bmonthly\\b\|\\bevery month\\b\|\\b\(first[^\n]*?\/)\.test\(low\)\) d\.repeat="monthly"; \/\/ review round 12/)[1];
  const R = vm.runInNewContext(re); assert.ok(!R.test("third thurs of dec (dec 18?)")); assert.ok(R.test("third thursday of the month")); assert.ok(R.test("first friday of each month")); assert.ok(R.test("book club monthly"));
  assert.match(html, /function r12Fix\(d,t\)/); assert.match(html, /if\(d\.city&&known&&[^\n]*EP\.find\(d\.city\)\)\{ if\(!d\.hood\) d\.hood=d\.city; d\.city=known \}/);
  // the wizard summary always says the price
  assert.match(html, /`<span class="wz-price">\$\{esc\(d\.costNote\|\|"Free"\)\}<\/span>`/);
});

test("streaks follow the host's rhythm, and the recap says the host's first name", () => {
  assert.equal(rhythmOf([], ["monthly"]), "month"); assert.equal(rhythmOf(["2026-09-17", "2026-10-15", "2026-11-19"]), "month"); assert.equal(rhythmOf(["2026-11-01", "2026-11-08", "2026-11-15"]), "week");
  const B = badgesFor({ dates: ["2026-09-17", "2026-10-15", "2026-11-19"], rhythm: "month" }, "2026-11-25");
  assert.equal(B.badges.find((b) => b.id === "streak")?.label, "3 months in a row"); assert.equal(B.streak.unit, "month");
  const N = badgesFor({ dates: ["2026-10-15"], upcoming: ["2026-12-17"], rhythm: "month" }, "2026-11-25"); assert.ok(!N.next.some((n) => /weeks? in a row/.test(n.text)));
  const N2 = badgesFor({ dates: ["2026-09-17", "2026-10-15"], upcoming: ["2026-11-26"], rhythm: "month" }, "2026-11-25"); assert.match(N2.next.find((n) => n.id === "streak").text, /3 months in a row/);
  assert.equal(longestMonths(["2026-01-03", "2026-02-07", "2026-03-07", "2026-05-02"]), 3);
  const rc = read("public/recap.html"); assert.match(rc, /first = String\(h\.person \|\| ""\)\.trim\(\) \|\| String\(h\.name/); assert.match(read("server/recognition.js"), /host: \{ handle: h\.handle, name: h\.name, person,/);
  assert.match(read("public/host.html"), /j\.streak\?\.unit === "month" \? "Host 3 months in a row" : "Host 3 weeks in a row"/);
});

test("signup: Have a host code? shows even when hosting isn't invite-only", () => {
  const s = read("public/signup.html"); assert.match(s, /<button type="button" id="codeAsk"[^>]*>Have a host code\?<\/button>\s*<label id="codeWrap" hidden>/);
  assert.match(s, /const askSync = \(\) => \{ ca\.hidden = !cw\.hidden; \}; ca\.onclick = \(\) => \{ cw\.hidden = false; askSync\(\); ci\.focus\(\); \}; askSync\(\);/);
});

test("host page: one floating button until paid work is on, and a new page wears its latest event's look", () => {
  const window = { devicePixelRatio: 1 }; const ctx = { window, console };
  for (const f of ["color.js", "looks.js", "storefront.js"]) vm.runInNewContext(read("public/" + f), Object.assign(ctx, { document: undefined, localStorage: {} }));
  const S = window.EncoreStore; const h = { name: "Third Thursday Hack Night", theme: {} };
  assert.equal(S.withEventLook(h, [{ look: { vibe: "terminal" } }]).theme.font, "modern"); assert.equal(S.withEventLook(h, [{ look: { vibe: "night" } }]).theme.cover, "noren");
  assert.equal(S.withEventLook({ theme: { accent: "#26346F", font: "bold" } }, [{ look: { vibe: "terminal" } }]).theme.font, "bold", "a page that picked a look keeps it");
  assert.equal(S.withEventLook(h, []), h);
  assert.match(read("public/storeshop.js"), /const paidOn = !!\(mine\.forHire \|\| mine\.shop\?\.open/); assert.match(read("public/host.html"), /body\.is-owner #encoreHelp\{display:none!important\}/);
});
