// "Questions for guests" (public/questions.js, opened from the create canvas): the host's questions and the reply form's
// wording save and load, clearing a word falls back to the default, guests see exactly the saved wording on /e and /g,
// "Anything you don't eat?" is asked only when it fits, and typing is never overwritten by a save or stolen by the live
// guest preview. Also the guest's Add to calendar (server/hooksout.js): a valid .ics for a timed, an all-day and an
// open-ended event, and Google / Outlook links with the same times.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { calTimes, calLinks, seriesRule } from "../server/hooksout.js";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const Qs = () => { const window = {}; vm.runInNewContext(read("public/questions.js"), { window, document: undefined, console }); return window.Questions; };
const J = { "content-type": "application/json" };
let srv, cookie;
before(async () => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "questions-sheet-secret-0123"; process.env.ENCORE_FAKE_EMAIL = "1"; resetLoginLimits(); srv = await startServer();
  const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name: "Madison Lee", email: "madison.qs@example.com", password: "long-password-1", mode: "friends" }) }); cookie = r.headers.get("set-cookie").split(";")[0]; });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv?.close(); });
const put = (id, body) => fetch(srv.base + "/api/db/doc?path=events/" + id, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const asGuest = async (id) => (await (await fetch(srv.base + "/api/db/doc?path=events/" + id, { headers: { "x-encore-guest": "1" } })).json()).data;
const ev = (o) => ({ kind: "social", casual: true, published: true, hostName: "Madison", date: day(5), startTime: "19:00", endTime: "21:00", city: "Brooklyn", meetPoint: "Prospect Park", ...o });

test("wording: the host's own words, and the defaults when a field is empty or only spaces", () => {
  const Q = Qs();
  assert.deepEqual({ ...Q.wording({ questions: [{ q: "A song?" }] }) }, { title: "One quick question", defTitle: "One quick question", button: "Send my reply", defButton: "Send my reply", thanks: "" });
  assert.equal(Q.wording({ questions: [{ q: "a" }, { q: "b" }] }).title, "Question 1 of 2");
  const W = Q.wording({ questions: [{ q: "a" }, { q: "b" }], qStyle: { title: "  Before we run ", button: "Count me in", thanks: "See you at the gate." } });
  assert.equal(W.title, "Before we run · 1 of 2"); assert.equal(W.button, "Count me in"); assert.equal(W.thanks, "See you at the gate.");
  const C = Q.wording({ questions: [{ q: "a" }], qStyle: { title: "   ", button: "", thanks: " " } });
  assert.equal(C.title, "One quick question"); assert.equal(C.button, "Send my reply"); assert.equal(C.thanks, "");
});

test("Anything you don't eat?: only when the host asks it or food is the point", () => {
  const Q = Qs(), on = (o) => Q.askDiet(o);
  for (const name of ["Dumpling dinner", "Supper club", "Potluck in the park", "Picnic", "Wine tasting", "Sunday brunch", "Cooking class: pasta", "Book club dinner"]) assert.equal(on({ name }), true, name);
  for (const name of ["Run club", "Morning run, then cafe", "Hike then lunch", "Game night", "Hack night", "Pottery workshop", "Cookie drop", "Coffee walk", "Giveaway at the shop", "Cake night", ""]) assert.equal(on({ name }), false, name);
  assert.equal(on({ name: "Run club", askDiet: true }), true, "the host added it"); assert.equal(on({ name: "Dumpling dinner", askDiet: false }), false, "the host took it off");
  assert.equal(on({ name: "Movie night", courses: ["Dumplings"] }), true, "the host listed the food");
  assert.ok(Q.STARTERS.some((s) => s.diet && s.q === "Anything you don't eat?"), "offered as a one-tap suggestion");
  const inv = read("public/invite.html"); assert.match(inv, /const foodyOf = \(e\) => window\.Questions \? Questions\.askDiet\(e\)/);
  assert.match(read("index.html"), /food=window\.Questions\?\.askDiet\?window\.Questions\.askDiet\(e\):FOODY\(e\)/);
});

test("the sheet's copy: plain words, no emoji, no exclamation marks, no em dashes", () => {
  const js = read("public/questions.js"), b = js.slice(js.indexOf("function builder"), js.indexOf("function flow"));
  assert.match(b, /Reply form wording/); assert.match(b, /Change the words guests see when they reply\./);
  assert.match(b, /The heading above the questions\. Default: /); assert.match(b, /The reply button\. Default: /); assert.match(b, /Shown after someone says they're in\./);
  assert.match(b, /See the full guest view/); assert.doesNotMatch(b, /personality|Preview as a guest/);
  const S = Qs().STARTERS.map((s) => s.q).join(" ");
  for (const q of ["A song for the playlist?", "Bringing someone? Their name, please.", "What would you like to learn?"]) assert.ok(S.includes(q), q);
  assert.doesNotMatch(b + S, /\p{Extended_Pictographic}/u); assert.doesNotMatch(b + S, /—/); assert.doesNotMatch(S, /!/);
  for (const m of b.matchAll(/(?:placeholder="|<small[^>]*>|<b>|<span>)([^"<$]+)/g)) assert.doesNotMatch(m[1], /!/, m[1]);
  const cv = read("public/canvas.js"); assert.match(cv, /Sh\.bg\.classList\.add\("qb-sheet"\); Sh\.\$\("\[data-x\]"\)\?\.remove\(\)/, "one way to close: Done");
});

test("questions and wording save and load, and guests get them (with askDiet)", async () => {
  const questions = [{ id: "q1", q: "A song for the playlist?", type: "short" }], qStyle = { title: "Before we run", button: "Count me in", thanks: "See you at the gate." };
  assert.ok((await put("qsRun", ev({ name: "Run club", questions, qStyle, askDiet: false }))).ok);
  const host = (await (await fetch(srv.base + "/api/db/doc?path=events/qsRun", { headers: { cookie } })).json()).data;
  assert.deepEqual(host.qStyle, qStyle); assert.equal(host.questions[0].q, "A song for the playlist?");
  const g = await asGuest("qsRun"); assert.deepEqual(g.qStyle, qStyle); assert.equal(g.questions.length, 1); assert.equal(g.askDiet, false);
});

test("Add to calendar: a valid .ics for a timed, an all-day and an open-ended event; Google and Outlook with the same times", async () => {
  // pure: the times
  const T = calTimes({ date: "2026-12-04", startTime: "19:00", endTime: "21:30", tz: "America/New_York" }); assert.deepEqual({ ...T }, { allDay: false, start: "20261205T000000Z", end: "20261205T023000Z", tz: "America/New_York" });
  assert.equal(calTimes({ date: "2026-12-04", startTime: "19:00", tz: "America/New_York" }).end, "20261205T030000Z", "no end time: three hours");
  const A = calTimes({ date: "2026-12-04", endDate: "2026-12-06" }); assert.equal(A.allDay, true); assert.equal(A.start, "20261204"); assert.equal(A.end, "20261207");
  assert.equal(calTimes({ date: "" }), null);
  const L = calLinks({ ev: { date: "2026-12-04", startTime: "19:00", tz: "America/New_York" }, title: "Run club", url: "https://x/e/a", location: "Brooklyn" });
  assert.match(L.google, /dates=20261205T000000Z%2F20261205T030000Z&details=https%3A%2F%2Fx%2Fe%2Fa&location=Brooklyn&ctz=America%2FNew_York/);
  assert.match(L.outlook, /startdt=2026-12-05T00%3A00%3A00Z&enddt=2026-12-05T03%3A00%3A00Z/);
  assert.match(calLinks({ ev: { date: "2026-12-04" }, title: "Fair" }).google, /dates=20261204%2F20261205/, "all day: the end is the next day");
  assert.equal(seriesRule({ date: "2027-01-06", sessions: 6 }), "RRULE:FREQ=WEEKLY;COUNT=6"); assert.equal(seriesRule({ date: "2026-12-03", sessions: 3, repeat: "monthly" }), "RRULE:FREQ=MONTHLY;BYDAY=1TH;COUNT=3");
  // the routes
  await put("calT", ev({ name: "Run club", tz: "America/New_York" })); await put("calD", ev({ name: "Craft fair", startTime: "", endTime: "", endDate: day(6) })); await put("calN", ev({ name: "Open studio", endTime: "" }));
  for (const [id, re] of [["calT", /DTSTART:\d{8}T\d{6}Z\r\nDTEND:\d{8}T\d{6}Z/], ["calD", /DTSTART;VALUE=DATE:\d{8}\r\nDTEND;VALUE=DATE:\d{8}/], ["calN", /DTSTART:\d{8}T\d{6}Z\r\nDTEND:\d{8}T\d{6}Z/]]) {
    const r = await fetch(srv.base + `/e/${id}.ics`), t = await r.text(); assert.equal(r.status, 200, id);
    assert.match(r.headers.get("content-type"), /^text\/calendar; charset=utf-8/); assert.match(r.headers.get("content-disposition"), /^inline; filename="[A-Za-z0-9-]+\.ics"$/);
    assert.match(t, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\nPRODID:/); assert.match(t, /\r\nBEGIN:VEVENT\r\nUID:[^\r]+@potterylab\r\nDTSTAMP:\d{8}T\d{6}Z\r\n/); assert.match(t, re, id); assert.match(t, /END:VEVENT\r\nEND:VCALENDAR\r\n$/);
    if (id === "calN") { const [, s, e] = /DTSTART:(\d{8}T\d{4})\d\dZ\r\nDTEND:(\d{8}T\d{4})/.exec(t); assert.notEqual(s, e, "an end, three hours on"); }
    const g = await fetch(srv.base + `/e/${id}/cal/google`, { redirect: "manual" }); assert.equal(g.status, 302); assert.match(g.headers.get("location"), /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE&text=/);
    const o = await fetch(srv.base + `/e/${id}/cal/outlook`, { redirect: "manual" }); assert.equal(o.status, 302); assert.match(o.headers.get("location"), /^https:\/\/outlook\.live\.com\/calendar\/0\/deeplink\/compose\?/);
  }
  assert.equal((await fetch(srv.base + "/e/nope99/cal/google", { redirect: "manual" })).status, 404);
  // the guest pages link to it, without a download attribute (an iPhone sends a download to Files, not Calendar)
  const sl = read("public/slots.js"); assert.match(sl, /class="sl-btn ghost sm sl-calbtn" href="\/e\/\$\{encodeURIComponent\(id\)\}\.ics/); assert.doesNotMatch(sl.slice(sl.indexOf("function toolsHTML"), sl.indexOf("async function copy")), / download>/);
  assert.match(sl, /Apple Calendar.*Google Calendar.*Outlook/); assert.match(sl, /This is the preview\. Once you share the invite/);
  const ix = read("index.html"); assert.doesNotMatch(ix, /"data:text\/calendar;charset/); assert.doesNotMatch(ix, /download="invitation\.ics"/);
  assert.match(read("public/invite.html"), /cal\.href = `\/e\/\$\{encodeURIComponent\(eid\)\}\.ics\?rid=/);
});

test("in a browser: typing is never overwritten by a save, the live preview never takes the keyboard, wording reaches /e", async (t) => {
  let chromium; try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch { return t.skip("no playwright"); }
  let br; try { br = await chromium.launch(); } catch { return t.skip("no browser"); }
  try {
    const p = await br.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await p.setContent(`<!doctype html><body><div id="box"></div><iframe id="pv" style="width:300px;height:300px"></iframe></body>`); await p.addScriptTag({ content: read("public/questions.js") });
    // the host's editor, wired the way the canvas wires it: every save also redraws the guest preview (a guest card in a frame)
    await p.evaluate((src) => { const ev = { name: "Run club", questions: [{ id: "a", q: "First", type: "short" }, { id: "b", q: "Second", type: "short" }] }; window.__ev = ev; window.__saves = 0;
      const fr = document.getElementById("pv").contentDocument; fr.open(); fr.write(`<div id="qs"></div><script>${src}<\/script>`); fr.close();
      const redraw = () => { const f = document.getElementById("pv").contentWindow; const qs = f.document.getElementById("qs"); qs.innerHTML = ""; f.Questions.flow(qs, JSON.parse(JSON.stringify(ev)), {}); };
      window.__qb = window.Questions.builder(document.getElementById("box"), ev, () => { window.__saves++; redraw(); }); redraw(); }, read("public/questions.js"));
    await p.click(".qb-words summary");
    for (const [k, text] of [["title", "Who is picking up?"], ["button", "Count me in"], ["thanks", "See you at 5:45"]]) {
      const f = p.locator(`[data-p="${k}"]`); await f.click();
      for (const ch of text) { await p.keyboard.type(ch); await p.waitForTimeout(ch === " " ? 340 : 20); } // a pause long enough for a save (and a preview redraw) mid-word
      assert.equal(await f.inputValue(), text, k + ": nothing lost"); assert.equal(await p.evaluate(() => document.activeElement?.dataset?.p), k, k + ": focus stayed");
    }
    await p.waitForTimeout(400); assert.ok(await p.evaluate(() => window.__saves) > 3, "saves happened while typing");
    // a pending save while typing in a question: the event follows every keystroke, the field is never rewritten
    const q = p.locator('.qb-q[data-id="a"] [data-k="q"]'); await q.click(); await q.press("End"); await p.keyboard.type(" one", { delay: 15 });
    assert.equal(await q.inputValue(), "First one"); assert.equal(await p.evaluate(() => window.__ev.questions[0].q), "First one");
    await p.evaluate(() => window.__qb.flush()); assert.equal(await q.inputValue(), "First one");
    // moving and removing keep the wording open and focus on the control
    await p.click('.qb-q[data-id="a"] [data-mv="1"]'); assert.deepEqual(await p.evaluate(() => window.__ev.questions.map((x) => x.id)), ["b", "a"]);
    assert.equal(await p.evaluate(() => document.activeElement?.dataset?.mv), "-1"); assert.equal(await p.evaluate(() => document.querySelector(".qb-words").open), true);
    assert.equal(await p.inputValue('[data-p="title"]'), "Who is picking up?");
    // clearing a word: the stored value goes and the preview shows the default
    await p.fill('[data-p="button"]', "   "); assert.equal(await p.evaluate(() => "button" in window.__ev.qStyle), false); assert.equal(await p.textContent('[data-pv="button"]'), "Send my reply");
    // the guest page shows exactly the saved words, and the default once cleared
    assert.ok((await put("qsWord", ev({ name: "Run club", questions: [{ id: "q1", q: "A song for the playlist?", type: "short" }], qStyle: { title: "Before we run", button: "Count me in", thanks: "See you at the gate." } }))).ok);
    const g = await br.newPage({ viewport: { width: 390, height: 844 } }); await g.route(/fonts\.(googleapis|gstatic)\.com/, (x) => x.abort());
    await g.goto(srv.base + "/e/qsWord"); await g.waitForSelector("#qs .tf-n", { timeout: 8000 });
    assert.equal((await g.textContent("#send")).trim(), "Count me in"); assert.equal((await g.textContent("#qs .tf-n")).trim(), "Before we run");
    assert.equal(await g.locator("#dtL").count(), 0, "a run doesn't ask what you eat"); assert.notEqual(await g.evaluate(() => document.activeElement?.tagName), "INPUT", "the guest card doesn't grab the keyboard on load");
    assert.ok((await put("qsWord", ev({ name: "Run club", questions: [{ id: "q1", q: "A song for the playlist?", type: "short" }], qStyle: {} }))).ok);
    await g.reload(); await g.waitForSelector("#qs .tf-n", { timeout: 8000 }); assert.equal((await g.textContent("#send")).trim(), "Send my reply"); assert.equal((await g.textContent("#qs .tf-n")).trim(), "One quick question");
  } finally { await br.close(); }
});
