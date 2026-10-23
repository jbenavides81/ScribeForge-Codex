# ScribeForge: Phase 3 plan (the Archive)

_2026-10-23. **Approved 2026-10-23,** with every recommendation in section 9 accepted, including Erase for good (question 6). (Keeping the vault on a USB drive was considered and set aside.)_

Phase 2 ended with ScribeForge 1.5.0: the command line, the full set of annotations, advanced redaction, clean-up and signing. Phase 3 adds the Archive from the roadmap: an encrypted vault for your PDFs (codenames Niko's Archive and Beloved Codex), search, and versions with compare (Runes of Revision). The roadmap also asks this plan to decide on AI.

**The short version:**
- **No new packages.** Electron already includes SQLite, with full-text search, and Node's own encryption. I tested both inside ScribeForge's Electron.
- **Fast enough for a big archive.** 2,000 documents (6,000 pages) were indexed in half a second, saved encrypted in 48 milliseconds, and searched in under a millisecond.
- **Nothing readable on disk.** The database lives in memory while the vault is unlocked, and is saved as one encrypted file. Each PDF is stored encrypted too. A word that was plainly in the database was nowhere in the encrypted file.
- **Locked unless you're using it.** It locks when ScribeForge starts, after a few minutes unused, and when Windows locks or the PC sleeps. It needs your password, or a recovery code if you made one.
- **Three stops:** the vault (3a), search (3b), and versions and compare (3c).
- **AI:** I recommend none in Phase 3. The one on-device feature worth having is reading text in scanned pages (OCR), and it could get its own plan after search.
- **One question changes an approved rule:** whether a document can be erased for good, rather than only voided (question 6).

---

## 1. Where Phase 2 left things

- **BC6 Business Manager's repo still isn't on this PC** (Phase 0 plan, question 1). The vault is meant to work like BC6's data: password, recovery code, locking, encrypted backups, voiding and history. Until the repo is here, ScribeForge builds its own versions, marked "to match BC6" (question 1).
- **From stop 2e, still waiting:** time stamps, checking whether certificates were cancelled, Windows' certificate store and smart cards, and certifying signatures. None of these are in Phase 3.
- Everything else from Phase 2 is done.

---

## 2. What I tested (2026-10-23)

These were small experiments in a scratch folder; none of them are kept. They used ScribeForge's own Electron 44.7.2, which has Node 24.21 inside it.

| # | Question | Result | What Phase 3 does |
|---|---|---|---|
| A1 | Does Electron have a database ScribeForge can use without a new package? | **Yes.** Node's own SQLite (`node:sqlite`, SQLite 3.53.4) is in ScribeForge's Electron, with full-text search (FTS5). It can save the whole database into memory and load it back (`serialize` and `deserialize`). It printed no "experimental" warning. _Needs verification: what Node's documentation says about its stability in version 24._ | The vault's database (question 2). |
| A2 | Can the database be kept encrypted at rest? | **Yes.** The database lives in memory and is saved as one encrypted file (AES-256-GCM). A test word was in the database before encrypting, and nowhere in the encrypted file. A wrong key was refused. | How the vault is stored (section 4). |
| A3 | Is it fast enough for a typical archive? | **Yes.** 2,000 documents of 3 pages (2.4 million words) were indexed in 0.5 seconds. The database was 37 MB and was saved, encrypted, in 48 milliseconds. A common word was found in under a millisecond. | |
| A4 | And a very large one? | **Fast, but memory-hungry.** 5,000 documents of 5 pages (25 million words) were indexed in 2.5 seconds, into a 223 MB database. It was saved in 0.4 seconds and loaded again in 0.25 seconds. A rare word was found instantly, and a common phrase was counted in 14 milliseconds. But the whole database sits in memory: this test used 1.7 GB. | The search index is kept in its own file, which can be rebuilt. Section 4 gives the size ScribeForge is built for. |
| A5 | How should the password protect the key? | **Argon2 isn't available in Electron** (its encryption library leaves it out). **scrypt is**, and takes 0.45 seconds with strong settings (N = 2^17). | scrypt. |
| A6 | Is encrypting the PDFs themselves fast? | **Yes.** 50 MB was encrypted and decrypted again in 0.1 seconds (AES-256-GCM). | Each stored PDF is encrypted. |
| A7 | What on-device AI is there? | **Reading scanned pages (OCR):** tesseract.js 7.0 (Apache-2.0) with English is about 45 MB. As it comes, it downloads its language data from the internet, so it would have to be set up to use a bundled copy. **Search by meaning** (transformers.js, Apache-2.0) needs models of 20 to 100 MB or more. A local model for summaries needs gigabytes. | Section 7 and question 9. |
| A8 | Can ScribeForge tell when Windows locks or the PC sleeps? | **Electron reports both** (its `powerMonitor` signals `lock-screen` and `suspend`). I didn't lock this PC to test it. The whole-app tests can send the same signals. _Needs verification: the manual script locks Windows for real._ | Locking (section 4). |

---

## 3. Dependencies

**No new packages for Phase 3.**
- **The database:** Electron's own SQLite (A1).
- **Encryption:** Node's own crypto (A2, A5, A6).
- **Text comparison:** for "what changed between two versions", ScribeForge compares the words itself, page by page. That's about 100 lines, tested; it doesn't need a package (question 10).

If you choose OCR later (question 9), it gets its own plan, with its packages listed for your approval.

---

## 4. How the vault works

### Where it is, and what's in it

There's one vault, in ScribeForge's data folder: `%APPDATA%\ScribeForge\Vault`. Trial mode has its own (question 3). It holds:
- `vault.json`: how the key is protected (the scrypt settings and the locked copies of the key). Nothing in it is readable as your data.
- `archive.sealed`: the database (documents, versions, labels, notes and the history), encrypted.
- `search.sealed`: the search index, encrypted. If it's ever lost or damaged, ScribeForge rebuilds it from the documents.
- `files\`: one encrypted file per stored PDF, with a random name. The names say nothing about what's inside.

How it's kept safe:
- **One encryption method for everything.** AES-256-GCM both hides the data and detects any change to it. A damaged or altered file is refused with a plain message, never used.
- **Safe saving.** Everything is written to a temporary file first and then put in place, as settings already are. A crash never leaves half a file.
- **Nothing decrypted touches the disk.** Opening a document from the vault decrypts it into memory only, as opening any PDF already works.
- **A size to aim for.** It's built for up to about 10,000 documents (50,000 pages). Beyond that it still works, but uses more memory (A4). The vault screen shows how big the vault is.

### The password and the recovery code

- **A random key** (the vault key) encrypts everything. Your password unlocks that key. Changing the password re-protects the key; nothing else has to be re-encrypted.
- **The password** needs at least 10 characters (question 4).
- **The recovery code is optional.** It's offered when the vault is made, and can be made or replaced later. It's 25 letters and numbers in five groups, shown once, and it also unlocks the key.
- **If you lose both,** the vault can't be opened, by anyone, ScribeForge included. The app says so plainly when you make the vault.
- **The password and the code are never saved.** The key stays in memory only while the vault is unlocked.

### Locking

The vault locks:
- when ScribeForge starts;
- after a time without using ScribeForge (10 minutes by default; 5, 15, 30 or 60 in Settings);
- when Windows locks, and when the PC goes to sleep;
- with a **Lock** button.

When it locks, the key and the database are cleared from memory. Any document opened from the vault closes, because it's decrypted (question 5).

Only the Archive locks: the PDF tools keep working on files from disk.

### Void, rather than delete

- **Void:** a document is voided with a reason, never deleted, as the approved outline says. A voided document disappears from the list and from search, but stays in the vault. The **Voided** filter shows it, and **Restore** brings it back. Both are recorded in the history.
- **Erase:** question 6 asks whether you also want **Erase for good**, for a document that should never have been stored.

### History

- **What's recorded:** every change, with its date and time:
  - the vault being made;
  - documents added, new versions, renaming, labels and notes;
  - documents voided (with the reason) and restored;
  - copies saved out;
  - backups made and restored;
  - the password changed, and the recovery code made or used.
- **Each entry is sealed to the one before it** with the vault key. A changed, missing or reordered entry is detected, and the History screen says so.
- **It can't be edited.** It can be saved as a text file.

### Backups

- **Make a backup…** saves one encrypted file wherever you choose, such as `2026-10-23 ScribeForge vault.sfbackup`. The password and recovery code that worked when it was made also open it.
- **Restore a backup…** checks every part of the backup first, then replaces the vault, after asking.
- Automatic backups to a folder that OneDrive or Google Drive syncs are **Phase 4**, as the roadmap says.

---

## 5. The stops

### Stop 3a: the vault (version 1.6.0)

**What it adds:**
- **An Archive screen** on the left.
- **Making and opening the vault:**
  - make the vault: a password, and a recovery code if you want one;
  - unlock it with the password or the recovery code;
  - lock it, change the password, and make or replace the recovery code.
- **Putting PDFs in:**
  - **Add PDFs…** from a folder;
  - **Add to the archive** for the open file;
  - when saving a new file, an **Also keep a copy in the archive** choice (question 11).
- **The list:**
  - each document's title, labels, date added and pages, with a small picture of its first page (also stored encrypted);
  - sorting, and filtering by label.
- **Opening a document:**
  - opens a copy in memory: view it, and use every tool on it;
  - saving still makes a new file, on disk, or in the archive with the choice above.
- **Looking after documents:**
  - rename one, give it labels and a note;
  - **Save a copy…** out of the vault;
  - **Void** (with a reason) and **Restore**.
- **History**, **Make a backup…** and **Restore a backup…**.

**Required checks:**
- **Nothing in the vault folder is readable.** A test searches every file in it for each test document's text, title, file name, labels and note, and must find none.
- **The password and the code:**
  - a wrong password and a wrong code are refused;
  - the recovery code opens the vault;
  - after a password change, only the new password works.
- **Locking:**
  - the vault locks when ScribeForge starts, after the idle time, when Windows locks and when the PC sleeps (tests send those signals);
  - once locked, every request to the vault is refused;
  - a document from the vault that was open is closed.
- **Damage is refused, never used:**
  - one changed byte in any vault file gives a plain message, never a crash;
  - a backup restores the vault exactly.
- **The history:** a changed, removed or reordered entry is detected.
- **Voiding:**
  - a voided document is hidden from the list and from search, but still in the vault;
  - Restore brings it back.
- **Nothing decrypted is written anywhere:** the temp folder and the data folder are searched too.
- **No network requests**, as every stop. Every whole-app test also runs on the installed build.

### Stop 3b: search (version 1.7.0)

**What it adds:**
- **Indexing:** each page's text is read when a document is added, with pdf.js in the sandboxed window, as Find does today. It goes into the search index.
- **Search:** a search box on the Archive screen, which takes:
  - words;
  - "exact phrases";
  - the start of a word, such as `insur*`.
- **Results:** listed by document, with page numbers and the matching words picked out. Clicking a result opens that page.
- **Filters:** labels, dates added, and voided documents (left out unless asked for).
- **Pages with no text:** pages that are only pictures (scans) are counted and listed, because search can't find words in them.
- **Rebuild the index**, for if it's ever damaged or lost.

**Required checks:**
- Words, phrases and word starts find exactly the test pages they should, and no others.
- Search speed: 1,000 test documents are searched in under 200 milliseconds.
- A 100-page PDF is indexed in under 10 seconds.
- Voided documents aren't found unless asked for.
- After rebuilding, the same searches give the same results.
- The search index, like everything else, is never readable on disk.

### Stop 3c: versions and compare (version 1.8.0)

**What it adds:**
- **New versions:** add a new version of a document, from a file, from the open file, or when saving from ScribeForge (**Save as a new version of …**).
- **Version list:** each document's versions, with dates and notes. Any version can be opened.
- **Compare two versions:**
  - side by side, page by page, with the differences on each page highlighted;
  - the text differences listed for each page, as words added and words removed;
  - identical pages say so;
  - pages added or removed are shown as such.

**Required checks:**
- **Each kind of change is found and shown on the right page:**
  - a changed word;
  - a moved block of text;
  - a picture changed;
  - a page added;
  - a page removed.
- Two identical versions are reported as identical.
- Each version opens exactly as it was stored: its checksum is the same as the file that was added.

### Every stop

Every stop ends as Phase 2's did: the build prompt's section 6 checks, screenshots in every theme, a manual test script, help pages, and the README.

---

## 6. Versions

Each stop adds 0.1: **1.6.0** (3a), **1.7.0** (3b) and **1.8.0** (3c). Nothing in Phase 3 breaks what earlier versions do (question 8).

---

## 7. AI

The roadmap asks this plan to decide on AI. Any AI would run on this PC only, never as an online service. ScribeForge never goes online.

| Option | What it would do | Cost |
|---|---|---|
| None | Nothing changes | Nothing |
| Reading scanned pages (OCR) | Makes scans searchable, and their text selectable | About 45 MB for English, and seconds per page. Needs setting up so it never downloads anything (A7). |
| Search by meaning | Finds "car insurance" when the page says "vehicle policy" | 20 to 100 MB or more, slower indexing, and results that are harder to predict |
| Summaries and questions | Answers questions about a document | Gigabytes, slow on most PCs, and it can make things up |

**I recommend no AI in Phase 3** (question 9). Of these, reading scanned pages is the one that's clearly useful: it fills the one gap search has. It could get its own plan (`docs/Plan_OCR.md`) after stop 3b, if you want it.

---

## 8. Not in Phase 3

- **Sync and automatic backups** to a synced folder: Phase 4.
- **More than one vault**, and sharing a vault.
- **File types other than PDF.**
- **The vault on the command line.**
- **Unlocking with Windows Hello**, or remembering the password.

---

## 9. Questions for you

1. **BC6.** BC6 Business Manager's repo still isn't on this PC. Build the vault's password, recovery code, locking, backups and history ScribeForge's own way, marked "to match BC6", and line them up when the repo is here?
   _I recommend yes._
2. **Storage.** Electron's own SQLite, kept in memory while unlocked and saved encrypted, with no new packages?
   _I recommend yes (A1 to A4)._
3. **Where the vault lives.** One vault, in ScribeForge's data folder (trial mode has its own)?
   _I recommend yes. Keeping it in a synced folder could damage it; Phase 4 adds backups to one instead._
4. **Password and recovery code.** A password of at least 10 characters, and an optional recovery code, offered when the vault is made?
   _I recommend yes._
5. **Locking.**
   - It locks when ScribeForge starts, after 10 minutes unused (changeable), when Windows locks, when the PC sleeps, and with a Lock button.
   - Documents opened from the vault close when it locks, and unsaved changes to them are lost.

   _I recommend yes. Leaving a decrypted document open would undo the lock._
6. **Void, or also erase?** The approved outline says documents are voided, never deleted.
   - For a document archive, I suggest also **Erase for good**, for a document stored by mistake, such as one with someone else's private details.
   - It would come after a strong warning, ask for a reason, and record the document's name and the reason in the history (never its contents).
   - It can't reach copies already in backups, and the warning says so.

   _I recommend adding it, but it changes an approved rule, so it's your call. Say "void only" to keep the rule as it is._
7. **What a document has.** A title, the file name, the date added, the number of pages, labels (several per document) and a note?
   _I recommend yes._
8. **Stops and versions.** 3a (the vault, 1.6.0), 3b (search, 1.7.0) and 3c (versions and compare, 1.8.0)?
   _I recommend yes._
9. **AI.** None in Phase 3, with reading scanned pages (OCR) as a possible plan of its own after 3b?
   _I recommend yes._
10. **Comparing versions.** Pictures and text, page by page, with ScribeForge's own word comparison rather than a new package?
    _I recommend yes._
11. **Saving into the archive.** When the vault is unlocked, the save summary offers "Also keep a copy in the archive" (3a), and later "Save as a new version of …" (3c)?
    _I recommend yes._

~~Answer by number, or say "go" to accept every recommendation.~~ Approved 2026-10-23, with every recommendation accepted. Stop 3a is next.
