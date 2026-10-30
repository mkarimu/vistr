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
  let r = store.playReport('2000-01-01', '2999-12-31');
  ok('games are counted per player per day', r[a.code] && r[a.code].days[today] === 2 && r[b.code].days[today] === 1);
  ok('the player record still adds up', store.recordView(a.id).games === 2);
  ok('only the asked dates are returned', Object.keys(store.playReport('2000-01-01', '2000-01-31')).length === 0);
  ok('a day outside the range is left out', Object.keys(store.playReport(today, today)).length === 2);
  store.setName(a.id, 'Anna W');
  ok('the name seen on the game comes with it', store.playReport(today, today)[a.code].name === 'Anna W');
  console.log(failures ? failures + ' FAILED' : 'All checks passed.');
  process.exit(failures ? 1 : 0);
})();
