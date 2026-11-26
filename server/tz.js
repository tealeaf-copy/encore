// A city's time zone, for "this weekend" and other dates that depend on where someone is. Shared by the events
// directory (date words in a search) and the hooks (the weekend digest), without either importing the other.
const CITY_TZ = [[/new york|brooklyn|queens|manhattan|bronx|staten island|jersey city|hoboken|boston|philadelphia|washington|miami|atlanta|toronto|montreal|detroit/i, "America/New_York"],
  [/chicago|austin|houston|dallas|san antonio|minneapolis|nashville|new orleans/i, "America/Chicago"], [/phoenix|tucson/i, "America/Phoenix"], [/denver|boulder|salt lake/i, "America/Denver"],
  [/san francisco|oakland|berkeley|san jose|palo alto|los angeles|santa monica|san diego|seattle|portland|vancouver|napa|sacramento/i, "America/Los_Angeles"],
  [/london/i, "Europe/London"], [/sydney/i, "Australia/Sydney"], [/melbourne/i, "Australia/Melbourne"]];
export const tzOk = (tz) => { if (!tz) return false; try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } };
export const tzOfCity = (place) => { const t = String(place || ""); return CITY_TZ.find(([re]) => re.test(t))?.[1] || ""; };
