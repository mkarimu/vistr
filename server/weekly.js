'use strict';
// Weekly Champions. A week runs Monday 00:00 to Sunday midnight in WEEK_TZ (default America/Los_Angeles).
// A day COUNTS for a player only when they finished at least MIN_GAMES games that day (6). A player's weekly total
// is the points from their counted days, added up day by day. When a week closes, the top three get 1000, 700 and 500
// credits (kept on the player; turned into gifts by hand at the end of the test). Credits start with the first week
// that begins after this was switched on.
const TZ = process.env.WEEK_TZ || 'America/Los_Angeles';
const MIN_GAMES = Number(process.env.WEEK_MIN_GAMES || 6);
const AWARDS = [1000, 700, 500];

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
function dayKey(ms) { return fmt.format(ms); }                       // 'YYYY-MM-DD' in the week's time zone
const addDays = (key, n) => { const d = new Date(key + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function weekStart(key) { const d = new Date(key + 'T00:00:00Z'); return addDays(key, -((d.getUTCDay() + 6) % 7)); }   // the Monday
function daysOf(start) { return [0, 1, 2, 3, 4, 5, 6].map(i => addDays(start, i)); }

// rows: [{ id, code, name, daily: { 'YYYY-MM-DD': { g, p, t } } }]
function standings(rows, start, minGames = MIN_GAMES) {
  const days = daysOf(start), out = [];
  for (const r of rows) {
    let total = 0, counted = 0, games = 0, last = 0;
    for (const d of days) {
      const x = r.daily && r.daily[d]; if (!x) continue;
      games += x.g;
      if (x.g >= minGames) { counted++; total += x.p; last = Math.max(last, x.t || 0); }
    }
    if (counted) out.push({ id: r.id, code: r.code, name: r.name || '', total, days: counted, games, last });
  }
  out.sort((a, b) => b.total - a.total || b.days - a.days || a.last - b.last);
  out.forEach((x, i) => { x.rank = i + 1; });
  return out;
}

function create({ store, push, adminOk, send }) {
  const state = () => { const st = (store.getStats().champions = store.getStats().champions || { from: '', history: [] }); return st; };
  // Close every finished week that has not been paid yet (idempotent: each week is paid once).
  function closeDue(now = Date.now()) {
    const st = state(), today = dayKey(now), thisWeek = weekStart(today);
    if (!st.from) { st.from = thisWeek; store.saveStats(); }
    let w = st.from, changed = false;
    while (w < thisWeek) {
      if (!st.history.some(h => h.week === w)) {
        const top = standings(store.weeklyRows(), w).slice(0, AWARDS.length);
        const winners = top.map((t, i) => ({ rank: i + 1, code: t.code, name: t.name, total: t.total, days: t.days, credits: AWARDS[i] }));
        top.forEach((t, i) => { store.addCredits(t.id, AWARDS[i]); if (push) push(t.id, 'champion', { week: w, rank: i + 1, credits: AWARDS[i] }); });
        st.history.push({ week: w, winners }); changed = true;
        console.log(`[champions] week ${w}: ` + (winners.map(x => `#${x.rank} Player ${x.code} (${x.total} pts, +${x.credits})`).join(', ') || 'no one reached 6 games on a day'));
      }
      w = addDays(w, 7);
    }
    if (changed) store.saveStats();
  }
  const routes = {
    'GET /api/champions': async (req, res, { me }) => {
      closeDue();
      const st = state(), now = Date.now(), today = dayKey(now), start = weekStart(today), rows = store.weeklyRows();
      const all = standings(rows, start), mine = all.find(x => x.id === me.id);
      const row = rows.find(r => r.id === me.id), td = (row && row.daily && row.daily[today]) || { g: 0, p: 0 };
      const days = daysOf(start).map(d => { const x = row && row.daily && row.daily[d]; return { day: d, games: x ? x.g : 0, points: x ? x.p : 0, counted: !!x && x.g >= MIN_GAMES }; });
      send(res, 200, {
        tz: TZ, minGames: MIN_GAMES, awards: AWARDS, week: { start, end: addDays(start, 6), today },
        top: all.slice(0, 10).map(x => ({ rank: x.rank, code: x.code, name: x.name, total: x.total, days: x.days, me: x.id === me.id })),
        me: { code: me.code, rank: mine ? mine.rank : 0, total: mine ? mine.total : 0, days, todayGames: td.g, toGoToday: Math.max(0, MIN_GAMES - td.g), credits: store.getCredits(me.id) },
        last: st.history.length ? st.history[st.history.length - 1] : null,
        history: st.history.slice(-8).reverse(),
      });
    },
    // credits per player, for turning them into gifts at the end of the test (admin key)
    'GET /api/admin/credits': async (req, res, { url }) => {
      if (!adminOk(url)) return send(res, 403, { error: 'Wrong admin key.' });
      send(res, 200, { players: store.creditList(), history: state().history });
    },
  };
  return { routes, closeDue, state };
}
module.exports = { create, standings, dayKey, weekStart, daysOf, addDays, TZ, MIN_GAMES, AWARDS };
