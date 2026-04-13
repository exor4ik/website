'use strict';

/**
 * 🎬 YouTube Downloader — Frontend
 * Пробуждение Render-бэкенда + стриминг через свой API
 */

document.addEventListener('DOMContentLoaded', function () {

  // ──────────────────────────────────────────────
  // ⚙️  КОНФИГУРАЦИЯ — замените URL на свой Render
  // ──────────────────────────────────────────────
  const BACKEND_URL    = 'https://website-backend-65r9.onrender.com'; // ← поменяйте!
  const WAKE_TIMEOUT   = 70_000;  // макс. время пробуждения, мс
  const WAKE_INTERVAL  = 2_500;   // интервал пингов, мс
  const PING_TIMEOUT   = 5_000;   // таймаут одного пинга, мс

  // ──────────────────────────────────────────────
  // DOM
  // ──────────────────────────────────────────────
  const form         = document.getElementById('download-form');
  const urlInput     = document.getElementById('youtube-url');
  const qualitySelect = document.getElementById('quality-select');
  const downloadBtn  = document.getElementById('download-btn');
  const statusMsg    = document.getElementById('status-message');

  // ──────────────────────────────────────────────
  // UTILS
  // ──────────────────────────────────────────────

  function isValidYouTubeUrl(url) {
    return /^https?:\/\/(?:www\.)?(youtube\.com|youtu\.?be)\/.+/.test(url);
  }

  function showStatus(text, type = 'error') {
    statusMsg.textContent = text;
    statusMsg.style.color =
      type === 'error'   ? '#ff6b6b' :
      type === 'success' ? '#4ade80' : '#6cd5ff';
  }

  function removeById(id) {
    document.getElementById(id)?.remove();
  }

  // ──────────────────────────────────────────────
  // WAKE-UP LOGIC
  // Рендер засыпает через 15 мин простоя.
  // Пингуем /health пока не ответит или не истечёт таймаут.
  // ──────────────────────────────────────────────

  async function wakeUpServer(onProgress) {
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
      async function tryPing() {
        const elapsed   = Date.now() - startedAt;
        const remaining = Math.max(0, Math.ceil((WAKE_TIMEOUT - elapsed) / 1000));

        if (elapsed >= WAKE_TIMEOUT) {
          reject(new Error('Сервер не ответил за 70 секунд. Попробуйте позже.'));
          return;
        }

        try {
          const res = await fetch(`${BACKEND_URL}/health`, {
            signal: AbortSignal.timeout(PING_TIMEOUT),
          });
          if (res.ok) { resolve(); return; }
        } catch {
          // сервер ещё спит — продолжаем пинговать
        }

        onProgress(remaining, elapsed);
        setTimeout(tryPing, WAKE_INTERVAL);
      }

      tryPing();
    });
  }

  // ──────────────────────────────────────────────
  // WAKE-UP UI
  // ──────────────────────────────────────────────

  function injectWakeUpStyles() {
    if (document.getElementById('wake-styles')) return;
    const s = document.createElement('style');
    s.id = 'wake-styles';
    s.textContent = `
      @keyframes wake-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50%       { opacity: .6; transform: scale(1.15); }
      }
      @keyframes wake-bar {
        0%   { background-position: 0% 50%; }
        100% { background-position: 100% 50%; }
      }
      #wake-icon { animation: wake-pulse 1.4s ease-in-out infinite; display: inline-block; }
      #wake-bar-fill {
        background: linear-gradient(90deg, #6cd5ff, #8b7bff, #6cd5ff);
        background-size: 200% 100%;
        animation: wake-bar 2s linear infinite;
        transition: width .8s ease;
        height: 100%;
        border-radius: 4px;
      }
    `;
    document.head.appendChild(s);
  }

  function showWakeUpUI() {
    removeById('wake-up-ui');
    injectWakeUpStyles();

    const div = document.createElement('div');
    div.id = 'wake-up-ui';
    div.style.cssText = `
      margin-top: 20px; padding: 24px 20px;
      background: rgba(108,213,255,.05);
      border: 1px solid rgba(108,213,255,.2);
      border-radius: 14px; text-align: center;
    `;
    div.innerHTML = `
      <div id="wake-icon" style="font-size:2.2rem; margin-bottom:10px;">⚡</div>
      <p style="color:#6cd5ff; font-size:1rem; margin:0 0 6px; font-weight:600;">
        Запускаем сервер...
      </p>
      <p style="color:#a8b3cc; font-size:.82rem; margin:0 0 18px; line-height:1.5;">
        Render.com засыпает при простое.<br>
        Первый запуск займёт <strong style="color:#e8ecff;">~30–50 сек</strong>.
      </p>
      <div style="background:rgba(0,0,0,.35); border-radius:4px; height:6px; overflow:hidden; max-width:280px; margin:0 auto 10px;">
        <div id="wake-bar-fill" style="width:2%;"></div>
      </div>
      <p id="wake-countdown" style="color:#a8b3cc; font-size:.78rem; margin:0;">
        Ожидаем ответа сервера...
      </p>
    `;

    form.parentNode.insertBefore(div, form.nextSibling);
  }

  function updateWakeProgress(secondsRemaining, elapsed) {
    const progress = Math.min(97, (elapsed / WAKE_TIMEOUT) * 100);
    const bar      = document.getElementById('wake-bar-fill');
    const cd       = document.getElementById('wake-countdown');
    if (bar) bar.style.width = `${progress}%`;
    if (cd)  cd.textContent  = `Осталось ~${secondsRemaining} сек...`;
  }

  // ──────────────────────────────────────────────
  // RESULT UI
  // ──────────────────────────────────────────────

  function showDownloadResult(title, downloadUrl) {
    removeById('download-results');

    const div = document.createElement('div');
    div.id = 'download-results';
    div.style.cssText = `
      margin-top: 20px; padding: 20px;
      background: rgba(74,222,128,.05);
      border: 1px solid rgba(74,222,128,.3);
      border-radius: 12px;
    `;
    div.innerHTML = `
      <h3 style="color:#4ade80; margin:0 0 10px; font-size:1rem;">✅ Скачивание началось!</h3>
      <p style="color:#e8ecff; font-size:.88rem; margin:0 0 12px;
                word-break:break-word; line-height:1.5;">${escapeHtml(title)}</p>
      <p style="color:#a8b3cc; font-size:.78rem; margin:0;">
        Если браузер не начал — 
        <a href="${downloadUrl}" style="color:#6cd5ff; text-decoration:underline;">
          скачать вручную
        </a>
      </p>
    `;
    form.parentNode.insertBefore(div, form.nextSibling);
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ──────────────────────────────────────────────
  // FORM SUBMIT
  // ──────────────────────────────────────────────

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const url  = urlInput.value.trim();
    const mode = qualitySelect.value;

    // Сброс
    showStatus('', 'info');
    removeById('download-results');

    if (!url) {
      showStatus('Введите URL видео');
      return;
    }
    if (!isValidYouTubeUrl(url)) {
      showStatus('Некорректный URL YouTube. Проверьте ссылку.');
      return;
    }

    downloadBtn.disabled = true;

    // ── Шаг 1: Будим сервер ──────────────────────
    downloadBtn.innerHTML = '⏳ Запуск сервера...';
    showStatus('Проверяем доступность сервера...', 'info');
    showWakeUpUI();

    try {
      await wakeUpServer((remaining, elapsed) => {
        updateWakeProgress(remaining, elapsed);
        downloadBtn.innerHTML = `⏳ Сервер спит (~${remaining}с)`;
      });
    } catch (err) {
      removeById('wake-up-ui');
      showStatus(`❌ ${err.message}`);
      downloadBtn.disabled = false;
      downloadBtn.innerHTML = '🔄 Попробовать снова';
      return;
    }

    // ── Шаг 2: Получаем инфо о видео ─────────────
    removeById('wake-up-ui');
    downloadBtn.innerHTML = '⏳ Получаем инфо...';
    showStatus('Сервер готов! Получаем информацию о видео...', 'success');

    let videoTitle = 'Видео с YouTube';

    try {
      const infoRes = await fetch(`${BACKEND_URL}/api/info`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url }),
        signal:  AbortSignal.timeout(30_000),
      });

      if (infoRes.ok) {
        const info = await infoRes.json();
        videoTitle = info.title || videoTitle;
      }
    } catch {
      // Не критично — продолжаем со скачиванием
    }

    // ── Шаг 3: Запускаем скачивание ──────────────
    downloadBtn.innerHTML = '📥 Скачивание...';
    showStatus('Скачивание запущено!', 'success');

    const downloadUrl = `${BACKEND_URL}/api/download?url=${encodeURIComponent(url)}&mode=${mode}`;

    showDownloadResult(videoTitle, downloadUrl);

    // Триггерим скачивание через <a>
    const anchor = document.createElement('a');
    anchor.href     = downloadUrl;
    anchor.download = '';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    downloadBtn.disabled = false;
    downloadBtn.innerHTML = '📥 Скачать ещё';
  });
});