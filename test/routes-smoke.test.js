// No broken pages: every user-facing page and the JSON APIs those pages call, signed out, as a signed-in host and as a
// signed-in guest (plus /moderation for an admin). Each page answers 200, or the redirect it means to send, and nothing
// answers 5xx. The world is seeded by test/routes-seed.js; scripts/crawl-pages.mjs loads the same pages in a browser.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { seedRoutes, pagesFor } from "./routes-seed.js";

let srv, S;
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "routes-smoke-0123456789abcdef", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_SMS: "1", ENCORE_FAKE_PUSH: "1", ENCORE_ADMIN_EMAILS: "admin@example.com", ENCORE_SIGNUP_PER_HOUR: "500" };
before(async () => { Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer(); S = await seedRoutes(srv.base); });
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

const roles = () => ({ out: "", host: S.host.cookie, guest: S.guest.cookie });
const get = (p, cookie) => fetch(srv.base + p, { redirect: "manual", headers: cookie ? { cookie } : {} });
// the redirects pages mean to send: a signed-in person opening / lands on the feed; /pricing is part of /about; the private pages send a signed-out
// person to sign in (and back after); an invite link opens the guest page.
const REDIRECTS = { "/start?t=table": { host: /^\/\?app=1&new=1&kind=table#studio$/, guest: /^\/\?app=1&new=1&kind=table#studio$/ }, // signed in, /start goes straight to the create canvas
  "/": { host: /^\/feed$/, guest: /^\/feed$/ }, "/pricing": { any: /^\/about$/ }, [`/i/${"rtOpen"}`]: { any: /^\/(e\/rtOpen|g)\b/ } };
const PRIVATE = ["/saved", "/plans", "/chats", "/chats/rtOpen", "/settings", "/?app=1"];

test("every page answers 200 (or its redirect), signed out, as a host and as a guest", async () => {
  const bad = [];
  for (const [role, cookie] of Object.entries(roles())) for (const P of pagesFor(S)) {
    if (P.as) continue;
    const r = await get(P.path, cookie), loc = r.headers.get("location") || "";
    const want = REDIRECTS[P.path]?.[role] || REDIRECTS[P.path]?.any;
    if (P.status) { if (r.status !== P.status) bad.push(`${role} ${P.path}: ${r.status}, wanted ${P.status}`); continue; }
    if (r.status >= 300 && r.status < 400) {
      const toLogin = role === "out" && PRIVATE.includes(P.path) && /^\/(login|signup)\b/.test(loc);
      if (!(want && want.test(loc)) && !toLogin) bad.push(`${role} ${P.path}: ${r.status} to ${loc}`);
      continue;
    }
    if (r.status !== 200) bad.push(`${role} ${P.path}: ${r.status}`);
    else { const t = await r.text(); if (!/<html|<!doctype/i.test(t) || t.length < 500) bad.push(`${role} ${P.path}: thin page (${t.length})`); if (/Internal Server Error|at [\w.]+ \(\/.+\.js:\d+/i.test(t)) bad.push(`${role} ${P.path}: a stack trace`); }
  }
  assert.deepEqual(bad, []);
});

test("moderation opens for the admin and is a plain 404 for everyone else", async () => {
  assert.equal((await get("/moderation", S.admin.cookie)).status, 200);
  for (const c of ["", S.host.cookie, S.guest.cookie]) assert.equal((await get("/moderation", c)).status, 404);
  assert.equal((await get("/api/admin/reports?status=open", S.admin.cookie)).status, 200);
});

// the JSON APIs the pages call on load (from scripts/crawl-pages.mjs --apis), with the roles each answers 200 for.
// RO / RP stand for the guest's reply proof on the open / past event; every role must at least not get a 5xx.
const APIS = `
/api/signup/config|out host guest
/api/help/info|out host guest
/api/public/feed|out
/api/public/discover|out host guest
/api/public/inspo?interests=&city=&tag=&cursor=&limit=18|out host guest
/api/public/inspo?limit=12|out host guest
/api/public/suggest/hosts?limit=8|out host guest
/api/public/hosts/showcase|out host guest
/api/public/shops|out host guest
/api/public/roundtables|out host guest
/api/public/legal|out host guest
/api/public/policy|out host guest
/api/public/safety|out host guest
/api/public/deck?city=|out guest
/api/public/deck?city=Brooklyn|host
/api/public/leaderboard/card?city=|out
/api/public/host/mai-routes|out host guest
/api/public/host/mai-routes/badges|out host guest
/api/public/host/mai-routes/rank|out host guest
/api/public/host/mai-routes/recap?year=${new Date().getFullYear()}|out host guest
/api/public/host/mai-routes/scrapbook|out guest
/api/public/host/mai-routes/series|out host guest
/api/public/host/mai-routes/trust|out host guest
/api/public/profile/mai-routes|out host guest
/api/public/shop/mai-routes|out host guest
/api/public/collabs/mai-routes|out host guest
/api/public/event-host/rtOpen|out host guest
/api/public/event-host/rtPast|out host guest
/api/public/episode/rtOpen|out host guest
/api/public/episode/rtPast|out host guest
/api/public/attendees/rtOpen|out host guest
/api/public/attendees/rtPast|out host guest
/api/public/lineup/rtOpen|out host
/api/public/lineup/rtOpen?RO|guest
/api/public/lineup/rtPast?RP|guest
/api/public/table/rtOpen|out host
/api/public/table/rtOpen?RO|guest
/api/public/table/rtPast?RP|guest
/api/public/quiet/rtOpen|out host
/api/public/quiet/rtOpen?RO|guest
/api/public/quiet/rtPast?RP|guest
/api/public/like/rtPast|out host
/api/public/moments/rtPast?RP|out host guest
/api/public/photo-drop/rtPast?RP|out host guest
/api/public/kudos-page/rtPast?RP|out host guest
/api/public/kudos-more/rtPast?RP|out host guest
/api/public/again/rtPast?RP|out host guest
/api/public/reply/rtOpen?RO|guest
/api/public/reply/rtPast?RP|guest
/api/public/rsvp-status/rtOpen?RO|guest
/api/public/rsvp-status/rtPast?RP|guest
/api/public/regular/rtPast?RP|guest
/api/public/address/rtOpen?RO|guest
/api/public/cards?ids=rtPast%2CrtOpen|guest
/api/public/faq/rtOpen|host
/api/chats/rtOpen?RO&read=1|guest
/api/db/doc?path=events%2FrtOpen|out host guest
/api/db/doc?path=events%2FrtPast|out host guest
/api/v1/events?status=upcoming&limit=24|out host guest
/api/v1/formats?status=all|out host guest
/api/v1/hosts?limit=100|out host guest
/api/v1/leaderboard/rules|out host guest
/api/v1/leaderboard?period=month&city=|out host guest
/api/v1/leaderboard?city=Brooklyn&category=all|host
/api/me|host guest
/api/me/feed|host guest
/api/me/saves|host guest
/api/me/inbox|host guest
/api/me/interests|host guest
/api/me/passport|host guest
/api/me/plans|host guest
/api/me/prefs|host guest
/api/me/push|host guest
/api/me/requests|host guest
/api/me/rsvp-profile|host guest
/api/me/sidebar|host guest
/api/me/alerts|host guest
/api/me/friends|host guest
/api/public/places|out host guest
/api/me/blocks|host guest
/api/me/friends-going?ids=rtOpen|host guest
/api/me/mutuals/rtPast|host guest
/api/workspace|host guest
/api/brand|host guest
/api/codes|host guest
/api/collabs|host guest
/api/email/status|host guest
/api/help/tickets|host guest
/api/host/profile|host guest
/api/host/bookings|host guest
/api/host/discover-status|host guest
/api/host/interest|host guest
/api/host/nudges|host guest
/api/host/orders|host guest
/api/host/second-rsvp|host guest
/api/host/brandkit|host
/api/host/scrapbook|host
/api/host/faq/rtOpen|host
/api/host/kudos-nudge/rtPast|host
/api/me/rsvp/rtOpen|host
/api/signoff?eventId=rtOpen|host
/api/db/collection?path=events|host guest
/api/db/collection?path=rsvps|host guest
/api/db/collection?path=kudos|host guest
/api/db/doc?path=events/rtOpen|host
/api/photos/recent|host guest
/api/public/photos/templates?kind=cover|out host guest
/api/public/photos/templates?kind=avatar|out host guest
/api/photos/mine|host guest
`.trim().split("\n").map((l) => { const [p, r] = l.split("|"); return { p, roles: r.split(" ") }; });

test("the APIs the pages call answer 200 for the people they serve, and never 5xx for anyone", async () => {
  const q = (x) => `rid=${encodeURIComponent(x.rid)}&code=${encodeURIComponent(x.code)}`, bad = [];
  for (const A of APIS) for (const [role, cookie] of Object.entries(roles())) {
    const p = A.p.replace("?RO", "?" + q(S.openRid)).replace("?RP", "?" + q(S.pastRid));
    // the guest page reads the event doc as a guest, the way public/invite.html does
    const r = /^\/api\/db\/doc\?path=events%2F/.test(p) ? await fetch(srv.base + p, { headers: { "x-encore-guest": "1", ...(cookie ? { cookie } : {}) } }) : await get(p, cookie);
    if (r.status >= 500) bad.push(`${role} ${A.p}: ${r.status}`);
    else if (A.roles.includes(role) && r.status !== 200) bad.push(`${role} ${A.p}: ${r.status}`);
    else if (A.roles.includes(role) && /json/.test(r.headers.get("content-type") || "")) { try { await r.json(); } catch { bad.push(`${role} ${A.p}: not JSON`); } }
  }
  assert.deepEqual(bad, []);
});
