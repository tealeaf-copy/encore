// The brand panel, round 3 (server/brandpanel3.js): the recovery hold with its clock, the fresh RSVP and the counts,
// commit or let go, "Cancel the event", the host's view of a hold, the off-platform follow-up, matched lift against an
// observed difference, and the admin measures. window.TP3 = { recovery, hostHolds, offHtml, wireOff, liftHtml, pilotHtml,
// adminMeasures }. Needs public/brandbook.js (window.BB). Styles: public/teams-panel.css (the tp3- pieces).
(function () {
  if (window.TP3 || !window.BB) return;
  const { esc, api, icon, money, $, $$ } = BB;
  const fail = (e) => BB.toast(e.message || "Something went wrong. Try again.");
  const day = (d) => (d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "");
  const of = (x) => (x && x.of != null ? `${x.n} of ${x.of}${x.pct != null ? ` (${x.pct}%)` : ""}` : "");
  const when = (ms) => { const d = new Date(ms); return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(":00", "").replace(" ", "").toLowerCase()}`; };
  const left = (ms) => { if (!(ms > 0)) return "Ended"; const m = Math.ceil(ms / 60e3), h = Math.floor(m / 60); return h ? `${h}h ${m % 60}m left` : `${m}m left`; };
  // every [data-until] on the page counts down once a second; at zero the view reloads, and the server ends the hold
  let ticker = 0; const tick = (onEnd) => { clearInterval(ticker); const run = () => { const L = $$("[data-until]"); if (!L.length) return clearInterval(ticker); for (const c of L) { const ms = +c.dataset.until - Date.now(); c.textContent = left(ms); if (ms <= 0 && !c.dataset.ended) { c.dataset.ended = "1"; onEnd?.(); } } }; run(); ticker = setInterval(run, 1000); };
  const moneyChoice = (M, name = "money") => `<fieldset class="tp2-choice"><legend class="tp-q">Your money</legend><label class="tp-check"><input type="radio" name="${name}" value="refund"${M.choice === "refund" ? " checked" : ""}><span><b>Refund</b><small>Everything you paid comes back.</small></span></label><label class="tp-check"><input type="radio" name="${name}" value="credit"${M.choice === "credit" ? " checked" : ""}><span><b>Credit</b><small>Kept toward your next booking.</small></span></label><p class="tp-note">${esc(M.line)} ${esc(M.policy)}</p></fieldset>`;

  // ---- the brand's recovery card ----
  function holdBox(H, V) {
    const C = H.counts, rs = H.rsvpNeeded;
    return `<div class="tp3-hold" aria-label="Hold on ${esc(H.host)}"><p class="ti-k">${icon("clock")}Held for you</p><h3>${esc(H.name)} with ${esc(H.host)}</h3>
      <p class="tp3-clock" data-until="${H.expiresAt}" role="timer">${esc(H.left)}</p><p class="tp-note">Commit by <b>${esc(when(H.expiresAt))}</b>. ${esc(H.deadline)}</p>
      <p class="tp-q">What changes for guests</p><ul class="tp-lines">${H.changes.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
      ${rs ? `<p class="tp-q">Reconfirmations</p><ul class="tp-den"><li><span>Guests reconfirmed for the new plan</span><b>${C.yes} of ${C.of}</b></li>${C.targets.of ? `<li><span>Target accounts reconfirmed</span><b>${C.targets.yes} of ${C.targets.of}</b></li>` : ""}<li><span>Can't go</span><b>${C.no}</b></li><li><span>Not answered yet</span><b>${C.waiting}</b></li></ul>
        ${H.sent ? `<p class="tp-note">${esc(C.text)}. ${esc(C.targets.of ? C.targets.text + "." : "")}</p>` : `<p class="tp2-flag warn">The date, time or access changes, so guests reconfirm before you commit. Send the note below: each guest gets their own link.</p>`}
        <form class="tp3-thr" id="tp3Thr"><label class="bb-field"><span>Let the hold go if fewer than this many guests can make it</span><input name="t" type="number" min="0" max="${Math.max(C.of, V.guests)}" inputmode="numeric" value="${H.threshold}"></label><button class="bb-btn quiet" type="submit">Save</button></form>` : `<p class="tp-note">Same date and time, same access. Guests don't need to reconfirm.</p>`}
      <p class="tp-q">Price and deposit</p><ul class="tp-lines">${H.price.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
      <p class="tp-note">${H.hostOk ? `${icon("check")} ${esc(H.host)} said yes to the date.` : `Waiting on ${esc(H.host)} to say yes. You can commit either way.`}</p>
      <div class="tp-acts"><button class="bb-btn primary" id="tp3Commit"${H.commit.ok ? "" : " disabled"}>Commit to ${esc(H.host)}</button><button class="bb-btn quiet" id="tp3Let">Let the hold go</button></div>${H.commit.ok ? "" : `<p class="tp-note" role="status">${esc(H.commit.why)}</p>`}</div>`;
  }
  function optionsHtml(V) {
    return `<p class="ti-sub">${esc(V.line)}</p>${V.options.length ? `<div class="tp2-opts">${V.options.map((x, i) => `<article class="tp2-opt"><p class="ti-k">${esc(x.host)}${x.area ? ` · ${esc(x.area)}` : ""}</p><h3>${esc(x.name)}</h3>
        <p class="tp2-num">${money(x.totalCents)}<small>${esc(x.priceLine)}</small></p><p class="tp-q">What differs</p><ul class="tp-lines">${x.differs.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>${x.rsvp ? `<p><span class="tp3-badge">Guests reconfirm</span></p>` : ""}
        <div class="tp-acts"><button class="bb-btn primary" data-hold="${i}">Hold ${esc(day(x.date))}</button>${x.rsvp ? "" : `<button class="bb-btn quiet" data-rebook="${i}">Rebook now</button>`}<a class="bb-btn quiet" href="/teams/x/${esc(x.handle)}/${esc(x.pkg)}" target="_blank" rel="noopener">Details</a></div></article>`).join("")}</div>
      <label class="bb-field tp3-hours"><span>Hold for</span><select id="tp3Hours">${V.holdHours.map((h) => `<option value="${h}"${h === 24 ? " selected" : ""}>${h} hours</option>`).join("")}</select></label>` : ""}`;
  }
  async function recovery(id, el, redo) {
    let V; try { V = await api(`/api/teams/events/${id}/recovery`); } catch { el.innerHTML = ""; return; }
    const H = V.hold && V.hold.live ? V.hold : null, again = () => recovery(id, el, redo);
    const head = V.state === "cancelled" ? ["Cancelled", "The event is cancelled"] : V.state === "rebooked" ? ["Rebooked", V.minutes != null ? `Recovered in ${esc(V.minutes)} minutes` : "Rebooked"] : H ? ["A replacement is held", `${esc(H.host)}, ${esc(H.dateLabel)}`] : ["Your host cancelled", V.options.length > 1 ? `${V.options.length} ways to keep the event` : V.options.length ? "One way to keep the event" : "No replacement is open"];
    const past = V.past?.length ? `<p class="tp-note">${V.past.map((p) => `${esc(p.host)}: ${esc(p.why)}`).join(" ")}</p>` : "";
    el.innerHTML = `<section class="tp-box tp2-alert" id="recovery"><p class="ti-k">${head[0]}</p><h2>${head[1]}</h2>
      ${V.state === "cancelled" ? `<p class="ti-sub">${esc(V.cancelled.money.line)} ${V.cancelled.told ? `${V.cancelled.told} ${V.cancelled.told === 1 ? "guest was" : "guests were"} told.` : ""}</p>`
        : V.state === "rebooked" ? `<p class="ti-sub">The new booking keeps your brief.${V.rebookId ? ` <a href="/teams/bookings/${esc(V.rebookId)}">Open it</a>.` : ""}</p>${V.outcome ? `<p class="tp-note">${esc(V.outcome.line)}</p>` : ""}`
        : `${H ? holdBox(H, V) : optionsHtml(V)}${past}${H || V.options.length ? moneyChoice(V.money) : ""}`}
      ${V.state !== "cancelled" && V.note ? `<p class="tp-q" style="margin-top:14px">The note to your ${V.guests} ${V.guests === 1 ? "guest" : "guests"}, ready to send</p><label class="bb-field"><span>Subject</span><input id="tp2Sub" value="${esc(V.note.subject)}" maxlength="140"></label><label class="bb-field"><span>Message</span><textarea id="tp2Txt" rows="9">${esc(V.note.text)}</textarea></label>
        <div class="tp-acts"><button class="bb-btn${H?.rsvpNeeded && !H.sent ? " primary" : ""}" id="tp2Send"${V.guests ? "" : " disabled"}>${icon("mail")}${H?.rsvpNeeded ? `Send with reconfirm links` : `Send to ${V.guests} ${V.guests === 1 ? "guest" : "guests"}`}</button></div>` : ""}
      ${["open", "held"].includes(V.state) ? `<section class="tp3-cancel" aria-label="Cancel the event"><h3>${V.options.length ? "None of these work?" : "Cancel the event"}</h3><p class="ti-sub">Cancel the event and tell your guests. Your money comes back by the guarantee, or stays as credit.</p>
        ${moneyChoice(V.money, "cmoney")}<label class="bb-field"><span>The note to guests</span><textarea id="tp3CTxt" rows="5">${esc(V.cancelNote.text)}</textarea></label><div class="tp-acts"><button class="bb-btn" id="tp3Cancel">Cancel the event</button></div></section>` : ""}</section>`;
    tick(again);
    $$("[name=money]", el).forEach((r) => (r.onchange = async () => { try { await api(`/api/teams/events/${id}/recovery/money`, { choice: r.value }); BB.toast(r.value === "credit" ? "Kept as credit" : "Refund it is"); } catch (e) { fail(e); } }));
    $$("[data-hold]", el).forEach((b) => (b.onclick = async () => { const x = V.options[+b.dataset.hold]; b.disabled = true; try { await api(`/api/teams/events/${id}/recovery/hold`, { handle: x.handle, pkg: x.pkg, hours: $("#tp3Hours", el)?.value }); BB.toast(`${x.host} is held`); again(); } catch (e) { b.disabled = false; fail(e); } }));
    $$("[data-rebook]", el).forEach((b) => (b.onclick = async () => { const x = V.options[+b.dataset.rebook]; b.disabled = true; try { const o = await api(`/api/teams/events/${id}/recovery/rebook`, { handle: x.handle, pkg: x.pkg }); BB.toast(`Rebooked in ${o.minutes} minutes`); redo(); } catch (e) { b.disabled = false; fail(e); } }));
    $("#tp3Thr", el) && ($("#tp3Thr", el).onsubmit = async (e) => { e.preventDefault(); try { await api(`/api/teams/events/${id}/recovery/hold`, { threshold: e.target.t.value }); BB.toast("Saved"); again(); } catch (er) { fail(er); } });
    $("#tp3Commit", el) && ($("#tp3Commit", el).onclick = async () => { try { const o = await api(`/api/teams/events/${id}/recovery/commit`, {}); BB.toast("Committed"); redo(); if (o.url) setTimeout(() => {}, 0); } catch (e) { fail(e); again(); } });
    $("#tp3Let", el) && ($("#tp3Let", el).onclick = async () => { try { await api(`/api/teams/events/${id}/recovery/release`, {}); BB.toast("Hold let go"); again(); } catch (e) { fail(e); } });
    $("#tp2Send", el) && ($("#tp2Send", el).onclick = async () => { try { const o = await api(`/api/teams/events/${id}/recovery/message`, { subject: $("#tp2Sub", el).value, text: $("#tp2Txt", el).value }); BB.toast(`Sent to ${o.emailed} of ${o.guests}`); again(); } catch (e) { fail(e); } });
    $("#tp3Cancel", el) && ($("#tp3Cancel", el).onclick = async () => { const ch = $("[name=cmoney]:checked", el)?.value || "refund"; if (!confirm("Cancel the event and tell your guests?")) return; try { await api(`/api/teams/events/${id}/recovery/cancel`, { choice: ch, text: $("#tp3CTxt", el).value }); BB.toast("Event cancelled"); again(); } catch (e) { fail(e); } });
  }

  // ---- the replacement host's view of a hold ----
  async function hostHolds(el) {
    if (!el) return; let D; try { D = await api("/api/bb/host/holds"); } catch { el.innerHTML = ""; return; }
    if (!D.holds.length) { el.innerHTML = ""; return; }
    el.innerHTML = D.holds.map((H) => `<section class="tp-box tp2-alert" data-hold="${esc(H.id)}"><p class="ti-k">${H.live ? `${icon("clock")}A date held for you` : H.state === "committed" ? "Committed" : "Hold ended"}</p><h2>${esc(H.company)}: ${esc(H.dateLabel)}${H.timeLabel ? `, ${esc(H.timeLabel)}` : ""}</h2>
      <p class="ti-sub">${esc(H.company)} needs a replacement host for ${esc(H.headcount)} people and is holding ${esc(H.name)} with you.${H.live ? " Your date stays blocked until the hold ends." : ""}</p>
      ${H.live ? `<p class="tp3-clock" data-until="${H.expiresAt}" role="timer">${esc(H.left)}</p><p class="tp-note">The brand commits by <b>${esc(when(H.expiresAt))}</b>, or the hold ends and your date opens again.${H.rsvpNeeded ? ` It also ends sooner if fewer than ${esc(H.threshold)} guests can make it.` : ""}</p>` : `<p class="tp-note">${esc(H.why || (H.state === "committed" ? "The brand committed. The request is in your inbox." : ""))}</p>`}
      <ul class="tp-den"><li><span>Guests</span><b>${esc(H.headcount)}</b></li><li><span>Your price for the group</span><b>${money(H.price.totalCents)}</b></li>${H.rsvpNeeded ? `<li><span>Guests reconfirmed so far</span><b>${H.counts.yes} of ${H.counts.of}</b></li>` : ""}</ul>
      ${H.live ? (H.hostOk ? `<p class="tp-note">${icon("check")} You said yes. When the brand commits, it's booked.</p>` : `<div class="tp-acts"><button class="bb-btn primary" data-yes="1">I can do it</button><button class="bb-btn quiet" data-yes="0">I can't</button></div>`) : ""}</section>`).join("");
    tick(() => hostHolds(el));
    $$("[data-hold]", el).forEach((box) => box.querySelectorAll("[data-yes]").forEach((b) => (b.onclick = async () => { try { await api(`/api/bb/host/holds/${box.dataset.hold}`, { yes: b.dataset.yes === "1" }); BB.toast(b.dataset.yes === "1" ? "Sent: you can do it" : "Hold let go"); hostHolds(el); } catch (e) { fail(e); } })));
  }

  // ---- "Did you book each other again outside Pottery Lab?" ----
  function offHtml(A, side, id) {
    if (!A) return ""; const m = A.mine;
    return `<section class="tp-box quiet"${side === "brand" ? ' id="offplatform"' : ""} data-off="${esc(id)}" data-side="${side}"><h2>${esc(A.question)}</h2><p class="ti-sub">${esc(A.note)}</p>
      ${m ? `<p class="tp-note">${icon("check")} You said ${m.count ? `yes, ${m.count} ${m.count === 1 ? "time" : "times"}` : "no"}. Thank you.</p>` : `<div class="tp-acts"><button class="bb-btn" data-offn="0">No</button><button class="bb-btn" data-offn="1">Yes, once</button><button class="bb-btn" data-offn="2">Yes, 2 or more</button></div>`}</section>`;
  }
  function wireOff(root, after) { $$("[data-off]", root).forEach((s) => s.querySelectorAll("[data-offn]").forEach((b) => (b.onclick = async () => { const u = s.dataset.side === "host" ? `/api/bb/host/events/${s.dataset.off}/off-platform` : `/api/teams/events/${s.dataset.off}/off-platform`; try { await api(u, { count: +b.dataset.offn }); BB.toast("Thank you"); after?.(); } catch (e) { fail(e); } }))); }

  // ---- lift only when matched; an observed difference otherwise ----
  function liftHtml(Lf) {
    if (!Lf) return "";
    const row = (x) => `<li class="tp3-rec"><p><span class="tp3-badge${x.matched ? " ok" : ""}">${esc(x.label)}</span> ${esc(x.text)}</p><p class="bb-meta">${esc(x.sourceLine)}. ${esc(x.a.text)} vs ${esc(x.b.text)}. ${esc(x.match.why)}</p>
      <p class="tp-q">Match fields: this format (${esc(x.match.checked.a)} checked) vs the baseline (${esc(x.match.checked.b)} checked)</p><ul class="tp-den tp3-match">${x.match.fields.map((f) => `<li><span>${esc(f.label)}</span><b>${esc(f.a)} vs ${esc(f.b)}<small class="tp3-ok${f.ok ? "" : " no"}">${f.ok ? "Similar" : "Differs"}</small></b></li>`).join("")}</ul></li>`;
    return `<section class="tp-box"><h2>What works</h2><p class="ti-sub">${esc(Lf.note)}</p>${Lf.items.length ? `<ul class="tp-lines tp3-recs">${Lf.items.slice(0, 4).map(row).join("")}</ul>` : ""}</section>`;
  }
  const pilotHtml = (Pm) => (Pm ? `<section class="tp-box quiet"><h2>Recovery in the pilot</h2><ul class="tp-den"><li><span>Drills (operations tests)</span><b>${Pm.tests}</b></li><li><span>Real recoveries</span><b>${Pm.recoveries}</b></li><li><span>Time to hold a replacement</span><b>${Pm.found.medianMinutes != null ? `${esc(Pm.found.medianMinutes)} min` : "None yet"}</b></li><li><span>Original target guests who came</span><b>${esc(of(Pm.targetsAttended))}</b></li><li><span>Successful recoveries</span><b>${esc(of(Pm.successes))}</b></li></ul><p class="tp-note">${esc(Pm.testLine)} ${esc(Pm.rule)}</p></section>` : "");

  // ---- the admin durability measures ----
  async function adminMeasures(el) {
    if (!el) return; let D; try { D = await api("/api/admin/brand-measures"); } catch { el.innerHTML = ""; return; }
    const O = D.onPlatform, E = D.earnings, M = D.margin, ph = (x) => (x.perHourCents != null ? `${money(x.perHourCents)} an hour` : "No hours yet"), n = (x) => `${x.n} ${x.n === 1 ? "booking" : "bookings"}${x.n !== x.withHours ? `, ${x.withHours} with hours` : ""}`;
    const grp = (g) => `<td class="n">${g.hosts}</td><td class="n">${g.perHourCents != null ? money(g.perHourCents) : "None"}</td><td class="n">${esc(of(g.secondEvent))}</td><td class="n">${g.secondBookings}</td>`;
    el.innerHTML = `<section class="tp-box"><h2>Kept on Pottery Lab</h2><p class="ti-sub">After each event both sides are asked, separately: "${esc(D.question)}" Their answers go into the denominator.</p>
        <ul class="tp-den"><li><span>Repeat bookings on Pottery Lab</span><b>${O.on}</b></li><li><span>Direct repeat bookings (from the follow-up)</span><b>${O.direct}</b></li>${O.selfReported ? `<li><span>Reported by a host on their own</span><b>${O.selfReported}</b></li>` : ""}<li><span>On-platform rate</span><b>${O.value != null ? `${O.value}%` : "None yet"} <span class="bb-meta">(${O.on} of ${O.of})</span></b></li><li><span>Follow-up response rate</span><b>${O.response ? `${O.response.pct != null ? `${O.response.pct}%` : "None yet"} <span class="bb-meta">(${esc(O.response.text)})</span>` : "None yet"}</b></li></ul></section>
      <section class="tp-box"><h2>Host earnings per prep hour</h2><p class="ti-sub">Net of our fee and tax, over the prep hours hosts logged (or said to expect). First bookings with a brand against second ones. ${esc(E.line)}</p>
        <div class="tp-scroll"><table class="tp-tbl"><thead><tr><th>Host</th><th>First bookings</th><th>Second bookings</th></tr></thead><tbody>${E.hosts.map((h) => `<tr><td>${esc(h.name)}</td><td class="n">${ph(h.first)}<small class="bb-meta" style="display:block">${n(h.first)}</small></td><td class="n">${ph(h.second)}<small class="bb-meta" style="display:block">${n(h.second)}</small></td></tr>`).join("")}<tr><td><b>All hosts</b></td><td class="n"><b>${ph(E.all.first)}</b><small class="bb-meta" style="display:block">${n(E.all.first)}</small></td><td class="n"><b>${ph(E.all.second)}</b><small class="bb-meta" style="display:block">${n(E.all.second)}</small></td></tr></tbody></table></div></section>
      <section class="tp-box"><h2>Our contribution margin</h2><p class="ti-sub">Per booking, before and after replacement costs: credits, waived fees and the repeat-fee discount. ${M.bookings} ${M.bookings === 1 ? "booking" : "bookings"}.</p>
        <ul class="tp-den"><li><span>Per booking, before replacement costs</span><b>${M.perBookingBeforeCents != null ? money(M.perBookingBeforeCents) : "None"}</b></li><li><span>Per booking, after replacement costs</span><b>${M.perBookingAfterCents != null ? money(M.perBookingAfterCents) : "None"}</b></li></ul>
        <table class="tp2-money"><tbody>${M.lines.map((l) => `<tr${l.total ? ' class="tp3-tot"' : ""}><td>${esc(l.label)}</td><td class="n">${l.cents < 0 ? "-" : ""}${money(Math.abs(l.cents))}</td></tr>`).join("")}</tbody></table>
        <details style="margin-top:12px"><summary><b>Cost assumptions</b></summary><form id="tp3Mg" class="tp2-grid3">${Object.entries(D.labels).map(([k, label]) => k === "waiveReplacementFee" ? `<label class="tp-check"><input type="checkbox" name="${k}"${M.assumptions[k] ? " checked" : ""}><span><b>${esc(label)}</b></span></label>` : `<label class="bb-field"><span>${esc(label)}</span><input name="${k}" type="number" min="0" inputmode="numeric" value="${esc(M.assumptions[k])}"></label>`).join("")}<button class="bb-btn primary" type="submit">Save assumptions</button></form></details></section>
      <section class="tp-box"><h2>Followers who find another host</h2><p class="ti-sub">${esc(D.cohorts.note)}</p>${D.cohorts.cohorts.length ? `<div class="tp-scroll"><table class="tp-tbl"><thead><tr><th>Cohort</th><th>Followers</th><th>Hosts</th><th>Net per prep hour</th><th>Second-event booking</th><th>Second bookings</th></tr></thead><tbody>${D.cohorts.cohorts.map((c) => { const m = esc(new Date(c.cohort + "-15T12:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })); return `<tr><td>${m}</td><td>Discover another host</td>${grp(c.discover)}</tr><tr><td>${m}</td><td>Stay with one host</td>${grp(c.stay)}</tr>`; }).join("")}</tbody></table></div>` : `<p class="tp-note">No ordinary host cohort yet.</p>`}</section>
      ${pilotHtml(D.pilot)}`;
    $("#tp3Mg", el).onsubmit = async (e) => { e.preventDefault(); const f = e.target, b = {}; for (const k of Object.keys(D.labels)) b[k] = k === "waiveReplacementFee" ? f[k].checked : f[k].value; try { await api("/api/admin/margin", b); BB.toast("Saved"); adminMeasures(el); } catch (er) { fail(er); } };
  }

  window.TP3 = { recovery, hostHolds, offHtml, wireOff, liftHtml, pilotHtml, adminMeasures };
})();
