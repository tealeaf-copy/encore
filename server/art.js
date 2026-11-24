// Draw-your-own covers: a host describes an illustration and Claude draws it as SVG in Pottery Lab's style (thick black
// line art, white fills, one spot colour). Nothing the model writes is passed through: the SVG is rebuilt from an
// allow-list of shapes and attributes with checked values, so the result can't carry scripts, links or styles.
import { complete, isFake } from "./ai.js";

const W = 200, H = 150, MAX_ELEMENTS = 300, MAX_BYTES = 24000;
const TAGS = new Set(["g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon"]);
const NUM = /^-?\d*\.?\d+(e-?\d+)?$/i;
const COLOR = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|none|white|black)$/i;
const PATH = /^[0-9eE.,\s+\-MmLlHhVvCcSsQqTtAaZz]{1,6000}$/;
const POINTS = /^[0-9eE.,\s+\-]{1,3000}$/;
const TRANSFORM = /^(\s*(translate|scale|rotate|matrix|skewX|skewY)\(\s*[-0-9eE.,\s]{1,80}\)\s*){1,4}$/;
const DASH = /^[0-9.,\s]{1,40}$/;
const ATTRS = {
  d: PATH, points: POINTS, transform: TRANSFORM, fill: COLOR, stroke: COLOR, "stroke-dasharray": DASH,
  "stroke-linecap": /^(round|butt|square)$/, "stroke-linejoin": /^(round|miter|bevel)$/, "fill-rule": /^(nonzero|evenodd)$/,
  ...Object.fromEntries(["cx", "cy", "r", "rx", "ry", "x", "y", "width", "height", "x1", "y1", "x2", "y2", "stroke-width", "opacity"].map((k) => [k, NUM])),
};

/** Rebuild an SVG from the allowed parts only. Returns "" if nothing usable is left. */
export function cleanSvg(text) {
  const src = String(text || ""), start = src.search(/<svg[\s>]/i), end = src.search(/<\/svg>/i);
  if (start < 0 || end < start) return "";
  const body = src.slice(start, end), out = []; let n = 0, depth = 0;
  const re = /<\s*(\/)?\s*([a-zA-Z]+)([^<>]*?)(\/)?\s*>/g; let m;
  while ((m = re.exec(body)) && n < MAX_ELEMENTS) {
    const [, close, rawTag, rawAttrs, selfClose] = m, tag = rawTag.toLowerCase();
    if (tag === "svg") continue;
    if (!TAGS.has(tag)) continue;
    if (close) { if (tag === "g" && depth > 0) { out.push("</g>"); depth--; } continue; }
    const attrs = []; const ar = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)')/g; let a;
    while ((a = ar.exec(rawAttrs))) { const k = a[1].toLowerCase(), v = (a[3] ?? a[4] ?? "").trim(); const ok = ATTRS[k]; if (ok && ok.test(v)) attrs.push(`${k}="${v}"`); }
    n++;
    if (tag === "g") { if (selfClose) continue; out.push(`<g${attrs.length ? " " + attrs.join(" ") : ""}>`); depth++; }
    else out.push(`<${tag}${attrs.length ? " " + attrs.join(" ") : ""}/>`);
  }
  while (depth-- > 0) out.push("</g>");
  if (!out.some((x) => /^<(path|circle|ellipse|rect|line|polyline|polygon)/.test(x))) return "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${out.join("")}</svg>`;
  return svg.length <= MAX_BYTES ? svg : "";
}

const STYLE = (accent) => `You draw small spot illustrations for event invitations, in one consistent style:
- Thick black line art: stroke="#151515", stroke-width between 4 and 5, stroke-linecap="round", stroke-linejoin="round".
- Shapes filled white (fill="#ffffff"), with ONE spot colour used sparingly on one or two shapes: fill="${accent}".
- Flat and simple, like a friendly editorial icon: 3 to 12 shapes, no gradients, no text, no shading, no background rectangle.
- Fits a 200 × 150 canvas (viewBox "0 0 200 150"), centred, sitting on an implied ground line near y=136.
Use only these elements: g, path, circle, ellipse, rect, line, polyline, polygon. No style attributes, no text, no images, no links.
Reply with only the SVG, starting with <svg and ending with </svg>.`;

/** Draw an illustration for a prompt. */
export async function drawArt(prompt, accent = "#E8452C") {
  const what = String(prompt || "").replace(/[<>]/g, "").trim().slice(0, 200);
  const color = /^#[0-9a-f]{6}$/i.test(accent) ? accent : "#E8452C";
  if (isFake()) return cleanSvg(fakeDrawing(color));
  const r = await complete({ prompt: `${STYLE(color)}\n\nDraw: ${what}`, effort: "low" });
  return cleanSvg(r.text);
}

// offline mode: a simple drawing so the flow can be tried without calling Claude
function fakeDrawing(c) {
  return `<svg viewBox="0 0 200 150"><path d="M20 136h160" stroke="#151515" stroke-width="4.5" stroke-linecap="round"/><circle cx="100" cy="78" r="44" fill="#ffffff" stroke="#151515" stroke-width="4.5"/><path d="M100 40l10 26 28 2-22 18 8 27-24-16-24 16 8-27-22-18 28-2z" fill="${c}" stroke="#151515" stroke-width="4.5" stroke-linejoin="round"/><path d="M158 34l6-10M170 48l10-4M40 40l-8-6" stroke="#151515" stroke-width="4.5" stroke-linecap="round" fill="none"/></svg>`;
}
