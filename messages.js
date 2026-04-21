/**
 * 💬 Direct Messages — EgorNetwork
 *
 * Firestore:
 *   conversations/{convId}          — мета-документ
 *     participants: [uid1, uid2]
 *     participantNames: {uid: name}
 *     participantAvatars: {uid: base64|letter}
 *     lastMessage: string
 *     lastMessageAt: Timestamp
 *     unread: {uid: number}
 *
 *   conversations/{convId}/messages/{msgId}
 *     senderUid: string
 *     text: string
 *     createdAt: Timestamp
 *     read: boolean
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
let userCache      = {};  // uid → {name, avatar}

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
  const otherAva  = conv.participantAvatars?.[otherId] || null;
  const unread    = conv.unread?.[myUid] || 0;
  const preview   = conv.lastMessage
    ? (conv.lastMessage.length > 35 ? conv.lastMessage.slice(0, 35) + '…' : conv.lastMessage)
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
      // Обновляем badge в хедере
      updateMsgBadge(myUid);
    }, err => {
      console.error('❌ Conversations:', err);
    });
}

// ─── OPEN CONVERSATION ────────────────────────────────────────────────────────

function openConversation(cId, otherId, otherName, otherAvatar) {
  activeConvId = cId;

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
      <a class="chat-header-link" href="profile.html?uid=${encodeURIComponent(otherId)}">👤 Профиль</a>
    </div>
    <div class="chat-messages" id="chat-messages"></div>
    <div class="chat-input-area">
      <textarea class="chat-input" id="chat-input" rows="1"
        placeholder="Написать сообщение..."></textarea>
      <button class="chat-send-btn" id="chat-send-btn">↑</button>
    </div>
  `;

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
    .onSnapshot(snap => {
      container.innerHTML = '';
      lastDate = null;

      snap.forEach(doc => {
        const msg  = doc.data();
        const isOwn = msg.senderUid === myUid;

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
          <div>
            <div class="msg-bubble">${esc(msg.text)}</div>
            <div class="msg-time">${formatMsgTime(msg.createdAt)}</div>
          </div>
        `;
        container.appendChild(msgEl);
      });

      // Скролл вниз
      container.scrollTop = container.scrollHeight;
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

  sendBtn.disabled = true;
  inputEl.value = '';
  inputEl.style.height = 'auto';

  try {
    const me = currentUser;

    // Обновляем кэш своего пользователя
    if (!userCache[me.uid]) await getUser(me.uid);

    const batch = window.db.batch();

    // Само сообщение
    const msgRef = window.db
      .collection('conversations').doc(cId)
      .collection('messages').doc();
    batch.set(msgRef, {
      senderUid: me.uid,
      text,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      read: false,
    });

    // Мета-документ диалога
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

  // Поиск пользователей по имени
  let searchTimeout;
  search.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const q = search.value.trim();
    if (!q || q.length < 2) { results.innerHTML = ''; return; }

    searchTimeout = setTimeout(async () => {
      if (errEl) errEl.textContent = '';
      try {
        // Простой поиск по prefixу имени
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
          if (doc.id === currentUser.uid) return; // не показываем себя
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
            await getUser(currentUser.uid); // кэшируем себя
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

  // Открываем диалог из URL (?with=uid)
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
  getUser(myUid); // кэшируем себя сразу
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