# Potto by text, and invites by text

Two things ship for the Dec 5 launch:

1. **Invite only, shared by text.** Every member has 5 personal invites. "Text an invite" on the Plans page opens the phone's Messages with a personal note and a one-use link. No carrier approval is needed for this part: the text goes from the member's own phone. It works the moment the code is deployed.
2. **Potto by text and WhatsApp.** People text Potto to reply to invites, check plans, order from drops, and (hosts) draft events, see who's in, remind guests and move a time. This part is built and tested, and stays **off** until the Twilio (and optionally WhatsApp) settings below are added.

Code: `server/friendinvites.js`, `public/invites.js`, `public/join-friend.html` (invites); `server/pottotext.js` and the "Text with Potto" section in `public/settings.html` (texting). Tests: `test/friend-invites.test.js`, `test/potto-text.test.js`.

## Part 1: invites by text (on now)

- **Count.** `ENCORE_INVITES_PER_MEMBER` (default 5). The Plans page shows "Invite a friend (4 left)". An invite comes back when it runs out or the member takes it back. Admins give more on `/admin/invites`.
- **The link.** `https://<your domain>/join/FXXXXXXXXX`: one use, 30 days, can be taken back. It opens a warm page, "Maya invited you to Pottery Lab", with Maya's face and one line. "Join with your phone or email" goes to sign-up with the code already held, so nobody is asked for an invite code. When they join they're friends with Maya.
- **On the phone.** iPhone opens `sms:?&body=`, Android `sms:?body=`; a computer uses the share sheet, then copies. The event share sheet's Messages button uses the same rule, so hosts texting event invites need nothing from us either.
- **Without an invite.** People join the waitlist from the sign-up screen. Approve them on `/admin/invites`: they get a one-use link by email, or one text to the number they gave.
- **Tracking.** `/admin/invites`: invites made, opened, joined, conversion, top inviters, recent joins, the waitlist and the Potto by text status line.
- Invite-only itself is the existing `ENCORE_INVITE_ONLY=1` (with `ENCORE_FOUNDER_CODES` for the first hosts).

## Part 2: Potto by text

### What Potto can do by text

Guests:
- "what's on this weekend": 3 picks from their city and interests, with links
- "I'm in" / "can't make it" / "maybe", to the latest invite or a named one ("I'm in for dumpling night"); "change my reply to maybe"
- "where is it" (the address only if they're in and the host shared it), "when is it", "add to calendar" (a link), "what should I bring", "who's going" (first names only, and only what the guest list already shows them)
- "my plans"
- "2 slices for saturday pickup": Potto reads back the order and total, and places it only after YES
- "talk to a person": opens a help ticket with the last few messages attached
- photos, covers, payments: a short link into the app

Hosts:
- "dumpling night sat 7pm at mine for 8": a draft, with a link to look it over. It is never published until they text "publish" or tap Publish.
- "who's in for taco night", "today's summary"
- "remind my guests": shows the message, posts to the group chat only after YES
- "move it to 8pm": asks first, then changes the time through the normal edit, which tells guests

Every action runs as that person through the app's own API (the same checks, limits and privacy rules as the app), with a session that lasts one message.

### Messages Potto starts (only for people who turned it on)

- the day before an event they're in: time and address
- "your order is ready for pickup" when the host marks it ready
- hosts: the first yes right away, then later replies together, about every 30 minutes
- "a spot opened up, you're in"
- a waitlist approval (one text, to someone who gave their number to join the waitlist)

### Safety and consent

- **Verified numbers only.** The number must be confirmed by code on an account (Settings). An unknown number gets one reply a day: "Hi, I'm Potto from Pottery Lab. I'd love to help, but I don't know this number yet. Add it in your settings and we're set: <link>". Nothing else happens for it.
- **Opt in.** "Text with Potto" in Settings is off by default. Turning it on records the time and this wording: "I agree to get texts from Potto at Pottery Lab about my plans, replies and orders, and to text Potto to use the app. Up to 6 messages a day. Msg & data rates may apply. Reply STOP to stop, HELP for help." Texting START from a verified number also opts in.
- **STOP, UNSUBSCRIBE, CANCEL, END, QUIT** stop everything to that number and are recorded on the same stop list the rest of the app uses. After STOP only START and HELP get an answer. On SMS, Twilio's own opt-out reply goes out (keep Advanced Opt-Out on); on WhatsApp Potto confirms.
- **HELP** answers: "Potto from Pottery Lab. I can reply to invites, share your plans and place orders by text. Help: <site>/help or <support email>. Msg & data rates may apply. Reply STOP to stop."
- **Quiet hours.** Nothing Potto starts goes out from 9pm to 9am where the person is (their city, else `ENCORE_TZ`); it waits for 9am. Muted hosts stay muted.
- **Limits.** 30 texts an hour from one number (`ENCORE_POTTO_TEXT_PER_HOUR`), 120 sends a minute across the server (`ENCORE_POTTO_TEXT_GLOBAL_PER_MIN`), 6 messages Potto starts per person a day (`ENCORE_POTTO_TEXT_DAILY`). Replies stay under 320 characters where they can, never over 600.
- **Log.** Each person's last 200 messages are kept for them only (`GET /api/me/potto-text/log`, deletable, and deleted with the account). Admins see counts only. Unknown numbers are counted, never stored.
- **Signed webhooks.** Every Twilio request must carry a valid `X-Twilio-Signature`; every Meta request a valid `X-Hub-Signature-256`. Anything else is refused with 403.

## Owner's setup (start now: carrier approval takes days to weeks)

### 1. Twilio SMS

1. Create a Twilio account and upgrade it (trial accounts only text verified numbers).
2. Buy a number. Pick one:
   - **Toll-free (recommended for launch).** Submit **Toll-Free Verification** in the Twilio console (Phone Numbers, Regulatory Compliance, Toll-Free Verifications). Use case: "Account notifications and two-way customer care". Opt-in: "Users add and confirm their number in Settings, then turn on Text with Potto, which shows the consent wording". Attach a screenshot of the Settings switch. Sample messages: the reminder and the "You're in" reply from the examples above. Approval usually takes 1 to 3 weeks; unverified toll-free traffic is blocked.
   - **A local number with A2P 10DLC.** Register a Brand (needs your EIN) and a Campaign (use case "Mixed" or "Account notification", same opt-in description and samples). Usually 1 to 3 weeks.
   - If neither is approved by Dec 5, leave texting off. Invites by text and everything else still work.
3. Keep **Advanced Opt-Out** on for the number or Messaging Service (it handles STOP and HELP at the carrier level too).
4. On the number (or the Messaging Service), set **A message comes in** to Webhook, `HTTP POST`:
   `https://<your domain>/api/potto/sms`
5. Set `ENCORE_PUBLIC_URL` to exactly the address Twilio calls (for example `https://potterylab.ai`, no trailing slash). The signature check uses it, so it has to match.

### 2. WhatsApp (optional)

Either way, Meta needs your business verified: in Meta Business Manager, Security Center, start Business Verification (legal name, address, a document). Then:

- **Through Twilio (simplest).** Twilio console, Messaging, Senders, WhatsApp senders: connect your Meta Business Manager, register a number and a display name ("Pottery Lab"). Set its webhook for incoming messages to `HTTP POST https://<your domain>/api/potto/whatsapp`. Set `TWILIO_WHATSAPP_FROM` to the sender number.
- **Or Meta's WhatsApp Cloud API directly.** In your Meta app, WhatsApp, Configuration: callback URL `https://<your domain>/api/potto/whatsapp`, verify token = your `WHATSAPP_VERIFY_TOKEN`, subscribe to `messages`. Set `WHATSAPP_TOKEN` (a permanent system-user token), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` and `WHATSAPP_NUMBER`.

### 3. WhatsApp templates to submit

WhatsApp only allows free text within 24 hours of the person's last message. Outside that, Potto uses these templates. Submit each as category **Utility**, language English (US). Through Twilio: Content Template Builder, then "Submit for WhatsApp approval", and put the Content SID (starts with `HX`) in the env var. Through Meta: WhatsApp Manager, Message templates, and put the template name in the env var.

| Env var | Name | Body |
| --- | --- | --- |
| `POTTO_WA_TEMPLATE_REMINDER` | `potto_reminder` | Hi {{1}}, a quick reminder from Potto: {{2}} is tomorrow at {{3}}. Reply here if your plans change. |
| `POTTO_WA_TEMPLATE_ORDER_READY` | `potto_order_ready` | Your order from {{1}} is ready for pickup. {{2}} |
| `POTTO_WA_TEMPLATE_REPLIES` | `potto_replies` | New replies for {{1}}: {{2}} |
| `POTTO_WA_TEMPLATE_WAITLIST` | `potto_waitlist` | Good news: a spot opened up for {{1}}, and it's yours. Details: {{2}} |
| `POTTO_WA_TEMPLATE_WELCOME` | `potto_welcome` | Hi {{1}}, it's Potto from Pottery Lab. You're set to text with me here. Reply STOP to stop. |

Sample values for the reviewers: {{1}} "Priya", {{2}} "Taco night", {{3}} "7pm"; order: "Maya's Kitchen", "Pickup Sat 9 to 10am."; replies: "Taco night", "Jun is in, Sam can't make it"; waitlist: "Taco night", "https://potterylab.ai/e/abc123". `POTTO_WA_TEMPLATE_LANG` sets the language code for the Cloud API (default `en_US`). Without a template, a WhatsApp message outside the window simply isn't sent.

### 4. Environment variables (Render)

| Variable | What it does |
| --- | --- |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Twilio account. The auth token also checks every webhook's signature. (`ENCORE_TWILIO_SID` / `ENCORE_TWILIO_TOKEN` also work.) |
| `TWILIO_FROM` | The SMS number (`+18885551234`) or a Messaging Service SID (`MG…`). Turns on SMS. |
| `TWILIO_WHATSAPP_FROM` | The WhatsApp sender number through Twilio (`+14155238886`). Turns on WhatsApp. |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_NUMBER` | Meta's Cloud API instead of Twilio for WhatsApp. |
| `POTTO_WA_TEMPLATE_*`, `POTTO_WA_TEMPLATE_LANG` | The approved templates above. |
| `ENCORE_PUBLIC_URL` | The public address (must match the webhook URLs exactly). |
| `ENCORE_TZ` | Quiet hours for people with no city (for example `America/New_York`). |
| `ENCORE_SUPPORT_EMAIL` | Shown in the HELP reply. |
| `ENCORE_POTTO_TEXT_PER_HOUR`, `ENCORE_POTTO_TEXT_GLOBAL_PER_MIN`, `ENCORE_POTTO_TEXT_DAILY`, `ENCORE_POTTO_TEXT_BATCH_MIN` | Limits (30, 120, 6, 30 minutes). |
| `ENCORE_POTTO_TEXT=0` | Turns Potto by text off even with Twilio set (sign-in codes still go out). |
| `ENCORE_INVITES_PER_MEMBER` | Friend invites per member (5). |

The same Twilio number can send sign-in codes and Potto texts. Potto takes over the number's incoming messages: point it at `/api/potto/sms`. (The older "reply YES, MAYBE or NO" flow for hosts' texted invites keeps working on `/api/public/sms/inbound` only if it has its own number.)

### 5. Check it before launch

1. `/admin/invites` shows "Potto by text: On: SMS (+1…)…".
2. In Settings, add your number, confirm the code, turn on Text with Potto. You get the welcome text.
3. Text "my plans", "what's on this weekend", "HELP", then "STOP" and "START".
4. From a number with no account, text "hi": one reply pointing to Settings.
5. In Twilio's Monitor, Logs, Errors: no 11200 (webhook) errors. A 403 there means `ENCORE_PUBLIC_URL` doesn't match the webhook URL.
