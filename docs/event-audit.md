# Event page audit

Made by `node scripts/event-audit.mjs` (390 and 1280px). One row per surface and state; each check is ok, or what went wrong.
Each row lists the checks that apply to that state: a plain name must be there and work, "no ..." must not be there (a reply form on a cancelled event, the address before you are in, Follow on your own event); errors and layout apply everywhere. Open items name the agent that owns them while they work. High: 4 · medium: 0 · low: 18.


## Before and after (Nov 27, 2026)

81 cases at each width: the light invite (/e/), the full invite (/g), drop order pages, plan pages, the Plans peek, the chat details, the feed's event card, team experiences (/x/), a brand-booked experience (/teams/x/) and the host's own event in the app; signed out, signed in, going, maybe, can't go, waitlisted, asked / let in / turned down, paid and unpaid, members first (member and not), full, cancelled, date changed, past, the host, a co-host, link-only, a table, a weekend away, a summit, long text, no place, a home address.

| | High | Medium | Low | Total |
|---|---|---|---|---|
| Before the fixes | 142 | 46 | 53 | 241 |
| After | 4 | 0 | 18 | 22 |

Before, by check: Follow missing 108 (every invite, plan page, peek, chat and experience page), Help 38, Share 31, layout 15, host link 11, change your reply 8, calendar 8, reply form shown on a cancelled event 4, pay 4, group chat 4, address hidden 2, page errors 3, pages that failed to load on a busy machine 5. (The first run read an approved ask from a phone that said "approved" instead of "requested", and had no Example invite to stand in for; both were fixed in the seed, not counted as page bugs above.)

What is left:
- Pay buttons for the host's pay methods (Venmo, PayPal, Cash App) on a paid event: the invites say "Mai will send a way to pay" even when the host has Venmo set. Owner: payments.
- Layout shift between 0.10 and 0.24, most of it from a machine shared with many other runs (the same pages measure 0.00 alone). Two are real and older than this audit: the full invite on a wide screen moves the group chat card below the page 0.7 and 2 seconds after it draws (ev2Below in index.html, 0.2 to 0.37 before), and Plans pushes its list down when the Sync row and summary fill in (0.10). Owner: the full invite's reply card and calendar work (calendar agent), Plans.
- The drop page's type word says Hangout. Owner: type tags.

## 390px

| Surface | State | Viewer | Checks |
|---|---|---|---|
| light /e/ | signed out | out | reply · host link · follow · share · save · help · where · no change · no chat · no address leak · errors · layout |
| full /g | signed out | out | reply · host link · follow · share · save · help · where · no change · no chat · no address leak · errors · layout |
| light /e/ | signed in, no reply | nia | reply · host link · follow · share · save · help · where · no change · no chat · no address leak · errors · layout |
| full /g | signed in, no reply | nia | reply · host link · follow · share · save · help · where · no change · no chat · no address leak · errors · layout |
| light /e/ | going | out | change · host link · follow · calendar · share · help · where · no address leak · errors · layout |
| full /g | going | out | change · host link · follow · calendar · share · help · where · no address leak · errors · layout |
| light /e/ | maybe | out | change · host link · follow · share · no address leak · errors · layout |
| full /g | maybe | out | change · host link · follow · share · no address leak · errors · layout |
| light /e/ | can't go | out | change · host link · follow · no chat · no address leak · errors · layout |
| full /g | can't go | out | change · host link · follow · no chat · no address leak · errors · layout |
| light /e/ | signed in, replied on another device | guest | change · host link · follow · calendar · share · help · no address leak · errors · layout |
| full /g | signed in, replied on another device | guest | change · host link · follow · calendar · share · help · no address leak · errors · layout |
| light /e/ | home, not replied | out | reply · host link · follow · share · save · help · address hidden · no address leak · errors · layout |
| full /g | home, not replied | out | reply · host link · follow · share · save · help · address hidden · no address leak · errors · layout |
| light /e/ | home, going | out | change · host link · follow · calendar · share · help · no address leak · errors · **layout: CLS 0.11** |
| full /g | home, going | out | change · host link · follow · calendar · share · help · no address leak · errors · layout |
| light /e/ | full, not replied | out | reply · host link · follow · state line · no address leak · errors · layout |
| full /g | full, not replied | out | reply · host link · follow · state line · no address leak · errors · layout |
| light /e/ | waitlisted | out | change · host link · follow · state line · no chat · no address leak · errors · layout |
| full /g | waitlisted | out | change · host link · follow · state line · no chat · no address leak · errors · layout |
| light /e/ | ask, not replied | out | reply · host link · follow · share · no change · no address leak · errors · layout |
| full /g | ask, not replied | out | reply · host link · follow · share · no change · no address leak · errors · layout |
| light /e/ | ask, pending | out | host link · follow · state line · no chat · no address leak · errors · layout |
| full /g | ask, pending | out | host link · follow · state line · no chat · no address leak · errors · layout |
| light /e/ | ask, approved | out | change · host link · follow · calendar · share · help · no address leak · errors · layout |
| full /g | ask, approved | out | change · host link · follow · calendar · share · help · no address leak · errors · layout |
| light /e/ | ask, declined | out | host link · follow · state line · no chat · no calendar · no address leak · errors · layout |
| full /g | ask, declined | out | host link · follow · state line · no chat · no calendar · no address leak · errors · layout |
| light /e/ | paid, not replied | out | reply · host link · follow · share · save · help · no address leak · errors · layout |
| full /g | paid, not replied | out | reply · host link · follow · share · save · help · no address leak · errors · layout |
| light /e/ | paid, going, unpaid | out | **pay: MISSING** · host link · follow · change · no address leak · errors · layout |
| full /g | paid, going, unpaid | out | **pay: MISSING** · host link · follow · change · no address leak · errors · layout |
| light /e/ | paid, going, paid | out | host link · follow · calendar · state line · no pay · no address leak · errors · layout |
| full /g | paid, going, paid | out | host link · follow · calendar · state line · no pay · no address leak · errors · layout |
| light /e/ | members first, member | guest | reply · host link · follow · no address leak · errors · layout |
| full /g | members first, member | guest | reply · host link · follow · no address leak · errors · layout |
| light /e/ | members first, not a member | nia | host link · follow · state line · no address leak · errors · layout |
| full /g | members first, not a member | nia | host link · follow · state line · no address leak · errors · layout |
| light /e/ | cancelled, not replied | out | cancelled note · host link · follow · no reply form · no calendar · no address leak · errors · layout |
| full /g | cancelled, not replied | out | cancelled note · host link · follow · no reply form · no calendar · no address leak · errors · layout |
| light /e/ | cancelled, was going | out | cancelled note · host link · follow · no reply form · no calendar · no address leak · errors · **layout: CLS 0.24** |
| full /g | cancelled, was going | out | cancelled note · host link · follow · no reply form · no calendar · no address leak · errors · **layout: CLS 0.21** |
| light /e/ | date changed, going | out | change · host link · follow · calendar · share · help · state line · no address leak · errors · layout |
| full /g | date changed, going | out | change · host link · follow · calendar · share · help · state line · no address leak · errors · layout |
| light /e/ | past, went | guest | host link · follow · kudos · no reply form · no address leak · errors · layout |
| full /g | past, went | guest | host link · follow · kudos · no reply form · no address leak · errors · layout |
| light /e/ | past, signed out | out | host link · follow · no reply form · no address leak · errors · layout |
| full /g | past, signed out | out | host link · follow · no reply form · no address leak · errors · layout |
| light /e/ | host's own event | host | share · no Follow button · no address leak · errors · layout |
| full /g | host's own event | host | share · no Follow button · no address leak · errors · layout |
| light /e/ | co-host | cohost | host link · share · no address leak · errors · layout |
| full /g | co-host | cohost | host link · share · no address leak · errors · layout |
| light /e/ | link-only (private) | out | reply · host link · follow · share · save · help · no address leak · errors · **layout: CLS 0.10** |
| full /g | link-only (private) | out | reply · host link · follow · share · save · help · no address leak · errors · layout |
| light /e/ | long title, long text, no place | out | reply · host link · follow · no address leak · errors · **layout: CLS 0.11** |
| full /g | long title, long text, no place | out | reply · host link · follow · no address leak · errors · layout |
| light /e/ | table booking | out | reply · host link · follow · no address leak · errors · layout |
| full /g | table booking | out | reply · host link · follow · no address leak · errors · layout |
| light /e/ | trip, going | guest | change · host link · follow · calendar · no address leak · errors · **layout: CLS 0.10** |
| full /g | trip, going | guest | change · host link · follow · calendar · no address leak · errors · layout |
| light /e/ | summit | out | reply · host link · follow · no address leak · errors · layout |
| full /g | summit | out | reply · host link · follow · no address leak · errors · layout |
| light /e/ | today, no cover | out | reply · host link · follow · share · save · help · no address leak · errors · **layout: CLS 0.10** |
| full /g | today, no cover | out | reply · host link · follow · share · save · help · no address leak · errors · layout |
| drop /e/ | signed out | out | order · host link · follow · share · no reply · no address leak · errors · **layout: CLS 0.16** |
| drop /e/ | signed in | nia | order · host link · follow · share · no reply · no address leak · errors · layout |
| drop /e/ | host's own | host | share · no Follow button · no address leak · errors · layout |
| plan /plans/ | going | guest | host link · follow · calendar · chat · change · share · no address leak · errors · layout |
| plan /plans/ | trip, going | guest | host link · follow · calendar · chat · no address leak · errors · layout |
| plan /plans/ | summit, going | guest | host link · follow · calendar · no address leak · errors · layout |
| plan /plans/ | host's own | host | calendar · share · no Follow button · no address leak · errors · layout |
| plan /plans/ | home, not replied | nia | host link · follow · no address leak · errors · layout |
| Plans peek | going | guest | host link · follow · change · calendar · chat · share · no address leak · errors · **layout: CLS 0.15** |
| Plans peek | trip, going | guest | host link · follow · change · calendar · chat · no address leak · errors · layout |
| chat header | guest | guest | host link · follow · no address leak · errors · layout |
| chat header | host | host | no Follow button · no address leak · errors · layout |
| feed card | signed out | out | host link · follow · no address leak · errors · layout |
| feed card | signed in | nia | host link · follow · no address leak · errors · layout |
| experience /x/ | signed out | out | host link · follow · share · no address leak · errors · layout |
| brand experience /teams/x/ | signed out | out | host link · follow · report · no address leak · errors · layout |
| host view (app) | host | host | share · no Follow button · no address leak · errors · layout |

## 1280px

| Surface | State | Viewer | Checks |
|---|---|---|---|
| light /e/ | signed out | out | reply · host link · follow · share · save · help · where · no change · no chat · no address leak · errors · layout |
| full /g | signed out | out | reply · host link · follow · share · save · help · where · no change · no chat · no address leak · errors · layout |
| light /e/ | signed in, no reply | nia | reply · host link · follow · share · save · help · where · no change · no chat · no address leak · errors · layout |
| full /g | signed in, no reply | nia | reply · host link · follow · share · save · help · where · no change · no chat · no address leak · errors · layout |
| light /e/ | going | out | change · host link · follow · calendar · share · help · where · no address leak · errors · layout |
| full /g | going | out | change · host link · follow · calendar · share · help · where · no address leak · errors · layout |
| light /e/ | maybe | out | change · host link · follow · share · no address leak · errors · layout |
| full /g | maybe | out | change · host link · follow · share · no address leak · errors · layout |
| light /e/ | can't go | out | change · host link · follow · no chat · no address leak · errors · layout |
| full /g | can't go | out | change · host link · follow · no chat · no address leak · errors · layout |
| light /e/ | signed in, replied on another device | guest | change · host link · follow · calendar · share · help · no address leak · errors · layout |
| full /g | signed in, replied on another device | guest | change · host link · follow · calendar · share · help · no address leak · errors · layout |
| light /e/ | home, not replied | out | reply · host link · follow · share · save · help · address hidden · no address leak · errors · layout |
| full /g | home, not replied | out | reply · host link · follow · share · save · help · address hidden · no address leak · errors · layout |
| light /e/ | home, going | out | change · host link · follow · calendar · share · help · no address leak · errors · layout |
| full /g | home, going | out | change · host link · follow · calendar · share · help · no address leak · errors · layout |
| light /e/ | full, not replied | out | reply · host link · follow · state line · no address leak · errors · layout |
| full /g | full, not replied | out | reply · host link · follow · state line · no address leak · errors · layout |
| light /e/ | waitlisted | out | change · host link · follow · state line · no chat · no address leak · errors · layout |
| full /g | waitlisted | out | change · host link · follow · state line · no chat · no address leak · errors · layout |
| light /e/ | ask, not replied | out | reply · host link · follow · share · no change · no address leak · errors · layout |
| full /g | ask, not replied | out | reply · host link · follow · share · no change · no address leak · errors · layout |
| light /e/ | ask, pending | out | host link · follow · state line · no chat · no address leak · errors · layout |
| full /g | ask, pending | out | host link · follow · state line · no chat · no address leak · errors · layout |
| light /e/ | ask, approved | out | change · host link · follow · calendar · share · help · no address leak · errors · layout |
| full /g | ask, approved | out | change · host link · follow · calendar · share · help · no address leak · errors · layout |
| light /e/ | ask, declined | out | host link · follow · state line · no chat · no calendar · no address leak · errors · layout |
| full /g | ask, declined | out | host link · follow · state line · no chat · no calendar · no address leak · errors · layout |
| light /e/ | paid, not replied | out | reply · host link · follow · share · save · help · no address leak · errors · layout |
| full /g | paid, not replied | out | reply · host link · follow · share · save · help · no address leak · errors · layout |
| light /e/ | paid, going, unpaid | out | **pay: MISSING** · host link · follow · change · no address leak · errors · layout |
| full /g | paid, going, unpaid | out | **pay: MISSING** · host link · follow · change · no address leak · errors · **layout: CLS 0.20** |
| light /e/ | paid, going, paid | out | host link · follow · calendar · state line · no pay · no address leak · errors · layout |
| full /g | paid, going, paid | out | host link · follow · calendar · state line · no pay · no address leak · errors · **layout: CLS 0.19** |
| light /e/ | members first, member | guest | reply · host link · follow · no address leak · errors · layout |
| full /g | members first, member | guest | reply · host link · follow · no address leak · errors · layout |
| light /e/ | members first, not a member | nia | host link · follow · state line · no address leak · errors · **layout: CLS 0.17** |
| full /g | members first, not a member | nia | host link · follow · state line · no address leak · errors · **layout: CLS 0.16** |
| light /e/ | cancelled, not replied | out | cancelled note · host link · follow · no reply form · no calendar · no address leak · errors · **layout: CLS 0.18** |
| full /g | cancelled, not replied | out | cancelled note · host link · follow · no reply form · no calendar · no address leak · errors · **layout: CLS 0.17** |
| light /e/ | cancelled, was going | out | cancelled note · host link · follow · no reply form · no calendar · no address leak · errors · layout |
| full /g | cancelled, was going | out | cancelled note · host link · follow · no reply form · no calendar · no address leak · errors · layout |
| light /e/ | date changed, going | out | change · host link · follow · calendar · share · help · state line · no address leak · errors · layout |
| full /g | date changed, going | out | change · host link · follow · calendar · share · help · state line · no address leak · errors · layout |
| light /e/ | past, went | guest | host link · follow · kudos · no reply form · no address leak · errors · layout |
| full /g | past, went | guest | host link · follow · kudos · no reply form · no address leak · errors · layout |
| light /e/ | past, signed out | out | host link · follow · no reply form · no address leak · errors · layout |
| full /g | past, signed out | out | host link · follow · no reply form · no address leak · errors · layout |
| light /e/ | host's own event | host | share · no Follow button · no address leak · errors · layout |
| full /g | host's own event | host | share · no Follow button · no address leak · errors · layout |
| light /e/ | co-host | cohost | host link · share · no address leak · errors · layout |
| full /g | co-host | cohost | host link · share · no address leak · errors · layout |
| light /e/ | link-only (private) | out | reply · host link · follow · share · save · help · no address leak · errors · layout |
| full /g | link-only (private) | out | reply · host link · follow · share · save · help · no address leak · errors · layout |
| light /e/ | long title, long text, no place | out | reply · host link · follow · no address leak · errors · layout |
| full /g | long title, long text, no place | out | reply · host link · follow · no address leak · errors · layout |
| light /e/ | table booking | out | reply · host link · follow · no address leak · errors · layout |
| full /g | table booking | out | reply · host link · follow · no address leak · errors · layout |
| light /e/ | trip, going | guest | change · host link · follow · calendar · no address leak · errors · layout |
| full /g | trip, going | guest | change · host link · follow · calendar · no address leak · errors · **layout: CLS 0.19** |
| light /e/ | summit | out | reply · host link · follow · no address leak · errors · layout |
| full /g | summit | out | reply · host link · follow · no address leak · errors · layout |
| light /e/ | today, no cover | out | reply · host link · follow · share · save · help · no address leak · errors · layout |
| full /g | today, no cover | out | reply · host link · follow · share · save · help · no address leak · errors · layout |
| drop /e/ | signed out | out | order · host link · follow · share · no reply · no address leak · errors · layout |
| drop /e/ | signed in | nia | order · host link · follow · share · no reply · no address leak · errors · layout |
| drop /e/ | host's own | host | share · no Follow button · no address leak · errors · layout |
| plan /plans/ | going | guest | host link · follow · calendar · chat · change · share · no address leak · errors · layout |
| plan /plans/ | trip, going | guest | host link · follow · calendar · chat · no address leak · errors · layout |
| plan /plans/ | summit, going | guest | host link · follow · calendar · no address leak · errors · layout |
| plan /plans/ | host's own | host | calendar · share · no Follow button · no address leak · errors · layout |
| plan /plans/ | home, not replied | nia | host link · follow · no address leak · errors · layout |
| Plans peek | going | guest | host link · follow · change · calendar · chat · share · no address leak · errors · **layout: CLS 0.19** |
| Plans peek | trip, going | guest | host link · follow · change · calendar · chat · no address leak · errors · layout |
| chat header | guest | guest | host link · follow · no address leak · errors · layout |
| chat header | host | host | no Follow button · no address leak · errors · layout |
| feed card | signed out | out | host link · follow · no address leak · errors · layout |
| feed card | signed in | nia | host link · follow · no address leak · errors · layout |
| experience /x/ | signed out | out | host link · follow · share · no address leak · errors · layout |
| brand experience /teams/x/ | signed out | out | host link · follow · report · no address leak · errors · layout |
| host view (app) | host | host | share · no Follow button · no address leak · errors · **layout: CLS 0.20** |

## Open items

- [low] 390px light /e/ · home, going (out, `/e/auHome`): layout CLS 0.11
- [high] 390px light /e/ · paid, going, unpaid (out, `/e/auPaid`): pay MISSING (owner: payments)
- [high] 390px full /g · paid, going, unpaid (out, `/g#rsvp-auPaid`): pay MISSING (owner: payments)
- [low] 390px light /e/ · cancelled, was going (out, `/e/auCancel`): layout CLS 0.24
- [low] 390px full /g · cancelled, was going (out, `/g#rsvp-auCancel`): layout CLS 0.21
- [low] 390px light /e/ · link-only (private) (out, `/e/auPrivate`): layout CLS 0.10
- [low] 390px light /e/ · long title, long text, no place (out, `/e/auLong`): layout CLS 0.11
- [low] 390px light /e/ · trip, going (guest, `/e/rtTrip`): layout CLS 0.10
- [low] 390px light /e/ · today, no cover (out, `/e/rtToday`): layout CLS 0.10
- [low] 390px drop /e/ · signed out (out, `/e/mMS9OdfHEoPWaucc`): layout CLS 0.16
- [low] 390px Plans peek · going (guest, `/plans#peek=rtOpen`): layout CLS 0.15
- [high] 1280px light /e/ · paid, going, unpaid (out, `/e/auPaid`): pay MISSING (owner: payments)
- [high] 1280px full /g · paid, going, unpaid (out, `/g#rsvp-auPaid`): pay MISSING (owner: payments)
- [low] 1280px full /g · paid, going, unpaid (out, `/g#rsvp-auPaid`): layout CLS 0.20
- [low] 1280px full /g · paid, going, paid (out, `/g#rsvp-auPaid`): layout CLS 0.19
- [low] 1280px light /e/ · members first, not a member (nia, `/e/auEarly`): layout CLS 0.17
- [low] 1280px full /g · members first, not a member (nia, `/g#rsvp-auEarly`): layout CLS 0.16
- [low] 1280px light /e/ · cancelled, not replied (out, `/e/auCancel`): layout CLS 0.18
- [low] 1280px full /g · cancelled, not replied (out, `/g#rsvp-auCancel`): layout CLS 0.17
- [low] 1280px full /g · trip, going (guest, `/g#rsvp-rtTrip`): layout CLS 0.19
- [low] 1280px Plans peek · going (guest, `/plans#peek=rtOpen`): layout CLS 0.19
- [low] 1280px host view (app) · host (host, `/?open=auPlace`): layout CLS 0.20
