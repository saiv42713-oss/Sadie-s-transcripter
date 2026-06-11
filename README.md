# 🎀 Sadie's Transcriptor

A super cute pink lecture recorder and summarizer. Records your microphone, transcribes speech **entirely in your browser** using Whisper, extracts key points in real time, and optionally polishes the summary with Claude AI.

## ✨ Use it right now — no install

### 👉 **https://saiv42713-oss.github.io/Sadie-s-transcripter/** 👈

That's it. Open the link, allow microphone access, press the big heart 💗, and start talking. Everything runs in your browser:

- **Whisper speech recognition** — transformers.js v3 with WebGPU acceleration (WASM fallback), downloaded once and cached
- **Your recordings** — stored privately in your browser (IndexedDB), never uploaded anywhere
- **Live transcript + key points** — appears as you speak
- **AI summary (optional)** — add an Anthropic API key in Settings if you want Claude-polished notes

No account, no server, no API needed for transcription. The first visit downloads the speech model (~250 MB for the default `whisper-small.en`); after that it loads instantly from cache.

> 💡 Tip: in Settings you can pick `whisper-tiny.en` (fast, ~40 MB) up to `whisper-large-v3-turbo` (best quality ✨, ~1.6 GB, needs a fast computer).

---

## Features

- **100% local transcription** — Whisper runs on your machine, online or installed
- **Pause-aware chunking** — audio is split on natural speech pauses, not mid-word
- **Hallucination filtering** — Whisper's "(bell dings)" / "Thanks for watching!" ghosts never reach your transcript
- **Live rolling transcript** with timestamps and word count
- **Pink gradient waveform** so you know the mic is hot 💕
- **Extractive key points** — TF-IDF sentence scoring updates as you talk
- **AI polish pass** — optional Claude summary with streaming output
- **Session history** — every recording saved with audio, transcript, and summary
- **Export** — copy summary, print/save as PDF, download audio
- Floating sparkles and heart confetti, obviously ✨

---

## Run the web app locally

```bash
git clone https://github.com/saiv42713-oss/Sadie-s-transcripter.git
cd Sadie-s-transcripter
npm run web        # serves http://localhost:8425
```

(Any static file server pointed at `src/renderer/` works — there is no backend.)

---

## Optional: desktop app (Electron)

Prefer a standalone desktop app with files saved to `~/LectureVault/`?

```bash
npm install
npm start          # development
npm run build:mac  # package .dmg (also build:win / build:linux)
```

The desktop version uses the exact same UI; it just stores sessions as real files and runs Whisper in a Node worker thread instead of a Web Worker.

---

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Space` | Start / stop recording |

---

## Architecture

```
src/renderer/
  index.html             — Shell (web + Electron)
  styles.css             — Pink dream design system 🎀
  app.js                 — UI state machine, audio capture, VAD chunking
  summarizer.js          — TF-IDF extractive summarizer
  web-api.js             — Browser backend: IndexedDB, localStorage, Web Worker, Anthropic CORS
  web-whisper-worker.js  — Whisper in a Web Worker (WebGPU/WASM)

main.js                  — Electron main process: IPC, file I/O, Anthropic API
preload.js               — Secure IPC bridge (contextBridge)
src/whisper-worker.js    — Whisper in a Node worker thread
src/storage.js           — ~/LectureVault/ file management (Electron)
src/config.js            — ~/.lecturevault/config.json (Electron)
```

The web and desktop versions share all UI code. `web-api.js` implements the same
`window.api` contract as the Electron preload, so `app.js` doesn't know or care
which environment it's in.

### Publishing site updates

The site serves the `gh-pages` branch (a snapshot of `src/renderer/`). After changing renderer files on `main`:

```bash
git subtree split --prefix=src/renderer -b gh-pages
git push <remote> gh-pages:gh-pages --force
```

---

## Privacy

All audio processing and transcription is local. Audio never leaves your device. If you explicitly add an API key and click **Finish & Summarize**, the transcript text (never audio) is sent to the Anthropic API — otherwise nothing is sent anywhere, ever. 💖
