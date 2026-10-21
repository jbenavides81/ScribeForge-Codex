# Manual test: stop 2b, the full set of annotations

About 40 minutes. Everything runs in **trial mode**, and the test PDFs are made up. You'll save a few new files, so first make a folder for them, for example `Desktop\ScribeForge 2b test`. Delete it when you're done.

You'll annotate as one person ("Alex Doe"), save, then reopen the file as someone else ("Sam Lee"), so Alex's annotations are ones "already in the file". The last part opens the files in Microsoft Edge.

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

## New kinds of annotation

1. Click **Settings**. Under **Annotations**, type `Alex Doe` as your name.
2. Open `tests\fixtures\out\links.pdf`. In the second toolbar, **Annotate** is chosen. **The tools are Select, Highlight, Underline, Strikeout, Note, Text box, Draw, Shape and Stamp.**
3. Click the blue circle, then **Draw**. **A Thickness choice appears beside the colours.** Draw two strokes on page 1's empty space. **Both strokes show in blue as you draw.** Click **Select**, then click one stroke. **One panel: "Drawing on page 1", with both strokes outlined together.** Click **Done**.
4. Click **Shape**. **Choices: Shape (Rectangle), Thickness, and Fill.** Tick **Fill** and drag a box on the page. **A blue rectangle filled with light blue; a panel: "Rectangle on page 1".** Click **Done**.
5. Click **Shape**, choose **Ellipse** and **Thick**, and drag. **A thick blue ellipse.** Click **Done**.
6. Click **Shape**, choose **Arrow**, and drag from one place to another. **An arrow, its head where you let go.** In the panel's **Comment**, type `Look here`. Click **Done**.
7. Click **Stamp**, leave **Approved**, and click near the top right of the page. **A green "Approved" stamp with today's date under it.** Click **Done**.
8. Click **Stamp**, choose **Your own text**, type `Paid in full` in **Stamp text**, and click somewhere else. **A stamp saying "Paid in full", with today's date.** Click **Done**.
9. Click **Text box**, choose **Text size 18 pt**, click on the page and type `Big words`. **Large text in the box.** Click **Done**.
10. Click **Highlight** and select "UNIQUE-PAGE-1". Click **Select**, click the highlight, and type `Please check this name` as its comment.

## Moving and resizing

11. With **Select**, drag the "Approved" stamp somewhere else. **It moves with the mouse.** Drag the small square at its bottom-right corner. **It gets bigger.**
12. Press `Ctrl+Z` twice. **First it's its old size, then back where it was.** Press `Ctrl+Y`. **It moves again.**
13. With the stamp selected, press the right arrow key a few times, then `Shift` and the right arrow. **It moves a little each time, and further with Shift.** Press `Alt` and the left arrow. **It gets narrower.**
14. Click the arrow. **Small squares at its two ends.** Drag the square at its head. **Only that end moves.**
15. Drag the drawing by one of its strokes. **The whole drawing moves.**

## Comments and replies

16. Click **Comments** in the toolbar. **A panel on the right: "Comments", with "Who" and "Kind" choices, then the annotations listed under "Page 1", each with "Alex Doe, not saved yet".** It also lists links.pdf's own note "NOTE-ON-PAGE-1" with **1 reply** (that reply is on page 5).
17. Choose **Kind: Stamp**. **Only the two stamps.** Choose **All kinds** again.
18. Click the highlight in the list. **The page shows it and its panel opens.** Click **Reply** and type `First reply`. **In the list, the highlight says "1 reply".**
19. Press `Ctrl+Shift+M`. **The comments panel closes.** Press it again. **It opens.**
20. Click **Save as new file…**, go on past the list of what the file carries, and save as `alex.pdf` in your test folder. **"Saved alex.pdf (6 pages)" and "9 annotations saved with the pages."** The new file opens.

## Annotations already in the file

21. Click **Settings** and change your name to `Sam Lee`. Go back to **Document**. **The annotations look just as before. In Comments, they now show "Alex Doe" and a date, not "not saved yet".**
22. Click **Select**, then click the highlight. **The panel says "Already in the file, by Alex Doe" and a date, with "First reply" under Replies.**
23. Click the green circle. **The highlight turns green.** Change the comment to `Checked by Sam`. Click **Reply** and type `Thanks, Alex`.
24. Click the "Paid in full" stamp and click **Delete**. **It's gone, and the comments list has one fewer.** Press `Ctrl+Z`. **It's back.** Click **Delete** again.
25. Save as `sam.pdf`. **The message says "1 annotation saved with the pages", "1 annotation already in the file was changed" and "1 annotation was deleted".**

## Burning annotations into the page

26. In `sam.pdf` (now open), click the "Approved" stamp and tick **Burn into the page when saving**. Save as `burned-one.pdf`. **"1 annotation was burned into the pages."**
27. In `burned-one.pdf`, click where the stamp is. **Nothing is selected: the stamp is part of the page now.** Try selecting its text with the mouse: **it can't be selected.** It isn't in the comments list.
28. Open **Comments** and tick **When saving, burn all annotations into the pages**. Save as `burned-all.pdf`. **Everything on the page looks the same, but Comments says "No annotations yet."** The link on page 1 ("Go to page 3") still works.

## In Microsoft Edge

29. In File Explorer, right-click `alex.pdf` in your test folder, choose **Open with**, then **Microsoft Edge**. **Every annotation from steps 3 to 10 shows as it did in ScribeForge: the drawing, the filled rectangle, the thick ellipse, the arrow, both stamps with their dates, the large text and the highlight.** Click the highlight or open Edge's comments list: **its comment "Please check this name", by Alex Doe, with the reply "First reply" under it.** Note how Edge shows the reply (under the comment, or as its own note).
30. Open `sam.pdf` in Edge. **The highlight is green, with the comment "Checked by Sam" and both replies. The "Paid in full" stamp isn't there.**
31. Open `burned-all.pdf` in Edge. **The page looks the same, but there are no annotations to click or select, and Edge's comments list is empty.**
32. Close Edge.

## Unsaved changes

33. Back in ScribeForge, add a note, then click the close button at the right of the top toolbar (close document). **It asks first, because the note isn't saved.** Click **Keep editing**.

## Finish

34. Close ScribeForge and delete your test folder.
