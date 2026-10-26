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
- **Erase for good…** removes a document, every version of it, and everything about it from the vault. It can't be undone. Only its title and your reason stay, in the history. It's removed from automatic backups too. Backup files you saved yourself aren't touched: restoring one of those brings the document back.

## History

**History** lists every change: documents and versions added, renamed, labelled, voided, restored and erased, version notes changed, copies saved out, backups, and password and recovery code changes. It never holds a document's contents, labels or notes.

Each entry is sealed to the one before it, so a change made to the history outside ScribeForge (an entry altered, removed or moved) is found and shown. ScribeForge itself never changes or removes an entry. The seal uses the vault's key: someone with your password and programming tools could rebuild the whole history, but nobody else can change it unnoticed. **Save as a text file…** saves the list.

## Backups

There are two kinds, and you can use both: automatic backups to a backup folder, and backup files you make yourself. Both are encrypted: the vault's password (or recovery code) opens them.

### Automatic backups

Under **Keeping the vault safe**, click **Turn on automatic backups…** and choose where:

- **OneDrive** or **Google Drive**, when they're on this PC. Their folders are synced with the internet, so the backups are kept online too, and you can restore them on another PC.
- **Choose another folder…**: any folder, such as one on a USB drive.

A folder called **ScribeForge Archive backup** is made there, and the first backup is made straight away. After that, a backup is made whenever the vault locks or ScribeForge closes, if anything changed. **Back up now** makes one whenever you like.

Each backup only adds what's new. A document is copied into the folder once; after that, each backup adds a small file (about the size of the vault's list of documents) and any new documents. **Backups to keep** says how many backups are kept (10 to start with); older ones are removed.

ScribeForge never goes online itself: OneDrive or Google Drive does the uploading, from the folder on this PC. If the folder isn't there (OneDrive is signed out, or the USB drive is unplugged), the vault still locks at once, and the Archive says the backup didn't work.

Someone who could open your OneDrive or Google Drive could see how many stored files there are, their sizes, and when backups were made. Everything else (titles, labels, notes, file names, words and pages) is encrypted.

### Backup files

- **Make a backup…** saves the whole vault, every version included, as one encrypted file (`.sfbackup`). Keep it somewhere other than this PC, such as a USB drive.
- **Restore a backup…** restores one of these files.

### Restoring

**Restore a backup…** (a backup file) or **Restore from a backup folder…** asks for the password the vault had when the backup was made, or its recovery code. It checks the backup, says when it was made and how many documents it holds, and asks before replacing the vault on this PC. Anything added or changed since the backup was made is lost.

From a backup folder, the newest complete backup is used. You can choose the **ScribeForge Archive backup** folder, or the folder it's in (such as OneDrive itself). If a newer backup is still arriving from another PC, ScribeForge says so: wait a few minutes and try again to use it.

You can restore on a PC with no vault yet, from the Archive screen.

### Using the vault on two PCs

1. On the first PC, turn on automatic backups to OneDrive or Google Drive.
2. On the second PC, sign in to the same OneDrive or Google Drive. In ScribeForge, click **Archive**, then **Restore from a backup folder…**, and choose the backup folder. Afterwards, click **Keep backing up** so changes made there are backed up too.
3. From then on, when you unlock the vault on either PC and the other has made a newer backup, the Archive offers it: **Restore it…** brings this PC up to date.

Use the vault on one PC at a time. If both PCs changed the vault since their last backup, ScribeForge says so before restoring: the changes on this PC are replaced, never combined.

Erasing a document for good also removes it from the backup folder, older automatic backups included. OneDrive and Google Drive may keep deleted files in their own recycle bins for a while.

## Where it's kept

In `%APPDATA%\ScribeForge\Vault` (trial mode has its own). Everything there is encrypted: the database, the search index, each stored PDF, and their titles, labels and notes. AES-256-GCM both hides the data and detects any change to it, so a damaged file is refused with a message, never used.
