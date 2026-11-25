// What a brand is asking a host for, agreed up front. From host research: vague briefs cause scope creep,
// extra approval rounds and late payment, and usage rights are the clause that causes the most friction.
// The brand picks deliverables and a usage tier when they book; the booking page shows both sides one agreement:
// what's included, what isn't, how usage works, and when the host gets paid (never tied to turnout).
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const DELIV = [["photos", "📸 Photos from the day"], ["post", "📲 A post on the host's own account"], ["stories", "🎞 Stories during the event"], ["reel", "🎬 A short recap reel"], ["product", "🎁 Your product in the experience (one moment)"]];
  const USAGE = [["organic30", "Organic social, 30 days"], ["owned6m", "Owned channels, 6 months"], ["paid", "Paid ads and whitelisting"], ["perpetual", "Perpetual use"]];
  // the one balance line (server/market.js BALANCE_TERMS); a quote that sets another due date says so in its own words
  const BALANCE = "50% deposit to confirm. The rest is due 7 days after the event, once everything listed is delivered.";
  const DUE = { day: "on the day of the event", before7: "7 days before the event", now: "now" };
  const EXCLUDED = ["Setup or teardown beyond the event itself", "A second session or extra hours", "Exclusivity, unless agreed in writing (category, area and dates)"];
  // only when photos or posts were asked for: the content clauses (no content, no usage terms)
  const EXCLUDED_CONTENT = ["Raw footage or unedited photos", "Paid ads or boosted posts, unless chosen above", "Extra posts, shoots or revisions beyond what's listed"];
  const css = `.bt-f{border:1.5px dashed #D9CBB8;border-radius:16px;padding:12px 14px;margin:2px 0;display:grid;gap:8px}.bt-f legend{font-weight:700;font-size:14px;padding:0 4px}.bt-f .bt-o{display:flex;flex-wrap:wrap;gap:6px}.bt-f label{display:inline-flex;gap:6px;align-items:center;font-size:13.5px;background:#FBF6EE;border:1px solid #E9DFD0;border-radius:999px;padding:5px 10px;cursor:pointer}.bt-f select{padding:9px 10px;border:1px solid #DCCFBE;border-radius:12px;font:inherit;background:#fff}.bt-f small{color:#6B5F56}
.bt-card{background:#fff;border:1.5px solid #E4D9C8;border-radius:20px;padding:16px 18px;margin-top:14px}.bt-card h3{margin:0 0 2px;font:700 20px Fredoka,system-ui}.bt-card .bt-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;margin-top:10px}.bt-card ul{margin:4px 0 0;padding-left:18px;font-size:14px}.bt-card b.k{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#6B5F56}.bt-card .bt-pay{background:#EEF4EA;border-radius:14px;padding:10px 12px;font-size:14px;margin-top:12px}`;
  const style = () => { if (document.getElementById("bt-css")) return; const s = document.createElement("style"); s.id = "bt-css"; s.textContent = css; document.head.appendChild(s); };

  /** The fieldset brands fill in when they book. */
  function fieldset() { style(); return `<fieldset class="bt-f"><legend>Photos and posts (optional)</legend><div class="bt-o">${DELIV.map(([k, l]) => `<label><input type="checkbox" name="bt-d" value="${k}"> ${esc(l)}</label>`).join("")}</div>
    <label style="background:none;border:0;padding:0;display:grid;gap:4px;border-radius:0">How you'll use them<select name="bt-u">${USAGE.map(([k, l]) => `<option value="${k}">${esc(l)}${/^(paid|perpetual)$/.test(k) ? " (priced separately)" : ""}</option>`).join("")}</select></label>
    <small>The quote covers exactly this. Changes need both of you to agree.</small></fieldset>`; }
  /** Read it back from a form, and take its fields out of the plain form data. */
  function read(form, data) { const fd = new FormData(form), d = fd.getAll("bt-d").filter((k) => DELIV.some((x) => x[0] === k)), u = String(fd.get("bt-u") || "organic30"); if (data) { delete data["bt-d"]; delete data["bt-u"]; } return { deliverables: d, usage: USAGE.some((x) => x[0] === u) ? u : "organic30" }; }
  /** The agreement both sides see on the booking page. */
  // opts.noDeposit: the page already shows the deposit (the tracker does, once per state), so the card leaves it out
  function card(scope, hostName, quote, opts = {}) { style(); const s = scope || { deliverables: [], usage: "organic30" }, host = esc(String(hostName || "The host").replace(/\.$/, "")), D = DELIV.filter(([k]) => (s.deliverables || []).includes(k));
    const usage = USAGE.find(([k]) => k === s.usage)?.[1] || USAGE[0][1];
    return `<div class="bt-card" id="agreement"><h3>The agreement</h3>
      <div class="bt-g"><div><b class="k">Included</b><ul><li>The experience as listed, on the agreed date</li>${D.map(([, l]) => `<li>${esc(l.replace(/^\S+\s/, ""))}</li>`).join("")}${D.length ? "<li>One round of changes on anything delivered</li>" : ""}</ul></div>
      <div><b class="k">Not included</b><ul>${[...EXCLUDED, ...(D.length ? EXCLUDED_CONTENT : [])].filter((x) => !(s.usage === "paid" && /^Paid ads/.test(x))).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
      ${D.length ? `<div><b class="k">Usage</b><ul><li>${esc(usage)}</li><li>Starts once the balance is paid</li><li>Credit ${host} when you post</li></ul></div>` : ""}</div>
      <div class="bt-pay">${opts.noDeposit ? `<b>Payment</b> never depends on turnout or sales.${D.length ? " Delivered items count as approved if there's no reply within 48 hours." : ""}` : `<b>Payment:</b> ${DUE[quote?.balanceDue] ? `${quote?.deposit ? `${esc(quote.deposit)} deposit` : "A deposit"} to confirm. The rest is due ${DUE[quote.balanceDue]}, as the quote says.` : quote?.deposit ? `${esc(quote.deposit)} deposit to confirm. The rest is due 7 days after the event, once everything listed is delivered.` : BALANCE} It doesn't depend on turnout or sales.${D.length ? " Delivered items count as approved if there's no reply within 48 hours." : ""}`}</div></div>`; }
  window.BookTerms = { fieldset, read, card, DELIV, USAGE };
})();
