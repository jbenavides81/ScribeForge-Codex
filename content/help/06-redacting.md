# Redacting

Redacting removes text and pictures from a file for good. ScribeForge doesn't just cover them with a black box: every page with a mark becomes a picture of the page with the marked parts blacked out, so none of that page's text is left in the file.

## Marking what to remove

On the **Document** screen, choose **Redact** at the start of the second toolbar. Then:

- **Mark area**: drag a box across part of a page.
- **Mark text**: select the text. The mark covers exactly the letters you selected.
- **Find and mark**: type a word or phrase and click **Mark all**. Every match on every page is marked, including text you can't see, such as text on a hidden layer or the invisible text in a scanned page.

Marks are see-through until you redact, so you can check what's under them. With **Select** chosen, click a mark to remove it, or press `Delete`. `Ctrl+Z` and `Ctrl+Y` undo and redo.

## Redacting

1. Click **Review and redact…**. All the marks are listed by page. Remove any you don't want.
2. Click **Redact…**. ScribeForge makes the marked pages into pictures, with the marks blacked out.
3. A summary shows what was redacted, what was left out, and what the new file still carries. Click **Choose where to save…**.

The new file is named `<name> (redacted).pdf`, and it opens when it's saved. Your original isn't changed.

## What a redacted file keeps

Only the pages, and the links between them. It leaves out the document's details (title, author and so on), comments, form fields, bookmarks, attached files, scripts and any annotations you added.

Pages without marks are copied exactly as they are. Their text can still be selected and searched.

## A last check

After making the redacted file, ScribeForge searches it for every word or phrase you marked with **Find and mark** (as long as all its matches were still marked). If it still finds one, it tells you before anything is saved.

## Picture quality

Redacted pages are pictures at 200 dots per inch, about half a megabyte a page. You can choose 150 (smaller files) or 300 (sharper) in **Settings**, under **Redaction**.
