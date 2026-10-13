# ScribeForge roadmap

_2026-10-13. The Phase 0 plan may adjust it, with the owner's approval._

Every stop also passes the checks in section 6 of `docs/ScribeForge_Claude_Code_Prompt.md`: typecheck, unit and whole-app tests, zero network, style and contrast, unchanged input files, screenshots, a manual test script and the README. The **required checks** listed under each stop come on top of those.

| Phase | What it delivers | Starts with |
|---|---|---|
| 0 | The plan. No code. | This roadmap and the build prompt |
| 1 | ScribeForge 1.0: view, pages, annotate, metadata, redact | Approval of the Phase 0 plan |
| 2 | CLI, full annotations, advanced redaction, clean-up, signing | `docs/Plan_Phase2.md` |
| 3 | Archive: encrypted vault, search, versions and compare | `docs/Plan_Phase3.md` |
| 4 | Backups to a synced folder, contribution process, releases | `docs/Plan_Phase4.md` |

---

## Phase 0: plan

Write `docs/Phase0_Plan.md` with the 13 sections listed in the build prompt, then stop for "go". It includes the BC6 reuse list, every dependency, the redaction design, and the open "Needs verification" items: pdf.js scripting options, XMP metadata, and links and bookmarks after page operations.

---

## Phase 1: ScribeForge 1.0

### Stop 1a: the app and the viewer

**The app:**
- The main window and navigation.
- Settings: all theme presets including Cathedral, High Contrast, Match system and the three text sizes.
- About, with "by BC6", the licence and third-party notices.
- Trial mode.
- The installer skeleton and the packaged-app test.

**Opening files:** File > Open, dragging a file in, and the recent-files list (which can be cleared or turned off). A password-protected PDF asks for its password and never stores it. A damaged file shows a plain error.

**Viewing:** page thumbnails, zoom, fit to width and page, page navigation, text selection and copy, and search within the document.

**Required checks:**
- Fixture PDFs open correctly: normal, large (500+ pages), password-protected, damaged and containing JavaScript.
- The JavaScript fixture's script never runs. It tries a network request and a dialog, and the test sees neither.
- The large file opens within the Phase 0 time target.
- Zero network requests on both builds.

### Stop 1b: pages (Splitblade)

**Page tools:**
- Merge several files, in the order the owner sets.
- Split by ranges, every N pages, or into single pages.
- Reorder by dragging thumbnails.
- Rotate, delete, extract, and insert a blank page.

**Saving:** changes can be undone until saving. Saving writes a new file by default (named per Phase 0), and overwriting the original asks first.

**Required checks:**
- Reading each output back with pdf.js gives the right page count, order and rotation.
- Input checksums are unchanged.
- What happens to links, bookmarks and annotations is tested and documented (Phase 0's open item).
- Merge and split stay within a time target on the large fixture.

### Stop 1c: annotate (basic)

**Annotations:**
- Highlight, underline and strikeout on selected text.
- Sticky notes and free-text boxes.
- Edit or delete annotations added in ScribeForge.
- An author name setting.
- The fixed annotation colour palette.

Annotations are standard PDF annotations, so other readers show them.

**Required checks:**
- Annotations survive saving and reopening, read back through pdf.js.
- The manual script opens the output in Microsoft Edge to confirm another reader shows them.
- Input checksums are unchanged.

### Stop 1d: metadata and "what this file carries"

**Metadata:** view and edit title, author, subject and keywords. Show creator, producer, dates, PDF version, page sizes and whether the file is encrypted.

**What this file carries:** a panel listing metadata (Info and XMP), attachments, form fields, comments, JavaScript, bookmarks, hidden layers and links. It opens on demand and before saving.

**Required checks:**
- Edited metadata reads back the same from Info and XMP, or the app warns where it can't keep them in step (Phase 0's open item).
- A fixture carrying one of each item shows every one in the panel.

### Stop 1e: redact (Redaction Ritual)

**Marking:** draw boxes, or select text and search for a term to turn every match into boxes. Review the list of marks, then apply.

**Applying:**
- Every page with a mark becomes an image with the boxes burned in, at the Phase 0 resolution.
- Unmarked pages are copied unchanged.
- The output is a new document named `<name> (redacted).pdf`.
- Document-level extras (metadata, bookmarks, attachments, form data, JavaScript) aren't carried over unless the owner chooses to keep them.
- A summary shows what was redacted and what the new file still carries.

**Required checks:**
- The test term is placed in body text, an annotation, the title metadata, a bookmark and an attachment name. After redacting with default settings, a search of every decompressed stream and string in the output finds it nowhere.
- Unmarked pages are identical to the source pages.
- The original is unchanged.

### Stop 1f: finishing

**Help and visuals:**
- Help pages in `content/help/*.md`, editable without touching code.
- The final icon set and icon contact sheet.
- A final contrast pass across every preset.

**Release files:**
- The installer with the ScribeForge icon.
- `docs/manual-tests/v1-full.md`, a full walk-through of the installed app, about an hour.
- `CONTRIBUTING.md`, `THIRD-PARTY-NOTICES.md` and the `LICENSE` check.
- README install, run and build commands.

**Releasing:** the installer is built locally. A GitHub release is published only when the owner asks.

**Required checks:**
- The packaged app passes every whole-app test.
- Every shipped dependency appears in the notices.
- The installer installs, opens a file and uninstalls cleanly in the manual script.

---

## Phase 2: Forge tools

Phase 2 starts with `docs/Plan_Phase2.md` and the owner's "go".

| Stop | What it adds |
|---|---|
| 2a CLI | A `scribeforge` command for merge, split, rotate, extract, metadata and redaction by page or area. It uses the same engine as the app and passes the same checks. |
| 2b Annotate (full) | Ink, shapes, stamps, a comments panel, replies, and flattening annotations into the page. |
| 2c Redact (advanced) | Search-and-redact for patterns (phone numbers, emails, ID-number shapes) with review, and a redaction log. The research and decision on true text removal, so pages don't have to become images. |
| 2d Clean up (Patchworks) | Remove metadata (Info and XMP), attachments, JavaScript, form data, comments, hidden layers and bookmarks, with a report of what was removed. |
| 2e Sign (Sealkeeper) | Its own research and plan first: certificate signatures, verifying existing signatures, and which library to use (licence and maintenance checked). |

---

## Phase 3: The Archive

Phase 3 starts with `docs/Plan_Phase3.md` and the owner's "go".

- **The vault (Niko's Archive and Beloved Codex):** an encrypted vault using BC6 Business Manager's patterns. That means a password with an optional recovery code, locking on launch, idle and Windows lock, encrypted backups, and voiding with a reason instead of deleting, plus an audit history.
- **Search:** indexing and full-text search of stored documents.
- **Versions (Runes of Revision):** keep versions and compare them side by side, both visual and text differences.
- **AI:** whether to add on-device AI features (local models only, never a cloud service) is decided in this plan.

---

## Phase 4: Cathedral Network (rescoped)

Phase 4 starts with `docs/Plan_Phase4.md` and the owner's "go".

- **Sync:** encrypted Archive backups to a folder Google Drive or OneDrive syncs, with restore on another PC, as BC6 does.
- **Guild:** the contribution process on GitHub (issue and pull-request templates, contribution guide, review rules).
- **Releases:** the release process (version numbers, notes, installer checksums).
