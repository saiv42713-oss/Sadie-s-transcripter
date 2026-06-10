// Live waveform: a row of rounded bars that breathe with the mic level.
// Levels arrive ~4x/sec; bars interpolate smoothly via requestAnimationFrame.
(function () {
  const BAR_COUNT = 56;
  const BAR_GAP = 3;

  class Waveform {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.levels = new Array(BAR_COUNT).fill(0);   // target heights 0..1
      this.heights = new Array(BAR_COUNT).fill(0);  // rendered heights
      this.raf = null;
      this.running = false;
      this._resize();
    }

    _resize() {
      const dpr = window.devicePixelRatio || 1;
      const rect = this.canvas.getBoundingClientRect();
      this.canvas.width = Math.max(1, rect.width * dpr);
      this.canvas.height = Math.max(1, rect.height * dpr);
      this.ctx.scale(dpr, dpr);
      this.w = rect.width;
      this.h = rect.height;
    }

    push(rms) {
      // Perceptual-ish scaling so quiet speech still moves the bars.
      const level = Math.min(1, Math.pow(rms * 14, 0.72));
      this.levels.push(level);
      this.levels.shift();
    }

    start() {
      this.running = true;
      this._resize();
      const draw = () => {
        if (!this.running) return;
        const { ctx, w, h } = this;
        ctx.clearRect(0, 0, w, h);
        const barW = (w - BAR_GAP * (BAR_COUNT - 1)) / BAR_COUNT;
        const style = getComputedStyle(document.documentElement);
        ctx.fillStyle = style.getPropertyValue('--accent-coral').trim() || '#f4623a';

        for (let i = 0; i < BAR_COUNT; i++) {
          // ease rendered height toward target — fluid, never jerky
          this.heights[i] += (this.levels[i] - this.heights[i]) * 0.25;
          const min = 0.06;
          const bh = Math.max(min, this.heights[i]) * (h - 6);
          const x = i * (barW + BAR_GAP);
          const y = (h - bh) / 2;
          const r = Math.min(barW / 2, 3);
          ctx.globalAlpha = 0.35 + this.heights[i] * 0.65;
          ctx.beginPath();
          ctx.roundRect(x, y, barW, bh, r);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        this.raf = requestAnimationFrame(draw);
      };
      this.raf = requestAnimationFrame(draw);
    }

    stop() {
      this.running = false;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.levels.fill(0);
      this.heights.fill(0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  window.Waveform = Waveform;
})();
