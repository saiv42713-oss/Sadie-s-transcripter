const { parentPort, workerData } = require('worker_threads');

const { cacheDir, modelName } = workerData;

let pipeline = null;
let isReady = false;

async function init() {
  try {
    // Dynamic import for ESM compatibility
    const { pipeline: createPipeline, env } = await import('@xenova/transformers');

    env.allowLocalModels = true;
    env.localModelPath = cacheDir;
    env.cacheDir = cacheDir;
    env.backends.onnx.wasm.proxy = false;

    parentPort.postMessage({ type: 'progress', status: 'loading', progress: 0, text: 'Initializing Whisper...' });

    pipeline = await createPipeline('automatic-speech-recognition', modelName, {
      quantized: true,
      progress_callback: (info) => {
        if (info.status === 'downloading') {
          parentPort.postMessage({
            type: 'progress',
            status: 'downloading',
            file: info.file,
            progress: Math.round((info.loaded / info.total) * 100) || 0,
            text: `Downloading ${info.file}...`
          });
        } else if (info.status === 'loading') {
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

      const result = await pipeline(audio, {
        sampling_rate: 16000,
        chunk_length_s: 30,
        stride_length_s: 5,
        language: 'english',
        task: 'transcribe',
        return_timestamps: false
      });

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
