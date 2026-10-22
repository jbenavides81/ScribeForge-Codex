# Cleaning up

**Clean up** makes a copy of the open file without the things you choose: details, attachments, form data, comments, what's on hidden layers, bookmarks and hidden page data. It's for sending a file to someone without what it carries behind its pages. The file you opened isn't changed.

The copy is made like any new file: from the pages as arranged on the **Pages** screen, with any annotations you've added.

## Choosing what to remove

Click **Clean up** on the left (or **View > Clean up**). The screen lists what the file carries, the same list the [Details](05-details.md) screen shows, with a choice for each:

- **Details**: removes the title, author, subject, keywords, the program that made the file, its dates, and any extra details another program added. Both copies go: the classic list and the XMP copy. The new file only says ScribeForge made it, and when.
- **Attached files**: removes files attached to pages. Files attached to the whole document are never copied into new files anyway.
- **Scripts and actions**: always removed from every new file.
- **Form fields**:
    - **Keep**: they look the same but can't be filled in (as in any new file);
    - **Burn into the page**: what they show becomes part of the page, and the fields and their data go;
    - **Remove**: they're gone.
- **Comments**:
    - **Keep**;
    - **Burn into the page**: they look the same but become part of the page, so their text and replies go;
    - **Remove**: they're gone.
- **Hidden layers**: takes what's on hidden layers out of the pages, so it's gone from the file, not just hidden. The pages look the same. Layers that show are kept.
- **Bookmarks**: removes them.
- **Hidden page data**: removes data other programs keep with a page, and small pictures of pages.

Click **Choose everything** to tick them all (form fields and comments are then removed).

## Saving

Click **Clean up and save…**. A summary shows what was removed and what the new file still carries. Then choose where to save it. It's named `<name> (cleaned).pdf`, and it opens when it's saved.

## Things to know

- A page's hidden content is left in place (still hidden) if it sits in the middle of a line of text that shows, because taking it out would move that text. The summary says when this happens.
- A comment or form field burned into the page keeps its look. If it had no look of its own (some readers draw comments themselves), ScribeForge draws it the way it would save it.
- To remove text from the pages themselves, use [Redacting](06-redacting.md).
