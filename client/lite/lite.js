// Vistr Lite - the screens. The rules are in core.js (and tested in test/lite.test.js).
(function () {
  'use strict';
  const E = window.VistrEngine, C = window.LiteCore;
  const $ = id => document.getElementById(id);
  const KEY = 'vistrlite.settings.v1';
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- settings (kept on this device) ----------
  const DEFAULTS = { mode: 'players', count: 2, names: ['', '', '', ''], len: 5, intensity: 'learner', lang: 'en', turnSecs: 30, turnsEach: 5, pin: '', classroom: false };
  let cfg = Object.assign({}, DEFAULTS);
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* private window: defaults */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ } };

  // ---------- word lists (same files as Vistr) ----------
  const lists = {};
  async function loadDict(L, lang) {
    const d = lists[lang] = lists[lang] || { words: {}, starts: {}, common: {}, easy: {}, pools: {}, blocked: null };
    if (d.words[L]) return d;
    const base = lang === 'en' ? '/words/' : '/words/' + lang + '/';
    const get = f => fetch(base + f).then(r => { if (!r.ok) throw new Error('Could not load the word list. Check the internet connection.'); return r.text(); });
    const opt = f => get(f).catch(() => '');
    const [w, st, common, easy, blocked] = await Promise.all([get('words_' + L + '.txt'), get('start_' + L + '.txt'), opt('common_' + L + '.txt'), opt('easy_' + L + '.txt'), d.blocked ? null : opt('blocked.txt')]);
    const lines = t => t.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const set = new Set(lines(w)); set.alphabet = E.LANGS[lang].alphabet;
    d.words[L] = set; d.starts[L] = lines(st);
    d.common[L] = common ? new Set(lines(common)) : null; d.easy[L] = easy ? new Set(lines(easy)) : null;
    if (blocked !== null) d.blocked = new Set(lines(blocked || ''));
    return d;
  }
  function picker(d, L, intensity) {
    const opts = { blocked: d.blocked, common: d.common[L], easy: d.easy[L], intensity };
    const key = L + ':' + intensity;
    if (!d.pools[key]) d.pools[key] = E.poolFor(d.starts[L], opts, d.words[L]);
    return () => E.pickStart(d.words[L], d.pools[key], opts);
  }

  // ---------- setup screen ----------
  function seg(id, options, get, set) {
    const box = $(id); box.textContent = '';
    options.forEach(([val, label]) => {
      const b = el('button', get() === val ? 'on' : '', esc(label)); b.type = 'button';
      b.onclick = () => { set(val); save(); drawSetup(); };
      box.appendChild(b);
    });
  }
  function fmt(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function drawSetup() {
    const c = C.settings(cfg), team = c.mode === 'teams';
    $('swClass').setAttribute('aria-checked', String(!!cfg.classroom));
    seg('segMode', [['players', 'Players'], ['teams', 'Teams']], () => c.mode, v => { cfg.mode = v; if (v === 'teams' && C.settings(cfg).count < 2) cfg.count = 2; });
    $('lblCount').textContent = team ? 'How many teams' : 'How many players';
    seg('segCount', [1, 2, 3, 4].map(n => [n, String(n)]), () => c.count, v => { cfg.count = v; if (v === 1) cfg.mode = 'players'; });
    const names = $('names'); names.textContent = '';
    for (let i = 0; i < c.count; i++) {
      const inp = el('input'); inp.type = 'text'; inp.maxLength = 14; inp.value = cfg.names[i] || '';
      inp.placeholder = (team ? 'Team ' : 'Player ') + 'ABCD'[i]; inp.style.setProperty('--c', C.COLORS[i]);
      inp.setAttribute('aria-label', 'Name ' + (i + 1));
      inp.oninput = () => { cfg.names[i] = inp.value; save(); };
      names.appendChild(inp);
    }
    seg('segLen', [4, 5, 6, 7].map(n => [n, n + ' letters']), () => c.len, v => { cfg.len = v; });
    seg('segLevel', [['learner', 'Learner'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced']], () => c.intensity, v => { cfg.intensity = v; });
    seg('segSecs', [20, 30, 45, 60].map(n => [n, n + ' s']), () => c.turnSecs, v => { cfg.turnSecs = v; });
    seg('segTurns', [3, 4, 5, 6].map(n => [n, String(n)]), () => c.turnsEach, v => { cfg.turnsEach = v; });
    $('inPin').value = cfg.pin || '';
    $('roundInfo').textContent = c.count + (team ? ' teams' : c.count === 1 ? ' player' : ' players') + ' x ' + c.turnsEach + ' turns x ' + c.turnSecs + ' s = about ' + fmt(C.roundSeconds(c));
  }
  (function fillLangs() {
    const s = $('selLang');
    E.LANG_CODES.forEach(l => { const o = el('option', '', esc(E.LANGS[l].name)); o.value = l; s.appendChild(o); });
    s.value = E.langOf(cfg.lang);
    s.onchange = () => { cfg.lang = s.value; save(); };
  })();
  $('swClass').onclick = () => { cfg.classroom = !cfg.classroom; save(); drawSetup(); };
  $('inPin').oninput = e => { cfg.pin = e.target.value.replace(/\D/g, '').slice(0, 6); e.target.value = cfg.pin; save(); drawSetup(); };

  // ---------- the game ----------
  let G = null, timer = null, toastT = null, resultsT = null, refs = [], focus = -1, wake = null, lastLockMsg = 0;

  function show(which) {
    ['setup', 'play', 'results'].forEach(id => { $(id).hidden = id !== which; });
    if (which !== 'results') { const ad = $('adSlot2'); ad.textContent = ''; ad.hidden = true; }
    document.body.classList.toggle('classroom', which === 'play' && !!(G && G.cfg.classroom));
  }
  function say(text, kind) {
    const t = $('toast'); t.textContent = text; t.className = 'toast show ' + (kind || '');
    clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'toast'; }, 2200);
  }
  function setMsg(t) { $('setupMsg').textContent = t || ''; }
  function tryFullscreen() { try { const d = document.documentElement; if (!document.fullscreenElement && d.requestFullscreen) d.requestFullscreen().catch(() => {}); } catch (e) { /* ignore */ } }
  function leaveFullscreen() { try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {}); } catch (e) { /* ignore */ } }
  async function keepAwake(on) { try { if (on && navigator.wakeLock) wake = await navigator.wakeLock.request('screen'); else if (wake) { wake.release(); wake = null; } } catch (e) { /* ignore */ } }

  async function startGame() {
    if (adsLoaded) {   // an ad script was loaded on the results page: start from a clean page so no ad can appear during play
      try { sessionStorage.setItem('vistrlite.autostart', '1'); } catch (e) { /* ignore */ }
      location.reload(); return;
    }
    const c = C.settings(cfg);
    setMsg('Getting the words ready...');
    let d;
    try { d = await loadDict(c.len, c.lang); } catch (e) { setMsg(e.message); say(e.message, 'bad'); return; }
    setMsg('');
    clearTimeout(resultsT);
    try { G = C.newGame(c, E, d.words[c.len], picker(d, c.len, c.intensity), Date.now()); } catch (e) { setMsg(e.message); return; }
    show('play'); buildDrums(); focus = -1;
    $('play').className = 'screen play ' + (c.count > 2 ? 'multi' : c.count === 2 ? 'n2' : 'n1');
    $('overlay').hidden = true; $('toast').className = 'toast';
    renderAll(); clearInterval(timer); timer = setInterval(frame, 200);
    keepAwake(true);
  }
  function toSetup() {
    clearInterval(timer); clearTimeout(resultsT); G = null; keepAwake(false); leaveFullscreen();
    show('setup'); drawSetup(); closeModal();
  }

  // ---------- drums (the scrollers) ----------
  const alphabet = () => [...(G.dict.alphabet || E.LANGS.en.alphabet)];
  function buildDrums() {
    const box = $('drums'); box.textContent = ''; refs = [];
    G.draft.forEach((_, i) => {
      const root = el('div', 'drum'), up = el('button', 'nudge', '&#9650;'), down = el('button', 'nudge', '&#9660;'), face = el('div', 'face');
      up.type = down.type = 'button'; up.tabIndex = down.tabIndex = -1;
      up.setAttribute('aria-label', 'Letter ' + (i + 1) + ': previous'); down.setAttribute('aria-label', 'Letter ' + (i + 1) + ': next');
      face.setAttribute('role', 'spinbutton');
      const p = el('span', 'dim'), c = el('span'), n = el('span', 'dim'), pad = el('div', 'pad'); pad.hidden = true;
      face.append(pad, p, c, n); root.append(up, face, down); box.appendChild(root);
      up.onclick = () => doRoll(i, -1); down.onclick = () => doRoll(i, 1);
      let drag = null;
      face.addEventListener('pointerdown', e => { drag = { y: e.clientY, moved: false, h: face.getBoundingClientRect() }; try { face.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } });
      face.addEventListener('pointermove', e => {
        if (!drag) return;
        const step = Math.max(34, drag.h.height / 4);
        let dy = drag.y - e.clientY;
        while (Math.abs(dy) >= step) { const dir = dy > 0 ? 1 : -1; drag.moved = true; doRoll(i, dir); drag.y -= dir * step; dy = drag.y - e.clientY; }
      });
      const end = e => {
        if (!drag) return;
        if (!drag.moved && e.type === 'pointerup') {   // a tap: top third = previous letter, bottom third = next; the middle does nothing
          const f = (e.clientY - drag.h.top) / drag.h.height;
          if (f < 0.33) doRoll(i, -1); else if (f > 0.67) doRoll(i, 1);
        }
        drag = null;
      };
      face.addEventListener('pointerup', end); face.addEventListener('pointercancel', end);
      let wheelAt = 0;
      face.addEventListener('wheel', e => { e.preventDefault(); const t = Date.now(); if (t - wheelAt < 110) return; wheelAt = t; doRoll(i, e.deltaY > 0 ? 1 : -1); }, { passive: false });
      refs.push({ root, p, c, n, pad });
    });
  }
  function doRoll(slot, dir) {
    if (!G) return;
    const r = C.roll(G, slot, dir);
    if (!r.ok) {
      const now = Date.now();
      if (r.locked && now - lastLockMsg > 1500) { lastLockMsg = now; say(r.why, 'bad'); }
      return;
    }
    $('drums').classList.remove('good', 'bad');
    updateDrums(); refs[slot].root.classList.add('bump'); setTimeout(() => refs[slot] && refs[slot].root.classList.remove('bump'), 170);
  }
  function updateDrums() {
    if (!G) return;
    const AB = alphabet(), n = AB.length, st = C.drumStates(G), team = G.team;
    refs.forEach((r, i) => {
      const k = AB.indexOf(G.draft[i]);
      r.p.textContent = AB[(k - 1 + n) % n]; r.c.textContent = G.draft[i]; r.n.textContent = AB[(k + 1) % n];
      r.root.className = 'drum' + (st[i] !== 'free' ? ' ' + st[i] : '') + (focus === i ? ' focus' : '');
      r.pad.hidden = st[i] === 'free';
      r.pad.innerHTML = st[i] === 'fixed' ? '&#128274;<small>1st - fixed</small>' : st[i] === 'active' ? '2nd - rolling' : st[i] === 'locked' ? '&#128274;' : '';
      r.root.querySelector('.face').setAttribute('aria-valuetext', G.draft[i].toUpperCase());
    });
    $('bProcess').disabled = !(G.status === 'play' && !G.paused && C.changed(G).length);
    void team;
  }

  // ---------- the ribbon, scores and chain ----------
  function renderUnits() {
    const g = G, n = g.units.length, on = i => (g.status === 'play' && i === g.turn);
    const A = $('ribA'), B = $('ribB'), L = $('colL'), R = $('colR'), strip = $('strip');
    A.textContent = ''; B.textContent = ''; L.textContent = ''; R.textContent = ''; strip.textContent = '';
    if (n <= 2) {
      [A, B].forEach((slot, i) => { const u = g.units[i]; if (!u) return; slot.appendChild(el('div', 'blk' + (on(i) ? ' on' : ''), '<span class="nm">' + esc(u.name) + '</span>' + (n === 1 ? '<small class="prog">' + Math.min(g.turnNo + 1, g.total) + '/' + g.total + '</small>' : '') + '<b>' + String(u.score).padStart(2, '0') + '</b>')).style.setProperty('--c', u.color); });
    } else {
      const t = el('div', 'blk turn', '<span class="nm">Turn: ' + esc(g.units[g.turn].name) + '</span><b id="turnSecs">0</b>');
      A.appendChild(t);
      g.units.forEach((u, i) => {
        const l = el('div', 'cell' + (on(i) ? ' on' : ''), esc(u.name)), r = el('div', 'cell sc' + (on(i) ? ' on' : ''), String(u.score).padStart(2, '0'));
        l.style.setProperty('--c', u.color); r.style.setProperty('--c', u.color); L.appendChild(l); R.appendChild(r);
        const chip = el('div', 'chip' + (on(i) ? ' on' : ''), '<span>' + esc(u.name) + '</span><b>' + String(u.score).padStart(2, '0') + '</b>'); chip.style.setProperty('--c', u.color); strip.appendChild(chip);
      });
    }
    const ch = $('chain'); ch.textContent = '';
    g.chain.slice(-16).forEach(w => { const li = el('li', w.valid ? '' : 'bad', esc(w.word)); if (w.unit !== undefined) li.style.setProperty('--c', g.units[w.unit].color); ch.appendChild(li); });
  }
  function renderAll() { renderUnits(); updateDrums(); frame(); }
  function frame() {
    if (!G) return;
    const now = Date.now(), ev = C.tick(G, now);
    if (ev) { say(ev.message, 'bad'); $('drums').classList.remove('good'); renderAll(); if (G.status === 'over') scheduleResults(); return; }
    const left = C.msLeft(G, now), secs = Math.ceil(left / 1000), n = G.units.length;
    const roundMs = left + Math.max(0, G.total - G.turnNo - 1) * G.cfg.turnSecs * 1000;
    $('clock').textContent = n <= 2 ? fmt(secs) : fmt(Math.ceil(roundMs / 1000));
    $('clock').classList.toggle('low', n <= 2 && secs <= 5 && G.status === 'play');
    const ts = $('turnSecs'); if (ts) ts.textContent = String(secs);
    const fill = $('tbarFill'); fill.style.width = (G.status === 'play' ? Math.min(100, left / (G.cfg.turnSecs * 10)) : 0) + '%'; fill.classList.toggle('low', secs <= 5);
  }

  function onProcess() {
    if (!G) return;
    const r = C.processMove(G, Date.now());
    if (!r) return;
    const kind = r.outcome === 'valid' ? 'good' : 'bad';
    say(r.message, kind);
    const dr = $('drums'); dr.classList.remove('good', 'bad'); dr.classList.add(kind === 'good' ? 'good' : 'bad'); setTimeout(() => dr.classList.remove('good', 'bad'), 700);
    if (navigator.vibrate) navigator.vibrate(r.outcome === 'valid' ? 40 : [30, 40, 30]);
    renderAll();
    if (G.status === 'over') scheduleResults();
  }

  // ---------- Google ads (AdSense): only on the page that appears when a game ends ----------
  const ADS = window.LITE_ADS || {};
  let adsLoaded = false;
  function showAds() {
    const box = $('adSlot2'); box.textContent = '';
    if (!ADS.enabled || !/^ca-pub-\d+$/.test(ADS.client || '')) { box.hidden = true; return; }
    box.hidden = false;
    try {
      window.adsbygoogle = window.adsbygoogle || [];
      window.adsbygoogle.requestNonPersonalizedAds = 1;               // classrooms: no personalised ads
      if (!adsLoaded) {
        const sc = document.createElement('script');
        sc.async = true; sc.crossOrigin = 'anonymous';
        sc.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + ADS.client;
        document.head.appendChild(sc); adsLoaded = true;
      }
      if (/^\d{6,15}$/.test(ADS.slot || '')) {
        const ins = el('ins', 'adsbygoogle'); ins.style.display = 'block';
        ins.setAttribute('data-ad-client', ADS.client); ins.setAttribute('data-ad-slot', ADS.slot);
        ins.setAttribute('data-ad-format', 'auto'); ins.setAttribute('data-full-width-responsive', 'true');
        ins.setAttribute('data-tag-for-age-treatment', '1');          // treat as directed at children
        box.appendChild(ins); window.adsbygoogle.push({});
      }
    } catch (e) { box.hidden = true; }
  }
  // The best solo score on this device, per word length, level and turn length.
  function bestScore(c, score) {
    const key = 'vistrlite.best.' + [c.len, c.intensity, c.turnSecs, c.turnsEach, c.lang].join('.');
    let old = null;
    try { old = Number(localStorage.getItem(key)); if (!Number.isFinite(old) || localStorage.getItem(key) === null) old = null; } catch (e) { old = null; }
    const isNew = old === null || score > old;
    if (isNew) { try { localStorage.setItem(key, String(score)); } catch (e) { /* ignore */ } }
    return { isNew: isNew && old !== null ? true : false, value: isNew ? score : old };
  }

  // ---------- results ----------
  function scheduleResults() { clearTimeout(resultsT); resultsT = setTimeout(showResults, 1800); }
  function showResults() {
    if (!G || G.status !== 'over') return;
    const res = G.result, u = G.units;
    let title, note;
    if (u.length === 1) {
      const best = bestScore(G.cfg, u[0].score);
      title = 'Well played!';
      note = u[0].name + ': ' + u[0].score + ' point' + (u[0].score === 1 ? '' : 's') + ', ' + u[0].words + ' word' + (u[0].words === 1 ? '' : 's') + '. ' + (best.isNew ? 'A new best score!' : 'Best so far: ' + best.value + '.');
    } else if (res.reason === 'forfeit') {
      title = (res.winners.length === 1 ? u[res.winners[0]].name : 'The others') + ' win' + (res.winners.length === 1 ? 's' : '') + '!';
      note = u[res.forfeit].name + ' pressed Reset before the game was over, so they lose.';
    } else {
      title = res.winners.length === 1 ? u[res.winners[0]].name + ' win' + 's!' : "It's a tie!";
      note = 'All turns are played.';
    }
    $('resTitle').textContent = title; $('resNote').textContent = note;
    const list = $('resList'); list.textContent = '';
    res.ranking.forEach(r => {
      const x = u[r.idx], li = el('li', res.winners.includes(r.idx) ? 'win' : '', '<span>' + r.rank + '.</span> <span>' + esc(x.name) + (x.gaveUp ? ' <small>(pressed Reset)</small>' : '') + '<br><small>' + x.words + ' word' + (x.words === 1 ? '' : 's') + '</small></span><b>' + x.score + '</b>');
      li.style.setProperty('--c', x.color); list.appendChild(li);
    });
    show('results'); leaveFullscreen(); keepAwake(false); showAds();
  }
  $('bAgain').onclick = () => { if (cfg.classroom) tryFullscreen(); startGame(); };
  $('bSettings').onclick = toSetup;

  // ---------- pop-ups: Reset, Return, teacher PIN ----------
  let heldClock = false;
  function holdClock() { heldClock = false; if (G && G.status === 'play' && !G.paused) { C.pause(G, Date.now()); heldClock = true; } }
  function releaseClock() { if (G && heldClock) { C.resume(G, Date.now()); } heldClock = false; }
  function closeModal() { $('modal').hidden = true; $('mPin').value = ''; $('mErr').textContent = ''; }
  function dialog(o) {
    $('mTitle').textContent = o.title; $('mText').textContent = o.text || ''; $('mErr').textContent = '';
    const pin = $('mPin'); pin.hidden = !o.pin; pin.value = '';
    const box = $('mBtns'); box.textContent = '';
    o.buttons.forEach(b => {
      const btn = el('button', b.cls || '', esc(b.label)); btn.type = 'button'; btn.disabled = !!b.disabled;
      btn.onclick = () => { if (b.fn && b.fn(pin.value) === false) return; };
      box.appendChild(btn);
    });
    $('modal').hidden = false; if (o.pin) setTimeout(() => pin.focus(), 50);
    pin.onkeydown = e => { if (e.key === 'Enter') { const first = box.querySelector('button:not(.quiet)'); if (first) first.click(); } };
  }
  function askPin(title, text, onOk) {
    dialog({ title, text, pin: true, buttons: [
      { label: 'OK', fn: v => { if (G && C.pinOk(G.cfg, v)) { closeModal(); onOk(); return true; } $('mErr').textContent = 'That is not the teacher PIN.'; $('mPin').value = ''; $('mPin').classList.remove('shake'); void $('mPin').offsetWidth; $('mPin').classList.add('shake'); return false; } },
      { label: 'Cancel', cls: 'quiet', fn: () => { closeModal(); releaseClock(); } } ] });
  }
  $('bPause').onclick = () => { if (!G || G.status !== 'play') return; if (G.paused) return; C.pause(G, Date.now()); $('overlay').hidden = false; updateDrums(); };
  $('bResume').onclick = () => { if (!G) return; C.resume(G, Date.now()); $('overlay').hidden = true; updateDrums(); };
  $('bReturn').onclick = () => {
    if (!G) return;
    if (G.status === 'over') { toSetup(); return; }
    holdClock();
    if (G.units.length > 1 && G.cfg.pin) { askPin('Leave the game?', 'The game is not finished. Only the teacher can leave it: enter the teacher PIN.', toSetup); return; }
    dialog({ title: 'Leave the game?', text: 'The game is not finished and will be lost.', buttons: [{ label: 'Leave the game', cls: 'danger', fn: () => { closeModal(); toSetup(); } }, { label: 'Stay', cls: 'quiet', fn: () => { closeModal(); releaseClock(); } }] });
  };
  $('bReset').onclick = () => {
    if (!G) return;
    if (G.status === 'over') { startGame(); return; }        // the game is over: a new game, nobody loses
    holdClock();
    if (G.units.length === 1) {   // on your own there is nobody to lose to
      dialog({ title: 'Start again?', text: 'Your score so far will be lost.', buttons: [{ label: 'Start again', cls: 'danger', fn: () => { closeModal(); startGame(); } }, { label: 'Keep playing', cls: 'quiet', fn: () => { closeModal(); releaseClock(); } }] });
      return;
    }
    const hasPin = !!G.cfg.pin, buttons = [];
    G.units.forEach((u, i) => buttons.push({ label: u.name + ' pressed Reset - ' + u.name + ' loses', cls: 'danger', fn: () => { closeModal(); C.giveUp(G, i); renderAll(); showResults(); } }));
    buttons.push({ label: 'The game froze (teacher PIN)' + (hasPin ? '' : ' - set a PIN first'), disabled: !hasPin, fn: () => { closeModal(); askPin('The game froze', 'Teacher: enter the PIN to start this game again. Nobody loses.', () => { startGame(); }); } });
    buttons.push({ label: 'Class time is over (teacher PIN)' + (hasPin ? '' : ' - set a PIN first'), disabled: !hasPin, fn: () => { closeModal(); askPin('Class time is over', 'Teacher: enter the PIN to end this game. Nobody loses.', toSetup); } });
    buttons.push({ label: 'Cancel', cls: 'quiet', fn: () => { closeModal(); releaseClock(); } });
    dialog({ title: 'Reset the game?', text: 'Fair-game rule: the side that presses Reset before the game is over loses. Only a frozen screen or the end of the lesson is free, and the teacher confirms that with the PIN.', buttons });
  };

  $('bProcess').onclick = onProcess;
  $('bStart').onclick = () => { if (cfg.classroom) tryFullscreen(); startGame(); };
  document.addEventListener('keydown', e => {
    if (!G || $('play').hidden || !$('modal').hidden || e.target.tagName === 'INPUT') return;
    const n = G.draft.length;
    if (e.key === 'ArrowLeft') { focus = focus < 0 ? 0 : (focus + n - 1) % n; updateDrums(); }
    else if (e.key === 'ArrowRight') { focus = focus < 0 ? 0 : (focus + 1) % n; updateDrums(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (focus < 0) focus = 0; doRoll(focus, -1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (focus < 0) focus = 0; doRoll(focus, 1); }
    else if (e.key === 'Enter') { e.preventDefault(); onProcess(); }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && G && G.status === 'play') keepAwake(true); });

  drawSetup();
  try { if (sessionStorage.getItem('vistrlite.autostart')) { sessionStorage.removeItem('vistrlite.autostart'); startGame(); } } catch (e) { /* ignore */ }
})();
