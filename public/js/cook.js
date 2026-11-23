// Cook mode: one step at a time, in big type, with timers and the screen kept awake.
// Pages are: get ready (tick off ingredients), each step, then a finish page.

import { fill, h, icon } from './dom.js';
import { collectGaps, matchIngredients, mmss, sourceKind } from './format.js';
import { cueNote, gapsPanel, ingredientList, mountAlarms, needsList, stepChips, termsUi } from './parts.js';
import { timers } from './timers.js';

export function openCook({ payload, id, index, state, saveTicks, onClose }) {
  const recipe = payload.result.recipes[index];
  const meta = payload.meta;
  const kind = sourceKind(payload);
  const total = recipe.steps.length;
  const disposers = []; // live as long as cook mode is open
  const pageDisposers = []; // live as long as one page is on screen
  let at = 0; // 0 = get ready, 1..total = steps, total + 1 = finished
  let wakeLock = null;
  let cleaned = false;

  // ---- the frame ----

  const titleEl = h('div', { class: 'cook__title', id: 'cook-title' }, recipe.title);
  const countEl = h('div', { class: 'cook__count', 'aria-live': 'polite' });
  const timersEl = h('div', { class: 'cook__timers' });
  const closeBtn = h(
    'button',
    { class: 'icon-btn', type: 'button', 'aria-label': 'Leave cook mode', onclick: () => dialog.close() },
    icon('close'),
  );
  const barFill = h('span', {});
  const bar = h('div', { class: 'cook__bar', role: 'progressbar', 'aria-label': 'Progress', 'aria-valuemin': '0', 'aria-valuemax': String(total) }, barFill);
  const stage = h('div', { class: 'cook__stage', tabindex: '-1' });
  const backBtn = h('button', { class: 'btn btn--quiet', type: 'button', onclick: () => go(-1) }, icon('left'), 'Back');
  const nextBtn = h('button', { class: 'btn btn--primary', type: 'button', onclick: () => go(1) });
  const ingBtn = h('button', { class: 'link-btn', type: 'button', 'aria-expanded': 'false', onclick: () => toggleSheet(true) }, icon('list'), 'Ingredients');
  const awakeEl = h('span', {});
  const sheetEl = h('div', { class: 'cook__sheet', hidden: true, role: 'region', 'aria-label': 'Ingredients' });
  const alarmEl = h('div', { class: 'alarm alarm--in-dialog', role: 'alert', hidden: true });

  const dialog = h(
    'dialog',
    { class: 'cook', 'aria-labelledby': 'cook-title' },
    h('div', { class: 'cook__top' }, closeBtn, h('div', { class: 'cook__heading' }, titleEl, countEl), timersEl),
    bar,
    stage,
    h('div', { class: 'cook__foot' }, h('div', { class: 'cook__extra' }, ingBtn, awakeEl), h('div', { class: 'cook__nav' }, backBtn, nextBtn)),
    sheetEl,
    alarmEl,
  );

  // ---- pages ----

  function buildPage() {
    if (at === 0) {
      return h(
        'div',
        { class: 'cook__page' },
        h('h2', { class: 'cook__text' }, 'Get everything ready'),
        h('p', { class: 'pen' }, 'Put each ingredient on the counter and tick it off. Cooking goes smoothly when nothing is missing.'),
        recipe.ingredients.length ? ingredientList(recipe, state, saveTicks) : null,
        recipe.equipment.length
          ? [h('h3', { class: 'cook__sub' }, 'Equipment'), h('ul', { class: 'equip' }, recipe.equipment.map((e) => h('li', {}, e)))]
          : null,
        gapsPanel(collectGaps(recipe), kind, 'cook-'),
      );
    }
    if (at === total + 1) {
      return h(
        'div',
        { class: 'cook__page' },
        h('h2', { class: 'cook__done-title' }, 'Done. Enjoy your meal.'),
        h('p', { class: 'pen' }, 'This recipe stays in your recent list on this device, so you can cook it again.'),
      );
    }
    const step = recipe.steps[at - 1];
    const ui = termsUi(step);
    const chips = stepChips(step, {
      timerId: `${id}:${index}:${at - 1}`,
      timerLabel: `Step ${at}: ${step.text.length > 44 ? `${step.text.slice(0, 43)}…` : step.text}`,
      units: state.units,
      meta,
      disposers: pageDisposers,
    });
    return h(
      'div',
      { class: 'cook__page' },
      ui.text,
      ui.chips.length ? h('div', { class: 'step__chips' }, ui.chips) : null,
      ui.notes,
      chips,
      cueNote(step),
      needsList(recipe, matchIngredients(step.text, recipe.ingredients), state),
    );
  }

  function renderPage() {
    pageDisposers.splice(0).forEach((fn) => fn());
    stage.replaceChildren(buildPage());
    stage.scrollTop = 0;

    const onPrep = at === 0;
    const onDone = at === total + 1;
    const label = onPrep ? 'Get ready' : onDone ? 'Finished' : `Step ${at} of ${total}`;
    countEl.textContent = label;
    bar.setAttribute('aria-valuenow', String(onPrep ? 0 : Math.min(at, total)));
    bar.setAttribute('aria-valuetext', label);
    barFill.style.setProperty('--p', `${onPrep ? 0 : onDone ? 100 : (at / total) * 100}%`);

    backBtn.disabled = onPrep;
    fill(nextBtn, onPrep ? 'Start step 1' : onDone ? 'Back to recipe' : at === total ? 'Finish' : 'Next step', onDone ? null : icon('right'));
    stage.focus({ preventScroll: true });
  }

  function go(delta) {
    if (!sheetEl.hidden) toggleSheet(false, { refocus: false });
    const next = at + delta;
    if (next < 0) return;
    if (next > total + 1) {
      dialog.close();
      return;
    }
    at = next;
    renderPage();
  }

  // ---- ingredients sheet ----

  function toggleSheet(open, { refocus = true } = {}) {
    sheetEl.hidden = !open;
    ingBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      sheetEl.replaceChildren(
        h(
          'div',
          { class: 'cook__sheet-inner' },
          h(
            'div',
            { class: 'cook__sheet-head' },
            h('h2', { class: 'cook__sub' }, 'Ingredients'),
            h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close ingredients', onclick: () => toggleSheet(false) }, icon('close')),
          ),
          ingredientList(recipe, state, saveTicks),
        ),
      );
      const first = sheetEl.querySelector('button');
      if (first) first.focus();
    } else {
      sheetEl.replaceChildren();
      if (refocus) ingBtn.focus();
    }
  }

  // ---- timers in the corner ----

  function drawTimers() {
    const running = timers.list().filter((t) => t.state === 'running');
    timersEl.replaceChildren(
      ...running.map((t) =>
        h('span', { class: 'chip chip--timer' }, icon('clock'), h('span', { class: 'tabular' }, `${t.label.split(':')[0]} ${mmss(timers.remaining(t.id))}`)),
      ),
    );
  }
  disposers.push(timers.subscribe(drawTimers));
  mountAlarms(alarmEl, disposers);

  // ---- keep the screen awake ----

  async function keepAwake() {
    if (!('wakeLock' in navigator)) {
      awakeEl.textContent = 'This browser can’t keep the screen on. If your phone locks, change its auto-lock setting.';
      return;
    }
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      awakeEl.textContent = 'The screen stays on while you cook.';
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    } catch {
      awakeEl.textContent = 'We couldn’t keep the screen on. If your phone locks, change its auto-lock setting.';
    }
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible' && !wakeLock && dialog.open) keepAwake();
  };
  document.addEventListener('visibilitychange', onVisible);

  // ---- moving between pages ----

  dialog.addEventListener('keydown', (event) => {
    if (event.target.closest && event.target.closest('input, select, textarea')) return;
    if (event.key === 'ArrowRight') go(1);
    if (event.key === 'ArrowLeft') go(-1);
  });

  let startX = 0;
  let startY = 0;
  let tracking = false;
  stage.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') return;
    tracking = true;
    startX = event.clientX;
    startY = event.clientY;
  });
  stage.addEventListener('pointerup', (event) => {
    if (!tracking) return;
    tracking = false;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) go(dx < 0 ? 1 : -1);
  });
  stage.addEventListener('pointercancel', () => {
    tracking = false;
  });

  // ---- open and close ----

  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    document.removeEventListener('visibilitychange', onVisible);
    if (wakeLock) wakeLock.release().catch(() => {});
    disposers.splice(0).forEach((fn) => fn());
    pageDisposers.splice(0).forEach((fn) => fn());
    dialog.remove();
    if (onClose) onClose();
  }
  dialog.addEventListener('close', cleanup);

  document.body.append(dialog);
  dialog.showModal();
  drawTimers();
  renderPage();
  keepAwake();
}
