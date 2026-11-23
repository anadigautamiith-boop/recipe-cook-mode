// The recipe pipeline: pick the cheapest route that can work for this link, ask the AI,
// then check what came back. Everything that costs money or can fail is in this file.
//
// Routes
//   youtube-video     the YouTube link goes straight to a video-capable model (no download by us)
//   instagram-caption we read the public caption (best effort) and the model works from the text
//   pasted-text       the visitor pasted a recipe, caption or transcript; text model only (cheapest)

import { AppError } from './errors.js';
import { platformLabel } from '../public/js/shared/urls.js';
import { buildTextMessages, buildVideoMessages } from './prompt.js';
import { chatComplete } from './openrouter.js';
import { dropImplausibleTimestamps, extractJson, normalizeResult, summarizeResult } from './schema.js';
import { latestPlausibleSecond, videoUnreadableError, videoWasRead } from './video-check.js';
import { fetchInstagramCaption } from './instagram.js';

export const ROUTES = Object.freeze({
  youtube: 'youtube-video',
  instagram: 'instagram-caption',
  text: 'pasted-text',
});

// The first live runs showed the main model running out of room on videos of more than a few
// minutes at 8,000 tokens (it spends some of them thinking), so the cheaper model had to redo the job.
const VIDEO_MAX_TOKENS = 10_000;
const VIDEO_TIMEOUT_MS = 120_000;
const TEXT_MAX_TOKENS = 5000;
const MIN_CAPTION_CHARS = 40;
const MAX_TEXT_CHARS = 20_000;

const roundCost = (n) => Math.round(n * 1e6) / 1e6;

function addUsage(total, usage) {
  for (const key of ['prompt', 'completion', 'total']) {
    if (Number.isFinite(usage[key])) total[key] += usage[key];
  }
  if (typeof usage.cost === 'number') {
    total.cost += usage.cost;
    total.costKnown = true;
  }
}

/**
 * Ask the models in order until one gives an answer we can read.
 * A model that answers with broken JSON is skipped and the next one is tried.
 */
async function askForRecipe({ apiKey, models, messages, maxTokens, timeoutMs, platform, fetchImpl }) {
  let remaining = [...models];
  let attempts = 0;
  let blind = 0;
  const usage = { prompt: 0, completion: 0, total: 0, cost: 0, costKnown: false };
  const notes = [];
  let cutOff = false;

  while (remaining.length > 0) {
    const reply = await chatComplete({ apiKey, models: remaining, messages, maxTokens, timeoutMs, fetchImpl });
    addUsage(usage, reply.usage);
    notes.push(...reply.tried);
    attempts += 1;

    // A model that never received the video will still answer, by inventing a recipe. Refuse it.
    if (platform === 'youtube' && videoWasRead(reply.usage.prompt) === false) {
      blind += 1;
      notes.push(`${reply.requested}: the video was not read (only ${reply.usage.prompt} prompt tokens were used)`);
      const at = remaining.indexOf(reply.requested);
      remaining = at >= 0 ? remaining.slice(at + 1) : [];
      continue;
    }

    try {
      const result = normalizeResult(extractJson(reply.text), { platform });
      if (platform === 'youtube') {
        const latest = latestPlausibleSecond(reply.usage.prompt);
        const removed = dropImplausibleTimestamps(result, latest);
        if (removed > 0) {
          notes.push(`${reply.requested}: ${removed} step timestamps hidden because some were later than the video can be`);
        }
      }
      return { result, reply, usage, notes };
    } catch (err) {
      cutOff = reply.finishReason === 'length';
      notes.push(`${reply.requested}: unreadable reply (${err.message}${cutOff ? '; cut off' : ''})`);
      const at = remaining.indexOf(reply.requested);
      remaining = at >= 0 ? remaining.slice(at + 1) : [];
    }
  }

  if (blind > 0 && blind === attempts) {
    throw videoUnreadableError(notes.join(' | ').slice(0, 600));
  }
  if (cutOff) {
    throw new AppError('too_long', 'That video has more in it than we can write up in one go.', {
      status: 422,
      hint: 'Try a shorter video, or one that shows a single dish.',
      canPaste: true,
      detail: notes.join(' | ').slice(0, 600),
    });
  }
  throw new AppError('bad_output', "We couldn't turn that into a clear recipe.", {
    status: 502,
    hint: 'Please try again, or paste the recipe text.',
    retryable: true,
    canPaste: true,
    detail: notes.join(' | ').slice(0, 600),
  });
}

/**
 * Run the whole thing for one request.
 * @param {object} input
 * @param {object|null} input.parsed   result of parseVideoUrl() when ok, else null
 * @param {string}      input.text     pasted text, or '' when none
 */
export async function runRecipe({ parsed, text, lang, apiKey, videoModels, textModels, fetchImpl, now = Date.now }) {
  const started = now();
  let route;
  let platform;
  let messages;
  let models;
  let maxTokens;
  let timeoutMs;
  let source;

  if (text) {
    route = ROUTES.text;
    platform = 'text';
    const label = parsed
      ? `${platformLabel(parsed.platform)} link (text supplied by the visitor)`
      : 'Text supplied by the visitor';
    messages = buildTextMessages({ text: text.slice(0, MAX_TEXT_CHARS), label, lang });
    models = textModels;
    maxTokens = TEXT_MAX_TOKENS;
    source = { type: 'text', chars: Math.min(text.length, MAX_TEXT_CHARS) };
  } else if (parsed.platform === 'youtube') {
    route = ROUTES.youtube;
    platform = 'youtube';
    messages = buildVideoMessages({ url: parsed.canonicalUrl, lang });
    models = videoModels;
    maxTokens = VIDEO_MAX_TOKENS;
    timeoutMs = VIDEO_TIMEOUT_MS;
    source = { type: 'youtube' };
  } else {
    route = ROUTES.instagram;
    platform = 'text';
    const caption = await fetchInstagramCaption(parsed, { fetchImpl });
    if (!caption.text || caption.text.length < MIN_CAPTION_CHARS) {
      throw new AppError('needs_text', "Instagram doesn't let us read this Reel automatically.", {
        status: 422,
        hint: 'Copy the caption (or the ingredients and steps shown in the Reel) and paste it here. We will take it from there.',
        canPaste: true,
        detail: 'no public caption found',
      });
    }
    const captionText = caption.text.slice(0, MAX_TEXT_CHARS);
    messages = buildTextMessages({ text: captionText, label: 'Instagram caption', lang });
    models = textModels;
    maxTokens = TEXT_MAX_TOKENS;
    source = { type: 'instagram-caption', caption_from: caption.source, chars: captionText.length };
  }

  const { result, reply, usage, notes } = await askForRecipe({
    apiKey,
    models,
    messages,
    maxTokens,
    timeoutMs,
    platform,
    fetchImpl,
  });

  if (route === ROUTES.instagram && !result.is_recipe) {
    throw new AppError('caption_not_recipe', "That caption doesn't include the recipe.", {
      status: 422,
      hint: 'Many creators put the recipe in the video or the comments. Paste the ingredients and steps here and we will build it from that.',
      canPaste: true,
      detail: result.not_recipe_reason,
    });
  }

  const ms = now() - started;
  return {
    result,
    meta: {
      route,
      platform: parsed ? parsed.platform : null,
      video_id: parsed ? parsed.id : null,
      canonical_url: parsed ? parsed.canonicalUrl : null,
      lang,
      model: reply.model,
      tokens: { prompt: usage.prompt, completion: usage.completion, total: usage.total },
      cost_usd: usage.costKnown ? roundCost(usage.cost) : null,
      ms,
      cached: false,
      created_at: new Date(now()).toISOString(),
      stats: summarizeResult(result),
      fallbacks: notes.slice(0, 6).map((n) => String(n).slice(0, 200)),
    },
    source,
  };
}
