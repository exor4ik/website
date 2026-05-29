/**
 * 🔊 Voice Calls for EgorNetwork DMs
 * WebRTC + PeerJS + Web Audio API
 */
'use strict';

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CALL_CONFIG = {
  peerOptions: { debug: 1 }, // PeerJS options
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
let callSettings = {
  inputDeviceId: null,
  outputDeviceId: null,
  ringVolume: 0.7,
  callVolume: 1.0,
  micMuted: false,
};

// ─── AUDIO SYSTEM (Web Audio API) ────────────────────────────────────────────
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
  const arr = await resp.arrayBuffer();
  const buffer = await ctx.decodeAudioData(arr);
  callSoundBuffers[name] = buffer;
  return buffer;
}

function playSound(name, { loop = false, volume = 1.0, deviceId = null } = {}) {
  if (!callAudioContext || callAudioContext.state === 'suspended') {
    initAudioContext();
  }
  const buffer = callSoundBuffers[name];
  if (!buffer) return null;

  const source = callAudioContext.createBufferSource();
  source.buffer = buffer;
  source.loop = loop;

  const gain = callAudioContext.createGain();
  gain.gain.value = volume;

  source.connect(gain);

  if (deviceId && callAudioContext.destination?.setSinkId) {
    callAudioContext.destination.setSinkId(deviceId).catch(() => {});
  }
  gain.connect(callAudioContext.destination);

  source.start();
  return { source, gain };
}

// ─── SETTINGS MANAGEMENT ─────────────────────────────────────────────────────
function loadCallSettings() {
  try {
    const saved = localStorage.getItem(CALL_CONFIG.settingsKey);
    if (saved) {
      const parsed = JSON.parse(saved);
      callSettings = { ...callSettings, ...parsed };
    }
  } catch (e) {
    console.warn('⚠️ Не удалось загрузить настройки звонков', e);
  }
}

function saveCallSettings() {
  try {
    localStorage.setItem(CALL_CONFIG.settingsKey, JSON.stringify(callSettings));
    playSound('settingsSave', { volume: 0.5 });
  } catch (e) {
    console.warn('⚠️ Не удалось сохранить настройки звонков', e);
  }
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
    console.warn('⚠️ Нет доступа к устройствам ввода/вывода', e);
    return { inputs: [], outputs: [] };
  }
}

// ─── CALL UI COMPONENTS ──────────────────────────────────────────────────────
function createCallButton() {
  const btn = document.createElement('button');
  btn.className = 'chat-call-btn';
  btn.title = 'Голосовой звонок';
  btn.innerHTML = '🎙️';
  btn.addEventListener('click', () => startOutgoingCall());
  return btn;
}

function createCallOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'call-overlay';
  overlay.innerHTML = `
    <div class="call-panel">
      <div class="call-header">
        <div class="call-avatar" id="call-avatar"></div>
        <div>
          <div class="call-name" id="call-name">Собеседник</div>
          <div class="call-status" id="call-status">Подключение...</div>
        </div>
        <button class="call-close-btn" id="call-close">✕</button>
      </div>
      
      <div class="call-controls">
        <button class="call-control-btn" id="call-mute" title="Выключить микрофон">
          <span class="icon-mute">🎤</span>
        </button>
        <button class="call-control-btn" id="call-settings" title="Настройки">
          <span class="icon-settings">⚙️</span>
        </button>
        <button class="call-control-btn call-end" id="call-end" title="Завершить">
          <span class="icon-end">📞</span>
        </button>
      </div>
      
      <div class="call-timer" id="call-timer">00:00</div>
    </div>
    
    <!-- Settings Modal -->
    <div class="call-settings-modal" id="call-settings-modal">
      <div class="settings-content">
        <h4>🔊 Настройки аудио</h4>
        
        <label>Микрофон:
          <select id="settings-input-device"></select>
        </label>
        
        <label>Динамики:
          <select id="settings-output-device"></select>
        </label>
          
        <label>Громкость звонка:
          <input type="range" id="settings-ring-volume" min="0" max="1" step="0.1">
        </label>
        
        <label>Громкость собеседника:
          <input type="range" id="settings-call-volume" min="0" max="1" step="0.1">
        </label>
        
        <div class="settings-actions">
          <button id="settings-save">Сохранить</button>
          <button id="settings-close">Отмена</button>
        </div>
      </div>
    </div>
  `;
  return overlay;
}

// ─── CORE CALL LOGIC ─────────────────────────────────────────────────────────
async function initCallSystem() {
  loadCallSettings();
  
  // Инициализация PeerJS
  callPeer = new Peer(null, CALL_CONFIG.peerOptions);
  
  // Загрузка звуков
  for (const [name, url] of Object.entries(CALL_CONFIG.sounds)) {
    loadSound(name, url).catch(e => console.warn(`⚠️ Не загружен звук ${name}:`, e));
  }
  
  // Обработчики PeerJS
  callPeer.on('open', id => {
    console.log('🎙️ Call ID:', id);
    // Можно сохранить в профиль, если нужно
  });
  
  callPeer.on('call', async call => {
    // Входящий звонок
    if (callCurrent) {
      call.reject();
      playSound('busy', { volume: callSettings.ringVolume });
      return;
    }
    
    playSound('incoming', { 
      loop: true, 
      volume: callSettings.ringVolume,
      deviceId: callSettings.outputDeviceId 
    });
    
    const overlay = showCallUI('incoming');
    const answerBtn = overlay.querySelector('#call-answer');
    const declineBtn = overlay.querySelector('#call-decline');
    
    const stopRing = () => {
      if (window._callRingSound) {
        window._callRingSound.source?.stop();
        window._callRingSound = null;
      }
    };
    
    answerBtn?.addEventListener('click', async () => {
      stopRing();
      await acceptCall(call, overlay);
    });
    
    declineBtn?.addEventListener('click', () => {
      stopRing();
      call.reject();
      hideCallUI();
      playSound('disconnected', { volume: 0.6 });
    });
  });
  
  callPeer.on('error', err => {
    console.error('❌ Call error:', err);
    showCallError(err.type);
  });
  
  // Кнопка звонка в чате
  injectCallButton();
}

async function startOutgoingCall() {
  if (!activeConvId) {
    alert('Сначала выбери собеседника');
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
    window._callRingSound = playSound('outgoing', { 
      loop: true, 
      volume: callSettings.ringVolume,
      deviceId: callSettings.outputDeviceId 
    });
    
    callCurrent = callPeer.call(otherId, callLocalStream);
    setupCallHandlers(callCurrent, overlay, otherId);
    
  } catch (e) {
    console.error('❌ Нет доступа к микрофону:', e);
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
    const otherId = call.peer;
    setupCallHandlers(call, overlay, otherId);
    
  } catch (e) {
    console.error('❌ Ошибка при ответе на звонок:', e);
    call.reject();
  }
}

function setupCallHandlers(call, overlay, otherId) {
  let callStartTime = null;
  let timerInterval = null;
  
  call.on('stream', async remoteStream => {
    // Звонок соединён
    if (window._callRingSound) {
      window._callRingSound.source?.stop();
      window._callRingSound = null;
    }
    
    playSound('connected', { volume: 0.7 });
    
    callRemoteStream = remoteStream;
    setupRemoteAudio(remoteStream);
    
    // Обновляем UI
    document.getElementById('call-status').textContent = 'Разговор';
    document.getElementById('call-timer').style.display = 'block';
    
    callStartTime = Date.now();
    timerInterval = setInterval(() => {
      const sec = Math.floor((Date.now() - callStartTime) / 1000);
      const m = String(Math.floor(sec / 60)).padStart(2, '0');
      const s = String(sec % 60).padStart(2, '0');
      document.getElementById('call-timer').textContent = `${m}:${s}`;
    }, 1000);
    
    // Обновляем аватар
    getUser(otherId).then(u => {
      document.getElementById('call-avatar').innerHTML = avatarHtml(u.avatar, u.name, 56);
      document.getElementById('call-name').textContent = u.name;
    });
  });
  
  call.on('close', () => {
    endCallCleanup(timerInterval, overlay);
  });
  
  call.on('error', err => {
    console.error('❌ Call stream error:', err);
    showCallError(err.type);
    endCallCleanup(timerInterval, overlay);
  });
  
  // Обработчики кнопок в overlay
  setupCallControls(overlay, call);
}

function setupRemoteAudio(stream) {
  const audio = document.createElement('audio');
  audio.id = 'call-remote-audio';
  audio.srcObject = stream;
  audio.autoplay = true;
  audio.playsInline = true;
  
  // Применяем настройки громкости
  if (callAudioContext) {
    const source = callAudioContext.createMediaStreamSource(stream);
    const gain = callAudioContext.createGain();
    gain.gain.value = callSettings.callVolume;
    source.connect(gain);
    
    if (callSettings.outputDeviceId && gain.context.destination?.setSinkId) {
      gain.context.destination.setSinkId(callSettings.outputDeviceId).catch(() => {});
    }
    gain.connect(callAudioContext.destination);
  }
  
  document.body.appendChild(audio);
}

function setupCallControls(overlay, call) {
  // Завершить звонок
  document.getElementById('call-end')?.addEventListener('click', () => {
    call.close();
  });
  
  document.getElementById('call-close')?.addEventListener('click', () => {
    call.close();
  });
  
  // Мут микрофона
  document.getElementById('call-mute')?.addEventListener('click', () => {
    callSettings.micMuted = !callSettings.micMuted;
    callLocalStream?.getAudioTracks().forEach(t => {
      t.enabled = !callSettings.micMuted;
    });
    
    const btn = document.getElementById('call-mute');
    btn.classList.toggle('muted', callSettings.micMuted);
    btn.title = callSettings.micMuted ? 'Включить микрофон' : 'Выключить микрофон';
    
    playSound('muteToggle', { volume: 0.4 });
    saveCallSettings();
  });
  
  // Настройки
  document.getElementById('call-settings')?.addEventListener('click', async () => {
    const modal = document.getElementById('call-settings-modal');
    modal.classList.add('open');
    await populateAudioDevices();
  });
  
  // Сохранение настроек
  document.getElementById('settings-save')?.addEventListener('click', () => {
    callSettings.inputDeviceId = document.getElementById('settings-input-device').value || null;
    callSettings.outputDeviceId = document.getElementById('settings-output-device').value || null;
    callSettings.ringVolume = parseFloat(document.getElementById('settings-ring-volume').value);
    callSettings.callVolume = parseFloat(document.getElementById('settings-call-volume').value);
    
    saveCallSettings();
    document.getElementById('call-settings-modal').classList.remove('open');
    
    // Применяем громкость «на лету»
    const remoteAudio = document.getElementById('call-remote-audio');
    if (remoteAudio) remoteAudio.volume = callSettings.callVolume;
  });
  
  document.getElementById('settings-close')?.addEventListener('click', () => {
    document.getElementById('call-settings-modal').classList.remove('open');
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

function endCallCleanup(timerInterval, overlay) {
  if (timerInterval) clearInterval(timerInterval);
  if (window._callRingSound) {
    window._callRingSound.source?.stop();
    window._callRingSound = null;
  }
  
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
  
  // Кнопка ответа только для входящих
  if (type === 'incoming') {
    const header = overlay.querySelector('.call-header');
    const answerBtn = document.createElement('button');
    answerBtn.id = 'call-answer';
    answerBtn.className = 'call-answer-btn';
    answerBtn.textContent = '📞 Принять';
    header.appendChild(answerBtn);
    
    const declineBtn = document.createElement('button');
    declineBtn.id = 'call-decline';
    declineBtn.className = 'call-decline-btn';
    declineBtn.textContent = '✕ Отклонить';
    header.appendChild(declineBtn);
  }
  
  overlay.classList.add('active');
  
  if (otherId) {
    getUser(otherId).then(u => {
      document.getElementById('call-avatar').innerHTML = avatarHtml(u.avatar, u.name, 56);
      document.getElementById('call-name').textContent = u.name;
    });
  }
  
  return overlay;
}

function hideCallUI() {
  const overlay = document.querySelector('.call-overlay');
  if (overlay) {
    overlay.classList.remove('active');
    // Очищаем динамические кнопки
    overlay.querySelector('#call-answer')?.remove();
    overlay.querySelector('#call-decline')?.remove();
  }
}

function showCallError(type) {
  const status = document.getElementById('call-status');
  if (status) {
    const errors = {
      'unavailable': 'Собеседник оффлайн',
      'invalid-id': 'Неверный ID',
      'browser-incompatible': 'Браузер не поддерживает звонки',
    };
    status.textContent = errors[type] || 'Ошибка соединения';
    status.classList.add('error');
  }
}

function injectCallButton() {
  // Вставляем кнопку звонка в шапку чата
  const observer = new MutationObserver(() => {
    const header = document.querySelector('.chat-header');
    if (header && !header.querySelector('.chat-call-btn')) {
      const btn = createCallButton();
      header.appendChild(btn);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// ─── INIT ────────────────────────────────────────────────────────────────────
// Авто-инициализация после загрузки Firebase
waitForFirebase(() => {
  window.auth.onAuthStateChanged(user => {
    if (user && !callPeer) {
      initCallSystem();
    }
  });
});