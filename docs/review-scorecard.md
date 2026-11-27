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
