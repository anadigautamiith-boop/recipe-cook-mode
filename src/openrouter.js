// A small client for OpenRouter's chat endpoint.
// It tries each configured model in turn, retries once without optional settings if a
// model rejects them, and turns every failure into an error a visitor can understand.

import { AppError } from './errors.js';

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export function parseModelList(value, fallback) {
  const items = String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : fallback;
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function describeUpstream(status, data, raw) {
  const err = data && data.error;
  const parts = [];
  if (err) {
    if (typeof err === 'string') parts.push(err);
    else {
      if (err.message) parts.push(err.message);
      if (err.metadata) {
        try {
          parts.push(JSON.stringify(err.metadata).slice(0, 400));
        } catch {
          // ignore
        }
      }
    }
  } else if (raw) {
    parts.push(String(raw).slice(0, 300));
  }
  return `${status}: ${parts.join(' | ')}`.slice(0, 700);
}

/** Decide what a visitor should be told when OpenRouter or the model says no. */
export function classifyUpstream(status, message) {
  const m = String(message || '').toLowerCase();
  if (status === 401) {
    return new AppError('not_configured', 'The server is not set up correctly yet.', {
      status: 500,
      hint: 'The owner needs to check the OpenRouter key.',
      detail: message,
    });
  }
  if (status === 402) {
    return new AppError('budget_exhausted', "The demo's AI budget has run out.", {
      status: 503,
      hint: 'Please let the owner know.',
      detail: message,
    });
  }
  if (status === 429) {
    return new AppError('upstream_busy', 'The AI service is busy right now.', {
      status: 503,
      hint: 'Please try again in a minute.',
      retryable: true,
      detail: message,
    });
  }
  if (/no endpoints|not a valid model|model.{0,30}not (found|available)|does not support|unsupported (model|modality)|not support/.test(m)) {
    return new AppError('model_unavailable', "The AI model we use isn't available right now.", {
      status: 503,
      hint: 'The owner needs to check the model settings.',
      detail: message,
    });
  }
  if (/context|too many tokens|token limit|maximum.{0,20}length|too long|exceeds/.test(m)) {
    return new AppError('too_long', 'That video is too long for us to read in one go.', {
      status: 422,
      hint: 'Try a video under about 30 minutes, or one that shows a single recipe.',
      canPaste: true,
      detail: message,
    });
  }
  if (
    status === 403 ||
    /video|youtube|private|unavailable|not accessible|(cannot|can't|could not|unable to) (fetch|access|open|download|retrieve|load)|file_uri|invalid.{0,10}url|permission/.test(m)
  ) {
    return new AppError('video_unreadable', "We couldn't open that video.", {
      status: 422,
      hint: 'It may be private, age-restricted, a live stream, or blocked. Try another link, or paste the recipe text.',
      canPaste: true,
      detail: message,
    });
  }
  return new AppError('upstream_error', 'The AI service had a problem.', {
    status: 502,
    hint: 'Please try again in a moment.',
    retryable: true,
    detail: message,
  });
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('');
  }
  return '';
}

/**
 * Ask a model for a JSON answer.
 * Returns { text, finishReason, model, id, usage: { prompt, completion, total, cost }, ms, tried }.
 */
export async function chatComplete({
  apiKey,
  models,
  messages,
  maxTokens = 6000,
  timeoutMs = 90_000,
  fetchImpl,
  referer,
  title = 'Cookalong',
  jsonMode = true,
}) {
  if (!models || models.length === 0) {
    throw new AppError('not_configured', 'The server is not set up correctly yet.', { status: 500 });
  }
  const started = Date.now();
  const tried = [];
  let lastError = null;

  for (const model of models) {
    let moveOn = false;
    for (const mode of ['full', 'plain']) {
      const body = {
        model,
        messages,
        temperature: 0.2,
        max_tokens: maxTokens,
        usage: { include: true },
      };
      if (mode === 'full') {
        if (jsonMode) body.response_format = { type: 'json_object' };
        body.reasoning = { effort: 'low', exclude: true };
      }

      let res;
      let raw;
      try {
        res = await fetchWithTimeout(
          fetchImpl,
          `${OPENROUTER_BASE}/chat/completions`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${apiKey}`,
              'content-type': 'application/json',
              'x-title': title,
              ...(referer ? { 'http-referer': referer } : {}),
            },
            body: JSON.stringify(body),
          },
          timeoutMs,
        );
        raw = await res.text();
      } catch (err) {
        if (err && err.name === 'AbortError') {
          throw new AppError('timeout', 'This is taking too long.', {
            status: 504,
            hint: 'Try again, or try a shorter video.',
            retryable: true,
            detail: `timeout after ${timeoutMs}ms on ${model}`,
          });
        }
        lastError = new AppError('upstream_error', 'We could not reach the AI service.', {
          status: 502,
          hint: 'Please try again in a moment.',
          retryable: true,
          detail: String(err && err.message ? err.message : err),
        });
        tried.push(`${model}: network error`);
        moveOn = true;
        break;
      }

      let data = null;
      try {
        data = JSON.parse(raw);
      } catch {
        // not JSON
      }
      const inBand = data && data.error ? data.error : null;
      const status = inBand && typeof inBand.code === 'number' ? inBand.code : res.status;

      if (res.ok && data && !inBand && Array.isArray(data.choices) && data.choices.length > 0) {
        const choice = data.choices[0];
        const text = extractText(choice && choice.message ? choice.message.content : '');
        if (text.trim()) {
          const u = data.usage || {};
          return {
            text,
            finishReason: choice.finish_reason || null,
            model: data.model || model,
            requested: model,
            id: data.id || null,
            usage: {
              prompt: Number.isFinite(u.prompt_tokens) ? u.prompt_tokens : null,
              completion: Number.isFinite(u.completion_tokens) ? u.completion_tokens : null,
              total: Number.isFinite(u.total_tokens) ? u.total_tokens : null,
              cost: typeof u.cost === 'number' ? u.cost : null,
            },
            ms: Date.now() - started,
            tried,
          };
        }
        tried.push(`${model}/${mode}: empty reply`);
        lastError = new AppError('bad_output', "We couldn't turn that into a clear recipe.", {
          status: 502,
          hint: 'Please try again, or paste the recipe text.',
          retryable: true,
          canPaste: true,
          detail: `empty reply from ${model}`,
        });
        moveOn = true;
        break;
      }

      const message = describeUpstream(status, data, raw);
      tried.push(`${model}/${mode}: ${message.slice(0, 160)}`);
      lastError = classifyUpstream(status, message);

      if (status === 401 || status === 402) throw lastError;
      // Some models reject optional settings. Try once more without them.
      if ((status === 400 || status === 422) && mode === 'full') continue;
      // These are about the visitor's video, not the model: another model will not help.
      if (lastError.code === 'video_unreadable' || lastError.code === 'too_long') throw lastError;
      moveOn = true;
      break;
    }
    if (moveOn) continue;
  }

  throw lastError || new AppError('upstream_error', 'The AI service had a problem.', { status: 502, retryable: true });
}
