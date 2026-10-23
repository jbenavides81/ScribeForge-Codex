// What "scribeforge help" prints.
import type { CommandName } from './args';

const GENERAL = `ScribeForge, from the command line.

Every command makes a new PDF; the files you give it are never changed.

  scribeforge merge a.pdf b.pdf [-o both.pdf]          Join PDFs, in the order given
  scribeforge split report.pdf [--every 5 | --ranges "1-3, 4-9"] [-o folder]
  scribeforge rotate report.pdf --pages "2, 4" --by 90 [-o turned.pdf]
  scribeforge extract report.pdf --pages "1-3" [-o first.pdf]
  scribeforge info report.pdf [--json]                  Its details and what it carries
  scribeforge details report.pdf --title "Q3" [-o titled.pdf]
  scribeforge redact report.pdf --find "John Smith" [-o out.pdf]
  scribeforge verify signed.pdf [--trust someone.cer] [--json]   Check its signatures

Type "scribeforge help <command>" for more about one command.

Also, for every command that makes a file:
  -o, --output <file>    Where to save it. Without it, the new file goes next to the first PDF,
                         named as the app would name it, and never replaces a file.
  --overwrite            Replace the output file if it already exists. Never an input file.
  --password-stdin       Read the password for a protected PDF from the first line of standard
                         input. Without it, ScribeForge asks in a small window.

Exit codes: 0 done; 1 the command couldn't be followed; 2 a problem with a file; 3 a check
failed and nothing was saved (for verify: a signature isn't valid, or whose it is isn't confirmed).`;

const TOPICS: Partial<Record<CommandName, string>> = {
  merge: `scribeforge merge a.pdf b.pdf [c.pdf ...] [-o merged.pdf]

Joins the PDFs into one, in the order given. Each file's bookmarks are kept under a bookmark
named after the file. Without -o it's saved as "<first> (merged).pdf".`,
  split: `scribeforge split report.pdf [--every N | --ranges "1-3, 4, 5-9"] [-o folder]

Splits a PDF into several files: one per page (the default), every N pages, or the page ranges
you list. They're saved in the folder given (made if needed), or next to the PDF, named like
"report (pages 1-3).pdf". Existing files are never replaced; a number is added instead.`,
  rotate: `scribeforge rotate report.pdf [--pages "2, 4-6" | --pages all] --by 90|180|270|-90 [-o turned.pdf]

Turns the pages listed (all of them if --pages isn't given) clockwise by the angle given.`,
  extract: `scribeforge extract report.pdf --pages "1-3, 5" [-o pages.pdf]

Saves just those pages, in that order, as a new PDF.`,
  info: `scribeforge info report.pdf [--json]

Shows the PDF's details (title, author and so on), its page sizes, whether it has a password, and
everything it carries besides its pages: attachments, form fields, comments, scripts,
bookmarks, layers and links. With --json, the same as JSON, for scripts.`,
  details: `scribeforge details report.pdf [--title t] [--author a] [--subject s] [--keywords k] [-o out.pdf]

Saves a copy with the details changed. Both copies a PDF keeps of its details (the classic ones
and XMP) get the same values.`,
  redact: `scribeforge redact report.pdf [--pages "2, 5"] [--area 2:72,90,300,130]... [--find "text"]... [--dpi 150|200|300] [-o out.pdf]

Removes what's marked, the same way the app does: every marked page becomes a picture of the
page with the marks blacked out, so none of its text is left. The new file keeps only the
pages and the links between them.

  --pages "2, 5"         Black out whole pages.
  --area 2:72,90,300,130 Black out an area of page 2: left, top, right, bottom, measured from
                         the page's top-left corner as it's shown, in points (72 to the inch).
                         Add "mm" for millimetres: 2:25,30,105,45mm. Give --area more than once
                         for more areas.
  --find "John Smith"    Black out every match on every page, like Find and mark in the app.
                         Give --find more than once for more words.
  --dpi 200              Picture quality of redacted pages: 150, 200 (default) or 300.

Afterwards ScribeForge searches the new file for every --find text. If it still finds one, it
says so, saves nothing, and exits with code 3.`,
  verify: `scribeforge verify signed.pdf [--trust someone.cer]... [--json]

Checks every signature in the PDF, as the app's Sign screen does: whether the file has changed
since it was signed, and whether each signer's certificate leads back to one that's trusted.
Windows' trusted certificates on this PC count, and so does any certificate given with --trust
(a .cer, .crt or .pem file; give --trust more than once for more).

It can't check whether a certificate was cancelled, because that needs the internet.

Exits with 0 when every signature is valid and whose it is is confirmed; otherwise 3 (and 3
when the file has no signatures). With --json, the same as JSON, for scripts.`,
};

export function helpText(topic?: string): string {
  return (topic && TOPICS[topic as CommandName]) || GENERAL;
}
