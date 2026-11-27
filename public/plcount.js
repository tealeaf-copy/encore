// Usage counts with PostHog (docs/analytics.md). The server adds this script only when ENCORE_POSTHOG_KEY is set
// (server/posthog.js analyticsTag), with the public project key and host on the tag.
// - Nothing loads before consent: the first visit shows a small notice (OK / No thanks), kept in this browser.
//   "No thanks", Do Not Track or Global Privacy Control mean no PostHog at all. Settings has the same switch.
// - No autocapture, no surveys, no heatmaps; all text and attributes masked; session replay only with data-r="1"
//   (ENCORE_POSTHOG_REPLAY=1), and then every input and all text are masked too.
// - Page views carry the path only: query strings and #hashes are dropped (invite links carry reply ids and codes
//   there), and path parts that look like tokens become :token. No page titles, no campaign params, no IP location.
// - Signed in: identified by the same salted hash the server uses (/api/me/analytics), never an email or a name.
(function () {
  if (window.__plCount) return; window.__plCount = 1;
  const tag = document.currentScript || document.querySelector('script[src*="/plcount.js"]'); if (!tag) return;
  const K = tag.dataset.k, H = tag.dataset.h, A = tag.dataset.a || H, R = tag.dataset.r === "1"; if (!K || !H) return;
  const KEY = "pl-count", ID = "pl-count-id";
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const put = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
  const dnt = () => navigator.globalPrivacyControl === true || navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.msDoNotTrack === "1";
  const signedIn = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);

  // ---- URLs: the path only, tokens out
  const TOKEN_ROOT = /^(reconfirm|survey|l|k|p|verify|unsubscribe|reset|cg|inv|auth|sso|door|lists|magic|come-with|r|t)$/;
  const cleanPath = (p) => { const segs = String(p || "/").split("/").filter(Boolean);
    return "/" + segs.map((s, i) => { let d = s; try { d = decodeURIComponent(s); } catch {}
      if (i > 0 && TOKEN_ROOT.test(segs[0])) return ":token";
      if (i > 1 && segs[0] === "plans" && /^(feed|ics)$/.test(segs[1])) return ":token";
      if (i === 0 && /^@[a-z0-9][a-z0-9-]{0,29}$/.test(d)) return d;
      if (/^[a-z0-9-]{1,40}\.html$/i.test(d)) return s;
      if (d.length > 20 || /[@.=+:]/.test(d) || /^[\d -]{6,}$/.test(d)) return ":token";
      return s; }).join("/"); };
  const cleanUrl = (u) => { try { const x = new URL(u, location.href); return x.origin === location.origin ? x.origin + cleanPath(x.pathname) : x.origin; } catch { return null; } };
  const URLISH = /^(\$current_url|\$referrer|\$initial_referrer|\$initial_current_url|\$session_entry_url|\$session_entry_referrer|\$initial_referring_url)$/;
  const PATHISH = /^(\$pathname|\$initial_pathname|\$session_entry_pathname|\$prev_pageview_pathname)$/;
  const DROP = /(^title$|^\$title$|^\$el_|^\$elements|utm_|clid$|^gad_|^mc_|^igshid|^\$initial_(utm|gclid|fbclid)|^\$session_entry_(utm|gclid|fbclid)|^\$search_engine|^\$feature_flag_payloads?$)/i;
  const scrub = (P) => { if (!P || typeof P !== "object") return P;
    for (const k of Object.keys(P)) { const v = P[k];
      if (DROP.test(k)) delete P[k];
      else if (URLISH.test(k)) P[k] = typeof v === "string" && v ? cleanUrl(v) : v;
      else if (PATHISH.test(k)) P[k] = typeof v === "string" ? cleanPath(v.split(/[?#]/)[0]) : v;
      else if (typeof v === "string" && /^https?:\/\//.test(v)) P[k] = cleanUrl(v);
      else if (typeof v === "string" && /@|[?#&](rid|code|token|k|t)=/.test(v)) delete P[k]; }
    return P; };
  const EVENTS = new Set(["$pageview", "$identify", "$opt_in", ...(R ? ["$snapshot"] : [])]);
  const beforeSend = (ev) => { if (!ev || !EVENTS.has(ev.event)) return null; if (ev.event === "$snapshot") return ev;
    const P = scrub(ev.properties || {}); P.$ip = null; P.$geoip_disable = true; ev.properties = P;
    if (ev.$set) scrub(ev.$set); if (ev.$set_once) scrub(ev.$set_once); return ev; };

  // ---- PostHog: the official snippet, the script from the PostHog host
  let loaded = false;
  const load = (id) => { if (loaded || dnt() || get(KEY) !== "yes") return; loaded = true;
    !(function (t, e) { let o, n, p, r; e.__SV || ((window.posthog = e), (e._i = []), (e.init = function (i, s, a) { function g(t, e) { const o = e.split("."); 2 == o.length && ((t = t[o[0]]), (e = o[1])), (t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))); }); }
      ((p = t.createElement("script")).type = "text/javascript"), (p.crossOrigin = "anonymous"), (p.async = !0), (p.src = A + "/static/array.js"), (r = t.getElementsByTagName("script")[0]).parentNode.insertBefore(p, r);
      let u = e; for (void 0 !== a ? (u = e[a] = []) : (a = "posthog"), u.people = u.people || [], u.toString = function (t) { let e = "posthog"; return "posthog" !== a && (e += "." + a), t || (e += " (stub)"), e; }, u.people.toString = function () { return u.toString(1) + ".people (stub)"; },
        o = "init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags on onFeatureFlags onSessionId identify setPersonProperties group resetGroups reset get_distinct_id getGroups get_session_id alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "), n = 0; n < o.length; n++) g(u, o[n]);
      e._i.push([i, s, a]); }), (e.__SV = 1)); })(document, window.posthog || []);
    window.posthog.init(K, {
      api_host: H, persistence: "localStorage", person_profiles: "identified_only", respect_dnt: true, ip: false,
      autocapture: false, capture_pageview: "history_change", capture_pageleave: false, rageclick: false, capture_dead_clicks: false, capture_performance: false, capture_exceptions: false, enable_heatmaps: false,
      disable_surveys: true, disable_web_experiments: true, advanced_disable_feature_flags: true, advanced_disable_feature_flags_on_first_load: true, disable_external_dependency_loading: !R,
      mask_all_text: true, mask_all_element_attributes: true,
      disable_session_recording: !R, session_recording: { maskAllInputs: true, maskTextSelector: "*", maskInputOptions: { password: true, email: true, tel: true, text: true, textarea: true, number: true, search: true } },
      before_send: beforeSend, sanitize_properties: (P) => scrub(P),
      loaded: (ph) => { try { ph.register({ $geoip_disable: true });
        if (id) { ph.identify(id); put(ID, id); } else if (get(ID)) { ph.reset(); put(ID, null); } } catch {} },
    }); };
  // signed in: the server says who (a hash) and whether they turned counts off in Settings
  const start = () => { if (dnt() || get(KEY) !== "yes") return;
    if (!signedIn()) return load(null);
    fetch("/api/me/analytics", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && d.on === false) { put(KEY, "no"); return; } load(d && d.id); }).catch(() => load(null)); };
  const set = (on) => { put(KEY, on ? "yes" : "no"); const ph = window.posthog;
    if (on) { if (loaded && ph?.opt_in_capturing) ph.opt_in_capturing(); else start(); } else if (loaded && ph?.opt_out_capturing) ph.opt_out_capturing(); };
  window.PLCount = { set, on: () => get(KEY) === "yes" && !dnt(), cleanPath, cleanUrl, beforeSend };

  // ---- the one-time notice
  const notice = () => { if (dnt() || get(KEY) || document.getElementById("plc")) return;
    const st = document.createElement("style");
    st.textContent = "#plc{position:fixed;z-index:2147483000;left:16px;right:16px;bottom:calc(84px + env(safe-area-inset-bottom,0px));box-sizing:border-box;max-width:380px;margin:0 auto;padding:14px 16px;border-radius:14px;background:var(--pl-card,#fffdf8);color:var(--pl-ink,#1f1d1a);border:1px solid var(--pl-line,rgba(0,0,0,.12));box-shadow:0 8px 28px rgba(0,0,0,.14);font:15px/1.45 var(--pl-font-text,system-ui,sans-serif)}#plc p{margin:0 0 10px}#plc a{color:inherit}#plc .b{display:flex;gap:8px;justify-content:flex-end}#plc button{font:inherit;font-weight:600;min-height:40px;padding:8px 16px;border-radius:999px;cursor:pointer;border:1px solid var(--pl-line-strong,rgba(0,0,0,.25));background:transparent;color:inherit}#plc button.ok{background:var(--pl-ink,#1f1d1a);color:var(--pl-page,#fffdf8);border-color:transparent}@media (min-width:760px){#plc{left:auto;right:20px;bottom:20px;margin:0}}";
    const el = document.createElement("div"); el.id = "plc"; el.setAttribute("role", "region"); el.setAttribute("aria-label", "Usage counts");
    el.innerHTML = '<p>We count visits to improve Pottery Lab. No ads, no selling data. <a href="/privacy#analytics">More</a></p><div class="b"><button type="button" class="no">No thanks</button><button type="button" class="ok">OK</button></div>';
    const done = (on) => { set(on); el.remove(); st.remove(); };
    el.querySelector(".ok").onclick = () => done(true); el.querySelector(".no").onclick = () => done(false);
    document.head.appendChild(st); document.body.appendChild(el); };
  const later = (f) => (window.requestIdleCallback ? requestIdleCallback(f, { timeout: 3000 }) : setTimeout(f, 1500));
  const go = () => { if (get(KEY) === "yes") start(); else if (!get(KEY)) later(notice); };
  if (document.body) go(); else document.addEventListener("DOMContentLoaded", go, { once: true });
})();
