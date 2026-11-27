// Get paid (server/paymethods.js): Venmo, PayPal, Cash App, an other pay link and a note, kept on a person's own account.
// One small script for every place it shows:
//   PayMethods.settings(el)        the "Get paid" section in Settings
//   PayMethods.sheet({ onSave })   the same fields in a small sheet, from the canvas, a drop or Home
//   PayMethods.editor(el, W, fn)   "Guests pay you through" in the canvas price setting, with a checkbox per method (W.payHide)
//   PayMethods.dropRow(el)         the same line in the drop setup
//   guests: on /e/, /i/ and /g it adds the host's buttons to a "going" reply's ticket, with the amount and a note in each.
// The cleaning and deep links match server/paymethods.js (test/paymethods.test.js runs both).
(function (root) {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // ---------- the pure bits ----------
  const KEYS = ["venmo", "paypal", "cashapp", "link", "note"], LABEL = { venmo: "Venmo", paypal: "PayPal", cashapp: "Cash App", link: "Pay link", note: "Note" };
  const HOSTS = ["buy.stripe.com", "donate.stripe.com", "checkout.stripe.com", "paypal.me", "www.paypal.me", "paypal.com", "www.paypal.com", "venmo.com", "account.venmo.com", "cash.app", "square.link", "checkout.square.site"];
  const squash = (v) => String(v ?? "").replace(/[\u0000-\u001f\u007f\s]+/g, ""), URLISH = /^(https?:\/\/|www\.)|\.(com|me|app|link|site)\b/i;
  const ID = { venmo: /^[A-Za-z0-9_-]{2,30}$/, paypal: /^[A-Za-z0-9_-]{2,20}$/, cashapp: /^(?=.*[A-Za-z])[A-Za-z0-9_-]{1,20}$/ };
  const FROM_URL = { venmo: /^(?:https?:\/\/)?(?:www\.|account\.)?venmo\.com\/(?:u\/)?@?([^/?#]+)/i, paypal: /^(?:https?:\/\/)?(?:www\.)?(?:paypal\.me|paypal\.com\/paypalme)\/@?([^/?#]+)/i, cashapp: /^(?:https?:\/\/)?(?:www\.)?cash\.app\/\$?([^/?#]+)/i };
  const LEAD = { venmo: /^@/, paypal: /^@/, cashapp: /^\$/ };
  /** "" when empty, null when it can't be a handle, else the bare handle. */
  function clean(k, v) { let s = squash(v); if (!s) return ""; const m = s.match(FROM_URL[k]); if (m) s = m[1]; else if (URLISH.test(s)) return null; s = s.replace(LEAD[k], ""); return ID[k].test(s) ? s : null; }
  function cleanLink(v) { let s = String(v ?? "").trim(); if (!s) return ""; if (/\s/.test(s) || s.length > 300) return null; if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
    let u; try { u = new URL(s); } catch { return null; } if (u.protocol !== "https:" || u.username || u.password || u.port || !HOSTS.includes(u.hostname.toLowerCase())) return null; return u.href; }
  const amtOf = (c) => (c > 0 ? (c / 100).toFixed(c % 100 ? 2 : 0) : "");
  function profileUrl(k, h) { if (!h) return ""; const e = encodeURIComponent(h); return k === "venmo" ? `https://venmo.com/u/${e}` : k === "paypal" ? `https://paypal.me/${e}` : k === "cashapp" ? `https://cash.app/$${e}` : k === "link" ? h : ""; }
  function deep(k, h, cents = 0, note = "") { if (!h) return ""; const e = encodeURIComponent(h), a = amtOf(Math.round(+cents || 0));
    if (k === "venmo") return `https://venmo.com/${e}?txn=pay${a ? "&amount=" + a : ""}${note ? "&note=" + encodeURIComponent(note) : ""}`;
    if (k === "paypal") return `https://paypal.me/${e}${a ? "/" + a : ""}`; if (k === "cashapp") return `https://cash.app/$${e}${a ? "/" + a : ""}`; return k === "link" ? h : ""; }
  const shown = (k, h) => (k === "venmo" ? "@" + h : k === "cashapp" ? "$" + h : k === "paypal" ? "paypal.me/" + h : k === "link" ? (() => { try { return new URL(h).hostname.replace(/^www\./, ""); } catch { return "link"; } })() : h);
  const centsIn = (t) => { const m = String(t || "").replace(/,/g, "").match(/\$(\d+(?:\.\d{1,2})?)/); return m ? Math.round(+m[1] * 100) : 0; };
  const pure = { KEYS, LABEL, HOSTS, clean, cleanLink, deep, profileUrl, shown, centsIn };
  if (typeof module === "object" && module.exports) { module.exports = pure; return; }
  if (root.PayMethods) return;

  // ---------- the page bits ----------
  const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const CSS = `.pm-form{display:grid;gap:14px}.pm-f{display:grid;gap:4px}.pm-f>label{font:600 14px/1.3 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);color:var(--pl-ink)}
.pm-in{display:flex;align-items:stretch;min-height:48px;border:1.5px solid var(--pl-line-strong);border-radius:6px;background:#fff;overflow:hidden}.pm-in:focus-within{outline:3px solid var(--pl-focus,var(--pl-accent));outline-offset:1px}
.pm-pre{display:flex;align-items:center;padding:0 0 0 12px;color:var(--pl-soft);font:400 16px/1 var(--pl-font-mono,"IBM Plex Mono",ui-monospace,monospace);white-space:nowrap}
.pm-in input{flex:1;min-width:0;width:auto!important;height:auto!important;min-height:0!important;margin:0!important;border:0!important;border-radius:0!important;box-shadow:none!important;outline:0!important;background:transparent!important;padding:0 12px 0 4px;font:400 16px/1.2 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);color:var(--pl-ink)}.pm-in.np input{padding-left:12px}
.pm-in[data-bad] {border-color:var(--pl-danger)}.pm-sub{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:32px;font-size:13px;color:var(--pl-soft)}.pm-sub [data-err]{color:var(--pl-danger)}
.pm-test{flex:none;color:var(--pl-accent-text,var(--pl-accent));font-weight:600;text-decoration:underline;font-size:14px;min-height:32px;display:inline-flex;align-items:center}.pm-test[hidden]{display:none}
.pm-priv{margin:0;padding:10px 12px;border-radius:6px;background:var(--pl-raised);color:var(--pl-ink);font-size:14px;line-height:1.45}.pm-acts{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.pm-b{min-height:44px;padding:0 18px;border-radius:6px;border:1.5px solid var(--pl-line-strong);background:transparent;color:var(--pl-ink);font:600 15px/1 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;text-decoration:none}
.pm-b.pri{background:var(--pl-accent);border-color:var(--pl-accent);color:var(--pl-on-accent,#fff)}.pm-b:disabled{opacity:.6}.pm-b:focus-visible,.pm-test:focus-visible,.pm-ln:focus-visible{outline:3px solid var(--pl-focus,var(--pl-accent));outline-offset:2px}
.pm-msg{margin:0;font-size:14px;color:var(--pl-soft);min-height:20px}.pm-more{border-top:1.5px solid var(--pl-line);padding-top:12px}.pm-more>summary{cursor:pointer;font-weight:600;font-size:15px;min-height:32px;display:flex;align-items:center;color:var(--pl-ink)}
.pm-more[open]>summary{margin-bottom:10px}.pm-more .pm-form{gap:14px}
.pm-sh-bg{position:fixed;inset:0;z-index:9700;background:rgba(29,27,24,.4);display:flex;align-items:flex-end;justify-content:center}
.pm-sh{width:min(520px,100%);max-height:92vh;overflow:auto;background:var(--pl-surface);color:var(--pl-ink);border-radius:6px 6px 0 0;padding:16px 16px calc(16px + env(safe-area-inset-bottom));box-sizing:border-box;font:400 16px/1.5 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif)}
@media (min-width:700px){.pm-sh-bg{align-items:center}.pm-sh{border-radius:6px;padding:20px}}
.pm-sh header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}.pm-sh h2{margin:0;font-weight:600!important;font:600 20px/1.2 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif)}.pm-sh header p{margin:4px 0 0;color:var(--pl-soft);font-size:14px}
.pm-x{flex:none;width:44px;height:44px;border-radius:6px;border:1.5px solid var(--pl-line-strong);background:var(--pl-surface);color:var(--pl-ink);cursor:pointer;font-size:22px;line-height:1}
.pm-ed{display:grid;gap:8px;margin:14px 0 0;padding:12px;border:1.5px solid var(--pl-line);border-radius:6px;background:var(--pl-surface)}.pm-ed-h{margin:0;font:600 14px/1.3 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);color:var(--pl-ink)}
.pm-ed-l{display:flex;flex-wrap:wrap;gap:8px}.pm-ck{display:inline-flex;align-items:center;gap:8px;min-height:40px;padding:0 12px;border:1.5px solid var(--pl-line-strong);border-radius:6px;font-size:15px;cursor:pointer;background:#fff;max-width:100%}
.pm-ck input{width:18px;height:18px;margin:0;accent-color:var(--pl-accent)}.pm-ck small{color:var(--pl-soft);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pm-ed-f{margin:0;font-size:13px;color:var(--pl-soft)}.pm-ln{background:none;border:0;padding:0;min-height:32px;color:var(--pl-accent-text,var(--pl-accent));font:600 14px/1 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);text-decoration:underline;cursor:pointer}
.pm-pay{display:grid;gap:8px;margin:4px 0 0;text-align:left}.pm-pay-h{margin:0;font-weight:600;font-size:15px;color:var(--pl-ink)}.pm-pay-b{display:grid;gap:8px}
.pm-btn{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px!important;margin:0!important;padding:0 16px;border-radius:6px;border:1.5px solid var(--pl-accent);background:var(--pl-accent);color:var(--pl-on-accent,#fff)!important;text-decoration:none;font:600 16px/1.2 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);box-sizing:border-box;min-width:0}
.pm-btn.alt{background:var(--pl-surface);color:var(--pl-ink)!important;border-color:var(--pl-line-strong)}.pm-btn span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pm-btn small{font-weight:400;font-size:14px;opacity:.9;margin-left:6px}
.pm-btn b{flex:none;font-family:var(--pl-font-mono,"IBM Plex Mono",ui-monospace,monospace);font-weight:500}.pm-btn:focus-visible{outline:3px solid var(--pl-focus,var(--pl-ink));outline-offset:2px}
.pm-pay-t{margin:0;padding:8px 12px;border-radius:6px;background:var(--pl-raised);font-size:15px;color:var(--pl-ink);overflow-wrap:anywhere}.pm-pay-f{margin:0;font-size:13px;color:var(--pl-soft)}
@media (min-width:520px){.pm-pay-b{grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}}`;
  const css = () => { if (document.getElementById("pmCss")) return; const s = document.createElement("style"); s.id = "pmCss"; s.textContent = CSS; document.head.appendChild(s); };
  const signedIn = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  let P0 = null; const load = (fresh) => (!signedIn() ? Promise.resolve(null) : P0 && !fresh ? P0 : (P0 = fetch("/api/me/pay", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
  const listeners = new Set(); const changed = (j) => { P0 = Promise.resolve(j); listeners.forEach((fn) => { try { fn(j); } catch {} }); };
  const hasAny = (p) => !!(p && KEYS.some((k) => p[k]));
  const FIELDS = [
    { k: "venmo", label: "Venmo", pre: "@", ph: "maya-lee", help: "Your Venmo username. Pasting your Venmo link works too." },
    { k: "paypal", label: "PayPal", pre: "paypal.me/", ph: "mayalee", help: "Your PayPal.Me name. Pasting the link works too." },
    { k: "cashapp", label: "Cash App", pre: "$", ph: "mayalee", help: "Your $cashtag. Pasting your cash.app link works too." },
  ];
  const PRIV = "Shown only to guests who are in, on events and drops where you ask for money: a price, chip in or an order. Never on your public page. Payments go straight to you through these apps. Pottery Lab doesn't hold the money.";
  const field = (f, v, id) => `<div class="pm-f" data-f="${f.k}"><label for="${id}${f.k}">${esc(f.label)}</label><div class="pm-in${f.pre ? "" : " np"}">${f.pre ? `<span class="pm-pre" aria-hidden="true">${esc(f.pre)}</span>` : ""}<input id="${id}${f.k}" name="${f.k}" value="${esc(v || "")}" placeholder="${esc(f.ph)}" autocomplete="off" autocapitalize="off" spellcheck="false" ${f.k === "link" ? 'inputmode="url"' : ""} maxlength="${f.k === "note" ? 80 : 300}" aria-describedby="${id}${f.k}H"></div>
    <div class="pm-sub"><span id="${id}${f.k}H">${esc(f.help)}</span>${f.k === "note" ? "" : `<a class="pm-test" target="_blank" rel="noopener noreferrer" hidden>Test it</a>`}</div></div>`;
  const OTHER = [{ k: "link", label: "Other pay link", pre: "", ph: "https://buy.stripe.com/...", help: "Stripe, PayPal, Venmo, Cash App or Square links only." }, { k: "note", label: "A note for guests", pre: "", ph: "Zelle: maya@example.com", help: "Text only, like how to pay you on Zelle." }];
  function formHTML(p, id) { p = p || {}; const open = !!(p.link || p.note);
    return `<form class="pm-form" novalidate>${FIELDS.map((f) => field(f, p[f.k], id)).join("")}
      <details class="pm-more"${open ? " open" : ""}><summary>Another way to pay (optional)</summary><div class="pm-form">${OTHER.map((f) => field(f, p[f.k], id)).join("")}</div></details>
      <p class="pm-priv">${esc(PRIV)}</p><div class="pm-acts"><button type="submit" class="pm-b pri">Save</button><slot data-extra></slot></div><p class="pm-msg" role="status" aria-live="polite"></p></form>`; }
  // live cleaning: a pasted link becomes the handle, Test it opens the real page, a bad one says why
  function wire(form, onSaved) {
    const check = (box, fix) => { const k = box.dataset.f, inp = $("input", box), t = $(".pm-test", box), H = $("[id$='H']", box), F = [...FIELDS, ...OTHER].find((x) => x.k === k);
      if (k === "note") return true; const v = k === "link" ? cleanLink(inp.value) : clean(k, inp.value);
      if (v === null) { box.querySelector(".pm-in").setAttribute("data-bad", ""); inp.setAttribute("aria-invalid", "true"); H.setAttribute("data-err", ""); H.textContent = k === "link" ? "That link isn't one we can show. Use a Stripe, PayPal, Venmo, Cash App or Square link that starts with https://." : `That doesn't look like a ${F.label} ${k === "cashapp" ? "$cashtag" : k === "paypal" ? "PayPal.Me name" : "username"}. Letters, numbers, dashes and underscores only.`; if (t) t.hidden = true; return false; }
      box.querySelector(".pm-in").removeAttribute("data-bad"); inp.removeAttribute("aria-invalid"); H.removeAttribute("data-err"); H.textContent = F.help;
      if (fix && v !== inp.value.trim()) inp.value = v; if (t) { t.hidden = !v; if (v) { t.href = profileUrl(k, v); t.setAttribute("aria-label", `Test your ${F.label} link`); } } return true; };
    $$(".pm-f", form).forEach((box) => { const inp = $("input", box); check(box, false); inp.addEventListener("input", () => check(box, false)); inp.addEventListener("blur", () => check(box, true)); inp.addEventListener("paste", () => setTimeout(() => check(box, true), 0)); });
    form.addEventListener("submit", async (e) => { e.preventDefault(); const msg = $(".pm-msg", form), btn = $("button[type=submit]", form); let ok = true; $$(".pm-f", form).forEach((b) => { if (!check(b, true)) ok = false; });
      if (!ok) { msg.textContent = "Fix the one in red, then save."; $("[aria-invalid=true]", form)?.focus(); return; }
      const body = {}; $$("input", form).forEach((i) => (body[i.name] = i.value.trim())); btn.disabled = true; msg.textContent = "Saving…";
      try { const r = await fetch("/api/me/pay", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), j = await r.json().catch(() => ({}));
        if (!r.ok) { msg.textContent = j.message || "That didn't save. Try again."; if (j.field) $(`input[name=${j.field}]`, form)?.focus(); return; }
        const was = await (P0 || Promise.resolve(null)); changed({ ...(was || {}), pay: j.pay, has: j.has, need: j.has ? null : was?.need || null }); msg.textContent = j.has ? "Saved. Your events and drops use these now." : "Saved. No way to get paid is set."; onSaved?.(j); }
      catch { msg.textContent = "That didn't save. Check your connection and try again."; } finally { btn.disabled = false; } }); }
  let n = 0;
  /** The Settings section. */
  // drawn at once (empty), then filled in, so nothing below it jumps when the answer comes back
  async function settings(el) { if (!el) return; css(); el.innerHTML = formHTML({}, "pms" + ++n); const form = $("form", el), j = await load(true), p = j?.pay || {};
    for (const k of KEYS) { const i = $(`input[name=${k}]`, form); if (i && p[k]) i.value = p[k]; } if (p.link || p.note) $(".pm-more", form).open = true;
    if (j && !p.saved && hasAny(p)) $(".pm-msg", el).textContent = "From the tip buttons on your page. Save to use them for your events too.";
    wire(form); }
  /** The small sheet: add or change them without leaving what you were doing. */
  async function sheet({ onSave, title = "How you get paid" } = {}) { css(); document.getElementById("pmSheet")?.remove(); const j = await load(true), p = j?.pay || {};
    const bg = document.createElement("div"); bg.className = "pm-sh-bg"; bg.id = "pmSheet";
    bg.innerHTML = `<div class="pm-sh" role="dialog" aria-modal="true" aria-labelledby="pmShH"><header><div><h2 id="pmShH">${esc(title)}</h2><p>Every event and drop uses these. You can turn some off for one event.</p></div><button type="button" class="pm-x" aria-label="Close">×</button></header>${formHTML(p, "pmh" + ++n)}</div>`;
    document.body.appendChild(bg); const back = document.activeElement, close = () => { bg.remove(); try { back?.focus?.({ preventScroll: true }); } catch {} };
    bg.addEventListener("click", (e) => { if (e.target === bg || e.target.closest(".pm-x")) close(); }); bg.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    const form = $("form", bg); $("[data-extra]", form).outerHTML = `<button type="button" class="pm-b" data-cancel>Cancel</button>`; $("[data-cancel]", form).onclick = close;
    wire(form, (r) => { onSave?.(r); setTimeout(close, 500); }); setTimeout(() => $("input", bg)?.focus({ preventScroll: true }), 30); return { close }; }
  const list = (p) => ["venmo", "paypal", "cashapp", "link"].filter((k) => p?.[k]).map((k) => `${LABEL[k]} ${shown(k, p[k])}`);
  /** The canvas price setting: which of your methods this event shows. W.payHide holds the ones turned off. */
  async function editor(el, W, onChange) { if (!el) return; css(); const draw = (j) => { const p = j?.pay || {}, off = Array.isArray(W.payHide) ? W.payHide : [], ks = KEYS.filter((k) => p[k]);
      el.innerHTML = `<div class="pm-ed" role="group" aria-labelledby="pmEdH"><p class="pm-ed-h" id="pmEdH">${ks.length ? "Guests pay you through" : "No way to get paid yet"}</p>${ks.length ? `<div class="pm-ed-l">${ks.map((k) => `<label class="pm-ck"><input type="checkbox" data-k="${k}"${off.includes(k) ? "" : " checked"}><span>${esc(LABEL[k])}</span>${k === "note" ? "" : `<small>${esc(shown(k, p[k]))}</small>`}</label>`).join("")}</div>` : `<p class="pm-ed-f">Add Venmo, PayPal or Cash App once. Guests who are in get a button with the amount filled in.</p>`}
        <div><button type="button" class="pm-ln" data-pm-edit>${ks.length ? "Change" : "Add how you get paid"}</button></div>${ks.length ? `<p class="pm-ed-f">From your profile. Payments go straight to you. Pottery Lab doesn't hold the money.</p>` : ""}</div>`;
      $$("input[data-k]", el).forEach((c) => (c.onchange = () => { const hide = $$("input[data-k]", el).filter((x) => !x.checked).map((x) => x.dataset.k); if (hide.length) W.payHide = hide; else delete W.payHide; onChange?.(W); }));
      $("[data-pm-edit]", el).onclick = () => sheet({ onSave: () => {} }); };
    listeners.add((j) => { if (el.isConnected) draw(j); }); draw(await load()); }
  /** The drop setup: the same line, read only, with Change. */
  async function dropRow(el) { if (!el) return; css(); const draw = (j) => { const L = list(j?.pay);
      el.innerHTML = `<div class="pm-ed"><p class="pm-ed-h">${L.length ? "Guests pay you through" : "No way to get paid yet"}</p><p class="pm-ed-f" style="color:var(--pl-ink);font-size:15px">${L.length ? esc(L.join(", ")) + ". Buyers get these with the amount filled in." : "Add Venmo, PayPal or Cash App so buyers can pay you ahead. Until then they read that you'll tell them how to pay."}</p><div><button type="button" class="pm-ln" data-pm-edit>${L.length ? "Change" : "Add how you get paid"}</button></div></div>`;
      $("[data-pm-edit]", el).onclick = () => sheet(); };
    listeners.add((j) => { if (el.isConnected) draw(j); }); draw(await load()); }
  /** The first method's own page, for a drop's pay link when the host left it empty. */
  const primaryUrl = async () => { const p = (await load())?.pay || {}; for (const k of ["venmo", "paypal", "cashapp", "link"]) if (p[k]) return profileUrl(k, p[k]); return ""; };
  

  // ---------- guests: the host's buttons on a reply that's in ----------
  const eventId = () => (location.pathname.match(/^\/[ei]\/([A-Za-z0-9_-]{2,80})/) || [])[1] || (location.pathname === "/g" ? root.__gEv?.id || "" : "");
  const mine = (id) => { try { return JSON.parse(localStorage.getItem("encore-rsvp-" + id) || "null"); } catch { return null; } };
  const asked = {};
  function block(j, host, amt, hasLink) { const L = j.methods || [];
    return `<div class="pm-pay" role="group" aria-label="Ways to pay ${esc(host)}">${L.length ? `<p class="pm-pay-h">${hasLink ? "Or pay with" : `Pay ${esc(host)}${amt ? " " + esc("$" + amtOf(amt)) : ""} with`}</p><div class="pm-pay-b">${L.map((m, i) => `<a class="pm-btn${hasLink || i ? " alt" : ""}" data-pm-k="${esc(m.k)}" href="${esc(m.href)}" target="_blank" rel="noopener nofollow"><span>${esc(m.label)}${m.handle ? `<small>${esc(shown(m.k, m.handle))}</small>` : ""}</span>${amt && m.k !== "link" ? `<b>$${esc(amtOf(amt))}</b>` : ""}</a>`).join("")}</div>` : ""}
      ${j.text ? `<p class="pm-pay-t">${esc(j.text)}</p>` : ""}<p class="pm-pay-f">Payments go straight to ${esc(host)}. Pottery Lab doesn't hold the money.</p><button type="button" class="pm-b" data-pm-paid hidden>I paid</button></div>`; }
  function decorate(at, mode) { const id = eventId(), M = id && mine(id); if (!id || !M?.rid || !M.code || at.querySelector(".pm-pay") || at.dataset.pm === "1") return; at.dataset.pm = "1";
    const q = asked[id] || (asked[id] = fetch(`/api/public/pay/${encodeURIComponent(id)}?rid=${encodeURIComponent(M.rid)}&code=${encodeURIComponent(M.code)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    q.then((j) => { if (!at.isConnected || !j?.ok || j.paid || j.claimed || (!(j.methods || []).length && !j.text) || at.querySelector(".pm-pay")) return; css();
      const own = at.querySelector("#payBtn,#oPay,a.btn.pay,a[href^='https://'].btn.primary"), amt = centsIn(own?.textContent) || +j.cents || 0, host = j.host || "your host", hasLink = !!own;
      if (mode === "tk") { const p = $$("p.muted", at).find((x) => /will send a way to pay/.test(x.textContent)); if (p) p.textContent = amt ? `Pay $${amtOf(amt)} to keep your spot.` : "Pay with one of these."; }
      else { const p = $$(".note", at).find((x) => /will send a way to pay/.test(x.textContent)); if (p) p.textContent = "Pay with one of these."; }
      const h = block(j, host, amt, hasLink), btns = mode === "tk" ? at.querySelector(".btns") : null; if (btns) btns.insertAdjacentHTML("beforebegin", h); else at.insertAdjacentHTML("beforeend", h);
      const box = at.querySelector(".pm-pay"), mineBtn = $("[data-pm-paid]", box), theirs = at.querySelector("#iPaid,#oPaid");
      $$(".pm-btn", box).forEach((a) => a.addEventListener("click", () => { try { localStorage.setItem("encore-paytap-" + id, "1"); } catch {} if (theirs) theirs.hidden = false; else mineBtn.hidden = false; }));
      try { if (!theirs && localStorage.getItem("encore-paytap-" + id)) mineBtn.hidden = false; } catch {}
      mineBtn.onclick = async () => { mineBtn.disabled = true; try { const r = await fetch(`/api/public/pay/${encodeURIComponent(id)}/claim`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rid: M.rid, code: M.code }) }); if (!r.ok) throw 0;
          try { localStorage.setItem("encore-rsvp-" + id, JSON.stringify({ ...mine(id), paidClaim: true })); } catch {} box.innerHTML = `<p class="pm-pay-h" role="status">Got it. ${esc(host)} will check and confirm.</p>`; }
        catch { mineBtn.disabled = false; mineBtn.textContent = "Didn't go through. Tap to try again"; } }; }); }
  function guests() { const scan = () => { const tk = document.getElementById("tk"); if (tk) decorate(tk, "tk"); const pb = document.querySelector("#view-guest #payBox"); if (pb) decorate(pb, "box"); };
    scan(); let t = 0; new MutationObserver(() => { clearTimeout(t); t = setTimeout(scan, 150); }).observe(document.body, { childList: true, subtree: true }); }
  if (/^\/([ei]\/|g$)/.test(location.pathname)) document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", guests) : guests();

  root.PayMethods = { ...pure, load, settings, sheet, editor, dropRow, primaryUrl, onChange: (fn) => listeners.add(fn) };
})(typeof window !== "undefined" ? window : globalThis);
