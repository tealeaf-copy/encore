// Results for a booking: a guest page to RSVP to, then who came, what they thought, what it cost per person,
// and the outcomes the brand records (meetings, opportunities, pipeline). Shown on the booking page.
(function () {
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const id = location.pathname.split("/").pop(), t = new URLSearchParams(location.search).get("t") || "";
  const GOALS = { pipeline: "Pipeline", retention: "Customer retention", awareness: "Awareness", morale: "Team morale", hiring: "Hiring", community: "Community" };
  const money = (n) => "$" + Math.round(n).toLocaleString();
  async function draw(box) {
    const r = await fetch(`/api/public/booking/${encodeURIComponent(id)}/results?t=${encodeURIComponent(t)}`).then((x) => x.json()).catch(() => null); if (!r || r.code) { window.__mGone = true; box.remove(); return; }
    const c = r.campaign || {}, gift = r.kind === "gift";
    const tiles = [];
    if (!gift) { if (r.past) { tiles.push([r.going ? `${r.came}<small>of ${r.going}</small>` : "—", "came", r.showRate != null ? `${r.showRate}% of yeses showed up` : ""]); } else tiles.push([r.going || 0, "said yes", r.invited ? `of ${r.invited} expected` : ""]); }
    if (r.againPct != null) tiles.push([`${r.againPct}%`, "would go again", r.hostAgainPct != null ? `${r.hostAgainPct}% across this host's events` : `${r.ratings} ${r.ratings === 1 ? "rating" : "ratings"}`]);
    if (r.costPer) tiles.push([money(r.costPer), gift ? "per gift" : "per attendee", r.cost ? `${money(r.cost)} total` : ""]);
    if (c.pipeline) tiles.push([money(c.pipeline), "pipeline", r.cost ? `${Math.round(c.pipeline / r.cost)}× the spend` : ""]);
    else if (c.meetings) tiles.push([c.meetings, "meetings booked", r.came ? `${Math.round((100 * c.meetings) / r.came)}% of attendees` : ""]);
    box.innerHTML = `<span class="eyebrow">Guests and results</span>
      ${!gift ? (r.eventId ? `<p style="margin:8px 0">Guest page: <a href="${esc(r.rsvpLink)}" target="_blank" rel="noopener">${esc(location.origin + r.rsvpLink)}</a> <button class="linkish" type="button" id="mCopy">Copy</button></p><p class="mm">Send it to your guests. They RSVP, get reminders, and rate it afterwards in one tap; you see the totals here, never their private notes.</p>`
        : `<p style="margin:8px 0">Create a guest page so people can RSVP, and so you can see who came and what they thought.</p><button class="btn" type="button" id="mMake">Create the guest page</button>`) : `<p class="mm">Results appear as gifts are delivered. Record what happened next below.</p>`}
      ${tiles.length ? `<div class="mtiles">${tiles.map(([v, l, s]) => `<div><b>${v}</b><span>${esc(l)}</span>${s ? `<small>${esc(s)}</small>` : ""}</div>`).join("")}</div>` : ""}
      ${r.topTags?.length ? `<p class="mm">Guests said: ${r.topTags.map((x) => `${esc(x.label)} (${x.n})`).join(" · ")}${r.photos ? ` · ${r.photos} photos shared` : ""}</p>` : ""}
      <details class="mcamp"${c.name || r.past ? " open" : ""}><summary>Campaign and outcomes</summary><form id="mCamp">
        <div class="mrow"><label>Campaign<input name="name" value="${esc(c.name || "")}" placeholder="e.g. Q1 customer dinners" maxlength="60"></label><label>Goal<select name="goal"><option value="">Pick one</option>${Object.entries(GOALS).map(([k, l]) => `<option value="${k}" ${c.goal === k ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
        <div class="mrow"><label>Attendance target<input name="target" inputmode="numeric" value="${c.target || ""}"></label><label>Meetings booked<input name="meetings" inputmode="numeric" value="${c.meetings || ""}"></label></div>
        <div class="mrow"><label>Opportunities<input name="opps" inputmode="numeric" value="${c.opps || ""}"></label><label>Pipeline ($)<input name="pipeline" inputmode="numeric" value="${c.pipeline || ""}"></label></div>
        <label>Notes<input name="notes" value="${esc(c.notes || "")}" placeholder="What worked, what to change next time" maxlength="400"></label>
        <button class="btn" type="submit">Save</button> <a href="/results" class="mm">See all your results</a> <small class="mm" id="mMsg"></small></form></details>`;
    const mk = box.querySelector("#mMake"); if (mk) mk.onclick = async () => { mk.disabled = true; await fetch(`/api/public/booking/${encodeURIComponent(id)}/event`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t }) }).catch(() => {}); draw(box); };
    const cp = box.querySelector("#mCopy"); if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(location.origin + r.rsvpLink); cp.textContent = "Copied"; } catch {} };
    box.querySelector("#mCamp").onsubmit = async (e) => { e.preventDefault(); const campaign = Object.fromEntries(new FormData(e.target)); const ok = await fetch(`/api/public/booking/${encodeURIComponent(id)}/campaign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t, campaign }) }).then((x) => x.ok).catch(() => false); box.querySelector("#mMsg").textContent = ok ? "Saved." : "Couldn't save that."; if (ok) setTimeout(() => draw(box), 400); };
  }
  const st = document.createElement("style"); st.textContent = `.mm{color:var(--smoke);font-size:14px;margin:6px 0}.mtiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:12px 0}.mtiles div{background:var(--linen);border-radius:14px;padding:12px}.mtiles b{display:block;font:600 26px Fredoka,system-ui}.mtiles b small{font-size:14px;color:var(--smoke);margin-left:4px}.mtiles span{display:block;font-weight:600;font-size:14px}.mtiles small{display:block;color:var(--smoke);font-size:12.5px}
    .mcamp{margin-top:10px}.mcamp summary{cursor:pointer;font-weight:600}.mcamp form{display:grid;gap:8px;margin-top:8px}.mrow{display:grid;grid-template-columns:1fr 1fr;gap:8px}.mcamp label{display:grid;gap:3px;font-size:13px;font-weight:600;color:var(--smoke)}.mcamp input,.mcamp select{padding:9px 11px;border:1px solid var(--line);border-radius:10px;font:inherit;background:#fff}.btn{display:inline-block;padding:9px 16px;border-radius:999px;border:0;background:var(--ember);color:#fff;font:600 14.5px inherit;cursor:pointer;text-decoration:none}`;
  document.head.appendChild(st);
  const ready = () => { const thr = document.getElementById("thr"); if (window.__mGone || !thr || document.getElementById("mBox")) return false; const box = document.createElement("div"); box.className = "card"; box.id = "mBox"; thr.closest(".card").before(box); draw(box); return true; };
  ready(); new MutationObserver(() => ready()).observe(document.body, { childList: true, subtree: true });
})();
