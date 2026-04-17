/**
 * 💬 Firebase Comments System — EgorNetwork
 * Структура Firestore: comments/{postId}/items/{commentId}
 */

'use strict';

function waitForFirebase(callback, maxAttempts = 20) {
  let attempts = 0;
  const check = () => {
    attempts++;
    if (window.db && window.auth) { callback(); }
    else if (attempts < maxAttempts) { setTimeout(check, 300); }
    else { console.warn('⚠️ Comments: Firebase не стал доступен'); }
  };
  check();
}

function formatTime(timestamp) {
  if (!timestamp) return 'только что';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const now  = new Date();
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60)     return 'только что';
  if (diff < 3600)   return `${Math.floor(diff / 60)} мин. назад`;
  if (diff < 86400)  return `${Math.floor(diff / 3600)} ч. назад`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} дн. назад`;
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function renderComment(doc, postId) {
  const data  = doc.data();
  const isMod = RoleManager && RoleManager.hierarchy[RoleManager.currentRole] >= 3;

  const div = document.createElement('div');
  div.className = 'comment';
  div.dataset.commentId = doc.id;
  const avatarContent = data.avatar
    ? `<img src="${data.avatar}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:10px;">`
    : (data.avatar || data.author?.[0]?.toUpperCase() || '?');

  div.innerHTML = `
    <div class="comment-avatar" style="overflow:hidden;">${avatarContent}</div>
    <div class="comment-body">
      <div class="comment-header">
        <a class="comment-author" href="profile.html?uid=${encodeURIComponent(data.uid || '')}"
           style="color:#fff;text-decoration:none;transition:color .2s;"
           onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='#fff'"
        >${escapeHtml(data.author)}</a>
        <span class="comment-time">${formatTime(data.createdAt)}</span>
      </div>
      <p class="comment-text">${escapeHtml(data.text)}</p>
    </div>
    ${isMod ? `<button class="comment-delete role-mod" title="Удалить">&times;</button>` : ''}
  `;

  if (isMod) {
    div.querySelector('.comment-delete').addEventListener('click', () =>
      deleteComment(postId, doc.id, div)
    );
  }
  return div;
}

function subscribeToComments(postEl) {
  const postId    = postEl.dataset.postId;
  const list      = postEl.querySelector('.comments-list');
  const toggleBtn = postEl.querySelector('.comments-toggle');
  if (!postId || !list) return;

  list.innerHTML = '<div style="padding:12px;color:var(--muted);font-size:.9rem;">Загрузка...</div>';

  const unsub = window.db
    .collection('comments').doc(postId).collection('items')
    .orderBy('createdAt', 'asc')
    .onSnapshot(
      (snap) => {
        list.innerHTML = '';
        if (snap.empty) {
          list.innerHTML = '<div style="padding:12px;color:var(--muted);font-size:.85rem;">Комментариев пока нет. Будьте первым!</div>';
        } else {
          snap.forEach(doc => list.appendChild(renderComment(doc, postId)));
        }
        if (toggleBtn) {
          const span = toggleBtn.querySelector('span:last-child');
          if (span) span.textContent = `Комментарии (${snap.size})`;
        }
      },
      (err) => {
        console.error(`❌ Комментарии [${postId}]:`, err);
        list.innerHTML = '<div style="padding:12px;color:#ff6b6b;font-size:.85rem;">Не удалось загрузить комментарии.</div>';
      }
    );

  postEl._commentsUnsub = unsub;
}

async function submitComment(postEl) {
  const postId = postEl.dataset.postId;
  const input  = postEl.querySelector('.comment-input');
  if (!postId || !input) return;

  const text = input.value.trim();
  if (!text) { input.focus(); return; }

  const user = window.auth.currentUser;
  if (!user) { alert('Войдите, чтобы оставить комментарий.'); return; }

  const btn = postEl.querySelector('.comment-submit');
  if (btn) { btn.disabled = true; btn.textContent = '...'; }

  try {
    // Подтягиваем актуальный аватар из профиля
    let avatarData = (user.displayName || user.email)[0].toUpperCase();
    try {
      const profileDoc = await window.db.collection('users').doc(user.uid).get();
      if (profileDoc.exists && profileDoc.data().avatar) {
        avatarData = profileDoc.data().avatar;
      }
    } catch (_) { /* фолбэк на букву */ }

    await window.db.collection('comments').doc(postId).collection('items').add({
      uid:       user.uid,
      author:    user.displayName || user.email.split('@')[0],
      avatar:    avatarData,
      text,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    input.value = '';
    const list = postEl.querySelector('.comments-list');
    const tb   = postEl.querySelector('.comments-toggle');
    if (list && !list.classList.contains('open')) {
      list.classList.add('open');
      if (tb) tb.classList.add('open');
    }
  } catch (err) {
    console.error('❌ Отправка:', err);
    alert('Не удалось отправить комментарий.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Отправить'; }
  }
}

async function deleteComment(postId, commentId, el) {
  if (!confirm('Удалить этот комментарий?')) return;
  el.style.cssText += 'opacity:0;transform:translateX(10px);transition:.3s;';
  try {
    await window.db.collection('comments').doc(postId).collection('items').doc(commentId).delete();
  } catch (err) {
    console.error('❌ Удаление:', err);
    el.style.cssText = el.style.cssText.replace('opacity:0;transform:translateX(10px);transition:.3s;', '');
    alert('Не удалось удалить комментарий.');
  }
}

function setupPostComments(postEl) {
  if (postEl.dataset.commentsReady === '1') return;
  postEl.dataset.commentsReady = '1';
  subscribeToComments(postEl);

  const submitBtn = postEl.querySelector('.comment-submit');
  if (submitBtn) submitBtn.addEventListener('click', () => submitComment(postEl));

  const input = postEl.querySelector('.comment-input');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComment(postEl); }
    });
  }
}

// Глобальный экспорт — posts.js использует setupPostComments для динамических постов
window.BlogComments = { setupPostComments };

waitForFirebase(() => {
  window.auth.onAuthStateChanged(() => {
    setTimeout(() => {
      document.querySelectorAll('.blog-post[data-post-id]').forEach(setupPostComments);
    }, 200);
  });
});