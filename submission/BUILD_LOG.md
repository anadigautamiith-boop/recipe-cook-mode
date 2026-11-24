# Build log

## Tools

- **Claude Sonnet 5.5, in Claude Code on the web.** The only coding agent. It wrote the code, the tests and these documents; my part was choosing the user (first-time cooks living abroad), deploying, running real videos through the app and rating the results. Its sandbox could not reach YouTube, Instagram, OpenRouter or Cloudflare, so **nothing ran against the real services until the app was deployed**.
- **Cloudflare Workers with static assets** (free plan) for hosting, and **OpenRouter** with **Gemini 2.5 Flash and Flash-Lite** as the app's own AI (the $20 key from the brief).
- **Node's test runner:** 142 tests on a fake network (121 when the app was first deployed). **Headless Chrome** (puppeteer-core) for screenshots of every screen at desktop and phone size.
- **GitHub** for the repository, and **web search and page fetches** for documentation and test videos. Fonts: **Atkinson Hyperlegible Next** and **Kalam**, self-hosted.

## Rough time

By file timestamps (Tokyo time): the brief was uploaded at 21:42 on 23 Nov and the app's code was last changed at 23:05, so about 35 minutes of reading and agreeing a plan, then about 50 minutes of building. The first real run was at 00:39 on 24 Nov. Fixes were committed between 01:13 and 01:25, and I confirmed one on the live site at 01:30. The re-run was at 21:32 that evening. The first commit (00:16) is GitHub's own, made when I created the empty repository, so it is dated after the commits on top of it.

My own time to deploy, test, rate and write up: **[__ hours]**.

## One moment AI saved time

The sandbox could not reach the real services, so the agent first built a **pretend AI network and a development server** that returns canned answers, including awkward ones on demand (a private video, broken JSON, two dishes in one video, a slow reply). With a headless-browser screenshot loop, the whole front end was built and checked with no key and no spend. `npm run dev:mock` still runs it that way.

## One moment AI misled

**The biggest came from the AI inside the app, and only a real run showed it.** All 121 tests were green and the app was live. My first real run included a video that turned out to be private. The app returned a confident "Easy Chicken and Broccoli Stir-Fry" that came from no video: Gemini had never been given one and wrote a plausible recipe instead of saying so, and the test page marked the row "as hoped". The only sign was the usage report: 1,103 input tokens, which is our instructions alone. The agent added a check on those numbers (video costs about 290 tokens a second), a test that replays the case, and a setup check for it. The same private link now says "We couldn't open that video".

Smaller cases: a screenshot caught `[object HTMLHeadingElement]` where a heading belonged, because the tests checked data and not the screen; and reading the re-run showed "Backup used" on a run with no backup, because the agent's own test had asserted the wrong label.

The larger lesson: the tests run on a fake network the agent wrote from its own picture of the services, so they prove the app handles those replies, not that the services behave that way. That is why the app has a test page (`/tests`) that runs real videos through the deployed app. After the fixes the first run found, the re-run had no cut-off answers and took about half the time (129 s down to 70 s on the 13-minute video).

## Session log

[The full AI session log for this project is attached to my email as `ai-session-log.txt`, not committed here. The brief given to the agent contained the demo API key, so the key is redacted in the copy I sent.]
