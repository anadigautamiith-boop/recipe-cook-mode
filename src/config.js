// Reads the settings the Worker was given. Nothing here is secret except the API key,
// and the key is only ever read from the Worker's secret store (never from code).

import { parseModelList } from './openrouter.js';

export const DEFAULT_VIDEO_MODELS = ['google/gemini-2.5-flash', 'google/gemini-2.5-flash-lite'];
export const DEFAULT_TEXT_MODELS = ['google/gemini-2.5-flash-lite', 'google/gemini-2.5-flash'];

function positiveInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function readConfig(env = {}) {
  return {
    apiKey: typeof env.OPENROUTER_API_KEY === 'string' ? env.OPENROUTER_API_KEY.trim() : '',
    videoModels: parseModelList(env.VIDEO_MODELS, DEFAULT_VIDEO_MODELS),
    textModels: parseModelList(env.TEXT_MODELS, DEFAULT_TEXT_MODELS),
    perHour: positiveInt(env.RATE_LIMIT_PER_HOUR, 12),
    dailyCap: positiveInt(env.DAILY_CAP, 300),
  };
}

/** Cloudflare sets this header itself and a visitor cannot forge it. Locally we use "local". */
export function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || 'local';
}
