import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ROWS,
  checkRun,
  median,
  normalizeRows,
  outcomeWords,
  runFromError,
  runFromPayload,
  toMarkdown,
  totals,
} from '../public/js/lab-core.js';

const NOW = Date.parse('2026-11-23T10:00:00Z');

function payload(extra = {}) {
  return {
    ok: true,
    result: { is_recipe: true, not_recipe_reason: null, recipes: [{ title: 'Tomato and Egg Stir-Fry' }] },
    meta: {
      route: 'youtube-video',
      model: 'google/gemini-2.5-flash',
      cached: false,
      ms: 31200,
      cost_usd: 0.0194,
      tokens: { prompt: 9000, completion: 1500, total: 10500 },
      stats: { recipes: 1, ingredients: 7, ingredients_stated: 5, steps: 8, timers: 3, cues: 6, gaps: 2 },
      fallbacks: [],
    },
    ...extra,
  };
}

test('the default test set has links ready to run, leaves the rest for the tester, and is labelled for what it tests', () => {
  // Four public videos are ready; the easy, long and two Instagram rows need the tester's own links.
  const ready = DEFAULT_ROWS.filter((r) => r.url);
  assert.ok(ready.length >= 4);
  assert.equal(DEFAULT_ROWS.find((r) => r.id === 'easy').url, '', 'no default link for a video that might go private');
  assert.equal(new Set(DEFAULT_ROWS.map((r) => r.id)).size, DEFAULT_ROWS.length);
  for (const r of DEFAULT_ROWS) {
    assert.ok(r.label && r.hint, `${r.id} needs a label and a hint`);
    if (r.url) assert.match(r.url, /^https:\/\/www\.youtube\.com\//);
  }
  assert.ok(DEFAULT_ROWS.some((r) => r.id.startsWith('ig-')), 'Instagram cases are listed');
});

test('runFromPayload keeps the numbers the write-up needs', () => {
  const run = runFromPayload(payload(), { clientMs: 32050.4, now: NOW });
  assert.equal(run.outcome, 'recipe');
  assert.equal(run.title, 'Tomato and Egg Stir-Fry');
  assert.equal(run.route, 'youtube-video');
  assert.equal(run.ms, 31200);
  assert.equal(run.clientMs, 32050);
  assert.equal(run.cost, 0.0194);
  assert.equal(run.tokens, 10500);
  assert.deepEqual(run.stats, { recipes: 1, ingredients: 7, ingredients_stated: 5, steps: 8, timers: 3, cues: 6, gaps: 2 });
  assert.equal(run.at, '2026-11-23T10:00:00.000Z');
  assert.equal(run.error, null);
});

test('runFromPayload records "not a recipe" with the reason', () => {
  const run = runFromPayload(
    payload({ result: { is_recipe: false, not_recipe_reason: 'A person at a zoo.', recipes: [] }, meta: { route: 'youtube-video', ms: 5000, cost_usd: 0.002 } }),
    { now: NOW },
  );
  assert.equal(run.outcome, 'not_recipe');
  assert.equal(run.reason, 'A person at a zoo.');
  assert.equal(run.stats.steps, 0);
});

test('runFromPayload copes with missing or odd numbers', () => {
  const run = runFromPayload({ result: { is_recipe: true, recipes: [] }, meta: { cost_usd: 'free', ms: NaN } }, { now: NOW });
  assert.equal(run.cost, null);
  assert.equal(run.ms, null);
  assert.equal(run.title, '');
});

test('runFromError names Instagram-needs-text separately from real failures', () => {
  const asked = runFromError({ code: 'needs_text', message: 'Paste the caption.' }, { now: NOW });
  assert.equal(asked.outcome, 'needs_text');
  const failed = runFromError({ code: 'too_long', message: 'Too long.', hint: 'Try a shorter one.' }, { clientMs: 9000, now: NOW });
  assert.equal(failed.outcome, 'error:too_long');
  assert.equal(failed.error.hint, 'Try a shorter one.');
  assert.equal(failed.clientMs, 9000);
  assert.equal(runFromError(new Error('boom'), { now: NOW }).outcome, 'error:error');
});

test('checkRun compares an outcome with what was hoped for', () => {
  const row = { expect: ['recipe'] };
  assert.equal(checkRun(row, runFromPayload(payload(), { now: NOW })), true);
  assert.equal(checkRun(row, runFromError({ code: 'upstream_error' }, { now: NOW })), false);
  assert.equal(checkRun({}, runFromPayload(payload(), { now: NOW })), null);
  assert.equal(checkRun(row, null), null);
});

test('checkRun wants several dishes when the row says so', () => {
  const row = { expect: ['recipe'], minRecipes: 2 };
  assert.equal(checkRun(row, runFromPayload(payload(), { now: NOW })), false);
  const many = payload();
  many.meta.stats.recipes = 5;
  assert.equal(checkRun(row, runFromPayload(many, { now: NOW })), true);
});

test('outcomeWords reads like a sentence', () => {
  assert.equal(outcomeWords(runFromPayload(payload(), { now: NOW })), 'Made a recipe');
  assert.equal(outcomeWords(runFromError({ code: 'needs_text' }, { now: NOW })), 'Asked for pasted text');
  assert.equal(outcomeWords(runFromError({ code: 'caption_not_recipe' }, { now: NOW })), 'Said the caption has no recipe');
  assert.equal(outcomeWords(runFromError({ code: 'rate_limited' }, { now: NOW })), 'Failed (rate_limited)');
  assert.equal(outcomeWords(null), '');
});

test('median handles empty, odd and even lists', () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([9, 1, 5]), 5);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([null, 3, NaN]), 3);
});

function rowsWithRuns() {
  const rows = normalizeRows([{ id: 'easy', url: 'https://www.youtube.com/watch?v=PUP7U5vTMM0' }]);
  const ok = (cost, ms, extra) => runFromPayload({ ...payload(), meta: { ...payload().meta, cost_usd: cost, ms, ...extra } }, { now: NOW });
  rows[0].run = ok(0.01, 20000);
  rows[1].run = ok(0.03, 40000);
  rows[2].run = ok(0.05, 60000);
  rows[3].run = runFromError({ code: 'too_long', message: 'Too long.' }, { now: NOW });
  rows[0].rating = 'good';
  rows[1].rating = 'ok';
  return rows;
}

test('totals work out time, cost per recipe and how many behaved as hoped', () => {
  const t = totals(rowsWithRuns());
  assert.equal(t.rows, DEFAULT_ROWS.length);
  assert.equal(t.ran, 4);
  assert.equal(t.recipes, 3);
  assert.equal(t.medianMs, 40000);
  assert.equal(t.medianCost, 0.03);
  assert.ok(Math.abs(t.averageCost - 0.03) < 1e-9);
  assert.equal(t.lowestCost, 0.01);
  assert.equal(t.highestCost, 0.05);
  assert.ok(Math.abs(t.totalCost - 0.09) < 1e-9);
  assert.deepEqual(t.rated, { good: 1, ok: 1, poor: 0 });
  // 'short' has no check; the other three recipes were hoped for, 'many' wanted several dishes but got one
  assert.equal(t.checked, 3);
  assert.equal(t.asExpected, 2);
});

test('totals are quiet when nothing has run', () => {
  const t = totals(normalizeRows(null));
  assert.equal(t.ran, 0);
  assert.equal(t.medianMs, null);
  assert.equal(t.averageCost, null);
  assert.equal(t.totalCost, 0);
});

test('normalizeRows keeps edits, drops junk, and always returns the whole set', () => {
  const rows = normalizeRows([
    { id: 'easy', url: '  https://youtu.be/abcdefghijk  ', note: 'Nice', rating: 'good', label: 'My own label' },
    { id: 'short', rating: 'amazing', note: 42, run: 'not a run' },
    { id: 'not-a-row', url: 'x' },
    null,
    'text',
  ]);
  assert.equal(rows.length, DEFAULT_ROWS.length);
  assert.equal(rows[0].url, 'https://youtu.be/abcdefghijk');
  assert.equal(rows[0].label, 'My own label');
  assert.equal(rows[0].rating, 'good');
  assert.equal(rows[1].rating, '');
  assert.equal(rows[1].note, '');
  assert.equal(rows[1].run, null);
  assert.equal(rows[2].url, DEFAULT_ROWS[2].url);
  assert.equal(normalizeRows('junk').length, DEFAULT_ROWS.length);
});

test('toMarkdown writes one row per video, escapes pipes and says what was not tested', () => {
  const rows = rowsWithRuns();
  rows[0].note = 'Amounts | all right\nsecond line';
  const md = toMarkdown(rows, { origin: 'https://example.workers.dev', date: '23 Nov 2026' });
  const lines = md.split('\n');
  assert.match(lines[0], /^\| # \| Video \|/);
  assert.match(lines[1], /^\|---/);
  const body = lines.filter((l) => /^\| \d+ \|/.test(l));
  assert.equal(body.length, DEFAULT_ROWS.length);
  assert.match(body[0], /\[PUP7U5vTMM0\]\(https:\/\/www\.youtube\.com\/watch\?v=PUP7U5vTMM0\)/);
  assert.match(body[0], /Made a recipe \(as hoped\)/);
  assert.match(body[0], /\$0\.010/);
  assert.match(body[0], /5 of 7/);
  assert.match(body[0], /Amounts \\\| all right second line/);
  assert.match(body[0], /\| Good \|/);
  assert.match(body[3], /Failed \(too_long\) \(not as hoped\)/);
  assert.match(body[5], /not tested/);
  assert.match(md, /4 of 8 videos run on 23 Nov 2026 against https:\/\/example\.workers\.dev\./);
  assert.match(md, /Median time for a recipe: 40\.0 s\./);
  assert.match(md, /Cost per recipe: average \$0\.030, from \$0\.010 to \$0\.050\./);
  assert.match(md, /Total spent on this run: \$0\.090\./);
});

test('toMarkdown still makes a valid table before anything has run', () => {
  const md = toMarkdown(normalizeRows([]));
  assert.ok(md.split('\n').filter((l) => /^\| \d+ \|/.test(l)).length === DEFAULT_ROWS.length);
  assert.match(md, /Total spent on this run: \$0\./);
});
