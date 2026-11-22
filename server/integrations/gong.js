// Gong (read only): find calls in a date range with people from given companies (email domains), with each
// call's title, date, the companies on it and Gong's brief. Never full transcripts.
// Only for workspaces that connected Gong (POST /api/connections {provider:"gong", accessKey, accessKeySecret, baseUrl?}).
import { crmToken } from "./context.js";

const fail = (message) => ({ code: "tool_error", message: `Gong: ${message}` });
export const DEFAULT_GONG = "https://api.gong.io";
/** https://<anything>.gong.io only. Returns the origin, or null. */
export function gongOrigin(v) {
  if (v == null || v === "") return DEFAULT_GONG;
  let u; try { u = new URL(String(v)); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
  const h = u.hostname.toLowerCase();
  return /^[a-z0-9.-]+$/.test(h) && (h === "gong.io" || h.endsWith(".gong.io")) ? "https://" + h : null;
}
export const gongAuth = (key, secret) => "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
function creds() {
  let c; try { c = JSON.parse(crmToken("gong", null) || "null"); } catch {}
  if (!c?.accessKey || !c?.accessKeySecret) throw fail("not connected");
  const base = gongOrigin(c.baseUrl); if (!base) throw fail("bad base URL");
  return { base, auth: gongAuth(c.accessKey, c.accessKeySecret) };
}
const day = (v, what) => { const s = String(v || ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s + "T00:00:00Z"))) throw fail(`${what} must be YYYY-MM-DD`); return s; };
const domainOf = (e) => String(e || "").toLowerCase().split("@")[1] || "";

async function searchCalls(input) {
  const { base, auth } = creds();
  const from = day(input?.fromDate, "fromDate"), to = day(input?.toDate, "toDate");
  if (to < from) throw fail("toDate is before fromDate");
  const domains = (Array.isArray(input?.domains) ? input.domains : input?.domains ? [input.domains] : []).map((d) => String(d).trim().toLowerCase().replace(/^@/, "")).filter(Boolean).slice(0, 50);
  const limit = Math.max(1, Math.min(100, Math.floor(+input?.limit || 25)));
  const out = []; let cursor;
  for (let page = 0; page < 10 && out.length < limit; page++) {
    const body = { filter: { fromDateTime: `${from}T00:00:00Z`, toDateTime: `${to}T23:59:59Z` }, contentSelector: { context: "None", exposedFields: { parties: true, content: { brief: true } } }, ...(cursor ? { cursor } : {}) };
    let res;
    try { res = await fetch(`${base}/v2/calls/extensive`, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) }); }
    catch { throw fail(`can't reach ${base}`); }
    let json = null; try { json = await res.json(); } catch {}
    if (res.status === 404) break; // Gong answers 404 when no calls match
    if (!res.ok) throw fail(json?.errors?.join?.("; ") || `HTTP ${res.status}`);
    for (const c of json?.calls || []) {
      const parties = c.parties || [], dom = [...new Set(parties.map((p) => domainOf(p.emailAddress)).filter(Boolean))];
      if (domains.length && !dom.some((d) => domains.includes(d))) continue;
      const external = [...new Set(parties.filter((p) => p.affiliation !== "Internal").map((p) => domainOf(p.emailAddress)).filter(Boolean))];
      out.push({ id: c.metaData?.id, title: c.metaData?.title || "", date: String(c.metaData?.started || "").slice(0, 10), durationMin: c.metaData?.duration ? Math.round(c.metaData.duration / 60) : null,
        companies: external.length ? external : dom, brief: String(c.content?.brief || "").slice(0, 1500) });
      if (out.length >= limit) break;
    }
    cursor = json?.records?.cursor; if (!cursor) break;
  }
  return { calls: out, from, to, domains };
}

export default function gong({ force = false } = {}) {
  if (!force) return null; // per-workspace only
  return {
    server: "Gong",
    tools: [{
      name: "gong_search_calls",
      description: "Find recorded calls in a date range that included people from these companies (email domains). Returns each call's title, date, the companies on it and Gong's short brief, not transcripts.",
      inputSchema: { type: "object", properties: { fromDate: { type: "string", description: "YYYY-MM-DD" }, toDate: { type: "string", description: "YYYY-MM-DD" }, domains: { type: "array", items: { type: "string" }, description: "Participant email domains, e.g. acme.com" }, limit: { type: "number", description: "max 100" } }, required: ["fromDate", "toDate"] },
      run: searchCalls,
    }],
  };
}
