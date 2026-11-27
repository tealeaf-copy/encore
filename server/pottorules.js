// Ask Potto without a model: plain rules over the small, permission-checked context server/potto.js builds.
// It answers lookups (what's on, who's going, who hasn't replied), finds pages, drafts a plain reminder from the
// event's own facts, and says when it needs AI it doesn't have. Used three ways:
// - offline (no ANTHROPIC_API_KEY, or today's allowance is used up): the whole answer
// - fake (ENCORE_FAKE_AI=1, tests and demos): server/ai.js fakeText answers a "POTTO-ASK" prompt with it
// - live: a fallback when the model's reply can't be read
// No imports: server/ai.js loads this file, and it never sees anything the context doesn't hold.

const lc = (s) => String(s || "").toLowerCase();
const WD = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const wdOf = (iso) => new Date(iso + "T12:00:00Z").getUTCDay();
const nice = (iso) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return ""; const d = new Date(iso + "T12:00:00Z"); return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }); };
const clock = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ""); if (!m) return ""; const h = +m[1] % 12 || 12; return `${h}${m[2] === "00" ? "" : ":" + m[2]}${+m[1] < 12 ? "am" : "pm"}`; };
export const whenOf = (e) => [nice(e.date), clock(e.time)].filter(Boolean).join(" · ");
const list = (names) => names.length <= 1 ? names.join("") : names.length === 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

export const SUPPORT = /\b(how do i|how can i|how to|password|sign ?in|log ?in|log ?out|my account|delete my|refund|charged|payment|pay ?out|bug|broken|not working|doesn'?t work|reset|verify|verification|my email|change my (name|email|handle)|contact (you|support)|support|talk to (a |an )?(person|human|someone)|real person|report (a|someone)|harass\w*|unsafe|privacy)\b/i;

const URGENT = /\b(talk to (a |an )?(person|human|someone)|real person|refund|charged|harass\w*|unsafe|bug|broken|not working|doesn'?t work|hacked|scam)\b/i;
const ABOUT_EVENTS = /\b(remind\w*|fill|spots?|seats?|repl\w*|going|coming|weekend|tonight|tomorrow|ideas?|draft)\b/i;
/** A support question (the help guide and a person), not one about events. */
export const isSupport = (m) => URGENT.test(m) || (SUPPORT.test(m) && !ABOUT_EVENTS.test(m));

/** Which day(s) a message means, from today's date: { from, to } or null. */
export function daysOf(msg, today) {
  const m = lc(msg);
  if (/\b(tonight|today)\b/.test(m)) return { from: today, to: today };
  if (/\btomorrow\b/.test(m)) return { from: addDays(today, 1), to: addDays(today, 1) };
  if (/\bweekend\b/.test(m)) { const w = wdOf(today), toFri = w === 0 ? -2 : w === 6 ? -1 : 5 - w; const fri = addDays(today, toFri); return { from: fri < today ? today : fri, to: addDays(fri, 2) }; }
  if (/\bthis week\b/.test(m)) return { from: today, to: addDays(today, 6 - wdOf(today) || 7) };
  if (/\bnext week\b/.test(m)) { const s = addDays(today, 7 - wdOf(today)); return { from: s, to: addDays(s, 6) }; }
  for (let i = 0; i < 7; i++) if (new RegExp(`\\b${WD[i]}('?s)?\\b|\\b${WD[i].slice(0, 3)}\\b`).test(m)) { const n = (i - wdOf(today) + 7) % 7; const d = addDays(today, n); return { from: d, to: d }; }
  return null;
}
const inDays = (e, D) => !D || (e.date >= D.from && e.date <= D.to);
const words = (s) => lc(s).replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
const STOP = new Set(["the", "and", "for", "who", "what", "whats", "going", "coming", "this", "that", "with", "are", "any", "anything", "something", "there", "about", "can", "you", "me", "my", "is", "on", "to", "of", "a", "in", "it", "next", "night", "draft", "reminder", "remind", "replied", "hasnt", "havent", "weekend", "friday", "saturday", "sunday", "monday", "tuesday", "wednesday", "thursday", "tonight", "today", "tomorrow", "event", "events", "please", "fill", "empty", "seats", "spots", "ideas", "idea"]);
/** The best event in a list for a message: a title word in common, then the day, then the soonest. */
export function pickEvent(L, msg, today, attached = "") {
  if (!L?.length) return null;
  if (attached) { const a = L.find((e) => e.id === attached); if (a) return a; }
  const W = words(msg), D = daysOf(msg, today);
  const scored = L.map((e) => ({ e, s: W.filter((w) => lc(e.title).includes(w)).length * 3 + (D && inDays(e, D) ? 2 : 0) + (e.date >= today ? 1 : 0) }));
  scored.sort((a, b) => b.s - a.s || String(a.e.date).localeCompare(String(b.e.date)));
  if (D && !inDays(scored[0].e, D) && !W.some((w) => lc(scored[0].e.title).includes(w))) return null;
  return scored[0].e;
}

const COZY = /dinner|supper|tea|board ?game|game night|games|book|craft|pottery|clay|coffee|caf[eé]|knit|potluck|cook|baking|bake|wine|matcha|puzzle|read|sketch|film|movie|vinyl|listening|ramen|dumpling/i;
function cozyScore(e) { let s = 0; if (+e.size > 0 && +e.size <= 12) s += 2; if (COZY.test(`${e.title} ${(e.tags || []).join(" ")} ${e.kind || ""}`)) s += 2; if (+e.going <= 8) s += 1; return s; }

const IDEAS = {
  winter: ["A soup swap: everyone brings a pot and leaves with jars", "Hot pot night with a slow playlist and a short menu card", "A braise and board games supper, done by 10pm", "Fondue and a small wine flight, six at the table"],
  default: ["A theme dinner with one dish per guest", "A slow tasting: three courses, one ingredient", "A cook-along where everyone makes the last course", "Swap the host: a guest picks next month's theme"],
};

const NAV = [[/\bsettings?|notifications?|notify|mute\b/i, "Settings", "/settings"], [/\b(my )?plans\b/i, "Plans", "/plans"], [/\bsaved\b/i, "Saved", "/saved"], [/\bchats?\b|messages\b/i, "Chats", "/chats"], [/\binbox\b/i, "Inbox", "/inbox"], [/\bdiscover|browse\b/i, "Discover", "/discover"], [/\bideas page\b/i, "Ideas", "/ideas"]];

/**
 * Answer a question from the context. Returns { answer, links: [{label, href}], action: {type, eventId, text?} | null,
 * intent, route?: "help", needsAi?: true }. mode "fake" also fills what a model would (ideas); "offline" says it can't.
 */
export function pottoReply(message, ctx = {}, { mode = "offline" } = {}) {
  const m = String(message || "").trim(), today = ctx.today || new Date().toISOString().slice(0, 10), host = !!ctx.me?.host, mine = ctx.myEvents || [], plans = ctx.plans || [];
  const out = (o) => ({ links: [], action: null, ...o });
  const noAi = "AI isn't set up on this server, so I can't write that for you.";
  if (!m) return out({ intent: "empty", answer: "Ask me about your events, your plans or what's on." });
  if (ctx.photo && mode !== "live") return out({ intent: "photo", needsAi: mode === "offline", answer: mode === "fake" ? "Thanks for the photo. In this demo I can't look at it, but a host would see it in the chat." : "Reading photos needs AI, which isn't set up on this server." });

  if (isSupport(m)) return out({ intent: "help", route: "help", answer: "That's one for the help guide. Here's what it says." });

  // a reminder for one of my events
  if (/\bremind(er)?s?\b/i.test(m) && host) {
    const e = pickEvent(mine.filter((x) => x.date >= today), m, today, ctx.attached);
    if (!e) return out({ intent: "remind", answer: "I couldn't find an upcoming event of yours for that day.", links: [{ label: "Your events", href: "/?app=1" }] });
    const text = `Hi all, a quick reminder: ${e.title} is ${[nice(e.date), clock(e.time)].filter(Boolean).join(" at ") || "coming up"}${e.where ? ` in ${e.where.split(",")[0]}` : ""}. Plans changed? Tap Can't go so someone else can have the spot. See you there.`;
    return out({ intent: "remind", answer: e.going ? `Here's a reminder for ${e.title}. It goes to the ${e.going} ${e.going === 1 ? "guest" : "guests"} in the group chat once you tap Send.${mode === "offline" ? " AI isn't set up here, so this is a plain template." : ""}` : `No one is in for ${e.title} yet, so there's no one to remind. Here's the text for later:\n\n"${text}"`, links: [{ label: e.title, href: e.link }], action: e.going ? { type: "remind", eventId: e.id, text } : null });
  }
  // who hasn't replied
  if (/\b(has ?n'?t|have ?n'?t|not yet|yet to|no(t)? (replied|responded|answered)|who'?s left|still need to)\b.*\b(repl|respond|answer|rsvp)|\bno repl/i.test(m) && host) {
    const e = pickEvent(mine.filter((x) => x.date >= today), m, today, ctx.attached);
    if (!e) return out({ intent: "noreply", answer: "You have no upcoming events right now.", links: [{ label: "New event", href: "/?app=1&new=1#studio" }] });
    const N = e.noReply || [], may = e.maybeNames || [];
    const answer = N.length ? `${N.length === 1 ? "One person hasn't" : `${N.length} people haven't`} replied to ${e.title}: ${list(N.slice(0, 8))}${N.length > 8 ? ` and ${N.length - 8} more` : ""}.${may.length ? ` ${list(may.slice(0, 5))} said Maybe.` : ""}`
      : `Everyone you invited to ${e.title} has replied.${may.length ? ` ${list(may.slice(0, 5))} said Maybe.` : ""}${e.asked ? ` ${e.asked} asked to join and wait on you.` : ""}`;
    return out({ intent: "noreply", answer, links: [{ label: "Guest list", href: e.guestsLink }] });
  }
  // fill open spots
  if (/\b(fill|empty|open|spare|free)\b.*\b(seats?|spots?|places?|tables?)\b|\bmore (people|guests)\b|\bfill (it|up|my)\b/i.test(m) && host) {
    const e = pickEvent(mine.filter((x) => x.date >= today && x.open > 0), m, today, ctx.attached);
    if (!e) return out({ intent: "fill", answer: "Your upcoming events are full, or have no spot limit. Nice.", links: [{ label: "Your events", href: "/?app=1" }] });
    const reach = e.discoverable || e.audienceWho ? "Tell people it suits on Pottery Lab" : ctx.me?.followers ? `Tell your ${ctx.me.followers} followers` : "";
    return out({ intent: "fill", answer: `${e.title} has ${e.open} open ${e.open === 1 ? "spot" : "spots"} (${e.going} in of ${e.spots}). ${reach ? `I can ${lc(reach[0]) + reach.slice(1)}, once you say so.` : "Share the invite link with a few friends who'd fit."}${e.waitlist ? ` ${e.waitlist} on the waitlist move up on their own.` : ""}`,
      links: [{ label: "Share invite", href: e.shareLink || e.link }], action: reach ? { type: e.discoverable || e.audienceWho ? "broadcast" : "announce", eventId: e.id } : null });
  }
  // ideas
  if (/\bideas?\b|\bbrainstorm|\bsuggest|\btheme(s)?\b|\bwhat should i host\b/i.test(m)) {
    // trends (server/trends.js): what people here loved first, each with its source, so nothing general reads as measured
    const T = (ctx.ideas || []).filter((x) => x && x.title && x.label).slice(0, 4);
    if (T.length) return out({ intent: "ideas", answer: `A few to start from:\n${T.map((x) => `• ${x.title} (${x.label})`).join("\n")}\n\nPick one and I'll help you set it up.`, links: [{ label: "New event", href: "/?app=1&new=1#studio" }, { label: "More ideas", href: "/ideas" }] });
    if (mode === "offline") return out({ intent: "ideas", needsAi: true, answer: `${noAi} The Ideas page has plenty to start from.`, links: [{ label: "Ideas", href: "/ideas" }] });
    const I = /winter|cold|snow|cozy|december|january/i.test(m) ? IDEAS.winter : IDEAS.default;
    return out({ intent: "ideas", answer: `A few to start from:\n${I.map((x) => `• ${x}`).join("\n")}\n\nPick one and I'll help you set it up.`, links: [{ label: "New event", href: "/?app=1&new=1#studio" }, { label: "More ideas", href: "/ideas" }] });
  }
  // a general draft (an invite blurb, a thank-you)
  if (/\b(draft|write|compose)\b/i.test(m)) {
    if (mode === "offline") return out({ intent: "draft", needsAi: true, answer: noAi, links: host ? [{ label: "Your events", href: "/?app=1" }] : [] });
    const e = host ? pickEvent(mine, m, today, ctx.attached) : null;
    return out({ intent: "draft", answer: e ? `Here's a start for ${e.title}:\n\n"Thanks for coming to ${e.title}. It was a good one. Same time next month?"` : "Here's a start:\n\n\"Thanks for coming. It was a good one. Same time next month?\"", links: e ? [{ label: e.title, href: e.link }] : [] });
  }
  // who's going
  if (/\bwho('?s| is| are| else)?\b.*\b(going|coming|in|attending)\b|\bguest list\b/i.test(m)) {
    const pool = [...mine.filter((x) => x.date >= today).map((x) => ({ ...x, mine: true })), ...plans.filter((x) => x.date >= today)];
    const e = pickEvent(pool, m, today, ctx.attached);
    if (!e) return out({ intent: "going", answer: plans.length || mine.length ? "I couldn't tell which event you mean. Try its name." : "You're not in for anything coming up yet.", links: [{ label: "Plans", href: "/plans" }] });
    if (e.mine) { const N = e.goingNames || []; return out({ intent: "going", answer: N.length ? `${e.going} in for ${e.title}: ${list(N.slice(0, 10))}${N.length > 10 ? ` and ${N.length - 10} more` : ""}.` : `No one is in for ${e.title} yet.`, links: [{ label: "Guest list", href: e.guestsLink }] }); }
    if (!e.names) return out({ intent: "going", answer: `${e.going ? `${e.going} ${e.going === 1 ? "person is" : "people are"} in for ${e.title}.` : `No one is in for ${e.title} yet.`} You'll see names once you're in.`, links: [{ label: e.title, href: e.link }] });
    return out({ intent: "going", answer: e.names.length ? `In for ${e.title} (${whenOf(e)}): ${list(e.names.slice(0, 10))}${e.names.length > 10 ? ` and ${e.names.length - 10} more` : ""}, and you.` : `Just you so far for ${e.title}. Others may keep their name private.`, links: [{ label: e.title, href: e.link }] });
  }
  // what's on
  const D = daysOf(m, today);
  if (D || /\b(what'?s on|anything|events?|something|cozy|small|quiet|near|happening|to do|go to)\b/i.test(m)) {
    const W = words(m), wantCozy = /cozy|small|quiet|calm|chill|intimate/i.test(m);
    let L = (ctx.public || []).filter((e) => e.date >= today && inDays(e, D || { from: today, to: addDays(today, 21) })), later = false;
    if (!L.length && D) { L = (ctx.public || []).filter((e) => e.date > D.to); later = !!L.length; } // nothing then: what's next
    const kw = W.filter((w) => !/cozy|small|quiet|calm|chill|intimate|near/.test(w));
    if (kw.length) { const hit = L.filter((e) => kw.some((w) => lc(`${e.title} ${(e.tags || []).join(" ")} ${e.kind || ""} ${e.where || ""}`).includes(w))); if (hit.length) L = hit; }
    L = L.map((e) => ({ e, s: (wantCozy ? cozyScore(e) * 2 : 0) + (ctx.me?.city && lc(e.where).includes(lc(ctx.me.city)) ? 1 : 0) })).sort((a, b) => b.s - a.s || a.e.date.localeCompare(b.e.date)).map((x) => x.e);
    if (wantCozy) L = L.filter((e) => cozyScore(e) >= 2).concat(L.filter((e) => cozyScore(e) < 2)).slice(0, 3); else L = L.slice(0, 3);
    if (!L.length) return out({ intent: "search", answer: `Nothing ${D ? "then" : "coming up"} that fits. Discover has everything that's open.`, links: [{ label: "Discover", href: "/discover" }] });
    const lines = L.map((e) => `• ${e.title}, ${whenOf(e)}${e.where ? `, ${e.where}` : ""}${+e.size ? ` (${e.size} spots)` : ""}`);
    return out({ intent: "search", answer: later ? `Nothing then, but these are next:\n${lines.join("\n")}` : `${wantCozy ? (L.length === 1 ? "One small, cozy one" : "A few small, cozy ones") : "Here's what's on"}${D ? (D.from === D.to ? ` on ${nice(D.from)}` : " then") : ""}:\n${lines.join("\n")}`, links: L.map((e) => ({ label: e.title, href: e.link })) });
  }
  for (const [re, label, href] of NAV) if (re.test(m)) return out({ intent: "nav", answer: `${label} is here.`, links: [{ label, href }] });
  // a title or tag that matches something public
  const W = words(m), hit = (ctx.public || []).filter((e) => W.some((w) => lc(`${e.title} ${(e.tags || []).join(" ")}`).includes(w))).slice(0, 3);
  if (hit.length) return out({ intent: "search", answer: `These match:\n${hit.map((e) => `• ${e.title}, ${whenOf(e)}`).join("\n")}`, links: hit.map((e) => ({ label: e.title, href: e.link })) });
  if (mode === "offline") return out({ intent: "other", needsAi: true, answer: `${host ? "I can find what's on, tell you who's in or who hasn't replied, and draft a plain reminder." : "I can find what's on and tell you who's going to your plans."} Open questions need AI, which isn't set up on this server.`, links: [{ label: "Discover", href: "/discover" }] });
  return out({ intent: "other", answer: host ? "I can draft reminders, tell you who hasn't replied and help fill open spots. What's next on your list?" : "I can find something to go to and tell you who's going. What are you in the mood for?" });
}
