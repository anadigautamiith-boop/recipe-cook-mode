// Things kept in this browser: recent recipes, preferences and ticked ingredients.
// Every call is wrapped, because storage can be full, blocked or switched off.

const KEYS = {
  recents: 'cookalong.recents.v1',
  prefs: 'cookalong.prefs.v1',
  ticks: 'cookalong.ticks.v1',
};
const MAX_RECENTS = 8;

function read(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const prefs = {
  get() {
    return { units: 'orig', lang: 'en', ...read(KEYS.prefs, {}) };
  },
  set(patch) {
    write(KEYS.prefs, { ...this.get(), ...patch });
  },
};

export const recents = {
  list() {
    const items = read(KEYS.recents, []);
    return Array.isArray(items) ? items : [];
  },
  get(id) {
    return this.list().find((item) => item.id === id) || null;
  },
  save(entry) {
    let items = [entry, ...this.list().filter((item) => item.id !== entry.id)].slice(0, MAX_RECENTS);
    // If storage is full, drop the oldest recipes until it fits.
    while (!write(KEYS.recents, items) && items.length > 1) items = items.slice(0, -1);
  },
  clear() {
    write(KEYS.recents, []);
    write(KEYS.ticks, {});
  },
};

export const ticks = {
  get(key) {
    const all = read(KEYS.ticks, {});
    return Array.isArray(all[key]) ? all[key] : [];
  },
  set(key, indexes) {
    const all = read(KEYS.ticks, {});
    if (indexes.length) all[key] = indexes;
    else delete all[key];
    // keep this small: only the most recent 30 recipes keep ticks
    const keys = Object.keys(all);
    if (keys.length > 30) for (const k of keys.slice(0, keys.length - 30)) delete all[k];
    write(KEYS.ticks, all);
  },
};
