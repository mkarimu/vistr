// The SuperAgent's bots: nobody has to wait for a partner.
//
// - A player who is online, "available" and not playing, with no request open, gets a bot partner
//   after a short wait (BOT_WAIT_SECONDS, default 20). The bot sends a normal play request, so the
//   player can say yes or no. Each lone player gets a bot of their own: a second lone player gets
//   a second bot, and so on.
// - The bot plays like a person: it takes a few seconds per turn, plays real words most of the
//   time and makes the odd mistake, so it can be beaten.
// - When its player quits, the bot waits for them (BOT_LINGER_HOURS, default 2) in case they come
//   back, then it is removed. A declined request is not repeated for 10 minutes; after 3 refusals
//   in a row the bot stops asking until the player comes back another time.
// - Bots never go on the score boards, and the app shows them as "Bot".
// - VISTR_BOTS=off switches them off. GET /api/agent/status shows what they are doing
//   (the Memoryq SuperAgent reads it for SERVERASSETS).
//
// Bots use the game's own routes (request, ready, submit, skip, quit), so every game rule and
// check applies to them exactly as to people.
const num = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);

module.exports = function attachBots(ctx) {
  const { routes, streams, matches, activeMatch, requests, incoming, playerLang, playerStatus, store, dict } = ctx;
  const ENABLED = String(process.env.VISTR_BOTS || 'on').toLowerCase() !== 'off';
  const WAIT_MS = num(process.env.BOT_WAIT_SECONDS, 20) * 1000;
  const LINGER_MS = process.env.BOT_LINGER_SECONDS !== undefined
    ? num(process.env.BOT_LINGER_SECONDS, 7200) * 1000 : num(process.env.BOT_LINGER_HOURS, 2) * 3600_000;
  const MAX_BOTS = num(process.env.BOT_MAX, 50);
  const MISTAKES = num(process.env.BOT_MISTAKES, 0.12);      // share of moves that are not real words
  const THINK_MS = [num(process.env.BOT_THINK_MIN_MS, 3000), num(process.env.BOT_THINK_MAX_MS, 9000)];
  const DECLINE_PAUSE_MS = 10 * 60_000;
  const AGAIN_MS = 60_000;                                    // after a finished game
  const LEVEL = dict.LEVELS.includes(5) ? 5 : dict.LEVELS[0];

  const bots = new Map();       // bot player id -> bot
  const freeSince = new Map();  // human id -> when they became free
  const counts = { created: 0, removed: 0, games: 0 };
  const isBot = id => bots.has(id);
  const humanOnline = id => (streams.get(id)?.size || 0) > 0;
  const rand = (a, b) => a + Math.random() * (b - a);

  // A bot's player record: bot players are re-used, so the player list does not grow.
  function botPlayer() {
    for (let n = 1; n < 10_000; n++) {
      const email = `bot-${n}@bots.memoryq.com`;
      const p = store.findPlayerByEmail(email);
      if (p && !bots.has(p.id)) return p;
      if (!p) return store.createPlayer(email);
    }
    return null;
  }

  function createBot(partner) {
    if (bots.size >= MAX_BOTS) return null;
    const p = botPlayer();
    if (!p) return null;
    const b = { id: p.id, partner, createdAt: Date.now(), partnerGoneAt: null, lastAskAt: 0, pauseUntil: 0,
      declines: 0, inGame: false, asking: false, thinking: false, level: LEVEL, games: 0 };
    bots.set(p.id, b);
    counts.created++;
    console.log(`[bots] bot ${p.code} created for player ${store.getPlayer(partner)?.code}`);
    return b;
  }

  async function removeBot(b, why) {
    if (requests.has(b.id)) await call('POST /api/request/cancel', b, {});
    if (activeMatch.has(b.id)) await call('POST /api/match/quit', b, {});
    bots.delete(b.id);
    counts.removed++;
    console.log(`[bots] bot ${store.getPlayer(b.id)?.code} removed (${why})`);
  }

  // Calls one of the game's routes as the bot.
  function call(route, b, body) {
    return new Promise(resolve => {
      const res = {
        status: 0, headersSent: false,
        writeHead(s) { this.status = s; this.headersSent = true; },
        end(text) { let j = {}; try { j = JSON.parse(text || '{}'); } catch (_) {} resolve({ status: this.status, body: j }); },
        write() {},
      };
      const req = { headers: {}, socket: { remoteAddress: '127.0.0.1' }, on() {} };
      Promise.resolve(routes[route](req, res, { me: store.getPlayer(b.id), body, url: new URL('http://bot.local/') }))
        .catch(e => resolve({ status: 500, body: { error: e.message } }));
    });
  }

  async function ask(b, human) {
    b.asking = true;
    b.lastAskAt = Date.now();
    const r = await call('POST /api/request', b, {
      playerCode: store.getPlayer(human).code, level: b.level, intensity: 'intermediate', lang: playerLang.get(human) || 'en',
    });
    if (r.status !== 200) { b.asking = false; b.pauseUntil = Date.now() + AGAIN_MS; }
  }

  // ---- Playing ----
  function chooseWord(m, p) {
    const words = dict.wordsFor(m.level, m.lang);
    const options = dict.neighbours(p.current, m.lang).filter(w => !p.used.includes(w));
    if (!options.length) return null;
    if (Math.random() < MISTAKES) {        // a believable slip: one letter changed into a non-word
      const alpha = words.alphabet || 'abcdefghijklmnopqrstuvwxyz';
      for (let t = 0; t < 30; t++) {
        const i = Math.floor(Math.random() * p.current.length);
        const c = alpha[Math.floor(Math.random() * alpha.length)];
        const w = p.current.slice(0, i) + c + p.current.slice(i + 1);
        if (c !== p.current[i] && !words.has(w)) return w;
      }
    }
    const common = dict.optionsFor(m.level, m.intensity, m.lang).common;
    const everyday = common ? options.filter(w => common.has(w)) : [];
    const pool = everyday.length && Math.random() < 0.75 ? everyday : options;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function play(b, m) {
    const p = m.players[b.id];
    if (b.thinking || p.pending) return;
    b.thinking = true;
    const latest = (m.turnEndsAt || Date.now() + 20_000) - Date.now() - 2500;
    const wait = Math.max(800, Math.min(rand(THINK_MS[0], THINK_MS[1]), latest));
    setTimeout(async () => {
      try {
        if (m.status !== 'playing' || (m.mode === 'duo' && m.turn !== b.id)) return;
        const word = chooseWord(m, p);
        if (!word) { await call('POST /api/match/skip', b, {}); return; }
        const r = await call('POST /api/match/submit', b, { word, seq: p.lastSeq + 1 });
        if (r.body && (r.body.outcome === 'illegal' || r.body.outcome === 'repeat')) await call('POST /api/match/skip', b, {});
      } finally { b.thinking = false; }
    }, wait).unref?.();
  }

  // ---- Every 2 seconds: look after the lone players and the bots ----
  async function tick() {
    const now = Date.now();
    // the bots' own games and requests
    for (const b of bots.values()) {
      const m = matches.get(activeMatch.get(b.id));
      if (m && m.status !== 'over') {
        b.inGame = true; b.asking = false; b.declines = 0;
        if (m.status === 'pending' && !m.players[b.id].ready) await call('POST /api/match/ready', b, {});
        else if (m.status === 'playing' && (m.mode !== 'duo' || m.turn === b.id)) play(b, m);
        continue;
      }
      if (b.inGame) { b.inGame = false; b.games++; counts.games++; b.pauseUntil = now + AGAIN_MS; }
      if (b.asking && !requests.has(b.id)) {   // the request was declined or ran out
        b.asking = false; b.declines++;
        b.pauseUntil = now + DECLINE_PAUSE_MS;
      }
      // the partner left: wait for them, then go
      if (!humanOnline(b.partner)) {
        if (!b.partnerGoneAt) b.partnerGoneAt = now;
        b.declines = Math.min(b.declines, 2);
        if (now - b.partnerGoneAt >= LINGER_MS) await removeBot(b, 'its player left ' + Math.round(LINGER_MS / 60000) + ' minutes ago');
      } else if (b.partnerGoneAt) {
        b.partnerGoneAt = null; b.declines = 0;   // they came back: start over politely
      }
    }
    if (!ENABLED) return;
    // lone players: online, available, not playing, no request open
    for (const h of streams.keys()) {
      if (isBot(h) || !store.getPlayer(h)) continue;
      const free = humanOnline(h) && store.isAvailable(h) && playerStatus(h).status === 'free' && !requests.has(h) && !incoming.has(h);
      if (!free) { freeSince.delete(h); continue; }
      if (!freeSince.has(h)) freeSince.set(h, now);
      if (now - freeSince.get(h) < WAIT_MS) continue;
      let b = [...bots.values()].find(x => x.partner === h);
      if (!b) b = createBot(h);
      if (!b || b.asking || b.inGame || b.declines >= 3 || now < b.pauseUntil) continue;
      await ask(b, h);
    }
    for (const h of freeSince.keys()) if (!streams.has(h)) freeSince.delete(h);
  }

  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    tick().catch(e => console.warn('[bots]', e.message)).finally(() => { busy = false; });
  }, 2000);
  timer.unref?.();

  function status() {
    const list = [...bots.values()];
    const humans = [...streams.keys()].filter(id => !isBot(id) && humanOnline(id));
    let duo = 0, solo = 0;
    for (const m of matches.values()) if (m.status === 'playing') m.mode === 'duo' ? duo++ : solo++;
    return {
      enabled: ENABLED, playersOnline: humans.length, gamesPlaying: { duo, solo },
      bots: list.length, botsPlaying: list.filter(b => activeMatch.has(b.id)).length,
      botsWaitingForTheirPlayer: list.filter(b => b.partnerGoneAt).length,
      botsCreated: counts.created, botsRemoved: counts.removed, botGames: counts.games,
      settings: { waitSeconds: WAIT_MS / 1000, lingerMinutes: Math.round(LINGER_MS / 60000), maxBots: MAX_BOTS },
    };
  }

  return { isBot, status, tick, stop: () => clearInterval(timer) };
};
