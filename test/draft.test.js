var R = require('../client/draft/rules.js'), n = 0;
function ok(c, m) { if (!c) { console.log('FAIL: ' + m); process.exitCode = 1; } n++; }
var g = R.newGame();
ok(R.count(g, 'A') === 12 && R.count(g, 'B') === 12, '12 dice each');
ok(g.b[0].filter(Boolean).length === 4 && g.b[4].filter(Boolean).length === 0, 'four per row, middle empty');
ok(R.legal(g).length === 7, 'opening moves ' + R.legal(g).length);
ok(R.play(g, 6, 1, 5, 1) === null, 'no straight moves');
g = R.play(g, 6, 1, 5, 0); ok(g && g.turn === 'B', 'turn passes');
// capture is mandatory and chains
var t = { b: [], turn: 'A', chain: null, winner: '' };
for (var r = 0; r < 9; r++) t.b.push(['', '', '', '', '', '', '', '']);
t.b[8][1] = 'A'; t.b[7][2] = 'B'; t.b[5][4] = 'B'; t.b[0][1] = 'B'; t.b[8][5] = 'A';
ok(R.legal(t).every(function (m) { return m.cap; }), 'must capture');
var s = R.play(t, 8, 1, 6, 3); ok(s && s.turn === 'A' && s.chain, 'chain continues');
ok(R.legal(s).length === 1, 'only chain piece moves');
s = R.play(s, 6, 3, 4, 5); ok(s && s.turn === 'B' && R.count(s, 'B') === 1, 'two captured, turn passes');
// win by capturing all / blocking
var w = { b: [], turn: 'A', chain: null, winner: '' };
for (r = 0; r < 9; r++) w.b.push(['', '', '', '', '', '', '', '']);
w.b[2][1] = 'A'; w.b[1][2] = 'B'; w.b[0][3] = 'A';
w = R.play(w, 2, 1, 0, 3) || w; // blocked
var x = { b: [], turn: 'A', chain: null, winner: '' };
for (r = 0; r < 9; r++) x.b.push(['', '', '', '', '', '', '', '']);
x.b[2][1] = 'A'; x.b[1][2] = 'B';
x = R.play(x, 2, 1, 0, 3); ok(x.winner === 'A', 'last die taken wins');
console.log(n + ' draft checks done');
// scoring and the advanced level
(function () {
  var g = R.newGame('advanced'); ok(g.level === 'advanced' && g.score.A === 0, 'new advanced game');
  ok(R.playAdvanced(g, 6, 1, 3, 4) === null, 'a non-move is ignored, no penalty');
  ok(R.playAdvanced(g, 0, 1, 1, 0) === null, 'cannot move the opponent');
  ok(R.playAdvanced(g, 6, 1, 7, 1) === null, 'only empty squares count');
  ok(R.playAdvanced(g, 6, 1, 5, 0).wrong === '', 'normal step is fine');
  var t = { b: [], turn: 'A', chain: null, winner: '', level: 'advanced', score: { A: 0, B: 0 }, event: null, moves: 0 }, r;
  for (r = 0; r < 9; r++) t.b.push(['', '', '', '', '', '', '', '']);
  t.b[8][1] = 'A'; t.b[7][2] = 'B'; t.b[6][5] = 'A'; t.b[0][1] = 'B';
  var miss = R.playAdvanced(t, 6, 5, 5, 4);  // a legal step while a capture exists
  ok(miss.wrong === 'missed a capture' && miss.g.b[8][1] === '' && miss.g.b[6][5] === 'A' && miss.g.score.B === 2, 'missed capture removes the die that could capture');
  var good = R.playAdvanced(t, 8, 1, 6, 3); ok(good.wrong === '' && good.g.score.A === 1, 'capture scores 1');
  var last = { b: [], turn: 'A', chain: null, winner: '', level: 'standard', score: { A: 0, B: 0 }, event: null, moves: 0 };
  for (r = 0; r < 9; r++) last.b.push(['', '', '', '', '', '', '', '']);
  last.b[2][1] = 'A'; last.b[1][2] = 'B';
  var e = R.play(last, 2, 1, 0, 3); ok(e.winner === 'A' && e.score.A === 1 + R.PTS.win, 'winner bonus');
  var rs = R.resign(R.newGame(), 'A'); ok(rs.winner === 'B', 'resign');
  console.log('advanced checks done');
})();
// kings
(function () {
  var r, t = { b: [], turn: 'A', chain: null, winner: '', level: 'standard', score: { A: 0, B: 0 }, event: null, moves: 0 };
  for (r = 0; r < 9; r++) t.b.push(['', '', '', '', '', '', '', '']);
  t.b[1][2] = 'A'; t.b[8][1] = 'B'; t.b[7][4] = 'A';
  var c = R.play(t, 1, 2, 0, 1); ok(c && c.k[0][1] && c.event.crowned && R.countKings(c, 'A') === 1, 'reaching the far row crowns');
  var back = R.play({ b: c.b, k: c.k, turn: 'A', chain: null, winner: '', level: 'standard', score: c.score, event: null, moves: 5 }, 0, 1, 1, 0);
  ok(back && back.k[1][0] && !back.k[0][1], 'a king steps backward and stays a king');
  var m = R.play(t, 7, 4, 6, 3); ok(m && !m.k[6][3], 'ordinary dice are not crowned early');
  // a king captures backward; crowning ends a capture chain
  var k = { b: [], k: [], turn: 'A', chain: null, winner: '', level: 'standard', score: { A: 0, B: 0 }, event: null, moves: 0 };
  for (r = 0; r < 9; r++) { k.b.push(['', '', '', '', '', '', '', '']); k.k.push([false, false, false, false, false, false, false, false]); }
  k.b[4][3] = 'A'; k.k[4][3] = true; k.b[5][4] = 'B'; k.b[0][1] = 'B';
  var bc = R.play(k, 4, 3, 6, 5); ok(bc && bc.b[5][4] === '' && bc.k[6][5] && bc.score.A === 1, 'king captures backward');
  var man = { b: [], turn: 'A', chain: null, winner: '', level: 'standard', score: { A: 0, B: 0 }, event: null, moves: 0 };
  for (r = 0; r < 9; r++) man.b.push(['', '', '', '', '', '', '', '']);
  man.b[2][1] = 'A'; man.b[1][2] = 'B'; man.b[1][4] = 'B'; man.b[8][7] = 'B';
  var cr = R.play(man, 2, 1, 0, 3); ok(cr && cr.event.crowned && cr.turn === 'B' && !cr.chain, 'crowning ends the turn');
  console.log('king checks done');
})();
