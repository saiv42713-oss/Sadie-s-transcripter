// App orchestration: state machine (IDLE → RECORDING → PROCESSING → REVIEW),
// wiring between recorder, transcript, key points, sessions and polish.
(function () {
  const $ = (id) => document.getElementById(id);
  const states = ['idle', 'recording', 'processing', 'review'];

  /* ---------- tiny markdown renderer for the summary pane ---------- */
  function mdToHtml(md) {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const inline = (s) => s
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>');
    let html = '', inList = false;
    const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
    for (const line of esc(md).split('\n')) {
      const t = line.trim();
      if (/^###\s/.test(t)) { closeList(); html += `<h3>${inline(t.slice(4))}</h3>`; }
      else if (/^##\s/.test(t)) { closeList(); html += `<h2>${inline(t.slice(3))}</h2>`; }
      else if (/^#\s/.test(t)) { closeList(); html += `<h2>${inline(t.slice(2))}</h2>`; }
      else if (/^[-*]\s/.test(t)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(t.slice(2))}</li>`; }
      else if (/^---+$/.test(t)) { closeList(); html += '<hr style="border:none;border-top:1.5px solid var(--border);margin:14px 0">'; }
      else if (t === '') { closeList(); }
      else { closeList(); html += `<p>${inline(t)}</p>`; }
    }
    closeList();
    return html;
  }

  /* ---------- toast ---------- */
  let toastTimer = null;
  function showToast(msg, ms = 3200) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
  }

  /* ---------- state machine ---------- */
  function setState(name) {
    for (const s of states) $(`state-${s}`).classList.toggle('hidden', s !== name);
    // Key points panel is the live companion; in review it shows the last run's cards.
    app.state = name;
  }

  const app = {
    state: 'idle',
    cfg: null,
    recorder: null,
    waveform: null,
    transcript: null,
    keypoints: null,
    sessionsUI: null,
    settingsUI: null,
    sessionDir: null,
    recStart: 0,
    timerInterval: null,
    kpInterval: null,
    current: null // { dir, transcript, summary, metadata } shown in review
  };

  /* ---------- recording flow ---------- */
  async function startRecording() {
    app.cfg = await window.vault.config.get();

    const status = await window.vault.whisper.status();
    if (!status.engine) {
      showToast("Still warming up — Whisper isn't installed yet. Open Settings for a hand.", 4600);
      return;
    }
    if (!status.models[app.cfg.whisperModel]) {
      showToast(`The ${app.cfg.whisperModel} model isn't downloaded yet — grab it in Settings.`, 4600);
      return;
    }

    const granted = await window.vault.mic.request();
    if (!granted) {
      showToast('We couldn’t access your microphone. Check System Settings → Privacy → Microphone and try again.', 5200);
      return;
    }

    // Main-process recorder must exist before the worklet starts pushing PCM,
    // otherwise the opening words of the lecture get dropped.
    app.sessionDir = await window.vault.record.start();

    try {
      app.recorder = new Recorder();
      app.recorder.silenceGapSeconds = app.cfg.silenceGapSeconds;
      app.recorder.onLevel = (rms) => app.waveform.push(rms);
      app.recorder.onSilenceGap = () => app.transcript.queueSectionBreak();
      await app.recorder.start();
    } catch (err) {
      await window.vault.record.cancel();
      app.sessionDir = null;
      showToast('We couldn’t access your microphone. Check System Settings → Privacy → Microphone and try again.', 5200);
      return;
    }
    app.transcript.reset();
    app.keypoints.reset();
    setState('recording');
    app.waveform.start();

    app.recStart = Date.now();
    const timerEl = $('rec-timer');
    app.timerInterval = setInterval(() => {
      const s = Math.floor((Date.now() - app.recStart) / 1000);
      timerEl.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }, 500);

    // Key points refresh roughly every 30 seconds.
    app.kpInterval = setInterval(refreshKeyPoints, 30000);
  }

  function refreshKeyPoints() {
    if (!app.transcript.text) return;
    const kps = window.Summarizer.extractKeyPoints(app.transcript.text);
    app.keypoints.update(kps, app.transcript.sections);
  }

  async function stopRecordingHardware() {
    clearInterval(app.timerInterval);
    clearInterval(app.kpInterval);
    app.waveform.stop();
    if (app.recorder) { await app.recorder.stop(); app.recorder = null; }
  }

  async function cancelRecording() {
    await stopRecordingHardware();
    await window.vault.record.cancel();
    app.sessionDir = null;
    setState('idle');
    showToast('Recording discarded — nothing was saved.');
  }

  async function finishRecording() {
    await stopRecordingHardware();
    setState('processing');
    $('processing-title').textContent = 'Catching the last few words…';
    $('processing-message').textContent = 'Whisper is transcribing the final stretch of audio. This is the slow, careful part.';
    $('processing-fill').classList.add('indeterminate');

    const result = await window.vault.record.finish();
    if (!result) { setState('idle'); return; }

    const transcriptText = app.transcript.text.trim();
    const keyPoints = window.Summarizer.extractKeyPoints(transcriptText, 8);
    app.keypoints.update(keyPoints, app.transcript.sections);

    const metadata = {
      date: new Date().toISOString(),
      durationSeconds: Math.round(result.durationSeconds),
      wordCount: transcriptText.split(/\s+/).filter(Boolean).length,
      whisperModel: app.cfg.whisperModel,
      aiPolished: false,
      title: ''
    };

    // Persist transcript + extractive summary immediately, so nothing is lost
    // even if the polish step fails midway.
    const extractiveMd = window.Summarizer.extractiveSummaryMd(transcriptText, keyPoints, app.transcript.sections);
    const savedMeta = await window.vault.sessions.save({
      dir: result.dir, transcript: transcriptText, summary: extractiveMd, metadata
    });

    app.current = { dir: result.dir, transcript: transcriptText, summary: extractiveMd, metadata: savedMeta };
    enterReview(app.current);

    const wantPolish = app.cfg.aiPolish && app.cfg.apiKey && transcriptText.length > 80;
    if (wantPolish) await runPolish(keyPoints);
    await app.sessionsUI.refresh();
  }

  async function runPolish(keyPoints) {
    const summaryEl = $('review-summary');
    summaryEl.innerHTML = '<p style="color:var(--text-secondary)"><em>✦ Claude is polishing your notes…</em></p>';
    let streamed = '';
    const off = window.vault.polish.onDelta((delta) => {
      streamed += delta;
      summaryEl.innerHTML = mdToHtml(streamed);
      summaryEl.scrollTop = summaryEl.scrollHeight;
    });

    const res = await window.vault.polish.run({
      transcript: app.current.transcript,
      keyPoints,
      sections: app.transcript.sections
    });
    off();

    if (res.ok) {
      app.current.summary = res.text;
      app.current.metadata.aiPolished = true;
      $('ai-badge').classList.remove('hidden');
      summaryEl.innerHTML = mdToHtml(res.text);
      await window.vault.sessions.save({
        dir: app.current.dir,
        transcript: app.current.transcript,
        summary: `<!-- AI-polished -->\n${res.text}`,
        metadata: app.current.metadata
      });
    } else {
      summaryEl.innerHTML = mdToHtml(app.current.summary);
      const msgs = {
        OFFLINE: "You're offline right now. You can still use your extracted summary below — it's pretty good on its own.",
        BAD_KEY: "That key didn't work. Double-check it in Settings and try again.",
        NO_API_KEY: 'Add an API key in Settings to enable AI polish.',
        UNKNOWN: "The AI polish didn't go through — your extractive summary is saved and safe."
      };
      showToast(msgs[res.code] || msgs.UNKNOWN, 5200);
    }
  }

  /* ---------- review ---------- */
  function enterReview({ transcript, summary, metadata }) {
    setState('review');
    $('review-title').textContent = metadata.title || 'Untitled lecture';
    const d = new Date(metadata.date);
    $('review-meta').textContent =
      `${isNaN(d) ? '' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ` +
      `${window.fmtDuration(metadata.durationSeconds)} · ${metadata.wordCount || 0} words`;
    const isPolished = metadata.aiPolished || /^<!-- AI-polished -->/.test(summary);
    $('ai-badge').classList.toggle('hidden', !isPolished);
    $('review-transcript').textContent = transcript || '(empty transcript)';
    $('review-summary').innerHTML = mdToHtml(summary.replace(/^<!-- AI-polished -->\n?/, ''));
  }

  async function openSession(dir) {
    const data = await window.vault.sessions.load(dir);
    app.current = data;
    enterReview(data);
    // Show this session's key points on the side panel for context.
    const kps = window.Summarizer.extractKeyPoints(data.transcript || '', 7);
    app.keypoints.reset();
    app.keypoints.update(kps, []);
  }

  /* ---------- export ---------- */
  function cleanSummary() {
    return (app.current?.summary || '').replace(/^<!-- AI-polished -->\n?/, '');
  }

  async function copySummary() {
    if (!app.current) return;
    await window.vault.exporter.copy(cleanSummary());
    showToast('Summary copied to clipboard.');
  }

  async function exportPdf() {
    if (!app.current) return;
    const m = app.current.metadata;
    const d = new Date(m.date);
    const res = await window.vault.exporter.pdf({
      title: m.title || 'Untitled lecture',
      date: isNaN(d) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
      duration: window.fmtDuration(m.durationSeconds),
      summaryMd: cleanSummary(),
      aiPolished: !!m.aiPolished
    });
    if (res.ok) showToast('PDF saved. It looks lovely.');
  }

  /* ---------- boot ---------- */
  async function boot() {
    app.cfg = await window.vault.config.get();

    app.waveform = new Waveform($('waveform'));
    app.transcript = new LiveTranscript($('live-transcript'));
    app.keypoints = new KeyPointsPanel($('keypoints-list'), $('keypoints-hint'));
    app.settingsUI = new SettingsUI(showToast);
    app.sessionsUI = new SessionsUI({
      listEl: $('session-list'),
      searchEl: $('session-search'),
      recentEl: $('recent-sessions'),
      recentBlock: $('recent-block'),
      onOpen: openSession
    });

    window.vault.record.onSegment(({ text }) => {
      if (app.state !== 'recording' && app.state !== 'processing') return;
      app.transcript.appendSegment(text);
      // Early refresh so the panel isn't empty for the first half minute.
      if (app.keypoints.current.length === 0) refreshKeyPoints();
    });

    window.vault.record.onError(({ code }) => {
      if (code === 'NO_ENGINE') {
        showToast("Still warming up — Whisper is loading the model. This only takes a moment on first use.", 5000);
      }
    });

    $('btn-record').addEventListener('click', startRecording);
    $('btn-cancel').addEventListener('click', cancelRecording);
    $('btn-finish').addEventListener('click', finishRecording);
    $('btn-settings').addEventListener('click', () => app.settingsUI.open());
    $('btn-back-home').addEventListener('click', () => setState('idle'));
    $('btn-copy').addEventListener('click', copySummary);
    $('btn-pdf').addEventListener('click', exportPdf);
    $('btn-reveal').addEventListener('click', () => app.current && window.vault.exporter.reveal(app.current.dir));
    $('btn-mono').addEventListener('click', () => {
      $('review-transcript').classList.toggle('mono');
      $('btn-mono').classList.toggle('on');
    });

    await app.sessionsUI.refresh();
    $('app').classList.remove('hidden');
    window.injectIcons();

    if (!app.cfg.onboarded) {
      new Onboarding(async () => {
        app.cfg = await window.vault.config.get();
        await app.sessionsUI.refresh();
      }).start();
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
