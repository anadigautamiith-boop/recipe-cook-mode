// Did the AI really receive the video?
//
// A model that is handed a YouTube link it cannot open (private, removed, blocked) may still
// answer, and answer with confidence, by making a recipe up. The usage report gives it away.
// A video is billed at roughly 290 tokens for every second, so a reply that was billed for little
// more than our own instructions never saw one.
//
// The numbers come from real runs on the live app: the instructions alone cost 1,103 tokens,
// a 19-second clip about 6,900, and a 60-second Short about 18,800.

import { AppError } from './errors.js';

/** About what our instructions cost on their own, before any video is added. */
export const INSTRUCTION_TOKENS = 1100;

/** What one second of video costs at the default settings (frames plus sound). */
export const VIDEO_TOKENS_PER_SECOND = 290;

/**
 * Below this many prompt tokens the video cannot have been included: it leaves room for about
 * three seconds of video on top of the instructions, and nothing that short is a recipe.
 */
export const MIN_VIDEO_PROMPT_TOKENS = 2000;

/**
 * true when the video was included, false when it was not, null when the service did not say
 * (in which case we do not guess and carry on).
 */
export function videoWasRead(promptTokens, minimum = MIN_VIDEO_PROMPT_TOKENS) {
  if (!Number.isFinite(promptTokens)) return null;
  return promptTokens >= minimum;
}

/** How long the video was, judging by what it cost. A rough guide, good to about 15 percent. */
export function estimateVideoSeconds(promptTokens) {
  if (!Number.isFinite(promptTokens)) return null;
  return Math.max(0, (promptTokens - INSTRUCTION_TOKENS) / VIDEO_TOKENS_PER_SECOND);
}

/** The longest a step can sit in the video before we stop believing the AI's timestamps. */
export function latestPlausibleSecond(promptTokens) {
  const seconds = estimateVideoSeconds(promptTokens);
  return seconds == null ? null : seconds * 1.3 + 30;
}

export function videoUnreadableError(detail) {
  return new AppError('video_unreadable', "We couldn't open that video.", {
    status: 422,
    hint: 'It may be private or unlisted, age-restricted, a live stream, or blocked. Try another public link, or paste the recipe text.',
    canPaste: true,
    detail,
  });
}
