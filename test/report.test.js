// Games per player per day (the performance report's data): node test/report.test.js
const fs = require('fs'), os = require('os'), path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vistr-report-'));
process.env.VISTR_DB = path.join(tmp, 'db.json');
const store = require('../server/store');
let failures = 0;
const ok = (name, cond) => { console.log((cond ? '  ok    ' : '  FAIL  ') + name); if (!cond) failures++; };
(async () => {
  await store.ready;
  const a = store.createPlayer('anna@example.com'), b = store.createPlayer('ben@example.com');
  const today = new Date().toISOString().slice(0, 10);
  const play = (id, score) => store.recordGame({ level: 5, intensity: 'learner', lang: 'en', mode: 'solo', players: [{ id, score, words: 3 }] });
  play(a.id, 12); play(a.id, 7); play(b.id, 5);
  let r = store.playReport('2000-01-01', '2999-12-31').players;
  ok('games are counted per player per day', r[a.code] && r[a.code].days[today] === 2 && r[b.code].days[today] === 1);
  ok('the player record still adds up', store.recordView(a.id).games === 2);
  ok('only the asked dates are returned', Object.keys(store.playReport('2000-01-01', '2000-01-31').players).length === 0);
  ok('a day outside the range is left out', Object.keys(store.playReport(today, today).players).length === 2);
  store.setName(a.id, 'Anna W');
  ok('the name seen on the game comes with it', store.playReport(today, today).players[a.code].name === 'Anna W');
  // every finished game is logged (level, points, solo/2-player, app/web); days are cut in Los Angeles time
  const full = store.playReport('2000-01-01', '2999-12-31');
  ok('the report says which time zone cut the days', full.tz === 'America/Los_Angeles');
  ok('while the log is less than a day old, days come from the older counts', full.logFrom !== '' && Object.values(full.players).every(x => x.plays.length === 0));
  store._testPlaysSince(Date.now() - 3 * 86400_000);   // pretend the log started 3 days ago: today is now a logged day
  const dayLA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
  store.recordGame({ level: 3, intensity: 'learner', lang: 'en', mode: 'solo', players: [{ id: b.id, score: 9, words: 2, plat: 'app' }] });
  store.recordGame({ level: 7, intensity: 'learner', lang: 'en', mode: 'duo', players: [{ id: b.id, score: 4, words: 1, plat: 'web' }, { id: a.id, score: 6, words: 2, plat: 'web' }] });
  const lg = store.playReport(dayLA, dayLA);
  const pb = lg.players[b.code];
  ok('from the first full day on, each game is listed with level, points and app or web', pb.plays.length === 3 && pb.plays[0].lv === 5 && pb.plays[0].p === 'web' && pb.plays[1].lv === 3 && pb.plays[1].sc === 9 && pb.plays[1].p === 'app' && pb.plays[2].lv === 7 && pb.plays[2].m === 'duo');
  ok('the day total, points and time come from the log', pb.days[dayLA] === 3 && pb.daily[dayLA].p === 18 && pb.daily[dayLA].t > 0);
  ok("the report's today is the Los Angeles date", lg.today === dayLA);
  ok('a different time zone cuts the days its own way', store.playReport(dayLA, dayLA, 'Pacific/Kiritimati').tz === 'Pacific/Kiritimati');
  ok('an unknown time zone falls back to Los Angeles', store.playReport(dayLA, dayLA, 'Not/AZone').tz === 'America/Los_Angeles');
  console.log(failures ? failures + ' FAILED' : 'All checks passed.');
  process.exit(failures ? 1 : 0);
})();
