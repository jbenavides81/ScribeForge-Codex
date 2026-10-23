# Manual test: stop 3c, versions and compare

About 25 minutes. Everything runs in **trial mode**, with a test vault in the trial data folder. `npm run trial:reset` deletes it at the end.

Each step says what to do, then **what you should see**. If something doesn't match, note the step number and what you saw.

The two test PDFs are versions of one made-up "Tenancy agreement". Version 2 adds a summary page (page 2), changes the fee from 100 to 120, swaps two blocks of text, changes a coloured panel from blue to red, and leaves out version 1's last page (an appendix).

## Setup

A. Make the test PDFs:
```bash
npm run fixtures
```
B. Start from clean trial data (no vault):
```bash
npm run trial:reset
```
C. Start trial mode:
```bash
npm run trial
```
D. Click **Archive**, make a vault with a test password (untick the recovery code), and click **Add PDFs…**. From `tests\fixtures\out`, choose `version-1.pdf`. **"Added “Tenancy agreement” to the Archive."**

## Adding versions

1. Click **Tenancy agreement**. **In the panel, Versions says "1 (this is the only one)", and under the Versions heading there's one: "Version 1 · Newest · Added (today) · 5 pages · version-1.pdf".**
2. Click **Add a new version…**. **The window is called "Choose the new version", and only one file can be chosen.** Choose `version-2.pdf`. **"Added version 2 of “Tenancy agreement”." Version 2 is at the top, marked Newest, with version-2.pdf. The title is still Tenancy agreement.**
3. In the box under Version 2, type `After the meeting` and click elsewhere. Click **History**. **"Version 2 of “Tenancy agreement” was added." and "The note on version 2 … was changed." The note's words aren't in the history.** Click **Documents** and click the document again. **The note is still there.**
4. Click **Open** next to **Version 1**. **The Document screen shows "version-1 (version 1).pdf", whose last page is the APPENDIX-ONLY-IN-VERSION-ONE page.** Go back to **Archive**, click the document and click the big **Open** button. **It opens version-2.pdf: page 2 is the SUMMARY-ONLY-IN-VERSION-TWO page.**
5. Search for `120`. **Tenancy agreement, page 3.** Search for `"100 pounds"`. **Nothing found: search reads the newest version.** Clear the search.

## Comparing

6. Click the document. Under **Compare version … with version …**, choose **1** and **2**, and click **Compare**. **For a moment, "Reading the pages…" and "Comparing pages…", then "3 pages changed, 1 page added, 1 page removed and 1 page the same."**
7. **"Page 2: added in version 2"**: the summary page on the right, and "Not in version 1" on the left.
8. **"Page 2, now page 3: changed"**: both pages side by side, with a red box around the fee on each. Under them: **Words removed: “100”** and **Words added: “120”**.
9. **"Page 3, now page 4: changed"**: red boxes around both blocks of text, on both sides. Under them: **Moved on the page: “Block … says …”**.
10. **"Page 4, now page 5: changed"**: a red box around the coloured panel (blue on the left, red on the right). Under them: **"No words changed. Something drawn on the page changed…"**
11. **"Page 5: removed in version 2"**: the appendix on the left, "Not in version 2" on the right.
12. Tick **Show the pages that are the same**. **"Page 1: the same" appears first, with no red boxes.**
13. Go to **Settings** and choose the **Dark** theme, then go back to **Archive**. **The comparison has closed (leaving the Archive closes it).** Compare **1** with **2** again. **The pages stay white, with red boxes, in the dark theme too.** Try **High Contrast** the same way, then set the theme back.

## Identical versions, and saving as a new version

14. Click **Back to the Archive**. Click the document, then **Add a new version…** and choose `version-1.pdf` again. **"Added version 3…"** Compare **1** with **3**. **"The two versions are identical: all 5 pages are the same." No pages are listed.**
15. Click **Back to the Archive**, then **Open** (the newest, version 3). On the **Pages** screen, rotate page 1, then press **Ctrl+S**. **In the list shown before saving, under "The Archive": "Don't keep it in the Archive" (chosen), "Save as a new version of “Tenancy agreement”", and "Keep a copy in the Archive, as a separate document".** Choose **Save as a new version…**, click **Choose where to save…** and save it in your Documents folder. **The message ends "It's also in the Archive, as version 4 of “Tenancy agreement”."**
16. Go to **Archive** and click the document. **Four versions; version 4 has the name you saved it with. There's still only one document in the list.**
17. Open a PDF from a folder (**Start > Open a PDF…**, `tests\fixtures\out\normal.pdf`). Go to **Archive** and click the document. **"Add the open file as a new version" is there.** Click it. **"Added version 5…"**

## Locking

18. Compare **4** with **5**. While it's showing, press **Windows+L** to lock Windows, then sign back in. **The Archive is locked, with a note that it locked because Windows locked. The comparison is gone.** Unlock with the password.
19. Open File Explorer at `%APPDATA%\ScribeForge Trial\Vault\files`. **Five files with random names, one for each version; none can be read in Notepad.** Close Notepad without saving.

## Finish

20. Close ScribeForge, and delete the trial data, test vault included:
```bash
npm run trial:reset
```
