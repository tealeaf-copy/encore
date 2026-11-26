// repeats (review round 6), for the light invite (public/invite.html): loaded only when a link's date has passed.
// "Tue, Nov 24 has passed. Here's the next one." above the next date's invite, "Next one Tue, Dec 1" in its facts, and
// that past date's kudos and photos below (GET /api/public/next/:id, server/repeats.js). A course that's still running
// gets "Next class Tue, Dec 1" instead.
// review round 7 (weekly regulars): a guest who was in last time gets "You were in last week. In again?", one tap that
// replies to this date with the same name and email or phone (from this device, or from their last reply).
window.InviteRepeat = function (e, courseNext, pastOf, when, x = {}) {
  const $ = (s) => document.querySelector(s), esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const line = (txt, hl) => { let nx = $("#nextOne"); if (!nx) { const wb = $("#m .facts > div:first-child"); if (!wb) return; nx = document.createElement("div"); nx.id = "nextOne"; nx.className = "muted"; nx.textContent = txt; wb.after(nx); } if (hl) nx.classList.add("rp-hl"); };
  if (!document.getElementById("rpCss")) { const st = document.createElement("style"); st.id = "rpCss"; st.textContent = `.rp-was{margin:0 0 10px;padding:10px 14px;border-radius:14px;background:var(--pl-sand);border:1.5px solid var(--ink);font-weight:600}.rp-hl{font-weight:700;color:var(--ink)!important}.rp-again{margin:18px 0 0;padding:14px;border-radius:16px;background:var(--pl-sand);border:1.5px solid var(--ink)}.rp-again .go{width:100%}.rp-again .linkbtn{display:block;background:none;border:0;text-decoration:underline;font:inherit;color:inherit;cursor:pointer}.rp-past{margin:26px 0 0}.rp-past h2{font:700 20px var(--sys-display);margin:0 0 6px}.rp-tags{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}.rp-tags span{border:1px solid var(--line);background:#fff;border-radius:999px;padding:4px 10px;font-size:14px}.rp-ph{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px}.rp-ph img{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:12px;border:1.5px solid var(--ink);display:block}`; document.head.appendChild(st); }
  if (courseNext) return line(`Next class ${when({ date: courseNext })}`);
  again(x.again);
  if (!pastOf || $("#rpWas")) return;
  const P = pastOf.past || {}, was = when({ date: pastOf.e.date });
  const top = document.createElement("p"); top.className = "rp-was"; top.id = "rpWas"; top.textContent = `${was} has passed. Here's the next one.`; $("#m .top")?.after(top);
  line(`Next one ${when({ date: e.date, startTime: when({ date: e.date }) === "Today" ? e.startTime : "" })}`, true);
  const photos = (P.photos || []).filter((u) => /^\/_blob\/[A-Za-z0-9_-]{6,80}$/.test(u)), tags = P.tags || [];
  if (!photos.length && !P.kudos) return;
  const sec = document.createElement("section"); sec.className = "rp-past"; sec.id = "rpPast";
  sec.innerHTML = `<h2>Last time · ${esc(was)}</h2>${P.kudos ? `<p class="muted" style="margin:0 0 8px">${P.kudos} ${P.kudos === 1 ? "guest" : "guests"} sent kudos</p>${tags.length ? `<div class="rp-tags">${tags.map((t) => `<span>${esc(t.emoji)} ${esc(t.label)}${t.n > 1 ? ` · ${t.n}` : ""}</span>`).join("")}</div>` : ""}` : ""}${photos.length ? `<div class="rp-ph">${photos.map((u) => `<img src="${esc(u)}" alt="" loading="lazy">`).join("")}</div>` : ""}`;
  $("#m").appendChild(sec);
  function again(A) { const f = $("#f"); if (!A || !f || $("#rpAgain")) return;
    const unit = e.repeat === "weekly" ? "last week" : e.repeat === "monthly" ? "last month" : "last time", nm = String(A.name || "").trim();
    let ct = String(A.ct || "").trim();
    if (!ct && A.rid && A.code && x.prevId) fetch(`/api/public/reply/${encodeURIComponent(x.prevId)}?rid=${encodeURIComponent(A.rid)}&code=${encodeURIComponent(A.code)}`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.email) ct = j.email; }).catch(() => {});
    const b = document.createElement("div"); b.id = "rpAgain"; b.className = "rp-again";
    b.innerHTML = `<p style="margin:0 0 8px"><b>You were in ${unit}.</b> In again?</p><button type="button" class="go" id="rpGo">I'm in again${nm ? ` · ${esc(nm)}` : ""}</button><button type="button" class="linkbtn" id="rpEdit" style="margin-top:6px">Change my details</button><button type="button" class="linkbtn" id="rpNo" style="margin-top:2px">Not me</button><p class="err" id="rpErr" role="alert"></p>`;
    f.before(b);
    // review round 8: only "In again?" until they ask for the form (Change my details, Not me, or details missing)
    const stk = document.querySelector(".stick"); f.hidden = true; if (stk) stk.style.display = "none";
    const showForm = (drop) => { f.hidden = false; if (stk) stk.style.display = ""; if (drop) b.remove(); else { $("#rpEdit")?.remove(); } };
    $("#rpEdit").onclick = () => { showForm(false); $("#nm").value = $("#nm").value || nm; if (ct && !$("#ct").value) $("#ct").value = ct; $("#nm").focus(); };
    $("#rpNo").onclick = () => { showForm(true); $("#nm").focus(); };
    $("#rpGo").onclick = () => { const g = f.querySelector('input[name="r"][value="going"]'); if (g) g.checked = true; $("#nm").value = nm; if (ct) $("#ct").value = ct;
      if (($("#ct").required && !ct) || (window.__qMissing && window.__qMissing())) { showForm(true); $("#nm").scrollIntoView({ behavior: "smooth", block: "center" }); return; }
      $("#rpGo").disabled = true; new MutationObserver((_, o) => { if (document.getElementById("tk")) { b.remove(); o.disconnect(); } else if ($("#er")?.textContent) { $("#rpGo").disabled = false; $("#rpErr").textContent = $("#er").textContent; } }).observe(document.getElementById("m"), { childList: true, subtree: true, characterData: true });
      f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event("submit", { cancelable: true })); }; }
};
