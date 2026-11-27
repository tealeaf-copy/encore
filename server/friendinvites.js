// Friend invites: invite-only Pottery Lab, shared by text from your own phone (no carrier approval needed).
//
// - Every member has a few personal invites (ENCORE_INVITES_PER_MEMBER, default 5; admins can grant more). The Me page
//   shows "Invite a friend (4 left)" (public/invites.js). "Text an invite" makes one invite and opens the phone's
//   Messages with a personal message and the link (sms: on a phone, else the share sheet, else copy).
// - An invite is one code tied to the inviter: system/finv-<CODE> { code, by, byName, byWs, at, exp, opens, usedAt,
//   usedBy, usedByName, revokedAt, via: "member" | "admin", waitId }. One use, 30 days, revocable from the Me page.
//   Codes look like FK7M2Q9XH4 (an F and 9 letters or digits), so they never clash with the 8-letter host codes.
// - The link is /join/<code>: a warm page, "Maya invited you to Pottery Lab", with Maya's face and one line
//   (public/join-friend.html, GET /api/public/friend-invite/:code). "Join" goes to /signup?code=<code>, so the sign-in
//   screen holds the code from the start and never asks for an invite code; the account is made by the same
//   createAccount as every sign-up. app.js routes the code through C.checkCode / C.useCode (wrapFriendInvites), so
//   the invite-only gate, the per-IP limit and "connected as friends" (X.addFriend both ways) are the ones host codes use.
// - Waitlist: people without an invite join the waitlist (server/signin.js, /api/waitlist). Admins approve from
//   /admin/invites, which sends a one-use invite by email, or by one text to the number they gave.
// - Tracking: inviter -> invitee on the record, opens, conversions, and the counts on /admin/invites (no content).
import crypto from "node:crypto";
import { getDbUser, DEFAULT_WS } from "./workspaces.js";
import { isAdmin, track } from "./metrics.js";
import { sendEmail } from "./email.js";

const DAY = 864e5, TTL = 30 * DAY;
const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const hash = (s) => crypto.createHash("sha256").update(lc(s)).digest("hex").slice(0, 24);
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s*\u2014\s*/g, ", ").replace(/\s+/g, " ").trim().slice(0, n);
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const invitesPerMember = () => { const n = Number(process.env.ENCORE_INVITES_PER_MEMBER ?? 5); return Number.isFinite(n) && n >= 0 ? Math.min(100, Math.floor(n)) : 5; };
const flat = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
/** Is this one of ours (an F and 9 letters or digits), not a host code? Pure. */
export const isFriendCode = (c) => /^F[A-Z0-9]{9}$/.test(flat(c));
const newCode = () => { let s = "F"; for (const b of crypto.randomBytes(9)) s += ALPHA[b % ALPHA.length]; return s; };
const path = (c) => "system/finv-" + flat(c);
const grantPath = (em) => "system/finvgrant-" + hash(em);

/** Where an invite stands: open, used, expired or revoked. Pure. */
export const statusOf = (d, now = Date.now()) => (!d ? "missing" : d.usedAt ? "used" : d.revokedAt ? "revoked" : d.exp < now ? "expired" : "open");

export function makeFriendInvites({ store, X, C }) {
  const get = (c) => (isFriendCode(c) ? store.get(path(c))?.data || null : null);
  const all = () => store.listPrefix("system", "finv-").map((d) => d.data).filter((d) => d?.kind === "finv");
  const mine = (em) => all().filter((d) => d.by === lc(em)).sort((a, b) => b.at - a.at);
  const extraOf = (em) => store.get(grantPath(em))?.data?.extra || 0;
  /** How many invites someone has left: their allowance (plus grants) less the ones used or still open. */
  function counts(em, now = Date.now()) {
    const L = mine(em), used = L.filter((d) => statusOf(d, now) === "used").length, open = L.filter((d) => statusOf(d, now) === "open").length;
    const total = invitesPerMember() + extraOf(em);
    return { total, used, open, left: Math.max(0, total - used - open) };
  }
  function create(user, { note = "", now = Date.now() } = {}) {
    const em = lc(user.email); if (!em) return { error: "Sign in first.", status: 401 };
    if (counts(em, now).left <= 0) return { error: "You've used all your invites for now. When a friend joins, or an invite runs out, you get it back.", status: 409, code: "no_invites" };
    let code = newCode(); while (store.get(path(code))) code = newCode();
    const d = { kind: "finv", code, by: em, byName: clean(user.name, 80), byWs: user.ws || "", at: now, exp: now + TTL, opens: 0, via: "member", ...(clean(note, 140) ? { note: clean(note, 140) } : {}) };
    store.set(path(code), d); track("friend_invite_created", { ws: user.ws || undefined });
    return { invite: d };
  }
  /** An admin's invite for someone on the waitlist: not tied to a member, so nobody is made their friend. */
  function createForWaitlist(w, by, now = Date.now()) {
    let code = newCode(); while (store.get(path(code))) code = newCode();
    const d = { kind: "finv", code, by: "", byName: "", byWs: "", at: now, exp: now + TTL, opens: 0, via: "admin", admin: lc(by), waitId: w.id, to: w.email || w.phone || "" };
    store.set(path(code), d); return d;
  }
  function revoke(em, code) { const d = get(code); if (!d || d.by !== lc(em)) return { error: "No such invite.", status: 404 }; if (statusOf(d) !== "open") return { error: "That invite can't be taken back now.", status: 409 };
    store.update(path(code), { revokedAt: Date.now() }); return { ok: true }; }
  /** The sign-up check, in the shape C.checkCode answers. */
  function check(code, now = Date.now()) {
    const d = get(code), st = statusOf(d, now), who = first(d?.byName) || "your friend";
    if (st === "missing") return { ok: false, message: "That invite link doesn't work. Ask your friend for a new one." };
    if (st === "used") return { ok: false, message: `That invite was already used. Ask ${who} for a new one.` };
    if (st === "revoked") return { ok: false, message: `That invite was taken back. Ask ${who} for a new one.` };
    if (st === "expired") return { ok: false, message: `That invite ran out after 30 days. Ask ${who} for a new one.` };
    return { ok: true, friend: true, c: { code: d.code, ownerEmail: d.by, ownerName: d.byName, ownerWs: d.byWs } };
  }
  /** The sign-up uses it: one use, the inviter hears, and the waitlist entry (if any) is marked. */
  function use(code, { ws, email, name }) {
    const d = get(code); if (!d || statusOf(d) !== "open") return null;
    store.update(path(code), { usedAt: Date.now(), usedBy: lc(email), usedByName: clean(name, 80), usedByWs: ws });
    if (d.waitId) { try { store.update("system/wait-" + d.waitId, { joinedAt: Date.now() }); } catch {} }
    if (d.by) { try { X?.notify?.(d.by, { kind: "friend", key: "finv-" + d.code, text: `${first(name) || "Your friend"} joined Pottery Lab with your invite. You're friends now.`, from: lc(email), link: "/plans" }); } catch {} }
    track("friend_invite_used", { ws, via: d.via });
    return true;
  }
  /** What the landing page may show: the inviter's first name, face and one line. Never their email. */
  function publicOf(code) {
    const d = get(code), st = statusOf(d); if (st === "missing") return null;
    const u = d.by ? getDbUser(d.by) : null, h = u?.ws && C?.profileOf ? C.profileOf(u.ws) : null, t = h?.theme || {};
    const avatar = /^(\/_blob\/[A-Za-z0-9_-]{6,80}|https:\/\/[^\s"<>()]+)$/.test(t.avatarUrl || "") ? { url: t.avatarUrl } : /^[a-z0-9~-]{1,40}$/i.test(t.avatarArt || "") ? { art: t.avatarArt } : null;
    const name = first(d.byName || u?.name);
    return { status: st, from: d.by ? { first: name, avatar, color: /^#[0-9a-f]{6}$/i.test(t.accent || h?.color || "") ? t.accent || h.color : "", handle: h?.handle || "" } : null,
      line: d.note || (d.by ? `${name} saved you a spot on Pottery Lab, where friends plan small get-togethers. This invite is just for you.` : "Your spot on Pottery Lab is ready. This invite is just for you."), exp: d.exp };
  }
  function opened(code) { const d = get(code); if (d && statusOf(d) === "open") store.update(path(code), { opens: (d.opens || 0) + 1, ...(d.firstOpenAt ? {} : { firstOpenAt: Date.now() }) }); }
  function grant(email, n, by) { const em = lc(email), k = Math.max(-100, Math.min(100, Math.round(+n || 0))); if (!em || !k) return null; const cur = store.get(grantPath(em))?.data || { kind: "finvgrant", email: em, extra: 0, log: [] };
    const next = { ...cur, extra: Math.max(0, (cur.extra || 0) + k), log: [...(cur.log || []), { by: lc(by), n: k, at: Date.now() }].slice(-50) }; store.set(grantPath(em), next); return next.extra; }
  /** The admin view: counts and conversion, top inviters (first names), never the content of anything. */
  function stats(now = Date.now()) {
    const L = all(), by = new Map();
    for (const d of L) { if (!d.by) continue; const x = by.get(d.by) || { email: d.by, name: d.byName, sent: 0, used: 0, open: 0 }; x.sent++; const st = statusOf(d, now); if (st === "used") x.used++; if (st === "open") x.open++; by.set(d.by, x); }
    const used = L.filter((d) => d.usedAt).length, opened = L.filter((d) => d.opens > 0 || d.usedAt).length;
    return { perMember: invitesPerMember(), created: L.length, opened, used, open: L.filter((d) => statusOf(d, now) === "open").length, expired: L.filter((d) => statusOf(d, now) === "expired").length, revoked: L.filter((d) => d.revokedAt).length,
      conversion: L.length ? Math.round((100 * used) / L.length) : 0, fromWaitlist: L.filter((d) => d.via === "admin").length,
      inviters: [...by.values()].sort((a, b) => b.used - a.used || b.sent - a.sent).slice(0, 50).map((x) => ({ ...x, extra: extraOf(x.email) })),
      joins: L.filter((d) => d.usedAt).sort((a, b) => b.usedAt - a.usedAt).slice(0, 50).map((d) => ({ inviter: d.by ? first(d.byName) || d.by : "Waitlist", invitee: first(d.usedByName) || "Someone", at: d.usedAt, via: d.via })) };
  }
  return { get, all, mine, counts, create, createForWaitlist, revoke, check, use, publicOf, opened, grant, stats, extraOf };
}

/** Route friend invite codes through the community's code check and use, so sign-up treats them like host codes. */
export function wrapFriendInvites(C, FI) {
  const check0 = C.checkCode, use0 = C.useCode;
  C.checkCode = (code) => (isFriendCode(code) ? FI.check(code) : check0(code));
  C.useCode = (code, who) => (isFriendCode(code) ? FI.use(code, who) : use0(code, who));
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function mountFriendInvites(app, { store, small, currentUser, C, X, publicOrigin, sendStatic, emailConfig = () => null, textOnce = null }) {
  const FI = makeFriendInvites({ store, X, C }); wrapFriendInvites(C, FI); app.locals.friendInvites = FI;
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const me = (req, res) => { let u = null; try { u = currentUser(req); } catch {} if (!u?.email || u.ws === DEFAULT_WS) { bad(res, "Sign in first.", 401, "unauthenticated"); return null; } res.set("Cache-Control", "private, no-store"); return u; };
  const admin = (req) => { const u = (() => { try { return currentUser(req); } catch { return null; } })(); return u && isAdmin(u.email) ? u : null; };
  const base = (req) => String(publicOrigin(req) || "").replace(/\/+$/, "");
  const hits = new Map(); const limited = (k, n, ms = 3600e3) => { const now = Date.now(), L = (hits.get(k) || []).filter((t) => now - t < ms); L.push(now); hits.set(k, L); if (hits.size > 20000) hits.clear(); return L.length > n; };
  const linkOf = (req, code) => `${base(req)}/join/${code}`;
  const messageOf = (u, link) => `Hey, it's ${first(u.name) || "me"}. I'm on Pottery Lab, where friends plan small get-togethers, and I saved you a spot. This invite is just for you: ${link}`;
  const view = (req, d) => ({ code: d.code, link: linkOf(req, d.code), status: statusOf(d), at: d.at, exp: d.exp, usedBy: d.usedByName ? first(d.usedByName) : "", opened: (d.opens || 0) > 0 });

  // ---- members: my invites, make one, take one back ----
  app.get("/api/me/invites", (req, res) => { const u = me(req, res); if (!u) return; res.json({ ...FI.counts(u.email), invites: FI.mine(u.email).slice(0, 30).map((d) => view(req, d)) }); });
  app.post("/api/me/invites", small, (req, res) => { const u = me(req, res); if (!u) return; if (limited("finv:" + lc(u.email), 30)) return bad(res, "That's a lot of invites at once. Try again in a bit.", 429, "rate_limited");
    const r = FI.create(u, { note: req.body?.note }); if (r.error) return bad(res, r.error, r.status, r.code || "invalid");
    const link = linkOf(req, r.invite.code); res.json({ ok: true, ...view(req, r.invite), message: messageOf(u, link), ...FI.counts(u.email) }); });
  app.delete("/api/me/invites/:code", (req, res) => { const u = me(req, res); if (!u) return; const r = FI.revoke(u.email, req.params.code); if (r.error) return bad(res, r.error, r.status); res.json({ ok: true, ...FI.counts(u.email) }); });

  // ---- the invitee: the warm page and what it may show ----
  app.get("/api/public/friend-invite/:code", (req, res) => { if (limited("finvp:" + (req.ip || "?"), 120)) return bad(res, "Slow down.", 429, "rate_limited");
    const P = isFriendCode(req.params.code) ? FI.publicOf(req.params.code) : null; if (!P) return res.set("Cache-Control", "no-store").json({ ok: false, status: "missing", from: null, message: "That invite link doesn't work. Ask your friend for a new one." }); // an answer, not a 404: the page says so kindly
    if (req.query.view === "1") FI.opened(req.params.code);
    res.set("Cache-Control", "no-store").json({ ok: P.status === "open", ...P, code: String(req.params.code).toUpperCase(), signup: `/signup?code=${encodeURIComponent(String(req.params.code).toUpperCase())}`,
      ...(P.status !== "open" ? { message: FI.check(req.params.code).message } : {}) }); });
  app.get(/^\/join\/(F[A-Za-z0-9]{9})$/, (req, res) => { res.set("Cache-Control", "no-store"); sendStatic(res, "join-friend.html", "<p>Invite page missing.</p>"); });

  // ---- admins: counts, conversions, grants, and the waitlist ----
  app.get("/api/admin/invites", (req, res) => { if (!admin(req)) return bad(res, "Not found.", 404, "not_found"); res.set("Cache-Control", "private, no-store");
    const W = (C.waitlist?.() || []).filter((w) => w.audience !== "brand");
    res.json({ ...FI.stats(), waitlist: W.slice(0, 200).map((w) => ({ id: w.id, name: w.name || "", contact: w.email || w.phone || "", city: w.city || "", via: w.via || "", at: w.at })), waiting: W.length,
      text: app.locals.pottoText?.status?.() || null }); });
  app.post("/api/admin/invites/grant", small, (req, res) => { const u = admin(req); if (!u) return bad(res, "Not found.", 404, "not_found");
    const em = lc(req.body?.email); if (!getDbUser(em)) return bad(res, "No member with that email.", 404, "not_found");
    const extra = FI.grant(em, req.body?.n, u.email); if (extra == null) return bad(res, "Say how many."); res.json({ ok: true, extra, ...FI.counts(em) }); });
  app.post("/api/admin/waitlist/:id/approve", small, async (req, res) => { const u = admin(req); if (!u) return bad(res, "Not found.", 404, "not_found");
    const p = "system/wait-" + String(req.params.id || "").replace(/[^a-f0-9]/g, ""), w = store.get(p)?.data; if (!w || w.kind !== "wait") return bad(res, "They're not on the waitlist.", 404, "not_found");
    if (w.invitedAt) return res.json({ ok: true, already: true });
    const d = FI.createForWaitlist(w, u.email), link = linkOf(req, d.code), hi = first(w.name) ? `Hi ${first(w.name)}, ` : "Hi, ";
    let sent = "";
    if (w.email) { const cfg = emailConfig(); if (cfg) { try { const r = await sendEmail(cfg, { to: w.email, subject: "You're off the Pottery Lab waitlist", text: `${hi}your spot on Pottery Lab is ready.\n\nJoin here, it's just for you: ${link}\n\nThe link works once, for 30 days.` }); if (r?.ok) sent = "email"; } catch {} } }
    if (!sent && w.phone && textOnce) { const r = await textOnce(w.phone, `${hi}it's Potto from Pottery Lab. You're off the waitlist. Your spot is ready: ${link}`); if (r?.ok) sent = "text"; }
    store.update(p, { invitedAt: Date.now(), invitedBy: lc(u.email), inviteCode: d.code });
    res.json({ ok: true, link, sent }); });
  app.get("/admin/invites", (req, res) => { if (!admin(req)) return res.status(404).type("text").send("Not found."); res.set("Cache-Control", "private, no-store");
    const S = FI.stats(), W = (C.waitlist?.() || []).filter((w) => w.audience !== "brand"), T = app.locals.pottoText?.status?.();
    const row = (L) => `<tr>${L.map((x) => `<td>${x}</td>`).join("")}</tr>`;
    res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invites · Pottery Lab</title><meta name="robots" content="noindex"><link rel="stylesheet" href="/system.css">
<style>body{margin:0;background:var(--pl-page);color:var(--pl-ink);font:16px/1.5 var(--pl-font-text)}main{max-width:960px;margin:0 auto;padding:24px 16px 64px}h1{font:600 32px/1.1 var(--pl-font-display);margin:8px 0 16px}h2{font:600 20px/1.2 var(--pl-font-text);margin:0 0 8px}
section{background:var(--pl-surface);border:1.5px solid var(--pl-ink);border-radius:6px;padding:16px;margin:0 0 16px}.nums{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px}.nums div{border-top:1px dashed var(--pl-line);padding-top:8px}.nums b{display:block;font:500 24px var(--pl-font-mono)}.nums small,.muted{color:var(--pl-soft);font-size:14px}
.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:15px}td,th{text-align:left;padding:8px;border-bottom:1px dashed var(--pl-line);vertical-align:top}th{font:500 13px var(--pl-font-mono);text-transform:uppercase;letter-spacing:.04em;color:var(--pl-accent-text)}
button,input{font:inherit}button{min-height:44px;padding:0 16px;border-radius:6px;border:1.5px solid var(--pl-ink);background:var(--pl-accent);color:#fff;cursor:pointer}input{min-height:44px;border:1.5px solid var(--pl-ink);border-radius:6px;padding:0 10px;background:var(--pl-surface);max-width:100%;box-sizing:border-box}
form{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.ok{color:var(--pl-success)}.kicker{font:500 13px var(--pl-font-mono);letter-spacing:.04em;text-transform:uppercase;color:var(--pl-accent-text)}</style></head><body><main>
<p class="kicker">Admin</p><h1>Invites and the waitlist</h1>
<section><h2>Potto by text</h2><p id="tx">${T ? esc(T.line) : "Off. Add the Twilio or WhatsApp settings in docs/potto-text.md to switch it on."}</p></section>
<section><h2>Friend invites</h2><div class="nums">${[["Each member gets", S.perMember], ["Invites made", S.created], ["Opened", S.opened], ["Joined", S.used], ["Still open", S.open], ["Conversion", S.conversion + "%"]].map(([l, n]) => `<div><b>${esc(n)}</b><small>${esc(l)}</small></div>`).join("")}</div></section>
<section><h2>Give someone more invites</h2><form id="grant"><input name="email" type="email" placeholder="Member's email" required aria-label="Member's email"><input name="n" type="number" value="5" min="1" max="100" aria-label="How many" style="width:90px"><button>Give invites</button><span id="gMsg" class="muted" role="status"></span></form></section>
<section><h2>Waitlist (${W.length})</h2>${W.length ? `<div class="scroll"><table><tr><th>When</th><th>Name</th><th>Contact</th><th>City</th><th></th></tr>${W.slice(0, 200).map((w) => row([esc(new Date(w.at).toISOString().slice(0, 10)), esc(w.name || ""), esc(w.email || w.phone || ""), esc(w.city || ""), `<button data-w="${esc(w.id)}">Approve</button>`])).join("")}</table></div>` : `<p class="muted">Nobody is waiting.</p>`}</section>
<section><h2>Top inviters</h2>${S.inviters.length ? `<div class="scroll"><table><tr><th>Member</th><th>Sent</th><th>Joined</th><th>Open</th><th>Extra</th></tr>${S.inviters.map((x) => row([esc(x.name || x.email) + `<br><small class="muted">${esc(x.email)}</small>`, x.sent, x.used, x.open, x.extra])).join("")}</table></div>` : `<p class="muted">No invites yet.</p>`}</section>
<section><h2>Recent joins</h2>${S.joins.length ? `<div class="scroll"><table><tr><th>When</th><th>Invited by</th><th>Joined</th></tr>${S.joins.map((j) => row([esc(new Date(j.at).toISOString().slice(0, 10)), esc(j.inviter), esc(j.invitee)])).join("")}</table></div>` : `<p class="muted">Nobody yet.</p>`}</section>
</main><script>
document.getElementById("grant").onsubmit=async(e)=>{e.preventDefault();const f=e.target,m=document.getElementById("gMsg");const r=await fetch("/api/admin/invites/grant",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:f.email.value,n:+f.n.value})});const j=await r.json().catch(()=>({}));m.textContent=r.ok?"Done. They have "+j.left+" left.":(j.message||"That didn't work.");};
document.querySelectorAll("[data-w]").forEach((b)=>b.onclick=async()=>{b.disabled=true;const r=await fetch("/api/admin/waitlist/"+b.dataset.w+"/approve",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});const j=await r.json().catch(()=>({}));b.outerHTML=r.ok?'<span class="ok">'+(j.sent==="email"?"Emailed":j.sent==="text"?"Texted":"Approved. Send them: "+(j.link||""))+"</span>":"<span>"+(j.message||"Didn't work")+"</span>";});
</script></body></html>`); });
  return FI;
}
