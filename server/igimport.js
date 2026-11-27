// "Start from your Instagram" (docs/instagram-import.md): a host's own Instagram becomes a draft of their Pottery Lab
// page, which they check field by field before anything is saved. Two ways in:
//  (A) official: Instagram API with Instagram Login (professional accounts). Off unless INSTAGRAM_APP_ID,
//      INSTAGRAM_APP_SECRET (and optionally INSTAGRAM_REDIRECT_URI) are set. The person connects their own account; we
//      read their profile and recent media once, then drop the token. It is never written anywhere.
//  (B) works today: they type their handle, paste their bio and pick 3 to 12 photos or screenshots of their posts.
//      The photos go to Claude for the draft and are not stored. Only the ones they pick for the page are uploaded,
//      when they tap "Looks good, save my page".
// We never fetch instagram.com pages, and never anything about anyone else's account.
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import express from "express";
import { complete, parseJsonLoose, aiMode } from "./ai.js";
import { getWorkspace, scopeStore, DEFAULT_WS } from "./workspaces.js";
import { buildPrompt, fakeIgDraft, guardDraft, parseIgHandle, igUrl, plHandleFrom, MAX_PHOTOS, MAX_PHOTO_BYTES } from "./igdraft.js";

export { parseIgHandle, plHandleFrom };
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f<>]/g, " ").replace(/\s*[—–]\s*/g, ", ").replace(/[ \t]+/g, " ").trim().slice(0, n);
const cleanBlock = (v, n = 2000) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f<>]/g, " ").replace(/\s*[—–]\s*/g, ", ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, n);
const TTL = 30 * 60e3, BLOB_OK = (u) => /^\/_blob\/[A-Za-z0-9]{20}$/.test(u || "");
const HEX = (v) => (/^#[0-9a-f]{6}$/i.test(String(v || "")) ? String(v).toUpperCase() : "");

// ---------- configuration (A) ----------
// CHECK AGAINST META'S CURRENT DOCS before going live: the authorize host, the token endpoint, the Graph API version,
// the user fields (biography and website especially) and whether PKCE is accepted. See docs/instagram-import.md.
export function igConfig() {
  const id = String(process.env.INSTAGRAM_APP_ID || "").trim(), secret = String(process.env.INSTAGRAM_APP_SECRET || "").trim();
  if (!id || !secret) return null;
  return { id, secret, redirect: String(process.env.INSTAGRAM_REDIRECT_URI || "").trim(), version: /^v\d{1,3}\.\d$/.test(process.env.INSTAGRAM_GRAPH_VERSION || "") ? process.env.INSTAGRAM_GRAPH_VERSION : "v23.0",
    pkce: process.env.INSTAGRAM_PKCE === "1", authorize: "https://www.instagram.com/oauth/authorize", token: "https://api.instagram.com/oauth/access_token", graph: "https://graph.instagram.com", scope: "instagram_business_basic" };
}
const USER_FIELDS = "user_id,username,name,biography,website,profile_picture_url,followers_count,media_count,account_type";
const USER_FIELDS_MIN = "user_id,username,name,profile_picture_url,followers_count,media_count,account_type";
const MEDIA_FIELDS = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp";
// media is downloaded only from Instagram's own CDN, and only the URLs the API handed us for this account
const CDN_OK = (u) => { try { const x = new URL(u); return x.protocol === "https:" && /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i.test(x.hostname); } catch { return false; } };

let fetchImpl = (...a) => fetch(...a);
/** Tests swap the network for a stub. */
export function setIgFetch(f) { fetchImpl = f || ((...a) => fetch(...a)); }
async function getJson(url, init) { const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 10000);
  try { const r = await fetchImpl(url, { ...init, signal: ctl.signal }); const j = await r.json().catch(() => ({})); return { ok: r.ok, status: r.status, j }; } finally { clearTimeout(t); } }
async function getBytes(url, max = 5 * 1024 * 1024) { if (!CDN_OK(url)) return null; const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 10000);
  try { const r = await fetchImpl(url, { signal: ctl.signal, redirect: "error" }); if (!r.ok) return null; const type = String(r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > max || !imageType(buf)) return null; return { buf, type: imageType(buf) || type }; } catch { return null; } finally { clearTimeout(t); } }

/** One read of the person's own account: exchange the code, read the profile and recent media, drop the token. */
export async function readOwnAccount(cfg, { code, redirectUri, verifier }) {
  const form = new URLSearchParams({ client_id: cfg.id, client_secret: cfg.secret, grant_type: "authorization_code", redirect_uri: redirectUri, code, ...(verifier ? { code_verifier: verifier } : {}) });
  const t = await getJson(cfg.token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
  const tok = t.j?.access_token || t.j?.data?.[0]?.access_token; if (!t.ok || !tok) return { error: "token_failed" };
  let token = String(tok);
  try {
    const q = (fields) => `${cfg.graph}/${cfg.version}/me?` + new URLSearchParams({ fields, access_token: token });
    let me = await getJson(q(USER_FIELDS)); if (!me.ok) me = await getJson(q(USER_FIELDS_MIN)); // an account or version without biography/website
    if (!me.ok || !me.j?.username) return { error: "profile_failed" };
    const m = await getJson(`${cfg.graph}/${cfg.version}/me/media?` + new URLSearchParams({ fields: MEDIA_FIELDS, limit: "24", access_token: token }));
    const media = (m.ok && Array.isArray(m.j?.data) ? m.j.data : []).map((x) => ({ caption: cleanBlock(x.caption, 1500), timestamp: clean(x.timestamp, 40), permalink: /^https:\/\/(www\.)?instagram\.com\//.test(x.permalink || "") ? String(x.permalink).slice(0, 300) : "",
      url: x.media_type === "VIDEO" ? x.thumbnail_url : x.media_url })).filter((x) => x.url && CDN_OK(x.url));
    return { profile: { handle: parseIgHandle(me.j.username), name: clean(me.j.name, 60), bio: cleanBlock(me.j.biography, 600), website: clean(me.j.website, 300), avatar: CDN_OK(me.j.profile_picture_url) ? me.j.profile_picture_url : "", followers: Math.max(0, +me.j.followers_count || 0), type: clean(me.j.account_type, 20) }, media };
  } finally { token = ""; } // the token is never stored, logged or sent to the page
}

// ---------- Meta's signed_request (deauthorize and data deletion callbacks) ----------
export function parseSignedRequest(sr, secret) {
  const [sig, payload] = String(sr || "").split("."); if (!sig || !payload || !secret) return null;
  const want = crypto.createHmac("sha256", secret).update(payload).digest(); let got; try { got = Buffer.from(sig.replace(/-/g, "+").replace(/_/g, "/"), "base64"); } catch { return null; }
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try { const j = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")); return j?.algorithm?.toUpperCase() === "HMAC-SHA256" ? j : null; } catch { return null; }
}

// ---------- photos (B): checked by their bytes, held in memory for the draft only ----------
export function imageType(buf) {
  if (!buf || buf.length < 12) return "";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (/^GIF8[79]a/.test(buf.slice(0, 6).toString("latin1"))) return "image/gif";
  return "";
}
/** [{type, data (base64 or a data: URL)}] -> [{type, data}] or {error}. 1 to 12 photos, each an image under 2 MB. */
export function checkPhotos(list) {
  if (list == null) return { photos: [] };
  if (!Array.isArray(list)) return { error: "Photos must be a list." };
  if (list.length > MAX_PHOTOS) return { error: `Pick up to ${MAX_PHOTOS} photos.`, code: "too_many" };
  const out = [];
  for (const p of list) {
    const raw = String(p?.data || "").replace(/^data:[^;,]*;base64,/, "");
    if (!/^[A-Za-z0-9+/=\s]+$/.test(raw)) return { error: "One of those isn't a photo.", code: "bad_type" };
    if (raw.length > Math.ceil(MAX_PHOTO_BYTES * 4 / 3) + 8) return { error: "One photo is too big. Each one can be up to 2 MB.", code: "too_big" };
    const buf = Buffer.from(raw, "base64"), type = imageType(buf);
    if (buf.length > MAX_PHOTO_BYTES) return { error: "One photo is too big. Each one can be up to 2 MB.", code: "too_big" };
    if (!type) return { error: "One of those isn't a photo. Use JPEG, PNG, WebP or GIF.", code: "bad_type" };
    out.push({ type, data: buf.toString("base64") });
  }
  return { photos: out };
}

/** Ask Claude (or the offline rules) for a draft, then guard it. Photos are only in this call's memory. */
export async function makeDraft(input) {
  const photos = input.photos || [], blocks = buildPrompt({ ...input, photos });
  const guardIn = { handle: input.handle, bio: input.bio, extra: input.extra, posts: input.posts || [], photoCount: photos.length };
  let raw = null, via = aiMode() === "live" ? "claude" : "rules";
  if (aiMode() !== "missing_key") { try { raw = parseJsonLoose((await complete({ prompt: blocks, effort: "low", maxIterations: 2 })).text); } catch (e) { console.warn("[igimport] draft fell back to the rules:", e?.code || e?.message || e); raw = null; via = "rules"; } }
  if (!raw || typeof raw !== "object") raw = fakeIgDraft(blocks);
  const d = guardDraft(raw, guardIn);
  // what the profile itself says wins its own fields' source (A)
  if (input.name && !d.name.value) d.name = { value: clean(input.name, 60), source: { kind: "profile" }, from: "from your Instagram profile" };
  return { ...d, via };
}

// ---------- the routes ----------
export function mountIgImport(app, { store, currentUser, C, assetsDir, publicOrigin, sendStatic }) {
  const S = (ws) => scopeStore(store, ws), big = express.json({ limit: "24mb" }), mid = express.json({ limit: "200kb" });
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const me = (req, res) => { const u = currentUser(req); if (!u || !u.ws || u.ws === DEFAULT_WS) { bad(res, "Sign in first.", 401, "unauthenticated"); return null; } if (getWorkspace(u.ws)?.regularOnly) { bad(res, "Add a host code to set up your page.", 403, "invite_required"); return null; } return u; };
  const hits = new Map(), limited = (k, n) => { const now = Date.now(); let h = hits.get(k); if (!h || now - h.t > 3600e3) { h = { t: now, n: 0 }; hits.set(k, h); } return ++h.n > n; };
  // drafts from the official path wait here (in memory, 30 minutes at most) for the review screen. Never on disk.
  const cache = new Map();
  const sweep = () => { const now = Date.now(); for (const [k, v] of cache) if (now - v.at > TTL) cache.delete(k); };
  const mine = (ws, id) => { sweep(); const v = cache.get(String(id || "")); return v && v.ws === ws ? v : null; };
  const dropAll = (ws) => { for (const [k, v] of cache) if (v.ws === ws) cache.delete(k); };
  app.locals.igimport = { cache }; // tests read it to check nothing outlives a draft
  const key = () => crypto.createHash("sha256").update("igimport|" + (process.env.SESSION_SECRET || process.env.INSTAGRAM_APP_SECRET || "dev")).digest();
  const signC = (o) => { const p = Buffer.from(JSON.stringify(o)).toString("base64url"); return p + "." + crypto.createHmac("sha256", key()).update(p).digest("base64url"); };
  const readC = (v) => { const [p, s] = String(v || "").split("."); if (!p || !s) return null; const want = crypto.createHmac("sha256", key()).update(p).digest("base64url"); if (s.length !== want.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want))) return null; try { return JSON.parse(Buffer.from(p, "base64url").toString("utf8")); } catch { return null; } };
  const cookieOf = (req, k) => (new RegExp(`(?:^|;\\s*)${k}=([^;]+)`).exec(req.headers.cookie || "") || [])[1] || "";
  const redirectUri = (req) => igConfig()?.redirect || `${publicOrigin(req)}/api/igimport/oauth/callback`;
  const secure = (req) => req.secure || /^https:/.test(publicOrigin(req));
  const usedStates = new Map(); // a state works once

  app.get("/import/instagram", (req, res) => sendStatic(res, "igimport.html", "<p>Page missing.</p>"));
  app.get("/api/igimport/config", (req, res) => { const u = currentUser(req), signed = !!(u && u.ws && u.ws !== DEFAULT_WS), h = signed ? getWorkspace(u.ws)?.host : null; res.set("Cache-Control", "private, no-store");
    const st = signed ? S(u.ws).get("igimport/state")?.data : null;
    res.json({ official: !!igConfig(), signedIn: signed, regularOnly: signed ? !!getWorkspace(u.ws)?.regularOnly : false, ai: aiMode(), min: 3, max: MAX_PHOTOS, maxBytes: MAX_PHOTO_BYTES,
      host: h?.handle ? { handle: h.handle, name: h.name || "", city: h.city || "", hood: h.hood || "", tagline: h.tagline || "", bio: h.bio || "", tags: h.tags || [], links: h.links || [], gallery: (h.gallery || []).length, shopOpen: !!h.shop?.open } : null,
      imported: st ? { via: st.via, handle: st.handle, at: st.at } : null }); });

  // (A) start: a state (single use, tied to this workspace) in a signed, short-lived cookie; PKCE when turned on
  app.get("/api/igimport/oauth/start", (req, res) => { const cfg = igConfig(); if (!cfg) return bad(res, "Connecting Instagram isn't set up on this server. Use your photos instead.", 404, "not_configured");
    const u = me(req, res); if (!u) return; if (limited("start:" + u.ws, 30)) return bad(res, "That's a lot of tries this hour.", 429, "rate_limited");
    const state = crypto.randomBytes(24).toString("base64url"), verifier = cfg.pkce ? crypto.randomBytes(32).toString("base64url") : "", mode = req.query.mode === "refresh" ? "refresh" : "new";
    res.setHeader("Set-Cookie", `pl_igst=${signC({ s: crypto.createHash("sha256").update(state).digest("base64url"), ws: u.ws, v: verifier, mode, exp: Date.now() + 10 * 60e3 })}; Path=/api/igimport; HttpOnly; SameSite=Lax; Max-Age=600${secure(req) ? "; Secure" : ""}`);
    const q = { client_id: cfg.id, redirect_uri: redirectUri(req), response_type: "code", scope: cfg.scope, state, ...(verifier ? { code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" } : {}) };
    res.redirect(302, cfg.authorize + "?" + new URLSearchParams(q)); });

  app.get("/api/igimport/oauth/callback", async (req, res) => { const cfg = igConfig(); if (!cfg) return bad(res, "Connecting Instagram isn't set up on this server.", 404, "not_configured");
    const u = me(req, res); if (!u) return;
    const c = readC(cookieOf(req, "pl_igst")), state = String(req.query.state || "");
    res.setHeader("Set-Cookie", `pl_igst=; Path=/api/igimport; HttpOnly; SameSite=Lax; Max-Age=0${secure(req) ? "; Secure" : ""}`);
    const sh = state ? crypto.createHash("sha256").update(state).digest("base64url") : "";
    if (!c || !state || c.s !== sh || c.ws !== u.ws || !(c.exp > Date.now()) || usedStates.has(sh)) return bad(res, "That sign-in link has expired or didn't come from here. Start again.", 400, "bad_state");
    usedStates.set(sh, Date.now()); for (const [k, t] of usedStates) if (Date.now() - t > 3600e3) usedStates.delete(k);
    const back = (q) => res.redirect(303, "/import/instagram?" + new URLSearchParams({ mode: c.mode || "new", ...q }));
    if (req.query.error || !req.query.code) return back({ ig: "denied" });
    let acct; try { acct = await readOwnAccount(cfg, { code: String(req.query.code).replace(/#_$/, ""), redirectUri: redirectUri(req), verifier: c.v || "" }); } catch { acct = { error: "failed" }; }
    if (acct.error || !acct.profile?.handle) return back({ ig: "failed" });
    // the photos: the profile picture and up to 12 recent posts, from the account's own media list only
    const media = []; for (const m of acct.media) { if (media.length >= MAX_PHOTOS) break; const b = await getBytes(m.url); if (b) media.push({ ...b, caption: m.caption, timestamp: m.timestamp, permalink: m.permalink }); }
    const avatar = acct.profile.avatar ? await getBytes(acct.profile.avatar, 2 * 1024 * 1024) : null;
    const id = crypto.randomBytes(12).toString("base64url");
    cache.set(id, { ws: u.ws, at: Date.now(), via: "official", profile: { ...acct.profile, avatar: "" }, media, avatar, draft: null });
    back({ draft: id }); });

  // the draft. (B): {handle, bio, extra, photos}. (A): {draft} from the callback. Nothing is saved to the page here.
  app.post("/api/igimport/draft", big, async (req, res) => { const u = me(req, res); if (!u) return; if (limited("draft:" + u.ws, 20)) return bad(res, "That's a lot of drafts this hour. Try again in a bit.", 429, "rate_limited");
    const b = req.body || {}, mode = b.mode === "refresh" ? "refresh" : "new";
    if (b.draft) { const v = mine(u.ws, b.draft); if (!v) return bad(res, "That draft has expired. Connect again.", 404, "expired");
      if (!v.draft) { const posts = v.media.map((m) => ({ caption: m.caption, timestamp: m.timestamp })), photos = [...v.media.map((m) => ({ type: m.type, data: m.buf.toString("base64") })), ...(v.avatar ? [{ type: v.avatar.type, data: v.avatar.buf.toString("base64") }] : [])];
        v.draft = await makeDraft({ handle: v.profile.handle, name: v.profile.name, bio: v.profile.bio, website: v.profile.website, posts, photos, mode });
        if (v.avatar) { v.draft.avatar.photo = photos.length; v.draft.gallery = v.draft.gallery.filter((n) => n !== photos.length); if (v.draft.cover === photos.length) v.draft.cover = v.draft.gallery[0] || null; }
        v.draft.followers = v.profile.followers; }
      const n = v.media.length + (v.avatar ? 1 : 0);
      return res.json({ via: "official", draft: v.draft, photos: Array.from({ length: n }, (_, i) => ({ n: i + 1, url: `/api/igimport/media/${b.draft}/${i + 1}`, avatar: !!v.avatar && i + 1 === n, permalink: v.media[i]?.permalink || "" })) }); }
    const handle = parseIgHandle(b.handle);
    if (String(b.handle || "").trim() && !handle) return bad(res, "That doesn't look like an Instagram handle. Try @yourshop.", 400, "bad_handle");
    const P = checkPhotos(b.photos); if (P.error) return bad(res, P.error, P.code === "too_big" ? 413 : 400, P.code || "invalid");
    const bio = cleanBlock(b.bio, 600), extra = cleanBlock(b.extra, 3000);
    if (!bio && !extra && !P.photos.length) return bad(res, "Paste your bio or add a few photos first.", 400, "empty");
    const draft = await makeDraft({ handle, bio, extra, photos: P.photos, mode });
    P.photos.length = 0; // the photos were for this draft only: nothing kept, nothing written
    res.set("Cache-Control", "private, no-store"); res.json({ via: "photos", draft }); });

  // (A) the account's photos for the review screen, same-origin so the page can read their colors
  app.get("/api/igimport/media/:id/:n", (req, res) => { const u = me(req, res); if (!u) return; const v = mine(u.ws, req.params.id); if (!v) return bad(res, "Expired.", 404, "expired");
    const i = Math.round(+req.params.n) - 1, m = i === v.media.length && v.avatar ? v.avatar : v.media[i]; if (!m) return bad(res, "No such photo.", 404, "not_found");
    res.set({ "Content-Type": m.type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }).send(m.buf); });

  const saveBlob = async (ws, m) => { const id = crypto.randomBytes(15).toString("base64").replace(/[^A-Za-z0-9]/g, "").padEnd(20, "x").slice(0, 20);
    await fsp.writeFile(path.join(assetsDir, id), m.buf); await fsp.writeFile(path.join(assetsDir, id + ".json"), JSON.stringify({ id, url: "/_blob/" + id, sizeBytes: m.buf.length, contentType: m.type, createdAt: Date.now(), ws, via: "instagram" })); return "/_blob/" + id; };
  const ownBlob = async (ws, u) => { if (!BLOB_OK(u)) return false; try { const meta = JSON.parse(await fsp.readFile(path.join(assetsDir, u.slice(7) + ".json"), "utf8")); return meta.ws === ws && /^image\//.test(String(meta.contentType || "")); } catch { return false; } };

  // "Looks good, save my page": the only place a draft reaches the page
  app.post("/api/igimport/save", mid, async (req, res) => { const u = me(req, res); if (!u) return; const b = req.body || {}, f = b.fields || {}, use = b.use && typeof b.use === "object" ? b.use : null, on = (k) => !use || use[k] !== false;
    const W = getWorkspace(u.ws), cur = W?.host || {}, v = b.draft ? mine(u.ws, b.draft) : null;
    if (b.draft && !v) return bad(res, "That draft has expired. Connect again.", 404, "expired");
    const ig = v ? v.profile.handle : parseIgHandle(f.handle);
    // photos: (A) by number from the cached media, stored now; (B) blobs this workspace just uploaded
    const photo = async (x) => { if (v && Number.isInteger(+x?.media)) { const i = +x.media - 1, m = i === v.media.length && v.avatar ? v.avatar : v.media[i]; return m ? await saveBlob(u.ws, m) : ""; } return (await ownBlob(u.ws, x)) ? x : ""; };
    const P = b.photos || {}, gallery = [];
    for (const x of (Array.isArray(P.gallery) ? P.gallery : []).slice(0, 12)) { const url = await photo(x); if (url && !gallery.includes(url)) gallery.push(url); }
    const coverUrl = P.cover != null ? await photo(P.cover) : "", avatarUrl = P.avatar != null && P.avatar !== "art" ? await photo(P.avatar) : "";
    const p = {};
    if (on("name") && clean(f.name, 60)) p.name = clean(f.name, 60);
    if (on("tagline") && clean(f.tagline, 140)) p.tagline = clean(f.tagline, 140);
    { const about = on("about") ? cleanBlock(f.about, 400) : "", hours = on("hours") ? clean(f.hours, 120) : "";
      if (about || hours) { const base = about || cleanBlock(cur.bio, 400), line = hours && !base.toLowerCase().includes(hours.toLowerCase()) ? `Open ${hours.replace(/^open\s+/i, "")}.` : "";
        p.bio = (line && base.length + line.length + 2 <= 400 ? `${base}\n\n${line}` : base || line).trim().slice(0, 400); } }
    if (on("city") && clean(f.city, 60)) p.city = clean(f.city, 60);
    if (on("hood") && clean(f.hood, 60)) p.hood = clean(f.hood, 60);
    { const tags = on("tags") && Array.isArray(f.tags) ? f.tags : [], ev = on("events") && Array.isArray(f.events) ? f.events : [];
      const all = [...new Set([...tags, ...ev].map((t) => clean(t, 24).toLowerCase()).filter(Boolean))].slice(0, 8); if (all.length) p.tags = all; }
    if (on("brandEvents") && Array.isArray(f.brandEvents) && f.brandEvents.length) p.services = f.brandEvents.map((x) => clean(x, 50)).filter(Boolean).slice(0, 5).join(" · ");
    { const L = [...(cur.links || [])], put = (label, url) => { if (!url) return; const i = L.findIndex((x) => x.label.toLowerCase() === label.toLowerCase() || x.url === url); if (i >= 0) L[i] = { label, url }; else if (L.length < 4) L.push({ label, url }); };
      if (on("handle") && ig) put("Instagram", igUrl(ig)); const w = clean(f.website, 300); if (on("website") && /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(?:[/?#][^\s<>"]*)?$/i.test(w) && !/instagram\.com/i.test(w)) put("Website", w); if (L.length) p.links = L; }
    // offerings: an open shop only takes ones with a price they stated; otherwise they wait in a closed shop as their menu
    if (on("offerings") && Array.isArray(f.offerings) && f.offerings.length) { const shop = cur.shop || {}, have = new Set((shop.items || []).map((x) => String(x.name).toLowerCase()));
      const cents = (s) => { const m = String(s || "").match(/\$\s?(\d{1,5})(?:\.(\d{2}))?/); return m ? Math.round(+m[1] * 100 + (m[2] ? +m[2] : 0)) : 0; };
      const add = f.offerings.slice(0, 12).map((o) => ({ name: clean(o?.name, 60), desc: clean(o?.desc, 200), cents: cents(o?.price) })).filter((o) => o.name && !have.has(o.name.toLowerCase()) && (!shop.open || o.cents > 0));
      if (add.length) p.shop = { ...shop, open: !!shop.open, title: shop.title || "What we make", items: [...(shop.items || []), ...add].slice(0, 12), slots: shop.slots?.length ? shop.slots : on("hours") && clean(f.hours, 60) ? [clean(f.hours, 60)] : [] }; }
    // the theme: cover, avatar (a photo of theirs, or a drawn one); the brand kit's colors from their photos
    const theme = { ...(cur.theme || {}) }; let themed = false;
    if (on("cover") && coverUrl) { theme.coverUrl = coverUrl; theme.coverPos = "50% 50%"; themed = true; }
    if (on("avatar")) { if (avatarUrl) { theme.avatarUrl = avatarUrl; themed = true; } else if (P.avatar === "art" && /^[a-z]{3,12}$/.test(String(P.art || ""))) { theme.avatarArt = P.art; theme.avatarUrl = ""; themed = true; } }
    if (themed) p.theme = theme;
    if (on("gallery") && gallery.length) p.gallery = [...new Set([...gallery, ...(cur.gallery || [])])].slice(0, 12);
    const pal = b.palette || {}, accent = HEX(pal.accent);
    if (on("palette") && accent) { p.color = accent; p.brandKit = { ...(cur.brandKit || {}), accent, ...(HEX(pal.accent2) ? { accent2: HEX(pal.accent2) } : {}), ...(HEX(pal.page) ? { page: HEX(pal.page) } : {}) }; }
    if (!Object.keys(p).length) return bad(res, "Nothing to save. Tick what you want on your page.", 400, "empty");
    // the page's handle: theirs if they have one; else one made from their Instagram handle, or their name
    const base = plHandleFrom(ig) || plHandleFrom(p.name || cur.name || W?.company || u.name || "") || "host";
    // a new page takes the handle from their Instagram when it's free (a page made at sign-up has a placeholder one)
    let r = b.mode !== "refresh" && ig && cur.handle && cur.handle !== base && !(cur.experiences || []).length ? C.setProfile(u.ws, { ...p, handle: base, name: p.name || cur.name || u.name || "" }) : { error: "skip" };
    if (r.error) r = C.setProfile(u.ws, { ...p, handle: cur.handle || base, name: p.name || cur.name || u.name || "" });
    for (let i = 0; r.error && !cur.handle && i < 4; i++) r = C.setProfile(u.ws, { ...p, handle: `${base.slice(0, 25)}-${crypto.randomBytes(2).toString("hex")}`, name: p.name || cur.name || u.name || "" });
    if (r.error) return bad(res, r.error);
    S(u.ws).set("igimport/state", { via: v ? "official" : "photos", handle: ig || "", at: Date.now() }); // no token, no photos: what was imported and when
    if (v) cache.delete(String(b.draft));
    res.json({ ok: true, handle: r.host.handle, url: `${publicOrigin(req)}/@${r.host.handle}` }); });

  // "Disconnect": we keep no key to their account; this forgets any draft still waiting and the import record
  app.post("/api/igimport/disconnect", mid, (req, res) => { const u = me(req, res); if (!u) return; dropAll(u.ws); S(u.ws).delete("igimport/state");
    res.json({ ok: true, message: "Disconnected. We never kept a key to your Instagram. To remove Pottery Lab there too, open Instagram, then Settings, then Apps and websites." }); });

  // Meta's callbacks (set them in the app dashboard). We store no Instagram tokens or data, so there's nothing to delete
  // beyond drafts in memory; the answer is what Meta asks for.
  const form = express.urlencoded({ extended: false, limit: "20kb" });
  app.post("/api/igimport/deauthorize", form, (req, res) => { const cfg = igConfig(); if (!cfg) return bad(res, "Not set up.", 404, "not_configured"); const j = parseSignedRequest(req.body?.signed_request, cfg.secret); if (!j) return bad(res, "Bad signature.", 400, "bad_signature"); res.json({ ok: true }); });
  app.post("/api/igimport/data-deletion", form, (req, res) => { const cfg = igConfig(); if (!cfg) return bad(res, "Not set up.", 404, "not_configured"); const j = parseSignedRequest(req.body?.signed_request, cfg.secret); if (!j) return bad(res, "Bad signature.", 400, "bad_signature");
    const code = crypto.createHash("sha256").update(String(j.user_id || "") + "|" + Date.now()).digest("hex").slice(0, 16); res.json({ url: `${publicOrigin(req)}/privacy#instagram`, confirmation_code: code }); });
}
