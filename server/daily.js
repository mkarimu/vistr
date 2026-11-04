'use strict';
// Daily Challenge: turn the START word into the TARGET word, one letter at a time, every step a real word.
// One pair per word length (4-7) each day, the same for everyone, checked solvable with the game's own word list.
// - Opens after the player has finished 6 games that day (the same count as Weekly Champions).
// - Clock: 4 letters 4:00, 5 letters 4:30, 6 letters 5:00, 7 letters 5:30; every re-attempt that day takes 1 minute
//   off (never below 1:00). A head-to-head pair gets 1.5 times the time (DUO_FACTOR, for the pair mode).
// - The server keeps the clock and a log of every attempt. Best attempt per length counts.
// - Day ranking: most lengths solved, then fewest steps, then least time. Top three get the weekly credits
//   (1000, 700, 500). A tie for a prize place gets a fresh word pair that waits (hibernates) for 48 hours.
const crypto = require('crypto');
const dict = require('./dictionary');
const W = require('./weekly');

const LENS = [4, 5, 6, 7];
const NEED_GAMES = process.env.DAILY_NEED_GAMES !== undefined ? Number(process.env.DAILY_NEED_GAMES) : 6, MIN_SECONDS = 60, DUO_FACTOR = 1.5, TIE_HOURS = 48, TIE_LEN = 5, GRACE_MS = 1500;
const baseSeconds = len => 240 + 30 * (len - 4);
const secondsFor = (len, attempt, duo = false) => Math.round(Math.max(MIN_SECONDS, baseSeconds(len) - 60 * (attempt - 1)) * (duo ? DUO_FACTOR : 1));

// a small seeded random generator, so a day's pair is the same for everyone and after a restart
function rng(seedText) {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i++) { h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = (h ^ (h >>> 15)) >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// breadth-first search from a word: { word: steps away } up to maxDepth, and the way back
function reach(start, len, maxDepth) {
  const words = dict.wordsFor(len), dist = { [start]: 0 }, prev = {}, queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const u = queue[i]; if (dist[u] >= maxDepth) continue;
    for (const v of dict.neighbours(u)) if (!(v in dist) && words.has(v)) { dist[v] = dist[u] + 1; prev[v] = u; queue.push(v); }
  }
  return { dist, prev };
}
const RANGE = { 4: [3, 5], 5: [3, 6], 6: [3, 6], 7: [3, 6] };
function makePair(seed, len, avoid = []) {
  const r = rng(seed), common = dict.poolFor(len, 'learner'), [lo, hi] = RANGE[len];
  for (let tries = 0; tries < 300; tries++) {
    const start = common[Math.floor(r() * common.length)];
    if (avoid.includes(start)) continue;
    const { dist, prev } = reach(start, len, hi);
    const targets = common.filter(w => dist[w] >= lo && dist[w] <= hi && !avoid.includes(w));
    if (!targets.length) continue;
    const target = targets[Math.floor(r() * targets.length)];
    const way = []; for (let u = target; u; u = prev[u]) way.push(u);
    return { len, start, target, best: dist[target], way: way.reverse() };
  }
  return null;
}

function create({ store, push, adminOk, send }) {
  const st = () => { const s = store.getStats(); s.daily = s.daily || { from: '', days: {}, ties: [] }; return s.daily; };
  const dayRec = day => { const d = st(); d.days[day] = d.days[day] || { pairs: {}, attempts: [], closed: false }; return d.days[day]; };
  const prune = () => { const d = st(), keys = Object.keys(d.days).sort(); for (const k of keys.slice(0, Math.max(0, keys.length - 60))) delete d.days[k]; };
  function pairOf(day, len) {
    const rec = dayRec(day);
    if (!rec.pairs[len]) { rec.pairs[len] = makePair(day + ':' + len, len); store.saveStats(); }
    return rec.pairs[len];
  }
  const runs = new Map();   // player id -> the attempt being played

  const bestOf = list => list.filter(a => a.solved).sort((a, b) => a.steps - b.steps || a.secs - b.secs)[0] || null;
  function dayStanding(day) {
    const byPlayer = new Map();
    for (const a of dayRec(day).attempts) if (a.kind === 'daily') { if (!byPlayer.has(a.pid)) byPlayer.set(a.pid, []); byPlayer.get(a.pid).push(a); }
    const rows = [];
    for (const [pid, list] of byPlayer) {
      let lens = 0, steps = 0, secs = 0;
      for (const L of LENS) { const b = bestOf(list.filter(a => a.len === L)); if (b) { lens++; steps += b.steps; secs += b.secs; } }
      const p = store.getPlayer(pid);
      if (lens && p && !p.paused && !/@bots\.memoryq\.com$/i.test(p.email || '')) rows.push({ pid, code: p.code, name: p.name || '', lens, steps, secs });
    }
    rows.sort((a, b) => b.lens - a.lens || a.steps - b.steps || a.secs - b.secs);
    rows.forEach((r, i) => { r.rank = i + 1; });
    return rows;
  }
  const sameKey = (a, b) => a.lens === b.lens && a.steps === b.steps && a.secs === b.secs;
  function pay(pid, credits, why) {
    store.addCredits(pid, credits);
    if (push) push(pid, 'champion', { week: why, rank: 0, credits, daily: true });
  }
  // close every finished day once: pay the top three, or park a tie-break for the places that are tied
  function closeDue(now = Date.now()) {
    const d = st(), today = W.dayKey(now);
    if (!d.from) { d.from = today; store.saveStats(); }
    let changed = false;
    for (let day = d.from; day < today; day = W.addDays(day, 1)) {
      const rec = dayRec(day); if (rec.closed) continue;
      const rows = dayStanding(day), top = rows.slice(0, 3), out = [];
      for (const r of top) {
        const group = rows.filter(x => sameKey(x, r));
        if (group.length === 1) { pay(r.pid, W.AWARDS[r.rank - 1], day); out.push({ rank: r.rank, code: r.code, credits: W.AWARDS[r.rank - 1] }); }
      }
      // a tie that touches a prize place: the tied players play a fresh pair; the prizes wait for it
      const tied = new Set();
      for (const r of top) { const g = rows.filter(x => sameKey(x, r)); if (g.length > 1) g.forEach(x => tied.add(x.pid)); }
      if (tied.size) {
        const first = Math.min(...rows.filter(x => tied.has(x.pid)).map(x => x.rank));
        const places = []; for (let p = first; p <= Math.min(3, first + tied.size - 1); p++) places.push(W.AWARDS[p - 1]);
        const pair = makePair('tie:' + day, TIE_LEN, Object.values(rec.pairs).map(x => x.start));
        d.ties.push({ day, players: [...tied], places, pair, expires: now + TIE_HOURS * 3600_000, resolved: false, attempts: [] });
        console.log(`[daily] ${day}: tie between ${[...tied].map(i => store.getPlayer(i).code).join(', ')} - a tie-break pair is waiting for ${TIE_HOURS} hours`);
      }
      rec.closed = true; rec.winners = out; changed = true;
      console.log(`[daily] ${day}: ` + (out.map(x => `#${x.rank} Player ${x.code} +${x.credits}`).join(', ') || 'no clear winners'));
    }
    // tie-breaks that were played by everyone, or that ran out of time
    for (const t of d.ties) {
      if (t.resolved) continue;
      const all = t.players.every(pid => t.attempts.some(a => a.pid === pid && a.ended));
      if (!all && now < t.expires) continue;
      const score = pid => { const a = t.attempts.filter(x => x.pid === pid && x.solved).sort((p, q) => p.steps - q.steps || p.secs - q.secs)[0]; return a ? { s: a.steps, c: a.secs } : null; };
      const order = [...t.players].sort((p, q) => { const x = score(p), y = score(q); if (x && !y) return -1; if (!x && y) return 1; if (!x && !y) return 0; return x.s - y.s || x.c - y.c; });
      order.forEach((pid, i) => { const share = t.places[i] != null ? t.places[i] : 0; if (share) pay(pid, share, t.day); });
      t.resolved = true; t.result = order.map(pid => store.getPlayer(pid) && store.getPlayer(pid).code); changed = true;
      console.log(`[daily] tie-break for ${t.day}: ${t.result.join(' > ')}`);
    }
    if (changed) { prune(); store.saveStats(); }
  }

  const unlocked = id => store.todayGames(id) >= NEED_GAMES;
  function attemptsOf(id, day, kind, len) { return dayRec(day).attempts.filter(a => a.pid === id && a.kind === kind && (len == null || a.len === len)); }

  const routes = {
    'GET /api/daily': async (req, res, { me }) => {
      closeDue();
      const day = W.dayKey(Date.now()), games = store.todayGames(me.id), open = games >= NEED_GAMES;
      const lens = LENS.map(L => {
        const pair = pairOf(day, L), mine = attemptsOf(me.id, day, 'daily', L), best = bestOf(mine);
        return { len: L, start: pair.start, target: pair.target, attempts: mine.length, seconds: secondsFor(L, mine.length + 1), best: best && { steps: best.steps, secs: best.secs }, solved: !!best };
      });
      const board = dayStanding(day).slice(0, 10).map(r => ({ rank: r.rank, code: r.code, name: r.name, lens: r.lens, steps: r.steps, secs: r.secs, me: r.pid === me.id }));
      const ties = st().ties.filter(t => !t.resolved && t.players.includes(me.id)).map(t => ({ day: t.day, len: t.pair.len, start: t.pair.start, target: t.pair.target, seconds: secondsFor(t.pair.len, 1), played: t.attempts.some(a => a.pid === me.id && a.ended), hoursLeft: Math.max(0, Math.round((t.expires - Date.now()) / 3600_000)) }));
      const yd = W.addDays(day, -1), last = st().days[yd] && st().days[yd].winners;
      send(res, 200, { day, unlocked: open, games, need: NEED_GAMES, toUnlock: Math.max(0, NEED_GAMES - games), awards: W.AWARDS, lens, board, ties, last: last || null, active: runs.has(me.id) });
    },
    'POST /api/daily/start': async (req, res, { me, body }) => {
      closeDue();
      const day = W.dayKey(Date.now());
      let kind = 'daily', len = Number(body.len), pair, secs, tie = null;
      if (body.tie) {
        tie = st().ties.find(t => !t.resolved && t.players.includes(me.id) && t.day === String(body.tie));
        if (!tie) return send(res, 404, { error: 'There is no tie-break waiting for you.' });
        if (tie.attempts.some(a => a.pid === me.id)) return send(res, 409, { error: 'You already played this tie-break.' });
        kind = 'tie'; pair = tie.pair; len = pair.len; secs = secondsFor(len, 1);
      } else {
        if (!LENS.includes(len)) return send(res, 400, { error: 'Pick a word length from 4 to 7.' });
        if (!unlocked(me.id)) return send(res, 403, { error: `Finish ${NEED_GAMES} games today to unlock the Daily Challenge.`, toUnlock: NEED_GAMES - store.todayGames(me.id) });
        pair = pairOf(day, len);
        secs = secondsFor(len, attemptsOf(me.id, day, 'daily', len).length + 1);
      }
      const n = kind === 'tie' ? 1 : attemptsOf(me.id, day, 'daily', len).length + 1;
      const old = runs.get(me.id); if (old && !old.rec.ended) { old.rec.ended = true; }
      const rec = { pid: me.id, code: me.code, kind, len, n, at: Date.now(), limit: secs, solved: false, steps: 0, secs: 0, ended: false };
      (tie ? tie.attempts : dayRec(day).attempts).push(rec);
      const run = { rec, pair, current: pair.start, steps: [pair.start], startedAt: Date.now(), limitMs: secs * 1000 };
      runs.set(me.id, run); store.saveStats();
      send(res, 200, { kind, len, attempt: n, seconds: secs, start: pair.start, target: pair.target, steps: run.steps });
    },
    'POST /api/daily/move': async (req, res, { me, body }) => {
      const run = runs.get(me.id);
      if (!run || run.rec.ended) return send(res, 409, { error: 'No challenge is running. Start one first.' });
      const elapsed = Date.now() - run.startedAt;
      const finish = solved => { run.rec.ended = true; run.rec.solved = solved; run.rec.steps = run.steps.length - 1; run.rec.secs = Math.ceil(Math.min(elapsed, run.limitMs) / 1000); store.saveStats(); };
      if (elapsed > run.limitMs + GRACE_MS) { finish(false); return send(res, 200, { over: true, solved: false, reason: 'time', steps: run.steps }); }
      const word = String(body.word || '').toLowerCase(), cur = run.current;
      if (word.length !== cur.length || !dict.isRealWord(word, cur.length)) return send(res, 200, { ok: false, reason: 'notword', left: Math.max(0, run.limitMs - elapsed) });
      let diff = 0; for (let i = 0; i < word.length; i++) if (word[i] !== cur[i]) diff++;
      if (diff !== 1) return send(res, 200, { ok: false, reason: 'oneletter', left: Math.max(0, run.limitMs - elapsed) });
      if (run.steps.includes(word)) return send(res, 200, { ok: false, reason: 'repeat', left: Math.max(0, run.limitMs - elapsed) });
      run.current = word; run.steps.push(word);
      const solved = word === run.pair.target;
      if (solved) { finish(true); return send(res, 200, { ok: true, over: true, solved: true, steps: run.steps, count: run.steps.length - 1, secs: run.rec.secs, best: run.pair.best }); }
      send(res, 200, { ok: true, current: word, steps: run.steps, left: Math.max(0, run.limitMs - elapsed) });
    },
    'POST /api/daily/quit': async (req, res, { me }) => {
      const run = runs.get(me.id);
      if (run && !run.rec.ended) { run.rec.ended = true; run.rec.steps = run.steps.length - 1; run.rec.secs = Math.ceil(Math.min(Date.now() - run.startedAt, run.limitMs) / 1000); store.saveStats(); }
      send(res, 200, { ok: true });
    },
    // who attempted what, for the admin (the memory log)
    'GET /api/admin/daily': async (req, res, { url }) => {
      if (!adminOk(url)) return send(res, 403, { error: 'Wrong admin key.' });
      const day = url.searchParams.get('day') || W.dayKey(Date.now());
      send(res, 200, { day, pairs: dayRec(day).pairs, attempts: dayRec(day).attempts, winners: dayRec(day).winners || null, ties: st().ties.filter(t => t.day === day) });
    },
  };
  return { routes, closeDue, pairOf, dayStanding, state: st, dayRec };
}
module.exports = { create, makePair, secondsFor, baseSeconds, DUO_FACTOR, LENS, NEED_GAMES };
