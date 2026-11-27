# Review scorecard (loop 16)

Five scores per persona, out of 10: **Use** (usefulness), **Joy** (delight), **Ease** (ease of use), **Intu** (intuitiveness), **Pick** ("I'd choose Pottery Lab over Partiful and Eventbrite for this"). The bar is 9 on every score.

Screens: `review16/round-N/before` and `review16/round-N/after` in the session scratchpad. Each round drives the persona's real job in a browser at 390px (and 1280px for brand and host tools), on a seeded world: the demo hosts (run club, supper club, apartment café, flower studio, bánh mì cart) and the Fernwood Labs brand world (hosts, 5 bookings, 3 campaigns, 120 guests).

## Round 1

What we compared against: Partiful makes the invite and the reply feel effortless and a little fun; Eventbrite is trusted for tickets, checkout and organizer reporting. Both let a guest keep things for later (Partiful's saved events, Eventbrite's likes and collections) and both make it obvious where a guest list lives.

| Persona | Use | Joy | Ease | Intu | Pick | Notes (before → after this round) |
|---|---|---|---|---|---|---|
| Engineer | 8 | 7 | 8 | 8 | 7 | One crawl failure (Settings asked for passkeys signed out). Fixed: zero problems at 390 and 1280. |
| Product designer | 8 | 8 | 8 | 8 | 8 | /g used an emoji pin and lock on the address row; the + sheet ended at tiles. Now line icons; the sheet leads somewhere. |
| Product manager | 8 | 7 | 8 | 7 | 7 | Saving to a list only existed on the feed and Library. Now on event pages, host pages and collection cards. |
| Field marketer (brand) | 7 | 7 | 7 | 7 | 7 | Campaign guests lived in their own list, apart from People and the invite planner; no reminders, nudges, run of show or time zones. Now one guest list (below). |
| Supper club host (ticketed, 12 seats) | 8 | 8 | 8 | 8 | 8 | Team-booking setup was one long form. Now four short steps with a Go live summary. |
| Game or hack night host (monthly) | 8 | 8 | 8 | 8 | 8 | The host path pointed at its own notes only. Now "Read the guide" opens the written guide (game night, first supper, regulars). |
| Run club host (weekly) | 8 | 8 | 8 | 8 | 8 | Meet points in parks showed only an area on the map. "This is a public spot" now puts the exact pin on. |
| Pottery or cooking workshop host | 8 | 7 | 8 | 8 | 7 | Unchanged this round; next: materials and paid add-ons on the guest page. |
| Weekend getaway host | 7 | 7 | 7 | 7 | 7 | Unchanged this round; next: a day-by-day itinerary guests can read. |
| Small summit host (100, agenda) | 7 | 7 | 7 | 7 | 6 | Unchanged this round; next: an agenda block and check-in at scale. |
| Coffee pop-up business | 8 | 8 | 8 | 8 | 8 | Unchanged this round; drops and pickup windows hold up. |
| Casual planner | 9 | 8 | 9 | 9 | 8 | Fast invite, replies and chat are good. Potto's nudges now land in the Inbox like everything else. |
| Hobbyist seller (pandan cake) | 8 | 8 | 8 | 8 | 8 | Unchanged this round. |
| City explorer / guest | 8 | 8 | 8 | 8 | 8 | Can now keep an event, a host or a collection card on a named list from where they found it. |

### Fixed in round 1

- **Save to list everywhere a guest decides.** `PLSave.listButton()` in public/save.js draws a "Save to list" button; any `[data-pl-savelist]` element opens the sheet (public/savelist.js loads on the first tap). On the event page next to Save (public/friendsgoing.js), on host pages next to Share (public/storeshop.js), and as a round button on every collection event card (public/collections.js).
- **"This is a public spot"** in the editor's Where sheet (public/canvas.js) and the New flow's place step (index.html) sets `placePublic: true`, so the map can show an exact pin for a park or café, never for a home.
- **The + sheet** links to the Host library (templates, past events, menus, guest lists) and Ideas to host (public/composer.js).
- **Host path to guides:** `guideHrefOf()` in server/hostloop.js links each path node to its written guide in server/guides.js; /path shows "Read the guide".
- **Potto's nudges go through the Inbox's `notify()`** (server/inbox.js), from Potto, so they show in the Inbox list as well as the bell.
- **/g address row:** a line pin and a line lock instead of emoji.
- **Team bookings setup in four steps** (Packages, About you, Cancellation, Go live) with a summary of what's still missing (public/host-teams.html).
- **Brand account rollup** on /teams/bookings: booked and committed this year, people hosted, open requests, next up, hosts used and who on the team booked (`rollupOf()` in server/brandbook.js).
- **Campaigns and the invite planner are one guest list.** A booked campaign event gets its own invite page in the brand's workspace (`events/cg<booking>`), with the city's time zone, a day-before reminder, add to calendar and the waitlist. Its guests go into People (consent "in" only for people who agreed to hear from the brand) and onto the event's plan, so smart lists, waves and the status board work. Sends go through the plan for people who agreed and through the campaign's own consent-asking link for everyone else. The campaign's record (sent, yes, no, checked in) is mirrored onto the board, and replies on the invite page come back to the campaign. A "Nudge N who haven't replied" button uses the plan's reminders. The Run tab has a run of show in the event's local time, editable, and one tap sends it to the host. c.guests keeps its shape, so Measure, the report and the CRM export are unchanged.
- **Settings signed out** no longer asks for passkeys (public/passkeys.js).

## Round 2

Compared again: Partiful lets you type an event like a text and fixes the details later; Eventbrite always says what you're buying and where to get it. Our gaps were where a person types or taps the obvious thing and nothing follows.

| Persona | Use | Joy | Ease | Intu | Pick | Notes (what moved) |
|---|---|---|---|---|---|---|
| Engineer | 9 | 8 | 9 | 9 | 8 | Zero crawl problems at 390 and 1280. A dropped page transition no longer throws an unhandled rejection. |
| Product designer | 9 | 8 | 9 | 9 | 8 | The reply bar's empty band after you reply on /g is gone; a drop's bar says Order, not I'm in. |
| Product manager | 9 | 8 | 9 | 9 | 8 | Discover's "Order from hosts" led to a host page with nothing to order. It now lists live drops and opens the drop. |
| Field marketer (brand) | 9 | 8 | 9 | 9 | 8 | One guest list, nudges, a run of show in local time and "send it to the host" are in. Still wants a calendar file in the invite email and a per-city view of times on Home. |
| Supper club host | 9 | 8 | 9 | 9 | 9 | Typing the whole plan in the title fills the date, time, place and spots. |
| Game or hack night host | 9 | 8 | 9 | 9 | 8 | "Friday at 7" reads as 7pm; the monthly guide is one tap from the path. |
| Run club host | 9 | 8 | 9 | 9 | 9 | Public spot pin, weekly repeat, and the meet point with a line pin on /g. |
| Pottery or cooking workshop host | 8 | 8 | 8 | 8 | 8 | No change this round; materials still read as a "bring" list. |
| Weekend getaway host | 9 | 8 | 9 | 8 | 8 | The editor takes a last day; the invite says "Sat, Dec 12 to Mon, Dec 14"; Settings has "The plan, day by day", which opens the itinerary editor. |
| Small summit host | 8 | 8 | 8 | 8 | 8 | The same plan editor lays out talks by day. Still no badge printing or bulk check-in. |
| Coffee pop-up business | 9 | 8 | 9 | 9 | 9 | Drops show up in Discover again, with pickup windows on the drop page. |
| Casual planner | 9 | 9 | 9 | 9 | 9 | "Dinner at my place Saturday 7pm, 6 friends" becomes a filled-in invite in one tap; sharing is the next screen. |
| Hobbyist seller | 9 | 9 | 9 | 9 | 9 | The drop page says "Bo is hosting" and "So Bo can tell you it's ready", never "Bo's". |
| City explorer / guest | 9 | 8 | 9 | 9 | 9 | Save to list from anywhere; the drop row in Discover goes somewhere real. |

### Fixed in round 2

- **A whole plan typed into the title** (`planFromLine()` in public/canvas.js): "Dinner at my place Saturday 7pm, 6 friends, I'm making dumplings" offers "Fill in Sat, Nov 28, 7pm, My place and 6 spots", which fills only what's empty and moves the rest into the description.
- **Multi-day events:** a "Last day" in the editor's When sheet (`endDate`), shown in the editor and on the light invite; `endDate` is now a public field.
- **The plan, day by day:** a Settings row in the editor opens the itinerary editor (`/plans/<id>?edit=1`, which scrolls to it).
- **Discover's "Order from hosts"** lists live drops (server/shop.js), converting an old shop into its drop the first time, and links to the drop itself.
- **/g after replying:** the sticky bar's bottom padding applies only while the bar is on the page (public/slots.css).
- **Drops:** the reply bar reads "Order" and goes to the order form (public/replybar.js); the host's first name drops a trailing "'s" (public/invite.html, public/invite-order.js).
- **Page transitions:** a transition the browser drops no longer surfaces as a page error (public/calm.js).
- **What's included** as an add-on in the editor (`included`), shown on both invites: a workshop's clay, glazes and firing, a trip's meals.
- **Invite emails carry a calendar file link** (`/e/<id>.ics`) for invites, nudges and "you're on the list" sends from the invite plan, so campaign guests and everyone else can put it in their calendar from the email.
- **The light invite's bottom padding** holds the reply bar's room only while the bar is on the page (`body:has(.prb)`), and the bar no longer pads the body by hand, so nothing is left behind after you reply.

## Round 3

Compared again: Eventbrite is still the reference for running a big room (badges, check-in) and for times that read right across cities; Partiful for the small moments that feel personal.

| Persona | Use | Joy | Ease | Intu | Pick | Notes (what moved) |
|---|---|---|---|---|---|---|
| Engineer | 9 | 8 | 9 | 9 | 9 | 1,133 tests and zero crawl problems at 390 and 1280 after every round. Joy stays 8: nothing here is meant to delight an engineer. |
| Product designer | 9 | 8 | 9 | 9 | 9 | A wheel-throwing class now draws as a craft, not a party. Joy 8: some brand pages still set small titles in the serif (owned by the brand and Plans work). |
| Product manager | 9 | 9 | 9 | 9 | 9 | No dead ends left on the paths we drove: every Discover row, Save and "Order" goes somewhere real. |
| Field marketer (brand) | 9 | 8 | 9 | 9 | 9 | Times read in each city's own zone on Home and the Run timeline ("7pm EST"); invite emails carry a calendar file; one guest list end to end. Joy 8: the campaign pages are calm and correct but plain. |
| Supper club host | 9 | 9 | 9 | 9 | 9 | |
| Game or hack night host | 9 | 8 | 9 | 9 | 9 | Name tags for a hack night of 40 are one tap from the guest list. |
| Run club host | 9 | 9 | 9 | 9 | 9 | |
| Pottery or cooking workshop host | 9 | 9 | 9 | 9 | 9 | "What's included" (clay, glazes, firing) on the invite; the line "Wheel throwing Sunday 2pm at Hoa Studio, 8 spots" fills itself in. |
| Weekend getaway host | 9 | 8 | 9 | 9 | 9 | Last day, day-by-day plan, and the plan reaches guests who are in. Joy 8: the plan page is useful but plain. |
| Small summit host | 9 | 8 | 9 | 9 | 9 | Name tags (first name large, company and title for a brand), the agenda as talks by day, check-in on the status board. |
| Coffee pop-up business | 9 | 9 | 9 | 9 | 9 | |
| Casual planner | 9 | 9 | 9 | 9 | 9 | |
| Hobbyist seller | 9 | 9 | 9 | 9 | 9 | |
| City explorer / guest | 9 | 9 | 9 | 9 | 9 | |

### Fixed in round 3

- **Per-city time zones for brands:** each booking carries its local start time and zone (`local` on booking cards, server/campaigns.js), shown on the brand Home's Coming up and the campaign Run timeline.
- **Name tags** from the invite plan's Status tab (public/invite-plan.js): everyone who's in, eight to a letter page, first name large, the rest of the name, company and title for a brand, and the event.
- **What's included and a smarter title** proven end to end for a workshop; a wheel-throwing or glazing class draws as a craft (public/eventart.js).

### Still below 9, and why

- **Joy at 8** for the engineer, designer, field marketer, game night, weekend getaway and summit personas. Their jobs now work end to end, but the screens they live in (campaign tabs, the plan page, the status board) are tidy rather than delightful, and a few brand pages set small titles in the serif. Those pages belong to the brand and Plans work running in parallel, so this loop left their look alone.

## Round 4 (loop 17: delight for the people who live in the tools)

Screens: `review17/round-4/before` and `review17/round-4/after`. Same seeded worlds, plus a game night tonight with a bracket, a hack night with a demo queue, a two-day summit with an agenda and a weekend away with a plan. Compared against Partiful's small moments of reward and Eventbrite's organizer reporting.

Only the six personas below 9 on delight are re-scored; everyone else was re-checked on their main path and holds at 9.

| Persona | Use | Joy | Ease | Intu | Pick | Notes (what moved) |
|---|---|---|---|---|---|---|
| Engineer | 9 | 8 | 9 | 9 | 9 | The app's Home jumped as five cards arrived one by one (CLS 0.28 for a signed-in guest at 390). Now they wait, laid out but hidden, and show together: CLS about 0.05. Brand pages load into skeletons sized like the page. Check-in answers the tap in under 5ms. Still 8: the invite planner's tap waits on the network. |
| Product designer | 9 | 8 | 9 | 9 | 9 | Small serif titles are gone from teams-intel.css and timeline.css. The report is now an issue, not a table. Still 8: the plan page and the slot cards (16px corners) are next. |
| Field marketer (brand) | 9 | 9 | 9 | 9 | 9 | Milestones stamp in once when they land ("First booking confirmed", "All hosts confirmed", "Report ready"), Home shows each campaign's latest one, meters fill once, tile numbers count up once, check-in stamps and fills an arrivals line, and the report reads like a one-page issue. |
| Game or hack night host | 9 | 8 | 9 | 9 | 9 | No change yet (round 5 and 6). |
| Weekend getaway host | 9 | 8 | 9 | 9 | 9 | No change yet (round 5). |
| Small summit host | 9 | 8 | 9 | 9 | 9 | Brand-side check-in and the report help a summit run by a brand. Still 8: the agenda page and its run of show (round 5). |

### Fixed in round 4

- **One feedback module, public/fx.js** (`window.PLFx`): the host loop's stamp, tick, check, haptic (through `EncoreNative.haptic`), sounds and confetti moved here, plus `ink()` (press an element down like a rubber stamp), `fill()` (a meter fills once a visit), `countUp()` (numbers count up once a visit) and `fresh()` (what's new since the last visit). public/hostloop.js reads it; every page that loads the host loop loads it first. Nothing moves with reduced motion.
- **Campaign milestones** under the campaign tiles: done ones are inked stamps, the rest wait in pencil with a hint ("4 of 5 hosts confirmed"). A milestone new since your last visit stamps in with a haptic; "Report ready" opens the report. Home shows each active campaign's latest milestone and the next one.
- **Check-in on the brand Run tab** answers the tap at once (the button, the count, an arrivals line, the stamp, a haptic), then saves, and puts it back if the save fails. The last guest in gets an "All here" stamp.
- **The report as a one-page issue** (`reportHtml` in server/campaigns.js): a "Field report" masthead with a double rule, a kicker with the company and cities, the headline, a one-line standfirst written only from the totals, three pull numbers set large, a lead quote in the serif (only from a guest who said yes to being quoted), numbered sections, goal bars that fill once and a "Goal met" stamp. Still no guest names or emails.
- **Brand pages** (Home, Campaigns, Insights) load into skeletons the size of the page, not "Loading…". Home's tiles count up once and its meters fill once; "Coming up" says "Tomorrow" or "In 3 days". Insights' fit scores count up once.
- **No small serif titles**: card, section and campaign titles in teams-intel.css and the timeline titles in timeline.css use the text face at 600 under 24px.
- **Run tab at 390**: grid columns no longer push the page sideways (`.ti-grid>*{min-width:0}`).
- **The app's Home settles once** (index.html): cards that arrive late (the streak card, guides, new replies, hosts you follow, near you, the playbook line) wait under the quick-start panel, laid out but hidden, until they stop arriving (2.6 seconds at most), then fade in together. The paste or calendar-file hint is drawn with the composer instead of 400ms later.

## Round 5

Screens: `review17/round-5/before` and `review17/round-5/after`. Driven as the weekend-away host and a guest who's in (the plan page), the summit host (the agenda), and the game night host on the day (the Status board and Check in).

| Persona | Use | Joy | Ease | Intu | Pick | Notes (what moved) |
|---|---|---|---|---|---|---|
| Engineer | 9 | 9 | 9 | 9 | 9 | Every check-in tap answers in under 5ms on both check-in screens and rolls back if the save fails. The Status board looks for new replies every 20 seconds, only while it's open and the page is in view. The plan page loads into a skeleton of itself. Zero crawl problems at 390 and 1280, no console warnings on the persona pages. |
| Product designer | 9 | 8 | 9 | 9 | 9 | The plan page is a notebook now, and "Here" is a stamp. Still 8: the slot cards on the invite keep 12 to 16px corners and pill buttons, off brand (round 6). |
| Field marketer (brand) | 9 | 9 | 9 | 9 | 9 | Holds. |
| Game or hack night host | 9 | 8 | 9 | 9 | 9 | Check-in feels good and the board counts up as replies land. Still 8: the bracket and demo queue are plain lists, and seeding is one button (round 6). |
| Weekend getaway host | 9 | 9 | 9 | 9 | 9 | The plan reads like a travel notebook: a big day number on each divider, "Tonight" and "Tomorrow morning" in the event's own time zone, Up next, a drawn map of the area, a packing list guests tick off, and the weekend laid out from one tap. |
| Small summit host | 9 | 8 | 9 | 9 | 9 | A summit run of show in one tap (doors and name tags, talks, breakouts, lunch, lightning talks, wrap), Up next on the day. Still 8: no printable agenda for the door (round 6). |

### Fixed in round 5

- **The plan page as a travel notebook** (public/plan.html): each day opens with a divider, its number set large ("02") and its name ("Tomorrow", "Saturday"); the day splits into morning, afternoon and evening, named for when they are in the event's own time zone ("Tonight", "This morning", "Tomorrow morning"). The next thing carries an "Up next" tag and what's passed goes soft. A line under the title says "Starts tomorrow at 4pm", "Starts in 2 days" or "Day 2 of 3". Each timed item now carries its start (`at`, from `itineraryDays` in server/plans.js).
- **A drawn map of the area** links to /map for the city. It's always the area, never a pinned door, and says the exact spot is on the invite for guests who are in.
- **Before you go**: the host's "bring" list as boxes a guest ticks (the ticks stay on that phone) and what's included. A trip with no list gets "A packing list to start from", which says it's only ideas, not the host's. The plan payload carries `bring` and `included`.
- **Thoughtful defaults for the host**: the editor folds away under "Edit the plan" once there's a plan, and an empty plan offers shapes to start from: "Weekend away", "Summit run of show" and "One evening", built from the event's own days and start time. Potto says the one true thing about it: "Start from a shape, then change what you like. I'll keep it in time order." (the server sorts by day and time).
- **The invite planner** (public/invite-plan.js): someone who replied before but hasn't come yet reads "First time", not "Replied, never came". The capacity meter fills once a visit. The Status board counts up on the first look and, as replies arrive, a changed column counts on from what it was with an ink underline. Check in answers the tap at once (the button turns into a "Here" stamp, the count ticks, a green arrivals line fills, a haptic in the app), then saves; when everyone's in, the "All here" stamp lands and Potto says "Everyone's here. I'll stop counting." The thank-you button waits until someone's checked in.
- **Planner fixes**: people added by email alone show their email instead of a blank name; the meter leads with who's in when nothing was sent yet ("8 in", not "0 invited").

## Round 6

Screens: `review17/round-6/before` and `review17/round-6/after`. Driven as the game night host (opt-ins, seeding, the bracket on the invite), a hack night guest (the demo queue) and the summit host (the agenda on paper), then every persona's main path again to check nothing else slipped.

| Persona | Use | Joy | Ease | Intu | Pick | Notes (what moved) |
|---|---|---|---|---|---|---|
| Engineer | 9 | 9 | 9 | 9 | 9 | Found and fixed a real bracket bug: an unplayed first-round match counted as a bye, so a top seed walked into the final. Taps on the invite's slots answer at once. Zero crawl problems at 390 and 1280. |
| Product designer | 9 | 9 | 9 | 9 | 9 | The slot cards, fields and buttons on the invite now use the 6px corners; the bracket's seats are small drawn tokens; the champion gets a stamp. The report, the plan page and the check-in screens hold together as one magazine. |
| Field marketer (brand) | 9 | 9 | 9 | 9 | 9 | Holds. |
| Game or hack night host | 9 | 9 | 9 | 9 | 9 | Three ways to seed (opt-in order, shuffled, or only who's checked in), "Top seeds get the byes" said plainly, a bracket guests watch fill seat by seat, a Champion stamp, "First up" on the demo queue and how long the slots run. |
| Weekend getaway host | 9 | 9 | 9 | 9 | 9 | Holds. |
| Small summit host | 9 | 9 | 9 | 9 | 9 | "Print the plan" lays the agenda out on one clean sheet for the door: the title, the dates and each day, nothing else. With the run-of-show shape, Up next, name tags and the stamped check-in, the day feels looked after. |

### Fixed in round 6

- **Bracket rounds** (`bracketRounds` in server/slots.js): a slot is a player, a bye (nobody will be there) or waiting on the match before it. Only a real bye moves a player on; the semis show "TBD" until the first round is played, and the champion only exists once the final is.
- **Seeding helpers**: the host's panel offers "Seed in opt-in order" (the default), "Shuffle seeds" (a fair shuffle) and "Seed who's here" (opt-ins who are checked in), with "Top seeds get the byes" under them. The seed action takes `order: "shuffle" | "here"`.
- **The bracket on the invite** before it's seeded: a row of seats that fill as people opt in ("2 seats left"), drawn as tokens; after the final, a "Champion" stamp.
- **The demo queue** says who's "First up" and "4 of 8 taken · 5 min each". Claiming a slot or opting in changes the button at once ("Saving", "Putting you in") and puts it back if the save fails.
- **Slots on brand**: 6px corners on the slot cards, fields, options, bracket matches, the host panel and the series card; buttons are 6px, not pills.
- **Summits**: "Print the plan" (for the host, and in the ... menu for anyone who can see the plan) prints the agenda on white with the buttons, map and editor left out.

### Where it ended

All fourteen personas are at 9 or higher on every score. The six that were at 8 on delight (engineer, designer, field marketer, game or hack night host, weekend getaway host, summit host) are at 9.

Potto speaks in two places added this loop, as docs/potto-voice.md asks: the empty plan editor ("Start from a shape, then change what you like. I'll keep it in time order.") and check-in when everyone's arrived ("Everyone's here. I'll stop counting.").

Left for later, none of them below 9: a real map tile behind the drawn area on the plan page (map.js loads MapLibre from a CDN, too heavy for a thumbnail); tracks or rooms on a summit agenda; the test world writes some past events straight into the store, so a host's studio asks `/api/signoff` about events the event index doesn't know and gets 404s (test data only, not a product path).

## Round 7 (review 18: every scale of hosting)

Screens: `event-kinds/` in the session scratchpad, at 390px (1280px for the summit host). The owner's brief: hosting spans "something very simple like dinner with friends and booking a reservation, to a big summit or a big trip or weekend getaway". Compared against Partiful (a dinner or a trip with friends: the invite, replies, a group chat, a rough plan) and Eventbrite and Luma (a summit: tiers, an agenda, speakers, check-in). Neither keeps a restaurant booking's count against the replies, and neither does beds, rides and shared costs for a trip.

| Persona | Use | Joy | Ease | Intu | Pick | Notes (what moved) |
|---|---|---|---|---|---|---|
| Dinner host who books a table | 9 | 9 | 9 | 9 | 9 | New: Book a table. The meter is one dot a seat, the ones over the booking in red, and "You're at 7 of 6. Call to add a seat?" in the bell, in Plans and on the plan page with Call and "Updated". A table for 6 is you and five spots, so more replies wait on the list. |
| Guest at a booked table | 9 | 9 | 9 | 9 | 9 | "Reply by Tuesday so I can update the booking" in highlighter on the invite; the booking link, confirmation and address once in; "$41.67 each" with the host's pay link after. |
| Weekend getaway host | 9 | 9 | 9 | 9 | 9 | Where we're staying, who sleeps where, rides, shared costs, the plan by day and the packing list on one page. Adding a cost is a label, a sum, who paid and who's in it. |
| Guest on a weekend away | 9 | 9 | 9 | 9 | 9 | "Take it" on a bed, "Take a seat" in a car, "You owe Maya $160" with a Pay button; never a line between two other people. |
| Small summit host (1280) | 9 | 9 | 9 | 9 | 9 | Agenda by day, time and track, rooms with capacity, room clashes, speakers with "Page not public", sponsors labelled, door tools, the run of show kept for the host and team, and "Add the agenda to the run of show". |
| Summit guest | 9 | 9 | 9 | 9 | 9 | Save to my agenda, "Room full", "Overlaps with Office hours", and each saved session on its own row in Plans with a calendar button. |

### Fixed in round 7

- **What are you planning?** (public/canvas.js `PLAN_KINDS`, `applyKind`): Dinner, Book a table, Game night, Class, Drop, Weekend away, Summit as the first question on a new event. Each fills only what's empty and opens its blocks: the booking, where we're staying, agenda and rooms; Drop hands over to the drop setup. A guide or path link can name the kind (`/?app=1&new=1&kind=weekend#studio`) and skips the "What are you making?" sheet.
- **server/kinds.js**: the booking (`reservation`), lodging, beds, cars and the costs ledger (`trip/<id>`), the agenda, speakers, sponsors and saved sessions (`agenda/<id>`). Pure parts are tested on their own: the meter, the reply-by line, even splits in exact cents, pairwise lines, bed and seat claims, capacity, overlaps, room clashes and speaker visibility.
- **Privacy**: the lodging address, the booking link and the confirmation reach only people who are in (and are scrubbed from the itinerary for anyone else); none of it is on the public event doc. Ledger lines only for the two people in them, the host included. No payments move: pay links only.
- **The invite** (public/planhook.js, also on /g): a short card for the kind. invite.html is unchanged.
- **/start** has Book a table; the host path has "Book a table for friends"; four new guides (book-a-table, teach-a-class, weekend-away, small-summit) and the path's weekend and summit nodes link to them.
- **Speaker pages** at `/speakers/<event>/<speaker>`, public only when the speaker said yes or the host marked them public.

### Left for later

- The meter can't see a restaurant's own system: "Updated" is the host saying they called.
- Session capacity is first come, first saved; there's no waitlist per session yet.
- Sponsor logos are links the brand gives the host; there's no upload in the sponsors editor.

## Round 17 (nine reviewers, one honest loop)

Screens: `round17/before` and `round17/after` in the session scratchpad, plus `round17/walk` for each step of each journey. Driven in a real browser at 390px and 1280px on a seeded world: the demo hosts (run crew, supper club and pandan cake, apartment café, flower studio, bánh mì cart), the Fernwood Labs brand world (9 bookable hosts, 8 bookings, 3 campaigns, 120 guests), and a new casual host made by walking /start to sign-up to a link. Every page was also run through an audit script: console errors, failed requests, sideways scroll, tap targets under 44px at 390, the serif under 24px, text under 12px, dark patches, layout shift and its sources.

Compared against: Partiful (the invite, the reply and the group feel), Luma (a clean event page and calendar), Eventbrite (tickets and organiser tools). None of them keeps the home address back until you're in while still naming the neighbourhood, takes a cake order with a pickup slot on the same link, or shows a brand what money is at risk by date.

| Reviewer | Use | Joy | Ease | Intu | Pick | What moved (before → after) |
|---|---|---|---|---|---|---|
| Casual event attendee | 7 → 9 | 8 → 8 | 8 → 9 | 8 → 9 | 7 → 8 | Before: a dinner at "My place, Greenpoint" showed no place at all, not even "address when you're in", and the host's line for guests never appeared. Now the invite says Greenpoint, that the address comes once you're in, and the host's line. Reply (a double tap makes one reply), calendar, the address after the yes, Invite friends, Plans signed out, and offline ("Didn't send. Check your connection") all hold. |
| Casual event host | 6 → 9 | 8 → 9 | 6 → 9 | 7 → 8 | 6 → 8 | Before: /start promised "Everything you typed comes with you", then sign-up dropped the host on the feed with no link. Now it lands on "Your first one is out in the world" with the link (8 seconds scripted, well under 3 minutes by hand). The event sits right under the composer on Home, not three screens down. Back closes the editor. |
| Experience host | 8 → 9 | 8 → 8 | 8 → 8 | 7 → 8 | 8 → 8 | A drop took four orders end to end (stock, pickup slot, order number, the address after ordering). Fixed: the address is still there when the buyer comes back, no "I'm in" bar after an order, the Home card reads "Open for orders · 4 orders" with no "No date yet" nags. A brand request arrives as "Needs you" with the brief, Accept, Suggest a change, Decline. |
| Field marketer | 9 → 9 | 9 → 9 | 9 → 9 | 8 → 9 | 9 → 9 | Quick book to a sent request in three taps (a double tap makes one request). When the host cancels: "Your host cancelled", refund or credit, a note to guests. Fixed: a cancelled booking no longer says "$1,080 still due" and "the date is open"; the signed-out page has a way on when a city has no hosts. |
| Brand | 9 → 9 | 9 → 9 | 9 → 9 | 8 → 9 | 9 → 9 | Home, campaigns, the report, insights and company settings hold from rounds 1 to 3 of the brand loop. The signed-out /teams page now matches them (notebook surfaces, 6px corners, no emoji). |
| Engineer | 7 → 8 | 7 → 8 | 8 → 9 | 8 → 9 | 7 → 8 | Fixed: Back with the editor open left the editor floating over Home; a 404 on every editor open; Home jumped 350px when "Needs you" arrived (CLS 0.40 → 0.03) and 180px when the Discover nudge arrived (0.28 → 0.02); the full invite slid right on wide screens (0.19 → 0.01). Still 8: see below. |
| Product designer | 7 → 8 | 8 → 8 | 8 → 9 | 8 → 9 | 7 → 8 | Fixed: 20px serif section heads on host pages, Discover cards and the map; 10 and 11px text on the map; three column widths on desktop Home; emoji and white cards on /teams; "Bo's is hosting". Still 8: see below. |
| UX/UI designer | 7 → 8 | 8 → 8 | 7 → 8 | 8 → 9 | 7 → 8 | Fixed: about 40 controls under 44px at 390 (invite tools and tick rows, host bar, Plans, Inbox, Saved, People, /start, About, the map, the editor, report links). Still 8: see below. |
| Product manager | 7 → 9 | 8 → 8 | 7 → 9 | 7 → 8 | 7 → 8 | The two dead ends are gone (sign-up from /start, a city with no hosts on /teams), each surface walked has one next step, and nothing walked promises what it doesn't do. Still 8: Home carries three nudge cards under the events. |

### Fixed in round 17

- **/start to a link** (public/start.html, server/signin.js): the sign-up link passes a real path, and a new account that was headed somewhere lands there, not on the welcome screen. Tested in test/signin.test.js.
- **The invite says where** (server/app.js `publicEvent`, public/invite.html): a home is still never shown, but "My place, Greenpoint" keeps Greenpoint as the area, and an invite with a hidden address always says "Address when you're in". "A line for guests" from /start is saved as the public line (`why`). invite.html is 38,332 characters.
- **Back closes the editor** (public/canvas.js): the editor is a history step. Back closes it, asks first when there are unsaved changes, and closes that sheet on the next Back.
- **Home** (index.html): what you're hosting sits under the composer, with "Needs you" and the Discover nudge above it, all in the zone that waits and fades in together, so nothing jumps. One centred column on wide screens. A drop's card reads "Open for orders" with its order count, and an always-open drop gets no date, time or meeting-point to-dos.
- **Drops** (public/replybar.js, public/invite-order.js): the reply bar goes away once an order is in; the pickup address is asked for again with the order's own code when the buyer returns.
- **The full invite** (/g): room for the side menu from the first paint on wide screens, a top heading for screen readers, 44px tools and tick rows, "Bo is hosting".
- **Type and targets**: host page section heads sit at 24px so a host's kit can set them in the serif; Discover and map card titles use the text face; nothing under 12px on the map; 44px across the surfaces listed above.
- **Words**: the follow button no longer says "unlock".
- **Brands**: /teams signed out on the brand kit; a cancelled or declined booking drops the stale money panel.

### Still under 9, and why

Code can fix these; this round ran out of room:

- **Engineer**: a host page with badges and a track record still shifts on a wide screen while they arrive (CLS about 0.3 at 1280 on /@long-table, 0 at 390); /teams/discover signed out shifts once at 100ms at 1280 (0.35) when its header lands; the app and /start have more than one h1.
- **Designers**: the event editor's Save is an ink pill and its dock a pill, where the kit says 6px ink-blue buttons; Home and the host event view still use 16 to 24px card corners; the menu card on a supper club invite is plum with coloured dots; a host page with no cover prints the host's name on the banner and again under it; the feed's Follow (40px) and dismiss (36px) buttons live in public/feedvisual.js, which another change owns right now; settings switches are 48 by 28; brand Insights chips are 32px; the contact tick boxes are 20px.
- **Product manager and hosts**: Home still shows three nudge cards (next step, monthly, Potto's list) and "warmth" needs a plain word; the idea chips under the composer lead with hack nights for a dinner host; a drop's "Open the full invite" leads to an event-style page.
- **Sign in** (left alone as asked): the sign-in page has 8 h1 elements, most hidden.

Needs something code can't give:

- **Delight for a guest** ("I'd pick this over Partiful"): a cold guest sees one host and no faces. It needs real hosts, photos and friends on the platform; comments and kudos on the feed are being built now.
- **Paid seats**: money moves through the host's own pay link. A real checkout needs a payments account and an owner decision.
- **The app**: push, haptics and Add to Home Screen were not tested; they need the native build.
- **An owner decision**: with the Standard policy the money at risk reads $165, then $660 on day 7, then $330, because the balance is due that day and half comes back. It is exact, and it reads oddly.

### Not walked this round

Rewards and the fan club beyond its first card, the after-event flow (kudos, photos, recap), campaigns and insights beyond loading them and reading them, check-in, and anything behind sign-in with Apple, Google or a passkey. Their scores above lean on earlier rounds.
