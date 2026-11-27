// The fan club on a host's page (server/fanclub.js): the card at #club. A guest sees the club's name, pitch and what
// members get, and joins in one tap (free; signed out, the tap goes through sign-up and comes back). A member sees the
// host's latest notes, the members' chat and a quiet way to leave. The host starts the club here (a name and one line),
// sees who joined and who comes most, and can turn it off. Drawn in the page's first pass from what the page already
// has (d.club and d.viewer on GET /api/public/host/:handle), so nothing below it moves when it lands.
(function () {
  if (window.EncoreClub) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const post = async (url, body) => { const r = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || "That didn't work. Try again."); return j; };
  const get = async (url) => { const r = await fetch(url, { credentials: "same-origin" }); return r.ok ? r.json() : null; };
  const month = (t) => (t ? new Date(t).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "");
  const day = (t) => (t ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
  const n = (c, one, many) => `${c} ${c === 1 ? one : many}`;
  const CSS = `.club{display:grid;gap:10px;padding:16px;border:1.5px solid var(--pl-line-strong,#1B1D1C);border-radius:var(--pl-r-md,6px);background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);scroll-margin-top:84px}
.club-k{margin:0;font:500 13px/1.3 var(--pl-font-mono,"IBM Plex Mono",ui-monospace,monospace);letter-spacing:.06em;text-transform:uppercase;color:var(--pl-soft,#444845)}
.club h3{margin:0;font-size:20px;line-height:1.25}.club p{margin:0;font-size:15px;line-height:1.5}.club .club-m{color:var(--pl-soft,#444845);font-size:14px}
.club ul{list-style:none;margin:0;padding:0;border-top:1px dashed var(--pl-line,#CFC8B9)}.club li{padding:8px 0;border-bottom:1px dashed var(--pl-line,#CFC8B9);font-size:15px;line-height:1.4;display:flex;justify-content:space-between;gap:10px}.club li small{color:var(--pl-soft,#444845);white-space:nowrap}
.club-b{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;border-radius:var(--pl-r-btn,6px);border:1.5px solid var(--pl-line-strong,#1B1D1C);background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);font:600 15px var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);cursor:pointer;text-decoration:none;justify-self:start}
.club-b.pri{background:var(--pl-accent,#29489A);border-color:var(--pl-accent,#29489A);color:var(--pl-on-accent,#fff)}.club-b[disabled]{opacity:.55;cursor:default}.club-b:focus-visible,.club-q:focus-visible,.club input:focus-visible{outline:3px solid var(--pl-accent,#29489A);outline-offset:2px}
.club-q{display:inline-flex;align-items:center;min-height:44px;padding:0;border:0;background:none;color:var(--pl-soft,#444845);font:400 14px var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);text-decoration:underline;text-underline-offset:3px;cursor:pointer;justify-self:start}
.club-row{display:flex;flex-wrap:wrap;gap:4px 16px;align-items:center}.club label{display:grid;gap:4px;font-weight:600;font-size:14px}.club input{min-height:44px;padding:0 12px;border:1.5px solid var(--pl-line-strong,#1B1D1C);border-radius:var(--pl-r-md,6px);background:var(--pl-page,#EFEBE2);color:inherit;font:400 16px var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);min-width:0}
.club-note{padding:10px 12px;border-left:3px solid var(--pl-accent,#29489A);background:var(--pl-page,#EFEBE2)}.club-note small{display:block;margin-top:4px;color:var(--pl-soft,#444845);font-size:13px}.club-err{color:var(--pl-danger,#A2361A);font-size:14px;min-height:0}`;
  const perksOf = (c, host) => [c.earlyHours > 0 ? `First dibs on new dates, ${c.earlyHours} hours before everyone else` : "", "A members' chat", `Notes from ${host}`, ...(c.perks || [])].filter(Boolean);

  function mount(h, d) {
    const side = document.querySelector("aside.side"), V = d.viewer || {}, c0 = d.club || {}, own = !!V.own && !d.sample; if (!side || !h?.handle || h.showcase || document.getElementById("club")) return;
    if (!own && (!c0.on || V.blocked || V.removed)) return; // no club yet: only the host sees the card
    if (!document.getElementById("clubCss")) { const st = document.createElement("style"); st.id = "clubCss"; st.textContent = CSS; document.head.appendChild(st); }
    const box = document.createElement("section"); box.className = "club"; box.id = "club"; box.setAttribute("aria-labelledby", "clubH"); side.prepend(box);
    const hostName = String(d.person || h.name || "the host").trim().split(/\s+/)[0], path = "/@" + encodeURIComponent(h.handle), api = "/api/me/club/" + encodeURIComponent(h.handle);
    const S = { c: { ...c0 }, member: !!V.member, since: V.since || 0, more: null, err: "" };
    const err = (m) => { S.err = m || ""; const e = box.querySelector(".club-err"); if (e) e.textContent = S.err; };

    function guest() { const c = S.c, P = perksOf(c, hostName);
      if (S.member) { const posts = (S.more?.posts || []).slice(0, 3), chat = S.more?.chatId;
        box.innerHTML = `<p class="club-k">Fan club · ${n(c.members, "member", "members")}</p><h3 id="clubH">${esc(c.name)}</h3><p>You're in${S.since ? `, since ${esc(month(S.since))}` : ""}. You hear about new dates first.</p>
          ${posts.length ? posts.map((p) => `<div class="club-note"><p>${esc(p.text)}</p><small>${esc(hostName)} · ${esc(day(p.at))}</small></div>`).join("") : `<p class="club-m">No notes from ${esc(hostName)} yet. They'll land here and in your feed.</p>`}
          <div class="club-row">${chat ? `<a class="club-b" href="/chats/${encodeURIComponent(chat)}">Open the members' chat</a>` : ""}<button type="button" class="club-q" data-leave>Leave the club</button></div><p class="club-err" role="alert">${esc(S.err)}</p>`;
        box.querySelector("[data-leave]").onclick = async (ev) => { const b = ev.currentTarget; if (!b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "Tap again to leave"; return; } b.disabled = true; try { const j = await post(api + "/leave"); S.member = false; S.c.members = j.members; S.more = null; guest(); } catch (e) { b.disabled = false; err(e.message); } };
        return; }
      box.innerHTML = `<p class="club-k">Fan club · ${c.members ? n(c.members, "member", "members") : "new"}</p><h3 id="clubH">${esc(c.name)}</h3>${c.pitch ? `<p>${esc(c.pitch)}</p>` : ""}
        <ul>${P.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        ${d.sample ? `<p class="club-m">An example page, so there's no club to join.</p>` : V.signedIn ? `<button type="button" class="club-b pri" data-join>Join, it's free</button>` : `<a class="club-b pri" href="/signup?mode=friends&next=${encodeURIComponent(path + "?join=1#club")}">Join, it's free</a><p class="club-m">Takes a free account, about 20 seconds.</p>`}<p class="club-err" role="alert">${esc(S.err)}</p>`;
      const jb = box.querySelector("[data-join]"); if (jb) jb.onclick = join; }
    async function join() { const b = box.querySelector("[data-join]"); if (b) { b.disabled = true; b.textContent = "Joining…"; }
      try { const j = await post(api + "/join"); S.member = true; S.since = j.since || Date.now(); S.c.members = j.members; S.more = { chatId: j.chatId, posts: [] }; guest(); window.PLFx?.stamp?.("Member", box.querySelector("h3"), { small: true }); box.querySelector("h3 .hl-stamp")?.style.setProperty("margin-left", "10px"); details(); }
      catch (e) { if (b) { b.disabled = false; b.textContent = "Join, it's free"; } err(e.message); } }
    async function details() { const j = await get("/api/public/club/" + encodeURIComponent(h.handle)).catch(() => null); if (j && S.member) { S.more = { chatId: j.chatId || "", posts: j.posts || [] }; guest(); } }

    function host(M) { const c = S.c;
      if (!c.on) { box.innerHTML = `<p class="club-k">Only you see this</p><h3 id="clubH">Start a fan club</h3><p>A home for your regulars. Members hear about new dates first and get a chat of their own. Free, and you can turn it off any time.</p>
          <label>Club name<input id="clubName" maxlength="60" value="${esc(c.name || M?.club?.name || "")}" placeholder="${esc(hostName)}'s Regulars"></label><label>One line on why to join<input id="clubPitch" maxlength="140" value="${esc(c.pitch || "")}" placeholder="First to hear, first to the table."></label>
          <button type="button" class="club-b pri" data-start>Start the club</button><p class="club-err" role="alert">${esc(S.err)}</p>`;
        box.querySelector("[data-start]").onclick = async (ev) => { const b = ev.currentTarget; b.disabled = true; try { const j = await post("/api/host/club", { on: true, name: box.querySelector("#clubName").value.trim() || undefined, pitch: box.querySelector("#clubPitch").value.trim() }); S.c = { ...S.c, ...(j.club || j), on: true, members: S.c.members || 0 }; S.err = ""; host(M); window.PLFx?.stamp?.("Open", box.querySelector("h3"), { small: true }); box.querySelector("h3 .hl-stamp")?.style.setProperty("margin-left", "10px"); load(); } catch (e) { b.disabled = false; err(e.message); } };
        return; }
      const mem = M?.members || [], reg = M?.regulars || [];
      box.innerHTML = `<p class="club-k">Your fan club · ${n(M ? mem.length : c.members || 0, "member", "members")}</p><h3 id="clubH">${esc(c.name)}</h3>${c.pitch ? `<p>${esc(c.pitch)}</p>` : ""}
        <p class="club-m">Members hear about a new date ${c.earlyHours > 0 ? `${c.earlyHours} hours before everyone else` : "as soon as it's out"}. Write them a note from the + on your feed.</p>
        ${mem.length ? `<ul>${(reg.length ? reg : mem.slice(0, 5)).map((m) => `<li><span>${esc(m.name)}</span><small>${m.attended ? n(m.attended, "event", "events") : "joined " + esc(day(m.since))}</small></li>`).join("")}</ul>` : `<p class="club-m">Nobody yet. Guests can join from this card on your page, so send them your page link.</p>`}
        <div class="club-row"><a class="club-b" href="/feed">Write a note</a>${mem.length ? `<a class="club-q" href="/api/host/club/members.csv">Members list (CSV)</a>` : ""}<button type="button" class="club-q" data-off>Turn the club off</button></div><p class="club-err" role="alert">${esc(S.err)}</p>`;
      box.querySelector("[data-off]").onclick = async (ev) => { const b = ev.currentTarget; if (!b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "Tap again to turn it off"; return; } b.disabled = true; try { await post("/api/host/club", { on: false }); S.c.on = false; host(M); } catch (e) { b.disabled = false; err(e.message); } }; }
    let M0 = null; async function load() { const j = await get("/api/host/club").catch(() => null); if (!j) return; M0 = j; S.c = { ...S.c, ...j.club, members: (j.members || []).length }; const typing = box.contains(document.activeElement) && document.activeElement.tagName === "INPUT"; if (!typing) host(M0); }

    if (own) { host(null); load(); } else { guest(); if (S.member) details(); else if (V.signedIn && /[?&]join=1\b/.test(location.search)) { history.replaceState(null, "", path + "#club"); join(); } }
    // arriving at #club (the guide's "Start a fan club", a member's link): the card is brought into view, and again once
    // the sections above it have landed, unless the reader has started moving the page themselves
    if (location.hash === "#club") { let moved = false; const stop = () => { moved = true; }; ["wheel", "touchmove", "keydown"].forEach((k) => addEventListener(k, stop, { once: true, passive: true })); for (const ms of [60, 700, 1600]) setTimeout(() => { if (!moved) box.scrollIntoView({ block: "start" }); }, ms); }
  }
  window.EncoreClub = { mount };
})();
