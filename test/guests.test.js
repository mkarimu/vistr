// Guest L-IDs: made by the server, no password, counted from the app and from Lite; Vistr players are counted by ID.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vistr-guests-'));
const PORT = 5200 + Math.floor(Math.random() * 400), B = `http://localhost:${PORT}`, KEY = 'testkey';
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL: ' + m); } };
const j = async (m, p, b, t) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => ({}))]; };
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], { env: { ...process.env, PORT, ADMIN_KEY: KEY, VISTR_DB: path.join(dir, 'db.json'), VISTR_OPEN_SIGNUP: '1' }, stdio: 'ignore' });
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 40; i++) { try { await fetch(B + '/api/health'); break; } catch (_) { await wait(250); } }
  const [s1, g] = await j('POST', '/api/guest/new', { src: 'app' });
  ok(s1 === 200 && /^L-\d{4,}$/.test(g.code) && g.token, 'a guest gets an L-ID and a token');
  const [, g2] = await j('POST', '/api/guest/new', { src: 'lite' });
  ok(g2.code !== g.code, 'two guests get different L-IDs');
  await j('POST', '/api/guest/ping', { guest: g.token, kind: 'open', src: 'app' });
  await j('POST', '/api/guest/ping', { guest: g.token, kind: 'play', n: 2, src: 'app' });
  await j('POST', '/api/guest/ping', { guest: g2.token, kind: 'play', n: 1, src: 'lite' });
  const [s2] = await j('POST', '/api/guest/ping', { guest: 'g_nope', kind: 'open' });
  ok(s2 === 404, 'an unknown guest token is refused');
  const [, reg] = await j('POST', '/api/auth/register', { email: 'tester@guests.test' });
  const [s3, r3] = await j('POST', '/api/guest/ping', { kind: 'play', n: 3, src: 'lite' }, reg.token);
  ok(s3 === 200 && r3.as === reg.player.code, 'a signed-in player using Lite is counted on the Vistr ID');
  const [s4] = await j('GET', '/api/admin/guests');
  ok(s4 === 403, 'the guest list needs the admin key');
  let [, list] = await j('GET', '/api/admin/guests?key=' + KEY);
  const a = list.guests.find(x => x.code === g.code), b = list.guests.find(x => x.code === g2.code);
  ok(a && a.games === 2 && a.opens === 1 && a.inApp === 2, 'app guest: opens and games counted');
  ok(b && b.inLite === 1, 'Lite guest: games counted under Lite');
  ok(list.liteUsers.some(u => u.code === reg.player.code && u.games === 3), 'the Vistr player is listed as a Lite user with 3 games');
  const [s5, c] = await j('POST', '/api/guest/claim', { guest: g.token }, reg.token);
  ok(s5 === 200 && c.ok, 'a guest can be linked to a Vistr ID');
  [, list] = await j('GET', '/api/admin/guests?key=' + KEY);
  ok(list.guests.find(x => x.code === g.code).linkedTo === reg.player.code, 'the list shows the link');
  ok(!list.guests.some(x => x.token), 'tokens are never listed');
  console.log(n + ' guest checks, ' + bad + ' failed');
  srv.kill(); process.exit(bad ? 1 : 0);
})();
