const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, systemPreferences } = require('electron');
const path = require('path');
const { Worker } = require('worker_threads');
const fs = require('fs');

const storage = require('./src/storage');
const { readConfig, writeConfig, getModelCacheDir } = require('./src/config');

let mainWindow = null;
let whisperWorker = null;
let whisperReady = false;
let currentSession = null;

// Pending transcription callbacks keyed by id
const pendingTranscriptions = new Map();
let transcriptionIdCounter = 0;

// Cancel flag for AI streaming
let cancelPolish = false;

// ─── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  nativeTheme.themeSource = 'light';

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#fff0f6',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    frame: process.platform !== 'darwin',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src/renderer/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── Whisper Worker ────────────────────────────────────────────────────────────

function startWhisperWorker() {
  const config = readConfig();
  const cacheDir = getModelCacheDir();

  if (whisperWorker) {
    whisperWorker.terminate();
    whisperWorker = null;
    whisperReady = false;
  }

  whisperWorker = new Worker(path.join(__dirname, 'src/whisper-worker.js'), {
    workerData: {
      cacheDir,
      modelName: config.whisperModel || 'Xenova/whisper-base.en'
    }
  });

  whisperWorker.on('message', (msg) => {
    switch (msg.type) {
      case 'progress':
        mainWindow?.webContents.send('model-download-progress', msg);
        break;

      case 'ready':
        whisperReady = true;
        mainWindow?.webContents.send('whisper-ready');
        break;

      case 'result': {
        const cb = pendingTranscriptions.get(msg.id);
        if (cb) {
          cb(msg.text, msg.error);
          pendingTranscriptions.delete(msg.id);
        }
        break;
      }

      case 'error':
        mainWindow?.webContents.send('whisper-error', msg.error);
        break;
    }
  });

  whisperWorker.on('error', (err) => {
    console.error('Whisper worker crashed:', err);
    mainWindow?.webContents.send('whisper-error', err.message);
  });
}

// ─── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  startWhisperWorker();

  // Prompt for mic access up front on macOS so the first recording
  // doesn't stall on the OS permission dialog. Non-blocking; Electron
  // also auto-prompts when the renderer calls getUserMedia.
  if (process.platform === 'darwin') {
    try {
      const status = systemPreferences.getMediaAccessStatus('microphone');
      if (status === 'not-determined') {
        systemPreferences.askForMediaAccess('microphone').catch(() => {});
      }
    } catch {
      // never let permission probing take the app down
    }
  }
});

app.on('window-all-closed', () => {
  whisperWorker?.terminate();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── IPC: Model / Whisper ───────────────────────────────────────────────────────

ipcMain.handle('check-model-ready', () => whisperReady);

// ─── IPC: Transcription ────────────────────────────────────────────────────────

ipcMain.handle('transcribe-chunk', async (_event, audioArray) => {
  if (!whisperReady) throw new Error('Whisper model not ready yet');

  return new Promise((resolve, reject) => {
    const id = ++transcriptionIdCounter;

    const timeout = setTimeout(() => {
      pendingTranscriptions.delete(id);
      reject(new Error('Transcription timed out'));
    }, 120_000);

    pendingTranscriptions.set(id, (text, error) => {
      clearTimeout(timeout);
      if (error) reject(new Error(error));
      else resolve(text);
    });

    // audioArray is a plain Array of float32 values transferred via IPC
    whisperWorker.postMessage({ type: 'transcribe', audio: audioArray, id });
  });
});

// ─── IPC: Sessions ─────────────────────────────────────────────────────────────

ipcMain.handle('list-sessions', () => storage.listSessions());

ipcMain.handle('get-session', (_event, id) => storage.getSession(id));

ipcMain.handle('create-session', () => {
  currentSession = storage.createSession();
  return currentSession;
});

ipcMain.handle('save-session', (_event, data) => {
  const id = data.id || currentSession?.id;
  if (!id) throw new Error('No active session');

  // audio comes as a plain Array, convert to Buffer
  const payload = { ...data };
  if (data.audioSamples) {
    payload.audioBuffer = encodeWAV(data.audioSamples, 16000);
    delete payload.audioSamples;
  }

  storage.saveSessionData(id, payload);
  return id;
});

ipcMain.handle('delete-session', (_event, id) => {
  storage.deleteSession(id);
});

ipcMain.handle('open-session-folder', (_event, id) => {
  const dir = path.join(storage.BASE_DIR, id);
  shell.openPath(dir);
});

// ─── IPC: Config ───────────────────────────────────────────────────────────────

ipcMain.handle('get-config', () => readConfig());

ipcMain.handle('set-config', (_event, updates) => {
  const config = writeConfig(updates);
  // Restart whisper worker if model changed
  if (updates.whisperModel) {
    whisperReady = false;
    mainWindow?.webContents.send('whisper-error', null); // clear error state
    startWhisperWorker();
  }
  return config;
});

// ─── IPC: AI Polish ────────────────────────────────────────────────────────────

ipcMain.handle('polish-summary', async (_event, { transcript, keyPoints }) => {
  const config = readConfig();

  if (!config.apiKey || !config.apiKey.trim()) {
    throw new Error('NO_API_KEY');
  }

  cancelPolish = false;

  let Anthropic;
  try {
    Anthropic = require('@anthropic-ai/sdk');
  } catch {
    throw new Error('Anthropic SDK not installed');
  }

  const client = new Anthropic.default({ apiKey: config.apiKey.trim() });

  const prompt = buildSummaryPrompt(transcript, keyPoints);

  let fullText = '';

  const stream = await client.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }]
  });

  for await (const chunk of stream) {
    if (cancelPolish) {
      stream.abort?.();
      break;
    }
    if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
      fullText += chunk.delta.text;
      mainWindow?.webContents.send('ai-stream-chunk', chunk.delta.text);
    }
  }

  mainWindow?.webContents.send('ai-stream-done', fullText);
  return fullText;
});

ipcMain.handle('cancel-polish', () => {
  cancelPolish = true;
});

// ─── IPC: Export PDF ───────────────────────────────────────────────────────────

ipcMain.handle('export-pdf', async (_event, { sessionId }) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `${sessionId}-summary.pdf`,
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  });

  if (!filePath) return { cancelled: true };

  const pdfData = await mainWindow.webContents.printToPDF({
    marginsType: 1,
    printBackground: true,
    pageSize: 'Letter'
  });

  fs.writeFileSync(filePath, pdfData);
  return { filePath };
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

function buildSummaryPrompt(transcript, keyPoints) {
  return `You are an expert note-taker summarizing a recorded lecture.

Below is the verbatim transcript and auto-extracted key points from the lecture.

Your output MUST follow this exact structure using Markdown:

# TL;DR
Write exactly 3 clear, complete sentences summarizing the entire lecture.

# Key Concepts
- Bullet list of the main ideas, terms, and concepts introduced.

# Detailed Notes by Section
Organize the content into thematic sections. Use ## headings for each section. Write coherent prose notes (not bullets) within each section.

# Action Items / Follow-ups
- Any tasks, readings, assignments, or follow-up questions mentioned in the lecture.
- If none were mentioned, write "None mentioned."

CRITICAL RULES:
- Stay strictly grounded in the transcript. Do NOT add outside knowledge or invent facts.
- Clean up disfluencies and transcription artifacts naturally.
- If the transcript is unclear in places, note "[unclear]" rather than guessing.
- Do NOT begin with "Certainly!" or any filler opener.

---

TRANSCRIPT:
${transcript}

---

EXTRACTED KEY POINTS (auto-generated, may be incomplete):
${keyPoints || '(none extracted)'}

---

Begin the summary now:`;
}

function encodeWAV(samples, sampleRate) {
  const numSamples = samples.length;
  const buffer = Buffer.alloc(44 + numSamples * 2);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + numSamples * 2, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);       // chunk size
  buffer.writeUInt16LE(1, 20);        // PCM
  buffer.writeUInt16LE(1, 22);        // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32);        // block align
  buffer.writeUInt16LE(16, 34);       // bits per sample

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(numSamples * 2, 40);

  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const val = s < 0 ? s * 0x8000 : s * 0x7fff;
    buffer.writeInt16LE(Math.round(val), 44 + i * 2);
  }

  return buffer;
}
