# Test set

> **Status: not run yet.** The table below is the plan. Its Result, Time, Cost and Rating columns are filled in from the live test page (`/tests` on the deployed app) once the app is deployed with its key. Nothing here is a measured result until that is done.

## How I test

Every video goes through the deployed app's own test page, one at a time, with the cache bypassed so each run pays for a real read. For each run the page records:

- **Result:** a recipe, "not a recipe", "paste the text instead", or an error with its code.
- **Time:** how long the visitor waits.
- **Cost:** taken from the usage report OpenRouter sends back with each answer. It is not an estimate.
- **Counts:** how many ingredients had an amount stated, how many steps, how many gaps the app flagged.

Then I open the recipe next to the video and rate it by hand:

- **Good:** I could cook from it.
- **OK:** it needs small fixes.
- **Poor:** not usable.

What I check while rating, worst failure first:

1. **Anything stated that the video did not say.** An invented amount is the failure that matters most, because a first-time cook will trust it.
2. **Amounts the video did say, missing or wrong.**
3. **Step order and timers.**
4. **Whether a missing amount is marked "not said" and listed under "What the video didn't say".**

For rows where the right behaviour is known in advance (the zoo video must be refused as "not a recipe"), the page also checks the outcome automatically and the table says "as hoped" or "not as hoped".

## The set

Five YouTube videos chosen to include hard cases, plus three that only I can supply (a long video and two Instagram Reels). Each YouTube link was confirmed as a real video on a page that embeds it. Rating a row means watching that video through.

| # | Video | What it tests | Result | Time | Cost | Amounts stated | Steps | Gaps flagged | Rating | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | [PUP7U5vTMM0](https://www.youtube.com/watch?v=PUP7U5vTMM0) | Easy: one dish, clear voice-over (the baseline) | not run | | | | | | | |
| 2 | [-3RfZsImwGg](https://www.youtube.com/shorts/-3RfZsImwGg) | Short and fast: a YouTube Short, about a minute, little time to say amounts | not run | | | | | | | |
| 3 | [XzKkkMdo7Jk](https://www.youtube.com/watch?v=XzKkkMdo7Jk) | A dal tadka video from a Hindi recipe page (language spoken and on-screen text go in Notes) | not run | | | | | | | |
| 4 | [ERysyFbJH7w](https://www.youtube.com/watch?v=ERysyFbJH7w) | Several dishes in one 10-minute video; should come back as one tab per dish | not run | | | | | | | |
| 5 | [jNQXAC9IVRw](https://www.youtube.com/watch?v=jNQXAC9IVRw) | Not a recipe (19 seconds at a zoo); must say so instead of inventing a dish | not run | | | | | | | |
| 6 | _my link_ | Long: 20 minutes or more; should finish, or fail with a clear "too long" | not run | | | | | | | |
| 7 | _my link_ | Instagram Reel with the recipe written in the caption | not run | | | | | | | |
| 8 | _my link_ | Instagram Reel with nothing useful in the caption; should ask me to paste the text | not run | | | | | | | |

## What I expect to be hard

- **Row 2 (a Short):** little is said aloud, so the honest outcome is a recipe with many "not said" amounts. A confident recipe with every amount filled in would be the failure.
- **Row 3 (Hindi):** whether amounts are spoken or only written on screen decides how much the model can read.
- **Row 4 (several dishes):** the dishes must not be blended into one recipe.
- **Row 6 (long):** a long video may run out of room for the answer. "Too long" is acceptable. A half-made recipe is not.
- **Rows 7 and 8 (Instagram):** the app cannot watch a Reel, so a caption with no recipe must end in "paste the text", not a made-up dish.

## Limits of this test

- **Eight videos is a spot check, not a benchmark.** It shows the kinds of failure to expect. It does not give an accuracy percentage.
- **One rater, me, and no real beginners yet.** I can tell whether a recipe matches its video. I cannot tell whether a first-time cook would get stuck, which is the claim the app is built on.
- **One run per video.** The AI can answer differently on the same video, so a single run does not measure that variation.
- **Instagram is best effort.** Whether a caption can be read at all is Instagram's choice and can change without notice.
- **Cost is for these runs only,** with the cache bypassed. In real use a repeated link costs nothing.
- **The app's own tests (121, run with `npm test`) use a fake network.** They prove the app handles each kind of reply correctly. They do not show that the real services behave the way the fake one does, which is what this table is for.
