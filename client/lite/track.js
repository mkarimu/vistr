// Vistr Lite: who is playing?
// - Signed in to Vistr in this browser: that Vistr ID is picked automatically and Lite just opens.
// - Not known: the game is blurred and the person chooses: type their Vistr ID, or let this browser get its own guest ID (L-1234).
// Either way the game then opens. Nothing personal is asked or kept (no name, email, password or IP address).
// If the server can't be reached, the person can still play without being counted.
(function () {
  'use strict';
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private window: no ID kept */ } };
  const post = (path, body, token) => fetch(path, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: JSON.stringify(body) })
    .then(r => r.json().then(d => ({ ok: r.ok, d }), () => ({ ok: r.ok, d: {} }))).catch(() => ({ ok: false, d: {}, offline: true }));
  let guest = null;
  try { guest = JSON.parse(get('vistr.guest') || 'null'); } catch (e) { guest = null; }
  const player = () => get('vistr.token');   // the Vistr app keeps its sign-in here (same address as Lite)
  let skipped = false;
  const known = () => !!(player() || (guest && guest.token));
  function ping(kind, n) {
    if (skipped) return;
    if (player()) return post('/api/guest/ping', { kind, n, src: 'lite' }, player());
    if (guest && guest.token) return post('/api/guest/ping', { kind, n, src: 'lite', guest: guest.token });
  }
  window.LiteTrack = { play() { ping('play', 1); } };

  function gate() {
    const o = document.createElement('div');
    o.id = 'lt-gate'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true');
    o.innerHTML = '<div class="lt-card"><h2>Who is playing?</h2>' +
      '<p>Type your Vistr ID so your games count on it, or let this browser get an ID of its own.</p>' +
      '<form id="lt-form"><input id="lt-id" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="Your Vistr ID (numbers)" aria-label="Your Vistr ID">' +
      '<button type="submit" class="lt-btn">Use my Vistr ID</button></form>' +
      '<div class="lt-or">or</div>' +
      '<button type="button" id="lt-new" class="lt-btn lt-alt">Assign this browser an ID</button>' +
      '<p id="lt-err" class="lt-err" role="alert"></p>' +
      '<button type="button" id="lt-skip" class="lt-link" hidden>Play without being counted</button></div>';
    document.body.appendChild(o);
    const err = o.querySelector('#lt-err'), skip = o.querySelector('#lt-skip');
    const done = () => { o.remove(); ping('open'); };
    const choose = async code => {
      err.textContent = ''; o.querySelectorAll('button').forEach(b => { b.disabled = true; });
      const r = await post('/api/guest/new', code ? { src: 'lite', playerCode: code } : { src: 'lite' });
      o.querySelectorAll('button').forEach(b => { b.disabled = false; });
      if (r.ok && r.d.token) { guest = { code: r.d.code, token: r.d.token }; set('vistr.guest', JSON.stringify(guest)); return done(); }
      err.textContent = r.offline ? "Can't reach the game server right now." : (r.d.error || 'Something went wrong. Try again.');
      if (r.offline || !r.d.error) skip.hidden = false;
    };
    o.querySelector('#lt-form').addEventListener('submit', e => { e.preventDefault(); const c = o.querySelector('#lt-id').value.replace(/\D/g, ''); if (!c) { err.textContent = 'Type your Vistr ID, or choose "Assign this browser an ID".'; return; } choose(c); });
    o.querySelector('#lt-new').addEventListener('click', () => choose(''));
    skip.addEventListener('click', () => { skipped = true; o.remove(); });
    setTimeout(() => { const i = o.querySelector('#lt-id'); if (i) i.focus(); }, 50);
  }

  function start() { if (known()) ping('open'); else gate(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
