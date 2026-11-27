// The iOS (and later Android) app: what the web server does for it. See mobile/README.md.
// - PWA groundwork: the manifest link, icons, iOS launch images and the service worker on every page (pwaHead),
//   /sw.js stamped with a content hash so a new version replaces the old caches
// - Universal links (/.well-known/apple-app-site-association) and Android App Links (/.well-known/assetlinks.json)
// - /settings (account, notifications, blocked people, delete account) and /community (the rules and how to report)
// - mounts account deletion (server/account.js), report and block (server/safety.js) and push (server/push.js)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { mountAccount } from "./account.js";
import { mountSafety } from "./safety.js";
import { mountPush } from "./push.js";
import { SPECULATION } from "./perf.js";

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

/** The Apple team id, bundle id and Android package the links and pushes use (env, with placeholders). */
export function appIds(env = process.env) {
  const team = String(env.ENCORE_APPLE_TEAM_ID || "").trim() || "TEAMID0000";
  const bundle = String(env.ENCORE_IOS_BUNDLE_ID || "").trim() || "com.potterylab.app";
  const pkg = String(env.ENCORE_ANDROID_PACKAGE || "").trim() || "com.potterylab.app";
  const sha = String(env.ENCORE_ANDROID_SHA256 || "").split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter((x) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(x));
  return { team, bundle, appId: `${team}.${bundle}`, placeholder: !env.ENCORE_APPLE_TEAM_ID, pkg, sha };
}

// Paths the app opens itself when someone taps a link to them (everything else stays in Safari).
export const APP_PATHS = ["/e/*", "/i/*", "/g", "/@*", "/x/*", "/feed", "/auth/app", "/auth/email"]; // sign-in links (server/signin.js): the email link and a hand-off open in the app

/** apple-app-site-association: universal links, shared web credentials (password autofill), App Clip. */
export function aasa(env = process.env) {
  const { appId } = appIds(env);
  return {
    applinks: {
      // iOS 13+: components. /g carries the event in its #fragment, so any fragment matches.
      details: [{ appIDs: [appId], components: [...APP_PATHS.map((p) => ({ "/": p, comment: `Open ${p} in the app` })), { "/": "/g", "#": "*" }] }],
    },
    webcredentials: { apps: [appId] },
    appclips: { apps: [appId + ".Clip"] },
  };
}

/** assetlinks.json: Android App Links for the same paths (the app's intent filters list them). */
export function assetLinks(env = process.env) {
  const { pkg, sha } = appIds(env);
  return [{ relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"], target: { namespace: "android_app", package_name: pkg, sha256_cert_fingerprints: sha } }];
}

let splash = [];
try { splash = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, "icons", "splash.json"), "utf8")); } catch {}
const SPLASH_LINKS = splash.map((s) => `<link rel="apple-touch-startup-image" media="(device-width: ${s.dw}px) and (device-height: ${s.dh}px) and (-webkit-device-pixel-ratio: ${s.r}) and (orientation: portrait)" href="${s.src}">`).join("");
const SW_REG = `<script>if("serviceWorker"in navigator&&!/^\\/(sw|support)/.test(location.pathname))addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(()=>{}))</script>`;
// The light invite (/e/, /i/) has a 40,000-character budget: it gets only the essentials.
// a page-to-page fade the browser skips rejects its promises; that's not an error (public/netguard.js does the same on
// full pages, this is the light invite's copy)
const VT_QUIET = `<script>addEventListener("pagereveal",(e)=>{const t=e.viewTransition;if(t)["ready","finished","updateCallbackDone"].forEach((k)=>t[k]&&t[k].catch(()=>{}))})</script>`;
const LIGHT = VT_QUIET + `<link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#EFEBE2"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"><script src="/native.js" defer></script><script src="/report.js" defer></script>`; // help for everyone, error reports, the status line (public/report.js)
// every full page: network manners first (public/netguard.js), then the app tags; the speculation rules prefetch a page
// link a finger lands on (server/perf.js)
// the page-to-page fade's opt-in, in the head of every full page: public/craft.css has the same rule, but it is added by
// a script and lands after the first paint, so the browser found no opt-in on the new page and aborted the fade (and
// reported an unhandled rejection on every move between pages)
const VT_OPT_IN = `<style>@view-transition{navigation:auto}::view-transition-old(root),::view-transition-new(root){animation-duration:.15s}@media (prefers-reduced-motion:reduce){@view-transition{navigation:none}}</style>`;
const FULL = `<script src="/netguard.js"></script>` + VT_OPT_IN + LIGHT + SPECULATION + `<meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Pottery Lab"><meta name="apple-mobile-web-app-status-bar-style" content="default"><link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">` + SPLASH_LINKS + SW_REG;
// Report and block (public/safety.js) where people's posts, photos, kudos and host pages show
const SAFETY_PAGES = /^\/($|feed|@|h\/|x\/|discover|photos|kudos|leaderboard|settings|community|g$)/;

/**
 * Add the app tags to a page's <head>, once. path: the request path (picks the light set for /e/ and /i/, and adds
 * public/safety.js where people's content shows).
 */
export function pwaHead(html, reqPath = "/") {
  const s = String(html);
  if (s.includes('rel="manifest"') || !/<head[^>]*>/i.test(s)) return s;
  const light = /^\/(e|i)\//.test(reqPath);
  const tags = (light ? LIGHT : FULL) + (!light && SAFETY_PAGES.test(reqPath) ? `<script src="/safety.js" defer></script>` : "");
  // after <meta charset> when the page has one near the top (it has to stay in the first 1024 bytes), else after <head>
  const cs = /<meta charset=[^>]*>/i.exec(s.slice(0, 1024));
  return cs ? s.slice(0, cs.index + cs[0].length) + tags + s.slice(cs.index + cs[0].length) : s.replace(/<head[^>]*>/i, (m) => m + tags);
}

// /sw.js: the file with VERSION set to a hash of what the shell caches, so any change installs a new worker.
let swCache = null;
function swBody() {
  const files = ["sw.js", "offline.html", "manifest.webmanifest", "native.js"].map((f) => { try { return fs.readFileSync(path.join(PUBLIC_DIR, f)); } catch { return Buffer.alloc(0); } });
  const version = crypto.createHash("sha1").update(Buffer.concat(files)).digest("hex").slice(0, 12);
  if (swCache?.version === version) return swCache;
  swCache = { version, body: files[0].toString("utf8").replace("__SW_VERSION__", version) };
  return swCache;
}

export function mountAppStore(app, deps) {
  const { sendStatic } = deps;
  app.get("/sw.js", (req, res) => { const S = swBody(); res.set({ "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache", "Service-Worker-Allowed": "/" }).send(S.body); });
  app.get("/manifest.webmanifest", (req, res) => res.set({ "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" }).sendFile(path.join(PUBLIC_DIR, "manifest.webmanifest"), { dotfiles: "allow" }));
  // served as JSON, no redirect, no extension (Apple's CDN fetches it once per install and on updates)
  const aasaSend = (req, res) => res.set({ "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" }).send(JSON.stringify(aasa()));
  app.get("/.well-known/apple-app-site-association", aasaSend);
  app.get("/apple-app-site-association", aasaSend);
  app.get("/.well-known/assetlinks.json", (req, res) => res.set({ "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" }).send(JSON.stringify(assetLinks())));
  app.get("/settings", (req, res) => sendStatic(res, "settings.html", "<p>Settings page missing.</p>"));
  app.get("/community", (req, res) => sendStatic(res, "community-rules.html", "<p>Page missing.</p>"));
  const push = mountPush(app, deps);
  const safety = mountSafety(app, deps);
  const account = mountAccount(app, { ...deps, push, safety });
  app.locals.appstore = { push, safety, account };
  return app.locals.appstore;
}
