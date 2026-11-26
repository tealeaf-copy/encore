// Price tiers: an event with more than one price ("Adults $55 · Kids $35", "Members $10 · Guests $15").
// The event keeps priceTiers: [{ label, price }] (at most 4, labels up to 20 characters; server/looks.js cleans them).
// A guest picks how many of each when they reply (rsvp.tiers: [{ label, n }]) and pays the sum.
// Used by the light invite (public/invite.html), the full invite (/g) and the host's Edit details; node loads it in tests.
(function (root) {
  const MAX = 4, LABEL = 20;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const num = (v) => { const m = String(v ?? "").replace(/,/g, "").match(/(\d{1,6}(?:\.\d{1,2})?)/); const n = typeof v === "number" ? v : m ? +m[1] : 0; return Number.isFinite(n) && n > 0 && n <= 100000 ? Math.round(n * 100) / 100 : 0; };
  /** "$55", "$54.95" */
  const money = (n) => { const c = Math.round(+n * 100); return "$" + (c % 100 ? (c / 100).toFixed(2) : String(c / 100)); };
  const cleanLabel = (v) => String(v ?? "").replace(/[\u0000-\u001f\u007f<>$]/g, " ").replace(/\s+/g, " ").trim().slice(0, LABEL).trim();
  /** The same rules as the server: a label and a price above zero, at most 4, no repeated labels. */
  function clean(L) { if (!Array.isArray(L)) return []; const seen = new Set(), out = [];
    for (const x of L) { if (!x || typeof x !== "object") continue; const label = cleanLabel(x.label), price = num(x.price); if (!label || !price || seen.has(label.toLowerCase())) continue; seen.add(label.toLowerCase()); out.push({ label, price }); if (out.length >= MAX) break; }
    return out; }
  const of = (e) => clean(e?.priceTiers);
  /** "Adults $55 · Kids $35" ("" without tiers) */
  const line = (e) => of(e).map((t) => `${t.label} ${money(t.price)}`).join(" · ");
  /** What a guest's picks cost: the sum over tiers of price × how many. Picks: [{ label, n }]. */
  function total(e, picks) { const T = of(e); if (!T.length || !Array.isArray(picks)) return 0; let c = 0;
    for (const p of picks) { const t = T.find((x) => x.label.toLowerCase() === String(p?.label ?? "").trim().toLowerCase()), n = Math.max(0, Math.min(50, Math.floor(+p?.n || 0))); if (t && n) c += Math.round(t.price * 100) * n; }
    return c / 100; }
  const people = (picks) => (Array.isArray(picks) ? picks.reduce((a, p) => a + Math.max(0, Math.min(50, Math.floor(+p?.n || 0))), 0) : 0);
  const pickLine = (picks) => (Array.isArray(picks) ? picks.filter((p) => +p?.n > 0).map((p) => `${+p.n} ${p.label}`).join(", ") : "");

  // ---- reading the host's sentence: "adults $55, kids $35", "$55 adults, $35 kids", "members $10 / guests $15" ----
  const WORDS = ["non-members", "non members", "nonmembers", "members", "member", "non-member", "adults", "adult", "kids", "kid", "children", "child", "under 12s", "under 12", "under 5s", "under 5", "teens", "teen", "students", "student", "seniors", "senior", "guests", "guest", "couples", "couple", "singles", "single", "families", "family", "early bird", "early birds", "general", "general admission", "vip", "standard", "regular", "locals", "local", "staff", "friends", "public", "plus ones", "plus one"]
    .sort((a, b) => b.length - a.length).map((w) => w.replace(/[-\s]/g, "[-\\s]?"));
  const W = `(${WORDS.join("|")})`, AMT = "\\$\\s?(\\d{1,5}(?:\\.\\d{1,2})?)";
  const titled = (w) => { const t = w.trim().replace(/\s+/g, " ").toLowerCase(); const fix = { vip: "VIP", "non members": "Non-members", nonmembers: "Non-members" }; return fix[t] || t.charAt(0).toUpperCase() + t.slice(1); };
  /** Tiers said in a sentence, or [] when fewer than two are clear. */
  function read(text) { const s = String(text || ""), grab = (re, li, pi) => { const o = []; re.lastIndex = 0; let m; while ((m = re.exec(s))) o.push({ label: titled(m[li]), price: +m[pi] }); return clean(o); };
    // "$55 adults, $35 kids" / "$10 for members and $15 for guests" first: the amount comes before its word
    const after = grab(new RegExp(`${AMT}\\s*(?:(?:a|per|for|each for)\\s+)?${W}\\b`, "gi"), 2, 1);
    if (after.length >= 2) return after;
    const before = grab(new RegExp(`\\b${W}\\s*(?::|=|-|at|are|is|for)?\\s*${AMT}`, "gi"), 1, 2);
    return before.length >= 2 ? before : []; }

  // ---- the guest's picker: a stepper for each tier, and the total under it ----
  const CSS = `.pt-tiers{border:1.5px solid var(--lk-line,var(--pl-line));border-radius:16px;padding:12px 14px;margin:0 0 14px;display:grid;gap:8px}.pt-tiers>b{font:600 14px "Instrument Sans",system-ui,sans-serif}
.pt-row{display:flex;align-items:center;gap:10px;justify-content:space-between}.pt-row span{font-weight:600}.pt-row small{color:inherit;opacity:.85;font-weight:500;margin-left:6px}
.pt-step{display:inline-flex;align-items:center;gap:6px}.pt-step button{all:unset;box-sizing:border-box;cursor:pointer;width:36px;height:36px;border-radius:50%;border:1.5px solid currentColor;display:grid;place-items:center;font:700 18px/1 system-ui}.pt-step button:focus-visible{outline:3px solid var(--pl-accent);outline-offset:2px}.pt-step button:disabled{opacity:.35;cursor:not-allowed}
.pt-step output{min-width:22px;text-align:center;font:700 16px "Instrument Sans",system-ui,sans-serif}.pt-sum{margin:2px 0 0;font-weight:700}`;
  function css() { if (typeof document === "undefined" || document.getElementById("pt-css")) return; const s = document.createElement("style"); s.id = "pt-css"; s.textContent = CSS; document.head.appendChild(s); }
  /** The picker's HTML: one row a tier; the first starts at 1. */
  function pickerHTML(e, picks) { const T = of(e); if (!T.length) return ""; css(); const n = (t, i) => { const p = (picks || []).find((x) => x.label === t.label); return p ? +p.n || 0 : i ? 0 : 1; };
    return `<fieldset class="pt-tiers" id="ptTiers"><b>How many of each?</b>${T.map((t, i) => `<div class="pt-row" data-tier="${esc(t.label)}"><span>${esc(t.label)}<small>${esc(money(t.price))}</small></span><span class="pt-step"><button type="button" data-d="-1" aria-label="One fewer ${esc(t.label.toLowerCase())}">−</button><output aria-live="polite">${n(t, i)}</output><button type="button" data-d="1" aria-label="One more ${esc(t.label.toLowerCase())}">+</button></span></div>`).join("")}<p class="pt-sum" aria-live="polite"></p></fieldset>`; }
  /** What the picker says now: [{ label, n }] with the zeros left out. */
  const picked = (box) => [...(box?.querySelectorAll?.(".pt-row") || [])].map((r) => ({ label: r.dataset.tier, n: +r.querySelector("output").textContent || 0 })).filter((p) => p.n > 0);
  /** Wire the steppers inside box; onChange(picks) after each tap. At most `cap` people in all (6, the most a tiered reply holds: server/social.js partyMax). */
  function wire(box, e, { cap = 6, onChange } = {}) { const el = box?.querySelector?.(".pt-tiers") || box; if (!el || el.__pt) return; el.__pt = 1;
    const sync = () => { const P = picked(el), all = people(P); el.querySelectorAll(".pt-row").forEach((r) => { const v = +r.querySelector("output").textContent || 0; r.querySelector('[data-d="-1"]').disabled = v <= 0 || all <= 1; r.querySelector('[data-d="1"]').disabled = all >= cap; });
      const sum = el.querySelector(".pt-sum"); if (sum) sum.textContent = all ? `${all} ${all === 1 ? "person" : "people"} · ${money(total(e, P))}` : ""; onChange?.(P); };
    el.addEventListener("click", (ev) => { const b = ev.target.closest("button[data-d]"); if (!b || b.disabled) return; const o = b.parentElement.querySelector("output"); o.textContent = Math.max(0, (+o.textContent || 0) + +b.dataset.d); sync(); });
    sync(); }

  // ---- inside the app (index.html loads this file): the sentence reader, Edit details, and the full invite (/g) ----
  // It reads the app's own globals (draft, quickStart, priceTxt) the way its other add-ons do.
  function app() { const G = root;
    const appDraft = () => { try { return typeof draft !== "undefined" ? draft : null; } catch { return null; } }; // eslint-disable-line no-undef
    // "Friendsgiving sat 6pm, adults $55, kids $35": the tiers, and the first one as the event's price
    if (typeof G.quickStart === "function" && !G.quickStart.__pt) { const q0 = G.quickStart, q = function (text) { const r = q0.apply(this, arguments); try { const d = appDraft(), T = read(text); if (d && !d.example && T.length >= 2) { d.priceTiers = T; if (!d.price || d.price === "chip" || d.free) d.price = money(T[0].price); d.free = false; } } catch (err) { console.warn(err); } return r; }; q.__pt = 1; G.quickStart = q; }
    // every place the app says the price in words ("$55 a person") says the tiers instead
    if (typeof G.priceTxt === "function" && !G.priceTxt.__pt) { const p0 = G.priceTxt, p = function (d) { const t = line(d); return t ? (d?.ticketNote ? `${t} ${d.ticketNote}` : t) : p0.apply(this, arguments); }; p.__pt = 1; G.priceTxt = p; }
    // Edit details: "Different prices?" under Price per spot. "Adults $55, Kids $35" in one line; empty takes them off
    document.addEventListener("click", (ev) => { const b = ev.target.closest?.("#fe-save"); const d = appDraft(); if (!b || !d || d.example) return; const box = b.closest(".fedit") || document, f = box.querySelector("#fe-tiers"); if (!f) return;
      const v = f.value.trim(), parts = v.split(/[,·/;|]|\band\b/).map((x) => x.trim()).filter(Boolean);
      // "Early bird $40, Door $50" (any words), else the sentence reader's way round ("$55 adults, $35 kids")
      const each = clean(parts.map((x) => { const m = x.match(/^(.+?)\s*:?\s*\$\s?(\d+(?:\.\d{1,2})?)$/); return m ? { label: m[1], price: m[2] } : null; }));
      const T = !v ? [] : each.length === parts.length ? each : read(v);
      if (v && !T.length) { ev.stopImmediatePropagation(); ev.preventDefault(); f.setAttribute("aria-invalid", "true"); f.focus(); if (typeof toast === "function") toast("Write each price like Adults $55, Kids $35"); return; } // eslint-disable-line no-undef
      d.priceTiers = T; if (T.length && !(d.price && d.price !== "chip")) { d.price = money(T[0].price); d.free = false; } }, true);
    new MutationObserver(() => { const d = appDraft(), pr = document.querySelector(".fedit #fe-price"); if (!d || d.example || !pr || document.getElementById("fe-tiers")) return;
      const l = document.createElement("label"); l.className = "f"; l.id = "fe-tiersL"; l.innerHTML = `Different prices? <small class="note">Up to ${MAX}, like Adults $55, Kids $35. Guests pick how many of each.</small><input id="fe-tiers" maxlength="120" placeholder="Adults $55, Kids $35" value="${esc(of(d).map((t) => `${t.label} ${money(t.price)}`).join(", "))}">`;
      (pr.closest(".row") || pr.closest("label"))?.after(l); }).observe(document.documentElement, { childList: true, subtree: true });
    // the full invite: the price line says the tiers, the reply form gets the picker, and the reply carries the picks
    let gT = 0; const g = () => { const e = G.__gEv, host = document.getElementById("view-guest"); if (!e || !host || host.hidden || !of(e).length) return; const t = line(e);
      host.querySelectorAll("#forWho b").forEach((b) => { if (/a person$/.test(b.textContent) && b.textContent !== t) b.textContent = t; });
      // the short price beside the reply button ("$55") says where the tiers start
      { const lo = "From " + money(Math.min(...of(e).map((x) => x.price))); document.querySelectorAll("#view-guest b, #view-guest strong, #gBar b, #gStick b").forEach((b) => { if (!b.children.length && b.textContent.trim() === String(e.price).trim()) b.textContent = lo; }); }
      // the reply choice says "I'm in", not one of the prices (the picker below says what it costs)
      host.querySelectorAll('#gResp [data-v="going"]').forEach((b) => { if (/ · \$/.test(b.textContent)) b.textContent = b.textContent.replace(/ · \$[\d.,]+$/, ""); });
      const send = host.querySelector("#g-send"); if (send && !host.querySelector("#ptTiers")) { const at = send.closest(".btns") || send; const w = document.createElement("div"); let mine = null; try { mine = JSON.parse(localStorage.getItem("encore-tiers-" + e.id) || "null"); } catch {} w.innerHTML = pickerHTML(e, mine); at.before(w.firstElementChild); wire(host, e); } };
    new MutationObserver(() => { clearTimeout(gT); gT = setTimeout(g, 60); }).observe(document.documentElement, { childList: true, subtree: true });
    const f0 = G.fetch; G.fetch = function (u, o) { try { const url = String(u?.url || u || ""), e = G.__gEv, box = document.querySelector("#view-guest #ptTiers");
        if (e && box && o?.body && typeof o.body === "string" && /\/api\/db\/(collection\?path=rsvps|doc\?path=rsvps)/.test(url) && /POST|PATCH|PUT/i.test(o.method || "")) { const b = JSON.parse(o.body);
          if (b && b.eventId === e.id && /^(going|requested|waitlist)$/.test(b.response || "")) { const P = picked(box), n = people(P); if (n) { b.tiers = P; b.party = n; b.plusOne = n > 1; o = { ...o, body: JSON.stringify(b) };
            try { localStorage.setItem("encore-tiers-" + e.id, JSON.stringify(P)); } catch {} } } } } catch {} return f0.call(this, u, o); }; }
  if (typeof document !== "undefined" && document.getElementById("view-guest")) app();

  root.EncoreTiers = { MAX, LABEL, clean, of, line, money, total, people, pickLine, read, pickerHTML, picked, wire, css };
})(typeof window !== "undefined" ? window : globalThis);
