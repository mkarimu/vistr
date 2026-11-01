// Vistr Lite settings.
//
// Google AdMob - for the Android app only (the web page at vistr.memoryq.com/lite shows no ads).
// The Android build script rewrites this file for each build ("auto"): test builds get Google's
// TEST ad units, -Release builds get the real ones. Vistr Lite is used in classrooms, so it is
// set up as a game for children: child-directed ads only, G-rated content, no personalised ads.
// Nothing here is switched on yet: Lite v0.1 is web only.
window.LITE_ADMOB = {
  enabled: false,                 // the Android build switches this on
  testing: true,                  // true = Google's test ad units
  appId: '',                      // the AdMob app id of Vistr Lite (when it has one)
  banner: '',                     // banner ad unit (setup and results screens only, never during play)
  interstitial: '',               // full-screen ad unit (between games, never during a turn)
  childDirected: true,            // tagForChildDirectedTreatment
  underAgeOfConsent: true,        // tagForUnderAgeOfConsent
  maxAdContentRating: 'G',
  nonPersonalized: true,
};

// Google AdSense on the web page: ONE ad, on the page that appears when a game ends (never during play).
// client = the AdSense publisher id (it is public: it is also in app-ads.txt).
// slot   = the number of a display ad unit: AdSense -> Ads -> By ad unit -> Display ads -> create one, then copy
//          the number after data-ad-slot= into 'slot' below. Until then no ad is shown.
// The ad is requested as non-personalised and for children (data-tag-for-age-treatment).
window.LITE_ADS = {
  enabled: true,
  client: 'ca-pub-2298775225198657',
  slot: '',
};
