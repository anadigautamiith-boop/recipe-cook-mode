import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectGaps,
  costText,
  heatLabel,
  heatLevel,
  ingredientLine,
  matchIngredients,
  mmss,
  provenanceLine,
  secondsText,
  segmentText,
  sourceKind,
  temperatureText,
  timeAgo,
} from '../public/js/format.js';

const ing = (name, extra = {}) => ({ name, group: null, note: null, quantity: null, unit: null, amount_text: null, stated: true, ...extra });

// ---- clocks, money, time ----

test('mmss shows minutes and seconds, and hours only when needed', () => {
  assert.equal(mmss(0), '0:00');
  assert.equal(mmss(9), '0:09');
  assert.equal(mmss(95), '1:35');
  assert.equal(mmss(3725), '1:02:05');
  assert.equal(mmss(-4), '0:00');
  assert.equal(mmss(59.6), '1:00');
});

test('costText keeps tiny costs readable and says so when none was reported', () => {
  assert.equal(costText(null), 'not reported');
  assert.equal(costText(0), '$0');
  assert.equal(costText(0.00042), '$0.0004');
  assert.equal(costText(0.0123), '$0.012');
  assert.equal(costText(0.5), '$0.50');
});

test('secondsText rounds to one decimal', () => {
  assert.equal(secondsText(1234), '1.2 s');
  assert.equal(secondsText(60000), '60.0 s');
});

test('timeAgo gives short plain phrases and survives bad input', () => {
  const now = Date.parse('2026-11-23T12:00:00Z');
  assert.equal(timeAgo('2026-11-23T11:59:40Z', now), 'just now');
  assert.equal(timeAgo('2026-11-23T11:55:00Z', now), '5 min ago');
  assert.equal(timeAgo('2026-11-23T09:00:00Z', now), '3 h ago');
  assert.equal(timeAgo('2026-11-22T11:00:00Z', now), 'yesterday');
  assert.equal(timeAgo('2026-11-20T12:00:00Z', now), '3 days ago');
  assert.equal(timeAgo('not a date', now), '');
});

// ---- heat and temperature ----

test('heat helpers map the five levels and ignore anything else', () => {
  assert.equal(heatLevel('low'), 1);
  assert.equal(heatLevel('high'), 5);
  assert.equal(heatLevel(null), 0);
  assert.equal(heatLabel('medium-high'), 'Medium-high heat');
  assert.equal(heatLabel('lava'), '');
});

test('temperatureText marks converted values with ≈ and leaves originals alone', () => {
  assert.equal(temperatureText({ value: 180, unit: 'C' }, 'orig'), '180°C');
  assert.equal(temperatureText({ value: 180, unit: 'C' }, 'us'), '≈355°F');
  assert.equal(temperatureText({ value: 350, unit: 'F' }, 'metric'), '≈175°C');
  assert.equal(temperatureText({ value: 350, unit: 'F' }, 'us'), '350°F');
  assert.equal(temperatureText(null, 'orig'), '');
});

// ---- ingredient lines ----

test('ingredientLine writes a pasteable shopping-list line and flags missing amounts', () => {
  assert.equal(ingredientLine(ing('eggs', { quantity: 4 })), '4 eggs');
  assert.equal(ingredientLine(ing('salt', { quantity: 0.25, unit: 'tsp', note: 'for the eggs' })), '¼ tsp salt (for the eggs)');
  assert.equal(ingredientLine(ing('cooking oil', { stated: false })), 'cooking oil (amount not stated)');
  assert.equal(ingredientLine(ing('spring onion', { amount_text: 'a handful' })), 'a handful spring onion');
  assert.equal(ingredientLine(ing('eggs', { quantity: 4 }), { factor: 1.5 }), '6 eggs');
});

// ---- where the recipe came from ----

test('sourceKind and provenanceLine say plainly how the recipe was read', () => {
  assert.equal(sourceKind({ source: { type: 'youtube' } }), 'video');
  assert.equal(sourceKind({ source: { type: 'instagram-caption' } }), 'caption');
  assert.equal(sourceKind({ source: { type: 'pasted-text' } }), 'text');
  assert.equal(sourceKind({}), 'text');
  assert.equal(sourceKind(null), 'text');
  assert.match(provenanceLine({ source: { type: 'youtube' } }), /video itself/);
  assert.match(provenanceLine({ source: { type: 'instagram-caption' } }), /caption only/);
  assert.match(provenanceLine({ source: { type: 'pasted-text' } }), /text you pasted/);
});

// ---- underlining cooking words ----

const joined = (parts) => parts.map((p) => p.text).join('');

test('segmentText underlines a whole word and keeps the original spelling', () => {
  const parts = segmentText('Crack the eggs and Beat until smooth.', [{ term: 'beat' }]);
  assert.equal(joined(parts), 'Crack the eggs and Beat until smooth.');
  const hit = parts.find((p) => p.term === 0);
  assert.equal(hit.text, 'Beat');
});

test('segmentText catches simple endings but never the middle of another word', () => {
  assert.equal(segmentText('Keep beating the eggs.', [{ term: 'beat' }]).find((p) => p.term === 0).text, 'beating');
  assert.equal(segmentText('Fold the whites.', [{ term: 'fold' }]).find((p) => p.term === 0).text, 'Fold');
  // "set" inside "reset" and "settle" is not the cooking word
  const none = segmentText('Reset the pan and let it settle.', [{ term: 'set' }]);
  assert.equal(none.length, 1);
  assert.equal(none[0].term, undefined);
});

test('segmentText handles several terms in text order and ignores a term that is not there', () => {
  const parts = segmentText('Fold in the flour, then sift it.', [{ term: 'sift' }, { term: 'fold' }, { term: 'blanch' }]);
  assert.equal(joined(parts), 'Fold in the flour, then sift it.');
  const marked = parts.filter((p) => p.term != null).map((p) => p.text);
  assert.deepEqual(marked, ['Fold', 'sift']);
});

test('segmentText copes with empty input', () => {
  assert.deepEqual(segmentText('Plain text.', []), [{ text: 'Plain text.' }]);
  assert.deepEqual(segmentText('Plain text.', [{ term: '' }, null]), [{ text: 'Plain text.' }]);
});

// ---- which ingredients a step talks about ----

const pantry = [
  ing('eggs', { group: 'Eggs' }),
  ing('salt', { group: 'Eggs', note: 'for the eggs' }),
  ing('ripe tomatoes', { group: 'Tomato sauce', note: 'cut into wedges' }),
  ing('sugar', { group: 'Tomato sauce' }),
  ing('salt', { group: 'Tomato sauce', note: 'for the tomatoes' }),
  ing('cooking oil'),
];

test('matchIngredients finds ingredients by their main word, plural or not', () => {
  assert.deepEqual(matchIngredients('Heat the oil in the wok.', pantry), [5]);
  assert.deepEqual(matchIngredients('Cut a tomato into wedges.', pantry), [2]);
  assert.deepEqual(matchIngredients('Move it onto a plate.', pantry), []);
});

test('matchIngredients uses the note to pick the right one of two same-named ingredients', () => {
  assert.deepEqual(matchIngredients('Crack the eggs into a bowl, add the salt and beat.', pantry), [0, 1]);
  assert.deepEqual(matchIngredients('Add the sugar and the salt for the tomatoes.', pantry), [2, 3, 4]);
});

test('matchIngredients keeps both when the step gives no clue which one is meant', () => {
  assert.deepEqual(matchIngredients('Season everything with salt.', pantry), [1, 4]);
});

test('matchIngredients ignores filler words such as "ripe" and "cooking"', () => {
  assert.deepEqual(matchIngredients('Wait until the ripe fruit is soft and the cooking is done.', pantry), []);
});

// ---- what the video did not say ----

test('collectGaps adds blank amounts the model forgot to list, without repeating itself', () => {
  const recipe = {
    gaps: ['The amount of cooking oil is not stated.'],
    servings: 2,
    servings_stated: true,
    ingredients: [ing('cooking oil', { stated: false }), ing('soy sauce', { stated: false }), ing('eggs', { quantity: 4 })],
  };
  assert.deepEqual(collectGaps(recipe), ['The amount of cooking oil is not stated.', 'The amount of soy sauce is not stated.']);
});

test('collectGaps says so when the serving size was not given', () => {
  const recipe = { gaps: [], servings: null, servings_stated: false, ingredients: [] };
  assert.deepEqual(collectGaps(recipe), ['How many people it feeds is not stated.']);
  const known = { gaps: [], servings: 4, servings_stated: true, ingredients: [] };
  assert.deepEqual(collectGaps(known), []);
});
