import test from 'node:test';
import assert from 'node:assert/strict';
import { chatComplete, classifyUpstream, parseModelList } from '../src/openrouter.js';
import { AppError } from '../src/errors.js';
import { completion, fakeFetch, sequence, upstreamError, jsonResponse } from './helpers.js';

const messages = [{ role: 'user', content: 'hello' }];
const base = { apiKey: 'k-test', messages };

test('parseModelList splits, trims and falls back', () => {
  assert.deepEqual(parseModelList(' a/b , c/d ,, ', ['x']), ['a/b', 'c/d']);
  assert.deepEqual(parseModelList('', ['x']), ['x']);
  assert.deepEqual(parseModelList(undefined, ['x']), ['x']);
});

test('sends the key, asks for usage and JSON, and returns text, model and cost', async () => {
  const f = sequence([completion({ a: 1 })]);
  const out = await chatComplete({ ...base, models: ['m1'], fetchImpl: f });
  const call = f.calls[0];
  assert.equal(call.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(call.headers.authorization, 'Bearer k-test');
  assert.equal(call.body.model, 'm1');
  assert.deepEqual(call.body.usage, { include: true });
  assert.deepEqual(call.body.response_format, { type: 'json_object' });
  assert.equal(call.body.temperature, 0.2);
  assert.equal(out.text, '{"a":1}');
  assert.equal(out.requested, 'm1');
  assert.equal(out.usage.cost, 0.0012);
  assert.equal(out.usage.total, 1500);
});

test('jsonMode:false leaves out the JSON setting', async () => {
  const f = sequence([completion('OK')]);
  await chatComplete({ ...base, models: ['m1'], fetchImpl: f, jsonMode: false });
  assert.equal(f.calls[0].body.response_format, undefined);
});

test('a model that rejects the optional settings is retried once without them', async () => {
  const f = sequence([upstreamError(400, 'response_format is not supported'), completion('{"ok":true}')]);
  const out = await chatComplete({ ...base, models: ['m1'], fetchImpl: f });
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[0].body.response_format);
  assert.equal(f.calls[1].body.response_format, undefined);
  assert.equal(f.calls[1].body.reasoning, undefined);
  assert.equal(f.calls[1].body.model, 'm1');
  assert.equal(out.text, '{"ok":true}');
  assert.equal(out.tried.length, 1);
});

test('an unavailable model hands over to the next one', async () => {
  const f = sequence([upstreamError(404, 'No endpoints found for m1'), completion('{"ok":true}', { model: 'm2' })]);
  const out = await chatComplete({ ...base, models: ['m1', 'm2'], fetchImpl: f });
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].body.model, 'm2');
  assert.equal(out.requested, 'm2');
  assert.match(out.tried[0], /^m1/);
});

test('an error that arrives inside a 200 response is handled like any other', async () => {
  const f = sequence([jsonResponse({ error: { code: 429, message: 'slow down' } }, 200), completion('{"ok":true}')]);
  const out = await chatComplete({ ...base, models: ['m1', 'm2'], fetchImpl: f });
  assert.equal(out.requested, 'm2');
});

test('402 (out of credit) and 401 (bad key) stop immediately', async () => {
  for (const [status, code] of [
    [402, 'budget_exhausted'],
    [401, 'not_configured'],
  ]) {
    const f = sequence([upstreamError(status, 'nope'), completion('{}')]);
    await assert.rejects(
      chatComplete({ ...base, models: ['m1', 'm2'], fetchImpl: f }),
      (err) => err instanceof AppError && err.code === code,
    );
    assert.equal(f.calls.length, 1, `status ${status} should not try another model`);
  }
});

test('a video the model cannot open is reported as such without trying other models', async () => {
  const f = sequence([upstreamError(403, 'Provider returned error', { raw: 'Video unavailable' })]);
  await assert.rejects(
    chatComplete({ ...base, models: ['m1', 'm2'], fetchImpl: f }),
    (err) => err.code === 'video_unreadable' && err.canPaste === true && err.status === 422,
  );
  assert.equal(f.calls.length, 1);
});

test('busy on every model gives a retryable error', async () => {
  const f = sequence([upstreamError(429, 'rate limited')]);
  await assert.rejects(
    chatComplete({ ...base, models: ['m1', 'm2'], fetchImpl: f }),
    (err) => err.code === 'upstream_busy' && err.retryable === true,
  );
  assert.equal(f.calls.length, 2);
});

test('a slow upstream becomes a timeout error', async () => {
  const f = fakeFetch(() => {
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  });
  await assert.rejects(
    chatComplete({ ...base, models: ['m1', 'm2'], fetchImpl: f, timeoutMs: 5 }),
    (err) => err.code === 'timeout' && err.status === 504 && err.retryable,
  );
  assert.equal(f.calls.length, 1);
});

test('a network failure moves on to the next model', async () => {
  const f = fakeFetch((call, i) => {
    if (i === 0) throw new TypeError('fetch failed');
    return completion('{"ok":true}', { model: 'm2' });
  });
  const out = await chatComplete({ ...base, models: ['m1', 'm2'], fetchImpl: f });
  assert.equal(out.requested, 'm2');
  assert.match(out.tried[0], /network error/);
});

test('reply content given as a list of parts is joined', async () => {
  const reply = {
    id: 'x',
    model: 'm1',
    choices: [{ finish_reason: 'stop', message: { content: [{ type: 'text', text: '{"a"' }, { type: 'text', text: ':1}' }] } }],
  };
  const out = await chatComplete({ ...base, models: ['m1'], fetchImpl: sequence([reply]) });
  assert.equal(out.text, '{"a":1}');
  assert.equal(out.usage.cost, null, 'no cost reported means null, not zero');
});

test('an empty reply is an error the visitor can act on', async () => {
  const f = sequence([completion('   ')]);
  await assert.rejects(
    chatComplete({ ...base, models: ['m1'], fetchImpl: f }),
    (err) => err.code === 'bad_output' && err.canPaste === true,
  );
});

test('no models configured is a setup problem', async () => {
  await assert.rejects(
    chatComplete({ ...base, models: [], fetchImpl: sequence([completion('{}')]) }),
    (err) => err.code === 'not_configured',
  );
});

test('classifyUpstream picks a sensible visitor message for each kind of failure', () => {
  const code = (status, msg) => classifyUpstream(status, msg).code;
  assert.equal(code(404, 'No endpoints found for google/x'), 'model_unavailable');
  assert.equal(code(400, 'model does not support video input'), 'model_unavailable');
  assert.equal(code(400, 'maximum context length exceeded'), 'too_long');
  assert.equal(code(400, 'Cannot fetch content from the provided URL'), 'video_unreadable');
  assert.equal(code(400, 'The video is private'), 'video_unreadable');
  assert.equal(code(403, 'whatever'), 'video_unreadable');
  assert.equal(code(500, 'internal error'), 'upstream_error');
  assert.equal(classifyUpstream(500, 'x').retryable, true);
  assert.equal(classifyUpstream(401, 'x').status, 500);
  assert.equal(classifyUpstream(402, 'x').status, 503);
});
