# Manual test: stop 2d, Clean up

About 25 minutes. Everything runs in **trial mode**, and the test PDFs are made up. You'll save a few new files, so first make a folder for them, for example `Desktop\ScribeForge 2d test`. Delete it when you're done.

Each step says what to do, then **what you should see**. If something doesn't match, note the step number and what you saw.

## Setup

A. Make the test PDFs:
```bash
npm run fixtures
```
B. Start from clean trial data:
```bash
npm run trial:reset
```
C. Start trial mode:
```bash
npm run trial
```

## What the file carries

1. Open `tests\fixtures\out\carries.pdf`. **On the left, under Details, there's a new item: Clean up, with a broom.**
2. Click **Details**. **The list "What this file carries" has a new row, "Hidden page data: None".** Read the rest: **9 details, 2 attached files, 2 form fields, a note and a highlight, scripts, 2 bookmarks, 2 layers (1 hidden).**
3. Click **Clean up**. **One section per item, each saying what was found, with a choice. "Scripts and actions" says they're always removed. "Hidden page data" says None, and its box is greyed out. "Clean up and save…" is greyed out until you choose something.**

## Cleaning up everything

4. Click **Choose everything**. **Every box is ticked, and Form fields and Comments are set to Remove.**
5. Click **Clean up and save…**. **A summary: "What the cleaned file carries", starting "Removed: the document's details; 1 file attached to pages; 2 form fields; 2 comments; 1 hidden layer and what was on it; 2 bookmarks."** In the list below it: **Details shows only that ScribeForge made the file and when; Attached files, Form fields, Comments, Scripts and Bookmarks say None; Layers shows 1 layer, 0 hidden.**
6. Click **Choose where to save…** and save as `cleaned.pdf` in your test folder. **"Saved cleaned.pdf (2 pages)" and the same "Removed" line. The new file opens.**
7. Look at page 1. **It looks as before, minus the note and the highlight; the field boxes are gone. "VISIBLE-LAYER-TEXT" still shows.** Press `Ctrl+F` and search for `HIDDEN-LAYER-TEXT`. **Not found: it's gone from the file, not just hidden.**
8. Click **Details**. **The same as the summary in step 5.**

## Cleaning up only some things

9. Open `tests\fixtures\out\carries.pdf` again and click **Clean up**. **Nothing is chosen: the choices start fresh for each file.**
10. Tick **Remove the bookmarks**, and set **Comments** to **Burn into the page**. Click **Clean up and save…**, then save as `some.pdf`. **The message says "Removed: 2 bookmarks." and "2 comments were burned into the page".**
11. Look at page 1 of the new file. **The note icon and the yellow highlight are still visible, but clicking them with Select does nothing: they're part of the page now.** Click **Details**. **Comments: None; Bookmarks: None; the title, the attached file on page 2 and both layers are still there.**

## Redaction: choosing what to keep

12. Open `tests\fixtures\out\carries.pdf`, click **Document**, then **Redact**. Type `CARRIES-PAGE-1` in **Find and mark** and click **Mark all**.
13. Click **Review and redact…**. **Under the marks: "Also keep in the redacted file", with The document's details, Bookmarks, Comments, Form fields and Files attached to pages without marks, all unticked.**
14. Tick **The document's details** and **Bookmarks**, and click **Redact…**. **The summary ends "Kept, as you chose: the document's details, bookmarks.", and the "Left out" line no longer mentions the details.**
15. Save as `kept.pdf`. Click **Details**. **The title is still "CARRIES-OLD-TITLE", with 2 bookmarks, and no comments or attached files.**
16. Click **Document**, then **Redact**, mark anything, and click **Review and redact…** again. **The keep boxes are all unticked again.** Click **Cancel**.

## Finish

17. Close ScribeForge and delete your test folder.
