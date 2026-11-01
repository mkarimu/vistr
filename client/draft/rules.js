/* Vistr Draft - pure rules (no DOM, no timers). 8 columns x 9 rows. A starts at the bottom, B at the top.
   Levels: 'standard' - only legal moves can be made.  'advanced' - any die can be moved anywhere; a wrong move
   (an illegal move, or missed a capture) costs the offender a die and gives the opponent penalty points. */
(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(); else root.DraftRules = f(); })(this, function () {
  var W = 8, H = 9, PTS = { capture: 1, penalty: 2, win: 3 };
  function dark(r, c) { return (r + c) % 2 === 1; }
  function fwd(p) { return p === 'A' ? -1 : 1; }
  function other(p) { return p === 'A' ? 'B' : 'A'; }
  function inb(r, c) { return r >= 0 && r < H && c >= 0 && c < W; }
  function newGame(level) {
    var b = [], r, c;
    for (r = 0; r < H; r++) { b.push([]); for (c = 0; c < W; c++) b[r].push(dark(r, c) && r < 3 ? 'B' : dark(r, c) && r > 5 ? 'A' : ''); }
    return { b: b, turn: 'A', chain: null, winner: '', level: level === 'advanced' ? 'advanced' : 'standard', score: { A: 0, B: 0 }, event: null, moves: 0 };
  }
  function jumpsFrom(b, r, c) {
    var p = b[r][c], d = fwd(p), out = [], dc;
    for (dc = -1; dc <= 1; dc += 2) {
      var mr = r + d, mc = c + dc, lr = r + 2 * d, lc = c + 2 * dc;
      if (inb(lr, lc) && b[mr][mc] === other(p) && !b[lr][lc]) out.push({ fr: r, fc: c, tr: lr, tc: lc, cap: [mr, mc] });
    }
    return out;
  }
  function stepsFrom(b, r, c) {
    var p = b[r][c], d = fwd(p), out = [], dc;
    for (dc = -1; dc <= 1; dc += 2) if (inb(r + d, c + dc) && !b[r + d][c + dc]) out.push({ fr: r, fc: c, tr: r + d, tc: c + dc, cap: null });
    return out;
  }
  function legal(g) {
    if (g.winner) return [];
    var r, c, j = [], s = [];
    if (g.chain) return jumpsFrom(g.b, g.chain[0], g.chain[1]);
    for (r = 0; r < H; r++) for (c = 0; c < W; c++) if (g.b[r][c] === g.turn) { j = j.concat(jumpsFrom(g.b, r, c)); s = s.concat(stepsFrom(g.b, r, c)); }
    return j.length ? j : s;
  }
  function count(g, p) { var n = 0; g.b.forEach(function (row) { row.forEach(function (x) { if (x === p) n++; }); }); return n; }
  function clone(g) { return { b: g.b.map(function (r) { return r.slice(); }), turn: g.turn, chain: null, winner: '', score: { A: (g.score || {}).A || 0, B: (g.score || {}).B || 0 }, level: g.level, event: null, moves: (g.moves || 0) + 1 }; }
  function finish(n, winner) { n.winner = winner; n.score[winner] += PTS.win; }
  // a legal move (both levels). Returns the new state or null.
  function play(g, fr, fc, tr, tc) {
    var m = legal(g).filter(function (x) { return x.fr === fr && x.fc === fc && x.tr === tr && x.tc === tc; })[0];
    if (!m) return null;
    var n = clone(g), p = g.turn;
    n.b[tr][tc] = n.b[fr][fc]; n.b[fr][fc] = '';
    n.event = { type: m.cap ? 'capture' : 'move', player: p, pts: 0 };
    if (m.cap) {
      n.b[m.cap[0]][m.cap[1]] = ''; n.score[p] += PTS.capture; n.event.pts = PTS.capture;
      if (jumpsFrom(n.b, tr, tc).length) { n.chain = [tr, tc]; n.turn = p; if (!count(n, other(p))) finish(n, p); n.chain = n.winner ? null : n.chain; return n; }
    }
    n.turn = other(p);
    if (!count(n, other(p)) || !legal(n).length) finish(n, p);
    return n;
  }
  // advanced level: nothing forces a capture. If a capture was open and the player stepped instead, the die that
  // could have captured is removed and the opponent scores. Anything that is not a move at all returns null.
  function playAdvanced(g, fr, fc, tr, tc) {
    if (g.winner || !inb(fr, fc) || !inb(tr, tc) || g.b[fr][fc] !== g.turn || g.b[tr][tc]) return null;
    var p = g.turn, o = other(p), moves = legal(g), r, c, any = [], mine;
    if (!g.chain) { for (r = 0; r < H; r++) for (c = 0; c < W; c++) if (g.b[r][c] === p) any = any.concat(jumpsFrom(g.b, r, c)); }
    else any = moves;
    var asJump = any.filter(function (x) { return x.fr === fr && x.fc === fc && x.tr === tr && x.tc === tc; })[0];
    if (asJump) { return { g: playAnyJump(g, asJump), wrong: '' }; }
    var step = stepsFrom(g.b, fr, fc).filter(function (x) { return x.tr === tr && x.tc === tc; })[0];
    if (!step) return null;                                    // not a move: ignored, no penalty
    if (!any.length) return { g: playStep(g, step), wrong: '' };   // a normal step, nothing was open
    mine = any.filter(function (x) { return x.fr === fr && x.fc === fc; })[0] || any[0];
    var n = clone(g);
    n.b[mine.fr][mine.fc] = ''; n.score[o] += PTS.penalty;
    n.event = { type: 'penalty', player: p, pts: PTS.penalty, why: 'missed a capture' };
    n.turn = o;
    if (!count(n, p)) finish(n, o); else if (!legal(n).length) finish(n, p);
    return { g: n, wrong: 'missed a capture' };
  }
  function playAnyJump(g, m) {   // a jump is always allowed, also when the standard rule would not require it
    var n = clone(g), p = g.turn;
    n.b[m.tr][m.tc] = n.b[m.fr][m.fc]; n.b[m.fr][m.fc] = ''; n.b[m.cap[0]][m.cap[1]] = ''; n.score[p] += PTS.capture;
    n.event = { type: 'capture', player: p, pts: PTS.capture };
    if (!count(n, other(p))) { finish(n, p); return n; }
    if (jumpsFrom(n.b, m.tr, m.tc).length) { n.chain = [m.tr, m.tc]; n.turn = p; return n; }
    n.turn = other(p); if (!legal(n).length) finish(n, p); return n;
  }
  function playStep(g, m) {
    var n = clone(g), p = g.turn;
    n.b[m.tr][m.tc] = n.b[m.fr][m.fc]; n.b[m.fr][m.fc] = ''; n.event = { type: 'move', player: p, pts: 0 };
    n.turn = other(p); if (!legal(n).length) finish(n, p); return n;
  }
  function resign(g, p) { var n = clone(g); n.turn = g.turn; n.event = { type: 'resign', player: p, pts: 0 }; finish(n, other(p)); return n; }
  return { W: W, H: H, PTS: PTS, dark: dark, other: other, newGame: newGame, legal: legal, play: play, playAdvanced: playAdvanced, resign: resign, count: count, jumpsFrom: jumpsFrom };
});
