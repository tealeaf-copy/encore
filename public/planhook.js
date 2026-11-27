// The plan on the invite (/e/<id>, public/invite.html, and the full invite /g): for a multi-day plan or one the host
// laid out, a short "The plan" section under the invite, once the guest is in (or when the host made it public). The
// kind's own card goes first (server/kinds.js): the booked table and its reply-by day, where we're staying, or the
// agenda's first sessions with the sponsors row. The whole plan is on /plans/<id> (public/plan.html). Needs public/timeline.js.
(function () {
  const g = location.pathname === "/g", id = g ? (location.hash.match(/rsvp-([A-Za-z0-9_-]{2,80})/) || [])[1] : (location.pathname.match(/^\/[ei]\/([A-Za-z0-9_-]{2,80})/) || [])[1], T = window.PLTimeline; if (!id || id === "_preview" || !T || document.querySelector(".pl-planhook")) return;
  let proof = null; try { proof = JSON.parse(localStorage.getItem("encore-rsvp-" + id) || "null"); } catch {}
  const q = proof?.rid && proof?.code ? `?rid=${encodeURIComponent(proof.rid)}&code=${encodeURIComponent(proof.code)}` : "", esc = T.esc, href = `/plans/${encodeURIComponent(id)}`;
  const H = (t, small) => `<h2 style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin:0;padding-bottom:6px;border-bottom:var(--pl-rule,1.5px solid var(--pl-ink));font:600 18px/1.3 var(--pl-font-text)">${esc(t)}<small style="font:500 12px var(--pl-font-mono);text-transform:uppercase;letter-spacing:.05em;color:var(--pl-soft)">${esc(small || "")}</small></h2>`;
  const L = (t, s = "") => `<p style="margin:8px 0 0;font:400 16px/1.45 var(--pl-font-text);color:var(--pl-ink);${s}">${t}</p>`, go = (t, h = href) => `<p style="margin:8px 0 0"><a href="${h}" style="display:inline-flex;align-items:center;min-height:44px;font:500 15px var(--pl-font-text);color:var(--pl-accent-text)">${esc(t)}</a></p>`;
  const mark = (t) => `<span style="background:var(--pl-highlight);padding:0 3px;box-decoration-break:clone;-webkit-box-decoration-break:clone">${esc(t)}</span>`;
  /** The kind's card: a few plain lines and a way to the plan page. */
  function kindHtml(K) { if (!K) return "";
    if (K.kind === "table" && K.table) { const t = K.table;
      return H("The table", t.party ? `Booked for ${t.party}` : "") + L(`<b style="font:600 24px/1.2 var(--pl-font-serif)">${esc(t.restaurant || "The restaurant")}</b>`) + L(esc([T.clock(t.time) && "At " + T.clock(t.time), t.count ? `${t.count} coming so far` : ""].filter(Boolean).join(" · ")))
        + (t.hold ? L(mark(t.hold), "text-wrap:balance") : "") + (t.split ? L(esc(t.split.line), "color:var(--pl-soft)") : "") + go(K.you.in ? "The booking and the bill" : "About the table"); }
    if (K.kind === "weekend" && K.stay) { const s = K.stay, open = (K.beds?.list || []).reduce((a, b) => a + b.left, 0), seats = (K.cars?.list || []).reduce((a, c) => a + c.left, 0);
      return H("Where we're staying", s.area || "") + L(`<b>${esc(s.name || "To come")}</b>${s.checkIn ? ` · check in ${esc(T.clock(s.checkIn))}` : ""}`) + (s.address ? L(esc(s.address)) : s.locked ? L("The address goes to people who are in.", "color:var(--pl-soft)") : "")
        + L(esc([K.beds ? `${open} ${open === 1 ? "bed spot" : "bed spots"} open` : "", K.cars?.list.length ? `${seats} ${seats === 1 ? "seat" : "seats"} in cars` : "", (K.ledger?.lines || []).find((x) => x.youOwe)?.line || ""].filter(Boolean).join(" · ")), "color:var(--pl-soft)")
        + go(K.you.in ? "Beds, rides and shared costs" : "See the weekend"); }
    if (K.kind === "summit") { const A = K.agenda, S = A && !A.locked ? A.sessions.slice(0, 3) : [];
      return H("Agenda", ((n) => `${n} session${n === 1 ? "" : "s"}`)(A?.locked ? A.count : A?.sessions.length || 0)) + (S.length ? `<ul style="list-style:none;margin:6px 0 0;padding:0">${S.map((s) => `<li style="display:grid;grid-template-columns:64px minmax(0,1fr);gap:10px;padding:8px 0;border-bottom:1px dashed var(--pl-line-strong)"><span style="font:500 14px var(--pl-font-mono)">${esc(T.clock(s.time))}</span><span><b style="font:600 16px/1.3 var(--pl-font-text)">${esc(s.title)}</b><small style="display:block;font:400 14px var(--pl-font-text);color:var(--pl-soft)">${esc([s.track, s.room, s.speakers.map((p) => p.name).join(", ")].filter(Boolean).join(" · "))}</small></span></li>`).join("")}</ul>` : A?.locked ? L("Say you're in to see the agenda.", "color:var(--pl-soft)") : "")
        + ((K.sponsors || []).length ? L(`<span style="font:500 12px var(--pl-font-mono);text-transform:uppercase;letter-spacing:.06em;color:var(--pl-accent-text)">Sponsors</span> ${K.sponsors.map((s) => esc(s.name)).join(" · ")}`) : "") + go(A?.canSave ? "Pick your sessions" : "See the whole agenda", href + "#agenda"); }
    return ""; }
  fetch(`/api/public/plan/${encodeURIComponent(id)}${q}`, { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then((j) => { const P = j?.plan; if (!P) return;
    const K = kindHtml(P.kinds), items = P.locked ? [] : P.days.flatMap((d) => d.items); if (!K && !items.length) return;
    if (!document.querySelector('link[href="/timeline.css"],link[href^="/timeline.css?"]')) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/timeline.css"; document.head.appendChild(l); }
    const sec = document.createElement("section"); sec.className = "pl-planhook"; sec.setAttribute("aria-label", P.kinds?.kind === "summit" ? "Agenda" : "The plan");
    sec.style.cssText = "max-width:560px;margin:8px auto 24px;padding:0 16px";
    const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } })(), today = T.localDay(Date.now(), tz);
    const days = P.days.filter((d) => d.items.length).slice(0, 3).map((d) => ({ ...d, items: d.items.slice(0, 4) }));
    sec.innerHTML = (K ? `<div style="margin:0 0 18px">${K}</div>` : "") + (items.length ? `${H("The plan", P.chip)}${T.itineraryHtml(days, { today })}${go("See the whole plan")}` : "");
    const place = () => { if (g) { const v = document.getElementById("view-guest"); if (!v || !v.children.length) return false; v.appendChild(sec); return true; } const m = document.getElementById("m"); (m?.parentNode || document.body).insertBefore(sec, m ? m.nextSibling : null); return true; };
    if (!place()) { let n = 0; const t = setInterval(() => { if (place() || ++n > 30) clearInterval(t); }, 200); }
  }).catch(() => {});
})();
