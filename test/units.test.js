import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseQuantity,
  normalizeUnit,
  formatNumber,
  convertAmount,
  describeAmount,
  convertTemperature,
  formatDuration,
  formatClock,
  displayUnit,
} from '../public/js/shared/units.js';

test('parseQuantity reads the ways people write amounts', () => {
  assert.deepEqual(parseQuantity(2), { min: 2, max: null });
  assert.deepEqual(parseQuantity('1/2'), { min: 0.5, max: null });
  assert.deepEqual(parseQuantity('1 1/2'), { min: 1.5, max: null });
  assert.deepEqual(parseQuantity('½'), { min: 0.5, max: null });
  assert.deepEqual(parseQuantity('1½'), { min: 1.5, max: null });
  assert.deepEqual(parseQuantity('2-3'), { min: 2, max: 3 });
  assert.deepEqual(parseQuantity('2 to 3'), { min: 2, max: 3 });
  assert.deepEqual(parseQuantity('2–3'), { min: 2, max: 3 });
  assert.deepEqual(parseQuantity('two'), { min: 2, max: null });
  assert.deepEqual(parseQuantity('0,5'), { min: 0.5, max: null });
  assert.equal(parseQuantity(''), null);
  assert.equal(parseQuantity(null), null);
  assert.equal(parseQuantity('some'), null);
  assert.equal(parseQuantity(-1), null);
  assert.equal(parseQuantity(Number.NaN), null);
});

test('normalizeUnit maps spellings to one short form and keeps unknown units', () => {
  assert.equal(normalizeUnit('Teaspoons'), 'tsp');
  assert.equal(normalizeUnit('tbsp.'), 'tbsp');
  assert.equal(normalizeUnit('Grams'), 'g');
  assert.equal(normalizeUnit('fluid ounces'), 'fl oz');
  assert.equal(normalizeUnit('clove'), 'clove');
  assert.equal(normalizeUnit('none'), null);
  assert.equal(normalizeUnit(null), null);
});

test('formatNumber writes kitchen fractions', () => {
  assert.equal(formatNumber(0.5), '½');
  assert.equal(formatNumber(1.5), '1½');
  assert.equal(formatNumber(0.333), '⅓');
  assert.equal(formatNumber(2.25), '2¼');
  assert.equal(formatNumber(3), '3');
  assert.equal(formatNumber(0.97), '1');
  assert.equal(formatNumber(24.4), '24');
  assert.equal(formatNumber(null), '');
});

test('displayUnit pluralises only the units that need it', () => {
  assert.equal(displayUnit('cup', 1), 'cup');
  assert.equal(displayUnit('cup', 2), 'cups');
  assert.equal(displayUnit('clove', 3), 'cloves');
  assert.equal(displayUnit('pinch', 2), 'pinches');
  assert.equal(displayUnit('tsp', 3), 'tsp');
  assert.equal(displayUnit(null, 3), '');
});

test('convertAmount: cups and ounces to metric, metric to US, spoons untouched', () => {
  assert.deepEqual(
    pick(convertAmount({ quantity: 1, unit: 'cup' }, 'metric')),
    { quantity: 240, unit: 'ml', converted: true },
  );
  assert.deepEqual(
    pick(convertAmount({ quantity: 5, unit: 'cups' }, 'metric')),
    { quantity: 1.2, unit: 'l', converted: true },
  );
  assert.deepEqual(
    pick(convertAmount({ quantity: 8, unit: 'oz' }, 'metric')),
    { quantity: 225, unit: 'g', converted: true },
  );
  assert.deepEqual(
    pick(convertAmount({ quantity: 2, unit: 'tbsp' }, 'metric')),
    { quantity: 2, unit: 'tbsp', converted: false },
  );
  const grams = convertAmount({ quantity: 100, unit: 'g' }, 'us');
  assert.equal(grams.unit, 'oz');
  assert.ok(Math.abs(grams.quantity - 3.527) < 0.01);
  assert.equal(grams.approx, true);
  assert.equal(convertAmount({ quantity: 1000, unit: 'g' }, 'us').unit, 'lb');
  assert.equal(convertAmount({ quantity: 250, unit: 'ml' }, 'us').unit, 'cup');
  assert.equal(convertAmount({ quantity: 30, unit: 'ml' }, 'us').unit, 'tbsp');
  assert.equal(convertAmount({ quantity: 5, unit: 'ml' }, 'us').unit, 'tsp');
  // 'orig' and countable items are left alone
  assert.equal(convertAmount({ quantity: 1, unit: 'cup' }, 'orig').converted, false);
  assert.equal(convertAmount({ quantity: 3, unit: null }, 'metric').converted, false);
});

function pick({ quantity, unit, converted }) {
  return { quantity, unit, converted };
}

test('describeAmount scales, converts and is honest about missing amounts', () => {
  assert.deepEqual(describeAmount({ quantity: 1, unit: 'cup' }, { factor: 2 }), {
    text: '2 cups',
    approx: false,
    missing: false,
  });
  assert.equal(describeAmount({ quantity: 1, unit: 'cup' }, { system: 'metric' }).text, '240 ml');
  assert.equal(describeAmount({ quantity: 0.5, unit: 'tsp' }, { factor: 3 }).text, '1½ tsp');
  assert.equal(describeAmount({ quantity: 2, quantity_max: 3, unit: 'clove' }).text, '2–3 cloves');
  assert.equal(describeAmount({ quantity: 4, unit: null }, { factor: 0.5 }).text, '2');
  assert.deepEqual(describeAmount({ quantity: null, amount_text: 'to taste' }), {
    text: 'to taste',
    approx: false,
    missing: false,
  });
  assert.deepEqual(describeAmount({ quantity: null, amount_text: null }), { text: '', approx: false, missing: true });
  assert.equal(describeAmount({ quantity: 100, unit: 'g' }, { system: 'us' }).approx, true);
});

test('convertTemperature rounds to a sensible step and leaves matching units alone', () => {
  assert.deepEqual(convertTemperature({ value: 350, unit: 'F' }, 'metric'), { value: 175, unit: 'C', converted: true });
  assert.deepEqual(convertTemperature({ value: 180, unit: 'C' }, 'us'), { value: 355, unit: 'F', converted: true });
  assert.deepEqual(convertTemperature({ value: 180, unit: 'C' }, 'metric'), { value: 180, unit: 'C', converted: false });
  assert.deepEqual(convertTemperature({ value: 350, unit: 'F' }, 'orig'), { value: 350, unit: 'F', converted: false });
  assert.equal(convertTemperature(null, 'metric'), null);
  assert.equal(convertTemperature({ value: 'hot', unit: 'C' }, 'metric'), null);
});

test('time helpers', () => {
  assert.equal(formatDuration(20), '20 sec');
  assert.equal(formatDuration(600), '10 min');
  assert.equal(formatDuration(90), '1 min 30 sec');
  assert.equal(formatDuration(3900), '1 h 5 min');
  assert.equal(formatClock(125), '02:05');
  assert.equal(formatClock(3725), '1:02:05');
  assert.equal(formatClock(-5), '00:00');
  assert.equal(formatClock(0.2), '00:01');
});
