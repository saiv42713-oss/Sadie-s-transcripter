// Key Points panel: refreshed every ~30s during recording with the
// top TF-IDF sentences, rendered as staggered index cards.
(function () {
  class KeyPointsPanel {
    constructor(listEl, hintEl) {
      this.listEl = listEl;
      this.hintEl = hintEl;
      this.current = [];
      this.sectionsRendered = 0;
    }

    reset() {
      this.listEl.innerHTML = '';
      this.current = [];
      this.sectionsRendered = 0;
      this.hintEl.classList.remove('hidden');
    }

    // Re-render only when content changed; stagger animation for new cards.
    update(keyPoints, sections) {
      const changed = keyPoints.length !== this.current.length ||
        keyPoints.some((kp, i) => kp !== this.current[i]) ||
        (sections && sections.length !== this.sectionsRendered);
      if (!changed) return;
      this.current = keyPoints.slice();
      this.sectionsRendered = sections ? sections.length : 0;

      if (keyPoints.length > 0) this.hintEl.classList.add('hidden');
      this.listEl.innerHTML = '';

      let delay = 0;
      if (sections && sections.length) {
        const label = document.createElement('div');
        label.className = 'kp-section';
        label.textContent = sections[sections.length - 1];
        this.listEl.appendChild(label);
      }
      for (const kp of keyPoints) {
        const card = document.createElement('div');
        card.className = 'kp-card';
        card.textContent = kp;
        card.style.animationDelay = `${delay}ms`;
        delay += 70;
        this.listEl.appendChild(card);
      }
    }
  }

  window.KeyPointsPanel = KeyPointsPanel;
})();
