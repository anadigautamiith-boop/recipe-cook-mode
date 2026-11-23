// Kitchen timers. They keep running while you move between steps or close cook mode.
// Each timer stores the moment it should end (not a countdown), so a phone that sleeps or a
// tab that is throttled still shows the right time when you come back.

const KEY = 'cookalong.timers.v1';

export class TimerManager {
  constructor() {
    this.timers = new Map();
    this.listeners = new Set();
    this.ticker = null;
    this.alarmLoop = null;
    this.alarmCount = 0;
    this.audio = null;
    this.restore();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event = { type: 'tick' }) {
    for (const fn of [...this.listeners]) {
      try {
        fn(event);
      } catch (err) {
        console.error(err);
      }
    }
  }

  get(id) {
    return this.timers.get(id) || null;
  }

  list() {
    return [...this.timers.values()];
  }

  remaining(id) {
    const t = this.timers.get(id);
    if (!t || t.state !== 'running') return 0;
    return Math.max(0, Math.ceil((t.endAt - Date.now()) / 1000));
  }

  /** The running timer that ends first, for the page title. */
  next() {
    const running = this.list().filter((t) => t.state === 'running');
    running.sort((a, b) => a.endAt - b.endAt);
    return running[0] || null;
  }

  start(id, label, seconds) {
    if (this.timers.has(id)) return;
    this.prepareAudio();
    this.timers.set(id, { id, label, total: seconds, endAt: Date.now() + seconds * 1000, state: 'running' });
    this.save();
    this.ensureTicking();
    this.emit({ type: 'start', id });
  }

  reset(id) {
    this.timers.delete(id);
    this.save();
    this.stopAlarmIfQuiet();
    this.emit({ type: 'reset', id });
  }

  // ---- internals ----

  ensureTicking() {
    if (this.ticker) return;
    this.ticker = setInterval(() => this.tick(), 250);
  }

  tick() {
    const now = Date.now();
    for (const t of this.timers.values()) {
      if (t.state === 'running' && now >= t.endAt) {
        t.state = 'ringing';
        this.save();
        this.startAlarm();
        this.emit({ type: 'done', id: t.id, timer: t });
      }
    }
    this.emit({ type: 'tick' });
    if (!this.list().some((t) => t.state === 'running')) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  prepareAudio() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!this.audio && Ctx) this.audio = new Ctx();
      if (this.audio && this.audio.state === 'suspended') this.audio.resume();
    } catch {
      this.audio = null;
    }
  }

  beep() {
    try {
      if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 500]);
    } catch {
      // not supported
    }
    const ctx = this.audio;
    if (!ctx) return;
    try {
      const t0 = ctx.currentTime;
      for (let i = 0; i < 3; i += 1) {
        const at = t0 + i * 0.38;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.45, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 0.32);
      }
    } catch {
      // sound is a bonus; the banner and the vibration still happen
    }
  }

  startAlarm() {
    if (this.alarmLoop) return;
    this.alarmCount = 0;
    this.beep();
    this.alarmLoop = setInterval(() => {
      this.alarmCount += 1;
      if (this.alarmCount > 30) this.stopAlarm();
      else this.beep();
    }, 3000);
  }

  stopAlarm() {
    clearInterval(this.alarmLoop);
    this.alarmLoop = null;
  }

  stopAlarmIfQuiet() {
    if (!this.list().some((t) => t.state === 'ringing')) this.stopAlarm();
  }

  save() {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(this.list()));
    } catch {
      // storage unavailable: timers still work for this visit
    }
  }

  restore() {
    try {
      const items = JSON.parse(window.localStorage.getItem(KEY) || '[]');
      const now = Date.now();
      for (const t of Array.isArray(items) ? items : []) {
        if (!t || typeof t.id !== 'string' || !Number.isFinite(t.endAt)) continue;
        if (t.state === 'running' && now >= t.endAt) t.state = 'ringing';
        // forget timers that rang more than ten minutes ago
        if (t.state === 'ringing' && now - t.endAt > 10 * 60 * 1000) continue;
        this.timers.set(t.id, t);
      }
      if (this.list().some((t) => t.state === 'running')) this.ensureTicking();
    } catch {
      // ignore
    }
  }
}

export const timers = new TimerManager();
