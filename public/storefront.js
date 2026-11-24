// A host's storefront: their colours, fonts, cover, photo, links and sections, chosen from curated options so every page
// stays readable. The owner customizes it in place.
(function () {
  // your own page: no "Request a spot" on your own event, just a way back to the plan
  function ownerCta(e) { try { const a = document.querySelector("#nextUp .nu-go"); if (!a || a.dataset.own) return; a.dataset.own = 1; a.textContent = "Manage this event"; a.href = "/?app=1#studio"; a.addEventListener("click", () => { try { localStorage.setItem("encore-open", JSON.stringify(e.id)); } catch {} }); } catch {} }
  const FONTS = {
    classic: { label: "Classic", head: "Fraunces", body: "DM Sans", q: "Fraunces:opsz,wght@9..144,600&family=DM+Sans:wght@400;500;600" },
    editorial: { label: "Editorial", head: "Playfair Display", body: "Lato", q: "Playfair+Display:wght@600;700&family=Lato:wght@400;700" },
    modern: { label: "Modern", head: "Space Grotesk", body: "Inter", q: "Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600" },
    playful: { label: "Playful", head: "Bricolage Grotesque", body: "DM Sans", q: "Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=DM+Sans:wght@400;500;600" },
    handmade: { label: "Handmade", head: "Caveat", body: "Nunito", q: "Caveat:wght@600;700&family=Nunito:wght@400;600;700" },
    bold: { label: "Bold", head: "Archivo Black", body: "Archivo", q: "Archivo+Black&family=Archivo:wght@400;500;600" },
  };
  const BGS = { cream: { label: "Cream", bg: "#FBF6EF", card: "#FFFFFF", ink: "#2B211C", soft: "#75685F", line: "#EEE4D8" }, white: { label: "White", bg: "#FFFFFF", card: "#FAF8F5", ink: "#1F1A17", soft: "#6F655E", line: "#ECE6DF" }, blush: { label: "Blush", bg: "#FFF1F3", card: "#FFFFFF", ink: "#2B1D21", soft: "#7A6267", line: "#F5DCE1" }, sage: { label: "Sage", bg: "#F1F6F1", card: "#FFFFFF", ink: "#1E2A22", soft: "#5F6F64", line: "#DCE7DE" } };
  const ACCENTS = ["#E26D8E", "#C2553A", "#E0A030", "#3E9C6E", "#2F7A8A", "#5B7FD6", "#8C62C9", "#2B211C"];
  const COVERS = { wash: "Soft wash", sunrise: "Sunrise", dusk: "Dusk", dots: "Dots", waves: "Waves", confetti: "Confetti", plain: "Plain" };
  const BUTTONS = { round: "999px", soft: "12px", square: "4px" };
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const loaded = new Set(); const loadFont = (k) => { if (loaded.has(k) || !FONTS[k]) return; loaded.add(k); const l = document.createElement("link"); l.rel = "stylesheet"; l.href = `https://fonts.googleapis.com/css2?family=${FONTS[k].q}&display=swap`; document.head.appendChild(l); };
  function cover(t) { const a = t.accent; if (t.coverUrl) return `center/cover no-repeat url("${t.coverUrl}")`;
    return { wash: `radial-gradient(120% 140% at 90% 0%, color-mix(in srgb, ${a} 45%, #fff) 0%, transparent 60%), linear-gradient(135deg, color-mix(in srgb, ${a} 22%, #fff), #FFFDF9)`, sunrise: `radial-gradient(90% 120% at 80% 110%, #FFE6A7 0%, transparent 55%), linear-gradient(120deg, color-mix(in srgb, ${a} 85%, #000) 0%, ${a} 35%, #F7C59F 75%)`, dusk: `radial-gradient(70% 120% at 82% 18%, color-mix(in srgb, ${a} 75%, transparent) 0%, transparent 60%), radial-gradient(60% 100% at 12% 100%, color-mix(in srgb, ${a} 28%, transparent) 0%, transparent 65%), linear-gradient(160deg, #1A1310 0%, #2B1C15 100%)`, dots: `radial-gradient(color-mix(in srgb, ${a} 70%, #fff) 2px, transparent 2.5px) 0 0/18px 18px, color-mix(in srgb, ${a} 14%, #fff)`, waves: `repeating-radial-gradient(circle at 10% 120%, color-mix(in srgb, ${a} 30%, #fff) 0 14px, color-mix(in srgb, ${a} 12%, #fff) 14px 28px)`, confetti: `radial-gradient(circle at 20% 30%, ${a} 4px, transparent 5px), radial-gradient(circle at 70% 60%, #E0A030 4px, transparent 5px), radial-gradient(circle at 45% 80%, #5B7FD6 3px, transparent 4px), radial-gradient(circle at 85% 20%, #3E9C6E 3px, transparent 4px) 0 0/120px 90px, color-mix(in srgb, ${a} 10%, #fff)`, plain: `color-mix(in srgb, ${a} 22%, #fff)` }[t.cover] || "none"; }
  const DEF = { accent: "#E26D8E", font: "classic", bg: "cream", cover: "wash", buttons: "round", coverUrl: "", avatarUrl: "" };
  function apply(h) { const t = { ...DEF, ...(h.theme || {}) }; if (!t.coverUrl && (h.gallery || [])[0]) t.coverUrl = h.gallery[0]; const _t = t, B = BGS[t.bg] || BGS.cream, F = FONTS[t.font] || FONTS.classic, root = document.documentElement.style; loadFont(t.font);
    // Guardrail: the accent is used for buttons; text on it is white or ink, whichever reads better. Accent text on the page darkens if it would be hard to read.
    const onAccent = contrast(t.accent, "#FFFFFF") >= 3 ? "#FFFFFF" : "#1F1A17", accentText = contrast(t.accent, B.bg) >= 3 ? t.accent : t.bg === "night" ? `color-mix(in srgb, ${t.accent} 60%, #fff)` : `color-mix(in srgb, ${t.accent} 60%, #000)`;
    Object.entries({ "--accent": t.accent, "--bg": B.bg, "--card": B.card, "--ink": B.ink, "--soft": B.soft, "--line": B.line, "--brand": t.accent, "--brand2": accentText, "--on-brand": onAccent, "--c": t.accent, "--pink": `color-mix(in srgb, ${t.accent} 14%, ${B.card})`, "--radius": BUTTONS[t.buttons] || "999px", "--head": `"${F.head}", Georgia, serif`, "--body": `"${F.body}", system-ui, sans-serif` }).forEach(([k, v]) => { root.setProperty(k, v); document.body.style.setProperty(k, v); });
    document.documentElement.dataset.theme = "light"; document.body.classList.add("store");
    const cv = document.querySelector(".cover"); if (cv) cv.style.background = cover(t);
    const av = document.querySelector(".av"); if (av) { av.innerHTML = t.avatarUrl ? `<img src="${t.avatarUrl}" alt="">` : t.avatarArt && window.EncoreAvatars ? window.EncoreAvatars.svg(t.avatarArt, t.accent, 120) : (h.emoji || "🎉"); av.classList.toggle("drawn", !!(t.avatarArt && !t.avatarUrl)); }
    const S = { upcoming: true, kudos: true, photos: true, hire: true, tips: true, profile: false, past: true, ...(h.sections || {}) };
    document.body.classList.toggle("no-kudos", !S.kudos); document.body.classList.toggle("no-photos", !S.photos); document.body.classList.toggle("no-hire", !S.hire); document.body.classList.toggle("no-tips", !S.tips); document.body.classList.toggle("no-profile", !S.profile); document.body.classList.toggle("no-past", !S.past);
    let ln = document.getElementById("storeLinks"); const head = document.querySelector(".head > div");
    if (!ln && head) { ln = document.createElement("div"); ln.id = "storeLinks"; ln.className = "store-links"; head.appendChild(ln); }
    if (ln) ln.innerHTML = (h.links || []).map((l) => `<a href="${l.url.replace(/"/g, "&quot;")}" target="_blank" rel="noopener nofollow">${l.label.replace(/[<>&]/g, "")}</a>`).join("");
    let tg = document.getElementById("storeTag"); const h1 = document.querySelector(".head h1"); if (!tg && h1) { tg = document.createElement("div"); tg.id = "storeTag"; tg.className = "store-tag"; h1.after(tg); } if (tg) tg.textContent = h.tagline || "";
  }
  // ---- the next event, front and centre (the way a restaurant sells its next seating) ----
  function feature(h, up) { const e = (up || [])[0]; const box = document.getElementById("nextUp"); if (!e || !box) return; const C = window.EncoreCommunity, esc = C.esc;
    const when = e.date ? new Date(e.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) : "", time = e.startTime ? new Date("2000-01-01T" + e.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
    const paid = e.price && e.price !== "chip", interest = e.stage === "interest", label = interest ? "Would you come?" : e.approvalRequired ? (paid ? "Request a seat" : "Request a spot") : paid ? "Book a seat" : "I'm in";
    box.className = box.className.replace(/\s*tpl-[a-z]+/g, "") + (/^[a-z]{3,14}$/.test(e.theme || "") ? " tpl-" + e.theme : ""); const cp = /^\/_blob\/[A-Za-z0-9_-]{6,80}$/.test(e.coverPhoto || "") || /^https:\/\/[^\s"'<>()]+$/.test(e.coverPhoto || "") ? e.coverPhoto : "";
    box.innerHTML = `${cp ? `<img class="nu-cover" src="${esc(cp)}" alt="">` : ""}<small class="nu-eyebrow">${interest ? "Gathering interest" : "Next up"}</small><h2 class="nu-title">${esc(e.dinnerTheme || e.title)}</h2>${e.dinnerTheme && e.title !== e.dinnerTheme ? `<div class="nu-sub">${esc(e.title)}</div>` : ""}
      <div class="nu-meta">${when ? `<span>${esc(when)}${time ? ` · ${esc(time)}` : ""}</span>` : `<span>Date to be voted on</span>`}${e.hood || e.city ? `<span>${esc(e.hood || e.city)}</span>` : ""}${e.headcount ? `<span>${esc(e.headcount)} ${paid ? "seats" : "spots"}</span>` : ""}</div>
      ${(e.courses || []).length ? `<ol class="nu-menu">${e.courses.slice(0, 7).map((c) => `<li>${esc(c)}</li>`).join("")}</ol>` : e.audienceWho ? `<p class="nu-for">For ${esc(e.audienceWho.replace(/^./, (c) => c.toLowerCase()))}</p>` : ""}
      <div class="nu-cta">${paid ? `<b class="nu-price">${esc(e.price)}<small> a seat</small></b>` : `<b class="nu-price">Free</b>`}<a class="btn nu-go" href="/g#rsvp-${encodeURIComponent(e.id)}">${(() => { try { const M = JSON.parse(localStorage.getItem("encore-rsvp-" + e.id) || "null"); return M ? (M.response === "requested" ? "Requested ✓" : M.response === "going" ? "You're in ✓" : label) : label; } catch { return label; } })()}</a></div>
      ${e.earlyUntil && Date.parse(e.earlyUntil) > Date.now() && !(() => { try { return JSON.parse(localStorage.getItem("encore.following") || "[]").includes(h.handle); } catch { return false; } })() ? `<p class="nu-early">Followers book first until ${esc(new Date(e.earlyUntil).toLocaleString([], { weekday: "short", hour: "numeric" }))}. <a href="#follow">Follow to get in early</a></p>` : ""}`;
    box.hidden = false; window.__nextUpEvent = e; if (document.body.classList.contains("is-owner")) setTimeout(() => { window.EncoreInlineEdit?.(e); ownerCta(e); }, 50);
    // the featured one doesn't need repeating; hide "Coming up" when it's the only one
    if ((up || []).length === 1) { const hs = [...document.querySelectorAll("h2.sec")].find((x) => /Coming up/.test(x.textContent)); if (hs) { hs.style.display = "none"; if (hs.nextElementSibling) hs.nextElementSibling.style.display = "none"; } } }
  // ---- the editor, for the owner only ----
  async function editor(h) { let mine; try { const r = await fetch("/api/host/profile"); if (!r.ok) return; mine = (await r.json()).host; } catch { return; } if (!mine || mine.handle !== h.handle) return;
    document.body.classList.add("is-owner"); setTimeout(() => { try { if (window.__nextUpEvent) { window.EncoreInlineEdit?.(window.__nextUpEvent); ownerCta(window.__nextUpEvent); } } catch {} }, 300); ["topFollow", "follow"].forEach((id) => { const el = document.getElementById(id); if (el) { el.hidden = true; el.style.display = "none"; } });
    setTimeout(() => { document.querySelectorAll(".card").forEach((c) => { if (/Want to host your own\?/.test(c.textContent)) c.style.display = "none"; }); document.querySelectorAll("[data-book]").forEach((b) => { b.textContent = "Edit this offering"; b.onclick = (ev) => { ev.preventDefault(); ev.stopImmediatePropagation(); location.href = "?bookings=1"; }; });
      fetch("/api/host/bookings").then((r) => (r.ok ? r.json() : {})).then((j) => { const B = (j.bookings || []).filter((b) => b.status === "booked"); if (!B.length) return; const sec = [...document.querySelectorAll("h2.sec")].find((x) => /Coming up/.test(x.textContent)); const grid = sec?.nextElementSibling; if (!grid) return; grid.querySelector(".empty")?.remove(); const esc = window.EncoreCommunity.esc;
        grid.insertAdjacentHTML("afterbegin", B.map((b) => `<a class="ev own-gig" href="?bookings=1"><span class="ev-ic" style="--c:#2F7A4F">💼</span><span class="ev-b"><b>${esc(b.company || b.name || "Team booking")}</b><small>${esc(b.when || "")}${b.people ? ` · ${esc(b.people)} people` : ""}</small><small>${b.depositPaid ? "Booked ✓" : "Accepted, deposit due"} · only you see this</small></span></a>`).join("")); }).catch(() => {});
      document.querySelectorAll(".empty").forEach((x) => { if (/^Nothing on the calendar yet\. Follow/.test(x.textContent)) x.innerHTML = 'Nothing on your calendar yet. <a href="/">Plan the next one from Home</a> and it shows up here.'; });
      document.querySelectorAll(".trust-line span").forEach((s) => { if (s.textContent === "Says they're insured") s.textContent = "You're insured. Upload the certificate so brands can see it"; }); }, 900);
    if ((mine.gallery || []).length < 3 && !document.getElementById("photoNudge") && !/Nothing on the calendar yet/.test(document.body.innerText) ) { const n = document.createElement("div"); n.id = "photoNudge"; n.className = "photo-nudge"; n.innerHTML = `<b>${(mine.gallery || []).length ? `Add ${3 - mine.gallery.length} more photo${3 - mine.gallery.length === 1 ? "" : "s"}` : "Add 3 photos from your get-togethers"}</b><span>People look at photos before anything else. The first one becomes your banner.</span><a class="btn" href="?bookings=1#photos">Add photos</a>`; (document.querySelector("main") || document.body).prepend(n); }
    const st = { theme: { ...DEF, ...(h.theme || {}) }, sections: { upcoming: true, kudos: true, photos: true, hire: true, tips: true, profile: true, past: true, ...(h.sections || {}) }, links: [...(h.links || [])], tagline: h.tagline || "" };
    Object.keys(FONTS).forEach(loadFont);
    const fab = document.createElement("button"); fab.className = "store-fab"; fab.type = "button"; fab.innerHTML = "✏️ Customize your page"; document.body.appendChild(fab);
    const pane = document.createElement("aside"); pane.className = "store-pane"; pane.hidden = true; document.body.appendChild(pane);
    const live = () => apply({ ...h, theme: st.theme, sections: st.sections, links: st.links.filter((l) => l.label && /^https:\/\//.test(l.url)), tagline: st.tagline });
    const sw = (k, v, inner, title) => `<button type="button" class="sw" data-k="${k}" data-v="${v}" aria-pressed="${st.theme[k] === v}" title="${title || v}">${inner}</button>`;
    function draw() { const t = st.theme;
      pane.innerHTML = `<div class="sp-head"><b>Your storefront</b><button type="button" class="sp-x" aria-label="Close">✕</button></div>
        <p class="sp-url">${location.host}/@${h.handle} <button type="button" id="sp-copy">Copy</button></p>
        <h4>Colour</h4><div class="sws">${ACCENTS.map((a) => sw("accent", a, `<i style="background:${a}"></i>`)).join("")}</div>
        <h4>Font</h4><div class="sws fonts">${Object.entries(FONTS).map(([k, f]) => sw("font", k, `<span style="font-family:'${f.head}'">Aa</span><small>${f.label}</small>`, f.label)).join("")}</div>
        <h4>Background</h4><div class="sws">${Object.entries(BGS).map(([k, b]) => sw("bg", k, `<i style="background:${b.bg};border:1px solid ${b.line}"></i><small>${b.label}</small>`, b.label)).join("")}</div>
        <h4>Cover</h4><div class="sws covers">${Object.entries(COVERS).map(([k, l]) => sw("cover", k, `<i style="background:${cover({ ...t, cover: k, coverUrl: "" })}"></i><small>${l}</small>`, l)).join("")}</div>
        <h4>Portrait</h4>${(() => { const AV = window.EncoreAvatars; if (!AV) return ""; const cur = AV.parse(t.avatarArt), styled = !!AV.ART[cur.style];
          const styles = ["", ...AV.keys].map((k) => { const v = k ? AV.make(k, cur) : ""; return `<button type="button" class="sw" data-k="avatarArt" data-v="${v}" aria-pressed="${(t.avatarArt || "") === v}" title="${k ? AV.ART[k].label : "Emoji"}">${k ? AV.svg(v, t.accent, 46) : `<span style="font-size:26px">${h.emoji || "🎉"}</span>`}</button>`; }).join("");
          const pick = (part, i, inner, label) => `<button type="button" class="sw${part === "skin" || part === "hair" ? " av-dot" : ""}" data-k="avatarArt" data-v="${AV.make(cur.style, { ...cur, [part]: i })}" aria-pressed="${cur[part] === i}" title="${label}" aria-label="${label}">${inner}</button>`;
          const dots = (part, list) => list.map((x, i) => pick(part, i, `<i style="background:${x.c};border:1px solid #D9CDBF"></i>`, x.label)).join("");
          const faces = (part) => AV.FEATURES[part].map((x, i) => pick(part, i, AV.svg(AV.make(cur.style, { ...cur, [part]: i }), t.accent, 46), x.label)).join("");
          return `<div class="sws portraits">${styles}</div>${styled ? `<h4>Skin tone</h4><div class="sws">${dots("skin", AV.SKINS)}</div><h4>Hair colour</h4><div class="sws">${dots("hair", AV.HAIRS)}</div><h4>Eyes</h4><div class="sws portraits">${faces("eyes")}</div><h4>Nose</h4><div class="sws portraits">${faces("nose")}</div><h4>Mouth</h4><div class="sws portraits">${faces("mouth")}</div><h4>Extras</h4><div class="sws portraits">${faces("extra")}</div>` : ""}`; })()}
        <div class="sp-up"><label class="sp-btn">📷 Your photo<input type="file" accept="image/*" data-up="avatarUrl" hidden></label><label class="sp-btn">🖼 Cover photo<input type="file" accept="image/*" data-up="coverUrl" hidden></label>${t.avatarUrl || t.coverUrl ? `<button type="button" class="sp-btn" id="sp-clear">Use emoji and pattern</button>` : ""}</div>
        <h4>Buttons</h4><div class="sws">${Object.entries(BUTTONS).map(([k, r]) => sw("buttons", k, `<span class="bt" style="border-radius:${r}">Follow</span>`, k)).join("")}</div>
        <h4>Tagline</h4><input id="sp-tag" maxlength="90" value="${(st.tagline || "").replace(/"/g, "&quot;")}" placeholder="e.g. Saturday runs, no one left behind">
        <h4>Links (up to 4)</h4>${[0, 1, 2, 3].map((i) => `<div class="sp-link"><input data-ll="${i}" placeholder="Label" value="${(st.links[i]?.label || "").replace(/"/g, "&quot;")}" maxlength="24"><input data-lu="${i}" placeholder="https://instagram.com/…" value="${(st.links[i]?.url || "").replace(/"/g, "&quot;")}"></div>`).join("")}
        <h4>Show on my page</h4><div class="sp-tog">${[["past", "Past gatherings"], ["kudos", "Kudos wall"], ["photos", "Photos"], ["tips", "Supporters and wishlist"], ["hire", "Work with me"], ["profile", "My event profile"]].map(([k, l]) => `<label><input type="checkbox" data-sec="${k}" ${st.sections[k] ? "checked" : ""}> ${l}</label>`).join("")}</div>
        <p class="sp-note">Colours and fonts come from a set that always reads well. Text on your buttons switches between white and dark to stay readable.</p>
        <div class="sp-actions"><button type="button" class="sp-save" id="sp-save">Save my page</button><span id="sp-msg"></span></div><div id="spSupport"></div>`;
      try { window.EncoreSupport?.mount(pane.querySelector("#spSupport"), mine); window.EncoreSupport?.mountName(pane.querySelector("#spSupport")); } catch {}
      pane.querySelector(".sp-x").onclick = () => { pane.hidden = true; };
      pane.querySelector("#sp-copy").onclick = () => { navigator.clipboard?.writeText(`${location.origin}/@${h.handle}`); pane.querySelector("#sp-copy").textContent = "Copied"; };
      pane.querySelectorAll(".sw").forEach((b) => (b.onclick = () => { st.theme[b.dataset.k] = b.dataset.v; if (b.dataset.k === "cover") st.theme.coverUrl = ""; if (b.dataset.k === "avatarArt") st.theme.avatarUrl = ""; live(); draw(); }));
      pane.querySelectorAll("[data-sec]").forEach((c) => (c.onchange = () => { st.sections[c.dataset.sec] = c.checked; live(); }));
      pane.querySelector("#sp-tag").oninput = (e) => { st.tagline = e.target.value; live(); };
      pane.querySelectorAll("[data-ll],[data-lu]").forEach((x) => (x.oninput = () => { const i = +(x.dataset.ll ?? x.dataset.lu); st.links[i] = { label: pane.querySelector(`[data-ll="${i}"]`).value.trim(), url: pane.querySelector(`[data-lu="${i}"]`).value.trim() }; live(); }));
      pane.querySelector("#sp-clear") && (pane.querySelector("#sp-clear").onclick = () => { st.theme.avatarUrl = ""; st.theme.coverUrl = ""; live(); draw(); });
      pane.querySelectorAll("[data-up]").forEach((inp) => (inp.onchange = async () => { const f = inp.files[0]; if (!f) return; if (f.size > 8e6) { msg("That photo is over 8 MB."); return; } msg("Uploading…"); try { const r = await fetch("/api/assets", { method: "POST", headers: { "Content-Type": f.type || "image/jpeg" }, body: f }); const j = await r.json(); if (!r.ok) throw new Error(j.message); st.theme[inp.dataset.up] = j.url; live(); draw(); msg("Looks good. Save when you're happy."); } catch (e) { msg(e.message || "Upload failed."); } }));
      pane.querySelector("#sp-save").onclick = async () => { const bad = st.links.find((l) => l?.url && !/^https:\/\//.test(l.url)); if (bad) { msg("Links need to start with https://"); return; } msg("Saving…");
        try { const r = await fetch("/api/host/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme: st.theme, sections: st.sections, links: st.links.filter((l) => l?.label && l?.url), tagline: st.tagline }) }); const j = await r.json(); if (!r.ok) throw new Error(j.message); Object.assign(h, j.host); window.EncoreCommunity?.oink?.(); msg("Saved. This is your page now. ✨"); } catch (e) { msg(e.message); } }; }
    const msg = (t) => { const m = pane.querySelector("#sp-msg"); if (m) m.textContent = t; };
    fab.onclick = () => { pane.hidden = !pane.hidden; if (!pane.hidden) draw(); };
    if (/[?&]customize=1/.test(location.search)) fab.click();
  }
  window.EncoreStore = { apply, editor, feature };
})();

// ---- the host edits their next event right on their page: click a detail, change it, it saves ----
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  async function save(id, patch) {
    const r = await fetch("/api/db/doc?path=events/" + encodeURIComponent(id)); const j = await r.json(); const cur = j.data || j; if (!cur || !r.ok) throw new Error("Couldn't load the event.");
    const next = { ...cur, ...patch, _base: cur.updatedAt || null, updatedAt: Date.now() }; delete next.id;
    const w = await fetch("/api/db/doc?path=events/" + encodeURIComponent(id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
    if (!w.ok) { const k = await w.json().catch(() => ({})); throw new Error(k.message || "Couldn't save."); }
  }
  function flash(el, ok, msg) { el.classList.add(ok ? "ie-saved" : "ie-bad"); el.title = msg || ""; setTimeout(() => el.classList.remove("ie-saved", "ie-bad"), 1400); }
  function editable(el, { id, get, field, kind = "text", toPatch, show }) {
    if (!el || el.dataset.ie) return; el.dataset.ie = 1; el.classList.add("ie"); el.tabIndex = 0; el.setAttribute("role", "button"); el.setAttribute("aria-label", "Edit " + field);
    const open = () => { if (el.querySelector("input,textarea")) return; const v = get(); const inp = document.createElement(kind === "long" ? "textarea" : "input"); if (kind !== "long") inp.type = kind === "number" ? "number" : kind === "date" ? "date" : kind === "time" ? "time" : "text"; inp.value = v ?? ""; inp.className = "ie-input"; if (kind === "number") inp.min = 1;
      const before = el.innerHTML; el.innerHTML = ""; el.appendChild(inp); inp.focus(); if (field === "place" && window.EncorePlaces) window.EncorePlaces.attach(inp, { onPick: () => setTimeout(() => inp.blur(), 30) }); if (inp.select && kind === "text") inp.select();
      let done = false; const finish = async (commit) => { if (done) return; done = true; const nv = inp.value.trim(); if (!commit || nv === String(v ?? "")) { el.innerHTML = before; return; }
        el.innerHTML = esc(show ? show(nv) : nv); try { await save(id, toPatch ? toPatch(nv) : { [field]: nv }); flash(el, true, "Saved"); } catch (e) { el.innerHTML = before; flash(el, false, e.message); alert(e.message); } };
      inp.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && kind !== "long") { ev.preventDefault(); finish(true); } if (ev.key === "Escape") finish(false); }); inp.addEventListener("blur", () => finish(true)); };
    el.addEventListener("click", (ev) => { if (ev.target.closest("input,textarea,a")) return; open(); }); el.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !el.querySelector("input,textarea")) { ev.preventDefault(); open(); } });
  }
  window.EncoreInlineEdit = function (e) {
    const box = document.getElementById("nextUp"); if (!box || !e?.id) return; const id = e.id;
    if (!box.querySelector(".ie-hint")) box.insertAdjacentHTML("afterbegin", `<p class="ie-hint">✏️ Click any detail to change it. It saves as you go.</p>`);
    editable(box.querySelector(".nu-title"), { id, field: "title", get: () => e.dinnerTheme || e.title, toPatch: (v) => { e.title = v; return e.dinnerTheme ? { dinnerTheme: v } : { pubTitle: v }; } });
    const spans = [...box.querySelectorAll(".nu-meta span")];
    const dateSpan = spans[0]; if (dateSpan) { const d0 = document.createElement("span"); const t0 = document.createElement("span"); d0.textContent = e.date ? new Date(e.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) : "Pick a date"; t0.textContent = e.startTime ? new Date("2000-01-01T" + e.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Add a time"; dateSpan.replaceWith(d0); d0.after(t0);
      editable(d0, { id, field: "date", kind: "date", get: () => e.date, toPatch: (v) => { e.date = v; return { date: v }; }, show: (v) => new Date(v + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) });
      editable(t0, { id, field: "time", kind: "time", get: () => e.startTime, toPatch: (v) => { e.startTime = v; return { startTime: v }; }, show: (v) => new Date("2000-01-01T" + v).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) }); }
    const place = spans.find((s) => !/spots|seats/.test(s.textContent) && s !== spans[0]); if (place) editable(place, { id, field: "place", get: () => e.hood || e.city, toPatch: (v) => (e.hood ? { hood: v } : { city: v }) });
    const seats = spans.find((s) => /spots|seats/.test(s.textContent)); if (seats) editable(seats, { id, field: "spots", kind: "number", get: () => e.headcount, toPatch: (v) => ({ headcount: +v }), show: (v) => `${v} ${/seats/.test(seats.textContent) ? "seats" : "spots"}` });
    let forEl = box.querySelector(".nu-for"); if (!forEl && !(e.courses || []).length) { forEl = document.createElement("p"); forEl.className = "nu-for ie-empty"; forEl.textContent = "Add who it's for"; box.querySelector(".nu-meta")?.after(forEl); }
    if (forEl) editable(forEl, { id, field: "who it's for", kind: "long", get: () => e.audienceWho || "", toPatch: (v) => ({ audienceWho: v }), show: (v) => "For " + v.replace(/^./, (c) => c.toLowerCase()) });
    const price = box.querySelector(".nu-price"); if (price) editable(price, { id, field: "price", get: () => (e.price && e.price !== "chip" ? e.price : "Free"), toPatch: (v) => (/^free$/i.test(v) || !v ? { price: "", free: true } : { price: /^[^0-9]/.test(v) ? v : "$" + v, free: false }) });
  };
})();
