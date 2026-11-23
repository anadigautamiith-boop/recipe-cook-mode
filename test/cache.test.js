import test from 'node:test';
import assert from 'node:assert/strict';
import { Limiter, TtlCache, hashString } from '../src/cache.js';
import { AppError } from '../src/errors.js';

test('TtlCache remembers values until they expire', () => {
  const c = new TtlCache({ max: 10, ttlMs: 1000 });
  c.set('a', 1, 0);
  assert.equal(c.get('a', 999), 1);
  assert.equal(c.get('a', 1001), undefined);
  assert.equal(c.size, 0);
  assert.equal(c.get('missing', 0), undefined);
});

test('TtlCache drops the least recently used entry when full', () => {
  const c = new TtlCache({ max: 2, ttlMs: 10_000 });
  c.set('a', 1, 0);
  c.set('b', 2, 0);
  assert.equal(c.get('a', 1), 1); // touch a, so b is now the oldest
  c.set('c', 3, 2);
  assert.equal(c.get('b', 3), undefined);
  assert.equal(c.get('a', 3), 1);
  assert.equal(c.get('c', 3), 3);
  assert.equal(c.size, 2);
});

test('hashString is stable and tells different text apart', () => {
  assert.equal(hashString('hello'), hashString('hello'));
  assert.notEqual(hashString('hello'), hashString('hellp'));
  assert.notEqual(hashString('a'.repeat(1000)), hashString('a'.repeat(1001)));
  assert.match(hashString('x'), /^[0-9a-z]+$/);
});

test('Limiter allows a set number per visitor per hour, then says how long to wait', () => {
  const l = new Limiter();
  const t0 = Date.UTC(2026, 10, 23, 10, 0, 0);
  for (let i = 0; i < 3; i += 1) l.check('1.1.1.1', { perHour: 3, dailyCap: 100, now: t0 + i * 1000 });
  assert.throws(
    () => l.check('1.1.1.1', { perHour: 3, dailyCap: 100, now: t0 + 5000 }),
    (e) => e instanceof AppError && e.code === 'rate_limited' && e.status === 429 && e.retryAfter > 3000,
  );
  // someone else is unaffected
  l.check('2.2.2.2', { perHour: 3, dailyCap: 100, now: t0 + 5000 });
  // an hour later the first visitor is welcome back
  l.check('1.1.1.1', { perHour: 3, dailyCap: 100, now: t0 + 3_601_000 });
});

test('Limiter stops everyone once the daily cap is reached and resets the next day', () => {
  const l = new Limiter();
  const day1 = Date.UTC(2026, 10, 23, 10, 0, 0);
  l.check('a', { perHour: 10, dailyCap: 2, now: day1 });
  l.check('b', { perHour: 10, dailyCap: 2, now: day1 + 1 });
  assert.throws(
    () => l.check('c', { perHour: 10, dailyCap: 2, now: day1 + 2 }),
    (e) => e.code === 'daily_cap' && e.status === 429,
  );
  l.check('c', { perHour: 10, dailyCap: 2, now: day1 + 24 * 3600 * 1000 });
});
