// The test lab page. It sends each test video through the live app, one at a time,
// and records what happened. Everything is kept in this browser until you download it.

import { requestDiagnose, requestRecipe } from './api.js';
import { $, fill, h } from './dom.js';
import { costText, recipeId, secondsText, timeAgo } from './format.js';
import { LAB_VERSION, RATINGS, checkRun, normalizeRows, outcomeWords, runFromError, runFromPayload, toMarkdown, totals } from './lab-core.js';
import { LANGUAGE_MENU } from './shared/languages.js';
import { parseVideoUrl } from './shared/urls.js';
import { recents } from './store.js';

const KEY_ROWS = 'cookalong.lab.v1';
const KEY_PAYLOADS = 'cookalong.lab.payloads.v1';

// ---- what is saved ----------------------------------------------------------------------

function load(key) {
  try {
    return JSON.parse(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}
function store(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

async function loadRecorded() {
  try {
    const res = await fetch('/test-results.json', { headers: { accept: 'application/json' } });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return null;
    const body = await res.json();
    // An empty file means nothing has been recorded yet.
    return body && Array.isArray(body.rows) && body.rows.some((r) => r && r.run) ? body : null;
  } catch {
    return null;
  }
}

let rows = normalizeRows(null);
let payloads = {};
let busyId = null; // the row being run right now
let batch = null; // { stop: boolean } while "Run all" is going

const els = new Map(); // row id -> the pieces of its card
const page = {
  cases: $('#cases'),
  runAll: $('#run-all'),
  stop: $('#stop'),
  batchStatus: $('#batch-status'),
  summary: $('#summary'),
  md: $('#md'),
  copyStatus: $('#copy-status'),
  recordedNote: $('#recorded-note'),
  setupButtons: $('#setup-buttons'),
  setupOut: $('#setup-out'),
};

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    store(KEY_ROWS, { version: LAB_VERSION, rows: rows.map(({ id, label, url, lang, rating, note, run }) => ({ id, label, url, lang, rating, note, run })) });
    store(KEY_PAYLOADS, payloads);
  }, 250);
}

// ---- words ------------------------------------------------------------------------------

const ROUTE_WORDS = {
  'youtube-video': 'Watched the video',
  'instagram-caption': 'Read the Instagram caption',
  'pasted-text': 'Read pasted text',
};

function urlProblem(value) {
  const text = value.trim();
  if (!text) return '';
  const parsed = parseVideoUrl(text);
  return parsed.ok ? '' : parsed.message;
}
const canRun = (row) => Boolean(row.url) && !urlProblem(row.url);

// ---- one card per test video ------------------------------------------------------------

function buildCase(row, index) {
  // A one-line text box that wraps onto more lines when the name is long, so nothing is cut off.
  const label = h('textarea', { class: 'case__label', rows: '1', maxlength: '120', spellcheck: 'false', 'aria-label': `What video ${index + 1} tests` }, row.label);
  const fit = () => {
    label.style.height = 'auto';
    label.style.height = `${label.scrollHeight}px`;
  };
  label.addEventListener('input', () => {
    row.label = label.value.replace(/\s*\n\s*/g, ' ');
    fit();
    save();
    showTable();
  });
  label.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') event.preventDefault();
  });

  const url = h('input', {
    class: 'field',
    type: 'text',
    inputmode: 'url',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    placeholder: 'Paste a YouTube or Instagram link',
    value: row.url,
  });
  const problem = h('p', { class: 'case__problem', role: 'status' });
  url.addEventListener('input', () => {
    row.url = url.value.trim();
    problem.textContent = urlProblem(url.value);
    save();
    syncControls();
    showTable();
  });
  problem.textContent = urlProblem(row.url);

  const lang = h('select', { class: 'field' }, LANGUAGE_MENU.map(([value, name]) => h('option', { value }, name)));
  lang.value = row.lang;
  lang.addEventListener('change', () => {
    row.lang = lang.value;
    save();
  });

  const runBtn = h('button', { class: 'btn', type: 'button', onclick: () => runOne(row) }, 'Run this one');
  const openBtn = h('button', { class: 'btn btn--quiet', type: 'button', onclick: () => openRecipe(row), hidden: true }, 'Open the recipe');
  const output = h('div', { class: 'case__output', 'aria-live': 'polite' });

  const rating = h('select', { class: 'field' }, RATINGS.map(([value, name]) => h('option', { value }, name)));
  rating.value = row.rating;
  rating.addEventListener('change', () => {
    row.rating = rating.value;
    save();
    showTable();
    showSummary();
  });
  const note = h('input', { class: 'field', type: 'text', maxlength: '600', placeholder: 'What worked, what did not', value: row.note });
  note.addEventListener('input', () => {
    row.note = note.value;
    save();
    showTable();
  });

  const root = h(
    'li',
    { class: 'case', 'aria-label': `Test video ${index + 1}` },
    h('div', { class: 'case__head' }, h('span', { class: 'case__num', 'aria-hidden': 'true' }, String(index + 1)), label, h('p', { class: 'case__hint' }, row.hint)),
    h(
      'div',
      { class: 'case__inputs' },
      h('label', { class: 'case__field' }, h('span', {}, 'Video link'), url, problem),
      h('label', { class: 'case__field' }, h('span', {}, 'Write the recipe in'), lang),
      h('div', { class: 'case__actions' }, runBtn, openBtn),
    ),
    output,
    h(
      'div',
      { class: 'case__rate' },
      h('label', { class: 'case__field' }, h('span', {}, 'Your rating'), rating),
      h('label', { class: 'case__field' }, h('span', {}, 'Notes'), note),
    ),
  );
  els.set(row.id, { root, url, problem, lang, runBtn, openBtn, output, rating, note, label, fit });
  return root;
}

function fact(label, value) {
  return value == null || value === '' ? null : [h('dt', {}, label), h('dd', {}, value)];
}

function showOutput(row) {
  const ui = els.get(row.id);
  const run = row.run;
  ui.openBtn.hidden = !(run && run.outcome === 'recipe' && payloads[row.id]);
  if (!run) {
    fill(ui.output, h('p', { class: 'case__none' }, row.url ? 'Not run yet.' : 'Add a link to run this one.'));
    return;
  }
  const verdict = checkRun(row, run);
  const tone = verdict === true ? 'good' : verdict === false ? 'bad' : 'plain';
  const mark = verdict === true ? '✓' : verdict === false ? '!' : '·';
  const judged = verdict === true ? 'as hoped' : verdict === false ? 'not as hoped' : 'no automatic check';
  const s = run.stats && run.outcome === 'recipe' ? run.stats : null;
  fill(
    ui.output,
    h(
      'p',
      { class: `verdict verdict--${tone}` },
      h('span', { class: 'verdict__mark', 'aria-hidden': 'true' }, mark),
      h('span', { class: 'verdict__text' }, `${outcomeWords(run)}: ${judged}`),
    ),
    run.title ? h('p', { class: 'case__title' }, `“${run.title}”`) : null,
    run.error ? h('p', {}, run.error.message, run.error.hint ? ` ${run.error.hint}` : '') : null,
    run.reason ? h('p', {}, `Reason it gave: ${run.reason}`) : null,
    h(
      'dl',
      { class: 'facts' },
      fact('Time', run.ms != null || run.clientMs != null ? `${secondsText(run.ms != null ? run.ms : run.clientMs)}${run.cached ? ' (from cache)' : ''}` : null),
      fact('Cost', run.outcome === 'recipe' || run.outcome === 'not_recipe' ? costText(run.cost) : null),
      fact('How it read it', ROUTE_WORDS[run.route] || run.route),
      fact('Model', run.model),
      s ? fact('Amounts stated', `${s.ingredients_stated} of ${s.ingredients} ingredients`) : null,
      s ? fact('Steps', `${s.steps} (${s.timers} with timers, ${s.cues} with a “done when” hint)`) : null,
      s ? fact('Gaps flagged', String(s.gaps)) : null,
      s && s.recipes > 1 ? fact('Dishes found', String(s.recipes)) : null,
      run.fallbacks.length ? fact('Other models tried first', run.fallbacks.join(' | ')) : null,
      run.adjustments && run.adjustments.length ? fact('Changed by the app', run.adjustments.join(' | ')) : null,
      fact('Run', timeAgo(run.at)),
    ),
  );
}

function showBusy(row, on) {
  const ui = els.get(row.id);
  ui.root.dataset.busy = on ? 'true' : 'false';
  ui.runBtn.textContent = on ? 'Running…' : 'Run this one';
}

// ---- running ----------------------------------------------------------------------------

const STOPPERS = new Set(['rate_limited', 'daily_cap', 'budget_exhausted', 'not_configured', 'forbidden_origin']);

async function execute(row) {
  const ui = els.get(row.id);
  busyId = row.id;
  syncControls();
  showBusy(row, true);
  const started = performance.now();
  const ticker = h('p', { class: 'case__none' }, 'Starting…');
  fill(ui.output, ticker);
  const clock = setInterval(() => {
    ticker.textContent = `Working… ${Math.round((performance.now() - started) / 1000)} s so far. Long videos can take a minute.`;
  }, 1000);
  let failure = null;
  try {
    const payload = await requestRecipe({ url: row.url, lang: row.lang, refresh: true });
    row.run = runFromPayload(payload, { clientMs: performance.now() - started });
    if (row.run.outcome === 'recipe') payloads[row.id] = payload;
    else delete payloads[row.id];
  } catch (err) {
    failure = err;
    row.run = runFromError(err, { clientMs: performance.now() - started });
    delete payloads[row.id];
  }
  clearInterval(clock);
  busyId = null;
  showBusy(row, false);
  showOutput(row);
  showSummary();
  showTable();
  syncControls();
  save();
  return failure;
}

async function runOne(row) {
  if (busyId || batch || !canRun(row)) return;
  await execute(row);
}

async function runEverything() {
  if (busyId || batch) return;
  const todo = rows.filter(canRun);
  if (todo.length === 0) {
    page.batchStatus.textContent = 'Paste at least one link first.';
    return;
  }
  batch = { stop: false };
  syncControls();
  let done = 0;
  let halted = '';
  for (const row of todo) {
    if (batch.stop) break;
    page.batchStatus.textContent = `Running ${done + 1} of ${todo.length}: ${row.label}`;
    const failure = await execute(row);
    done += 1;
    if (failure && STOPPERS.has(failure.code)) {
      halted = `${failure.message}${failure.hint ? ` ${failure.hint}` : ''}${failure.retryAfter ? ` Try again in about ${Math.ceil(failure.retryAfter / 60)} min.` : ''}`;
      break;
    }
  }
  page.batchStatus.textContent = halted ? `Stopped after ${done}: ${halted}` : batch.stop ? `Stopped after ${done} of ${todo.length}.` : `Finished. ${done} run.`;
  batch = null;
  syncControls();
}

function openRecipe(row) {
  const payload = payloads[row.id];
  if (!payload) return;
  const id = recipeId(payload, '');
  recents.save({ id, savedAt: row.run ? row.run.at : new Date().toISOString(), payload });
  window.location.href = `/#/recipe/${id}`;
}

function syncControls() {
  const idle = !busyId && !batch;
  page.runAll.disabled = !idle;
  page.stop.hidden = !batch;
  for (const row of rows) {
    const ui = els.get(row.id);
    ui.runBtn.disabled = !idle || !canRun(row);
  }
}

// ---- totals and the table for the write-up ---------------------------------------------

function showSummary() {
  const t = totals(rows);
  const stat = (value, label) => h('div', { class: 'stat' }, h('div', { class: 'stat__value' }, value), h('div', { class: 'stat__label' }, label));
  const money = (c) => (c == null ? '–' : costText(c));
  fill(
    page.summary,
    stat(`${t.ran} of ${t.rows}`, 'videos run'),
    stat(t.checked ? `${t.asExpected} of ${t.checked}` : '–', 'behaved as hoped'),
    stat(t.medianMs == null ? '–' : secondsText(t.medianMs), 'median time for a recipe'),
    stat(money(t.averageCost), 'average cost per recipe'),
    stat(t.lowestCost == null ? '–' : `${money(t.lowestCost)} to ${money(t.highestCost)}`, 'cost range'),
    stat(costText(t.totalCost), 'spent on these runs'),
    stat(`${t.rated.good} · ${t.rated.ok} · ${t.rated.poor}`, 'rated good · OK · poor'),
  );
}

function latestDate() {
  const times = rows.map((r) => r.run && r.run.at).filter(Boolean).sort();
  const d = times.length ? new Date(times[times.length - 1]) : new Date();
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const markdown = () => toMarkdown(rows, { origin: window.location.origin, date: latestDate() });
function showTable() {
  page.md.textContent = markdown();
}

async function copyTable() {
  try {
    await navigator.clipboard.writeText(markdown());
    page.copyStatus.textContent = 'Copied. Paste it into your write-up or into the chat.';
  } catch {
    const range = document.createRange();
    range.selectNodeContents(page.md);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    page.copyStatus.textContent = 'Your browser blocked copying. The table is selected below, so press Ctrl+C (or ⌘C on a Mac).';
  }
}

function download() {
  const body = {
    version: LAB_VERSION,
    recorded_at: new Date().toISOString(),
    origin: window.location.origin,
    rows: rows.map(({ id, label, hint, url, lang, expect, minRecipes, rating, note, run }) => ({ id, label, hint, url, lang, expect, minRecipes, rating, note, run })),
    payloads,
  };
  const blob = new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' });
  const link = h('a', { href: URL.createObjectURL(blob), download: 'test-results.json' });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  page.copyStatus.textContent = 'Saved test-results.json. Send that file back to whoever is putting your submission together.';
}

let clearArmed = null;
function clearResults(button) {
  if (!clearArmed) {
    button.textContent = 'Click again to clear everything';
    clearArmed = setTimeout(() => {
      clearArmed = null;
      button.textContent = 'Clear my results';
    }, 4000);
    return;
  }
  clearTimeout(clearArmed);
  clearArmed = null;
  button.textContent = 'Clear my results';
  for (const row of rows) {
    row.run = null;
    row.rating = '';
    row.note = '';
    const ui = els.get(row.id);
    ui.rating.value = '';
    ui.note.value = '';
    showOutput(row);
  }
  payloads = {};
  save();
  showSummary();
  showTable();
  page.copyStatus.textContent = 'Results cleared. Your links are still there.';
}

// ---- the setup check --------------------------------------------------------------------

const NEXT_STEP = {
  not_configured: 'OpenRouter rejected the key. In Cloudflare, open the Worker, then Settings, then Variables and Secrets, and check OPENROUTER_API_KEY. Paste the key with no spaces, then deploy again.',
  budget_exhausted: 'The OpenRouter key is out of credit.',
  model_unavailable: 'OpenRouter does not offer this model for this request. Change VIDEO_MODELS or TEXT_MODELS in wrangler.jsonc and deploy again.',
  video_unreadable: 'The model could not open the YouTube link. Check that the video is public, then run the check again.',
  upstream_busy: 'OpenRouter is busy. Wait a minute and run the check again.',
  timeout: 'The model took too long. Run the check again.',
  upstream_error: 'OpenRouter returned an error. The line above says what.',
};

function checkItem({ good, title, detail, next }) {
  return h(
    'div',
    { class: `check ${good ? 'check--good' : 'check--bad'}` },
    h('span', { class: 'check__mark', 'aria-hidden': 'true' }, good ? '✓' : '✗'),
    h('div', { class: 'check__title' }, h('span', { class: 'sr-only' }, good ? 'Passed: ' : 'Failed: '), title),
    detail ? h('div', { class: 'check__detail' }, detail) : null,
    next ? h('div', { class: 'check__next' }, next) : null,
  );
}

function showDiagnose(body) {
  const items = [];
  const c = body.config || {};
  items.push(
    checkItem({
      good: Boolean(c.has_key),
      title: c.has_key ? 'The AI key is set.' : 'The AI key is not set yet.',
      detail: c.has_key ? null : 'The Worker has no OPENROUTER_API_KEY secret.',
      next: c.has_key ? null : 'In Cloudflare, open the Worker, then Settings, then Variables and Secrets, add OPENROUTER_API_KEY as a secret, and deploy again.',
    }),
  );
  items.push(
    checkItem({
      good: true,
      title: `Models for video: ${(c.video_models || []).join(', ') || 'none'}`,
      detail: `Models for text: ${(c.text_models || []).join(', ') || 'none'}. Limits: ${c.rate_limit_per_hour} a visitor an hour, ${c.daily_cap} a day.`,
    }),
  );
  for (const k of body.checks || []) {
    if (k.name === 'key') continue;
    if (k.ok) {
      items.push(
        checkItem({
          good: true,
          title: `${k.name === 'video' ? 'Reads a YouTube video' : 'Answers a question'}: ${k.model}`,
          detail: `${secondsText(k.ms)} · ${costText(k.cost_usd)}${k.reply ? ` · it said “${k.reply}”` : ''}`,
        }),
      );
    } else {
      items.push(
        checkItem({
          good: false,
          title: `${k.name === 'video' ? 'Reading a YouTube video' : 'Answering a question'} failed: ${k.model}`,
          detail: [k.message, k.detail].filter(Boolean).join(' — '),
          next: NEXT_STEP[k.problem],
        }),
      );
    }
  }
  fill(page.setupOut, items);
}

function showDiagnoseFailure(err) {
  fill(
    page.setupOut,
    checkItem({
      good: false,
      title: err.message || 'The check could not run.',
      detail: err.hint || null,
      next: err.code === 'rate_limited' ? 'You have used this hour’s allowance. Wait a little and try again.' : null,
    }),
  );
}

function buildSetup() {
  const options = [
    ['Check settings', '', 'Free'],
    ['Check the AI connection', 'ping=1', 'Under 1¢'],
    ['Check video reading', 'video=1', 'About 1¢'],
  ];
  const buttons = options.map(([name, query, price]) =>
    h(
      'button',
      {
        class: query ? 'btn btn--quiet' : 'btn',
        type: 'button',
        onclick: async () => {
          for (const b of buttons) b.disabled = true;
          fill(page.setupOut, h('p', { class: 'case__none' }, query === 'video=1' ? 'Checking… this one can take about 20 seconds.' : 'Checking…'));
          try {
            showDiagnose(await requestDiagnose(query));
          } catch (err) {
            showDiagnoseFailure(err);
          }
          for (const b of buttons) b.disabled = false;
        },
      },
      name,
      ' ',
      h('span', { class: 'btn__price' }, `(${price})`),
    ),
  );
  fill(page.setupButtons, buttons);
}

// ---- start ------------------------------------------------------------------------------

async function start() {
  const mine = load(KEY_ROWS);
  let recorded = null;
  if (mine && Array.isArray(mine.rows)) {
    rows = normalizeRows(mine.rows);
    const saved = load(KEY_PAYLOADS);
    payloads = saved && typeof saved === 'object' ? saved : {};
  } else {
    recorded = await loadRecorded();
    if (recorded) {
      rows = normalizeRows(recorded.rows);
      payloads = recorded.payloads && typeof recorded.payloads === 'object' ? recorded.payloads : {};
    }
  }

  if (recorded) {
    const when = recorded.recorded_at ? new Date(recorded.recorded_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    page.recordedNote.textContent = `The results below were recorded${when ? ` on ${when}` : ''}${recorded.origin ? ` against ${recorded.origin}` : ''}. Open any recipe to see exactly what came out. Anything you run here is kept in your browser only.`;
    page.recordedNote.hidden = false;
  }

  buildSetup();
  fill(page.cases, rows.map(buildCase));
  const fitAll = () => els.forEach((ui) => ui.fit());
  fitAll();
  window.addEventListener('resize', fitAll);
  for (const row of rows) showOutput(row);
  showSummary();
  showTable();
  syncControls();

  page.runAll.addEventListener('click', runEverything);
  page.stop.addEventListener('click', () => {
    if (batch) batch.stop = true;
    page.batchStatus.textContent = 'Stopping after the current video…';
  });
  $('#copy-md').addEventListener('click', copyTable);
  $('#download-json').addEventListener('click', download);
  $('#clear').addEventListener('click', (event) => clearResults(event.currentTarget));
}

start();
