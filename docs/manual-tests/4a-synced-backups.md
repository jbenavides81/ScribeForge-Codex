# Manual test: stop 4a, synced backups

About 30 minutes, plus 10 optional minutes with OneDrive. Everything runs in **trial mode**. Two trial data folders stand in for two PCs: `npm run trial` is the first PC, and `npm run trial:second-pc` is the second. `npm run trial:reset` deletes both at the end.

The main part uses a test folder in Documents, so nothing is uploaded. The optional part at the end uses your real OneDrive.

Each step says what to do, then **what you should see**. If something doesn't match, note the step number and what you saw.

## Setup

A. Make the test PDFs:
```bash
npm run fixtures
```
B. Start from clean trial data (no vault on either "PC"):
```bash
npm run trial:reset
```
C. In File Explorer, make a folder called `Backup test` in your **Documents** folder.

D. Start the first PC:
```bash
npm run trial
```
E. Click **Archive**, make a vault with a test password (untick the recovery code), and click **Add PDFs…**. From `tests\fixtures\out`, add `normal.pdf` and `links.pdf`. **"Added 2 documents to the Archive."**

## Turning on automatic backups

1. Scroll to **Keeping the vault safe**. **Under "Automatic backups": "Off. ScribeForge can keep encrypted backups in a folder that OneDrive or Google Drive syncs…"**
2. Click **Turn on automatic backups…**. **"Keep backups in" lists OneDrive, with its folder, if OneDrive is on this PC (and Google Drive, if it is).** Click **Choose another folder…** and choose **Documents\Backup test**. **It's added to the list and chosen.** Click **Turn on**.
3. **"Automatic backups are on. The first backup is in the backup folder." The status says "Last backup:" with the time, and "In C:\…\Documents\Backup test\ScribeForge Archive backup".**
4. In File Explorer, open **Documents\Backup test\ScribeForge Archive backup**. **README.txt, a `backups` folder with 1 file, and a `files` folder with 2 files.** Open README.txt in Notepad: **a few lines saying what the folder is and how to restore it.** Open the file in `backups` in Notepad. **Unreadable: no titles or words from the documents.** Close Notepad without saving.

## Backups only when something changed

5. In ScribeForge, click **Lock**, then unlock. In File Explorer, refresh. **Still 1 backup: nothing had changed.**
6. Add `carries.pdf`, then click **Lock**. Refresh File Explorer. **2 backups, and 3 files: only the new document was copied.** Unlock.
7. Click **Back up now**. **The status shows "Backing up…" briefly, then a new time. 3 backups.** Set **Backups to keep** to **5**.
8. Add `no-text.pdf`, then close ScribeForge with the window's **X**. Refresh File Explorer. **4 backups: closing made one.**

## Restoring on "another PC"

9. Start the second PC:
```bash
npm run trial:second-pc
```
10. Click **Archive**. **The "Make the vault" screen: this PC has no vault.** Click **Restore from a backup folder…** and choose **Documents\Backup test** (the folder the backup folder is in). **"Restore a backup": "The newest complete backup in the backup folder".**
11. Type the password and click **Check the backup**. **"The backup is complete. It was made on … and holds 4 documents. Each stored file is checked as it's restored."** Click **Restore it**.
12. **"The vault was restored from the backup: 4 documents." Then "Keep backing up to this folder?"** Click **Keep backing up**. **The status shows the time of the backup it was restored from.** Refresh File Explorer: **still 4 backups (nothing new yet).**
13. Add `version-1.pdf`, then close ScribeForge. **A 5th backup appears in the folder.**

## The first PC is offered the newer backup

14. Start the first PC again (`npm run trial`), click **Archive** and unlock. **A notice: "There's a newer backup of this vault in the backup folder, made on another PC on …", with Restore it… and Not now.** Click **Not now**. **It goes.**
15. Lock and unlock again. **The notice is back.** Click **Restore it…**, type the password, **Check the backup** (**5 documents**), then **Replace the vault with it**. **"The vault was restored from the backup: 5 documents." The notice is gone, and Tenancy agreement is in the list.**

## Erasing for good

16. Click **Scanned and typed**, then **Erase for good…**. **The warning says "It's removed from automatic backups too."** Give a reason, and confirm twice. **"“Scanned and typed” was erased from the vault and from the backup folder."** Refresh File Explorer. **One file fewer in `files`, and fewer backups: those that held it are gone, and a new one was made.**

## A folder that has gone

17. Close ScribeForge. In File Explorer, rename **Documents\Backup test** to `Backup test moved`. Start the first PC, unlock, add `second.pdf`, and click **Lock**. **It locks at once.** Unlock. **The status, in red: "The last backup didn't work. The backup folder isn't there…"**
18. Close ScribeForge, rename the folder back to `Backup test`, start it again and unlock. Click **Back up now**. **A new time, and no error.**

## Optional: your real OneDrive (about 10 minutes)

This uploads the test vault's encrypted backups to your OneDrive. They hold only the test PDFs. Skip it if OneDrive isn't on this PC.

19. Click **Change the folder…**, choose **OneDrive**, and click **Turn on**. **"Automatic backups are on." The status says "In OneDrive: …\OneDrive\ScribeForge Archive backup".** In File Explorer, OneDrive shows the new folder syncing, then synced (a green tick or cloud).
20. If you have another PC with the same OneDrive, wait for it to sync, then on that PC install ScribeForge 1.9.0 (or use trial mode from the repo), and repeat steps 10 to 12, choosing the OneDrive folder. **The same 4 documents.** _Needs verification: this is the first test with OneDrive between two PCs._
21. Click **Turn off**. **"Off."** In File Explorer, delete the **ScribeForge Archive backup** folder from OneDrive.

## Finish

22. Close ScribeForge, delete both trial data folders, and delete **Documents\Backup test**:
```bash
npm run trial:reset
```
