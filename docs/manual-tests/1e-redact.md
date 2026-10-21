# Manual test: stop 1e, redaction

About 35 minutes. Everything runs in **trial mode**, and the test PDFs are made up. You'll save some new files, so first make a folder for them, for example `Desktop\ScribeForge test`. Delete it when you're done.

Each step says what to do, then **what you should see**. If something doesn't match, note the step number and what you saw.

## Setup

A. Make the test PDFs. This adds `redaction.pdf` and `text-styles.pdf` for this stop.
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

## Marking

1. Open `tests\fixtures\out\redaction.pdf`. At the start of the second toolbar, click **Redact**. **The tools change to:**
    - **Select**, **Mark area** and **Mark text**;
    - a **Find and mark** box with **Mark all**;
    - **Undo** and **Redo**;
    - **Review and redact…**, greyed out because there are no marks yet.
2. Type `REDACT-ME-TERM` in **Find and mark** and click **Mark all**. **"Marked 4 matches on 2 pages."**
    - **Page 2:** the word in the sentence has a see-through dark box with a red edge over it.
    - **Page 3:** three boxes: one over the term just under the heading, and two over what looks like blank space. Those two hold text you can't see: one is invisible (as in scanned documents), and one is on a hidden layer. Both are in the file, so they're marked too.
3. Click **Mark area** and drag a box around the heading "MARKED-PAGE-TWO" on page 2. **A box appears where you dragged.**
4. Click **Mark text** and select the words "rest of" on page 2's last line. **A box covers just those letters, closely.**
5. Click **Select**, then click the box from step 3. **A panel: "Redaction mark on page 2", Area.** Click **Remove mark**. **It's gone.** Press Ctrl+Z. **It's back.** Press Escape.
6. Click one of the search boxes. **The panel says "Search for “REDACT-ME-TERM”" and offers "Remove all 4 matches".** Don't click it; click **Done**.
7. Zoom in twice, then back to **Fit width**. **The boxes stay on their text.**
8. Click **Annotate** at the start of the toolbar. **The marks still show, but clicking them does nothing.** Click **Redact** again.

## Checking the marks and redacting

9. Click **Review and redact…**. **"Redact 6 marks?", listed by page: Page 2 (the term, the area, "rest of") and Page 3 (the term three times).** A note says the redacted file won't include comments, form fields, bookmarks, attached files, details, scripts or your annotations.
10. Click **Remove** next to "rest of". **"Redact 5 marks?"** Click **Redact…**. **For a moment it says it's blacking out page 1 of 2, then page 2 of 2. Then "What the redacted file carries":**
    - **"5 marks on 2 pages are blacked out. Those pages are now pictures (200 dpi): their text can't be selected, searched or copied."**
    - **"Left out, as in every redacted file: the document's details (title, author and so on), 1 comment, 1 bookmark, 1 attached file, 1 script or action, and any annotations you added."**
    - **In the list, only these details: Made with ScribeForge, PDF made by ScribeForge 0.5.0, Created and Last changed (now). Attached files, Comments, Scripts and actions, Bookmarks and Layers say None. Links: 1 link to a page.**
11. Click **Choose where to save…**. **The suggested name is `redaction (redacted).pdf`.** Save it in your test folder. **"Saved redaction (redacted).pdf (3 pages, 2 pages redacted)." The redacted file opens, with no marks.**

## The redacted file

12. Look at the pages:
    - **Page 1 looks exactly as before, and its "Go to page 3" link still works.**
    - **Page 2 has solid black boxes over the heading and the term, and "The rest of this line stays." is readable.**
    - **Page 3 has black boxes, including two over blank space.**
13. On page 2, try to select text with the mouse. **Nothing can be selected: the page is a picture now.**
14. Type `REDACT` in the **Find in document** box at the top. **"Not found".**
15. Zoom to 300% and look closely at the edges of the black boxes on page 2. **No bits of letters show around them.**
16. Open the redacted file in **Microsoft Edge** and search it (Ctrl+F) for `REDACT-ME-TERM`. **No results.** It has no bookmarks, and no attachment (paperclip). Pages 2 and 3 can't be selected there either.
17. Open the original `redaction.pdf` again in ScribeForge. **It's unchanged: the term is still on pages 2 and 3, and its date modified in File Explorer hasn't changed.**

## With the Pages screen, and Settings

18. Open `normal.pdf`. On **Pages**, click page 2 and **Rotate right**. On **Document**, choose **Redact**, then **Mark text**, and select "A second anvil stands in the corner." on page 2. Click **Review and redact…**, then **Redact…**, then save. **In the saved file, page 2 is turned as on the Pages screen, and that sentence is blacked out.**
19. In **Settings**, under **Redaction**, choose **300 dpi (sharper)**. Redact a mark on any file. **The summary says "(300 dpi)". The saved file is bigger than at 200 dpi.** Set it back to **200 dpi**.
20. Make any mark, then press Ctrl+W. **"Discard your changes?", mentioning redaction marks.** Click **Keep editing**.
21. Try **Light** and **High Contrast** in Settings, then look at a page with marks in Redact mode, and at the list from **Review and redact…** (then Cancel). **The marks, the selected mark and the list are easy to see in both.**
22. In File Explorer, check the date modified of the files in `tests\fixtures\out`. **None have changed since step A.**

## Finish

23. Close the window (choose **Close without saving** if asked), delete your test folder, and delete the trial data:
```bash
npm run trial:reset
```

When everything matches, say "commit 1e". If anything was off, tell me the step number and what you saw.
