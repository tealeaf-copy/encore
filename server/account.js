// Delete your account, in the app (App Store guideline 5.1.1(v); Google Play's account deletion policy, which also
// wants a web link: /settings#delete works signed out too, it asks you to sign in first).
// POST /api/me/delete { confirm: "DELETE", when: "now" | "later" }
// - "later": a 14-day grace period (ENCORE_DELETE_GRACE_DAYS). You're signed out, your posts, photos and kudos are hidden
//   from everyone at once, and signing in again before the date lets you keep the account (POST /api/me/delete/cancel).
// - "now", or when the grace period ends (an hourly job): everything goes.
// What "everything" is:
// - your workspace, when you're its only member: events, guest lists, your page, scrapbook, shop, settings, and every
//   file uploaded to it (photos, covers). A team workspace with other people stays theirs; the next person becomes owner.
// - your account record, so every session you have stops working on the next request
// - your posts, friends, bell, saves, boards, push devices, blocks, settings (system docs that carry your email)
// - on other hosts' events: photos you added are deleted with their files; your replies and kudos stay as numbers for
//   the host ("Former guest", no email, phone, answers or notes); you leave their followers
// - your email anywhere else it appears in a list (friends lists, audit lines) is taken out
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { DEFAULT_WS, getDbUser, putDbUser, getWorkspace, updateWorkspace, membersOf, deleteWorkspace, scopeStore } from "./workspaces.js";
import { logoutHandler } from "./auth.js";
import { keyOf } from "./safety.js";

const lc = (s) => String(s || "").trim().toLowerCase();
export const GRACE_DAYS = () => Math.max(0, Number(process.env.ENCORE_DELETE_GRACE_DAYS ?? 14));
const socialHash = (s) => crypto.createHash("sha256").update(lc(s)).digest("hex").slice(0, 24);
const userPath = (email) => "system/u-" + crypto.createHash("sha256").update(lc(email)).digest("hex").slice(0, 40);
const ANON = { name: "Former guest", email: "", phone: "", dietary: "", answers: [], note: "", notes: "", message: "", emailProven: "", deletedAccount: true };

/** Every upload whose metadata says it belongs to a workspace, or a list of /_blob urls. */
async function removeBlobs(assetsDir, { ws = null, urls = [] } = {}) {
  let n = 0; const ids = new Set(urls.map((u) => String(u).split("/").pop()));
  let names = []; try { names = await fsp.readdir(assetsDir); } catch { return 0; }
  for (const f of names) {
    if (!f.endsWith(".json")) continue; const id = f.slice(0, -5);
    let hit = ids.has(id); if (!hit && ws) { try { hit = JSON.parse(await fsp.readFile(path.join(assetsDir, f), "utf8")).ws === ws; } catch {} }
    if (hit) { await fsp.rm(path.join(assetsDir, id), { force: true }); await fsp.rm(path.join(assetsDir, f), { force: true }); n++; }
  }
  return n;
}
// take an email out of lists inside a doc; true when something changed
function scrubEmail(v, em, depth = 0) {
  let changed = false; if (!v || typeof v !== "object" || depth > 8) return false;
  if (Array.isArray(v)) { for (let i = v.length - 1; i >= 0; i--) { const x = v[i]; if (typeof x === "string" && lc(x) === em) { v.splice(i, 1); changed = true; } else if (x && typeof x === "object" && [x.email, x.authorEmail, x.from, x.by].some((y) => typeof y === "string" && lc(y) === em)) { v.splice(i, 1); changed = true; } else if (scrubEmail(x, em, depth + 1)) changed = true; } return changed; }
  for (const k of Object.keys(v)) { const x = v[k]; if (typeof x === "string" && lc(x) === em) { v[k] = ""; changed = true; } else if (x && typeof x === "object" && scrubEmail(x, em, depth + 1)) changed = true; }
  return changed;
}

/** Delete an account and its data now. Returns counts. */
export async function deleteAccountNow(store, email, { assetsDir, X = null, push = null, safety = null } = {}) {
  const em = lc(email), u = getDbUser(em); if (!u) return { ok: false, error: "No such account." };
  const out = { workspace: false, docs: 0, anonymized: 0, files: 0, scrubbed: 0 };
  // 1. the workspace: theirs alone, or handed on
  const ws = u.ws, others = ws && ws !== DEFAULT_WS ? membersOf(ws).filter((m) => lc(m.email) !== em) : [];
  if (ws && ws !== DEFAULT_WS && !others.length) { out.files += await removeBlobs(assetsDir, { ws }); out.docs += deleteWorkspace(ws); out.workspace = true; }
  else if (ws && ws !== DEFAULT_WS) { if (u.owner) { const next = others[0]; putDbUser({ ...next, owner: true }); updateWorkspace(ws, { ownerEmail: next.email }); } }
  // 2. everything else that carries their email
  const blobUrls = [];
  for (const d of store.dumpPrefix("")) {
    const p = d.path; if (p === userPath(em) || (out.workspace && p.startsWith(`ws/${ws}/`))) continue;
    const s = JSON.stringify(d.data).toLowerCase(); if (!s.includes(em)) continue;
    const data = d.data, coll = p.split("/").slice(-2, -1)[0], mine = [data.email, data.authorEmail, data.ownerEmail, data.from].some((x) => lc(x) === em);
    if (mine && (coll === "rsvps" || coll === "kudos")) { store.set(p, { ...data, ...ANON }); out.anonymized++; continue; }
    if (mine && coll === "moments") { if (data.url) blobUrls.push(data.url); if (data.poster) blobUrls.push(data.poster); store.delete(p); out.docs++; continue; }
    if (mine && data.kind === "workspace") continue; // a team workspace handed on above
    if (mine) { store.delete(p); out.docs++; continue; }
    const copy = JSON.parse(JSON.stringify(data)); if (scrubEmail(copy, em)) { store.set(p, copy); out.scrubbed++; }
  }
  // docs keyed by a hash of the email with no email inside (posts)
  for (const k of ["posts-", "friends-", "inbox-", "prefs-", "selfprof-"]) { const p = "system/" + k + socialHash(em); if (store.get(p)) { const L = store.get(p).data?.list || []; for (const x of L) if (x?.photo) blobUrls.push(x.photo); store.delete(p); out.docs++; } }
  out.files += await removeBlobs(assetsDir, { urls: blobUrls.filter((x) => /^\/_blob\/[A-Za-z0-9]+$/.test(x)) });
  try { push?.forget(em); } catch {}
  try { safety?.unhide("person:" + keyOf(em)); } catch {}
  store.delete(userPath(em)); // last: every session for this email stops working
  try { X?.bust?.(); } catch {}
  console.log(`[account] deleted ${em.replace(/^(.).*@/, "$1***@")}: ${JSON.stringify(out)}`);
  return { ok: true, ...out };
}

export function mountAccount(app, { store, small, currentUser, X, push, safety, dataDirOf }) {
  const assetsDir = () => path.join(dataDirOf(), "assets");
  const me = (req, res) => { const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) { res.status(401).json({ code: "unauthenticated", message: "Sign in first." }); return null; } return u; };
  const signOut = (req, res) => logoutHandler(req, { setHeader: (...a) => res.setHeader(...a), append: (...a) => res.append(...a), json: () => {} });
  app.get("/api/me/delete", (req, res) => { const u = me(req, res); if (!u) return; const rec = getDbUser(u.email) || {};
    res.set("Cache-Control", "private, no-store").json({ pending: !!rec.deleteAt, deleteAt: rec.deleteAt || null, graceDays: GRACE_DAYS(), soleMember: membersOf(u.ws).length <= 1, owner: !!rec.owner }); });
  app.post("/api/me/delete", small, async (req, res) => {
    const u = me(req, res); if (!u) return;
    if (String(req.body?.confirm || "").trim().toUpperCase() !== "DELETE") return res.status(400).json({ code: "confirm", message: 'Type DELETE to confirm.' });
    const later = req.body?.when === "later" && GRACE_DAYS() > 0;
    if (later) { const at = Date.now() + GRACE_DAYS() * 864e5, rec = getDbUser(u.email); putDbUser({ ...rec, deleteAt: at, deleteAsked: Date.now() });
      try { safety?.hide("person:" + keyOf(u.email), { by: "account-deletion" }); X?.bust?.(); } catch {}
      signOut(req, res); return res.json({ ok: true, pending: true, deleteAt: at, message: `Your account will be deleted on ${new Date(at).toDateString()}. Sign in before then to keep it.` }); }
    const r = await deleteAccountNow(store, u.email, { assetsDir: assetsDir(), X, push, safety });
    signOut(req, res); res.json({ ...r, message: "Your account and its data are deleted." });
  });
  app.post("/api/me/delete/cancel", small, (req, res) => { const u = me(req, res); if (!u) return; const rec = getDbUser(u.email); if (!rec?.deleteAt) return res.json({ ok: true, pending: false });
    const { deleteAt, deleteAsked, ...keep } = rec; putDbUser(keep); try { safety?.unhide("person:" + keyOf(u.email)); X?.bust?.(); } catch {}
    res.json({ ok: true, pending: false, message: "Welcome back. Your account stays." }); });
  // the grace period ends: delete for real (hourly, and once a minute after start)
  async function runDue(now = Date.now()) {
    let n = 0; for (const d of store.listPrefix("system", "u-")) { const rec = d.data; if (rec?.kind === "user" && rec.deleteAt && rec.deleteAt <= now) { await deleteAccountNow(store, rec.email, { assetsDir: assetsDir(), X, push, safety }); n++; } }
    return n;
  }
  if (!process.env.NODE_TEST_CONTEXT) { const t = setInterval(() => runDue().catch((e) => console.warn("[account]", e.message)), 3600e3); t.unref?.(); setTimeout(() => runDue().catch(() => {}), 60e3).unref?.(); }
  return { runDue, deleteNow: (email) => deleteAccountNow(store, email, { assetsDir: assetsDir(), X, push, safety }) };
}
