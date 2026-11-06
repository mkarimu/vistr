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
  var audio = null, failed = false;

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
  strip.innerHTML = '<span class="rb-dot" aria-hidden="true"></span><span class="rb-name"></span><span class="grow"></span><button type="button" class="rb-mute" data-rm></button><input type="range" class="rb-vol" min="0" max="100" aria-label="Volume"><button type="button" class="rb-x" data-rx aria-label="Turn music off">&times;</button>';
  var host = document.getElementById('appbar');
  host.parentNode.insertBefore(strip, host.nextSibling);

  var sw = pop.querySelector('[data-rs]'), nm = strip.querySelector('.rb-name'), mb = strip.querySelector('[data-rm]'), vr = strip.querySelector('.rb-vol');

  function ensure() {
    if (audio) return audio;
    audio = new Audio(); audio.preload = 'none'; audio.src = URL_;
    audio.addEventListener('error', function () { failed = true; draw(); });
    audio.addEventListener('playing', function () { failed = false; draw(); });
    return audio;
  }
  function apply() {
    if (!audio) return;
    audio.muted = muted; audio.volume = vol;
  }
  function draw() {
    sw.checked = on; strip.hidden = !on; document.body.classList.toggle('has-radiobar', on);
    dots.classList.toggle('on', on);
    nm.textContent = failed ? 'Radio not available right now' : NAME + (muted ? ' (muted)' : '');
    mb.textContent = muted ? '🔇 Unmute' : '🔊';
    mb.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    vr.value = Math.round(vol * 100); vr.hidden = muted;
  }
  function start() { ensure(); apply(); var p = audio.play(); if (p && p.catch) p.catch(function () { /* waits for a tap */ }); }
  function stop() { if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); audio = null; } failed = false; }
  function set(v) {
    on = v; put('vistr.music', v ? '1' : '0');
    if (v) { muted = true; put('vistr.musicMuted', '1'); start(); } else stop();
    draw();
  }

  dots.onclick = function (e) { e.stopPropagation(); pop.hidden = !pop.hidden; dots.setAttribute('aria-expanded', String(!pop.hidden)); };
  document.addEventListener('click', function (e) { if (!pop.hidden && !pop.contains(e.target) && e.target !== dots) { pop.hidden = true; dots.setAttribute('aria-expanded', 'false'); } });
  sw.onchange = function () { set(sw.checked); pop.hidden = true; dots.setAttribute('aria-expanded', 'false'); };
  mb.onclick = function () { muted = !muted; put('vistr.musicMuted', muted ? '1' : '0'); apply(); if (audio && audio.paused) start(); draw(); };
  vr.oninput = function () { vol = vr.value / 100; put('vistr.musicVol', String(vol)); apply(); };
  strip.querySelector('[data-rx]').onclick = function () { set(false); };

  window.VistrRadio = { set: set, isOn: function () { return on; } };
  if (on) { muted = true; start(); }   // remembered: resume, muted
  draw();
})();
