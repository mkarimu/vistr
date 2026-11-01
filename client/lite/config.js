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
