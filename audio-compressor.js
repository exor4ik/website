/**
 * 🎧 audio-compressor.js
 * GitHub Pages Compatible | Web Audio API + MediaRecorder (Opus)
 */
document.addEventListener('DOMContentLoaded', () => {
  const els = {
    input: document.getElementById('ac-input'),
    btn: document.getElementById('ac-btn'),
    bar: document.getElementById('ac-bar'),
    status: document.getElementById('ac-status'),
    link: document.getElementById('ac-download'),
    sizeSlider: document.getElementById('ac-size-slider'),
    sizeVal: document.getElementById('ac-size-val')
  };

  if (!els.input || !els.btn) return;

  // ── Слайдер целевого размера ──
  els.sizeSlider.addEventListener('input', () => {
    els.sizeVal.textContent = els.sizeSlider.value;
  });

  // ── Выбор файла ──
  els.input.addEventListener('change', () => {
    const hasFile = els.input.files.length > 0;
    els.btn.disabled = !hasFile;
    els.link.style.display = 'none';
    els.bar.style.width = '0%';
    els.status.textContent = hasFile
      ? '📁 Выбрано: ' + els.input.files[0].name + ' (' + (els.input.files[0].size / 1024 / 1024).toFixed(2) + ' МБ)'
      : 'Выберите аудио для начала';
  });

  // ── Запуск сжатия ──
  els.btn.addEventListener('click', async () => {
    const file = els.input.files[0];
    if (!file) return;

    const targetSizeMB = parseFloat(els.sizeSlider.value);

    els.btn.disabled = true;
    els.link.style.display = 'none';
    els.bar.style.width = '0%';
    els.status.textContent = '⏳ Декодирование аудио...';

    try {
      const res = await compressAudio(file, targetSizeMB, (pct, text) => {
        els.bar.style.width = pct + '%';
        if (text) els.status.textContent = text;
      });

      const url = URL.createObjectURL(res.blob);
      els.link.href = url;
      els.link.download = 'compressed_' + file.name.replace(/\.[^/.]+$/, '') + '.webm';
      els.link.style.display = 'inline-block';
      els.link.textContent = '✅ Готово! Скачать (' + res.compressedSize.toFixed(2) + ' МБ)';
      els.status.textContent = '✨ Сжатие завершено. ' + res.originalSize.toFixed(2) + ' МБ → ' + res.compressedSize.toFixed(2) + ' МБ (' + res.targetBitrate + ' кбит/с)';
      els.bar.style.width = '100%';
    } catch (err) {
      console.error('[Compressor] Ошибка:', err);
      els.status.textContent = '❌ Ошибка: ' + err.message;
      els.bar.style.width = '0%';
    } finally {
      els.btn.disabled = false;
    }
  });

  /**
   * Сжимает аудио до заданного размера через Web Audio API + MediaRecorder.
   * @param {File} file — исходный аудиофайл
   * @param {number} targetSizeMB — целевой размер в МБ
   * @param {function(number, string)} onProgress — callback(процент, статус)
   */
  async function compressAudio(file, targetSizeMB, onProgress) {
    if (!file) throw new Error('Файл не передан');

    const targetBytes = targetSizeMB * 1024 * 1024;
    if (file.size <= targetBytes) {
      throw new Error('Исходный файл уже меньше или равен целевому размеру');
    }

    onProgress(5, '🔧 Расчёт параметров...');

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await file.arrayBuffer();

    let audioBuffer;
    try {
      audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    } catch {
      throw new Error('Не удалось декодировать файл. Убедитесь, что это поддерживаемый аудиоформат');
    }

    const duration = audioBuffer.duration;
    if (duration <= 0) throw new Error('Длительность аудио равна нулю');

    let targetBitrate = Math.round((targetBytes * 8) / duration);
    targetBitrate = Math.max(16000, Math.min(512000, targetBitrate));

    const mimeType = MediaRecorder.isTypeSupported('audio/webm; codecs=opus')
      ? 'audio/webm; codecs=opus'
      : 'audio/webm';

    onProgress(10, '⚙️ Кодирование Opus...');

    const dest = audioCtx.createMediaStreamDestination();
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(dest);

    const mediaRecorder = new MediaRecorder(dest.stream, {
      mimeType,
      audioBitsPerSecond: targetBitrate
    });

    const chunks = [];
    let progressInterval;

    return new Promise((resolve, reject) => {
      mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        clearInterval(progressInterval);
        const blob = new Blob(chunks, { type: mimeType });
        resolve({
          blob,
          originalSize: file.size / (1024 * 1024),
          compressedSize: blob.size / (1024 * 1024),
          duration,
          targetBitrate: Math.round(targetBitrate / 1000)
        });
      };

      mediaRecorder.onerror = e => {
        clearInterval(progressInterval);
        reject(new Error('Ошибка записи: ' + (e.error?.message || 'unknown')));
      };

      // Имитация прогресса на основе длительности аудио
      const startTime = performance.now();
      progressInterval = setInterval(() => {
        const elapsed = (performance.now() - startTime) / 1000;
        const pct = Math.min(Math.round((elapsed / duration) * 80) + 10, 95);
        onProgress(pct, '⚙️ Кодирование: ' + pct + '%');
      }, 200);

      mediaRecorder.start();
      source.start();

      source.onended = () => {
        setTimeout(() => mediaRecorder.stop(), 100);
      };
    });
  }
});