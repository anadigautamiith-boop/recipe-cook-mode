// Words and numbers for the page. Pure functions: no DOM, so they can be tested in Node.

import { hashString } from './shared/hash.js';
import { convertTemperature, describeAmount, formatDuration } from './shared/units.js';

// ---- heat and temperature -----------------------------------------------------------

export const HEAT_LEVELS = ['low', 'medium-low', 'medium', 'medium-high', 'high'];
const HEAT_NAMES = {
  low: 'Low heat',
  'medium-low': 'Medium-low heat',
  medium: 'Medium heat',
  'medium-high': 'Medium-high heat',
  high: 'High heat',
};
/** 0 when unknown, otherwise 1 to 5. */
export const heatLevel = (heat) => HEAT_LEVELS.indexOf(heat) + 1;
export const heatLabel = (heat) => HEAT_NAMES[heat] || '';

export function temperatureText(temp, units) {
  const c = convertTemperature(temp, units);
  if (!c) return '';
  return `${c.converted ? '≈' : ''}${c.value}°${c.unit}`;
}

// ---- amounts ------------------------------------------------------------------------

export function amountParts(ing, { factor = 1, units = 'orig' } = {}) {
  return describeAmount(ing, { factor, system: units });
}

/** Plain text for one ingredient, for copying into a shopping list. */
export function ingredientLine(ing, opts) {
  const a = amountParts(ing, opts);
  const amount = a.missing ? '' : `${a.approx ? '≈' : ''}${a.text} `;
  const note = ing.note ? ` (${ing.note})` : '';
  const gap = a.missing ? ' (amount not stated)' : '';
  return `${amount}${ing.name}${note}${gap}`;
}

// ---- where the recipe came from -----------------------------------------------------

/** 'video' | 'caption' | 'text' */
export function sourceKind(payload) {
  const type = payload && payload.source && payload.source.type;
  if (type === 'youtube') return 'video';
  if (type === 'instagram-caption') return 'caption';
  return 'text';
}

export const SOURCE_WORDS = {
  video: { from: 'From the video', missing: 'Not in the video', noun: 'video' },
  caption: { from: 'From the caption', missing: 'Not in the caption', noun: 'caption' },
  text: { from: 'From your text', missing: 'Not in your text', noun: 'text' },
};

export function provenanceLine(payload) {
  const kind = sourceKind(payload);
  if (kind === 'video') return 'Read from the video itself: the picture, the words on screen and what is said.';
  if (kind === 'caption') {
    return "Built from the Instagram caption only. We couldn't watch the video, so check the steps against it.";
  }
  return 'Built from the text you pasted.';
}

/** The id a recipe is saved under, and the address of its page (#/recipe/<id>). */
export function recipeId(payload, text = '') {
  const meta = payload.meta || {};
  return hashString(`${meta.canonical_url || ''}|${meta.lang}|${text ? hashString(text) : ''}`);
}

// ---- time and money -----------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');

/** 95 -> "1:35", 3725 -> "1:02:05". */
export function mmss(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

export { formatDuration };

export function costText(cost) {
  if (cost == null) return 'not reported';
  if (cost === 0) return '$0';
  if (cost < 0.001) return `$${cost.toFixed(4)}`;
  if (cost < 0.1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

export function secondsText(ms) {
  return `${(ms / 1000).toFixed(1)} s`;
}

export function timeAgo(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const hrs = Math.round(m / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const d = Math.round(hrs / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

// ---- finding words and ingredients inside a step -------------------------------------

const isLetterOrNumber = (ch) => /[\p{L}\p{N}]/u.test(ch);
const SUFFIX = /^(?:s|es|ed|d|ing)(?![\p{L}\p{N}])/u;

/**
 * Split step text around the first whole-word use of each cooking term, so the page can
 * underline it. Returns [{ text, term? }] where `term` is an index into `terms`.
 */
export function segmentText(text, terms) {
  const lower = text.toLowerCase();
  const hits = [];
  (terms || []).forEach((t, index) => {
    const needle = String(t && t.term ? t.term : '').toLowerCase();
    if (!needle) return;
    let from = 0;
    for (;;) {
      const i = lower.indexOf(needle, from);
      if (i < 0) break;
      const end = i + needle.length;
      const before = i > 0 ? text[i - 1] : '';
      if (before && isLetterOrNumber(before)) {
        from = i + 1;
        continue;
      }
      let stop = end;
      if (end < text.length && isLetterOrNumber(text[end])) {
        const m = text.slice(end).match(SUFFIX);
        if (!m) {
          from = i + 1;
          continue;
        }
        stop = end + m[0].length;
      }
      hits.push({ i, end: stop, index });
      break;
    }
  });
  hits.sort((a, b) => a.i - b.i);
  const parts = [];
  let pos = 0;
  for (const hit of hits) {
    if (hit.i < pos) continue;
    if (hit.i > pos) parts.push({ text: text.slice(pos, hit.i) });
    parts.push({ text: text.slice(hit.i, hit.end), term: hit.index });
    pos = hit.end;
  }
  if (pos < text.length) parts.push({ text: text.slice(pos) });
  return parts.length ? parts : [{ text }];
}

const FILLER = new Set(['the', 'and', 'for', 'with', 'fresh', 'ripe', 'large', 'small', 'medium', 'whole', 'ground', 'dried', 'cooking', 'extra']);

function stem(word) {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith('oes')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The meaningful lower-case words in a phrase, with plurals folded away. */
function contentWords(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !FILLER.has(w))
    .map(stem);
}

const hasWord = (text, word) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(word)}`, 'iu').test(text);

/**
 * Which ingredients does this step talk about? Returns indexes into `ingredients`.
 * When two ingredients share a name ("salt" for the eggs, "salt" for the sauce) the group
 * and note words decide which one the step means; with no clue in the step, both stay.
 */
export function matchIngredients(stepText, ingredients) {
  const text = String(stepText || '');
  const byName = new Map();
  (ingredients || []).forEach((ing, index) => {
    const words = contentWords(ing && ing.name);
    if (words.length === 0) return;
    const head = words[words.length - 1];
    if (!hasWord(text, head)) return;
    if (!byName.has(head)) byName.set(head, []);
    byName.get(head).push(index);
  });
  const found = [];
  for (const indexes of byName.values()) {
    let keep = indexes;
    if (indexes.length > 1) {
      const clued = indexes.filter((i) => {
        const ing = ingredients[i];
        return contentWords(`${ing.group || ''} ${ing.note || ''}`).some((w) => hasWord(text, w));
      });
      if (clued.length) keep = clued;
    }
    found.push(...keep);
  }
  return found.sort((a, b) => a - b);
}

// ---- gaps ----------------------------------------------------------------------------

/** The things the source did not say: the model's own list, plus any blank amounts it did not mention. */
export function collectGaps(recipe) {
  const listed = (recipe.gaps || []).slice();
  const said = listed.join(' ').toLowerCase();
  const extra = [];
  for (const ing of recipe.ingredients || []) {
    if (ing.stated) continue;
    const words = contentWords(ing.name);
    const head = words.length ? words[words.length - 1] : '';
    if (head && !said.includes(head)) extra.push(`The amount of ${ing.name} is not stated.`);
  }
  if (recipe.servings == null || recipe.servings_stated === false) {
    if (!/serv|portion|people/.test(said)) extra.push('How many people it feeds is not stated.');
  }
  return [...listed, ...extra];
}
