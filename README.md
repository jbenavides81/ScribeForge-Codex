# ScribeForge

An open-source, offline PDF toolkit for Windows: view, organise, annotate, inspect and redact PDFs, with signing and an encrypted archive to follow. ScribeForge is a BC6 app.

ScribeForge never sends anything over the network, and it never changes the files you open: edits save to new files.

**Status:** Phase 2 is under way. Version 1.4.0. You can:
- open, view, search and copy from PDFs;
- on the Pages screen, merge, split, reorder, rotate, delete, extract and insert blank pages;
- on the Document screen, highlight, underline and strike out text; add notes, text boxes, drawings, shapes (rectangles, ellipses, lines and arrows) and stamps; move and resize them; see every annotation in the comments panel; reply to comments; change or delete annotations already in the file; and burn annotations into the page;
- on the Details screen, see and change a file's title, author, subject and keywords, and see everything else it carries: attached files, form fields, comments, scripts, bookmarks, hidden layers, hidden page data and links;
- on the Clean up screen, make a copy without any of those: details, attachments, form fields and comments (burned into the page or removed), what's on hidden layers, bookmarks and hidden page data;
- on the Document screen in Redact mode, mark areas, selected text, every match of a search, or every email address, phone number, Social Security number, card number or listed word (Find patterns), check the marks, and save a redacted copy, keeping its details, bookmarks or comments if you choose, with a redaction log if you want one;
- from Command Prompt or PowerShell, merge, split, rotate, extract, show details and redact without opening the window (see [Command line](#command-line)).

Everything saves to a new file. Before saving, ScribeForge shows what the new file will carry (you can turn this off in Settings). Help is built in: press F1.

| Document | What it is |
|---|---|
| [docs/ScribeForge_Master_Outline.md](docs/ScribeForge_Master_Outline.md) | Vision, modules, look and feel, and the decisions approved on 2026-10-13 |
| [docs/ScribeForge_Claude_Code_Prompt.md](docs/ScribeForge_Claude_Code_Prompt.md) | The build prompt Claude Code works from |
| [docs/Roadmap.md](docs/Roadmap.md) | Phases and stops, with each stop's required checks |
| [docs/Phase0_Plan.md](docs/Phase0_Plan.md) | Phase 0 (approved): test results, dependencies, design and decisions |
| [docs/Plan_Phase2.md](docs/Plan_Phase2.md) | Phase 2 (approved): the Forge tools, with test results and decisions |
| [docs/Research_TextRemoval.md](docs/Research_TextRemoval.md) | Research (stop 2c): removing only what's under a redaction mark, with a prototype in [research/](research/) |
| [docs/manual-tests/](docs/manual-tests/) | Step-by-step scripts for trying each stop, and [v1-full.md](docs/manual-tests/v1-full.md) for the installed app |
| [content/help/](content/help/) | The help pages shown in the app (plain Markdown; edit them without touching code) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to work on ScribeForge |

## Installing ScribeForge

1. Build the installer (see [Setting up](#setting-up-windows) first):
   ```bash
   npm run dist
   ```
   It's saved as `release\ScribeForge Setup 1.4.0.exe`.
2. Run it. The installer isn't signed, so Windows shows "Windows protected your PC" the first time: click **More info**, then **Run anyway**.
3. Choose **Only for me** and where to install it (your user folder by default; no administrator rights needed). ScribeForge is then in the Start menu.

To remove it, use **Settings > Apps > Installed apps > ScribeForge > Uninstall** in Windows. Your settings stay in `%APPDATA%\ScribeForge`; delete that folder too if you want them gone.

## Command line

The installer puts `scribeforge.cmd` next to ScribeForge.exe, normally in `%LOCALAPPDATA%\Programs\ScribeForge`. It runs ScribeForge without its window, with the same engine and the same safety rules as the app.

```bash
"%LOCALAPPDATA%\Programs\ScribeForge\scribeforge.cmd" help
```

| Command | What it does |
|---|---|
| `scribeforge merge a.pdf b.pdf -o both.pdf` | Joins PDFs, in the order given |
| `scribeforge split report.pdf --every 5` | Splits into files of 5 pages, or `--ranges "1-3, 4-9"`, or one file per page |
| `scribeforge rotate report.pdf --pages "2, 4" --by 90` | Turns pages clockwise (90, 180, 270, or -90) |
| `scribeforge extract report.pdf --pages "1-3"` | Saves just those pages |
| `scribeforge info report.pdf --json` | Details and what the file carries (`--json` for scripts) |
| `scribeforge details report.pdf --title "Q3"` | A copy with the title, author, subject or keywords changed |
| `scribeforge redact report.pdf --find "John Smith"` | A redacted copy; also `--pages`, `--area` and `--dpi` |

- Without `-o`, the new file goes next to the first PDF, named the way the app names it, and never replaces a file. With `-o`, an existing file is replaced only with `--overwrite`. The files being read are never written over.
- Protected PDFs: a small window asks for the password, or add `--password-stdin` and send it as the first line of input. Passwords are never taken as part of the command.
- Exit codes: 0 done, 1 the command couldn't be followed, 2 a problem with a file, 3 a check failed and nothing was saved.
- The installer doesn't change your PATH. To type just `scribeforge` from any folder, add the install folder to your PATH yourself: Windows **Settings > System > About > Advanced system settings > Environment Variables**, then edit **Path** under your user's variables.
- From the source code, run it as `npx electron . <command> ...` after `npm run build`.

Full details are in the app's Help, under **Command line**.

## Setting up (Windows)

1. Install **Node.js 24** (it comes with npm):
   ```bash
   winget install --id OpenJS.NodeJS.LTS -e
   ```
2. Install the packages. This also downloads the Electron program (about 100 MB):
   ```bash
   npm install
   ```
3. Make the test PDFs. They go in `tests\fixtures\out`; they are made up and contain nothing real.
   ```bash
   npm run fixtures
   ```

## Trying it: trial mode

Trial mode runs ScribeForge from the source code with its own data folder (`%APPDATA%\ScribeForge Trial`), so trying things never touches your real settings or recent files. The title bar says "ScribeForge (trial)" and the navigation shows a trial badge.

```bash
npm run trial
```

It reloads by itself when the code changes. Close the window (or press Ctrl+C in the terminal) to stop. To delete the trial data:

```bash
npm run trial:reset
```

## Commands

| Command | What it does |
|---|---|
| `npm run trial` | Runs the app from source in trial mode |
| `npm run trial:reset` | Deletes the trial data folder |
| `npm run typecheck` | Checks the TypeScript |
| `npm test` | Unit tests, including the style-guard, contrast and third-party-notice checks |
| `npm run e2e` | Builds the app and runs the whole-app tests on it (Playwright) |
| `npm run e2e:packaged` | Builds the installed-app version (`release\win-unpacked`) and runs every whole-app test on it |
| `npm run dist` | Builds the Windows installer: `release\ScribeForge Setup <version>.exe` |
| `npm run fixtures` | Makes the test PDFs |
| `npm run notices` | Rebuilds `THIRD-PARTY-NOTICES.md` from the installed packages |
| `npm run icons` | Redraws the app icon (`build/icon.png`, `build/icon.ico`) and its contact sheet (`docs/icon-sheet.png`) |
| `npm start` | Builds the app and runs it as installed (with your real settings, not trial mode) |

**While the whole-app tests run,** test windows open on your left-most monitor, never take keyboard focus, and let your mouse pass straight through them, so you can keep working on another screen. Each test uses its own throwaway data folder in the Windows temp folder, removed when the run finishes. Screenshots of every screen in every theme go to `test-results\screens`, with a `contact-sheet.png`.

## Where things are

| Path | What it is |
|---|---|
| `src/main/` | The app process: window, menus, file dialogs, reading files, settings, the network guard, and the command-line tool (`src/main/cli/`) |
| `src/preload/` | The small bridge the screens are allowed to call |
| `src/renderer/` | The screens (React), styles, the pdf.js viewer, annotating, redacting, help, and the Pages screen with its worker |
| `src/engine/` | The PDF engine for the page tools, annotations, file details and redaction: plain TypeScript, run in a worker inside the window and in the unit tests |
| `src/shared/` | Code used by both sides: themes and the annotation colours (the only places colours are defined), settings rules, link rules, pdf.js safety options |
| `tests/unit/` | Unit tests (Vitest) |
| `tests/e2e/` | Whole-app tests (Playwright), for the built app and the installed app |
| `content/help/` | The help pages |
| `research/` | Research prototypes, not part of the app (stop 2c: removing only what's under a redaction mark). Their experiments run with the unit tests. |
| `build/` | The app icon, used by the installer, and `scribeforge.cmd`, the command-line launcher |
| `scripts/` | Trial mode, test PDFs, icon and notices |
| `%APPDATA%\ScribeForge\settings.json` | Your settings and recent files (trial mode: `%APPDATA%\ScribeForge Trial`) |

## Safety rules the app keeps

- **No network.** The screens are served from the app's own files under a strict Content-Security-Policy, and every other request is cancelled. Tests prove it on both the development build and the installed app.
- **PDF JavaScript never runs.** pdf.js's scripting sandbox isn't included, and a test PDF that tries a dialog, a web request and opening a link proves nothing happens.
- **Your files aren't changed.** Opening only reads. Tests compare checksums before and after.
- **Web links in a PDF** show their address and ask before opening in your browser. Only `http`, `https` and `mailto` links can be opened.
- **Passwords** for protected PDFs are never stored. Saving pages from a protected file warns first that the new file will have no password.
- **Page tools always build a brand-new file.**
    - Deleted or left-out pages can't hide inside it: links are re-pointed before copying, and leftovers are swept out before saving.
    - Links and bookmarks point at the right pages of the new file, or are left out if their page isn't there.
    - Scripts and other actions in the pages are removed.
    - Saving over the original asks a second, plain question first.
- **Annotations are standard PDF annotations,** each with its own look, so Edge, Acrobat and other readers show the same thing. They're only added to the new file when you save. Your name goes on them only if you type it in Settings. Replies point at the comment they answer, as other readers expect.
- **Annotations already in a file are changed in place, in the new file only.** A changed one keeps its author, date and replies; a deleted one is left out of the new file completely, with its replies, not just hidden.
- **Burning in is real.** A burned-in annotation is drawn into the page exactly where it was (as the PDF standard describes) and the annotation itself is removed, so it can't be changed or removed. Tests check the page looks the same.
- **No hidden surprises.** Before every save, a list shows what the new file carries besides its pages. Scripts and files attached to the whole document are never copied into new files.
- **A file's details are kept in two places** (the classic details and a copy in XMP format). New files always get both, matching, so old values can't linger in either.
- **Hidden layers stay hidden** in new files, and the list says they're there, because what's on them is still in the file. Clean up can take what's on them out of the pages; the pages look the same (tested pixel for pixel).
- **Redaction removes, it doesn't cover.**
    - Every page with a mark becomes a picture of the page with the marks blacked out, so none of its text is left. Pages without marks are copied as they are.
    - Search and selected-text marks are built from where each letter really is, so no edges of letters show.
    - The redacted file keeps only the pages and the links between them: no details, comments, form fields, bookmarks, attached files or scripts.
    - A last check searches the redacted file for every search term and pattern match whose matches were all marked. Tests check the same for text placed in the page, a comment, the title, a bookmark and an attachment.
    - The redaction log, if you ask for one, never contains the removed text: only hints such as `j•••@e•••.com`. A test searches it for every redacted value.
- **The installed program is locked down.** Electron's switches are set in ScribeForge.exe itself: it can't be used to run other scripts as Node.js, ignores `NODE_OPTIONS`, loads only its own packaged files, and refuses to start if those files have been changed. Tests read the switches back from the installed build.
- **The command line keeps the same rules** as the app: no network, inputs never changed or written over, PDF scripts never run, passwords never stored, and redaction checked the same way.
- **Files locked by their author** (no password needed to open, but limits on copying or changes) can be viewed and their pages saved. ScribeForge says first that the new file won't have those limits.

## Interim parts, to match BC6 later

BC6 Business Manager's repo isn't on this PC yet (Phase 0 plan, question 1). Until it is, these are ScribeForge's own versions, to be lined up with BC6's:

- **Theme presets:** Light and Dark stand in for BC6's 7 presets. Cathedral and High Contrast stay.
- **The style-guard and contrast tests.**
- **Test-window placement** (`src/main/placement.ts`).
- **Trial mode.**
- **Folder layout and the README format.**

## Licence

[Apache-2.0](LICENSE). Third-party software is listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), which also ships with the app and is shown on its About screen.
