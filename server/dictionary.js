// Loads the word lists for every language: one word set per level and a pool of
// starting words. English lives in client/words, other languages in client/words/<lang>.
// The same lists ship inside the app, so it can also play offline.
const fs = require('fs');
const path = require('path');
const engine = require('../client/engine');

const LEVELS = engine.LEVELS;
const DATA = path.join(__dirname, '..', 'client', 'words');
const dirFor = lang => (lang === 'en' ? DATA : path.join(DATA, lang));

function readList(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).map(w => w.trim().toLowerCase()).filter(Boolean);
}

function load(lang) {
  const dir = dirFor(lang);
  const alphabet = engine.LANGS[lang].alphabet;
  const okChars = w => [...w].every(c => alphabet.includes(c));
  const blockedFile = path.join(dir, 'blocked.txt');
  const d = { lang, words: {}, startPool: {}, common: {}, easy: {}, pools: {},
    blocked: new Set(fs.existsSync(blockedFile) ? readList(blockedFile) : []) };
  for (const L of LEVELS) {
    const set = new Set(readList(path.join(dir, `words_${L}.txt`)).filter(w => w.length === L && okChars(w)));
    set.alphabet = alphabet;
    d.words[L] = set;
    const startFile = path.join(dir, `start_${L}.txt`);
    const pool = fs.existsSync(startFile) ? readList(startFile) : [...set];
    d.startPool[L] = pool.filter(w => set.has(w) && engine.neighbours(w, set).length >= 3);
    if (!d.startPool[L].length) throw new Error(`No playable start words for ${lang}, level ${L}`);
    const commonFile = path.join(dir, `common_${L}.txt`);
    d.common[L] = fs.existsSync(commonFile) ? new Set(readList(commonFile)) : null;
    const easyFile = path.join(dir, `easy_${L}.txt`);
    d.easy[L] = fs.existsSync(easyFile) ? new Set(readList(easyFile)) : null;
  }
  return d;
}

// Every language that has word lists is loaded at start-up.
const dicts = {};
for (const lang of engine.LANG_CODES) {
  if (lang === 'en' || fs.existsSync(path.join(dirFor(lang), 'words_5.txt'))) dicts[lang] = load(lang);
}
const LANGS = Object.keys(dicts);
const D = lang => dicts[lang] || dicts.en;

const optionsFor = (level, intensity, lang = 'en') => {
  const d = D(lang);
  return { blocked: d.blocked, common: d.common[level], easy: d.easy[level], intensity };
};
function poolFor(level, intensity, lang = 'en') {
  const d = D(lang), key = `${level}:${intensity}`;
  if (!d.pools[key]) d.pools[key] = engine.poolFor(d.startPool[level], optionsFor(level, intensity, lang), d.words[level]);
  return d.pools[key];
}

const wordsFor = (level, lang = 'en') => D(lang).words[level];
const isRealWord = (word, level, lang = 'en') => D(lang).words[level]?.has(String(word).toLowerCase()) || false;
const neighbours = (word, lang = 'en') => engine.neighbours(word, D(lang).words[word.length]);
const startPool = D('en').startPool;
const pickStartWord = (level, lang = 'en') => { const p = D(lang).startPool[level]; return p[Math.floor(Math.random() * p.length)]; };
const stats = (lang = 'en') => Object.fromEntries(LEVELS.map(L => [L, { words: D(lang).words[L].size, starts: D(lang).startPool[L].length }]));

module.exports = { LEVELS, LANGS, wordsFor, startPool, optionsFor, poolFor, isRealWord, pickStartWord, neighbours, stats };
