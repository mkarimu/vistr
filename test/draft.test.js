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
