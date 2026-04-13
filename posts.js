/**
 * 📰 Firebase Posts System — EgorNetwork
 * Структура Firestore: posts/{postId}
 *   - title: string
 *   - text: string
 *   - author: string
 *   - authorUid: string
 *   - createdAt: Timestamp
 */

'use strict';

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
// 🎨 РЕНДЕР ПОСТА
// ============================================================================

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
        ">🗑️ Удалить</button>` : ''}
      </div>
    </div>
    <p style="color:#aaa;margin:12px 0;white-space:pre-wrap;">${escapeHtml(data.text)}</p>

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

  window.db.collection('posts')
    .orderBy('createdAt', 'desc')
    .onSnapshot(
      (snapshot) => {
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