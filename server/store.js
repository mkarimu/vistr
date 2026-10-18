// Tiny JSON store. Always keeps a local file (db.json). On a host whose disk is
// wiped on restart (free Render, Koyeb ...), set UPSTASH_REDIS_REST_URL and
// UPSTASH_REDIS_REST_TOKEN and the data is also kept in a free Upstash Redis
// database: loaded at start-up, saved every few seconds, and flushed on shutdown.
// Swap for Postgres or SQLite when you outgrow it (the functions below are the only API used).
const fs = require('fs');
const path = require('path');

const FILE = process.env.VISTR_DB || path.join(__dirname, 'data', 'db.json');

let db = { players: {}, sessions: {}, results: [], adStats: {}, messages: [], reviews: {}, stats: {} };
try {
  db = { ...db, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
} catch (_) { /* first run */ }

const PARTS = ['players', 'sessions', 'results', 'adStats', 'messages', 'reviews', 'stats'];
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
  const used = new Set(Object.values(db.players).map(p => p.code));
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

module.exports = {
  countGames, gameStats,
  addMessage, listMessages, deleteMessage, setReview, getReview, allReviews, setReviewStatus,
  ready, flushRemote, remote: !!REMOTE,
  countAd, adStats, isAvailable, setAvailable,
  findPlayerByEmail, findPlayerByCode, getPlayer, createPlayer,
  createSession, playerForToken, deleteSession, addResult, topTen, levelBoard,
};
