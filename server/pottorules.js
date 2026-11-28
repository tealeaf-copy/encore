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

  const upcoming = mine.filter((x) => x.date >= today), drafts = ctx.drafts || [], past = mine.filter((x) => x.date < today).sort((a, b) => b.date.localeCompare(a.date));
  const NEW = { label: "New event", href: "/?app=1&new=1#studio" }, titled = (L) => L.find((e) => e.id === ctx.attached) || L.find((e) => words(e.title).some((w) => words(m).includes(w)));
  // ---- a guest asking about a plan: the facts on the invite, never more ----
  const plan = titled(plans) || (plans.length === 1 && !upcoming.length && !drafts.length ? plans[0] : null);
  if (plan && !titled(upcoming)) { const P = { label: plan.title, href: plan.link }, chat = plan.chatLink ? [{ label: "Group chat", href: plan.chatLink }] : [], by = plan.host || "the host";
    if (/\bcan'?t (make|go|come)\b|\bcancel\b|\bchange my (reply|rsvp)\b|\bnot coming\b/i.test(m)) return out({ intent: "plan", answer: `Open your invite for ${plan.title} and tap Can't go, so someone else can have the spot. ${by} sees it right away.`, links: [P] });
    if (/\bcalendar\b/i.test(m)) return out({ intent: "plan", answer: `Add to calendar is on your invite for ${plan.title} (${whenOf(plan)}).`, links: [P, { label: "Plans", href: "/plans" }] });
    if (/\bbring\b|\bwear\b|\bdress\b|\bparking\b/i.test(m) && !/\bfriend|\bplus[- ]?one|\bpartner\b/i.test(m)) return out({ intent: "plan", answer: `Anything ${by} asked for is on the invite. If it isn't there, ask in the group chat.`, links: [P, ...chat] });
    if (/\b(friend|plus[- ]?one|partner)\b/i.test(m) && /\bbring|\badd|\bcan i\b/i.test(m)) return out({ intent: "plan", answer: `That's up to ${by}. Ask in the group chat.`, links: [...chat, P] });
    if (/\b(message|ask|tell|text|write to|contact)\b.*\bhost\b|\bgroup chat\b/i.test(m)) return out({ intent: "plan", answer: chat.length ? `The group chat for ${plan.title} reaches ${by} and everyone who's in.` : `Reply on the invite first, then the group chat opens.`, links: [...chat, P] });
    if (/\bwhere\b|\bwhat time\b|\bwhen\b|\bstart|\baddress\b/i.test(m) && !/\bwhat'?s on\b/i.test(m)) return out({ intent: "plan", answer: `${plan.title} is ${whenOf(plan) || "coming up"}${plan.where ? `, in ${plan.where}` : ""}. The exact spot is on your invite.`, links: [P] });
  }
  if (host) {
    const mineAll = [...drafts, ...upcoming], ev = titled(mineAll) || (mineAll.length === 1 ? mineAll[0] : null), open = (e) => (e ? [{ label: e.title, href: e.link }] : [NEW]);
    // what's missing before sharing
    if (/\bmissing\b|\bready to (share|send|go)\b|\bcheck my (invite|event|draft)\b|\bbefore (i )?(shar|send)|\bstill need\b|\bwhat should i add\b|\bwhat('?s| is| do i do| comes)? ?next\b|\bis (it|my \w+) ready\b/i.test(m)) {
      const e = ev || drafts[0] || upcoming.find((x) => !x.shared || x.missing?.length) || upcoming[0];
      if (!e) return out({ intent: "missing", answer: "You haven't started an event yet. Start one: pick what it is and I set up the time, the spots and a cover. Then it needs a date and a place.", links: [NEW, { label: "Ideas", href: "/ideas" }] });
      const M = e.missing || [], share = e.shared ? "" : " It isn't shared yet: open it, tap Save and you get the link to send.";
      return out({ intent: "missing", answer: M.length ? `${e.title} still needs ${list(M)}.${e.shared ? " Guests can already open it, so add that soon." : " Open it and tap the part to fill it in."}` : `${e.title} has a date, a place and a description.${e.shared ? " It's shared. Nothing is missing." : share}`, links: open(e) });
    }
    // no date yet: friends can vote
    if (/\b(which|what|best|good) (day|date)\b|\b(date|day|time) (that )?works?\b|\bpoll\b|\bvote\b|\bfind a time\b|\bdon'?t know (what|which|the|a) (date|day)\b|\bwithout a date\b|\bpick between\b|\bsometime in\b|\bno date\b/i.test(m))
      return out({ intent: "date", answer: `You don't have to pick alone. ${ev ? `Open ${ev.title}, tap the date` : "In a new event, tap the date"} and choose Ask friends first. Add up to three dates, friends tap the ones that work, and you call it. Nothing is booked until you do.`, links: open(ev) });
    // no place yet: never a made-up venue
    if (/\bwhere (should|can|could|do) (i|we)\b(?! start)|\b(suggest|find|recommend|need|pick|add|book) (me )?(a |an |the )?(good |nice )?(place|venue|spot|restaurant|bar|caf[eé]|park|space|table)\b|\bplaces? near\b|\bno space\b|\bdon'?t have (a |the |any )?(space|place|room)\b|\bgood (bar|park|restaurant|place|spot|venue|caf[eé]) for\b|\bwhere do .* meet\b/i.test(m))
      return out({ intent: "place", answer: `I won't guess a venue from here. ${ev ? `Open ${ev.title}` : "Start the event"} and say what it is: places near you that fit show under the title, and a tap adds one. Hosting at home works too. Only guests who are in see the address.`, links: open(ev) });
    if (/\baddress\b/i.test(m)) return out({ intent: "place", answer: `Only guests who are in see the address, on the invite. ${ev ? `Change it on ${ev.title} and they're told it changed.` : "Change it on the event and they're told it changed."}`, links: ev ? open(ev) : [] });
    // what to bring
    if (/\bbring\b/i.test(m)) return out({ intent: "bring", answer: `Add What to bring to the invite, one thing per line. Guests see it before they reply.${ev ? ` It's a tap on ${ev.title}.` : ""}`, links: open(ev) });
    // the day before: the facts, and a reminder if anyone is in
    if (/\bprep\b|\bchecklist\b|\bget ready\b|\bday before\b/i.test(m)) { const e = pickEvent(upcoming, m, today, ctx.attached);
      if (e) return out({ intent: "prep", answer: `${e.title} is ${whenOf(e)}${e.where ? ` in ${e.where.split(",")[0]}` : ""}. ${e.going} in${e.maybe ? `, ${e.maybe} maybe` : ""}${(e.noReply || []).length ? `, ${e.noReply.length} yet to reply` : ""}.${e.missing?.length ? ` The invite still needs ${list(e.missing)}.` : ""} ${e.going ? "A short reminder the day before helps. Ask me to draft one." : "No one is in yet, so send the link again first."}`, links: [{ label: e.title, href: e.link }, { label: "Guest list", href: e.guestsLink }] }); }
    // quick lookups on one of my events
    if (/\bwho\b.*\bmaybe\b/i.test(m)) { const e = pickEvent(upcoming, m, today, ctx.attached); if (e) return out({ intent: "maybe", answer: (e.maybeNames || []).length ? `${list(e.maybeNames.slice(0, 8))} said Maybe to ${e.title}.` : `No one said Maybe to ${e.title}.`, links: [{ label: "Guest list", href: e.guestsLink }] }); }
    if (/\bhow many\b.*\b(spots?|seats?|places?)\b|\b(spots?|seats?) (are )?(left|open)\b/i.test(m)) { const e = pickEvent(upcoming, m, today, ctx.attached); if (e) return out({ intent: "spots", answer: e.spots ? `${e.title} has ${e.open} of ${e.spots} spots open. ${e.going} in.` : `${e.title} has no spot limit. ${e.going} in.`, links: [{ label: "Guest list", href: e.guestsLink }] }); }
    if (/\b(message|tell|text|write to)\b.*\b(everyone|guests|people who|all)\b/i.test(m) && !/\bmore people\b/i.test(m)) { const e = pickEvent(upcoming, m, today, ctx.attached); if (e) return out({ intent: "chat", answer: `The group chat for ${e.title} reaches everyone who's in (${e.going} so far). Or ask me to draft a reminder.`, links: [{ label: "Group chat", href: e.chatLink }] }); }
    // after: how it went
    if (past.length && /\bhow did\b|\bkudos\b|\brecap\b|\bphotos?\b|\bwho (came|went|would)\b|\b(come|go) again\b|\blast (week|night|time)\b/i.test(m) && !/\bthank/i.test(m)) { const e = titled(past) || past[0];
      return out({ intent: "after", answer: `${e.title} was ${nice(e.date)}. ${e.going} ${e.going === 1 ? "guest was" : "guests were"} in. Kudos, who'd come again and the photos are on its page, and guests can add theirs from the same link.`, links: [{ label: e.title, href: e.pageLink || e.link }] }); }
    if (/\bwhere do i start\b|\bi'?m new\b|\bget(ting)? started\b|\bfirst (event|time)\b/i.test(m) && !mineAll.length)
      return out({ intent: "start", answer: "Start with New event. Pick what it is and I set up the time, the spots and a cover. Then add a date, or let friends vote on one, and a place. Save gives you a link to send.", links: [NEW, { label: "Ideas", href: "/ideas" }] });
  }
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
  if (/\b(fill|empty|open|spare|free)\b.*\b(seats?|spots?|places?|tables?)\b|\bmore (people|guests)\b|\bfill (it|up|my)\b|\b(only|just) (one|two|three|a few|\d+) (person |people )?(repl|rsvp|said|is in|are in)|\b(few|no|not many) (replies|rsvps)\b|\b(nobody|no one) (has )?(repl|rsvp|said)/i.test(m) && host) {
    const e = pickEvent(mine.filter((x) => x.date >= today && x.open > 0), m, today, ctx.attached);
    if (!e) return out({ intent: "fill", answer: "Your upcoming events are full, or have no spot limit. Nice.", links: [{ label: "Your events", href: "/?app=1" }] });
    const reach = e.discoverable || e.audienceWho ? "Tell people it suits on Pottery Lab" : ctx.me?.followers ? `Tell your ${ctx.me.followers} followers` : "";
    return out({ intent: "fill", answer: `${e.title} has ${e.open} open ${e.open === 1 ? "spot" : "spots"} (${e.going} in of ${e.spots}). ${reach ? `I can ${lc(reach[0]) + reach.slice(1)}, once you say so.` : "Share the invite link with a few friends who'd fit."}${e.waitlist ? ` ${e.waitlist} on the waitlist move up on their own.` : ""}`,
      links: [{ label: "Share invite", href: e.shareLink || e.link }], action: reach ? { type: e.discoverable || e.audienceWho ? "broadcast" : "announce", eventId: e.id } : null });
  }
  // ideas
  if (/\bideas?\b|\bbrainstorm|\bsuggest|\btheme(s)?\b|\bwhat should i host\b|\bwhat\b.*\b(to )?host\b|\bno idea\b/i.test(m)) {
    // trends (server/trends.js): what people here loved first, each with its source, so nothing general reads as measured
    // only for "what should I host?"; a themed ask ("ideas for a winter supper club") keeps its own answer below
    const T = (ctx.ideas || []).filter((x) => x && x.title && x.label).slice(0, 4), themed = /\bfor (?:a|an|my|our|the) (?!party\b|get-?together\b|event\b|night\b|weekend\b)\w+|\btheme/i.test(m);
    if (T.length && !themed) return out({ intent: "ideas", answer: `A few to start from:\n${T.map((x) => `• ${x.title} (${x.label})`).join("\n")}\n\nPick one and I'll help you set it up.`, links: [{ label: "New event", href: "/?app=1&new=1#studio" }, { label: "More ideas", href: "/ideas" }] });
    if (mode === "offline") return out({ intent: "ideas", needsAi: true, answer: `${noAi} The Ideas page has plenty to start from.`, links: [{ label: "Ideas", href: "/ideas" }] });
    const I = /winter|cold|snow|cozy|december|january/i.test(m) ? IDEAS.winter : IDEAS.default;
    return out({ intent: "ideas", answer: `A few to start from:\n${I.map((x) => `• ${x}`).join("\n")}\n\nPick one and I'll help you set it up.`, links: [{ label: "New event", href: "/?app=1&new=1#studio" }, { label: "More ideas", href: "/ideas" }] });
  }
  // a general draft (an invite blurb, a thank-you)
  const bare = [...mine, ...(ctx.drafts || [])].reduce((t, e) => t.split(lc(e.title)).join(" "), lc(m)); // without my events' own titles ("Draft supper" is a name)
  if (/\b(draft|write|compose)\b/i.test(bare)) {
    const e = host ? pickEvent(mine, m, today, ctx.attached) : null;
    if (!/\bthank/i.test(m) && /\b(description|blurb|invite|about)\b/i.test(m)) return out({ intent: "draft", needsAi: mode === "offline", answer: `${mode === "offline" ? noAi + " " : ""}Open the invite and tap the description: say what it is, who it's for and what to expect. Two or three plain lines do it.`, links: e ? [{ label: e.title, href: e.link }] : host ? [{ label: "Your events", href: "/?app=1" }] : [] });
    if (mode === "offline") return out({ intent: "draft", needsAi: true, answer: noAi, links: host ? [{ label: "Your events", href: "/?app=1" }] : [] });
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
  if (host && !mine.some((x) => x.date >= today)) return out({ intent: "other", answer: "I can help you plan one: ideas, a date your friends vote on, what the invite still needs. Or I can find something to go to. What are you planning?", links: [{ label: "New event", href: "/?app=1&new=1#studio" }, { label: "Discover", href: "/discover" }] });
  return out({ intent: "other", answer: host ? "I can draft reminders, tell you who hasn't replied and help fill open spots. What's next on your list?" : "I can find something to go to and tell you who's going. What are you in the mood for?" });
}
