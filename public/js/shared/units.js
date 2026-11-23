// Amounts, units, scaling and temperatures. Shared by the browser and the Worker.
// Everything here is plain arithmetic: it costs nothing and never calls an AI model.

const VULGAR = {
  '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8, '⅙': 1 / 6, '⅚': 5 / 6,
};
const WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, half: 0.5, quarter: 0.25, dozen: 12,
};

function parseSimple(str) {
  const s = str.trim();
  if (!s) return null;
  if (Object.hasOwn(WORDS, s)) return WORDS[s];
  let m = s.match(/^(\d+)?\s*([¼½¾⅓⅔⅛⅜⅝⅞⅕⅖⅗⅘⅙⅚])$/);
  if (m) return (m[1] ? Number(m[1]) : 0) + VULGAR[m[2]];
  m = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (m && Number(m[3]) !== 0) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m && Number(m[2]) !== 0) return Number(m[1]) / Number(m[2]);
  m = s.match(/^\d+(?:[.,]\d+)?$/);
  if (m) return parseFloat(s.replace(',', '.'));
  return null;
}

/**
 * Read an amount that may be a number, "1/2", "1 1/2", "½", "2-3" or "two".
 * Returns { min, max } (max is null unless it was a range) or null.
 */
export function parseQuantity(input) {
  if (input == null || input === '') return null;
  if (typeof input === 'number') {
    return Number.isFinite(input) && input >= 0 ? { min: input, max: null } : null;
  }
  let s = String(input).trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;
  s = s.replace(/[–—]/g, '-').replace(/\s+to\s+/g, '-').replace(/\s*-\s*/g, '-');
  if (s.includes('-')) {
    const pieces = s.split('-');
    if (pieces.length === 2) {
      const lo = parseSimple(pieces[0]);
      const hi = parseSimple(pieces[1]);
      if (lo != null && hi != null && hi > lo) return { min: lo, max: hi };
    }
    const mixed = parseSimple(s.replace('-', ' '));
    return mixed == null ? null : { min: mixed, max: null };
  }
  const v = parseSimple(s);
  return v == null ? null : { min: v, max: null };
}

// ---- Units ----------------------------------------------------------------

const UNIT_ALIASES = {
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp', tbs: 'tbsp', tbl: 'tbsp',
  cup: 'cup', cups: 'cup',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  g: 'g', gram: 'g', grams: 'g', gm: 'g', gms: 'g',
  kg: 'kg', kgs: 'kg', kilogram: 'kg', kilograms: 'kg',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  'fl oz': 'fl oz', floz: 'fl oz', 'fluid ounce': 'fl oz', 'fluid ounces': 'fl oz',
};

/** Map spelling variants to one short unit; unknown units (clove, can, pinch...) pass through. */
export function normalizeUnit(u) {
  if (u == null) return null;
  const s = String(u).trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
  if (!s || s === 'none' || s === 'null' || s === 'n/a' || s === 'unit') return null;
  if (Object.hasOwn(UNIT_ALIASES, s)) return UNIT_ALIASES[s];
  return s.slice(0, 30);
}

const METRIC_UNITS = new Set(['g', 'kg', 'ml', 'l']);
export const isMetricUnit = (u) => METRIC_UNITS.has(u);

// Kitchen-friendly conversion factors (rounded on purpose).
const ML_PER = { cup: 240, 'fl oz': 30 };
const G_PER = { oz: 28.35, lb: 453.6 };

/** Show a unit in the right singular/plural form for a quantity. */
export function displayUnit(unit, qty) {
  if (!unit) return '';
  if (['tsp', 'tbsp', 'g', 'kg', 'ml', 'l', 'oz', 'lb', 'fl oz'].includes(unit)) return unit;
  if (!(qty > 1)) return unit;
  if (/(s|x|ch|sh)$/.test(unit)) return `${unit}es`;
  return `${unit}s`;
}

// ---- Number formatting ------------------------------------------------------

const FRACTIONS = [
  [0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'],
  [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'], [1, ''],
];

/** 1.5 -> "1½", 0.333 -> "⅓", 12 -> "12". For spoons, cups and counts. */
export function formatNumber(q) {
  if (q == null || !Number.isFinite(q)) return '';
  if (q <= 0) return '0';
  if (q >= 20) return String(Math.round(q));
  let whole = Math.floor(q);
  const frac = q - whole;
  let best = FRACTIONS[0];
  let bestDiff = Infinity;
  for (const f of FRACTIONS) {
    const d = Math.abs(frac - f[0]);
    if (d < bestDiff) {
      best = f;
      bestDiff = d;
    }
  }
  if (bestDiff > 0.04) return String(Math.round(q * 10) / 10);
  if (best[0] === 1) whole += 1;
  if (!best[1]) return whole === 0 ? String(Math.round(q * 100) / 100) : String(whole);
  return (whole ? String(whole) : '') + best[1];
}

/** Round grams/millilitres to a sensible step: 83.25 -> 83, 247 -> 245, 4.3 -> 4.5. */
export function niceMetric(q) {
  if (q >= 100) return Math.round(q / 5) * 5;
  if (q >= 10) return Math.round(q);
  return Math.round(q * 2) / 2;
}

export function formatMetric(q) {
  if (q == null || !Number.isFinite(q)) return '';
  const r = Math.round(q * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

// Round to the nearest quarter or third, whichever is closer.
function roundNice(q) {
  const r4 = Math.round(q * 4) / 4;
  const r3 = Math.round(q * 3) / 3;
  return Math.abs(r4 - q) <= Math.abs(r3 - q) ? r4 : r3;
}

// ---- Conversion ---------------------------------------------------------------

/**
 * Convert one amount to the chosen system: 'orig' (leave alone), 'metric' or 'us'.
 * Spoons are used in both systems, so they are never converted.
 * Returns { quantity, quantity_max, unit, converted, approx }.
 */
export function convertAmount({ quantity, quantity_max = null, unit }, system) {
  const u = normalizeUnit(unit);
  const same = { quantity, quantity_max, unit: u, converted: false, approx: false };
  if (system === 'orig' || quantity == null || u == null) return same;

  const mapBoth = (fn) => ({
    quantity: fn(quantity),
    quantity_max: quantity_max == null ? null : fn(quantity_max),
  });

  if (system === 'metric') {
    if (Object.hasOwn(ML_PER, u)) {
      const f = ML_PER[u];
      const big = quantity * f >= 1000;
      const out = mapBoth((x) => (big ? x * f / 1000 : niceMetric(x * f)));
      return { ...out, unit: big ? 'l' : 'ml', converted: true, approx: false };
    }
    if (Object.hasOwn(G_PER, u)) {
      const f = G_PER[u];
      const big = quantity * f >= 1000;
      const out = mapBoth((x) => (big ? x * f / 1000 : niceMetric(x * f)));
      return { ...out, unit: big ? 'kg' : 'g', converted: true, approx: false };
    }
    return same;
  }

  if (system === 'us') {
    if (u === 'g' || u === 'kg') {
      const grams = (x) => (u === 'kg' ? x * 1000 : x);
      const oz = grams(quantity) / G_PER.oz;
      if (oz >= 16) {
        const out = mapBoth((x) => grams(x) / G_PER.lb);
        return { ...out, unit: 'lb', converted: true, approx: true };
      }
      const out = mapBoth((x) => grams(x) / G_PER.oz);
      return { ...out, unit: 'oz', converted: true, approx: true };
    }
    if (u === 'ml' || u === 'l') {
      const ml = (x) => (u === 'l' ? x * 1000 : x);
      const base = ml(quantity);
      if (base < 15) {
        const out = mapBoth((x) => roundNice(ml(x) / 5));
        return { ...out, unit: 'tsp', converted: true, approx: true };
      }
      if (base < 60) {
        const out = mapBoth((x) => roundNice(ml(x) / 15));
        return { ...out, unit: 'tbsp', converted: true, approx: true };
      }
      const out = mapBoth((x) => roundNice(ml(x) / ML_PER.cup));
      return { ...out, unit: 'cup', converted: true, approx: true };
    }
    return same;
  }
  return same;
}

/**
 * Words for one ingredient's amount, scaled and converted.
 * { text, approx, missing } — `missing` is true when the video gave no amount at all.
 */
export function describeAmount(ing, { factor = 1, system = 'orig' } = {}) {
  if (ing.quantity == null) {
    if (ing.amount_text) return { text: ing.amount_text, approx: false, missing: false };
    return { text: '', approx: false, missing: true };
  }
  const c = convertAmount(
    {
      quantity: ing.quantity * factor,
      quantity_max: ing.quantity_max == null ? null : ing.quantity_max * factor,
      unit: ing.unit,
    },
    system,
  );
  const fmt = (x) => (isMetricUnit(c.unit) && c.converted ? formatMetric(x) : formatNumber(x));
  let num = fmt(c.quantity);
  if (c.quantity_max != null) num += `–${fmt(c.quantity_max)}`;
  const unitText = c.unit ? displayUnit(c.unit, c.quantity_max ?? c.quantity) : '';
  return { text: [num, unitText].filter(Boolean).join(' '), approx: c.approx, missing: false };
}

/** Temperatures: { value, unit: 'C' | 'F' } in, converted for the chosen system out. */
export function convertTemperature(t, system) {
  if (!t || typeof t.value !== 'number' || !Number.isFinite(t.value)) return null;
  const unit = String(t.unit || 'C').toUpperCase() === 'F' ? 'F' : 'C';
  const roundTo5 = (x) => Math.round(x / 5) * 5;
  if (system === 'orig' || (system === 'metric' && unit === 'C') || (system === 'us' && unit === 'F')) {
    return { value: Math.round(t.value), unit, converted: false };
  }
  if (system === 'metric') return { value: roundTo5(((t.value - 32) * 5) / 9), unit: 'C', converted: true };
  return { value: roundTo5((t.value * 9) / 5 + 32), unit: 'F', converted: true };
}

// ---- Time ------------------------------------------------------------------------

/** 600 -> "10 min", 90 -> "1 min 30 sec", 3900 -> "1 h 5 min". */
export function formatDuration(seconds) {
  const s = Math.round(seconds);
  if (s < 60) return `${s} sec`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m} min ${r} sec` : `${m} min`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h} h ${mm} min` : `${h} h`;
}

/** 125 -> "02:05", 3725 -> "1:02:05". For countdowns. */
export function formatClock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(r)}` : `${two(m)}:${two(r)}`;
}
