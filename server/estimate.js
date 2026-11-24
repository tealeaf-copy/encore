// The homepage demo runs the app's own planner, so its numbers always match
// what a user sees after signing up. This pulls the named top-level
// declarations out of index.html (a declaration line plus its indented
// continuation lines) and wraps them as a small browser script.
import fs from "node:fs";

export const ESTIMATE_NAMES = ["planFromText", "fitRows", "TPL_SEATS", "budgetModel", "BUDGET_MODEL", "METRIC_CUR", "cityIdx", "CITY_T1", "fxRate", "kindOf", "parseEventText", "parseMoney", "MONTHS", "confFromText", "CONF_CAL", "KINDS", "brandProfile", "FX", "SHOW_SIZE", "TIERS", "TRIM_ORDER", "NICE", "lineTierOf", "budgetRows", "budgetTotal", "customTotal", "fitByTiers", "lastPerLine", "applyPicks", "BUDGET_PICK", "SOCIAL_PICK"];

export function extractDeclarations(html, names = ESTIMATE_NAMES) {
  const start = html.indexOf("<script>");
  const lines = html.slice(start < 0 ? 0 : start).split("\n");
  const found = [], missing = [];
  for (const name of names) {
    const re = new RegExp(`^(?:async\\s+)?(?:function\\s+${name}\\s*\\(|(?:const|let|var)\\s+[^=]*\\b${name}\\s*=)`);
    const k = lines.findIndex((l) => re.test(l));
    if (k < 0) { missing.push(name); continue; }
    const out = [lines[k]];
    for (let j = k + 1; j < lines.length && /^[\s\]})]/.test(lines[j]) && lines[j].trim(); j++) out.push(lines[j]);
    if (!found.includes(out.join("\n"))) found.push(out.join("\n"));
  }
  // Later statements that add to a declaration (e.g. BUDGET_MODEL.summit = ...)
  for (const name of names) {
    const re = new RegExp(`^${name}(?:\\.|\\[)`);
    lines.forEach((l, k) => { if (!re.test(l)) return; const out = [l]; for (let j = k + 1; j < lines.length && /^[\s\]})]/.test(lines[j]) && lines[j].trim(); j++) out.push(lines[j]); found.push(out.join("\n")); });
  }
  return { code: found.join("\n"), missing };
}

export function buildEstimateScript(file) {
  const { code, missing } = extractDeclarations(fs.readFileSync(file, "utf8"));
  if (missing.length) throw new Error("estimate.js: missing " + missing.join(", "));
  return `/* Pottery Lab's planner, served from the app so the homepage demo matches it. */\n(function(){\n${code}\nwindow.EncorePlan={planFromText,fxRate};\n})();\n`;
}
