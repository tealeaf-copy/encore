// The fan club on a host's page (server/fanclub.js): the card at #club. A guest sees the club's name, pitch and what
// members get, and joins in one tap (free; signed out, the tap goes through sign-up and comes back). A member sees the
// host's latest notes, the members' chat, their own two switches (badge, mute) and a quiet way to leave. The host starts
// the club here (a name and one line), sees who joined and who comes most, writes members a note, and opens Club
// settings in the same card: name and line, the first-dibs window, perks, every member with Remove (and Let back in),
// the members list and Turn the club off. A first-time host only ever needs the two fields and one button.
// Drawn in the page's first pass from what the page already has (d.club and d.viewer on GET /api/public/host/:handle),
// so nothing below it moves when it lands.
(function () {
  if (window.EncoreClub) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const send = async (method, url, body) => { const r = await fetch(url, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || "That didn't work. Try again."); return j; };
  const post = (url, body) => send("POST", url, body);
  const get = async (url) => { const r = await fetch(url, { credentials: "same-origin" }); return r.ok ? r.json() : null; };
  const month = (t) => (t ? new Date(t).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "");
  const day = (t) => (t ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
  const n = (c, one, many) => `${c} ${c === 1 ? one : many}`;
  const CSS = `.club{display:grid;gap:10px;padding:16px;border:1.5px solid var(--pl-line-strong,#1B1D1C);border-radius:var(--pl-r-md,6px);background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);scroll-margin-top:84px}
.club-k{margin:0;font:500 13px/1.3 var(--pl-font-mono,"IBM Plex Mono",ui-monospace,monospace);letter-spacing:.06em;text-transform:uppercase;color:var(--pl-soft,#444845)}
.club h3{margin:0;font-size:20px;line-height:1.25}.club h4{margin:8px 0 0;font-size:15px;line-height:1.3}.club p{margin:0;font-size:15px;line-height:1.5}.club .club-m{color:var(--pl-soft,#444845);font-size:14px}
.club ul{list-style:none;margin:0;padding:0;border-top:1px dashed var(--pl-line,#CFC8B9)}.club li{padding:8px 0;border-bottom:1px dashed var(--pl-line,#CFC8B9);font-size:15px;line-height:1.4;display:flex;justify-content:space-between;align-items:center;gap:10px}.club li small{color:var(--pl-soft,#444845);white-space:nowrap}
.club li.club-mem{padding:0;min-height:44px}.club li.club-mem > span{min-width:0;display:grid}.club li.club-mem small{white-space:normal;font-size:13px}.club li .club-q{flex:none}.club li.club-ev label{display:grid;grid-template-columns:minmax(0,1fr);gap:6px;width:100%;padding:8px 0;font-weight:400;font-size:15px}.club li.club-ev label > span{display:grid}
.club-b{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;border-radius:var(--pl-r-btn,6px);border:1.5px solid var(--pl-line-strong,#1B1D1C);background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);font:600 15px var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);cursor:pointer;text-decoration:none;justify-self:start}
.club-b.pri{background:var(--pl-accent,#29489A);border-color:var(--pl-accent,#29489A);color:var(--pl-on-accent,#fff)}.club-b[disabled]{opacity:.55;cursor:default}.club-b:focus-visible,.club-q:focus-visible,.club input:focus-visible,.club select:focus-visible,.club textarea:focus-visible{outline:3px solid var(--pl-accent,#29489A);outline-offset:2px}
.club-q{display:inline-flex;align-items:center;min-height:44px;padding:0;border:0;background:none;color:var(--pl-soft,#444845);font:400 14px var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);text-decoration:underline;text-underline-offset:3px;cursor:pointer;justify-self:start}
.club-row{display:flex;flex-wrap:wrap;gap:4px 16px;align-items:center}.club label{display:grid;gap:4px;font-weight:600;font-size:14px}.club label small{font-weight:400;font-size:13px;color:var(--pl-soft,#444845)}
.club input:not([type=checkbox]),.club select,.club textarea{min-height:44px;padding:0 12px;border:1.5px solid var(--pl-line-strong,#1B1D1C);border-radius:var(--pl-r-md,6px);background:var(--pl-page,#EFEBE2);color:inherit;font:400 16px var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);min-width:0;width:100%;box-sizing:border-box}
.club textarea{padding:10px 12px;min-height:96px;line-height:1.45;resize:vertical}
.club-perk{display:flex;gap:8px;align-items:center}.club-perk input{flex:1}.club-x{flex:none;width:44px;height:44px;display:grid;place-items:center;border:1.5px solid var(--pl-line,#CFC8B9);border-radius:var(--pl-r-btn,6px);background:none;color:inherit;cursor:pointer;padding:0}
.club label.club-sw{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px;padding:6px 0;border-bottom:1px dashed var(--pl-line,#CFC8B9);font-weight:400;font-size:15px;cursor:pointer}.club-sw span{display:grid;gap:2px}.club-sw small{font-size:13px;color:var(--pl-soft,#444845)}
.club-sw input{appearance:none;-webkit-appearance:none;flex:none;width:48px;height:28px;margin:8px 0;border-radius:999px;background:var(--pl-line-strong,#1B1D1C);opacity:.35;position:relative;cursor:pointer;transition:opacity .15s,background .15s}.club-sw input::after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;transition:transform .15s}
.club-sw input:checked{background:var(--pl-accent,#29489A);opacity:1}.club-sw input:checked::after{transform:translateX(20px)}@media (prefers-reduced-motion:reduce){.club-sw input,.club-sw input::after{transition:none}}
.club-note{padding:10px 12px;border-left:3px solid var(--pl-accent,#29489A);background:var(--pl-page,#EFEBE2)}.club-note small{display:block;margin-top:4px;color:var(--pl-soft,#444845);font-size:13px}.club-err{color:var(--pl-danger,#A2361A);font-size:14px;min-height:0}.club-ok{color:var(--pl-soft,#444845);font-size:14px}`;
  const perksOf = (c, host) => [c.earlyHours > 0 ? `First dibs on new dates, ${c.earlyHours} hours before everyone else` : "", "A members' chat", `Notes from ${host}`, ...(c.perks || [])].filter(Boolean);
  const earlyLabel = (h) => (h > 0 ? `${h} hours${h >= 24 ? ` (${n(h / 24, "day", "days")})` : ""}` : "No head start");
  const CSS_ESC = (s) => (window.CSS?.escape ? window.CSS.escape(s) : String(s).replace(/[^A-Za-z0-9_-]/g, ""));
  const X_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

  function mount(h, d) {
    const side = document.querySelector("aside.side"), V = d.viewer || {}, c0 = d.club || {}, own = !!V.own && !d.sample; if (!side || !h?.handle || h.showcase || document.getElementById("club")) return;
    if (!own && (!c0.on || V.blocked || V.removed)) return; // no club yet: only the host sees the card
    if (!document.getElementById("clubCss")) { const st = document.createElement("style"); st.id = "clubCss"; st.textContent = CSS; document.head.appendChild(st); }
    const box = document.createElement("section"); box.className = "club"; box.id = "club"; box.setAttribute("aria-labelledby", "clubH"); side.prepend(box);
    const hostName = String(d.person || h.name || "the host").trim().split(/\s+/)[0].replace(/['’]s$/i, ""), path = "/@" + encodeURIComponent(h.handle), api = "/api/me/club/" + encodeURIComponent(h.handle);
    const S = { c: { ...c0 }, member: !!V.member, since: V.since || 0, showBadge: !!V.showBadge, muted: !!V.muted, more: null, err: "", view: "" };
    const err = (m) => { S.err = m || ""; const e = box.querySelector(".club-err"); if (e) e.textContent = S.err; };
    const $ = (q) => box.querySelector(q);
    // a new view of the same card: the heading takes focus, so a keyboard or screen reader lands where the content changed
    const show = (view, draw) => { S.view = view; S.err = ""; draw(); const t = $("#clubH"); if (t) { t.tabIndex = -1; t.focus({ preventScroll: true }); } };
    const twice = (b, label) => { if (b.dataset.sure) return true; b.dataset.sure = "1"; b.textContent = label; setTimeout(() => { if (b.isConnected && b.dataset.sure) { delete b.dataset.sure; b.textContent = b.dataset.label; } }, 5000); return false; };

    // ---------- a guest, and a member ----------
    function guest() { const c = S.c, P = perksOf(c, hostName);
      if (S.member && S.view === "mine") return mine();
      if (S.member) { const posts = (S.more?.posts || []).slice(0, 3), chat = S.more?.chatId;
        box.innerHTML = `<p class="club-k">Fan club · ${n(c.members, "member", "members")}</p><h3 id="clubH">${esc(c.name)}</h3><p>You're in${S.since ? `, since ${esc(month(S.since))}` : ""}. ${S.muted ? "You muted this club's notices." : "You hear about new dates first."}</p>
          ${posts.length ? posts.map((p) => `<div class="club-note"><p>${esc(p.text)}</p><small>${esc(hostName)} · ${esc(day(p.at))}</small></div>`).join("") : `<p class="club-m">No notes from ${esc(hostName)} yet. They'll land here and in your feed.</p>`}
          <div class="club-row">${chat ? `<a class="club-b" href="/chats/${encodeURIComponent(chat)}">Open the members' chat</a>` : ""}<button type="button" class="club-q" data-mine>Your settings</button><button type="button" class="club-q" data-leave data-label="Leave the club">Leave the club</button></div><p class="club-err" role="alert">${esc(S.err)}</p>`;
        $("[data-mine]").onclick = () => show("mine", guest);
        $("[data-leave]").onclick = async (ev) => { const b = ev.currentTarget; if (!twice(b, "Tap again to leave")) return; b.disabled = true; try { const j = await post(api + "/leave"); S.member = false; S.c.members = j.members; S.more = null; S.view = ""; guest(); } catch (e) { b.disabled = false; err(e.message); } };
        return; }
      box.innerHTML = `<p class="club-k">Fan club · ${c.members ? n(c.members, "member", "members") : "new"}</p><h3 id="clubH">${esc(c.name)}</h3>${c.pitch ? `<p>${esc(c.pitch)}</p>` : ""}
        <ul>${P.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        ${d.sample ? `<p class="club-m">An example page, so there's no club to join.</p>` : V.signedIn ? `<button type="button" class="club-b pri" data-join>Join, it's free</button>` : `<a class="club-b pri" href="/signup?mode=friends&next=${encodeURIComponent(path + "?join=1#club")}">Join, it's free</a><p class="club-m">Takes a free account, about 20 seconds.</p>`}<p class="club-err" role="alert">${esc(S.err)}</p>`;
      const jb = $("[data-join]"); if (jb) jb.onclick = join; }
    // a member's own two switches: saved on the tap, put back if the save fails
    function mine() {
      box.innerHTML = `<p class="club-k">${esc(S.c.name)}</p><h3 id="clubH">Your settings</h3>
        <label class="club-sw"><span>Show my member badge<small>"${esc(S.c.name)} since ${esc(month(S.since) || "you joined")}" on your own page. Off unless you turn it on.</small></span><input type="checkbox" id="clubBadge"${S.showBadge ? " checked" : ""}></label>
        <label class="club-sw"><span>Mute this club<small>No notices or emails about ${esc(hostName)}'s notes and new dates. You stay a member.</small></span><input type="checkbox" id="clubMute"${S.muted ? " checked" : ""}></label>
        <div class="club-row"><button type="button" class="club-b" data-back>Done</button></div><p class="club-err" role="alert"></p>`;
      const save = (id, key) => { $(id).onchange = async (ev) => { const el = ev.currentTarget, on = el.checked; el.disabled = true; try { const j = await post(api + "/settings", { [key]: on }); S.showBadge = !!j.showBadge; S.muted = !!j.muted; err(""); } catch (e) { el.checked = !on; err(e.message); } el.disabled = false; }; };
      save("#clubBadge", "showBadge"); save("#clubMute", "muted"); $("[data-back]").onclick = () => show("", guest); }
    async function join() { const b = $("[data-join]"); if (b) { b.disabled = true; b.textContent = "Joining…"; }
      try { const j = await post(api + "/join"); S.member = true; S.since = j.since || Date.now(); S.c.members = j.members; S.more = { chatId: j.chatId, posts: [] }; guest(); window.PLFx?.stamp?.("Member", $("h3"), { small: true }); $("h3 .hl-stamp")?.style.setProperty("margin-left", "10px"); details(); }
      catch (e) { if (b) { b.disabled = false; b.textContent = "Join, it's free"; } err(e.message); } }
    async function details() { const j = await get("/api/public/club/" + encodeURIComponent(h.handle)).catch(() => null); if (j && S.member) { S.more = { chatId: j.chatId || "", posts: j.posts || [] }; S.showBadge = !!j.showBadge; S.muted = !!j.muted; if (S.view !== "mine") guest(); } }

    // ---------- the host ----------
    let M0 = null;
    function host(M) { const c = S.c; M = M || M0;
      if (c.on && S.view === "settings") return settings(M); if (c.on && S.view === "note") return note(M);
      if (!c.on) { box.innerHTML = `<p class="club-k">Only you see this</p><h3 id="clubH">Start a fan club</h3><p>A home for your regulars. Members hear about new dates first and get a chat of their own. Free, and you can turn it off any time.</p>${window.EncoreMembership?.clubLine?.(d) || "" /* paid memberships (public/memberships.js) */}
          <label>Club name<input id="clubName" maxlength="60" value="${esc(c.name || M?.club?.name || "")}" placeholder="${esc(hostName)}'s Regulars"></label><label>One line on why to join<input id="clubPitch" maxlength="140" value="${esc(c.pitch || "")}" placeholder="First to hear, first to the table."></label>
          <button type="button" class="club-b pri" data-start>Start the club</button><p class="club-err" role="alert">${esc(S.err)}</p>`;
        $("[data-start]").onclick = async (ev) => { const b = ev.currentTarget; b.disabled = true; try { const j = await post("/api/host/club", { on: true, name: $("#clubName").value.trim() || undefined, pitch: $("#clubPitch").value.trim() }); S.c = { ...S.c, ...(j.club || j), on: true, members: S.c.members || 0 }; S.err = ""; S.view = ""; host(M); window.PLFx?.stamp?.("Open", $("h3"), { small: true }); $("h3 .hl-stamp")?.style.setProperty("margin-left", "10px"); load(); } catch (e) { b.disabled = false; err(e.message); } };
        return; }
      const mem = M?.members || [], reg = M?.regulars || [];
      box.innerHTML = `<p class="club-k">Your fan club · ${n(M ? mem.length : c.members || 0, "member", "members")}</p><h3 id="clubH">${esc(c.name)}</h3>${c.pitch ? `<p>${esc(c.pitch)}</p>` : ""}
        <p class="club-m">Members hear about a new date ${c.earlyHours > 0 ? `${c.earlyHours} hours before everyone else` : "as soon as it's out"}.</p>${window.EncoreMembership?.clubLine?.(d) || "" /* paid memberships (public/memberships.js): Start a membership, or how close you are */}
        ${mem.length ? `<ul>${(reg.length ? reg : mem.slice(0, 5)).map((m) => `<li><span>${esc(m.name)}</span><small>${m.attended ? n(m.attended, "event", "events") : "joined " + esc(day(m.since))}</small></li>`).join("")}</ul>` : `<p class="club-m">Nobody yet. Guests can join from this card on your page, so send them your page link.</p>`}
        <div class="club-row"><button type="button" class="club-b" data-note>Write a note</button><button type="button" class="club-b" data-settings>Club settings</button></div><p class="club-err" role="alert">${esc(S.err)}</p>`;
      $("[data-note]").onclick = () => show("note", () => host(M0)); $("[data-settings]").onclick = () => show("settings", () => host(M0)); }

    // a note to members, written here (it used to be one step away, behind the + on the feed)
    function note(M) { const mem = M?.members || [], max = M?.postMax || 500, posts = (M?.posts || []).slice(0, 3);
      box.innerHTML = `<p class="club-k">${esc(S.c.name)}</p><h3 id="clubH">A note to your members</h3>
        <label>Your note<textarea id="clubNote" maxlength="${max}" placeholder="Next one is pork and chive. You get first dibs from Friday."></textarea><small>${mem.length ? `Goes to ${n(mem.length, "member", "members")}: their feed, their bell and one email. ` : "Nobody has joined yet, so it waits here for your first members. "}Up to ${max} characters.</small></label>
        <div class="club-row"><button type="button" class="club-b pri" data-send>Send the note</button><button type="button" class="club-q" data-back>Back</button></div><p class="club-err" role="alert"></p><p class="club-ok" role="status"></p>
        ${posts.length ? `<h4>Your latest notes</h4>${posts.map((p) => `<div class="club-note"><p>${esc(p.text)}</p><small>${esc(day(p.at))}${p.hearts ? " · " + n(p.hearts, "heart", "hearts") : ""} · <button type="button" class="club-q" style="min-height:44px;font-size:13px" data-del="${esc(p.id)}" data-label="Delete">Delete</button></small></div>`).join("")}` : ""}`;
      $("[data-back]").onclick = () => show("", () => host(M0));
      $("[data-send]").onclick = async (ev) => { const b = ev.currentTarget, t = $("#clubNote").value.trim(); if (!t) { err("Write a line first."); $("#clubNote").focus(); return; } b.disabled = true; err("");
        try { await post("/api/host/club/posts", { text: t }); await load(true); S.view = "note"; note(M0); $(".club-ok").textContent = mem.length ? `Sent to ${n(mem.length, "member", "members")}.` : "Saved. Your first members will see it."; } catch (e) { b.disabled = false; err(e.message); } };
      box.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => { if (!twice(b, "Tap again to delete")) return; b.disabled = true; try { await send("DELETE", "/api/host/club/posts/" + encodeURIComponent(b.dataset.del)); await load(true); note(M0); } catch (e) { b.disabled = false; err(e.message); } })); }

    function settings(M) { const c = S.c, evs = M?.events || [], mem = M?.members || [], gone = M?.removed || [], hours = M?.earlyOptions || [0, 12, 24, 48, 72], max = M?.perksMax || 5;
      const perks = S.perks || (S.perks = [...(c.perks || [])]);
      const perkRow = (p, i) => `<div class="club-perk"><input data-perk="${i}" maxlength="80" value="${esc(p)}" aria-label="Perk ${i + 1}" placeholder="A seat at the test kitchen night"><button type="button" class="club-x" data-rm="${i}" aria-label="Remove perk ${i + 1}">${X_ICON}</button></div>`;
      box.innerHTML = `<p class="club-k">Your fan club</p><h3 id="clubH">Club settings</h3>
        <label>Club name<input id="clubName" maxlength="60" value="${esc(c.name || "")}"></label>
        <label>One line on why to join<input id="clubPitch" maxlength="140" value="${esc(c.pitch || "")}" placeholder="First to hear, first to the table."></label>
        <label>First dibs on new dates<select id="clubEarly">${hours.map((x) => `<option value="${x}"${x === c.earlyHours ? " selected" : ""}>${esc(earlyLabel(x))}</option>`).join("")}</select><small>How long members get a date before everyone else, once you set that date to Members first below.</small></label>
        <div style="display:grid;gap:8px"><h4 id="clubPerksH" style="margin:0">What members get</h4><p class="club-m">Always: first dibs, a members' chat, and your notes. Add up to ${max} of your own.</p>
          <div id="clubPerks" role="group" aria-labelledby="clubPerksH" style="display:grid;gap:8px">${perks.map(perkRow).join("")}</div>${perks.length < max ? `<button type="button" class="club-q" data-add>Add a perk</button>` : ""}</div>
        <div class="club-row"><button type="button" class="club-b pri" data-save>Save</button><button type="button" class="club-q" data-back>Back</button></div><p class="club-err" role="alert">${esc(S.err)}</p><p class="club-ok" role="status">${esc(S.ok || "")}</p>
        ${evs.length ? `<h4 id="clubEvH">Who sees your coming dates</h4><ul aria-labelledby="clubEvH">${evs.map((e) => `<li class="club-mem club-ev"><label><span>${esc(e.title)}<small>${esc([e.drop ? "Drop" : "", e.date ? new Date(e.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "No date yet", e.visibility === "early" && e.earlyUntil ? "members first until " + new Date(e.earlyUntil).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }) : ""].filter(Boolean).join(" · "))}</small></span>
          <select data-ev="${esc(e.id)}" aria-label="Who sees ${esc(e.title)}"><option value="everyone"${e.visibility === "everyone" ? " selected" : ""}>Everyone</option><option value="early"${e.visibility === "early" ? " selected" : ""}>Members first</option><option value="members"${e.visibility === "members" ? " selected" : ""}>Members only</option></select></label></li>`).join("")}</ul>` : ""}
        <h4>Members (${mem.length})</h4>
        ${mem.length ? `<ul>${mem.map((m) => `<li class="club-mem"><span>${esc(m.name)}<small>Joined ${esc(day(m.since))}${m.attended ? " · " + n(m.attended, "event", "events") : ""}${m.badge ? " · shows the badge" : ""}</small></span><button type="button" class="club-q" data-remove="${esc(m.id)}" data-label="Remove" aria-label="Remove ${esc(m.name)}">Remove</button></li>`).join("")}</ul><p class="club-m">Removing someone is quiet: they aren't told, and they can't rejoin unless you let them back in.</p>` : `<p class="club-m">Nobody yet. Guests join from this card on your page.</p>`}
        ${gone.length ? `<h4>Removed</h4><ul>${gone.map((m) => `<li class="club-mem"><span>${esc(m.name)}<small>Removed ${esc(day(m.at))}</small></span><button type="button" class="club-q" data-restore="${esc(m.id)}" aria-label="Let ${esc(m.name)} back in">Let back in</button></li>`).join("")}</ul>` : ""}
        <div class="club-row">${mem.length ? `<a class="club-q" href="/api/host/club/members.csv">Members list (CSV)</a>` : ""}<button type="button" class="club-q" data-off data-label="Turn the club off">Turn the club off</button></div>`;
      S.ok = "";
      const keep = () => { box.querySelectorAll("[data-perk]").forEach((el) => { perks[+el.dataset.perk] = el.value; }); c.name = $("#clubName").value; c.pitch = $("#clubPitch").value; c.earlyHours = +$("#clubEarly").value; };
      const add = $("[data-add]"); if (add) add.onclick = () => { keep(); perks.push(""); settings(M0); box.querySelector(`[data-perk="${perks.length - 1}"]`)?.focus(); };
      box.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { keep(); perks.splice(+b.dataset.rm, 1); settings(M0); ($("[data-add]") || $("[data-save]")).focus(); }));
      $("[data-back]").onclick = () => { S.perks = null; show("", () => { load(); host(M0); }); };
      $("[data-save]").onclick = async (ev) => { const b = ev.currentTarget; keep(); if (!c.name.trim()) { err("Give the club a name."); $("#clubName").focus(); return; } b.disabled = true; err("");
        try { const j = await post("/api/host/club", { name: c.name.trim(), pitch: c.pitch.trim(), earlyHours: c.earlyHours, perks: perks.map((x) => x.trim()).filter(Boolean) }); S.c = { ...S.c, ...(j.club || {}) }; S.perks = [...(S.c.perks || [])]; if (M0) M0.club = { ...M0.club, ...j.club }; S.ok = "Saved."; settings(M0); $("[data-save]").focus(); } catch (e) { b.disabled = false; err(e.message); } };
      box.querySelectorAll("[data-remove]").forEach((b) => (b.onclick = async () => { if (!twice(b, "Tap again to remove")) return; b.disabled = true; keep(); try { await post("/api/host/club/members/" + encodeURIComponent(b.dataset.remove) + "/remove"); await load(true); S.ok = "Removed."; settings(M0); } catch (e) { b.disabled = false; err(e.message); } }));
      box.querySelectorAll("[data-restore]").forEach((b) => (b.onclick = async () => { b.disabled = true; keep(); try { await post("/api/host/club/members/" + encodeURIComponent(b.dataset.restore) + "/restore"); await load(true); S.ok = "They're back in."; settings(M0); } catch (e) { b.disabled = false; err(e.message); } }));
      box.querySelectorAll("[data-ev]").forEach((el) => (el.onchange = async () => { const was = (M0?.events || []).find((e) => e.id === el.dataset.ev)?.visibility || "everyone"; el.disabled = true; keep(); try { await post("/api/host/club/events/" + encodeURIComponent(el.dataset.ev), { visibility: el.value }); await load(true); S.ok = el.value === "early" ? "Members get it first." : el.value === "members" ? "Only members can see and reply." : "Open to everyone."; settings(M0); box.querySelector(`[data-ev="${CSS_ESC(el.dataset.ev)}"]`)?.focus(); } catch (e) { el.value = was; el.disabled = false; err(e.message); } }));
      $("[data-off]").onclick = async (ev) => { const b = ev.currentTarget; if (!twice(b, "Tap again to turn it off")) return; b.disabled = true; try { await post("/api/host/club", { on: false }); S.c.on = false; S.view = ""; S.perks = null; host(M0); } catch (e) { b.disabled = false; err(e.message); } }; }
    // quiet: fetch only, the caller redraws (used while a form is open, so typing is never wiped)
    async function load(quiet) { const j = await get("/api/host/club").catch(() => null); if (!j) return; M0 = j; const edit = S.view === "settings" ? { name: S.c.name, pitch: S.c.pitch, earlyHours: S.c.earlyHours } : {}; S.c = { ...S.c, ...j.club, ...edit, members: (j.members || []).length }; if (quiet) return;
      const typing = box.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName); if (!typing) host(M0); }

    if (own) { host(null); load(); } else { guest(); if (S.member) details(); else if (V.signedIn && /[?&]join=1\b/.test(location.search)) { history.replaceState(null, "", path + "#club"); join(); } }
    // arriving at #club (the guide's "Start a fan club", a member's link): the card is brought into view, and again once
    // the sections above it have landed, unless the reader has started moving the page themselves
    if (location.hash === "#club") { let moved = false; const stop = () => { moved = true; }; ["wheel", "touchmove", "keydown"].forEach((k) => addEventListener(k, stop, { once: true, passive: true })); for (const ms of [60, 700, 1600]) setTimeout(() => { if (!moved) box.scrollIntoView({ block: "start" }); }, ms); }
  }
  window.EncoreClub = { mount };
})();
