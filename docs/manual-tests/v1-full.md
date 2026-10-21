# Manual test: ScribeForge 1.0, the installed app

About an hour. This walks through everything in Phase 1 on the **installed** app, from installing to uninstalling. The test PDFs are made up. Make a folder for the files you'll save, for example `Desktop\ScribeForge test`, and delete it at the end.

Each step says what to do, then **what you should see**. If something doesn't match, note the step number and what you saw.

## Setup

A. Make the test PDFs and the installer:
```bash
npm run fixtures
```
```bash
npm run dist
```
B. In File Explorer, note the date modified of the files in `tests\fixtures\out`. You'll check they haven't changed at the end.

## 1. Installing

1. Open `release` and run `ScribeForge Setup 1.0.0.exe`. **The file has the ScribeForge icon: a gold anvil with a quill.** Windows says "Windows protected your PC": click **More info**, then **Run anyway**.
2. **The installer shows the same icon.** When it asks who to install for, keep **Only for me**, then keep the suggested folder and install. **No administrator prompt appears.**
3. Open the Start menu and find **ScribeForge**. **It has the icon, also at small sizes (the Start menu list and the taskbar).** Start it.

## 2. First look (about 5 minutes)

4. **The Start screen, in the Cathedral theme. The title bar says "ScribeForge" (not "trial").**
5. Click **About**. **"Version 1.0.0", "by BC6", and "Third-party notices", which opens to list the parts ScribeForge is built from and their licences.**
6. Press `F1`. **Help opens with a list of topics on the left.** Click **Redacting**, then the link to **Settings** at the bottom of a page. **Each opens, and links between pages work.**
7. In **Settings**, try each theme and text size. **Everything changes at once and stays readable.** Go back to Cathedral and Standard.

## 3. Reading (about 5 minutes)

8. Open `tests\fixtures\out\normal.pdf` (**Open a PDF…** on Start, or `Ctrl+O`). **Three pages, with thumbnails.**
9. Type `anvil` in **Find in document**. **"1 of 5"; `Enter` steps through them.**
10. Click "Visit the example website" on page 1. **A box shows the web address and asks first.** Click **Cancel**.
11. Open `large.pdf`. **"of 600", and the first page shows within about 2 seconds.**
12. Open `protected.pdf`. **It asks for a password;** type `open-sesame`. **It opens.**
13. Open `scripted.pdf` and wait a few seconds. **Nothing pops up and nothing opens.**
14. Open `damaged-truncated.pdf`, then `not-a-pdf.pdf`. **Each time, a plain message, and ScribeForge keeps working.**

## 4. Pages (about 10 minutes)

15. Open `links.pdf` and click **Pages**. Turn page 1 with **Rotate right**, delete page 6, and drag page 3 before page 1.
16. Click **Add files…** and add `second.pdf`. **8 pages.**
17. Click **Save as new file…**. **First, "What the new file carries".** Click **Choose where to save…**, and save in your test folder as suggested (`links (merged).pdf`). **"Saved links (merged).pdf (7 pages)", with notes on what was left out; the new file opens.**
18. Open `links.pdf` again (**Discard changes** if asked), go to **Pages**, click **Split…**, choose **Every page as its own file** and save into your test folder. **"Split into 6 files".**
19. Open one of the saved files in **Microsoft Edge**. **It opens normally.**

## 5. Annotating (about 10 minutes)

20. In **Settings**, type your name under **Your name on annotations** and press `Enter`.
21. Open `normal.pdf`. With **Annotate** chosen, highlight a line, add a note and a text box with some text.
22. Click **Save as new file…**, go past the list, and save. **"3 annotations saved with the pages."**
23. Open the saved file in Edge. **The highlight, note and text box are there; clicking the note shows its text.**

## 6. Details (about 5 minutes)

24. Open `carries.pdf` and click **Details**. **Its title, author, page sizes, and everything it carries: attachments, form fields, comments, scripts, bookmarks, layers (one hidden) and links.**
25. Change the **Title**, then save. **The list before saving shows your new title and no scripts or form fields.** On the saved file's **Details**, **the title is yours.**
26. Open `owner-locked.pdf`. **Details: "Yes. It opens without a password, but its author doesn't allow…".**

## 7. Redacting (about 10 minutes)

27. Open `redaction.pdf`. Choose **Redact**, type `REDACT-ME-TERM` in **Find and mark** and click **Mark all**. **"Marked 4 matches on 2 pages."**
28. Click **Mark area** and drag a box around the heading on page 2.
29. Click **Review and redact…**, then **Redact…**. **The summary says 5 marks on 2 pages are blacked out, and lists what was left out.** Save it.
30. **The redacted file opens. Page 1 is unchanged; pages 2 and 3 have solid black boxes, and their text can't be selected.** Find `REDACT` in the file: **"Not found".** Zoom to 300%: **no bits of letters show around the boxes.**
31. Open the redacted file in Edge and search for `REDACT-ME-TERM`. **No results.**

## 8. Your files and settings (about 5 minutes)

32. In File Explorer, check `tests\fixtures\out`. **No file's date modified has changed since step B, and nothing new was saved there.**
33. Open `%APPDATA%\ScribeForge` (type it in File Explorer's address bar). **A `settings.json` file. Open it in Notepad: your choices and the recent-files list, and no passwords.**
34. Close ScribeForge with an unsaved change (rotate a page first). **It asks first.** Choose **Close without saving**.

## 9. Uninstalling

35. In Windows, open **Settings > Apps > Installed apps**, find **ScribeForge** (the publisher is BC6) and choose **Uninstall**. **It's removed without errors.**
36. **ScribeForge is gone from the Start menu, and its install folder (`%LOCALAPPDATA%\Programs\ScribeForge`) is gone.** Your settings in `%APPDATA%\ScribeForge` are kept; delete that folder if you want them gone.

## Finish

37. Delete your test folder.

When everything matches, say "commit 1f". If anything was off, tell me the step number and what you saw.
