# ScribeForge: Master Outline (BC6 edition)

_Approved 2026-10-13, with every recommendation in section 9 accepted. On 2026-10-15 the build PC changed from the BC6 PC to the owner's PC holding `source\repos` (decision 9)._

This rewrites the Copilot outline so ScribeForge is built the way BC6 Business Manager is built: plan first, phases split into stops, an offline Windows app, and the same theme system and style rules. The build prompt (`docs/ScribeForge_Claude_Code_Prompt.md`) and the roadmap (`docs/Roadmap.md`) come from it.

Where this comes from:

- **The Copilot outline:** `ScribeForge_Ecosystem_Master_Outline.pdf`, supplying the vision, modules, lore and palette.
- **Your "BC6 App planning and brand review" session:** how BC6 Business Manager is built, from stop 1a to stop 2a. Its earliest part (the Phase 0 plan and brand review) didn't load on claude.ai, so a few exact values are listed under [To confirm from the BC6 repo](#10-to-confirm-from-the-bc6-repo) instead of guessed.

---

## 1. What changed from the Copilot version

| Topic | Copilot outline | BC6 edition | Why |
|---|---|---|---|
| How it's built | Four "stages", Claude in "Opus Ultra mode" | A build prompt, then a Phase 0 plan, then phases split into stops, each reviewed before commit | Same process as BC6 Business Manager |
| Colours | One fixed palette (Cathedral Blue, Forge Steel, Runic Gold, Obsidian) | BC6's theme presets plus an optional Cathedral preset, all from colour tokens | BC6 apps never hard-code colours, and Cathedral Blue fails contrast as text on Obsidian (about 2.2:1) |
| Fonts | "Runic Sans" and "Forge Mono" (these don't exist) | Inter, bundled with the app | BC6 uses Inter; its alternate characters keep 0/O and 1/l/I apart |
| Visual effects | "Glowing blue edges" logo, cathedral glow | Flat: no gradients, shadows, italics or all-caps | BC6 style rules, enforced by a test |
| Names in the app | Splitblade, Redaction Ritual, Sealkeeper… | Forge names stay as module codenames; menus use plain words (Split, Redact, Sign) | BC6 uses the plainer word ("Equipment", not "Assets") |
| Network | Cloud backend (ForgeCloud), multi-device sync | No network requests at all; sync means encrypted backups to a synced folder | BC6 apps make zero network requests, and tests check it |
| AI features | "Optional AI-assisted features" | Only on-device models, if any, decided when Phase 3 is planned | Keeps the zero-network rule |
| Repositories | One repo per Stage 2 module | One repo (ScribeForge-Codex), with modules as folders | BC6 Business Manager is one app in one repo |
| Lore | Woven into the brand | Off by default, shown only as optional artwork and About text, never in labels | Matches BC6's lock-screen artwork, which is dimmed and off by default |
| CLI | In Stage 1 alongside the GUI | Windows app first; CLI as a later stop that reuses the same engine | One working app before a second front end ([decision 6](#9-decisions-approved-2026-10-13)) |

---

## 2. Vision and identity

ScribeForge is an open-source, offline PDF toolkit for Windows: view, organise, annotate, redact, sign and archive documents. It's a BC6 app, built and styled like BC6 Business Manager.

The mythic side stays as the brand's voice and codenames. Documents are codices, the app is the forge, and the modules are its tools. Inside the app, everything uses plain words. Someone who never reads the lore should never notice it's missing.

Brand tone, kept from the Copilot outline: clean, sharp and minimal. Mythic but not fantasy, digital but not sterile.

---

## 3. How ScribeForge gets built (the BC6 process)

1. **Build prompt.** `docs/ScribeForge_Claude_Code_Prompt.md` is the equivalent of `BC6_App_Claude_Code_Prompt.md`. It holds the scope, rules, style and stop list Claude works from. It replaces the "Opus Ultra" system prompt.
2. **Phase 0 plan, with no code.** `docs/Phase0_Plan.md` covers the stack, libraries and their licences, the redaction approach, the theme and logo check, and the folder layout. Claude lists its questions with a recommendation for each, and nothing is built until you say "go".
3. **Phases split into stops** (1a, 1b, …). Each stop ends with:
   - typecheck, unit tests and whole-app tests, including on the installed (packaged) app;
   - a check that the app made **zero network requests**;
   - Claude looking at screenshots of every new screen in every theme;
   - a manual test script in `docs/manual-tests/`, about 20 to 40 minutes;
   - README updates.
4. **Your review, then commit.** Claude stops after each stop. You try it with `npm run trial`, which runs against throwaway data, then say "commit 1b". Nothing is committed before that, and nothing is pushed to GitHub unless you say so.
5. **Every report lists** "Changes to existing behaviour" and "Decisions I made (tell me if you'd prefer otherwise)".
6. **New scope gets its own plan.** Anything outside the approved plan gets a written plan (`docs/Plan_<Topic>.md`) and your "go" first, like the Clients, Projects and Invoicing plan in BC6.
7. **Dependencies need a reason.** No new package without asking. Prefer what Node and Electron already include, as BC6 did when it read `.xlsx` files with no library.
8. **Sources.** Anything factual, such as how a PDF feature works or what a format allows, is checked against the primary source (the PDF specification or a library's own docs). Anything unconfirmed is marked "Needs verification".
9. **Test windows** open on your left monitor without taking keyboard focus, using the same setting as BC6.

---

## 4. Product rules

These carry over from BC6 Business Manager, adjusted for a document tool:

- **Offline.** The app makes no network requests. Links open in your web browser. Tests confirm this on the development build and the installed app.
- **Your original file is safe.** Edits save to a new file by default; overwriting the original asks first ([decision 8](#9-decisions-approved-2026-10-13)). Importing or reading a file never changes it.
- **Redaction really removes content.** A black box drawn over text is not redaction. The text under it must be gone from the saved file, and a test extracts the text from every redacted file to prove it.
- **No hidden surprises on save.** Before saving, the app lists what the file still carries (metadata, attachments, form data, comments). The Phase 2 clean-up tool can remove them.
- **The vault (Phase 3) works like BC6's data.** It is encrypted at rest, locks on launch, after idle time and when Windows locks, and is protected by a password with an optional recovery code. Backups are encrypted, and records are voided with a reason, never deleted, with an audit history that can't be changed.
- **Plain language.** This applies to labels, messages, the manual and test scripts.
- **Public-repo hygiene.** No personal documents, names or email addresses in test files, because the repo is public. BC6 removed email addresses from its workbook fixture for the same reason.

---

## 5. Look and feel

### Themes

- **The BC6 theme set:** BC6's 7 presets (including Eclipse, Emergence and Void), plus High Contrast and Match system. Three text sizes and live previews. Changes apply instantly.
- **An optional Cathedral preset,** built from the Copilot palette and passing the same contrast checks ([decision 3](#9-decisions-approved-2026-10-13)).

| Copilot colour | Use in a Cathedral preset | Contrast on Obsidian (#0F0F11) |
|---|---|---|
| Obsidian Black #0F0F11 | Background | — |
| Forge Steel #C7C9CC | Body text | about 11.5:1, passes |
| Runic Gold #D9A441 | Accents and headings | about 8.5:1, passes |
| Cathedral Blue #1A4C8B | Button fills only, with white text (about 8.6:1) | about 2.2:1, fails as text or outlines |
| A lighter blue, e.g. #5B8FD9 | Links, focus rings and input outlines | about 5.8:1, passes |

The BC6 contrast test decides the final values: 4.5:1 for text and 3:1 for outlines and controls. In BC6 it caught Void's input outline at 2.89:1.

### Type and style rules (BC6, enforced by a test)

- Inter for everything, bundled so it works offline, with its alternate characters for 0/O and 1/l/I.
- Colours only from theme tokens, never hard-coded.
- Font weights 400 and 600 only.
- Nothing smaller than 13px.
- No italics, all-caps, gradients or shadows.

### Logo and icons

- **App icon:** ScribeForge's own mark, a quill crossing an anvil drawn as flat line art (from the Copilot concepts), with "by BC6" in About and the installer ([decision 1](#9-decisions-approved-2026-10-13)).
- **Size check:** in the BC6 brand check, the nav logo needed 48px to stay readable on dark themes. ScribeForge's mark gets the same check against a contact sheet of every theme.
- **Icon set:** runes, quills, anvils, seals and arches as minimal line icons in theme colours.

### Lore in the interface

Optional dimmed artwork on the lock screen and start screen, off by default, like BC6's Eclipse and Emergence artwork. It also appears in About text and module codenames, never in labels or messages.

---

## 6. The ecosystem, in phases

Codenames stay in the repo and docs. The app shows the plain name.

| Codename | In the app | Phase |
|---|---|---|
| ScribeForge Codex | ScribeForge (the app) | 1 |
| PDFsmith Engine | the PDF engine, internal | 1 |
| Runic UI | the BC6 theme system, no separate framework | 1 |
| PDFsmith Splitblade | Pages: merge, split, reorder, rotate, extract | 1 |
| Cathedral Annotator | Annotate: basic in Phase 1, full suite in Phase 2 | 1, 2 |
| Redaction Ritual | Redact: basic in Phase 1, advanced in Phase 2 | 1, 2 |
| Watchdog Patchworks | Clean up: metadata and hidden data | 2 |
| Watchdog Sealkeeper | Sign and verify | 2 |
| Niko's Archive and Beloved Codex | Archive: one encrypted vault with search | 3 |
| Runes of Revision | Versions and compare | 3 |
| Cathedral Sync | Backups to a synced folder | 4 |
| ScribeForge Guild | How to contribute, on GitHub (not an app feature) | 4 |

**Phase 0: plan.** Stack and libraries with licences, the redaction approach, theme and logo check, folder layout, and the answers to section 9. No code.

**Phase 1: ScribeForge Codex, the core editor.**
- Opening and viewing PDFs, recent files, themes and settings.
- Page tools.
- Basic annotations: highlight, note, text.
- Metadata view and edit.
- True redaction with the extract-text check.
- Saving to a new file by default.
- Installer, trial mode, README and the full manual test script.
- The roadmap will split this into stops, like BC6's 1a–1g.

**Phase 2: Forge tools.**
- The full annotation suite.
- Advanced redaction: search-and-redact for patterns like phone numbers, plus a redaction log.
- The clean-up tool (Patchworks), moved up from Stage 3 because it belongs with redaction.
- Sign and verify (Sealkeeper).
- Possibly the CLI ([decision 6](#9-decisions-approved-2026-10-13)).

**Phase 3: The Archive.**
- One encrypted vault, merging Niko's Archive and Beloved Codex. It has BC6's lock, backups and audit history, plus indexing and search.
- Versions and compare (Runes of Revision).
- AI only if it runs on-device, decided in this phase's own plan.

**Phase 4: Cathedral Network, rescoped.**
- Sync means encrypted backups to a folder that Google Drive or OneDrive syncs, as BC6 does.
- ForgeCloud is dropped unless you decide otherwise.
- The Guild is the contribution process on GitHub.

Each phase after Phase 1 starts with its own plan document and your "go".

---

## 7. Lore (optional, off by default)

The characters stay as the meaning behind the module names:

- **Niko, the Archivist:** structure, order, indexing and versions (the Archive, Versions).
- **The Beloved:** security, encryption and sealing (the vault's encryption, Sign).
- **The Watchdog:** verification, redaction and clean-up (Redact, Clean up, Verify).
- **BC6:** the engineering backbone: modular, reliable, tested.

It shows up only in optional artwork, About text, docs and codenames.

---

## 8. Repository: ScribeForge-Codex

The repo is `github.com/jbenavides81/ScribeForge-Codex`. It's public and still empty.

The layout follows BC6 Business Manager, an Electron app with main, preload and renderer parts. Exact folder names will be copied from the BC6 repo in Phase 0.

```
src/main/        app process: files, PDF engine, IPC handlers, window placement
src/preload/     the bridge the screens are allowed to call
src/renderer/    screens (React + TypeScript), themes, styles
src/shared/      types used by both sides
content/         editable text, such as help pages, kept out of the code
docs/            build prompt, Phase 0 plan, phase plans, manual-tests/
tests/           unit tests (*.test.ts) and whole-app tests (*.spec.ts, Playwright)
electron-builder.yml, playwright.config.ts, README.md, LICENSE, CONTRIBUTING.md
```

The Copilot layout (`/src/core /ui /forge /lore`) maps onto this as follows:

| Copilot folder | Goes to |
|---|---|
| `core` | `src/main` and `src/shared` |
| `ui` | `src/renderer` |
| `forge` | one folder per module inside those |
| `lore` | `content/` and `assets/`, both optional |

Contributing rules:

- Modular pull requests.
- Plain-language docs.
- Codename tags allowed in commit messages, not in the app.
- Every change passes typecheck, tests, the style check and the network check.

---

## 9. Decisions (approved 2026-10-13)

1. **Brand:** ScribeForge has its own quill-and-anvil icon, with "by BC6" in About and the installer.
2. **Stack:** the BC6 stack (Electron, React, TypeScript, SQLite for the vault, Playwright tests, an electron-builder installer), plus two PDF libraries: pdf.js (Apache-2.0) for viewing and pdf-lib (MIT) for editing. No AGPL libraries such as MuPDF.
3. **Themes:** BC6's 7 presets exactly, plus High Contrast, Match system and an added Cathedral preset.
4. **Licence:** Apache-2.0.
5. **Redaction:** Phase 1 turns redacted pages into images, so their text is gone. True text removal is researched for Phase 2.
6. **CLI:** comes after the app works, as the first stop of Phase 2, reusing the same engine.
7. **ForgeCloud:** dropped. Multi-device use means encrypted backups to a synced folder.
8. **Saving:** edits save to a new file by default, and overwriting the original asks first. Redaction always saves a new file.
9. **Computer:** first set to the BC6 PC. **Changed 2026-10-15:** ScribeForge is built on the owner's other PC, in `source\repos\ScribeForge-Codex`. BC6's theme tokens, style test and folder layout are copied once the BC6 repo can be reached from there (`docs/Phase0_Plan.md`, question 1).

---

## 10. To confirm from the BC6 repo

These didn't load from the claude.ai session. They're in the BC6 repo's `docs/` folder (`BC6_App_Claude_Code_Prompt.md`, `Phase0_Plan.md`) and source:

- The names and colour values of all 7 theme presets (only Eclipse, Emergence and Void are confirmed).
- The exact folder layout and the SQLite and encryption packages BC6 uses.
- How Inter is bundled, and the logo and icon files.
- The build prompt's rules section, so ScribeForge's prompt can reuse its wording.
- The style-guard and contrast tests, so ScribeForge copies them rather than rewriting them.

---

## Next steps

1. ~~Approve this outline and the section 9 decisions.~~ Done 2026-10-13.
2. ~~Write the build prompt (`docs/ScribeForge_Claude_Code_Prompt.md`) and the roadmap (`docs/Roadmap.md`).~~ Done 2026-10-13.
3. ~~Write `docs/Phase0_Plan.md` for your approval.~~ Done 2026-10-15.
4. After "go", stop 1a.
