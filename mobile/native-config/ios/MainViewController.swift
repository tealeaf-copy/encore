// iOS swipe-back: a swipe from the left edge goes back a page, like Safari. Capacitor has no config key for
// WKWebView.allowsBackForwardNavigationGestures, so the app's storyboard points its root view at this class
// (Main.storyboard: Custom Class = MainViewController, Module = App). public/native.js also handles an edge swipe in
// the page, so a build without this file still goes back.
import UIKit
import Capacitor

class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        webView?.allowsBackForwardNavigationGestures = true
    }
}
