import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { fakeTexts } from "../server/sms.js";
import { fakeOutbox } from "../server/email.js";
import { scopeStore } from "../server/workspaces.js";
import { parseMaterial, answersToDrafts, emlToText, pdfText, keepOnlyStatedPrices, normalizeDrafts, suggestPage, makeDrafts, privateAddress } from "../server/onboard.js";
import { runPottoReminders, isQuiet, localParts, pottoMessage } from "../server/reminders.js";

let srv;
const J = { "content-type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (path, cookie) => fetch(srv.base + path, { headers: cookie ? { cookie } : {}, redirect: "manual" });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
const ENV = ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_SMS", "ENCORE_FAKE_EMAIL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
let n = 0;
async function host(extra = {}) { n++; const r = await post("/api/signup", { name: `Lan Owner${n}`, email: `lan.owner${n}@lephin.example`, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200); const c = cookieOf(r);
  if (extra.handle) assert.equal((await post("/api/host/profile", { handle: extra.handle, name: extra.name || "Lê Phin", forHire: true, ...(extra.experiences ? { experiences: extra.experiences } : {}) }, c)).status, 200);
  const ws = (await (await get("/api/workspace", c)).json()).id; return { c, ws }; }

before(async () => { srv = await startServer(); });
beforeEach(() => { Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "onboard-secret-0123456789abcdef", ENCORE_SIGNUP_PER_HOUR: "100", ENCORE_FAKE_SMS: "1", ENCORE_FAKE_EMAIL: "1" }); delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET; resetLoginLimits(); });
after(async () => { for (const k of ENV) delete process.env[k]; await srv.close(); });

const SHEET = `Le Phin Coffee - Catering & Gifts

Phin coffee bar: $12 a person
Our baristas bring a row of phins to your launch or office day. 40 to 300 people, 3 hours.
- Two baristas and the phin bar
- Cups with your printed sleeve
-1:00 Set up the phin bar
0:00 First pour
We travel anywhere in Manhattan.

Phin brewing class - $55 per person
Groups of 8-25, 75 minutes.

Engraved phin gift set - $45 each
Minimum order 20. 50+ $40, 200+ $35. 3 weeks lead time.
Ships anywhere in the US.
- Your logo on the phin`;

test("the offline parser reads a price sheet into experiences and gift sets, with only the host's own facts", () => {
  const D = parseMaterial(SHEET, "price sheet");
  assert.deepEqual(D.experiences.map((x) => x.name), ["Phin coffee bar", "Phin brewing class"]);
  const [bar, cls] = D.experiences;
  assert.equal(bar.price, "$12 a person"); assert.equal(bar.min, 40); assert.equal(bar.max, 300); assert.equal(bar.length, "3 hours"); assert.equal(bar.travels, true);
  assert.deepEqual(bar.includes, ["Two baristas and the phin bar", "Cups with your printed sleeve"]); assert.deepEqual(bar.runOfShow, ["-1:00 Set up the phin bar", "0:00 First pour"]);
  assert.equal(cls.price, "$55 a person"); assert.equal(cls.min, 8); assert.equal(cls.max, 25); assert.equal(cls.length, "75 minutes"); assert.equal(cls.category, "workshop");
  const [g] = D.gifts; assert.equal(g.name, "Engraved phin gift set"); assert.equal(g.cents, 4500); assert.equal(g.minQty, 20); assert.deepEqual(g.tiers, [{ qty: 50, cents: 4000 }, { qty: 200, cents: 3500 }]); assert.equal(g.lead, "3 weeks"); assert.match(g.ships, /anywhere in the US/); assert.deepEqual(g.personalize, ["Your logo on the phin"]);
  assert.equal(D.experiences.length + D.gifts.length, 3, "the title line is not a package");
});

test("past emails: headers, quoted replies and greetings are dropped; the quote becomes a draft that asks for what's missing", () => {
  const eml = "From: Lan <lan@lephin.example>\nTo: Sam <sam@northwind.example>\nSubject: Re: Quote for coffee bar at Northwind launch\nContent-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: quoted-printable\n\nHi Sam,\n\nThanks for reaching out! For 120 people the iced coffee bar is $14 a person, for 3 hours, and we need 2 weeks notice.\n\nBest,\nLan\n\n> On Mon, Sam wrote:\n> can you do $9?\n";
  assert.doesNotMatch(emlToText(eml), /can you do|From:/);
  const D = parseMaterial(eml, "email");
  assert.equal(D.experiences.length, 1); const x = D.experiences[0];
  assert.equal(x.name, "Iced coffee bar"); assert.equal(x.price, "$14 a person"); assert.equal(x.length, "3 hours"); assert.ok(x._missing.includes("size"), "a one-off headcount is flagged for the host to check"); assert.equal(x.desc, "Book 2 weeks ahead.");
  const mp = "Subject: Prices\nContent-Type: multipart/alternative; boundary=\"b1\"\n\n--b1\nContent-Type: text/html\n\n<p>Phin class: $55 a person, 75 minutes</p>\n--b1--\n";
  assert.match(emlToText(mp), /Phin class: \$55 a person/);
});

test("answers to Potto's questions become drafts, prices matched by name; Claude's prices are kept only when the host wrote them", async () => {
  const D = answersToDrafts({ sell: "Vietnamese coffee in the East Village.", asks: "coffee bars at launches, brewing classes for teams, and gift boxes", prices: "coffee bar $12 a person, class $55 a person, gift boxes $45 each", groups: "40 to 300 people", lead: "3 weeks", travel: "Manhattan and Brooklyn" });
  assert.deepEqual(D.experiences.map((x) => [x.name, x.price, x.min, x.max, x.travels]), [["Coffee bars at launches", "$12 a person", 40, 300, true], ["Brewing classes for teams", "$55 a person", 40, 300, true]]);
  assert.deepEqual(D.gifts.map((x) => [x.name, x.cents, x.lead]), [["Gift boxes", 4500, "3 weeks"]]);
  const M = await makeDrafts({ answers: { asks: "a matcha bar" }, material: [] }); assert.equal(M.source, "parser"); assert.equal(M.experiences[0].price, ""); assert.ok(M.experiences[0]._missing.includes("price"), "no price said, none invented");
  const K = keepOnlyStatedPrices(normalizeDrafts({ experiences: [{ name: "Bar", price: "$99 a person" }, { name: "Class", price: "$55 a person" }], gifts: [{ name: "Box", cents: 7700, tiers: [{ qty: 50, cents: 4000 }] }] }), "class $55 a person, 50+ $40");
  assert.equal(K.experiences[0].price, ""); assert.equal(K.experiences[1].price, "$55 a person"); assert.equal(K.gifts[0].cents, 0); assert.deepEqual(K.gifts[0].tiers, [{ qty: 50, cents: 4000 }]);
  const P = suggestPage({ host: { hood: "East Village" }, answers: { sell: "We make Vietnamese coffee, dripped slow through a phin." }, drafts: D });
  assert.equal(P.tagline, "Vietnamese coffee, dripped slow through a phin. East Village."); assert.equal(P.accent, "#C2553A"); assert.match(P.bio, /^We make Vietnamese coffee/);
  assert.equal(privateAddress("10.1.2.3"), true); assert.equal(privateAddress("169.254.169.254"), true); assert.equal(privateAddress("::1"), true); assert.equal(privateAddress("8.8.8.8"), false);
});

// a small PDF with a compressed content stream and a ToUnicode map, like the ones design tools export
function samplePdf() {
  const content = zlib.deflateSync(Buffer.from("BT /F1 12 Tf 60 740 Td <0102> Tj ( Phin coffee bar: $12 a person) Tj 0 -18 Td (40 to 300 people, 3 hours.) Tj 0 -18 Td [(We tra) 20 (vel in Manhattan.)] TJ ET", "latin1"));
  const cmap = "/CIDInit /ProcSet findresource begin 12 dict begin begincmap 1 begincodespacerange <00> <FF> endcodespacerange 2 beginbfchar <01> <004C> <02> <00EA> endbfchar endcmap end end";
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font 5 0 R >> >>", null, "<< /F1 6 0 R >>", "<< /Type /Font /Subtype /TrueType /BaseFont /X /ToUnicode 7 0 R >>", null];
  const parts = [Buffer.from("%PDF-1.4\n", "latin1")];
  objs.forEach((o, i) => { const id = i + 1; if (id === 4) parts.push(Buffer.from(`4 0 obj\n<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`, "latin1"), content, Buffer.from("\nendstream\nendobj\n", "latin1")); else if (id === 7) parts.push(Buffer.from(`7 0 obj\n<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream\nendobj\n`, "latin1")); else parts.push(Buffer.from(`${id} 0 obj\n${o}\nendobj\n`, "latin1")); });
  parts.push(Buffer.from("trailer << /Root 1 0 R >>\n%%EOF", "latin1")); return Buffer.concat(parts);
}

test("PDFs: the server reads text (with the font's ToUnicode map) when pdf.js can't load in the browser", async () => {
  const r = pdfText(samplePdf()); assert.equal(r.pages, 1);
  assert.match(r.text, /^Lê Phin coffee bar: \$12 a person\n40 to 300 people, 3 hours\.\nWe travel in Manhattan\.$/);
  assert.throws(() => pdfText(Buffer.from("hello")), { code: "invalid" });
  const { c } = await host();
  const up = await fetch(srv.base + "/api/onboard/pdf", { method: "POST", headers: { cookie: c, "content-type": "application/pdf" }, body: samplePdf() }); assert.equal(up.status, 200);
  const j = await up.json(); assert.match(j.text, /Phin coffee bar/);
  assert.equal((await fetch(srv.base + "/api/onboard/pdf", { method: "POST", headers: { "content-type": "application/pdf" }, body: samplePdf() })).status, 401, "signed-in hosts only");
});

test("/onboard: drafts are never published until Looks good; publishing sets packages and the page; Gmail only shows when configured", async () => {
  assert.equal((await get("/api/onboard/state")).status, 401);
  const { c } = await host();
  const page = await get("/onboard", c); assert.equal(page.status, 200); const html = await page.text(); assert.match(html, /Bring what you have/); assert.match(page.headers.get("content-security-policy"), /script-src 'self' 'unsafe-inline' https:\/\/cdnjs\.cloudflare\.com/);
  assert.doesNotMatch(html, /GOOGLE_CLIENT|client_secret/i, "no secrets or setup asks on the page");
  let st = await (await get("/api/onboard/state", c)).json(); assert.deepEqual(st.gmail, { enabled: false }); assert.equal(st.ai, "fake"); assert.equal((st.host?.experiences || []).length, 0);
  assert.equal((await post("/api/onboard/gmail/search", { q: "quote" }, c)).status, 404);
  assert.equal((await get("/api/onboard/gmail/start", c)).status, 404);

  const D = await (await post("/api/onboard/draft", { answers: { groups: "10 to 40", travel: "Manhattan" }, material: [{ label: "price-sheet.pdf", kind: "text", text: SHEET }, { label: "Pasted email 1", kind: "eml", text: "Subject: Re: quote\n\nHi Sam,\n\nThe iced coffee bar is $14 a person for 3 hours.\n" }] }, c)).json();
  assert.equal(D.source, "parser"); assert.deepEqual(D.experiences.map((x) => x.name), ["Phin coffee bar", "Phin brewing class", "Iced coffee bar"]); assert.equal(D.experiences[2].min, 10, "the answers fill a size the email left out"); assert.equal(D.gifts.length, 1); assert.equal(D.experiences[0]._from, "price-sheet.pdf");
  assert.equal(((await (await get("/api/host/profile", c)).json()).host?.experiences || []).length, 0, "nothing on the page yet");
  assert.equal((await post("/api/onboard/save", { step: "review", answers: { sell: "coffee" }, drafts: D }, c)).status, 200);
  st = await (await get("/api/onboard/state", c)).json(); assert.equal(st.draft.step, "review"); assert.equal(st.draft.drafts.experiences.length, 3);

  D.experiences[2].name = "Iced coffee for your office"; const pub = await (await post("/api/onboard/publish", { experiences: D.experiences, gifts: D.gifts }, c)).json();
  assert.equal(pub.ok, true); assert.equal(pub.host.forHire, true); assert.deepEqual(pub.host.experiences.map((x) => x.name), ["Phin coffee bar", "Phin brewing class", "Iced coffee for your office"]);
  assert.ok(pub.host.experiences.every((x) => !("_missing" in x) && !("_from" in x)), "review hints never reach the page"); assert.equal(pub.host.gifts[0].cents, 4500); assert.ok(pub.host.handle);
  const sg = await (await post("/api/onboard/suggest", { answers: { sell: "We make Vietnamese coffee, dripped slow through a phin." }, drafts: D }, c)).json(); assert.equal(sg.cover, "wash"); assert.equal(sg.font, "bold");
  const p2 = await (await post("/api/onboard/publish", { page: { tagline: sg.tagline, theme: { accent: sg.accent, cover: sg.cover } } }, c)).json();
  assert.equal(p2.host.tagline, sg.tagline); assert.equal(p2.host.theme.accent, "#C2553A"); assert.equal(p2.host.experiences.length, 3, "page details leave packages alone");
  const pub2 = await (await post("/api/onboard/publish", { experiences: pub.host.experiences.slice(0, 2) }, c)).json(); assert.equal(pub2.host.experiences[0].id, pub.host.experiences[0].id, "ids are kept on re-publish"); assert.equal(pub2.host.gifts.length, 1);
  assert.equal((await post("/api/onboard/publish", {}, c)).status, 400);

  process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com"; process.env.GOOGLE_CLIENT_SECRET = "test-secret";
  st = await (await get("/api/onboard/state", c)).json(); assert.deepEqual(st.gmail, { enabled: true, connected: false, email: "" });
  const go = await get("/api/onboard/gmail/start", c); assert.equal(go.status, 302); const u = new URL(go.headers.get("location"));
  assert.equal(u.host, "accounts.google.com"); assert.equal(u.searchParams.get("scope"), "https://www.googleapis.com/auth/gmail.readonly"); assert.equal(u.searchParams.get("client_id"), "test-client.apps.googleusercontent.com"); assert.ok(!u.href.includes("test-secret"), "the secret never leaves the server");
  assert.match(u.searchParams.get("redirect_uri"), /\/api\/onboard\/gmail\/callback$/);
  assert.equal((await post("/api/onboard/gmail/search", { q: "quote" }, c)).status, 409, "connect first");
  const forged = await get("/api/onboard/gmail/callback?code=x&state=" + encodeURIComponent(u.searchParams.get("state").split(".")[0] + ".bad"), c); assert.equal(forged.headers.get("location"), "/onboard?gmail=expired");
  const other = await host(); const stolen = await get("/api/onboard/gmail/callback?code=x&state=" + encodeURIComponent(u.searchParams.get("state")), other.c); assert.equal(stolen.headers.get("location"), "/onboard?gmail=expired", "a state is only good for the workspace that started it");
});

test("the showcase claim: Lê Phin's preset packages publish as-is when the owner taps Looks good", async () => {
  const P = JSON.parse(await (await fetch(srv.base + "/presets/le-phin.json")).text());
  const { c } = await host();
  const pub = await (await post("/api/onboard/publish", { experiences: P.experiences, gifts: P.gifts, page: { name: P.name, tagline: P.tagline, bio: P.bio, theme: P.theme } }, c)).json();
  assert.equal(pub.ok, true); assert.equal(pub.host.name, "Lê Phin"); assert.equal(pub.host.experiences.length, 3); assert.equal(pub.host.gifts.length, 3);
  assert.deepEqual(pub.host.experiences[0].runOfShow, P.experiences[0].runOfShow); assert.deepEqual(pub.host.gifts[0].tiers, P.gifts[0].tiers); assert.equal(pub.host.theme.font, "bold");
});

test("reminder settings: a phone turns texts on with one confirmation text; bad numbers are refused; opt-out sticks", async () => {
  const { c } = await host(); const t0 = fakeTexts.length;
  assert.equal((await post("/api/onboard/reminders", { phone: "12" }, c)).status, 400);
  const r = await (await post("/api/onboard/reminders", { phone: "(212) 555-0142", sms: true, tz: "America/New_York" }, c)).json();
  assert.equal(r.phone, "+12125550142"); assert.equal(r.sms, true); assert.equal(r.texted, true); assert.match(fakeTexts[t0].text, /Reply STOP/); assert.equal(fakeTexts.length, t0 + 1);
  await post("/api/onboard/reminders", { phone: "(212) 555-0142", sms: true }, c); assert.equal(fakeTexts.length, t0 + 1, "no second confirmation for the same number");
  const off = await (await post("/api/onboard/reminders", { off: true }, c)).json(); assert.equal(off.off, true); assert.equal(off.phone, "+12125550142");
  assert.equal((await (await get("/api/onboard/reminders", c)).json()).off, true);
});

const utc = (day, h) => { const d = new Date(day + "T00:00:00Z"); d.setUTCHours(h); return d.getTime(); };
const dayOf = (t, add = 0) => new Date(t + add * 864e5).toISOString().slice(0, 10);

test("Potto's reminders: a waiting quote after 4 hours then next morning, an accepted quote with what's due, the day-before checklist, quiet hours and opt-out", async () => {
  assert.equal(isQuiet(utc("2026-12-01", 21), "UTC"), true); assert.equal(isQuiet(utc("2026-12-01", 7), "UTC"), true); assert.equal(isQuiet(utc("2026-12-01", 8), "UTC"), false);
  assert.equal(localParts(utc("2026-12-01", 3), "America/New_York").day, "2026-11-30");
  const A = await host({ handle: "le-phin-rem", experiences: [{ name: "Phin coffee bar", min: 40, max: 300, price: "$12 a person", category: "drinks", includes: ["Two baristas", "Phins", "Cups"], runOfShow: ["-1:00 Set up the phin bar", "0:00 First pour"] }] });
  await post("/api/onboard/reminders", { phone: "+12125550188", sms: true, tz: "UTC" }, A.c);
  const xid = (await (await get("/api/host/profile", A.c)).json()).host.experiences[0].id;
  const rq = await (await post("/api/public/book/le-phin-rem", { name: "Sam", company: "Northwind", email: "sam@northwind.example", experienceId: xid, people: 120, when: "Dec 12", message: "Launch party for our new app." })).json();
  const at = scopeStore(srv.store, A.ws).list("inquiries").find((d) => d.data.id === rq.id).data.at, day0 = dayOf(at);
  const t0 = fakeTexts.length;
  let r = await runPottoReminders(srv.store, { workspaces: [A.ws], now: at + 3600e3 }); assert.equal(r.sent, 0, "not before 4 hours");
  r = await runPottoReminders(srv.store, { workspaces: [A.ws], now: utc(dayOf(at, 1), 15), origin: "https://pottery.example" }); assert.equal(r.sent, 1);
  const w1 = fakeTexts[t0]; assert.equal(w1.to, "+12125550188"); assert.match(w1.text, /^Potto here\.\nNorthwind is waiting on a quote for Phin coffee bar \(120 people\)\./); assert.match(w1.text, /https:\/\/pottery\.example\/@le-phin-rem\?bookings=1&req=/); assert.match(w1.text, /Reply STOP/);
  r = await runPottoReminders(srv.store, { workspaces: [A.ws], now: utc(dayOf(at, 1), 17) }); assert.equal(r.sent, 0, "once is enough the same day");
  r = await runPottoReminders(srv.store, { workspaces: [A.ws], now: utc(dayOf(at, 2), 9) }); assert.equal(r.sent, 1); assert.match(fakeTexts.at(-1).text, /Northwind's request for Phin coffee bar still needs a quote/);
  r = await runPottoReminders(srv.store, { workspaces: [A.ws], now: utc(dayOf(at, 3), 9) }); assert.equal(r.sent, 0, "two nudges, then Potto lets it be");
  assert.ok(day0);

  // a booked event: accepted with a deposit due and no address, then the day before
  const B = await host({ handle: "le-phin-book", experiences: [{ name: "Phin coffee bar", min: 10, max: 300, price: "$12 a person", category: "drinks", includes: ["Two baristas", "Phins", "Cups"], runOfShow: ["-1:00 Set up the phin bar", "0:00 First pour"] }] });
  await post("/api/onboard/reminders", { phone: "+12125550199", sms: true, tz: "UTC" }, B.c);
  const now = Date.now(), quietAt = utc(dayOf(now, 1), 3), morning = utc(dayOf(now, 1), 9), eventDay = dayOf(morning, 1);
  const bid = (await (await get("/api/host/profile", B.c)).json()).host.experiences[0].id;
  const bk = await (await post("/api/public/book/le-phin-book", { name: "Ana", company: "Acme", email: "ana@acme.example", experienceId: bid, people: 60, date: eventDay, time: "18:30", when: eventDay, message: "Team night at the office." })).json();
  assert.equal((await post(`/api/host/bookings/${bk.id}`, { status: "quoted", quote: { total: "$720", deposit: "$360" } }, B.c)).status, 200);
  const tk = new URL(bk.link).searchParams.get("t"); assert.equal((await post(`/api/public/booking/${bk.id}/accept`, { t: tk })).status, 200);
  const t1 = fakeTexts.length;
  r = await runPottoReminders(srv.store, { workspaces: [B.ws], now: quietAt }); assert.equal(r.sent, 0); assert.equal(r.held, 1, "9pm to 8am: the text waits"); assert.equal(fakeTexts.length, t1);
  r = await runPottoReminders(srv.store, { workspaces: [B.ws], now: morning }); assert.equal(r.sent, 1);
  const msg = fakeTexts.at(-1).text; assert.match(msg, /^Potto here\. 2 things need you:/); assert.match(msg, /1\. Acme accepted your quote for Phin coffee bar\. Still due: the deposit \(\$360\), the address\./);
  assert.match(msg, /2\. Tomorrow: Phin coffee bar for Acme\.\n- Start 6:30pm, set up from 1h before: Set up the phin bar\n- Confirm the address\n- 60 people\n- Pack: Two baristas, Phins, Cups\n- Contact: Ana, ana@acme\.example/);
  r = await runPottoReminders(srv.store, { workspaces: [B.ws], now: morning + 3600e3 }); assert.equal(r.sent, 0, "each reminder goes once");

  // email when there's no phone; nothing at all after opting out
  const Cc = await host({ handle: "le-phin-mail", experiences: [{ name: "Phin class", min: 8, max: 25, price: "$55 a person" }] }); const cid = (await (await get("/api/host/profile", Cc.c)).json()).host.experiences[0].id;
  const rq2 = await (await post("/api/public/book/le-phin-mail", { name: "Jo", company: "Globex", email: "jo@globex.example", experienceId: cid, people: 12, when: "January", message: "Team class for the design team." })).json();
  const at2 = scopeStore(srv.store, Cc.ws).list("inquiries").find((d) => d.data.id === rq2.id).data.at, o0 = fakeOutbox.length;
  r = await runPottoReminders(srv.store, { workspaces: [Cc.ws], now: at2 + 5 * 3600e3 }); assert.equal(r.sent, 1); const em = fakeOutbox.slice(o0).find((m) => m.to.includes("lan.owner" + (n) + "@lephin.example"));
  assert.ok(em, "emailed the owner"); assert.match(em.subject, /Globex is waiting on a quote for Phin class/); assert.match(em.text, /Turn these off any time: .*\/onboard#reminders/); assert.doesNotMatch(em.text, /Reply STOP/);
  await post("/api/onboard/reminders", { off: true }, Cc.c); scopeStore(srv.store, Cc.ws).delete("potto/" + rq2.id + "-wait1");
  r = await runPottoReminders(srv.store, { workspaces: [Cc.ws], now: at2 + 6 * 3600e3 }); assert.equal(r.sent, 0, "opted out");
  const pv = await (await post("/api/onboard/reminders/preview", {}, A.c)).json(); assert.ok(Array.isArray(pv.hosts));
  assert.equal(pottoMessage([{ kind: "waiting", line: "X is waiting." }], { link: "L", sms: false }), "Potto here.\nX is waiting.\nReply with a quote, or pass: L");
});
