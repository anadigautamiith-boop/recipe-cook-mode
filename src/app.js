// Routes the /api/* requests. Anything else is left for the static site.

import { AppError } from './errors.js';
import { errorResponse } from './http.js';
import { Limiter, TtlCache } from './cache.js';
import { handleRecipe } from './handlers/recipe.js';
import { handleDiagnose } from './handlers/diagnose.js';

export const APP_VERSION = '0.2.1';

const defaultLog = (entry) => console.log(JSON.stringify(entry));

/** Browsers always send Origin on cross-site POSTs. Refuse other websites using our budget. */
function assertSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return;
  let host = null;
  try {
    host = new URL(origin).host;
  } catch {
    // leave null
  }
  if (host !== new URL(request.url).host) {
    throw new AppError('forbidden_origin', 'This request came from a different website.', { status: 403 });
  }
}

/**
 * Build the request handler. The cache and limiter live inside it, so they last as long as
 * the running Worker instance does. Tests pass their own fetch, clock and logger.
 * @returns {(request: Request, env?: object, ctx?: object) => Promise<Response|null>}
 */
export function createHandler({ fetchImpl, now = () => Date.now(), log = defaultLog, cache, limiter } = {}) {
  const deps = {
    fetchImpl: fetchImpl || ((...args) => fetch(...args)),
    now,
    log,
    cache: cache || new TtlCache({ max: 100, ttlMs: 6 * 60 * 60 * 1000 }),
    limiter: limiter || new Limiter(),
  };

  return async function handle(request, env = {}) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return null;
    try {
      if (url.pathname === '/api/recipe') {
        assertSameOrigin(request);
        return await handleRecipe({ request, env, deps });
      }
      if (url.pathname === '/api/diagnose') {
        return await handleDiagnose({ request, env, deps, version: APP_VERSION });
      }
      throw new AppError('not_found', 'That address does not exist.', { status: 404 });
    } catch (err) {
      if (err instanceof AppError) {
        deps.log({
          evt: 'api_error',
          path: url.pathname,
          code: err.code,
          status: err.status,
          detail: err.detail ? String(err.detail).slice(0, 500) : undefined,
        });
      }
      return errorResponse(err);
    }
  };
}
