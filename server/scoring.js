// Server side of the shared engine (client/engine.js): the same rules the app uses
// offline, bound to the server's word lists. Tune the numbers in client/engine.js.
const engine = require('../client/engine');
const dict = require('./dictionary');

const pickStart = (level, intensity) => engine.pickStart(dict.wordsFor(level), dict.poolFor(level, intensity), dict.optionsFor(level, intensity));
const applyMove = (player, word, level) => engine.applyMove(player, word, dict.wordsFor(level), () => pickStart(level, player.intensity));
const applySkip = (player, level) => engine.applySkip(player, () => pickStart(level, player.intensity));
const hint = (player, level) => engine.hint(player, dict.wordsFor(level), dict.optionsFor(level, player.intensity));

module.exports = {
  RULES: engine.RULES,
  INTENSITIES: engine.INTENSITIES,
  scoreMove: engine.scoreMove,
  jackpotsFor: (start, count, intensity) => engine.jackpotsFor(start, dict.wordsFor(start.length), { ...dict.optionsFor(start.length, intensity), count }),
  isDeadEnd: (word, used) => engine.isDeadEnd(word, used, dict.wordsFor(word.length)),
  pickStart,
  applyMove,
  applySkip,
  hint,
};
