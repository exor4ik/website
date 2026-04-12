'use strict';

/**
 * 🎬 YouTube Downloader — Frontend
 * Работает через публичный API co.wuk.sh (без своего бэкенда)
 */

document.addEventListener('DOMContentLoaded', function () {

  // ──────────────────────────────────────────────
  // ⚙️  КОНФИГУРАЦИЯ
  // ──────────────────────────────────────────────
  const API_BASE = 'https://co.wuk.sh/api/json';
  const REQUEST_TIMEOUT = 45_000; // 45 секунд на запрос

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
  // API ЗАПРОС
  // ──────────────────────────────────────────────

  async function fetchVideoInfo(url, signal) {
    const mode = qualitySelect.value;

    // Параметры в зависимости от режима
    const params = {
      url: url,
      vCodec: 'h264',
      vQuality: mode === 'video_max' ? '2160' : '1080',
      aFormat: 'mp3',
      filenamePattern: 'basic'
    };

    if (mode === 'audio') {
      params.isAudioOnly = true;
    }

    const response = await fetch(API_BASE, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(params),
      signal: signal
    });

    if (!response.ok) {
      let errorMsg = `HTTP ${response.status}`;
      try {
        const data = await response.json();
        if (data?.error?.code) {
          errorMsg = data.error.code;
        }
      } catch {
        // Не удалось распарсить ошибку
      }
      throw new Error(errorMsg);
    }

    return await response.json();
  }

  // ──────────────────────────────────────────────
  // СКАЧИВАНИЕ ФАЙЛА
  // ──────────────────────────────────────────────

  function downloadFile(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || '';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ──────────────────────────────────────────────
  // РЕЗУЛЬТАТ
  // ──────────────────────────────────────────────

  function showDownloadResult(data, filename) {
    removeById('download-results');

    const title = data.filename || filename || 'Видео с YouTube';
    const size = data.filesize ? ` (${(data.filesize / 1024 / 1024).toFixed(2)} MB)` : '';

    const div = document.createElement('div');
    div.id = 'download-results';
    div.style.cssText = `
      margin-top: 20px;
      padding: 20px;
      background: rgba(74,222,128,.05);
      border: 1px solid rgba(74,222,128,.3);
      border-radius: 12px;
    `;
    div.innerHTML = `
      <div style="background: rgba(74, 222, 128, 0.1); padding: 16px; border-radius: 8px; border-left: 4px solid #4ade80;">
        <h3 style="color: #4ade80; margin-bottom: 12px; font-size: 1.1rem;">✅ Готово к скачиванию!</h3>
        <p style="color: #e8ecff; margin: 8px 0; font-size: .9rem;">
          <strong>Файл:</strong> ${escapeHtml(title)}${size}
        </p>
        <p style="color: #a8b3cc; margin: 8px 0; font-size: .85rem;">
          Если скачивание не началось автоматически,
          <a href="${data.url}" download="${filename}" target="_blank" rel="noopener"
             style="color: #6cd5ff; text-decoration: underline;">нажмите здесь</a>
        </p>
      </div>
    `;

    form.parentNode.insertBefore(div, form.nextSibling);
  }

  function showPickerOptions(picker) {
    removeById('download-results');

    const div = document.createElement('div');
    div.id = 'download-results';
    div.style.cssText = `
      margin-top: 24px;
      padding: 20px;
      background: rgba(0,0,0,.3);
      border-radius: 12px;
      border: 1px solid rgba(130, 170, 255, .18);
    `;

    div.innerHTML = `
      <h3 style="color: #e8ecff; margin-bottom: 16px; font-size: 1.1rem;">📹 Доступные варианты:</h3>
      <div style="display: grid; gap: 12px;">
        ${picker.map((item, idx) => `
          <button class="picker-btn" data-url="${item.url}"
            style="
              padding: 12px 16px;
              background: rgba(108, 213, 255, 0.1);
              border: 1px solid rgba(108, 213, 255, 0.3);
              border-radius: 8px;
              color: #e8ecff;
              cursor: pointer;
              font-size: .95rem;
              transition: all 0.2s;
              text-align: left;
            ">
            📥 Вариант ${idx + 1} ${item.type ? `(${item.type})` : ''}
          </button>
        `).join('')}
      </div>
    `;

    form.parentNode.insertBefore(div, form.nextSibling);

    // Обработка кликов
    div.querySelectorAll('.picker-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = qualitySelect.value;
        const ext = mode === 'audio' ? 'mp3' : 'mp4';
        downloadFile(btn.dataset.url, `video.${ext}`);
        showStatus('✅ Скачивание началось!', 'success');
      });

      btn.addEventListener('mouseenter', () => {
        btn.style.background = 'rgba(108, 213, 255, 0.2)';
        btn.style.borderColor = 'rgba(108, 213, 255, 0.5)';
      });

      btn.addEventListener('mouseleave', () => {
        btn.style.background = 'rgba(108, 213, 255, 0.1)';
        btn.style.borderColor = 'rgba(108, 213, 255, 0.3)';
      });
    });
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ──────────────────────────────────────────────
  // ОБРАБОТКА ФОРМЫ
  // ──────────────────────────────────────────────

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const url = urlInput.value.trim();
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

    // Блокировка кнопки
    downloadBtn.disabled = true;
    downloadBtn.innerHTML = '⏳ Подключение...';
    showStatus('Отправка запроса на сервер...', 'info');

    // Таймаут 45 секунд
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      downloadBtn.innerHTML = '⏳ Обработка видео...';
      showStatus('Сервер обрабатывает ваше видео. Это может занять 10-30 секунд...', 'info');

      const data = await fetchVideoInfo(url, controller.signal);
      clearTimeout(timeoutId);

      // Проверка на ошибку
      if (data.status === 'error' || data.error) {
        throw new Error(data.error?.code || data.error || 'Ошибка обработки видео');
      }

      // Успех — прямая ссылка
      if (data.status === 'tunnel' || data.status === 'redirect') {
        const ext = mode === 'audio' ? 'mp3' : 'mp4';
        const filename = data.filename || `youtube_video.${ext}`;

        showStatus('✅ Видео готово! Начинается скачивание...', 'success');
        downloadBtn.innerHTML = '📥 Скачать ещё раз';
        downloadBtn.disabled = false;

        showDownloadResult(data, filename);
        downloadFile(data.url, filename);

        console.log('✅ Скачивание завершено:', data);
        return;
      }

      // Несколько вариантов
      if (data.status === 'picker' && data.picker?.length > 0) {
        showStatus(`✅ Найдено ${data.picker.length} вариантов. Выберите качество ниже.`, 'success');
        downloadBtn.innerHTML = '📥 Выбрать качество';
        downloadBtn.disabled = false;
        showPickerOptions(data.picker);
        return;
      }

      // Неизвестный статус
      throw new Error('Неизвестный статус ответа от сервера');

    } catch (error) {
      console.error('❌ Download Error:', error);

      // Разные типы ошибок
      let errorMessage = 'Не удалось обработать видео';

      if (error.name === 'AbortError') {
        errorMessage = '⏰ Превышено время ожидания (45 сек). Сервер перегружен или видео слишком длинное.';
      } else if (error.message.includes('429')) {
        errorMessage = '🚫 Слишком много запросов. Подождите минуту и попробуйте снова.';
      } else if (error.message.includes('400') || error.message.includes('BadRequest')) {
        errorMessage = '❌ Видео недоступно или ссылка некорректна.';
      } else if (error.message.includes('403')) {
        errorMessage = '🔒 Видео защищено авторскими правами или приватное.';
      } else if (error.message.includes('500') || error.message.includes('502') || error.message.includes('503')) {
        errorMessage = '🔧 Сервер временно недоступен. Попробуйте позже.';
      } else if (error.message) {
        errorMessage = `❌ Ошибка: ${error.message}`;
      }

      showStatus(errorMessage);
      downloadBtn.innerHTML = '📥 Повторить';
      downloadBtn.disabled = false;
    }
  });
});