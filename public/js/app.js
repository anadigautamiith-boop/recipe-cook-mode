// The home page: ask for a link, wait honestly, show the recipe.

import { $, h } from './dom.js';
import { ApiError, requestRecipe } from './api.js';
import { mmss, recipeId, timeAgo } from './format.js';
import { mountAlarms } from './parts.js';
import { mountRecipe } from './recipe-view.js';
import { LANGUAGE_MENU } from './shared/languages.js';
import { parseVideoUrl, platformLabel } from './shared/urls.js';
import { prefs, recents } from './store.js';
import { timers } from './timers.js';

const els = {
  home: $('#home'),
  recipe: $('#recipe'),
  form: $('#ask'),
  url: $('#url'),
  make: $('#make'),
  pasteBox: $('#paste-box'),
  pasteToggle: $('#paste-toggle'),
  text: $('#text'),
  textLabel: $('#text-label'),
  lang: $('#lang'),
  status: $('#status'),
  recents: $('#recents'),
  newBtn: $('#new-recipe'),
  toast: $('#toast'),
  alarm: $('#alarm'),
  brand: $('#brand'),
  homeTitle: $('#home-title'),
};

const HOME_TITLE = document.title;
let pageTitle = HOME_TITLE;
let view = null;
let working = null; // { controller, timer } while a recipe is being made

// ---- small helpers ----------------------------------------------------------------

let toastTimer = null;
function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 2800);
}

function setTitle(title) {
  pageTitle = title;
  refreshTitle();
}

function refreshTitle() {
  const next = timers.next();
  document.title = next ? `${mmss(timers.remaining(next.id))} ${next.label.split(':')[0]} · Cookalong` : pageTitle;
}
timers.subscribe(refreshTitle);
mountAlarms(els.alarm, []);

// ---- the form ------------------------------------------------------------------------

for (const [value, label] of LANGUAGE_MENU) els.lang.append(h('option', { value }, label));
els.lang.value = prefs.get().lang;
els.lang.addEventListener('change', () => prefs.set({ lang: els.lang.value }));

const prefill = new URLSearchParams(location.search).get('url');
if (prefill) els.url.value = prefill;

function setPasteOpen(open, { focus = false } = {}) {
  els.pasteBox.hidden = !open;
  els.pasteToggle.setAttribute('aria-expanded', String(open));
  els.pasteToggle.textContent = open ? 'Hide the text box' : 'Paste the recipe text instead';
  if (open && focus) els.text.focus();
}
els.pasteToggle.addEventListener('click', () => setPasteOpen(els.pasteBox.hidden, { focus: true }));

function clearStatus() {
  els.status.replaceChildren();
}

function showProblem(problem, { focus } = {}) {
  const actions = [];
  if (problem.canPaste) {
    setPasteOpen(true);
    els.textLabel.textContent = 'Paste the caption or the recipe text';
    if (els.pasteBox.hidden === false && !focus) focus = els.text;
  }
  if (problem.retryable) {
    actions.push(h('button', { class: 'btn btn--quiet', type: 'button', onclick: () => els.form.requestSubmit() }, 'Try again'));
  }
  els.status.replaceChildren(
    h(
      'div',
      { class: 'problem', role: 'alert' },
      h('p', { class: 'problem__title' }, problem.message),
      problem.hint ? h('p', { class: 'problem__hint' }, problem.hint) : null,
      actions.length ? h('div', { class: 'problem__actions' }, actions) : null,
    ),
  );
  if (focus) focus.focus();
}

function showNotRecipe(result) {
  setPasteOpen(true);
  els.textLabel.textContent = 'Paste the recipe text';
  els.status.replaceChildren(
    h(
      'div',
      { class: 'problem', role: 'alert' },
      h('p', { class: 'problem__title' }, 'That doesn’t look like a recipe.'),
      h('p', { class: 'problem__hint' }, result.not_recipe_reason || 'We couldn’t find anything being cooked.'),
      h('p', { class: 'problem__hint' }, 'If it is a recipe, paste its text below and we’ll build it from that.'),
    ),
  );
}

function showWorking(route, controller) {
  const words = { youtube: 'Watching the video…', instagram: 'Reading the caption…', text: 'Reading your text…' };
  const message = h('p', { class: 'working__msg', role: 'status' }, words[route]);
  const seconds = h('span', {}, '0 seconds so far.');
  const longer = h('span', {}, '');
  const cancel = h('button', { class: 'link-btn', type: 'button', onclick: () => controller.abort() }, 'Cancel');
  els.status.replaceChildren(
    h('div', { class: 'working' }, h('div', { class: 'working__bar' }), message, h('p', { class: 'working__sub' }, seconds, longer, cancel)),
  );
  const started = Date.now();
  const timer = setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    seconds.textContent = `${s} second${s === 1 ? '' : 's'} so far.`;
    if (s === 6 && route !== 'text') message.textContent = 'Writing your recipe…';
    longer.textContent = s >= 15 ? 'Longer videos can take up to a minute.' : '';
  }, 1000);
  working = { controller, timer };
  els.make.disabled = true;
}

function stopWorking() {
  if (working) clearInterval(working.timer);
  working = null;
  els.make.disabled = false;
}

els.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (working) return;
  clearStatus();

  const rawUrl = els.url.value.trim();
  const text = els.pasteBox.hidden ? '' : els.text.value.trim();
  let parsed = null;
  if (rawUrl) {
    const attempt = parseVideoUrl(rawUrl);
    if (attempt.ok) parsed = attempt;
    else if (!text) return showProblem({ message: attempt.message, hint: attempt.hint }, { focus: els.url });
  }
  if (!parsed && !text) {
    return showProblem({ message: 'Paste a YouTube or Instagram link to begin.' }, { focus: els.url });
  }
  if (text && text.length < 40) {
    return showProblem(
      { message: 'That’s too short to be a recipe.', hint: 'Paste the ingredients and steps, or the whole caption.' },
      { focus: els.text },
    );
  }

  const lang = els.lang.value;
  prefs.set({ lang });
  const controller = new AbortController();
  showWorking(text ? 'text' : parsed.platform, controller);
  try {
    const payload = await requestRecipe({
      url: parsed ? parsed.canonicalUrl : undefined,
      text: text || undefined,
      lang,
      signal: controller.signal,
    });
    stopWorking();
    clearStatus();
    if (!payload.result.is_recipe) {
      showNotRecipe(payload.result);
      return;
    }
    const id = recipeId(payload, text);
    recents.save({ id, savedAt: new Date().toISOString(), payload });
    const target = `#/recipe/${id}`;
    if (location.hash === target) route();
    else location.hash = target;
  } catch (err) {
    stopWorking();
    if (err && err.name === 'AbortError') {
      clearStatus();
      return;
    }
    showProblem(err instanceof ApiError ? err : { message: 'Something went wrong on our side.', hint: 'Please try again.', retryable: true });
  }
});

// ---- recent recipes --------------------------------------------------------------------

function renderRecents() {
  const items = recents.list();
  els.recents.hidden = items.length === 0;
  if (items.length === 0) {
    els.recents.replaceChildren();
    return;
  }
  els.recents.replaceChildren(
    h(
      'div',
      { class: 'recents__head' },
      h('h2', { class: 'recents__title', id: 'recents-title' }, 'Your recent recipes'),
      h(
        'button',
        {
          class: 'link-btn',
          type: 'button',
          onclick: () => {
            recents.clear();
            renderRecents();
          },
        },
        'Clear list',
      ),
    ),
    h(
      'ul',
      {},
      items.map((item) =>
        h(
          'li',
          {},
          h(
            'button',
            {
              class: 'recents__item',
              type: 'button',
              onclick: () => {
                location.hash = `#/recipe/${item.id}`;
              },
            },
            h('span', { class: 'recents__name' }, item.payload.result.recipes[0].title),
            h(
              'span',
              { class: 'recents__meta' },
              h('span', {}, platformLabel(item.payload.meta.platform)),
              h('span', {}, timeAgo(item.savedAt)),
            ),
          ),
        ),
      ),
    ),
  );
}

// ---- which page are we on --------------------------------------------------------------

function showHome({ focus = false } = {}) {
  if (view) {
    view.destroy();
    view = null;
  }
  els.recipe.hidden = true;
  els.home.hidden = false;
  els.newBtn.hidden = true;
  setTitle(HOME_TITLE);
  renderRecents();
  if (focus) els.url.focus();
}

function showRecipe(entry) {
  if (view) view.destroy();
  els.home.hidden = true;
  els.recipe.hidden = false;
  els.newBtn.hidden = false;
  view = mountRecipe(els.recipe, entry.payload, { id: entry.id, toast });
  setTitle(`${view.title()} · Cookalong`);
  window.scrollTo(0, 0);
  view.focusTitle();
}

function route() {
  const match = location.hash.match(/^#\/recipe\/([\w-]+)$/);
  const entry = match ? recents.get(match[1]) : null;
  if (entry) showRecipe(entry);
  else showHome();
}

function goHome({ focus = false } = {}) {
  if (location.hash) history.pushState(null, '', location.pathname + location.search);
  clearStatus();
  showHome({ focus });
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
els.brand.addEventListener('click', (event) => {
  event.preventDefault();
  goHome();
});
els.newBtn.addEventListener('click', () => {
  els.url.value = '';
  els.text.value = '';
  setPasteOpen(false);
  goHome({ focus: true });
});

route();
