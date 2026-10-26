# Releasing ScribeForge

How a version is numbered, described, built, checked and published (stop 4c, [Plan_Phase4.md](Plan_Phase4.md), section 6). A release is published only when the maintainer chooses.

## What a release is

Three things, and nothing else:

- **The installer,** `ScribeForge-Setup-1.11.0.exe`.
- **The checksum file,** `ScribeForge-1.11.0-SHA256SUMS.txt`. It holds SHA-256 checksums for the installer, and for the app's own files as installed: `ScribeForge.exe` and `resources/app.asar`.
- **The release notes,** made from the version's section of [CHANGELOG.md](../CHANGELOG.md). They also say how to install and how to check the download.

The names have no spaces: GitHub turns spaces into dots when files are uploaded, which made 1.10.0's downloads `ScribeForge.Setup.1.10.0.exe` and `ScribeForge.1.10.0.SHA256SUMS.txt` (its notes were corrected after publishing).

No files for automatic updates: ScribeForge never checks for updates, so the build doesn't make them (`publish: null` in `electron-builder.yml`).

## Version numbers

- **The last number** (1.9.**1**): fixes only.
- **The middle number** (1.**10**.0): new features. Everything made by older versions still opens.
- **The first number** (**2**.0.0): something made by an older version (a vault, a backup, a setting) can't be used any more, or a feature is removed.

A version gets a tag (such as `v1.10.0`) only when it's published.

## Making a release

1. **Set the version** in `package.json` (and `package-lock.json`), and add its section to `CHANGELOG.md`: `## 1.10.0 (date)`, then what's new, in plain words. Commit both.
2. **Optional, on GitHub:** Actions > Checks > Run workflow, with the packaged-app tests ticked. It runs every test on GitHub's Windows machines.
3. **Run the release script** (about 25 minutes):
   ```bash
   npm run release
   ```
   It refuses, saying why, if there are uncommitted changes, it isn't on main, the version is already released, the changelog has no section for it, or the third-party notices are out of date. Then it:
   - runs the typecheck, the unit tests, and the whole-app tests on the development build and the packaged app;
   - builds the installer, and checks the build made no update files;
   - builds the app a second time, and checks `ScribeForge.exe` and `app.asar` came out the same, so anyone can rebuild them from the source and compare;
   - writes the checksum file and the notes into `release\`, and checks neither holds a personal path, an email address or your user name.

   It never publishes anything.

4. **Publish it,** only when you choose. Either:
   - with GitHub's command-line tool (`gh`, signed in by you): the release script prints the exact command, `gh release create v1.10.0 …`, which makes the tag and the release, and uploads the installer and the checksum file, with the notes as its description; or
   - on github.com: **Releases**, **Draft a new release**, choose a tag `v1.10.0` (made when published, from main), the title `ScribeForge 1.10.0`, paste the notes, attach the installer and the checksum file, and **Publish release**.

## Practice runs

To try the build steps without making a release:

```bash
npm run release -- --practice
```

It skips the checks on the repository and the tests, builds as a release would, and writes into `release\practice`. Don't publish those files.

## Signing

The installer isn't signed (Phase 4 plan, question 14), so Windows warns the first time it runs. The release notes and the **Getting ScribeForge** help page explain it. Signing could get a plan of its own later; SignPath Foundation signs open-source projects for free, with conditions.

## Needs verification

- The app's own files came out the same on two builds on the same PC. Whether a build on a different PC (with the same `package-lock.json`) gives the same files hasn't been tried yet.
