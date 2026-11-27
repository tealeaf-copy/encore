// The demo guide (server/branddemo.js): a small "1 of 6" card that points at the next thing to tap. Skippable and
// resumable (it remembers the path and step on this device), on phones and desktops. Loaded only on demo pages.
(function () {
  if (window.__plDemoGuide) return; window.__plDemoGuide = 1;
  const KEY = "pl.demo.guide", U = new URLSearchParams(location.search), $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } }, save = () => { try { localStorage.setItem(KEY, JSON.stringify(T)); } catch {} };
  let T = load() || { path: "menu", step: 0, off: false };
  if (U.get("tour")) { T = { path: U.get("tour"), step: 0, off: false }; save(); }
  let S = null; const state = async () => { try { const r = await fetch("/api/teams/demo/state", { credentials: "same-origin" }); if (r.ok) S = await r.json(); } catch {} return S; };
  const post = async (url, body) => { const r = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || "Try again."); return j; };
  const P = location.pathname, on = (re) => re.test(P), text = (el) => (el?.textContent || "").trim();
  const reqId = () => (P.match(/\/(?:teams\/bookings|teams\/demo\/host)\/([a-f0-9]{8,24})/) || [])[1] || S?.latest?.id || "";
  const marlowBook = () => { const opt = $$(".tp-opt").find((o) => /Marlow Table/.test(text(o))) || $(".tp-opt"); return opt?.querySelector("[data-book]"); };
  const go = (url) => { location.href = url; };

  // ---- the paths ----
  const PATHS = {
    menu: [{ on: /./, title: "Welcome to the Fernlight demo", body: () => `You're Sam, a field marketer at Fernlight (a made-up company), planning Q1 customer dinners in New York, San Francisco and Chicago. Pick a path. Each one takes under two minutes.`, menu: true }],
    find: [
      { on: /^\/teams\/discover/, el: () => $("#tpGo"), tap: "Find hosts", title: "Search by goal, city, size and budget", body: () => "We've filled in a customer dinner for 12 in New York, up to $200 a person. Tap Find hosts.", until: () => $(".tp-opt") },
      { on: /^\/teams\/discover/, el: () => $(".tp-opt .acts a"), tap: "Open the first one", title: "Three matches", body: () => "Each shows the total for 12, whether your date is open and what's at risk if plans change. Open one to see the details." },
      { on: /^\/teams\/x\//, el: () => $("#box [data-save]"), tap: "Save to the shortlist", title: "Everything a team asks first", body: () => "The full price, the cancellation terms, reviews, access and dietary notes. Save it to your team's shortlist.", until: () => $("#box [data-save] a") },
      { on: /^\/teams\/x\//, el: () => $("#box [data-save] a"), tap: "Open the shortlist", title: "Saved", body: () => "It's next to the omakase counter Priya already voted for. Open the shortlist." },
      { on: /^\/teams\/list\/[a-f0-9]+$/, el: () => $("#cmp"), title: "Your team weighs it up", body: () => "Teammates vote and comment here, with a link for anyone outside the team. Now compare the two side by side.", action: { label: "Compare the two", run: () => { const L = $$("[data-pick]").slice(0, 2); L.forEach((c) => { if (!c.checked) { c.checked = true; c.dispatchEvent(new Event("change", { bubbles: true })); } }); $("#cmp")?.click(); } } },
      { on: /\/compare/, el: () => $(".bb-cmp"), title: "Side by side", body: () => "Price for your group, terms, reviews, access and each host's record. That's finding a host.", end: true },
    ],
    book: [
      { on: /^\/teams\/home/, el: () => $("#tpGo"), tap: "Find hosts", title: "Quick book a customer dinner", body: () => "12 people in New York, about $200 a person. Tap Find hosts.", until: () => $(".tp-opt") },
      { on: /^\/teams\/home/, el: marlowBook, tap: "Book Marlow Table", title: "Pick one", body: () => "Marlow Table is a private chef who cooks a tasting menu where you are. Tap Book this.", until: () => $("#tpBf") },
      { on: /^\/teams\/home/, el: () => $("#tpBf [type=submit]"), tap: "Ask for approval", title: "The brief, the price and the risk", body: () => "Above: the total, the deposit and the money at risk by date. Below: the brief the host reads, with the goal, the guest mix and who sends invites. Over $1,500, so it goes to Priya first.", until: () => on(/^\/teams\/bookings\//) },
      { on: /^\/teams\/bookings\//, el: () => $("main h1"), title: "Waiting on a teammate", body: () => "Bookings over $1,500 need an OK from Priya, Fernlight's finance lead. In real life she gets a note. Here, play her part.", until: () => S?.latest && S.latest.status !== "approval",
        action: { label: "Approve as Priya", run: async () => { await post("/api/teams/demo/act", { act: "approve", id: reqId() }); location.reload(); } } },
      { on: /^\/teams\/bookings\//, el: () => $("main h1"), title: "Request sent", body: () => "Marlow Table has it now. Nothing is charged until the host accepts. See it from the host's side.", action: { label: "See what the host sees", run: () => go(`/teams/demo/host/${reqId()}`) } },
      { on: /^\/teams\/demo\/host\//, el: () => $("#accept") || $("#next"), tap: "Accept, as Ines", title: "What the host sees", body: () => "Ines's inbox: the brief, the group, the date and what she's paid. Your email and phone stay hidden until you're booked. Accept it, as Ines.", until: () => $("#next") },
      { on: /^\/teams\/demo\/host\//, el: () => $("#next"), title: "Booked", body: () => "The deposit is held (in the demo, nothing is charged) and the date is yours. Next: the guest list.", action: { label: "Open the guest list", run: () => go($("#next")?.getAttribute("href") || "/teams/campaigns") } },
      { on: /^\/teams\/campaigns\/[a-f0-9]+\/invite/, el: () => $("#addG") || $("#pane"), title: "Guests and invites", body: () => "Your guest list, with who said yes. Invites go from here by email or a sign-up link, and guests choose what they share with Fernlight.", action: { label: "See a past event's report", run: () => go(`/teams/campaigns/${S?.campaign || ""}/measure`) } },
      { on: /^\/teams\/campaigns\/[a-f0-9]+\/measure/, el: () => $("#pane"), title: "After the event", body: () => "The bakery night a few weeks ago: who came, target accounts in the room, meetings and pipeline. Feedback counts show only once 10 or more people answered, and nobody is named without saying yes.", end: true },
    ],
    gift: [
      { on: /^\/teams\/demo\/gifts/, step: "to", el: () => $("#gTo"), title: "Who it's for", body: () => "People from Fernlight's target accounts. Pick a few, then Next.", until: () => document.body.dataset.gstep !== "to" },
      { on: /^\/teams\/demo\/gifts/, step: "gift", el: () => $("#gGift"), title: "A maker's gift", body: () => "Small makers, each with a price, lead time and where they deliver. Pick one.", until: () => !["to", "gift"].includes(document.body.dataset.gstep) },
      { on: /^\/teams\/demo\/gifts/, step: "note", el: () => $("#gNote"), title: "A note in your words", body: () => "A line or two. It's printed on a card from the maker.", until: () => ["plan", "sent"].includes(document.body.dataset.gstep) },
      { on: /^\/teams\/demo\/gifts/, step: "plan", el: () => $("#gPlan"), title: "The delivery plan and the cost", body: () => "When each one arrives, how it travels, and the total before anything is sent. Send it.", until: () => document.body.dataset.gstep === "sent" },
      { on: /^\/teams\/demo\/gifts/, step: "sent", el: () => $("#gView"), title: "Sent", body: () => "In the demo nothing is ordered or charged. See what the person gets.", action: { label: "See what they see", run: () => $("#gView")?.click() } },
      { on: /^\/teams\/demo\/gift\//, el: () => $("main h1"), title: "What they see", body: () => "Your note, the gift and when it arrives. They add their own address here, so Fernlight never handles it.", end: true },
    ],
  };

  // ---- the card ----
  const css = `.pd-card{position:fixed;z-index:9000;left:12px;right:12px;bottom:12px;max-width:420px;margin-left:auto;background:var(--bb-card,var(--pl-surface,#fffdf8));color:var(--bb-ink,var(--pl-ink,#1f1b16));border:1.5px solid var(--bb-ink,var(--pl-ink,#1f1b16));border-radius:10px;padding:14px 16px 12px;box-shadow:0 10px 30px rgba(0,0,0,.18);font:400 16px/1.45 var(--bb-sans,var(--pl-font-text,system-ui,sans-serif))}
  .pd-card .k{display:flex;justify-content:space-between;gap:8px;align-items:center;margin:0 0 4px;font:600 12px/1.2 var(--bb-mono,ui-monospace,monospace);letter-spacing:.06em;text-transform:uppercase}
  .pd-card h2{margin:0 0 4px;font:600 18px/1.3 var(--bb-sans,var(--pl-font-text,system-ui,sans-serif))}.pd-card p{margin:0 0 10px}
  .pd-card .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.pd-card button,.pd-card a.b{min-height:44px;padding:0 14px;border-radius:8px;border:1.5px solid var(--bb-ink,var(--pl-ink,#1f1b16));background:transparent;color:inherit;font:600 15px var(--bb-sans,system-ui,sans-serif);cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}
  .pd-card .p{background:var(--bb-accent,var(--pl-accent,#2a43a0));border-color:var(--bb-accent,var(--pl-accent,#2a43a0));color:var(--bb-on-accent,#fff)}.pd-card .q{border-color:transparent;text-decoration:underline;padding:0 6px}
  .pd-card .demo{margin:8px 0 0;padding-top:8px;border-top:1px dashed var(--bb-line,#c9c0b0);font-size:14px}.pd-ring{outline:3px solid var(--bb-accent,var(--pl-accent,#2a43a0))!important;outline-offset:3px!important;border-radius:6px;transition:outline-color .2s}
  .pd-pill{position:fixed;z-index:9000;right:12px;bottom:12px;min-height:44px;padding:0 16px;border-radius:999px;border:1.5px solid var(--bb-ink,#1f1b16);background:var(--bb-card,#fffdf8);color:var(--bb-ink,#1f1b16);font:600 15px var(--bb-sans,system-ui,sans-serif);cursor:pointer}
  .pd-card.top{top:12px;bottom:auto}@media (max-width:600px){.pd-card{padding:10px 12px 8px;font-size:15px}.pd-card h2{font-size:17px}.pd-card p{margin:0 0 8px}}
  @media (min-width:900px){.pd-card{left:auto;right:20px;bottom:20px}.pd-card.top{top:76px;bottom:auto}}body{padding-bottom:200px}`;
  const st = document.createElement("style"); st.textContent = css; document.head.append(st);
  let card = null, ring = null, shown = -1;
  const steps = () => PATHS[T.path] || PATHS.menu;
  function unring() { ring?.classList.remove("pd-ring"); ring = null; }
  const matches = (s) => s.on.test(P) && (!s.step || s.step === document.body.dataset.gstep);
  function pick() { const L = steps(); let i = Math.min(T.step, L.length - 1);
    // jumped ahead or back (a link, the back button): follow the page
    if (!matches(L[i])) { let j = -1; for (let k = i; k < L.length && j < 0; k++) if (matches(L[k])) j = k; for (let k = 0; k < i && j < 0; k++) if (matches(L[k])) j = k; if (j >= 0) i = j; }
    while (L[i].until && matches(L[i]) && L[i].until() && i < L.length - 1 && matches(L[i + 1])) i++;
    if (i !== T.step) { T.step = i; save(); } return i; }
  function draw() { if (T.off) { card?.remove(); card = null; unring(); if (!$(".pd-pill")) { const b = document.createElement("button"); b.className = "pd-pill"; b.type = "button"; b.textContent = "Demo guide"; b.onclick = () => { T.off = false; save(); b.remove(); draw(); }; document.body.append(b); } return; }
    $(".pd-pill")?.remove(); const L = steps(), i = pick(), s = L[i], here = matches(s);
    if (!card) { card = document.createElement("aside"); card.className = "pd-card"; card.setAttribute("role", "complementary"); card.setAttribute("aria-label", "Demo guide"); document.body.append(card); }
    if (shown !== i || card.dataset.p !== T.path || card.dataset.here !== String(here)) { shown = i; card.dataset.p = T.path; card.dataset.here = String(here);
      const n = L.length, menu = s.menu || s.end;
      card.innerHTML = `<p class="k"><span>${s.menu ? "Demo" : `Step ${i + 1} of ${n}`}</span><button class="q" type="button" data-x aria-label="Hide the guide">Hide</button></p><h2>${esc(s.title)}</h2><p>${esc(here ? s.body() : "Pick up where you left off.")}</p>
        <div class="row">${!here ? `<button class="p" type="button" data-back>Back to step ${i + 1}</button>` : s.action ? `<button class="p" type="button" data-act>${esc(s.action.label)}</button>` : s.tap ? `<button class="p" type="button" data-tap>${esc(s.tap)}</button>` : ""}
        ${menu ? `<a class="b ${s.menu ? "p" : ""}" href="/teams/demo?path=find">Find a host</a><a class="b" href="/teams/demo?path=book">Book a host</a><a class="b" href="/teams/demo?path=gift">Send gifts</a>` : ""}</div>
        <p class="demo">Made up: nothing you do is sent or charged. <a href="/teams/demo?reset=1${T.path !== "menu" ? "&path=" + esc(T.path) : ""}">Start over</a> · <a href="#" data-leave>Leave the demo</a></p>`;
      card.querySelector("[data-x]").onclick = () => { T.off = true; save(); draw(); };
      card.querySelector("[data-leave]").onclick = async (e) => { e.preventDefault(); try { localStorage.removeItem(KEY); } catch {} try { await fetch("/api/logout", { method: "POST", credentials: "same-origin" }); } catch {} location.href = "/teams"; };
      const a = card.querySelector("[data-act]"); if (a) a.onclick = async () => { a.disabled = true; try { await s.action.run(); } catch (er) { a.disabled = false; a.textContent = er.message; } };
      const tp = card.querySelector("[data-tap]"); if (tp) tp.onclick = () => { const el = s.el && s.el(); if (el) el.click(); };
      const bk = card.querySelector("[data-back]"); if (bk) bk.onclick = () => go(startOf(T.path, i)); }
    const el = here && s.el ? s.el() : null; if (el !== ring) { unring(); if (el) { ring = el; el.classList.add("pd-ring"); try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch {} } }
    place(); }
  // keep the card off what it points at: above it when the target sits low on the screen
  function place() { if (!card) return; let top = false; if (ring) { const r = ring.getBoundingClientRect(), ch = card.offsetHeight + 24; if (r.bottom > innerHeight - ch && r.top > ch) top = true; } card.classList.toggle("top", top); }
  addEventListener("scroll", () => place(), { passive: true });
  const startOf = (p) => `/teams/demo?path=${p}`;
  const tick = async () => { if (T.path === "book" && /^\/teams\/(bookings|demo\/host)/.test(P)) await state(); draw(); };
  state().then(() => { draw(); setInterval(tick, 700); });
  window.PLDemo = { state: () => S, redraw: draw };
})();
