// New York run templates on the server: the same list the app uses (public/runtemplates.js, read once), for Potto.
// When a host says they're in New York and host runs, Potto offers the templates as one-tap links into the create
// canvas. When they say a run ("easy 5K in Prospect Park Saturday 8"), Potto fills the template with that day, time
// and title and links straight to it. Links are the app's own (/?app=1&new=1&kind=run&tpl=...#studio); nothing is
// saved or sent until the host taps Save on the canvas. Saving New York as their page city is an action they confirm.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
let RT = null;
/** The templates and their helpers (window.RunTemplates from public/runtemplates.js). */
export function runTemplates() { if (RT) return RT; const box = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(here, "..", "public", "runtemplates.js"), "utf8"), box, { timeout: 500 }); return (RT = box.window.RunTemplates); }

const HOSTS_RUNS = /\b(i|we) (host|run|lead|organi[sz]e|do|have|started?)\b.*\b(runs?|running|run club|runners|5ks?|jogs?)\b|\b(run club|running club|running group|run crew)\b|\bhost(ing)? (a )?runs?\b|\brun (templates?|ideas)\b/i;
const SAYS_NYC = /\b(new york|nyc|manhattan|brooklyn|queens|the bronx|bronx|staten island)\b/i;
const SET_UP = /\b(set (it )?up|make|plan|start|create|organi[sz]e|host|draft|fill|put together|template)\b/i;

/** Potto's reply for a New York run host, or null when the message isn't one. ctx: Potto's context (server/potto.js). */
export function runPottoReply(message, ctx = {}) {
  const R = runTemplates(), m = String(message || "").trim(); if (!m || !ctx.me?.host) return null;
  const inNyc = SAYS_NYC.test(m) || R.isNYC(ctx.me?.city), today = ctx.today || new Date().toISOString().slice(0, 10);
  const P = R.parse(m, today);
  // a run with a spot we know ("easy 5K in Prospect Park Saturday 8"): the filled template
  if (P?.id && (P.date || P.time || SET_UP.test(m) || inNyc)) { const T = R.byId(P.id), href = R.urlOf(P.id, { date: P.date, time: P.time, title: P.title, repeat: P.repeat }), ev = R.toEvent(P.id, { today, date: P.date, time: P.time, title: P.title, repeat: P.repeat });
    const when = new Date(ev.date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }), clock = (t) => { let [h, mm] = t.split(":").map(Number); const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return `${h}${mm ? ":" + String(mm).padStart(2, "0") : ""}${ap}`; };
    return { intent: "run-template", links: [{ label: `Open ${ev.pubTitle}`, href }, { label: "Other New York runs", href: R.urlOf("pick") }], action: cityAction(ctx, inNyc),
      answer: `Here's ${ev.pubTitle}, ${when} at ${clock(ev.startTime)}${ev.repeat === "weekly" ? ", every week" : ""}. I filled in the spot (${T.spot}), the route, pace groups and ${/coffee|bagel/i.test(T.after) ? "coffee after" : "what's after"}. Tap to check it, then Save to get the link.` }; }
  // "I'm in New York and I host runs": the templates
  const runny = HOSTS_RUNS.test(m) || (P && SET_UP.test(m));
  if (inNyc && runny) { const top = ["prospect", "reservoir"].map(R.byId);
    return { intent: "run-templates", links: [...top.map((T) => ({ label: T.title, href: R.urlOf(T.id) })), { label: `All ${R.LIST.length} New York runs`, href: R.urlOf("pick") }], action: cityAction(ctx, true),
      answer: `Nice. I have ${R.LIST.length} New York runs ready to go, from the Central Park Reservoir to Prospect Park, the Hudson and Astoria Park. Each has a meeting spot people can find, the route, pace groups and coffee after. Pick one and change anything. Or tell me the run, like "easy 5K in Prospect Park Saturday 8".` }; }
  // a run with no spot from a New York host: the picker, keeping the day and time
  if (P && inNyc && (P.date || P.time)) return { intent: "run-pick", links: [{ label: "Pick a spot", href: R.urlOf("pick", { date: P.date, time: P.time, title: P.title, repeat: P.repeat }) }], action: cityAction(ctx, true),
    answer: "Where are you running? Pick a spot and I'll fill in the route, pace groups and coffee after, with your day and time." };
  return null;
}
/** "Make New York my city" when the host's page doesn't say it yet: their page city shows on cards and maps. */
function cityAction(ctx, inNyc) { const R = runTemplates(); if (!inNyc || R.isNYC(ctx.me?.city)) return null;
  return { type: "city", city: "New York" }; }
/** The action, built here (server/potto.js buildAction hands "city" over). */
export function runCityAction(ctx, a) { if (a?.type !== "city" || !ctx.me?.host) return null;
  return { id: "city-nyc", type: "city", label: "Make New York my city", confirm: "Set your page's city to New York? Cards and maps use it.", method: "POST", url: "/api/host/profile", body: { city: "New York" }, done: "Done. Your page says New York." }; }
/** Links Potto may carry for these: the app's own create links with a template. */
export const RUN_LINK = /^\/\?app=1&new=1&kind=run&tpl=[a-z-]{2,20}(&(date|time|repeat|title)=[\w%.:-]{1,200})*#studio$/;
