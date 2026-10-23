# Privacy and safety

## No internet

ScribeForge never connects to the internet: no updates, no usage data, no fonts or anything else fetched from the web. Web links in a document open in your own web browser, and only after you've seen the address and said yes.

## Your files

- Opening a file only reads it. Nothing you do changes it; everything is saved to a new file.
- ScribeForge keeps no copies of your documents, except in the [Archive](15-archive.md) if you put them there, encrypted.
- Passwords for protected files are kept in memory only while the file is open, and never saved.

## Scripts in PDFs

Some PDFs contain scripts (PDF JavaScript) or actions that try to open programs or send data. ScribeForge never runs them, and leaves them out of every file it saves.

## What a file carries

PDFs can hold more than their pages: details such as the author, attached files, comments, form data, hidden layers and scripts. The **Details** screen lists them, and ScribeForge shows the same list for every new file before you save it. See [Details and what a file carries](05-details.md).

## Redaction

A black box drawn over text doesn't remove the text. ScribeForge's redaction makes every marked page into a picture, so the text is gone. See [Redacting](06-redacting.md).

## The Archive

Documents you put in the [Archive](15-archive.md) are kept encrypted on this PC, with their titles, labels and notes. Nothing there can be read without your password, which ScribeForge never saves. The Archive locks itself when ScribeForge starts, after a while unused, and when Windows locks or the PC sleeps.

## Command line

The [command line](12-command-line.md) keeps the same rules: no internet, the files you give it are never changed, scripts in PDFs never run, and passwords are never saved.

## Open source

ScribeForge is open-source software under the Apache License 2.0. The licences of the parts it's built from are on the **About** screen.
