# Cookalong: write-up

**The problem.** First-time cooks, often alone and far from home, learn from videos made for people who already cook. Those videos skip what a beginner needs: the amounts, what "fold" means, what "done" looks like. Several apps already turn a video into a recipe, so I did not try to out-extract them. I built for the beginner, and for trust.

## Key decisions, and why

1. **One user: a first-time cook.** Every choice asks "would someone who has never cooked get stuck here?" So cooking words explain themselves on tap, steps say what "done" looks like, and a missing seasoning amount comes with "start with less and taste".
2. **Never guess silently.** Black ink is what the video said, blue handwriting is "added by us", yellow is "not in the video". A missing amount shows "not said", never a plausible number. The code strips any number the AI gives an ingredient it marked "not stated".
3. **Let Gemini watch the video** instead of reading a transcript: amounts often appear only as on-screen text, and YouTube often blocks cloud servers from fetching captions. Where the AI gives a believable time, a YouTube step links to that moment; in testing the times were unreliable on long videos, so impossible ones are hidden.
4. **Instagram: caption only, said plainly.** Instagram will not hand a server the video, and I did not want logins or scraping. We read the public caption, label the result, and ask for pasted text when the caption has no recipe.
5. **Cheapest route first.** Link check, then cache, then limits, and only then paid AI. Servings and unit changes are arithmetic in the browser and cost nothing.
6. **Cook mode is its own screen** (large type, timers that survive a sleeping phone, screen kept awake), and there are **no accounts, framework or build step**: nothing to sign in to with messy hands.

## What I did not build

Accounts and a saved cookbook. TikTok, Facebook, X and Vimeo (pasting one gets a clear "not supported yet"). Watching Instagram video. Ingredient substitutions, since each would be a guess I would have to label. Nutrition.

## What can go wrong, and what happens

- **Private, unlisted, age-restricted or live video.** My first real test showed the AI writing a convincing recipe for a private video it never received. The app now checks the AI's own usage report: video costs about 290 tokens a second, so a reply that read only our instructions is refused. The same private link now returns "We couldn't open that video" and offers "paste the text instead".
- **Broken or invented AI output.** A strict checker skips a reply that is not valid JSON (the next model is tried), drops any "recipe" with no steps, and strips numbers from "not stated" ingredients. A cut-off reply becomes a "too long" message, never half a recipe.
- **Not a recipe.** The app says so and does not invent one.
- **A wrong amount gets through.** This is the real risk, and it is not zero. My answer is honesty, not a promise: each recipe says what it was built from and lists what the video did not say. I rated every test recipe by hand (TEST_SET.md).
- **Someone runs up the bill.** 12 new recipes an hour per visitor, 120 a day in total, a six-hour cache, and the $20 key as the hard stop. The counts live in each server's memory, so they are a brake, not a wall.
- **The key leaks.** It exists only as a Cloudflare secret. The browser never sees it, and the repository and its history contain none.

## Cost per recipe

List-price estimate: about **1¢ for a 1-minute video, 3¢ for 4 minutes and 6¢ for 10 minutes** (Gemini 2.5 Flash at $0.30 in and $2.50 out per million tokens, about 300 tokens per second of video). [Measured on my test set: average $__, range $__ to $__.] Cache hits, servings and unit changes cost nothing. $20 covers roughly 300 ten-minute recipes.

## With another week

1. Watch five real beginners cook from it. I have not proven that the "done" hints help.
2. A hard spending limit and a cache shared across servers.
3. Lower-resolution frames and the cheaper model, measuring what is lost on small on-screen text.
4. A phone share target, so "Share to Cookalong" works inside Instagram, caption included, and voice control ("next") for messy hands.
