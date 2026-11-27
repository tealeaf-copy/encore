// What a host makes, in one model (server/drops.js): an event (guests tap I'm in), a drop (order ahead, pick up at a set
// time; a pre-order event under the hood) and something to book (teams request a date). This file is the host's side:
// the "What are you making?" chooser, the drop setup with Potto (3 short steps, a live preview of what guests see, then
// "Your drop is live"), one Orders inbox for every drop, managing a drop (taking orders, new batch), "Something to book",
// and the guest-facing "What I offer" section on the host page. Loaded by host.html and index.html.
(function () {
  if (window.EncoreDrop) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const api = async (u, b, method) => { const r = await fetch(u, b === undefined && !method ? { credentials: "same-origin" } : { method: method || "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || "That didn't go through. Try again."); return j; };
  const money = (n) => "$" + (Math.round(n * 100) % 100 ? (+n).toFixed(2) : String(Math.round(n)));
  const priceIn = (v) => { const m = String(v ?? "").replace(/[,\s$]/g, "").match(/^(\d{1,4})(\.\d{1,2})?$/); return m ? +(m[1] + (m[2] || "")) : 0; };
  const G = 'viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const I = { x: `<svg ${G} width="20" height="20"><path d="M5 5l10 10M15 5 5 15"/></svg>`, back: `<svg ${G} width="20" height="20"><path d="M12.5 4.5 7 10l5.5 5.5"/></svg>`,
    cal: `<svg ${G} width="22" height="22"><rect x="3" y="4.5" width="14" height="12" rx="2"/><path d="M3 8.5h14M7 2.8v3.4M13 2.8v3.4"/></svg>`,
    bag: `<svg ${G} width="22" height="22"><path d="M4.5 7h11l-1 9.5h-9zM7.5 7V5.5a2.5 2.5 0 0 1 5 0V7"/></svg>`,
    people: `<svg ${G} width="22" height="22"><circle cx="7.5" cy="7" r="2.8"/><path d="M2.5 16c.8-2.8 2.7-4.2 5-4.2s4.2 1.4 5 4.2"/><circle cx="14" cy="7.5" r="2.2"/><path d="M13.5 11.8c1.9 0 3.3 1.1 4 3.4"/></svg>`,
    pin: `<svg ${G} width="18" height="18"><path d="M10 17.5s5.5-5.2 5.5-9.3a5.5 5.5 0 0 0-11 0c0 4.1 5.5 9.3 5.5 9.3zM10 10.2a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>`,
    lock: `<svg ${G} width="18" height="18"><rect x="4.5" y="9" width="11" height="8" rx="1.8"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/></svg>`,
    camera: `<svg ${G} width="20" height="20"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h2l1.3-2h4.4l1.3 2h2A1.5 1.5 0 0 1 17 7.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z"/><circle cx="10" cy="10.8" r="2.8"/></svg>`,
    plus: `<svg ${G} width="18" height="18"><path d="M10 4v12M4 10h12"/></svg>`, trash: `<svg ${G} width="18" height="18"><path d="M4 6h12M8 6V4h4v2M5.5 6l.8 10h7.4l.8-10"/></svg>`,
    copy: `<svg ${G} width="18" height="18"><rect x="7" y="7" width="9.5" height="9.5" rx="2"/><path d="M13 7V4.5A1.5 1.5 0 0 0 11.5 3h-7A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13H7"/></svg>`,
    share: `<svg ${G} width="18" height="18"><path d="M10 13V3M6.5 6.5 10 3l3.5 3.5"/><path d="M5 10v6h10v-6"/></svg>`, eye: `<svg ${G} width="18" height="18"><path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z"/><circle cx="10" cy="10" r="2.4"/></svg>`,
    repeat: `<svg ${G} width="18" height="18"><path d="M4 9V7.5A2.5 2.5 0 0 1 6.5 5H16l-2.5-2.5M16 11v1.5a2.5 2.5 0 0 1-2.5 2.5H4l2.5 2.5"/></svg>`, list: `<svg ${G} width="18" height="18"><path d="M7 5h10M7 10h10M7 15h10M3.5 5h.01M3.5 10h.01M3.5 15h.01"/></svg>`,
    edit: `<svg ${G} width="18" height="18"><path d="M13.5 3.5l3 3L7 16H4v-3z"/></svg>`, chev: `<svg ${G} width="18" height="18"><path d="m7.5 4.5 5.5 5.5-5.5 5.5"/></svg>` };
  const potto = (mood = "happy", n = 44) => { try { return window.Potto?.svg ? window.Potto.svg(mood, n) : window.EncoreCommunity?.pipSVG ? window.EncoreCommunity.pipSVG(mood, n) : typeof window.pipSVG === "function" ? window.pipSVG(mood, n) : ""; } catch { return ""; } };
  const toast = (t) => { let el = $("#dpToast"); if (!el) { el = document.createElement("div"); el.id = "dpToast"; el.setAttribute("role", "status"); document.body.appendChild(el); } el.textContent = t; el.className = "on"; clearTimeout(toast.t); toast.t = setTimeout(() => (el.className = ""), 3200); };
  const copy = async (t, ok) => { try { await navigator.clipboard.writeText(t); toast(ok || "Copied."); } catch { prompt("Copy this:", t); } };

  // ---- the look: the system tokens (docs/brand-kit.md). Quiet controls, one soft shadow on the sheet, 44px targets ----
  const CSS = `
  .dp-bg{position:fixed;inset:0;z-index:2147483000;background:rgba(27,29,28,.5);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);display:flex;align-items:flex-end;justify-content:center}
  @media (min-width:700px){.dp-bg{align-items:center;padding:24px}}
  .dp-sheet{background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);width:100%;max-width:560px;max-height:94dvh;display:flex;flex-direction:column;border-radius:6px 6px 0 0;box-shadow:0 -8px 40px rgba(31,26,23,.18);font:400 16px/1.45 "IBM Plex Sans",system-ui,sans-serif;border:1.5px solid var(--pl-ink,#1B1D1C);border-bottom:0}
  @media (min-width:700px){.dp-sheet{border-radius:6px;border-bottom:1.5px solid var(--pl-ink,#1B1D1C);max-height:90dvh}}
  .dp-sheet:focus{outline:none}.dp-hd{display:flex;align-items:flex-start;gap:12px;padding:16px 16px 8px 20px}.dp-hd h2{font:600 20px/1.25 var(--pl-font-text,"IBM Plex Sans"),system-ui,sans-serif;margin:0}.dp-hd p{margin:4px 0 0;font-size:14px;color:var(--pl-soft,#444845)}
  .dp-step{font:500 13px "IBM Plex Sans",system-ui,sans-serif;color:var(--pl-soft,#444845);margin:0 0 6px}.dp-bar{display:flex;gap:4px;margin:0 0 10px}.dp-bar i{flex:1;height:4px;border-radius:4px;background:var(--pl-line,#CFC8B9)}.dp-bar i.on{background:var(--pl-accent,#29489A)}
  .dp-x{margin-left:auto;flex:none;width:44px;height:44px;border-radius:6px;border:1.5px solid var(--pl-line,#CFC8B9);background:#fff;color:var(--pl-ink,#1B1D1C);display:grid;place-items:center;cursor:pointer}
  .dp-body{overflow:auto;padding:8px 20px 20px;flex:1;-webkit-overflow-scrolling:touch}
  .dp-ft{display:flex;gap:8px;align-items:center;justify-content:flex-end;padding:12px 16px calc(12px + env(safe-area-inset-bottom));border-top:1.5px solid var(--pl-line,#CFC8B9);background:var(--pl-surface,#FAF8F3);border-radius:0}
  .dp-ft .dp-msg{margin-right:auto;font-size:14px;color:var(--pl-danger,#A2361A)}
  .dp-b{min-height:44px;padding:0 18px;border-radius:6px;border:1.5px solid var(--pl-line,#CFC8B9);background:#fff;color:var(--pl-ink,#1B1D1C);font:600 16px var(--pl-font-text,"IBM Plex Sans"),system-ui,sans-serif;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;text-decoration:none}
  .dp-b.pri{background:var(--pl-accent,#29489A);border-color:var(--pl-accent,#29489A);color:#fff}.dp-b.pri:active{background:var(--pl-danger,#A2361A)}.dp-b[disabled]{opacity:.55;cursor:default}.dp-b.sm{min-height:44px;padding:0 14px;font-size:14px}.dp-b.q{border-color:transparent;background:transparent}
  .dp-b:focus-visible,.dp-f input:focus-visible,.dp-f select:focus-visible,.dp-f textarea:focus-visible,.dp-x:focus-visible,.dp-opt:focus-within,.dp-sw input:focus-visible+i{outline:none;box-shadow:0 0 0 3px var(--pl-focus,rgba(41,72,154,.3))}
  .dp-potto{display:flex;gap:12px;align-items:center;margin:4px 0 16px}.dp-potto svg{flex:none}.dp-potto p{margin:0;font-size:16px}
  .dp-f{display:grid;gap:6px;margin:0 0 16px}.dp-f>span,.dp-f legend,.dp-lab{font:600 14px "IBM Plex Sans",system-ui,sans-serif}.dp-f small,.dp-help{font-size:13px;color:var(--pl-soft,#444845);font-weight:400}
  .dp-sheet .dp-f input:not([type=checkbox]):not([type=radio]):not([type=file]),.dp-sheet .dp-f select,.dp-sheet .dp-f textarea{border:1.5px solid var(--pl-line,#CFC8B9)!important}.dp-sheet .dp-f input:not([type=checkbox]):not([type=radio]):not([type=file]):focus,.dp-sheet .dp-f select:focus,.dp-sheet .dp-f textarea:focus{border-color:var(--pl-ink,#1B1D1C)!important}.dp-sheet .dp-f [aria-invalid=true]{border-color:var(--pl-danger,#A2361A)!important}
  .dp-f input,.dp-f select,.dp-f textarea{width:100%;box-sizing:border-box;min-height:44px;padding:10px 12px;border:1.5px solid var(--pl-line,#CFC8B9);border-radius:6px;background:#fff;color:var(--pl-ink,#1B1D1C);font:400 16px "IBM Plex Sans",system-ui,sans-serif}
  .dp-f input:focus,.dp-f select:focus,.dp-f textarea:focus{border-color:var(--pl-ink,#1B1D1C)}.dp-f [aria-invalid=true]{border-color:var(--pl-danger,#A2361A)}
  .dp-money{display:flex;align-items:center;border:1.5px solid var(--pl-line,#CFC8B9);border-radius:6px;background:#fff;padding-left:12px}.dp-money:focus-within{border-color:var(--pl-ink,#1B1D1C);box-shadow:0 0 0 3px var(--pl-focus,rgba(41,72,154,.3))}.dp-money b{font-weight:600;color:var(--pl-soft,#444845)}.dp-sheet .dp-money input:not([type=checkbox]):not([type=radio]):not([type=file]){border:0!important;box-shadow:none!important;padding-left:4px;background:transparent}
  .dp-item{border:1.5px solid var(--pl-line,#CFC8B9);border-radius:6px;background:#fff;padding:12px;margin:0 0 12px}.dp-item .dp-f{margin-bottom:12px}.dp-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;align-items:end}.dp-row .dp-f{margin:0}
  .dp-ihd{display:flex;align-items:center;justify-content:space-between;margin:0 0 8px}.dp-ihd b{font:600 14px "IBM Plex Sans",system-ui,sans-serif;color:var(--pl-soft,#444845)}
  .dp-photo{display:flex;align-items:center;gap:12px;margin-top:12px}.dp-photo img{width:56px;height:56px;object-fit:cover;border-radius:6px}.dp-photo label{cursor:pointer}
  .dp-chips{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 0}.dp-chip{display:inline-flex;align-items:center;gap:4px;min-height:36px;padding:0 6px 0 14px;border-radius:999px;background:var(--pl-ink,#1B1D1C);color:#fff;font:500 14px "IBM Plex Sans",system-ui,sans-serif}.dp-chip button{width:32px;height:32px;border:0;background:transparent;color:#fff;border-radius:999px;cursor:pointer;display:grid;place-items:center}
  .dp-pick{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;align-items:end}.dp-pick.noday{grid-template-columns:repeat(2,minmax(0,1fr))}.dp-pick .dp-f{margin:0}.dp-pick .dp-b{grid-column:1/-1}
  .dp-sheet .dp-pick select{padding-right:4px}
  .dp-opts{display:grid;gap:8px;margin:0 0 16px}.dp-opt{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border:1.5px solid var(--pl-line,#CFC8B9);border-radius:6px;background:#fff;cursor:pointer}.dp-opt input{position:absolute;opacity:0;pointer-events:none}.dp-opt:has(input:checked){border-color:var(--pl-ink,#1B1D1C);box-shadow:inset 0 0 0 1px var(--pl-ink,#1B1D1C)}.dp-opt b{display:block;font:600 16px var(--pl-font-text,"IBM Plex Sans"),system-ui,sans-serif}.dp-opt small{display:block;color:var(--pl-soft,#444845);font-size:14px}.dp-opt .ic{flex:none;width:40px;height:40px;border-radius:6px;background:var(--pl-raised,#E6E1D5);display:grid;place-items:center;color:var(--pl-ink,#1B1D1C)}.dp-opt em{display:block;font-style:normal;font-size:13px;color:var(--pl-soft,#444845);margin-top:4px}
  .dp-sw{display:flex;align-items:center;gap:12px;justify-content:space-between;padding:12px 14px;border:1.5px solid var(--pl-line,#CFC8B9);border-radius:6px;background:#fff;margin:0 0 16px;cursor:pointer}.dp-sw span b{display:block;font-weight:600}.dp-sw span small{display:block;font-size:13px;color:var(--pl-soft,#444845)}
  .dp-sw input{position:absolute;opacity:0;width:1px;height:1px}.dp-sw i{flex:none;width:50px;height:30px;border-radius:999px;background:var(--pl-line,#CFC8B9);position:relative;transition:background .15s}.dp-sw i::after{content:"";position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2);transition:transform .15s}.dp-sw input:checked+i{background:#3E7C4F}.dp-sw input:checked+i::after{transform:translateX(20px)}
  .dp-how{margin:0 0 16px;border:1.5px solid var(--pl-line,#CFC8B9);border-radius:6px;background:var(--pl-raised,#E6E1D5)}.dp-how summary{cursor:pointer;min-height:44px;display:flex;align-items:center;padding:0 14px;font-weight:600;font-size:14px;list-style:none}.dp-how summary::-webkit-details-marker{display:none}.dp-how ul{margin:0;padding:0 14px 12px 32px;font-size:14px}.dp-how li{margin:4px 0}
  .dp-pv{margin:8px 0 0}.dp-pv>small{display:block;font:600 13px "IBM Plex Sans",system-ui,sans-serif;color:var(--pl-soft,#444845);margin:0 0 6px;text-transform:none}
  .dp-card{border:1.5px solid var(--pl-line,#CFC8B9);border-radius:6px;background:#fff;padding:16px}.dp-card h3{font:600 20px/1.2 var(--pl-font-text,"IBM Plex Sans"),system-ui,sans-serif;margin:0 0 4px}.dp-card .dp-sub{margin:0;color:var(--pl-soft,#444845);font-size:14px;display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center}.dp-card .dp-sub svg{vertical-align:-3px}
  .dp-mi{display:grid;grid-template-columns:48px minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 0;border-top:1.5px solid var(--pl-line,#CFC8B9)}.dp-mi:first-of-type{margin-top:10px}.dp-mi .art{width:48px;height:48px;border-radius:6px;background:var(--pl-raised,#E6E1D5);object-fit:cover;display:grid;place-items:center;color:var(--pl-ink,#1B1D1C);overflow:hidden}.dp-mi .art svg{width:100%;height:auto}.dp-mi .art svg[width="22"]{width:22px}.dp-mi b{display:block;font-weight:600}.dp-mi small{color:var(--pl-soft,#444845);font-size:13px}.dp-mi .pr{font-weight:600;font-variant-numeric:tabular-nums}
  .dp-slots{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0}.dp-slots span{padding:6px 12px;border-radius:999px;border:1.5px solid var(--pl-line,#CFC8B9);font-size:14px}
  .dp-fake{margin-top:12px;min-height:44px;border-radius:6px;background:var(--pl-accent,#29489A);color:#fff;display:flex;align-items:center;justify-content:center;font:600 16px var(--pl-font-text,"IBM Plex Sans"),system-ui,sans-serif}
  .dp-live{text-align:center}.dp-live h3{font:600 28px/1.2 var(--pl-font-text,"IBM Plex Sans"),system-ui,sans-serif;margin:8px 0 4px}.dp-link{display:flex;gap:8px;align-items:center;border:1.5px solid var(--pl-line,#CFC8B9);border-radius:6px;background:#fff;padding:4px 4px 4px 12px;margin:16px 0 8px;text-align:left}.dp-link span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}
  .dp-err{color:var(--pl-danger,#A2361A);font-size:14px;font-weight:600;margin:0 0 12px}.dp-err:empty{display:none}
  .dp-grp{margin:0 0 20px}.dp-grp h3{font:600 20px/1.25 var(--pl-font-text,"IBM Plex Sans"),system-ui,sans-serif;margin:0 0 4px}.dp-tally{font-size:14px;color:var(--pl-soft,#444845);margin:0 0 8px}
  .dp-win{margin:12px 0 4px;display:flex;align-items:center;justify-content:space-between;gap:8px}.dp-win b{font-size:14px}
  .dp-ord{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 12px;padding:12px;border:1.5px solid var(--pl-line,#CFC8B9);border-radius:6px;background:#fff;margin:0 0 8px}.dp-ord b{font-weight:600}.dp-ord small{display:block;color:var(--pl-soft,#444845);font-size:13px}.dp-ord .tot{font-weight:600;text-align:right;font-variant-numeric:tabular-nums}.dp-ord .st{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:6px}
  .dp-ord .st button{min-height:36px;padding:0 12px;border-radius:6px;border:1.5px solid var(--pl-line,#CFC8B9);background:#fff;color:var(--pl-ink,#1B1D1C);font:500 14px "IBM Plex Sans",system-ui,sans-serif;cursor:pointer}.dp-ord .st button[aria-pressed=true]{background:var(--pl-ink,#1B1D1C);border-color:var(--pl-ink,#1B1D1C);color:#fff}.dp-ord.cancelled{opacity:.6}
  .dp-empty{text-align:center;padding:16px 8px;color:var(--pl-soft,#444845)}.dp-empty p{margin:8px 0 12px}
  .dp-acts{display:grid;gap:8px;margin:0 0 8px}.dp-act{display:flex;gap:12px;align-items:center;width:100%;text-align:left;min-height:56px;padding:12px;border:1.5px solid var(--pl-line,#CFC8B9);border-radius:6px;background:#fff;color:var(--pl-ink,#1B1D1C);font:inherit;cursor:pointer;text-decoration:none}.dp-act:hover{border-color:var(--pl-ink,#1B1D1C)}.dp-act .ic{flex:none;width:36px;height:36px;border-radius:6px;background:var(--pl-raised,#E6E1D5);display:grid;place-items:center;color:var(--pl-ink,#1B1D1C)}.dp-act .ic svg{width:20px;height:20px}.dp-act>span:not(.ic){flex:1;min-width:0}.dp-act b{display:block;font-weight:600;font-size:17px}.dp-act small{display:block;color:var(--pl-soft,#444845);font-size:14px;line-height:1.4;text-wrap:balance}.dp-act small+small{margin-top:2px}.dp-act>svg:last-child{flex:none;margin-left:auto;color:var(--pl-soft,#444845)}
  @media (max-width:380px){.dp-body{padding:8px 16px 20px}.dp-hd{padding-left:16px}.dp-act{padding:12px 10px;gap:10px}}
  .dp-lead{margin:0 0 12px;color:var(--pl-soft,#444845);font-size:15px;text-wrap:pretty}.dp-hd h2{text-wrap:balance}.dp-potto p,.dp-help,.dp-f small{text-wrap:pretty}
  #dpToast{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom));transform:translate(-50%,20px);opacity:0;z-index:2147483600;background:var(--pl-ink,#1B1D1C);color:#fff;padding:10px 16px;border-radius:999px;font:500 14px "IBM Plex Sans",system-ui,sans-serif;transition:.2s;pointer-events:none;max-width:90vw}#dpToast.on{opacity:1;transform:translate(-50%,0)}
  .dp-vh{position:absolute;left:-9999px}
  /* the guest-facing "What I offer" on the host page wears the host's brand kit (the page's --head, --body, --accent, --card, --line) */
  .offer{margin:24px 0 8px}.offer>h2{margin:0 0 4px}.offer>.of-sub{margin:0 0 12px;color:var(--soft,var(--pl-soft,#444845));font-size:16px}
  .of-list{display:grid;gap:12px}.of-row{display:grid;grid-template-columns:64px minmax(0,1fr);gap:14px;align-items:center;padding:14px;border:1.5px solid var(--line,var(--pl-line,#CFC8B9));border-radius:6px;background:var(--card,#fff)}
  .of-art{width:64px;height:64px;border-radius:6px;background:color-mix(in srgb,var(--accent,var(--pl-accent,#29489A)) 14%,var(--card,#fff));color:var(--accent,var(--pl-accent,#29489A));display:grid;place-items:center;overflow:hidden}.of-art img{width:100%;height:100%;object-fit:cover}.of-art svg{width:100%;height:auto}.of-art svg[width]{width:28px;height:28px}
  .of-b{min-width:0}.of-k{display:block;font:600 13px var(--body,"IBM Plex Sans"),system-ui,sans-serif;color:var(--soft,var(--pl-soft,#444845));margin:0 0 2px}.of-b b{display:block;font:600 18px/1.25 var(--head,var(--pl-font-text,"IBM Plex Sans")),system-ui,sans-serif;overflow-wrap:anywhere}.of-b p{margin:2px 0 0;font-size:14px;color:var(--soft,var(--pl-soft,#444845))}
  .of-go{grid-column:1/-1;justify-self:start;min-height:44px;padding:0 20px;border-radius:6px;white-space:nowrap;background:var(--accent,var(--pl-accent,#29489A));color:var(--on-brand,#fff);border:0;font:600 16px var(--head,var(--pl-font-text,"IBM Plex Sans")),system-ui,sans-serif;cursor:pointer;display:inline-flex;align-items:center;text-decoration:none}
  @media (min-width:700px){.of-row{grid-template-columns:72px minmax(0,1fr) auto}.of-art{width:72px;height:72px}.of-go{grid-column:auto;justify-self:end}}
  .of-own{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px;padding:12px;border:1.5px dashed var(--line,var(--pl-line,#CFC8B9));border-radius:6px}.of-own small{flex-basis:100%;color:var(--soft,var(--pl-soft,#444845));font-size:13px}
  .of-own button{min-height:44px;padding:0 16px;border-radius:6px;border:1.5px solid var(--pl-line,#CFC8B9);background:#fff;color:var(--pl-ink,#1B1D1C);font:600 14px "IBM Plex Sans",system-ui,sans-serif;cursor:pointer;display:inline-flex;align-items:center;gap:6px}.of-own button.pri{background:var(--pl-accent,#29489A);border-color:var(--pl-accent,#29489A);color:#fff}
  .of-empty{padding:16px;border:1.5px solid var(--line,var(--pl-line,#CFC8B9));border-radius:6px;color:var(--soft,var(--pl-soft,#444845))}`;
  const css = () => { if ($("#dp-css")) return; const s = document.createElement("style"); s.id = "dp-css"; s.textContent = CSS; document.head.appendChild(s); };

  function sheet({ title, sub = "", step = 0, of = 0, stepName = "", body, foot = "", label }) { css(); $("#dpSheet")?.remove();
    const bg = document.createElement("div"); bg.className = "dp-bg"; bg.id = "dpSheet";
    bg.innerHTML = `<div class="dp-sheet" role="dialog" aria-modal="true" aria-label="${esc(label || title)}"><div class="dp-hd"><div style="flex:1;min-width:0">${of ? `<p class="dp-step">Step ${step} of ${of} · ${esc(stepName)}</p><div class="dp-bar" aria-hidden="true">${Array.from({ length: of }, (_, i) => `<i class="${i < step ? "on" : ""}"></i>`).join("")}</div>` : ""}<h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}</div><button type="button" class="dp-x" aria-label="Close">${I.x}</button></div><div class="dp-body">${body}</div>${foot ? `<div class="dp-ft">${foot}</div>` : ""}</div>`;
    document.body.appendChild(bg); const prev = document.activeElement; document.documentElement.style.overflow = "hidden";
    const close = () => { bg.remove(); document.documentElement.style.overflow = ""; document.removeEventListener("keydown", key); try { prev?.focus?.(); } catch {} }, key = (e) => { if (e.key === "Escape" && bg.isConnected) close(); };
    document.addEventListener("keydown", key); $(".dp-x", bg).onclick = close; bg.addEventListener("mousedown", (e) => { if (e.target === bg) close(); });
    setTimeout(() => { if (matchMedia("(pointer:fine)").matches) $(".dp-x", bg)?.focus({ preventScroll: true }); else $(".dp-sheet", bg)?.setAttribute("tabindex", "-1"), $(".dp-sheet", bg)?.focus({ preventScroll: true }); }, 30); return { bg, close, body: $(".dp-body", bg) }; }

  // ---- pickup windows: "Sat 9 to 10am", the way the brand writes times ----
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const TIMES = (() => { const T = []; for (let m = 6 * 60; m <= 22 * 60; m += 30) T.push(m); return T; })();
  const hm = (m) => { const h = Math.floor(m / 60), mm = m % 60; return { h12: h % 12 || 12, mm, ap: h < 12 ? "am" : "pm" }; };
  const tLabel = (m, ap = true) => { const t = hm(m); return `${t.h12}${t.mm ? ":" + String(t.mm).padStart(2, "0") : ""}${ap ? t.ap : ""}`; };
  const windowLabel = (day, a, b) => { const A = hm(a), B = hm(b); return `${day ? day + " " : ""}${tLabel(a, A.ap !== B.ap)} to ${tLabel(b)}`; };

  const drawn = (name, fallback, tint) => { try { const E = window.EventArt; const k = E?.kindsOf?.({ title: String(name || "") })[0]; return k ? E.drawing(k, tint || "#29489A") : fallback; } catch { return fallback; } };
  // ---- what guests see: the same card the preview, the live screen and the page use ----
  function dropCard(d, { button = true } = {}) { const items = (d.items || []).filter((x) => x.name);
    const when = d.always ? (d.slots || []).length ? `Pick up ${d.slots.slice(0, 2).join(" or ")}` : "Pick up any week" : d.date ? `Pick up ${new Date(d.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}` : "";
    return `<div class="dp-card"><h3>${esc(d.title || (items[0] ? (items.length > 1 ? `${items[0].name} and more` : items[0].name) : "Your drop"))}</h3>
      <p class="dp-sub">${when ? `<span>${esc(when)}</span>` : ""}${d.area ? `<span>${I.pin} ${esc(d.area)}</span>` : ""}</p>${d.note ? `<p style="margin:8px 0 0">${esc(d.note)}</p>` : ""}
      ${items.length ? items.map((x) => `<div class="dp-mi">${x.photo ? `<img class="art" src="${esc(x.photo)}" alt="">` : `<span class="art">${drawn(x.name, I.bag)}</span>`}<span><b>${esc(x.name)}</b>${+x.stock ? `<small>${x.stock} this batch</small>` : ""}</span><span class="pr">${priceIn(x.price) ? esc(money(priceIn(x.price))) : `<small>Add a price</small>`}</span></div>`).join("") : `<p class="dp-help" style="margin:10px 0 0">Your items show here.</p>`}
      ${(d.slots || []).length > 2 ? `<div class="dp-slots" aria-label="Pickup times">${d.slots.map((s) => `<span>${esc(s)}</span>`).join("")}</div>` : ""}
      ${button ? `<div class="dp-fake" aria-hidden="true">Order</div>` : ""}<p class="dp-help" style="margin:8px 0 0">${d.pay === "link" ? "They pay with your link after ordering." : "They pay at pickup."}${d.address ? " The exact address shows once they order." : ""}</p></div>`; }

  // ================= the drop setup: 3 short steps with Potto =================
  const HOW = `<details class="dp-how"><summary>How drops work</summary><ul><li>You list what you're making, each with a price.</li><li>People order ahead and pick a pickup time. You see every order in Orders.</li><li>They get the exact address once they order. Everyone else sees the neighborhood.</li></ul></details>`;
  async function setup(opts = {}) {
    let D; const edit = !!opts.drop;
    if (edit) D = JSON.parse(JSON.stringify(opts.drop));
    else { let L = null; try { L = (await api("/api/host/drops")).legacy; } catch {}
      // a shop set up before drops (never converted: no priced item yet) prefills what the host already typed
      D = { title: L?.title || "", note: L?.note || "", items: (L?.items || []).length ? L.items.map((x) => ({ ...x, price: x.price ? String(x.price) : "" })) : [{ name: "", price: "", stock: "", photo: "" }, { name: "", price: "", stock: "", photo: "" }], slots: L?.slots || [], area: L?.area || "", address: L?.address || "", always: true, date: "", pay: L?.payUrl ? "link" : "pickup", payUrl: L?.payUrl || "", open: true, ...(opts.prefill || {}) }; }
    D.items = (D.items || []).map((x) => ({ ...x, price: x.price ? String(x.price) : "", stock: +x.stock ? String(x.stock) : "" }));
    let step = 1, S;
    const pull = () => { if (!S) return; const b = S.body;
      if (step === 1) { D.title = $("#dpTitle", b)?.value.trim() ?? D.title; D.items = $$(".dp-item", b).map((el, i) => ({ ...D.items[i], name: $("[data-n]", el).value.trim(), price: $("[data-p]", el).value.trim(), stock: $("[data-s]", el).value.trim() })); }
      if (step === 2) { D.area = $("#dpArea", b).value.trim(); D.address = $("#dpAddr", b).value.trim(); D.always = $("input[name=dpWhen]:checked", b)?.value !== "day"; D.date = $("#dpDate", b)?.value || ""; D.orderBy = $("#dpBy", b)?.value.trim() || ""; }
      if (step === 3) { D.pay = $("input[name=dpPay]:checked", b)?.value || "pickup"; D.payUrl = $("#dpPayUrl", b)?.value.trim() || ""; D.note = $("#dpNote", b)?.value.trim() ?? D.note; } };
    const err = (t, el) => { const e = $("#dpErr", S.bg); if (e) e.textContent = t; if (el) { el.setAttribute("aria-invalid", "true"); el.focus(); } return false; };
    const check = () => { pull(); $$("[aria-invalid]", S.bg).forEach((x) => x.removeAttribute("aria-invalid"));
      if (step === 1) { const rows = $$(".dp-item", S.body), filled = D.items.map((x, i) => [x, rows[i]]).filter(([x]) => x.name || x.price);
        if (!filled.length) return err("Add at least one thing you're making.", $("[data-n]", rows[0]));
        for (const [x, el] of filled) { if (!x.name) return err("Give this item a name.", $("[data-n]", el)); if (!priceIn(x.price)) return err(x.price ? `Check the price for ${x.name}. Use a number like 12 or 12.50.` : `Add a price for ${x.name}.`, $("[data-p]", el)); } }
      if (step === 2 && !D.slots.length && $("#dpFrom", S.body)) { const a = +$("#dpFrom", S.body).value, z = +$("#dpTo", S.body).value; if (z > a) D.slots.push(windowLabel(D.always ? $("#dpDay", S.body)?.value : "", a, z)); }
      if (step === 2) { if (!D.slots.length) return err("Add at least one pickup time. Pick a day and times, then tap Add.", $("#dpFrom", S.body)); if (!D.area) return err("Add the neighborhood people see.", $("#dpArea", S.body)); if (!D.always && !D.date) return err("Pick the pickup day.", $("#dpDate", S.body)); }
      if (step === 3) { if (D.pay === "link" && !/^https:\/\/\S{3,}/i.test(D.payUrl)) return err("Pay links start with https://. Or pick Pay at pickup.", $("#dpPayUrl", S.body)); }
      return true; };
    const preview = () => `<div class="dp-pv" aria-live="polite"><small>What guests see</small>${dropCard({ ...D, items: D.items.filter((x) => x.name || x.price) })}</div>`;
    const refreshPv = () => { pull(); const p = $(".dp-pv", S.body); if (p) p.outerHTML = preview(); };
    const STEPS = { 1: "What you're selling", 2: "Pickup", 3: "How people pay" };
    function draw() { const foot = `<p class="dp-msg" id="dpErr" role="alert"></p>${step > 1 ? `<button type="button" class="dp-b" id="dpBack">${I.back}<span>Back</span></button>` : ""}${edit && step < 3 ? `<button type="button" class="dp-b" id="dpSaveNow">Save</button>` : ""}<button type="button" class="dp-b pri" id="dpNext">${step < 3 ? "Next" : edit ? "Save changes" : "Open orders"}</button>`;
      let body = "";
      if (step === 1) body = `<div class="dp-potto">${potto("happy", 48)}<p>${edit ? "Change what you're selling. Prices are what guests pay." : "What are you making this batch? Give each one a price. I'll do the rest."}</p></div>${HOW}
        ${D.items.map((x, i) => `<div class="dp-item" data-i="${i}"><div class="dp-ihd"><b>Item ${i + 1}</b>${D.items.length > 1 ? `<button type="button" class="dp-b sm q" data-rm="${i}" aria-label="Remove item ${i + 1}">${I.trash}<span>Remove</span></button>` : ""}</div>
          <label class="dp-f"><span>Name</span><input data-n value="${esc(x.name)}" maxlength="60" placeholder="${["Pandan honeycomb cake", "Kaya toast box"][i] || "Another thing you make"}" autocomplete="off"></label>
          <div class="dp-row"><label class="dp-f"><span>Price</span><span class="dp-money"><b aria-hidden="true">$</b><input data-p value="${esc(x.price)}" inputmode="decimal" placeholder="${["18", "9.50"][i] || "12"}" aria-label="Price in dollars" autocomplete="off"></span></label>
          <label class="dp-f"><span>How many this batch <small>(optional)</small></span><input data-s value="${esc(x.stock)}" inputmode="numeric" placeholder="No limit" autocomplete="off"></label></div>
          <div class="dp-photo">${x.photo ? `<img src="${esc(x.photo)}" alt="">` : ""}<label class="dp-b sm">${I.camera}<span>${x.photo ? "Change photo" : "Add a photo"}</span><input type="file" accept="image/png,image/jpeg,image/webp" data-ph="${i}" class="dp-vh"></label><small class="dp-help">Optional</small></div></div>`).join("")}
        ${D.items.length < 12 ? `<button type="button" class="dp-b" id="dpAdd">${I.plus}<span>Add another item</span></button>` : ""}
        <label class="dp-f" style="margin-top:16px"><span>Name this drop <small>(optional)</small></span><input id="dpTitle" value="${esc(D.title)}" maxlength="80" placeholder="Pandan this Saturday"></label>${preview()}`;
      if (step === 2) { const day = !D.always;
        body = `<div class="dp-potto">${potto("happy", 48)}<p>When and where do people pick up? I keep your exact address private until they order.</p></div>
        <fieldset class="dp-f" style="border:0;padding:0"><legend>When</legend><div class="dp-opts" style="margin:0"><label class="dp-opt"><input type="radio" name="dpWhen" value="always" ${day ? "" : "checked"}><span class="ic">${I.repeat}</span><span><b>Always available</b><small>The same pickup times every week, like Sat 9 to 10am.</small></span></label><label class="dp-opt"><input type="radio" name="dpWhen" value="day" ${day ? "checked" : ""}><span class="ic">${I.cal}</span><span><b>One day</b><small>A single batch on a date you pick.</small></span></label></div></fieldset>
        ${day ? `<label class="dp-f"><span>Pickup day</span><input id="dpDate" type="date" value="${esc(D.date)}" min="${new Date().toISOString().slice(0, 10)}"></label>` : ""}
        <div class="dp-f"><span class="dp-lab">Pickup times</span><small>Pick ${day ? "a time" : "a day and time"}, then tap Add. Add as many as you like.</small>
          <div class="dp-pick${day ? " noday" : ""}">${day ? "" : `<label class="dp-f"><span class="dp-help">Day</span><select id="dpDay">${DAYS.map((x) => `<option${x === "Sat" ? " selected" : ""}>${x}</option>`).join("")}</select></label>`}
          <label class="dp-f"><span class="dp-help">From</span><select id="dpFrom">${TIMES.map((m) => `<option value="${m}"${m === 540 ? " selected" : ""}>${tLabel(m)}</option>`).join("")}</select></label>
          <label class="dp-f"><span class="dp-help">To</span><select id="dpTo">${TIMES.map((m) => `<option value="${m}"${m === 600 ? " selected" : ""}>${tLabel(m)}</option>`).join("")}</select></label>
          <button type="button" class="dp-b" id="dpAddSlot">${I.plus}<span>Add</span></button></div>
          <div class="dp-chips" id="dpSlots">${D.slots.map((s, i) => `<span class="dp-chip">${esc(s)}<button type="button" data-rs="${i}" aria-label="Remove ${esc(s)}">${I.x}</button></span>`).join("") || `<small class="dp-help">No pickup times yet.</small>`}</div></div>
        <label class="dp-f"><span>Neighborhood people see</span><input id="dpArea" value="${esc(D.area)}" maxlength="80" placeholder="Midtown" autocomplete="off"><small>Shown on your page and the drop.</small></label>
        <label class="dp-f"><span>${I.lock} Exact address, shown after they order <small>(optional)</small></span><input id="dpAddr" value="${esc(D.address)}" maxlength="160" placeholder="777 6th Ave, Apt 15J" autocomplete="off"><small>Only people who ordered see it, on their order and in their email.</small></label>
        <label class="dp-f"><span>Orders close <small>(optional)</small></span><input id="dpBy" value="${esc(D.orderBy || "")}" maxlength="40" placeholder="Thu 8pm"></label>${preview()}`; }
      if (step === 3) body = `<div class="dp-potto">${potto("happy", 48)}<p>Last one. How do people pay you?</p></div>
        <div class="dp-opts" role="radiogroup" aria-label="How people pay"><label class="dp-opt"><input type="radio" name="dpPay" value="pickup" ${D.pay !== "link" ? "checked" : ""}><span class="ic">${I.bag}</span><span><b>Pay at pickup</b><small>Cash or a tap when they collect.</small></span></label><label class="dp-opt"><input type="radio" name="dpPay" value="link" ${D.pay === "link" ? "checked" : ""}><span class="ic">${I.share}</span><span><b>A pay link</b><small>Venmo, PayPal.me, Cash App or Stripe. The amount fills in for them.</small></span></label></div>
        <label class="dp-f" id="dpPayL" ${D.pay === "link" ? "" : "hidden"}><span>Your pay link</span><input id="dpPayUrl" type="url" inputmode="url" value="${esc(D.payUrl)}" placeholder="https://venmo.com/u/yourname" autocomplete="off"></label>
        <label class="dp-f"><span>A line about it <small>(optional)</small></span><textarea id="dpNote" rows="2" maxlength="240" placeholder="Baked Saturday morning. Contains egg and coconut.">${esc(D.note)}</textarea></label>${preview()}`;
      S = sheet({ title: edit ? "Edit your drop" : ({ 1: "Set up a drop", 2: "When and where do they pick up?", 3: "How do people pay?" })[step], sub: step === 1 && !edit ? "Order ahead, pick up at a set time." : "", step, of: 3, stepName: STEPS[step], body, foot, label: "Set up a drop" });
      const b = S.body; b.addEventListener("input", (e) => { e.target.removeAttribute?.("aria-invalid"); const er = $("#dpErr", S.bg); if (er) er.textContent = ""; clearTimeout(draw.t); draw.t = setTimeout(refreshPv, 150); }); b.addEventListener("change", refreshPv);
      $("#dpAdd", b) && ($("#dpAdd", b).onclick = () => { pull(); D.items.push({ name: "", price: "", stock: "", photo: "" }); draw(); setTimeout(() => $$("[data-n]", S.body).pop()?.focus(), 50); });
      $$("[data-rm]", b).forEach((x) => (x.onclick = () => { pull(); D.items.splice(+x.dataset.rm, 1); draw(); }));
      $$("[data-ph]", b).forEach((inp) => (inp.onchange = async () => { const f = inp.files[0]; if (!f) return; pull(); if (f.size > 8e6) { err("That photo is over 8 MB. Pick a smaller one."); return; } toast("Adding the photo…");
        try { const r = await fetch("/api/assets", { method: "POST", headers: { "Content-Type": f.type || "image/jpeg" }, body: f }); const j = await r.json(); if (!r.ok) throw new Error(j.message); D.items[+inp.dataset.ph].photo = j.url; draw(); toast("Photo added."); } catch (e) { err(e.message || "That photo didn't upload. Try again."); } }));
      $$("input[name=dpWhen]", b).forEach((r) => (r.onchange = () => { pull(); D.always = r.value !== "day"; draw(); }));
      $$("input[name=dpPay]", b).forEach((r) => (r.onchange = () => { $("#dpPayL", b).hidden = r.value !== "link" || !r.checked; if (r.value === "link" && r.checked) $("#dpPayUrl", b).focus(); }));
      $("#dpAddSlot", b) && ($("#dpAddSlot", b).onclick = () => { pull(); const a = +$("#dpFrom", b).value, z = +$("#dpTo", b).value; if (z <= a) { err("The end time comes after the start.", $("#dpTo", b)); return; }
        const l = windowLabel(D.always ? $("#dpDay", b)?.value : "", a, z); if (!D.slots.includes(l)) D.slots.push(l); draw(); });
      $$("[data-rs]", b).forEach((x) => (x.onclick = () => { pull(); D.slots.splice(+x.dataset.rs, 1); draw(); }));
      $("#dpBack", S.bg) && ($("#dpBack", S.bg).onclick = () => { pull(); step--; draw(); });
      const save = async (btn) => { btn.disabled = true; const t0 = btn.textContent; btn.textContent = "Saving…";
        const body0 = { ...D, items: D.items.filter((x) => x.name || x.price).map((x) => ({ ...x, price: priceIn(x.price), stock: +x.stock || 0 })) };
        try { const j = await api(edit ? "/api/host/drops/" + encodeURIComponent(D.id) : "/api/host/drops", body0); try { window.EncoreCommunity?.oink?.(); } catch {}
          S.close(); if (edit) { toast(`Saved. ${body0.items.length} item${body0.items.length === 1 ? "" : "s"}, ${body0.slots.length} pickup time${body0.slots.length === 1 ? "" : "s"}. Guests see it now.`); opts.onDone?.(j); }
          else live(j, body0, opts.onDone); }
        catch (e) { btn.disabled = false; btn.textContent = t0; err(e.message); } };
      $("#dpSaveNow", S.bg) && ($("#dpSaveNow", S.bg).onclick = (e) => { if (!check()) return; save(e.currentTarget); });
      $("#dpNext", S.bg).onclick = (e) => { if (!check()) return; if (step < 3) { step++; draw(); return; } save(e.currentTarget); }; }
    draw(); }

  // the moment it's live: the card guests see, the link, Share
  function live(j, d, onDone) { const url = j.url || location.origin + j.path;
    const S = sheet({ title: "Your drop is live", label: "Your drop is live", body: `<div class="dp-live">${potto("happy", 72)}<p style="margin:4px 0 0">People can order now. Every order lands in Orders.</p></div>
      <div class="dp-link">${I.share}<span>${esc(url.replace(/^https?:\/\//, ""))}</span><button type="button" class="dp-b sm" id="dpCopy">${I.copy}<span>Copy</span></button></div><div class="dp-pv"><small>What guests see</small>${dropCard({ ...d, id: j.id })}</div>`,
      foot: `<a class="dp-b" href="${esc(j.path)}" target="_blank" rel="noopener">${I.eye}<span>See it as a guest</span></a><button type="button" class="dp-b pri" id="dpShare">${I.share}<span>Share</span></button>` });
    $("#dpCopy", S.bg).onclick = () => copy(url, "Link copied. Paste it in your group chat.");
    $("#dpShare", S.bg).onclick = async () => { if (navigator.share) { try { await navigator.share({ title: d.title || "My drop", text: `${d.title || "My drop"}: order ahead, pick up ${(d.slots || [])[0] || "soon"}.`, url }); return; } catch {} } copy(url, "Link copied. Paste it in your group chat."); };
    $(".dp-x", S.bg).addEventListener("click", () => onDone?.(j)); }

  // ================= one drop: taking orders, new batch, edit, share =================
  async function manage(d, onDone) { const url = location.origin + d.path, b = d.batch || {};
    const S = sheet({ title: d.title, sub: `${d.always ? "Always available" : d.date ? "One day" : ""}${(d.slots || []).length ? " · " + d.slots.join(", ") : ""}`, body: `
      <label class="dp-sw"><span><b>Taking orders</b><small>${d.open ? "On. People can order from your page and the link." : "Off. The drop stays on your page, and orders are paused."}</small></span><input type="checkbox" role="switch" id="dpOpen" ${d.open ? "checked" : ""}><i aria-hidden="true"></i></label>
      <p class="dp-tally">This batch: <b>${b.orders || 0}</b> order${b.orders === 1 ? "" : "s"}, ${b.items || 0} item${b.items === 1 ? "" : "s"}, ${esc(b.total || "$0")}</p>
      <div class="dp-acts"><button type="button" class="dp-act" data-a="orders"><span class="ic">${I.list}</span><span><b>See orders</b><small>Who ordered what, by pickup time.</small></span>${I.chev}</button>
      <button type="button" class="dp-act" data-a="batch"><span class="ic">${I.repeat}</span><span><b>Start a new batch</b><small>${d.always ? "Clears this week's counts and keeps your items." : "Makes the same drop a week later, with fresh counts."}</small></span>${I.chev}</button>
      <button type="button" class="dp-act" data-a="edit"><span class="ic">${I.edit}</span><span><b>Edit items, pickup or pay</b><small>${(d.items || []).map((x) => `${x.name} ${money(x.price)}`).join(", ")}</small></span>${I.chev}</button>
      <a class="dp-act" href="${esc(d.path)}" target="_blank" rel="noopener"><span class="ic">${I.eye}</span><span><b>See it as a guest</b><small>${esc(url.replace(/^https?:\/\//, ""))}</small></span>${I.chev}</a>
      <button type="button" class="dp-act" data-a="copy"><span class="ic">${I.copy}</span><span><b>Copy the link</b><small>Share it in your group chat or bio.</small></span>${I.chev}</button></div>` });
    $("#dpOpen", S.bg).onchange = async (e) => { const on = e.target.checked; try { await api("/api/host/drops/" + encodeURIComponent(d.id), { open: on }); d.open = on; e.target.closest(".dp-sw").querySelector("small").textContent = on ? "On. People can order from your page and the link." : "Off. The drop stays on your page, and orders are paused."; toast(on ? "Taking orders." : "Orders paused."); onDone?.(); } catch (er) { e.target.checked = !on; toast(er.message); } };
    $$("[data-a]", S.bg).forEach((x) => (x.onclick = async () => { const a = x.dataset.a;
      if (a === "orders") { S.close(); inbox({ only: d.id }); }
      if (a === "edit") { S.close(); setup({ drop: d, onDone }); }
      if (a === "copy") copy(url, "Link copied.");
      if (a === "batch") { const C2 = sheet({ title: "Start a new batch?", body: `<p style="margin:0 0 12px">${d.always ? "This week's counts go back to zero, so everything is on sale again. Your items, prices and pickup times stay. Orders so far stay in Orders." : "I'll make the same drop for a week later, with fresh counts. This one stays as it is."}</p><label class="dp-sw"><span><b>Tell my followers</b><small>One note that a new batch is open.</small></span><input type="checkbox" role="switch" id="dpTell" checked><i aria-hidden="true"></i></label>`,
          foot: `<button type="button" class="dp-b" id="dpNo">Not now</button><button type="button" class="dp-b pri" id="dpYes">Start new batch</button>` });
        $("#dpNo", C2.bg).onclick = C2.close; $("#dpYes", C2.bg).onclick = async (ev) => { ev.currentTarget.disabled = true; try { const j = await api(`/api/host/drops/${encodeURIComponent(d.id)}/new-batch`, { tell: $("#dpTell", C2.bg).checked }); C2.close(); toast(`New batch open.${j.told ? ` ${j.told} follower${j.told === 1 ? "" : "s"} told.` : ""}`); onDone?.(); } catch (e) { ev.currentTarget.disabled = false; toast(e.message); } }; } })); }

  // ================= one Orders inbox for every drop (and the old shop's orders) =================
  const ST = [["new", "New"], ["paid", "Paid"], ["ready", "Ready"], ["picked", "Picked up"], ["cancelled", "Cancelled"]];
  async function inbox(o = {}) { const S = sheet({ title: "Orders", sub: "Every drop, grouped by pickup time.", body: `<p class="dp-help">Loading orders…</p>` });
    let L = [], D = []; try { [L, D] = await Promise.all([api("/api/host/orders").then((j) => j.orders || []), api("/api/host/drops").then((j) => j.drops || [])]); } catch (e) { S.body.innerHTML = `<p class="dp-err">${esc(e.message)}</p>`; return; }
    const show = (all) => { const cur = L.filter((x) => x.current && (!o.only || x.eventId === o.only)), old = L.filter((x) => !x.current && (!o.only || x.eventId === o.only));
      if (!cur.length && !old.length) { const d0 = D.find((x) => x.id === o.only) || D[0];
        S.body.innerHTML = `<div class="dp-empty">${potto("sleep", 72)}<p><b>No orders yet.</b> Share your drop link.</p>${d0 ? `<button type="button" class="dp-b pri" id="dpCp">${I.copy}<span>Copy the link</span></button>` : `<button type="button" class="dp-b pri" id="dpNew">Set up a drop</button>`}</div>${HOW}`;
        $("#dpCp", S.bg) && ($("#dpCp", S.bg).onclick = () => copy(d0.url, "Link copied. Paste it in your group chat.")); $("#dpNew", S.bg) && ($("#dpNew", S.bg).onclick = () => { S.close(); setup({ onDone: o.onDone }); }); return; }
      const byDrop = new Map(); for (const x of cur) { const k = x.eventId || "shop"; if (!byDrop.has(k)) byDrop.set(k, []); byDrop.get(k).push(x); }
      const row = (x) => `<div class="dp-ord ${esc(x.status)}"><div><b>${esc(x.name || "Someone")}</b> <small>#${esc(x.code || "")}${x.slot ? ` · ${esc(x.slot)}` : ""}</small><small>${x.lines.map((l) => `${l.qty} × ${esc(l.name)}`).join(", ")}</small><small>${[x.phone, x.email].filter(Boolean).map(esc).join(" · ")}</small></div><div class="tot">${esc(x.totalText)}</div>
        <div class="st" role="group" aria-label="Order status">${ST.map(([k, l]) => `<button type="button" data-os="${esc(x.id)}" data-src="${esc(x.src || "shop")}" data-v="${k}" aria-pressed="${x.status === k}">${l}</button>`).join("")}</div></div>`;
      S.body.innerHTML = [...byDrop.entries()].map(([k, os]) => { const tally = {}; os.filter((x) => x.status !== "cancelled").forEach((x) => x.lines.forEach((l) => (tally[l.name] = (tally[l.name] || 0) + l.qty))); const live = os.filter((x) => x.status !== "cancelled");
        const slots = [...new Set(os.map((x) => x.slot || "No pickup time"))];
        return `<section class="dp-grp"><h3>${esc(os[0].drop || "Your drop")}</h3><p class="dp-tally">This batch: ${live.length} order${live.length === 1 ? "" : "s"} · ${esc("$" + (live.reduce((a, x) => a + x.total, 0) / 100).toFixed(live.some((x) => x.total % 100) ? 2 : 0))}. To make: ${Object.entries(tally).map(([n, q]) => `${q} ${esc(n)}`).join(", ") || "nothing yet"}.</p>
          ${slots.map((sl) => { const so = os.filter((x) => (x.slot || "No pickup time") === sl), ph = so.filter((x) => x.phone && !["picked", "cancelled"].includes(x.status)).map((x) => x.phone.replace(/[^\d+]/g, "")); return `<div class="dp-win"><b>${esc(sl)} · ${so.length}</b>${ph.length ? `<a class="dp-b sm" href="sms:${/iPhone|iPad/.test(navigator.userAgent) ? "/open?addresses=" + ph.join(",") + "&" : ph.join(",") + "?"}body=${encodeURIComponent(`Your order is ready for pickup${sl !== "No pickup time" ? " " + sl : ""}.`)}">Text them it's ready</a>` : ""}</div>${so.map(row).join("")}`; }).join("")}</section>`; }).join("") || `<div class="dp-empty"><p><b>No orders this batch yet.</b> Share your drop link.</p></div>`;
      if (old.length) S.body.insertAdjacentHTML("beforeend", `<details class="dp-how"><summary>Earlier orders · ${old.length}</summary><div style="padding:0 12px 12px">${old.slice(0, 100).map(row).join("")}</div></details>`);
      $$("[data-os]", S.body).forEach((b) => (b.onclick = async () => { const x = L.find((y) => y.id === b.dataset.os); try { await api((b.dataset.src === "drop" ? "/api/host/drop-orders/" : "/api/host/orders/") + encodeURIComponent(b.dataset.os), { status: b.dataset.v }); x.status = b.dataset.v; show(); } catch (e) { toast(e.message); } })); };
    show(); }

  // ================= something to book (a team or group experience) =================
  function bookable(o = {}) { const X = o.exp || { name: "", price: "", min: 8, max: 20, length: "", includes: [] };
    const pp = (p) => String(p || "").replace(/[^0-9.]/g, "");
    const line = (x) => [priceIn(x.price) ? `From ${money(priceIn(x.price))} a person` : "", x.min && x.max ? `${x.min} to ${x.max} guests` : "", x.length].filter(Boolean).join(" · ");
    const S = sheet({ title: o.exp ? "Edit what teams can book" : "Something to book", sub: "Teams and groups request a date. You quote, or pass.", body: `
      <div class="dp-potto">${potto("happy", 48)}<p>Say what you'd run for a group, and the price a person. Nothing is booked until you both agree.</p></div>
      <details class="dp-how"><summary>How requests work</summary><ul><li>They pick a date and how many people, then send a request.</li><li>You reply with a quote, or pass. You can ask questions first.</li><li>Once they accept, they pay a 50% deposit to confirm.</li></ul></details>
      <label class="dp-f"><span>What it is</span><input id="bkName" value="${esc(X.name)}" maxlength="70" placeholder="Pottery class for your team"></label>
      <div class="dp-row"><label class="dp-f"><span>Price a person</span><span class="dp-money"><b aria-hidden="true">$</b><input id="bkPrice" value="${esc(pp(X.price))}" inputmode="decimal" placeholder="55" aria-label="Price a person in dollars"></span></label><label class="dp-f"><span>How long</span><input id="bkLen" value="${esc(X.length || "")}" maxlength="40" placeholder="2 hours"></label></div>
      <div class="dp-row" style="margin-top:16px"><label class="dp-f"><span>Fewest guests</span><input id="bkMin" value="${esc(X.min || 8)}" inputmode="numeric"></label><label class="dp-f"><span>Most guests</span><input id="bkMax" value="${esc(X.max || 20)}" inputmode="numeric"></label></div>
      <label class="dp-f" style="margin-top:16px"><span>What's included <small>(optional, one per line)</small></span><textarea id="bkInc" rows="3" placeholder="Clay and glazes&#10;Firing, ready in 2 weeks">${esc((X.includes || []).join("\n"))}</textarea></label>
      <div class="dp-pv"><small>What teams see</small><div class="dp-card" id="bkPv"></div></div>`,
      foot: `<p class="dp-msg" id="dpErr" role="alert"></p><button type="button" class="dp-b pri" id="bkSave">${o.exp ? "Save changes" : "Add it to my page"}</button>` });
    const v = () => ({ name: $("#bkName", S.bg).value.trim(), price: $("#bkPrice", S.bg).value.trim(), length: $("#bkLen", S.bg).value.trim(), min: Math.max(1, +$("#bkMin", S.bg).value || 1), max: Math.max(1, +$("#bkMax", S.bg).value || 1), includes: $("#bkInc", S.bg).value.split("\n").map((x) => x.trim()).filter(Boolean) });
    const pv = () => { const x = v(); $("#bkPv", S.bg).innerHTML = `<h3>${esc(x.name || "Your experience")}</h3><p class="dp-sub">${esc(line(x) || "Add a price a person")}</p>${x.includes.length ? `<p style="margin:8px 0 0;font-size:14px">Includes: ${x.includes.map(esc).join(" · ")}</p>` : ""}<div class="dp-fake" aria-hidden="true">Request a date</div><p class="dp-help" style="margin:8px 0 0">They pick a date and headcount. You reply with a quote.</p>`; };
    S.body.addEventListener("input", () => { $("#dpErr", S.bg).textContent = ""; pv(); }); pv();
    $("#bkSave", S.bg).onclick = async (e) => { const x = v(), er = (t, id) => { $("#dpErr", S.bg).textContent = t; $(id, S.bg)?.focus(); };
      if (!x.name) return er("Say what it is.", "#bkName"); if (!priceIn(x.price)) return er("Add a price a person, like 55.", "#bkPrice"); if (x.max < x.min) return er("Most guests is at least the fewest.", "#bkMax");
      e.currentTarget.disabled = true; try { const me = (await api("/api/host/profile")).host || {}; const L = [...(me.experiences || [])]; const row = { ...(o.exp || {}), ...x, price: `${priceIn(x.price)}` };
        if (o.exp) { const i = L.findIndex((y) => y.id === o.exp.id); if (i >= 0) L[i] = row; else L.push(row); } else L.push(row);
        await api("/api/host/profile", { experiences: L, forHire: true }); S.close(); toast(`Added. Teams see "${x.name}, ${line(x)}" with Request a date.`); o.onDone?.(); }
      catch (er2) { e.currentTarget.disabled = false; er(er2.message); } }; }

  // ================= "What are you making?" =================
  const KINDS = [["event", I.cal, "An event", "Pick a date. Guests tap I'm in.", "Dumpling night, Sat 7pm"],
    ["drop", I.bag, "A drop", "People order ahead, then pick up.", "Pandan cake, pick up Sat 9am"],
    ["book", I.people, "Something to book", "Teams ask for a date. You quote.", "Pottery class, $55 a person"]];
  function choose(o = {}) { try { const k = new URLSearchParams(location.search).get("kind"); if (k && k !== "drop" && o.event) return o.event(); } catch {} // a guide or the host path already said what: straight to the canvas
    const S = sheet({ title: "What are you making?", label: "What are you making?", body: `<p class="dp-lead">Pick one. You can make the others any time.</p><div class="dp-acts">${KINDS.map(([k, ic, t, s, ex]) => `<button type="button" class="dp-act" data-kind="${k}"><span class="ic">${ic}</span><span><b>${t}</b><small>${s}</small><small>Like: ${esc(ex)}</small></span>${I.chev}</button>`).join("")}</div>` });
    $$("[data-kind]", S.bg).forEach((b) => (b.onclick = () => { S.close(); const k = b.dataset.kind; if (k === "event") (o.event || (() => (location.href = "/?app=1#studio")))(); else if (k === "drop") setup({ onDone: o.onDone }); else bookable({ onDone: o.onDone }); })); }

  // ================= the host page: one "What I offer" section =================
  async function offer(h, first, d, isOwner) { if (!h || h.showcase || $("#offer")) return; css();
    let drops = []; try { drops = (await (await fetch("/api/public/drops/" + encodeURIComponent(h.handle))).json()).drops || []; } catch {}
    let mineD = []; if (isOwner) { try { mineD = (await api("/api/host/drops")).drops || []; } catch {} }
    const ev = (d.upcoming || []).filter((e) => !e.drop && !drops.some((x) => x.id === e.id)), X = h.forHire || h.sample ? h.experiences || [] : [];
    const dayTxt = (x) => x ? new Date(x + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "";
    const rows = [];
    for (const e of ev) rows.push({ k: "Event", art: e.coverPhoto ? `<img src="${esc(e.coverPhoto)}" alt="">` : I.cal, t: e.title || e.name, line: [dayTxt(e.date) + (e.startTime ? " · " + clock(e.startTime) : ""), e.hood || e.city, e.priceLine].filter(Boolean).join(" · "), go: e.private ? "" : `<a class="of-go" href="/e/${encodeURIComponent(e.id)}">${e.preorder ? "Order" : e.approvalRequired ? "Ask to join" : "I'm in"}</a>` });
    for (const x of drops) { const lo = Math.min(...x.items.map((i) => i.price)), out = x.items.every((i) => i.left === 0);
      rows.push({ k: "Order ahead", art: x.items.find((i) => i.photo) ? `<img src="${esc(x.items.find((i) => i.photo).photo)}" alt="">` : drawn(`${x.title} ${x.items.map((i) => i.name).join(" ")}`, I.bag, "currentColor"), t: x.title, line: [x.items.length > 1 ? `From ${money(lo)}` : money(lo), x.slots[0] ? `Pick up ${x.slots[0]}${x.slots.length > 1 ? ` +${x.slots.length - 1} more` : ""}` : x.date ? `Pick up ${dayTxt(x.date)}` : "", x.area].filter(Boolean).join(" · "),
        go: x.paused ? `<span class="of-k" style="grid-column:1/-1">Orders are paused. Follow to hear when they open.</span>` : out ? `<span class="of-k" style="grid-column:1/-1">Sold out this batch.</span>` : `<a class="of-go" href="${esc(x.url)}">Order</a>` }); }
    for (const x of X) { const p = window.EncoreShop?.priceText?.(x.price) || "";
      rows.push({ k: "For teams and groups", art: x.photo ? `<img src="${esc(x.photo)}" alt="">` : drawn(x.name, I.people, "currentColor"), t: x.name, line: [p ? (/^from /i.test(p) ? p : "From " + p) : "To be quoted", x.min > 1 ? `${x.min} to ${x.max} guests` : x.max ? `Up to ${x.max} guests` : "", x.length].filter(Boolean).join(" · "), go: `<button type="button" class="of-go" data-req="${esc(x.id)}">Request a date</button>` }); }
    if (!rows.length && !isOwner) return;
    const sec = document.createElement("section"); sec.className = "offer"; sec.id = "offer"; sec.setAttribute("aria-labelledby", "offerH");
    const own = isOwner ? `<div class="of-own"><small>Only you see this. Guests see the list below.</small><button type="button" class="pri" data-own="new">${I.plus}<span>Add something</span></button><button type="button" data-own="orders">${I.list}<span>Orders${mineD.reduce((a, x) => a + (x.batch?.orders || 0), 0) ? ` (${mineD.reduce((a, x) => a + (x.batch?.orders || 0), 0)})` : ""}</span></button>${mineD.map((x) => `<button type="button" data-drop="${esc(x.id)}">${I.bag}<span>${esc(x.title)}${x.open ? "" : " (paused)"}</span></button>`).join("")}</div>` : "";
    sec.innerHTML = `<h2 class="sec" id="offerH">What ${isOwner ? "you" : esc(first)} offer${isOwner ? "" : "s"}</h2><p class="of-sub">${rows.length ? ((k) => k.length > 1 ? k.slice(0, -1).join(", ") + " and " + k.slice(-1) : k[0])([ev.length && "events to join", drops.length && "things to order ahead", X.length && "experiences to book"].filter(Boolean)).replace(/^./, (c) => c.toUpperCase()) + "." : "Add an event, a drop or something teams can book. It shows here."}</p>${own}
      ${rows.length ? `<div class="of-list">${rows.map((r) => `<div class="of-row"><span class="of-art" aria-hidden="true">${r.art}</span><div class="of-b"><span class="of-k">${esc(r.k)}</span><b>${esc(r.t)}</b>${r.line ? `<p>${esc(r.line)}</p>` : ""}</div>${r.go}</div>`).join("")}</div>` : `<div class="of-empty">Nothing here yet.</div>`}`;
    const at = $(".cols > div") || $("main"); const old = $("h2.sec.s-coming"); if (old) old.before(sec); else at?.prepend(sec);
    // one list: the old "Coming up" grid is folded into this one
    if (ev.length || rows.length) $$(".s-coming").forEach((x) => { x.hidden = true; x.style.display = "none"; });
    $$("[data-req]", sec).forEach((b) => (b.onclick = () => { const bk = $("#book"); if (!bk) { location.href = `/x/${h.handle}/${encodeURIComponent(b.dataset.req)}`; return; } bk.__expand?.(true); bk.__open?.(b.dataset.req); bk.scrollIntoView({ behavior: "smooth", block: "start" }); }));
    const redraw = () => { sec.remove(); offer(h, first, d, isOwner); };
    $$("[data-own]", sec).forEach((b) => (b.onclick = () => b.dataset.own === "new" ? choose({ onDone: redraw }) : inbox({ onDone: redraw })));
    $$("[data-drop]", sec).forEach((b) => (b.onclick = () => manage(mineD.find((x) => x.id === b.dataset.drop), redraw))); }
  const clock = (t) => { const [hh, mm] = String(t).split(":").map(Number); return `${hh % 12 || 12}${mm ? ":" + String(mm).padStart(2, "0") : ""}${hh < 12 ? "am" : "pm"}`; };

  window.EncoreDrop = { setup, live, manage, inbox, bookable, choose, offer, dropCard, windowLabel, KINDS };
})();
