# LectureVault

A professional lecture recorder and summarizer. Records your microphone, transcribes speech offline using Whisper, extracts key points in real time, and optionally polishes the summary with Claude AI.

---

## Features

- **Offline transcription** — Whisper runs entirely on your machine via `@xenova/transformers` (ONNX/WASM, no Python needed)
- **Live rolling transcript** — text appears chunk by chunk as you speak
- **Waveform visualizer** — confirms the mic is active
- **Extractive key points** — TF-IDF sentence scoring updates every ~30 seconds
- **Topic shift detection** — section breaks on transition phrases
- **AI polish pass** — optional Claude (claude-sonnet-4-20250514) summary with streaming output
- **Session history** — every lecture saved to `~/LectureVault/` with audio, transcript, and summary
- **Export** — copy summary to clipboard or save as PDF

---

## Requirements

- Node.js 18+ and npm
- No Python, no cloud services, no external tools

---

## Setup

```bash
# Clone and install
git clone <repo>
cd lecturevault
npm install

# Start in development mode
npm start
```

On first launch the app downloads the Whisper model (~74 MB for the default `whisper-base.en`). A progress bar is shown — this only happens once.

---

## Anthropic API Key (optional)

The AI polish pass requires an Anthropic API key. Click **Settings** in the sidebar to enter it. The key is stored at `~/.lecturevault/config.json` — never in the source code.

You can skip the AI step and use the offline extractive summary instead.

---

## Whisper Models

| Model | Size | Speed | Quality |
|-------|------|-------|---------|
| whisper-tiny.en | ~39 MB | Fastest | Basic |
| whisper-base.en (default) | ~74 MB | Fast | Good |
| whisper-small.en | ~244 MB | Medium | Better |
| whisper-medium.en | ~769 MB | Slow | Best |

Change the model in Settings. The new model downloads automatically on the next launch.

---

## Session Files

Each recording is saved to `~/LectureVault/<session-id>/`:

| File | Contents |
|------|----------|
| `audio.wav` | Raw 16 kHz mono recording |
| `transcript.txt` | Full verbatim transcript |
| `summary.md` | Extractive or AI-polished summary |
| `metadata.json` | Date, duration, word count, model used |

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Start / Stop recording (when idle/recording) |

---

## Packaging

```bash
# macOS (.dmg)
npm run build:mac

# Windows (.exe installer)
npm run build:win

# Linux (.AppImage)
npm run build:linux

# All platforms
npm run build
```

Built packages are written to `dist/`. The packaged app bundles Whisper ONNX and all JS dependencies — no manual installs required on the target machine.

### Platform notes

**macOS**: Requires microphone permission approval on first launch (system dialog).

**Windows**: The NSIS installer offers a per-user or per-machine install. Microphone permission is handled by Windows privacy settings.

**Linux**: AppImage is self-contained. Microphone access depends on PulseAudio/PipeWire being available.

---

## Architecture

```
main.js              — Electron main process: IPC, file I/O, Anthropic API
preload.js           — Secure IPC bridge (contextBridge)
src/whisper-worker.js— Worker thread: @xenova/transformers Whisper pipeline
src/storage.js       — ~/LectureVault/ file management
src/config.js        — ~/.lecturevault/config.json
src/renderer/
  index.html         — Shell
  styles.css         — Dark editorial design system
  app.js             — UI state machine, audio capture, IPC calls
  summarizer.js      — TF-IDF extractive summarizer (browser JS)
```

---

## Privacy

All audio processing and transcription is local. Audio is never sent to any server unless you explicitly click **Finish & Summarize** with an API key configured, in which case the transcript text (not audio) is sent to the Anthropic API.
