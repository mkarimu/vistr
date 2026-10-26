// Spot What's Missing (Vistr game 2). Two copies of a picture; the right one has parts hidden. Find them by pointing
// (mouse, touch, pen), with the keyboard, with one switch, or by typing the name. Everything about the carer and the
// players lives on memoryq.com; this page only plays. No ads, no chat, no sign-in for children.
(() => {
  'use strict';
  const MQ = String(window.MISSING_MQ || 'https://memoryq.com').replace(/\/$/, '');
  const SVGNS = 'http://www.w3.org/2000/svg';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const app = $('#app');
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };

  // ---------------------------------------------------------------- words on the screen (English, Kiswahili)
  const T = {
    en: {
      title: "Spot What's Missing", tagline: 'Two pictures. Something is missing from the second one. Can you find it?',
      signin: 'Carer: sign in with Memoryq', signinNote: 'Players are added by their parent, teacher or carer on memoryq.com. Children never need to sign in.',
      nativeNote: 'Open vistr.memoryq.com/missing in your browser to play.',
      who: 'Who is playing?', carers: "Carers' area", signout: 'Sign out', noPlayers: "No players yet. Add one in the carers' area on memoryq.com.",
      addPlayer: 'Add a player', hello: 'Hello {name}!', level: 'Level {n}', play: 'Play', look: 'Look', findHere: "Find what's missing",
      foundOf: '{n} of {k} found', next: 'Next', hint: 'Help me', home: 'Home', typeHere: 'Type what is missing', check: 'Check',
      wellDone: 'Well done! You found them all.', showAnswers: 'Here is what was missing.', nextPicture: 'Here is the next picture.',
      goodbye: 'Great playing! See you next time.', lookHere: 'Look here.', letsPlay: "Let's play!", findIntro: "Find what's missing from {title}.",
      youFound: 'You found {n} things!', starsN: '{n} stars', playAgain: 'Play again', choose: 'Choose player', pictureN: 'Picture {i} of {n}',
      signingIn: 'Signing in...', offline: 'No connection - the game is kept and sent later.', sound: 'Sound', timeUp: 'Time is up. Here is what was missing.',
      loading: 'Getting the picture...', tryAgain: 'Try again', notThere: 'Not there - look again.', missing: '{k} missing', pictureOnly: 'Picture {i}',
    },
    sw: {
      title: 'Tafuta Kinachokosekana', tagline: 'Picha mbili. Kuna kitu kinachokosekana kwenye picha ya pili. Je, unaweza kukipata?',
      signin: 'Mlezi: ingia kwa Memoryq', signinNote: 'Wachezaji huongezwa na mzazi, mwalimu au mlezi wao kwenye memoryq.com. Watoto hawahitaji kuingia.',
      nativeNote: 'Fungua vistr.memoryq.com/missing kwenye kivinjari ili kucheza.',
      who: 'Nani anacheza?', carers: 'Eneo la walezi', signout: 'Toka', noPlayers: 'Bado hakuna wachezaji. Ongeza mmoja kwenye eneo la walezi la memoryq.com.',
      addPlayer: 'Ongeza mchezaji', hello: 'Habari {name}!', level: 'Kiwango {n}', play: 'Cheza', look: 'Angalia', findHere: 'Tafuta kinachokosekana',
      foundOf: '{n} kati ya {k} vimepatikana', next: 'Inayofuata', hint: 'Nisaidie', home: 'Nyumbani', typeHere: 'Andika kinachokosekana', check: 'Hakiki',
      wellDone: 'Hongera! Umevipata vyote.', showAnswers: 'Hivi ndivyo vilivyokosekana.', nextPicture: 'Hii ni picha inayofuata.',
      goodbye: 'Umecheza vizuri! Tuonane tena.', lookHere: 'Angalia hapa.', letsPlay: 'Tucheze!', findIntro: 'Tafuta kinachokosekana kwenye {title}.',
      youFound: 'Umepata vitu {n}!', starsN: 'nyota {n}', playAgain: 'Cheza tena', choose: 'Chagua mchezaji', pictureN: 'Picha {i} kati ya {n}',
      signingIn: 'Inaingia...', offline: 'Hakuna mtandao - mchezo umehifadhiwa na utatumwa baadaye.', sound: 'Sauti', timeUp: 'Muda umekwisha. Hivi ndivyo vilivyokosekana.',
      loading: 'Inapakia picha...', tryAgain: 'Jaribu tena', notThere: 'Si hapo - angalia tena.', missing: '{k} vinakosekana', pictureOnly: 'Picha {i}',
    },
  };
  let lang = /^sw\b/i.test(navigator.language || '') ? 'sw' : 'en';
  const t = (k, v) => String((T[lang] && T[lang][k]) || T.en[k] || k).replace(/\{(\w+)\}/g, (_, n) => (v && v[n] != null ? v[n] : ''));
  const AV = { lion: '\u{1F981}', elephant: '\u{1F418}', giraffe: '\u{1F992}', turtle: '\u{1F422}', fish: '\u{1F41F}', butterfly: '\u{1F98B}', flower: '\u{1F33B}',
    star: '\u2B50', car: '\u{1F697}', rocket: '\u{1F680}', sun: '\u2600\uFE0F', heart: '\u2764\uFE0F' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  function translatePage() {
    document.documentElement.lang = lang;
    $$('[data-t]').forEach(e => { e.textContent = t(e.dataset.t); });
    $$('[data-t-title]').forEach(e => { e.title = t(e.dataset.tTitle); e.setAttribute('aria-label', t(e.dataset.tTitle)); });
    document.title = t('title') + ' - Vistr';
  }
  function toast(msg, ms) {
    const el = $('#toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toast.tm); toast.tm = setTimeout(() => { el.hidden = true; }, ms || 3500);
  }

  // ---------------------------------------------------------------- memoryq.com
  let token = store.get('missing.token');
  async function api(method, path, body, asJson) {
    const h = {};
    if (token) h.Authorization = 'Bearer ' + token;
    let b;
    if (body !== undefined) {
      h['Content-Type'] = asJson ? 'application/json' : 'application/x-www-form-urlencoded';
      b = asJson ? JSON.stringify(body) : new URLSearchParams(body).toString();
    }
    const r = await fetch(MQ + path, { method, headers: h, body: b });
    let d = {};
    try { d = await r.json(); } catch (e) { /* not JSON */ }
    if (r.status === 401 && path !== '/api/missing/signin') { token = null; store.set('missing.token', null); }
    if (!r.ok) { const e = new Error(d.error || ('error ' + r.status)); e.status = r.status; throw e; }
    return d;
  }
  // rounds wait here when the connection drops, and go when it is back
  const Outbox = {
    list() { try { return JSON.parse(store.get('missing.outbox') || '[]'); } catch (e) { return []; } },
    save(l) { store.set('missing.outbox', l.length ? JSON.stringify(l.slice(-200)) : null); },
    busy: false,
    async send(item) {
      item.uid = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const l = this.list(); l.push(item); this.save(l); return this.flush();
    },
    drop(uid) { this.save(this.list().filter(x => x.uid !== uid)); },
    async flush() {
      if (this.busy) return null;
      this.busy = true;
      try {
        for (let guard = 0; guard < 400; guard++) {
          const item = this.list()[0];
          if (!item) return null;
          try { await api('POST', item.path, item.body, item.json); }
          catch (e) {
            if (!(e.status && e.status !== 429 && e.status < 500)) { toast(t('offline')); return null; } // offline: try again later
          }
          this.drop(item.uid); // sent, or refused for good
        }
      } finally { this.busy = false; }
      return null;
    },
  };
  function signIn() {
    location.href = MQ + '/login?app=missing&return=' + encodeURIComponent(location.origin + location.pathname + location.search);
  }

  // ---------------------------------------------------------------- sound and speech
  let muted = store.get('missing.muted') === '1';
  let clips = null;
  fetch('audio/index.json').then(r => r.ok ? r.json() : null).then(d => { clips = d; }).catch(() => {});
  let actx = null;
  function tone(notes, type, vol) {
    if (muted) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      let at = actx.currentTime;
      notes.forEach(([f, d]) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = type || 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol || 0.18, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + d);
        o.connect(g); g.connect(actx.destination); o.start(at); o.stop(at + d + 0.05); at += d * 0.8;
      });
    } catch (e) { /* no sound */ }
  }
  const sounds = {
    found: () => tone([[523, 0.14], [659, 0.14], [784, 0.26]], 'sine', 0.2),
    miss: () => tone([[220, 0.18]], 'triangle', 0.07),
    cheer: () => tone([[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.4]], 'sine', 0.2),
  };
  let speaking = null;
  function voiceOn() { return !muted && !(S.player && S.player.settings && S.player.settings.voice === '0'); }
  function say(text, then) {
    $('#say').textContent = text;
    if (!voiceOn()) { if (then) setTimeout(then, 300); return; }
    try { if (speaking) { speaking.pause(); speaking = null; } window.speechSynthesis && speechSynthesis.cancel(); } catch (e) { /* nothing */ }
    // Kiswahili: a real Kiswahili voice on the device sounds best; the built-in clips are for devices without one
    const swVoice = lang === 'sw' && window.speechSynthesis && speechSynthesis.getVoices().some(x => /^sw/i.test(x.lang));
    const file = !swVoice && clips && clips[lang] && clips[lang][text];
    if (file) {
      const a = new Audio('audio/' + file); speaking = a;
      a.onended = () => { if (speaking === a) speaking = null; if (then) then(); };
      a.onerror = () => tts(text, then);
      a.play().catch(() => tts(text, then));
      return;
    }
    tts(text, then);
  }
  function tts(text, then) {
    try {
      if (!window.speechSynthesis) throw new Error('none');
      const u = new SpeechSynthesisUtterance(text);
      const want = lang === 'sw' ? /^sw/i : /^en/i;
      const v = speechSynthesis.getVoices().find(x => want.test(x.lang));
      if (v) u.voice = v;
      u.lang = lang === 'sw' ? 'sw-KE' : 'en-GB';
      u.rate = 0.9;
      u.onend = () => { if (then) then(); };
      speechSynthesis.speak(u);
      if (then && !v && lang === 'sw') setTimeout(then, 1500);
    } catch (e) { if (then) setTimeout(then, 600); }
  }
  function sayAll(list, done) {
    const next = i => (i >= list.length ? done && done() : say(list[i], () => setTimeout(() => next(i + 1), 250)));
    next(0);
  }
  function setMuted(m) {
    muted = m; store.set('missing.muted', m ? '1' : null);
    $('#soundBtn').setAttribute('aria-pressed', String(!m));
    $('#soundBtn span').textContent = m ? '\u{1F507}' : '\u{1F50A}';
    if (m) { try { speechSynthesis.cancel(); if (speaking) speaking.pause(); } catch (e) { /* nothing */ } }
  }
  $('#soundBtn').onclick = () => setMuted(!muted);

  // ---------------------------------------------------------------- state
  const S = { players: [], player: null, session: null, params: null, pictures: [], recent: {}, order: [], done: 0, stars: 0, found: 0, startedAt: 0, round: null };
  const svgCache = {};

  // ---------------------------------------------------------------- screens
  function mount(html, cls) {
    stopRound();
    app.innerHTML = '<section class="screen ' + (cls || '') + '">' + html + '</section>';
    translatePage();
    const first = app.querySelector('h1, h2');
    if (first) { first.setAttribute('tabindex', '-1'); first.focus({ preventScroll: true }); }
    return app.firstElementChild;
  }
  async function heroPics() {
    try {
      const svg = await loadSvg('cat');
      return '<div class="hero-pics" aria-hidden="true"><div class="pic">' + svg + '</div><div class="pic">' + svg.replace('<g id="left-pupil"', '<g style="visibility:hidden" id="left-pupil"').replace('<g id="tail"', '<g style="visibility:hidden" id="tail"') + '</div></div>';
    } catch (e) { return ''; }
  }

  async function showSignIn(err) {
    $('#homeBtn').hidden = true;
    const el = mount('<h1 data-t="title"></h1><p class="lead" data-t="tagline"></p><div class="hero"></div>'
      + (isNative ? '<p class="note" data-t="nativeNote"></p>' : '<button class="btn primary big" type="button" data-go="signin" data-t="signin"></button>')
      + '<p class="note" data-t="signinNote"></p><p class="error">' + esc(err || '') + '</p>', 'center');
    el.querySelector('.hero').innerHTML = await heroPics();
    el.onclick = e => { if (e.target.closest('[data-go=signin]')) signIn(); };
  }

  async function showPlayers() {
    $('#homeBtn').hidden = true;
    let d;
    try { d = await api('GET', '/api/missing/players'); }
    catch (e) { if (e.status === 401) return showSignIn(); return showError(e.message, showPlayers); }
    S.players = d.players || [];
    const pre = new URLSearchParams(location.search).get('p');
    if (pre && S.players.some(p => p.id === pre)) { history.replaceState(null, '', location.pathname); return showHello(S.players.find(p => p.id === pre)); }
    const el = mount('<h1 data-t="who"></h1>'
      + (S.players.length ? '<div class="players">' + S.players.map(p => '<button class="player" type="button" data-p="' + esc(p.id) + '"><span class="av" aria-hidden="true">'
        + (AV[p.avatar] || AV.star) + '</span>' + esc(p.nickname) + '<small>' + esc(t('level', { n: p.level })) + '</small></button>').join('') + '</div>'
        : '<p class="lead" data-t="noPlayers"></p>')
      + '<div class="row"><a class="btn' + (S.players.length ? ' small' : ' primary big') + '" href="' + MQ + '/me#missing" data-t="' + (S.players.length ? 'carers' : 'addPlayer') + '"></a>'
      + '<button class="btn small" type="button" data-go="signout" data-t="signout"></button></div>', 'center');
    el.onclick = async e => {
      const b = e.target.closest('[data-p]');
      if (b) return showHello(S.players.find(p => p.id === b.dataset.p));
      if (e.target.closest('[data-go=signout]')) {
        await api('POST', '/api/missing/signout', {}).catch(() => {});
        token = null; store.set('missing.token', null); showSignIn();
      }
    };
  }

  function showHello(p) {
    S.player = p; lang = p.lang === 'sw' ? 'sw' : 'en';
    $('#homeBtn').hidden = false;
    const el = mount('<div class="hello"><div class="av" aria-hidden="true">' + (AV[p.avatar] || AV.star) + '</div></div><h1>' + esc(t('hello', { name: p.nickname }))
      + '</h1><p class="lead">' + esc(t('level', { n: p.level })) + '</p><button class="btn primary big" type="button" data-go="play" data-t="play"></button>', 'center');
    el.onclick = e => { if (e.target.closest('[data-go=play]')) startSession(); };
    el.querySelector('[data-go=play]').focus();
  }

  function showError(msg, retry) {
    const el = mount('<p class="lead">' + esc(msg) + '</p><button class="btn primary" type="button" data-t="tryAgain"></button>', 'center');
    el.querySelector('button').onclick = retry;
  }

  $('#homeBtn').onclick = () => { if (S.session) endSession(true); else showPlayers(); };

  // ---------------------------------------------------------------- a session
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  async function startSession() {
    let d;
    try { d = await api('POST', '/api/missing/session/start', { player: S.player.id }); }
    catch (e) { if (e.status === 401) return showSignIn(); return showError(e.message, startSession); }
    Outbox.flush();
    Object.assign(S, { session: d.session, params: d.params, pictures: d.pictures || [], recent: d.recent || {}, done: 0, stars: 0, found: 0, startedAt: Date.now() });
    S.player = d.player; lang = S.player.lang === 'sw' ? 'sw' : 'en';
    // pictures not played lately first
    const played = Object.keys(S.recent);
    const fresh = shuffle(S.pictures.filter(p => played.indexOf(p.id) < 0)), seen = shuffle(S.pictures.filter(p => played.indexOf(p.id) >= 0));
    S.order = fresh.concat(seen);
    if (!S.order.length) return showError('No pictures are switched on.', showPlayers);
    nextPicture(true);
  }

  function sessionOver() {
    const minutes = Number(S.player.settings && S.player.settings.minutes) || 0;
    if (minutes > 0) return Date.now() - S.startedAt >= minutes * 60000 || S.done >= 40;
    return S.done >= (S.params.pictures || 5);
  }

  function nextPicture(first) {
    if (S.done > 0 && sessionOver()) return endSession(false);
    const pic = S.order[S.done % S.order.length];
    playPicture(pic, first);
  }

  async function endSession(early) {
    const s = S.session;
    stopRound();
    S.session = null;
    if (s) Outbox.send({ path: '/api/missing/session/end', body: { session: s } });
    if (early && S.done === 0) return showPlayers();
    const el = mount('<div class="summary"><div class="st" aria-hidden="true">' + '\u2B50'.repeat(Math.min(10, Math.max(1, S.stars))) + '</div></div><h1>'
      + esc(t('youFound', { n: S.found })) + '</h1><p class="lead">' + esc(t('starsN', { n: S.stars })) + '</p><div class="row">'
      + '<button class="btn primary big" type="button" data-go="again" data-t="playAgain"></button><button class="btn" type="button" data-go="players" data-t="choose"></button></div>', 'center');
    if (!early) { sounds.cheer(); confetti(); say(t('goodbye')); }
    el.onclick = e => {
      if (e.target.closest('[data-go=again]')) startSession();
      if (e.target.closest('[data-go=players]')) showPlayers();
    };
  }

  // ---------------------------------------------------------------- pictures
  async function loadSvg(id) {
    if (svgCache[id]) return svgCache[id];
    const r = await fetch(MQ + '/api/missing/picture?id=' + encodeURIComponent(id));
    if (!r.ok) throw new Error('picture ' + id + ': ' + r.status);
    svgCache[id] = await r.text();
    return svgCache[id];
  }
  /** A safe copy of the SVG with every id prefixed (two copies live on one page). */
  function build(text, prefix) {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svg = doc.documentElement;
    if (svg.nodeName !== 'svg') throw new Error('not a picture');
    svg.querySelectorAll('script, foreignObject, image, a, use, style, iframe').forEach(n => n.remove());
    const parts = {};
    svg.querySelectorAll('*').forEach(n => {
      Array.from(n.attributes).forEach(a => {
        if (/^on/i.test(a.name) || /href$/i.test(a.name)) n.removeAttribute(a.name);
        else if (/url\(#/.test(a.value)) n.setAttribute(a.name, a.value.replace(/url\(#([^)]+)\)/g, 'url(#' + prefix + '$1)'));
      });
      if (n.id) { if (n.hasAttribute('data-part')) { parts[n.id] = n; n.setAttribute('data-pid', n.id); } n.id = prefix + n.id; }
    });
    svg.removeAttribute('width'); svg.removeAttribute('height');
    svg.setAttribute('role', 'img');
    const node = document.importNode(svg, true);
    const map = {};
    node.querySelectorAll('[data-pid]').forEach(n => { map[n.getAttribute('data-pid')] = n; });
    return { svg: node, parts: map };
  }

  /** Which parts to hide: the level's sizes first, not the ones hidden here lately, never two that must not go together. */
  function choose(pic) {
    const P = S.params, parts = pic.parts || [];
    const order = ['large', 'medium', 'small'];
    const wanted = P.sizes || ['large'];
    let k = P.hideMin + Math.floor(Math.random() * (P.hideMax - P.hideMin + 1));
    k = Math.max(1, Math.min(k, parts.length - 1));
    const lately = (S.recent[pic.id] || []).join(',').split(',');
    const tier = p => {
      const w = wanted.indexOf(p.size);
      if (w >= 0) return w;
      const dist = Math.min.apply(null, wanted.map(x => Math.abs(order.indexOf(x) - order.indexOf(p.size))));
      return 10 + dist;
    };
    const never = pic.never_together || [];
    const clash = (set, p) => set.some(q => never.some(n => (n[0] === p.id && n[1] === q.id) || (n[1] === p.id && n[0] === q.id)));
    let best = null;
    for (let attempt = 0; attempt < 40 && !best; attempt++) {
      const pool = shuffle(parts.slice()).sort((a, b) => (tier(a) + (lately.indexOf(a.id) >= 0 ? 5 : 0)) - (tier(b) + (lately.indexOf(b.id) >= 0 ? 5 : 0)));
      const set = [];
      for (const p of pool) { if (set.length >= k) break; if (!clash(set, p)) set.push(p); }
      if (set.length >= Math.min(k, 1)) best = set;
    }
    return best || [parts[0]];
  }

  // ---------------------------------------------------------------- playing one picture
  let R = null; // the round being played
  function stopRound() {
    if (!R) return;
    clearInterval(R.tick); clearTimeout(R.scanTimer);
    window.removeEventListener('keydown', R.keys);
    $$('.cheer').forEach(n => n.remove());
    R = null;
  }

  async function playPicture(pic, first) {
    stopRound();
    const el = mount('<p class="lead" data-t="loading"></p>', 'center');
    let text;
    try { text = await loadSvg(pic.id); } catch (e) { S.done++; return S.done > S.order.length ? showError(e.message, showPlayers) : nextPicture(); }
    if (!el.isConnected) return;
    const left = build(text, 'L-'), right = build(text, 'R-');
    const hidden = choose(pic);
    const typing = S.player.settings && S.player.settings.typing === '1' && S.params.level >= 3;
    const scan = S.player.settings && S.player.settings.scan === '1';
    const screen = mount('<div class="ghead"><span class="count"></span><div class="chips"></div><span class="stars">\u2B50 <b></b></span></div>'
      + (S.params.timer ? '<div class="timer"><i></i></div>' : '')
      + '<div class="stage"><div class="panel look"><div class="lbl" data-t="look"></div><div class="pic"></div></div>'
      + '<div class="panel find"><div class="lbl" data-t="findHere"></div><div class="pic" tabindex="0"></div></div></div>'
      + '<div class="gfoot">' + (typing ? '<form class="typebox"><input type="text" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn small" type="submit" data-t="check"></button></form>' : '')
      + '<button class="btn small" type="button" data-go="hint" data-t="hint"></button><button class="btn small" type="button" data-go="next" data-t="next"></button></div>', 'game');
    $('.look .pic', screen).appendChild(left.svg);
    const findBox = $('.find .pic', screen);
    findBox.appendChild(right.svg);
    findBox.setAttribute('aria-label', t('findHere'));
    if (typing) $('.typebox input', screen).placeholder = t('typeHere');
    const vb = (right.svg.getAttribute('viewBox') || '0 0 300 300').split(/[\s,]+/).map(Number);
    const scale = vb[2] / 300;
    R = {
      pic, left, right, vb, scale, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), started: Date.now(),
      hidden: hidden.map(p => p.id), todo: hidden.slice(), found: [], misses: 0, hintStage: {}, lastFind: Date.now(), done: false,
      overlay: document.createElementNS(SVGNS, 'g'), focus: -1, scanPass: 0, scanRegion: null,
    };
    R.right.svg.appendChild(R.overlay);
    hidden.forEach(p => { const n = right.parts[p.id]; if (n) n.classList.add('part-hidden'); R.hintStage[p.id] = 0; });
    renderHead();
    // pointing
    const ring = el2('circle', { class: 'ring', r: 1, 'stroke-width': 3 * scale });
    ring.style.display = 'none';
    R.overlay.appendChild(ring);
    findBox.addEventListener('pointermove', e => {
      if (!R || R.done) return;
      const p = toSvg(e.clientX, e.clientY);
      ring.setAttribute('cx', p.x); ring.setAttribute('cy', p.y); ring.setAttribute('r', ringR()); ring.style.display = '';
    });
    findBox.addEventListener('pointerleave', () => { ring.style.display = 'none'; });
    findBox.addEventListener('click', e => {
      if (!R || R.done || scan) return;
      const p = toSvg(e.clientX, e.clientY);
      ring.setAttribute('cx', p.x); ring.setAttribute('cy', p.y); ring.setAttribute('r', ringR()); ring.style.display = '';
      const hit = hitAt(p);
      if (hit) onFound(hit, 'point'); else onMiss();
    });
    screen.querySelector('[data-go=hint]').onclick = () => giveHint(true);
    screen.querySelector('[data-go=next]').onclick = () => pass(false);
    if (typing) {
      $('.typebox', screen).onsubmit = e => {
        e.preventDefault();
        const inp = $('.typebox input', screen), v = inp.value;
        const p = typed(v);
        if (p) { inp.value = ''; onFound(p, 'type'); } else if (v.trim()) { onMiss(); toast(t('notThere')); }
      };
    }
    // keys and switches
    R.keys = e => onKey(e, scan);
    window.addEventListener('keydown', R.keys);
    R.tick = setInterval(tick, 500);
    if (S.params.timer) R.limit = (S.params.level >= 5 ? 60 : 90) * 1000;
    if (scan) { startScan(); findBox.focus({ preventScroll: true }); }
    const title = (pic.title && (pic.title[lang] || pic.title.en)) || '';
    sayAll(first ? [t('letsPlay'), t('findIntro', { title })] : [t('nextPicture'), t('findIntro', { title })]);
  }

  function el2(name, attrs) {
    const n = document.createElementNS(SVGNS, name);
    Object.keys(attrs || {}).forEach(k => n.setAttribute(k, attrs[k]));
    return n;
  }
  function toSvg(x, y) {
    const svg = R.right.svg, pt = svg.createSVGPoint();
    pt.x = x; pt.y = y;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }
  function pxToUnits(px) { const m = R.right.svg.getScreenCTM(); return m ? px / m.a : px; }
  function ringR() { return Math.max(R.scale * S.params.tolerance, pxToUnits(14)); }

  /** A part's box in picture units (measured on the complete picture on the left). */
  function boxOf(id) {
    const n = R.left.parts[id], svg = R.left.svg;
    const r = n.getBoundingClientRect(), m = svg.getScreenCTM().inverse();
    const a = svg.createSVGPoint(), b = svg.createSVGPoint();
    a.x = r.left; a.y = r.top; b.x = r.right; b.y = r.bottom;
    const p = a.matrixTransform(m), q = b.matrixTransform(m);
    return { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y) };
  }

  /** The missing part at this point of the picture (within the level's tolerance), nearest first; null if none. */
  function hitAt(p) {
    const tol = R.scale * S.params.tolerance;
    const lsvg = R.left.svg, lm = lsvg.getScreenCTM();
    const screen = lsvg.createSVGPoint();
    screen.x = p.x; screen.y = p.y;
    const sp = screen.matrixTransform(lm);
    let best = null, bestD = Infinity;
    for (const part of R.todo) {
      const g = R.left.parts[part.id];
      if (!g) continue;
      const shapes = [g].concat(Array.from(g.querySelectorAll('*'))).filter(n => typeof n.getBBox === 'function' && n.tagName !== 'g' && n.tagName !== 'tspan');
      let d = Infinity;
      for (const s of shapes) {
        let local;
        try { local = sp.matrixTransform(s.getScreenCTM().inverse()); } catch (e) { continue; }
        const pt = lsvg.createSVGPoint(); pt.x = local.x; pt.y = local.y;
        let inside = false;
        try { inside = (s.isPointInFill && s.isPointInFill(pt)) || (s.isPointInStroke && s.isPointInStroke(pt)); } catch (e) { inside = false; }
        if (inside) { d = 0; break; }
        const b = s.getBBox();
        const dx = Math.max(b.x - local.x, 0, local.x - (b.x + b.width)), dy = Math.max(b.y - local.y, 0, local.y - (b.y + b.height));
        d = Math.min(d, Math.hypot(dx, dy));
      }
      if (d <= tol && d < bestD) { best = part; bestD = d; }
    }
    return best;
  }

  /** For the keyboard and switch: the missing part that covers most of this area. */
  function hitArea(a) {
    let best = null, bestA = 0;
    for (const part of R.todo) {
      const b = boxOf(part.id);
      const pad = R.scale * S.params.tolerance * 0.5;
      const w = Math.min(a.x + a.w, b.x + b.w + pad) - Math.max(a.x, b.x - pad), h = Math.min(a.y + a.h, b.y + b.h + pad) - Math.max(a.y, b.y - pad);
      if (w > 0 && h > 0 && w * h > bestA) { best = part; bestA = w * h; }
    }
    return best;
  }

  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036F]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  function lev(a, b) {
    const m = [];
    for (let i = 0; i <= a.length; i++) { m[i] = [i]; }
    for (let j = 1; j <= b.length; j++) m[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return m[a.length][b.length];
  }
  function typed(v) {
    const w = norm(v);
    if (!w) return null;
    return R.todo.find(p => [p.name && p.name[lang], p.name && p.name.en, p.kind].filter(Boolean).map(norm).some(n => n === w || (w.length >= 4 && lev(n, w) <= 1) || (n.split(' ').length > 1 && n.split(' ').pop() === w)));
  }

  function partName(p) { return (p.name && (p.name[lang] || p.name.en)) || p.kind || p.id; }

  function renderHead() {
    const head = $('.ghead');
    if (!head || !R) return;
    const k = R.hidden.length;
    $('.count', head).textContent = Number(S.player.settings && S.player.settings.minutes) > 0 ? t('pictureOnly', { i: S.done + 1 }) : t('pictureN', { i: S.done + 1, n: S.params.pictures });
    const chips = R.found.map(f => '<span class="chip found">\u2714 ' + esc(cap(partName(f.part))) + '</span>').join('')
      + '<span class="chip">' + esc(t('foundOf', { n: R.found.length, k })) + '</span>';
    $('.chips', head).innerHTML = chips;
    $('.stars b', head).textContent = String(S.stars);
  }

  function showPart(part, how) {
    const n = R.right.parts[part.id];
    if (n) { n.classList.remove('part-hidden'); if (!reduced) n.classList.add('part-back'); }
    const b = boxOf(part.id), pad = 6 * R.scale;
    R.overlay.appendChild(el2('rect', { class: 'found-mark', x: b.x - pad, y: b.y - pad, width: b.w + 2 * pad, height: b.h + 2 * pad, rx: 8 * R.scale, 'stroke-width': 3 * R.scale }));
    const label = cap(partName(part)), fs = 20 * R.scale;
    const g = el2('g', { class: 'tag' });
    const w = (label.length * 0.62 + 1.2) * fs, h = fs * 1.6;
    let x = b.x + b.w / 2 - w / 2, y = b.y - pad - h - 4 * R.scale;
    x = Math.max(R.vb[0] + 2, Math.min(x, R.vb[0] + R.vb[2] - w - 2));
    if (y < R.vb[1] + 2) y = b.y + b.h + pad + 4 * R.scale;
    g.appendChild(el2('rect', { x, y, width: w, height: h, rx: h / 2, 'stroke-width': 2.5 * R.scale }));
    const tx = el2('text', { x: x + w / 2, y: y + h * 0.7, 'font-size': fs, 'text-anchor': 'middle' });
    tx.textContent = label;
    g.appendChild(tx);
    R.overlay.appendChild(g);
    if (how !== 'pass') setTimeout(() => { if (g.isConnected) g.remove(); }, 2600);
  }

  function clearHints() { $$('.hint1, .hint2, .hint-arrow', R.overlay).forEach(n => n.remove()); }

  function onFound(part, how) {
    if (!R || R.done) return;
    const now = Date.now();
    R.todo = R.todo.filter(p => p !== part);
    R.found.push({ part, ms: now - R.lastFind, hint: R.hintStage[part.id] || 0, how });
    R.lastFind = now;
    S.stars++; S.found++;
    clearHints();
    showPart(part, how);
    sounds.found();
    say(cap(partName(part)));
    renderHead();
    if (!R.todo.length) finish(false);
  }

  function onMiss() {
    if (!R || R.done) return;
    R.misses++;
    sounds.miss();
    const box = $('.find .pic');
    if (box && !reduced) { box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake'); }
  }

  function tick() {
    if (!R || R.done) return;
    const since = (Date.now() - R.lastFind) / 1000, h = S.params.hints || [0, 0, 0];
    if (h[0] > 0 && R.todo.length) {
      const target = R.todo[0];
      const stage = since >= h[2] ? 3 : since >= h[1] ? 2 : since >= h[0] ? 1 : 0;
      if (stage > (R.hintStage[target.id] || 0)) showHint(target, stage);
    }
    if (R.limit) {
      const left = Math.max(0, R.limit - (Date.now() - R.started));
      const bar = $('.timer i');
      if (bar) bar.style.transform = 'scaleX(' + (left / R.limit) + ')';
      if (left <= 0) pass(true);
    }
  }
  function giveHint() {
    if (!R || R.done || !R.todo.length) return;
    const target = R.todo[0];
    showHint(target, Math.min(3, (R.hintStage[target.id] || 0) + 1));
  }
  function showHint(part, stage) {
    R.hintStage[part.id] = stage;
    clearHints();
    const b = boxOf(part.id), cx = b.x + b.w / 2, cy = b.y + b.h / 2, r = Math.max(b.w, b.h) / 2 + 14 * R.scale;
    R.overlay.insertBefore(el2('circle', { class: stage >= 2 ? 'hint2' : 'hint1', cx, cy, r, 'stroke-width': 3 * R.scale }), R.overlay.firstChild);
    if (stage >= 3) {
      const s = 16 * R.scale, top = Math.max(R.vb[1] + 2 * s, cy - r - 4 * R.scale);
      R.overlay.appendChild(el2('path', { class: 'hint-arrow', d: `M${cx},${top} l${-s},${-1.6 * s} h${s * 0.6} v${-1.4 * s} h${s * 0.8} v${1.4 * s} h${s * 0.6} Z`, 'stroke-width': 2 * R.scale }));
      say(t('lookHere'));
    }
  }

  function pass(timeUp) {
    if (!R || R.done) return;
    R.done = true;
    clearHints();
    const rest = R.todo.slice();
    R.passed = true;
    const names = [];
    rest.forEach((p, i) => setTimeout(() => { if (R) showPart(p, 'pass'); }, reduced ? 0 : 500 * i));
    rest.forEach(p => names.push(cap(partName(p))));
    const me = R;
    sayAll([timeUp ? t('timeUp') : t('showAnswers')].concat(names), () => setTimeout(() => saveRound(me, true), 900));
    setTimeout(() => saveRound(me, true), (voiceOn() ? 20000 : 1500) + 500 * rest.length);
  }

  function finish() {
    R.done = true;
    const bonus = R.found.every(f => f.hint === 0) ? 1 : 0;
    S.stars += bonus;
    renderHead();
    sounds.cheer();
    confetti();
    const n = R.found.length + bonus;
    const c = document.createElement('div');
    c.className = 'cheer';
    c.innerHTML = '<div class="box"><div class="st" aria-hidden="true">' + '\u2B50'.repeat(Math.min(7, n)) + '</div><div class="big">' + esc(t('wellDone').split('!')[0] + '!') + '</div></div>';
    document.body.appendChild(c);
    const me = R;
    say(t('wellDone'), () => setTimeout(() => saveRound(me, false), 600));
    setTimeout(() => saveRound(me, false), voiceOn() ? 6000 : 2400);
  }

  function saveRound(me, passed) {
    if (!R || R !== me || R.saved) return;
    R.saved = true;
    const body = { session: S.session, id: R.id, picture: R.pic.id, version: R.pic.version || 1, hidden: R.hidden, started: R.started, passed: !!passed,
      misses: R.misses, found: R.found.map(f => ({ part: f.part.id, ms: f.ms, hint: f.hint, how: f.how })) };
    Outbox.send({ path: '/api/missing/round', body, json: true });
    S.done++;
    $$('.cheer').forEach(n => n.remove());
    nextPicture(false);
  }

  function confetti() {
    if (reduced) return;
    const fx = $('#fx');
    for (let i = 0; i < 24; i++) {
      const s = document.createElement('i');
      s.textContent = ['\u2B50', '\u2728', '\u{1F31F}'][i % 3];
      s.style.left = (Math.random() * 100) + 'vw';
      s.style.animationDelay = (Math.random() * 0.6) + 's';
      fx.appendChild(s);
      setTimeout(() => s.remove(), 3200);
    }
  }

  // ---------------------------------------------------------------- keyboard and one switch
  function grid() { return S.params.level <= 2 ? 3 : 5; }
  function area(i, n, within) {
    const W = within || { x: R.vb[0], y: R.vb[1], w: R.vb[2], h: R.vb[3] };
    const c = i % n, r = Math.floor(i / n);
    return { x: W.x + W.w * c / n, y: W.y + W.h * r / n, w: W.w / n, h: W.h / n };
  }
  function drawFocus(a) {
    let f = $('.focus-box', R.overlay);
    if (!f) { f = el2('rect', { class: 'focus-box' }); R.overlay.appendChild(f); }
    f.setAttribute('x', a.x); f.setAttribute('y', a.y); f.setAttribute('width', a.w); f.setAttribute('height', a.h);
    f.setAttribute('stroke-width', 4 * R.scale); f.setAttribute('rx', 6 * R.scale);
  }
  function selectArea(a, how) {
    const hit = hitArea(a);
    if (hit) onFound(hit, how); else onMiss();
  }
  function onKey(e, scan) {
    if (!R || R.done) return;
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    const k = e.key;
    if (k === 'n' || k === 'N') { e.preventDefault(); return pass(false); }
    if (k === 'h' || k === 'H') { e.preventDefault(); return giveHint(); }
    if (scan) {
      if (k === ' ' || k === 'Enter') { e.preventDefault(); scanSelect(); }
      return;
    }
    const n = grid();
    const box = $('.find .pic'), ae = document.activeElement;
    const onBox = !ae || ae === document.body || (box && box.contains(ae));
    if (/^Arrow/.test(k)) {
      e.preventDefault();
      if (box && !onBox) box.focus({ preventScroll: true });
      if (R.focus < 0) R.focus = Math.floor(n * n / 2);
      else {
        const c = R.focus % n, r = Math.floor(R.focus / n);
        if (k === 'ArrowLeft') R.focus = r * n + Math.max(0, c - 1);
        if (k === 'ArrowRight') R.focus = r * n + Math.min(n - 1, c + 1);
        if (k === 'ArrowUp') R.focus = Math.max(0, r - 1) * n + c;
        if (k === 'ArrowDown') R.focus = Math.min(n - 1, r + 1) * n + c;
      }
      drawFocus(area(R.focus, n));
    } else if ((k === 'Enter' || k === ' ') && R.focus >= 0 && onBox) {
      e.preventDefault();
      selectArea(area(R.focus, grid()), 'key');
    }
  }
  // automatic scanning: areas light up in turn; the switch (Space, Enter, a click or a tap) picks one; a second pass narrows it
  function startScan() {
    const speed = Math.max(800, Number(S.player.settings && S.player.settings.scanSpeed) || 2000);
    R.scanPass = 0; R.scanRegion = null; R.scanI = -1;
    const step = () => {
      if (!R || R.done) return;
      const n = R.scanPass === 0 ? 3 : 2;
      R.scanI = (R.scanI + 1) % (n * n);
      drawFocus(area(R.scanI, n, R.scanRegion));
      R.scanTimer = setTimeout(step, speed);
    };
    step();
    const box = $('.find .pic');
    box.addEventListener('pointerup', e => { e.preventDefault(); scanSelect(); });
  }
  function scanSelect() {
    if (!R || R.done || R.scanI < 0) return;
    const n = R.scanPass === 0 ? 3 : 2;
    const a = area(R.scanI, n, R.scanRegion);
    if (R.scanPass === 0 && S.params.level >= 3) { R.scanPass = 1; R.scanRegion = a; R.scanI = -1; return; }
    selectArea(a, 'switch');
    R.scanPass = 0; R.scanRegion = null; R.scanI = -1;
  }

  // ---------------------------------------------------------------- start
  async function boot() {
    setMuted(muted);
    translatePage();
    const code = (location.hash.match(/[#&]mq=([A-Za-z0-9_-]{20,})/) || [])[1];
    if (code) {
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* old browser */ }
      mount('<p class="lead" data-t="signingIn"></p>', 'center');
      try {
        const d = await api('POST', '/api/missing/signin', { code });
        token = d.token; store.set('missing.token', token);
      } catch (e) { return showSignIn(e.message); }
    }
    if (!token) return showSignIn();
    Outbox.flush();
    showPlayers();
  }
  window.addEventListener('online', () => Outbox.flush());
  boot();
})();
