// Pottery Lab for iOS (and later Android), with Capacitor. See mobile/README.md.
//
// The app loads the live site (server.url), it does not bundle the web app. Why:
// - Pottery Lab is a server-rendered app on one origin: share previews (/e/<id>), host pages (/@handle), the hashed
//   bundles in /_app/, and sign-in cookies that are HttpOnly and SameSite=Lax. A bundled copy would run on
//   capacitor://localhost and need CORS and cross-site cookies on every API call, and a second build to keep in step.
// - Fixes ship the moment they deploy, no App Store review for a copy change.
// - App Store guideline 4.2 is about what the app does, not where its HTML comes from: the native features below
//   (push, share sheet, camera, calendar, haptics, universal links, an offline screen) are what make it an app.
//   2.5.2 is fine: the site doesn't download code that changes what the app is for.
// What stays in the app bundle (webDir "www"): the offline screen, shown when the site can't load (server.errorPath).
import type { CapacitorConfig } from "@capacitor/cli";

const origin = process.env.POTTERYLAB_ORIGIN || "https://potterylab.ai";
const host = new URL(origin).hostname;

const config: CapacitorConfig = {
  appId: process.env.POTTERYLAB_BUNDLE_ID || "com.potterylab.app",
  appName: "Pottery Lab",
  webDir: "www",
  appendUserAgent: "PotteryLabApp/1.0",
  backgroundColor: "#F7F1E8",
  server: {
    url: origin + "/feed?source=app",
    cleartext: false,
    hostname: host,
    // links to these stay inside the app; everything else (Instagram, maps, pay links) opens outside it
    allowNavigation: [host, "www." + host.replace(/^www\./, ""), "fonts.googleapis.com", "fonts.gstatic.com"],
    errorPath: "offline.html",
  },
  ios: {
    scheme: "Pottery Lab",
    contentInset: "never", // pages pad for the notch themselves (public/native.js adds the padding where a page doesn't)
    // service workers in WKWebView only run for App-Bound Domains (WKAppBoundDomains in Info.plist, see native-config/ios)
    limitsNavigationsToAppBoundDomains: true,
    preferredContentMode: "mobile",
    // swipe-back (allowsBackForwardNavigationGestures): Capacitor has no key for it, so native-config/ios/MainViewController.swift
    // turns it on; public/native.js also goes back on a left-edge swipe
    backgroundColor: "#F7F1E8",
  },
  android: {
    allowMixedContent: false,
    backgroundColor: "#F7F1E8",
  },
  plugins: {
    SplashScreen: { launchAutoHide: false, launchShowDuration: 3000, backgroundColor: "#F7F1E8", showSpinner: false, androidScaleType: "CENTER_CROP", splashFullScreen: false, splashImmersive: false },
    PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
    StatusBar: { style: "LIGHT", backgroundColor: "#F7F1E8", overlaysWebView: false },
    Camera: {},
    CapacitorCalendar: {},
  },
};

export default config;
