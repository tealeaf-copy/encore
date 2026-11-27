// Example hosts for brands: made-up hosts that show a brand how booking works before real hosts in their city have
// joined. They live only here, in memory, never as workspaces, so they can never show up in host leaderboards, public
// Discover counts, the admin numbers or any other metric (all of those walk real workspaces).
//
// Where they show: the brand side only (/teams/discover, Quick book, experience pages, shortlists, compare, the demo).
// Every card and page carries an "Example" tag and a quiet line saying so. They can't be booked: a request to an
// example host is refused with code "example" and the brand is offered "Ask us to find a real host for this"
// (server/brandbook.js). The one exception is the sandboxed demo brand (/teams/demo, server/branddemo.js), whose
// requests stay in the demo.
//
// Hide them everywhere with ENCORE_HIDE_DEMO=1 (docs/launch.md).
//
// Names, people, companies, reviews and numbers here are fictional. None of them imitates a real business or person.
// Several started as the prepared storefront presets in public/presets/ that were never in showcase.json.

const DAY = 864e5;
const isoDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
export const EXAMPLE_PREFIX = "x_";
export const isExampleWs = (ws) => typeof ws === "string" && ws.startsWith(EXAMPLE_PREFIX);
export const examplesHidden = () => process.env.ENCORE_HIDE_DEMO === "1";
export const EXAMPLE_LINE = "This is an example host so you can see how booking works. Real hosts in your city will show here as they join.";

// diets and access, short
const VEG = ["vegetarian", "vegan", "gluten-free", "dairy-free", "nut-free"];
const ALLD = ["vegetarian", "vegan", "gluten-free", "dairy-free", "nut-free", "halal", "kosher"];
const A_FULL = ["step-free", "accessible restroom", "seating for everyone", "quiet space"];
const A_SOME = ["step-free", "seating for everyone"];
const WEEK = [1, 2, 3, 4, 5], ALLWK = [0, 1, 2, 3, 4, 5, 6], WKND = [0, 5, 6];

// a package, with sensible defaults
function P(id, name, story, o) {
  return { id, name, story, moods: o.moods || [], goals: o.goals || [], perPersonCents: Math.round(o.pp * 100), minimumCents: Math.round((o.minimum || 0) * 100), minGuests: o.min, maxGuests: o.max,
    leadDays: o.lead ?? 14, length: o.len || "", includes: o.inc || [], diets: o.diets || [], access: o.access || [], remote: !!o.remote, instant: false, weekdays: o.wd || WEEK, time: o.time || "evening",
    closed: [], taxBps: 0, depositPct: o.dep || 25, photos: [], venue: o.venue || "host", art: o.art || "", on: true,
    ...(o.unit || o.svc ? { kind: "service", unit: o.unit || "person", perUnitGuests: o.per || 0, minUnits: o.minUnits || 1 } : {}),
    addOns: o.addOns || [], details: o.details || [] };
}
// catering, per person: office breakfast, team lunch drop-off and a catered company event (with staff)
const CATER_NOTE = "Every dish is labelled: vegetarian, vegan, gluten-free, halal, kosher-style and nut-free. Allergen sheet sent with the menu; our kitchen handles nuts, sesame and shellfish, so we can't promise trace-free.";
function catering(pre, f, { breakfast = true, lunch = true, event = true, art = "brunch", who = "we" } = {}) { const L = [];
  if (breakfast) L.push(P(pre + "bfst", "Office breakfast", "Pastries, fruit, yogurt and coffee, set up before your team arrives and cleared after. Good for day one of a summit or an all-hands.", { pp: Math.round(18 * f), min: 10, max: 300, minimum: Math.round(250 * f), moods: ["bonding", "services"], goals: ["catering", "summit", "offsite", "team"], len: "Delivered 30 minutes before, cleared after", inc: ["Pastries and fruit", "Coffee, tea and oat milk", "Setup and cleanup", "Plates and napkins"], diets: ALLD, svc: true, venue: "brand", art: "brunch", time: "daytime", wd: ALLWK, lead: 2, dep: 25,
    addOns: [{ name: "Staff to serve", price: "$45 an hour each" }, { name: "Rentals: real cups and plates", price: "$4 a person" }], details: ["Lead time 48 hours.", "Delivery window: 30 minutes, set before your start time.", CATER_NOTE] }));
  if (lunch) L.push(P(pre + "lnch", "Team lunch drop-off", "Boxed lunches or family-style trays, dropped off in a 30-minute window, labelled for every diet.", { pp: Math.round(26 * f), min: 10, max: 300, minimum: Math.round(300 * f), moods: ["bonding", "services"], goals: ["catering", "team", "offsite", "summit"], len: "Drop-off, 30-minute window", inc: ["Boxed or family-style", "Labels for every diet", "Compostable everything"], diets: ALLD, svc: true, venue: "brand", art: "taco", time: "daytime", wd: ALLWK, lead: 2, dep: 25,
    addOns: [{ name: "Setup and cleanup", price: "$120" }, { name: "Staff to serve", price: "$45 an hour each" }], details: ["Lead time 48 hours.", CATER_NOTE] }));
  if (event) L.push(P(pre + "evnt", "Catered company event or holiday party", "Passed bites, two stations and a dessert table for 30 to 300, with staff. For the holiday party, a launch or the summit reception.", { pp: Math.round(68 * f), min: 30, max: 300, minimum: Math.round(2400 * f), moods: ["celebrate", "services"], goals: ["catering", "celebration", "summit", "community"], len: "3 hours of service", inc: ["Passed bites and two stations", "Dessert table", "Servers (1 for every 20 guests)", "Setup and cleanup"], diets: ALLD, svc: true, venue: "brand", art: "party", time: "any", wd: ALLWK, lead: 14, dep: 50,
    addOns: [{ name: "Bartenders", price: "$55 an hour each" }, { name: "Rentals: linens, glassware", price: "From $6 a person" }], details: ["Lead time 2 weeks.", CATER_NOTE] }));
  return L; }

// a review a brand left (example), and a guest's kudos (example)
const R = (rating, text, company, role, pkg, headcount, monthsAgo) => ({ rating, text, company, role, pkgIdx: pkg, headcount, monthsAgo });
const K = (text, name, event) => ({ text, name, event });

// ---------------------------------------------------------------------------------------------------------------
// New York and San Francisco: every kind of host brands ask for
const HOSTS = [
  // ---- New York ----
  { handle: "marlow-table", name: "Marlow Table", person: "Ines", city: "New York", area: "Chelsea", art: "chef", accent: "#9A4128", policy: "standard", since: 2019,
    tagline: "A private chef for executive and customer dinners, cooked where you are.",
    story: "I'm Ines. I cook four to six courses on site: your office, a private dining room I book for you, or an executive's home. We talk through the menu two weeks out, every dietary need is cooked for, not worked around, and my two servers run the room so you can talk to your guests.",
    packages: [
      P("mtasting", "Executive tasting menu, cooked on site", "Five courses for 8 to 16, cooked in front of your guests and served at one table. Menu consultation two weeks before, a printed menu with your guests' names, and every course explained in a sentence, not a speech.", { pp: 165, min: 8, max: 16, minimum: 1800, moods: ["client", "celebrate"], goals: ["customer", "celebration"], len: "3 hours", inc: ["Menu consultation call", "Five courses", "Two servers", "Setup and full clean-up"], diets: ALLD, access: A_SOME, venue: "venue", art: "dinner", dep: 50, lead: 14,
        addOns: [{ name: "Wine pairing", price: "$65 a person" }, { name: "Third server for 14 or more", price: "$45 an hour" }, { name: "Private dining room, booked by Ines", price: "From $900" }],
        details: ["Cooks at your office, a private room or an exec's home with a working oven and four burners.", "Allergies and religious diets cooked for from scratch.", "Minimum spend $1,800 before tax."] }),
      P("mfamily", "Family-style dinner for 12 to 30", "Big platters down long tables, passed hand to hand. It gets people talking faster than plated courses. Three courses and dessert, cooked on site.", { pp: 120, min: 12, max: 30, minimum: 2000, moods: ["client", "celebrate", "bonding"], goals: ["customer", "celebration", "team", "community"], len: "2.5 hours", inc: ["Three courses and dessert", "Servers (1 for every 10 guests)", "Rentals: plates, glasses, linens"], diets: ALLD, access: A_SOME, venue: "venue", art: "dinner", dep: 50,
        addOns: [{ name: "Wine pairing", price: "$55 a person" }, { name: "Centrepieces from a florist", price: "See Petal & Stem" }], details: ["Needs a room with tables for everyone and a kitchen or a space for two induction burners."] }),
      P("mclass", "Cook-together dinner class", "Your team cooks dinner with Ines in three small groups, then sits down to eat it. A friendly race on the starter, no pressure on the rest.", { pp: 110, min: 8, max: 24, moods: ["handson", "bonding"], goals: ["workshop", "team", "customer"], len: "3 hours", inc: ["All ingredients", "Aprons and recipe cards", "Dinner you made"], diets: VEG, access: A_SOME, venue: "venue", art: "cook" }),
    ],
    history: { events: 8, responseHours: 3 },
    reviews: [R(5, "Ines cooked for our twelve top accounts and every allergy was handled without anyone noticing. Two deals moved the week after.", "Larkspur Labs", "Field marketing lead", 0, 12, 2), R(5, "The family-style dinner did what our usual steakhouse never does: people actually moved seats.", "Tidepool Analytics", "Head of events", 1, 24, 4), R(4, "Lovely food. Book the third server if you're over 14.", "Juniper Pay", "Marketing manager", 0, 16, 5)],
    kudos: [K("The best work dinner I've been to. The menu had my name on it.", "Dana", "Executive tasting menu"), K("I came for the food and stayed for the people.", "Raj", "Family-style dinner")] },

  { handle: "koji-counter", name: "Kōji Counter", person: "Ren", city: "New York", area: "SoHo", art: "chef", accent: "#2F4F4F", policy: "firm", since: 2020,
    tagline: "Twelve seats at an omakase counter for the people you most want to talk to.",
    story: "I'm Ren. Twelve seats, one counter, nine small courses. Brands book the whole counter for executive roundtables: one question per course, and the room is small enough that everyone hears the answer.",
    packages: [
      P("komakase", "Omakase roundtable for 12", "Nine courses at the counter, a host question with each one, and a quiet room after for the conversations that start. The whole counter is yours.", { pp: 240, min: 8, max: 12, minimum: 2400, moods: ["client"], goals: ["customer"], len: "2.5 hours", inc: ["Nine courses", "A roundtable question per course", "Sake or tea pairing"], diets: ["gluten-free", "dairy-free"], access: ["step-free", "seating for everyone"], art: "dumpling", dep: 50, lead: 21,
        details: ["Fish forward. Vegetarian on request with a week's notice.", "The counter seats 12. No standing room."] }),
    ],
    history: { events: 6, responseHours: 9 },
    reviews: [R(5, "Our CMO roundtable finally felt like a conversation. Twelve seats is exactly right.", "Quillon", "Executive programs", 0, 12, 3), R(5, "Ren's questions per course were smarter than ours.", "Brightwell Health", "Customer marketing", 0, 10, 6)],
    kudos: [K("Nine courses and I remember every one.", "Mei", "Omakase roundtable")] },

  { handle: "still-water-matcha", name: "Still Water Matcha", person: "Aiko", city: "New York", area: "Greenpoint", art: "glasses", accent: "#5F7F3A", policy: "flexible", since: 2021,
    tagline: "Matcha workshops and a matcha bar for your event. Calm hands, good tea.",
    story: "I'm Aiko. I teach people to whisk matcha properly: the water, the wrist, the foam. It's slow and quiet and people love it, which makes it a good start to a customer dinner or a gentle middle to an offsite.",
    packages: [
      P("swwhisk", "Matcha workshop: whisk, taste, take home a bowl", "Everyone gets a bowl and a bamboo whisk, tastes three grades of matcha side by side, and learns to whisk a proper bowl. Bowls go home with them.", { pp: 68, min: 8, max: 30, moods: ["handson", "calm", "client"], goals: ["workshop", "team", "customer", "offsite", "wellness"], len: "75 minutes", inc: ["A matcha bowl and whisk each", "Three grades to taste", "Wagashi sweets"], diets: VEG, access: A_FULL, venue: "brand", art: "tea", time: "any",
        details: ["Travels to your office or venue anywhere in New York. Needs tables and a sink nearby.", "No caffeine? Hojicha on request."] }),
      P("swmbar", "Matcha bar at your event", "Two of us behind a bar, whisking to order for 30 to 200 guests: usucha, matcha lattes, iced hojicha. A calm corner at a busy event.", { pp: 16, min: 20, max: 200, minimum: 900, moods: ["celebrate", "calm"], goals: ["conference", "celebration", "community"], len: "3 hours of service", inc: ["Two matcha baristas", "Oat and dairy milk", "Cups, lids, compostable everything"], diets: VEG, access: A_SOME, venue: "brand", art: "tea", time: "any",
        details: ["Needs a 6 ft table and one standard outlet.", "Your logo on the cups for $1 a cup, 10 days' notice."] }),
      P("swmkit", "Matcha kits in the mail, whisk together on a call", "A kit at each person's door, then 45 minutes together on a video call. Works for teams spread across cities.", { pp: 54, min: 8, max: 80, moods: ["remote", "calm", "handson"], goals: ["team", "workshop"], len: "45 minutes", inc: ["A kit shipped to each person", "A live session with Aiko"], diets: VEG, remote: true, art: "tea", time: "any", lead: 21 }),
    ],
    history: { events: 7, responseHours: 4 },
    reviews: [R(5, "We opened our customer dinner with Aiko's workshop. Quietest, best icebreaker we've had.", "Fernlight", "Field marketing", 0, 18, 1), R(5, "The matcha bar was the line everyone wanted to be in at our launch.", "Orbitly", "Brand events", 1, 120, 3)],
    kudos: [K("I finally get matcha. And I kept the bowl.", "Ana", "Matcha workshop")] },

  { handle: "second-pull", name: "Second Pull Coffee Cart", person: "Marco", city: "New York", area: "Bushwick", art: "barista", accent: "#6B4A2E", policy: "flexible", since: 2018,
    tagline: "An espresso cart at your office, booth or launch. Latte art, cupping, real coffee.",
    story: "I'm Marco. We roll a two-group espresso cart into your office, conference booth or launch and pull shots to order. People queue, talk and come back. We also teach latte art and run cuppings for smaller groups.",
    packages: [
      P("spcart", "Espresso cart pop-up", "Two baristas, a two-group machine and a menu of five drinks, made to order for 30 to 300 guests. Your logo in latte art on request.", { pp: 12, min: 20, max: 300, minimum: 1100, moods: ["celebrate", "bonding", "client"], goals: ["conference", "community", "celebration", "team"], len: "3 hours of service", inc: ["Two baristas", "Espresso, drip and decaf", "Oat and dairy milk", "Cups and setup"], diets: VEG, access: A_SOME, venue: "brand", art: "coffee", time: "any", wd: ALLWK, lead: 10,
        details: ["Needs a 6 by 8 ft spot and two 20-amp outlets on separate circuits.", "Conference booth? We bring a quiet grinder and a drip tray, no sink needed."] }),
      ...catering("sp", 1.0, { lunch: false, event: false }),
      P("spcupping", "Coffee cupping for your team", "Six coffees from three continents, tasted side by side the way roasters do it. Slurping encouraged.", { pp: 48, min: 8, max: 24, moods: ["handson", "client", "bonding"], goals: ["workshop", "customer", "team"], len: "75 minutes", inc: ["Six coffees", "Tasting notes card", "A bag of your favourite to take home"], diets: VEG, access: A_FULL, venue: "brand", art: "coffee", time: "daytime" }),
      P("splatte", "Latte art class", "Everyone steams milk and pours a heart, then a tulip. Somebody always nails a swan.", { pp: 58, min: 8, max: 20, moods: ["handson", "bonding"], goals: ["workshop", "team"], len: "90 minutes", inc: ["Machines and milk", "A coach for every 5 people"], diets: VEG, access: A_SOME, art: "coffee", time: "daytime" }),
    ],
    history: { events: 9, responseHours: 3 },
    reviews: [R(5, "Our booth had a line all three days. Best lead magnet we've had, and it's coffee.", "Tidepool Analytics", "Events manager", 0, 250, 2), R(5, "The cupping got our sales team asking each other real questions.", "Cobalt & Co", "Enablement", 1, 16, 4), R(4, "Great cart. Check the outlets with your venue first, ours were on one circuit.", "Juniper Pay", "Brand marketing", 0, 120, 7)],
    kudos: [K("A flat white with our logo on it. I took a photo before drinking it.", "Leo", "Espresso cart pop-up")] },

  { handle: "rise-and-crumb", name: "Rise & Crumb Bakehouse", person: "Hannah", city: "New York", area: "Carroll Gardens", art: "baker", accent: "#B5763A", policy: "standard", since: 2017,
    tagline: "Bakery nights and sourdough workshops in a neighbourhood bakehouse.",
    story: "I'm Hannah. After the shop closes, the bakehouse is yours: warm ovens, flour on the counter, bread coming out every twenty minutes. Small groups, long tables, and everyone leaves with a loaf.",
    packages: [
      P("rcnight", "Bakery night", "The shop after hours for 8 to 20: shape a loaf, watch the ovens, then a long supper of bread, cheese, soup and pastries. A warm, easy evening for customers or a team.", { pp: 95, min: 8, max: 20, moods: ["client", "bonding", "celebrate"], goals: ["customer", "team", "celebration"], len: "2.5 hours", inc: ["Shaping and baking", "Supper with bread, soup and cheese", "A loaf to take home"], diets: ["vegetarian", "nut-free"], access: A_SOME, art: "bake", dep: 25 }),
      ...catering("rc", 1.05, { lunch: false, event: false }),
      P("rcsour", "Sourdough workshop", "Starter, mix, fold, shape. You bake a loaf here and take home a jar of our 9-year-old starter and a schedule that actually works.", { pp: 85, min: 6, max: 16, moods: ["handson", "calm"], goals: ["workshop", "team", "offsite"], len: "3 hours", inc: ["Your own loaf, baked here", "A jar of starter", "A banneton to take home"], diets: ["vegetarian"], access: A_SOME, art: "bake", time: "any", wd: [1, 2, 3, 4, 6] }),
    ],
    history: { events: 9, responseHours: 7 },
    reviews: [R(5, "A bakery at night is a very good room for a customer dinner. Warm, smells incredible, nobody checks their phone.", "Brightwell Health", "Regional marketing", 0, 16, 2), R(5, "Our team still sends each other photos of their sourdough.", "Larkspur Labs", "People team", 1, 12, 5)],
    kudos: [K("I've made that loaf four times since.", "Sam", "Sourdough workshop")] },

  { handle: "petal-and-stem", name: "Petal & Stem Studio", person: "June", city: "New York", area: "Fort Greene", art: "florist", accent: "#C25A7C", policy: "standard", since: 2016,
    tagline: "Bouquet workshops, and flowers for your dinners, launches and summits.",
    story: "I'm June. I do two things: I teach teams to build a seasonal bouquet, and I dress brand events with flowers, from bud vases on a dinner table to the entry installation at a summit. Same florist, same flower market at 5am.",
    packages: [
      P("pswork", "Seasonal bouquet workshop", "I walk everyone through colour, texture and wrapping with the week's best stems. Everyone leaves with a bouquet they made.", { pp: 72, min: 8, max: 40, moods: ["handson", "calm", "client"], goals: ["workshop", "team", "customer", "offsite", "celebration"], len: "90 minutes", inc: ["Seasonal stems", "Tools, wrap and ribbon", "A care card"], diets: [], access: A_FULL, venue: "brand", art: "garden", time: "any" }),
      P("pscentre", "Table centrepieces for a dinner", "Low, seasonal centrepieces you can talk over, and bud vases down the table. Priced per table of 8, delivered, set and cleared.", { pp: 140, min: 8, max: 200, moods: ["client", "celebrate", "services"], goals: ["customer", "celebration", "summit"], len: "Delivered before, cleared after", inc: ["One low centrepiece and three bud vases a table", "Delivery, setup and breakdown"], unit: "table", per: 8, minUnits: 2, venue: "venue", art: "garden", time: "any", wd: ALLWK, lead: 10, dep: 50,
        details: ["Minimum order 2 tables ($280).", "Needs 10 to 14 days' notice; seasonal stems, so exact flowers are confirmed a week out.", "We bring water and take everything away, vases included."] }),
      P("psentry", "Welcome installation or booth florals", "A flower installation for the entry, a stage or a conference booth. Sketch first, then built on site the morning of your event.", { pp: 2400, min: 30, max: 2000, moods: ["celebrate", "services"], goals: ["summit", "celebration", "conference"], len: "Built the morning of", inc: ["A sketch and a call", "Build on site", "Breakdown and removal"], unit: "package", venue: "venue", art: "garden", time: "any", wd: ALLWK, lead: 14, dep: 50,
        details: ["Booth florals fit a 10 by 10 or 10 by 20 booth.", "Needs 14 days' notice and access 3 hours before doors."] }),
    ],
    history: { events: 9, responseHours: 6 },
    reviews: [R(5, "June's centrepieces were low enough to talk over, which our last florist never managed.", "Quillon", "Events lead", 1, 24, 2), R(5, "The bouquet workshop was the first team event nobody complained about.", "Orbitly", "People ops", 0, 22, 4)],
    kudos: [K("My bouquet lasted two weeks on my desk.", "Kai", "Seasonal bouquet workshop")] },

  { handle: "move-with-ava", name: "Move with Ava", person: "Ava", city: "New York", area: "Flatiron", art: "runner", accent: "#3E7FA6", policy: "flexible", since: 2018,
    tagline: "Yoga for teams at your office, a rooftop, or the offsite. All levels, mats provided.",
    story: "I'm Ava. I teach yoga people can do in work clothes if they need to. All levels, every pose has an easier version, and I bring the mats. Brands book me for offsite mornings, sunrise sessions during conference week and after-work classes.",
    packages: [
      P("avflow", "Morning yoga flow for your team", "A 60-minute all-levels flow to start an offsite or a team day. Breath, gentle strength, a long rest at the end.", { pp: 32, min: 8, max: 60, minimum: 400, moods: ["calm", "bonding"], goals: ["wellness", "offsite", "team"], len: "60 minutes", inc: ["Mats, blocks and straps for everyone", "A music speaker", "Travel to your venue in New York"], access: A_FULL, venue: "brand", art: "yoga", time: "daytime", wd: ALLWK, lead: 7,
        details: ["Needs about 25 sq ft a person: a meeting room with the tables pushed back works.", "All levels. Chair versions of every pose for anyone who'd rather not get on the floor.", "Travel anywhere in the five boroughs included; Hudson Valley offsites $120."] }),
      P("avsunrise", "Sunrise rooftop pop-up", "A 45-minute sunrise session on a rooftop for 15 to 80 during conference week, then coffee. Back in time for the keynote.", { pp: 40, min: 15, max: 80, moods: ["calm", "celebrate"], goals: ["conference", "wellness", "community"], len: "45 minutes", inc: ["Mats for everyone", "A rooftop we book", "Coffee after"], access: ["seating for everyone"], venue: "venue", art: "yoga", time: "daytime", wd: ALLWK, lead: 14 }),
      P("avafter", "After-work session at your venue", "Six o'clock, lights down, 50 minutes of slow flow and stretching. A good way to end a long planning day.", { pp: 30, min: 8, max: 60, minimum: 360, moods: ["calm"], goals: ["wellness", "offsite", "team"], len: "50 minutes", inc: ["Mats and props", "Travel to your venue"], access: A_FULL, venue: "brand", art: "yoga", wd: WEEK, lead: 7 }),
    ],
    history: { events: 9, responseHours: 2 },
    reviews: [R(5, "Ava had 30 people who'd never done yoga laughing in the first five minutes.", "Larkspur Labs", "Offsite planner", 0, 30, 2), R(5, "The sunrise session was the most photographed thing at our conference week.", "Fernlight", "Field marketing", 1, 45, 3)],
    kudos: [K("I didn't know I could touch my toes in a blazer.", "Priya", "Morning yoga flow")] },

  { handle: "low-tide-sound", name: "Low Tide Sound", person: "Remy", city: "New York", area: "Williamsburg", art: "beard", accent: "#4D5D8C", policy: "flexible", since: 2019,
    tagline: "Sound baths for teams: lie down, breathe out, hear nothing but the bowls.",
    story: "I'm Remy. A sound bath is 45 minutes lying down while I play crystal bowls, gongs and chimes. No experience, no talking, nothing to get right. Brands use it to close an offsite day or to start a wellness morning.",
    packages: [
      P("ltbath", "Sound bath for 10 to 40", "A short breathing start, then 45 minutes of bowls and gong. People lie on mats or sit in chairs; both work.", { pp: 45, min: 10, max: 40, minimum: 500, moods: ["calm"], goals: ["wellness", "offsite", "team"], len: "60 minutes", inc: ["Mats, bolsters and eye pillows", "Crystal bowls and gong", "Travel to your venue in New York"], access: A_FULL, venue: "brand", art: "music", time: "any", wd: ALLWK, lead: 7,
        details: ["Needs a quiet room with the lights dimmed, about 25 sq ft a person.", "Chairs work for anyone who'd rather not lie down.", "Gong is loud: I'll check the room for anyone with sound sensitivity first."] }),
      P("ltmorning", "Wellness morning: yoga, then a sound bath", "Forty minutes of gentle yoga with a teacher I work with, then the sound bath. Two and a half hours, the slowest good morning of the quarter.", { pp: 78, min: 10, max: 60, minimum: 900, moods: ["calm", "bonding"], goals: ["wellness", "offsite", "team"], len: "2 hours", inc: ["A yoga teacher and Remy", "All mats and props", "Tea after"], access: A_FULL, venue: "brand", art: "yoga", time: "daytime", wd: ALLWK, lead: 10 }),
    ],
    history: { events: 6, responseHours: 6 },
    reviews: [R(5, "We ended a hard planning offsite with Remy. People walked out quiet and kind to each other.", "Cobalt & Co", "Chief of staff", 0, 22, 2), R(4, "The wellness morning was lovely. Bring socks, the floor is cold.", "Tidepool Analytics", "People team", 1, 18, 5)],
    kudos: [K("I fell asleep and I'm not even sorry.", "Jo", "Sound bath")] },

  { handle: "hudson-hollow", name: "Hudson Hollow Retreats", person: "Wes", city: "New York", area: "Hudson Valley", art: "hiker", accent: "#5C7A4A", policy: "firm", since: 2016,
    tagline: "Farm offsites two hours from the city: a barn to think in, a long lunch, a walk.",
    story: "I'm Wes. We run day offsites on a working farm in the Hudson Valley. A barn with a projector and real chairs, a farm lunch, an afternoon walk or a session in the orchard, and a coach back to the city.",
    packages: [
      P("hudday", "Farm offsite day", "Coach from Midtown at 8, a morning working session in the barn, farm lunch, an afternoon walk or orchard session, back by 6.", { pp: 240, min: 10, max: 60, minimum: 3600, moods: ["calm", "bonding"], goals: ["offsite", "team", "wellness"], len: "A full day", inc: ["Coach there and back", "Barn with screen and Wi-Fi", "Breakfast, lunch and snacks"], diets: ALLD, access: ["accessible restroom", "seating for everyone", "quiet space"], venue: "host", art: "hike", time: "daytime", wd: WEEK, lead: 21, dep: 50,
        details: ["Barn seats 60 theatre style, 40 in workshop groups.", "Some paths are gravel; the barn and lunch room are step-free."] }),
      P("hudtwo", "Two-day retreat with a night in the farmhouse", "Two days, one night: planning sessions, a long dinner, a bonfire, breakfast on the porch.", { pp: 690, min: 10, max: 24, minimum: 6900, moods: ["calm", "bonding", "celebrate"], goals: ["offsite", "team", "wellness"], len: "2 days", inc: ["Rooms in the farmhouse", "All meals", "Coach there and back"], diets: ALLD, access: ["accessible restroom", "quiet space"], art: "hike", time: "any", wd: [1, 2, 3, 4], lead: 30, dep: 50 }),
    ],
    history: { events: 8, responseHours: 10 },
    reviews: [R(5, "We got more planning done in the barn in a day than in a week at the office.", "Quillon", "VP marketing", 0, 28, 3), R(5, "The bonfire night is the thing our team talks about.", "Orbitly", "Head of people", 1, 18, 6)],
    kudos: [K("Coach, barn, lunch, walk. It just worked.", "Tom", "Farm offsite day")] },

  { handle: "brooklyn-bench", name: "Brooklyn Bench Studio", person: "Ola", city: "New York", area: "Williamsburg", art: "hiker", accent: "#8C5A3C", policy: "standard", since: 2017,
    tagline: "A woodshop-turned-event-space for meetups, launches and the holiday party.",
    story: "I'm Ola. By day we build furniture; by night the benches roll back and it's a warm room for 30 to 200: brick walls, a long bar, a screen and good sound. We run meetups, launches and holiday parties with food and drinks from neighbours we trust.",
    packages: [
      P("bbmeetup", "Meetup evening", "Doors, drinks, a short talk or demo on the big screen, then food and conversation. We run the door and the room, you run the content.", { pp: 38, min: 30, max: 150, minimum: 2200, moods: ["celebrate", "bonding", "client"], goals: ["community", "conference", "celebration"], len: "3 hours", inc: ["Room, screen and mics", "Food and two drinks a person", "Door and check-in staff"], diets: VEG, access: A_FULL, art: "talk", wd: WEEK, lead: 21 }),
      P("bblaunch", "Launch pop-up", "The whole space for a launch: a product table, a photo corner, a bar and a DJ until late.", { pp: 55, min: 50, max: 200, minimum: 4500, moods: ["celebrate"], goals: ["celebration", "community", "conference"], len: "4 hours", inc: ["Room for the day", "Bar and passed food", "A DJ", "Load-in from 10am"], diets: VEG, access: A_FULL, art: "party", wd: ALLWK, lead: 30, dep: 50 }),
      P("bbholiday", "Holiday party", "Long tables, a family-style dinner, a bar and a playlist your team picks. Gift swap table on the house.", { pp: 95, min: 30, max: 150, minimum: 3800, moods: ["celebrate", "bonding"], goals: ["celebration", "team", "community"], len: "4 hours", inc: ["Dinner and dessert", "Open bar, three hours", "Decorations"], diets: ALLD, access: A_FULL, art: "party", wd: ALLWK, lead: 30, dep: 50 }),
    ],
    history: { events: 9, responseHours: 8 },
    reviews: [R(5, "We've held four meetups here. The door staff alone are worth it.", "Cobalt & Co", "Community lead", 0, 90, 2), R(5, "Our launch felt like a party, not a press event.", "Orbitly", "Launch marketing", 1, 140, 4), R(5, "Best holiday party in years, and the team picked the playlist.", "Larkspur Labs", "Office manager", 2, 70, 11)],
    kudos: [K("Came for the talk, stayed till they turned the lights on.", "Ike", "Meetup evening")] },

  { handle: "bao-and-stitch", name: "Bao & Stitch", person: "Mina", city: "New York", area: "Greenpoint", art: "bob", accent: "#D07A5B", policy: "flexible", since: 2021,
    tagline: "Sew-your-own mini plush workshops. Everyone leaves with a tiny friend.",
    story: "I'm Mina. I teach a gentle, giggly sewing workshop: everyone makes a mini plush bao in two hours, no sewing experience needed. It travels to your office.",
    packages: [
      P("bsplush", "Sew-your-own mini plush", "Felt, thread, stuffing and a pattern that forgives. Two hours, a lot of laughing, and everyone leaves with a tiny bao.", { pp: 62, min: 6, max: 30, moods: ["handson", "bonding"], goals: ["workshop", "team", "customer"], len: "2 hours", inc: ["Kits for everyone", "Needles, thread, scissors", "A coach for every 8 people"], access: A_FULL, venue: "brand", art: "craft", time: "any" }),
    ],
    history: { events: 5, responseHours: 5 },
    reviews: [R(5, "Our engineers were fiercely competitive about their plush. Wonderful.", "Tidepool Analytics", "Engineering manager", 0, 14, 3)],
    kudos: [K("My bao sits on my monitor now.", "Lu", "Sew-your-own mini plush")] },

  { handle: "brightframe", name: "Brightframe Studio", person: "Theo", city: "New York", area: "DUMBO", art: "glasses", accent: "#333C4D", policy: "standard", since: 2015, alsoIn: ["San Francisco", "Boston", "Chicago", "London"],
    tagline: "Event photos and video for brands: coverage, headshots, recap films and social cuts.",
    story: "I'm Theo. I shoot photos and video (one person, a small team when you need it). Event coverage, a headshot station at your booth, a recap film and vertical cuts for social. Based in New York, with a second team in San Francisco; we travel for summits.",
    packages: [
      P("bfcover", "Event photo coverage", "Candid and posed coverage of your dinner, launch or summit, by the hour. Minimum 2 hours.", { pp: 350, min: 1, max: 2000, moods: ["services"], goals: ["summit", "customer", "celebration", "community", "conference", "offsite"], len: "2, 4 or 8 hours", inc: ["Edited gallery of 60+ photos an hour", "48-hour sneak peek of 20 photos", "Full gallery in 7 days"], unit: "hour", minUnits: 2, venue: "venue", art: "talk", time: "any", wd: ALLWK, lead: 10, dep: 50,
        addOns: [{ name: "Second shooter", price: "$200 an hour" }, { name: "Same-day edit of 30 photos", price: "$400" }],
        details: ["Usage: your brand may use every photo for marketing, forever, with credit optional. Guests who say no to photos get a sticker on their badge and are left out.", "Travel: free within the city; outside it, travel and a $250 day fee.", "Overtime $350 an hour, billed in half hours."] }),
      P("bfhead", "Headshot station at your summit or booth", "A lit headshot set at your booth or summit. About 20 people an hour, each picks their best two, retouched and delivered in 3 days.", { pp: 450, min: 20, max: 2000, moods: ["services", "client"], goals: ["summit", "conference"], len: "By the hour, minimum 3", inc: ["Lights, backdrop and a stylist's mirror", "Two retouched headshots a person", "Delivery by email in 3 days"], unit: "hour", minUnits: 3, venue: "venue", art: "talk", time: "daytime", wd: ALLWK, lead: 14, dep: 50,
        details: ["Needs a 10 by 10 ft spot and one outlet.", "Guests get their own photos; the brand gets them only if the guest says yes."] }),
      P("bfrecap", "Recap video and social cuts", "A 60 to 90 second recap film of your event, plus three vertical 15 to 30 second cuts for social. Optional speaker and session recording for summits.", { pp: 4800, min: 20, max: 2000, moods: ["services", "celebrate"], goals: ["summit", "celebration", "conference", "community"], len: "Up to 8 hours on site", inc: ["One videographer for up to 8 hours", "60 to 90 second recap film", "Three vertical cuts", "Video in 10 to 14 days"], unit: "package", venue: "venue", art: "movie", time: "any", wd: ALLWK, lead: 21, dep: 50,
        addOns: [{ name: "Session recording, one room", price: "$1,600 a day" }, { name: "Second camera operator", price: "$900 a day" }],
        details: ["Usage: marketing use forever, all channels. Music licensed for social.", "Two rounds of edits included."] }),
    ],
    history: { events: 9, responseHours: 4 },
    reviews: [R(5, "Sneak peek photos landed the next morning, right when our CEO wanted to post.", "Fernlight", "Brand lead", 0, 80, 2), R(5, "The recap film is now the opening of our sales deck.", "Quillon", "Events lead", 2, 300, 5)],
    kudos: [] },

  { handle: "floor-crew", name: "Floor Crew Event Staff", person: "Simone", city: "New York", area: "Midtown", art: "ponytail", accent: "#2E6B5E", policy: "standard", since: 2014, alsoIn: ["Boston", "Chicago", "London"],
    tagline: "A trained crew for your first flagship summit: registration, check-in, runners, speakers.",
    story: "I'm Simone. When a marketing team runs its first big summit, there are never enough hands. We send a crew who've done it before: a registration desk, badge printing, room runners, speaker wranglers and an on-site lead who answers to you.",
    packages: [
      P("fcstaff", "Event staff, per staffer per day", "Registration and check-in, badge printing, room runners, speaker wrangling. About one staffer for every 50 attendees; we'll suggest the right number.", { pp: 520, min: 50, max: 3000, moods: ["services"], goals: ["summit", "conference", "community"], len: "10-hour day", inc: ["Trained staff in your shirts or ours", "A shift plan and a briefing call", "Badge printers and scanners on request"], unit: "staff-day", per: 50, minUnits: 4, venue: "venue", art: "talk", time: "daytime", wd: ALLWK, lead: 14, dep: 50,
        details: ["Minimum 4 staff-days ($2,080).", "Staff count means people on our crew; attendees means your guests. We size the crew from your attendee count.", "Two-day summit? Each day is priced on its own."] }),
      P("fclead", "On-site coordinator for the day", "One senior lead who runs the floor for you: vendors, timings, the run of show, the moment something breaks.", { pp: 1400, min: 50, max: 3000, moods: ["services"], goals: ["summit", "conference"], len: "Up to 12 hours", inc: ["A run-of-show review call", "Radio kit for your team"], unit: "package", venue: "venue", art: "talk", time: "any", wd: ALLWK, lead: 14, dep: 50 }),
    ],
    history: { events: 8, responseHours: 5 },
    reviews: [R(5, "Our first summit, 400 people, and registration took nine minutes. Simone's crew made us look like we'd done it ten times.", "Larkspur Labs", "Head of field marketing", 0, 400, 3)],
    kudos: [] },

  { handle: "north-star-summits", name: "North Star Summits", person: "Priya", city: "New York", area: "Midtown", art: "glasses", accent: "#38407A", policy: "firm", since: 2013, alsoIn: ["Boston", "Chicago", "London"],
    tagline: "We plan your customer summit with you: venue, agenda, run of show, vendors and budget.",
    story: "I'm Priya. I've planned summits for 80 to 800 people. We start with what the summit is for, then scout venues, build the agenda and run of show, book vendors and keep the budget honest. You stay in charge of the content.",
    packages: [
      P("nsplan150", "Summit plan, up to 150 attendees", "Ten weeks of planning: venue scouting (three options), agenda and run of show, vendor booking, a budget sheet, and me on site on the day.", { pp: 18000, min: 40, max: 150, moods: ["services"], goals: ["summit"], len: "10 weeks of planning", inc: ["Venue scouting with three options", "Agenda and run of show", "Vendors booked and managed", "A live budget sheet", "On site on the day"], unit: "package", venue: "venue", art: "talk", time: "any", wd: ALLWK, lead: 70, dep: 25,
        details: ["Lead time: 10 weeks before the summit, more is better.", "Paid in three parts: 25% to start, 50% at venue signing, 25% a week after.", "Vendor costs are yours and passed through at cost, never marked up."] }),
      P("nsplan400", "Summit plan, 150 to 400 attendees", "Fourteen weeks for a bigger summit: everything in the smaller plan plus a speaker programme, a sponsor plan and a second planner on site.", { pp: 32000, min: 150, max: 400, moods: ["services"], goals: ["summit"], len: "14 weeks of planning", inc: ["Everything in the smaller plan", "Speaker programme", "Two planners on site"], unit: "package", venue: "venue", art: "talk", time: "any", wd: ALLWK, lead: 98, dep: 25,
        details: ["Lead time: 14 weeks.", "Vendor costs passed through at cost."] }),
    ],
    history: { events: 7, responseHours: 12 },
    reviews: [R(5, "Priya kept our first summit on budget, which our CFO still mentions.", "Brightwell Health", "VP marketing", 0, 140, 6)],
    kudos: [] },

  { handle: "corner-plate", name: "Corner Plate Catering", person: "Dev", city: "New York", area: "Long Island City", art: "chef", accent: "#A65A2A", policy: "standard", since: 2014,
    tagline: "Office breakfasts, team lunches and catered company events, labelled for every diet.",
    story: "I'm Dev. We feed offices: breakfast before the all-hands, lunch for a planning day, and the holiday party with passed bites and stations. Every dish labelled, every delivery on time.",
    packages: catering("cp", 1.1),
    history: { events: 9, responseHours: 3 },
    reviews: [R(5, "Breakfast for 200 on summit day one, set up before doors, labelled perfectly.", "Brightwell Health", "Events lead", 0, 200, 2), R(5, "Our holiday party food was gone in an hour, in a good way.", "Cobalt & Co", "Office manager", 2, 120, 11)],
    kudos: [K("The halal options were actually the best thing there.", "Zaid", "Catered company event")] },

  // ---- San Francisco ----
  { handle: "supper-at-sixteenth", name: "Supper at Sixteenth", person: "Luis", city: "San Francisco", area: "Mission", art: "chef", accent: "#A0442C", policy: "standard", since: 2018,
    tagline: "A private dining room in the Mission for customer dinners of 12 to 30.",
    story: "I'm Luis. Our private room seats 30 at one long table or four rounds. Brands book it for customer dinners and exec breakfasts: a set menu, a short welcome if you want one, and staff who know when to disappear.",
    packages: [
      P("sscust", "Customer dinner in a private room", "Four courses, a welcome drink, and the room to yourselves. Seating plan done with you so the right people sit together.", { pp: 185, min: 12, max: 30, minimum: 2800, moods: ["client", "celebrate"], goals: ["customer", "celebration"], len: "3 hours", inc: ["Four courses", "Welcome drink", "Printed menus", "A seating plan with you"], diets: ALLD, access: A_FULL, art: "dinner", dep: 50 }),
      P("ssbreak", "Exec roundtable breakfast", "Breakfast for 8 to 16 at 7:30, a question on the table, done by 9.", { pp: 85, min: 8, max: 16, minimum: 900, moods: ["client"], goals: ["customer"], len: "90 minutes", inc: ["Hot breakfast", "Coffee and juice", "A screen if you need one"], diets: ALLD, access: A_FULL, art: "brunch", time: "daytime" }),
    ],
    history: { events: 9, responseHours: 6 },
    reviews: [R(5, "The seating plan session with Luis was the most useful 20 minutes of our planning.", "Orbitly", "Field marketing", 0, 24, 2), R(5, "Breakfast at 7:30, done by 9, three follow-up meetings booked.", "Quillon", "Sales", 1, 12, 4)],
    kudos: [K("The mole. I think about the mole.", "Rosa", "Customer dinner")] },

  { handle: "ember-and-fig", name: "Ember & Fig", person: "Rafa", city: "San Francisco", area: "Hayes Valley", art: "chef", accent: "#8E3B2F", policy: "standard", since: 2017,
    tagline: "A private chef for executive dinners: in your office, a private room, or an exec's home.",
    story: "I'm Rafa. I cook seasonal California food on site for 8 to 30. We meet about the menu two weeks out; every allergy and diet is planned for. Service staff are included up to 16 guests and an add-on above that.",
    packages: [
      P("eftasting", "Executive tasting menu, 4 to 6 courses", "Four, five or six courses (you pick), for 8 to 16, cooked where you are and served by my team.", { pp: 175, min: 8, max: 16, minimum: 1900, moods: ["client", "celebrate"], goals: ["customer", "celebration"], len: "3 hours", inc: ["Menu consultation", "Up to six courses", "Two servers", "Setup and clean-up"], diets: ALLD, access: A_SOME, venue: "venue", art: "dinner", dep: 50,
        addOns: [{ name: "Wine pairing", price: "$70 a person" }, { name: "Private dining room, booked by Rafa", price: "From $1,000" }], details: ["Minimum spend $1,900.", "Cooks in any kitchen with an oven; can bring induction burners."] }),
      P("effamily", "Family-style dinner for 12 to 30", "Shared platters, long tables, seasonal and generous.", { pp: 125, min: 12, max: 30, minimum: 2100, moods: ["client", "celebrate", "bonding"], goals: ["customer", "celebration", "team", "community"], len: "2.5 hours", inc: ["Three courses and dessert", "Rentals"], diets: ALLD, access: A_SOME, venue: "venue", art: "dinner", dep: 50, addOns: [{ name: "Service staff over 16 guests", price: "$48 an hour each" }, { name: "Wine pairing", price: "$55 a person" }] }),
      ...catering("ef", 1.15, { breakfast: false }),
      P("efclass", "Cook-together dinner class", "Cook in teams, eat together. A gentle competition on the salad course.", { pp: 115, min: 8, max: 24, moods: ["handson", "bonding"], goals: ["workshop", "team", "customer"], len: "3 hours", inc: ["Ingredients", "Aprons", "Dinner"], diets: VEG, access: A_SOME, venue: "venue", art: "cook" }),
    ],
    history: { events: 8, responseHours: 5 },
    reviews: [R(5, "Rafa cooked in our CEO's kitchen for 10 customers. It felt personal in a way a restaurant never does.", "Juniper Pay", "Executive events", 0, 10, 2), R(5, "Family style for 26 and nobody waited for anything.", "Cobalt & Co", "Customer marketing", 1, 26, 5)],
    kudos: [K("He came out and told us where the figs were from. Perfect.", "Nell", "Executive tasting menu")] },

  { handle: "fog-leaf-matcha", name: "Fog Leaf Matcha", person: "Kenji", city: "San Francisco", area: "Japantown", art: "glasses", accent: "#6A8A3E", policy: "flexible", since: 2020,
    tagline: "Matcha workshops and a matcha bar for conference week.",
    story: "I'm Kenji. Hands-on matcha: whisking, tasting, a little of the why. We also run a matcha bar at booths and launches for a calmer kind of queue.",
    packages: [
      P("flwhisk", "Matcha workshop", "Three grades side by side, then everyone whisks their own bowl. Bowls and whisks to take home.", { pp: 70, min: 8, max: 30, moods: ["handson", "calm", "client"], goals: ["workshop", "team", "customer", "offsite", "wellness"], len: "75 minutes", inc: ["Bowl and whisk each", "Three grades", "Sweets"], diets: VEG, access: A_FULL, venue: "brand", art: "tea", time: "any" }),
      P("flmbar", "Matcha bar at your booth or launch", "Two baristas whisking to order for 30 to 250.", { pp: 15, min: 20, max: 250, minimum: 900, moods: ["celebrate", "calm"], goals: ["conference", "celebration", "community"], len: "3 hours of service", inc: ["Two baristas", "Cups and milks"], diets: VEG, access: A_SOME, venue: "brand", art: "tea", time: "any", wd: ALLWK, details: ["Needs a 6 ft table and one outlet. No sink needed."] }),
    ],
    history: { events: 6, responseHours: 4 },
    reviews: [R(5, "The matcha bar at our booth was the calmest thing on the expo floor.", "Tidepool Analytics", "Events", 1, 200, 2)],
    kudos: [K("Whisking is weirdly relaxing.", "Ben", "Matcha workshop")] },

  { handle: "phin-and-night", name: "Phin & Night Catering", person: "Thao", city: "San Francisco", area: "Outer Sunset", art: "barista", accent: "#5A3B2A", policy: "flexible", since: 2019,
    tagline: "A Vietnamese coffee pop-up, office breakfasts, team lunches and catering for company events.",
    story: "I'm Thao. We bring a phin coffee bar to your booth, office or launch, slow-drip Vietnamese coffee over ice, and we feed long days like hackathons from 8am to midnight.",
    packages: [
      P("pncart", "Coffee pop-up at your booth or office", "A phin and espresso bar for 30 to 300: cà phê sữa đá, egg coffee, oat lattes. Your logo on the sleeves.", { pp: 11, min: 20, max: 300, minimum: 1000, moods: ["celebrate", "bonding", "client"], goals: ["conference", "community", "celebration", "team"], len: "3 hours of service", inc: ["Two baristas", "Coffee, tea and milks", "Branded sleeves", "Setup"], diets: VEG, access: A_SOME, venue: "brand", art: "coffee", time: "any", wd: ALLWK, lead: 10, details: ["Needs a 6 by 8 ft spot and one 20-amp outlet."] }),
      P("pntaste", "Vietnamese coffee tasting", "Four coffees, the phin explained, and everyone brews their own.", { pp: 45, min: 8, max: 24, moods: ["handson", "client"], goals: ["workshop", "customer", "team"], len: "75 minutes", inc: ["A phin to take home", "Four coffees"], diets: VEG, access: A_FULL, venue: "brand", art: "coffee", time: "daytime" }),
      ...catering("pn", 1.0),
      P("pnhack", "Hackathon catering, 8am to midnight", "Breakfast, lunch, dinner and a midnight snack for 80 to 300, labelled for every diet.", { pp: 32, min: 80, max: 300, minimum: 3200, moods: ["bonding"], goals: ["community", "team", "summit"], len: "Up to 16 hours", inc: ["Four meals", "Coffee all day", "Labels for every diet"], diets: ALLD, access: [], venue: "brand", art: "taco", time: "any", wd: ALLWK, lead: 21 }),
    ],
    history: { events: 9, responseHours: 3 },
    reviews: [R(5, "Egg coffee at our booth. People came back with their colleagues.", "Orbitly", "Field marketing", 0, 220, 2), R(5, "Fed 180 hackers for 16 hours, every diet labelled.", "Cobalt & Co", "Developer relations", 2, 180, 5)],
    kudos: [K("The cà phê sữa đá was dangerous at 9am.", "Vy", "Coffee pop-up")] },

  { handle: "crumb-theory", name: "Crumb Theory Bakery", person: "Odile", city: "San Francisco", area: "Bernal Heights", art: "baker", accent: "#B07A3F", policy: "standard", since: 2016,
    tagline: "Bakery nights and sourdough workshops in a small bakery up the hill.",
    story: "I'm Odile. Small groups, warm ovens, bread you shape yourself, and a long table after.",
    packages: [
      P("ctnight", "Bakery night", "After hours for 8 to 20: shape a loaf, eat a supper of bread and soup and pastry, take your loaf home.", { pp: 98, min: 8, max: 20, moods: ["client", "bonding", "celebrate"], goals: ["customer", "team", "celebration"], len: "2.5 hours", inc: ["Shaping and baking", "Supper", "A loaf to take home"], diets: ["vegetarian"], access: A_SOME, art: "bake" }),
      ...catering("ct", 1.0, { lunch: false, event: false }),
      P("ctsour", "Sourdough workshop", "Mix, fold, shape and bake, and a jar of starter to take home.", { pp: 88, min: 6, max: 16, moods: ["handson", "calm"], goals: ["workshop", "team", "offsite"], len: "3 hours", inc: ["Your loaf", "Starter", "A banneton"], diets: ["vegetarian"], access: A_SOME, art: "bake", time: "any", wd: [1, 2, 3, 4, 6] }),
    ],
    history: { events: 7, responseHours: 8 },
    reviews: [R(5, "Bakery night was the warmest customer dinner we've run.", "Juniper Pay", "Regional marketing", 0, 14, 3)],
    kudos: [K("I can't believe I made that loaf.", "Ada", "Sourdough workshop")] },

  { handle: "wild-fennel", name: "Wild Fennel Flowers", person: "Marisol", city: "San Francisco", area: "Dogpatch", art: "florist", accent: "#B4547A", policy: "standard", since: 2015,
    tagline: "Bouquet workshops, and flowers for brand dinners, launches and summits.",
    story: "I'm Marisol. Same florist for both: I teach bouquet workshops, and I do event flowers, from bud vases to stage florals, with what's in season at the flower mart.",
    packages: [
      P("wfwork", "Seasonal bouquet workshop", "Build a bouquet from the week's best stems, wrapped to take home.", { pp: 75, min: 8, max: 40, moods: ["handson", "calm", "client"], goals: ["workshop", "team", "customer", "offsite", "celebration"], len: "90 minutes", inc: ["Stems", "Tools and wrap"], access: A_FULL, venue: "brand", art: "garden", time: "any" }),
      P("wfcentre", "Table centrepieces and bud vases", "Low centrepieces and bud vases, priced per table of 8, delivered, set and cleared.", { pp: 150, min: 8, max: 300, moods: ["client", "celebrate", "services"], goals: ["customer", "celebration", "summit"], len: "Delivered before, cleared after", inc: ["Centrepiece and bud vases a table", "Delivery, setup, breakdown"], unit: "table", per: 8, minUnits: 2, venue: "venue", art: "garden", time: "any", wd: ALLWK, lead: 10, dep: 50, details: ["Minimum 2 tables.", "7 to 14 days' notice; stems confirmed a week out."] }),
      P("wfstage", "Stage or booth florals", "Stage, entry or booth florals, sketched first and built the morning of.", { pp: 2600, min: 30, max: 3000, moods: ["celebrate", "services"], goals: ["summit", "conference", "celebration"], len: "Built the morning of", inc: ["Sketch", "Build", "Breakdown"], unit: "package", venue: "venue", art: "garden", time: "any", wd: ALLWK, lead: 14, dep: 50 }),
    ],
    history: { events: 8, responseHours: 6 },
    reviews: [R(5, "Marisol's booth florals made our 10 by 10 look like a garden.", "Quillon", "Events", 2, 500, 2), R(5, "The workshop was the calm hour our offsite needed.", "Larkspur Labs", "People", 0, 20, 5)],
    kudos: [K("Took my bouquet on the train home and people asked about it.", "Ellie", "Seasonal bouquet workshop")] },

  { handle: "golden-hour-movement", name: "Golden Hour Movement", person: "Nia", city: "San Francisco", area: "SoMa", art: "runner", accent: "#D58A3A", policy: "flexible", since: 2019,
    tagline: "Yoga for teams: morning flows at your offsite, after-work sessions at your venue.",
    story: "I'm Nia. All-levels yoga that meets people where they are. I bring mats and props, I travel to your venue anywhere in the Bay Area, and every class has a chair option.",
    packages: [
      P("ghflow", "Morning yoga flow, 60 minutes", "An all-levels flow to open an offsite day. Mats provided.", { pp: 30, min: 8, max: 60, minimum: 380, moods: ["calm", "bonding"], goals: ["wellness", "offsite", "team"], len: "60 minutes", inc: ["Mats and props", "Travel in the Bay Area"], access: A_FULL, venue: "brand", art: "yoga", time: "daytime", wd: ALLWK, lead: 7, details: ["About 25 sq ft a person.", "All levels, chair options for every pose.", "Marin and Peninsula offsites: $90 travel."] }),
      P("ghafter", "After-work session at your venue", "Fifty minutes of slow flow and stretching after a long day.", { pp: 28, min: 8, max: 60, minimum: 340, moods: ["calm"], goals: ["wellness", "offsite", "team"], len: "50 minutes", inc: ["Mats and props"], access: A_FULL, venue: "brand", art: "yoga", wd: WEEK, lead: 7 }),
      P("ghweek", "Wellness week: four classes", "Four sessions in one week at your office: yoga, mobility, breathwork and Pilates.", { pp: 100, min: 10, max: 60, moods: ["calm", "bonding"], goals: ["wellness", "team"], len: "Four 45-minute classes", inc: ["Four classes", "Mats"], access: A_FULL, venue: "brand", art: "yoga", time: "daytime", lead: 14 }),
    ],
    history: { events: 9, responseHours: 3 },
    reviews: [R(5, "Nia's morning flow set the tone for the whole offsite.", "Fernlight", "People team", 0, 25, 2)],
    kudos: [K("Best 60 minutes of the offsite, and I don't do yoga.", "Gus", "Morning yoga flow")] },

  { handle: "hum-and-hollow", name: "Hum & Hollow Sound", person: "Sage", city: "San Francisco", area: "Hayes Valley", art: "locs", accent: "#5A5A8C", policy: "flexible", since: 2020,
    tagline: "Sound baths and wellness mornings for teams.",
    story: "I'm Sage. Forty-five minutes lying down while bowls and gongs do the work. Mats, bolsters and eye pillows provided; I travel to your venue.",
    packages: [
      P("hhbath", "Sound bath for 10 to 40", "Breathing, then 45 minutes of crystal bowls and gong.", { pp: 46, min: 10, max: 40, minimum: 520, moods: ["calm"], goals: ["wellness", "offsite", "team"], len: "60 minutes", inc: ["Mats, bolsters, eye pillows", "Travel in the Bay Area"], access: A_FULL, venue: "brand", art: "music", time: "any", wd: ALLWK, lead: 7, details: ["A quiet room, lights down, 25 sq ft a person.", "Chairs welcome."] }),
      P("hhmorning", "Wellness morning: yoga, then a sound bath", "Gentle yoga, then the sound bath, then tea.", { pp: 80, min: 10, max: 60, minimum: 950, moods: ["calm", "bonding"], goals: ["wellness", "offsite", "team"], len: "2 hours", inc: ["Yoga teacher and Sage", "Props", "Tea"], access: A_FULL, venue: "brand", art: "yoga", time: "daytime", wd: ALLWK, lead: 10 }),
    ],
    history: { events: 6, responseHours: 5 },
    reviews: [R(5, "Our sales team asked for this at every offsite since.", "Orbitly", "Sales ops", 0, 24, 3)],
    kudos: [K("I didn't know my shoulders could drop that far.", "Mo", "Sound bath")] },

  { handle: "mission-mile", name: "Mission Mile Run Club", person: "Dani", city: "San Francisco", area: "Mission", art: "runner", accent: "#E26D8E", policy: "flexible", since: 2018,
    tagline: "Conference-morning social runs for 20 to 150, with coffee after and shirts in your colors.",
    story: "I'm Dani. An easy 5K with two pace groups and a walking group, then coffee. Conference weeks are our busiest: a morning run is the side event people actually remember.",
    packages: [
      P("mmsocial", "Conference-morning social run", "An easy 5K from Moscone, two paces and a walking group, coffee and pastries after. Back by 8:30 for the keynote.", { pp: 45, min: 20, max: 150, moods: ["bonding", "celebrate"], goals: ["conference", "community", "wellness", "team"], len: "1 hour", inc: ["Pacers and a route plan", "Coffee and pastries", "Bag drop"], access: ["seating for everyone"], venue: "venue", art: "run", time: "daytime", wd: ALLWK, lead: 14, details: ["Walking group for anyone who'd rather not run.", "Rain moves us to a covered route.", "Shirts in your colors $25 each, 2 weeks' notice."] }),
    ],
    history: { events: 9, responseHours: 4 },
    reviews: [R(5, "120 people at 7am during conference week. Wild. The walking group was a lovely touch.", "Tidepool Analytics", "Developer marketing", 0, 120, 2)],
    kudos: [K("I met our biggest customer at the coffee after.", "Ivy", "Conference-morning run")] },

  { handle: "loft-on-folsom", name: "The Loft on Folsom", person: "Grace", city: "San Francisco", area: "SoMa", art: "glasses", accent: "#4A5A7A", policy: "standard", since: 2016,
    tagline: "A SoMa loft for demo nights, launches and breakfast roundtables.",
    story: "I'm Grace. A bright loft with a stage, a screen and a kitchen, three blocks from Moscone. We run the room; you run the content.",
    packages: [
      P("lfdemo", "Demo night and reception", "A short programme on stage, then food and drinks.", { pp: 95, min: 30, max: 150, minimum: 3500, moods: ["celebrate", "client", "bonding"], goals: ["community", "conference", "celebration"], len: "3 hours", inc: ["Stage, screen, mics", "Food and drinks", "Door staff"], diets: VEG, access: A_FULL, art: "talk", wd: WEEK, lead: 21 }),
      P("lflaunch", "Launch pop-up", "The loft for a product launch or holiday party, 50 to 200.", { pp: 70, min: 50, max: 200, minimum: 5000, moods: ["celebrate"], goals: ["celebration", "community", "conference", "team"], len: "4 hours", inc: ["The loft for the day", "Bar and passed food", "A DJ"], diets: VEG, access: A_FULL, art: "party", wd: ALLWK, lead: 30, dep: 50 }),
      P("lfbreak", "Breakfast roundtable room", "Breakfast for 8 to 16 in the quiet room.", { pp: 60, min: 8, max: 16, minimum: 600, moods: ["client"], goals: ["customer", "offsite"], len: "90 minutes", inc: ["Breakfast", "Coffee", "Screen"], diets: ALLD, access: A_FULL, art: "brunch", time: "daytime" }),
    ],
    history: { events: 9, responseHours: 6 },
    reviews: [R(5, "Three blocks from the conference and nobody else had booked it. Perfect for our launch.", "Orbitly", "Launch marketing", 1, 160, 3)],
    kudos: [K("Good sound, good food, short talks.", "Raf", "Demo night")] },

  { handle: "little-kiln", name: "Noor's Little Kiln", person: "Noor", city: "San Francisco", area: "Bernal Heights", art: "curls", accent: "#B5603C", policy: "flexible", since: 2019,
    tagline: "Pottery for teams: paint your own mug, or a first go on the wheel.",
    story: "I'm Noor. A small, sunny studio. Everyone makes something, and I fire it and ship it to your office two weeks later.",
    packages: [
      P("lkmugs", "Paint-your-own mug, for your team", "Glazes, brushes and a mug each; I fire them and ship them to your office.", { pp: 55, min: 8, max: 30, moods: ["handson", "bonding", "client"], goals: ["workshop", "team", "customer", "offsite"], len: "2 hours", inc: ["A mug each", "Glazes and firing", "Shipping to your office"], access: A_FULL, art: "pottery", time: "any" }),
      P("lkwheel", "First time on the wheel", "Everyone throws a bowl. Messy, funny, very good for teams.", { pp: 78, min: 6, max: 16, moods: ["handson", "bonding"], goals: ["workshop", "team"], len: "2.5 hours", inc: ["Clay and wheel time", "Firing and shipping"], access: ["step-free"], art: "pottery", time: "any" }),
    ],
    history: { events: 8, responseHours: 5 },
    reviews: [R(5, "The mugs arrived two weeks later and the whole team cheered.", "Juniper Pay", "People team", 0, 18, 3)],
    kudos: [K("My mug is wonky and I love it.", "Cy", "Paint-your-own mug")] },

  { handle: "build-night", name: "Build Night", person: "Omar", city: "San Francisco", area: "SoMa", art: "glasses", accent: "#3A6A8A", policy: "standard", since: 2022,
    tagline: "Hands-on build workshops for technical teams and customers.",
    story: "I'm Omar. Small groups build something real in an evening with a coach at every table.",
    packages: [
      P("bnagent", "Build an agent workflow, together", "Bring a real task; leave with a working workflow and the notes to keep going.", { pp: 120, min: 15, max: 30, moods: ["handson", "client"], goals: ["workshop", "customer", "community"], len: "3 hours", inc: ["Coaches", "Dinner", "Notes to keep"], diets: VEG, access: A_FULL, art: "tech" }),
    ],
    history: { events: 5, responseHours: 8 },
    reviews: [R(5, "Our customers built something in three hours and asked when the next one is.", "Cobalt & Co", "Developer relations", 0, 24, 2)],
    kudos: [] },

  { handle: "byte-and-burl", name: "Byte & Burl", person: "Iris", city: "San Francisco", area: "Dogpatch", art: "glasses", accent: "#7A5A3A", policy: "flexible", since: 2021,
    tagline: "Build-a-macro-pad workshops: wood, keys and a little soldering.",
    story: "I'm Iris. Everyone builds a three-key macro pad in a walnut case. No soldering experience needed.",
    packages: [
      P("bwmacro", "Build a macro pad, for your team", "Solder, assemble, program. Everyone leaves with a working macro pad.", { pp: 95, min: 6, max: 20, moods: ["handson"], goals: ["workshop", "team"], len: "2.5 hours", inc: ["A kit each", "Tools", "A coach for every 5"], access: A_SOME, art: "tech", time: "any" }),
    ],
    history: { events: 5, responseHours: 6 },
    reviews: [R(5, "Engineers and marketers side by side, both proud of their pads.", "Tidepool Analytics", "Team lead", 0, 16, 4)],
    kudos: [] },

  { handle: "fieldnote", name: "Fieldnote Photo & Check-in", person: "Maya", city: "San Francisco", area: "Hayes Valley", art: "bob", accent: "#2F5D62", policy: "standard", since: 2016, alsoIn: ["New York", "Los Angeles", "Seattle", "Austin"],
    tagline: "A photo booth, an event photographer and a check-in crew for brand events.",
    story: "I'm Maya. Three things brand events need and nobody wants to manage: a photo booth people actually use, a photographer who knows what marketing wants, and a check-in desk that moves fast. San Francisco crew, a New York crew, and we travel.",
    packages: [
      P("fnbooth", "Photo booth with an attendant", "An open-air booth with your logo and colours on every print and digital frame, instant prints and a QR sharing station, a backdrop and props. Online gallery after. Priced by the hour, 2 hours minimum.", { pp: 450, min: 30, max: 2000, moods: ["celebrate", "services"], goals: ["celebration", "community", "conference", "summit"], len: "2 to 4 hours", inc: ["Booth, lights and an attendant", "Branded print and digital templates", "Instant prints and a QR sharing station", "Backdrop and props", "Online gallery after", "Setup and breakdown"], unit: "hour", minUnits: 2, venue: "venue", art: "party", time: "any", wd: ALLWK, lead: 10, dep: 50,
        addOns: [{ name: "Overtime", price: "$200 an hour" }, { name: "Lead capture with consent", price: "$150" }],
        details: ["Needs a 10 by 10 ft spot and one standard outlet.", "Lead capture is opt-in: guests tick a clearly labelled box to share their email with your brand. No box, no email.", "Templates need your logo and colours 7 days before."] }),
      P("fnphoto", "Event photographer", "Coverage of your dinner, launch or summit by the hour, minimum 2. Sneak peek in 48 hours, full gallery in 7 days.", { pp: 325, min: 1, max: 2000, moods: ["services"], goals: ["summit", "customer", "celebration", "community", "conference", "offsite"], len: "2, 4 or 8 hours", inc: ["Edited gallery", "48-hour sneak peek", "Full gallery in 7 days"], unit: "hour", minUnits: 2, venue: "venue", art: "talk", time: "any", wd: ALLWK, lead: 10, dep: 50,
        addOns: [{ name: "Second shooter", price: "$180 an hour" }], details: ["Usage: marketing use forever. Guests who opt out of photos are left out.", "Travel: free in the city, $250 day fee outside it."] }),
      P("fncheck", "Check-in staff with badges", "Registration desk, badge printing and scanners, about one staffer per 50 attendees.", { pp: 480, min: 50, max: 3000, moods: ["services"], goals: ["summit", "conference", "community"], len: "10-hour day", inc: ["Staff", "Badge printers and scanners", "A check-in app"], unit: "staff-day", per: 50, minUnits: 3, venue: "venue", art: "talk", time: "daytime", wd: ALLWK, lead: 14, dep: 50, details: ["Minimum 3 staff-days."] }),
    ],
    history: { events: 9, responseHours: 4 },
    reviews: [R(5, "The booth templates in our colours made every photo on social look on brand.", "Fernlight", "Brand lead", 0, 150, 2), R(5, "Check-in for 600 with no line. Maya's crew are pros.", "Brightwell Health", "Events lead", 2, 600, 4)],
    kudos: [] },

  { handle: "crewline", name: "Crewline Event Staff", person: "Andre", city: "San Francisco", area: "SoMa", art: "shaved", accent: "#2E5E7E", policy: "standard", since: 2015, alsoIn: ["Los Angeles", "Seattle", "Austin"],
    tagline: "Temporary conference staff for your first flagship summit.",
    story: "I'm Andre. Registration, check-in, room runners, speaker wrangling, badge printing and an on-site coordinator, for teams who don't have the bandwidth to run a summit floor themselves.",
    packages: [
      P("clstaff", "Event staff, per staffer per day", "Registration desk, check-in, room runners and speaker wranglers. About one staffer per 50 attendees.", { pp: 495, min: 50, max: 3000, moods: ["services"], goals: ["summit", "conference", "community"], len: "10-hour day", inc: ["Trained staff", "A shift plan", "Badge printing on request"], unit: "staff-day", per: 50, minUnits: 4, venue: "venue", art: "talk", time: "daytime", wd: ALLWK, lead: 14, dep: 50, details: ["Minimum 4 staff-days.", "Staff count is our crew; attendees are your guests."] }),
      P("cllead", "On-site coordinator", "A senior lead who runs the floor and the run of show for you.", { pp: 1350, min: 50, max: 3000, moods: ["services"], goals: ["summit", "conference"], len: "Up to 12 hours", inc: ["Run-of-show review", "Radios"], unit: "package", venue: "venue", art: "talk", time: "any", wd: ALLWK, lead: 14, dep: 50 }),
    ],
    history: { events: 8, responseHours: 5 },
    reviews: [R(5, "Our first flagship summit, 350 people, and the floor ran like clockwork.", "Orbitly", "Head of events", 0, 350, 3)],
    kudos: [] },

  { handle: "bayline-summits", name: "Bayline Summit Co.", person: "Helen", city: "San Francisco", area: "SoMa", art: "bun", accent: "#3A4A7A", policy: "firm", since: 2012, alsoIn: ["Los Angeles", "Seattle", "Austin"],
    tagline: "Summit planning, from the first brief to the last vendor invoice.",
    story: "I'm Helen. We plan customer summits for 80 to 600: venue scouting, the agenda and run of show, vendors and a budget you can trust. Sold as a planning package sized by attendees and weeks of lead time.",
    packages: [
      P("bsplan150", "Summit plan, up to 150 attendees", "Ten weeks: three venue options, agenda and run of show, vendors booked, a live budget, on site on the day.", { pp: 17500, min: 40, max: 150, moods: ["services"], goals: ["summit"], len: "10 weeks of planning", inc: ["Venue scouting", "Agenda and run of show", "Vendors", "Budget sheet", "On site"], unit: "package", venue: "venue", art: "talk", time: "any", wd: ALLWK, lead: 70, dep: 25, details: ["Lead time 10 weeks.", "Paid in three parts.", "Vendor costs passed through at cost."] }),
      P("bsplan400", "Summit plan, 150 to 400 attendees", "Fourteen weeks, with a speaker programme and two planners on site.", { pp: 31000, min: 150, max: 400, moods: ["services"], goals: ["summit"], len: "14 weeks of planning", inc: ["Everything in the smaller plan", "Speaker programme", "Two planners on site"], unit: "package", venue: "venue", art: "talk", time: "any", wd: ALLWK, lead: 98, dep: 25 }),
    ],
    history: { events: 7, responseHours: 10 },
    reviews: [R(5, "Helen found us a venue we'd never have thought of and saved a fifth of the budget.", "Quillon", "VP marketing", 0, 220, 6)],
    kudos: [] },

  { handle: "redwood-quiet", name: "Redwood Quiet Retreats", person: "Cal", city: "San Francisco", area: "Marin", art: "hiker", accent: "#4C6B3C", policy: "firm", since: 2017,
    tagline: "Offsite days among the redwoods, 40 minutes from the city.",
    story: "I'm Cal. A lodge in the trees with a big table, a fire and trails out the back. Day offsites with a working morning, a long lunch and a walk.",
    packages: [
      P("rqoffsite", "Redwood offsite day", "Shuttle from SoMa, a working morning in the lodge, lunch, a forest walk, back by 6.", { pp: 230, min: 10, max: 60, minimum: 3400, moods: ["calm", "bonding"], goals: ["offsite", "team", "wellness"], len: "A full day", inc: ["Shuttle", "Lodge with screen", "Breakfast and lunch"], diets: ALLD, access: ["accessible restroom", "seating for everyone", "quiet space"], art: "hike", time: "daytime", wd: WEEK, lead: 21, dep: 50 }),
    ],
    history: { events: 7, responseHours: 9 },
    reviews: [R(5, "The walk after lunch is where our real planning happened.", "Larkspur Labs", "Chief of staff", 0, 30, 4)],
    kudos: [K("Phones in a basket, feet on the trail. Perfect.", "Lin", "Redwood offsite day")] },

  { handle: "desert-table", name: "Desert Table Events", person: "Rosa", city: "Las Vegas", area: "Las Vegas Arts District", art: "chef", accent: "#C06A3A", policy: "standard", since: 2018,
    tagline: "Conference-week private dinners and after-parties away from the Strip.",
    story: "I'm Rosa. When the conference is in town, we run the dinners people actually want to go to, ten minutes from the Strip.",
    packages: [
      P("dtdinner", "Conference-week private dinner", "A set menu for 12 to 24 in a private room, shuttles from the Strip.", { pp: 195, min: 12, max: 24, minimum: 2600, moods: ["client"], goals: ["customer", "conference"], len: "3 hours", inc: ["Four courses", "Shuttles", "Private room"], diets: ALLD, access: A_FULL, art: "dinner", dep: 50 }),
      P("dtlounge", "After-party lounge", "A lounge for 80 to 250 with a DJ and a bar.", { pp: 72, min: 80, max: 250, minimum: 6000, moods: ["celebrate"], goals: ["conference", "celebration", "community"], len: "4 hours", inc: ["Lounge", "Bar", "DJ"], access: A_FULL, art: "party", wd: ALLWK, lead: 30, dep: 50 }),
    ],
    history: { events: 8, responseHours: 7 },
    reviews: [R(5, "Away from the Strip, quiet enough to talk. Exactly what our customers wanted.", "Juniper Pay", "Field marketing", 0, 20, 8)],
    kudos: [] },
];

// ---------------------------------------------------------------------------------------------------------------
// Six more cities, one of each kind brands ask for most: a dinner host, a hands-on studio, a coffee cart, a venue for
// meetups and launches, a yoga teacher and a sound bath and retreat host. The services above (photos, staff, planning,
// flowers) travel to these cities.
const CITY_HOSTS = [
  { city: "Los Angeles", f: 1.0, hoods: ["Arts District", "Silver Lake", "Echo Park", "Arts District", "Venice", "Topanga"],
    names: [["saltbush-supper", "Saltbush Supper", "Lena", "chef"], ["sunbaked-clay", "Sunbaked Clay Co.", "Teo", "curls", "pottery"], ["paloma-cart", "Paloma Coffee Cart", "Luz", "barista"], ["lot-on-mateo", "The Lot on Mateo", "Jules", "glasses"], ["canyon-flow", "Canyon Flow Yoga", "Kai", "runner"], ["quiet-canyon", "Quiet Canyon Sound & Retreat", "Rumi", "locs"]] },
  { city: "Austin", f: 0.92, hoods: ["East Austin", "East Austin", "South Congress", "South Congress", "Zilker", "Hill Country"],
    names: [["live-oak-table", "Live Oak Table", "Bea", "chef"], ["caliche-clay", "Caliche Clay Studio", "Rory", "beard", "pottery"], ["two-mule-coffee", "Two Mule Coffee Cart", "Hal", "barista"], ["pecan-room", "The Pecan Room", "Dee", "waves"], ["barton-flow", "Barton Flow Yoga", "Tess", "runner"], ["hill-country-hush", "Hill Country Hush", "Wren", "braids"]] },
  { city: "Chicago", f: 0.95, hoods: ["West Loop", "Logan Square", "Wicker Park", "West Loop", "Lincoln Park", "Andersonville"],
    names: [["lakeshore-supper", "Lakeshore Supper Room", "Gia", "chef"], ["kedzie-kiln", "Kedzie Kiln", "Abe", "glasses", "pottery"], ["northside-pour", "Northside Pour Coffee Cart", "Rita", "barista"], ["fulton-works", "Fulton Works Loft", "Max", "beard"], ["lakefront-flow", "Lakefront Flow Yoga", "Joy", "runner"], ["prairie-rest", "Prairie Rest Sound", "Eli", "beanie"]] },
  { city: "Seattle", f: 1.0, hoods: ["Ballard", "Capitol Hill", "Fremont", "Ballard", "Green Lake", "Bainbridge"],
    names: [["cedar-and-brine", "Cedar & Brine", "Nora", "chef"], ["rain-garden-florals", "Rain Garden Florals", "Ivy", "florist", "flowers"], ["drizzle-coffee", "Drizzle Coffee Cart", "Ty", "barista"], ["pier-shed", "Pier Shed Studio", "Cass", "glasses"], ["sound-side-yoga", "Sound Side Yoga", "Mara", "runner"], ["moss-hour", "Moss Hour Sound", "Finn", "beanie"]] },
  { city: "Boston", f: 1.0, hoods: ["South End", "South End", "Back Bay", "Seaport", "Cambridge", "North Shore"],
    names: [["tidewater-table", "Tidewater Table", "Clem", "chef"], ["south-end-stems", "South End Stems", "Lou", "florist", "flowers"], ["beacon-cart", "Beacon Cart Coffee", "Pat", "barista"], ["seaport-loft-nine", "Seaport Loft Nine", "Gwen", "bob"], ["charles-flow", "Charles Flow Yoga", "Ada", "runner"], ["harbor-hush", "Harbor Hush Sound", "Noel", "beard"]] },
  { city: "London", f: 1.1, hoods: ["Clerkenwell", "Shoreditch", "Hackney", "Shoreditch", "Islington", "Hackney"],
    names: [["clerkenwell-table", "Clerkenwell Kitchen Table", "Hattie", "chef"], ["shoreditch-clay", "Shoreditch Clay Rooms", "Femi", "afro", "pottery"], ["little-brew-cart", "Little Brew Cart", "Ollie", "barista"], ["arch-room", "The Arch Room", "Priti", "hijab"], ["canal-flow", "Canal Flow Yoga", "Rosie", "runner"], ["hackney-sound", "Hackney Sound House", "Jem", "beanie"]] },
];
const $ = (n, f) => Math.round((n * f) / 5) * 5; // a city's price, rounded to $5
function cityHosts({ city, f, hoods, names }) {
  const [d, s, c, v, y, r] = names, out = [], kudos = (t, n, e) => [K(t, n, e)];
  const H = (n, i, o) => ({ handle: n[0], name: n[1], person: n[2], art: n[3], city, area: hoods[i], policy: "standard", since: 2016 + i, ...o });
  out.push(H(d, 0, { accent: "#9A4128", tagline: `A private chef in ${city} for customer dinners, team feasts and cooking classes.`,
    story: `I'm ${d[2]}. I cook on site for 8 to 150: a tasting menu for your best accounts, a family-style feast for the holiday party, or a class where your team cooks dinner together. Every diet planned for at the menu call.`,
    packages: [
      P(d[0].slice(0, 6).replace(/-/g, "") + "din", "Customer dinner, cooked on site", "Four courses for 8 to 30, cooked and served where you are, with a seating plan done together.", { pp: $(150, f), min: 8, max: 30, minimum: $(1600, f), moods: ["client", "celebrate"], goals: ["customer", "celebration"], len: "3 hours", inc: ["Menu call", "Four courses", "Servers", "Clean-up"], diets: ALLD, access: A_SOME, venue: "venue", art: "dinner", dep: 50, addOns: [{ name: "Wine pairing", price: `$${$(55, f)} a person` }] }),
      P(d[0].slice(0, 6).replace(/-/g, "") + "fst", "Family-style feast or holiday party", "Long tables and shared platters for 20 to 150. Good for the holiday party or a community supper.", { pp: $(95, f), min: 20, max: 150, minimum: $(2400, f), moods: ["celebrate", "bonding", "client"], goals: ["celebration", "team", "community"], len: "3 hours", inc: ["Three courses and dessert", "Servers", "Rentals"], diets: ALLD, access: A_SOME, venue: "venue", art: "dinner", wd: ALLWK, dep: 50 }),
      ...catering(d[0].slice(0, 4).replace(/-/g, ""), f, { breakfast: false }),
      P(d[0].slice(0, 6).replace(/-/g, "") + "cls", "Cook-together dinner class", "Your team cooks in small groups, then eats what they made.", { pp: $(105, f), min: 8, max: 30, moods: ["handson", "bonding"], goals: ["workshop", "team", "customer"], len: "3 hours", inc: ["Ingredients", "Aprons", "Dinner"], diets: VEG, access: A_SOME, venue: "venue", art: "cook" }),
    ], history: { events: 7, responseHours: 6 },
    reviews: [R(5, `${d[2]} cooked for our ${city} customers and every allergy was handled quietly.`, "Larkspur Labs", "Field marketing", 0, 16, 2), R(5, "The feast was the best holiday party we've had.", "Juniper Pay", "Office lead", 1, 60, 10)],
    kudos: kudos("Best work dinner I've been to.", "Sam", "Customer dinner") }));
  const craft = s[4] === "flowers" ? { what: "flower arranging", art: "garden", made: "a bouquet", inc: ["Seasonal stems", "Tools and wrap"] } : { what: "pottery", art: "pottery", made: "a piece they made, fired and shipped", inc: ["Clay or a bisque piece each", "Glazes and firing", "Shipping to your office"] };
  out.push(H(s, 1, { accent: "#B5603C", tagline: `Hands-on ${craft.what} for teams and customers in ${city}.`, story: `I'm ${s[2]}. A sunny studio, a calm teacher, and everyone leaves with ${craft.made}. I also travel to offices.`,
    packages: [
      P(s[0].slice(0, 6).replace(/-/g, "") + "wrk", `${craft.what[0].toUpperCase() + craft.what.slice(1)} workshop`, `Two hours of ${craft.what}, no experience needed, a coach for every 8 people.`, { pp: $(65, f), min: 8, max: 40, moods: ["handson", "calm", "client"], goals: ["workshop", "team", "customer", "offsite", "wellness"], len: "2 hours", inc: craft.inc, access: A_FULL, art: craft.art, time: "any" }),
      P(s[0].slice(0, 6).replace(/-/g, "") + "big", "Big team session", "The whole studio for 20 to 80, with music and snacks. Good for a team day or a launch-week thank you.", { pp: $(58, f), min: 20, max: 80, moods: ["handson", "bonding", "celebrate"], goals: ["team", "workshop", "community", "celebration"], len: "2.5 hours", inc: [...craft.inc, "Snacks and drinks"], access: A_FULL, art: craft.art, time: "any", wd: ALLWK }),
    ], history: { events: 6, responseHours: 5 },
    reviews: [R(5, "Quietest, happiest two hours our team has spent together.", "Orbitly", "People team", 0, 18, 3)], kudos: kudos(`I made ${craft.made.split(",")[0]} and I'm keeping it.`, "Mo", "Workshop") }));
  out.push(H(c, 2, { accent: "#6B4A2E", tagline: `An espresso cart for booths, launches and offices in ${city}, and cuppings for small groups.`, story: `I'm ${c[2]}. Two baristas, a real espresso machine and a queue people enjoy standing in.`,
    packages: [
      P(c[0].slice(0, 6).replace(/-/g, "") + "crt", "Coffee cart pop-up", "Espresso drinks made to order for 20 to 300, at your booth, office or launch.", { pp: $(12, f), min: 20, max: 300, minimum: $(950, f), moods: ["celebrate", "bonding", "client"], goals: ["conference", "community", "celebration", "team"], len: "3 hours of service", inc: ["Two baristas", "Coffee and milks", "Cups and setup"], diets: VEG, access: A_SOME, venue: "brand", art: "coffee", time: "any", wd: ALLWK, lead: 10, details: ["Needs a 6 by 8 ft spot and two outlets."] }),
      ...catering(c[0].slice(0, 4).replace(/-/g, ""), f, { lunch: false, event: false }),
      P(c[0].slice(0, 6).replace(/-/g, "") + "cup", "Coffee cupping", "Six coffees side by side, tasted the way roasters do.", { pp: $(45, f), min: 8, max: 30, moods: ["handson", "client", "bonding"], goals: ["workshop", "customer", "team"], len: "75 minutes", inc: ["Six coffees", "A bag to take home"], diets: VEG, access: A_FULL, venue: "brand", art: "coffee", time: "daytime" }),
    ], history: { events: 8, responseHours: 3 },
    reviews: [R(5, "Our booth had a line all day.", "Tidepool Analytics", "Events", 0, 200, 2)], kudos: kudos("Best flat white at the conference.", "Lee", "Coffee cart") }));
  out.push(H(v, 3, { accent: "#4A5A7A", tagline: `A warm room in ${city} for meetups, launches, holiday parties and offsite days.`, story: `I'm ${v[2]}. A big room with a screen, a bar and a kitchen, and a quiet side room for planning days. We run the room; you run the content.`,
    packages: [
      P(v[0].slice(0, 6).replace(/-/g, "") + "mtp", "Meetup or demo night", "Doors, drinks, a short programme, then food and conversation for 30 to 150.", { pp: $(42, f), min: 20, max: 150, minimum: $(2000, f), moods: ["celebrate", "bonding", "client"], goals: ["community", "conference", "celebration"], len: "3 hours", inc: ["Room, screen and mics", "Food and two drinks", "Door staff"], diets: VEG, access: A_FULL, art: "talk", lead: 21 }),
      P(v[0].slice(0, 6).replace(/-/g, "") + "lch", "Launch or holiday party", "The whole space for 50 to 200: bar, food, a DJ.", { pp: $(65, f), min: 50, max: 200, minimum: $(4200, f), moods: ["celebrate"], goals: ["celebration", "community", "conference", "team"], len: "4 hours", inc: ["The space", "Bar and food", "DJ"], diets: VEG, access: A_FULL, art: "party", wd: ALLWK, lead: 30, dep: 50 }),
      ...catering(v[0].slice(0, 4).replace(/-/g, ""), f, { breakfast: false }),
      P(v[0].slice(0, 6).replace(/-/g, "") + "off", "Offsite day room", "The side room for a working day: screen, whiteboards, breakfast and lunch.", { pp: $(110, f), min: 8, max: 60, minimum: $(1200, f), moods: ["calm", "client", "bonding"], goals: ["offsite", "team", "customer"], len: "8 hours", inc: ["Room for the day", "Breakfast and lunch", "Screen and whiteboards"], diets: ALLD, access: A_FULL, art: "talk", time: "daytime", lead: 14 }),
    ], history: { events: 9, responseHours: 7 },
    reviews: [R(5, "The door staff and the sound made our meetup feel effortless.", "Cobalt & Co", "Community lead", 0, 90, 2), R(5, "Offsite room was quiet, bright and lunch was great.", "Quillon", "Chief of staff", 2, 20, 5)], kudos: kudos("Good room, good people.", "Ari", "Meetup") }));
  out.push(H(y, 4, { accent: "#3E7FA6", tagline: `All-levels yoga for teams in ${city}: offsite mornings, sunrise sessions, after work.`, story: `I'm ${y[2]}. I bring mats and props, travel to your venue, and every pose has a chair option.`,
    packages: [
      P(y[0].slice(0, 6).replace(/-/g, "") + "flw", "Morning yoga flow, 60 minutes", "An all-levels flow to open an offsite or team day.", { pp: $(30, f), min: 8, max: 60, minimum: $(360, f), moods: ["calm", "bonding"], goals: ["wellness", "offsite", "team"], len: "60 minutes", inc: ["Mats and props", "Travel to your venue"], access: A_FULL, venue: "brand", art: "yoga", time: "daytime", wd: ALLWK, lead: 7, details: ["About 25 sq ft a person.", "All levels, chair options."] }),
      P(y[0].slice(0, 6).replace(/-/g, "") + "sun", "Sunrise session and community run", "A 45-minute sunrise session or an easy group run for 15 to 150, then coffee.", { pp: $(38, f), min: 15, max: 150, moods: ["calm", "celebrate", "bonding"], goals: ["conference", "community", "wellness"], len: "45 minutes", inc: ["Mats or pacers", "Coffee after"], access: ["seating for everyone"], venue: "venue", art: "run", time: "daytime", wd: ALLWK, lead: 14 }),
    ], history: { events: 8, responseHours: 3 },
    reviews: [R(5, `${y[2]} had our whole team, from interns to the CFO, on the mat.`, "Fernlight", "People team", 0, 30, 3)], kudos: kudos("I've never felt that loose at work.", "Ro", "Morning yoga flow") }));
  out.push(H(r, 5, { accent: "#5A5A8C", tagline: `Sound baths and quiet offsite days near ${city}.`, story: `I'm ${r[2]}. Sound baths at your venue, and offsite days at a quiet place out of town with a working morning, lunch and a walk.`,
    packages: [
      P(r[0].slice(0, 6).replace(/-/g, "") + "bth", "Sound bath for 10 to 40", "Breathing, then 45 minutes of bowls and gong. Mats, bolsters, eye pillows.", { pp: $(44, f), min: 10, max: 40, minimum: $(480, f), moods: ["calm"], goals: ["wellness", "offsite", "team"], len: "60 minutes", inc: ["Mats and bolsters", "Travel to your venue"], access: A_FULL, venue: "brand", art: "music", time: "any", wd: ALLWK, lead: 7 }),
      P(r[0].slice(0, 6).replace(/-/g, "") + "day", "Quiet offsite day", "Shuttle out of town, a working morning, lunch, a walk or sound bath, back by 6.", { pp: $(210, f), min: 10, max: 60, minimum: $(3000, f), moods: ["calm", "bonding"], goals: ["offsite", "team", "wellness"], len: "A full day", inc: ["Shuttle", "A room with a screen", "Breakfast and lunch"], diets: ALLD, access: ["accessible restroom", "seating for everyone", "quiet space"], art: "hike", time: "daytime", lead: 21, dep: 50 }),
    ], history: { events: 6, responseHours: 6 },
    reviews: [R(5, "We ended the offsite with the sound bath. Everybody left kinder.", "Larkspur Labs", "Chief of staff", 1, 24, 4)], kudos: kudos("I slept the best I have in months.", "Kit", "Sound bath") }));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Turn the list into the shapes server/brandbook.js reads: { ws, h, s } like a real host, plus example stats and reviews.
let CACHE = null;
function build(now = Date.now()) {
  const day0 = isoDay(now), until = isoDay(now + 92 * DAY), monthsAgo = (n) => now - n * 30 * DAY, all = [...HOSTS, ...CITY_HOSTS.flatMap(cityHosts)], out = new Map();
  for (const x of all) {
    const ws = EXAMPLE_PREFIX + x.handle;
    const h = { handle: x.handle, name: x.name, city: x.city, hood: x.area, tagline: x.tagline, bio: x.story, example: true, theme: { avatarArt: x.art, accent: x.accent || "#9A4128" }, color: x.accent || "#9A4128" };
    const packages = x.packages.map((p) => ({ ...p, openUntil: (p.leadDays || 0) + 62 > 92 ? isoDay(now + ((p.leadDays || 0) + 62) * DAY) : until }));
    const s = { on: true, packages, policy: x.policy || "standard", area: x.area, city: x.city, alsoIn: x.alsoIn || [], address: "", story: x.story, since: x.since || 0, taxId: "", phone: "", updatedAt: now };
    const reviews = (x.reviews || []).map((r, i) => ({ rating: r.rating, text: r.text, company: r.company, role: r.role, at: monthsAgo(r.monthsAgo) - i * DAY, pkg: packages[r.pkgIdx]?.name || packages[0].name, headcount: r.headcount, month: isoDay(monthsAgo(r.monthsAgo)).slice(0, 7), example: true }));
    const rating = reviews.length ? Math.round((reviews.reduce((a, r) => a + r.rating, 0) / reviews.length) * 100) / 100 : 0;
    const H0 = x.history || {};
    const stats = { events: H0.events || 5, teamEvents: reviews.length, guests: 0, again: null, kudos: (x.kudos || []).length, reviews: reviews.length, rating, responseHours: H0.responseHours ?? 6, responseRate: 1,
      repeatRate: 0, repeatBrands: 0, brands: new Set(reviews.map((r) => r.company)).size, hostCancels90: 0, goodPhotos: 0, emailVerified: false, phoneVerified: false, idChecked: false, coi: { onFile: false },
      years: x.since ? Math.max(0, new Date(now).getUTCFullYear() - x.since) : 0, since: x.since || 0, example: true };
    out.set(x.handle, { ws, h, s, person: x.person, stats, reviews, kudos: (x.kudos || []).map((k) => ({ ...k, example: true })) });
  }
  return { day: day0, map: out };
}
function data() { const d = isoDay(); if (!CACHE || CACHE.day !== d) CACHE = build(); return CACHE.map; }

/** Every example host as { ws, h, s } (empty when ENCORE_HIDE_DEMO=1). */
export const exampleSetups = () => (examplesHidden() ? [] : [...data().values()].map(({ ws, h, s }) => ({ ws, h, s })));
/** One example host by handle or by its ws id, or null. Ignores ENCORE_HIDE_DEMO (callers check it). */
export const exampleByHandle = (handle) => data().get(String(handle || "").toLowerCase()) || null;
export const exampleByWs = (ws) => (isExampleWs(ws) ? exampleByHandle(ws.slice(EXAMPLE_PREFIX.length)) : null);
export const exampleCities = () => [...new Set([...data().values()].map((x) => x.s.city))];
export const exampleCount = () => data().size;

/** The host lookups the brand side uses (server/brandbook.js, brandpanel*.js, campaigns.js), with example hosts
 *  added behind the real ones. Guest-side code keeps the plain lookups, so examples never reach it. */
export function brandView(C) {
  const V = Object.create(C);
  V.profileOf = (ws) => exampleByWs(ws)?.h || C.profileOf(ws);
  V.wsOfHandle = (h) => C.wsOfHandle(h) || (!examplesHidden() && exampleByHandle(h)?.ws) || null;
  V.followersOf = (ws) => (isExampleWs(ws) ? [] : C.followersOf(ws));
  V.follow = (ws, ...a) => (isExampleWs(ws) ? null : C.follow(ws, ...a));
  return V;
}
