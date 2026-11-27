// The suggestion bank on the server: public/autocomplete.js (the phrase bank and its ranking, read once, the way
// server/geo.js reads public/place.js), the places it completes (server/geo.js neighbourhoods with their borough, and
// the app's cities with every name they go by), and Potto's offline completions for ENCORE_FAKE_AI=1 (server/ai.js).
// No imports from server/ai.js, so ai.js can use fakeSuggest without a cycle.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { HOODS } from "./geo.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let S = null, CITIES = null;
const load = (f) => { const box = { window: {} }; box.window.window = box.window; vm.runInNewContext(fs.readFileSync(path.join(here, "..", "public", f), "utf8"), box.window, { timeout: 1000 }); return box.window; };
/** The bank and its pure functions (PLSuggest without the page part). */
export function bank() { if (S) return S; try { S = load("autocomplete.js").PLSuggest || null; } catch (e) { console.warn("[suggest] couldn't read public/autocomplete.js:", e?.message); S = null; } return S; }
function cityRows() { if (CITIES) return CITIES; try { CITIES = load("place.js").EncorePlace?.CITIES || []; } catch { CITIES = []; } return CITIES; }

// New York's neighbourhoods by borough, so "brook" finds "Greenpoint, Brooklyn"; the Bay's own cities stand alone
const BOROUGH = { Brooklyn: ["Williamsburg", "Greenpoint", "Bushwick", "Bed-Stuy", "Bedford-Stuyvesant", "Park Slope", "Crown Heights", "Prospect Heights", "Fort Greene", "Clinton Hill", "DUMBO", "Brooklyn Heights", "Red Hook", "Gowanus", "Carroll Gardens", "Cobble Hill", "Sunset Park", "Flatbush"],
  Queens: ["Ridgewood", "Long Island City", "Astoria", "Sunnyside", "Jackson Heights"] };
const AREA = new Map(Object.entries(BOROUGH).flatMap(([b, L]) => L.map((h) => [h, b])));
const areaOf = (r) => (r.city === "New York" ? AREA.get(r.hood) || "Manhattan" : r.city === "San Francisco" && /^(Oakland|Berkeley)$/.test(r.hood) ? r.hood : r.city);
let PL = null;
/** What the page needs to complete places with no server: { v, cities: [[name, aliases]], hoods: [[hood, area, city]] }. */
export function placesPayload() { if (PL) return PL;
  PL = { v: 1, cities: cityRows().map((c) => (c[3] ? [c[0], c[3]] : [c[0]])), hoods: [...HOODS.values()].map((r) => [r.hood, areaOf(r), r.city]) }; return PL; }

// ---- Potto offline (ENCORE_FAKE_AI=1): plain rules over the same bank, a little smarter than the page's own ----
const tag = (p, t) => (String(p).match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)) || [])[1]?.trim() || "";
const h32 = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const DAY = { sun: "Sunday", sat: "Saturday", fri: "Friday", thu: "Thursday" };
/** { items: [{ text, kind, place, day, time }] } from a POTTO-SUGGEST prompt: the bank's best, then one or two that
 *  name a real neighbourhood or park in the person's city and a day and time, the way a friend who knows the city would. */
export function fakeSuggest(prompt) {
  const B = bank(); if (!B) return { items: [] };
  const kind = tag(prompt, "field") || "idea", city = tag(prompt, "city"), typed = tag(prompt, "typed"), P = placesPayload(), D = B.placeData(P), home = B.cityOf(city, D);
  const local = B.rank(typed, { kind, city, places: D, limit: 6 }), items = [];
  const hoods = P.hoods.filter((h) => h[2] === home), spots = B.SPOTS.filter((s) => s[1] === home), seed = h32(typed + "|" + home);
  const pick = (L) => (L.length ? L[seed % L.length] : null);
  if (kind === "idea" || kind === "alert") {
    const top = local.find((x) => B.completion(typed, x.text)) || local[0];
    if (top && home && kind === "idea" && !top.dest && top.k !== "weekend") { const outdoors = /^(run|hike|picnic)$/.test(top.k || ""), where = outdoors ? pick(spots)?.[0] : pick(hoods)?.[0], base = (top.title || top.text).replace(/,.*$/, "").replace(/\s+(at my place|at mine)$/i, "");
      const day = top.day || (outdoors ? "sat" : "fri"), time = top.time || (outdoors ? "08:00" : "19:00"), clock = (t) => { const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""}${h < 12 ? "am" : "pm"}`; };
      const has = (top.place && top.place !== "My place" ? top.place : "") || (/\b(?:in|at)\s+[A-Z]/.test(base) ? base.replace(/^.*\b(?:in|at)\s+/, "") : ""), at = has || where; // a place it already names stays the place
      if (at) items.push({ text: `${has ? base : `${base} in ${where}`} ${DAY[day] || "Saturday"} ${clock(time)}`, kind: top.k || "", place: at, day, time }); }
    if (kind === "alert" && home) { const t = local[0]?.text.replace(/\bin my city\b|\bnear me\b|\bwithin \d+ miles\b/i, "").trim(); if (t && !/\b(?:in|near|within|around)\b/i.test(t)) items.push({ text: `${t} in ${pick(hoods)?.[1] || home}`, kind: "" }); }
  }
  for (const x of local) items.push({ text: x.text, kind: x.k || "", ...(x.place ? { place: x.place } : {}), ...(x.day ? { day: x.day } : {}), ...(x.time ? { time: x.time } : {}) });
  return { items: items.slice(0, 5) };
}
