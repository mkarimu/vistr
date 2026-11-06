// Usernames show next to IDs, and a request can use a username. Own server on a spare port.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vistr-names-'));
const PORT = 4200 + Math.floor(Math.random() * 400), B = `http://localhost:${PORT}`;
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL: ' + m); } };
const j = async (m, p, b, t) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => ({}))]; };
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], { env: { ...process.env, PORT, VISTR_DB: path.join(dir, 'db.json'), VISTR_OPEN_SIGNUP: '1' }, stdio: 'ignore' });
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 40; i++) { try { await fetch(B + '/api/health'); break; } catch (_) { await wait(250); } }
  const [, a] = await j('POST', '/api/auth/register', { email: 'ann@names.test' });
  const [, b] = await j('POST', '/api/auth/register', { email: 'bob@names.test' });
  await j('POST', '/api/me/name', { name: 'SunnyAnn' }, a.token);
  await j('POST', '/api/me/name', { name: 'BobTheBuilder' }, b.token);
  // both must be online (event stream) and available for a request
  const ctl = new AbortController();
  for (const t of [a.token, b.token]) fetch(B + '/api/events?token=' + t, { signal: ctl.signal }).then(async r => { const rd = r.body.getReader(); for (;;) { const { done } = await rd.read(); if (done) break; } }).catch(() => {});
  await wait(600);
  await j('POST', '/api/availability', { available: true }, a.token); await j('POST', '/api/availability', { available: true }, b.token);
  const [s1, e1] = await j('POST', '/api/request', { playerCode: 'nobody_here', level: 5 }, a.token);
  ok(s1 === 404, 'unknown username is refused');
  const [s2] = await j('POST', '/api/request', { playerCode: 'bobthebuilder', level: 5, intensity: 'learner', lang: 'en' }, a.token);
  ok(s2 === 200, 'a request to a username (any case) goes through');
  const [s3, r3] = await j('POST', '/api/request/respond', { accept: true }, b.token);
  ok(s3 === 200 && r3.match.players.some(p => p.name === 'SunnyAnn') && r3.match.players.some(p => p.name === 'BobTheBuilder'), 'the match shows both usernames');
  ctl.abort();
  console.log(n + ' name checks, ' + bad + ' failed');
  srv.kill(); process.exit(bad ? 1 : 0);
})().catch(e => { console.log('ERR', e.message); srv.kill(); process.exit(1); });
