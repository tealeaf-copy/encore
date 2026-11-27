// "Need a hand?": Potto's help sheet, on every page a host uses and on every onboarding step (sign up, sign in,
// forgot password, join, onboard). Potto answers from docs/help.md (POST /api/help/ask), with one-tap actions where the
// step is something the app can do (open the share sheet, copy the invite, open the guest list) through index.html's
// window.__helpDo, and a Did this help? after each answer (POST /api/help/rate). "Talk to a person" sends the team a
// message with the chat, the page, the event and the device attached, so nobody types it twice (POST /api/help/ticket).
// The person's replies come back into the same chat, and a solved conversation asks How did we do?. If someone sits on a
// setup step for a minute without moving on, or sees the same error twice, Potto offers help once per session.
//
// The sheet: a modal dialog. On a phone it comes up from the bottom (max 85dvh, a drag handle, padded for the home
// indicator, lifted over the keyboard with visualViewport); on a computer it floats bottom right. Close always works:
// the X (44px), Esc, tapping the backdrop and swiping down on the handle or header. While it's open the page behind is
// inert and doesn't scroll, Tab stays inside, and focus goes back where it was on close.
//
// Review: the X used to do nothing. `$(".eh-x")` found the nudge's X first (it comes earlier in the template), so the
// close handler went there and was then replaced by the nudge's own; the sheet's X never had one. Each X is now bound
// by its own selector, and a test checks every close path.
// Loaded on the first tap of any Help link by public/report.js (every page, signed in or not: invites, chats, /teams,
// error pages), and by a script tag on the sign-up, sign-in, reset, join and onboard pages (with the floating button).
// Loaded on a tap there's no floating button: the page's own Help link is the way in.
//
// Launch: the first screen fits who you are here. A guest (an invite, Plans, Discover signed out) sees replying,
// changing a reply, the address, the calendar, paying the host and ordering a drop; a host sees creating, sharing,
// guests, getting paid, memberships and drops; a brand (/teams pages, a team workspace) sees booking, the brief,
// approvals, invoices and looking around first. Guest, Host and Brand under the questions switch it. "Talk to a
// person" is always there with the promised reply time, and "My event is today" sends an urgent ticket that texts the
// team (server/help.js). Signed out, the reply comes back here too: the ticket's private key stays on this device.
// A status line the team posted (GET /api/status) shows at the top of the sheet.
(function () {
  if (window.__encoreHelp && window.EncoreHelp && !window.EncoreHelp.lazy) return; window.__encoreHelp = 1;
  const P = location.pathname, signedIn = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  const ONB = /^\/(signup|login|forgot|reset|join|onboard)\/?$/.test(P), PLANS = P === "/plans";
  const GUEST = P === "/g" || /^\/(e|k)\//.test(P) || P === "/demo" || P === "/support" || P === "/sso/start";
  const LAZY = !!window.__ehLazy; // opened from a Help link (public/report.js): for everyone, everywhere
  if (!LAZY && (GUEST || !(ONB || PLANS || signedIn()))) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} } };
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: (k) => { try { localStorage.removeItem(k); } catch {} } };
  const NUDGED = "encore.help.nudged", SEEN = "encore.help.seen", LOG = "encore.help.chat";
  const LINE = "Stuck? I can help, or get you a person.";
  const VASE = '<svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="1.5" width="45" height="45" rx="6"/><path d="M17 11h14M19 11v4l-6 6v9a7 7 0 0 0 7 7h8a7 7 0 0 0 7-7v-9l-6-6v-4"/><circle cx="20.5" cy="26" r="1.9" stroke="none" style="fill:var(--pl-accent,#29489A)"/><circle cx="27.5" cy="26" r="1.9" stroke="none" style="fill:var(--pl-accent,#29489A)"/></svg>';
  // drawn line glyphs in Potto's brown (docs/brand-kit.md, UI tokens), never emoji on buttons
  const G = (d, s = 20) => `<svg viewBox="0 0 20 20" width="${s}" height="${s}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const X_ICON = G('<path d="M5 5l10 10M15 5L5 15"/>', 20), BACK = G('<path d="M12 4.5 6.5 10l5.5 5.5"/>', 18);
  const UP = G('<path d="M6.5 9.2V16H4.2a.7.7 0 0 1-.7-.7V9.9c0-.4.3-.7.7-.7zM6.5 9.2l2.9-5.4c1.2 0 2 .9 1.8 2.1l-.4 2.4h4.1c1 0 1.7.9 1.5 1.8l-1 4.6c-.2.8-.9 1.3-1.6 1.3H6.5"/>'), DOWN = G('<path d="M13.5 10.8V4h2.3c.4 0 .7.3.7.7v5.4c0 .4-.3.7-.7.7zM13.5 10.8l-2.9 5.4c-1.2 0-2-.9-1.8-2.1l.4-2.4H5.1c-1 0-1.7-.9-1.5-1.8l1-4.6C4.8 4.5 5.5 4 6.2 4h7.3"/>');

  // ---------- quick questions, by where you are ----------
  const Q = {
    code: ["I need a host code", "I don't have a host code. How do I get one?"], wait: ["I'm on the waitlist", "I'm on the waitlist. What now?"],
    taken: ["Email already in use", "It says my email is already in use."], pw: ["Password rules", "What are the password rules?"],
    reset: ["Reset email didn't come", "My reset email didn't come."], google: ["Sign in with Google?", "Can I sign in with Google?"],
    page: ["What is a page?", "What is a page?"], handle: ["Choose my handle", "How do I choose or change my handle?"],
    first: ["Make my first event", "How do I make my first event with one sentence?"], ask: ["Ask to join or open?", "Should guests ask to join, or is it open to anyone with the link?"],
    paid: ["Free or paid?", "Can my event be free or paid?"], share: ["How do I share my invite?", "How do I share my invite?"], see: ["What do guests see?", "What do guests see?"],
    pay: ["How do guests pay?", "How do guests pay?"], past: ["Add past events", "How do I add past events?"], look: ["Change my page look", "How do I change my page look?"],
    setup: ["Name, photo and line", "How do I add my page name, photo and a line about me?"],
    status: ["How's my event doing?", "How many people are coming?"], edit: ["Edit my event", "How do I edit my event?"], cancel: ["Cancel my event", "How do I cancel my event?"],
    guests: ["Who's coming?", "Where do I see who's coming?"], saidPaid: ["Someone says they paid", "A guest says they paid. What do I do?"], tiers: ["Different prices", "Can I have different prices for adults and kids?"],
    roster: ["Export my guest list", "How do I export my guest list?"], tables: ["Open tables", "How do open tables work?"], photos: ["Photos from the day", "How do guests add photos?"],
    kudos: ["How kudos work", "How do kudos work?"], discord: ["Discord or Slack", "How do I post my invite in Discord?"], repeat: ["Make it repeat", "How do I make my event repeat?"],
    layout: ["Page layouts", "How do I change my page layout?"], shop: ["Set up my shop", "How do I set up my shop?"], discover: ["Get on Discover", "Why isn't my event on Discover?"],
    findInv: ["Can't find my invite", "I can't find my invite"], reply: ["Change my reply", "How do I change my reply?"], follow: ["Follow a host", "How do I follow a host?"],
    // by who you are here (launch)
    gReply: ["Reply to an invite", "How do I reply to an invite?"], gAddr: ["Where is it?", "Where is the event? I can't see the address."], gCal: ["Add to my calendar", "How do I add the event to my calendar?"],
    gPay: ["Pay the host", "How do I pay for my spot?"], gDrop: ["Order from a drop", "How do I order from a drop?"],
    hPaid: ["Get paid", "When do I get my money?"], hClub: ["Memberships", "How do memberships and fan clubs work?"], hDrop: ["Start a drop", "How do I start a drop?"],
    bBook: ["Book a host", "How do I book a host for my team?"], bBrief: ["The brief", "What goes in the brief?"], bAppr: ["Approvals", "How do approvals work?"],
    bInv: ["Invoices", "Where is my invoice?"], bDemo: ["Look around first", "Can I try it before booking?"],
  };
  const ROLE_CHIPS = { guest: ["gReply", "reply", "gAddr", "gCal", "gPay", "gDrop"], host: ["first", "share", "guests", "hPaid", "hClub", "hDrop"], brand: ["bBook", "bBrief", "bAppr", "bInv", "bDemo"] };
  const ROLE_LABEL = { guest: "Guest", host: "Host", brand: "Brand" };
  let roleSet = ss.get("encore.help.role") || "";
  /** Who this person is here: what they picked, else a brand page or team workspace, an invite, else signed in or not. */
  function roleOf() {
    if (ROLE_CHIPS[roleSet]) return roleSet;
    if (document.body?.dataset?.audience === "brand" || document.documentElement.classList.contains("es-biz") || /^\/(teams|team|vendor|results|booking|brand)(\/|$|-)/.test(P)) return "brand";
    if (me && me.workspace && me.workspace.plan && !["friends", "self-hosted"].includes(me.workspace.plan)) return "brand";
    if (P === "/g" || /^\/(e|i|k)\//.test(P) || /^\/chats/.test(P) && !signedIn()) return "guest";
    return signedIn() ? "host" : "guest";
  }
  const ctx = () => { try { return (window.__helpCtx && window.__helpCtx()) || {}; } catch { return {}; } };
  const app = () => (window.__helpDo && typeof window.__helpDo === "object" ? window.__helpDo : null);
  const appEvent = () => { try { return app()?.event?.() || null; } catch { return null; } };
  function where() {
    if (/^\/(signup|join)$/.test(P)) return "signup"; if (/^\/(login|forgot|reset)$/.test(P)) return "signin"; if (P === "/onboard") return "onboard";
    const w = document.querySelector("#wizBg .wiz"); if (w) return w.getAttribute("aria-label") === "Share your invite" ? "share" : "wizard";
    if (document.querySelector(".store-pane:not([hidden])") || document.getElementById("fc-save") || /^\/@/.test(P)) return "page";
    if (P === "/plans") return "plans"; if (/^\/(discover|events|feed|hosts)$/.test(P)) return "discover";
    const c = ctx(); if (c.firstRun || window.__welcome) return "welcome";
    if (location.hash === "#studio" && c.eventId) return c.step === 6 ? "guests" : "event";
    return "";
  }
  function chips() {
    const w = where(), r = roleOf();
    // a guest or a brand gets their own questions anywhere but the sign-up steps (the app's own state is a host's)
    if (r !== "host" && !["signup", "signin", "onboard"].includes(w)) return w === "plans" && r === "guest" ? [Q.findInv, Q.reply, Q.gAddr, Q.gCal, Q.gPay] : ROLE_CHIPS[r].map((k) => Q[k]);
    if (w === "signup") return [Q.code, Q.wait, Q.taken, Q.pw, Q.page];
    if (w === "signin") return [Q.reset, Q.taken, Q.google, Q.pw];
    if (w === "onboard") return [Q.page, Q.setup, Q.past, Q.look];
    if (w === "page") return [Q.setup, Q.layout, Q.shop, Q.handle, Q.past];
    if (w === "wizard" || w === "welcome") return [Q.first, Q.ask, Q.paid, Q.share, Q.see];
    if (w === "share") return [Q.share, Q.discord, Q.see, Q.pay];
    if (w === "event") return [Q.status, Q.share, Q.edit, Q.saidPaid, Q.cancel];
    if (w === "guests") return [Q.guests, Q.saidPaid, Q.tables, Q.roster, Q.photos];
    if (w === "plans" && roleOf() === "guest") return [Q.findInv, Q.reply, Q.gAddr, Q.gCal, Q.gPay];
    if (w === "discover" && roleOf() === "host") return [Q.discover, Q.follow, Q.share];
    if (roleOf() === "host" && appEvent()) return [Q.status, Q.share, Q.edit, Q.pay, Q.repeat];
    return ROLE_CHIPS[roleOf()].map((k) => Q[k]);
  }

  // ---------- styles ----------
  const css = document.createElement("style"); css.id = "ehCss";
  css.textContent = `
.eh-away{display:none!important}
:host{all:initial}*{box-sizing:border-box}button,input,select,textarea{font:inherit;color:inherit;margin:0;width:auto;touch-action:manipulation}a{color:inherit}svg{display:block;flex:none}
:focus-visible{outline:3px solid var(--pl-accent);outline-offset:2px}
[hidden]{display:none!important}
.eh-btn{position:fixed;right:var(--eh-right,16px);bottom:var(--eh-bottom,16px);z-index:9500;display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:8px 16px 8px 10px;border-radius:999px;border:1.5px solid var(--pl-frame);background:var(--pl-surface);color:var(--pl-ink);font:600 16px "IBM Plex Sans",system-ui,sans-serif;cursor:pointer;box-shadow:0 10px 28px -16px rgba(31,26,23,.28);transition:transform .15s}
.eh-btn:hover{transform:translateY(-1px)}.eh-btn.eh-intab{display:none}
/* at rest over words or a control, it tucks into the page's right margin (a slim edge still opens it) and comes back over empty space */
.eh-btn{transition:transform .2s ease,opacity .2s ease}.eh-btn.eh-tuck{transform:translateX(calc(100% + var(--eh-right,16px) - 14px));opacity:.9}.eh-btn.eh-tuck:hover,.eh-btn.eh-tuck:focus-visible{transform:none;opacity:1}
.eh-btn .eh-dot{position:absolute;top:-4px;right:-4px;width:14px;height:14px;border-radius:50%;background:var(--pl-accent);border:2px solid var(--pl-surface)}
.eh-btn.eh-dock{top:calc(10px + env(safe-area-inset-top,0px));left:10px;right:auto;bottom:auto;padding:6px 12px 6px 8px;font-size:14px;min-height:44px}
.eh-scrim{position:fixed;inset:0;z-index:2147483000;background:rgba(31,26,23,.36);cursor:pointer;touch-action:none;-webkit-tap-highlight-color:transparent;animation:ehFade .18s ease-out}
.eh-panel{position:fixed;z-index:2147483001;right:16px;bottom:16px;width:min(400px,calc(100vw - 32px));height:640px;max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);display:flex;flex-direction:column;background:var(--pl-surface);color:var(--pl-ink);border:1.5px solid var(--pl-frame);border-radius:24px;box-shadow:0 18px 48px -18px rgba(31,26,23,.45);font:16px/1.45 "IBM Plex Sans",system-ui,sans-serif;overflow:hidden;overflow:clip;overscroll-behavior:contain;animation:ehPop .18s ease-out}
.eh-grab{display:none}
.eh-head{display:flex;align-items:center;gap:12px;padding:12px 8px 12px 16px;border-bottom:1.5px solid var(--pl-line);flex:none}.eh-head h2{margin:0;font:600 20px/1.2 var(--pl-font-text);outline:none}.eh-head small{display:block;color:var(--pl-soft);font-size:13px;line-height:1.35;margin-top:2px}
.eh-head .eh-face{flex:none;width:40px;height:40px;display:grid;place-items:center}.eh-head .eh-face svg{width:40px;height:40px}
.eh-x{margin-left:auto;flex:none;align-self:flex-start;border:0;background:none;width:44px;height:44px;display:grid;place-items:center;padding:0;border-radius:50%;cursor:pointer;color:var(--pl-frame)}.eh-x:hover{background:var(--pl-raised);color:var(--pl-ink)}
.eh-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:12px 16px;display:grid;gap:12px;align-content:start}
.eh-log{display:grid;gap:12px}
.eh-m{max-width:92%;padding:8px 12px;border-radius:16px;white-space:pre-wrap;overflow-wrap:anywhere}.eh-m.me{justify-self:end;background:var(--pl-ink);color:#fff;border-bottom-right-radius:4px}.eh-m.potto{background:#fff;border:1.5px solid var(--pl-line);border-bottom-left-radius:4px}
.eh-m small{display:block;font-size:13px;color:var(--pl-soft);margin-bottom:2px;font-weight:600}.eh-m.team{background:var(--pl-sand-soft);border:1.5px solid #EAD9A0}
.eh-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.eh-acts a,.eh-acts button{display:inline-flex;align-items:center;min-height:44px;padding:4px 14px;border-radius:999px;border:1.5px solid var(--pl-line-strong);background:#fff;color:var(--pl-ink);font:600 14px "IBM Plex Sans",system-ui;text-decoration:none;cursor:pointer}
.eh-acts .eh-do{background:var(--pl-accent);border-color:var(--pl-accent);color:#fff}
.eh-rate{display:flex;align-items:center;gap:4px;margin-top:8px;color:var(--pl-soft);font-size:13px;white-space:normal}.eh-rate span{margin-right:4px}.eh-rate button{width:44px;height:44px;display:grid;place-items:center;border:0;background:none;border-radius:50%;color:var(--pl-frame);cursor:pointer}.eh-rate button:hover{background:var(--pl-raised)}
.eh-rel{margin-top:8px;font-size:13px;color:var(--pl-soft);white-space:normal}.eh-rel button{border:0;background:none;padding:0;min-height:44px;color:var(--pl-accent-text);font:600 13px "IBM Plex Sans",system-ui;text-decoration:underline;cursor:pointer;text-align:left}
.eh-chips{display:flex;flex-wrap:wrap;gap:8px}.eh-chips button{min-height:44px;padding:6px 14px;border-radius:999px;border:1.5px solid var(--pl-line);background:#fff;color:var(--pl-ink);font:600 14px "IBM Plex Sans",system-ui;cursor:pointer;text-align:left}.eh-chips button:hover{border-color:var(--pl-ink)}
.eh-ask{display:flex;gap:8px;padding:12px 16px 8px;border-top:1.5px solid var(--pl-line);align-items:flex-end;flex:none}.eh-ask textarea{flex:1;min-height:44px;max-height:120px;resize:none;border:1.5px solid var(--pl-line-strong);border-radius:12px;padding:10px 12px;font:16px "IBM Plex Sans",system-ui;background:#fff;color:var(--pl-ink)}
.eh-panel :is(textarea,input,select):focus{outline:none!important;border-color:var(--pl-ink)!important;box-shadow:0 0 0 3px rgba(201,74,48,.18)!important}
.eh-go{min-height:44px;padding:0 16px;border:0;border-radius:999px;background:var(--pl-accent);color:#fff;font:700 16px "IBM Plex Sans",system-ui;cursor:pointer}.eh-go:disabled{opacity:.6;cursor:default}
.eh-foot{padding:0 16px 12px;display:flex;gap:8px;align-items:center;flex:none}.eh-human{flex:1;min-height:44px;border-radius:999px;border:1.5px solid var(--pl-line-strong);background:#fff;color:var(--pl-ink);font:600 16px "IBM Plex Sans",system-ui;cursor:pointer}.eh-human:hover{background:var(--pl-sand-soft)}
.eh-clear{border:0;background:none;color:var(--pl-soft);font:600 13px "IBM Plex Sans",system-ui;text-decoration:underline;cursor:pointer;min-height:44px;padding:0 4px;justify-self:start}
.eh-tk{border:1.5px solid var(--pl-line);border-radius:16px;background:#fff;padding:12px;display:grid;gap:8px}.eh-tk-h{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.eh-tk-h b{font:600 16px var(--sys-title)}
.eh-tk .eh-m{max-width:100%}.eh-tk form{display:flex;gap:8px}.eh-tk input{flex:1;min-width:0;min-height:44px;border:1.5px solid var(--pl-line-strong);border-radius:12px;padding:6px 12px;font:16px "IBM Plex Sans",system-ui;background:#fff}
.eh-pill{font-size:13px;font-weight:700;border-radius:999px;padding:1px 8px;background:#FDE7DF;color:var(--pl-accent-text)}.eh-pill.waiting{background:var(--pl-sand-soft);color:#6B4E00}.eh-pill.solved{background:#E3F2E6;color:#245C33}.eh-new{font-size:13px;font-weight:700;color:var(--pl-accent)}
.eh-earlier summary{cursor:pointer;font-weight:600;min-height:44px;display:flex;align-items:center}.eh-earlier .eh-tk{margin-top:8px}
.eh-form{display:grid;gap:16px}.eh-form h3{margin:0;font:600 20px var(--pl-font-text);outline:none}.eh-form label{display:block;font-weight:600;font-size:14px}.eh-form label>input,.eh-form label>textarea,.eh-form label>select{display:block;margin-top:4px}
.eh-form textarea,.eh-form input:not([type=file]):not([type=checkbox]),.eh-form select{width:100%;border:1.5px solid var(--pl-line-strong);border-radius:12px;padding:10px 12px;font:16px "IBM Plex Sans",system-ui;background:#fff;color:var(--pl-ink)}.eh-form textarea{min-height:96px;resize:vertical}
.eh-more summary{cursor:pointer;font-weight:600;font-size:14px;min-height:44px;display:flex;align-items:center;color:var(--pl-accent-text)}
.eh-sla{margin:-8px 0 0;color:#245C33;font-size:14px;font-weight:600}
.eh-ctx{border:1.5px solid var(--pl-line);border-radius:12px;padding:8px 12px 12px;margin:0;background:#FBF7F0}.eh-ctx legend{font-weight:600;font-size:14px;padding:0 4px}.eh-ctx ul{margin:0;padding:0;list-style:none;display:grid;gap:4px;font-size:14px}.eh-ctx li{display:flex;gap:8px;align-items:flex-start}.eh-ctx li span{color:var(--pl-soft)}
.eh-ctx label{display:flex;gap:8px;align-items:center;font-weight:600;min-height:44px}.eh-ctx input[type=checkbox]{width:20px;height:20px;accent-color:var(--pl-accent)}.eh-ctx details{font-size:13px;color:var(--pl-soft);margin-left:28px}.eh-ctx details summary{cursor:pointer;min-height:32px}.eh-ctx details p{margin:4px 0;white-space:pre-wrap}
.eh-note{color:var(--pl-soft);font-size:13px;font-weight:400;margin:0}.eh-err{color:#A93A3A;font-size:14px;margin:0}.eh-err:empty{display:none}.eh-ok{background:#E3F2E6;border-radius:12px;padding:12px;color:#1F3D27}
.eh-say{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;margin:0}
.eh-hp{position:absolute!important;left:-10000px!important;width:1px;height:1px;overflow:hidden}
.eh-back{display:inline-flex;align-items:center;gap:4px;border:0;background:none;color:var(--pl-accent-text);font:600 14px "IBM Plex Sans",system-ui;cursor:pointer;min-height:44px;padding:0 4px 0 0;justify-self:start}
.eh-row{display:flex;gap:8px;align-items:center}
.eh-nudge{position:fixed;right:var(--eh-right,16px);bottom:calc(var(--eh-bottom,16px) + 56px);z-index:9550;width:min(300px,calc(100vw - 32px));background:var(--pl-surface);border:1.5px solid var(--pl-frame);border-radius:16px;box-shadow:0 18px 48px -18px rgba(31,26,23,.45);padding:12px 12px 12px 16px;font:15px/1.4 "IBM Plex Sans",system-ui;color:var(--pl-ink)}
.eh-nudge p{margin:0 36px 8px 0;font-weight:600;display:flex;gap:8px;align-items:center}.eh-nudge .eh-nx{position:absolute;top:2px;right:2px;width:44px;height:44px;border:0;background:none;display:grid;place-items:center;border-radius:50%;color:var(--pl-frame);cursor:pointer}.eh-nudge .eh-acts{margin:0}
.eh-nudge.eh-dock{top:calc(60px + env(safe-area-inset-top,0px));left:10px;right:auto;bottom:auto}
@keyframes ehFade{from{opacity:0}}@keyframes ehPop{from{opacity:0;transform:translateY(8px)}}@keyframes ehUp{from{transform:translateY(100%)}}
@media (max-width:600px){
  .eh-panel{left:0;right:0;bottom:var(--eh-kb,0px);width:auto;height:85vh;height:min(85dvh,calc(var(--eh-vvh,100dvh) - 8px));max-height:none;border-radius:24px 24px 0 0;border-width:1.5px 0 0;padding-bottom:env(safe-area-inset-bottom,0px);animation:ehUp .24s cubic-bezier(.2,.8,.2,1)}
  .eh-panel.eh-kbd{padding-bottom:0}
  .eh-grab{display:flex;justify-content:center;padding:8px 0 0;flex:none;touch-action:none;cursor:grab}.eh-grab span{width:40px;height:5px;border-radius:999px;background:var(--pl-line-strong)}
  .eh-head{touch-action:none;padding-top:4px}
  .eh-btn{font-size:14px;padding:6px;width:48px;height:48px;justify-content:center;border-radius:50%}.eh-btn > span:not(.eh-dot){position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
}
@media (prefers-reduced-motion:reduce){.eh-btn{transition:none}.eh-panel,.eh-scrim{animation:none}}
.eh-lazy .eh-btn{display:none!important}
.eh-roles{display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center;margin:10px 0 0;color:var(--pl-soft);font-size:14px}.eh-roles button{border:0;background:none;min-height:44px;padding:0 6px;color:var(--pl-accent-text);font:600 14px "IBM Plex Sans",system-ui;text-decoration:underline;cursor:pointer}.eh-roles button[aria-pressed=true]{color:var(--pl-ink);text-decoration:none}
.eh-foot{flex-wrap:wrap}.eh-promise{flex-basis:100%;margin:0 0 2px;color:var(--pl-soft);font-size:14px;line-height:1.35}.eh-urgent{min-height:44px;border-radius:999px;border:1.5px solid var(--pl-line-strong);background:var(--pl-sand,#F3E7A8);color:var(--pl-ink);font:600 15px "IBM Plex Sans",system-ui;cursor:pointer;padding:0 14px}
.eh-status{margin:0 0 12px;background:var(--pl-sand,#F3E7A8);border:1.5px solid var(--pl-ink);border-radius:8px;padding:8px 12px;font-size:15px}.eh-status:empty{display:none}`;

  // ---------- the button, the nudge and the sheet ----------
  // everything lives in a shadow root, so no page style (full-width buttons, label rules) can reach it
  const host = document.createElement("div"); host.id = "encoreHelp"; const root = host.attachShadow({ mode: "open" }); root.appendChild(css);
  const tpl = document.createElement("div"); tpl.className = "eh-root"; root.appendChild(tpl);
  tpl.innerHTML = `<button type="button" class="eh-btn" aria-label="Need a hand?" title="Need a hand?" aria-haspopup="dialog" aria-expanded="false" aria-controls="ehPanel">${VASE}<span>Need a hand?</span><span class="eh-dot" hidden></span></button>
<div class="eh-nudge" role="status" hidden><button type="button" class="eh-nx" aria-label="Not now">${X_ICON}</button><p>${VASE}<span>${LINE}</span></p><div class="eh-acts"><button type="button" data-nudge="ask">Ask Potto</button><button type="button" data-nudge="person">Get a person</button></div></div>
<div class="eh-scrim" hidden></div>
<section class="eh-panel" id="ehPanel" role="dialog" aria-modal="true" aria-labelledby="ehTitle" hidden>
  <div class="eh-grab" aria-hidden="true"><span></span></div>
  <div class="eh-head"><span class="eh-face">${VASE}</span><div><h2 id="ehTitle" tabindex="-1">Need a hand?</h2><small class="eh-sub">Potto answers from the help guide. A person replies within a day.</small></div><button type="button" class="eh-x" aria-label="Close help">${X_ICON}</button></div>
  <div class="eh-body" id="ehBody"><p class="eh-status" role="status"></p><div class="eh-chat"><div class="eh-log"></div><p class="eh-say" role="status" aria-live="polite"></p></div><div class="eh-chips" role="group" aria-label="Common questions"></div><div class="eh-roles" role="group" aria-label="Questions for"></div><div class="eh-earlier" hidden></div><div class="eh-form-wrap" hidden></div></div>
  <form class="eh-ask"><textarea rows="1" aria-label="Ask Potto a question" placeholder="Ask me anything" maxlength="1000" enterkeyhint="send"></textarea><button type="submit" class="eh-go">Ask</button></form>
  <div class="eh-foot"><p class="eh-promise">We reply within 24 hours, usually sooner.</p><button type="button" class="eh-human">Talk to a person</button><button type="button" class="eh-urgent">My event is today</button></div>
</section>`;
  // onboarding forms end at the bottom of the screen: leave room to scroll their last button clear of ours
  if (ONB) { const pad = document.createElement("style"); pad.textContent = "body{padding-bottom:calc(var(--eh-bottom,16px) + 64px)!important}"; document.head.appendChild(pad); }
  if (LAZY) tpl.classList.add("eh-lazy");
  const mount = () => { document.body.appendChild(host); place(); setInterval(place, 1500); window.addEventListener("resize", place); start();
    // dialogs open and close between ticks: look again soon after the page changes
    let t = 0; new MutationObserver(() => { if (t) return; t = setTimeout(() => { t = 0; place(); }, 120); }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "open"] }); };
  const $ = (s) => root.querySelector(s);
  const btn = () => $(".eh-btn"), panel = () => $(".eh-panel"), nudge = () => $(".eh-nudge"), scrim = () => $(".eh-scrim");
  const isOpen = () => !panel().hidden;
  const phone = () => matchMedia("(max-width:600px)").matches;

  // Sit above whatever is fixed at the bottom right (tab bars, Edit page and Shop buttons, sticky bars), never on it.
  // When a full-height dialog leaves no room there (the event wizard on a phone), dock in the top left instead.
  const fixedCache = new WeakMap();
  const fixedish = (el) => { for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) { if (fixedCache.has(e)) return fixedCache.get(e); const p = getComputedStyle(e).position; if (p === "fixed" || p === "sticky") { fixedCache.set(e, e); return e; } } return null; };
  function obstacleHeight() {
    const H = innerHeight, W = innerWidth, xs = [W - 20, W - 90, W - 160].filter((x) => x > 0); let top = H;
    for (const x of xs) { let gap = 0;
      for (let y = H - 4; y > H * 0.5; y -= 6) { const els = document.elementsFromPoint(x, y).filter((e) => e !== host && !host.contains(e)); let hit = false;
        for (const e of els) { const f = fixedish(e); if (!f) continue; const r = f.getBoundingClientRect(); if (r.width >= W * 0.9 && r.height >= H * 0.9 && e === f) continue; hit = true; break; }
        if (hit) { top = Math.min(top, y); gap = 0; } else if (++gap > 3 && top < H) break; } }
    // also the known bottom-right pieces by name (tab bars, Edit page / Shop buttons, sticky reply bars), even with gaps between them
    try { for (const e of document.querySelectorAll('.es-tabs,nav.tabs,.store-fab,.shop-fab,.own-fab,#gBar,#gStick,[class*="-fab"]')) { if (host.contains(e)) continue; const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      if (!r.width || !r.height || cs.visibility === "hidden" || cs.display === "none") continue; if (r.right > W - 150 && r.bottom > H * 0.5 && r.top < H) top = Math.min(top, r.top); } } catch {}
    return H - top;
  }
  // a dialog, sheet or wizard of the page's own is open: the button steps aside (it would sit on step chips and titles)
  const shown = (e) => { if (!e || host.contains(e) || e.hidden) return false; const cs = getComputedStyle(e); if (cs.display === "none" || cs.visibility === "hidden") return false; const r = e.getBoundingClientRect(); return r.width > 40 && r.height > 40; };
  const modalOpen = () => { try { if (document.querySelector("#wizBg .wiz, #wizBg[data-wizard]") && shown(document.querySelector("#wizBg"))) return true;
    for (const e of document.querySelectorAll('[role=dialog], [aria-modal=true], dialog[open], .store-pane, .sheet, .pin-bg, .fv-sv')) if (shown(e)) return true; } catch {} return false; };
  const tabBar = () => { if (innerWidth > 860) return false; try { for (const e of document.querySelectorAll(".es-tabs,nav.tabs")) { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); if (fixedish(e) && cs.display !== "none" && cs.visibility !== "hidden" && r.width >= innerWidth * 0.9 && r.bottom >= innerHeight - 2 && r.height > 30) return true; } } catch {} return false; };
  // Is there text, a picture or a control under where the button sits (untucked)? Text is read by its own line boxes, so
  // the empty end of a short line doesn't count.
  const MEDIA = "img,svg,video,canvas,picture,iframe,input,textarea,select,button,[role=button],[role=img]";
  function contentAt(x, y) { for (const e of document.elementsFromPoint(x, y)) { if (e === host || host.contains(e)) continue; if (e === document.body || e === document.documentElement) return false; if (fixedish(e)) continue;
      if (e.closest(MEDIA)) return true;
      for (const n of e.childNodes) { if (n.nodeType !== 3 || !n.textContent.trim()) continue; const r = document.createRange(); r.selectNodeContents(n); for (const q of r.getClientRects()) if (x >= q.left - 2 && x <= q.right + 2 && y >= q.top - 2 && y <= q.bottom + 2) return true; } }
    return false; }
  function overContent(b, bottom) { try { const w = b.offsetWidth, hh = b.offsetHeight, right = parseFloat(getComputedStyle(b).right) || 16, x0 = innerWidth - right - w, y0 = innerHeight - bottom - hh;
      for (const fx of [0.15, 0.5, 0.85]) for (const fy of [0.15, 0.5, 0.85]) if (contentAt(x0 + w * fx, y0 + hh * fy)) return true; } catch {} return false; }
  // look again when scrolling stops (the button stays as it is while the page moves)
  { let st = 0; addEventListener("scroll", () => { clearTimeout(st); st = setTimeout(() => place(), 160); }, { passive: true }); }
  function place() {
    try { const b = btn(); if (!b || isOpen()) return; const away = modalOpen(); b.classList.toggle("eh-away", away); nudge().classList.toggle("eh-away", away); if (away) return;
      // phones with a bottom tab bar: help lives in the Me sheet (public/chatnav.js), so nothing floats over the page's own
      // buttons (the Home composer's send arrow, toggles, card menus). The nudge can still offer it once, above the bar.
      const intab = tabBar() || !!document.querySelector("[data-help-open]") || (innerWidth <= 860 && document.documentElement.classList.contains("es-pre") && !document.querySelector(".es-tabs,nav.tabs")) /* a page that is about to get its tab bar (slow connection): don't float over the logo meanwhile */; /* or the page has its own Help row */ b.classList.toggle("eh-intab", intab); host.style.height = intab || phone() ? "" : "72px";
      const h = obstacleHeight(), dock = !intab && h > innerHeight * 0.45 - 8;
      b.classList.toggle("eh-dock", dock); nudge().classList.toggle("eh-dock", dock);
      const bottom = dock ? 16 : Math.round(h ? h + 12 : 16); document.documentElement.style.setProperty("--eh-bottom", bottom + "px");
      b.classList.toggle("eh-tuck", !intab && !dock && overContent(b, bottom));
    } catch {}
  }

  // ---------- the chat, kept on this device for a week (cleared when you sign in or out) ----------
  let within = "within a day", promise = "We reply within 24 hours, usually sooner.";
  let log = []; try { const c = JSON.parse(ls.get(LOG) || "null"); if (c && Date.now() - c.at < 7 * 864e5 && c.signed === signedIn()) log = (c.items || []).slice(-40); } catch {}
  const saveLog = () => ls.set(LOG, JSON.stringify({ at: Date.now(), signed: signedIn(), items: log.slice(-40) }));
  const DO_FN = { share: "share", copy: "copy", preview: "preview", guests: "guests", open: "open", new: "newEvent" };
  function actHTML(a) {
    if (a.href === "#person") return `<button type="button" data-person>${esc(a.label)}</button>`;
    if (a.href === "#urgent") return `<button type="button" data-person="urgent">${esc(a.label)}</button>`;
    const m = /^#do:([a-z]+)$/.exec(a.href);
    if (m) { if (!DO_FN[m[1]]) return ""; const A = app();
      // in the app, with no event to act on: the one step that helps is making one
      if (A && m[1] !== "new" && !appEvent()) return `<button type="button" class="eh-do" data-do="new">New event</button>`;
      return `<button type="button" class="${m[1] === "new" || m[1] === "share" ? "eh-do" : ""}" data-do="${m[1]}">${esc(a.label)}</button>`; }
    return /^\/(?!\/)/.test(a.href) ? `<a href="${esc(a.href)}">${esc(a.label)}</a>` : "";
  }
  function msgHTML(m, i) {
    if (m.role === "ticket") return ticketHTML(m, i);
    if (m.role !== "potto") return `<div class="eh-m me">${esc(m.text)}</div>`;
    const acts = [...new Set((m.actions || []).map(actHTML).filter(Boolean))].join("");
    const rate = m.q && m.section !== undefined ? (m.rated ? `<div class="eh-rate" role="status">${m.rated === "up" ? "Thanks for telling me." : "Sorry about that. A person can pick this up, and they'll see this chat."}</div>`
      : `<div class="eh-rate" role="group" aria-label="Did this help?"><span>Did this help?</span><button type="button" data-rate="up" data-i="${i}" aria-label="Yes, this helped">${UP}</button><button type="button" data-rate="down" data-i="${i}" aria-label="No, this didn't help">${DOWN}</button></div>`) : "";
    const rel = (m.related || []).length ? `<div class="eh-rel">Also: ${m.related.map((r) => `<button type="button" data-q="${esc(r.q)}">${esc(r.title)}</button>`).join(", ")}</div>` : "";
    const down = m.rated === "down" && !(m.actions || []).some((a) => a.href === "#person") ? `<div class="eh-acts"><button type="button" data-person>Talk to a person</button></div>` : "";
    return `<div class="eh-m potto" data-i="${i}"><small>Potto</small>${esc(m.text)}${acts ? `<div class="eh-acts">${acts}</div>` : ""}${down}${rel}${rate}</div>`;
  }
  const greet = () => ({ role: "potto", text: PLANS && !signedIn() ? "Hi, I'm Potto. Looking for an invite? I can help you find it." : ONB && !signedIn() ? "Hi, I'm Potto. Ask me anything about getting started, or pick one below. If I don't know, I'll find you a person." : "Hi, I'm Potto. Ask me anything, or pick one below. If I don't know, I'll find you a person." });
  function drawLog(keepScroll) { const L = $(".eh-log"), B = $("#ehBody"), top = B.scrollTop;
    L.innerHTML = [greet(), ...log].map((m, i) => msgHTML(m, i - 1)).join("") + (log.length ? `<button type="button" class="eh-clear" data-clear>Start over</button>` : "");
    bindTicketForms(L); drawEarlier(); B.scrollTop = keepScroll ? top : B.scrollHeight; }
  function drawChips() { $(".eh-chips").innerHTML = chips().map(([label, q]) => `<button type="button" data-q="${esc(q)}">${esc(label)}</button>`).join("");
    const r = roleOf(), R = $(".eh-roles"); if (!R) return; const w = where(); R.hidden = !!w && !["plans", "discover"].includes(w);
    R.innerHTML = `<span>Questions for</span>${Object.keys(ROLE_CHIPS).map((k) => `<button type="button" data-role="${k}" aria-pressed="${k === r}">${ROLE_LABEL[k]}</button>`).join("")}`; }
  function drawStatus() { const x = window.PLReport?.status?.(), b = $(".eh-status"); if (b) b.textContent = x?.message ? x.message : ""; }
  let busy = false;
  async function ask(text) {
    text = String(text || "").trim(); if (!text || busy) return; busy = true; const go = $(".eh-go"); go.disabled = true;
    log.push({ role: "host", text }); drawLog(); $(".eh-log").insertAdjacentHTML("beforeend", `<div class="eh-m potto eh-wait"><small>Potto</small>Thinking…</div>`); say("Potto is thinking."); $("#ehBody").scrollTop = $("#ehBody").scrollHeight;
    let m;
    try { const r = await fetch("/api/help/ask", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text, page: P + location.search + location.hash, eventId: ctx().eventId || appEvent()?.id || "", history: log.filter((x) => x.role !== "ticket").slice(-9, -1).map((x) => ({ role: x.role, text: x.text })) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) m = { role: "potto", text: j.message || "That one stumped me. A person can help.", actions: [{ label: "Talk to a person", href: "#person" }] };
      else { const acts = (j.actions || []).filter((a) => a && a.label && a.href); if (j.suggestHuman && !acts.some((a) => a.href === "#person")) acts.push({ label: "Talk to a person", href: "#person" });
        m = { role: "potto", text: j.answer || "I'm not sure. A person can help.", actions: acts, section: j.section || null, mode: j.mode || "", related: j.related || [], q: text }; }
    } catch { m = { role: "potto", text: "I can't reach Pottery Lab right now. Check your connection, or talk to a person.", actions: [{ label: "Talk to a person", href: "#person" }] }; }
    log.push(m); saveLog(); drawLog(); busy = false; go.disabled = false; say("Potto: " + m.text);
    // the answer reads from its first line, not from the thumbs under it
    const last = [...root.querySelectorAll(".eh-log .eh-m.potto")].slice(-1)[0], B = $("#ehBody"); if (last) B.scrollTop = Math.max(0, last.offsetTop - B.offsetTop - 64);
    if (!phone()) $(".eh-ask textarea").focus({ preventScroll: true });
  }
  // screen readers hear the newest message once, not the whole chat every time it's drawn
  const say = (t) => { const s = $(".eh-say"); s.textContent = ""; setTimeout(() => { s.textContent = t; }, 60); };
  async function rate(i, value) {
    const m = log[i]; if (!m || m.rated) return; m.rated = value; saveLog(); drawLog(true);
    // the thumbs are gone: focus goes to what replaced them, not to the page
    const st = $(`.eh-log [data-i="${i}"] .eh-rate`); if (st) { st.tabIndex = -1; st.focus({ preventScroll: true }); }
    try { await fetch("/api/help/rate", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value, section: m.section || "", question: m.q || "", mode: m.mode || "", page: P + location.search }) }); } catch {}
  }

  // ---------- app actions: the share sheet, copy, preview, guests, a new event ----------
  function runDo(name) {
    const fn = DO_FN[name]; if (!fn) return; const A = app();
    if (!A || typeof A[fn] !== "function") { location.href = "/?app=1&do=" + encodeURIComponent(name); return; }
    close(); setTimeout(() => { let ok = false; try { ok = A[fn]() !== false; } catch {}
      if (!ok) { log.push({ role: "potto", text: "I couldn't find an event to do that on. Make one first, and I'll help you share it.", actions: [{ label: "New event", href: "#do:new" }] }); saveLog(); open(); } }, 80);
  }
  // a link from another page (/?app=1&do=share) runs once the app has loaded its events
  function doFromUrl() {
    const q = new URLSearchParams(location.search), name = q.get("do"); if (!name || !DO_FN[name]) return;
    q.delete("do"); try { history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash); } catch {}
    let n = 0; const t = setInterval(() => { n++; const A = app(); const ready = A && (A.ready ? A.ready() : true);
      if (ready || n > 60) { clearInterval(t); if (A) runDo(name); } }, 150);
  }

  // ---------- conversations with a person ----------
  let tickets = [], me = null, poll = 0;
  const lastTeam = (t) => Math.max(0, ...(t.thread || []).filter((x) => x.by === "team").map((x) => x.at || 0));
  const seenAt = () => +(ls.get(SEEN) || 0);
  const KEYS = "encore.help.keys", keys = () => { try { return JSON.parse(ls.get(KEYS) || "[]").filter((x) => x && x.id && x.k && Date.now() - x.at < 30 * 864e5); } catch { return []; } };
  const keyOf = (id) => keys().find((x) => x.id === id)?.k || "";
  async function loadTickets(force) {
    if (!signedIn()) { const K = keys(); if (!K.length) return; const L = await Promise.all(K.slice(-5).map((x) => fetch(`/api/help/t/${encodeURIComponent(x.id)}?k=${encodeURIComponent(x.k)}`, { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
      tickets = L.filter(Boolean).map((j) => j.ticket).sort((a, b) => b.updatedAt - a.updatedAt); return; } const cached = ss.get("encore.help.t"); if (!force && cached) { try { const c = JSON.parse(cached); if (Date.now() - c.at < 5 * 60e3) { tickets = c.tickets; return; } } catch {} }
    try { const r = await fetch("/api/help/tickets", { credentials: "same-origin" }); if (!r.ok) return; const j = await r.json(); tickets = j.tickets || []; window.__ehAdmin = !!j.admin; if (j.replyWithin) within = j.replyWithin; ss.set("encore.help.t", JSON.stringify({ at: Date.now(), tickets })); } catch {}
  }
  function badge() { const unread = tickets.some((t) => lastTeam(t) > seenAt()); const d = $(".eh-dot"); if (d) d.hidden = !unread; btn().setAttribute("aria-label", unread ? "Need a hand? You have a new reply" : "Need a hand?"); }
  const STATUS = { open: "Sent", waiting: "Replied", solved: "Done" };
  function threadHTML(t, seen, withChat) {
    const head = `<div class="eh-tk-h"><b>Your message to the team</b><span class="eh-pill ${esc(t.status)}">${esc(STATUS[t.status] || t.status)}</span><span class="eh-note">Ref ${esc(String(t.id).slice(0, 6).toUpperCase())}</span>${lastTeam(t) > seen ? `<span class="eh-new">New reply</span>` : ""}</div>`;
    const wait = t.status === "open" && !lastTeam(t) ? `<p class="eh-note">A person replies ${esc(within)}, here and by email.${withChat ? " We included your chat with Potto." : ""}</p>` : "";
    const msgs = (t.thread || []).map((x) => `<div class="eh-m ${x.by === "team" ? "team" : "me"}">${x.by === "team" ? "<small>Pottery Lab</small>" : ""}${esc(x.text)}</div>`).join("");
    const csat = t.status === "solved" ? (t.csat ? `<p class="eh-rate" role="status">Thanks for telling us.</p>` : `<div class="eh-rate" role="group" aria-label="Did we sort it out?"><span>Did we sort it out?</span><button type="button" data-trate="up" data-t="${esc(t.id)}" aria-label="Yes, you sorted it">${UP}</button><button type="button" data-trate="down" data-t="${esc(t.id)}" aria-label="No, not really">${DOWN}</button></div>`) : "";
    return head + wait + msgs + csat + `<form data-reply="${esc(t.id)}"><input aria-label="Reply to the team" placeholder="Reply" maxlength="4000" enterkeyhint="send"><button type="submit" class="eh-go">Send</button></form>`;
  }
  function ticketHTML(m) { const t = tickets.find((x) => x.id === m.id), seen = openSeen ?? seenAt();
    if (t) return `<div class="eh-tk" data-t="${esc(t.id)}" tabindex="-1">${threadHTML(t, seen, m.withChat)}</div>`;
    return `<div class="eh-tk" tabindex="-1"><div class="eh-tk-h"><b>Your message to the team</b><span class="eh-pill">Sent</span>${m.id ? `<span class="eh-note">Ref ${esc(String(m.id).slice(0, 6).toUpperCase())}</span>` : ""}</div><p class="eh-note">${esc(m.expect || `A person replies ${within}, by email.`)}</p>${m.text ? `<div class="eh-m me">${esc(m.text)}</div>` : ""}</div>`; }
  function drawEarlier() {
    const box = $(".eh-earlier"), inLog = new Set(log.filter((m) => m.role === "ticket").map((m) => m.id)), rest = tickets.filter((t) => !inLog.has(t.id));
    if (!rest.length && !window.__ehAdmin) { box.hidden = true; box.innerHTML = ""; return; } box.hidden = false; const seen = openSeen ?? seenAt(), fresh = rest.some((t) => lastTeam(t) > seen);
    box.innerHTML = `${window.__ehAdmin ? `<p class="eh-note"><a href="/support">Open the team inbox</a></p>` : ""}${rest.length ? `<details${fresh ? " open" : ""}><summary>Your conversations (${rest.length})${fresh ? ` <span class="eh-new">&nbsp;New reply</span>` : ""}</summary>${rest.map((t) => `<div class="eh-tk" data-t="${esc(t.id)}">${threadHTML(t, seen)}</div>`).join("")}</details>` : ""}`;
    bindTicketForms(box); badge();
  }
  function bindTicketForms(scope) {
    scope.querySelectorAll("form[data-reply]").forEach((f) => f.onsubmit = async (e) => { e.preventDefault(); const i = f.querySelector("input"), text = i.value.trim(); if (!text) return; f.querySelector("button").disabled = true;
      try { const k = signedIn() ? "" : keyOf(f.dataset.reply); const r = await fetch((k ? "/api/help/t/" : "/api/help/tickets/") + f.dataset.reply, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, ...(k ? { k } : {}) }) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || "Couldn't send that.");
        tickets = tickets.map((t) => (t.id === j.ticket.id ? j.ticket : t)); ss.set("encore.help.t", JSON.stringify({ at: Date.now(), tickets })); drawLog(true); } catch (err) { i.value = text; i.setAttribute("aria-invalid", "true"); i.placeholder = err.message; f.querySelector("button").disabled = false; } });
  }
  async function rateTicket(id, value) {
    try { const r = await fetch(`/api/help/tickets/${encodeURIComponent(id)}/rate`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value }) }); const j = await r.json().catch(() => ({}));
      if (r.ok && j.ticket) { tickets = tickets.map((t) => (t.id === id ? j.ticket : t)); ss.set("encore.help.t", JSON.stringify({ at: Date.now(), tickets })); } } catch {}
    drawLog(true); if (value === "down") { log.push({ role: "potto", text: "Sorry we didn't sort it out. Tell us what's still wrong and a person will pick it up.", actions: [{ label: "Talk to a person", href: "#person" }] }); saveLog(); drawLog(); }
  }

  // ---------- talk to a person ----------
  async function account() { if (me !== null || !signedIn()) return me; try { const j = await (await fetch("/api/me", { credentials: "same-origin" })).json(); me = j?.verified ? j : false; } catch { me = false; } return me; }
  const deviceLabel = () => { const s = navigator.userAgent; const os = /iPhone/.test(s) ? "iPhone" : /iPad/.test(s) ? "iPad" : /Android/.test(s) ? "Android" : /Mac OS X/.test(s) ? "Mac" : /Windows/.test(s) ? "Windows" : "";
    const br = /EdgA?\//.test(s) ? "Edge" : /CriOS|Chrome\//.test(s) ? "Chrome" : /FxiOS|Firefox\//.test(s) ? "Firefox" : /Safari\//.test(s) ? "Safari" : ""; return [os, br].filter(Boolean).join(", ") || "This browser"; };
  const pageLabel = () => { const w = where(); if (/^\/@/.test(P)) return "Your page"; return ({ signup: "Sign up", signin: "Sign in", onboard: "Set up with Potto", share: "The share sheet", wizard: "New event", event: "Your event", guests: "Your guests", plans: "Plans", discover: ({ "/feed": "Feed", "/events": "Events", "/hosts": "Hosts" })[P] || "Discover" })[w] || (P === "/" ? "Home" : P); };
  const bookingId = () => (P.match(/^\/teams\/(?:e|invoice|bookings)\/([A-Za-z0-9_-]{4,40})/) || location.search.match(/[?&](?:booking|req|r)=([A-Za-z0-9_-]{4,40})/) || [])[1] || "";
  const pageEvent = () => (P.match(/^\/(?:e|i|k|chats)\/([A-Za-z0-9_-]{2,80})/) || location.hash.match(/^#(?:rsvp|survey|plan|guests)-([A-Za-z0-9_-]{2,80})/) || [])[1] || "";
  async function personForm(topic, opts = {}) {
    const urgent = !!opts.urgent;
    open(); const wrap = $(".eh-form-wrap"), acct = await account(), out = !acct;
    const chat = log.filter((m) => m.role === "host" || m.role === "potto"), hasQ = chat.some((m) => m.role === "host");
    $(".eh-chat").hidden = true; $(".eh-chips").hidden = true; $(".eh-roles").hidden = true; $(".eh-earlier").hidden = true; $(".eh-ask").hidden = true; $(".eh-foot").hidden = true; wrap.hidden = false;
    const c = ctx(), evId = c.eventId || pageEvent(), ev = appEvent(), evTitle = evId && ev && ev.id === evId ? ev.title : evId ? "The event you're on" : "", bk = bookingId(), role = roleOf(), errs = [...new Set([errFrom, ...(window.PLReport?.recent?.() || [])].filter(Boolean))].slice(-5);
    wrap.innerHTML = `<form class="eh-form" novalidate><button type="button" class="eh-back">${BACK}Back to Potto</button><div><h3 id="ehPersonH" tabindex="-1">${urgent ? "Your event is today" : "Talk to a person"}</h3></div><p class="eh-sla">${urgent ? "We text the team now, and reply as fast as we can." : `${esc(promise)} ${out ? "Here, and by email or text." : "Here and by email."}`}</p>
      ${out && !urgent ? `<label>What's happening?<select name="topic"><option value="">Pick one</option>${(PLANS ? [["invite", "I can't find my invite"], ["reply", "Changing my reply"]] : [["code", "I need a host code"], ["email_taken", "My email is already in use"], ["reset", "My reset email didn't come"], ["google", "Google sign-in"]]).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}<option value="other">Something else</option></select></label>` : ""}
      <label>${urgent ? "What's going wrong?" : hasQ ? `Anything to add? <span class="eh-note">(optional)</span>` : "What do you need?"}<textarea name="message" placeholder="${urgent ? "Guests can't get in, the address is wrong, a payment failed..." : hasQ ? "Your chat with Potto is included, so you don't have to repeat it." : "A line or two is plenty."}"></textarea></label>
      ${out ? `<label>Your email or phone<input name="email" type="text" autocomplete="email" inputmode="email" required placeholder="you@example.com or 555 123 4567"></label><label>Your name <span class="eh-note">(optional)</span><input name="name" autocomplete="name"></label>`
        : ""}
      <fieldset class="eh-ctx"><legend>We'll include</legend><ul>
        ${chat.length ? `<li><label><input type="checkbox" name="withChat" checked> Your chat with Potto (${chat.length} ${chat.length === 1 ? "message" : "messages"})</label></li><li><details><summary>See the chat</summary>${chat.map((m) => `<p><b>${m.role === "potto" ? "Potto" : "You"}:</b> ${esc(m.text)}</p>`).join("")}</details></li>` : ""}
        <li><span>Page:</span> ${esc(pageLabel())}</li>${evTitle ? `<li><span>Event:</span> ${esc(evTitle)}</li>` : ""}${bk ? `<li><span>Booking:</span> ${esc(bk)}</li>` : ""}<li><span>Device:</span> ${esc(deviceLabel())}</li>${errs.length ? `<li><span>Recent errors:</span> ${esc(errs.join(", "))}</li>` : ""}</ul></fieldset>
      ${out ? "" : `<p class="eh-note">We'll reply to <b>${esc(acct.email)}</b> and here.</p><details class="eh-more"><summary>Add a phone or a screenshot</summary><div class="eh-form" style="margin-top:8px"><label>Phone <span class="eh-note">(optional, if a call or text is easier)</span><input name="phone" type="tel" autocomplete="tel" inputmode="tel"></label><label>Screenshot <span class="eh-note">(optional)</span><input name="shot" type="file" accept="image/*"></label></div></details>`}
      <div class="eh-hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
      <p class="eh-err" role="alert"></p>
      <div class="eh-row"><button type="submit" class="eh-go">${urgent ? "Send now" : "Send to the team"}</button></div></form>`;
    const f = wrap.querySelector("form"), er = f.querySelector(".eh-err");
    if (topic && f.topic) f.topic.value = topic;
    f.querySelector(".eh-back").onclick = backToChat;
    setTimeout(() => { $("#ehPersonH").focus(); $("#ehBody").scrollTop = 0; }, 30);
    f.onsubmit = async (e) => { e.preventDefault(); er.textContent = ""; const go = f.querySelector(".eh-go");
      const withChat = !!f.withChat?.checked, message = f.message.value.trim();
      if (message.length < 3 && !(withChat && hasQ)) { er.textContent = "Say what's wrong, even in a few words."; f.message.focus(); return; }
      const contact = out ? f.email.value.trim() : ""; if (out && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) && !/^\+?[0-9 ()-]{7,20}$/.test(contact)) { er.textContent = "Add your email or phone so we can reply."; f.email.focus(); return; }
      go.disabled = true; go.textContent = "Sending…"; let screenshot = "";
      try {
        const file = f.shot?.files?.[0]; if (file && /^image\//.test(file.type) && file.size < 10e6) { try { const r = await fetch("/api/assets", { method: "POST", credentials: "same-origin", headers: { "Content-Type": file.type }, body: file }); if (r.ok) screenshot = (await r.json()).url || ""; } catch {} }
        const body = { message, page: P + location.search + location.hash, eventId: evId, bookingId: bk, role, urgent, errorIds: errs, app: window.PLReport?.app || "", browser: `${navigator.userAgent} · ${innerWidth}x${innerHeight}`, transcript: withChat ? chat.map((m) => ({ role: m.role, text: m.text, section: m.section || "", rated: m.rated || "" })) : [], screenshot, website: f.website.value,
          ...(out ? { contact, name: f.elements.name.value.trim(), topic: f.topic?.value || "" } : { phone: f.phone.value.trim() }) };
        const r = await fetch("/api/help/ticket", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.message || "Couldn't send that. Try again.");
        if (j.key) ls.set(KEYS, JSON.stringify([...keys(), { id: j.id, k: j.key, at: Date.now() }].slice(-5)));
        if (j.ticket) { tickets = [j.ticket, ...tickets.filter((t) => t.id !== j.id)]; ss.set("encore.help.t", JSON.stringify({ at: Date.now(), tickets })); }
        say("Sent. " + (j.expect || `A person replies ${within}.`));
        log.push({ role: "ticket", id: j.id, withChat: withChat && chat.length > 0, text: j.ticket ? "" : message || chat.filter((m) => m.role === "host").slice(-1)[0]?.text || "", expect: j.expect || "" }); saveLog();
        // scroll the chat, never the sheet (scrollIntoView would also scroll the sheet's clipped box and leave a gap)
        backToChat(true); const card = [...root.querySelectorAll(".eh-log .eh-tk")].slice(-1)[0], B = $("#ehBody"); if (card) { B.scrollTop = Math.max(0, card.offsetTop - B.offsetTop - 16); card.focus({ preventScroll: true }); }
        startPoll();
      } catch (err) { er.textContent = err.message; go.disabled = false; go.textContent = "Send to the team"; }
    };
  }
  function backToChat(noFocus) { const wrap = $(".eh-form-wrap"); wrap.hidden = true; wrap.innerHTML = ""; $(".eh-chat").hidden = false; $(".eh-chips").hidden = false; $(".eh-ask").hidden = false; $(".eh-foot").hidden = false; drawLog(); drawChips(); if (noFocus !== true && !phone()) $(".eh-ask textarea").focus(); }

  // ---------- open and close ----------
  let opener = null, openSeen = null, locked = null, inerted = [];
  const deepActive = () => { let a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a; };
  function lockPage() {
    // iOS Safari scrolls the page under a fixed overlay unless the body itself is pinned: pin it where it was
    const de = document.documentElement, b = document.body, y = window.scrollY || 0;
    locked = { y, html: de.style.overflow, pos: b.style.position, top: b.style.top, left: b.style.left, right: b.style.right, width: b.style.width };
    de.style.overflow = "hidden"; b.style.position = "fixed"; b.style.top = -y + "px"; b.style.left = "0"; b.style.right = "0"; b.style.width = "100%";
    // the page behind can't be reached by tapping, tabbing or a screen reader while the sheet is open
    inerted = []; for (const el of document.body.children) if (el !== host && !el.inert && !/^(SCRIPT|STYLE|LINK)$/.test(el.tagName)) { el.inert = true; inerted.push(el); }
  }
  function unlockPage() {
    if (locked) { const de = document.documentElement, b = document.body; de.style.overflow = locked.html; b.style.position = locked.pos; b.style.top = locked.top; b.style.left = locked.left; b.style.right = locked.right; b.style.width = locked.width;
      try { window.scrollTo({ top: locked.y, behavior: "instant" }); } catch { window.scrollTo(0, locked.y); } locked = null; }
    for (const el of inerted) el.inert = false; inerted = [];
  }
  // the keyboard on a phone: keep the sheet's bottom on top of it, and its height inside what's left
  function fitViewport() { const v = window.visualViewport, p = panel(); if (!v || !p) return; const kb = Math.max(0, Math.round(innerHeight - v.height - v.offsetTop));
    p.style.setProperty("--eh-kb", kb + "px"); p.style.setProperty("--eh-vvh", Math.round(v.height) + "px"); p.classList.toggle("eh-kbd", kb > 40); }
  let errFrom = "";
  function open(o) {
    const focusAsk = o === true; if (o && typeof o === "object") { if (ROLE_CHIPS[o.role]) roleSet = o.role; /* this page's link says who it's for; only a tap on Guest, Host or Brand is kept for the visit */ if (o.errorId) errFrom = String(o.errorId).slice(0, 16); if (o.urgent) setTimeout(() => personForm("", { urgent: true }), 0); }
    hideNudge(); const p = panel(); if (!p.hidden) return; opener = deepActive(); openSeen = seenAt();
    lockPage(); scrim().hidden = false; p.hidden = false; p.style.transform = ""; btn().hidden = true; btn().setAttribute("aria-expanded", "true");
    fitViewport(); window.visualViewport?.addEventListener("resize", fitViewport); window.visualViewport?.addEventListener("scroll", fitViewport);
    if (!window.Potto && !document.getElementById("ehMascot")) { const s = document.createElement("script"); s.id = "ehMascot"; s.src = "/mascot.js"; s.onload = face; document.head.appendChild(s); } else face();
    backToChat(true); drawStatus(); if (signedIn() || keys().length) loadTickets().then(() => { drawLog(); startPoll(); });
    if (signedIn() && me === null) account().then(() => drawChips());
    setTimeout(() => { if (focusAsk === true && !phone()) $(".eh-ask textarea").focus(); else $("#ehTitle").focus(); }, 0);
  }
  function face() { try { if (window.Potto?.svg) $(".eh-face").innerHTML = window.Potto.svg("wave", 40, ""); } catch {} }
  function close() { const p = panel(); if (p.hidden) return; p.hidden = true; scrim().hidden = true; p.style.transform = ""; scrim().style.opacity = "";
    window.visualViewport?.removeEventListener("resize", fitViewport); window.visualViewport?.removeEventListener("scroll", fitViewport); stopPoll(); unlockPage();
    if (openSeen != null && tickets.length) ls.set(SEEN, String(Date.now())); openSeen = null; badge(); btn().hidden = false; btn().setAttribute("aria-expanded", "false"); place();
    const back = opener && opener.isConnected && opener !== document.body && opener !== host && !root.contains(opener) ? opener : btn().classList.contains("eh-intab") ? document.querySelector(".es-tabs [data-me], #navMeTab") || btn() : btn(); try { back.focus({ preventScroll: true }); } catch { back.focus(); } }
  // replies come into the open sheet while a conversation is waiting on the team
  function startPoll() { if (poll || !(signedIn() || keys().length) || !tickets.some((t) => t.status !== "solved")) return; poll = setInterval(async () => { if (!isOpen() || document.hidden) return; const before = JSON.stringify(tickets); await loadTickets(true); if (JSON.stringify(tickets) !== before) drawLog(true); }, 30e3); }
  function stopPoll() { clearInterval(poll); poll = 0; }
  const focusables = () => [...panel().querySelectorAll('button,[href],input:not([type=hidden]),textarea,select,summary,[tabindex]:not([tabindex="-1"])')].filter((e) => !e.disabled && e.getClientRects().length && !e.closest("[hidden],.eh-hp"));

  // swipe down on the handle or the header to close (a phone's sheet). Taps on the X and other buttons stay taps.
  function swipe(zone) {
    let d = null;
    zone.addEventListener("pointerdown", (e) => { if (!phone() || !isOpen() || e.button > 0 || e.target.closest("button,a,input,textarea,select")) return; d = { y: e.clientY, t: Date.now(), id: e.pointerId, dy: 0 }; panel().style.transition = "none"; try { zone.setPointerCapture(e.pointerId); } catch {} });
    zone.addEventListener("pointermove", (e) => { if (!d || e.pointerId !== d.id) return; d.dy = Math.max(0, e.clientY - d.y); panel().style.transform = d.dy ? `translateY(${d.dy}px)` : ""; scrim().style.opacity = String(Math.max(0.2, 1 - d.dy / 400)); });
    const end = (e) => { if (!d || (e && e.pointerId !== d.id)) return; const p = panel(), v = d.dy / Math.max(1, Date.now() - d.t), far = d.dy > Math.min(140, p.offsetHeight * 0.25); d = null;
      p.style.transition = "transform .2s ease-out"; if (far || v > 0.6) { p.style.transform = "translateY(100%)"; setTimeout(close, 180); } else { p.style.transform = ""; scrim().style.opacity = ""; } setTimeout(() => { p.style.transition = ""; }, 220); };
    zone.addEventListener("pointerup", end); zone.addEventListener("pointercancel", end);
  }

  // ---------- Potto offers help, once a session ----------
  function offer(line) { if (ss.get(NUDGED) || isOpen()) return; ss.set(NUDGED, "1"); nudge().querySelector("p span").textContent = line || LINE; place(); nudge().hidden = false; }
  function hideNudge() { const n = nudge(); if (n && !n.hidden) n.hidden = true; }
  let lastSig = "", since = Date.now(), lastInput = 0;
  const sig = () => { const w = document.querySelector("#wizBg .wiz"); return [where(), location.pathname, location.search, location.hash, w ? (w.getAttribute("aria-label") || "") + (w.querySelector(".wiz-dots .on")?.textContent || w.querySelector("h2")?.textContent || "") : "", document.querySelector("main h1, form:not([hidden]) h1, h1")?.textContent?.slice(0, 60) || ""].join("|"); };
  function watchStuck() {
    setInterval(() => { if (document.hidden) { since = Date.now(); return; } const s = sig(); if (s !== lastSig) { lastSig = s; since = Date.now(); return; }
      const w = where(); if (w && Date.now() - since >= 60e3 && Date.now() - lastInput > 15e3) offer(); }, 3000);
    document.addEventListener("input", (e) => { if (e.target !== host) lastInput = Date.now(); }, true);
    // tapping a button on the step (Copy invite, Next, Save) is progress
    document.addEventListener("click", (e) => { if (e.target !== host && e.target.closest?.("button, a, [role=button]")) since = Date.now(); }, true);
    // the same error twice, on any form or step
    const ERR = "#err, #wzErr, #wlErr, .err, .error, [role=alert], #pipToast, .toast", seen = new Map();
    const bad = (t) => /couldn'?t|can'?t|went wrong|try again|doesn'?t|isn'?t|needs|add your|already|invalid|error|failed|too many|expired/i.test(t);
    const check = (el, fromToast) => { if (!el || el === host || (el.isConnected && !el.getClientRects().length)) return; const t = (el.textContent || "").trim().slice(0, 200); if (!t || (fromToast && !bad(t))) return;
      const now = Date.now(), k = t.toLowerCase(), prev = seen.get(k); if (prev && now - prev.at < 250) return; const n = (prev?.n || 0) + 1; seen.set(k, { n, at: now });
      if (P === "/signup" && /already have an account|invite-only|host code/i.test(t)) return offer();
      if (n >= 2) offer(); };
    new MutationObserver((ms) => { const els = new Set(); for (const m of ms) { const el = (m.target.nodeType === 1 ? m.target : m.target.parentElement)?.closest?.(ERR); if (el) els.add(el); } for (const el of els) check(el, el.matches("#pipToast, .toast")); }).observe(document.body, { childList: true, subtree: true, characterData: true });
    // the sign-in page reloads with ?error=…: two misses in a row count as the same error twice
    if (P === "/login" && /[?&]error=/.test(location.search)) { const n = +(ss.get("encore.help.loginErr") || 0) + 1; ss.set("encore.help.loginErr", String(n)); if (n >= 2) setTimeout(offer, 800); }
    // a known stuck point: Plans with nothing on it, for someone who came looking for an invite
    if (PLANS) setTimeout(() => { const e = document.querySelector(".empty"); if (e && e.getClientRects().length && /Nothing on yet/i.test(e.textContent || "")) offer("Looking for an invite? I can help you find it."); }, 6000);
    window.addEventListener("encore:help-error", (e) => { const d = document.createElement("span"); d.textContent = String(e.detail?.message || e.detail || "error"); check(d, false); });
  }

  function start() {
    btn().onclick = () => open();
    // each X by its own selector: the nudge's X comes first in the template, so a bare ".eh-x" would find it
    panel().querySelector(".eh-head .eh-x").addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); close(); });
    scrim().addEventListener("click", () => close());
    swipe($(".eh-grab")); swipe($(".eh-head"));
    $(".eh-human").onclick = () => personForm(); $(".eh-urgent").onclick = () => personForm("", { urgent: true });
    window.addEventListener("pl:status", drawStatus);
    nudge().querySelector(".eh-nx").onclick = () => { hideNudge(); btn().focus(); };
    nudge().querySelector('[data-nudge="ask"]').onclick = () => { open(true); if (PLANS && !log.length) ask(Q.findInv[1]); };
    nudge().querySelector('[data-nudge="person"]').onclick = () => { const t = P === "/signup" ? (/(already have an account)/i.test(document.getElementById("err")?.textContent || "") ? "email_taken" : /invite|code/i.test(document.getElementById("err")?.textContent || "") ? "code" : "") : /^\/(forgot|reset)$/.test(P) ? "reset" : ""; personForm(t); };
    $(".eh-ask").onsubmit = (e) => { e.preventDefault(); const t = $(".eh-ask textarea"); const v = t.value; t.value = ""; ask(v); };
    $(".eh-ask textarea").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $(".eh-ask").requestSubmit(); } });
    root.addEventListener("click", (e) => { const t = e.target.closest?.("[data-q],[data-role],[data-person],[data-do],[data-rate],[data-trate],[data-clear]"); if (!t) return;
      if (t.dataset.q) return ask(t.dataset.q); if (t.dataset.role) { roleSet = t.dataset.role; ss.set("encore.help.role", roleSet); return drawChips(); } if (t.hasAttribute("data-person")) return personForm("", { urgent: t.dataset.person === "urgent" }); if (t.dataset.do) return runDo(t.dataset.do);
      if (t.dataset.rate) return rate(+t.dataset.i, t.dataset.rate); if (t.dataset.trate) return rateTicket(t.dataset.t, t.dataset.trate);
      if (t.hasAttribute("data-clear")) { log = log.filter((m) => m.role === "ticket"); saveLog(); drawLog(); $("#ehTitle").focus(); } });
    // Esc closes, and Tab stays inside, before any page handler (the wizard's own Esc) sees the key
    window.addEventListener("keydown", (e) => {
      if (isOpen()) { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
        if (e.key === "Tab") { const f = focusables(); if (!f.length) return; const a = root.activeElement, i = f.indexOf(a); if (e.shiftKey ? i <= 0 : i === f.length - 1 || i < 0) { e.preventDefault(); (e.shiftKey ? f[f.length - 1] : f[0]).focus(); } } return; }
      if (e.key === "Escape" && !nudge().hidden) { e.stopImmediatePropagation(); hideNudge(); } }, true);
    // the reply time people are promised (ENCORE_SUPPORT_REPLY_HOURS on the server)
    const cached = ss.get("encore.help.within"); if (cached) within = cached;
    fetch("/api/help/info", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.promise) { promise = j.promise; const pr = $(".eh-promise"); if (pr) pr.textContent = promise; } if (j?.replyWithin) { within = j.replyWithin; ss.set("encore.help.within", within); $(".eh-sub").textContent = `Potto answers from the help guide. A person replies ${within}.`; } }).catch(() => {});
    $(".eh-sub").textContent = `Potto answers from the help guide. A person replies ${within}.`;
    watchStuck();
    if (signedIn()) loadTickets().then(badge);
    const q = new URLSearchParams(location.search);
    if (q.get("help") === "1") { setTimeout(async () => { await loadTickets(true); open(); }, 400); }
    doFromUrl();
    document.addEventListener("click", (ev) => { const t = ev.target.closest?.("[data-help-open],[data-help]"); if (!t || (t.hasAttribute("data-help-open") && signedIn() && window.PLPotto)) return; ev.preventDefault(); open({ role: t.dataset.help || "", urgent: t.hasAttribute("data-help-urgent"), errorId: t.dataset.err || "" }); });
    window.EncoreHelp = window.PLHelp = { open, close, person: personForm, offer, ask, isOpen, urgent: () => personForm("", { urgent: true }) }; // review round 8: open() for the wizard's own link
  }
  document.body ? mount() : document.addEventListener("DOMContentLoaded", mount);
})();
