// A city's time zone, for "this weekend" and other dates that depend on where someone is. Shared by the events
// directory (date words in a search) and the hooks (the weekend digest), without either importing the other.
const CITY_TZ = [[/new york|brooklyn|queens|manhattan|bronx|staten island|jersey city|hoboken|boston|philadelphia|washington|miami|atlanta|toronto|montreal|detroit/i, "America/New_York"],
  [/chicago|austin|houston|dallas|san antonio|minneapolis|nashville|new orleans/i, "America/Chicago"], [/phoenix|tucson/i, "America/Phoenix"], [/denver|boulder|salt lake/i, "America/Denver"],
  [/san francisco|oakland|berkeley|san jose|palo alto|los angeles|santa monica|san diego|seattle|portland|vancouver|napa|sacramento/i, "America/Los_Angeles"],
  [/london/i, "Europe/London"], [/sydney/i, "Australia/Sydney"], [/melbourne/i, "Australia/Melbourne"]];
export const tzOk = (tz) => { if (!tz) return false; try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } };
export const tzOfCity = (place) => { const t = String(place || ""); return CITY_TZ.find(([re]) => re.test(t))?.[1] || ""; };
/** Today's date (YYYY-MM-DD) where the event is: its own time zone, else the city's, else the server's. */
export const todayIn = (tz, now = Date.now()) => {
  const z = tzOk(tz) ? tz : "";
  if (!z) { const d = new Date(now); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  return new Intl.DateTimeFormat("en-CA", { timeZone: z, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
};
/** A pre-order whose order-by date has passed where the event is. */
export const ordersClosed = (ev, now = Date.now()) => { if (!ev?.preorder || !/^\d{4}-\d{2}-\d{2}$/.test(String(ev.orderByDate || ""))) return false; const tz = ev.tz || tzOfCity(ev.city), t = todayIn(tz, now);
  return t > ev.orderByDate || (t === ev.orderByDate && /^\d{2}:\d{2}$/.test(ev.orderByTime || "") && now >= zonedMs(ev.orderByDate, ev.orderByTime, tz)); }; // a drop's cutoff can have a time ("Fri 8pm")
// ---- review round 11: the time zone an event runs on, for every job that means "the morning after" or "tomorrow" ----
/** The event's own tz, else its city's, else the host's (Potto settings), else ENCORE_TZ, else "" (the server's). */
export const eventTz = (ev, hostTz = "") => { for (const z of [ev?.tz, tzOfCity(ev?.city), tzOfCity(ev?.hood), hostTz, process.env.ENCORE_TZ]) if (z && tzOk(z)) return z; return ""; };
/** Epoch ms of a wall-clock date and time ("2026-12-12", "19:00") in a time zone ("" means the server's). */
export function zonedMs(date, time, tz) {
  const local = `${date}T${time}:00`; if (!tz || !tzOk(tz)) return Date.parse(local);
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const off = (t) => { const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value])); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - t; };
  const guess = Date.parse(local + "Z"); if (isNaN(guess)) return NaN; let t = guess - off(guess); t = guess - off(t); return t;
}
/** The hour (0 to 23) at `now` in a time zone ("" means the server's). */
export const hourIn = (tz, now = Date.now()) => { try { return +new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", ...(tz && tzOk(tz) ? { timeZone: tz } : {}) }).format(now) % 24; } catch { return new Date(now).getHours(); } };
