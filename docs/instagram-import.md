# Start from your Instagram (/import/instagram)

A host shows Potto their own Instagram and gets a draft of their Pottery Lab page: name, tagline, about, where they are, hours, tags, the events they could host, what they could do for brands, their menu, links, colors, a cover, a gallery and a profile picture. Every field says where it came from ("from your bio", "from your post on Oct 3", "from photo 2") and can be changed. Nothing is saved until they tap **Looks good, save my page**.

Code: `server/igimport.js` (routes, the official connection), `server/igdraft.js` (handle parsing, the prompt, the offline draft, the guard), `public/igimport.html` and `public/igimport.js` (the page, the claim card, the settings row). Tests: `test/igimport.test.js`.

We never fetch instagram.com pages. Its terms forbid scraping, it blocks servers, and it breaks. The onboarding link reader (`readLink` in `server/onboard.js`) refuses Instagram links and points to this page instead.

## Where it shows

- **Sign-up** (`public/signup.html`, one marked hook): a new host page lands on `/import/instagram?next=<where sign-up was going>`, which offers **Start from your Instagram** or **Start from scratch**. Followers, brand teams, preset claims and a dinner planned on `/start` skip it.
- **Claiming a prepared page** (`/signup?mode=friends&preset=le-phin`): the claimed page opens with `?welcome=1`, and `public/igimport.js` shows a card: **Refresh from your Instagram** or **Not now** (owner only).
- **Page settings** (Edit page, `public/storefront.js`, one marked hook): an **Import from Instagram** row opens `/import/instagram?mode=refresh`.
- **/onboard**: typing an Instagram handle or link goes to the refresh flow instead of fetching it.

In refresh mode the review shows "Now: ..." under each field, and a field the page already has starts unticked, so nothing is overwritten without a tap.

## Two ways in

### (B) Photos: works today, no Meta approval

They type their handle (to link it), paste their bio, and pick 3 to 12 photos or screenshots (`input type=file accept=image/* multiple`). The optional "Anything else?" box takes a menu, prices or hours.

- The browser shrinks each photo to 1280px JPEG before sending.
- `POST /api/igimport/draft` takes at most 12 photos, each a real image by its bytes (JPEG, PNG, WebP or GIF; no SVG) and at most 2 MB. It refuses more, bigger, or anything else (400 `too_many`, 413 `too_big`, 400 `bad_type`).
- The photos go to Claude with the bio as one request (vision content blocks through `complete()` in `server/ai.js`), then are dropped. They're never written to disk or sent back.
- On **Looks good**, the browser uploads only the photos picked for the cover, gallery or profile picture (`POST /api/assets`), and `POST /api/igimport/save` checks each one belongs to this workspace.

### (A) Official: Instagram API with Instagram Login

For professional accounts (business or creator). The old Basic Display API is retired. This path is **off unless** `INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET` are set; without them the button doesn't show and the routes answer 404 `not_configured`.

1. `GET /api/igimport/oauth/start`: signed-in hosts only. Makes a random `state` (single use, 10 minutes, tied to the workspace) and keeps its hash in a signed HttpOnly cookie. With `INSTAGRAM_PKCE=1` it also sends a S256 `code_challenge`. Redirects to Instagram's authorize page with scope `instagram_business_basic`.
2. `GET /api/igimport/oauth/callback`: checks the state against the cookie and the signed-in workspace, and refuses a reused one. Exchanges the code for a short-lived token, reads `/me` (username, name, biography, website, profile picture, followers) and `/me/media` (captions, media URLs, permalinks, timestamps), and downloads up to 12 images plus the profile picture, only from Instagram's CDN hosts and only the URLs the API returned. **The token is then dropped.** It's never stored, logged or sent to the page.
3. The fetched profile and photos wait in server memory for 30 minutes at most, for the review screen (`/import/instagram?draft=<id>`), readable only by the same workspace. Saving stores only the picked photos as blobs and forgets the rest.

**Disconnect** (on the page once something was imported) forgets any waiting draft and the import record. Since we keep no key, there's nothing to revoke on our side. People can also remove the app in Instagram: Settings, then Apps and websites.

## What the draft can and can't say

`guardDraft()` in `server/igdraft.js` runs on every draft, from Claude or from the offline rules:

- **Sources.** Each field carries a source that has to point at real material: the bio, what they pasted, a post that exists (with its date), or a photo number they gave. Anything else is dropped.
- **Prices.** A price stays only when their own words state it (the bio, a caption, the pasted text). A price Claude read off one of their photos (a menu board) is kept but marked "read from your photo, check it". Otherwise the item says **price not set**. Potto never invents a price.
- **Only their account.** `@mentions` of other accounts and links to other Instagram profiles are taken out of every field. The website can't be an Instagram, Facebook or bare Linktree link. Nothing is fetched about anyone else.
- **Plain words.** No em dashes, no markup, short fields with the same limits the page editor uses.

Where it lands: name, tagline, city, neighbourhood, links (Instagram and website) and tags go to the matching page fields. About and hours make up the bio (hours as an "Open ..." line). "Events you could host" join the tags. "For brands" goes to the page's services line. The menu goes into the shop: into a closed shop as their menu, or, if the shop is already open, only items with a stated price. Colors go into the brand kit (accent, second accent, page), which keeps text readable. The cover, gallery and profile picture (one of their photos, or a drawn face that fits what they do) go into the theme and gallery.

**Offline mode** (`ENCORE_FAKE_AI=1`, or no `ANTHROPIC_API_KEY`): `fakeIgDraft()` reads the same prompt with plain rules (neighbourhoods, hours, "$6" next to an item, known drinks and pastries, event and catering words). It can't see photos. Tests and the crawl use it.

## What the owner needs to do with Meta

The photo path works today with nothing set. For the official path:

1. **Make a Meta developer account** at developers.facebook.com and **create an app** (type: Business). Add the **Instagram** product and pick **API setup with Instagram login** (Instagram API with Instagram Login, not Facebook Login).
2. In the Instagram product settings, add **Valid OAuth Redirect URIs**: `https://<your domain>/api/igimport/oauth/callback`, exactly as `INSTAGRAM_REDIRECT_URI` will say.
3. Set the **Deauthorize callback URL** to `https://<your domain>/api/igimport/deauthorize` and the **Data deletion request URL** to `https://<your domain>/api/igimport/data-deletion`. Both check Meta's `signed_request` with the app secret. We store no Instagram data, so they only confirm.
4. Fill in the app's **Privacy Policy URL** (`https://<your domain>/privacy`, which has a "Starting your page from Instagram" section) and **Terms URL** (`/terms`), an app icon and a category.
5. While the app is in development, add test accounts under **Roles** (Instagram testers). Each tester accepts the invite in Instagram (Settings, Apps and websites, Tester invites). Test accounts must be **professional** (business or creator).
6. **App review**: ask for **Advanced Access** to `instagram_business_basic`. Meta wants a screencast of the whole flow (connect, the draft, the review, save, Disconnect) and a short note on how the data is used: "to prefill the person's own page, once, with their action; the token is not stored." Business verification may be asked for. Until review passes, only testers can connect.
7. On **Render**, set these environment variables, then redeploy:

| Variable | What it is |
|---|---|
| `INSTAGRAM_APP_ID` | The Instagram app ID (App dashboard, Instagram, API setup with Instagram login). Not the Facebook app ID if they differ. |
| `INSTAGRAM_APP_SECRET` | The Instagram app secret. Stays on the server. |
| `INSTAGRAM_REDIRECT_URI` | Optional. Defaults to `<ENCORE_PUBLIC_URL or request origin>/api/igimport/oauth/callback`. Set it to exactly what step 2 lists. |
| `INSTAGRAM_GRAPH_VERSION` | Optional. Defaults to `v23.0`. |
| `INSTAGRAM_PKCE` | Optional. `1` sends a PKCE challenge. Turn it on only if Meta's docs say the Instagram Login flow accepts it. |
| `ANTHROPIC_API_KEY` | Already set for Potto. Without it, drafts come from the offline rules. |

`SESSION_SECRET` (already required) signs the state cookie.

### Check against Meta's current docs before going live

These were written from what we knew, without reading Meta's docs from this environment (the docs host wasn't reachable). Check each one:

- The authorize URL `https://www.instagram.com/oauth/authorize` and its parameters (`client_id`, `redirect_uri`, `response_type=code`, `scope=instagram_business_basic`, `state`). Meta may also want `enable_fb_login=0` or `force_reauth`.
- Whether **PKCE** is accepted (`code_challenge`, `code_verifier`). It's off by default.
- The token exchange: `POST https://api.instagram.com/oauth/access_token` with `client_id`, `client_secret`, `grant_type=authorization_code`, `redirect_uri`, `code`. The reply may be `{access_token, user_id, permissions}` or wrapped in `data: [...]`; both are read. Instagram may add `#_` to the code; it's stripped.
- The Graph host and version: `https://graph.instagram.com/<version>/me` and `/me/media`.
- The `/me` fields. We ask for `user_id,username,name,biography,website,profile_picture_url,followers_count,media_count,account_type` and fall back to the set without `biography` and `website` if that request fails. If biography isn't returned, the page asks them to paste it.
- The `/me/media` fields `id,caption,media_type,media_url,thumbnail_url,permalink,timestamp`, and that media URLs come from `*.cdninstagram.com` or `*.fbcdn.net` (the only hosts we download from).
- That there's no token revoke endpoint for Instagram Login. We never keep the token, so there's nothing to revoke.
- The `signed_request` format for the deauthorize and data deletion callbacks, and the data deletion reply shape `{url, confirmation_code}`.

## Privacy rules, in short

- Only the person's own account, only when they tap something.
- Nothing about anyone else is fetched, and other accounts' handles and links are taken out of the draft.
- Official path: the token is used once and dropped. Photos wait in memory for 30 minutes at most.
- Photo path: photos are read for the draft and dropped. Only the photos picked for the page are kept.
- Nothing goes on the page until **Looks good, save my page**.
- **Disconnect** forgets what's waiting and the import record. `/privacy#instagram` says all of this in plain words.
