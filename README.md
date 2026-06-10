# LectureVault

A warm, polished desktop lecture recorder. It transcribes **locally** with Whisper,
summarizes **live** with TF-IDF extraction, and — optionally — polishes your notes
with Claude when the lecture ends. Everything except that last optional step works
fully offline.

```
┌─────────────┬──────────────────────┬─────────────────┐
│   Library   │   Live Transcript    │   Key Points    │
│  (sessions) │   (words fade in)    │  (index cards)  │
└─────────────┴──────────────────────┴─────────────────┘
```

## Prerequisites

| Requirement | Why | Install |
|---|---|---|
| Node.js ≥ 18 + npm | dev & build tooling | nodejs.org |
| **whisper.cpp** (recommended) | local transcription engine | `brew install whisper-cpp` (macOS) |
| *or* openai-whisper (fallback) | same, slower | `pip install openai-whisper` |
| ffmpeg | only needed by the Python fallback | `brew install ffmpeg` |

The app detects whichever engine is present (`whisper-cli`, `whisper-cpp`, or the
Python `whisper` CLI). On macOS the onboarding flow can install whisper.cpp for you
through Homebrew. **Whisper models** (the ggml weights) are managed entirely in-app —
downloaded on first run with a progress bar into `~/.lecturevault/models/`.

## Local development

```bash
npm install
npm start          # launch the app
npm test           # unit tests (summarizer, WAV writer, markdown, sessions)
```

## Building installers

```bash
npm run build:mac      # → dist/LectureVault-*.dmg
npm run build:win      # → dist/LectureVault Setup *.exe   (NSIS)
npm run build:linux    # → dist/LectureVault-*.AppImage
```

Cross-building Windows installers from macOS requires Wine; otherwise build each
target on its own platform. The packaged app bundles the fonts and the Anthropic
SDK; Whisper engines/models are intentionally *not* bundled (the engine is a system
package, models are downloaded in-app on first run).

## First-run configuration

On first launch the app walks you through:

1. **Welcome**
2. **Microphone permission** — macOS will prompt; if you decline, fix it later in
   System Settings → Privacy & Security → Microphone.
3. **Whisper model choice** — `tiny` (75 MB, fastest) through `medium` (1.5 GB,
   most accurate). Downloads with a real progress bar.
4. **Anthropic API key** *(optional, skippable)* — enables the AI polish pass.
   "Test Key" validates it with a trivial API call before you commit.
5. A short tour, then you land on the home screen.

All preferences live in `~/.lecturevault/config.json` (key stored with `0600`
permissions, never hardcoded). Recordings are saved to `~/LectureVault/` by
default — change it in Settings.

### Session folders

Every lecture becomes `~/LectureVault/YYYY-MM-DD_HH-MM/`:

```
audio.wav          raw 16 kHz mono microphone recording
transcript.txt     full verbatim transcript (with [section] markers)
summary.md         extractive or AI-polished summary (labeled)
metadata.json      date, duration, word count, whisper model, polish flag
```

## Adding a new Whisper model

1. Add an entry to `MODEL_INFO` in `src/main/whisper.js` — file name, download URL
   (any ggml-format model, e.g. from `huggingface.co/ggerganov/whisper.cpp`), and
   approximate size for the progress bar.
2. Add a matching description in `MODEL_DESCRIPTIONS` (`src/renderer/js/onboarding.js`)
   and `MODEL_NOTES` (`src/renderer/js/settings-ui.js`).
3. The download, verification, and selection UI pick it up automatically.

## Architecture notes

- **Main process** (`src/main/`): window lifecycle, config, model downloads,
  WAV assembly, chunked Whisper transcription (8 s chunks cut at the quietest
  moment so words don't get split), session storage/search, Anthropic streaming,
  styled PDF export via an offscreen window.
- **Renderer** (`src/renderer/`): an AudioWorklet streams 16 kHz PCM to the main
  process; TF-IDF extractive summarization and topic-shift detection (silence
  gaps + transition phrases) run continuously in the page; all UI states are
  fully styled — no placeholder panels.
- **Privacy**: audio and transcripts never leave the machine unless you click
  "Finish & Summarize" *with* AI polish enabled — and the extractive summary is
  always saved first, so a failed/offline polish never loses work.
