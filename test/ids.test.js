// One device per player; "Delete my Player ID" only sets the account aside until an admin deletes it; freed IDs are reused.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vistr-ids-'));
const PORT = 4700 + Math.floor(Math.random() * 400), B = `http://localhost:${PORT}`, KEY = 'testkey';
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL: ' + m); } };
const j = async (m, p, b, t) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => ({}))]; };
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], { env: { ...process.env, PORT, ADMIN_KEY: KEY, VISTR_DB: path.join(dir, 'db.json'), VISTR_OPEN_SIGNUP: '1' }, stdio: 'ignore' });
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 40; i++) { try { await fetch(B + '/api/health'); break; } catch (_) { await wait(250); } }
  const [, a] = await j('POST', '/api/auth/register', { email: 'a@ids.test' });
  const [, b] = await j('POST', '/api/auth/register', { email: 'b@ids.test' });
  const [, c] = await j('POST', '/api/auth/register', { email: 'c@ids.test' });
  const codeB = b.player.code;
  // one device at a time
  const [s0, b2] = await j('POST', '/api/auth/id', { code: codeB, email: 'b@ids.test' });
  ok(s0 === 200, 'sign in with ID and email');
  const [s1, e1] = await j('GET', '/api/me', null, b.token);
  ok(s1 === 401 && e1.code === 'other-device', 'the first device is signed out when the same player signs in elsewhere');
  // "delete my ID" = pending
  const [s2, r2] = await j('POST', '/api/account/delete', { code: codeB }, b2.token);
  ok(s2 === 200 && r2.pending === true, 'player removal is pending, not final');
  const [s3] = await j('GET', '/api/me', null, b2.token);
  ok(s3 === 401, 'the player is signed out after asking to be removed');
  let [, list] = await j('GET', '/api/admin/players?key=' + KEY);
  const pb = list.players.find(p => p.playerCode === codeB);
  ok(pb && pb.deleteRequested, 'the admin list still shows the player, marked as waiting for deletion');
  // changing their mind: signing in again keeps the account
  const [s4, b3] = await j('POST', '/api/auth/id', { code: codeB, email: 'b@ids.test' });
  ok(s4 === 200, 'a player waiting for deletion can sign in again');
  [, list] = await j('GET', '/api/admin/players?key=' + KEY);
  ok(!list.players.find(p => p.playerCode === codeB).deleteRequested, 'signing in again cancels the removal');
  // same email keeps the same ID
  ok(b3.player.code === codeB, 'the ID stays with the player');
  // admin deletes for good: the number goes back to the pool and fills the gap
  await j('POST', '/api/account/delete', { code: codeB }, b3.token);
  const [s5] = await j('POST', '/api/admin/player/delete?key=' + KEY, { code: codeB });
  ok(s5 === 200, 'admin deletes the player for good');
  const [, d] = await j('POST', '/api/auth/register', { email: 'd@ids.test' });
  ok(d.player.code === codeB, `the freed ID is given to the next new player (got ${d.player.code}, expected ${codeB})`);
  const [, e] = await j('POST', '/api/auth/register', { email: 'e@ids.test' });
  ok(Number(e.player.code) > Number(c.player.code), 'after the gap is filled, numbering continues upward');
  console.log(n + ' id checks, ' + bad + ' failed');
  srv.kill(); process.exit(bad ? 1 : 0);
})();
