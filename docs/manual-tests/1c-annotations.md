# Manual test: stop 1c, annotations

About 30 minutes. Everything runs in **trial mode**, and the test PDFs are made up. You'll save some new files, so first make a folder for them, for example `Desktop\ScribeForge test`. Delete it when you're done.

Each step says what to do, then **what you should see**. If something doesn't match, note the step number and what you saw.

## Setup

A. Install packages (nothing new this stop, but it keeps things in step):
```bash
npm install
```
B. Make the test PDFs:
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

## Your name

1. Go to **Settings**. **A new section, "Annotations", with a "Your name on annotations" box. It's empty.**
2. Type your name (or a made-up one) and press Enter.

## Marking text

3. Open `tests\fixtures\out\normal.pdf`. **Under the usual toolbar there's a second row:**
    - **Select** (pressed), **Highlight**, **Underline**, **Strikeout**, **Note** and **Text box**;
    - six colour circles (yellow is chosen);
    - **Undo** and **Redo**, both greyed out;
    - a hint, and **Save as new file…**.
4. Click **Highlight**. **The hint says "Select text to highlight it."** Drag across "The forge keeps an anvil by the door." **It turns yellow, and the text selection disappears.**
5. Click the **blue** circle, then **Underline**, and drag across "Copy this line: quill and anvil 0O1lI". **A blue line appears under the text.**
6. Click the **red** circle, then **Strikeout**. Scroll to page 2 and drag across "A second anvil stands in the corner." **A red line runs through the middle of the text.**
7. Click **Highlight** again, and drag from the middle of one line on page 3 to the middle of the next line. **One highlight covering the end of the first line and the start of the second, in red (the colour still chosen).**
8. Click **Select**, then drag across some text. **It's selected the normal way, with no highlight. Ctrl+C copies it.**

## Changing and deleting

9. With **Select** on, click the yellow highlight from step 4. **A panel opens at the top right: "Highlight on page 1", the six colours (yellow ringed), a Comment box, Delete and Done. The highlight gets a blue outline.**
10. Click the **green** circle in the panel. **The highlight turns green.** Type a comment, such as "Check this", then click **Done**. **The panel closes.**
11. Click the red strikeout on page 2, then press the **Delete** key. **It's gone.** Press **Ctrl+Z**. **It's back.** Press **Ctrl+Y**, then **Ctrl+Z** again. **Gone, then back.**
12. Click **Undo** in the toolbar until it greys out. **Each click takes back one thing, newest first, down to no marks at all.** Click **Redo** until it greys out. **Everything comes back.**

## Notes and text boxes

13. Click **Note**. **The hint says "Click on the page where the note goes." Over the page, the pointer is a crosshair.** Click in the right-hand margin of page 1. **A small note icon appears there. The panel opens with the cursor already in the Comment box.** Type a note, then click **Done**. **The toolbar goes back to Select.**
14. Click **Note** again, then press **Escape**. **Back to Select, and no note was added.**
15. Choose a colour, click **Text box**, and click on an empty part of page 3. **A box with a blue outline appears (it's selected). The panel says "Text box on page 3", with the cursor in its Text box, and says an empty text box isn't saved.** Type two lines (press Enter between them). **The text appears on the page in the chosen colour as you type.** Click **Done**. **The outline goes; just your text is left.**
16. Add one more text box and click **Done** without typing anything. **A dashed empty box stays on the page.** (It won't be saved; step 19 checks this.)
17. Zoom in twice with the **+** button, then choose **Fit page**, then **Fit width**. Hide and show the thumbnails. **Every mark stays on its text, and the note and text boxes stay where you put them.**
18. Look at **Pages** in the navigation. **No dot: annotations aren't page changes.** Click the **×** at the top right of the Document screen. **"Discard your changes?", mentioning annotations.** Click **Keep editing**.

## Saving and checking in another reader

19. Click **Save as new file…** (or press Ctrl+S). **The suggested name is `normal (edited).pdf`.** Save it in your test folder. **The message says "Saved normal (edited).pdf (3 pages)" and how many annotations were saved (the empty text box isn't counted). The new file opens.**
20. In the reopened file, the marks are now part of the document. **They look the same as before saving. The note shows as pdf.js's own yellow note icon, whatever colour you chose; other readers use your colour. Clicking them doesn't open the annotation panel: ScribeForge only changes annotations added since the file was opened.**
21. Open the saved file in **Microsoft Edge**. **The highlights, underline, strikeout and text box show in your colours and places. The note shows as a note icon. Clicking the note, or the green highlight, shows its text ("Check this" for the highlight). If Edge shows who wrote a comment, it's the name from step 2.**

## Annotations and page changes

22. In ScribeForge, open `links.pdf` (choose **Discard changes** if asked). Page 2 is sideways in the file itself. Click **Underline** and drag along "UNIQUE-PAGE-2" on page 2 (the text runs down the page, near the top right). **A line runs down beside the text, along the bottoms of the letters, not across its end.** Add a text box on page 2 too, with any text. **It reads normally, left to right.**
23. Click **Highlight** and highlight "UNIQUE-PAGE-5" on page 5.
24. Go to **Pages**. Delete page 5, then drag page 2 onto the left half of page 1. Go back to **Document**. **The strip at the top says this shows the file as it was opened.**
25. Save it in your test folder. **The message says 2 annotations were saved, and 1 annotation was on a page that isn't in the new file, so it was left out.**
26. Open that file in Edge. **Page 1 is the sideways page, with the underline still along the bottoms of the letters of "UNIQUE-PAGE-2", and the text box reading left to right where you put it. No page has the page 5 highlight.**

## Settings, themes and text size

27. Close the ScribeForge window (choose **Close without saving** if asked) and start it again with `npm run trial`. Go to **Settings**. **Your name is still there.**
28. Try **Light**, **Dark** and **High Contrast**. Each time, open a PDF, add a highlight and click it. **In every theme, the tool you're using is clearly marked, the chosen colour has a ring, and the panel is easy to read.**
29. Set **Text size** to **Larger**, then look at the Document screen. **The annotation toolbar wraps onto more rows, but nothing is cut off.** Set it back to **Standard**.
30. In File Explorer, check the date modified of the files in `tests\fixtures\out`. **None have changed since step B.**

## Finish

31. Close the window, delete your test folder, and delete the trial data:
```bash
npm run trial:reset
```

When everything matches, say "commit 1c". If anything was off, tell me the step number and what you saw.
