# Cookalong: write-up

**The problem.** First-time cooks, often alone and far from home, learn from videos made for people who already cook. Those videos skip what a beginner needs: the amounts, what "fold" means, what "done" looks like. Several apps already turn a video into a recipe, so I built for the beginner, and for trust.

## Key decisions, and why

1. **One user: a first-time cook.** Every choice asks "would a beginner get stuck here?" Cooking words explain themselves on tap, steps say what "done" looks like, and a missing seasoning amount comes with "start with less and taste".
2. **Never guess silently.** Black ink is what the video said, blue handwriting is "added by us", yellow is "not in the video". A missing amount shows "not said", never a plausible number. Code strips any number the AI gives an ingredient it marked "not stated".
3. **Let Gemini watch the video** instead of reading a transcript: amounts often appear only on screen, and YouTube often blocks cloud servers from fetching captions. A step can link to its moment in the video, but the AI's times proved unreliable: impossible ones are hidden, the rest are approximate.
4. **Instagram: caption only, said plainly.** Instagram offers no public video file and forbids automated collection, so I used no logins, cookies or workarounds. The app makes one request for the public caption, gives up at any refusal, and asks for pasted text if the caption has no recipe.
5. **Cheapest route first.** Link check, then cache, then limits, and only then paid AI.
6. **Cook mode is its own screen** (large type, timers that survive a sleeping phone), with **no accounts, framework or build step**.

## What I did not build

Accounts and a saved cookbook. TikTok, Facebook, X and Vimeo (a clear "not supported yet"). Watching Instagram video. Substitutions, since each would be a guess to label. Nutrition.

## What can go wrong, and what happens

- **Private, unlisted, age-restricted or live video.** My first real test showed the AI inventing a recipe for a private video it never received. The app now reads the AI's usage report, refuses a reply that saw only our instructions, and says "We couldn't open that video", offering to paste the text instead.
- **Broken or invented AI output, or not a recipe.** A strict checker skips invalid JSON (the next model is tried) and drops any "recipe" with no steps; a cut-off reply becomes "too long", never half a recipe; a video that is not a recipe is refused with a reason.
- **A wrong amount gets through.** This is the real risk. My answer is honesty, not a promise: each recipe says what it was built from and lists what the video did not say. 7 of 7 checkable test videos behaved as hoped (TEST_SET.md), but I rated completeness, not every amount against its video.
- **Wrong step times, missing dishes, long videos.** The dal video's last five step times (up to 4:05 in a video of about 3:10) got past the check. A five-meal video returned three dishes, the cap. Past about 15 minutes of video, expect "too long" and the paste box.
- **Spend and secrets.** 12 new recipes an hour per visitor, 120 a day, a six-hour cache, and the $20 key as the hard stop; the counts sit in each server's memory, so they are a brake, not a wall. The key is a Cloudflare secret; the repository and its history contain none.

## Cost per recipe

Measured on 8 real runs, a YouTube recipe cost **6¢ on average**: 2.4¢ for a 1-minute Short, 4¢ for 3 minutes, 9.5¢ for 10 minutes and three dishes, 10.7¢ for 13 minutes. That is roughly 2 to 3¢ to write the recipe plus 0.7¢ per minute of video. An Instagram caption cost 0.1¢. Cache hits, servings and unit changes are free. At the test average, $20 covers about 300 recipes.

## With another week

1. Watch five real beginners cook from it. I have not proven that the "done" hints help.
2. Fix what the tests showed: a tighter step-time check, and more than three dishes per video.
3. A hard spending limit, a shared cache, and cheaper frames (measuring what small on-screen text loses).
4. A phone share target (inside Instagram, caption included) and voice control for messy hands.
