importScripts('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js');

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