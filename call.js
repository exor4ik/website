/**
 * 🔊 Voice Calls for EgorNetwork DMs
 * WebRTC + PeerJS + Web Audio API (FIXED)
 */
'use strict';

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CALL_CONFIG = {
  customServer: {
    host: 'egor-peerjs.onrender.com',
    port: 443,
    path: '/peer/',
    secure: true,
    key: 'peerjs',
  },
  publicServers: [
    { host: '0.peerjs.com', port: 443, path: '/', secure: true },
  ],
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
let callReconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;

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

// ─── PEER INIT WITH FALLBACK ─────────────────────────────────────────────────
function tryConnectPeer(serverList, index = 0) {
  return new Promise((resolve, reject) => {
    if (index >= serverList.length) {
      reject(new Error('Все серверы недоступны'));
      return;
    }

    const server = serverList[index];
    console.log(`🔌 Попытка подключения к ${server.host}...`);

    const peer = new Peer(null, {
      host: server.host,
      port: server.port,
      path: server.path,
      secure: server.secure,
      debug: 1,
    });

    const timeout = setTimeout(() => {
      try { peer.destroy(); } catch (e) {}
      reject(new Error(`Timeout на ${server.host}`));
    }, 8000);

    peer.on('open', id => {
      clearTimeout(timeout);
      console.log(`✅ Подключено к ${server.host}, ID: ${id}`);
      resolve({ peer, server });
    });

    peer.on('error', err => {
      clearTimeout(timeout);
      try { peer.destroy(); } catch (e) {}
      reject(new Error(`${server.host}: ${err.type}`));
    });
  });
}

async function initCallSystem() {
  loadCallSettings();

  // Загрузка звуков
  for (const [name, url] of Object.entries(CALL_CONFIG.sounds)) {
    loadSound(name, url).catch(e => console.warn(`⚠️ Звук ${name} не загружен:`, e.message));
  }

  // Пробуем свой сервер, потом публичные
  const servers = [CALL_CONFIG.customServer, ...CALL_CONFIG.publicServers];

  try {
    const { peer, server } = await tryConnectPeer(servers);
    callPeer = peer;
    callReconnectAttempts = 0;

    callPeer.on('call', handleIncomingCall);
    callPeer.on('disconnected', () => {
      console.warn('⚠️ Peer отключён, переподключение...');
      setTimeout(reconnectPeer, 2000);
    });
    callPeer.on('close', () => {
      console.log('🔚 Peer закрыт');
      callPeer = null;
    });

  } catch (e) {
    console.error('❌ Не удалось подключиться ни к одному серверу:', e);
    alert('Не удалось подключиться к серверу звонков. Попробуй позже или проверь интернет.');
  }

  injectCallButton();
}

async function reconnectPeer() {
  if (!callPeer) {
    console.log('🔄 Переподключение PeerJS...');
    callReconnectAttempts++;
    if (callReconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.error('❌ Слишком много попыток, остановка');
      return;
    }
    await initCallSystem();
  }
}

// ─── INCOMING CALL ───────────────────────────────────────────────────────────
async function handleIncomingCall(call) {
  if (callCurrent) {
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

  overlay.querySelector('#call-answer')?.addEventListener('click', async () => {
    stopRing();
    await acceptCall(call, overlay);
  }, { once: true });

  overlay.querySelector('#call-decline')?.addEventListener('click', () => {
    stopRing();
    call.reject();
    hideCallUI();
    playSound('disconnected', { volume: 0.6 });
  }, { once: true });

  // Авто-отклонение через 30 сек
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
  if (!callPeer || callPeer.disconnected) {
    alert('Сервер звонков недоступен. Подожди или перезагрузи страницу.');
    return;
  }

  const otherId = activeConvId.split('_').find(uid => uid !== currentUser.uid);
  if (!otherId) return;

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

    // ❗ КРИТИЧЕСКАЯ ПРОВЕРКА: вызываем call только если peer жив
    try {
      callCurrent = callPeer.call(otherId, callLocalStream);
    } catch (e) {
      console.error('❌ PeerJS call() выбросил исключение:', e);
      ringSound?.source?.stop();
      hideCallUI();
      alert('Не удалось начать звонок. Попробуй позже.');
      return;
    }

    // ❗ Если call вернул undefined/невалидный объект
    if (!callCurrent || typeof callCurrent.on !== 'function') {
      console.error('❌ callPeer.call() вернул невалидный объект:', callCurrent);
      ringSound?.source?.stop();
      hideCallUI();
      alert('Ошибка инициализации звонка. Перезагрузи страницу.');
      return;
    }

    setupCallHandlers(callCurrent, overlay, otherId);

  } catch (e) {
    console.error('❌ Микрофон недоступен:', e);
    hideCallUI();
    alert('Разреши доступ к микрофону для звонков');
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

    document.getElementById('call-status').textContent = 'Разговор';
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

    getUser(otherId).then(u => {
      const ava = document.getElementById('call-avatar');
      const name = document.getElementById('call-name');
      if (ava) ava.innerHTML = avatarHtml(u.avatar, u.name, 56);
      if (name) name.textContent = u.name;
    });
  });

  call.on('close', () => endCallCleanup());
  call.on('error', err => {
    console.error('❌ Call stream error:', err);
    showCallError(err.type);
    endCallCleanup();
  });

  setupCallControls(overlay, call);
}

function setupRemoteAudio(stream) {
  const audio = document.createElement('audio');
  audio.id = 'call-remote-audio';
  audio.srcObject = stream;
  audio.autoplay = true;
  audio.playsInline = true;
  audio.volume = callSettings.callVolume;
  document.body.appendChild(audio);

  // Пытаемся применить выбранный output device
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

  document.getElementById('settings-ring-volume').value = callSettings.ringVolume;
  document.getElementById('settings-call-volume').value = callSettings.callVolume;
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

  // Очистка старых динамических кнопок
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
    });
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
    if (status) status.classList.remove('error');
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