// Paid memberships (server/memberships.js) on a host's page, at #membership, and a small card on the host's Home.
// A guest sees "Become a member": the tiers, what each gets, a monthly or yearly switch, then Stripe Checkout. A member
// sees "You're a member · Patron", their perks, the next dates with their own early-access times, and Manage (the
// Stripe Customer Portal). The host sees how close they are (5 events that happened), then "Start a membership": up to
// three tiers at $5, $10 or $20 a month, Connect Stripe, open; then members, monthly revenue, churn, a note to members,
// each date's members window and held seats, and their Stripe payouts.
// In the iPhone and Android apps nothing here sells: no prices and no buy button, only "You can join on the web",
// opened in the browser (App Store guideline 3.1.1). The server refuses Checkout from the app too.
// The card is drawn from what the page already has (d.membership on GET /api/public/host/:handle); the host's own
// numbers come from GET /api/host/membership.
(function () {
  if (window.EncoreMembership) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const send = async (url, body) => { const r = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.message || "That didn't work. Try again."), { code: j.code }); return j; };
  const get = async (url) => { const r = await fetch(url, { credentials: "same-origin" }); return r.ok ? r.json() : null; };
  const n = (c, one, many) => `${c} ${c === 1 ? one : many}`;
  const day = (t) => (t ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
  const evDay = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || "") ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "");
  const usd = (x) => "$" + (Math.round(x * 100) % 100 ? (+x).toFixed(2) : String(Math.round(x)));
  const hrs = (h) => (h >= 168 && h % 168 === 0 ? (h === 168 ? "a week" : `${h / 168} weeks`) : h >= 24 && h % 24 === 0 ? (h === 24 ? "1 day" : `${h / 24} days`) : `${h} hours`);
  const isApp = () => document.documentElement.classList.contains("is-native") || !!window.Capacitor?.isNativePlatform?.();
  /** Out of the app to the browser (the Capacitor Browser plugin), or a new tab on the web. */
  const openWeb = (url) => { const B = window.Capacitor?.Plugins?.Browser; if (isApp() && B) return B.open({ url }); window.open(url, "_blank", "noopener"); };
  const localInput = (ms) => { if (!ms) return ""; const d = new Date(ms), p = (x) => String(x).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const CSS = `.mem{display:grid;gap:10px;padding:16px;margin-top:12px;border:1.5px solid var(--pl-line-strong,#1B1D1C);border-radius:var(--pl-r-md,6px);background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);scroll-margin-top:84px;min-width:0}
.mem-k{margin:0;font:500 13px/1.3 var(--pl-font-mono,"IBM Plex Mono",ui-monospace,monospace);letter-spacing:.06em;text-transform:uppercase;color:var(--pl-soft,#444845)}
.mem h3{margin:0;font-size:20px;line-height:1.25}.mem h4{margin:8px 0 0;font-size:15px;line-height:1.3}.mem p{margin:0;font-size:15px;line-height:1.5}.mem .mem-m{color:var(--pl-soft,#444845);font-size:14px}
.mem ul{list-style:none;margin:0;padding:0;border-top:1px dashed var(--pl-line,#CFC8B9)}.mem li{padding:8px 0;border-bottom:1px dashed var(--pl-line,#CFC8B9);font-size:15px;line-height:1.4;display:flex;justify-content:space-between;align-items:center;gap:10px;min-width:0}.mem li > span{min-width:0;display:grid}.mem li small{color:var(--pl-soft,#444845);font-size:13px}
.mem-b{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;border-radius:var(--pl-r-btn,6px);border:1.5px solid var(--pl-line-strong,#1B1D1C);background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);font:600 15px var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);cursor:pointer;text-decoration:none;justify-self:start;text-align:center}
.mem-b.pri{background:var(--pl-accent,#29489A);border-color:var(--pl-accent,#29489A);color:var(--pl-on-accent,#fff)}.mem-b[disabled]{opacity:.55;cursor:default}.mem-b.wide{justify-self:stretch}
.mem-q{display:inline-flex;align-items:center;min-height:44px;padding:0;border:0;background:none;color:var(--pl-soft,#444845);font:400 14px var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);text-decoration:underline;text-underline-offset:3px;cursor:pointer;justify-self:start}
.mem :is(.mem-b,.mem-q,input,select,textarea,.mem-seg label):focus-visible{outline:3px solid var(--pl-accent,#29489A);outline-offset:2px}
.mem-row{display:flex;flex-wrap:wrap;gap:4px 16px;align-items:center}
.mem-seg{display:grid;grid-template-columns:1fr 1fr;border:1.5px solid var(--pl-line-strong,#1B1D1C);border-radius:var(--pl-r-md,6px);overflow:hidden}.mem-seg label{display:flex;align-items:center;justify-content:center;gap:6px;min-height:44px;font:600 15px var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);cursor:pointer;text-align:center;padding:0 8px}
.mem-seg input{position:absolute;opacity:0;width:1px;height:1px}.mem-seg label:has(input:checked){background:var(--pl-ink,#1B1D1C);color:var(--pl-surface,#FAF8F3)}.mem-seg label:has(input:focus-visible){outline:3px solid var(--pl-accent,#29489A);outline-offset:-3px}.mem-seg small{font-weight:400;font-size:13px}
.mem-tier{display:grid;gap:6px;padding:12px;border:1.5px solid var(--pl-line,#CFC8B9);border-radius:var(--pl-r-md,6px);background:var(--pl-page,#EFEBE2)}.mem-tier.top{border-color:var(--pl-line-strong,#1B1D1C)}
.mem-tier .mem-tn{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap}.mem-tier b{font-size:17px}.mem-tier .mem-pr{font:600 16px var(--pl-font-mono,"IBM Plex Mono",ui-monospace,monospace)}
.mem-tier ul{border:0}.mem-tier li{border:0;padding:2px 0 2px 18px;position:relative;display:block;font-size:14px}.mem-tier li::before{content:"";position:absolute;left:2px;top:.62em;width:8px;height:8px;border-radius:2px;background:var(--pl-accent,#29489A)}
.mem label.mem-f{display:grid;gap:4px;font-weight:600;font-size:14px;min-width:0}.mem label.mem-f small{font-weight:400;font-size:13px;color:var(--pl-soft,#444845)}
.mem input:not([type=checkbox]):not([type=radio]),.mem select,.mem textarea{min-height:44px;padding:0 12px;border:1.5px solid var(--pl-line-strong,#1B1D1C);border-radius:var(--pl-r-md,6px);background:var(--pl-page,#EFEBE2);color:inherit;font:400 16px var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);min-width:0;width:100%;box-sizing:border-box}
.mem textarea{padding:10px 12px;min-height:96px;line-height:1.45;resize:vertical}
.mem label.mem-sw{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px;padding:4px 0;font-weight:400;font-size:15px;cursor:pointer}.mem-sw span{display:grid;gap:2px;min-width:0}.mem-sw small{font-size:13px;color:var(--pl-soft,#444845)}
.mem-sw input{appearance:none;-webkit-appearance:none;flex:none;width:48px;height:28px;margin:8px 0;border-radius:999px;background:var(--pl-line-strong,#1B1D1C);opacity:.35;position:relative;cursor:pointer}.mem-sw input::after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;transition:transform .15s}.mem-sw input:checked{background:var(--pl-accent,#29489A);opacity:1}.mem-sw input:checked::after{transform:translateX(20px)}
@media (prefers-reduced-motion:reduce){.mem-sw input::after{transition:none}}
.mem-grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}.mem-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.mem-stats div{display:grid;gap:2px;padding:10px;border:1.5px solid var(--pl-line,#CFC8B9);border-radius:var(--pl-r-md,6px);background:var(--pl-page,#EFEBE2);min-width:0}.mem-stats b{font:600 18px var(--pl-font-mono,"IBM Plex Mono",ui-monospace,monospace)}.mem-stats small{font-size:13px;color:var(--pl-soft,#444845)}
.mem-bar{height:8px;border-radius:4px;background:var(--pl-line,#CFC8B9);overflow:hidden}.mem-bar i{display:block;height:100%;background:var(--pl-accent,#29489A)}
.mem-ev{display:grid;gap:8px;padding:10px 0;border-bottom:1px dashed var(--pl-line,#CFC8B9)}.mem-ev:first-of-type{border-top:1px dashed var(--pl-line,#CFC8B9)}
.mem-note{padding:10px 12px;border-left:3px solid var(--pl-accent,#29489A);background:var(--pl-page,#EFEBE2)}.mem-note small{display:block;margin-top:4px;color:var(--pl-soft,#444845);font-size:13px}
.mem-err{color:var(--pl-danger,#A2361A);font-size:14px}.mem-ok{color:var(--pl-soft,#444845);font-size:14px}.mem-check li{justify-content:flex-start}.mem-check li b{flex:none;width:20px;font:600 14px var(--pl-font-mono,"IBM Plex Mono",ui-monospace,monospace)}
#memHome{margin:12px 0 20px}#memHome .mem{margin:0}`;
  const style = () => { if (document.getElementById("memCss")) return; const st = document.createElement("style"); st.id = "memCss"; st.textContent = CSS; document.head.appendChild(st); };
  const status = (me) => (me.pastDue ? "Your last payment didn't go through. Update your card in Manage to keep your perks." : me.cancelling ? `Your membership ends ${day(me.periodEnd)}. Your perks last until then.` : me.periodEnd ? `Renews ${day(me.periodEnd)}, ${me.interval === "year" ? "yearly" : "monthly"}.` : "");

  // ---------- the fan club card's line (public/fanclub.js asks) ----------
  function clubLine(d) { const m = d?.membership, H = m?.host; if (!H || H.on) return "";
    if (!H.eligible) return `<p class="club-m">${esc(H.need)} more ${H.need === 1 ? "event" : "events"} and you can start a paid membership.</p>`;
    return `<p class="club-m"><a href="#membership">Start a membership</a>: regulars back you each month and get first dibs.</p>`; }

  // ---------- the host page card ----------
  function mount(h, d) {
    const side = document.querySelector("aside.side"), m = d?.membership; if (!side || !h?.handle || h.showcase || d.sample || !m || document.getElementById("membership")) return;
    const own = !!m.host; if (!own && (!m.on || m.removed)) return; if (own && !m.host.eligible && !m.host.count) return; // a brand-new host: nothing to show yet
    style(); const box = document.createElement("section"); box.className = "mem"; box.id = "membership"; box.setAttribute("aria-labelledby", "memH");
    const club = document.getElementById("club"); if (club) club.after(box); else side.prepend(box);
    const hostName = String(d.person || h.name || "the host").trim().split(/\s+/)[0].replace(/['’]s$/i, ""), handle = h.handle, api = "/api/me/membership/" + encodeURIComponent(handle), app = isApp() || !!m.webOnly;
    const S = { m, iv: "month", err: "", ok: "", view: "", H: null, draft: null };
    const $ = (q) => box.querySelector(q), err = (t) => { S.err = t || ""; const e = $(".mem-err"); if (e) e.textContent = S.err; };
    const show = (view, draw) => { S.view = view; S.err = ""; draw(); const t = $("#memH"); if (t) { t.tabIndex = -1; t.focus({ preventScroll: true }); } };
    const foot = () => `<p class="mem-err" role="alert">${esc(S.err)}</p><p class="mem-ok" role="status">${esc(S.ok)}</p>`;

    // ---- a guest, a member ----
    function guest() { const M = S.m;
      if (M.me) return member();
      const tiers = M.tiers || [], save = Math.max(0, ...tiers.map((t) => t.save || 0)), top = tiers.length ? tiers[tiers.length - 1].id : "";
      const price = (t) => (app ? "" : S.iv === "year" ? `${usd(t.yearly)} a year` : `${usd(t.monthly)} a month`);
      box.innerHTML = `<p class="mem-k">Membership${M.members ? " · " + n(M.members, "member", "members") : ""}</p><h3 id="memH">Become a member</h3>
        <p>Back ${esc(hostName)}'s events and get in first.</p>
        ${app ? "" : `<div class="mem-seg" role="radiogroup" aria-label="How often you pay"><label><input type="radio" name="memIv" value="month"${S.iv === "month" ? " checked" : ""}>Monthly</label><label><input type="radio" name="memIv" value="year"${S.iv === "year" ? " checked" : ""}>Yearly${save ? ` <small>save ${save}%</small>` : ""}</label></div>`}
        ${tiers.map((t) => `<div class="mem-tier${t.id === top && tiers.length > 1 ? " top" : ""}"><div class="mem-tn"><b>${esc(t.name)}</b>${price(t) ? `<span class="mem-pr">${esc(price(t))}</span>` : ""}</div>${t.line ? `<p class="mem-m">${esc(t.line)}</p>` : ""}
          <ul>${(t.perks || []).map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
          ${app || !M.accepting ? "" : M.signedIn ? `<button type="button" class="mem-b${t.id === top ? " pri" : ""} wide" data-join="${esc(t.id)}">Join as ${esc(t.name)}</button>` : ""}</div>`).join("")}
        ${app ? `<p class="mem-m">You can join on the web.</p><button type="button" class="mem-b pri" data-web>Open in your browser</button>`
          : !M.accepting ? `<p class="mem-m">${esc(hostName)} isn't taking new members right now.</p>`
          : !M.signedIn ? `<a class="mem-b pri" href="/signup?mode=friends&next=${encodeURIComponent("/@" + handle + "#membership")}">Make a free account to join</a>` : ""}
        ${app ? "" : `<p class="mem-m">Payments by Stripe. Cancel any time from Manage, and your perks last until the end of what you paid for.</p>`}${foot()}`;
      box.querySelectorAll("input[name=memIv]").forEach((r) => (r.onchange = () => { S.iv = r.value; guest(); box.querySelector(`input[name=memIv][value="${r.value}"]`)?.focus(); }));
      box.querySelectorAll("[data-join]").forEach((b) => (b.onclick = async () => { b.disabled = true; const was = b.textContent; b.textContent = "Opening Stripe…"; err("");
        try { const j = await send(api + "/checkout", { tier: b.dataset.join, interval: S.iv }); location.href = j.url; } catch (e) { b.disabled = false; b.textContent = was; err(e.message); } }));
      const w = $("[data-web]"); if (w) w.onclick = () => openWeb(M.joinUrl || location.href.split("#")[0] + "#membership"); }
    function member() { const me = S.m.me, early = me.early || [];
      box.innerHTML = `<p class="mem-k">Membership</p><h3 id="memH">You're a member · ${esc(me.name)}</h3>
        <p>Thank you for backing ${esc(hostName)}. ${esc(status(me))}</p>
        ${me.perks?.length ? `<h4>What you get</h4><ul>${me.perks.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
        ${early.length ? `<h4>Your early access</h4><ul>${early.map((e) => `<li><span><a href="/e/${encodeURIComponent(e.id)}">${esc(e.title)}</a><small>${esc([evDay(e.date), e.only ? "Members only" : e.canBook ? `Book now. Opens to everyone ${e.public}.` : `Yours opens ${e.opens}.`].filter(Boolean).join(" · "))}</small></span></li>`).join("")}</ul>` : `<p class="mem-m">No dates out yet. You'll hear first when there are.</p>`}
        ${(me.notes || []).map((x) => `<div class="mem-note"><p>${esc(x.text)}</p><small>${esc(hostName)} · ${esc(day(x.at))}</small></div>`).join("")}
        <div class="mem-row">${app ? `<button type="button" class="mem-b" data-web>Manage on the web</button>` : `<button type="button" class="mem-b" data-manage>Manage</button>`}</div>
        <p class="mem-m">${app ? "Changes and cancelling happen on the web." : "Change your tier, update your card or cancel in Manage."}</p>${foot()}`;
      const mg = $("[data-manage]"); if (mg) mg.onclick = async () => { mg.disabled = true; try { const j = await send(api + "/portal"); location.href = j.url; } catch (e) { mg.disabled = false; err(e.message); } };
      const w = $("[data-web]"); if (w) w.onclick = () => openWeb(S.m.joinUrl); }
    // back from Checkout: the webhook may take a moment, so look again a few times
    if (!own && /[?&]member=welcome\b/.test(location.search) && !m.me) { S.ok = "Welcome in. It can take a minute to show here."; let k = 0;
      const again = async () => { const j = await get("/api/public/membership/" + encodeURIComponent(handle)); if (j?.me) { S.m = j; S.ok = ""; guest(); window.PLFx?.stamp?.("Member", $("h3"), { small: true }); return; } if (++k < 8) setTimeout(again, 2500); }; setTimeout(again, 1500); }

    // ---- the host ----
    async function load() { const q = /[?&]membership=connected\b/.test(location.search) ? "?refresh=1" : ""; const j = await get("/api/host/membership" + q); if (j) S.H = j; return j; }
    function host() { const H = S.H, E = H?.eligibility || { count: m.host.count, need: m.host.need, eligible: m.host.eligible, at: 5 };
      if (!E.eligible) { box.innerHTML = `<p class="mem-k">Only you see this</p><h3 id="memH">Memberships</h3><p><b>${esc(E.need)} more ${E.need === 1 ? "event" : "events"} and you can start a membership.</b></p>
          <div class="mem-bar" role="img" aria-label="${esc(E.count)} of ${esc(E.at)} events"><i style="width:${Math.min(100, (E.count / E.at) * 100)}%"></i></div>
          <p class="mem-m">Once you've hosted ${esc(E.at)} events that people came to, your regulars can back you with $5, $10 or $20 a month and get first dibs on your dates.</p>`; return; }
      if (!H) { box.innerHTML = `<p class="mem-k">Only you see this</p><h3 id="memH">Start a membership</h3><p class="mem-m">Loading…</p>`; return; }
      if (!H.payments.on) { const L = H.payments.checklist;
        box.innerHTML = `<p class="mem-k">Only you see this</p><h3 id="memH">Start a membership</h3><p>Memberships need payments set up. We'll let you know when they're on.</p>
          ${L ? `<h4>Setup checklist (you're the owner)</h4><ul class="mem-check">${L.map((x) => `<li><b>${x.ok === true ? "ok" : x.ok === false ? "no" : "?"}</b><span>${esc(x.text)}</span></li>`).join("")}</ul><p class="mem-m">Steps in docs/memberships.md.</p>` : ""}`; return; }
      if (S.view === "setup" || (!H.membership.on && S.view !== "intro" && H.membership.tiers.length)) return setup();
      if (!H.membership.on) { box.innerHTML = `<p class="mem-k">Only you see this</p><h3 id="memH">Start a membership</h3>
          <p>You've hosted ${esc(E.count)} events. Your regulars can now back you every month.</p>
          <ul><li>Up to 3 tiers, at $5, $10 or $20 a month, or yearly</li><li>Members get in first: higher tiers earlier</li><li>Hold a few seats for members, or make a date members only</li><li>Stripe pays you out. Pottery Lab ${H.payments.feeBps ? `keeps ${H.payments.feeBps / 100}%` : "takes nothing"}.</li></ul>
          <button type="button" class="mem-b pri" data-start>Start a membership</button>${app ? `<p class="mem-m">Setting up payments happens on the web.</p>` : ""}${foot()}`;
        $("[data-start]").onclick = () => show("setup", setup); return; }
      return dash(); }
    function draftOf() { if (S.draft) return S.draft; const H = S.H, D = H.options.defaults, cur = H.membership.tiers;
      S.draft = { seatsN: H.membership.seatsN, freeEarly: H.membership.freeEarly, tiers: H.options.amounts.map((a) => { const t = cur.find((x) => x.monthly === a), d0 = D[a]; return { on: cur.length ? !!t : a !== 10, monthly: a, name: t?.name || d0.name, line: t?.line ?? d0.line, yearly: t?.yearly ?? a * H.options.yearly.x, perks: { ...(t?.perks || d0.perks) } }; }) }; return S.draft; }
    function setup() { const H = S.H, D = draftOf(), hours = H.options.earlyHours, Y = H.options.yearly, A = H.account;
      const sw = (i, k, label, sub) => `<label class="mem-sw"><span>${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ""}</span><input type="checkbox" data-t="${i}" data-p="${k}"${D.tiers[i].perks[k] ? " checked" : ""}></label>`;
      box.innerHTML = `<p class="mem-k">Only you see this</p><h3 id="memH">${H.membership.on ? "Your tiers" : "Start a membership"}</h3>
        <p class="mem-m">Pick up to 3. Higher tiers get in earlier. Members already on a tier keep their price when you change it.</p>
        ${D.tiers.map((t, i) => `<div class="mem-tier${t.on ? " top" : ""}"><label class="mem-sw"><span><b>${usd(t.monthly)} a month</b></span><input type="checkbox" data-on="${i}"${t.on ? " checked" : ""} aria-label="Offer the ${usd(t.monthly)} tier"></label>
          ${t.on ? `<label class="mem-f">Name<input data-f="name" data-t="${i}" maxlength="40" value="${esc(t.name)}"></label><label class="mem-f">One line<input data-f="line" data-t="${i}" maxlength="100" value="${esc(t.line)}"></label>
          <label class="mem-f">Yearly price<input data-f="yearly" data-t="${i}" inputmode="decimal" value="${esc(t.yearly)}"><small>${usd(t.monthly * Y.min)} to ${usd(t.monthly * Y.max)}. ${usd(t.monthly * Y.x)} is 2 months free.</small></label>
          ${sw(i, "early", "Book before everyone else")}${t.perks.early ? `<label class="mem-f">How early<select data-f="earlyHours" data-t="${i}">${hours.map((x) => `<option value="${x}"${x === t.perks.earlyHours ? " selected" : ""}>${esc(hrs(x))}</option>`).join("")}</select></label>` : ""}
          ${sw(i, "seats", "Seats held for members", "Released to everyone when it opens")}${sw(i, "only", "Members-only events")}${sw(i, "badge", "A member badge")}${sw(i, "note", "A monthly note from you")}` : ""}</div>`).join("")}
        <label class="mem-f">Seats to hold for members at each event<input id="memSeatsN" type="number" min="0" max="${H.options.seatsMax}" value="${esc(D.seatsN)}"><small>Never more than half the event. Change it per date later.</small></label>
        <label class="mem-sw"><span>Free fan club members get early access too<small>With your lowest tier. Off: they book with everyone else.</small></span><input type="checkbox" id="memFree"${D.freeEarly ? " checked" : ""}></label>
        <div class="mem-row"><button type="button" class="mem-b${A.chargesEnabled ? "" : " pri"}" data-save>${H.membership.on ? "Save" : "Save tiers"}</button>${H.membership.on ? `<button type="button" class="mem-q" data-back>Back</button>` : ""}</div>
        ${H.membership.on ? "" : `<h4>Then get paid</h4>${A.chargesEnabled ? `<p class="mem-m">Stripe is connected. Open memberships when your tiers look right.</p><button type="button" class="mem-b pri" data-open>Open memberships</button>`
          : `<p class="mem-m">Stripe pays you out, straight to your bank. It takes about 5 minutes and needs your name, address and bank details.</p>${app ? `<button type="button" class="mem-b" data-web>Connect Stripe on the web</button>` : `<button type="button" class="mem-b" data-connect>${A.connected ? "Finish Stripe setup" : "Connect Stripe"}</button>`}`}`}${foot()}`;
      S.ok = "";
      const keep = () => { box.querySelectorAll("[data-f]").forEach((el) => { const t = D.tiers[+el.dataset.t]; if (el.dataset.f === "earlyHours") t.perks.earlyHours = +el.value; else t[el.dataset.f] = el.value; }); D.seatsN = +$("#memSeatsN").value || 0; D.freeEarly = $("#memFree").checked; };
      box.querySelectorAll("[data-on]").forEach((el) => (el.onchange = () => { keep(); D.tiers[+el.dataset.on].on = el.checked; setup(); box.querySelector(`[data-on="${el.dataset.on}"]`)?.focus(); }));
      box.querySelectorAll("[data-p]").forEach((el) => (el.onchange = () => { keep(); D.tiers[+el.dataset.t].perks[el.dataset.p] = el.checked; if (el.dataset.p === "early") { setup(); box.querySelector(`[data-t="${el.dataset.t}"][data-p="early"]`)?.focus(); } }));
      const body = () => ({ tiers: D.tiers.filter((t) => t.on).map((t) => ({ monthly: t.monthly, name: t.name.trim(), line: t.line.trim(), yearly: t.yearly, perks: t.perks })), seatsN: D.seatsN, freeEarly: D.freeEarly });
      const save = async (b, extra = {}) => { keep(); if (!D.tiers.some((t) => t.on)) { err("Pick at least one tier."); return null; } b.disabled = true; err("");
        try { const j = await send("/api/host/membership", { ...body(), ...extra }); S.H = { ...S.H, ...j }; S.draft = null; return j; } catch (e) { err(e.message); return null; } finally { b.disabled = false; } };
      $("[data-save]").onclick = async (ev) => { const j = await save(ev.currentTarget); if (j) { S.ok = "Saved."; if (S.H.membership.on) { S.view = ""; host(); } else setup(); } };
      const bk = $("[data-back]"); if (bk) bk.onclick = () => { S.draft = null; show("", host); };
      const cn = $("[data-connect]"); if (cn) cn.onclick = async () => { const j0 = await save(cn); if (!j0) return; cn.disabled = true; cn.textContent = "Opening Stripe…"; try { const j = await send("/api/host/membership/connect"); location.href = j.url; } catch (e) { cn.disabled = false; cn.textContent = "Connect Stripe"; err(e.message); } };
      const op = $("[data-open]"); if (op) op.onclick = async () => { const j = await save(op, { open: true }); if (j) { S.view = ""; host(); window.PLFx?.stamp?.("Open", $("h3"), { small: true }); } };
      const w = $("[data-web]"); if (w) w.onclick = () => openWeb(m.joinUrl); }
    function dash() { const H = S.H, st = H.stats, mem = H.members, evs = H.events, tiers = H.membership.tiers;
      if (S.view === "note") return note(); if (S.view === "dates") return dates();
      box.innerHTML = `<p class="mem-k">Your membership${H.membership.closing ? " · closing" : ""}</p><h3 id="memH">${n(st.members, "member", "members")}</h3>
        <div class="mem-stats"><div><b>${usd(st.mrr)}</b><small>a month, about</small></div><div><b>${st.joined30}</b><small>new in 30 days</small></div><div><b>${st.churn30}%</b><small>left in 30 days</small></div></div>
        ${st.pastDue ? `<p class="mem-m">${n(st.pastDue, "member's card", "members' cards")} didn't go through. Stripe will try again and let them know.</p>` : ""}
        <h4 id="memMemH">Members</h4>
        ${mem.length ? `<ul aria-labelledby="memMemH">${mem.slice(0, 50).map((x) => `<li><span>${esc(x.name)}<small>${esc([x.tier, x.interval === "year" ? "yearly" : "monthly", x.since ? "since " + day(x.since) : "", x.status].filter(Boolean).join(" · "))}</small></span>${x.live ? `<button type="button" class="mem-q" data-rm="${esc(x.key)}" data-label="Remove" aria-label="Remove ${esc(x.name)}">Remove</button>` : ""}</li>`).join("")}</ul>
          <p class="mem-m">Removing someone ends their perks now and stops their payments at the end of the period. Refunds are yours to give in Stripe.</p>` : `<p class="mem-m">Nobody yet. Share your page: the Become a member card is on it.</p>`}
        <div class="mem-row"><button type="button" class="mem-b" data-note>Message members</button><button type="button" class="mem-b" data-dates>Your dates</button></div>
        ${tiers.some((t) => t.perks.note) ? `<p class="mem-m">${H.membership.lastNoteAt ? `Your last note went out ${day(H.membership.lastNoteAt)}.` : "Your monthly note hasn't gone out yet."}</p>` : ""}
        <div class="mem-row"><button type="button" class="mem-q" data-stripe>Payouts in Stripe</button><button type="button" class="mem-q" data-edit>Edit tiers</button>${H.membership.accepting ? `<button type="button" class="mem-q" data-close data-label="Stop taking members">Stop taking members</button>` : ""}</div>${foot()}`;
      S.ok = "";
      $("[data-note]").onclick = () => show("note", note); $("[data-dates]").onclick = () => show("dates", dates); $("[data-edit]").onclick = () => show("setup", setup);
      $("[data-stripe]").onclick = async (ev) => { const b = ev.currentTarget; b.disabled = true; try { const j = await send("/api/host/membership/dashboard"); openWeb(j.url); } catch (e) { err(e.message); } b.disabled = false; };
      box.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async () => { if (!b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "Tap again to remove"; return; } b.disabled = true; try { await send("/api/host/membership/members/" + encodeURIComponent(b.dataset.rm) + "/remove"); await load(); S.ok = "Removed. Their payments stop at the end of the period."; dash(); } catch (e) { b.disabled = false; err(e.message); } }));
      const cl = $("[data-close]"); if (cl) cl.onclick = async () => { if (!cl.dataset.sure) { cl.dataset.sure = "1"; cl.textContent = "Tap again: every membership ends with its paid period"; return; } cl.disabled = true; try { const j = await send("/api/host/membership", { open: false }); S.H = { ...S.H, ...j }; S.ok = "No new members. Each membership ends with its paid period."; dash(); } catch (e) { cl.disabled = false; err(e.message); } };
      void evs; }
    function note() { const H = S.H, tiers = H.membership.tiers;
      box.innerHTML = `<p class="mem-k">Your membership</p><h3 id="memH">A note to members</h3>
        <label class="mem-f">Your note<textarea id="memNote" maxlength="${H.options.noteMax}" placeholder="Next month: pork and chive. Patrons, pick the date."></textarea><small>Their bell and one email. Members who muted your club don't get it.</small></label>
        <label class="mem-f">Who gets it<select id="memWho"><option value="1">Every member</option>${tiers.filter((t) => t.rank > 1).map((t) => `<option value="${t.rank}">${esc(t.name)}${t.rank < 3 ? " and up" : ""}</option>`).join("")}</select></label>
        <div class="mem-row"><button type="button" class="mem-b pri" data-send>Send the note</button><button type="button" class="mem-q" data-back>Back</button></div>${foot()}
        ${(H.notes || []).length ? `<h4>Your latest notes</h4>${H.notes.slice(0, 3).map((x) => `<div class="mem-note"><p>${esc(x.text)}</p><small>${esc(day(x.at))}</small></div>`).join("")}` : ""}`;
      $("[data-back]").onclick = () => show("", dash);
      $("[data-send]").onclick = async (ev) => { const b = ev.currentTarget, t = $("#memNote").value.trim(); if (!t) { err("Write a line first."); $("#memNote").focus(); return; } b.disabled = true; err("");
        try { const j = await send("/api/host/membership/note", { text: t, minRank: +$("#memWho").value }); await load(); S.view = "note"; note(); S.ok = `Sent to ${n(j.sent, "member", "members")}.`; $(".mem-ok").textContent = S.ok; } catch (e) { b.disabled = false; err(e.message); } }; }
    function dates() { const H = S.H, evs = H.events;
      box.innerHTML = `<p class="mem-k">Your membership</p><h3 id="memH">Your dates</h3><p class="mem-m">Members get each date first, top tier earliest. Set when it opens to everyone, and how many seats to hold.</p>
        ${evs.length ? evs.map((e) => `<div class="mem-ev" data-ev="${esc(e.id)}"><p><b>${esc(e.title)}</b><br><small class="mem-m">${esc([e.drop ? "Drop" : "", evDay(e.date) || "No date yet", e.cap ? n(e.cap, "spot", "spots") : "No spot limit"].filter(Boolean).join(" · "))}</small></p>
          <label class="mem-sw"><span>Members first</span><input type="checkbox" data-k="on"${e.on ? " checked" : ""}></label>
          <div class="mem-grid2"><label class="mem-f">Opens to everyone<input type="datetime-local" data-k="publicAt" value="${esc(localInput(e.publicAt))}"></label><label class="mem-f">Seats held<input type="number" min="0" max="${esc(Math.min(e.room || 0, H.options.seatsMax))}" data-k="seats" value="${esc(e.seats)}"${e.cap ? "" : " disabled"}></label></div>
          ${e.on && e.opens?.length ? `<small class="mem-m">${e.opens.map((o) => `${esc(o.name)} from ${esc(new Date(o.at).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }))}`).join(" · ")}</small>` : ""}
          <label class="mem-sw"><span>Members only</span><input type="checkbox" data-k="only"${e.only ? " checked" : ""}></label>
          <button type="button" class="mem-b" data-save-ev>Save</button></div>`).join("") : `<p class="mem-m">No dates coming up. New ones open to members first on their own.</p>`}
        <div class="mem-row"><button type="button" class="mem-q" data-back>Back</button></div>${foot()}`;
      $("[data-back]").onclick = () => show("", dash);
      box.querySelectorAll("[data-save-ev]").forEach((b) => (b.onclick = async () => { const row = b.closest("[data-ev]"), v = (k) => row.querySelector(`[data-k="${k}"]`), pa = v("publicAt").value; b.disabled = true; err("");
        try { await send("/api/host/membership/events/" + encodeURIComponent(row.dataset.ev), { on: v("on").checked, only: v("only").checked, ...(pa ? { publicAt: new Date(pa).getTime() } : {}), ...(v("seats").disabled ? {} : { seats: +v("seats").value || 0 }) }); await load(); dates(); S.ok = "Saved."; $(".mem-ok").textContent = S.ok; box.querySelector(`[data-ev="${CSS.escape(row.dataset.ev)}"] [data-save-ev]`)?.focus(); }
        catch (e) { b.disabled = false; err(e.message); } })); }

    if (own) { host(); if (m.host.eligible) load().then(() => { if (/[?&]membership=connected\b/.test(location.search)) history.replaceState(null, "", location.pathname + "#membership"); host(); }); } else guest();
    if (location.hash === "#membership") { let moved = false; const stop = () => { moved = true; }; ["wheel", "touchmove", "keydown"].forEach((k) => addEventListener(k, stop, { once: true, passive: true })); for (const ms of [80, 800]) setTimeout(() => { if (!moved) box.scrollIntoView({ block: "start" }); }, ms); }
  }

  // ---------- the host's Home (/): one small card, drawn again whenever Home is ----------
  function home() { if (location.pathname !== "/" || !document.getElementById("view-programs")) return; let data = null, busy = false;
    const html = (j) => { const E = j.eligibility, p = "/@" + encodeURIComponent(j.handle) + "#membership";
      if (j.membership.on) return `<section class="mem" aria-labelledby="memHomeH"><p class="mem-k">Membership</p><h3 id="memHomeH">${n(j.stats.members, "member", "members")}</h3><a class="mem-q" href="${p}">See your members</a></section>`;
      if (E.eligible) return `<section class="mem" aria-labelledby="memHomeH"><p class="mem-k">New for you</p><h3 id="memHomeH">Start a membership</h3><p>${j.payments.on ? `You've hosted ${E.count} events. Your regulars can back you each month and get first dibs.` : "Memberships need payments set up. We'll let you know when they're on."}</p>${j.payments.on || j.admin ? `<a class="mem-b${j.payments.on ? " pri" : ""}" href="${p}">${j.payments.on ? "Start a membership" : "See the setup checklist"}</a>` : ""}</section>`;
      if (!E.count) return "";
      return `<section class="mem" aria-labelledby="memHomeH"><p class="mem-k">Memberships</p><p id="memHomeH"><b>${E.need} more ${E.need === 1 ? "event" : "events"} and you can start a membership.</b></p><div class="mem-bar" role="img" aria-label="${E.count} of ${E.at} events"><i style="width:${Math.min(100, (E.count / E.at) * 100)}%"></i></div></section>`; };
    const place = () => { const v = document.getElementById("view-programs"); if (!v || v.hidden || !data) return; const h = html(data); let el = v.querySelector(":scope > #memHome"); if (!h) { el?.remove(); return; }
      if (!el) { el = document.createElement("div"); el.id = "memHome"; const at = v.querySelector(":scope > #hlCard") || v.querySelector(":scope > #ideaLib")?.previousElementSibling; if (at) at.after(el); else v.appendChild(el); }
      if (el.innerHTML !== h) el.innerHTML = h; };
    const go = async () => { if (busy) return; busy = true; try { if (!data) { const j = await get("/api/host/membership?lite=1"); if (!j || !j.handle) return; data = j; style(); } place(); } finally { busy = false; } };
    if (typeof window.renderPrograms === "function" && !window.renderPrograms.__mem) { const orig = window.renderPrograms, w = function () { const r = orig.apply(this, arguments); setTimeout(place, 0); return r; }; w.__mem = 1; window.renderPrograms = w; }
    addEventListener("hashchange", () => setTimeout(place, 60)); setTimeout(go, 500); }

  window.EncoreMembership = { mount, clubLine };
  const boot = () => { if (/(?:^|;\s*)encore_in=1/.test(document.cookie)) home(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
