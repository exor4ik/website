/**
 * 📰 Firebase Posts System — EgorNetwork
 * Структура Firestore: posts/{postId}
 *   - title: string
 *   - text: string
 *   - author: string
 *   - authorUid: string
 *   - createdAt: Timestamp
 *   - reactions: { '👍': [uid, ...], '👎': [uid, ...], '❤️': [uid, ...], '🔥': [uid, ...], '😂': [uid, ...], '😮': [uid, ...] }
 */

'use strict';

const REACTIONS = ['👍', '👎', '❤️', '🔥', '😂', '😮'];

const REACTIONS_SVG = {
  '👍': `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-0.125em">
    <path d="M7 10v12"/>
    <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88z"/>
  </svg>`,

  '👎': `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-0.125em">
    <path d="M17 14V2"/>
    <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88z"/>
  </svg>`,

  '❤️': `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true" style="vertical-align:-0.125em"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,

  '🔥': `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-0.125em"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`,

  '😂': `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-0.125em">
    <circle cx="12" cy="12" r="10"/>
    <path d="M7.5 15.5s1.5 2.5 4.5 2.5 4.5-2.5 4.5-2.5"/>
    <path d="M8.5 9.5c.4-.8 1.6-.8 2 0"/>
    <path d="M13.5 9.5c.4-.8 1.6-.8 2 0"/>
    <path d="M6 8.5 4.5 11.5"/>
    <path d="M18 8.5 19.5 11.5"/>
  </svg>`,

  '😮': `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-0.125em"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="16" r="2" fill="currentColor"/><line x1="8" y1="10" x2="8.01" y2="10" stroke-width="3" stroke-linecap="round"/><line x1="16" y1="10" x2="16.01" y2="10" stroke-width="3" stroke-linecap="round"/></svg>`
};

function waitForPostsFirebase(callback, maxAttempts = 20) {
  let attempts = 0;
  const check = () => {
    attempts++;
    if (window.db && window.auth) { callback(); }
    else if (attempts < maxAttempts) { setTimeout(check, 300); }
    else { console.warn('⚠️ Posts: Firebase не стал доступен'); }
  };
  check();
}

// ============================================================================
// 📅 ФОРМАТИРОВАНИЕ ДАТЫ
// ============================================================================

function formatPostDate(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ============================================================================
// 🎨 РЕНДЕР ПОСТА + ⚡ РЕАКЦИИ
// ============================================================================

function renderReactions(postId, reactions, myUid) {
  return REACTIONS.map(emoji => {
    const users = reactions?.[emoji] || [];
    const count = users.length;
    const active = myUid && users.includes(myUid);
    return `<button class="reaction-btn ${active ? 'active' : ''}"
      data-emoji="${emoji}" data-post="${postId}"
      title="${emoji}">
      ${REACTIONS_SVG[emoji] ?? emoji}${count > 0 ? `<span class="reaction-count">${count}</span>` : ''}
    </button>`;
  }).join('');
}

async function toggleReaction(postId, emoji) {
  const user = window.auth?.currentUser;
  if (!user) {
    alert('Войдите, чтобы поставить реакцию.');
    return;
  }
  const ref = window.db.collection('posts').doc(postId);
  const field = `reactions.${emoji}`;
  try {
    const doc = await ref.get();
    const users = doc.data()?.reactions?.[emoji] || [];
    if (users.includes(user.uid)) {
      await ref.update({ [field]: firebase.firestore.FieldValue.arrayRemove(user.uid) });
    } else {
      await ref.update({ [field]: firebase.firestore.FieldValue.arrayUnion(user.uid) });
    }
  } catch (err) {
    console.error('❌ Реакция:', err);
  }
}

function bindReactions(article) {
  article.querySelectorAll('.reaction-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      toggleReaction(btn.dataset.post, btn.dataset.emoji);
    });
  });
}

function renderPost(doc) {
  const data   = doc.data();
  const postId = doc.id;
  const isAdmin = RoleManager && RoleManager.hierarchy[RoleManager.currentRole] >= 4;

  const article = document.createElement('article');
  article.className = 'fade blog-post card-2';
  article.dataset.postId = postId;

  article.innerHTML = `
    <div class="blog-post-header">
      <h3>${escapeHtml(data.title)}</h3>
      <div style="display:flex;align-items:center;gap:10px;">
        <span class="blog-date">${formatPostDate(data.createdAt)}</span>
        ${isAdmin ? `<button class="post-delete-btn" title="Удалить пост" style="
          padding:4px 10px;border-radius:6px;border:1px solid rgba(255,100,100,.3);
          background:rgba(255,100,100,.1);color:#ff6b6b;font-size:.85rem;
          cursor:pointer;transition:all .3s;
        "><svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg> Удалить</button>` : ''}
      </div>
    </div>
    <p style="color:#aaa;margin:12px 0;white-space:pre-wrap;">${escapeHtml(data.text)}</p>

    <!-- Реакции -->
    <div class="reactions-row" id="reactions-${postId}">
      ${renderReactions(postId, data.reactions, window.auth?.currentUser?.uid)}
    </div>

    <!-- Секция комментариев -->
    <div class="comments-section">
      <button class="comments-toggle" onclick="toggleComments(this)">
        <span class="comments-toggle-icon">▶</span>
        <span>Комментарии (0)</span>
      </button>
      <div class="comments-list"></div>
      <div class="comment-form role-user" style="display:${isUserLoggedIn() ? '' : 'none'};">
        <div class="comment-avatar" style="background:var(--accent);">${getAvatarLetter()}</div>
        <input type="text" placeholder="Написать комментарий..." class="comment-input">
        <button class="btn comment-submit">Отправить</button>
      </div>
      <div class="role-guest-msg" style="display:${isUserLoggedIn() ? 'none' : 'block'};padding:12px;color:#aaa;font-size:.9rem;">
        <a href="#" style="color:var(--accent);text-decoration:none;"
           onclick="document.querySelector('.auth-btn')?.click();return false;">Войдите</a>, чтобы оставлять комментарии.
      </div>
    </div>
  `;

  // Кнопка удаления поста (только для админа)
  if (isAdmin) {
    article.querySelector('.post-delete-btn')?.addEventListener('click', () => {
      deletePost(postId, article);
    });
    article.querySelector('.post-delete-btn')?.addEventListener('mouseenter', (e) => {
      e.target.style.background = 'rgba(255,100,100,.3)';
    });
    article.querySelector('.post-delete-btn')?.addEventListener('mouseleave', (e) => {
      e.target.style.background = 'rgba(255,100,100,.1)';
    });
  }

  // Реакции
  bindReactions(article);

  return article;
}

function isUserLoggedIn() {
  return !!window.auth?.currentUser;
}

function getAvatarLetter() {
  const user = window.auth?.currentUser;
  if (!user) return 'U';
  return (user.displayName || user.email || 'U')[0].toUpperCase();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ============================================================================
// 🗑️ УДАЛЕНИЕ ПОСТА
// ============================================================================

async function deletePost(postId, articleEl) {
  if (!confirm('Удалить этот пост? Комментарии останутся в базе.')) return;

  articleEl.style.cssText += 'opacity:0;transform:translateY(-10px);transition:.4s;';

  try {
    await window.db.collection('posts').doc(postId).delete();
    setTimeout(() => articleEl.remove(), 400);
  } catch (err) {
    console.error('❌ Удаление поста:', err);
    articleEl.style.cssText = articleEl.style.cssText
      .replace('opacity:0;transform:translateY(-10px);transition:.4s;', '');
    alert('Не удалось удалить пост.');
  }
}

// ============================================================================
// 📡 ЗАГРУЗКА ПОСТОВ С REAL-TIME ОБНОВЛЕНИЕМ
// ============================================================================

function initPostsStream() {
  const container = document.getElementById('posts-container');
  if (!container) {
    console.warn('⚠️ Posts: #posts-container не найден');
    return;
  }

  container.innerHTML = '<p style="color:var(--muted);padding:20px 0;">Загрузка постов...</p>';

  let postsRendered = false; // флаг первого рендера

  window.db.collection('posts')
    .orderBy('createdAt', 'desc')
    .onSnapshot(
      (snapshot) => {

        // ── После первого рендера обрабатываем только изменения ──
        if (postsRendered) {
          snapshot.docChanges().forEach(change => {
            const myUid = window.auth?.currentUser?.uid;

            if (change.type === 'modified') {
              // Обновляем реакции без перерисовки поста
              const row = document.getElementById(`reactions-${change.doc.id}`);
              if (row) {
                row.innerHTML = renderReactions(change.doc.id, change.doc.data().reactions, myUid);
                bindReactions(row.closest('article'));
              }
            } else if (change.type === 'added') {
              // Новый пост — добавляем в начало
              const articleEl = renderPost(change.doc);
              container.prepend(articleEl);
              setupPost(articleEl);
              requestAnimationFrame(() => requestAnimationFrame(() => articleEl.classList.add('visible')));
            } else if (change.type === 'removed') {
              document.querySelector(`[data-post-id="${change.doc.id}"]`)?.remove();
            }
          });
          return;
        }

        // ── Первый рендер ──
        postsRendered = true;
        container.innerHTML = '';

        if (snapshot.empty) {
          container.innerHTML = '<p style="color:var(--muted);padding:20px 0;">Постов пока нет. Будьте первым!</p>';
          return;
        }

        snapshot.forEach(doc => {
          const articleEl = renderPost(doc);
          container.appendChild(articleEl);

          // Подключаем комментарии к каждому посту
          if (window.BlogComments) {
            window.BlogComments.setupPostComments(articleEl);
          } else {
            // BlogComments ещё не готов — ждём
            const wait = setInterval(() => {
              if (window.BlogComments) {
                clearInterval(wait);
                window.BlogComments.setupPostComments(articleEl);
              }
            }, 100);
          }

          // Запускаем fade-анимацию
          requestAnimationFrame(() => {
            requestAnimationFrame(() => articleEl.classList.add('visible'));
          });
        });

        // Обновляем тилт-эффект для новых карточек (если initCardTilt доступен)
        if (typeof initCardTilt === 'function') initCardTilt();

        // Обновляем видимость элементов ролей
        if (window.RoleManager) RoleManager.applyUI();
      },
      (err) => {
        console.error('❌ Загрузка постов:', err);
        container.innerHTML = '<p style="color:#ff6b6b;padding:20px 0;">Не удалось загрузить посты.</p>';
      }
    );
}

// ============================================================================
// 📝 ПУБЛИКАЦИЯ ПОСТА (только для админа)
// ============================================================================

function initPublishForm() {
  const publishBtn   = document.getElementById('publish-btn');
  const titleInput   = document.getElementById('post-title-input');
  const textInput    = document.getElementById('post-text-input');
  const publishError = document.getElementById('publish-error');

  if (!publishBtn) return;

  publishBtn.addEventListener('click', async () => {
    const title = titleInput?.value.trim();
    const text  = textInput?.value.trim();

    if (!title || !text) {
      if (publishError) publishError.textContent = 'Заполните заголовок и текст.';
      return;
    }

    const user = window.auth?.currentUser;
    if (!user) {
      if (publishError) publishError.textContent = 'Вы не авторизованы.';
      return;
    }

    publishBtn.disabled = true;
    publishBtn.textContent = 'Публикую...';
    if (publishError) publishError.textContent = '';

    try {
      await window.db.collection('posts').add({
        title,
        text,
        author:    user.displayName || user.email,
        authorUid: user.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      // Очищаем форму
      if (titleInput) titleInput.value = '';
      if (textInput)  textInput.value  = '';

      // Закрываем панель управления
      document.getElementById('admin-panel')?.classList.remove('active');

      console.log('✅ Пост опубликован');
    } catch (err) {
      console.error('❌ Публикация:', err);
      if (publishError) publishError.textContent = 'Ошибка публикации: ' + err.message;
    } finally {
      publishBtn.disabled = false;
      publishBtn.textContent = 'Опубликовать';
    }
  });
}

// ============================================================================
// 🚀 ИНИЦИАЛИЗАЦИЯ
// ============================================================================

waitForPostsFirebase(() => {
  window.auth.onAuthStateChanged((user) => {
    // Ждём, пока RoleManager применит роли
    setTimeout(() => {
      initPostsStream();
      if (user) initPublishForm();
    }, 300);
  });
});