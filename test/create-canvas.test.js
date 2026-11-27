// The create canvas (public/canvas.js): a new event is made on the invite itself, with a live guest preview that is
// the real light invite (/e/_preview, public/invite-preview.js). Sections and the other add-ons reach both guest pages
// (public/sections.js, server/app.js publicExtras). Feelers, fan club only, the link preview card.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { publicExtras } from "../server/app.js";

const require = createRequire(import.meta.url);
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
require("../public/sections.js"); require("../public/canvas.js");
const C = globalThis.EventCanvas, X = globalThis.EventSections;
const J = { "content-type": "application/json" };
let srv, host;
before(async () => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "cnv-secret-0123456789abcdef"; process.env.ENCORE_FAKE_EMAIL = "1"; resetLoginLimits(); srv = await startServer();
  const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name: "Ada Canvas", email: "ada.cnv@example.com", password: "long-password-1", mode: "friends" }) });
  host = r.headers.get("set-cookie").split(";")[0];
  assert.equal((await fetch(srv.base + "/api/host/profile", { method: "POST", headers: { ...J, cookie: host }, body: JSON.stringify({ handle: "ada-cnv", name: "Ada Canvas" }) })).status, 200); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv.close(); });

test("Add-on chips map to the fields guests already see", () => {
  assert.deepEqual(C.ADDONS.map((a) => a.label), ["Link", "Playlist", "What to bring", "What's included", "Dress code", "Food", "Parking", "Accessibility"]);
  const d = {};
  C.addonSet(d, "bring", "Chili oil, Something to drink"); assert.deepEqual(d.bring, ["Chili oil", "Something to drink"]);
  C.addonSet(d, "parking", "Street parking on Elm\nThe 2 train"); assert.deepEqual(d.getThere.map((x) => x.x), ["Street parking on Elm", "The 2 train"]);
  C.addonSet(d, "food", "Starter: Pandan madeleines"); assert.deepEqual(d.courses, ["Starter: Pandan madeleines"]);
  C.addonSet(d, "access", "Step-free"); C.addonSet(d, "dress", "Comfy"); C.addonSet(d, "playlist", "open.spotify.com/x");
  C.addonSet(d, "link", [{ label: "Group chat", url: "chat.whatsapp.com/abc" }]);
  assert.equal(C.addonText(d, "bring"), "Chili oil\nSomething to drink"); assert.ok(C.addonHas(d, "link")); assert.ok(!C.addonHas({}, "dress"));
  assert.deepEqual(C.addonFix(d), []); assert.equal(d.playlistUrl, "https://open.spotify.com/x"); assert.equal(d.links[0].url, "https://chat.whatsapp.com/abc");
  assert.deepEqual(C.addonFix({ playlistUrl: "not a link" }), ["playlist"]);
});

test("Who can find it: private, followers, public, and fan club only when a club is on", () => {
  assert.deepEqual(C.visList(false).map((v) => v[1]), ["Private (link only)", "Followers", "Public on Discover"]);
  assert.deepEqual(C.visList(true).map((v) => v[0]), ["link", "followers", "public", "club"]);
  const d = {}; C.visApply(d, "public"); assert.equal(d.published, undefined, "a draft only remembers the choice"); assert.equal(C.visKey(d), "public");
  C.visApply(d, "public", { publish: true }); assert.deepEqual([d.published, d.discoverable, d.unlisted], [true, true, false]);
  C.visApply(d, "followers"); assert.deepEqual([d.discoverable, d.unlisted], [true, true]); assert.equal(C.visKey(d), "followers");
  C.visApply(d, "club"); assert.deepEqual([d.discoverable, d.unlisted], [false, true], "members only stays off Discover");
  assert.equal(C.visKey(d, "members"), "club"); assert.equal(C.visKey(d, "everyone"), "link");
});

test("Title styles map to the brand display face and looks.js fonts; the effect is off by default", () => {
  assert.deepEqual(C.TITLE_STYLES.map((s) => s[0]), ["display", "clean", "mono", "script"]);
  assert.equal(C.titleStyleOf({}), "display"); assert.equal(C.titleStyleOf({ look: { titleFont: "mono" } }), "mono"); assert.equal(C.titleStyleOf({ look: { titleFont: "pixel" } }), "");
  assert.equal(C.effectOf({}), "none"); assert.equal(C.effectOf({ look: { effect: "snow" } }), "snow");
  const js = read("public/canvas.js");
  assert.match(js, /var\(--pl-font-display\)/, "Display is the brand's display serif"); assert.match(js, /EncoreBrandKit/, "or the host's brand kit face");
  assert.doesNotMatch(js, /prefers-color-scheme:dark/, "one light look"); assert.doesNotMatch(js, /\beval\(/, "the page CSP has no eval");
});

test("When reads like a sentence; a feeler asks friends to pick from up to three dates", () => {
  assert.match(C.whenSentence({ date: "2026-12-12", startTime: "19:00", endTime: "22:00" }), /^Saturday, Dec 12 · 7:00pm to 10:00pm$/);
  const f = { stage: "interest", date: "", dateOptions: ["2026-12-12", "2026-12-13"] };
  assert.ok(C.isFeeler(f)); assert.equal(C.whenSentence(f), "Asking friends · Sat, Dec 12, Sun, Dec 13");
  assert.equal(C.missing({ pubTitle: "" }), "title"); assert.equal(C.missing({ pubTitle: "Hike" }), "date"); assert.equal(C.missing({ pubTitle: "Hike", ...f }), "");
});

test("The link preview card says what the server's meta tags say; the guest copy drops the address", () => {
  const U = C.unfurlOf({ pubTitle: "Dumpling night", date: "2026-12-12", startTime: "19:00", city: "Brooklyn" }, "Ada Canvas");
  assert.deepEqual(U, { title: "Dumpling night", line: "Sat, Dec 12 · 7:00 PM · Brooklyn · Hosted by Ada Canvas" });
  assert.equal(C.unfurlOf({}).title, "You're invited");
  const g = C.guestOf({ pubTitle: "x", venueAddr: "12 Elm St", guests: [{ email: "a@b.c" }], sections: [{ icon: "bad", title: "Rules", body: "" }, { title: "", body: "" }] });
  assert.equal(g.venueAddr, undefined); assert.equal(g.guests, undefined); assert.deepEqual(g.sections, [{ icon: "note", title: "Rules", body: "" }]);
});

test("Sections draw on the guest pages, escaped, with plain words", () => {
  const h = X.html({ sections: [{ icon: "star", title: "House <rules>", body: "Shoes off.\nPhones down." }], accessNote: "Step-free", links: [{ label: "Chat", url: "https://chat.example.com/x" }, { label: "Bad", url: "javascript:alert(1)" }], cohosts: [{ name: "Jun" }] });
  assert.match(h, /House &lt;rules&gt;/); assert.match(h, /Shoes off\.<br>Phones down\./); assert.match(h, /Accessibility/); assert.match(h, /With Jun/);
  assert.match(h, /https:\/\/chat\.example\.com\/x/); assert.doesNotMatch(h, /javascript:/);
  assert.doesNotMatch(X.html({ dress: "Green" }, { full: true }), /Dress code/, "the full invite shows the dress code itself");
  assert.match(read("public/sections.js"), /font-size:16px/, "body text stays 16px");
});

test("The server keeps sections, links, an access note and co-hosts clean", () => {
  const e = publicExtras({ sections: [{ icon: "<x>", title: "a".repeat(200), body: "b" }, { title: "", body: "" }], links: [{ label: "x", url: "http://insecure.example" }, { label: "ok", url: "https://ok.example" }], cohosts: [{ handle: "@Jun-P", name: "" }, { name: "x@y.com" }], accessNote: " Ramp " });
  assert.equal(e.sections.length, 1); assert.equal(e.sections[0].icon, "note"); assert.equal(e.sections[0].title.length, 80);
  assert.deepEqual(e.links, [{ label: "ok", url: "https://ok.example" }]); assert.deepEqual(e.cohosts, [{ handle: "jun-p", name: "" }]); assert.equal(e.accessNote, "Ramp");
});

test("A saved event's sections reach a guest; the live preview is the real invite page", async () => {
  const id = "cnvev1", day = new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10);
  assert.equal((await fetch(srv.base + "/api/db/doc?path=events/" + id, { method: "PUT", headers: { ...J, cookie: host }, body: JSON.stringify({ name: "Dumpling night", pubTitle: "Dumpling night", casual: true, kind: "social", date: day, startTime: "19:00", published: true, discoverable: false, unlisted: true, venueAddr: "12 Elm St", sections: [{ icon: "star", title: "House rules", body: "Shoes off." }], accessNote: "Step-free" }) })).status, 200);
  const doc = await (await fetch(srv.base + "/api/db/doc?path=events/" + id, { headers: { "x-encore-guest": "1" } })).json();
  assert.deepEqual(doc.data.sections, [{ icon: "star", title: "House rules", body: "Shoes off." }]); assert.equal(doc.data.accessNote, "Step-free");
  const inv = await (await fetch(srv.base + "/e/" + id)).text(); assert.ok(inv.length < 40000, "the served invite stays small: " + inv.length); assert.match(inv, /\/sections\.js/);
  const pv = await fetch(srv.base + "/e/_preview"); assert.equal(pv.status, 200); assert.equal(pv.headers.get("cache-control"), "no-store");
  const pvh = await pv.text(); assert.match(pvh, /noindex/); assert.match(pvh, /invite-preview\.js/); assert.ok(pvh.length < 40000);
  const hc = await (await fetch(srv.base + "/api/host/invite-host", { headers: { cookie: host } })).json(); assert.equal(hc.host.name, "Ada Canvas"); assert.ok(hc.host.kit, "the brand kit comes with the host");
  assert.equal((await fetch(srv.base + "/api/host/invite-host")).status, 401);
});

test("Wiring: the light invite stays small, the preview is inert, and the app opens the canvas", () => {
  const inv = read("public/invite.html"); assert.ok(inv.length < 40000, String(inv.length));
  assert.match(inv, /id === "_preview"\) setTimeout\(\(\) => more\("\/invite-preview\.js"/);
  const pv = read("public/invite-preview.js"); assert.match(pv, /m\.origin === location\.origin/, "only the app's own frame feeds it"); assert.match(pv, /preventDefault\(\)/, "replies are off"); assert.match(pv, /Would you come\?/);
  const html = read("index.html");
  assert.match(html, /return window\.EventCanvas\.open\(\{mode:"new"\}\)/); assert.match(html, /useDraft:d=>\{ draft=d; step=1 \}/);
  assert.match(html.slice(html.lastIndexOf("\n<script")), /^\n<script>\n\/\/ ---- "Come with me\?"/, "the Come with me? loader stays last");
  assert.ok(html.indexOf('<script src="/canvas.js" defer></script>') < html.lastIndexOf("<script>"));
  const js = read("public/canvas.js");
  for (const w of ["Untitled event", "More to say?", "New section", "Who can find this event?", "Quick actions for hosts", "Add questions", "Reminders", "Require approval", "Guest view", "Preview as guest", "Only you see this part", "Guests see this page"]) assert.ok(js.includes(w), w);
  assert.match(js, /root\.ShareKit, H = root\.HostEvent; if \(K\?\.open\) K\.open\(d\); else if \(H\?\.openShare\)/, "the first save opens the share entry");
  assert.match(js, /PhotoSheet/, "the cover pencil opens the shared photo sheet"); assert.match(js, /\/api\/host\/club\/events\//, "fan club only goes through the fan club");
  assert.doesNotMatch(js + read("public/sections.js") + pv, /\u2014/, "no em dashes");
});
