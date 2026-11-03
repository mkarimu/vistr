// One device per player; an ID signs in only with its email. Starts its own server on a spare port.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vistr-dev-'));
const PORT = 3400 + Math.floor(Math.random() * 400), B = `http://localhost:${PORT}`;
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL: ' + m); } };
const j = async (m, p, b, t) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => ({}))]; };
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], { env: { ...process.env, PORT, VISTR_DB: path.join(dir, 'db.json'), VISTR_OPEN_SIGNUP: '1' }, stdio: 'ignore' });
(async () => {
  for (let i = 0; i < 40; i++) { try { await fetch(B + '/api/health'); break; } catch (_) { await new Promise(r => setTimeout(r, 250)); } }
  const [, a] = await j('POST', '/api/auth/register', { email: 'Ann@Example.com' });
  const code = a.player.code, t1 = a.token;
  ok((await j('GET', '/api/me', null, t1))[0] === 200, 'first phone works');
  // a second phone, with the right email: the first is signed out
  let [s, r2] = await j('POST', '/api/auth/id', { code, email: 'ann@example.com' });
  ok(s === 200 && r2.token, 'ID + email signs in');
  const [s1, e1] = await j('GET', '/api/me', null, t1);
  ok(s1 === 401 && e1.code === 'other-device', 'first phone is told it was signed in elsewhere');
  ok((await j('GET', '/api/me', null, r2.token))[0] === 200, 'second phone works');
  // the ID alone, or the wrong email, does not sign in
  [s, r2] = await j('POST', '/api/auth/id', { code });
  ok(s === 400 && r2.needEmail, 'ID alone asks for the email');
  [s] = await j('POST', '/api/auth/id', { code, email: 'someone@else.com' });
  ok(s === 403, 'wrong email refused');
  // the same email always gives the same ID; another email gets another ID
  const [, again] = await j('POST', '/api/auth/register', { email: 'ann@example.com' });
  ok(again.player.code === code, 'one email, one ID');
  const [, other] = await j('POST', '/api/auth/register', { email: 'bob@example.com' });
  ok(other.player.code !== code, 'another email, another ID');
  // the live stream of the old phone gets the message
  const [, c] = await j('POST', '/api/auth/id', { code: other.player.code, email: 'bob@example.com' });
  let got = '';
  const ctl = new AbortController();
  fetch(B + '/api/events?token=' + c.token, { signal: ctl.signal }).then(async r => { const rd = r.body.getReader(), d = new TextDecoder(); for (;;) { const { value, done } = await rd.read(); if (done) break; got += d.decode(value); } }).catch(() => {});
  await new Promise(r => setTimeout(r, 600));
  const [, c3] = await j('POST', '/api/auth/id', { code: other.player.code, email: 'bob@example.com' });
  await new Promise(r => setTimeout(r, 600));
  ok(got.includes('signed-out-elsewhere'), 'old phone stream gets signed-out-elsewhere');
  ctl.abort();
  const [cs, ch] = await j('GET', '/api/champions', null, c3.token);
  ok(cs === 200 && ch.minGames === 6 && ch.awards.join() === '1000,700,500' && Array.isArray(ch.top) && ch.me.toGoToday === 6, 'the champions route answers (6 games to count today)');
  console.log(n + ' device checks, ' + bad + ' failed');
  srv.kill(); process.exit(bad ? 1 : 0);
})().catch(e => { console.log('ERR', e.message); srv.kill(); process.exit(1); });
