# Paid memberships

Hosts who have hosted 5 or more events can start a membership. Guests back them with $5, $10 or $20 a month (or a
yearly price) and get priority access to their events. The money goes to the host through Stripe. Pottery Lab never
sees a card number.

The code: `server/memberships.js` (server) and `public/memberships.js` (the card at `#membership` on a host's page,
and a small card on the host's Home). Hooks into `server/fanclub.js`, `server/seats.js` and the reply and order
checks in `server/app.js` are marked "memberships hook". Tests: `test/memberships.test.js` (Stripe is stubbed, no
network).

Memberships stay off until the owner sets them up. Until then a host who qualifies reads "Memberships need payments
set up. We'll let you know when they're on." and the owner (anyone in `ENCORE_ADMIN_EMAILS`) sees a setup checklist on
the same card and at `GET /api/admin/memberships`.

## Setup for the owner

Do it in Stripe's test mode first (the toggle at the top of the Stripe dashboard), then repeat with live keys.

1. **A Stripe account.** Sign up at stripe.com, then finish "Activate payments" (business details and the bank account
   your own fees land in).
2. **Turn on Connect.** Dashboard > Connect > Get started. Choose "Platform or marketplace", and **Express** accounts
   for the people you pay out. Under Connect > Settings:
   - Branding: name "Pottery Lab", icon, brand color `#29489A`. Hosts see this during onboarding.
   - Onboarding: the countries you support (start with the United States).
   - Express dashboard: leave on. Hosts reach theirs from "Payouts in Stripe" on their membership card.
   - You don't need OAuth for Express accounts, so `STRIPE_CONNECT_CLIENT_ID` is optional. Set it only if you later
     move to Standard accounts.
3. **Turn on Billing.** Dashboard > Billing. Nothing to configure for memberships: each host's products, prices and
   Customer Portal settings are created on their own account by the server when they open memberships.
4. **The webhook.** Dashboard > Developers > Webhooks > Add endpoint:
   - URL: `https://<your site>/api/stripe/webhook` (your `ENCORE_PUBLIC_URL` plus that path)
   - **Listen to: Events on Connected accounts** (the subscriptions live on the hosts' accounts)
   - Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
     `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `account.updated`
   - API version: 2024-06-20 or later (the server sends `Stripe-Version: 2024-06-20` on its own calls and reads the
     period end from either place newer versions put it).
   - Copy the endpoint's **Signing secret** (`whsec_...`).
5. **Keys.** Dashboard > Developers > API keys: copy the **Secret key** (`sk_live_...`, or `sk_test_...` in test
   mode). A restricted key (`rk_...`) works too if it can write Accounts, Account Links, Products, Prices, Checkout
   Sessions, Billing Portal, Subscriptions and Login Links.
6. **Environment variables on Render.** Dashboard > your service > Environment > Add environment variable, then Save
   (Render redeploys):

   | Variable | Value |
   |---|---|
   | `STRIPE_SECRET_KEY` | `sk_live_...` (or `sk_test_...`) |
   | `STRIPE_WEBHOOK_SECRET` | `whsec_...` from step 4 |
   | `ENCORE_PUBLIC_URL` | `https://<your site>`, no trailing slash. Stripe's return links and the webhook URL use it |
   | `ENCORE_MEMBERSHIP_FEE_BPS` | Your cut in basis points. `0` at launch (unset is 0). `250` = 2.5%. Capped at 3000 |
   | `STRIPE_CONNECT_CLIENT_ID` | Optional, see step 2 |
   | `ENCORE_MEMBERSHIPS` | Optional. `0` turns memberships off again without removing the keys |

   Memberships turn on only when both `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set and look right.
   Note: `STRIPE_SECRET_KEY` is also what brand bookings (`server/brandbook.js`) use for deposits. With a test key they
   go through Stripe test mode; with a live key they stay on the fake provider unless `ENCORE_STRIPE_LIVE=1`.
7. **Check it.** Sign in as an admin and open `/api/admin/memberships` (or your own host page): every line of the
   checklist should read ok. In test mode, make a host with 5 past events, connect a test Express account (Stripe's
   test onboarding accepts `000-000-0000` and test bank numbers), open memberships, then join from another account
   with the card `4242 4242 4242 4242`. The Stripe CLI can replay events: `stripe trigger customer.subscription.created`.

## How it works

- **Who qualifies.** 5 events with a past date that aren't cancelled, examples or samples, and where at least one guest
  said I'm in or was checked in (an RSVP or the door list). Example hosts (`@demo.encore`) and preview pages
  (`public/presets`) never qualify. Below 5 the host sees "2 more events and you can start a membership" on Home, the
  fan club card and the membership card.
- **Tiers.** Up to 3, at $5, $10 or $20 a month. The host names each one and writes one line ("Regular", "Friend of
  the house", "Patron"). Yearly is 10x monthly to start, editable from 6x to 12x. Perks per tier: book early (12
  hours to a week before the public), seats held for members, members-only events, a member badge, a monthly note.
  A higher tier never gets a shorter head start than a lower one.
- **Money.** Each host gets a Stripe Connect Express account (Stripe does the identity checks and payouts). Products
  and prices live on the host's account. Sign-up is Stripe Checkout on that account; Stripe calls this a direct
  charge, so the host is the seller on the member's statement. The Customer Portal on the host's account lets members
  switch tiers, update their card or cancel. Cancelling takes effect at the end of the paid period, so members keep
  their perks until then.
- **Webhooks.** Every request's `Stripe-Signature` is checked against the raw body (HMAC-SHA256, 5 minutes of
  tolerance). Each event id is handled once; an older event that arrives after a newer one is ignored. A payment that
  fails leaves the member in `past_due` (still with access while Stripe retries) and tells them to update their card.
- **Priority access.** When a host publishes, the top tier can book at once and each lower tier opens later; the event
  opens to everyone after the top tier's head start (the host can change the time, the held seats, or switch the
  window off per date under "Your dates"). The check runs on the server in every reply and order. Who is a member
  comes from the signed-in account (or an email the guest proved through their reply link), never from the email in
  the form. Everyone else reads "Opens to everyone on Fri at 10am" and can join the waitlist; people who wait move up
  when it opens to everyone. A personal invite from the host skips the wait. Orders (drops) don't wait in line.
- **Held seats.** A "member" block in `server/seats.js`, for the lowest tier with the seats perk and up. Never more
  than the event has. Unclaimed held seats go to everyone when the event opens to the public.
- **Telling members.** Each tier hears when its window opens (the bell, a push, an email), and members who muted the
  host's club don't. Followers hear when it opens to everyone, as before.
- **Blocks and removals.** A member the host blocks or removes loses their perks at once, and their subscription is
  set to cancel at the end of the period (no further charges). Refunds are the host's call, from their Stripe
  dashboard. "Stop taking members" sets every subscription to end with its paid period.
- **Capacity.** Hosts can hold seats, not sell guaranteed ones: held seats can't exceed the event's spots, and a
  membership never promises a seat.

## Fees

- Stripe's card fee comes out of each payment on the host's account (in the US, about 2.9% + 30c per charge; check
  stripe.com/pricing). Stripe Billing adds a small percentage of recurring revenue, and Connect charges for active
  Express accounts and payouts on the platform's account. See Stripe's pricing page for the current numbers.
- Pottery Lab's own cut is `ENCORE_MEMBERSHIP_FEE_BPS` (0 at launch), taken as an application fee on each
  subscription payment and paid to the platform account.

## The apps (iPhone and Android)

Per the earlier decision, memberships are sold on the web only. App Store guideline 3.1.1 (and Google Play's
payments policy) treats a subscription to a creator's perks as a digital purchase that would otherwise need in-app
purchase. So in the native wrapper (`isNativeReq`: the `PotteryLabApp/` user agent or `x-encore-native: 1`):

- The membership card shows the tiers and what each gets, with no prices and no buy button. It reads "You can join on
  the web" with a button that opens the host's page in the browser (the Capacitor Browser plugin).
- `POST /api/me/membership/:handle/checkout` and `/portal` answer 403 `web_only` from the app.
- Connecting Stripe as a host also happens on the web.

Linking out from the app is allowed in the US App Store since 2025 and through Apple's link-out entitlements in some
other regions; check the current rules for each storefront before release, and drop the link (keep the text) where
it isn't allowed.

## Not covered yet

- Minors, taxes (sales tax or VAT on digital subscriptions: Stripe Tax can be turned on per host account), and other
  compliance are not in scope. Hosts are the sellers and responsible for their own taxes.
- Members-only chat for one tier, and a per-tier note schedule, are not built; the note goes to the chosen tier and
  up whenever the host sends it.
- SMS replies to a host's text invite skip the members window (the host invited that number personally).
- Moving existing subscribers to a new price when the host changes one is manual (Stripe keeps them on the old price).
