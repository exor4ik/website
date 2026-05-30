/**
 * 🔊 Voice Calls for EgorNetwork DMs
 * WebRTC + PeerJS + Web Audio API (FIXED for Render.com)
 */
'use strict';

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CALL_CONFIG = {
  customServer: {
    host: 'egor-peerjs.onrender.com',
    port: 443,
    path: '/myapp',
    secure: true,
  },
  audioConstraints: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  sounds: {
    incoming: 'sound/call_incoming.ogg',
    outgoing: 'sound/call_outgoing.ogg',
    connected: 'sound/call_connected.ogg',
    disconnected: 'sound/call_disconnected.ogg',
    busy: 'sound/call_busy.ogg',
    muteToggle: 'sound/call_mute_toggle.ogg',
    settingsSave: 'sound/call_settings_save.ogg',
  },
  settingsKey: 'egor_call_settings_v1',
  // Без TURN звонки не пробьют NAT. Это публичные серверы Open Relay.
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
  ]
};

// ─── STATE ───────────────────────────────────────────────────────────────────
let callPeer = null;
let callLocalStream = null;
let callRemoteStream = null;
let callCurrent = null;
let callAudioContext = null;
let callSoundBuffers = {};
let callCurrentOverlay = null;
let callCurrentTimerInterval = null;

let callSettings = {
  inputDeviceId: null,
  outputDeviceId: null,
  ringVolume: 0.7,
  callVolume: 1.0,
  micMuted: false,
};

// ─── AUDIO SYSTEM ────────────────────────────────────────────────────────────
async function initAudioContext() {
  if (callAudioContext) return callAudioContext;
  callAudioContext = new (window.AudioContext || window.webkitAudioContext)();
  await callAudioContext.resume();
  return callAudioContext;
}

async function loadSound(name, url) {
  if (callSoundBuffers[name]) return callSoundBuffers[name];
  const ctx = await initAudioContext();
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const arr = await resp.arrayBuffer();
  const buffer = await ctx.decodeAudioData(arr);
  callSoundBuffers[name] = buffer;
  return buffer;
}

function playSound(name, { loop = false, volume = 1.0 } = {}) {
  if (!callAudioContext) initAudioContext();
  const buffer = callSoundBuffers[name];
  if (!buffer) return null;
  try {
    const source = callAudioContext.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    const gain = callAudioContext.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(callAudioContext.destination);
    source.start();
    return { source, gain };
  } catch (e) {
    console.warn(`⚠️ PlaySound ${name} failed:`, e);
    return null;
  }
}

// ─── SETTINGS ────────────────────────────────────────────────────────────────
function loadCallSettings() {
  try {
    const saved = localStorage.getItem(CALL_CONFIG.settingsKey);
    if (saved) callSettings = { ...callSettings, ...JSON.parse(saved) };
  } catch (e) { console.warn('⚠️ Settings load failed', e); }
}

function saveCallSettings() {
  try {
    localStorage.setItem(CALL_CONFIG.settingsKey, JSON.stringify(callSettings));
    playSound('settingsSave', { volume: 0.5 });
  } catch (e) { console.warn('⚠️ Settings save failed', e); }
}

async function enumerateAudioDevices() {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      inputs: devices.filter(d => d.kind === 'audioinput'),
      outputs: devices.filter(d => d.kind === 'audiooutput'),
    };
  } catch (e) {
    console.warn('⚠️ Device enum failed', e);
    return { inputs: [], outputs: [] };
  }
}

// ─── PEER INIT ──────────────────────────────────────────────────────────────
function createPeer() {
  return new Promise((resolve, reject) => {
    if (callPeer) {
      try { callPeer.destroy(); } catch (e) {}
      callPeer = null;
    }

    const options = {
      host: CALL_CONFIG.customServer.host,
      port: CALL_CONFIG.customServer.port,
      path: CALL_CONFIG.customServer.path,
      secure: CALL_CONFIG.customServer.secure,
      debug: 3, // Пока не заработает — не снижай, смотри в консоль
      config: {
        iceServers: CALL_CONFIG.iceServers,
        sdpSemantics: 'unified-plan'
      },
      // 25 сек — чтобы Render не рвал WebSocket по idle
      pingInterval: 25000,
    };

    console.log('🔌 Creating Peer:', options);
    const peer = new Peer(undefined, options);

    const onOpen = (id) => {
      console.log('✅ Peer open, ID:', id);
      callPeer = peer;
      resolve(peer);
    };

    const onError = (err) => {
      console.error('❌ Peer error:', err.type, err.message);
      // Критические ошибки приводят к reject
      if (['invalid-id', 'invalid-key', 'ssl-unavailable', 'server-error'].includes(err.type)) {
        peer.destroy();
        reject(err);
      }
    };

    const onDisconnected = () => {
      console.warn('⚠️ Peer disconnected from server');
      // PeerJS сам пытается переподключиться несколько раз
    };

    const onClose = () => {
      console.log('🔚 Peer closed');
      callPeer = null;
    };

    peer.on('open', onOpen);
    peer.on('error', onError);
    peer.on('disconnected', onDisconnected);
    peer.on('close', onClose);
    peer.on('call', handleIncomingCall);

    // Если за 10 секунд не подключились — не reject, но предупредим
    setTimeout(() => {
      if (!peer.open) {
        console.warn('⏱️ Peer not open after 10s, check server/WSS');
      }
    }, 10000);
  });
}

async function initCallSystem() {
  loadCallSettings();

  for (const [name, url] of Object.entries(CALL_CONFIG.sounds)) {
    loadSound(name, url).catch(e => console.warn(`⚠️ Звук ${name} не загружен:`, e.message));
  }

  try {
    await createPeer();
    console.log('🎙️ Call system ready');
  } catch (e) {
    console.error('❌ Failed to init call system:', e);
    alert('Сервер звонков недоступен. Попробуй позже.');
    return;
  }

  injectCallButton();
}

// ─── INCOMING CALL ───────────────────────────────────────────────────────────
async function handleIncomingCall(call) {
  if (callCurrent) {
    console.log('📴 Already in call, rejecting');
    call.reject();
    playSound('busy', { volume: callSettings.ringVolume });
    return;
  }

  const ringSound = playSound('incoming', { loop: true, volume: callSettings.ringVolume });
  const overlay = showCallUI('incoming');
  callCurrentOverlay = overlay;

  const stopRing = () => {
    try { ringSound?.source?.stop(); } catch (e) {}
  };

  const answerBtn = overlay.querySelector('#call-answer');
  const declineBtn = overlay.querySelector('#call-decline');

  const onAnswer = async () => {
    stopRing();
    answerBtn?.removeEventListener('click', onAnswer);
    declineBtn?.removeEventListener('click', onDecline);
    await acceptCall(call, overlay);
  };

  const onDecline = () => {
    stopRing();
    answerBtn?.removeEventListener('click', onAnswer);
    declineBtn?.removeEventListener('click', onDecline);
    call.reject();
    hideCallUI();
    playSound('disconnected', { volume: 0.6 });
  };

  answerBtn?.addEventListener('click', onAnswer);
  declineBtn?.addEventListener('click', onDecline);

  const autoDecline = setTimeout(() => {
    stopRing();
    try { call.reject(); } catch (e) {}
    hideCallUI();
    playSound('busy', { volume: callSettings.ringVolume });
  }, 30000);

  call.on('close', () => clearTimeout(autoDecline));
}

// ─── OUTGOING CALL ───────────────────────────────────────────────────────────
async function startOutgoingCall() {
  if (!activeConvId) {
    alert('Сначала выбери собеседника');
    return;
  }
  if (!callPeer || !callPeer.open) {
    alert('Сервер звонков недоступен. Подожди или перезагрузи страницу.');
    return;
  }

  const otherId = activeConvId.split('_').find(uid => uid !== currentUser.uid);
  if (!otherId) {
    alert('Не удалось определить собеседника');
    return;
  }

  try {
    callLocalStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...CALL_CONFIG.audioConstraints,
        deviceId: callSettings.inputDeviceId ? { exact: callSettings.inputDeviceId } : undefined,
      },
    });

    if (callSettings.micMuted) {
      callLocalStream.getAudioTracks().forEach(t => t.enabled = false);
    }

    const overlay = showCallUI('outgoing', otherId);
    callCurrentOverlay = overlay;

    const ringSound = playSound('outgoing', { loop: true, volume: callSettings.ringVolume });
    window._callRingSound = ringSound;

    callCurrent = callPeer.call(otherId, callLocalStream, {
      metadata: { caller: currentUser.uid }
    });

    if (!callCurrent) {
      throw new Error('callPeer.call() returned null');
    }

    setupCallHandlers(callCurrent, overlay, otherId);

  } catch (e) {
    console.error('❌ Ошибка звонка:', e);
    hideCallUI();
    alert(e.name === 'NotAllowedError' ? 'Разреши доступ к микрофону' : 'Не удалось начать звонок. Попробуй позже.');
  }
}

async function acceptCall(call, overlay) {
  try {
    callLocalStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...CALL_CONFIG.audioConstraints,
        deviceId: callSettings.inputDeviceId ? { exact: callSettings.inputDeviceId } : undefined,
      },
    });

    if (callSettings.micMuted) {
      callLocalStream.getAudioTracks().forEach(t => t.enabled = false);
    }

    call.answer(callLocalStream);
    callCurrent = call;
    setupCallHandlers(call, overlay, call.peer);

  } catch (e) {
    console.error('❌ Ошибка при ответе:', e);
    call.reject();
    hideCallUI();
    alert('Не удалось ответить. Проверь микрофон.');
  }
}

// ─── CALL HANDLERS ───────────────────────────────────────────────────────────
function setupCallHandlers(call, overlay, otherId) {
  let callStartTime = null;

  call.on('stream', async remoteStream => {
    try { window._callRingSound?.source?.stop(); } catch (e) {}
    playSound('connected', { volume: 0.7 });

    callRemoteStream = remoteStream;
    setupRemoteAudio(remoteStream);

    const status = document.getElementById('call-status');
    if (status) status.textContent = 'Разговор';

    const timerEl = document.getElementById('call-timer');
    if (timerEl) {
      timerEl.style.display = 'block';
      callStartTime = Date.now();
      callCurrentTimerInterval = setInterval(() => {
        const sec = Math.floor((Date.now() - callStartTime) / 1000);
        const m = String(Math.floor(sec / 60)).padStart(2, '0');
        const s = String(sec % 60).padStart(2, '0');
        timerEl.textContent = `${m}:${s}`;
      }, 1000);
    }

    try {
      const u = await getUser(otherId);
      const ava = document.getElementById('call-avatar');
      const name = document.getElementById('call-name');
      if (ava) ava.innerHTML = avatarHtml(u.avatar, u.name, 56);
      if (name) name.textContent = u.name;
    } catch (e) {
      console.warn('Не удалось загрузить инфу о пользователе:', e);
    }
  });

  call.on('close', () => endCallCleanup());

  call.on('error', err => {
    console.error('❌ Call error:', err);
    showCallError(err.type || 'unknown');
    endCallCleanup();
  });

  setupCallControls(overlay, call);
}

function setupRemoteAudio(stream) {
  document.getElementById('call-remote-audio')?.remove();

  const audio = document.createElement('audio');
  audio.id = 'call-remote-audio';
  audio.srcObject = stream;
  audio.autoplay = true;
  audio.playsInline = true;
  audio.volume = callSettings.callVolume;
  document.body.appendChild(audio);

  if (callSettings.outputDeviceId && audio.setSinkId) {
    audio.setSinkId(callSettings.outputDeviceId).catch(e => {
      console.warn('⚠️ setSinkId не сработал:', e);
    });
  }
}

function setupCallControls(overlay, call) {
  const endBtn = document.getElementById('call-end');
  const muteBtn = document.getElementById('call-mute');
  const settingsBtn = document.getElementById('call-settings');

  endBtn?.addEventListener('click', () => call.close(), { once: true });

  muteBtn?.addEventListener('click', () => {
    callSettings.micMuted = !callSettings.micMuted;
    callLocalStream?.getAudioTracks().forEach(t => { t.enabled = !callSettings.micMuted; });
    muteBtn.classList.toggle('muted', callSettings.micMuted);
    muteBtn.innerHTML = callSettings.micMuted ? '<span>🔇</span>' : '<span>🎤</span>';
    playSound('muteToggle', { volume: 0.4 });
    saveCallSettings();
  });

  settingsBtn?.addEventListener('click', async () => {
    const modal = document.getElementById('call-settings-modal');
    modal?.classList.add('open');
    await populateAudioDevices();
  });
}

async function populateAudioDevices() {
  const { inputs, outputs } = await enumerateAudioDevices();
  const inputSel = document.getElementById('settings-input-device');
  const outputSel = document.getElementById('settings-output-device');
  if (!inputSel || !outputSel) return;

  inputSel.innerHTML = '<option value="">По умолчанию</option>';
  inputs.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `Микрофон #${inputSel.children.length}`;
    if (d.deviceId === callSettings.inputDeviceId) opt.selected = true;
    inputSel.appendChild(opt);
  });

  outputSel.innerHTML = '<option value="">По умолчанию</option>';
  outputs.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `Динамик #${outputSel.children.length}`;
    if (d.deviceId === callSettings.outputDeviceId) opt.selected = true;
    outputSel.appendChild(opt);
  });

  const ringVol = document.getElementById('settings-ring-volume');
  const callVol = document.getElementById('settings-call-volume');
  if (ringVol) ringVol.value = callSettings.ringVolume;
  if (callVol) callVol.value = callSettings.callVolume;
}

function endCallCleanup() {
  if (callCurrentTimerInterval) {
    clearInterval(callCurrentTimerInterval);
    callCurrentTimerInterval = null;
  }
  try { window._callRingSound?.source?.stop(); } catch (e) {}
  window._callRingSound = null;

  callLocalStream?.getTracks().forEach(t => t.stop());
  callLocalStream = null;
  callRemoteStream = null;
  callCurrent = null;

  document.getElementById('call-remote-audio')?.remove();
  hideCallUI();
  playSound('disconnected', { volume: 0.6 });
}

// ─── UI HELPERS ──────────────────────────────────────────────────────────────
function showCallUI(type, otherId = null) {
  let overlay = document.querySelector('.call-overlay');
  if (!overlay) {
    overlay = createCallOverlay();
    document.body.appendChild(overlay);
  }

  overlay.querySelector('#call-answer')?.remove();
  overlay.querySelector('#call-decline')?.remove();

  if (type === 'incoming') {
    const header = overlay.querySelector('.call-header');
    const answerBtn = document.createElement('button');
    answerBtn.id = 'call-answer';
    answerBtn.className = 'call-answer-btn';
    answerBtn.textContent = '✅ Принять';
    answerBtn.style.cssText = 'background:#22c55e;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;margin-left:8px;font-weight:600;';

    const declineBtn = document.createElement('button');
    declineBtn.id = 'call-decline';
    declineBtn.className = 'call-decline-btn';
    declineBtn.textContent = '✕ Отклонить';
    declineBtn.style.cssText = 'background:#ef4444;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;margin-left:4px;font-weight:600;';

    header.appendChild(answerBtn);
    header.appendChild(declineBtn);
  }

  overlay.classList.add('active');

  if (otherId) {
    getUser(otherId).then(u => {
      const ava = document.getElementById('call-avatar');
      const name = document.getElementById('call-name');
      if (ava) ava.innerHTML = avatarHtml(u.avatar, u.name, 56);
      if (name) name.textContent = u.name;
    }).catch(() => {});
  }

  return overlay;
}

function hideCallUI() {
  const overlay = document.querySelector('.call-overlay');
  if (overlay) {
    overlay.classList.remove('active');
    overlay.querySelector('#call-answer')?.remove();
    overlay.querySelector('#call-decline')?.remove();
    const status = document.getElementById('call-status');
    if (status) {
      status.textContent = 'Звонок завершён';
      status.classList.remove('error');
    }
    const timer = document.getElementById('call-timer');
    if (timer) { timer.style.display = 'none'; timer.textContent = '00:00'; }
  }
  callCurrentOverlay = null;
}

function showCallError(type) {
  const status = document.getElementById('call-status');
  if (!status) return;
  const errors = {
    'unavailable': 'Собеседник оффлайн',
    'invalid-id': 'Неверный ID',
    'browser-incompatible': 'Браузер не поддерживает звонки',
    'network': 'Ошибка сети',
    'peer-unavailable': 'Собеседник не в сети',
    'disconnected': 'Соединение разорвано',
    'server-error': 'Ошибка сервера',
  };
  status.textContent = errors[type] || 'Ошибка соединения';
  status.classList.add('error');
}

function injectCallButton() {
  const observer = new MutationObserver(() => {
    const header = document.querySelector('.chat-header');
    if (header && !header.querySelector('.chat-call-btn')) {
      const btn = document.createElement('button');
      btn.className = 'chat-call-btn';
      btn.title = 'Голосовой звонок';
      btn.innerHTML = '🎙️';
      btn.addEventListener('click', startOutgoingCall);
      header.appendChild(btn);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// ─── INIT ────────────────────────────────────────────────────────────────────
waitForFirebase(() => {
  window.auth.onAuthStateChanged(user => {
    if (user && !callPeer) {
      initCallSystem();
    }
  });
});