const { parentPort, workerData } = require('worker_threads');

const { cacheDir, modelName } = workerData;

let pipeline = null;
let isReady = false;

async function init() {
  try {
    // Dynamic import for ESM compatibility
    const { pipeline: createPipeline, env } = await import('@huggingface/transformers');

    env.cacheDir = cacheDir;

    parentPort.postMessage({ type: 'progress', status: 'loading', progress: 0, text: 'Initializing Whisper...' });

    pipeline = await createPipeline('automatic-speech-recognition', modelName, {
      dtype: 'q8',
      progress_callback: (info) => {
        // transformers.js v2 emits: initiate → download → progress (repeated) → done → ready
        if (info.status === 'progress' && info.file) {
          parentPort.postMessage({
            type: 'progress',
            status: 'downloading',
            file: info.file,
            progress: Math.round(info.progress) || 0,
            text: `Downloading ${info.file}... ${Math.round(info.progress) || 0}%`
          });
        } else if (info.status === 'done' && info.file) {
          parentPort.postMessage({
            type: 'progress',
            status: 'downloading',
            file: info.file,
            progress: 100,
            text: `Finished ${info.file}`
          });
        } else if (info.status === 'ready') {
          parentPort.postMessage({
            type: 'progress',
            status: 'loading',
            progress: 100,
            text: 'Loading model into memory...'
          });
        }
      }
    });

    isReady = true;
    parentPort.postMessage({ type: 'ready' });
  } catch (err) {
    parentPort.postMessage({ type: 'error', error: err.message });
  }
}

parentPort.on('message', async (msg) => {
  if (msg.type === 'transcribe') {
    if (!isReady) {
      parentPort.postMessage({ type: 'result', id: msg.id, text: '', error: 'Model not ready' });
      return;
    }

    try {
      const audio = new Float32Array(msg.audio);

      const options = {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: false
      };
      // English-only (.en) models have no language tokens — passing
      // language/task to them breaks generation in transformers.js
      if (!/\.en$/.test(modelName)) {
        options.language = 'english';
        options.task = 'transcribe';
      }

      const result = await pipeline(audio, options);

      const text = Array.isArray(result)
        ? result.map(r => r.text).join(' ')
        : result.text || '';

      parentPort.postMessage({ type: 'result', id: msg.id, text: text.trim() });
    } catch (err) {
      parentPort.postMessage({ type: 'result', id: msg.id, text: '', error: err.message });
    }
  }
});

init();
