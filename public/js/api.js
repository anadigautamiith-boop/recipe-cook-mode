// Talking to our own server. Every failure becomes an ApiError with words a visitor can read.

export class ApiError extends Error {
  constructor(error, status = 0) {
    super(error.message || 'Something went wrong.');
    this.name = 'ApiError';
    this.code = error.code || 'error';
    this.hint = error.hint || null;
    this.canPaste = Boolean(error.can_paste);
    this.retryable = Boolean(error.retryable);
    this.retryAfter = error.retry_after || null;
    this.status = status;
  }
}

async function call(path, init) {
  let res;
  try {
    res = await fetch(path, init);
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw new ApiError(
      {
        code: 'offline',
        message: "We couldn't reach the server.",
        hint: 'Check your internet connection and try again.',
        retryable: true,
      },
      0,
    );
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    // not JSON
  }
  if (!res.ok || !body || body.ok === false) {
    const error =
      body && body.error
        ? body.error
        : { code: 'bad_response', message: 'The server sent something we could not read.', hint: 'Please try again.', retryable: true };
    throw new ApiError(error, res.status);
  }
  return body;
}

/** Ask for a recipe. Pass `url`, `text` or both. */
export function requestRecipe({ url, text, lang, refresh, model, signal }) {
  const body = {};
  if (url) body.url = url;
  if (text) body.text = text;
  if (lang) body.lang = lang;
  if (refresh) body.refresh = true;
  if (model) body.model = model;
  return call('/api/recipe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

/** The owner's setup check. `query` is '', 'ping=1', 'video=1' or both. */
export function requestDiagnose(query = '') {
  return call(`/api/diagnose${query ? `?${query}` : ''}`, { method: 'GET' });
}
