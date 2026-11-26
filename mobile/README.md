# Pottery Lab for iPhone (and later Android)

The app is a Capacitor shell around the live site. It loads `https://potterylab.ai` and adds what a website can't do:
push notifications, the native share sheet, the camera and photo library, "Add to calendar", haptics, links that open
the app, and an offline screen. The web side is already built and tested in this repo. This folder is everything else.

| Piece | Where |
|---|---|
| Capacitor config: loads the live site, plugins, splash | `mobile/capacitor.config.ts` |
| The bridge: share, camera, calendar, links, push, haptics. Does nothing on the web | `public/native.js` |
| Push: device registry, APNs and FCM senders, settings per kind | `server/push.js` |
| Universal links and App Links | `server/appstore.js` (`/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json`) |
| Settings: notifications, blocked people, delete account | `/settings` (`public/settings.html`, `server/account.js`) |
| Report, block, the moderation queue, the text filter | `server/safety.js`, `public/safety.js`, `/moderation`, `/community` |
| Icons and launch images, drawn from Potto | `scripts/make-app-icons.cjs` writes `public/icons/` and `mobile/resources/` |
| Native settings to copy in after `cap add` | `mobile/native-config/ios/`, `mobile/native-config/android/` |

**Why the live site and not a bundled copy:** Pottery Lab is server-rendered on one origin (share previews at `/e/<id>`,
host pages at `/@handle`, hashed bundles in `/_app/`, HttpOnly SameSite=Lax sign-in cookies). A bundled copy would run on
`capacitor://localhost` and need CORS and cross-site cookies on every call, plus a second build to keep in step. With the
live site, a fix ships when it deploys. Review guideline 4.2 is about what the app does, and the native features above are
the answer to it. The bundle carries only the offline screen (`server.errorPath`).

---

## Countdown: submit in 7 days

Things only you can do are marked **You**. Start Day 1 today: Apple's enrollment is the slowest step.

### Day 1: accounts (You)
1. **Enroll in the Apple Developer Program** at developer.apple.com/programs/enroll ($99 a year).
   - As an **organization** (recommended, the store shows the company name): you need a **D-U-N-S number** for the legal
     entity. Look it up or request it free at developer.apple.com/enroll/duns-lookup. A new D-U-N-S number can take
     **up to 5 business days**, then Apple's review of the enrollment takes 1 to 2 more. Do this first.
   - As an **individual**: faster (often same day), but the store shows your personal name. You can't switch later without
     transferring the app.
2. Get a **Mac with Xcode 16 or newer** (Xcode from the Mac App Store; any Apple silicon Mac works). Install CocoaPods:
   `sudo gem install cocoapods` (or `brew install cocoapods`).
3. Make the **demo account** for App Review (see `listing.md`): sign up on the live site with a real inbox you control, set up a
   host page, one upcoming event with a few replies, one past event with photos and kudos, a friend, and a post.
4. Set `ENCORE_ADMIN_EMAILS` and `ENCORE_SAFETY_EMAIL` (or `ENCORE_SUPPORT_EMAIL`) on Render so reports reach a person.
   Apple expects reports handled within 24 hours.

### Day 2: identifiers and keys (You, once enrollment is approved)
1. **Team ID:** developer.apple.com/account, Membership details. Set `ENCORE_APPLE_TEAM_ID=<it>` on Render and redeploy.
   Check `https://potterylab.ai/.well-known/apple-app-site-association` now shows `<TEAMID>.com.potterylab.app`.
2. **App ID:** Certificates, Identifiers & Profiles, Identifiers, +, App IDs, App. Bundle ID `com.potterylab.app`
   (explicit). Turn on **Associated Domains** and **Push Notifications**.
3. **APNs key:** Keys, +, name it "Pottery Lab push", tick **Apple Push Notifications service (APNs)**, Continue, Register,
   **Download** the `.p8` (you can download it only once). Note the **Key ID**. On Render set:
   - `ENCORE_APNS_KEY` = the whole `.p8` file contents (or its base64)
   - `ENCORE_APNS_KEY_ID` = the Key ID
   - `ENCORE_IOS_BUNDLE_ID=com.potterylab.app`
   - `ENCORE_APNS_ENV=production` (TestFlight and App Store builds use production; a build run straight from Xcode uses
     sandbox, set `sandbox` while testing that way)
4. **App Store Connect record:** appstoreconnect.apple.com, Apps, +, New App. Platform iOS, name "Pottery Lab" (or the
   listing name), primary language English (U.S.), bundle ID `com.potterylab.app`, SKU `potterylab-ios`, Full Access.
   If the name is taken, use the listing's fallback name.

### Day 3: build it on the Mac
From a clone of this repo on the Mac:

```bash
npm install                      # the server's packages (needed once, for the icons script only)
npm run mobile:install           # Capacitor and the plugins, in mobile/
cd mobile
npx cap add ios                  # creates mobile/ios (commit it)
npm run assets                   # icons and splash screens from mobile/resources into the Xcode project
npm run sync                     # copies the offline screen and the plugin list into ios/
cd ios/App && pod install && cd ../..   # cap sync runs this too; run it again if Xcode says pods are missing
npx cap open ios                 # opens Xcode
```

In Xcode (the **App** target):
1. **Signing & Capabilities:** Team = your team, "Automatically manage signing" on, Bundle Identifier `com.potterylab.app`.
2. **+ Capability, Push Notifications.** **+ Capability, Background Modes,** tick Remote notifications.
3. **+ Capability, Associated Domains:** add `applinks:potterylab.ai`, `applinks:www.potterylab.ai`,
   `webcredentials:potterylab.ai` (the same as `native-config/ios/App.entitlements`).
4. **Info.plist:** add every key in `native-config/ios/Info.plist.additions.xml` (camera, photos, calendar, location usage
   strings; `WKAppBoundDomains`; `ITSAppUsesNonExemptEncryption` = NO).
5. Drag `native-config/ios/PrivacyInfo.xcprivacy` into the App group (tick "Copy items" and the App target).
6. **General:** Display Name "Pottery Lab", Version `1.0.0`, Build `1`, iPhone only for v1 (untick iPad unless you'll make
   iPad screenshots), minimum iOS 15.
7. Push needs one line in `ios/App/App/AppDelegate.swift` (Capacitor's push plugin docs), inside the class:

```swift
func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
}
func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
}
```

Run it on your iPhone (plug it in, pick it as the run target, Cmd+R). Check, in this order:
- it opens on the feed, signed out, and you can sign in
- share an invite: the iOS share sheet opens
- add a photo to a past event: "Take a photo / From your photos" appears
- "Add to calendar" on an event you're in: the iOS calendar sheet opens
- reply I'm in to something: iOS asks for notifications; allow. In Settings the "Turn on" button is gone.
  `POST /api/me/push/test` (or have a friend reply to your event) and the push arrives (with `ENCORE_APNS_ENV=sandbox`
  for a build from Xcode)
- airplane mode, pull to refresh: the offline screen with Potto
- tap a `https://potterylab.ai/e/...` link in Notes or Messages: it opens in the app, not Safari (links pasted in
  Safari's address bar never open apps; that's iOS)
- Settings, Delete account: both choices work

### Day 4: TestFlight (You and the Mac)
1. Xcode: pick **Any iOS Device (arm64)**, Product, **Archive**. In the Organizer: Distribute App, App Store Connect,
   Upload. Wait for "Processing" to finish in App Store Connect (10 to 30 minutes).
2. App Store Connect, the app, **TestFlight**: answer the export compliance question (No, it uses only standard HTTPS).
3. **Internal testing:** Internal Testing, +, a group "Team", add yourself and up to 100 people on your App Store Connect
   team. They install **TestFlight** from the App Store and get the build at once (no review for internal testers).
4. Optional: an **External** group with a public link for the first 30 signups (needs a short Beta App Review, about a day).
5. Fix anything testers find; each new upload bumps Build (`2`, `3`, ...).

### Day 5: screenshots and listing (You, with the scratchpad's `listing.md`)
1. Screenshots: 6.9" (1320 x 2868, iPhone 16/17 Pro Max) is required; 6.5" (1284 x 2778 or 1242 x 2688) is still
   accepted for older sizes. Take them in the Simulator (`File, Save Screen`) with the demo account, or on a device.
   The plan is in `listing.md` (feed, invite, swipe deck, event page, host page, Potto).
2. Paste the name, subtitle, keywords, description, promotional text, support URL (`https://potterylab.ai/community`),
   marketing URL (`https://potterylab.ai/about`), privacy policy URL (`https://potterylab.ai/privacy`).
3. **App Privacy:** answer as in `listing.md`. Data is not used for tracking.
4. **Age rating:** the questionnaire answers are in `listing.md` (expect 12+ because of user-generated content and
   in-person meetups; 13+ under Apple's newer age bands).
5. Category: **Social Networking** (secondary **Lifestyle**). Price: Free.

### Day 6: review notes and a last pass
1. **App Review Information:** the demo account email and password, a phone you'll answer, and the review notes from
   `listing.md` (where Delete account, Report and Block are, and that guests pay hosts for in-person events outside the
   app under 3.1.3(e)).
2. Check the live site one more time on the build that will ship: delete account, report, block, push.
3. `/moderation` works for you, and the report email arrives.

### Day 7: submit
1. App Store Connect, the version, **Add for Review**, pick the TestFlight build, **Submit**.
2. Release: "Manually release this version" lets you pick the moment once it's approved.
3. Review usually takes 1 to 2 days. If it comes back with a 4.2 question, reply in Resolution Center listing the native
   features (push, share sheet, camera, calendar, offline, universal links), with a short screen recording.

---

## What each env var does

| Var | What | Default |
|---|---|---|
| `ENCORE_APPLE_TEAM_ID` | Team ID for universal links, push JWT | `TEAMID0000` placeholder |
| `ENCORE_IOS_BUNDLE_ID` | Bundle ID, the push topic | `com.potterylab.app` |
| `ENCORE_APNS_KEY`, `ENCORE_APNS_KEY_ID`, `ENCORE_APNS_ENV` | APNs token auth | push off |
| `ENCORE_ANDROID_PACKAGE`, `ENCORE_ANDROID_SHA256` | App Links (comma list of SHA-256 fingerprints) | `com.potterylab.app`, none |
| `ENCORE_FCM_PROJECT_ID`, `ENCORE_FCM_CLIENT_EMAIL`, `ENCORE_FCM_PRIVATE_KEY` | FCM HTTP v1 (a service account) | Android push off |
| `ENCORE_FAKE_PUSH=1` | record pushes instead of sending (tests, demos) | off |
| `ENCORE_DELETE_GRACE_DAYS` | days before a "delete later" account goes | 14 (0 turns the choice off) |
| `ENCORE_ADMIN_EMAILS` | who sees `/moderation` and gets report emails | none |
| `ENCORE_SAFETY_EMAIL` (or `ENCORE_SUPPORT_EMAIL`) | the contact shown on `/community` and Settings | none |

Sign in with Apple isn't built: the app has no Google, Facebook or other social sign-in (only email and password, and
company single sign-on for work teams, which guideline 4.8 exempts). If a social sign-in is ever added, Sign in with Apple
has to ship with it.

---

## Android (later)

Everything above is platform-neutral: `native.js` checks the platform, push stores it per device and sends through FCM,
`/.well-known/assetlinks.json` is served, and the manifest has maskable icons for adaptive icons. To ship:

1. **Firebase:** console.firebase.google.com, add a project, add an Android app with package `com.potterylab.app`.
   Download `google-services.json`. Project settings, Service accounts, **Generate new private key**; from that JSON set
   `ENCORE_FCM_PROJECT_ID` (project_id), `ENCORE_FCM_CLIENT_EMAIL` (client_email), `ENCORE_FCM_PRIVATE_KEY`
   (private_key) on Render.
2. **Android Studio** (any OS) and a JDK 21. Then:

```bash
cd mobile
npx cap add android
npm run assets
npm run sync
cp ~/Downloads/google-services.json android/app/
npx cap open android
```

3. In `android/app/src/main/AndroidManifest.xml`, add what `native-config/android/AndroidManifest.additions.xml` lists
   (the App Links intent filter inside MainActivity, and the permissions).
4. **Signing keystore** (keep it and its passwords safe, forever):
   `keytool -genkey -v -keystore potterylab-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload`.
   In Android Studio: Build, Generate Signed App Bundle, Android App Bundle, the keystore. Use **Play App Signing** (the
   default): Google keeps the app signing key, you keep the upload key.
5. **Fingerprints for App Links:** Play Console, the app, Test and release, Setup, **App signing**: copy the SHA-256 of the
   *app signing key* (and of the upload key for local builds). Set `ENCORE_ANDROID_SHA256` to both, comma separated.
6. **Play Console** (play.google.com/console, $25 once; an organization account needs a D-U-N-S number here too; new
   personal accounts must run a closed test with 12 testers for 14 days before production).
   Create the app, fill the store listing, the **Data safety** form (see readiness.md), content rating (IARC), target
   audience (13+), ads (none), and the **account deletion** URL: `https://potterylab.ai/settings#delete`.
7. **Internal testing** track: Test and release, Testing, Internal testing, create a release, upload the `.aab`, add
   testers by email. Then closed testing, then production.
8. Target API level: Play requires the current level minus one for new apps (API 35, Android 15, in 2025; check the
   Play Console notice). Capacitor 7 targets 35 by default (`android/variables.gradle`).
