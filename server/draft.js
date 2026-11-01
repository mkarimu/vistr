'use strict';
// Vistr Draft - away play. In-memory rooms, polled by the clients (no sockets). The rules live in client/draft/rules.js
// so the browser and the server always agree; the server is the referee and never trusts the browser.
const crypto = require('crypto');
const R = require('../client/draft/rules');

const rooms = new Map();
const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const IDLE_MS = 3 * 60 * 60 * 1000, DONE_MS = 10 * 60 * 1000, AWAY_MS = 20 * 1000, MAX_ROOMS = 500;
const NAME = { A: 'Blue', B: 'Red' };

function clean(s, d) { return String(s || '').replace(/[^\w .'-]/g, '').trim().slice(0, 16) || d; }
function code() { let c; do { c = ''; for (let i = 0; i < 4; i++) c += LETTERS[crypto.randomInt(LETTERS.length)]; } while (rooms.has(c)); return c; }
function sweep() {
  const now = Date.now();
  for (const [k, r] of rooms) if (now - r.touched > IDLE_MS || (r.g && r.g.winner && now - r.doneAt > DONE_MS)) rooms.delete(k);
}
setInterval(sweep, 60 * 1000).unref();

function say(r, text) { r.log.push(text); if (r.log.length > 40) r.log.shift(); }
function describe(r, before, after) {
  const e = after.event; if (!e) return;
  const who = r.names[e.player];
  if (e.type === 'capture') say(r, `${who} took a die (+${e.pts})` + (after.chain ? ' and can jump again' : ''));
  else if (e.type === 'penalty') say(r, `${who} ${e.why}: their die is removed, ${r.names[R.other(e.player)]} gets +${e.pts}`);
  else if (e.type === 'resign') say(r, `${who} resigned`);
  if (e.crowned) say(r, `${who} crowned a die - it can now move in every direction`);
  if (after.winner) say(r, `${r.names[after.winner]} wins!`);
}
function view(r, side, sid) {
  const now = Date.now();
  if (!side && sid) { r.spec[sid] = now; }
  const spectators = Object.keys(r.spec).filter(k => now - r.spec[k] < 15000).length;
  return {
    room: r.id, level: r.level, v: r.v, you: side || '', names: r.names,
    status: !r.g ? 'waiting' : r.g.winner ? 'done' : 'playing',
    g: r.g, log: r.log.slice(-12), spectators,
    away: { A: now - r.seen.A > AWAY_MS, B: r.names.B ? now - r.seen.B > AWAY_MS : false },
  };
}
function sideOf(r, token) { return token && token === r.tok.A ? 'A' : token && token === r.tok.B ? 'B' : ''; }

const routes = {
  'POST /create': (b) => {
    if (rooms.size >= MAX_ROOMS) return [503, { error: 'Too many games are open right now. Try again in a few minutes.' }];
    const id = code(), tok = crypto.randomBytes(12).toString('hex');
    const r = { id, level: b.level === 'advanced' ? 'advanced' : 'standard', names: { A: clean(b.name, 'Blue'), B: '' }, tok: { A: tok, B: '' }, g: null, v: 1, log: [], seen: { A: Date.now(), B: 0 }, spec: {}, touched: Date.now(), doneAt: 0 };
    rooms.set(id, r);
    return [200, { room: id, token: tok, side: 'A', state: view(r, 'A') }];
  },
  'POST /join': (b) => {
    const r = rooms.get(String(b.room || '').toUpperCase().trim());
    if (!r) return [404, { error: 'No game with that code. Check the letters with your opponent.' }];
    if (r.tok.B) return [409, { error: 'That game already has two players. You can watch it from the Live list.' }];
    r.tok.B = crypto.randomBytes(12).toString('hex'); r.names.B = clean(b.name, 'Red');
    if (r.names.B.toLowerCase() === r.names.A.toLowerCase()) r.names.B += ' 2';
    r.g = R.newGame(r.level); r.v++; r.seen.B = r.touched = Date.now();
    say(r, `${r.names.A} (Blue) vs ${r.names.B} (Red) - Blue moves first`);
    return [200, { room: r.id, token: r.tok.B, side: 'B', state: view(r, 'B') }];
  },
  'POST /move': (b) => {
    const r = rooms.get(String(b.room || '').toUpperCase()); if (!r) return [404, { error: 'That game is gone.' }];
    const side = sideOf(r, b.token); if (!side) return [403, { error: 'You are watching this game.' }];
    if (!r.g) return [409, { error: 'Waiting for the second player.' }];
    if (r.g.winner) return [409, { error: 'The game is over.' }];
    if (r.g.turn !== side) return [409, { error: 'Not your turn.' }];
    const n = [b.fr, b.fc, b.tr, b.tc].map(Number);
    if (n.some(x => !Number.isInteger(x))) return [400, { error: 'Bad move.' }];
    let out;
    if (r.level === 'advanced') { const a = R.playAdvanced(r.g, n[0], n[1], n[2], n[3]); out = a && a.g; }
    else out = R.play(r.g, n[0], n[1], n[2], n[3]);
    if (!out) return [400, { error: r.level === 'advanced' ? 'That is not a move.' : 'That move is not allowed. If a capture is open you must take it.' }];
    describe(r, r.g, out); r.g = out; r.v++; r.seen[side] = r.touched = Date.now();
    if (out.winner) r.doneAt = Date.now();
    return [200, { state: view(r, side) }];
  },
  'POST /resign': (b) => {
    const r = rooms.get(String(b.room || '').toUpperCase()); if (!r) return [404, { error: 'That game is gone.' }];
    const side = sideOf(r, b.token); if (!side) return [403, { error: 'You are watching this game.' }];
    if (!r.g || r.g.winner) return [409, { error: 'Nothing to resign.' }];
    const out = R.resign(r.g, side); describe(r, r.g, out); r.g = out; r.v++; r.touched = r.doneAt = Date.now();
    return [200, { state: view(r, side) }];
  },
  'GET /state': (b) => {
    const r = rooms.get(String(b.room || '').toUpperCase()); if (!r) return [404, { error: 'That game is gone.' }];
    const side = sideOf(r, b.token);
    if (side) r.seen[side] = Date.now();
    const full = view(r, side, String(b.sid || '').slice(0, 24));
    return [200, full];
  },
  'GET /live': () => {
    sweep();
    const now = Date.now(), list = [];
    for (const r of rooms.values()) {
      if (!r.g) continue;
      list.push({
        room: r.id, level: r.level, names: r.names, score: r.g.score, dice: { A: R.count(r.g, 'A'), B: R.count(r.g, 'B') },
        turn: r.g.turn, over: !!r.g.winner, winner: r.g.winner, moves: r.g.moves,
        watching: Object.keys(r.spec).filter(k => now - r.spec[k] < 15000).length,
      });
    }
    list.sort((a, b) => (a.over - b.over) || (b.moves - a.moves));
    return [200, { games: list.slice(0, 60), waiting: [...rooms.values()].filter(r => !r.g).length }];
  },
};

// returns true when the request was for /api/draft/*; send and readBody come from server.js
async function handle(req, res, url, send, readBody) {
  const key = `${req.method} ${url.pathname.slice('/api/draft'.length)}`;
  const fn = routes[key];
  if (!fn) { send(res, 404, { error: 'Unknown Draft route.' }); return true; }
  try {
    const body = req.method === 'POST' ? await readBody(req) : Object.fromEntries(url.searchParams);
    const [code_, out] = fn(body);
    send(res, code_, out);
  } catch (e) { send(res, 400, { error: 'Bad request.' }); }
  return true;
}
module.exports = { handle, rooms };
