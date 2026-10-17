// Vistr client — one page for PC browsers, Android (installed web app or Capacitor APK).
(() => {
  'use strict';

  const A_Z = 'abcdefghijklmnopqrstuvwxyz';
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
    token: saved('vistr.token'),
    // Standalone (default): solo games on this device, no server needed.
    // Live: signed in to the server, visible to others, two-player games.
    mode: saved('vistr.mode') === 'live' ? 'live' : 'standalone',
    player: null,
    level: [4, 5, 6, 7].includes(Number(saved('vistr.level'))) ? Number(saved('vistr.level')) : 5,
    intensity: ['learner', 'intermediate', 'advanced'].includes(saved('vistr.intensity')) ? saved('vistr.intensity') : 'learner',
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

  // ───────────────────────── API ─────────────────────────
  async function api(method, path, body) {
    const r = await fetch(S.server.replace(/\/$/, '') + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: `Bearer ${S.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && S.token) { sessionEnded(); throw new Error('Your session ended. Sign in again.'); }
    if (!r.ok && !('outcome' in data)) throw new Error(data.error || `The server answered ${r.status}.`);
    return data;
  }

  // ───────────────────────── standalone games (on this device) ─────────────────────────
  const E = window.VistrEngine;
  const Local = {
    words: {}, starts: {}, timer: null,
    async load(L) {
      if (this.words[L]) return;
      const get = f => fetch(`words/${f}`).then(r => { if (!r.ok) throw new Error('Could not load the word list.'); return r.text(); });
      const opt = f => get(f).catch(() => '');   // optional lists
      const [w, st, common, easy, blocked] = await Promise.all([get(`words_${L}.txt`), get(`start_${L}.txt`), opt(`common_${L}.txt`), opt(`easy_${L}.txt`), this.blocked ? null : opt('blocked.txt')]);
      const lines = t => t.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
      this.words[L] = new Set(lines(w));
      this.starts[L] = lines(st);
      this.common = this.common || {};
      this.common[L] = common ? new Set(lines(common)) : null;
      this.easy = this.easy || {};
      this.easy[L] = easy ? new Set(lines(easy)) : null;
      if (blocked !== null) this.blocked = new Set(lines(blocked || ''));
    },
    opts(L, intensity) { return { blocked: this.blocked, common: this.common[L], easy: this.easy[L], intensity }; },
    pools: {},
    pick(L, intensity) {
      const key = `${L}:${intensity}`;
      if (!this.pools[key]) this.pools[key] = E.poolFor(this.starts[L], this.opts(L, intensity), this.words[L]);
      return E.pickStart(this.words[L], this.pools[key], this.opts(L, intensity));
    },
    hint(m) {
      if (m.status !== 'playing') return { error: 'The round is not running.' };
      return E.hint(m.state, this.words[m.level], this.opts(m.level, m.intensity));
    },
    skip(m) {
      if (m.status !== 'playing' || Date.now() > m.endsAt) return { error: 'Time is up.' };
      return E.applySkip(m.state, () => this.pick(m.level, m.intensity));
    },
    newMatch(L, intensity) {
      return { local: true, id: 'local', level: L, intensity, mode: 'single', status: 'pending', rules: E.publicRules(undefined, intensity),
        players: [{ me: true, playerCode: 'You', ready: false, online: true, score: 0 }] };
    },
    start(m) {
      const st = this.pick(m.level, m.intensity);
      m.state = E.newPlayer(st, m.intensity);
      m.startWord = st.word; m.status = 'playing';
      m.serverNow = Date.now(); m.endsAt = Date.now() + E.RULES.round * 1000;
      m.players[0] = { ...m.players[0], ready: true, jackpotsFound: 0, jackpotsTotal: st.jackpots.length, streak: 0, skipsLeft: E.RULES.maxSkips, hintsLeft: E.status(m.state).hintsLeft };
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.finish(m, 'time'), E.RULES.round * 1000);
    },
    submit(m, word) {
      if (m.status !== 'playing' || Date.now() > m.endsAt) return { error: 'Time is up.' };
      return E.applyMove(m.state, word, this.words[m.level], () => this.pick(m.level, m.intensity));
    },
    finish(m, reason) {
      if (m.status === 'over') return;
      clearTimeout(this.timer);
      m.status = 'over';
      const p = m.state;
      m.players[0].score = p.score;
      const top = this.topTen(m.level, m.intensity);
      top.push({ score: p.score, finishedAt: Date.now(), chain: [m.startWord, ...p.chain.filter(c => c.valid).map(c => c.word)] });
      top.sort((a, b) => b.score - a.score || a.finishedAt - b.finishedAt);
      saved(`vistr.top.${m.level}.${m.intensity}`, JSON.stringify(top.slice(0, 10)));
      if (S.match === m) { showResults({ reason, local: true, match: m, topTen: this.topTen(m.level, m.intensity), board: [] }); Ads.afterRound(); }
    },
    topTen(L, intensity) {
      // Scores saved before intensities existed count as Intermediate.
      const key = saved(`vistr.top.${L}.${intensity}`) ?? (intensity === 'intermediate' ? saved(`vistr.top.${L}`) : null);
      try { return JSON.parse(key || '[]'); } catch (_) { return []; }
    },
  };

  async function startSolo(level) {
    if (S.mode === 'live') {
      const r = await api('POST', '/api/match/single', { level, intensity: S.intensity });
      S.match = r.match;
    } else {
      await Local.load(level);
      S.match = Local.newMatch(level, S.intensity);
    }
    showReady();
  }

  // Status badge + Offline/Online buttons on the home screen.
  function setNet(state) {
    const pill = $('#appbar .net-pill');
    if (pill) {
      pill.dataset.net = state === 'waking' ? 'connecting' : state;
      $('[data-net-text]', pill).textContent = { online: 'Online', offline: 'Offline', connecting: 'Connecting…', waking: 'Waking server…' }[state];
      if (pill.tagName === 'BUTTON') {
        pill.disabled = state === 'connecting' || state === 'waking';
        pill.title = state === 'online' ? 'Tap to go offline' : 'Tap to go online';
      }
    }
    const go = $('[data-action=go-online]');
    if (go) {
      const id = S.player?.code || saved('vistr.lastId');
      const busy = state === 'connecting' || state === 'waking';
      go.classList.toggle('connecting', busy);
      go.disabled = busy;
      $('[data-go-title]', go).textContent = state === 'waking' ? 'Waking up the server…' : busy ? 'Connecting…' : id ? `Go online as Player ${id}` : 'Go online';
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
      if (!opts.background) toast('Waking up the game server. After a quiet spell this takes up to a minute.');
      ok = await wakeServer();
    }
    if (opts.background && S.screen !== 'home') {
      setNet('offline');
      if (ok) toast('The game server is ready. Tap Go online to play with others.');
      return false;
    }
    if (!ok) {
      setNet('offline');
      toast("Can't reach the game server right now. You're still offline.");
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
    toast(`You're online as Player ${S.player.code}.`);
    return true;
  }
  // The app remembers this device's Player ID. Use it to go online without asking
  // for anything; the email page appears only when the ID isn't known (any more).
  async function signInWithKnownId() {
    const id = saved('vistr.lastId');
    if (!id) return false;
    try {
      const r = await api('POST', '/api/auth/id', { code: id });
      signedIn(r);
      return true;
    } catch (_) {
      saved('vistr.lastId', null);   // the server doesn't know this ID: ask for the email
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
      const r = await api('GET', '/api/players');
      S.players = r.players; S.playersSkew = r.serverNow - Date.now();
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
    const es = new EventSource(`${S.server.replace(/\/$/, '')}/api/events?token=${encodeURIComponent(S.token)}`);
    S.events = es;
    const on = (type, fn) => es.addEventListener(type, e => fn(JSON.parse(e.data)));
    on('players', d => {
      S.players = d.players; S.playersSkew = d.serverNow - Date.now();
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
        toast(`Solo game saved with ${me ? me.score : 0} points.`);
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
        <span class="ad-text"><b>${esc(a.title)}</b>${a.text ? `<small>${esc(a.text)}</small>` : ''}</span>
        ${a.cta && a.url ? `<span class="ad-cta">${esc(a.cta)}</span>` : ''}<span class="ad-tag">Ad</span>`;
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
      $('[data-title]', dlg).textContent = a.title;
      $('[data-text]', dlg).textContent = a.text;
      const img = $('[data-img]', dlg); const src = this.imageUrl(a);
      img.hidden = !src; if (src) img.src = src;
      const cta = $('[data-cta]', dlg);
      cta.hidden = !(a.url && a.cta); cta.textContent = a.cta; cta.href = a.url || '#';
      cta.onclick = e => { e.preventDefault(); this.open(a); };
      const skip = $('[data-skip]', dlg);
      let left = wait;
      const tick = () => {
        skip.disabled = left > 0;
        skip.textContent = left > 0 ? `Close in ${left}` : 'Close';
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
    $('[data-message]').textContent = message || `Can't reach the game server at ${S.server}. Check that it is running and that this device is on the same network.`;
    const f = $('[data-form=server]');
    f.url.value = S.server || '';
    f.onsubmit = e => {
      e.preventDefault();
      guard(async () => {
        const url = f.url.value.trim().replace(/\/$/, '');
        if (!(await reachable(url))) throw new Error(`No Vistr server answered at ${url}.`);
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

  function signedIn(r) {
    S.token = r.token; saved('vistr.token', r.token);
    S.player = r.player; saved('vistr.lastId', r.player.code);
    S.mode = 'live'; saved('vistr.mode', 'live');
    becomeAvailable();
    connectEvents();
  }

  function showSignIn() {
    mount('signin', 'signin');
    const fi = $('[data-form=id]'), fe = $('[data-form=email]');
    const last = saved('vistr.lastId');
    if (last) fi.code.value = last;
    fi.onsubmit = e => {
      e.preventDefault();
      guard(async () => { signedIn(await api('POST', '/api/auth/id', { code: fi.code.value.trim() })); showHome(); toast(`You're online as Player ${S.player.code}.`); });
    };
    fe.onsubmit = e => {
      e.preventDefault();
      guard(async () => {
        const r = await api('POST', '/api/auth/register', { email: fe.email.value.trim() });
        signedIn(r);
        if (r.isNew) showWelcome(true);            // new player: show their new ID
        else { showHome(); toast(`Welcome back, Player ${r.player.code}. You're online.`); }
      });
    };
    app.onclick = e => { if (e.target.closest('[data-action]')?.dataset.action === 'standalone') goStandalone(); };
  }

  function showWelcome(isNew) {
    mount('welcome', 'welcome');
    $('[data-welcome]').textContent = isNew ? 'Welcome. Your Player ID is' : 'Welcome back. Your Player ID is';
    if (isNew) setTimeout(() => { const el = $('.big-id'); if (el) confetti(el); }, 150);
    app.onclick = e => { if (e.target.closest('[data-action]')?.dataset.action === 'continue') showHome(); };
  }

  function showHome() {
    mount('home', 'home');
    const pickIntensity = name => {
      S.intensity = name; saved('vistr.intensity', name);
      $$('[data-intensity]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.intensity === name)));
      $('[data-intensity-about]').textContent = E.INTENSITY[name].about;
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

    const live = S.mode === 'live';
    const goOffline = () => { goStandalone(); toast("You're offline. Solo games only."); };
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
      if (a === 'signout') guard(async () => { await api('POST', '/api/auth/signout').catch(() => {}); signedOut(); });
    };

    renderPlayers();
    if (!live) return;
    S.clockTimer = setInterval(renderClocks, 1000);
    api('GET', '/api/players').then(r => {
      S.players = r.players; S.playersSkew = r.serverNow - Date.now();
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
    $('[data-avail-hint]').textContent = "Others can see you and send you a request, even while you play solo. To hide, tap ONLINE at the top.";
    const out = $('[data-outgoing]');
    out.hidden = !S.outgoing;
    if (S.outgoing) $('[data-outgoing-text]').textContent = `Request sent to Player ${S.outgoing.to} for ${S.outgoing.level} letters, ${ilabel(S.outgoing.intensity)}. Waiting for them…`;
    const others = (S.players || []).filter(p => p.playerCode !== S.player?.code);
    ul.innerHTML = others.length ? others.map(p => `
      <li data-player="${esc(p.playerCode)}">
        <span class="who"><span class="pid">Player ${esc(p.playerCode)}</span>
          <span class="status ${p.status === 'free' && !p.requested ? 'on' : ''}" ${p.status === 'solo' ? `data-ends="${p.endsAt}" data-lvl="${p.level}" data-int="${esc(ilabel(p.intensity))}"` : ''}>${statusText(p)}</span></span>
        ${p.requested || (S.outgoing && S.outgoing.to === p.playerCode) ? '' :
          `<button class="btn" type="button" data-action="request" data-code="${esc(p.playerCode)}">Request</button>`}
      </li>`).join('')
      : '<li class="empty">Nobody else is available right now. Play solo meanwhile; a request can reach you mid-game.</li>';
    $$('[data-action=request]', ul).forEach(b => { b.textContent = `Play ${S.level} letters`; b.title = `${S.level} letters, ${ilabel(S.intensity)}`; });
  }
  const ilabel = name => E.INTENSITY[name]?.label || 'Intermediate';
  function statusText(p) {
    if (p.requested) return 'Answering a request';
    if (p.status === 'solo') return `Playing solo, ${p.level} letters, ${ilabel(p.intensity)}, ${timeLeft(p.endsAt)} left`;
    return 'Ready to play';
  }
  function timeLeft(endsAt) {
    const s = Math.max(0, Math.ceil((endsAt - (Date.now() + (S.playersSkew || 0))) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  function renderClocks() {
    $$('[data-ends]').forEach(el => { el.textContent = `Playing solo, ${el.dataset.lvl} letters, ${el.dataset.int}, ${timeLeft(Number(el.dataset.ends))} left`; });
  }
  function sendRequest(code) {
    guard(async () => {
      const r = await api('POST', '/api/request', { playerCode: code, level: S.level, intensity: S.intensity });
      S.outgoing = { to: r.to, level: r.level, intensity: r.intensity };
      const f = $('[data-form=request]'); if (f) f.reset();
      renderPlayers();
    });
  }

  function showRequest(d) {
    const dlg = $('#request-dialog');
    $('[data-from]', dlg).textContent = `Player ${d.from}`;
    $('[data-level]', dlg).textContent = d.level;
    $('[data-req-intensity]', dlg).textContent = ilabel(d.intensity);
    const note = $('[data-solo-note]', dlg);
    const inSolo = d.inSolo || (S.screen === 'game' && S.match?.mode === 'single');
    note.hidden = !inSolo;
    if (inSolo) note.textContent = `Playing them ends your solo game. Your ${d.soloScore ?? 'current'} points are saved.`;
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
      const msg = { declined: `Player ${d.to} said no this time.`, expired: `Player ${d.to} didn't answer in time.`,
        left: `Player ${d.to} went offline.`, cancelled: '' }[d.reason];
      if (msg) toast(msg);
      if (S.screen === 'home') renderPlayers();
    } else {
      const dlg = $('#request-dialog');
      if (dlg.open && d.reason !== 'accepted') {
        dlg.returnValue = 'gone'; dlg.close();
        toast(d.reason === 'cancelled' ? `Player ${d.from} cancelled the request.` : 'That request closed.');
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
      el.innerHTML = boardHtml(`Your top 10, ${level} letters, ${ilabel(S.intensity)}`, Local.topTen(level, S.intensity).map(t => ({ name: fmtDate(t.finishedAt), score: t.score })),
        'Your best games on this device will show here.');
      return;
    }
    try {
      const r = await api('GET', `/api/scores?level=${level}&intensity=${S.intensity}`);
      el.innerHTML = boardHtml(`Your top 10, ${level} letters, ${ilabel(S.intensity)}`, r.topTen.map(t => ({ name: fmtDate(t.finishedAt), score: t.score, mine: t.finishedAt === mineHighlight })), 'Your best games will show here.')
        + boardHtml(`All-time, ${level} letters, ${ilabel(S.intensity)}`, r.board.map(b => ({ name: `Player ${b.playerCode}`, score: b.score, mine: b.playerCode === S.player?.code })), 'No games yet at this level.');
    } catch (e) { el.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  }
  function boardHtml(title, rows, empty) {
    return `<section class="board"><h3>${esc(title)}</h3>${rows.length
      ? `<ol>${rows.map(r => `<li class="${r.mine ? 'mine' : ''}"><span>${esc(r.name)}</span><b>${r.score}</b></li>`).join('')}</ol>`
      : `<p class="empty">${esc(empty)}</p>`}</section>`;
  }
  const fmtDate = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

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
    $('[data-title]').textContent = m.mode === 'duo' ? `Both players tap Start` : `Solo, ${m.level} letters, ${ilabel(m.intensity)}`;
    const me = m.players.find(p => p.me);
    $('[data-players]').innerHTML = m.players.map(p => `
      <li><span class="pid">${p.me ? 'You' : 'Player ' + esc(p.playerCode)}</span>
      <span class="status ${p.ready ? 'on' : ''}">${!p.online && !p.me ? 'Offline' : p.ready ? 'Ready' : 'Not ready'}</span></li>`).join('');
    const btn = $('[data-action=ready]');
    btn.disabled = me.ready;
    btn.textContent = me.ready ? 'Waiting for the other player' : 'Start';
    const R = m.rules || {};
    const mins = Math.round((R.round || 300) / 60);
    $('[data-hint]').textContent = m.mode === 'duo'
      ? `You take turns on one shared word for ${mins} minutes: change one letter, then it's the other player's go. ${m.turnSeconds || 30} seconds per turn.`
      : `You have ${mins} minutes. Here's how to score:`;
    const hot = Object.entries(R.hotLetters || {}).reduce((g, [l, pts]) => ((g[pts] = g[pts] || []).push(l.toUpperCase()), g), {});
    $('[data-rules]').innerHTML = [
      `<li>Every real word <b>${pts(R.word ?? 1)}</b></li>`,
      `<li>Not a word <b>${R.miss === 0 ? 'no penalty' : pts(R.miss ?? -1)}</b></li>`,
      ...Object.entries(hot).sort((a, b) => b[0] - a[0]).map(([pts, ls]) => `<li>Roll in ${ls.join(' ')} <b>+${pts} extra</b></li>`),
      `<li>${R.streakFrom ?? 3}+ in a row <b>+1 extra each</b></li>`,
      `<li class="jp">Hidden jackpot words <b>+${R.jackpot ?? 10}</b></li>`,
      `<li>Hint (which letter to roll) <b>${R.hints < 0 ? 'unlimited' : R.hints === 0 ? 'none' : R.hints + ' per round'}</b></li>`,
      `<li>Next word, when stuck <b>${(R.maxSkips ?? 5) - 1} free, ${R.maxSkips ?? 5}th ends round</b></li>`,
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
    say(m.mode !== 'duo' ? 'Roll one letter to make a new word.'
      : S.game.myTurn ? 'You go first. Roll one letter to make a new word.'
      : `Player ${m.turnCode} goes first. Your drums unlock on your turn.`, 'info');
    app.onclick = e => {
      const btn = e.target.closest('[data-action]'); if (!btn) return;
      const a = btn.dataset.action;
      if (a === 'process') processWord();
      if (a === 'skip') skipWord();
      if (a === 'hint') useHint();
      if (a === 'reset') resetDraft();
      if (a === 'roll') roll(Number(btn.dataset.slot), Number(btn.dataset.dir));
      if (a === 'quit' && confirm('End this round now? Your score so far is saved.')) {
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
    $('[data-turn-who]').textContent = g.myTurn ? 'Your turn' : `Player ${g.turnCode}'s turn`;
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
      const msg = last.outcome === 'valid' ? `Player ${last.by} made ${W}${last.points ? ` (+${last.points})` : ''}.`
        : last.outcome === 'invalid' ? `Player ${last.by} tried ${W}: not a word.`
        : last.outcome === 'skip' ? `Player ${last.by} took a new word.`
        : last.outcome === 'timeout' ? `Player ${last.by} ran out of time.` : '';
      say(`${msg} Your turn!`.trim(), 'good');
      renderParts([]); $('[data-drums]')?.classList.remove('good', 'bad');
      if (navigator.vibrate) navigator.vibrate(60);
    } else if (last.outcome === 'timeout' && was) {
      say(`Time's up for that turn. Player ${g.turnCode}'s go.`, 'bad');
    }
    if (S.screen === 'game') { renderDrums(); renderChain(); renderHints(); renderSkips(); renderTurn(); }
  }

  function renderDrums(animSlot = null, dir = 0) {
    const g = S.game, wrap = $('[data-drums]');
    wrap.innerHTML = g.draft.map((ch, i) => {
      const k = A_Z.indexOf(ch);
      const at = d => A_Z[(k + d + 26) % 26];
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
    if (g.duo && !g.myTurn) { say(`Wait for your turn. It's Player ${g.turnCode}'s go.`, 'info'); return; }
    if (g.locked) return;
    if (!oneLetter(slot)) return;
    const k = A_Z.indexOf(g.draft[slot]);
    g.draft[slot] = A_Z[(k + dir + 26) % 26];
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
    say(`One letter per move. Roll letter ${g.changed + 1} back, or tap Undo.`, 'bad');
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
    say('Checking…', 'info');
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
      say(r.message + (passes ? `. Player ${S.match.players.find(p => !p.me)?.playerCode}'s turn.` : ''), r.outcome === 'valid' ? 'good' : r.outcome === 'invalid' ? 'bad' : 'info');
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
    $('[data-hints-left]').textContent = left < 0 ? '' : `${left} left`;
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
    $('[data-skips-left]').textContent = left <= 1 ? 'ends the round' : `${free} free`;
    btn.classList.toggle('last', left <= 1);
    btn.disabled = left <= 0 || blocked(S.game);
  }
  async function skipWord() {
    const g = S.game; if (blocked(g) || g.skipsLeft <= 0) return;
    if (g.skipsLeft <= 1 && !confirm('This is your last skip. Using it ends the round now. Go ahead?')) return;
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
    el.textContent = found >= total && total ? `★ All ${total} jackpots!` : `★ Jackpots ${found}/${total}`;
    el.title = `Hidden jackpot words found: ${found} of ${total}`;
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
    if (n >= 2) { el.textContent = `🔥 ${n} in a row`; el.title = n >= 5 ? 'Unstoppable!' : ''; replay(el, 'bump'); }
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
      $('[data-oppcode]').textContent = `Player ${opp.playerCode}` + (opp.online === false ? ' (offline)' : '');
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
    if (/^[a-z]$/i.test(e.key) && !e.ctrlKey && !e.metaKey) {
      // Typing a letter sets the focused drum directly.
      e.preventDefault();
      if (blocked(g)) { if (g.duo && !g.myTurn) say(`Wait for your turn. It's Player ${g.turnCode}'s go.`, 'info'); return; }
      const want = e.key.toLowerCase();
      const cur = g.draft[g.focus];
      const dir = (A_Z.indexOf(want) - A_Z.indexOf(cur) + 26) % 26;
      if (dir && oneLetter(g.focus)) { g.draft[g.focus] = want; g.changed = want === g.current[g.focus] ? null : g.focus; renderDrums(g.focus, 1); }
      return;
    }
    if (keys[e.key]) { e.preventDefault(); keys[e.key](); }
  });

  // ───────────────────────── results ─────────────────────────
  function showResults(d) {
    const m = d.match;
    S.match = null; S.game = null;
    mount('results', 'results');
    const me = m.players.find(p => p.me), opp = m.players.find(p => !p.me);
    const title = !opp ? `You scored ${me.score}`
      : me.score > opp.score ? `You won, ${me.score} to ${opp.score}`
      : me.score < opp.score ? `Player ${opp.playerCode} won, ${opp.score} to ${me.score}`
      : `A draw at ${me.score}`;
    const why = d.reason === 'opponent-left' ? ' The other player disconnected.'
      : d.reason === 'skips' ? (opp ? ` ${d.endedBy === S.player?.code ? 'You' : 'Player ' + d.endedBy} used the last skip.` : ' You used your last skip.')
      : d.reason === 'ended' && opp ? (d.endedBy === S.player?.code ? ' You ended the round.' : ` Player ${d.endedBy} ended the round.`) : '';
    $('[data-title]').textContent = title + (why ? '.' + why : '');
    const mine = d.topTen.find(t => t.finishedAt && Math.abs(t.finishedAt - Date.now()) < 10_000);
    $('[data-final]').innerHTML = `
      <div class="row ${opp && me.score > opp.score ? 'win' : ''}"><span>You</span><b>${me.score}</b></div>
      ${opp ? `<div class="row ${opp.score > me.score ? 'win' : ''}"><span>Player ${esc(opp.playerCode)}</span><b>${opp.score}</b></div>` : ''}
      ${mine?.chain?.length > 1 ? `<p class="words">${mine.chain.map(esc).join(' › ')}</p>` : ''}`;
    $('[data-boards]').innerHTML = boardHtml(`Your top 10, ${m.level} letters, ${ilabel(m.intensity)}`, d.topTen.map(t => ({ name: fmtDate(t.finishedAt), score: t.score, mine: t === mine })), 'No games saved yet.')
      + (d.local ? '' : boardHtml(`All-time, ${m.level} letters, ${ilabel(m.intensity)}`, d.board.map(b => ({ name: `Player ${b.playerCode}`, score: b.score, mine: b.playerCode === S.player?.code })), 'No games yet.'));
    app.onclick = e => {
      const a = e.target.closest('[data-action]')?.dataset.action;
      if (a === 'home') showHome();
      if (a === 'again') { if (m.mode === 'duo') showHome(); else guard(() => startSolo(m.level)); }
    };
  }

  // ───────────────────────── boot ─────────────────────────
  function signedOut() { // Sign out button: forget this player on this device, back to offline
    S.token = null; S.player = null; saved('vistr.token', null); saved('vistr.lastId', null);
    goStandalone();
  }
  async function sessionEnded() { // the server no longer knows this sign-in: try the ID, else ask
    S.token = null; S.player = null; saved('vistr.token', null);
    S.events?.close(); S.events = null;
    if (await signInWithKnownId()) { showHome(); toast(`You're online as Player ${S.player.code}.`); }
    else showSignIn();
  }

  // Live but the server can't be reached (offline, PC switched off): play standalone
  // instead of getting stuck. Live stays the saved choice, so it reconnects next time.
  function offlineFallback(why) {
    S.mode = 'standalone';
    S.events?.close(); S.events = null;
    showHome();
    toast(why || "Can't reach the game server, so you're offline. Tap Go online when you're connected.");
  }

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
        status.textContent = 'Sending…'; status.className = 'form-status'; btn.disabled = true;
        try {
          const r = await fetch(S.server.replace(/\/$/, '') + '/api/contact', {
            method: 'POST', signal: timeoutSignal(15000),
            headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: `Bearer ${S.token}` } : {}) },
            body: JSON.stringify(data),
          }).catch(() => { throw new Error("Can't reach the game server. Check your internet connection and try again."); });
          const out = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(out.error || 'Could not send. Try again.');
          f.message.value = '';
          status.textContent = "Thanks! Your message is on its way. We'll reply by email."; status.className = 'form-status ok';
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
        body.innerHTML = "<p>Reviews need the game server, and it can't be reached right now. Check your internet connection and try again.</p>";
        return;
      }
      const max = Math.max(1, ...d.counts);
      const mine = d.mine;
      this.picked = mine?.stars || 0;
      const canWrite = S.mode === 'live' && S.token;
      body.innerHTML = `
        <div class="rv-summary">
          <div><b>${d.count ? d.average.toFixed(1) : '–'}</b><span class="rv-stars">${this.stars(Math.round(d.average))}</span>
          <span class="meta">${d.count} review${d.count === 1 ? '' : 's'}</span></div>
          <ol class="rv-bars" aria-label="Ratings">${[5, 4, 3, 2, 1].map(n => `<li><span>${n}★</span><i><i style="width:${Math.round(d.counts[n - 1] / max * 100)}%"></i></i><small>${d.counts[n - 1]}</small></li>`).join('')}</ol>
        </div>
        <section class="rv-write">
          ${canWrite ? `
            <h2>${mine ? 'Your review' : 'Rate Vistr'}</h2>
            ${mine?.status === 'held' ? '<p class="meta">Your review is waiting for approval.</p>' : ''}
            <form data-review>
              <div class="rv-pick" role="radiogroup" aria-label="Stars">${[1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" data-star="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('')}</div>
              <textarea name="text" rows="3" maxlength="500" placeholder="What do you like? What could be better? (optional)">${esc(mine?.text || '')}</textarea>
              <p class="form-status" data-status role="status"></p>
              <button type="submit" class="btn primary">${mine ? 'Update my review' : 'Post review'}</button>
            </form>` : `
            <p>Played Vistr? <b>Go online</b> to rate it and write a review.</p>
            <button type="button" class="btn" data-go-review>Go online</button>`}
        </section>
        <h2>What players say</h2>
        <ul class="rv-list">${d.reviews.map(r => `<li><span class="rv-stars">${this.stars(r.stars)}</span> <b>Player ${esc(r.playerCode)}</b>
          <small>${new Date(r.updatedAt).toLocaleDateString()}</small>${r.text ? `<p>${esc(r.text)}</p>` : ''}</li>`).join('') || '<li class="meta">No reviews yet. Be the first!</li>'}</ul>`;
      const pick = n => { this.picked = n; $$('[data-star]', body).forEach(b => { const on = Number(b.dataset.star) <= n; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(Number(b.dataset.star) === n)); }); };
      pick(this.picked);
      $('.rv-pick', body)?.addEventListener('click', e => { const b = e.target.closest('[data-star]'); if (b) pick(Number(b.dataset.star)); });
      $('[data-go-review]', body)?.addEventListener('click', () => { $('#reader').close(); goLive(); });
      $('form[data-review]', body)?.addEventListener('submit', async e => {
        e.preventDefault();
        const f = e.target, status = $('[data-status]', f);
        if (!this.picked) { status.textContent = 'Tap the stars to rate first.'; status.className = 'form-status bad'; return; }
        try {
          const r = await api('POST', '/api/reviews', { stars: this.picked, text: f.text.value });
          toast(r.held ? 'Thanks! Your review will appear once it is approved.' : 'Thanks for your review!');
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
      $('[data-ad-privacy]', m).hidden = !NativeAds.privacyChoices;
      if (!m.open) m.showModal();
    },
    async page(name) {
      const r = $('#reader'), body = $('[data-reader-body]', r);
      $('[data-reader-title]', r).textContent = this.titles[name] || '';
      body.innerHTML = '<p class="hint">Loading…</p>';
      if (!r.open) r.show();            // not modal: the top bar stays usable above it
      r.dataset.page = name;
      if (name === 'reviews') return Reviews.render(body);
      try {
        const html = await fetch(`${name}.html`).then(x => { if (!x.ok) throw new Error(); return x.text(); });
        const main = new DOMParser().parseFromString(html, 'text/html').querySelector('main');
        main.querySelector('.page-nav')?.remove();
        main.querySelector('h1')?.remove();          // the reader shows the title in its header
        body.innerHTML = main.innerHTML;
        if (name === 'contact') Contact.bind(body);
      } catch (_) {
        body.innerHTML = '<p>This page could not be opened. Check your connection and try again.</p>';
      }
      body.scrollTop = 0;
    },
    async adPrivacy() {
      try { await NativeAds.plugin()?.showPrivacyOptionsForm(); }
      catch (_) { toast('Ad privacy choices are not available right now.'); }
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
        if (busy) return toast('Finish or end this round first.');
        reader.close();
        if (S.mode === 'live') { goStandalone(); toast("You're offline. Solo games only."); } else goLive();
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

  async function boot() {
    NativeAds.init().then(on => { if (on) Ads.showBanner(); });
    try { if (!Ads.data) Ads.load(); } catch (_) {}
    if (S.mode !== 'live') return showHome();
    app.innerHTML = '<section class="screen narrow"><p class="lead">Connecting…</p></section>';
    if (!(await reachable(S.server).catch(() => false))) {
      if (!hostedServer()) return offlineFallback();
      // Probably asleep: let them play solo now and go online by itself once it's awake.
      offlineFallback('Waking up the game server. Play solo meanwhile; you\'ll go online by yourself.');
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
