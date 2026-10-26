# Contributing to ScribeForge

Thank you for helping. ScribeForge is an offline PDF toolkit for Windows, built by BC6 and open to everyone under the Apache License 2.0.

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

## Reporting a problem, or suggesting an idea

Open an issue and choose **Report a problem** or **Suggest an idea**. Please **never attach private PDFs** or anything with personal details: issues are public. Describe the file instead, or make a test file that shows the same problem.

A security problem (anything that could expose someone's documents) goes privately instead: see [SECURITY.md](SECURITY.md).

## Before you start

- For anything bigger than a small fix, open an issue first and describe what you'd like to change. ScribeForge is built in planned steps ([docs/Roadmap.md](docs/Roadmap.md)), and each phase starts with a written plan.
- Read the rules below. Most of them are checked by the tests, so a change that breaks one will fail.

## Setting up

See [Setting up (Windows)](README.md#setting-up-windows) in the README: install Node.js 24, run `npm install`, then `npm run fixtures`. Try your changes in trial mode:

```bash
npm run trial
```

Trial mode keeps its own settings in `%APPDATA%\ScribeForge Trial`, so your real settings are never touched.

## Rules that never bend

1. **No internet.** The app makes no network requests of any kind: no updates, usage data, fonts or web content. Links in documents open in the person's own browser, after asking. The whole-app tests fail on any request.
2. **The person's files are safe.** Opening a file only reads it. Every change is saved to a new file, and replacing an original asks twice. Tests compare checksums of every input file before and after.
3. **PDF content is untrusted.** PDF JavaScript never runs, damaged files show a plain message and never crash the app, and PDFs are only parsed inside the sandboxed window or its worker.
4. **Redaction removes, it doesn't cover.** Marked pages become images; tests search every string and stream for the redacted text.
5. **Plain language** in everything people read: labels, messages, help pages, the README and test scripts. Short sentences, everyday words.
6. **The look follows BC6's style rules**, checked by `tests/unit/style-guard.test.ts`:
    - colours only from the theme tokens in `src/shared/themes.ts` (document colours, such as annotation colours, live in `src/shared/annotationColours.ts`);
    - Inter for all text, at weights 400 and 600 only, and nothing smaller than 13 px;
    - no italics, all-capitals, gradients or shadows.
7. **Accessible:** every theme passes the contrast test (4.5:1 for text, 3:1 for outlines and controls), everything works with the keyboard, and every screen works at all three text sizes.
8. **Dependencies need a good reason.** Before adding a package, say what it's for, its licence, its size, and whether it ships in the app. No GPL or AGPL code in the app. Every shipped package must be in `THIRD-PARTY-NOTICES.md` (`npm run notices` rebuilds it, and a test checks it).
9. **No real documents or personal data** in the repo. Test PDFs are made by `scripts/make-fixtures.mjs`; add new ones there.

## Checks before a pull request

```bash
npm run typecheck
```
```bash
npm test
```
```bash
npm run e2e
```

For changes to how the app is packaged, also run `npm run e2e:packaged`, which runs every whole-app test on the installed-app build.

The same checks run on GitHub's Windows machines, whose screen is only 1024 by 768. To run the whole-app tests in a space that size on your PC, set `SCRIBEFORGE_TEST_SCREEN` first (in PowerShell: `$env:SCRIBEFORGE_TEST_SCREEN = '1024x728'`). For anything you can see, look at `test-results\screens\contact-sheet.png`: it shows every screen in every theme.

New features come with:
- unit tests for the logic, and whole-app tests that drive the real app;
- a short manual test script in `docs/manual-tests/`;
- an update to the help pages in `content/help/`, and to the README if commands or behaviour change.

## How a pull request is reviewed

- **One topic per pull request.** A fix and a new feature are two pull requests.
- **The checks must pass.** GitHub runs the typecheck, the unit tests and the whole-app tests (zero-network check included) on every pull request, on Windows. You'll see the result at the bottom of the pull request.
- **Features need a plan first.** New features belong to an approved plan in `docs/` (as every part of ScribeForge does), so open an issue to talk about it before writing much code.
- **The maintainer reviews and merges every change,** and may ask for changes first. Changes written with the help of AI tools are welcome, and follow exactly the same rules and review.
- **Commit messages** say what changed in plain words. Codenames (such as Splitblade or Sealkeeper, from the [outline](docs/ScribeForge_Master_Outline.md)) are welcome there, but never in the app.
- **The pull request form** has a short checklist; please go through it.

## Help pages

The help pages are plain Markdown files in `content/help/`, numbered to set their order. Edit them like any text file; they're built into the app. They can use headings, paragraphs, lists, tables, **bold**, `keys`, and links to other help pages (`[Redacting](06-redacting.md)`). A test checks that every page has a title and every link leads somewhere.

## Licence

By contributing, you agree that your contribution is licensed under the [Apache License 2.0](LICENSE), like the rest of ScribeForge.
