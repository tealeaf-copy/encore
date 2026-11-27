# Feed and Discover audit

Written by `node scripts/feed-discover-audit.mjs` (2026-11-27, 2483s). It seeds a small world (test/routes-seed.js plus a busy Brooklyn host with a long title and events without covers, a quiet Austin host, a drop, a new account, an account with friends, follows and posts, a brand team member) and drives each surface at 390 and 1280px in every state. Each tap runs once on a fresh page; nothing destructive is tapped.

**18 failing checks** (17 high, 1 medium, 0 low) out of 852.

## States

- `out-first`: Signed out, first visit
- `out-back`: Signed out, returning (Brooklyn set)
- `new`: New account, no follows or friends
- `social`: Friends and follows
- `host`: A host
- `brand`: Brand team member
- `few`: Signed in, city with few events (Austin)
- `none`: Signed in, city with none (Denver)
- `any`: Signed in, Anywhere

## Surface x state x check

Page checks: errors (console, page errors, failed or 4xx/5xx requests), overlay (a sheet up by itself), overflow (sideways scroll), cls (layout shift over 0.1), clip (text cut off in a control), targets (under 44px at 390), help (a control under the help button), orphans (one word alone on the last line of short copy), copy (em dashes, emoji in chrome), hostlink (the host page reached from anything but the avatar or name), actions (a card without its main action), empty (a page with nothing on it), taps (every control once).

### 390px

| surface | state | errors | overlay | overflow | cls | clip | targets | help | orphans | copy | hostlink | actions | empty | taps |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| /feed | out-first | ok | **1 fail** | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| /feed | out-back | ok | **1 fail** | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |  |
| /feed | new | ok | **1 fail** | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| /feed | social | ok | **1 fail** | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| /feed | host | ok | **1 fail** | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| /feed | brand | ok | **1 fail** | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| /feed | few | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |  |
| /feed | none | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |  |
| /feed | any | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |  |
| / | out-first | ok | **1 fail** | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |  |
| / | out-back | ok | **1 fail** | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |  |
| /discover | out-first | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | **2 fail** |
| /discover | out-back | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |  |
| /discover | new | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |  |
| /discover | social | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| /discover | host | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |  |
| /discover | brand | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |  |
| /discover | few | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| /discover | none | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| /discover | any | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | **1 fail** |
| /map | out-first | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |  |
| /map | out-back | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |  |
| /map | new | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |  |
| /map | social | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |  |
| /map | host | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |  |
| /map | brand | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |  |
| /map | few | ok | ok | ok | **1 fail** | ok | ok | ok | ok | ok | ok | ok | ok |  |
| /map | none | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |  |
| /map | any | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |  |

### 1280px

| surface | state | errors | overlay | overflow | cls | clip | targets | help | orphans | copy | hostlink | actions | empty | taps |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| /feed | out-first | ok | **1 fail** | ok | ok | ok |  | ok | ok | ok | ok | ok | ok | ok |
| /feed | out-back | ok | **1 fail** | ok | ok | ok |  | ok | ok | ok | ok | ok | ok |  |
| /feed | new | ok | ok | ok | ok | ok |  | ok | ok | ok | ok | ok | ok |  |
| /feed | social | ok | ok | ok | ok | ok |  | ok | ok | ok | ok | ok | ok | ok |
| /feed | host | ok | ok | ok | ok | ok |  | ok | ok | ok | ok | ok | ok |  |
| /feed | brand | ok | ok | ok | ok | ok |  | ok | ok | ok | ok | ok | ok |  |
| /feed | few | ok | ok | ok | ok | ok |  | ok | ok | ok | ok | ok | ok |  |
| /feed | none | ok | ok | ok | ok | ok |  | ok | ok | ok | ok | ok | ok |  |
| /feed | any | ok | ok | ok | ok | ok |  | ok | ok | ok | ok | ok | ok |  |
| / | out-first | ok | **1 fail** | ok | ok | ok |  | ok | ok | ok | ok | ok | ok |  |
| / | out-back | ok | **1 fail** | ok | ok | ok |  | ok | ok | ok | ok | ok | ok |  |
| /discover | out-first | ok | ok | ok | ok | ok |  | ok | ok | ok | ok | ok | ok | **1 fail** |
| /discover | out-back | ok | ok | ok | ok | ok |  | ok | ok | ok | ok | ok | ok |  |
| /discover | new | ok | ok | ok | ok | ok |  | ok | ok | ok | ok | ok | ok |  |
| /discover | social | ok | ok | ok | ok | ok |  | ok | ok | ok | ok | ok | ok | **1 fail** |
| /discover | host | ok | ok | ok | ok | ok |  | ok | ok | ok | ok | ok | ok |  |
| /discover | brand | ok | ok | ok | ok | ok |  | ok | ok | ok | ok | ok | ok |  |
| /discover | few | ok | ok | ok | ok | ok |  | ok | ok | ok | ok | ok | ok |  |
| /discover | none | ok | ok | ok | ok | ok |  | ok | ok | ok | ok | ok | ok |  |
| /discover | any | ok | ok | ok | ok | ok |  | ok | ok | ok | ok | ok | ok |  |
| /map | out-first | ok | ok | ok | ok | ok |  | ok | ok | ok | ok | ok | ok |  |
| /map | out-back | ok | ok | ok | ok | ok |  | ok | ok | ok | ok | ok | ok |  |
| /map | new | ok | ok | ok | ok | ok |  | ok | ok | ok | ok | ok | ok |  |
| /map | social | ok | ok | ok | ok | ok |  | ok | ok | ok | ok | ok | ok |  |
| /map | host | ok | ok | ok | ok | ok |  | ok | ok | ok | ok | ok | ok |  |
| /map | brand | ok | ok | ok | ok | ok |  | ok | ok | ok | ok | ok | ok |  |
| /map | few | ok | ok | ok | ok | ok |  | ok | ok | ok | ok | ok | ok |  |
| /map | none | ok | ok | ok | ok | ok |  | ok | ok | ok | ok | ok | ok |  |
| /map | any | ok | ok | ok | ok | ok |  | ok | ok | ok | ok | ok | ok |  |

## Failures

| sev | surface | width | state | check | detail |
|---|---|---|---|---|---|
| high | /feed | 390 | out-first | overlay | up on load, covering the page: div.sd "Would you go? Swipe right to save, left " |
| high | / | 390 | out-first | overlay | up on load, covering the page: div.sd "Would you go? Swipe right to save, left " |
| high | /discover | 390 | out-first | tap: save (Discover card) | the More menu has no Save |
| high | /discover | 390 | out-first | tap: See the event | /g#rsvp-rtToday doesn't show "Tonight's supper" |
| high | /feed | 390 | out-back | overlay | up on load, covering the page: div.sd "Would you go? Swipe right to save, left " |
| high | / | 390 | out-back | overlay | up on load, covering the page: div.sd "Would you go? Swipe right to save, left " |
| high | /feed | 390 | new | overlay | up on load, covering the page: div.sd "Would you go? Swipe right to save, left " |
| high | /feed | 390 | social | overlay | up on load, covering the page: div.sd "Would you go? Swipe right to save, left " |
| high | /feed | 390 | host | overlay | up on load, covering the page: div.sd "Would you go? Swipe right to save, left " |
| high | /feed | 390 | brand | overlay | up on load, covering the page: div.sd "Would you go? Swipe right to save, left " |
| high | /discover | 390 | any | tap: save (Discover card) | the More menu has no Save |
| high | /feed | 1280 | out-first | overlay | up on load, covering the page: div.sd "Would you go? Swipe right to save, left " |
| high | / | 1280 | out-first | overlay | up on load, covering the page: div.sd "Would you go? Swipe right to save, left " |
| high | /discover | 1280 | out-first | tap: save (Discover card) | the More menu has no Save |
| high | /feed | 1280 | out-back | overlay | up on load, covering the page: div.sd "Would you go? Swipe right to save, left " |
| high | / | 1280 | out-back | overlay | up on load, covering the page: div.sd "Would you go? Swipe right to save, left " |
| high | /discover | 1280 | social | tap: shelf | timed out |
| medium | /map | 390 | few | cls | CLS 0.583: 0.583 #sheet,.pills (668->71 at 870ms) |

## Taps that passed

| surface | width | state | tap | what happened |
|---|---|---|---|---|
| /feed | 390 | out-first | follow (suggestion row) | signed out: went to /@mai-routes#follow to ask who you are |
| /feed | 390 | out-first | follow (card header) | signed out: went to /@mai-routes#follow |
| /feed | 390 | out-first | not for me (dismiss) | gone, and stays gone |
| /feed | 390 | out-first | kudos | signed out: asks you to sign in |
| /feed | 390 | out-first | send kudos (milestone) | signed out: asks you to sign in |
| /feed | 390 | out-first | comment | signed out: asks you to sign in |
| /feed | 390 | out-first | share | share sheet with /e/rtToday |
| /feed | 390 | out-first | host name | /@mai-routes |
| /feed | 390 | out-first | event button | "I'm in" -> /e/rtToday |
| /feed | 390 | out-first | event title | /e/rtToday |
| /feed | 390 | out-first | story | opens, Escape closes |
| /feed | 390 | out-first | recap photo | opens and closes |
| /feed | 390 | out-first | ideas deck | opens, closes |
| /feed | 390 | out-first | city chip | city changed in place |
| /feed | 390 | out-first | see all (suggestions) | /login?next=/people |
| /feed | 390 | out-first | row card | /e/fdaCt2 |
| /discover | 390 | out-first | city picker | in place: "Coming up in Austin", 1 cards |
| /discover | 390 | out-first | Anywhere | 6 cards |
| /discover | 390 | out-first | category chips | each chip filters in place, an empty one says so |
| /discover | 390 | out-first | Show more | 6 -> 12 |
| /discover | 390 | out-first | map toggle | /map with 2 in the list |
| /discover | 390 | out-first | host follow | asks for an email in a sheet (signed out) |
| /discover | 390 | out-first | quiz | /quiz |
| /discover | 390 | out-first | shelf | /c/weekend |
| /feed | 390 | new | follow (suggestion row) | @mai-routes Following, kept after reload |
| /feed | 390 | new | follow (card header) | @crumb-fda followed in place, gone after reload |
| /feed | 390 | new | follow a person | Following |
| /feed | 390 | new | not for me (dismiss) | gone, and stays gone |
| /feed | 390 | new | kudos | 0 -> 1, same after reload |
| /feed | 390 | new | send kudos (milestone) | "Send kudos" -> "Kudos sent
1", kept |
| /feed | 390 | new | comment | sent, 0 -> 1, same after reload |
| /feed | 390 | new | share | share sheet with /e/rtToday |
| /feed | 390 | new | host name | /@mai-routes |
| /feed | 390 | new | event button | "I'm in" -> /e/rtToday |
| /feed | 390 | new | event title | /e/rtToday |
| /feed | 390 | new | story | opens, Escape closes |
| /feed | 390 | new | recap photo | opens and closes |
| /feed | 390 | new | ideas deck | opens, closes |
| /feed | 390 | new | + create | opens, Escape closes |
| /feed | 390 | new | tabs | Mine, Watching, Friends and Feed each draw |
| /feed | 390 | new | city chip | city changed in place |
| /feed | 390 | new | see all (suggestions) | /people |
| /feed | 390 | new | row card | /e/fdaCt2 |
| /feed | 390 | social | follow (suggestion row) | @laps-fda Following, kept after reload |
| /feed | 390 | social | kudos | 1 -> 2, same after reload |
| /feed | 390 | social | send kudos (milestone) | "Send kudos
1" -> "Kudos sent
2", kept |
| /feed | 390 | social | comment | sent, 1 -> 2, same after reload |
| /feed | 390 | social | share | share sheet with /e/rtToday |
| /feed | 390 | social | host name | /@mai-routes |
| /feed | 390 | social | event button | "I'm in" -> /e/rtToday |
| /feed | 390 | social | event title | /e/rtToday |
| /feed | 390 | social | story | opens, Escape closes |
| /feed | 390 | social | recap photo | opens and closes |
| /feed | 390 | social | ideas deck | opens, closes |
| /feed | 390 | social | + create | opens, Escape closes |
| /feed | 390 | social | tabs | Mine, Watching, Friends and Feed each draw |
| /feed | 390 | social | city chip | city changed in place |
| /feed | 390 | social | row card | /e/fdaRun |
| /discover | 390 | social | city picker | in place: "Coming up in Austin", 1 cards |
| /discover | 390 | social | Anywhere | 6 cards |
| /discover | 390 | social | category chips | each chip filters in place, an empty one says so |
| /discover | 390 | social | Show more | 6 -> 12 |
| /discover | 390 | social | map toggle | /map with 2 in the list |
| /discover | 390 | social | host follow | Following @crumb-fda, kept after reload |
| /discover | 390 | social | save (Discover card) | pressed false -> true |
| /discover | 390 | social | See the event | /g#rsvp-rtToday shows "Tonight's supper" |
| /discover | 390 | social | order (shops) | /e/8eZ1QpCDShTfWc1R |
| /discover | 390 | social | quiz | /quiz |
| /discover | 390 | social | shelf | /c/quiet-nerdy?city=New%20York |
| /feed | 390 | host | follow (suggestion row) | @crumb-fda Following, kept after reload |
| /feed | 390 | host | follow a person | Following |
| /feed | 390 | host | not for me (dismiss) | gone, and stays gone |
| /feed | 390 | host | kudos | 0 -> 1, same after reload |
| /feed | 390 | host | send kudos (milestone) | "Send kudos
2" -> "Kudos sent
3", kept |
| /feed | 390 | host | comment | sent, 0 -> 1, same after reload |
| /feed | 390 | host | share | share sheet with /e/fdaCt0 |
| /feed | 390 | host | host name | /@crumb-fda |
| /feed | 390 | host | event button | "I'm in" -> /e/fdaCt0 |
| /feed | 390 | host | event title | /e/fdaCt0 |
| /feed | 390 | host | story | opens, Escape closes |
| /feed | 390 | host | recap photo | opens and closes |
| /feed | 390 | host | ideas deck | opens, closes |
| /feed | 390 | host | + create | opens, Escape closes |
| /feed | 390 | host | tabs | Mine, Watching, Friends and Feed each draw |
| /feed | 390 | host | city chip | city changed in place |
| /feed | 390 | host | row card | /e/fdaCt5 |
| /feed | 390 | brand | follow (suggestion row) | @crumb-fda Following, kept after reload |
| /feed | 390 | brand | not for me (dismiss) | gone, and stays gone |
| /feed | 390 | brand | kudos | 1 -> 2, same after reload |
| /feed | 390 | brand | send kudos (milestone) | "Send kudos
3" -> "Kudos sent
4", kept |
| /feed | 390 | brand | comment | sent, 1 -> 2, same after reload |
| /feed | 390 | brand | share | share sheet with /e/fdaCt0 |
| /feed | 390 | brand | host name | /@crumb-fda |
| /feed | 390 | brand | event button | "I'm in" -> /e/fdaCt0 |
| /feed | 390 | brand | event title | /e/fdaCt0 |
| /feed | 390 | brand | story | opens, Escape closes |
| /feed | 390 | brand | recap photo | opens and closes |
| /feed | 390 | brand | ideas deck | opens, closes |
| /feed | 390 | brand | + create | opens, Escape closes |
| /feed | 390 | brand | tabs | Mine, Watching, Friends and Feed each draw |
| /feed | 390 | brand | city chip | city changed in place |
| /feed | 390 | brand | row card | /e/fdaCt6 |
| /discover | 390 | few | city picker | in place: "Coming up in Austin", 1 cards |
| /discover | 390 | few | Anywhere | 6 cards |
| /discover | 390 | few | category chips | each chip filters in place, an empty one says so |
| /discover | 390 | few | Show more | 1 -> 9 |
| /discover | 390 | few | map toggle | /map with 1 in the list |
| /discover | 390 | few | host follow | Following @laps-fda, kept after reload |
| /discover | 390 | few | save (Discover card) | pressed false -> true |
| /discover | 390 | few | See the event | /g#rsvp-fdaRun shows "Evening 5k" |
| /discover | 390 | few | quiz | /quiz |
| /discover | 390 | few | shelf | /c/quiet-nerdy?city=Austin |
| /discover | 390 | none | city picker | in place: "Coming up in Austin", 1 cards |
| /discover | 390 | none | Anywhere | 6 cards |
| /discover | 390 | none | category chips | each chip filters in place, an empty one says so |
| /discover | 390 | none | Show more | 6 -> 12 |
| /discover | 390 | none | map toggle | /map with 1 in the list |
| /discover | 390 | none | host follow | Following @crumb-fda, kept after reload |
| /discover | 390 | none | save (Discover card) | pressed false -> true |
| /discover | 390 | none | See the event | /g#rsvp-rtToday shows "Tonight's supper" |
| /discover | 390 | none | quiz | /quiz |
| /discover | 390 | none | shelf | /c/quiet-nerdy?city=Denver |
| /discover | 390 | any | city picker | in place: "Coming up in Austin", 1 cards |
| /discover | 390 | any | Anywhere | 6 cards |
| /discover | 390 | any | category chips | each chip filters in place, an empty one says so |
| /discover | 390 | any | Show more | 6 -> 12 |
| /discover | 390 | any | map toggle | /map with 2 in the list |
| /discover | 390 | any | host follow | Following @crumb-fda, kept after reload |
| /discover | 390 | any | See the event | /g#rsvp-rtToday shows "Tonight's supper" |
| /discover | 390 | any | quiz | /quiz |
| /discover | 390 | any | shelf | /c/weekend |
| /feed | 1280 | out-first | follow (suggestion row) | signed out: went to /@crumb-fda#follow to ask who you are |
| /feed | 1280 | out-first | follow (card header) | signed out: went to /@mai-routes#follow |
| /feed | 1280 | out-first | not for me (dismiss) | gone, and stays gone |
| /feed | 1280 | out-first | kudos | signed out: asks you to sign in |
| /feed | 1280 | out-first | send kudos (milestone) | signed out: asks you to sign in |
| /feed | 1280 | out-first | comment | signed out: asks you to sign in |
| /feed | 1280 | out-first | share | share sheet with /e/rtToday |
| /feed | 1280 | out-first | host name | /@mai-routes |
| /feed | 1280 | out-first | event button | "I'm in" -> /e/rtToday |
| /feed | 1280 | out-first | event title | /e/rtToday |
| /feed | 1280 | out-first | story | opens, Escape closes |
| /feed | 1280 | out-first | recap photo | opens and closes |
| /feed | 1280 | out-first | ideas deck | opens, closes |
| /feed | 1280 | out-first | city chip | city changed in place |
| /feed | 1280 | out-first | see all (suggestions) | /login?next=/people |
| /feed | 1280 | out-first | row card | /e/fdaRun |
| /discover | 1280 | out-first | city picker | in place: "Coming up in Austin", 1 cards |
| /discover | 1280 | out-first | Anywhere | 6 cards |
| /discover | 1280 | out-first | category chips | each chip filters in place, an empty one says so |
| /discover | 1280 | out-first | Show more | 6 -> 12 |
| /discover | 1280 | out-first | map toggle | /map with 2 in the list |
| /discover | 1280 | out-first | host follow | asks for an email in a sheet (signed out) |
| /discover | 1280 | out-first | See the event | /g#rsvp-rtToday shows "Tonight's supper" |
| /discover | 1280 | out-first | quiz | /quiz |
| /discover | 1280 | out-first | shelf | /c/weekend |
| /feed | 1280 | social | kudos | 2 -> 1, same after reload |
| /feed | 1280 | social | send kudos (milestone) | "Kudos sent
4" -> "Send kudos
3", kept |
| /feed | 1280 | social | comment | sent, 2 -> 3, same after reload |
| /feed | 1280 | social | share | share sheet with /e/rtToday |
| /feed | 1280 | social | host name | /@mai-routes |
| /feed | 1280 | social | event button | "I'm in" -> /e/rtToday |
| /feed | 1280 | social | event title | /e/rtToday |
| /feed | 1280 | social | story | opens, Escape closes |
| /feed | 1280 | social | recap photo | opens and closes |
| /feed | 1280 | social | ideas deck | opens, closes |
| /feed | 1280 | social | + create | opens, Escape closes |
| /feed | 1280 | social | tabs | Mine, Watching, Friends and Feed each draw |
| /feed | 1280 | social | city chip | city changed in place |
| /feed | 1280 | social | row card | /e/fdaRun |
| /discover | 1280 | social | city picker | in place: "Coming up in Austin", 1 cards |
| /discover | 1280 | social | Anywhere | 6 cards |
| /discover | 1280 | social | category chips | each chip filters in place, an empty one says so |
| /discover | 1280 | social | Show more | 6 -> 12 |
| /discover | 1280 | social | map toggle | /map with 2 in the list |
| /discover | 1280 | social | host follow | Following @crumb-fda, kept after reload |
| /discover | 1280 | social | save (Discover card) | pressed true -> false |
| /discover | 1280 | social | See the event | /g#rsvp-rtToday shows "Tonight's supper" |
| /discover | 1280 | social | order (shops) | /e/8eZ1QpCDShTfWc1R |
| /discover | 1280 | social | quiz | /quiz |

## What each page showed

| surface | width | state | cards |
|---|---|---|---|
| /feed | 390 | out-first | event 5, follow 1, recap 1, milestone 1, ideas 1, row 1, story 11 |
| / | 390 | out-first | event 5, follow 1, recap 1, milestone 1, ideas 1, row 1, story 11 |
| /discover | 390 | out-first | discover card 6, host card 3 |
| /map | 390 | out-first | map row 2 |
| /feed | 390 | out-back | event 5, follow 1, recap 1, milestone 1, ideas 1, row 1, story 11 |
| / | 390 | out-back | event 5, follow 1, recap 1, milestone 1, ideas 1, row 1, story 11 |
| /discover | 390 | out-back | discover card 6, host card 2, shop 2 |
| /map | 390 | out-back | map row 2 |
| /feed | 390 | new | event 5, follow 1, recap 1, milestone 1, ideas 1, row 1, story 12 |
| /discover | 390 | new | discover card 6, host card 2, shop 2 |
| /map | 390 | new | map row 2 |
| /feed | 390 | social | event 5, follow 1, recap 1, milestone 1, ideas 1, row 1, story 12 |
| /discover | 390 | social | discover card 6, host card 2, shop 2 |
| /map | 390 | social | map row 2 |
| /feed | 390 | host | event 5, follow 1, recap 1, milestone 1, ideas 1, row 1, story 12 |
| /discover | 390 | host | discover card 6, host card 2, shop 2 |
| /map | 390 | host | map row 2 |
| /feed | 390 | brand | event 5, follow 1, recap 1, milestone 1, ideas 1, row 1, story 12 |
| /discover | 390 | brand | discover card 6, host card 2, shop 2 |
| /map | 390 | brand | map row 2 |
| /feed | 390 | few | event 5, follow 1, recap 1, milestone 1, ideas 1, row 1, story 12 |
| /discover | 390 | few | discover card 1, host card 1 |
| /map | 390 | few | map row 1 |
| /feed | 390 | none | event 5, follow 1, recap 1, milestone 1, ideas 1, row 1, story 12 |
| /discover | 390 | none | discover card 6, host card 3 |
| /map | 390 | none | map row 2 |
| /feed | 390 | any | event 5, recap 1, milestone 1, ideas 1, row 1, story 12 |
| /discover | 390 | any | discover card 6, host card 3 |
| /map | 390 | any | map row 2 |
| /feed | 1280 | out-first | event 5, follow 1, recap 1, milestone 1, ideas 1, row 1, story 11 |
| / | 1280 | out-first | event 5, follow 1, recap 1, milestone 1, ideas 1, row 1, story 11 |
| /discover | 1280 | out-first | discover card 6, host card 3 |
| /map | 1280 | out-first | map row 2 |
| /feed | 1280 | out-back | event 5, follow 1, recap 1, milestone 1, ideas 1, row 1, story 11 |
| / | 1280 | out-back | event 5, follow 1, recap 1, milestone 1, ideas 1, row 1, story 11 |
| /discover | 1280 | out-back | discover card 6, host card 2, shop 2 |
| /map | 1280 | out-back | map row 2 |
| /feed | 1280 | new | event 5, follow 1, recap 1, milestone 1, ideas 1, row 1, story 12 |
| /discover | 1280 | new | discover card 6, host card 2, shop 2 |
| /map | 1280 | new | map row 3 |
| /feed | 1280 | social | event 5, recap 1, milestone 1, ideas 1, row 1, story 12 |
| /discover | 1280 | social | discover card 6, host card 2, shop 2 |
| /map | 1280 | social | map row 2 |
| /feed | 1280 | host | event 5, recap 1, milestone 1, ideas 1, row 1, story 12 |
| /discover | 1280 | host | discover card 6, host card 2, shop 2 |
| /map | 1280 | host | map row 2 |
| /feed | 1280 | brand | event 6, recap 1, milestone 1, ideas 1, row 1, story 12 |
| /discover | 1280 | brand | discover card 6, host card 2, shop 2 |
| /map | 1280 | brand | map row 2 |
| /feed | 1280 | few | event 5, follow 1, recap 1, milestone 1, ideas 1, row 1, story 12 |
| /discover | 1280 | few | discover card 1, host card 1 |
| /map | 1280 | few | map row 2 |
| /feed | 1280 | none | event 5, follow 1, recap 1, milestone 1, ideas 1, row 1, story 12 |
| /discover | 1280 | none | discover card 6, host card 3 |
| /map | 1280 | none | map row 2 |
| /feed | 1280 | any | event 5, recap 1, milestone 1, ideas 1, row 1, story 12 |
| /discover | 1280 | any | discover card 6, host card 3 |
| /map | 1280 | any | map row 2 |

<!-- notes: kept by the script -->
## Findings, fixes and owners

The table above is the run after the fixes. The first full pass (390px, signed out first and returning, a new account, friends and follows) had 46 failing checks: 14 high, 28 medium, 5 low. About 20 of those were the checker's own mistakes, fixed in the script: offline outside scripts failing their integrity check, a visually hidden name counted as clipped text, ::after hit boxes and stretched card links counted as small targets, and Collections shelf cards held to the Coming up card's button.

Fixed (each a small change, highest first):

| sev | where | what was wrong | fix |
|---|---|---|---|
| high | /feed stories | Opening a recap story threw `Cannot read properties of undefined (reading 'handle')`: two functions in feedvisual.js were both called `recapCard`, so the viewer drew the feed's recap card | the feed card is `blendRecap`; a test fails on any function declared twice |
| high | /feed Ideas to try | Swipe ideas did nothing once the first-visit deck had loaded swipedeck.js (the loader waited for a load event that had already fired) | `need()` checks the global first; the first-visit loader marks the script loaded |
| high | /feed | An always-open drop never reached the feed (it has no day, and the feed only took dated events) | dateless drops are in, with Order and their price |
| high | /discover, /map | A drop card said Free and Date coming soon, with See the event | Order ahead, From $12, Order any time, Order to the drop; the map's tier comes from the items |
| medium | /discover, slow connection | Collections shelves that answered after the page showed pushed Coming up a screen down (CLS 0.61) | late shelves land under Coming up |
| medium | /feed stories rail | Host names cut off with an ellipsis ("Sweet Pe...", "Yan Draw...") | two centred lines, and the rail keeps room for them (no shift) |
| medium | /feed cards | Event title links 40px tall on a phone | 44px hit box, nothing moves |
| medium | /discover hosts | The Next line cut long titles off | the whole title, on two lines |
| low | /discover cards | One word alone on the last line ("Bed-Stuy", "shade.") | balanced short lines, pretty titles |
| low | /feed friend posts | Cheer button carried a party popper | plain Cheer, Cheered |

Left, and who owns it:

| sev | where | what | owner |
|---|---|---|---|
| high | /feed and / (signed out first visit, and every signed-in state at 390) | The "Would you go?" deck opens by itself and covers the whole page | the deck (/start audit) |
| high | /discover signed out, and Anywhere | A card's More menu has no Save (save.js isn't on Discover, so PLSave is missing) | Follow and Save to list |
| medium | /map in Austin (few events), offline | When the map fails after first paint the list jumps up to become the page (CLS 0.58); only seen once, timing dependent | map, list fallback |
| low | /feed signed out | Follow on a suggestion goes to the host page to ask for an email, since there is no account to follow with | Follow and Save to list |
| low | /feed | Friend posts have Cheer, not Kudos and Comment like every other card | inline kudos and comments |
| low | /feed vs /discover | The feed shows events from host pages Discover still hides as unfinished (no face or photo) | product call |
| low | /feed | A drop's card line is the host's tagline, not the drop | feed copy |
| low | /discover | Long titles stop at two lines with an ellipsis (lists.css clamp, shared with /events and /saved) | design audit |

Environment notes: the machine ran at a load of about 180 on 4 cores, so the script waits twice as long as it would elsewhere (`FDA_SLOW=1` for a normal machine), and a cross-page fade Chromium drops under that load ("Transition was aborted") is not counted.
