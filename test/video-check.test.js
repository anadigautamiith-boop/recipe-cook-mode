// The checks that catch an AI that answers without having seen the video.
// The numbers in these tests come from real runs on the live app.

import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateVideoSeconds, latestPlausibleSecond, MIN_VIDEO_PROMPT_TOKENS, videoUnreadableError, videoWasRead } from '../src/video-check.js';
import { dropImplausibleTimestamps, normalizeResult, restatesStep } from '../src/schema.js';

test('only our instructions were billed: the video was not read', () => {
  assert.equal(videoWasRead(1_103), false); // the private video that got an invented recipe
  assert.equal(videoWasRead(MIN_VIDEO_PROMPT_TOKENS - 1), false);
});

test('a real video makes the prompt much bigger: the video was read', () => {
  assert.equal(videoWasRead(MIN_VIDEO_PROMPT_TOKENS), true);
  assert.equal(videoWasRead(6_800), true); // a 19-second clip
  assert.equal(videoWasRead(18_789), true); // a 60-second Short
  assert.equal(videoWasRead(116_052), true);
});

test('when the service reports no token count we do not guess', () => {
  for (const value of [null, undefined, NaN, '12000']) assert.equal(videoWasRead(value), null);
});

test('the length of the video is judged from what it cost', () => {
  assert.ok(Math.abs(estimateVideoSeconds(18_789) - 61) < 3, 'a one-minute Short');
  assert.ok(Math.abs(estimateVideoSeconds(6_800) - 19.7) < 2, 'a 19-second clip');
  assert.equal(estimateVideoSeconds(null), null);
  assert.equal(estimateVideoSeconds(500), 0);
});

test('a step can sit a little past the estimated end, but not far past it', () => {
  assert.ok(latestPlausibleSecond(18_789) > 55, 'the Short really did have a step at 51 s');
  assert.ok(latestPlausibleSecond(180_155) < 3_000, 'a ten-minute video has no step at 3,115 s');
  assert.equal(latestPlausibleSecond(undefined), null);
});

test('the error says what to do next', () => {
  const err = videoUnreadableError('detail');
  assert.equal(err.code, 'video_unreadable');
  assert.equal(err.canPaste, true);
  assert.match(err.hint, /public link/);
});

// ---- timestamps ------------------------------------------------------------------------------

const recipeWith = (times) => ({ recipes: [{ steps: times.map((t) => ({ video_t: t })) }] });

test('timestamps inside the video are kept', () => {
  const result = recipeWith([0, 1, 2, 4, 6, 51]);
  assert.equal(dropImplausibleTimestamps(result, latestPlausibleSecond(18_789)), 0);
  assert.deepEqual(result.recipes[0].steps.map((s) => s.video_t), [0, 1, 2, 4, 6, 51]);
});

test('one impossible timestamp removes them all', () => {
  const result = { recipes: [recipeWith([531, 534, 547]).recipes[0], recipeWith([3115, 3116]).recipes[0]] };
  const removed = dropImplausibleTimestamps(result, latestPlausibleSecond(180_155));
  assert.equal(removed, 5);
  assert.ok(result.recipes.every((r) => r.steps.every((s) => s.video_t === null)));
});

test('with no estimate, timestamps are left alone', () => {
  const result = recipeWith([10, 99_999]);
  assert.equal(dropImplausibleTimestamps(result, null), 0);
  assert.equal(result.recipes[0].steps[1].video_t, 99_999);
});

// ---- "done when" hints that only repeat the step -----------------------------------------------

test('a hint that repeats the step is noise', () => {
  const noise = [
    ['Rice is added to the pan.', 'Add the cooked rice to the pan with the vegetables.'],
    ['French beans are added.', 'Add French beans and stir-fry.'],
    ['Egg parcel is placed on rice.', 'Carefully place the cooked egg parcel on top of the fried rice.'],
    ['golden brown', 'Toast two slices of bread until golden brown.'],
  ];
  for (const [cue, step] of noise) assert.equal(restatesStep(cue, step), true, cue);
});

test('a hint that tells the cook what to look for is kept', () => {
  const useful = [
    ['The oil should shimmer slightly.', 'Heat olive oil in a large pan over medium-high heat.'],
    ['The dough should be smooth and springy when pressed.', 'Knead the dough on the work surface until it forms a smooth, elastic ball.'],
    ['The sauce should be glossy and cling to the ingredients.', 'Stir constantly until the sauce thickens and coats everything.'],
    ['Chili powder dissolves in the ghee.', 'Add 1 dried red chili and 1/4 tsp chili powder. Stir quickly.'],
    ['The chicken should no longer be pink inside.', 'Add the marinated chicken to the hot pan and stir-fry until cooked through and lightly browned.'],
  ];
  for (const [cue, step] of useful) assert.equal(restatesStep(cue, step), false, cue);
});

test('a hint with no real words in it is dropped', () => {
  assert.equal(restatesStep('It is done.', 'Stir well.'), true);
});

test('the checker removes a repeating hint and keeps a useful one', () => {
  const out = normalizeResult({
    is_recipe: true,
    recipes: [
      {
        title: 'Fried rice',
        ingredients: [],
        steps: [
          { text: 'Add the cooked rice to the pan with the vegetables.', done_cue: 'Rice is added to the pan.', done_cue_added: true },
          { text: 'Heat oil in a pan over medium-high heat.', done_cue: 'The oil should shimmer slightly.', done_cue_added: true },
        ],
      },
    ],
  });
  const [first, second] = out.recipes[0].steps;
  assert.equal(first.done_cue, null);
  assert.equal(first.done_cue_added, false);
  assert.equal(second.done_cue, 'The oil should shimmer slightly.');
  assert.equal(second.done_cue_added, true);
});
