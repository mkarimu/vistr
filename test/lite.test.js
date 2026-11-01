// Vistr Lite rules: node test/lite.test.js
const fs = require('fs'), path = require('path');
const E = require('../client/engine'), C = require('../client/lite/core');
let failures = 0;
const ok = (name, cond) => { console.log((cond ? '  ok    ' : '  FAIL  ') + name); if (!cond) failures++; };
const read = f => fs.readFileSync(path.join(__dirname, '../client/words', f), 'utf8').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
const dict = new Set(read('words_5.txt')); dict.alphabet = E.LANGS.en.alphabet;
const easy = new Set(read('easy_5.txt'));
const starts = read('start_5.txt');
const opts = { blocked: new Set(read('blocked.txt')), common: null, easy, intensity: 'learner' };
const pool = E.poolFor(starts, opts, dict);
const pick = () => E.pickStart(dict, pool, opts);
// A fixed board: from CRANE we can reach CRATE (one letter) and TRACE-like two-letter words.
const fixed = word => () => ({ word, jackpots: [] });
const A = 'abcdefghijklmnopqrstuvwxyz';
const rollTo = (g, slot, ch) => { for (let k = 0; k < 26 && g.draft[slot] !== ch; k++) { const r = C.roll(g, slot, 1); if (!r.ok) return r; } return { ok: g.draft[slot] === ch }; };

const cfgP = C.settings({ mode: 'players', count: 3, names: ['Ann', '', 'Cy'], turnSecs: 30, turnsEach: 2, pin: '12ab34' });
ok('settings are cleaned: names, pin, limits', cfgP.names[1] === 'Player B' && cfgP.pin === '1234' && C.settings({ count: 9, turnSecs: 1, turnsEach: 99 }).count === 4
  && C.settings({ turnSecs: 1 }).turnSecs === 10 && C.settings({ turnsEach: 99 }).turnsEach === 10);
ok('round length = players x turns x seconds', C.roundSeconds(C.settings({ count: 4, turnsEach: 5, turnSecs: 30 })) === 600 && C.roundSeconds(C.settings({ count: 2, turnsEach: 5, turnSecs: 30 })) === 300);

// ---- players: one letter per move
let t0 = 1000;
let g = C.newGame(cfgP, E, dict, fixed('crane'), t0);
ok('a game starts with the first player, full time and all drums free', g.turn === 0 && C.msLeft(g, t0) === 30000 && C.drumStates(g).every(s => s === 'free'));
ok('a player rolls one letter', C.roll(g, 3, 1).ok && C.changed(g).length === 1);
let r = C.roll(g, 0, 1);
ok('a second letter is refused (one letter per move)', !r.ok && r.locked && C.drumStates(g)[0] === 'locked');
ok('rolling the letter back frees the others', (rollTo(g, 3, 'n').ok) && C.changed(g).length === 0 && C.roll(g, 0, 1).ok);
C.resetDraft(g);

// ---- a real word, scoring, turn passes
let w = 'crate';
rollTo(g, 3, 't');
ok('Process with no change does nothing', C.processMove(C.newGame(cfgP, E, dict, fixed('crane'), t0), t0) === null);
r = C.processMove(g, t0 + 5000);
ok('a real word scores for the player and the turn passes', r.outcome === 'valid' && r.points >= 1 && g.units[0].score === r.points && g.turn === 1 && g.current === 'crate');
ok('the next turn has a fresh clock', C.msLeft(g, t0 + 5000) === 30000);

// ---- not a word: penalty (learner 0) and the turn passes; a repeat does not pass the turn
rollTo(g, 0, 'z');
r = C.processMove(g, t0 + 6000);
ok('not a word: no loss at Learner, turn passes', r.outcome === 'invalid' && r.points === 0 && g.turn === 2 && g.current === 'crate');
const gi = C.newGame(C.settings({ intensity: 'intermediate', count: 2 }), E, dict, fixed('crane'), 0);
rollTo(gi, 0, 'z'); r = C.processMove(gi, 1);
ok('not a word at Intermediate costs a point', r.outcome === 'invalid' && gi.units[0].score === -1);
const gr = C.newGame(C.settings({ count: 2 }), E, dict, fixed('crane'), 0);
rollTo(gr, 3, 't'); C.processMove(gr, 1);      // crate, turn -> 1
rollTo(gr, 3, 'n'); rollTo(gr, 3, 'n'); // crane again (a word already used)
const turnBefore = gr.turn; r = C.processMove(gr, 2);
ok('a word already used is refused and the turn stays', r && r.outcome === 'repeat' && gr.turn === turnBefore && C.changed(gr).length === 0);

// ---- teams: two slots, the second touch locks the rest
const cfgT = C.settings({ mode: 'teams', count: 2, turnsEach: 3 });
g = C.newGame(cfgT, E, dict, fixed('crane'), 0);
ok('a team has two slots', g.team && g.slots === 2 && C.drumStates(g).every(s => s === 'free'));
C.roll(g, 0, 1);
ok('after the first touch everything is still free', C.drumStates(g).every(s => s === 'free'));
ok('the first drum can still be rolled more', C.roll(g, 0, 1).ok);
C.roll(g, 2, 1);
let st = C.drumStates(g);
ok('touching a second drum locks all others; first is fixed, second active', st[0] === 'fixed' && st[2] === 'active' && st[1] === 'locked' && st[3] === 'locked' && st[4] === 'locked');
const keep = g.draft.join('');
r = C.roll(g, 0, 1); const r2 = C.roll(g, 1, 1);
ok('no going back to the first drum, and no third drum', !r.ok && !r2.ok && g.draft.join('') === keep);
ok('the second drum keeps rolling', C.roll(g, 2, -1).ok && C.roll(g, 2, 1).ok);
ok('a team move may change two letters', C.changed(g).length === 2);
// touch that does not move a letter (page does not call roll) leaves everything free
g = C.newGame(cfgT, E, dict, fixed('crane'), 0);
ok('no roll, no touch: nothing is locked', C.drumStates(g).every(s => s === 'free') && g.touched.length === 0);
// a team move that is two letters and a word: crane -> crate is one letter; use crone->? find a real two-letter neighbour
let pair = null;
for (const wd of dict) { if (wd === 'crane') continue; let d = 0; for (let i = 0; i < 5; i++) if (wd[i] !== 'crane'[i]) d++; if (d === 2 && !pair) pair = wd; }
g = C.newGame(cfgT, E, dict, fixed('crane'), 0);
const slots = []; for (let i = 0; i < 5; i++) if (pair[i] !== 'crane'[i]) slots.push(i);
rollTo(g, slots[0], pair[slots[0]]); rollTo(g, slots[1], pair[slots[1]]);
r = C.processMove(g, 10);
ok('a two-letter team move is judged and scored', r.outcome === 'valid' && g.current === pair && g.units[0].score === r.points);

// ---- clock, pause, timeout
g = C.newGame(cfgP, E, dict, fixed('crane'), 0);
C.roll(g, 0, 1);
ok('no time left: the turn passes and the half-made word is dropped', (() => { const e = C.tick(g, 30001); return e && e.outcome === 'timeout' && e.unit === 0 && g.turn === 1 && C.changed(g).length === 0; })());
g = C.newGame(cfgP, E, dict, fixed('crane'), 0);
C.pause(g, 10000);
ok('paused: the clock stands still and nothing can be rolled', C.tick(g, 999999) === null && C.msLeft(g, 999999) === 20000 && !C.roll(g, 0, 1).ok);
C.resume(g, 50000);
ok('resumed: the remaining time carries on', C.msLeft(g, 50000) === 20000 && C.tick(g, 69999) === null && C.tick(g, 70000).outcome === 'timeout');

// ---- the whole game ends after everyone has had their turns
g = C.newGame(C.settings({ count: 2, turnsEach: 2, turnSecs: 10 }), E, dict, fixed('crane'), 0);
let now = 0, turns = 0;
while (g.status === 'play' && turns < 20) { now += 10001; C.tick(g, now); turns++; }
ok('the game is over after players x turns each', g.status === 'over' && turns === 4 && g.result.reason === 'done');
ok('with no scores it is a tie for first', g.result.winners.length === 2);

// ---- fair reset: the side that presses Reset first loses
g = C.newGame(C.settings({ count: 2 }), E, dict, fixed('crane'), 0);
g.units[0].score = 9; g.units[1].score = 2;
const res = C.giveUp(g, 0);
ok('the side that resets loses even when ahead', g.status === 'over' && res.reason === 'forfeit' && res.winners.length === 1 && res.winners[0] === 1 && res.ranking[1].idx === 0 && g.units[0].gaveUp);
g = C.newGame(C.settings({ count: 3 }), E, dict, fixed('crane'), 0);
g.units[0].score = 5; g.units[1].score = 3; g.units[2].score = 8;
const r3 = C.giveUp(g, 2);
ok('with three sides the quitter is last and the rest keep their order', r3.ranking.map(x => x.idx).join() === '0,1,2' && r3.ranking[2].rank === 3 && r3.winners[0] === 0);
ok('nothing can be done after the game is over', C.giveUp(g, 0) === null && C.processMove(g, 1) === null && C.tick(g, 1e9) === null && !C.roll(g, 0, 1).ok);

// ---- teacher PIN
ok('the teacher PIN: right, wrong and not set', C.pinOk(cfgP, '1234') && !C.pinOk(cfgP, '1235') && !C.pinOk(C.settings({}), '') && !C.pinOk(C.settings({}), '0000'));

// ---- one player on their own (the wide screen is for solo play too)
const cfgS = C.settings({ mode: 'teams', count: 1, turnsEach: 3, turnSecs: 20 });
ok('one side is always a player, and 1 is allowed (0 becomes 1, 9 becomes 4)', cfgS.count === 1 && cfgS.mode === 'players' && C.settings({ count: 0 }).count === 1 && C.settings({ count: 9 }).count === 4);
ok('a solo round is turns x seconds', C.roundSeconds(cfgS) === 60);
g = C.newGame(cfgS, E, dict, fixed('crane'), 0);
ok('solo: one unit, one letter per move', g.units.length === 1 && !g.team && g.slots === 1 && g.total === 3);
rollTo(g, 3, 't'); r = C.processMove(g, 1000);
ok('solo: a real word scores and the turn comes straight back', r.outcome === 'valid' && g.units[0].score === r.points && g.turn === 0 && g.status === 'play' && C.msLeft(g, 1000) === 20000);
C.tick(g, 25000); C.tick(g, 46000);
ok('solo: the game ends after its turns, with one winner row', g.status === 'over' && g.result.ranking.length === 1 && g.result.winners[0] === 0 && g.result.reason === 'done');

// ---- a real random start word from the lists plays
g = C.newGame(C.settings({ count: 2 }), E, dict, pick, 0);
const nb = E.neighbours(g.current, dict);
const mv = nb[0], pos = [...mv].findIndex((c, i) => c !== g.current[i]);
rollTo(g, pos, mv[pos]); r = C.processMove(g, 5);
ok('a random start word and one of its neighbours score', r.outcome === 'valid' || r.outcome === 'repeat');

console.log(failures ? failures + ' FAILED' : 'All checks passed.');
process.exit(failures ? 1 : 0);
