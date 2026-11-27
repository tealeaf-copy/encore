# Glitch audit: every button on the key pages

The owner asked for the whole app and its key journeys, every button, checked for glitches. This is what we ran, what
it found and what changed.

## How it was checked

`node scripts/click-audit.mjs` (not part of `npm test`; it needs Chromium, like `scripts/crawl-pages.mjs`). It starts
its own server on a scratch data dir and seeds a whole cast with `seedClickAudit()` in `test/routes-seed.js`:

- a signed-out visitor, a new guest with no replies, guests who said yes, maybe and who are on a waitlist
- a casual host with events, a fan club and a member, a drop seller with a live drop and a pre-order
- a summit host and a trip host of their own
- the Fernwood Labs brand team (campaigns, bookings, briefs, a report) and one of its hosts, and the admin

On a phone (390x844, touch) and a desktop (1280), it opens each key page as each person who would use it, lists every
visible control (links, buttons, `[role=button]`, `summary`, tabs, inputs, `data-*` action attributes and anything
with a pointer cursor), and taps each one on a fresh load of the page. Sheets are opened first for the Ask Potto sheet,
the + composer, the share sheet in all three formats, the photo sheet, the save-to-list sheet and the Plans peek, and
their own controls are tapped. After every tap it records:

- script errors, console errors and unhandled rejections; same-origin requests that fail (a refusal the server explains
  counts only when the page doesn't show its message); a tap that lands on a 404 or a blank page
- a sheet that won't close (Esc, its close button, the backdrop, Back), focus left on the page behind a sheet, Tab
  leaving an open sheet, focus dropped on the page body when a sheet closes
- a layout shift over 0.1 after the tap (0.25 while a page loads), sideways scroll, a control covered by a sticky bar or
  the dock (at the top and the very bottom of the page, and when scrolled to the middle), a tap that reaches another
  element
- a tap target under 44px on the phone (a smaller one passes when a 44px square centred on it reaches no other control,
  the spacing rule of WCAG 2.5.8 at 44px; links inside running text are exempt)
- a button that does nothing (no navigation, no change on the page, no request, no copy, no share)
- a loader still up 8 seconds after the tap, clipped text, the same control drawn twice in one block

The eight journeys run first, on the world as seeded, end to end with assertions, in `scripts/click-audit-journeys.mjs`. Every button that creates
something is double tapped, two taps 40ms apart, and must create one record:

1. A new visitor plans a dinner at /start, signs up with an email code and then an invite code, the dinner is saved and out
   (exactly one event, published), and they copy and share the link.
2. A guest replies on /e (double tap: one reply), adds to calendar, opens the group chat, changes the reply in the Plans
   peek and back, and invites a friend from the peek.
3. A host lets someone in from the Inbox, checks a guest in at the door (double tap: checked in once) and sends the
   thank-you.
4. A drop seller makes a drop from the + sheet in three steps (double tap: one drop), a guest pre-orders (double tap:
   one order), and the pickup shows on the guest's Plans and the seller's Plans.
5. A brand quick-books a host (double tap: one request), the host accepts and agrees the brief, the brand adds a guest
   (double tap: one guest), runs check-in (double tap: checked in once), opens the report and books again.
6. Find people: follow a host, then join their fan club on the host page (the card from `public/fanclub.js`).
7. Library: save an event to a new list, then share the list (link, Copy, Share).
8. Sign in with an email code, sign out from Settings, sign back in.

Options: `--width 390|1280|both`, `--only <path or sheet name>`, `--role host`, `--journeys-only`, `--no-journeys`,
`--pages-only` (the page checks without the taps), `--workers`, `--max` (taps per page), `--json`, `--shots`,
`--verbose`, `--shifts` (each page's layout shift while loading and what moved).

## Findings

The first full pass at 390 printed 846 lines (175 high, 34 medium, 637 low). About two thirds were the harness itself:
sheets the feed opens by itself a second after load, inputs folded inside a closed `<details>`, visually hidden labels
read as clipped text, bottom bars over content at the top of a page (where you'd scroll), a `data-kind` section read as
a button. Those rules were tightened before any fix was counted. What was left are the glitches below, one row per
cause (the same cause on several pages or roles is one row).

| Page | Element | Issue | Severity | Status |
|---|---|---|---|---|
| Brand pages, admin pages, /e | Any link into them (For brands, I'm in on a feed card) | The page fade into the next page was aborted and threw "Transition was aborted" as an unhandled rejection (about 100 taps). Pages sent straight from a route skipped the app head, and the light invite had no fade opt-in. | High | Fixed: `server/app.js` runs `pwaHead` on every HTML page; the light invite has it in `public/invite.css`, a stylesheet in its head (inline it took the served invite past 40,000 characters). |
| /start | Create my account | `next=start` isn't a path, so sign-up dropped it: a new person landed on the feed and the dinner they typed was never saved or sent. | High | Fixed on main first (`public/start.html`, `server/signin.js`); the audit's copy of the fix was dropped in the port. Journey 1 and main's case in `test/signin.test.js`. |
| /@host | Fan club | Nothing on the host page could join the fan club, and the "joined your club" notice linked to `#club`, which didn't exist. | High | Fixed on main in round 18: the fan club card in `public/fanclub.js` (start, join, leave, members). The audit's own card was dropped. Journey 6 joins through main's card. |
| /plans/<summit> | Check in at the door, Name tags | Both opened `/people/event/<id>`, a 404 (/people is Find people). | High | Fixed: `/contacts/event/<id>`, the invite plan (`server/kinds.js`), with a status check in `test/event-kinds.test.js`. |
| /g (the full invite, as host) | Open in app | The link's inline `onclick` was broken quoting (a SyntaxError on every tap), and `/#studio` landed on the feed. | High | Fixed: `/?app=1&open=<id>#studio`, no inline script. |
| / and /feed | The host's name on a card | The report button's bigger hit area (`::after`) covered the whole card header: a tap on the host's name opened "Report this event". | High | Fixed on main first (the button is `position:relative` in `public/feedvisual.js`, a smaller hit area in `public/safety.js`); the audit's copy was dropped. |
| Event manager, Invite tab | Here? (check-in) | A double tap checked someone in and straight back out. | High | Fixed: a second tap within 700ms (or while saving) is ignored (`public/invite-plan.js`). Journey 3. |
| /teams/campaigns/<id>/run | Check-in | The same double tap glitch at a brand's door. | High | Fixed the same way (`public/teams-campaigns.html`). Journey 5. |
| /g | Leave waitlist, Maybe, Can't go | For a reply made on another phone, the change was sent with this browser's key and refused (403). | High | Fixed: with the reply's code (from your account) it goes through `/api/public/reply`, as the light invite does (`index.html`). |
| /plans (seller) | The seller's own drop | A drop that takes orders any time has no date, so it never showed on its seller's Plans. | High | Fixed: it shows on its next pickup day (`server/plans.js`). Journey 4 and `test/qa-audit.test.js`. |
| /e | Send (double tap) | The second tap landed on the ticket that replaces the form and opened the group chat. | Medium | Fixed: a tap on the ticket within half a second of a tap elsewhere is ignored (`public/comewith.js`, so `public/invite.html` stays at main's size). Journey 2. |
| /?app=1&new=1#studio (host, desktop) | Page load | For a second a host saw the brand sample event ("The Creator Kitchen", executive dinners, budgets) before "What are you hosting?" replaced it, with a layout shift of 0.6. | High | Fixed: the studio remembers on this device whether the workspace is personal, and the first time stays hidden until the host view is drawn (at most 2.5 seconds). After the port the wait is set at the top of `index.html`, before the studio is painted (0.22 to 0.26 on main without that, 0.03 with it). |
| /discover (desktop) | Save to list and the card on the fifth shelf item | The shelves' grid track sized itself to the whole row, so the row ran past the window: the last card was cut off and couldn't be reached or tapped. | High | Fixed: the track is the page's width and the row scrolls (`public/collections.js`). |
| /feed (signed in, desktop) | Page load | The feed widened from 640px to 960px when it filled (layout shift 0.19 to 0.66). | Medium | Fixed on main in round 18 (`body.pre-feed` in `public/feed.html`); the audit's copy was dropped. |
| /@host (desktop) | Page load | A photo cover was drawn at the plain cover's height and grew to the photo's when the page script styled it, pushing the page down (layout shift 0.15 to 0.33). | Medium | Fixed: a photo cover has its height from the first draw (`public/host.html`). |
| Desktop pages with a sheet | Opening a sheet | A sheet that locks the page's scroll took the scrollbar away and slid the whole page sideways under it. | Low | Fixed: the scrollbar's gutter stays (`public/netguard.js`). |
| The create canvas | The live guest preview | The preview frame asked for `/api/public/attendees/_preview` on every load (a 404). | Medium | Fixed on main first (`public/comewith.js`); the audit's copy was dropped. |
| /teams/discover and every brand page with the top bar | Page load | The page dropped 57px when the top bar landed (layout shift 0.35). | Medium | Fixed on main in round 18 (`body.bb[data-top]` in `public/brandbook.css`); the audit's `bb-topped` was dropped. |
| /start | The save sheet | Esc didn't close it. | Medium | Fixed (and focus goes back). Journey 1. |
| /@host, /discover | Suggest a collab, Follow (signed out), account sheets | Esc didn't close them. | Medium | Fixed in `public/collab.js` and `public/account.js`. |
| /feed (signed out) | Page load | Layout shift 0.26: the stories row (hidden by a CSS rule even while it waited) and the New here line both landed after the first paint. | Medium | Fixed on main in round 18 (the stories row and the New here line hold their room in `public/feed.html`); the audit's copy in the feed was dropped, its `public/shell.js` part stays. |
| /discover | Page load | Layout shift 0.5 to 0.87: the collection shelves pushed Coming up down a screen. | Medium | Fixed on main in round 19: the events wait unseen until the shelves have answered (`body.dc-wait` in `public/discover.html`), 0.54 to 0.00 at 1280. The audit's fixed 1000px block was dropped; so was the port's own copy of the same wait. |
| /teams/x/<host>/<package> | The open dates | They had a pointer cursor and did nothing (you pick a date at checkout). | Medium | Fixed: only pickable dates look tappable (`public/brandbook.css`). |
| /g | Invite friends | When the reply had changed since the ticket was drawn, the server said "Reply I'm in first" and the page showed nothing. | Medium | Fixed: the line shows under the button (`public/comewith.js`). |
| /chats/<id>, photo sheet | Chat details, Use this upload | The same label on two controls in one block. | Medium | Fixed: "<event>: chat details" on the title, "Use upload 2 of 5" on each photo. |
| /@host | About, Terms (footer) | The footer's links wrap onto two lines 20px apart, so their 44px hit areas overlapped: a tap on About could open Terms. | Medium | Fixed: a wrapping footer of links keeps its lines 44px apart (`public/system.css`). |
| /teams/bookings | Host links in a meta line | A first hit-area fix overlapped stacked links; caught by the harness and narrowed to a lone link. | Medium | Superseded: main's round 18 rules for brand pages (`public/brandbook.css`) replace the audit's. |
| About 30 components, all pages | Tap targets under 44px on a phone | About 120 distinct controls: brand links in headings and lists, text buttons (Remove, Take out of campaign), milestone stamps, tag x's, the host page's report, block and calendar links, footers, the share sheet's format dots, inbox row buttons, map list titles, the invite's edit line, /start's Sign in, feed card titles and Not for me. | Low | Fixed: 44px hit areas. Main made most of these itself (rounds 17 to 19: the invite, host bar, Inbox, the map, /start, brand pages, feed Follow, dismiss and card titles) and its versions were kept; the audit's remain for the share sheet's format dots, inbox row buttons, Home's footer, short footer words and the host page's calendar link (`public/system.css`). |
| Every sheet with `aria-modal` | Tab | Tab left the open sheet (36 sheets). | Low | Fixed once for every sheet in `public/netguard.js` (and in `public/savelist.js` for the light invite). |
| Sheets on /feed, /inbox, /contacts, /discover, /g | Closing a sheet | Focus was dropped on the page body (15 sheets). | Low | Fixed: focus goes back to what had it, or, when that was redrawn (the reply form that became a ticket), to the page's heading or first control (`public/netguard.js`); People rows take focus; Save to list and the chat's details find their redrawn button. |
| /map (after the port) | An event title in the list | A 21px tall target on a phone once the audit's padding was dropped for main's text face. | Low | Fixed on main in round 18 (`min-height:44px`). |
| / and /feed (after the port) | A card's title | Main's 44px title link measured 358 by 40 on a phone: a one-line title is 28px and had 6px each side. | Low | Fixed on main since (9px each side, `public/feedvisual.js`). |
| /login, /signup, the feed's comments sheet (new on main) | Every control | Added to the audit after the port. | None | Nothing found. |

By severity: 12 high, 14 medium and 4 low causes (about 120 tap targets, 36 sheets and 15 sheets behind three of the low
rows). All 30 are fixed on main after the port: some by the audit's change, some by main's own (the Status column says
which).

### Checked and left alone

- Content hidden on purpose while a page settles (the studio above, under its cover or `visibility:hidden`) can move
  without anyone seeing it, so those shifts don't count.
- The studio's "Edit in the studio" can ask a connected web search (Parallel Search) for context. The harness has no
  internet and its stand-in AI calls the tool with no query, so the server answers 502; the studio already says the
  tool failed and carries on. Not counted.
- /map falls back to its list when the map library (from a CDN) can't load. The harness has no internet, so it always
  falls back; the change of layout that causes isn't counted, and the map itself isn't tested here.
- External links, `mailto:`, `tel:` and downloads are checked for a real address, not followed. Taps that delete,
  cancel, unpublish, block, report, sign out or leave a club are skipped (they would change the world for the taps
  after them); journey 8 covers Sign out.
- Layout shift readings are noisy when the machine is busy (two audits at once read 0.3 to 1.0 on pages that read 0
  alone). The harness checks pages three at a time for that reason; other work on the same machine still moves them.

### The port onto main

The audit ran on a branch that was 66 commits behind main by the time the port finished (rounds 17, 18 and 19 of the reviews landed meanwhile). Where main had fixed the same glitch its own way, main's version
was kept and the audit's dropped: the /start sign-up return, the report button over the host's name, the fan club
card, the brand pages' top bar room, the feed's columns and stories row, Discover's wait for its shelves, the canvas preview's 404, the map list
titles and most of the 44px targets. The regression tests in `test/qa-audit.test.js` now check main's behaviour for
those. The journeys follow main's sign-in (one "Email or phone number" field, the code, then the invite code and the
name) and main's fan club card.

The issue the audit had left open, a load-time layout shift on /@host at 1280 as a signed-in guest (0.23 to 0.43 on
the audit branch), is closed by main: host pages no longer take the invite's 600px column, and the one or two column
store layout is decided once before the first paint. It measures 0.06 now. What is left is the footer, drawn at the
bottom of the waiting page and then pushed off it (0.054).

Harness rules tightened after the port: a refused "is typing" ping is not a glitch (another tap had just changed that
guest's reply); a page or a new tab counts as blank only if it is still blank 8 seconds on; a link to raw data (the
leaderboard's JSON) drops the page fade in the data's own document, which is not counted. `--shifts` prints each
page's layout shift while loading, what moved, and a second visit. /login, /signup, /leaderboard and the feed's
comments sheet were added to the pages.

The numbers below are from commit "Feed card titles are a full 44px tall on a phone", on main at "Leaderboard: How
it's ranked and the footer wait for the board". Layout-shift readings are only good on a quiet machine: with other
test runs going (a load average over 100) the same commit read timeouts, blank pages and shifts that a quiet run
does not.

### Main moved again: what the audit finds on the newest work

While the port was being checked, main took 137 more commits (help for everyone, the post page, the new drop and
calendar sheets, the design audit). The port was carried onto that main as well ("Potto by text test: drop pickup
reads in the shared words"), and `npm test` there passes except one test that fails on main itself (the app shell
is over its 80,000 character budget, `test/pm-mcp.test.js`). The click audit on that main is not clean. It was run
once at 1280 (25 issues, journeys 6 of 8) and part of the way at 390 (58 issues in the page checks, stopped
there). One was fixed here; the rest are open and belong to the work that added them:

| Page | Element | Issue | Severity | Status |
|---|---|---|---|---|
| Share sheet (link, flyer, QR) | Instagram, Save | "phone is not a function": a flag named `phone` hid the `phone()` check in the same block, so both buttons threw. | High | Fixed: the flag is `isPhone` (`public/sharekit.js`). |
| /map (desktop) | Need a hand? Get help | The new help link sits under the map: covered at the top, the middle and the bottom of the page. | High | Open. |
| /e/<a drop> | One more <item> | "Cannot set properties of null (setting 'textContent')" on a tap. | High | Open. |
| /e/<a drop> (desktop, signed out) | Page load | Layout shift 0.56. | Medium | Open. |
| /feed | Kudos on a drop's card | Asks for `/post/e/<id>`, a 404. | Medium | Open. |
| /e (replied on another phone) | Plans changed? Can't go | The change is refused ("You can only change your own response") and the page shows nothing. The full invite got this fix in the audit; the light invite's new button needs the same (send the reply's code). | Medium | Open. |
| /e | Add to calendar (the new sheet) | Esc doesn't close it, Tab leaves it, and focus is dropped on the page when it closes. | Low | Open. |
| Most pages (phone) | Help, Need a hand? Get help | Tap targets of 28 by 44 and 165 by 20. | Low | Open. |
| /contacts, /plans/<id>, /library, /e/<a drop> (phone) | Open <name>, Your page, See your page, the host's name | Tap targets about 20px tall. | Low | Open. |

The harness needs three updates for that main before its count means anything: the comments under a feed card
moved from a sheet to the post page (the "feed comments sheet" opener finds nothing), journey 2 expects Add to
calendar to be a link (it is a sheet now), and journey 4 expects the + sheet's old Drop setup.


## Results

On main at "Leaderboard: How it's ranked and the footer wait for the board" (branch `qa-audit-port-on-b0a4ecb`), a quiet machine:

- `node scripts/click-audit.mjs --width 390`: 0 issues on 1,593 taps across 90 pages and sheets (167 controls over the 60 a page cap were not tapped).
- `node scripts/click-audit.mjs --width 1280`: 0 issues on 1,848 taps across 90 pages and sheets (192 over the cap).
- The eight journeys pass at both widths.
- `node scripts/crawl-pages.mjs --width 390`: 0 problems. `--width 1280`: 0 problems.
- `npm test`: 1,309 tests, all passing (13 of them in `test/qa-audit.test.js`).

Regression tests for the fixes are in `test/qa-audit.test.js`, `test/signin.test.js`, `test/event-kinds.test.js` and
`test/hostloop-flow.test.js`; the UI ones are browser assertions in the harness and its journeys.
