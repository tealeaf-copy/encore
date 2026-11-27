// Potto fills in the reply form from what you told us before (server/replyfill.js, public/replyfill.js): only your own
// data (your account, your saved reply details, your own past replies by email or by this browser's reply proofs), only
// the fields the event's form asks for, nothing when the setting is off, nothing for the event's host, and Forget works.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { keyOf, sensitive } from "../server/replyfill.js";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const J = { "content-type": "application/json" };
let srv, host, sam, hana;
const signup = async (name, email) => { const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name, email, password: "long-password-1", mode: "friends" }) }); assert.equal(r.status, 200); return { cookie: r.headers.get("set-cookie").split(";")[0], email, name }; };
const put = (id, body) => fetch(srv.base + "/api/db/doc?path=events/" + id, { method: "PUT", headers: { ...J, cookie: host.cookie }, body: JSON.stringify(body) });
async function reply(eventId, key, who, extra = {}) { const doc = await (await fetch(srv.base + "/api/db/doc?path=events/" + eventId, { headers: { "x-encore-guest": "1" } })).json(), code = "C" + key.slice(-5).toUpperCase();
  const r = await fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, "x-encore-guest": "1", "x-encore-key": key, "x-encore-workspace": doc.workspace, ...(who.cookie ? { cookie: who.cookie } : {}) }, body: JSON.stringify({ eventId, response: "going", name: who.name, email: who.email, code, createdAt: Date.now(), via: "invite-lite", ...extra }) });
  const j = await r.json(); assert.ok(r.ok, JSON.stringify(j)); return { id: eventId, rid: String(j.id || "").split("/").pop(), code }; }
const defaults = async (eventId, { cookie, proofs, local } = {}) => { const r = await fetch(srv.base + "/api/me/reply-defaults?eventId=" + eventId, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ eventId, proofs, local }) });
  assert.equal(r.headers.get("cache-control"), "private, no-store"); return r.json(); };
const val = (D, field) => D.fields.find((f) => f.field === field)?.value;
const ev = (o) => ({ kind: "social", casual: true, published: true, hostName: "Madison", date: day(6), startTime: "19:00", city: "Brooklyn", ...o });
let samDinner;

before(async () => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "replyfill-secret-0123456789"; process.env.ENCORE_FAKE_EMAIL = "1"; resetLoginLimits(); srv = await startServer();
  host = await signup("Madison Lee", "madison.rf@example.com"); sam = await signup("Sam Ortiz", "sam.rf@example.com"); hana = await signup("Hana Kim", "hana.rf@example.com");
  assert.ok((await put("rfDinner", ev({ name: "Dumpling dinner", questions: [{ id: "s1", q: "A song for the playlist?", type: "short" }, { id: "p1", q: "Bringing someone? Their name, please.", type: "short" }] }))).ok);
  assert.ok((await put("rfRun", ev({ name: "Run club", date: day(9), questions: [{ id: "x9", q: "Song for the playlist", type: "short" }, { id: "t1", q: "Favourite colour?", type: "short" }] }))).ok);
  assert.ok((await put("rfSupper", ev({ name: "Supper club", date: day(12), questions: [{ id: "a1", q: "Any allergies?", type: "short" }] }))).ok);
  samDinner = await reply("rfDinner", "ksamdinner1", sam, { dietary: "Vegetarian", phone: "917 555 0142", answers: { s1: "Dancing Queen", p1: "Jo" } });
  await reply("rfDinner", "khanadinner", hana, { dietary: "Nut allergy", answers: { s1: "Hana's secret song", p1: "Mina" } }); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv?.close(); });

test("keys: the same question in other words matches; health-like answers are marked sensitive", () => {
  assert.equal(keyOf("A song for the playlist?"), keyOf("Song for the playlist")); assert.equal(keyOf("Any allergies?"), "dietary"); assert.equal(keyOf("Who is your plus one?"), "plusone");
  assert.equal(keyOf("T-shirt size?"), "tshirt"); assert.equal(keyOf("x", "instagram"), "instagram"); assert.equal(keyOf("Favourite colour?"), "q:favourite colour");
  assert.equal(sensitive("dietary"), true); assert.equal(sensitive("q:any medical conditions", "Any medical conditions?"), true); assert.equal(sensitive("song", "A song?"), false);
});

test("signed in: only your own answers, only the fields this form asks for, each with where it came from", async () => {
  const D = await defaults("rfRun", { cookie: sam.cookie }); assert.equal(D.on, true);
  assert.equal(val(D, "q:x9"), "Dancing Queen"); assert.match(D.fields.find((f) => f.field === "q:x9").source, /^from your reply to Dumpling dinner in [A-Z][a-z]{2}$/);
  assert.equal(val(D, "name"), "Sam Ortiz"); assert.equal(val(D, "phone"), "917 555 0142");
  assert.equal(val(D, "dietary"), undefined, "a run doesn't ask what you eat"); assert.equal(val(D, "q:t1"), undefined, "never asked before");
  assert.ok(!JSON.stringify(D).includes("Hana") && !JSON.stringify(D).includes("Mina") && !JSON.stringify(D).includes("Nut allergy"), "never anyone else's");
  const S = await defaults("rfSupper", { cookie: sam.cookie }); assert.equal(val(S, "q:a1"), "Vegetarian", "allergies, from Sam's own dietary answer"); assert.equal(val(S, "dietary"), "Vegetarian");
  assert.equal(S.fields.find((f) => f.field === "q:a1").sensitive, true);
  const H = await defaults("rfSupper", { cookie: hana.cookie }); assert.equal(val(H, "dietary"), "Nut allergy"); assert.ok(!JSON.stringify(H).includes("Vegetarian"));
});

test("signed out: the browser's own reply proofs work; a wrong code or no proof gets nothing", async () => {
  const D = await defaults("rfRun", { proofs: [samDinner] }); assert.equal(val(D, "q:x9"), "Dancing Queen"); assert.equal(val(D, "name"), "Sam Ortiz");
  const W = await defaults("rfRun", { proofs: [{ ...samDinner, code: "CWRONG" }] }); assert.deepEqual(W.fields, []);
  assert.deepEqual((await defaults("rfRun", {})).fields, []);
  const L = await defaults("rfRun", { local: { answers: { song: { q: "A song?", a: "Local tune" } } } }); assert.equal(val(L, "q:x9"), "Local tune", "this device's own saved answers");
});

test("the host's own event stays empty, the preview stays empty, and the switch off returns nothing", async () => {
  await reply("rfRun", "khostrunrun", host, { answers: { x9: "Host song" } });
  assert.deepEqual((await defaults("rfDinner", { cookie: host.cookie })).fields, [], "the host looking at their own invite");
  assert.deepEqual((await defaults("_preview", { cookie: sam.cookie })).fields, []);
  const off = await fetch(srv.base + "/api/me/reply-details", { method: "POST", headers: { ...J, cookie: sam.cookie }, body: JSON.stringify({ on: false }) }); assert.equal((await off.json()).on, false);
  assert.deepEqual(await defaults("rfRun", { cookie: sam.cookie }), { on: false, fields: [] });
  await fetch(srv.base + "/api/me/reply-details", { method: "POST", headers: { ...J, cookie: sam.cookie }, body: JSON.stringify({ on: true }) });
});

test("saved reply details: save for next time, they win over past replies, and Forget removes them", async () => {
  const post = (b) => fetch(srv.base + "/api/me/reply-details", { method: "POST", headers: { ...J, cookie: sam.cookie }, body: JSON.stringify(b) }).then((r) => r.json());
  let V = await post({ save: [{ q: "Song for the playlist", a: "September" }, { key: "plusone", q: "Bringing someone?", a: "Alex" }] });
  assert.ok(V.answers.some((a) => a.key === "song" && a.a === "September"));
  const D = await defaults("rfDinner", { cookie: sam.cookie }); assert.equal(val(D, "q:s1"), "September"); assert.equal(D.fields.find((f) => f.field === "q:s1").source, "from your saved details"); assert.equal(val(D, "q:p1"), "Alex");
  V = await post({ forget: "answer:song" }); assert.ok(!V.answers.some((a) => a.key === "song"));
  assert.equal(val(await defaults("rfRun", { cookie: sam.cookie }), "q:x9"), "Dancing Queen", "back to the last reply once the saved one is forgotten");
  await fetch(srv.base + "/api/me/rsvp-profile", { method: "POST", headers: { ...J, cookie: sam.cookie }, body: JSON.stringify({ name: "Sam Ortiz", dietary: "Vegan" }) });
  assert.equal(val(await defaults("rfSupper", { cookie: sam.cookie }), "dietary"), "Vegan");
  V = await post({ forget: "dietary" }); assert.equal(V.profile.dietary, "");
  const G = await fetch(srv.base + "/api/me/reply-details", { headers: { cookie: sam.cookie } }); assert.equal(G.headers.get("cache-control"), "private, no-store"); assert.equal((await G.json()).on, true);
  assert.equal((await fetch(srv.base + "/api/me/reply-details")).status, 401);
});

test("the page side: Potto's line, Clear, autocomplete kept, no autofill tint, never in the preview, a Settings switch", () => {
  const js = read("public/replyfill.js");
  assert.match(js, /Potto filled in what you told us last time\. Change anything\./); assert.match(js, /data-rfclear>Clear</); assert.match(js, /Save these for next time\?/);
  assert.match(js, /classList\.contains\("pv"\) \|\| eventId\(\) === "_preview"/); assert.match(js, /-webkit-autofill/); assert.doesNotMatch(js, /\.submit\(|requestSubmit|#send"\)\.click|g-send"\)\.click/, "never sends for you");
  assert.match(read("public/invite.html"), /<script src="\/replyfill\.js" defer><\/script>/); assert.match(read("index.html"), /<script src="\/replyfill\.js" defer><\/script>/);
  const st = read("public/settings.html"), rd = read("public/replydetails.js"); assert.match(st, /id="replyDetails"/); assert.match(rd, /Fill in my replies from what I've told you before/); assert.match(rd, /Saved reply details/); assert.match(rd, /Forget this/);
  for (const s of [js, rd]) { assert.doesNotMatch(s, /—/); assert.doesNotMatch(s.replace(/\\u[0-9a-f]{4}/gi, ""), /\p{Extended_Pictographic}/u); }
  assert.ok(read("public/invite.html").length < 40000);
});

test("in a browser: a signed-out guest with a past reply gets a quietly filled form, and Clear empties it", async (t) => {
  let chromium; try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch { return t.skip("no playwright"); }
  let br; try { br = await chromium.launch(); } catch { return t.skip("no browser"); }
  try { const p = await br.newPage({ viewport: { width: 390, height: 844 } }); await p.route(/fonts\.(googleapis|gstatic)\.com/, (x) => x.abort());
    await p.goto(srv.base + "/e/rfRun"); await p.evaluate((m) => localStorage.setItem("encore-rsvp-rfDinner", JSON.stringify({ rid: m.rid, code: m.code, eventId: "rfDinner", response: "going" })), samDinner);
    await p.reload(); await p.waitForSelector("#rfNote", { timeout: 8000 });
    assert.equal(await p.inputValue("#nm"), "Sam Ortiz"); assert.equal(await p.inputValue("#qs .tf-a input"), "Dancing Queen");
    assert.match(await p.textContent("#rfNote"), /Potto filled in what you told us last time\. Change anything\./);
    assert.equal(await p.getAttribute("#nm", "autocomplete"), "name"); assert.equal(await p.evaluate(() => !!localStorage.getItem("encore-rsvp-rfRun")), false, "nothing sent");
    await p.click("#rfNote [data-rfclear]"); assert.equal(await p.inputValue("#nm"), ""); assert.equal(await p.inputValue("#qs .tf-a input"), "");
  } finally { await br.close(); }
});
