/**
 * 👤 Profile System — EgorNetwork
 * Хранит профили в Firestore: users/{uid}
 *   - name: string
 *   - bio: string
 *   - avatar: string (base64, 32x32)
 *   - role: string
 *   - createdAt: Timestamp
 *
 * URL: profile.html?uid=XXX
 * Без uid — показывает свой профиль (если залогинен)
 */

'use strict';

// ============================================================================
// ⏳ ОЖИДАНИЕ FIREBASE
// ============================================================================

function waitForFirebase(cb, max = 25) {
  let n = 0;
  const t = setInterval(() => {
    n++;
    if (window.db && window.auth) { clearInterval(t); cb(); }
    else if (n >= max) { clearInterval(t); showError('Firebase недоступен. Обновите страницу.'); }
  }, 300);
}

// ============================================================================
// 🎨 ВСПОМОГАТЕЛЬНЫЕ
// ============================================================================

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function roleBadgeClass(role) {
  return {
    admin:     'role-badge-admin',
    moderator: 'role-badge-moderator',
    user:      'role-badge-user',
  }[role] || 'role-badge-guest';
}

function roleLabel(role) {
  return { admin: 'Админ', moderator: 'Модератор', user: 'Участник' }[role] || 'Гость';
}

function formatDate(timestamp) {
  if (!timestamp) return 'неизвестно';
  const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function showError(msg) {
  const root = document.getElementById('profile-root');
  if (root) root.innerHTML = `
    <div class="profile-not-found">
      <h3>😕 Что-то пошло не так</h3>
      <p>${escapeHtml(msg)}</p>
    </div>`;
}

// ============================================================================
// 🖼️ АВАТАРКА: сжатие до 32×32 и конвертация в base64
// ============================================================================

function resizeImageToBase64(file, size = 32) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // Обрезаем по центру (crop square)
        const min = Math.min(img.width, img.height);
        const sx  = (img.width  - min) / 2;
        const sy  = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);

        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ============================================================================
// 🎨 РЕНДЕР ПРОФИЛЯ
// ============================================================================

function renderProfile(data, uid, isOwn) {
  const root = document.getElementById('profile-root');
  if (!root) return;

  const avatarHtml = data.avatar
    ? `<img src="${data.avatar}" alt="${escapeHtml(data.name)}">`
    : escapeHtml((data.name || 'U')[0].toUpperCase());

  root.innerHTML = `
    <div class="profile-card fade visible">

      <!-- Шапка -->
      <div class="profile-header">
        <div class="profile-avatar-wrap">
          <div class="profile-avatar" id="profile-avatar-display">
            ${avatarHtml}
          </div>
          ${isOwn ? `
            <button class="avatar-edit-btn visible" id="avatar-edit-btn" title="Сменить аватар">✏️</button>
          ` : ''}
        </div>

        <div class="profile-info">
          <!-- Имя (статичное) -->
          <h2 class="profile-name" id="profile-name-display">${escapeHtml(data.name || 'Без имени')}</h2>
          <!-- Имя (редактируемое) -->
          <input
            class="profile-name-edit" id="profile-name-edit"
            type="text" maxlength="32"
            value="${escapeHtml(data.name || '')}"
            placeholder="Имя"
          >

          <!-- Роль -->
          <span class="profile-role ${roleBadgeClass(data.role)}">${roleLabel(data.role)}</span>
        </div>
      </div>

      <!-- Bio -->
      <div class="profile-bio-section">
        <div class="profile-bio-label">О себе</div>
        <p class="profile-bio" id="profile-bio-display">${
          data.bio
            ? escapeHtml(data.bio)
            : '<span style="color:var(--muted);font-style:italic;">Не заполнено</span>'
        }</p>
        <textarea
          class="profile-bio-edit" id="profile-bio-edit"
          maxlength="300" placeholder="Расскажите о себе (макс. 300 символов)"
        >${escapeHtml(data.bio || '')}</textarea>
      </div>

      <!-- Мета -->
      <div class="profile-meta">
        <div class="profile-meta-item">
          <span>📅</span>
          <span>Зарегистрирован: ${formatDate(data.createdAt)}</span>
        </div>
        <div class="profile-meta-item">
          <span>🆔</span>
          <span style="font-family:monospace;font-size:.8rem;color:rgba(168,179,204,.5);">${uid}</span>
        </div>
      </div>

      <!-- Кнопки (только для своего профиля) -->
      ${isOwn ? `
        <div class="profile-actions">
          <button class="profile-edit-btn visible" id="edit-btn">✏️ Редактировать</button>
          <button class="profile-edit-btn profile-save-btn" id="save-btn">💾 Сохранить</button>
          <button class="profile-edit-btn profile-cancel-btn" id="cancel-btn">Отмена</button>
        </div>
        <p class="profile-error" id="profile-error"></p>
      ` : ''}

    </div>
  `;

  if (isOwn) bindEditHandlers(data, uid);
}

// ============================================================================
// ✏️ РЕДАКТИРОВАНИЕ ПРОФИЛЯ
// ============================================================================

function bindEditHandlers(originalData, uid) {
  const editBtn   = document.getElementById('edit-btn');
  const saveBtn   = document.getElementById('save-btn');
  const cancelBtn = document.getElementById('cancel-btn');
  const errEl     = document.getElementById('profile-error');
  const avatarBtn = document.getElementById('avatar-edit-btn');
  const fileInput = document.getElementById('avatar-file-input');

  let isEditing = false;
  let pendingAvatar = null; // base64 нового аватара до сохранения

  function setEditing(val) {
    isEditing = val;

    document.getElementById('profile-name-display').style.display = val ? 'none' : '';
    document.getElementById('profile-name-edit').style.display    = val ? 'block' : 'none';
    document.getElementById('profile-bio-display').style.display  = val ? 'none' : '';
    document.getElementById('profile-bio-edit').style.display     = val ? 'block' : 'none';

    editBtn.style.display   = val ? 'none' : '';
    saveBtn.style.display   = val ? 'inline-block' : 'none';
    cancelBtn.style.display = val ? 'inline-block' : 'none';

    if (avatarBtn) avatarBtn.style.display = val ? 'grid' : 'none';
    if (errEl) errEl.textContent = '';
  }

  editBtn?.addEventListener('click', () => setEditing(true));

  cancelBtn?.addEventListener('click', () => {
    pendingAvatar = null;
    // Откат превью аватара
    const display = document.getElementById('profile-avatar-display');
    if (display) {
      display.innerHTML = originalData.avatar
        ? `<img src="${originalData.avatar}" alt="">`
        : escapeHtml((originalData.name || 'U')[0].toUpperCase());
    }
    setEditing(false);
  });

  saveBtn?.addEventListener('click', async () => {
    const name = document.getElementById('profile-name-edit')?.value.trim();
    const bio  = document.getElementById('profile-bio-edit')?.value.trim();

    if (!name) { if (errEl) errEl.textContent = 'Имя не может быть пустым.'; return; }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Сохраняю...';
    if (errEl) errEl.textContent = '';

    try {
      const update = {
        name,
        bio: bio || '',
      };
      if (pendingAvatar) update.avatar = pendingAvatar;

      await window.db.collection('users').doc(uid).update(update);

      // Обновляем displayName в Auth тоже
      if (window.auth.currentUser) {
        await window.auth.currentUser.updateProfile({ displayName: name });
      }

      // Обновляем оригинальные данные и перерендерим
      Object.assign(originalData, update);
      renderProfile(originalData, uid, true);

      console.log('✅ Профиль сохранён');
    } catch (err) {
      console.error('❌ Сохранение:', err);
      if (errEl) errEl.textContent = 'Ошибка сохранения: ' + err.message;
      saveBtn.disabled = false;
      saveBtn.textContent = '💾 Сохранить';
    }
  });

  // Смена аватара
  avatarBtn?.addEventListener('click', () => fileInput?.click());

  fileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      if (errEl) errEl.textContent = 'Файл слишком большой (макс. 5 МБ).';
      return;
    }

    try {
      const base64 = await resizeImageToBase64(file, 96);
      pendingAvatar = base64;

      // Превью
      const display = document.getElementById('profile-avatar-display');
      if (display) display.innerHTML = `<img src="${base64}" alt="avatar">`;
    } catch (err) {
      console.error('❌ Обработка изображения:', err);
      if (errEl) errEl.textContent = 'Не удалось обработать изображение.';
    }

    fileInput.value = ''; // сброс input
  });

  // Сразу в режим просмотра
  setEditing(false);
}

// ============================================================================
// 📡 ЗАГРУЗКА ПРОФИЛЯ
// ============================================================================

async function loadProfile(uid, currentUser) {
  try {
    const doc = await window.db.collection('users').doc(uid).get();

    if (!doc.exists) {
      const root = document.getElementById('profile-root');
      if (root) root.innerHTML = `
        <div class="profile-not-found">
          <h3>👤 Профиль не найден</h3>
          <p>Пользователь не существует или ещё не заходил на сайт.</p>
        </div>`;
      return;
    }

    const data  = doc.data();
    const isOwn = currentUser && currentUser.uid === uid;

    document.title = `${data.name || 'Профиль'} — EgorNetwork`;
    renderProfile(data, uid, isOwn);
  } catch (err) {
    console.error('❌ Загрузка профиля:', err);
    showError('Не удалось загрузить профиль: ' + err.message);
  }
}

// ============================================================================
// 🚀 ИНИЦИАЛИЗАЦИЯ
// ============================================================================

function init() {
  const params = new URLSearchParams(window.location.search);
  let targetUid = params.get('uid');

  waitForFirebase(() => {
    window.auth.onAuthStateChanged(async (currentUser) => {
      // Если uid не указан — показываем свой профиль
      if (!targetUid) {
        if (!currentUser) {
          showError('Войдите в аккаунт, чтобы просмотреть профиль.');
          return;
        }
        targetUid = currentUser.uid;
        // Обновляем URL без перезагрузки
        history.replaceState(null, '', `?uid=${currentUser.uid}`);
      }

      await loadProfile(targetUid, currentUser);
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}