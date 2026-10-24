# Vistr Word Game — starter

Change one letter at a time; every real word is +1, every non-word is −1.
One or two players, word lengths 4–7, email sign-in, live opponent score,
each player's top 10 and an all-time board per level.

```
vistr/
  server/            Node.js game server (no dependencies)
    server.js        HTTP API, live events, lobby, match engine, scoring
    dictionary.js    word checks and start-word picking
    store.js         JSON-file storage (players, sessions, results)
    data/            ads.json, ad images (+ db.json once you play)
  client/            the game app: one web app for PC and Android
    engine.js        game rules and scoring, shared with the server
    words/           word lists per level (bundled in the app for offline play)
  mobile/            Capacitor wrapper that turns client/ into an Android APK
  tools/             build_dictionary.py, rebuilds the word lists
  test/e2e.test.js   end-to-end test of the server
```

## Updating to a new version (one double-click)

1. Download the new `vistr-starter.zip` (leave it in Downloads).
2. Plug the phone in by USB.
3. Double-click **`Update-Vistr.bat`** in your `vistr` folder.

It finds the newest zip by itself (Downloads, OneDrive\Downloads, Desktop or
Documents, even if it's called "vistr-starter (3).zip") and then:

1. stops the old game server;
2. copies the new files over your `vistr` folder, keeping your players, scores
   and signing key;
3. starts the server again in a window called "Vistr server";
4. builds the app and installs it on every phone plugged in.

The window stays open at the end, so you can read what happened. Everything is
also saved to `update-log.txt` in the `vistr` folder. If it stops, the red
message says why.

Options go after the file name in a Command Prompt or PowerShell window, for
example `.\Update-Vistr.bat -Server https://play.example.com` to build for your
hosted server (remembered for next time), `-Server here` to go back to this PC,
`-SkipBuild`, or `-Release -VersionCode 2 -VersionName 1.1`. The full list is at
the top of `update-vistr.ps1`.

## 1. Run it on a PC (Windows, macOS, Linux)

Needs Node.js 18 or newer (https://nodejs.org). Nothing else to install.

- Windows: double-click `start-windows.bat`.
- macOS / Linux: `./start.sh` (or `npm start`).

Then open http://localhost:3000. To use it like a desktop app, in Chrome or
Edge choose **Install Vistr** from the address-bar menu.

Sign-in: a new player enters their email once and gets a Player ID, a plain
number (10, 11, 12 ... up to 9999). After that they sign in with the ID alone,
and the app remembers them. To also email each new player their ID, set
these before starting the server (uses the Resend API, https://resend.com):

```
RESEND_API_KEY=re_xxx   MAIL_FROM="Vistr <play@yourdomain.com>"
```

Other settings: `PORT` (default 3000), `ROUND_SECONDS` (default 300),
`TURN_SECONDS` (time per turn in two-player games, default 30).

## 2. Play on an Android phone

The phone talks to the server over your network. Find the PC's local address
(Windows: `ipconfig`, look for IPv4, e.g. `192.168.1.20`) and make sure the
phone is on the same Wi-Fi. Allow Node through the Windows firewall when asked.

**Quickest (no build):** on the phone open Chrome at
`http://192.168.1.20:3000`. Menu → **Add to Home screen**.
(Full "Install app" mode needs HTTPS, which you get once the server is
hosted; see section 5.)

**Real APK, one command (Windows):** needs Android Studio (opened once, so it
downloads the Android SDK), **Java 21, 22 or 23** (Temurin 21 from
https://adoptium.net if you have none of those; Java 25, which recent Android
Studio bundles, is too new for this build), and USB debugging on the phone.
Connect the phone by USB, then in PowerShell:

```
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
& "$([Environment]::GetFolderPath('MyDocuments'))\vistr\mobile\build-android.ps1"
```

(Change the path if the `vistr` folder is somewhere else.) It picks a
suitable Java, builds the server address into the app (this PC's Wi-Fi
address, port 3000), builds the APK and installs it. Players are never asked
for a server address. The phone must be on the same Wi-Fi as the PC. For a
hosted server, add `-Server https://your-server.example.com`.

**Real APK, by hand (Capacitor):** on a PC with Android Studio installed:

```
cd mobile
npm install
npm run setup        # copies client/ into the app and creates android/
npm run open         # opens Android Studio
```

In Android Studio: **Build → Build APK(s)**, then copy the APK to the phone,
or press Run with the phone connected by USB. After changing anything in
`client/`, run `npm run sync` again.

Before building by hand, put your server address in `mobile/www/config.js`
(`window.VISTR_SERVER = 'http://192.168.1.20:3000';`) after `npm run sync`'s
copy step, or use the script above, which does it for you.

## 3. How it plays

The app has two modes, picked with the **Offline / Online** buttons on the home
screen. A badge at the top always shows which one you're in.

- **Offline** (how it opens the first time): solo games only, no sign-in, no
  server and no internet needed. The dictionary and game engine are inside
  the app; each device keeps its own top 10.
- **Online**: shows "Connecting…", then checks whether this device is already
  registered. If it is, it connects straight away. If not, it asks for an
  email: a new email gets a new Player ID, and an email used before gets its
  existing ID back. Online you see who wants a play mate, they can see you,
  and the server keeps all-time boards. If the server can't be reached, the
  app says so and stays offline.

Both modes use the same rules engine, `client/engine.js` (the server loads
the same file), so scoring is identical.

1. Online, first time: enter your email and you get a Player ID such as `27`.
   Next time: type the ID (the app remembers it, so usually just tap Play).
2. Pick a word length (4, 5, 6 or 7) and an intensity:
   - **Learner** (★): everyday words, jackpots 1–2 moves away, no penalty for
     a non-word, unlimited hints.
   - **Intermediate** (★★): familiar words with some vocabulary, jackpots 2–4
     moves away, −1 per non-word, 3 hints.
   - **Advanced** (★★★): rarer words, jackpots 3–4 moves away, no hints.
   **Hint** lights up the letter worth rolling. Each length and intensity has
   its own top 10 and all-time board.
3. **Play solo**, or play someone from the **Play with someone** list on the
   home screen. It shows every online player who has **Show me as
   available** switched on (on by default), what they are doing, and the
   time left in their solo game. Tap a player, or type their ID, to send a
   request for the selected word length. The request pops up for them even
   in the middle of a solo game; if they accept, their solo game is saved
   and ended and you both go to the Start screen. Requests stay open for 2 minutes.
4. Each player taps **Start**; the game begins when both are ready.
   Two-player games take turns on one shared word. A coin toss picks who
   goes first. On your turn you change one letter and tap Process; real word
   or not, the turn then passes and the other phone shows the new word at
   once. While it's the other player's turn your drums are locked. Each turn
   lasts 30 seconds; if it runs out, the turn passes with no points lost.
5. Roll one letter (tap ▲▼, drag the drum, mouse wheel, or on a keyboard:
   ←/→ pick, ↑/↓ roll, type a letter, Enter processes). Rolling a second drum
   is refused: the other drums lock (🔒) until you roll the letter back or tap
   Undo, so only one letter is ever changed.
6. **Process** locks the drums until the server rules: real word +1 and it
   becomes your word; not a word −1 and your word stays.
   Bonuses: rolling in J, Q, X or Z is +3 extra (K, V, W, Y +1); from the
   3rd real word in a row each word is +1 extra; and 5 hidden jackpot words,
   2 to 4 moves from the start, are worth +10. A jackpot, or any word worth 4
   or more, sets off balloons, racing stars and a BIG SCORE banner. If a
   player runs out of moves, they get a fresh word with new jackpots.
   Stuck? **Next word** deals a fresh word (with new jackpots). No points
   are lost but the streak resets. 4 skips are free; the 5th ends the round.
   Tune all the numbers in `client/engine.js`.
7. Rounds last 5 minutes (change with `ROUND_SECONDS`). Results show both scores, your top 10 at that
   length and the all-time board.

Choices made where the design left it open (see the design doc): 5-minute
rounds; two players take turns on one shared word;
scores can go negative; a word can't be reused in a round (refused, no point
lost); changing no letters or two letters is blocked, with no point lost.

## 4. Ads

The app has two ad spaces, both filled from `server/data/ads.json`:

- **Banner:** a 60-pixel strip at the bottom of every screen. It rotates
  every 30 seconds.
- **Between-round card:** a full-screen card after every 2nd round, at most
  once every 3 minutes. Players can close it with × at once, or wait for the
  5-second countdown. It never appears during play.

Edit `ads.json` to add, pause (`"active": false`) or reweight ads. The app
picks up changes within a minute, with no restart and no new APK. Images go
in `server/data/ad-images/` (refer to them by file name) or can be any
https:// address. Banners look best at a 1:1 or 4:3 image, 44 px tall.
Change the timings under `"rules"`.

Views and clicks per ad (per day too) are saved. To see them, start the
server with `ADMIN_KEY=something-secret` and open
`http://localhost:3000/api/ads/stats?key=something-secret`.

The starter ads are placeholders: replace `you@example.com` with your
contact address before players see them.

If you later want ad-network ads (for example Google AdMob) instead of
selling the spaces yourself, they slot into the same two places. Ad networks
have strict rules for apps used by under-18s, and especially under-13s, so
check their family/child policies before you switch them on.

## Languages

Players pick a language in the ☰ menu: **English, Español, Français, Português or
Kiswahili**. On first start the app picks the phone's language if it's one of
these. The language changes everything: buttons, messages, How to play, About,
and **the words you play with**.

- Each language has its own word lists (`client/words/<lang>/`), its own letters
  on the drums (Spanish adds Ñ) and its own bonus letters (the rarest letters in
  that language). Accents don't count, as in Scrabble: é is E, ç is C.
- Leaderboards are kept per language, word length and intensity.
- In two-player games, the language of the player who sends the request is used;
  the other player sees it on the request.
- Privacy and Terms stay in English (with a note saying so). Contact, Reviews and
  everything else are translated.

**Changing a translation:** edit `tools/translations.py` (each English line with
its Spanish, French, Portuguese and Swahili versions) and run
`python3 tools/translations.py`; About and How to play are in
`tools/make_pages.py` (`python3 tools/make_pages.py`).
`python3 tools/i18n_keys.py --missing es` lists any English text not yet
translated. The translations were written without native-speaker review, so have
a fluent speaker check each language (Swahili especially) before launch.

**Word lists** come from open-source spelling dictionaries and word-frequency
lists. Sources and licences are in `client/words/SOURCES.txt`;
`tools/build_lang.py` rebuilds them.

## Messages and reviews

**Contact us** (in the ☰ menu, and at `/contact.html` on your website) is a form,
so your email address never appears in the app or on the pages. Messages are
saved on the server. To read them, open `admin.html` on the server (for example
`http://localhost:3000/admin.html`) and enter the admin key: `ADMIN_KEY` if you
set one, otherwise the key the server prints when it starts (also saved in
`server\data\admin-key.txt`). From there you can reply by email or delete messages.

To also get each message in your inbox, set `RESEND_API_KEY`, `MAIL_FROM` and
`CONTACT_TO` (your address) on the server (see `deploy/vistr.service`). Your
address stays on the server.

**Reviews** (☰ → Reviews, and `/reviews.html`) show the average rating, a
star chart and players' reviews. Online players can post one review each
(posting again updates it). Reviews with rude words wait for your approval; on
`admin.html` you can show or hide any review. Forms are limited to 5 messages
an hour per address, with a hidden trap field that catches spam bots.

## 5. Hosting on your own server

Your PC's address only works on your Wi-Fi. To let anyone play online, run the
game server on your own server, behind HTTPS on a domain such as
`play.example.com`. Ready-made files are in `deploy/`.

**What you need**

- A server you can log in to, with **Node.js 18 or newer** (20 is best). The
  game server needs nothing else: no database and no extra packages.
- A **domain or subdomain** pointing at the server (a DNS "A" record), with
  ports 80 and 443 open.
- **HTTPS.** Google Play builds require it. Caddy or certbot get you a free
  certificate (below).

### Quick way: vistr.memoryq.com with two scripts

Your code is on GitHub and your players are in Upstash, so moving servers keeps
everything.

1. **DNS (on your PC):** `deploy\cloudflare-dns.ps1` creates `vistr.memoryq.com`
   in Cloudflare, pointing at the same server as memoryq.com. It asks for a
   Cloudflare API token (Cloudflare → My Profile → API Tokens → Create Token →
   "Edit zone DNS" → zone memoryq.com).
   ```
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
   & "$([Environment]::GetFolderPath('MyDocuments'))\vistr\deploy\cloudflare-dns.ps1"
   ```
2. **Server:** copy `deploy/setup-server.sh` to the server, then **check first**.
   `check` only looks and changes nothing; send its output to Claude.
   ```
   scp "$([Environment]::GetFolderPath('MyDocuments'))\vistr\deploy\setup-server.sh" you@your-server:
   ssh -t you@your-server "sudo bash setup-server.sh check"
   ssh -t you@your-server "sudo bash setup-server.sh"
   ```
   The install never touches memoryq.com: it leaves the server's Node.js alone
   (the game gets its own copy if needed), picks a free port, backs up the web
   server's settings to /root/vistr-backups, adds one site for vistr.memoryq.com,
   tests it, undoes it if the test fails, and asks before each change.
   `sudo bash /opt/vistr/deploy/setup-server.sh uninstall` removes exactly what it added.
   **Suspend the Render service first**, so only one server uses the Upstash
   database.
3. **App:** build with `-Server https://vistr.memoryq.com`.

Updates later: upload the new files to GitHub, then on the server run
`sudo bash /opt/vistr/deploy/setup-server.sh update`.

### A. Linux server (Ubuntu or Debian)

1. **Install Node.js 20:**
   ```
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```
2. **Copy the game to the server.** Only `server`, `client`, `deploy` and
   `package.json` are needed. From PowerShell on your PC:
   ```
   cd "$([Environment]::GetFolderPath('MyDocuments'))\vistr"
   scp -r server client deploy package.json you@your-server:/tmp/vistr/
   ```
   Then on the server:
   ```
   sudo useradd --system --home /opt/vistr vistr
   sudo mv /tmp/vistr /opt/vistr && sudo chown -R vistr /opt/vistr
   ```
3. **Run it as a service** that starts at boot. First change `ADMIN_KEY` in
   `deploy/vistr.service`.
   ```
   sudo cp /opt/vistr/deploy/vistr.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now vistr
   curl http://127.0.0.1:3000/api/health        # shows {"ok":true,...}
   ```
4. **Add HTTPS**, with either Caddy (simplest: it handles the certificate
   itself) or nginx:
   - **Caddy:** install it (https://caddyserver.com/docs/install), put your
     domain in `deploy/Caddyfile`, copy it to `/etc/caddy/Caddyfile`, then
     `sudo systemctl reload caddy`.
   - **nginx:** follow the steps at the top of `deploy/nginx-vistr.conf`.
     `certbot --nginx` adds the certificate.
   - Already running Apache or another web server? Proxy your domain to
     `http://127.0.0.1:3000`, with buffering **off** for `/api/events` (live
     game events).
5. **Check it:** open `https://play.example.com/api/health` (`{"ok":true}`),
   then `https://play.example.com` in a phone browser to play.
6. **Build the app for it:**
   ```
   & "$([Environment]::GetFolderPath('MyDocuments'))\vistr\mobile\build-android.ps1" -Server https://play.example.com
   ```

**Keep your PC's players:** stop the service, copy `server\data\db.json`
from your PC to `/var/lib/vistr/db.json` (owned by the `vistr` user), then start
the service again.

**Updates:** copy the new `server` and `client` folders over `/opt/vistr`, then
`sudo systemctl restart vistr`. Player data in `/var/lib/vistr` is not touched.

**Backups:** player IDs and scores are all in `/var/lib/vistr/db.json`. Copy it
somewhere safe regularly, for example with a daily cron job:
`0 3 * * * cp /var/lib/vistr/db.json /home/you/backups/vistr-$(date +\%F).json`.

**Log:** `sudo journalctl -u vistr -f`.

### B. Windows server

Copy the `vistr` folder over and run `start-windows.bat` (or set it up in Task
Scheduler, "At startup", so it survives restarts). For HTTPS, run Caddy for
Windows (https://caddyserver.com/download) with `deploy\Caddyfile`.

### C. Shared hosting (cPanel)

If your plan has **Setup Node.js App**, create an app with the application root
set to the `vistr` folder and the startup file `server/server.js`. Some shared
hosts buffer the live game events. If requests or the other player's moves show
up a few seconds late, that's why; the app's 5-second check keeps the game
working. Plans without Node.js can't run the game server.

### Pages for Google Play

Your server publishes the app's pages at public addresses. Google Play asks for
the privacy policy one:

- `https://play.example.com/privacy.html` (Privacy & policies)
- `https://play.example.com/terms.html` (Terms & conditions)
- `https://play.example.com/about.html` and `/how-to.html`

**Sharing the test APK:** after a build it is at
`mobile\android\app\build\outputs\apk\debug\app-debug.apk`. Send it by
Google Drive or WhatsApp, or attach it to a GitHub Release (Releases → Draft a
new release). Friends allow "Install unknown apps" when Android asks.

(For hosts whose disk is wiped on restart, the server can also keep its data in
an Upstash Redis database: set `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN`. Not needed on your own server.)

## 6. AdMob and publishing on Google Play

Your AdMob setup is already built in:

| What | ID | Used in |
|---|---|---|
| App ID | `ca-app-pub-2298775225198657~1169687339` | every Android build (in the app's manifest) |
| Interstitial unit | `ca-app-pub-2298775225198657/2593704781` | Google Play builds (`-Release`) |
| Banner unit | none yet | the bottom strip shows your own ads from `ads.json` |

Test builds (installed over USB) always show Google's **test** ad units, as
AdMob policy requires: never view or tap your own live ads. The full-screen ad
appears only after a round ends (every 2nd round, at most once every 3
minutes), never during play or when the app opens. It is loaded ahead of time
and refreshed hourly. Ads are limited to content suitable for teens, and
Google's consent form is shown where the law requires it.

When you create a banner unit in AdMob, add `-AdMobBannerId ca-app-pub-…/…`
to the release command below.

**app-ads.txt**: AdMob asks for this file on your developer website (the site
you list in Google Play). The game server already publishes it at
`/app-ads.txt` with your publisher line. If your website is elsewhere, copy
`client/app-ads.txt` to the root of that site.

**Before the first Google Play upload**

1. **Host the game server** on the internet with HTTPS (section 5) so players
   anywhere can go online. Your home PC's address only works on your Wi-Fi.
2. **Privacy policy and terms**: fill in your country or state (highlighted in
   `client/terms.html`). Contact goes through the contact form. Your server
   publishes the pages (section 5); give the privacy address to Google Play.
3. **Google Play Console** (https://play.google.com/console, one-time fee):
   create the app; in *App content*, declare **Contains ads: yes**, target
   audience **13+** (or follow the Families rules if you include under-13s),
   and fill in *Data safety*: email address and game activity collected for
   account features; advertising ID used by AdMob.
4. In AdMob, link the app to its Google Play listing once it is published.

**Build the upload file** (signed `.aab`):

```
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
& "$([Environment]::GetFolderPath('MyDocuments'))\vistr\mobile\build-android.ps1" -Release `
   -Server https://your-server.example.com -VersionCode 1 -VersionName 1.0
```

The first time, it creates your upload key in `mobile\keys\` and asks you to
pick a password. **Back up that file and password**: every future update must
be signed with the same key. The finished file lands in `mobile\release\`.
For each update, raise `-VersionCode` by 1.

## 7. Taking it further

- **Hosting:** section 5 covers your own server. Any Node.js host works the
  same way.
- **Database:** `store.js` writes one JSON file; fine for testing and a few
  hundred players. Swap the functions in it for Postgres/SQLite to scale.
- **Words:** lists come from the open-source Hunspell en_US dictionary
  (SCOWL). Start words and jackpots are limited to familiar words
  (`common_N.txt`), and rude words in `blocked.txt` are never dealt or hidden
  as jackpots (players can still make them). Replace `client/words/words_N.txt` with any list (one word per line);
  `start_N.txt` is optional. Or rebuild with `npm run build-dictionary`.
- **Server won't start?** It prints why. "Port 3000 is already in use" means
  an older server is still running: close its window, or run
  `Get-Process node | Stop-Process -Force`, then start again.
- **Tests:** `npm test` runs the scoring tests and a full single-player and
  two-player game against the server.
