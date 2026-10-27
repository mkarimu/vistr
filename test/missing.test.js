// Vistr as the games home: node test/missing.test.js
// Spot What's Missing is served at /missing/ (its data lives on memoryq.com), new players join with Memoryq, players who
// already have an ID still sign in, the Android app keeps email sign-up, and the old admin page points to memoryq.com.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3990 + Math.floor(Math.random() * 9);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vistr-missing-'));
let failures = 0;
const ok = (name, cond) => { console.log((cond ? '  ok    ' : '  FAIL  ') + name); if (!cond) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const post = (p, body, token) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

(async () => {
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', VISTR_DB: path.join(tmp, 'db.json'), ADMIN_KEY: 'test' };
  delete env.UPSTASH_REDIS_REST_URL; delete env.UPSTASH_REDIS_REST_TOKEN; delete env.VISTR_OPEN_SIGNUP;
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
  try {
    for (let i = 0; i < 60 && !log.includes('Vistr server running'); i++) await sleep(250);
    console.log('-- The games home --');
    let r = await fetch(BASE + '/missing/');
    const html = await r.text();
    ok('Spot What\'s Missing is served at /missing/', r.status === 200 && html.includes('missing.js') && !html.includes('ad-banner'));
    r = await fetch(BASE + '/missing', { redirect: 'manual' });
    ok('/missing goes to /missing/ (its links are relative)', r.status === 301 && r.headers.get('location') === '/missing/');
    r = await fetch(BASE + '/missing/audio/index.json');
    const clips = await r.json();
    ok('spoken clips in English and Kiswahili', clips.en['Pupil'] && clips.sw['Mboni'] && (await fetch(BASE + '/missing/audio/' + clips.en['Pupil'])).headers.get('content-type') === 'audio/mpeg');
    r = await fetch(BASE + '/missing/carers-guide.pdf');
    ok('the guide for carers (PDF)', r.status === 200 && r.headers.get('content-type') === 'application/pdf');
    const home = await (await fetch(BASE + '/')).text();
    ok('the word game\'s home links to the new game', home.includes('href="missing/"'));
    const admin = await (await fetch(BASE + '/admin.html')).text();
    ok('the old admin page sends you to memoryq.com', admin.includes('https://memoryq.com/admin#games/vistr'));
    r = await fetch(BASE + '/missing/../server/server.js');
    ok('no files outside the game', r.status !== 200);

    console.log('-- One account for all games --');
    r = await post('/api/auth/register', { email: 'new.person@example.com' });
    ok('a new player is asked to join with Memoryq', r.status === 403 && r.body.memoryq === true);
    r = await post('/api/auth/register', { email: 'phone.player@example.com', native: 1 });
    ok('the Android app still makes an ID with an email (until it can open memoryq.com)', r.status === 200 && r.body.isNew === true && r.body.player.mq === '');
    const token = r.body.token, code = r.body.player.code;
    r = await post('/api/auth/register', { email: 'phone.player@example.com' });
    ok('a player who has an ID still signs in with their email', r.status === 200 && r.body.player.code === code && !r.body.isNew);
    r = await post('/api/auth/id', { code });
    ok('... or with their Player ID', r.status === 200 && r.body.player.mq === '');
    r = await fetch(BASE + '/api/me', { headers: { Authorization: 'Bearer ' + token } }).then(x => x.json());
    ok('the game knows the ID is not linked yet (it invites to link)', r.player.mq === '');
    console.log('-- Game IDs given from memoryq.com --');
    r = await post('/api/admin/player/assign?key=wrong', { mq: 'neema', email: 'neema@example.com' });
    ok('only with the admin key', r.status === 403);
    r = await post('/api/admin/player/assign?key=test', { mq: 'neema', email: 'neema@example.com', code: '77' });
    ok('a member gets the Player ID asked for (a new player, linked)', r.status === 200 && r.body.player.code === '77' && r.body.player.mq === 'neema' && r.body.made === true);
    r = await post('/api/admin/player/assign?key=test', { mq: 'neema', email: 'neema@example.com', code: '78' });
    ok('asked again: the same player gets the new number', r.status === 200 && r.body.player.code === '78' && r.body.made === false);
    r = await post('/api/admin/player/assign?key=test', { mq: 'baraka', email: 'phone.player@example.com' });
    ok('a player with the same email (not linked yet) becomes theirs', r.status === 200 && r.body.player.code === code && r.body.made === false);
    r = await post('/api/admin/player/assign?key=test', { mq: 'juma', email: 'juma@example.com', code: '78' });
    ok('a number someone else has is refused (and nothing is made)', r.status === 409);
    r = await post('/api/admin/player/assign?key=test', { mq: 'juma', email: 'not-an-email' });
    ok('a game ID needs an email', r.status === 400);
    r = await post('/api/auth/memoryq', { code: 'x'.repeat(24), link: true });
    ok('linking needs the player to be signed in', r.status === 401 || r.status === 502);
  } catch (e) {
    console.log('ERROR', e); failures++;
  } finally {
    srv.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failures ? `${failures} CHECK(S) FAILED` : 'ALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
