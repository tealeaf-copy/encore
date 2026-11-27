// After a run reply on the light invite (public/invite.html loads this for a run): "Follow for the next run", one tap.
// The reply itself proves who the guest is (rid and code), so a guest who gave an email follows with no account and no
// second form (POST /api/public/follow, server/community.js). A guest who left only a phone or nothing adds an email
// here first. Signed in, it's the account's follow. The host hears about the new follower; the guest gets one email.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const CSS = `.rf{display:grid;gap:8px;margin:14px 0 0;padding:14px 0 0;border-top:1px solid var(--pl-line,#E2DCD1)}.rf p{margin:0}.rf b{font-weight:600}
.rf form{display:grid;gap:8px}.rf input{min-height:44px;padding:10px 12px;border:1px solid var(--pl-line-strong,#CFC6B8);border-radius:6px;font:16px/1.3 inherit;font-family:inherit;background:#fff;color:inherit}
.rf button{min-height:44px;padding:0 16px;border:1.5px solid var(--pl-accent,#29489A);border-radius:6px;background:var(--pl-accent,#29489A);color:#fff;font:600 16px inherit;font-family:inherit;cursor:pointer}.rf button:disabled{opacity:.6}
.rf button:focus-visible,.rf input:focus-visible{outline:3px solid var(--pl-focus,rgba(41,72,154,.3));outline-offset:2px}.rf .rf-err{color:var(--pl-danger,#A2361A);font-size:14px;min-height:0}.rf .rf-ok{font-weight:600}`;
  const signed = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  window.RunFollow = function (e, h, data, rid, code, id) {
    const tk = document.getElementById("tk"), handle = String(h?.handle || ""); if (!tk || !handle || tk.querySelector(".rf") || data?.response === "no") return;
    const first = (String(e.hostName || "").trim().split(/\s+/)[0] || String(h.name || "").split(" ")[0] || "your host").replace(/['’]s$/i, ""), eid = id || e.id || "";
    let mine = []; try { mine = JSON.parse(localStorage.getItem("encore.following") || "[]"); } catch {}
    if (Array.isArray(mine) && mine.includes(handle)) return;
    if (!document.getElementById("rfCss")) { const s = document.createElement("style"); s.id = "rfCss"; s.textContent = CSS; document.head.appendChild(s); }
    const hasEmail = signed() || /@/.test(String(data?.email || "")), box = document.createElement("div"); box.className = "rf";
    box.innerHTML = `<p><b>Next run?</b> Follow ${esc(first)} and hear when the next one is up.</p><form novalidate>${hasEmail ? "" : `<input id="rfEm" aria-label="Your email" type="email" autocomplete="email" inputmode="email" placeholder="Your email, for the next run" required>`}<button type="submit">Follow for the next run</button><p class="rf-err" role="alert"></p></form>`;
    (tk.querySelector(".btns") || tk.lastElementChild)?.after(box);
    const f = box.querySelector("form"), b = f.querySelector("button"), er = box.querySelector(".rf-err");
    f.onsubmit = async (ev) => { ev.preventDefault(); er.textContent = ""; const em = f.querySelector("#rfEm")?.value.trim() || "";
      if (!hasEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { er.textContent = "Add your email so you hear about the next run."; f.querySelector("#rfEm")?.focus(); return; }
      b.disabled = true;
      try { const r = await fetch("/api/public/follow", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle, eventId: eid, rid, code, name: data?.name || "", via: "run", ...(em ? { email: em } : {}) }) }), j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.message || "Didn't go through. Try again.");
        try { const L = JSON.parse(localStorage.getItem("encore.following") || "[]"); if (!L.includes(handle)) L.push(handle); localStorage.setItem("encore.following", JSON.stringify(L)); if (em) localStorage.setItem("encore.email", em); } catch {}
        box.innerHTML = `<p class="rf-ok">You're following ${esc(first)}.</p><p>You'll hear when the next run is up.${j.emailed ? " We sent a note to your email." : ""}</p>`; }
      catch (x) { er.textContent = /fetch|network|load failed/i.test(x.message) ? "Didn't go through. Check your connection and try again." : x.message; b.disabled = false; } };
  };
})();
