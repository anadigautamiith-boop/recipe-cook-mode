import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, normalizeResult, summarizeResult } from '../src/schema.js';
import { sampleRecipe } from './helpers.js';

const clone = (x) => JSON.parse(JSON.stringify(x));

test('extractJson copes with fences, chatter and trailing commas', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Sure! Here you go:\n{"a":1}\nHope that helps.'), { a: 1 });
  assert.deepEqual(extractJson('{"a":[1,2,],}'), { a: [1, 2] });
  assert.throws(() => extractJson('no json here'));
  assert.throws(() => extractJson(''));
  assert.throws(() => extractJson(null));
});

test('a good reply comes through with the structure the app needs', () => {
  const out = normalizeResult(clone(sampleRecipe), { platform: 'youtube' });
  assert.equal(out.is_recipe, true);
  assert.equal(out.recipes.length, 1);
  const r = out.recipes[0];
  assert.equal(r.title, 'Tomato and Egg Stir-Fry');
  assert.equal(r.servings, 2);
  assert.equal(r.servings_stated, true);
  assert.equal(r.ingredients.length, 7);
  assert.equal(r.steps.length, 8);
  assert.equal(r.steps[2].timer_seconds, 20);
  assert.equal(r.steps[1].heat, 'high');
  assert.equal(r.steps[0].done_cue_added, true);
  assert.equal(r.steps[3].done_cue, null);
  assert.equal(r.steps[3].done_cue_added, false);
  assert.deepEqual(r.steps[0].terms[0].term, 'beat');
  assert.equal(r.gaps.length, 3);
});

test('amounts are cleaned: text fractions become numbers, units are standardised', () => {
  const r = normalizeResult(clone(sampleRecipe)).recipes[0];
  const eggSalt = r.ingredients[1];
  assert.equal(eggSalt.quantity, 0.25);
  assert.equal(eggSalt.unit, 'tsp');
  assert.equal(r.ingredients[0].unit, null);
  assert.equal(r.ingredients[4].quantity, null);
  assert.equal(r.ingredients[4].amount_text, 'a handful');
});

test('an ingredient the video did not give an amount for never gets an invented one', () => {
  const r = normalizeResult(clone(sampleRecipe)).recipes[0];
  const tomatoSalt = r.ingredients[5];
  assert.equal(tomatoSalt.name, 'salt');
  // the model supplied 0.5 tsp but also said "stated: false": the number must be dropped
  assert.equal(tomatoSalt.stated, false);
  assert.equal(tomatoSalt.quantity, null);
  assert.equal(tomatoSalt.unit, null);
  const oil = r.ingredients[6];
  assert.equal(oil.stated, false);
  assert.equal(oil.quantity, null);
  assert.equal(oil.amount_text, null);
});

test('an ingredient with no number and no words is marked as not stated', () => {
  const raw = clone(sampleRecipe);
  raw.recipes[0].ingredients = [{ name: 'pepper', stated: true }];
  const ing = normalizeResult(raw).recipes[0].ingredients[0];
  assert.equal(ing.stated, false);
});

test('video timestamps are kept for YouTube, dropped for text and dropped if out of order', () => {
  const yt = normalizeResult(clone(sampleRecipe), { platform: 'youtube' }).recipes[0];
  assert.deepEqual(yt.steps.map((s) => s.video_t), [22, 45, 58, 80, 95, 150, 170, 190]);

  const text = normalizeResult(clone(sampleRecipe), { platform: 'text' }).recipes[0];
  assert.ok(text.steps.every((s) => s.video_t === null));

  const shuffled = clone(sampleRecipe);
  shuffled.recipes[0].steps[3].video_t = 5; // goes backwards
  const out = normalizeResult(shuffled, { platform: 'youtube' }).recipes[0];
  assert.ok(out.steps.every((s) => s.video_t === null));

  const allSame = clone(sampleRecipe);
  allSame.recipes[0].steps.forEach((s) => (s.video_t = 30));
  assert.ok(normalizeResult(allSame, { platform: 'youtube' }).recipes[0].steps.every((s) => s.video_t === null));
});

test('numbers outside sensible bounds are dropped, not trusted', () => {
  const raw = clone(sampleRecipe);
  const r = raw.recipes[0];
  r.servings = 5000;
  r.time_minutes = -3;
  r.steps[0].timer_seconds = 999999;
  r.steps[1].temperature = { value: 5000, unit: 'C' };
  r.steps[2].temperature = { value: 350, unit: 'F' };
  r.steps[4].heat = 'volcanic';
  const out = normalizeResult(raw).recipes[0];
  assert.equal(out.servings, null);
  assert.equal(out.servings_stated, false);
  assert.equal(out.time_minutes, null);
  assert.equal(out.steps[0].timer_seconds, null);
  assert.equal(out.steps[1].temperature, null);
  assert.deepEqual(out.steps[2].temperature, { value: 350, unit: 'F' });
  assert.equal(out.steps[4].heat, null);
});

test('text is trimmed, control characters removed and length capped', () => {
  const raw = clone(sampleRecipe);
  raw.recipes[0].title = `  Soup\u0000\u0007   for   ${'x'.repeat(500)} `;
  const title = normalizeResult(raw).recipes[0].title;
  assert.ok(title.startsWith('Soup for xxx'));
  assert.ok(title.length <= 140);
  assert.ok(!/[\u0000-\u001f]/.test(title));
});

test('steps given as plain strings are accepted; empty ones are dropped', () => {
  const raw = {
    is_recipe: true,
    recipes: [{ title: 'Toast', steps: ['Toast the bread.', '', { text: '  ' }, { text: 'Butter it.' }] }],
  };
  const r = normalizeResult(raw).recipes[0];
  assert.deepEqual(r.steps.map((s) => s.text), ['Toast the bread.', 'Butter it.']);
});

test('a single recipe at the top level is accepted', () => {
  const raw = { title: 'Toast', steps: [{ text: 'Toast the bread.' }] };
  const out = normalizeResult(raw);
  assert.equal(out.is_recipe, true);
  assert.equal(out.recipes[0].title, 'Toast');
});

test('"not a recipe" is passed through with its reason and no recipes', () => {
  const out = normalizeResult({ is_recipe: false, not_recipe_reason: 'It is a dance video.', recipes: [{ title: 'x', steps: ['a'] }] });
  assert.equal(out.is_recipe, false);
  assert.equal(out.not_recipe_reason, 'It is a dance video.');
  assert.deepEqual(out.recipes, []);
});

test('a reply that claims a recipe but has no usable steps is rejected so another model can try', () => {
  assert.throws(() => normalizeResult({ is_recipe: true, recipes: [{ title: 'x', ingredients: [{ name: 'egg' }], steps: [] }] }));
  assert.throws(() => normalizeResult({ recipes: [] }));
  assert.throws(() => normalizeResult('nope'));
  assert.throws(() => normalizeResult([1, 2]));
});

test('at most three recipes and a bounded number of steps are kept', () => {
  const raw = {
    is_recipe: true,
    recipes: Array.from({ length: 6 }, (_, i) => ({
      title: `R${i}`,
      steps: Array.from({ length: 80 }, (_, j) => ({ text: `Step ${j}` })),
    })),
  };
  const out = normalizeResult(raw);
  assert.equal(out.recipes.length, 3);
  assert.equal(out.recipes[0].steps.length, 40);
});

test('summarizeResult counts what the Test Lab reports', () => {
  const s = summarizeResult(normalizeResult(clone(sampleRecipe)));
  assert.deepEqual(s, { recipes: 1, ingredients: 7, ingredients_stated: 5, steps: 8, timers: 3, cues: 5, gaps: 3 });
  assert.equal(summarizeResult({ recipes: [] }).steps, 0);
});
