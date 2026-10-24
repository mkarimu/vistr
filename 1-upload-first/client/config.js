// Settings the app reads at start-up. The Android build script rewrites this file
// in the built app; this copy is what the PC/browser version uses.

// Where the app finds the game server. Empty = the address this page was opened from.
window.VISTR_SERVER = '';

// Google AdMob (Android app only; the PC/browser version shows your own ads from
// server/data/ads.json). The build script rewrites this for each Android build:
// test builds get Google's TEST ad units, -Release builds your real ones.
// App id ca-app-pub-2298775225198657~1169687339 goes into the Android manifest.
window.VISTR_ADMOB = {
  enabled: true,
  testing: true,
  banner: '',                                               // no AdMob banner unit yet
  interstitial: 'ca-app-pub-3940256099942544/1033173712',  // test interstitial
  maxAdContentRating: 'Teen',      // young players: no mature ads
  childDirected: false,            // set true if you target children under 13
  underAgeOfConsent: false,
};
