/**
 * 🎬 video-compressor.js
 * GitHub Pages Compatible | Inline Worker + Patched FFmpeg.wasm 0.11.x
 */
document.addEventListener('DOMContentLoaded', async () => {
  const els = {
    input: document.getElementById('vc-input'),
    btn: document.getElementById('vc-btn'),
    bar: document.getElementById('vc-bar'),
    status: document.getElementById('vc-status'),
    link: document.getElementById('vc-download'),
    crfSlider: document.getElementById('vc-crf-slider'),
    crfVal: document.getElementById('vc-crf-val')
  };

  if (!els.input || !els.btn) return;

  // ── Загружаем ffmpeg.min.js, убираем document.baseURI для Worker ──
  let ffmpegBlobUrl;
  try {
    const res = await fetch('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js');
    let text = await res.text();
    // Патч: document.baseURI вызывает ReferenceError в Worker (нет проверки typeof)
    text = text.replace(/document\.baseURI/g, 'self.location.href');
    const blob = new Blob([text], { type: 'application/javascript' });
    ffmpegBlobUrl = URL.createObjectURL(blob);
  } catch (err) {
    els.status.textContent = '❌ Не удалось загрузить FFmpeg wrapper: ' + err.message;
    return;
  }

  // ── Inline Worker (classic, blob URL) ──
  const workerCode = `
    importScripts('${ffmpegBlobUrl}');
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

        self.postMessage({ type: 'status', text: '📥 Чтение файла в виртуальную ФС...' });
        ffmpeg.FS('writeFile', inName, new Uint8Array(arrayBuffer));

        self.postMessage({ type: 'status', text: '🔧 Кодирование...' });
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
        self.postMessage({ type: 'error', message: err.message || String(err) });
      }
    };
  `;

  const workerBlob = new Blob([workerCode], { type: 'application/javascript' });
  const worker = new Worker(URL.createObjectURL(workerBlob));

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
        els.link.href = url;
        els.link.download = 'compressed_' + fileName.replace(/\.[^/.]+$/, '') + '.mp4';
        els.link.style.display = 'inline-block';
        els.link.textContent = '✅ Готово! Скачать (' + (blob.size / 1024 / 1024).toFixed(1) + ' МБ)';
        els.status.textContent = '✨ Сжатие завершено. Файл остался в браузере.';
        els.bar.style.width = '100%';
        els.btn.disabled = false;
        break;
      }
      case 'error': {
        console.error('[Compressor] Ошибка:', message);
        els.status.textContent = '❌ Ошибка: ' + message;
        els.bar.style.width = '0%';
        els.btn.disabled = false;
        break;
      }
    }
  };

  worker.onerror = (err) => {
    console.error('[Worker] Ошибка:', err);
    els.status.textContent = '❌ Ошибка Worker: ' + (err.message || 'неизвестная ошибка');
    els.bar.style.width = '0%';
    els.btn.disabled = false;
  };

  els.crfSlider.addEventListener('input', () => {
    els.crfVal.textContent = els.crfSlider.value;
  });

  els.input.addEventListener('change', () => {
    const hasFile = els.input.files.length > 0;
    els.btn.disabled = !hasFile;
    els.link.style.display = 'none';
    els.status.textContent = hasFile ? '📁 Выбрано: ' + els.input.files[0].name : 'Выберите видео для начала';
  });

  els.btn.addEventListener('click', async () => {
    const file = els.input.files[0];
    if (!file) return;

    els.btn.disabled = true;
    els.link.style.display = 'none';
    els.bar.style.width = '0%';
    els.status.textContent = '📥 Подготовка файла...';

    try {
      const arrayBuffer = await file.arrayBuffer();
      worker.postMessage({
        type: 'compress',
        arrayBuffer,
        fileName: file.name,
        crf: els.crfSlider.value
      }, [arrayBuffer]);
    } catch (err) {
      els.status.textContent = '❌ Ошибка чтения файла: ' + err.message;
      els.btn.disabled = false;
    }
  });
});