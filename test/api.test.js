// End-to-end tests of the API, with the network and the AI replaced by fakes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../src/app.js';
import {
  IG,
  TEST_KEY,
  YT,
  completion,
  envWith,
  fakeFetch,
  get,
  jsonResponse,
  noLog,
  post,
  sampleRecipe,
  sequence,
  upstreamError,
} from './helpers.js';

function makeApp(fetchImpl, extra = {}) {
  let clock = Date.UTC(2026, 10, 23, 12, 0, 0);
  const app = createHandler({ fetchImpl, log: noLog, now: () => clock, ...extra });
  return { app, tick: (ms) => (clock += ms) };
}

const CAPTION_PAGE = `<div class="Caption"><a class="CaptionUsername" href="#">chef</a><br />Tomato egg stir-fry! 4 eggs, 3 tomatoes, 1 tsp sugar. Beat eggs, fry 20 sec, set aside. Cook tomatoes 3 min, add eggs back.<div class="CaptionComments"></div></div>`;
const LOGIN_WALL = '<html><title>Login • Instagram</title></html>';
const html = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html' } });

async function run(app, request, env = envWith()) {
  const res = await app(request, env);
  return { res, body: await res.json() };
}

// ---- the happy paths -------------------------------------------------------------------

test('a YouTube link goes straight to the video model and comes back as a clean recipe', async () => {
  const f = sequence([completion(sampleRecipe)]);
  const { app } = makeApp(f);
  const { res, body } = await run(app, post('/api/recipe', { url: YT }));

  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.result.recipes[0].title, 'Tomato and Egg Stir-Fry');
  assert.equal(body.result.recipes[0].steps[0].video_t, 22);
  assert.equal(body.meta.route, 'youtube-video');
  assert.equal(body.meta.platform, 'youtube');
  assert.equal(body.meta.video_id, 'dQw4w9WgXcQ');
  assert.equal(body.meta.cost_usd, 0.0012);
  assert.equal(body.meta.cached, false);
  assert.equal(body.meta.stats.steps, 8);
  assert.equal(body.source.type, 'youtube');

  assert.equal(f.calls.length, 1, 'one AI call, nothing else');
  const sent = f.calls[0].body;
  assert.equal(sent.model, 'google/gemini-2.5-flash');
  const user = sent.messages.find((m) => m.role === 'user');
  const video = user.content.find((p) => p.type === 'video_url');
  assert.equal(video.video_url.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(f.calls[0].headers.authorization, `Bearer ${TEST_KEY}`);
  assert.ok(!JSON.stringify(body).includes(TEST_KEY), 'the key never appears in a response');
});

test('the same link is not paid for twice, and refresh forces a new run', async () => {
  const f = sequence([completion(sampleRecipe)]);
  const { app } = makeApp(f);
  await run(app, post('/api/recipe', { url: YT }));

  const again = await run(app, post('/api/recipe', { url: 'https://youtu.be/dQw4w9WgXcQ?si=zzz' }));
  assert.equal(f.calls.length, 1, 'a different spelling of the same video is a cache hit');
  assert.equal(again.body.meta.cached, true);
  assert.equal(again.body.meta.cost_usd, 0);
  assert.equal(again.body.meta.original_cost_usd, 0.0012);

  const other = await run(app, post('/api/recipe', { url: YT, lang: 'es' }));
  assert.equal(f.calls.length, 2, 'another language is a different recipe');
  assert.equal(other.body.meta.cached, false);

  const fresh = await run(app, post('/api/recipe', { url: YT, refresh: true }));
  assert.equal(f.calls.length, 3);
  assert.equal(fresh.body.meta.cached, false);
});

test('pasted text uses the cheap text model and never claims video timestamps', async () => {
  const f = sequence([completion(sampleRecipe, { model: 'google/gemini-2.5-flash-lite' })]);
  const { app } = makeApp(f);
  const text = 'Tomato egg stir fry. 4 eggs, 3 tomatoes, 1 tsp sugar, salt. Beat eggs, fry, set aside. Cook tomatoes, add eggs.';
  const { res, body } = await run(app, post('/api/recipe', { text }));
  assert.equal(res.status, 200);
  assert.equal(body.meta.route, 'pasted-text');
  assert.equal(body.meta.platform, null);
  assert.ok(body.result.recipes[0].steps.every((s) => s.video_t === null));
  const sent = f.calls[0].body;
  assert.equal(sent.model, 'google/gemini-2.5-flash-lite');
  const user = sent.messages.find((m) => m.role === 'user');
  assert.equal(typeof user.content, 'string');
  assert.ok(user.content.includes('<source_text>'));
  assert.ok(!JSON.stringify(sent).includes('video_url'));
});

test('an Instagram reel with a readable caption is built from the caption, and says so', async () => {
  const f = fakeFetch((call) => (call.url.includes('instagram.com') ? html(CAPTION_PAGE) : completion(sampleRecipe)));
  const { app } = makeApp(f);
  const { res, body } = await run(app, post('/api/recipe', { url: IG }));
  assert.equal(res.status, 200);
  assert.equal(body.meta.route, 'instagram-caption');
  assert.equal(body.meta.platform, 'instagram');
  assert.equal(body.source.type, 'instagram-caption');
  assert.equal(body.source.caption_from, 'embed');
  assert.ok(f.calls[0].url.includes('/reel/C9xAbCdEfGh/embed/captioned/'));
  const aiCall = f.openrouterCalls()[0];
  assert.ok(!JSON.stringify(aiCall.body).includes('video_url'));
  assert.ok(JSON.stringify(aiCall.body).includes('Tomato egg stir-fry'));
});

test('an Instagram reel with no readable caption asks the visitor to paste, and spends nothing', async () => {
  const f = fakeFetch(() => html(LOGIN_WALL));
  const { app } = makeApp(f);
  const { res, body } = await run(app, post('/api/recipe', { url: IG }));
  assert.equal(res.status, 422);
  assert.equal(body.error.code, 'needs_text');
  assert.equal(body.error.can_paste, true);
  assert.equal(f.openrouterCalls().length, 0);
});

test('a caption that has no recipe in it is explained, not turned into nonsense', async () => {
  const f = fakeFetch((call) =>
    call.url.includes('instagram.com')
      ? html('<div class="Caption"><a class="CaptionUsername" href="#">x</a><br />New collab dropping this Friday, link in bio, stay tuned for more from the team!</div>')
      : completion({ is_recipe: false, not_recipe_reason: 'The caption is an announcement.', recipes: [] }),
  );
  const { app } = makeApp(f);
  const { res, body } = await run(app, post('/api/recipe', { url: IG }));
  assert.equal(res.status, 422);
  assert.equal(body.error.code, 'caption_not_recipe');
  assert.equal(body.error.can_paste, true);
});

test('a video that is not a recipe is reported plainly and is not cached', async () => {
  const f = sequence([completion({ is_recipe: false, not_recipe_reason: 'This is a cat video.', recipes: [] })]);
  const { app } = makeApp(f);
  const first = await run(app, post('/api/recipe', { url: YT }));
  assert.equal(first.res.status, 200);
  assert.equal(first.body.result.is_recipe, false);
  assert.equal(first.body.result.not_recipe_reason, 'This is a cat video.');
  await run(app, post('/api/recipe', { url: YT }));
  assert.equal(f.calls.length, 2);
});

// ---- when the AI misbehaves --------------------------------------------------------------

test('a model that answers with broken JSON is skipped and the next model is used', async () => {
  const f = sequence([
    completion('Sorry, I cannot do that as JSON'),
    completion(sampleRecipe, { model: 'google/gemini-2.5-flash-lite', usage: { prompt_tokens: 100_000, completion_tokens: 400, total_tokens: 100_400, cost: 0.0004 } }),
  ]);
  const { app } = makeApp(f);
  const { res, body } = await run(app, post('/api/recipe', { url: YT }));
  assert.equal(res.status, 200);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].body.model, 'google/gemini-2.5-flash');
  assert.equal(f.calls[1].body.model, 'google/gemini-2.5-flash-lite');
  assert.equal(body.meta.model, 'google/gemini-2.5-flash-lite');
  assert.equal(body.meta.cost_usd, 0.0016, 'both attempts are paid for, so both are counted');
  assert.ok(body.meta.fallbacks.some((n) => /unreadable reply/.test(n)));
});

test('if every model gives unreadable output the visitor is offered the paste route', async () => {
  const f = sequence([completion('nope')]);
  const { app } = makeApp(f);
  const { res, body } = await run(app, post('/api/recipe', { url: YT }));
  assert.equal(res.status, 502);
  assert.equal(body.error.code, 'bad_output');
  assert.equal(body.error.can_paste, true);
  assert.equal(body.error.retryable, true);
});

test('output that was cut off says the video is too long', async () => {
  const f = sequence([completion('{"is_recipe": true, "recipes": [{"title": "Big", "steps": [{"text": "Do', { finish: 'length' })]);
  const { app } = makeApp(f);
  const { res, body } = await run(app, post('/api/recipe', { url: YT }));
  assert.equal(res.status, 422);
  assert.equal(body.error.code, 'too_long');
});

test('a cut-off first attempt is recorded with how much it wrote, and the next model finishes the job', async () => {
  const f = sequence([
    completion('{"is_recipe": true, "recipes": [{"title": "Big", "steps": [{"text": "Do', {
      finish: 'length',
      usage: { prompt_tokens: 100_000, completion_tokens: 16_000, total_tokens: 116_000, cost: 0.05 },
    }),
    completion(sampleRecipe, { model: 'google/gemini-2.5-flash-lite' }),
  ]);
  const { app } = makeApp(f);
  const { res, body } = await run(app, post('/api/recipe', { url: YT }));
  assert.equal(res.status, 200);
  assert.equal(f.calls[0].body.max_tokens, 16_000);
  assert.ok(body.meta.fallbacks.some((n) => /cut off after 16000 output tokens/.test(n)), body.meta.fallbacks.join(' | '));
});

test('an unavailable first model falls back to the second', async () => {
  const f = sequence([
    upstreamError(404, 'No endpoints found for google/gemini-2.5-flash'),
    completion(sampleRecipe, { model: 'google/gemini-2.5-flash-lite' }),
  ]);
  const { app } = makeApp(f);
  const { res, body } = await run(app, post('/api/recipe', { url: YT }));
  assert.equal(res.status, 200);
  assert.equal(body.meta.model, 'google/gemini-2.5-flash-lite');
});

test('a private or blocked video is explained and the paste route is offered', async () => {
  const f = sequence([upstreamError(400, 'Provider returned error', { raw: 'Cannot fetch content from the provided URL' })]);
  const { app } = makeApp(f);
  const { res, body } = await run(app, post('/api/recipe', { url: YT }));
  assert.equal(res.status, 422);
  assert.equal(body.error.code, 'video_unreadable');
  assert.equal(body.error.can_paste, true);
  assert.ok(!JSON.stringify(body).includes('Provider returned error'), 'raw upstream text is not shown to visitors');
});

test('running out of AI budget and a busy AI service are different messages', async () => {
  const broke = await run(makeApp(sequence([upstreamError(402, 'Insufficient credits')])).app, post('/api/recipe', { url: YT }));
  assert.equal(broke.res.status, 503);
  assert.equal(broke.body.error.code, 'budget_exhausted');

  const busy = await run(makeApp(sequence([upstreamError(429, 'rate limited')])).app, post('/api/recipe', { url: YT }));
  assert.equal(busy.res.status, 503);
  assert.equal(busy.body.error.code, 'upstream_busy');
  assert.equal(busy.body.error.retryable, true);
});

test('a bad API key is reported as a setup problem without leaking anything', async () => {
  const { app } = makeApp(sequence([upstreamError(401, `No auth credentials found for ${TEST_KEY}`)]));
  const { res, body } = await run(app, post('/api/recipe', { url: YT }));
  assert.equal(res.status, 500);
  assert.equal(body.error.code, 'not_configured');
  assert.ok(!JSON.stringify(body).includes(TEST_KEY));
});

// ---- checking the input -------------------------------------------------------------------

test('bad input gets a plain message and costs nothing', async () => {
  const f = sequence([completion(sampleRecipe)]);
  const { app } = makeApp(f);
  const cases = [
    [{}, 400, 'missing_input'],
    [{ url: 'https://www.tiktok.com/@a/video/1' }, 400, 'unsupported_site'],
    [{ url: 'not a link' }, 400, 'bad_url'],
    [{ url: 'https://www.youtube.com/playlist?list=PL1' }, 400, 'bad_url'],
    [{ text: 'too short' }, 400, 'text_too_short'],
    [{ text: 'x'.repeat(20_001) }, 413, 'text_too_long'],
    [{ url: YT, model: 'evil/model' }, 400, 'bad_model'],
  ];
  for (const [input, status, code] of cases) {
    const { res, body } = await run(app, post('/api/recipe', input));
    assert.equal(res.status, status, JSON.stringify(input).slice(0, 60));
    assert.equal(body.error.code, code, JSON.stringify(input).slice(0, 60));
    assert.equal(body.ok, false);
  }
  assert.equal(f.calls.length, 0);
});

test('a bad link next to pasted text still works from the text', async () => {
  const f = sequence([completion(sampleRecipe)]);
  const { app } = makeApp(f);
  const text = 'Tomato egg stir fry. 4 eggs, 3 tomatoes, 1 tsp sugar, salt. Beat eggs, fry, set aside. Cook tomatoes, add eggs.';
  const { res, body } = await run(app, post('/api/recipe', { url: 'https://example.com/x', text }));
  assert.equal(res.status, 200);
  assert.equal(body.meta.route, 'pasted-text');
});

test('the model can be chosen, but only from the configured list', async () => {
  const f = sequence([completion(sampleRecipe, { model: 'google/gemini-2.5-flash-lite' })]);
  const { app } = makeApp(f);
  await run(app, post('/api/recipe', { url: YT, model: 'google/gemini-2.5-flash-lite' }));
  assert.equal(f.calls[0].body.model, 'google/gemini-2.5-flash-lite');
});

test('wrong method, wrong content type, broken or oversized bodies are refused', async () => {
  const { app } = makeApp(sequence([completion(sampleRecipe)]));
  assert.equal((await run(app, get('/api/recipe'))).res.status, 405);

  const wrongType = new Request('https://cook.test/api/recipe', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal((await run(app, wrongType)).res.status, 415);

  const broken = new Request('https://cook.test/api/recipe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
  assert.equal((await run(app, broken)).res.status, 400);

  const huge = new Request('https://cook.test/api/recipe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'x'.repeat(50_000) }),
  });
  assert.equal((await run(app, huge)).res.status, 413);
});

test('requests from another website are refused; our own site is fine', async () => {
  const f = sequence([completion(sampleRecipe)]);
  const { app } = makeApp(f);
  const evil = await run(app, post('/api/recipe', { url: YT }, { origin: 'https://evil.example' }));
  assert.equal(evil.res.status, 403);
  assert.equal(evil.body.error.code, 'forbidden_origin');
  assert.equal(f.calls.length, 0);
  const ours = await run(app, post('/api/recipe', { url: YT }, { origin: 'https://cook.test' }));
  assert.equal(ours.res.status, 200);
});

test('without the secret the server says so instead of calling anything', async () => {
  const f = sequence([completion(sampleRecipe)]);
  const { app } = makeApp(f);
  const { res, body } = await run(app, post('/api/recipe', { url: YT }), {});
  assert.equal(res.status, 500);
  assert.equal(body.error.code, 'not_configured');
  assert.equal(f.calls.length, 0);
});

// ---- protecting the budget ----------------------------------------------------------------

test('each visitor has an hourly allowance; cached answers are free', async () => {
  const f = sequence([completion(sampleRecipe)]);
  const { app } = makeApp(f);
  const env = envWith({ RATE_LIMIT_PER_HOUR: '2' });
  const ip = { 'cf-connecting-ip': '1.2.3.4' };

  for (let i = 0; i < 2; i += 1) {
    const ok = await run(app, post('/api/recipe', { url: YT, refresh: true }, ip), env);
    assert.equal(ok.res.status, 200);
  }
  const blocked = await run(app, post('/api/recipe', { url: YT, refresh: true }, ip), env);
  assert.equal(blocked.res.status, 429);
  assert.equal(blocked.body.error.code, 'rate_limited');
  assert.ok(Number(blocked.res.headers.get('retry-after')) > 0);

  const cached = await run(app, post('/api/recipe', { url: YT }, ip), env);
  assert.equal(cached.res.status, 200, 'a cached recipe costs nothing, so it is never blocked');
  assert.equal(cached.body.meta.cached, true);

  const other = await run(app, post('/api/recipe', { url: YT, refresh: true }, { 'cf-connecting-ip': '5.6.7.8' }), env);
  assert.equal(other.res.status, 200);
});

test('a daily cap protects the whole budget', async () => {
  const f = sequence([completion(sampleRecipe)]);
  const { app } = makeApp(f);
  const env = envWith({ DAILY_CAP: '1' });
  assert.equal((await run(app, post('/api/recipe', { url: YT }), env)).res.status, 200);
  const second = await run(app, post('/api/recipe', { url: 'https://youtu.be/aaaaaaaaaaa' }), env);
  assert.equal(second.res.status, 429);
  assert.equal(second.body.error.code, 'daily_cap');
});

// ---- a model that never received the video -------------------------------------------------
// Found on the live app: a private video came back as a confident, invented recipe. The usage
// report gave it away (1,103 prompt tokens, which is our instructions and nothing else).

const NEVER_SAW_VIDEO = { prompt_tokens: 1_103, completion_tokens: 4_459, total_tokens: 5_562, cost: 0.0115 };

test('a reply that never received the video is refused, not shown as a recipe', async () => {
  const f = sequence([completion(sampleRecipe, { usage: NEVER_SAW_VIDEO })]);
  const { app } = makeApp(f);
  const first = await run(app, post('/api/recipe', { url: YT }));
  assert.equal(first.res.status, 422);
  assert.equal(first.body.error.code, 'video_unreadable');
  assert.equal(first.body.error.message, "We couldn't open that video.");
  assert.equal(first.body.error.can_paste, true);
  assert.equal(f.calls.length, 2, 'the second model is tried before giving up');
  assert.ok(!JSON.stringify(first.body).includes('Tomato and Egg Stir-Fry'), 'the invented recipe is never shown');

  await run(app, post('/api/recipe', { url: YT }));
  assert.equal(f.calls.length, 4, 'a refused answer is not cached');
});

test('if the first model never saw the video but the next one did, the next one is used', async () => {
  const f = sequence([
    completion(sampleRecipe, { usage: NEVER_SAW_VIDEO }),
    completion(sampleRecipe, { model: 'google/gemini-2.5-flash-lite' }),
  ]);
  const { app } = makeApp(f);
  const { res, body } = await run(app, post('/api/recipe', { url: YT }));
  assert.equal(res.status, 200);
  assert.equal(body.meta.model, 'google/gemini-2.5-flash-lite');
  assert.ok(body.meta.fallbacks.some((n) => /video was not read/.test(n)));
});

test('the check does not apply to pasted text, whose prompts are small', async () => {
  const small = { prompt_tokens: 800, completion_tokens: 400, total_tokens: 1_200, cost: 0.0004 };
  const f = sequence([completion(sampleRecipe, { model: 'google/gemini-2.5-flash-lite', usage: small })]);
  const { app } = makeApp(f);
  const text = 'Tomato egg stir fry. 4 eggs, 3 tomatoes, 1 tsp sugar, salt. Beat eggs, fry, set aside. Cook tomatoes, add eggs.';
  const { res } = await run(app, post('/api/recipe', { text }));
  assert.equal(res.status, 200);
});

test('step timestamps later than the video can be are hidden, because none can be trusted', async () => {
  // The numbers are from a real run: a video of about 10 minutes whose steps were put at 531 s and 3,115 s.
  const wrong = structuredClone(sampleRecipe);
  const times = [531, 534, 3115, 4171, 4184, 4190, 4195, 4199];
  wrong.recipes[0].steps.forEach((step, i) => (step.video_t = times[i] ?? null));
  const usage = { prompt_tokens: 180_155, completion_tokens: 6_000, total_tokens: 186_155, cost: 0.03 };
  const f = sequence([completion(wrong, { usage })]);
  const { app } = makeApp(f);
  const { res, body } = await run(app, post('/api/recipe', { url: YT }));
  assert.equal(res.status, 200);
  assert.ok(body.result.recipes[0].steps.every((step) => step.video_t === null));
  assert.ok(body.meta.fallbacks.some((n) => /timestamps hidden/.test(n)));
});

// ---- diagnose --------------------------------------------------------------------------------

test('diagnose shows settings without spending anything or revealing the key', async () => {
  const f = sequence([completion('OK')]);
  const { app } = makeApp(f);
  const { res, body } = await run(app, get('/api/diagnose'));
  assert.equal(res.status, 200);
  assert.equal(body.config.has_key, true);
  assert.deepEqual(body.config.video_models, ['google/gemini-2.5-flash', 'google/gemini-2.5-flash-lite']);
  assert.equal(body.config.rate_limit_per_hour, 12);
  assert.deepEqual(body.checks, []);
  assert.equal(f.calls.length, 0);
  assert.ok(!JSON.stringify(body).includes(TEST_KEY));

  const noKey = await run(app, get('/api/diagnose'), {});
  assert.equal(noKey.body.config.has_key, false);
});

test('diagnose?ping=1 tests each configured model once', async () => {
  const f = sequence([completion('OK')]);
  const { app } = makeApp(f);
  const { body } = await run(app, get('/api/diagnose?ping=1'));
  assert.equal(body.ok, true);
  assert.equal(body.checks.length, 2);
  assert.ok(body.checks.every((c) => c.ok && c.reply === 'OK'));
  assert.equal(f.calls.length, 2);
});

test('diagnose?video=1 sends a sample YouTube clip to each video model', async () => {
  const f = sequence([completion('A man at a zoo talks about elephants.')]);
  const { app } = makeApp(f);
  const { body } = await run(app, get('/api/diagnose?video=1'));
  assert.equal(body.ok, true);
  const sent = f.calls[0].body.messages[0].content.find((p) => p.type === 'video_url');
  assert.equal(sent.video_url.url, 'https://www.youtube.com/watch?v=jNQXAC9IVRw');
});

test('diagnose?video=1 fails a model that answers without ever receiving the clip', async () => {
  const f = sequence([completion('A man talks about elephants.', { usage: { prompt_tokens: 40, completion_tokens: 12, total_tokens: 52, cost: 0.00001 } })]);
  const { app } = makeApp(f);
  const { body } = await run(app, get('/api/diagnose?video=1'));
  assert.equal(body.ok, false);
  assert.ok(body.checks.every((c) => !c.ok && c.problem === 'video_unreadable'));
});

test('diagnose says which check failed and why, in terms the owner can act on', async () => {
  const f = fakeFetch((call) =>
    call.body.model.endsWith('lite') ? upstreamError(404, 'No endpoints found for lite') : completion('OK'),
  );
  const { app } = makeApp(f);
  const { body } = await run(app, get('/api/diagnose?ping=1'));
  assert.equal(body.ok, false);
  const bad = body.checks.find((c) => !c.ok);
  assert.equal(bad.model, 'google/gemini-2.5-flash-lite');
  assert.equal(bad.problem, 'model_unavailable');
  assert.match(bad.detail, /No endpoints found/);

  const missing = await run(app, get('/api/diagnose?ping=1'), {});
  assert.equal(missing.body.ok, false);
  assert.equal(missing.body.checks[0].name, 'key');
});

// ---- plumbing -------------------------------------------------------------------------------------

test('only /api/* is handled here; other addresses fall through to the static site', async () => {
  const { app } = makeApp(sequence([completion(sampleRecipe)]));
  assert.equal(await app(get('/'), envWith()), null);
  assert.equal(await app(get('/css/app.css'), envWith()), null);
  const missing = await run(app, get('/api/nothing'));
  assert.equal(missing.res.status, 404);
  assert.equal(missing.body.error.code, 'not_found');
});

test('every API response is JSON, uncached and not sniffable', async () => {
  const { app } = makeApp(sequence([completion(sampleRecipe)]));
  const res = await app(post('/api/recipe', { url: YT }), envWith());
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('an unexpected crash returns a generic message and leaks nothing', async () => {
  const boom = {
    get() {
      throw new Error(`secret internals ${TEST_KEY}`);
    },
    set() {},
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    const { app } = makeApp(sequence([completion(sampleRecipe)]), { cache: boom });
    const { res, body } = await run(app, post('/api/recipe', { url: YT }));
    assert.equal(res.status, 500);
    assert.equal(body.error.code, 'internal');
    assert.ok(!JSON.stringify(body).includes('secret internals'));
    assert.ok(!JSON.stringify(body).includes(TEST_KEY));
  } finally {
    console.error = originalError;
  }
});

test('error details go to the log, never to the visitor', async () => {
  const logs = [];
  const { app } = makeApp(sequence([upstreamError(400, 'Provider returned error', { raw: 'Cannot fetch content' })]), {
    log: (entry) => logs.push(entry),
  });
  const { body } = await run(app, post('/api/recipe', { url: YT }));
  assert.ok(!JSON.stringify(body).includes('Cannot fetch'));
  const entry = logs.find((l) => l.evt === 'api_error');
  assert.equal(entry.code, 'video_unreadable');
  assert.match(entry.detail, /Cannot fetch content/);
  assert.ok(!JSON.stringify(logs).includes(TEST_KEY));
});

// keep a reference so an unused-import lint would not complain if one is ever added
void jsonResponse;
