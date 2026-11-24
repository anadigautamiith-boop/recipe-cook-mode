// The test lab's logic, with no page in it, so Node can test it.
// A "row" is one test video. A "run" is what happened the last time we sent it through the app.

export const LAB_VERSION = 1;

export const RATINGS = [
  ['', 'Not rated yet'],
  ['good', 'Good: I could cook from it'],
  ['ok', 'OK: needs small fixes'],
  ['poor', 'Poor: not usable'],
];
const RATING_WORDS = { good: 'Good', ok: 'OK', poor: 'Poor' };

/**
 * The starting test set. The YouTube links were each checked against a page that embeds them;
 * the Instagram and long-video rows are left for you, because only you know which reels you
 * and your friends actually cook from.
 *
 * `expect` lists the outcomes that count as the right behaviour. Leave it out when only a
 * person can say what the right behaviour is. `minRecipes` is for videos with several dishes.
 */
export const DEFAULT_ROWS = [
  {
    id: 'easy',
    label: 'Easy: one dish, clear voice-over',
    hint: 'Paste a public cooking video of 3 to 6 minutes: one dish and someone talking through it. The baseline to compare everything else with. Check it plays without signing in.',
    url: '',
    expect: ['recipe'],
  },
  {
    id: 'short',
    label: 'Short and fast: a YouTube Short',
    hint: 'Under a minute, so there is little time to say amounts. Gaps should be marked, never invented.',
    url: 'https://www.youtube.com/shorts/-3RfZsImwGg',
  },
  {
    id: 'hindi',
    label: 'Hindi recipe page: a dal tadka video',
    hint: 'Watch ten seconds and note how it is presented: which language is spoken, and whether amounts are said or only written on screen. Then rename this row to match. Either way you should get a clear recipe.',
    url: 'https://www.youtube.com/watch?v=XzKkkMdo7Jk',
    expect: ['recipe'],
  },
  {
    id: 'many',
    label: 'Several dishes in one video',
    hint: 'Five recipes in ten minutes. You should get one tab per dish.',
    url: 'https://www.youtube.com/watch?v=ERysyFbJH7w',
    expect: ['recipe'],
    minRecipes: 2,
  },
  {
    id: 'notrecipe',
    label: 'Not a recipe',
    hint: 'The first video ever uploaded to YouTube, 19 seconds at a zoo. It must say so instead of inventing a dish.',
    url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    expect: ['not_recipe'],
  },
  {
    id: 'long',
    label: 'Long: 12 minutes or more',
    hint: 'Paste a long cooking video. It should finish, or fail honestly with a clear message. A half-made recipe is a failure.',
    url: '',
    expect: ['recipe', 'error:too_long'],
  },
  {
    id: 'ig-caption',
    label: 'Instagram Reel, recipe written in the caption',
    hint: 'Paste a Reel whose caption lists the recipe. It should build from the caption and say it could not watch the video.',
    url: '',
    expect: ['recipe'],
  },
  {
    id: 'ig-bare',
    label: 'Instagram Reel, nothing useful in the caption',
    hint: 'The recipe is only in the video. It should ask you to paste the text, and must not make one up.',
    url: '',
    expect: ['needs_text', 'error:caption_not_recipe'],
  },
];

// ---- turning an answer into a run -------------------------------------------------------

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** A short record of a finished request, from the app's JSON answer. */
export function runFromPayload(payload, { clientMs = null, now = Date.now() } = {}) {
  const meta = (payload && payload.meta) || {};
  const result = (payload && payload.result) || {};
  const first = Array.isArray(result.recipes) ? result.recipes[0] : null;
  const stats = meta.stats || {};
  return {
    at: new Date(now).toISOString(),
    outcome: result.is_recipe ? 'recipe' : 'not_recipe',
    title: first && first.title ? String(first.title) : '',
    reason: result.is_recipe ? '' : String(result.not_recipe_reason || ''),
    route: String(meta.route || ''),
    model: String(meta.model || ''),
    cached: Boolean(meta.cached),
    ms: num(meta.ms),
    clientMs: num(clientMs) == null ? null : Math.round(clientMs),
    cost: num(meta.cost_usd),
    tokens: meta.tokens ? num(meta.tokens.total) : null,
    stats: {
      recipes: num(stats.recipes) ?? 0,
      ingredients: num(stats.ingredients) ?? 0,
      ingredients_stated: num(stats.ingredients_stated) ?? 0,
      steps: num(stats.steps) ?? 0,
      timers: num(stats.timers) ?? 0,
      cues: num(stats.cues) ?? 0,
      gaps: num(stats.gaps) ?? 0,
    },
    fallbacks: Array.isArray(meta.fallbacks) ? meta.fallbacks.slice(0, 6).map(String) : [],
    adjustments: Array.isArray(meta.adjustments) ? meta.adjustments.slice(0, 3).map(String) : [],
    error: null,
  };
}

/** A short record of a request that failed. `err` is an ApiError or anything with a `code`. */
export function runFromError(err, { clientMs = null, now = Date.now() } = {}) {
  const code = (err && err.code) || 'error';
  return {
    at: new Date(now).toISOString(),
    outcome: code === 'needs_text' ? 'needs_text' : `error:${code}`,
    title: '',
    reason: '',
    route: '',
    model: '',
    cached: false,
    ms: null,
    clientMs: num(clientMs) == null ? null : Math.round(clientMs),
    cost: null,
    tokens: null,
    stats: null,
    fallbacks: [],
    adjustments: [],
    error: { code, message: String((err && err.message) || 'Something went wrong.'), hint: (err && err.hint) || null },
  };
}

/** true = behaved as hoped, false = did not, null = nothing to check automatically. */
export function checkRun(row, run) {
  if (!run || !Array.isArray(row.expect) || row.expect.length === 0) return null;
  if (!row.expect.includes(run.outcome)) return false;
  if (run.outcome === 'recipe' && row.minRecipes && (run.stats ? run.stats.recipes : 0) < row.minRecipes) return false;
  return true;
}

export function outcomeWords(run) {
  if (!run) return '';
  if (run.outcome === 'recipe') return 'Made a recipe';
  if (run.outcome === 'not_recipe') return 'Said it is not a recipe';
  if (run.outcome === 'needs_text') return 'Asked for pasted text';
  if (run.outcome === 'error:caption_not_recipe') return 'Said the caption has no recipe';
  return `Failed (${run.error ? run.error.code : run.outcome.replace('error:', '')})`;
}

// ---- totals ---------------------------------------------------------------------------

export function median(list) {
  const xs = list.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

const runTime = (run) => (run.ms != null ? run.ms : run.clientMs);

export function totals(rows) {
  const done = rows.filter((r) => r.run);
  const recipeRuns = done.filter((r) => r.run.outcome === 'recipe').map((r) => r.run);
  const costs = recipeRuns.map((r) => r.cost).filter((c) => c != null);
  const checks = done.map((r) => checkRun(r, r.run)).filter((c) => c !== null);
  const rated = { good: 0, ok: 0, poor: 0 };
  for (const r of rows) if (rated[r.rating] != null) rated[r.rating] += 1;
  return {
    rows: rows.length,
    ran: done.length,
    checked: checks.length,
    asExpected: checks.filter(Boolean).length,
    recipes: recipeRuns.length,
    medianMs: median(recipeRuns.map(runTime)),
    medianCost: median(costs),
    averageCost: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null,
    lowestCost: costs.length ? Math.min(...costs) : null,
    highestCost: costs.length ? Math.max(...costs) : null,
    totalCost: done.reduce((sum, r) => sum + (r.run.cost || 0), 0),
    rated,
  };
}

// ---- saved state ----------------------------------------------------------------------

/** Merge whatever was saved with the default rows. Anything unreadable falls back to the defaults. */
export function normalizeRows(saved) {
  const byId = new Map();
  if (Array.isArray(saved)) for (const r of saved) if (r && typeof r.id === 'string') byId.set(r.id, r);
  const rows = DEFAULT_ROWS.map((base) => {
    const s = byId.get(base.id) || {};
    return {
      ...base,
      label: typeof s.label === 'string' && s.label.trim() ? s.label.trim().slice(0, 120) : base.label,
      url: typeof s.url === 'string' ? s.url.trim().slice(0, 600) : base.url,
      lang: typeof s.lang === 'string' && s.lang ? s.lang : 'en',
      rating: RATING_WORDS[s.rating] ? s.rating : '',
      note: typeof s.note === 'string' ? s.note.slice(0, 600) : '',
      run: s.run && typeof s.run === 'object' && typeof s.run.outcome === 'string' ? s.run : null,
    };
  });
  return rows;
}

// ---- words for the write-up -----------------------------------------------------------

const cell = (text) => String(text ?? '').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim();

function shortLink(url) {
  const m = String(url || '').match(/(?:v=|\/shorts\/|youtu\.be\/|\/reel\/|\/reels\/|\/p\/)([A-Za-z0-9_-]{5,})/);
  return m ? m[1] : String(url || '').replace(/^https?:\/\//, '').slice(0, 24);
}

const seconds = (ms) => (ms == null ? '' : `${(ms / 1000).toFixed(1)} s`);
const dollars = (c) => {
  if (c == null) return '';
  if (c === 0) return '$0';
  return c < 0.1 ? `$${c.toFixed(3)}` : `$${c.toFixed(2)}`;
};

/** The results as a Markdown table plus a few lines of totals, ready to paste into the write-up. */
export function toMarkdown(rows, { origin = '', date = '' } = {}) {
  const head = [
    '| # | Video | What it tests | Result | Time | Cost | Amounts stated | Steps | Gaps flagged | Rating | Notes |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  const lines = rows.map((r, i) => {
    const run = r.run;
    const link = r.url ? `[${cell(shortLink(r.url))}](${r.url})` : 'not tested';
    let result = '';
    if (run) {
      const verdict = checkRun(r, run);
      result = `${outcomeWords(run)}${verdict === true ? ' (as hoped)' : verdict === false ? ' (not as hoped)' : ''}`;
    }
    const s = run && run.stats && run.outcome === 'recipe' ? run.stats : null;
    return [
      i + 1,
      link,
      cell(r.label),
      cell(result),
      run ? seconds(runTime(run)) : '',
      run ? dollars(run.cost) : '',
      s ? `${s.ingredients_stated} of ${s.ingredients}` : '',
      s ? s.steps : '',
      s ? s.gaps : '',
      RATING_WORDS[r.rating] || '',
      cell(r.note || (run && run.error ? run.error.message : '')),
    ];
  });
  const t = totals(rows);
  const out = [...head, ...lines.map((cols) => `| ${cols.join(' | ')} |`), ''];
  const facts = [];
  if (t.ran) facts.push(`${t.ran} of ${t.rows} videos run${date ? ` on ${date}` : ''}${origin ? ` against ${origin}` : ''}.`);
  if (t.checked) facts.push(`${t.asExpected} of ${t.checked} behaved as hoped.`);
  if (t.recipes) {
    facts.push(`Median time for a recipe: ${seconds(t.medianMs)}.`);
    if (t.averageCost != null) {
      facts.push(`Cost per recipe: average ${dollars(t.averageCost)}, from ${dollars(t.lowestCost)} to ${dollars(t.highestCost)}.`);
    }
  }
  facts.push(`Total spent on this run: ${dollars(t.totalCost)}.`);
  const ratedCount = t.rated.good + t.rated.ok + t.rated.poor;
  if (ratedCount) facts.push(`My ratings: ${t.rated.good} good, ${t.rated.ok} OK, ${t.rated.poor} poor.`);
  return `${out.join('\n')}\n${facts.join(' ')}\n`;
}
