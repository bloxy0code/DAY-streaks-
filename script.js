(() => {
  'use strict';

  /* ------------------------------------------------------------------
   * Constants
   * ------------------------------------------------------------------ */
  const STORAGE_KEY = 'araw.dayStreak.v1';
  const MIN_YEAR = 1970;
  const MAX_YEAR = 2100;

  const MOODS = [
    { id: 'amazing', emoji: '🤩', label: 'Amazing' },
    { id: 'good',    emoji: '😊', label: 'Good' },
    { id: 'okay',    emoji: '😐', label: 'Okay' },
    { id: 'bad',     emoji: '😔', label: 'Bad' },
    { id: 'tough',   emoji: '😫', label: 'Tough' },
  ];
  const MOOD_BY_ID = new Map(MOODS.map((m) => [m.id, m]));

  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  /* ------------------------------------------------------------------
   * Date helpers (all calendar math is done in UTC day numbers so that
   * daylight-saving changes can never skip or repeat a day)
   * ------------------------------------------------------------------ */
  const pad2 = (n) => String(n).padStart(2, '0');
  const makeKey = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
  const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function parseKey(key) {
    const match = typeof key === 'string' ? KEY_RE.exec(key) : null;
    if (!match) return null;
    const y = +match[1], m = +match[2] - 1, d = +match[3];
    const dt = new Date(Date.UTC(y, m, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m || dt.getUTCDate() !== d) return null;
    return { y, m, d };
  }

  const dayIndex = (y, m, d) => Math.round(Date.UTC(y, m, d) / 86400000);
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const weekdayMon = (y, m, d) => (new Date(Date.UTC(y, m, d)).getUTCDay() + 6) % 7; // Monday = 0
  const firstWeekdayMon = (y, m) => weekdayMon(y, m, 1);

  function getToday() {
    const now = new Date();
    return { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
  }
  const todayIndexOf = (t) => dayIndex(t.y, t.m, t.d);

  /* ------------------------------------------------------------------
   * Streak maths
   * ------------------------------------------------------------------ */
  function computeStreaks(entries, today) {
    const t = todayIndexOf(today);
    const days = new Set();
    Object.keys(entries).forEach((key) => {
      const p = parseKey(key);
      if (!p) return;
      const idx = dayIndex(p.y, p.m, p.d);
      if (idx <= t) days.add(idx);
    });

    // current: count back from today, or from yesterday if today is still open
    let current = 0;
    const start = days.has(t) ? t : (days.has(t - 1) ? t - 1 : null);
    if (start !== null) {
      for (let i = start; days.has(i); i--) current++;
    }

    // longest: longest run of consecutive days anywhere in history
    const sorted = Array.from(days).sort((a, b) => a - b);
    let longest = 0, run = 0, prev = null;
    sorted.forEach((i) => {
      run = prev !== null && i === prev + 1 ? run + 1 : 1;
      if (run > longest) longest = run;
      prev = i;
    });
    return { current, longest };
  }

  /* ------------------------------------------------------------------
   * Persistence (localStorage, validated on the way in)
   * ------------------------------------------------------------------ */
  let storageOk = true;

  function loadState() {
    const fresh = { entries: {}, longest: 0 };
    let raw = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      storageOk = false;
      return fresh;
    }
    if (!raw) return fresh;
    try {
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return fresh;
      const src = data.entries && typeof data.entries === 'object' ? data.entries : {};
      const entries = {};
      Object.keys(src).forEach((key) => {
        const e = src[key];
        if (!parseKey(key) || !e || typeof e !== 'object' || !MOOD_BY_ID.has(e.mood)) return;
        entries[key] = { mood: e.mood, completedAt: typeof e.completedAt === 'string' ? e.completedAt : '' };
      });
      const longest = Number.isInteger(data.longest) && data.longest > 0 ? Math.min(data.longest, 100000) : 0;
      return { entries, longest };
    } catch (err) {
      return fresh;
    }
  }

  let state = loadState();

  function saveState() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      storageOk = false;
    }
    el.storageWarn.hidden = storageOk;
  }

  /* ------------------------------------------------------------------
   * DOM references
   * ------------------------------------------------------------------ */
  const $ = (id) => document.getElementById(id);
  const el = {
    app: $('app'), stars: $('stars'), flame: $('flame'), fire: $('fire'),
    streakNumber: $('streakNumber'), subtitle: $('subtitle'), fireMsg: $('fireMsg'),
    longest: $('longest'), longestUnit: $('longestUnit'),
    monthTitle: $('monthTitle'), weekdays: $('weekdays'), grid: $('grid'),
    prevYear: $('prevYear'), prevMonth: $('prevMonth'), nextMonth: $('nextMonth'), nextYear: $('nextYear'),
    todayBtn: $('todayBtn'),
    progMonth: $('progMonth'), progPercent: $('progPercent'), progCount: $('progCount'),
    bar: $('bar'), barFill: $('barFill'),
    overlay: $('overlay'), dialog: $('dialog'), dlgDate: $('dlgDate'), dlgClose: $('dlgClose'), moods: $('moods'),
    live: $('live'), storageWarn: $('storageWarn'),
  };

  let today = getToday();
  let view = { y: today.y, m: today.m };

  /* ------------------------------------------------------------------
   * Completion rules
   * ------------------------------------------------------------------ */
  const isCompleted = (key) => Object.prototype.hasOwnProperty.call(state.entries, key);

  function completeDate(key, moodId) {
    const p = parseKey(key);
    if (!p || !MOOD_BY_ID.has(moodId)) return false;
    if (dayIndex(p.y, p.m, p.d) > todayIndexOf(today)) return false; // no future dates
    if (isCompleted(key)) return false;                               // locked forever
    state.entries[key] = { mood: moodId, completedAt: new Date().toISOString() };
    const streaks = computeStreaks(state.entries, today);
    if (streaks.longest > state.longest) state.longest = streaks.longest;
    saveState();
    return true;
  }

  function monthProgress(y, m) {
    const total = daysInMonth(y, m);
    const t = todayIndexOf(today);
    let completed = 0;
    for (let d = 1; d <= total; d++) {
      if (isCompleted(makeKey(y, m, d)) && dayIndex(y, m, d) <= t) completed++;
    }
    return { completed, total, percent: (completed / total) * 100 };
  }

  /* ------------------------------------------------------------------
   * Rendering
   * ------------------------------------------------------------------ */
  function announce(text) {
    el.live.textContent = '';
    window.setTimeout(() => { el.live.textContent = text; }, 30);
  }

  function renderHero(streaks) {
    const prev = el.streakNumber.textContent;
    el.streakNumber.textContent = String(streaks.current);
    if (el.streakNumber.dataset.ready && prev !== String(streaks.current)) {
      el.streakNumber.classList.remove('bump');
      void el.streakNumber.offsetWidth;
      el.streakNumber.classList.add('bump');
    }
    el.streakNumber.dataset.ready = '1';
    const lit = streaks.current > 0;
    el.flame.classList.toggle('is-out', !lit);
    el.fire.classList.toggle('is-out', !lit);
    el.subtitle.textContent = lit ? 'Keep going, legend!' : 'Complete today to light the flame!';
    el.fireMsg.textContent = lit ? 'You’re on fire!' : 'Ready when you are!';
  }

  function renderLongest() {
    el.longest.textContent = String(state.longest);
    el.longestUnit.textContent = state.longest === 1 ? 'Day' : 'Days';
  }

  function renderProgress() {
    const p = monthProgress(view.y, view.m);
    const rounded = Math.round(p.percent);
    el.progMonth.textContent = `${MONTH_NAMES[view.m]} ${view.y}`;
    el.progPercent.textContent = `${rounded}%`;
    el.progCount.textContent = `${p.completed} / ${p.total} days`;
    el.barFill.style.width = `${p.percent}%`;
    el.bar.setAttribute('aria-valuenow', String(rounded));
    el.bar.setAttribute('aria-valuetext', `${p.completed} of ${p.total} days completed`);
  }

  function renderCalendar() {
    const { y, m } = view;
    const total = daysInMonth(y, m);
    const offset = firstWeekdayMon(y, m);
    const t = todayIndexOf(today);
    const inCurrentMonth = y === today.y && m === today.m;

    el.monthTitle.textContent = `${MONTH_NAMES[m]} ${y}`;
    el.grid.setAttribute('aria-label', `Days of ${MONTH_NAMES[m]} ${y}`);
    Array.from(el.weekdays.children).forEach((node, i) => {
      node.classList.toggle('is-today', inCurrentMonth && i === weekdayMon(today.y, today.m, today.d));
    });

    const frag = document.createDocumentFragment();
    for (let i = 0; i < offset; i++) {
      const pad = document.createElement('div');
      pad.className = 'day pad';
      pad.setAttribute('aria-hidden', 'true');
      frag.appendChild(pad);
    }

    for (let d = 1; d <= total; d++) {
      const key = makeKey(y, m, d);
      const idx = dayIndex(y, m, d);
      const col = (offset + d - 1) % 7;
      const future = idx > t;
      const isToday = idx === t;
      const entry = !future && isCompleted(key) ? state.entries[key] : null;

      const wrap = document.createElement('div');
      wrap.className = 'day';
      wrap.dataset.day = String(d);
      if (entry && col > 0 && d > 1 && isCompleted(makeKey(y, m, d - 1))) wrap.classList.add('join');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dot';
      btn.dataset.key = key;
      const longName = `${WEEKDAY_NAMES[col]}, ${d} ${MONTH_NAMES[m]} ${y}`;

      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = String(d);
      btn.appendChild(num);

      if (entry) {
        const mood = MOOD_BY_ID.get(entry.mood);
        btn.classList.add('is-done');
        btn.setAttribute('aria-disabled', 'true');
        btn.setAttribute('aria-label', `${longName}. Completed, mood ${mood.label}. Locked.`);
        const when = entry.completedAt ? new Date(entry.completedAt) : null;
        btn.title = when && !isNaN(when) ? `${mood.label} · completed ${when.toLocaleString()}` : mood.label;
        const face = document.createElement('span');
        face.className = 'mood';
        face.setAttribute('aria-hidden', 'true');
        face.textContent = mood.emoji;
        btn.appendChild(face);
      } else if (future) {
        btn.classList.add('is-future');
        btn.disabled = true;
        btn.setAttribute('aria-label', `${longName}. Upcoming, not available yet.`);
      } else {
        btn.classList.add(isToday ? 'is-today' : 'is-missed');
        btn.setAttribute('aria-label', `${longName}${isToday ? ', today' : ''}. Not completed. Choose to complete.`);
      }
      if (isToday) btn.classList.add('is-today');

      wrap.appendChild(btn);
      frag.appendChild(wrap);
    }
    el.grid.textContent = '';
    el.grid.appendChild(frag);

    el.prevYear.disabled = y - 1 < MIN_YEAR;
    el.nextYear.disabled = y + 1 > MAX_YEAR;
    el.prevMonth.disabled = y === MIN_YEAR && m === 0;
    el.nextMonth.disabled = y === MAX_YEAR && m === 11;
  }

  function render() {
    const streaks = computeStreaks(state.entries, today);
    if (streaks.longest > state.longest) {
      state.longest = streaks.longest;
      saveState();
    }
    renderHero(streaks);
    renderCalendar();
    renderLongest();
    renderProgress();
  }

  /* ------------------------------------------------------------------
   * Navigation
   * ------------------------------------------------------------------ */
  function setView(y, m, animate = true) {
    if (y < MIN_YEAR || y > MAX_YEAR) return;
    view = { y, m };
    renderCalendar();
    renderProgress();
    if (animate) {
      el.grid.classList.remove('swap');
      void el.grid.offsetWidth;
      el.grid.classList.add('swap');
    }
  }

  function shiftMonth(delta) {
    let y = view.y, m = view.m + delta;
    while (m < 0) { m += 12; y--; }
    while (m > 11) { m -= 12; y++; }
    setView(y, m);
  }

  el.prevMonth.addEventListener('click', () => shiftMonth(-1));
  el.nextMonth.addEventListener('click', () => shiftMonth(1));
  el.prevYear.addEventListener('click', () => setView(view.y - 1, view.m));
  el.nextYear.addEventListener('click', () => setView(view.y + 1, view.m));
  el.todayBtn.addEventListener('click', () => {
    if (view.y === today.y && view.m === today.m) {
      const btn = el.grid.querySelector(`[data-key="${makeKey(today.y, today.m, today.d)}"]`);
      if (btn) { btn.classList.remove('pulse'); void btn.offsetWidth; btn.classList.add('pulse'); btn.focus(); }
    } else {
      setView(today.y, today.m);
    }
  });

  // Arrow-key movement around the month grid
  el.grid.addEventListener('keydown', (e) => {
    const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!Object.prototype.hasOwnProperty.call(steps, e.key)) return;
    const btn = e.target.closest('button.dot');
    if (!btn) return;
    const all = Array.from(el.grid.querySelectorAll('button.dot'));
    const target = all[all.indexOf(btn) + steps[e.key]];
    if (target && !target.disabled) { e.preventDefault(); target.focus(); }
  });

  /* ------------------------------------------------------------------
   * Mood popup
   * ------------------------------------------------------------------ */
  const modal = { open: false, key: null, opener: null, hideTimer: null };

  MOODS.forEach((mood) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mood-btn';
    b.dataset.mood = mood.id;
    b.setAttribute('aria-label', mood.label);
    b.innerHTML = '<span class="e" aria-hidden="true"></span><span class="l"></span>';
    b.firstChild.textContent = mood.emoji;
    b.lastChild.textContent = mood.label;
    el.moods.appendChild(b);
  });
  const moodButtons = Array.from(el.moods.children);

  function openModal(key, opener) {
    const p = parseKey(key);
    if (!p || modal.open) return;
    if (dayIndex(p.y, p.m, p.d) > todayIndexOf(today) || isCompleted(key)) return;
    window.clearTimeout(modal.hideTimer);
    modal.open = true;
    modal.key = key;
    modal.opener = opener || null;
    const isToday = dayIndex(p.y, p.m, p.d) === todayIndexOf(today);
    el.dlgDate.textContent = `${isToday ? 'Today · ' : ''}${WEEKDAY_NAMES[weekdayMon(p.y, p.m, p.d)]}, ${p.d} ${MONTH_NAMES[p.m]} ${p.y}`;
    el.overlay.hidden = false;
    void el.overlay.offsetWidth;
    el.overlay.classList.add('open');
    el.app.setAttribute('aria-hidden', 'true');
    moodButtons[1].focus();
  }

  function closeModal(restoreFocus = true) {
    if (!modal.open) return;
    modal.open = false;
    const opener = modal.opener;
    modal.key = null;
    modal.opener = null;
    el.overlay.classList.remove('open');
    el.app.removeAttribute('aria-hidden');
    modal.hideTimer = window.setTimeout(() => { if (!modal.open) el.overlay.hidden = true; }, 220);
    if (restoreFocus && opener && document.contains(opener)) opener.focus();
  }

  function chooseMood(moodId) {
    const key = modal.key;
    if (!key) return;
    closeModal(false);
    const ok = completeDate(key, moodId);
    render();
    const btn = el.grid.querySelector(`[data-key="${key}"]`);
    if (btn) {
      btn.focus();
      if (ok) btn.classList.add('just-done');
    }
    const p = parseKey(key);
    const mood = MOOD_BY_ID.get(moodId);
    const { current } = computeStreaks(state.entries, today);
    announce(ok
      ? `${p.d} ${MONTH_NAMES[p.m]} completed with mood ${mood.label}. Current streak: ${current} ${current === 1 ? 'day' : 'days'}.`
      : 'That day was already completed and stays locked.');
  }

  el.grid.addEventListener('click', (e) => {
    const btn = e.target.closest('button.dot');
    if (!btn || btn.disabled) return;
    const key = btn.dataset.key;
    if (isCompleted(key)) {
      btn.classList.remove('shake');
      void btn.offsetWidth;
      btn.classList.add('shake');
      announce('This day is completed and locked. It can’t be changed.');
      return;
    }
    openModal(key, btn);
  });

  moodButtons.forEach((b) => b.addEventListener('click', () => chooseMood(b.dataset.mood)));
  el.dlgClose.addEventListener('click', () => closeModal());
  el.overlay.addEventListener('mousedown', (e) => { if (e.target === el.overlay) closeModal(); });

  document.addEventListener('keydown', (e) => {
    if (!modal.open) return;
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }

    const focusables = [el.dlgClose, ...moodButtons];
    const i = focusables.indexOf(document.activeElement);
    if (e.key === 'Tab') {
      e.preventDefault();
      const next = e.shiftKey ? (i <= 0 ? focusables.length - 1 : i - 1) : (i === focusables.length - 1 ? 0 : i + 1);
      focusables[next].focus();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const mi = moodButtons.indexOf(document.activeElement);
      if (mi === -1) return;
      e.preventDefault();
      const step = e.key === 'ArrowRight' ? 1 : -1;
      moodButtons[(mi + step + moodButtons.length) % moodButtons.length].focus();
    }
  });

  /* ------------------------------------------------------------------
   * Day rollover, cross-tab sync, decoration
   * ------------------------------------------------------------------ */
  function checkDayChange() {
    const now = getToday();
    if (now.y === today.y && now.m === today.m && now.d === today.d) return;
    const wasOnCurrentMonth = view.y === today.y && view.m === today.m;
    today = now;
    if (wasOnCurrentMonth) view = { y: now.y, m: now.m };
    closeModal(false);
    render();
  }
  window.setInterval(checkDayChange, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDayChange(); });
  window.addEventListener('focus', checkDayChange);

  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    state = loadState();
    closeModal(false);
    render();
  });

  // Background sparkles, placed where the reference artwork has them
  [
    [5.8, 25, 14, 0], [27.1, 18, 12, 1.1], [39.2, 22, 16, 2.1], [46.5, 24, 28, .4], [34.6, 40, 9, 1.7],
    [42.5, 42, 10, 2.6], [56.2, 42, 10, .9], [65.4, 37, 24, 1.4], [61.8, 43, 5, 0], [66.8, 70, 12, 2.2],
    [6.2, 88, 12, .6], [92.9, 17, 12, 1.9],
  ].forEach(([x, y, s, delay]) => {
    const star = document.createElement('i');
    star.className = s <= 5 ? 'star dot' : 'star';
    star.style.cssText = `--x:${x}%;--y:${y}%;--s:${s}px;--d:${delay}s`;
    el.stars.appendChild(star);
  });

  /* ------------------------------------------------------------------
   * Boot
   * ------------------------------------------------------------------ */
  el.storageWarn.hidden = storageOk;
  render();

  // Small read-only/test surface (every write still goes through completeDate's rules)
  window.__dayStreak = {
    computeStreaks, daysInMonth, firstWeekdayMon, monthProgress, completeDate, checkDayChange,
    getState: () => JSON.parse(JSON.stringify(state)),
    getView: () => ({ ...view }),
    getStreaks: () => computeStreaks(state.entries, today),
    render,
  };
})();
