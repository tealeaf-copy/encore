# Moving to potterylab.ai

The app is ready for the new address: links in emails, texts, reminders and share cards all come from one setting, and old links forward automatically once it's switched on. The steps below are all settings; no code changes are needed.

## 1. Buy the domain
Register `potterylab.ai` with any registrar (Namecheap, Cloudflare, Porkbun, GoDaddy…). `.ai` domains are usually sold for at least two years.

## 2. Add it to Render
Render dashboard → the `encore` web service → **Settings → Custom Domains → Add Custom Domain**:
- add `potterylab.ai`
- add `www.potterylab.ai`

Render shows the DNS records to create. Typically:

| Type | Name | Value |
|---|---|---|
| A (or ALIAS/ANAME) | `@` | the IP Render shows |
| CNAME | `www` | `encore-2qzx.onrender.com` |

Create them at your registrar. Render issues the HTTPS certificate on its own once DNS resolves (minutes to a few hours). Wait until both show **Verified** in Render.

## 3. Switch the app over
Render → **Environment**, set:

| Variable | Value |
|---|---|
| `ENCORE_PUBLIC_URL` | `https://potterylab.ai` |
| `ENCORE_CANONICAL_HOST` | `potterylab.ai` |

Save; Render redeploys. From then on:
- every link the app sends (invites, reminders, kudos emails, password resets, share cards) uses potterylab.ai;
- anyone opening an old `encore-2qzx.onrender.com` link (or `www.potterylab.ai`) is sent to the same page on potterylab.ai with a permanent redirect;
- API calls on the old address keep working, so nothing open mid-way breaks.

People are signed out once (sign-in cookies belong to a domain), then sign in again on potterylab.ai.

## 4. Things outside the app to update
- **Email sender:** to send from `hello@potterylab.ai`, verify the domain with the email service (Resend: Domains → Add, then the DNS records it shows), then set `ENCORE_EMAIL_FROM=hello@potterylab.ai` and `ENCORE_EMAIL_FROM_NAME=Pottery Lab`.
- **Single sign-on**, if configured: add `https://potterylab.ai/sso/callback` as an allowed redirect URL in the identity provider.
- **Vercel** (`vercel.json`) only forwards to the Render service, so it keeps working; point the Vercel project's domain at potterylab.ai only if you want Vercel in front.
- **Profiles and bios:** hosts' Instagram bios and printed QR codes with the old address keep working through the redirect.

## 5. Check
- `https://potterylab.ai` loads with a padlock.
- `https://encore-2qzx.onrender.com/hosts` lands on `https://potterylab.ai/hosts`.
- Send yourself a password reset: the link in the email starts with `https://potterylab.ai`.
