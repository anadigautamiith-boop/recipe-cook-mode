// Cloudflare Worker entry point.
// /api/* is handled by our code; every other address is served from the ./public folder.

import { createHandler } from './app.js';

const handle = createHandler();

export default {
  async fetch(request, env, ctx) {
    const response = await handle(request, env, ctx);
    if (response) return response;
    return env.ASSETS.fetch(request);
  },
};
