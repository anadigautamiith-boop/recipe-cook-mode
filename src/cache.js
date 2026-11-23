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

// The hash lives in the shared folder so the browser can build the same ids.
export { hashString } from '../public/js/shared/hash.js';

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
