# ScribeForge

An open-source, offline PDF toolkit for Windows: view, organise, annotate, inspect and redact PDFs, with signing and an encrypted archive to follow. ScribeForge is a BC6 app.

ScribeForge never sends anything over the network, and it never changes the files you open: edits save to new files.

**Status:** stop 1a (the app and the viewer) is built: open, view, search and copy from PDFs, with themes and settings. Version 0.1.0.

| Document | What it is |
|---|---|
| [docs/ScribeForge_Master_Outline.md](docs/ScribeForge_Master_Outline.md) | Vision, modules, look and feel, and the decisions approved on 2026-10-13 |
| [docs/ScribeForge_Claude_Code_Prompt.md](docs/ScribeForge_Claude_Code_Prompt.md) | The build prompt Claude Code works from |
| [docs/Roadmap.md](docs/Roadmap.md) | Phases and stops, with each stop's required checks |
| [docs/Phase0_Plan.md](docs/Phase0_Plan.md) | Phase 0 (approved): test results, dependencies, design and decisions |
| [docs/manual-tests/](docs/manual-tests/) | Step-by-step scripts for trying each stop |

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
| `npm run e2e:packaged` | Builds the installed-app version (`release\win-unpacked`) and runs its tests |
| `npm run dist` | Builds the Windows installer: `release\ScribeForge Setup <version>.exe` |
| `npm run fixtures` | Makes the test PDFs |
| `npm run notices` | Rebuilds `THIRD-PARTY-NOTICES.md` from the installed packages |
| `npm run icons` | Redraws `build/icon.png` from the icon draft |

**While the whole-app tests run,** test windows open on your left-most monitor and never take keyboard focus, so you can keep working on another screen. Each test uses its own throwaway data folder in the Windows temp folder, removed when the run finishes. Screenshots of every screen in every theme go to `test-results\screens\1a`, with a `contact-sheet.png`.

**The installer is unsigned,** so Windows shows "Windows protected your PC" the first time. Click **More info**, then **Run anyway**.

## Where things are

| Path | What it is |
|---|---|
| `src/main/` | The app process: window, menus, file dialogs, reading files, settings, the network guard |
| `src/preload/` | The small bridge the screens are allowed to call |
| `src/renderer/` | The screens (React), styles, and the pdf.js viewer |
| `src/shared/` | Code used by both sides: themes (the only place colours are defined), settings rules, link rules, pdf.js safety options |
| `tests/unit/` | Unit tests (Vitest) |
| `tests/e2e/` | Whole-app tests (Playwright), for the built app and the installed app |
| `scripts/` | Trial mode, test PDFs, icon and notices |
| `%APPDATA%\ScribeForge\settings.json` | Your settings and recent files (trial mode: `%APPDATA%\ScribeForge Trial`) |

## Safety rules the app keeps

- **No network.** The screens are served from the app's own files under a strict Content-Security-Policy, and every other request is cancelled. Tests prove it on both the development build and the installed app.
- **PDF JavaScript never runs.** pdf.js's scripting sandbox isn't included, and a test PDF that tries a dialog, a web request and opening a link proves nothing happens.
- **Your files aren't changed.** Opening only reads. Tests compare checksums before and after.
- **Web links in a PDF** show their address and ask before opening in your browser. Only `http`, `https` and `mailto` links can be opened.
- **Passwords** for protected PDFs are never stored.

## Interim parts, to match BC6 later

BC6 Business Manager's repo isn't on this PC yet (Phase 0 plan, question 1). Until it is, these are ScribeForge's own versions, to be lined up with BC6's:

- **Theme presets:** Light and Dark stand in for BC6's 7 presets. Cathedral and High Contrast stay.
- **The style-guard and contrast tests.**
- **Test-window placement** (`src/main/placement.ts`).
- **Trial mode.**
- **Folder layout and the README format.**

## Licence

[Apache-2.0](LICENSE). Third-party software is listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), which also ships with the app and is shown on its About screen.
