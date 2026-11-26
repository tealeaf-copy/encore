// "Ideas to try" where people feel stuck (public/ideasnudge.js, server/ideasnudge.js): 3 or 4 calm ideas, local and
// seasonal, matched to what the host made before; a tap fills the box or starts a prefilled draft; never "steal".
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { pickIdeas } from "../server/ideasnudge.js";
import { IDEAS } from "../server/hooks.js";
import { offlineAnswer } from "../server/help.js";

let srv;
const J = { "content-type": "application/json" };
before(async () => { Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "ideas-secret-0123456789abcdef" }); resetLoginLimits(); srv = await startServer(); });
after(async () => { delete process.env.ENCORE_SIGNUP; delete process.env.SESSION_SECRET; await srv.close(); });

// a small stand-in for the page: elements whose innerHTML makes buttons and links a test can tap
function fakeDom(fetchImpl) {
  const loc = { href: "" }, store = new Map();
  const el = () => { const e = { hidden: true, dataset: {}, classList: { add() {} }, _html: "", _btns: [],
    set innerHTML(h) { this._html = h; this._btns = [...h.matchAll(/<button[^>]*data-(pli|plh)="(\d+)"[^>]*>([^<]*)</g)].map((m) => ({ dataset: { [m[1] === "pli" ? "pli" : "plh"]: m[2] }, text: m[3], onclick: null })); },
    get innerHTML() { return this._html; }, querySelectorAll(sel) { return this._btns.filter((b) => (sel.includes("pli") ? "pli" in b.dataset : "plh" in b.dataset)); } }; return e; };
  const win = { document: { cookie: "encore_in=1", getElementById: () => ({}), createElement: () => ({}), head: { appendChild() {} } }, location: loc, fetch: fetchImpl,
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }, Event: class { constructor(t) { this.type = t; } } };
  win.window = win; vm.createContext(win); vm.runInContext(fs.readFileSync(new URL("../public/ideasnudge.js", import.meta.url), "utf8"), win);
  return { win, el, loc, store };
}

test("the server picks 3 or 4 ideas: seasonal, matched to what the host made, and not ones they already ran", async () => {
  const L = pickIdeas(IDEAS, { interests: ["run"], n: 4, month: 6 }); assert.equal(L.length, 4); assert.ok(L.some((x) => /run|5k/i.test(x.title)), "a runner sees runs");
  const winter = pickIdeas(IDEAS, { n: 4, month: 0 }); assert.ok(winter.some((x) => /soup|game|bake|dumpling|movie|book|supper|mahjong/i.test(x.title)), "December leans cozy");
  assert.ok(!pickIdeas(IDEAS, { made: ["Game Night"], kinds: "games", n: 4 }).some((x) => x.title === "Game Night"), "not one they already ran");
  assert.equal(pickIdeas(IDEAS, { n: 9 }).length, 4, "never more than 4");
  const r = await (await fetch(srv.base + "/api/public/ideas/try?n=3")).json(); assert.equal(r.ideas.length, 3);
  for (const x of r.ideas) { assert.match(x.id, /^idea-/); assert.ok(x.title && x.say); }
  for (const f of ["../public/ideasnudge.js", "../server/ideasnudge.js"]) { const t = fs.readFileSync(new URL(f, import.meta.url), "utf8"); assert.doesNotMatch(t, /steal|—/i, f); }
});

test("the row renders under the box and a tap fills it; Host this starts a prefilled draft", async () => {
  const ideas = [{ id: "idea-game-night", title: "Game Night", line: "Three tables.", say: "Game Night: three tables, snacks to share" }, { id: "idea-taco-night", title: "Taco Night", line: "Tacos.", say: "Taco Night at my place" }, { id: "idea-sunrise-hike", title: "Sunrise Hike", line: "Up early.", say: "Sunrise hike, Saturday 6am" }];
  const D = fakeDom(async () => ({ ok: true, json: async () => ({ ideas }) }));
  const box = D.el(), input = { value: "", dispatchEvent() {}, focus() {}, setSelectionRange() {} };
  const L = await D.win.PLIdeas.row(box, { input });
  assert.equal(L.length, 3); assert.equal(box.hidden, false);
  assert.match(box.innerHTML, /Not sure\? Try one:/); assert.match(box.innerHTML, /More ideas/); assert.doesNotMatch(box.innerHTML, /steal/i);
  box.querySelectorAll("[data-pli]")[1].onclick(); assert.equal(input.value, "Taco Night at my place", "a tap fills the box");
  // the empty-state list: Host this goes to the app's idea flow, which opens the create flow with it filled in
  const list = D.el(); await D.win.PLIdeas.list(list, { lead: "Nothing near you yet", sub: "Be the first: try one of these.", n: 3 });
  assert.match(list.innerHTML, /Nothing near you yet/); assert.equal(list.querySelectorAll("[data-plh]").length, 3);
  list.querySelectorAll("[data-plh]")[0].onclick(); assert.equal(D.loc.href, "/?app=1&idea=idea-game-night");
  assert.equal(JSON.parse(D.store.get("pl.hostIdea")).id, "idea-game-night", "kept for after sign-up too");
  // the app turns ?idea= into a draft with the idea filled in
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /let pend=q\.get\("idea"\)/); assert.match(html, /\/api\/public\/inspo\/item\?id=/);
  assert.equal((await (await fetch(srv.base + "/api/public/inspo/item?id=idea-game-night")).json()).data.title, "Game Night");
  // where it shows: the create flow's first step, after an event, and the feed when nothing is near
  assert.match(html, /window\.PLIdeas\?\.row\(q\("#hvIdeas",S\.bg\),\{input:ta\}\)/); assert.match(html, /<h2 id="hvNextH">What's next\?<\/h2>/);
  assert.match(fs.readFileSync(new URL("../public/feedvisual.js", import.meta.url), "utf8"), /Nothing near you yet[\s\S]{0,40}Be the first: try one of these\./);
});

test("Potto answers 'what should I host?' with 3 ideas, each one tap from a draft", () => {
  for (const q of ["What should I host?", "I'm stuck, need an idea", "what to host this weekend"]) {
    const a = offlineAnswer(q); assert.equal(a.section, "What to host", q); assert.equal(a.ideas.length, 3);
    assert.equal(a.actions.filter((x) => /^\/\?app=1&idea=idea-/.test(x.href)).length, 3); assert.ok(a.actions.length <= 4); assert.doesNotMatch(a.answer, /steal|—/i);
  }
});
