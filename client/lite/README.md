# Vistr Lite 0.1

A pass-and-play word game for one screen (the classroom): 2 to 4 players or teams take turns on the same board.
Lives in the Vistr project and server (`client/lite`), opened at `vistr.memoryq.com/lite/`.

* `core.js`   - the rules (no screen, no timers): turns, scoring, the team lock, pause, the fair-reset loss. Tested by `test/lite.test.js`.
* `lite.js`   - the screens: setup, play (normal and classroom mode), results, Reset / Return / teacher PIN pop-ups.
* `lite.css`  - normal mode adapts to any screen; classroom mode (`body.classroom`) fills a TV: ribbon 11%, scrollers 80%, Process 9% of the height.
* `config.js` - Google AdMob settings, switched off in 0.1. The Android build script will rewrite it per build (Google test units for test builds, real ones for -Release). Set for children: child-directed, G-rated, no personalised ads. Ads belong only on the setup and results screens.

Rules in short: a player changes exactly one letter per move; a team move can change two (one for each teammate, the second drum touched locks the rest);
the side that presses Reset before the game is over loses, unless the teacher's PIN confirms a frozen screen or the end of the lesson.
Not in 0.1: online (away) play, Android app, interface translations (the word lists are English, Spanish, French, Portuguese and Kiswahili).
