const W = require('../server/weekly.js');
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL: ' + m); } };
// the week is Monday to Sunday
ok(W.weekStart('2026-11-02') === '2026-11-02', 'Monday starts its week');
ok(W.weekStart('2026-11-08') === '2026-11-02', 'Sunday belongs to the week that started on Monday');
ok(W.weekStart('2026-11-09') === '2026-11-09', 'the next Monday starts a new week');
ok(W.daysOf('2026-11-02').length === 7 && W.daysOf('2026-11-02')[6] === '2026-11-08', 'seven days, Monday to Sunday');
// local midnight, not UTC: 2026-11-09 03:00 UTC is still Sunday evening in Los Angeles
ok(W.TZ !== 'America/Los_Angeles' || W.dayKey(Date.UTC(2026, 10, 9, 3, 0)) === '2026-11-08', 'days follow the local midnight');
// only days with 6 or more games count; totals add up day by day
const row = (id, code, daily) => ({ id, code, name: '', daily });
const d = (g, p) => ({ g, p, t: g * 1000 + p });
const rows = [
  row('a', '10', { '2026-11-02': d(6, 100), '2026-11-03': d(5, 900), '2026-11-04': d(7, 120) }),   // 5 games on the 3rd: not counted
  row('b', '11', { '2026-11-02': d(10, 300) }),
  row('c', '12', { '2026-11-02': d(3, 999) }),                                                      // never reached 6: not ranked
  row('d', '13', { '2026-11-01': d(9, 5000) }),                                                     // last week: not in this one
  row('e', '14', { '2026-11-08': d(6, 250), '2026-11-02': d(6, 50) }),                              // Sunday counts
];
const s = W.standings(rows, '2026-11-02');
ok(s.length === 3 && s[0].total === 300 && s[1].total === 300 && s[2].code === '10', 'three ranked, best totals first');
ok(s[0].code === '14' && s[1].code === '11', 'equal totals: the player with more counted days is ahead (Sunday counted)');
const a = s.find(x => x.code === '10'); ok(a.total === 220 && a.days === 2 && a.games === 18, 'only counted days add up (220 from 2 days)');
ok(!s.some(x => x.code === '12' || x.code === '13'), 'a day under 6 games, or another week, does not count');
// a tie on points goes to the player with more counted days
const t = W.standings([row('x', '1', { '2026-11-02': d(6, 50), '2026-11-03': d(6, 50) }), row('y', '2', { '2026-11-02': d(6, 100) })], '2026-11-02');
ok(t[0].code === '1', 'tie: more counted days wins');
// closing a week pays the top three once
const credits = {}, st = { champions: null }, mem = { champions: undefined };
const store = { getStats: () => st, saveStats() {}, weeklyRows: () => rows, addCredits: (id, c) => { credits[id] = (credits[id] || 0) + c; } };
const w = W.create({ store, push() {}, adminOk: () => true, send() {} });
const now = Date.UTC(2026, 10, 9, 20, 0);   // the Monday after
st.champions = { from: '2026-11-02', history: [] };
w.closeDue(now); w.closeDue(now);
ok(st.champions.history.length === 1 && st.champions.history[0].winners.length === 3, 'the week was closed once with three winners');
const sum = Object.values(credits).reduce((x, y) => x + y, 0); ok(sum === 2200, 'paid 1000 + 700 + 500, once');
ok(credits['e'] === 1000 && credits['b'] === 700 && credits['a'] === 500, 'first, second and third got 1000, 700 and 500');
console.log(n + ' weekly checks, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
