// Vistr client — one page for PC browsers, Android (installed web app or Capacitor APK).
(() => {
  'use strict';

  const E = window.VistrEngine;
  const A_Z = 'abcdefghijklmnopqrstuvwxyz';
  // The letters on the drums: the current game's language (Spanish adds Ñ).
  const abc = () => S.match?.rules?.alphabet || E.LANGS[S.match?.lang || S.lang]?.alphabet || A_Z;
  const isNative = !!window.Capacitor?.isNativePlatform?.();
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const app = $('#app');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const saved = (k, v) => {
    try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) { return null; }
  };

  const S = {
    // Server address: one set by hand on the "can't reach" screen, else the one built into
    // the app (config.js), else the address this page came from (PC browser).
    server: saved('vistr.serverOverride') || window.VISTR_SERVER || (isNative ? 'http://localhost:3000' : location.origin),
    token: saved('vistr.token') || (() => { try { return sessionStorage.getItem('vistr.token'); } catch (_) { return null; } })(),
    // Standalone (default): solo games on this device, no server needed.
    // Live: signed in to the server, visible to others, two-player games.
    mode: saved('vistr.mode') === 'live' ? 'live' : 'standalone',
    player: null,
    level: [4, 5, 6, 7].includes(Number(saved('vistr.level'))) ? Number(saved('vistr.level')) : 5,
    intensity: ['learner', 'intermediate', 'advanced'].includes(saved('vistr.intensity')) ? saved('vistr.intensity') : 'learner',
    // Language of the whole game: the words played and the app's text.
    lang: E.LANGS[saved('vistr.lang')] ? saved('vistr.lang')
      : (navigator.languages || [navigator.language || 'en']).map(l => String(l).slice(0, 2).toLowerCase()).find(l => E.LANGS[l]) || 'en',
    screen: null,
    match: null,
    events: null,
    game: null,         // { current, draft[], changed, focus, locked, seq, chain[] }
    clockTimer: null,
    clockSkew: 0,
    inviteTimer: null,
  };

  // AbortSignal.timeout is missing on older Android WebViews, so build the timeout by hand.
  function timeoutSignal(ms) {
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) return AbortSignal.timeout(ms);
    const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal;
  }

  // ───────────────────────── text in the player's language ─────────────────────────
  // English is written in the code; client/i18n.js has the other languages, keyed by
  // the English text. {name} parts are filled in. Anything missing stays English.
  const I18N = window.VISTR_I18N || {};
  const fill = (s, v) => (v ? String(s).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : String(s));
  function t(en, v) { const x = (I18N[S.lang] || {})[en]; return fill(x ?? en, v); }
  // Server messages arrive in English: exact matches first, then patterns like "Player {p} ...".
  const patterns = {};
  function tr(en) {
    const table = I18N[S.lang]; if (!table || !en) return en;
    if (table[en]) return table[en];
    if (!patterns[S.lang]) patterns[S.lang] = Object.keys(table).filter(k => k.includes('{')).map(k => {
      const names = [];
      const rx = new RegExp('^' + k.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, (_, n) => { names.push(n); return '(.+?)'; }) + '$');
      return { rx, names, out: table[k] };
    });
    for (const p of patterns[S.lang]) {
      const m = en.match(p.rx);
      if (m) return fill(p.out, Object.fromEntries(p.names.map((n, i) => [n, m[i + 1]])));
    }
    return en;
  }
  // Screens come from the HTML templates in English: translate their text and labels.
  const original = new WeakMap();
  function translateDom(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentElement?.closest('script, style, [data-no-t]')) continue;
      if (!original.has(n)) original.set(n, n.nodeValue);
      const en = original.get(n), key = en.trim();
      if (!key || !/[A-Za-z]/.test(key)) continue;
      const x = t(key);
      n.nodeValue = x === key ? en : en.replace(key, x);
    }
    for (const el of root.querySelectorAll ? [root, ...root.querySelectorAll('[placeholder], [aria-label], [title], [alt]')] : []) {
      for (const at of ['placeholder', 'aria-label', 'title', 'alt']) {
        if (!el.hasAttribute || !el.hasAttribute(at)) continue;
        const k = `data-en-${at}`;
        if (!el.hasAttribute(k)) el.setAttribute(k, el.getAttribute(at));
        el.setAttribute(at, t(el.getAttribute(k)));
      }
    }
  }

  // ───────────────────────── API ─────────────────────────
  async function api(method, path, body) {
    const r = await fetch(S.server.replace(/\/$/, '') + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: `Bearer ${S.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && S.token) { sessionEnded(); throw new Error(t('Your session ended. Sign in again.')); }
    if (!r.ok && !('outcome' in data)) {
      const err = new Error(data.error ? tr(data.error) : t('The server answered {n}.', { n: r.status }));
      err.status = r.status; throw err;
    }
    return data;
  }

  // ───────────────────────── standalone games (on this device) ─────────────────────────
  const Local = {
    data: {}, timer: null,
    // Word lists per language: English in words/, others in words/<lang>/.
    D(lang) { return (this.data[lang] = this.data[lang] || { words: {}, starts: {}, common: {}, easy: {}, pools: {}, blocked: null }); },
    async load(L, lang = S.lang) {
      const d = this.D(lang);
      if (d.words[L]) return;
      const base = lang === 'en' ? 'words/' : `words/${lang}/`;
      const get = f => fetch(base + f).then(r => { if (!r.ok) throw new Error(t('Could not load the word list.')); return r.text(); });
      const opt = f => get(f).catch(() => '');   // optional lists
      const [w, st, common, easy, blocked] = await Promise.all([get(`words_${L}.txt`), get(`start_${L}.txt`), opt(`common_${L}.txt`), opt(`easy_${L}.txt`), d.blocked ? null : opt('blocked.txt')]);
      const lines = t => t.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
      const set = new Set(lines(w));
      set.alphabet = E.LANGS[lang].alphabet;
      d.words[L] = set;
      d.starts[L] = lines(st);
      d.common[L] = common ? new Set(lines(common)) : null;
      d.easy[L] = easy ? new Set(lines(easy)) : null;
      if (blocked !== null) d.blocked = new Set(lines(blocked || ''));
    },
    opts(L, intensity, lang) { const d = this.D(lang); return { blocked: d.blocked, common: d.common[L], easy: d.easy[L], intensity }; },
    pick(L, intensity, lang) {
      const d = this.D(lang), key = `${L}:${intensity}`;
      if (!d.pools[key]) d.pools[key] = E.poolFor(d.starts[L], this.opts(L, intensity, lang), d.words[L]);
      return E.pickStart(d.words[L], d.pools[key], this.opts(L, intensity, lang));
    },
    hint(m) {
      if (m.status !== 'playing') return { error: t('The round is not running.') };
      return E.hint(m.state, this.D(m.lang).words[m.level], this.opts(m.level, m.intensity, m.lang));
    },
    skip(m) {
      if (m.status !== 'playing' || Date.now() > m.endsAt) return { error: t('Time is up.') };
      return E.applySkip(m.state, () => this.pick(m.level, m.intensity, m.lang));
    },
    newMatch(L, intensity, lang = S.lang) {
      return { local: true, id: 'local', level: L, intensity, lang, mode: 'single', status: 'pending', rules: E.publicRules(undefined, intensity, lang),
        players: [{ me: true, playerCode: 'You', ready: false, online: true, score: 0 }] };
    },
    start(m) {
      const st = this.pick(m.level, m.intensity, m.lang);
      m.state = E.newPlayer(st, m.intensity, m.lang);
      m.startWord = st.word; m.status = 'playing';
      m.serverNow = Date.now(); m.endsAt = Date.now() + E.RULES.round * 1000;
      m.players[0] = { ...m.players[0], ready: true, jackpotsFound: 0, jackpotsTotal: st.jackpots.length, streak: 0, skipsLeft: E.RULES.maxSkips, hintsLeft: E.status(m.state).hintsLeft };
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.finish(m, 'time'), E.RULES.round * 1000);
    },
    submit(m, word) {
      if (m.status !== 'playing' || Date.now() > m.endsAt) return { error: t('Time is up.') };
      return E.applyMove(m.state, word, this.D(m.lang).words[m.level], () => this.pick(m.level, m.intensity, m.lang));
    },
    finish(m, reason) {
      if (m.status === 'over') return;
      clearTimeout(this.timer);
      m.status = 'over';
      const p = m.state;
      m.players[0].score = p.score;
      const top = this.topTen(m.level, m.intensity, m.lang);
      top.push({ score: p.score, finishedAt: Date.now(), chain: [m.startWord, ...p.chain.filter(c => c.valid).map(c => c.word)] });
      top.sort((a, b) => b.score - a.score || a.finishedAt - b.finishedAt);
      saved(this.topKey(m.level, m.intensity, m.lang), JSON.stringify(top.slice(0, 10)));
      Plays.add();
      if (S.match === m) { showResults({ reason, local: true, match: m, topTen: this.topTen(m.level, m.intensity, m.lang), board: [] }); Ads.afterRound(); }
    },
    topKey(L, intensity, lang = 'en') { return lang === 'en' ? `vistr.top.${L}.${intensity}` : `vistr.top.${lang}.${L}.${intensity}`; },
    topTen(L, intensity, lang = 'en') {
      // Scores saved before intensities existed count as Intermediate (English).
      const key = saved(this.topKey(L, intensity, lang)) ?? (lang === 'en' && intensity === 'intermediate' ? saved(`vistr.top.${L}`) : null);
      try { return JSON.parse(key || '[]'); } catch (_) { return []; }
    },
  };

  async function startSolo(level) {
    if (S.mode === 'live') {
      const r = await api('POST', '/api/match/single', { level, intensity: S.intensity, lang: S.lang });
      S.match = r.match;
    } else {
      await Local.load(level, S.lang);
      S.match = Local.newMatch(level, S.intensity, S.lang);
    }
    showReady();
  }

  // Status badge + Offline/Online buttons on the home screen.
  function setNet(state) {
    const pill = $('#appbar .net-pill');
    if (pill) {
      pill.dataset.net = state === 'waking' ? 'connecting' : state;
      $('[data-net-text]', pill).textContent = t({ online: 'Online', offline: 'Offline', connecting: 'Connecting…', waking: 'Waking server…' }[state]);
      if (pill.tagName === 'BUTTON') {
        pill.disabled = state === 'connecting' || state === 'waking';
        pill.title = t(state === 'online' ? 'Tap to go offline' : 'Tap to go online');
      }
    }
    const go = $('[data-action=go-online]');
    if (go) {
      const id = S.player?.code || saved('vistr.lastId');
      const busy = state === 'connecting' || state === 'waking';
      go.classList.toggle('connecting', busy);
      go.disabled = busy;
      $('[data-go-title]', go).textContent = state === 'waking' ? t('Waking up the server…') : busy ? t('Connecting…') : id ? t('Go online as Player {p}', { p: id }) : t('Go online');
    }
    $('.together')?.classList.toggle('is-live', state === 'online');
  }

  // A hosted server on a free plan sleeps when nobody plays and takes up to a
  // minute to wake. Keep knocking for a while before calling it unreachable.
  // (A PC on the home Wi-Fi never sleeps, so it isn't waited for.)
  const hostedServer = () => /^https:\/\//.test(S.server || '');
  async function wakeServer() {
    if (!hostedServer() || navigator.onLine === false) return false;
    setNet('waking');
    const until = Date.now() + 90_000;
    while (Date.now() < until) {
      if (await reachable(S.server, 15_000).catch(() => false)) return true;
      await new Promise(r => setTimeout(r, 3000));
    }
    return false;
  }

  // ───────────────────────── switching Offline ⇄ Online ─────────────────────────
  // background: started by the app itself while the player may be busy; never
  // pulls them out of a game.
  async function goLive(opts = {}) {
    setNet('connecting');
    const started = Date.now();
    let ok = await reachable(S.server).catch(() => false);
    const wait = 700 - (Date.now() - started);          // let "Connecting…" show briefly
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    if (!ok && hostedServer()) {
      if (!opts.background) toast(t('Waking up the game server. After a quiet spell this takes up to a minute.'));
      ok = await wakeServer();
    }
    if (opts.background && S.screen !== 'home') {
      setNet('offline');
      if (ok) toast(t('The game server is ready. Tap Go online to play with others.'));
      return false;
    }
    if (!ok) {
      setNet('offline');
      toast(t("Can't reach the game server right now. You're still offline."));
      return false;
    }
    S.mode = 'live'; saved('vistr.mode', 'live');
    Ads.refresh(true);
    if (!S.token && !(await signInWithKnownId())) { showSignIn(); return true; }
    try {
      const r = await api('GET', '/api/me');
      S.player = r.player;
    } catch (e) {
      if (!S.token) return true; // session ended → sign-in screen is showing
      S.mode = 'standalone'; saved('vistr.mode', 'standalone');
      setNet('offline');
      toast(e.message); return false;
    }
    await becomeAvailable();
    connectEvents();
    showHome();
    toast(t("You're online as Player {p}.", { p: S.player.code }));
    return true;
  }
  // The app remembers this device's Player ID. Use it to go online without asking
  // for anything; the email page appears only when the ID isn't known (any more).
  async function signInWithKnownId() {
    const id = saved('vistr.lastId');
    if (!id || saved('vistr.signedOut')) return false;   // after Sign out, wait for the player to sign in
    try {
      const r = await api('POST', '/api/auth/id', { code: id });
      signedIn(r);
      return true;
    } catch (e) {
      // Only a server that says "no such player" makes the app forget the ID. A network
      // hiccup or "too many tries" never does: the ID is the player's for good.
      if (e.status === 404) saved('vistr.lastId', null);
      return false;
    }
  }

  async function becomeAvailable() {
    if (S.player && S.player.available === false) {
      const r = await api('POST', '/api/availability', { available: true }).catch(() => null);
      if (r) S.player.available = r.available;
    }
  }
  function goStandalone() {
    S.mode = 'standalone'; saved('vistr.mode', 'standalone');
    S.events?.close(); S.events = null;
    clearInterval(watchTimer);
    S.players = []; S.outgoing = null;
    showHome();
  }

  // Safety net for requests: the live connection can pause while the phone sleeps or
  // the app is in the background, so check with the server every few seconds too.
  let watchTimer = null;
  async function checkIn() {
    if (S.mode !== 'live' || !S.token) return;
    try {
      const r = await api('GET', `/api/players?lang=${S.lang}`);
      S.players = r.players; S.lobby = r.lobby; S.playersSkew = r.serverNow - Date.now();
      if (r.incoming && !$('#request-dialog').open) showRequest(r.incoming);
      if (S.outgoing && !r.outgoing) S.outgoing = null;
      if (S.screen === 'home') renderPlayers();
      if (S.screen === 'game' && S.game?.duo) {
        const { match } = await api('GET', '/api/match');
        if (match && match.status === 'playing' && (match.myTurn !== S.game.myTurn || match.current !== S.game.current)) onBoard(match);
      }
    } catch (_) {}
  }
  function watch() {
    clearInterval(watchTimer);
    watchTimer = setInterval(checkIn, 5000);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || S.mode !== 'live' || !S.token) return;
    if (!S.events || S.events.readyState === 2) connectEvents();   // 2 = closed
    checkIn();
  });

  function connectEvents() {
    S.events?.close();
    watch();
    const es = new EventSource(`${S.server.replace(/\/$/, '')}/api/events?token=${encodeURIComponent(S.token)}&lang=${S.lang}${isNative ? '&app=android' : ''}`);
    S.events = es;
    const on = (type, fn) => es.addEventListener(type, e => fn(JSON.parse(e.data)));
    on('players', d => {
      S.players = d.players; S.lobby = d.lobby; S.playersSkew = d.serverNow - Date.now();
      if (S.screen === 'home') renderPlayers();
    });
    on('request', showRequest);
    on('request-ended', onRequestEnded);
    on('match', m => { S.match = m; if (m.status === 'pending') showReady(); else if (S.screen === 'game') { renderOpponent(); onBoard(m); } });
    on('board', onBoard);
    on('match-start', m => { S.match = m; startGame(m); });
    on('opponent', d => {
      if (!S.match) return;
      const opp = S.match.players.find(p => !p.me);
      if (opp) Object.assign(opp, { score: d.score, current: d.current, moves: d.moves });
      renderOpponent();
    });
    on('match-over', d => {
      if (d.reason === 'switched') { // solo game closed to start a two-player game
        const me = d.match.players.find(p => p.me);
        S.match = null; S.game = null;
        toast(t('Solo game saved with {n} points.', { n: me ? me.score : 0 }));
        return; // the two-player game's Start screen follows right away
      }
      showResults(d); Ads.afterRound();
    });
  }


  // ───────────────────────── ads ─────────────────────────
  // Permanent banner at the bottom of every screen, plus a short card between rounds.
  // What runs is set on the server in server/data/ads.json.
  // Shown when the app has never reached the server (for example, standalone and offline).
  const BUILT_IN_ADS = {
    rules: { bannerRotateSeconds: 30, interstitialEveryRounds: 2, interstitialMinSeconds: 180, skipAfterSeconds: 5 },
    banners: [
      { id: 'house-live', title: 'Play a friend head to head', text: 'Tap Go online on the home screen', cta: '', url: '', bg: '#45c8f5', fg: '#2a1450', weight: 1 },
      { id: 'house-jackpot', title: '5 jackpot words hide in every round', text: 'Each one is worth +10. Can you find them all?', cta: '', url: '', bg: '#ffd23f', fg: '#2a1450', weight: 1 },
    ],
    interstitials: [
      { id: 'house-tip', title: 'Pro tip', text: 'Stuck? Try rolling a vowel. Swapping A, E, I, O or U opens up the most new words.', cta: '', url: '', bg: '#a8e44a', fg: '#2a1450', weight: 1 },
    ],
  };

  // Google AdMob in the Android app: a real banner and a full-screen ad between rounds.
  // Falls back to the house ads above if the plugin isn't there or an ad fails.
  const NativeAds = {
    on: false, bannerOn: false, interstitialReady: false, loadedAt: 0,
    plugin() {
      const C = window.Capacitor;
      if (!C || !isNative) return null;
      return C.Plugins?.AdMob || (C.registerPlugin ? C.registerPlugin('AdMob') : null);
    },
    async init() {
      const cfg = window.VISTR_ADMOB, A = this.plugin();
      if (!cfg?.enabled || !A) return false;
      try {
        await A.initialize({
          initializeForTesting: !!cfg.testing,
          tagForChildDirectedTreatment: !!cfg.childDirected,
          tagForUnderAgeOfConsent: !!cfg.underAgeOfConsent,
          maxAdContentRating: cfg.maxAdContentRating || 'Teen',
        });
        try { // privacy consent form where the law needs one (EU/UK)
          const info = await A.requestConsentInfo({ tagForUnderAgeOfConsent: !!cfg.underAgeOfConsent });
          if (info?.isConsentFormAvailable && info.status === 'REQUIRED') await A.showConsentForm();
          // Where consent is needed, Google requires a way to change it later: the menu shows one.
          this.privacyChoices = info?.privacyOptionsRequirementStatus === 'REQUIRED';
        } catch (_) {}
        if (cfg.banner) {   // no banner unit yet: the house banner keeps the bottom strip
          await A.showBanner({ adId: cfg.banner, adSize: 'ADAPTIVE_BANNER', position: 'BOTTOM_CENTER', margin: 0, isTesting: !!cfg.testing })
            .then(() => { this.bannerOn = true; document.body.classList.add('native-ads'); })
            .catch(() => {});
        }
        this.on = !!cfg.interstitial;
        if (this.on) {
          this.prepare();
          // A loaded interstitial expires after an hour, so load a fresh one hourly.
          setInterval(() => { if (Date.now() - this.loadedAt > 55 * 60_000) this.prepare(); }, 10 * 60_000);
        }
        return this.on || this.bannerOn;
      } catch (e) {
        console.warn('AdMob unavailable, using house ads:', e?.message || e);
        return false;
      }
    },
    prepare() {
      const cfg = window.VISTR_ADMOB, A = this.plugin();
      this.interstitialReady = false;
      A.prepareInterstitial({ adId: cfg.interstitial, isTesting: !!cfg.testing })
        .then(() => { this.interstitialReady = true; this.loadedAt = Date.now(); }).catch(() => {});
    },
    async showInterstitial() {
      if (!this.on || !this.interstitialReady) return false;
      if (Date.now() - this.loadedAt > 55 * 60_000) { this.prepare(); return false; }   // expired
      try { await this.plugin().showInterstitial(); } catch (_) { return false; }
      this.prepare();
      return true;
    },
  };

  const Ads = {
    data: null, current: null, timer: null,
    async load() {
      try {
        const r = await fetch(S.server.replace(/\/$/, '') + '/api/ads', { signal: timeoutSignal(5000) });
        if (r.ok) { this.data = await r.json(); saved('vistr.ads', JSON.stringify(this.data)); }
      } catch (_) { /* offline: use the last ads seen, or the built-in ones */ }
      if (!this.data) { try { this.data = JSON.parse(saved('vistr.ads')); } catch (_) {} }
      if (!this.data) this.data = BUILT_IN_ADS;
      this.showBanner();
      clearInterval(this.timer);
      const every = Math.max(10, Number(this.data?.rules?.bannerRotateSeconds) || 30);
      this.timer = setInterval(() => { this.showBanner(); }, every * 1000);
      if (!this.refreshing) { this.refreshing = true; setTimeout(() => this.refresh(), 60_000); }
    },
    async refresh(once) { // pick up edits to ads.json without restarting the app
      try {
        const r = await fetch(S.server.replace(/\/$/, '') + '/api/ads');
        if (r.ok) { this.data = await r.json(); saved('vistr.ads', JSON.stringify(this.data)); if (once) this.showBanner(); }
      } catch (_) {}
      if (!once) setTimeout(() => this.refresh(), 60_000);
    },
    pick(list, avoid) {
      const pool = (list || []).filter(a => a.weight > 0 && (list.length < 2 || a.id !== avoid));
      const total = pool.reduce((t, a) => t + a.weight, 0);
      let r = Math.random() * total;
      for (const a of pool) { r -= a.weight; if (r <= 0) return a; }
      return pool[0] || null;
    },
    imageUrl(a) {
      if (!a.image) return '';
      return /^https?:/i.test(a.image) ? a.image : `${S.server.replace(/\/$/, '')}/ad-images/${encodeURIComponent(a.image)}`;
    },
    colours(el, a) {
      el.style.setProperty('--ad-bg', a.bg || 'transparent');
      el.style.setProperty('--ad-bg-solid', a.bg || 'var(--ink)');
      el.style.setProperty('--ad-fg', a.fg || 'var(--cream)');
    },
    event(id, type) {
      fetch(S.server.replace(/\/$/, '') + '/api/ads/event', {
        method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, type }),
      }).catch(() => {});
    },
    open(a) {
      if (!a.url) return;
      this.event(a.id, 'click');
      // In the Android app, leaving the page hands the link to the phone's browser or mail app.
      if (isNative) location.href = a.url; else window.open(a.url, '_blank', 'noopener');
    },
    showBanner() {
      const slot = $('#ad-banner');
      if (NativeAds.bannerOn) { slot.innerHTML = ''; return; }   // AdMob draws its own banner here
      const a = this.pick(this.data?.banners, this.current?.id);
      if (!a) { slot.innerHTML = ''; slot.style.removeProperty('--ad-bg'); return; }
      this.current = a;
      const img = this.imageUrl(a);
      const inner = `${img ? `<img src="${esc(img)}" alt="">` : ''}
        <span class="ad-text"><b>${esc(t(a.title))}</b>${a.text ? `<small>${esc(t(a.text))}</small>` : ''}</span>
        ${a.cta && a.url ? `<span class="ad-cta">${esc(t(a.cta))}</span>` : ''}<span class="ad-tag">${t('Ad')}</span>`;
      slot.innerHTML = a.url ? `<a href="${esc(a.url)}" rel="noopener sponsored">${inner}</a>` : `<div class="ad-body">${inner}</div>`;
      this.colours(slot, a);
      const link = $('a', slot);
      if (link) link.onclick = e => { e.preventDefault(); this.open(a); };
      this.event(a.id, 'view');
    },
    // Called after each finished round; shows a card every few rounds, never during play.
    afterRound() {
      const rules = this.data?.rules || {};
      const rounds = Number(saved('vistr.rounds') || 0) + 1;
      saved('vistr.rounds', rounds);
      const every = Math.max(1, Number(rules.interstitialEveryRounds) || 2);
      const gap = (Number(rules.interstitialMinSeconds) || 180) * 1000;
      const last = Number(saved('vistr.lastInterstitial') || 0);
      if (rounds % every !== 0 || Date.now() - last < gap) return;
      saved('vistr.lastInterstitial', Date.now());
      NativeAds.showInterstitial().then(shown => {
        if (shown) return;
        const a = this.pick(this.data?.interstitials);
        if (a) this.showInterstitial(a, Math.max(0, Number(rules.skipAfterSeconds) || 5));
      });
    },
    showInterstitial(a, wait) {
      const dlg = $('#ad-interstitial');
      const card = $('.ad-card', dlg);
      this.colours(card, a);
      translateDom(dlg);
      $('[data-title]', dlg).textContent = t(a.title);
      $('[data-text]', dlg).textContent = t(a.text);
      const img = $('[data-img]', dlg); const src = this.imageUrl(a);
      img.hidden = !src; if (src) img.src = src;
      const cta = $('[data-cta]', dlg);
      cta.hidden = !(a.url && a.cta); cta.textContent = a.cta; cta.href = a.url || '#';
      cta.onclick = e => { e.preventDefault(); this.open(a); };
      const skip = $('[data-skip]', dlg);
      let left = wait;
      const tick = () => {
        skip.disabled = left > 0;
        skip.textContent = left > 0 ? t('Close in {n}', { n: left }) : t('Close');
        if (left-- > 0) dlg._t = setTimeout(tick, 1000);
      };
      clearTimeout(dlg._t); tick();
      skip.onclick = () => { if (!skip.disabled) dlg.close(); };
      $('[data-x]', dlg).onclick = () => dlg.close();   // × closes right away, no waiting
      dlg.onclose = () => clearTimeout(dlg._t);
      dlg.oncancel = null;
      dlg.showModal();
      this.event(a.id, 'view');
    },
  };

  // ───────────────────────── screens ─────────────────────────
  function mount(id, name) {
    S.screen = name;
    $('#reader')?.close();
    clearInterval(S.clockTimer);
    app.replaceChildren($(`#t-${id}`).content.cloneNode(true));
    translateDom(app);
    $$('[data-native-only]').forEach(el => { el.hidden = !isNative; });
    $$('[data-live-only]').forEach(el => { el.hidden = S.mode !== 'live'; });
    $$('[data-standalone-only]').forEach(el => { el.hidden = S.mode === 'live'; });
    setNet(S.mode === 'live' ? 'online' : 'offline');
    $$('[data-code]').forEach(el => { el.textContent = S.player?.code || ''; });
    $$('[data-level]', app).forEach(el => { if (!el.classList.contains('level')) el.textContent = S.level; });
    const first = $('input, .btn.primary', app);
    if (first && matchMedia('(hover: hover)').matches) first.focus();
  }
  function setError(msg) { const el = $('[data-error]', app); if (el) el.textContent = msg || ''; }
  async function guard(fn) { try { setError(''); await fn(); } catch (e) { setError(e.message); } }

  // Shown only when the server can't be reached. Normally the address is built into the app.
  function showServer(message) {
    mount('server', 'server');
    $('[data-message]').textContent = message || t("Can't reach the game server at {s}. Check that it is running and that this device is on the same network.", { s: S.server });
    const f = $('[data-form=server]');
    f.url.value = S.server || '';
    f.onsubmit = e => {
      e.preventDefault();
      guard(async () => {
        const url = f.url.value.trim().replace(/\/$/, '');
        if (!(await reachable(url))) throw new Error(t('No Vistr server answered at {s}.', { s: url }));
        S.server = url; saved('vistr.serverOverride', url);
        boot();
      });
    };
    app.onclick = e => {
      const a = e.target.closest('[data-action]')?.dataset.action;
      if (a === 'retry') boot();
      if (a === 'standalone') goStandalone();
    };
  }

  async function reachable(url, ms = 5000) {
    const r = await fetch(url.replace(/\/$/, '') + '/api/me', { signal: timeoutSignal(ms) }).catch(() => null);
    if (!r) return false;
    const body = await r.json().catch(() => null);
    return body !== null && (r.status === 401 || r.ok); // a Vistr server answers JSON
  }

  // remember = false: signed in only until the browser closes, and this device does not keep the Player ID.
  function signedIn(r, remember = true) {
    S.token = r.token;
    try { sessionStorage.removeItem('vistr.token'); if (!remember) sessionStorage.setItem('vistr.token', r.token); } catch (_) {}
    saved('vistr.token', remember ? r.token : null);
    S.player = r.player; saved('vistr.lastId', remember ? r.player.code : null); saved('vistr.signedOut', null);
    S.mode = 'live'; saved('vistr.mode', 'live');
    S.record = null;
    becomeAvailable();
    connectEvents();
  }

  function showSignIn() {
    mount('signin', 'signin');
    const fi = $('[data-form=id]'), fe = $('[data-form=email]');
    const last = saved('vistr.lastId');
    if (last) {   // the ID stays on this device after Sign out: offer it first
      fi.code.value = last; $('[data-has-id]').open = true;
      $('.signin-title').textContent = t('Welcome back, Player {p}', { p: last });
      $('.signin-title + .lead').textContent = t('Tap Go online with my ID. Your points and rating are waiting.');
      $('[data-form=email]').before($('[data-has-id]'));
    }
    const rem = () => $('[data-remember]')?.checked !== false;
    if (isNative) $('[data-memoryq-box]').hidden = true;   // the app's built-in page cannot open memoryq.com yet
    fi.onsubmit = e => {
      e.preventDefault();
      guard(async () => { signedIn(await api('POST', '/api/auth/id', { code: fi.code.value.trim(), remember: rem() ? 1 : 0 }), rem()); showHome(); toast(t("You're online as Player {p}.", { p: S.player.code })); });
    };
    fe.onsubmit = e => {
      e.preventDefault();
      guard(async () => {
        const r = await api('POST', '/api/auth/register', { email: fe.email.value.trim(), name: fe.name.value.trim(), remember: rem() ? 1 : 0 });
        signedIn(r, rem());
        if (r.isNew) showWelcome(true);            // new player: show their new ID
        else { showHome(); toast(t("Welcome back, Player {p}. You're online.", { p: r.player.code })); }
      });
    };
    app.onclick = e => {
      const a = e.target.closest('[data-action]')?.dataset.action;
      if (a === 'standalone') goStandalone();
      if (a === 'memoryq') location.href = memoryqLogin();
    };
  }
  // memoryq.com signs you in (Google or password) and sends you back here with a one-time code.
  function memoryqLogin() {
    const back = location.origin + location.pathname;
    return `${window.VISTR_MEMORYQ || 'https://memoryq.com'}/login?app=vistr&return=${encodeURIComponent(back)}`;
  }

  function showWelcome(isNew) {
    mount('welcome', 'welcome');
    $('[data-welcome]').textContent = t(isNew ? 'Welcome. Your Player ID is' : 'Welcome back. Your Player ID is');
    if (isNew) setTimeout(() => { const el = $('.big-id'); if (el) confetti(el); }, 150);
    app.onclick = e => { if (e.target.closest('[data-action]')?.dataset.action === 'continue') showHome(); };
  }

  function showHome() {
    mount('home', 'home');
    const pickIntensity = name => {
      S.intensity = name; saved('vistr.intensity', name);
      $$('[data-intensity]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.intensity === name)));
      $('[data-intensity-about]').textContent = t(E.INTENSITY[name].about);
      loadBoards($('[data-boards]'), S.level);
      renderPlayers();
    };
    $$('[data-intensity]').forEach(b => { b.onclick = () => pickIntensity(b.dataset.intensity); });
    const pick = L => {
      S.level = L; saved('vistr.level', L);
      $$('.level').forEach(b => b.setAttribute('aria-checked', String(Number(b.dataset.level) === L)));
      loadBoards($('[data-boards]'), L);
    };
    $$('.level').forEach(b => { b.onclick = () => { pick(Number(b.dataset.level)); renderPlayers(); }; });
    pick(S.level);
    pickIntensity(S.intensity);
    Plays.show();

    const live = S.mode === 'live';
    const goOffline = () => { goStandalone(); toast(t("You're offline. Solo games only.")); };
    const f = $('[data-form=request]');
    f.onsubmit = e => { e.preventDefault(); sendRequest(f.code.value); };

    app.onclick = e => {
      const btn = e.target.closest('[data-action]'); if (!btn) return;
      const a = btn.dataset.action;
      if (a === 'menu') Menu.open();
      if (a === 'page') Menu.page(btn.dataset.page);
      if (a === 'solo') guard(() => startSolo(S.level));
      if (a === 'go-online' && S.mode !== 'live') goLive();
      if (a === 'toggle-net') { if (S.mode === 'live') goOffline(); else goLive(); }
      if (a === 'request') sendRequest(btn.dataset.code);
      if (a === 'cancel-request') guard(async () => { await api('POST', '/api/request/cancel'); S.outgoing = null; renderPlayers(); });
      if (a === 'signout') guard(async () => { await api('POST', '/api/auth/signout').catch(() => {}); signedOut(); toast(t('Signed out. Your Player ID {p} is kept for next time.', { p: saved('vistr.lastId') })); });
      if (a === 'edit-name') { const nf = $('[data-form=name]'); nf.hidden = false; nf.name.value = S.record?.record?.name || ''; nf.name.focus(); }
      if (a === 'delete-id') { const df = $('[data-form=delete]'); df.hidden = false; btn.hidden = true; df.code.focus(); }
      if (a === 'keep-id') { const df = $('[data-form=delete]'); df.hidden = true; df.reset(); $('[data-action=delete-id]').hidden = false; }
    };
    const nf = $('[data-form=name]');
    nf.onsubmit = e => {
      e.preventDefault();
      guard(async () => {
        const r = await api('POST', '/api/me/name', { name: nf.name.value });
        if (S.record?.record) S.record.record.name = r.name;
        nf.hidden = true; Record.render(S.record);
        toast(r.name ? t('Saved. Only you and Vistr see your name.') : t('Name removed.'));
      });
    };
    const df = $('[data-form=delete]');
    df.onsubmit = e => {
      e.preventDefault();
      guard(async () => {
        const r = await api('POST', '/api/account/delete', { code: df.code.value.trim() });
        forgetPlayer();
        toast(t('Player ID {p} and everything saved with it have been deleted.', { p: r.deleted }));
      });
    };

    renderPlayers();
    if (!live) return;
    Record.show();
    S.clockTimer = setInterval(renderClocks, 1000);
    api('GET', `/api/players?lang=${S.lang}`).then(r => {
      S.players = r.players; S.lobby = r.lobby; S.playersSkew = r.serverNow - Date.now();
      S.outgoing = r.outgoing;
      if (r.incoming && !$('#request-dialog').open) showRequest(r.incoming);
      if (S.screen === 'home') renderPlayers();
    }).catch(() => {});
  }

  // ── Play with someone: live list of available players ──
  function renderPlayers() {
    const ul = $('[data-players]'); if (!ul || S.screen !== 'home') return;
    if (S.mode !== 'live') {
      return;
    }
    $('[data-avail-hint]').textContent = t('Others can see you and send you a request, even while you play solo. To hide, tap ONLINE at the top.');
    renderLobby();
    const out = $('[data-outgoing]');
    out.hidden = !S.outgoing;
    if (S.outgoing) $('[data-outgoing-text]').textContent = t('Request sent to Player {p} for {n} letters, {i}. Waiting for them…', { p: S.outgoing.to, n: S.outgoing.level, i: ilabel(S.outgoing.intensity) }) + langNote(S.outgoing.lang);
    const others = (S.players || []).filter(p => p.playerCode !== S.player?.code);
    ul.innerHTML = others.length ? others.map(p => `
      <li data-player="${esc(p.playerCode)}">
        <span class="who"><span class="pid">${t('Player {p}', { p: esc(p.playerCode) })}${p.lang && p.lang !== S.lang ? ` <small class="lang-tag">${esc(E.LANGS[p.lang]?.name || p.lang)}</small>` : ''}</span>
          <span class="status ${p.status === 'free' && !p.requested ? 'on' : ''}" ${p.status === 'solo' ? `data-ends="${p.endsAt}" data-lvl="${p.level}" data-int="${esc(ilabel(p.intensity))}"` : ''}>${statusText(p)}</span></span>
        ${p.requested || (S.outgoing && S.outgoing.to === p.playerCode) ? '' :
          `<button class="btn" type="button" data-action="request" data-code="${esc(p.playerCode)}">${t('Request')}</button>`}
      </li>`).join('')
      : `<li class="empty">${t('Nobody else is available right now. Play solo meanwhile; a request can reach you mid-game.')}</li>`;
    $$('[data-action=request]', ul).forEach(b => { b.textContent = t('Play {n} letters', { n: S.level }); b.title = t('{n} letters, {i}', { n: S.level, i: ilabel(S.intensity) }); });
  }
  // Online: everyone connected right now. Available: free to start a game this minute
  // (not in a game and not answering a request). Tap an available ID to send a request.
  function renderLobby() {
    const box = $('[data-lobby]'); if (!box) return;
    const L = S.lobby || { online: [], available: [] }, me = S.player?.code;
    const chip = (code, tap) => code === me
      ? `<span class="id-chip me">${esc(code)} <small>${t('you')}</small></span>`
      : tap ? `<button type="button" class="id-chip tap" data-action="request" data-code="${esc(code)}" title="${esc(t('Send Player {p} a request', { p: code }))}">${esc(code)}</button>`
        : `<span class="id-chip">${esc(code)}</span>`;
    $('[data-online-count]', box).textContent = L.online.length;
    $('[data-available-count]', box).textContent = L.available.length;
    $('[data-online-ids]', box).innerHTML = L.online.map(c => chip(c, false)).join('') || `<span class="none">${t('nobody yet')}</span>`;
    $('[data-available-ids]', box).innerHTML = L.available.map(c => chip(c, true)).join('') || `<span class="none">${t('nobody right now')}</span>`;
  }

  // ── The player's record: points, total, rating. Kept as long as the ID exists. ──
  const num = n => Number(n || 0).toLocaleString(S.lang);
  const Record = {
    async show() {
      if (S.record) this.render(S.record);
      try { const r = await api('GET', '/api/record'); S.record = r; if (S.screen === 'home') this.render(r); } catch (_) {}
    },
    render(r) {
      const box = $('[data-record]'); if (!box || !r?.record) return;
      const c = r.record;
      box.hidden = false;
      $('[data-record-id]', box).textContent = t('Player {p}', { p: c.playerCode });
      $('[data-record-rank]', box).textContent = t(c.rank);
      $('[data-record-name]', box).textContent = c.name || '';
      $('[data-action=edit-name]', box).textContent = t(c.name ? 'Change' : 'Add your name');
      $('[data-r-rating]', box).textContent = num(c.rating);
      $('[data-r-points]', box).textContent = num(c.points);
      $('[data-r-games]', box).textContent = num(c.games);
      $('[data-r-best]', box).textContent = num(c.best);
      const duo = c.wins + c.losses + c.draws;
      $('[data-r-line]', box).textContent = [
        c.games ? t('{n} points a game on average', { n: c.average.toLocaleString(S.lang) }) : t('Play an online game to start your record.'),
        duo ? t('Two-player: {w} won, {l} lost, {d} drawn', { w: c.wins, l: c.losses, d: c.draws }) : '',
        c.nextRank ? t('{n} more points to {r}', { n: num(c.nextRank.at - c.points), r: t(c.nextRank.name) }) : '',
      ].filter(Boolean).join(' · ');
      $('[data-top-rated]', box).innerHTML = (r.top || []).length
        ? r.top.map(p => `<li class="${p.playerCode === c.playerCode ? 'mine' : ''}"><span>${t('Player {p}', { p: esc(p.playerCode) })} <small>${esc(t(p.rank))}</small></span><b>${num(p.rating)}</b></li>`).join('')
        : `<li class="empty">${t('Players appear here after 3 online games.')}</li>`;
    },
  };

  const ilabel = name => t(E.INTENSITY[name]?.label || 'Intermediate');
  const langNote = l => (l && l !== S.lang ? ` (${E.LANGS[l]?.name || l})` : '');
  function statusText(p) {
    if (p.requested) return t('Answering a request');
    if (p.status === 'solo') return t('Playing solo, {n} letters, {i}, {t} left', { n: p.level, i: ilabel(p.intensity), t: timeLeft(p.endsAt) });
    return t('Ready to play');
  }
  function timeLeft(endsAt) {
    const s = Math.max(0, Math.ceil((endsAt - (Date.now() + (S.playersSkew || 0))) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  function renderClocks() {
    $$('[data-ends]').forEach(el => { el.textContent = t('Playing solo, {n} letters, {i}, {t} left', { n: el.dataset.lvl, i: el.dataset.int, t: timeLeft(Number(el.dataset.ends)) }); });
  }
  function sendRequest(code) {
    guard(async () => {
      const r = await api('POST', '/api/request', { playerCode: code, level: S.level, intensity: S.intensity, lang: S.lang });
      S.outgoing = { to: r.to, level: r.level, intensity: r.intensity, lang: r.lang };
      const f = $('[data-form=request]'); if (f) f.reset();
      renderPlayers();
    });
  }

  function showRequest(d) {
    const dlg = $('#request-dialog');
    translateDom(dlg);
    $('[data-from]', dlg).textContent = t('Player {p}', { p: d.from });
    $('[data-level]', dlg).textContent = d.level;
    $('[data-req-intensity]', dlg).textContent = ilabel(d.intensity) + langNote(d.lang);
    const note = $('[data-solo-note]', dlg);
    const inSolo = d.inSolo || (S.screen === 'game' && S.match?.mode === 'single');
    note.hidden = !inSolo;
    if (inSolo) note.textContent = d.soloScore != null ? t('Playing them ends your solo game. Your {n} points are saved.', { n: d.soloScore }) : t('Playing them ends your solo game. Your points so far are saved.');
    let left = d.expiresIn || 120;
    $('[data-left]', dlg).textContent = left;
    clearInterval(S.inviteTimer);
    S.inviteTimer = setInterval(() => {
      left -= 1; $('[data-left]', dlg).textContent = Math.max(0, left);
      if (left <= 0) { clearInterval(S.inviteTimer); if (dlg.open) dlg.close('expired'); }
    }, 1000);
    dlg.onclose = () => {
      clearInterval(S.inviteTimer);
      if (dlg.returnValue === 'accept') {
        api('POST', '/api/request/respond', { accept: true })
          .then(r => { S.match = r.match; showReady(); })
          .catch(e => toast(e.message));
      } else if (dlg.returnValue === 'decline') {
        api('POST', '/api/request/respond', { accept: false }).catch(() => {});
      }
    };
    dlg.returnValue = '';
    if (!dlg.open) dlg.showModal();
    if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
  }

  function onRequestEnded(d) {
    const iAsked = d.from === S.player?.code;
    if (iAsked) {
      S.outgoing = null;
      const msg = { declined: t('Player {p} said no this time.', { p: d.to }), expired: t("Player {p} didn't answer in time.", { p: d.to }),
        left: t('Player {p} went offline.', { p: d.to }), cancelled: '' }[d.reason];
      if (msg) toast(msg);
      if (S.screen === 'home') renderPlayers();
    } else {
      const dlg = $('#request-dialog');
      if (dlg.open && d.reason !== 'accepted') {
        dlg.returnValue = 'gone'; dlg.close();
        toast(d.reason === 'cancelled' ? t('Player {p} cancelled the request.', { p: d.from }) : t('That request closed.'));
      }
    }
  }

  function toast(text) {
    const t = $('#toast');
    t.textContent = text; t.hidden = false;
    replay(t, 'show');
    clearTimeout(t._t); t._t = setTimeout(() => { t.hidden = true; }, 3500);
  }

  async function loadBoards(el, level, mineHighlight) {
    el.innerHTML = '';
    if (S.mode !== 'live') {
      el.innerHTML = boardHtml(t('Your top 10, {n} letters, {i}', { n: level, i: ilabel(S.intensity) }), Local.topTen(level, S.intensity, S.lang).map(x => ({ name: fmtDate(x.finishedAt), score: x.score })),
        t('Your best games on this device will show here.'));
      return;
    }
    try {
      const r = await api('GET', `/api/scores?level=${level}&intensity=${S.intensity}&lang=${S.lang}`);
      el.innerHTML = boardHtml(t('Your top 10, {n} letters, {i}', { n: level, i: ilabel(S.intensity) }), r.topTen.map(x => ({ name: fmtDate(x.finishedAt), score: x.score, mine: x.finishedAt === mineHighlight })), t('Your best games will show here.'))
        + boardHtml(t('All-time, {n} letters, {i}', { n: level, i: ilabel(S.intensity) }), r.board.map(b => ({ name: t('Player {p}', { p: b.playerCode }), score: b.score, mine: b.playerCode === S.player?.code })), t('No games yet at this level.'));
    } catch (e) { el.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  }
  function boardHtml(title, rows, empty) {
    return `<section class="board"><h3>${esc(title)}</h3>${rows.length
      ? `<ol>${rows.map(r => `<li class="${r.mine ? 'mine' : ''}"><span>${esc(r.name)}</span><b>${r.score}</b></li>`).join('')}</ol>`
      : `<p class="empty">${esc(empty)}</p>`}</section>`;
  }
  const fmtDate = d => new Date(d).toLocaleDateString(S.lang, { month: 'short', day: 'numeric' }) + ', ' + new Date(d).toLocaleTimeString(S.lang, { hour: 'numeric', minute: '2-digit' });

  function showReady() {
    const m = S.match;
    S.level = m.level;
    if (S.screen !== 'ready') {
      mount('ready', 'ready');
      app.onclick = e => {
        const a = e.target.closest('[data-action]')?.dataset.action;
        if (a === 'ready') guard(async () => {
          if (S.match.local) { Local.start(S.match); startGame(S.match); return; }
          const r = await api('POST', '/api/match/ready'); if (r.match.status === 'pending') { S.match = r.match; showReady(); }
        });
        if (a === 'leave-match') guard(async () => { if (!S.match?.local) await api('POST', '/api/match/quit'); S.match = null; showHome(); });
      };
    }
    $('[data-level]', app).textContent = m.level;
    $('[data-title]').textContent = m.mode === 'duo' ? t('Both players tap Start') : t('Solo, {n} letters, {i}', { n: m.level, i: ilabel(m.intensity) });
    const me = m.players.find(p => p.me);
    $('[data-players]').innerHTML = m.players.map(p => `
      <li><span class="pid">${p.me ? t('You') : t('Player {p}', { p: esc(p.playerCode) })}</span>
      <span class="status ${p.ready ? 'on' : ''}">${t(!p.online && !p.me ? 'Offline' : p.ready ? 'Ready' : 'Not ready')}</span></li>`).join('');
    const btn = $('[data-action=ready]');
    btn.disabled = me.ready;
    btn.textContent = t(me.ready ? 'Waiting for the other player' : 'Start');
    const R = m.rules || {};
    const mins = Math.round((R.round || 300) / 60);
    $('[data-hint]').textContent = m.mode === 'duo'
      ? t("You take turns on one shared word for {m} minutes: change one letter, then it's the other player's go. {s} seconds per turn.", { m: mins, s: m.turnSeconds || 30 })
      : t("You have {m} minutes. Here's how to score:", { m: mins });
    const hot = Object.entries(R.hotLetters || {}).reduce((g, [l, pts]) => ((g[pts] = g[pts] || []).push(l.toUpperCase()), g), {});
    $('[data-rules]').innerHTML = [
      `<li>${t('Every real word')} <b>${pts(R.word ?? 1)}</b></li>`,
      `<li>${t('Not a word')} <b>${R.miss === 0 ? t('no penalty') : pts(R.miss ?? -1)}</b></li>`,
      ...Object.entries(hot).sort((a, b) => b[0] - a[0]).map(([n, ls]) => `<li>${t('Roll in {l}', { l: ls.join(' ') })} <b>${t('+{n} extra', { n })}</b></li>`),
      `<li>${t('{n}+ in a row', { n: R.streakFrom ?? 3 })} <b>${t('+1 extra each')}</b></li>`,
      `<li class="jp">${t('Hidden jackpot words')} <b>+${R.jackpot ?? 10}</b></li>`,
      `<li>${t('Hint (which letter to roll)')} <b>${R.hints < 0 ? t('unlimited') : R.hints === 0 ? t('none') : t('{n} per round', { n: R.hints })}</b></li>`,
      `<li>${t('Next word, when stuck')} <b>${t('{n} free, the next ends the round', { n: (R.maxSkips ?? 5) - 1 })}</b></li>`,
    ].join('');
  }

  // ───────────────────────── game ─────────────────────────
  function startGame(m) {
    mount('game', 'game');
    S.clockSkew = m.serverNow - Date.now();
    const meP = m.players.find(p => p.me) || {};
    S.game = { current: m.startWord, draft: [...m.startWord], changed: null, focus: 0, locked: false, seq: 0, streak: meP.streak || 0,
      jackpots: { found: meP.jackpotsFound || 0, total: meP.jackpotsTotal || 0 }, chain: [{ word: m.startWord, valid: true }],
      skipsLeft: meP.skipsLeft ?? (m.rules?.maxSkips || 5),
      hintsLeft: meP.hintsLeft ?? m.rules?.hints ?? 3, hintSlot: null,
      duo: m.mode === 'duo', myTurn: m.mode !== 'duo' || !!m.myTurn, turnCode: m.turnCode, turnEndsAt: m.turnEndsAt || 0, turnSeconds: m.turnSeconds || 30 };
    if (S.game.duo && m.current && m.current !== m.startWord) { S.game.current = m.current; S.game.draft = [...m.current]; S.game.chain.push({ word: m.current, valid: true }); }
    $('[data-drums]').style.setProperty('--n', m.startWord.length);
    renderDrums(); renderChain(); renderOpponent(); renderJackpots(); renderStreak(); renderSkips(); renderHints(); renderTurn(); tickClock();
    S.clockTimer = setInterval(tickClock, 250);
    say(m.mode !== 'duo' ? t('Roll one letter to make a new word.')
      : S.game.myTurn ? t('You go first. Roll one letter to make a new word.')
      : t('Player {p} goes first. Your drums unlock on your turn.', { p: m.turnCode }), 'info');
    app.onclick = e => {
      const btn = e.target.closest('[data-action]'); if (!btn) return;
      const a = btn.dataset.action;
      if (a === 'process') processWord();
      if (a === 'skip') skipWord();
      if (a === 'hint') useHint();
      if (a === 'reset') resetDraft();
      if (a === 'roll') roll(Number(btn.dataset.slot), Number(btn.dataset.dir));
      if (a === 'quit' && confirm(t('End this round now? Your score so far is saved.'))) {
        if (S.match.local) Local.finish(S.match, 'ended'); else api('POST', '/api/match/quit').catch(() => {});
      }
    };
    bindDrumGestures();
  }

  function tickClock() {
    const el = $('[data-clock]'); if (!el || !S.match) return;
    const left = Math.max(0, Math.ceil((S.match.endsAt - (Date.now() + S.clockSkew)) / 1000));
    el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    el.classList.toggle('low', left <= 15);
    const g = S.game;
    if (g?.duo && g.turnEndsAt) {
      const ms = Math.max(0, g.turnEndsAt - (Date.now() + S.clockSkew));
      const t = $('[data-turn-time]'); if (t) t.textContent = `${Math.ceil(ms / 1000)}s`;
      const bar = $('[data-turn-bar]'); if (bar) bar.style.width = `${Math.min(100, ms / (g.turnSeconds * 10))}%`;
      $('[data-turn]')?.classList.toggle('low', g.myTurn && ms <= 5000);
    }
  }

  // Two-player games take turns: the drums only move on your turn.
  const blocked = g => !g || g.locked || (g.duo && !g.myTurn);
  function renderTurn() {
    const g = S.game, box = $('[data-turn]'); if (!box || !g) return;
    box.hidden = !g.duo;
    if (!g.duo) return;
    box.classList.toggle('mine', g.myTurn);
    $('[data-turn-who]').textContent = g.myTurn ? t('Your turn') : t("Player {p}'s turn", { p: g.turnCode });
  }
  // The server says whose turn it is now, and what the last move was.
  function onBoard(d) {
    const g = S.game; if (!g || !g.duo) return;
    if (typeof d.serverNow === 'number') S.clockSkew = d.serverNow - Date.now();
    const was = g.myTurn;
    g.myTurn = !!d.myTurn; g.turnCode = d.turnCode; g.turnEndsAt = d.turnEndsAt;
    const last = d.last || {};
    const theirs = last.by && String(last.by) !== String(S.player?.code);
    if (theirs && (last.outcome === 'valid' || last.outcome === 'invalid')) g.chain.push({ word: last.word, valid: last.outcome === 'valid', theirs: true });
    if (theirs && last.fresh) g.chain.push({ word: last.fresh, valid: true, fresh: true });
    if (d.current && d.current !== g.current) { g.current = d.current; g.draft = [...d.current]; g.changed = null; g.hintSlot = null; }
    if (!g.myTurn && g.changed !== null) { g.draft = [...g.current]; g.changed = null; } // an unfinished move is put back
    if (d.jackpotsTotal !== undefined) { const bump = d.jackpotsFound !== g.jackpots.found; g.jackpots = { found: d.jackpotsFound, total: d.jackpotsTotal }; renderJackpots(bump); }
    if (theirs) {
      const W = (last.word || '').toUpperCase();
      const msg = last.outcome === 'valid' ? t('Player {p} made {w} (+{n}).', { p: last.by, w: W, n: last.points || 0 })
        : last.outcome === 'invalid' ? t('Player {p} tried {w}: not a word.', { p: last.by, w: W })
        : last.outcome === 'skip' ? t('Player {p} took a new word.', { p: last.by })
        : last.outcome === 'timeout' ? t('Player {p} ran out of time.', { p: last.by }) : '';
      say(`${msg} ${t('Your turn!')}`.trim(), 'good');
      renderParts([]); $('[data-drums]')?.classList.remove('good', 'bad');
      if (navigator.vibrate) navigator.vibrate(60);
    } else if (last.outcome === 'timeout' && was) {
      say(t("Time's up for that turn. Player {p}'s go.", { p: g.turnCode }), 'bad');
    }
    if (S.screen === 'game') { renderDrums(); renderChain(); renderHints(); renderSkips(); renderTurn(); }
  }

  function renderDrums(animSlot = null, dir = 0) {
    const g = S.game, wrap = $('[data-drums]');
    wrap.innerHTML = g.draft.map((ch, i) => {
      const AB = abc(), n = AB.length, k = AB.indexOf(ch);
      const at = d => AB[(k + d + n * 2) % n];
      const held = g.changed !== null && g.changed !== i;  // one letter per move: the others are locked
      const cls = ['drum', g.changed === i ? 'changed' : '', held ? 'held' : '', g.focus === i ? 'focus' : '', g.hintSlot === i ? 'hinted' : ''].join(' ');
      return `<div class="${cls}" data-slot="${i}">
        <button class="nudge" data-action="roll" data-slot="${i}" data-dir="-1" tabindex="-1" aria-label="Letter ${i + 1}: previous letter">▲</button>
        <div class="face" role="spinbutton" tabindex="${g.focus === i ? 0 : -1}" aria-label="Letter ${i + 1}" aria-valuetext="${ch.toUpperCase()}">
          <div class="reel"><span class="dim">${at(-2)}</span><span class="dim">${at(-1)}</span><span>${ch}</span><span class="dim">${at(1)}</span><span class="dim">${at(2)}</span></div>
        </div>
        <button class="nudge" data-action="roll" data-slot="${i}" data-dir="1" tabindex="-1" aria-label="Letter ${i + 1}: next letter">▼</button>
      </div>`;
    }).join('');
    const reel = animSlot !== null && dir ? $$('.reel', wrap)[animSlot] : null;
    if (reel && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Start the reel one letter back, then let CSS slide it into place.
      reel.style.transition = 'none';
      reel.style.transform = `translateY(calc(-50% + ${dir * 20}%))`;
      reel.getBoundingClientRect();
      reel.style.transition = '';
      reel.style.transform = '';
    }
    const waiting = g.duo && !g.myTurn;
    wrap.classList.toggle('locked', g.locked);
    wrap.classList.toggle('waiting', waiting);
    wrap.setAttribute('aria-disabled', String(blocked(g)));
    $('[data-action=process]').disabled = blocked(g) || g.changed === null;
    const undo = $('[data-action=reset]'); if (undo) undo.disabled = blocked(g) || g.changed === null;
  }

  function roll(slot, dir) {
    const g = S.game; if (!g) return;
    if (g.duo && !g.myTurn) { say(t("Wait for your turn. It's Player {p}'s go.", { p: g.turnCode }), 'info'); return; }
    if (g.locked) return;
    if (!oneLetter(slot)) return;
    const AB = abc(), k = AB.indexOf(g.draft[slot]);
    g.draft[slot] = AB[(k + dir + AB.length * 2) % AB.length];
    g.changed = g.draft[slot] === g.current[slot] ? null : slot;
    g.focus = slot;
    g.hintSlot = null;
    $('[data-drums]').classList.remove('good', 'bad');
    renderDrums(slot, dir);
    const f = $(`.drum[data-slot="${slot}"] .face`); if (f && document.activeElement?.closest?.('.drums')) f.focus();
  }

  // One letter per move: once a letter is changed, the other drums stay locked
  // until it is rolled back or Undo is tapped.
  function oneLetter(slot) {
    const g = S.game;
    if (g.changed === null || g.changed === slot) return true;
    say(t('One letter per move. Roll letter {n} back, or tap Undo.', { n: g.changed + 1 }), 'bad');
    const d = $(`.drum[data-slot="${g.changed}"]`); if (d) replay(d, 'nag');
    if (navigator.vibrate) navigator.vibrate(30);
    return false;
  }

  function resetDraft() {
    const g = S.game; if (blocked(g)) return;
    g.draft = [...g.current]; g.changed = null; renderDrums();
  }

  async function processWord() {
    const g = S.game; if (blocked(g) || g.changed === null) return;
    g.locked = true; g.hintSlot = null; renderDrums();
    say(t('Checking…'), 'info');
    const word = g.draft.join('');
    try {
      const r = S.match.local ? Local.submit(S.match, word) : await api('POST', '/api/match/submit', { word, seq: ++g.seq });
      if (r.error) { if (r.notYourTurn) { g.myTurn = false; g.draft = [...g.current]; g.changed = null; renderTurn(); } throw new Error(r.error); }
      g.current = r.current; g.draft = [...r.current]; g.changed = null;
      if (r.outcome === 'valid' || r.outcome === 'invalid') g.chain.push({ word: r.word, valid: r.outcome === 'valid' });
      if (r.fresh) g.chain.push({ word: r.fresh, valid: true, fresh: true });
      const scoreEl = $('[data-myscore]');
      if (String(r.score) !== scoreEl.textContent) { replay(scoreEl, 'pop'); if (r.points) floatPoints(r.points, scoreEl); }
      scoreEl.textContent = r.score;
      const mine = S.match.players.find(p => p.me); if (mine) mine.score = r.score;
      const passes = g.duo && (r.outcome === 'valid' || r.outcome === 'invalid');
      say(r.message + (passes ? '. ' + t("Player {p}'s turn.", { p: S.match.players.find(p => !p.me)?.playerCode }) : ''), r.outcome === 'valid' ? 'good' : r.outcome === 'invalid' ? 'bad' : 'info');
      renderParts(r.parts);
      const drums = $('[data-drums]');
      drums.classList.remove('good', 'bad');
      if (typeof r.streak === 'number') g.streak = r.streak;
      if (r.jackpotsTotal !== undefined) {
        const before = g.jackpots.found;
        g.jackpots = { found: r.jackpotsFound, total: r.jackpotsTotal };
        renderJackpots(r.jackpot && r.jackpotsFound !== before);
      }
      if (r.outcome === 'valid') {
        drums.classList.add('good');
        const bonus = (r.parts || []).some(p => p.kind === 'hot' || p.kind === 'streak');
        if (r.jackpot) bigScore('JACKPOT!', `+${r.points}`);
        else if (r.points >= 4) bigScore('BIG SCORE!', `+${r.points}`);
        else { confetti(drums); if (bonus) starRun(3); }
      }
      if (r.outcome === 'invalid') replay(drums, 'bad');
      renderStreak();
      if (r.outcome === 'valid' && navigator.vibrate) navigator.vibrate(30);
      if (r.outcome === 'invalid' && navigator.vibrate) navigator.vibrate([40, 60, 40]);
    } catch (e) {
      say(e.message, 'bad');
    } finally {
      g.locked = false;
      if (S.screen === 'game') { renderDrums(); renderChain(); renderHints(); }
    }
  }


  // Hint: lights up the letter worth rolling (Learner: unlimited, Intermediate: 3, Advanced: none).
  function renderHints() {
    const btn = $('[data-action=hint]'); if (!btn || !S.game) return;
    const left = S.game.hintsLeft;
    btn.hidden = left === 0 && (S.match?.rules?.hints === 0);
    $('[data-hints-left]').textContent = left < 0 ? '' : t('{n} left', { n: left });
    btn.disabled = left === 0 || blocked(S.game);
  }
  async function useHint() {
    const g = S.game; if (blocked(g) || g.hintsLeft === 0) return;
    try {
      const r = S.match.local ? Local.hint(S.match) : await api('POST', '/api/match/hint');
      if (r.error) throw new Error(r.error);
      if (typeof r.hintsLeft === 'number') g.hintsLeft = r.hintsLeft;
      g.hintSlot = r.slot; g.focus = r.slot;
      say(r.message, 'info');
      renderDrums(); renderHints();
    } catch (e) { say(e.message, 'bad'); }
  }

  // "Next word": a fresh word when this one is too hard. The last skip ends the round.
  function renderSkips() {
    const btn = $('[data-action=skip]'); if (!btn || !S.game) return;
    const left = S.game.skipsLeft;
    const free = Math.max(0, left - 1);
    $('[data-skips-left]').textContent = left <= 1 ? t('ends the round') : t('{n} free', { n: free });
    btn.classList.toggle('last', left <= 1);
    btn.disabled = left <= 0 || blocked(S.game);
  }
  async function skipWord() {
    const g = S.game; if (blocked(g) || g.skipsLeft <= 0) return;
    if (g.skipsLeft <= 1 && !confirm(t('This is your last skip. Using it ends the round now. Go ahead?'))) return;
    g.locked = true; renderDrums(); renderSkips();
    try {
      const r = S.match.local ? Local.skip(S.match) : await api('POST', '/api/match/skip');
      if (r.error) throw new Error(r.error);
      g.skipsLeft = r.skipsLeft; g.streak = r.streak;
      renderParts([]); renderStreak();
      if (r.ended) {
        say(r.message, 'info');
        if (S.match.local) Local.finish(S.match, 'skips'); // live: the server ends the round
        return;
      }
      g.current = r.current; g.draft = [...r.current]; g.changed = null; g.hintSlot = null;
      g.chain.push({ word: r.fresh, valid: true, fresh: true });
      g.jackpots = { found: r.jackpotsFound, total: r.jackpotsTotal };
      renderJackpots(true);
      say(r.message, 'info');
      starRun(2);
    } catch (e) {
      say(e.message, 'bad');
    } finally {
      g.locked = false;
      if (S.screen === 'game') { renderDrums(); renderChain(); renderSkips(); }
    }
  }

  function replay(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  const pts = n => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
  function renderParts(parts) {
    const ul = $('[data-parts]'); if (!ul) return;
    ul.innerHTML = (parts || []).map(p => `<li class="${p.kind ? 'k-' + p.kind : p.points < 0 ? 'k-miss' : ''}">${esc(p.label)} ${pts(p.points)}</li>`).join('');
  }
  function renderJackpots(bump) {
    const el = $('[data-jackpots]'); if (!el || !S.game) return;
    const { found, total } = S.game.jackpots;
    el.hidden = !total;
    el.textContent = found >= total && total ? t('★ All {n} jackpots!', { n: total }) : t('★ Jackpots {f}/{n}', { f: found, n: total });
    el.title = t('Hidden jackpot words found: {f} of {n}', { f: found, n: total });
    if (bump) replay(el, 'bump');
  }

  // ── Celebrations (a separate layer that never blocks taps) ──
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function fxAdd(el, ms) { $('#fx').appendChild(el); setTimeout(() => el.remove(), ms); }
  function starRun(n = 4) {
    if (reducedMotion()) return;
    for (let i = 0; i < n; i++) {
      const s = document.createElement('div');
      s.className = 'star' + (i % 2 ? ' rtl' : '');
      s.style.top = `${8 + Math.random() * 62}%`;
      s.style.setProperty('--c', CANDY[(i + 2) % 5]);
      s.style.setProperty('--size', `${20 + Math.random() * 22}px`);
      s.style.setProperty('--dur', `${1.1 + Math.random() * 0.9}s`);
      s.style.animationDelay = `${i * 140}ms`;
      s.innerHTML = '<i></i>';
      fxAdd(s, 3200);
    }
  }
  function balloons(n = 14) {
    if (reducedMotion()) return;
    for (let i = 0; i < n; i++) {
      const b = document.createElement('div');
      b.className = 'balloon';
      b.style.setProperty('--x', `${Math.round((i / n) * 92 + Math.random() * 6)}%`);
      b.style.setProperty('--c', CANDY[i % 5]);
      b.style.setProperty('--bw', `${46 + Math.random() * 26}px`);
      b.style.setProperty('--dur', `${3.2 + Math.random() * 1.8}s`);
      b.style.animationDelay = `${Math.random() * 500}ms`;
      b.innerHTML = '<i></i>';
      fxAdd(b, 6000);
    }
  }
  function bigScore(title, sub) {
    const b = document.createElement('div');
    b.className = 'bigscore';
    b.innerHTML = `<b>${esc(title)}</b><span>${esc(sub)}</span>`;
    fxAdd(b, 2700);
    balloons(); starRun(8);
    const drums = $('[data-drums]'); if (drums) confetti(drums);
    if (navigator.vibrate) navigator.vibrate([60, 40, 60, 40, 120]);
  }
  function floatPoints(points, near) {
    const r = near.getBoundingClientRect();
    const f = document.createElement('div');
    f.className = 'float-pts' + (points < 0 ? ' minus' : '');
    f.textContent = pts(points);
    f.style.left = `${r.left + r.width + 6}px`;
    f.style.top = `${r.top}px`;
    fxAdd(f, 1200);
  }

  function renderStreak() {
    const el = $('[data-streak]'); if (!el || !S.game) return;
    const n = S.game.streak;
    el.hidden = n < 2;
    if (n >= 2) { el.textContent = t('🔥 {n} in a row', { n }); el.title = n >= 5 ? t('Unstoppable!') : ''; replay(el, 'bump'); }
  }
  const CANDY = ['#ff8b3d', '#ff5fa8', '#45c8f5', '#a8e44a', '#ffd23f', '#fff7ec'];
  function confetti(host) {
    if (!host || !host.parentElement) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const box = document.createElement('div'); box.className = 'confetti';
    for (let i = 0; i < 22; i++) {
      const p = document.createElement('i');
      const ang = (Math.PI * 2 * i) / 22 + Math.random() * 0.4;
      const dist = 70 + Math.random() * 90;
      p.style.background = CANDY[i % CANDY.length];
      p.style.setProperty('--dx', `${Math.cos(ang) * dist * 1.6}px`);
      p.style.setProperty('--dy', `${Math.sin(ang) * dist - 40}px`);
      p.style.setProperty('--rot', `${Math.round(Math.random() * 720 - 360)}deg`);
      p.style.animationDelay = `${Math.random() * 60}ms`;
      box.appendChild(p);
    }
    // Attach beside the drums (they are redrawn after every move) at their centre.
    box.style.top = `${host.offsetTop + host.offsetHeight / 2}px`;
    host.parentElement.appendChild(box);
    setTimeout(() => box.remove(), 1100);
  }

  function say(text, kind) { const v = $('[data-verdict]'); if (v) { v.textContent = text; v.className = `verdict ${kind}`; } }
  function renderChain() {
    const ol = $('[data-chain]'); if (!ol) return;
    const n = S.game.chain.filter(c => !c.fresh).length - 1;   // words played, not counting the start word
    const count = $('[data-chain-count]'); if (count) count.textContent = n > 0 ? `(${n})` : '';
    ol.innerHTML = S.game.chain.map(c => `<li class="${c.valid ? '' : 'bad'}${c.fresh ? ' fresh' : ''}${c.theirs ? ' theirs' : ''}">${esc(c.word)}</li>`).join('');
  }
  function renderOpponent() {
    const opp = S.match?.players.find(p => !p.me);
    const box = $('[data-opp]'); if (!box) return;
    box.hidden = !opp;
    if (opp) {
      $('[data-oppcode]').textContent = t('Player {p}', { p: opp.playerCode }) + (opp.online === false ? ` (${t('offline')})` : '');
      const os = $('[data-oppscore]');
      if (os.textContent !== String(opp.score)) { if (os.textContent !== '') replay(os, 'pop'); os.textContent = opp.score; }
    }
  }

  function bindDrumGestures() {
    const wrap = $('[data-drums]');
    let drag = null;
    wrap.addEventListener('pointerdown', e => {
      const drum = e.target.closest('.face')?.parentElement; if (!drum) return;
      drag = { slot: Number(drum.dataset.slot), y: e.clientY, step: drum.querySelector('.face').offsetWidth * 0.8 };
      if (S.game && S.game.focus !== drag.slot) { // tapping a drum selects it for keyboard typing
        S.game.focus = drag.slot;
        $$('.drum', wrap).forEach((d, i) => d.classList.toggle('focus', i === drag.slot));
      }
      wrap.setPointerCapture(e.pointerId);
    });
    wrap.addEventListener('pointermove', e => {
      if (!drag) return;
      const d = e.clientY - drag.y;
      if (Math.abs(d) >= drag.step * 0.6) { roll(drag.slot, d < 0 ? 1 : -1); drag.y = e.clientY; }
    });
    const end = () => { drag = null; };
    wrap.addEventListener('pointerup', end); wrap.addEventListener('pointercancel', end);
    wrap.addEventListener('wheel', e => {
      const drum = e.target.closest('.drum'); if (!drum) return;
      e.preventDefault();
      roll(Number(drum.dataset.slot), e.deltaY > 0 ? 1 : -1);
    }, { passive: false });
  }

  document.addEventListener('keydown', e => {
    if (S.screen !== 'game' || !S.game || e.target.closest?.('input, dialog')) return;
    const g = S.game, n = g.draft.length;
    const keys = {
      ArrowLeft: () => { g.focus = (g.focus + n - 1) % n; renderDrums(); },
      ArrowRight: () => { g.focus = (g.focus + 1) % n; renderDrums(); },
      ArrowUp: () => roll(g.focus, -1),
      ArrowDown: () => roll(g.focus, 1),
      Enter: () => processWord(),
      Escape: () => resetDraft(),
    };
    if (/^\p{L}$/u.test(e.key) && !e.ctrlKey && !e.metaKey) {
      // Typing a letter sets the focused drum directly.
      e.preventDefault();
      if (blocked(g)) { if (g.duo && !g.myTurn) say(t("Wait for your turn. It's Player {p}'s go.", { p: g.turnCode }), 'info'); return; }
      const want = e.key.toLowerCase();
      const cur = g.draft[g.focus];
      if (!abc().includes(want)) return;
      const dir = (abc().indexOf(want) - abc().indexOf(cur) + abc().length) % abc().length;
      if (dir && oneLetter(g.focus)) { g.draft[g.focus] = want; g.changed = want === g.current[g.focus] ? null : g.focus; renderDrums(g.focus, 1); }
      return;
    }
    if (keys[e.key]) { e.preventDefault(); keys[e.key](); }
  });

  // ───────────────────────── results ─────────────────────────
  function recordLine(c) {
    const d = c.delta;
    const move = d > 0 ? `<b class="up">+${d}</b>` : d < 0 ? `<b class="down">−${Math.abs(d)}</b>` : '';
    return `<div class="record-after">
      <span>${t('Rating')} <b>${num(c.rating)}</b> ${move}</span>
      <span>${t('Total points')} <b>${num(c.points)}</b></span>
      <span>${esc(t(c.rank))}</span>
      ${c.par != null ? `<small>${t('Par for this game: {n} points', { n: c.par })}</small>` : ''}
    </div>`;
  }
  function showResults(d) {
    const m = d.match;
    S.match = null; S.game = null;
    mount('results', 'results');
    const me = m.players.find(p => p.me), opp = m.players.find(p => !p.me);
    const title = !opp ? t('You scored {n}', { n: me.score })
      : me.score > opp.score ? t('You won, {a} to {b}', { a: me.score, b: opp.score })
      : me.score < opp.score ? t('Player {p} won, {a} to {b}', { p: opp.playerCode, a: opp.score, b: me.score })
      : t('A draw at {n}', { n: me.score });
    const why = d.reason === 'opponent-left' ? t('The other player disconnected.')
      : d.reason === 'skips' ? (opp && d.endedBy !== S.player?.code ? t('Player {p} used the last skip.', { p: d.endedBy }) : t('You used your last skip.'))
      : d.reason === 'ended' && opp ? (d.endedBy === S.player?.code ? t('You ended the round.') : t('Player {p} ended the round.', { p: d.endedBy })) : '';
    $('[data-title]').textContent = title + (why ? '. ' + why : '');
    const mine = d.topTen.find(t => t.finishedAt && Math.abs(t.finishedAt - Date.now()) < 10_000);
    $('[data-final]').innerHTML = `
      <div class="row ${opp && me.score > opp.score ? 'win' : ''}"><span>${t('You')}</span><b>${me.score}</b></div>
      ${opp ? `<div class="row ${opp.score > me.score ? 'win' : ''}"><span>${t('Player {p}', { p: esc(opp.playerCode) })}</span><b>${opp.score}</b></div>` : ''}
      ${mine?.chain?.length > 1 ? `<p class="words">${mine.chain.map(esc).join(' › ')}</p>` : ''}
      ${d.record ? recordLine(d.record) : ''}`;
    if (d.record) S.record = null;   // home fetches the fresh one
    $('[data-boards]').innerHTML = boardHtml(t('Your top 10, {n} letters, {i}', { n: m.level, i: ilabel(m.intensity) }), d.topTen.map(x => ({ name: fmtDate(x.finishedAt), score: x.score, mine: x === mine })), t('No games saved yet.'))
      + (d.local ? '' : boardHtml(t('All-time, {n} letters, {i}', { n: m.level, i: ilabel(m.intensity) }), d.board.map(b => ({ name: t('Player {p}', { p: b.playerCode }), score: b.score, mine: b.playerCode === S.player?.code })), t('No games yet.')));
    app.onclick = e => {
      const a = e.target.closest('[data-action]')?.dataset.action;
      if (a === 'home') showHome();
      if (a === 'again') { if (m.mode === 'duo') showHome(); else guard(() => startSolo(m.level)); }
    };
  }

  // ───────────────────────── boot ─────────────────────────
  function signedOut() { // Sign out button: end the session but keep the Player ID for next time
    S.token = null; S.player = null; S.record = null; saved('vistr.token', null); saved('vistr.signedOut', '1');
    try { sessionStorage.removeItem('vistr.token'); } catch (_) {}
    goStandalone();
  }
  function forgetPlayer() { // the player deleted their ID: nothing about it stays on this device
    S.token = null; S.player = null; S.record = null;
    ['vistr.token', 'vistr.lastId', 'vistr.signedOut'].forEach(k => saved(k, null));
    try { sessionStorage.removeItem('vistr.token'); } catch (_) {}
    goStandalone();
  }
  async function sessionEnded() { // the server no longer knows this sign-in: try the ID, else ask
    S.token = null; S.player = null; saved('vistr.token', null);
    try { sessionStorage.removeItem('vistr.token'); } catch (_) {}
    S.events?.close(); S.events = null;
    if (await signInWithKnownId()) { showHome(); toast(t("You're online as Player {p}.", { p: S.player.code })); }
    else showSignIn();
  }

  // Live but the server can't be reached (offline, PC switched off): play standalone
  // instead of getting stuck. Live stays the saved choice, so it reconnects next time.
  function offlineFallback(why) {
    S.mode = 'standalone';
    S.events?.close(); S.events = null;
    showHome();
    toast(why || t("Can't reach the game server, so you're offline. Tap Go online when you're connected."));
  }

  // ───────────────────────── games played ─────────────────────────
  // The server counts online games itself. Offline games are counted on the phone and
  // reported the next time the server can be reached.
  const Plays = {
    pending() { return Number(saved('vistr.unsentPlays')) || 0; },
    add() { saved('vistr.unsentPlays', String(this.pending() + 1)); this.flush(); },
    sending: false,
    async flush() {
      const n = this.pending();
      if (!n || this.sending || !S.server && location.protocol === 'file:') return;
      this.sending = true;
      try {
        const r = await fetch(S.server.replace(/\/$/, '') + '/api/played', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: Math.min(n, 200) }), signal: timeoutSignal(8000),
        });
        if (r.ok) {
          saved('vistr.unsentPlays', String(Math.max(0, this.pending() - Math.min(n, 200))));
          const d = await r.json().catch(() => null);
          if (d?.total) saved('vistr.playsTotal', String(d.total));
        }
      } catch (_) {} finally { this.sending = false; }
    },
    async show() {
      const el = $('[data-plays]'); if (!el) return;
      const draw = (total, today) => {
        if (!total) return;
        el.hidden = false;
        const b = n => `<b>${Number(n).toLocaleString(S.lang)}</b>`;
        el.innerHTML = t(Number(total) === 1 ? '{n} game played' : '{n} games played', { n: b(total) }) + (today ? ' · ' + t('{n} today', { n: b(today) }) : '');
      };
      draw(Number(saved('vistr.playsTotal')) + this.pending());          // last known, straight away
      await this.flush();
      try {
        const r = await fetch(S.server.replace(/\/$/, '') + '/api/stats', { signal: timeoutSignal(6000) });
        const d = await r.json();
        if (r.ok && $('[data-plays]') === el) { saved('vistr.playsTotal', String(d.total)); draw(d.total + this.pending(), d.today); }
      } catch (_) {}
    },
  };

  // ───────────────────────── contact form ─────────────────────────
  // The form comes from contact.html; your email address is never in the app.
  const Contact = {
    bind(root) {
      const f = $('form[data-contact]', root); if (!f) return;
      if (S.player?.email) f.email.value = S.player.email;
      f.addEventListener('submit', async e => {
        e.preventDefault();
        const status = $('[data-status]', f), btn = $('.send', f);
        const data = Object.fromEntries(new FormData(f));
        data.app = `${isNative ? 'Android app' : 'web app'}${S.player ? `, player ${S.player.code}` : ''}`;
        status.textContent = t('Sending…'); status.className = 'form-status'; btn.disabled = true;
        try {
          const r = await fetch(S.server.replace(/\/$/, '') + '/api/contact', {
            method: 'POST', signal: timeoutSignal(15000),
            headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: `Bearer ${S.token}` } : {}) },
            body: JSON.stringify(data),
          }).catch(() => { throw new Error(t("Can't reach the game server. Check your internet connection and try again.")); });
          const out = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(out.error ? tr(out.error) : t('Could not send. Try again.'));
          f.message.value = '';
          status.textContent = t("Thanks! Your message is on its way. We'll reply by email."); status.className = 'form-status ok';
        } catch (err) { status.textContent = err.message; status.className = 'form-status bad'; }
        btn.disabled = false;
      });
    },
  };

  // ───────────────────────── reviews ─────────────────────────
  const Reviews = {
    picked: 0,
    stars: n => '★'.repeat(n) + '☆'.repeat(5 - n),
    async render(body) {
      let d;
      try {
        const r = await fetch(S.server.replace(/\/$/, '') + '/api/reviews', {
          signal: timeoutSignal(15000), headers: S.token ? { Authorization: `Bearer ${S.token}` } : {},
        });
        d = await r.json(); if (!r.ok) throw new Error();
      } catch (_) {
        body.innerHTML = `<p>${t("Reviews need the game server, and it can't be reached right now. Check your internet connection and try again.")}</p>`;
        return;
      }
      const max = Math.max(1, ...d.counts);
      const mine = d.mine;
      this.picked = mine?.stars || 0;
      const canWrite = S.mode === 'live' && S.token;
      body.innerHTML = `
        <div class="rv-summary">
          <div><b>${d.count ? d.average.toFixed(1) : '–'}</b><span class="rv-stars">${this.stars(Math.round(d.average))}</span>
          <span class="meta">${t(d.count === 1 ? '1 review' : '{n} reviews', { n: d.count })}</span></div>
          <ol class="rv-bars" aria-label="${t('Ratings')}">${[5, 4, 3, 2, 1].map(n => `<li><span>${n}★</span><i><i style="width:${Math.round(d.counts[n - 1] / max * 100)}%"></i></i><small>${d.counts[n - 1]}</small></li>`).join('')}</ol>
        </div>
        <section class="rv-write">
          ${canWrite ? `
            <h2>${t(mine ? 'Your review' : 'Rate Vistr')}</h2>
            ${mine?.status === 'held' ? `<p class="meta">${t('Your review is waiting for approval.')}</p>` : ''}
            <form data-review>
              <div class="rv-pick" role="radiogroup" aria-label="${t('Stars')}">${[1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" data-star="${n}" aria-label="${t(n > 1 ? '{n} stars' : '1 star', { n })}">★</button>`).join('')}</div>
              <textarea name="text" rows="3" maxlength="500" placeholder="${esc(t('What do you like? What could be better? (optional)'))}">${esc(mine?.text || '')}</textarea>
              <p class="form-status" data-status role="status"></p>
              <button type="submit" class="btn primary">${t(mine ? 'Update my review' : 'Post review')}</button>
            </form>` : `
            <p>${t('Played Vistr? Go online to rate it and write a review.')}</p>
            <button type="button" class="btn" data-go-review>${t('Go online')}</button>`}
        </section>
        <h2>${t('What players say')}</h2>
        <ul class="rv-list">${d.reviews.map(r => `<li><span class="rv-stars">${this.stars(r.stars)}</span> <b>${t('Player {p}', { p: esc(r.playerCode) })}</b>
          <small>${new Date(r.updatedAt).toLocaleDateString(S.lang)}</small>${r.text ? `<p>${esc(r.text)}</p>` : ''}</li>`).join('') || `<li class="meta">${t('No reviews yet. Be the first!')}</li>`}</ul>`;
      const pick = n => { this.picked = n; $$('[data-star]', body).forEach(b => { const on = Number(b.dataset.star) <= n; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(Number(b.dataset.star) === n)); }); };
      pick(this.picked);
      $('.rv-pick', body)?.addEventListener('click', e => { const b = e.target.closest('[data-star]'); if (b) pick(Number(b.dataset.star)); });
      $('[data-go-review]', body)?.addEventListener('click', () => { $('#reader').close(); goLive(); });
      $('form[data-review]', body)?.addEventListener('submit', async e => {
        e.preventDefault();
        const f = e.target, status = $('[data-status]', f);
        if (!this.picked) { status.textContent = t('Tap the stars to rate first.'); status.className = 'form-status bad'; return; }
        try {
          const r = await api('POST', '/api/reviews', { stars: this.picked, text: f.text.value });
          toast(t(r.held ? 'Thanks! Your review will appear once it is approved.' : 'Thanks for your review!'));
          this.render(body);
        } catch (err) { status.textContent = err.message; status.className = 'form-status bad'; }
      });
    },
  };

  // ───────────────────────── menu ─────────────────────────
  // About, How to play, Privacy and Terms are plain pages (also published on the
  // server for Google Play); the menu shows them inside the app, so they work offline.
  const Menu = {
    titles: { about: 'About Vistr', 'how-to': 'How to play', privacy: 'Privacy & policies', terms: 'Terms & conditions', contact: 'Contact us', reviews: 'Reviews' },
    open() {
      const m = $('#menu');
      renderLangPicker();
      $('[data-ad-privacy]', m).hidden = !NativeAds.privacyChoices;
      if (!m.open) m.showModal();
    },
    async page(name) {
      const r = $('#reader'), body = $('[data-reader-body]', r);
      $('[data-reader-title]', r).textContent = t(this.titles[name] || '');
      body.innerHTML = `<p class="hint">${t('Loading…')}</p>`;
      if (!r.open) r.show();            // not modal: the top bar stays usable above it
      r.dataset.page = name;
      if (name === 'reviews') return Reviews.render(body);
      try {
        // About and How to play exist in every language; the others are shared pages.
        const own = (name === 'about' || name === 'how-to') && S.lang !== 'en' ? `${name}.${S.lang}.html` : null;
        const get = f => fetch(f).then(x => { if (!x.ok) throw new Error(); return x.text(); });
        const html = own ? await get(own).catch(() => get(`${name}.html`)) : await get(`${name}.html`);
        const main = new DOMParser().parseFromString(html, 'text/html').querySelector('main');
        main.querySelector('.page-nav')?.remove();
        main.querySelector('h1')?.remove();          // the reader shows the title in its header
        body.innerHTML = main.innerHTML;
        translateDom(body);
        if ((name === 'privacy' || name === 'terms') && S.lang !== 'en') body.insertAdjacentHTML('afterbegin', `<p class="note">${t('This page is in English, and the English version applies.')}</p>`);
        if (name === 'contact') Contact.bind(body);
      } catch (_) {
        body.innerHTML = `<p>${t('This page could not be opened. Check your connection and try again.')}</p>`;
      }
      body.scrollTop = 0;
    },
    async adPrivacy() {
      try { await NativeAds.plugin()?.showPrivacyOptionsForm(); }
      catch (_) { toast(t('Ad privacy choices are not available right now.')); }
    },
  };
  (() => {
    const menu = $('#menu'), reader = $('#reader');
    menu.addEventListener('click', e => { if (e.target === menu) menu.close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && reader.open && !menu.open) reader.close(); });
    // The top bar, on every screen
    $('#appbar').addEventListener('click', e => {
      const a = e.target.closest('[data-bar]')?.dataset.bar; if (!a) return;
      if (a === 'menu') return Menu.open();
      const busy = S.screen === 'game' || S.screen === 'ready';
      if (a === 'home') { reader.close(); if (!busy && S.screen !== 'home' && S.screen !== 'signin') showHome(); return; }
      if (a === 'toggle-net') {
        if (busy) return toast(t('Finish or end this round first.'));
        reader.close();
        if (S.mode === 'live') { goStandalone(); toast(t("You're offline. Solo games only.")); } else goLive();
      }
    });
    menu.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) return menu.close();
      const page = e.target.closest('[data-page]')?.dataset.page;
      if (page) { menu.close(); Menu.page(page); }
      if (e.target.closest('[data-ad-privacy]')) { menu.close(); Menu.adPrivacy(); }
    });
    reader.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) return reader.close();
      if (e.target.closest('[data-back]')) { reader.close(); return Menu.open(); }
      const a = e.target.closest('a[href]'); if (!a) return;
      const href = a.getAttribute('href');
      const own = href.match(/^([\w-]+)\.html$/);
      if (own) { e.preventDefault(); return Menu.page(own[1]); }   // links between the pages stay in the reader
      if (isNative && /^https?:/.test(href)) { e.preventDefault(); location.href = href; } // opens the phone's browser
    });
  })();

  // ───────────────────────── language ─────────────────────────
  // A round in progress keeps its language; a solo round that hasn't started is simply dropped.
  const langLocked = () => S.screen === 'game' || (S.screen === 'ready' && S.match?.mode === 'duo');
  function renderLangPicker() {
    $$('[data-lang]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.lang === S.lang)));
    const note = $('[data-lang-note]');
    if (note) { note.textContent = t('Finish or end this round first.'); note.hidden = !langLocked(); }
    $('.lang-chips')?.classList.toggle('locked', langLocked());
  }
  async function setLang(l) {
    if (!E.LANGS[l] || l === S.lang) return;
    if (langLocked()) { renderLangPicker(); replay($('[data-lang-note]'), 'show'); return; }   // shown in the menu itself
    if (S.screen === 'ready') {                       // solo, not started yet: cancel it, then switch
      try { if (!S.match?.local) await api('POST', '/api/match/quit'); } catch (_) {}
      S.match = null; S.screen = 'home';
    }
    S.lang = l; saved('vistr.lang', l);
    document.documentElement.lang = l;
    translateDom(document.body);                     // top bar, menu, dialogs
    renderLangPicker();
    setNet(S.mode === 'live' ? 'online' : 'offline');
    if ($('#reader').open) Menu.page($('#reader').dataset.page);
    if (S.screen === 'home' || S.screen === 'results') showHome();
    else if (S.screen) translateDom(app);
    if (S.mode === 'live' && S.token) { connectEvents(); checkIn(); }   // others see your new language
    toast(t('Language: {l}. Words are now in {l} too.', { l: E.LANGS[l].name }));
  }
  $('#menu').addEventListener('click', e => { const b = e.target.closest('[data-lang]'); if (b) setLang(b.dataset.lang); });

  // Back from memoryq.com with a one-time code (#mq=...): swap it for a Vistr sign-in.
  const mqCode = (location.hash.match(/[#&]mq=([A-Za-z0-9_-]{20,})/) || [])[1];
  if (mqCode) { try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {} }

  async function boot() {
    document.documentElement.lang = S.lang;
    translateDom(document.body);
    renderLangPicker();
    NativeAds.init().then(on => { if (on) Ads.showBanner(); });
    try { if (!Ads.data) Ads.load(); } catch (_) {}
    if (mqCode) {
      S.mode = 'live'; saved('vistr.mode', 'live');
      try {
        const r = await api('POST', '/api/auth/memoryq', { code: mqCode });
        signedIn(r, r.remember !== false);
        if (r.isNew) showWelcome(true);
        else { showHome(); toast(t("You're online as Player {p}.", { p: r.player.code })); }
        return;
      } catch (e) { toast(e.message); }
    }
    if (S.mode !== 'live') return showHome();
    app.innerHTML = `<section class="screen narrow"><p class="lead">${t('Connecting…')}</p></section>`;
    if (!(await reachable(S.server).catch(() => false))) {
      if (!hostedServer()) return offlineFallback();
      // Probably asleep: let them play solo now and go online by itself once it's awake.
      offlineFallback(t("Waking up the game server. Play solo meanwhile; you'll go online by yourself."));
      goLive({ background: true });
      return;
    }
    if (!S.token && !(await signInWithKnownId())) return showSignIn();
    try {
      const r = await api('GET', '/api/me');
      S.player = r.player; saved('vistr.lastId', r.player.code);
      await becomeAvailable();
      connectEvents();
      if (r.match?.status === 'playing') {
        S.match = r.match;
        startGame({ ...r.match, startWord: r.match.startWord });
        Object.assign(S.game, { current: r.me.current, draft: [...r.me.current], seq: r.me.lastSeq, streak: r.me.streak || 0, chain: [{ word: r.match.startWord, valid: true }, ...r.me.chain] });
        renderStreak();
        $('[data-myscore]').textContent = r.match.players.find(p => p.me).score;
        renderDrums(); renderChain();
      } else if (r.match?.status === 'pending') { S.match = r.match; showReady(); }
      else showHome();
    } catch (e) {
      if (!S.token) return; // signed out by 401
      offlineFallback();
    }
  }

  if ('serviceWorker' in navigator && !isNative && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  // Whatever happens at start-up, never leave a blank screen: fall back to standalone.
  boot().catch(() => { S.mode = 'standalone'; showHome(); });
})();
