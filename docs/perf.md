# Performance and robustness

How fast Pottery Lab is on a phone, how we measure it, what we changed, and what we left alone on purpose. The iOS app is
a wrapper around the live site, so these numbers are the app's numbers too.

## How to measure

```
node scripts/perf.mjs [--runs 3] [--only /feed] [--md out.md] [--json out.json]   # page loads and page-to-page moves
node scripts/loadtest.mjs [--users 50] [--seconds 20]                             # many people at once
node scripts/crawl-pages.mjs [--width 390] [--no-flows]                           # every page, the nav, the sheets
```

All three start their own server on a scratch database, seeded by `scripts/perf-world.mjs` (the route seed in
`test/routes-seed.js`, plus a month of the host's events and a busy chat). None of them is part of `npm test`: they
need Chromium (the load test doesn't, but it takes 20 seconds of full CPU).

The perf harness emulates an iPhone 13 (390 px, touch) on a throttled link through the DevTools protocol: **9 Mbps
down, 1.5 Mbps up, 150 ms round trip, CPU 4x slower**. This sandbox has no internet, so third-party requests (Google
Fonts) are answered locally after 3 round trips (450 ms: DNS, TLS and the request on a new origin), which is what a
fresh third-party origin costs on that link. Each page is loaded cold (new browser profile) 3 times and the median is
reported. Navigations are measured warm: one profile with the service worker on opens every shell page once, then
moves A to B the way a tap does; "tap to FCP/LCP" is from the tap to the next page's paint.

Columns: TTFB, FCP and LCP in ms; CLS; "first tap" is the slowest event-timing entry for a tap on the page 600 ms after
it settles (a stand-in for INP); "longest task" is the longest main-thread task during load and how many there were
over 50 ms; JS/CSS/HTML are KB on the wire (compressed); "idle DOM mutations/s" counts DOM changes a second while
nobody touches the page (it should be 0).

The machine these ran on was shared and heavily loaded, so absolute numbers are noisy (a few percent run to run; the
4x CPU slowdown is on top of an already busy CPU). The before and after runs were made back to back on the same
machine with the same harness.

## Budgets

| Budget | Target |
|---|---|
| LCP, throttled phone: feed, invite, host page | under 1.8 s |
| Page to page, cached shell pages | under 300 ms to first meaningful paint |
| INP (first tap) | under 200 ms |
| CLS | under 0.05 |
| Long tasks on load | none over 200 ms |

## Before and after

Before is the code at `f33ba88`, after is this branch, run back to back with `--runs 3` (median). Arrows show the change.

| Page | TTFB | FCP | LCP | CLS | First tap | Longest task (count) | JS KB | CSS KB | Requests | Idle DOM changes/s |
|---|---|---|---|---|---|---|---|---|---|---|
| / (signed out feed) | 153 → 154 | 940 → 944 | 1644 → 1704 | 0.027 → 0.028 | 40 → 32 | 179 (3) → 207 (3) | 135 → 141 | 20 → 21 | 37 → 43 | 0 |
| /feed (signed in) | 177 → 154 | 940 → 1000 | 1660* → 2012 | 0.027* → 0.095 | 32 | 95 (3) → 170 (4) | 305 → 159 | 40 → 21 | 95 → 58 | 0 |
| /discover | 153 → 154 | 920 → 1096 | 920 → 1096 | **0.818 → 0.052** | 16 → 24 | 146 (6) → 157 (7) | 92 → 98 | 25 → 26 | 47 → 51 | 0 |
| /plans | 159 → 156 | 900 → 908 | 1288 → 1296 | 0.196 → 0.205 | 16 | 122 (4) → 88 (4) | 92 → 98 | 23 → 25 | 44 → 47 | 0 |
| /people | 153 → 154 | **712 → 428** | 924 → 772 | 0.017 → 0.018 | 8 → 16 | 0 (0) | 55 → 61 | 12 → 13 | 25 → 30 | 0 |
| /@host | 153 | 916 → 1084 | **1800 → 1640** | 0.034 → 0.08 | 16 | 312 (5) → 348 (5) | 208 → 214 | 29 → 30 | 56 → 63 | 0 |
| /e/&lt;id&gt; (light invite) | 152 → 153 | 968 → 936 | 1372 → 1328 | 0 → 0.004 | 8 → 16 | 78 (2) → 78 (1) | 117 | 23 → 24 | 44 → 49 | 0 |
| /chats | 160 → 153 | **688 → 428** | 988 → 868 | 0.032 | 16 → 24 | 80 (2) → 84 (2) | 59 → 64 | 17 → 19 | 22 → 28 | 0 |
| /chats/&lt;id&gt; | 153 → 154 | **680 → 452** | 1120 → 996 | 0 | - | 0 (0) | 59 → 64 | 17 → 19 | 24 → 30 | 0 |
| /settings | 153 | **708 → 444** | 960 → 780 | 0.027 → 0.064 | 16 → 8 | 0 (0) → 65 (1) | 67 → 72 | 12 → 13 | 36 → 40 | 0 |
| /about | 153 → 152 | 944 → 964 | 944 → 964 | 0 | 32 → 24 | 73 (2) → 74 (2) | 44 → 49 | 12 → 14 | 15 → 22 | 0 |
| /g#rsvp (full invite) | 153 | 744 → 748 | 3700 → 4040 | 0.073 | 48 → 64 | 109 (8) → 115 (9) | 765 → 775 | 63 → 64 | 83 → 85 | 0 |
| /g#rsvp (a guest who replied) | 153 | 728 → 732 | 1292 → 1300 | 0.344 | 56 → 48 | 210 (21) → 177 (15) | 774 → 785 | 63 → 64 | 135 → 126 | **55 → 0** |
| /?app=1 (the app) | 154 → 155 | 776 → 728 | 4196 → 4160 | **1.2 → 0.202** | 24 → 32 | 425 (34) → 421 (34) | 787 → 794 | 54 → 56 | **349 → 163** | 0 |
| create canvas (open: 386 ms tap to title field) | 153 → 154 | 600 → 740 | **14096 → 4032** | **1.221 → 0.136** | 24 | 390 (34) → 418 (29) | 807 → 831 | 61 → 80 | **390 → 203** | 0 |

\* see "the feed's before is too kind" below.

| Navigation (warm, service worker on) | Tap to FCP | Tap to LCP | CLS | Requests |
|---|---|---|---|---|
| /feed → /discover | 265 → 261 | 288 → 261 | 0 | 44 → 46 |
| /discover → /plans | 256 → 303 | 648 | 0 | 43 → 46 |
| /plans → /chats | 183 → 255 | 480 → 537 | 0 | 21 → 26 |
| /chats → /feed | 310 → 236 | 1622 → 1488 | 0 | 50 → 55 |
| /feed → /@host | 435 → 456 | 1624 → 1596 | 0.477 → 0.875 | 86 → 84 |
| /@host → /e/&lt;id&gt; (the host's own event) | 874 → 1119 | 4195 → 4735 | 0 → 0.091 | 165 → 158 |
| /feed → /people | 263 → 220 | 263 → 220 | 0 | 23 → 27 |
| /feed → /settings | 251 → 226 | 463 → 470 | 0 | 34 → 37 |

How to read it:

- **The feed's "before" is too kind.** The old feed reloaded itself once per session on a new device (to pick up the
  workspace's city), and the harness measures the second document only. Timed from the tap to the final paint over 5
  cold loads with the same throttling: **3,242 ms before, 2,002 ms after**, one document instead of two, half the
  JavaScript (305 KB to 159 KB) and 40% fewer requests.
- **Fonts now really load.** The harness answers Google Fonts with an empty stylesheet (there is no internet here), so
  in the before run no font file was ever downloaded and no text ever swapped fonts. After, we serve the fonts, and they
  download and swap. That costs some FCP on text-heavy pages (Discover, the host page) and adds small font-swap shifts
  (the host page header; part of the /feed → /@host CLS). On a real phone the before case paid two extra origins (DNS,
  TLS) before the first paint; the pages with nothing else in the way show what that was worth: People, Chats and
  Settings FCP 680-710 ms to 430-450 ms.
- Navigation moved within noise (plus or minus 50 ms). It was already mostly under 300 ms to first paint with a warm
  HTTP cache. The service worker's stale-while-revalidate helps most where that cache doesn't: the iOS app's web view
  after a cold start, flaky connections, and offline.

### Budgets, after

| Budget | Status |
|---|---|
| LCP under 1.8 s: feed, invite, host page | invite 1.33 s and host page 1.64 s pass; the signed-in feed is 2.0 s (was 3.2 s) |
| Page to page under 300 ms to first paint (cached shells) | 6 of 8 moves; Discover to Plans 303 ms; the host page to the host's own invite opens the full app |
| INP (first tap) under 200 ms | passes everywhere (8-64 ms) |
| CLS under 0.05 | Discover 0.82 to 0.05, the app 1.2 to 0.2, canvas 1.22 to 0.14. Still over: Plans 0.2, a replied guest's /g 0.34 (one reorder when the ticket draws), the app 0.2, the host page 0.08 (font swap) |
| No long task over 200 ms on load | passes on the invite, Plans, People, Chats, Settings; the app and the host page still have 300-420 ms tasks (drawing Home; the host page's 20 scripts) |

## Load test

`node scripts/loadtest.mjs --users 50 --seconds 20`: 50 people at once, each looping through the feed page, the feed
data (signed in and public), an invite page, the invite's host data, and a reply sent twice with one Idempotency-Key.
In-process server on one CPU, same machine, before and after back to back.

| Step | Before p50 / p95 ms | After p50 / p95 ms |
|---|---|---|
| feed page | 1152 / 2012 | 358 / 484 |
| feed data (signed in) | 407 / 746 | 194 / 257 |
| feed data (public) | 308 / 580 | 191 / 260 |
| invite page | 551 / 964 | 192 / 265 |
| invite host | 410 / 740 | 111 / 161 |
| reply | 208 / 429 | 67 / 100 |
| **throughput** | **97 requests/s** | **281 requests/s** |

No errors in either. Before, every reply sent twice made two replies (328 duplicates in 20 seconds); after, the second
is an idempotent replay (836 replays, none that differed). The per-address reply limit is lifted for the local run
(all the load comes from one address; with it on, replies past 150 an hour from one address get a 429, by design).

What made the difference, from CPU profiles under that load: listing a whole collection (every reply in a workspace)
and parsing each row, once **per event** on every feed and invite request (each card counted its guests by listing all
replies again). The store now keeps whole-collection reads until that collection changes (`server/db.js`: a version per
collection, bumped on any write to it, and dropped on a prefix delete), and read-only callers share one parse
(`listShared`). That was about 55% of server time under load; it is now under 5%.

## What changed

**Server (`server/perf.js`, wired in `server/app.js`)**

- Versioned assets: every same-origin script and stylesheet in a page is served as `/x.js?v=<hash of the file>`, and
  that URL is cached for a year, immutable. An old version number gets the current file with a 5-minute cache, so a
  stale page can never pin the wrong file for a year. Scripts that look for a tag before loading a file now also match
  the versioned URL (no double loads). The service worker keeps its plain URL.
- Fonts: our pages' Google Fonts links point at `/fonts/css2` with the same query, served from `public/fonts` (IBM Plex
  Sans 400/500/600, Plex Serif 600, Plex Mono 500, Caveat 600/700, Fraunces; OFL, licences alongside; woff2 split by
  unicode range, so a Latin page fetches only Latin). `font-display: swap`; the display face is preloaded, except on
  pages that hold fonts back on purpose (the light invite). Families we don't host stay on Google.
- JSON over 1.4 KB goes out brotli (quality 4) or gzip; the feed's data is about 6x smaller on the wire.
- The first request for a new page version no longer blocks the server while it compresses at brotli 11: it gets a
  fast brotli, and the full-quality one is made in the background for everyone after.
- Data preload: the host page, the invite, Discover and the signed-in feed start their first API read from the HTML
  (`<link rel="preload" as="fetch">` with exactly the URL the page's script asks for).
- Speculation rules on full pages: prefetch (never prerender) a same-origin page link on pointer down or hover; never
  the API, uploads, sign-out or links that act when opened.
- Idempotency keys: a POST/PUT/PATCH with `Idempotency-Key` runs once per person, route and key for 10 minutes; a
  duplicate gets the first answer (`Idempotent-Replay: true`), and one sent while the first is running waits for it.
  5xx, 408 and 429 answers aren't remembered, so a retry gets a fresh try.
- The error middleware: API errors answer JSON with a code; unexpected ones log one line with the route and never send
  their message (it can hold internals); a page that fails gets a friendly page with a way back instead of JSON.
- SQLite: WAL was already on; a 5 s busy timeout now waits out a lock (a backup, a second process during a deploy)
  instead of failing the request.

**Client**

- `public/sw.js`: stale-while-revalidate for the shell pages (feed, Discover, Plans, Chats, People, Settings, Saved,
  Ideas, the app) with navigation preload; network first for every other page; cache first for versioned files,
  `/_app/` bundles and fonts; network first with a 4 s timeout for the few read-only APIs the shells open with,
  falling back to the last copy; `offline.html` when there's nothing. Signing out or in drops cached pages and data. If
  a cached page turns out to have changed meaning (it now redirects, for example after a sign-in ran out), it reloads.
- `public/netguard.js` on every full page: identical API reads that start within 250 ms of one still in flight share
  one request (never across a write, and each sharer gets its answer in its own task); a cover photo that fails becomes
  the drawn cover; a sign-in that runs out shows one calm bar with a way back in; a fetch rejected by a dropped
  connection doesn't surface as a crash.
- `public/poller.js`: one shared poller. One task per key, no overlapping runs, paused while the tab is hidden or the
  phone is offline, caught up when it comes back, failures back off (doubling, capped). The chat badge and the chats
  inbox use it.
- `public/shell.js`: a finger landing on any link to one of our pages warms that page into the service worker's cache.
- View Transitions run 150 ms (were 200), and a transition the browser skips is no longer an error.

## Glitches found and fixed

- **/g rewrote itself 55-65 times a second, forever, for every signed-in guest who had replied.** Two layout rules
  disagreed about where the "Follow the host" box goes: `ev2Layout` moved it into the invite card, the ticket rule moved
  it under the ticket, and each move woke the other (a 120 ms debounce kept it at about 8 rounds a second, 8-9 DOM
  changes each, every round waking the page's 122 MutationObservers). The ticket rule now marks the box and
  `ev2Layout` leaves a marked box alone; `ev2Layout` also stopped rewriting attributes that were already right.
- **The feed reloaded itself** on a device's first visit each session to pick up the workspace city: a blank flash and
  everything downloaded twice. The city is now asked for alongside the feed's data, before the first draw.
- **The app's Home made 349 requests**: each event's sign-offs 5 times, the host profile 20 times. Now one request per
  event at a time, one redraw when they land together, and shared identical reads: 163.
- **The app's Home drew the work Home, then swapped it for the friends Home** (CLS 1.2). Home now stays invisible
  until the workspace kind is known (at most 2.5 s): 0.2.
- **Discover's collections pushed "Coming up" off the screen** as they landed (CLS 0.82): placeholders the size of the
  real shelves hold their place: 0.05.
- Signed in, the feed's stories row and tabs popped in above the feed (158 px): their space is held from the first paint.
- Plans: what sits below the plans waits unseen while they load instead of jumping down.
- **Double submits**: the light invite's reply, the app's creates (a new event, replies, kudos; autosave could race
  the Save button into two events), shop orders (the pay link) and bookings carry an Idempotency-Key. The reply keeps
  its code across a retry, so a retry after a dropped answer can't make a second reply.
- **The page-to-page fade was being aborted on almost every move** (found by the crawl as "Transition was aborted ...
  opt-in disabled", an unhandled rejection on the new page). The opt-in (`@view-transition`) lived in craft.css, which a
  script adds after the first paint, so the new page never opted in in time. Every full page now carries the opt-in in
  its head (server/appstore.js), and skipped transitions are caught. The crawl now ends with 0 problems.
- The display serif was used at 20 px on Plans' empty state (the readability test failed at `f33ba88`): it now names
  the serif token, not the display one, so it renders the same and the test passes.

The extended crawl (`scripts/crawl-pages.mjs`) also fails on unhandled rejections, CLS spikes over 0.25, a calm loader
still up 4 s after a page went quiet, and pages rewriting themselves while idle, then taps through the primary nav and
back (the URL and scroll must come back), opens the + sheet, the share sheet and the reply form. Notes from it: the
feed's "Would you go?" deck opens over everything for a new account (by design; the crawl closes it the way a person
would), and a host opening their own `/e/<id>?share=1` is handed to the full invite, so the share sheet doesn't open
there (the invite's hand-off; left for the invite owners).

## Left alone on purpose

- **Splitting the 2.4 MB app (index.html) further.** It's already served as hashed bundles cached for a year, and /g,
  the full invite, still takes about 4 s to its LCP on a throttled phone. Splitting it means moving code that 122
  document-wide MutationObservers and dozens of in-place function overrides depend on, in an order that matters. Most
  guests never see it: shared links open the light invite (1.3 s).
- **The 122 MutationObservers in index.html.** Every DOM change wakes all of them, and many scan the whole document. A
  shared, batched scheduler would cut the app's main-thread time a lot, but it changes when every fix-up runs, which
  needs its own pass with the app's owners.
- **content-visibility on the feed.** Off-screen cards would skip layout, but their real height lands as you scroll,
  which can read as a jump. Not worth it at today's feed length.
- **SQLite synchronous=NORMAL.** Faster writes, but the last transactions can be lost on a power cut; kept FULL.
- **A global fetch timeout.** It would cut off Potto's long streaming answers. Timeouts are per strategy instead (the
  service worker's 4 s API fallback).
- **Font metric overrides** (`size-adjust` on a local fallback face) to remove the font-swap shifts: a visual change,
  left for the design pass.
- **The light invite's size.** Served, it is about 39,200 characters with the version numbers and the data preload,
  under the 40,000 budget but close; the file itself is 38,164.
