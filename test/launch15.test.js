// Launch-readiness review (round 15) fixes: preview pages stay out of the feed, stories, deck and lists, and say
// "Preview, not on Pottery Lab yet" on their own pages; "in Greenpoint" is a neighborhood, not a city, and near-you
// matching takes the hood, the city or the host's city; pages without a tab bar have a way back.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { previewListed, PREVIEW_LABEL } from "../server/community.js";

const PREVIEWS = ["atbo", "tram", "ken", "le-phin", "anhdraws"];
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const cut = (from, to) => { const a = html.indexOf(from); assert.ok(a > 0, "missing " + from); const b = html.indexOf(to, a); assert.ok(b > a, "missing " + to); return html.slice(a, b); };
let srv, host;
const J = { "content-type": "application/json" };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
before(async () => { Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "launch15-secret-0123456789abcdef", ENCORE_FAKE_EMAIL: "1" }); delete process.env.ENCORE_FEED_PREVIEWS; resetLoginLimits(); srv = await startServer();
  const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name: "Gia Host", email: "gia.l15@example.com", password: "long-password-1", mode: "friends" }) }); host = r.headers.get("set-cookie").split(";")[0];
  await fetch(srv.base + "/api/host/profile", { method: "POST", headers: { ...J, cookie: host }, body: JSON.stringify({ handle: "gia-l15", name: "Gia's Supper", city: "Brooklyn", tagline: "Suppers for eight.", emoji: "🍲" }) });
  await fetch(srv.base + "/api/db/doc?path=events/l15gp", { method: "PUT", headers: { ...J, cookie: host }, body: JSON.stringify({ name: "Supper in Greenpoint", casual: true, kind: "social", activity: "dinner", hood: "Greenpoint", city: "", date: day(4), startTime: "19:00", published: true, discoverable: true, unlisted: false }) });
});
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_FAKE_EMAIL", "ENCORE_FEED_PREVIEWS"]) delete process.env[k]; await srv.close(); });

const text = async (p) => JSON.stringify(await (await fetch(srv.base + p)).json());

test("previews never appear in the feed, stories, deck, Discover or the hosts list by default", async () => {
  for (const p of ["/api/public/feed", "/api/public/deck?city=", "/api/public/deck?city=Brooklyn", "/api/feed/stories", "/api/public/discover", "/api/public/hosts", "/api/v1/hosts?limit=100"]) {
    const t = await text(p); for (const h of PREVIEWS) assert.doesNotMatch(t, new RegExp(`"(handle|ref)":"${h}"`), `${h} is not in ${p}`);
    assert.doesNotMatch(t, /From a host's page/, p);
  }
  assert.equal(previewListed("tram", {}), false); assert.equal(previewListed("sweetpea-sorrel", { example: true }), true, "made-up examples can stay");
});

test("ENCORE_FEED_PREVIEWS lets the ones with consent back in", async () => {
  process.env.ENCORE_FEED_PREVIEWS = "tram, @ken";
  try { assert.equal(previewListed("tram", {}), true); assert.equal(previewListed("ken", {}), true); assert.equal(previewListed("atbo", {}), false); }
  finally { delete process.env.ENCORE_FEED_PREVIEWS; }
});

test("preview pages are labelled at the top, at /@handle and /x/...", async () => {
  for (const h of ["atbo", "tram"]) {
    const page = await (await fetch(srv.base + "/@" + h)).text(); assert.equal((page.match(/data-preview>([^<]+)</) || [])[1], PREVIEW_LABEL, h);
    assert.ok(page.indexOf("data-preview") < page.indexOf("<main") || page.indexOf("<main") < 0, "at the top");
  }
  assert.equal(PREVIEW_LABEL, "Preview, not on Pottery Lab yet");
  const x = await fetch(srv.base + "/x/tram/any", { redirect: "manual" }); if (x.status === 200) assert.match(await x.text(), /Preview, not on Pottery Lab yet/);
  // a real host's page has no such label
  assert.doesNotMatch(await (await fetch(srv.base + "/@gia-l15")).text(), /data-preview/);
});

test("the deck leads with real local events: a Greenpoint event of a Brooklyn host is near Brooklyn", async () => {
  const d = await (await fetch(srv.base + "/api/public/deck?city=Brooklyn")).json();
  assert.equal(d.cards[0]?.ref, "l15gp", "the real local event comes first"); assert.equal(d.cards[0].local, true);
  assert.ok(d.cards.every((c) => c.kind !== "host"), "no old photos from preview pages");
});

test('"for 8 people in Greenpoint" is a hood; the city stays the host\'s', () => {
  const ctx = { window: { __wsPersonal: true, __homeCity: "Brooklyn" }, console }; vm.createContext(ctx);
  vm.runInContext([cut("function parseMoney", "function cloneForReuse"), cut("const CONF_CAL=", "function quickStart(")].join("\n") + "\nthis.parseEventText=parseEventText;", ctx);
  const o = ctx.parseEventText("Dinner for 8 people in Greenpoint on Friday at 7pm");
  assert.equal(o.hood, "Greenpoint"); assert.notEqual(o.city, "Greenpoint");
  assert.equal(ctx.parseEventText("Dinner for 8 in Brooklyn").city, "Brooklyn", "a known city stays a city");
  assert.equal(ctx.parseEventText("Picnic for 6 in Williamsburg").hood, "Williamsburg"); assert.equal(ctx.parseEventText("Picnic for 6 in Chicago").city, "Chicago");
  assert.match(html, /if\(o\.hood\)\{ d\.hood=o\.hood; if\(!o\.city&&typeof window!=="undefined"&&window\.__homeCity\) d\.city=window\.__homeCity \}/, "quickStart keeps the host's city");
});

test("pages without a tab bar have a way back, and iOS can swipe back", () => {
  for (const f of ["settings.html", "community-rules.html", "privacy.html", "terms.html"]) assert.match(fs.readFileSync(new URL("../public/" + f, import.meta.url), "utf8"), /<script src="\/backbar\.js"><\/script>/, f);
  assert.match(fs.readFileSync(new URL("../public/native.js", import.meta.url), "utf8"), /touchend[\s\S]*history\.back\(\)/);
  assert.match(fs.readFileSync(new URL("../mobile/native-config/ios/MainViewController.swift", import.meta.url), "utf8"), /allowsBackForwardNavigationGestures = true/);
});

test("the feed says tonight for today's event, not tomorrow", () => {
  const src = fs.readFileSync(new URL("../public/feedvisual.js", import.meta.url), "utf8"), m = src.match(/const dayWord = \(d\) => \{[^\n]*?\};/);
  assert.ok(m, "dayWord is there"); const dayWord = vm.runInNewContext(m[0].replace(/^const dayWord = /, "(").replace(/;$/, ")"), { Date, Math });
  const iso = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
  assert.equal(dayWord(iso(0)), "tonight"); assert.equal(dayWord(iso(1)), "tomorrow"); assert.match(dayWord(iso(3)), /^on /);
});
