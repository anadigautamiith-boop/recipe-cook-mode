# Test set

**Run on 24 November 2026, 21:32 to 21:35 Tokyo time, against the live app, version 0.2.1.** Eight videos, one run each, with the cache bypassed so every run paid for a real read. The app's own test page (`/tests`) recorded each run and I rated each result. The recorded results are in `public/test-results.json`, so a visitor to `/tests` sees them without running anything, and `node scripts/results-table.mjs` prints the table below from that file. The deployed version is now 0.2.2, which differs only in how the recipe page labels one note (last section). It asks the AI the same thing and runs the same models.

## The run in four lines

- **Behaviour:** 7 of 7 videos with a known right answer behaved as hoped. The eighth, the Short, has no automatic check.
- **Quality:** I rated all 8 Good, with caveats in the Notes column. On rows 1, 2 and 7 the source gives few amounts (0 of 17, 2 of 10 and 4 of 12 stated). The app marked the rest "not stated" and listed them as gaps instead of inventing them.
- **Cost:** the 5 YouTube recipes cost 2.4¢ to 10.7¢, **6.3¢ on average**. The Instagram caption recipe cost 0.1¢. The whole run cost about 32¢.
- **Time:** YouTube recipes took 32 to 70 seconds (median 40). The caption recipe took 7.7 s. The two refusals took 4.0 s and 2.4 s.

## The table

| # | Video | What it tests | Result | Time | Cost | Amounts stated | Steps | Gaps flagged | Rating | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | [BDiBQUN_89I](https://youtu.be/BDiBQUN_89I) | Miniature cooking: one dish, no real amounts | Made a recipe (as hoped) | 40.3 s | $0.047 | 0 of 17 | 25 | 10 | Good | Meant as the easy baseline, but the video is miniature cooking with no real amounts. The app still wrote a 25-step spaghetti and meatballs recipe and marked all 17 amounts 'not stated' instead of inventing them, with 10 gaps listed (nine amounts and the oven temperature). The one timer, 20 minutes of boiling, is worth checking against the video. No step times given. 40 s, $0.047. |
| 2 | [-3RfZsImwGg](https://www.youtube.com/shorts/-3RfZsImwGg) | Short and fast: a YouTube Short | Made a recipe | 32.0 s | $0.024 | 2 of 10 | 26 | 10 | Good | A one-minute Short. The video gives only 2 of the 10 amounts (2 sausage links and half a lemon), so the other 8 are marked 'not stated' and 10 gaps are listed, including two cooking times. 26 short steps with times from 1 s to 51 s, inside the video's length, and 8 'done when' hints. 32 s, $0.024. |
| 3 | [XzKkkMdo7Jk](https://www.youtube.com/watch?v=XzKkkMdo7Jk) | Indian recipe: dal tadka (title in Hindi and English) | Made a recipe (as hoped) | 38.5 s | $0.040 | 30 of 30 | 16 | 2 | Good | A complete, followable recipe: all 30 ingredients have amounts, plus 16 steps, 1 timer and 6 'done when' hints. Both tempering stages are captured. Two gaps are flagged (servings; heat under the pressure cooker). Weak spot: the last five step times (3:24 to 4:05) are later than the video's estimated end (about 3:10), so those 'watch this step' links are unreliable. 39 s, $0.040. |
| 4 | [ERysyFbJH7w](https://www.youtube.com/watch?v=ERysyFbJH7w) | Several dishes in one video | Made a recipe (as hoped) | 53.4 s | $0.095 | 25 of 26 | 23 | 12 | Good | Three of the video's five meals came back, one tab each (the app's maximum is three): Hummus Pasta Salad, Roasted Bell Pepper Pesto Sandwich and Lentil Harvest Bowl. 23 steps in all (6, 10 and 7), 25 of 26 amounts stated, 12 gaps flagged. The recipes start from prepared parts (cooked pasta, lentil stew, cooked tofu), so cooking those parts is not covered, and 'about 5 minutes' per dish means assembly only. 53 s, $0.095. |
| 5 | [jNQXAC9IVRw](https://www.youtube.com/watch?v=jNQXAC9IVRw) | Not a recipe | Said it is not a recipe (as hoped) | 4.0 s | $0.003 |  |  |  | Good | Correct refusal. The video is a person talking about elephants at a zoo (the first video uploaded to YouTube, 19 seconds). The app said it is not a recipe and gave that reason instead of inventing a dish. The reason matches the video, so the video really was read. 4.0 s, $0.003. |
| 6 | [5QJUdaUxm0s](https://youtu.be/5QJUdaUxm0s) | Long: 12 minutes or more | Made a recipe (as hoped) | 70.0 s | $0.11 | 33 of 40 | 25 | 5 | Good | About 13 minutes: a chef cooks egg fried rice with an omelette parcel while a reviewer comments. 25 steps, 40 ingredients (33 with amounts), 3 timers, 15 'done when' hints, 5 gaps. The main model finished without falling back: 70 s and $0.107, against 129 s and $0.137 on the first run. The AI's step times ran past the video's length, so the app hid all 25. |
| 7 | [C6EUaIyPwDg](https://www.instagram.com/reel/C6EUaIyPwDg/) | Instagram Reel, recipe written in the caption | Made a recipe (as hoped) | 7.7 s | $0.001 | 4 of 12 | 9 | 9 | Good | Instagram caption path works end to end. The app read the public caption, labelled the result as built from the caption, and wrote a 9-step recipe with 12 ingredients. Only 4 amounts were given, so 8 are marked 'not stated', and 9 gaps (including cooking time and heat) are listed. It cannot be checked against the video itself. 7.7 s, $0.001. |
| 8 | [DgFZWfOtahS](https://www.instagram.com/reel/DgFZWfOtahS/) | Instagram Reel, nothing useful in the caption | Said the caption has no recipe (as hoped) | 2.4 s |  |  |  |  | Good | Handled honestly. This time Instagram served the caption (2.4 s). The app found no recipe in it and offered the paste box instead of inventing one. On the first run the app could not read this Reel at all ("Instagram doesn't let us read this Reel automatically") and asked for pasted text, so reading Instagram is best effort and both outcomes end the same way. The cost of this AI check is not shown for errors; it is a fraction of a cent. |

8 of 8 videos run on 24 Nov 2026 against https://recipe-cook-mode.anadigautamiith.workers.dev. 7 of 7 behaved as hoped. Median time for a recipe: 39.4 s. Cost per recipe: average $0.052, from $0.001 to $0.11. Total spent on this run: $0.32. My ratings: 8 good, 0 OK, 0 poor.

How to read it:

- **Rating.** Good: I could cook from it. OK: needs small fixes. Poor: not usable. Where the right answer is a refusal (rows 5 and 8), Good means it refused correctly.
- **"As hoped"** is checked by the page, not by me: the zoo video must be refused, the several-dish video must give at least two recipes, and so on.
- **Time and cost** are the app's own timing and OpenRouter's usage report, not estimates. Row 8's cost is blank because an error carries no cost report. The call is a fraction of a cent, since a whole caption recipe (row 7) cost 0.1¢.
- **Video lengths** quoted in the notes are estimated from the input tokens billed (about 300 per second of video), not read from YouTube.
- **The summary line** counts the Instagram caption recipe too, which is why its average (5.2¢) is lower than the YouTube-only 6.3¢.

## What the run showed

**What worked**

- Amounts the video never gave were marked "not stated", never invented (rows 1, 2, 7).
- The main model finished all five YouTube videos with no fallback. Row 3 came back complete (every ingredient on the dal had an amount), and the 13-minute video gave 25 steps, 3 timers and 40 ingredients.
- The 19-second zoo clip was refused with a correct reason in 4 seconds for 0.3¢.
- Instagram: a caption with a recipe became a recipe, labelled "built from the caption" (row 7). A caption without one ended at the paste box (row 8).

**What did not**

- **Step times (rows 3 and 6).** On the dal, the last five times (3:24 to 4:05) are later than the video's estimated end (about 3:10), and the check let them through, because it only hides times that overshoot by a wide margin. On the 13-minute video some times ran past the end, so the app hid all 25, and that recipe has no jump-to-the-moment links. Treat those links as approximate.
- **More than three dishes (row 4).** The video makes five meals; the app returns three at most. The recipes also start from prepared parts, so the cooking of those parts is not in any of them.
- **The easy baseline (row 1).** I meant this row as the easy case, but the video I chose is miniature cooking with no real amounts. The dal (row 3) is the nearest thing to a normal case in the set.
- **Long videos.** The longest video here, about 13 minutes, finished in 70 seconds. In my first run a video over 20 minutes returned an error message; I did not record the message, so it is not in the table. The app promises nothing past about 15 minutes.

## What the first run found, and what changed

The first run (24 November, about 00:40 to 01:03 Tokyo time) is kept unedited in `submission/evidence/first-run-test-results.json`. It found problems the 121 fake-network tests could not:

1. **A private video produced an invented recipe.** The "easy" link was private. The AI never received the video (1,103 input tokens: our instructions alone) yet returned a 16-step recipe, and the page marked the row "as hoped". The app now refuses any answer billed for too little to contain a video. I checked the same link on the live site (01:30): "We couldn't open that video".
2. **The main model ran out of room on three of five videos.** It stopped at 8,000 output tokens on the dal, several-dish and long videos, so the cheaper model redid the work and the video was read twice. The limit is now 16,000. In the re-run none of the five was cut off, and the times fell: 71 s to 38.5 s (dal), 84 s to 53 s (several dishes), 129 s to 70 s (long).
3. **Impossible step times.** The several-dish video had a step at 4,184 s in a video of about ten minutes. Such times are now hidden, and the prompt says how to write them. In the re-run that video's times are 5:31 to 6:59.
4. **A "done when" hint on nearly every step** (26 hints for 26 steps on the long video). The prompt now asks for them sparingly: 15 for 25 steps on the same video, and 6 for 16 on the dal (14 for 21 before).
5. **The results table counted only the first dish** of a multi-dish video (8 steps shown instead of 26). Fixed, with a test.
6. **Found reading the re-run:** the recipe page said "Backup used" when the app had only hidden step times. They are now filed under "Changed by the app" (version 0.2.2). Nothing the AI is asked changed, so these results still stand.

First-run costs and times for the videos that needed a second attempt are not comparable with the re-run, so the cost figures above come from the re-run only.

## The evidence files

- `submission/evidence/first-run-test-results.json`: the first export, unedited.
- `submission/evidence/second-run-test-results.json`: the re-run's export, unedited. Every number for this run comes from it.
- `public/test-results.json`: the same run as shown on `/tests`. It differs from the unedited export in five ways: the notes are written up (mine were short), rows 1 and 3 are relabelled to match their videos, row 5's rating is filled in as Good (it was blank and my note said "No issues observed"), the share-tracking parts of the links (`si=`, `utm_source=`) are removed, and row 6's step-time note moved from "fallbacks" to the new "adjustments" list of version 0.2.2. No count, time, cost or recipe was changed.

## Limits of this test

- **Eight videos is a spot check, not a benchmark.** It shows the kinds of failure to expect. It does not give an accuracy percentage.
- **One rater, and no real beginners yet.** I can judge whether a recipe is complete and plausible. I cannot tell whether a first-time cook would get stuck, which is the claim the app is built on. My ratings are not an audit of every amount against its video.
- **One run per video on the final version.** The AI answers differently each time: the Short gave 28 steps on the first run and 26 on the second.
- **Instagram is best effort, and two Reels is thin.** Whether a caption can be read is Instagram's choice at that moment. Row 8 could not be read at all on the first run and was read on the second.
- **Cost is for these runs only,** with the cache bypassed. In real use a repeated link costs nothing.
- **The app's own tests (142, run with `npm test`) use a fake network.** They prove the app handles each kind of reply correctly. They do not show that the real services behave as the fake one does, which is what this table is for.
