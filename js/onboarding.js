// First-run flow: welcome → mic permission → whisper model download →
// optional API key → layout tour → land on IDLE.
(function () {
  const MODEL_DESCRIPTIONS = {
    tiny:   { label: 'Tiny', size: '75 MB', desc: 'Recommended — fast enough to keep up live.' },
    base:   { label: 'Base', size: '142 MB', desc: 'A touch slower, noticeably sharper.' },
    small:  { label: 'Small', size: '466 MB', desc: 'Strong accuracy for accented or fast speech.' },
    medium: { label: 'Medium', size: '1.5 GB', desc: 'Best transcription, heaviest download.' }
  };

  class Onboarding {
    constructor(onDone) {
      this.root = document.getElementById('onboarding');
      this.onDone = onDone;
      this.step = 1;
      this.totalSteps = 5;
      this.selectedModel = 'tiny';
      this._wire();
    }

    start() {
      this.root.classList.remove('hidden');
      this._show(1);
    }

    _wire() {
      this.root.querySelectorAll('.onb-next').forEach((btn) =>
        btn.addEventListener('click', () => this._advance()));

      document.getElementById('onb-mic-btn').addEventListener('click', async () => {
        const errEl = document.getElementById('onb-mic-error');
        errEl.classList.add('hidden');
        const granted = await window.vault.mic.request();
        if (granted) {
          // Verify we can actually open a stream (covers non-mac platforms too).
          try {
            const s = await navigator.mediaDevices.getUserMedia({ audio: true });
            s.getTracks().forEach((t) => t.stop());
            this._advance();
            return;
          } catch { /* fall through to error */ }
        }
        errEl.classList.remove('hidden');
      });

      document.getElementById('onb-model-btn').addEventListener('click', () => this._downloadModel());

      document.getElementById('onb-test-key').addEventListener('click', async () => {
        const key = document.getElementById('onb-api-key').value.trim();
        const result = document.getElementById('onb-key-result');
        if (!key) {
          result.textContent = 'Paste a key first — it starts with sk-ant-.';
          result.className = 'key-result bad';
          return;
        }
        result.textContent = 'Checking…';
        result.className = 'key-result';
        await window.vault.config.set({ apiKey: key });
        const res = await window.vault.polish.testKey(key);
        result.textContent = res.message;
        result.className = 'key-result ' + (res.ok ? 'good' : 'bad');
      });

      document.getElementById('onb-key-continue').addEventListener('click', async () => {
        const key = document.getElementById('onb-api-key').value.trim();
        if (key) await window.vault.config.set({ apiKey: key });
      });
    }

    async _show(step) {
      this.step = step;
      this.root.querySelectorAll('.onb-step').forEach((el) => {
        el.classList.toggle('hidden', parseInt(el.dataset.step, 10) !== step);
      });
      const dots = document.getElementById('onb-dots');
      dots.innerHTML = '';
      for (let i = 1; i <= this.totalSteps; i++) {
        const d = document.createElement('span');
        d.className = 'onb-dot' + (i === step ? ' on' : '');
        dots.appendChild(d);
      }
      window.injectIcons(this.root);
      if (step === 3) await this._prepareModelStep();
    }

    _advance() {
      if (this.step >= this.totalSteps) return this._finish();
      this._show(this.step + 1);
    }

    async _prepareModelStep() {
      const status = await window.vault.whisper.status();
      const warning = document.getElementById('onb-engine-warning');

      if (!status.engine) {
        warning.classList.remove('hidden');
        warning.innerHTML = status.brewAvailable
          ? `Whisper itself isn't installed yet. We can install it for you through Homebrew — it takes a minute.
             <button class="text-btn" id="onb-brew-btn">Install whisper.cpp now</button>
             <span id="onb-brew-log" style="display:block;font-family:var(--font-mono);font-size:11px;margin-top:6px;color:var(--text-secondary);"></span>`
          : `Whisper itself isn't installed yet. Install one of these, then come back:
             <code>brew install whisper-cpp</code> (macOS) or <code>pip install openai-whisper</code>.
             You can finish setup now and add it later.`;
        const brewBtn = document.getElementById('onb-brew-btn');
        if (brewBtn) brewBtn.addEventListener('click', () => this._installBrew(brewBtn));
      } else {
        warning.classList.add('hidden');
      }

      const grid = document.getElementById('onb-model-grid');
      grid.innerHTML = '';
      for (const [model, d] of Object.entries(MODEL_DESCRIPTIONS)) {
        const card = document.createElement('button');
        card.className = 'model-card' + (model === this.selectedModel ? ' selected' : '');
        const have = status.models[model];
        card.innerHTML = `
          <div class="mc-name"><span>${d.label}</span><span class="mc-size ${have ? 'mc-have' : ''}">${have ? '✓ on disk' : d.size}</span></div>
          <div class="mc-desc">${d.desc}</div>`;
        card.addEventListener('click', () => {
          this.selectedModel = model;
          grid.querySelectorAll('.model-card').forEach((c) => c.classList.remove('selected'));
          card.classList.add('selected');
        });
        grid.appendChild(card);
      }
    }

    async _installBrew(btn) {
      btn.disabled = true;
      btn.textContent = 'Installing…';
      const log = document.getElementById('onb-brew-log');
      const off = window.vault.whisper.onInstallLog((line) => {
        log.textContent = line.trim().split('\n').pop();
      });
      const res = await window.vault.whisper.installBrew();
      off();
      if (res.ok) {
        log.textContent = '';
        document.getElementById('onb-engine-warning').classList.add('hidden');
      } else {
        btn.disabled = false;
        btn.textContent = 'Try again';
        log.textContent = "That didn't work — you can install it manually with: brew install whisper-cpp";
      }
    }

    async _downloadModel() {
      const btn = document.getElementById('onb-model-btn');
      const wrap = document.getElementById('onb-download');
      const fill = document.getElementById('onb-download-fill');
      const label = document.getElementById('onb-download-label');

      await window.vault.config.set({ whisperModel: this.selectedModel });
      const status = await window.vault.whisper.status();
      if (status.models[this.selectedModel]) return this._advance();

      btn.disabled = true;
      wrap.classList.remove('hidden');
      const off = window.vault.whisper.onDownloadProgress(({ percent, received, total }) => {
        fill.style.width = `${percent}%`;
        const mb = (n) => (n / 1048576).toFixed(0);
        label.textContent = `Downloading the ${this.selectedModel} model — ${mb(received)} of ${mb(total)} MB`;
      });
      try {
        await window.vault.whisper.download(this.selectedModel);
        label.textContent = 'Done!';
        setTimeout(() => this._advance(), 350);
      } catch {
        label.textContent = "The download didn't finish — check your connection and try again.";
        btn.disabled = false;
      } finally {
        off();
      }
    }

    async _finish() {
      await window.vault.config.set({ onboarded: true });
      this.root.classList.add('hidden');
      this.onDone();
    }
  }

  window.Onboarding = Onboarding;
})();
