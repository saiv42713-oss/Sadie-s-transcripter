// Browser backend for Sadie's Transcriptor 🎀
// Implements the same window.api contract as the Electron preload, so
// app.js runs unchanged in a plain browser tab. Does nothing in Electron
// (where the preload has already defined window.api).
//
// Whisper  → Web Worker (web-whisper-worker.js, transformers.js WASM)
// Sessions → IndexedDB
// Config   → localStorage
// Claude   → direct Anthropic API (CORS browser access)
(function () {
  'use strict';
  if (window.api) return; // running in Electron — preload wins

  const DEFAULTS = {
    apiKey: '',
    whisperModel: 'Xenova/whisper-small.en',
    theme: 'pink',
    autoScroll: true,
    keyPointInterval: 30000
  };

  const LEGACY_MODEL_MAP = {
    tiny: 'Xenova/whisper-tiny.en',
    base: 'Xenova/whisper-base.en',
    small: 'Xenova/whisper-small.en',
    medium: 'Xenova/whisper-medium.en'
  };

  function normalizeModel(model) {
    if (!model) return DEFAULTS.whisperModel;
    if (LEGACY_MODEL_MAP[model]) return LEGACY_MODEL_MAP[model];
    if (!/^(Xenova|onnx-community|distil-whisper)\/(distil-)?whisper-/.test(model)) {
      return DEFAULTS.whisperModel;
    }
    return model;
  }

  // ── Config (localStorage) ──────────────────────────────────────────────
  function readConfig() {
    try {
      const raw = localStorage.getItem('sadie-config');
      const config = { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
      config.whisperModel = normalizeModel(config.whisperModel);
      return config;
    } catch {
      return { ...DEFAULTS };
    }
  }

  function writeConfig(updates) {
    const next = { ...readConfig(), ...updates };
    localStorage.setItem('sadie-config', JSON.stringify(next));
    return next;
  }

  // ── Event emitter (mirrors ipcRenderer.on) ─────────────────────────────
  const listeners = new Map();
  function emit(channel, ...args) {
    (listeners.get(channel) || []).forEach(cb => cb(...args));
  }

  // ── Whisper Web Worker ─────────────────────────────────────────────────
  let worker = null;
  let whisperReady = false;
  const pendingTranscriptions = new Map();
  let transcriptionId = 0;

  function startWorker() {
    if (worker) {
      worker.terminate();
      worker = null;
      whisperReady = false;
    }
    worker = new Worker('web-whisper-worker.js', { type: 'module' });

    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        emit('model-download-progress', msg);
      } else if (msg.type === 'ready') {
        whisperReady = true;
        emit('whisper-ready');
      } else if (msg.type === 'result') {
        const cb = pendingTranscriptions.get(msg.id);
        if (cb) {
          cb(msg.text, msg.error);
          pendingTranscriptions.delete(msg.id);
        }
      } else if (msg.type === 'error') {
        emit('whisper-error', msg.error);
      }
    };

    worker.onerror = (err) => emit('whisper-error', err.message || 'Worker crashed');
    worker.postMessage({ type: 'init', modelName: readConfig().whisperModel });
  }

  function transcribeChunk(audioArray) {
    if (!whisperReady) return Promise.reject(new Error('Whisper model not ready yet'));
    return new Promise((resolve, reject) => {
      const id = ++transcriptionId;
      const timeout = setTimeout(() => {
        pendingTranscriptions.delete(id);
        reject(new Error('Transcription timed out'));
      }, 120000);
      pendingTranscriptions.set(id, (text, error) => {
        clearTimeout(timeout);
        if (error) reject(new Error(error));
        else resolve(text);
      });
      worker.postMessage({ type: 'transcribe', audio: audioArray, id });
    });
  }

  // ── Sessions (IndexedDB) ───────────────────────────────────────────────
  let dbPromise = null;
  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open('sadie-transcriptor', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('sessions', { keyPath: 'id' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function dbOp(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', mode);
      const result = fn(tx.objectStore('sessions'));
      tx.oncomplete = () => resolve(result.result !== undefined ? result.result : result);
      tx.onerror = () => reject(tx.error);
    });
  }

  function newSessionId() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  }

  function encodeWAV(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  async function saveSession(data) {
    const id = data.id;
    if (!id) throw new Error('No active session');
    const existing = (await dbOp('readonly', store => store.get(id))) || { id };
    const next = { ...existing, ...data };
    if (data.audioSamples) {
      next.audioBlob = encodeWAV(data.audioSamples, 16000);
      delete next.audioSamples;
    }
    await dbOp('readwrite', store => store.put(next));
    return id;
  }

  async function listSessions() {
    const all = (await dbOp('readonly', store => store.getAll())) || [];
    return all
      .map(s => ({
        id: s.id,
        date: s.metadata?.date,
        duration: s.metadata?.duration,
        wordCount: s.metadata?.wordCount,
        title: s.metadata?.title
      }))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

  // ── Claude summary (direct browser CORS access) ────────────────────────
  let polishAbort = null;

  async function polishSummary({ transcript, keyPoints }) {
    const config = readConfig();
    if (!config.apiKey || !config.apiKey.trim()) throw new Error('NO_API_KEY');

    polishAbort = new AbortController();

    const prompt = buildSummaryPrompt(transcript, keyPoints);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: polishAbort.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.apiKey.trim(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        stream: true,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Claude API ${res.status}: ${err.slice(0, 200)}`);
    }

    let fullText = '';
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            fullText += ev.delta.text;
            emit('ai-stream-chunk', ev.delta.text);
          }
        } catch { /* keepalives / partial lines */ }
      }
    }

    emit('ai-stream-done', fullText);
    return fullText;
  }

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

  // ── Channel router ─────────────────────────────────────────────────────
  const handlers = {
    'get-config': () => readConfig(),
    'set-config': (updates) => {
      const config = writeConfig(updates);
      if (updates.whisperModel) {
        whisperReady = false;
        startWorker();
      }
      return config;
    },
    'check-model-ready': () => whisperReady,
    'transcribe-chunk': (audioArray) => transcribeChunk(audioArray),
    'create-session': () => ({ id: newSessionId() }),
    'save-session': (data) => saveSession(data),
    'list-sessions': () => listSessions(),
    'get-session': (id) => dbOp('readonly', store => store.get(id)),
    'delete-session': (id) => dbOp('readwrite', store => store.delete(id)),
    'open-session-folder': async (id) => {
      // No filesystem in the browser — download the session audio instead
      const session = await dbOp('readonly', store => store.get(id));
      if (session?.audioBlob) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(session.audioBlob);
        a.download = `${id}.wav`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      }
    },
    'export-pdf': async () => {
      window.print(); // browser print dialog offers "Save as PDF"
      return { cancelled: true }; // suppress the "saved at path" toast
    },
    'polish-summary': (args) => polishSummary(args),
    'cancel-polish': () => polishAbort?.abort()
  };

  window.api = {
    invoke: (channel, ...args) => {
      const handler = handlers[channel];
      if (!handler) return Promise.reject(new Error(`Unknown channel: ${channel}`));
      try {
        return Promise.resolve(handler(...args));
      } catch (err) {
        return Promise.reject(err);
      }
    },
    on: (channel, callback) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel).add(callback);
      return () => listeners.get(channel).delete(callback);
    },
    once: (channel, callback) => {
      const off = window.api.on(channel, (...args) => {
        off();
        callback(...args);
      });
    }
  };

  startWorker();
})();
