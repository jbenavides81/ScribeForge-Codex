# Manual test: stop 2c, finding patterns and the redaction log

About 25 minutes, plus reading the research report. Everything runs in **trial mode**, and the test PDFs are made up. The phone, Social Security and card numbers in them are invented or published test numbers. You'll save a few new files, so first make a folder for them, for example `Desktop\ScribeForge 2c test`. Delete it when you're done.

Each step says what to do, then **what you should see**. If something doesn't match, note the step number and what you saw.

## Setup

A. Make the test PDFs. This adds `patterns.pdf` for this stop:
```bash
npm run fixtures
```
B. Start from clean trial data:
```bash
npm run trial:reset
```
C. Start trial mode:
```bash
npm run trial
```

## Finding patterns

1. Open `tests\fixtures\out\patterns.pdf`. Read page 1: **email addresses, phone numbers and Social Security numbers, then a line of "look-alikes" (a date, a ZIP code, numbers that can't be Social Security numbers, a long number).** Page 2 has card numbers, one look-alike card number, and the words "Project Nightingale".
2. Click **Redact** at the start of the second toolbar, then **Find patterns…**. **A window: "Look for", with Email addresses, Phone numbers, Social Security numbers and Card numbers all ticked, and a box for words or phrases.**
3. Type `Project Nightingale` in the words box and click **Find**. **"Found 12 matches. Untick any you don't want marked." Listed under Email addresses (2), Phone numbers (4), Social Security numbers (2), Card numbers (3) and "Project Nightingale" (1), each with its page.**
4. Check what isn't there: **no 2026-10-21, no 12345-6789, no 000-12-3456, 666-12-3456 or 123-00-4567, no 1234567890123456, and no 4111 1111 1111 1112** (it fails the card-number check).
5. Untick **+44 20 7946 0958**. **The button says "Mark 11 matches".** Untick the **Card numbers** heading. **All three card numbers untick, and the button says "Mark 8 matches".** Tick the heading again. **"Mark 11 matches".**
6. Click **Mark 11 matches**. **The toolbar says "Marked 11 matches on 2 pages.", and see-through dark boxes cover each one closely.** The +44 number on page 1 has no box.
7. Click **Select**, then one of the email boxes. **The panel says "Redaction mark on page 1", then "Email address".** Click **Done**.
8. Click **Find patterns…** again, click **Back** after it searches, untick every kind and leave the words box empty. **Find is greyed out.** Click **Cancel**.

## Redacting with a log

9. Click **Review and redact…**. **The 11 marks are listed by page, and under the list is "Also save a redaction log next to the redacted file", unticked.**
10. Tick it, and click **Redact…**. Go past the summary and save as `patterns-redacted.pdf` in your test folder. **The message ends with "Redaction log saved as patterns-redacted (redaction log).txt."**
11. In File Explorer, open the test folder. **Two files: the PDF and the log.** Open the log in Notepad. **It shows:**
    - when the file was redacted, and with which version of ScribeForge;
    - the redacted file's name and "Made from: patterns.pdf";
    - the pages, how many were redacted, and the picture quality;
    - what was left out;
    - the last check ("searched for 11 marked values; none was found", or close to it);
    - the marks by page, as "Email address: j•••@e•••.com", "Phone number: (•••) •••-••67", "Social Security number: •••-••-••••", "Card number: •••• •••• •••• ••11" and "Word or phrase from the list: P••• N•••".
12. Press `Ctrl+F` in Notepad and search for `example.com`, `4567`, `6789`, `1111 1111` and `Nightingale` one at a time. **None is found.**
13. Close Notepad. In ScribeForge (now showing `patterns-redacted.pdf`), try to select text on either page. **Nothing can be selected: both pages are pictures.**

## Without a log

14. Open `tests\fixtures\out\redaction.pdf`, click **Redact**, and use **Find and mark** to mark `REDACT-ME-TERM`. Click **Review and redact…**. **The log box is unticked again.** Leave it unticked and save as `no-log.pdf`. **No log file appears in the folder, and the message doesn't mention one.**

## The research report

15. Open `docs\Research_TextRemoval.md`. It explains whether ScribeForge could remove only what's under a mark and keep the rest of the page as real text, what the prototype handled, what it couldn't, and the risks. Its recommendation is under "The short answer". Tell me whether you'd like that built as a later stop.

## Finish

16. Close ScribeForge and delete your test folder.
