// "What are you into?": one screen of big sticker chips and a city, then hosts you might like and what's on this
// weekend. Shown once to new visitors on /feed, /events and /discover (signed out, dismissible), and to new hosts and
// guests after signup. Signed out it lives in this browser (pl.interests); signed in it's saved on the account.
// Only real hosts and real events are suggested; prepared or sample pages that fill in are labelled Example.
//
// For other pages: PLInterests.open(), PLInterests.get(), PLInterests.hostCard(host), PLInterests.eventCard(event),
// PLInterests.suggestions(el, { interests, city }).
(function () {
  if (window.PLInterests) return;
  const LS = "pl.interests", SEEN = "pl.interestsSeen";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const signedIn = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  const safeUrl = (u) => (/^\/[A-Za-z0-9@_\-./#?=&%]*$/.test(u || "") && !/^\/\//.test(u) ? u : "");
  const safeImg = (u) => (/^\/_blob\/[A-Za-z0-9]{6,40}$/.test(u || "") || /^\/presets\/[A-Za-z0-9_.-]{1,80}$/.test(u || "") || /^https:\/\/[^\s"'<>()]+$/.test(u || "") ? u : "");
  const local = () => { try { return JSON.parse(localStorage.getItem(LS) || "null"); } catch { return null; } };
  let LIST = null; const list = () => (LIST ||= fetch("/interests.json").then((r) => r.json()).then((j) => j.interests || []).catch(() => []));
  async function get() { if (signedIn()) { try { const r = await fetch("/api/me/interests", { credentials: "same-origin" }); if (r.ok) { const j = await r.json(); if (j.interests?.length || j.city) return j; } } catch {} } return local() || { interests: [], city: "" }; }
  async function save(v) { const o = { interests: v.interests || [], city: String(v.city || "").slice(0, 60), at: Date.now() }; try { localStorage.setItem(LS, JSON.stringify(o)); } catch {}
    if (signedIn()) { try { await fetch("/api/me/interests", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) }); } catch {} }
    window.dispatchEvent(new CustomEvent("pl:interests-saved", { detail: o })); return o; }

  const CSS = `.pin-bg{position:fixed;inset:0;z-index:8000;background:rgba(31,26,23,.45);display:grid;place-items:center;padding:12px;animation:pinFade .25s ease}
@keyframes pinFade{from{opacity:0}}
.pin{position:relative;width:min(100%,640px);max-height:calc(100dvh - 24px);overflow:auto;background:#F7F1E8;border:2.5px solid #1F1A17;border-radius:26px;box-shadow:6px 6px 0 #1F1A17;padding:22px 18px 18px;color:#1F1A17;font:16px/1.45 "Instrument Sans",system-ui,sans-serif;
  background-image:radial-gradient(rgba(102,90,81,.08) 1px,transparent 1.2px);background-size:7px 7px;animation:pinUp .4s cubic-bezier(.3,1.4,.5,1)}
@keyframes pinUp{from{transform:translateY(30px) rotate(-1deg);opacity:0}}
.pin h2{font:600 clamp(28px,6vw,38px)/1.02 Fredoka,"Instrument Sans",system-ui,sans-serif;margin:0 0 4px;letter-spacing:-.01em}.pin h2 em{font-style:normal;color:#C94A30}
.pin .pin-sub{color:#665A51;margin:0 0 14px;max-width:420px}
.pin .pin-x{position:absolute;z-index:3;top:12px;right:12px;width:44px;height:44px;border-radius:50%;border:2px solid #1F1A17;background:#fff;font-size:22px;line-height:1;cursor:pointer;box-shadow:2px 2px 0 #1F1A17}
.pin .pin-potto{position:absolute;z-index:1;top:-6px;right:70px;width:86px;transform:rotate(8deg);pointer-events:none}
.pin-chips{display:flex;flex-wrap:wrap;gap:10px 8px;margin:6px 0 16px}
.pin-chip{--r:0deg;display:inline-flex;align-items:center;gap:7px;min-height:48px;padding:6px 16px 6px 12px;border:2.5px solid #1F1A17;border-radius:999px;background:#fff;font:600 16px Fredoka,"Instrument Sans",system-ui,sans-serif;color:#1F1A17;cursor:pointer;transform:rotate(var(--r));box-shadow:2px 3px 0 #1F1A17;transition:transform .2s cubic-bezier(.3,1.7,.5,1),background .15s}
.pin-chip span{font-size:22px;line-height:1}.pin-chip:hover{transform:rotate(0) scale(1.04)}
.pin-chip[aria-pressed=true]{background:var(--c,#F2D48F);transform:rotate(calc(var(--r) * -1)) scale(1.06);box-shadow:3px 4px 0 #1F1A17}
.pin-chip[aria-pressed=true]::after{content:"✓";margin-left:2px;font:700 14px "Instrument Sans",system-ui}
.pin-chip:focus-visible,.pin button:focus-visible,.pin input:focus-visible{outline:3px solid #C94A30;outline-offset:2px}
.pin-city{display:grid;gap:6px;margin:0 0 16px}.pin-city label{font:600 16px Fredoka,system-ui}
.pin-city input{min-height:48px;border:2px solid #1F1A17;border-radius:16px;padding:10px 14px;font:inherit;font-size:16px;background:#fff;max-width:340px}
.pin-cities{display:flex;flex-wrap:wrap;gap:6px}.pin-cities button{border:1.5px solid #1F1A17;background:#FFFDF8;border-radius:999px;padding:4px 12px;font:600 14px "Instrument Sans",system-ui;cursor:pointer;min-height:36px}.pin-cities button[aria-pressed=true]{background:#1F1A17;color:#fff}
.pin-go{display:flex;gap:10px;align-items:center;flex-wrap:wrap;position:sticky;bottom:-18px;background:linear-gradient(transparent,#F7F1E8 30%);padding:14px 0 4px;margin-top:4px}
.pin-main{min-height:52px;padding:0 24px;border:2.5px solid #1F1A17;border-radius:999px;background:#C94A30;color:#fff;font:600 17px "Instrument Sans",system-ui;cursor:pointer;box-shadow:3px 3px 0 #1F1A17}.pin-main:disabled{background:#EFE6D8;color:#4A3F37;border-style:dashed;box-shadow:none;cursor:default}
.pin-skip{background:none;border:0;color:#665A51;text-decoration:underline;font:500 15px "Instrument Sans",system-ui;cursor:pointer;min-height:44px}
.pin-n{font:600 14px "Instrument Sans",system-ui;color:#665A51}
.pin h3{font:600 20px Fredoka,system-ui;margin:18px 0 8px}
.pin-hosts{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,180px),1fr));gap:12px}
.pin-host{position:relative;background:#fff;border:2px solid #1F1A17;border-radius:18px;padding:12px;display:grid;gap:6px;align-content:start;box-shadow:2px 2px 0 #1F1A17;transform:rotate(var(--r,0deg))}
.pin-host .av{width:54px;height:54px;border-radius:50%;border:2px solid #1F1A17;display:grid;place-items:center;font-size:26px;background:#FFF1D2;overflow:hidden}.pin-host .av img{width:100%;height:100%;object-fit:cover}
.pin-host b{font:600 16px/1.15 Fredoka,system-ui}.pin-host small{color:#665A51;font-size:13px;line-height:1.3}
.pin-host .why{display:inline-block;background:#F2D48F;border-radius:6px;padding:1px 7px;font:600 12px "Instrument Sans",system-ui;color:#1F1A17;justify-self:start}
.pin-host .ex{position:absolute;top:8px;right:8px;border:1.5px solid #1F1A17;border-radius:999px;padding:1px 8px;font:700 11px "Instrument Sans",system-ui;background:#fff}
.pin-fol{min-height:40px;border:2px solid #1F1A17;border-radius:999px;background:#1F1A17;color:#fff;font:600 14px "Instrument Sans",system-ui;cursor:pointer;margin-top:4px}.pin-fol[aria-pressed=true]{background:#fff;color:#1F1A17}
.pin-host form{display:grid;gap:6px}.pin-host form input{min-height:40px;border:1.5px solid #DCCFBE;border-radius:10px;padding:6px 10px;font:inherit;font-size:16px}
.pin-evs{display:grid;gap:10px}
.pin-ev{display:grid;grid-template-columns:76px 1fr auto;gap:12px;align-items:center;background:#fff;border:2px solid #1F1A17;border-radius:16px;padding:8px;text-decoration:none;color:#1F1A17;box-shadow:2px 2px 0 #1F1A17}
.pin-ev .th{position:relative;width:76px;height:76px;border-radius:10px;overflow:hidden;border:1.5px solid #1F1A17;background:#FDE6A6}.pin-ev .th img{width:100%;height:100%;object-fit:cover}.pin-ev .th .ea-cover .ea-txt{display:none}
.pin-ev b{font:600 16px/1.15 Fredoka,system-ui;display:block}.pin-ev small{color:#665A51;font-size:13.5px;display:block}.pin-ev .fr{color:#4F6B3A;font-weight:600}
.pin-empty{background:#FFFDF8;border:2px dashed #C9BBA7;border-radius:16px;padding:14px;color:#665A51}
@media (max-width:640px){.pin h2,.pin .pin-sub{padding-right:118px}.pin-hosts{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:10px;padding:4px 4px 10px;margin:0 -4px;scrollbar-width:none}.pin-hosts::-webkit-scrollbar{display:none}.pin-host{flex:0 0 200px;scroll-snap-align:start;padding:10px}.pin-host .av{width:44px;height:44px;font-size:22px}.pin-host small{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.pin-hosts .pin-empty{flex:1 0 100%}}
@media (max-width:520px){.pin-bg{padding:0;align-items:end}.pin{border-radius:24px 24px 0 0;max-height:94dvh;border-bottom:0;box-shadow:none;padding:20px 16px 16px}.pin .pin-potto{width:58px;right:62px;top:2px}.pin-chip{min-height:46px;font-size:15px;padding:5px 13px 5px 10px}}
/* round 11 UX pass: UI controls take the app's one line (1.5px) and no sticker shadows or tilts; the thick ink line
   stays on illustrations. Picked chips fill with their colour and gain Potto's brown line */
.pin{border:1.5px solid #5A3B2B;box-shadow:0 18px 48px -18px rgba(31,26,23,.45)}
.pin .pin-x{border:1.5px solid #D9CCBB;box-shadow:none;display:grid;place-items:center;padding:0 0 2px;color:#665A51}
.pin-chips{gap:8px}
.pin-chip{transform:none;box-shadow:none;border:1.5px solid #D9CCBB;font:600 15px "Instrument Sans",system-ui,sans-serif;min-height:44px;padding:4px 14px 4px 10px;gap:8px}
.pin-chip span{font-size:20px}.pin-chip:hover{transform:none;border-color:#5A3B2B}
.pin-chip[aria-pressed=true]{transform:none;box-shadow:inset 0 0 0 1px #5A3B2B;border-color:#5A3B2B}
.pin-main{border:0;box-shadow:none}
.pin-main:disabled{border:0}
.pin-city input{border:1.5px solid #D9CCBB;border-radius:12px}
.pin-cities button{border-color:#D9CCBB}
.pin-host,.pin-ev{border:1.5px solid #E4D9C8;box-shadow:0 1px 2px rgba(31,26,23,.06),0 10px 28px -16px rgba(31,26,23,.28);transform:none}
.pin-ev .th{border:0}.pin-host .av{border:1.5px solid #E4D9C8}
.pin-fol{border:0}
.pin-go{background:#F7F1E8;border-top:1px solid #E4D9C8;margin:8px -18px 0;padding:12px 18px calc(12px + env(safe-area-inset-bottom,0px))}
@media (max-width:520px){.pin{border-width:1.5px 0 0}.pin-go{margin:8px -16px 0;padding-left:16px;padding-right:16px;bottom:-16px}.pin-chip{min-height:44px;font-size:15px}}
@media (prefers-reduced-motion:reduce){.pin,.pin-bg,.pin-chip{animation:none!important;transition:none!important}}`;
  const css = () => { if (document.getElementById("pinCss")) return; const s = document.createElement("style"); s.id = "pinCss"; s.textContent = CSS; document.head.appendChild(s); };
  const TINT = { peach: "#FCCBA6", sky: "#A9D5F8", mint: "#CDEBD5", blush: "#FBD3CB", lilac: "#E2D6F7", sand: "#F1E6D3", butter: "#FDE6A6" };

  // ---------- cards (also for the feed) ----------
  function hostCard(h, i = 0) { const r = ((i * 37) % 5 - 2) * 0.6, av = safeImg(h.avatar);
    return `<div class="pin-host" style="--r:${r}deg" data-handle="${esc(h.handle)}">${h.example ? `<span class="ex">Example</span>` : ""}<span class="av">${av ? `<img src="${esc(av)}" alt="">` : esc(h.emoji || "🙂")}</span>
      <b>${esc(h.name)}</b>${h.why ? `<span class="why">${esc(h.why)}</span>` : ""}<small>${esc(h.tagline || [h.area, h.city].filter(Boolean).join(", "))}</small>
      ${h.next ? `<small>Next: <a href="${esc(safeUrl(h.next.url))}">${esc(h.next.title)}</a></small>` : ""}
      ${h.example ? `<a class="pin-fol" style="display:grid;place-items:center;text-decoration:none;background:#fff;color:#1F1A17" href="${esc(safeUrl(h.url))}">See page</a>` : `<button type="button" class="pin-fol" data-follow="${esc(h.handle)}" aria-pressed="${!!h.following}">${h.following ? "Following" : "Follow"}</button>`}</div>`; }
  function eventCard(e) { const img = safeImg(e.cover), EA = window.EventArt;
    return `<a class="pin-ev" href="${esc(safeUrl(e.url))}"><span class="th">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : EA ? EA.cover({ id: e.id, title: e.title, activity: e.format }) : ""}</span>
      <span><b>${esc(e.title)}</b><small>${esc([e.when, e.area || e.city].filter(Boolean).join(" · "))}</small><small>${esc([e.price, e.spots_left != null ? `${e.spots_left} spots left` : "", e.host?.name ? "by " + e.host.name : ""].filter(Boolean).join(" · "))}</small>${e.friends ? `<small class="fr">${esc(e.friends)}</small>` : ""}</span>
      ${window.PLSave ? window.PLSave.button({ kind: "event", ref: e.id, title: e.title, img }, { icon: true }) : ""}</a>`; }
  async function follow(btn) { const h = btn.dataset.follow, card = btn.closest(".pin-host"), form = card.querySelector("form");
    const email = form?.querySelector("input")?.value.trim() || "";
    const r = await fetch("/api/public/follow", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle: h, via: "interests", ...(email ? { email } : {}) }) }).catch(() => null);
    const j = await r?.json().catch(() => ({})) || {};
    if (r?.status === 401 && j.code === "email_required") { if (!form) { btn.insertAdjacentHTML("beforebegin", `<form><input type="email" autocomplete="email" placeholder="Your email" aria-label="Your email, to follow ${esc(h)}" required><small>You'll hear first about their next event.</small></form>`); card.querySelector("form").onsubmit = (e) => { e.preventDefault(); follow(btn); }; card.querySelector("form input").focus(); btn.textContent = "Follow with email"; } else form.querySelector("input").reportValidity?.(); return; }
    if (!r?.ok) { btn.textContent = j.message ? "Couldn't follow" : "Try again"; return; }
    form?.remove(); btn.setAttribute("aria-pressed", "true"); btn.textContent = "Following"; }
  document.addEventListener("click", (e) => { const b = e.target.closest?.(".pin-fol[data-follow]"); if (b && b.getAttribute("aria-pressed") !== "true") { e.preventDefault(); follow(b); } });

  /** Fill an element with "Hosts you might like" and "This weekend near you" for these interests and this city. */
  async function suggestions(el, { interests = [], city = "" } = {}) { css(); const q = `interests=${encodeURIComponent(interests.join(","))}&city=${encodeURIComponent(city)}`;
    el.innerHTML = `<h3 id="pinWk">This weekend near you</h3><div class="pin-evs"><div class="pin-empty">Looking at this weekend…</div></div><h3>Hosts you might like</h3><div class="pin-hosts"><div class="pin-empty">Finding hosts…</div></div>`;
    const saved = window.PLSave ? window.PLSave.items().filter((i) => i.kind === "event").map((i) => i.ref) : [];
    const [H, W] = await Promise.all([fetch("/api/public/suggest/hosts?" + q, { credentials: "same-origin" }).then((r) => r.json()).catch(() => ({ hosts: [] })), fetch(`/api/public/suggest/weekend?${q}&saved=${encodeURIComponent(saved.join(","))}`).then((r) => r.json()).catch(() => ({ events: [] }))]);
    const fol = new Set(H.following || []);
    el.querySelector(".pin-hosts").innerHTML = (H.hosts || []).length ? H.hosts.map((h, i) => hostCard({ ...h, following: fol.has(h.handle) }, i)).join("") : `<div class="pin-empty">No hosts for that yet${city ? " in " + esc(city) : ""}. Be the first: <a href="/ideas">steal an idea</a>.</div>`;
    let evs = W.events || [];
    if (evs.length && signedIn()) { try { const F = (await (await fetch("/api/me/friends-going?ids=" + evs.map((e) => e.id).join(","), { credentials: "same-origin" })).json()).events || {}; evs = evs.map((e) => ({ ...e, friends: F[e.id]?.line || "" })); } catch {} }
    el.querySelector(".pin-evs").innerHTML = evs.length ? evs.map(eventCard).join("") : `<div class="pin-empty">Nothing for that this weekend${city ? " in " + esc(city) : ""} yet. <a href="/events">See everything coming up</a> or <a href="/ideas">get ideas</a>.</div>`;
    return { hosts: H.hosts || [], events: evs }; }

  // ---------- the picker ----------
  async function open(opts = {}) { css(); if (document.querySelector(".pin-bg")) return; try { localStorage.setItem(SEEN, "1"); } catch {}
    const [L, cur] = await Promise.all([list(), get()]); const pick = new Set(cur.interests || []); let city = cur.city || "";
    let cities = []; try { cities = ((await (await fetch("/api/v1/formats?status=upcoming")).json()).cities || []).slice(0, 6).map((c) => c.city); } catch {}
    const bg = document.createElement("div"); bg.className = "pin-bg"; bg.innerHTML = `<div class="pin" role="dialog" aria-modal="true" aria-labelledby="pinH"></div>`; document.body.appendChild(bg);
    const box = bg.querySelector(".pin"), close = () => { bg.remove(); document.removeEventListener("keydown", onKey); opts.onClose?.(); };
    const onKey = (e) => { if (e.key === "Escape") close(); }; document.addEventListener("keydown", onKey);
    bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
    const potto = window.Potto ? `<span class="pin-potto" aria-hidden="true">${window.Potto.svg("cheer", 86, "")}</span>` : "";
    const step1 = () => { box.innerHTML = `${potto}<button class="pin-x" type="button" aria-label="Close">×</button>
      <h2 id="pinH">What are you <em>into?</em></h2><p class="pin-sub">${opts.after === "signup" ? "Pick a few. We'll find hosts to follow and things to do." : "Pick a few. We'll show you hosts and events near you. No account needed."}</p>
      <div class="pin-chips" role="group" aria-label="Interests">${L.map((i, k) => `<button type="button" class="pin-chip" data-i="${esc(i.id)}" aria-pressed="${pick.has(i.id)}" style="--r:${((k * 53) % 7 - 3) * 0.9}deg;--c:${TINT[i.tone] || "#F2D48F"}"><span aria-hidden="true">${esc(i.emoji)}</span>${esc(i.label)}</button>`).join("")}</div>
      <div class="pin-city"><label for="pinCity">Your city</label><input id="pinCity" autocomplete="address-level2" placeholder="e.g. Brooklyn" value="${esc(city)}" maxlength="60">
        ${cities.length ? `<div class="pin-cities" role="group" aria-label="Cities with events">${cities.map((c) => `<button type="button" data-c="${esc(c)}" aria-pressed="${c.toLowerCase() === city.toLowerCase()}">${esc(c)}</button>`).join("")}</div>` : ""}</div>
      <div class="pin-go"><button class="pin-main" type="button" id="pinGo">Show me</button><button class="pin-skip" type="button" id="pinSkip">Not now</button><span class="pin-n" id="pinN" aria-live="polite"></span></div>`;
      const n = () => { box.querySelector("#pinN").textContent = pick.size ? `${pick.size} picked` : ""; box.querySelector("#pinGo").disabled = !pick.size && !box.querySelector("#pinCity").value.trim(); }; n();
      box.querySelectorAll(".pin-chip").forEach((b) => (b.onclick = () => { const id = b.dataset.i; pick.has(id) ? pick.delete(id) : pick.add(id); b.setAttribute("aria-pressed", pick.has(id)); n(); }));
      box.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => { const i = box.querySelector("#pinCity"); i.value = b.dataset.c; box.querySelectorAll("[data-c]").forEach((x) => x.setAttribute("aria-pressed", x === b)); n(); }));
      box.querySelector("#pinCity").oninput = n;
      box.querySelector(".pin-x").onclick = close; box.querySelector("#pinSkip").onclick = close;
      box.querySelector("#pinGo").onclick = async () => { city = box.querySelector("#pinCity").value.trim(); const v = await save({ interests: [...pick], city }); step2(v); }; };
    const step2 = async (v) => { box.innerHTML = `${potto}<button class="pin-x" type="button" aria-label="Close">×</button><h2 id="pinH">Your <em>scene</em>${v.city ? `, ${esc(v.city)}` : ""}</h2>
      <p class="pin-sub">${esc(v.interests.map((id) => L.find((i) => i.id === id)?.label).filter(Boolean).join(", ") || "Everything")}. <button type="button" class="pin-skip" id="pinEdit" style="min-height:0">Change</button></p><div id="pinS"></div>
      <div class="pin-go"><a class="pin-main" href="/ideas" style="display:inline-grid;place-items:center;text-decoration:none">See ideas</a><button class="pin-skip" type="button" id="pinDone">Done</button></div>`;
      box.querySelector(".pin-x").onclick = close; box.querySelector("#pinDone").onclick = close; box.querySelector("#pinEdit").onclick = step1; box.scrollTop = 0;
      await suggestions(box.querySelector("#pinS"), v); };
    step1(); box.querySelector(".pin-chip")?.focus({ preventScroll: true }); }

  /** The first visit to /feed, /events or /discover, signed out: show the picker once. */
  // on /feed the swipe deck (public/swipedeck.js) comes first; its "Pick topics instead" opens this picker
  function maybeAuto() { try { if (signedIn() || localStorage.getItem(SEEN) || local()) return; if ((location.pathname === "/feed" || location.pathname === "/") && !localStorage.getItem("pl.deckDone")) return; } catch { return; } if (!/^\/(feed|events|discover)$/.test(location.pathname)) return; setTimeout(() => open({ after: "visit" }), 900); }
  /** Swipe deck picks train the interests: merge these interest ids (and a city when none is set) and save. */
  async function train(ids = [], city = "") { const cur = await get(), I = [...new Set([...(cur.interests || []), ...ids.filter((x) => /^[a-z0-9-]{1,30}$/.test(x))])].slice(0, 20);
    if (!ids.length && (cur.city || !city)) return cur; return save({ interests: I, city: cur.city || city || "" }); }
  window.PLInterests = { open, get, save, train, list, hostCard, eventCard, suggestions, css, maybeAuto };
})();
