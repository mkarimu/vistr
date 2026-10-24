// Vistr Word Game — starter server. Zero dependencies: Node 18+ only.
//   node server/server.js            → http://localhost:3000
// Serves the game client (../client) and the JSON + live-event API it uses.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
let dict;
try {
  dict = require('./dictionary');
} catch (e) {
  console.error(`\nCan't start: the word lists could not be loaded (${e.message}).`);
  console.error('Check that the folder client\\words sits next to the server folder, with files like words_5.txt.');
  console.error('If you extracted an update over an old copy, extract the whole zip again.\n');
  process.exit(1);
}
const scoring = require('./scoring');
const engine = require('../client/engine');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || undefined;   // e.g. 127.0.0.1 behind nginx/Caddy; default: all addresses
const ROUND_SECONDS = Number(process.env.ROUND_SECONDS || require('../client/engine').RULES.round); // 5 minutes
const CLIENT_DIR = path.join(__dirname, '..', 'client');
const RECONNECT_MS = 30_000;
const TURN_SECONDS = Number(process.env.TURN_SECONDS || 30); // two-player games: time per turn

// ───────────────────────── live events (Server-Sent Events) ─────────────────────────
const streams = new Map();          // playerId -> Set<res>
const dropTimers = new Map();       // playerId -> timeout (grace after last stream closes)

function push(playerId, type, data = {}) {
  const set = streams.get(playerId);
  if (!set) return;
  const frame = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) res.write(frame);
}
function isOnline(playerId) { return (streams.get(playerId)?.size || 0) > 0; }

setInterval(() => {
  for (const set of streams.values()) for (const res of set) res.write(': ping\n\n');
  // Keep "last seen" current for the admin page; written to disk every 5 minutes.
  const persist = Date.now() - lastVisitSave > 300_000; if (persist) lastVisitSave = Date.now();
  for (const v of visits.values()) store.touchVisit(v.entry, persist);
}, 20_000);
// ── Visits: from the app connecting until it has been gone for 30 seconds ──
const visits = new Map();   // playerId -> { entry, closeTimer }
let lastVisitSave = Date.now();
function visitOpen(pid, ip, app) {
  const v = visits.get(pid);
  if (v) { clearTimeout(v.closeTimer); v.closeTimer = null; return; }   // a quick reconnect is the same visit
  const entry = store.startVisit(pid, ip, app);
  if (entry) visits.set(pid, { entry, closeTimer: null });
}
function visitClosed(pid) {
  const v = visits.get(pid); if (!v) return;
  clearTimeout(v.closeTimer);
  v.closeTimer = setTimeout(() => { if (!isOnline(pid)) { store.endVisit(v.entry); visits.delete(pid); } }, 30_000);
}

// ───────────────────────── sign-in ─────────────────────────
// First visit: email → the server assigns a 2–4 digit Player ID.
// Later visits: the Player ID alone. If email is configured, the ID is also emailed
// so a player who forgets it can find it.
async function emailPlayerId(to, code) {
  console.log(`[auth] ${to} is player ${code}`);
  if (!(process.env.RESEND_API_KEY && process.env.MAIL_FROM)) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.MAIL_FROM, to, subject: `Your Vistr Player ID is ${code}`,
        text: `Welcome to Vistr. Your Player ID is ${code}. Use it to sign in and to invite friends.`,
      }),
    });
  } catch (e) { console.warn('[auth] could not send email:', e.message); }
}

// The real visitor address, also behind nginx/Caddy on the same machine.
function clientIp(req) {
  const direct = req.socket.remoteAddress || '';
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd && /^(::1|127\.|::ffff:127\.)/.test(direct) ? fwd : direct;
}
// Simple per-address limit: at most `max` uses per `ms`.
const limits = new Map();
function overLimit(name, ip, max, ms) {
  const k = `${name}:${ip}`, now = Date.now();
  const hits = (limits.get(k) || []).filter(t => now - t < ms);
  if (hits.length >= max) { limits.set(k, hits); return true; }
  hits.push(now); limits.set(k, hits); return false;
}

// Contact form → your inbox. CONTACT_TO is your address; it stays on the server and is
// never shown in the app. Sent with Resend (RESEND_API_KEY + MAIL_FROM), like Player IDs.
async function emailContact(m) {
  const to = process.env.CONTACT_TO;
  console.log(`[contact] ${m.topic} from ${m.email}${m.playerCode ? ` (player ${m.playerCode})` : ''}`);
  if (!(to && process.env.RESEND_API_KEY && process.env.MAIL_FROM)) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.MAIL_FROM, to, reply_to: m.email,
        subject: `Vistr: ${m.topic}${m.name ? ` from ${m.name}` : ''}`,
        text: `${m.message}\n\n--\nFrom: ${m.name || '(no name)'} <${m.email}>\nPlayer ID: ${m.playerCode || '-'}\nTopic: ${m.topic}\nApp: ${m.app || '-'}\nSent: ${new Date(m.at).toISOString()}`,
      }),
    });
    return r.ok;
  } catch (e) { console.warn('[contact] could not send email:', e.message); return false; }
}
const TOPICS = ['Question', 'Problem or bug', 'Idea', 'Delete my account', 'Advertising', 'Other'];

// Reviews: words from the rude-word list hold a review back until you approve it.
const rude = (() => {
  try { return new Set(require('fs').readFileSync(require('path').join(__dirname, '..', 'client', 'words', 'blocked.txt'), 'utf8').split(/\s+/).filter(Boolean)); }
  catch (_) { return new Set(); }
})();
const hasRude = t => String(t).toLowerCase().split(/[^a-z]+/).some(w => rude.has(w));
function reviewView(r) {
  return { playerCode: store.getPlayer(r.playerId)?.code || '?', stars: r.stars, text: r.text, updatedAt: r.updatedAt };
}
// Admin key for admin.html and the ad stats: ADMIN_KEY, or one made on first start and
// kept next to the player data (so it survives restarts and updates).
const ADMIN_KEY = process.env.ADMIN_KEY || (() => {
  const file = path.join(path.dirname(process.env.VISTR_DB || path.join(__dirname, 'data', 'db.json')), 'admin-key.txt');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch (_) {}
  const k = crypto.randomBytes(9).toString('base64url');
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, k + '\n'); } catch (_) {}
  return k;
})();
const adminOk = url => url.searchParams.get('key') === ADMIN_KEY;

// Slow down anyone trying IDs one after another: 20 failed tries per address per 10 minutes.
const idFailures = new Map(); // ip -> { count, since }
function tooManyIdTries(ip) {
  const f = idFailures.get(ip);
  if (!f || Date.now() - f.since > 10 * 60_000) return false;
  return f.count >= 20;
}
function noteIdFailure(ip) {
  const f = idFailures.get(ip);
  if (!f || Date.now() - f.since > 10 * 60_000) idFailures.set(ip, { count: 1, since: Date.now() });
  else f.count += 1;
}

// ───────────────────────── ads ─────────────────────────
// server/data/ads.json is re-read when it changes, so the owner can edit ads live.
const ADS_FILE = path.join(__dirname, 'data', 'ads.json');
const AD_IMAGES = path.join(__dirname, 'data', 'ad-images');
let adsCache = { mtime: 0, data: null };
function loadAds() {
  try {
    const mtime = fs.statSync(ADS_FILE).mtimeMs;
    if (mtime !== adsCache.mtime) {
      const raw = JSON.parse(fs.readFileSync(ADS_FILE, 'utf8'));
      const clean = list => (Array.isArray(list) ? list : [])
        .filter(a => a && a.id && a.active !== false)
        .map(a => ({ id: String(a.id), title: String(a.title || ''), text: String(a.text || ''), cta: String(a.cta || ''),
          url: /^(https?:|mailto:|tel:)/i.test(a.url || '') ? a.url : '', image: String(a.image || ''),
          bg: String(a.bg || ''), fg: String(a.fg || ''), weight: Math.max(0, Number(a.weight ?? 1)) }));
      adsCache = { mtime, data: { rules: { bannerRotateSeconds: 30, interstitialEveryRounds: 2, interstitialMinSeconds: 180, skipAfterSeconds: 5, ...(raw.rules || {}) },
        banners: clean(raw.banners), interstitials: clean(raw.interstitials) } };
    }
  } catch (e) {
    if (!adsCache.data) console.warn('[ads] could not read ads.json:', e.message);
    adsCache.data = adsCache.data || { rules: {}, banners: [], interstitials: [] };
  }
  return adsCache.data;
}

// ───────────────────────── available players + requests ─────────────────────────
// Everyone online who has "Show me as available" on is listed for everyone else,
// including while they play solo. A request can reach a player mid-game; accepting
// saves and ends their solo game and starts a two-player game.
const REQUEST_MS = 120_000;   // how long a play request stays open
const requests = new Map();   // fromId -> { to, level, timer }
const incoming = new Map();   // toId -> fromId

function playerStatus(pid) {
  const m = matches.get(activeMatch.get(pid));
  if (!m) return { status: 'free' };
  if (m.mode === 'duo') return { status: 'busy' };
  return m.status === 'playing' ? { status: 'solo', level: m.level, intensity: m.intensity, lang: m.lang, endsAt: m.endsAt } : { status: 'free' };
}

function availablePlayers() {
  const list = [];
  for (const pid of streams.keys()) {
    if (!isOnline(pid) || !store.isAvailable(pid)) continue;
    const st = playerStatus(pid);
    if (st.status === 'busy') continue;
    const requested = incoming.has(pid) || requests.has(pid);
    list.push({ playerCode: store.getPlayer(pid).code, lang: playerLang.get(pid) || 'en', ...st, ...(requested ? { status: st.status, requested: true } : {}) });
  }
  return list.sort((a, b) => (a.status === 'free' ? 0 : 1) - (b.status === 'free' ? 0 : 1) || Number(a.playerCode) - Number(b.playerCode));
}

// Everyone connected (Online), and who of them is free to start a game now (Available).
function lobby() {
  const online = [], available = [];
  for (const pid of streams.keys()) {
    if (!isOnline(pid) || !store.isAvailable(pid)) continue;
    const code = store.getPlayer(pid)?.code; if (!code) continue;
    online.push(code);
    if (playerStatus(pid).status === 'free' && !incoming.has(pid) && !requests.has(pid)) available.push(code);
  }
  const byNum = (a, b) => Number(a) - Number(b);
  return { online: online.sort(byNum), available: available.sort(byNum) };
}

let playersTimer = null;
function broadcastPlayers() { // batched, so a burst of changes sends one update
  if (playersTimer) return;
  playersTimer = setTimeout(() => {
    playersTimer = null;
    const players = availablePlayers(), lists = lobby();
    for (const pid of streams.keys()) push(pid, 'players', { players, lobby: lists, serverNow: Date.now() });
  }, 50);
}

function endRequest(fromId, reason, by) {
  const r = requests.get(fromId);
  if (!r) return;
  clearTimeout(r.timer);
  requests.delete(fromId);
  if (incoming.get(r.to) === fromId) incoming.delete(r.to);
  const data = { reason, by: by ? store.getPlayer(by)?.code : null,
    from: store.getPlayer(fromId)?.code, to: store.getPlayer(r.to)?.code };
  push(fromId, 'request-ended', data);
  push(r.to, 'request-ended', data);
  broadcastPlayers();
}
function endRequestsFor(pid, reason) {
  if (requests.has(pid)) endRequest(pid, reason, pid);
  const from = incoming.get(pid);
  if (from) endRequest(from, reason, pid);
}

// ───────────────────────── matches ─────────────────────────
const matches = new Map();          // matchId -> match
const activeMatch = new Map();      // playerId -> matchId

const intensityFrom = v => (scoring.INTENSITIES.includes(v) ? v : 'intermediate');
// Game language (the words played). Each player's current one is remembered while online.
const langFrom = v => (dict.LANGS.includes(v) ? v : 'en');
const playerLang = new Map();   // playerId -> language they're playing in

function createMatch(level, playerIds, intensity = 'intermediate', lang = 'en') {
  const id = crypto.randomUUID();
  const m = {
    id, level, intensity: intensityFrom(intensity), lang: langFrom(lang), mode: playerIds.length > 1 ? 'duo' : 'single', status: 'pending',
    startWord: null, startedAt: null, endsAt: null, timer: null,
    players: Object.fromEntries(playerIds.map(pid => [pid, {
      ready: false, score: 0, current: null, used: [], chain: [], lastSeq: 0, pending: false, results: {},
      streak: 0, skips: 0, hintsUsed: 0, intensity: intensityFrom(intensity), lang: langFrom(lang), jackpots: [], found: [],
    }])),
  };
  matches.set(id, m);
  for (const pid of playerIds) activeMatch.set(pid, id);
  broadcastPlayers();
  return m;
}

function matchView(m, forId) {
  return {
    id: m.id, level: m.level, mode: m.mode, status: m.status,
    startWord: m.startWord, endsAt: m.endsAt, serverNow: Date.now(),
    ...(m.mode === 'duo' ? { turnSeconds: TURN_SECONDS, ...boardView(m, forId) } : {}),
    players: Object.entries(m.players).map(([pid, p]) => ({
      playerCode: store.getPlayer(pid).code, me: pid === forId, ready: p.ready,
      online: isOnline(pid), score: p.score, current: p.current, moves: p.chain.length,
      ...(pid === forId ? { streak: p.streak, skips: p.skips, skipsLeft: scoring.RULES.maxSkips - p.skips, hintsLeft: engine.status(p).hintsLeft, jackpotsFound: p.found.length, jackpotsTotal: p.jackpots.length } : {}),
    })),
    intensity: m.intensity,
    lang: m.lang,
    rules: engine.publicRules(ROUND_SECONDS, m.intensity, m.lang),
  };
}
// ── Two-player games take turns on one shared word ──
// The word, used words and jackpots are shared; score, streak, hints and skips stay per player.
function boardView(m, forId) {
  const p = m.players[forId] || Object.values(m.players)[0];
  return {
    current: p.current, myTurn: m.turn === forId, turnCode: m.turn ? store.getPlayer(m.turn).code : null,
    turnEndsAt: m.turnEndsAt, jackpotsFound: p.found.length, jackpotsTotal: p.jackpots.length,
  };
}
function shareBoard(m, fromId) {
  const src = m.players[fromId];
  for (const p of Object.values(m.players)) { p.current = src.current; p.used = src.used; p.jackpots = src.jackpots; p.found = src.found; }
}
function setTurn(m, pid) {
  clearTimeout(m.turnTimer);
  m.turn = pid;
  m.turnEndsAt = Math.min(Date.now() + TURN_SECONDS * 1000, m.endsAt);
  m.turnTimer = setTimeout(() => {
    if (m.status !== 'playing' || m.turn !== pid) return;
    m.players[pid].streak = 0;
    passTurn(m, { by: store.getPlayer(pid).code, outcome: 'timeout' });
  }, m.turnEndsAt - Date.now());
}
function passTurn(m, last) {
  const ids = Object.keys(m.players);
  setTurn(m, ids.find(x => x !== m.turn));
  for (const pid of ids) push(pid, 'board', { ...boardView(m, pid), last, serverNow: Date.now() });
}
function needTurn(m, pid) {
  if (m.mode !== 'duo' || m.turn === pid) return null;
  return { error: `Wait for your turn. It's Player ${store.getPlayer(m.turn).code}'s go.`, notYourTurn: true };
}

function broadcastMatch(m, type = 'match') {
  for (const pid of Object.keys(m.players)) push(pid, type, matchView(m, pid));
}

function startMatch(m) {
  m.status = 'playing';
  const start = scoring.pickStart(m.level, m.intensity, m.lang);
  m.startWord = start.word;
  m.startedAt = Date.now();
  m.endsAt = m.startedAt + ROUND_SECONDS * 1000;
  for (const p of Object.values(m.players)) { p.current = m.startWord; p.used = [m.startWord]; p.jackpots = [...start.jackpots]; }
  m.timer = setTimeout(() => finishMatch(m, 'time'), ROUND_SECONDS * 1000);
  if (m.mode === 'duo') {
    const ids = Object.keys(m.players);
    shareBoard(m, ids[0]);
    setTurn(m, ids[Math.floor(Math.random() * ids.length)]); // a coin toss picks who goes first
  }
  broadcastMatch(m, 'match-start');
  broadcastPlayers();
}

function finishMatch(m, reason) {
  if (m.status === 'over') return;
  clearTimeout(m.timer); clearTimeout(m.turnTimer);
  const wasPlaying = m.status === 'playing';
  m.status = 'over';
  const ids = Object.keys(m.players);
  let records = {};
  if (wasPlaying) {
    // The player record: games that never got going (no moves at all) don't count,
    // and a solo game cut short to accept a two-player game isn't rated.
    const moved = ids.some(pid => m.players[pid].chain.length > 0);
    if (moved) records = store.recordGame({
      level: m.level, intensity: m.intensity, lang: m.lang, mode: m.mode,
      players: ids.map(pid => ({ id: pid, score: m.players[pid].score, words: m.players[pid].chain.filter(c => c.valid).length })),
      rated: reason !== 'switched', fullRound: reason === 'time',
    });
    store.countGames(m.mode === 'duo' ? 'duo' : 'solo');
    if (moved) for (const pid of ids) { const v = visits.get(pid); if (v) store.visitGame(v.entry); }
    for (const pid of ids) {
      const p = m.players[pid];
      const opp = ids.find(x => x !== pid);
      store.addResult({
        playerId: pid, level: m.level, intensity: m.intensity, lang: m.lang, mode: m.mode, score: p.score, chain: [m.startWord, ...p.chain.filter(c => c.valid).map(c => c.word)],
        moves: p.chain.length, opponentCode: opp ? store.getPlayer(opp).code : null,
        opponentScore: opp ? m.players[opp].score : null, finishedAt: Date.now(),
      });
    }
  }
  for (const pid of ids) {
    activeMatch.delete(pid);
    push(pid, 'match-over', {
      reason, endedBy: m.endedBy || null, match: matchView(m, pid), record: records[pid] || store.recordView(pid),
      topTen: store.topTen(pid, m.level, m.intensity, m.lang), board: store.levelBoard(m.level, m.intensity, m.lang),
    });
  }
  setTimeout(() => matches.delete(m.id), 60_000);
  broadcastPlayers();
}

// The engine: judge exactly one submission per player at a time.
function submit(m, pid, word, seq) {
  const p = m.players[pid];
  if (m.status !== 'playing') return { error: 'The round is not running.' };
  if (Date.now() > m.endsAt) { finishMatch(m, 'time'); return { error: 'Time is up.' }; }
  if (seq <= p.lastSeq) return p.results[seq] || { error: 'Already processed.' }; // retry → same answer
  if (p.pending) return { error: 'Wait for the last word to be judged.' };
  const wait = needTurn(m, pid); if (wait) return wait;
  p.pending = true;
  try {
    const result = scoring.applyMove(p, word, m.level); // shared engine: client/engine.js
    result.seq = seq;
    p.lastSeq = seq;
    p.results[seq] = result;
    if (m.mode === 'duo' && (result.outcome === 'valid' || result.outcome === 'invalid')) {
      // A judged word (real or not) ends the turn. "Change one letter" and repeats don't.
      shareBoard(m, pid);
      passTurn(m, { by: store.getPlayer(pid).code, word: result.word, outcome: result.outcome, points: result.points, fresh: result.fresh || null });
    }
    for (const other of Object.keys(m.players)) {
      if (other !== pid) push(other, 'opponent', { playerCode: store.getPlayer(pid).code, score: p.score, current: p.current, moves: p.chain.length });
    }
    return result;
  } finally {
    p.pending = false;
  }
}

function onDisconnect(pid) {
  endRequestsFor(pid, 'left');
  broadcastPlayers();
  const mid = activeMatch.get(pid);
  const m = mid && matches.get(mid);
  if (m) {
    broadcastMatch(m, 'match');
    if (m.mode === 'duo') {
      dropTimers.set(pid, setTimeout(() => {
        dropTimers.delete(pid);
        if (!isOnline(pid) && m.status !== 'over') finishMatch(m, 'opponent-left');
      }, RECONNECT_MS));
    }
  }
}

// ───────────────────────── HTTP plumbing ─────────────────────────
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...cors() });
  res.end(JSON.stringify(body));
}
function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 10_000) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('Bad JSON')); } });
    req.on('error', reject);
  });
}
function auth(req, url) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token');
  return store.playerForToken(token);
}
const MIME = { '.html': 'text/html; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(CLIENT_DIR, rel));
  if (!file.startsWith(CLIENT_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function serveAdImage(res, url) {
  const file = path.normalize(path.join(AD_IMAGES, decodeURIComponent(url.pathname.slice('/ad-images/'.length))));
  if (!file.startsWith(AD_IMAGES + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, cors()); return res.end(); }
    const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' }[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=300', ...cors() });
    res.end(data);
  });
}

const routes = {
  // Games played, for the home screen: { total, today }. Admin key adds the breakdown.
  'GET /api/stats': async (req, res, { url }) => {
    const st = store.gameStats();
    send(res, 200, adminOk(url) ? st : { total: st.total, today: st.today });
  },
  // The app reports offline games when it next has internet (count since last report).
  'POST /api/played': async (req, res, { body }) => {
    const n = Math.floor(Number(body.count));
    if (!(n >= 1 && n <= 200)) return send(res, 400, { error: 'Bad count.' });
    if (overLimit('played', clientIp(req), 30, 60 * 60_000)) return send(res, 429, { error: 'Too many reports.' });
    store.countGames('offline', n);
    send(res, 200, { ok: true, total: store.gameStats().total });
  },
  // Contact form. Works signed in or not; signed-in players' ID is added.
  'POST /api/contact': async (req, res, { me, body }) => {
    if (body.website) return send(res, 200, { ok: true });            // filled by spam bots only
    const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
    const message = String(body.message || '').trim().slice(0, 4000);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { error: 'Enter your email address, so we can reply.' });
    if (message.length < 5) return send(res, 400, { error: 'Write a message first.' });
    if (overLimit('contact', clientIp(req), 5, 60 * 60_000)) return send(res, 429, { error: 'Too many messages from here. Try again in an hour.' });
    const m = store.addMessage({
      name: String(body.name || '').trim().slice(0, 80), email, message,
      topic: TOPICS.includes(body.topic) ? body.topic : 'Other',
      playerCode: me?.code || null, app: String(body.app || '').slice(0, 80),
    });
    emailContact(m).then(ok => { if (ok) console.log('[contact] emailed'); });
    send(res, 200, { ok: true });
  },
  // Your inbox on the server: /api/contact/messages?key=ADMIN_KEY (add &delete=<id> to remove one)
  'GET /api/contact/messages': async (req, res, { url }) => {
    if (!adminOk(url)) return send(res, 403, { error: 'Wrong admin key.' });
    const del = url.searchParams.get('delete');
    if (del) return send(res, 200, { deleted: store.deleteMessage(del) });
    send(res, 200, { messages: store.listMessages() });
  },
  // Reviews: anyone can read; online players can write one (writing again replaces it).
  'GET /api/reviews': async (req, res, { me }) => {
    const shown = store.allReviews().filter(r => r.status === 'shown');
    const counts = [1, 2, 3, 4, 5].map(n => shown.filter(r => r.stars === n).length);
    const average = shown.length ? Math.round(shown.reduce((a, r) => a + r.stars, 0) / shown.length * 10) / 10 : 0;
    const mine = me && store.getReview(me.id);
    send(res, 200, {
      average, count: shown.length, counts,
      reviews: shown.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 100).map(reviewView),
      mine: mine ? { ...reviewView(mine), status: mine.status } : null,
    });
  },
  'POST /api/reviews': async (req, res, { me, body }) => {
    const stars = Math.round(Number(body.stars));
    const text = String(body.text || '').trim().replace(/\s+/g, ' ').slice(0, 500);
    if (!(stars >= 1 && stars <= 5)) return send(res, 400, { error: 'Pick 1 to 5 stars.' });
    if (overLimit('review', me.id, 10, 60 * 60_000)) return send(res, 429, { error: 'Too many changes. Try again later.' });
    const held = hasRude(text);
    const r = store.setReview(me.id, { stars, text, status: held ? 'held' : 'shown' });
    send(res, 200, { ok: true, held, mine: { ...reviewView(r), status: r.status } });
  },
  // Moderation: /api/reviews/all?key=ADMIN_KEY lists everything, including held ones;
  // add &player=27&status=shown|hidden to approve or hide a player's review.
  'GET /api/reviews/all': async (req, res, { url }) => {
    if (!adminOk(url)) return send(res, 403, { error: 'Wrong admin key.' });
    const player = url.searchParams.get('player'), status = url.searchParams.get('status');
    if (player && ['shown', 'hidden', 'held'].includes(status)) return send(res, 200, { changed: store.setReviewStatus(player, status) });
    send(res, 200, { reviews: store.allReviews().sort((a, b) => b.updatedAt - a.updatedAt).map(r => ({ ...reviewView(r), status: r.status })) });
  },
  // For hosts and uptime pingers: answers fast, no sign-in.
  'GET /api/health': async (req, res) => send(res, 200, { ok: true, uptime: Math.round(process.uptime()) }),
  'GET /api/ads': async (req, res) => send(res, 200, loadAds()),
  'POST /api/ads/event': async (req, res, { body }) => {
    const known = loadAds();
    const id = String(body.id || '');
    if ([...known.banners, ...known.interstitials].some(a => a.id === id)) store.countAd(id, body.type === 'click' ? 'click' : 'view');
    send(res, 200, { ok: true });
  },
  'GET /api/ads/stats': async (req, res, { url }) => {
    if (!adminOk(url)) return send(res, 403, { error: 'Wrong admin key.' });
    send(res, 200, store.adStats());
  },
  'POST /api/auth/register': async (req, res, { body }) => {
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { error: 'Enter a valid email address.' });
    let player = store.findPlayerByEmail(email);
    const isNew = !player;
    if (isNew) { player = store.createPlayer(email); emailPlayerId(email, player.code); }
    if (body.name && (isNew || !player.name)) store.setName(player.id, body.name);
    store.noteSignIn(player.id, clientIp(req));
    send(res, 200, { token: store.createSession(player.id), player: { code: player.code, email: player.email }, isNew });
  },
  'POST /api/auth/id': async (req, res, { body }) => {
    const ip = clientIp(req);   // behind Caddy/nginx, the real address (not the proxy's)
    if (tooManyIdTries(ip)) return send(res, 429, { error: 'Too many tries. Wait 10 minutes, or sign in with your email.' });
    const code = String(body.code || '').replace(/\D/g, '');
    const player = code && store.findPlayerByCode(code);
    if (!player) { noteIdFailure(ip); return send(res, 404, { error: `There is no player ${code || 'with that ID'}. New here? Use your email to get an ID.` }); }
    store.noteSignIn(player.id, clientIp(req));
    send(res, 200, { token: store.createSession(player.id), player: { code: player.code, email: player.email } });
  },
  'POST /api/auth/signout': async (req, res, { me }) => {
    store.deleteSession((req.headers.authorization || '').slice(7));
    endRequestsFor(me.id, 'left');
    send(res, 200, { ok: true });
  },
  // The player's record (points, total, rating), plus the best-rated players.
  'GET /api/record': async (req, res, { me }) => send(res, 200, { record: store.recordView(me.id), top: store.ratingBoard(10) }),
  // The player asked to be removed. They type their ID to confirm.
  'POST /api/account/delete': async (req, res, { me, body }) => {
    if (String(body.code || '').replace(/\D/g, '') !== me.code) return send(res, 400, { error: 'Type your Player ID to confirm.' });
    endRequestsFor(me.id, 'left');
    const m = matches.get(activeMatch.get(me.id));
    if (m) { m.endedBy = me.code; finishMatch(m, 'ended'); }
    for (const s of streams.get(me.id) || []) s.end();
    streams.delete(me.id); playerLang.delete(me.id);
    clearTimeout(visits.get(me.id)?.closeTimer); visits.delete(me.id);
    const code = store.deletePlayer(me.id);
    broadcastPlayers();
    console.log(`Player ${code} deleted their ID.`);
    send(res, 200, { ok: true, deleted: code });
  },
  // The player's own name (optional; only they and the admin page see it).
  'POST /api/me/name': async (req, res, { me, body }) => send(res, 200, { name: store.setName(me.id, body.name) }),
  'GET /api/admin/activity': async (req, res, { url }) => {
    if (!adminOk(url)) return send(res, 403, { error: 'Wrong admin key.' });
    send(res, 200, { visits: store.activityList({ code: url.searchParams.get('player') || '', limit: Number(url.searchParams.get('limit')) || 500 }) });
  },
  'GET /api/admin/players': async (req, res, { url }) => {
    if (!adminOk(url)) return send(res, 403, { error: 'Wrong admin key.' });
    const { online, available } = lobby();
    send(res, 200, { players: store.allPlayers(), online, available });
  },
  'GET /api/me': async (req, res, { me }) => {
    const mid = activeMatch.get(me.id);
    const m = mid && matches.get(mid);
    send(res, 200, { player: { code: me.code, email: me.email, available: store.isAvailable(me.id) }, match: m ? matchView(m, me.id) : null, me: m ? m.players[me.id] && { current: m.players[me.id].current, chain: m.players[me.id].chain, lastSeq: m.players[me.id].lastSeq, streak: m.players[me.id].streak } : null });
  },
  'GET /api/events': async (req, res, { me, url }) => {
    if (url.searchParams.get('lang')) playerLang.set(me.id, langFrom(url.searchParams.get('lang')));
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...cors() }); // no-buffering hint for nginx and similar proxies
    // 2 KB of padding first: some older Android WebViews hold back the first events
    // of a stream until enough bytes arrive, which made requests show up late.
    res.write(`:${' '.repeat(2048)}\nretry: 2000\n\n`);
    if (!streams.has(me.id)) streams.set(me.id, new Set());
    streams.get(me.id).add(res);
    visitOpen(me.id, clientIp(req), url.searchParams.get('app') === 'android' ? 'Android app' : 'Browser');
    clearTimeout(dropTimers.get(me.id)); dropTimers.delete(me.id);
    const mid = activeMatch.get(me.id);
    if (mid && matches.get(mid)) broadcastMatch(matches.get(mid));
    broadcastPlayers();
    req.on('close', () => {
      const set = streams.get(me.id);
      set?.delete(res);
      if (set && set.size === 0) {
        streams.delete(me.id);
        visitClosed(me.id);
        setTimeout(() => { if (!isOnline(me.id)) onDisconnect(me.id); }, 3000);
      }
    });
  },
  'GET /api/players': async (req, res, { me, url }) => {
    const l = url.searchParams.get('lang');
    if (l && langFrom(l) !== playerLang.get(me.id)) { playerLang.set(me.id, langFrom(l)); broadcastPlayers(); }
    const out = requests.get(me.id);
    const inFrom = incoming.get(me.id);
    send(res, 200, {
      players: availablePlayers(), lobby: lobby(), serverNow: Date.now(), available: store.isAvailable(me.id),
      outgoing: out ? { to: store.getPlayer(out.to).code, level: out.level, intensity: out.intensity, lang: out.lang } : null,
      incoming: inFrom ? { from: store.getPlayer(inFrom).code, level: requests.get(inFrom).level, intensity: requests.get(inFrom).intensity, lang: requests.get(inFrom).lang,
        expiresIn: Math.max(1, Math.round((requests.get(inFrom).expiresAt - Date.now()) / 1000)),
        inSolo: playerStatus(me.id).status === 'solo' } : null,
    });
  },
  'POST /api/availability': async (req, res, { me, body }) => {
    store.setAvailable(me.id, !!body.available);
    if (!body.available && incoming.has(me.id)) endRequest(incoming.get(me.id), 'declined', me.id);
    broadcastPlayers();
    send(res, 200, { available: store.isAvailable(me.id) });
  },
  'POST /api/request': async (req, res, { me, body }) => {
    const level = Number(body.level);
    if (!dict.LEVELS.includes(level)) return send(res, 400, { error: 'Pick a word length from 4 to 7 first.' });
    const code = String(body.playerCode || '').replace(/\D/g, '');
    const target = store.findPlayerByCode(code);
    if (!target || target.id === me.id) return send(res, 404, { error: `No other player has the ID ${code || '(blank)'}.` });
    if (!isOnline(target.id) || !store.isAvailable(target.id)) return send(res, 409, { error: `Player ${code} isn't available right now.` });
    if (playerStatus(target.id).status === 'busy') return send(res, 409, { error: `Player ${code} is in a two-player game.` });
    if (incoming.has(target.id) || requests.has(target.id)) return send(res, 409, { error: `Player ${code} is answering another request. Try again in a minute.` });
    if (playerStatus(me.id).status === 'busy') return send(res, 409, { error: 'Finish your two-player game first.' });
    if (requests.has(me.id)) endRequest(me.id, 'cancelled', me.id);   // one request at a time
    if (incoming.has(me.id)) return send(res, 409, { error: 'Answer the request you have first.' });
    const timer = setTimeout(() => endRequest(me.id, 'expired'), REQUEST_MS);
    const intensity = intensityFrom(body.intensity);
    const lang = langFrom(body.lang || playerLang.get(me.id));
    requests.set(me.id, { to: target.id, level, intensity, lang, timer, expiresAt: Date.now() + REQUEST_MS });
    incoming.set(target.id, me.id);
    const st = playerStatus(target.id);
    const theirMatch = matches.get(activeMatch.get(target.id));
    push(target.id, 'request', { from: me.code, level, intensity, lang, expiresIn: REQUEST_MS / 1000,
      inSolo: st.status === 'solo', soloScore: st.status === 'solo' ? theirMatch.players[target.id].score : null });
    broadcastPlayers();
    send(res, 200, { ok: true, to: code, level, intensity, lang, expiresIn: REQUEST_MS / 1000 });
  },
  'POST /api/request/cancel': async (req, res, { me }) => { endRequest(me.id, 'cancelled', me.id); send(res, 200, { ok: true }); },
  'POST /api/request/respond': async (req, res, { me, body }) => {
    const fromId = incoming.get(me.id);
    const r = fromId && requests.get(fromId);
    if (!r) return send(res, 409, { error: 'That request is no longer open.' });
    if (!body.accept) { endRequest(fromId, 'declined', me.id); return send(res, 200, { ok: true }); }
    if (!isOnline(fromId)) { endRequest(fromId, 'left', fromId); return send(res, 409, { error: 'The other player has gone offline.' }); }
    clearTimeout(r.timer);
    requests.delete(fromId); incoming.delete(me.id);
    // Save and close any solo game either player is in, then start the two-player game.
    for (const pid of [fromId, me.id]) {
      const old = matches.get(activeMatch.get(pid));
      if (old) finishMatch(old, 'switched');
    }
    const m = createMatch(r.level, [fromId, me.id], r.intensity, r.lang);
    push(fromId, 'request-ended', { reason: 'accepted', by: me.code, from: store.getPlayer(fromId).code, to: me.code });
    broadcastMatch(m, 'match');
    send(res, 200, { match: matchView(m, me.id) });
  },
  'POST /api/match/single': async (req, res, { me, body }) => {
    const level = Number(body.level);
    if (!dict.LEVELS.includes(level)) return send(res, 400, { error: 'Pick a word length from 4 to 7.' });
    const old = matches.get(activeMatch.get(me.id));
    if (old) finishMatch(old, 'abandoned');
    const m = createMatch(level, [me.id], body.intensity, body.lang);
    send(res, 200, { match: matchView(m, me.id) });
  },
  'POST /api/match/ready': async (req, res, { me }) => {
    const m = matches.get(activeMatch.get(me.id));
    if (!m || m.status !== 'pending') return send(res, 409, { error: 'There is no game waiting to start.' });
    m.players[me.id].ready = true;
    if (Object.values(m.players).every(p => p.ready)) startMatch(m); else broadcastMatch(m);
    send(res, 200, { match: matchView(m, me.id) });
  },
  'POST /api/match/submit': async (req, res, { me, body }) => {
    const m = matches.get(activeMatch.get(me.id));
    if (!m) return send(res, 409, { error: 'You are not in a game.' });
    const r = submit(m, me.id, body.word, Number(body.seq) || 0);
    send(res, r.error ? 409 : 200, r);
  },
  'POST /api/match/hint': async (req, res, { me }) => {
    const m = matches.get(activeMatch.get(me.id));
    if (!m || m.status !== 'playing') return send(res, 409, { error: 'The round is not running.' });
    const wait = needTurn(m, me.id); if (wait) return send(res, 409, wait);
    const r = scoring.hint(m.players[me.id], m.level);
    send(res, r.error ? 409 : 200, r);
  },
  'POST /api/match/skip': async (req, res, { me }) => {
    const m = matches.get(activeMatch.get(me.id));
    if (!m || m.status !== 'playing') return send(res, 409, { error: 'The round is not running.' });
    const p = m.players[me.id];
    if (p.pending) return send(res, 409, { error: 'Wait for the last word to be judged.' });
    const wait = needTurn(m, me.id); if (wait) return send(res, 409, wait);
    const r = scoring.applySkip(p, m.level);
    if (m.mode === 'duo' && !r.ended) {
      shareBoard(m, me.id);
      passTurn(m, { by: me.code, outcome: 'skip', fresh: r.fresh });
    }
    for (const other of Object.keys(m.players)) {
      if (other !== me.id) push(other, 'opponent', { playerCode: me.code, score: p.score, current: p.current, moves: p.chain.length, skips: p.skips });
    }
    send(res, 200, r);
    if (r.ended) { m.endedBy = me.code; finishMatch(m, 'skips'); }
  },
  // The current game, for a phone catching up after its live connection stalled.
  'GET /api/match': async (req, res, { me }) => {
    const m = matches.get(activeMatch.get(me.id));
    send(res, 200, { match: m ? matchView(m, me.id) : null });
  },
  'POST /api/match/quit': async (req, res, { me }) => {
    const m = matches.get(activeMatch.get(me.id));
    if (m) { m.endedBy = me.code; finishMatch(m, 'ended'); }
    send(res, 200, { ok: true });
  },
  'GET /api/scores': async (req, res, { me, url }) => {
    const level = Number(url.searchParams.get('level'));
    if (!dict.LEVELS.includes(level)) return send(res, 400, { error: 'Pick a word length from 4 to 7.' });
    const intensity = intensityFrom(url.searchParams.get('intensity'));
    const lang = langFrom(url.searchParams.get('lang'));
    send(res, 200, { level, intensity, lang, topTen: store.topTen(me.id, level, intensity, lang), board: store.levelBoard(level, intensity, lang) });
  },
};
const PUBLIC = new Set(['GET /api/admin/activity', 'GET /api/admin/players', 'GET /api/stats', 'POST /api/played', 'POST /api/contact', 'GET /api/contact/messages', 'GET /api/reviews', 'GET /api/reviews/all', 'GET /api/health', 'POST /api/auth/register', 'POST /api/auth/id', 'GET /api/ads', 'POST /api/ads/event', 'GET /api/ads/stats']);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') { res.writeHead(204, cors()); return res.end(); }
  if (url.pathname.startsWith('/ad-images/')) return serveAdImage(res, url);
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url);
  const key = `${req.method} ${url.pathname}`;
  const handler = routes[key];
  if (!handler) return send(res, 404, { error: 'Unknown API route.' });
  try {
    const me = auth(req, url);   // public routes still see who is signed in, if anyone
    if (!PUBLIC.has(key) && !me) return send(res, 401, { error: 'Sign in again.' });
    const body = req.method === 'POST' ? await readBody(req) : {};
    await handler(req, res, { me, body, url });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: 'The server hit an error. Try again.' });
  }
});

if (require.main === module) {
  server.on('error', e => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\nCan't start: port ${PORT} is already in use.`);
      console.error('Most likely an older Vistr server is still running. Close its window, or run this in PowerShell:');
      console.error('    Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force');
      console.error(`Or start on another port:  $env:PORT=3001; node server\\server.js\n`);
    } else if (e.code === 'EACCES') {
      console.error(`\nCan't start: not allowed to use port ${PORT}. Try another port, for example 3001.\n`);
    } else {
      console.error('\nCan\'t start the server:', e.message, '\n');
    }
    process.exit(1);
  });
  store.ready.catch(e => {
    console.error('\nCan\'t load the saved data from Upstash:', e.message);
    console.error('Check UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (copy both from the Upstash console, REST API section).\n');
    process.exit(1);
  }).then(() => server.listen(PORT, HOST, () => {
    const nets = Object.values(require('os').networkInterfaces()).flat()
      .filter(n => n && n.family === 'IPv4' && !n.internal).map(n => `http://${n.address}:${PORT}`);
    console.log(`Vistr server running.`);
    console.log(`  On this PC:        http://localhost:${PORT}`);
    if (nets.length) console.log(`  From phones on Wi-Fi: ${nets.join('  ')}`);
    console.log('  Languages:', dict.LANGS.join(', '), '| English words per length:', Object.entries(dict.stats()).map(([L, v]) => `${L}: ${v.words}`).join(', '));
    console.log(store.remote ? '  Data: kept in Upstash (and db.json)' : '  Data: ' + (process.env.VISTR_DB || 'server/data/db.json'));
    console.log(`  Admin (messages, reviews): http://localhost:${PORT}/admin.html  key: ${process.env.ADMIN_KEY ? '(your ADMIN_KEY)' : ADMIN_KEY}`);
    console.log('Leave this window open while people play. Press Ctrl+C to stop.');
  }));
}
module.exports = { server };
