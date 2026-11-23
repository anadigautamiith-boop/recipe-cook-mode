// Checking and cleaning what the AI model sends back.
// We never trust it: every field is coerced, trimmed and capped before the app uses it.

import { parseQuantity, normalizeUnit } from '../public/js/shared/units.js';

const MAX = {
  title: 140,
  summary: 240,
  name: 120,
  note: 200,
  group: 80,
  amountText: 40,
  step: 500,
  cue: 300,
  term: 60,
  meaning: 200,
  tip: 300,
  gap: 240,
  equipment: 60,
  videoNote: 300,
  reason: 300,
};
const HEAT = new Set(['low', 'medium-low', 'medium', 'medium-high', 'high']);

/** Find and parse the JSON object inside a model reply (handles ``` fences and stray text). */
export function extractJson(text) {
  if (typeof text !== 'string') throw new Error('empty reply');
  let s = text.trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(s);
  } catch {
    // fall through
  }
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const slice = s.slice(first, last + 1);
    try {
      return JSON.parse(slice);
    } catch {
      // try removing trailing commas
    }
    try {
      return JSON.parse(slice.replace(/,\s*([}\]])/g, '$1'));
    } catch {
      // fall through
    }
  }
  throw new Error('no JSON found');
}

// ---- small coercion helpers --------------------------------------------------

function str(value, max) {
  if (value == null) return '';
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
const strOrNull = (value, max) => str(value, max) || null;

function num(value, { min = -Infinity, max = Infinity, int = false } = {}) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return int ? Math.round(n) : n;
}
const list = (value) => (Array.isArray(value) ? value : []);

// ---- pieces ------------------------------------------------------------------------

function normalizeIngredient(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = str(raw.name, MAX.name);
  if (!name) return null;

  let quantity = null;
  let quantityMax = null;
  const q = parseQuantity(raw.quantity);
  if (q) {
    quantity = q.min;
    quantityMax = q.max;
  }
  const qm = parseQuantity(raw.quantity_max);
  if (qm && quantity != null && qm.min > quantity) quantityMax = qm.min;
  let amountText = strOrNull(raw.amount_text, MAX.amountText);

  // Honesty rule: if the model says the amount was not stated, we drop any number it supplied.
  let stated = (quantity != null || amountText != null) && raw.stated !== false;
  if (!stated) {
    quantity = null;
    quantityMax = null;
    amountText = null;
  }
  return {
    group: strOrNull(raw.group, MAX.group),
    name,
    quantity,
    quantity_max: quantityMax,
    unit: quantity == null ? null : normalizeUnit(raw.unit),
    amount_text: quantity == null ? amountText : null,
    note: strOrNull(raw.note, MAX.note),
    stated,
  };
}

function normalizeTemperature(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const unit = String(raw.unit || '').toUpperCase() === 'F' ? 'F' : 'C';
  const value = num(raw.value, { min: 30, max: 600, int: true });
  if (value == null) return null;
  if (unit === 'C' && value > 350) return null;
  return { value, unit };
}

// ---- "done when" hints that only repeat the step ------------------------------------------

const CUE_FILLER = new Set([
  'the', 'and', 'are', 'was', 'were', 'should', 'will', 'would', 'can', 'could', 'may', 'might',
  'that', 'this', 'these', 'those', 'then', 'when', 'until', 'with', 'from', 'into', 'onto', 'over',
  'under', 'each', 'has', 'have', 'had', 'been', 'being', 'its', 'you', 'your', 'not', 'for', 'just',
  'all', 'also', 'very', 'slightly', 'about', 'around', 'well', 'now', 'done',
]);

// A rough stem, good enough to match "added" with "add" and "shimmering" with "shimmer".
const stem = (word) => word.replace(/(ing|ed|es|s|e)$/, '');

function contentStems(text) {
  return String(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !CUE_FILLER.has(w))
    .map(stem)
    .filter((w) => w.length > 1);
}

/**
 * A "done when" hint is meant to tell a beginner something the step does not: what to look,
 * smell or listen for. If almost every word of it is already in the step, such as
 * "Rice is added to the pan." under "Add the cooked rice to the pan", it only adds noise.
 */
export function restatesStep(cue, stepText) {
  const cueWords = contentStems(cue);
  if (cueWords.length === 0) return true;
  const stepWords = new Set(contentStems(stepText));
  const shared = cueWords.filter((w) => stepWords.has(w)).length;
  return shared / cueWords.length >= 0.8;
}

function normalizeStep(raw, platform) {
  if (typeof raw === 'string') raw = { text: raw };
  if (!raw || typeof raw !== 'object') return null;
  const text = str(raw.text ?? raw.instruction, MAX.step);
  if (!text) return null;
  const rawCue = strOrNull(raw.done_cue, MAX.cue);
  const doneCue = rawCue && !restatesStep(rawCue, text) ? rawCue : null;
  const terms = list(raw.terms)
    .slice(0, 3)
    .map((t) => ({ term: str(t?.term, MAX.term), meaning: str(t?.meaning, MAX.meaning) }))
    .filter((t) => t.term && t.meaning);
  const heat = String(raw.heat ?? '').toLowerCase();
  return {
    text,
    timer_seconds: num(raw.timer_seconds, { min: 5, max: 14_400, int: true }),
    temperature: normalizeTemperature(raw.temperature),
    heat: HEAT.has(heat) ? heat : null,
    done_cue: doneCue,
    done_cue_added: doneCue ? raw.done_cue_added !== false : false,
    terms,
    video_t: platform === 'youtube' ? num(raw.video_t, { min: 0, max: 43_200, int: true }) : null,
  };
}

// Timestamps are only useful if they move forward through the video.
function cleanTimestamps(steps) {
  const times = steps.map((s) => s.video_t);
  const known = times.filter((t) => t != null);
  const increasing = known.every((t, i) => i === 0 || t >= known[i - 1]);
  const distinct = new Set(known).size > 1 || known.length <= 1;
  if (!increasing || !distinct) steps.forEach((s) => (s.video_t = null));
  return steps;
}

/**
 * Step timestamps are the AI's own sense of where it is in the video, and it sometimes gets
 * them wrong (for example by writing 5:31 as 531). When any step sits later than the video can
 * be long, none of the timestamps can be trusted, so none are kept.
 * Returns how many were removed.
 */
export function dropImplausibleTimestamps(result, latestSecond) {
  if (!Number.isFinite(latestSecond)) return 0;
  const steps = result.recipes.flatMap((r) => r.steps);
  if (!steps.some((step) => step.video_t != null && step.video_t > latestSecond)) return 0;
  let removed = 0;
  for (const step of steps) {
    if (step.video_t != null) {
      step.video_t = null;
      removed += 1;
    }
  }
  return removed;
}

function normalizeRecipe(raw, platform) {
  if (!raw || typeof raw !== 'object') return null;
  const ingredients = list(raw.ingredients).slice(0, 60).map(normalizeIngredient).filter(Boolean);
  const steps = cleanTimestamps(
    list(raw.steps)
      .slice(0, 40)
      .map((s) => normalizeStep(s, platform))
      .filter(Boolean),
  );
  // A usable recipe needs something to do. Ingredients alone are not enough.
  if (steps.length === 0) return null;
  const servings = num(raw.servings, { min: 1, max: 100, int: true });
  return {
    title: str(raw.title, MAX.title) || 'Untitled recipe',
    summary: strOrNull(raw.summary, MAX.summary),
    servings,
    servings_stated: servings != null && raw.servings_stated !== false,
    time_minutes: num(raw.time_minutes, { min: 1, max: 1440, int: true }),
    equipment: list(raw.equipment).slice(0, 15).map((x) => str(x, MAX.equipment)).filter(Boolean),
    ingredients,
    steps,
    tips: list(raw.tips).slice(0, 3).map((x) => str(x, MAX.tip)).filter(Boolean),
    gaps: list(raw.gaps).slice(0, 10).map((x) => str(x, MAX.gap)).filter(Boolean),
  };
}

/** Clean a whole model reply into the shape the app understands. */
export function normalizeResult(raw, { platform = 'youtube' } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('reply is not an object');
  let recipes = list(raw.recipes)
    .slice(0, 3)
    .map((r) => normalizeRecipe(r, platform))
    .filter(Boolean);
  // Some replies put a single recipe at the top level instead of inside "recipes".
  if (recipes.length === 0 && Array.isArray(raw.steps)) {
    const single = normalizeRecipe(raw, platform);
    if (single) recipes = [single];
  }
  // The model said "this is a recipe" but nothing usable came back: treat it as a bad reply
  // (so another model can be tried) rather than telling the visitor it is not a recipe.
  const isRecipe = raw.is_recipe !== false;
  if (isRecipe && recipes.length === 0) throw new Error('no usable recipe in the reply');
  return {
    is_recipe: isRecipe,
    not_recipe_reason: isRecipe ? null : str(raw.not_recipe_reason, MAX.reason) || 'We could not find a recipe here.',
    video_notes: list(raw.video_notes).slice(0, 4).map((x) => str(x, MAX.videoNote)).filter(Boolean),
    recipes: isRecipe ? recipes : [],
  };
}

/** Small counts used in logs and the test table. */
export function summarizeResult(result) {
  const first = result.recipes[0];
  if (!first) return { recipes: 0, ingredients: 0, ingredients_stated: 0, steps: 0, timers: 0, cues: 0, gaps: 0 };
  return {
    recipes: result.recipes.length,
    ingredients: first.ingredients.length,
    ingredients_stated: first.ingredients.filter((i) => i.stated).length,
    steps: first.steps.length,
    timers: first.steps.filter((s) => s.timer_seconds).length,
    cues: first.steps.filter((s) => s.done_cue).length,
    gaps: first.gaps.length,
  };
}
