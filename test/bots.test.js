// End-to-end test of the SuperAgent's bots: node test/bots.test.js
// Starts the real game server (fast settings) and plays against the bots as real players would.
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dict = require('../server/dictionary');

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vistr-bots-'));
let failures = 0;
const ok = (name, cond) => { console.log((cond ? '  ok    ' : '  FAIL  ') + name); if (!cond) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(method, p, token, body) {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

// A player with a live event stream (what the app keeps open).
function connect(token) {
  const events = [];
  const waiters = [];
  const req = http.get(`${BASE}/api/events?token=${token}&lang=en`, res => {
    let buf = '';
    res.on('data', c => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i); buf = buf.slice(i + 2);
        const type = (frame.match(/^event: (.*)$/m) || [])[1];
        const data = (frame.match(/^data: (.*)$/m) || [])[1];
        if (!type) continue;
        const ev = { type, data: data ? JSON.parse(data) : {} };
        events.push(ev);
        for (const w of [...waiters]) if (w.test(ev)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(ev); }
      }
    });
  });
  req.on('error', () => {});
  return {
    events,
    close: () => req.destroy(),
    wait(test, ms = 15000) {
      const found = events.find(test);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const w = { test, resolve };
        waiters.push(w);
        setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); reject(new Error('timed out')); } }, ms);
      });
    },
  };
}

async function signIn(email) {
  const r = await api('POST', '/api/auth/register', null, { email });
  return { token: r.body.token, code: r.body.player.code };
}

(async () => {
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', VISTR_DB: path.join(tmp, 'db.json'), ADMIN_KEY: 'test',
    BOT_WAIT_SECONDS: '1', BOT_THINK_MIN_MS: '300', BOT_THINK_MAX_MS: '600', BOT_MISTAKES: '0', BOT_LINGER_SECONDS: '5',
    TURN_SECONDS: '10', ROUND_SECONDS: '90' };
  delete env.UPSTASH_REDIS_REST_URL; delete env.UPSTASH_REDIS_REST_TOKEN;
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
  try {
    for (let i = 0; i < 60; i++) { try { if ((await api('GET', '/api/health')).status === 200) break; } catch (_) {} await sleep(250); }

    console.log('-- A lone player gets a bot partner --');
    const ann = await signIn('ann@example.com');
    const a = connect(ann.token);
    const req = await a.wait(e => e.type === 'request', 12000).catch(() => null);
    ok('a bot asks the lone player to play', !!req && req.data.bot === true && req.data.level === 5);
    const botCode = req && req.data.from;
    let st = (await api('GET', '/api/agent/status')).body;
    ok('the status shows one bot for one player online', st.bots === 1 && st.playersOnline === 1);
    const acc = await api('POST', '/api/request/respond', ann.token, { accept: true });
    ok('the player accepts', acc.status === 200 && acc.body.match.mode === 'duo');
    ok('the app sees the opponent is a bot', acc.body.match.players.some(p => p.bot && p.playerCode === botCode));
    await api('POST', '/api/match/ready', ann.token);
    const start = await a.wait(e => e.type === 'match-start', 8000).catch(() => null);
    ok('the bot gets ready and the game starts', !!start && start.data.status === 'playing');

    // play a few turns: when it's ours, play a real unused word
    const used = new Set([start.data.startWord]);
    let botMoves = 0, myMoves = 0, current = start.data.current, myTurn = start.data.myTurn;
    const deadline = Date.now() + 40000;
    let seen = a.events.length;
    while (Date.now() < deadline && (botMoves < 2 || myMoves < 2)) {
      if (myTurn) {
        const opts = dict.neighbours(current, 'en').filter(w => !used.has(w));
        const word = opts[0];
        if (!word) { await api('POST', '/api/match/skip', ann.token); } else {
          const r = await api('POST', '/api/match/submit', ann.token, { word, seq: myMoves + 1 });
          used.add(word);
          if (r.body.outcome === 'valid') myMoves++;
        }
        myTurn = false;
      }
      await sleep(100);
      for (; seen < a.events.length; seen++) {
        const ev = a.events[seen];
        if (ev.type !== 'board') continue;
        current = ev.data.current; myTurn = ev.data.myTurn; used.add(current);
        if (ev.data.last && ev.data.last.by === botCode) { botMoves++; if (ev.data.last.word) used.add(ev.data.last.word); }
      }
    }
    ok('the bot takes its turns with real words', botMoves >= 2);
    ok('and the player keeps playing', myMoves >= 2);
    await api('POST', '/api/match/quit', ann.token);
    const over = await a.wait(e => e.type === 'match-over', 5000).catch(() => null);
    ok('the game ends normally', !!over);
    const scores = await api('GET', '/api/scores?level=5', ann.token);
    ok('the player is on the score board, the bot is not', scores.body.board.some(b => b.playerCode === ann.code) && !scores.body.board.some(b => b.playerCode === botCode));

    console.log('-- A second lone player gets a second bot --');
    const ben = await signIn('ben@example.com');
    const b = connect(ben.token);
    const req2 = await b.wait(e => e.type === 'request', 12000).catch(() => null);
    ok('a different bot asks the new player', !!req2 && req2.data.bot === true && req2.data.from !== botCode);
    await api('POST', '/api/request/respond', ben.token, { accept: false });
    await sleep(4500);
    ok('after a "no" the bot does not ask again at once', b.events.filter(e => e.type === 'request').length === 1);
    st = (await api('GET', '/api/agent/status')).body;
    ok('two players, two bots', st.bots === 2 && st.playersOnline === 2 && st.botGames >= 1);

    console.log('-- When a player quits, the bot waits, then is removed --');
    a.close();
    await sleep(4500);
    st = (await api('GET', '/api/agent/status')).body;
    ok('the bot waits for its player for a while', st.bots === 2 && st.botsWaitingForTheirPlayer === 1);
    await sleep(6000);
    st = (await api('GET', '/api/agent/status')).body;
    ok('then it is removed; the other bot stays', st.bots === 1 && st.botsRemoved === 1);
    b.close();
  } catch (e) {
    console.error(e); failures++;
  } finally {
    srv.kill();
    if (failures) console.log('\n--- server log ---\n' + log.slice(-3000));
    console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL BOT CHECKS PASSED');
    process.exit(failures ? 1 : 0);
  }
})();
