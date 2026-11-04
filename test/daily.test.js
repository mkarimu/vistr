// Daily Challenge: clocks, solvable pairs, the unlock, the attempt log, prizes and tie-breaks.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const D = require('../server/daily.js'), W = require('../server/weekly.js');
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL: ' + m); } };

// ---- the clock: 4 letters 4:00, 5 letters 4:30, 6 letters 5:00, 7 letters 5:30; each re-attempt takes a minute off
ok(D.secondsFor(4, 1) === 240 && D.secondsFor(5, 1) === 270 && D.secondsFor(6, 1) === 300 && D.secondsFor(7, 1) === 330, 'first attempt clocks');
ok(D.secondsFor(4, 2) === 180 && D.secondsFor(6, 3) === 180, 're-attempts lose a minute each');
ok(D.secondsFor(4, 9) === 60 && D.secondsFor(7, 20) === 60, 'never below one minute');
ok(D.secondsFor(5, 1, true) === 405, 'a head-to-head pair gets 1.5 times');
// ---- pairs: the same for everyone, and solvable
for (const L of D.LENS) {
  const a = D.makePair('2026-11-03:' + L, L), b = D.makePair('2026-11-03:' + L, L), c = D.makePair('2026-11-04:' + L, L);
  ok(a && a.start.length === L && a.target.length === L && a.start !== a.target, L + ' letters: a pair');
  ok(a.start === b.start && a.target === b.target, L + ' letters: the same pair for everyone on a day');
  ok(a.way[0] === a.start && a.way[a.way.length - 1] === a.target && a.way.length - 1 === a.best, L + ' letters: a way exists (' + a.best + ' steps)');
  ok(c.start !== a.start || c.target !== a.target, L + ' letters: another day, another pair');
}

// ---- prizes and ties with a small fake store
function fake() {
  const players = {}, credits = {}, stats = {};
  for (const [id, code] of [['a', '10'], ['b', '11'], ['c', '12'], ['d', '13']]) players[id] = { id, code, name: '', email: id + '@x.com' };
  return { credits, store: { getStats: () => stats, saveStats() {}, getPlayer: id => players[id], addCredits: (id, c) => { credits[id] = (credits[id] || 0) + c; }, todayGames: () => 0 } };
}
const att = (pid, len, steps, secs, solved = true) => ({ pid, code: pid, kind: 'daily', len, n: 1, at: 1, limit: 240, solved, steps, secs, ended: true });
{
  const f = fake(), d = D.create({ store: f.store, push() {}, adminOk: () => true, send() {} });
  const day = '2026-11-01', now = Date.UTC(2026, 10, 3, 20, 0);
  f.store.getStats().daily = { from: day, days: {}, ties: [] };
  d.dayRec(day).attempts.push(att('a', 4, 3, 40), att('b', 4, 4, 50), att('c', 4, 5, 60), att('d', 4, 6, 70), att('d', 5, 4, 80));
  d.closeDue(now);
  const rec = d.dayRec(day);
  ok(rec.closed && f.credits.d === 1000, 'most lengths solved wins first place (1000)');
  ok(f.credits.a === 700 && f.credits.b === 500 && !f.credits.c, 'second and third get 700 and 500');
  const before = JSON.stringify(f.credits); d.closeDue(now); ok(JSON.stringify(f.credits) === before, 'a day is paid once');
}
{
  const f = fake(), d = D.create({ store: f.store, push() {}, adminOk: () => true, send() {} });
  const day = '2026-11-01', now = Date.UTC(2026, 10, 3, 20, 0);
  f.store.getStats().daily = { from: day, days: {}, ties: [] };
  d.dayRec(day).attempts.push(att('a', 4, 3, 40), att('b', 4, 3, 40), att('c', 4, 5, 60));   // a and b tie for first
  d.closeDue(now);
  const ties = f.store.getStats().daily.ties;
  ok(ties.length === 1 && ties[0].players.length === 2 && !f.credits.a && !f.credits.b, 'a tie parks the tie-break and holds those prizes');
  ok(f.credits.c === 500, 'the clear third place is paid at once');
  ok(ties[0].pair && ties[0].pair.len === 5 && ties[0].expires - now === 48 * 3600_000, 'a fresh pair waits for 48 hours');
  ties[0].attempts.push(att('a', 5, 6, 90), att('b', 5, 4, 100));
  d.closeDue(now + 3600_000);
  ok(f.credits.b === 1000 && f.credits.a === 700, 'the tie-break decides: fewer steps wins 1000, the other 700');
}
{
  const f = fake(), d = D.create({ store: f.store, push() {}, adminOk: () => true, send() {} });
  const day = '2026-11-01'; f.store.getStats().daily = { from: day, days: {}, ties: [] };
  d.dayRec(day).attempts.push(att('a', 4, 3, 40), att('b', 4, 3, 40));
  d.closeDue(Date.UTC(2026, 10, 3, 20, 0));
  d.closeDue(Date.UTC(2026, 10, 3, 20, 0) + 49 * 3600_000);
  ok(f.store.getStats().daily.ties[0].resolved === true && (f.credits.a || 0) + (f.credits.b || 0) === 1700, 'nobody played the tie-break: it ends after 48 hours and the prizes are still paid');
}

// ---- through the real server: locked, then a full play
async function run(env, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vistr-daily-')), PORT = 3800 + Math.floor(Math.random() * 300), B = `http://localhost:${PORT}`;
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], { env: { ...process.env, ...env, PORT, VISTR_DB: path.join(dir, 'db.json'), VISTR_OPEN_SIGNUP: '1' }, stdio: 'ignore' });
  const j = async (m, p, b, t) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => ({}))]; };
  for (let i = 0; i < 40; i++) { try { await fetch(B + '/api/health'); break; } catch (_) { await new Promise(r => setTimeout(r, 250)); } }
  try { const [, a] = await j('POST', '/api/auth/register', { email: 'dan@example.com' }); await body(j, a.token); } finally { srv.kill(); }
}
(async () => {
  await run({}, async (j, t) => {
    const [s, g] = await j('GET', '/api/daily', null, t);
    ok(s === 200 && g.unlocked === false && g.toUnlock === 6 && g.lens.length === 4, 'locked until 6 games are played');
    ok((await j('POST', '/api/daily/start', { len: 4 }, t))[0] === 403, 'cannot start while locked');
  });
  await run({ DAILY_NEED_GAMES: '0' }, async (j, t) => {
    const [, g] = await j('GET', '/api/daily', null, t); ok(g.unlocked, 'unlocked');
    const L = g.lens[0], pair = D.makePair(g.day + ':4', 4);
    ok(L.start === pair.start && L.target === pair.target && L.seconds === 240, 'the server gives today\'s pair and a 4:00 clock');
    let [s, r] = await j('POST', '/api/daily/start', { len: 4 }, t); ok(s === 200 && r.attempt === 1 && r.seconds === 240, 'attempt 1');
    [s, r] = await j('POST', '/api/daily/move', { word: 'zzzz' }, t); ok(r.ok === false && r.reason === 'notword', 'not a word');
    [s, r] = await j('POST', '/api/daily/move', { word: pair.target }, t); ok(r.ok === false && r.reason === 'oneletter', 'only one letter at a time');
    // quit, and the second attempt has a minute less
    await j('POST', '/api/daily/quit', {}, t);
    [s, r] = await j('POST', '/api/daily/start', { len: 4 }, t); ok(r.attempt === 2 && r.seconds === 180, 'attempt 2 has 3:00');
    for (const w of pair.way.slice(1)) { [s, r] = await j('POST', '/api/daily/move', { word: w }, t); }
    ok(r.solved === true && r.count === pair.best, 'solved in ' + pair.best + ' steps');
    const [, after] = await j('GET', '/api/daily', null, t);
    ok(after.lens[0].attempts === 2 && after.lens[0].solved && after.board.length === 1 && after.board[0].lens === 1, 'the log and the board remember it');
    ok(after.lens[0].seconds === 120, 'the next attempt would have 2:00');
  });
  console.log(n + ' daily checks, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
