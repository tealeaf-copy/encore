# Sign-in setup: the owner's checklist

The sign-in screen (`/login` and `/signup`) starts with one field, **Email or phone number**, and a Continue button. We
send a 6-digit code by email or by text, and that's the whole sign-in. Passkey, Google and Apple sit underneath as
other ways in, and each shows only when it's set up, so nothing breaks before the keys exist. "Use a password instead"
stays for accounts that have one. All keys go in Render's environment settings. **Never commit a key to the repo.**

- **Email codes** go out through the same sender as every other Pottery Lab email: `ENCORE_EMAIL_KEY` and
  `ENCORE_EMAIL_FROM` (with `ENCORE_EMAIL_SERVICE`), or the default workspace's email connection. If neither is set,
  sign-in uses the sending service an admin (`ENCORE_ADMIN_EMAILS`) connected in their own workspace's Setup, the same
  one their host emails use. If there's no email at all, the page says so and points to the password.
- **Text codes** need Twilio (section 0b). Without it, typing a phone number answers "Text sign-in isn't on yet. Use
  your email instead." with a one-tap switch back to email. Nobody gets stuck.
- Passkeys need no keys. Apple and Google need the steps below.

The examples use `https://potterylab.ai`. If you use another address, swap it in everywhere below.

## 0. Before you start (Render)

| Setting | Value | Why |
|---|---|---|
| `ENCORE_PUBLIC_URL` | `https://potterylab.ai` | Redirect URLs are built from it. They must match the consoles exactly. |
| `ENCORE_TRUST_PROXY` | `1` | Render is a proxy. Without this the server thinks it's on http and Apple's sign-in can't finish. |
| `SESSION_SECRET` | a long random string (already set) | Signs the invite state and the sessions. |
| `ENCORE_INVITE_ONLY` | `1` | New people enter an invite code first. Existing accounts never see it. |

## 0b. Text codes (Twilio, about 10 minutes)

1. In the **Twilio Console** (console.twilio.com), buy a number that can send SMS (or make a **Messaging Service**).
   For US numbers, register the number for A2P 10DLC (Messaging > Regulatory compliance), or use a toll-free number
   and finish toll-free verification. Unregistered numbers get filtered by US carriers.
2. Copy the **Account SID** and **Auth Token** from the Console's home page.
3. On Render set:

| Setting | Value |
|---|---|
| `TWILIO_ACCOUNT_SID` | the Account SID (starts with `AC`) |
| `TWILIO_AUTH_TOKEN` | the Auth Token |
| `TWILIO_FROM` | the number in E.164, like `+15551234567`, or the Messaging Service SID (starts with `MG`) |

If the server already texts reminders with `ENCORE_TWILIO_SID`, `ENCORE_TWILIO_TOKEN` and `ENCORE_TWILIO_FROM`, sign-in
uses those and you don't need the new names. The code goes out with Twilio's REST API (server/smscode.js); there's no SDK.

Phone numbers are read as US numbers unless they start with `+` (or `00`), and stored in E.164. The text ends with
`@potterylab.ai #123456`, so Android and iPhone offer the code above the keyboard.

## 1. Google (about 15 minutes)

In **Google Cloud Console** (console.cloud.google.com), in the same project the calendar connection uses, if there is one:

1. **APIs & Services > OAuth consent screen** (now called **Google Auth Platform > Branding**):
   - App name: Pottery Lab. Support email: yours. Logo: `public/icons/icon-512.png`.
   - App domain: `https://potterylab.ai`, privacy `https://potterylab.ai/privacy`, terms `https://potterylab.ai/terms`.
   - Authorized domain: `potterylab.ai`.
   - **Data Access > scopes:** `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`. Nothing else for sign-in.
   - **Audience:** External. Press **Publish app** so anyone can sign in. These scopes don't need Google's verification review.
2. **Clients > Create client > Web application**, name "Pottery Lab web":
   - Authorized JavaScript origins: `https://potterylab.ai`
   - Authorized redirect URIs:
     - `https://potterylab.ai/auth/google/callback` (sign-in)
     - `https://potterylab.ai/api/onboard/gmail/callback` (only if you also use the Gmail import)
   - Copy the **Client ID** and **Client secret**.
3. On Render set `ENCORE_GOOGLE_CLIENT_ID` and `ENCORE_GOOGLE_CLIENT_SECRET`.
   (If `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are already set for the calendar, sign-in uses them and you only add
   the redirect URI above to that client.)
4. **For the iPhone app's own Google sheet** (optional, see `mobile/README.md`): **Create client > iOS**, bundle ID
   `com.potterylab.app`. Set `ENCORE_GOOGLE_IOS_CLIENT_ID` to its Client ID. Later for Android: **Create client > Android**
   with the package and the SHA-1 of the signing key, and set `ENCORE_GOOGLE_ANDROID_CLIENT_ID`.

## 2. Apple (about 20 minutes, once the developer account is approved)

In **Apple Developer** (developer.apple.com/account), **Certificates, Identifiers & Profiles**:

1. **Identifiers > App IDs > `com.potterylab.app`**: tick **Sign in with Apple** (Enable as a primary App ID). Save.
2. **Identifiers > + > Services IDs**: description "Pottery Lab web", identifier `com.potterylab.web`. Register, then open
   it, tick **Sign in with Apple**, **Configure**:
   - Primary App ID: `com.potterylab.app`
   - Domains and Subdomains: `potterylab.ai`
   - Return URLs: `https://potterylab.ai/auth/apple/callback`
   - Save, Continue, Save.
3. **Keys > +**: name "Pottery Lab sign in", tick **Sign in with Apple**, **Configure** with primary App ID
   `com.potterylab.app`. Register and **download the `.p8`** (only once). Note the **Key ID**.
4. **Membership details**: note the **Team ID** (it may already be set for universal links and push).
5. On Render set:
   - `ENCORE_APPLE_SERVICES_ID` = `com.potterylab.web`
   - `ENCORE_APPLE_TEAM_ID` = the Team ID
   - `ENCORE_APPLE_KEY_ID` = the Key ID
   - `ENCORE_APPLE_PRIVATE_KEY` = the whole `.p8` file (paste it with its line breaks, or as one line with `\n`, or base64)
   - `ENCORE_IOS_BUNDLE_ID` = `com.potterylab.app` (already set for push; the native sheet's tokens are for this ID)
6. **Email relay** (people who pick "Hide My Email"): **Services > Sign in with Apple for Email Communication > Configure**,
   add the domain or address you send from (`ENCORE_EMAIL_FROM`), and set up SPF for it. Without this, mail to
   `@privaterelay.appleid.com` addresses doesn't arrive.
7. **Xcode:** the app target needs the **Sign in with Apple** capability (it's in `mobile/native-config/ios/App.entitlements`).

When an account is deleted, the server revokes its Apple token (`https://appleid.apple.com/auth/revoke`), as the App Store
asks. That uses the same key, so keep it valid.

## 3. Check it

1. Open `https://potterylab.ai/login`: the "Email or phone number" field, then Apple, Google and a passkey (on a device
   that can) under it. Type your email: a code arrives. Type your phone: a text arrives (or, before Twilio is set up,
   "Text sign-in isn't on yet. Use your email instead.").
2. Open `https://potterylab.ai/join?code=<one of your codes>`: it skips to the buttons with "Invite from <you>".
3. Sign in with a new email (or Google) and no invite: after the 6-digit code you land on "Got an invite code?" with
   "No code? Join the waitlist", which saves the email or phone you just proved.
4. Sign in to an existing account with Google or Apple (same email): no code asked.
5. **Settings > Sign-in methods > Add**: makes a passkey. Sign out, then **Continue with a passkey**.
6. Delete a test account made with Apple. At appleid.apple.com, **Sign-In and Security > Sign in with Apple** no longer lists Pottery Lab.

## Everything at a glance

| Env var | Where it comes from | Needed for |
|---|---|---|
| `ENCORE_GOOGLE_CLIENT_ID`, `ENCORE_GOOGLE_CLIENT_SECRET` | Google Cloud > Clients > Web application | Google button |
| `ENCORE_GOOGLE_IOS_CLIENT_ID` | Google Cloud > Clients > iOS | the app's own Google sheet (optional) |
| `ENCORE_GOOGLE_ANDROID_CLIENT_ID` | Google Cloud > Clients > Android | Android, later (optional) |
| `ENCORE_APPLE_SERVICES_ID` | Apple > Identifiers > Services IDs | Apple button |
| `ENCORE_APPLE_TEAM_ID` | Apple > Membership details | Apple button (also links and push) |
| `ENCORE_APPLE_KEY_ID`, `ENCORE_APPLE_PRIVATE_KEY` | Apple > Keys (Sign in with Apple) | Apple button, token revocation |
| `ENCORE_PASSKEY_RP_ID` | optional; defaults to the host of `ENCORE_PUBLIC_URL` | passkeys on a different domain |
| `ENCORE_PASSKEY_ORIGINS` | optional, comma list | passkeys from other origins (an Android app's `android:apk-key-hash:` origin) |
| `ENCORE_APP_SCHEME` | optional, default `potterylab` | where a browser-sheet sign-in returns in the app |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Twilio Console (section 0b) | text codes to phone numbers |
| `ENCORE_EMAIL_KEY`, `ENCORE_EMAIL_FROM` | your email service (already set if email works) | email codes |

| Redirect URL | Console |
|---|---|
| `https://potterylab.ai/auth/google/callback` | Google Cloud > Web client > Authorized redirect URIs |
| `https://potterylab.ai/auth/apple/callback` | Apple > Services ID > Return URLs (domain `potterylab.ai`) |

**For tests and demos only:** `ENCORE_FAKE_OAUTH=1` adds test versions of Apple and Google that sign real tokens with a
local key. `ENCORE_FAKE_SMS=1` keeps text codes in memory instead of sending them, and `ENCORE_FAKE_EMAIL=1` does the same
for email. The fake OAuth and SMS are ignored when `NODE_ENV=production`. Never set them on the live site.

## How it behaves (for support questions)

- **New people** with invite-only on: email or phone (or Apple, Google), the 6-digit code, then "Got an invite code?",
  and only when there's no account behind it. The proven sign-in is held for 15 minutes while they find their code. "No
  code? Join the waitlist" saves the email or phone they just proved (`via: "signin"` on the waitlist). A `/join?code=`
  link still works: the code is held for 30 minutes (and inside the Apple or Google round trip), and checked again when
  the account is made. Founder codes keep their per-IP and per-day limits. With invite-only off, new people go straight
  to their name and in.
- **People with an account** never see the invite step. Apple, Google and email codes match accounts by verified email.
  An unverified email never links. A phone code matches the phone on the account.
- **Phone numbers on accounts:** an account can hold one verified number (`POST /api/me/phone/start` and
  `/api/me/phone/verify` when signed in), and then either the email or the phone signs in. Someone who joins with only a
  phone gets a stand-in address on the reserved `phone.potterylab.invalid` domain, which is never emailed.
- **Where people land:** a new personal account goes to `/feed?welcome=1`. A returning brand team goes to `/teams/home`,
  everyone else to the app. `?next=` wins when it's set.
- **Apple "Hide My Email"** addresses are treated as their own email. If that address has no account, it's a new person.
- **Codes (email and text):** 6 digits, 10 minutes, 5 tries, then a new code. Only a salted hash of the code is stored,
  and it's compared in constant time. 5 sends an hour per email or number, 20 an hour per IP. The same answer whether or
  not the address or number has an account. The email also has a one-tap link. Logs never show a code, and show phone
  numbers masked (`+1***34`).
- **Passwords** still work for accounts that have one ("Use a password instead").
- **Deleting an account** removes its Apple, Google and email sign-ins and its passkeys, and revokes the Apple token.
