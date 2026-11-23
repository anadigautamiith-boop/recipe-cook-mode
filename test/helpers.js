// Shared helpers for the tests: a fake network, fake AI replies and request builders.
// No test ever touches the real internet or a real API key.

import { readFileSync } from 'node:fs';

export const sampleRecipe = JSON.parse(
  readFileSync(new URL('./fixtures/sample-recipe.json', import.meta.url), 'utf8'),
);

export const TEST_KEY = 'test-key-not-a-real-key';

export function envWith(extra = {}) {
  return { OPENROUTER_API_KEY: TEST_KEY, ...extra };
}

/** What OpenRouter returns for a successful chat completion. */
export function completion(content, { model = 'google/gemini-2.5-flash', usage, finish = 'stop' } = {}) {
  return {
    id: 'gen-test',
    model,
    choices: [
      {
        index: 0,
        finish_reason: finish,
        message: { role: 'assistant', content: typeof content === 'string' ? content : JSON.stringify(content) },
      },
    ],
    usage: usage ?? { prompt_tokens: 100_000, completion_tokens: 500, total_tokens: 100_500, cost: 0.0012 },
  };
}

export function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function upstreamError(status, message, metadata) {
  return jsonResponse({ error: { code: status, message, ...(metadata ? { metadata } : {}) } }, status);
}

function parseBody(init) {
  if (!init || typeof init.body !== 'string') return null;
  try {
    return JSON.parse(init.body);
  } catch {
    return null;
  }
}

/**
 * A stand-in for fetch. `handler(call, index)` returns a Response, or a plain object
 * (sent back as JSON). Every call is recorded in `fake.calls`.
 */
export function fakeFetch(handler) {
  const calls = [];
  const fake = async (url, init = {}) => {
    const call = { url: String(url), init, body: parseBody(init), headers: init.headers || {} };
    calls.push(call);
    const out = await handler(call, calls.length - 1);
    if (out instanceof Response) return out;
    if (out && typeof out.text === 'function') return out;
    return jsonResponse(out);
  };
  fake.calls = calls;
  fake.openrouterCalls = () => calls.filter((c) => c.url.includes('openrouter.ai'));
  return fake;
}

/** A fake fetch that answers every OpenRouter call from a list, one reply per call. */
export function sequence(replies) {
  return fakeFetch((call, index) => {
    const next = replies[Math.min(index, replies.length - 1)];
    const out = typeof next === 'function' ? next(call, index) : next;
    // A Response body can only be read once, so hand out a fresh copy each time.
    return out instanceof Response ? out.clone() : out;
  });
}

export function post(path, body, headers = {}) {
  return new Request(`https://cook.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

export function get(path, headers = {}) {
  return new Request(`https://cook.test${path}`, { headers });
}

export const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
export const IG = 'https://www.instagram.com/reel/C9xAbCdEfGh/?igsh=abc';

export const noLog = () => {};
