// Smoke test: boots the real whisper worker the same way main.js does,
// waits for model ready, then transcribes 3 seconds of synthetic audio.
// Pass = worker reaches 'ready' and returns a transcription result
// (text may be empty/garbage for a sine wave — we only need no crash).
const { Worker } = require('worker_threads');
const path = require('path');
const { readConfig, getModelCacheDir } = require('../src/config');

const config = readConfig();
const modelName = config.whisperModel || 'Xenova/whisper-base.en';
const cacheDir = getModelCacheDir();

console.log(`Model: ${modelName}`);
console.log(`Cache: ${cacheDir}`);

const worker = new Worker(path.join(__dirname, '../src/whisper-worker.js'), {
  workerData: { cacheDir, modelName }
});

const timeout = setTimeout(() => {
  console.error('FAIL: timed out after 10 minutes');
  process.exit(1);
}, 600_000);

worker.on('message', (msg) => {
  if (msg.type === 'progress') {
    console.log(`  [progress] ${msg.text}`);
  } else if (msg.type === 'ready') {
    console.log('PASS: model ready — sending test audio');
    // 3s of 220Hz sine at 16kHz (whisper will hear a hum; just must not crash)
    const samples = new Float32Array(16000 * 3);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = 0.1 * Math.sin((2 * Math.PI * 220 * i) / 16000);
    }
    worker.postMessage({ type: 'transcribe', audio: Array.from(samples), id: 1 });
  } else if (msg.type === 'result') {
    clearTimeout(timeout);
    if (msg.error) {
      console.error(`FAIL: transcription error: ${msg.error}`);
      worker.terminate().then(() => process.exit(1));
    } else {
      console.log(`PASS: transcription returned (text: ${JSON.stringify(msg.text).slice(0, 120)})`);
      worker.terminate().then(() => process.exit(0));
    }
  } else if (msg.type === 'error') {
    clearTimeout(timeout);
    console.error(`FAIL: worker error: ${msg.error}`);
    worker.terminate().then(() => process.exit(1));
  }
});

worker.on('error', (err) => {
  clearTimeout(timeout);
  console.error(`FAIL: worker crashed: ${err.message}`);
  process.exit(1);
});
