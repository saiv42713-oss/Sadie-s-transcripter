// Receives 16-bit PCM chunks from the renderer, maintains:
//  - the full session WAV (header patched on finalize)
//  - rolling chunk WAVs handed to Whisper for live transcription
const fs = require('fs');
const path = require('path');
const os = require('os');

const SAMPLE_RATE = 16000;

function wavHeader(dataBytes, sampleRate = SAMPLE_RATE) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);          // PCM chunk size
  h.writeUInt16LE(1, 20);           // PCM format
  h.writeUInt16LE(1, 22);           // mono
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28); // byte rate (16-bit mono)
  h.writeUInt16LE(2, 32);           // block align
  h.writeUInt16LE(16, 34);          // bits per sample
  h.write('data', 36);
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

class SessionRecorder {
  constructor(sessionDir) {
    this.sessionDir = sessionDir;
    this.wavPath = path.join(sessionDir, 'audio.wav');
    this.fd = fs.openSync(this.wavPath, 'w');
    fs.writeSync(this.fd, wavHeader(0)); // placeholder, patched in finalize()
    this.dataBytes = 0;

    this.pending = [];      // Int16 buffers awaiting transcription
    this.pendingBytes = 0;
    this.chunkIndex = 0;
    this.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-chunks-'));
  }

  // pcm: Buffer of Int16LE samples at 16kHz
  append(pcm) {
    fs.writeSync(this.fd, pcm);
    this.dataBytes += pcm.length;
    this.pending.push(pcm);
    this.pendingBytes += pcm.length;
  }

  get pendingSeconds() {
    return this.pendingBytes / 2 / SAMPLE_RATE;
  }

  // Cut the pending buffer at the quietest point near its end so we don't
  // split words mid-syllable, write it as a chunk WAV, and return its path.
  cutChunk() {
    if (this.pendingBytes === 0) return null;
    const all = Buffer.concat(this.pending, this.pendingBytes);

    let cutByte = all.length;
    const totalSamples = all.length / 2;
    const windowSamples = Math.floor(SAMPLE_RATE * 0.25); // 250ms energy windows
    const searchStart = Math.max(0, totalSamples - SAMPLE_RATE * 3); // last 3s
    if (totalSamples - searchStart > windowSamples * 2) {
      let bestEnergy = Infinity, bestEnd = totalSamples;
      for (let s = searchStart; s + windowSamples <= totalSamples; s += windowSamples) {
        let energy = 0;
        for (let i = s; i < s + windowSamples; i++) {
          const v = all.readInt16LE(i * 2);
          energy += v * v;
        }
        if (energy < bestEnergy) { bestEnergy = energy; bestEnd = s + windowSamples; }
      }
      cutByte = bestEnd * 2;
    }

    const chunk = all.subarray(0, cutByte);
    const rest = all.subarray(cutByte);
    this.pending = rest.length ? [Buffer.from(rest)] : [];
    this.pendingBytes = rest.length;

    const chunkPath = path.join(this.tmpDir, `chunk-${this.chunkIndex++}.wav`);
    fs.writeFileSync(chunkPath, Buffer.concat([wavHeader(chunk.length), chunk]));
    return chunkPath;
  }

  // Flush whatever remains as a final chunk (no smart cutting).
  cutRemainder() {
    if (this.pendingBytes < SAMPLE_RATE) { this.pending = []; this.pendingBytes = 0; return null; }
    const all = Buffer.concat(this.pending, this.pendingBytes);
    this.pending = []; this.pendingBytes = 0;
    const chunkPath = path.join(this.tmpDir, `chunk-${this.chunkIndex++}.wav`);
    fs.writeFileSync(chunkPath, Buffer.concat([wavHeader(all.length), all]));
    return chunkPath;
  }

  finalize() {
    fs.writeSync(this.fd, wavHeader(this.dataBytes), 0, 44, 0);
    fs.closeSync(this.fd);
    fs.rmSync(this.tmpDir, { recursive: true, force: true });
    return { wavPath: this.wavPath, durationSeconds: this.dataBytes / 2 / SAMPLE_RATE };
  }

  // Cancelled recording: remove everything.
  discard() {
    try { fs.closeSync(this.fd); } catch { /* already closed */ }
    fs.rmSync(this.tmpDir, { recursive: true, force: true });
  }
}

module.exports = { SessionRecorder, wavHeader, SAMPLE_RATE };
