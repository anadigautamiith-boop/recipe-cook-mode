# Cookalong

Paste a YouTube or Instagram cooking link. Get a recipe a first-time cook can follow: what to buy, what each step means, what "done" looks like, and a clear mark wherever the video did not say.

Made for people who are cooking alone for the first time, often far from home, learning from videos made for people who already know the basics.

**Live app:** https://recipe-cook-mode.anadigautamiith.workers.dev
**Test lab:** `/tests` on the live app. It lists the test videos, what each cost, how long it took and how it was rated.

## What it does

- **YouTube link:** the video itself is read by Google's Gemini model (through OpenRouter), picture and sound together, so amounts that appear only as text on screen are caught too.
- **Instagram link:** Instagram does not let a server fetch a Reel's video, so we read the public caption only. If there is no recipe in it, the app says so and asks you to paste the text. It never pretends to have watched the video.
- **Pasted text:** a caption, a description or a transcript works as well.
- **Cook mode:** one step at a time in large type, with heat and timer chips, an alarm, and the screen kept awake. Servings and units (metric or US) change on the page at no cost, because that is plain arithmetic, not AI.

Three rules shape everything:

1. **Never guess silently.** What the video said is in black. What we added to help is blue handwriting, and it is labelled "added by us". What the video left out is yellow and listed under "What the video didn't say". An ingredient with no stated amount shows "not said", not a made-up number.
2. **Cheapest route first, never pay twice.** Checks that cost nothing run before anything that costs money. A recipe made once is remembered for six hours. Scaling and unit changes never call the AI.
3. **Fail honestly, with a next step.** Every error says what happened in plain words and what to do (paste the text, try a public link, wait a minute).

## Run it on your computer

Needs Node 20 or newer.

```bash
npm install
npm run dev:mock        # pretend AI, no key, no cost: open http://localhost:8787
npm test                # 141 tests, all on a fake network
```

In mock mode a few special video ids trigger the awkward cases on purpose: `aaaaaaaaaaa` is not a recipe, `bbbbbbbbbbb` is private, `ccccccccccc` makes the first model return broken JSON, `ddddddddddd` has two dishes, `eeeeeeeeeee` is slow, `fffffffffff` is a video the AI never received (the app must refuse the recipe it invents). An Instagram code containing `Cap` has a readable caption; any other does not.

To use the real AI locally, copy `.dev.vars.example` to `.dev.vars`, put your OpenRouter key in it (that file is git-ignored) and run `npm run dev:worker`.

## Put it online (Cloudflare, free plan)

1. In Cloudflare, go to **Workers & Pages**, then **Create**, then **Import a repository**, and choose this repository.
2. Keep the project name `recipe-cook-mode` (it must match `name` in `wrangler.jsonc`). Leave the build command empty. The deploy command is `npx wrangler deploy`.
3. After the first deploy, open the Worker, then **Settings**, then **Variables and Secrets**, and add a **secret** named `OPENROUTER_API_KEY` with your key. Deploy again so it takes effect.
4. Open `/tests` on your site and press the three **Check** buttons. They say what is wrong, in plain words, before you spend anything on a full run.

The key lives only in Cloudflare's secret store. It is never in this repository, in the page's code or in the commit history, and the browser never sees it.

## How it is built

No framework and no build step. A Cloudflare Worker serves the static site in `public/` and two API routes.

```
public/                 the site (plain HTML, CSS and ES modules)
  js/shared/            code the browser and the Worker both use: link parsing, unit maths, languages
  js/format.js          words and numbers for the page, as pure functions that Node tests
  js/recipe-view.js     the recipe page          js/cook.js   cook mode
  js/lab-core.js        the test lab's logic     js/testlab.js  its page
src/                    the Worker
  handlers/recipe.js    POST /api/recipe: check input, settings, cache, limits, then run
  pipeline.js           which route to take (YouTube video, Instagram caption, pasted text)
  openrouter.js         the AI client: model fallback, timeouts, cost taken from the reply
  prompt.js, schema.js  what we ask the AI, and a strict checker for what it sends back
  instagram.js          reads a public caption, never logs in, never uses cookies
test/                   141 tests on a fake network (no key, no internet)
scripts/                the pretend-AI development server
submission/             the write-up, test set and build log
```

Settings that are not secret (model names, limits) are in `wrangler.jsonc` and can be changed without touching code: `VIDEO_MODELS`, `TEXT_MODELS`, `RATE_LIMIT_PER_HOUR`, `DAILY_CAP`.

## What it costs

A model that reads video is billed by the second of video: Gemini turns each second into about 300 tokens. With `google/gemini-2.5-flash` at $0.30 per million tokens in and $2.50 out (OpenRouter's listed price), that is roughly:

| Video length | About |
|---|---|
| 1 minute (a Short) | 1 cent |
| 4 minutes | 3 cents |
| 10 minutes | 6 cents |

These are estimates worked out from list prices. The test lab records the real figure for each video, taken from OpenRouter's own usage report, and `submission/TEST_SET.md` has those numbers. Instagram captions and pasted text use a text-only model and cost a fraction of a cent.

## Safety and privacy

- The only secret is the OpenRouter key, and it is read only inside the Worker.
- A strict content security policy (`public/_headers`) allows scripts, styles, fonts and connections from this site only, plus YouTube thumbnails. Everything the AI writes is put on the page as text, never as HTML.
- Requests must come from this site's own pages. Each visitor is limited to 12 new recipes an hour, and the whole site to 120 a day.
- No accounts, no analytics and no cookies. Recent recipes and ticked ingredients are kept in the visitor's own browser.
- The link a visitor pastes is sent to Google's Gemini model through OpenRouter so it can read the video. The home page says so.

## Known limits

Nothing in this list is hidden in the app; it is here so you know where the edges are.

- Only **public** YouTube videos work. Private and unlisted videos cannot be opened by the model, and the app says so.
- Length: in live tests a video of just over 12 minutes finished (about two minutes), and videos over 20 minutes returned an error message. The app says so instead of showing a partial recipe, but there is no promise for anything longer than about 15 minutes.
- Step timestamps come from the AI and are sometimes missing or wrong, so the app hides them when they cannot fit the video's length. Treat the "watch this step" links as a convenience.
- Instagram is best effort. If Instagram changes its public pages, the caption reader stops finding captions and the app falls back to asking for pasted text.
- The recipe cache and the rate limits live in each Worker instance's memory. They are a brake, not a wall: a restart clears them, and two instances do not share them. A hard limit would need Cloudflare KV or a Durable Object.
- The free plan gives a Worker about 10 milliseconds of processor time per request, so the Worker does no heavy parsing. It waits for OpenRouter, which does not count against that time.
- The tests use a fake network. They prove the code does what is intended, not that YouTube, Instagram or OpenRouter behave as assumed. The test lab is how that is checked against the real services.
