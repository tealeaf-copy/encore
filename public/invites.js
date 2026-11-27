// Friend invites by text (server/friendinvites.js): the "Invite a friend (4 left)" card on the Me page, and the one
// helper that opens a text with a message on any page (PLInvites.textIt), also used by the share sheet.
//
//   PLInvites.mount(el)          draws the card into el (signed in only; stays hidden otherwise)
//   PLInvites.smsHref(body)      sms:?&body= on iPhone and iPad, sms:?body= on Android
//   PLInvites.textIt(body)       opens Messages on a phone; else the share sheet; else copies. Resolves "sms" | "share" | "copy" | "cancel" | "fail"
(function () {
  if (window.PLInvites) return;
  const UA = navigator.userAgent || "", android = /Android/i.test(UA), ios = /iPhone|iPad|iPod/i.test(UA) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const smsHref = (body) => (android ? "sms:?body=" : "sms:?&body=") + encodeURIComponent(body);
  async function copy(t) { try { await navigator.clipboard.writeText(t); return true; } catch { try { const a = document.createElement("textarea"); a.value = t; a.style.position = "fixed"; a.style.opacity = "0"; document.body.appendChild(a); a.select(); const ok = document.execCommand("copy"); a.remove(); return ok; } catch { return false; } } }
  async function textIt(body) {
    if (ios || android) { location.href = smsHref(body); return "sms"; }
    if (navigator.share) { try { await navigator.share({ text: body }); return "share"; } catch (e) { if (e && e.name === "AbortError") return "cancel"; } }
    return (await copy(body)) ? "copy" : "fail";
  }
  const CSS = `.fi{background:var(--pl-surface);border:1.5px solid var(--pl-ink);border-radius:6px;padding:16px;margin:0 0 16px;max-width:620px}
.fi-k{font:500 13px/1.3 var(--pl-font-mono);letter-spacing:.04em;text-transform:uppercase;color:var(--pl-accent-text);margin:0 0 4px}
.fi h2{font:600 22px/1.2 var(--pl-font-text);margin:0 0 4px;color:var(--pl-ink)}.fi p{margin:0 0 12px;color:var(--pl-soft);font-size:15px;line-height:1.45}
.fi-go{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 20px;border-radius:6px;border:1.5px solid var(--pl-ink);background:var(--pl-accent);color:var(--pl-on-accent);font:600 16px var(--pl-font-text);cursor:pointer}
.fi-go:disabled{opacity:.55;cursor:default}.fi-go svg{width:20px;height:20px}
.fi-msg{min-height:20px;margin:8px 0 0!important;font-size:14px!important;color:var(--pl-ink)!important}
.fi details{margin-top:12px;border-top:1px dashed var(--pl-line);padding-top:8px}.fi summary{min-height:44px;display:flex;align-items:center;cursor:pointer;font:600 15px var(--pl-font-text);color:var(--pl-ink)}
.fi ul{list-style:none;margin:0;padding:0}.fi li{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;border-top:1px dashed var(--pl-line);font-size:15px}
.fi li small{display:block;color:var(--pl-soft);font-size:13px}.fi-q{min-height:44px;border:0;background:none;padding:0 4px;color:var(--pl-accent-text);font:600 14px var(--pl-font-text);cursor:pointer}
.fi-chip{display:inline-flex;align-items:center;min-height:26px;padding:0 8px;border-radius:4px;background:var(--pl-sand);color:var(--pl-ink);font:500 12px var(--pl-font-mono);letter-spacing:.03em;text-transform:uppercase}`;
  const SMS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H10l-4 3.5v-3.5h0a1.5 1.5 0 0 1-1.5-1.5z"/></svg>';
  const LABEL = { open: "Waiting", used: "Joined", expired: "Ran out", revoked: "Taken back" };
  async function mount(el) {
    if (!el) return; let D;
    try { const r = await fetch("/api/me/invites", { credentials: "same-origin" }); if (!r.ok) return; D = await r.json(); } catch { return; }
    if (!document.getElementById("fiCss")) { const s = document.createElement("style"); s.id = "fiCss"; s.textContent = CSS; document.head.appendChild(s); }
    const draw = (msg = "") => {
      el.hidden = false; el.className = "fi"; const L = D.invites || [];
      el.innerHTML = `<p class="fi-k">Invite only</p><h2 id="fiH">Invite a friend (${D.left} left)</h2>
        <p>${D.left ? "Pottery Lab is invite only for now. Each invite is one link for one friend, good for 30 days. When they join, you're friends here." : "You've used your invites for now. You get one back when an invite runs out or you take one back."}</p>
        <button type="button" class="fi-go" id="fiGo"${D.left ? "" : " disabled"}>${SMS}Text an invite</button><p class="fi-msg" id="fiMsg" role="status">${esc(msg)}</p>
        ${L.length ? `<details${msg ? " open" : ""}><summary>Your invites (${L.length})</summary><ul>${L.map((x) => `<li><span>${x.status === "used" ? esc(x.usedBy || "A friend") + " joined" : "Invite " + esc(x.code.slice(-4))}<small>${esc(LABEL[x.status] || "")}${x.status === "open" ? (x.opened ? " · opened" : "") + " · until " + new Date(x.exp).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}</small></span>${x.status === "open" ? `<span><button type="button" class="fi-q" data-copy="${esc(x.link)}">Copy</button><button type="button" class="fi-q" data-take="${esc(x.code)}">Take back</button></span>` : `<span class="fi-chip">${esc(LABEL[x.status] || "")}</span>`}</li>`).join("")}</ul></details>` : ""}`;
      const go = el.querySelector("#fiGo");
      go.onclick = async () => { go.disabled = true;
        try { const r = await fetch("/api/me/invites", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" }); const j = await r.json().catch(() => ({}));
          if (!r.ok) { go.disabled = false; return (el.querySelector("#fiMsg").textContent = j.message || "That didn't work. Try again."); }
          D = { ...D, ...j, invites: [{ code: j.code, link: j.link, status: "open", at: j.at, exp: j.exp, opened: false }, ...(D.invites || [])] };
          const how = await textIt(j.message);
          draw(how === "sms" ? "Messages is open with your invite. Pick a friend and send." : how === "share" ? "Sent. Your invite is on its way." : how === "copy" ? "Copied. Paste it into a text to your friend." : how === "cancel" ? "No problem. Your invite is saved below." : "Your invite is ready below. Copy it and send it to a friend.");
        } catch { go.disabled = false; el.querySelector("#fiMsg").textContent = "That didn't work. Check your connection and try again."; } };
      el.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = async () => { const ok = await copy(b.dataset.copy); el.querySelector("#fiMsg").textContent = ok ? "Link copied." : b.dataset.copy; }));
      el.querySelectorAll("[data-take]").forEach((b) => (b.onclick = async () => { const r = await fetch("/api/me/invites/" + encodeURIComponent(b.dataset.take), { method: "DELETE", credentials: "same-origin" }); const j = await r.json().catch(() => ({}));
        if (r.ok) { D = { ...D, ...j, invites: D.invites.map((x) => (x.code === b.dataset.take ? { ...x, status: "revoked" } : x)) }; draw("Taken back. That link won't work any more."); } else el.querySelector("#fiMsg").textContent = j.message || "That didn't work."; }));
    };
    draw();
  }
  window.PLInvites = { mount, smsHref, textIt, copy };
})();
