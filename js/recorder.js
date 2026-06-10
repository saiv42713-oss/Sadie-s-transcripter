// Microphone capture: 16kHz mono PCM via AudioWorklet → main process.
// Also watches RMS levels for the waveform and silence-gap topic shifts.
(function () {
  const SILENCE_RMS = 0.012;

  class Recorder {
    constructor() {
      this.ctx = null;
      this.stream = null;
      this.node = null;
      this.running = false;

      this.onLevel = null;        // (rms) => void, ~4x/sec
      this.onSilenceGap = null;   // () => void, fired once per long pause
      this.silenceGapSeconds = 4;

      this._silentFor = 0;
      this._spokeSinceGap = false;
      this._gapFired = false;
    }

    async start() {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });

      this.ctx = new AudioContext({ sampleRate: 16000 });
      await this.ctx.audioWorklet.addModule('worklet/pcm-processor.js');

      const source = this.ctx.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.ctx, 'pcm-processor');
      this.node.port.onmessage = (e) => this._handleFrame(e.data);
      source.connect(this.node);
      // Worklet output stays disconnected — we never play back the mic.

      this.running = true;
      this._silentFor = 0;
      this._spokeSinceGap = false;
      this._gapFired = false;
    }

    _handleFrame({ samples, rms }) {
      if (!this.running) return;

      const frameSeconds = samples.length / 16000;
      if (rms < SILENCE_RMS) {
        this._silentFor += frameSeconds;
        if (this._silentFor >= this.silenceGapSeconds && this._spokeSinceGap && !this._gapFired) {
          this._gapFired = true;
          this._spokeSinceGap = false;
          this.onSilenceGap && this.onSilenceGap();
        }
      } else {
        this._silentFor = 0;
        this._gapFired = false;
        this._spokeSinceGap = true;
      }

      this.onLevel && this.onLevel(rms);

      // Float32 [-1,1] → Int16LE
      const pcm = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      window.vault.record.sendPcm(pcm.buffer);
    }

    async stop() {
      this.running = false;
      if (this.node) { this.node.port.onmessage = null; this.node.disconnect(); this.node = null; }
      if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
      if (this.ctx) { await this.ctx.close().catch(() => {}); this.ctx = null; }
    }
  }

  window.Recorder = Recorder;
})();
