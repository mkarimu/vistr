// Vistr Lite: counts who uses it, without asking for anything.
// - Signed in to Vistr in this browser: plays are counted on that Vistr ID.
// - Otherwise the server gives this browser a guest ID (L-4821), kept here. The same ID is used by the Vistr app on the web.
// Nothing personal is sent or kept (no name, email or IP address). A failed report never gets in the way of a game.
(function () {
  'use strict';
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private window: no ID kept */ } };
  const post = (path, body, token) => fetch(path, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: JSON.stringify(body) }).then(r => r.json().catch(() => ({}))).catch(() => ({}));
  let guest = null;
  try { guest = JSON.parse(get('vistr.guest') || 'null'); } catch (e) { guest = null; }
  const player = () => get('vistr.token');   // the Vistr app keeps its sign-in here (same address as Lite)
  let ready = null;
  function ensure() {
    if (player() || (guest && guest.token)) return Promise.resolve();
    if (!ready) ready = post('/api/guest/new', { src: 'lite' }).then(d => { if (d.token) { guest = { code: d.code, token: d.token }; set('vistr.guest', JSON.stringify(guest)); } });
    return ready;
  }
  function ping(kind, n) {
    return ensure().then(() => {
      if (player()) return post('/api/guest/ping', { kind, n, src: 'lite' }, player());
      if (guest) return post('/api/guest/ping', { kind, n, src: 'lite', guest: guest.token });
    });
  }
  window.LiteTrack = { play() { ping('play', 1); } };
  ping('open');
})();
