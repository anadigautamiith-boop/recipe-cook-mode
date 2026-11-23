import { AppError } from './errors.js';

const BASE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, ...extraHeaders },
  });
}

/** Turn any thrown value into a JSON response. Unknown errors never leak details. */
export function errorResponse(err) {
  if (err instanceof AppError) {
    const headers = err.retryAfter ? { 'retry-after': String(err.retryAfter) } : {};
    return json(err.toBody(), err.status, headers);
  }
  console.error(JSON.stringify({ evt: 'unhandled', message: String(err?.message || err) }));
  return json(
    {
      ok: false,
      error: {
        code: 'internal',
        message: 'Something went wrong on our side.',
        hint: 'Please try again in a moment.',
        can_paste: false,
        retryable: true,
        retry_after: null,
      },
    },
    500,
  );
}

/** Read a small JSON body, refusing anything that is not JSON or is too large. */
export async function readJsonBody(request, maxChars = 40_000) {
  const type = (request.headers.get('content-type') || '').toLowerCase();
  if (!type.includes('application/json')) {
    throw new AppError('bad_request', 'The request must be JSON.', { status: 415 });
  }
  const text = await request.text();
  if (text.length > maxChars) {
    throw new AppError('too_large', 'That request is too large.', {
      status: 413,
      hint: 'Paste a shorter piece of text.',
    });
  }
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value;
  } catch {
    throw new AppError('bad_request', 'The request was not valid JSON.', { status: 400 });
  }
}
