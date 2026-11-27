# The marketer demo: a script for the owner

A live demo you can run on a call, or send as a link, for the first marketers. It works with no real hosts or brands
on the platform: everything runs on the example hosts and a made-up brand, Fernlight.

## The links

| What | Link |
| --- | --- |
| The demo, with a welcome card and three paths | `/teams/demo` |
| Straight into finding a host | `/teams/demo?path=find` |
| Straight into booking a host | `/teams/demo?path=book` |
| Straight into sending gifts | `/teams/demo?path=gift` |
| Start over (a fresh sandbox) | `/teams/demo?reset=1`, or add `&reset=1` to any link above |

Send each marketer the one path that fits them. No sign-up: the link opens a brand account straight away.

Each visitor gets their own sandbox. Nothing they do reaches real hosts, real brands, emails, texts or cards, and the
sandbox is deleted a day later. "Start over" and "Leave the demo" are on the guide card at every step.

If you're signed in to your own account, the demo asks first and then signs you out. Use a private window to keep both.

## The story

You're Sam Rivera, field marketing lead at Fernlight, a software company. Q1 is customer dinners in three cities: New
York, San Francisco and Chicago. Sam's finance lead, Priya, approves anything over $1,500. Sam already ran one dinner
a few weeks ago (a bakery night in New York) and has a coffee pop-up booked at the San Francisco conference booth. Now Sam needs
a New York customer dinner for 12, flowers for the table, and gifts for the people who came last time. In spring there's
Fernlight's first flagship summit in San Francisco, and the team has no event staff.

Say early: "Every host you'll see is an example. They're made up so you can see how it works. Real hosts in your city
show up as they join."

## Path 1: Book a host (about 2 minutes)

1. Open `/teams/demo?path=book`. The guide card says "Step 1 of 9".
2. Quick book is filled in: a customer dinner, 12 people, New York, about $200 a person. Tap **Find hosts**.
3. Three matches, each with the total for 12, whether the date is open, and the money at risk if plans change.
   Under them, **Often added**: centrepieces from Petal & Stem, a photographer.
4. Tap **Book this** on **Marlow Table** (Ines, a private chef who cooks a five-course tasting menu on site).
5. **Pause here.** The sheet shows the full price, the deposit and the money at risk by date, then the brief: the goal,
   the guest mix (all 12 from Fernlight), who sends invites, the photo rule, the follow-up rule. Say: "The host reads
   this before saying yes, and either side can change it."
6. Tap **Ask for approval**. It's over $1,500, so it goes to Priya.
7. On the booking, tap **Approve as Priya** on the guide card. Status: "Sent to the host".
8. Tap **See what the host sees**. **Pause here.** This is Ines's inbox: the brief, the group, the date, what she's
   paid. Fernlight's email and phone stay hidden until the deposit is paid.
9. Tap **Accept, as Ines**. It's booked. The deposit is held (nothing is charged in the demo).
10. Tap **Open the guest list**. Four people already said yes; invites go by email or a sign-up link.
11. Tap **See a past event's report**. **Pause here.** The bakery night from a few weeks ago: 16 of 18 who said yes came, target accounts in the
    room, three meetings, two opportunities ($84,000 in pipeline), and feedback. Say: "Feedback numbers only show once 10
    or more people answer, and nobody is named unless they said yes."

To add the flowers: from step 3, open **Table centrepieces for a dinner** under Often added. It's priced per table of
8, delivered, set and cleared, $140 a table, 10 days' notice.

## Path 2: Find a host (about 90 seconds)

1. Open `/teams/demo?path=find`. Quick book is filled in for a New York customer dinner. Tap **Find hosts**.
2. Tap **Details** on the first match.
3. The experience page: price for 12, what's included, good-to-know notes (space, diets, access), add-ons like a wine
   pairing, example reviews, dates open for the next three months, and the cancellation terms in plain words.
4. Tap **Save to a shortlist**, then **Open the shortlist**. It's next to the omakase counter Priya voted for.
5. Tap **Compare the two** on the guide card. **Pause here.** Price, terms, reviews and access side by side.

Other searches that work well live: a team offsite for 25 in San Francisco (a redwood offsite day, a morning yoga flow,
a wellness morning with yoga then a sound bath), a matcha workshop for a customer dinner in New York, a coffee pop-up for
a conference booth ("Conference week" in San Francisco), or **Summit help** for 250 in San Francisco (Bayline Summit Co.
plans it, Crewline sends registration and check-in staff per staffer per day, Fieldnote runs a photo booth, Brightframe
makes the recap video). **Food for the office** finds office breakfasts and team lunches (Phin & Night Catering, Corner
Plate Catering).

## Path 3: Send gifts (about 90 seconds)

1. Open `/teams/demo?path=gift`.
2. Pick three or four people from Fernlight's target accounts. **Next**.
3. Pick a maker's gift: a hand-thrown mug, a sourdough and jam box, a matcha starter kit, a bud vase bouquet or a
   walnut macro pad. Each shows the price, lead time and where it delivers.
4. Keep or edit the note. **Next**.
5. **Pause here.** The delivery plan: when each one arrives, how it travels, and the total before anything is sent.
   Each person adds their own address on their page, so Fernlight never handles it.
6. **Send**, then **See what they see**: the note, the gift and when it arrives.

## Likely questions, and honest answers

**Are these real hosts?** No. Every host in the demo is an example, made up so you can see how booking works. On the
live site real hosts always come first; examples only fill the gaps while a city has fewer than three real hosts that
fit, and each one is tagged "Example". Booking an example ends with "Ask us to find a real host for this", which comes
to us.

**What's live today?** Discover, Quick book, experience pages, shortlists, compare, approvals, the request to book, the
host's inbox, deposits, campaigns, guest lists and invites, the survey and the report. Gifting is the newest: the demo
path works end to end, but sending real gifts needs the pieces listed below.

**How do payments work?** A deposit (25% to 50%, set by the host) holds the date once the host accepts. The rest is due
7 days before. Payments go through Stripe; until a brand connects a card, the site runs in test mode and nothing is
charged. Cancellation terms are shown in plain words before anyone pays, and if a host cancels, the brand gets
everything back.

**What does the host see about our guests?** The brief and the group size. Guests' details stay with the brand; a host
sees names only for seats the host fills from their own following.

**What about photos at our events?** The brief sets the photo rule. With brand photography, guests who opt out get left
out, and photographers' usage rights are written on their package.

**How do you keep guest feedback private?** Pooled numbers need 10 or more people across 3 or more events. A quote shows
only if that guest ticked "OK to quote me".

**Can we use our own venue or vendors?** Yes. Many hosts travel to your office or venue, and services (flowers, photos,
catering, staff, a summit planner) can be added to any event.

## What real gifting still needs

The demo is the smallest version that works end to end. Before brands can send real gifts:

- **Payments**: charge the brand's card for the gifts and delivery, pay makers out, refunds when someone says no thanks.
- **Addresses and shipping**: the recipient's address form (kept from the brand), carrier labels and tracking, the
  courier hand-off in a city, and what happens when a parcel is lost.
- **Maker orders**: makers accept an order, confirm stock and lead time, and mark it shipped.
- **Tax and compliance**: sales tax on goods, gift limits for recipients at companies with rules, and international.
- **Notifications**: emails to recipients and makers (the demo sends none).

## Resetting

`/teams/demo?reset=1` throws the current sandbox away and starts a fresh one. Sandboxes older than a day are deleted the
next time anyone opens the demo, and on the daily job. To turn the demo off with the example hosts, set
`ENCORE_HIDE_DEMO=1` (the link then says the demo is off).
