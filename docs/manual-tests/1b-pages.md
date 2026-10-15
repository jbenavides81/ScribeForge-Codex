# Manual test: stop 1b, the page tools

About 35 minutes. Everything runs in **trial mode**, and the test PDFs are made up. You'll save some new files, so first make a folder for them, for example `Desktop\ScribeForge test`. Delete it when you're done.

Each step says what to do, then **what you should see**. If something doesn't match, note the step number and what you saw.

## Setup

A. Install any new packages:
```bash
npm install
```
B. Make the test PDFs. This adds `links.pdf` and `second.pdf` for this stop.
```bash
npm run fixtures
```
C. Start from clean trial data:
```bash
npm run trial:reset
```
D. Start trial mode:
```bash
npm run trial
```

## The Pages screen

1. Open `tests\fixtures\out\links.pdf`, then click **Pages** in the navigation. **Six page thumbnails, numbered 1–6. Page 2 is wide, because it's turned sideways in the file itself. Under the toolbar: "6 pages · 0 selected · No changes".**
2. Click page 1, then **Rotate right**. **Page 1's thumbnail turns, "turned 90°" appears under it, and the status says "Changes not saved yet". A small dot appears next to Pages in the navigation.**
3. Click **Rotate left** twice, then **Undo** twice, then **Redo** once. **Page 1 ends up turned 90° again, and the buttons grey out when there's nothing more to undo or redo.**
4. Click page 3, then Ctrl+click page 4. **"2 selected".** Click page 2, then Shift+click page 5. **"4 selected" (pages 2–5).**
5. Drag page 5 and drop it on the left half of page 1. **It becomes page 1, and its label says "was page 5".**
6. Select one page and use **Move earlier** and **Move later**. **It moves one place each time and stops at either end.**
7. Click the last page (the original page 6; it has no "was page" label) and press the Delete key. **5 pages.** Press Ctrl+A, then Delete. **A message says the last page can't be deleted. A PDF needs at least one page.**
8. Click page 2, then **Insert blank page**. **A blank page appears after page 2, the same size and shape as page 2.**

## Saving a new file

9. Click **Document** in the navigation. **A strip at the top says this shows the file as it was opened, and your changes go into the new file when you save.**
10. Go back to **Pages** and click **Save as new file…** (or press Ctrl+S). **The Save dialog starts in `tests\fixtures\out` with the name `links (edited).pdf`.** Save it in your test folder instead.
11. Read the message. **"Saved links (edited).pdf (… pages)." It also says some links and bookmarks pointed to pages that aren't in the new file (page 6), so they were left out. A line says scripts and other actions were removed. The new file opens in ScribeForge.**
12. Open the saved file in **Microsoft Edge**. **The pages are in your new order and turned as you set them. Page 6 isn't there. In Edge's table of contents (bookmarks): "Part A" with "Page 2" and "Page 3" under it, and "Part B" with "Chapter six" gone (it pointed at page 6) and "Page 5".**

## Merging, extracting and splitting

13. Open `links.pdf` again (choose **Discard changes** if asked), go to **Pages** and click **Add files…**. Choose `second.pdf`. **8 pages. Pages 7 and 8 say "second.pdf, page 1" and "second.pdf, page 2", and they're selected.**
14. Click **Save as new file…**. **The suggested name is `links (merged).pdf`.** Save it in your test folder, then open it in Edge. **Its bookmarks are "links" (with Part A and Part B inside) and "second" (with "Second start" inside).**
15. Open `links.pdf` again, select pages 2 and 4 (click, then Ctrl+click), and click **Save selected pages…**. **The suggested name is `links (pages 2, 4).pdf`.** Save it. **The saved file has just those 2 pages, and links.pdf stays open on the Pages screen as it was.**
16. Click **Split…**, choose **These page ranges** and type `5-2`. Click **Choose a folder and split**. **An error says that range runs backwards. Nothing is saved.**
17. Change the ranges to `1-2, 3, 4-6` and click **Choose a folder and split**. Choose your test folder. **"Split into 3 files in …". The folder has `links (pages 1-2).pdf`, `links (page 3).pdf` and `links (pages 4-6).pdf`.**
18. Split again with **Every page as its own file** into the same folder. **6 new files. Where a name was already taken, the new file gets " 2" on the end. Nothing is overwritten.**

## Your original stays safe

19. Copy `normal.pdf` into your test folder as `test-original.pdf`, open it, rotate page 1 on **Pages**, and click **Save as new file…**. In the Save dialog, choose `test-original.pdf` itself.
    - **Windows asks whether to replace it.** Say yes.
    - **ScribeForge then asks a second, plain question: "This replaces the original file, test-original.pdf."** Click **Cancel**.

    **Nothing is saved, and in File Explorer the file's date modified hasn't changed.**
20. Do step 19 again, but this time click **Replace the original**. **"Saved test-original.pdf". The date modified changes, and the file opens with page 1 turned.**

## Unsaved changes

21. Rotate any page, then click the **×** in the Document toolbar (or press Ctrl+W). **"Discard your page changes?"** Click **Keep editing**. **Nothing closes.**
22. Open another PDF from **Start**. **The same question.** Click **Discard changes**. **The other PDF opens.**
23. Rotate a page, then close the ScribeForge window with its own **×**. **Windows asks about page changes that aren't saved yet.** Click **Keep editing**. **The window stays open.** Close it again and choose **Close without saving**. **ScribeForge closes.** Start it again with `npm run trial`.

## Passwords, dropping files, large files

24. Open `protected.pdf` (password `open-sesame`), go to **Pages** and click **Save as new file…**. **A box says protected.pdf is password-protected and the new file will open without a password.** Click **Save without a password** and save it. **The saved file opens without asking for a password.**
25. Open `links.pdf`, go to **Pages**, and drag `second.pdf` from File Explorer onto the page thumbnails. **Its two pages are added, as with Add files.**
26. Open `large.pdf` and go to **Pages**. **600 thumbnails. Scrolling quickly, they fill in as you go.** Use **Add files…** to add `large.pdf` again. **1200 pages.** Click **Save as new file…** and save it. **It takes a few seconds at most.**

## Keyboard and themes

27. On **Pages**, click a thumbnail, then use only the keyboard. Try:
    - arrow keys move between pages;
    - Space selects or unselects;
    - Shift+arrow selects a range;
    - Alt+Left and Alt+Right move the selected pages;
    - Delete deletes them;
    - Ctrl+Z undoes and Ctrl+Y redoes.

    **Each does what it says, and a clear ring shows which page you're on.**
28. In **Settings**, try **Light** and **High Contrast**, then look at **Pages**. **Selected pages and page edges are easy to see in both.**
29. In File Explorer, check the date modified of the files in `tests\fixtures\out`. **None have changed since step B.**

## Finish

30. Close the window, delete your test folder, and delete the trial data:
```bash
npm run trial:reset
```

When everything matches, say "commit 1b". If anything was off, tell me the step number and what you saw.
