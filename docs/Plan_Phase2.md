# ScribeForge: Phase 2 plan (Forge tools)

_2026-10-21. **Approved 2026-10-21:** "go", with every recommendation in section 10 accepted._

Phase 1 ended with ScribeForge 1.0.0: viewing, page tools, basic annotations, details and "what this file carries", and redaction. Phase 2 adds the Forge tools from the roadmap: a command-line tool, the full set of annotations, advanced redaction, a clean-up tool and signing.

**The short version:**
- I tested the open questions first. Four tests worked, and one turned up something to fix.
- **The command-line tool can live inside the app** (no second runtime to install): ScribeForge.exe has a command-line mode, started through a small `scribeforge.cmd`. Tested: it prints to the console and returns exit codes.
- **The installed app has three of Electron's riskier switches still on.** The worst lets any program run code through ScribeForge.exe. Turning them off is the first thing in 2a, and the command-line design above doesn't need them.
- **Flattening annotations into the page works:** the page looked identical, pixel for pixel, after three annotations were burned in.
- **Removing hidden layers for real works:** a hidden layer's text was cut out of the page, gone from the file, and the page looked identical.
- **Signing has good open-source parts** (MIT and BSD licences), but it's big enough to need its own research and plan before stop 2e.

---

## 1. Where Phase 1 left things

Carried into Phase 2, from Phase 1's reports:
- **Annotations that were already in a file** can't be changed or deleted yet, and ScribeForge's own notes and text boxes can't be moved or resized (stop 1c). → 2b.
- **A redacted file keeps nothing but pages.** There's no choice yet to keep, say, its bookmarks (stop 1e, from the Phase 0 plan's question 5). → 2d.
- **BC6 parts are still ScribeForge's own versions:** the theme presets, the style-guard and contrast tests, test-window placement, trial mode and the README format. BC6 Business Manager's repo still isn't on this PC (question 1).

---

## 2. What I tested (2026-10-21)

Small experiments, in a throwaway test file that isn't kept, on this PC with the app's own versions (Electron 44.7.2, pdf.js 6.4.299, @cantoo/pdf-lib 2.11.1).

| # | Question | Result | What Phase 2 does about it |
|---|---|---|---|
| F1 | Can the installed ScribeForge.exe be used as a plain Node.js program? | **Yes.** With `ELECTRON_RUN_AS_NODE=1` it runs any script. Its build also accepts `NODE_OPTIONS`, can load the app from outside its own package, and grants the old `file://` extra rights. All four are Electron's defaults; Electron's security checklist says to turn them off ("fuses"). | 2a turns them off in the installer build (question 2). |
| F2 | Does Playwright still work with those switches off? | **Mostly.** Playwright starts Electron with `--inspect=0`, so the switch that allows `--inspect` has to stay on, or the whole-app tests can't drive the installed app. The others can go. | The `--inspect` switch stays on (question 2). |
| F3 | Can the app itself be the command-line tool, without the run-as-Node switch? | **Yes.** An Electron main process with no window printed to standard output and standard error, and its exit code (3 in the test) came back through a `.cmd` launcher, which waited for it to finish. Electron connects to the console it was started from. _Needs verification: tested through a pipe; the 2a manual script checks an ordinary Command Prompt window._ | 2a's design (section 4). |
| F4 | Can a standalone command-line program be built instead? | **Yes, but big.** Node 24 can bundle a script into its own `.exe` (single executable application, still experimental), but that's a second copy of Node: about 93 MB. | Not recommended (question 3). |
| F5 | Can annotations be flattened into the page (burned in, so they can't be removed)? | **Yes.** I drew each annotation's own appearance onto the page where it sits (ISO 32000-1, section 12.5.5), then removed the annotation. A highlight (with its Multiply blending), an underline and a text box: **0 of 1,938,816 pixels differed** from the page drawn with the annotations. Notes without an appearance of their own (readers draw their icon) can't be flattened this way. | 2b's flatten, and 2d's "flatten comments". Notes get an appearance written by ScribeForge first. |
| F6 | Can what's on a hidden layer be removed from a page, not just hidden? | **Yes.** A small reader for a page's drawing instructions (handling text, arrays, dictionaries and inline images) cut out every instruction inside the hidden layer's marked section. The hidden text was then **found nowhere in the file**, the visible text was still drawn, and the page looked **pixel for pixel the same**. | 2d's "remove hidden layers", and the base for 2c's research. |
| F7 | What can sign and check PDF signatures, offline, with acceptable licences? | **@signpdf** 4.0.0 (MIT, updated 2026-10-19) signs; it relies on **node-forge** 1.4.0 (BSD-3-Clause or GPL-2.0: usable under BSD). **pkijs** 3.4.3 and **asn1js** 4.0.0 (BSD-3-Clause) read and check signatures. @signpdf's pdf-lib helper expects the original pdf-lib, not the fork. The fork can save changes as an update to the end of a file, which signing needs. | Researched properly in 2e's own plan (section 7). |

---

## 3. Dependencies

**No new packages for stops 2a to 2d.** The command-line tool uses Electron and Node's own argument parser (`util.parseArgs`); flattening, clean-up and the pattern search use the existing engine and pdf.js.

**Stop 2e (signing)** will need some of the packages in F7. Its own plan lists them with versions, licences and sizes for your approval, as the build prompt requires.

---

## 4. Stop 2a: the command-line tool (version 1.1.0)

**What it does.** A `scribeforge` command for the jobs that make sense without a screen, using the same engine and the same safety rules as the app:

| Command | Example |
|---|---|
| Merge | `scribeforge merge a.pdf b.pdf -o both.pdf` |
| Split | `scribeforge split report.pdf --every 1 -o folder` or `--ranges "1-3, 5"` |
| Rotate | `scribeforge rotate report.pdf --pages 2,4 --by 90 -o turned.pdf` |
| Extract | `scribeforge extract report.pdf --pages 1-3 -o first.pdf` |
| Details | `scribeforge info report.pdf` (details and what it carries; `--json` for scripts) and `scribeforge details report.pdf --title "Q3" -o titled.pdf` |
| Redact | `scribeforge redact report.pdf --pages 2 --area 2:72,600,300,640 -o out.pdf`, by whole page or by area (in points, or `mm`), plus `--find "word"` like Find and mark |

**How it's built** (F1 to F3):
- **One program.** ScribeForge.exe starts in command-line mode when its first word is a command. It opens no window, prints plain messages, and exits with a code: 0 for done, 1 for a mistake in the command, 2 for a file problem, 3 when a check fails (such as the redaction check).
- **A launcher.** A `scribeforge.cmd` next to ScribeForge.exe, so it can be run from Command Prompt and PowerShell, and from scripts.
- **Where things run.** Page tools and details run in the main process with the engine. Redaction draws pages through a hidden window, with the same code the app uses, so results match the app.
- **The same rules as the app:**
  - no network, with the same request blocker;
  - inputs never changed, and no file is ever written over an input;
  - an existing output file is never replaced unless `--overwrite` is given (question 5);
  - PDF scripts are never run;
  - passwords are asked for at the console, never taken on the command line, where they'd stay in the console's history.
- **Hardening first** (F1, F2). The installer build turns off running as Node, `NODE_OPTIONS`, loading the app from outside its package, and the extra `file://` rights. It turns on checking that the app's own files haven't been changed (question 2). _Needs verification: that check on Windows with Electron 44._

**Required checks:**
- Each command's result matches the app's for the same job: same pages, text, links, bookmarks and details. Compared by reading the files, not byte for byte, since the dates differ.
- Every command makes no network requests, and inputs' checksums are unchanged.
- Redaction from the command line passes the Phase 1 redaction check: the test term is found nowhere.
- Bad commands, missing files, wrong passwords and damaged PDFs give a plain message and the right exit code, never a crash.
- The installed app's switches read back as set (with `@electron/fuses`, already installed with electron-builder).
- The command-line tests run on the installed build too.

---

## 5. Stop 2b: the full set of annotations (version 1.2.0)

**What it adds** (question 6):
- **Drawing:** freehand ink, with pen thickness.
- **Shapes:** rectangle, ellipse, line and arrow, with line thickness and an optional fill from the palette.
- **Stamps:** Approved, Draft, Confidential, Reviewed and Not approved, each with the date. Also a stamp with your own short text.
- **Moving and resizing** notes, text boxes, shapes, stamps and drawings; text boxes get a choice of text size.
- **A comments panel** beside the page. It lists every annotation in the file, old and new, by page, with its author and text. Filter by author or kind, and click one to go to it.
- **Replies:** reply to any comment; replies show under it, as in other readers.
- **Annotations already in the file** (question 7): change their colour and text, reply to them, or delete them.
- **Flatten** (F5): burn chosen annotations, or all of them, into the page when saving, so they can't be changed or removed. Notes get an appearance drawn by ScribeForge first.

Every new kind is saved as a standard PDF annotation with its own appearance, so other readers show the same thing.

**Required checks:**
- Each new kind reads back through pdf.js with its type, colour, author, text and position, after saving and reopening (as stop 1c).
- Changes to annotations that were already in the file are saved; deleted ones are gone from the file, not just hidden.
- Replies read back as replies to the right comment (`IRT`).
- Flattened pages look the same, pixel for pixel, as the page drawn with its annotations (F5), and no flattened annotation is left in the file.
- The manual script opens every kind in Microsoft Edge.

---

## 6. Stop 2c: advanced redaction (version 1.3.0)

**What it adds:**
- **Find patterns** (question 8): email addresses, phone numbers, US Social Security-number shapes (###-##-####) and card numbers (checked with the Luhn rule so random digits don't match). Also a list of words or phrases, one per line. Matches are listed by pattern and page for you to tick or untick before marking.
- **A redaction log** (question 9): a plain-text file saved next to the redacted file. It lists the date, the files, the settings, and each mark's page, kind and pattern. It never contains the removed text itself, only a masked hint such as `j•••@e•••.com`, because a log that repeats the secret would undo the redaction. It's offered each time, and off by default.
- **Research: true text removal** (question 10). Today every marked page becomes a picture. The research answers whether ScribeForge can instead remove just the marked letters, pictures and drawings from the page's own instructions, keeping the rest of the page as real text.

  What it has to handle, using F6's reader:
  - working out each letter's position from the font's own widths;
  - pictures under a mark, blacked out in the picture itself;
  - drawings under a mark;
  - text inside forms shared between pages;
  - Type 3 fonts.

  It ends in a written report, with a prototype and a list of what passes and fails. Building it would be its own stop, only after you've seen the report. Pictures stay the default either way.

**Required checks:**
- Each pattern finds its matches in a test PDF of made-up examples and misses its look-alikes. For example, a 16-digit number that fails the Luhn check isn't marked as a card number.
- After redacting by pattern, the Phase 1 check passes: every matched value is found nowhere.
- The log contains no removed text: a test searches it for every redacted value.

---

## 7. Stop 2d: the clean-up tool, "Patchworks" (version 1.4.0)

**What it does.** A **Clean up** screen that uses the Details screen's list ("what this file carries"). You tick what to remove, see a report, and save `<name> (cleaned).pdf`:
- the document's details (classic and XMP), including non-standard ones;
- attached files, for the whole document and on pages;
- scripts and actions;
- form fields: flatten them (keep how they look, remove the fields and their data) or remove them completely (question 11);
- comments: flatten them (F5) or remove them;
- hidden layers: their content is removed from the pages (F6), not just left hidden;
- bookmarks;
- hidden page data: data other programs keep with a page, and page thumbnails.

**Redaction's "what to keep"** (question 12): the redaction summary gains the same choices, so a redacted file can keep, say, its bookmarks. The default stays as now: keep nothing.

**Required checks:**
- A test file carrying one of each item (Phase 1's `carries.pdf`, plus a hidden layer with text) is cleaned of everything. "What this file carries" then reads None for each item, and each item's test text is found nowhere in the file.
- Removing only some items leaves the rest exactly as they were.
- Hidden-layer removal: the page looks the same, pixel for pixel, and the hidden text is found nowhere (F6).

---

## 8. Stop 2e: signing, "Sealkeeper" (version 1.5.0)

Signing gets **its own research and plan, `docs/Plan_Sign.md`, before any code**, as the roadmap says. That plan will answer:
- **Where certificates come from:** a `.pfx` or `.p12` file you choose, the Windows certificate store, or a smart card. The last two need Windows' own security functions, and maybe a native part.
- **What a signature looks like:** invisible, or a visible box on the page with name, date and reason.
- **Checking signatures without the internet.** ScribeForge never goes online, so it can't check whether a certificate was revoked, or get a trusted time stamp. The plan says what it *can* check: that the file hasn't changed since signing, and who signed it. It also covers how you'd choose which certificates to trust, and how all this is explained in plain words.
- **Libraries** (F7): @signpdf with node-forge (used under its BSD licence), pkijs and asn1js, and whether @signpdf works with the pdf-lib fork.
- **Signed files and ScribeForge's tools.** Every ScribeForge save builds a new file, which breaks any signature in the original. The app must say so before saving a signed file.

---

## 9. Versions

Each Phase 2 stop adds 0.1: **1.1.0** (2a), **1.2.0** (2b), **1.3.0** (2c), **1.4.0** (2d) and **1.5.0** (2e). Nothing in Phase 2 breaks what 1.0 does, so it stays version 1 (question 13).

Every stop ends as Phase 1's did: the build prompt's section 6 checks, screenshots in every theme, a manual test script, help pages updated, and the README.

---

## 10. Questions for you

1. **BC6.** Can you push BC6 Business Manager to a private GitHub repo, so ScribeForge can match its themes, style tests and process?
   _I recommend yes, whenever it suits you. When it's there, a short "match BC6" stop goes first, before whichever Phase 2 stop is next. Until then, Phase 2 carries on with ScribeForge's own versions._
2. **Electron's switches** (F1, F2). Turn off running as Node, `NODE_OPTIONS`, loading the app from outside its package, and the extra `file://` rights? Turn on checking that the app's own files haven't been changed? Keep `--inspect`, which the whole-app tests need?
   _I recommend yes to all, at the start of 2a._
3. **How the command-line tool ships.** Inside ScribeForge.exe with a `scribeforge.cmd` launcher (F3)? Or a separate program with its own copy of Node, about 93 MB more (F4)? Or a package that needs Node.js installed?
   _I recommend inside ScribeForge.exe: nothing extra to install, and the same engine and checks._
4. **The command on the PATH.** Should the installer add `scribeforge` to your PATH, so it works from any folder?
   _I recommend not by default. The installer leaves the PATH alone, and the README shows the full path, plus a one-line way to add it yourself._
5. **Overwriting from the command line.** Never write over an input file, and replace an existing output only with `--overwrite`?
   _I recommend yes._
6. **2b's list:** ink, rectangle, ellipse, line and arrow, the five stamps plus your own text, moving and resizing, the comments panel, replies and flattening.
   _I recommend this list. Anything else (such as sound or video annotations) waits._
7. **Annotations already in a file.** Let you change, reply to and delete them?
   _I recommend yes. Today they can only be viewed._
8. **2c's patterns:** emails, phone numbers, SSN-shaped numbers and Luhn-checked card numbers, plus your own word list.
   _I recommend these. More patterns can come later._
9. **The redaction log.** Off by default, offered each time, and never containing the removed text?
   _I recommend yes._
10. **True text removal.** Research in 2c, ending in a report and a prototype, with building it as a later stop only if you agree after reading the report?
    _I recommend yes. Pictures stay the default either way._
11. **Form fields in clean-up.** Flatten (keep the look, remove the fields and their data) by default, with "remove completely" as the other choice?
    _I recommend flatten by default: it keeps what the page shows._
12. **What a redacted file keeps.** Add clean-up's choices to the redaction summary, with "keep nothing" still the default?
    _I recommend yes._
13. **Versions.** 1.1.0 to 1.5.0, one per stop?
    _I recommend yes._
14. **Signing.** Its own research and plan (`docs/Plan_Sign.md`) before stop 2e?
    _I recommend yes, as the roadmap says._

~~Answer by number, or say "go" to accept every recommendation.~~ Approved 2026-10-21, with every recommendation accepted. Stop 2a is next.
