// Two tiny helpers that live in the memory of one running server instance:
//   TtlCache  - remembers finished recipes so the same link is never paid for twice
//   Limiter   - stops one visitor (or one day) from using up the whole AI budget
// They are deliberately simple. They reset when the server instance restarts, and a
// second instance has its own copy, so treat both as "best effort".

import { AppError } from './errors.js';

export class TtlCache {
  constructor({ max = 100, ttlMs = 6 * 60 * 60 * 1000 } = {}) {
    this.max = max;
    this.ttlMs = ttlMs;
    this.map = new Map();
  }

  get(key, now = Date.now()) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expires < now) {
      this.map.delete(key);
      return undefined;
    }
    // refresh recency
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value, now = Date.now()) {
    this.map.delete(key);
    this.map.set(key, { value, expires: now + this.ttlMs });
    while (this.map.size > this.max) {
      this.map.delete(this.map.keys().next().value);
    }
  }

  get size() {
    return this.map.size;
  }
}

/** A quick 53-bit string hash (cyrb53). Not secure; it only builds cache keys. */
export function hashString(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const HOUR_MS = 60 * 60 * 1000;

export class Limiter {
  constructor() {
    this.hits = new Map();
    this.day = '';
    this.dayCount = 0;
  }

  /** Throws a friendly AppError if this visitor or the whole demo is over its limit. */
  check(ip, { perHour = 12, dailyCap = 300, now = Date.now() } = {}) {
    const day = new Date(now).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.dayCount = 0;
    }
    if (this.dayCount >= dailyCap) {
      throw new AppError('daily_cap', 'The demo has reached its limit for today.', {
        status: 429,
        hint: 'Please try again tomorrow, or let the owner know.',
      });
    }
    const recent = (this.hits.get(ip) || []).filter((t) => now - t < HOUR_MS);
    if (recent.length >= perHour) {
      const retryAfter = Math.max(1, Math.ceil((HOUR_MS - (now - recent[0])) / 1000));
      throw new AppError('rate_limited', "You've made a lot of recipes in the last hour.", {
        status: 429,
        hint: `Please try again in about ${Math.ceil(retryAfter / 60)} minutes.`,
        retryable: true,
        retryAfter,
      });
    }
    recent.push(now);
    this.hits.set(ip, recent);
    this.dayCount += 1;
    if (this.hits.size > 5000) {
      for (const [key, times] of this.hits) {
        if (!times.some((t) => now - t < HOUR_MS)) this.hits.delete(key);
      }
    }
  }
}
