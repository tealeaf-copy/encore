// Joining a host's regulars takes a free account. This sheet creates one (the host's page is the invite) or signs
// you in, then the follow goes through. Used on host pages, Discover, the guest page and the shop.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  let css = false;
  function style() { if (css) return; css = true; const s = document.createElement("style"); s.textContent = `
.acct-bg{position:fixed;inset:0;background:rgba(20,16,14,.45);display:flex;align-items:flex-end;justify-content:center;z-index:9999}
@media (min-width:640px){.acct-bg{align-items:center}}
.acct{background:#FFFCF7;color:#1F1A17;width:min(440px,100%);border-radius:22px 22px 0 0;padding:22px 20px 24px;box-shadow:0 20px 60px rgba(0,0,0,.25);font:15px/1.45 "DM Sans",system-ui,sans-serif;max-height:92vh;overflow:auto}
@media (min-width:640px){.acct{border-radius:22px}}
.acct h2{font:600 24px/1.15 "Fraunces",Georgia,serif;margin:0 0 6px}.acct p{margin:0 0 14px;color:#6F6259}
.acct form{display:grid;gap:10px}.acct label{display:grid;gap:4px;font-size:13px;font-weight:600}
.acct input{border:1px solid #E7DFD3;border-radius:12px;padding:11px 12px;font:15px inherit;background:#fff}
.acct button[type=submit]{border:0;border-radius:999px;padding:13px;background:var(--accent,#C4532F);color:#fff;font:600 16px inherit;cursor:pointer}
.acct .alt{background:none;border:0;color:#8E3A25;text-decoration:underline;cursor:pointer;font:14px inherit;padding:4px 0}
.acct .err{color:#B3261E;font-size:14px;min-height:1em;margin:0}.acct .x{float:right;background:none;border:0;font-size:20px;cursor:pointer;color:#6F6259}`; document.head.appendChild(s); }
  async function me() { try { const j = await (await fetch("/api/me")).json(); return j?.verified ? j : null; } catch { return null; } }
  /** Make sure there's an account, then resolve true; resolve false if the person closes the sheet. */
  function ensure({ handle = "", hostName = "", name = "", email = "" } = {}) {
    return new Promise((resolve) => { style(); let mode = "new"; const first = String(hostName || "").split(" ")[0].replace(/['’]s$/i, "") || "this host";
      const bg = document.createElement("div"); bg.className = "acct-bg"; document.body.appendChild(bg);
      const close = (v) => { bg.remove(); resolve(v); }; bg.onclick = (e) => { if (e.target === bg) close(false); };
      const draw = () => { bg.innerHTML = `<div class="acct" role="dialog" aria-modal="true" aria-label="Create your account"><button class="x" type="button" aria-label="Close">×</button>
        <h2>${mode === "new" ? `Join ${esc(first)}'s regulars` : "Welcome back"}</h2>
        <p>${mode === "new" ? `A free account means ${esc(first)} knows who you are, you hear about the next one first, and you can leave with one tap. No invite code needed: ${esc(first)}'s page is your invite.` : `Sign in and you'll join ${esc(first)}'s regulars.`}</p>
        <form>${mode === "new" ? `<label>Your name<input name="name" autocomplete="name" required value="${esc(name)}"></label>` : ""}
          <label>Email<input name="email" type="email" autocomplete="email" required value="${esc(email)}"></label>
          <label>Mobile <span style="font-weight:400;color:#6F6259">(optional, for a text when ${esc(first)} posts)</span><input name="phone" type="tel" autocomplete="tel" placeholder="+1 555 123 4567" value="${esc((() => { try { return localStorage.getItem("encore.phone") || ""; } catch { return ""; } })())}"></label>
          <label>Password${mode === "new" ? " (10+ characters)" : ""}<input name="password" type="password" autocomplete="${mode === "new" ? "new-password" : "current-password"}" ${mode === "new" ? 'minlength="10"' : ""} required></label>
          <p class="err" role="alert"></p><button type="submit">${mode === "new" ? "Create my account and join" : "Sign in and join"}</button></form>
        <button class="alt" type="button">${mode === "new" ? "Already have an account? Sign in" : "New here? Create an account"}</button></div>`;
        bg.querySelector(".x").onclick = () => close(false); bg.querySelector(".alt").onclick = () => { mode = mode === "new" ? "old" : "new"; draw(); };
        const f = bg.querySelector("form"), err = bg.querySelector(".err"); setTimeout(() => f.querySelector("input:not([value]), input[value='']")?.focus(), 30);
        f.onsubmit = async (ev) => { ev.preventDefault(); const b = Object.fromEntries(new FormData(f)); err.textContent = ""; const btn = f.querySelector("button[type=submit]"); btn.disabled = true;
          try { const r = mode === "new" ? await fetch("/api/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...b, mode: "friends", regularOf: handle }) })
              : await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: b.email, password: b.password }) });
            const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || (mode === "new" ? "Couldn't create the account." : "That email and password don't match."));
            try { if (b.name) localStorage.setItem("encore.name", b.name); localStorage.setItem("encore.email", b.email); if (b.phone) localStorage.setItem("encore.phone", b.phone); localStorage.setItem("encore.phoneAsked", "1"); } catch {} close(true);
          } catch (e) { err.textContent = e.message; btn.disabled = false; } }; };
      draw(); }); }
  /** Follow a host, asking for an account first if needed. Resolves the follow response, or null if they backed out. */
  // a one-time ask for a mobile number, for people who were already signed in
  function askPhone(hostName) { return new Promise((resolve) => { try { if (localStorage.getItem("encore.phoneAsked")) return resolve(""); localStorage.setItem("encore.phoneAsked", "1"); } catch { return resolve(""); } style(); const first = String(hostName || "").split(" ")[0] || "them";
    const bg = document.createElement("div"); bg.className = "acct-bg"; document.body.appendChild(bg); const done = (v) => { bg.remove(); resolve(v); };
    bg.innerHTML = `<div class="acct" role="dialog" aria-modal="true" aria-label="Get texts"><button class="x" type="button" aria-label="Close">×</button><h2>You're following ${esc(first)} 🎉</h2><p>We've emailed you a confirmation. Want a text too, and a heads-up when ${esc(first)} posts something new?</p><form><label>Mobile<input name="phone" type="tel" autocomplete="tel" placeholder="+1 555 123 4567" required></label><p class="err" role="alert"></p><button type="submit">Text me</button></form><button class="alt" type="button">No thanks, email is fine</button></div>`;
    bg.querySelector(".x").onclick = () => done(""); bg.querySelector(".alt").onclick = () => done(""); bg.onclick = (e) => { if (e.target === bg) done(""); };
    const f = bg.querySelector("form"); setTimeout(() => f.phone.focus(), 30); f.onsubmit = (e) => { e.preventDefault(); const v = f.phone.value.trim(); if (!/^\+?[0-9 ()-]{7,20}$/.test(v)) { bg.querySelector(".err").textContent = "That doesn't look like a phone number."; return; } try { localStorage.setItem("encore.phone", v); } catch {} done(v); }; }); }
  async function follow(body, { hostName = "" } = {}) {
    try { if (!body.phone) { const ph = localStorage.getItem("encore.phone"); if (ph) body = { ...body, phone: ph }; } } catch {}
    const go = () => fetch("/api/public/follow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let r = await go(); if (r.status === 401) { const ok = await ensure({ handle: body.handle, hostName, name: body.name, email: body.email }); if (!ok) return null; r = await go(); }
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || "Couldn't follow. Try again.");
    try { const L = JSON.parse(localStorage.getItem("encore.following") || "[]"); if (!L.includes(body.handle)) L.push(body.handle); localStorage.setItem("encore.following", JSON.stringify(L)); } catch {}
    if (!body.phone) { const ph = await askPhone(hostName); if (ph) { try { await fetch("/api/public/follow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, phone: ph }) }); j.texted = true; } catch {} } }
    return j; }
  window.EncoreAccount = { ensure, follow, me };
})();
