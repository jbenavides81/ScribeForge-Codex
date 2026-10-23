# Saving and your original files

ScribeForge never changes the files you open. Everything you do is saved to a **new file**.

## How saving works

- **Save as new file…** (or `Ctrl+S`) builds a brand-new PDF from your pages, annotations and details, and asks where to save it.
- The suggested name says what happened: `<name> (edited).pdf`, `<name> (merged).pdf`, `<name> (pages 1-3).pdf`, `<name> (redacted).pdf`, `<name> (cleaned).pdf` or `<name> (signed).pdf`. If a file with that name is already there, ScribeForge adds a number instead of replacing it.
- If you choose the original file itself, Windows asks whether to replace it, and then ScribeForge asks again, in plain words. Only then is the original replaced.

## Before saving

ScribeForge shows what the new file carries besides its pages: its details, attached files, comments, scripts, bookmarks, hidden layers and links. You can turn this off in **Settings**, under **Saving**. Redacting always shows it.

## What a new file leaves out

- Scripts and actions that could run code, open a program or send data.
- Files attached to the whole document. (Files attached to a page stay with that page.)
- Links and bookmarks that pointed to pages that aren't in the new file.
- Form fields keep their look, but can't be filled in any more.
- Signatures, and their boxes: a signature only holds for the exact file that was signed. ScribeForge asks before saving a signed file. To add a signature and keep the ones already there, use [Signing](14-signing.md).

The message after saving lists what was left out.

## Passwords and restrictions

The new file has no password, and none of the restrictions an author may have set (such as no copying). If any of your pages come from a file like that, ScribeForge asks before saving.

## Unsaved changes

If you close the document, open another file or close ScribeForge with changes that aren't saved yet (pages, annotations, details or redaction marks), ScribeForge asks first.
