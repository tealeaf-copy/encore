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
