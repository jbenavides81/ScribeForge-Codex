# Changes

What each version of ScribeForge added, newest first.

What the three numbers mean:
- **The last number** (1.9.**1**) changes for fixes only.
- **The middle number** (1.**10**.0) changes for new features. Everything made by an older version still opens.
- **The first number** (**2**.0.0) changes when something made by an older version (a vault, a backup, a setting) can't be used any more, or a feature is removed.

## 1.10.0 (2026-10-26)

- **About** has a button that opens ScribeForge's releases page in your web browser. ScribeForge still never checks for a new version itself.
- A new help page, **Getting ScribeForge**: where releases are, why Windows warns about the installer, and how to check a download.
- Each release now comes with a checksum file, so you can check a download is the one published. It also lists checksums for the app's own files: these come out the same every time the app is built, so anyone can rebuild it from the source and compare.
- The installer no longer comes with files for automatic updates, which ScribeForge doesn't have.

## 1.9.0 (2026-10-26)

- **Automatic backups** of the Archive, to a folder that OneDrive or Google Drive syncs, or any folder (a USB drive too). The first is made when you turn them on; then one whenever the vault locks or ScribeForge closes, if anything changed. Each backup only adds what's new.
- **Restore from a backup folder**, on this PC or another. When the other PC has made a newer backup, unlocking offers it.
- **Erase for good** also removes the document from the backup folder.
- **Backup files** are written and restored a piece at a time, so a large vault no longer needs a lot of memory. Backups made by 1.6 to 1.8 still restore.

## 1.8.0 (2026-10-23)

- **Versions** in the Archive: add a new version of a document from a file, from the open file, or when saving. Each version keeps its date, file name and a note, and any version can be opened.
- **Compare two versions**, side by side, page by page: what looks different is boxed, and the words removed, added and moved are listed. Added and removed pages are shown, and identical versions say so.

## 1.7.0 (2026-10-23)

- **Search the Archive:** words, "exact phrases" and word starts (insur\*), ignoring capitals and accents. Results come by document, with the pages found and the matching words picked out; a result opens the document at its page.
- Filters by label, date added, and voided documents. Pages without text (scans) are listed.

## 1.6.0 (2026-10-23)

- **The Archive:** an encrypted vault on this PC for your PDFs, with titles, labels and notes. It needs a password (and an optional recovery code), and locks itself when ScribeForge starts, after a while unused, and when Windows locks or the PC sleeps.
- Void a document with a reason (and restore it), or erase it for good. A history of every change, sealed so changes to it are found.
- Encrypted backup files, and keeping a copy of a new file in the Archive when saving.

## 1.5.0 (2026-10-23)

- **Sign:** sign a PDF with a certificate file (.pfx or .p12), with a box drawn on the page, in an empty signature box, or invisibly. Make your own certificate.
- **Check signatures** without the internet: whether the file changed since it was signed, and whether each signer's certificate is trusted. Open exactly what a signature covers.
- `scribeforge verify` on the command line.

## 1.4.0 (2026-10-22)

- **Clean up:** make a copy without details, attached files, form fields, comments, what's on hidden layers, bookmarks or hidden page data. Drawing on hidden layers is taken out, not just hidden.
- Redaction can keep details, bookmarks, comments and form fields on pages without marks, if you choose.

## 1.3.0 (2026-10-22)

- **Find patterns** to redact: email addresses, phone numbers, US Social Security numbers, card numbers and a list of words.
- An optional **redaction log**, which never contains the removed text.

## 1.2.0 (2026-10-21)

- **More annotations:** drawing, shapes, stamps, moving and resizing, a comments panel, replies, and changing or deleting annotations already in the file.
- **Burn annotations into the page.**

## 1.1.0 (2026-10-21)

- **The command line:** `scribeforge` merges, splits, rotates, extracts, shows details and redacts without opening the window.
- The installed program is locked down: it runs only its own files, and refuses to start if they've been changed.

## 1.0.0 (2026-10-21)

- **Help** built in (F1), the final icon, and a final check of every theme's contrast.
- The installer, and the guides for installing and contributing.

## 0.5.0 (2026-10-21)

- **Redact:** mark areas, selected text or every match of a search; each marked page becomes a picture with the marks blacked out, so no text from it survives. A last check searches the new file.

## 0.4.0 (2026-10-19)

- **Details:** see and change a file's title, author, subject and keywords, and see everything else it carries. Before saving, a list of what the new file will carry.

## 0.3.0 (2026-10-19)

- **Annotate:** highlight, underline and strike out text, and add notes and text boxes.

## 0.2.0 (2026-10-15)

- **Pages:** merge, split, reorder, rotate, delete, extract and insert blank pages, with undo. Every result is saved as a new file.

## 0.1.0 (2026-10-15)

- **The viewer:** open PDFs, with thumbnails, search, zoom and copying text. Password-protected files ask for the password and never store it. ScribeForge never connects to the internet, and PDF JavaScript never runs.
