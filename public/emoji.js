// One emoji per event, the same on every screen (Home, Plans, Feed, the invite).
// Title words first (🌮 for "Taco Tuesday"), then the kind of event, then lunch-type words, then 🎉.
(function () {
  const KW = [["turkey", "🦃"], ["thanksgiving", "🦃"], ["friendsgiving", "🦃"], ["pumpkin", "🎃"], ["halloween", "🎃"], ["christmas", "🎄"], ["holiday", "🎄"], ["taco", "🌮"], ["dumpling", "🥟"], ["pizza", "🍕"], ["sushi", "🍣"], ["omakase", "🍣"], ["ramen", "🍜"], ["brunch", "🥞"], ["bbq", "🍖"], ["barbecue", "🍖"], ["wine", "🍷"], ["cocktail", "🍸"], ["coffee", "☕"], ["pour-over", "☕"], ["hike", "🥾"], ["run", "🏃"], ["5k", "🏃"], ["bike", "🚲"], ["picnic", "🧺"], ["game", "🎲"], ["board", "🎲"], ["movie", "🎬"], ["film", "🎬"], ["karaoke", "🎤"], ["book", "📚"], ["pottery", "🏺"], ["ceramic", "🏺"], ["clay", "🏺"], ["yoga", "🧘"], ["swim", "🏊"], ["beach", "🏖️"], ["birthday", "🎂"], ["cake", "🍰"], ["bake", "🧁"], ["potluck", "🥘"], ["cook", "🍳"], ["dinner", "🍽️"], ["supper", "🍽️"]];
  // the kind of event (the app's activity list)
  const ACT = { "run club": "🏃", hike: "🥾", picnic: "🧺", potluck: "🍲", "game night": "🎲", "book club": "📚", giveaway: "🎁", "pop-up": "🛍", workshop: "🌷", "cooking night": "🍳", "movie night": "🎬", concert: "🎶", matcha: "🍵", "club gathering": "🫂" };
  const LATE = [["ramen", "🍜"], ["noodle", "🍜"], ["salad", "🥗"], ["brunch", "🥞"], ["lunch", "🥪"], ["breakfast", "🥐"]];
  const low = (s) => String(s || "").toLowerCase();
  function kindOf(d) {
    const a = low(d.activity || d.format || d.name);
    if (/cook|try (?:my|new|out)|tasting|dishes|supper club|dinner party/.test(a)) return "cooking night";
    if (/movie|film/.test(a)) return "movie night";
    if (/concert|gig|festival|\bshow\b/.test(a)) return "concert";
    if (/matcha|tea party/.test(a)) return "matcha";
    if (/club (?:gathering|meet|night)/.test(a)) return "club gathering";
    const a2 = low(d.activity || d.format), t = a2 + " " + low(d.name || d.pubTitle);
    const k = Object.keys(ACT).find((x) => a2.includes(x));
    if (k) return k;
    if (/dumpling|cook|dinner|supper|pasta|bake|baking|taco|noodle|ramen|bbq|grill/.test(t)) return "cooking night";
    if (/\bbook\b|reading/.test(t)) return "book club";
    if (/matcha|tea\b/.test(t)) return "matcha";
    return "";
  }
  function titleEmoji(d) { const t = low(`${d.pubTitle || d.title || ""} ${d.name || ""} ${d.concept || ""}`); return (KW.find(([k]) => t.includes(k)) || [])[1] || ""; }
  function eventEmoji(d) {
    d = d || {};
    const em = titleEmoji(d) || ACT[kindOf(d)];
    if (em) return em;
    const t = low(`${d.activity || ""} ${d.name || ""} ${d.pubTitle || d.title || ""}`), hit = LATE.find(([k]) => t.includes(k));
    return hit ? hit[1] : "🎉";
  }
  window.EventEmoji = { KW, titleEmoji, eventEmoji };
  window.eventEmoji = eventEmoji;
})();
