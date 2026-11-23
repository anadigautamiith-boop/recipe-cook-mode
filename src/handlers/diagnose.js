// GET /api/diagnose            -> settings only (free, no secrets shown)
// GET /api/diagnose?ping=1     -> also asks each text model one tiny question (a fraction of a cent)
// GET /api/diagnose?video=1    -> also sends a 19-second public YouTube clip to each video model
//
// This is the owner's "is everything wired up?" button. It shows whether the key is present
// (yes/no, never the key), which models work, how long they took and what each check cost.

import { AppError } from '../errors.js';
import { json } from '../http.js';
import { chatComplete } from '../openrouter.js';
import { clientIp, readConfig } from '../config.js';
import { videoWasRead } from '../video-check.js';

// The first video ever uploaded to YouTube: 19 seconds, public, and not going anywhere.
const SAMPLE_VIDEO = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

function unique(list) {
  return [...new Set(list)];
}

async function check({ name, model, messages, apiKey, fetchImpl, timeoutMs = 60_000, maxTokens = 300, minPromptTokens = null }) {
  const started = Date.now();
  try {
    const reply = await chatComplete({
      apiKey,
      models: [model],
      messages,
      maxTokens,
      timeoutMs,
      fetchImpl,
      jsonMode: false,
    });
    // The answer can sound right even when the video never arrived, so check what was billed.
    if (minPromptTokens != null && videoWasRead(reply.usage.prompt, minPromptTokens) === false) {
      return {
        name,
        model,
        ok: false,
        ms: Date.now() - started,
        problem: 'video_unreadable',
        message: 'The AI answered, but it never received the video.',
        detail: `only ${reply.usage.prompt} prompt tokens were used, which is too few for a video`,
      };
    }
    return {
      name,
      model,
      ok: true,
      ms: Date.now() - started,
      tokens: reply.usage.total,
      cost_usd: reply.usage.cost,
      reply: reply.text.replace(/\s+/g, ' ').trim().slice(0, 140),
    };
  } catch (err) {
    return {
      name,
      model,
      ok: false,
      ms: Date.now() - started,
      problem: err instanceof AppError ? err.code : 'error',
      message: err instanceof AppError ? err.message : 'Unexpected error',
      detail: err instanceof AppError && err.detail ? String(err.detail).slice(0, 400) : null,
    };
  }
}

export async function handleDiagnose({ request, env, deps, version }) {
  if (request.method !== 'GET') {
    throw new AppError('method_not_allowed', 'Use GET for this address.', { status: 405 });
  }
  const url = new URL(request.url);
  const config = readConfig(env);
  const body = {
    ok: true,
    app: 'cookalong',
    version,
    time: new Date(deps.now()).toISOString(),
    config: {
      has_key: Boolean(config.apiKey),
      video_models: config.videoModels,
      text_models: config.textModels,
      rate_limit_per_hour: config.perHour,
      daily_cap: config.dailyCap,
    },
    checks: [],
  };

  const wantPing = url.searchParams.get('ping') === '1';
  const wantVideo = url.searchParams.get('video') === '1';
  if (!wantPing && !wantVideo) return json(body);

  if (!config.apiKey) {
    body.ok = false;
    body.checks.push({
      name: 'key',
      ok: false,
      message: 'The OPENROUTER_API_KEY secret is not set on this Worker.',
    });
    return json(body);
  }

  deps.limiter.check(clientIp(request), {
    perHour: config.perHour,
    dailyCap: config.dailyCap,
    now: deps.now(),
  });

  const jobs = [];
  if (wantPing) {
    for (const model of unique([...config.textModels, ...config.videoModels])) {
      jobs.push(
        check({
          name: 'text',
          model,
          apiKey: config.apiKey,
          fetchImpl: deps.fetchImpl,
          messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
        }),
      );
    }
  }
  if (wantVideo) {
    for (const model of unique(config.videoModels)) {
      jobs.push(
        check({
          name: 'video',
          model,
          apiKey: config.apiKey,
          fetchImpl: deps.fetchImpl,
          timeoutMs: 80_000,
          minPromptTokens: 1000, // a 19-second clip alone is about 5,500
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'In one short sentence, say what this video shows.' },
                { type: 'video_url', video_url: { url: SAMPLE_VIDEO } },
              ],
            },
          ],
        }),
      );
    }
  }
  body.checks = await Promise.all(jobs);
  body.ok = body.checks.every((c) => c.ok);
  return json(body);
}
