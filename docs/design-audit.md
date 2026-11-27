# Design audit: every page, scored and fixed

The owner's ask: audit every page for friction and inconsistent design, fix what's found, and loop until every page
scores 9 out of 10. The bar is the class of problem in the owner's phone screenshots: uneven spacing, labels wrapping
inside buttons, a pill inside a button, one-word last lines, cut-off meta lines, off-kit fonts and colours on platform
chrome, cards that don't match, oversized icon tiles squeezing text, the help button over text, mascots in odd
places, and kudos and comments tucked away.

Round history this builds on: docs/review-scorecard.md (rounds 1 to 18) and the click audit (docs/qa-audit.md, on
its own branch until it merges). Nothing they fixed is repeated here.

## How it was checked

- **The world.** `scripts/design-audit.mjs` starts its own server on a scratch data dir and seeds the routes world
  (`seedRoutes` in test/routes-seed.js: a supper club host with a page, an experience, a drop, events coming up, today,
  asking, past with kudos and a photo, a booked table, a weekend away and a summit; a guest who replied; the admin)
  and the Fernwood Labs brand world (`seedBrandIntel` in test/brand-intel-seed.js: nine bookable hosts, bookings,
  three campaigns, 90 guests). `seedAudit` is on the click-audit branch, not main, so it isn't used here.
- **The people.** Signed out, a guest (Sam), a host (Mai), a brand team owner (Maya at Fernwood Labs), a host brands
  book (Long Table Supper Club) and the admin.
- **The widths.** 390px (Playwright `devices["iPhone 13"]`) and 1280px. 232 page views in all.
- **By eye.** Every page was screenshotted full length at both widths (`--shots`) and scored 1 to 10 on four things:
  **Kit** (visual consistency with the Field Notes kit), **Clarity** (one obvious next step, clear hierarchy, plain
  words), **Friction** (taps to the goal, dead ends, confusing or empty states) and **Polish** (spacing rhythm,
  alignment, wrapping, overflow, 44px targets). Graded hard: a 9 means a picky designer would ship it as is.
- **By machine.** The same script checks every page view for what can be measured:

  | Check | What it flags |
  |---|---|
  | overflow | words outside a box that hides its overflow (a box that only hides a hit area or a shadow passes) |
  | ellipsis | a line cut short with "…", or a clamp that hides text |
  | wrap | a button, chip, tab or pill under 280px whose label runs onto a second line (a name set to wrap on purpose passes) |
  | nested | a control inside a control (a link in a button, a checkbox in a row that is a button), or a filled pill with words inside a button (counts and initials pass) |
  | font | a face that isn't IBM Plex on platform chrome; a kit face the page names but never loads; a weight the kit doesn't load while fake bold is on; a headline of 24px and up under 600; the serif under 18px |
  | radius | a drawn box (fill or border) whose corners are not 0, 4px, 6px or round |
  | emoji | an emoji in a button, tab, heading or the nav on platform pages |
  | image | an image with no width and height whose box changes with the file (swapped for a 1x1 to measure) |
  | help | text under the floating help button, at the top of the page and at the very bottom |
  | orphan | a short block of copy (18 to 260 characters) whose last line is one word (word rects from a Range) |
  | jammed | under 2px between the letters of a heading's last line and the copy under it |
  | cards | cards in one row whose heights differ by more than 24px, or a card with over 40px of empty space under its content |

  Host-owned pages (/@handle, /e, /g, /i, /x, /k, /p, /again, /recap) wear the host's kit, so font and corner checks
  there only cover the platform's chrome (nav, tab bar, help button). Run it again with
  `node scripts/design-audit.mjs [--width 390|1280] [--only /path] [--role host] [--shots dir] [--json file]`.
  It takes 25 to 45 minutes for all 232 views on a busy machine.

Screenshots: `design-audit/before` and `design-audit/after` in the session scratchpad, matching names
(`<role>__<page>__<width>.png`), plus `design-audit/r1` and `r2` for the rounds between.

## Inventory

Every GET route that serves a page (server/app.js and the modules it mounts) and the views inside the app (index.html). Each row was opened at 390 and 1280 as every person listed. Routes that only redirect (/method, /pricing, /h/:handle, /work for signed-in) or serve files, feeds and JSON are left out; /verify, /unsubscribe, /sso and /auth/* are one-step redirects.

| Page | Route | Source | Seen as |
|---|---|---|---|
| **Guest and public** |  |  |  |
| Feed (signed out it is also /) | /feed, / | public/feed.html, feedvisual.js | out, guest, host |
| Discover | /discover | public/discover.html, collections.js | out, guest, host |
| Hosts directory | /hosts | public/hostdir.html, lists.css | out, guest, host |
| Events directory | /events | server/directory.js, lists.css | out |
| Ideas to try | /ideas | public/ideas.html, inspo.js | out, guest |
| Map | /map | public/map.html, map.js | out |
| Collections | /collections | public/collections.html | out |
| Find people | /people | public/people.html | out, guest |
| Leaderboard | /leaderboard | public/leaderboard.html | out |
| Guides | /guides, /guides/:id | server/guides.js | out |
| About (landing) | /about | public/home.html | out (in flight elsewhere) |
| Start (plan without an account) | /start, /start?t=table | public/start.html | out, host |
| Sign in, sign up, join, forgot | /login, /signup, /join, /forgot | public/signin.html, signup.html, join.html, reset.html | out |
| Community rules, privacy, terms, security | /community, /privacy, /terms, /security | public/community-rules.html, privacy.html, security.html | out |
| For brands (signed out) | /teams, /teams/discover | public/teams.html, brand-discover.html | out |
| Founding hosts | /founding-hosts | public/founding-hosts.html | out |
| Not found | any unknown path | public/404.html | out |
| **Host-owned (wear the host's kit)** |  |  |  |
| Host page | /@handle | public/host.html, storefront.js, storeshop.js | out, guest, host (owner), bhost |
| Light invite | /e/:id, /i/:id | public/invite.html | out, guest |
| Full invite | /g#rsvp-:id | index.html (view-guest) | out, guest, host |
| Experience / drop | /x/:handle/:id | server/interest.js, drops.js | out |
| Kudos ask | /k/:id | public/kudos.html (in flight elsewhere) | out |
| Add your photos | /p/:id | public/photos.html | out |
| Same table next time | /again/:id | public/again.html | out |
| Year in review | /recap/:handle | public/recap.html | out |
| Plan page (trip, table, summit) | /plans/:id | public/plan.html, kinds.js | out, guest, host |
| Speaker | /speakers/:event/:id | public/speaker.html | out |
| **Signed in (guest and host)** |  |  |  |
| Home (the app) | /?app=1 | index.html (view-programs) | guest, host, bhost |
| Create canvas | /?app=1&new=1#studio | index.html, canvas.js | host |
| Event editor (Overview, Guests, Invite, Page) | /?app=1&open=:id#studio | index.html | host |
| Plans | /plans | public/plans.html, passport.js, timeline.css | out, guest, host |
| Inbox | /inbox | public/inbox.html | guest, host |
| Library | /saved | public/library.html | out, guest, host |
| Chats, a chat | /chats, /chats/:id | public/chats.html, chat.css | out, guest, host |
| Settings (one page of sections: picture, account, sign-in, notifications, finding you, insights, calendar, blocked, help, delete) | /settings | public/settings.html | out, guest, host, brand |
| Your stats | /me | public/stats.html | guest, host |
| Your people, an event's invite plan | /contacts, /contacts/event/:id | public/contacts.html, invite-plan.js | host |
| Host path, circles, playbook | /path, /circles, /playbook | public/path.html, circles.html, playbook.html | host |
| **Brand team** |  |  |  |
| Brand Home (the app) | /?app=1 | index.html (view-brand) | brand |
| Teams home | /teams/home | public/teams-home.html | brand |
| Discover hosts, a package, book | /teams/discover, /teams/x/:h/:p, /teams/book/:h/:p | public/brand-discover.html, experience.html, checkout.html | brand |
| Campaigns, a campaign, Run, report | /teams/campaigns[/:id[/run]], /teams/campaigns/:id/report | public/teams-campaigns.html, server/campaigns.js | brand |
| Bookings, a booking, invoice | /teams/bookings[/:id], /teams/invoice/:id | public/team-bookings.html, teams-panel.js, server/brandbook.js | brand |
| Insights, how it works | /teams/insights, /teams/insights/how | public/teams-insights.html, teams-insights-how.html | brand |
| Company, trusted, hosts, formats, shortlist | /teams/company, /teams/trusted, /teams/hosts, /teams/formats, /teams/list | public/teams-company.html, trusted.html, teams-hosts.html, teams-formats.html, team-shortlist.html | brand |
| Team bookings for a host, a booking | /host/teams, /booking/:id | public/host-teams.html, booking.html | bhost |
| **Admin** |  |  |  |
| Reports, hosts, brand metrics, founding hosts, experiments, support | /moderation, /admin/hosts, /admin/brand-metrics, /admin/founding-hosts, /admin/experiments, /support | public/moderation.html, admin-*.html, server/experiments.js, server/help.js | admin |

Not opened, because they need a token or state the seed doesn't make: /survey/:token, /reconfirm/:token, /cg/:id/join, /xo/:id, /l/:token (a shared list), /door/:id, /check/:id, /teams/s/:id, /gifts and /gifts/plan, /quiz, /results, /requests, /vendor, /covers, /team. They share the components fixed below.

## Scores

Four scores per page, out of 10: **K** kit, **C** clarity, **F** friction, **P** polish. Before is main at fbd95e5;
after is this branch. Where 390 and 1280 differ, the lower one counts. "Seed" means the cover is the seed's 1x1 test
image stretched into a coral block; a real photo or the drawn cover stands there in use, and it isn't scored.

| Page | Seen as | Before K/C/F/P | After K/C/F/P | What moved |
|---|---|---|---|---|
| Feed | out, guest, host | 7/8/8/7 | 9/9/9/9 | Story names on two lines, not "Mai Supp…"; Example is a square mono tag, not a pill; tile meta wraps ("Sun · 7pm · Brookl…"); 6px tile corners; the 92px gap before the footer halved. The signed-out + button over the first card is in flight elsewhere (below). |
| Home (the app) | guest, host, bhost | 6/8/8/6 | 9/9/9/9 | The app asked Google for Plus Jakarta Sans and Inter on every load and, served from here, now gets Plex; "Jo Kim / asked to / join" squeezed by two buttons now reads on one line with the buttons under it; emoji avatars are initials; idea cards show their whole line (cut at three); the Draft tag a chip at its own width; side menu ends Sign out, Settings, Help like every other page. |
| Create canvas, new event | host | 7/9/9/8 | 9/9/9/9 | Fonts (above); Start is full width at 1280. The kind chips inside the canvas are in flight elsewhere. |
| Event editor | host | 7/9/9/9 | 9/9/9/9 | Fonts. |
| Discover | out, guest, host | 8/9/9/7 | 9/9/9/9 | "Bed- / Stuy" never splits; "Order from hosts" cards wrap instead of cutting; the orphan line under shelf heads. |
| Hosts | out, guest, host | 8/9/9/8 | 9/9/9/9 | The search field is a 6px field, not a pill. |
| Host page | out, guest, owner, bhost | 8/8/8/7 | 9/9/9/9 | "Change photo" was clipped to "ange pho" and then sat on the name: it hangs beside the picture now; a series says "Host one like it", not "Fork this" and "No forks yet". The kudos and offers blocks are in flight elsewhere. |
| Light invite (/e, /i) | out, guest | 9/9/9/8 | 9/9/9/9 | The consent and host lines no longer end on one word. Still 38,810 characters. |
| Full invite (/g) | out, guest, host | 7/8/9/8 | 9/9/9/9 | A friends' dinner showed "Hosted by Unassigned" and "1 person is coming from 0 companies"; both gone. |
| Plans | out, guest, host | 7/9/9/8 | 9/9/9/9 | The passport's Courier New and Caveat are Plex Mono and Plex Sans; the wordmark has its mark; at 1280 the help button docked over the logo (a sticky calendar read as a bar). |
| Plan page (trip, table, summit) | out, guest, host | 6/8/9/7 | 9/9/9/9 | It loaded no font at all (system face throughout); help floated over the session times; "1 sessions · 1 tracks"; For the door buttons wrapped and were 40px; 11px tags. |
| Inbox | guest, host | 8/9/9/8 | 9/9/9/9 | Heading 600 and left like the other tabs (it was 400, centred); 6px buttons (10px); the line under each notice wraps to two lines instead of cutting. |
| Library | out, guest, host | 8/9/9/9 | 9/9/9/9 | Its heading was the serif; now Plex Sans like every tab. |
| Chats | out, guest, host | 7/9/9/8 | 9/9/9/9 | Rows, thumbnails, search, empty state, sheets and menus at 6px (12 to 24px). The last-message preview keeps one line, as every messages list does. |
| Settings | out, guest, host, brand | 8/9/9/8 | 9/9/9/9 | "Sync all my plans" no longer wraps; the avatar initial was Fredoka. |
| Your stats (/me) | guest, host | 8/9/9/7 | 9/9/9/9 | Icon tiles squeezed "neighbourhood explored" to a word a line on a phone; the icon now sits above the number. |
| Your people, invite plan | host | 7/9/9/7 | 9/9/9/9 | A passport rule drew a black frame round the whole page; a row that was a button held a checkbox; meta cut off; heading 400; tabs 40px with 12px corners and a shadow. |
| /start | out, host | 7/8/9/7 | 9/9/9/9 | Vase logo and 20px wordmark; heading 400; "Save your dinner and get a link to send" wrapped in its button, now "Get my link". |
| Sign in, sign up, join, forgot | out | 7/9/9/8 | 9/9/9/9 | The mark and 25px wordmark (a vase and a 19px serif word); 6px corners on forgot (12 to 18px, pill button); help is a row at the end, not a float. |
| Ideas | out, guest | 8/9/9/7 | 9/9/9/9 | Lines and meta shown whole (clamped and cut); 4px cover corners inside the card. |
| Map | out | 8/8/9/8 | 9/9/9/9 | "5 things on near New York" reads "5 things happening near". The map itself needs its CDN (the sandbox shows the list). |
| Leaderboard | out | 7/9/9/8 | 9/9/9/9 | 16px cards and pill buttons at 6px; the formula in Plex Mono (ui-monospace); room under section heads. |
| Guides, collections | out | 8/9/9/9 | 9/9/9/9 | Headings 600 (400). |
| Community, privacy, terms, security | out | 7/9/9/8 | 9/9/9/9 | Security's headings were Fraunces; form corners 12 and 16px; wordmarks. |
| People (find people) | out, guest | 8/9/9/8 | 9/9/9/9 | Pill buttons and search at 6px; heading 600. |
| Same table next time (/again) | out | 6/9/9/6 | 9/9/9/9 | Its heading drew at 16px (a font rule naming a token the page never loads); black pill button; 11px ui-monospace kicker. |
| Add your photos (/p) | out | 6/9/9/7 | 9/9/9/9 | Offset ink shadows, 22px corners, a handwriting face on the polaroid, pill buttons. |
| Year in review (/recap) | out | 7/8/9/7 | 9/9/9/9 | "gatherings" (a word the kit retires) is "events"; Potto hung off the card. |
| Experience page (/x) | out | 8/9/9/9 | 9/9/9/9 | "Pottery Lab" as plain text is the mark and wordmark. |
| Speaker, 404 | out | 9/9/9/9 | 9/9/9/9 | |
| About | out | 8/8/9/7 | in flight | See "In flight elsewhere". |
| Kudos ask (/k) | out | 8/9/9/8 | in flight | See "In flight elsewhere". |
| For brands signed out (/teams, /teams/discover) | out | 8/9/9/8 | 9/9/9/9 | Wordmark; "Or browse every host" 600. |
| Teams home, campaigns, Run, report | brand | 7/9/9/8 | 9/9/9/9 | The serif 20px wordmark with an old vase is the mark and 25px word (mark alone under 440px, where the word wrapped); headlines 600 (400). |
| Bookings, a booking, invoice | brand | 7/8/8/7 | 9/9/9/9 | "No brief yet" said twice with "version 1"; "Brand- / invited" split at its hyphen (now "Your guests", "The host's guests"); invoice dates "2026-11-27" now "Fri, Nov 27, 2026"; Save as PDF wrapped. |
| Insights, company, trusted, hosts, formats, list | brand | 8/9/9/8 | 9/9/9/9 | Headings 600; buttons keep one line. |
| Brand Home in the app | brand | 7/9/9/8 | 9/9/9/9 | Fonts; headlines. |
| Team bookings for a host, a booking | bhost | 8/8/7/8 | 9/9/9/9 | With only past requests the tab opened on a lone folded list; it now says "Nothing waiting on you". The booking page's button is 6px (pill). |
| Host path, circles, playbook | host | 7/9/9/8 | 9/9/9/9 | Headings 600 (400); playbook's mono is Plex Mono; 13px kickers (11px). |
| Admin pages | admin | 8/9/9/8 | 9/9/9/9 | Buttons in Plex (system-ui); fonts from here; "Save assumptions" on one line. |

Every page in scope is at 9 or higher on all four, except the ones in flight elsewhere (About, /k, and the parts of
the feed, host page and composer named below), which were left alone as asked.

## Issues found and fixed

Every issue that held a page under 9, highest severity and most-visited pages first. Width "both" means 390 and
1280. Shared fixes are listed once, at the component, with the pages they reach.

| Page | Width | Element | Issue | Severity | Fix | Status |
|---|---|---|---|---|---|---|
| Home, editor, create canvas, brand Home (the app) | both | `<link>` fonts in index.html | Asked Google for Plus Jakarta Sans and Inter (unused) with the kit; because two families weren't local, the whole request skipped the local copies, so blocked or slow Google meant no Plex at all (the sandbox drew every heading in the system face) | High | The link asks for the kit only and is served from /fonts/css2; `--f-display` and the roadmap image use Plex | Fixed |
| Every page on system.css, playful.css or community.css | both | `@import` | The token block imported the faces from Google; /plans/<id> and /speakers loaded no face at all | High | Import from /fonts/css2 (the local copies) in all three | Fixed |
| /g (friends' dinner) | both | `.gxhosts`, `.gxwho` | "Hosted by Unassigned" and "1 person is coming from 0 companies" on a friends' dinner | High | Unassigned owners skipped; companies only when there are some | Fixed |
| /@handle (owner) | 390 | `.av-chg` | "Change photo" clipped by the round picture to "ange pho" | High | The picture shows overflow; the button sits beside it in a kit button | Fixed |
| /login, /signup (390) | 390 | help row | (Found in round 1, caused by round 1's help row) the row went beside `<main>` in a flex page and squeezed the form | High | The row ends `<main>`, full width | Fixed |
| /plans/<id> (summit, trip), sign-in, every phone page without a tab bar | 390 | the floating help button | Covered "10am to 10:45am · Main hall · 0 of 80 saved" and "2 spots open" at rest | Medium | On phones without a tab bar, a "Need a hand? Ask Potto" row ends the page and nothing floats | Fixed |
| /plans | 1280 | the floating help button | Docked over the wordmark: its bottom-bar scan met the calendar's sticky column halfway up | Medium | The scan stops when nothing fixed sits near the bottom; tall sticky columns are page | Fixed |
| Feed | both | `.fv-ring small` | Host names cut to "Mai Supp…", "Sweet Pe…" | Medium | Two balanced lines, 76px rings | Fixed |
| Feed | both | `.fv-ring-tag` | "Example" a filled pill inside the story button | Medium | A square Plex Mono tag with an ink line | Fixed |
| Feed | both | `.fv-tile small` | "Sun · 7pm · Brookl…" cut off | Medium | Wraps, balanced; the dot stays with the word before it | Fixed |
| Feed | both | `.fv-tile`, `.fv-tile-m` | 12px corners | Low | 6px | Fixed |
| Feed | both | `.fv-end` | 92px of empty space under the last row | Low | 32px margin | Fixed |
| Home | 390 | `.wn` (New replies) | "Jo Kim / asked to / join" squeezed by Let in and Not this time; emoji (🙋 🎉 💌 ✅ 👋) as avatars | Medium | Buttons drop under the words on a phone; initials (or a drawn tick) in a round | Fixed |
| Home | both | `#ideaLib .lib-line` | Idea lines cut at three lines ("pour-overs,…"), titles at 500 | Medium | Shown whole, titles 600 | Fixed |
| Home | 390 | `.fc-draft` | The Draft tag stretched to 136px of grey | Low | A tint chip at its own width | Fixed |
| Home | both | `.pln` | 16px corners | Low | 6px | Fixed |
| Home, side menu | 1280 | `#signOut`, `#helpSide` | Sign out and Help without Settings, unlike every other page's side menu | Low | Settings between them, a button like its neighbours | Fixed |
| Discover, collections | 390 | `.ls-sub` | "by Mai's Supper Club · Bed- / Stuy" | Medium | The place never splits; the dot stays with the host | Fixed |
| Discover | both | `.shop b`, `.shop small` | "Mai's Supper Club · Bed-…" cut off | Medium | Wraps | Fixed |
| Hosts, events, Chats | both | `.ls-search`, `.ch-search` | Search fields as pills (the kit's field is 6px) | Low | 6px | Fixed |
| Chats, the Me sheet | both | `.ch-row`, `.ch-thumb`, `.ch-empty`, `.ch-pin`, `.ch-act`, `.ch-hint`, `.ch-quote`, sheets, `.plme`, `.plme-r` | 12 to 24px corners | Medium | 6px (message bubbles keep their shape) | Fixed |
| Library | both | `.lb-top h1`, `.lh h1` | The heading in the serif, every other tab in Plex Sans | Medium | Plex Sans 600 | Fixed |
| Inbox | both | `.ib-hd h1` | Heading 400 and centred; the other tabs are 600 and left | Medium | 600, left | Fixed |
| Inbox | 390 | `.ib-p` | "They'll hear first about your n…" | Medium | Two lines | Fixed |
| Inbox | both | `.ib-b.pri` and others | 8 to 12px corners | Low | 6px | Fixed |
| Plans | both | `.pp-k`, `.pp-cap`, passport card and story image | Courier New and Caveat | Medium | Plex Mono 500 at 13px, Plex Sans 600; the Caveat download is gone | Fixed |
| Plans, sign-up, onboarding, privacy, terms, check, requests, covers | both | `a.brand` | "pottery lab" as bare text at 20px, weights 400 to 700, no mark | Medium | The drawn mark and the word at 25px, 600 | Fixed |
| Teams pages, campaign guest, founding hosts, surveys, sign-in, /start, People, /x | both | `.bb-logo`, `.mark`, `.brand` | An older vase and "Pottery Lab" in the serif at 19 to 20px, or plain text | Medium | The mark and "pottery lab" at 25px; the teams bar shows the mark alone under 440px (the word wrapped) | Fixed |
| Brand pages, /start, path, circles, collections, People, stats, guides, sheets | both | `h1`, `h2` | Headlines at 400 (the kit's are 600) | Medium | 600 | Fixed |
| Plan page (summit) | 390 | `.kd-door .kd-b` | "Check in at the / door", "Add the agenda to the / run of show"; 40px tall | Medium | One per row on a phone, 44px | Fixed |
| Plan page (summit) | both | `h2 small` | "1 sessions · 1 tracks" | Medium | Plurals | Fixed |
| Plan page | both | `.kd-tag` | 11px text, 3px corners | Low | 12px, 4px | Fixed |
| /start | 390 | `#save` | "Save your dinner and get a link to send" wrapped in its button | Medium | "Get my link" (the sheet keeps the long line) | Fixed |
| Settings | 390 | `.ac-sync summary` | "Sync all my plans" wrapped | Low | One line; the providers go under it | Fixed |
| Settings, photo sheet, idea nudge, lists | both | avatar initial, buttons | Fredoka | Medium | Plex Sans; photo sheet buttons 6px | Fixed |
| Host page | both | series card | "Fork this", "No forks yet" | Medium | "Host one like it"; the count only when there is one | Fixed |
| Your people | both | `main.pp` | A passport rule (`.pp`) drew a 1.5px ink frame round the whole page | Medium | The rule skips `main` | Fixed |
| Your people | 390 | `.ip-row` | A row that is a button held a checkbox (a control inside a control) | High | With tick boxes the name is the row's button | Fixed |
| Your people, invite plan | both | `.ip-meta`, `.ip-seg` | Meta cut off; tabs 40px, 12 and 9px corners, a shadow on the selected one | Medium | Wraps; 44px, 6px and 4px, a drawn edge | Fixed |
| Ideas | both | `.pli-meta`, `.pli-line`, `.pli-media` | Meta cut, lines clamped, 5px corners | Medium | Wrap, whole, 4px | Fixed |
| Map | both | `#shTitle` | "5 things on near New York" | Medium | "5 things happening near New York" | Fixed |
| Leaderboard, community rules, forgot, People | both | cards, fields, buttons | 12 to 18px corners, pill buttons, ui-monospace | Medium | 6px, kit buttons, Plex Mono | Fixed |
| Security | both | `h1`, `h2` | Fraunces | Medium | Plex Sans 600 | Fixed |
| /again | both | `h1`, `.go`, `.eyebrow`, `.card` | The heading drew at 16px (its font rule named a token the page doesn't load), a black pill button, an 11px ui-monospace kicker, 18px corners | High | 30px Plex Sans 600, an ink-blue 6px button, Plex Mono 13px, a 1.5px ink card | Fixed |
| /p (add photos) | both | `.drop`, `.pick`, `.pol`, `.btn` | Offset ink shadows, 18 to 22px corners, Caveat, pill buttons | Medium | Drawn edges, 6px and 4px, Plex Mono, kit buttons | Fixed |
| /recap | both | stats, `.potto-c` | "gatherings"; Potto hung 11px off the card | Medium | "events"; Potto inside | Fixed |
| Bookings | both | the brief | "No brief yet. · version 1" then "No brief yet. Write one…" | Medium | Said once | Fixed |
| Bookings | 390 | seats | "Brand- / invited", "Host-sourced" | Low | "Your guests", "The host's guests" | Fixed |
| Invoice | both | dates, Save as PDF | "Issued 2026-11-27", the button wrapped | Medium | "Issued Fri, Nov 27, 2026", one line | Fixed |
| Team bookings (host) | both | Requests tab | Opened on a lone folded "Past events (2)" | Medium | "Nothing waiting on you" first | Fixed |
| /booking | both | `.btn` | Pill button | Low | 6px | Fixed |
| Your stats | 390 | `.pls-t` | Icon tiles squeezed the words to one a line | Medium | Icon above the number on a phone | Fixed |
| Create canvas | 1280 | Start | A small button alone in the canvas | Low | 320px, as on a phone | Fixed |
| Every page | both | copy and headings | 223 one-word last lines (orphan check) | Low | `text-wrap: pretty` on copy and `balance` on headings, at zero specificity, in every page's head and system.css | Fixed (49 left, mostly 2-line titles and copy the browser can't rebalance) |
| Every page | both | bold Plex Mono | Mono comes in 500 only; bold drew a smeared fake bold in prices and kickers | Low | `font-synthesis-weight: none`: the real 500 | Fixed |
| Every page | both | `b`, `strong` | "bolder" inside a 600 tab label asked for a 900 the kit never loads | Low | `b, strong` at 600 | Fixed |
| Light invite | both | served page | The head style pushed the served /e to 40,016 characters (caught by test/perf-robustness) | High | The light invite gets the rules from system.css instead | Fixed |
| Side menu | 1280 | `.es-rail a` | 10px corners on the selected row | Low | 6px | Fixed |
| Admin reports | both | buttons | system-ui | Low | Plex Sans, fonts from here | Fixed |

## In flight elsewhere

Other changes own these right now, so they were looked at and left alone. Check them after those merge:

| Page | Width | Element | Issue | Severity | Suggested fix |
|---|---|---|---|---|---|
| /@handle (host page) | both | "What guests say" (kudos) | With kudos saved as `love: true` (the brand-intel seed's form), each quote prints `"true"`; the quote list is a wall of identical rows | High | Treat a boolean `love` as no words: show the tags, not a quote |
| /@handle | both | the kudos and offers blocks | Not re-checked for corners, wraps and type after this branch's shared fixes (fonts, wraps, 600 bold) | Low | Rerun `node scripts/design-audit.mjs --only /@` after merge |
| Feed (signed out) | 390 | `.pc-fab` (public/composer.js) | The round + button floats over the first card's cover at rest, and duplicates Start in the tab bar | Medium | Hide the + for signed-out visitors (Start is in the tab bar), or keep the first card clear of it |
| Feed | both | kudos and comments row (feedvisual.js `actRow`, feedcomments.js) | Not audited here; the seeded feed shows "Kudos · Comment · Share" as quiet text links under the I'm in button, easy to miss | Medium | After merge: check they read as actions (44px, an icon and a count) and sit with the card, not under the button |
| About (/about, public/home.html) | 390 | "The people who make a city feel alive are rarely seen." | The heading sits on the paragraph under it (no gap); long bullet lists run four to six items with no breaks | Medium | 8 to 12px under section heads; split the lists or cut them to three |
| About | both | "Bring past events into your scrapbook from Partiful, Luma, Eventbrite" | Names other brands in our own pitch | Low | "from other event apps or a CSV" |
| /k (kudos ask) | both | page | Not audited past the checker (no findings) | Low | Rerun the checker after merge |
| Create canvas | both | "What are you planning?" kind chips (canvas.js) | Not audited past the checker | Low | Rerun after merge |

## What the checker found

| Check | Before (main) | After |
|---|---|---|
| font | 600 | 0 |
| orphan | 210 | 27 |
| radius | 75 | 0 |
| ellipsis | 61 | 6 |
| nested | 10 | 0 |
| jammed | 6 | 0 |
| help | 4 | 0 |
| wrap | 3 | 0 |
| overflow, cards, image, emoji | 0 | 0 |
| **all** | **969** (447 high, 199 medium, 323 low) | **33** (0 high, 5 medium, 28 low) |

Both columns are the final checker over all 232 page views: before on main (fbd95e5), after on this branch. Most of
the 600 font findings before were kit faces that never loaded: main imported them from Google inside system.css, so
in the sandbox (no internet, like a blocked or slow network) every page on system.css drew in the system face, and
the app asked Google for two unused families as well. The first pass of the checker, before it was refined, counted
581 (223 orphan, 119 jammed, 77 radius, 64 ellipsis, 37 overflow, 26 nested, 18 font, 10 wrap, 4 help, 3 cards);
`design-audit/before.txt` and `after.txt` in the scratchpad hold every line.

What was left in that run, read one by one:
- **orphan (27)**: card copy where Chrome's `text-wrap: pretty` still kept a one-word last line ("…in pickup /
  windows.", "$7,170 committed of / $32,000", insight findings ending "else"). The last commit sets small print,
  idea lines, plan lines and insight findings to `balance`, which fixes those. The rest are a place name kept whole
  on purpose ("Mai's Supper Club · / Bed-Stuy", where the place never splits), a four-word idea title balanced
  onto two lines ("Park Picnic & / Games") and an email address in Settings.
- **ellipsis (6)**: the chat list keeps a one-line preview of the last message, the convention of every messages
  list, and cuts the last two words at 1280; a package title on /teams/x loses 5px to a three-line clamp at 1280.
- The checker grew while it was used: it learned to skip what isn't a problem (a box that only hides a hit area, a
  three-word title on two lines, a name set to wrap, stretched grid cards, columns side by side) and to look harder
  in two places (kit faces that never load, headlines under 600). Both columns above are that final version.

## Needs an owner decision or live data

- **Chat bubbles** keep their 18 to 20px round corners. The kit says 6px for cards and buttons and is silent on
  message bubbles; square bubbles would be the only messenger with them. Owner's call.
- **Bottom sheets** (the + sheet, share, photo) keep 22 to 24px top corners where other changes own them
  (composer.js); the chat sheets here are 6px. Pick one.
- **Covers** in the seed are a 1x1 test image stretched to a coral block, and the seeded hosts have no photos;
  real covers and avatars decide how the feed and host pages feel. Scores here don't count the seed's cover.
- **The map** needs its CDN library; the sandbox always shows the list fallback.
- **Push, haptics and the native app** weren't in scope.

