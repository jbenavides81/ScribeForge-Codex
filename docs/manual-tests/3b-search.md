# Manual test: stop 3b, searching the Archive

About 20 minutes. Everything runs in **trial mode**, with a test vault in the trial data folder. `npm run trial:reset` deletes it at the end.

Each step says what to do, then **what you should see**. If something doesn't match, note the step number and what you saw.

## Setup

A. Make the test PDFs:
```bash
npm run fixtures
```
B. Start from clean trial data (no vault):
```bash
npm run trial:reset
```
C. Start trial mode:
```bash
npm run trial
```
D. Click **Archive**, make a vault with a test password (untick the recovery code), and click **Add PDFs…**. From `tests\fixtures\out`, choose `normal.pdf`, `links.pdf`, `no-text.pdf` and `large.pdf` (hold Ctrl). **After a few seconds: "Added 4 documents to the Archive."** (large.pdf has 600 pages.)

## Searching

1. **Under the list: "Pages without text": "Scanned and typed: page 2", explaining that scans have no words to search.**
2. Type `anvil` in **Search the Archive** and press Enter. **"Found in 1 document." ScribeForge test document, "3 pages match", with Page 1, Page 2 and Page 3, each with a few words around "anvil" picked out.**
3. Search for `"third anvil"` (with the quotes). **Only Page 3, with "third anvil" picked out.** Search for `"anvil third"`. **"Nothing found…"**
4. Search for `anv*`. **The 3 pages again.** Search for `anv`. **Nothing found: a word start needs the `*`.**
5. Search for `ANVIL`. **The same 3 pages: capital letters don't matter.**
6. Search for `"page 517 of 600"`. **"large" (it has no title of its own, so its file name is used), "1 page matches", Page 517.** Click **Page 517**. **The Document screen opens large.pdf at page 517.**

## Filters and voided documents

7. Back on **Archive**, clear the search box. Click **Scanned and typed**, give it the label `Scans`, and click elsewhere. Search for `quillword`, then set **Label** to **Scans**. **Still found.** Search for `anvil`. **Nothing found: ScribeForge test document doesn't have that label.** Set **Label** back to **All labels**.
8. Clear the search, click **ScribeForge test document**, and **Void…** it with a reason. Search for `anvil`. **Nothing found.** Tick **Show voided documents**. **It's found, marked "Voided".** Untick it.
9. Set **Added** to **In the last 30 days**. **Everything is still listed (it was all added today).**

## Rebuilding, and locking

10. Click **Rebuild the search index…**, then **Rebuild it**. **"Getting documents ready for search: … of 4…" for a few seconds.** Search for `"page 517 of 600"` again. **Found, as before.**
11. Click **Lock**, unlock with the password, and search for `quillword`. **Found: the index was kept, encrypted.**
12. Open File Explorer at `%APPDATA%\ScribeForge Trial\Vault`. **A file called search.sealed.** Open it in Notepad. **Unreadable: no words from the documents.** Close Notepad without saving.

## Finish

13. Close ScribeForge, and delete the trial data, test vault included:
```bash
npm run trial:reset
```
