// The visual feed: stories, media-first cards, the public feed, and who can add, see and hide photos from the day.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { momentKind, momentMaxBytes, videoSeconds, momentsPublic, momentsOnPage } from "../server/feedvisual.js";

let srv;
const J = { "content-type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (path, cookie) => fetch(srv.base + path, { headers: cookie ? { cookie } : {} });
const put = (path, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
// a tiny MP4 header: an mvhd box with a timescale of 1000 and the given length
const mp4 = (seconds, pad = 0) => { const b = Buffer.alloc(140 + pad); b.writeUInt32BE(32, 0); b.write("ftypisom", 4); b.writeUInt32BE(108, 32); b.write("mvhd", 36); b[40] = 0; b.writeUInt32BE(1000, 52); b.writeUInt32BE(Math.round(seconds * 1000), 56); return b; };
const join = async (name, email) => { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); const b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); return { cookie: cookieOf(r), ws: b.workspace.id }; };
const reply = (ws, id, data) => { srv.store.set(`ws/${ws}/rsvps/${id}`, { response: "going", createdAt: Date.now() - 5 * 864e5, ...data }); return id; };
const upload = (q, body = PNG, type = "image/png", cookie) => fetch(`${srv.base}/api/moments?${new URLSearchParams(q)}`, { method: "POST", headers: { "content-type": type, ...(cookie ? { cookie } : {}) }, body });
const S = {};

before(async () => {
  srv = await startServer();
  Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "fv-secret", ENCORE_SIGNUP_PER_HOUR: "200", ENCORE_FAKE_EMAIL: "1" }); resetLoginLimits();
  S.mai = await join("Mai Pham", "mai.fv@example.com");
  assert.ok((await post("/api/host/profile", { handle: "mai-fv", name: "Mai's supper club", tagline: "Small dinners for new friends.", city: "Brooklyn", emoji: "🍜" }, S.mai.cookie)).ok);
  // your stories (server/storyapprove.js): this host shows guests' photos and recaps without asking, as every host did before approvals
  assert.equal((await fetch(srv.base + "/api/me/stories/settings", { method: "POST", headers: { "content-type": "application/json", cookie: S.mai.cookie }, body: JSON.stringify({ guestsAuto: true }) })).status, 200);
  // an open supper (on Discover), an Ask to join one, a link-only one, all last week; and one coming up with a flyer look
  const base = { kind: "social", casual: true, city: "Brooklyn", activity: "dinner", date: day(-4) };
  for (const [id, extra] of [["fvOpen", { name: "Open supper", discoverable: true }], ["fvAsk", { name: "Ask supper", discoverable: true, approvalRequired: true }], ["fvLink", { name: "Link supper", discoverable: false, published: true }]])
    assert.equal((await put("events/" + id, { ...base, ...extra }, S.mai.cookie)).status, 200);
  assert.equal((await put("events/fvSoon", { ...base, name: "Winter supper", discoverable: true, date: day(5), look: { palette: ["#C4DDF3", "#1E4E86", "#D94357"], coverFit: "poster", coverW: 800, coverH: 1000, effect: "snow", buttonEmoji: "❄️" } }, S.mai.cookie)).status, 200);
  for (const id of ["fvOpen", "fvAsk", "fvLink"]) reply(S.mai.ws, "r" + id, { eventId: id, name: "Linh Tran", email: "linh.fv@example.com", code: "C" + id });
  reply(S.mai.ws, "rMaybe", { eventId: "fvOpen", name: "Maybe May", email: "may.fv@example.com", code: "CM", response: "maybe" });
  srv.app.locals.social.bust();
});
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "fv-secret"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL", "MOMENT_VIDEO_MAX_MB"]) delete process.env[k]; await srv.close(); });

test("Video type allow-list and size limit", async () => {
  assert.equal(momentKind("video/mp4"), "video"); assert.equal(momentKind("video/webm"), "video"); assert.equal(momentKind("video/quicktime"), "video");
  assert.equal(momentKind("image/jpeg"), "image"); assert.equal(momentKind("video/x-msvideo"), null); assert.equal(momentKind("image/svg+xml"), null); assert.equal(momentKind("text/html"), null);
  assert.equal(Math.round(videoSeconds(mp4(9.5)) * 10) / 10, 9.5);
  const q = { eventId: "fvOpen", rid: "rfvOpen", code: "CfvOpen" };
  for (const t of ["video/x-msvideo", "image/svg+xml", "text/html", "application/octet-stream"]) assert.equal((await upload(q, PNG, t)).status, 415, t);
  const ok = await upload(q, mp4(8), "video/mp4"); assert.equal(ok.status, 200, await ok.clone().text()); const okJ = await ok.json(); assert.equal(okJ.type, "video");
  // served with the same sandboxed headers as every upload
  const blob = await fetch(srv.base + okJ.url); assert.equal(blob.headers.get("content-type"), "video/mp4"); assert.match(blob.headers.get("content-security-policy"), /sandbox/); assert.equal(blob.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await upload(q, mp4(40), "video/mp4")).status, 400, "longer than 15 seconds");
  assert.equal((await upload({ ...q, duration: "31" }, mp4(0), "video/webm")).status, 400, "the browser said it's 31 seconds");
  process.env.MOMENT_VIDEO_MAX_MB = "0.01";
  assert.ok(momentMaxBytes("video") < 11000 && momentMaxBytes("image") > 1e6);
  const big = await upload(q, mp4(5, 20000), "video/mp4"); assert.equal(big.status, 413); assert.equal((await big.json()).code, "too_large");
  delete process.env.MOMENT_VIDEO_MAX_MB;
  // the poster frame goes on the video, from whoever added it
  const pst = await fetch(`${srv.base}/api/moments/${okJ.id}/poster?${new URLSearchParams(q)}`, { method: "POST", headers: { "content-type": "image/png" }, body: PNG });
  assert.equal(pst.status, 200, await pst.clone().text());
  assert.equal((await fetch(`${srv.base}/api/moments/${okJ.id}/poster?eventId=fvOpen&rid=rfvOpen&code=nope`, { method: "POST", headers: { "content-type": "image/png" }, body: PNG })).status, 403);
});

test("Guest moment upload requires reply proof", async () => {
  assert.equal((await upload({ eventId: "fvOpen" })).status, 403, "no proof");
  assert.equal((await upload({ eventId: "fvOpen", rid: "rfvOpen", code: "WRONG" })).status, 403, "wrong code");
  assert.equal((await upload({ eventId: "fvOpen", rid: "rMaybe", code: "CM" })).status, 403, "a Maybe wasn't there");
  assert.equal((await upload({ eventId: "fvAsk", rid: "rfvOpen", code: "CfvOpen" })).status, 403, "proof for another event");
  for (const id of ["fvOpen", "fvAsk", "fvLink"]) { const r = await upload({ eventId: id, rid: "r" + id, code: "C" + id, caption: "From " + id, w: "800", h: "1000" }); assert.equal(r.status, 200, await r.clone().text()); }
  const host = await upload({ eventId: "fvLink", caption: "Host photo" }, PNG, "image/png", S.mai.cookie); assert.equal(host.status, 200);
  // the event's page shows them to people who were there
  const wall = await (await get("/api/public/moments/fvOpen?rid=rfvOpen&code=CfvOpen")).json(); assert.ok(wall.moments.some((m) => m.caption === "From fvOpen" && m.id && m.w === 800));
  assert.equal((await (await get("/api/public/moments/fvOpen")).json()).locked, true);
});

test("Public feed only includes public media; Ask to join and link-only moments are not public", async () => {
  srv.app.locals.social.bust();
  assert.equal(momentsPublic({ discoverable: true }), true); assert.equal(momentsPublic({ discoverable: true, approvalRequired: true }), false); assert.equal(momentsPublic({ discoverable: false }), false);
  assert.equal(momentsPublic({ discoverable: true, unlisted: true }), false); assert.equal(momentsPublic({ discoverable: true, noPhotos: true }), false);
  assert.equal(momentsOnPage({ discoverable: false }), false); assert.equal(momentsOnPage({ discoverable: false, momentsOnPage: true }), true);
  const r = await get("/api/public/feed"); assert.equal(r.status, 200); const F = await r.json();
  const caps = [...F.moments.map((m) => m.caption), ...F.past.flatMap((p) => p.photos.map((x) => x.caption)), ...F.stories.flatMap((s) => s.items.map((i) => i.note || ""))];
  assert.ok(caps.includes("From fvOpen"), JSON.stringify(caps));
  for (const c of ["From fvAsk", "From fvLink", "Host photo"]) assert.ok(!caps.includes(c), c + " leaked: " + JSON.stringify(caps));
  assert.ok(!F.past.some((p) => p.id === "fvLink"), "a link-only event isn't a public card");
  const ask = F.past.find((p) => p.id === "fvAsk"); assert.ok(ask && ask.photos.length === 0, "an Ask to join card shows no guest photos");
  // the upcoming card carries its look (poster fit, palette) for the flyer
  const soon = F.upcoming.find((e) => e.id === "fvSoon"); assert.ok(soon); assert.equal(soon.look.coverFit, "poster"); assert.deepEqual(soon.look.palette, ["#C4DDF3", "#1E4E86", "#D94357"]); assert.equal(soon.url, "/g#rsvp-fvSoon");
  // showcase pages fill it out, with their shipped covers: recent ones on the wall, older ones as ideas below it (review 7)
  // owner decision: preview pages of businesses that haven't joined stay out of the feed; only made-up examples remain
  assert.ok(F.showcase.some((p) => !p.example), "previews are listed again by default (owner decision, Nov 2026)");
  // the host page shows open events' photos only, until the host allows the link-only ones
  const page = async () => (await (await get("/api/public/host/mai-fv")).json()).past;
  let P = await page(); assert.ok(P.find((e) => e.id === "fvOpen")?.photos?.length); assert.ok(!P.find((e) => e.title === "Link supper")?.photos?.length);
  assert.equal((await post("/api/host/moments/fvLink/settings", { onPage: true }, S.mai.cookie)).status, 200); srv.app.locals.social.bust();
  P = await page(); assert.ok(P.find((e) => e.title === "Link supper")?.photos?.length, "shown once the host allows it " + JSON.stringify(P.map((e) => [e.id, e.photos])));
  // still not on the public feed
  assert.ok(!(await (await get("/api/public/feed")).json()).moments.some((m) => m.caption === "Host photo"));
  // a signed-in stranger doesn't see them either; Linh, who was there, does
  const sam = await join("Sam Lee", "sam.fv@example.com"); const SF = await (await get("/api/me/feed", sam.cookie)).json();
  assert.ok(!JSON.stringify(SF.visual).includes("From fvAsk")); assert.ok(!JSON.stringify(SF.storiesV).includes("From fvLink"));
  const linh = await join("Linh Tran", "linh.fv@example.com"); const LF = await (await get("/api/public/feed", linh.cookie)).json();
  assert.ok(JSON.stringify(LF).includes("From fvAsk"), "Linh was at the Ask to join supper");
});

test("Host can hide a moment", async () => {
  const L = await (await get("/api/host/moments/fvOpen", S.mai.cookie)).json(); const m = L.moments.find((x) => x.caption === "From fvOpen"); assert.ok(m);
  assert.equal((await post(`/api/host/moments/fvOpen/${m.id}/hide`, { hidden: true })).status, 401, "signed out");
  const other = await join("Other Host", "other.fv@example.com"); assert.equal((await post(`/api/host/moments/fvOpen/${m.id}/hide`, { hidden: true }, other.cookie)).status, 404, "not their event");
  assert.equal((await post(`/api/host/moments/fvOpen/${m.id}/hide`, { hidden: true }, S.mai.cookie)).status, 200);
  const F = await (await get("/api/public/feed")).json(); assert.ok(!JSON.stringify(F).includes("From fvOpen"), "gone from the public feed");
  assert.ok(!(await (await get("/api/public/moments/fvOpen?rid=rfvOpen&code=CfvOpen")).json()).moments.some((x) => x.id === m.id), "gone from the photo wall");
  const H = await (await get("/api/host/moments/fvOpen", S.mai.cookie)).json(); assert.equal(H.moments.find((x) => x.id === m.id).hidden, true, "the host still sees it, hidden");
  assert.equal((await post(`/api/host/moments/fvOpen/${m.id}/hide`, { hidden: false }, S.mai.cookie)).status, 200); srv.app.locals.social.bust();
  assert.ok(JSON.stringify(await (await get("/api/public/feed")).json()).includes("From fvOpen"), "shown again");
});

test("Stories endpoint shape, reactions", async () => {
  srv.app.locals.social.bust();
  const r = await get("/api/feed/stories"); assert.equal(r.status, 200); const { stories } = await r.json();
  assert.ok(Array.isArray(stories) && stories.length);
  for (const s of stories) { assert.ok(s.key && s.host?.handle && s.host.name, JSON.stringify(s.host)); assert.equal(typeof s.thumb, "string"); assert.equal(typeof s.latestAt, "number"); assert.ok(s.items.length && s.items.length <= 10);
    for (const it of s.items) { assert.ok(it.id && ["image", "video", "art"].includes(it.type), JSON.stringify(it)); assert.equal(typeof it.caption, "string"); assert.ok(["I'm in", "Ask to join", "Order", "I'd go", "Book for your team", "I'm interested", "Follow"].includes(it.cta.label), it.cta.label); assert.match(it.cta.url, it.cta.label === "Follow" ? /^\/@/ : /^\/(e|x)\//); if (it.type !== "art") assert.match(it.url, /^\/(_blob|presets)\//); } }
  const mai = stories.find((s) => s.host.handle === "mai-fv"); assert.ok(mai, "Mai has photos this week");
  assert.ok(mai.items.some((i) => i.type === "video" && i.poster), "the video with its poster");
  assert.ok(mai.items.some((i) => i.cta.label === "I'm in" && i.cta.url === "/e/fvSoon" && i.id === "f:fvSoon"), "the upcoming flyer, to its light invite");
  assert.ok(mai.items.findIndex((i) => i.past) < mai.items.findIndex((i) => !i.past) || mai.items.every((i) => i.past), "oldest first");
  // reactions: one of each per device, toggled; past events only
  const a = await (await post("/api/feed/react", { eventId: "fvOpen", emoji: "🔥", device: "dev-abcdefgh" })).json(); assert.equal(a.counts["🔥"], 1); assert.deepEqual(a.mine, ["🔥"]);
  const b = await (await post("/api/feed/react", { eventId: "fvOpen", emoji: "🔥", device: "dev-abcdefgh" })).json(); assert.equal(b.counts["🔥"], 0);
  assert.equal((await post("/api/feed/react", { eventId: "fvOpen", emoji: "💩", device: "dev-abcdefgh" })).status, 400);
  assert.equal((await post("/api/feed/react", { eventId: "fvLink", emoji: "🔥", device: "dev-abcdefgh" })).status, 404, "not for a link-only event you weren't at");
  assert.equal((await post("/api/feed/react", { eventId: "fvSoon", emoji: "🔥", device: "dev-abcdefgh" })).status, 404, "not before it happens");
});
