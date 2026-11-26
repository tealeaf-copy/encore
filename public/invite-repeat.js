// repeats (review round 6), for the light invite (public/invite.html): loaded only when a link's date has passed.
// "Tue, Nov 24 has passed. Here's the next one." above the next date's invite, "Next one Tue, Dec 1" in its facts, and
// that past date's kudos and photos below (GET /api/public/next/:id, server/repeats.js). A course that's still running
// gets "Next class Tue, Dec 1" instead.
window.InviteRepeat = function (e, courseNext, pastOf, when) {
  const $ = (s) => document.querySelector(s), esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const line = (txt, hl) => { let nx = $("#nextOne"); if (!nx) { const wb = $("#m .facts > div:first-child"); if (!wb) return; nx = document.createElement("div"); nx.id = "nextOne"; nx.className = "muted"; nx.textContent = txt; wb.after(nx); } if (hl) nx.classList.add("rp-hl"); };
  if (!document.getElementById("rpCss")) { const st = document.createElement("style"); st.id = "rpCss"; st.textContent = `.rp-was{margin:0 0 10px;padding:10px 14px;border-radius:14px;background:#FFE08A;border:1.5px solid var(--ink);font-weight:600}.rp-hl{font-weight:700;color:var(--ink)!important}.rp-past{margin:26px 0 0}.rp-past h2{font:700 20px Fredoka,system-ui;margin:0 0 6px}.rp-tags{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}.rp-tags span{border:1px solid var(--line);background:#fff;border-radius:999px;padding:4px 10px;font-size:14px}.rp-ph{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px}.rp-ph img{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:12px;border:1.5px solid var(--ink);display:block}`; document.head.appendChild(st); }
  if (courseNext) return line(`Next class ${when({ date: courseNext })}`);
  if (!pastOf || $("#rpWas")) return;
  const P = pastOf.past || {}, was = when({ date: pastOf.e.date });
  const top = document.createElement("p"); top.className = "rp-was"; top.id = "rpWas"; top.textContent = `${was} has passed. Here's the next one.`; $("#m .top")?.after(top);
  line(`Next one ${when({ date: e.date })}`, true);
  const photos = (P.photos || []).filter((u) => /^\/_blob\/[A-Za-z0-9_-]{6,80}$/.test(u)), tags = P.tags || [];
  if (!photos.length && !P.kudos) return;
  const sec = document.createElement("section"); sec.className = "rp-past"; sec.id = "rpPast";
  sec.innerHTML = `<h2>Last time · ${esc(was)}</h2>${P.kudos ? `<p class="muted" style="margin:0 0 8px">${P.kudos} ${P.kudos === 1 ? "guest" : "guests"} sent kudos</p>${tags.length ? `<div class="rp-tags">${tags.map((t) => `<span>${esc(t.emoji)} ${esc(t.label)}${t.n > 1 ? ` · ${t.n}` : ""}</span>`).join("")}</div>` : ""}` : ""}${photos.length ? `<div class="rp-ph">${photos.map((u) => `<img src="${esc(u)}" alt="" loading="lazy">`).join("")}</div>` : ""}`;
  $("#m").appendChild(sec);
};
