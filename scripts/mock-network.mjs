// A pretend internet for local development and screenshots. No key, no cost.
// Special video ids show the awkward cases:
//   aaaaaaaaaaa  -> a video that is not a recipe
//   bbbbbbbbbbb  -> a private/blocked video
//   ccccccccccc  -> the first model answers badly and the second one rescues it
//   ddddddddddd  -> two dishes in one video
//   eeeeeeeeeee  -> a slow video (8 seconds)
// Instagram links whose code contains "Cap" have a readable caption; the rest hit a login wall.

import { readFileSync } from 'node:fs';

const sample = JSON.parse(readFileSync(new URL('../test/fixtures/sample-recipe.json', import.meta.url), 'utf8'));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function completion(content, model, cost = 0.0123) {
  return {
    id: 'gen-mock',
    model,
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: typeof content === 'string' ? content : JSON.stringify(content) },
      },
    ],
    usage: { prompt_tokens: 61_000, completion_tokens: 2_400, total_tokens: 63_400, cost },
  };
}

function twoDishes() {
  const second = structuredClone(sample.recipes[0]);
  second.title = 'Steamed Rice';
  second.summary = 'Plain rice to serve with the stir-fry.';
  second.ingredients = [
    { group: null, name: 'rice', quantity: 1, quantity_max: null, unit: 'cup', amount_text: null, note: 'rinsed', stated: true },
    { group: null, name: 'water', quantity: 1.5, quantity_max: null, unit: 'cup', amount_text: null, note: null, stated: true },
  ];
  second.steps = [
    { text: 'Rinse the rice until the water runs almost clear.', timer_seconds: null, temperature: null, heat: null, done_cue: 'The water is no longer milky.', done_cue_added: true, terms: [], video_t: 215 },
    { text: 'Cook the rice with the water, covered, on low heat.', timer_seconds: 900, temperature: null, heat: 'low', done_cue: null, done_cue_added: false, terms: [], video_t: 240 },
  ];
  second.gaps = [];
  return { ...sample, video_notes: ['Two dishes are cooked in this video: the stir-fry and the rice.'], recipes: [sample.recipes[0], second] };
}

const CAPTION = `<div class="Caption"><a class="CaptionUsername" href="#">some.chef</a><br />Tomato and egg stir-fry for two! 4 eggs, 3 ripe tomatoes, 1 tsp sugar, salt, oil. Beat the eggs with a pinch of salt. Fry on high heat until just set, push aside. Cook the tomato wedges 3 minutes, add sugar and salt, fold the eggs back in.<div class="CaptionComments"></div></div>`;
const LOGIN_WALL = '<html><head><title>Login • Instagram</title></head><body>Log in to continue</body></html>';

export function createMockFetch({ delayMs = 900 } = {}) {
  return async function mockFetch(input, init = {}) {
    const url = String(input);

    if (url.includes('instagram.com')) {
      await sleep(Math.min(delayMs, 300));
      const hasCaption = url.includes('/embed/captioned/') && /Cap/.test(url);
      return new Response(hasCaption ? CAPTION : LOGIN_WALL, { status: 200, headers: { 'content-type': 'text/html' } });
    }

    if (url.includes('openrouter.ai/api/v1/chat/completions')) {
      const body = JSON.parse(init.body);
      const model = body.model;
      const user = body.messages.find((m) => m.role === 'user');
      const parts = Array.isArray(user.content) ? user.content : null;
      const video = parts ? parts.find((p) => p.type === 'video_url') : null;

      // owner's setup checks
      if (!video && typeof user.content === 'string' && user.content.startsWith('Reply with the single word')) {
        await sleep(200);
        return json(completion('OK', model, 0.00002));
      }
      if (video && parts.some((p) => p.type === 'text' && /one short sentence/.test(p.text))) {
        await sleep(600);
        return json(completion('A young man stands in front of elephants at a zoo and talks about them.', model, 0.0004));
      }

      let id = null;
      if (video) id = new URL(video.video_url.url).searchParams.get('v');

      await sleep(id === 'eeeeeeeeeee' ? 8000 : delayMs);

      if (id === 'bbbbbbbbbbb') {
        return json({ error: { code: 403, message: 'Provider returned error', metadata: { raw: 'Video unavailable' } } }, 403);
      }
      if (id === 'aaaaaaaaaaa') {
        return json(
          completion(
            { is_recipe: false, not_recipe_reason: 'This is a travel vlog. Nobody cooks anything in it.', video_notes: [], recipes: [] },
            model,
          ),
        );
      }
      if (id === 'ccccccccccc' && model.endsWith('2.5-flash')) {
        return json(completion('Here is your recipe! {"is_recipe": true, "recipes": [ {"title": ', model, 0.004));
      }
      if (id === 'ddddddddddd') return json(completion(twoDishes(), model, 0.0311));
      return json(completion(sample, model));
    }

    return json({ error: { code: 404, message: `mock network has no route for ${url}` } }, 404);
  };
}
