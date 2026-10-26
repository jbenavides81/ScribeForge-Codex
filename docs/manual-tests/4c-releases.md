# Manual test: stop 4c, releases

About 20 minutes, plus an optional 25-minute release run and an optional install. Steps 1 to 3 run in **trial mode**. Nothing is published by any step here: publishing happens only when you say so.

Each step says what to do, then **what you should see**. If something doesn't match, note the step number and what you saw.

## In the app

1. Start trial mode:
```bash
npm run trial
```
   Click **About**. **Version 1.10.0, and a "New versions" section: ScribeForge never checks for new versions itself; a button "Open the releases page in your browser", and the address under it.** Click the button. **Your web browser opens ScribeForge's releases page on GitHub** (there may be no releases on it yet).
2. Click **Help**, then **Getting ScribeForge**. **Where releases are, why Windows warns about the installer, how to check a download with `Get-FileHash`, and what the version numbers mean.**
3. Close ScribeForge.

## A practice release

4. Run a practice release (about 3 minutes):
```bash
npm run release -- --practice
```
   **It builds the installer, builds the app a second time, then says "Practice release files for ScribeForge 1.10.0, in release\practice", "The app's own files came out the same on two builds", and that the files aren't for publishing.**
5. Open `release\practice`. **Three files, with no spaces in their names: ScribeForge-Setup-1.10.0.exe, ScribeForge-1.10.0-SHA256SUMS.txt and ScribeForge-1.10.0-notes.md.** No `.blockmap` or `.yml` file for 1.10.0 in `release` either.
6. Open the notes in Notepad. **What's new in 1.10.0 (from CHANGELOG.md), how to install, and how to check the download, with the installer's checksum. No folder paths with your name, and no email addresses.**
7. In File Explorer, open `release\practice`, type `powershell` in the address bar and press Enter. Type `Get-FileHash ".\ScribeForge-Setup-1.10.0.exe"` and press Enter. **The Hash is the same as the one in the notes.**

## The release script refuses when it should

8. Add a blank line at the end of `README.md` and save it. Run:
```bash
npm run release
```
   **"No release made:" and "There are changes that aren't committed (1 file)…". Nothing is built.**
9. Undo the change:
```bash
git checkout README.md
```

## Optional: a real release run (about 25 minutes)

Only after stop 4c is committed (the script refuses uncommitted changes).

10. Run `npm run release`. **It runs the typecheck, the unit tests and the whole-app tests on the development build and the packaged app, builds twice, and ends with the three files in `release` and the `gh release create …` command to publish them. "Nothing has been published."**

## Optional: installing and checking the app's own files (about 10 minutes)

11. Run `release\practice\ScribeForge-Setup-1.10.0.exe` (or `release\` after step 10). Windows warns that it's unsigned: **More info**, then **Run anyway**. Install **Only for me**.
12. Open the folder it was installed in (usually `%LOCALAPPDATA%\Programs\ScribeForge`) in PowerShell, as in step 7. Run `Get-FileHash .\ScribeForge.exe` and `Get-FileHash .\resources\app.asar`. **Both match the SHA256SUMS file.** _Needs verification: this is the first check of the installed files._
13. Uninstall it in **Settings > Apps > Installed apps** if you don't want to keep it.

## Publishing (only when you choose)

14. To let Claude publish when you ask, install GitHub's command-line tool and sign in to it yourself:
```bash
winget install --id GitHub.cli -e
```
```bash
gh auth login
```
   Then say "publish 1.10.0". Or publish on github.com yourself, as [docs/Releasing.md](../Releasing.md) describes.

## Finish

15. Delete `release\practice` if you like. Nothing else to clean up.
