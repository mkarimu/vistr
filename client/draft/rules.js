/* Vistr Draft - pure rules (no DOM). 8 columns x 9 rows. A starts at the bottom, B at the top. */
(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(); else root.DraftRules = f(); })(this, function () {
  var W = 8, H = 9;
  function dark(r, c) { return (r + c) % 2 === 1; }
  function fwd(p) { return p === 'A' ? -1 : 1; }
  function other(p) { return p === 'A' ? 'B' : 'A'; }
  function inb(r, c) { return r >= 0 && r < H && c >= 0 && c < W; }
  function newGame() {
    var b = [], r, c;
    for (r = 0; r < H; r++) { b.push([]); for (c = 0; c < W; c++) b[r].push(dark(r, c) && r < 3 ? 'B' : dark(r, c) && r > 5 ? 'A' : ''); }
    return { b: b, turn: 'A', chain: null, winner: '' };
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
  function play(g, fr, fc, tr, tc) {
    var m = legal(g).filter(function (x) { return x.fr === fr && x.fc === fc && x.tr === tr && x.tc === tc; })[0];
    if (!m) return null;
    var n = { b: g.b.map(function (r) { return r.slice(); }), turn: g.turn, chain: null, winner: '' };
    n.b[tr][tc] = n.b[fr][fc]; n.b[fr][fc] = '';
    if (m.cap) { n.b[m.cap[0]][m.cap[1]] = ''; if (jumpsFrom(n.b, tr, tc).length) { n.chain = [tr, tc]; return n; } }
    n.turn = other(g.turn);
    if (!legal(n).length) n.winner = g.turn;
    return n;
  }
  return { W: W, H: H, dark: dark, newGame: newGame, legal: legal, play: play, count: count, jumpsFrom: jumpsFrom };
});
