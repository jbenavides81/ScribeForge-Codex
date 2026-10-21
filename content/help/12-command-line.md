# Command line

ScribeForge can merge, split, rotate, extract, show details and redact from Command Prompt or PowerShell, without opening its window. It's useful for scripts and for jobs you repeat. It uses the same engine and the same safety rules as the app: the files you give it are never changed, nothing goes over the network, and PDF scripts never run.

## Where it is

The command is `scribeforge.cmd`, in the folder ScribeForge is installed in. For a normal install that's:

`%LOCALAPPDATA%\Programs\ScribeForge\scribeforge.cmd`

The installer doesn't change your PATH. To type just `scribeforge` from any folder, add that folder to your PATH yourself, or call the command with its full path.

Type `scribeforge help` to see every command, or `scribeforge help redact` (or any other command) for one of them.

## The commands

| Command | What it does |
|---|---|
| `scribeforge merge a.pdf b.pdf -o both.pdf` | Joins PDFs, in the order given |
| `scribeforge split report.pdf --every 5` | Splits into files of 5 pages; `--ranges "1-3, 4-9"` for chosen ranges; one file per page if neither is given |
| `scribeforge rotate report.pdf --pages "2, 4" --by 90` | Turns pages clockwise: 90, 180 or 270, or -90 for anticlockwise. All pages if `--pages` isn't given |
| `scribeforge extract report.pdf --pages "1-3"` | Saves just those pages as a new PDF |
| `scribeforge info report.pdf` | Shows its details and everything it carries; add `--json` for scripts |
| `scribeforge details report.pdf --title "Q3"` | Saves a copy with the title, author, subject or keywords changed |
| `scribeforge redact report.pdf --find "John Smith"` | Saves a redacted copy (see below) |

## Where new files go

- With `-o`, the new file is saved where you say. For **split**, `-o` names a folder.
- Without `-o`, it goes next to the first PDF, named the way the app names it, such as `report (merged).pdf`. If that name is taken, a number is added; nothing is replaced.
- A file that already exists is replaced only if you add `--overwrite`.
- A file being read is never written over, even with `--overwrite`.

## Redacting

`redact` works the same way as Redact mode in the app: every marked page becomes a picture of the page with the marks blacked out, so none of its text is left. Mark what to remove with any of these, as many times as you need:

| Option | What it marks |
|---|---|
| `--pages "2, 5"` | Whole pages |
| `--area 2:72,90,300,130` | An area of page 2: left, top, right and bottom, measured from the page's top-left corner as it's shown, in points (72 to the inch). Add `mm` for millimetres: `2:25,30,105,45mm` |
| `--find "John Smith"` | Every match on every page, like **Find and mark** |
| `--dpi 300` | Picture quality of redacted pages: 150, 200 (the default) or 300 |

Afterwards ScribeForge searches the new file for every `--find` text. If it still finds one, it says so and saves nothing.

## Protected files

If a PDF needs a password, a small ScribeForge window asks for it. To give it from a script instead, add `--password-stdin` and send the password as the first line of input, for example from a file only you can read:

`scribeforge info report.pdf --password-stdin < password.txt`

Passwords are never accepted as part of the command itself, where they'd stay in the command history. They're kept in memory only while the command runs.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Done |
| 1 | The command couldn't be followed: a mistake in it, or nothing to do |
| 2 | A problem with a file: missing, damaged, wrong password, or it can't be saved |
| 3 | A check failed, such as redacted text still being found, and nothing was saved |
