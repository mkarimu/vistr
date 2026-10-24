// Tiny JSON store. Always keeps a local file (db.json). On a host whose disk is
// wiped on restart (free Render, Koyeb ...), set UPSTASH_REDIS_REST_URL and
// UPSTASH_REDIS_REST_TOKEN and the data is also kept in a free Upstash Redis
// database: loaded at start-up, saved every few seconds, and flushed on shutdown.
// Swap for Postgres or SQLite when you outgrow it (the functions below are the only API used).
const fs = require('fs');
const path = require('path');

const FILE = process.env.VISTR_DB || path.join(__dirname, 'data', 'db.json');

let db = { players: {}, sessions: {}, results: [], adStats: {}, messages: [], reviews: {}, stats: {}, activity: [] };
try {
  db = { ...db, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
} catch (_) { /* first run */ }

const PARTS = ['players', 'sessions', 'results', 'adStats', 'messages', 'reviews', 'stats', 'activity'];
let timer = null;
function save(part) {
  if (REMOTE) { if (part) dirty.add(part); else PARTS.forEach(x => dirty.add(x)); scheduleRemote(); }
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      const tmp = FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, FILE);
    } catch (e) { if (!REMOTE) console.error('Could not save', FILE, e.message); }
  }, 200);
}

// ── Optional Upstash Redis copy (plain HTTPS, no extra packages) ──
const REMOTE = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? { url: process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, ''), token: process.env.UPSTASH_REDIS_REST_TOKEN } : null;
const KEY = part => `vistr:${part}`;
const REMOTE_EVERY_MS = Number(process.env.REMOTE_SAVE_MS || 10_000);
const dirty = new Set();
let remoteTimer = null, flushing = null;
async function redis(commands) {
  const r = await fetch(`${REMOTE.url}/pipeline`, {
    method: 'POST', headers: { Authorization: `Bearer ${REMOTE.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands), signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`Upstash answered ${r.status}`);
  const out = await r.json();
  const bad = out.find(x => x.error); if (bad) throw new Error(`Upstash: ${bad.error}`);
  return out.map(x => x.result);
}
function scheduleRemote() {
  if (!remoteTimer) remoteTimer = setTimeout(() => { remoteTimer = null; flushRemote(); }, REMOTE_EVERY_MS);
}
async function flushRemote() {
  if (!REMOTE || !dirty.size) return flushing;
  if (flushing) { await flushing; return flushRemote(); }
  const parts = [...dirty]; dirty.clear();
  flushing = redis(parts.map(p => ['SET', KEY(p), JSON.stringify(db[p] ?? null)]))
    .catch(e => { parts.forEach(p => dirty.add(p)); console.error('Saving to Upstash failed, will retry:', e.message); scheduleRemote(); })
    .finally(() => { flushing = null; });
  return flushing;
}
// Resolves once the data is loaded. Without Upstash that is straight away.
const ready = !REMOTE ? Promise.resolve() : (async () => {
  const got = await redis(PARTS.map(p => ['GET', KEY(p)]));
  if (got.every(v => v === null)) {
    console.log('Upstash is empty: copying this server\'s data there.');
    PARTS.forEach(p => dirty.add(p));
    await flushRemote();
  } else {
    PARTS.forEach((p, i) => { if (got[i] !== null) db[p] = JSON.parse(got[i]); });
    db.activity = db.activity || [];
    console.log(`Loaded ${Object.keys(db.players).length} players and ${db.results.length} results from Upstash.`);
  }
})();
// Hosts stop the server with SIGTERM (when it sleeps, restarts or redeploys): save first.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, () => {
    const done = () => process.exit(0);
    if (!REMOTE) return done();
    Promise.race([flushRemote(), new Promise(r => setTimeout(r, 8000))]).then(done, done);
  });
}

// Player IDs are plain numbers handed out in order: 10–99 first, then 100–999,
// then 1000–9999. So the first 90 players get 2 digits and nobody gets more than 4.
const FIRST_ID = 10, LAST_ID = 9999;

function findPlayerByEmail(email) {
  return Object.values(db.players).find(p => p.email === email) || null;
}
function findPlayerByCode(code) {
  return Object.values(db.players).find(p => p.code === code) || null;
}
function getPlayer(id) { return db.players[id] || null; }

function nextCode() {
  // IDs of deleted players are never handed out again, so an ID always means one person.
  const used = new Set([...Object.values(db.players).map(p => p.code), ...((db.stats || {}).retired || [])]);
  for (let n = FIRST_ID; n <= LAST_ID; n++) if (!used.has(String(n))) return String(n);
  throw new Error('All player IDs (10–9999) are taken.');
}

function createPlayer(email) {
  const id = require('crypto').randomUUID();
  db.players[id] = { id, email, code: nextCode(), createdAt: Date.now() };
  save('players');
  return db.players[id];
}

// Players saved by the first starter had IDs like "VX-4821"; give them a number.
for (const p of Object.values(db.players)) {
  if (!/^\d{2,4}$/.test(p.code)) { p.code = nextCode(); save('players'); }
}

function createSession(playerId) {
  const token = require('crypto').randomBytes(32).toString('hex');
  db.sessions[token] = { playerId, createdAt: Date.now() };
  save('sessions');
  return token;
}
function playerForToken(token) {
  const s = token && db.sessions[token];
  return s ? getPlayer(s.playerId) : null;
}
function deleteSession(token) { delete db.sessions[token]; save('sessions'); }

// Results: keep every player's 10 best per level (the spec's "top 10 saved").
function addResult(r) {
  db.results.push(r);
  const same = x => x.playerId === r.playerId && x.level === r.level && intensityOf(x) === intensityOf(r) && langOf(x) === langOf(r);
  const keep = new Set(db.results.filter(same).sort(byScore).slice(0, 10));
  db.results = db.results.filter(x => !same(x) || keep.has(x));
  save('results');
}
function byScore(a, b) { return b.score - a.score || a.finishedAt - b.finishedAt; }

// Results from before intensities existed count as Intermediate.
const intensityOf = r => r.intensity || 'intermediate';
const langOf = r => r.lang || 'en';   // results from before languages existed are English

function topTen(playerId, level, intensity = 'intermediate', lang = 'en') {
  return db.results.filter(x => x.playerId === playerId && x.level === level && intensityOf(x) === intensity && langOf(x) === lang).sort(byScore).slice(0, 10);
}

// All-time board: each player's single best game at the level.
function levelBoard(level, intensity = 'intermediate', lang = 'en', limit = 20) {
  const best = new Map();
  for (const r of db.results) {
    if (r.level !== level || intensityOf(r) !== intensity || langOf(r) !== lang) continue;
    const cur = best.get(r.playerId);
    if (!cur || byScore(r, cur) < 0) best.set(r.playerId, r);
  }
  return [...best.values()].sort(byScore).slice(0, limit)
    .map(r => ({ playerCode: getPlayer(r.playerId)?.code || '?', score: r.score, finishedAt: r.finishedAt }));
}

// "Show me as available" switch; on unless the player turned it off.
function isAvailable(id) { return db.players[id]?.available !== false; }
function setAvailable(id, on) { if (db.players[id]) { db.players[id].available = !!on; save('players'); } }

// Ad views and clicks per ad id, so you can show sponsors what they got.
function countAd(id, type) {
  db.adStats = db.adStats || {};
  const day = new Date().toISOString().slice(0, 10);
  const a = (db.adStats[id] = db.adStats[id] || { views: 0, clicks: 0, byDay: {} });
  const d = (a.byDay[day] = a.byDay[day] || { views: 0, clicks: 0 });
  if (type === 'click') { a.clicks++; d.clicks++; } else { a.views++; d.views++; }
  save('adStats');
}
function adStats() { return db.adStats || {}; }

// Games played: online solo, online two-player, and offline games the app reports later.
function countGames(kind, n = 1) {
  const st = (db.stats = db.stats || {});
  const day = new Date().toISOString().slice(0, 10);
  st.total = (st.total || 0) + n;
  st[kind] = (st[kind] || 0) + n;
  st.byDay = st.byDay || {};
  st.byDay[day] = (st.byDay[day] || 0) + n;
  const days = Object.keys(st.byDay).sort();
  for (const d of days.slice(0, Math.max(0, days.length - 400))) delete st.byDay[d];   // keep ~13 months
  save('stats');
}
function gameStats() {
  const st = db.stats || {};
  const day = new Date().toISOString().slice(0, 10);
  return { total: st.total || 0, today: st.byDay?.[day] || 0, solo: st.solo || 0, duo: st.duo || 0, offline: st.offline || 0,
    players: Object.keys(db.players).length, byDay: st.byDay || {} };
}

// Contact form messages (newest last). Kept until you delete them.
function addMessage(m) {
  db.messages = db.messages || [];
  const msg = { id: require('crypto').randomUUID(), at: Date.now(), ...m };
  db.messages.push(msg);
  if (db.messages.length > 2000) db.messages = db.messages.slice(-2000);
  save('messages');
  return msg;
}
function listMessages() { return [...(db.messages || [])].reverse(); }
function deleteMessage(id) {
  const before = (db.messages || []).length;
  db.messages = (db.messages || []).filter(m => m.id !== id);
  if (db.messages.length !== before) save('messages');
  return db.messages.length !== before;
}

// Reviews: one per player (writing again replaces it). status: 'shown' | 'held' | 'hidden'.
function setReview(playerId, r) {
  db.reviews = db.reviews || {};
  const old = db.reviews[playerId];
  db.reviews[playerId] = { playerId, createdAt: old?.createdAt || Date.now(), updatedAt: Date.now(), ...r };
  save('reviews');
  return db.reviews[playerId];
}
function getReview(playerId) { return db.reviews?.[playerId] || null; }
function allReviews() { return Object.values(db.reviews || {}); }
function setReviewStatus(playerCode, status) {
  const p = findPlayerByCode(String(playerCode)); const r = p && db.reviews?.[p.id];
  if (!r) return false;
  r.status = status; save('reviews'); return true;
}

// ── Player record (for grading): kept for as long as the Player ID exists ──
// Every online game adds to it: games, total points, best game, words, two-player
// wins/losses/draws, and a rating. Offline games can't be checked, so they don't count.
//
// Rating starts at 1000 and works like chess ratings:
// - two-player: beating someone rated higher gains more than beating someone lower;
// - solo: you play against "par", the average score of everyone at that word length,
//   intensity and language. Beating par raises your rating. Par for harder settings
//   counts as a stronger opponent, so the same win is worth more at Advanced or 7 letters.
const RATING_START = 1000;
const PAR_RATING = { learner: 900, intermediate: 1100, advanced: 1300 };
const DEFAULT_PAR = 15, PAR_WEIGHT = 10;   // until enough games are played, par leans on 15 points
const RANKS = [[0, 'Beginner'], [100, 'Apprentice'], [500, 'Wordsmith'], [1500, 'Expert'], [4000, 'Master'], [10000, 'Grandmaster']];
const rankFor = points => RANKS.filter(([min]) => points >= min).pop()[1];
const nextRank = points => RANKS.find(([min]) => points < min) || null;

function careerOf(id) {
  const p = db.players[id]; if (!p) return null;
  return (p.career = p.career || { games: 0, points: 0, best: 0, words: 0, wins: 0, losses: 0, draws: 0, rating: RATING_START, rated: 0, lastPlayed: null });
}
function parKey(level, intensity, lang) { return `${level}|${intensityOf({ intensity })}|${lang || 'en'}`; }
function parFor(level, intensity, lang) {
  const x = ((db.stats || {}).par || {})[parKey(level, intensity, lang)] || { n: 0, sum: 0 };
  return (x.sum + DEFAULT_PAR * PAR_WEIGHT) / (x.n + PAR_WEIGHT);
}
function addToPar(level, intensity, lang, score) {
  const st = (db.stats = db.stats || {}); st.par = st.par || {};
  const x = (st.par[parKey(level, intensity, lang)] = st.par[parKey(level, intensity, lang)] || { n: 0, sum: 0 });
  x.n++; x.sum += score;
  if (x.n > 500) { x.sum = x.sum * 500 / x.n; x.n = 500; }   // follows how people play lately
}
const expected = (a, b) => 1 / (1 + 10 ** ((b - a) / 400));

// One finished online game. players: [{ id, score, words }] (1 for solo, 2 for two-player).
// rated: false for games that ended before they really started (switched to a two-player game).
// Returns, per player id, what changed.
function recordGame({ level, intensity, lang, mode, players, rated = true, fullRound = false }) {
  const out = {};
  const before = Object.fromEntries(players.map(x => [x.id, careerOf(x.id)?.rating ?? RATING_START]));
  const par = parFor(level, intensity, lang);
  for (const x of players) {
    const c = careerOf(x.id); if (!c) continue;
    const opp = players.find(o => o.id !== x.id);
    c.games++; c.points += Math.max(0, x.score); c.best = Math.max(c.best, x.score); c.words += x.words || 0;
    c.lastPlayed = Date.now();
    let delta = 0;
    if (rated) {
      const k = (c.rated < 20 ? 40 : 24) * (mode === 'duo' ? 1 : 0.5);
      let result, oppRating;
      if (opp) {
        result = x.score > opp.score ? 1 : x.score < opp.score ? 0 : 0.5;
        c[result === 1 ? 'wins' : result === 0 ? 'losses' : 'draws']++;
        oppRating = before[opp.id];
      } else {
        result = x.score > par ? 1 : x.score < par ? 0 : 0.5;
        oppRating = PAR_RATING[intensityOf({ intensity })] + (level - 4) * 50;
      }
      delta = Math.round(k * (result - expected(before[x.id], oppRating)));
      c.rating = Math.max(100, c.rating + delta);
      c.rated++;
    }
    out[x.id] = { delta, par: opp ? null : Math.round(par), ...recordView(x.id) };
  }
  if (mode !== 'duo' && fullRound) for (const x of players) addToPar(level, intensity, lang, x.score);
  save('players'); save('stats');
  return out;
}
function recordView(id) {
  const p = db.players[id]; if (!p) return null;
  const c = careerOf(id), nr = nextRank(c.points);
  return { playerCode: p.code, name: p.name || '', joined: p.createdAt, games: c.games, points: c.points, best: c.best, words: c.words,
    wins: c.wins, losses: c.losses, draws: c.draws, rating: c.rating, rank: rankFor(c.points),
    nextRank: nr ? { name: nr[1], at: nr[0] } : null, average: c.games ? Math.round(c.points / c.games * 10) / 10 : 0, lastPlayed: c.lastPlayed };
}
// Best-rated players who have played at least 3 rated games.
function ratingBoard(limit = 10) {
  return Object.values(db.players).filter(p => (p.career?.rated || 0) >= 3)
    .sort((a, b) => b.career.rating - a.career.rating || b.career.points - a.career.points).slice(0, limit)
    .map(p => ({ playerCode: p.code, rating: p.career.rating, points: p.career.points, rank: rankFor(p.career.points) }));
}
// For the admin page: everyone, with their record and email.
function allPlayers() {
  return Object.values(db.players).map(p => ({ ...recordView(p.id), email: p.email, name: p.name || '', lastIp: p.lastIp || '',
    lastSeen: p.lastSeen || null, onlineMs: onlineTime(p.id) })).sort((a, b) => b.rating - a.rating || b.points - a.points);
}
// Players from before records existed: start their record from the games still saved.
function seedCareers() {
  let n = 0;
  for (const p of Object.values(db.players)) {
    if (p.career) continue;
    const c = careerOf(p.id);
    for (const r of db.results.filter(x => x.playerId === p.id)) {
      c.games++; c.points += Math.max(0, r.score); c.best = Math.max(c.best, r.score);
      c.words += Math.max(0, (r.chain?.length || 1) - 1); c.lastPlayed = Math.max(c.lastPlayed || 0, r.finishedAt || 0) || null;
    }
    n++;
  }
  if (n) save('players');
}
ready.then(seedCareers, () => {});

// ── Activity log: one entry per online visit (for the admin page) ──
// A visit starts when the app connects and ends when it has been gone for 30 seconds.
// Kept 90 days (at most 5000 visits). Holds the IP address the visit came from.
const VISIT_DAYS = 90, VISIT_MAX = 5000;
function startVisit(playerId, ip, app) {
  const p = db.players[playerId]; if (!p) return null;
  db.activity = db.activity || [];
  const now = Date.now();
  const v = { id: require('crypto').randomUUID(), playerId, start: now, lastSeen: now, end: null, ip: ip || '', app: app || '', games: 0 };
  db.activity.push(v);
  const cut = now - VISIT_DAYS * 86400_000;
  if (db.activity.length > VISIT_MAX || db.activity[0].start < cut) db.activity = db.activity.filter(x => x.start >= cut).slice(-VISIT_MAX);
  p.lastIp = v.ip; p.lastSeen = now;
  save('activity'); save('players');
  return v;
}
function touchVisit(v, persist) { v.lastSeen = Date.now(); if (db.players[v.playerId]) db.players[v.playerId].lastSeen = v.lastSeen; if (persist) { save('activity'); save('players'); } }
function endVisit(v) { v.end = v.lastSeen = Date.now(); if (db.players[v.playerId]) db.players[v.playerId].lastSeen = v.end; save('activity'); save('players'); }
function visitGame(v) { v.games++; save('activity'); }
// Visits still open when the server stopped end at the last time they were seen.
ready.then(() => { let n = 0; for (const v of db.activity || []) if (!v.end) { v.end = v.lastSeen; n++; } if (n) save('activity'); }, () => {});
const visitView = v => ({ ...v, playerCode: db.players[v.playerId]?.code || '?', name: db.players[v.playerId]?.name || '',
  duration: (v.end || v.lastSeen) - v.start, online: !v.end });
function activityList({ code, limit = 500 } = {}) {
  const pid = code ? findPlayerByCode(String(code))?.id : null;
  if (code && !pid) return [];
  return (db.activity || []).filter(v => !pid || v.playerId === pid).slice(-limit).reverse().map(visitView);
}
function onlineTime(playerId) {
  return (db.activity || []).reduce((t, v) => t + (v.playerId === playerId ? (v.end || v.lastSeen) - v.start : 0), 0);
}
// Optional name: seen only by the player and on the admin page.
function setName(id, name) {
  const p = db.players[id]; if (!p) return null;
  p.name = String(name || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  save('players');
  return p.name;
}
function noteSignIn(id, ip) { const p = db.players[id]; if (p) { p.lastIp = ip || p.lastIp; p.lastSignIn = Date.now(); save('players'); } }

// The player asked for their ID to be removed: everything about them goes, and the
// number is retired. Returns the code that was deleted.
function deletePlayer(id) {
  const p = db.players[id]; if (!p) return null;
  delete db.players[id];
  for (const [tok, s] of Object.entries(db.sessions)) if (s.playerId === id) delete db.sessions[tok];
  db.results = db.results.filter(r => r.playerId !== id);
  db.activity = (db.activity || []).filter(v => v.playerId !== id);
  if (db.reviews) delete db.reviews[id];
  const st = (db.stats = db.stats || {}); st.retired = [...new Set([...(st.retired || []), p.code])];
  ['players', 'sessions', 'results', 'reviews', 'stats', 'activity'].forEach(save);
  return p.code;
}

module.exports = {
  recordGame, recordView, ratingBoard, allPlayers, deletePlayer, RANKS,
  startVisit, touchVisit, endVisit, visitGame, activityList, setName, noteSignIn,
  countGames, gameStats,
  addMessage, listMessages, deleteMessage, setReview, getReview, allReviews, setReviewStatus,
  ready, flushRemote, remote: !!REMOTE,
  countAd, adStats, isAvailable, setAvailable,
  findPlayerByEmail, findPlayerByCode, getPlayer, createPlayer,
  createSession, playerForToken, deleteSession, addResult, topTen, levelBoard,
};
