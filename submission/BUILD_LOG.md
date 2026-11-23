# Build log

## Tools

- **Claude Sonnet 5.5, in Claude Code on the web.** The only coding agent. It wrote the code, the tests and these documents. My part was choosing the user (first-time cooks living abroad), deploying, running real videos through the app and rating the results. The agent ran in a sandbox that could not reach YouTube, Instagram, OpenRouter or Cloudflare, so **nothing was run against the real services until the app was deployed**.
- **Cloudflare Workers with static assets** for hosting, on the free plan. `wrangler` was used for a deploy dry-run only.
- **OpenRouter, then Gemini 2.5 Flash and Flash-Lite**, as the app's own AI (the $20 key from the brief).
- **Node's built-in test runner:** 141 tests on a fake network (121 when the app was first deployed).
- **Headless Chrome with puppeteer-core** for screenshots of every screen at desktop and phone size.
- **Atkinson Hyperlegible Next and Kalam**, self-hosted (both under the SIL Open Font License).
- **GitHub** for the repository. **Web search and page fetches** to check documentation (which models accept YouTube links, how video is priced) and to find test videos.

## Rough time

From the file timestamps in the working folder (Tokyo time, 23 Nov 2026): the brief was uploaded at 21:42, the project folder was created at 22:17, and the app's code was last changed at 23:05. That is about 35 minutes of reading the brief and agreeing a plan, then about 50 minutes of building the app. These documents came after.

The commit times (22:31 to 23:14 on 23 Nov) show when each stage was saved, not when it was written, because the agent saved its work in batches after each stage worked. The first commit, "Initial commit" at 00:16 on 24 Nov, was made by GitHub when I created the empty repository, so it is dated after the commits on top of it.

The first run of real videos through the deployed app started at 00:39 on 24 Nov. It found the failures described below. The fixes were committed between 01:13 and 01:25, and at 01:30 I confirmed on the live site that the private-video fix works.

On top of that, my own time to deploy, run the test page, rate the recipes and write this up: **[__ hours]**.

## One moment AI saved time

Because the sandbox could not reach the real services, the agent first built a **pretend AI network and a development server** that returns canned answers, including the awkward ones on demand (a private video, a first model that returns broken JSON, two dishes in one video, a slow reply). With that and a headless-browser screenshot loop, the whole front end was built and checked with no key and no spend. Anyone can still run it that way with `npm run dev:mock`.

## One moment AI misled

**The biggest one came from the AI that runs inside the app, and only a real run could show it.** All 121 tests were green and the app was deployed. My first real run included a link to a video that turned out to be private. The app returned a confident "Easy Chicken and Broccoli Stir-Fry", with 13 ingredients and 16 steps, none of it from any video: Gemini had never been given the video and wrote a plausible recipe instead of saying so. The test page even marked the row "as hoped", because a recipe came back. The only sign was in the usage numbers: 1,103 input tokens, which is our instructions alone, where even a short video adds thousands. The agent added a check on those numbers (a video costs about 290 tokens a second), a test that replays that exact case, and a diagnose-page check that fails a model that answers without receiving the video. I then pasted the same private link into the live site and got "We couldn't open that video".

The fake-network tests could not have caught this. They were written from the agent's own picture of how the service behaves, and in that picture a service never answers a question it was not given.

A second case, found by looking at the screen: all the tests were green, yet the recipe page showed the text `[object HTMLHeadingElement]` where a heading should be. A helper had been given a nested list instead of separate items. No test caught it because the tests checked the data, not what appears on screen. A screenshot caught it.

A third, smaller case: a screenshot showed "salt for the tomatoes" under an eggs step, because ingredients were matched to steps by name and two of them were salt. The matching now compares the other words in the ingredient and the step, with tests for it.

The larger lesson is about the tests. They run on a fake network the agent wrote from its own understanding of the services, so they prove the app handles those replies correctly. They do not prove the real services behave that way. That is why the app has its own **test page** (`/tests`), which runs real videos through the deployed app and records what each cost, and why the first real run mattered more than the first 121 green tests.

## Session log

[The full AI session log for this project is attached to my email as `ai-session-log.txt`, not committed here. The brief given to the agent contained the demo API key, so the key is redacted in the copy I sent.]
