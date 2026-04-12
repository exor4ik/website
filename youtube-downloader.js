/**
 * 🎬 YouTube Downloader Script
 * Полноценное скачивание видео через API co9k
 */

'use strict';

document.addEventListener('DOMContentLoaded', function() {
  // DOM элементы
  const form = document.getElementById('download-form');
  const urlInput = document.getElementById('youtube-url');
  const qualitySelect = document.getElementById('quality-select');
  const downloadBtn = document.getElementById('download-btn');
  const statusMessage = document.getElementById('status-message');
  const examplePanel = document.getElementById('example-panel');

  // Результаты скачивания
  let downloadResults = null;

  // ============================================================================
  // УТИЛИТЫ
  // ============================================================================

  /**
   * Валидация YouTube URL
   */
  function isValidYouTubeUrl(url) {
    return /^https?:\/\/(?:www\.)?(youtube\.com|youtu\.?be)\/.+/.test(url);
  }

  /**
   * Показ сообщения
   */
  function showStatus(message, type = 'error') {
    statusMessage.textContent = message;
    statusMessage.style.color = type === 'error' ? '#ff6b6b' : 
                                type === 'success' ? '#4ade80' : '#6cd5ff';
  }

  // ============================================================================
  // API CO9K
  // ============================================================================

  /**
   * Запрос к API co9k для получения информации о видео
   */
  async function fetchVideoInfo(url, signal = null) {
    const API_BASE = 'https://co.wuk.sh/api/json';
    const mode = qualitySelect.value;
    
    // Параметры запроса в зависимости от режима
    const params = {
      url: url,
      vCodec: 'h264',
      vQuality: mode === 'video_max' ? '2160' : '1080',
      aFormat: 'mp3',
      filenamePattern: 'basic'
    };

    // Для аудио-режима включаем isAudioOnly
    if (mode === 'audio') {
      params.isAudioOnly = true;
      params.dubLang = 'ru';
    }
    
    try {
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
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error?.code || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }

  // ============================================================================
  // СКАЧИВАНИЕ
  // ============================================================================

  /**
   * Скачивание файла через временную ссылку
   */
  function downloadFile(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || '';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    // Очистка через 5 секунд
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ============================================================================
  // ОТОБРАЖЕНИЕ РЕЗУЛЬТАТОВ
  // ============================================================================

  /**
   * Показать информацию о видео
   */
  function showVideoInfo(data, filename) {
    // Удаляем старые результаты если есть
    const oldResults = document.getElementById('download-results');
    if (oldResults) oldResults.remove();

    const resultsDiv = document.createElement('div');
    resultsDiv.id = 'download-results';
    resultsDiv.style.cssText = `
      margin-top: 24px;
      padding: 20px;
      background: rgba(0,0,0,.3);
      border-radius: 12px;
      border: 1px solid rgba(74, 222, 128, 0.3);
    `;

    // Извлекаем информацию о видео
    const title = data.filename || 'Видео с YouTube';
    const size = data.filesize ? ` (${(data.filesize / 1024 / 1024).toFixed(2)} MB)` : '';

    resultsDiv.innerHTML = `
      <div style="background: rgba(74, 222, 128, 0.1); padding: 16px; border-radius: 8px; border-left: 4px solid #4ade80;">
        <h3 style="color: #4ade80; margin-bottom: 12px; font-size: 1.1rem;">✅ Готово к скачиванию!</h3>
        <p style="color: #e8ecff; margin: 8px 0; font-size: .9rem;">
          <strong>Файл:</strong> ${title}${size}
        </p>
        <p style="color: #a8b3cc; margin: 8px 0; font-size: .85rem;">
          Если скачивание не началось автоматически, 
          <a href="${data.url}" download="${filename}" target="_blank" rel="noopener" 
             style="color: #6cd5ff; text-decoration: underline;">нажмите здесь</a>
        </p>
      </div>
    `;

    // Вставляем после формы
    form.parentNode.insertBefore(resultsDiv, form.nextSibling);
  }

  /**
   * Показать варианты для выбора (если API вернул picker)
   */
  function showPickerOptions(picker) {
    if (!picker || picker.length === 0) return;

    // Удаляем старые результаты если есть
    const oldResults = document.getElementById('download-results');
    if (oldResults) oldResults.remove();

    const resultsDiv = document.createElement('div');
    resultsDiv.id = 'download-results';
    resultsDiv.style.cssText = `
      margin-top: 24px;
      padding: 20px;
      background: rgba(0,0,0,.3);
      border-radius: 12px;
      border: 1px solid rgba(130, 170, 255, .18);
    `;

    resultsDiv.innerHTML = `
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

    // Вставляем после формы
    form.parentNode.insertBefore(resultsDiv, form.nextSibling);

    // Обработка кликов по кнопкам
    resultsDiv.querySelectorAll('.picker-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const url = btn.dataset.url;
        const mode = qualitySelect.value;
        const ext = mode === 'audio' ? 'mp3' : 'mp4';
        downloadFile(url, `video.${ext}`);
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

  // ============================================================================
  // ОБРАБОТКА ФОРМЫ
  // ============================================================================

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const url = urlInput.value.trim();

    // Сброс состояния
    showStatus('', 'info');
    downloadResults = null;

    if (!url) {
      showStatus('Пожалуйста, введите URL видео');
      return;
    }

    if (!isValidYouTubeUrl(url)) {
      showStatus('Некорректный URL YouTube. Проверьте ссылку.');
      return;
    }

    // Показ примеров использования
    examplePanel.style.display = 'block';

    // Блокировка кнопки
    downloadBtn.disabled = true;
    downloadBtn.innerHTML = '⏳ Подключение...';
    showStatus('Отправка запроса на сервер...', 'info');

    try {
      // Запрос к API с таймаутом
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 секунд таймаут

      downloadBtn.innerHTML = '⏳ Обработка видео...';
      showStatus('Сервер обрабатывает ваше видео. Это может занять 10-30 секунд...', 'info');

      const data = await fetchVideoInfo(url, controller.signal);
      clearTimeout(timeoutId);

      if (data.status === 'error' || data.error) {
        throw new Error(data.error?.code || 'Ошибка обработки видео');
      }

      if (data.status === 'tunnel' || data.status === 'redirect') {
        // Прямая ссылка для скачивания
        downloadResults = data;
        
        const mode = qualitySelect.value;
        const ext = mode === 'audio' ? 'mp3' : 'mp4';
        
        // Формируем имя файла с информацией о видео
        const filename = data.filename || `youtube_video.${ext}`;

        showStatus('✅ Видео готово! Начинается скачивание...', 'success');
        downloadBtn.innerHTML = '📥 Скачать ещё раз';
        downloadBtn.disabled = false;

        // Показываем информацию о видео
        showVideoInfo(data, filename);

        // Автоматическое скачивание
        downloadFile(data.url, filename);

        console.log('Скачивание завершено:', data);
      } else if (data.status === 'picker') {
        // Несколько вариантов качества
        downloadResults = data;
        showStatus(`✅ Найдено ${data.picker?.length || 0} вариантов. Выберите качество ниже.`, 'success');
        downloadBtn.innerHTML = '📥 Выбрать качество';
        downloadBtn.disabled = false;
        
        // Показать варианты
        showPickerOptions(data.picker);
      } else {
        throw new Error('Неизвестный статус ответа от сервера');
      }

    } catch (error) {
      console.error('Download Error:', error);
      
      // Обработка разных типов ошибок
      let errorMessage = 'Не удалось обработать видео';
      
      if (error.name === 'AbortError') {
        errorMessage = 'Превышено время ожидания (30 сек). Сервер перегружен или видео слишком длинное.';
      } else if (error.message.includes('429')) {
        errorMessage = 'Слишком много запросов. Подождите минуту и попробуйте снова.';
      } else if (error.message.includes('400')) {
        errorMessage = 'Видео недоступно или ссылка некорректна.';
      } else if (error.message) {
        errorMessage = `Ошибка: ${error.message}`;
      }
      
      showStatus(`❌ ${errorMessage}`);
      downloadBtn.innerHTML = '📥 Повторить';
      downloadBtn.disabled = false;
    }
  });

  // Закрыть пример при клике вне панели (опционально)
  document.addEventListener('click', function(e) {
    if (!examplePanel.contains(e.target) && e.target !== examplePanel) {
      examplePanel.style.display = 'none';
    }
  });
});
