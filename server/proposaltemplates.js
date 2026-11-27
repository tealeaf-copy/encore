// Brand proposal templates (server/proposals.js): six starting points that fit the kinds of hosts brands book. Each is a
// ready structure the host edits: sample concepts, a run of show, what's included, how the brand shows up, three
// packages (Good, Better, Best) in the team-booking package model (a person, a table, an hour, a staffer a day, a
// package, with add-ons), a timeline from yes to the night and what's not included.
//
// "{brand}" in any string is replaced with the brand's name when a draft is made. The guide range is Pottery Lab's own
// starting guide for the kind of event, shown only when there aren't enough real hosts on the platform to work one out,
// and always labelled as a guide. The example hosts are in server/brandexamples.js (fictional, labelled "Example").

const $ = (d) => Math.round(d * 100);
const tier = (name, line, cents, o = {}) => ({ name, line, unit: o.unit || "person", cents: $(cents), perUnitGuests: o.per || 0, minUnits: o.minUnits || 0, minimumCents: $(o.minimum || 0), includes: o.inc || [], addOns: (o.addOns || []).map(([n, c, per = "person", on = false]) => ({ name: n, cents: $(c), per, on })) });
const C = (name, line, experience, brand) => ({ name, line, experience, brand });
const R = (time, what) => ({ time, what });
const S = (when, what) => ({ when, what });

export const TEMPLATES = [
  { id: "dinner", label: "Dinner or private chef", line: "A table that makes people feel looked after.", examples: ["marlow-table", "supper-at-sixteenth"], match: /dinner|supper|chef|tasting|omakase|cook|table|brunch|meal/i,
    guide: { lo: $(70), hi: $(180), unit: "person" },
    concepts: [
      C("The long table", "A family-style supper where your team and guests pass plates hand to hand.", "Guests walk in to a set table and a welcome drink. Three courses come out on platters down the middle, so people serve each other and talk without trying.", "A short hello from your team before mains, {brand} on the table where it suits the meal, and your name small on the printed menu."),
      C("Chef's counter", "Five small courses cooked in front of the room, one short story a plate.", "Everyone sits close to the kitchen. Each course gets a sentence about where it came from, then the room goes back to talking.", "One course built around {brand}, introduced by the chef, never a pitch."),
      C("Market to table", "Guests pick herbs and toppings at a little market stand, then we cook with them.", "A small market stand at the door, a quick hello, then dinner made with what the table chose. It gets people moving and laughing early.", "A {brand} stand at the market with a sample to try, and a thank-you card in each take-home bag."),
    ],
    ros: [R("6:30", "Doors open, welcome drink"), R("7:00", "A hello from the host and the {brand} team"), R("7:15", "First course"), R("8:00", "Mains, family style"), R("8:45", "Dessert and a toast"), R("9:30", "Goodnight, with something small to take home")],
    includes: ["Menu planned with you two weeks out", "All ingredients, cooked on site", "Service and full clean-up", "Printed menus"],
    presence: { signage: "A small card at the door and your name on the menu", sampling: "{brand} served as part of a course or the welcome drink, where it fits", photos: "Photos in the first hour only. Guests who'd rather not be in photos get a sticker and are left out" },
    tiers: [tier("Good", "Three-course supper", 95, { minimum: 1200, inc: ["Three courses", "Service and clean-up"] }), tier("Better", "Four courses and a welcome drink", 125, { minimum: 1500, inc: ["Four courses", "Welcome drink", "Printed menus"], addOns: [["Wine pairing", 45]] }), tier("Best", "Chef's tasting with pairings", 165, { minimum: 1800, inc: ["Five courses", "Wine pairing", "Menus with guests' first names"], addOns: [["Photographer for the first hour", 450, "flat"]] })],
    timeline: [S("When you accept", "The deposit holds the date"), S("3 weeks before", "Menu call and a rough guest count"), S("1 week before", "Final numbers and every dietary need"), S("The day", "We arrive two hours early to set up"), S("After", "Photos within three days")],
    notIncluded: ["The venue, unless we agree one together", "Alcohol not listed above", "Rentals for more than 30 guests"] },

  { id: "workshop", label: "Workshop: pottery, flowers, matcha", line: "Everyone leaves with something they made.", examples: ["little-kiln", "petal-and-stem", "still-water-matcha"], match: /pottery|clay|kiln|wheel|flower|floral|bouquet|matcha|tea|workshop|class|craft|make/i,
    guide: { lo: $(45), hi: $(120), unit: "person" },
    concepts: [
      C("Make it, take it home", "Everyone makes their own in about an hour and a half, no experience needed.", "A quick demo, then everyone makes their own at a shared table, with help close by. A break while things set, then a slow walk around to see what everyone made.", "Your colours in the materials, and a {brand} card with each piece people take home."),
      C("A table of flowers", "Each guest builds a small arrangement from one long shared table.", "Stems in buckets down the middle, a short show of how to start, then everyone builds their own and takes it home wrapped.", "A {brand} ribbon on the wraps, and a few stems in your colours if you'd like."),
      C("Matcha, slowly", "Whisk your own bowl and learn why it tastes the way it does.", "A calm hour: a short story about the tea, then everyone whisks, tastes and tries again. Something sweet on the side.", "{brand} as the snack or the take-home tin, introduced in a sentence."),
    ],
    ros: [R("0:00", "Arrive, aprons on, something to drink"), R("0:15", "A short demo"), R("0:30", "Making time, with help at every table"), R("1:15", "A break and a look around"), R("1:30", "Finish, wrap and pack"), R("1:45", "A thank-you and goodbyes")],
    includes: ["All materials and tools", "Aprons", "Step-by-step help", "Packing to take home"],
    presence: { signage: "A small sign by the door and on the welcome table", sampling: "{brand} as the snack or the drink, if it fits", photos: "A few photos of hands and finished pieces. Faces only for guests who are happy to be in them" },
    tiers: [tier("Good", "Make-and-take workshop", 55, { minimum: 600, inc: ["Materials", "Two hours with the host"] }), tier("Better", "Workshop with drinks and snacks", 75, { minimum: 800, inc: ["Materials", "Drinks and snacks", "Gift packing"], addOns: [["Firing and shipping each piece", 12]] }), tier("Best", "Private studio, drinks and a keepsake box", 110, { minimum: 1200, inc: ["The studio to yourselves", "Drinks and snacks", "Keepsake box"], addOns: [["Photographer", 350, "flat"]] })],
    timeline: [S("When you accept", "The deposit holds the date"), S("2 weeks before", "Guest count and any colours you want"), S("1 week before", "Final numbers and access needs"), S("The day", "Tables set an hour early"), S("After", "Fired pieces sent within three weeks, if that's part of it")],
    notIncluded: ["Travel outside the city", "Shipping outside the US"] },

  { id: "wellness", label: "Wellness: yoga, sound bath", line: "Slow mornings, quiet rooms, everyone a little kinder.", examples: ["low-tide-sound", "hum-and-hollow", "golden-hour-movement"], match: /yoga|sound|bath|breath|meditat|wellness|stretch|calm|pilates/i,
    guide: { lo: $(30), hi: $(90), unit: "person" },
    concepts: [
      C("Reset hour", "Forty minutes of easy movement, then twenty lying still.", "Mats down, shoes off, lights low. Nothing hard, nothing you have to be good at. People walk out quieter than they walked in.", "{brand} water or tea after, and a small card on each mat."),
      C("Sunrise flow", "An early, gentle class before the day starts.", "Coffee after, outside if the weather is kind. A good start to day two of an offsite.", "Breakfast or coffee from {brand}, and your name on the welcome sign."),
      C("Sound bath to close the summit", "Thirty minutes of sound after a long day of talks.", "Everyone lies down, bowls and gongs fill the room, and the day settles. No talking needed.", "A short thank-you from {brand} before we start, then nothing else. The quiet is the point."),
    ],
    ros: [R("0:00", "Arrive, settle, mats out"), R("0:10", "A welcome and how it works"), R("0:15", "Movement or sound"), R("0:50", "Rest"), R("1:00", "Tea and a slow goodbye")],
    includes: ["Mats, blankets and cushions", "The host and any instruments", "Setup and pack-down"],
    presence: { signage: "One sign at the door, nothing in the room", sampling: "{brand} drinks or snacks after the session", photos: "No photos during the session. A few after, only of people who say yes" },
    tiers: [tier("Good", "One-hour session", 35, { minimum: 400, inc: ["One hour", "Mats and blankets"] }), tier("Better", "Session with tea after", 55, { minimum: 600, inc: ["One hour", "Tea and something small", "Blankets and cushions"] }), tier("Best", "Session, tea and a take-home kit", 85, { minimum: 900, inc: ["Seventy-five minutes", "Tea", "Take-home kit"], addOns: [["Second practitioner for 30 or more", 250, "flat"]] })],
    timeline: [S("When you accept", "The deposit holds the date"), S("2 weeks before", "The room, and a guest count"), S("1 week before", "Final numbers and access needs"), S("The day", "We arrive 45 minutes early"), S("After", "A short note with how it went")],
    notIncluded: ["The room, unless we agree one together", "Travel outside the city"] },

  { id: "popup", label: "Coffee or bakery pop-up", line: "Good coffee, warm pastries, a line people enjoy.", examples: ["second-pull", "rise-and-crumb", "crumb-theory"], match: /coffee|espresso|cart|barista|latte|bake|bakery|pastr|bread|croissant|cookie|pop-?up/i,
    guide: { lo: $(150), hi: $(350), unit: "hour" },
    concepts: [
      C("The coffee cart", "An espresso cart at your door for the morning.", "Guests get a proper drink made to order while they find their feet. The line becomes the place people meet.", "Your name on the cups or the menu board, and a {brand} drink on the menu."),
      C("Pastry table", "A table of fresh pastries baked that morning.", "Laid out like a bakery counter, with labels for every diet. People come back for a second one and stay to talk.", "A {brand} flavour of the day, and your name on the table card."),
      C("Coffee and something sweet", "The cart and the pastry table together, for a bigger crowd.", "Two stations so nobody waits long. Good for the start of a launch, a summit morning or a team week.", "Branded cups and sleeves, and a short card on how the pairing was chosen for {brand}."),
    ],
    ros: [R("-1:00", "We arrive and set up"), R("0:00", "Service starts"), R("1:00", "The busy part: two of us on the cart"), R("2:00", "Last drinks"), R("2:30", "Packed and gone")],
    includes: ["Barista or baker on site", "Cups, lids, sleeves and napkins", "Oat and dairy milk", "Setup and clean-up"],
    presence: { signage: "Your name on the menu board and the cups", sampling: "A {brand} drink or pastry on the menu", photos: "Photos of the cart and drinks. Guests in photos only if they say yes" },
    tiers: [tier("Good", "Coffee cart, two hours", 220, { unit: "hour", minUnits: 2, inc: ["Espresso drinks", "One barista"] }), tier("Better", "Coffee and pastries, three hours", 260, { unit: "hour", minUnits: 3, inc: ["Espresso drinks", "Pastries", "Two on the cart for the busy hour"], addOns: [["Extra pastries", 6]] }), tier("Best", "Branded cups, four hours", 300, { unit: "hour", minUnits: 4, inc: ["Espresso drinks", "Pastries", "Your name on the cups"], addOns: [["Printed sleeves", 180, "flat"]] })],
    timeline: [S("When you accept", "The deposit holds the date"), S("2 weeks before", "Menu and any artwork for cups"), S("1 week before", "Final numbers, power and access"), S("The day", "We arrive an hour early"), S("After", "Photos of the cart within two days")],
    notIncluded: ["Power if the space has none (we can bring a quiet generator for a fee)", "Permits for public spaces"] },

  { id: "active", label: "Run or active", line: "Do something together, side by side.", examples: ["move-with-ava", "mission-mile", "golden-hour-movement"], match: /run|5k|10k|walk|hike|ride|bike|cycle|row|climb|move|active|fitness|bootcamp/i,
    guide: { lo: $(20), hi: $(70), unit: "person" },
    concepts: [
      C("Run club takeover", "A friendly 5k with a pace group for everyone, walkers included.", "We meet, warm up, split into easy pace groups and finish together. Nobody runs alone and nobody gets left behind.", "A {brand} water stop halfway and a short hello at the finish."),
      C("5k and coffee", "A short run, then coffee and breakfast at the finish line.", "The run is the excuse. The coffee after is where people actually talk.", "Breakfast from {brand}, or your name on the finish banner."),
      C("Golden hour walk", "An easy evening walk with three stops along the way.", "Gentle pace, good views, a stop for a drink and a stop for a photo. Anyone can come.", "A {brand} stop on the route, with something to try."),
    ],
    ros: [R("0:00", "Meet, sign in, bags dropped"), R("0:10", "Warm-up and pace groups"), R("0:20", "The run or walk"), R("1:00", "Finish, stretch, something to drink"), R("1:20", "Photos and goodbyes")],
    includes: ["Route planned and checked", "Pace leaders for every group", "Water at the start and finish", "A safety plan"],
    presence: { signage: "A banner at the start and finish", sampling: "{brand} at the water stop or the finish", photos: "Photos on the route and at the finish. Guests can ask to be left out" },
    tiers: [tier("Good", "Guided run or walk", 25, { minimum: 300, inc: ["Route and pace leaders", "Water"] }), tier("Better", "Run and breakfast after", 40, { minimum: 500, inc: ["Route and pace leaders", "Breakfast at the finish"], addOns: [["Run shirts", 22]] }), tier("Best", "Run, breakfast and a photographer", 65, { minimum: 800, inc: ["Route and pace leaders", "Breakfast", "Photographer"] })],
    timeline: [S("When you accept", "The deposit holds the date"), S("2 weeks before", "Route, start time and a guest count"), S("1 week before", "Final numbers and a weather plan"), S("The day", "We arrive 30 minutes early"), S("After", "Photos within two days")],
    notIncluded: ["Permits for closed roads", "Shirts unless listed"] },

  { id: "services", label: "Services: photo, staffing, catering", line: "Food, photos and staff for your own event.", examples: ["brightframe", "fieldnote", "floor-crew", "corner-plate"], match: /photo|booth|camera|staff|crew|cater|bartend|server|check-in|planner/i,
    guide: { lo: $(120), hi: $(320), unit: "hour" },
    concepts: [
      C("Photos people want to keep", "A photographer who works the room without getting in the way.", "Candid photos through the event and a short spot for portraits. An edited gallery the next week.", "Your backdrop or logo in the portrait spot, and every photo yours to use (see the photo rights below)."),
      C("The photo booth", "A booth with prints on the spot, and a gallery after.", "Guests take a print home in a frame with your name. The line becomes a little party of its own.", "{brand} on the print frame and the booth backdrop."),
      C("A crew that runs the room", "Check-in, coat check and floor staff so your team can talk to guests.", "Friendly staff at every door and table, briefed on your guests and your run of show.", "Your team does the talking; we do the rest, in plain black or {brand} colours."),
    ],
    ros: [R("-1:00", "Arrive, set up and brief the crew"), R("0:00", "Doors"), R("0:30", "The main part of your event"), R("2:00", "Last call"), R("2:30", "Pack down")],
    includes: ["Insured professionals", "Setup and pack-down", "A lead who is your one contact"],
    presence: { signage: "Your backdrop or logo where it makes sense", sampling: "", photos: "Guests are told photos are being taken and can ask to be left out" },
    tiers: [tier("Good", "Two hours", 175, { unit: "hour", minUnits: 2, inc: ["One professional", "Edited highlights"] }), tier("Better", "Three hours and a full gallery", 195, { unit: "hour", minUnits: 3, inc: ["One professional", "Full edited gallery"] }), tier("Best", "Four hours, with the booth", 240, { unit: "hour", minUnits: 4, inc: ["Photographer and booth", "Prints on the spot", "Full gallery"], addOns: [["Extra prints", 300, "flat"]] })],
    timeline: [S("When you accept", "The deposit holds the date"), S("2 weeks before", "Shot list or staffing plan"), S("1 week before", "Run of show and arrival times"), S("The day", "We arrive an hour early"), S("After", "Gallery or a wrap note within a week")],
    notIncluded: ["Travel outside the city", "Overtime past the booked hours, at the hourly rate"] },
];

export const TEMPLATE_IDS = TEMPLATES.map((t) => t.id);
export const templateOf = (id) => TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];
/** Which template fits a piece of text best (a package name and story, a host's tagline): the first that matches. */
export const guessTemplate = (text = "") => (TEMPLATES.find((t) => t.match.test(String(text))) || TEMPLATES[0]).id;
/** Swap "{brand}" for the brand's name, or for "your team" when there's none yet. */
export const withBrand = (s, brand) => String(s ?? "").replace(/\{brand\}/g, brand || "your team");

// Potto's tips, one a step, in first person. For the proof step there are two: one with numbers, one for a new host.
export const TIPS = {
  start: "Tell me who it's for and I'll fill in what I already know about you.",
  cover: "I put their name up top so it reads like it was made for them. Because it was.",
  about: "I drafted this from your page. Keep it to a few lines and make it sound like you.",
  proof: "Brands love a number. Here's yours, straight from Pottery Lab.",
  proofNew: "No numbers here yet? That's fine. Tell them what you've done off the app and I'll mark it as from you.",
  idea: "Give them two or three to choose from. A name and one line is plenty to start.",
  plan: "Walk them through it hour by hour. It answers half their questions before they ask.",
  pricing: "Three options make it easy to say yes. Put the one you'd love to run in the middle.",
  terms: "Plain words beat fine print. Your cancellation terms come from your team setup.",
  send: "One clear next step. I'd make it Accept and pay the deposit.",
};
