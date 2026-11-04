/* Vistr chat: opens when an invite is accepted, stays until both players end it, and the server keeps the history. */
(function () {
  'use strict';
  var H = null, chats = {}, cur = '', box = null, fab = null, listEl = null, msgsEl = null, headEl = null, form = null, endBtn = null, openPanel = false, inGameSeen = false;
  function T(s, v) { return H && H.t ? H.t(s, v) : s; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function label(c) { var s = chats[c]; return s && s.state.name ? s.state.name + ' (' + c + ')' : T('Player {p}', { p: c }); }
  function totalUnread() { var n = 0; for (var c in chats) n += chats[c].state.unread || 0; return n; }

  function build() {
    if (box) return;
    fab = el('button', 'chat-fab', ''); fab.type = 'button'; fab.hidden = true; fab.setAttribute('aria-label', 'Chat');
    fab.onclick = function () { setPanel(!openPanel); };
    box = el('section', 'chat-panel'); box.hidden = true; box.setAttribute('aria-label', 'Chat');
    var top = el('div', 'chat-top'); headEl = el('b', 'chat-title', ''); var back = el('button', 'chat-x', '←'); back.type = 'button'; back.title = T('All chats');
    back.onclick = function () { cur = ''; render(); };
    var x = el('button', 'chat-x', '×'); x.type = 'button'; x.setAttribute('aria-label', T('Close')); x.onclick = function () { setPanel(false); };
    top.appendChild(back); top.appendChild(headEl); top.appendChild(x);
    listEl = el('div', 'chat-list'); msgsEl = el('div', 'chat-msgs'); msgsEl.setAttribute('aria-live', 'polite');
    form = el('form', 'chat-form'); var inp = el('input'); inp.maxLength = 300; inp.placeholder = T('Type a message'); inp.autocomplete = 'off'; inp.setAttribute('aria-label', T('Type a message'));
    var send = el('button', 'chat-send', T('Send')); send.type = 'submit'; form.appendChild(inp); form.appendChild(send);
    form.onsubmit = function (e) { e.preventDefault(); var v = inp.value.trim(); if (!v || !cur) return; inp.value = ''; post('/api/chat/send', { with: cur, text: v }).catch(function (er) { H.toast(er.message); inp.value = v; }); };
    endBtn = el('button', 'chat-end', ''); endBtn.type = 'button';
    endBtn.onclick = function () {
      var s = chats[cur]; if (!s) return;
      post('/api/chat/end', { with: cur, cancel: s.state.endBy === 'me' }).then(function (r) { s.state = r.state; render(); }).catch(function (er) { H.toast(er.message); });
    };
    box.appendChild(top); box.appendChild(listEl); box.appendChild(msgsEl); box.appendChild(form); box.appendChild(endBtn);
    document.body.appendChild(fab); document.body.appendChild(box);
  }
  function post(path, body) { return H.api('POST', path, body); }

  function setPanel(on) { openPanel = on; if (on && !cur) { var open = Object.keys(chats).filter(function (c) { return chats[c].state.open; }); if (open.length === 1) cur = open[0]; } if (on && cur) load(cur); render(); }
  function load(c) {
    var s = chats[c]; if (!s) return;
    H.api('GET', '/api/chat/thread?with=' + encodeURIComponent(c) + '&after=0').then(function (r) { s.state = r.state; s.msgs = r.msgs; s.loaded = true; render(); markRead(c); }).catch(function () {});
  }
  function markRead(c) { var s = chats[c]; if (s && openPanel && cur === c && s.state.unread) { s.state.unread = 0; post('/api/chat/read', { with: c }).catch(function () {}); render(); } }

  // On the game screen the panel docks right under the Process button and squeezes the panes below it.
  function place() {
    if (!box) return;
    var g = document.querySelector('.screen.game'), any = Object.keys(chats).length > 0, docked = !!g && openPanel && any;
    document.body.classList.toggle('chat-ingame', !!g);
    if (g) g.classList.toggle('chat-on', docked);
    box.classList.toggle('docked', docked);
    if (docked) { var a = g.querySelector('.actions'); if (a && a.nextSibling !== box) a.parentNode.insertBefore(box, a.nextSibling); }
    else if (box.parentNode !== document.body) document.body.appendChild(box);
    return !!g;
  }
  setInterval(function () { if (box && place() !== inGameSeen) { inGameSeen = !inGameSeen; render(); } }, 400);

  function render() {
    if (!box) return;
    var any = Object.keys(chats).length > 0, u = totalUnread(), g = place();
    inGameSeen = !!g;
    fab.hidden = !any; fab.textContent = g ? '\uD83D\uDCAC' + (u ? ' ' + u : '') : T('Chat') + (u ? ' (' + u + ')' : ''); fab.classList.toggle('has', u > 0); fab.classList.toggle('side', !!g);
    box.hidden = !openPanel || !any;
    if (box.hidden) return;
    var inThread = !!(cur && chats[cur]);
    listEl.hidden = inThread; msgsEl.hidden = !inThread; form.hidden = !inThread || !chats[cur].state.open; endBtn.hidden = !inThread || !chats[cur].state.open;
    box.querySelector('.chat-x').hidden = !inThread;
    if (!inThread) {
      headEl.textContent = T('Chats'); listEl.innerHTML = '';
      Object.keys(chats).sort(function (a, b) { return chats[b].state.last - chats[a].state.last; }).forEach(function (c) {
        var s = chats[c].state, b = el('button', 'chat-row'); b.type = 'button';
        b.appendChild(el('span', 'chat-who', label(c))); b.appendChild(el('span', 'chat-meta', (s.open ? T('Open') : T('Ended')) + (s.unread ? ' • ' + s.unread + ' ' + T('new') : '')));
        b.onclick = function () { cur = c; load(c); render(); }; listEl.appendChild(b);
      });
      return;
    }
    var s = chats[cur], st = s.state;
    headEl.textContent = label(cur) + (st.open ? '' : ' - ' + T('ended'));
    var stick = msgsEl.scrollTop + msgsEl.clientHeight >= msgsEl.scrollHeight - 40;
    msgsEl.innerHTML = '';
    (s.msgs || []).forEach(function (m) { var d = el('div', 'chat-msg' + (m.sys ? ' sys' : m.mine ? ' me' : ' them'), m.text); msgsEl.appendChild(d); });
    if (stick || !s.shown) msgsEl.scrollTop = msgsEl.scrollHeight; s.shown = true;
    endBtn.textContent = st.endBy === 'me' ? T('Cancel ending the chat') : st.endBy === 'them' ? T('Agree to end the chat') : T('End chat');
    endBtn.classList.toggle('ask', st.endBy === 'them');
  }

  function onState(st) {
    build(); var c = st.with; if (!c) return;
    var prev = chats[c], wasOpen = prev && prev.state.open;
    if (!prev) prev = chats[c] = { state: st, msgs: [], loaded: false };
    prev.state = st;
    if (st.open && !wasOpen) {   // just opened: bring the chat up so players can talk before the game
      cur = c; prev.loaded = false; prev.shown = false; openPanel = !document.querySelector('.screen.game'); load(c);
      H.toast(T('Chat with {p} is open', { p: label(c) }));
    }
    render(); markRead(c);
  }
  function onMsg(d) {
    build(); var s = chats[d.with]; if (!s) return;
    if (s.loaded && !s.msgs.some(function (m) { return m.n === d.msg.n; })) s.msgs.push(d.msg);
    if (!d.msg.mine && !d.msg.sys && !(openPanel && cur === d.with)) H.toast(label(d.with) + ': ' + d.msg.text);
    render(); markRead(d.with);
  }

  window.VistrChat = {
    // called by app.js each time the live connection is made
    attach: function (es, hooks) {
      H = hooks; build(); chats = {}; cur = ''; openPanel = false; render();
      es.addEventListener('chat-state', function (e) { onState(JSON.parse(e.data)); });
      es.addEventListener('chat', function (e) { onMsg(JSON.parse(e.data)); });
      H.api('GET', '/api/chat').then(function (r) { (r.chats || []).forEach(function (st) { if (!chats[st.with]) chats[st.with] = { state: st, msgs: [], loaded: false }; }); render(); }).catch(function () {});
    },
    reset: function () { chats = {}; cur = ''; openPanel = false; if (box) render(); },
  };
})();
