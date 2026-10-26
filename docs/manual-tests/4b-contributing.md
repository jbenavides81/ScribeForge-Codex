# Manual test: stop 4b, contributing

About 25 minutes, on github.com, after stop 4b is committed and pushed. Nothing in the app changed in this stop.

GitHub moves its menus now and then, so a name here may differ slightly from what you see. Each step says what to do, then **what you should see**. If something doesn't match, note the step number and what you saw.

## The GitHub checks

1. Open the repository on github.com and click **Actions**. **A run of "Checks" for the push, with a yellow dot while it runs, then a green tick.** It takes about 15 to 25 minutes.
2. Click the run, then **Typecheck, unit tests and whole-app tests**. **Each step has a green tick: Get the code, Set up Node.js 24, Install the packages, Typecheck, Unit tests, Whole-app tests on the development build.** "Whole-app tests on the packaged app" is skipped (it runs only when started by hand).
3. Click **Checks** on the left, then **Run workflow**, keep **Also run the whole-app tests on the packaged app** ticked, and click **Run workflow**. **A new run, which also runs the packaged-app tests. Green when done** (about 30 minutes; you can carry on meanwhile).

## Issues and pull requests

4. Click **Issues**, then **New issue**. **Two choices, "Report a problem" and "Suggest an idea", and a link "Report a security problem privately". There's no blank issue.**
5. Click **Report a problem**. **A note at the top asks you not to attach private PDFs, and points security problems elsewhere. "What happened", "Steps to make it happen again", "ScribeForge version" and "Windows version" are required.** Close the page without submitting.
6. Click **Suggest an idea**. **A note says ScribeForge never goes online and never changes the files you open.** Close it.
7. On the repository's front page, look at the right-hand side. **Links to the Readme, the Apache-2.0 licence, the Code of conduct, Contributing and the Security policy.**
8. Click **Insights**, then **Community standards**. **Every item ticked, or nearly: description, README, code of conduct, contributing, licence, security policy, issue templates and pull request template.**

## Settings only you can change

These were recommended in the Phase 4 plan (question 9). Claude doesn't change them.

9. **Private reporting:** **Settings**, then **Code security** (or **Advanced Security**). Turn on **Private vulnerability reporting**. Then open the **Security** tab. **A "Report a vulnerability" button.**
10. **Dependabot:** on the same page, turn on **Dependabot alerts**. Leave **Dependabot security updates** and **version updates** off: new packages need your approval first.
11. **Protecting main:** **Settings**, **Rules**, **Rulesets**, **New ruleset**, **New branch ruleset**.
    - Name it `main`, set **Enforcement status** to **Active**, and under **Target branches** add the default branch.
    - Under **Bypass list**, add **Repository admin** (you), so you can still push directly.
    - Tick **Require a pull request before merging** and **Require status checks to pass**, and add the check **Typecheck, unit tests and whole-app tests**.
    - Tick **Block force pushes**. Click **Create**.
12. **Reported content** (for the code of conduct): **Settings**, **Moderation options**, **Reported content**: accept content reports from all users (or from prior contributors).

## Optional: a test pull request (about 5 minutes, plus the checks)

13. On the repository's front page, open `README.md`, click the pencil, add a blank line at the end, and choose **Create a new branch for this commit and start a pull request**. Click **Propose changes**. **The pull request form shows the checklist: one thing, the checks, tests, themes, help and README, packages, no personal data, plain words.**
14. Create the pull request. **At the bottom: "Checks" running, then passing.** Then **Close pull request** (don't merge) and **Delete branch**.

## Finish

15. Nothing to clean up on this PC.
