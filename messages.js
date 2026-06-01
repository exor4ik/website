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

const MSG_IMAGE_MAX_SIDE = 764;
const MSG_IMAGE_MAX_BYTES = 360 * 1024;

function estimateDataUrlBytes(dataUrl) {
  const base64 = String(dataUrl || '').split(',')[1] || '';
  if (!base64) return 0;
  const padding = (base64.endsWith('==') ? 2 : (base64.endsWith('=') ? 1 : 0));
  return Math.floor((base64.length * 3) / 4) - padding;
}

function resizeImageForMessage(file, maxSide = MSG_IMAGE_MAX_SIDE, maxBytes = MSG_IMAGE_MAX_BYTES) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas недоступен'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        let quality = 0.9;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (estimateDataUrlBytes(dataUrl) > maxBytes && quality > 0.46) {
          quality -= 0.08;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }

        if (estimateDataUrlBytes(dataUrl) > maxBytes) {
          reject(new Error('Изображение слишком большое даже после сжатия.'));
          return;
        }

        resolve({
          dataUrl,
          width,
          height,
          mime: 'image/jpeg',
          bytes: estimateDataUrlBytes(dataUrl),
        });
      };
      img.onerror = () => reject(new Error('Не удалось обработать изображение'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Ошибка чтения файла'));
    reader.readAsDataURL(file);
  });
}

function scrollChatToBottom(container) {
  if (!container) return;

  const prevScrollBehavior = container.style.scrollBehavior;
  container.style.scrollBehavior = 'auto';

  const snapToBottom = () => {
    container.scrollTop = container.scrollHeight;
  };

  snapToBottom();
  requestAnimationFrame(() => {
    snapToBottom();
    requestAnimationFrame(() => {
      snapToBottom();
    });
  });

  const images = Array.from(container.querySelectorAll('img'));
  if (images.length) {
    Promise.all(images.map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise(resolve => {
        const done = () => resolve();
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      });
    })).then(() => {
      requestAnimationFrame(snapToBottom);
    });
  }

  setTimeout(() => {
    if (!container.isConnected) return;
    container.style.scrollBehavior = prevScrollBehavior || '';
  }, 0);
}

// ─── STATE ────────────────────────────────────────────────────────────────────

let currentUser    = null;
let activeConvId   = null;
let messagesUnsub  = null;
let convsUnsub     = null;
let userCache      = {};
let cachedMyKeys   = null;
let cachedMyKeysUid = null;

// ═══════════════════════════════════════════════════════════
// 🔐 END-TO-END ENCRYPTION (Web Crypto API)
// ═══════════════════════════════════════════════════════════

const KEY_ALGO = { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' };
const AES_ALGO = { name: 'AES-GCM', length: 256 };
const E2EE_LOCAL_PREFIX = 'e2ee_keys_v2';
const E2EE_LEGACY_LOCAL_PREFIX = 'e2ee_keys';
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

function getAuthSyncMaterialV2(user) {
  return `${user.uid}|EgorNetwork:e2ee:v2`;
}

function getAuthSyncMaterialLegacy(user) {
  const createdAt = user?.metadata?.creationTime || '';
  const email = (user?.email || '').toLowerCase();
  const providers = (user?.providerData || [])
    .map(p => p?.providerId || '')
    .filter(Boolean)
    .sort()
    .join(',');
  return `${user.uid}|${createdAt}|${email}|${providers}|EgorNetwork:e2ee:v2`;
}

async function deriveSyncKeyFromMaterial(material, salt, usage, iterations = E2EE_SYNC_KDF_ITERS) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(material),
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
  const wrapKey = await deriveSyncKeyFromMaterial(getAuthSyncMaterialV2(user), salt, 'encrypt');
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
  const iters = backup.iterations || E2EE_SYNC_KDF_ITERS;
  const candidates = [
    getAuthSyncMaterialV2(user),
    getAuthSyncMaterialLegacy(user),
  ];

  let lastError = null;
  for (const material of candidates) {
    try {
      const unwrapKey = await deriveSyncKeyFromMaterial(material, salt, 'decrypt', iters);
      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, unwrapKey, ciphertext);
      return new TextDecoder().decode(decrypted);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('Не удалось восстановить ключ из облачного бэкапа');
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

function getLocalV2KeyName(uid) {
  return `${E2EE_LOCAL_PREFIX}:${uid}`;
}

function getLegacyLocalKeyName(uid) {
  return `${E2EE_LEGACY_LOCAL_PREFIX}:${uid}`;
}

function readLocalV2Keys(uid) {
  const parsed = parseJsonSafe(localStorage.getItem(getLocalV2KeyName(uid)) || '');
  if (parsed?.uid === uid && parsed?.publicKey && parsed?.privateKey) {
    return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
  }
  return null;
}

function readGlobalLocalV2Keys() {
  const parsed = parseJsonSafe(localStorage.getItem(E2EE_LOCAL_PREFIX) || '');
  if (parsed?.publicKey && parsed?.privateKey) {
    return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
  }
  return null;
}

function writeLocalV2Keys(uid, publicKey, privateKey) {
  localStorage.setItem(getLocalV2KeyName(uid), JSON.stringify({
    version: 2,
    uid,
    publicKey,
    privateKey,
  }));
  localStorage.removeItem(E2EE_LOCAL_PREFIX);
  localStorage.removeItem(E2EE_LEGACY_LOCAL_PREFIX);
}

function readLegacyLocalKeys(uid) {
  const parsed = parseJsonSafe(localStorage.getItem(getLegacyLocalKeyName(uid)) || '');
  if (parsed?.uid === uid && parsed?.publicKey && parsed?.privateKey) {
    return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
  }
  return null;
}

function readGlobalLegacyKeys() {
  const parsed = parseJsonSafe(localStorage.getItem(E2EE_LEGACY_LOCAL_PREFIX) || '');
  if (parsed?.publicKey && parsed?.privateKey) {
    return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
  }
  return null;
}

async function saveKeysToCloud(user, publicKeyB64, privateKeyB64) {
  const backup = await makeCloudBackup(privateKeyB64, user);
  const userRef = window.db.collection('users').doc(user.uid);

  try {
    // ИСПОЛЬЗУЕМ ТРАНЗАКЦИЮ, чтобы избежать Race Condition
    await window.db.runTransaction(async (tx) => {
      const doc = await tx.get(userRef);
      const data = doc.exists ? doc.data() : {};
      
      // 🚨 КРИТИЧЕСКИЙ ФИКС: Если в облаке УЖЕ есть валидный бэкап, 
      // мы НЕ перезаписываем его. Это спасет твои чаты при логине с нового домена.
      if (data.e2eeV2?.wrappedPrivateKey && data.publicKey) {
        console.warn('⚠️ В облаке уже есть бэкап ключей. Пропускаем перезапись, чтобы не потерять доступ к старым чатам.');
        return; // Выходим из транзакции без изменений в БД
      }

      tx.set(userRef, {
        publicKey: publicKeyB64,
        _hasE2EE: true,
        _e2eeVersion: 2,
        e2eeV2: {
          ...backup,
          publicKey: publicKeyB64,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
      }, { merge: true });
    });
  } catch (e) {
    console.error('❌ Ошибка транзакции сохранения ключей:', e);
    // Не пробрасываем ошибку дальше, чтобы не заблокировать работу клиента,
    // но в консоли будет видно, что синхронизация не прошла.
  }
}

function clearLocalKeyCopies(uid) {
  localStorage.removeItem(E2EE_LOCAL_PREFIX);
  localStorage.removeItem(E2EE_LEGACY_LOCAL_PREFIX);
  localStorage.removeItem(getLocalV2KeyName(uid));
  localStorage.removeItem(getLegacyLocalKeyName(uid));
}

async function persistKeys(uid, user, publicKeyB64, privateKeyB64) {
  writeLocalV2Keys(uid, publicKeyB64, privateKeyB64);
  await saveKeysToCloud(user, publicKeyB64, privateKeyB64).catch(err => {
    console.warn('⚠️ Не удалось синхронизировать ключи в облако, остаёмся на локальном кэше:', err);
  });
}

async function getOrCreateKeys() {
  const me = window.auth.currentUser;
  if (!me) throw new Error('Требуется авторизация для E2EE');
  if (cachedMyKeys && cachedMyKeysUid === me.uid) return cachedMyKeys;

  const uid = me.uid;
  const localV2 = readLocalV2Keys(uid);
  const legacy = localV2 ? null : readLegacyLocalKeys(uid);

  try {
    const doc = await window.db.collection('users').doc(me.uid).get();
    const data = doc.exists ? (doc.data() || {}) : {};
    const backup = data.e2eeV2;
    const cloudPublicKey = backup?.publicKey || data.publicKey || null;
    const cloudHasBackup = !!(backup?.wrappedPrivateKey && backup?.iv && backup?.salt && cloudPublicKey);

    if (cloudHasBackup) {
      try {
        const restoredPrivateB64 = await unwrapCloudBackup(backup, me);
        const cloudPair = await importPairFromBase64(cloudPublicKey, restoredPrivateB64);
        writeLocalV2Keys(uid, cloudPublicKey, restoredPrivateB64);
        cachedMyKeys = cloudPair;
        cachedMyKeysUid = uid;
        return cloudPair;
      } catch (e) {
        console.error('❌ КРИТИЧЕСКАЯ ОШИБКА: Не удалось расшифровать облачный бэкап приватного ключа!', e);
        // 🚨 ФИКС: Если бэкап есть, но мы не можем его расшифровать, 
        // мы НЕ генерируем новый ключ. Иначе мы навсегда потеряем старые чаты.
        throw new Error('Не удалось восстановить приватный ключ из облака. Возможно, поврежден бэкап.');
      }
    }

    // 🚨 ФИКС: Если в базе есть публичный ключ, но НЕТ приватного бэкапа.
    if (cloudPublicKey) {
       throw new Error('В базе найден публичный ключ, но нет зашифрованного приватного бэкапа. Восстановление невозможно. Обратитесь к администратору.');
    }

    const migratableGlobalV2 = !localV2 && !legacy ? readGlobalLocalV2Keys() : null;
    const migratableGlobalLegacy = !localV2 && !legacy ? readGlobalLegacyKeys() : null;
    const matchingGlobal = [migratableGlobalV2, migratableGlobalLegacy].find(candidate =>
      candidate && cloudPublicKey && candidate.publicKey === cloudPublicKey
    ) || null;

    const localCandidate = localV2 || legacy || matchingGlobal;
    if (localCandidate) {
      const localPair = await importPairFromBase64(localCandidate.publicKey, localCandidate.privateKey);
      await persistKeys(uid, me, localCandidate.publicKey, localCandidate.privateKey);
      cachedMyKeys = localPair;
      cachedMyKeysUid = uid;
      return localPair;
    }

  } catch (e) {
    // Пробрасываем критические ошибки, чтобы не сгенерировался новый ключ
    if (e.message.includes('Не удалось восстановить') || e.message.includes('Восстановление невозможно')) {
        throw e;
    }
    console.warn('⚠️ Не удалось восстановить ключи из облака, пробуем локальные или создаём новую пару', e);
  }

  // Генерация НОВОЙ пары происходит ТОЛЬКО если мы дошли до сюда.
  // Это значит, что в базе вообще нет публичного ключа (пользователь абсолютно новый).
  const pair = await generateKeyPair();
  const exported = await exportPairToBase64(pair);
  await persistKeys(uid, me, exported.publicKey, exported.privateKey);
  cachedMyKeys = pair;
  cachedMyKeysUid = uid;
  return pair;
}

async function getPublicKey(uid, options = {}) {
  const forceRefresh = !!options.forceRefresh;
  if (currentUser && uid === currentUser.uid) {
    const myKeys = await getOrCreateKeys();
    return myKeys.publicKey;
  }

  if (!forceRefresh && userCache[uid]?.publicKey) return userCache[uid].publicKey;
  if (!forceRefresh && userCache[uid]?.publicKeyB64) {
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
      <button class="chat-header-call-btn" id="chat-call-btn" title="Позвонить">📞</button>
    </div>
    <div class="chat-messages" id="chat-messages"></div>
    <div class="chat-input-area">
      <textarea class="chat-input" id="chat-input" rows="1"
        placeholder="Написать сообщение..."></textarea>
      <div class="chat-actions-wrapper">
        <button class="chat-actions-btn" id="chat-actions-btn" title="Действия">+</button>
        <div class="chat-actions-menu" id="chat-actions-menu">
          <div class="chat-actions-item" id="attach-image-item">
            <span class="chat-actions-icon">🖼️</span>
            <span>Прикрепить изображение</span>
          </div>
          <div class="chat-actions-item" id="snake-duel-item">
            <span class="chat-actions-icon">🐍</span>
            <span>Пригласить на змеиную дуэль</span>
          </div>
        </div>
        <button class="chat-send-btn" id="chat-send-btn">↑</button>
      </div>
    </div>
    <input type="file" id="chat-image-input" accept="image/*" style="display:none;">
  `;
  
  // ── КНОПКА ЗВОНКА В ШАПКЕ ──
  const callBtn = document.getElementById('chat-call-btn');
  if (callBtn) {
    callBtn.addEventListener('click', () => {
      callManager.startCall(otherId, otherName, otherAvatar, cId);
    });
  }

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
  const attachImageItem = document.getElementById('attach-image-item');
  const imageInput = document.getElementById('chat-image-input');

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

    if (attachImageItem && imageInput) {
      attachImageItem.addEventListener('click', () => {
        actionsMenu.classList.remove('open');
        imageInput.click();
      });
      imageInput.addEventListener('change', async () => {
        const file = imageInput.files?.[0];
        imageInput.value = '';
        if (!file) return;
        if (!file.type.startsWith('image/')) {
          alert('Можно прикреплять только изображения.');
          return;
        }
        try {
          const preparedImage = await resizeImageForMessage(file);
          await sendMessage(cId, otherId, otherName, otherAvatar, preparedImage);
        } catch (e) {
          console.error('❌ Image attach failed:', e);
          alert(e.message || 'Не удалось прикрепить изображение.');
        }
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

  let renderToken = 0;

  messagesUnsub = window.db
    .collection('conversations').doc(cId).collection('messages')
    .orderBy('createdAt', 'asc')
    .onSnapshot(async snap => {
      const token = ++renderToken;
      const fragment = document.createDocumentFragment();
      let localLastDate = null;
      let localSafetyDividerShown = false;
      let myKeys = null;

      for (const doc of snap.docs) {
        if (token !== renderToken) return;

        const rawMsg = doc.data();
        const isOwn = rawMsg.senderUid === myUid;

        // ── E2EE: расшифровка ──
        let msgText = rawMsg.text;
        let msgImage = rawMsg.image || null;
        if (isEncryptedMessage(rawMsg)) {
          try {
            if (!myKeys) myKeys = await getOrCreateKeys();
            if (token !== renderToken) return;
            msgText = await decryptE2EE(rawMsg.text, myUid, myKeys.privateKey);
            if (rawMsg.image) {
              msgImage = await decryptE2EE(rawMsg.image, myUid, myKeys.privateKey);
            }
          } catch (e) {
            console.error('❌ Message decrypt error:', e);
            const isLegacyOwnEncrypted = isOwn
              && typeof rawMsg.text === 'string'
              && !rawMsg.text.startsWith('v2:');
            msgText = isLegacyOwnEncrypted
              ? '🔐 Вы отправили защищённое сообщение (старый формат).'
              : '[Не удалось расшифровать сообщение]';
            msgImage = null;
          }
        }

        const msg = { ...rawMsg, text: msgText, image: msgImage };

        const dateStr = formatMsgDate(msg.createdAt);
        if (dateStr !== localLastDate) {
          localLastDate = dateStr;
          const div = document.createElement('div');
          div.className = 'msg-date-divider';
          div.textContent = dateStr;
          fragment.appendChild(div);
        }

        const isV2Message = rawMsg._cryptoVersion === 2
          || (typeof rawMsg.text === 'string' && rawMsg.text.startsWith('v2:'));
        if (!localSafetyDividerShown && isV2Message) {
          localSafetyDividerShown = true;
          const secDiv = document.createElement('div');
          secDiv.className = 'msg-security-divider';
          secDiv.textContent = '🔐 Чат стал безопаснее: теперь используется шифрование с синхронизацией между устройствами.';
          fragment.appendChild(secDiv);
        }

        const senderInfo = userCache[msg.senderUid];
        const senderAva  = senderInfo?.avatar || null;
        const senderName = senderInfo?.name || '?';

        const isSnakeDuelInvite = msg._inviteType === 'snake_duel';
        const canAcceptInvite = !isOwn && isSnakeDuelInvite && msg._inviteeUid === myUid;

        const msgEl = document.createElement('div');
        msgEl.className = `msg ${isOwn ? 'own' : ''}${isSnakeDuelInvite ? ' msg-invite' : ''}`;

        let bubbleContent = '';
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
        } else {
          const hasImage = !!msg.image;
          const hasText = !!String(msg.text || '').trim();
          const imageHtml = hasImage ? `<img class="msg-image" src="${esc(msg.image)}" alt="Изображение из чата" loading="lazy">` : '';
          const textHtml = hasText ? `<div class="msg-text">${esc(msg.text)}</div>` : '';
          bubbleContent = `${imageHtml}${textHtml}`;
        }

        msgEl.innerHTML = `
          <div class="msg-avatar">${avatarHtml(senderAva, senderName, 28)}</div>
          <div class="msg-content">
            <div class="msg-bubble">${bubbleContent}</div>
            <div class="msg-time">${formatMsgTime(msg.createdAt)}</div>
          </div>
        `;
        fragment.appendChild(msgEl);
      }

      if (token !== renderToken) return;
      container.innerHTML = '';
      container.appendChild(fragment);
      scrollChatToBottom(container);
    }, err => {
      console.error('❌ Messages:', err);
    });
}

// ─── SEND MESSAGE ─────────────────────────────────────────────────────────────

async function sendMessage(cId, otherId, otherName, otherAvatar, attachment = null) {
  const inputEl = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send-btn');
  if (!inputEl) return;

  const text = inputEl.value.trim();
  const imageDataUrl = attachment?.dataUrl || null;
  if (!text && !imageDataUrl) return;

  // Все текстовые сообщения шифруем в новом режиме (v2)
  let encryptedText = text;
  let encryptedImage = imageDataUrl;
  let isEncrypted   = false;
  let cryptoVersion = 0;

  try {
    const myKeys = await getOrCreateKeys();
    const otherPublicKey = await getPublicKey(otherId, { forceRefresh: true });

    if (!otherPublicKey) {
      alert('Пользователь ещё не инициализировал защищённый чат. Попросите его открыть сообщения и повторите отправку.');
      return;
    }

    if (text) {
      encryptedText = await encryptE2EE(text, currentUser.uid, myKeys.publicKey, otherId, otherPublicKey);
    }
    if (imageDataUrl) {
      encryptedImage = await encryptE2EE(imageDataUrl, currentUser.uid, myKeys.publicKey, otherId, otherPublicKey);
    }

    const approxCipherSize = (encryptedText?.length || 0) + (encryptedImage?.length || 0);
    if (approxCipherSize > 930000) {
      alert('Изображение получилось слишком большим для отправки. Попробуйте файл поменьше.');
      return;
    }

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
        image: encryptedImage || null,
        _hasImage: !!imageDataUrl,
        imageW: attachment?.width || null,
        imageH: attachment?.height || null,
        imageMime: attachment?.mime || null,
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
        lastMessage: imageDataUrl
          ? (text ? '🖼️ Изображение и текст' : '🖼️ Изображение')
          : (isEncrypted ? '🔐 Зашифрованное сообщение' : text),
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
    const otherPublicKey = await getPublicKey(otherId, { forceRefresh: true });
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
      callManager.subscribeIncoming(user.uid);
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

// ═══════════════════════════════════════════════════════════
// 📞 CALLS — WebRTC (оптимизированный для Firestore)
// ═══════════════════════════════════════════════════════════

class CallManager {
  constructor() {
    this.currentCall = null;
    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;
    this.signalListener = null;
    this.incomingListener = null;
    this.callTimeout = null;
    this.sounds = {};
    this.soundsLoaded = false;
    this.callStartTime = null;
    this.callTimerInterval = null;
    this.processedIceCandidates = new Set();
    this.answerProcessed = false; // 🆕 Защита от повторной установки answer
    this.isEnding = false; // 🆕 Защита от зацикливания endCall
  }

  loadSounds() {
    if (this.soundsLoaded) return;
    this.sounds = {
      outgoing:     new Audio('sound/call_outgoing.ogg'),
      incoming:     new Audio('sound/call_incoming.ogg'),
      connected:    new Audio('sound/call_connected.ogg'),
      disconnected: new Audio('sound/call_disconnected.ogg'),
      busy:         new Audio('sound/call_busy.ogg'),
      mute:         new Audio('sound/call_mute_toggle.ogg'),
    };
    this.sounds.outgoing.loop = true;
    this.sounds.incoming.loop = true;
    this.soundsLoaded = true;
  }

  playSound(name) {
    this.loadSounds();
    const s = this.sounds[name];
    if (!s) return;
    s.currentTime = 0;
    s.play().catch(e => console.warn('Audio play blocked:', e));
  }

  stopSound(name) {
    const s = this.sounds[name];
    if (!s) return;
    s.pause();
    s.currentTime = 0;
  }

  stopAllSounds() {
    Object.keys(this.sounds).forEach(k => this.stopSound(k));
  }

  getIceConfig() {
    return {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
      ]
    };
  }

  // ── ИСХОДЯЩИЙ ЗВОНОК ─────────────────────────────────────
  async startCall(otherUid, otherName, otherAvatar, convId) {
    if (this.currentCall) {
      alert('У вас уже идёт звонок. Завершите текущий.');
      return;
    }

    this.isEnding = false;
    this.answerProcessed = false;

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (err) {
      alert('Не удалось получить доступ к микрофону: ' + err.message);
      return;
    }

    const callId = window.db.collection('calls').doc().id;

    this.peerConnection = new RTCPeerConnection(this.getIceConfig());
    this.currentCall = { callId, otherUid, otherName, otherAvatar, convId, isInitiator: true };
    this.processedIceCandidates.clear();

    this.localStream.getTracks().forEach(track => {
      this.peerConnection.addTrack(track, this.localStream);
    });

    this.peerConnection.ontrack = (event) => {
      console.log('🎵 Remote track received');
      this.remoteStream = event.streams[0];
      this.stopSound('outgoing');
      this.playSound('connected');
      this.startCallTimer();
      this.showActiveCallUI(this.currentCall.otherName, this.currentCall.otherAvatar, true);
      this.playRemoteAudio(); // ← теперь элемент уже в DOM
    };

    this.peerConnection.onicecandidate = async (event) => {
      if (event.candidate) {
        try {
          await window.db.collection('calls').doc(callId).update({
            iceCandidates: firebase.firestore.FieldValue.arrayUnion({
              from: currentUser.uid,
              candidate: event.candidate.toJSON(),
            }),
          });
        } catch (e) {
          console.warn('Failed to send ICE:', e);
        }
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection.connectionState;
      console.log('Connection state:', state);
      if ((state === 'disconnected' || state === 'failed' || state === 'closed') && !this.isEnding) {
        this.endCall();
      }
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection.iceConnectionState;
      console.log('ICE state:', state);
      if (state === 'failed') {
        this.peerConnection?.restartIce();
      }
    };

    try {
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      await window.db.collection('calls').doc(callId).set({
        status: 'ringing',
        type: 'audio',
        initiatorUid: currentUser.uid,
        initiatorName: userCache[currentUser.uid]?.name || currentUser.displayName || 'Звонок',
        initiatorAvatar: userCache[currentUser.uid]?.avatar || null,
        receiverUid: otherUid,
        receiverName: otherName,
        receiverAvatar: otherAvatar,
        conversationId: convId,
        startedAt: firebase.firestore.FieldValue.serverTimestamp(),
        offer: { type: offer.type, sdp: offer.sdp },
        iceCandidates: [],
      });

      this.subscribeToCallDoc(callId);
      this.showOutgoingCallUI(otherName, otherAvatar);
      this.playSound('outgoing');

      this.callTimeout = setTimeout(() => {
        if (this.currentCall && this.currentCall.callId === callId && !this.isEnding) {
          this.endCall('missed');
        }
      }, 30000);

    } catch (err) {
      console.error('Create offer failed:', err);
      this.cleanup();
      alert('Не удалось установить соединение: ' + err.message);
    }
  }

  async answerCall(callId, callData) {
    if (this.currentCall) {
      await this.rejectCall(callId, 'busy');
      return;
    }

    this.isEnding = false;
    this.answerProcessed = false;

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (err) {
      alert('Не удалось получить доступ к микрофону: ' + err.message);
      await this.rejectCall(callId, 'no-permission');
      return;
    }

    this.peerConnection = new RTCPeerConnection(this.getIceConfig());
    this.currentCall = {
      callId,
      otherUid: callData.initiatorUid,
      otherName: callData.initiatorName,
      otherAvatar: callData.initiatorAvatar,
      convId: callData.conversationId,
      isInitiator: false,
    };
    this.processedIceCandidates.clear();

    this.localStream.getTracks().forEach(track => {
      this.peerConnection.addTrack(track, this.localStream);
    });

    this.peerConnection.ontrack = (event) => {
      console.log('🎵 Remote track received');
      this.remoteStream = event.streams[0];
      this.stopSound('outgoing');
      this.playSound('connected');
      this.startCallTimer();
      this.showActiveCallUI(this.currentCall.otherName, this.currentCall.otherAvatar, true);
      this.playRemoteAudio(); // ← теперь элемент уже в DOM
    };

    this.peerConnection.onicecandidate = async (event) => {
      if (event.candidate) {
        try {
          await window.db.collection('calls').doc(callId).update({
            iceCandidates: firebase.firestore.FieldValue.arrayUnion({
              from: currentUser.uid,
              candidate: event.candidate.toJSON(),
            }),
          });
        } catch (e) {
          console.warn('Failed to send ICE:', e);
        }
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection.connectionState;
      console.log('Connection state:', state);
      if ((state === 'disconnected' || state === 'failed' || state === 'closed') && !this.isEnding) {
        this.endCall();
      }
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection.iceConnectionState;
      console.log('ICE state:', state);
      if (state === 'failed') {
        this.peerConnection?.restartIce();
      }
    };

    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(callData.offer));
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      await window.db.collection('calls').doc(callId).update({
        status: 'answered',
        connectedAt: firebase.firestore.FieldValue.serverTimestamp(),
        answer: { type: answer.type, sdp: answer.sdp },
      });

      this.subscribeToCallDoc(callId);
      this.hideIncomingCallUI();
      this.stopSound('incoming');
      this.showActiveCallUI(callData.initiatorName, callData.initiatorAvatar, false);

    } catch (err) {
      console.error('Answer failed:', err);
      this.cleanup();
    }
  }

  async rejectCall(callId, reason = 'rejected') {
    if (this.isEnding) return;
    this.isEnding = true;
    
    try {
      await window.db.collection('calls').doc(callId).update({
        status: reason === 'busy' ? 'busy' : 'rejected',
        endedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) {
      console.warn('Reject update failed:', e);
    }
    this.hideIncomingCallUI();
    if (reason === 'busy') this.playSound('busy');
    else this.playSound('disconnected');
    this.cleanup();
  }

  async endCall(reason = 'ended') {
    if (!this.currentCall || this.isEnding) return; // 🆕 Защита от зацикливания
    
    this.isEnding = true; // 🆕 Устанавливаем флаг

    const { callId, convId, otherUid, otherName } = this.currentCall;

    clearTimeout(this.callTimeout);
    this.stopAllSounds();
    this.playSound('disconnected');
    this.stopCallTimer();

    const duration = this.callStartTime ? Math.floor((Date.now() - this.callStartTime) / 1000) : 0;

    try {
      await window.db.collection('calls').doc(callId).update({
        status: reason,
        endedAt: firebase.firestore.FieldValue.serverTimestamp(),
        duration: duration,
      });

      if (convId && reason !== 'rejected' && reason !== 'missed' && this.callStartTime) {
        const convRef = window.db.collection('conversations').doc(convId);
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        const durationText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        
        const callRecord = {
          callId: callId,
          type: 'audio',
          initiatorUid: this.currentCall.isInitiator ? currentUser.uid : otherUid,
          status: reason,
          startedAt: firebase.firestore.Timestamp.fromDate(new Date(Date.now() - duration * 1000)),
          duration: duration,
          durationText: durationText,
        };

        await convRef.set({
          lastMessage: `📞 Звонок (${durationText})`,
          lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
          calls: firebase.firestore.FieldValue.arrayUnion(callRecord),
        }, { merge: true });

        const convSnap = await convRef.get();
        const calls = convSnap.data()?.calls || [];
        if (calls.length > 50) {
          const recentCalls = calls.slice(-50);
          await convRef.update({ calls: recentCalls });
        }
      }

      await window.db.collection('calls').doc(callId).delete();

    } catch (e) {
      console.warn('End call error:', e);
    }

    this.cleanup();
    this.hideCallUI();
  }

  subscribeToCallDoc(callId) {
  this.signalListener?.();

  this.signalListener = window.db.collection('calls').doc(callId)
    .onSnapshot(async (doc) => {
      if (!doc.exists || this.isEnding) return;
      
      const data = doc.data();
      
      // 🎯 Обработка answer (только ОДИН раз для инициатора)
      if (data.answer && this.currentCall?.isInitiator) {
        // Проверяем состояние ДО попытки установки
        if (this.peerConnection && this.peerConnection.signalingState === 'have-local-offer') {
          try {
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            console.log('✅ Answer установлен успешно');
            clearTimeout(this.callTimeout);
          } catch (e) {
            console.error('❌ Ошибка установки answer:', e.message);
          }
        } else {
          // Answer уже установлен или состояние неправильное — просто логируем
          console.log('ℹ️ Answer уже установлен или состояние:', this.peerConnection?.signalingState);
        }
      }

      // Обработка ICE candidates
      if (data.iceCandidates && Array.isArray(data.iceCandidates)) {
        for (const ice of data.iceCandidates) {
          if (ice.from === currentUser.uid) continue;
          
          const iceKey = `${ice.from}-${JSON.stringify(ice.candidate)}`;
          if (this.processedIceCandidates.has(iceKey)) continue;
          
          try {
            const candidate = new RTCIceCandidate(ice.candidate);
            await this.peerConnection.addIceCandidate(candidate);
            this.processedIceCandidates.add(iceKey);
            console.log('✅ ICE candidate добавлен от', ice.from);
          } catch (e) {
            console.warn('⚠️ Не удалось добавить ICE candidate:', e.message);
          }
        }
      }

      // Обработка завершения звонка другой стороной
      if (['ended', 'rejected', 'busy', 'missed', 'canceled'].includes(data.status) && !this.isEnding) {
        console.log('📞 Звонок завершён другой стороной:', data.status);
        this.endCall(data.status);
      }
    }, err => console.error('❌ Call doc listener error:', err));
}

  // ── ПОДПИСКА НА ВХОДЯЩИЕ ЗВОНКИ ─────────────────────────
  subscribeIncoming(myUid) {
    this.incomingListener?.();

    this.incomingListener = window.db.collection('calls')
      .where('receiverUid', '==', myUid)
      .where('status', '==', 'ringing')
      .onSnapshot(async (snap) => {
        for (const doc of snap.docs) {
          const data = doc.data();
          if (data._shown) continue;
          try {
            await doc.ref.update({ _shown: true });
          } catch (e) {}
          this.showIncomingCallUI(doc.id, data);
          this.playSound('incoming');
        }
      }, err => console.error('Incoming calls error:', err));
  }

  // ── УПРАВЛЕНИЕ АУДИО ─────────────────────────────────────
  toggleMute() {
    if (!this.localStream) return;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (!audioTrack) return;
    audioTrack.enabled = !audioTrack.enabled;
    this.playSound('mute');
    const muteBtn = document.getElementById('call-mute-btn');
    if (muteBtn) {
      muteBtn.textContent = audioTrack.enabled ? '🎙️' : '🔇';
      muteBtn.title = audioTrack.enabled ? 'Выключить микрофон' : 'Включить микрофон';
    }
  }

  playRemoteAudio() {
    if (!this.remoteStream) return;
    const audioEl = document.getElementById('call-remote-audio');
    if (audioEl) {
      audioEl.srcObject = this.remoteStream;
      audioEl.play().catch(e => console.warn('Remote audio play:', e));
    }
  }

  startCallTimer() {
    this.callStartTime = Date.now();
    this.callTimerInterval = setInterval(() => {
      const sec = Math.floor((Date.now() - this.callStartTime) / 1000);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      const timerEl = document.getElementById('call-timer');
      if (timerEl) timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    }, 1000);
  }

  stopCallTimer() {
    clearInterval(this.callTimerInterval);
    this.callTimerInterval = null;
  }

  cleanup() {
    this.localStream?.getTracks().forEach(t => t.stop());
    this.localStream = null;
    this.remoteStream = null;
    this.peerConnection?.close();
    this.peerConnection = null;
    this.signalListener?.();
    this.signalListener = null;
    this.currentCall = null;
    clearTimeout(this.callTimeout);
    this.stopCallTimer();
    this.processedIceCandidates.clear();
    this.answerProcessed = false; // 🆕 Сбрасываем флаг
    // НЕ сбрасываем isEnding здесь, он сбрасывается в startCall/answerCall
  }

  // ── UI (без изменений) ───────────────────────────────────
  showOutgoingCallUI(otherName, otherAvatar) {
    const overlay = document.getElementById('call-overlay');
    if (!overlay) return;
    overlay.innerHTML = `
      <div class="call-modal call-outgoing">
        <div class="call-avatar-big">${avatarHtml(otherAvatar, otherName, 96)}</div>
        <div class="call-name">${esc(otherName)}</div>
        <div class="call-status" id="call-status">Вызов...</div>
        <div class="call-actions">
          <button class="call-action-btn call-end-btn" id="call-end-btn" title="Завершить">📞</button>
        </div>
      </div>
    `;
    overlay.classList.add('active');
    document.getElementById('call-end-btn').addEventListener('click', () => this.endCall('canceled'));
  }

  showActiveCallUI(otherName, otherAvatar, isInitiator) {
    const overlay = document.getElementById('call-overlay');
    if (!overlay) return;
    overlay.innerHTML = `
      <div class="call-modal call-active">
        <div class="call-avatar-big">${avatarHtml(otherAvatar, otherName, 96)}</div>
        <div class="call-name">${esc(otherName)}</div>
        <div class="call-timer" id="call-timer">0:00</div>
        <div class="call-actions">
          <button class="call-action-btn" id="call-mute-btn" title="Выключить микрофон">🎙️</button>
          <button class="call-action-btn call-end-btn" id="call-end-btn" title="Завершить">📞</button>
        </div>
        <audio id="call-remote-audio" autoplay playsinline></audio>
      </div>
    `;
    overlay.classList.add('active');
    document.getElementById('call-mute-btn').addEventListener('click', () => this.toggleMute());
    document.getElementById('call-end-btn').addEventListener('click', () => this.endCall());
    if (this.callStartTime) this.startCallTimer();

    if (this.remoteStream) this.playRemoteAudio(); // ← страховка
  }

  hideCallUI() {
    const overlay = document.getElementById('call-overlay');
    if (overlay) overlay.classList.remove('active');
  }

  showIncomingCallUI(callId, data) {
    this.loadSounds();
    let modal = document.getElementById('call-incoming-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'call-incoming-modal';
      modal.className = 'call-incoming-overlay';
      document.body.appendChild(modal);
    }
    modal.innerHTML = `
      <div class="call-modal call-incoming">
        <div class="call-avatar-big">${avatarHtml(data.initiatorAvatar, data.initiatorName, 96)}</div>
        <div class="call-name">${esc(data.initiatorName)}</div>
        <div class="call-status">Входящий звонок...</div>
        <div class="call-actions">
          <button class="call-action-btn call-reject-btn" id="call-reject-btn" title="Отклонить">❌</button>
          <button class="call-action-btn call-answer-btn" id="call-answer-btn" title="Принять">✅</button>
        </div>
      </div>
    `;
    modal.classList.add('active');
    document.getElementById('call-answer-btn').addEventListener('click', async () => {
      this.hideIncomingCallUI();
      await this.answerCall(callId, data);
    });
    document.getElementById('call-reject-btn').addEventListener('click', () => {
      this.stopSound('incoming');
      this.rejectCall(callId);
    });
  }

  hideIncomingCallUI() {
    const modal = document.getElementById('call-incoming-modal');
    if (modal) modal.classList.remove('active');
  }
}

const callManager = new CallManager();