# Manual test: stop 2a, the command line

About 30 minutes. It uses the installed-app build in `release\win-unpacked` (nothing is installed), and the made-up test PDFs. The automatic tests already ran every command through a pipe; this script checks what they can't: an ordinary Command Prompt window, PowerShell, the password window on your screen, and the files opened in the app.

Each step says what to type or do, then **what you should see**. If something doesn't match, note the step number and what you saw.

## Setup

In a terminal in the ScribeForge folder:

A. Make the test PDFs:
```bash
npm run fixtures
```
B. Build the installed-app version. This puts `scribeforge.cmd` next to `ScribeForge.exe` in `release\win-unpacked`:
```bash
npm run pack
```
C. Make a test folder on your desktop with copies of the test PDFs:
```bash
mkdir "%USERPROFILE%\Desktop\ScribeForge CLI test"
```
```bash
copy tests\fixtures\out\*.pdf "%USERPROFILE%\Desktop\ScribeForge CLI test"
```

## Command Prompt

1. Open an ordinary **Command Prompt** window: Start menu, type `cmd`, press Enter. Not Windows Terminal's PowerShell tab, and not the terminal in an editor.
2. Go to the ScribeForge folder (type `cd /d ` and the folder you cloned it into), remember where the launcher is, then go to the test folder:
```bash
set SF=%CD%\release\win-unpacked\scribeforge.cmd
```
```bash
cd /d "%USERPROFILE%\Desktop\ScribeForge CLI test"
```
3. Type `"%SF%" --version`. **"ScribeForge 1.1.0", then the prompt comes back.** No ScribeForge window opens. (A blank line before it is normal: Electron prints it.)
4. Type `"%SF%"` on its own. **The help: "ScribeForge, from the command line.", the list of commands, the options and the exit codes.** Then `"%SF%" help redact`. **The redact help, explaining `--pages`, `--area`, `--find` and `--dpi`.**
5. Type `"%SF%" merge normal.pdf second.pdf`. **"Saved C:\Users\…\ScribeForge CLI test\normal (merged).pdf (5 pages)."**
6. Press the Up arrow and Enter to run it again. **This time it's "normal (merged) 2.pdf"**: the first one isn't replaced.
7. Type `"%SF%" merge normal.pdf second.pdf -o "normal (merged).pdf"`. **"normal (merged).pdf already exists. Add --overwrite to replace it, or choose another name."** Then type `echo %ERRORLEVEL%`. **2.**
8. Run step 7 again with ` --overwrite` added at the end. **"Saved …".** `echo %ERRORLEVEL%` **gives 0.**
9. Type `"%SF%" extract normal.pdf --pages 1 -o normal.pdf --overwrite`. **"normal.pdf is one of the files being read. ScribeForge never writes over the files it reads; choose another name."** `echo %ERRORLEVEL%` **gives 1.**
10. Type `"%SF%" split links.pdf --every 2 -o parts`. **"Split into 3 files in …\parts:", then "links (pages 1-2).pdf", "links (pages 3-4).pdf" and "links (pages 5-6).pdf".**
11. Type `"%SF%" rotate links.pdf --pages 1 --by -90 -o turned.pdf`. **"Saved …\turned.pdf (6 pages).", "Form fields look the same but can't be filled in, in the new file." and "Scripts and other actions were removed."**, the same notes the app shows.
12. Type `"%SF%" details normal.pdf --title "Command line test" --author "Tester"`. **"Saved …\normal (edited).pdf (3 pages)."**
13. Type `"%SF%" info "normal (edited).pdf"`. **Sections "Details" (Title: Command line test, Author: Tester), "About this file" and "What it carries".** Look at the line under "Pages": **"3 pages: 8.5 × 11 in (Letter)"**. Note whether the **×** shows as a times sign or as odd characters.
14. Type `"%SF%" info carries.pdf --json > info.json`, then `notepad info.json`. **Notepad shows the same information as JSON, starting with "file".** Close Notepad.
15. Type `"%SF%" redact redaction.pdf --find REDACT-ME-TERM`. After a few seconds: **"Saved …\redaction (redacted).pdf (3 pages, 2 pages redacted).", "4 marks on 2 pages are blacked out. …", and "Left out, as in every redacted file: …".** No window appears.
16. Type `"%SF%" redact redaction.pdf --area 2:50,36,200,58 -o area.pdf`. **"Saved …\area.pdf (3 pages, 1 page redacted)."**
17. Type `"%SF%" redact normal.pdf --find "no such words"`. **"\"no such words\" wasn't found." and "Nothing was marked, so nothing was redacted."** `echo %ERRORLEVEL%` **gives 1.**
18. Type `"%SF%" mreg normal.pdf` (a typo). **"\"mreg\" isn't a ScribeForge command." and "Type \"scribeforge help\" to see the commands."** The app doesn't open.

## Passwords

19. Type `"%SF%" info protected.pdf`. **A small ScribeForge window opens: "This file is password-protected", "Enter the password for protected.pdf. ScribeForge doesn't save it."** Type `wrong` and press Enter. **The window comes back with "That password didn't work. Try again."** Type `open-sesame` and press Enter. **The window closes, and the console shows the file's information with "Password or restrictions: yes".**
20. Run step 19's command again and press Escape in the window. **"protected.pdf needs a password, and none was given."** `echo %ERRORLEVEL%` **gives 2.**
21. Type `echo open-sesame| "%SF%" info protected.pdf --password-stdin` (no space before the `|`). **The information shows, with no window.**

## PowerShell

22. Open **Windows PowerShell** from the Start menu, go to the ScribeForge folder (`cd` and the folder you cloned it into), and type these one at a time:
```bash
$sf = "$PWD\release\win-unpacked\scribeforge.cmd"
```
```bash
cd "$env:USERPROFILE\Desktop\ScribeForge CLI test"
```
```bash
& $sf --version
```
**"ScribeForge 1.1.0".**
23. Type `'open-sesame' | & $sf extract protected.pdf --pages 1 -o open.pdf --password-stdin`, then `$LASTEXITCODE`. **"Saved …\open.pdf (1 page).", then 0.**
24. Type `& $sf info missing.pdf`, then `$LASTEXITCODE`. **"missing.pdf couldn't be found.", then 2.**

## The new files, in the app

25. Double-click `release\win-unpacked\ScribeForge.exe`. **ScribeForge opens as usual.** Leave it open.
26. Back in Command Prompt, type `"%SF%" extract links.pdf --pages 6 -o last.pdf`. **"Saved …" while the app stays open and unchanged.**
27. In the app, open `normal (merged).pdf` from the test folder. **5 pages: normal.pdf's three, then second.pdf's two.**
28. Open `turned.pdf`. **Page 1 is turned a quarter anticlockwise; the others are upright.**
29. Open `normal (edited).pdf` and click **Details**. **Title "Command line test", Author "Tester".**
30. Open `redaction (redacted).pdf`. **Pages 2 and 3 have solid black boxes where the term was (three on page 3, two of them over blank-looking space). Press Ctrl+F and search for `REDACT-ME-TERM`: no matches.** Try to select text on page 2: **nothing can be selected.**
31. Open `area.pdf`. **On page 2, a black box covers the heading "MARKED-PAGE-TWO" at the top left; the rest of the page looks as it was.**
32. Click **Help**, then **Command line**. **The page lists where the command is, the commands, where new files go, redacting, protected files and exit codes.**
33. Close the app.

## Locked-down program

34. In Command Prompt, type:
```bash
set ELECTRON_RUN_AS_NODE=1
```
then `"%SF%" --version`. **Still "ScribeForge 1.1.0"**: ScribeForge.exe can't be used to run other programs' scripts. Then:
```bash
set ELECTRON_RUN_AS_NODE=
```

## Finish

35. Delete the `ScribeForge CLI test` folder from your desktop.
