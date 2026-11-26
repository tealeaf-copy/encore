// Review round 11: one way to say how big an event is, for every page a guest sees (/g, the light invite /e/:id,
// the host page and the app's cards). Spots are kept in people (headcount 12 for 6 pairs), so the reply cap fills
// right; guests read the unit the host typed: "6 pairs", "3 pairs left", "3 groups", "1 group left", "12 spots".
(function () {
  const short = (s) => String(s || "").replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day|sday|nesday|rsday|urday)\b/g, "$1");
  /** How many people one unit is: 2 for pairs, the group size for groups, else 1. */
  function unitSize(e) {
    const g = Math.floor(+e?.groupSize) || 0;
    if (e?.headUnit === "pairs") return g > 1 ? g : 2;
    if (e?.headUnit === "groups") return g > 1 ? g : 2;
    return 1;
  }
  /** "6 pairs" (left == null: the size) or "3 pairs left" (left: spots left, in people). */
  function spotsText(e, left) {
    // a pre-order counts what's for sale: "20 loaves", "3 loaves left" (stockUnit from "max 20 loaves"), else "20 available"
    if (e?.preorder) { const n = left == null ? +e.headcount || 0 : Math.max(0, Math.floor(+left || 0)), w = /^[a-z]{3,14}$/.test(String(e.stockUnit || "")) ? e.stockUnit : "";
      if (!w) return left == null ? `${n} available` : `${n} left`;
      const one = /ves$/.test(w) ? w.replace(/ves$/, "f") : /(?:ch|sh|x|ss)es$/.test(w) ? w.replace(/es$/, "") : /ies$/.test(w) ? w.replace(/ies$/, "y") : w.replace(/s$/, "");
      return `${n} ${n === 1 ? one : w}${left == null ? "" : " left"}`; }
    const U = e?.headUnit === "pairs" ? ["pair", "pairs"] : e?.headUnit === "groups" ? ["group", "groups"] : ["spot", "spots"], size = unitSize(e);
    const n = left == null ? (size > 1 ? (+e?.unitCount || +e?.groupCount || Math.floor((+e?.headcount || 0) / size)) : +e?.headcount || 0) : Math.floor(Math.max(0, +left || 0) / size);
    return `${n} ${n === 1 ? U[0] : U[1]}${left == null ? "" : " left"}`;
  }
  /** "Order by Thu" (or "Order by Thu, Dec 3") for a pre-order with an order-by day; "" otherwise. */
  function orderByText(e) {
    if (!e?.preorder) return "";
    // the date when there is one ("Order by Thu, Dec 10", the brand's date format), else the words the host typed
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(e.orderByDate || ""))) { const x = new Date(e.orderByDate + "T12:00:00"); if (!isNaN(x)) return `Order by ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][x.getDay()]}, ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][x.getMonth()]} ${x.getDate()}`; }
    const s = String(e.orderBy || "").trim();
    return s ? `Order by ${short(s.replace(/^by\s+/i, ""))}` : "";
  }
  /** "1 pair · $60", "1 group of 4 · $120": what one reply books on a group-priced event; "" when it isn't one. */
  function groupLine(e) {
    const g = Math.floor(+e?.groupSize) || 0; if (g <= 1) return "";
    const p = +e.groupPrice > 0 ? "$" + (+e.groupPrice % 1 ? (+e.groupPrice).toFixed(2) : +e.groupPrice) : "";
    return `${g === 2 && e.headUnit !== "groups" ? "1 pair" : `1 group of ${g}`}${p ? ` · ${p}` : ""}`;
  }
  /** A pickup window as the brand reads it: "10:00–11:00" and "10am to 11am" are both "10am to 11am" (as server/preorder.js). */
  function slotLabel(slot) {
    const t = String(slot || "").trim(); if (!t) return ""; const parts = t.split(/\s*(?:–|\u2014|-|\bto\b)\s*/i).filter(Boolean); if (!parts.length || parts.length > 2) return t;
    const P = parts.map((p) => p.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i)); if (P.some((m) => !m || +m[1] > 23 || (m[2] && +m[2] > 59))) return t.replace(/\s*[–\u2014-]\s*/g, " to ");
    const said = P.map((m) => (m[3] ? (/^p/i.test(m[3]) ? "pm" : "am") : "")), f = (h, mm, ap) => `${h % 12 || 12}${mm && mm !== "00" ? ":" + mm : ""}${ap}`;
    return P.map((m, i) => { const h = +m[1], mm = m[2] || ""; if (said[i]) return f(h, mm, said[i]); if (h > 12 || h === 0) return f(h, mm, h >= 12 ? "pm" : "am");
      const c = said[1 - i]; return f(h, mm, c ? (i === 0 && h % 12 > +P[1][1] % 12 ? (c === "pm" ? "am" : "pm") : c) : h === 12 || h < 7 ? "pm" : "am"); }).join(" to ");
  }
  const api = { spotsText, orderByText, groupLine, unitSize, slotLabel };
  if (typeof window !== "undefined") window.EncoreSpots = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
