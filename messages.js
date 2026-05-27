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

let currentUser    = null;
let activeConvId   = null;
let messagesUnsub  = null;
let convsUnsub     = null;
let userCache      = {};
let cachedMyKeys   = null;
let didSyncKeysThisSession = false;

// ═══════════════════════════════════════════════════════════
// 🔐 END-TO-END ENCRYPTION (Web Crypto API)
// ═══════════════════════════════════════════════════════════

const KEY_ALGO = { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' };
const AES_ALGO = { name: 'AES-GCM', length: 256 };
const E2EE_LOCAL_KEY = 'e2ee_keys_v2';
const E2EE_LEGACY_LOCAL_KEY = 'e2ee_keys';
const E2EE_SYNC_KDF_ITERS = 310000;

async function generateKeyPair() {
  return crypto.subtle.generateKey(KEY_ALGO, true, ['encrypt', 'decrypt']);
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

function textToBase64(text) {
  return bytesToBase64(new TextEncoder().encode(text));
}

function base64ToText(base64) {
  return new TextDecoder().decode(base64ToBytes(base64));
}

function parseJsonSafe(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function exportPublicKey(key) {
  const exported = await crypto.subtle.exportKey('spki', key);
  return bytesToBase64(new Uint8Array(exported));
}

async function importPublicKey(base64) {
  const binary = base64ToBytes(base64);
  return crypto.subtle.importKey('spki', binary, KEY_ALGO, false, ['encrypt']);
}

async function importPrivateKey(base64) {
  const binary = base64ToBytes(base64);
  return crypto.subtle.importKey('pkcs8', binary, KEY_ALGO, false, ['decrypt']);
}

async function exportPrivateKey(key) {
  const exported = await crypto.subtle.exportKey('pkcs8', key);
  return bytesToBase64(new Uint8Array(exported));
}

function getAuthSyncMaterial(user) {
  const createdAt = user?.metadata?.creationTime || '';
  const email = (user?.email || '').toLowerCase();
  const providers = (user?.providerData || [])
    .map(p => p?.providerId || '')
    .filter(Boolean)
    .sort()
    .join(',');
  return `${user.uid}|${createdAt}|${email}|${providers}|EgorNetwork:e2ee:v2`;
}

async function deriveSyncKey(user, salt, usage, iterations = E2EE_SYNC_KDF_ITERS) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(getAuthSyncMaterial(user)),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage]
  );
}

async function makeCloudBackup(privateKeyB64, user) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const wrapKey = await deriveSyncKey(user, salt, 'encrypt');
  const payload = new TextEncoder().encode(privateKeyB64);
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, payload);
  return {
    version: 2,
    kdf: 'PBKDF2-SHA256',
    iterations: E2EE_SYNC_KDF_ITERS,
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
    wrappedPrivateKey: bytesToBase64(new Uint8Array(wrapped)),
  };
}

async function unwrapCloudBackup(backup, user) {
  const iv = base64ToBytes(backup.iv);
  const salt = base64ToBytes(backup.salt);
  const ciphertext = base64ToBytes(backup.wrappedPrivateKey);
  const unwrapKey = await deriveSyncKey(user, salt, 'decrypt', backup.iterations || E2EE_SYNC_KDF_ITERS);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, unwrapKey, ciphertext);
  return new TextDecoder().decode(decrypted);
}

async function importPairFromBase64(publicKeyB64, privateKeyB64) {
  return {
    publicKey: await importPublicKey(publicKeyB64),
    privateKey: await importPrivateKey(privateKeyB64),
  };
}

async function exportPairToBase64(pair) {
  return {
    publicKey: await exportPublicKey(pair.publicKey),
    privateKey: await exportPrivateKey(pair.privateKey),
  };
}

function readLocalV2Keys() {
  const parsed = parseJsonSafe(localStorage.getItem(E2EE_LOCAL_KEY) || '');
  if (!parsed?.publicKey || !parsed?.privateKey) return null;
  return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
}

function writeLocalV2Keys(publicKey, privateKey) {
  localStorage.setItem(E2EE_LOCAL_KEY, JSON.stringify({
    version: 2,
    publicKey,
    privateKey,
  }));
}

function readLegacyLocalKeys() {
  const parsed = parseJsonSafe(localStorage.getItem(E2EE_LEGACY_LOCAL_KEY) || '');
  if (!parsed?.publicKey || !parsed?.privateKey) return null;
  return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
}

async function saveKeysEverywhere(user, publicKeyB64, privateKeyB64) {
  writeLocalV2Keys(publicKeyB64, privateKeyB64);
  localStorage.removeItem(E2EE_LEGACY_LOCAL_KEY);

  const backup = await makeCloudBackup(privateKeyB64, user);
  await window.db.collection('users').doc(user.uid).set({
    publicKey: publicKeyB64,
    _hasE2EE: true,
    _e2eeVersion: 2,
    e2eeV2: {
      ...backup,
      publicKey: publicKeyB64,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    },
  }, { merge: true }).catch(() => {});
  didSyncKeysThisSession = true;
}

async function getOrCreateKeys() {
  if (cachedMyKeys) return cachedMyKeys;

  const me = window.auth.currentUser;
  if (!me) throw new Error('Требуется авторизация для E2EE');

  const localV2 = readLocalV2Keys();
  if (localV2) {
    try {
      cachedMyKeys = await importPairFromBase64(localV2.publicKey, localV2.privateKey);
      if (!didSyncKeysThisSession) {
        saveKeysEverywhere(me, localV2.publicKey, localV2.privateKey).catch(() => {});
      }
      return cachedMyKeys;
    } catch (e) {
      console.warn('⚠️ Локальные e2ee_v2 ключи повреждены, пробуем восстановить из облака', e);
    }
  }

  const legacy = readLegacyLocalKeys();
  if (legacy) {
    try {
      cachedMyKeys = await importPairFromBase64(legacy.publicKey, legacy.privateKey);
      await saveKeysEverywhere(me, legacy.publicKey, legacy.privateKey);
      return cachedMyKeys;
    } catch (e) {
      console.warn('⚠️ Локальные legacy-ключи повреждены, пробуем восстановить из облака', e);
    }
  }

  try {
    const doc = await window.db.collection('users').doc(me.uid).get();
    if (doc.exists) {
      const data = doc.data() || {};
      const backup = data.e2eeV2;
      const cloudPublicKey = backup?.publicKey || data.publicKey;

      if (backup?.wrappedPrivateKey && backup?.iv && backup?.salt && cloudPublicKey) {
        const restoredPrivateB64 = await unwrapCloudBackup(backup, me);
        cachedMyKeys = await importPairFromBase64(cloudPublicKey, restoredPrivateB64);
        writeLocalV2Keys(cloudPublicKey, restoredPrivateB64);
        return cachedMyKeys;
      }
    }
  } catch (e) {
    console.warn('⚠️ Не удалось восстановить ключи из облака, создаём новую пару', e);
  }

  const pair = await generateKeyPair();
  const exported = await exportPairToBase64(pair);
  await saveKeysEverywhere(me, exported.publicKey, exported.privateKey);
  cachedMyKeys = pair;
  return pair;
}

async function getPublicKey(uid) {
  if (currentUser && uid === currentUser.uid) {
    const myKeys = await getOrCreateKeys();
    return myKeys.publicKey;
  }

  if (userCache[uid]?.publicKey) return userCache[uid].publicKey;
  if (userCache[uid]?.publicKeyB64) {
    const key = await importPublicKey(userCache[uid].publicKeyB64);
    userCache[uid].publicKey = key;
    return key;
  }

  const doc = await window.db.collection('users').doc(uid).get();
  const rawPublicKey = doc.exists ? (doc.data().e2eeV2?.publicKey || doc.data().publicKey) : null;
  if (!rawPublicKey) return null;

  const key = await importPublicKey(rawPublicKey);
  if (userCache[uid]) {
    userCache[uid].publicKey = key;
    userCache[uid].publicKeyB64 = rawPublicKey;
  }
  return key;
}

async function encryptE2EE(text, senderUid, senderPublicKey, recipientUid, recipientPublicKey) {
  const aesKey = await crypto.subtle.generateKey(AES_ALGO, true, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    enc.encode(text)
  );

  const aesRaw = await crypto.subtle.exportKey('raw', aesKey);

  const encryptedSenderKey = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    senderPublicKey,
    aesRaw
  );

  const encryptedRecipientKey = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    recipientPublicKey,
    aesRaw
  );

  const payload = {
    v: 2,
    iv: bytesToBase64(iv),
    c: bytesToBase64(new Uint8Array(ciphertext)),
    k: {
      [senderUid]: bytesToBase64(new Uint8Array(encryptedSenderKey)),
      [recipientUid]: bytesToBase64(new Uint8Array(encryptedRecipientKey)),
    },
  };

  return `v2:${textToBase64(JSON.stringify(payload))}`;
}

async function decryptE2EELegacy(encrypted, privateKey) {
  const [keyB64, ivB64, cipherB64] = String(encrypted || '').split(':');
  if (!keyB64 || !ivB64 || !cipherB64) return encrypted;

  const encryptedKey = base64ToBytes(keyB64);
  const aesRaw = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    encryptedKey
  );

  const aesKey = await crypto.subtle.importKey('raw', aesRaw, AES_ALGO, false, ['decrypt']);
  const iv = base64ToBytes(ivB64);
  const ciphertext = base64ToBytes(cipherB64);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    ciphertext
  );
  return new TextDecoder().decode(decrypted);
}

async function decryptE2EEv2(encrypted, myUid, privateKey) {
  const encodedPayload = String(encrypted || '').slice(3);
  const payload = parseJsonSafe(base64ToText(encodedPayload));
  if (!payload || payload.v !== 2 || !payload.iv || !payload.c || !payload.k) {
    throw new Error('Неверный формат шифрования v2');
  }

  const wrappedKeyB64 = payload.k[myUid];
  if (!wrappedKeyB64) {
    throw new Error('Ключ для этого пользователя не найден');
  }

  const aesRaw = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    base64ToBytes(wrappedKeyB64)
  );
  const aesKey = await crypto.subtle.importKey('raw', aesRaw, AES_ALGO, false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(payload.iv) },
    aesKey,
    base64ToBytes(payload.c)
  );
  return new TextDecoder().decode(decrypted);
}

function isEncryptedMessage(rawMsg) {
  if (!rawMsg) return false;
  if (rawMsg._encrypted || rawMsg._e2ee || rawMsg._cryptoVersion === 2) return true;
  return typeof rawMsg.text === 'string' && rawMsg.text.startsWith('v2:');
}

async function decryptE2EE(encrypted, myUid, privateKey) {
  try {
    if (typeof encrypted === 'string' && encrypted.startsWith('v2:')) {
      return await decryptE2EEv2(encrypted, myUid, privateKey);
    }
    return await decryptE2EELegacy(encrypted, privateKey);
  } catch (e) {
    console.error('❌ E2EE decrypt failed:', e);
    throw e;
  }
}

// ─── USER CACHE ───────────────────────────────────────────────────────────────

async function getUser(uid) {
  if (userCache[uid]) return userCache[uid];
  try {
    const doc = await window.db.collection('users').doc(uid).get();
    const data = doc.exists ? doc.data() : { name: 'Неизвестный', avatar: null };
    userCache[uid] = {
      name: data.name || 'Неизвестный',
      avatar: data.avatar || null,
      publicKeyB64: data.e2eeV2?.publicKey || data.publicKey || null,
    };
    return userCache[uid];
  } catch {
    return { name: 'Неизвестный', avatar: null };
  }
}

// ─── RENDER HELPERS ───────────────────────────────────────────────────────────

function renderConvItem(conv, convIdStr, myUid) {
  const otherId   = conv.participants.find(u => u !== myUid);
  const otherName = conv.participantNames?.[otherId] || 'Пользователь';
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
      <div class="conv-name">${esc(otherName)}</div>
      <div class="conv-preview">${esc(preview)}</div>
    </div>
    ${unread > 0 ? `<div class="conv-unread">${unread}</div>` : ''}
  `;

  li.addEventListener('click', () => openConversation(convIdStr, otherId, otherName, otherAva));
  return li;
}

async function ensureConversationExists(cId, myUid, otherId, otherName, otherAvatar) {
  const convRef = window.db.collection('conversations').doc(cId);
  try {
    const convSnap = await convRef.get();
    if (convSnap.exists) return { ref: convRef, snap: convSnap };
  } catch (err) {
    if (err?.code !== 'permission-denied') throw err;
    console.warn('⚠️ Нет доступа на чтение нового диалога до его создания, создаём напрямую:', cId);
  }

  if (!userCache[myUid]) await getUser(myUid);
  const now = firebase.firestore.Timestamp.now();

  await convRef.set({
    participants: [myUid, otherId],
    participantNames: {
      [myUid]: userCache[myUid]?.name || currentUser?.displayName || currentUser?.email || 'Вы',
      [otherId]: otherName || 'Пользователь',
    },
    participantAvatars: {
      [myUid]: userCache[myUid]?.avatar || null,
      [otherId]: otherAvatar || null,
    },
    unread: {
      [myUid]: 0,
      [otherId]: 0,
    },
    lastMessage: '',
    lastMessageAt: now,
    createdAt: now,
  }, { merge: true });

  try {
    const createdSnap = await convRef.get();
    return { ref: convRef, snap: createdSnap };
  } catch (err) {
    console.warn('⚠️ Диалог создан, но повторное чтение пока недоступно:', err);
    return {
      ref: convRef,
      snap: {
        exists: true,
        data: () => ({}),
      },
    };
  }
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

  await ensureConversationExists(cId, currentUser.uid, otherId, otherName, otherAvatar);

  // Подсветка в сайдбаре
  document.querySelectorAll('.conv-item').forEach(el => {
    el.classList.toggle('active', el.dataset.convId === cId);
  });

  // Рендерим область чата
  const chatArea = document.getElementById('chat-area');
  if (!chatArea) return;

  if (otherId) {
    userCache[otherId] = {
      ...(userCache[otherId] || {}),
      name: otherName || userCache[otherId]?.name || 'Пользователь',
      avatar: otherAvatar || userCache[otherId]?.avatar || null,
    };
  }

  chatArea.innerHTML = `
    <div class="chat-header">
      <div class="chat-header-avatar">${avatarHtml(otherAvatar, otherName, 36)}</div>
      <div>
        <div class="chat-header-name">${esc(otherName)}</div>
      </div>
      <a class="chat-header-link" href="profile.html?uid=${encodeURIComponent(otherId)}">👤 Профиль</a>
    </div>
    <div class="chat-messages" id="chat-messages"></div>
    <div class="chat-input-area">
      <textarea class="chat-input" id="chat-input" rows="1"
        placeholder="Написать сообщение..."></textarea>
      <div class="chat-actions-wrapper">
        <button class="chat-actions-btn" id="chat-actions-btn" title="Действия">+</button>
        <div class="chat-actions-menu" id="chat-actions-menu">
          <div class="chat-actions-item" id="snake-duel-item">
            <span class="chat-actions-icon">🐍</span>
            <span>Пригласить на змеиную дуэль</span>
          </div>
        </div>
        <button class="chat-send-btn" id="chat-send-btn">↑</button>
      </div>
    </div>
  `;

  // ── ДЕЛЕГИРОВАНИЕ ПРИНЯТИЯ ПРИГЛАШЕНИЯ НА ЗМЕИНУЮ ДУЭЛЬ ──
  const msgContainer = document.getElementById('chat-messages');
  msgContainer.addEventListener('click', (e) => {
    const acceptBtn = e.target.closest('.msg-invite-accept-btn');
    if (!acceptBtn) return;

    const inviterUid = acceptBtn.dataset.inviter;
    if (!inviterUid) return;

    // Открываем minis.html с параметрами для змеиной дуэли
    const params = new URLSearchParams({
      game: 'snake',
      mode: 'duel',
      opponent: inviterUid,
      opponentName: userCache[inviterUid]?.name || 'Соперник'
    });
    window.open(`minis.html?${params.toString()}`, '_blank');
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

  // ── КНОПКА "+" И КОНТЕКСТНОЕ МЕНЮ ──
  const actionsBtn = document.getElementById('chat-actions-btn');
  const actionsMenu = document.getElementById('chat-actions-menu');
  const snakeDuelItem = document.getElementById('snake-duel-item');

  if (actionsBtn && actionsMenu) {
    // Открытие/закрытие меню
    actionsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      actionsMenu.classList.toggle('open');
    });

    // Закрытие при клике вне меню
    document.addEventListener('click', () => {
      actionsMenu.classList.remove('open');
    });

    // Приглашение на змеиную дуэль
    if (snakeDuelItem) {
      snakeDuelItem.addEventListener('click', () => {
        actionsMenu.classList.remove('open');
        sendSnakeDuelInvite(cId, otherId, otherName);
      });
    }
  }

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
  let safetyDividerShown = false;

  messagesUnsub = window.db
    .collection('conversations').doc(cId).collection('messages')
    .orderBy('createdAt', 'asc')
    .onSnapshot(async snap => {
      container.innerHTML = '';
      lastDate = null;
      safetyDividerShown = false;
      let myKeys = null;

      // Используем for...of вместо forEach, чтобы await работал
      for (const doc of snap.docs) {
        const rawMsg = doc.data();
        const isOwn = rawMsg.senderUid === myUid;

        // ── E2EE: расшифровка ──
        let msgText = rawMsg.text;
        if (isEncryptedMessage(rawMsg)) {
          try {
            if (!myKeys) myKeys = await getOrCreateKeys();
            msgText = await decryptE2EE(rawMsg.text, myUid, myKeys.privateKey);
          } catch (e) {
            console.error('❌ Message decrypt error:', e);
            const isLegacyOwnEncrypted = isOwn
              && typeof rawMsg.text === 'string'
              && !rawMsg.text.startsWith('v2:');
            msgText = isLegacyOwnEncrypted
              ? '🔐 Вы отправили защищённое сообщение (старый формат).'
              : '[Не удалось расшифровать сообщение]';
          }
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

        const isV2Message = rawMsg._cryptoVersion === 2
          || (typeof rawMsg.text === 'string' && rawMsg.text.startsWith('v2:'));
        if (!safetyDividerShown && isV2Message) {
          safetyDividerShown = true;
          const secDiv = document.createElement('div');
          secDiv.className = 'msg-security-divider';
          secDiv.textContent = '🔐 Чат стал безопаснее: теперь используется шифрование с синхронизацией между устройствами.';
          container.appendChild(secDiv);
        }

        // Получаем аватар отправителя из кэша
        const senderInfo = userCache[msg.senderUid];
        const senderAva  = senderInfo?.avatar || null;
        const senderName = senderInfo?.name || '?';

        // Проверяем, является ли сообщение приглашением на змеиную дуэль
        const isSnakeDuelInvite = msg._inviteType === 'snake_duel';
        const canAcceptInvite = !isOwn && isSnakeDuelInvite && msg._inviteeUid === myUid;

        const msgEl = document.createElement('div');
        msgEl.className = `msg ${isOwn ? 'own' : ''}${isSnakeDuelInvite ? ' msg-invite' : ''}`;

        let bubbleContent = esc(msg.text);
        if (isSnakeDuelInvite) {
          if (canAcceptInvite) {
            bubbleContent = `
              <div class="msg-invite-content">
                <div class="msg-invite-text">${esc(msg.text)}</div>
                <button class="msg-invite-accept-btn" data-inviter="${msg._inviterUid}">Принять вызов 🐍</button>
              </div>`;
          } else {
            bubbleContent = `<div class="msg-invite-sent">🐍 Приглашение на змеиную дуэль отправлено</div>`;
          }
        }

        msgEl.innerHTML = `
          <div class="msg-avatar">${avatarHtml(senderAva, senderName, 28)}</div>
          <div class="msg-content">
            <div class="msg-bubble">${bubbleContent}</div>
            <div class="msg-time">${formatMsgTime(msg.createdAt)}</div>
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

  // Все текстовые сообщения шифруем в новом режиме (v2)
  let encryptedText = text;
  let isEncrypted   = false;
  let cryptoVersion = 0;

  try {
    const myKeys = await getOrCreateKeys();
    const otherPublicKey = await getPublicKey(otherId);

    if (!otherPublicKey) {
      alert('Пользователь ещё не инициализировал защищённый чат. Попросите его открыть сообщения и повторите отправку.');
      return;
    }

    encryptedText = await encryptE2EE(text, currentUser.uid, myKeys.publicKey, otherId, otherPublicKey);
    isEncrypted = true;
    cryptoVersion = 2;
  } catch (e) {
    console.error('❌ Encrypt failed:', e);
    alert('Не удалось зашифровать сообщение. Попробуйте ещё раз.');
    return;
  }

  sendBtn.disabled = true;
  inputEl.value = '';
  inputEl.style.height = 'auto';

  try {
    const me = currentUser;

    if (!userCache[me.uid]) await getUser(me.uid);
    const convRef = window.db.collection('conversations').doc(cId);
    const msgRef = convRef.collection('messages').doc();
    const myName = userCache[me.uid]?.name || me.displayName || me.email || 'Вы';
    const myAvatar = userCache[me.uid]?.avatar || null;
    const safeOtherName = otherName || userCache[otherId]?.name || 'Пользователь';
    const safeOtherAvatar = otherAvatar ?? userCache[otherId]?.avatar ?? null;

    await window.db.runTransaction(async tx => {
      const convSnap = await tx.get(convRef);
      const convData = convSnap.exists ? convSnap.data() : {};
      const unread = {
        ...((convData && typeof convData.unread === 'object' && convData.unread) || {}),
      };

      unread[otherId] = (Number(unread[otherId]) || 0) + 1;
      unread[me.uid] = 0;

      tx.set(msgRef, {
        senderUid: me.uid,
        text: encryptedText,
        _encrypted: isEncrypted,
        _e2ee: isEncrypted,
        _cryptoVersion: cryptoVersion,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        read: false,
      });

      tx.set(convRef, {
        participants: [me.uid, otherId],
        participantNames: {
          ...((convData && convData.participantNames) || {}),
          [me.uid]: myName,
          [otherId]: safeOtherName,
        },
        participantAvatars: {
          ...((convData && convData.participantAvatars) || {}),
          [me.uid]: myAvatar,
          [otherId]: safeOtherAvatar,
        },
        unread,
        lastMessage: isEncrypted ? '🔐 Зашифрованное сообщение' : text,
        lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
        _encrypted: isEncrypted,
        _e2ee: isEncrypted,
        _cryptoVersion: cryptoVersion,
        createdAt: convData?.createdAt || firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });
  } catch (err) {
    console.error('❌ Send:', err);
    inputEl.value = text;
  } finally {
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

// ─── SNAKE DUEL INVITE ───────────────────────────────────────────────────────

async function sendSnakeDuelInvite(cId, otherId, otherName) {
  const me = currentUser;
  if (!me) return;

  try {
    if (!userCache[me.uid]) await getUser(me.uid);
    const convRef = window.db.collection('conversations').doc(cId);
    const msgRef = convRef.collection('messages').doc();
    const myName = userCache[me.uid]?.name || me.displayName || me.email || 'Вы';

    // Формируем сообщение-приглашение
    const invitePlainText = '🐍 Приглашаю тебя на змеиную дуэль! Нажми, чтобы принять вызов.';
    let inviteText = invitePlainText;
    let isEncrypted = false;
    let cryptoVersion = 0;

    const myKeys = await getOrCreateKeys();
    const otherPublicKey = await getPublicKey(otherId);
    if (!otherPublicKey) {
      throw new Error('Собеседник ещё не инициализировал защищённый чат');
    }
    inviteText = await encryptE2EE(invitePlainText, me.uid, myKeys.publicKey, otherId, otherPublicKey);
    isEncrypted = true;
    cryptoVersion = 2;

    await window.db.runTransaction(async tx => {
      const convSnap = await tx.get(convRef);
      const convData = convSnap.exists ? convSnap.data() : {};
      const unread = {
        ...((convData && typeof convData.unread === 'object' && convData.unread) || {}),
      };

      unread[otherId] = (Number(unread[otherId]) || 0) + 1;
      unread[me.uid] = 0;

      tx.set(msgRef, {
        senderUid: me.uid,
        text: inviteText,
        _encrypted: isEncrypted,
        _e2ee: isEncrypted,
        _cryptoVersion: cryptoVersion,
        _inviteType: 'snake_duel',
        _inviterUid: me.uid,
        _inviteeUid: otherId,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        read: false,
      });

      tx.set(convRef, {
        participants: [me.uid, otherId],
        participantNames: {
          ...((convData && convData.participantNames) || {}),
          [me.uid]: myName,
          [otherId]: otherName || 'Пользователь',
        },
        unread,
        lastMessage: isEncrypted ? '🔐 Зашифрованное сообщение' : invitePlainText,
        lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
        _encrypted: isEncrypted,
        _e2ee: isEncrypted,
        _cryptoVersion: cryptoVersion,
        createdAt: convData?.createdAt || firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });

    console.log('✅ Snake duel invite sent');
  } catch (err) {
    console.error('❌ Send snake duel invite:', err);
  }
}

// ─── MARK AS READ ─────────────────────────────────────────────────────────────

function markAsRead(cId, myUid) {
  const convRef = window.db.collection('conversations').doc(cId);
  window.db.runTransaction(async tx => {
    const snap = await tx.get(convRef);
    if (!snap.exists) return;

    const convData = snap.data() || {};
    const unread = {
      ...((convData && typeof convData.unread === 'object' && convData.unread) || {}),
    };

    if ((Number(unread[myUid]) || 0) === 0) return;
    unread[myUid] = 0;

    tx.set(convRef, { unread }, { merge: true });
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
