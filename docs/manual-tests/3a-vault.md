# Manual test: stop 3a, the Archive's vault

About 35 minutes. Everything runs in **trial mode**, so the vault you make is a test one, in the trial data folder. `npm run trial:reset` deletes it at the end. You'll save a few files, so first make a folder for them, for example `Desktop\ScribeForge 3a test`. Delete it when you're done.

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

## Making the vault

1. Click **Archive** on the left (an archive box icon, under Sign). **"Make the vault", with two password boxes, "Also make a recovery code…" ticked, and Restore a backup….**
2. Type `short` in both boxes and click **Make the vault**. **"The password needs at least 10 characters."** Type a password you'll remember for this test (10 characters or more) in both boxes and click **Make the vault**.
3. **"Your recovery code", with a code of five groups of five letters and numbers.** Write it on paper for this test. **Done is greyed out until you tick "I've written it down somewhere safe".** Tick it and click **Done**.
4. **"0 documents, … encrypted on this PC." and "The vault is empty."**

## Adding and organising

5. Click **Add PDFs…** and choose `carries.pdf` and `normal.pdf` from `tests\fixtures\out` (hold Ctrl to choose both). **"Added 2 documents to the Archive." Both are listed with a small picture of their first page: "CARRIES-OLD-TITLE" and "ScribeForge test document".**
6. Click **CARRIES-OLD-TITLE**. **A panel shows its title, labels, note, file name, when it was added, pages and size.** Change the title to `Test contract`, the labels to `Contracts, 2026`, and type a note. Click somewhere else. **The list says "Test contract", with "2026, Contracts" under it.**
7. Set **Label** to **Contracts**. **Only Test contract is listed.** Set it back to **All labels**.

## Opening, and locking

8. Click **Test contract**, then **Open**. **The Document screen shows carries.pdf.**
9. Lock Windows with `Windows+L`, then sign back in. **ScribeForge shows the Archive: "The Archive locked, because Windows locked." The document is closed (Document is greyed out on the left), and a message says why.** _This checks a "Needs verification" from the plan (A8)._
10. Type a wrong password and click **Unlock**. **"That password didn't work. Try again."** Type the right one. **The list is back.**
11. Open a file from your folders (**Start**, **Open a PDF…**, `tests\fixtures\out\links.pdf`). Go back to **Archive** and click **Lock**. Click **Document**. **links.pdf is still open: only things opened from the vault close.**
12. Click **Settings**. **Under "Archive": "Lock the Archive after this long without using ScribeForge", set to 10 minutes.** (Optional: set 5 minutes, leave ScribeForge alone for 5 minutes, then look: **"The Archive locked itself, because ScribeForge wasn't used for a while."**)

## The recovery code and the password

13. On **Archive**, click **Use the recovery code instead** and type the code from step 3, in small letters, with spaces instead of dashes. Click **Unlock**. **It opens, and a message suggests setting a new password.**
14. Click **Change the password…**. Type a wrong current password and a new one twice. **"The current password isn't right."** Try again with the right one. **"The password was changed."** Click **Lock**, then try the old password. **It doesn't work.** The new one does.
15. Click **Make a new recovery code…**, type the password and click **Make the code**. **A new code is shown.** Write it down, tick, **Done**. Lock, then try the *old* code. **It doesn't work.** Unlock with the password.

## Saving into the Archive

16. With the vault unlocked, open `tests\fixtures\out\links.pdf` and press `Ctrl+S`. **The list before saving has "Also keep a copy in the Archive".** Tick it, click **Choose where to save…** and save in your test folder. **"Saved …" and "A copy is also in the Archive."** On **Archive**: **3 documents.**
17. Open `tests\fixtures\out\second.pdf`, then on **Archive** click **Add the open file (second.pdf)**. **4 documents.**

## Void, copies and backups

18. Click **ScribeForge test document**, then **Void…**, type a reason and click **Void it**. **It disappears.** Tick **Show voided documents**. **It's back, marked "Voided".** Click it: **"Voided on … Reason: …"**. Click **Restore**.
19. Click **Save a copy…** and save it in your test folder. Open that copy (in ScribeForge or Edge). **The same 3 pages.**
20. Click **Make a backup…** and save it in your test folder. **"Saved the backup as … .sfbackup".** Open the backup in Notepad. **Unreadable characters only: no titles, labels or text.** Close Notepad without saving.

## Erasing, history and restoring

21. Click **Test contract**, then **Erase for good…**. **A warning that it can't be undone, and that copies in backups aren't touched.** Type a reason and click **Erase it for good**, then **Erase it**. **It's gone.**
22. Click **History** (top right). **"The history is intact: … entries, each sealed to the one before it." Newest first: the erase with your reason, the backup, the copy saved, voided and restored, the codes and password, the labels, the rename, and the documents added.** None shows your note or labels. Click **Save as a text file…** and save it in your test folder.
23. Click **Restore a backup…** and choose your backup. Type a wrong password and click **Check the backup**. **"That password doesn't open this backup."** Type the password the vault had when you made the backup. **"The backup is complete and undamaged. It was made on … and holds 4 documents." and a warning that restoring replaces the vault.** Click **Replace the vault with it**. **Test contract is back.** History ends with **"The vault was restored from a backup made on …"**.

## On disk

24. Open File Explorer at `%APPDATA%\ScribeForge Trial\Vault`. **vault.json, archive.sealed and a files folder of files with random names.** Open `archive.sealed` in Notepad. **Unreadable: no titles, labels or notes.** Close Notepad without saving.
25. Close ScribeForge, then start it again with `npm run trial`. Click **Archive**. **Locked.**

## Finish

26. Close ScribeForge, delete your test folder, and delete the trial data, test vault included:
```bash
npm run trial:reset
```
