// Small pieces of the page that the recipe view and cook mode share.

import { h, icon } from './dom.js';
import {
  SOURCE_WORDS,
  amountParts,
  formatDuration,
  heatLabel,
  heatLevel,
  mmss,
  segmentText,
  temperatureText,
} from './format.js';
import { youtubeLinkAt } from './shared/urls.js';
import { timers } from './timers.js';

// ---- the three marks ------------------------------------------------------------------

export function legend(kind) {
  const words = SOURCE_WORDS[kind];
  return h(
    'ul',
    { class: 'legend', 'aria-label': 'How to read this recipe' },
    h('li', { class: 'legend__plain' }, words.from),
    h('li', { class: 'legend__pen' }, 'Added by us'),
    h('li', {}, h('span', { class: 'hl' }, words.missing)),
  );
}

/** "Done when" line. In handwriting if we wrote it, in plain ink if the video said it. */
export function cueNote(step) {
  if (!step.done_cue) return null;
  const ours = step.done_cue_added;
  return h(
    'p',
    { class: ours ? 'cue pen' : 'cue cue--video' },
    h('span', { class: 'cue__label' }, ours ? 'Looks done when:' : 'Done when:'),
    ' ',
    step.done_cue,
  );
}

/** The yellow box that lists what the source did not say. */
export function gapsPanel(gaps, kind, idPrefix = '') {
  if (!gaps.length) return null;
  return h(
    'section',
    { class: 'gaps', 'aria-labelledby': `${idPrefix}gaps-title` },
    h('h3', { class: 'gaps__title', id: `${idPrefix}gaps-title` }, `What the ${SOURCE_WORDS[kind].noun} didn’t say`),
    h('ul', {}, gaps.map((g) => h('li', {}, g))),
    h('p', { class: 'pen' }, 'If a seasoning amount is missing (salt, oil, spices), start with less and taste as you go.'),
  );
}

// ---- amounts and ingredients ------------------------------------------------------------

export function amountNode(ing, opts) {
  const a = amountParts(ing, opts);
  if (a.missing) return h('span', { class: 'hl' }, 'not said');
  return `${a.approx ? '≈ ' : ''}${a.text}`;
}

/**
 * The ingredient list with tick boxes. `state.ticks` is a Set of ingredient indexes and
 * `onTick` is called after every change so the caller can save it.
 */
export function ingredientList(recipe, { factor, units, ticks }, onTick) {
  const groups = [];
  recipe.ingredients.forEach((ing, index) => {
    const name = ing.group || '';
    let group = groups[groups.length - 1];
    if (!group || group.name !== name) {
      group = { name, items: [] };
      groups.push(group);
    }
    group.items.push({ ing, index });
  });

  return h(
    'div',
    {},
    groups.map((group) => [
      group.name ? h('h3', { class: 'ing-group' }, group.name) : null,
      h(
        'ul',
        { class: 'ings' },
        group.items.map(({ ing, index }) => {
          const box = h('input', { class: 'ing__check sr-only', type: 'checkbox' });
          box.checked = ticks.has(index);
          box.addEventListener('change', () => {
            if (box.checked) ticks.add(index);
            else ticks.delete(index);
            onTick();
          });
          return h(
            'li',
            {},
            h(
              'label',
              { class: 'ing' },
              box,
              h('span', { class: 'ing__box' }, icon('check')),
              h('span', { class: 'ing__amt' }, amountNode(ing, { factor, units })),
              h('span', { class: 'ing__name' }, ing.name, ing.note ? [' ', h('span', { class: 'ing__note' }, ing.note)] : null),
            ),
          );
        }),
      ),
    ]),
  );
}

/** A short read-only list: used for "for this step". */
export function needsList(recipe, indexes, { factor, units }) {
  if (!indexes.length) return null;
  return h(
    'div',
    { class: 'needs' },
    h('h3', { class: 'cook__sub' }, 'For this step'),
    h(
      'ul',
      { class: 'ings' },
      indexes.map((i) => {
        const ing = recipe.ingredients[i];
        return h(
          'li',
          {},
          h(
            'span',
            { class: 'ing' },
            h('span', {}),
            h('span', { class: 'ing__amt' }, amountNode(ing, { factor, units })),
            h('span', { class: 'ing__name' }, ing.name, ing.note ? [' ', h('span', { class: 'ing__note' }, ing.note)] : null),
          ),
        );
      }),
    ),
  );
}

// ---- cooking words ------------------------------------------------------------------------

/**
 * The step text with cooking words underlined in pen. Tapping one shows what it means.
 * Words that cannot be found in the text become small buttons instead.
 */
export function termsUi(step) {
  const terms = step.terms || [];
  const notes = terms.map((t) => h('p', { class: 'note pen', hidden: true }, h('b', {}, `${t.term}: `), t.meaning));
  const toggle = (index, button) => {
    const opening = notes[index].hidden;
    notes[index].hidden = !opening;
    button.setAttribute('aria-expanded', String(opening));
  };

  const text = h('p', { class: 'step__text' });
  const used = new Set();
  for (const part of segmentText(step.text, terms)) {
    if (part.term == null) {
      text.append(part.text);
      continue;
    }
    const button = h('button', { class: 'term', type: 'button', 'aria-expanded': 'false' }, part.text);
    button.addEventListener('click', () => toggle(part.term, button));
    used.add(part.term);
    text.append(button);
  }
  const chips = terms
    .map((t, i) => [t, i])
    .filter(([, i]) => !used.has(i))
    .map(([t, i]) => {
      const button = h('button', { class: 'chip', type: 'button', 'aria-expanded': 'false' }, t.term);
      button.addEventListener('click', () => toggle(i, button));
      return button;
    });
  return { text, notes, chips };
}

// ---- heat, temperature, timers -------------------------------------------------------------

export function heatChip(heat) {
  const level = heatLevel(heat);
  if (!level) return null;
  const bars = [1, 2, 3, 4, 5].map((n) => h('i', { class: n <= level ? 'on' : '' }));
  return h('span', { class: 'chip chip--heat' }, h('span', { class: 'heat', 'aria-hidden': 'true' }, bars), heatLabel(heat));
}

/** Start / running / time-is-up button for one step's timer. */
export function timerControl({ id, label, seconds }, disposers) {
  const wrap = h('span', { class: 'timer' });
  const main = h('button', { class: 'chip chip--timer', type: 'button' });
  const cancel = h('button', { class: 'chip chip--cancel', type: 'button', 'aria-label': 'Cancel this timer' }, icon('close'));
  wrap.append(main, cancel);

  let shown = null;
  let span = null;
  const draw = () => {
    const t = timers.get(id);
    const state = t ? t.state : 'idle';
    if (state !== shown) {
      shown = state;
      wrap.dataset.state = state;
      span = h('span', { class: 'tabular' });
      main.replaceChildren(icon(state === 'ringing' ? 'bell' : 'clock'), span);
      cancel.hidden = state === 'idle';
      main.setAttribute(
        'aria-label',
        state === 'idle' ? `Start a ${formatDuration(seconds)} timer` : state === 'ringing' ? 'Time is up. Press to stop the alarm.' : 'Timer running',
      );
    }
    if (state === 'idle') span.textContent = `Start ${formatDuration(seconds)} timer`;
    else if (state === 'ringing') span.textContent = 'Time is up';
    else span.textContent = mmss(timers.remaining(id));
  };
  main.addEventListener('click', () => {
    const t = timers.get(id);
    if (!t) timers.start(id, label, seconds);
    else if (t.state === 'ringing') timers.reset(id);
  });
  cancel.addEventListener('click', () => timers.reset(id));
  disposers.push(timers.subscribe(draw));
  draw();
  return wrap;
}

/** Heat, temperature, timer and "watch this part" for one step. */
export function stepChips(step, { timerId, timerLabel, units, meta, disposers }) {
  const chips = [];
  const heat = heatChip(step.heat);
  if (heat) chips.push(heat);
  if (step.temperature) chips.push(h('span', { class: 'chip chip--heat' }, temperatureText(step.temperature, units)));
  if (step.timer_seconds) {
    chips.push(timerControl({ id: timerId, label: timerLabel, seconds: step.timer_seconds }, disposers));
  }
  if (meta.platform === 'youtube' && meta.video_id && step.video_t != null) {
    chips.push(
      h(
        'a',
        { class: 'chip chip--quiet', href: youtubeLinkAt(meta.video_id, step.video_t), target: '_blank', rel: 'noopener noreferrer' },
        icon('external'),
        `Watch this part (${mmss(step.video_t)})`,
      ),
    );
  }
  return chips.length ? h('div', { class: 'step__chips' }, chips) : null;
}

// ---- alarms ----------------------------------------------------------------------------------

/** Shows a "time is up" banner inside `container` whenever any timer is ringing. */
export function mountAlarms(container, disposers) {
  const draw = () => {
    const ringing = timers.list().filter((t) => t.state === 'ringing');
    container.hidden = ringing.length === 0;
    if (ringing.length === 0) {
      container.replaceChildren();
      delete container.dataset.key;
      return;
    }
    const key = ringing.map((t) => t.id).join('|');
    if (container.dataset.key === key) return;
    container.dataset.key = key;
    container.replaceChildren(
      ...ringing.map((t) =>
        h(
          'div',
          { class: 'alarm__row' },
          icon('bell'),
          h('p', {}, `Time is up: ${t.label}`),
          h('button', { class: 'btn', type: 'button', onclick: () => timers.reset(t.id) }, 'Stop'),
        ),
      ),
    );
  };
  disposers.push(timers.subscribe(draw));
  draw();
}
