// Live transcript rendering: words fade in one by one; section breaks slide in.
// Also keeps the canonical plain-text transcript (with section markers) for saving.
(function () {
  class LiveTranscript {
    constructor(container) {
      this.container = container;
      this.placeholder = container.querySelector('.transcript-placeholder');
      this.currentP = null;
      this.text = '';            // canonical transcript text
      this.sections = [];        // section labels in order
      this._sectionCount = 0;
      this._pendingBreak = false;
    }

    reset() {
      this.container.querySelectorAll('p:not(.transcript-placeholder), .lt-section').forEach((el) => el.remove());
      if (this.placeholder) this.placeholder.classList.remove('hidden');
      this.currentP = null;
      this.text = '';
      this.sections = [];
      this._sectionCount = 0;
      this._pendingBreak = false;
    }

    // Mark that the next incoming text belongs to a new section.
    queueSectionBreak() {
      this._pendingBreak = true;
    }

    _insertBreak(label) {
      this._sectionCount += 1;
      const name = label || `Part ${this._sectionCount + 1}`;
      this.sections.push(name);
      const el = document.createElement('div');
      el.className = 'lt-section';
      el.textContent = name;
      this.container.appendChild(el);
      this.currentP = null;
      this.text += `\n\n[${name}]\n\n`;
    }

    appendSegment(segText) {
      const clean = segText.trim();
      if (!clean) return;
      if (this.placeholder) this.placeholder.classList.add('hidden');

      // A queued silence-gap break lands before this segment; a transition
      // phrase inside the segment also opens a section.
      const phrase = window.Summarizer.detectTransition(clean);
      if (this._pendingBreak || phrase) {
        this._pendingBreak = false;
        this._insertBreak(phrase ? titleCase(phraseLabel(phrase)) : null);
      }

      if (!this.currentP) {
        this.currentP = document.createElement('p');
        this.currentP.style.marginBottom = '14px';
        this.container.appendChild(this.currentP);
      }

      const words = clean.split(/\s+/);
      words.forEach((word, i) => {
        const span = document.createElement('span');
        span.className = 'lt-word';
        span.textContent = (this.currentP.childNodes.length || i > 0 ? ' ' : '') + word;
        span.style.animationDelay = `${Math.min(i * 28, 900)}ms`;
        this.currentP.appendChild(span);
      });

      this.text += (this.text && !this.text.endsWith('\n') ? ' ' : '') + clean;
      this.container.scrollTop = this.container.scrollHeight;
    }
  }

  function phraseLabel(phrase) {
    // "now let's talk about" → "New topic"; summary phrases get their own label
    if (/summar|conclusion|wrap/.test(phrase)) return 'Wrapping up';
    return 'New topic';
  }

  function titleCase(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  window.LiveTranscript = LiveTranscript;
})();
