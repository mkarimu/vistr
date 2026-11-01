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
