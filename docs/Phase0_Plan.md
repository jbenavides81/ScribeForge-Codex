# ScribeForge: Phase 0 plan

_2026-10-15. **Approved 2026-10-15:** "go", with every recommendation in section 14 accepted. Stop 1a starts once the BC6 repo can be cloned here (question 1)._

This plan follows section 8 of the build prompt. It's written on this PC, not the BC6 PC: you decided to build ScribeForge here. BC6 Business Manager's repo isn't on this PC, so everything ScribeForge copies from it is marked **to match BC6** and needs that repo (question 1).

**The short version:**
- I tested the open questions instead of guessing, and four of them turned up real problems.
- **Deleting a page** leaves the page inside the saved file.
- **Extracting a page that links to another page** drags a hidden copy of the linked page along.
- **Changing the title** leaves the old title in a second, hidden copy of the file's details (XMP).
- **The original pdf-lib** can't open password-protected files and hasn't had a release since 2021.
- Each problem has a tested fix, built into the stops below.
- A working redaction prototype removed a test term from all 5 places it was planted.

---

## 1. What I tested (2026-10-15)

The scratch experiments ran on this PC with Node 24.19.0, using `@cantoo/pdf-lib` 2.11.1, `pdf-lib` 1.17.1 and `pdfjs-dist` 6.4.299. The two pdf-lib versions behaved the same in every test.

| # | Question | Result | What ScribeForge does about it |
|---|---|---|---|
| E1 | Does changing the title update all of the file's details? | **No.** It updates the Info dictionary only. The XMP metadata stream still says "Old Title". | Metadata edits update both. If XMP can't be read, the app says so and offers to remove it (stop 1d). |
| E2 | Do links and bookmarks survive merge, split and reorder? | **No**, when pages are copied into a new file. Internal links point to hidden duplicate pages, and bookmarks are dropped. | A page engine re-points links and bookmarks to pages in the output and drops the rest (stop 1b). |
| E3a | Does extracting page 1 include anything else? | **Yes**, if page 1 links to page 3. Page 3's content was copied into the new file, hidden. | Links are re-pointed before copying, so nothing is dragged along. Covered by a test (stop 1b). |
| E3b | Does deleting a page remove it from the file? | **No.** Its content stays in the saved file. | Before every save, unreachable objects are swept out. Tested: the deleted page's content was then gone (stop 1b). |
| E3c | Can pages be reordered without breaking links? | **Yes**, by rewriting the page list instead of copying pages. Links and bookmarks stayed correct. | Reorder, rotate and delete work this way. |
| E4 | Does the redaction design work? | **Yes.** The test term was planted in 5 places (body text, a comment, the title, a bookmark, an attachment's name). The scanner found it at 8 spots in the source, because some places store it twice. After redaction it was found nowhere, and the redacted page had no extractable text. Unmarked pages kept their text, and the link on page 1 still worked. | This is the stop 1e design. |
| E4 | Redaction cost per page (letter size, text-heavy) | PNG: 150 DPI 402 KB, 0.45 s · **200 DPI 561 KB, 0.5 s** · 300 DPI 905 KB, 1.1 s. JPEG was no smaller and blurs text. | PNG at 200 DPI by default, with a setting for 150, 200 or 300. |
| E4 | Box placement | A hand-placed box left a sliver of one letter showing. | Boxes made from text search use pdf.js's exact letter positions plus padding. The manual test checks no edges show. |
| E5 | Password-protected PDFs | The fork opens them with the right password and refuses a wrong one. The original pdf-lib refuses encrypted files entirely. Pages saved from a protected file come out **without** a password. | Use the fork. Saving from a protected file warns that the new file has no password (question 9). |
| E6 | Can PDF JavaScript run in pdf.js 6.4? | Only through a separate scripting sandbox (`pdf.sandbox.mjs`) wired up deliberately. The annotation layer's `enableScripting` is off unless set. `isEvalSupported` no longer exists in 6.x. | ScribeForge never ships the sandbox and never sets `enableScripting`. A test with a scripted PDF confirms nothing runs (stop 1a). |

---

## 2. BC6 reuse list (for your approval)

ScribeForge can't copy anything from BC6 until the BC6 repo is reachable from here (question 1). The list below is what I'd copy then. The repo is public and Apache-2.0, so anything copied is published.

| From BC6 Business Manager | Plan | Note |
|---|---|---|
| Theme presets and colour tokens (7 presets, High Contrast, Match system, 3 text sizes) | **Copy** | Cathedral is added as an 8th preset |
| Style-guard test | **Copy** | Exempt only the annotation colour palette file |
| Contrast test | **Copy** | Run over every preset, including Cathedral |
| `src/main/placement.ts`, `playwright.config.ts` placement setting | **Adapt** | Check this PC's monitors in stop 1a |
| Trial mode (`npm run trial`, `trial:reset`, separate data folder) | **Adapt** | The folder becomes `%APPDATA%\ScribeForge Trial` |
| Electron window security, Content-Security-Policy, preload and IPC pattern | **Copy** | |
| Network-blocking check in the whole-app tests | **Copy** | |
| `electron-builder.yml`, packaged-app test | **Adapt** | ScribeForge's name, icon and appId |
| How Inter is bundled | **Copy** | |
| README and manual-test script format | **Copy the format** | |
| Bookkeeping code, the encrypted database, your data | **Never** | |
| BC6 cube logo, BC6 lock-screen artwork | **Never** | ScribeForge has its own icon |

---

## 3. Dependencies

**Shipped in the app.** Everything is bundled into the app's code, so the packaged app carries no `node_modules` for these.

| Package | Version | Licence | Why |
|---|---|---|---|
| electron | 44.7.2 (Node 24.21, Chrome 152) | MIT | The app runtime. It matches the Node 24 on this PC. |
| react, react-dom | 19.3.1 | MIT | Screens, as in BC6 |
| pdfjs-dist | 6.4.299 | Apache-2.0 | Viewing, text selection, search, and rendering redacted pages. Only the files used are bundled: the main build, worker, standard fonts and CMaps. |
| @cantoo/pdf-lib | 2.11.1 (released 2026-09-15) | MIT | Page tools, annotations, metadata and building output files. It's a maintained fork of pdf-lib with the same API, and it decrypts password-protected files. |
| ↳ fflate, culori, node-html-better-parser, html-entities, tslib | 0.8.3, 4.0.2, 1.5.9, 2.6.0, 2.8.1 | MIT ×4, 0BSD | Pulled in by the fork, for compression and its SVG and HTML drawing features |
| Inter font files | to match BC6 | OFL-1.1 | Bundled exactly as BC6 bundles them |

**Build and test only (not shipped):**

| Package | Version | Licence | Why |
|---|---|---|---|
| typescript | 7.0.2 | Apache-2.0 | Typecheck |
| build tool: electron-vite 6.0.0 + vite 8.3.4 | to match BC6 | MIT | Builds the main, preload and renderer bundles. If BC6 uses something else, ScribeForge uses that instead. |
| vitest | 5.0.5, to match BC6 | MIT | Unit tests |
| @playwright/test | 1.64.1 | Apache-2.0 | Whole-app tests |
| electron-builder | 26.15.3 | MIT | The installer |
| @napi-rs/canvas | 1.0.11 | MIT | Installed automatically with pdfjs-dist. Lets unit tests render pages outside Electron. |

**Considered and not chosen:**
- `pdf-lib` 1.17.1: last release 2021-11-06, and it can't open password-protected files.
- `@pdfme/pdf-lib`: a fork maintained for the pdfme project's own needs.
- MuPDF: AGPL.
- A settings library or SQLite in Phase 1: not needed until the Archive (section 5).

All the forks have the same E1–E3 problems, so ScribeForge's page engine is needed whichever pdf-lib is used.

---

## 4. Folder layout

This follows BC6; exact names are to match BC6.

```
src/main/          window, menus, file dialogs, reading and writing files, settings, IPC handlers, placement
src/preload/       the small bridge the screens can call (open, save, settings)
src/renderer/      screens (React), themes, styles, the pdf.js viewer
src/engine/        the PDF engine: page tools, link re-pointing, sweep, metadata, redaction, file scan.
                   Plain TypeScript with no Electron, so it runs in the app and in unit tests.
src/shared/        types used by more than one part
content/help/      help pages (Markdown), from stop 1f
tests/unit/        *.test.ts (engine, settings, style guard, contrast)
tests/e2e/         *.spec.ts (Playwright, dev build and packaged app)
tests/fixtures/    make-fixtures.ts generates every test PDF; no real documents
docs/              build prompt, outline, roadmap, plans, manual-tests/, phase0/
```

**Where the PDF work runs.** PDFs are untrusted input. All parsing and editing happens inside the sandboxed window (the engine runs in a worker there). The main process only:
- shows file dialogs;
- reads the bytes of the file you chose;
- writes the bytes of the file you saved.

A broken or hostile PDF therefore never runs with full Windows access (question 3).

---

## 5. Settings and recent files

- **Storage:** `%APPDATA%\ScribeForge\settings.json`, written safely (to a temporary file, then renamed) and checked when read. A damaged settings file is set aside and defaults are used, with a message. There's no database until Phase 3.
- **What it holds:** theme, text size, author name for annotations, redaction resolution, the "remember recent files" switch, and the recent files list.
- **Recent files:** the last 10 paths, paths only. They can be cleared, and the list can be turned off. File names can be sensitive, so the switch is on the first Settings screen.

---

## 6. Theme tokens

**BC6's presets:** copied exactly once the BC6 repo is reachable. Their names (only Eclipse, Emergence and Void are known so far) and values are to match BC6.

**Cathedral** (draft, checked on 2026-10-15). Token names will follow BC6's.

| Role | Colour | Contrast | Needs |
|---|---|---|---|
| Background | #0F0F11 Obsidian | — | — |
| Panel | #18191D | — | — |
| Raised panel | #22242A | — | — |
| Text | #C7C9CC Forge Steel | 11.54 on background, 10.58 on panel, 9.35 on raised | 4.5 |
| Muted text | #9A9DA3 | 7.04 / 6.46 / 5.71 | 4.5 |
| Accent, headings | #D9A441 Runic Gold | 8.51 / 7.81 | 4.5 |
| Links, focus rings | #5B8FD9 | 5.81 / 5.33 / 4.71 | 4.5 |
| Input outlines | #6E737C | 4.02 / 3.69 | 3 |
| Errors | #F08A80 | 7.89 / 7.24 | 4.5 |
| Primary button | #1A4C8B Cathedral Blue fill, #FFFFFF text, #5B8FD9 outline | white on blue 8.57 · outline 5.81 | 4.5 / 3 |

Cathedral Blue used as text or as a button edge measures 2.23. That fails, which is why it's only a fill with an outline. BC6's contrast test makes the final call.

---

## 7. Icon

The first draft is [docs/phase0/icon-draft.svg](phase0/icon-draft.svg): a quill crossing an anvil, as flat line art in the theme's text or accent colour. Its contact sheet is [icon-draft-sheet.png](phase0/icon-draft-sheet.png), at 16, 24, 32, 48 and 128px on Cathedral, light and dark backgrounds.

- **What works:** at 32px and up, it reads clearly as an anvil with a quill.
- **What doesn't:** at 16 and 24px it turns to mush. Stop 1f adds a simplified small version: the anvil with a single quill stroke and thicker lines.
- **Still to come:** the final icon, "by BC6" in About and the installer, and the check against BC6's presets all come in stop 1f.

---

## 8. PDF safety

- **pdf.js options:**
  - `data` (bytes from the main process; never `url`);
  - `enableXfa: false`;
  - `useWorkerFetch: false`;
  - `standardFontDataUrl`, `cMapUrl`, `wasmUrl` and `iccUrl` pointing to files bundled in the app;
  - `stopAtErrors: false`, so damaged pages show what they can;
  - a `maxImageSize` and `canvasMaxAreaInBytes` cap against huge images.
- **No PDF JavaScript:** `pdf.sandbox.mjs` is never bundled, the scripting manager is never used, and `enableScripting` stays off.
- **Backstops:** the Content-Security-Policy blocks all network access (`connect-src 'none'`). The whole-app tests confirm zero requests, including with a fixture whose script tries to make one.
- **Damaged files:** a plain message, never a crash. The fixtures include a truncated file, a file with a broken cross-reference table, and a file that isn't a PDF.
- **Web links inside a PDF:** clicking one shows the address and asks before opening it in your browser (question 11).
- **Size and time targets** (question 10):

| Action | Target |
|---|---|
| A 500-page file shows its first page | under 2 seconds |
| Thumbnails | load as you scroll |
| Merging two 500-page files | under 10 seconds |
| Redaction | about 0.5 seconds per marked page at 200 DPI |

---

## 9. Redaction design (stop 1e)

1. **Marking.** Draw boxes, or search for text: each match becomes a box from pdf.js's letter positions, plus 1pt of padding. You review the list of marks before applying.
2. **Applying:**
   - Every marked page is rendered at the chosen resolution (default 200 DPI, PNG), the boxes are burned in, and the image becomes the new page. Its text is gone, so it can't be selected or searched.
   - Unmarked pages are copied as they are.
   - The output is a brand-new document, `<name> (redacted).pdf`. The original is never changed.
3. **What the redacted file keeps by default:**
   - unmarked pages' content;
   - internal links on unmarked pages, re-pointed to pages in the output.

   It drops comments, form fields, bookmarks, attachments, document metadata, JavaScript, and links on marked pages (question 5). A summary lists what was redacted and what was dropped.
4. **The check, on every redacted file in the tests:**
   - Every string and every decompressed stream is searched for the term, in plain, UTF-16 and hex forms, and it must be found nowhere.
   - pdf.js extracts no text from marked pages.
   - Unmarked pages extract the same text as the source.
   - The source's checksum is unchanged.
   - The fixture plants the term in body text, a comment, the title, a bookmark, an attachment's name, and the attachment's contents. The prototype covered all but the contents.

---

## 10. Metadata (stop 1d)

- **Title, author, subject and keywords** are edited in both places: the Info dictionary, and the XMP stream (`dc:title`, `dc:creator`, `dc:description`, `pdf:Keywords`, plus the modify date). E1 showed pdf-lib alone leaves the old values in XMP.
- **XMP that can't be read safely:** the app says so and offers to remove it.
- **The test:** after an edit, Info and XMP both read back the new values, and the old ones are found nowhere in the file.
- **"What this file carries"** lists:
  - metadata (Info and XMP);
  - attachments;
  - form fields;
  - comments;
  - JavaScript;
  - bookmarks;
  - hidden layers;
  - links;
  - whether the file is password-protected.

---

## 11. Page operations (stop 1b)

The page engine has three safety parts:

1. **Reorder, rotate and delete** rewrite the page list in place, keeping the same page objects (E3c).
2. **Merge, split and extract:**
   - Links and bookmarks are re-pointed to pages in the output before copying, and the rest are dropped (E2, E3a).
   - Merging keeps each file's bookmarks under a bookmark named after that file.
3. **Before every save,** anything no longer reachable from the document is swept out (E3b).

**Required tests on top of the roadmap's:**
- After delete, extract and split, the removed pages' text is found nowhere in the output.
- Every link and bookmark in the output points to a page in the output.

---

## 12. Phase 1 stops

These match `docs/Roadmap.md`. Additions from this plan are in bold.

| Stop | Content | Added required checks |
|---|---|---|
| 1a | App, settings, themes (BC6 presets + Cathedral), viewer, recent files, trial mode, installer skeleton | **Scripted-PDF fixture runs nothing. Damaged fixtures show a message. A password-protected file opens with its password.** |
| 1b | Pages: merge, split, reorder, rotate, delete, extract, insert blank | **Removed pages are found nowhere. Every link and bookmark points inside the output.** |
| 1c | Annotate (basic) | as in the roadmap |
| 1d | Metadata and "what this file carries" | **Info and XMP agree, and old values are found nowhere.** |
| 1e | Redact | **The 6-place term test, letter-position boxes, and the no-text check on marked pages** |
| 1f | Help, icon set (with the small-size version), installer, full manual test, CONTRIBUTING, notices | as in the roadmap |

---

## 13. Versions and names

- **Version:** 0.1.0 at stop 1a, then up by 0.1 each stop (0.2.0 at 1b, and so on), and 1.0.0 at stop 1f.
- **App:** product name "ScribeForge", appId `com.bc6.scribeforge`.
- **Installer:** `ScribeForge Setup <version>.exe`, unsigned.
- **App data:** `%APPDATA%\ScribeForge`, and `%APPDATA%\ScribeForge Trial` in trial mode.

**Output file names.** These never overwrite an existing file; " 2", " 3" and so on are added instead.

| Action | File name |
|---|---|
| Edits | `<name> (edited).pdf` |
| Redaction | `<name> (redacted).pdf` |
| Merge | `<first file's name> (merged).pdf` |
| Split and extract | `<name> (pages 1-3).pdf` |

The repo now has a `LICENSE` file: the Apache-2.0 terms, copied from the official text that ships with pdf.js.

---

## 14. Questions for you

**Answered 2026-10-15:** every recommendation below is accepted. Question 1 needs the owner to push BC6 Business Manager to a private GitHub repo from the other PC.

1. **The BC6 repo.** Can you push BC6 Business Manager to a **private** GitHub repo from the other PC, so I can clone it here (read-only) and copy what section 2 lists?
   _I recommend yes, before stop 1a. Without it, 1a builds ScribeForge's own versions of the themes, style test and placement, and they get matched to BC6 later, which is rework._
2. **pdf-lib fork.** Use `@cantoo/pdf-lib` 2.11.1 instead of the original?
   _I recommend yes: maintained, same API, and it opens password-protected files._
3. **Where PDFs are processed.** All PDF parsing and editing inside the sandboxed window, with the main process only reading and writing the files you choose?
   _I recommend yes._
4. **Redaction images.** PNG at 200 DPI by default, with 150 and 300 in Settings?
   _I recommend yes. 200 DPI is about 560 KB and half a second per redacted page._
5. **What a redacted file keeps.** Only page content and re-pointed internal links, dropping comments, form fields, bookmarks, attachments, metadata and JavaScript, with a summary?
   _I recommend yes for Phase 1. Choosing what to keep comes with Phase 2's clean-up tool._
6. **Merged bookmarks.** Nest each file's bookmarks under a bookmark named after the file?
   _I recommend yes._
7. **XMP.** Update XMP along with the Info details on every metadata edit, and offer to remove XMP that can't be read?
   _I recommend yes._
8. **Settings file.** A JSON settings file in Phase 1, with no database until the Archive?
   _I recommend yes._
9. **Password-protected files.** Open them with their password (never stored), and warn before saving that the new file won't have a password?
   _I recommend yes for Phase 1. Adding a password to saved files fits Phase 2's clean-up and sign stops, using the fork's `encrypt()`._
10. **Speed targets.** First page of a 500-page file in under 2 seconds, and merging two 500-page files in under 10 seconds?
    _I recommend these. Stop 1a and 1b measure them on this PC._
11. **Web links in PDFs.** Show the address and ask before opening it in your browser?
    _I recommend yes._
12. **Lore artwork.** None in Phase 1?
    _I recommend none. It can come later, off by default._

~~Answer by number, say "go" with any changes, and I'll start stop 1a.~~ Approved 2026-10-15.
