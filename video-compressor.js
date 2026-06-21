/**
 * 🎬 video-compressor.js
 * GitHub Pages Compatible | Inline Worker + Patched FFmpeg.wasm 0.11.x
 *
 * Исправления:
 *  – Worker terminate() + правильный revokeObjectURL (нет утечек, нет NetworkError)
 *  – Лимит файла 400 МБ с кнопкой «Сжать всё равно»
 *  – Кнопка «Отмена»
 *  – Сравнение размеров в статусе
 *  – Человеческие сообщения об ошибках
 */
document.addEventListener('DOMContentLoaded', async () => {
  const els = {
    input: document.getElementById('vc-input'),
    btn: document.getElementById('vc-btn'),
    forceBtn: document.getElementById('vc-force'),
    cancelBtn: document.getElementById('vc-cancel'),
    bar: document.getElementById('vc-bar'),
    status: document.getElementById('vc-status'),
    link: document.getElementById('vc-download'),
    crfSlider: document.getElementById('vc-crf-slider'),
    crfVal: document.getElementById('vc-crf-val')
  };

  if (!els.input || !els.btn) return;

  const MAX_SIZE_MB = 400;
  let ffmpegText = null;          // кэшированный текст ffmpeg.min.js
  let worker = null;
  let currentFfmpegBlobUrl = null;
  let currentWorkerBlobUrl = null;

  // ── Утилита: безопасно отозвать один URL ──
  function safeRevoke(url) {
    if (!url) return;
    try { URL.revokeObjectURL(url); } catch (_) { /* ignore */ }
  }

  // ── Утилита: убить Worker и отозвать его Blob URL ──
  function killWorker() {
    if (worker) {
      try { worker.terminate(); } catch (_) { /* ignore */ }
      worker = null;
    }
    safeRevoke(currentWorkerBlobUrl);
    currentWorkerBlobUrl = null;
    safeRevoke(currentFfmpegBlobUrl);
    currentFfmpegBlobUrl = null;
  }

  // ── Загружаем ffmpeg.min.js один раз, патчим document.baseURI ──
  try {
    const res = await fetch('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js');
    ffmpegText = await res.text();
    ffmpegText = ffmpegText.replace(/document\.baseURI/g, 'self.location.href');
  } catch (err) {
    els.status.textContent = '❌ Не удалось загрузить FFmpeg wrapper: ' + err.message;
    return;
  }

  // ── Создаём Worker с актуальным Blob URL ffmpeg ──
  function createWorker() {
    killWorker(); // гарантированно чистим старого

    currentFfmpegBlobUrl = URL.createObjectURL(
      new Blob([ffmpegText], { type: 'application/javascript' })
    );

    const workerCode = `
      importScripts('${currentFfmpegBlobUrl}');
      const { createFFmpeg } = self.FFmpeg;

      const ffmpeg = createFFmpeg({
        log: false,
        corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-st@0.11.1/dist/ffmpeg-core.js',
        mainName: 'main'
      });

      let loaded = false;

      ffmpeg.setProgress(({ ratio }) => {
        self.postMessage({ type: 'progress', ratio });
      });

      self.onmessage = async (e) => {
        const { type, arrayBuffer, fileName, crf } = e.data;
        if (type !== 'compress') return;

        try {
          if (!loaded) {
            self.postMessage({ type: 'status', text: '⏳ Загрузка ядра FFmpeg.wasm (~25 МБ)...' });
            await ffmpeg.load();
            loaded = true;
          }

          const inName = 'input.mp4';
          const outName = 'output.mp4';

          self.postMessage({ type: 'status', text: '\uD83D\uDCE5 Чтение файла в виртуальную ФС...' });
          ffmpeg.FS('writeFile', inName, new Uint8Array(arrayBuffer));

          self.postMessage({ type: 'status', text: '\uD83D\uDD27 Кодирование...' });
          await ffmpeg.run(
            '-i', inName,
            '-c:v', 'libx264',
            '-crf', String(crf),
            '-preset', 'medium',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-movflags', '+faststart',
            outName
          );

          const data = ffmpeg.FS('readFile', outName);
          const result = new Uint8Array(data.slice());

          ffmpeg.FS('unlink', inName);
          ffmpeg.FS('unlink', outName);

          self.postMessage({
            type: 'done',
            arrayBuffer: result.buffer,
            fileName
          }, [result.buffer]);

        } catch (err) {
          let msg = err.message || String(err);
          if (msg.includes('Invalid data found')) msg = 'Формат файла не поддерживается или файл повреждён.';
          else if (msg.includes('ENOMEM') || msg.includes('memory') || msg.includes('out of memory')) msg = 'Не хватает памяти. Попробуйте файл меньше или закройте лишние вкладки.';
          else if (msg.includes('abort') || msg.includes('terminated')) msg = 'Операция прервана.';
          self.postMessage({ type: 'error', message: msg });
        }
      };
    `;

    currentWorkerBlobUrl = URL.createObjectURL(
      new Blob([workerCode], { type: 'application/javascript' })
    );

    worker = new Worker(currentWorkerBlobUrl);

    worker.onmessage = (e) => {
      const { type, ratio, text, arrayBuffer, fileName, message } = e.data;

      switch (type) {
        case 'progress': {
          const pct = Math.min(Math.round(ratio * 100), 100);
          els.bar.style.width = pct + '%';
          els.status.textContent = '⚙️ Кодирование: ' + pct + '%';
          break;
        }
        case 'status': {
          els.status.textContent = text;
          break;
        }
        case 'done': {
          const blob = new Blob([arrayBuffer], { type: 'video/mp4' });
          const url = URL.createObjectURL(blob);
          const originalSizeMB = (els.input.files[0]?.size || 0) / (1024 * 1024);
          const compressedSizeMB = blob.size / (1024 * 1024);

          els.link.href = url;
          els.link.download = 'compressed_' + fileName.replace(/\.[^/.]+$/, '') + '.mp4';
          els.link.style.display = 'inline-block';
          els.link.textContent = '✅ Готово! Скачать (' + compressedSizeMB.toFixed(1) + ' МБ)';
          els.status.textContent = '✨ Сжатие завершено. ' + originalSizeMB.toFixed(1) + ' МБ → ' + compressedSizeMB.toFixed(1) + ' МБ';
          els.bar.style.width = '100%';
          els.btn.disabled = false;
          els.cancelBtn.style.display = 'none';
          break;
        }
        case 'error': {
          console.error('[Compressor] Ошибка:', message);
          els.status.textContent = '❌ Ошибка: ' + message;
          els.bar.style.width = '0%';
          els.btn.disabled = false;
          els.cancelBtn.style.display = 'none';
          break;
        }
      }
    };

    worker.onerror = (err) => {
      console.error('[Worker] Ошибка:', err);
      const msg = err.message || 'неизвестная ошибка';
      // Скрываем технические детали blob URL от пользователя
      const cleanMsg = msg.includes('blob:') ? 'Не удалось загрузить FFmpeg в Worker. Попробуйте обновить страницу.' : msg;
      els.status.textContent = '❌ Ошибка Worker: ' + cleanMsg;
      els.bar.style.width = '0%';
      els.btn.disabled = false;
      els.cancelBtn.style.display = 'none';
    };
  }

  // ── Слайдер CRF ──
  els.crfSlider.addEventListener('input', () => {
    els.crfVal.textContent = els.crfSlider.value;
  });

  // ── Выбор файла ──
  els.input.addEventListener('change', () => {
    const hasFile = els.input.files.length > 0;
    els.link.style.display = 'none';
    els.bar.style.width = '0%';
    els.cancelBtn.style.display = 'none';

    if (hasFile) {
      const sizeMB = els.input.files[0].size / (1024 * 1024);
      if (sizeMB > MAX_SIZE_MB) {
        els.status.textContent = '⚠️ Файл слишком большой (' + sizeMB.toFixed(1) + ' МБ). Рекомендуется до ' + MAX_SIZE_MB + ' МБ.';
        els.btn.disabled = true;
        els.forceBtn.style.display = 'inline-block';
      } else {
        els.status.textContent = '📁 Выбрано: ' + els.input.files[0].name + ' (' + sizeMB.toFixed(1) + ' МБ)';
        els.btn.disabled = false;
        els.forceBtn.style.display = 'none';
      }
    } else {
      els.status.textContent = 'Выберите видео для начала';
      els.btn.disabled = true;
      els.forceBtn.style.display = 'none';
    }
  });

  // ── Отмена ──
  els.cancelBtn.addEventListener('click', () => {
    killWorker();
    els.status.textContent = '⛔ Операция отменена.';
    els.bar.style.width = '0%';
    els.btn.disabled = false;
    els.forceBtn.disabled = false;
    els.cancelBtn.style.display = 'none';
  });

  // ── Запуск сжатия (основная кнопка) ──
  els.btn.addEventListener('click', () => startCompress(false));

  // ── Запуск сжатия (принудительно) ──
  els.forceBtn.addEventListener('click', () => startCompress(true));

  async function startCompress(force) {
    const file = els.input.files[0];
    if (!file) return;
    if (!force && file.size > MAX_SIZE_MB * 1024 * 1024) return;

    els.btn.disabled = true;
    els.forceBtn.disabled = true;
    els.cancelBtn.style.display = 'inline-block';
    els.link.style.display = 'none';
    els.bar.style.width = '0%';
    els.status.textContent = '📥 Подготовка файла...';

    try {
      const arrayBuffer = await file.arrayBuffer();
      createWorker();
      worker.postMessage({
        type: 'compress',
        arrayBuffer,
        fileName: file.name,
        crf: els.crfSlider.value
      }, [arrayBuffer]);
    } catch (err) {
      els.status.textContent = '❌ Ошибка чтения файла: ' + err.message;
      els.btn.disabled = false;
      els.forceBtn.disabled = false;
      els.cancelBtn.style.display = 'none';
    }
  }
});