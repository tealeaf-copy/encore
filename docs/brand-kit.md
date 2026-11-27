# Pottery Lab brand kit

The one place to check before writing a line of copy, designing a screen, or briefing someone on Pottery Lab.

## What we are

Pottery Lab is where hosts plan memorable experiences for their favorite people, and build a page that shows what they host. Over time, strangers find them, follow them, and brands book them.

It is not a marketplace first. Hosts come first, guests second, brands last.

**Tagline:** Host memorable experiences, with your fav people.
**Line under it:** We've been the planner. This is the tool we wished we had.

Use both exactly as written. Don't rephrase them.

## The story, in order

1. **Host.** You plan an event for your people. Potto drafts the invite and sends the reminders.
2. **Keep it.** Every event lands in your scrapbook, with photos and kudos from guests.
3. **Get found.** Your page shows up on Discover. Strangers follow you and hear about your next event first.
4. **Get booked.** Brands with a reason to meet your followers send a request. You quote, or pass.

Always tell it in this order. Brands never lead.

## Who we write for

- **Hosts** (first): run clubs, supper clubs, bakers, pottery and matcha workshops, foodie creators, hike leaders, dance and improv teachers. They are busy and do this because they love it.
- **Guests** (second): friends of the host, and strangers who found the host on Discover. They want to reply in one tap.
- **Brands** (last): teams planning a launch, an offsite or a thank-you. They want clear dates, prices and terms.

## Voice

Warm, plain and grown-up. Like a friend who has hosted a lot of dinners and doesn't need to shout about it.

- **Plain words, short sentences.** Lead with what the person gets or does.
- **A light touch, rarely.** At most one per screen. No exclamation marks, no cutesy phrasing, no jokes in every line.
- **Buttons are verbs**, 1 to 3 words: "Start your page", "Share invite", "I'm in".
- **Headings** are 2 to 6 words. At most one sentence under a heading.
- **Say what it does.** "Potto sends the reminders", not "planning made magical".
- **Brand screens are precise.** Money, dates and terms are exact. Save the playful bits for headings and empty states.
- **Be honest.** No invented stats, testimonials, logos or press. No promises the product doesn't keep.

### Potto

Potto is a small clay pot and the host's helper. He speaks rarely (at most once per screen), in first person, one short line ("I'll send the reminders."), and never invents facts about a host, guest or brand. Where he appears is under "Look", below.

## Words

One word per thing, everywhere: in headings, buttons, emails and error text.

| Use | Not |
|---|---|
| host | organizer, creator (as a role name) |
| guests | attendees, participants, users |
| brands | companies, clients, sponsors |
| spots | seats, tickets (unless it's paid) |
| your page | profile, storefront, workspace |
| scrapbook | portfolio (in product copy), archive, timeline |
| event, experience | gathering, meetup |
| I'm in / Maybe / Can't go | RSVP yes, I'm going, can't make it |
| Ask to join / Let in / Not this time | approve, reject, deny |
| Follow / Following | subscribe, fan |
| Request a date (until quoted), Book (instant dates only) | buy, purchase, checkout |
| $X a person | per person, pp, /head |

"Portfolio" is fine in marketing copy ("a portfolio of the experiences you host"). Inside the product, it's the scrapbook.

### Phrases we don't use

- "taped in", "taped into", "tape it in". It isn't natural. Say "in your scrapbook" or "on your page".
- "marketplace"
- "seamless", "effortless", "unlock", "elevate", "curated", "magical"
- "gatherings" (except in older owner-approved copy)
- "publish" in host copy. The action is "Share invite".
- "said I'm in", "say yes". Use "were in", "lets you in".

## Punctuation and format

- No em dashes. Use a period or a comma.
- Sentence case for headings and buttons.
- At most one emoji per element. None in headings.
- Times read "Sat · 7pm". Dates read "Sat, Dec 12".
- Straight quotes.

## Fixed lines

Use these word for word.

- Balance: "50% deposit to confirm. The rest is due 7 days after the event, once everything listed is delivered."
- Cancellation: "Free to cancel up to 7 days before. Inside 7 days, half the quote."
- Host guarantee: "If your host can't make it, we find a replacement or refund you."
- Never print a fee or take-rate percentage.

## Look

The brand is **Field Notes** (Dec 2026): a well-made zine from people who build things. Linen paper, ink lines, one ink-blue accent and a highlighter yellow for the odd marked-up word. A friendly sans with real weight for headlines, its sturdy serif sibling for event titles, mono kickers and issue numbers. Calm and grown-up, like a well-kept notebook: not a terminal theme, not brutalist, not a dev tool. Every value lives in one block at the top of `public/system.css` (`--pl-*`), and `test/brand-tokens.test.js` checks the text pairs at AA.

### Type

| Role | Face | Size | Use |
|---|---|---|---|
| Headline | **IBM Plex Sans 600** (`--pl-font-display`, `--sys-display`) | 40/44 (28 for section heads) | Page and section headlines, the wordmark. Tracking -0.02em. |
| Event title | **IBM Plex Serif 600** (`--pl-font-serif`, `--sys-serif`) | 22/28 | Event and card titles, pull quotes. |
| Body | **IBM Plex Sans 400** (`--pl-font-text`) | 17/27 | Reading text. Never under 16px. |
| Meta | **IBM Plex Sans 500** | 15/22 | Dates, places, counts, captions; in soft ink. |
| Kicker | **IBM Plex Mono 500, caps** (`--pl-font-mono`) | 13, tracking 0.04em | Kickers, issue numbers ("No. 48"), data labels, status chips. Never reading text. |

- Fonts load once, from Google Fonts, with only the weights used (Sans 400/500/600, Serif 600, Mono 500) and `display=swap`.
- Pages read the tokens (`--sys-display`, `--sys-serif`, `--sys-title`, `--sys-sans`, `--sys-mono`); never write a family name in a page.
- No italics for emphasis. Mark a word with the highlighter (`<mark>` or `.pl-hl`) instead, once per screen at most.
- Buttons are the text face at 600.

### Reading rules (any brand)

These hold whatever the palette and faces are, and the tests check them:

- **Body text is 16px or more** (`--pl-body-size`, 17px in Field Notes), paragraphs at an easy line height (`--pl-body-lh`).
- **The headline face only at 24px and up** (`--pl-display-min`). Anything smaller is the text face at 600, or the serif for an event title. `test/readability.test.js` scans every stylesheet; the wordmark is the one exception and is pinned at 25px.
- **Secondary text is not faint:** soft ink reads about 7.8:1 on the page, and nothing is fainter than soft ink.
- **Cards have a clear edge:** a 1.5px ink line, not a slightly whiter fill.
- **No text on a busy cover** without a solid chip behind it (the host chip, the "No. 48" label).

### Colors

| Token | Name | Hex | Use |
|---|---|---|---|
| `--pl-page` | Linen | #EFEBE2 | page background |
| `--pl-surface` | Notebook | #FAF8F3 | cards, fields, sheets, the tab bar |
| `--pl-raised` | | #E6E1D5 | quiet panels, secondary fills |
| `--pl-ink` | Pen | #1B1D1C | text, card and button lines, the "+" button (14.2:1 on linen) |
| `--pl-soft`, `--pl-muted` | Pencil | #444845 | secondary text and meta (7.8:1 on linen) |
| `--pl-line` | Ruling | #CFC8B9 | hairlines and dashed dividers, non-text only |
| `--pl-line-strong` | Pen | #1B1D1C | fields, outlined buttons, cards (1.5px) |
| `--pl-accent`, `--pl-accent-text` | Ink blue | #29489A | primary buttons (white text, 8.4:1), links and kickers (7.1:1 on linen) |
| `--pl-accent-press` | | #1F3878 | hover and pressed |
| `--pl-accent-soft` | | #E3E8F4 | selected rows, text selection |
| `--pl-sand` | Tint | #F3E7A8 | perk strips, status chips (ink text, 13.6:1) |
| `--pl-highlight` | Highlighter | #F2DD6B | marked words, badges (ink text) |
| `--pl-tomato` | Tomato | #C2431F | the live dot and covers only |
| `--pl-moss` | Moss | #56683F | covers and tags |
| `--pl-success` / `--pl-warning` / `--pl-danger` | | #3E5A2C / #7A5410 / #A2361A | status, each on its soft tint |

One accent per screen. No gradients or glows. **One light look everywhere:** no page flips dark, and no event look has a dark page (below).

### Shapes and feel

- **Corners:** 6px on buttons, cards, fields and covers (`--pl-r-*`); 4px on covers inside a frame; chips and avatars stay round.
- **Lines:** 1.5px ink on cards and buttons (`--pl-bw`); dashed rulings between list rows and before a card's footer, like graph paper (`--pl-rule-dashed`); a 1.5px ink rule over each section (`--pl-rule`).
- **Shadow:** none. Edges are drawn, not lifted: a sheet or menu that floats gets an ink outline (`--pl-shadow-float`).
- **Covers** sit in a 1.5px ink frame (`.pl-frame`) with an optional mono label in the corner (`.pl-frame__label`: "No. 48 · Supper club").
- **Icons:** drawn line glyphs in the text colour. No emoji as UI.

### Magazine patterns (shared classes in `public/system.css`)

- **The weekly edition** (the feed): a masthead (`.pl-masthead`: "THE WEEKLY EDITION · NO. 48 · DEC 1 TO 7"), the cover story, "Hosts we love", a guest pull quote (`.pl-quote`), "Near you". Sections are `.pl-sec` with a `.pl-sec__head` and a "See all" (`.pl-sec__more`).
- **The event card** (`.pl-card`): the host on the photo (`.pl-card__host`) and an issue label (`.pl-card__no`); a perk strip in the tint (`.pl-card__perk`); the place with a heart (`.pl-card__place`); the serif title (`.pl-card__title`); meta (`.pl-card__meta`); a dashed hairline (`.pl-card__rule`); a status chip (`.pl-chip`, with `.is-few`, `.is-live`, `.is-wait`) plus the date (`.pl-card__foot`); who's in (`.pl-card__proof`) and "I'm in". The feed's existing cards (`.fv-card`) and Discover's (`.ev-poster`) already take the frame and the serif title.
- **The type tag** (`.pl-type`, `public/eventtypes.js`): one small tag on every event, drop and booking card and page saying what kind of thing it is: Pop-up, Pickup, House party, Dinner, Class, Active, Games, Trip, Talk, Experience, or a neutral Event. Each has a quiet tint and an ink-safe text colour (`--pl-type-<key>-bg` / `-fg`, AA for small text), a line icon and the word, in Plex Mono caps with 6px corners. It never takes a host's brand kit colours, so guests learn it once. Discover and the map filter with chips in the same colours (`.pl-type-chip`). "Example" stays its own quiet label.
- **Search:** a quiet "Anywhere · Any night" row (`.pl-search`, `.pl-search__field`, `.pl-search__filter`).
- **The tab bar:** notebook paper, with a round ink "+" for starting something (`.pl-tab-plus`).

### Wordmark

- **The mark** is a drawn square (6px corners, 2.5 stroke on a 48 grid) holding a straight-line Potto, with two ink-blue dot eyes. It is the favicon (`public/favicon.svg`), the app icons (`scripts/make-app-icons.cjs`), the og cards (`scripts/make-og.cjs`) and the nav logo. Lines are `currentColor`, so it works in ink on linen and in white on ink or blue.
- **The word** is "pottery lab", lowercase, in IBM Plex Sans 600 at 25px in the nav, tracking -0.03em, ink. The mark sits to its left at 28px.
- It is chrome: a host's kit never restyles it.

### Potto

Potto is a signature, not a fixture. The straight-line Potto in the mark speaks for the brand in headers; the full character is for moments (empty states, milestones, the offline and 404 pages). He speaks at most once per screen, in first person, and never invents facts.

### Illustrations and event looks

- The line-art covers (`public/eventart.js`) sit on muted linen grounds with one spot colour from the brand: ink blue, moss or tomato. The highlighter can mark a detail.
- **Event looks** (`public/looks.js`) are all light. The night, jazz, velvet, market and terminal looks keep their mood through the cover art, the effect and a deep accent on a pale page of their own hue. Events saved with an old dark look are mapped at read time to the light look of their family (`EncoreLooks.LEGACY`), and any dark page colour (a dark flyer, an old custom palette) renders as a pale page of its hue (`EncoreColor.pageFrom`). Every look's title, body, button label and link pass AA (`test/look-palettes.test.js`).

### UI tokens

Spacing is 4, 8, 12, 16, 24, 32. Buttons are 36 / 44 / 52 tall (44 minimum on phones). The older names pages use (`--ink`, `--paper`, `--sys-*`, `--fv-*`) point at the `--pl-*` tokens, so a new brand is a change to the token block.

### Do and don't

| Do | Don't |
|---|---|
| Plex Sans headlines, Plex Serif event titles | Mono for reading text |
| One ink-blue accent per screen | Tomato on buttons or text |
| A 1.5px ink line around a card | Shadows, glows, gradients |
| The highlighter on one word | Highlighter paragraphs |
| Light pages, mood in the cover | Dark event looks |
| Plain "I'm in" | "🎉 I'm in" as the default label |

## Platform frame vs host content

The platform owns the frame; the host owns the content inside it.

- **Shared surfaces** (the feed, Discover, stories, the swipe deck, search, lists, the chats inbox) always use Pottery Lab type, card chrome, spacing and buttons. From the host they show only the cover photo (a fixed 4:5 crop at their saved focal point), the title (which we set, below the image), their avatar or logo, and at most a subtle accent: one small dot or a thin line. Never the host's fonts. `EncoreBrandKit.storyStyle()` returns the accent only.
- **Quality fallback:** on a shared surface, a cover that is missing, under 600px wide, or fails a simple brightness and contrast check is replaced by our drawn cover in the platform style.
- **Host-owned surfaces** (`/@handle`, `/e`, `/g`, `/i`, `/x` pages, drops) wear the host's kit, but only through tokens inside our components and grid.
- The brand kit editor shows "Preview in feed": the host's card between two plain sample cards, so they see how it sits in the frame.

## Examples

**Good**
- "Host memorable experiences, with your fav people."
- "If you love it, you can host it."
- "A scrapbook of every event you host."
- "Found by strangers. Booked by brands."
- "No one's asked yet."

**Not like this**
- "Every event, taped in." (unnatural)
- "Unlock seamless event experiences." (filler)
- "Join 10,000 hosts." (invented number)
- "Brands find you later." (brands lead the story)

## Host brand kits

Each host can have their own kit (`server/brandkit.js`, `public/brandkit.js`, `public/brandkit.css`). It sits on top of the UI tokens above: a page sets `--kit-*` once on `<html>`, and `brandkit.css` points the tokens at them.

- **A kit is:** one font pairing (a display face and a body face), a palette (page, cards, text, accent, an optional second accent), corners (soft or crisp), buttons (filled pill or outlined), covers (photo, line art or card deck), an optional logo and a voice line.
- **Pairings:** Pottery Lab (IBM Plex Serif + IBM Plex Sans, the house kit), Supper club, Flower shop, Pantry (slab), Studio, Market day, Terminal (mono headings), Arcade (pixel headings).
- **Two families per page, always.** Display and titles use the display face. Body, meta, chips, list items and prices use the body face. Prices use tabular figures.
- **Reading guardrails.** Body text is 16px or more (`--kit-body-min`). The body face is always a sturdy text face: never a script, hairline, mono or display-only face (`EncoreBrandKit.bodyOk`, checked on save). The display face is for titles of 20px and up, 24px for thin faces (Flower shop: `html.kit-thin`); `h3` and anything smaller is the body face at 600.
- **Colors pass AA.** Text and quiet text read at 4.5:1 on the page and cards, buttons stand out at 3:1 and carry 4.5:1 text, and accent text reads at 4.5:1. The page and cards stay light, on the server too: `cleanKit` stores a light page and light cards whatever is sent.
- **Events inherit the kit.** An event's title font is its own only when the host picks one for that event; "Use my brand" puts the kit's back. Looks from before kits keep their font.
- **Where it shows:** the host page, /g and /e, menu cards, shop and experience cards, story cards (face and accent only), /x pages (`brandKitHead` on the server, `EncoreBrandKit.host(h)` in the page) and guest emails (accent and logo).
- **Voice line:** one plain line, no em dashes, at most 80 characters. It is the page's tagline too.
