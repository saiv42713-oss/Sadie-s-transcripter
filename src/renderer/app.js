/* global ExtractiveSummarizer */
'use strict';

// ─── State ──────────────────────────────────────────────────────────────────
const state = {
  screen: 'idle',          // idle | recording | processing | review
  whisperReady: false,
  whisperError: null,
  config: {},

  // Recording
  sessionId: null,
  audioContext: null,
  micStream: null,
  sourceNode: null,
  processorNode: null,
  analyserNode: null,
  allSamples: [],          // Float32Array accumulator for WAV save
  chunkBuffer: [],         // samples for current Whisper chunk
  recordingStart: null,
  timerInterval: null,
  chunkInterval: null,

  // Transcript
  transcript: '',          // full text
  wordCount: 0,
  transcriptPlaceholderGone: false,

  // Summarizer
  summarizer: new ExtractiveSummarizer(),
  keyPointsLastUpdate: 0,

  // Review
  currentSession: null,
  summary: '',
  streamingText: '',
  aiPolishUsed: false
};

// ─── DOM refs ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const dom = {
  recIndicator: $('rec-indicator'),
  recTimer:     $('rec-timer'),

  modelDownloadOverlay: $('model-download-overlay'),
  downloadProgressFill: $('download-progress-fill'),
  downloadProgressLabel: $('download-progress-label'),
  downloadSubText:  $('download-sub-text'),

  screenIdle:       $('screen-idle'),
  recordBtn:        $('record-btn'),
  recordHint:       $('record-hint'),
  modelDot:         $('model-dot'),
  modelStatusText:  $('model-status-text'),

  screenRecording:  $('screen-recording'),
  waveformCanvas:   $('waveform-canvas'),
  stopBtn:          $('stop-btn'),
  finishBtn:        $('finish-btn'),
  wordCount:        $('word-count'),
  transcriptText:   $('transcript-text'),
  transcriptScroll: $('transcript-scroll'),
  keypointsList:    $('keypoints-list'),
  keypointsLabel:   $('keypoints-update-label'),

  screenProcessing: $('screen-processing'),
  processingTitle:  $('processing-title'),
  processingSub:    $('processing-sub'),
  skipAiBtn:        $('skip-ai-btn'),

  screenReview:     $('screen-review'),
  reviewTitle:      $('review-title'),
  newRecordingBtn:  $('new-recording-btn'),
  copySummaryBtn:   $('copy-summary-btn'),
  exportPdfBtn:     $('export-pdf-btn'),
  openFolderBtn:    $('open-folder-btn'),
  reviewTranscript: $('review-transcript-text'),
  reviewSummary:    $('review-summary-content'),
  summaryModelTag:  $('summary-model-tag'),

  screenSetup:      $('screen-setup'),
  setupTitle:       $('setup-title'),
  setupDesc:        $('setup-desc'),
  apiKeyInput:      $('api-key-input'),
  modelSelect:      $('model-select'),
  setupMsg:         $('setup-msg'),
  setupCancelBtn:   $('setup-cancel-btn'),
  setupSaveBtn:     $('setup-save-btn'),

  sessionList:      $('session-list'),
  refreshBtn:       $('refresh-sessions-btn'),
  settingsBtn:      $('settings-btn'),

  toastContainer:   $('toast-container')
};

// ─── Init ────────────────────────────────────────────────────────────────────
async function init() {
  state.config = await window.api.invoke('get-config');

  setupIpcListeners();
  setupUIListeners();
  await loadSessionList();

  // Check if model is already loaded (re-opened window scenario)
  const ready = await window.api.invoke('check-model-ready');
  if (ready) onWhisperReady();
}

function setupIpcListeners() {
  window.api.on('model-download-progress', onDownloadProgress);
  window.api.on('whisper-ready', onWhisperReady);
  window.api.on('whisper-error', onWhisperError);
  window.api.on('ai-stream-chunk', onAiChunk);
  window.api.on('ai-stream-done', onAiDone);
  window.api.on('ai-stream-error', onAiError);
}

function setupUIListeners() {
  dom.recordBtn.addEventListener('click', startRecording);
  dom.stopBtn.addEventListener('click', () => stopRecording(false));
  dom.finishBtn.addEventListener('click', () => stopRecording(true));
  dom.skipAiBtn.addEventListener('click', skipAiPolish);
  dom.newRecordingBtn.addEventListener('click', goIdle);
  dom.copySummaryBtn.addEventListener('click', copySummary);
  dom.exportPdfBtn.addEventListener('click', exportPdf);
  dom.openFolderBtn.addEventListener('click', openFolder);
  dom.refreshBtn.addEventListener('click', loadSessionList);
  dom.settingsBtn.addEventListener('click', openSettings);
  dom.setupSaveBtn.addEventListener('click', saveSettings);
  dom.setupCancelBtn.addEventListener('click', closeSettings);

  // Keyboard shortcut: Space to record/stop when idle/recording
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && e.target === document.body) {
      e.preventDefault();
      if (state.screen === 'idle' && state.whisperReady) startRecording();
      else if (state.screen === 'recording') stopRecording(true);
    }
  });
}

// ─── Whisper / Model events ──────────────────────────────────────────────────
function onDownloadProgress(msg) {
  // Show overlay on first progress message, keep updating on every one after
  dom.modelDownloadOverlay.classList.remove('hidden');

  dom.downloadProgressFill.style.width = `${msg.progress || 0}%`;
  dom.downloadProgressLabel.textContent = msg.text || 'Downloading…';
  if (msg.file) dom.downloadSubText.textContent = msg.text;
}

function onWhisperReady() {
  dom.modelDownloadOverlay.classList.add('hidden');
  state.whisperReady = true;
  state.whisperError = null;

  dom.modelDot.className = 'status-dot ready';
  dom.modelStatusText.textContent = 'Speech model ready';
  dom.recordBtn.disabled = false;
  dom.recordHint.textContent = 'Click to start recording  ·  Space';
}

function onWhisperError(error) {
  if (!error) return; // cleared by config change
  state.whisperError = error;
  dom.modelDot.className = 'status-dot error';
  dom.modelStatusText.textContent = 'Model error — see Settings';
  toast(`Whisper error: ${error}`, 'error');
}

// ─── Recording ───────────────────────────────────────────────────────────────
async function startRecording() {
  if (!state.whisperReady) {
    toast('Speech model is not ready yet', 'error');
    return;
  }

  // Request microphone
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1
      }
    });
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      toast('Microphone access denied. Please allow access in system settings.', 'error');
    } else {
      toast(`Microphone error: ${err.message}`, 'error');
    }
    return;
  }

  // Create session
  const session = await window.api.invoke('create-session');
  state.sessionId = session.id;

  // Reset per-recording state
  state.allSamples = [];
  state.chunkBuffer = [];
  state.transcript = '';
  state.wordCount = 0;
  state.transcriptPlaceholderGone = false;
  state.summarizer.reset();
  state.keyPointsLastUpdate = Date.now();
  state.streamingText = '';
  state.aiPolishUsed = false;

  // Set up Web Audio
  const audioContext = new AudioContext({ sampleRate: 16000 });
  state.audioContext = audioContext;
  state.micStream = stream;

  const source = audioContext.createMediaStreamSource(stream);
  state.sourceNode = source;

  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  state.analyserNode = analyser;
  source.connect(analyser);

  // ScriptProcessor for sample collection (deprecated but reliable in Electron)
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  state.processorNode = processor;

  processor.onaudioprocess = (e) => {
    const data = e.inputBuffer.getChannelData(0);
    const chunk = new Float32Array(data);
    state.allSamples.push(...chunk);
    state.chunkBuffer.push(...chunk);
  };

  source.connect(processor);
  processor.connect(audioContext.destination);

  // Flush chunks to Whisper on natural pauses instead of a fixed timer —
  // cutting mid-word is the single biggest transcription quality killer
  state.chunkInterval = setInterval(maybeFlushChunk, 500);

  // Timer
  state.recordingStart = Date.now();
  state.timerInterval = setInterval(updateTimer, 500);

  showScreen('recording');
  dom.recIndicator.classList.remove('hidden');
  startWaveform();
}

function rms(samples) {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

const SAMPLE_RATE = 16000;
const MIN_CHUNK_S = 3;     // don't transcribe fragments shorter than this
const MAX_CHUNK_S = 15;    // force a flush even mid-sentence past this
const PAUSE_WINDOW_S = 0.45;
const PAUSE_RMS = 0.01;    // trailing energy below this = natural pause
const SILENT_RMS = 0.004;  // whole chunk below this = nothing was said

function maybeFlushChunk() {
  const len = state.chunkBuffer.length;
  if (len < SAMPLE_RATE * MIN_CHUNK_S) return;

  const tail = state.chunkBuffer.slice(-Math.floor(SAMPLE_RATE * PAUSE_WINDOW_S));
  if (rms(tail) < PAUSE_RMS || len >= SAMPLE_RATE * MAX_CHUNK_S) {
    flushChunk();
  }
}

// Whisper hallucinates on silence/noise: bracketed sound effects like
// "(bell dings)", music notes, and YouTube-ish closers. Strip them so the
// transcript only contains real speech.
function cleanTranscription(text) {
  let t = text
    .replace(/\([^)]*\)|\[[^\]]*\]|♪+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return '';
  if (/^(thank you\.?|thanks for watching\.?|you\.?|bye\.?|\.)$/i.test(t)) return '';
  if (/subtitles? (by|provided|created)|amara\.org|www\./i.test(t)) return '';
  return t;
}

async function flushChunk() {
  if (state.chunkBuffer.length < SAMPLE_RATE * 1.5) return;

  const samples = [...state.chunkBuffer];
  state.chunkBuffer = [];

  // Nothing was said — don't burn compute and invite hallucinations
  if (rms(samples) < SILENT_RMS) return;

  try {
    const text = await window.api.invoke('transcribe-chunk', Array.from(samples));
    const cleaned = cleanTranscription(text || '');
    if (cleaned) {
      appendTranscript(cleaned);
      state.summarizer.addChunk(cleaned, Date.now());
      updateKeyPoints();
    }
  } catch (err) {
    console.warn('Transcription chunk failed:', err.message);
  }
}

async function stopRecording(doAiPolish) {
  // Stop audio capture
  clearInterval(state.chunkInterval);
  clearInterval(state.timerInterval);
  state.chunkInterval = null;
  state.timerInterval = null;

  if (state.processorNode) {
    state.processorNode.disconnect();
    state.processorNode = null;
  }
  if (state.sourceNode) {
    state.sourceNode.disconnect();
    state.sourceNode = null;
  }
  if (state.analyserNode) {
    state.analyserNode.disconnect();
    state.analyserNode = null;
  }

  if (state.micStream) {
    state.micStream.getTracks().forEach(t => t.stop());
    state.micStream = null;
  }

  if (state.audioContext) {
    await state.audioContext.close();
    state.audioContext = null;
  }

  stopWaveform();
  dom.recIndicator.classList.add('hidden');
  showScreen('processing');
  dom.processingTitle.textContent = 'Finalizing transcript…';
  dom.processingSub.textContent = 'Transcribing remaining audio…';

  // Flush remaining buffer
  if (state.chunkBuffer.length > 8000 && rms(state.chunkBuffer) >= SILENT_RMS) {
    try {
      const text = await window.api.invoke('transcribe-chunk', Array.from(state.chunkBuffer));
      const cleaned = cleanTranscription(text || '');
      if (cleaned) {
        appendTranscript(cleaned);
        state.summarizer.addChunk(cleaned, Date.now());
      }
    } catch (err) {
      console.warn('Final chunk transcription failed:', err);
    }
  }

  const duration = Math.round((Date.now() - state.recordingStart) / 1000);
  const wordCount = state.transcript.split(/\s+/).filter(Boolean).length;

  // Save session files
  const extractiveSummary = state.summarizer.getMarkdownSummary();
  const metadata = {
    timestamp: state.recordingStart,
    date: new Date(state.recordingStart).toISOString(),
    duration,
    wordCount,
    modelUsed: state.config.whisperModel || 'Xenova/whisper-base.en',
    aiPolished: false,
    title: generateTitle(state.transcript)
  };

  await window.api.invoke('save-session', {
    id: state.sessionId,
    audioSamples: Array.from(state.allSamples),
    transcript: state.transcript,
    summary: `# Extractive Summary\n\n${extractiveSummary}`,
    metadata
  });

  state.allSamples = [];

  heartConfetti();

  if (doAiPolish && state.config.apiKey) {
    dom.processingTitle.textContent = 'AI Polish Pass…';
    dom.processingSub.textContent = 'Claude is reading the transcript and composing a structured summary.';
    dom.skipAiBtn.classList.remove('hidden');

    showReviewScreen(state.transcript, '', metadata);
    // AI streaming starts immediately — review screen shows live
    doAiSummary(state.transcript, extractiveSummary, metadata);
  } else {
    showReviewScreen(state.transcript, `# Extractive Summary\n\n${extractiveSummary}`, metadata);
    showScreen('review');
    await loadSessionList();
  }
}

async function doAiSummary(transcript, keyPoints, metadata) {
  showScreen('review');
  dom.reviewSummary.innerHTML = '<span class="summary-streaming-cursor"></span>';
  state.streamingText = '';
  dom.summaryModelTag.textContent = 'claude-sonnet-4-20250514';

  try {
    await window.api.invoke('polish-summary', { transcript, keyPoints });
    // result handled via ai-stream-done event
  } catch (err) {
    if (err.message === 'NO_API_KEY') {
      useFallbackSummary(keyPoints, metadata);
      toast('No API key — using extractive summary', 'error');
    } else {
      toast(`AI summary failed: ${err.message}`, 'error');
      useFallbackSummary(keyPoints, metadata);
    }
  }
}

function useFallbackSummary(keyPoints, metadata) {
  const fallback = `# Extractive Summary\n\n${keyPoints}`;
  dom.summaryModelTag.textContent = 'extractive';
  renderMarkdown(fallback);
  saveFinalSummary(fallback, false, metadata);
}

function onAiChunk(text) {
  state.streamingText += text;
  // Remove cursor, append text, re-add cursor
  const cursor = '<span class="summary-streaming-cursor"></span>';
  dom.reviewSummary.innerHTML = escapeHtml(state.streamingText)
    .replace(/\n/g, '<br>') + cursor;
  dom.reviewSummary.closest('#review-summary-scroll').scrollTop = 9999;
}

function onAiDone(fullText) {
  dom.skipAiBtn.classList.add('hidden');
  state.aiPolishUsed = true;
  renderMarkdown(fullText || state.streamingText);
  saveFinalSummary(fullText || state.streamingText, true, null);
  loadSessionList();
}

function onAiError(err) {
  dom.skipAiBtn.classList.add('hidden');
  toast(`AI stream error: ${err}`, 'error');
  useFallbackSummary(state.summarizer.getMarkdownSummary(), null);
}

function skipAiPolish() {
  window.api.invoke('cancel-polish');
  dom.skipAiBtn.classList.add('hidden');
  const fallback = `# Extractive Summary\n\n${state.summarizer.getMarkdownSummary()}`;
  dom.summaryModelTag.textContent = 'extractive';
  renderMarkdown(fallback);
  saveFinalSummary(fallback, false, null);
  loadSessionList();
}

async function saveFinalSummary(summary, aiPolished, metadata) {
  try {
    const updates = { summary };
    if (metadata) {
      updates.metadata = { ...metadata, aiPolished };
    } else {
      // Re-read existing metadata and patch
      const session = await window.api.invoke('get-session', state.sessionId);
      updates.metadata = { ...session.metadata, aiPolished };
    }
    updates.id = state.sessionId;
    await window.api.invoke('save-session', updates);
    state.summary = summary;
  } catch (e) {
    console.warn('Failed to save summary:', e);
  }
}

// ─── Transcript UI ───────────────────────────────────────────────────────────
function appendTranscript(text) {
  if (!state.transcriptPlaceholderGone) {
    dom.transcriptText.innerHTML = '';
    state.transcriptPlaceholderGone = true;
  }

  state.transcript += (state.transcript ? ' ' : '') + text;
  state.wordCount = state.transcript.split(/\s+/).filter(Boolean).length;
  dom.wordCount.textContent = `${state.wordCount} words`;

  const elapsed = formatTime(Math.round((Date.now() - state.recordingStart) / 1000));
  const chunk = document.createElement('div');
  chunk.className = 'transcript-chunk new';
  chunk.innerHTML = `<span class="transcript-timestamp">[${elapsed}]</span>${escapeHtml(text)}`;
  dom.transcriptText.appendChild(chunk);

  // Auto scroll
  requestAnimationFrame(() => {
    dom.transcriptScroll.scrollTop = dom.transcriptScroll.scrollHeight;
  });
}

function updateKeyPoints() {
  const points = state.summarizer.getKeyPoints();
  if (points.length === 0) return;

  dom.keypointsList.innerHTML = '';
  points.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'keypoint-item';
    el.innerHTML = `<span class="keypoint-num">KEY POINT ${i + 1}</span>${escapeHtml(p)}`;
    dom.keypointsList.appendChild(el);
  });

  state.keyPointsLastUpdate = Date.now();
  dom.keypointsLabel.textContent = 'just updated';
  setTimeout(() => { dom.keypointsLabel.textContent = 'updates every 30s'; }, 3000);
}

// ─── Waveform ────────────────────────────────────────────────────────────────
let waveformRaf = null;

function startWaveform() {
  const canvas = dom.waveformCanvas;
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width = canvas.offsetWidth * devicePixelRatio;
    canvas.height = canvas.offsetHeight * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
  }
  resize();
  window.addEventListener('resize', resize);

  const analyser = state.analyserNode;
  if (!analyser) return;

  const dataArray = new Uint8Array(analyser.frequencyBinCount);

  function draw() {
    waveformRaf = requestAnimationFrame(draw);
    analyser.getByteTimeDomainData(dataArray);

    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    ctx.clearRect(0, 0, w, h);

    ctx.lineWidth = 2;
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#f472b6');
    grad.addColorStop(0.5, '#ec4899');
    grad.addColorStop(1, '#d946ef');
    ctx.strokeStyle = grad;
    ctx.shadowColor = 'rgba(236, 72, 153, 0.45)';
    ctx.shadowBlur = 6;
    ctx.beginPath();

    const sliceWidth = w / dataArray.length;
    let x = 0;

    for (let i = 0; i < dataArray.length; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * h) / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceWidth;
    }

    ctx.lineTo(w, h / 2);
    ctx.stroke();
  }

  draw();
}

function stopWaveform() {
  if (waveformRaf) {
    cancelAnimationFrame(waveformRaf);
    waveformRaf = null;
  }
  const canvas = dom.waveformCanvas;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// ─── Timer ───────────────────────────────────────────────────────────────────
function updateTimer() {
  const elapsed = Math.round((Date.now() - state.recordingStart) / 1000);
  dom.recTimer.textContent = formatTime(elapsed);
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ─── Review Screen ───────────────────────────────────────────────────────────
function showReviewScreen(transcript, summary, metadata) {
  dom.reviewTranscript.textContent = transcript || '(no transcript)';

  if (summary) {
    renderMarkdown(summary);
    dom.summaryModelTag.textContent = metadata?.aiPolished ? 'claude-sonnet-4-20250514' : 'extractive';
  }

  const date = metadata?.timestamp
    ? new Date(metadata.timestamp).toLocaleString()
    : 'Just now';
  const duration = metadata?.duration ? formatTime(metadata.duration) : '—';
  dom.reviewTitle.textContent = `${metadata?.title || 'Lecture'} — ${date} · ${duration}`;

  state.currentSession = { transcript, summary, metadata, id: state.sessionId };
}

// ─── Markdown renderer (minimal) ─────────────────────────────────────────────
function renderMarkdown(md) {
  const html = md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // headings
    .replace(/^#### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // bold/italic
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // unordered lists
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
    // ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // paragraphs
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  dom.reviewSummary.innerHTML = `<p>${html}</p>`;
}

// ─── Session Sidebar ─────────────────────────────────────────────────────────
async function loadSessionList() {
  const sessions = await window.api.invoke('list-sessions');
  dom.sessionList.innerHTML = '';

  if (sessions.length === 0) {
    dom.sessionList.innerHTML = '<div class="empty-sessions">No recordings yet</div>';
    return;
  }

  sessions.forEach(session => {
    const el = document.createElement('div');
    el.className = 'session-item';
    if (session.id === state.sessionId) el.classList.add('active');

    const date = session.date
      ? new Date(session.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : 'Unknown date';
    const duration = session.duration ? formatTime(session.duration) : '—';
    const words = session.wordCount ? `${session.wordCount} words` : '';

    el.innerHTML = `
      <div class="session-date">${date}</div>
      <div class="session-title">${escapeHtml(session.title || 'Untitled Lecture')}</div>
      <div class="session-meta">${duration}${words ? ' · ' + words : ''}</div>
    `;

    el.addEventListener('click', () => openSession(session.id));
    dom.sessionList.appendChild(el);
  });
}

async function openSession(id) {
  const data = await window.api.invoke('get-session', id);
  state.sessionId = id;

  showScreen('review');
  dom.reviewTranscript.textContent = data.transcript || '(no transcript)';

  if (data.summary) {
    renderMarkdown(data.summary);
    dom.summaryModelTag.textContent = data.metadata?.aiPolished ? 'claude-sonnet-4-20250514' : 'extractive';
  } else {
    dom.reviewSummary.innerHTML = '<em style="color:var(--text-dim)">No summary available.</em>';
  }

  const date = data.metadata?.date
    ? new Date(data.metadata.date).toLocaleString()
    : 'Unknown date';
  const duration = data.metadata?.duration ? formatTime(data.metadata.duration) : '—';
  dom.reviewTitle.textContent = `${data.metadata?.title || 'Lecture'} — ${date} · ${duration}`;

  state.currentSession = { ...data, id };

  // Highlight sidebar
  document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'));
  const match = [...document.querySelectorAll('.session-item')]
    .find(el => el.querySelector('.session-title') && state.sessionId === id);
  if (match) match.classList.add('active');
}

// ─── Export & Actions ────────────────────────────────────────────────────────
async function copySummary() {
  const text = dom.reviewSummary.innerText || dom.reviewSummary.textContent;
  await navigator.clipboard.writeText(text);
  toast('Summary copied to clipboard', 'success');
}

async function exportPdf() {
  try {
    const result = await window.api.invoke('export-pdf', { sessionId: state.sessionId });
    if (!result.cancelled) toast(`PDF saved: ${result.filePath}`, 'success');
  } catch (e) {
    toast(`Export failed: ${e.message}`, 'error');
  }
}

function openFolder() {
  if (state.sessionId) {
    window.api.invoke('open-session-folder', state.sessionId);
  }
}

// ─── Settings ────────────────────────────────────────────────────────────────
function openSettings() {
  dom.setupTitle.textContent = 'Settings';
  dom.setupDesc.innerHTML = `Configure your Anthropic API key and Whisper model.
    Key is stored at <code>~/.lecturevault/config.json</code>.`;
  dom.apiKeyInput.value = state.config.apiKey || '';
  dom.modelSelect.value = state.config.whisperModel || 'Xenova/whisper-base.en';
  dom.setupMsg.textContent = '';
  dom.setupCancelBtn.classList.remove('hidden');
  dom.screenSetup.classList.remove('hidden');
}

function closeSettings() {
  dom.screenSetup.classList.add('hidden');
}

async function saveSettings() {
  const apiKey = dom.apiKeyInput.value.trim();
  const model = dom.modelSelect.value;

  if (apiKey && !apiKey.startsWith('sk-ant-')) {
    dom.setupMsg.textContent = 'API key should start with sk-ant-';
    dom.setupMsg.className = 'error-msg';
    return;
  }

  try {
    const previousModel = state.config.whisperModel;
    const config = await window.api.invoke('set-config', { apiKey, whisperModel: model });
    state.config = config;
    dom.setupMsg.textContent = 'Saved! 💖';
    dom.setupMsg.className = 'success-msg';

    if (model !== previousModel) {
      state.whisperReady = false;
      dom.modelDot.className = 'status-dot loading';
      dom.modelStatusText.textContent = 'Loading new model…';
      dom.recordBtn.disabled = true;
    }

    setTimeout(closeSettings, 800);
  } catch (e) {
    dom.setupMsg.textContent = `Error: ${e.message}`;
    dom.setupMsg.className = 'error-msg';
  }
}

// ─── Screen management ───────────────────────────────────────────────────────
function showScreen(name) {
  state.screen = name;
  dom.screenIdle.classList.toggle('hidden', name !== 'idle');
  dom.screenRecording.classList.toggle('hidden', name !== 'recording');
  dom.screenProcessing.classList.toggle('hidden', name !== 'processing');
  dom.screenReview.classList.toggle('hidden', name !== 'review');
}

function goIdle() {
  showScreen('idle');
  state.sessionId = null;
  state.currentSession = null;
  document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function generateTitle(transcript) {
  if (!transcript) return 'Untitled Lecture';
  // Take first meaningful sentence or first ~60 chars
  const first = transcript.split(/[.!?]/)[0] || transcript;
  return first.trim().slice(0, 60) || 'Untitled Lecture';
}

function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  dom.toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ─── Sparkles & Heart Confetti ───────────────────────────────────────────────
const SPARKLE_CHARS = ['✨', '💖', '🌸', '⭐', '💕', '🎀', '🦄', '💗'];

function spawnSparkle() {
  if (state.screen !== 'idle') return;
  const el = document.createElement('span');
  el.className = 'floating-sparkle';
  el.textContent = SPARKLE_CHARS[Math.floor(Math.random() * SPARKLE_CHARS.length)];
  el.style.left = `${Math.random() * 100}%`;
  el.style.fontSize = `${10 + Math.random() * 16}px`;
  el.style.animationDuration = `${6 + Math.random() * 6}s`;
  el.style.animationDelay = `${Math.random() * 2}s`;
  dom.screenIdle.appendChild(el);
  setTimeout(() => el.remove(), 14000);
}

setInterval(spawnSparkle, 1400);
for (let i = 0; i < 6; i++) setTimeout(spawnSparkle, i * 300);

function heartConfetti() {
  const HEARTS = ['💖', '💕', '💗', '🩷', '✨', '🌸', '🎀'];
  for (let i = 0; i < 36; i++) {
    const el = document.createElement('span');
    el.className = 'confetti-heart';
    el.textContent = HEARTS[Math.floor(Math.random() * HEARTS.length)];
    el.style.left = `${Math.random() * 100}vw`;
    el.style.fontSize = `${14 + Math.random() * 22}px`;
    el.style.animationDuration = `${2 + Math.random() * 2.5}s`;
    el.style.animationDelay = `${Math.random() * 0.7}s`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5500);
  }
}

// ─── Boot ────────────────────────────────────────────────────────────────────
init().catch(err => {
  console.error('Init failed:', err);
  toast(`Init error: ${err.message}`, 'error');
});
