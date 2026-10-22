# Redacting

Redacting removes text and pictures from a file for good. ScribeForge doesn't just cover them with a black box: every page with a mark becomes a picture of the page with the marked parts blacked out, so none of that page's text is left in the file.

## Marking what to remove

On the **Document** screen, choose **Redact** at the start of the second toolbar. Then:

- **Mark area**: drag a box across part of a page.
- **Mark text**: select the text. The mark covers exactly the letters you selected.
- **Find and mark**: type a word or phrase and click **Mark all**. Every match on every page is marked, including text you can't see, such as text on a hidden layer or the invisible text in a scanned page.
- **Find patterns…**: find everything of a kind, on every page (see below).

Marks are see-through until you redact, so you can check what's under them. With **Select** chosen, click a mark to remove it, or press `Delete`. `Ctrl+Z` and `Ctrl+Y` undo and redo.

## Finding patterns

Click **Find patterns…** to find, on every page:

- **Email addresses**, such as name@example.com.
- **Phone numbers**, such as (555) 123-4567 or +44 20 7946 0958: 10 to 15 digits, or a local 555-1234.
- **Social Security numbers**, written 123-45-6789 or 123 45 6789. Numbers the Social Security Administration never issues (starting 000, 666 or 9, or with 00 or 0000 in them) aren't matched.
- **Card numbers**: 13 to 19 digits that pass the card-number check, so a random long number isn't mistaken for one.
- **Words or phrases** you type, one per line. Like Find and mark, capitals and spacing don't matter.

Click **Find**. Every match is listed by kind and page, all ticked. Untick any you don't want marked, then click **Mark**. Each mark says which kind found it.

Patterns find what looks right, not what is right. A number shaped like a phone number is marked as one, so check the list before marking.

## Redacting

1. Click **Review and redact…**. All the marks are listed by page. Remove any you don't want.
2. If you want a record of what was redacted, tick **Also save a redaction log next to the redacted file**. It's unticked each time.
3. Click **Redact…**. ScribeForge makes the marked pages into pictures, with the marks blacked out.
4. A summary shows what was redacted, what was left out, and what the new file still carries. Click **Choose where to save…**.

The new file is named `<name> (redacted).pdf`, and it opens when it's saved. Your original isn't changed.

## The redaction log

A plain text file saved next to the redacted file, named like `report (redacted) (redaction log).txt`. It lists when the file was redacted, which file it came from, the picture quality, what was left out, the result of the last check, and each mark's page and kind.

It never contains the text that was removed, only a hint such as `j•••@e•••.com`, `(•••) •••-••67` or `J••• S•••`. A log that repeated the secret would undo the redaction. Social Security numbers show no digits at all.

## What a redacted file keeps

Only the pages, and the links between them. It leaves out the document's details (title, author and so on), comments, form fields, bookmarks, attached files, scripts and any annotations you added.

Pages without marks are copied exactly as they are. Their text can still be selected and searched.

## A last check

After making the redacted file, ScribeForge searches it for every word or phrase you marked with **Find and mark**, and every value you marked with **Find patterns…** (as long as all its matches were still marked). If it still finds one, it tells you before anything is saved.

## Picture quality

Redacted pages are pictures at 200 dots per inch, about half a megabyte a page. You can choose 150 (smaller files) or 300 (sharper) in **Settings**, under **Redaction**.
