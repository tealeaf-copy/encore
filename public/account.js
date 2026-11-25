// Following a host takes a free account. This sheet creates one (the host's page is the invite) or signs
// you in, then the follow goes through. Used on host pages, Discover, the guest page and the shop.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  let css = false;
  function style() { if (css) return; css = true; const s = document.createElement("style"); s.textContent = `
.acct-bg{position:fixed;inset:0;background:rgba(20,16,14,.45);display:flex;align-items:flex-end;justify-content:center;z-index:9999}
@media (min-width:640px){.acct-bg{align-items:center}}
.acct{background:#FFFCF7;color:#1F1A17;width:min(440px,100%);border-radius:22px 22px 0 0;padding:22px 20px 24px;box-shadow:0 20px 60px rgba(0,0,0,.25);font:16px/1.45 "Instrument Sans",system-ui,sans-serif;max-height:92vh;overflow:auto}
@media (min-width:640px){.acct{border-radius:22px}}
.acct h2{font:600 28px/1.15 "Fraunces",Georgia,serif;margin:0 0 6px}.acct p{margin:0 0 14px;color:#6F6259}
.acct form{display:grid;gap:10px}.acct label{display:grid;gap:4px;font-size:13px;font-weight:600}
.acct input{border:1px solid #E7DFD3;border-radius:12px;padding:11px 12px;font-weight:400;font-size:16px;font-family:inherit;background:#fff}
.acct,.acct button,.acct input{font-family:"Instrument Sans",system-ui,sans-serif}.acct button[type=submit]{border:2px solid #1F1A17;border-radius:999px;padding:13px;background:var(--accent,#C4532F);color:#fff;font-weight:700;font-size:16px;cursor:pointer;box-shadow:0 2px 8px rgba(31,26,23,.08)}.acct .alt{border:1.5px solid #E4D9C8;border-radius:999px;padding:11px;background:#fff;color:#1F1A17;font-weight:600;font-size:16px;cursor:pointer;width:100%;margin-top:8px}
.acct .alt{background:none;border:0;color:#8E3A25;text-decoration:underline;cursor:pointer;font-weight:400;font-size:14px;font-family:inherit;padding:4px 0}
.acct .err{color:#B3261E;font-size:14px;min-height:1em;margin:0}.acct .x{float:right;background:none;border:0;font-size:20px;cursor:pointer;color:#6F6259}`; document.head.appendChild(s); }
  async function me() { try { const j = await (await fetch("/api/me")).json(); return j?.verified ? j : null; } catch { return null; } }
  /** Make sure there's an account, then resolve true; resolve false if the person closes the sheet. */
  function ensure({ handle = "", hostName = "", name = "", email = "" } = {}) {
    return new Promise((resolve) => { style(); let mode = "new"; const first = String(hostName || "").split(" ")[0].replace(/['’]s$/i, "") || "this host";
      const bg = document.createElement("div"); bg.className = "acct-bg"; document.body.appendChild(bg);
      const close = (v) => { bg.remove(); resolve(v); }; bg.onclick = (e) => { if (e.target === bg) close(false); };
      const draw = () => { bg.innerHTML = `<div class="acct" role="dialog" aria-modal="true" aria-label="Create your account"><button class="x" type="button" aria-label="Close">×</button>
        <h2>${mode === "new" ? `Follow ${esc(first)}` : "Welcome back"}</h2>
        <p>${mode === "new" ? `Free. Guests never need a code.` : `Sign in to follow ${esc(first)}.`}</p>
        <form>${mode === "new" ? `<label>Your name<input name="name" autocomplete="name" required value="${esc(name)}"></label>` : ""}
          <label>Email<input name="email" type="email" autocomplete="email" required value="${esc(email)}"></label>
          <label>Mobile <span style="font-weight:400;color:#6F6259">(optional, for a text)</span><input name="phone" type="tel" autocomplete="tel" placeholder="+1 555 123 4567" value="${esc((() => { try { return localStorage.getItem("encore.phone") || ""; } catch { return ""; } })())}"></label>
          <label>Password${mode === "new" ? " (10+ characters)" : ""}<input name="password" type="password" autocomplete="${mode === "new" ? "new-password" : "current-password"}" ${mode === "new" ? 'minlength="10"' : ""} required></label>
          <p class="err" role="alert"></p><button type="submit">${mode === "new" ? "Create account" : "Sign in"}</button></form>
        <button class="alt" type="button">${mode === "new" ? "Already have an account? Sign in" : "New here? Create an account"}</button></div>`;
        bg.querySelector(".x").onclick = () => close(false); bg.querySelector(".alt").onclick = () => { mode = mode === "new" ? "old" : "new"; draw(); };
        const f = bg.querySelector("form"), err = bg.querySelector(".err"); setTimeout(() => f.querySelector("input:not([value]), input[value='']")?.focus(), 30);
        f.onsubmit = async (ev) => { ev.preventDefault(); const b = Object.fromEntries(new FormData(f)); err.textContent = ""; const btn = f.querySelector("button[type=submit]"); btn.disabled = true;
          try { const r = mode === "new" ? await fetch("/api/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...b, mode: "friends", regularOf: handle }) })
              : await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: b.email, password: b.password }) });
            const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || (mode === "new" ? "That didn't work. Try again." : "That email and password don't match.")); try { window.dispatchEvent(new Event("encore:signedin")); } catch {}
            try { if (b.name) localStorage.setItem("encore.name", b.name); localStorage.setItem("encore.email", b.email); if (b.phone) localStorage.setItem("encore.phone", b.phone); localStorage.setItem("encore.phoneAsked", "1"); } catch {} close(true);
          } catch (e) { err.textContent = e.message; btn.disabled = false; } }; };
      draw(); }); }
  /** Follow a host, asking for an account first if needed. Resolves the follow response, or null if they backed out. */
  // a one-time ask for a mobile number, for people who were already signed in
  function askPhone(hostName, emailed, shown) { return new Promise((resolve) => { try { if (localStorage.getItem("encore.phoneAsked")) return resolve(""); localStorage.setItem("encore.phoneAsked", "1"); } catch { return resolve(""); } style(); let first = (/\b('s|’s|club|crew|kitchen|cafe|café|studio|co\.?)\b/i.test(String(hostName || "")) ? String(hostName) : String(hostName || "").split(" ")[0]) || "them"; if (shown) first = shown;
    const bg = document.createElement("div"); bg.className = "acct-bg"; document.body.appendChild(bg); const done = (v) => { bg.remove(); resolve(v); };
    bg.innerHTML = `<div class="acct" role="dialog" aria-modal="true" aria-label="Get texts"><button class="x" type="button" aria-label="Close">×</button><h2>You're following ${esc(first)}</h2><p>${emailed ? "We've emailed you. " : ""}Want a text too?</p><form><label>Mobile<input name="phone" type="tel" autocomplete="tel" placeholder="+1 555 123 4567" required></label><p class="err" role="alert"></p><button type="submit">Text me</button></form><button class="alt" type="button">No thanks</button></div>`;
    bg.querySelector(".x").onclick = () => done(""); bg.querySelector(".alt").onclick = () => done(""); bg.onclick = (e) => { if (e.target === bg) done(""); };
    const f = bg.querySelector("form"); setTimeout(() => f.phone.focus(), 30); f.onsubmit = (e) => { e.preventDefault(); const v = f.phone.value.trim(); if (!/^\+?[0-9 ()-]{7,20}$/.test(v)) { bg.querySelector(".err").textContent = "That number doesn't look right."; return; } try { localStorage.setItem("encore.phone", v); } catch {} done(v); }; }); }
  // signed out: just an email (remembered for next time)
  function askEmail(hostName, shown) { return new Promise((resolve) => { style(); let first = (/\b('s|’s|club|crew|kitchen|cafe|café|studio|co\.?)\b/i.test(String(hostName || "")) ? String(hostName) : String(hostName || "").split(" ")[0]) || "them"; if (shown) first = shown; let saved = ""; try { saved = localStorage.getItem("encore.email") || ""; } catch {}
    const bg = document.createElement("div"); bg.className = "acct-bg"; document.body.appendChild(bg); const done = (v) => { bg.remove(); resolve(v); };
    bg.innerHTML = `<div class="acct" role="dialog" aria-modal="true" aria-label="Follow"><button class="x" type="button" aria-label="Close">×</button><h2>Follow ${esc(first)}</h2><p>Just your email.</p><form><label>Email<input name="email" type="email" autocomplete="email" placeholder="you@example.com" required value="${esc(saved)}"></label><p class="err" role="alert"></p><button type="submit">Follow</button></form></div>`;
    bg.querySelector(".x").onclick = () => done(""); bg.onclick = (e) => { if (e.target === bg) done(""); };
    const f = bg.querySelector("form"); setTimeout(() => f.email.focus(), 30); f.onsubmit = (e) => { e.preventDefault(); const v = f.email.value.trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { bg.querySelector(".err").textContent = "That email doesn't look right."; return; } try { localStorage.setItem("encore.email", v); } catch {} done(v); }; }); }
  async function follow(body, { hostName = "", first: shown = "" } = {}) {
    try { if (!body.phone) { const ph = localStorage.getItem("encore.phone"); if (ph) body = { ...body, phone: ph }; } } catch {}
    const go = () => fetch("/api/public/follow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let r = await go(); let wasSignedIn = r.status !== 401; if (r.status === 401) { const em = body.email && /@/.test(body.email) ? "" : await askEmail(hostName, shown); if (!em && !(body.email && /@/.test(body.email))) return null; if (em) body = { ...body, email: em }; r = await go(); }
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || "Couldn't follow. Try again."); if (j.signedIn === false) wasSignedIn = false;
    try { const L = JSON.parse(localStorage.getItem("encore.following") || "[]"); if (!L.includes(body.handle)) L.push(body.handle); localStorage.setItem("encore.following", JSON.stringify(L)); } catch {}
    if (!body.phone && !wasSignedIn) { setTimeout(async () => { const ph = await askPhone(hostName, !!j.emailed, shown); if (ph) { try { await fetch("/api/public/follow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, phone: ph }) }); } catch {} } }, 0); }
    return j; }
  window.EncoreAccount = { ensure, follow, me };
})();
