// Browser Whisper worker — mirrors src/whisper-worker.js (Node) but runs
// in a Web Worker using transformers.js v3. Uses WebGPU when available
// (10x+ faster), falling back to WASM. Models are cached by the browser's
// Cache API after first download.
// Dynamic import: static `import` from a CDN is blocked by the inherited
// page CSP in module workers, dynamic import() is not.
const transformersPromise = import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3');

let asr = null;
let modelName = null;

function progressCallback(info) {
  if (info.status === 'progress' && info.file) {
    self.postMessage({
      type: 'progress',
      file: info.file,
      progress: Math.round(info.progress) || 0,
      text: `Downloading ${info.file}... ${Math.round(info.progress) || 0}%`
    });
  } else if (info.status === 'done' && info.file) {
    self.postMessage({ type: 'progress', file: info.file, progress: 100, text: `Finished ${info.file}` });
  } else if (info.status === 'ready') {
    self.postMessage({ type: 'progress', progress: 100, text: 'Loading model into memory...' });
  }
}

async function loadModel(name) {
  const { pipeline } = await transformersPromise;

  // Try WebGPU first — dramatically faster. Fall back to WASM (q8) if the
  // device/driver doesn't support it or model init fails on the GPU.
  if (typeof navigator !== 'undefined' && navigator.gpu) {
    try {
      return await pipeline('automatic-speech-recognition', name, {
        device: 'webgpu',
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
        progress_callback: progressCallback
      });
    } catch (err) {
      self.postMessage({ type: 'progress', progress: 0, text: 'WebGPU unavailable — using WASM…' });
    }
  }

  return pipeline('automatic-speech-recognition', name, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback: progressCallback
  });
}

self.onmessage = async (e) => {
  const msg = e.data;

  if (msg.type === 'init') {
    modelName = msg.modelName;
    try {
      self.postMessage({ type: 'progress', progress: 0, text: 'Initializing Whisper...' });
      asr = await loadModel(modelName);
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', error: err.message });
    }
    return;
  }

  if (msg.type === 'transcribe') {
    if (!asr) {
      self.postMessage({ type: 'result', id: msg.id, text: '', error: 'Model not ready' });
      return;
    }
    try {
      const audio = new Float32Array(msg.audio);

      const options = {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: false
      };
      // English-only (.en) models have no language tokens
      if (!/\.en$/.test(modelName)) {
        options.language = 'english';
        options.task = 'transcribe';
      }

      const result = await asr(audio, options);
      const text = Array.isArray(result)
        ? result.map(r => r.text).join(' ')
        : result.text || '';

      self.postMessage({ type: 'result', id: msg.id, text: text.trim() });
    } catch (err) {
      self.postMessage({ type: 'result', id: msg.id, text: '', error: err.message });
    }
  }
};
