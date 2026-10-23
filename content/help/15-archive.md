# The Archive

The **Archive** keeps copies of your PDFs in an encrypted vault on this PC, with titles, labels and notes, and a history of every change. Nothing in it can be read without your password, and it locks itself when you're not using it.

## Making the vault

1. Click **Archive** on the left (or **View > Archive**).
2. Type a password of at least 10 characters, twice.
3. Leave **Also make a recovery code** ticked if you want one: it opens the vault if you forget the password.
4. Click **Make the vault**. If you asked for a recovery code, it's shown once. Write it down and keep it somewhere safe, away from this PC.

ScribeForge never saves the password or the code. If you lose both, nobody can open the vault, ScribeForge included.

## Locking

The vault is locked:

- when ScribeForge starts;
- after a while without using ScribeForge (10 minutes, or what you choose in **Settings**);
- when Windows locks, and when the PC goes to sleep;
- when you click **Lock**.

Locking clears the key and everything decrypted from memory. A document you opened from the vault closes too, and any changes to it that aren't saved are lost. Only the Archive locks: you can keep working on files from your folders.

To unlock, type the password, or click **Use the recovery code instead**. After using the recovery code, it's a good idea to set a new password with **Change the password…**.

## Adding documents

- **Add PDFs…** adds PDFs from your folders. The files themselves aren't changed or moved: the vault keeps its own encrypted copies.
- **Add the open file** adds the PDF you have open.
- When you save a new file, tick **Also keep a copy in the Archive** in the list shown before saving (while the vault is unlocked). If the file you're working on came from the Archive, you can choose **Save as a new version of …** there instead.

Each document's title comes from the PDF's own title, or its file name. Click a document to change its title, give it labels (separated with commas) and write a note. **Label** and **Order** above the list help you find things.

## Searching

Type in **Search the Archive** and press Enter or click **Search**:

| Type | To find pages with |
|---|---|
| `lease rent` | both words, anywhere on the page |
| `"lease agreement"` | those words together, in that order |
| `insur*` | words starting that way: insured, insurance, insurer |

Capital letters and accents don't matter: `cafe` finds Café. Results are listed by document, best first, with the pages found and the matching words picked out. Click a page to open the document there. **Label**, **Added** and **Show voided documents** narrow the results; voided documents are left out unless you ask for them.

Search reads each page's text when a document is added. Pages that are only pictures, such as scans, have no text, so search can't find words on them: they're listed under **Pages without text**.

The search index is encrypted like everything else in the vault. If it's ever damaged, ScribeForge says so and makes it again from the documents. **Rebuild the search index…** does the same on request. Documents with a password ask for it while their text is read again.

## Using a document

- **Open** (or double-click it) opens a copy in ScribeForge, decrypted in memory only. You can use every tool on it; saving makes a new file, as always.
- **Save a copy…** saves a copy out of the vault, where you choose. That copy isn't encrypted.

## Versions

A document can have several versions: a draft and the signed copy, or this year's and last year's. Each one is kept, encrypted, exactly as it was added. The newest version is the one shown in the list, opened with **Open**, and searched.

Click a document to see its versions under **Versions**, newest first, with the date each was added, its pages and its file name.

- **Add a new version…** adds a PDF from your folders as the next version.
- **Add the open file as a new version** adds the PDF you have open.
- When you save a file that came from the Archive, choose **Save as a new version of …** in the list shown before saving.
- **Open** next to a version opens that version. Its name says which version it is.
- Type a note next to a version ("Signed by both", "After the meeting") to say what changed. The history records that a note changed, but never what it says.

Each version is checked against the checksum it was stored with whenever it's opened, so a damaged copy is refused with a message, never shown.

## Comparing two versions

When a document has two or more versions, choose them under **Compare version … with version …** and click **Compare**. ScribeForge reads both, page by page, and shows:

- a summary, such as "3 pages changed, 1 page added, 1 page removed and 1 page the same", or that the two versions are identical;
- each page that changed, the two versions side by side, with a red box around everything that looks different;
- the words removed and added on that page, and lines that moved to another place on the page;
- pages added or removed, next to a space saying the other version doesn't have them.

Tick **Show the pages that are the same** to see those too. **Stop** stops a long comparison, and **Back to the Archive** closes it.

Pages are matched by their words, so a page that moved (because a page was added before it) is still compared with itself: the heading says "Page 2, now page 3". Pages without text, such as scans, are matched by how they look, and their changes are shown by the red boxes only, since there are no words to list.

Both versions are decrypted in memory only while you compare them. If the vault locks, the comparison closes.

## Void, or erase for good

- **Void…** hides a document, but keeps it in the vault, with your reason. Tick **Show voided documents** to see it again, and **Restore** to bring it back.
- **Erase for good…** removes a document, every version of it, and everything about it from the vault. It can't be undone. Only its title and your reason stay, in the history. Copies already in backups aren't touched: restoring one of those brings the document back.

## History

**History** lists every change: documents and versions added, renamed, labelled, voided, restored and erased, version notes changed, copies saved out, backups, and password and recovery code changes. It never holds a document's contents, labels or notes.

Each entry is sealed to the one before it, so a change made to the history outside ScribeForge (an entry altered, removed or moved) is found and shown. ScribeForge itself never changes or removes an entry. The seal uses the vault's key: someone with your password and programming tools could rebuild the whole history, but nobody else can change it unnoticed. **Save as a text file…** saves the list.

## Backups

- **Make a backup…** saves the whole vault, every version included, as one encrypted file (`.sfbackup`). Keep it somewhere other than this PC, such as a USB drive. The vault's password when you made it (or the recovery code) opens it.
- **Restore a backup…** asks for that password or code, checks every part of the backup, says when it was made and how many documents it holds, and asks before replacing the vault on this PC. Anything added or changed since the backup was made is lost.

You can also restore a backup on a PC with no vault yet, from the Archive screen.

## Where it's kept

In `%APPDATA%\ScribeForge\Vault` (trial mode has its own). Everything there is encrypted: the database, the search index, each stored PDF, and their titles, labels and notes. AES-256-GCM both hides the data and detects any change to it, so a damaged file is refused with a message, never used.
