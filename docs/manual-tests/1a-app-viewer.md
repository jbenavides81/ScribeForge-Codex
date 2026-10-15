# Manual test: stop 1a, the app and the viewer

About 30 minutes. Everything runs in **trial mode**, so your real settings are never touched. The test PDFs are made up.

Each step says what to do, then **what you should see**. If something doesn't match, note the step number and what you saw.

## Setup

Do these first, in a terminal in the `ScribeForge-Codex` folder.

A. Make sure the packages are installed:
```bash
npm install
```
B. Make the test PDFs (they go in `tests\fixtures\out`):
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

## The app

1. Look at the window. **The title bar says "ScribeForge (trial)". The navigation on the left shows the quill-and-anvil logo, Start, Document (greyed out), Settings, About, and "Trial mode: separate test data" at the bottom.**
2. Read the Start screen. **"Open a PDF", a line saying ScribeForge works entirely on this computer, an "Open a PDF…" button, and under Recent files: "Files you open will appear here."**

## Opening and viewing

3. Click **Open a PDF…** and choose `tests\fixtures\out\normal.pdf`. **The Document screen opens with page 1 and the toolbar shows "Page 1 of 3". Three thumbnails appear on the left; page 1's is outlined.**
4. Use **File > Open…** (or press Ctrl+O) and choose `normal.pdf` again. **It opens the same way, with 3 pages and 3 thumbnails, not 6.**
5. Click the **›** next to the page number, then **‹**. **The page number changes to 2, then back to 1.**
6. Type `3` in the page box and press Enter. **It jumps to page 3, and the › button is greyed out.**
7. Click thumbnail **2**. **It jumps to page 2 and thumbnail 2 is outlined.**
8. Try zoom:
   - the magnifier **+** and **−** buttons;
   - Ctrl+= and Ctrl+−;
   - the zoom list: choose **200%**, then **Fit page**, then **Fit width**.

   **The page grows and shrinks. At Fit width there's no sideways scroll bar.**
9. Click the thumbnails button (far left of the toolbar), then press Ctrl+T. **The thumbnails hide, then come back.**

## Finding and copying

10. Press Ctrl+F and type `anvil`. **"1 of 5" appears and the matches are highlighted on the page.**
11. Press Enter, then Shift+Enter. **"2 of 5", then "1 of 5".**
12. Type `dragon`. **"Not found".** Press Esc. **The box clears.**
13. On page 1, select the line `Copy this line: quill and anvil 0O1lI` with the mouse, press Ctrl+C, and paste into Notepad. **The same text appears in Notepad.**

## Links

14. On page 1, click **Go to page 3 (internal link)**. **It jumps to page 3, with no question asked.**
15. Go back to page 1 and click **Visit the example website (web link)**. **A box asks "Open this link in your web browser?" and shows `https://example.com/scribeforge-test`.** Click **Cancel**. **Nothing opens.**
16. Click the web link again, then **Open in browser**. **Your web browser opens the example.com page.** (The browser uses the internet; ScribeForge doesn't.)

## Large, protected and damaged files

17. In File Explorer, drag `large.pdf` onto the ScribeForge window. **It opens in about a second, showing "of 600". Scroll quickly through the pages; thumbnails fill in as you scroll.**
18. Open `protected.pdf`. **A box says "This file is password-protected".** Type `wrong` and click **Open**. **"That password didn't work. Try again." The box is empty again.**
19. Type `open-sesame` and click **Open**. **It opens with 2 pages, reading "Protected test document".**
20. Open `protected.pdf` again and click **Cancel**. **The box closes, nothing else changes, and there's no error message.**
21. Open `not-a-pdf.pdf`. **A message at the top says ScribeForge couldn't open it, and the file may be damaged or may not really be a PDF.** Dismiss it with the **×**.
22. Open `damaged-truncated.pdf`, then `damaged-xref.pdf`. **Each either shows the same kind of message, or opens with what could be read (pdf.js often repairs the second one). The app keeps working either way.**
23. Open `scripted.pdf`, wait a few seconds, then click the line **"Script link: clicking here must do nothing"**. **Nothing pops up and no browser opens. This file contains scripts that try to show a message and open web pages, and ScribeForge never runs them.**

## Settings

24. Open **Settings** and click each theme in turn: Cathedral, Light, Dark, High Contrast, Match system. **The whole window changes at once each time. All text stays easy to read, including the radio buttons and the outlines around controls.**
25. With **Match system** chosen, change Windows between light and dark (Windows Settings > Personalization > Colors > Choose your mode). **ScribeForge follows: Light or Dark.** (Optional.)
26. Try **Large** and **Larger** text, then go to the Document screen. **Everything grows; the toolbar may wrap onto two rows. Nothing is cut off.** Set it back to **Standard**.
27. Choose **Cathedral**, close the ScribeForge window, and run `npm run trial` again. **It comes back in Cathedral.**

## Recent files

28. On **Start**, look at Recent files. **The files you opened are listed, newest first, each with its folder.** Click one. **It opens.**
29. Copy `normal.pdf` to your Desktop as `copy.pdf` and open it in ScribeForge. Close the window, delete `copy.pdf`, and start trial mode again. **On Start, copy.pdf shows "Not found: …" and can't be clicked.** Remove it with its **×**.
30. In **Settings**, untick **Remember the files I open**. **On Start: "Recent files are turned off in Settings." Opening a file doesn't add it.** Tick it again.
31. On **Start**, click **Clear the list**. **The list empties.**

## About, keyboard, closing

32. Open **About**. **"ScribeForge", "Version 0.1.0 (trial mode)", "by BC6", three short promises and the Apache License line.** Click **Third-party notices**. **A list of the included software with licences opens (electron, react, pdfjs-dist, inter-ui and others).**
33. Put the mouse aside. Use Tab and Shift+Tab to move through the Start screen and, with a document open, the toolbar. Press Enter or Space to use buttons. **A clear ring in the theme's link colour always shows where you are.**
34. With a document open, press Ctrl+W. **The document closes and you're back on Start; Document is greyed out again.**
35. In File Explorer, check the date modified on the files in `tests\fixtures\out`. **They haven't changed since step B.**

## Finish

36. Close the window and delete the trial data:
```bash
npm run trial:reset
```

When everything matches, say "commit 1a". If anything was off, tell me the step number and what you saw.
