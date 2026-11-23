// The recipe page: a sheet with what to buy on one side and the method on the other.

import { fill, h, icon } from './dom.js';
import { prefs, ticks } from './store.js';
import {
  SOURCE_WORDS,
  collectGaps,
  costText,
  ingredientLine,
  provenanceLine,
  secondsText,
  sourceKind,
} from './format.js';
import { cueNote, gapsPanel, ingredientList, legend, stepChips, termsUi } from './parts.js';
import { openCook } from './cook.js';

const UNIT_CHOICES = [
  ['orig', 'As in the video'],
  ['metric', 'Metric'],
  ['us', 'US cups'],
];
const MULTIPLIERS = [
  [0.5, '½×'],
  [1, '1×'],
  [2, '2×'],
  [3, '3×'],
];

export function mountRecipe(root, payload, { id, toast }) {
  const meta = payload.meta;
  const recipes = payload.result.recipes;
  const kind = sourceKind(payload);
  const words = SOURCE_WORDS[kind];
  const state = { index: 0, factor: 1, units: prefs.get().units, ticks: new Set() };
  const disposers = [];
  let buyEl = null;

  const recipe = () => recipes[state.index];
  const tickKey = () => `${id}:${state.index}`;
  const loadTicks = () => {
    state.ticks = new Set(ticks.get(tickKey()));
  };
  const saveTicks = () => ticks.set(tickKey(), [...state.ticks]);

  // ---- small helpers ----

  function refocus(key) {
    if (!key) return;
    const target = root.querySelector(`[data-focus-key="${key}"]`);
    if (target) target.focus({ preventScroll: true });
  }

  function keepFocus(fn) {
    const key = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.focusKey : null;
    fn();
    refocus(key);
  }

  function setUnits(value) {
    state.units = value;
    prefs.set({ units: value });
    keepFocus(renderBuy);
  }

  function setFactor(value) {
    state.factor = value;
    keepFocus(renderBuy);
  }

  function switchTo(i) {
    state.index = i;
    state.factor = 1;
    loadTicks();
    render();
  }

  async function copyList() {
    const r = recipe();
    const lines = [`${r.title}: shopping list`, ''];
    for (const ing of r.ingredients) lines.push(`- ${ingredientLine(ing, { factor: state.factor, units: state.units })}`);
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('Shopping list copied.');
    } catch {
      const area = h('textarea', { class: 'sr-only', 'aria-hidden': 'true' });
      area.value = text;
      document.body.append(area);
      area.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      area.remove();
      toast(ok ? 'Shopping list copied.' : "Couldn't copy. Select the list and copy it yourself.");
    }
  }

  function startCooking() {
    openCook({
      payload,
      id,
      index: state.index,
      state,
      saveTicks,
      onClose: () => keepFocus(renderBuy),
    });
  }

  // ---- the "what you need" side ----

  function servingsControl(r) {
    const label = h('span', { class: 'control__label', id: 'servings-label' }, 'Servings');
    if (r.servings != null && r.servings_stated) {
      const now = Math.max(1, Math.round(r.servings * state.factor));
      const set = (n) => setFactor(Math.min(24, Math.max(1, n)) / r.servings);
      return h(
        'div',
        { class: 'control' },
        label,
        h(
          'div',
          { class: 'stepper', role: 'group', 'aria-labelledby': 'servings-label' },
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fewer servings', dataset: { focusKey: 'servings-minus' }, disabled: now <= 1, onclick: () => set(now - 1) }, icon('minus')),
          h('span', { class: 'stepper__value', 'aria-live': 'polite' }, String(now)),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'More servings', dataset: { focusKey: 'servings-plus' }, disabled: now >= 24, onclick: () => set(now + 1) }, icon('plus')),
        ),
        now !== r.servings ? h('span', { class: 'control__hint' }, `The video makes ${r.servings}`) : null,
      );
    }
    const choices = h(
      'div',
      { class: 'seg', role: 'radiogroup', 'aria-labelledby': 'servings-label' },
      MULTIPLIERS.map(([value, text]) =>
        h('button', { type: 'button', role: 'radio', 'aria-checked': String(state.factor === value), dataset: { focusKey: `mult-${value}` }, onclick: () => setFactor(value) }, text),
      ),
    );
    return h(
      'div',
      { class: 'control' },
      label,
      choices,
      r.servings != null
        ? h('span', { class: 'pen' }, `Our guess: it feeds about ${r.servings}. The ${words.noun} doesn’t say.`)
        : h('span', { class: 'hl' }, `Servings not in the ${words.noun}`),
    );
  }

  function unitsControl() {
    return h(
      'div',
      { class: 'control' },
      h('span', { class: 'control__label', id: 'units-label' }, 'Units'),
      h(
        'div',
        { class: 'seg', role: 'radiogroup', 'aria-labelledby': 'units-label' },
        UNIT_CHOICES.map(([value, text]) =>
          h('button', { type: 'button', role: 'radio', 'aria-checked': String(state.units === value), dataset: { focusKey: `units-${value}` }, onclick: () => setUnits(value) }, text),
        ),
      ),
    );
  }

  function renderBuy() {
    const r = recipe();
    fill(
      buyEl,
      h('h2', { class: 'section-title' }, 'What you need'),
      h('div', { class: 'controls' }, servingsControl(r), unitsControl()),
      r.ingredients.length
        ? ingredientList(r, state, saveTicks)
        : h('p', { class: 'hl' }, `No ingredients in the ${words.noun}`),
      r.equipment.length
        ? [h('h3', { class: 'subsection-title' }, 'Equipment'), h('ul', { class: 'equip' }, r.equipment.map((e) => h('li', {}, e)))]
        : null,
    );
  }

  // ---- the method side ----

  function buildStep(step, i) {
    const ui = termsUi(step);
    const chips = stepChips(step, {
      timerId: `${id}:${state.index}:${i}`,
      timerLabel: `Step ${i + 1}: ${step.text.length > 44 ? `${step.text.slice(0, 43)}…` : step.text}`,
      units: state.units,
      meta,
      disposers,
    });
    return h(
      'li',
      { class: 'step' },
      h('span', { class: 'step__n', 'aria-hidden': 'true' }, String(i + 1)),
      h(
        'div',
        { class: 'step__body' },
        ui.text,
        ui.chips.length ? h('div', { class: 'step__chips' }, ui.chips) : null,
        ui.notes,
        chips,
        cueNote(step),
      ),
    );
  }

  function buildMethod() {
    const r = recipe();
    const hasTerms = r.steps.some((s) => s.terms.length > 0);
    return h(
      'section',
      { class: 'method' },
      h('h2', { class: 'section-title' }, 'Method'),
      gapsPanel(collectGaps(r), kind),
      hasTerms ? h('p', { class: 'pen method__hint' }, 'Tap an underlined word to see what it means.') : null,
      h('ol', { class: 'steps' }, r.steps.map(buildStep)),
    );
  }

  // ---- the top of the sheet ----

  function buildHead() {
    const r = recipe();
    const youtube = meta.platform === 'youtube' && meta.video_id;
    let thumb = null;
    let img = null;
    if (youtube) {
      img = h('img', {
        src: `https://i.ytimg.com/vi/${meta.video_id}/mqdefault.jpg`,
        alt: '',
        width: '320',
        height: '180',
        loading: 'lazy',
        referrerpolicy: 'no-referrer',
      });
      thumb = h(
        'a',
        { class: 'sheet__thumb', href: `https://www.youtube.com/watch?v=${meta.video_id}`, target: '_blank', rel: 'noopener noreferrer' },
        img,
        h('span', {}, 'Watch the original video'),
      );
    }
    const notes = payload.result.video_notes || [];
    const head = h(
      'header',
      { class: `sheet__head${youtube ? ' sheet__head--thumb' : ''}` },
      h(
        'div',
        {},
        h('h1', { class: 'sheet__title', id: 'recipe-title', tabindex: '-1' }, r.title),
        r.summary ? h('p', { class: 'sheet__summary' }, r.summary) : null,
        r.time_minutes
          ? h('p', { class: 'sheet__notes' }, `Takes about ${r.time_minutes} minutes.`)
          : h('p', { class: 'sheet__notes' }, h('span', { class: 'hl' }, `Time not in the ${words.noun}`)),
        notes.map((n) => h('p', { class: 'sheet__notes' }, n)),
        h('p', { class: 'sheet__source' }, provenanceLine(payload)),
      ),
      thumb,
    );
    // If the thumbnail cannot load (blocked or offline), give the text the full width.
    if (img) {
      img.addEventListener('error', () => {
        thumb.hidden = true;
        head.classList.remove('sheet__head--thumb');
      });
    }
    return head;
  }

  function buildTabs() {
    if (recipes.length < 2) return null;
    return h(
      'div',
      { class: 'tabs' },
      h(
        'div',
        { class: 'seg', role: 'tablist', 'aria-label': 'Dishes in this video' },
        recipes.map((rec, i) =>
          h('button', { type: 'button', role: 'tab', 'aria-selected': String(i === state.index), onclick: () => switchTo(i) }, rec.title),
        ),
      ),
    );
  }

  function buildReceipt() {
    const cost = meta.cached ? 'Nothing: this was a saved copy' : costText(meta.cost_usd);
    const rows = [
      ['Read from', { video: 'The video itself', caption: 'The Instagram caption only', text: 'Text you pasted' }[kind]],
      ['AI model', meta.model],
      ['Time taken', meta.cached ? 'Instant (saved copy)' : secondsText(meta.ms)],
      ['Cost to make', cost],
    ];
    if (meta.stats) {
      rows.push(['Amounts left blank', `${meta.stats.ingredients - meta.stats.ingredients_stated} of ${meta.stats.ingredients}, because the ${words.noun} didn’t give them`]);
    }
    if (meta.fallbacks && meta.fallbacks.length) rows.push(['Backup used', `${meta.fallbacks.length} earlier attempt${meta.fallbacks.length === 1 ? '' : 's'} failed first`]);
    return h(
      'details',
      { class: 'receipt' },
      h('summary', {}, 'How this recipe was made'),
      h('dl', {}, rows.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    );
  }

  // ---- put it together ----

  function render() {
    disposers.splice(0).forEach((fn) => fn());
    buyEl = h('section', { class: 'buy', 'aria-label': 'What you need' });
    const startLabel = [icon('play'), 'Start cooking'];
    root.replaceChildren(
      h(
        'article',
        { class: 'sheet', 'aria-labelledby': 'recipe-title' },
        buildHead(),
        buildTabs(),
        h('div', { class: 'sheet__legend' }, legend(kind)),
        h(
          'div',
          { class: 'sheet__actions' },
          h('button', { class: 'btn btn--primary btn--start', type: 'button', onclick: startCooking }, startLabel),
          h('button', { class: 'btn btn--quiet', type: 'button', onclick: copyList }, icon('copy'), 'Copy shopping list'),
        ),
        h('div', { class: 'sheet__body' }, buyEl, buildMethod()),
        buildReceipt(),
      ),
      h('div', { class: 'startbar' }, h('button', { class: 'btn btn--primary btn--big', type: 'button', onclick: startCooking }, [icon('play'), 'Start cooking'])),
    );
    renderBuy();
  }

  loadTicks();
  render();

  return {
    focusTitle() {
      const title = root.querySelector('#recipe-title');
      if (title) title.focus({ preventScroll: true });
    },
    title: () => recipe().title,
    destroy() {
      disposers.splice(0).forEach((fn) => fn());
      root.replaceChildren();
    },
  };
}
