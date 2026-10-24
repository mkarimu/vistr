// Vistr game engine: the rules, scoring and word logic, in one place.
// The app uses it for standalone (offline) games; the server uses the same file for
// live games, so both always score the same way. Tune the numbers in RULES.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VistrEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RULES = {
    round: 300,            // seconds per round (the server can override with ROUND_SECONDS)
    word: 1,               // every real word
    miss: -1,              // every non-word
    hotLetters: { j: 3, q: 3, x: 3, z: 3, k: 1, v: 1, w: 1, y: 1 }, // extra for rolling one in
    streakFrom: 3,         // from the 3rd real word in a row...
    streakBonus: 1,        // ...each one is worth this much extra
    jackpot: 10,           // hidden jackpot words
    jackpotsPerWord: 5,    // how many are hidden near each starting word
    maxSkips: 5,           // "Next word" uses per round; the last one ends the round
  };
  const A_Z = 'abcdefghijklmnopqrstuvwxyz';

  // Languages: the letters on the drums and the rare letters worth extra (rarest +3,
  // next +1, from how often each letter appears in that language's words).
  const LANGS = {
    en: { name: 'English', alphabet: A_Z, hot: { j: 3, q: 3, x: 3, z: 3, k: 1, v: 1, w: 1, y: 1 } },
    es: { name: 'Español', alphabet: 'abcdefghijklmnñopqrstuvwxyz', hot: { ñ: 3, q: 3, x: 3, y: 3, z: 3, k: 3, w: 3, f: 1, h: 1, j: 1 } },
    fr: { name: 'Français', alphabet: A_Z, hot: { k: 3, w: 3, j: 3, q: 3, x: 3, y: 3, z: 3, f: 1, h: 1, v: 1 } },
    pt: { name: 'Português', alphabet: A_Z, hot: { k: 3, w: 3, y: 3, q: 3, x: 3, z: 3, j: 3, f: 1, h: 1, v: 1 } },
    sw: { name: 'Kiswahili', alphabet: A_Z, hot: { c: 3, j: 3, v: 3, y: 3, q: 3, x: 3, f: 1, p: 1, z: 1 } },
  };
  const LANG_CODES = Object.keys(LANGS);
  const langOf = l => (LANGS[l] ? l : 'en');

  // The game's own messages in each language. {W} word, {n} number, {i} letter position, {L} letter.
  const MSG = {
    en: { illegal: 'Change exactly one letter.', repeat: '{W} was already used this round.', valid: '{W} +{n}', jackpot: 'JACKPOT! {W} +{n}',
      fresh: ". No moves left, so here's a fresh word: {W}", missPen: '{W} is not a word. −{n}', missFree: '{W} is not a word. No points lost.',
      hintAdv: 'No hints at Advanced.', hintNone: 'No hints left this round.', hintNoMoves: 'No moves from this word. Try Next word.',
      hint1: 'Try rolling letter {i}: 1 real word hides there.', hintN: 'Try rolling letter {i}: {n} real words hide there.',
      skipEnd: 'That was skip number {n}, so the round is over.', skipNew: 'New word: {W}. ', skipLast: 'Your next skip ends the round.',
      skipLeft1: '1 free skip left.', skipLeftN: '{n} free skips left.',
      pWord: 'Word', pHot: 'Hot letter {L}', pStreak: '{n} in a row', pJackpot: 'Jackpot word', pMiss: 'Not a word' },
    es: { illegal: 'Cambia exactamente una letra.', repeat: '{W} ya se usó en esta ronda.', valid: '{W} +{n}', jackpot: '¡JACKPOT! {W} +{n}',
      fresh: '. No quedan jugadas, aquí tienes una palabra nueva: {W}', missPen: '{W} no es una palabra. −{n}', missFree: '{W} no es una palabra. No pierdes puntos.',
      hintAdv: 'No hay pistas en Avanzado.', hintNone: 'No te quedan pistas en esta ronda.', hintNoMoves: 'No hay jugadas desde esta palabra. Prueba Otra palabra.',
      hint1: 'Prueba la letra {i}: ahí se esconde 1 palabra.', hintN: 'Prueba la letra {i}: ahí se esconden {n} palabras.',
      skipEnd: 'Ese fue el salto número {n}, así que la ronda terminó.', skipNew: 'Palabra nueva: {W}. ', skipLast: 'Tu próximo salto termina la ronda.',
      skipLeft1: 'Te queda 1 salto gratis.', skipLeftN: 'Te quedan {n} saltos gratis.',
      pWord: 'Palabra', pHot: 'Letra especial {L}', pStreak: '{n} seguidas', pJackpot: 'Palabra premio', pMiss: 'No es palabra' },
    fr: { illegal: 'Change exactement une lettre.', repeat: '{W} a déjà été joué dans cette manche.', valid: '{W} +{n}', jackpot: 'JACKPOT ! {W} +{n}',
      fresh: ". Plus aucun coup possible, voici un nouveau mot : {W}", missPen: "{W} n'est pas un mot. −{n}", missFree: "{W} n'est pas un mot. Aucun point perdu.",
      hintAdv: "Pas d'indice en Avancé.", hintNone: "Plus d'indice pour cette manche.", hintNoMoves: 'Aucun coup possible depuis ce mot. Essaie Mot suivant.',
      hint1: "Essaie la lettre {i} : 1 vrai mot s'y cache.", hintN: "Essaie la lettre {i} : {n} vrais mots s'y cachent.",
      skipEnd: "C'était le passage n° {n}, la manche est terminée.", skipNew: 'Nouveau mot : {W}. ', skipLast: 'Ton prochain passage termine la manche.',
      skipLeft1: 'Il te reste 1 passage gratuit.', skipLeftN: 'Il te reste {n} passages gratuits.',
      pWord: 'Mot', pHot: 'Lettre rare {L}', pStreak: "{n} d'affilée", pJackpot: 'Mot jackpot', pMiss: 'Pas un mot' },
    pt: { illegal: 'Mude exatamente uma letra.', repeat: '{W} já foi usada nesta rodada.', valid: '{W} +{n}', jackpot: 'JACKPOT! {W} +{n}',
      fresh: '. Sem jogadas possíveis, aqui está uma palavra nova: {W}', missPen: '{W} não é uma palavra. −{n}', missFree: '{W} não é uma palavra. Nenhum ponto perdido.',
      hintAdv: 'Sem dicas no Avançado.', hintNone: 'Sem dicas restantes nesta rodada.', hintNoMoves: 'Não há jogadas a partir desta palavra. Tente Próxima palavra.',
      hint1: 'Tente a letra {i}: 1 palavra se esconde ali.', hintN: 'Tente a letra {i}: {n} palavras se escondem ali.',
      skipEnd: 'Esse foi o pulo número {n}, então a rodada acabou.', skipNew: 'Palavra nova: {W}. ', skipLast: 'Seu próximo pulo encerra a rodada.',
      skipLeft1: 'Resta 1 pulo grátis.', skipLeftN: 'Restam {n} pulos grátis.',
      pWord: 'Palavra', pHot: 'Letra rara {L}', pStreak: '{n} seguidas', pJackpot: 'Palavra jackpot', pMiss: 'Não é palavra' },
    sw: { illegal: 'Badilisha herufi moja tu.', repeat: '{W} imeshatumika katika raundi hii.', valid: '{W} +{n}', jackpot: 'JACKPOT! {W} +{n}',
      fresh: '. Hakuna hatua zaidi, hili hapa neno jipya: {W}', missPen: '{W} si neno. −{n}', missFree: '{W} si neno. Hupotezi pointi.',
      hintAdv: 'Hakuna vidokezo katika Kiwango cha Juu.', hintNone: 'Vidokezo vimekwisha kwa raundi hii.', hintNoMoves: 'Hakuna hatua kutoka neno hili. Jaribu Neno jingine.',
      hint1: 'Jaribu herufi ya {i}: neno 1 limejificha hapo.', hintN: 'Jaribu herufi ya {i}: maneno {n} yamejificha hapo.',
      skipEnd: 'Huo ulikuwa mruko wa {n}, kwa hiyo raundi imekwisha.', skipNew: 'Neno jipya: {W}. ', skipLast: 'Mruko wako ujao utamaliza raundi.',
      skipLeft1: 'Umebakiwa na mruko 1 wa bure.', skipLeftN: 'Umebakiwa na miruko {n} ya bure.',
      pWord: 'Neno', pHot: 'Herufi adimu {L}', pStreak: '{n} mfululizo', pJackpot: 'Neno la jackpot', pMiss: 'Si neno' },
  };
  function msg(lang, key, v = {}) {
    const t = (MSG[langOf(lang)] || MSG.en)[key] ?? MSG.en[key];
    return t.replace(/\{(\w)\}/g, (_, k) => (v[k] ?? ''));
  }

  // Game intensity: how hard the words are, how far the jackpots hide, what a miss
  // costs and how many hints you get. Each intensity has its own leaderboards.
  const INTENSITY = {
    learner: {
      label: 'Learner', about: 'Very easy: everyday words, jackpots close by, no penalty for a miss, unlimited hints.',
      startWords: 'easy', minEasyMoves: 4, jackpotRings: [1, 2], jackpotWords: 'easy', miss: 0, hints: Infinity,
    },
    intermediate: {
      label: 'Intermediate', about: 'Familiar words with some vocabulary. Jackpots 2 to 4 moves away. 3 hints.',
      startWords: 'common', minEasyMoves: 0, jackpotRings: [2, 3, 4], jackpotWords: 'common', miss: -1, hints: 3,
    },
    advanced: {
      label: 'Advanced', about: 'For word makers: rarer words, jackpots 3 to 4 moves away, no hints.',
      startWords: 'harder', minEasyMoves: 0, jackpotRings: [3, 4], jackpotWords: 'any', miss: -1, hints: 0,
    },
  };
  const INTENSITIES = Object.keys(INTENSITY);
  const profile = name => INTENSITY[name] || INTENSITY.intermediate;

  // Real words one letter away from `word`. `dict` is a Set of words of that length.
  function neighbours(word, dict) {
    const out = [];
    for (let i = 0; i < word.length; i++) {
      for (const c of (dict.alphabet || A_Z)) {
        if (c === word[i]) continue;
        const cand = word.slice(0, i) + c + word.slice(i + 1);
        if (dict.has(cand)) out.push(cand);
      }
    }
    return out;
  }

  // Points for one real word. `prev` is the word before the move.
  function scoreMove({ word, prev, streak, isJackpot, lang }) {
    const parts = [{ label: msg(lang, 'pWord'), points: RULES.word }];
    const i = [...word].findIndex((c, k) => c !== prev[k]);
    const letter = word[i];
    const hot = (LANGS[langOf(lang)].hot || RULES.hotLetters)[letter];
    if (hot) parts.push({ label: msg(lang, 'pHot', { L: letter.toUpperCase() }), points: hot, kind: 'hot' });
    if (streak >= RULES.streakFrom) parts.push({ label: msg(lang, 'pStreak', { n: streak }), points: RULES.streakBonus, kind: 'streak' });
    if (isJackpot) parts.push({ label: msg(lang, 'pJackpot'), points: RULES.jackpot, kind: 'jackpot' });
    return { points: parts.reduce((t, p) => t + p.points, 0), parts };
  }

  // Every word within 4 moves of `start`, with its distance.
  function explore(start, dict) {
    const depth = new Map([[start, 0]]);
    let frontier = [start];
    for (let d = 1; d <= 4 && depth.size < 4000; d++) {
      const next = [];
      for (const w of frontier) {
        for (const n of neighbours(w, dict)) {
          if (!depth.has(n)) { depth.set(n, d); next.push(n); }
        }
      }
      frontier = next;
    }
    return depth;
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // Jackpot words 2–4 moves from the start, about half from the farthest ring.
  // opts.common (familiar words) are preferred; opts.blocked (rude words) are never used.
  function jackpotsFor(start, dict, opts = {}, depth = explore(start, dict)) {
    const count = opts.count || RULES.jackpotsPerWord;
    const prof = profile(opts.intensity);
    const blocked = opts.blocked;
    const common = prof.jackpotWords === 'easy' ? (opts.easy || opts.common) : prof.jackpotWords === 'any' ? null : opts.common;
    const ok = w => !(blocked && blocked.has(w));
    const ring = d => {
      const all = shuffle([...depth].filter(([w, k]) => k === d && ok(w)).map(([w]) => w));
      return common ? [...all.filter(w => common.has(w)), ...all.filter(w => !common.has(w))] : all;
    };
    const familiar = w => !common || common.has(w);
    const rings = [...prof.jackpotRings].sort((a, b) => b - a).map(ring);   // farthest first
    // Familiar words from every ring first, farthest first; unfamiliar ones only to fill up.
    // About half from the farthest ring, the rest from anywhere; familiar words first,
    // unfamiliar ones only when there aren't enough familiar ones.
    const pickFrom = list => {
      const far = list.slice(0, Math.ceil(count / 2));
      return [...far, ...shuffle(list.slice(far.length))];
    };
    const fam = pickFrom(rings.flatMap(r => r.filter(familiar)));
    const rest = pickFrom(rings.flatMap(r => r.filter(w => !familiar(w))));
    return [...fam, ...rest].slice(0, count);
  }

  // A starting word with plenty of room: at least 40 words within 4 moves and a
  // full set of jackpots. Falls back to the roomiest word found.
  // The starting-word pool for an intensity: everyday words for Learner, familiar ones
  // for Intermediate, the less everyday ones for Advanced. Cache the result per level.
  function poolFor(pool, opts = {}, dict = null) {
    const prof = profile(opts.intensity), easy = opts.easy;
    if (!easy || prof.startWords === 'common') return pool;
    if (prof.startWords === 'harder') {
      const sub = pool.filter(w => !easy.has(w));
      return sub.length >= 20 ? sub : pool;
    }
    // Learner: everyday words with plenty of everyday moves; relax step by step
    // for long words, where few such words exist.
    const everyday = pool.filter(w => easy.has(w));
    if (!dict) return everyday.length >= 20 ? everyday : pool;
    for (const need of [prof.minEasyMoves, 3, 2, 1]) {
      const sub = everyday.filter(w => neighbours(w, dict).filter(n => easy.has(n)).length >= need);
      if (sub.length >= 60) return sub;   // keep enough variety
    }
    return everyday.length ? everyday : pool;
  }

  function pickStart(dict, pool, opts = {}) {
    const count = opts.count || RULES.jackpotsPerWord;
    let best = null;
    for (let t = 0; t < 40; t++) {
      const word = pool[Math.floor(Math.random() * pool.length)];
      if (!dict.has(word) || (opts.blocked && opts.blocked.has(word))) continue;
      const nb = neighbours(word, dict);
      if (nb.length < 3) continue;
      const depth = explore(word, dict);
      const jackpots = jackpotsFor(word, dict, opts, depth);
      if (depth.size >= 40 && jackpots.length >= count) return { word, jackpots };
      if (!best || depth.size > best.room) best = { word, jackpots, room: depth.size };
    }
    if (!best) throw new Error('No playable starting word in this word list.');
    return { word: best.word, jackpots: best.jackpots };
  }

  // True when no unused real word is one letter away (the player is stuck).
  function isDeadEnd(word, used, dict) {
    return !neighbours(word, dict).some(n => !used.includes(n));
  }

  function newPlayer(start, intensity, lang) {
    return { intensity: INTENSITY[intensity] ? intensity : 'intermediate', lang: langOf(lang), score: 0, streak: 0, skips: 0, hintsUsed: 0,
      current: start.word, used: [start.word], jackpots: [...start.jackpots], found: [], chain: [] };
  }

  // Hint: which letter to roll. Picks the position with the most unused real words
  // (everyday words count first), without giving away the word itself.
  function hint(p, dict, opts = {}) {
    const prof = profile(p.intensity);
    const left = prof.hints - (p.hintsUsed || 0);
    if (left <= 0) return { error: msg(p.lang, prof.hints === 0 ? 'hintAdv' : 'hintNone') };
    let best = null;
    for (let i = 0; i < p.current.length; i++) {
      let real = 0, easyCount = 0;
      for (const c of (dict.alphabet || A_Z)) {
        if (c === p.current[i]) continue;
        const w = p.current.slice(0, i) + c + p.current.slice(i + 1);
        if (dict.has(w) && !p.used.includes(w)) { real++; if (opts.easy && opts.easy.has(w)) easyCount++; }
      }
      const score = easyCount * 10 + real;
      if (real && (!best || score > best.score)) best = { slot: i, score, real };
    }
    if (!best) return { error: msg(p.lang, 'hintNoMoves') };
    p.hintsUsed = (p.hintsUsed || 0) + 1;
    return { slot: best.slot, options: best.real, hintsLeft: prof.hints === Infinity ? -1 : prof.hints - p.hintsUsed,
      message: msg(p.lang, best.real === 1 ? 'hint1' : 'hintN', { i: best.slot + 1, n: best.real }) };
  }

  // Judge one move and update the player. `fresh()` deals a new start at a dead end.
  function applyMove(p, word, dict, fresh) {
    word = String(word || '').toLowerCase();
    const L = p.lang, alpha = dict.alphabet || A_Z;
    let result;
    const diff = word.length === p.current.length ? [...word].filter((c, i) => c !== p.current[i]).length : -1;
    if (![...word].every(c => alpha.includes(c)) || !word || diff !== 1) {
      result = { outcome: 'illegal', message: msg(L, 'illegal') };
    } else if (p.used.includes(word)) {
      result = { outcome: 'repeat', message: msg(L, 'repeat', { W: word.toUpperCase() }) };
    } else if (dict.has(word)) {
      p.streak += 1;
      const isJackpot = p.jackpots.includes(word) && !p.found.includes(word);
      const { points, parts } = scoreMove({ word, prev: p.current, streak: p.streak, isJackpot, lang: L });
      if (isJackpot) p.found.push(word);
      p.score += points; p.current = word; p.used.push(word);
      p.chain.push({ word, valid: true, points });
      result = { outcome: 'valid', points, parts, jackpot: isJackpot,
        message: msg(L, isJackpot ? 'jackpot' : 'valid', { W: word.toUpperCase(), n: points }) };
      if (isDeadEnd(word, p.used, dict)) {
        const next = fresh();
        p.current = next.word; p.used.push(next.word);
        p.jackpots = [...next.jackpots]; p.found = [];
        p.chain.push({ word: next.word, valid: true, fresh: true });
        result.fresh = next.word;
        result.message += msg(L, 'fresh', { W: next.word.toUpperCase() });
      }
    } else {
      const miss = profile(p.intensity).miss;
      p.streak = 0;
      p.score += miss;
      p.chain.push({ word, valid: false, points: miss });
      result = { outcome: 'invalid', points: miss, parts: [{ label: msg(L, 'pMiss'), points: miss }],
        message: msg(L, miss ? 'missPen' : 'missFree', { W: word.toUpperCase(), n: Math.abs(miss) }) };
    }
    return Object.assign(result, { word }, status(p));
  }

  function status(p) {
    const prof = profile(p.intensity);
    return { hintsLeft: prof.hints === Infinity ? -1 : prof.hints - (p.hintsUsed || 0),
      score: p.score, current: p.current, streak: p.streak, skips: p.skips || 0,
      skipsLeft: RULES.maxSkips - (p.skips || 0), jackpotsFound: p.found.length, jackpotsTotal: p.jackpots.length };
  }

  // "Next word": a fresh word when this one is too hard. No points lost, but the
  // streak resets. The last allowed skip (the 5th) ends the round instead.
  function applySkip(p, fresh) {
    p.skips = (p.skips || 0) + 1;
    p.streak = 0;
    if (p.skips >= RULES.maxSkips) {
      return Object.assign({ outcome: 'skip', ended: true,
        message: msg(p.lang, 'skipEnd', { n: RULES.maxSkips }) }, status(p));
    }
    const next = fresh();
    p.current = next.word; p.used.push(next.word);
    p.jackpots = [...next.jackpots]; p.found = [];
    p.chain.push({ word: next.word, valid: true, fresh: true });
    const left = RULES.maxSkips - p.skips;
    return Object.assign({ outcome: 'skip', fresh: next.word,
      message: msg(p.lang, 'skipNew', { W: next.word.toUpperCase() }) + msg(p.lang, left === 1 ? 'skipLast' : left - 1 === 1 ? 'skipLeft1' : 'skipLeftN', { n: left - 1 }) }, status(p));
  }

  // The rules as the app shows them on the Start screen.
  function publicRules(roundSeconds, intensity, lang) {
    const prof = profile(intensity), l = langOf(lang);
    return { round: roundSeconds || RULES.round, word: RULES.word, miss: prof.miss, jackpot: RULES.jackpot,
      lang: l, alphabet: LANGS[l].alphabet, hotLetters: LANGS[l].hot, streakFrom: RULES.streakFrom, maxSkips: RULES.maxSkips,
      intensity: INTENSITY[intensity] ? intensity : 'intermediate', intensityLabel: prof.label,
      hints: prof.hints === Infinity ? -1 : prof.hints };
  }

  return { RULES, LANGS, LANG_CODES, langOf, msg, LEVELS: [4, 5, 6, 7], INTENSITY, INTENSITIES, poolFor, hint, neighbours, scoreMove, explore, jackpotsFor, pickStart, isDeadEnd, newPlayer, applyMove, applySkip, status, publicRules };
}));
