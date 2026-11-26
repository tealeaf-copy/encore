// Email verification (launch review). A new account gets a link by email; until they tap it they can look around, reply
// and draft events, but not share an invite (publish) or file a report. Accounts from before this, team members from
// ENCORE_USERS, invited teammates and SSO sign-ins count as verified. ENCORE_VERIFY_EMAIL=0 turns the check off (tests,
// self-hosted teams without email); it's on by default.
// Also here: who counts as a trusted reporter (verified and at least 7 days old), and founder-code limits and logs.
import crypto from "node:crypto";
import { DEFAULT_WS, getDbUser, putDbUser } from "./workspaces.js";
import { emailConfig, sendEmail } from "./email.js";

export const verifyRequired = () => process.env.ENCORE_VERIFY_EMAIL !== "0";
const lc = (s) => String(s || "").trim().toLowerCase();
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 32);
const DAY = 864e5;
/** True unless the account was made by sign-up and hasn't confirmed its email yet. */
export const emailVerified = (email) => { const u = getDbUser(lc(email)); return !u || u.emailVerified !== false; };
/** Verified and at least `days` old: reports from these people can hide something before a person looks. */
export const trustedReporter = (email, days = 7, now = Date.now()) => { const u = getDbUser(lc(email)); return !!u && u.emailVerified !== false && !!u.createdAt && now - u.createdAt >= days * DAY; };

export function makeVerify({ store, publicOrigin }) {
  const path = (t) => "system/verify-" + sha(t);
  async function send(req, email, name = "") {
    const token = crypto.randomBytes(24).toString("base64url"); store.set(path(token), { email: lc(email), exp: Date.now() + 7 * DAY });
    const link = `${publicOrigin(req)}/verify?t=${encodeURIComponent(token)}`, cfg = emailConfig(DEFAULT_WS, true);
    if (cfg?.service === "fake") console.log(`[verify] ${lc(email)} ${link}`); // demos: the link shows in the server log
    if (cfg) await sendEmail(cfg, { to: lc(email), subject: "Confirm your email for Pottery Lab", text: `Hi${name ? " " + String(name).split(/\s+/)[0] : ""},\n\nTap to confirm this is your email, so you can share invites:\n${link}\n\nIf you didn't sign up for Pottery Lab, you can ignore this.` }).catch(() => {});
    return link; }
  function confirm(token) { const p = path(token), d = store.get(p)?.data; if (!d || d.exp < Date.now()) return null; const u = getDbUser(d.email); if (!u) return null;
    putDbUser({ ...u, emailVerified: true, verifiedAt: Date.now() }); store.delete(p); return d.email; }
  return { send, confirm };
}

// founder codes (ENCORE_FOUNDER_CODES) stay reusable, but each IP can use one a few times a day and every use is logged
export function founderGate(store, req, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10), ip = String(req.ip || "?"), k = "system/founder-" + day, d = store.get(k)?.data || { uses: [] };
  const perIp = Math.max(1, +process.env.ENCORE_FOUNDER_PER_IP || 3), perDay = Math.max(1, +process.env.ENCORE_FOUNDER_PER_DAY || 40), ipH = sha(ip);
  if (d.uses.filter((u) => u.ip === ipH).length >= perIp || d.uses.length >= perDay) return { ok: false, message: "That host code has been used a lot today. Try again tomorrow, or ask a host for their own code." };
  return { ok: true, log: (email) => { const x = store.get(k)?.data || { uses: [] }; x.uses.push({ ip: ipH, email: lc(email), at: now }); store.set(k, x); console.log(`[founder] code used by ${lc(email)} (${x.uses.length} today)`); } };
}
