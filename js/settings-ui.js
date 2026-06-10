// Settings overlay: API key (masked + test), Whisper model with on-demand
// download, save location, silence-gap slider, AI polish toggle.
(function () {
  const MODEL_NOTES = {
    tiny:   'Fastest · great for clear speech · 75 MB',
    base:   'Quick with better accuracy · 142 MB',
    small:  'Accurate, a little slower · 466 MB',
    medium: 'Most accurate · needs a beefy machine · 1.5 GB'
  };

  class SettingsUI {
    constructor(showToast) {
      this.overlay = document.getElementById('settings');
      this.showToast = showToast;
      this.cfg = null;

      this.keyInput = document.getElementById('set-api-key');
      this.keyResult = document.getElementById('set-key-result');
      this.modelSelect = document.getElementById('set-model');
      this.modelHint = document.getElementById('set-model-hint');
      this.saveLocation = document.getElementById('set-save-location');
      this.gap = document.getElementById('set-gap');
      this.gapValue = document.getElementById('set-gap-value');
      this.polishToggle = document.getElementById('set-polish');
      this.dlWrap = document.getElementById('set-download');
      this.dlFill = document.getElementById('set-download-fill');
      this.dlLabel = document.getElementById('set-download-label');

      this._wire();
    }

    _wire() {
      document.getElementById('settings-close').addEventListener('click', () => this.close());
      this.overlay.addEventListener('click', (e) => { if (e.target === this.overlay) this.close(); });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !this.overlay.classList.contains('hidden')) this.close();
      });

      this.keyInput.addEventListener('change', async () => {
        await window.vault.config.set({ apiKey: this.keyInput.value.trim() });
        this.keyResult.textContent = '';
      });

      document.getElementById('set-test-key').addEventListener('click', async () => {
        const key = this.keyInput.value.trim();
        if (!key) { this._keyMsg(false, 'Paste a key first — it starts with sk-ant-.'); return; }
        this._keyMsg(true, 'Asking the API nicely…');
        await window.vault.config.set({ apiKey: key });
        const res = await window.vault.polish.testKey(key);
        this._keyMsg(res.ok, res.message);
      });

      this.modelSelect.addEventListener('change', () => this._onModelChange());

      document.getElementById('set-choose-folder').addEventListener('click', async () => {
        const folder = await window.vault.dialog.chooseFolder();
        if (folder) {
          await window.vault.config.set({ saveLocation: folder });
          this.saveLocation.value = folder;
          this.showToast('New lectures will be saved there.');
        }
      });

      this.gap.addEventListener('input', () => {
        this.gapValue.textContent = `${this.gap.value}s`;
      });
      this.gap.addEventListener('change', async () => {
        await window.vault.config.set({ silenceGapSeconds: parseFloat(this.gap.value) });
      });

      this.polishToggle.addEventListener('click', async () => {
        const next = this.polishToggle.getAttribute('aria-checked') !== 'true';
        this.polishToggle.setAttribute('aria-checked', String(next));
        await window.vault.config.set({ aiPolish: next });
      });

      window.vault.whisper.onDownloadProgress(({ model, percent, received, total }) => {
        if (this.overlay.classList.contains('hidden')) return;
        this.dlWrap.classList.remove('hidden');
        this.dlFill.style.width = `${percent}%`;
        const mb = (n) => (n / 1048576).toFixed(0);
        this.dlLabel.textContent = `Downloading ${model} — ${mb(received)} of ${mb(total)} MB`;
      });
    }

    _keyMsg(ok, msg) {
      this.keyResult.textContent = msg;
      this.keyResult.className = 'key-result ' + (ok ? 'good' : 'bad');
    }

    async open() {
      this.cfg = await window.vault.config.get();
      const status = await window.vault.whisper.status();

      this.keyInput.value = this.cfg.apiKey || '';
      this.keyResult.textContent = '';
      this.saveLocation.value = this.cfg.saveLocation;
      this.gap.value = this.cfg.silenceGapSeconds;
      this.gapValue.textContent = `${this.cfg.silenceGapSeconds}s`;
      this.polishToggle.setAttribute('aria-checked', String(!!this.cfg.aiPolish));

      this.modelSelect.innerHTML = '';
      for (const m of Object.keys(MODEL_NOTES)) {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = `${m}${status.models[m] ? ' ✓ downloaded' : ''}`;
        if (m === this.cfg.whisperModel) opt.selected = true;
        this.modelSelect.appendChild(opt);
      }
      this.modelHint.textContent = MODEL_NOTES[this.cfg.whisperModel];
      this.dlWrap.classList.add('hidden');

      this.overlay.classList.remove('hidden');
      window.injectIcons(this.overlay);
    }

    async _onModelChange() {
      const model = this.modelSelect.value;
      this.modelHint.textContent = MODEL_NOTES[model];
      const status = await window.vault.whisper.status();
      if (!status.models[model]) {
        this.dlWrap.classList.remove('hidden');
        this.dlFill.style.width = '0%';
        this.dlLabel.textContent = `Fetching the ${model} model…`;
        try {
          await window.vault.whisper.download(model);
          this.showToast(`The ${model} model is ready.`);
          this.dlWrap.classList.add('hidden');
          [...this.modelSelect.options].find((o) => o.value === model).textContent = `${model} ✓ downloaded`;
        } catch {
          this.dlLabel.textContent = "That download didn't finish — check your connection and try again.";
          return;
        }
      }
      await window.vault.config.set({ whisperModel: model });
    }

    close() {
      this.overlay.classList.add('hidden');
    }
  }

  window.SettingsUI = SettingsUI;
})();
