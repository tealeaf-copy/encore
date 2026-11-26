# Sign-in setup: the owner's checklist

The sign-in screen (`/login` and `/signup`) shows a button only when its provider is set up, so nothing breaks before
the keys exist. Email codes work as soon as email works (`ENCORE_EMAIL_KEY`, `ENCORE_EMAIL_FROM`). Passkeys need no keys.
Apple and Google need the steps below. All keys go in Render's environment settings. **Never commit a key to the repo.**

The examples use `https://potterylab.ai`. If you use another address, swap it in everywhere below.

## 0. Before you start (Render)

| Setting | Value | Why |
|---|---|---|
| `ENCORE_PUBLIC_URL` | `https://potterylab.ai` | Redirect URLs are built from it. They must match the consoles exactly. |
| `ENCORE_TRUST_PROXY` | `1` | Render is a proxy. Without this the server thinks it's on http and Apple's sign-in can't finish. |
| `SESSION_SECRET` | a long random string (already set) | Signs the invite state and the sessions. |
| `ENCORE_INVITE_ONLY` | `1` | New people enter an invite code first. Existing accounts never see it. |

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

1. Open `https://potterylab.ai/login`: Apple, Google, a passkey (on a device that can) and email show.
2. Open `https://potterylab.ai/join?code=<one of your codes>`: it skips to the buttons with "Invite from <you>".
3. Sign in with Google with a new address and no code: you land on the code step with "You'll need an invite to join for now."
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

| Redirect URL | Console |
|---|---|
| `https://potterylab.ai/auth/google/callback` | Google Cloud > Web client > Authorized redirect URIs |
| `https://potterylab.ai/auth/apple/callback` | Apple > Services ID > Return URLs (domain `potterylab.ai`) |

**For tests and demos only:** `ENCORE_FAKE_OAUTH=1` adds test versions of Apple and Google that sign real tokens with a
local key. It's ignored when `NODE_ENV=production`. Never set it on the live site.

## How it behaves (for support questions)

- **New people** with invite-only on: the invite code, then the buttons. The code is held on the server for 30 minutes
  (and inside the Apple or Google round trip), and checked again when the account is made. Founder codes keep their per-IP
  and per-day limits.
- **People with an account** never see the code step. Apple, Google and email codes match accounts by verified email.
  An unverified email never links.
- **Apple "Hide My Email"** addresses are treated as their own email. If that address has no account, it's a new person.
- **Email codes:** 6 digits, 10 minutes, 5 tries, then a new code. The same answer whether or not the address has an
  account. The email also has a one-tap link.
- **Passwords** still work for accounts that have one ("Use a password instead").
- **Deleting an account** removes its Apple, Google and email sign-ins and its passkeys, and revokes the Apple token.
