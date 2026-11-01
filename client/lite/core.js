// Vistr Lite - the rules of a pass-and-play game on one screen (no server needed).
// Pure logic, no screen and no timers: the page calls tick(g, now) and the tests call it too.
// It uses the word-game engine (engine.js) for words, jackpots and scoring, so a word is worth
// the same here as in Vistr.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LiteCore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLORS = ['#a8e44a', '#ff5fa8', '#45c8f5', '#ffd23f'];
  const LIMITS = { minUnits: 2, maxUnits: 4, minTurns: 1, maxTurns: 10, minSecs: 10, maxSecs: 120 };

  const clamp = (v, lo, hi, d) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };

  // Cleans the settings the teacher chose.
  function settings(c = {}) {
    const mode = c.mode === 'teams' ? 'teams' : 'players';
    const count = clamp(c.count, LIMITS.minUnits, LIMITS.maxUnits, 2);
    const names = [];
    for (let i = 0; i < LIMITS.maxUnits; i++) {
      const fallback = (mode === 'teams' ? 'Team ' : 'Player ') + 'ABCD'[i];
      names.push(String((c.names || [])[i] || '').trim().slice(0, 14) || fallback);
    }
    return { mode, count, names, len: [4, 5, 6, 7].includes(Number(c.len)) ? Number(c.len) : 5,
      intensity: ['learner', 'intermediate', 'advanced'].includes(c.intensity) ? c.intensity : 'learner', lang: c.lang || 'en',
      turnSecs: clamp(c.turnSecs, LIMITS.minSecs, LIMITS.maxSecs, 30), turnsEach: clamp(c.turnsEach, LIMITS.minTurns, LIMITS.maxTurns, 5),
      pin: String(c.pin || '').replace(/\D/g, '').slice(0, 6), classroom: !!c.classroom };
  }
  const roundSeconds = c => c.count * c.turnsEach * c.turnSecs;

  function newGame(cfg, E, dict, pick, now) {
    const start = pick();
    const g = {
      cfg, E, dict, pick, team: cfg.mode === 'teams', slots: cfg.mode === 'teams' ? 2 : 1,
      units: Array.from({ length: cfg.count }, (_, i) => ({ name: cfg.names[i], color: COLORS[i], score: 0, streak: 0, words: 0, gaveUp: false })),
      current: start.word, used: [start.word], jackpots: [...start.jackpots], found: [],
      chain: [{ word: start.word, valid: true, start: true }],
      turnNo: 0, total: cfg.count * cfg.turnsEach, turn: 0, status: 'play', paused: false,
      remaining: cfg.turnSecs * 1000, endsAt: now + cfg.turnSecs * 1000,
      draft: [...start.word], touched: [], result: null,
    };
    return g;
  }

  const alphabet = g => g.dict.alphabet || g.E.LANGS[g.E.langOf(g.cfg.lang)].alphabet;
  const changed = g => g.draft.map((c, i) => (c !== g.current[i] ? i : -1)).filter(i => i >= 0);

  // What the drums look like right now: each is 'free', 'locked', 'fixed' (the first letter of a team move) or 'active'.
  function drumStates(g) {
    return g.draft.map((_, i) => {
      if (g.team) {
        if (g.touched.length < 2) return 'free';
        return i === g.touched[1] ? 'active' : i === g.touched[0] ? 'fixed' : 'locked';
      }
      const ch = changed(g);
      return !ch.length || ch[0] === i ? 'free' : 'locked';
    });
  }

  // Roll one drum one letter up (dir +1) or down (-1). Only a letter that really moves counts as a touch.
  function roll(g, slot, dir) {
    if (g.status !== 'play' || g.paused) return { ok: false, why: 'not playing' };
    if (!(slot >= 0 && slot < g.draft.length) || (dir !== 1 && dir !== -1)) return { ok: false, why: 'bad drum' };
    if (g.team) {
      if (g.touched.length === 2 && slot !== g.touched[1]) {
        return { ok: false, locked: true, why: 'Locked. Only letter ' + (g.touched[1] + 1) + ' can still be rolled.' };
      }
    } else {
      const ch = changed(g);
      if (ch.length && ch[0] !== slot) return { ok: false, locked: true, why: 'One letter per move. Roll letter ' + (ch[0] + 1) + ' back first.' };
    }
    const AB = alphabet(g), k = AB.indexOf(g.draft[slot]);
    g.draft[slot] = AB[(k + dir + AB.length * 2) % AB.length];
    if (g.team) {
      if (!g.touched.includes(slot) && g.touched.length < 2) g.touched.push(slot);   // the second drum touched locks the rest
    }
    return { ok: true };
  }

  function resetDraft(g) { g.draft = [...g.current]; g.touched = []; }

  function advance(g, now) {
    g.turnNo += 1;
    resetDraft(g);
    if (g.turnNo >= g.total) { finish(g, 'done'); return; }
    g.turn = g.turnNo % g.cfg.count;
    g.remaining = g.cfg.turnSecs * 1000;
    g.endsAt = now + g.remaining;
  }

  function scoreParts(g, word, prev, unit, isJackpot) {
    const E = g.E, L = g.cfg.lang, hot = E.LANGS[E.langOf(L)].hot || E.RULES.hotLetters;
    const parts = [{ label: E.msg(L, 'pWord'), points: E.RULES.word }];
    for (let i = 0; i < word.length; i++) {
      if (word[i] !== prev[i] && hot[word[i]]) parts.push({ label: E.msg(L, 'pHot', { L: word[i].toUpperCase() }), points: hot[word[i]], kind: 'hot' });
    }
    if (unit.streak >= E.RULES.streakFrom) parts.push({ label: E.msg(L, 'pStreak', { n: unit.streak }), points: E.RULES.streakBonus, kind: 'streak' });
    if (isJackpot) parts.push({ label: E.msg(L, 'pJackpot'), points: E.RULES.jackpot, kind: 'jackpot' });
    return parts;
  }

  // The player presses Process: judge the word, score it, pass the turn.
  function processMove(g, now) {
    if (g.status !== 'play' || g.paused) return null;
    const ch = changed(g);
    if (!ch.length) return null;
    const E = g.E, L = g.cfg.lang, unit = g.units[g.turn], word = g.draft.join(''), W = word.toUpperCase();
    if (g.used.includes(word)) {
      resetDraft(g);
      return { outcome: 'repeat', word, unit: g.turn, points: 0, message: E.msg(L, 'repeat', { W }) };
    }
    let res;
    if (g.dict.has(word)) {
      unit.streak += 1; unit.words += 1;
      const isJackpot = g.jackpots.includes(word) && !g.found.includes(word);
      const parts = scoreParts(g, word, g.current, unit, isJackpot);
      const points = parts.reduce((t, p) => t + p.points, 0);
      if (isJackpot) g.found.push(word);
      unit.score += points; g.current = word; g.used.push(word);
      g.chain.push({ word, valid: true, points, unit: g.turn });
      res = { outcome: 'valid', word, unit: g.turn, points, parts, jackpot: isJackpot, message: E.msg(L, isJackpot ? 'jackpot' : 'valid', { W, n: points }) };
      if (E.isDeadEnd(word, g.used, g.dict)) {
        const next = g.pick();
        g.current = next.word; g.used.push(next.word); g.jackpots = [...next.jackpots]; g.found = [];
        g.chain.push({ word: next.word, valid: true, fresh: true });
        res.fresh = next.word;
        res.message += E.msg(L, 'fresh', { W: next.word.toUpperCase() });
      }
    } else {
      const miss = E.INTENSITY[g.cfg.intensity].miss;
      unit.streak = 0; unit.score += miss;
      g.chain.push({ word, valid: false, points: miss, unit: g.turn });
      res = { outcome: 'invalid', word, unit: g.turn, points: miss, message: E.msg(L, miss ? 'missPen' : 'missFree', { W, n: Math.abs(miss) }) };
    }
    advance(g, now);
    return res;
  }

  // Called often by the page. Ends the turn when its time is up.
  function tick(g, now) {
    if (g.status !== 'play' || g.paused) return null;
    if (now < g.endsAt) return null;
    const who = g.turn;
    advance(g, now);
    return { outcome: 'timeout', unit: who, points: 0, message: g.units[who].name + ': time is up.' };
  }
  const msLeft = (g, now) => (g.status !== 'play' ? 0 : g.paused ? g.remaining : Math.max(0, g.endsAt - now));

  function pause(g, now) { if (g.status === 'play' && !g.paused) { g.remaining = Math.max(0, g.endsAt - now); g.paused = true; } }
  function resume(g, now) { if (g.status === 'play' && g.paused) { g.paused = false; g.endsAt = now + g.remaining; } }

  // Final order: a side that gave up is last; the rest by score (ties share a place).
  function finish(g, reason, forfeit) {
    g.status = 'over'; g.paused = false;
    const idx = g.units.map((_, i) => i);
    const score = i => g.units[i].score;
    const order = idx.filter(i => i !== forfeit).sort((a, b) => score(b) - score(a));
    if (forfeit !== undefined) { g.units[forfeit].gaveUp = true; order.push(forfeit); }
    const ranking = [];
    order.forEach((i, k) => {
      const prev = ranking[k - 1];
      const tie = prev && i !== forfeit && prev.idx !== forfeit && score(prev.idx) === score(i);
      ranking.push({ idx: i, rank: tie ? prev.rank : k + 1 });
    });
    const winners = ranking.filter(r => r.rank === 1).map(r => r.idx);
    g.result = { reason, forfeit: forfeit === undefined ? null : forfeit, ranking, winners };
    return g.result;
  }

  // Reset pressed before the game is over: the side that pressed it loses.
  function giveUp(g, who) {
    if (g.status !== 'play' || !(who >= 0 && who < g.units.length)) return null;
    return finish(g, 'forfeit', who);
  }

  const pinOk = (cfg, typed) => !!cfg.pin && String(typed || '').replace(/\D/g, '') === cfg.pin;

  return { COLORS, LIMITS, settings, roundSeconds, newGame, changed, drumStates, roll, resetDraft, processMove, tick, msLeft, pause, resume, giveUp, finish, pinOk };
}));
