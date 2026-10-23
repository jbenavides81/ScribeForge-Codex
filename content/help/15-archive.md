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
- When you save a new file, tick **Also keep a copy in the Archive** in the list shown before saving (while the vault is unlocked).

Each document's title comes from the PDF's own title, or its file name. Click a document to change its title, give it labels (separated with commas) and write a note. **Label** and **Order** above the list help you find things.

## Using a document

- **Open** (or double-click it) opens a copy in ScribeForge, decrypted in memory only. You can use every tool on it; saving makes a new file, as always.
- **Save a copy…** saves a copy out of the vault, where you choose. That copy isn't encrypted.

## Void, or erase for good

- **Void…** hides a document, but keeps it in the vault, with your reason. Tick **Show voided documents** to see it again, and **Restore** to bring it back.
- **Erase for good…** removes a document and everything about it from the vault. It can't be undone. Only its title and your reason stay, in the history. Copies already in backups aren't touched: restoring one of those brings the document back.

## History

**History** lists every change: documents added, renamed, labelled, voided, restored and erased, copies saved out, backups, and password and recovery code changes. It never holds a document's contents, labels or notes.

Each entry is sealed to the one before it, so a change made to the history outside ScribeForge (an entry altered, removed or moved) is found and shown. ScribeForge itself never changes or removes an entry. The seal uses the vault's key: someone with your password and programming tools could rebuild the whole history, but nobody else can change it unnoticed. **Save as a text file…** saves the list.

## Backups

- **Make a backup…** saves the whole vault as one encrypted file (`.sfbackup`). Keep it somewhere other than this PC, such as a USB drive. The vault's password when you made it (or the recovery code) opens it.
- **Restore a backup…** asks for that password or code, checks every part of the backup, says when it was made and how many documents it holds, and asks before replacing the vault on this PC. Anything added or changed since the backup was made is lost.

You can also restore a backup on a PC with no vault yet, from the Archive screen.

## Where it's kept

In `%APPDATA%\ScribeForge\Vault` (trial mode has its own). Everything there is encrypted: the database, each stored PDF, and their titles, labels and notes. AES-256-GCM both hides the data and detects any change to it, so a damaged file is refused with a message, never used.
