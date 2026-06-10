const { app, BrowserWindow, ipcMain, dialog, clipboard, systemPreferences, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');

const config = require('./config');
const whisper = require('./whisper');
const { SessionRecorder } = require('./audio');
const sessions = require('./sessions');
const polish = require('./polish');
const exporter = require('./export');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: '#fdf8f0',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

/* ---------- config ---------- */
ipcMain.handle('config:get', () => config.load());
ipcMain.handle('config:set', (_e, partial) => config.save(partial));

/* ---------- microphone permission (macOS prompts; others granted by default) ---------- */
ipcMain.handle('mic:request', async () => {
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status === 'granted') return true;
    return systemPreferences.askForMediaAccess('microphone');
  }
  return true;
});

/* ---------- whisper engine + models ---------- */
ipcMain.handle('whisper:status', async () => {
  const engine = await whisper.detectEngine(true);
  const models = {};
  for (const m of Object.keys(whisper.MODEL_INFO)) models[m] = whisper.isModelDownloaded(m);
  return { engine, models, info: whisper.MODEL_INFO, brewAvailable: await hasBrew() };
});

ipcMain.handle('whisper:download', async (_e, model) => {
  await whisper.downloadModel(model, (p) => send('whisper:download-progress', { model, ...p }));
  return true;
});

ipcMain.handle('whisper:delete-model', (_e, model) => { whisper.deleteModel(model); return true; });

function hasBrew() {
  return new Promise((resolve) => execFile('which', ['brew'], (err) => resolve(!err)));
}

// Convenience: install whisper.cpp through Homebrew with live log streaming.
ipcMain.handle('whisper:install-brew', () => new Promise((resolve) => {
  const child = spawn('brew', ['install', 'whisper-cpp'], { env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1' } });
  child.stdout.on('data', (d) => send('whisper:install-log', d.toString()));
  child.stderr.on('data', (d) => send('whisper:install-log', d.toString()));
  child.on('error', () => resolve({ ok: false }));
  child.on('close', async (code) => {
    const engine = await whisper.detectEngine(true);
    resolve({ ok: code === 0 && !!engine, engine });
  });
}));

/* ---------- recording + live transcription ---------- */
let recorder = null;
let recorderDir = null;
let transcribeQueue = Promise.resolve();
const CHUNK_TARGET_SECONDS = 8;

ipcMain.handle('record:start', () => {
  recorderDir = sessions.newSessionDir();
  recorder = new SessionRecorder(recorderDir);
  transcribeQueue = Promise.resolve();
  return recorderDir;
});

ipcMain.on('record:pcm', (_e, arrayBuffer) => {
  if (!recorder) return;
  recorder.append(Buffer.from(arrayBuffer));
  if (recorder.pendingSeconds >= CHUNK_TARGET_SECONDS) {
    enqueueTranscription(recorder.cutChunk());
  }
});

function enqueueTranscription(chunkPath) {
  if (!chunkPath) return;
  const model = config.load().whisperModel;
  transcribeQueue = transcribeQueue.then(async () => {
    try {
      const text = await whisper.transcribe(chunkPath, model);
      if (text) send('transcript:segment', { text });
    } catch (err) {
      send('transcript:error', { code: err.message === 'NO_ENGINE' ? 'NO_ENGINE' : 'TRANSCRIBE_FAILED', detail: String(err.message || err) });
    } finally {
      fs.rmSync(chunkPath, { force: true });
    }
  });
}

ipcMain.handle('record:finish', async () => {
  if (!recorder) return null;
  enqueueTranscription(recorder.cutRemainder());
  await transcribeQueue;                      // wait for every chunk to land
  const { durationSeconds } = recorder.finalize();
  const dir = recorderDir;
  recorder = null; recorderDir = null;
  return { dir, durationSeconds };
});

ipcMain.handle('record:cancel', () => {
  if (!recorder) return;
  recorder.discard();
  if (recorderDir) fs.rmSync(recorderDir, { recursive: true, force: true });
  recorder = null; recorderDir = null;
});

/* ---------- session persistence + library ---------- */
ipcMain.handle('session:save', (_e, { dir, transcript, summary, metadata }) => {
  if (metadata && !metadata.title) metadata.title = sessions.titleFromTranscript(transcript);
  sessions.writeSessionFiles(dir, { transcript, summary, metadata });
  return metadata;
});

ipcMain.handle('sessions:list', () => sessions.listSessions());
ipcMain.handle('sessions:search', (_e, q) => sessions.searchSessions(q));
ipcMain.handle('sessions:load', (_e, dir) => sessions.loadSessionContent(dir));
ipcMain.handle('sessions:delete', (_e, dir) => { sessions.deleteSession(dir); return true; });

/* ---------- AI polish ---------- */
ipcMain.handle('polish:run', async (_e, payload) => {
  try {
    const text = await polish.polish(payload, (delta) => send('polish:delta', delta));
    return { ok: true, text };
  } catch (err) {
    let code = 'UNKNOWN';
    if (err.message === 'NO_API_KEY') code = 'NO_API_KEY';
    else if (polish.isOfflineError(err)) code = 'OFFLINE';
    else if (polish.isAuthError(err)) code = 'BAD_KEY';
    return { ok: false, code, detail: String(err.message || err) };
  }
});

ipcMain.handle('polish:test-key', (_e, key) => polish.testKey(key));

/* ---------- export ---------- */
ipcMain.handle('export:copy', (_e, text) => { clipboard.writeText(text); return true; });

ipcMain.handle('export:pdf', async (_e, opts) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save summary as PDF',
    defaultPath: `${(opts.title || 'lecture-summary').replace(/[/\\:*?"<>|]/g, '-')}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  await exporter.exportPdf(opts, filePath);
  return { ok: true, path: filePath };
});

ipcMain.handle('export:reveal', (_e, dir) => { exporter.revealInFolder(dir); return true; });

/* ---------- misc ---------- */
ipcMain.handle('dialog:choose-folder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return canceled ? null : filePaths[0];
});

ipcMain.handle('shell:open-external', (_e, url) => {
  if (/^https:\/\//.test(url)) shell.openExternal(url);
});
