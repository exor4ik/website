/**
 * 💬 Direct Messages — EgorNetwork
 */

'use strict';

// ─── UTILS ───────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function convId(uid1, uid2) {
  return [uid1, uid2].sort().join('_');
}

function formatMsgTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatMsgDate(ts) {
  if (!ts) return '';
  const d   = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Сегодня';
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function avatarHtml(avatar, name, size = 38) {
  const letter = (name || '?')[0].toUpperCase();
  if (avatar && avatar.startsWith('data:')) {
    return `<img src="${avatar}" alt="${esc(name)}" style="width:${size}px;height:${size}px;object-fit:cover;border-radius:${size*0.25}px;">`;
  }
  return esc(letter);
}

function waitForFirebase(cb, max = 25) {
  let n = 0;
  const t = setInterval(() => {
    n++;
    if (window.db && window.auth) { clearInterval(t); cb(); }
    else if (n >= max) { clearInterval(t); }
  }, 300);
}

// ─── STATE ────────────────────────────────────────────────────────────────────

let activeConvIsSecret = false;
let activeConvDocUnsub = null;
let currentUser    = null;
let activeConvId   = null;
let messagesUnsub  = null;
let convsUnsub     = null;
let userCache      = {};

// ═══════════════════════════════════════════════════════════
// 🔐 END-TO-END ENCRYPTION (Web Crypto API)
// ═══════════════════════════════════════════════════════════

const KEY_ALGO = { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' };
const AES_ALGO = { name: 'AES-GCM', length: 256 };

async function generateKeyPair() {
  return crypto.subtle.generateKey(KEY_ALGO, true, ['encrypt', 'decrypt']);
}

async function exportPublicKey(key) {
  const exported = await crypto.subtle.exportKey('spki', key);
  return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

async function importPublicKey(base64) {
  const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return crypto.subtle.importKey('spki', binary, KEY_ALGO, false, ['encrypt']);
}

async function importPrivateKey(base64) {
  const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', binary, KEY_ALGO, false, ['decrypt']);
}

async function getOrCreateKeys() {
  const stored = localStorage.getItem('e2ee_keys');
  if (stored) {
    const { publicKey, privateKey } = JSON.parse(stored);
    return {
      publicKey: await importPublicKey(publicKey),
      privateKey: await importPrivateKey(privateKey)
    };
  }
  
  const pair = await generateKeyPair();
  const pubB64 = await exportPublicKey(pair.publicKey);
  const privExported = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const privB64 = btoa(String.fromCharCode(...new Uint8Array(privExported)));
  
  localStorage.setItem('e2ee_keys', JSON.stringify({ publicKey: pubB64, privateKey: privB64 }));
  
  const me = window.auth.currentUser;
  if (me) {
    await window.db.collection('users').doc(me.uid).update({ 
      publicKey: pubB64,
      _hasE2EE: true 
    }).catch(() => {});
  }
  
  return pair;
}

async function getPublicKey(uid) {
  if (userCache[uid]?.publicKey) return userCache[uid].publicKey;
  
  const doc = await window.db.collection('users').doc(uid).get();
  if (!doc.exists || !doc.data().publicKey) return null;
  
  const key = await importPublicKey(doc.data().publicKey);
  if (userCache[uid]) userCache[uid].publicKey = key;
  return key;
}

async function encryptE2EE(text, recipientPublicKey) {
  const aesKey = await crypto.subtle.generateKey(AES_ALGO, true, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    enc.encode(text)
  );
  
  const aesRaw = await crypto.subtle.exportKey('raw', aesKey);
  const encryptedKey = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    recipientPublicKey,
    aesRaw
  );
  
  return [
    btoa(String.fromCharCode(...new Uint8Array(encryptedKey))),
    btoa(String.fromCharCode(...iv)),
    btoa(String.fromCharCode(...new Uint8Array(ciphertext)))
  ].join(':');
}

async function decryptE2EE(encrypted, privateKey) {
  try {
    const [keyB64, ivB64, cipherB64] = encrypted.split(':');
    if (!keyB64 || !ivB64 || !cipherB64) return encrypted;
    
    const encryptedKey = Uint8Array.from(atob(keyB64), c => c.charCodeAt(0));
    const aesRaw = await crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      privateKey,
      encryptedKey
    );
    
    const aesKey = await crypto.subtle.importKey('raw', aesRaw, AES_ALGO, false, ['decrypt']);
    const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
    const ciphertext = Uint8Array.from(atob(cipherB64), c => c.charCodeAt(0));
    
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      ciphertext
    );
    
    return new TextDecoder().decode(decrypted);
  } catch (e) {
    console.error('❌ E2EE decrypt failed:', e);
    return '[Ошибка расшифровки — возможно, ключи устарели]';
  }
}

// ═══════════════════════════════════════════════════════════
// 🔑 BACKUP / RESTORE KEYS
// ═══════════════════════════════════════════════════════════

async function exportKeysBackup(password) {
  const stored = localStorage.getItem('e2ee_keys');
  if (!stored) throw new Error('Ключи не найдены. Откройте сообщения для генерации.');
  
  const { privateKey } = JSON.parse(stored);
  
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password),
    'PBKDF2', false, ['deriveKey']
  );
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('EgorNetwork_backup_salt'), iterations: 200000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false, ['encrypt']
  );
  
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    enc.encode(privateKey)
  );
  
  const backup = {
    version: 1,
    publicKey: JSON.parse(stored).publicKey,
    iv: btoa(String.fromCharCode(...iv)),
    encryptedPrivateKey: btoa(String.fromCharCode(...new Uint8Array(encrypted)))
  };
  
  return btoa(JSON.stringify(backup));
}

async function importKeysBackup(backupBase64, password) {
  const backup = JSON.parse(atob(backupBase64));
  if (backup.version !== 1) throw new Error('Неподдерживаемая версия бэкапа');
  
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password),
    'PBKDF2', false, ['deriveKey']
  );
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('EgorNetwork_backup_salt'), iterations: 200000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false, ['decrypt']
  );
  
  const iv = Uint8Array.from(atob(backup.iv), c => c.charCodeAt(0));
  const encryptedPriv = Uint8Array.from(atob(backup.encryptedPrivateKey), c => c.charCodeAt(0));
  
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    encryptedPriv
  );
  
  const privateKey = new TextDecoder().decode(decrypted);
  const keys = { publicKey: backup.publicKey, privateKey };
  localStorage.setItem('e2ee_keys', JSON.stringify(keys));
  
  const me = window.auth.currentUser;
  if (me) {
    await window.db.collection('users').doc(me.uid).update({ 
      publicKey: backup.publicKey,
      _hasE2EE: true 
    }).catch(() => {});
  }
  
  return true;
}

// ─── USER CACHE ───────────────────────────────────────────────────────────────

async function getUser(uid) {
  if (userCache[uid]) return userCache[uid];
  try {
    const doc = await window.db.collection('users').doc(uid).get();
    const data = doc.exists ? doc.data() : { name: 'Неизвестный', avatar: null };
    userCache[uid] = { name: data.name || 'Неизвестный', avatar: data.avatar || null };
    return userCache[uid];
  } catch {
    return { name: 'Неизвестный', avatar: null };
  }
}

// ─── RENDER HELPERS ───────────────────────────────────────────────────────────

function renderConvItem(conv, convIdStr, myUid) {
  const otherId   = conv.participants.find(u => u !== myUid);
  const otherName = conv.participantNames?.[otherId] || 'Пользователь';
  const isSecret  = conv.isSecret || false;
  const lockIcon  = isSecret ? '<span class="conv-secret-icon">🔒</span>' : '';
  const otherAva  = conv.participantAvatars?.[otherId] || null;
  const unread    = conv.unread?.[myUid] || 0;
  const isEncrypted = conv._encrypted || conv._e2ee;
  const preview   = conv.lastMessage
      ? (isEncrypted ? '🔐 Зашифрованное сообщение' : 
         (conv.lastMessage.length > 35 ? conv.lastMessage.slice(0, 35) + '…' : conv.lastMessage))
      : 'Диалог начат';

  const li = document.createElement('div');
  li.className = 'conv-item';
  li.dataset.convId = convIdStr;
  if (convIdStr === activeConvId) li.classList.add('active');

  li.innerHTML = `
    <div class="conv-avatar">${avatarHtml(otherAva, otherName, 38)}</div>
    <div class="conv-info">
      <div class="conv-name">${lockIcon}${esc(otherName)}</div>
      <div class="conv-preview">${esc(preview)}</div>
    </div>
    ${unread > 0 ? `<div class="conv-unread">${unread}</div>` : ''}
  `;

  li.addEventListener('click', () => openConversation(convIdStr, otherId, otherName, otherAva));
  return li;
}

// ─── CONVERSATIONS LIST ───────────────────────────────────────────────────────

function initConvList(myUid) {
  convsUnsub?.();

  const list = document.getElementById('conv-list');
  if (!list) return;

  convsUnsub = window.db.collection('conversations')
    .where('participants', 'array-contains', myUid)
    .orderBy('lastMessageAt', 'desc')
    .onSnapshot(snap => {
      list.innerHTML = '';
      if (snap.empty) {
        list.innerHTML = '<div class="conv-empty">Нет диалогов.<br>Начни первый!</div>';
        return;
      }
      snap.forEach(doc => {
        list.appendChild(renderConvItem(doc.data(), doc.id, myUid));
      });
      updateMsgBadge(myUid);
    }, err => {
      console.error('❌ Conversations:', err);
    });
}

// ─── OPEN CONVERSATION ────────────────────────────────────────────────────────

async function openConversation(cId, otherId, otherName, otherAvatar) {
  activeConvId = cId;
  
  // ── E2EE: убеждаемся что свои ключи есть ──
  await getOrCreateKeys();
  
  // ── E2EE: проверяем что у собеседника есть ключ ──
  const otherPublicKey = await getPublicKey(otherId);
  if (!otherPublicKey) {
    console.warn('⚠️ Собеседник не имеет E2EE ключей');
  }

  // Подсветка в сайдбаре
  document.querySelectorAll('.conv-item').forEach(el => {
    el.classList.toggle('active', el.dataset.convId === cId);
  });

  // Рендерим область чата
  const chatArea = document.getElementById('chat-area');
  if (!chatArea) return;

  chatArea.innerHTML = `
    <div class="chat-header">
      <div class="chat-header-avatar">${avatarHtml(otherAvatar, otherName, 36)}</div>
      <div>
        <div class="chat-header-name">${esc(otherName)}</div>
      </div>
      <div class="chat-mode-switch">
        <span class="chat-mode-label" id="chat-mode-label">Обычный</span>
        <button class="chat-mode-btn" id="chat-mode-toggle" title="Переключить режим чата">🔓</button>
      </div>
      <a class="chat-header-link" href="profile.html?uid=${encodeURIComponent(otherId)}">👤 Профиль</a>
    </div>
    <div class="chat-messages" id="chat-messages"></div>
    <div class="chat-input-area">
      <textarea class="chat-input" id="chat-input" rows="1"
        placeholder="Написать сообщение..."></textarea>
      <button class="chat-send-btn" id="chat-send-btn">↑</button>
    </div>
  `;

  // ── РЕЖИМ ЧАТА (секретный / обычный) ──
  const modeBtn   = document.getElementById('chat-mode-toggle');
  const modeLabel = document.getElementById('chat-mode-label');

  function updateModeUI(secret) {
    activeConvIsSecret = secret;
    if (secret) {
      modeBtn.textContent = '🔒';
      modeLabel.textContent = 'Секретный';
      modeLabel.classList.add('secret');
    } else {
      modeBtn.textContent = '🔓';
      modeLabel.textContent = 'Обычный';
      modeLabel.classList.remove('secret');
    }
  }

  // Загружаем текущий режим
  const convRef = window.db.collection('conversations').doc(cId);
  const convSnap = await convRef.get();
  updateModeUI(convSnap.exists ? (convSnap.data().isSecret || false) : false);

  // Слушаем изменения режима
  activeConvDocUnsub?.();
  activeConvDocUnsub = convRef.onSnapshot(doc => {
    if (doc.exists) updateModeUI(doc.data().isSecret || false);
  });

  // Переключение по клику
  modeBtn.addEventListener('click', async () => {
    const newMode = !activeConvIsSecret;
    try {
      await convRef.set({ isSecret: newMode }, { merge: true });
      updateModeUI(newMode);
    } catch (e) {
      console.error('❌ Ошибка смены режима:', e);
    }
  });

  // ── ДЕЛЕГИРОВАНИЕ УДАЛЕНИЯ СООБЩЕНИЙ (только для секретного чата) ──
  const msgContainer = document.getElementById('chat-messages');
  msgContainer.addEventListener('click', async (e) => {
    const btn = e.target.closest('.msg-delete');
    if (!btn) return;
    
    const msgId = btn.dataset.msgId;
    if (!msgId || !confirm('Удалить сообщение? Это действие нельзя отменить.')) return;
    
    try {
      await window.db.collection('conversations').doc(cId).collection('messages').doc(msgId).delete();
    } catch (err) {
      console.error('❌ Удаление:', err);
    }
  });

  // Отправка
  const inputEl = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send-btn');

  const send = () => sendMessage(cId, otherId, otherName, otherAvatar);
  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  // Авто-resize textarea
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  });

  // Подписка на сообщения
  subscribeMessages(cId, currentUser.uid);

  // Сброс непрочитанных
  markAsRead(cId, currentUser.uid);
}

// ─── MESSAGES SUBSCRIPTION ────────────────────────────────────────────────────

function subscribeMessages(cId, myUid) {
  messagesUnsub?.();

  const container = document.getElementById('chat-messages');
  if (!container) return;

  let lastDate = null;

  messagesUnsub = window.db
    .collection('conversations').doc(cId).collection('messages')
    .orderBy('createdAt', 'asc')
    .onSnapshot(async snap => {
      container.innerHTML = '';
      lastDate = null;

      // Используем for...of вместо forEach, чтобы await работал
      for (const doc of snap.docs) {
        const rawMsg = doc.data();
        const isOwn = rawMsg.senderUid === myUid;

        // ── E2EE: расшифровка ──
        let msgText = rawMsg.text;
        if ((rawMsg._encrypted || rawMsg._e2ee) && !isOwn) {
          const myKeys = await getOrCreateKeys();
          msgText = await decryptE2EE(rawMsg.text, myKeys.privateKey);
        }

        const msg = { ...rawMsg, text: msgText };

        // Разделитель по дате
        const dateStr = formatMsgDate(msg.createdAt);
        if (dateStr !== lastDate) {
          lastDate = dateStr;
          const div = document.createElement('div');
          div.className = 'msg-date-divider';
          div.textContent = dateStr;
          container.appendChild(div);
        }

        // Получаем аватар отправителя из кэша
        const senderInfo = userCache[msg.senderUid];
        const senderAva  = senderInfo?.avatar || null;
        const senderName = senderInfo?.name || '?';

        const msgEl = document.createElement('div');
        msgEl.className = `msg ${isOwn ? 'own' : ''}`;
        msgEl.innerHTML = `
          <div class="msg-avatar">${avatarHtml(senderAva, senderName, 28)}</div>
          <div class="msg-content">
            <div class="msg-bubble">${esc(msg.text)}</div>
            <div class="msg-time">${formatMsgTime(msg.createdAt)}</div>
            ${(isOwn && activeConvIsSecret) ? `<button class="msg-delete" data-msg-id="${doc.id}" title="Удалить навсегда">🗑️</button>` : ''}
          </div>
        `;
        container.appendChild(msgEl);
      }

      // Скролл вниз
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight;
        });
      });
    }, err => {
      console.error('❌ Messages:', err);
    });
}

// ─── SEND MESSAGE ─────────────────────────────────────────────────────────────

async function sendMessage(cId, otherId, otherName, otherAvatar) {
  const inputEl = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send-btn');
  if (!inputEl) return;

  const text = inputEl.value.trim();
  if (!text) return;

  // Шифруем только в секретном режиме
  let encryptedText = text;
  let isEncrypted   = false;

  if (activeConvIsSecret) {
    const otherPublicKey = await getPublicKey(otherId);
    if (otherPublicKey) {
      try {
        encryptedText = await encryptE2EE(text, otherPublicKey);
        isEncrypted = true;
      } catch (e) {
        console.error('❌ Encrypt failed:', e);
      }
    }
  }

  sendBtn.disabled = true;
  inputEl.value = '';
  inputEl.style.height = 'auto';

  try {
    const me = currentUser;

    if (!userCache[me.uid]) await getUser(me.uid);

    const batch = window.db.batch();

    const msgRef = window.db
      .collection('conversations').doc(cId)
      .collection('messages').doc();
    batch.set(msgRef, {
      senderUid: me.uid,
      text: encryptedText,
      _encrypted: isEncrypted,
      _e2ee: isEncrypted,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      read: false,
    });

    const convRef = window.db.collection('conversations').doc(cId);
    batch.set(convRef, {
      participants:       [me.uid, otherId],
      participantNames:   {
        [me.uid]:  userCache[me.uid]?.name  || me.displayName || me.email,
        [otherId]: otherName,
      },
      participantAvatars: {
        [me.uid]:  userCache[me.uid]?.avatar  || me.displayName?.[0]?.toUpperCase() || '?',
        [otherId]: otherAvatar || otherName[0]?.toUpperCase() || '?',
      },
      lastMessage:    text,
      lastMessageAt:  firebase.firestore.FieldValue.serverTimestamp(),
      [`unread.${otherId}`]: firebase.firestore.FieldValue.increment(1),
    }, { merge: true });

    await batch.commit();
  } catch (err) {
    console.error('❌ Send:', err);
    inputEl.value = text;
  } finally {
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

// ─── MARK AS READ ─────────────────────────────────────────────────────────────

function markAsRead(cId, myUid) {
  window.db.collection('conversations').doc(cId).update({
    [`unread.${myUid}`]: 0,
  }).catch(() => {});
}

// ─── HEADER BADGE ─────────────────────────────────────────────────────────────

function updateMsgBadge(myUid) {
  window.db.collection('conversations')
    .where('participants', 'array-contains', myUid)
    .get()
    .then(snap => {
      let total = 0;
      snap.forEach(doc => { total += doc.data().unread?.[myUid] || 0; });
      const badge = document.getElementById('msg-badge');
      if (badge) {
        badge.textContent = total > 0 ? (total > 99 ? '99+' : total) : '';
        badge.style.display = total > 0 ? 'grid' : 'none';
      }
    }).catch(() => {});
}

// ─── NEW CONVERSATION MODAL ───────────────────────────────────────────────────

function initNewConvModal() {
  const modal    = document.getElementById('new-conv-modal');
  const openBtn  = document.getElementById('new-conv-btn');
  const closeBtn = document.getElementById('new-conv-close');
  const backdrop = document.getElementById('new-conv-backdrop');
  const search   = document.getElementById('new-conv-search');
  const results  = document.getElementById('new-conv-results');
  const errEl    = document.getElementById('new-conv-error');

  if (!modal || !openBtn) return;

  const open  = () => { modal.classList.add('open'); search.focus(); };
  const close = () => { modal.classList.remove('open'); search.value = ''; results.innerHTML = ''; if (errEl) errEl.textContent = ''; };

  openBtn.addEventListener('click', open);
  closeBtn?.addEventListener('click', close);
  backdrop?.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  let searchTimeout;
  search.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const q = search.value.trim();
    if (!q || q.length < 2) { results.innerHTML = ''; return; }

    searchTimeout = setTimeout(async () => {
      if (errEl) errEl.textContent = '';
      try {
        const snap = await window.db.collection('users')
          .where('name', '>=', q)
          .where('name', '<=', q + '\uf8ff')
          .limit(8)
          .get();

        results.innerHTML = '';

        if (snap.empty) {
          results.innerHTML = '<div style="color:var(--muted);font-size:.85rem;padding:8px 4px;">Пользователи не найдены</div>';
          return;
        }

        snap.forEach(doc => {
          if (doc.id === currentUser.uid) return;
          const data = doc.data();
          const el   = document.createElement('div');
          el.className = 'new-conv-user';
          el.innerHTML = `
            <div class="new-conv-user-avatar">${avatarHtml(data.avatar, data.name, 32)}</div>
            <div>
              <div style="color:#fff;font-size:.88rem;font-weight:500;">${esc(data.name)}</div>
              <div style="color:var(--muted);font-size:.75rem;">${data.role || 'user'}</div>
            </div>
          `;
          el.addEventListener('click', async () => {
            close();
            const cId = convId(currentUser.uid, doc.id);
            userCache[doc.id] = { name: data.name, avatar: data.avatar || null };
            await getUser(currentUser.uid);
            openConversation(cId, doc.id, data.name, data.avatar || null);
          });
          results.appendChild(el);
        });
      } catch (err) {
        console.error('❌ Search:', err);
        if (errEl) errEl.textContent = 'Ошибка поиска';
      }
    }, 350);
  });
}

// ─── MAIN RENDER ──────────────────────────────────────────────────────────────

function renderMessagesUI(myUid) {
  const root = document.getElementById('messages-root');
  if (!root) return;

  root.innerHTML = `
    <div class="messages-layout">
      <div class="conv-sidebar">
        <div class="conv-sidebar-header">
          <h3>💬 Сообщения</h3>
          <button class="conv-new-btn" id="new-conv-btn">+ Новый</button>
        </div>
        <div class="conv-list" id="conv-list">
          <div class="conv-empty">Загрузка...</div>
        </div>
      </div>
      <div class="chat-area" id="chat-area">
        <div class="chat-placeholder">
          <div>
            <div class="chat-placeholder-icon">💬</div>
            <div>Выберите диалог или начните новый</div>
          </div>
        </div>
      </div>
    </div>
  `;

  const params = new URLSearchParams(window.location.search);
  const withUid = params.get('with');
  if (withUid && withUid !== myUid) {
    getUser(withUid).then(u => {
      const cId = convId(myUid, withUid);
      userCache[withUid] = u;
      openConversation(cId, withUid, u.name, u.avatar);
    });
  }

  initConvList(myUid);
  initNewConvModal();
  getUser(myUid);
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

function init() {
  waitForFirebase(() => {
    window.auth.onAuthStateChanged(user => {
      currentUser = user;
      const root = document.getElementById('messages-root');

      if (!user) {
        if (root) root.innerHTML = `
          <div class="messages-guest">
            <div>
              <div style="font-size:3rem;margin-bottom:12px;">🔒</div>
              <h3>Доступ закрыт</h3>
              <p>Войдите в аккаунт, чтобы использовать сообщения.</p>
            </div>
          </div>`;
        return;
      }

      renderMessagesUI(user.uid);
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else { init(); }

// ═══════════════════════════════════════════════════════════
// БЛОКИРУЕМ глобальный плавный скролл script.js внутри чата
// ═══════════════════════════════════════════════════════════

function blockChatScrollPropagation() {
  const chatSelectors = ['.chat-messages', '#chat-messages', '.conv-sidebar', '#conv-list'];

  const setup = () => {
    chatSelectors.forEach(selector => {
      const el = document.querySelector(selector);
      if (!el || el.dataset.scrollBlocked === '1') return;
      el.dataset.scrollBlocked = '1';

      el.addEventListener('wheel', (e) => {
        const isAtTop = el.scrollTop <= 0;
        const isAtBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;

        if (!isAtTop && !isAtBottom) {
          e.stopPropagation();
          return;
        }
        if (isAtTop && e.deltaY < 0) e.stopPropagation();
        if (isAtBottom && e.deltaY > 0) e.stopPropagation();
      }, { passive: true });

      el.addEventListener('touchmove', (e) => {
        e.stopPropagation();
      }, { passive: true });
    });
  };

  setup();
  const observer = new MutationObserver(setup);
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', blockChatScrollPropagation);
} else {
  blockChatScrollPropagation();
}