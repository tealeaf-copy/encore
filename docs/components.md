# Shared components: booking hosts for teams

The brand side (Discover, experience pages, shortlists, compare, checkout, bookings) and the host side (Bookable for
teams) are built from one set of pieces in `public/brandbook.css` and `public/brandbook.js`. Use them on any page
where a company finds, weighs up or books a host. Don't copy their styles into a page.

Load them after the design system:

```html
<link rel="stylesheet" href="/system.css"><link rel="stylesheet" href="/brandbook.css">
<body class="bb"> ...
<script src="/eventart.js"></script><script src="/brandbook.js"></script>
```

Every colour is a token from `public/system.css` (`--pl-*`). The highlighter reads `--pl-highlight` and falls back to
`--pl-sand` until the Field Notes tokens land. Corners use `--pl-r-sm`. Lines are thin and ink; rulings between
sections are dashed (`--bb-rule`). No shadows.

## The pieces

| Piece | CSS | JS | Use it for |
| --- | --- | --- | --- |
| Header | `.bb-top` | `BB.top(active, side)` | The quiet top bar. `side` is `"brand"` or `"host"`. |
| Icons | `.bb-ic` | `BB.icon(name)` | Small drawn line icons (24px box, 1.5 stroke) that tilt a little on hover. Moods: `bonding`, `client`, `handson`, `calm`, `celebrate`, `remote`, `under50`. |
| Buttons | `.bb-btn` (`.primary`, `.ink`, `.quiet`, `.lg`, `.block`) | | Every button. 44px tall at least, a small press on tap. |
| Mood chips | `.bb-chips`, `.bb-chip.bb-mood` | `BB.chips(moods, current, onPick)` | Browsing by feeling and occasion. A row that scrolls on phones and wraps on laptops. |
| Summary pill | `.bb-pill` | | "Team of 12 · Next month · Brooklyn". Opens the filters sheet. |
| Sheet | `.bb-sheet` | `BB.sheet(title, html, { onOpen })` | Filters, counters, confirmations. Bottom sheet on phones, centred on laptops. Escape closes it. |
| Card | `.bb-card` | `BB.card(c, { saved, people })`, `BB.expandOnClick(root)` | An experience in a grid. The photo leads; the total for the group is the one bold line. `expandOnClick` gives the photo the hero's view transition name so the card grows into the page. |
| Cover | `.bb-art` | `BB.cover(x)`, `BB.drawn(x)` | The photo, or one of our drawn covers (EventArt) when the photos are weak or missing (`lead: "drawn"`, worked out on the server by `photoLead`). |
| Gallery | `.bb-gallery` | `BB.gallery(x, title)` | Edge to edge. A swipe strip on phones, a 1 + 4 grid on laptops, a count you can tap. |
| Viewer | `.bb-viewer` | `BB.viewer(photos, i, title)` | Full screen, arrow keys, swipe, Escape. |
| Trust row | `.bb-trust`, `.bb-verify` | `BB.trustRow(stats)`, `BB.verifyRow(stats)` | The host's numbers (rating, events, years, would go again, reply time, reply rate, repeat bookings) and checks (email, phone, ID, insurance). Only real numbers; a missing one is left out, never guessed. |
| Badges | `.bb-badge` (`.trusted`, `.instant`) | `BB.trustedBadge()` | The earned Trusted host badge and Instant book. |
| Price box | `.bb-price`, `.bb-lines` | `BB.priceBox(price, terms, opts)`, `BB.priceLines(price)` | The total for the group first, then every line (a person × headcount, any group minimum, the booking fee, sales tax), the deposit and the terms. Takes the `priceFor()` answer from the server as is. |
| Terms | `.bb-terms` | `BB.termsList(terms)` | Cancellation and deposit terms in plain words, from `cancellationTerms()`. |
| Reviews | `.bb-tabs`, `.bb-reviews` | `BB.reviews({ brands, guests })` | Team reviews and guest kudos, always in separate tabs. |
| Calendar | `.bb-cal` | `BB.calendar(month, { picked, pickable, flex })`, `BB.legend()` | The host's availability. `flex` highlights the days that fit "any weekday evening in March". |
| Map | `.bb-map` | `BB.map(places, { on })` | A drawn map with approximate areas only (see below). |
| Steps | `.bb-steps` | | Checkout progress. |
| Thread | `.bb-thread`, `.bb-msg`, `.bb-compose` | | Messages on a booking. |
| Compare | `.bb-cmp` | | Two or three experiences side by side, the best on each line highlighted. |
| Toast | `.bb-toast` | `BB.toast(text)` | A short "Saved" after an action. |
| Saving | | `BB.saveTo(handle, pkg, people)`, `BB.savedKeys()` | Save to the team's shortlist without committing. Signed out, it asks to sign in. |

## Rules the pieces keep

- **The full price, always.** Show `price.summary` ("$1,440 total for 12") wherever a price shows. The lines in
  `price.lines` always add up to the total. A booking fee is a dollar line, never a percentage.
- **Private until booked.** Never put an address, email or phone on a page a team sees before booking. The server
  only sends them once a booking is booked (`contactFor`), and hides them in messages until then (`scrubContact`).
- **Approximate places.** The map takes `approxArea()` answers: a neighbourhood centre rounded to two decimals,
  with a radius. We draw it ourselves rather than load map tiles, so there's no key and no third-party request; the
  neighbourhood list under the map is the accessible version. A live OSS tile layer (OpenStreetMap) can sit under the
  same circles later.
- **Motion is quiet.** Cards grow into the experience page with the View Transitions API (`@view-transition`);
  `prefers-reduced-motion` turns it off. Press states are a 1-2% scale.
- **Words.** Plain, warm, short. prices read "$X a person". No em dashes.

## Where the data comes from

`server/brandbook.js` exports the rules these pieces show: `priceFor`, `cancellationTerms`, `refundFor`,
`trustedCheck` (and `TRUSTED`, the published criteria), `qualityScore`, `instantEligible`, `availabilityFor`,
`flexLabel`, `approxArea`, `shortlistRole`, `reviewsFor`, `contactFor`, `invoiceOf`. Tests: `test/brandbook.test.js`.

## Payments

Deposits go through a provider: Stripe Checkout in test mode when `STRIPE_SECRET_KEY` is a test key (a live key also
needs `ENCORE_STRIPE_LIVE=1`), otherwise a fake that marks the deposit held. Payments never happen in the App Store
app (`web_only`). Payouts to hosts by Stripe Connect aren't set up yet; the host's Payouts tab says so plainly.

## ID checks

`POST /api/bb/host/verify/id` puts a host in a manual review queue at `/admin/hosts` (ENCORE_ADMIN_EMAILS only).
TODO(id-provider): send hosts to an ID check provider and take its webhook as the decision.

## Brand Home, Insights and Campaigns

`public/teams-intel.css` adds the pieces for `/teams/home`, `/teams/insights`, `/teams/campaigns` and the printable
report, on top of the ones above: stat tiles (`.ti-tiles`, `.ti-tile`), bars (`.ti-bars`), the trends table
(`.ti-table`), ranked fit rows with a score (`.ti-fit`, `.ti-score`), the tag input (`.ti-tags`), the budget meter
(`.ti-meter`, committed solid, waiting hatched), campaign cards (`.ti-camp`), KPI rows (`.ti-kpis`), the guest list
(`.ti-guests`) and the day-of check-in list (`.ti-people`, `.ti-check`). The Run view reuses the plans timeline
(`public/timeline.css`). Every number a brand sees about guests follows the Insights rules in `server/insights.js`
(10+ people and 3+ events behind a cell, people in bands, opt in, no identities); the explainer is
`/teams/insights/how`. Tests: `test/insights.test.js`, `test/campaigns.test.js`.

## Quick book, briefs and outcomes

`public/teams-panel.css` and `public/teams-panel.js` (`window.TP`) add the brand panel pieces from `server/brandpanel.js`:
Quick book (`TP.quickBook`, the first thing on /teams/home and /teams/discover), the event panel on a booking
(`TP.eventPanel`: owner, approval, the brief, money at risk by date, seats, survey, the summary link, series and book
again), the host's Confirm and Earnings tabs on /host/teams, outcomes and CRM sync (beta) on a campaign's Measure tab
(`TP.outcomes`), who an invite is from (`TP.inviteFrom`), recommendations with confidence labels (`TP.recs`) and "What
it's like" on experience pages (`TP.like`). Pages: /teams/hosts, /survey/<token>, /teams/e/<id>?k= (read-only summary),
/admin/brand-metrics (admins only). Every share shows what it's out of, and a percentage only from 5 answers up. CRM
setup: docs/crm-sync.md. Tests: `test/brand-panel.test.js`.
