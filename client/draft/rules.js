/* Vistr Draft - pure rules (no DOM, no timers). 8 columns x 9 rows. A starts at the bottom, B at the top.
   A die that reaches the far row is crowned: a king moves and captures in all four diagonal directions.
   Levels: 'standard' - only legal moves can be made.  'advanced' - any die can be moved anywhere; stepping while a
   capture was open costs the offender that die and gives the opponent penalty points. */
(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(); else root.DraftRules = f(); })(this, function () {
  var W = 8, H = 9, PTS = { capture: 1, penalty: 2, win: 3 };
  function dark(r, c) { return (r + c) % 2 === 1; }
  function fwd(p) { return p === 'A' ? -1 : 1; }
  function other(p) { return p === 'A' ? 'B' : 'A'; }
  function inb(r, c) { return r >= 0 && r < H && c >= 0 && c < W; }
  function grid(v) { var k = [], r, c; for (r = 0; r < H; r++) { k.push([]); for (c = 0; c < W; c++) k[r].push(v); } return k; }
  function newGame(level) {
    var b = [], r, c;
    for (r = 0; r < H; r++) { b.push([]); for (c = 0; c < W; c++) b[r].push(dark(r, c) && r < 3 ? 'B' : dark(r, c) && r > 5 ? 'A' : ''); }
    return { b: b, k: grid(false), turn: 'A', chain: null, winner: '', level: level === 'advanced' ? 'advanced' : 'standard', score: { A: 0, B: 0 }, event: null, moves: 0 };
  }
  function kings(g) { return g.k || (g.k = grid(false)); }
  function dirs(g, r, c) { return kings(g)[r][c] ? [-1, 1] : [fwd(g.b[r][c])]; }
  function crownRow(p) { return p === 'A' ? 0 : H - 1; }
  function jumpsFrom(g, r, c) {
    var p = g.b[r][c], out = [];
    dirs(g, r, c).forEach(function (d) {
      for (var dc = -1; dc <= 1; dc += 2) {
        var mr = r + d, mc = c + dc, lr = r + 2 * d, lc = c + 2 * dc;
        if (inb(lr, lc) && g.b[mr][mc] === other(p) && !g.b[lr][lc]) out.push({ fr: r, fc: c, tr: lr, tc: lc, cap: [mr, mc] });
      }
    });
    return out;
  }
  function stepsFrom(g, r, c) {
    var out = [];
    dirs(g, r, c).forEach(function (d) {
      for (var dc = -1; dc <= 1; dc += 2) if (inb(r + d, c + dc) && !g.b[r + d][c + dc]) out.push({ fr: r, fc: c, tr: r + d, tc: c + dc, cap: null });
    });
    return out;
  }
  function legal(g) {
    if (g.winner) return [];
    var r, c, j = [], s = [];
    if (g.chain) return jumpsFrom(g, g.chain[0], g.chain[1]);
    for (r = 0; r < H; r++) for (c = 0; c < W; c++) if (g.b[r][c] === g.turn) { j = j.concat(jumpsFrom(g, r, c)); s = s.concat(stepsFrom(g, r, c)); }
    return j.length ? j : s;
  }
  function count(g, p) { var n = 0; g.b.forEach(function (row) { row.forEach(function (x) { if (x === p) n++; }); }); return n; }
  function countKings(g, p) { var n = 0, k = kings(g); g.b.forEach(function (row, r) { row.forEach(function (x, c) { if (x === p && k[r][c]) n++; }); }); return n; }
  function clone(g) {
    var k = kings(g);
    return { b: g.b.map(function (r) { return r.slice(); }), k: k.map(function (r) { return r.slice(); }), turn: g.turn, chain: null, winner: '', level: g.level,
      score: { A: (g.score || {}).A || 0, B: (g.score || {}).B || 0 }, event: null, moves: (g.moves || 0) + 1 };
  }
  function finish(n, winner) { n.winner = winner; n.score[winner] += PTS.win; }
  // move a die, take the die it jumps, crown it if it reaches the far row. Returns true when it was crowned.
  function apply(n, m, p) {
    var wasKing = n.k[m.fr][m.fc];
    n.b[m.tr][m.tc] = p; n.b[m.fr][m.fc] = ''; n.k[m.fr][m.fc] = false;
    n.k[m.tr][m.tc] = wasKing;
    if (m.cap) { n.b[m.cap[0]][m.cap[1]] = ''; n.k[m.cap[0]][m.cap[1]] = false; n.score[p] += PTS.capture; }
    if (!wasKing && m.tr === crownRow(p)) { n.k[m.tr][m.tc] = true; return true; }
    return false;
  }
  // after a move: keep jumping, or pass the turn and look for a winner
  function settle(n, m, p) {
    if (m.cap && !n.event.crowned) {
      if (!count(n, other(p))) { finish(n, p); return n; }
      if (jumpsFrom(n, m.tr, m.tc).length) { n.chain = [m.tr, m.tc]; n.turn = p; return n; }
    }
    n.turn = other(p);
    if (!count(n, other(p)) || !legal(n).length) finish(n, p);
    return n;
  }
  function doMove(g, m) {
    var n = clone(g), p = g.turn, crowned = apply(n, m, p);
    n.event = { type: m.cap ? 'capture' : 'move', player: p, pts: m.cap ? PTS.capture : 0, crowned: crowned };
    return settle(n, m, p);
  }
  // a legal move (both levels). Returns the new state or null.
  function play(g, fr, fc, tr, tc) {
    var m = legal(g).filter(function (x) { return x.fr === fr && x.fc === fc && x.tr === tr && x.tc === tc; })[0];
    return m ? doMove(g, m) : null;
  }
  // advanced level: nothing forces a capture. If a capture was open and the player stepped instead, the die that
  // could have captured is removed and the opponent scores. Anything that is not a move at all returns null.
  function playAdvanced(g, fr, fc, tr, tc) {
    if (g.winner || !inb(fr, fc) || !inb(tr, tc) || g.b[fr][fc] !== g.turn || g.b[tr][tc]) return null;
    var p = g.turn, o = other(p), r, c, any = [];
    if (!g.chain) { for (r = 0; r < H; r++) for (c = 0; c < W; c++) if (g.b[r][c] === p) any = any.concat(jumpsFrom(g, r, c)); }
    else any = legal(g);
    var asJump = any.filter(function (x) { return x.fr === fr && x.fc === fc && x.tr === tr && x.tc === tc; })[0];
    if (asJump) return { g: doMove(g, asJump), wrong: '' };
    var step = stepsFrom(g, fr, fc).filter(function (x) { return x.tr === tr && x.tc === tc; })[0];
    if (!step) return null;                                    // not a move: ignored, no penalty
    if (!any.length) return { g: doMove(g, step), wrong: '' };   // a normal step, nothing was open
    var mine = any.filter(function (x) { return x.fr === fr && x.fc === fc; })[0] || any[0];
    var n = clone(g);
    n.b[mine.fr][mine.fc] = ''; n.k[mine.fr][mine.fc] = false; n.score[o] += PTS.penalty;
    n.event = { type: 'penalty', player: p, pts: PTS.penalty, why: 'missed a capture' };
    n.turn = o;
    if (!count(n, p)) finish(n, o); else if (!legal(n).length) finish(n, p);
    return { g: n, wrong: 'missed a capture' };
  }
  function resign(g, p) { var n = clone(g); n.turn = g.turn; n.event = { type: 'resign', player: p, pts: 0 }; finish(n, other(p)); return n; }
  return { W: W, H: H, PTS: PTS, dark: dark, other: other, newGame: newGame, legal: legal, play: play, playAdvanced: playAdvanced, resign: resign, count: count, countKings: countKings, jumpsFrom: jumpsFrom };
});
