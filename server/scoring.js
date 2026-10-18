// Server side of the shared engine (client/engine.js): the same rules the app uses
// offline, bound to the server's word lists for each language. Tune the numbers in client/engine.js.
const engine = require('../client/engine');
const dict = require('./dictionary');

const pickStart = (level, intensity, lang = 'en') =>
  engine.pickStart(dict.wordsFor(level, lang), dict.poolFor(level, intensity, lang), dict.optionsFor(level, intensity, lang));
const applyMove = (player, word, level) =>
  engine.applyMove(player, word, dict.wordsFor(level, player.lang), () => pickStart(level, player.intensity, player.lang));
const applySkip = (player, level) => engine.applySkip(player, () => pickStart(level, player.intensity, player.lang));
const hint = (player, level) => engine.hint(player, dict.wordsFor(level, player.lang), dict.optionsFor(level, player.intensity, player.lang));

module.exports = {
  RULES: engine.RULES,
  INTENSITIES: engine.INTENSITIES,
  LANGS: dict.LANGS,
  scoreMove: engine.scoreMove,
  jackpotsFor: (start, count, intensity, lang = 'en') =>
    engine.jackpotsFor(start, dict.wordsFor(start.length, lang), { ...dict.optionsFor(start.length, intensity, lang), count }),
  isDeadEnd: (word, used, lang = 'en') => engine.isDeadEnd(word, used, dict.wordsFor(word.length, lang)),
  pickStart,
  applyMove,
  applySkip,
  hint,
};
