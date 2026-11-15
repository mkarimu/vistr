// Mkarimu Radio: a three-dots menu with a Music switch, and a thin sticky player under the header.
// Off until the player switches it on; when on it starts muted (browsers only allow muted autoplay).
(function () {
  'use strict';
  var URL_ = 'https://memoryq.com/radio/3.mp3', NAME = 'Mkarimu Radio';
  var bar = document.querySelector('.appbar-in'); if (!bar || window.VistrRadio) return;
  function get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function put(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  var on = get('vistr.music') === '1', muted = get('vistr.musicMuted') !== '0', vol = Number(get('vistr.musicVol'));
  if (!(vol >= 0 && vol <= 1) || get('vistr.musicVol') === null) vol = 0.6;
  var audio = null, failed = false, paused = false;
  // In the Android app a native player (with a notification) keeps the radio going when you switch apps or the screen turns off.
  var NATIVE = (function () { try { var C = window.Capacitor; return C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.VistrRadio ? C.Plugins.VistrRadio : null; } catch (_) { return null; } })();
  var nativeOk = !!NATIVE;
  if (NATIVE && NATIVE.addListener) {
    try {
      NATIVE.addListener('state', function (s) {
        if (!s) return;
        if (s.on === false) { on = false; put('vistr.music', '0'); paused = false; failed = false; }
        else { paused = !s.playing && !s.buffering && !s.error; failed = !!s.error; }
        draw();
      });
    } catch (_) { nativeOk = false; }
  }

  var dots = document.createElement('button');
  dots.type = 'button'; dots.className = 'music-btn'; dots.setAttribute('aria-label', 'Music'); dots.setAttribute('aria-haspopup', 'true'); dots.setAttribute('aria-expanded', 'false');
  dots.innerHTML = '<i></i><i></i><i></i>';
  bar.insertBefore(dots, bar.firstChild);

  var pop = document.createElement('div');
  pop.className = 'radio-pop'; pop.hidden = true;
  pop.innerHTML = '<label class="radio-switch"><span><b>Music</b><small>' + NAME + '</small></span><input type="checkbox" data-rs><i aria-hidden="true"></i></label><p class="radio-note">Starts muted. Tap the speaker in the player to hear it.</p>';
  document.body.appendChild(pop);

  var strip = document.createElement('div');
  strip.className = 'radiobar'; strip.hidden = true;
  strip.innerHTML = '<span class="rb-dot" aria-hidden="true"></span><span class="rb-name"></span><span class="grow"></span><button type="button" class="rb-mute" data-rm></button><input type="range" class="rb-vol" min="0" max="100" aria-label="Volume"><button type="button" class="rb-pp" data-rp></button><button type="button" class="rb-x" data-rx aria-label="Turn music off">&times;</button>';
  var host = document.getElementById('appbar');
  host.parentNode.insertBefore(strip, host.nextSibling);

  var sw = pop.querySelector('[data-rs]'), nm = strip.querySelector('.rb-name'), mb = strip.querySelector('[data-rm]'), vr = strip.querySelector('.rb-vol'), pb = strip.querySelector('[data-rp]');

  function mediaSession() {
    try {
      if (!('mediaSession' in navigator) || !audio) return;
      navigator.mediaSession.metadata = new MediaMetadata({ title: NAME, artist: 'Vistr' });
      navigator.mediaSession.setActionHandler('play', function () { audio && audio.play(); });
      navigator.mediaSession.setActionHandler('pause', function () { audio && audio.pause(); });
      navigator.mediaSession.setActionHandler('stop', function () { set(false); });
    } catch (_) { /* older browsers */ }
  }
  function ensure() {
    if (audio) return audio;
    var a = audio = new Audio(); audio.preload = 'none'; audio.src = URL_;
    audio.addEventListener('pause', function () { if (audio === a) { paused = true; draw(); } });
    audio.addEventListener('play', function () { if (audio === a) { paused = false; draw(); } });
    audio.addEventListener('error', function () { failed = true; draw(); });
    audio.addEventListener('playing', function () { failed = false; draw(); });
    mediaSession();
    return audio;
  }
  function apply() {
    if (nativeOk) { try { NATIVE.setVolume({ volume: vol, muted: muted }); } catch (_) {} return; }
    if (!audio) return;
    audio.muted = muted; audio.volume = vol;
  }
  function draw() {
    sw.checked = on; strip.hidden = !on; document.body.classList.toggle('has-radiobar', on);
    dots.classList.toggle('on', on);
    nm.textContent = failed ? 'Radio not available right now' : NAME + (paused ? ' (paused)' : muted ? ' (muted)' : '');
    mb.textContent = muted ? '🔇 Unmute' : '🔊';
    mb.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    vr.value = Math.round(vol * 100); vr.hidden = muted;
    pb.textContent = paused ? '\u25B6 Resume' : '\u23F8 Pause';
    pb.setAttribute('aria-label', paused ? 'Resume the radio' : 'Pause the radio');
  }
  function start() {
    if (nativeOk) {
      try {
        var r = NATIVE.start({ url: URL_, name: NAME, volume: vol, muted: muted });
        if (r && r.catch) r.catch(function () { nativeOk = false; start(); });
        return;
      } catch (_) { nativeOk = false; }
    }
    ensure(); apply(); var p = audio.play(); if (p && p.catch) p.catch(function () { /* waits for a tap */ });
  }
  function stop() {
    if (nativeOk) { try { NATIVE.stop(); } catch (_) {} paused = false; failed = false; return; }
    if (audio) { var a0 = audio; audio = null; a0.pause(); a0.removeAttribute('src'); a0.load(); } failed = false; paused = false; }
  function set(v) {
    on = v; put('vistr.music', v ? '1' : '0');
    if (v) { muted = true; put('vistr.musicMuted', '1'); start(); } else stop();
    draw();
  }

  dots.onclick = function (e) { e.stopPropagation(); pop.hidden = !pop.hidden; dots.setAttribute('aria-expanded', String(!pop.hidden)); };
  document.addEventListener('click', function (e) { if (!pop.hidden && !pop.contains(e.target) && e.target !== dots) { pop.hidden = true; dots.setAttribute('aria-expanded', 'false'); } });
  sw.onchange = function () { set(sw.checked); pop.hidden = true; dots.setAttribute('aria-expanded', 'false'); };
  mb.onclick = function () { muted = !muted; put('vistr.musicMuted', muted ? '1' : '0'); apply(); if (nativeOk ? paused : (audio && audio.paused)) start(); draw(); };
  vr.oninput = function () { vol = vr.value / 100; put('vistr.musicVol', String(vol)); apply(); };
  pb.onclick = function () {
    if (nativeOk) { try { NATIVE.toggle(); } catch (_) {} return; }
    if (!audio) { start(); } else if (audio.paused) { var p = audio.play(); if (p && p.catch) p.catch(function () {}); } else { audio.pause(); }
  };
  strip.querySelector('[data-rx]').onclick = function () { set(false); };

  window.VistrRadio = { set: set, isOn: function () { return on; } };
  if (on) { muted = true; start(); }   // remembered: resume, muted
  draw();
})();
