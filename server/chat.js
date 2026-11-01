'use strict';
// Vistr chat between two players. A thread opens when an invite is accepted and stays open until BOTH players
// agree to end it. Every message is kept in server/data/chat.json, so when the same two players meet again
// their conversation comes back. Messages are plain text only.
const fs = require('fs');
const path = require('path');

const FILE = process.env.VISTR_CHAT || path.join(path.dirname(process.env.VISTR_DB || path.join(__dirname, 'data', 'db.json')), 'chat.json');
const MAX_TEXT = 300, MAX_KEPT = 1000, MIN_GAP_MS = 700;

function create({ push, store, send }) {
  let threads = {};
  try { threads = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch (_) { /* first run */ }
  let timer = null;
  function save() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(threads)); fs.renameSync(tmp, FILE); }
      catch (e) { console.error('Could not save chat', e.message); }
    }, 300);
    if (timer.unref) timer.unref();
  }
  const keyOf = (a, b) => [a, b].sort().join('|');
  const last = new Map();   // playerId -> time of their last message

  function thread(a, b, make) {
    const k = keyOf(a, b);
    if (!threads[k] && make) threads[k] = { ids: [a, b].sort(), open: false, ends: [], seq: 0, read: {}, msgs: [] };
    return threads[k] || null;
  }
  function codeOf(id) { const p = store.getPlayer(id); return p ? p.code : ''; }
  function nameOf(id) { const p = store.getPlayer(id); return p ? (p.name || '') : ''; }
  function state(t, forId) {
    const other = t.ids.find(x => x !== forId);
    const lastRead = t.read[forId] || 0;
    return { with: codeOf(other), name: nameOf(other), open: t.open, endBy: t.ends.includes(forId) ? 'me' : t.ends.length ? 'them' : '',
      unread: t.msgs.filter(m => m.n > lastRead && !m.sys && m.from !== forId).length, count: t.msgs.length, last: t.msgs.length ? t.msgs[t.msgs.length - 1].t : 0 };
  }
  function view(m, forId) { return { n: m.n, mine: m.from === forId, t: m.t, text: m.text, sys: !!m.sys }; }
  function announce(t) { for (const id of t.ids) push(id, 'chat-state', state(t, id)); }
  function addSystem(t, text) { t.msgs.push({ n: ++t.seq, from: '', t: Date.now(), text, sys: true }); }

  // an invite was accepted: the chat opens (an old conversation between the same two comes back with it)
  function open(a, b) {
    const t = thread(a, b, true);
    const again = t.msgs.some(m => !m.sys);
    t.open = true; t.ends = [];
    addSystem(t, again ? 'You are chatting again. Your earlier messages are above.' : 'Chat opened. Say hello before you start.');
    save(); announce(t);
  }
  function clean(s) { return String(s || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT); }
  function other(t, id) { return t.ids.find(x => x !== id); }
  function mine(me, code) {
    const o = store.findPlayerByCode(String(code || '').replace(/\D/g, ''));
    const t = o && thread(me.id, o.id, false);
    return t && { t, o };
  }

  const routes = {
    'GET /api/chat': async (req, res, { me }) => {
      const list = Object.values(threads).filter(t => t.ids.includes(me.id)).map(t => state(t, me.id)).filter(s => s.with);
      list.sort((a, b) => b.last - a.last);
      send(res, 200, { chats: list });
    },
    'GET /api/chat/thread': async (req, res, { me, url }) => {
      const x = mine(me, url.searchParams.get('with'));
      if (!x) return send(res, 404, { error: 'No chat with that player yet.' });
      const after = Number(url.searchParams.get('after')) || 0;
      send(res, 200, { state: state(x.t, me.id), msgs: x.t.msgs.filter(m => m.n > after).slice(-200).map(m => view(m, me.id)) });
    },
    'POST /api/chat/send': async (req, res, { me, body }) => {
      const x = mine(me, body.with);
      if (!x || !x.t.open) return send(res, 409, { error: 'This chat is closed. It opens again when one of you invites the other.' });
      const text = clean(body.text);
      if (!text) return send(res, 400, { error: 'Type a message first.' });
      const now = Date.now();
      if (now - (last.get(me.id) || 0) < MIN_GAP_MS) return send(res, 429, { error: 'Slow down a little.' });
      last.set(me.id, now);
      const m = { n: ++x.t.seq, from: me.id, t: now, text };
      x.t.msgs.push(m); if (x.t.msgs.length > MAX_KEPT) x.t.msgs.splice(0, x.t.msgs.length - MAX_KEPT);
      x.t.ends = [];   // talking again cancels a pending "end chat"
      x.t.read[me.id] = m.n;
      save();
      push(x.o.id, 'chat', { with: codeOf(me.id), name: nameOf(me.id), msg: view(m, x.o.id) });
      push(me.id, 'chat', { with: codeOf(x.o.id), name: nameOf(x.o.id), msg: view(m, me.id) });
      announce(x.t);
      send(res, 200, { ok: true, msg: view(m, me.id) });
    },
    'POST /api/chat/read': async (req, res, { me, body }) => {
      const x = mine(me, body.with);
      if (x) { x.t.read[me.id] = x.t.seq; save(); push(me.id, 'chat-state', state(x.t, me.id)); }
      send(res, 200, { ok: true });
    },
    // Ending takes both players: the first one asks, the second one agrees. Asking again, or typing, withdraws it.
    'POST /api/chat/end': async (req, res, { me, body }) => {
      const x = mine(me, body.with);
      if (!x || !x.t.open) return send(res, 409, { error: 'This chat is already closed.' });
      const t = x.t;
      if (body.cancel) { t.ends = t.ends.filter(i => i !== me.id); }
      else if (!t.ends.includes(me.id)) t.ends.push(me.id);
      if (t.ends.length >= 2) { t.open = false; t.ends = []; addSystem(t, 'You both ended the chat. It will be here if you play again.'); }
      else if (t.ends.length === 1 && !body.cancel) addSystem(t, `Player ${codeOf(me.id)} would like to end the chat.`);
      save(); announce(t);
      for (const id of t.ids) push(id, 'chat', { with: codeOf(other(t, id)), name: nameOf(other(t, id)), msg: view(t.msgs[t.msgs.length - 1], id) });
      send(res, 200, { state: state(t, me.id) });
    },
  };
  return { routes, open, threads: () => threads };
}
module.exports = { create };
