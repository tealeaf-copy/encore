# Copy audit, Nov 2026

Every word a person reads in Pottery Lab, checked against `docs/brand-kit.md`, `docs/potto-voice.md`, the voice skill
and plain-English rules, then fixed in code. Text only, plus a few one-line helpers and one "What's this?". No layout
or CSS changes (a design audit runs alongside).

## How it was done

1. **Inventory.** Every page in `public/*.html`, the app in `index.html`, the scripts in `public/*.js` that write UI
   text, and the strings the server sends people (`server/*.js`: emails, texts, bell notes, errors). Pages were also
   read as rendered text, signed out, as a host and as a guest, at 390px, from the seeded world in
   `test/routes-seed.js`, plus three walked flows: a guest replying from an invite link, a host saving a first dinner
   from `/start`, and a brand's field marketer on `/teams`, `/hosts/book`, `/work`, `/gifts` and `/results`.
2. **Three readers per surface.** A first-time guest who got an invite link, a first-time host planning a dinner, and
   a brand's field marketer. Each surface was checked for AI tells, confusing sentences, features with no explanation,
   and tone.
3. **Fix, re-read, score.** After each pass the changed pages were read again in the browser and scored 1 to 10 on
   four things: human and specific (H), clear (C), explains itself (E), fits the audience (A).
4. **Lint.** `scripts/copy-lint.mjs` checks the mechanical rules on every run (below).

## The repeatable check

```
node scripts/copy-lint.mjs            # counts per rule and file, exits 1 on any hit
node scripts/copy-lint.mjs --list     # every hit with file:line
node scripts/copy-lint.mjs --semi     # also lists semicolons that join two sentences (advisory)
```

It reads visible HTML text and attributes (placeholder, aria-label, title, alt, meta content), string literals in
`public/*.js`, inline scripts and `server/*.js`, including the strings inside a template's `${...}`. It flags em
dashes (and `&mdash;`, the `\u2014` escape, a spaced en dash standing in for one), exclamation marks in UI strings, and the
never-use words: taped in, marketplace, seamless, effortless, unlock, elevate, curated, magical, attendees, seats
(when counting places, not seating people or car seats), per person, say yes (consent like "said yes to
sharing" is fine), vibrant, "whether you're", delve, utilize, leverage, stunning, supercharge, game-changer,
hassle-free. Prompts sent to the writing model are skipped for words (they list banned words on purpose). A line can
opt out with a `copy-lint: ok` comment.

| | Before (main at fbd95e5) | After |
|---|---|---|
| Total hits | 316 in 53 files | 4 in 3 files |
| Em dashes | 18 | 0 |
| Exclamation marks | 36 | 2 |
| Never-use words | 262 (say yes 86, attendees 81, seats 70, per person 17, curated 6, unlock 2) | 2 (seats 1, attendees 1) |
| Semicolons joining sentences (advisory) | 279 | 78 |

The 4 hits left are all in areas other work owns right now (see "In flight elsewhere"): the game-night chip in
`public/canvas.js`, the Venmo note in `public/host.html`, and two lines in `public/storeshop.js`. Most of the 78
semicolons left are field descriptions for agents in `server/directory.js` (read by software, not people) and the
in-flight files.

## Inventory, findings and fixes by surface

Scores are H / C / E / A, before → after. "Same" means it read well already and needed nothing.

### Guests

| Surface | Files | Before | After |
|---|---|---|---|
| Invite, light (`/e`, `/i`) | `public/invite.html`, `public/slots.js`, `public/tables.js` | 9 / 8 / 8 / 9 | 9 / 9 / 9 / 9 |
| Invite, full (`/g`) | `index.html` guest mode | 8 / 8 / 8 / 8 | 9 / 9 / 9 / 9 |
| Same table next time (`/again`) | `public/again.html`, `server/tables.js` | 7 / 7 / 7 / 8 | 9 / 9 / 9 / 9 |
| Kudos thanks, add photos (`/k`, `/p`) | `public/kudos.html` (in flight), `public/photos.html` | 8 / 9 / 9 / 8 | 9 / 9 / 9 / 9 |
| Plans and plan pages (`/plans`, `/plans/:id`) | `public/plans.html`, `public/plan.html`, `public/kinds.js` | 8 / 8 / 9 / 9 | 9 / 9 / 9 / 9 |
| Discover, events, hosts, ideas | `public/discover.html`, `events.html`, `hostdir.html`, `ideas.html` | 9 / 9 / 9 / 9 | same |
| Feed | `public/feed.html`, `feedvisual.js` (in flight) | 8 / 8 / 8 / 9 | 9 / 9 / 8 / 9 |
| Chats | `public/chats.html`, `chat.js` | 8 / 9 / 9 / 8 | 9 / 9 / 9 / 9 |
| Quiz, community rules, security, privacy, terms | `quiz.html`, `community-rules.html`, `security.html` | 8 / 9 / 9 / 9 | 9 / 9 / 9 / 9 |
| Sign in and join | `public/signin.html` | 9 / 8 / 9 / 9 | 9 / 9 / 9 / 9 |
| Texts and emails to guests | `server/social.js`, `server/kudosnudge.js`, `server/shop.js`, `server/hosts.js` | 7 / 9 / 9 / 7 | 9 / 9 / 9 / 9 |

What the three readers hit, and what changed:

- **Guest.** The SMS consent line joined two sentences with a semicolon ("you'll get event texts; reply STOP"), now
  two sentences. Same table next time read "Mai hosts it again. Mai hasn't set the next date yet. Tap now and you're
  in once it's up.": the name twice and a vague "Tap now". It now reads "Mai hasn't set the next date yet. Tap I'm in
  and you're in as soon as it's set." Followers' head start said "Followers get first dibs until Sat 6pm", and now says
  "Followers can reply first, until Sat 6pm." The summit agenda read "1 SESSIONS · 1 TRACKS". Texts and emails opened
  with "Hi!", "It's on!", "Thanks Sam!" and "You're booked!". All end in a period now. Security said RSVP and now says
  reply. Sign-in buttons all said Continue. They now say Send me a code, Check the code, Use this code.
- **Host.** Nothing to fix on the guest side that a host would trip on, apart from the follower note above.
- **Brand.** Not their surface.

### Hosts

| Surface | Files | Before | After |
|---|---|---|---|
| Plan a dinner (`/start`) | `public/start.html` | 9 / 9 / 9 / 8 | 9 / 9 / 9 / 9 |
| Host Home and the hosting card | `index.html` (Home), `public/hostloop.js` | 7 / 7 / 5 / 8 | 9 / 9 / 9 / 9 |
| Event canvas and studio | `public/canvas.js`, `index.html` studio | 8 / 8 / 8 / 8 | 9 / 9 / 9 / 9 |
| Invite planner (pick, waves, status, blocks) | `public/invite-plan.js`, `server/invites.js`, `server/seats.js` | 7 / 7 / 8 / 7 | 9 / 9 / 9 / 9 |
| Host path, Circles, leaderboard | `public/path.html`, `circles.html`, `leaderboard.html` | 7 / 7 / 5 / 8 | 9 / 9 / 9 / 9 |
| Settings | `public/settings.html`, `public/hostloop.js` | 7 / 6 / 6 / 8 | 9 / 9 / 9 / 9 |
| Your people, find people | `public/contacts.html`, `people.html`, `server/people.js` | 8 / 8 / 7 / 9 | 9 / 9 / 9 / 9 |
| Host playbook, guides | `public/playbook.html`, `server/guides.js` | 8 / 7 / 7 / 9 | 9 / 9 / 9 / 9 |
| Year in review (`/recap`) | `public/recap.html` | 7 / 8 / 9 / 7 | 9 / 9 / 9 / 9 |
| Host page (`/@handle`) | `public/host.html`, `storefront.js` (in flight) | 8 / 8 / 8 / 8 | in flight |
| Bell, emails and texts to hosts | `server/app.js`, `server/hostloop.js`, `server/fanclub.js`, `server/market.js` | 8 / 9 / 9 / 8 | 9 / 9 / 9 / 9 |

What the three readers hit, and what changed:

- **Host planning a dinner.** Host Home's hosting card showed "1 month · 1 rest pass · 25 of 30 hosting points ·
  Circles" with no word on what any of it is. It now has a small "What's this?" (below). Settings had a brand
  insights switch that was a double negative: "Don't include my activity in brand insights. On by default. Turn it
  off to help hosts get booked by brands." It now reads "Keep my activity out of brand insights. On by default. Turn
  it off to let your activity count, which helps hosts get booked by brands.", and the paragraph above it says the
  same thing in the same order. `/start` counted Seats and now counts Spots. The canvas called approval "Require
  approval" and "say yes". It's "Ask to join", and the host lets each guest in. The playbook asked hosts to watch their
  "second-RSVP rate" and said "Open tables do this for you if you ask a question or two when they reply". It now says
  "how many came back" (the same words as the Guests step) and what an open table actually does. The year in review
  said "gatherings", "1 people came" and "weeks in a row, at best". The invite meter said "6 seats · expect ~5 yes";
  it says "6 spots · expect ~5 in". "Never came but replied" and "Replied, never came" named the same group. It is
  "Replied, never came" everywhere. People's QR tab said "My code" and now says "My QR code".
- **Guest.** Drafts the host sends (pay link, thank-you, ride, see-you, vendor asks) opened with "Hi!" or "Hey X!";
  they now read like a calm text.
- **Brand.** Not their surface.

### Brands

| Surface | Files | Before | After |
|---|---|---|---|
| Team experiences, book a host (`/teams`, `/hosts/book`, `/x`) | `teams.html`, `hosts.html`, `server/market.js` | 9 / 9 / 9 / 8 | 9 / 9 / 9 / 9 |
| Studio (plans, budgets, guests, follow-up, pipeline) | `index.html` studio and brand views | 7 / 7 / 8 / 8 | 9 / 9 / 9 / 8 |
| Campaigns, insights, team spaces, results | `teams-*.html`, `team.html`, `results.html`, `measure.js` | 7 / 8 / 8 / 8 | 9 / 9 / 9 / 9 |
| Brand-booking panels (brief, spots, survey, outcomes) | `teams-panel*.js`, `server/brandpanel*.js` | 7 / 7 / 8 / 8 | 9 / 9 / 9 / 9 |
| Method, `/work`, gifts | `method.html`, `landing.html`, `gifts.html`, `giftplan.html`, `server/giftplan.js` | 8 / 8 / 7 / 9 | 9 / 9 / 9 / 9 |

What the field marketer hit, and what changed: "attendees" (81 times), "seats" for places and "per person" ran through
the Studio, results, the panels and the CSVs. They now say guests, spots and "a person". Empty result cells were a
lone em dash and now say "Not yet". "Curated" meant ask-to-join, so it says Ask to join. The method page used "lift"
before saying what it is, and now defines it where the held-out group comes in. "Say yes" covered three different
things (an RSVP, a consent and a sign-off). Each now has its own word: "are in", "agree", "sign off" or "accept". The
gift planner's prompt called Pottery Lab "a marketplace". It doesn't now. The Studio's own ATTENDEE COMMENTS prompt header is GUEST
COMMENTS. "RSVP pages built for phones" on `/work` is "Invite pages built for phones".

The Studio stays at 8 for fit: field marketers still read "RSVP link", "Copy RSVP link" and "Show rate", which is their
everyday language but not the house word. That's an owner decision (below).

## 15 representative rewrites

| # | Where | Before | After |
|---|---|---|---|
| 1 | Settings, brand insights | Don't include my activity in brand insights. On by default. Turn it off to help hosts get booked by brands. | Keep my activity out of brand insights. On by default. Turn it off to let your activity count, which helps hosts get booked by brands. |
| 2 | Invite, followers' head start | Followers get first dibs until Sat 6pm | Followers can reply first, until Sat 6pm |
| 3 | Seat blocks, guest line | Members get first dibs. 2 member seats left. | Members can reply first. 2 member spots left. |
| 4 | Same table next time | Mai hosts it again. Mai hasn't set the next date yet. Tap now and you're in once it's up. | Mai hasn't set the next date yet. Tap I'm in and you're in as soon as it's set. |
| 5 | Leaderboard | Rather a small, private ranking on effort? Circles are opt-in. | For something smaller, Circles rank about ten hosts like you on effort, not followers. Only members see the board, and you opt in. |
| 6 | Canvas, approval sheet | Require approval. Guests ask to join. You see who they are and say yes. | Ask to join. Guests ask to join. You see who they are and let them in, or not this time. |
| 7 | Playbook | Watch one number. Your second-RSVP rate: of the people who came, how many replied I'm in again. | Watch one number. How many came back: of the people who came, the share who replied I'm in to another one. |
| 8 | Playbook | Open tables do this for you if you ask a question or two when they reply. | Turn on an open table and guests answer two or three questions when they're in. You get suggested tables of about four. |
| 9 | Settings, reply summaries | one short email per event every few hours with who said yes, maybe or can't. | one short email per event, every few hours, with who's in, who's a maybe and who can't go. |
| 10 | Host's first-reply email | Sam said I'm in. That's the first yes for Soup night. | Sam is in. That's the first reply for Soup night. |
| 11 | Invite planner meter | 4 on the list · 6 seats · expect ~5 yes | 4 on the list · 6 spots · expect ~5 in |
| 12 | Results, empty state | Book a team event or order gifts; each booking gets a guest page, and the results land here after the day. Results are saved to this device: open your booking links here, or sign in. | Book a team event or order gifts. Each booking gets a guest page, and its results show here after the day. Results stay on this device, so open your booking links here, or sign in. |
| 13 | Year in review | 2 gatherings · 1 people came · 2 weeks in a row, at best | 2 events · 1 guest came · 2 weeks in a row, the longest run |
| 14 | Text reply | Hi! This is Pottery Lab. We couldn't find an invite for this number. | Hi, this is Pottery Lab. We couldn't find an invite for this number. |
| 15 | Brand panel | Waiting on Mai to say yes. You can commit either way. / You said yes. When the brand commits, it's booked. | Waiting on Mai to accept. You can commit either way. / You accepted. When the brand commits, it's booked. |

## Explainers added

| Where | What it says |
|---|---|
| Host Home, the hosting card (`public/hostloop.js`): a small "What's this?" under the streak | Your streak counts the months in a row you hosted something, even a coffee. A rest pass covers a quiet month so the streak keeps going. Hosting points add up events, guests and small moves toward your monthly goal. (Weeks instead of months for a weekly streak.) |
| Host path, under "Hosting points this month" (`public/path.html`) | Points for showing up: events, guests welcomed, would-go-again and small moves. Followers don't count. |
| Host path, under "Your streak" | Months in a row you hosted something, even a coffee. A rest pass covers a quiet month. |
| Settings, the Hosting intro (`public/hostloop.js`) | Your streak counts the months (or weeks) in a row you host something. Points add up events, guests and small moves toward a monthly goal. |
| Leaderboard, under the intro | What Circles are (rewrite 5 above). |
| Method page, step 2 (`public/method.html`) | Lift is the gap between the invited accounts and this held-out group. |

Already explained where they appear, so left alone: fan club (the start card says what it is), waves (the Waves tab
says invites go out on their own at those times), the brief ("Write one so you and the host agree on the night"), the
open table and "I'm in if a friend is" (both say what they do when opened), Watching on the feed ("Describe it. I'll
tell you when one's posted."), link only on Home.

## Names standardised

| One name | Instead of | Where it changed |
|---|---|---|
| guests | attendees | Studio, results, method, team spaces, brand panels, CSV headers, MCP tool notes |
| spots | seats (counting places) | /start, invite planner, seat blocks, brand briefs and panels, Studio, path tips |
| $X a person, "a guest", "a person" | per person, per attendee | Studio budget lines, results, compliance log, gift planner |
| Ask to join / let in | Require approval, curated, say yes | canvas, Studio, invite notes, chat gate |
| are in / were in / replied | said yes, says yes, said I'm in | settings, Studio, After step, host emails, quiz, guest types |
| agree / accept / sign off | say yes (consent, quotes, approvals) | brand panels, team survey, collabs, checkout, approvals |
| can reply first | first dibs (on invites and seat blocks) | invite, seat blocks, follower errors, fan club notes |
| Replied, never came | Never came but replied | People, Contacts |
| events | gatherings | year in review |
| reply | RSVP | security page, `/work` |
| Feed (page title) | Friends | `public/feed.html` |
| Your people (page title) | People | `public/contacts.html` |

Seating people at a table ("Seat people next to someone new"), seats in a car, and a restaurant table's literal seats
("You're at 7 of 6. Call to add a seat?") keep the word seat on purpose.

## Code that rewrites drawn text

A few places in `index.html` patch text after it's drawn by matching the words. They were updated with the copy so
they keep matching: the After step's "N were in. Who actually came?", the follower note ("You follow Mai, so you can
reply now. Everyone else waits"), the zero-KPI hider ("Existing deals with guests"), the guest-role relabel, the
community relabel ("book once 10 accounts are in"), and the ask-to-join note ("lets each guest in").

## In flight elsewhere (not edited here)

- **About (`public/home.html`).** "Report or block from wherever you see something; we look at every report within 24
  hours." joins two sentences with a semicolon. "Run a drop: pre-orders with pickup windows and a set batch." uses
  "drop" before the page says what one is (it does say it in the same line, which is fine). "colours" here, "colors"
  elsewhere.
- **Host page kudos and offers (`public/storefront.js`, `public/storeshop.js`, `public/drop.js`, those blocks in
  `public/host.html`).** "attendee list back after the event" (storeshop.js:324). "See you soon!" in the pickup-ready
  note (storeshop.js:439). "Followers get first dibs until..." (storefront.js:238) should match the new invite line,
  "Followers can reply first, until...". "＋ Who's it for?" under Next up has no hint for what it adds. The Venmo note
  "Thank you for hosting!" (host.html:184). Two semicolons in storeshop.js ("signs off first; it books the moment they
  do").
- **Feed kudos and comments (`public/feedvisual.js` social row, `public/feedcomments.js`).** The stories row shows the
  sample host with the label "Example", and a newcomer may not know it's made up. "Sample host" or a one-line hint would
  help. Feed cards say "1 is going" while invites say "1 in" (server/feedblend.js was left as is: "Maya and 2 others
  are going" reads well on a feed).
- **"What are you planning?" chips (`public/canvas.js`).** The game-night chip says "a seat for someone new", and the
  house word would be "a spot for someone new".
- **The + composer (`public/composer.js`).** Not read in this pass.

## Owner decisions

1. **RSVP in the Studio.** Field marketers say "RSVP link", "RSVP rate" and "show rate", and the Studio uses them. The
   house words are reply and "I'm in". Keep the industry words for brands, or switch the Studio to "reply link"?
2. **US or UK spelling.** The copy mixes them: neighbourhood 49 / neighborhood 46, colour 97 (UI) / color, favourite 8
   / favorite 4, cancelled 231 / canceled 2. The brand kit uses "favorite" and "colour". Pick one and a pass can
   normalise it.
3. **Emoji at the start of bell and push notes.** About 20 server notes start with an emoji ("🎉 Mai let you in",
   "💬 ...", "📸 New photos"). The brand kit says no emoji as UI. Keep them as a quick visual cue in the bell, or move
   the cue to a drawn icon per kind?
4. **"Done and dusted"** heads past events on Host Home. It's the screen's one light touch. Keep it, or say "Past
   events"?
5. **Drops on Discover.** An order-ahead drop shows on Discover as an event with "Date coming soon", "Free" and "See the
   event". The drop has a price ($12 an item in the seed). This is the card's logic, not its words: it needs the
   listing to carry the drop's price and an "Order ahead" label. Worth a ticket.
6. **"Watching"** is the feed tab for saved alerts. It explains itself once opened. "Alerts" would say it before.

## Backlog (small, safe, not done)

- 78 semicolons left (`node scripts/copy-lint.mjs --semi`), mostly agent-facing API descriptions in
  `server/directory.js`.
- "Add a little more (optional)" on the reply form could name what's inside it (a note, coming solo, ask me about).
- "Hosts your team will talk about." on `/hosts/book` leans a little salesy for this audience.
