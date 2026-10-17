// Loads one word set per level and a pool of starting words.
// The word lists live in client/words so the app can also play offline.
const fs = require('fs');
const path = require('path');
const engine = require('../client/engine');

const LEVELS = engine.LEVELS;
const DATA = path.join(__dirname, '..', 'client', 'words');

const words = {};
const startPool = {};
const common = {};
const easy = {};
const pools = {};   // level:intensity -> starting-word pool
const blockedFile = path.join(DATA, 'blocked.txt');
const blocked = new Set(fs.existsSync(blockedFile) ? readList(blockedFile) : []);

function readList(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).map(w => w.trim().toLowerCase()).filter(Boolean);
}

for (const L of LEVELS) {
  words[L] = new Set(readList(path.join(DATA, `words_${L}.txt`)).filter(w => w.length === L && /^[a-z]+$/.test(w)));
  const startFile = path.join(DATA, `start_${L}.txt`);
  const pool = fs.existsSync(startFile) ? readList(startFile) : [...words[L]];
  startPool[L] = pool.filter(w => words[L].has(w) && engine.neighbours(w, words[L]).length >= 3);
  if (!startPool[L].length) throw new Error(`No playable start words for level ${L}`);
  const commonFile = path.join(DATA, `common_${L}.txt`);
  common[L] = fs.existsSync(commonFile) ? new Set(readList(commonFile)) : null;
  const easyFile = path.join(DATA, `easy_${L}.txt`);
  easy[L] = fs.existsSync(easyFile) ? new Set(readList(easyFile)) : null;
}
const optionsFor = (level, intensity) => ({ blocked, common: common[level], easy: easy[level], intensity });
function poolFor(level, intensity) {
  const key = `${level}:${intensity}`;
  if (!pools[key]) pools[key] = engine.poolFor(startPool[level], optionsFor(level, intensity), words[level]);
  return pools[key];
}

const wordsFor = level => words[level];
const isRealWord = (word, level) => words[level]?.has(String(word).toLowerCase()) || false;
const pickStartWord = level => startPool[level][Math.floor(Math.random() * startPool[level].length)];
const neighbours = word => engine.neighbours(word, words[word.length]);
const stats = () => Object.fromEntries(LEVELS.map(L => [L, { words: words[L].size, starts: startPool[L].length }]));

module.exports = { LEVELS, wordsFor, startPool, optionsFor, poolFor, isRealWord, pickStartWord, neighbours, stats };
