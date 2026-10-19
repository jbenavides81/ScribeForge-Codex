# Manual test: stop 1d, details and "what this file carries"

About 30 minutes. Everything runs in **trial mode**, and the test PDFs are made up. You'll save some new files, so first make a folder for them, for example `Desktop\ScribeForge test`. Delete it when you're done.

Each step says what to do, then **what you should see**. If something doesn't match, note the step number and what you saw.

## Setup

A. Make the test PDFs. This adds `carries.pdf`, `stale-xmp.pdf`, `broken-xmp.pdf` and `owner-locked.pdf` for this stop.
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

## The Details screen

1. Open `tests\fixtures\out\carries.pdf`, then click **Details** in the navigation (or press Ctrl+Shift+D). **Four boxes:**
    - **Title: CARRIES-OLD-TITLE**
    - **Author: Fixture Author**
    - **Subject: Fixture subject**
    - **Keywords: alpha, beta**
2. Look at **About this file**:
    - **Made with: Fixture Writer 1.0**
    - **PDF made by: Fixture Maker 2.0**
    - **Created: March 5, 2024; Last changed: June 7, 2025** (the times are in your time zone)
    - **PDF version: 1.7**
    - **Pages: 2 pages, one 8.5 × 11 in (Letter) and one 11.69 × 8.26 in (A4, sideways)**
    - **Password or restrictions: No**
3. Scroll to **What this file carries**:
    - **Details:** 9 details, including "Company: Fixture Company Ltd". A note says a second copy is kept in XMP format.
    - **Attached files:** notes.txt (attached to the whole file) and page-file.txt (on page 2).
    - **Form fields:** 2 fields, 1 filled in: customer.name (filled in) and agree.
    - **Comments:** 1 note and 1 highlight, by Fixture Author and Second Reviewer.
    - **Scripts and actions:** a document script called "init", and a link on page 2 that would open a program. A note says ScribeForge never runs them.
    - **Bookmarks:** 2.
    - **Layers:** 2 layers, 1 hidden ("Hidden layer"). A note says what's on a hidden layer is still in the file.
    - **Links:** 1 web or email link (https://example.com/carries) and 1 link to a page.
    - **Password or restrictions:** None.
4. Click **Document**. **Page 1 shows "VISIBLE-LAYER-TEXT" but not "HIDDEN-LAYER-TEXT".**

## Changing the details

5. Go back to **Details**. Change the title to "My test title" and the author to your name (or a made-up one). **A dot appears next to Details in the navigation, and an "Undo my changes" button appears.**
6. Click **Undo my changes**. **The title and author go back to the file's own, and the dot goes.** Type your changes again.
7. Press Ctrl+W. **"Discard your changes?", mentioning details.** Click **Keep editing**.

## Before saving

8. Press Ctrl+S. **Before any Save dialog, a box called "What the new file carries" opens.** At the top, it says:
    - form fields look the same but can't be filled in;
    - scripts and other actions were removed;
    - 1 file attached to the whole document isn't copied into the new file.

    **Below that is the same list as on the Details screen, for the new file:**
    - **Details:** your title and author, and no "Company" line.
    - **Attached files:** just page-file.txt, on page 2.
    - **Form fields, Scripts and actions:** None.
    - **Layers:** 2 layers, 1 hidden.
9. Click **Cancel**. **The box closes and nothing is saved. No Save dialog appeared.**
10. Press Ctrl+S again and click **Choose where to save…**. **The suggested name is `carries (edited).pdf`.** Save it in your test folder. **"Saved carries (edited).pdf (2 pages)", and the new file opens.**
11. Go to **Details** for the new file:
    - **Title: My test title, and your author name.**
    - **Made with: Fixture Writer 1.0** (the program that made the original).
    - **PDF made by: ScribeForge 0.4.0.**
    - **Created: still March 5, 2024. Last changed: today.**
    - **There's no dot next to Details: nothing is unsaved.**
12. Click **Document**. **Page 1 still doesn't show "HIDDEN-LAYER-TEXT".**
13. Open the saved file in **Microsoft Edge**. **It opens normally and looks the same. If Edge shows the document's title (in its tab or its document properties), it's "My test title".**

## When the details disagree or can't be read

14. Open `stale-xmp.pdf`. Choose **Discard changes** if asked. Go to **Details**. **A box says the file keeps its details twice and the two copies disagree: Title "Current title" in one copy, "STALE-XMP-TITLE" in the other (XMP). The Title box shows "Current title".**
15. Save it in your test folder (go past the list). On the saved file's **Details**: **no box about disagreeing copies.**
16. Open `broken-xmp.pdf` and go to **Details**. **A box says the file has a second copy of its details that ScribeForge can't read, and that the new file gets a fresh copy.** Save it, then look at the saved file's **Details**. **No box. Under What this file carries, Details says a second copy is kept in XMP format.**

## Locked files

17. Open `owner-locked.pdf`. **It opens without asking for a password.** Go to **Details**. **Password or restrictions: "Yes. It opens without a password, but its author doesn't allow…" followed by a list, including copying text and images and changing the document.**
18. Go to **Pages** and click **Save as new file…**. **A box says the new file won't have restrictions: owner-locked.pdf is locked by its author against some uses.** Click **Save without restrictions**, go past the list, and save it. **The saved file opens, and its Details say Password or restrictions: No.**
19. Open `protected.pdf` with the password `open-sesame`, and go to **Details**. **Password or restrictions: "Yes. It needs a password to open."**

## Settings, themes and text size

20. Go to **Settings**. **A new "Saving" section with "Before saving, show what the new file carries", ticked.** Untick it.
21. Open `normal.pdf`, rotate a page on **Pages**, and press Ctrl+S. **The Save dialog opens straight away, with no list first.** Cancel it. Go back to **Settings** and tick the box again.
22. Try **Light** and **High Contrast**. Each time, look at **Details** for any open file, and press Ctrl+S to see the list (then Cancel). **Everything is easy to read, and the list scrolls if it's long.**
23. Set **Text size** to **Larger** and look at **Details**. **Nothing is cut off.** Set it back to **Standard**.
24. In File Explorer, check the date modified of the files in `tests\fixtures\out`. **None have changed since step A.**

## Finish

25. Close the window (choose **Close without saving** if asked), delete your test folder, and delete the trial data:
```bash
npm run trial:reset
```

When everything matches, say "commit 1d". If anything was off, tell me the step number and what you saw.
