// Whisper model management + transcription.
// Primary engine: whisper.cpp CLI. Fallback: openai-whisper (Python).
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { spawn, execFile } = require('child_process');
const { MODELS_DIR } = require('./config');

const MODEL_INFO = {
  tiny:   { file: 'ggml-tiny.bin',   url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',   sizeMB: 75 },
  base:   { file: 'ggml-base.bin',   url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',   sizeMB: 142 },
  small:  { file: 'ggml-small.bin',  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',  sizeMB: 466 },
  medium: { file: 'ggml-medium.bin', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin', sizeMB: 1530 }
};

// Cached engine descriptor: { kind: 'cpp'|'python', bin: string }
let engine = null;

function which(cmd) {
  return new Promise((resolve) => {
    const probe = process.platform === 'win32' ? 'where' : 'which';
    execFile(probe, [cmd], (err, stdout) => {
      resolve(err ? null : stdout.split('\n')[0].trim() || null);
    });
  });
}

// whisper.cpp ships under several names depending on install method/version.
const CPP_CANDIDATES = ['whisper-cli', 'whisper-cpp', 'whisper.cpp'];
// Common Homebrew/manual locations not always on Electron's PATH.
const CPP_EXTRA_PATHS = [
  '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin',
  path.join(os.homedir(), '.lecturevault', 'bin')
];

async function detectEngine(force = false) {
  if (engine && !force) return engine;
  for (const name of CPP_CANDIDATES) {
    const found = await which(name);
    if (found) { engine = { kind: 'cpp', bin: found }; return engine; }
    for (const dir of CPP_EXTRA_PATHS) {
      const candidate = path.join(dir, name + (process.platform === 'win32' ? '.exe' : ''));
      if (fs.existsSync(candidate)) { engine = { kind: 'cpp', bin: candidate }; return engine; }
    }
  }
  // Python fallback: the openai-whisper package installs a `whisper` CLI.
  const py = await which('whisper');
  if (py) { engine = { kind: 'python', bin: py }; return engine; }
  engine = null;
  return null;
}

function modelPath(model) {
  const info = MODEL_INFO[model];
  return info ? path.join(MODELS_DIR, info.file) : null;
}

function isModelDownloaded(model) {
  const p = modelPath(model);
  if (!p || !fs.existsSync(p)) return false;
  // Guard against truncated downloads: file must be at least 90% of expected size.
  const stat = fs.statSync(p);
  return stat.size > MODEL_INFO[model].sizeMB * 1024 * 1024 * 0.9;
}

// Download a ggml model with progress callbacks. Follows redirects (huggingface uses them).
function downloadModel(model, onProgress) {
  const info = MODEL_INFO[model];
  if (!info) return Promise.reject(new Error(`Unknown model "${model}"`));
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  const dest = modelPath(model);
  const tmp = dest + '.partial';

  return new Promise((resolve, reject) => {
    const fetchUrl = (url, redirectsLeft) => {
      https.get(url, { headers: { 'User-Agent': 'LectureVault' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
          return fetchUrl(res.headers.location, redirectsLeft - 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Download failed (HTTP ${res.statusCode})`));
        }
        const total = parseInt(res.headers['content-length'] || '0', 10) || info.sizeMB * 1024 * 1024;
        const out = fs.createWriteStream(tmp);
        let received = 0;
        res.on('data', (chunk) => {
          received += chunk.length;
          onProgress && onProgress({ received, total, percent: Math.min(99, Math.round((received / total) * 100)) });
        });
        res.pipe(out);
        out.on('finish', () => {
          out.close(() => {
            fs.renameSync(tmp, dest);
            onProgress && onProgress({ received: total, total, percent: 100 });
            resolve(dest);
          });
        });
        out.on('error', (err) => { fs.rmSync(tmp, { force: true }); reject(err); });
        res.on('error', (err) => { fs.rmSync(tmp, { force: true }); reject(err); });
      }).on('error', reject);
    };
    fetchUrl(info.url, 5);
  });
}

function deleteModel(model) {
  const p = modelPath(model);
  if (p && fs.existsSync(p)) fs.rmSync(p);
}

// Transcribe a 16kHz mono WAV file; resolves with plain text.
async function transcribe(wavPath, model) {
  const eng = await detectEngine();
  if (!eng) throw new Error('NO_ENGINE');
  if (eng.kind === 'cpp') return transcribeCpp(eng.bin, wavPath, model);
  return transcribePython(eng.bin, wavPath, model);
}

function transcribeCpp(bin, wavPath, model) {
  return new Promise((resolve, reject) => {
    const args = [
      '-m', modelPath(model),
      '-f', wavPath,
      '--no-timestamps',
      '--language', 'auto',
      '-t', String(Math.max(1, os.cpus().length - 1))
    ];
    const child = spawn(bin, args);
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`whisper.cpp exited ${code}: ${err.slice(-400)}`));
      resolve(cleanWhisperOutput(out));
    });
  });
}

function transcribePython(bin, wavPath, model) {
  return new Promise((resolve, reject) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-whisper-'));
    const args = [wavPath, '--model', model, '--output_format', 'txt', '--output_dir', outDir, '--fp16', 'False'];
    const child = spawn(bin, args);
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      try {
        if (code !== 0) throw new Error(`whisper exited ${code}: ${err.slice(-400)}`);
        const txt = path.join(outDir, path.basename(wavPath, '.wav') + '.txt');
        const text = fs.existsSync(txt) ? fs.readFileSync(txt, 'utf8') : '';
        resolve(cleanWhisperOutput(text));
      } catch (e) {
        reject(e);
      } finally {
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    });
  });
}

// Strip whisper's silence hallucinations and tidy whitespace.
const HALLUCINATIONS = /\[(BLANK_AUDIO|MUSIC|SILENCE|NOISE|INAUDIBLE)\]|\((music|silence|static|inaudible|applause)\)/gi;
function cleanWhisperOutput(text) {
  return text.replace(HALLUCINATIONS, ' ').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
}

module.exports = {
  MODEL_INFO, detectEngine, isModelDownloaded, downloadModel, deleteModel, transcribe, modelPath
};
