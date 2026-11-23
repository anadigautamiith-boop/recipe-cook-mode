// POST /api/recipe  { url?, text?, lang?, refresh?, model? }
//
// Order of work (cheapest first, so nothing is paid for twice):
//   1. check the input        3. look in the cache      5. run the pipeline
//   2. check the settings     4. check the rate limits  6. remember a good result

import { AppError } from '../errors.js';
import { json, readJsonBody } from '../http.js';
import { parseVideoUrl } from '../../public/js/shared/urls.js';
import { normalizeLang } from '../prompt.js';
import { hashString } from '../cache.js';
import { clientIp, readConfig } from '../config.js';
import { runRecipe } from '../pipeline.js';

const MIN_TEXT_CHARS = 40;
const MAX_TEXT_CHARS = 20_000;

export async function handleRecipe({ request, env, deps }) {
  if (request.method !== 'POST') {
    throw new AppError('method_not_allowed', 'Use POST for this address.', { status: 405 });
  }
  const body = await readJsonBody(request);

  // 1. input ---------------------------------------------------------------------
  const lang = normalizeLang(body.lang);
  const rawUrl = typeof body.url === 'string' ? body.url.trim() : '';
  const text = typeof body.text === 'string' ? body.text.replace(/\r\n/g, '\n').trim() : '';
  if (!rawUrl && !text) {
    throw new AppError('missing_input', 'Paste a YouTube or Instagram link to begin.', { status: 400 });
  }

  let parsed = null;
  if (rawUrl) {
    const attempt = parseVideoUrl(rawUrl);
    if (attempt.ok) parsed = attempt;
    // A bad link is only a problem when there is no pasted text to fall back on.
    else if (!text) throw new AppError(attempt.code, attempt.message, { status: 400, hint: attempt.hint });
  }
  if (text) {
    if (text.length < MIN_TEXT_CHARS) {
      throw new AppError('text_too_short', "That's too short to be a recipe.", {
        status: 400,
        hint: 'Paste the ingredients and steps, or the whole caption.',
      });
    }
    if (text.length > MAX_TEXT_CHARS) {
      throw new AppError('text_too_long', 'That text is too long.', {
        status: 413,
        hint: 'Paste just the recipe part (about 20,000 characters at most).',
      });
    }
  }

  // 2. settings ------------------------------------------------------------------
  const config = readConfig(env);
  if (!config.apiKey) {
    throw new AppError('not_configured', 'The server is not set up correctly yet.', {
      status: 500,
      hint: 'The owner needs to add the OPENROUTER_API_KEY secret.',
      detail: 'OPENROUTER_API_KEY is missing',
    });
  }
  let { videoModels, textModels } = config;
  if (body.model != null && body.model !== '') {
    const allowed = new Set([...config.videoModels, ...config.textModels]);
    const wanted = String(body.model);
    if (!allowed.has(wanted)) throw new AppError('bad_model', 'That model is not one we offer.', { status: 400 });
    const first = (list) => [wanted, ...list.filter((m) => m !== wanted)];
    videoModels = first(videoModels);
    textModels = first(textModels);
  }

  // 3. cache ---------------------------------------------------------------------
  const keyBody = text
    ? `text|${hashString(text)}|${text.length}|${parsed ? parsed.canonicalUrl : ''}`
    : parsed.canonicalUrl;
  const cacheKey = `v1|${lang}|${body.model || ''}|${keyBody}`;
  if (body.refresh !== true) {
    const hit = deps.cache.get(cacheKey, deps.now());
    if (hit) {
      deps.log({ evt: 'recipe', cached: true, route: hit.meta.route, video_id: hit.meta.video_id });
      return json({
        ...hit,
        meta: { ...hit.meta, cached: true, original_cost_usd: hit.meta.cost_usd, cost_usd: 0, ms: 0 },
      });
    }
  }

  // 4. limits --------------------------------------------------------------------
  deps.limiter.check(clientIp(request), {
    perHour: config.perHour,
    dailyCap: config.dailyCap,
    now: deps.now(),
  });

  // 5. work ----------------------------------------------------------------------
  const out = await runRecipe({
    parsed,
    text,
    lang,
    apiKey: config.apiKey,
    videoModels,
    textModels,
    fetchImpl: deps.fetchImpl,
    now: deps.now,
  });
  const payload = { ok: true, result: out.result, meta: out.meta, source: out.source };
  deps.log({
    evt: 'recipe',
    cached: false,
    route: out.meta.route,
    video_id: out.meta.video_id,
    model: out.meta.model,
    ms: out.meta.ms,
    cost_usd: out.meta.cost_usd,
    is_recipe: out.result.is_recipe,
    fallbacks: out.meta.fallbacks.length,
  });

  // 6. remember ------------------------------------------------------------------
  if (out.result.is_recipe) deps.cache.set(cacheKey, payload, deps.now());
  return json(payload);
}
