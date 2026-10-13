# ScribeForge: Claude Code build prompt

You are building **ScribeForge**, an open-source, offline PDF toolkit for Windows, in this repository (`ScribeForge-Codex`). It's a BC6 app, built the same way as BC6 Business Manager, which you'll find on this PC.

Read this whole file before doing anything. Two companion documents:

- **`docs/ScribeForge_Master_Outline.md`** explains the why. It holds the vision, codenames, lore and the decisions approved on 2026-10-13.
- **`docs/Roadmap.md`** lists the phases and stops, and the checks each stop must pass.

If this prompt and the outline ever disagree, this prompt wins. If something here is unclear, ask; don't guess.

---

## 0. First, learn from BC6 Business Manager

ScribeForge reuses BC6 Business Manager's process, look and test setup. Before writing the Phase 0 plan:

1. **Find the BC6 Business Manager repo on this PC.** Ask the owner for the path if it isn't obvious.
2. **Read its build prompt and plans:** `BC6_App_Claude_Code_Prompt.md`, `docs/Phase0_Plan.md`, the README, and one or two `docs/manual-tests/` scripts, to learn their format.
3. **Read the parts ScribeForge will reuse:**
   - the theme presets and colour tokens (all 7, plus High Contrast and Match system), and the three text sizes
   - the style-guard test and the contrast test
   - `src/main/placement.ts` and `playwright.config.ts`, which place test windows on the left monitor without taking focus
   - trial mode (`npm run trial`, `npm run trial:reset`) and its separate data folder
   - the Electron security setup: window options, Content-Security-Policy, preload bridge and IPC pattern
   - the network-blocking check in the whole-app tests
   - `electron-builder.yml`, the packaged-app test, and how Inter is bundled
4. **List in the Phase 0 plan exactly what you'll copy, adapt or leave out.** The owner approves that list before anything is copied.

**What never comes across:**
- bookkeeping code;
- anything containing the owner's business data;
- the BC6 cube logo files and BC6's lock-screen artwork.

ScribeForge has its own icon. This repo is **public** and Apache-2.0 licensed, so anything copied here is published under that licence.

---

## 1. What ScribeForge is

A Windows desktop app to open, view, organise, annotate, inspect, redact and (later) sign and archive PDF files. It's offline, plain-spoken, and safe with the owner's documents.

The forge names in the outline (Splitblade, Redaction Ritual, Sealkeeper…) are codenames for docs and code folders only. The app uses plain words:

| Codename | In the app |
|---|---|
| ScribeForge Codex | ScribeForge |
| PDFsmith Splitblade | Pages |
| Cathedral Annotator | Annotate |
| Redaction Ritual | Redact |
| Watchdog Patchworks | Clean up |
| Watchdog Sealkeeper | Sign |
| Niko's Archive / Beloved Codex | Archive |
| Runes of Revision | Versions |

---

## 2. Rules that never bend

1. **Plan first.**
   - Write no code until the owner approves `docs/Phase0_Plan.md` by saying "go".
   - Anything outside the approved plan gets its own `docs/Plan_<Topic>.md` and its own "go".
   - Each phase after Phase 1 starts with its own plan.
2. **One stop at a time.**
   - Build a stop, run its checks, then stop and report.
   - Don't start the next stop until the owner says so.
   - Commit only when the owner says "commit 1b" (or similar).
   - Never push to GitHub unless the owner asks.
3. **Offline.**
   - The app makes no network requests: no updates, telemetry, fonts, CDNs or "check for news".
   - Links open in the owner's web browser.
   - The whole-app tests confirm zero requests on the development build and on the packaged app, every stop.
4. **The owner's files are safe.**
   - Opening, reading or importing a file never changes it.
   - Edits save to a new file by default, and overwriting the original asks first.
   - Redaction always saves a new file.
   - Tests check that input files' checksums are unchanged after every operation.
5. **Redaction removes, it doesn't cover.**
   - In Phase 1, every page with a redaction mark is turned into an image with the black boxes burned in, so no text from that page survives. Pages without marks are copied as they are.
   - The redacted file is built as a new document, not edited in place.
   - A test searches every decompressed stream and string in the output for the redacted text and must find none.
6. **PDF content is untrusted.**
   - PDF JavaScript never runs, and pdf.js scripting stays off. Confirm the exact pdf.js options in Phase 0.
   - Damaged or hostile files show a plain error and never crash the app.
   - Parsing and rendering happen inside the sandboxed renderer or a worker.
   - The pdf.js worker is bundled, never loaded from a CDN.
7. **Dependencies need permission.**
   - Before adding any package, give its name, licence, size, whether it ships in the app or is only used to build it, and why nothing already included will do.
   - No GPL or AGPL packages in what ships.
   - Record every shipped package in `THIRD-PARTY-NOTICES.md`.
8. **Style rules (BC6), enforced by the style-guard test:**
   - colours only from theme tokens;
   - Inter for all text;
   - weights 400 and 600 only;
   - nothing under 13px;
   - no italics, all-caps, gradients or shadows.
9. **Accessibility.**
   - Every theme preset passes the contrast test: 4.5:1 for text, 3:1 for outlines and controls.
   - Everything works by keyboard, and the three text sizes work on every screen.
   - Only form errors are screen-reader alerts. Warning banners are not.
10. **Plain language** in labels, messages, help, the README and test scripts. Use the plainer word.
11. **Lore is optional.** It's off by default. It appears only as optional artwork, in About text, in docs and in codenames, never in labels or messages.
12. **Check the sources.**
    - Claims about how PDFs behave are checked against the PDF specification (ISO 32000) or the library's own documentation.
    - Anything you can't confirm is marked "Needs verification" in the plan or report.
13. **Public-repo hygiene.**
    - No personal documents, names, email addresses or paths in the repo.
    - Test PDFs are generated by a script (`tests/fixtures/`) using pdf-lib, never copied from the owner's files.
14. **Test windows** open on the left monitor and never take keyboard focus (copy BC6's `placement.ts`).

---

## 3. Stack

- **Electron** (main, preload and renderer), **React**, **TypeScript**. Match BC6's versions of Node (24.x), Electron and the tooling unless there's a reason not to.
- **pdf.js** (`pdfjs-dist`, Apache-2.0) for rendering, text extraction and search.
- **pdf-lib** (MIT) for page operations, annotations, metadata and building output files. pdf-lib's last release is several years old, so Phase 0 checks its maintenance status and any maintained fork, and recommends one.
- **SQLite**, encrypted the way BC6 does it, but only from Phase 3 (the Archive). Phase 0 decides where settings and the recent-files list live before then.
- **Tests:** the same unit-test runner as BC6 (`*.test.ts`) and Playwright for whole-app tests (`*.spec.ts`), including on the packaged app.
- **Installer:** electron-builder, unsigned. Windows shows the "protected your PC" warning; the README explains it.
- **Inter**, bundled (SIL Open Font License), exactly as BC6 bundles it.

---

## 4. Look and feel

- **Themes:** BC6's 7 presets exactly, plus High Contrast and Match system, and one added preset, **Cathedral**, built from the Copilot palette:
  - Obsidian #0F0F11 is the background.
  - Forge Steel #C7C9CC is body text.
  - Runic Gold #D9A441 is for accents.
  - Cathedral Blue #1A4C8B is for button fills with white text only. It fails contrast as text or outlines on Obsidian (about 2.2:1).
  - A lighter blue such as #5B8FD9 (about 5.8:1) is for links, focus rings and input outlines.
  - The contrast test decides the final values.
- **Icon:** a quill crossing an anvil, as flat line art in theme colours. Check it in a contact sheet of every theme at nav size. BC6 needed 48px for its logo to read on dark themes. Show "by BC6" in About and the installer.
- **Icons in the app:** minimal line icons (runes, quills, anvils, seals, arches) in theme colours.
- **Lore artwork:** none in Phase 1 unless the Phase 0 plan proposes it and the owner approves. If added later, it's off by default and dimmed, like BC6's lock-screen artwork.
- **Annotation colours** are part of the document, not the theme. They're a fixed palette chosen to read well on screen and in print. The style-guard test exempts that palette's definition file and nothing else.

---

## 5. Data and files

- **App data** goes in `%APPDATA%\ScribeForge`. Trial mode uses its own folder, as BC6's does.
- **The recent-files list** stores paths only. It can be cleared and turned off.
- **No copies of opened documents** are kept anywhere until Phase 3's Archive, which the owner opts into.
- **Temporary data**, such as page images during redaction, stays in memory where possible. Anything written to disk goes in the system temp folder and is deleted when the operation finishes.

---

## 6. How every stop ends

Run all of these and report the results:

1. Typecheck, with zero errors.
2. Unit tests: all pass. Give the count and how many are new.
3. Whole-app tests on the development build and the rebuilt packaged app: all pass, with zero network requests.
4. The style-guard and contrast tests across every preset.
5. Input files unchanged: checksums before and after.
6. The stop's own required checks from `docs/Roadmap.md`.
7. Screenshots of every new or changed screen, in every theme, combined into a contact sheet. Look at them yourself and fix what's wrong before reporting.
8. A manual test script, `docs/manual-tests/<stop>-<name>.md`, of about 20 to 40 minutes. It runs in trial mode and starts with any setup it needs, so it never assumes data from an earlier script.
9. README updated with any new commands or behaviour.

---

## 7. How to report

Short sentences, plain words. In this order:

1. **What's new:** what the owner can now do, by screen.
2. **Checks:** the results from section 6, with numbers.
3. **Bugs the tests caught, now fixed.**
4. **Changes to existing behaviour.**
5. **Decisions I made (tell me if you'd prefer otherwise).**
6. **To try it:** `npm run trial:reset`, `npm run trial`, then the manual test script and roughly how long it takes.
7. **What's next**, and a reminder that the stop isn't committed yet.

When asking questions, number them and give a recommendation for each.

---

## 8. What the Phase 0 plan contains (`docs/Phase0_Plan.md`)

1. **The BC6 reuse list:** what gets copied, adapted or left out (section 0), for approval.
2. **Every dependency:** name, version, licence, size, shipped or build-only, and why it's needed. This includes the pdf-lib maintenance check.
3. **Folder layout,** following BC6's: `src/main`, `src/preload`, `src/renderer`, `src/shared`, `content/`, `docs/`, `tests/`.
4. **Settings and recent files:** where they're stored and in what format.
5. **Theme tokens:** all presets including Cathedral, with contrast results.
6. **Icon:** a first draft, with the contact-sheet check.
7. **PDF safety:** the exact pdf.js options that keep scripting off, how damaged files are handled, and size and time limits. Propose a target such as "a 500-page file opens in under N seconds".
8. **Redaction design:**
   - the resolution of page images (default and setting);
   - how text marks become boxes;
   - how the output is assembled as a new document;
   - how the "redacted text appears nowhere" test works.
9. **Metadata:** whether pdf-lib's setters also update the XMP metadata stream. If they don't, how ScribeForge keeps the two from disagreeing (update both, or warn). Marked "Needs verification" until tested.
10. **Page operations:** what happens to links, bookmarks and annotations when pages are merged, split or reordered with pdf-lib. Also marked "Needs verification" until tested.
11. **Phase 1 stops,** confirmed against `docs/Roadmap.md`, with each stop's required checks.
12. **Version numbering, the installer name, and the default output file names**, such as `<name> (edited).pdf` and `<name> (redacted).pdf`.
13. **Questions for the owner,** numbered, each with a recommendation.

Then stop and wait for "go".
