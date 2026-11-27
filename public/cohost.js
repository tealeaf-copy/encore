// Potto as a co-host, before the event (server/cohost.js has the server side and the page at /cohost/<event>).
//
// 1. "Here's your night": one sentence ("dumpling night for 8 next Saturday") becomes a near-finished plan: the title,
//    the kind, a drawn cover from the illustration set (public/eventart.js), a suggested day and time, the spots and a
//    short note for the host to send. One calm card with "Looks good" (applies all of it) and a tweak for each field.
//    It shows in the create canvas (public/canvas.js calls PLCohost.typed / drawn / opened) and on /start
//    (public/start.html exposes PLStart.apply). Nothing here books anything or says it did; places are left to the host.
// 2 to 4 (a time that works, a line per friend, the "nobody's replied" rescue) live on /cohost/<event> (public/cohost.html).
//
// nightFromSentence is pure: test/delight-before.test.js runs it without a page, and server/cohost.js uses the same
// reading for Potto and /api/cohost/night.
(function (root) {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const WD = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const WORDN = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, "a dozen": 12 };
  // the create canvas's kinds (public/canvas.js PLAN_KINDS): the words that mean each one, most specific first
  const KIND_WORDS = [["potluck", /\bpotluck\b/], ["game", /\bgame night\b|\bboard games?\b|\bgames? night\b|\btrivia\b|\bmahjong\b|\bpoker\b/], ["hack", /\bhack(?:ing)? night\b|\bhackathon\b|\bbuild night\b/],
    ["book", /\bbook club\b/], ["watch", /\bwatch party\b|\bmovie night\b|\bfilm night\b|\bscreening\b/], ["picnic", /\bpicnic\b/], ["hike", /\bhike\b|\bhiking\b/], ["run", /\b(?:\d+k|run|running|jog|walk)\b/],
    ["brunch", /\bbrunch\b|\bcoffee\b|\bbreakfast\b|\bpancakes?\b/], ["drinks", /\bdrinks\b|\bhappy hour\b|\bcocktails?\b|\bwine night\b|\bbeers?\b/], ["class", /\bclass\b|\bworkshop\b/],
    ["dinner", /\bdinner\b|\bsupper\b|\bdumplings?\b|\btacos?\b|\bpasta\b|\bramen\b|\bhot ?pot\b|\bcurry\b|\bfeast\b|\bbbq\b|\bcookout\b|\bpizza\b|\bsushi\b/]];
  const KIND = { dinner: ["Dinner", "19:00", 6], drinks: ["Drinks", "18:30", 10], game: ["Game night", "19:30", 6], brunch: ["Coffee or brunch", "10:30", 6], potluck: ["Potluck", "18:00", 10], picnic: ["Picnic", "12:00", 10],
    hack: ["Hack night", "18:30", 15], book: ["Book club", "19:00", 8], run: ["Run or walk", "08:00", 12], hike: ["Hike", "08:30", 10], watch: ["Watch party", "19:30", 10], class: ["Class", "14:00", 8] };
  const pad = (n) => String(n).padStart(2, "0");
  const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const day0 = (now) => new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const plusDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  /** "Sat, Dec 5" and "7pm", the way the app writes them. */
  function dateLabel(iso) { if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return ""; return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); }
  function timeLabel(t) { const m = /^(\d{2}):(\d{2})$/.exec(t || ""); if (!m) return ""; const h = +m[1], mm = +m[2]; return `${(h % 12) || 12}${mm ? ":" + pad(mm) : ""}${h < 12 ? "am" : "pm"}`; }

  /**
   * One sentence to a plan, or null when it reads like a plain title. Pure.
   * { title, kind, kindLabel, cover, date, dateSuggested, startTime, timeSuggested, headcount, spotsSuggested, place, note, signals }
   */
  function nightFromSentence(text, now = new Date(), opts = {}) {
    const t = String(text || "").replace(/\s+/g, " ").trim(); if (t.length < 10 || t.split(" ").length < 3 || t.length > 200) return null;
    const lo = t.toLowerCase(), cut = []; const o = {};
    const take = (m) => { if (m) cut.push([m.index, m.index + m[0].length]); };
    const today = day0(now);
    // the day
    let m = /\b(this |next |on )?(sun|mon|tue|wed|thu|fri|sat)(?:day|s|nes|nesday|rs|rsday|ur|urday|sday)?\b(?: (?:night|morning|afternoon|evening))?/i.exec(t);
    if (m) { const k = WD.indexOf(m[2].toLowerCase()); let add = (k - today.getDay() + 7) % 7; if (/^next /i.test(m[1] || "") && add < 3) add += 7; o.date = isoOf(plusDays(today, add)); if (m[1] || !/^\s*[a-z]+\s*$/i.test(t.slice(0, m.index)) || !/^[a-z]+day$/i.test(m[0])) take(m); } // "Taco Tuesday" keeps its day in the name
    if (!o.date && (m = /\b(tonight|tomorrow(?: night)?)\b/i.exec(t))) { o.date = isoOf(plusDays(today, /^tomorrow/i.test(m[1]) ? 1 : 0)); take(m); }
    if (!o.date && (m = /\b(this|next) weekend\b/i.exec(t))) { let add = (6 - today.getDay() + 7) % 7; if (m[1].toLowerCase() === "next" && add < 3) add += 7; o.date = isoOf(plusDays(today, add)); take(m); }
    if (!o.date && (m = /\b(?:on )?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? (\d{1,2})(?:st|nd|rd|th)?\b/i.exec(t) || /\b(?:on )?(?:the )?(\d{1,2})(?:st|nd|rd|th)? (?:of )?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i.exec(t))) {
      const mon = MON.indexOf((isNaN(+m[1]) ? m[1] : m[2]).slice(0, 3).toLowerCase()), dd = +(isNaN(+m[1]) ? m[2] : m[1]);
      if (mon >= 0 && dd >= 1 && dd <= 31) { let d = new Date(today.getFullYear(), mon, dd); if (d < today) d = new Date(today.getFullYear() + 1, mon, dd); o.date = isoOf(d); take(m); } }
    // the time
    if ((m = /\b(?:at |from )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(t))) { let h = +m[1]; if (h >= 1 && h <= 12) { if (m[3].toLowerCase() === "pm" && h < 12) h += 12; if (m[3].toLowerCase() === "am" && h === 12) h = 0; o.startTime = `${pad(h)}:${m[2] || "00"}`; take(m); } }
    else if ((m = /\bat (\d{1,2})(?::(\d{2}))?\b(?!\s*(?:people|friends|guests|spots|seats|of us))/i.exec(t))) { let h = +m[1]; if (h >= 1 && h <= 23) { if (h < 8) h += 12; o.startTime = `${pad(h)}:${m[2] || "00"}`; take(m); } }
    else if ((m = /\b(?:at )?noon\b/i.exec(t))) { o.startTime = "12:00"; take(m); }
    // the spots
    if ((m = /\bfor (\d{1,3})\b(?!\s*(?:am|pm|:|\$|dollars|hours?|mins?|minutes|o'?clock|bucks|k\b))(?:\s*(?:people|friends|guests|spots|of us))?/i.exec(t)) && +m[1] >= 2 && +m[1] <= 200) { o.headcount = +m[1]; take(m); }
    else if ((m = /\b(\d{1,3})\s*(?:people|friends|guests|spots|seats|of us)\b/i.exec(t)) && +m[1] >= 2 && +m[1] <= 200) { o.headcount = +m[1]; take(m); }
    else if ((m = /\b(?:party|table|group) of (\d{1,3})\b/i.exec(t)) && +m[1] >= 2) { o.headcount = +m[1]; take(m); }
    else if ((m = new RegExp(`\\bfor (${Object.keys(WORDN).join("|")})\\b(?:\\s*(?:people|friends|guests|of us))?`, "i").exec(t))) { o.headcount = WORDN[m[1].toLowerCase()]; take(m); }
    // a place they typed (never one we made up)
    if ((m = /\bat (my|our) (place|apartment|flat|house|home)\b|\bat (mine|ours)\b/i.exec(t))) { o.place = m[3] ? "My place" : `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2].toLowerCase()}`; take(m); }
    else if ((m = /\b(?:at|in) ((?:the )?[A-Z][\w'&-]*(?: [A-Z][\w'&-]*){0,3})/.exec(t)) && !/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mon|Tue|Wed|Thu|Fri|Sat|Sun)/.test(m[1])) { o.place = m[1]; take(m); }
    const signals = ["date", "startTime", "headcount", "place"].filter((k) => o[k]).length;
    const kind = (KIND_WORDS.find(([, re]) => re.test(lo)) || [""])[0];
    if (signals < 2 && !(signals >= 1 && kind)) return null;
    // the title: the words left once the day, time, spots and place are lifted out
    let rest = t; for (const [a, b] of cut.sort((x, y) => y[0] - x[0])) rest = rest.slice(0, a) + " " + rest.slice(b);
    rest = rest.split(/[,.;!?]/)[0].replace(/\s+/g, " ").trim().replace(/^(?:(?:let'?s|lets|i want to|i'd like to|we should|plan|host|do|make|have|a|an)\s+)+/i, "").replace(/(?:\s+(?:on|at|for|this|next|with|the|and|in|around))+$/i, "").trim();
    let title = rest.length >= 3 ? rest.charAt(0).toUpperCase() + rest.slice(1) : kind ? KIND[kind][0] : ""; if (!title) return null; title = title.slice(0, 80);
    // what's suggested: the kind's usual time, the next good day, the kind's usual size
    const K = KIND[kind] || ["", "19:00", 6];
    if (!o.date) { const want = kind === "book" || kind === "hack" ? 4 : 6; let add = (want - today.getDay() + 7) % 7; if (add < 3) add += 7; o.date = isoOf(plusDays(today, add)); o.dateSuggested = true; }
    if (!o.startTime) { o.startTime = K[1]; o.timeSuggested = true; }
    if (!o.headcount) { o.headcount = K[2]; o.spotsSuggested = true; }
    // a drawn cover from the illustration set that fits the words
    let cover = ""; const A = opts.art || root.EventArt; try { if (A) cover = A.kindsOf({ pubTitle: title })[0] || A.kindOf({ pubTitle: title, activity: kind === "game" ? "game night" : kind }) || ""; } catch {} // the title's own thing first (dumplings), then the kind
    const plan = { title, kind, kindLabel: kind ? KIND[kind][0] : "", cover, date: o.date, dateSuggested: !!o.dateSuggested, startTime: o.startTime, timeSuggested: !!o.timeSuggested, headcount: o.headcount, spotsSuggested: !!o.spotsSuggested, place: o.place || "", signals };
    plan.note = noteFor(plan); return plan; }
  /** The note the host sends with the link. Plain facts from the plan, never a booking or anything we don't know. */
  function noteFor(p) { const when = [dateLabel(p.date), timeLabel(p.startTime)].filter(Boolean).join(" at ");
    return `${p.title}${p.place ? ` at ${/^(my|our) /i.test(p.place) ? p.place.toLowerCase() : p.place}` : ""}, ${when}. ${p.headcount} spots. Are you in? Reply on the invite so I know how many to plan for.`; }
  const pure = { nightFromSentence, noteFor, dateLabel, timeLabel, KIND, KIND_WORDS };
  const api = root.PLCohost = { ...pure };
  if (typeof document === "undefined") return;

  // ================= the card (browser) =================
  const track = (event, props = {}) => { try { fetch("/api/cohost/mark", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event, ...props }), keepalive: true }).catch(() => {}); } catch {} };
  const CSS = `.chn{border:1.5px solid var(--pl-ink,#1B1D1C);border-radius:6px;background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);padding:14px 14px 12px;margin:0 0 14px;font:400 15px/1.45 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);text-align:left}
.chn[hidden]{display:none!important}.chn-h{display:flex;gap:10px;align-items:flex-start;margin:0 0 10px}.chn-h svg{flex:none}.chn-h b{display:block;font:600 18px/1.25 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif)}.chn-h p{margin:2px 0 0;color:var(--pl-soft,#444845);font-size:14px}
.chn-rows{display:grid;gap:0;border-top:1px dashed var(--pl-line,#CFC8B9)}.chn-r{display:grid;grid-template-columns:72px 1fr;gap:8px;align-items:center;padding:8px 0;border-bottom:1px dashed var(--pl-line,#CFC8B9)}
.chn-r>span{font:500 12px/1.3 var(--pl-font-mono,"IBM Plex Mono",monospace);letter-spacing:.04em;text-transform:uppercase;color:var(--pl-soft,#444845)}
.chn-r input,.chn-r select,.chn-r textarea{box-sizing:border-box;width:100%;min-height:44px;height:44px;border:1px solid var(--pl-ink,#1B1D1C);border-radius:6px;background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);font:400 16px/1.3 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);padding:0 10px;margin:0}
.chn-r textarea{height:auto;min-height:88px;padding:8px 10px;resize:vertical;line-height:1.4}.chn-r input:focus-visible,.chn-r select:focus-visible,.chn-r textarea:focus-visible,.chn button:focus-visible{outline:2px solid var(--pl-accent,#29489A);outline-offset:2px}
.chn-two{display:grid;grid-template-columns:1.25fr 1fr;gap:8px}.chn-sug{display:block;margin-top:4px;font-size:13px;color:var(--pl-soft,#444845)}
.chn-step{display:flex;align-items:center;gap:0;border:1px solid var(--pl-ink,#1B1D1C);border-radius:6px;width:max-content}.chn-step button{width:44px;height:44px;border:0;background:none;color:inherit;font:500 20px/1 var(--pl-font-text,"IBM Plex Sans",sans-serif);cursor:pointer}.chn-step output{min-width:36px;text-align:center;font:600 16px var(--pl-font-text,"IBM Plex Sans",sans-serif)}
.chn-cov{display:flex;gap:10px;align-items:center}.chn-cov .chn-art{position:relative;flex:none;width:96px;aspect-ratio:16/10;border-radius:6px;overflow:hidden;border:1px solid var(--pl-ink,#1B1D1C)}
.chn-b{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 14px;border-radius:6px;border:1.5px solid var(--pl-ink,#1B1D1C);background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);font:600 15px/1.2 var(--pl-font-text,"IBM Plex Sans",sans-serif);cursor:pointer;text-align:center;-webkit-tap-highlight-color:transparent}
.chn-b.go{border-color:var(--pl-accent,#29489A);color:var(--pl-accent,#29489A)}.chn-b.q{border-color:transparent;background:none;color:var(--pl-soft,#444845);font-weight:500}
@media (hover:hover){.chn-b:hover{background:var(--pl-raised,#E6E1D5)}}
.chn-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.chn-acts .chn-b{flex:1 1 140px}.chn-fine{margin:8px 0 0;font-size:13px;color:var(--pl-soft,#444845)}
.chn-done{display:grid;gap:8px}.chn-done p{margin:0}.chn-done .chn-note{white-space:pre-wrap;border-left:3px solid var(--pl-line,#CFC8B9);padding-left:10px;color:var(--pl-ink,#1B1D1C)}`;
  const css = () => { if (document.getElementById("chnCss")) return; const s = document.createElement("style"); s.id = "chnCss"; s.textContent = CSS; document.head.appendChild(s); };
  const FACE = `<svg viewBox="0 0 28 28" width="32" height="32" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4.2h8M11.1 4.2v1.7c0 1.2-.9 1.8-.9 2.9 0 1.3-5.5 3.2-5.5 8.9 0 4.5 4.1 7.3 9.3 7.3s9.3-2.8 9.3-7.3c0-5.7-5.5-7.6-5.5-8.9 0-1.1-.9-1.7-.9-2.9V4.2"/><circle cx="11.6" cy="15.6" r=".9" fill="currentColor" stroke="none"/><circle cx="16.4" cy="15.6" r=".9" fill="currentColor" stroke="none"/><path d="M12.7 19.2c.8.55 1.8.55 2.6 0"/></svg>`;
  const TIMES = (() => { const L = []; for (let h = 7; h <= 23; h++) for (const m of [0, 30]) L.push(`${pad(h)}:${pad(m)}`); return L; })();
  function artHTML(kind, title) { const A = root.EventArt; if (!A || !kind) return ""; try { A.ensureCss?.(); return A.cover({ pubTitle: title, coverArt: { kind } }, { kind, title: "", label: "", exact: true }); } catch { return ""; } }
  function coversFor(p) { const A = root.EventArt; let L = []; try { L = A ? A.suggest({ pubTitle: p.title, activity: p.kind }, 6) : []; } catch {} if (p.cover && !L.includes(p.cover)) L.unshift(p.cover); return L.filter(Boolean); }

  /** The card's HTML for a plan. opts.kinds: [[key, label]] for the kind picker (the canvas's own list). */
  function cardHTML(p, opts = {}) { const kinds = opts.kinds || Object.entries(KIND).map(([k, v]) => [k, v[0]]), id = opts.id || "chn";
    return `<div class="chn-h">${FACE}<div><b>Here's your night</b><p>From your sentence. Change anything, or take it as it is.</p></div></div>
      <div class="chn-rows">
        <label class="chn-r"><span>Title</span><input data-chn="title" maxlength="80" value="${esc(p.title)}" aria-label="Title"></label>
        <label class="chn-r"><span>Kind</span><select data-chn="kind" aria-label="Kind"><option value="">Something else</option>${kinds.map(([k, l]) => `<option value="${esc(k)}"${k === p.kind ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
        <div class="chn-r"><span id="${id}WhenL">When</span><div><div class="chn-two"><input type="date" data-chn="date" value="${esc(p.date)}" aria-labelledby="${id}WhenL"><select data-chn="startTime" aria-label="Time">${[...new Set([p.startTime, ...TIMES])].filter(Boolean).sort().map((x) => `<option value="${x}"${x === p.startTime ? " selected" : ""}>${timeLabel(x)}</option>`).join("")}</select></div>${p.dateSuggested || p.timeSuggested ? `<small class="chn-sug">${p.dateSuggested && p.timeSuggested ? "My suggestion for the day and time" : p.dateSuggested ? "My suggestion for the day" : "My suggestion for the time"}. Change it if it doesn't suit.</small>` : ""}</div></div>
        <div class="chn-r"><span id="${id}SpotsL">Spots</span><div><div class="chn-step" role="group" aria-labelledby="${id}SpotsL"><button type="button" data-chn-step="-1" aria-label="One fewer spot">−</button><output data-chn="headcount" aria-live="polite">${p.headcount}</output><button type="button" data-chn-step="1" aria-label="One more spot">+</button></div>${p.spotsSuggested ? `<small class="chn-sug">A usual size for this. Change it if you like.</small>` : ""}</div></div>
        ${opts.cover !== false && p.cover && root.EventArt ? `<div class="chn-r"><span>Cover</span><div class="chn-cov"><span class="chn-art" aria-hidden="true">${artHTML(p.cover, p.title)}</span><button type="button" class="chn-b" data-chn-act="cover">Another drawing</button></div></div>` : ""}
        <label class="chn-r"><span>Note to send</span><textarea data-chn="note" maxlength="300" rows="3" aria-label="Note to send">${esc(p.note)}</textarea></label>
      </div>
      <div class="chn-acts"><button type="button" class="chn-b go" data-chn-act="apply">Looks good</button><button type="button" class="chn-b q" data-chn-act="dismiss">Not now</button></div>
      <p class="chn-fine">Nothing is sent or booked. You send the link when you're ready.</p>`; }
  function doneHTML(p) { return `<div class="chn-done"><div class="chn-h">${FACE}<div><b>Your night is filled in</b><p>Save when you're ready. Here's the note to send with the link.</p></div></div><p class="chn-note">${esc(p.note)}</p>
      <div class="chn-acts"><button type="button" class="chn-b" data-chn-act="copy">Copy the note</button><button type="button" class="chn-b q" data-chn-act="close">Done</button></div></div>`; }

  /**
   * Run one card in a box. host: { box, kinds, onApply(plan), via }. Returns { show(plan), hide(), state }.
   * A tweak changes only the card; Looks good hands the whole plan to onApply.
   */
  function card(host) { const st = { plan: null, covers: [], ci: 0, done: false, tweaked: false, text: "", dismissed: new Set() }; css();
    const box = host.box; box.classList.add("chn"); box.setAttribute("role", "region"); box.setAttribute("aria-label", "Here's your night");
    const read = () => { const P = st.plan; if (!P) return; box.querySelectorAll("[data-chn]").forEach((el) => { const k = el.dataset.chn; if (k === "headcount") return; const v = el.value; if (k === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v)) { if (v !== P.date) P.dateSuggested = false; P.date = v; } else if (k === "startTime" && v) { if (v !== P.startTime) P.timeSuggested = false; P.startTime = v; } else if (k === "title") P.title = v.trim() || P.title; else if (k === "kind") P.kind = v; else if (k === "note") P.note = v; }); };
    const draw = () => { if (!st.plan) { box.hidden = true; box.innerHTML = ""; return; } box.hidden = false; box.innerHTML = st.done ? doneHTML(st.plan) : cardHTML(st.plan, { kinds: host.kinds, id: host.id || "chn" }); };
    box.addEventListener("input", (e) => { if (e.target.dataset?.chn) { st.tweaked = true; const was = st.plan?.note, auto = st.plan && was === noteFor(st.plan); read(); if (auto && e.target.dataset.chn !== "note") { st.plan.note = noteFor(st.plan); const n = box.querySelector('[data-chn="note"]'); if (n) n.value = st.plan.note; } } });
    box.addEventListener("change", (e) => { if (e.target.dataset?.chn) { st.tweaked = true; read(); } });
    box.addEventListener("click", async (e) => { const b = e.target.closest("button"); if (!b || !box.contains(b) || !st.plan) return; const P = st.plan;
      if (b.dataset.chnStep) { const auto = P.note === noteFor(P); P.headcount = Math.max(2, Math.min(200, P.headcount + +b.dataset.chnStep)); P.spotsSuggested = false; st.tweaked = true; box.querySelector('output[data-chn="headcount"]').textContent = P.headcount; if (auto) { P.note = noteFor(P); const n = box.querySelector('[data-chn="note"]'); if (n) n.value = P.note; } return; }
      const act = b.dataset.chnAct;
      if (act === "cover") { read(); if (!st.covers.length) st.covers = coversFor(P); st.ci = (st.ci + 1) % Math.max(1, st.covers.length); P.cover = st.covers[st.ci] || P.cover; st.tweaked = true; const a = box.querySelector(".chn-art"); if (a) a.innerHTML = artHTML(P.cover, P.title); return; }
      if (act === "apply") { read(); try { host.onApply?.({ ...P }); } catch (err) { console.warn(err); } track("cohost_night_applied", { via: host.via, kind: P.kind || "other", tweaked: st.tweaked }); st.done = true; draw(); box.querySelector("[data-chn-act=copy]")?.focus({ preventScroll: true }); return; }
      if (act === "dismiss") { st.dismissed.add(st.text); track("cohost_night_dismissed", { via: host.via }); st.plan = null; draw(); return; }
      if (act === "copy") { try { await navigator.clipboard.writeText(P.note); b.textContent = "Copied"; } catch { b.textContent = "Select the note to copy it"; } return; }
      if (act === "close") { st.plan = null; draw(); } });
    return { st, show(plan, text) { if (!plan || st.dismissed.has(text)) return false; const same = st.plan && !st.done && st.text === text; if (same) return true; const fresh = !st.plan || st.done; st.plan = { ...plan }; st.text = text; st.done = false; st.tweaked = false; st.covers = []; st.ci = 0; draw(); if (fresh) track("cohost_night_shown", { via: host.via, kind: plan.kind || "other" }); return true; },
      hide() { if (st.done) return; st.plan = null; draw(); }, redraw: draw, read }; }
  // a server reading (it can be the model's) when it's on, else the one here: the same shape either way
  async function reading(text, via) { const local = nightFromSentence(text); if (!local) return null;
    try { const r = await fetch("/api/cohost/night", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, via, today: isoOf(new Date()) }) }); if (r.ok) { const j = await r.json(); if (j?.plan?.title) return { ...local, ...j.plan, cover: local.cover || j.plan.cover }; } } catch {}
    return local; }

  // ---------- the create canvas (public/canvas.js hooks: opened, typed, drawn) ----------
  let CV = null; // { card, api }
  function cvBox(a) { const el = a.el(); return el && el.querySelector("#cvNight"); }
  function cvCard(a) { const box = cvBox(a); if (!box) return null; if (CV?.box === box) return CV.card;
    const kinds = (root.EventCanvas?.PLAN_KINDS || []).filter((k) => !k.handoff && k.k !== "other" && k.k !== "table").map((k) => [k.k, k.label]);
    const prev = CV?.card?.st; const c = card({ box, kinds: kinds.length ? kinds : undefined, via: "canvas", id: "cvn", onApply: (P) => a.apply(P) });
    if (prev) { Object.assign(c.st, prev); c.redraw(); } CV = { box, card: c }; return c; }
  let cvT = 0;
  api.typed = (text, a) => { if (!a?.isNew?.()) return; clearTimeout(cvT); cvT = setTimeout(async () => { const c = cvCard(a); if (!c) return; const P = await reading(text, "canvas");
    if (!P) { c.hide(); return; } if (c.show(P, text)) { const fb = a.el()?.querySelector("#cvFromLine"); if (fb) fb.hidden = true; } }, 450); };
  api.drawn = (a) => { const c = cvCard(a); if (c) { c.redraw(); if (c.st.plan && !c.st.done) { const fb = a.el()?.querySelector("#cvFromLine"); if (fb) fb.hidden = true; } } };
  api.opened = (a) => { CV = null; let night = ""; try { const u = new URL(location.href); night = u.searchParams.get("night") || ""; if (u.searchParams.has("night")) { u.searchParams.delete("night"); history.replaceState(history.state, "", u.pathname + u.search + u.hash); } } catch {}
    night = night.replace(/\s+/g, " ").trim().slice(0, 200); if (!night || !a.isNew()) return; a.setTitle(night); api.typed(night, a); };

  // ---------- /start (public/start.html: PLStart.apply and the title field) ----------
  function startHook() { const f = document.getElementById("f"), title = f?.elements?.title, box = document.getElementById("stNight"); if (!title || !box || !root.PLStart) return;
    const c = card({ box, via: "start", id: "stn", onApply: (P) => root.PLStart.apply(P) }); let T = 0;
    title.addEventListener("input", () => { clearTimeout(T); T = setTimeout(() => { const P = nightFromSentence(title.value); if (P) c.show(P, title.value); else c.hide(); }, 450); }); }
  if (location.pathname === "/start") { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startHook); else startHook(); }
})(typeof window !== "undefined" ? window : globalThis);
