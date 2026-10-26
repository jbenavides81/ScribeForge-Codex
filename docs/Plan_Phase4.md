# ScribeForge: Phase 4 plan (Cathedral Network)

_2026-10-26. **Approved 2026-10-26,** with every recommendation in section 9 accepted. For question 10, no BC6 address was given, so the code of conduct is the short one of our own._

Phase 3 ended with ScribeForge 1.8.0: the Archive's encrypted vault, search, and versions with compare. Phase 4 is the last phase in the roadmap, rescoped in the outline. It has three parts:
- **Sync** (codename Cathedral Sync): encrypted Archive backups to a folder that OneDrive or Google Drive syncs, and restoring them on another PC.
- **The Guild:** how people contribute on GitHub.
- **Releases:** how a version is numbered, described, built, checked and published.

**The short version:**
- **No new packages in the app.** ScribeForge still never goes online. OneDrive or Google Drive does the uploading, from a folder on this PC.
- **Backups that only add what's new.** A 300 MB archive is copied to the synced folder once. After that, each backup adds new documents and about 1 MB of database, instead of another 300 MB.
- **Automatic.** A backup is made when the vault locks or ScribeForge closes, if anything changed. On another PC, unlocking offers the newer backup.
- **A bug to fix first.** Today's **Make a backup…** holds about four copies of the vault in memory at once: 1.1 GB for a 300 MB vault. A large vault could fail to back up. Stop 4a fixes that, keeping the same backup file.
- **Checks on GitHub.** Every pull request runs the typecheck and the tests on GitHub's Windows machines.
- **Checkable releases.** Each release comes with checksums. The app inside the installer comes out identical every time it's built, so anyone can rebuild it and compare.
- **Three stops:** synced backups (4a), contributing (4b), releases (4c).

---

## 1. Where Phase 3 left things

- **BC6 Business Manager's repo still isn't on this PC** (Phase 0 plan, question 1). The roadmap says sync works "as BC6 does". Until the repo is here, ScribeForge builds its own version, marked "to match BC6" (question 1).
- **From stop 2e, still waiting:** time stamps on signatures, checking whether certificates were cancelled, Windows' certificate store and smart cards, and certifying signatures. None of these are in Phase 4.
- **From Phase 3:** reading text in scanned pages (OCR) was left as a possible plan of its own. It isn't in Phase 4.
- **The installer isn't signed,** so Windows warns the first time it runs. Section 6 covers the options.

---

## 2. What I tested (2026-10-26)

These were small experiments; none of them are kept. Nothing was written into OneDrive: that would have uploaded test files to your account.

| # | Question | Result | What Phase 4 does |
|---|---|---|---|
| B1 | Can ScribeForge find a synced folder by itself? | **OneDrive: yes.** Windows says where your OneDrive folder is, without ScribeForge reading OneDrive's settings. **Google Drive for desktop isn't installed on this PC**, so I couldn't test it. _Needs verification: finding Google Drive's folder or drive._ | Suggests the folders it finds, or lets you choose any folder (question 4). |
| B2 | OneDrive keeps some files "online only", downloading them when they're opened. Does looking at them download them? | **No.** Listing the folder and reading a file's size left an online-only file online only. | Backups check what's already there by name and size only. They never open older backup files. |
| B3 | How does today's **Make a backup…** cope with a bigger vault? | **Fast, but memory-hungry.** A vault of 60 documents (300 MB) was backed up in 0.7 seconds, but memory rose by 1.1 GB, since the whole backup is built in memory, about four times over. | 4a writes backups bit by bit (question 7). |
| B4 | What does a backup that only adds what's new cost? | **Very little after the first time.** Copying all 60 stored files took 0.3 seconds. After that, the parts that change each time (the database, the search index and the key file) were 0.8 MB. Checking which files were already there took 13 milliseconds. | The backup folder design (section 4, question 2). |
| B5 | Do sync programs upload a file while it's still being written? | **OneDrive doesn't sync temporary files,** Microsoft says. **For Google Drive I found no official word.** _Needs verification._ | Every file is written under a temporary name first, and a backup only counts once its list of files is complete and checks out. A half-uploaded backup is never used. |
| B6 | Is the installer the same each time it's built? | **No.** Two builds of 1.8.0 a minute apart gave different installers, even slightly different sizes. **But the app inside is identical:** `app.asar` and `ScribeForge.exe` had the same checksums both times. _Needs verification: the same on a different PC._ | Releases list checksums for the installer and for the app files inside it (section 6). |
| B7 | What does building the installer make? | The installer (114 MB, in 63 to 79 seconds), plus `latest.yml` and a `.blockmap` file. Those two are for automatic updates, which ScribeForge doesn't have. | Releases leave them out (question 12). |
| B8 | Can the whole-app tests run on GitHub's Windows machines? | **Probably.** They need a Windows desktop, which GitHub's Windows machines have. The window placement works with one monitor. _Needs verification: it can only be tried once a check is on GitHub (4b)._ | GitHub checks (question 8). |
| B9 | What would it take to sign the installer? | See section 6. **SignPath Foundation** signs open-source projects for free, with conditions. **Microsoft's Artifact Signing** (formerly Trusted Signing) is paid monthly. _Needs verification: its current price, and whether individuals can use it._ | Stay unsigned for now (question 14). |

---

## 3. Dependencies

**No new packages in the app.** Backups use Node's own file and crypto functions, as the vault does.

**For the GitHub checks (4b),** two of GitHub's own building blocks run on GitHub's machines, never in the app: `actions/checkout` and `actions/setup-node` (both MIT). Each is pinned to an exact version.

**On this PC, optional:** GitHub's command-line tool `gh` (MIT), so I can publish a release and read check results when you ask (question 13). You'd install it and sign in to it yourself. I never sign in.

---

## 4. Synced backups (stop 4a)

### The backup folder

You choose a folder that OneDrive or Google Drive syncs, or any folder, a USB drive included. ScribeForge makes a folder called `ScribeForge Archive backup` in it, holding:
- `files\`: one encrypted file for each stored PDF version. These are the same encrypted files the vault keeps, under the same random names. Each is copied once and never changed.
- One small backup file for each backup made, named by its date and time. It holds the encrypted database, search index and key file, plus the list of stored files it needs, each with its checksum. The whole backup file is sealed with the vault's key, as `.sfbackup` files are.
- `README.txt`: a few lines saying what the folder is, not to change it, and how to restore it. Nothing about you or your documents.

The vault itself stays in ScribeForge's data folder, as in Phase 3. Only the backups go to the synced folder (a vault kept in a synced folder could be damaged by syncing).

### When a backup is made

- **Automatically,** when the vault locks (any reason) and when ScribeForge closes, if anything changed since the last backup.
- **With Back up now,** whenever you like.
- **The 10 newest backups are kept** (changeable). These are small. Stored files that no kept backup needs any more are removed from the folder.
- **Never in your way.** If the folder isn't there (OneDrive signed out, the USB drive unplugged), locking still happens at once. The Archive says when the last backup was made, and why the last one failed.

**Make a backup…** stays as it is: one `.sfbackup` file, for a USB drive or anywhere else. It just stops using so much memory (B3).

### Restoring, and moving between PCs

- **Restore a backup…** accepts a backup folder as well as a `.sfbackup` file. ScribeForge uses the newest complete backup in the folder. It asks for the password (or recovery code), checks every part, says when the backup was made and how many documents it holds, and asks before replacing the vault.
- **On a PC with no vault yet,** the same, from the Archive screen. It then offers to keep backing up to that folder.
- **On a PC whose vault is older than the folder's newest backup:** unlocking says "There's a newer backup, made on another PC on …" and offers to restore it.
- **Still arriving:** if a backup's files haven't all synced yet, ScribeForge says so and offers the newest complete one, or waiting. It never restores half a backup.
- **One PC at a time.** Two vaults changed on two PCs can't be merged. If both changed, ScribeForge warns before anything is replaced (question 5).

### What can be seen in the synced folder

Someone who could open your OneDrive or Google Drive could see:
- how many stored files there are and their sizes;
- when backups were made.

They couldn't see titles, labels, notes, file names, words or pages: everything else is encrypted, as in the vault. The tests search the folder for all of these.

### Erase for good

Erasing a document also removes it from the backup folder: its files, and the older automatic backups that still held it. A new backup is made straight away (question 6). Two limits:
- OneDrive and Google Drive keep deleted files in their own recycle bins for a while (usually 30 days). _Needs verification: each one's current rule._
- `.sfbackup` files saved elsewhere aren't touched. The warning already says so.

---

## 5. Contributing: the Guild (stop 4b)

This stop changes GitHub files and documents, not the app.

- **Issue forms:**
  - **Report a problem:** what happened, the steps, the ScribeForge version (from About) and the Windows version. It asks people never to attach private PDFs, and to describe the file or make a test one instead.
  - **Suggest an idea.**
  - Blank issues are turned off, and a link points security problems to the private route.
- **Pull request checklist:**
  - which issue or plan it belongs to;
  - tests added;
  - manual test script, help and README updated where needed;
  - no new packages without approval;
  - no personal data or real documents.
- **CONTRIBUTING.md** gains the review rules:
  - one topic per pull request;
  - the checks must pass;
  - you review and merge every change;
  - features need a plan first (as for every stop);
  - codename tags are welcome in commit messages but never in the app.
- **SECURITY.md:** how to report a security problem privately, using GitHub's private reporting. No email address goes in the repo unless you choose one.
- **Code of conduct:** see question 10.
- **GitHub checks** (`.github/workflows/checks.yml`):
  - **On every pull request and every push to main,** on GitHub's Windows machines: install from the lock file, typecheck, unit tests, then whole-app tests on the development build. Those include the zero-network check.
  - **Before a release,** on request: the same on the packaged app.
  - **Run safely:** pull requests from other people's copies of the repo run with read-only access and no secrets.
- **Settings only you can change on GitHub:** a short checklist in the stop's report (question 9). I don't change account or repo settings.

---

## 6. Releases (stop 4c)

### Version numbers

From now on, the three numbers mean (question 11):
- **Last number** (1.9.**1**): fixes only.
- **Middle number** (1.**10**.0): new features. Everything made by older versions still opens.
- **First number** (**2**.0.0): something made by an older version (a vault, a backup, a setting) can't be used any more, or a feature is removed.

### What each release has

- **The installer,** `ScribeForge Setup 1.10.0.exe`.
- **A checksum file,** `ScribeForge 1.10.0 SHA256SUMS.txt`. It lists SHA-256 checksums for:
  - the installer, so you can check a download is the one published;
  - `app.asar` and `ScribeForge.exe` as installed. These come out the same on every build (B6), so anyone can rebuild from the source and compare.
- **Release notes in plain words,** taken from a new `CHANGELOG.md`. It has one section per version, filled in back to 0.1.0 from each stop's commit message (question 16).
- **Nothing else.** No update files (B7), since ScribeForge never checks for updates.

### How a release is made

`npm run release` (a new script) does everything except publishing:
1. Refuses if:
   - there are uncommitted changes;
   - it isn't on main;
   - the version is already released;
   - `CHANGELOG.md` has no section for it;
   - the third-party notices are out of date.
2. Runs the typecheck, the unit tests and the whole-app tests on the development build and the packaged app.
3. Builds the installer and writes the checksum file and the release notes into `release\`.

Publishing (a tag such as `v1.10.0` and a GitHub release) happens only when you ask (question 13).

### In the app

- **About** gains a link to the releases page, which opens in your browser. ScribeForge still never checks for a new version itself.
- **A new help page, Getting ScribeForge:** where releases are, why Windows warns about an unsigned installer, and how to check a download's checksum in PowerShell (`Get-FileHash`).

### Signing the installer

| Option | Windows' warning | Cost | Catches |
|---|---|---|---|
| Stay unsigned (today) | "Windows protected your PC" the first time | Nothing | The README and help explain it |
| SignPath Foundation | Goes away as the certificate earns trust | Free | It needs an approved open-source licence (Apache-2.0 is), a project already released, an automated build on GitHub, and a published signing policy. The publisher shown is "SignPath Foundation", not BC6. |
| Microsoft Artifact Signing | Goes away as it earns trust | A monthly fee. _Needs verification: the price._ | It checks your identity first. For an individual, the name shown is likely your own legal name. _Needs verification._ |
| Buying a certificate | Same | Usually a few hundred dollars a year | Identity checks, and the key needs special hardware |

**I recommend staying unsigned for now** (question 14). After the first release, with the GitHub checks running, SignPath could get its own plan.

---

## 7. The stops

### Stop 4a: synced backups (version 1.9.0)

**What it adds:**
- **Automatic backups,** in the Archive under "Keeping the vault safe":
  - choose OneDrive (when found), Google Drive (when found) or any folder;
  - the last backup's time, **Back up now**, and how many to keep.
- **Restore** from a backup folder or a `.sfbackup` file, on this PC or another, and the offer of a newer backup when unlocking.
- **Erase for good** reaches the backup folder.
- **Make a backup…** and **Restore a backup…** work bit by bit, so a large vault no longer needs memory several times its size. The backup file stays the same, so 1.6 to 1.8 backups still restore.
- Help, README and a manual test script. The script includes a real OneDrive round trip with two PCs, or a second Windows account.

**Required checks:**
- **Restores exactly:** a backup folder restores the vault exactly. Every version opens with its original checksum.
- **Little memory:** backing up and restoring a 300 MB vault uses under 100 MB of extra memory.
- **Only what's new:** a second backup with nothing new adds only the small backup file. A new document adds only its own files.
- **Never half a backup:** a backup with a missing or half-written file is never used. The newest complete one is offered instead.
- **Damage is refused:** a changed byte in any file of the folder is refused with a plain message.
- **Nothing readable:** the folder holds no titles, labels, notes, file names or words from the documents.
- **Never in the way:** locking with the folder missing still locks at once, and the Archive says the backup failed.
- **Never opens older backups:** existing backup files are never opened when a new backup is made (B2).
- **Old backups still work:** `.sfbackup` files from 1.6, 1.7 and 1.8 restore.
- **Erase reaches the folder:** after **Erase for good**, nothing of the document is left in the backup folder.

### Stop 4b: contributing (no new app version)

**What it adds:** everything in section 5.

**Required checks:**
- **On GitHub, passing:** after you approve pushing the workflow, the GitHub checks run and pass on a pull request.
- **Network check included:** the GitHub checks include the zero-network check.
- **Forms work:** the issue forms and the pull request checklist show on GitHub. A short manual script opens each one.
- **Accurate guide:** every command in CONTRIBUTING.md exists, and every link in it leads somewhere (a test).

### Stop 4c: releases (version 1.10.0)

**What it adds:** everything in section 6 except publishing. Publishing happens when you ask.

**Required checks:**
- **Refuses what it should:** the release script refuses uncommitted changes, an existing version, a missing changelog section and out-of-date notices.
- **Checksums match:** the checksums in the checksum file match the files.
- **Same app every build:** two builds give the same `app.asar` and `ScribeForge.exe` (B6).
- **Only the release files:** the installer, the checksum file and the notes. No update files.
- **Nothing personal:** the release notes and checksum file contain no personal names or paths.

### Every stop

Every stop ends as before: the build prompt's section 6 checks, screenshots in every theme for anything you can see, a manual test script, help pages, and the README.

---

## 8. Not in Phase 4

- **Live sync,** or two PCs changing one vault at the same time. Phase 4 moves the whole vault between PCs, one at a time.
- **ScribeForge going online** in any way: no update checks, no cloud accounts, no sign-in. The sync program on your PC does the uploading.
- **Backups of settings or the recent-files list.**
- **Signing the installer** (question 14).
- **OCR, and the signing items left from 2e** (section 1).

---

## 9. Questions for you

1. **BC6.** BC6 Business Manager's repo still isn't here. Build synced backups ScribeForge's own way, marked "to match BC6"?
   _I recommend yes._
2. **Backup folder.** A folder that adds only what's new, rather than a whole `.sfbackup` file each time?
   _I recommend the folder (B3, B4). A 300 MB archive backed up 10 times as whole files would fill 3 GB of cloud space, and upload 300 MB each time._
3. **When.** Automatically when the vault locks and when ScribeForge closes, if anything changed, plus **Back up now**, keeping the 10 newest?
   _I recommend yes._
4. **Which folder.** Suggest OneDrive and Google Drive when found, or let you choose any folder (a USB drive works too)?
   _I recommend yes._
5. **Another PC.** On unlocking, offer a newer backup made on another PC; one PC at a time, with a warning if both changed, and no merging?
   _I recommend yes._
6. **Erase for good and backups.** Also remove an erased document from the backup folder, older automatic backups included?
   _I recommend yes. Otherwise "erase" would leave a copy in the cloud._
7. **The memory fix.** Make **Make a backup…** and **Restore a backup…** work bit by bit, keeping the same file?
   _I recommend yes. It's a fix for 3a (B3)._
8. **GitHub checks.** Typecheck, unit tests and whole-app tests on every pull request and push, on GitHub's Windows machines; the packaged-app tests before a release?
   _I recommend yes. GitHub doesn't charge for this on public repos._
9. **GitHub settings,** which you'd change yourself:
   - turn on private vulnerability reporting;
   - turn on Dependabot's security alerts, but not its automatic package-update pull requests (packages need your approval);
   - protect main so other people's changes need a pull request with passing checks and your review, while you can still push directly.

   _I recommend all three._
10. **Code of conduct.** Contributor Covenant 2.1 (well known, and shown in GitHub's community checklist; its text is shared under CC BY 4.0, credited at the bottom), with a BC6 address you choose for reports? If you'd rather not put an address in the repo: a short code of our own, pointing to GitHub's report button.
    _I recommend the Covenant if you have a BC6 address for it; otherwise the short one._
11. **Version numbers.** The rules in section 6, with 4a as 1.9.0, no new version for 4b, and 4c as 1.10.0?
    _I recommend yes._
12. **Release files.** The installer, a checksum file (installer plus the app files inside) and plain notes; no update files; a tag only for versions actually published?
    _I recommend yes._
13. **Publishing.** Install GitHub's command-line tool (`gh`) and sign in to it yourself, so I can publish a release when you ask? Without it, the script prepares everything and you publish on github.com.
    _I recommend installing it. It also lets me read the GitHub check results._
14. **Signing.** Stay unsigned in Phase 4, with SignPath Foundation (free) as a possible plan after the first release?
    _I recommend yes._
15. **First public release.** Publish 1.10.0 on GitHub after 4c, when you say so?
    _I recommend yes, when you're ready. Nothing is published until you ask._
16. **Changelog.** Fill in `CHANGELOG.md` back to 0.1.0 from each stop's commit message?
    _I recommend yes._

~~Answer by number, or say "go" to accept every recommendation.~~ Approved 2026-10-26, with every recommendation accepted. Stop 4a is next.
