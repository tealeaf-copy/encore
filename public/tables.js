// Tables (review round 11): the plan up front, "I'm in if Sam is", open-table questions and "You're at table 2", for the
// full invite (/g, index.html) and the light invite (/e, invite.html). Data: GET /api/public/table/:id (server/tables.js).
// Also the reader for what hosts type: "first 30 min: we teach Root, then play", "6 to 12 people", "come solo welcome".
(function (root) {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const and = (L) => (L.length <= 1 ? L.join("") : L.length === 2 ? `${L[0]} and ${L[1]}` : `${L.slice(0, -1).join(", ")} and ${L[L.length - 1]}`);
  const clock = (t) => { const m = /^(\d{2}):(\d{2})$/.exec(t || ""); if (!m) return ""; let h = +m[1]; const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return `${h}${m[2] === "00" ? "" : ":" + m[2]}${ap}`; };
  const day = (d) => { const x = new Date(String(d || "") + "T12:00:00"); return isNaN(x) ? "" : x.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); };

  // ---------- the reader ----------
  // where a clause about something else starts, so "we teach Root, then play, come solo welcome" stops before "come"
  const NEXT = /,\s*(?=(?:come\b|solo\b|quiet\b|no (?:speeches|talks|icebreakers)|leave\b|beginners?\b|newbies?\b|all levels|noise\b|volume\b|open table|tables? of|host roundtable|co-?host|hosted with|\d{1,3}\s*(?:-|–|to)\s*\d{1,3}\s*(?:people|guests|players|folks|ppl)|max\b|limit\b|cap\b|at\s|@|\$|free\b|every\b|bring\b|(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?s?\b|\d{1,2}(?::\d{2})?\s*(?:am|pm)\b))/i;
  function read(text) {
    const t = String(text || ""), o = { strip: [] }, hit = (re) => { const m = re.exec(t); if (m) o.strip.push(m[0]); return m; };
    let m = hit(/\b(?:(?:the\s+)?first\s*(?:30|thirty)\s*(?:min(?:ute)?s?)?|(?:the\s+)?first half[- ]hour)\s*(?:is|:|-|–|=)?\s*([^.;\n!?]+)/i);
    if (m) { let w = m[1].split(NEXT)[0].trim().replace(/[,\s]+$/, ""); if (w.length >= 3) { o.first30 = (w[0].toUpperCase() + w.slice(1)).slice(0, 220); o.strip[o.strip.length - 1] = m[0].slice(0, m[0].indexOf(m[1]) + m[1].split(NEXT)[0].length); } else o.strip.pop(); }
    if ((m = hit(/\b(\d{1,3})\s*(?:-|–|to)\s*(\d{1,3})\s*(?:people|guests|players|folks|ppl|of us)\b/i))) { const a = +m[1], b = +m[2]; if (a > 0 && b >= a && b <= 500) { o.sizeMin = a; o.sizeMax = b; } }
    const C = [];
    if (hit(/\b(?:come (?:alone|solo)(?: (?:friendly|welcome|ok|is fine))?|solo (?:welcome|friendly|ok|is fine|folks welcome|people welcome|guests welcome)|come by yourself|first[- ]timers welcome)\b/i)) C.push("solo");
    if (hit(/\b(?:beginners? (?:friendly|welcome)|beginner-friendly|newbies? welcome|no experience (?:needed|required)|all levels(?: welcome)?|never played\?? (?:no problem|that's fine|welcome))\b/i)) C.push("beginner");
    if (hit(/\bquiet (?:corner|room|space|area|table)\b/i)) C.push("quiet");
    if (hit(/\bleave (?:any ?time|whenever(?: you like)?|when you like|early,? no worries)\b/i)) C.push("leave");
    if (hit(/\bno (?:speeches|speech|talks|presentations|icebreakers)\b/i)) C.push("nospeech");
    if (C.length) o.comfort = C;
    if ((m = hit(/\b(?:noise|volume)(?: level)?\s*(?:is|:|-)?\s*(low|quiet|medium|moderate|some chatter|loud|lively|high)\b/i))) o.noise = /low|quiet/i.test(m[1]) ? "low" : /medium|moderate|chatter/i.test(m[1]) ? "medium" : "lively";
    if ((m = hit(/\bopen table\b(?:[^.;\n]{0,30}?\btables? of (\d))?/i))) o.openTable = { on: true, size: Math.max(3, Math.min(8, +m[1] || 4)), questions: [] };
    if (hit(/\bhost roundtable\b/i)) o.hostRoundtable = true;
    if ((m = hit(/\b(?:co-?hosted with|co-?hosting with|co-?host(?:ed)?(?: by)?:?|hosting with|with my co-?host)\s+([A-Z][a-zA-Z'’-]+(?:\s(?:and|&)\s[A-Z][a-zA-Z'’-]+)?)/))) o.cohosts = m[1].split(/\s(?:and|&)\s/).map((n) => ({ name: n.trim() }));
    return o;
  }
  /** Take what the reader found out of the other fields it may have landed in (a title, a place, the bring list). */
  function tidy(d, o) {
    if (!o?.strip?.length) return; const S = o.strip.map((x) => x.toLowerCase().trim()).filter((x) => x.length > 3);
    const cut = (v) => { let s = String(v || ""); for (const x of S) { const i = s.toLowerCase().indexOf(x); if (i >= 0) s = (s.slice(0, i) + s.slice(i + x.length)); } return s.replace(/\s*,\s*,/g, ",").replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, "").trim(); };
    for (const k of ["pubTitle", "name", "venueName", "meetPoint", "hood"]) if (d[k] && S.some((x) => String(d[k]).toLowerCase().includes(x) || x.includes(String(d[k]).toLowerCase().trim()))) d[k] = cut(d[k]);
    if (Array.isArray(d.bring)) d.bring = d.bring.filter((b) => !S.some((x) => x.includes(String(b).toLowerCase().trim()) || String(b).toLowerCase().includes(x)));
  }
  function apply(d, text) { const o = read(text); for (const k of ["first30", "sizeMin", "sizeMax", "comfort", "noise", "openTable", "hostRoundtable", "cohosts"]) if (o[k] != null && d[k] == null) d[k] = o[k]; tidy(d, o); return o; }

  // ---------- what guests see ----------
  const COMFORT = { solo: "Come alone friendly", beginner: "Beginner friendly", quiet: "Quiet corner", leave: "Leave anytime", nospeech: "No speeches" };
  const has = (T) => !!T && !!(T.first30 || T.size || (T.comfort || []).length || T.noise || (T.agenda || []).length || (T.cohosts || []).length || T.last);
  /** The plan card: first 30 minutes, group size, start and end, comfort notes, who's in and who came last time. */
  function plan(T) {
    if (!has(T)) return ""; const when = T.start ? `${clock(T.start)}${T.end ? ` to ${clock(T.end)}` : ""}` : "";
    const facts = [T.sizeText && ["Group", `<span class="tb-mono">${esc(T.sizeText)}</span> people`], when && ["Time", `<span class="tb-mono">${esc(when)}</span>`], T.noise && ["Noise", esc(T.noise.label)]].filter(Boolean);
    const names = (T.names || []).length ? `<p class="tb-who"><span class="tb-k">In so far</span> ${and(T.names.map(esc).concat(T.more ? [`<span class="tb-mono">${T.more}</span> more`] : []))}</p>` : "";
    const L = T.last, rest = L ? L.count - Math.min(4, L.names.length) : 0, last = L && L.count ? `<p class="tb-last"><span class="tb-k">Last time</span> <span class="tb-mono">${esc(day(L.date))}</span> · ${L.names.length ? and(L.names.slice(0, 4).map(esc).concat(rest > 0 ? [`<span class="tb-mono">${rest}</span> more`] : [])) : `<span class="tb-mono">${L.count}</span> came`}${(L.back || []).length ? `. ${esc(and(L.back.slice(0, 3)))} ${L.back.length === 1 ? "is" : "are"} back` : ""}</p>` : "";
    return `<section class="tb-plan" id="tbPlan" aria-label="What we're doing">${T.first30 ? `<p class="tb-eyebrow">First 30 minutes</p><p class="tb-first">${esc(T.first30)}</p>` : `<p class="tb-eyebrow">What to expect</p>`}
      ${facts.length ? `<dl class="tb-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>` : ""}
      ${(T.agenda || []).length ? `<ol class="tb-agenda">${T.agenda.map((a) => `<li>${esc(a).replace(/^(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s/i, '<span class="tb-mono">$1</span> ')}</li>`).join("")}</ol>` : ""}
      ${(T.comfort || []).length ? `<ul class="tb-comfort">${T.comfort.map((c) => `<li>${esc(c.label)}</li>`).join("")}</ul>` : ""}
      ${names}${last}${(T.cohosts || []).length ? `<p class="tb-hosts"><span class="tb-k">Hosted by</span> ${esc(and(T.hosts || []))}</p>` : ""}</section>`;
  }
  let gkey = () => { let k = ""; try { k = localStorage.getItem("encore.gkey") || ""; if (!k) { k = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(""); localStorage.setItem("encore.gkey", k); } } catch {} return k; };
  const mineOf = (id) => { try { return JSON.parse(localStorage.getItem("encore-rsvp-" + id) || "null"); } catch { return null; } };
  const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-encore-key": gkey() }, body: JSON.stringify(body) }).then(async (r) => ({ ok: r.ok, j: await r.json().catch(() => ({})) }));
  async function load(id) { const M = mineOf(id), q = M?.rid && M.code ? `?rid=${encodeURIComponent(M.rid)}&code=${encodeURIComponent(M.code)}` : ""; try { const r = await fetch(`/api/public/table/${encodeURIComponent(id)}${q}`); return r.ok ? await r.json() : null; } catch { return null; } }

  /** After the reply form, or in place of it: "I'm in if Sam is", the taste questions, "You're at table 2 with Ada and Lin". */
  function me(box, id, T, host, opts = {}) {
    const M = mineOf(id), m = T?.me, resp = m?.response || M?.response || "", out = [];
    if (m?.table) out.push(`<div class="tb-card tb-seat" id="tbSeat"><p class="tb-eyebrow">Your table</p><p class="tb-big">Table <span class="tb-mono">${m.table.n}</span>${m.table.with.length ? ` with ${esc(and(m.table.with))}` : ""}</p></div>`);
    if (m?.metWith && resp === "going") out.push(`<p class="tb-note" id="tbMet">${esc(m.metWith.split(" ")[0])} is in, so you're in.</p>`);
    if (T?.open && resp === "going" && (T.open.questions || []).length && !m?.table) {
      const A = m?.taste || {}; out.push(`<form class="tb-card tb-taste" id="tbTaste"><p class="tb-eyebrow">Open table</p><p class="tb-big">${m?.taste ? "Your answers" : `${T.open.questions.length === 2 ? "Two" : T.open.questions.length === 3 ? "Three" : "A"} quick question${T.open.questions.length > 1 ? "s" : ""}`}</p><p class="tb-sub">${esc(host || "Your host")} uses these to put you at a table of about <span class="tb-mono">${T.open.size}</span>.</p>
        ${T.open.questions.map((q) => `<fieldset><legend>${esc(q.q)}</legend><div class="tb-opts">${q.options.map((o) => `<label><input type="radio" name="${q.id}" value="${esc(o)}"${A[q.id] === o ? " checked" : ""}><span>${esc(o)}</span></label>`).join("")}</div></fieldset>`).join("")}
        <button class="tb-btn" type="submit">${m?.taste ? "Update" : "Save answers"}</button><p class="tb-msg" role="status"></p></form>`); }
    const canIf = !opts.noIf && !(resp === "going" || resp === "waitlist" || resp === "requested");
    if (canIf) out.push(m?.ifWith ? `<div class="tb-card tb-if" id="tbIf"><p class="tb-big">You're in once ${esc(m.ifWith)} is.</p><p class="tb-sub">We'll tell you when. ${esc(m.ifWith.split(" ")[0])} won't see this.</p><button class="tb-link" type="button" data-tb-ifoff>Change</button></div>`
      : `<details class="tb-card tb-if" id="tbIf"${opts.openIf ? " open" : ""}><summary>I'm in if a friend is</summary><form class="tb-ifform"><p class="tb-sub">Name them. When they reply I'm in, you're in too. They won't see this.</p>
        <label class="tb-f"><span>Their name</span><input name="with" autocomplete="off" required maxlength="60" placeholder="Sam"></label>
        ${M?.rid ? "" : `<label class="tb-f"><span>Your name</span><input name="me" autocomplete="name" required maxlength="80"></label><label class="tb-f"><span>Your email</span><input name="email" type="email" autocomplete="email" maxlength="200"><small>So we can tell you when you're in.</small></label>`}
        <button class="tb-btn" type="submit">Save</button><p class="tb-msg" role="status"></p></form></details>`);
    box.innerHTML = out.join(""); box.hidden = !out.length;
    const msg = (f, t) => { const p = f.querySelector(".tb-msg"); if (p) p.textContent = t; };
    box.querySelector("#tbTaste")?.addEventListener("submit", async (ev) => { ev.preventDefault(); const f = ev.target, A = {}; for (const q of T.open.questions) { const x = f.querySelector(`input[name=${q.id}]:checked`); if (x) A[q.id] = x.value; }
      const r = await post(`/api/public/table/${encodeURIComponent(id)}/taste`, { rid: M?.rid, code: M?.code, answers: A }); msg(f, r.ok ? "Saved. You'll see your table here once it's set." : r.j.message || "Couldn't save that."); });
    box.querySelector("[data-tb-ifoff]")?.addEventListener("click", async () => { await post(`/api/public/table/${encodeURIComponent(id)}/ifwith`, { rid: M?.rid, code: M?.code, name: "" }); const T2 = await load(id); me(box, id, T2, host, { ...opts, openIf: true }); });
    box.querySelector(".tb-ifform")?.addEventListener("submit", async (ev) => { ev.preventDefault(); const f = ev.target, b = f.querySelector("button"), val = (n) => f.querySelector(`[name=${n}]`)?.value?.trim() || ""; b.disabled = true;
      const em = val("email"), body = M?.rid ? { rid: M.rid, code: M.code, name: val("with") } : { name: val("with"), me: val("me"), ...(/@/.test(em) ? { email: em } : em ? { phone: em } : {}) };
      const r = await post(`/api/public/table/${encodeURIComponent(id)}/ifwith`, body); b.disabled = false; if (!r.ok) return msg(f, r.j.message || "Couldn't save that.");
      if (r.j.rid) { try { localStorage.setItem("encore-rsvp-" + id, JSON.stringify({ rid: r.j.rid, code: r.j.code, name: val("me"), gi: -1, response: r.j.response || "maybe", wall: false, eventId: id, data: {} })); } catch {} }
      if (opts.onChange) return opts.onChange(r.j); const T2 = await load(id); me(box, id, T2, host, opts); });
  }
  root.Tables = { read, tidy, apply, plan, me, load, has, clock, COMFORT };

  // ---------- the light invite (/e/:id, public/invite.html): the plan above the cover, their bits under the reply ----------
  if (typeof document !== "undefined" && /^\/e\/[A-Za-z0-9_-]{2,80}/.test(location.pathname)) {
    const id = location.pathname.split("/")[2]; let T = null, state = "", busy = false, timer = null;
    if (!document.querySelector('link[href="/tables.css"]')) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/tables.css"; document.head.appendChild(l); }
    const run = async () => { if (busy) return; const m = document.getElementById("m"), cov = m && m.querySelector(".cov"); if (!cov) return; const now = document.getElementById("tk") ? "tk" : document.getElementById("f") ? "f" : ""; if (!now) return;
      if (now === state && document.getElementById("tbMe")) return; busy = true;
      try { if (!T || now !== state) T = await load(id); state = now; if (!T) return;
        if (!document.getElementById("tbPlan")) { const h = plan(T); if (h) cov.insertAdjacentHTML("beforebegin", h); }
        let box = document.getElementById("tbMe"); if (!box) { box = document.createElement("div"); box.id = "tbMe"; } (document.getElementById("tk") || document.getElementById("f"))?.after(box);
        me(box, id, T, (T.hosts || [])[0] || "", { noIf: T.past, onChange: () => location.reload() }); } finally { busy = false; } };
    new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(run, 120); }).observe(document.documentElement, { childList: true, subtree: true });
  }
})(typeof window !== "undefined" ? window : globalThis);
