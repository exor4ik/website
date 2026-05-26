/**
 * 🏆 Achievement System v1.1 — EgorNetwork
 * Автономный модуль. Подключение: <script src="achievements.js" defer></script>
 *
 * Гарантированная доставка в Firestore через pending-queue + retry.
 */
(function() {
  'use strict';

  var ACHIEVEMENTS = {
    first_command:    { title: 'Hello, World!',               desc: 'Первая команда',                    icon: '👋' },
    hal_encounter:    { title: "I'm Afraid, Dave",            desc: 'HAL активирован',                   icon: '🔴' },
    matrix:           { title: 'Red Pill',                    desc: 'Матрица',                           icon: '💊' },
    sudo_fail:        { title: 'Permission Denied',           desc: 'Попытка sudo',                      icon: '🔒' },
    calculator:       { title: 'Human Calculator',            desc: 'Калькулятор',                       icon: '🧮' },
    quote_master:     { title: 'Wise Words',                  desc: '5 разных цитат',                    icon: '📚' },
    time_lord:        { title: 'Time Lord',                   desc: 'лето --срочно',                     icon: '⏰' },
    profile_complete: { title: 'Identity',                    desc: 'Bio заполнено',                     icon: '📝' },
    avatar_set:       { title: 'Face Reveal',                 desc: 'Аватар установлен',                 icon: '🖼️' },
    social_linked:    { title: 'Network Node',                desc: 'Соцсеть добавлена',                 icon: '🔗' },
    hal_survivor:     { title: 'Survivor',                    desc: '30с против HAL',                    icon: '🛡️' },
    hal_legend:       { title: 'Legendary',                   desc: '60с против HAL',                    icon: '👑' },
    whoami:           { title: 'WhoAmI',                      desc: 'Кто я?',                            icon: '❓' },
    login_yourself:   { title: 'EgorNetwork.Login("you");',   desc: 'Авторизоваться снова',              icon: '🔄' },
    truckers:         { title: 'Где мой DVD диск?',           desc: 'Попробуйте запустить игру',         icon: '🚚' },
    wargames:         { title: 'Термоядерная война?',         desc: 'Хочешь ли ты поиграть в эту игру?', icon: '💣' },
    help_all:         { title: "I can't help to all people",  desc: 'Мне не хватит сил помочь всем.',    icon: '🆘' },
    nothing_free:     { title: 'Nothing is Free',             desc: 'Ничто не является бесплатным',      icon: '💸' },
    varoom:           { title: 'Varoom!',                     desc: 'Пройти 6000м в Varoom',             icon: '🏎️' },
  };

  var STORAGE_KEY  = 'egornet_achievements';
  var PENDING_KEY  = 'egornet_achievements_pending';
  var SOUND_PATH   = '/sound/achievement_unlocked.wav';
  var SOUND_VOLUME = 0.22;
  var DEBUG        = false;

  var _localCache   = null;
  var _popupEl      = null;
  var _popupTimer   = null;
  var _sound        = null;
  var _pendingQueue = []; // ачивки, которые не удалось сохранить в Firestore
  var _syncRetryTimer = null;

  function log() {
    if (DEBUG) console.log.apply(console, ['[Achievements]'].concat(Array.prototype.slice.call(arguments)));
  }
  function warn() { console.warn.apply(console, ['[Achievements]'].concat(Array.prototype.slice.call(arguments))); }

  // ─── CSS ────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('egornet-ach-styles')) return;
    var s = document.createElement('style');
    s.id = 'egornet-ach-styles';
    s.textContent = `
      .egornet-achievement-popup {
        position:fixed; top:32px; right:32px;
        background:rgba(10,16,30,.98);
        border:1px solid rgba(139,123,255,.4);
        border-radius:12px; padding:16px 20px;
        font-family:'JetBrains Mono',ui-monospace,monospace;
        box-shadow:0 20px 50px rgba(0,0,0,.7), 0 0 30px rgba(139,123,255,.2);
        transform:translateX(400px);
        transition:transform .5s cubic-bezier(0.68, -0.55, 0.265, 1.55);
        z-index:10000; max-width:320px; pointer-events:none;
      }
      .egornet-achievement-popup.show { transform:translateX(0); }
      .egornet-achievement-icon { font-size:1.5rem; margin-bottom:8px; }
      .egornet-achievement-title { color:rgba(139,123,255,.95); font-size:.85rem; font-weight:600; margin-bottom:4px; }
      .egornet-achievement-desc { color:rgba(168,179,204,.7); font-size:.72rem; line-height:1.4; }
      .egornet-achievement-label { font-size:.6rem; color:rgba(109,213,255,.6); text-transform:uppercase; letter-spacing:.12em; margin-bottom:6px; }
      @media(max-width:540px){ .egornet-achievement-popup { right:16px; left:16px; max-width:none; } }
    `;
    document.head.appendChild(s);
  }

  function ensurePopup() {
    if (_popupEl) return _popupEl;
    injectStyles();
    _popupEl = document.createElement('div');
    _popupEl.className = 'egornet-achievement-popup';
    _popupEl.innerHTML = `
      <div class="egornet-achievement-label">Achievement Unlocked</div>
      <div class="egornet-achievement-icon"></div>
      <div class="egornet-achievement-title"></div>
      <div class="egornet-achievement-desc"></div>`;
    document.body.appendChild(_popupEl);
    return _popupEl;
  }

  // ─── ЗВУК ───────────────────────────────────────────────────────────────
  function playUnlockSound() {
    try {
      if (!_sound) {
        _sound = new Audio(SOUND_PATH);
        _sound.volume = SOUND_VOLUME;
      }
      _sound.currentTime = 0;
      var p = _sound.play();
      if (p && typeof p.catch === 'function') {
        p.catch(function(e) { /* ignore autoplay block */ });
      }
    } catch(e) {}
  }

  // ─── LOCAL STORAGE ─────────────────────────────────────────────────────
  function getLocal() {
    if (_localCache) return _localCache;
    try { _localCache = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch(e) { _localCache = []; }
    return _localCache;
  }
  function setLocal(arr) {
    _localCache = arr;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); }
    catch(e) { warn('localStorage write failed:', e); }
  }

  function loadPendingQueue() {
    try { _pendingQueue = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); }
    catch(e) { _pendingQueue = []; }
  }
  function savePendingQueue() {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(_pendingQueue)); }
    catch(e) {}
  }

  // ─── FIRESTORE ─────────────────────────────────────────────────────────
  function isFirebaseReady() {
    return !!(window.auth && window.auth.currentUser && window.db);
  }
  function getUid() {
    return window.auth && window.auth.currentUser ? window.auth.currentUser.uid : null;
  }

  /**
   * Пытается сохранить массив ачивок в Firestore.
   * Использует set(..., {merge: true}) — работает и для новых, и для существующих документов.
   * Возвращает true при успехе, false при ошибке.
   */
  async function writeToFirestore(arr) {
    if (!isFirebaseReady()) {
      log('Firestore not ready (auth/db/currentUser missing)');
      return false;
    }
    try {
      var uid = getUid();
      var ref = window.db.collection('users').doc(uid);
      // set с merge:true не падает, если документ не существует
      await ref.set({ achievements: arr }, { merge: true });
      log('✅ Saved to Firestore for', uid, '- total:', arr.length);
      return true;
    } catch(e) {
      warn('Firestore write error:', e && e.message ? e.message : e);
      return false;
    }
  }

  /**
   * Читает ачивки из Firestore. Возвращает null, если не готов.
   */
  async function fetchFromFirestore() {
    if (!isFirebaseReady()) return null;
    try {
      var doc = await window.db.collection('users').doc(getUid()).get();
      if (doc.exists) {
        return doc.data().achievements || [];
      }
      return [];
    } catch(e) {
      warn('Firestore fetch failed:', e && e.message ? e.message : e);
      return null;
    }
  }

  // ─── PENDING QUEUE (retry mechanism) ───────────────────────────────────
  async function flushPendingQueue() {
    if (_pendingQueue.length === 0) return;
    if (!isFirebaseReady()) return;

    log('Flushing pending queue:', _pendingQueue.length, 'items');

    // Получаем текущие серверные ачивки
    var remote = await fetchFromFirestore();
    if (remote === null) return; // Firestore не готов, попробуем позже

    // Объединяем: remote + pending (без дубликатов)
    var merged = Array.from(new Set(remote.concat(_pendingQueue)));

    var ok = await writeToFirestore(merged);
    if (ok) {
      _pendingQueue = [];
      savePendingQueue();
      setLocal(merged);
      log('Pending queue flushed successfully');
    } else {
      // Не очищаем очередь, попробуем позже
      scheduleRetry();
    }
  }

  function scheduleRetry() {
    if (_syncRetryTimer) return;
    _syncRetryTimer = setTimeout(function() {
      _syncRetryTimer = null;
      flushPendingQueue();
    }, 5000); // retry через 5 сек
  }

  function enqueuePending(arr) {
    _pendingQueue = Array.from(new Set(_pendingQueue.concat(arr)));
    savePendingQueue();
    scheduleRetry();
  }

  // ─── CORE ──────────────────────────────────────────────────────────────
  async function getUnlocked() {
    var fs = await fetchFromFirestore();
    if (fs !== null) {
      setLocal(fs);
      return fs;
    }
    return getLocal();
  }

  async function has(key) {
    var list = await getUnlocked();
    return list.indexOf(key) !== -1;
  }

  function showPopup(ach) {
    var el = ensurePopup();
    el.querySelector('.egornet-achievement-icon').textContent = ach.icon;
    el.querySelector('.egornet-achievement-title').textContent = ach.title;
    el.querySelector('.egornet-achievement-desc').textContent = ach.desc;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(_popupTimer);
    _popupTimer = setTimeout(function() { el.classList.remove('show'); }, 4000);
  }

  async function unlock(key) {
    var ach = ACHIEVEMENTS[key];
    if (!ach) { warn('Unknown key:', key); return false; }

    var list = await getUnlocked();
    if (list.indexOf(key) !== -1) {
      log('Already unlocked:', key);
      return false;
    }

    list.push(key);
    setLocal(list);
    showPopup(ach);
    playUnlockSound();
    log('Unlocked locally:', key);

    // Попытка сохранить в Firestore
    if (isFirebaseReady()) {
      var ok = await writeToFirestore(list);
      if (!ok) {
        // Сохранение не удалось — кладём в pending queue
        enqueuePending([key]);
      }
    } else {
      // Firebase ещё не готов — в pending queue
      log('Firebase not ready, queued:', key);
      enqueuePending([key]);
    }

    try {
      window.dispatchEvent(new CustomEvent('achievement-unlocked', {
        detail: { key: key, achievement: ach, all: list }
      }));
    } catch(e) {}

    return true;
  }

  function register(key, data) {
    if (ACHIEVEMENTS[key]) return;
    ACHIEVEMENTS[key] = {
      title: data.title || key,
      desc: data.desc || '',
      icon: data.icon || '🏅'
    };
  }

  function getAll() { return Object.assign({}, ACHIEVEMENTS); }

  // ─── PUBLIC API ────────────────────────────────────────────────────────
  window.Achievements = {
    unlock: unlock,
    getAll: getAll,
    getUnlocked: getUnlocked,
    has: has,
    register: register,
    showPopup: showPopup,
  };
  window.unlockAchievement = unlock;

  // ─── INIT: auth listener + periodic retry ─────────────────────────────
  function setupAuthListener() {
    var check = setInterval(function() {
      if (window.auth && typeof window.auth.onAuthStateChanged === 'function') {
        clearInterval(check);
        log('Auth listener attached');

        window.auth.onAuthStateChanged(function(user) {
          if (user) {
            log('User signed in:', user.uid);
            // При входе: сливаем локальные ачивки + pending с серверными
            setTimeout(async function() {
              try {
                var remote = await fetchFromFirestore();
                if (remote === null) return;

                var local   = getLocal();
                var pending = _pendingQueue;
                var merged  = Array.from(new Set(remote.concat(local).concat(pending)));

                if (merged.length > remote.length) {
                  var ok = await writeToFirestore(merged);
                  if (ok) {
                    _pendingQueue = [];
                    savePendingQueue();
                    log('Synced', merged.length - remote.length, 'local+pending → Firestore');
                  } else {
                    enqueuePending(merged.filter(k => remote.indexOf(k) === -1));
                  }
                }
                setLocal(merged);
              } catch(e) { warn('Sync failed:', e); }
            }, 800);
          } else {
            log('User signed out');
          }
        });
      }
    }, 200);

    // Периодическая проверка на случай, если auth "проснулся" позже
    setInterval(function() {
      if (_pendingQueue.length > 0 && isFirebaseReady()) {
        flushPendingQueue();
      }
    }, 10000);
  }

  // ─── BOOT ──────────────────────────────────────────────────────────────
  loadPendingQueue();
  log('Loaded', Object.keys(ACHIEVEMENTS).length, 'definitions,', _pendingQueue.length, 'pending');

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupAuthListener);
  } else {
    setupAuthListener();
  }
})();