// Speed and robustness at the HTTP layer (docs/perf.md has the numbers behind each piece):
// - versioned assets: pages ask for /x.js?v=<hash of the file>, which is cached for a year (immutable); a new file
//   gets a new hash, so nothing stale is ever served and repeat visits skip the revalidation round trip per script
// - self-hosted fonts: the Google Fonts links on our pages point at /fonts/css2 (same query), served from public/fonts
//   with font-display: swap, so a phone opens no second and third origin before the first paint; the display face
//   (IBM Plex Serif 600) is preloaded
// - compressed JSON: API answers over 1.4 KB go out brotli (or gzip), the feed and chats are 4-6x smaller on the wire
// - idempotency keys: a POST/PUT/PATCH sent twice with the same Idempotency-Key (a double tap, a retry after a dropped
//   answer) runs once; the second gets the first one's answer, and one sent while the first is still running waits for it
// - the speculation rules a page carries (prefetch a link the moment a finger or pointer settles on it)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { analyticsTag } from "./posthog.js";

// ---------------------------------------------------------------- versioned assets
const hashes = new Map(); // abs path -> { at, mtime, v }
const RECHECK_MS = 2000;
/** A short content hash for a file in dir (null when it isn't there). Rechecked at most every 2s. */
export function assetVersion(dir, rel) {
  const f = path.join(dir, rel); if (!f.startsWith(dir + path.sep)) return null;
  const now = Date.now(), c = hashes.get(f); if (c && now - c.at < RECHECK_MS) return c.v;
  let st; try { st = fs.statSync(f); if (!st.isFile()) throw 0; } catch { hashes.set(f, { at: now, mtime: 0, v: null }); return null; }
  if (c && c.mtime === st.mtimeMs) { c.at = now; return c.v; }
  const v = crypto.createHash("sha1").update(fs.readFileSync(f)).digest("base64url").slice(0, 10);
  hashes.set(f, { at: now, mtime: st.mtimeMs, v }); return v;
}
// files that must keep a plain URL: the service worker's scope file, and what other servers fetch by name
const UNVERSIONED = /^\/(sw\.js|manifest\.webmanifest|favicon\.svg)$/;
/** Add ?v=<hash> to same-origin script and stylesheet URLs in a page (only for files that exist in dir). */
export function versionAssets(html, dir) {
  return String(html).replace(/(<script\b[^>]*?\ssrc=|<link\b[^>]*?\shref=)(["'])(\/[A-Za-z0-9_\-./]+\.(?:js|css))\2/g, (m, pre, q, url) => {
    if (UNVERSIONED.test(url) || url.includes("..")) return m; const v = assetVersion(dir, url.slice(1)); return v ? `${pre}${q}${url}?v=${v}${q}` : m; });
}
/** The Cache-Control for a static file request: a year and immutable when ?v= names the current version. */
export function assetCache(dir, reqPath, v) {
  return v && v === assetVersion(dir, reqPath.slice(1)) ? "public, max-age=31536000, immutable" : "public, max-age=300";
}

// ---------------------------------------------------------------- fonts
let FACES = null;
const facesOf = (dir) => { if (FACES) return FACES; try { FACES = JSON.parse(fs.readFileSync(path.join(dir, "fonts", "faces.json"), "utf8")); } catch { FACES = []; } return FACES; };
/** The faces a Google Fonts css2 query asks for, or null when any family in it isn't served here. */
export function fontRequest(dir, query) {
  const F = facesOf(dir), fams = String(query || "").split("&").filter((p) => p.startsWith("family=")).map((p) => decodeURIComponent(p.slice(7).replace(/\+/g, " ")));
  if (!fams.length) return null; const out = [];
  for (const spec of fams) {
    const [name, axes = ""] = spec.split(":"), mine = F.filter((f) => f.family === name); if (!mine.length) return null;
    const [keys = "", vals = ""] = axes.split("@"), K = keys ? keys.split(",") : [], tuples = vals ? vals.split(";").map((t) => t.split(",")) : [[]];
    for (const t of tuples) {
      const at = (k) => { const i = K.indexOf(k); return i < 0 ? null : t[i]; };
      const style = at("ital") === "1" ? "italic" : "normal", w = at("wght") || "400";
      const pick = mine.filter((f) => f.style === style && (f.weight === w || (/ /.test(f.weight) && +w >= +f.weight.split(" ")[0] && +w <= +f.weight.split(" ")[1])));
      if (!pick.length) return null; out.push(...pick);
    }
  }
  return [...new Set(out)];
}
export function fontCss(faces) {
  return faces.map((f) => `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};font-display:swap;src:url(/fonts/${f.file}) format('woff2');unicode-range:${f.range}}`).join("\n") + "\n";
}
const DISPLAY = "ibm-plex-serif-latin-600-normal.woff2";
/** Point our pages' Google Fonts links at /fonts/css2 (only when every family is served here) and preload the display face. */
export function localFonts(html, dir) {
  let pre = false;
  // (a page that holds its fonts back until it has loaded, media="print" like the light invite, gets no preload)
  const out = String(html).replace(/(<link\b[^>]*?)?https:\/\/fonts\.googleapis\.com\/css2\?([^"'\s>]+)([^>]*>)?/g, (m, a = "", q, b = "") => { const amp = q.replace(/&amp;/g, "&"); if (!fontRequest(dir, amp)) return m; if (/IBM\+Plex\+Serif:wght@[^&]*600/.test(amp) && a && !/media=["']?print/.test(a + b)) pre = true; return a + "/fonts/css2?" + q + b; });
  if (!pre || out.includes(`/fonts/${DISPLAY}`)) return out;
  const tag = `<link rel="preload" href="/fonts/${DISPLAY}" as="font" type="font/woff2" crossorigin>`;
  const cs = /<meta charset=[^>]*>/i.exec(out.slice(0, 1024));
  return cs ? out.slice(0, cs.index + cs[0].length) + tag + out.slice(cs.index + cs[0].length) : out.replace(/<head[^>]*>/i, (h) => h + tag);
}

// ---------------------------------------------------------------- data preload
/**
 * The first API read a page makes, started by the browser while it is still parsing the page (instead of after every
 * script in it has run). The URL must be exactly the one the page's script asks for, so the fetch picks up the answer.
 */
export function dataPreload(reqPath, cookie = "") {
  const signedIn = /(?:^|;\s*)(encore_in=1|encore_auth=)/.test(cookie || ""); // the hint, or the session cookie itself on a first visit
  let m, url = "";
  if ((m = /^\/@([a-z0-9][a-z0-9-]{1,29})$/.exec(reqPath))) url = "/api/public/host/" + encodeURIComponent(m[1]); // public/host.html
  else if ((m = /^\/[ei]\/([A-Za-z0-9_-]{2,80})$/.exec(reqPath)) && m[1] !== "_preview") url = "/api/public/event-host/" + encodeURIComponent(m[1]); // public/invite.html
  else if (reqPath === "/discover") url = "/api/public/discover"; // public/discover.html
  else if (reqPath === "/feed" && signedIn) url = "/api/me/feed"; // public/feed.html, signed in
  return url ? `<link rel="preload" href="${url}" as="fetch" crossorigin="anonymous">` : "";
}
const atHeadStart = (html, tag) => { const cs = /<meta charset=[^>]*>/i.exec(html.slice(0, 1024)); return cs ? html.slice(0, cs.index + cs[0].length) + tag + html.slice(cs.index + cs[0].length) : html.replace(/<head[^>]*>/i, (h) => h + tag); };
/** A page's head gets its data preload (once). */
export function withPreload(html, reqPath, cookie) { const tag = dataPreload(reqPath, cookie); return tag && !String(html).includes(tag) ? atHeadStart(String(html), tag) : html; }

/** Every change a page gets on the way out (fonts first: they rewrite links the versioning then leaves alone). */
// (and, only when PostHog is configured, the analytics loader in the head: server/posthog.js analyticsTag)
export function optimizeHtml(html, dir) { return versionAssets(localFonts(analyticsTag(html), dir), dir); }

// ---------------------------------------------------------------- compression
const accepts = (req, enc) => new RegExp(`\\b${enc}\\b`).test(req.headers["accept-encoding"] || "");
/** Compress a body for this request: brotli at a fast level, else gzip. Returns { body, enc } (enc "" when not worth it). */
export function compressFor(req, buf, { min = 1400, quality = 4 } = {}) {
  if (buf.length < min) return { body: buf, enc: "" };
  if (accepts(req, "br")) return { body: zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: quality, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }), enc: "br" };
  if (accepts(req, "gzip")) return { body: zlib.gzipSync(buf, { level: 6 }), enc: "gzip" };
  return { body: buf, enc: "" };
}
/** Middleware: res.json bodies over 1.4 KB go out compressed (Express still adds the ETag and answers 304s). */
export function compressJson() {
  return (req, res, next) => {
    const json = res.json.bind(res);
    res.json = (obj) => {
      if (res.get("Content-Encoding") || req.method === "HEAD") return json(obj);
      const s = JSON.stringify(obj); if (s === undefined || s.length < 1400 || !/\b(br|gzip)\b/.test(req.headers["accept-encoding"] || "")) return json(obj);
      const { body, enc } = compressFor(req, Buffer.from(s));
      if (!res.get("Content-Type")) res.type("application/json; charset=utf-8");
      res.vary("Accept-Encoding"); if (enc) res.set("Content-Encoding", enc);
      return res.send(body);
    };
    next();
  };
}

// ---------------------------------------------------------------- idempotency keys
const IDEM_TTL = 10 * 60e3, IDEM_MAX = 5000;
export function idempotency({ who = () => "" } = {}) {
  const seen = new Map(); // key -> { at, done: { status, headers, body } | null, waiters: [] }
  const sweep = () => { const now = Date.now(); for (const [k, v] of seen) if (now - v.at > IDEM_TTL || seen.size > IDEM_MAX) seen.delete(k); else break; };
  const mw = (req, res, next) => {
    if (!/^(POST|PUT|PATCH)$/.test(req.method)) return next();
    const raw = req.get("idempotency-key") || req.get("x-idempotency-key"); if (!raw) return next();
    if (!/^[A-Za-z0-9_.:-]{8,120}$/.test(raw)) return res.status(400).json({ code: "bad_idempotency_key", message: "Idempotency-Key must be 8 to 120 letters, digits, dots, dashes or colons." });
    sweep();
    const key = crypto.createHash("sha1").update([who(req), req.method, req.path, raw].join("\u0000")).digest("base64url");
    const hit = seen.get(key);
    const replay = (d) => { res.set(d.headers).set("Idempotent-Replay", "true").status(d.status); return res.end(d.body); };
    if (hit?.done) return replay(hit.done);
    if (hit) return void hit.waiters.push(() => { const d = seen.get(key)?.done; if (d) replay(d); else next(); });
    const E = { at: Date.now(), done: null, waiters: [] }; seen.set(key, E);
    const chunks = [], write = res.write.bind(res), end = res.end.bind(res);
    res.write = (c, ...a) => { if (c) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))); return write(c, ...a); };
    res.end = (c, ...a) => {
      if (c && typeof c !== "function") chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
      const st = res.statusCode;
      // server errors, rate limits and timeouts aren't remembered: the retry gets a fresh try
      if (st >= 500 || st === 429 || st === 408) seen.delete(key);
      else { const headers = {}; for (const h of ["content-type", "content-encoding", "vary", "location", "cache-control"]) { const v = res.get(h); if (v) headers[h] = v; } E.done = { status: st, headers, body: Buffer.concat(chunks) }; }
      const W = E.waiters.splice(0); setImmediate(() => W.forEach((f) => f()));
      return end(c, ...a);
    };
    next();
  };
  mw.size = () => seen.size; mw.clear = () => seen.clear();
  return mw;
}

// ---------------------------------------------------------------- errors
/**
 * The last middleware. One bad request never takes the server down: anything a route throws ends here. The API answers
 * JSON with a code; a page that fails gets a friendly page with a way back (page(): the 404 page, reworded). Unexpected
 * errors are logged as one line with the route, and the answer never carries their message (it can hold internals).
 */
export function errorMiddleware({ page = () => "", log = (...a) => console.error(...a), onError = null } = {}) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (res.headersSent) { try { res.end(); } catch {} return; }
    if (err?.type === "entity.too.large") return res.status(413).json({ code: "too_large", message: "Request body is too large." });
    if (err?.type === "entity.parse.failed") return res.status(400).json({ code: "bad_json", message: "Body is not valid JSON." });
    const code = typeof err?.code === "string" && /^[a-z_]{2,40}$/.test(err.code) ? err.code : "server_error";
    const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : code === "server_not_connected" || code === "tool_not_found" ? 404 : code === "tool_error" ? 502 : 500;
    const unexpected = status >= 500 && code === "server_error";
    // a ref the person can quote to support (the "Something went wrong" toast shows it; server/errors.js keeps it)
    const ref = unexpected ? crypto.randomBytes(4).toString("hex") : "", where = String(req.originalUrl || req.url || "").split("?")[0].slice(0, 200);
    if (unexpected) { log("[http]", req.method, where, `ref ${ref}`, err?.stack || err); try { onError?.({ ref, method: req.method, path: where, err }); } catch {} }
    const message = unexpected ? "Something went wrong on our side. Try again in a moment." : String(err?.message || "Something went wrong.");
    if (!String(req.path || "").startsWith("/api/") && req.method === "GET" && req.accepts(["html", "json"]) === "html") {
      let html = ""; try { html = String(page() || "").replace(/<title>[^<]*/, "<title>Something went wrong · Pottery Lab").replace(/<h1>[\s\S]*?<\/h1><p>[\s\S]*?<\/p>/, "<h1>Something went <em>wrong</em>.</h1><p>That's on us. Try again in a moment.</p>").replace(/href="\/help"/, `href="/help?err=${ref}"`).replace("<!--REF-->", ref ? `Ref ${ref}` : ""); } catch {}
      return res.status(status).set("Cache-Control", "no-store").type("html").send(html || "<!doctype html><title>Something went wrong</title><p>Something went wrong on our side. Try again in a moment.</p>");
    }
    res.status(status).json(ref ? { code, message, ref } : { code, message });
  };
}

// ---------------------------------------------------------------- speculation rules
// prefetch (never prerender: pages run code on load) a same-origin page link as soon as a finger lands or a pointer
// rests on it; never the API, uploads, sign-out or links that act when opened
export const SPECULATION = `<script type="speculationrules">{"prefetch":[{"where":{"and":[{"href_matches":"/*"},{"not":{"href_matches":["/api/*","/_blob/*","/logout*","/signout*","/verify*","/unsubscribe*","/sso/*","/reset*","/demo*"]}},{"not":{"selector_matches":"[download],[target=_blank],[data-no-prefetch]"}}]},"eagerness":"moderate"}]}</script>`;
