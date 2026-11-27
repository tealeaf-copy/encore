// On every page (server/appstore.js adds it to <head>, deferred). Three small jobs, nothing loaded up front:
// 1. Help for everyone: any [data-help] link (the nav, footers, invites, chats, error pages, toasts) loads
//    public/help.js on the first tap and opens it, signed in or not. window.PLHelp / EncoreHelp stand in until it
//    has loaded, so pages that call PLHelp.open() work before it is there. A page with no help link of its own gets one
//    small "Help" link in its footer. ?help=1 in the address opens it (the reply emails link there).
// 2. Problems seen without anyone reporting them: a script error or an unhandled rejection posts a compact report
//    (POST /api/errors: a random id, the message, the top of the stack, the path, the app version). Never what anyone
//    typed, never a query string; 5 a page at most, each problem once. The last ids stay in this tab so a help ticket
//    can carry them. A "Something went wrong" toast gets "Get help" and its ref, so support can match it.
// 3. The status line: when the team has posted one (GET /api/status, server/launch.js), a quiet line at the top.
(function () {
  if (window.PLReport) return;
  const P = location.pathname, ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} } };
  const me = document.currentScript, APP = (() => { try { return new URL(me?.src || "", location.href).searchParams.get("v") || ""; } catch { return ""; } })();
  const rid = () => { let s = ""; try { const a = new Uint8Array(8); crypto.getRandomValues(a); for (const x of a) s += "abcdefghjkmnpqrstuvwxyz23456789"[x % 31]; } catch { s = Math.random().toString(36).slice(2, 10); } return s.slice(0, 8); };

  // ---------- 2. errors ----------
  const recent = () => { try { return JSON.parse(ss.get("pl.errs") || "[]"); } catch { return []; } };
  const seen = new Map(); let sent = 0, serverRef = null;
  const NOISE = /ResizeObserver loop|AbortError|aborted|Transition was|view ?transition|Failed to fetch|Load failed|NetworkError|network error|cancelled|Non-Error promise rejection/i;
  function report(kind, message, stack) {
    const m = String(message || "").slice(0, 300), st = String(stack || "").split("\n").slice(0, 6).join("\n").slice(0, 1200);
    if (!m || NOISE.test(m) || (/^Script error\.?$/i.test(m) && !st) || /extension:\/\//.test(st)) return "";
    const fp = kind + "|" + m + "|" + st.split("\n")[1]; if (seen.has(fp)) return seen.get(fp);
    const id = rid(); seen.set(fp, id);
    const L = recent().filter((x) => Date.now() - x.at < 36e5); L.push({ id, at: Date.now() }); ss.set("pl.errs", JSON.stringify(L.slice(-5)));
    if (sent++ < 5) { const ref = serverRef && Date.now() - serverRef.at < 15e3 ? serverRef.id : "";
      const body = JSON.stringify({ id, kind, message: m, stack: st, page: P, app: APP, ...(ref ? { serverRef: ref } : {}) });
      try { if (!(navigator.sendBeacon && navigator.sendBeacon("/api/errors", new Blob([body], { type: "application/json" })))) fetch("/api/errors", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true, credentials: "same-origin" }).catch(() => {}); } catch {} }
    return id;
  }
  addEventListener("error", (e) => { if (e.target && e.target !== window) return; report("error", e.message, e.error?.stack || (e.filename ? `at ${e.filename}:${e.lineno}:${e.colno}` : "")); });
  addEventListener("unhandledrejection", (e) => { const r = e.reason; report("rejection", r?.message || (typeof r === "string" ? r : r?.name || ""), r?.stack || ""); });
  // a server error's ref (server/perf.js) rides along with the next report and the toast
  try { const f = window.fetch; if (typeof f === "function") window.fetch = function (...a) { return f.apply(this, a).then((r) => { if (r && r.status >= 500) r.clone().json().then((j) => { if (j && /^[a-z0-9]{6,16}$/.test(j.ref || "")) serverRef = { id: j.ref, at: Date.now() }; }).catch(() => {}); return r; }); }; } catch {}

  // ---------- 1. help, loaded on the first tap ----------
  let loading = null;
  const load = () => loading || (loading = new Promise((ok, no) => { window.__ehLazy = 1; const s = document.createElement("script"); s.src = "/help.js"; s.async = true; s.onload = () => ok(); s.onerror = () => { loading = null; no(new Error("help")); }; (document.head || document.documentElement).appendChild(s); }));
  const real = () => { const H = window.EncoreHelp; return H && !H.lazy ? H : null; };
  async function go(fn, arg) { try { if (!real()) await load(); const H = real(); if (H && H[fn]) H[fn](arg); } catch { location.href = "/help" + (arg?.errorId ? "?err=" + arg.errorId : ""); } }
  const stub = { lazy: true, open: (o) => go("open", o), person: (t) => go("person", t), urgent: () => go("urgent"), ask: (q) => go("ask", q), offer() {}, close() {}, isOpen: () => false };
  if (!window.EncoreHelp) window.EncoreHelp = window.PLHelp = stub;
  const signed = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.("[data-help],[data-help-open]"); if (!a || real()) return; // once help.js is here it takes its own links
    if (a.hasAttribute("data-help-open") && signed() && window.PLPotto) return; // signed in, the Help row opens Ask Potto (public/potto.js)
    e.preventDefault(); const H = window.EncoreHelp; H.open({ role: a.dataset.help || "", urgent: a.hasAttribute("data-help-urgent"), errorId: a.dataset.err || "" });
  });
  if (/[?&]help=1\b/.test(location.search)) addEventListener("load", () => setTimeout(() => go("open", {}), 300), { once: true });

  // a footer link on pages that have no help of their own (the shell's nav, invites and chats carry their own)
  const OWN = /^\/(support|admin|help|chats|demo|sso|g|signup|login|forgot|reset|join|onboard)(\/|$)/; // these carry their own (the onboarding pages have help.js's floating button)
  function footLink() {
    if (OWN.test(P) || (P === "/" && signed()) || document.querySelector("[data-help],[data-help-open],a[href='/help']")) return;
    const f = [...document.querySelectorAll("footer")].at(-1), a = document.createElement("a"); a.href = "/help"; a.setAttribute("data-help", ""); a.textContent = "Help";
    if (f) { a.className = "pl-help-link"; f.append(" ", a); return; }
    const p = document.createElement("p"); p.className = "pl-help-foot"; p.style.cssText = "margin:24px 16px 32px;text-align:center;font:500 16px/1.4 var(--pl-font-text,'IBM Plex Sans',system-ui,sans-serif);color:var(--pl-soft,#444845)";
    a.textContent = "Need a hand? Get help"; a.style.color = "var(--pl-accent-text,#29489A)"; p.append(a); (document.querySelector("main") || document.body).append(p);
  }

  // "Something went wrong" toasts: add Get help and the ref
  const TOAST = "#pipToast,.toast,[role=alert],[role=status],.ch-toast,.pl-toast,#toast,.err,.error";
  function mark(el) {
    if (!el || el.querySelector?.(".pl-gethelp") || el.closest?.("#encoreHelp")) return; const t = (el.textContent || "").trim();
    if (t.length > 200 || !/\bwent wrong\b/i.test(t)) return;
    const ref = serverRef && Date.now() - serverRef.at < 15e3 ? serverRef.id : report("toast", "Something went wrong toast", "") || rid();
    const a = document.createElement("a"); a.href = "/help?err=" + ref; a.className = "pl-gethelp"; a.setAttribute("data-help", ""); a.dataset.err = ref; a.textContent = "Get help";
    a.style.cssText = "margin-left:6px;color:inherit;font-weight:600;text-decoration:underline;pointer-events:auto"; const s = document.createElement("small"); s.className = "pl-gethelp-ref"; s.textContent = " Ref " + ref; s.style.opacity = ".85";
    el.append(" ", a, s); if (getComputedStyle(el).pointerEvents === "none") el.style.pointerEvents = "auto";
  }
  function watchToasts() { let q = new Set(), t = 0;
    new MutationObserver((ms) => { for (const m of ms) { const n = m.target.nodeType === 1 ? m.target : m.target.parentElement; const el = n?.closest?.(TOAST); if (el) q.add(el); }
      if (q.size && !t) t = setTimeout(() => { t = 0; const L = [...q]; q = new Set(); L.forEach(mark); }, 60); }).observe(document.body, { childList: true, subtree: true, characterData: true }); }

  // ---------- 3. the status line ----------
  let incident = null;
  function banner(x) {
    incident = x; window.dispatchEvent(new CustomEvent("pl:status", { detail: x })); if (!x || document.getElementById("plStatus") || ss.get("pl.statusHide") === x.message) return;
    const b = document.createElement("div"); b.id = "plStatus"; b.setAttribute("role", "status");
    b.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);top:calc(8px + env(safe-area-inset-top,0px));z-index:9400;max-width:min(560px,calc(100vw - 32px));display:flex;gap:8px;align-items:center;background:var(--pl-sand,#F3E7A8);color:var(--pl-ink,#1B1D1C);border:1.5px solid var(--pl-ink,#1B1D1C);border-radius:8px;padding:6px 6px 6px 12px;font:500 16px/1.35 var(--pl-font-text,'IBM Plex Sans',system-ui,sans-serif);box-shadow:0 6px 20px -12px rgba(0,0,0,.4)";
    const t = document.createElement("span"); t.textContent = x.message; const h = document.createElement("a"); h.href = "/help"; h.setAttribute("data-help", ""); h.textContent = "Help"; h.style.cssText = "color:inherit;font-weight:600";
    const c = document.createElement("button"); c.type = "button"; c.setAttribute("aria-label", "Hide this"); c.textContent = "×"; c.style.cssText = "border:0;background:none;font:600 20px/1 system-ui;min-width:44px;min-height:44px;cursor:pointer;color:inherit";
    c.onclick = () => { ss.set("pl.statusHide", x.message); b.remove(); }; b.append(t, h, c); document.body.append(b);
  }
  function status() { const c = (() => { try { return JSON.parse(ss.get("pl.status") || "null"); } catch { return null; } })();
    if (c && Date.now() - c.at < 60e3) return banner(c.incident);
    fetch("/api/status", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (!j) return; ss.set("pl.status", JSON.stringify({ at: Date.now(), incident: j.incident || null })); banner(j.incident || null); }).catch(() => {}); }

  window.PLReport = { report: (err, kind = "error") => report(kind, err?.message || String(err || ""), err?.stack || ""), recent: () => recent().map((x) => x.id), app: APP, status: () => incident, load };
  // the footer link waits until the page has drawn itself, so it never sits mid-screen and gets pushed down (no layout shift)
  const start = () => { watchToasts(); const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1200)); idle(status, { timeout: 4000 });
    const foot = () => setTimeout(() => idle(footLink, { timeout: 3000 }), 1500); if (document.readyState === "complete") foot(); else addEventListener("load", foot, { once: true }); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true }); else start();
})();
