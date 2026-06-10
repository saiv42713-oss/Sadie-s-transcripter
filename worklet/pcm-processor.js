// AudioWorklet: batches mono Float32 input into ~250ms frames and posts them
// to the main thread along with an RMS level for the waveform/silence detector.
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(4096);
    this.offset = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    let i = 0;
    while (i < channel.length) {
      const space = this.buffer.length - this.offset;
      const take = Math.min(space, channel.length - i);
      this.buffer.set(channel.subarray(i, i + take), this.offset);
      this.offset += take;
      i += take;

      if (this.offset === this.buffer.length) {
        let sum = 0;
        for (let j = 0; j < this.buffer.length; j++) sum += this.buffer[j] * this.buffer[j];
        const rms = Math.sqrt(sum / this.buffer.length);
        // Transfer a copy; keep reusing our scratch buffer.
        const out = this.buffer.slice();
        this.port.postMessage({ samples: out, rms }, [out.buffer]);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
