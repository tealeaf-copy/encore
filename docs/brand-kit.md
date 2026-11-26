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

The 2026 brand is **Bone and clay**: calm, crafted and grown-up. Think of a well-set table, not a party flyer. Warm neutrals, ink text, one clay accent, an editorial serif for headings and a clean sans for everything else. Every value lives in one block at the top of `public/system.css` (`--pl-*`), and `test/brand-tokens.test.js` checks the text pairs at AA.

### Type

| Role | Face | Use |
|---|---|---|
| Display | **Instrument Serif** (400, one weight) | Headings 20px and up, event titles, the wordmark. Tracking -0.015em. Never bold: the page sets `font-synthesis-weight:none`. |
| Text | **Instrument Sans** (400 to 700) | Body, labels, names, buttons, chips, small titles under 20px (`--sys-title`). |
| Mono | **JetBrains Mono** (400, 500) | Data only: dates, times, counts, step numbers, small eyebrows. Never prose or headings. |
| Hand | Caveat (600) | Captions on scrapbook photos only. Never in routine UI. |

- Tokens: `--pl-font-display`, `--pl-font-text`, `--pl-font-mono`; pages read them as `--sys-display`, `--sys-title`, `--sys-sans`, `--sys-mono`. Never write a family name in a page.
- **Scale:** 13 / 14 / 16 / 20 / 28 / 40, plus a hero display (44 to 80). Labels 14 semibold, help text 13, field text 16 (iOS zooms below that).
- No italics for emphasis. An accent word in a heading (`<em>`) changes colour to clay instead.
- Buttons are always the text face, never the serif.

### Colors

| Token | Name | Hex | Use |
|---|---|---|---|
| `--pl-page` | Bone | #F4F0E8 | page background |
| `--pl-surface` | Paper | #FBF9F5 | cards, fields, sheets |
| `--pl-raised` | Stone | #ECE6DB | quiet panels, chips, secondary fills |
| `--pl-ink` | Ink | #1D1B18 | text, selected chips |
| `--pl-soft` | Soft ink | #5D564E | secondary text |
| `--pl-muted` | Muted | #6E665D | meta, placeholders (still AA) |
| `--pl-line` | Line | #E2DCD1 | card lines |
| `--pl-line-strong` | Strong line | #CFC6B8 | fields, outlined buttons |
| `--pl-accent` | Clay | #9A4128 | primary buttons, focus, accent words |
| `--pl-accent-press` | Clay, pressed | #82361F | hover and pressed |
| `--pl-accent-text` | Clay text | #8E3B24 | links and accent text |
| `--pl-accent-soft` | Clay tint | #F1E1D8 | selected rows, text selection |
| `--pl-sand` / `--pl-sand-soft` | Sand | #E3D7BE / #F0E9DA | highlights and badges (was butter) |
| `--pl-sage` | Sage | #5F6B57 | calm accents |
| `--pl-success` | Moss | #3D6A4C | done, confirmed |
| `--pl-warning` | Ochre | #83590F | needs a look |
| `--pl-danger` | Brick | #A3321E | errors, destructive actions |
| `--pl-focus` | | clay at 28% | the one focus ring |

Contrast: ink, soft and muted read at 4.5:1 or more on bone, paper and stone; clay text reads 6:1 on bone; white on clay is 7.5:1; clay stands 3:1 from the page as a button edge. One accent per screen. No gradients, glows or candy pastels in chrome.

### Shapes and feel

- **Corners:** 8 (fields, small tiles), 12 (cards), 16 (sheets and big cards), 10 for buttons. Chips and avatars stay round. Few full pills.
- **Lines:** 1px. Line for cards, strong line for fields and outlined buttons. Ink for a selected field.
- **Shadow:** almost none. One soft shadow for things that float (sheets, menus). Cards that sit on the page get a line. No offset "sticker" shadows anywhere.
- **Still:** no tilt, squish or lift on controls; no paper grain. The scrapbook touches (tape, a tilt, Caveat) belong to photo moments only.
- **Focus:** the field turns ink with one soft clay ring. One ring, never two.
- **Icons:** drawn line glyphs (1.75px stroke) in the text colour. No emoji as UI: not on buttons, tabs or labels. Emoji are fine as content (a reaction, a host's own emoji).
- **Steps:** "Step 2 of 5 · Details" over a slim segmented bar, never numbered circles.
- **Phones:** sheets come up from the bottom, sized with `dvh`, padded for the notch and the home indicator. Footer buttons sit in their own bar.

### Wordmark

- **The mark** is Potto as a single line drawing: the pot's rim and body in one stroke, two dots and a small smile, in `currentColor` (ink on light, bone on dark). It is the favicon, the app icon (ink on bone, `scripts/make-app-icons.cjs`) and the nav logo.
- **The word** is "pottery lab", lowercase, in Instrument Serif at 25px in the nav (28px in the side rail), tracking -0.01em, ink. The mark sits to its left at 24px with an 8px gap.
- It is chrome: a host's kit never restyles it. Don't recolour it clay, set it in another face, add the old filled clay pot, or put it on a busy photo.

### Potto

Potto is a signature, not a fixture.

- **Use the full character** for moments: empty states, the help panel, milestones (a first event, a recap), the offline and 404 pages, the end of the About page.
- **Don't use him** in routine headers, list rows, cards, avatars next to every message, or as a floating button. Use the line mark there, or nothing.
- His colours: a warm brown outline (#5A3B2B), clay body (#DDA88A), an oat glaze band. Never neon, never on a gradient.
- He speaks at most once per screen, in first person, and never invents facts.

### Illustrations

The line-art covers (`public/eventart.js`) are editorial spot illustrations: a 3px warm-ink stroke, a muted natural ground (oat, clay tint, stone blue, sage, mist) and one spot colour from the clay palette. Fewer objects is better. No saturated purples, mints or primaries.

### UI tokens

Spacing is 4, 8, 12, 16, 24, 32. Fields are 16 apart; a section break is 24. Buttons are 36 / 44 / 52 tall (44 minimum on phones). The tokens live in `public/system.css`; the older names pages use (`--ink`, `--paper`, `--sys-*`, `--fv-*`) point at the `--pl-*` tokens.

### Do and don't

| Do | Don't |
|---|---|
| Serif headings, sans everything else | Rounded or bubbly display faces |
| One clay accent per screen | Ember, butter and pink together |
| A line around a card | Offset sticker shadows, tape, tilts in routine UI |
| Potto in an empty state | Potto in every header |
| The line mark as the logo | The filled clay pot or the full Potto as the app icon |
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
- **Pairings:** Pottery Lab (Instrument Serif + Instrument Sans, the house kit), Supper club, Flower shop, Pantry (slab), Studio, Market day, Terminal (mono headings), Arcade (pixel headings).
- **Two families per page, always.** Display and titles use the display face. Body, meta, chips, list items and prices use the body face. Prices use tabular figures.
- **Colors pass AA.** Text and quiet text read at 4.5:1 on the page and cards, buttons stand out at 3:1 and carry 4.5:1 text, and accent text reads at 4.5:1. The page stays light; dark moods belong to an event's look.
- **Events inherit the kit.** An event's title font is its own only when the host picks one for that event; "Use my brand" puts the kit's back. Looks from before kits keep their font.
- **Where it shows:** the host page, /g and /e, menu cards, shop and experience cards, story cards (face and accent only), /x pages (`brandKitHead` on the server, `EncoreBrandKit.host(h)` in the page) and guest emails (accent and logo).
- **Voice line:** one plain line, no em dashes, at most 80 characters. It is the page's tagline too.
