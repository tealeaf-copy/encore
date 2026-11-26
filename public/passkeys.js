// Settings > Sign-in methods: how this account signs in (Apple, Google, email) and its passkeys. Add a passkey after
// the first sign-in, then "Continue with a passkey" on the sign-in screen uses it. Server: server/signin.js.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id), box = $("signin"); if (!box) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
  const u64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const day = (t) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const LABEL = { apple: "Apple", google: "Google", email: "Email code" };
  const can = !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
  const post = async (u, body) => { const r = await fetch(u, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || "That didn't work. Try again."); return j; };
  function draw(d) {
    const rows = [];
    for (const i of d.identities || []) rows.push(`<div class="row"><span>${esc(LABEL[i.provider] || i.provider)}<small>${esc(i.privateRelay ? "Hidden email from Apple" : i.email)}</small></span></div>`);
    if (d.password) rows.push(`<div class="row"><span>Password<small>Still works with your email</small></span></div>`);
    for (const p of d.passkeys || []) rows.push(`<div class="row"><span>${esc(p.name)}<small>Added ${esc(day(p.createdAt))}${p.lastUsedAt ? ", last used " + esc(day(p.lastUsedAt)) : ""}</small></span><button type="button" class="btn sm" data-pk="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">Remove</button></div>`);
    $("methods").innerHTML = rows.join("");
    if (!can) { $("pkAdd").hidden = true; $("pkWhere").textContent = "This browser can't make passkeys. Try the Pottery Lab app or another browser."; }
  }
  async function load() { if (!/(?:^|;\s*)encore_in=1/.test(document.cookie)) return; const r = await fetch("/api/passkeys", { credentials: "same-origin" }); if (!r.ok) return; box.hidden = false; draw(await r.json()); }
  $("methods").addEventListener("click", async (e) => { const b = e.target.closest("[data-pk]"); if (!b) return; if (!confirm("Remove this passkey? You can still sign in with your email.")) return;
    b.disabled = true; try { const r = await fetch("/api/passkeys/" + encodeURIComponent(b.dataset.pk), { method: "DELETE", credentials: "same-origin" }); if (!r.ok) throw new Error(); $("pkMsg").textContent = "Passkey removed."; load(); } catch (x) { b.disabled = false; $("pkMsg").textContent = "Couldn't remove it. Try again."; } });
  $("pkAdd").addEventListener("click", async () => {
    const btn = $("pkAdd"), msg = $("pkMsg"); msg.textContent = ""; btn.disabled = true;
    try {
      const o = await post("/api/passkeys/register/options");
      const cred = await navigator.credentials.create({ publicKey: { ...o, challenge: b64(o.challenge), user: { ...o.user, id: b64(o.user.id) }, excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: b64(c.id) })) } });
      const response = { id: cred.id, rawId: u64(cred.rawId), type: cred.type, clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {}, authenticatorAttachment: cred.authenticatorAttachment || undefined,
        response: { clientDataJSON: u64(cred.response.clientDataJSON), attestationObject: u64(cred.response.attestationObject), transports: cred.response.getTransports ? cred.response.getTransports() : [] } };
      const j = await post("/api/passkeys/register/verify", { response });
      draw({ ...(await (await fetch("/api/passkeys", { credentials: "same-origin" })).json()), passkeys: j.passkeys }); msg.textContent = "Passkey added. Next time, tap Continue with a passkey.";
    } catch (e) { if (e && e.name === "InvalidStateError") msg.textContent = "This device already has a passkey for your account."; else if (!e || (e.name !== "NotAllowedError" && e.name !== "AbortError")) msg.textContent = (e && e.message && e.message.length > 3 ? e.message : "That passkey didn't save. Try again."); }
    btn.disabled = false;
  });
  load().catch(() => {});
})();
