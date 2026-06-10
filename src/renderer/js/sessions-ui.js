// Sidebar session library: grouped by week, searchable, plus recent cards on the home screen.
(function () {
  function fmtDuration(seconds) {
    const m = Math.round((seconds || 0) / 60);
    if (m < 1) return '<1 min';
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // Monday-of-week key for grouping, newest first.
  function weekLabel(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return 'Earlier';
    const now = new Date();
    const startOfWeek = (date) => {
      const x = new Date(date);
      x.setHours(0, 0, 0, 0);
      x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
      return x;
    };
    const thisWeek = startOfWeek(now).getTime();
    const thatWeek = startOfWeek(d).getTime();
    if (thatWeek === thisWeek) return 'This week';
    if (thisWeek - thatWeek === 7 * 86400000) return 'Last week';
    return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  class SessionsUI {
    constructor({ listEl, searchEl, recentEl, recentBlock, onOpen }) {
      this.listEl = listEl;
      this.recentEl = recentEl;
      this.recentBlock = recentBlock;
      this.onOpen = onOpen;
      this.activeDir = null;

      let timer = null;
      searchEl.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => this.refresh(searchEl.value), 180);
      });
    }

    async refresh(query = '') {
      const items = query
        ? await window.vault.sessions.search(query)
        : await window.vault.sessions.list();
      this._renderSidebar(items, query);
      this._renderRecent(items.slice(0, 4));
      return items;
    }

    _renderSidebar(items, query) {
      this.listEl.innerHTML = '';
      if (items.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'sidebar-empty';
        empty.textContent = query
          ? `Nothing matched “${query}”. Try another word?`
          : 'Your recorded lectures will live here — grouped by week, searchable forever.';
        this.listEl.appendChild(empty);
        return;
      }

      let lastWeek = null;
      for (const s of items) {
        const wk = weekLabel(s.metadata.date);
        if (wk !== lastWeek) {
          lastWeek = wk;
          const label = document.createElement('div');
          label.className = 'week-label';
          label.textContent = wk;
          this.listEl.appendChild(label);
        }
        const btn = document.createElement('button');
        btn.className = 'session-item' + (s.dir === this.activeDir ? ' active' : '');
        btn.innerHTML = `
          <div class="si-title"></div>
          <div class="si-meta">
            <span>${fmtDate(s.metadata.date)}</span>
            <span class="duration-badge">${fmtDuration(s.metadata.durationSeconds)}</span>
          </div>`;
        btn.querySelector('.si-title').textContent = s.metadata.title || 'Untitled lecture';
        btn.addEventListener('click', () => {
          this.activeDir = s.dir;
          this.listEl.querySelectorAll('.session-item.active').forEach((el) => el.classList.remove('active'));
          btn.classList.add('active');
          this.onOpen(s.dir);
        });
        this.listEl.appendChild(btn);
      }
    }

    _renderRecent(items) {
      this.recentEl.innerHTML = '';
      this.recentBlock.classList.toggle('hidden', items.length === 0);
      for (const s of items) {
        const card = document.createElement('button');
        card.className = 'recent-card';
        card.innerHTML = `
          <div class="rc-title"></div>
          <div class="rc-meta">
            <span>${fmtDate(s.metadata.date)}</span>
            <span class="duration-badge">${fmtDuration(s.metadata.durationSeconds)}</span>
            ${s.metadata.aiPolished ? '<span class="ai-badge">✦ AI</span>' : ''}
          </div>`;
        card.querySelector('.rc-title').textContent = s.metadata.title || 'Untitled lecture';
        card.addEventListener('click', () => this.onOpen(s.dir));
        this.recentEl.appendChild(card);
      }
    }
  }

  window.SessionsUI = SessionsUI;
  window.fmtDuration = fmtDuration;
})();
